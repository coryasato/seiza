/**
 * `select` (the wide level's): one range of rows, columns, or cells, from an
 * anchor (the active cell) to a head, as the tall table selects it
 * (`components/tall-table/src/selection.rs`, `state/select.rs`). A press on
 * a cell, a row's number, a header, or the corner starts it; Shift+press and
 * a drag move its head; the keys move either. Pure: the view hands it the
 * geometry at each input (`SheetView`) and moves the scroller where it says
 * (`SelectHost`), so `selection.json` runs against it in Node
 * (`test/fixtures.test.ts`); `wide-tools.ts` binds it to the DOM.
 *
 * Coordinates are the table's: x from the cells' left (right of the row
 * numbers), y from the rows' top (under the header), CSS px.
 */

import type { Pin, Placed } from './pin.ts';

export type Kind = 'rows' | 'columns' | 'cells';
/** A cell: `[row, column]`. */
export type Cell = readonly [number, number];

/** What's selected, as `selection.json` spells it. */
export interface Selection {
  readonly kind: Kind;
  readonly anchor: Cell;
  readonly head: Cell;
}

/** Which kinds a reader can select (the table's `Selectable`). */
export interface Selectable {
  rows: boolean;
  columns: boolean;
  cells: boolean;
}

export const ALL_KINDS: Selectable = { rows: true, columns: true, cells: true };

/** `selection.json`'s negative controls; only the fixture test sets one. */
export type SelectControl = 'loop' | 'center' | 'plain-moves-head' | 'extend-across' | 'keep-past-rows' | null;

/** The table as the selection reads it at an input. */
export interface SheetView {
  rows: number;
  /** The columns laid out, `x` from the cells' left. */
  columns: readonly Placed[];
  /** The pinned run in effect. */
  pin: Pin;
  /** The cells' width: right of the row numbers, left of the vertical scrollbar. */
  cellsWidth: number;
  /** The rows' viewport height, px. */
  viewHeight: number;
  rowHeight: number;
  /** The top row, fractional. */
  top: number;
  scrollX: number;
  maxScrollX: number;
}

export interface SelectHost {
  view(): SheetView;
  /** Moves the view to the top row `top` and the sideways scroll `scrollX`,
   *  each already clamped: a key's move, through the base's scroll paths. */
  scrollTo(top: number, scrollX: number): void;
  /** The selection changed. */
  changed(selection: Selection | null): void;
}

/** A key's move. */
export type Step = 'up' | 'down' | 'left' | 'right' | 'pageUp' | 'pageDown' | 'first' | 'last';

/** A press's modifiers and its click count (a double-click's second is 2). */
export interface Press {
  shift?: boolean;
  ctrl?: boolean;
  clicks?: number;
}

type Target = { on: 'cell' | 'gutter' | 'header'; cell: Cell } | { on: 'corner' };

const spansRows = (kind: Kind): boolean => kind !== 'columns';
const spansColumns = (kind: Kind): boolean => kind !== 'rows';

/** `[first, last]` of `a` and `b`. */
const between = (a: number, b: number): [number, number] => [Math.min(a, b), Math.max(a, b)];

/** `selection` as `selection.json` and the contract spell it. */
export const selectionJson = (selection: Selection | null) => (selection ? { kind: selection.kind, anchor: [...selection.anchor], head: [...selection.head] } : null);

/** The rows `selection` covers in a table of `rows`, `[first, last]`; null if none. */
export function selectedRows(selection: Selection, rows: number): [number, number] | null {
  if (rows <= 0) return null;
  const [start, end] = selection.kind === 'columns' ? [0, rows - 1] : between(selection.anchor[0], selection.head[0]);
  const last = Math.min(end, rows - 1);
  return start <= last ? [start, last] : null;
}

/** The columns it covers in a table of `columns`, `[first, last]`; null if none. */
export function selectedColumns(selection: Selection, columns: number): [number, number] | null {
  if (columns <= 0) return null;
  const [start, end] = selection.kind === 'rows' ? [0, columns - 1] : between(selection.anchor[1], selection.head[1]);
  const last = Math.min(end, columns - 1);
  return start <= last ? [start, last] : null;
}

/** The smallest kind that's on and holds a cell, else its row, else (`columnToo`, a key's) its column. */
function smallest(selectable: Selectable, columnToo: boolean): Kind | null {
  if (selectable.cells) return 'cells';
  if (selectable.rows) return 'rows';
  return columnToo && selectable.columns ? 'columns' : null;
}

