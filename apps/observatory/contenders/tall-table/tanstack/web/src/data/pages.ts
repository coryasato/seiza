/**
 * The page cache: which fixed-size pages of rows are loaded, which are in
 * flight, and which to fetch, cancel, or evict next. A port of the tall
 * table's `PageCache` (`components/tall-table/src/pages.rs`), decision for
 * decision: the paging fixture (`fixtures/paging.json`) pins what it asks
 * for. Pure bookkeeping; `paging.ts` sends the reads.
 */

/** Which way the viewport last moved. Prefetch reaches further that way. */
export type Direction = 'still' | 'down' | 'up';

/** Rows `[start, end)`, 0-based. */
export type Rows = readonly [start: number, end: number];

type Slot<T, R> = { kind: 'loading'; request: R } | { kind: 'loaded'; page: T; bytes: number; used: number } | { kind: 'failed'; message: string };

/** What a row looks like to the view. */
export type RowState<T> = { kind: 'loaded'; page: T; index: number } | { kind: 'pending' } | { kind: 'failed'; message: string };

/** What to do after `plan`: the pages to read now, most urgent first
 *  (report each with `started`), and the reads nobody needs any more
 *  (report each answer with `finished`, or `loaded`/`failed` if it won the
 *  race). */
export interface Plan<R> {
  fetch: number[];
  cancel: R[];
}

export class PageCache<T, R> {
  readonly pageRows: number;
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

  constructor(rows: number, pageRows: number, budgetBytes: number, maxInFlight: number) {
    this.rows = rows;
    this.pageRows = Math.max(1, pageRows);
    this.budgetBytes = budgetBytes;
    this.maxInFlight = Math.max(1, maxInFlight);
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
    for (const slot of this.slots.values()) if (slot.kind === 'loading') count++;
    return count;
  }

  /** Every read still wanted, to cancel when the table goes away. */
  requests(): R[] {
    return [...this.slots.values()].flatMap((slot) => (slot.kind === 'loading' ? [slot.request] : []));
  }

  row(row: number): RowState<T> {
    const page = Math.floor(row / this.pageRows);
    const slot = this.slots.get(page);
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
      }
    }
    this.draining.push(...cancel);
    const tick = ++this.tick;
    let inFlight = this.inFlight() + this.draining.length;
    const fetch: number[] = [];
    const shown = Math.min(visible, wanted.length);
    // Loading or not asked for yet. A failed page isn't retried while it
    // stays in view, so it mustn't hold prefetch back.
    const visibleMissing = wanted.slice(0, shown).some((page) => {
      const slot = this.slots.get(page);
      return slot === undefined || slot.kind === 'loading';
    });
    const reach = visibleMissing ? shown : wanted.length;
    wanted.forEach((page, index) => {
      const slot = this.slots.get(page);
      if (slot?.kind === 'loaded') {
        // Prefetch pages beyond reach are still marked used, so they aren't
        // evicted while the visible ones load.
        slot.used = tick;
      } else if (index < reach && slot === undefined && inFlight < this.maxInFlight) {
        fetch.push(page);
        inFlight++;
      }
    });
    return { fetch, cancel };
  }

  /** `page`'s read was sent as `request`. */
  started(page: number, request: R): void {
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
    const slot = this.slots.get(page);
    if (slot?.kind !== 'loading' || slot.request !== request) return false;
    this.slots.set(page, { kind: 'loaded', page: data, bytes, used: ++this.tick });
    this.usedBytes += bytes;
    this.evict(wanted);
    return true;
  }

  /** `request` for `page` failed. The rows show the error while they're in
   *  view; once they aren't, `plan` forgets it, so coming back retries. */
  failed(page: number, request: R, message: string): void {
    this.finished(request);
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
        if (!oldest || slot.used < oldest.used || (slot.used === oldest.used && page < oldest.page)) oldest = { page, used: slot.used, bytes: slot.bytes };
      }
      if (!oldest) return;
      this.slots.delete(oldest.page);
      this.usedBytes -= oldest.bytes;
    }
  }
}
