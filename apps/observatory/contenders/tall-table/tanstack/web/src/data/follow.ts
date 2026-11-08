/**
 * Live tail's paging (its level, `__LEVEL__ === 'tail'`): the rows growing
 * and shrinking (the table's `set_rows`), and the table's `follow`: the
 * view kept at the tail as they grow. A port of the tall table's paths
 * (`components/tall-table/src/pages.rs`'s `set_rows`, `forget`, and
 * `loaded_through`; `state.rs`'s `set_rows`, `fit_viewport`, `end_drag`,
 * and `wanted`; `state/follow.rs`), decision for decision:
 * `paging.json`'s `follow` scenarios and those with a `rows` step pin the
 * reads, the flag, and the view's bottom.
 *
 * Following is a flag the reader's moves set and clear, never the position
 * alone (`readerMoved`, decided before each move from where it lands): a
 * move down keeps it or reaches the end, a landing (End, a jump, a drag's
 * release) is at the end or not, a move up or Home lets go, and a drag
 * holds it until its release. While it's on, the view's bottom is pinned
 * to the loaded tail (`pinToTail`: moved down, never up, to the end of the
 * rows drawn with their values, once every row in view is loaded; not a
 * scroll), and the visible pages are read bottom first (`tailFirst`).
 *
 * As `live.ts`, these are functions over the cache and the paging, never
 * methods (a method would stay in every level's bundle), reaching their
 * private members through a typed view of them; `pages.ts`, `paging.ts`,
 * and `live.ts` call in only behind the build constant.
 */

import type { LiveBooks } from './live.ts';
import type { PageCache, Rows, Slot } from './pages.ts';
import type { Page, PageSource, TablePaging } from './paging.ts';
/** `paging.ts`'s own, copied: importing it (a value, where every other
 *  import from `paging.ts` is a type) closes a cycle that reorders the
 *  modules in every level's paging chunk, the base's too. */
const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);

/** What a reader's vertical move does to following: down (a wheel or a
 *  key) keeps it on or turns it on at the end; a landing (End, a jump, a
 *  drag released) is whether it landed at the end; up (any amount, Home)
 *  lets go. */
export type Reach = 'down' | 'land' | 'up';

/** The paging fixture's `follow` controls (`paging.json`), each a way to
 *  follow wrongly that the fixture must catch; `null` in the contender. */
export type FollowControl = 'follow-at-end' | 'follow-ignores-reader' | 'pin-to-rows' | 'top-first' | null;

/** The cache's members the rows' changes read and write, private to every other caller. */
interface CacheInside<T, R> {
  rows: number;
  readonly pageRows: number;
  readonly slots: Map<number, Slot<T, R>>;
  draining: R[];
  usedBytes: number;
  live: LiveBooks;
  rowsOf(page: number): Rows;
}

const insideCache = <T, R>(cache: PageCache<T, R>): CacheInside<T, R> => cache as unknown as CacheInside<T, R>;

/** The paging's members following reads and writes, private to every other caller. */
interface PagingInside<P extends Page> {
  rows: number;
  topRow: number;
  readonly viewportRows: number;
  readonly cache: PageCache<P, number>;
  readonly source: PageSource<P>;
  dragging: boolean;
  dragResting: boolean;
  loadDeferred: boolean;
  closed: boolean;
  following: boolean;
  tailDrawn: number;
  followControl: FollowControl;
  onFollowing?: (following: boolean) => void;
  onChange: () => void;
  setTop(top: number): boolean;
  visible(): Rows;
  maxTop(): number;
  wanted(): number[];
  loadPages(): void;
}

const inside = <P extends Page>(table: TablePaging<P>): PagingInside<P> => table as unknown as PagingInside<P>;

// --- the cache ---

/** The source holds `rows` rows now (`PageCache::set_rows`). A shrink
 *  forgets every page wholly past the new end, loaded or being read, and
 *  clamps a page it cuts into to the new end, so rows that come back are
 *  read anew. A short last page that grows is kept, stale (`live`): it
 *  draws the rows it was read with, placeholders past them, and is read
 *  again, never canceled for growing; grown during a read, it's read once
 *  more after that read lands. A short last page that shrinks is
 *  forgotten. Returns the reads out for what's forgotten, in page order,
 *  to cancel (each still in flight until it answers). */