const same = (a: Selection | null, b: Selection | null): boolean =>
  a === b || (a !== null && b !== null && a.kind === b.kind && a.anchor[0] === b.anchor[0] && a.anchor[1] === b.anchor[1] && a.head[0] === b.head[0] && a.head[1] === b.head[1]);

export class Selector {
  selection: Selection | null = null;
  selectable: Selectable;
  /** A drag selecting: which of the head's coordinates follow the pointer. */
  private selecting: { rows: boolean; columns: boolean } | null = null;
  /** Where the pointer was at the drag's last move (for a scroll during it). */
  private pointer: [number, number] | null = null;
  private readonly host: SelectHost;
  private readonly control: SelectControl;

  constructor(host: SelectHost, selectable: Selectable = ALL_KINDS, control: SelectControl = null) {
    this.host = host;
    this.selectable = selectable;
    this.control = control;
  }

  /** Whether a drag is selecting. */
  get dragging(): boolean {
    return this.selecting !== null;
  }

  /** Every change but a drag's own: a new selection ends a drag. */
  private replace(selection: Selection | null): void {
    if (same(this.selection, selection)) return;
    this.selecting = null;
    this.set(selection);
  }

  private set(selection: Selection | null): void {
    if (same(this.selection, selection)) return;
    this.selection = selection;
    this.host.changed(selection);
  }

  // --- the pointer ---

  /** The cell nearest (x, y): clamped to the visible cells, past the last column the last. */
  private cellClamped(view: SheetView, x: number, y: number): Cell | null {
    const { rows, columns } = view;
    if (rows <= 0 || columns.length === 0) return null;
    const cx = view.pin.contentX(Math.min(Math.max(x, 0), Math.max(view.cellsWidth - 0.5, 0)), view.scrollX);
    const cy = Math.min(Math.max(y, 0), Math.max(view.viewHeight - 0.5, 0));
    const row = Math.floor(view.top + cy / view.rowHeight);
    let column = columns.findIndex((placed) => cx < placed.x + placed.width);
    if (column < 0) column = columns.length - 1;
    return [Math.min(row, rows - 1), column];
  }

  /** The first visible cell: the top row, the leftmost column. */
  private firstVisible(view: SheetView): Cell | null {
    return this.cellClamped(view, 0, 0);
  }

  /** The cell under (x, y), the hover's hit test: none outside the cells. */
  private cellAt(view: SheetView, x: number, y: number): Cell | null {
    if (!(x >= 0 && x < view.cellsWidth && y >= 0 && y < view.viewHeight)) return null;
    const row = Math.floor(view.top + y / view.rowHeight);
    const cx = view.pin.contentX(x, view.scrollX);
    const column = view.columns.findIndex((placed) => cx >= placed.x && cx < placed.x + placed.width);
    return column >= 0 && row < view.rows ? [row, column] : null;
  }

  /** What a press at (x, y) is on: a cell, a row's number, a header (the
   *  row above the rows), or the corner; past the last row or column, nothing. */
  private targetAt(view: SheetView, x: number, y: number): Target | null {
    const rowH = view.rowHeight;
    if (x >= 0) {
      if (y >= 0) {
        const cell = this.cellAt(view, x, y);
        return cell ? { on: 'cell', cell } : null;
      }
      const last = view.columns.at(-1);
      const past = !(last && view.pin.contentX(x, view.scrollX) < last.x + last.width);
      if (y < -rowH || x >= view.cellsWidth || past) return null;
      const cell = this.cellClamped(view, x, y);
      return cell ? { on: 'header', cell } : null;
    }
    if (y < 0) return y >= -rowH ? { on: 'corner' } : null;
    const row = Math.floor(view.top + y / rowH);
    if (y >= view.viewHeight || row >= view.rows) return null;
    const cell = this.cellClamped(view, x, y);
    return cell ? { on: 'gutter', cell } : null;
  }

  /** Whether a press at (x, y) is on the table's cells, its row numbers, or
   *  its header: the view takes it from the browser then. */
  onTable(x: number, y: number): boolean {
    return this.targetAt(this.host.view(), x, y) !== null;
  }

