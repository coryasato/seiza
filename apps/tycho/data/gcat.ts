// Builds Tycho's sample, data/gcat.parquet: GCAT, Jonathan McDowell's
// General Catalog of Artificial Space Objects, one row per object that
// reached Earth orbit (https://planet4589.org/space/gcat, CC BY 4.0). Why
// GCAT, its columns, and this build's spec: docs/research/tycho-sample.md at
// the repo root.
//
// Usage: node apps/tycho/data/gcat.ts [--refresh]
//
// 1. Fetch: the seven TSV files and GCAT's index page (its release and data
//    update) into data/raw/gcat/ (gitignored), then fetch.json last, with
//    each file's bytes and SHA-256 and the fetch date. A rerun reuses them;
//    --refresh fetches again.
// 2. Read every column as text, then cast, so a bad value fails instead of
//    shifting a column. `-` and blank are null; 0 is null in mass and span
//    only (counted and printed).
// 3. Dates are GCAT's Vague Dates (gcat-dates.ts, unit-tested); codes
//    become words through gcat-codes.ts; owners, countries, manufacturers,
//    agencies, and sites through GCAT's orgs and sites tables, a slash-joined
//    pair half by half. Any date form, code, or org that isn't covered fails
//    the build and is printed. `launch_date` is the launch list's, the date
//    of `launch_time`, not the object's own `LDate`: they agree on all but
//    about 0.1% of rows (cargo, debris of unknown origin, 18 year-only dates).
// 4. Rows of type Z (spurious), a blank type, or status ERR are dropped,
//    their IDs printed.
// 5. Write gcat.parquet (ZSTD, 30,720-row groups, sorted by launch_date then
//    jcat) with the license, credit, citation, release, data update, fetch
//    date, and source URLs in its key/value metadata; check it (below); print
//    each column's null share; and record it in MANIFEST.json.
//
// The web build serves the file as a hashed asset and checks it against
// MANIFEST.json's SHA-256 (web/vite.config.ts); a newer GCAT is a rerun with
// --refresh, then a build.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api';
import { parseVagueDate, type VagueDate } from './gcat-dates.ts';
import { CREWED_LETTER, MEGACONSTELLATION_LETTER, OBJECT_DETAIL, OBJECT_TYPE, ORBIT, OUR_NAMES, PURPOSE, RETURNED, SECTOR, STATUS } from './gcat-codes.ts';

const dataDir = dirname(fileURLToPath(import.meta.url));
const rawDir = join(dataDir, 'raw/gcat');
const fetchInfoPath = join(rawDir, 'fetch.json');
const manifestPath = join(dataDir, 'MANIFEST.json');
export const SAMPLE = 'gcat.parquet';
const output = join(dataDir, SAMPLE);

const HOME = 'https://planet4589.org/space/gcat';
/** View name → the TSV under `${HOME}/tsv/`. */
const FILES = {
  satcat: 'cat/satcat.tsv',
  satcat100k: 'cat/satcat100k.tsv',
  psatcat: 'cat/psatcat.tsv',
  psatcat100k: 'cat/psatcat100k.tsv',
  launch: 'launch/launch.tsv',
  orgs: 'tables/orgs.tsv',
  sites: 'tables/sites.tsv',
} as const;
const INDEX = 'index.html';

const LICENSE = 'CC BY 4.0';
const CREDIT = `Data from GCAT (J. McDowell, planet4589.org/space/gcat) · ${LICENSE}`;
/** Under the Workers static-asset limit (root docs/DECISIONS.md, "Hosting"). */
const MAX_BYTES = 25 * 1024 * 1024;
const ROW_GROUP_SIZE = 30_720;

interface FetchInfo {
  /** UTC date (YYYY-MM-DD) of the fetch. */
  fetched: string;
  release: string;
  releaseDate: string;
  /** GCAT's "Data Update" line, as an ISO date. */
  dataUpdate: string;
  files: { file: string; url: string; bytes: number; sha256: string }[];
}

const sql = (text: string) => text.replaceAll("'", "''");
const literal = (value: string | number | boolean | null) =>
  value === null ? 'NULL' : typeof value === 'string' ? `'${sql(value)}'` : String(value);
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

// ---------------------------------------------------------------- fetch

