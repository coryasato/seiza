// Builds Tycho's sample data: fetches the raw catalog (fetch_asteroids.ts),
// runs prep.sql with native DuckDB, and writes MANIFEST.json (committed) with
// each file's rows, bytes, SHA-256, source, and fetch date, so every benchmark
// names the exact files it ran against.
//
// Usage: node apps/tycho/data/prep.ts [asteroids] [--refresh]
// Gaia joins as a second target in M7. `just tycho data` runs this, then
// loads the Parquet into the local R2 that `wrangler dev` serves.

import { createHash } from 'node:crypto';
import { createReadStream, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api';
import { fetchAsteroids, type FetchInfo } from './fetch_asteroids.ts';

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

const targets = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
for (const target of targets) {
  if (target !== 'asteroids') throw new Error(`unknown target "${target}" (known: asteroids; gaia arrives in M7)`);
}

const info = await fetchAsteroids({ refresh: process.argv.includes('--refresh') });
const instance = await DuckDBInstance.create();
const conn = await instance.connect();
// prep.sql's relative paths are relative to this directory.
process.chdir(dataDir);
const files = await prepAsteroids(conn, info);

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
