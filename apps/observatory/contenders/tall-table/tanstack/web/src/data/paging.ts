/**
 * The table's paging: where the viewport is, in rows, which way it last
 * moved, and the reads that follows, with the two settle times. A port of
 * the tall table's paging paths (`components/tall-table/src/state.rs`:
 * `scroll_by`, `move_top_to`, `rows_moved`, `load_or_settle`, `end_drag`,
 * `load_wanted`, `page_done`) and its row position (`src/scroll.rs`), over
 * `PageCache`. The paging fixture (`fixtures/paging.json`) pins the reads.
 *
 * The view tells it where the rows are (`moveTopTo`, from the scroll
 * model's V) and when the scrollbar is held (`startDrag`, `endDrag`); it
 * reads rows back with `row` and hears `onChange` when a page lands.
 *
 * On market watch's and live tail's levels, `live` too (`live.ts`:
 * `invalidateRows` and the rest), its branches here behind the build
 * constant, as `pages.ts`'s are, reaching the paging's private members
 * through a typed view of them (`live.ts`'s `PagingInside`). On live
 * tail's alone, the rows grow and the view follows them (`follow.ts`:
 * `setRows`, `follow`, the reader's moves deciding following, the tail
 * pin, the visible pages bottom first), behind `__LEVEL__ === 'tail'`.
 */

import { keepBottom, readerMoved, releaseDrag, tailFirst, type FollowControl } from './follow.ts';
import { dragRested, loadWantedLive, pageDoneLive, type RowSet } from './live.ts';
import { PageCache, type Direction, type Rows, type RowState } from './pages.ts';

/** The paging numbers: the component's `Paging::default()`, the controlled
 *  variable of the comparison (root `CLAUDE.md`, "Comparison protocol").
 *  `paging.json`'s `paging` pins them. */
export interface Paging {
  pageRows: number;
  prefetch: number;
  budgetBytes: number;
  maxInFlight: number;
  /** How long the rows rest before prefetch evens out on both sides. */
  scrollSettleMs: number;
  /** How long a scrollbar drag rests before its position loads. */
  dragSettleMs: number;
}

export const PAGING: Paging = {
  pageRows: 1024,
  prefetch: 2,
  budgetBytes: 64 * 1024 * 1024,
  maxInFlight: 3,
  scrollSettleMs: 250,
  dragSettleMs: 80,
};

/** A loaded page: its bytes are what the cache's budget counts. */
export interface Page {
  readonly byteLength: number;
}

/** Where pages come from. `load` starts reading `rows` and returns its
 *  request id and the answer, which rejects with an `AbortError` once
 *  cancelled (or resolves, if the page won the race). */
export interface PageSource<P extends Page> {
  /** With `live`, a source holding the rows in hand may answer in `ready`
   *  too (its `result` resolving the same): a re-read then lands in the
   *  call that sent it, as the table's `answered`. */
  load(rows: Rows): { request: number; result: Promise<P>; ready?: P };
  cancel(request: number): void;
}

/** The timers the settle times run on: the page's own, or a script's. */
export interface Clock {
  setTimeout(run: () => void, ms: number): number;
  clearTimeout(handle: number): void;
}

export const pageClock: Clock = {
  setTimeout: (run, ms) => window.setTimeout(run, ms),
  clearTimeout: (handle) => window.clearTimeout(handle),
};

export class TablePaging<P extends Page> {
  /** Fixed but on live tail's level, where `follow.ts`'s `setRows` moves it. */
  readonly rows: number;
  private readonly paging: Paging;
  private readonly source: PageSource<P>;
  private readonly clock: Clock;
  private readonly cache: PageCache<P, number>;
  /** The row at the viewport's top edge; the fraction is how much of it is
   *  scrolled out of view. */
  private topRow = 0;
  private viewportRows = 0;
  private direction: Direction = 'still';
  private dragging = false;
  /** The drag's settle timer. Kept once it fires, as the component keeps
   *  its finished task: a release after it loads once more. */
  private dragSettle: number | null = null;
  private scrollSettle: number | null = null;
  private closed = false;
  /** A page landed (or failed): the view redraws. */
  onChange: () => void = () => {};
  /** `live`: no drag, or its pointer has rested since it last moved, so an
   *  invalidation's reads can start now. */
  declare private dragResting: boolean;
  /** `live`: an invalidation's plan waits for the end of its task. */
  declare private loadDeferred: boolean;
  /** `live`: a re-read landed over `old`, its changed rows (kept while
   *  `trackChanges` is on) to compare with `landed` (the flash), before
   *  the cache swaps them. */
  declare onLanded?: (page: number, old: P, landed: P, rows: RowSet) => void;
  /** Live tail's: the view follows the end (`follow.ts`). */
  declare private following: boolean;
  /** Live tail's: the end of the tail last drawn while following. */
  declare private tailDrawn: number;
  /** Live tail's: the fixture's control (tests only). */
  declare private followControl: FollowControl;
  /** Live tail's: following turned on or off. */
  declare onFollowing?: (following: boolean) => void;

