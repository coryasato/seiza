/**
 * The table's `copy` (the wide level's): a selection's rows and columns as
 * a spreadsheet's TSV of exact values, sent in pieces. A port of the tall
 * table's copy (`components/tall-table/src/copy.rs` and `state/copy.rs`,
 * and `pages.rs`'s copy reads), decision for decision: `copy.json` pins
 * its text and its limits.
 *
 * `started` is told in the call that asked (the key's, or the host's
 * `copyStart`), so a host on the web opens its clipboard write while the
 * gesture counts. Each page comes, at its turn, from the cache if it holds
 * the page then, else from a read of the copy's own beside the cache
 * (never cached), at most the cache's background limit (`maxInFlight − 1`,
 * at least 1), none while a visible page loads, ahead of prefetch.
 * Formatting runs a turn of at most `TURN_CELLS` cells at a time, each a
 * task of its own (so a frame can come between), each turn's text told as
 * one `text` and dropped.
 *
 * `pages.ts` and `paging.ts` call in here only behind the build constant
 * (`__LEVEL__ === 'wide'`), so no other level's bundle carries any of it;
 * what only `copy` does is a function here over the cache or the paging,
 * never a method of theirs, as `live.ts`'s are. The functions reach their
 * private members through a typed view of them (`CacheInside`,
 * `PagingInside`).
 *
 * The copy's events are told as GPUI delivers the table's: after the call
 * that emitted them (`batch`), so a host that cancels a copy at `started`
 * (no clipboard) cancels it before its first read is sent; and the reads
 * are planned once the events are told (`copyLoad`), as the table's `defer`.
 */

import { exactText, shownText, type CellKind, type CellValue } from './format.ts';
import type { PageCache, Plan, Rows, Slot } from './pages.ts';
import type { Page, PageSource, TablePaging } from './paging.ts';

/** How copies are made: the table's `CopyOptions`, its defaults below. */
export interface CopyOptions {
  /** Refused past this many bytes of UTF-8 text. */
  maxBytes: number;
  /** The most cells (rows × columns) the key copies; past it, `declined`. */
  keyMaxCells: number;
  /** The column names as a first line. */
  headers: boolean;
}

/** The table's `CopyOptions::default()` (`copy.json`'s `options` pins them). */
export const COPY_OPTIONS: CopyOptions = { maxBytes: 64 * 1024 * 1024, keyMaxCells: 100_000, headers: false };

/** The cells a turn formats at most (the table's `TURN_CELLS`). */
export const TURN_CELLS = 16_384;

/** A column as the copy writes it: a float32's exact text is its own
 *  shortest round trip (the data file has none; `copy.json` has). */
export type CopyKind = CellKind | 'float32';

export interface CopyColumn {
  name: string;
  kind: CopyKind;
}

/** Why a copy ended without its text. */
export type CopyFailure = { kind: 'too-large'; bytes: number; maxBytes: number } | { kind: 'read'; message: string } | { kind: 'cancelled' };

/** A copy's progress, as the table's `TallTableCopy`: `started`, any number
 *  of `text`, then `copied` or `failed`; or `declined` alone. */
export type CopyEvent =
  | { kind: 'declined'; rows: number; columns: number }
  | { kind: 'started'; id: number; rows: Rows; columns: Rows }
  | { kind: 'text'; id: number; text: string; rowsDone: number }
  | { kind: 'copied'; id: number; rows: number; bytes: number }
  | { kind: 'failed'; id: number; reason: CopyFailure };

/** `copy.json`'s negative controls, each a way of writing the text wrongly
 *  that a port might take; `null` in the contender. */
export type CopyControl = 'null-as-text' | 'no-quoting' | 'key-limit-off-by-one' | 'whole-floats-bare' | 'trailing-break' | 'utf16-bytes' | null;

/** What the host gives the copy. */
export interface CopySetup {
  columns: readonly CopyColumn[];
  /** Hears each event, after the call that emitted it. */
  onEvent: (event: CopyEvent) => void;
  options?: CopyOptions;
  /** Runs a turn on a task of its own: a `MessageChannel`'s by default. */
  schedule?: (run: () => void) => void;
  control?: CopyControl;
}

