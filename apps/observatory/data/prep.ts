// Builds the Observatory's data file, asteroids.parquet, from Tycho's pinned
// asteroid sample (apps/tycho/data/asteroids.parquet, its SHA-256 in Tycho's
// MANIFEST.json): runs prep.sql with native DuckDB, checks the result fits a
// Workers static asset, and writes MANIFEST.json (committed) with its rows,
// bytes, SHA-256, row groups, and source.
//
// Usage: node apps/observatory/data/prep.ts   (`just observatory data`)
// Needs Tycho's file first: `just tycho data`.

import { createHash } from 'node:crypto';
import { createReadStream, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api';

/** Cloudflare's per-file limit for Workers static assets. */
const STATIC_ASSET_LIMIT = 25 * 2 ** 20;

const dataDir = dirname(fileURLToPath(import.meta.url));
const tychoData = join(dataDir, '../../tycho/data');
const source = join(tychoData, 'asteroids.parquet');
const output = join(dataDir, 'asteroids.parquet');

interface ManifestFile {
  rows: number;
  bytes: number;
  sha256: string;
  source: string;
  fetched?: string;
  rowGroups?: number;
  writer: string;
  notes?: string[];
}

const sqlText = (value: string) => value.replaceAll("'", "''");

async function sha256(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

async function value(conn: DuckDBConnection, sql: string): Promise<unknown> {
  return (await conn.runAndReadAll(sql)).getRows()[0]?.[0];
}

const pinned = (JSON.parse(readFileSync(join(tychoData, 'MANIFEST.json'), 'utf8')) as Record<string, ManifestFile>)['asteroids.parquet'];
if (!pinned) throw new Error("Tycho's MANIFEST.json has no asteroids.parquet");
let sourceHash: string;
try {
  sourceHash = await sha256(source);
} catch {
  throw new Error(`${source} is missing: build it with \`just tycho data\``);
}
if (sourceHash !== pinned.sha256)
  throw new Error(`${source}: SHA-256 ${sourceHash}, but Tycho's MANIFEST.json pins ${pinned.sha256}; rebuild it with \`just tycho data\``);

const conn = await (await DuckDBInstance.create()).connect();
process.chdir(dataDir);
const sql = readFileSync(join(dataDir, 'prep.sql'), 'utf8')
  .replaceAll('${source}', sqlText(source))
  .replaceAll('${fetched}', sqlText(pinned.fetched ?? ''));
const started = performance.now();
await conn.run(sql);
console.log(`prep.sql: ${((performance.now() - started) / 1000).toFixed(1)} s`);

const bytes = statSync(output).size;
if (bytes >= STATIC_ASSET_LIMIT)
  throw new Error(`asteroids.parquet is ${(bytes / 2 ** 20).toFixed(2)} MiB, over the 25 MiB static-asset limit: drop a column in prep.sql`);
const rows = Number(await value(conn, "SELECT count(*) FROM 'asteroids.parquet'"));
if (rows !== pinned.rows) throw new Error(`asteroids.parquet has ${rows} rows; its source has ${pinned.rows}`);
const entry: ManifestFile = {
  rows,
  bytes,
  sha256: await sha256(output),
  source: `apps/tycho/data/asteroids.parquet (sha256 ${pinned.sha256.slice(0, 12)}…), from ${pinned.source}`,
  fetched: pinned.fetched,
  rowGroups: Number(await value(conn, "SELECT num_row_groups FROM parquet_file_metadata('asteroids.parquet')")),
  writer: `DuckDB ${await value(conn, 'SELECT version()')}, ZSTD, ROW_GROUP_SIZE 30720, sorted by spkid`,
  notes: [`columns: ${(await conn.runAndReadAll("DESCRIBE SELECT * FROM 'asteroids.parquet'")).getRows().map((r) => `${r[0]} ${r[1]}`).join(', ')}`],
};
writeFileSync(join(dataDir, 'MANIFEST.json'), `${JSON.stringify({ 'asteroids.parquet': entry }, null, 2)}\n`);
console.log(`asteroids.parquet: ${rows} rows, ${(bytes / 2 ** 20).toFixed(2)} MiB, ${entry.rowGroups} row groups, sha256 ${entry.sha256}`);
