// Draft prep of the wall's file (throwaway; the monitoring wall's draft): prep-wall.sql over
// instruments.ts with native DuckDB, into the scratch path given; prints
// rows, bytes, row groups, and each desk's rows.
// Usage: node apps/observatory/spike/wall/prep-draft.ts <out.parquet>
import { readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { DESKS, WALL_INSTRUMENTS } from './instruments.ts';

const require = createRequire(join(import.meta.dirname, '../../data/package.json'));
// Native DuckDB is installed only under data/ (its own lockfile), so its
// types aren't the spike's: the calls used, typed here.
interface Connection {
  run(sql: string): Promise<unknown>;
  runAndReadAll(sql: string): Promise<{ getRows(): unknown[][] }>;
}
const { DuckDBInstance } = require('@duckdb/node-api') as { DuckDBInstance: { create(): Promise<{ connect(): Promise<Connection> }> } };
const out = process.argv[2]!;
const values = WALL_INSTRUMENTS.map(([d, s, p], i) => `(${i}, '${DESKS[d]}', '${s}', ${p.toFixed(2)})`).join(',\n');
const sql = readFileSync(join(import.meta.dirname, 'prep-wall.sql'), 'utf8').replace('${values}', values).replace('${out}', out);
const conn = await (await DuckDBInstance.create()).connect();
await conn.run(sql);
const q = async (s: string) => (await conn.runAndReadAll(s)).getRows();
console.log('rows', (await q(`SELECT count(*) FROM '${out}'`))[0]![0], 'bytes', statSync(out).size, 'row groups', (await q(`SELECT num_row_groups FROM parquet_file_metadata('${out}')`))[0]![0]);
console.log((await q(`SELECT "Desk", count(*), min("Last"), max("Last") FROM read_parquet('${out}', file_row_number = true) GROUP BY ALL ORDER BY min(file_row_number)`)).map((r) => r.join(' ')).join('\n'));
console.log((await q(`DESCRIBE SELECT * FROM '${out}'`)).map((r) => `${r[0]} ${r[1]}`).join(', '));
