// Builds the Observatory's data files (data/README in its CLAUDE.md,
// "Data") and writes MANIFEST.json (committed) with each one's rows, bytes,
// SHA-256, row groups, source, credit, and terms:
//
// - asteroids.parquet, the base level's, from Tycho's pinned asteroid sample
//   (apps/tycho/data/asteroids.parquet, its SHA-256 in Tycho's
//   MANIFEST.json), by prep.sql;
// - ghcn-2025-tmax.parquet, the wide sheet's, from NOAA's GHCN-Daily
//   (prep-ghcn.sql), its three sources kept in data/raw/ghcn/ (gitignored)
//   and checked against the SHA-256s MANIFEST.json pins. NOAA appends late
//   reports to a year's file, so a later download differs from the pin:
//   only `--repin` takes one (a new file, a new SHA-256, and cells.json to
//   regenerate);
// - market-instruments.parquet, market watch's, from the feed's
//   instruments (contenders/market/feed.ts, their one home), by
//   prep-market.sql, after checking that no symbol is listed on a US
//   exchange (NASDAQ Trader's symbol directories, fetched at each build).
//
// Each is checked to fit a Workers static asset.
//
// Usage: node apps/observatory/data/prep.ts [--only asteroids|ghcn|market] [--repin]
//        (`just observatory data`). The asteroids need Tycho's file first:
//        `just tycho data`.

import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api';
import { INSTRUMENTS } from '../contenders/market/feed.ts';

/** Cloudflare's per-file limit for Workers static assets. */
const STATIC_ASSET_LIMIT = 25 * 2 ** 20;

const dataDir = dirname(fileURLToPath(import.meta.url));
const tychoData = join(dataDir, '../../tycho/data');
const manifestPath = join(dataDir, 'MANIFEST.json');

const ASTEROIDS = 'asteroids.parquet';
const GHCN = 'ghcn-2025-tmax.parquet';
const MARKET = 'market-instruments.parquet';

/** A source file prep downloaded, as pinned. */
interface PinnedSource {
  file: string;
  url: string;
  bytes: number;
  sha256: string;
}

interface ManifestFile {
  rows: number;
  bytes: number;
  sha256: string;
  source: string;
  /** How the page and the README credit it. */
  credit?: string;
  /** The citation its source asks for. */
  citation?: string;
  /** The source's terms, as found. */
  terms?: string;
  /** The license it's under, where one is stated. */
  license?: string;
  fetched?: string;
  /** The files it was built from, each pinned by its SHA-256 (`--repin` takes new ones). */
  sources?: PinnedSource[];
  /** The source's own version, where it states one. */
  version?: string;
  rowGroups?: number;
  /** The least and greatest value over the painted columns (the wide sheet's heat domain). */
  range?: [number, number];
  writer: string;
  notes?: string[];
}

/** The asteroids' credit and terms, for MANIFEST.json (the page and the README show the credit). */
const CREDIT = 'NASA/JPL Small-Body Database (JPL Solar System Dynamics), courtesy NASA/JPL-Caltech';
const TERMS =
  'No license stated: the SBDB Query API\'s documentation (ssd-api.jpl.nasa.gov/doc/sbdb_query.html) gives no terms of use. JPL\'s use policy (jpl.nasa.gov/jpl-image-use-policy) covers its images and video, free for any purpose with the credit line "Courtesy NASA/JPL-Caltech"; the credit follows it. Checked 2026-11-01.';

/** GHCN-Daily's sources: NOAA's Open Data Dissemination copy (byte-identical to NCEI's). */
const NODD = 'https://noaa-ghcn-pds.s3.amazonaws.com/';
const GHCN_SOURCES = [
  { file: '2025.csv.gz', url: `${NODD}csv.gz/by_year/2025.csv.gz` },
  { file: 'ghcnd-stations.txt', url: `${NODD}ghcnd-stations.txt` },
  { file: 'ghcnd-countries.txt', url: `${NODD}ghcnd-countries.txt` },
];
/** The version file: it names the data's version, which the file's metadata
 *  and citation carry, so it's pinned with the rest. */
