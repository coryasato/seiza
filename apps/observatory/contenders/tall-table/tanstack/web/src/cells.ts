/**
 * What a row shows, apart from React: its page's state turned into each
 * cell's text. Kept pure, so the node tests run it (`test/view.test.ts`).
 */

import { shownText, type CellValue } from './data/format.ts';
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