/** A copy running. */
interface Running<P> {
  id: number;
  /** `[first, last]`, inclusive, as the table's ranges. */
  rows: Rows;
  columns: Rows;
  /** The next row to format. */
  nextRow: number;
  /** Its reads in flight: the page and the request. */
  reads: [number, number][];
  /** Pages read for it that landed, waiting for their turn. */
  landed: Map<number, P>;
  /** The text told so far, in bytes, and the header line's part of it. */
  bytes: number;
  headerBytes: number;
  /** With headers: the line, until the first piece carries it. */
  header: string | null;
  headers: boolean;
  /** The cap when it started: options set since are the next copy's. */
  maxBytes: number;
  /** A page's worth of rows has been projected over the copy's. */
  projected: boolean;
  /** A turn is scheduled and hasn't run. */
  turnPending: boolean;
}

/** The paging's copy books. */
export interface CopyBooks<P> {
  columns: readonly CopyColumn[];
  onEvent: (event: CopyEvent) => void;
  options: CopyOptions;
  schedule: (run: () => void) => void;
  control: CopyControl;
  lastId: number;
  running: Running<P> | null;
  /** A plan is due once the events are told. */
  loadDeferred: boolean;
  /** Events waiting for the call that emitted them to end. */
  queue: CopyEvent[];
  depth: number;
  flushing: boolean;
}

/** The cache's copy books: its reads in flight, by page and request (never
 *  cached), and the pages it would read now, for the next plan. */
export interface CacheCopy<R> {
  reads: [number, R][];
  wants: number[];
}

/** The cache's members the copy reads and writes, private to every other caller. */
interface CacheInside<T, R> {
  readonly slots: Map<number, Slot<T, R>>;
  draining: R[];
  readonly maxInFlight: number;
  readonly pageRows: number;
  copy: CacheCopy<R>;
  rowsOf(page: number): Rows;
  visiblePages(visible: Rows): number;
  plan(wanted: readonly number[], visible: number): Plan<R>;
  started(page: number, request: R): void;
}

const inside = <T, R>(cache: PageCache<T, R>): CacheInside<T, R> => cache as unknown as CacheInside<T, R>;

/** The paging's members the copy reads and writes, private to every other caller. */
interface PagingInside<P extends Page> {
  readonly cache: PageCache<P, number>;
  readonly source: PageSource<P>;
  closed: boolean;
  copy: CopyBooks<P> | undefined;
  visible(): Rows;
  wanted(): number[];
  loadPages(): void;
  pageDone(page: number, request: number, answer: { data: P } | { error: unknown }): void;
}

const insidePaging = <P extends Page>(table: TablePaging<P>): PagingInside<P> => table as unknown as PagingInside<P>;

// --- the text (`copy.rs`) ---

/** `field`, quoted if it holds a tab, a line break, or a `"` (its quotes
 *  doubled), as spreadsheets write and read it. */
export function quoted(field: string): string {
  return /[\t\n\r"]/.test(field) ? `"${field.replaceAll('"', '""')}"` : field;
}

/** A value's exact text (the tooltip's); NULL, or a cell past a page's
 *  end, empty. */
export function valueText(value: CellValue | undefined, kind: CopyKind, control: CopyControl = null): string {
  if (value === undefined) return '';
  if (value === null) return control === 'null-as-text' ? 'NULL' : '';
  if (typeof value === 'string') return control === 'no-quoting' ? value : quoted(value);
  if (typeof value === 'number' && (kind === 'float' || kind === 'float32')) {
    // A float's shortest round-trip text never needs quoting.
    const exact = kind === 'float32' ? f32Text(value) : exactText(value);
    return control === 'whole-floats-bare' && exact.endsWith('.0') ? exact.slice(0, -2) : exact;
  }
  return shownText(kind as CellKind, value, Infinity);
}

/** The header line: the column names, quoted by the same rule. */
export const headerLine = (names: readonly string[]): string => names.map(quoted).join('\t');

/** A float32's exact text: its own shortest round trip, laid out as
 *  Rust's `Debug` (`number.ts`'s `f32Text`, kept here: importing that
 *  module from the paging would move it in the other levels' chunks). */
function f32Text(value: number): string {
  for (let precision = 1; precision <= 9; precision++) {
    const shortest = Number(value.toPrecision(precision));
    if (Math.fround(shortest) === value) return exactText(shortest);
  }
  return exactText(value);
}

/** `text`'s length in UTF-8 bytes, as the table counts it. */
export function utf8Bytes(text: string): number {
  let bytes = text.length;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code < 0x80) continue;
    // Two bytes to 0x7ff, three to 0xffff; a surrogate pair (two code
    // units, two counted) is four.
    if (code < 0x800 || (code >= 0xd800 && code <= 0xdfff)) bytes += 1;
    else bytes += 2;
  }
  return bytes;
}