const GHCN_VERSION = { file: 'ghcnd-version.txt', url: `${NODD}ghcnd-version.txt` };
const GHCN_CREDIT = 'NOAA National Centers for Environmental Information, GHCN-Daily: daily highs of 2025, cut from its data (not NOAA\'s unaltered data)';
const GHCN_CITATION =
  'Menne, M.J., I. Durre, B. Korzeniewski, S. McNeill, K. Thomas, X. Yin, S. Anthony, R. Ray, R.S. Vose, B.E. Gleason, and T.G. Houston, 2012: Global Historical Climatology Network - Daily (GHCN-Daily), Version 3.${minor}. NOAA National Climatic Data Center. doi:10.7289/V5D21VHZ, accessed ${fetched}. Overview: Menne et al., 2012, J. Atmos. Oceanic Technol., 29, 897-910, doi:10.1175/JTECH-D-11-00103.1.';
const GHCN_TERMS =
  'CC0 1.0 for NOAA data disseminated through NODD (the AWS Open Data Registry\'s noaa-ghcn entry). NOAA asks for attribution, no implied endorsement, and that modified data not be called original or unaltered; NCEI\'s record (gov.noaa.ncdc:C00861) asks for its citation with the version and access date. Checked 2026-11-02.';

/** The US exchanges' listed symbols: NASDAQ Trader's public directories,
 *  NASDAQ's own and every other exchange's (NYSE, NYSE American, NYSE Arca,
 *  Cboe, IEX…). */
const SYMBOL_DIRECTORIES = [
  { url: 'https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt', columns: ['Symbol'] },
  { url: 'https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt', columns: ['ACT Symbol', 'CQS Symbol', 'NASDAQ Symbol'] },
];
/** How long a directory's fetch may take before prep fails. */
const DIRECTORY_TIMEOUT_MS = 30_000;
/** The control: symbols every directory read right holds (one on NASDAQ, one on NYSE). */
const LISTED_CONTROLS = ['AAPL', 'IBM'];
const MARKET_CREDIT = "Fictional instruments, the observatory's own: synthetic";
const MARKET_TERMS =
  "The observatory's own, made up for market watch and dedicated to the public domain (CC0 1.0). The names and symbols are fictional: prep fails if a symbol is listed on a US exchange (NASDAQ Trader's nasdaqlisted.txt and otherlisted.txt, fetched at each build).";

const sqlText = (value: string) => value.replaceAll("'", "''");