  constructor(rows: number, source: PageSource<P>, paging: Paging = PAGING, clock: Clock = pageClock) {
    this.rows = rows;
    this.paging = paging;
    this.source = source;
    this.clock = clock;
    this.cache = new PageCache(rows, paging.pageRows, paging.budgetBytes, paging.maxInFlight);
    if (__LEVEL__ === 'market' || __LEVEL__ === 'tail') {
      this.dragResting = true;
      this.loadDeferred = false;
    }
    if (__LEVEL__ === 'tail') {
      this.following = false;
      this.tailDrawn = 0;
      this.followControl = null;
    }
  }

  top(): number {
    return this.topRow;
  }

  /** The largest top: the last row's bottom at the viewport's bottom. */
  maxTop(): number {
    return Math.max(0, this.rows - this.viewportRows);
  }

  /** The rows at least partly in view. */
  visible(): Rows {
    const start = Math.min(Math.floor(this.topRow), this.rows);
    const end = Math.min(Math.ceil(this.topRow + this.viewportRows), this.rows);
    return [start, Math.max(end, start)];
  }

  row(row: number): RowState<P> {
    return this.cache.row(row);
  }

  /** The rows a page holds. */
  get pageRows(): number {
    return this.paging.pageRows;
  }

  /** How long a scrollbar drag rests before its position loads, ms. */
  get dragSettleMs(): number {
    return this.paging.dragSettleMs;
  }

  /** The cache's bytes: each loaded page's Arrow IPC `byteLength`. */
  cacheBytes(): number {
    return this.cache.bytes();
  }

  /** The viewport holds `rows` rows (fractional); the top stays where it is
   *  when it can. The first call is the open's: it loads the first pages. */
  setViewportRows(rows: number): void {
    const viewportRows = Math.max(0, rows);
    if (viewportRows === this.viewportRows) return;
    // Live tail's: while following, the bottom stays where it was (`fit_viewport`).
    const bottom = __LEVEL__ === 'tail' ? this.topRow + this.viewportRows : 0;
    this.viewportRows = viewportRows;
    this.topRow = clamp(this.topRow, 0, this.maxTop());
    if (__LEVEL__ === 'tail') keepBottom(this, bottom);
    this.rowsMoved();
  }

  /** Scrolls by `rows` (positive is down), as a wheel or a key does. */
  scrollBy(rows: number): void {
    // Live tail's: following decided before the move, so its reads are planned the way following plans them.
    if (__LEVEL__ === 'tail' && rows !== 0) readerMoved(this, rows > 0 ? 'down' : 'up', this.topRow + rows);
    if (!this.setTop(this.topRow + rows)) return;
    if (rows !== 0) this.direction = rows > 0 ? 'down' : 'up';
    this.rowsMoved();
  }

  /** Moves the top row to `top` (clamped), leaning prefetch the way it went. */
  moveTopTo(top: number): void {
    const before = this.topRow;
    if (!this.setTop(top)) return;
    this.direction = this.topRow > before ? 'down' : 'up';
    this.rowsMoved();
  }

  /** Scrolls `row` to the top, or as near as the end allows. */
  jumpTo(row: number): void {
    if (__LEVEL__ === 'tail') readerMoved(this, 'land', row);
    this.moveTopTo(row);
  }

  /** `fraction` of the way down: Home is 0, End is 1. */
  scrollToFraction(fraction: number): void {
    // Live tail's: Home lets go; End, or a drag released, lands.
    if (__LEVEL__ === 'tail') readerMoved(this, fraction <= 0 ? 'up' : 'land', clamp(fraction, 0, 1) * this.maxTop());
    this.moveTopTo(clamp(fraction, 0, 1) * this.maxTop());
  }