/** The least text a copy of `rows` × `columns` can be: every value NULL,
 *  its separators alone, and a header line of `header` bytes with its
 *  line break. */
export const leastBytes = (rows: number, columns: number, header: number | null): number => rows * Math.max(0, columns - 1) + Math.max(0, rows - 1) + (header === null ? 0 : header + 1);

const count = ([first, last]: Rows): number => last - first + 1;

// --- the books ---

/** The turns waiting for their task, and the channel that runs them: one
 *  a page, made at the first turn (a port with a listener is never
 *  collected, so one a table would stay for every reopen). */
const turns: (() => void)[] = [];
let channel: MessageChannel | null = null;

/** A task of its own for each turn: a `MessageChannel`'s, which a browser
 *  runs as soon as it can, never clamped as a nested `setTimeout` is. */
function channelSchedule(run: () => void): void {
  if (!channel) {
    channel = new MessageChannel();
    channel.port1.onmessage = () => turns.shift()?.();
  }
  turns.push(run);
  channel.port2.postMessage(null);
}

/** Sets up `table`'s copy (on the wide level, once it's open). */
export function setCopy<P extends Page>(table: TablePaging<P>, setup: CopySetup): void {
  const paging = insidePaging(table);
  paging.copy = {
    columns: setup.columns,
    onEvent: setup.onEvent,
    options: setup.options ?? COPY_OPTIONS,
    schedule: setup.schedule ?? channelSchedule,
    control: setup.control ?? null,
    lastId: 0,
    running: null,
    loadDeferred: false,
    queue: [],
    depth: 0,
    flushing: false,
  };
}

/** The cache's empty copy books, set by its constructor on the wide level. */
export const newCacheCopy = <R>(): CacheCopy<R> => ({ reads: [], wants: [] });

/** Runs `update` as one of the table's updates: the events it emits told
 *  at its end, then the reads planned if a plan is due. */
function batch<P extends Page>(paging: PagingInside<P>, update: (books: CopyBooks<P>) => void): void {
  const books = paging.copy;
  if (!books) return;
  books.depth++;
  try {
    update(books);
  } finally {
    books.depth--;
  }
  if (books.depth > 0 || books.flushing) return;
  books.flushing = true;
  try {
    for (;;) {
      const event = books.queue.shift();
      if (event) {
        // A handler that throws mustn't strand the events after it, to be
        // told later in another call (perhaps another copy's): its error is
        // rethrown in a microtask, the rest told in order.
        try {
          books.onEvent(event);
        } catch (error) {
          queueMicrotask(() => {
            throw error;
          });
        }
        continue;
      }
      if (!books.loadDeferred) break;
      books.loadDeferred = false;
      paging.loadPages();
    }
  } finally {
    books.flushing = false;
  }
}

const emit = <P>(books: CopyBooks<P>, event: CopyEvent): void => void books.queue.push(event);

/** A plan is due once the events are told. */
const copyLoad = <P>(books: CopyBooks<P>): void => void (books.loadDeferred = true);

// --- the cache's side (`pages.rs`) ---

/** `page`, if it's loaded (`holding`: the wide level's rows never grow). */
function holding<T, R>(cache: CacheInside<T, R>, page: number): T | null {
  const slot = cache.slots.get(page);
  return slot?.kind === 'loaded' ? slot.page : null;
}

/** Whether the cache is reading `page` (`loading`). */
const loading = <T, R>(cache: CacheInside<T, R>, page: number): boolean => cache.slots.get(page)?.kind === 'loading';

