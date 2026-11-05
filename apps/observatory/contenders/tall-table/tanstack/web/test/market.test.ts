/**
 * Market watch's feed fixture (`contenders/market/fixtures/feed.json`; its
 * writer says what it holds) run against the TanStack contender's store
 * (`src/data/market.ts`), as the GPUI contender's runs it natively, with
 * the same controls, which must fail it; the store's refusals of a batch
 * that isn't one; and the scenario's rise and fall inside sRGB.
 *
 * Run: `node --test` here (`just observatory fixtures`).
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { AT, Feed, HEADER, INSTRUMENTS, TICK } from '../../../../market/feed.ts';
import { MARKET_WATCH } from '../../../../scenarios.ts';
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
}

const fixture: Fixture = JSON.parse(readFileSync(new URL('../../../../market/fixtures/feed.json', import.meta.url), 'utf8'));
const bytes = readFileSync(new URL('../../../../market/fixtures/feed.bin', import.meta.url));

/** The fixture's batches, each a buffer of its own, as the worker transfers them. */
function batches(): ArrayBuffer[] {
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
function differences(rows: readonly Quote[], folded: number): string[] {
  const found = texts(rows);
  const out = fixture.expect.flatMap((want, i) =>
    Object.entries(want).filter(([key, text]) => (found[i] as Record<string, string>)[key] !== text).map(([key, text]) => `${want.symbol} ${key}: ${(found[i] as Record<string, string>)[key]}, want ${text}`),
  );
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
function run(alter: (batch: ArrayBuffer, first: number) => ArrayBuffer = (batch) => batch, store = new QuoteStore(INSTRUMENTS)): QuoteStore {
  let first = 0;
  for (const batch of batches()) {
    const count = new DataView(batch).getUint32(AT.count, true);
    store.fold(alter(batch, first));
    first += count;
  }
  return store;
}

describe('the feed fixture', () => {
  test('the feed regenerates its bytes', () => {
    assert.equal(fixture.seed, MARKET_WATCH.seed, "the fixture runs the scenario's seed");
    assert.deepEqual(fixture.open, INSTRUMENTS.map(({ price }) => exactText(price)), "the stores start from the feed's instruments");
    assert.equal(createHash('sha256').update(bytes).digest('hex'), fixture.sha256);
    const feed = new Feed(fixture.seed);
    const again = Buffer.concat(fixture.batches.map((count, seq) => new Uint8Array(feed.batch(seq, count))));
    assert.ok(again.equals(bytes), 'the feed module sends what the fixture holds');
  });

  test('the store holds every field after every tick', () => {
    const store = run();
    assert.deepEqual(differences(store.rows, store.folded), []);
  });

  test('control: a store that skips a trade fails it', () => {
    const store = run((batch, first) => {
      const count = new DataView(batch).getUint32(AT.count, true);
      return fixture.drop >= first && fixture.drop < first + count ? without(batch, fixture.drop - first) : batch;
    });
    assert.notDeepEqual(differences(store.rows, store.folded), []);
    // Its fields differ too, not only the count.
    assert.notDeepEqual(differences(store.rows, fixture.folded), []);
  });

  test("control: a store that keeps only each instrument's last tick in a batch fails it", () => {
    const store = run(conflated);
    assert.notDeepEqual(differences(store.rows, fixture.folded), []);
  });

  test('control: a store computing the change % another way fails it', () => {
    const store = run();
    const other = store.rows.map((row) => ({ ...row, changePct: (row.last / row.open - 1) * 100 }));
    assert.notDeepEqual(differences(other, store.folded), []);
  });
});

describe('a batch that isn\'t one', () => {
  const [, second] = batches();
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
