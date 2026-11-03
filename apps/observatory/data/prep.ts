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
//   regenerate).
//
// Each is checked to fit a Workers static asset.
//
// Usage: node apps/observatory/data/prep.ts [--only asteroids|ghcn] [--repin]
//        (`just observatory data`). The asteroids need Tycho's file first:
//        `just tycho data`.

import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api';

/** Cloudflare's per-file limit for Workers static assets. */
const STATIC_ASSET_LIMIT = 25 * 2 ** 20;

const dataDir = dirname(fileURLToPath(import.meta.url));
const tychoData = join(dataDir, '../../tycho/data');
const manifestPath = join(dataDir, 'MANIFEST.json');

const ASTEROIDS = 'asteroids.parquet';
const GHCN = 'ghcn-2025-tmax.parquet';

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
if (only !== undefined && only !== 'asteroids' && only !== 'ghcn') throw new Error(`--only takes asteroids or ghcn, not ${only}`);
const repin = args.includes('--repin');

const manifest: Record<string, ManifestFile> = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {};
const conn = await (await DuckDBInstance.create()).connect();
process.chdir(dataDir);

if (only !== 'ghcn') manifest[ASTEROIDS] = await asteroids();
if (only !== 'asteroids') manifest[GHCN] = await ghcn(manifest[GHCN]);
// In a fixed order, whichever was built.
const ordered = Object.fromEntries([ASTEROIDS, GHCN].filter((name) => manifest[name]).map((name) => [name, manifest[name]]));
writeFileSync(manifestPath, `${JSON.stringify(ordered, null, 2)}\n`);

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
