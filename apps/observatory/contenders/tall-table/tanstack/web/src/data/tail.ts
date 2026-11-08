/**
 * Live tail's replay over its file (`docs/DECISIONS.md`, "Scenarios"), the
 * same text and rule as the GPUI contender's (`gpui/crate/src/tail.rs`):
 * the page SQL over the looping rows (row i is the file's row i mod n, its
 * time moved on by ⌊i / n⌋ spans) and the time's text. Pinned by the tall
 * table's fixtures (`sql.json`'s `live-tail`, `cells.json`'s
 * `timestamp_text`; `test/tail.test.ts`).
 */

import { FILE_ROWS, SPAN_S, WHOLE_FILE } from '../../../../../tail/data.ts';
import { stringLiteral } from './sql.ts';

/** Rows `[start, end)` of the replay: one SELECT per lap they cross, in row order. */
export function tailSql(start: number, end: number, file: string = WHOLE_FILE, fileRows: number = FILE_ROWS, spanS: number = SPAN_S): string {
  const name = stringLiteral(file);
  const parts: string[] = [];
  for (let lap = Math.floor(start / fileRows); lap <= Math.floor((Math.max(end, start + 1) - 1) / fileRows); lap++) {
    const base = lap * fileRows;
    const lo = Math.max(start, base) - base;
    const hi = Math.min(end, base + fileRows) - base;
    parts.push(
      `SELECT "time" + to_seconds(${lap * spanS}) AS "time", request, status, bytes, ` +
        `file_row_number + ${base} AS r FROM read_parquet(${name}, file_row_number = true) ` +
        `WHERE file_row_number >= ${lo} AND file_row_number < ${hi}`,
    );
  }
  return `SELECT "time", request, status, bytes FROM (${parts.join(' UNION ALL ')}) ORDER BY r`;
}

/** The months as the log writes them. */
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const two = (n: number) => String(n).padStart(2, '0');

/** A zoneless TIMESTAMP as Arrow gives it (epoch ms, maybe fractional) as
 *  the log wrote it, its wall time read with UTC getters (never the
 *  visitor's zone): `13/Jul/1995 03:14:02`, the fraction of a second cut. */
export function timeText(epochMs: number): string {
  const at = new Date(Math.floor(epochMs / 1000) * 1000);
  return (
    `${two(at.getUTCDate())}/${MONTHS[at.getUTCMonth()]}/${String(at.getUTCFullYear()).padStart(4, '0')} ` +
    `${two(at.getUTCHours())}:${two(at.getUTCMinutes())}:${two(at.getUTCSeconds())}`
  );
}