  /** The scrollbar is held: moves load nothing until it rests or lets go. */
  startDrag(): void {
    this.dragging = true;
  }

  endDrag(): void {
    // Live tail's: the release decides following, as a landing, and the
    // pin moves on: its new view's reads are planned even if the drag's
    // were.
    const pinned = __LEVEL__ === 'tail' && releaseDrag(this);
    this.dragging = false;
    if (__LEVEL__ === 'market' || __LEVEL__ === 'tail') this.dragResting = true;
    if (this.dragSettle !== null) {
      this.clock.clearTimeout(this.dragSettle);
      this.dragSettle = null;
      this.loadPages();
    } else if (__LEVEL__ === 'tail' && pinned) this.loadPages();
  }

  /** Cancels every read still out; nothing loads after. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const request of this.cache.requests()) this.source.cancel(request);
    for (const timer of [this.dragSettle, this.scrollSettle]) if (timer !== null) this.clock.clearTimeout(timer);
  }

  private setTop(top: number): boolean {
    const next = Number.isFinite(top) ? clamp(top, 0, this.maxTop()) : this.topRow;
    const moved = next !== this.topRow;
    this.topRow = next;
    return moved;
  }

  /** The visible rows changed: fetch what they need. Prefetch reaches
   *  further ahead while scrolling; once the rows rest, it evens out. */
  private rowsMoved(): void {
    if (this.direction !== 'still') {
      if (this.scrollSettle !== null) this.clock.clearTimeout(this.scrollSettle);
      this.scrollSettle = this.clock.setTimeout(() => {
        this.scrollSettle = null;
        this.direction = 'still';
        this.loadPages();
      }, this.paging.scrollSettleMs);
    }
    if (this.dragging) {
      // A drag passes through positions it won't stop at, and DuckDB-Wasm
      // can't take a read back once it starts: load once the pointer rests,
      // or on release.
      if (this.dragSettle !== null) this.clock.clearTimeout(this.dragSettle);
      if (__LEVEL__ === 'market' || __LEVEL__ === 'tail') this.dragResting = false;
      // `live`: the settle is the drag resting (only it: never the scroll's).
      this.dragSettle = this.clock.setTimeout((__LEVEL__ === 'market' || __LEVEL__ === 'tail') ? () => dragRested(this) : () => this.loadPages(), this.paging.dragSettleMs);
    } else {
      this.loadPages();
    }
  }

  private wanted(): number[] {
    // Live tail's: the visible pages bottom first while following.
    if (__LEVEL__ === 'tail') return tailFirst(this, this.cache.wanted(this.visible(), this.direction, this.paging.prefetch));
    return this.cache.wanted(this.visible(), this.direction, this.paging.prefetch);
  }

  private loadPages(): void {
    this.loadWanted(this.wanted());
  }

  /** Sends the reads the viewport needs and cancels the ones it doesn't. */
  private loadWanted(wanted: readonly number[]): void {
    if (__LEVEL__ === 'market' || __LEVEL__ === 'tail') return loadWantedLive(this, wanted);
    if (this.closed) return;
    const plan = this.cache.plan(wanted, this.cache.visiblePages(this.visible()));
    for (const request of plan.cancel) this.source.cancel(request);
    for (const page of plan.fetch) {
      const { request, result } = this.source.load(this.cache.rowsOf(page));
      this.cache.started(page, request);
      result.then(
        (data) => this.pageDone(page, request, { data }),
        (error: unknown) => this.pageDone(page, request, { error }),
      );
    }
  }

  private pageDone(page: number, request: number, answer: { data: P } | { error: unknown }): void {
    if (__LEVEL__ === 'market' || __LEVEL__ === 'tail') return pageDoneLive(this, page, request, answer);
    if (this.closed) return;
    const wanted = this.wanted();
    if ('data' in answer) {
      this.cache.loaded(page, request, answer.data, answer.data.byteLength, wanted);
    } else if ((answer.error as { name?: unknown } | null)?.name === 'AbortError') {
      this.cache.finished(request);
    } else {
      this.cache.failed(page, request, answer.error instanceof Error ? answer.error.message : String(answer.error));
    }
    this.loadWanted(wanted);
    this.onChange();
  }
}

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);