function setCacheRows<T, R>(of: PageCache<T, R>, rows: number): R[] {
  const cache = insideCache(of);
  const control = cache.live.control;
  const old = cache.rows;
  cache.rows = rows;
  const cancel: R[] = [];
  if (rows < old && control !== 'keep-past-end') {
    // Grown back, a page past the cut must be read anew, never drawn from
    // a read before it.
    const first = Math.ceil(rows / cache.pageRows);
    const past = [...cache.slots.keys()].filter((page) => page >= first).sort((a, b) => a - b);
    for (const page of past) {
      const request = forget(cache, page);
      if (request !== null) cancel.push(request);
    }
  }
  // Shrunk into a page that stays: it holds rows only up to the new end.
  if (rows < old) {
    const slot = cache.slots.get(Math.floor(rows / cache.pageRows));
    if (slot?.kind === 'loaded') {
      slot.live!.end = Math.min(slot.live!.end!, rows);
      slot.live!.readingEnd = Math.min(slot.live!.readingEnd!, rows);
    } else if (slot?.kind === 'loading') slot.end = Math.min(slot.end!, rows);
  }
  if (old % cache.pageRows === 0 || rows === old) return cancel;
  const page = Math.floor(old / cache.pageRows);
  if (rows > old && control !== 'drop-grown') {
    const slot = cache.slots.get(page);
    if (slot?.kind === 'loaded') {
      slot.live!.stale = true;
      slot.live!.failed = false;
      return cancel;
    }
    if (slot?.kind === 'loading') {
      slot.stale = true;
      return cancel;
    }
    // A failure is forgotten: read anew.
  }
  const request = forget(cache, page);
  if (request !== null) cancel.push(request);
  return cancel;
}

/** Forgets `page`: a loaded one's bytes freed, a read of it out (a first
 *  read or a re-read) moved to draining and returned to cancel. */
function forget<T, R>(cache: CacheInside<T, R>, page: number): R | null {
  const slot = cache.slots.get(page);
  if (slot === undefined) return null;
  cache.slots.delete(page);
  let request: R | null = null;
  if (slot.kind === 'loaded') {
    cache.usedBytes -= slot.bytes;
    request = slot.live!.reading?.request ?? null;
  } else if (slot.kind === 'loading') request = slot.request;
  if (request !== null) cache.draining.push(request);
  return request;
}

/** Where the run of rows drawn with their values, from `row` on, ends
 *  (`loaded_through`): `row` itself if it isn't loaded, at most the rows'
 *  end; a page grown past its read ends it at the rows it was read with. */
export function loadedThrough<T, R>(of: PageCache<T, R>, row: number): number {
  const cache = insideCache(of);
  let end = Math.min(row, cache.rows);
  while (end < cache.rows) {
    const page = Math.floor(end / cache.pageRows);
    const slot = cache.slots.get(page);
    if (slot?.kind !== 'loaded') break;
    const pageEnd = Math.min(cache.rowsOf(page)[1], slot.live!.end!);
    if (pageEnd <= end) break;
    end = pageEnd;
  }
  return end;
}

// --- the paging ---

/**
 * The source holds `rows` rows now (`set_rows`): the top row stays where
 * it is, or as near as the new end allows; the cache forgets what a shrink
 * cuts (canceling its reads, unless the table is closed) and keeps a
 * grown short last page stale; a drawn tail past a shrink's end is
 * forgotten; while following, the view moves on only as the new rows'
 * reads land. The reads start once the task that called this ends (a
 * microtask: one plan for every `setRows` in it), and during a scrollbar
 * drag once the pointer rests.
 */
export function setRows<P extends Page>(of: TablePaging<P>, rows: number): void {
  const table = inside(of);
  table.rows = rows;
  table.topRow = clamp(table.topRow, 0, of.maxTop());
  // A closed table canceled every read at `close`: its cache is left as it was.
  if (!table.closed) for (const request of setCacheRows(table.cache, rows)) table.source.cancel(request);
  table.tailDrawn = Math.min(table.tailDrawn, rows);
  pinToTail(of);
  // One plan for every change in the task (`load_after_update`), as
  // `live.ts`'s `invalidateRows` plans: a copy of its block, since one
  // function for both changes market watch's bundle.
  if ((!table.dragging || table.dragResting) && !table.loadDeferred) {
    table.loadDeferred = true;
    queueMicrotask(() => {
      table.loadDeferred = false;
      if (!table.dragging || table.dragResting) table.loadPages();
    });
  }
}

/** Scrolls to the end and follows it (`follow()`): as `setRows` grows the
 *  rows, the view stays at the last rows read, until the reader moves up.
 *  Before a read at the end has landed, the view is at the rows' end, as a
 *  jump there is; from then on, at the loaded tail. On first, so the
 *  move's reads go bottom first. */
export function follow<P extends Page>(of: TablePaging<P>): void {
  setFollowing(inside(of), true);
  of.moveTopTo(of.maxTop());
}

/** Whether the view is following the end. */
export function isFollowing<P extends Page>(of: TablePaging<P>): boolean {
  const table = inside(of);
  if (table.followControl === 'follow-at-end') return table.topRow === of.maxTop();
  return table.following;
}

/** Starting to follow forgets the tail drawn, so the first filled frame at
 *  the end marks it again, grown or not. `onFollowing` hears each change. */
