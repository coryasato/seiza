/**
 * Market watch's level in the data layer, the GPUI contender's
 * `scene/market.rs` and `feed.rs` on the DOM side: the instruments' file
 * opened through the engine, its columns checked, then every re-read
 * answered from the feed's store in hand (`MarketSource`, `QuotePage`); the
 * feed's worker folded into the store batch by batch, each ticked run of
 * rows invalidated in the batch's own task (`Feed`); the cells written as
 * the design canvas writes them (`number.ts`'s formats at each
 * instrument's decimals, Change and Change % by sign); and the table's
 * flash on the columns the scenario names (`flash.ts`, from the changed
 * rows `live.ts` keeps). The view draws what `MarketCells` answers
 * (`market.ts`, beside `view.ts`).
 *
 * Every setting is the scenario's (`scenarios.ts`) or the feed's
 * (`feed.ts`), read here, never copied. `main.ts` imports this module on
 * the market level only, after first paint, with the rest of the data
 * layer: no other level's bundle carries it.
 */

import { AT, COLUMNS, HEADER, INSTRUMENTS, TICK, decimalsOf } from '../../../../../market/feed.ts';
import type { FeedStart } from '../../../../../market/worker.ts';
import type { MarketScenario, RateStop } from '../../../../../scenarios.ts';
import { BASE_SIZES, layOutAll, padOf, type LaidOutColumn } from '../layout.ts';
import type { MarketCells, Tone } from '../market.ts';
import { Flashes, noteFlashes } from './flash.ts';
import { shownText, type CellValue } from './format.ts';
import { invalidateRows, takeRefreshed, trackChanges } from './live.ts';
import { QuoteStore, type Batch, type Quote } from './market.ts';
import { Advances, ColumnFormat, type NumberFormat, type NumberValue } from './number.ts';
import { PAGING, type PageSource, type TablePaging } from './paging.ts';
import type { ArrowPage, Column, TablePage } from './table.ts';

/** The table's columns, in the file's order (`feed.ts`'s): the open fails on any other. */
export { COLUMNS };
const [SYMBOL, NAME, LAST, CHANGE, CHANGE_PCT, BID, ASK, BID_SIZE, ASK_SIZE, VOLUME, HIGH, LOW] = COLUMNS.map((_, index) => index) as number[] as [number, number, number, number, number, number, number, number, number, number, number, number];

/** The columns written at an instrument's decimals. */
const PRICED = new Set([LAST, CHANGE, BID, ASK, HIGH, LOW]);

/** Change and Change % by sign: a fall at 0, a zero at 0.5, a rise at 1
 *  (the table's text ramp over ±1e-9, the GPUI side's `SIGN_DOMAIN`). The
 *  width only keeps a zero exact: every change is a whole tick, so a value
 *  is a fall, a zero, or a rise, never between. */
const SIGN_DOMAIN = 1e-9;

/** Each column's format, as `scene/market.rs`'s `columns` sets it: the
 *  prices at 2 (each row's instrument's decimals over it), Change signed,
 *  Change % signed at 2 with `%`, the sizes and Volume grouped. */
const FORMATS: ReadonlyMap<number, NumberFormat> = new Map([
  ...[LAST, BID, ASK, HIGH, LOW].map((column): [number, NumberFormat] => [column, { decimals: 2, sign: 'negative', grouping: false, suffix: '' }]),
  [CHANGE, { decimals: 2, sign: 'always', grouping: false, suffix: '' }],
  [CHANGE_PCT, { decimals: 2, sign: 'always', grouping: false, suffix: '%' }],
  ...[BID_SIZE, ASK_SIZE, VOLUME].map((column): [number, NumberFormat] => [column, { decimals: null, sign: 'negative', grouping: true, suffix: '' }]),
]);

/** A quote's bytes as the GPUI side counts a page from its store (its
 *  `Quote`'s size: eight f64s, two u32s, a u64): the cache's budget unit
 *  for a page with no Arrow bytes of its own. */
