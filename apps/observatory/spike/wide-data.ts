// The wide-grid spike's data: the wide sheet's GHCN file (its pick)
// read once with native DuckDB into what the page holds in memory, so the
// spike measures the grid, not the engine: public/wide/values.f32 (rows ×
// days, row-major, NaN for NULL) and public/wide/keys.json (each row's
// station and place, the days' names, the values' range). Gitignored.
//
// Usage: node apps/observatory/spike/wide-data.ts <ghcn-2025-tmax-double.parquet>

import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(new URL('../data/package.json', import.meta.url));
/** What this script uses of `@duckdb/node-api` (data/'s install, not the spike's). */
interface DuckDB {
  DuckDBInstance: { create(path: string): Promise<{ connect(): Promise<{ runAndReadAll(sql: string): Promise<{ columnNames(): string[]; getRows(): unknown[][] }> }> }> };
}
const { DuckDBInstance } = require('@duckdb/node-api') as DuckDB;

const file = process.argv[2];
if (!file) throw new Error('usage: wide-data.ts <parquet>');
const out = join(import.meta.dirname, 'public/wide');
mkdirSync(out, { recursive: true });

const connection = await (await DuckDBInstance.create(':memory:')).connect();
const reader = await connection.runAndReadAll(`SELECT * FROM read_parquet('${file.replaceAll("'", "''")}')`);
const names = reader.columnNames();
const days = names.slice(3);
const rows = reader.getRows();
const values = new Float32Array(rows.length * days.length);
let min = Infinity;
let max = -Infinity;
const station: string[] = [];
const place: string[] = [];
rows.forEach((row, r) => {
  station.push(String(row[0]));
  place.push(String(row[1]));
  for (let d = 0; d < days.length; d++) {
    const v = row[3 + d];
    const x = v === null ? NaN : Number(v);
    values[r * days.length + d] = x;
    if (x < min) min = x;
    if (x > max) max = x;
  }
});
writeFileSync(join(out, 'values.f32'), new Uint8Array(values.buffer));
writeFileSync(join(out, 'keys.json'), JSON.stringify({ names: names.slice(0, 2), days, station, place, min, max }));
console.log(`${rows.length} rows × ${days.length} days, ${min}..${max}, ${(values.byteLength / 2 ** 20).toFixed(1)} MiB`);
