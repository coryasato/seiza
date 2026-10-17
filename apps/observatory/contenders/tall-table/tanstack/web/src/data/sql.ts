/**
 * The SQL the contender sends: the same text the GPUI contender's engine
 * sends (`seiza-duckdb`: `bridge.rs`'s start, `tall_table.rs`'s
 * `summary_queries` and `ParquetFile::page_sql`). The SQL fixture
 * (`components/tall-table/fixtures/sql.json`) pins the page and summary
 * queries.
 */

/** The warm-up: it starts the engine load, and its answer proves a query
 *  makes the whole round trip. */
export const WARM_UP_SQL = 'SELECT 42 AS x';
/** Loads the Parquet extension from our origin, right after the warm-up. */
export const LOAD_PARQUET_SQL = 'LOAD parquet';
/** Keeps each Parquet file's parsed footer, once the extension is loaded. */
export const PARQUET_METADATA_CACHE_SQL = 'SET GLOBAL parquet_metadata_cache = true';

/** `text` as a SQL string literal (`'…'`, quotes doubled). */
export const stringLiteral = (text: string): string => `'${text.replaceAll("'", "''")}'`;

/** The queries an open sends, in order: the columns, then the row and row
 *  group counts (no metadata keys, so the keyed third isn't sent). */
export function summaryQueries(name: string): string[] {
  const file = stringLiteral(name);
  return [`DESCRIBE SELECT * FROM read_parquet(${file})`, `SELECT num_rows, num_row_groups FROM parquet_file_metadata(${file})`];
}

/** Rows `[start, end)` of the registered Parquet file `name`, filtered on
 *  `file_row_number`, so only the row groups holding them are read. */
export function pageSql(name: string, start: number, end: number): string {
  return (
    `SELECT * EXCLUDE (file_row_number) FROM read_parquet(${stringLiteral(name)}, file_row_number = true) ` +
    `WHERE file_row_number >= ${start} AND file_row_number < ${end} ORDER BY file_row_number`
  );
}