async function fetchAll(): Promise<FetchInfo> {
  const refresh = process.argv.includes('--refresh');
  if (!refresh && existsSync(fetchInfoPath)) {
    const info = JSON.parse(readFileSync(fetchInfoPath, 'utf8')) as FetchInfo;
    for (const { file, sha256: pinned } of info.files) {
      const found = sha256(readFileSync(join(rawDir, file)));
      if (found !== pinned) throw new Error(`raw/gcat/${file}: SHA-256 ${found}, but fetch.json records ${pinned}; fetch again with --refresh`);
    }
    console.log(`Reusing GCAT ${info.release}, data update ${info.dataUpdate}, fetched ${info.fetched} (--refresh fetches again)`);
    return info;
  }
  rmSync(fetchInfoPath, { force: true });
  mkdirSync(rawDir, { recursive: true });
  const fetched = new Date().toISOString().slice(0, 10);
  const files: FetchInfo['files'] = [];
  for (const [file, url] of [[INDEX, `${HOME}/`], ...Object.values(FILES).map((path) => [path.split('/').pop()!, `${HOME}/tsv/${path}`])] as [string, string][]) {
    const response = await fetch(url, { headers: { 'User-Agent': 'seiza-data-build' } });
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    writeFileSync(join(rawDir, file), bytes);
    files.push({ file, url, bytes: bytes.length, sha256: sha256(bytes) });
    console.log(`fetched ${url} (${(bytes.length / 1e6).toFixed(1)} MB)`);
  }
  // "GCAT Release 1.8.9  (2026 Nov  6) | Data Update 2026 Nov 23", once tags are stripped.
  const page = readFileSync(join(rawDir, INDEX), 'utf8').replace(/<[^>]*>/g, ' ');
  const found = /GCAT Release\s+([\d.]+)\s*\(([^)]+)\)\s*\|\s*Data Update\s+(\d{4} [A-Za-z]{3} {1,2}\d{1,2})/.exec(page);
  if (!found) throw new Error(`raw/gcat/${INDEX}: no "GCAT Release … | Data Update …" line; read the page and fix the pattern`);
  const info: FetchInfo = {
    fetched,
    release: found[1]!,
    releaseDate: parseVagueDate(found[2]!).value,
    dataUpdate: parseVagueDate(found[3]!).value,
    files,
  };
  writeFileSync(fetchInfoPath, `${JSON.stringify(info, null, 2)}\n`);
  return info;
}

// ---------------------------------------------------------------- helpers

async function rows(conn: DuckDBConnection, query: string): Promise<unknown[][]> {
  return (await conn.runAndReadAll(query)).getRows();
}

async function one(conn: DuckDBConnection, query: string): Promise<unknown> {
  return (await rows(conn, query))[0]?.[0];
}

async function insert(conn: DuckDBConnection, table: string, values: (string | number | boolean | null)[][]) {
  for (let start = 0; start < values.length; start += 1000) {
    const chunk = values.slice(start, start + 1000);
    await conn.run(`INSERT INTO ${table} VALUES ${chunk.map((row) => `(${row.map(literal).join(', ')})`).join(', ')}`);
  }
}

/** A TSV as a view of text columns, named from its `#` header line; the
 *  "# Updated" line after it is skipped. Padding is kept: `nz` trims. */
async function tsvView(conn: DuckDBConnection, view: string, file: string) {
  const path = join(rawDir, file);
  const [header, updated] = readFileSync(path, 'utf8').split('\n', 2);
  if (!header?.startsWith('#') || !updated?.startsWith('# Updated')) throw new Error(`raw/gcat/${file}: expected a # header line, then "# Updated"`);
  const names = header.slice(1).split('\t').map((name) => `'${sql(name.trim())}'`);
  await conn.run(
    `CREATE VIEW ${view} AS SELECT * FROM read_csv('${sql(path)}', delim = '\t', header = false, skip = 2, quote = '', escape = '', ` +
      `all_varchar = true, null_padding = false, strict_mode = true, names = [${names.join(', ')}])`,
  );
}

// ---------------------------------------------------------------- build

const info = await fetchAll();
const instance = await DuckDBInstance.create(':memory:');
const conn = await instance.connect();
const writer = `DuckDB ${await one(conn, 'SELECT version()')}`;
const failures: string[] = [];
const fail = (message: string) => {
  failures.push(message);
  console.error(`FAIL ${message}`);
};

