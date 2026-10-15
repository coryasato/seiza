// A native scroller over more pixels than a browser lets an element be tall.
//
// The spacer is `spacer` px tall (under every browser's cap); the content is
// `rows × rowHeight`. V is the content's scroll position, s the scroller's.
// While the input is a wheel, a key, or a touch, V moves 1:1 with s: the
// rows sit in the spacer at `row × rowHeight − D`, so the compositor moves
// them with no main-thread work, and V = s + D. The offset D drifts from the
// canonical map (`anchorFor`, which pins both ends) by up to `page` px; past
// that, or at either end of the scroller, the scroller is re-anchored: s jumps
// to anchorFor(V) and D changes with it in the same task, so the content
// shouldn't move. A scroll step bigger than a screen that no wheel, key, or
// touch explains, or any scroll while the pointer is down on the scrollbar,
// is the thumb: it maps s to V through the canonical map. Keys are the
// scroller's own (a row, a screen, the ends), unless `keys` is 'native'.

export type Source = 'wheel' | 'key' | 'touch' | 'bar' | 'other';
export type AnchorMethod = 'set' | 'by' | 'none';

export interface ScaledOptions {
  rows: number;
  rowHeight: number;
  /** The spacer's height, px; clamped to the content's. */
  spacer: number;
  /** Drift (px of s) allowed before a re-anchor. */
  page: number;
  /** The canonical map is 1:1 within this many px of either end, so a
   *  wheel event up to this size near an end is never cut short. */
  zone: number;
  /** How the scroller jumps: `scrollTop =`, `scrollBy`, or never (a control). */
  anchor: AnchorMethod;
  /** Rows the content may move from its base before the base moves. */
  rebaseRows: number;
  /** 'own': ↑/↓ a row, Page Up/Down and Space a screen, all instant.
   *  'native': the browser's (smooth) scrolling for those; the ends are
   *  always the scroller's. */
  keys: 'own' | 'native';
}

export interface Reanchor {
  t: number;
  from: number;
  to: number;
  v: number;
  source: Source;
}

/** How long after a wheel, key, or touch its scroll events count as its own. */
const INPUT_WINDOW = 300;
const IDLE = 150;

export class ScaledScroller {
  readonly total: number; // T: max V
  readonly range: number; // M: max s
  v = 0;
  s = 0;
  d = 0;
  /** The content's base row: rows are placed relative to it, so no
   *  transform holds a coordinate past a float's exact range. */
  base = 0;
  source: Source = 'other';
  scrolling = false;
  reanchors: Reanchor[] = [];
  /** Every input event seen, for telling a scrollbar drag apart. */
  inputs: { t: number; type: string; x: number; y: number; inBar: boolean; target: string }[] = [];
  scrollEvents = 0;
  /** Scroll events by the source they were put down to. */
  sources: Record<string, number> = {};
  handlerMs: number[] = [];

  private lastInput = { source: 'other' as Source, at: -Infinity };
  private pointerOnBar = false;
  private touching = false;
  private idleTimer = 0;
  private listeners = new Set<(v: number, scrolling: boolean) => void>();
  private viewport: number;

