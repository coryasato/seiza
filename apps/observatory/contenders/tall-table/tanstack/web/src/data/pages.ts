/**
 * The page cache: which fixed-size pages of rows are loaded, which are in
 * flight, and which to fetch, cancel, or evict next. A port of the tall
 * table's `PageCache` (`components/tall-table/src/pages.rs`), decision for
 * decision: the paging fixture (`fixtures/paging.json`) pins what it asks
 * for. Pure bookkeeping; `paging.ts` sends the reads.
 *
 * On market watch's, live tail's, and the monitoring wall's levels, `live`
 * too (`live.ts`): a loaded page can be stale, drawn while it's read again.
 * Its branches here sit behind the build constant (`__LEVEL__ === 'market'
 * || __LEVEL__ === 'tail' || __LEVEL__ === 'wall'`), so no other level's
 * bundle carries them, and the operations
 * only it has are `live.ts`'s functions, which reach the cache's private
 * members through a typed view of them (`live.ts`'s `CacheInside`). On live
 * tail's alone, the rows grow and shrink (`follow.ts`'s `setRows`, the
 * table's `set_rows`), and a grown short last page is kept, stale, drawing
 * the rows it was read with: its branches sit behind `__LEVEL__ === 'tail'`.
 */

import { copyHas, copyReading, grantCopy, newCacheCopy, type CacheCopy } from './copy.ts';
import { type Live, type LiveBooks, type RowSet, type Rereads, attachLive, cancelLive, landReread, liveRequests, newBooks, newRereads, planLive, reread, startReread } from './live.ts';

/** Which way the viewport last moved. Prefetch reaches further that way. */
export type Direction = 'still' | 'down' | 'up';

/** Rows `[start, end)`, 0-based. */
export type Rows = readonly [start: number, end: number];

/** A slot; with `live`, a read's `stale` (invalidated during it) and
 *  `changed` rows (the flash's), and a loaded page's re-reads; on live
 *  tail's level, the end of the rows a read asks for (`end`: what the page
 *  holds once it lands, if the rows grew meanwhile). */
export type Slot<T, R> =
  | { kind: 'loading'; request: R; stale?: boolean; changed?: RowSet; end?: number }
  | { kind: 'loaded'; page: T; bytes: number; used: number; live?: Live<R> }
  | { kind: 'failed'; message: string };

/** What a row looks like to the view. */
export type RowState<T> = { kind: 'loaded'; page: T; index: number } | { kind: 'pending' } | { kind: 'failed'; message: string };

/** What to do after `plan`: the pages to read now, most urgent first
 *  (report each with `started`), and the reads nobody needs any more
 *  (report each answer with `finished`, or `loaded`/`failed` if it won the
 *  race). */
export interface Plan<R> {
  fetch: number[];
  cancel: R[];
  /** The wide level's `copy`: how many of the copy's wants may start now,
   *  sent before `fetch[copyAt..]` (after the visible pages, before
   *  prefetch). */
  copy?: number;
  copyAt?: number;
}

export class PageCache<T, R> {
  readonly pageRows: number;
  /** Fixed but on live tail's level, where `follow.ts`'s `setRows` moves it. */
  readonly rows: number;
  /** Loaded pages beyond this many bytes are evicted, least recently used
   *  first, unless they're wanted right now. */
  private readonly budgetBytes: number;
  /** Reads in flight at once, cancelled ones included: DuckDB-Wasm can't
   *  stop a page read it has started, so a cancelled one holds the worker. */
  private readonly maxInFlight: number;
  /** In insertion order, as a page first got a slot. */
  private readonly slots = new Map<number, Slot<T, R>>();
  /** Cancelled reads that haven't answered yet. They count against
   *  `maxInFlight` until they do. */
  private draining: R[] = [];
  private usedBytes = 0;
  private tick = 0;
  /** `live`'s books (market watch's level). */
  declare private live: LiveBooks;
  /** `copy`'s reads in flight and wants (the wide level's, `copy.ts`). */
  declare private copy: CacheCopy<R>;

