// Builds the drop-test files. They're files a visitor could drop, so
// `perf/drop.ts` and `perf/csv.ts` open them from disk, never R2.
//
// M5, from asteroids.parquet: the asteroid table repeated k times, in file
// order, to ~100 MB and ~1 GB. The 1 GB file comes in three row-group
// layouts, since a dropped file's layout isn't ours to choose and a page read
// decodes whole row groups: our samples' 30,720 rows, DuckDB's default
// 122,880, and pyarrow's 1,048,576.
//
// M6, from fixtures/asteroids.csv (tricky rows included): its header once,
// then its body 6 times, byte for byte, to ~1 GB. The row count is DuckDB's
// (quoted newlines make it differ from the line count), with the quote set:
// DuckDB's sniffer reads only the head, sees no quotes, and picks none, and
// the quoted rows at the end then fail to parse.
//
// M7, the size ceiling: the Parquet table repeated to ~2.2 GB and ~4.5 GB
// (DuckDB's default 122,880-row groups, as a visitor's file would most
// likely have), ~4.6 GB (past 2^32 bytes), and ~9.6 GB, and the CSV fixture to ~2,
// ~4, ~5.4, ~8.6, and ~10.7 GB.
//
// Each file's rows, bytes, row groups, and SHA-256 go into MANIFEST.json
// under `drop/`.
//
// Usage: node apps/tycho/data/drop_files.ts [name-substring…]
// (needs asteroids.parquet and the fixture: `just tycho data`)

import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { once } from 'node:events';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DuckDBInstance } from '@duckdb/node-api';

const dataDir = dirname(fileURLToPath(import.meta.url));
const manifestPath = join(dataDir, 'MANIFEST.json');
const source = join(dataDir, 'asteroids.parquet');
const csvSource = join(dataDir, 'fixtures/asteroids.csv');
for (const file of [source, csvSource]) {
  if (!existsSync(file)) throw new Error(`${file} is missing: run \`just tycho data\` first`);
}
/** With arguments, only the files whose names contain one of them. */
const only = process.argv.slice(2);
const wanted = (name: string) => only.length === 0 || only.some((part) => name.includes(part));

/** Name → (copies of the asteroid table, rows per row group). */
const FILES: Record<string, [number, number]> = {
  'drop/asteroids-x3.parquet': [3, 30_720],
  'drop/asteroids-x27.parquet': [27, 30_720],
  'drop/asteroids-x27-rg122880.parquet': [27, 122_880],
  'drop/asteroids-x27-rg1048576.parquet': [27, 1_048_576],
  'drop/asteroids-x60-rg122880.parquet': [60, 122_880],
  'drop/asteroids-x120-rg122880.parquet': [120, 122_880],
  'drop/asteroids-x130-rg122880.parquet': [130, 122_880],
  'drop/asteroids-x270-rg122880.parquet': [270, 122_880],
};

/** Name → copies of the CSV fixture's body. */
const CSV_FILES: Record<string, number> = {
  'drop/asteroids-x6.csv': 6,
  'drop/asteroids-x12.csv': 12,
  'drop/asteroids-x24.csv': 24,
  'drop/asteroids-x30.csv': 30,
  'drop/asteroids-x48.csv': 48,
  'drop/asteroids-x60.csv': 60,
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
  if (!wanted(name)) continue;
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
const sql = (text: string) => text.replaceAll("'", "''");
const csvSha = (manifest['fixtures/asteroids.csv'] as { sha256: string }).sha256;
for (const [name, copies] of Object.entries(CSV_FILES)) {
  if (!wanted(name)) continue;
  const path = join(dataDir, name);
  const started = performance.now();
  const fixture = readFileSync(csvSource);
  const bodyStart = fixture.indexOf(0x0a) + 1;
  const out = createWriteStream(path);
  out.write(fixture.subarray(0, bodyStart));
  for (let copy = 0; copy < copies; copy++) {
    if (!out.write(fixture.subarray(bodyStart))) await once(out, 'drain');
  }
  out.end();
  await once(out, 'finish');
  const rows = Number((await conn.runAndReadAll(`SELECT count(*) FROM read_csv('${sql(path)}', header = true, quote = '"', escape = '"', all_varchar = true)`)).getRows()[0]![0]);
  manifest[name] = {
    rows,
    bytes: statSync(path).size,
    sha256: await sha256(path),
    source: `fixtures/asteroids.csv (sha256 ${csvSha.slice(0, 12)}…): header, then its body × ${copies}`,
    writer: 'drop_files.ts, byte for byte; rows counted by ' + writer,
  };
  console.log(`${name}: ${(statSync(path).size / 2 ** 20).toFixed(1)} MiB, ${rows} rows (${((performance.now() - started) / 1000).toFixed(1)} s)`);
}
// M7: a CSV that compresses badly (random hex), ~4.6 GB: under the 6 GB
// limit, over DuckDB's memory budget, so its load must stop at the budget.
const RANDOM_CSV = 'drop/random-hex.csv';
if (wanted(RANDOM_CSV)) {
  const path = join(dataDir, RANDOM_CSV);
  const started = performance.now();
  const out = createWriteStream(path);
  out.write('id,a,b,c\n');
  // xorshift32, seeded: the same bytes every run.
  let state = 0x9e3779b9;
  const next = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
  const hex = (words: number) => Array.from({ length: words }, () => next().toString(16).padStart(8, '0')).join('');
  const rows = 50_000_000;
  let batch = '';
  for (let row = 0; row < rows; row++) {
    batch += `${row},${hex(4)},${hex(4)},${hex(2)}\n`;
    if (batch.length > 1 << 20) {
      if (!out.write(batch)) await once(out, 'drain');
      batch = '';
    }
  }
  out.end(batch);
  await once(out, 'finish');
  manifest[RANDOM_CSV] = {
    rows,
    bytes: statSync(path).size,
    sha256: await sha256(path),
    source: 'drop_files.ts: id and three random hex columns (xorshift32, fixed seed)',
    writer: 'drop_files.ts',
  };
  console.log(`${RANDOM_CSV}: ${(statSync(path).size / 2 ** 20).toFixed(1)} MiB, ${rows} rows (${((performance.now() - started) / 1000).toFixed(1)} s)`);
}
conn.closeSync();
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
