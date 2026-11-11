/**
 * Market watch's feed, and the monitoring wall's: the one module both
 * contenders' workers run (`worker.ts`), so either side gets the same bytes
 * (root `CLAUDE.md`, "Comparison protocol": a scenario's feed). Pure:
 * nothing here touches the browser, so the data's prep (`data/prep.ts`) and
 * the fixtures' writer (`fixtures/write.ts`) run it in Node.
 *
 * Its instruments: market watch's fifty fictional ones by default
 * (`INSTRUMENTS`, their one home: the data file is written from them, and
 * each side's store starts from them), or any others' reference prices (the
 * monitoring wall's, `contenders/wall/`'s 400, its stop's desks). A seeded
 * mulberry32 makes every tick a pure function of the seed, the
 * instruments' prices, and its index, whatever the batches' boundaries. A tick is a trade (60%: the last
 * moves one price tick up or down, a quarter of the time each at the
 * reference, the odds leaning back toward it as the last strays, or holds)
 * or a quote (the last unmoved); either redraws the spread, so the bid and
 * ask move on every tick. Prices are whole ticks over 100 (1,000 under
 * 10), so each is the nearest double to its decimal.
 *
 * A batch, little-endian: a 24-byte header (u32 sequence, u32 tick count,
 * f64 the send time in epoch ms, f64 the generation's ms), then 40 bytes a
 * tick (u16 instrument, u16 kind (0 a trade, 1 a quote), u32 bid size, u32
 * ask size, u32 size traded, f64 last, f64 bid, f64 ask). Its length is
 * exactly the header and its count's ticks; a store refuses any other.
 *
 * What a store does with a tick (each side's own, in its own language; the
 * fixture pins it): last, bid, ask, and the two sizes are the tick's; change
 * is `last − open` and change % `change / open × 100`, in that order, open
 * the reference price; volume adds the size traded; high and low are the
 * greatest and least last. Every tick reaches the store, none dropped or
 * conflated.
 */

export const HEADER = 24;
export const TICK = 40;

/** Where each field sits: in the header, and in a tick from its start. */
export const AT = {
  seq: 0,
  count: 4,
  sent: 8,
  generation: 16,
  instrument: 0,
  kind: 2,
  bidSize: 4,
  askSize: 8,
  traded: 12,
  last: 16,
  bid: 24,
  ask: 32,
} as const;

/** The table's columns, as the instruments' file has them
 *  (`data/prep-market.sql`, which writes it): each contender's open checks
 *  the file against them (the GPUI side's `scene/market.rs` keeps its own
 *  copy, checked at the same open). */
export const COLUMNS = ['Symbol', 'Name', 'Last', 'Change', 'Change %', 'Bid', 'Ask', 'Bid size', 'Ask size', 'Volume', 'High', 'Low'] as const;

export interface Instrument {
  symbol: string;
  name: string;
  /** The reference price: the open, and where the feed leans back to. */
  price: number;
}

const instrument = ([symbol, name, price]: [string, string, number]): Instrument => ({ symbol, name, price });

/** Fictional, synthetic: none is listed on a US exchange (`data/prep.ts` checks). */
export const INSTRUMENTS: readonly Instrument[] = (
  [
    ['AVRN', 'Avernus Rail', 84.2], ['BLMR', 'Bellamere Foods', 31.7], ['CRSL', 'Corsail Shipping', 112.4], ['DNTP', 'Danthorpe Energy', 58.9], ['ELWY', 'Elway Pharma', 203.1],
    ['FNSK', 'Fenske Mining', 14.6], ['GRVL', 'Gravell Telecom', 22.3], ['HLDN', 'Holden Air', 47.8], ['IVRA', 'Ivora Steel', 9.42], ['JSGR', 'Jasper Grain', 66.1],
    ['KLMW', 'Kalmont Water', 38.5], ['LWRD', 'Lowrie Media', 17.9], ['MRVN', 'Marven Logistics', 141.2], ['NDLR', 'Nadler Chips', 388.6], ['OKVL', 'Oakvale Bank', 52.4],
    ['PRSC', 'Prescot Glass', 27.0], ['QNTN', 'Quinton Paper', 11.8], ['RDGW', 'Ridgeway Power', 73.3], ['SLNR', 'Solnar Solar', 19.4], ['TRVK', 'Trevik Cement', 44.0],
    ['ULSN', 'Ulsen Robotics', 156.9], ['VNTR', 'Ventra Health', 95.5], ['WSLY', 'Wesley Retail', 61.2], ['XNDR', 'Xander Cable', 8.77], ['YRKL', 'Yorkell Insure', 120.3],
    ['ZEPH', 'Zephyr Freight', 33.6], ['ARDN', 'Arden Textiles', 12.4], ['BRKD', 'Brookwell Dairy', 41.9], ['CNTV', 'Cantvale Oil', 77.8], ['DRMT', 'Dormant Games', 5.31],
    ['EVSH', 'Evesham Brewing', 26.2], ['FRLN', 'Farlane Timber', 18.3], ['GLWT', 'Glenwater Hotels', 64.5], ['HRTF', 'Hartford Lenses', 109.7], ['INKS', 'Inksworth Print', 7.66],
    ['JNVR', 'Junvale Biotech', 231.4], ['KSTL', 'Kestrel Defense', 172.8], ['LMBR', 'Lambert Rubber', 15.2], ['MDWY', 'Midway Transit', 29.8], ['NRTH', 'Northam Copper', 54.1],
    ['ORCH', 'Orchard Seeds', 21.7], ['PNDL', 'Pendle Cloud', 318.2], ['QRRY', 'Quarry Stone', 36.4], ['RVNS', 'Ravens Security', 88.9], ['STWK', 'Strathwick Mills', 47.2],
    ['TDLW', 'Tidelow Ports', 62.7], ['UPFM', 'Upfold Farms', 13.9], ['VRKA', 'Varka Semis', 267.5], ['WNDM', 'Windmere Wind', 24.6], ['XYLO', 'Xylo Instruments', 99.1],
  ] as [string, string, number][]
).map(instrument);

