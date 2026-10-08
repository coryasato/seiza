// Fetches the bright end of Gaia DR3 from its HATS-partitioned Parquet on AWS
// Open Data (s3://stpubdata/gaia/, anonymous) into data/raw/gaia/: one small
// Parquet file per HATS partition, holding only the stars brighter than
// RAW_CUT and only the columns PLAN.md names. prep-gaia.sql picks the final
// magnitude cut from these, so the cut can move below RAW_CUT without a
// refetch.
//
// Usage: node apps/tycho/data/fetch_gaia.ts [--refresh] [--jobs 8]
//
// The filter is pushed down to each partition, but it can't skip much: the
// partitions are sorted by source_id (sky position), so every row group holds
// stars of every magnitude, and DuckDB reads the ten columns of all 1.8
// billion rows (~45 bytes a row, ~90 GB) to keep ~2%. That's why the extracts
// are kept: partitions already on disk are skipped, so an interrupted fetch
// resumes, and a rerun reuses them. fetch.json is written last.

import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api';

export const SOURCE = 's3://stpubdata/gaia/gaia_dr3/public/hats/gaia';
const HTTPS = 'https://stpubdata.s3.amazonaws.com/gaia/gaia_dr3/public/hats/gaia';
/** Stars kept in the raw extracts: phot_g_mean_mag below this (36.9 M in DR3). */
export const RAW_CUT = 15;
/** PLAN.md's Gaia columns, as stored; prep-gaia.sql adds distance_pc. */
export const COLUMNS = [
  'source_id', 'ra', 'dec', 'parallax', 'pmra', 'pmdec', 'phot_g_mean_mag', 'bp_rp', 'radial_velocity', 'teff_gspphot',
];

const dataDir = dirname(fileURLToPath(import.meta.url));
export const rawDir = join(dataDir, 'raw/gaia');
export const fetchInfoPath = join(rawDir, 'fetch.json');
/** Written when a fetch starts, so a resumed fetch keeps its first day. */
const startedPath = join(rawDir, 'started.json');

export interface GaiaFetchInfo {
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

function option(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index > 0 ? process.argv[index + 1] : undefined;
}

const extractName = (p: Partition) => `Norder=${p.order}-Npix=${p.pixel}.parquet`;
/** HATS directory layout: Dir is the pixel rounded down to 10,000. */
const partitionUrl = (p: Partition) =>
  `${SOURCE}/dataset/Norder=${p.order}/Dir=${Math.floor(p.pixel / 10_000) * 10_000}/Npix=${p.pixel}.parquet`;

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

async function extract(conn: DuckDBConnection, p: Partition): Promise<number> {
  const path = join(rawDir, extractName(p));
  const temp = `${path}.tmp`;
  for (let attempt = 1; ; attempt++) {
    try {
      await conn.run(
        `COPY (SELECT ${COLUMNS.join(', ')} FROM read_parquet('${partitionUrl(p)}') WHERE phot_g_mean_mag < ${RAW_CUT}) ` +
          `TO '${temp}' (FORMAT parquet, COMPRESSION zstd)`,
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

async function rowsIn(conn: DuckDBConnection, path: string): Promise<number> {
  const rows = (await conn.runAndReadAll(`SELECT num_rows FROM parquet_file_metadata('${path}')`)).getRows();
  return Number(rows[0]?.[0]);
}

export async function fetchGaia(options: { refresh?: boolean; jobs?: number } = {}): Promise<GaiaFetchInfo> {
  if (options.refresh) rmSync(rawDir, { recursive: true, force: true });
  mkdirSync(rawDir, { recursive: true });
  try {
    const info = JSON.parse(readFileSync(fetchInfoPath, 'utf8')) as GaiaFetchInfo;
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

  const jobs = options.jobs ?? 8;
  const instance = await DuckDBInstance.create(':memory:', { threads: String(Math.max(4, jobs)) });
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
  const info: GaiaFetchInfo = { source: SOURCE, fetched, rawCut: RAW_CUT, partitions: all.length, rows: total, catalogRows };
  const temp = `${fetchInfoPath}.tmp`;
  writeFileSync(temp, `${JSON.stringify(info, null, 2)}\n`);
  renameSync(temp, fetchInfoPath);
  console.log(`gaia: ${total} rows at G < ${RAW_CUT} from ${all.length} partitions, fetched ${fetched}`);
  return info;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await fetchGaia({ refresh: process.argv.includes('--refresh'), jobs: Number(option('jobs') ?? 8) });
}
