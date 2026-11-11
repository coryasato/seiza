/**
 * The feed fixtures (`contenders/market/fixtures/feed.json`, market
 * watch's, and `contenders/wall/fixtures/feed.json`, the monitoring wall's
 * 400 instruments; their writer says what each holds) run against the
 * TanStack contender's store (`src/data/market.ts`), as the GPUI
 * contender's runs them natively, with the same controls, which must fail
 * each (the wall's batches refused by a store of market watch's 50 among
 * them); the store's refusals of a batch that isn't one; each of the wall's
 * stops' feed against the bytes its fixture pins (the feed is JS, so only
 * here), and the default instruments market watch's; and the scenario's
 * rise and fall inside sRGB.
 *
 * Run: `node --test` here (`just observatory fixtures`).
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { AT, Feed, HEADER, INSTRUMENTS, TICK, type Instrument } from '../../../../market/feed.ts';
import { MARKET_WATCH, MONITORING_WALL } from '../../../../scenarios.ts';
import { wallInstruments } from '../../../../wall/desks.ts';
import { DESKS } from '../../../../wall/names.ts';
import { exactText } from '../src/data/format.ts';
import { QUOTE_FIELDS, QuoteStore, type Quote } from '../src/data/market.ts';
import { fromOklch, oklab } from '../src/paint.ts';

interface Fixture {
  seed: number;
  ticks: number;
  batches: number[];
  open: string[];
  sha256: string;
  folded: number;
  drop: number;
  expect: Record<string, string>[];
  /** The wall's only: each stop's feed bytes, by SHA-256. */
  stops?: { id: string; tables: number; sha256: string }[];
}

/** A fixture as a store runs it: what it holds, its bytes, and its scenario's seed and instruments. */
interface Run {
  name: string;
  fixture: Fixture;
  bytes: Buffer;
  seed: number;
  instruments: readonly Instrument[];
}

const load = (dir: string, rest: Omit<Run, 'fixture' | 'bytes'>): Run => ({
  ...rest,
  fixture: JSON.parse(readFileSync(new URL(`../../../../${dir}/fixtures/feed.json`, import.meta.url), 'utf8')),
  bytes: readFileSync(new URL(`../../../../${dir}/fixtures/feed.bin`, import.meta.url)),
});

const MARKET = load('market', { name: 'market watch', seed: MARKET_WATCH.seed, instruments: INSTRUMENTS });
const WALL = load('wall', { name: 'the monitoring wall', seed: MONITORING_WALL.seed, instruments: wallInstruments(DESKS.length) });
const RUNS: readonly Run[] = [MARKET, WALL];

/** A fixture's batch sizes from a feed over `prices`, the bytes as the worker sends them. */
const feedBytes = (seed: number, prices: readonly number[], sizes: readonly number[], feed = new Feed(seed, prices)) =>
  Buffer.concat(sizes.map((count, seq) => new Uint8Array(feed.batch(seq, count))));

/** The fixture's batches, each a buffer of its own, as the worker transfers them. */
function batches({ fixture, bytes }: Run): ArrayBuffer[] {
  const out: ArrayBuffer[] = [];
  let at = 0;
  for (const count of fixture.batches) {
    const length = HEADER + count * TICK;
    out.push(bytes.buffer.slice(bytes.byteOffset + at, bytes.byteOffset + at + length) as ArrayBuffer);
    at += length;
  }
  assert.equal(at, bytes.length, 'the batches cover the bytes');
  return out;
}

/** The fixture's key for each of the store's fields. */
const KEY: Record<(typeof QUOTE_FIELDS)[number], string> = {
  last: 'last', change: 'change', changePct: 'change_pct', bid: 'bid', ask: 'ask', bidSize: 'bid_size', askSize: 'ask_size', volume: 'volume', high: 'high', low: 'low',
};
const INTEGERS = new Set(['bidSize', 'askSize', 'volume']);