  constructor(rows: number, pageRows: number, budgetBytes: number, maxInFlight: number) {
    this.rows = rows;
    this.pageRows = Math.max(1, pageRows);
    this.budgetBytes = budgetBytes;
    this.maxInFlight = Math.max(1, maxInFlight);
    if (__LEVEL__ === 'market' || __LEVEL__ === 'tail' || __LEVEL__ === 'wall') this.live = newBooks();
    if (__LEVEL__ === 'wide') this.copy = newCacheCopy();
  }

  pages(): number {
    return Math.ceil(this.rows / this.pageRows);
  }

  /** The rows page `page` holds. */
  rowsOf(page: number): Rows {
    const start = page * this.pageRows;
    return [Math.min(start, this.rows), Math.min(start + this.pageRows, this.rows)];
  }

  /** Bytes held by loaded pages: each page's Arrow IPC bytes, as it
   *  arrived (the component's `heap_bytes`). */
  bytes(): number {
    return this.usedBytes;
  }

  loadedPages(): number {
    let count = 0;
    for (const slot of this.slots.values()) if (slot.kind === 'loaded') count++;
    return count;
  }

  /** Reads for pages still wanted. */
  inFlight(): number {
    let count = 0;
    for (const slot of this.slots.values()) if (slot.kind === 'loading' || ((__LEVEL__ === 'market' || __LEVEL__ === 'tail' || __LEVEL__ === 'wall') && slot.kind === 'loaded' && slot.live?.reading)) count++;
    return count;
  }

  /** Every read still wanted, to cancel when the table goes away. */
  requests(): R[] {
    if (__LEVEL__ === 'market' || __LEVEL__ === 'tail' || __LEVEL__ === 'wall') return liveRequests(this);
    return [...this.slots.values()].flatMap((slot) => (slot.kind === 'loading' ? [slot.request] : []));
  }

  row(row: number): RowState<T> {
    const page = Math.floor(row / this.pageRows);
    const slot = this.slots.get(page);
    // Past what a grown page was read with (live tail's): not loaded yet.
    if (__LEVEL__ === 'tail' && slot?.kind === 'loaded' && row >= slot.live!.end!) return { kind: 'pending' };
    if (slot?.kind === 'loaded') return { kind: 'loaded', page: slot.page, index: row - page * this.pageRows };
    if (slot?.kind === 'failed') return { kind: 'failed', message: slot.message };
    return { kind: 'pending' };
  }

  /** The pages worth having for the `visible` rows, most urgent first: the
   *  visible pages (from the edge the viewport is moving toward), then
   *  `prefetch` pages behind and `prefetch` ahead, doubled ahead while
   *  moving, nearest first. */
  wanted(visible: Rows, direction: Direction, prefetch: number): number[] {
    const pages = this.pages();
    if (pages === 0) return [];
    const [first, last] = this.visibleSpan(visible);
    const wanted: number[] = [];
    for (let page = first; page <= last; page++) wanted.push(page);
    if (direction === 'up') wanted.reverse();
    const ahead = direction === 'still' ? prefetch : prefetch * 2;
    const behind = prefetch;
    // The page `step` pages beyond the visible ones, below or above.
    const beyond = (down: boolean, step: number) => {
      const page = down ? last + step : first - step;
      if (page >= 0 && page < pages) wanted.push(page);
    };
    const forwardIsDown = direction !== 'up';
    for (let step = 1; step <= Math.max(ahead, behind); step++) {
      if (step <= ahead) beyond(forwardIsDown, step);
      if (step <= behind) beyond(!forwardIsDown, step);
    }
    return wanted;
  }

  /** How many pages the `visible` rows touch: the head of `wanted`'s list. */
  visiblePages(visible: Rows): number {
    if (this.pages() === 0) return 0;
    const [first, last] = this.visibleSpan(visible);
    return last - first + 1;
  }

  /** The first and last page the `visible` rows touch. Needs a page. */
  private visibleSpan([start, end]: Rows): [number, number] {
    const pages = this.pages();
    const first = Math.min(Math.floor(start / this.pageRows), pages - 1);
    const last = Math.min(Math.max(Math.floor(Math.max(end - 1, start) / this.pageRows), first), pages - 1);
    return [first, last];
  }

