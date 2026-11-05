// The market watch spike's TanStack side (throwaway; market watch's stops):
// React and TanStack Virtual over the 50 instruments, 12 columns as the
// design canvas draws them, fed by the feed's worker (`?rate=`). Every tick
// is folded into an idiomatic store (a new row object per tick, a new array
// per batch), and the view renders once a frame (a rAF after a batch), rows
// memoized by their object, so only rows that changed render. Last, Bid,
// and Ask flash when their value changes from the one drawn: the cell's
// background by a keyframes animation (linear, 30% → 0 over `?flash=` ms,
// 400 by default; `?mode=` picks it against two overlays on the
// compositor, the dearer here); Change and
// Change % are drawn in the rise's or the fall's color by sign, a zero in
// the foreground.
//
// `__market` records each batch's sequence and send time (page ms) as it's
// folded, and each commit's time and the newest sequence it drew (`shown`):
// a batch's Shown in is its send time to the presentation of the frame that
// committed it. `?hold=1` commits each frame's batches one frame later,
// still committing every frame (Shown in's control: ~16.7 ms more, keeps up
// unchanged).

import { createElement as h, memo, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useVirtualizer } from '@tanstack/react-virtual';
import { HEADER, INSTRUMENTS, TICK } from './feed-worker.ts';

const params = new URLSearchParams(location.search);
const rate = Number(params.get('rate') ?? 5000);
const seed = Number(params.get('seed') ?? 0x5eed);
const hold = params.get('hold') === '1';
const FLASH_MS = Number(params.get('flash') ?? 400);
/** `?flash=0`: no flash at all (the flash's cost, by its absence). */
const FLASHING = FLASH_MS > 0;
/** How the flash is drawn: `waapi` (the overlay's opacity by the Web
 *  Animations API), `css` (the overlay's opacity by a keyframes animation,
 *  restarted by alternating two names), `bg` (the cell's own background
 *  color by keyframes: painted on the main thread). */
/** `?flash-all=1`: every numeric column flashes, as the bare host's every float column does. */
const FLASH_ALL = params.get('flash-all') === '1';
const MODE = (params.get('mode') ?? 'bg') as 'waapi' | 'css' | 'bg';
document.documentElement.style.setProperty('--flash-ms', `${FLASH_MS}ms`);
const ROW_HEIGHT = 30;

interface Quote {
  symbol: string;
  name: string;
  open: number;
  last: number;
  change: number;
  changePct: number;
  bid: number;
  ask: number;
  bidSize: number;
  askSize: number;
  volume: number;
  high: number;
  low: number;
}

let rows: readonly Quote[] = INSTRUMENTS.map(([symbol, name, price]) => ({
  symbol, name, open: price, last: price, change: 0, changePct: 0, bid: price, ask: price, bidSize: 0, askSize: 0, volume: 0, high: price, low: price,
}));

const record = { batches: [] as [seq: number, sent: number][], shown: [] as [seq: number, at: number][] };
(globalThis as any).__market = record;
let newest = -1;

function fold(view: DataView, count: number): void {
  const next = rows.slice();
  for (let k = 0; k < count; k++) {
    const o = HEADER + k * TICK;
    const i = view.getUint16(o, true);
    const prev = next[i]!;
    const last = view.getFloat64(o + 16, true);
    const change = last - prev.open;
    next[i] = {
      ...prev,
      last,
      change,
      changePct: (change / prev.open) * 100,
      bid: view.getFloat64(o + 24, true),
      ask: view.getFloat64(o + 32, true),
      bidSize: view.getUint32(o + 4, true),
      askSize: view.getUint32(o + 8, true),
      volume: prev.volume + view.getUint32(o + 12, true),
      high: last > prev.high ? last : prev.high,
      low: last < prev.low ? last : prev.low,
    };
  }
  rows = next;
}

// ---------------------------------------------------------------- the view

type Align = 'l' | 'r';
const COLUMNS: [label: string, width: number, align: Align][] = [
  ['Symbol', 72, 'l'], ['Name', 150, 'l'], ['Last', 84, 'r'], ['Change', 76, 'r'], ['Change %', 84, 'r'], ['Bid', 80, 'r'], ['Ask', 80, 'r'],
  ['Bid size', 76, 'r'], ['Ask size', 76, 'r'], ['Volume', 96, 'r'], ['High', 80, 'r'], ['Low', 80, 'r'],
];
const WIDTH = COLUMNS.reduce((sum, [, w]) => sum + w, 0);
const grouped = new Intl.NumberFormat('en-US');
const fixed = (q: Quote, v: number) => v.toFixed(q.open < 10 ? 3 : 2);
const signed = (s: string, v: number) => (v > 0 ? '+' + s : s);
const sign = (v: number) => (v > 0 ? 'up' : v < 0 ? 'down' : '');

