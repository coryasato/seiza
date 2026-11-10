// The monitoring wall spike's TanStack side (throwaway): `?tables=<n>`
// tables in one React tree, each a desk of 50 with its own scroller and
// TanStack Virtual, in two rows of n / 2, the canvas's columns (Symbol 64,
// Last 76, Chg % 72, Volume 80 px; 24 px rows, 12 px text; a 26 px title)
// and a row-number gutter as the tall table draws one at that text. Every
// tick folded into an idiomatic store (a new row object per tick, a new
// array per batch, the feed spike's `objects` fold); one commit a frame, in the frame's
// callback (`flushSync`, as the contender's market level), rows memoized
// by their quote, so only rows a tick moved render. Last flashes on the
// cell's background (keyframes, 400 ms from 30%), Chg % by its sign.
//
// Logs as the GPUI page's (`__wall`): each batch's generation per desk it
// ticked and the mask of desks whose on-screen rows it ticked; each commit
// that drew a newer generation, right after it (`wall:refreshed`), with
// the generation drawn per desk. `?hold` commits each frame's batches a
// frame later (Shown in's control).

import { createElement as h, memo, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { useVirtualizer } from '@tanstack/react-virtual';
import { HEADER, TICK } from '../../src/feed-worker.ts';
import { DESK_ROWS, HOLD, NAMES, SHOWN, TABLES, startFeed, type WallLog } from './shared.ts';

const ROW = 24;

interface Quote {
  symbol: string;
  open: number;
  last: number;
  changePct: number;
  volume: number;
}

let rows: readonly Quote[] = SHOWN.map(([, symbol, price]) => ({ symbol, open: price, last: price, changePct: 0, volume: 0 }));
/** Each desk's generation: raised by a batch that ticked it. */
const generation = new Array<number>(TABLES).fill(0);
/** The generation each desk's last commit drew. */
const drawn = new Array<number>(TABLES).fill(0);
/** The rows on screen in each desk (its scroller never moves): set after the first commit. */
let onScreen = 0;
const batches: number[][] = [];
const refreshed: number[][] = [];
const failures: string[] = [];
const log: WallLog = { batches: () => batches, refreshed: () => refreshed, failures: () => failures, tables: TABLES };
(globalThis as { __wall?: WallLog }).__wall = log;

/** Folds every tick, or none if the batch isn't one (checked whole first,
 *  as the contender's store does). */
function fold(view: DataView): void {
  if (view.byteLength < HEADER) return void failures.push(`a batch of ${view.byteLength} bytes has no header`);
  const count = view.getUint32(4, true);
  if (view.byteLength !== HEADER + count * TICK) return void failures.push(`a batch of ${count} ticks is ${view.byteLength} bytes`);
  for (let k = 0; k < count; k++)
    if (view.getUint16(HEADER + k * TICK, true) >= rows.length) return void failures.push(`tick ${k} names an instrument past the ${rows.length} shown`);
  const next = rows.slice();
  const ticked = new Array<boolean>(TABLES).fill(false);
  let mask = 0;
  for (let k = 0; k < count; k++) {
    const o = HEADER + k * TICK;
    const i = view.getUint16(o, true);
    const desk = Math.floor(i / DESK_ROWS);
    ticked[desk] = true;
    if (i % DESK_ROWS < onScreen) mask |= 1 << desk;
    const prev = next[i]!;
    const last = view.getFloat64(o + 16, true);
    next[i] = { ...prev, last, changePct: ((last - prev.open) / prev.open) * 100, volume: prev.volume + view.getUint32(o + 12, true) };
  }
  rows = next;
  const gens = ticked.map((t, d) => (t ? ++generation[d]! : 0));
  batches.push([view.getUint32(0, true), count, view.getFloat64(8, true) - performance.timeOrigin, mask, ...gens]);
}

// ---------------------------------------------------------------- the view

const COLUMNS: [label: string, width: number, align: 'l' | 'r'][] = [['Symbol', 64, 'l'], ['Last', 76, 'r'], ['Chg %', 72, 'r'], ['Volume', 80, 'r']];
/** The tall table's gutter for 50 rows at 12 px text: (2 × 7.5 + 24) × 12/14, rounded. */
const GUTTER = 33;
const WIDTH = GUTTER + COLUMNS.reduce((sum, [, w]) => sum + w, 0);
const grouped = new Intl.NumberFormat('en-US');
const sign = (v: number) => (v > 0 ? 'up' : v < 0 ? 'down' : '');

/** Last, flashing on its background when its value changes from the one drawn. */
const Last = memo(function Last({ value, text }: { value: number; text: string }) {
  const cell = useRef<HTMLDivElement>(null);
  const drawnValue = useRef(value);
  const turn = useRef(false);
  useLayoutEffect(() => {
    const before = drawnValue.current;
    drawnValue.current = value;
    if (before === value || !cell.current) return;
    turn.current = !turn.current;
    cell.current.className = `c r bg-${value > before ? 'up' : 'down'}-${turn.current ? 'a' : 'b'}`;
  }, [value]);
  return h('div', { ref: cell, className: 'c r', style: { width: COLUMNS[1]![1] } }, text);
});

const Row = memo(function Row({ q, index, top }: { q: Quote; index: number; top: number }) {
  const pct = q.changePct.toFixed(2);
  return h(
    'div',
    { className: index % 2 ? 'row odd' : 'row', style: { transform: `translateY(${top}px)` } },
    h('div', { className: 'c r g', style: { width: GUTTER } }, String(index + 1)),
    h('div', { className: 'c l', style: { width: COLUMNS[0]![1] } }, q.symbol),
    h(Last, { value: q.last, text: q.last.toFixed(q.open < 10 ? 3 : 2) }),
    h('div', { className: `c r ${sign(q.changePct)}`, style: { width: COLUMNS[2]![1] } }, (q.changePct > 0 ? '+' : '') + pct + '%'),
    h('div', { className: 'c r', style: { width: COLUMNS[3]![1] } }, grouped.format(q.volume)),
  );
});

function Desk({ desk, quotes }: { desk: number; quotes: readonly Quote[] }) {
  const scroller = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({ count: DESK_ROWS, getScrollElement: () => scroller.current, estimateSize: () => ROW, overscan: 4 });
  return h(
    'div',
    { className: 'desk' },
    h('div', { className: 'title' }, NAMES[desk]),
    h(
      'div',
      { ref: scroller, className: 'frame' },
      h('div', { className: 'head', style: { width: WIDTH } }, h('div', { className: 'c g', style: { width: GUTTER } }), ...COLUMNS.map(([label, width, align]) => h('div', { key: label, className: `c ${align}`, style: { width } }, label))),
      h('div', { className: 'body', style: { height: virtualizer.getTotalSize(), width: WIDTH } }, ...virtualizer.getVirtualItems().map((item) => h(Row, { key: item.index, q: quotes[item.index]!, index: item.index, top: item.start }))),
    ),
  );
}

/** What the view draws: the store and the generations a frame took. */
let shown: { rows: readonly Quote[]; generation: number[] } = { rows, generation: generation.slice() };
let schedule: () => void = () => {};
let filled = false;

function App() {
  const [, setVersion] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  schedule = () => setVersion((v) => v + 1);
  // The generation each desk draws in this render.
  const drawing = shown.generation;
  useLayoutEffect(() => {
    if (!filled) {
      filled = true;
      const frame = root.current?.querySelector<HTMLElement>('.frame');
      const head = frame?.querySelector<HTMLElement>('.head');
      if (frame && head) onScreen = Math.min(DESK_ROWS, Math.ceil((frame.clientHeight - head.offsetHeight) / ROW));
      queueMicrotask(() => performance.mark('wall:filled'));
    }
    if (!drawing.some((g, d) => g > drawn[d]!)) return;
    drawing.forEach((g, d) => (drawn[d] = Math.max(drawn[d]!, g)));
    const at = performance.mark('wall:refreshed').startTime;
    refreshed.push([at, ...drawn]);
  });
  const across = Math.ceil(TABLES / 2);
  const line = (n: number) =>
    h('div', { className: 'line', key: n }, ...Array.from({ length: Math.min(across, TABLES - n * across) }, (_, k) => {
      const desk = n * across + k;
      return h(Desk, { key: desk, desk, quotes: shown.rows.slice(desk * DESK_ROWS, (desk + 1) * DESK_ROWS) });
    }));
  return h('div', { ref: root, className: 'wall' }, line(0), line(1));
}

createRoot(document.getElementById('root')!).render(h(App));

let pending = false;
function frame(): void {
  pending = false;
  // The frame's snapshot: drawn now, or (`?hold`) by the next frame.
  const taken = { rows, generation: generation.slice() };
  const commit = () => {
    shown = taken;
    flushSync(schedule);
  };
  if (HOLD) requestAnimationFrame(commit);
  else commit();
}
startFeed((data) => {
  try {
    fold(new DataView(data));
  } catch (error) {
    failures.push(`a batch threw: ${String(error)}`);
    return;
  }
  if (pending) return;
  pending = true;
  requestAnimationFrame(frame);
});
