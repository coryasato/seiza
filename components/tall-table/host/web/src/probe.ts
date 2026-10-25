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
  bar?: { left: number; width: number } | null;
  flash?: number[] | null;
}
