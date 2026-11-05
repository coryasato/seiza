/**
 * Market watch's store on the DOM side: every tick of the feed's batches
 * (`contenders/market/feed.ts`, which says what a store does with one)
 * folded into the quotes, as an idiomatic React store holds them: a new
 * object for an instrument at each of its ticks and a new array once a
 * batch, what `setState` is handed. `fixtures/feed.json` pins it, as it
 * pins the GPUI contender's (`test/market.test.ts`).
 */

import { AT, HEADER, TICK, type Instrument } from '../../../../../market/feed.ts';

export interface Quote {
  symbol: string;
  name: string;
  /** The reference price. */
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

/** The ten fields a tick moves, in the fixture's order. */
export const QUOTE_FIELDS = ['last', 'change', 'changePct', 'bid', 'ask', 'bidSize', 'askSize', 'volume', 'high', 'low'] as const;

/** A batch's header, as the store read it. */
export interface Batch {
  seq: number;
  count: number;
  /** Its send time, epoch ms. */
  sent: number;
}

/** The quotes at the open: each price its reference, no change, sizes and volume 0. */
export const openQuotes = (instruments: readonly Instrument[]): readonly Quote[] =>
  instruments.map(({ symbol, name, price }) => ({
    symbol, name, open: price, last: price, change: 0, changePct: 0, bid: price, ask: price, bidSize: 0, askSize: 0, volume: 0, high: price, low: price,
  }));

export class QuoteStore {
  rows: readonly Quote[];
  /** Every tick folded so far. */
  folded = 0;

  constructor(instruments: readonly Instrument[]) {
    this.rows = openQuotes(instruments);
  }

  /** Folds every tick of `batch`; a batch that isn't one throws, so nothing is dropped silently. */
  fold(batch: ArrayBuffer): Batch {
    const view = new DataView(batch);
    if (batch.byteLength < HEADER) throw new Error(`a batch of ${batch.byteLength} bytes has no header`);
    const count = view.getUint32(AT.count, true);
    if (batch.byteLength !== HEADER + count * TICK) throw new Error(`a batch of ${count} ticks is ${batch.byteLength} bytes`);
    const next = this.rows.slice();
    for (let k = 0; k < count; k++) {
      const o = HEADER + k * TICK;
      const i = view.getUint16(o + AT.instrument, true);
      const prev = next[i];
      if (!prev) throw new Error(`tick ${k} of batch ${view.getUint32(AT.seq, true)}: instrument ${i} of ${next.length}`);
      const last = view.getFloat64(o + AT.last, true);
      const change = last - prev.open;
      next[i] = {
        ...prev,
        last,
        change,
        changePct: (change / prev.open) * 100,
        bid: view.getFloat64(o + AT.bid, true),
        ask: view.getFloat64(o + AT.ask, true),
        bidSize: view.getUint32(o + AT.bidSize, true),
        askSize: view.getUint32(o + AT.askSize, true),
        volume: prev.volume + view.getUint32(o + AT.traded, true),
        high: last > prev.high ? last : prev.high,
        low: last < prev.low ? last : prev.low,
      };
    }
    this.rows = next;
    this.folded += count;
    return { seq: view.getUint32(AT.seq, true), count, sent: view.getFloat64(AT.sent, true) };
  }
}
