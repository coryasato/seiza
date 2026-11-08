/**
 * Live tail's page SQL over the looping rows, the same text as the GPUI
 * spike's (`../tail-gpui/src/lib.rs`, `tail_sql`): one SELECT per lap the
 * page crosses, row i the file's row i mod n with its time moved on by
 * ⌊i / n⌋ spans, drawn as the canvas writes it.
 */

export const FILE = 'nasa.parquet';
export const DATA_FILE = 'nasa-http-jul95.parquet';
/** The file's first row to its last, s (perf/results/2026-11-06-m11-a1.md). */
export const SPAN_S = 2_381_544;

export function tailSql(fileRows: number, start: number, end: number): string {
  const parts: string[] = [];
  for (let lap = Math.floor(start / fileRows); lap <= Math.floor((end - 1) / fileRows); lap++) {
    const base = lap * fileRows;
    const lo = Math.max(start, base) - base;
    const hi = Math.min(end, base + fileRows) - base;
    parts.push(
      `SELECT strftime("time" + to_seconds(${lap * SPAN_S}), '%d/%b/%Y %H:%M:%S') AS "time", ` +
        `request, status, bytes, file_row_number + ${base} AS r ` +
        `FROM read_parquet('${FILE}', file_row_number = true) ` +
        `WHERE file_row_number >= ${lo} AND file_row_number < ${hi}`,
    );
  }
  return `SELECT "time", request, status, bytes FROM (${parts.join(' UNION ALL ')}) ORDER BY r`;
}
