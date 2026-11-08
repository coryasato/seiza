/**
 * Throwaway: live tail's DOM spike. React and TanStack Virtual over the NASA
 * logs' file (fetched whole and registered as a `File`), read a page at a
 * time through DuckDB-Wasm with the tall table's paging numbers (1,024-row
 * pages, 3 reads in flight, a 64 MiB cache of the pages' IPC bytes),
 * looping past its end (`sql.ts`), the rows growing by the clock worker's
 * counts. It follows the tail on its native scroller, as the contender
 * will (the table's rule, simplified):
 *
 * - the tail pin is the rows read: while following, the view's bottom is
 *   the last row whose page has landed, the visible tail pages read bottom
 *   first, and the scroller pinned at its end;
 * - the scaled scroller (`docs/dom-scroll-model.md`): the spacer at most
 *   2^24 px, the content at V = s + D, D moved on as the rows grow while
 *   following and held otherwise, so a wheel moves the rows 1:1 on the
 *   compositor; TanStack Virtual over a 4,096-row window from a base row.
 *   No re-anchor and no thumb mapping: the spike's scrolls stay in the end's
 *   1:1 zone;
 * - a wheel up (or any scroll away from the end) lets go; a scroll back to
 *   the end follows again;
 * - a landed page draws once a frame, in the frame's callback (`flushSync`);
 *   `?hold` holds each landing 17 ms first (Row shown in's control).
 */

import { createElement as h, memo, useLayoutEffect, useReducer, useRef } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { Vector } from 'apache-arrow';
import { createBridge } from '@seiza/duckdb/bridge';
import { ENGINE_DIR, OBSERVATORY } from '../../../contenders/paths.ts';
import { LOAD_PARQUET_SQL, PARQUET_METADATA_CACHE_SQL, WARM_UP_SQL } from '../../../contenders/tall-table/tanstack/web/src/data/sql.ts';
import '../../../contenders/tall-table/tanstack/web/src/theme.css';
import '../../../contenders/tall-table/tanstack/web/src/view.css';
import { FILE, tailSql } from './sql.ts';
import { HOLD, fetchFile, startClock, type TailLog } from './shared.ts';

const ROW = 30;
const SPACER = 2 ** 24;
const WINDOW = 4096;
const PAGE = 1024;
const IN_FLIGHT = 3;
const BUDGET = 64 * 2 ** 20;

/** A landed page: its rows' columns, decoded. */
interface Page {
  end: number;
  bytes: number;
  columns: Vector[];
}

const drawn: [number, number][] = [];
const following: [number, number][] = [];
const log: TailLog = {
  batches: [],
  drawn: () => drawn,
  following: () => following,
  view: () => [model.top, model.count()],
  pause: () => {},
  open: 0,
};
(globalThis as { __tail?: TailLog }).__tail = log;

// ---------------------------------------------------------------- the data

const bridge = createBridge({ extensionDir: ENGINE_DIR, extensionBase: OBSERVATORY });
let nextRequest = 0;
const query = (sql: string) => bridge.query(sql, nextRequest++);

let fileRows = 0;
/** Arrow, loaded after first paint with the engine (the contender's rule). */
let tableFromIPC: typeof import('apache-arrow').tableFromIPC;
const pages = new Map<number, Page>();
/** Each page's rows as far as the pin may see them (with `?hold`, landed 17 ms ago). */
const shown = new Map<number, number>();
const inFlight = new Map<number, number>();
let cacheBytes = 0;

// ---------------------------------------------------------------- the model

const model = {
  /** Rows due (the clock's). */
  due: 0,
  /** The tail pin: the rows read through the tail, the view's end while following. */
  read: 0,
  following: true,
  /** V = s + D. */
  d: 0,
  top: 0,
  height: 0,
  count: () => (model.following ? model.read : model.due),
};

let render: (() => void) | null = null;
let frameAsked = false;
/** Draws on the next frame, once. */
function draw(): void {
  if (frameAsked || !render) return;
  frameAsked = true;
  requestAnimationFrame(() => {
    frameAsked = false;
    flushSync(render!);
  });
}

function setFollowing(on: boolean): void {
  if (model.following === on) return;
  model.following = on;
  following.push([on ? 1 : 0, performance.now()]);
}

/** The rows on screen: the tail while following, else from V. */
function wanted(): [number, number] {
  const visible = Math.ceil(model.height / ROW) + 1;
  if (model.following) return [Math.max(0, model.due - visible), model.due];
  const first = Math.floor(model.top);
  return [first, Math.min(model.due, first + visible)];
}