function setFollowing<P extends Page>(table: PagingInside<P>, following: boolean): void {
  if (table.following === following) return;
  table.following = following;
  if (following) table.tailDrawn = 0;
  table.onFollowing?.(following);
}

/** The reader is moving the view vertically, `reach`'s way, its top to
 *  `top` (clamped as the move clamps it): decided before the move, so the
 *  move's reads are planned bottom first if it follows. A drag holds
 *  following as it was until its release decides. */
export function readerMoved<P extends Page>(of: TablePaging<P>, reach: Reach, top: number): void {
  const table = inside(of);
  if (table.dragging) return;
  // Every move clamps to the largest top, and one to a top that isn't
  // finite stays where it is.
  const maxTop = of.maxTop();
  const atEnd = Number.isFinite(top) ? top >= maxTop : table.topRow === maxTop;
  const following = reach === 'down' ? table.following || atEnd : reach === 'land' ? atEnd : false;
  if (table.followControl === 'follow-ignores-reader' && !following) return;
  setFollowing(table, following);
}

/** A drag's release (`end_drag`): it decides following as a landing, and
 *  the pin moves on. Returns whether the pin moved the view, for the
 *  caller to plan its reads. Ends the drag. */
export function releaseDrag<P extends Page>(of: TablePaging<P>): boolean {
  const table = inside(of);
  if (!table.dragging) return false;
  table.dragging = false;
  readerMoved(of, 'land', table.topRow);
  return pinToTail(of);
}

/**
 * While following, moves the view down to the loaded tail: its bottom at
 * the end of the rows drawn with their values from its top row on, if
 * that's past where it is and every row in view is loaded. Never up, never
 * during a drag, and not a scroll: the direction stays and no settle timer
 * starts. Returns whether it moved, for the caller to plan the new view's
 * reads.
 */
export function pinToTail<P extends Page>(of: TablePaging<P>): boolean {
  const table = inside(of);
  if (!isFollowing(of) || table.dragging) return false;
  let top: number;
  if (table.followControl === 'pin-to-rows') top = of.maxTop();
  else {
    const [start, end] = of.visible();
    const through = loadedThrough(table.cache, start);
    if (through < end) return false;
    top = through - table.viewportRows;
  }
  if (top <= table.topRow || !table.setTop(top)) return false;
  // The rows moved under the view: it redraws there (the table's `notify`).
  table.onChange();
  return true;
}

/** A page landed: the pin moves on to its rows and, if it moved, returns
 *  the new view's wanted pages for the caller's plan. */
export function pinAndWant<P extends Page>(of: TablePaging<P>): number[] | null {
  return pinToTail(of) ? inside(of).wanted() : null;
}

/** The visible pages bottom first while following: the newest rows are
 *  the ones being watched. `wanted` begins with the `visible` pages. */
export function tailFirst<P extends Page>(of: TablePaging<P>, wanted: number[]): number[] {
  const table = inside(of);
  if (table.followControl === 'top-first' || !isFollowing(of)) return wanted;
  const visible = table.cache.visiblePages(of.visible());
  const head = wanted.slice(0, visible).sort((a, b) => b - a);
  wanted.splice(0, head.length, ...head);
  return wanted;
}

/** The viewport was resized (`fit_viewport`), its bottom `bottom` before:
 *  while following (and no drag) the bottom stays where it was, then the
 *  pin moves it on to the loaded tail; otherwise the top row stays. */
export function keepBottom<P extends Page>(of: TablePaging<P>, bottom: number): void {
  const table = inside(of);
  if (!isFollowing(of) || table.dragging) return;
  table.setTop(bottom - table.viewportRows);
  pinToTail(of);
}

/** A wheel's or a trackpad's move, `rows` down and `xPx` sideways, at rows
 *  `rowPx` tall (`scroll_by`): a move more sideways than vertical (a
 *  sideways swipe with a little vertical in it) moves the rows but leaves
 *  following as it is; any other decides it as `scrollBy` does. */
export function wheel<P extends Page>(of: TablePaging<P>, rows: number, xPx: number, rowPx: number): void {
  if (rows !== 0 && Math.abs(xPx) <= Math.abs(rows * rowPx)) return of.scrollBy(rows);
  // `moveTopTo` is `scrollBy`'s move without the decision.
  of.moveTopTo(of.top() + rows);
}

/** For a frame with every visible row drawn real, its rows' end: while
 *  following, whether the drawn tail grew (`TailDrawn`: the view marks
 *  it), which it then holds. */
export function noteTailDrawn<P extends Page>(of: TablePaging<P>, end: number): boolean {
  const table = inside(of);
  if (!isFollowing(of) || end <= table.tailDrawn) return false;
  table.tailDrawn = end;
  return true;
}

/** Sets the fixture's control on the paging (tests only: `null` in the contender). */
export function setFollowControl<P extends Page>(of: TablePaging<P>, control: FollowControl): void {
  inside(of).followControl = control;
}