/** A price cell that flashes when its value changes from the one drawn. */
const Flashing = memo(function Flashing({ value, text, width, tone = '' }: { value: number; text: string; width: number; tone?: string }) {
  const overlay = useRef<HTMLSpanElement>(null);
  const cell = useRef<HTMLDivElement>(null);
  const drawn = useRef(value);
  const turn = useRef(false);
  useLayoutEffect(() => {
    const before = drawn.current;
    drawn.current = value;
    if (!FLASHING || before === value || !cell.current) return;
    const dir = value > before ? 'up' : 'down';
    turn.current = !turn.current;
    const name = turn.current ? 'a' : 'b';
    if (MODE === 'bg') {
      cell.current.className = `c r ${tone} bg-${dir}-${name}`;
    } else if (overlay.current && MODE === 'css') {
      overlay.current.className = `fl fl-${dir} ${name}`;
    } else if (overlay.current) {
      overlay.current.className = `fl fl-${dir}`;
      overlay.current.getAnimations().forEach((a) => a.cancel());
      overlay.current.animate([{ opacity: 1 }, { opacity: 0 }], { duration: FLASH_MS, easing: 'linear', fill: 'forwards' });
    }
  }, [value, tone]);
  return h('div', { ref: cell, className: `c r ${tone}`, style: { width } }, MODE === 'bg' ? null : h('span', { ref: overlay, className: 'fl' }), h('span', { className: 't' }, text));
});

const Cell = ({ text, width, align, tone = '' }: { text: string; width: number; align: Align; tone?: string }) =>
  h('div', { className: `c ${align} ${tone}`, style: { width } }, text);

const Row = memo(function Row({ q, top, odd }: { q: Quote; top: number; odd: boolean }) {
  const w = (i: number) => COLUMNS[i]![1];
  // A number cell: flashing (Last, Bid, Ask; with `?flash-all=1` every one) or plain.
  const num = (i: number, value: number, text: string, tone = '', flashes = FLASH_ALL) =>
    flashes ? h(Flashing, { value, text, width: w(i), tone }) : h(Cell, { text, width: w(i), align: 'r', tone });
  return h(
    'div',
    { className: odd ? 'row odd' : 'row', style: { transform: `translateY(${top}px)` } },
    h(Cell, { text: q.symbol, width: w(0), align: 'l' }),
    h(Cell, { text: q.name, width: w(1), align: 'l' }),
    num(2, q.last, fixed(q, q.last), '', true),
    num(3, q.change, signed(fixed(q, q.change), q.change), sign(q.change)),
    num(4, q.changePct, signed(q.changePct.toFixed(2), q.changePct) + '%', sign(q.change)),
    num(5, q.bid, fixed(q, q.bid), '', true),
    num(6, q.ask, fixed(q, q.ask), '', true),
    num(7, q.bidSize, grouped.format(q.bidSize)),
    num(8, q.askSize, grouped.format(q.askSize)),
    num(9, q.volume, grouped.format(q.volume)),
    num(10, q.high, fixed(q, q.high)),
    num(11, q.low, fixed(q, q.low)),
  );
});

let schedule: (seq: number) => void = () => {};

function App() {
  const scroller = useRef<HTMLDivElement>(null);
  const [, setVersion] = useState(0);
  const shownSeq = useRef(-1);
  const recorded = useRef(-1);
  schedule = (seq) => {
    shownSeq.current = seq;
    setVersion((v) => v + 1);
  };
  const virtualizer = useVirtualizer({ count: rows.length, getScrollElement: () => scroller.current, estimateSize: () => ROW_HEIGHT, overscan: 4 });
  useLayoutEffect(() => {
    // Only a commit that shows a newer batch: the virtualizer's own renders don't count.
    if (shownSeq.current > recorded.current) {
      recorded.current = shownSeq.current;
      record.shown.push([shownSeq.current, performance.now()]);
    }
  });
  return h(
    'div',
    { ref: scroller, className: 'frame' },
    h('div', { className: 'head', style: { width: WIDTH } }, ...COLUMNS.map(([label, width, align]) => h('div', { key: label, className: `c ${align}`, style: { width } }, label))),
    h(
      'div',
      { className: 'body', style: { height: virtualizer.getTotalSize(), width: WIDTH } },
      ...virtualizer.getVirtualItems().map((item) => h(Row, { key: item.index, q: rows[item.index]!, top: item.start, odd: item.index % 2 === 1 })),
    ),
  );
}

createRoot(document.getElementById('root')!).render(h(App));

let pending = false;
function frame(): void {
  pending = false;
  if (!hold) return schedule(newest);
  // Take this frame's batches now, commit them next frame: one frame late,
  // a commit every frame all the same.
  const take = newest;
  requestAnimationFrame(() => schedule(take));
}
const worker = new Worker(new URL('./feed-worker.ts', import.meta.url), { type: 'module' });
worker.onmessage = ({ data }: MessageEvent<ArrayBuffer>) => {
  const view = new DataView(data);
  const seq = view.getUint32(0, true);
  fold(view, view.getUint32(4, true));
  newest = seq;
  record.batches.push([seq, view.getFloat64(8, true) - performance.timeOrigin]);
  if (pending) return;
  pending = true;
  // Once a frame: the next rAF renders every batch folded before it.
  requestAnimationFrame(frame);
};
worker.postMessage({ rate, seed, send: 'batch', limit: 0 });