/** Sends the reads the view needs, bottom first while following. */
function plan(): void {
  if (!fileRows) return;
  const [lo, hi] = wanted();
  if (hi <= lo) return;
  const order: number[] = [];
  for (let p = Math.floor(lo / PAGE); p <= Math.floor((hi - 1) / PAGE); p++) order.push(p);
  if (model.following) order.reverse();
  for (const p of order) {
    if (inFlight.size >= IN_FLIGHT) return;
    const need = Math.min((p + 1) * PAGE, model.due);
    if ((pages.get(p)?.end ?? p * PAGE) >= need || inFlight.has(p)) continue;
    read(p, need);
  }
}

function read(p: number, end: number): void {
  inFlight.set(p, end);
  query(tailSql(fileRows, p * PAGE, end)).then(
    (bytes) => {
      inFlight.delete(p);
      const table = tableFromIPC(bytes);
      const old = pages.get(p);
      if (old) cacheBytes -= old.bytes;
      pages.set(p, { end, bytes: bytes.byteLength, columns: table.schema.fields.map((_, i) => table.getChildAt(i)!) });
      cacheBytes += bytes.byteLength;
      evict();
      // `?hold`: the pin sees a landing 17 ms late, so the frame that
      // first draws its rows is held (its read and the next aren't).
      const show = () => {
        shown.set(p, Math.max(shown.get(p) ?? 0, end));
        if (model.following) advancePin();
        draw();
      };
      if (HOLD) setTimeout(show, 17);
      else show();
      plan();
    },
    (error: unknown) => {
      inFlight.delete(p);
      console.error(error);
    },
  );
}

/** The pin moves on to the rows read, never back: the end of the last
 *  page read, or of the one above it, whichever the screen above it is
 *  read through (a tail page can land before the page above it). */
function advancePin(): void {
  let last = -1;
  for (const p of shown.keys()) if (p > last && p * PAGE < model.due) last = p;
  if (last < 0) return;
  for (const end of [shown.get(last)!, last * PAGE])
    if (end > model.read && covered(end)) {
      model.read = end;
      return;
    }
}

/** Every row of the screen ending at `end` is read. */
function covered(end: number): boolean {
  const visible = Math.ceil(model.height / ROW) + 1;
  for (let row = Math.max(0, end - visible); row < end; row += PAGE - (row % PAGE)) {
    const p = Math.floor(row / PAGE);
    if (!pages.has(p) || (shown.get(p) ?? 0) < Math.min(end, (p + 1) * PAGE)) return false;
  }
  return true;
}

/** Over the budget: the pages farthest from the view go first. */
function evict(): void {
  if (cacheBytes <= BUDGET) return;
  const at = Math.floor(model.top / PAGE);
  const far = [...pages.keys()].sort((a, b) => Math.abs(b - at) - Math.abs(a - at));
  for (const p of far) {
    if (cacheBytes <= BUDGET) return;
    if (Math.abs(p - at) <= 1) continue;
    cacheBytes -= pages.get(p)!.bytes;
    pages.delete(p);
    shown.delete(p);
  }
}

function onRows(rows: number): void {
  model.due = rows;
  plan();
  // Not following: the scrollbar grows with the rows, the view held.
  if (!model.following) draw();
}

// ---------------------------------------------------------------- the view

const COLUMNS = [
  { name: 'time', width: 200, kind: 'text' },
  { name: 'request', width: 200, kind: 'text' },
  { name: 'status', width: 60, kind: 'integer' },
  { name: 'bytes', width: 100, kind: 'integer' },
] as const;
const GUTTER = 90;
const GROUPED = new Intl.NumberFormat('en-US');

const Row = memo(function Row({ row, top, page }: { row: number; top: number; page: Page | undefined }) {
  const index = row - (page ? Math.floor(row / PAGE) * PAGE : 0);
  const loaded = page !== undefined && row < page.end;
  return h(
    'div',
    { className: row % 2 ? 'row odd' : 'row', style: { transform: `translateY(${top}px)` } },
    h('div', { className: 'num', style: { width: GUTTER } }, GROUPED.format(row + 1)),
    COLUMNS.map((column, c) => {
      if (!loaded) return h('div', { key: c, className: `cell pending ${column.kind}`, style: { width: column.width } }, h('div', { className: 'bar' }));
      const value = page.columns[c]!.get(index) as unknown;
      return h('div', { key: c, className: value === null ? `cell ${column.kind} null` : `cell ${column.kind}`, style: { width: column.width } }, value === null ? 'NULL' : String(value));
    }),
  );
});

