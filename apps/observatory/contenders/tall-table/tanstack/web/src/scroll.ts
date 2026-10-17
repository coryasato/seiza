/**
 * The scroll model (`docs/dom-scroll-model.md`; `spike/src/scaled.ts` is
 * its reference): a native scroller over more pixels than a browser lets an
 * element be tall.
 *
 * The spacer is at most 2^24 px tall; the content is `rows × rowHeight`.
 * V is the content's position (0 … T), s the scroller's (0 … M). While the
 * input is a wheel, a key, or a touch, or any step of at most a screen, V
 * moves 1:1 with s (V = s + D, D fixed), so the compositor moves the rows
 * and the main thread only fills them in. Past `page` px of drift from the
 * canonical map, or pinned at an end the content isn't at, the scroller is
 * re-anchored with `scrollBy` in the same task, and fully at rest. A step
 * bigger than a screen that no wheel, key, or touch explains, or any
 * scroll while the pointer is down on the scrollbar, is the thumb: s maps
 * to V through the canonical map.
 *
 * The scroller holds a sticky header `head` px tall above the spacer, so
 * the rows' viewport is its client height less the header.
 */

export type Source = 'wheel' | 'key' | 'touch' | 'bar' | 'other';

export interface ScrollOptions {
  rows: number;
  rowHeight: number;
  /** The sticky header's height above the spacer, px. */
  head: number;
  /** The spacer's height, px; clamped to the content's. */
  spacer: number;
  /** Drift (px of s) allowed before a re-anchor. */
  page: number;
  /** The canonical map is 1:1 within this many px of either end. */
  zone: number;
  /** Rows the content may move from its base before the base moves. */
  rebaseRows: number;
}

/** The model's numbers (`docs/dom-scroll-model.md`, "The model"). */
export const SCROLL = { spacer: 2 ** 24, page: 1800, zone: 2 ** 20 } as const;

/** How long after a wheel, key, or touch its scroll events count as its own. */
const INPUT_WINDOW = 300;
/** How long with no scroll before the scroller is at rest. */
const IDLE = 150;

export class ScaledScroller {
  /** T: the largest V. */
  total = 0;
  /** M: the largest s. */
  range = 0;
  v = 0;
  s = 0;
  d = 0;
  /** The content's base row: rows are placed relative to it, so no
   *  transform holds a coordinate past a few thousand rows. */
  base = 0;
  /** Where the last scroll came from. */
  source: Source = 'other';
  /** The rows' viewport height, px. */
  viewport = 0;

  private lastInput = { source: 'other' as Source, at: -Infinity };
  private pointerOnBar = false;
  private touching = false;
  private idleTimer = 0;
  private readonly listeners = new Set<(v: number, scrolling: boolean) => void>();
  private readonly scroller: HTMLElement;
  private readonly spacer: HTMLElement;
  private readonly content: HTMLElement;
  private readonly options: ScrollOptions;

  constructor(scroller: HTMLElement, spacer: HTMLElement, content: HTMLElement, options: ScrollOptions) {
    this.scroller = scroller;
    this.spacer = spacer;
    this.content = content;
    this.options = options;
    this.measure();
    scroller.addEventListener('scroll', this.onScroll, { passive: true });
    scroller.addEventListener('wheel', this.onWheel, { passive: true });
    scroller.addEventListener('keydown', this.onKey);
    scroller.addEventListener('touchstart', this.onTouch, { passive: true });
    scroller.addEventListener('touchend', this.onTouch, { passive: true });
    scroller.addEventListener('touchcancel', this.onTouch, { passive: true });
    window.addEventListener('pointerdown', this.onPointer, { capture: true });
    window.addEventListener('pointerup', this.onPointer, { capture: true });
    window.addEventListener('pointercancel', this.onPointer, { capture: true });
    window.addEventListener('mouseup', this.onPointer, { capture: true });
    this.place();
  }

