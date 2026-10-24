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
