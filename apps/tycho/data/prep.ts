// Builds Tycho's sample data: fetches the raw catalogs (fetch_asteroids.ts,
// fetch_gaia.ts), runs prep.sql / prep-gaia.sql with native DuckDB, and
// writes MANIFEST.json (committed) with each file's rows, bytes, SHA-256,
// source, and fetch date, so every benchmark names the exact files it ran
// against.
//
// Usage: node apps/tycho/data/prep.ts [asteroids|gaia ...] [--refresh] [--jobs 8]
//                                     [--cut 14.5] [--bench 30720,122880]
// --cut moves Gaia's magnitude cut (at most fetch_gaia.ts's RAW_CUT);
// --bench also writes the Gaia sample at those row-group sizes to
// bench/gaia-rg<N>.parquet, for `just tycho paging --dataset gaia`.
// `just tycho data` runs this, then loads the Parquet into the local R2 that
// `wrangler dev` serves.

import { createHash } from 'node:crypto';
import { copyFileSync, createReadStream, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api';
import { fetchAsteroids, type FetchInfo } from './fetch_asteroids.ts';
import { fetchGaia, rawDir as gaiaRawDir, type GaiaFetchInfo } from './fetch_gaia.ts';

/** Gaia's magnitude cut: 25,067,889 stars at G < 14.5, PLAN.md's ~25 M target. */
const GAIA_CUT = 14.5;
/**
 * Gaia's row-group size (M7 part B, perf/results/2026-10-07-m7-gaia.md): a
 * page read costs the same 5.6 MB at 30,720 and 61,440 rows (DuckDB-Wasm's
 * readahead reaches its 4 MB step either way) and 22.4 MB from 122,880, while
 * each page's per-row-group setup halves with each doubling (next page 165.8 → 67.5 ms).
 */
const GAIA_ROW_GROUP = 61_440;

const dataDir = dirname(fileURLToPath(import.meta.url));
const manifestPath = join(dataDir, 'MANIFEST.json');

interface ManifestFile {
  rows: number;
  bytes: number;
  sha256: string;
  source: string;
  fetched: string;
  /** Parquet only. */
  rowGroups?: number;
  writer: string;
  notes?: string[];
}
type Manifest = Record<string, ManifestFile>;

/** A SQL string literal's contents: single quotes doubled. */
const sqlText = (value: string) => value.replaceAll("'", "''");

async function sha256(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

async function scalar(conn: DuckDBConnection, sql: string): Promise<number> {
  const value = (await conn.runAndReadAll(sql)).getRows()[0]?.[0];
  return Number(value);
}

async function prepAsteroids(conn: DuckDBConnection, info: FetchInfo): Promise<Manifest> {
  const sql = readFileSync(join(dataDir, 'prep.sql'), 'utf8').replaceAll('${fetched}', sqlText(info.fetched));
  mkdirSync(join(dataDir, 'fixtures'), { recursive: true });
  await conn.run(`SET VARIABLE api_count = ${info.count}`);
  const started = performance.now();
  await conn.run(sql);
  console.log(`prep.sql: ${((performance.now() - started) / 1000).toFixed(1)} s`);

  // Rows whose source first_obs was year-only (and so is NULL now), not rows
  // that had none: prep.sql's cast check allows only this pattern to drop.
  const yearOnly = await scalar(
    conn,
    "SELECT count(*) FROM asteroids WHERE spkid IN (SELECT spkid FROM typed WHERE regexp_full_match(r->>15, '\\d{4}-\\?\\?-\\?\\?'))",
  );
  const noFirstObs = await scalar(conn, 'SELECT count(*) FROM asteroids WHERE first_obs IS NULL');
  const parquet = join(dataDir, 'asteroids.parquet');
  const csv = join(dataDir, 'fixtures/asteroids.csv');
  const writer = `DuckDB ${(await conn.runAndReadAll('SELECT version()')).getRows()[0]?.[0]}`;
  const common = { source: info.source, fetched: info.fetched };
  return {
    'asteroids.parquet': {
      rows: await scalar(conn, `SELECT num_rows FROM parquet_file_metadata('${sqlText(parquet)}')`),
      bytes: statSync(parquet).size,
      sha256: await sha256(parquet),
      ...common,
      rowGroups: await scalar(conn, `SELECT num_row_groups FROM parquet_file_metadata('${sqlText(parquet)}')`),
      writer: `${writer}, ZSTD, ROW_GROUP_SIZE 30720, sorted by spkid`,
      notes: [
        `${yearOnly} rows have a year-only first_obs in the source ('YYYY-??-??'); stored as NULL`,
        `${noFirstObs - yearOnly} rows have no first_obs in the source`,
      ],
    },
    'fixtures/asteroids.csv': {
      rows: await scalar(conn, 'SELECT count(*) FROM fixture'),
      bytes: statSync(csv).size,
      sha256: await sha256(csv),
      ...common,
      writer: `${writer}, CSV with header; the asteroid rows, then fixtures-src/tricky_rows.csv`,
    },
  };
}

/** The ESA archive's count of DR3 sources under `cut`, asked once and kept
 *  next to the extracts: prep checks the extracts hold every one. */
async function archiveCount(cut: number): Promise<number> {
  const path = join(gaiaRawDir, 'archive-counts.json');
  let counts: Record<string, number> = {};
  try {
    counts = JSON.parse(readFileSync(path, 'utf8')) as Record<string, number>;
  } catch {
    // Not asked yet.
  }
  if (counts[cut] === undefined) {
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

async function prepGaia(conn: DuckDBConnection, info: GaiaFetchInfo, cut: number, bench: number[]): Promise<Manifest> {
  if (!(cut <= info.rawCut)) throw new Error(`--cut ${cut} is above the extracts' G < ${info.rawCut}`);
  const [build, write] = readFileSync(join(dataDir, 'prep-gaia.sql'), 'utf8').replaceAll('${cut}', String(cut)).split('-- @write\n');
  await conn.run(`SET VARIABLE archive_rows = ${await archiveCount(cut)}`);
  let started = performance.now();
  await conn.run(build!);
  console.log(`prep-gaia.sql: ${((performance.now() - started) / 1000).toFixed(1)} s`);
  const copies = (await scalar(conn, `SELECT count(*) FROM read_parquet('raw/gaia/*.parquet') WHERE phot_g_mean_mag < ${cut}`)) - (await scalar(conn, 'SELECT count(*) FROM gaia'));
  const writer = `DuckDB ${(await conn.runAndReadAll('SELECT version()')).getRows()[0]?.[0]}`;
  const outputs: [string, number][] = [['gaia-dr3-bright.parquet', GAIA_ROW_GROUP], ...bench.map((n): [string, number] => [`bench/gaia-rg${n}.parquet`, n])];
  mkdirSync(join(dataDir, 'bench'), { recursive: true });
  const files: Manifest = {};
  for (const [name, rowGroup] of outputs) {
    const path = join(dataDir, name);
    started = performance.now();
    if (name !== 'gaia-dr3-bright.parquet' && rowGroup === GAIA_ROW_GROUP) {
      // The sample itself; a clone on APFS, not a second 1.5 GB write.
      copyFileSync(join(dataDir, 'gaia-dr3-bright.parquet'), path);
      files[name] = { ...files['gaia-dr3-bright.parquet']! };
      continue;
    }
    await conn.run(write!.replaceAll('${out}', sqlText(path)).replaceAll('${row_group}', String(rowGroup)));
    console.log(`  ${name}: ${((performance.now() - started) / 1000).toFixed(1)} s`);
    files[name] = {
      rows: await scalar(conn, `SELECT num_rows FROM parquet_file_metadata('${sqlText(path)}')`),
      bytes: statSync(path).size,
      sha256: await sha256(path),
      source: info.source,
      fetched: info.fetched,
      rowGroups: await scalar(conn, `SELECT num_row_groups FROM parquet_file_metadata('${sqlText(path)}')`),
      writer: `${writer}, ZSTD, ROW_GROUP_SIZE ${rowGroup}, sorted by source_id`,
      notes: [
        `magnitude cut phot_g_mean_mag < ${cut}; the row count matches the ESA archive's for the cut`,
        `${copies} duplicate rows in the HATS extracts (identical copies) dropped`,
        'distance_pc = 1000 / parallax where parallax > 0, else NULL',
      ],
    };
  }
  return files;
}

const known = ['asteroids', 'gaia'];
/** Options that take a value; every other argument not starting with -- is a target. */
const valued = ['--jobs', '--cut', '--bench'];
const targets = process.argv.slice(2).filter((arg, index, args) => !arg.startsWith('--') && !valued.includes(args[index - 1] ?? ''));
for (const target of targets) {
  if (!known.includes(target)) throw new Error(`unknown target "${target}" (known: ${known.join(', ')})`);
}
const option = (name: string) => {
  const index = process.argv.indexOf(`--${name}`);
  return index > 0 ? process.argv[index + 1] : undefined;
};
const refresh = process.argv.includes('--refresh');

const instance = await DuckDBInstance.create();
const conn = await instance.connect();
let files: Manifest = {};
for (const target of targets.length ? targets : ['asteroids']) {
  if (target === 'asteroids') {
    const info = await fetchAsteroids({ refresh });
    // prep.sql's relative paths are relative to this directory.
    process.chdir(dataDir);
    files = { ...files, ...(await prepAsteroids(conn, info)) };
  } else {
    const info = await fetchGaia({ refresh, jobs: Number(option('jobs') ?? 8) });
    process.chdir(dataDir);
    const cut = Number(option('cut') ?? GAIA_CUT);
    const bench = (option('bench') ?? '').split(',').filter(Boolean).map(Number);
    files = { ...files, ...(await prepGaia(conn, info, cut, bench)) };
  }
}

let manifest: Manifest = {};
try {
  manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;
} catch {
  // First run.
}
manifest = { ...manifest, ...files };
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
for (const [name, file] of Object.entries(files)) {
  console.log(`${name}: ${file.rows} rows, ${(file.bytes / 2 ** 20).toFixed(1)} MiB${file.rowGroups ? `, ${file.rowGroups} row groups` : ''}`);
}
console.log(`wrote ${manifestPath}`);