/** Each instrument's fields as the fixture writes them. */
const texts = (rows: readonly Quote[]) =>
  rows.map((row) => ({ symbol: row.symbol, ...Object.fromEntries(QUOTE_FIELDS.map((field) => [KEY[field], INTEGERS.has(field) ? String(row[field]) : exactText(row[field])])) }));

/** Where the fixture and a store part, or none. */
function differences({ fixture }: Run, rows: readonly Quote[], folded: number): string[] {
  const found = texts(rows);
  const out = fixture.expect.flatMap((want, i) =>
    Object.entries(want).filter(([key, text]) => (found[i] as Record<string, string>)[key] !== text).map(([key, text]) => `${want.symbol} ${key}: ${(found[i] as Record<string, string>)[key]}, want ${text}`),
  );
  if (rows.length !== fixture.expect.length) out.push(`${rows.length} instruments, want ${fixture.expect.length}`);
  if (folded !== fixture.folded) out.push(`folded ${folded}, want ${fixture.folded}`);
  return out;
}

/** A batch with the tick at `index` (its own index) taken out, its count one less. */
function without(batch: ArrayBuffer, index: number): ArrayBuffer {
  const count = new DataView(batch).getUint32(AT.count, true);
  const out = new Uint8Array(batch.byteLength - TICK);
  const from = new Uint8Array(batch);
  out.set(from.subarray(0, HEADER + index * TICK));
  out.set(from.subarray(HEADER + (index + 1) * TICK), HEADER + index * TICK);
  new DataView(out.buffer).setUint32(AT.count, count - 1, true);
  return out.buffer;
}

/** A batch with only each instrument's last tick in it (conflated). */
function conflated(batch: ArrayBuffer): ArrayBuffer {
  const view = new DataView(batch);
  const count = view.getUint32(AT.count, true);
  const lastOf = new Map<number, number>();
  for (let k = 0; k < count; k++) lastOf.set(view.getUint16(HEADER + k * TICK + AT.instrument, true), k);
  const keep = [...lastOf.values()].sort((a, b) => a - b);
  const out = new Uint8Array(HEADER + keep.length * TICK);
  out.set(new Uint8Array(batch, 0, HEADER));
  keep.forEach((k, j) => out.set(new Uint8Array(batch, HEADER + k * TICK, TICK), HEADER + j * TICK));
  new DataView(out.buffer).setUint32(AT.count, keep.length, true);
  return out.buffer;
}

/** The fixture's batches folded into a fresh store, each through `alter` first. */
function run(r: Run, alter: (batch: ArrayBuffer, first: number) => ArrayBuffer = (batch) => batch, store = new QuoteStore(r.instruments)): QuoteStore {
  let first = 0;
  for (const batch of batches(r)) {
    const count = new DataView(batch).getUint32(AT.count, true);
    store.fold(alter(batch, first));
    first += count;
  }
  return store;
}

for (const r of RUNS)
  describe(`the feed fixture: ${r.name}`, () => {
    const { fixture, bytes } = r;
    test('the feed regenerates its bytes', () => {
      assert.equal(fixture.seed, r.seed, "the fixture runs the scenario's seed");
      assert.deepEqual(fixture.open, r.instruments.map(({ price }) => exactText(price)), "the stores start from the scenario's instruments");
      assert.deepEqual(fixture.expect.map(({ symbol }) => symbol), r.instruments.map(({ symbol }) => symbol));
      assert.equal(createHash('sha256').update(bytes).digest('hex'), fixture.sha256);
      const again = feedBytes(fixture.seed, r.instruments.map(({ price }) => price), fixture.batches);
      assert.ok(again.equals(bytes), 'the feed module sends what the fixture holds');
    });

    test('the store holds every field after every tick', () => {
      const store = run(r);
      assert.deepEqual(differences(r, store.rows, store.folded), []);
    });

    test('control: a store that skips a trade fails it', () => {
      const store = run(r, (batch, first) => {
        const count = new DataView(batch).getUint32(AT.count, true);
        return fixture.drop >= first && fixture.drop < first + count ? without(batch, fixture.drop - first) : batch;
      });
      assert.notDeepEqual(differences(r, store.rows, store.folded), []);
      // Its fields differ too, not only the count.
      assert.notDeepEqual(differences(r, store.rows, fixture.folded), []);
    });

    test("control: a store that keeps only each instrument's last tick in a batch fails it", () => {
      const store = run(r, conflated);
      assert.notDeepEqual(differences(r, store.rows, fixture.folded), []);
    });

    test('control: a store computing the change % another way fails it', () => {
      const store = run(r);
      const other = store.rows.map((row) => ({ ...row, changePct: (row.last / row.open - 1) * 100 }));
      assert.notDeepEqual(differences(r, other, store.folded), []);
    });
  });

