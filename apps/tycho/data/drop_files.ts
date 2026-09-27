// Builds the M5 drop-test files from asteroids.parquet: the asteroid table
// repeated k times, in file order, to ~100 MB and ~1 GB. They're files a
// visitor could drop, so `perf/drop.ts` opens them from disk, never R2.
//
// The 1 GB file comes in three row-group layouts, since a dropped file's
// layout isn't ours to choose and a page read decodes whole row groups:
// our samples' 30,720 rows, DuckDB's default 122,880, and pyarrow's
// 1,048,576. Each file's rows, bytes, row groups, and SHA-256 go into
// MANIFEST.json under `drop/`.
//
// Usage: node apps/tycho/data/drop_files.ts   (needs asteroids.parquet: `just tycho data`)

import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DuckDBInstance } from '@duckdb/node-api';

const dataDir = dirname(fileURLToPath(import.meta.url));
const manifestPath = join(dataDir, 'MANIFEST.json');
const source = join(dataDir, 'asteroids.parquet');
if (!existsSync(source)) throw new Error('asteroids.parquet is missing: run `just tycho data` first');

/** Name → (copies of the asteroid table, rows per row group). */
const FILES: Record<string, [number, number]> = {
  'drop/asteroids-x3.parquet': [3, 30_720],
  'drop/asteroids-x27.parquet': [27, 30_720],
  'drop/asteroids-x27-rg122880.parquet': [27, 122_880],
  'drop/asteroids-x27-rg1048576.parquet': [27, 1_048_576],
};

async function sha256(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

mkdirSync(join(dataDir, 'drop'), { recursive: true });
const instance = await DuckDBInstance.create(':memory:');
const conn = await instance.connect();
const writer = `DuckDB ${(await conn.runAndReadAll('SELECT version()')).getRows()[0]?.[0]}`;
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
const sourceSha = (manifest['asteroids.parquet'] as { sha256: string }).sha256;

for (const [name, [copies, rowGroup]] of Object.entries(FILES)) {
  const path = join(dataDir, name);
  const started = performance.now();
  // `copy` outer, file order inner: the asteroid table k times over, in order.
  await conn.run(
    `COPY (SELECT a.* EXCLUDE (file_row_number) FROM range(${copies}) c(copy), ` +
      `read_parquet('${source.replaceAll("'", "''")}', file_row_number = true) a ORDER BY copy, a.file_row_number) ` +
      `TO '${path.replaceAll("'", "''")}' (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE ${rowGroup})`,
  );
  const meta = (await conn.runAndReadAll(`SELECT num_rows, num_row_groups FROM parquet_file_metadata('${path.replaceAll("'", "''")}')`)).getRows()[0]!;
  manifest[name] = {
    rows: Number(meta[0]),
    bytes: statSync(path).size,
    sha256: await sha256(path),
    source: `asteroids.parquet (sha256 ${sourceSha.slice(0, 12)}…) × ${copies}`,
    rowGroups: Number(meta[1]),
    writer: `${writer}, ZSTD, ROW_GROUP_SIZE ${rowGroup}`,
  };
  console.log(`${name}: ${(statSync(path).size / 2 ** 20).toFixed(1)} MiB, ${meta[0]} rows, ${meta[1]} row groups (${((performance.now() - started) / 1000).toFixed(1)} s)`);
}
conn.closeSync();
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