  constructor(
    readonly scroller: HTMLElement,
    readonly spacer: HTMLElement,
    readonly content: HTMLElement,
    readonly options: ScaledOptions,
  ) {
    this.viewport = scroller.clientHeight;
    const contentHeight = options.rows * options.rowHeight;
    const spacerHeight = Math.min(options.spacer, contentHeight);
    spacer.style.height = `${spacerHeight}px`;
    this.total = Math.max(0, contentHeight - this.viewport);
    this.range = Math.max(0, spacerHeight - this.viewport);
    scroller.addEventListener('scroll', this.onScroll, { passive: true });
    scroller.addEventListener('wheel', this.onWheel, { passive: true });
    scroller.addEventListener('keydown', this.onKey);
    scroller.addEventListener('touchstart', this.onTouch, { passive: true });
    scroller.addEventListener('touchend', this.onTouch, { passive: true });
    for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click'] as const) {
      window.addEventListener(type, this.onPointer, { capture: true });
    }
    window.addEventListener('pointermove', this.onPointerMove, { capture: true, passive: true });
    this.place();
  }

  destroy(): void {
    this.scroller.removeEventListener('scroll', this.onScroll);
    this.scroller.removeEventListener('wheel', this.onWheel);
    this.scroller.removeEventListener('keydown', this.onKey);
    this.scroller.removeEventListener('touchstart', this.onTouch);
    this.scroller.removeEventListener('touchend', this.onTouch);
    for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click'] as const) {
      window.removeEventListener(type, this.onPointer, { capture: true });
    }
    window.removeEventListener('pointermove', this.onPointerMove, { capture: true });
  }

  subscribe(listener: (v: number, scrolling: boolean) => void): () => void {
    this.listeners.add(listener);
    listener(this.v, this.scrolling);
    return () => this.listeners.delete(listener);
  }

  /** The stretch: content px per spacer px under the canonical map's middle. */
  get stretch(): number {
    return this.range > 0 ? this.total / this.range : 1;
  }

  /** Width of the classic scrollbar (0 for overlay scrollbars). */
  get barWidth(): number {
    return this.scroller.offsetWidth - this.scroller.clientWidth;
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
    this.reanchor('other', true);
    this.place();
    this.notify(true);
  }

  private currentSource(now: number): Source {
    if (this.pointerOnBar) return 'bar';
    if (this.touching) return 'touch';
    if (now - this.lastInput.at < INPUT_WINDOW) return this.lastInput.source;
    return 'other';
  }

  private onScroll = (): void => {
    const start = performance.now();
    const s = this.scroller.scrollTop;
    // No step: the event of a re-anchor this task already accounted for.
    if (s === this.s) return;
    this.scrollEvents++;
    const source = this.currentSource(start);
    this.source = source;
    this.sources[source] = (this.sources[source] ?? 0) + 1;
    // A wheel, key, or touch moves the content 1:1, and so does any step of
    // at most a screen (a track press's page, the tail of a smooth scroll that
    // outlived its input's window). The pointer down on the scrollbar, or a
    // bigger step, is the thumb: a drag moves s by tens of thousands of px
    // per pixel of pointer travel.
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
      if (this.options.anchor !== 'none' && (drift > this.options.page || blocked)) this.reanchor(source, false);
    } else {
      this.s = s;
      this.v = this.valueFor(s);
      this.d = this.v - s;
    }
    this.place();
    this.notify(true);
    this.handlerMs.push(performance.now() - start);
  };

  private onIdle = (): void => {
    // At rest, re-anchor fully: the content stays, the thumb moves at most
    // `page / range` of the track.
    if (this.options.anchor !== 'none' && Math.abs(this.s - this.anchorFor(this.v)) > 0.5) {
      this.reanchor(this.source, false);
      this.place();
    }
    this.notify(false);
  };

  /** Moves s to anchorFor(V) and D with it, in this task. */
  private reanchor(source: Source, force: boolean): void {
    const from = this.scroller.scrollTop;
    const to = Math.round(this.anchorFor(this.v) * devicePixelRatio) / devicePixelRatio;
    this.d = this.v - to;
    if (!force && Math.abs(to - from) < 0.5) return;
    this.reanchors.push({ t: performance.now(), from, to, v: this.v, source });
    // `scrollBy` composes with a scroll the browser is still animating; an
    // assignment can drop it. 'none' (the control) still needs jumps to land.
    if (this.options.anchor === 'by') this.scroller.scrollBy({ top: to - from, behavior: 'instant' });
    else this.scroller.scrollTop = to;
    // The browser rounds scrollTop to its own grid; D follows what it took.
    this.s = this.scroller.scrollTop;
    this.d = this.v - this.s;
    this.place();
  }

  /** Positions the content: row r sits at `r × rowHeight − D` in the spacer. */
  private place(): void {
    const h = this.options.rowHeight;
    const row = this.v / h;
    if (Math.abs(row - this.base) > this.options.rebaseRows) this.base = Math.floor(row);
    this.content.style.transform = `translateY(${this.base * h - this.d}px)`;
  }

  private notify(scrolling: boolean): void {
    this.scrolling = scrolling;
    if (scrolling) {
      clearTimeout(this.idleTimer);
      this.idleTimer = window.setTimeout(this.onIdle, IDLE);
    }
    for (const listener of this.listeners) listener(this.v, scrolling);
  }

  private onWheel = (): void => {
    this.lastInput = { source: 'wheel', at: performance.now() };
    this.inputs.push({ t: performance.now(), type: 'wheel', x: 0, y: 0, inBar: false, target: 'scroller' });
  };

  private onKey = (event: KeyboardEvent): void => {
    this.inputs.push({ t: performance.now(), type: `keydown:${event.key}`, x: 0, y: 0, inBar: false, target: 'scroller' });
    // The ends, with or without Ctrl (Windows, Linux) or Cmd (macOS's ↑/↓):
    // the browser's own would run the scroller to its end, not the content.
    const end = event.key === 'End' || (event.metaKey && event.key === 'ArrowDown');
    const home = event.key === 'Home' || (event.metaKey && event.key === 'ArrowUp');
    if (end || home) {
      event.preventDefault();
      this.jumpTo(end ? this.total : 0);
      return;
    }
    this.lastInput = { source: 'key', at: performance.now() };
    if (this.options.keys === 'native' || event.altKey || event.ctrlKey || event.metaKey) return;
    const screen = this.viewport;
    const step =
      event.key === 'ArrowDown' ? this.options.rowHeight
      : event.key === 'ArrowUp' ? -this.options.rowHeight
      : event.key === 'PageDown' || (event.key === ' ' && !event.shiftKey) ? screen
      : event.key === 'PageUp' || (event.key === ' ' && event.shiftKey) ? -screen
      : 0;
    if (step === 0) return;
    event.preventDefault();
    // Through the scroller, so the content still moves on the compositor.
    this.scroller.scrollBy({ top: step, behavior: 'instant' });
  };

  private onTouch = (event: TouchEvent): void => {
    this.touching = event.type === 'touchstart';
    this.lastInput = { source: 'touch', at: performance.now() };
  };

  private inBar(x: number, y: number): boolean {
    const rect = this.scroller.getBoundingClientRect();
    // Overlay scrollbars take no layout width; count the last 16 px.
    const width = this.barWidth || 16;
    return x >= rect.right - width && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }

  private onPointer = (event: MouseEvent): void => {
    const inBar = this.inBar(event.clientX, event.clientY);
    const target = event.target === this.scroller ? 'scroller' : event.target instanceof Element ? event.target.className || event.target.tagName : 'other';
    this.inputs.push({ t: performance.now(), type: event.type, x: event.clientX, y: event.clientY, inBar, target: String(target) });
    if (event.type === 'pointerdown' && inBar) this.pointerOnBar = true;
    if (event.type === 'pointerup' || event.type === 'mouseup') this.pointerOnBar = false;
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (event.buttons) this.inputs.push({ t: performance.now(), type: 'pointermove', x: event.clientX, y: event.clientY, inBar: this.inBar(event.clientX, event.clientY), target: '' });
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
