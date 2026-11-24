// Builds the Gaia sample stars.ts reads, data/gaia-dr3-bright.parquet
// (gitignored): Gaia DR3's stars brighter than G 14.5, eleven columns, sorted
// by source_id. data/MANIFEST.json (committed) pins it by its bytes. What it
// holds, and why it's this cut: docs/data.md, "The sky".
//
// Usage: node apps/kirkwood/data/gaia.ts [--check] [--refresh] [--jobs 8] [--cut 14.5]
//
//   (nothing)  fetches what's missing, then writes the file and its entry in
//              the manifest
//   --check    builds it again from the extracts and fails unless its bytes
//              are the manifest's and the disk's; fetches nothing (it fails
//              without the extracts and the archive's count), keeps nothing
//   --refresh  fetches everything again (~90 GB read; docs/data.md)
//   --cut      moves the magnitude cut, at most the extracts' RAW_CUT, without
//              a refetch; a new cut is a new file and a new manifest entry
//
// The fetch reads Gaia DR3's HATS-partitioned Parquet on AWS Open Data
// (s3://stpubdata/gaia/, anonymous) into data/raw/gaia/: one small Parquet
// file per partition, holding only the stars brighter than RAW_CUT and only
// the columns below. The filter is pushed down to each partition, but it
// can't skip much: the partitions are sorted by source_id (sky position), so
// every row group holds stars of every magnitude, and DuckDB reads the ten
// columns of all 1.8 billion rows (~90 GB) to keep ~2%. That's why the
// extracts are kept: partitions already on disk are skipped, so an
// interrupted fetch resumes, and a rerun reads nothing. fetch.json is
// written last.
//
// The file was first built by Tycho on 2026-10-07, when it was Tycho's big
// sample; gaia.sql's metadata keys are still `tycho.*`, so a rebuild is the
// same bytes. Native DuckDB, this directory's one dependency, is installed
// apart: npm install --prefix apps/kirkwood/data (`just kirkwood gaia` does).

import { createHash } from 'node:crypto';
import { createReadStream, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE = 's3://stpubdata/gaia/gaia_dr3/public/hats/gaia';
const HTTPS = 'https://stpubdata.s3.amazonaws.com/gaia/gaia_dr3/public/hats/gaia';
/** Stars kept in the raw extracts: phot_g_mean_mag below this (36.9 M in DR3). */
const RAW_CUT = 15;
/** The sample's cut: 25,067,889 stars at G < 14.5. */
const CUT = 14.5;
/** The columns fetched, as stored; gaia.sql adds distance_pc. */
const COLUMNS = ['source_id', 'ra', 'dec', 'parallax', 'pmra', 'pmdec', 'phot_g_mean_mag', 'bp_rp', 'radial_velocity', 'teff_gspphot'];
/** The sample's row-group size, as Tycho chose it for paging; kept so a rebuild is the same bytes. */
const ROW_GROUP = 61_440;
const NAME = 'gaia-dr3-bright.parquet';

const dataDir = dirname(fileURLToPath(import.meta.url));
const manifestPath = join(dataDir, 'MANIFEST.json');
const rawDir = join(dataDir, 'raw/gaia');
const fetchInfoPath = join(rawDir, 'fetch.json');
/** Written when a fetch starts, so a resumed fetch keeps its first day. */
const startedPath = join(rawDir, 'started.json');

interface FetchInfo {
  source: string;
  /** UTC date (YYYY-MM-DD) the fetch started, kept across resumes. */
  fetched: string;
  rawCut: number;
  partitions: number;
  /** Rows in the extracts (stars brighter than rawCut). */
  rows: number;
  /** Rows in the catalog, from its hats.properties. */
  catalogRows: number;
}
interface Partition {
  order: number;
  pixel: number;
}

// Native DuckDB, named by a string so the data's typecheck doesn't need it
// installed (as in stars.ts).
interface Connection {
  run(sql: string): Promise<unknown>;
  runAndReadAll(sql: string): Promise<{ getRows(): unknown[][] }>;
}
interface DuckDB {
  DuckDBInstance: { create(path: string, options?: Record<string, string>): Promise<{ connect(): Promise<Connection> }> };
}
const duckdb = (await import('@duckdb/node-api' as string).catch(() => {
  throw new Error('no native DuckDB: npm install --prefix apps/kirkwood/data');
})) as DuckDB;

const option = (name: string): string | undefined => {
  const index = process.argv.indexOf(`--${name}`);
  return index > 0 ? process.argv[index + 1] : undefined;
};
/** A SQL string literal's contents: single quotes doubled. */
const sqlText = (value: string) => value.replaceAll("'", "''");

async function sha256Of(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const piece of createReadStream(path)) hash.update(piece as Buffer);
  return hash.digest('hex');
}
async function scalar(conn: Connection, sql: string): Promise<number> {
  return Number((await conn.runAndReadAll(sql)).getRows()[0]?.[0]);
}

