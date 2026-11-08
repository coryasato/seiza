/**
 * The table's `live` (market watch's level): rows invalidated in the source
 * are read again, a loaded page drawn as it is until its re-read lands. A
 * port of the tall table's re-read paths (`components/tall-table/src/`
 * `pages.rs`'s `Live` and `state.rs`'s `invalidate_rows`,
 * `load_after_update`, `answered`, `page_done`), decision for decision:
 * `paging.json`'s `live` scenarios pin the reads. A grown page's paths
 * (`end`, `readingEnd`) are live tail's alone, where the rows grow
 * (`follow.ts`'s `setRows`): behind `__LEVEL__ === 'tail'`, so market
 * watch's bundle carries none of them.
 *
 * `pages.ts` and `paging.ts` call in here only behind the build constant
 * (`__LEVEL__ === 'market' || __LEVEL__ === 'tail'`), so no other level's
 * bundle carries any of it; what only `live` does is a function here over the cache or the
 * paging, never a method of theirs (a method would stay in every bundle).
 * The functions reach their private members through a typed view of them
 * (`CacheInside`, `PagingInside`), so the classes keep them private to
 * every other caller.
 */

import { pinAndWant } from './follow.ts';
import type { PageCache, Plan, Rows, Slot } from './pages.ts';
import type { Page, PageSource, TablePaging } from './paging.ts';

/** The paging fixture's `live` controls (`paging.json`), each a way to
 *  re-read wrongly that the fixture must catch, and its `cache` control
 *  (`keep-past-end`, a shrink's; live tail's, as `drop-grown` is); `null`
 *  in the contender. */
export type LiveControl = 'reread-unwanted' | 'restart-stale' | 'drop-grown' | 'keep-past-end' | null;

/** The cache's own `live` state. */
export interface LiveBooks {
  /** Bumped by each invalidation. */
  generation: number;
  /** Some page has a landed re-read `takeRefreshed` hasn't taken. */
  landed: boolean;
  /** Keep each page's changed rows: a column flashes. */
  track: boolean;
  control: LiveControl;
}

/** A loaded page's re-reads. */
export interface Live<R> {
  /** Rows were invalidated since its last read started: it needs another. */
  stale: boolean;
  /** The re-read in flight, and the generation it started at. */
  reading: { request: R; generation: number } | null;
  /** The last re-read failed: not read again until the next invalidation. */
  failed: boolean;
  /** A re-read landed and isn't taken yet: its generation. */
  landed: number | null;
  /** Rows invalidated since the drawn page's read started, before the
   *  re-read in flight did (or with none out): compared when it lands. */
  changed: RowSet;
  /** Rows invalidated while the re-read in flight is out: compared too, and
   *  kept for the next read (its answer may or may not hold the change). */
  changedDuring: RowSet;
  /** Live tail's: the end of the rows the drawn page holds (past it, the
   *  rows grew since it was read: placeholders), and the end of those the
   *  re-read in flight asks for. */
  end?: number;
  readingEnd?: number;
}

/** Rows, as sorted ranges that never overlap or touch. */
export class RowSet {
  ranges: Rows[] = [];

  add([start, end]: Rows): void {
    if (start >= end) return;
    let [from, to] = [start, end];
    // Every range touching the rows merges into them.
    this.ranges = this.ranges.filter(([s, e]) => {
      const touches = s <= to && from <= e;
      if (touches) [from, to] = [Math.min(from, s), Math.max(to, e)];
      return !touches;
    });
    const at = this.ranges.findIndex(([s]) => s >= from);
    this.ranges.splice(at < 0 ? this.ranges.length : at, 0, [from, to]);
  }

  extend(other: RowSet): void {
    for (const rows of other.ranges) this.add(rows);
  }

  isEmpty(): boolean {
    return this.ranges.length === 0;
  }

  /** Each row, in order. */
  *rows(): Generator<number> {
    for (const [start, end] of this.ranges) for (let row = start; row < end; row++) yield row;
  }
}

