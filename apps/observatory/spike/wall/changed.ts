// What a frame must redraw under the feed, from its own ticks (throwaway;
// the monitoring wall's spike), for the wall's layout and market watch's
// alike. Each frame at 60 Hz folds its ticks into a store, then counts, over
// the visible rows only:
// - rows changed: a drawn cell's value differs from the frame before;
// - cells changed: each drawn column whose value differs (a trade that
//   leaves Last where it was changes Volume alone);
// - cells flashing: each flash column whose value changed within the last
//   400 ms (the flash's length), the frame's own changes included.
// The wall draws Last, Chg %, and Volume, flashing Last; market watch draws
// its 10 numeric columns, flashing Last, Bid, and Ask. Values are compared
// as numbers: a change too small for a column's decimals would count, but
// every move is a whole price tick, so none is.
//
// Usage: node apps/observatory/spike/wall/changed.ts [--wall-rows 16] [--market-rows 29]

import { INSTRUMENTS, Feed as MarketFeed } from '../../contenders/market/feed.ts';
import { Feed, HEADER, TICK } from '../src/feed-worker.ts';
import { option } from '../../../../shared-web/perf/protocol.ts';
import { WALL_INSTRUMENTS } from '../../contenders/wall/instruments.ts';

const FRAMES = 3000;
const FLASH_FRAMES = Math.round(0.4 * 60);

type Field = 'last' | 'change' | 'changePct' | 'bid' | 'ask' | 'bidSize' | 'askSize' | 'volume' | 'high' | 'low';

interface Layout {
  name: string;
  prices: readonly number[];
  /** Whether instrument i's row is on screen. */
  visible: (i: number) => boolean;
  drawn: readonly Field[];
  flashing: readonly Field[];
}

interface Counts {
  rows: number;
  cells: number;
  flashing: number;
}

function simulate(layout: Layout, rate: number, write: (view: DataView, offset: number) => void): Counts {
  const n = layout.prices.length;
  const open = Float64Array.from(layout.prices);
  const store: Record<Field, Float64Array> = {
    last: Float64Array.from(open), change: new Float64Array(n), changePct: new Float64Array(n),
    bid: Float64Array.from(open), ask: Float64Array.from(open), bidSize: new Float64Array(n),
    askSize: new Float64Array(n), volume: new Float64Array(n), high: Float64Array.from(open), low: Float64Array.from(open),
  };
  // The frame each flash column of each row last changed in.
  const flashedAt = layout.flashing.map(() => new Int32Array(n).fill(-FLASH_FRAMES - 1));
  const shown = Array.from({ length: n }, (_, i) => i).filter(layout.visible);
  const view = new DataView(new ArrayBuffer(HEADER + TICK));
  const total: Counts = { rows: 0, cells: 0, flashing: 0 };
  let owed = 0;
  for (let frame = 0; frame < FRAMES; frame++) {
    const before = layout.drawn.map((f) => Float64Array.from(store[f]));
    owed += rate / 60;
    const count = Math.floor(owed);
    owed -= count;
    for (let k = 0; k < count; k++) {
      write(view, HEADER);
      const i = view.getUint16(HEADER, true);
      const last = view.getFloat64(HEADER + 16, true);
      store.last[i] = last;
      store.change[i] = last - open[i]!;
      store.changePct[i] = ((last - open[i]!) / open[i]!) * 100;
      store.bid[i] = view.getFloat64(HEADER + 24, true);
      store.ask[i] = view.getFloat64(HEADER + 32, true);
      store.bidSize[i] = view.getUint32(HEADER + 4, true);
      store.askSize[i] = view.getUint32(HEADER + 8, true);
      store.volume[i] = store.volume[i]! + view.getUint32(HEADER + 12, true);
      if (last > store.high[i]!) store.high[i] = last;
      if (last < store.low[i]!) store.low[i] = last;
    }
    for (const i of shown) {
      let changed = 0;
      layout.drawn.forEach((f, c) => {
        if (store[f][i] !== before[c]![i]) {
          changed++;
          const flash = layout.flashing.indexOf(f);
          if (flash >= 0) flashedAt[flash]![i] = frame;
        }
      });
      if (changed) total.rows++;
      total.cells += changed;
      for (const at of flashedAt) if (frame - at[i]! < FLASH_FRAMES) total.flashing++;
    }
  }
  return { rows: total.rows / FRAMES, cells: total.cells / FRAMES, flashing: total.flashing / FRAMES };
}

const WALL_ROWS = Number(option('wall-rows') ?? 16);
const MARKET_ROWS = Number(option('market-rows') ?? 29);
const SEED = 0x5eed;

const DESK_COUNT = 8;
const wall: Layout = {
  name: `wall, ${DESK_COUNT} desks × ${WALL_ROWS} rows on screen`,
  prices: WALL_INSTRUMENTS.slice(0, DESK_COUNT * 50).map(([, , price]) => price),
  visible: (i) => i % 50 < WALL_ROWS,
  drawn: ['last', 'changePct', 'volume'],
  flashing: ['last'],
};
for (const perDesk of [1000, 2000, 5000]) {
  const feed = new Feed(SEED, wall.prices);
  const c = simulate(wall, perDesk * DESK_COUNT, (v, o) => feed.write(v, o));
  const onScreen = DESK_COUNT * WALL_ROWS;
  console.log(`${wall.name}, ${perDesk}/s a desk: rows changed ${c.rows.toFixed(1)} (${((100 * c.rows) / onScreen).toFixed(1)}%), cells changed ${c.cells.toFixed(1)}, cells flashing ${c.flashing.toFixed(1)} a frame`);
}

const market: Layout = {
  name: `market watch, ${MARKET_ROWS} of 50 rows on screen`,
  prices: INSTRUMENTS.map((instrument) => instrument.price),
  visible: (i) => i < MARKET_ROWS,
  drawn: ['last', 'change', 'changePct', 'bid', 'ask', 'bidSize', 'askSize', 'volume', 'high', 'low'],
  flashing: ['last', 'bid', 'ask'],
};
for (const rate of [100, 500, 1000, 5000]) {
  const feed = new MarketFeed(SEED);
  const c = simulate(market, rate, (v, o) => feed.write(v, o));
  console.log(`${market.name}, ${rate}/s: rows changed ${c.rows.toFixed(1)} (${((100 * c.rows) / MARKET_ROWS).toFixed(1)}%), cells changed ${c.cells.toFixed(1)}, cells flashing ${c.flashing.toFixed(1)} a frame`);
}
