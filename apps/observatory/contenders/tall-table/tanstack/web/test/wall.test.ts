/**
 * The monitoring wall's data layer (`src/data/wall.ts`), what the feed
 * fixture (`market.test.ts`) and `perf/wall.ts` don't pin: the file's
 * check; the store seeded from the open's read; each desk's rows of it, in
 * hand; a batch's fold invalidating each desk's ticked rows, its
 * generations a table and its visible mask (the contract's batch entry);
 * the wall's fixture's 2,000 ticks through it; and the readout's ring,
 * pooled across the tables. At the wall level (`asLevel`), as its build
 * runs it.
 *
 * Run: `node --test` here (`just observatory fixtures`).
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { HEADER, TICK, AT } from '../../../../market/feed.ts';
import { DESK_ROWS, wallInstruments } from '../../../../wall/desks.ts';
import { DESKS } from '../../../../wall/names.ts';
import { exactText, type CellValue } from '../src/data/format.ts';
import { takeRefreshed } from '../src/data/live.ts';
import { QuoteStore } from '../src/data/market.ts';
import { TablePaging } from '../src/data/paging.ts';
import type { Column, TablePage } from '../src/data/table.ts';
import { COLUMNS, DeskPage, DeskSource, WallRing, checkFile, foldBatch, seedStore } from '../src/data/wall.ts';
import { asLevel } from './level.ts';

const wallTest = (name: string, run: () => Promise<void> | void) => test(name, () => asLevel('wall', run));

/** The file's columns, as the open reads them. */
const FILE: Column[] = COLUMNS.map((name, i) => ({ name, type: ['VARCHAR', 'VARCHAR', 'DOUBLE', 'DOUBLE', 'BIGINT'][i]!, kind: (['text', 'text', 'float', 'float', 'integer'] as const)[i]! }));

/** The open's read of the shown desks' rows, as the engine answers it. */
function opened(tables: number): TablePage {
  const shown = wallInstruments(tables);
  return {
    length: shown.length,
    byteLength: 0,
    value: (row: number, column: number): CellValue | undefined => {
      const instrument = shown[row];
      if (!instrument) return undefined;
      return [instrument.name, instrument.symbol, instrument.price, 0, 0][column];
    },
  };
}

/** A batch of `ticks` (instrument, last), each trading 100. */
function batch(seq: number, ticks: readonly [number, number][]): ArrayBuffer {
  const bytes = new ArrayBuffer(HEADER + ticks.length * TICK);
  const view = new DataView(bytes);
  view.setUint32(AT.seq, seq, true);
  view.setUint32(AT.count, ticks.length, true);
  ticks.forEach(([instrument, last], k) => {
    const o = HEADER + k * TICK;
    view.setUint16(o + AT.instrument, instrument, true);
    view.setUint32(o + AT.traded, 100, true);
    for (const at of [AT.last, AT.bid, AT.ask]) view.setFloat64(o + at, last, true);
  });
  return bytes;
}