function Table() {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const scroller = useRef<HTMLDivElement>(null);
  render = () => rerender();

  const count = model.count();
  const total = count * ROW;
  const spacer = Math.min(total, SPACER);
  // Following: V is the end, D moved on with the rows, before the base and
  // the transform are read.
  if (model.following) {
    model.d = Math.max(0, total - spacer);
    model.top = Math.max(0, count - model.height / ROW);
  }
  const base = Math.max(0, Math.min(count - WINDOW, Math.floor(model.top - WINDOW / 4)));
  const windowRows = Math.min(WINDOW, count - base);
  const virtualizer = useVirtualizer({
    count: windowRows,
    getScrollElement: () => scroller.current,
    estimateSize: () => ROW,
    overscan: 12,
    // The model reports V itself, set before the items are read.
    observeElementOffset: () => () => {},
  });
  const v = model.following ? Math.max(0, total - model.height) : model.top * ROW;
  (virtualizer as unknown as { scrollOffset: number }).scrollOffset = Math.max(0, v - base * ROW);

  // After each commit: while following, the scroller pinned at its end and D
  // moved on, so V is the end; the frame's drawn tail logged.
  useLayoutEffect(() => {
    const element = scroller.current!;
    model.height = element.clientHeight - ROW;
    const max = Math.max(0, spacer + ROW - element.clientHeight);
    if (model.following) {
      if (element.scrollTop !== max) element.scrollTop = max;
      const last = drawn.at(-1)?.[0] ?? 0;
      if (model.read > last) drawn.push([model.read, performance.now()]);
    }
  });

  const onScroll = () => {
    const element = scroller.current!;
    const max = Math.max(0, spacer + ROW - element.clientHeight);
    const v = element.scrollTop + model.d;
    model.top = v / ROW;
    if (element.scrollTop < max - 1) setFollowing(false);
    else setFollowing(true);
    plan();
    draw();
  };
  const onWheel = (event: WheelEvent) => {
    if (event.deltaY < 0) setFollowing(false);
  };
  useLayoutEffect(() => {
    const element = scroller.current!;
    element.addEventListener('wheel', onWheel, { passive: true });
    return () => element.removeEventListener('wheel', onWheel);
  }, []);

  return h(
    'div',
    { className: 'page' },
    h(
      'div',
      { className: 'frame' },
      h(
        'div',
        { className: 'scroller', ref: scroller, onScroll, tabIndex: 0 },
        h(
          'div',
          { className: 'head' },
          h('div', { className: 'num', style: { width: GUTTER } }),
          COLUMNS.map((column) => h('div', { key: column.name, className: `cell ${column.kind}`, style: { width: column.width } }, column.name)),
        ),
        h(
          'div',
          { className: 'spacer', style: { height: spacer } },
          h(
            'div',
            { className: 'content', style: { transform: `translateY(${base * ROW - model.d}px)` } },
            virtualizer.getVirtualItems().map((item) => {
              const row = base + item.index;
              return h(Row, { key: row, row, top: item.start, page: pages.get(Math.floor(row / PAGE)) });
            }),
          ),
        ),
      ),
    ),
  );
}

// ---------------------------------------------------------------- start

const root = createRoot(document.getElementById('root')!);
root.render(h('div', { className: 'page' }, h('div', { className: 'frame' }, h('div', { className: 'status' }, 'Engine loading…'))));

async function open(): Promise<void> {
  // After first paint, as the contender starts: two frames.
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const file = fetchFile();
  ({ tableFromIPC } = await import('apache-arrow'));
  await query(WARM_UP_SQL);
  await query(LOAD_PARQUET_SQL);
  await query(PARQUET_METADATA_CACHE_SQL);
  await bridge.registerFile(FILE, await file);
  const counts = tableFromIPC(await query(`SELECT num_rows FROM parquet_file_metadata('${FILE}')`));
  fileRows = Number(counts.getChild('num_rows')!.get(0));
  root.render(h(Table));
  log.open = fileRows;
  // A page read's time, for the file's row groups in DuckDB-Wasm.
  (log as TailLog & { read?: (start: number, end: number) => Promise<number> }).read = async (start, end) => {
    const t = performance.now();
    await query(tailSql(fileRows, start, end));
    return performance.now() - t;
  };
  following.push([1, performance.now()]);
  startClock(log, onRows);
}
open().catch((error: unknown) => {
  root.render(h('div', { className: 'status failed' }, String(error)));
  console.error(error);
});
