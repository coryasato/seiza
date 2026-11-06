/**
 * The market level's source (`src/data/quotes.ts`), as the GPUI contender's
 * `scene/market.rs` tests its own: the open's read is the engine's and
 * seeds the store; every read after it is the store's, in hand, its
 * Symbol and Name the open's page's; a page's quotes keep their identity
 * until a tick moves them (the rows' memo key); and the file is checked as
 * the feed's instruments.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AT, HEADER, INSTRUMENTS, TICK } from '../../../../market/feed.ts';
import type { CellValue } from '../src/data/format.ts';
import { COLUMNS, MarketSource, QuotePage, checkFile } from '../src/data/quotes.ts';
import type { PageSource } from '../src/data/paging.ts';
import type { ArrowPage, Column } from '../src/data/table.ts';
import './level.ts';

/** The file's three instruments at the open, as the engine reads them. */
const PRICES = [84.2, 9.42, 112.4];
class FilePage {
  readonly byteLength = 100;
  readonly length: number;
  private readonly first: number;
  constructor([start, end]: readonly [number, number]) {
    this.first = start;
    this.length = Math.max(0, Math.min(end, PRICES.length) - start);
  }
  value(row: number, column: number): CellValue | undefined {
    const at = this.first + row;
    const price = PRICES[at];
    if (price === undefined || row >= this.length) return undefined;
    if (column === 0) return `S${at}`;
    if (column === 1) return `Name ${at}`;
    if ([2, 5, 6, 10, 11].includes(column)) return price;
    if (column === 3 || column === 4) return 0;
    return column === 9 ? 0n : 0;
  }
}

/** The engine: every read logged, answered at once. */
function engine(): { source: PageSource<ArrowPage>; reads: (readonly [number, number])[]; cancels: number[] } {
  const reads: (readonly [number, number])[] = [];
  const cancels: number[] = [];
  return {
    reads,
    cancels,
    source: {
      load: (rows) => {
        reads.push(rows);
        return { request: reads.length - 1, result: Promise.resolve(new FilePage(rows) as unknown as ArrowPage) };
      },
      cancel: (request) => cancels.push(request),
    },
  };
}

/** A batch of `ticks` (instrument, last), its bid and ask the last, the rest 0. */
function batch(ticks: [number, number][]): ArrayBuffer {
  const view = new DataView(new ArrayBuffer(HEADER + ticks.length * TICK));
  view.setUint32(AT.count, ticks.length, true);
  ticks.forEach(([instrument, last], index) => {
    const at = HEADER + index * TICK;
    view.setUint16(at + AT.instrument, instrument, true);
    for (const field of [AT.last, AT.bid, AT.ask]) view.setFloat64(at + field, last, true);
  });
  return view.buffer;
}

test("the open is the engine's, and every read after it the store's, in hand", async () => {
  const { source: file, reads, cancels } = engine();
  const source = new MarketSource(file);
  assert.equal(source.store, null, 'no store before the open');

  const open = source.load([0, 3]);
  assert.equal(open.ready, undefined, "the open's read is the engine's");
  const opened = await open.result;
  assert.ok(source.store, "seeded from the open's page");
  assert.equal(opened.value(0, 2), 84.2);
  // Read again: the assertion above narrowed `source.store` to null.
  const store = (source as MarketSource).store!;

  store.fold(batch([[0, 84.21], [2, 112.3]]));
  const read = source.load([0, 3]);
  assert.ok(read.ready instanceof QuotePage, 'answered from the store, in hand');
  assert.equal(await read.result, read.ready, 'its promise the same page');
  assert.ok(read.request < 0, 'its id apart from the engine’s');
  assert.deepEqual(reads, [[0, 3]], 'the engine read once');
  const page = read.ready;
  assert.equal(page.value(0, 0), 'S0', "the open's Symbol");
  assert.equal(page.value(0, 1), 'Name 0', "the open's Name");
  assert.equal(page.value(0, 2), 84.21);
  assert.equal(page.value(1, 2), 9.42, 'an instrument no tick moved');
  assert.equal(page.value(2, 2), 112.3);
  assert.equal(page.value(3, 2), undefined, 'past the rows');
  assert.ok(Math.abs((page.value(0, 3) as number) - 0.01) < 1e-9, 'Change, last − open');
  assert.equal(page.value(0, 9), 0, 'Volume');

  // An untouched quote keeps its identity across a fold; a ticked one doesn't.
  store.fold(batch([[2, 112.2]]));
  const next = source.load([0, 3]).ready as QuotePage;
  assert.equal(next.quote(0), page.quote(0), 'row 0 untouched: the same quote');
  assert.notEqual(next.quote(2), page.quote(2), 'row 2 ticked: a new quote');
  assert.equal(page.value(2, 2), 112.3, 'a page keeps the quotes it was read with');

  source.cancel(read.request);
  assert.deepEqual(cancels, [], 'a read in hand has nothing to cancel');
  source.cancel(0);
  assert.deepEqual(cancels, [0], "the engine's reads are cancelled at the engine");
});

test("an open whose Last isn't every row's price leaves the store empty", async () => {
  const { source: file } = engine();
  const broken: PageSource<ArrowPage> = {
    load: (rows) => {
      const { request, result } = file.load(rows);
      return { request, result: result.then((page) => ({ ...page, length: page.length, byteLength: 0, value: (row: number, column: number) => (column === 2 && row === 1 ? null : page.value(row, column)) }) as unknown as ArrowPage) };
    },
    cancel: () => {},
  };
  const source = new MarketSource(broken);
  await source.load([0, 3]).result;
  assert.equal(source.store, null);
  assert.equal(source.load([0, 3]).ready, undefined, 'still the engine’s');
});

test("the file is market watch's: its columns, a row per instrument", () => {
  const columns = (names: readonly string[]): Column[] => names.map((name) => ({ name, type: 'DOUBLE', kind: 'float' }));
  assert.equal(checkFile(columns(COLUMNS), INSTRUMENTS.length), null);
  assert.match(checkFile(columns(COLUMNS.slice(0, 11)), INSTRUMENTS.length) ?? '', /columns/);
  assert.match(checkFile(columns([...COLUMNS.slice(0, 11), 'Close']), INSTRUMENTS.length) ?? '', /columns/);
  assert.match(checkFile(columns(COLUMNS), INSTRUMENTS.length - 1) ?? '', /49 rows/);
});