const QUOTE_BYTES = 80;

/** The file's columns are market watch's, a row per instrument; else why not. */
export function checkFile(columns: readonly Column[], rows: number): string | null {
  const names = columns.map((column) => column.name);
  if (names.join('\u0000') !== COLUMNS.join('\u0000')) return `its columns are ${JSON.stringify(names)}, not market watch's`;
  if (rows !== INSTRUMENTS.length) return `it has ${rows} rows, but the feed has ${INSTRUMENTS.length} instruments`;
  return null;
}

/** A page from the store: its quotes over the open's page, whose Symbol and
 *  Name are every page's. */
export class QuotePage implements TablePage {
  readonly length: number;
  readonly byteLength: number;
  private readonly opened: TablePage;
  /** The store's quotes when the page was read (an array the store never
   *  changes: it makes a new one each batch). */
  private readonly quotes: readonly Quote[];
  private readonly first: number;

  constructor(opened: TablePage, quotes: readonly Quote[], first: number, end: number) {
    this.opened = opened;
    this.quotes = quotes;
    this.first = Math.min(first, quotes.length);
    this.length = Math.max(0, Math.min(end, quotes.length) - this.first);
    this.byteLength = this.length * QUOTE_BYTES;
  }

  /** The quote at `row` of the page: the same object until a tick moves it. */
  quote(row: number): Quote | undefined {
    return row < this.length ? this.quotes[this.first + row] : undefined;
  }

  value(row: number, column: number): CellValue | undefined {
    const quote = this.quote(row);
    if (!quote) return undefined;
    switch (column) {
      case LAST: return quote.last;
      case CHANGE: return quote.change;
      case CHANGE_PCT: return quote.changePct;
      case BID: return quote.bid;
      case ASK: return quote.ask;
      case BID_SIZE: return quote.bidSize;
      case ASK_SIZE: return quote.askSize;
      case VOLUME: return quote.volume;
      case HIGH: return quote.high;
      case LOW: return quote.low;
      default: return this.opened.value(this.first + row, column);
    }
  }
}

/** The table's source: the engine's rows until the open's page lands and
 *  seeds the store, then the store's, in hand (`ready`): a re-read lands in
 *  the plan that sent it, as the table's `answered`. */
export class MarketSource implements PageSource<TablePage> {
  /** Seeded from the open's page; null until then (or if its Last isn't
   *  every row's price). */
  store: QuoteStore | null = null;
  private readonly engine: PageSource<ArrowPage>;
  private opened: TablePage | null = null;
  /** In-hand reads' ids: negative, apart from the engine's. */
  private next = -1;

  constructor(engine: PageSource<ArrowPage>) {
    this.engine = engine;
  }

  load(rows: readonly [number, number]): { request: number; result: Promise<TablePage>; ready?: TablePage } {
    if (this.store && this.opened) {
      const page = new QuotePage(this.opened, this.store.rows, rows[0], rows[1]);
      return { request: this.next--, result: Promise.resolve(page), ready: page };
    }
    const { request, result } = this.engine.load(rows);
    return {
      request,
      result: result.then((page) => {
        if (rows[0] === 0) this.seed(page);
        return page;
      }),
    };
  }

  cancel(request: number): void {
    // A read in hand answered as it was returned: nothing to cancel.
    if (request >= 0) this.engine.cancel(request);
  }

  /** The open's first page landed: the store starts from its rows (each
   *  instrument's Symbol, Name, and Last). */
  private seed(page: ArrowPage): void {
    if (this.opened) return;
    const instruments = [];
    for (let row = 0; row < page.length; row++) {
      const [symbol, name, price] = [page.value(row, SYMBOL), page.value(row, NAME), page.value(row, LAST)];
      // A file whose Last isn't every row's price leaves the store empty:
      // the feed's start fails.
      if (typeof symbol !== 'string' || typeof name !== 'string' || typeof price !== 'number') return;
      instruments.push({ symbol, name, price });
    }
    this.store = new QuoteStore(instruments);
    this.opened = page;
  }
}