  /**
   * Reconciles the cache with `wanted` (from `wanted`): cancels in-flight
   * pages that aren't wanted, forgets failures that aren't (so coming back
   * retries them), marks wanted loaded pages as used, and picks what to
   * fetch, up to the in-flight limit.
   *
   * The first `visible` pages of `wanted` are on screen. While any of them
   * isn't loaded, no prefetch page starts: DuckDB-Wasm runs one query slice
   * at a time, round-robin, so a prefetch next to a visible page makes it
   * finish as late as both.
   */
  plan(wanted: readonly number[], visible: number): Plan<R> {
    const cancel: R[] = [];
    for (const [page, slot] of this.slots) {
      if (slot.kind === 'loading' && !wanted.includes(page)) {
        cancel.push(slot.request);
        this.slots.delete(page);
      } else if (slot.kind === 'failed' && !wanted.includes(page)) {
        this.slots.delete(page);
      } else if ((__LEVEL__ === 'market' || __LEVEL__ === 'tail' || __LEVEL__ === 'wall') && slot.kind === 'loaded') {
        // A stale page nobody wants is dropped, its re-read cancelled.
        const reading = planLive(this, page, slot, wanted);
        if (reading !== null) cancel.push(reading);
      }
    }
    this.draining.push(...cancel);
    const tick = ++this.tick;
    let inFlight = this.inFlight() + this.draining.length;
    // The wide level's: the copy's reads count in flight, never cached.
    if (__LEVEL__ === 'wide') inFlight += copyReading(this);
    const fetch: number[] = [];
    const shown = Math.min(visible, wanted.length);
    // Loading or not asked for yet. A failed page isn't retried while it
    // stays in view, so it mustn't hold prefetch back.
    const visibleMissing = wanted.slice(0, shown).some((page) => {
      const slot = this.slots.get(page);
      // Live tail's: a grown page whose new rows are in view hasn't them to
      // show either, unless its re-read failed (it isn't read again until
      // its rows change, as a failed page isn't).
      if (__LEVEL__ === 'tail' && slot?.kind === 'loaded') return slot.live!.end! < this.rowsOf(page)[1] && !slot.live!.failed;
      return slot === undefined || slot.kind === 'loading';
    });
    const reach = visibleMissing ? shown : wanted.length;
    // `live`: re-reads at most `maxInFlight − 1` at once, the visible
    // pages' after the visible pages with nothing to show, then the rest
    // as prefetch, in `wanted`'s order.
    const rereads: Rereads | null = __LEVEL__ === 'market' || __LEVEL__ === 'tail' || __LEVEL__ === 'wall' ? newRereads(this) : null;
    // The wide level's `copy`: its reads granted once, after the visible
    // pages and before prefetch; prefetch skips a page it reads.
    let grant: { copy: number; copyAt: number } | null = null;
    wanted.forEach((page, index) => {
      if ((__LEVEL__ === 'market' || __LEVEL__ === 'tail' || __LEVEL__ === 'wall') && index === shown) inFlight += reread(this, wanted.slice(0, shown), rereads!, inFlight, fetch);
      if (__LEVEL__ === 'wide' && index === shown) {
        grant = grantCopy(this, visibleMissing, inFlight, fetch);
        inFlight += grant.copy;
      }
      const slot = this.slots.get(page);
      if (slot?.kind === 'loaded') {
        // Prefetch pages beyond reach are still marked used, so they aren't
        // evicted while the visible ones load.
        slot.used = tick;
        if ((__LEVEL__ === 'market' || __LEVEL__ === 'tail' || __LEVEL__ === 'wall') && index >= shown && index < reach) inFlight += reread(this, [page], rereads!, inFlight, fetch);
      } else if (index < reach && slot === undefined && inFlight < this.maxInFlight) {
        if (__LEVEL__ === 'wide' && index >= shown && copyHas(this, page, grant!.copy)) return;
        fetch.push(page);
        inFlight++;
      }
    });
    if (__LEVEL__ === 'wide') {
      grant ??= grantCopy(this, visibleMissing, inFlight, fetch);
      return { fetch, cancel, copy: grant.copy, copyAt: grant.copyAt };
    }
    if (__LEVEL__ === 'market' || __LEVEL__ === 'tail' || __LEVEL__ === 'wall') {
      if (wanted.length === shown) inFlight += reread(this, wanted, rereads!, inFlight, fetch);
      // The control: stale pages outside `wanted` kept and read again.
      if (this.live.control === 'reread-unwanted')
        reread(this, [...this.slots.keys()].filter((page) => !wanted.includes(page)), rereads!, inFlight, fetch);
    }
    return { fetch, cancel };
  }

