/**
 * What a row shows, apart from React: its page's state turned into each
 * cell's text. Kept pure, so the node tests run it (`test/view.test.ts`).
 */

import { exactText, shownText, type CellValue } from './data/format.ts';
import type { RowState } from './data/pages.ts';
import type { LaidOutColumn } from './layout.ts';

/** A page as the view reads it: `value` is undefined past its end. */
export interface ShownPage {
  value(row: number, column: number): CellValue | undefined;
}

/** A loaded cell: its text, muted for a NULL. A cell past a short page's
 *  end is missing (no text), not a NULL: the value isn't known. */
export type Cell = { text: string; muted: boolean } | null;

export type ShownRow =
  | { kind: 'loaded'; cells: Cell[] }
  | { kind: 'pending' }
  | { kind: 'failed'; message: string };

/** The row in `state`, as its cells' text in `columns`' order. */
export function shownRow(state: RowState<ShownPage>, columns: readonly LaidOutColumn[]): ShownRow {
  if (state.kind !== 'loaded') return state;
  const cells = columns.map((column, index): Cell => {
    const value = state.page.value(state.index, index);
    if (value === undefined) return null;
    return { text: shownText(column.kind, value, column.budget), muted: value === null };
  });
  return { kind: 'loaded', cells };
}

/** A tooltip shows at most this many characters of a value, so a long
 *  text doesn't build a wall (the tall table's `TOOLTIP_CHARS`). */
const TOOLTIP_CHARS = 2000;

/**
 * The exact text a loaded cell's tooltip would show, and whether the cell
 * already differs from it (a float rounded to its column, text with line
 * breaks shown on one line): the tall table's `tooltip_for`. Null for a
 * NULL or a missing cell, which never get one. A cell that differs in
 * nothing still gets the tooltip if its text is cut, which only the drawn
 * cell can tell.
 */
export function cellTooltip(column: LaidOutColumn, value: CellValue | undefined): { text: string; differs: boolean } | null {
  if (value === null || value === undefined) return null;
  const shown = shownText(column.kind, value, column.budget);
  const exact = column.kind === 'float' && typeof value === 'number' ? exactText(value) : typeof value === 'string' ? value : shown;
  const chars = [...exact];
  const text = chars.length > TOOLTIP_CHARS ? `${chars.slice(0, TOOLTIP_CHARS).join('')}…` : exact;
  return { text, differs: shown !== exact };
}