// --- The fetch.

const extractName = (p: Partition) => `Norder=${p.order}-Npix=${p.pixel}.parquet`;
/** HATS directory layout: Dir is the pixel rounded down to 10,000. */
const partitionUrl = (p: Partition) => `${SOURCE}/dataset/Norder=${p.order}/Dir=${Math.floor(p.pixel / 10_000) * 10_000}/Npix=${p.pixel}.parquet`;

async function text(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status} ${response.statusText}`);
  return response.text();
}

async function partitions(): Promise<Partition[]> {
  const lines = (await text(`${HTTPS}/partition_info.csv`)).trim().split('\n');
  if (lines[0] !== 'Norder,Npix') throw new Error(`partition_info.csv: unexpected header ${lines[0]}`);
  return lines.slice(1).map((line) => {
    const [order, pixel] = line.split(',').map(Number);
    return { order: order!, pixel: pixel! };
  });
}

const rowsIn = (conn: Connection, path: string) => scalar(conn, `SELECT num_rows FROM parquet_file_metadata('${sqlText(path)}')`);

async function extract(conn: Connection, p: Partition): Promise<number> {
  const path = join(rawDir, extractName(p));
  const temp = `${path}.tmp`;
  for (let attempt = 1; ; attempt++) {
    try {
      await conn.run(
        `COPY (SELECT ${COLUMNS.join(', ')} FROM read_parquet('${partitionUrl(p)}') WHERE phot_g_mean_mag < ${RAW_CUT}) ` +
          `TO '${sqlText(temp)}' (FORMAT parquet, COMPRESSION zstd)`,
      );
      renameSync(temp, path);
      return await rowsIn(conn, path);
    } catch (error) {
      rmSync(temp, { force: true });
      if (attempt >= 5) throw error;
      const wait = 2 ** attempt * 1000;
      console.warn(`  ${extractName(p)} failed (${(error as Error).message}); retrying in ${wait / 1000} s`);
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
}

async function fetchGaia(refresh: boolean, jobs: number, check: boolean): Promise<FetchInfo> {
  if (check) {
    try {
      return JSON.parse(readFileSync(fetchInfoPath, 'utf8')) as FetchInfo;
    } catch {
      throw new Error(`--check needs the extracts, and ${fetchInfoPath} isn't there: run without --check to fetch them (~90 GB read)`);
    }
  }
  mkdirSync(rawDir, { recursive: true });
  if (refresh) {
    // Only the files this script writes: the extracts, their temps, and its notes.
    for (const name of readdirSync(rawDir)) {
      if (/^Norder=.*\.parquet(\.tmp)?$/.test(name) || ['fetch.json', 'started.json', 'archive-counts.json'].includes(name)) rmSync(join(rawDir, name));
    }
  }
  try {
    const info = JSON.parse(readFileSync(fetchInfoPath, 'utf8')) as FetchInfo;
    console.log(`gaia: using the fetch from ${info.fetched} (${info.rows} rows at G < ${info.rawCut}, ${info.partitions} partitions); --refresh to fetch again`);
    return info;
  } catch {
    // Not fetched yet, or interrupted: fetch the missing partitions.
  }
  let fetched: string;
  try {
    fetched = (JSON.parse(readFileSync(startedPath, 'utf8')) as { fetched: string }).fetched;
  } catch {
    fetched = new Date().toISOString().slice(0, 10);
    writeFileSync(startedPath, `${JSON.stringify({ fetched })}\n`);
  }
  const catalogRows = Number(/^hats_nrows=(\d+)$/m.exec(await text(`${HTTPS}/hats.properties`))?.[1]);
  const all = await partitions();
  const done = new Set(readdirSync(rawDir).filter((name) => name.endsWith('.parquet')));
  const todo = all.filter((p) => !done.has(extractName(p)));
  console.log(`gaia: ${all.length} partitions, ${todo.length} to fetch (G < ${RAW_CUT}, ${COLUMNS.length} columns)`);

  const instance = await duckdb.DuckDBInstance.create(':memory:', { threads: String(Math.max(4, jobs)) });
  const setup = await instance.connect();
  await setup.run("INSTALL httpfs; LOAD httpfs; SET s3_region = 'us-east-1'; SET http_retries = 5;");
  const started = performance.now();
  let next = 0;
  let finished = 0;
  let rows = 0;
  await Promise.all(
    Array.from({ length: jobs }, async () => {
      const conn = await instance.connect();
      while (next < todo.length) {
        const p = todo[next++]!;
        // Not `rows += await …`: that reads `rows` before the await, and the
        // other jobs' additions meanwhile would be lost.
        const extracted = await extract(conn, p);
        rows += extracted;
        finished++;
        if (finished % 20 === 0 || finished === todo.length) {
          const elapsed = (performance.now() - started) / 1000;
          const eta = (elapsed / finished) * (todo.length - finished);
          console.log(`  ${finished}/${todo.length} partitions, ${rows} rows, ${(elapsed / 60).toFixed(1)} min, ~${(eta / 60).toFixed(0)} min left`);
        }
      }
    }),
  );

  let total = 0;
  for (const p of all) total += await rowsIn(setup, join(rawDir, extractName(p)));
  const info: FetchInfo = { source: SOURCE, fetched, rawCut: RAW_CUT, partitions: all.length, rows: total, catalogRows };
  const temp = `${fetchInfoPath}.tmp`;
  writeFileSync(temp, `${JSON.stringify(info, null, 2)}\n`);
  renameSync(temp, fetchInfoPath);
  console.log(`gaia: ${total} rows at G < ${RAW_CUT} from ${all.length} partitions, fetched ${fetched}`);
  return info;
}