  destroy(): void {
    clearTimeout(this.idleTimer);
    this.scroller.removeEventListener('scroll', this.onScroll);
    this.scroller.removeEventListener('wheel', this.onWheel);
    this.scroller.removeEventListener('keydown', this.onKey);
    this.scroller.removeEventListener('touchstart', this.onTouch);
    this.scroller.removeEventListener('touchend', this.onTouch);
    this.scroller.removeEventListener('touchcancel', this.onTouch);
    window.removeEventListener('pointerdown', this.onPointer, { capture: true });
    window.removeEventListener('pointerup', this.onPointer, { capture: true });
    window.removeEventListener('pointercancel', this.onPointer, { capture: true });
    window.removeEventListener('mouseup', this.onPointer, { capture: true });
    this.listeners.clear();
  }

  /** Calls `listener` with V now and at every move, `scrolling` until the
   *  scroller comes to rest (150 ms with no scroll). */
  subscribe(listener: (v: number, scrolling: boolean) => void): () => void {
    this.listeners.add(listener);
    listener(this.v, false);
    return () => this.listeners.delete(listener);
  }

  /** The scroller was resized: the viewport, T, and M follow, and the
   *  content stays at V where the new T allows. */
  resize(): void {
    const viewport = this.viewport;
    this.measure();
    if (this.viewport === viewport) return;
    this.jumpTo(this.v);
  }

  /** The canonical map V → s: 1:1 within `zone` of either end (so the ends
   *  are reachable a row at a time), linear between. */
  anchorFor(v: number): number {
    const { total: t, range: m } = this;
    if (t <= m) return v;
    const zone = Math.min(this.options.zone, m / 4);
    if (v <= zone) return v;
    if (v >= t - zone) return m - (t - v);
    return zone + ((v - zone) * (m - 2 * zone)) / (t - 2 * zone);
  }

  /** The canonical map's inverse, s → V. */
  valueFor(s: number): number {
    const { total: t, range: m } = this;
    if (t <= m) return s;
    const zone = Math.min(this.options.zone, m / 4);
    if (s <= zone) return s;
    if (s >= m - zone) return t - (m - s);
    return zone + ((s - zone) * (t - 2 * zone)) / (m - 2 * zone);
  }

  /** Scrolls the content to V (Home, End, a jump). */
  jumpTo(v: number): void {
    this.v = clamp(v, 0, this.total);
    this.reanchor(true);
    this.place();
    this.notify();
  }

  private measure(): void {
    const { rows, rowHeight, head, spacer } = this.options;
    this.viewport = Math.max(0, this.scroller.clientHeight - head);
    const contentHeight = rows * rowHeight;
    const spacerHeight = Math.min(spacer, contentHeight);
    this.spacer.style.height = `${spacerHeight}px`;
    this.total = Math.max(0, contentHeight - this.viewport);
    this.range = Math.max(0, spacerHeight - this.viewport);
  }

  private currentSource(now: number): Source {
    if (this.pointerOnBar) return 'bar';
    if (this.touching) return 'touch';
    if (now - this.lastInput.at < INPUT_WINDOW) return this.lastInput.source;
    return 'other';
  }

  private onScroll = (): void => {
    const s = this.scroller.scrollTop;
    // No step: the event of a re-anchor this task already accounted for,
    // or a sideways scroll.
    if (s === this.s) return;
    const source = this.currentSource(performance.now());
    this.source = source;
    const step = Math.abs(s - this.s);
    if (source !== 'bar' && (source === 'wheel' || source === 'key' || source === 'touch' || step <= this.viewport)) {
      this.v = clamp(s + this.d, 0, this.total);
      // At either end of the scroller inside an end zone, the content is at
      // its end too, whatever rounding D picked up on the way.
      const zone = Math.min(this.options.zone, this.range / 4);
      if (s >= this.range - 0.5 && this.v >= this.total - zone) this.v = this.total;
      if (s <= 0.5 && this.v <= zone) this.v = 0;
      if (this.v === this.total || this.v === 0) this.d = this.v - s;
      const drift = Math.abs(s - this.anchorFor(this.v));
      const blocked = (s <= 0.5 && this.v > 0.5) || (s >= this.range - 0.5 && this.v < this.total - 0.5);
      this.s = s;
      if (drift > this.options.page || blocked) this.reanchor(false);
    } else {
      this.s = s;
      this.v = this.valueFor(s);
      this.d = this.v - s;
    }
    this.place();
    this.notify();
  };