/** The cache's members `live` reads and writes, private to every other caller. */
interface CacheInside<T, R> {
  readonly slots: Map<number, Slot<T, R>>;
  draining: R[];
  usedBytes: number;
  tick: number;
  readonly maxInFlight: number;
  readonly pageRows: number;
  live: LiveBooks;
  evict(wanted: readonly number[]): void;
  rowsOf(page: number): Rows;
  finished(request: R): void;
  visiblePages(visible: Rows): number;
  plan(wanted: readonly number[], visible: number): Plan<R>;
  started(page: number, request: R): void;
  loaded(page: number, request: R, data: T, bytes: number, wanted: readonly number[]): boolean;
  failed(page: number, request: R, message: string): void;
}

const inside = <T, R>(cache: PageCache<T, R>): CacheInside<T, R> => cache as unknown as CacheInside<T, R>;

/** The paging's members `live` reads and writes, private to every other caller. */
interface PagingInside<P extends Page> {
  readonly cache: PageCache<P, number>;
  readonly source: PageSource<P>;
  dragging: boolean;
  dragResting: boolean;
  loadDeferred: boolean;
  closed: boolean;
  onChange: () => void;
  onLanded?: (page: number, old: P, landed: P, rows: RowSet) => void;
  visible(): Rows;
  wanted(): number[];
  loadPages(): void;
  loadWanted(wanted: readonly number[]): void;
  pageDone(page: number, request: number, answer: { data: P } | { error: unknown }): void;
}

const insidePaging = <P extends Page>(table: TablePaging<P>): PagingInside<P> => table as unknown as PagingInside<P>;

const newLive = <R>(stale: boolean, changed = new RowSet()): Live<R> => ({ stale, reading: null, failed: false, landed: null, changed, changedDuring: new RowSet() });

/** What's drawn is older than the source: invalidated, or being read again. */
const outdated = (live: Live<unknown>): boolean => live.stale || live.reading !== null;

/** Wants a re-read started now. */
const wantsRead = (live: Live<unknown>): boolean => live.stale && live.reading === null && !live.failed;

type Loaded<T, R> = Extract<Slot<T, R>, { kind: 'loaded' }>;
type Loading<T, R> = Extract<Slot<T, R>, { kind: 'loading' }>;

// --- the cache ---

/** The cache's books, set up by its constructor on the market level. */
export const newBooks = (): LiveBooks => ({ generation: 0, landed: false, track: false, control: null });

/** `plan`'s pass over a loaded page: a stale page nobody wants is dropped
 *  (rows known to be old aren't kept for later), its re-read returned to
 *  cancel. The control `restart-stale` cancels a stale page's re-read
 *  instead, to read it anew. */
export function planLive<T, R>(of: PageCache<T, R>, page: number, slot: Loaded<T, R>, wanted: readonly number[]): R | null {
  const cache = inside(of);
  const live = slot.live!;
  if (outdated(live) && !wanted.includes(page) && cache.live.control !== 'reread-unwanted') {
    cache.usedBytes -= slot.bytes;
    cache.slots.delete(page);
    return live.reading ? live.reading.request : null;
  }
  if (cache.live.control === 'restart-stale' && live.stale && live.reading) {
    const { request } = live.reading;
    live.reading = null;
    return request;
  }
  return null;
}

/** A plan's re-reads: in flight, and at most how many at once. */
export interface Rereads {
  inFlight: number;
  limit: number;
}

/** One fewer than `maxInFlight` (so a visible page always finds a place),
 *  and at least one. */
export function newRereads<T, R>(of: PageCache<T, R>): Rereads {
  const cache = inside(of);
  let inFlight = 0;
  for (const slot of cache.slots.values()) if (slot.kind === 'loaded' && slot.live?.reading) inFlight++;
  return { inFlight, limit: Math.max(cache.maxInFlight - 1, 1) };
}

/** Adds `pages`' wanted re-reads to `fetch`, under the in-flight limit
 *  (`inFlight` already out) and the re-reads' own; returns how many. */
export function reread<T, R>(of: PageCache<T, R>, pages: readonly number[], rereads: Rereads, inFlight: number, fetch: number[]): number {
  const cache = inside(of);
  let added = 0;
  for (const page of pages) {
    const slot = cache.slots.get(page);
    if (slot?.kind === 'loaded' && wantsRead(slot.live!) && inFlight + added < cache.maxInFlight && rereads.inFlight < rereads.limit && !fetch.includes(page)) {
      fetch.push(page);
      added++;
      rereads.inFlight++;
    }
  }
  return added;
}

