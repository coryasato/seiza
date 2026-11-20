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
  /** The last visible row's first cell, if loaded. */
  lastCell?: string | null;
  scrollX: number;
  /** With `select`: what's selected. */
  selection?: Selection | null;
  /** With `sort`: the order the rows are read in. */
  sort?: Sort | null;
  /** With `find`: the term (null for none), the current match (its row
   *  and its column's index), and whether a step is out. */
  find?: { term: string | null; current: { row: number; column: number } | null; out: boolean };
  /** With `popover`: the open popover, or null. */
  popover?: Popover | null;
  /** With `popover`: the drawn cue (its cell and its box), or null. */
  cue?: { cell: { row: number; column: number }; bounds: [number, number, number, number] } | null;
}

/** With `popover`, as `tall-table-bridge`'s `js::probe` writes it: its
 *  cell (row and column index), its bounds and its button's `[x, y,
 *  width, height]` in CSS px of the window (`button` null without one),
 *  below its cell or flipped above, its text's characters (the cut's "…"
 *  among them) and whether it was cut, its scroll and its text's whole
 *  height in px. */
export interface Popover {
  cell: { row: number; column: number };
  bounds: [number, number, number, number];
  below: boolean;
  chars: number;
  cut: boolean;
  scroll: number;
  contentHeight: number;
  button: [number, number, number, number] | null;
}

/** With `sort`, as `tall-table-bridge`'s `js::sort` writes it: the
 *  column's index among the table's columns. */
export interface Sort {
  column: number;
  direction: 'ascending' | 'descending';
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
  /** With `pin`: the columns pinned in effect. The first `pinned` are
   *  drawn at `left + x` whatever the sideways scroll; the rest at
   *  `left + x - scrollX`, clipped at the run's edge. */
  pinned?: number;
  /** With `sort`, each column's `arrow`: its box in CSS px from the
   *  column's left edge, `null` where none is drawn. With `reorder`, each
   *  one's `index` among the table's columns: the list is in drawn order,
   *  each at its place. With `hide`, each one's `hidden`: laid out at
   *  width 0, drawn nowhere. */
  columns: { name: string; x: number; width: number; kind: string; budget: number; arrow?: { x: number; width: number } | null; index?: number; hidden?: boolean }[];
  /** With `format`: each character a format writes, its advance in CSS
   *  px in the cells' font at the text in effect (what a formatted text's
   *  fit sums). */
  advances?: Record<string, number>;
  /** With `group-headers`: the header's rows, each `rowHeight`: the
   *  groups' levels and the names' row, at the bottom. */
  headerRows?: number;
}

/** With `group-headers`, a group cell drawn, as `tall-table-bridge`'s
 *  `js::groups` writes them (`__tallTableGroups`, level by level): its
 *  level (0 at the top) and label, its run's places `start..end` (both
 *  halves of a run split at `pin`'s edge share them), its region, and its
 *  visible part's `left` and `width` and its label's `labelX`, in CSS px
 *  from the cells area's left. */
export interface GroupCell {
  level: number;
  label: string;
  start: number;
  end: number;
  pinned: boolean;
  left: number;
  width: number;
  labelX: number;
}

/** With `clicks`, the last press, as `tall-table-bridge`'s `js::click`
 *  writes it (`__tallTableClick`): `column` its place; `row` and `column`
 *  `null` where the target has none; a group's (`group-headers`) `level`
 *  and run's places `start..end`, `null` for another target; `x` and `y`
 *  the pointer in CSS px of the window; `count` one more at each press. */
export interface Click {
  kind: 'press' | 'double' | 'context' | 'unknown';
  target: 'cell' | 'row' | 'column' | 'corner' | 'blank' | 'group' | 'unknown';
  row: number | null;
  column: number | null;
  level: number | null;
  start: number | null;
  end: number | null;
  x: number;
  y: number;
  modifiers: ('control' | 'alt' | 'shift' | 'platform')[];
  count: number;
}

/** A drawn cell, as `tall-table-bridge`'s `js::cells` writes it (`column`
 *  its place; with `reorder`, the layout's `index` there names it): with
 *  `custom-cells`, its paint (colors 8-bit RGBA; the bar in CSS px from the
 *  cell's left), and with `live` too, its flash (its opacity in the alpha).
 *  With `find`, what's drawn of the find (`found`: null for nothing, `cell`
 *  for the cell tinted whole, else each occurrence's byte range of `shown`)
 *  and whether it's the current match. */
export interface Cell {
  row: number;
  column: number;
  exact: string;
  shown: string;
  fill?: number[] | null;
  text?: number[] | null;
  bar?: { left: number; width: number; color: number[] } | null;
  flash?: number[] | null;
  found?: 'cell' | [number, number][] | null;
  current?: boolean;
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
