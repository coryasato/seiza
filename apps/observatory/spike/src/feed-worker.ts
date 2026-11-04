// The market watch feed spike's worker (throwaway; market watch's feed path): a seeded
// feed over 50 fictional instruments, `rate` ticks a second, counted out
// about every 16 ms with a fraction carried over (the bare host's `Rate`),
// a gap past 100 ms catching up only that much. Every tick is a pure
// function of the seed and its index, so two runs send the same ticks
// whatever their batches' boundaries.
//
// A batch: a 24-byte header (u32 sequence, u32 tick count, f64 the send
// time in epoch ms, f64 the generation's ms) then 40 bytes a tick (u16
// instrument, u16 kind (0 a trade, 1 a quote), u32 bid size, u32 ask size,
// u32 size traded, f64 last, f64 bid, f64 ask), little-endian. The send
// time is stamped last, right before the post. A batch holds at most
// `rate` × 100 ms of ticks (5,000 at 50k: the catch-up's cap). `send`
// `batch` posts a frame's batch as one transferred ArrayBuffer; `tick` posts
// each tick as a buffer of its own (the control: a message per tick).

export const HEADER = 24;
export const TICK = 40;

/** Reference price and tick size: the canvas's 25 and 25 more of the kind. */
export const INSTRUMENTS: [string, string, number][] = [
  ['AVRN', 'Avernus Rail', 84.2], ['BLMR', 'Bellamere Foods', 31.7], ['CRSL', 'Corsail Shipping', 112.4], ['DNTH', 'Danthorpe Energy', 58.9], ['ELWY', 'Elway Pharma', 203.1],
  ['FNSK', 'Fenske Mining', 14.6], ['GRVL', 'Gravell Telecom', 22.3], ['HLDN', 'Holden Air', 47.8], ['IVRA', 'Ivora Steel', 9.42], ['JSPR', 'Jasper Grain', 66.1],
  ['KLMT', 'Kalmont Water', 38.5], ['LWRD', 'Lowrie Media', 17.9], ['MRVN', 'Marven Logistics', 141.2], ['NDLR', 'Nadler Chips', 388.6], ['OKVL', 'Oakvale Bank', 52.4],
  ['PRSC', 'Prescot Glass', 27.0], ['QNTN', 'Quinton Paper', 11.8], ['RDGW', 'Ridgeway Power', 73.3], ['SLNR', 'Solnar Solar', 19.4], ['TRVK', 'Trevik Cement', 44.0],
  ['ULSN', 'Ulsen Robotics', 156.9], ['VNTR', 'Ventra Health', 95.5], ['WSLY', 'Wesley Retail', 61.2], ['XNDR', 'Xander Cable', 8.77], ['YRKL', 'Yorkell Insure', 120.3],
  ['ZEPH', 'Zephyr Freight', 33.6], ['ARDN', 'Arden Textiles', 12.4], ['BRKW', 'Brookwell Dairy', 41.9], ['CNTV', 'Cantvale Oil', 77.8], ['DRMT', 'Dormant Games', 5.31],
  ['EVSH', 'Evesham Brewing', 26.2], ['FRLN', 'Farlane Timber', 18.3], ['GLWT', 'Glenwater Hotels', 64.5], ['HRTF', 'Hartford Lenses', 109.7], ['INKS', 'Inksworth Print', 7.66],
  ['JNVR', 'Junvale Biotech', 231.4], ['KSTL', 'Kestrel Defense', 172.8], ['LMBR', 'Lambert Rubber', 15.2], ['MDWY', 'Midway Transit', 29.8], ['NRTH', 'Northam Copper', 54.1],
  ['ORCH', 'Orchard Seeds', 21.7], ['PNDL', 'Pendle Cloud', 318.2], ['QRRY', 'Quarry Stone', 36.4], ['RVNS', 'Ravens Security', 88.9], ['STRW', 'Strathwick Mills', 47.2],
  ['TDLW', 'Tidelow Ports', 62.7], ['UPFM', 'Upfold Farms', 13.9], ['VRKA', 'Varka Semis', 267.5], ['WNDM', 'Windmere Wind', 24.6], ['XYLO', 'Xylo Instruments', 99.1],
];

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
  /** Prices in whole ticks of `scale` (100 or 1000 a unit). */
  last: number;
  ref: number;
  scale: number;
  spread: number;
}