/** `started` for a loaded page: its read is a re-read, the page drawn until it lands. */
export function startReread<T, R>(of: PageCache<T, R>, page: number, request: R): boolean {
  const cache = inside(of);
  const slot = cache.slots.get(page);
  if (slot?.kind !== 'loaded') return false;
  slot.live!.reading = { request, generation: cache.live.generation };
  if (__LEVEL__ === 'tail') slot.live!.readingEnd = cache.rowsOf(page)[1];
  slot.live!.stale = false;
  return true;
}

/** A first read landed: its page gets its re-read state, stale if it was
 *  invalidated during the read (and those rows compared by the next). */
export function attachLive<T, R>(of: PageCache<T, R>, page: number, read: Loading<T, R>): void {
  const slot = inside(of).slots.get(page) as Loaded<T, R>;
  slot.live = newLive(read.stale ?? false, read.changed);
  // Live tail's: it holds the rows its read asked for.
  if (__LEVEL__ === 'tail') slot.live.end = slot.live.readingEnd = read.end!;
}

/** A re-read's answer for a loaded page: kept only if it's the page's read
 *  out; then it replaces the page drawn (its bytes for the old page's) and
 *  waits for `takeRefreshed`. A page invalidated during the read stays
 *  stale, and is read again. */
export function landReread<T, R>(of: PageCache<T, R>, page: number, request: R, data: T, bytes: number, wanted: readonly number[]): boolean {
  const cache = inside(of);
  const slot = cache.slots.get(page) as Loaded<T, R>;
  const live = slot.live!;
  if (live.reading?.request !== request) return false;
  slot.page = data;
  cache.usedBytes += bytes - slot.bytes;
  slot.bytes = bytes;
  slot.used = ++cache.tick;
  live.landed = live.reading.generation;
  live.reading = null;
  if (__LEVEL__ === 'tail') live.end = live.readingEnd;
  // Compared (`changes`); those invalidated during the read, by the next one too.
  live.changed = live.changedDuring;
  live.changedDuring = new RowSet();
  cache.live.landed = true;
  cache.evict(wanted);
  return true;
}

/** A loaded page's re-read ended without landing: `failed` (the old rows
 *  stay drawn, stale, not read again until the next invalidation), or
 *  refused by its source (its place freed, read again at the next
 *  invalidation). What changed during it waits for the next read. */
export function cancelLive<T, R>(of: PageCache<T, R>, page: number, request: R, failed: boolean): void {
  const slot = inside(of).slots.get(page);
  if (slot?.kind !== 'loaded' || slot.live!.reading?.request !== request) return;
  const live = slot.live!;
  live.reading = null;
  if (failed) {
    live.stale = true;
    live.failed = true;
  }
  live.changed.extend(live.changedDuring);
  live.changedDuring = new RowSet();
}

/** Every read still wanted, re-reads too, to cancel when the table goes away. */
export function liveRequests<T, R>(of: PageCache<T, R>): R[] {
  return [...inside(of).slots.values()].flatMap((slot) => (slot.kind === 'loading' ? [slot.request] : slot.kind === 'loaded' && slot.live!.reading ? [slot.live!.reading.request] : []));
}

/** `rows` changed in the source: their pages loaded or being read go
 *  stale (and keep the rows, while a column flashes). Returns this
 *  invalidation's generation, which grows with each. */
function invalidate<T, R>(of: PageCache<T, R>, [start, end]: Rows): number {
  const cache = inside(of);
  const books = cache.live;
  books.generation++;
  if (start >= end) return books.generation;
  const [first, last] = [Math.floor(start / cache.pageRows), Math.floor((end - 1) / cache.pageRows)];
  for (const [page, slot] of cache.slots) {
    if (page < first || page > last) continue;
    // The rows of this page that changed.
    const mine: Rows = [Math.max(start, page * cache.pageRows), Math.min(end, (page + 1) * cache.pageRows)];
    if (slot.kind === 'loading') {
      slot.stale = true;
      if (books.track) (slot.changed ??= new RowSet()).add(mine);
    } else if (slot.kind === 'loaded') {
      const live = slot.live!;
      live.stale = true;
      live.failed = false;
      if (books.track) (live.reading ? live.changedDuring : live.changed).add(mine);
    }
  }
  return books.generation;
}