for (const [view, path] of Object.entries(FILES)) await tsvView(conn, view, path.split('/').pop()!);
// `-` and blank are null; everything else is the trimmed text.
await conn.run(`CREATE MACRO nz(x) AS nullif(nullif(trim(x), '-'), '')`);
await conn.run(`CREATE VIEW objects AS SELECT * FROM satcat UNION ALL SELECT * FROM satcat100k`);
await conn.run(`CREATE VIEW payloads AS SELECT * FROM psatcat UNION ALL SELECT * FROM psatcat100k`);

// Keys that must not repeat, or a join would multiply rows.
for (const [table, key] of [['objects', 'JCAT'], ['payloads', 'JCAT'], ['launch', 'Launch_Tag'], ['orgs', 'Code'], ['sites', 'Site']]) {
  const repeats = await rows(conn, `SELECT nz(${key}) FROM ${table} GROUP BY 1 HAVING count(*) > 1 LIMIT 10`);
  if (repeats.length > 0) fail(`${table}.${key} repeats: ${repeats.map((row) => row[0]).join(', ')}`);
}

// Dropped: spurious (Z), blank type, and ERR rows.
const dropWhere = `substr(Type, 1, 1) IN ('Z', ' ', '-') OR nz(Type) IS NULL OR replace(nz(Status), '?', '') = 'ERR'`;
const dropped = await rows(conn, `SELECT nz(JCAT), nz(Type), nz(Status) FROM objects WHERE ${dropWhere} ORDER BY 1`);
console.log(`Dropped ${dropped.length} rows (type Z, a blank type, or status ERR): ${dropped.map((row) => row[0]).join(' ')}`);

// One row per kept object, with its payload and launch rows beside it.
await conn.run(`
  CREATE TABLE base AS
  SELECT o.*, p.Category AS p_category, p.Class AS p_class,
         l.Launch_Tag AS l_tag, l.Launch_Date AS l_date, l.LV_Type AS l_vehicle, l.Launch_Site AS l_site, l.Agency AS l_agency
  FROM objects o
  LEFT JOIN payloads p ON nz(p.JCAT) = nz(o.JCAT)
  LEFT JOIN launch l ON nz(l.Launch_Tag) = nz(o.Launch_Tag)
  WHERE NOT (${dropWhere})`);
const noLaunch = await rows(conn, `SELECT nz(JCAT), nz(Launch_Tag) FROM base WHERE l_tag IS NULL LIMIT 20`);
if (noLaunch.length > 0) fail(`objects whose launch tag isn't in the launch list: ${noLaunch.map((row) => row.join(' ')).join(', ')}`);
// The table joins each object to its launch time; one without would vanish.
const noLaunchTime = await rows(conn, `SELECT nz(JCAT), nz(Launch_Tag) FROM base WHERE l_tag IS NOT NULL AND nz(l_date) IS NULL LIMIT 20`);
if (noLaunchTime.length > 0) fail(`objects whose launch has no date: ${noLaunchTime.map((row) => row.join(' ')).join(', ')}`);
const payloadsWithout = Number(await one(conn, `SELECT count(*) FROM base WHERE substr(Type, 1, 1) = 'P' AND p_category IS NULL AND p_class IS NULL`));
console.log(`Payloads with no row in the payload files (purpose and sector null): ${payloadsWithout}`);

// ---- dates: every distinct string, parsed once
await conn.run(`CREATE TABLE dates (raw VARCHAR PRIMARY KEY, value VARCHAR, precision VARCHAR, uncertain BOOLEAN)`);
const dateRows: (string | boolean)[][] = [];
const badDates: string[] = [];
for (const [column, launchTime] of [['DDate', false], ['l_date', true]] as const) {
  for (const [raw] of await rows(conn, `SELECT DISTINCT nz(${column}) FROM base WHERE nz(${column}) IS NOT NULL`)) {
    let parsed: VagueDate;
    try {
      parsed = parseVagueDate(raw as string);
    } catch (error) {
      badDates.push(`${column} ${(error as Error).message}`);
      continue;
    }
    if (launchTime) {
      if (parsed.precision !== 'minute' && parsed.precision !== 'second') badDates.push(`a launch time that isn't to the minute or second: ${JSON.stringify(raw)}`);
    }
    dateRows.push([raw as string, parsed.value, parsed.precision, parsed.uncertain]);
  }
}
badDates.forEach(fail);
await insert(conn, 'dates', [...new Map(dateRows.map((row) => [row[0], row])).values()]);

