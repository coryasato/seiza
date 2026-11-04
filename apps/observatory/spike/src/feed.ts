// The market watch feed spike's page (throwaway; market watch's feed path): starts the
// feed's worker (`?rate=`, `?seed=`, `?send=batch|tick`) and folds every
// tick into a store (`?fold=`): `none` reads the header alone (the
// transport's cost), `objects` replaces the instrument's row with a new
// object and the rows with a new array once a batch (an idiomatic React
// store: what `setState` is handed), `typed` writes Float64Array columns in
// place (no garbage: the collection pauses' control), `wasm` copies the
// batch into a Rust fold's memory and folds it there (spike/fold/, raw
// wasm, as the GPUI contender's store would: wasm-bindgen's `&[u8]` copies
// too). Draws nothing.
//
// Each batch's arrival, send time (page ms), ticks, the handler's ms, and
// the worker's generation ms go on `__feed`; `__feedStore()` gives the
// store's fields per instrument, the same for either fold.

import { HEADER, INSTRUMENTS, TICK } from './feed-worker.ts';

const params = new URLSearchParams(location.search);
const rate = Number(params.get('rate') ?? 5000);
const seed = Number(params.get('seed') ?? 0x5eed);
const send = (params.get('send') ?? 'batch') as 'batch' | 'tick';
const limit = Number(params.get('ticks') ?? 0);
/** The control: the store skips the tick at this index (counted from 0). */
const drop = params.has('drop') ? Number(params.get('drop')) : -1;
let folded = 0;
const fold = (params.get('fold') ?? 'objects') as 'none' | 'objects' | 'typed' | 'wasm';

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

const FIELDS = ['last', 'change', 'changePct', 'bid', 'ask', 'bidSize', 'askSize', 'volume', 'high', 'low'] as const;
type Field = (typeof FIELDS)[number];

let rows: readonly Quote[] = INSTRUMENTS.map(([symbol, name, price]) => ({
  symbol, name, open: price, last: price, change: 0, changePct: 0, bid: price, ask: price, bidSize: 0, askSize: 0, volume: 0, high: price, low: price,
}));
const n = INSTRUMENTS.length;
const columns = Object.fromEntries(FIELDS.map((f) => [f, new Float64Array(n)])) as Record<Field, Float64Array>;
const open = new Float64Array(INSTRUMENTS.map(([, , p]) => p));
for (let i = 0; i < n; i++) for (const f of ['last', 'bid', 'ask', 'high', 'low'] as const) columns[f][i] = open[i]!;
const changed = new Uint8Array(n);

const record = { arrival: [] as number[], sent: [] as number[], ticks: [] as number[], handler: [] as number[], gen: [] as number[], seq: [] as number[] };
(globalThis as any).__feed = record;
interface FoldExports {
  memory: WebAssembly.Memory;
  batch_ptr(): number;
  batch_capacity(): number;
  init(i: number, price: number): void;
  fold(len: number): number;
  field(f: number, i: number): number;
}
let wasm: FoldExports | null = null;
let wasmPtr = 0;
if (fold === 'wasm') {
  const { instance } = await WebAssembly.instantiateStreaming(fetch(new URL('/fold/fold.wasm', location.href)));
  wasm = instance.exports as unknown as FoldExports;
  wasmPtr = wasm.batch_ptr();
  for (let i = 0; i < n; i++) wasm.init(i, open[i]!);
}

(globalThis as any).__feedStore = () =>
  fold === 'wasm'
    ? Array.from({ length: n }, (_, i) => Object.fromEntries(FIELDS.map((f, k) => [f, wasm!.field(k, i)])))
    : fold === 'typed'
    ? Array.from({ length: n }, (_, i) => Object.fromEntries(FIELDS.map((f) => [f, columns[f][i]])))
    : rows.map((q) => Object.fromEntries(FIELDS.map((f) => [f, q[f]])));
let sink = 0;
/** FNV-1a over the first 2,000 ticks' bytes: the same in every run of a seed. */
let digest = 0x811c9dc5;
let digested = 0;
(globalThis as any).__feedDigest = () => ({ ticks: digested, digest: (digest >>> 0).toString(16) });
function digestTicks(data: ArrayBuffer, count: number): void {
  const bytes = new Uint8Array(data, HEADER, count * TICK);
  const take = Math.min(count, 2000 - digested) * TICK;
  for (let b = 0; b < take; b++) digest = Math.imul(digest ^ bytes[b]!, 0x01000193);
  digested += take / TICK;
}

function foldObjects(view: DataView, count: number): void {
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

function foldTyped(view: DataView, count: number): void {
  const c = columns;
  for (let k = 0; k < count; k++) {
    const o = HEADER + k * TICK;
    const i = view.getUint16(o, true);
    const last = view.getFloat64(o + 16, true);
    const change = last - open[i]!;
    c.last[i] = last;
    c.change[i] = change;
    c.changePct[i] = (change / open[i]!) * 100;
    c.bid[i] = view.getFloat64(o + 24, true);
    c.ask[i] = view.getFloat64(o + 32, true);
    c.bidSize[i] = view.getUint32(o + 4, true);
    c.askSize[i] = view.getUint32(o + 8, true);
    c.volume[i] = c.volume[i]! + view.getUint32(o + 12, true);
    if (last > c.high[i]!) c.high[i] = last;
    if (last < c.low[i]!) c.low[i] = last;
    changed[i] = 1;
  }
}

const worker = new Worker(new URL('./feed-worker.ts', import.meta.url), { type: 'module' });
worker.onmessage = ({ data }: MessageEvent<ArrayBuffer>) => {
  const t0 = performance.now();
  const view = new DataView(data);
  let count = view.getUint32(4, true);
  // Before anything is counted: an unfoldable batch fails the run (a page error), never drops silently.
  if (fold === 'wasm' && data.byteLength > wasm!.batch_capacity()) throw new Error(`a batch of ${data.byteLength} bytes`);
  if (drop >= folded && drop < folded + count) {
    // Shift the later ticks down over the dropped one.
    const at = HEADER + (drop - folded) * TICK;
    new Uint8Array(data).copyWithin(at, at + TICK);
    view.setUint32(4, count - 1, true);
    count -= 1;
    folded += 1;
  }
  folded += count;
  if (fold === 'objects') foldObjects(view, count);
  else if (fold === 'typed') foldTyped(view, count);
  else if (fold === 'wasm') {
    new Uint8Array(wasm!.memory.buffer, wasmPtr, data.byteLength).set(new Uint8Array(data));
    wasm!.fold(data.byteLength);
  }
  else sink += count;
  const t1 = performance.now();
  if (digested < 2000) digestTicks(data, count);
  record.arrival.push(t0);
  record.sent.push(view.getFloat64(8, true) - performance.timeOrigin);
  record.ticks.push(count);
  record.handler.push(t1 - t0);
  record.gen.push(view.getFloat64(16, true));
  record.seq.push(view.getUint32(0, true));
};
(globalThis as any).__feedStart = () => worker.postMessage({ rate, seed, send, limit });
(globalThis as any).__feedFolded = () => folded;
(globalThis as any).__feedSink = () => sink;
document.body.textContent = `feed ${rate}/s ${send} ${fold}`;
