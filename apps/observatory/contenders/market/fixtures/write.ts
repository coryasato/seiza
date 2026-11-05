/**
 * Writes `feed.json` and `feed.bin`, market watch's feed fixture: what "every tick reaches
 * the store" means, the same on both sides (root `CLAUDE.md`, "Comparison
 * protocol"). The scenario's seed, `TICKS` ticks from the feed (`feed.ts`)
 * in batches of uneven sizes, and each instrument's ten fields after them,
 * folded here by a reference fold of its own (apart from either side's
 * store), as exact text: Rust's `{:?}` of a double (the prices, the change,
 * and the change %), an integer's digits (the sizes and the volume).
 *
 * `feed.json`:
 * - `seed`, `ticks`, `batches` (each batch's tick count, in order);
 * - `open`: each instrument's reference price, where a store starts (exact
 *   text, in `INSTRUMENTS`' order; the GPUI side reads them from here);
 * - `sha256`: that of `feed.bin`, the batches one after another, each a
 *   header and its ticks as the worker sends them, its times 0;
 * - `folded`: the ticks a store has folded after them (all of them);
 * - `expect`: per instrument, in `INSTRUMENTS`' order, its `symbol` and
 *   `last`, `change`, `change_pct`, `bid`, `ask`, `bid_size`, `ask_size`,
 *   `volume`, `high`, `low`;
 * - `drop`: the controls' tick, the first trade at or after the middle (a
 *   store skipping it has less volume; a skipped quote may leave nothing
 *   behind, so it would prove nothing).
 *
 * The stores that run it: the GPUI contender's natively
 * (`contenders/tall-table/gpui/crate/src/market.rs`, `cargo test -p
 * tall-table-gpui --features market`), the TanStack contender's in `node
 * --test` (`contenders/tall-table/tanstack/web/test/market.test.ts`), each
 * with its controls: a store that skips `drop`, one that keeps only each
 * instrument's last tick in a batch, and one that computes the change %
 * as `(last / open − 1) × 100`.
 *
 * Usage: node apps/observatory/contenders/market/fixtures/write.ts [--check]
 * (`--check`: the feed regenerates the committed bytes and this fold its
 * fields, or it fails; `just observatory fixtures` runs it).
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { MARKET_WATCH } from '../../scenarios.ts';
import { AT, Feed, HEADER, INSTRUMENTS, TICK } from '../feed.ts';

const TICKS = 2000;
const out = new URL('./feed.json', import.meta.url);
const bin = new URL('./feed.bin', import.meta.url);

/** Batches of 1, 3, 7, 15, … ticks, the last whatever is left. */
function batchSizes(total: number): number[] {
  const sizes: number[] = [];
  for (let size = 1, left = total; left > 0; size = size * 2 + 1) {
    sizes.push(Math.min(size, left));
    left -= sizes.at(-1)!;
  }
  return sizes;
}

/** Rust's `{:?}` of a double, where it and JS's shortest text agree on the digits:
 *  a plain decimal from 1e-4 to 1e16 (Rust writes an exponent outside it), a
 *  whole one with `.0`. Anything else fails the writer rather than guess. */
function debugF64(value: number): string {
  if (!Number.isFinite(value)) throw new Error(`${value}: not a finite double`);
  if (value === 0) return Object.is(value, -0) ? '-0.0' : '0.0';
  const abs = Math.abs(value);
  if (abs < 1e-4 || abs >= 1e16) throw new Error(`${value}: outside the plain decimals this writer prints`);
  const text = String(value);
  return text.includes('.') ? text : `${text}.0`;
}

const sizes = batchSizes(TICKS);
const feed = new Feed(MARKET_WATCH.seed);
const batches = sizes.map((count, seq) => new Uint8Array(feed.batch(seq, count)));
const bytes = Buffer.concat(batches);

// The reference fold: a column per field, every tick in order.
const n = INSTRUMENTS.length;
const open = INSTRUMENTS.map(({ price }) => price);
const col = {
  last: [...open], change: new Array<number>(n).fill(0), change_pct: new Array<number>(n).fill(0), bid: [...open], ask: [...open],
  bid_size: new Array<number>(n).fill(0), ask_size: new Array<number>(n).fill(0), volume: new Array<number>(n).fill(0), high: [...open], low: [...open],
};
let folded = 0;
let drop = -1;
for (const batch of batches) {
  const view = new DataView(batch.buffer, batch.byteOffset, batch.byteLength);
  const count = view.getUint32(AT.count, true);
  for (let k = 0; k < count; k++, folded++) {
    const o = HEADER + k * TICK;
    const i = view.getUint16(o + AT.instrument, true);
    if (drop < 0 && folded >= TICKS / 2 && view.getUint16(o + AT.kind, true) === 0) drop = folded;
    const last = view.getFloat64(o + AT.last, true);
    col.last[i] = last;
    col.change[i] = last - open[i]!;
    col.change_pct[i] = (col.change[i]! / open[i]!) * 100;
    col.bid[i] = view.getFloat64(o + AT.bid, true);
    col.ask[i] = view.getFloat64(o + AT.ask, true);
    col.bid_size[i] = view.getUint32(o + AT.bidSize, true);
    col.ask_size[i] = view.getUint32(o + AT.askSize, true);
    col.volume[i]! += view.getUint32(o + AT.traded, true);
    col.high[i] = Math.max(col.high[i]!, last);
    col.low[i] = Math.min(col.low[i]!, last);
  }
}
const integer = (value: number) => {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${value}: not a count`);
  return String(value);
};
const expect = INSTRUMENTS.map(({ symbol }, i) => ({
  symbol,
  last: debugF64(col.last[i]!),
  change: debugF64(col.change[i]!),
  change_pct: debugF64(col.change_pct[i]!),
  bid: debugF64(col.bid[i]!),
  ask: debugF64(col.ask[i]!),
  bid_size: integer(col.bid_size[i]!),
  ask_size: integer(col.ask_size[i]!),
  volume: integer(col.volume[i]!),
  high: debugF64(col.high[i]!),
  low: debugF64(col.low[i]!),
}));

const fixture = {
  about: 'Market watch\'s feed fixture: the feed\'s batches → each instrument\'s fields after them, exact. Written by write.ts (its header says what each key holds); don\'t edit.',
  seed: MARKET_WATCH.seed,
  ticks: TICKS,
  batches: sizes,
  open: open.map(debugF64),
  sha256: createHash('sha256').update(bytes).digest('hex'),
  folded,
  drop,
  expect,
};
const text = `${JSON.stringify(fixture, null, 1)}\n`;

if (process.argv.includes('--check')) {
  if (readFileSync(out, 'utf8') !== text || !readFileSync(bin).equals(bytes)) {
    console.error('FAIL: feed.json differs from what the feed and the reference fold give now; rewrite it with write.ts (a changed feed changes every side\'s numbers)');
    process.exit(1);
  }
  console.log(`feed.json: PASS (${TICKS} ticks in ${sizes.length} batches, sha256 ${fixture.sha256.slice(0, 12)}…)`);
} else {
  writeFileSync(out, text);
  writeFileSync(bin, bytes);
  console.log(`wrote ${out.pathname}: ${TICKS} ticks in ${sizes.length} batches, drop ${drop}, sha256 ${fixture.sha256}`);
}