// ---- words: every distinct code, decoded once; what isn't covered fails
await conn.run(`CREATE TABLE words (kind VARCHAR, raw VARCHAR, word VARCHAR, PRIMARY KEY (kind, raw))`);
const orgNames = new Map<string, { short: string | null; english: string | null }>();
for (const [code, short, english] of await rows(conn, `SELECT nz(Code), nz(ShortName), nz(ShortEName) FROM orgs`)) {
  orgNames.set(code as string, { short: short as string | null, english: english as string | null });
}
const siteNames = new Map<string, string | null>();
for (const [code, short] of await rows(conn, `SELECT nz(Site), nz(ShortName) FROM sites`)) siteNames.set(code as string, short as string | null);

const strip = (code: string) => code.replace(/[?*]+$/, '');
const fromTable = (table: Record<string, string>) => (raw: string) => table[strip(raw)];
const org = (overrides: Record<string, string>) => (raw: string) => {
  const halves = raw.split('/').map((half) => {
    const code = strip(half);
    const found = orgNames.get(code);
    return overrides[code] ?? found?.english ?? found?.short ?? undefined;
  });
  return halves.every((half) => half !== undefined) ? halves.join('/') : undefined;
};
/** Kind → the base column's expression, and its decoder (undefined = not covered). */
const KINDS: Record<string, [string, (raw: string) => string | undefined]> = {
  object_type: [`substr(Type, 1, 1)`, fromTable(OBJECT_TYPE)],
  object_detail: [`nullif(nullif(substr(Type, 4, 1), ' '), '-')`, fromTable(OBJECT_DETAIL)],
  purpose: [`CASE WHEN substr(Type, 1, 1) = 'P' THEN nz(p_category) END`, (raw) => PURPOSE[strip(raw.split('/')[0]!)]],
  sector: [
    `CASE WHEN substr(Type, 1, 1) = 'P' THEN nz(p_class) END`,
    (raw) => {
      const words = [...strip(raw)].map((letter) => SECTOR[letter]);
      return words.every((word) => word !== undefined) ? words.join('/') : undefined;
    },
  ],
  status: [`nz(Status)`, fromTable(STATUS)],
  orbit: [`nz(OpOrbit)`, (raw) => ORBIT[strip(raw)]?.[0]],
  orbit_class: [`nz(OpOrbit)`, (raw) => ORBIT[strip(raw)]?.[1]],
  country: [`nz(State)`, org(OUR_NAMES.country)],
  owner: [`nz(Owner)`, org({})],
  manufacturer: [`nz(Manufacturer)`, org({})],
  launch_agency: [`nz(l_agency)`, org({})],
  launch_site: [
    `nz(l_site)`,
    (raw) => {
      const code = strip(raw);
      return OUR_NAMES.site[code] ?? siteNames.get(code) ?? undefined;
    },
  ],
};
const wordRows: string[][] = [];
for (const [kind, [expression, decode]] of Object.entries(KINDS)) {
  const uncovered: string[] = [];
  for (const [raw] of await rows(conn, `SELECT DISTINCT ${expression} AS raw FROM base WHERE raw IS NOT NULL ORDER BY 1`)) {
    const word = decode(raw as string);
    if (word === undefined) uncovered.push(raw as string);
    else wordRows.push([kind, raw as string, word]);
  }
  if (uncovered.length > 0) fail(`${kind}: no word for ${uncovered.map((code) => JSON.stringify(code)).join(', ')} (gcat-codes.ts, or GCAT's orgs and sites tables)`);
}
await insert(conn, 'words', wordRows);

if (failures.length > 0) throw new Error(`${failures.length} problem(s) above; nothing was written`);

