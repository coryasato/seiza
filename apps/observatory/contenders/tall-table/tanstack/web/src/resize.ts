/**
 * `resize` (the wide level's): a column's width dragged at its header edge,
 * and fitted to what's drawn by a double-click there, as the tall table
 * resizes it (`components/tall-table/src/state/resize.rs`). Pure: the drag's
 * width at each pointer move, a pinned column's limit, and the fit's width
 * from the texts' widths the view measures; `wide-tools.ts` binds it to the
 * bands, and `cells.json`'s `resize` section pins the widths it lays out
 * (`test/fixtures.test.ts`).
 */

import { exactText, shownText, type CellKind, type CellValue } from './data/format.ts';
import { MAX_WIDTH, clampWidth, leastWidth, padOf, type LaidOutColumn, type Sizes } from './layout.ts';

/** The band's reach on each side of its 1 px hairline. */
export const BAND_PADDING = 4;

/** A column drag in progress. */
export interface Resizing {
  column: number;
  /** The pointer's x at the press. */
  pressX: number;
  /** The column's width at the press, as drawn. */
  width: number;
  /** Its set width at the press (undefined: its kind's). */
  was: number | undefined;
  /** The widest a pinned column may go: so wide that the run reaches half
   *  the cells' width, as they were at the press (Infinity unpinned). */
  pinLimit: number;
}

/** A press on `column`'s band at `x`: the drag it starts. `pinEdge` and
 *  `cellsWidth` are the run's at the press; `pinned` whether the column is in it. */
export function pressBand(column: number, x: number, laidOut: LaidOutColumn, was: number | undefined, pinned: boolean, pinEdge: number, cellsWidth: number): Resizing {
  return { column, pressX: x, width: laidOut.width, was, pinLimit: pinned ? cellsWidth / 2 - (pinEdge - laidOut.width) : Infinity };
}

/** The set width at pointer x: the width at the press plus the move,
 *  clamped. Back at the press's x, the set width it had; a column drawn
 *  outside the range (its kind's width, never clamped) holds until the
 *  pointer brings it inside, so it never jumps to the bound it's past. A
 *  pinned column never narrower than at the press for its limit, so one
 *  pinned past the half only holds. */
export function dragWidth(resizing: Resizing, x: number, sizes: Sizes): number | undefined {
  const start = resizing.width;
  const raw = start + x - resizing.pressX;
  const least = leastWidth(sizes);
  const outside = (start < least && raw < least) || (start > MAX_WIDTH && raw > MAX_WIDTH);
  if (x === resizing.pressX || outside) return resizing.was;
  return Math.min(clampWidth(raw, sizes), Math.max(resizing.pinLimit, start));
}

/** Whether a kind's values are numbers (the table's `numeric`). */
const numeric = (kind: CellKind): boolean => kind === 'float' || kind === 'integer';

/**
 * The fit: `column`'s width for its header's name and `values` (its
 * visible, loaded rows'), clamped. A numeric value by its exact text's
 * characters at the number advance, rounded up (so a float's budget holds
 * every digit); any other text, and the name, by `measure` (the browser's
 * width in the cells' font), cut first to as many characters as could reach
 * the max (no glyph is under 2 px). Each plus the padding and a pixel.
 */
export function fitWidth(column: LaidOutColumn, values: Iterable<CellValue>, sizes: Sizes, measure: (text: string) => number): number {
  const padding = 2 * padOf(sizes);
  const maxChars = Math.max(Math.floor(MAX_WIDTH / 2), 1);
  const shaped = (value: CellValue): number => {
    const cut = typeof value === 'string' ? [...value].slice(0, maxChars).join('') : value;
    return Math.ceil(measure(shownText(column.kind, cut, column.budget)) + padding + 1);
  };
  let widest = shaped(column.name);
  for (const value of values) {
    const width =
      numeric(column.kind) && value !== null
        ? Math.ceil([...(typeof value === 'number' && column.kind === 'float' ? exactText(value) : String(value))].length * sizes.numberPx + padding + 1)
        : shaped(value);
    widest = Math.max(widest, width);
  }
  return clampWidth(widest, sizes);
}