/** When `request`, `page`'s re-read, lands: the page it replaces and the
 *  rows invalidated since that page's read started, to compare (the
 *  flash). Null for any other answer, or nothing to compare. */
function changes<T, R>(of: PageCache<T, R>, page: number, request: R): { page: T; rows: RowSet } | null {
  const slot = inside(of).slots.get(page);
  if (slot?.kind !== 'loaded' || slot.live!.reading?.request !== request) return null;
  const rows = new RowSet();
  rows.extend(slot.live!.changed);
  rows.extend(slot.live!.changedDuring);
  // Live tail's: a grown page's rows past what it was read with weren't
  // drawn: nothing to compare them with.
  if (__LEVEL__ === 'tail') truncate(rows, Math.min(slot.live!.end!, slot.live!.readingEnd!));
  return rows.isEmpty() ? null : { page: slot.page, rows };
}

// --- the paging ---

/** `rows` changed in the source (`invalidate_rows`): their pages that are
 *  wanted, loaded or being read, are read again, a loaded one drawn as it
 *  is until the new page lands; the others are dropped. The reads start
 *  once the task that called this ends (a microtask: one plan for every
 *  invalidation in it), and as a scroll's do: during a scrollbar drag,
 *  once the pointer rests. Returns this invalidation's generation: the
 *  first refreshed view at or past it, over a row of `rows`, shows it. */
export function invalidateRows<P extends Page>(of: TablePaging<P>, rows: Rows): number {
  const table = insidePaging(of);
  const generation = invalidate(table.cache, rows);
  // One plan for every invalidation in the task; a drag still moving: its
  // settle loads them with the rest. (`follow.ts`'s `setRows` keeps a copy:
  // a function for both changes market watch's bundle.)
  if ((!table.dragging || table.dragResting) && !table.loadDeferred) {
    table.loadDeferred = true;
    queueMicrotask(() => {
      table.loadDeferred = false;
      if (!table.dragging || table.dragResting) table.loadPages();
    });
  }
  return generation;
}

/** The drag's settle fired: its pointer rested, so its position loads, and
 *  an invalidation's reads may start. Only the drag's settle: never the
 *  scroll's, which can fire mid-drag. */
export function dragRested<P extends Page>(of: TablePaging<P>): void {
  const table = insidePaging(of);
  table.dragResting = true;
  table.loadPages();
}

/** Keep each page's changed rows from now on (a column flashes), for
 *  `onLanded`; off, none are kept and nothing is compared. */
export function trackChanges<P extends Page>(of: TablePaging<P>, track: boolean): void {
  const cache = inside(insidePaging(of).cache);
  cache.live.track = track;
  if (track) return;
  for (const slot of cache.slots.values()) {
    if (slot.kind === 'loading') slot.changed = undefined;
    else if (slot.kind === 'loaded') {
      slot.live!.changed = new RowSet();
      slot.live!.changedDuring = new RowSet();
    }
  }
}

/** The re-reads that landed since the last call, each once: those whose
 *  pages touch the visible rows, as (the rows the read holds, the
 *  generation its read started at), in page order. The others are dropped:
 *  a page re-read off screen reports nothing, then or later. */
export function takeRefreshed<P extends Page>(of: TablePaging<P>): Array<{ rows: Rows; generation: number }> {
  const table = insidePaging(of);
  const cache = inside(table.cache);
  if (!cache.live.landed) return [];
  cache.live.landed = false;
  const landed: Array<[number, number]> = [];
  for (const [page, slot] of cache.slots) {
    if (slot.kind === 'loaded' && slot.live!.landed !== null) {
      landed.push([page, slot.live!.landed]);
      slot.live!.landed = null;
    }
  }
  const [start, end] = table.visible();
  return landed
    .sort(([a], [b]) => a - b)
    // Live tail's: a grown page's rows up to where it was read.
    .map(([page, generation]) => ({ rows: __LEVEL__ === 'tail' ? heldRows(cache, page) : cache.rowsOf(page), generation }))
    .filter(({ rows: [first, last] }) => first < end && start < last);
}

