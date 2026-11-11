// Throwaway: writes the spike's elements file, public/elements.bin, from
// the asteroid sample (Tycho's asteroids.parquet): each row's a (au), e, and
// i (degrees) as three little-endian f32s, in the file's own row order. The
// angles aren't in the sample; the crate seeds them.
//
// Usage: node apps/kirkwood/spike/data.ts <path to asteroids.parquet>
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DuckDBInstance } from '@duckdb/node-api';

const source = process.argv[2];
if (!source) throw new Error('usage: node data.ts <asteroids.parquet>');
const out = join(import.meta.dirname, 'public');
mkdirSync(out, { recursive: true });

const db = await DuckDBInstance.create(':memory:');
const connection = await db.connect();
const reader = await connection.runAndReadAll(`select a::float, e::float, i::float from read_parquet('${source.replaceAll("'", "''")}')`);
const [a, e, i] = reader.getColumns() as [(number | null)[], (number | null)[], (number | null)[]];
const rows = a.length;
const elements = new Float32Array(rows * 3);
let missing = 0;
let unbound = 0;
for (let row = 0; row < rows; row++) {
  const [ra, re, ri] = [a[row], e[row], i[row]];
  if (ra == null || re == null || ri == null) missing++;
  else if (re >= 1 || ra <= 0) unbound++;
  elements.set([ra ?? NaN, re ?? NaN, ri ?? NaN], row * 3);
}
writeFileSync(join(out, 'elements.bin'), Buffer.from(elements.buffer));
console.log(`${rows} rows, ${elements.byteLength} bytes; ${missing} with a NULL element, ${unbound} unbound (e >= 1 or a <= 0)`);