// ---- the table
const word = (kind: string) => `(SELECT word FROM words w WHERE w.kind = '${kind}' AND w.raw = ${KINDS[kind]![0]})`;
// Span is written `0.0`, mass `0`.
const zeroNulled = await rows(conn, `SELECT count(*) FILTER (WHERE CAST(nz(Mass) AS DOUBLE) = 0), count(*) FILTER (WHERE CAST(nz(Span) AS DOUBLE) = 0) FROM base`);
console.log(`Nulled zeros: mass ${zeroNulled[0]![0]}, span ${zeroNulled[0]![1]}`);
await conn.run(`
  CREATE TABLE gcat AS
  SELECT
    nz(JCAT) AS jcat,
    -- NNA: no number assigned. Any other non-number fails the cast.
    CASE WHEN nz(Satcat) = 'NNA' THEN NULL ELSE CAST(nz(Satcat) AS INTEGER) END AS satcat_no,
    nz(Piece) AS cospar,
    nz(Launch_Tag) AS launch_tag,
    nz(Name) AS name,
    ${word('object_type')} AS object_type,
    ${word('object_detail')} AS object_detail,
    substr(Type, 2, 1) = '${CREWED_LETTER}' AS crewed,
    substr(Type, 11, 1) = '${MEGACONSTELLATION_LETTER}' AS megaconstellation,
    ${word('purpose')} AS purpose,
    ${word('sector')} AS sector,
    CAST(CAST(lt.value AS TIMESTAMP) AS DATE) AS launch_date,
    CAST(lt.value AS TIMESTAMP) AS launch_time,
    lt.precision AS launch_time_precision,
    nz(l_vehicle) AS vehicle,
    ${word('launch_site')} AS launch_site,
    ${word('launch_agency')} AS launch_agency,
    ${word('owner')} AS owner,
    ${word('country')} AS country,
    ${word('manufacturer')} AS manufacturer,
    ${word('status')} AS status,
    CAST(CAST(dd.value AS TIMESTAMP) AS DATE) AS end_date,
    CASE WHEN dd.precision IN ('minute', 'second') THEN 'day' ELSE dd.precision END AS end_date_precision,
    dd.uncertain AS end_date_uncertain,
    -- Only for a return dated to the day, and not before the launch (a few
    -- cargo items' phases end before the launch list's date).
    CASE WHEN replace(nz(Status), '?', '') IN (${RETURNED.map(literal).join(', ')}) AND dd.precision IN ('day', 'minute', 'second')
              AND CAST(CAST(dd.value AS TIMESTAMP) AS DATE) >= CAST(CAST(lt.value AS TIMESTAMP) AS DATE)
         THEN CAST(CAST(CAST(dd.value AS TIMESTAMP) AS DATE) - CAST(CAST(lt.value AS TIMESTAMP) AS DATE) AS INTEGER) END AS days_in_orbit,
    ${word('orbit')} AS orbit,
    ${word('orbit_class')} AS orbit_class,
    CAST(nz(Perigee) AS DOUBLE) AS perigee_km,
    CAST(nz(Apogee) AS DOUBLE) AS apogee_km,
    CAST(nz(Inc) AS DOUBLE) AS inclination_deg,
    nullif(CAST(nz(Mass) AS DOUBLE), 0) AS mass_kg,
    CASE WHEN nullif(CAST(nz(Mass) AS DOUBLE), 0) IS NOT NULL THEN trim(MassFlag) = '?' END AS mass_estimated,
    nullif(CAST(nz(Span) AS DOUBLE), 0) AS span_m,
    nz(Bus) AS bus,
    nz(Shape) AS shape,
    nz(AltNames) AS alt_names
  FROM base
  JOIN dates lt ON lt.raw = nz(l_date)
  LEFT JOIN dates dd ON dd.raw = nz(DDate)
  ORDER BY launch_date, jcat`);

const tmp = `${output}.tmp`;
const metadata: Record<string, string> = {
  'tycho.credit': CREDIT,
  'tycho.fetched': info.fetched,
  'tycho.license': LICENSE,
  'tycho.citation': `McDowell, Jonathan C., 2020. General Catalog of Artificial Space Objects, Release ${info.release}, ${HOME}`,
  'tycho.release': info.release,
  'tycho.data_update': info.dataUpdate,
  'tycho.source': [`${HOME}/`, ...Object.values(FILES).map((path) => `${HOME}/tsv/${path}`)].join(' '),
};
await conn.run(
  `COPY gcat TO '${sql(tmp)}' (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE ${ROW_GROUP_SIZE}, ` +
    `KV_METADATA {${Object.entries(metadata).map(([key, value]) => `'${sql(key)}': '${sql(value)}'`).join(', ')}})`,
);
// Checked as the temp file, so a failed rebuild leaves the last good one.
await conn.run(`CREATE VIEW sample AS SELECT * FROM read_parquet('${sql(tmp)}')`);

