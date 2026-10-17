/**
 * The data file as the table reads it: the engine started, the file opened,
 * and its pages read and decoded with the Arrow library. This module and
 * Arrow load after first paint (`main.ts` imports it dynamically), with the
 * engine; the build fails if Arrow reaches a first-paint chunk
 * (`contenders/engine.ts`, its control in `perf/engine-files.ts`).
 *
 * The same requests as the GPUI contender's engine (`seiza-duckdb`'s
 * `start` and `open_parquet`), in the same order: the warm-up, then the
 * Parquet extension, then the file registered and its summary read.
 */

import { tableFromIPC, type Vector } from 'apache-arrow';
import type { Bridge } from '@seiza/duckdb/bridge';
import type { CellKind, CellValue } from './format.ts';
import type { Page, PageSource } from './paging.ts';
import { LOAD_PARQUET_SQL, PARQUET_METADATA_CACHE_SQL, WARM_UP_SQL, pageSql, summaryQueries } from './sql.ts';

/** A page of rows, decoded from the Arrow IPC bytes it arrived as. The
 *  vectors are views into those bytes, so `byteLength` is what it holds
 *  (the component's `heap_bytes`). */
export class ArrowPage implements Page {
  readonly byteLength: number;
  readonly length: number;
  private readonly columns: Vector[];

  constructor(bytes: Uint8Array) {
    const table = tableFromIPC(bytes);
    this.byteLength = bytes.byteLength;
    this.length = table.numRows;
    this.columns = table.schema.fields.map((_, index) => table.getChildAt(index)!);
  }

  /** The value at `row` (the page's own, from 0) and `column`, or
   *  undefined past its end. */
  value(row: number, column: number): CellValue | undefined {
    if (row >= this.length) return undefined;
    return (this.columns[column]?.get(row) ?? null) as CellValue;
  }
}

export interface Column {
  name: string;
  /** The DuckDB type, as DESCRIBE writes it. */
  type: string;
  kind: CellKind;
}

/** The cells' kind for a DuckDB type (`ColumnInfo::tall_table_column`, for
 *  the types the base level draws; anything else shows as text). A FLOAT's
 *  exact text would be f32's shortest, not f64's; the data file has only
 *  DOUBLEs, and the cell fixture refuses FLOAT columns. */
export function columnKind(type: string): CellKind {
  if (type === 'BOOLEAN') return 'boolean';
  if (type === 'DATE') return 'date';
  if (type === 'FLOAT' || type === 'DOUBLE') return 'float';
  if (/^U?(TINY|SMALL|BIG|HUGE)?INT(EGER)?$/.test(type)) return 'integer';
  return 'text';
}

export interface OpenedFile {
  rows: number;
  rowGroups: number;
  columns: Column[];
  source: PageSource<ArrowPage>;
}

/** A count from the file's metadata (`seiza-duckdb`'s `sql::count`): a
 *  whole number, or an error naming the column. */
function count(value: unknown, column: string): number {
  const number = typeof value === 'bigint' || typeof value === 'number' ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(number) || number < 0) throw new Error(`Parquet file metadata has no count in ${column} (got ${String(value)})`);
  return number;
}

/** Sends queries through the bridge, each with its own request id. */
export class Queries {
  private next = 0;
  private readonly bridge: Bridge;

  constructor(bridge: Bridge) {
    this.bridge = bridge;
  }

  send(sql: string): { request: number; result: Promise<Uint8Array> } {
    const request = this.next++;
    return { request, result: this.bridge.query(sql, request) };
  }

  cancel(request: number): void {
    this.bridge.cancel(request);
  }
}

/** Starts the engine: the warm-up query (which loads DuckDB). Once it's
 *  answered, the Parquet extension and its footer cache load; `parquet`
 *  settles when they have, and an open waits on it. */
export async function startEngine(queries: Queries): Promise<{ parquet: Promise<void> }> {
  const warm = new ArrowPage(await queries.send(WARM_UP_SQL).result).value(0, 0);
  if (warm !== 42) throw new Error(`warm-up query returned ${String(warm)}, expected 42`);
  const parquet = (async () => {
    await queries.send(LOAD_PARQUET_SQL).result;
    await queries.send(PARQUET_METADATA_CACHE_SQL).result;
  })();
  parquet.catch(() => {}); // Reported by the open that waits on it.
  return { parquet };
}

/** Registers `url` as `name` while the Parquet extension finishes
 *  loading, then reads its columns and counts from the footer (its two
 *  summary queries, sent together). */
export async function openParquet(bridge: Bridge, queries: Queries, parquet: Promise<void>, name: string, url: string): Promise<OpenedFile> {
  const registered = bridge.registerFile(name, url);
  registered.catch(() => {}); // Reported below, after the extension's error.
  await parquet;
  await registered;
  const [describe, metadata] = await Promise.all(summaryQueries(name).map((sql) => queries.send(sql).result));
  const columnsTable = tableFromIPC(describe!);
  const names = columnsTable.getChild('column_name');
  const types = columnsTable.getChild('column_type');
  if (!names || !types) throw new Error('DESCRIBE returned no column_name or column_type');
  const columns: Column[] = [];
  for (let row = 0; row < columnsTable.numRows; row++) {
    const type = String(types.get(row));
    columns.push({ name: String(names.get(row)), type, kind: columnKind(type) });
  }
  const counts = tableFromIPC(metadata!);
  if (counts.numRows !== 1) throw new Error(`expected one row of Parquet file metadata, got ${counts.numRows}`);
  const rows = count(counts.getChild('num_rows')?.get(0), 'num_rows');
  const rowGroups = count(counts.getChild('num_row_groups')?.get(0), 'num_row_groups');
  const source: PageSource<ArrowPage> = {
    load: ([start, end]) => {
      const { request, result } = queries.send(pageSql(name, start, end));
      return { request, result: result.then((bytes) => new ArrowPage(bytes)) };
    },
    cancel: (request) => queries.cancel(request),
  };
  return { rows, rowGroups, columns, source };
}