async function sha256(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

async function value(conn: DuckDBConnection, sql: string): Promise<unknown> {
  return (await conn.runAndReadAll(sql)).getRows()[0]?.[0];
}

const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : undefined;
if (only !== undefined && only !== 'asteroids' && only !== 'ghcn' && only !== 'market') throw new Error(`--only takes asteroids, ghcn, or market, not ${only}`);
const repin = args.includes('--repin');

const manifest: Record<string, ManifestFile> = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {};
const conn = await (await DuckDBInstance.create()).connect();
process.chdir(dataDir);

/** MANIFEST.json as it stands, in a fixed order: written after each file,
 *  so one that fails (the market's fetch) keeps the others' entries. */
function writeManifest(): void {
  const ordered = Object.fromEntries([ASTEROIDS, GHCN, MARKET].filter((name) => manifest[name]).map((name) => [name, manifest[name]]));
  writeFileSync(manifestPath, `${JSON.stringify(ordered, null, 2)}\n`);
}
if (only === undefined || only === 'asteroids') {
  manifest[ASTEROIDS] = await asteroids();
  writeManifest();
}
if (only === undefined || only === 'ghcn') {
  manifest[GHCN] = await ghcn(manifest[GHCN]);
  writeManifest();
}
if (only === undefined || only === 'market') {
  manifest[MARKET] = await market();
  writeManifest();
}

/** Runs `file` (a SQL script in data/) with its `${…}` substituted. */
async function runSql(file: string, vars: Record<string, string>): Promise<void> {
  let sql = readFileSync(join(dataDir, file), 'utf8');
  for (const [name, text] of Object.entries(vars)) sql = sql.replaceAll(`\${${name}}`, text);
  const started = performance.now();
  await conn.run(sql);
  console.log(`${file}: ${((performance.now() - started) / 1000).toFixed(1)} s`);
}

/** Fails unless `name` fits a static asset; its bytes. */
function fits(name: string, fix: string): number {
  const bytes = statSync(join(dataDir, name)).size;
  if (bytes >= STATIC_ASSET_LIMIT) throw new Error(`${name} is ${(bytes / 2 ** 20).toFixed(2)} MiB, over the 25 MiB static-asset limit: ${fix}`);
  return bytes;
}

async function asteroids(): Promise<ManifestFile> {
  const source = join(tychoData, ASTEROIDS);
  const pinned = (JSON.parse(readFileSync(join(tychoData, 'MANIFEST.json'), 'utf8')) as Record<string, ManifestFile>)[ASTEROIDS];
  if (!pinned) throw new Error("Tycho's MANIFEST.json has no asteroids.parquet");
  let sourceHash: string;
  try {
    sourceHash = await sha256(source);
  } catch {
    throw new Error(`${source} is missing: build it with \`just tycho data\``);
  }
  if (sourceHash !== pinned.sha256)
    throw new Error(`${source}: SHA-256 ${sourceHash}, but Tycho's MANIFEST.json pins ${pinned.sha256}; rebuild it with \`just tycho data\``);

  await runSql('prep.sql', { source: sqlText(source), fetched: sqlText(pinned.fetched ?? '') });
  const bytes = fits(ASTEROIDS, 'drop a column in prep.sql');
  const rows = Number(await value(conn, `SELECT count(*) FROM '${ASTEROIDS}'`));
  if (rows !== pinned.rows) throw new Error(`${ASTEROIDS} has ${rows} rows; its source has ${pinned.rows}`);
  const entry: ManifestFile = {
    rows,
    bytes,
    sha256: await sha256(join(dataDir, ASTEROIDS)),
    source: `apps/tycho/data/asteroids.parquet (sha256 ${pinned.sha256.slice(0, 12)}…), from ${pinned.source}`,
    credit: CREDIT,
    terms: TERMS,
    fetched: pinned.fetched,
    rowGroups: Number(await value(conn, `SELECT num_row_groups FROM parquet_file_metadata('${ASTEROIDS}')`)),
    writer: `DuckDB ${await value(conn, 'SELECT version()')}, ZSTD, ROW_GROUP_SIZE 30720, sorted by spkid`,
    notes: [`columns: ${await columns(ASTEROIDS)}`],
  };
  console.log(`${ASTEROIDS}: ${rows} rows, ${(bytes / 2 ** 20).toFixed(2)} MiB, ${entry.rowGroups} row groups, sha256 ${entry.sha256}`);
  return entry;
}

async function columns(name: string): Promise<string> {
  return (await conn.runAndReadAll(`DESCRIBE SELECT * FROM '${name}'`)).getRows().map((r) => `${r[0]} ${r[1]}`).join(', ');
}

async function download(url: string, to: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`${url}: ${response.status}`);
  const partial = `${to}.partial`;
  await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream), createWriteStream(partial));
  renameSync(partial, to);
  console.log(`downloaded ${url} (${statSync(to).size} B)`);
}