// --- The sample.

/** The ESA archive's count of DR3 sources under `cut`, asked once and kept
 *  next to the extracts: the build checks the extracts hold every one. */
async function archiveCount(cut: number, check: boolean): Promise<number> {
  const path = join(rawDir, 'archive-counts.json');
  let counts: Record<string, number> = {};
  try {
    counts = JSON.parse(readFileSync(path, 'utf8')) as Record<string, number>;
  } catch {
    // Not asked yet.
  }
  if (counts[cut] === undefined) {
    if (check) throw new Error(`--check asks nothing of the ESA archive, and ${path} has no count for G < ${cut}: run without --check`);
    const body = new URLSearchParams({
      REQUEST: 'doQuery',
      LANG: 'ADQL',
      FORMAT: 'csv',
      QUERY: `SELECT COUNT(*) FROM gaiadr3.gaia_source WHERE phot_g_mean_mag < ${cut}`,
    });
    const response = await fetch('https://gea.esac.esa.int/tap-server/tap/sync', { method: 'POST', body });
    if (!response.ok) throw new Error(`ESA archive count: ${response.status} ${response.statusText}`);
    const count = Number((await response.text()).trim().split('\n').at(-1));
    if (!Number.isInteger(count)) throw new Error('ESA archive count: not a number');
    counts[cut] = count;
    writeFileSync(path, `${JSON.stringify(counts, null, 2)}\n`);
  }
  return counts[cut]!;
}