/** The cells' font, as `view.css` sets it: what the format measures with. */
const CELL_FONT = '14px "IBM Plex Sans"';

/** Each of the format's characters' advance at the cells' font, as the
 *  browser measures it (the font loaded first): the table sums its own
 *  advances (`cells.json`'s `advances`, pinned from GPUI's), so both sides
 *  fall back at the same widths. */
async function measureAdvances(): Promise<{ advances: Advances; of: (text: string) => number }> {
  await document.fonts.load(CELL_FONT);
  const context = document.createElement('canvas').getContext('2d')!;
  context.font = CELL_FONT;
  const of = (ch: string) => context.measureText(ch).width;
  return { advances: new Advances(of), of: (text) => [...text].reduce((sum, ch) => Math.fround(sum + Math.fround(of(ch))), 0) };
}

/** The scene's settings for the view, and the store's feed into the paging. */
export interface Market extends MarketCells {
  /** Starts the feed once the table first fills (`main.ts`): the feed's
   *  worker (`contenders/market/worker.ts`, made here, so only this level's
   *  build carries it), its batches folded into the store. A refused batch,
   *  or the worker failing, calls `failed` and ends it. */
  startFeed(failed: (message: string) => void): void;
  /** Ends the feed (a reopen: the new store would miss the ticks sent meanwhile). */
  stop(): void;
}

/** Market watch's table over `paging` (whose source is `source`), its
 *  `columns` laid out: the cells' text, signs, and flashes, and the feed. */