async function ghcn(previous: ManifestFile | undefined): Promise<ManifestFile> {
  const raw = join(dataDir, 'raw/ghcn');
  mkdirSync(raw, { recursive: true });
  const pins = repin ? undefined : previous?.sources;
  // A missing source is downloaded, as is every one with --repin.
  for (const source of [...GHCN_SOURCES, GHCN_VERSION]) if (repin || !existsSync(join(raw, source.file))) await download(source.url, join(raw, source.file));
  const sources: PinnedSource[] = [];
  for (const { file, url } of [...GHCN_SOURCES, GHCN_VERSION]) {
    const path = join(raw, file);
    const found = { file, url, bytes: statSync(path).size, sha256: await sha256(path) };
    const pin = pins?.find((candidate) => candidate.file === file);
    if (pins && found.sha256 !== pin?.sha256)
      throw new Error(
        `data/raw/ghcn/${file}: SHA-256 ${found.sha256}, but MANIFEST.json pins ${pin?.sha256}. NOAA appends late reports to a year's file, so a new download differs: ` +
          'build from the pinned copy, or take this one with `--repin` (a new file and SHA-256: regenerate cells.json with `just observatory cell-fixture`).',
      );
    sources.push(found);
  }
  const versionText = readFileSync(join(raw, GHCN_VERSION.file), 'utf8');
  const version = /(\d+\.\d+-(?:upd|por)-\d+)/.exec(versionText)?.[1];
  if (!version) throw new Error(`data/raw/ghcn/${GHCN_VERSION.file} names no version: ${versionText.slice(0, 200)}`);
  // Kept with the pin: the version of the files pinned, not today's.
  const fetched = repin || !previous?.fetched ? new Date().toISOString().slice(0, 10) : previous.fetched;

  const days = Array.from({ length: 365 }, (_, doy) => {
    const date = new Date(Date.UTC(2025, 0, 1 + doy));
    return `"${doy}"::DOUBLE / 10 AS "${date.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })} ${date.getUTCDate()}"`;
  });
  await runSql('prep-ghcn.sql', {
    raw: sqlText(raw),
    doys: Array.from({ length: 365 }, (_, doy) => doy).join(', '),
    days: days.join(',\n       '),
    fetched: sqlText(fetched),
    version: sqlText(version),
  });
  const bytes = fits(GHCN, 'drop stations in prep-ghcn.sql');
  const rows = Number(await value(conn, `SELECT count(*) FROM '${GHCN}'`));
  // The heat's domain: the least and greatest high in the file. A day with
  // no clean high anywhere has a NULL min and max, which isn't a 0.
  const extremes = (await conn.runAndReadAll(`SELECT min(COLUMNS(* EXCLUDE ("Station", "Place", "Latitude"))), max(COLUMNS(* EXCLUDE ("Station", "Place", "Latitude"))) FROM '${GHCN}'`)).getRows()[0]!;
  const present = (values: unknown[]) => values.filter((value) => value !== null).map(Number);
  const range: [number, number] = [Math.min(...present(extremes.slice(0, 365))), Math.max(...present(extremes.slice(365)))];
  if (!range.every(Number.isFinite)) throw new Error(`${GHCN}: no high in the file (range ${range.join(' … ')})`);
  const entry: ManifestFile = {
    rows,
    bytes,
    sha256: await sha256(join(dataDir, GHCN)),
    source: `${NODD}csv.gz/by_year/2025.csv.gz, ghcnd-stations.txt, and ghcnd-countries.txt (GHCN-Daily ${version})`,
    credit: GHCN_CREDIT,
    citation: GHCN_CITATION.replace('${minor}', version.split('-')[0]!.split('.')[1]!).replace('${fetched}', fetched),
    license: 'CC0 1.0',
    terms: GHCN_TERMS,
    fetched,
    sources,
    version,
    rowGroups: Number(await value(conn, `SELECT num_row_groups FROM parquet_file_metadata('${GHCN}')`)),
    range,
    writer: `DuckDB ${await value(conn, 'SELECT version()')}, ZSTD, ROW_GROUP_SIZE 2048, sorted by latitude (north first), then station ID`,
    notes: [
      'TMAX with no QFLAG, stations with at least 300 such days; °C (the tenths over 10); NULL where a day has none',
      `columns: Station VARCHAR, Place VARCHAR, Latitude DOUBLE, then "Jan 1" … "Dec 31" DOUBLE (${(await columns(GHCN)).split(', ').length} in all)`,
    ],
  };
  console.log(`${GHCN}: ${rows} rows, ${(bytes / 2 ** 20).toFixed(2)} MiB, ${entry.rowGroups} row groups, range ${range.join(' … ')} °C, sha256 ${entry.sha256}`);
  return entry;
}

