/**
 * The table's geometry, as the tall table lays it out
 * (`components/tall-table/src/column.rs`, `state.rs`): the row height, the
 * row-number gutter, and each column's width by kind, at least its
 * header's. Pinned to the GPUI contender's, so both sides draw the same
 * boxes; the float columns' widths and budgets are `cells.json`'s, which
 * the fixture test checks. Every length goes through a {@link Sizes}: the
 * base's constants here ({@link BASE_SIZES}, the component's stand-in
 * without `density`), a density's from `density.ts` on the wide level.
 */

import type { CellKind } from './data/format.ts';

/** gpui-kit's small table row (`Size::Small.table_row_height()`). */
export const ROW_HEIGHT = 30;

/** The widest advance of the characters a number is written with, in IBM
 *  Plex Sans at 14 px, as GPUI measures it (the component's `Glyphs`): an
 *  integer column fits its widest value at it. The GPUI contender's
 *  `spkid` (BIGINT, 20 characters) is 185 px wide. */
const NUMBER_PX = 8.4;

/** The lengths in effect (the component's `Sizes`): the rows' and header's
 *  height, the text's size, and the scale the base's horizontal lengths
 *  follow, the text over the default's. */
export interface Sizes {
  row: number;
  text: number;
  scale: number;
  /** The widest advance of a number's characters at the text. */
  numberPx: number;
  /** `density.json`'s negative controls that live in the layout; only the
   *  fixture test sets one. */
  control?: 'padding-fixed' | 'width-scaled' | 'name-rounded-per-character' | 'least-fixed';
}

/** The base's: 30 px rows, 14 px text, a scale of 1. */
export const BASE_SIZES: Sizes = { row: ROW_HEIGHT, text: 14, scale: 1, numberPx: NUMBER_PX };

/** A horizontal length the base fixes for 14 px text, scaled and rounded
 *  to a whole px; at a scale of 1, the base's own, unrounded (its name and
 *  gutter estimates have half pixels). */
export const scaled = (sizes: Sizes, length: number): number => (sizes.scale === 1 ? length : Math.round(length * sizes.scale));

/** The cells' padding on each side: 8 px scaled. */
export const padOf = (sizes: Sizes): number => (sizes.control === 'padding-fixed' ? 8 : scaled(sizes, 8));

/** A header name's or the gutter's estimated width: 7.5 px a character and
 *  24, scaled, rounded once on the total. */
const estimate = (sizes: Sizes, chars: number): number =>
  sizes.control === 'name-rounded-per-character' ? chars * scaled(sizes, 7.5) + scaled(sizes, 24) : scaled(sizes, chars * 7.5 + 24);

/** A set width's clamp: at least 40 px scaled, at most 1200. */
const MIN_WIDTH = 40;
export const MAX_WIDTH = 1200;

/** A set width's least at `sizes`: 40 px scaled. With `clampWidth`, the
 *  rule a resize drags and publishes by (`resize.ts`); `layOut` writes the
 *  same rule inline, since a call here would move the base's bundle, and
 *  `fixtures.test.ts` pins the two equal. */
export const leastWidth = (sizes: Sizes): number => (sizes.control === 'least-fixed' ? MIN_WIDTH : scaled(sizes, MIN_WIDTH));

/** A set width as laid out: clamped to its range (never scaled). */
export const clampWidth = (width: number, sizes: Sizes): number => Math.min(Math.max(width, leastWidth(sizes)), MAX_WIDTH);

/** How a column's values are aligned and cut (the component's `CellKind`). */
export type Align = 'text' | 'integer' | 'float';

export interface LaidOutColumn {
  name: string;
  kind: CellKind;
  align: Align;
  /** Its left edge from the cells' left (the sum of the widths before it). */
  x: number;
  width: number;
  /** How many characters a float may take (`fit_float`'s budget). */
  budget: number;
}

/** A column to lay out: its name and kind, its DuckDB type (an integer's
 *  widest value) or `maxChars` for it, and a set width (`density`). */
export interface ColumnSpec {
  name: string;
  kind: CellKind;
  type?: string;
  maxChars?: number;
  width?: number;
}

/** The widest value an integer column holds, by DuckDB type (`seiza-duckdb`'s
 *  `tall_table_column`). */
function integerChars(type: string | undefined): number {
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

/** Lays one column out at `x`: its width (by kind, at least its name's
 *  estimated width at the UI font's average advance; a set width instead,
 *  clamped and never scaled) and float budget. */
export function layOut(column: ColumnSpec, sizes: Sizes = BASE_SIZES, x = 0): LaidOutColumn {
  const padding = 2 * padOf(sizes);
  const [kindWidth, align]: [number, Align] =
    column.kind === 'boolean' ? [scaled(sizes, 72), 'text']
    : column.kind === 'date' ? [scaled(sizes, 104), 'text']
    : column.kind === 'integer' ? [(column.maxChars ?? integerChars(column.type)) * sizes.numberPx + padding + 1, 'integer']
    : column.kind === 'float' ? [scaled(sizes, 120), 'float']
    : [scaled(sizes, 200), 'text'];
  let width = Math.max(kindWidth, estimate(sizes, [...column.name].length));
  if (column.width !== undefined) {
    width = Math.min(Math.max(column.width, sizes.control === 'least-fixed' ? MIN_WIDTH : scaled(sizes, MIN_WIDTH)), MAX_WIDTH);
    if (sizes.control === 'width-scaled') width = scaled(sizes, width);
  }
  // A pixel short of the room, for rounding in the shaped width.
  const budget = Math.max(1, Math.floor((width - padding - 1) / sizes.numberPx));
  return { name: column.name, kind: column.kind, align, x, width, budget };
}

/** `columns` laid out side by side, each at the sum of the widths before it. */
export function layOutAll(columns: readonly ColumnSpec[], sizes: Sizes = BASE_SIZES): LaidOutColumn[] {
  let x = 0;
  return columns.map((column) => {
    const laidOut = layOut(column, sizes, x);
    x += laidOut.width;
    return laidOut;
  });
}

/** `1567523` → `1,567,523`: the row numbers' format. */
export const formatCount = (value: number): string => value.toLocaleString('en-US');

/** The row-number gutter's width for `rows` rows. */
export const gutterWidth = (rows: number, sizes: Sizes = BASE_SIZES): number => estimate(sizes, formatCount(rows).length);