/** Each desk's paging over the store, at `rows` visible rows from its top. */
function desks(store: QuoteStore, tables: number, rows = 16): TablePaging<TablePage>[] {
  return Array.from({ length: tables }, (_, desk) => {
    const paging = new TablePaging<TablePage>(DESK_ROWS, new DeskSource(desk, store));
    paging.setViewportRows(rows);
    return paging;
  });
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

wallTest("the file is the wall's: its five columns, every desk's rows", () => {
  assert.equal(checkFile(FILE, 400), null);
  assert.match(checkFile(FILE, 350) ?? '', /350 rows/);
  assert.match(checkFile(FILE.slice(1), 400) ?? '', /not the wall's/);
});

wallTest("the open's read seeds the store; each desk reads its rows, in hand", async () => {
  const store = seedStore(opened(4), 200);
  assert.equal(store.rows.length, 200);
  assert.deepEqual([store.rows[50]!.symbol, store.rows[50]!.name], [wallInstruments(4)[50]!.symbol, DESKS[1]]);
  const read = new DeskSource(2, store).load([0, 1024]);
  assert.ok(read.ready, 'answered in hand');
  assert.equal(read.ready.length, DESK_ROWS, 'one desk, cut at its 50');
  assert.equal(read.ready.value(0, 0), wallInstruments(4)[100]!.symbol);
  assert.equal(read.ready.value(0, 1), wallInstruments(4)[100]!.price);
  assert.equal(read.ready.value(DESK_ROWS, 0), undefined, 'past the desk');
  const page = read.ready as DeskPage;
  assert.equal(page.quote(3), store.rows[103], "the store's quote, so a row memoizes by it");
  const noPrice: TablePage = { ...opened(1), value: (row, column) => (column === 2 ? null : opened(1).value(row, column)) };
  assert.throws(() => seedStore(noPrice, 50), /row 0/);
});

wallTest("a batch's fold: every desk's ticked rows invalidated, a generation a table, the visible mask", async () => {
  const store = seedStore(opened(4), 200);
  const pagings = desks(store, 4);
  await settle();
  // Desk 0's row 3 (on screen), desk 2's row 40 (below its 16), desk 3's rows 0 and 1 (one run).
  const folded = foldBatch(store, pagings, batch(0, [[3, 20], [140, 30], [150, 40], [151, 41]]));
  assert.equal(folded.count, 4);
  assert.deepEqual(folded.generations.map((g) => g > 0), [true, false, true, true]);
  assert.equal(folded.visible, 0b1001, 'desks 0 and 3 ticked a row on screen; desk 2 only below');
  await settle();
  for (const desk of [0, 3]) assert.ok(takeRefreshed(pagings[desk]!).length > 0, `desk ${desk}'s re-read landed`);
  const row = pagings[3]!.row(1);
  assert.equal(row.kind === 'loaded' && row.page.value(row.index, 1), 41, "the re-read is the store's");
  assert.throws(() => foldBatch(store, pagings, batch(1, [[200, 1]])), /instrument 200/, 'past the shown desks: refused whole');
  for (const paging of pagings) paging.close();
});

wallTest("the wall's fixture's 2,000 ticks through the fold: the store is the fixture's", async () => {
  const dir = new URL('../../../../wall/fixtures/', import.meta.url);
  const fixture = JSON.parse(readFileSync(new URL('feed.json', dir), 'utf8')) as { batches: number[]; expect: Record<string, string>[] };
  const bytes = readFileSync(new URL('feed.bin', dir));
  const store = new QuoteStore(wallInstruments(DESKS.length));
  const pagings = desks(store, DESKS.length);
  await settle();
  let at = 0;
  let seen = 0;
  for (const count of fixture.batches) {
    const length = HEADER + count * TICK;
    const folded = foldBatch(store, pagings, bytes.buffer.slice(bytes.byteOffset + at, bytes.byteOffset + at + length) as ArrayBuffer);
    at += length;
    assert.equal(folded.generations.length, DESKS.length);
    seen |= folded.visible;
    await settle();
  }
  assert.equal(seen, 0xff, 'every desk ticked a row on screen');
  store.rows.forEach((quote, i) => {
    const want = fixture.expect[i]!;
    assert.equal(exactText(quote.last), want.last, `${quote.symbol} last`);
    assert.equal(String(quote.volume), want.volume, `${quote.symbol} volume`);
  });
  for (const paging of pagings) paging.close();
});

wallTest('the ring pools a batch across its tables: a sample once every table in its mask drew it', () => {
  const ring = new WallRing();
  ring.folded(1000, [3, 0, 5], 0b101);
  ring.folded(1010, [4, 0, 0], 0b001);
  ring.drawn([3, 0, 4], 1020);
  assert.equal(ring.samples[0], 0, "table 2 hasn't drawn generation 5");
  ring.drawn([3, 9, 5], 1030);
  assert.equal(ring.samples[0], 1, 'the first batch, drawn whole');
  assert.deepEqual([ring.samples[1], ring.samples[2]], [1030, 30]);
  ring.drawn([4, 9, 5], 1040);
  assert.deepEqual([ring.samples[0], ring.samples[3], ring.samples[4]], [2, 1040, 30]);
});