/** Every symbol listed on a US exchange today, after checking the control's are among them. */
async function listedSymbols(): Promise<Set<string>> {
  const listed = new Set<string>();
  for (const { url, columns } of SYMBOL_DIRECTORIES) {
    const response = await fetch(url, { signal: AbortSignal.timeout(DIRECTORY_TIMEOUT_MS) }).catch((error: unknown) => {
      throw new Error(`${url}: ${error instanceof Error ? error.message : error}; the market file needs NASDAQ Trader's directories (\`--only asteroids\` or \`--only ghcn\` builds the others)`);
    });
    if (!response.ok) throw new Error(`${url}: ${response.status}`);
    const [header, ...lines] = (await response.text()).trim().split(/\r?\n/);
    const names = header!.split('|');
    const at = columns.map((column) => names.indexOf(column));
    if (at.includes(-1)) throw new Error(`${url}: no ${columns.join(', ')} column in its header (${header})`);
    // The last line is the directory's creation time, not a symbol.
    const created = lines.at(-1)?.startsWith('File Creation Time') ? lines.pop() : undefined;
    for (const line of lines) for (const column of at) listed.add(line.split('|')[column]!);
    console.log(`${url}: ${lines.length} securities (${created?.split('|')[0] ?? 'no creation time'})`);
  }
  listed.delete('');
  const missing = LISTED_CONTROLS.filter((symbol) => !listed.has(symbol));
  if (missing.length) throw new Error(`control: ${missing.join(', ')} should be listed and isn't in NASDAQ Trader's directories: they weren't read right`);
  return listed;
}

async function market(): Promise<ManifestFile> {
  const listed = await listedSymbols();
  const real = INSTRUMENTS.filter(({ symbol }) => listed.has(symbol));
  if (real.length)
    throw new Error(`${real.map(({ symbol, name }) => `${symbol} (${name})`).join(', ')}: listed on a US exchange; give them fictional symbols in contenders/market/feed.ts (a symbol isn't in the feed's ticks, so its bytes don't change)`);
  const symbols = new Set(INSTRUMENTS.map(({ symbol }) => symbol));
  if (symbols.size !== INSTRUMENTS.length) throw new Error('contenders/market/feed.ts lists a symbol twice');

  const values = INSTRUMENTS.map(({ symbol, name, price }, i) => `(${i}, '${sqlText(symbol)}', '${sqlText(name)}', '${String(price)}'::DOUBLE)`).join(',\n');
  await runSql('prep-market.sql', { values });
  const bytes = fits(MARKET, 'it is 50 rows');
  const rows = Number(await value(conn, `SELECT count(*) FROM '${MARKET}'`));
  if (rows !== INSTRUMENTS.length) throw new Error(`${MARKET} has ${rows} rows; the feed has ${INSTRUMENTS.length} instruments`);
  // Each row is its instrument, in the feed's order, at its reference price.
  const read = (await conn.runAndReadAll(`SELECT "Symbol", "Last" FROM '${MARKET}'`)).getRows();
  read.forEach(([symbol, last], i) => {
    const want = INSTRUMENTS[i]!;
    if (symbol !== want.symbol || last !== want.price) throw new Error(`${MARKET} row ${i}: ${symbol} at ${last}, want ${want.symbol} at ${want.price}`);
  });
  const entry: ManifestFile = {
    rows,
    bytes,
    sha256: await sha256(join(dataDir, MARKET)),
    source: 'apps/observatory/contenders/market/feed.ts (INSTRUMENTS), the feed\'s instruments',
    credit: MARKET_CREDIT,
    license: 'CC0 1.0',
    terms: MARKET_TERMS,
    rowGroups: Number(await value(conn, `SELECT num_row_groups FROM parquet_file_metadata('${MARKET}')`)),
    writer: `DuckDB ${await value(conn, 'SELECT version()')}, ZSTD, one row group, in the feed's order`,
    notes: [
      "the open as the table draws it: each price the instrument's reference, no change, sizes and volume 0; the feed (seeded, synthetic) moves them",
      `columns: ${await columns(MARKET)}`,
    ],
  };
  console.log(`${MARKET}: ${rows} rows, ${bytes} B, sha256 ${entry.sha256}`);
  return entry;
}