export class Feed {
  private readonly next: () => number;
  private readonly state: State[];

  constructor(seed: number) {
    this.next = rng(seed);
    this.state = INSTRUMENTS.map(([, , price]) => {
      const scale = price < 10 ? 1000 : 100;
      const ticks = Math.round(price * scale);
      return { last: ticks, ref: ticks, scale, spread: 1 };
    });
  }

  /** Writes one tick at `offset`. */
  write(view: DataView, offset: number): void {
    const instrument = Math.floor(this.next() * this.state.length);
    const s = this.state[instrument]!;
    const trade = this.next() < 0.6;
    if (trade) {
      // A step of one tick, leaning back toward the reference price.
      const lean = Math.max(-0.2, Math.min(0.2, ((s.last - s.ref) / s.ref) * 20));
      const r = this.next();
      if (r < 0.5 - lean) s.last += 1;
      else if (r > 0.75 - lean / 2) s.last -= 1;
    }
    s.spread = 1 + Math.floor(this.next() * 3);
    const bid = s.last - Math.floor(s.spread / 2);
    const ask = bid + s.spread;
    view.setUint16(offset, instrument, true);
    view.setUint16(offset + 2, trade ? 0 : 1, true);
    view.setUint32(offset + 4, (1 + Math.floor(this.next() * 99)) * 100, true);
    view.setUint32(offset + 8, (1 + Math.floor(this.next() * 99)) * 100, true);
    view.setUint32(offset + 12, trade ? (1 + Math.floor(this.next() * 49)) * 100 : 0, true);
    // Whole ticks over the scale: the nearest double to the decimal.
    view.setFloat64(offset + 16, s.last / s.scale, true);
    view.setFloat64(offset + 24, bid / s.scale, true);
    view.setFloat64(offset + 32, ask / s.scale, true);
  }
}

// ---------------------------------------------------------------- the worker

// The page's tsconfig has no WebWorker lib: the two calls used, typed here.
declare const self: { onmessage: ((event: MessageEvent<Start>) => void) | null; postMessage(message: unknown, transfer: Transferable[]): void };

interface Start {
  rate: number;
  seed: number;
  send: 'batch' | 'tick';
  /** Stop after this many ticks (0: never). */
  limit: number;
}

if (typeof self !== 'undefined' && typeof (self as unknown as { importScripts?: unknown }).importScripts === 'function') {
  self.onmessage = ({ data }: MessageEvent<Start>) => {
    const feed = new Feed(data.seed);
    let seq = 0;
    let sent = 0;
    let owed = 0;
    let last = performance.now();
    const tick = () => {
      const now = performance.now();
      owed += data.rate * (Math.min(now - last, 100) / 1000);
      last = now;
      let count = Math.floor(owed);
      owed -= count;
      if (data.limit) count = Math.min(count, data.limit - sent);
      sent += count;
      if (count > 0) {
        if (data.send === 'batch') {
          const t0 = performance.now();
          const buffer = new ArrayBuffer(HEADER + count * TICK);
          const view = new DataView(buffer);
          for (let i = 0; i < count; i++) feed.write(view, HEADER + i * TICK);
          view.setUint32(0, seq++, true);
          view.setUint32(4, count, true);
          view.setFloat64(16, performance.now() - t0, true);
          // Stamped last, at the post: the transport excludes generating.
          view.setFloat64(8, performance.timeOrigin + performance.now(), true);
          self.postMessage(buffer, [buffer]);
        } else {
          for (let i = 0; i < count; i++) {
            const buffer = new ArrayBuffer(HEADER + TICK);
            const view = new DataView(buffer);
            feed.write(view, HEADER);
            view.setUint32(0, seq++, true);
            view.setUint32(4, 1, true);
            view.setFloat64(8, performance.timeOrigin + performance.now(), true);
            self.postMessage(buffer, [buffer]);
          }
        }
      }
      if (!data.limit || sent < data.limit) setTimeout(tick, 16);
    };
    setTimeout(tick, 16);
  };
}
