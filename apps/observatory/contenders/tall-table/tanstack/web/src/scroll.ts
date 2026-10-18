/**
 * The scroll model (`docs/dom-scroll-model.md`; `spike/src/scaled.ts` is
 * its reference): a native scroller over more pixels than a browser lets an
 * element be tall.
 *
 * The spacer is at most 2^24 px tall; the content is `rows × rowHeight`.
 * V is the content's position (0 … T), s the scroller's (0 … M). While the
 * input is a wheel, a key, a touch, or the replay's `step`, or any step of
 * at most a screen, V moves 1:1 with s (V = s + D, D fixed), so the
 * compositor moves the rows and the main thread only fills them in. Past
 * `page` px of drift from the canonical map, or pinned at an end the
 * content isn't at, the scroller is re-anchored with `scrollBy` in the
 * same task, and fully at rest. A step bigger than a screen that no wheel,
 * key, or touch explains, or any
 * scroll while the pointer is down on the scrollbar, is the thumb: s maps
 * to V through the canonical map.
 *
 * The tall table's base level, where the browser's own differs: a press on
 * the track jumps there (the thumb centered on it) instead of paging, a
 * scroll in thumb mode is a drag (`onDrag`, ended by a release or by 80 ms
 * with no scroll), and Shift turns a vertical wheel sideways.
 *
 * The scroller holds a sticky header `head` px tall above the spacer, so
 * the rows' viewport is its client height less the header.
 */

export type Source = 'wheel' | 'key' | 'touch' | 'replay' | 'bar' | 'other';

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
  /** How long a drag rests before it counts as ended, with no release
   *  (the paging's drag settle). */
  dragSettle: number;
}

/** The model's numbers (`docs/dom-scroll-model.md`, "The model"). */
export const SCROLL = { spacer: 2 ** 24, page: 1800, zone: 2 ** 20 } as const;

/** How long after a wheel, key, or touch its scroll events count as its own. */
const INPUT_WINDOW = 300;
/** How long with no scroll before the scroller is at rest. */
const IDLE = 150;
/** The browsers' scrollbar thumbs are 22–26 px at their shortest, which a
 *  scaled table's always is (the tall table's is 24). */
const MIN_THUMB = 24;
/** A press this close to where the thumb should be is left to the browser
 *  (a grab), as the thumb's length is an estimate. */