/** A price's decimals: 3 under 10, else 2 (its tick is one unit of the last). */
export const decimalsOf = (price: number): number => (price < 10 ? 3 : 2);

/** mulberry32. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface State {
  /** Prices in whole ticks of `scale` (100 or 1,000 a unit). */
  last: number;
  ref: number;
  scale: number;
  spread: number;
}

/** The seeded ticks, one after another. */
export class Feed {
  private readonly next: () => number;
  private readonly state: State[];

  /** `prices`: each instrument's reference price, in the order its ticks
   *  name it (a u16, so at most 65,536); market watch's 50 unless given. */
  constructor(seed: number, prices: readonly number[] = INSTRUMENTS.map(({ price }) => price)) {
    if (prices.length === 0 || prices.length > 0x10000) throw new Error(`${prices.length} instruments: a tick names one of 1 to 65,536`);
    this.next = rng(seed);
    this.state = prices.map((price) => {
      const scale = 10 ** decimalsOf(price);
      const ticks = Math.round(price * scale);
      return { last: ticks, ref: ticks, scale, spread: 1 };
    });
  }

  /** Writes the next tick at `offset`. */
  write(view: DataView, offset: number): void {
    const instrument = Math.floor(this.next() * this.state.length);
    const s = this.state[instrument]!;
    const trade = this.next() < 0.6;
    if (trade) {
      // A step of one tick: up and down even at the reference, leaning back
      // toward it as the last strays (a rise and a fall equally likely).
      const lean = Math.max(-0.2, Math.min(0.2, ((s.last - s.ref) / s.ref) * 20));
      const r = this.next();
      if (r < 0.25 - lean / 2) s.last += 1;
      else if (r > 0.75 - lean / 2) s.last -= 1;
    }
    s.spread = 1 + Math.floor(this.next() * 3);
    const bid = s.last - Math.floor(s.spread / 2);
    const ask = bid + s.spread;
    view.setUint16(offset + AT.instrument, instrument, true);
    view.setUint16(offset + AT.kind, trade ? 0 : 1, true);
    view.setUint32(offset + AT.bidSize, (1 + Math.floor(this.next() * 99)) * 100, true);
    view.setUint32(offset + AT.askSize, (1 + Math.floor(this.next() * 99)) * 100, true);
    view.setUint32(offset + AT.traded, trade ? (1 + Math.floor(this.next() * 49)) * 100 : 0, true);
    // Whole ticks over the scale: the nearest double to the decimal.
    view.setFloat64(offset + AT.last, s.last / s.scale, true);
    view.setFloat64(offset + AT.bid, bid / s.scale, true);
    view.setFloat64(offset + AT.ask, ask / s.scale, true);
  }

  /** The next `count` ticks as a batch numbered `seq`, its times 0 (the worker stamps them). */
  batch(seq: number, count: number): ArrayBuffer {
    const buffer = new ArrayBuffer(HEADER + count * TICK);
    const view = new DataView(buffer);
    for (let i = 0; i < count; i++) this.write(view, HEADER + i * TICK);
    view.setUint32(AT.seq, seq, true);
    view.setUint32(AT.count, count, true);
    return buffer;
  }
}

/** The longest gap the feed catches up: past it, the ticks owed are only this much. */
export const CATCH_UP_MS = 100;

/**
 * `rate` ticks a second, counted out at each call: the ticks owed since
 * the last, a fraction carried over, a gap past `CATCH_UP_MS` catching up
 * only that much (so a batch holds at most `rate` × 100 ms of ticks).
 */
export class Rate {
  private readonly rate: number;
  private owed = 0;
  private last: number;

  constructor(rate: number, now: number) {
    this.rate = rate;
    this.last = now;
  }

  due(now: number): number {
    this.owed += this.rate * (Math.min(now - this.last, CATCH_UP_MS) / 1000);
    this.last = now;
    const count = Math.floor(this.owed);
    this.owed -= count;
    return count;
  }
}
