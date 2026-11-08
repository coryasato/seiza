/**
 * Live tail's view (the tail level's, `view.ts` draws it there): its rows'
 * cells as `TailCells` (the data layer's `replay.ts`) answers them, the time
 * in the muted foreground and an error status in the scenario's error color
 * (`tail.css`, the color `tailCss`'s variables); the rows growing under the
 * scroll model (`setModelRows`) and the gutter with them; the scroller's
 * moves as the reader's (`TailReader`: a wheel, a key, or a touch down or
 * up, End and Home, a thumb drag and its release), which decide following
 * (`follow.ts`'s `readerMoved`), the paging's tail pin moving the scroller
 * (`TailReader.pin`); and with `?cells` the cells on screen as drawn
 * (`publishTailCells`), as the GPUI contender's probe publishes them.
 *
 * Only the tail level's build draws it: no other level's bundle carries it.
 */

import { createElement as h, memo, type ReactNode } from 'react';
import type { Contender } from '../../../../contract.ts';
import type { Oklch, TailScenario } from '../../../../scenarios.ts';
import type { CellValue } from './data/format.ts';
import { readerMoved } from './data/follow.ts';
import type { TablePaging } from './data/paging.ts';
import type { TablePage } from './data/table.ts';
import type { TableContract } from './contract.ts';
import { formatCount, type LaidOutColumn } from './layout.ts';
import { fromOklch, parseComputed } from './paint.ts';
import { hex, themeCss } from './scene.ts';
import type { ScaledScroller, ScrollOptions } from './scroll.ts';

/** What the view asks of the tail level's data layer (`replay.ts`). */
export interface TailCells {
  /** The file's columns laid out at the scenario's widths. */
  columns: LaidOutColumn[];
  /** A loaded cell's text in `column` (index `index`). */
  text(index: number, column: LaidOutColumn, value: CellValue): string;
  /** Whether the column is drawn muted (the time). */
  muted(index: number): boolean;
  /** Whether the cell is an error status (4xx or 5xx). */
  error(index: number, value: CellValue): boolean;
  /** Pauses (`true`) or resumes the clock's count: the scroll back's control. */
  pause(on: boolean): void;
  /** Set by the view: the clock set new rows on the paging (in the message's task). */
  rows: () => void;
  /** Set by the view: following turned on or off. */
  following: (on: boolean) => void;
}

/**
 * The scenario's error color per theme as a CSS variable (`--error`),
 * light and dark as `theme.css` switches its own: converted from Oklch to
 * sRGB here, once (as `marketCss`'s). A style element `main.ts` adds
 * before the view renders.
 */
export function tailCss(scenario: TailScenario): string {
  return themeCss((theme) => `--error: ${hex(fromOklch(...(scenario.error[theme] as Oklch)))};`);
}

interface TailRowProps {
  row: number;
  top: number;
  page: TablePage | null;
  index: number;
  failed: string | null;
  columns: LaidOutColumn[];
  gutter: number;
  measured: boolean;
  /** `?cells`: each loaded cell carries the exact text of its value (`data-exact`). */
  probed: boolean;
  cells: TailCells;
}

/** A live tail row: the base's row, its cells' text and color the tail
 *  level's. A grown page's rows past what its read held are placeholders,
 *  keyed apart from the loaded cells, as the base's. */