  /** `page`'s read was sent as `request`. */
  started(page: number, request: R): void {
    // `live`: a loaded page's read is a re-read, drawn until it lands.
    if ((__LEVEL__ === 'market' || __LEVEL__ === 'tail' || __LEVEL__ === 'wall') && startReread(this, page, request)) return;
    // Live tail's: the rows it asks for, what it holds once it lands.
    if (__LEVEL__ === 'tail') return void this.slots.set(page, { kind: 'loading', request, end: this.rowsOf(page)[1] });
    this.slots.set(page, { kind: 'loading', request });
  }

  /**
   * `request` for `page` answered with `data`, `bytes` long. Kept only if
   * that read is still the page's (not cancelled or superseded); then pages
   * outside `wanted` are evicted, least recently used first, until the
   * cache fits its budget. Returns whether the page was kept.
   */
  loaded(page: number, request: R, data: T, bytes: number, wanted: readonly number[]): boolean {
    this.finished(request);
    // `live`: a re-read's page replaces the one drawn.
    if ((__LEVEL__ === 'market' || __LEVEL__ === 'tail' || __LEVEL__ === 'wall') && this.slots.get(page)?.kind === 'loaded') return landReread(this, page, request, data, bytes, wanted);
    const slot = this.slots.get(page);
    if (slot?.kind !== 'loading' || slot.request !== request) return false;
    this.slots.set(page, { kind: 'loaded', page: data, bytes, used: ++this.tick });
    if (__LEVEL__ === 'market' || __LEVEL__ === 'tail' || __LEVEL__ === 'wall') attachLive(this, page, slot);
    this.usedBytes += bytes;
    this.evict(wanted);
    return true;
  }

  /** `request` for `page` failed. The rows show the error while they're in
   *  view; once they aren't, `plan` forgets it, so coming back retries. */
  failed(page: number, request: R, message: string): void {
    this.finished(request);
    // `live`: a failed re-read keeps the old rows drawn, stale, until the next invalidation.
    if ((__LEVEL__ === 'market' || __LEVEL__ === 'tail' || __LEVEL__ === 'wall') && this.slots.get(page)?.kind === 'loaded') return cancelLive(this, page, request, true);
    const slot = this.slots.get(page);
    if (slot?.kind === 'loading' && slot.request === request) this.slots.set(page, { kind: 'failed', message });
  }

  /** `request` answered (a cancelled one, or any other): it no longer holds
   *  a place in flight. `loaded` and `failed` call this themselves. */
  finished(request: R): void {
    this.draining = this.draining.filter((draining) => draining !== request);
  }

  private evict(wanted: readonly number[]): void {
    while (this.usedBytes > this.budgetBytes) {
      // The least recently used page that isn't wanted; ties (never, since
      // every use takes a new tick) would go to the lower page, as in Rust.
      let oldest: { page: number; used: number; bytes: number } | null = null;
      for (const [page, slot] of this.slots) {
        if (slot.kind !== 'loaded' || wanted.includes(page)) continue;
        // `live`: a page being read again stays until its read lands or `plan` cancels it.
        if ((__LEVEL__ === 'market' || __LEVEL__ === 'tail' || __LEVEL__ === 'wall') && slot.live?.reading) continue;
        if (!oldest || slot.used < oldest.used || (slot.used === oldest.used && page < oldest.page)) oldest = { page, used: slot.used, bytes: slot.bytes };
      }
      if (!oldest) return;
      this.slots.delete(oldest.page);
      this.usedBytes -= oldest.bytes;
    }
  }
}