/** Drops `set`'s rows at or past `end` (live tail's: a function, so no
 *  other level's bundle carries it, as a method of `RowSet` would). */
function truncate(set: RowSet, end: number): void {
  set.ranges = set.ranges.flatMap(([start, stop]): Rows[] => (start < Math.min(stop, end) ? [[start, Math.min(stop, end)]] : []));
}

/** The rows `page` holds as drawn (live tail's): a grown page's up to where it was read. */
function heldRows<T, R>(cache: CacheInside<T, R>, page: number): Rows {
  const [start, end] = cache.rowsOf(page);
  const slot = cache.slots.get(page) as Loaded<T, R>;
  return [start, Math.min(end, slot.live!.end!)];
}

/** Sets the fixture's control on the paging's cache (tests only: `null` in the contender). */
export function setLiveControl<P extends Page>(of: TablePaging<P>, control: LiveControl): void {
  inside(insidePaging(of).cache).live.control = control;
}

/** `loadWanted` with `live` (`load_wanted`): sends the reads the viewport
 *  needs and cancels the ones it doesn't; re-reads the source answered in
 *  hand land once every read of the plan has started, then it plans once
 *  more (pages stale again, or still waiting for a place), unless a drag
 *  moved on. */
export function loadWantedLive<P extends Page>(of: TablePaging<P>, wanted: readonly number[]): void {
  const table = insidePaging(of);
  if (table.closed) return;
  const cache = inside(table.cache);
  const plan = cache.plan(wanted, cache.visiblePages(table.visible()));
  for (const request of plan.cancel) table.source.cancel(request);
  const ready: Array<[page: number, request: number, data: P]> = [];
  for (const page of plan.fetch) {
    const reread = cache.slots.get(page)?.kind === 'loaded';
    const { request, result, ready: inHand } = table.source.load(cache.rowsOf(page));
    cache.started(page, request);
    if (reread && inHand !== undefined) {
      // Landed from `ready`: its promise is never read, nor its rejection.
      result.catch(() => {});
      ready.push([page, request, inHand]);
      continue;
    }
    result.then(
      (data) => table.pageDone(page, request, { data }),
      (error: unknown) => table.pageDone(page, request, { error }),
    );
  }
  if (ready.length === 0) return;
  for (const [page, request, data] of ready) land(table, page, request, data, wanted);
  table.onChange();
  // Live tail's: the pin moves on to the rows landed, and the new view's
  // pages are wanted instead.
  const pinned = __LEVEL__ === 'tail' ? pinAndWant(of) : null;
  if (!table.dragging || table.dragResting) table.loadWanted(pinned ?? wanted);
}

/** `pageDone` with `live` (`page_done`): a source's refusal frees a
 *  re-read's place; a drag still moving starts nothing (its settle loads
 *  what's next: a read landing, one nearly always out under a feed, would
 *  start reads of the pages the drag only passes). */
export function pageDoneLive<P extends Page>(of: TablePaging<P>, page: number, request: number, answer: { data: P } | { error: unknown }): void {
  const table = insidePaging(of);
  if (table.closed) return;
  const cache = inside(table.cache);
  const wanted = table.wanted();
  if ('data' in answer) land(table, page, request, answer.data, wanted);
  else if ((answer.error as { name?: unknown } | null)?.name === 'AbortError') {
    cache.finished(request);
    cancelLive(table.cache, page, request, false);
  } else cache.failed(page, request, answer.error instanceof Error ? answer.error.message : String(answer.error));
  // Live tail's: the pin moves on to the rows landed (never during a drag),
  // and the new view's pages are wanted instead.
  const pinned = __LEVEL__ === 'tail' ? pinAndWant(of) : null;
  if (!table.dragging || table.dragResting) table.loadWanted(pinned ?? wanted);
  table.onChange();
}

/** A page's answer lands, its changes handed to `onLanded` first (the
 *  flash), before the cache swaps the pages. */
function land<P extends Page>(table: PagingInside<P>, page: number, request: number, data: P, wanted: readonly number[]): void {
  const changed = table.onLanded ? changes(table.cache, page, request) : null;
  if (changed) table.onLanded!(page, changed.page, data, changed.rows);
  inside(table.cache).loaded(page, request, data, data.byteLength, wanted);
}