export const TailRow = /* @__PURE__ */ memo(function TailRow({ row, top, page, index, failed, columns, gutter, measured, probed, cells: tail }: TailRowProps): ReactNode {
  let cells: ReactNode;
  const value = (column: number) => page?.value(index, column);
  if (failed !== null) {
    cells = h('div', { className: 'failed', style: { left: gutter } }, `Couldn't load these rows: ${failed}`);
  } else if (!page || value(0) === undefined) {
    cells = columns.map((column) =>
      h('div', { key: `pending:${column.name}`, className: `cell pending ${column.align}`, style: { width: column.width } }, h('div', { className: 'bar' })),
    );
  } else {
    cells = columns.map((column, at) => {
      const cell = value(at);
      let className = `cell ${column.align}`;
      let text: string | undefined;
      if (cell === null) {
        className += ' null';
        text = 'NULL';
      } else if (cell !== undefined) {
        text = tail.text(at, column, cell);
        if (tail.muted(at)) className += ' muted';
        else if (tail.error(at, cell)) className += ' error';
      }
      // The value's exact text: the time's is its text, as the GPUI side's
      // page gives it.
      const exact = !probed || cell === undefined ? undefined : cell === null ? 'NULL' : tail.muted(at) ? text : String(cell);
      return h('div', { key: column.name, className, style: { width: column.width }, elementtiming: measured ? `row:${row}` : undefined, 'data-exact': exact }, text);
    });
  }
  return h(
    'div',
    { className: row % 2 === 1 ? 'row odd' : 'row', 'data-row': row, style: { transform: `translateY(${top}px)` } },
    h('div', { className: 'num', style: { width: gutter } }, formatCount(row + 1)),
    cells,
  );
});

/** The scroll model's members the rows' growth reads and writes, private to every other caller. */
interface ModelInside {
  readonly options: ScrollOptions;
  v: number;
  total: number;
  measure(): void;
  place(): void;
}

/** The rows the model holds (its last `setModelRows`). */
const modelRows = (model: ScaledScroller): number => (model as unknown as ModelInside).options.rows;

/** The rows the model shows, `[first, end)`: what the last commit drew,
 *  which the paging's top and rows can run ahead of until the next draw. */
export function drawnRows(model: ScaledScroller, rowHeight: number): [number, number] {
  const rows = modelRows(model);
  const first = Math.min(Math.floor(model.v / rowHeight), rows);
  return [first, Math.max(first, Math.min(Math.ceil((model.v + model.viewport) / rowHeight), rows))];
}

/** The model holds `rows` rows now: the spacer, T, and M follow, the
 *  content staying at V (a shrink clamps it). Nothing scrolls. */
export function setModelRows(model: ScaledScroller, rows: number): void {
  const inside = model as unknown as ModelInside;
  if (inside.options.rows === rows) return;
  (inside.options as { rows: number }).rows = rows;
  inside.measure();
  if (inside.v > inside.total) model.jumpTo(inside.total);
  else inside.place();
}

/** Tells the model's subscribers where it is again, at rest (the
 *  virtualizer, whose window of rows moves as the rows grow). */
export function renotify(model: ScaledScroller): void {
  for (const listener of (model as unknown as { listeners: Set<(v: number, scrolling: boolean) => void> }).listeners) listener(model.v, false);
}

/** The contract's targets follow the gutter, which grows with the rows. */
export function setContractGutter(contract: TableContract, gutter: number): void {
  (contract as unknown as { gutter: number }).gutter = gutter;
}

/**
 * The scroller's moves as the reader's, for following (the tall table's
 * `reader_moved`, from where each move lands): a scroll down (a wheel, a
 * key, a touch, the replay's step) keeps following or reaches the end, up
 * lets go (a move up at its wheel, key, or touch move);
 * End lands (at the end, so it follows), Home lets go, a jump lands; a thumb drag holds
 * it until its release (the paging's `startDrag` and `endDrag`, which
 * decide it); a wheel more sideways than vertical leaves it as it is. A
 * move the view makes itself (the pin, a resize) is no reader's.
 */
export class TailReader {
  private readonly paging: TablePaging<TablePage>;
  private readonly model: ScaledScroller;
  private readonly scroller: HTMLElement;
  private readonly rowHeight: number;
  /** The V the paging was last moved to. */
  private last = 0;
  /** End or Home pressed: the next move is that key's. */
  private key: 'land' | 'up' | null = null;
  /** The view moves the scroller itself: no reader's move. */
  private own = false;
  /** The last wheel was more sideways than vertical. */
  private sideways = false;
  /** A jump (`jumpTo`: the replay's, the virtualizer's) moves the model:
   *  a landing, as the table's `jump_to`. */
  private jumping = false;
  /** The last touch's y, for a touch move's direction. */
  private touchY: number | null = null;
  private readonly jumpTo: ScaledScroller['jumpTo'];