/** The most reads beside the cache's own at once (`background_limit`). */
const backgroundLimit = <T, R>(cache: CacheInside<T, R>): number => Math.max(cache.maxInFlight - 1, 1);

/** The copy's reads in flight, which `plan` counts in flight. */
export const copyReading = <T, R>(of: PageCache<T, R>): number => inside(of).copy.reads.length;

/** `plan`'s grant, once, after the visible pages and before prefetch: how
 *  many of the copy's wants may start now (none while a visible page has
 *  nothing to show), and where in `fetch` they go. */
export function grantCopy<T, R>(of: PageCache<T, R>, visibleMissing: boolean, inFlight: number, fetch: readonly number[]): { copy: number; copyAt: number } {
  const cache = inside(of);
  if (visibleMissing) return { copy: 0, copyAt: 0 };
  const places = Math.min(backgroundLimit(cache) - cache.copy.reads.length, cache.maxInFlight - inFlight);
  const copy = Math.max(0, Math.min(cache.copy.wants.length, places));
  return { copy, copyAt: copy > 0 ? fetch.length : 0 };
}

/** Whether the copy is reading `page`, or is granted it among the first
 *  `granted` of its wants: prefetch doesn't read it too. */
export function copyHas<T, R>(of: PageCache<T, R>, page: number, granted: number): boolean {
  const { reads, wants } = inside(of).copy;
  return reads.some(([read]) => read === page) || wants.slice(0, granted).includes(page);
}

/** A copy's read was cancelled: it drains as the cache's do. */
function copyCancelled<T, R>(cache: CacheInside<T, R>, request: R): void {
  const index = cache.copy.reads.findIndex(([, read]) => read === request);
  if (index < 0) return;
  cache.copy.reads.splice(index, 1);
  cache.draining.push(request);
}

/** A copy's read answered, whether the copy still wants it or not: its place frees. */
function copyAnswered<T, R>(cache: CacheInside<T, R>, request: R): void {
  const index = cache.copy.reads.findIndex(([, read]) => read === request);
  if (index >= 0) cache.copy.reads.splice(index, 1);
  else {
    const draining = cache.draining.indexOf(request);
    if (draining >= 0) cache.draining.splice(draining, 1);
  }
}

// --- the paging's side (`state/copy.rs`) ---

/** The wide level's `loadWanted`: the copy's next turn if a page it waits
 *  on is in the cache now, and the pages it would read; the plan's reads,
 *  the copy's granted ones after the visible pages', before prefetch. */
export function loadWantedCopy<P extends Page>(table: TablePaging<P>, wanted: readonly number[]): void {
  const paging = insidePaging(table);
  if (paging.closed) return;
  const cache = inside(paging.cache);
  const visible = cache.visiblePages(paging.visible());
  copyWake(paging);
  cache.copy.wants = copyWants(paging, wanted);
  const plan = cache.plan(wanted, visible);
  for (const request of plan.cancel) paging.source.cancel(request);
  const at = Math.min(plan.copyAt ?? 0, plan.fetch.length);
  for (const page of plan.fetch.slice(0, at)) fetchPage(paging, page);
  const granted = cache.copy.wants.slice(0, plan.copy ?? 0);
  cache.copy.wants = [];
  startCopyReads(paging, granted);
  for (const page of plan.fetch.slice(at)) fetchPage(paging, page);
}

/** Sends a plan's read of `page` for the cache, answered as `pageDone`. */
function fetchPage<P extends Page>(paging: PagingInside<P>, page: number): void {
  const { request, result } = paging.source.load(paging.cache.rowsOf(page));
  inside(paging.cache).started(page, request);
  result.then(
    (data) => paging.pageDone(page, request, { data }),
    (error: unknown) => paging.pageDone(page, request, { error }),
  );
}

/** The pages the copy would read now, in order: those of its next
 *  background limit from its turn's that it hasn't in hand, isn't reading,
 *  and the cache neither holds nor is reading for `wanted` (the copy waits
 *  for that read and takes the page from the cache). */
