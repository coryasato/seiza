// Throwaway: sizes the rows' two sources, natively.
//
//   wire    public/rows.bin (data.ts), elements.bin, and h.bin: raw, gzip 9,
//           and brotli 11 (a large window), rows.bin's sections each on
//           their own too; writes public/rows.bin.gz, which the page fetches
//           with `?rows=gz`. Beside them, the Parquet file DuckDB would read.
//   duckdb  native DuckDB over the same Parquet file, reading what the app's
//           table asks of its source: a page of every row, a page of a drawn
//           group's rows (scattered through the file: every tenth row by a
//           hash), and a page sorted by diameter; from the file by row
//           number, and from a table loaded into memory. Native is the
//           floor: DuckDB-Wasm is slower and reads the file over HTTP.
//
// Usage: node apps/kirkwood/spike/sizing.ts <asteroids.parquet> [--only wire,duckdb]
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
import { DuckDBInstance } from '@duckdb/node-api';
import { median, option } from '../../../shared-web/perf/protocol.ts';

const source = process.argv[2];
if (!source || source.startsWith('--')) throw new Error('usage: node sizing.ts <asteroids.parquet> [--only wire,duckdb]');
const only = (option('only') ?? 'wire,duckdb').split(',');
const dir = join(import.meta.dirname, 'public');
const result: Record<string, unknown> = {};

const brotli = (data: Buffer) => brotliCompressSync(data, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_LGWIN]: 24, [constants.BROTLI_PARAM_SIZE_HINT]: data.length } }).length;
const mb = (bytes: number) => Number((bytes / 1e6).toFixed(2));

if (only.includes('wire')) {
  const wire: Record<string, { raw: number; gzip: number; brotli: number }> = {};
  const size = (name: string, data: Buffer) => {
    wire[name] = { raw: mb(data.length), gzip: mb(gzipSync(data, { level: 9 }).length), brotli: mb(brotli(data)) };
    console.log(name, JSON.stringify(wire[name]));
  };
  const rows = readFileSync(join(dir, 'rows.bin'));
  writeFileSync(join(dir, 'rows.bin.gz'), gzipSync(rows, { level: 9 }));
  let at = 0;
  for (const [name, bytes] of JSON.parse(readFileSync(join(dir, 'rows.json'), 'utf8')) as [string, number][]) {
    size(`rows.bin: ${name}`, rows.subarray(at, at + bytes));
    at += bytes;
  }
  size('rows.bin', rows);
  size('elements.bin', readFileSync(join(dir, 'elements.bin')));
  size('h.bin', readFileSync(join(dir, 'h.bin')));
  wire['asteroids.parquet'] = { raw: mb(statSync(source).size), gzip: NaN, brotli: NaN };
  console.table(wire);
  result.wireMB = wire;
}

if (only.includes('duckdb')) {
  const quoted = `'${source.replaceAll("'", "''")}'`;
  const db = await DuckDBInstance.create(':memory:');
  const connection = await db.connect();
  const timed = async (sql: string, runs = 5) => {
    const times: number[] = [];
    let rows = 0;
    for (let run = 0; run < runs; run++) {
      const start = performance.now();
      rows = (await connection.runAndReadAll(sql)).currentRowCount;
      times.push(performance.now() - start);
    }
    return { ms: Number(median(times).toFixed(1)), first: Number(times[0]!.toFixed(1)), rows };
  };
  const memory = async () => Number(((await connection.runAndReadAll(`select sum(memory_usage_bytes) from duckdb_memory()`)).getRows()[0]![0] as bigint)) / 1e6;
  // The group: every tenth row by a hash, its rows numbered in the file's order (what the pick hands over).
  const count = Number((await connection.runAndReadAll(`select count(*) from read_parquet(${quoted})`)).getRows()[0]![0]);
  await connection.run(`create table picked as select row_number() over (order by r) - 1 as pos, r from (select unnest(range(${count})) as r) where hash(r) % 10 = 0`);
  const group = Number((await connection.runAndReadAll(`select count(*) from picked`)).getRows()[0]![0]);
  const file = `read_parquet(${quoted}, file_row_number = true)`;
  const timings: Record<string, unknown> = { groupRows: group };
  const page = (from: number) => `between ${from} and ${from + 1023}`;
  // Pages from the middle of the file and of the group.
  const [middle, groupMiddle] = [Math.floor(count / 2), Math.floor(group / 2)];
  timings['file: a page of every row'] = await timed(`select * from ${file} where file_row_number ${page(middle)}`);
  timings["file: a page of the group's rows"] = await timed(`select f.* from ${file} f join picked p on f.file_row_number = p.r where p.pos ${page(groupMiddle)} order by p.pos`);
  timings['file: a page sorted by diameter'] = await timed(`select * from ${file} order by diameter desc nulls last, file_row_number limit 1024 offset 20480`);
  const before = await memory();
  const start = performance.now();
  await connection.run(`create table rows as select * from ${file}`);
  timings['table: loading the file into memory'] = { ms: Number((performance.now() - start).toFixed(1)), memoryMB: Number(((await memory()) - before).toFixed(1)) };
  timings['table: a page of every row'] = await timed(`select * from rows where file_row_number ${page(middle)}`);
  timings["table: a page of the group's rows"] = await timed(`select f.* from rows f join picked p on f.file_row_number = p.r where p.pos ${page(groupMiddle)} order by p.pos`);
  timings['table: a page sorted by diameter'] = await timed(`select * from rows order by diameter desc nulls last, file_row_number limit 1024 offset 20480`);
  timings['table: a page sorted by full_name'] = await timed(`select * from rows order by full_name, file_row_number limit 1024 offset 20480`);
  console.log(JSON.stringify(timings, null, 2));
  result.duckdbNative = timings;
}

mkdirSync(join(import.meta.dirname, 'out'), { recursive: true });
writeFileSync(join(import.meta.dirname, 'out', `sizing-${only.join('-')}.json`), `${JSON.stringify(result, null, 2)}\n`);