test("the feed's default instruments are market watch's", () => {
  const { fixture } = MARKET;
  assert.ok(feedBytes(fixture.seed, [], fixture.batches, new Feed(fixture.seed)).equals(MARKET.bytes));
});

test("each of the wall's stops sends the feed its fixture pins", () => {
  const { fixture } = WALL;
  assert.deepEqual(fixture.stops?.map(({ id, tables }) => ({ id, tables })), MONITORING_WALL.stops.map(({ id, tables }) => ({ id, tables })));
  for (const { id, tables, sha256 } of fixture.stops!) {
    const bytes = feedBytes(fixture.seed, wallInstruments(tables).map(({ price }) => price), fixture.batches);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), sha256, `stop ${id}`);
  }
  // The control: another stop's desks send other bytes.
  const four = feedBytes(fixture.seed, wallInstruments(4).map(({ price }) => price), fixture.batches);
  assert.notEqual(createHash('sha256').update(four).digest('hex'), fixture.stops!.find(({ id }) => id === '6')!.sha256);
});

test("control: the wall's ticks over market watch's 50 instruments are refused", () => {
  // The wall's batches name instruments up to 399: a store sized for
  // market watch's 50 refuses them rather than fold them into the wrong rows.
  const store = new QuoteStore(INSTRUMENTS);
  assert.throws(() => {
    for (const batch of batches(WALL)) store.fold(batch);
  }, /instrument \d+ of 50/);
});

describe('a batch that isn\'t one', () => {
  const [, second] = batches(MARKET);
  test('a length that doesn\'t match its count throws', () => {
    assert.throws(() => new QuoteStore(INSTRUMENTS).fold(second!.slice(0, second!.byteLength - 1)), /ticks is/);
    assert.throws(() => new QuoteStore(INSTRUMENTS).fold(new ArrayBuffer(HEADER - 1)), /no header/);
  });
  test('an instrument out of range throws', () => {
    const bad = second!.slice(0);
    new DataView(bad).setUint16(HEADER + AT.instrument, INSTRUMENTS.length, true);
    assert.throws(() => new QuoteStore(INSTRUMENTS).fold(bad), /instrument 50 of 50/);
  });
});

test("the scenario's rise and fall are inside sRGB", () => {
  for (const theme of ['light', 'dark'] as const)
    for (const [sign, [l, c, h]] of Object.entries(MARKET_WATCH.signs[theme])) {
      // Converted and back, unchanged: a clamped channel moves it.
      const back = oklab(fromOklch(l, c, h));
      const off = Math.abs(back.l - l) + Math.abs(back.a - c * Math.cos((h * Math.PI) / 180)) + Math.abs(back.b - c * Math.sin((h * Math.PI) / 180));
      assert.ok(off < 1e-3, `${theme} ${sign} oklch(${l} ${c} ${h}) is outside sRGB (${off})`);
    }
  // The control: a chroma past the gamut is caught.
  const [l, , h] = MARKET_WATCH.signs.light.up;
  const back = oklab(fromOklch(l, 0.3, h));
  assert.ok(Math.abs(back.a - 0.3 * Math.cos((h * Math.PI) / 180)) + Math.abs(back.b - 0.3 * Math.sin((h * Math.PI) / 180)) > 1e-3);
});