function copyWants<P extends Page>(paging: PagingInside<P>, wanted: readonly number[]): number[] {
  const running = paging.copy?.running;
  if (!running) return [];
  const cache = inside(paging.cache);
  const end = running.rows[1];
  if (running.nextRow > end) return [];
  const pageRows = cache.pageRows;
  const turn = Math.floor(running.nextRow / pageRows);
  const last = Math.min(Math.floor(end / pageRows), turn + backgroundLimit(cache) - 1);
  const pages: number[] = [];
  for (let page = turn; page <= last; page++) {
    if (running.landed.has(page) || running.reads.some(([read]) => read === page) || holding(cache, page) !== null) continue;
    if (loading(cache, page) && wanted.includes(page)) continue;
    pages.push(page);
  }
  return pages;
}

/** Sends the copy's reads of `pages`, each answered on a task of its own. */
function startCopyReads<P extends Page>(paging: PagingInside<P>, pages: readonly number[]): void {
  const running = paging.copy?.running;
  if (!running) return;
  const cache = inside(paging.cache);
  const id = running.id;
  for (const page of pages) {
    const { request, result } = paging.source.load(cache.rowsOf(page));
    cache.copy.reads.push([page, request]);
    running.reads.push([page, request]);
    result.then(
      (data) => batch(paging, (books) => copyReadDone(paging, books, id, page, request, { data })),
      (error: unknown) => batch(paging, (books) => copyReadDone(paging, books, id, page, request, { error })),
    );
  }
}

/** A copy's read answered: its place frees, whatever became of the copy;
 *  its page waits for its turn (or goes, if the turn passed it), or the
 *  copy fails. */
function copyReadDone<P extends Page>(paging: PagingInside<P>, books: CopyBooks<P>, id: number, page: number, request: number, answer: { data: P } | { error: unknown }): void {
  copyAnswered(inside(paging.cache), request);
  const running = books.running;
  const index = running && running.id === id ? running.reads.findIndex(([read, sent]) => read === page && sent === request) : -1;
  if (!running || index < 0) {
    // Cancelled, or its copy ended: its place is free.
    copyLoad(books);
    return;
  }
  running.reads.splice(index, 1);
  if ('data' in answer) {
    if (page >= Math.floor(running.nextRow / paging.cache.pageRows)) running.landed.set(page, answer.data);
    if (running.turnPending) copyLoad(books);
    else copyTurn(paging, books);
    return;
  }
  // The source refused a read the copy didn't cancel, or it failed.
  const aborted = (answer.error as { name?: unknown } | null)?.name === 'AbortError';
  const message = aborted ? 'the source cancelled a read' : answer.error instanceof Error ? answer.error.message : String(answer.error);
  endCopy(paging, books, { kind: 'read', message });
  copyLoad(books);
}

/** Starts a copy of `rows` × `columns`: `started`, then its first turn. */
function startCopy<P extends Page>(paging: PagingInside<P>, books: CopyBooks<P>, rows: Rows, columns: Rows): number {
  endCopy(paging, books, { kind: 'cancelled' });
  const id = ++books.lastId;
  emit(books, { kind: 'started', id, rows, columns });
  const { options, control } = books;
  const header = options.headers ? headerLine(books.columns.slice(columns[0], columns[1] + 1).map((column) => column.name)) : null;
  // Any value may be NULL: past the cap with every one empty, it's
  // refused before a read.
  const least = leastBytes(count(rows), count(columns), header === null ? null : bytesOf(header, control));
  if (least > options.maxBytes) {
    emit(books, { kind: 'failed', id, reason: { kind: 'too-large', bytes: least, maxBytes: options.maxBytes } });
    return id;
  }
  books.running = {
    id,
    rows,
    columns,
    nextRow: rows[0],
    reads: [],
    landed: new Map(),
    bytes: 0,
    headerBytes: 0,
    header,
    headers: options.headers,
    maxBytes: options.maxBytes,
    projected: false,
    turnPending: false,
  };
  // Rows in hand are formatted now: a small copy of loaded rows ends in
  // this call.
  copyTurn(paging, books);
  return id;
}

/** `text`'s bytes, as the copy counts them (UTF-8; the control's UTF-16). */
const bytesOf = (text: string, control: CopyControl): number => (control === 'utf16-bytes' ? text.length : utf8Bytes(text));

/** Drops the copy running, its reads cancelled through the source (they
 *  drain as the cache's do), and returns its id. */
