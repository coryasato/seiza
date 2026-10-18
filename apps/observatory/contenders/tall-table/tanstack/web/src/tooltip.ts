/**
 * The cells' tooltip, as the tall table shows it
 * (`components/tall-table/src/state.rs`: `hover_at`, `hide_tooltip`,
 * `decide_tooltip`, `render_tooltip`): one tooltip, for the hovered cell, with
 * a rounded, one-lined, or cut value's exact text. It shows once the pointer
 * has rested on the cell 500 ms and the cell's page is loaded, or at once
 * within 300 ms of the last one going. Drawn as gpui-kit's `Tooltip`, where
 * gpui-base's `TooltipPositioner` puts it: centered above the cell, below
 * when it doesn't fit there, kept 4 px inside the window.
 */

/** gpui-base's `SHOW_DELAY` and `GRACE_PERIOD`, the tall table's own. */
export const TOOLTIP_DELAY = 500;
export const TOOLTIP_GRACE = 300;
/** The positioner's margin from the window's edges. */
const WINDOW_MARGIN = 4;
/** gpui-kit's tooltip has a 12 px margin (`m_3`) inside what the
 *  positioner places. */
const BOX_MARGIN = 12;

/** A cell's tooltip text; null for none; undefined while its page loads (it's
 *  looked at again when the page lands). */
export type TooltipLookup = (row: number, column: number) => string | null | undefined;

interface Hover {
  row: number;
  column: number;
  /** The pointer rested long enough (or a tooltip had just shown). */
  rested: boolean;
  /** Rested, and looked at with its page loaded. */
  decided: boolean;
  shown: boolean;
  timer: number;
}

export class CellTooltip {
  private hover: Hover | null = null;
  /** Running for `GRACE` after a tooltip went. */
  private grace = 0;
  private pointer = { x: NaN, y: NaN };
  private readonly element: HTMLDivElement;
  private readonly text: HTMLDivElement;
  private readonly scroller: HTMLElement;
  private readonly lookup: TooltipLookup;

  constructor(scroller: HTMLElement, lookup: TooltipLookup) {
    this.scroller = scroller;
    this.lookup = lookup;
    this.element = document.createElement('div');
    this.element.className = 'tooltip';
    this.element.setAttribute('role', 'tooltip');
    this.element.hidden = true;
    this.text = this.element.appendChild(document.createElement('div'));
    document.body.append(this.element);
    scroller.addEventListener('pointermove', this.onMove, { passive: true });
    scroller.addEventListener('pointerleave', this.onLeave, { passive: true });
    scroller.addEventListener('pointerdown', this.onLeave, { passive: true });
    scroller.addEventListener('scroll', this.onScroll, { passive: true });
  }

  destroy(): void {
    this.scroller.removeEventListener('pointermove', this.onMove);
    this.scroller.removeEventListener('pointerleave', this.onLeave);
    this.scroller.removeEventListener('pointerdown', this.onLeave);
    this.scroller.removeEventListener('scroll', this.onScroll);
    clearTimeout(this.hover?.timer);
    clearTimeout(this.grace);
    this.element.remove();
  }

  /** A page may have landed: a rested cell waiting on its page is looked at. */
  refresh(): void {
    this.decide();
  }

  /** The pointer moved over the table. A new cell starts the delay or,
   *  while a tooltip shows (or just went), is looked at at once. */
  private onMove = (event: PointerEvent): void => {
    // A move that didn't move: the browser's own after a scroll, to update
    // hover. GPUI hears none.
    if (event.clientX === this.pointer.x && event.clientY === this.pointer.y) return;
    this.pointer = { x: event.clientX, y: event.clientY };
    const cell = (event.target as Element).closest?.('.row > .cell');
    const row = cell ? Number((cell.parentElement as HTMLElement).dataset.row) : NaN;
    // A row's first child is its number.
    const column = cell ? Array.prototype.indexOf.call(cell.parentElement!.children, cell) - 1 : -1;
    const at = cell && Number.isFinite(row) && column >= 0 ? { row, column } : null;
    if (at && this.hover && this.hover.row === at.row && this.hover.column === at.column) return;
    if (!at && !this.hover) return;
    const warm = (this.hover?.shown ?? false) || this.grace !== 0;
    this.hide();
    if (!at) return;
    const hover: Hover = { ...at, rested: warm, decided: false, shown: false, timer: 0 };
    this.hover = hover;
    if (warm) {
      this.decide();
    } else {
      hover.timer = window.setTimeout(() => {
        hover.rested = true;
        this.decide();
      }, TOOLTIP_DELAY);
    }
  };

  /** The pointer left the cells or pressed: the tooltip goes, and the next
   *  one within `GRACE` shows at once. */
  private onLeave = (): void => {
    this.hide();
  };

  /** The cells moved under the pointer: no hover until it moves, no grace. */
  private onScroll = (): void => {
    if (!this.hover) return;
    clearTimeout(this.hover.timer);
    this.hover = null;
    this.element.hidden = true;
  };

  private hide(): void {
    const hover = this.hover;
    this.hover = null;
    if (!hover) return;
    clearTimeout(hover.timer);
    if (!hover.shown) return;
    this.element.hidden = true;
    clearTimeout(this.grace);
    this.grace = window.setTimeout(() => (this.grace = 0), TOOLTIP_GRACE);
  }

  private decide(): void {
    const hover = this.hover;
    if (!hover || !hover.rested || hover.decided) return;
    const text = this.lookup(hover.row, hover.column);
    if (text === undefined) return;
    hover.decided = true;
    if (text === null) return;
    const cell = this.scroller.querySelector(`.row[data-row="${hover.row}"]`)?.children[hover.column + 1];
    if (!cell) return;
    hover.shown = true;
    this.show(text, cell.getBoundingClientRect());
  }

  /** Shows `text` beside `cell` (gpui-base's `Positioner::side`, no
   *  preferred side: above if it fits, else below if that fits, else the
   *  roomier; centered; clamped into the window). */
  private show(text: string, cell: DOMRect): void {
    this.text.textContent = text;
    const style = this.element.style;
    style.left = '0px';
    style.top = '0px';
    this.element.hidden = false;
    const box = this.element.getBoundingClientRect();
    const width = box.width + 2 * BOX_MARGIN;
    const height = box.height + 2 * BOX_MARGIN;
    const right = window.innerWidth - WINDOW_MARGIN;
    const bottom = window.innerHeight - WINDOW_MARGIN;
    const above = Math.max(0, cell.top - WINDOW_MARGIN);
    const below = Math.max(0, bottom - cell.bottom);
    const top = height <= above ? true : height <= below ? false : below < above;
    let x = cell.left + cell.width / 2 - width / 2;
    let y = top ? cell.top - height : cell.bottom;
    if (x + width > right) x -= x + width - right;
    if (x < WINDOW_MARGIN) x = WINDOW_MARGIN;
    if (y + height > bottom) y -= y + height - bottom;
    if (y < WINDOW_MARGIN) y = WINDOW_MARGIN;
    // The positioner rounds its offset to whole pixels.
    style.left = `${Math.round(x) + BOX_MARGIN}px`;
    style.top = `${Math.round(y) + BOX_MARGIN}px`;
  }
}
