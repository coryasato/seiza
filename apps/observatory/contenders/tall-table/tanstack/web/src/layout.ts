/**
 * The table's geometry, as the tall table lays it out
 * (`components/tall-table/src/column.rs`, `state.rs`): the row height, the
 * row-number gutter, and each column's width by kind, at least its
 * header's. Pinned to the GPUI contender's, so both sides draw the same
 * boxes; the float columns' widths and budgets are `cells.json`'s, which
 * the fixture test checks.
 */

import type { CellKind } from './data/format.ts';

/** gpui-kit's small table row (`Size::Small.table_row_height()`). */
export const ROW_HEIGHT = 30;

/** A cell's horizontal padding (`px_2` on each side). */
const CELL_PADDING = 16;

/** The widest advance of the characters a number is written with, in IBM
 *  Plex Sans at 14 px, as GPUI measures it (the component's `Glyphs`): an
 *  integer column fits its widest value at it. The GPUI contender's
 *  `spkid` (BIGINT, 20 characters) is 185 px wide. */
const NUMBER_PX = 8.4;

/** How a column's values are aligned and cut (the component's `CellKind`). */
export type Align = 'text' | 'integer' | 'float';

export interface LaidOutColumn {
  name: string;
  kind: CellKind;
  align: Align;
  width: number;
  /** How many characters a float may take (`fit_float`'s budget). */
  budget: number;
}

/** The widest value an integer column holds, by DuckDB type (`seiza-duckdb`'s
 *  `tall_table_column`). */
function integerChars(type: string): number {
  switch (type) {
    case 'TINYINT':
      return 4;
    case 'SMALLINT':
      return 6;
    case 'INTEGER':
      return 11;
    case 'UTINYINT':
      return 3;
    case 'USMALLINT':
      return 5;
    case 'UINTEGER':
      return 10;
    default:
      return 20;
  }
}

/** Lays one column out: its width (by kind, at least its name's estimated
 *  width at the UI font's average advance) and float budget. */
export function layOut(column: { name: string; type: string; kind: CellKind }): LaidOutColumn {
  const [width, align]: [number, Align] =
    column.kind === 'boolean' ? [72, 'text']
    : column.kind === 'date' ? [104, 'text']
    : column.kind === 'integer' ? [integerChars(column.type) * NUMBER_PX + CELL_PADDING + 1, 'integer']
    : column.kind === 'float' ? [120, 'float']
    : [200, 'text'];
  const named = Math.max(width, [...column.name].length * 7.5 + 24);
  // A pixel short of the room, for rounding in the shaped width.
  const budget = Math.max(1, Math.floor((named - CELL_PADDING - 1) / NUMBER_PX));
  return { name: column.name, kind: column.kind, align, width: named, budget };
}

/** `1567523` → `1,567,523`: the row numbers' format. */
export const formatCount = (value: number): string => value.toLocaleString('en-US');

/** The row-number gutter's width for `rows` rows. */
export const gutterWidth = (rows: number): number => formatCount(rows).length * 7.5 + 24;