const THUMB_SLACK = 4;

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
  /** A drag starts (true) or ends (false). */
  onDrag: (dragging: boolean) => void = () => {};

  private lastInput = { source: 'other' as Source, at: -Infinity };
  private pointerOnBar = false;
  private touching = false;
  private idleTimer = 0;
  private dragging = false;
  private dragTimer = 0;
  /** A track press jumped the thumb: the browser's own paging for that press
   *  moves nothing until the scroller rests or another input comes. */
  private jumped = false;
  /** The pointer is held after a track press jumped the thumb: where on the
   *  thumb it holds it, for browsers that leave the drag to the page. */
  private grab: number | null = null;
  private shiftHeld = false;
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
    window.addEventListener('keydown', this.onShift, { capture: true });
    window.addEventListener('keyup', this.onShift, { capture: true });
    window.addEventListener('blur', this.onShift);
    this.place();
  }

  destroy(): void {
    clearTimeout(this.idleTimer);
    clearTimeout(this.dragTimer);
    this.endGrab();
    this.scroller.removeEventListener('wheel', this.onShiftWheel);
    window.removeEventListener('keydown', this.onShift, { capture: true });
    window.removeEventListener('keyup', this.onShift, { capture: true });
    window.removeEventListener('blur', this.onShift);
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

  /** A scripted step of `dy` px (the replay's fling): 1:1, as a wheel's,
   *  through the scroller's position, since a script-made wheel event never
   *  scrolls a native scroller. */
  step(dy: number): void {
    this.lastInput = { source: 'replay', at: performance.now() };
    this.otherInput();
    this.scroller.scrollBy({ top: dy, behavior: 'instant' });
  }

  /** The vertical scrollbar's track and thumb, CSS px in the viewport, as
   *  `[x, y, width, height]` (the thumb estimated as the browser draws it;
   *  an overlay scrollbar's strip counted 16 px wide). */
  scrollbar(): { track: number[]; thumb: number[] } {
    const { left, top, width, bottom } = this.barStrip();
    const { length, offset } = this.thumb();
    return { track: [left, top, width, bottom - top], thumb: [left, top + offset, width, length] };
  }

  /** The vertical scrollbar's strip, viewport px: its width (an overlay
   *  scrollbar takes none in layout: the last 16 px), from the scroller's
   *  top to its client bottom, above any horizontal bar. */
  private barStrip(): { left: number; right: number; top: number; bottom: number; width: number } {
    const rect = this.scroller.getBoundingClientRect();
    const width = this.scroller.offsetWidth - this.scroller.clientWidth || 16;
    const top = rect.top + this.scroller.clientTop;
    return { left: rect.right - width, right: rect.right, top, bottom: top + this.scroller.clientHeight, width };
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
    const input = source === 'wheel' || source === 'key' || source === 'touch' || source === 'replay';
    // A page step is at most the scroller's height (Chromium's is 87.5% of
    // it), the header included: in a short scroller it's more than the rows'
    // viewport. A drag step is more than that wherever the table is scaled
    // (a thumb pixel is ~9,500 px of scroller here); in a table short enough
    // for a thumb pixel to be less, a drag right after a jump would be
    // taken for paging.
    if (this.jumped && !input && step <= this.scroller.clientHeight) {
      // The browser paging toward a press the jump already answered
      // (WebKit pages twice after it): the content stays where it jumped.
      this.s = s;
      this.d = this.v - s;
    } else if (source !== 'bar' && (input || step <= this.viewport)) {
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
      this.dragMoved();
    }
    this.place();
    this.notify();
  };

  /** A scroll in thumb mode: a drag, until the pointer comes up or no
   *  scroll arrives for the drag settle (a release can go missing, and a
   *  resting pointer sends no events). */
  private dragMoved(): void {
    if (!this.dragging) {
      this.dragging = true;
      this.onDrag(true);
    }
    clearTimeout(this.dragTimer);
    this.dragTimer = window.setTimeout(() => this.endDrag(), this.options.dragSettle);
  }

  private endDrag(): void {
    clearTimeout(this.dragTimer);
    if (!this.dragging) return;
    this.dragging = false;
    this.onDrag(false);
  }

  private onIdle = (): void => {
    // A press still held may page on (WebKit, toward a pointer that moved).
    if (!this.pointerOnBar) this.jumped = false;
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

  private onWheel = (event: WheelEvent): void => {
    this.lastInput = { source: 'wheel', at: performance.now() };
    this.otherInput();
    // Shift went down while another frame or window had the keys: this
    // wheel scrolls the rows, the next goes sideways.
    if (event.shiftKey !== this.shiftHeld) this.setShift(event.shiftKey);
  };

  /** A wheel, a key, or a touch: none comes from a held thumb, so a drag
   *  whose release went missing is over. */
  private otherInput(): void {
    this.pointerOnBar = false;
    this.jumped = false;
    this.endGrab();
    this.endDrag();
  }

  /** Shift held: a vertical wheel scrolls sideways (the tall table's
   *  `on_scroll_wheel`), where the platform hasn't already turned it (a
   *  Mac turns a mouse's; a trackpad sends its own sideways deltas).
   *  Listening without `passive` makes the browser wait for the page before
   *  scrolling, so the listener is there only while Shift is down. */
  private onShift = (event: Event): void => {
    this.setShift(event.type !== 'blur' && (event as KeyboardEvent).shiftKey);
  };

  private setShift(held: boolean): void {
    if (held === this.shiftHeld) return;
    this.shiftHeld = held;
    if (held) this.scroller.addEventListener('wheel', this.onShiftWheel, { passive: false });
    else this.scroller.removeEventListener('wheel', this.onShiftWheel);
  }

  private onShiftWheel = (event: WheelEvent): void => {
    // An event the browser won't let the page cancel scrolls the rows, as
    // the browser does (WebKit, in the frame Shift went down: it hasn't
    // seen the listener yet); sideways as well would scroll both ways.
    if (!event.shiftKey || event.deltaX !== 0 || event.deltaY === 0 || !event.cancelable) return;
    event.preventDefault();
    const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? this.options.rowHeight : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? this.scroller.clientWidth : 1;
    this.scroller.scrollBy({ left: event.deltaY * unit, behavior: 'instant' });
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
    // A screen less a row (the tall table's `page_rows`), at least a row.
    const screen = Math.max(this.viewport - this.options.rowHeight, this.options.rowHeight);
    const step =
      event.key === 'ArrowDown' ? this.options.rowHeight
      : event.key === 'ArrowUp' ? -this.options.rowHeight
      : event.key === 'PageDown' || (event.key === ' ' && !event.shiftKey) ? screen
      : event.key === 'PageUp' || (event.key === ' ' && event.shiftKey) ? -screen
      : 0;
    if (step === 0) return;
    event.preventDefault();
    this.lastInput = { source: 'key', at: performance.now() };
    this.otherInput();
    this.scroller.scrollBy({ top: step, behavior: 'instant' });
  };

  private onTouch = (event: TouchEvent): void => {
    this.touching = event.type === 'touchstart';
    this.lastInput = { source: 'touch', at: performance.now() };
    this.otherInput();
  };

  /** Whether a press is on the vertical scrollbar: one the scrollbar takes
   *  has the scroller itself as its target (a hidden overlay scrollbar lets
   *  it through to the cells), in the bar's strip above any horizontal bar.
   *  Overlay scrollbars take no layout width; count the last 16 px. */
  private onBar(event: MouseEvent): boolean {
    if (event.target !== this.scroller) return false;
    const strip = this.barStrip();
    return event.clientX >= strip.left && event.clientX <= strip.right && event.clientY >= strip.top && event.clientY < strip.bottom;
  }

  /** The thumb as the browser draws it, estimated: its length and its
   *  offset along the track (the scroller's height above any horizontal
   *  bar), px. */
  private thumb(): { track: number; length: number; offset: number } {
    const track = this.scroller.clientHeight;
    const length = Math.min(track, Math.max(MIN_THUMB, (track * track) / (this.range + track)));
    return { track, length, offset: this.range > 0 ? ((track - length) * this.s) / this.range : 0 };
  }

  /** The s that puts the thumb's start `grab` px above `y` (px down the track). */
  private sForThumbAt(y: number, grab: number): number {
    const { track, length } = this.thumb();
    return track > length ? clamp((y - grab) / (track - length), 0, 1) * this.range : 0;
  }

  /** A press on the track off the thumb: jump there, the thumb centered on
   *  the press (the tall table's `press_track`), in this task, so a quick
   *  release already finds the drag to end. The table then drags the thumb
   *  it jumped while the press is held; here that's the browser's: Chromium
   *  grabs it with classic scrollbars, Firefox leaves it to the page
   *  (`grabMove`), and Chromium's overlay scrollbars and WebKit page on
   *  toward the pointer instead, which moves nothing (`jumped`). */
  private pressTrack(event: MouseEvent): void {
    if (this.range <= 0) return;
    const y = event.clientY - this.scroller.getBoundingClientRect().top - this.scroller.clientTop;
    const { track, length, offset } = this.thumb();
    if (y >= offset - THUMB_SLACK && y <= offset + length + THUMB_SLACK) return;
    // A classic scrollbar's ends may be arrow buttons (Windows), as long as
    // the bar is wide: a press there is a line's step, the browser's. (Their
    // length isn't in the track the thumb is estimated on: a jump there
    // lands up to a button's length off.)
    const bar = this.scroller.offsetWidth - this.scroller.clientWidth;
    if (bar > 0 && (y < bar || y > track - bar)) return;
    const from = this.scroller.scrollTop;
    this.scroller.scrollBy({ top: this.sForThumbAt(y, length / 2) - from, behavior: 'instant' });
    const s = this.scroller.scrollTop;
    if (s === from) return;
    this.source = 'bar';
    this.s = s;
    this.v = this.valueFor(s);
    this.d = this.v - s;
    this.jumped = true;
    this.grab = length / 2;
    window.addEventListener('pointermove', this.grabMove, { capture: true, passive: true });
    this.dragMoved();
    this.place();
    this.notify();
  }

  /** The pointer moves while it holds the thumb a jump put under it, in a
   *  browser that tells the page (Chromium and WebKit send no moves during a
   *  scrollbar press): the thumb follows. */
  private grabMove = (event: PointerEvent): void => {
    if (this.grab === null || (event.buttons & 1) === 0) {
      this.endGrab();
      return;
    }
    const y = event.clientY - this.scroller.getBoundingClientRect().top - this.scroller.clientTop;
    this.scroller.scrollBy({ top: this.sForThumbAt(y, this.grab) - this.scroller.scrollTop, behavior: 'instant' });
  };

  private endGrab(): void {
    if (this.grab === null) return;
    this.grab = null;
    window.removeEventListener('pointermove', this.grabMove, { capture: true });
  }

  /** The pointer down on the scrollbar makes every scroll the thumb's
   *  until it comes up, which ends a drag. A release can go missing
   *  (Firefox, past the window; or outside a frame), so a wheel, a key, or a
   *  touch also ends it, and so does a drag's settle. */
  private onPointer = (event: MouseEvent): void => {
    if (event.type === 'pointerdown') {
      this.jumped = false;
      this.endGrab();
      this.pointerOnBar = this.onBar(event);
      if (this.pointerOnBar && event.button === 0) {
        // The table's own press focuses it (the tall table's `press_track`).
        this.scroller.focus({ preventScroll: true });
        this.pressTrack(event);
      }
    } else {
      this.pointerOnBar = false;
      this.endGrab();
      this.endDrag();
    }
  };
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