  /** A left press. Ctrl+press (a Mac browser's right-click) and a
   *  double-click's second press select nothing; Cmd+press is a plain one. */
  press(x: number, y: number, press: Press = {}): void {
    if (press.ctrl || (press.clicks ?? 1) >= 2) return;
    const view = this.host.view();
    const target = this.targetAt(view, x, y);
    if (!target) return;
    if (target.on === 'corner') {
      this.selectAll();
      return;
    }
    const { cell } = target;
    const picksRows = target.on !== 'header';
    const picksColumns = target.on !== 'gutter';
    this.pointer = [x, y];
    // Shift: the head moves to the press, along what the press picked and the range spans.
    const current = this.selection;
    if (press.shift && current) {
      const selecting = { rows: picksRows && spansRows(current.kind), columns: picksColumns && spansColumns(current.kind) };
      if (selecting.rows || selecting.columns) {
        this.selecting = selecting;
        this.headTo(cell);
      }
      return;
    }
    const kind = target.on === 'cell' ? smallest(this.selectable, false) : target.on === 'gutter' ? (this.selectable.rows ? 'rows' : null) : this.selectable.columns ? 'columns' : null;
    if (!kind) return;
    this.replace({ kind, anchor: cell, head: cell });
    this.selecting = { rows: picksRows && spansRows(kind), columns: picksColumns && spansColumns(kind) };
  }

  /** The head's coordinates the drag follows move to `cell`'s. */
  private headTo(cell: Cell): void {
    const { selecting, selection } = this;
    if (!selecting || !selection) return;
    const head: Cell = [selecting.rows ? cell[0] : selection.head[0], selecting.columns ? cell[1] : selection.head[1]];
    this.set({ kind: selection.kind, anchor: selection.anchor, head });
  }

  /** The pointer moved to (x, y) during a drag: the head follows the cell
   *  under it, clamped to the visible cells. */
  dragTo(x: number, y: number): void {
    if (!this.selecting) return;
    this.pointer = [x, y];
    const cell = this.cellClamped(this.host.view(), x, y);
    if (cell) this.headTo(cell);
  }

  /** The view scrolled during a drag (a wheel): the head follows the cell
   *  now under the pointer, at (x, y) if given. */
  scrolled(x?: number, y?: number): void {
    if (!this.selecting) return;
    if (x !== undefined && y !== undefined) this.pointer = [x, y];
    if (this.pointer) this.dragTo(this.pointer[0], this.pointer[1]);
  }

  release(): void {
    this.selecting = null;
  }

  // --- the keys ---

  /** Cmd+A, Ctrl+A, and the corner: every column, else every row, else every cell. */
  selectAll(): boolean {
    const view = this.host.view();
    const first = this.firstVisible(view);
    if (!first) return false;
    const lastRow = view.rows - 1;
    const lastColumn = view.columns.length - 1;
    const { rows, columns, cells } = this.selectable;
    const selection: Selection | null = columns
      ? { kind: 'columns', anchor: [first[0], 0], head: [first[0], lastColumn] }
      : rows
        ? { kind: 'rows', anchor: [0, first[1]], head: [lastRow, first[1]] }
        : cells
          ? { kind: 'cells', anchor: [0, 0], head: [lastRow, lastColumn] }
          : null;
    if (!selection) return false;
    this.replace(selection);
    return true;
  }

  /** Escape: clears; with nothing selected it isn't the selection's (false). */
  escape(): boolean {
    if (!this.selection) return false;
    this.replace(null);
    return true;
  }