function dropCopy<P extends Page>(paging: PagingInside<P>, books: CopyBooks<P>): number | null {
  const running = books.running;
  if (!running) return null;
  books.running = null;
  const cache = inside(paging.cache);
  for (const [, request] of running.reads) {
    paging.source.cancel(request);
    copyCancelled(cache, request);
  }
  return running.id;
}

/** Ends the copy running, if any, with `reason`. */
function endCopy<P extends Page>(paging: PagingInside<P>, books: CopyBooks<P>, reason: CopyFailure): void {
  const id = dropCopy(paging, books);
  if (id !== null) emit(books, { kind: 'failed', id, reason });
}

/** A turn: formats up to `TURN_CELLS` cells from the rows in hand, tells
 *  them as one piece, and ends the copy at its last row or past its cap,
 *  checked a row at a time. The next turn is scheduled if its page is in
 *  hand, else runs when it lands. Every way out plans the reads. */
function copyTurn<P extends Page>(paging: PagingInside<P>, books: CopyBooks<P>): void {
  const running = books.running;
  if (!running) return;
  const cache = inside(paging.cache);
  const pageRows = cache.pageRows;
  const control = books.control;
  running.turnPending = false;
  const maxBytes = running.maxBytes;
  const [firstColumn, lastColumn] = running.columns;
  const kinds = books.columns.map((column) => column.kind);
  let budget = Math.max(1, Math.floor(TURN_CELLS / count(running.columns)));
  let piece = running.header ?? '';
  running.header = null;
  let pieceBytes = bytesOf(piece, control);
  running.headerBytes += pieceBytes;
  const [firstRow, end] = running.rows;
  const rowCount = end - firstRow + 1;
  // The size it's refused at: past the cap, or projected past twice it.
  let refused: number | null = null;
  turn: while (budget > 0 && running.nextRow <= end) {
    const page = Math.floor(running.nextRow / pageRows);
    const first = page * pageRows;
    const pageEnd = Math.min((page + 1) * pageRows, end + 1);
    const rows = running.landed.get(page) ?? holding(cache, page);
    if (!rows) break;
    const values = rows as unknown as { value(row: number, column: number): CellValue | undefined };
    const stop = Math.min(pageEnd, running.nextRow + budget);
    budget -= stop - running.nextRow;
    for (let row = running.nextRow; row < stop; row++) {
      let line = row !== firstRow || running.headers ? '\n' : '';
      for (let column = firstColumn; column <= lastColumn; column++) {
        if (column > firstColumn) line += '\t';
        line += valueText(values.value(row - first, column), kinds[column]!, control);
      }
      piece += line;
      pieceBytes += bytesOf(line, control);
      running.nextRow = row + 1;
      // A row at a time, so a turn of wide values never builds much past the cap.
      const bytes = running.bytes + pieceBytes;
      if (bytes > maxBytes) {
        refused = bytes;
        break turn;
      }
      // A page's worth of rows in and the copy going on: refused early if
      // their bytes a row, over the copy's rows, pass twice the cap. Never
      // fewer rows: a selection starting on a page's last row would
      // project from that row alone.
      const done = running.nextRow - firstRow;
      if (!running.projected && done === pageRows && running.nextRow <= end) {
        running.projected = true;
        const projected = running.headerBytes + ((bytes - running.headerBytes) / done) * rowCount;
        if (projected > 2 * maxBytes) {
          refused = Math.floor(projected);
          break turn;
        }
      }
    }
    if (stop === pageEnd) running.landed.delete(page);
  }
  const { id } = running;
  const done = running.nextRow > end;
  if (refused !== null) {
    endCopy(paging, books, { kind: 'too-large', bytes: refused, maxBytes });
    copyLoad(books);
    return;
  }
  if (done && control === 'trailing-break') {
    piece += '\n';
    pieceBytes += 1;
  }
  running.bytes += pieceBytes;
  const rowsDone = running.nextRow - firstRow;
  if (piece) emit(books, { kind: 'text', id, text: piece, rowsDone });
  if (done) {
    // Its reads still out (pages it took from the cache instead) are cancelled.
    dropCopy(paging, books);
    emit(books, { kind: 'copied', id, rows: rowsDone, bytes: running.bytes });
    copyLoad(books);
    return;
  }
  dropPassed(paging, running);
  copyWake(paging);
  copyLoad(books);
}