  constructor(paging: TablePaging<TablePage>, model: ScaledScroller, scroller: HTMLElement, rowHeight: number) {
    this.paging = paging;
    this.model = model;
    this.scroller = scroller;
    this.rowHeight = rowHeight;
    this.last = model.v;
    // Every jump through the model, told apart from a scroll.
    this.jumpTo = model.jumpTo;
    model.jumpTo = (v) => {
      this.jumping = true;
      try {
        this.jumpTo.call(model, v);
      } finally {
        this.jumping = false;
      }
    };
    // Capture: before the model's own listener moves the content.
    scroller.addEventListener('keydown', this.onKey, { capture: true });
    scroller.addEventListener('wheel', this.onWheel, { capture: true, passive: true });
    scroller.addEventListener('touchstart', this.onTouch, { capture: true, passive: true });
    scroller.addEventListener('touchmove', this.onTouch, { capture: true, passive: true });
  }

  destroy(): void {
    this.model.jumpTo = this.jumpTo;
    this.scroller.removeEventListener('keydown', this.onKey, { capture: true });
    this.scroller.removeEventListener('wheel', this.onWheel, { capture: true });
    this.scroller.removeEventListener('touchstart', this.onTouch, { capture: true });
    this.scroller.removeEventListener('touchmove', this.onTouch, { capture: true });
  }

  /** The model moved to `v`: the paging follows it, the reader's move
   *  deciding following first. */
  moved(v: number): void {
    const model = this.model;
    const from = this.last;
    this.last = v;
    // The view's own move (the pin, a resize): the paging is where it
    // goes already, or `sync` puts the scroller where the paging is.
    if (this.own) return;
    // A notify that didn't move it (the model at rest) moves nothing, but
    // End at the end lands there again: it follows, moved or not.
    if (v === from && !this.key) return;
    // At the model's end, the reader reached the end (End, a scroll to the
    // bottom): following decides on the paging's end. But the paging moves
    // to the end of the rows the model holds, which the paging's run ahead
    // of until the next frame's draw (`setModelRows`), so the move is never
    // to rows not drawn yet; following, the pin moves it on as they land.
    const atEnd = v >= model.total - 0.5;
    const top = atEnd ? Math.max(0, modelRows(model) - model.viewport / this.rowHeight) : v / this.rowHeight;
    // Any other move is a scroll event's, and every scroll the view didn't
    // make is the reader's (a wheel's may arrive after the model's input
    // window, WebKit's among them); a thumb drag's the paging holds.
    const reach = this.key ?? (this.jumping ? 'land' : model.source === 'wheel' && this.sideways ? null : v > from ? 'down' : 'up');
    if (reach) readerMoved(this.paging, reach, atEnd ? this.paging.maxTop() : top);
    this.key = null;
    this.paging.moveTopTo(top);
  }

  /** Runs `move`, a move of the view's own (the pin, a resize): no
   *  reader's, and the paging stays where it is. */
  asOwn(move: () => void): void {
    this.own = true;
    try {
      move();
    } finally {
      this.own = false;
    }
  }

  /** The paging's top moved without the model (the tail pin, a resize's
   *  kept bottom): the scroller follows it. */
  sync(): void {
    const v = Math.min(this.paging.top() * this.rowHeight, this.model.total);
    if (Math.abs(v - this.model.v) < 0.5) return;
    this.asOwn(() => this.model.jumpTo(this.paging.top() >= this.paging.maxTop() ? this.model.total : v));
  }