const check = process.argv.includes('--check');
const cut = Number(option('cut') ?? CUT);
const jobs = Number(option('jobs') ?? 8);
if (!Number.isInteger(jobs) || jobs < 1) throw new Error(`--jobs ${option('jobs')}: a whole number of jobs, at least 1`);
if (!Number.isFinite(cut)) throw new Error(`--cut ${option('cut')}: a G magnitude, at most ${RAW_CUT}`);
if (check && process.argv.includes('--refresh')) throw new Error('--check and --refresh: a check fetches nothing');
// A check compares against the pinned file at its end: asked first, so a
// missing one fails now, not after minutes of building.
if (check && !statSync(join(dataDir, NAME), { throwIfNoEntry: false })) {
  throw new Error(`--check compares against data/${NAME}, which isn't there: build it with \`just kirkwood gaia\`, or copy it from where it was built`);
}
const info = await fetchGaia(process.argv.includes('--refresh'), jobs, check);
if (!(cut <= info.rawCut)) throw new Error(`--cut ${cut} is above the extracts' G < ${info.rawCut}`);

// gaia.sql's paths are relative to this directory.
process.chdir(dataDir);
const conn = await (await duckdb.DuckDBInstance.create(':memory:')).connect();
const [build, write] = readFileSync(join(dataDir, 'gaia.sql'), 'utf8').replaceAll('${cut}', String(cut)).split('-- @write\n');
await conn.run(`SET VARIABLE archive_rows = ${await archiveCount(cut, check)}`);
let started = performance.now();
await conn.run(build!);
console.log(`gaia.sql: ${((performance.now() - started) / 1000).toFixed(1)} s`);
const copies = (await scalar(conn, `SELECT count(*) FROM read_parquet('raw/gaia/*.parquet') WHERE phot_g_mean_mag < ${cut}`)) - (await scalar(conn, 'SELECT count(*) FROM gaia'));

// Written beside the sample and renamed over it only once whole, so a run
// stopped halfway leaves the pinned file as it was; a check's copy is never
// kept, and neither is a temp a failure left.
const path = join(dataDir, check ? 'gaia-check.parquet' : 'gaia-dr3-bright.tmp.parquet');
let entry;
try {
  started = performance.now();
  await conn.run(write!.replaceAll('${out}', sqlText(path)).replaceAll('${row_group}', String(ROW_GROUP)));
  console.log(`  ${NAME}: ${((performance.now() - started) / 1000).toFixed(1)} s`);
  const writer = `DuckDB ${(await conn.runAndReadAll('SELECT version()')).getRows()[0]?.[0]}`;
  entry = {
    rows: await rowsIn(conn, path),
    bytes: statSync(path).size,
    sha256: await sha256Of(path),
    source: info.source,
    fetched: info.fetched,
    rowGroups: await scalar(conn, `SELECT num_row_groups FROM parquet_file_metadata('${sqlText(path)}')`),
    writer: `${writer}, ZSTD, ROW_GROUP_SIZE ${ROW_GROUP}, sorted by source_id`,
    notes: [
      `magnitude cut phot_g_mean_mag < ${cut}; the row count matches the ESA archive's for the cut`,
      `${copies} duplicate rows in the HATS extracts (identical copies) dropped`,
      'distance_pc = 1000 / parallax where parallax > 0, else NULL',
    ],
  };
  if (!check) renameSync(path, join(dataDir, NAME));
} finally {
  rmSync(path, { force: true });
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
if (check) {
  const onDisk = await sha256Of(join(dataDir, NAME));
  console.log(`${NAME}: built ${entry.sha256}, on disk ${onDisk}`);
  if (onDisk !== entry.sha256 || JSON.stringify(manifest[NAME]) !== JSON.stringify(entry)) throw new Error("a second run doesn't write the same bytes, or the manifest's entry isn't this run's");
  console.log('check: the same bytes, and the same manifest');
} else {
  writeFileSync(manifestPath, `${JSON.stringify({ ...manifest, [NAME]: entry }, null, 2)}\n`);
  console.log(`${NAME}: ${entry.rows} rows, ${(entry.bytes / 2 ** 20).toFixed(1)} MiB, ${entry.rowGroups} row groups, sha256 ${entry.sha256}`);
}