/** The pages behind the copy's turn, copied from the cache while its own
 *  reads of them were out: those reads are cancelled, and a page that
 *  landed for one goes, so the copy holds only pages to come. */
function dropPassed<P extends Page>(paging: PagingInside<P>, running: Running<P>): void {
  const cache = inside(paging.cache);
  const turn = Math.floor(running.nextRow / cache.pageRows);
  for (const page of running.landed.keys()) if (page < turn) running.landed.delete(page);
  const passed = running.reads.filter(([page]) => page < turn);
  running.reads = running.reads.filter(([page]) => page >= turn);
  for (const [, request] of passed) {
    paging.source.cancel(request);
    copyCancelled(cache, request);
  }
}

/** Schedules the copy's next turn if its page is in hand (landed, or in
 *  the cache) and none is pending: a task of its own, so a frame can come
 *  between. Each plan calls it too, so a page the cache loads for the
 *  reader is copied as soon as it lands. */
function copyWake<P extends Page>(paging: PagingInside<P>): void {
  const books = paging.copy;
  const running = books?.running;
  if (!books || !running || running.turnPending || running.nextRow > running.rows[1]) return;
  const page = Math.floor(running.nextRow / paging.cache.pageRows);
  if (!running.landed.has(page) && holding(inside(paging.cache), page) === null) return;
  running.turnPending = true;
  const id = running.id;
  books.schedule(() =>
    batch(paging, (books) => {
      if (books.running?.id === id && books.running.turnPending) copyTurn(paging, books);
    }),
  );
}

// --- what the host calls ---

/** The key (Cmd+C, Ctrl+C) on `rows` × `columns` (`[first, last]` each):
 *  a copy of at most `keyMaxCells` cells; past it, `declined` and nothing
 *  read. */
export function copyKey<P extends Page>(table: TablePaging<P>, rows: Rows, columns: Rows): void {
  const paging = insidePaging(table);
  if (paging.closed) return;
  batch(paging, (books) => {
    const cells = count(rows) * count(columns);
    const limit = books.options.keyMaxCells;
    if (books.control === 'key-limit-off-by-one' ? cells >= limit : cells > limit) {
      emit(books, { kind: 'declined', rows: count(rows), columns: count(columns) });
      return;
    }
    startCopy(paging, books, rows, columns);
  });
}

/** The host's copy of `rows` × `columns`, as the key's but past
 *  `keyMaxCells` too: `started` told before this returns. A copy running
 *  is cancelled first. Null once the table is closed. */
export function copyStart<P extends Page>(table: TablePaging<P>, rows: Rows, columns: Rows): number | null {
  const paging = insidePaging(table);
  if (paging.closed) return null;
  let id: number | null = null;
  batch(paging, (books) => {
    id = startCopy(paging, books, rows, columns);
  });
  return id;
}

/** Ends the copy running, if any, with `failed` (`cancelled`); whether one ran. */
export function cancelCopy<P extends Page>(table: TablePaging<P>): boolean {
  const paging = insidePaging(table);
  let running = false;
  batch(paging, (books) => {
    running = books.running !== null;
    endCopy(paging, books, { kind: 'cancelled' });
  });
  return running;
}

/** The copy running, if any: its id, rows done, and rows. */
export function copying<P extends Page>(table: TablePaging<P>): { id: number; rowsDone: number; rows: number } | null {
  const running = insidePaging(table).copy?.running;
  return running ? { id: running.id, rowsDone: running.nextRow - running.rows[0], rows: count(running.rows) } : null;
}

/** Whether a copy is running: a drag's release plans its reads. */
export const copyRunning = <P extends Page>(table: TablePaging<P>): boolean => (insidePaging(table).copy?.running ?? null) !== null;

/** The paging closed: the copy ends with no event, its reads cancelled. */
export function closeCopy<P extends Page>(table: TablePaging<P>): void {
  const paging = insidePaging(table);
  if (paging.copy) dropCopy(paging, paging.copy);
}