  private onKey = (event: KeyboardEvent): void => {
    if (event.key === 'End' || (event.metaKey && event.key === 'ArrowDown')) this.key = 'land';
    else if (event.key === 'Home' || (event.metaKey && event.key === 'ArrowUp')) this.key = 'up';
    else {
      // A key up lets go at the key, as a wheel up does.
      if (!event.altKey && !event.ctrlKey && !event.metaKey && (event.key === 'ArrowUp' || event.key === 'PageUp' || (event.key === ' ' && event.shiftKey))) this.up();
      return;
    }
    // The model's jump answers it in this event's dispatch, or never.
    queueMicrotask(() => (this.key = null));
  };

  private onWheel = (event: WheelEvent): void => {
    this.sideways = event.deltaY !== 0 && Math.abs(event.deltaX) > Math.abs(event.deltaY);
    if (event.deltaY < 0 && !this.sideways && !event.shiftKey) this.up();
  };

  /** A finger moving down the screen scrolls the rows up: it lets go at
   *  its move, as a wheel up does. */
  private onTouch = (event: TouchEvent): void => {
    const y = event.touches[0]?.clientY;
    if (y === undefined) return;
    if (event.type === 'touchmove' && this.touchY !== null && y > this.touchY) this.up();
    this.touchY = y;
  };

  /** A move up lets go at its input, as the table's `scroll_by` decides
   *  before it moves: while following, the pin moves the scroller every
   *  frame, and its jump can land in the frame the browser scrolled for the
   *  input, so the scroll event reads the pin's position and no move
   *  (WebKit). A move down decides at its scroll event, from where it lands. */
  private up(): void {
    readerMoved(this.paging, 'up', this.paging.top());
  }
}

/** A computed color as 8-bit channels, the alpha too. */
const rgba8 = (color: string): number[] => {
  const { r, g, b, a } = parseComputed(color);
  return [r, g, b, a].map((channel) => Math.round(channel * 255));
};

/**
 * `?cells` on the tail level: the loaded cells on screen as drawn, on
 * `__contender.cells`, as the GPUI contender's cell probe publishes them
 * (`row`, `column`, `exact`: the value's exact text, `shown`: the cell's
 * text, `text`: its color where the scene paints it (the time, an error
 * status), else null; 8-bit `[r, g, b, a]`), and the columns' geometry on
 * `__contender.columns`. A getter, read from the DOM each time.
 */
export function publishTailCells(scroller: HTMLElement, columns: readonly LaidOutColumn[]): void {
  const contender = (globalThis as { __contender?: Contender & { cells?: unknown; columns?: unknown } }).__contender;
  if (!contender) return;
  contender.columns = columns.map(({ name, x, width, kind }) => ({ name, x, width, kind }));
  Object.defineProperty(contender, 'cells', { configurable: true, enumerable: true, get: () => drawnCells(scroller) });
}

function drawnCells(scroller: HTMLElement) {
  const box = scroller.getBoundingClientRect();
  const head = scroller.querySelector('.head')?.getBoundingClientRect().height ?? 0;
  const top = box.top + scroller.clientTop + head;
  const bottom = box.top + scroller.clientTop + scroller.clientHeight;
  const cells: { row: number; column: number; exact: string; shown: string; text: number[] | null }[] = [];
  for (const element of scroller.querySelectorAll<HTMLElement>('.content > .row')) {
    const row = Number(element.dataset.row);
    const rowBox = element.getBoundingClientRect();
    if (rowBox.bottom <= top || rowBox.top >= bottom) continue;
    element.querySelectorAll<HTMLElement>(':scope > .cell').forEach((cell, column) => {
      const exact = cell.dataset.exact;
      if (exact === undefined) return;
      const painted = cell.classList.contains('muted') || cell.classList.contains('error');
      cells.push({ row, column, exact, shown: cell.textContent ?? '', text: painted ? rgba8(getComputedStyle(cell).color) : null });
    });
  }
  return cells;
}