export async function marketTable(scenario: MarketScenario, stop: RateStop, limit: number, paging: TablePaging<TablePage>, source: MarketSource, file: readonly Column[], measured: boolean): Promise<Market> {
  const { advances, of } = await measureAdvances();
  // Laid out once, here: the view draws these (`MarketCells.columns`).
  const columns = layOutAll(file);
  const formats = columns.map((column, index) => {
    const format = FORMATS.get(index);
    return format ? new ColumnFormat(format, column.kind === 'float', of(format.suffix)) : null;
  });
  const decimals = INSTRUMENTS.map(({ price }) => decimalsOf(price));
  const flashing = scenario.flash.columns.map((name) => {
    const index = (COLUMNS as readonly string[]).indexOf(name);
    if (index < 0) throw new Error(`no column ${JSON.stringify(name)} to flash`);
    return index;
  });
  /** A cell's fitted text and whether the format rounded it, or null for
   *  the automatic format's (no format, or the text doesn't fit). */
  const fitted = (index: number, column: LaidOutColumn, row: number, value: CellValue): { text: string; rounded: boolean } | null => {
    const format = formats[index];
    const number = format ? numberValue(column, value) : null;
    if (!format || !number) return null;
    const room = Math.fround(Math.fround(column.width - 2 * padOf(BASE_SIZES)) - 1);
    const text = format.fit(advances, room, number, PRICED.has(index) ? (decimals[row] ?? null) : null);
    return text === null ? null : { text, rounded: format.rounded(text, number) };
  };
  const flashes = new Flashes();
  const flashColumns = flashing.map((index) => ({ index, duration: scenario.flash.ms, float: columns[index]?.kind === 'float' }));
  trackChanges(paging, flashing.length > 0);
  // A re-read landed: its changed cells in the flashing columns flash from now.
  paging.onLanded = (page, old, landed, rows) => {
    const now = performance.now();
    flashes.expire(now);
    noteFlashes(flashes, flashColumns, page * PAGING.pageRows, old, landed, rows.rows(), now);
  };

  let worker: Worker | null = null;
  /** With `?measure`, each batch as folded (`__contender.batches`). */
  const batches: [seq: number, ticks: number, sent: number, generation: number, visible: 0 | 1][] | null = measured ? [] : null;
  if (batches) (globalThis as { __contender?: { batches?: unknown } }).__contender!.batches = batches;
  /** The highest generation drawn (`__contenderRefreshed`, `?measure`). */
  let drawn = 0;

  const stopFeed = () => {
    if (!worker) return;
    worker.onmessage = worker.onerror = worker.onmessageerror = null;
    worker.terminate();
    worker = null;
  };

  /** Folds a batch, every tick or none, and invalidates each run of rows it
   *  ticked, in its message's task: the re-read is the store's, in hand. */
  const fold = (store: QuoteStore, bytes: ArrayBuffer): void => {
    const batch: Batch = store.fold(bytes);
    const ticked = new Uint8Array(store.rows.length);
    const view = new DataView(bytes);
    for (let k = 0; k < batch.count; k++) ticked[view.getUint16(HEADER + k * TICK + AT.instrument, true)] = 1;
    const [first, end] = paging.visible();
    let generation = 0;
    let visible: 0 | 1 = 0;
    for (let row = 0; row < ticked.length; ) {
      if (!ticked[row]) {
        row++;
        continue;
      }
      const start = row;
      while (row < ticked.length && ticked[row]) row++;
      generation = invalidateRows(paging, [start, row]);
      if (start < end && first < row) visible = 1;
    }
    batches?.push([batch.seq, batch.count, batch.sent, generation, visible]);
  };

  return {
    flashing,
    columns,
    text: (index, column, row, value) => fitted(index, column, row, value)?.text ?? shownText(column.kind, value, column.budget),
    rounded: (index, column, row, value) => {
      const fit = fitted(index, column, row, value);
      return fit ? fit.rounded : null;
    },
    tone: (index, value) => (index === CHANGE || index === CHANGE_PCT ? sign(value) : null),
    flash: (row, column, now) => {
      const flash = flashes.at(row, column, now);
      return flash && { at: flash.at, start: flash.start };
    },
    quoteOf: (page, index) => (page instanceof QuotePage ? page.quote(index) : undefined),
    refreshed: () => {
      let raised = false;
      for (const { generation } of takeRefreshed(paging)) {
        if (generation > drawn) {
          drawn = generation;
          raised = true;
        }
      }
      return raised ? drawn : null;
    },
    startFeed: (failed) => {
      const store = source.store;
      if (!store) return failed("the file's Last isn't every instrument's price");
      const fail = (message: string) => {
        stopFeed();
        failed(message);
      };
      try {
        worker = new Worker(new URL('../../../../../market/worker.ts', import.meta.url), { type: 'module' });
      } catch (error) {
        return fail(`its worker wasn't made: ${error instanceof Error ? error.message : String(error)}`);
      }
      worker.onmessage = ({ data }: MessageEvent<ArrayBuffer>) => {
        try {
          fold(store, data);
        } catch (error) {
          fail(`a batch was refused: ${error instanceof Error ? error.message : String(error)}`);
        }
      };
      worker.onerror = (event) => {
        event.preventDefault();
        fail(`worker failed: ${event.message ?? ''}`);
      };
      worker.onmessageerror = () => fail("batch couldn't be read");
      const start: FeedStart = { rate: stop.rate, seed: scenario.seed, limit };
      worker.postMessage(start);
    },
    stop: stopFeed,
  };
}

/** A value as the format reads it: a float column's number, an integer's
 *  text; null for NULL or anything else (the automatic format's). */
function numberValue(column: LaidOutColumn, value: CellValue): NumberValue | null {
  if (typeof value === 'number' && column.kind === 'float') return { kind: 'float', value };
  if (typeof value === 'number' || typeof value === 'bigint') return { kind: 'text', value: String(value) };
  return null;
}

/** A change's sign as the text ramp draws it over ±`SIGN_DOMAIN`. */
function sign(value: CellValue | undefined): Tone {
  if (typeof value !== 'number' || Number.isNaN(value)) return null;
  return value > SIGN_DOMAIN ? 'up' : value < -SIGN_DOMAIN ? 'down' : null;
}
