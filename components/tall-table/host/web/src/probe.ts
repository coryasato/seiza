/** What the host publishes with `?perf`, as `tall-table-bridge`'s `js::probe`
 *  and `js::layout` write it (`top` in rows; `scrollX` and the layout in CSS
 *  px from the canvas's top-left). The page and `perf/` both read it. */
export interface Shown {
  rows: number;
  top: number;
  first: number;
  end: number;
  loaded: number;
  pending: number;
  failed: number;
  scrollX: number;
  /** With `select`: what's selected. */
  selection?: Selection | null;
}

/** With `select`, as `tall-table-bridge`'s `js::selection` writes it and
 *  the table's `fixtures/selection.json` spells it: each cell
 *  `[row, column]`, the anchor the active cell. `unknown` is a kind the
 *  table added and the bridge doesn't name yet. */
export interface Selection {
  kind: 'rows' | 'columns' | 'cells' | 'unknown';
  anchor: [number, number];
  head: [number, number];
}

export interface Layout {
  left: number;
  top: number;
  rowHeight: number;
  cellsWidth: number;
  columns: { name: string; x: number; width: number; kind: string; budget: number }[];
}

/** A drawn cell, as `tall-table-bridge`'s `js::cells` writes it: with
 *  `custom-cells`, its paint (colors 8-bit RGBA; the bar in CSS px from the
 *  cell's left), and with `live` too, its flash (its opacity in the alpha). */
export interface Cell {
  row: number;
  column: number;
  exact: string;
  shown: string;
  fill?: number[] | null;
  text?: number[] | null;
  bar?: { left: number; width: number; color: number[] } | null;
  flash?: number[] | null;
}

/** With `copy`, what became of the last copy, as `tall-table-bridge`'s
 *  `clipboard::Outcome::to_js` writes it (`__tallTableCopy`): `id` is the
 *  copy's (`null` when declined). */
export type CopyState =
  | { state: 'declined'; id: null; rows: number; columns: number }
  | { state: 'copying'; id: number; rows: number; rowsDone: number }
  | { state: 'writing' | 'written'; id: number; bytes: number }
  | { state: 'refused'; id: number; error: string }
  | { state: 'failed'; id: number; reason: 'too-large' | 'read' | 'cancelled' | 'closed'; bytes?: number; maxBytes?: number; error?: string }
  | { state: 'unavailable'; id: number };