  private onIdle = (): void => {
    // At rest, re-anchor fully: the content stays, the thumb moves at most
    // `page / range` of its track.
    if (Math.abs(this.s - this.anchorFor(this.v)) > 0.5) {
      this.reanchor(false);
      this.place();
    }
    for (const listener of this.listeners) listener(this.v, false);
  };

  /** Moves s to anchorFor(V) and D with it, in this task. */
  private reanchor(force: boolean): void {
    const from = this.scroller.scrollTop;
    const to = Math.round(this.anchorFor(this.v) * devicePixelRatio) / devicePixelRatio;
    this.d = this.v - to;
    if (!force && Math.abs(to - from) < 0.5) return;
    // `scrollBy` composes with a scroll the browser is still animating; an
    // assignment can drop it (Firefox, WebKit).
    this.scroller.scrollBy({ top: to - from, behavior: 'instant' });
    // The browser rounds scrollTop to its own grid; D follows what it took.
    this.s = this.scroller.scrollTop;
    this.d = this.v - this.s;
  }

  /** Positions the content: row r sits at `r × rowHeight − D` in the spacer. */
  private place(): void {
    const h = this.options.rowHeight;
    const row = this.v / h;
    if (Math.abs(row - this.base) > this.options.rebaseRows) this.base = Math.floor(row);
    this.content.style.transform = `translateY(${this.base * h - this.d}px)`;
  }

  private notify(): void {
    clearTimeout(this.idleTimer);
    this.idleTimer = window.setTimeout(this.onIdle, IDLE);
    for (const listener of this.listeners) listener(this.v, true);
  }

  private onWheel = (): void => {
    this.lastInput = { source: 'wheel', at: performance.now() };
    this.pointerOnBar = false;
  };

  /** The contender's keys (`docs/dom-scroll-model.md`): ↑/↓ a row, Page
   *  Up/Down and Space/Shift+Space a screen (an instant `scrollBy`, so the
   *  content still moves on the compositor), and the ends for Home/End
   *  with or without Ctrl and for Cmd+↑/↓, through the model. */
  private onKey = (event: KeyboardEvent): void => {
    const end = event.key === 'End' || (event.metaKey && event.key === 'ArrowDown');
    const home = event.key === 'Home' || (event.metaKey && event.key === 'ArrowUp');
    if (end || home) {
      event.preventDefault();
      this.jumpTo(end ? this.total : 0);
      return;
    }
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const screen = this.viewport;
    const step =
      event.key === 'ArrowDown' ? this.options.rowHeight
      : event.key === 'ArrowUp' ? -this.options.rowHeight
      : event.key === 'PageDown' || (event.key === ' ' && !event.shiftKey) ? screen
      : event.key === 'PageUp' || (event.key === ' ' && event.shiftKey) ? -screen
      : 0;
    if (step === 0) return;
    event.preventDefault();
    this.lastInput = { source: 'key', at: performance.now() };
    this.pointerOnBar = false;
    this.scroller.scrollBy({ top: step, behavior: 'instant' });
  };

  private onTouch = (event: TouchEvent): void => {
    this.touching = event.type === 'touchstart';
    this.lastInput = { source: 'touch', at: performance.now() };
    this.pointerOnBar = false;
  };

  /** Whether (x, y) is on the vertical scrollbar. Overlay scrollbars take
   *  no layout width; count the last 16 px. */
  private inBar(x: number, y: number): boolean {
    const rect = this.scroller.getBoundingClientRect();
    const width = this.scroller.offsetWidth - this.scroller.clientWidth || 16;
    return x >= rect.right - width && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }

  /** The pointer down on the scrollbar makes every scroll the thumb's
   *  until it comes up. A release can go missing (Firefox, past the window;
   *  or outside a frame), so a wheel, a key, or a touch also ends it: none
   *  comes from a held thumb. */
  private onPointer = (event: MouseEvent): void => {
    if (event.type === 'pointerdown') this.pointerOnBar = this.inBar(event.clientX, event.clientY);
    else this.pointerOnBar = false;
  };
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