  /** A key's move: the active cell (collapsing to the smallest kind that
   *  holds it) or with `extend` the head (along the range's direction only),
   *  stopping at the ends, then scrolled into view the least distance. With
   *  nothing selected an arrow selects the first visible cell without
   *  moving, and the other keys are the base's (false: not handled). */
  key(step: Step, extend: boolean): boolean {
    const any = this.selectable.rows || this.selectable.columns || this.selectable.cells;
    if (!any) return false;
    const view = this.host.view();
    const selection = this.selection;
    if (!selection) {
      if (step !== 'up' && step !== 'down' && step !== 'left' && step !== 'right') return false;
      const kind = smallest(this.selectable, true);
      const cell = this.firstVisible(view);
      if (kind && cell) this.replace({ kind, anchor: cell, head: cell });
      return true;
    }
    if (view.rows <= 0 || view.columns.length === 0) return true;
    const lastRow = view.rows - 1;
    const lastColumn = view.columns.length - 1;
    const { kind } = selection;
    const vertical = step !== 'left' && step !== 'right';
    if (extend && this.control !== 'extend-across' && !(vertical ? spansRows(kind) : spansColumns(kind))) return true;
    const movesHead = extend || this.control === 'plain-moves-head';
    const at = movesHead ? selection.head : selection.anchor;
    const from: Cell = [Math.min(at[0], lastRow), Math.min(at[1], lastColumn)];
    const page = this.pageStep(view);
    const wraps = this.control === 'loop';
    const to: Cell =
      step === 'up' && wraps && from[0] === 0 ? [lastRow, from[1]]
      : step === 'down' && wraps && from[0] === lastRow ? [0, from[1]]
      : step === 'up' ? [Math.max(from[0] - 1, 0), from[1]]
      : step === 'down' ? [Math.min(from[0] + 1, lastRow), from[1]]
      : step === 'left' ? [from[0], Math.max(from[1] - 1, 0)]
      : step === 'right' ? [from[0], Math.min(from[1] + 1, lastColumn)]
      : step === 'pageUp' ? [Math.max(from[0] - page, 0), from[1]]
      : step === 'pageDown' ? [Math.min(from[0] + page, lastRow), from[1]]
      : step === 'first' ? [0, from[1]]
      : [lastRow, from[1]];
    if (to[0] === from[0] && to[1] === from[1]) return true;
    if (movesHead) {
      this.replace({ kind, anchor: selection.anchor, head: to });
    } else {
      const collapsed = smallest(this.selectable, true);
      if (!collapsed) return true;
      this.replace({ kind: collapsed, anchor: to, head: to });
    }
    // The base's page scroll, then into view, as one move.
    let top = view.top;
    let scrollX = view.scrollX;
    const maxTop = Math.max(0, view.rows - view.viewHeight / view.rowHeight);
    const pageRows = this.pageRows(view);
    if (step === 'pageUp') top = clamp(top - pageRows, 0, maxTop);
    if (step === 'pageDown') top = clamp(top + pageRows, 0, maxTop);
    // Along what moved: an extended range's head only along its direction.
    const [rows, columns] = movesHead ? [spansRows(kind), spansColumns(kind)] : [true, true];
    if (rows) top = clamp(this.rowIntoView(view, to[0], top), 0, maxTop);
    const column = columns ? view.columns[to[1]] : undefined;
    if (column) {
      const move = view.pin.intoView(to[1], column.x, column.width, scrollX, view.cellsWidth);
      if (move !== 0) scrollX = clamp(scrollX + move, 0, view.maxScrollX);
    }
    if (top !== view.top || scrollX !== view.scrollX) this.host.scrollTo(top, scrollX);
    return true;
  }

  /** The base's page: the rows in view less one, at least one. */
  private pageRows(view: SheetView): number {
    return Math.max(view.viewHeight / view.rowHeight - 1, 1);
  }

  /** The rows a page key moves by: the base's page, whole. */
  private pageStep(view: SheetView): number {
    return Math.max(Math.floor(this.pageRows(view)), 1);
  }

  /** The top that shows `row` the least distance from `top`. */
  private rowIntoView(view: SheetView, row: number, top: number): number {
    const viewRows = view.viewHeight / view.rowHeight;
    if (this.control === 'center') return row + 0.5 - viewRows / 2;
    if (row < top) return row;
    if (row + 1 > top + viewRows) return row + 1 - viewRows;
    return top;
  }

  // --- the table's own changes ---

  /** A jump landed on `row`: the row is selected (rows on), else its cell
   *  (cells on: the active cell's column, else the first visible). */
  jumped(row: number): void {
    const kind: Kind | null = this.selectable.rows ? 'rows' : this.selectable.cells ? 'cells' : null;
    const view = this.host.view();
    if (!kind || view.rows <= 0) return;
    const column = this.selection ? this.selection.anchor[1] : (this.firstVisible(view)?.[1] ?? 0);
    const cell: Cell = [Math.min(row, view.rows - 1), column];
    this.replace({ kind, anchor: cell, head: cell });
  }

  /** The rows are now `rows`: a `rows` or `cells` range loses those past the
   *  end (a corner past it moves to the last row), one wholly past it goes;
   *  a `columns` range covers every row. */
  rowsChanged(rows: number): void {
    if (this.control === 'keep-past-rows') return;
    const selection = this.selection;
    if (!selection || selection.kind === 'columns') return;
    const { anchor, head } = selection;
    const last = rows - 1;
    this.replace(last >= 0 && Math.min(anchor[0], head[0]) <= last ? { kind: selection.kind, anchor: [Math.min(anchor[0], last), anchor[1]], head: [Math.min(head[0], last), head[1]] } : null);
  }

  /** New columns: the selection goes. */
  columnsChanged(): void {
    this.replace(null);
  }
}

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);