// ---- checks, each failing the build
const check = (ok: boolean, message: string) => (ok ? console.log(`ok   ${message}`) : fail(message));
const count = Number(await one(conn, `SELECT count(*) FROM sample`));
const bytes = statSync(tmp).size;
check(count > 70_000, `more than 70,000 rows (${count.toLocaleString('en-US')})`);
check(Number(await one(conn, `SELECT count(*) - count(DISTINCT jcat) FROM sample`)) === 0, 'jcat is unique');
check(bytes < MAX_BYTES, `under 25 MiB (${(bytes / 1024 / 1024).toFixed(2)} MiB)`);
for (const column of ['jcat', 'cospar', 'launch_tag', 'name', 'object_type', 'crewed', 'megaconstellation', 'launch_date', 'launch_time', 'launch_time_precision', 'vehicle', 'launch_site', 'launch_agency', 'owner', 'country', 'status']) {
  const nulls = Number(await one(conn, `SELECT count(*) - count(${column}) FROM sample`));
  check(nulls === 0, `${column} is never null${nulls ? ` (${nulls} are)` : ''}`);
}
const roadster = await rows(conn, `SELECT name, status FROM sample WHERE name ILIKE '%Roadster%'`);
check(roadster.length === 1 && roadster[0]![1] === 'Left for deep space', `"Roadster" finds one row, left for deep space (${JSON.stringify(roadster)})`);
const updateYear = Number(info.dataUpdate.slice(0, 4));
// The data update's own year is held to the share of it that has passed.
const yearShare = (Date.parse(info.dataUpdate) - Date.UTC(updateYear, 0, 1)) / (365.25 * 86_400_000);
const starlink = new Map((await rows(conn, `SELECT year(launch_date), count(*) FROM sample WHERE object_type = 'Payload' AND name ILIKE 'Starlink%' GROUP BY 1`)).map(([year, n]) => [Number(year), Number(n)]));
for (let year = 2020; year <= updateYear; year++) {
  const floor = year === updateYear ? Math.floor(800 * yearShare) : 800;
  check((starlink.get(year) ?? 0) > floor, `Starlink payloads in ${year} over ${floor} (${starlink.get(year) ?? 0})`);
}
for (const country of ['United States', 'Soviet Union']) {
  const years = new Set((await rows(conn, `SELECT DISTINCT year(launch_date) FROM sample WHERE object_type = 'Payload' AND country = '${country}'`)).map(([year]) => Number(year)));
  const missing = Array.from({ length: 12 }, (_, i) => 1958 + i).filter((year) => !years.has(year));
  check(missing.length === 0, `${country}: a payload in every year from 1958 to 1969${missing.length ? ` (none in ${missing.join(', ')})` : ''}`);
}
const debris = await rows(conn, `SELECT launch_tag, count(*) FROM sample WHERE object_type = 'Debris' GROUP BY 1 ORDER BY 2 DESC LIMIT 1`);
check(debris[0]?.[0] === '1999-025', `the launch with the most debris is 1999-025 (${debris[0]?.join(': ')})`);

// ---- what docs/data.md reads
console.log(`\n${SAMPLE}: ${count.toLocaleString('en-US')} rows, ${(bytes / 1024 / 1024).toFixed(2)} MiB; GCAT ${info.release}, data update ${info.dataUpdate}`);
console.log('Null share by column:');
for (const [name, type] of await rows(conn, `SELECT column_name, column_type FROM (DESCRIBE sample)`)) {
  const nulls = Number(await one(conn, `SELECT count(*) - count("${name}") FROM sample`));
  console.log(`  ${String(name).padEnd(24)} ${String(type).padEnd(10)} ${((100 * nulls) / count).toFixed(1)}%`);
}

if (failures.length > 0) {
  rmSync(tmp);
  throw new Error(`${failures.length} check(s) failed; ${SAMPLE} was left as it was`);
}
renameSync(tmp, output);

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
manifest[SAMPLE] = {
  rows: count,
  bytes,
  sha256: sha256(readFileSync(output)),
  source: `GCAT ${info.release}, data update ${info.dataUpdate} (${HOME}): satcat, satcat100k, psatcat, psatcat100k, launch, orgs, sites`,
  credit: CREDIT,
  citation: metadata['tycho.citation'],
  license: LICENSE,
  release: info.release,
  dataUpdate: info.dataUpdate,
  fetched: info.fetched,
  sources: info.files,
  dropped: dropped.map((row) => row[0]),
  rowGroups: Number(await one(conn, `SELECT num_row_groups FROM parquet_file_metadata('${sql(output)}')`)),
  writer: `${writer}, ZSTD, ROW_GROUP_SIZE ${ROW_GROUP_SIZE}, sorted by launch_date then jcat`,
};
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`MANIFEST.json: ${SAMPLE} recorded`);
