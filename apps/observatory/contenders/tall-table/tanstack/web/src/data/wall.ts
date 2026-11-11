/**
 * The monitoring wall's level in the data layer, the GPUI contender's
 * `scene/wall.rs` and `wall.rs` on the DOM side: the wall's file checked
 * (its five columns, every desk's rows), the stop's desks' rows read once
 * through the engine (one read, which seeds market watch's store,
 * `QuoteStore`, over the shown instruments), then a table a desk, each its
 * own paging over its desk's 50 rows of the store, every read in hand
 * (`DeskSource`, `DeskPage`); the feed's worker folded into the store batch
 * by batch, each table's ticked runs of rows invalidated in the batch's own
 * task, its generations and its visible mask recorded (`__contender.batches`
 * with `?measure`); the cells written as the design canvas writes them
 * (`number.ts`'s formats at the grid's text: Last at each instrument's
 * decimals, Chg % signed at 2 with `%` and drawn by sign, Volume grouped);
 * Last's flash; and with `?readout` the ring pooled across the tables. The
 * view draws what each desk's `WallDesk` answers (`wall.ts`, beside
 * `view.ts`), and marks across the tables.
 *
 * Every setting is the scenario's (`scenarios.ts`), the feed's (`feed.ts`),
 * or the desks' (`contenders/wall/`), read here, never copied. `main.ts`
 * imports this module on the wall level only, after first paint, with the
 * rest of the data layer: no other level's bundle carries it. Market
 * watch's `quotes.ts` is its sibling, not its base: sharing code with it
 * would move market watch's bundle (`docs/DECISIONS.md`, "TanStack
 * contender").
 */

import { AT, HEADER, TICK, decimalsOf } from '../../../../../market/feed.ts';
import type { FeedStart } from '../../../../../market/worker.ts';
import { DESK_ROWS, wallInstruments } from '../../../../../wall/desks.ts';
import { WALL_INSTRUMENTS } from '../../../../../wall/instruments.ts';
import { SHOWN_RING } from '../../../../../contract.ts';
import type { TablesStop, WallScenario } from '../../../../../scenarios.ts';
import { resolveSizes } from '../density.ts';
import { layOutAll, padOf, type LaidOutColumn, type Sizes } from '../layout.ts';
import type { Tone } from '../market.ts';
import type { WallDesk, WallData } from '../wall.ts';
import { Flashes, noteFlashes } from './flash.ts';
import { shownText, type CellValue } from './format.ts';
import { invalidateRows, takeRefreshed, trackChanges } from './live.ts';
import { QuoteStore, type Quote } from './market.ts';
import { Advances, ColumnFormat, type NumberFormat, type NumberValue } from './number.ts';
import { PAGING, TablePaging, type PageSource } from './paging.ts';
import type { ArrowPage, Column, TablePage } from './table.ts';

/** The file's columns, in its order (`data/prep-wall.sql`, the file's one
 *  home): the open fails on any other. */
export const COLUMNS = ['Desk', 'Symbol', 'Last', 'Change %', 'Volume'] as const;
const [FILE_DESK, FILE_SYMBOL, FILE_LAST] = [0, 1, 2];
/** The file's columns a table draws, in order, each with its header as the
 *  design canvas writes it (`scene/wall.rs`'s `DRAWN`). */
const DRAWN: readonly (readonly [file: number, header: string])[] = [
  [1, 'Symbol'],
  [2, 'Last'],
  [3, 'Chg %'],
  [4, 'Volume'],
];
/** A table's columns. */
const [, LAST, CHANGE_PCT, VOLUME] = [0, 1, 2, 3];

/** Chg % by sign, as market watch's (`quotes.ts`'s `SIGN_DOMAIN`): a fall
 *  under -1e-9, a rise over it, a zero in the foreground. */
const SIGN_DOMAIN = 1e-9;

/** Each drawn column's format, as `scene/wall.rs`'s `columns` sets it. */
const FORMATS: ReadonlyMap<number, NumberFormat> = new Map([
  [LAST, { decimals: 2, sign: 'negative', grouping: false, suffix: '' }],
  [CHANGE_PCT, { decimals: 2, sign: 'always', grouping: false, suffix: '%' }],
  [VOLUME, { decimals: null, sign: 'negative', grouping: true, suffix: '' }],
]);

/** A quote's bytes as the GPUI side counts a page from its store (its
 *  `Quote`'s size, as market watch's `quotes.ts`): the cache's unit. */
const QUOTE_BYTES = 80;

/** The most tables a stop shows: a batch's visible mask is a bit a table. */
const MOST_TABLES = 8;

/** The file's columns are the wall's, a row per instrument; else why not. */
export function checkFile(columns: readonly Column[], rows: number): string | null {
  const names = columns.map((column) => column.name);
  if (names.join('\u0000') !== COLUMNS.join('\u0000')) return `its columns are ${JSON.stringify(names)}, not the wall's`;
  if (rows !== WALL_INSTRUMENTS.length) return `it has ${rows} rows, but the wall has ${WALL_INSTRUMENTS.length} instruments`;
  return null;
}

/** A page of a desk: the store's quotes for its rows (an array the store
 *  never changes: it makes a new one each batch). */
export class DeskPage implements TablePage {
  readonly length: number;
  readonly byteLength: number;
  /** Its first row's instrument. */
  private readonly first: number;
  private readonly quotes: readonly Quote[];

  constructor(quotes: readonly Quote[], first: number, end: number) {
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
      case 0: return quote.symbol;
      case LAST: return quote.last;
      case CHANGE_PCT: return quote.changePct;
      case VOLUME: return quote.volume;
      default: return undefined;
    }
  }
}

/** A table's source: its desk's rows of the store, every read in hand
 *  (`ready`), so a re-read lands in the plan that sent it, as the GPUI
 *  side's `DeskRows`. */
export class DeskSource implements PageSource<TablePage> {
  private readonly desk: number;
  private readonly store: QuoteStore;
  private next = -1;

  constructor(desk: number, store: QuoteStore) {
    this.desk = desk;
    this.store = store;
  }

  load([first, end]: readonly [number, number]): { request: number; result: Promise<TablePage>; ready: TablePage } {
    const base = this.desk * DESK_ROWS;
    const page = new DeskPage(this.store.rows, base + Math.min(first, DESK_ROWS), base + Math.min(end, DESK_ROWS));
    return { request: this.next--, result: Promise.resolve(page), ready: page };
  }

  /** A read in hand resolved as it was returned: nothing to cancel. */
  cancel(): void {}
}

/** The store over the open's read of the shown desks' rows: each row's
 *  Symbol, Desk, and Last. A row without them fails the open. */
export function seedStore(page: TablePage, rows: number): QuoteStore {
  const instruments = [];
  for (let row = 0; row < rows; row++) {
    const [desk, symbol, price] = [page.value(row, FILE_DESK), page.value(row, FILE_SYMBOL), page.value(row, FILE_LAST)];
    if (typeof desk !== 'string' || typeof symbol !== 'string' || typeof price !== 'number') throw new Error(`row ${row} has no Desk, Symbol, or Last price`);
    instruments.push({ symbol, name: desk, price });
  }
  return new QuoteStore(instruments);
}

/** Each of the format's characters' advance at the cells' font, as the
 *  browser measures it (the font loaded first), as market watch's. */
async function measureAdvances(font: string): Promise<{ advances: Advances; of: (text: string) => number }> {
  await document.fonts.load(font);
  const context = document.createElement('canvas').getContext('2d')!;
  context.font = font;
  const of = (ch: string) => context.measureText(ch).width;
  return { advances: new Advances(of), of: (text) => [...text].reduce((sum, ch) => Math.fround(sum + Math.fround(of(ch))), 0) };
}

/** The visible batches not yet drawn, at most: past it, the oldest is dropped. */
const PENDING = 256;

/**
 * With `?readout`: each visible batch's send → the frame at which every
 * table whose on-screen rows it ticked has drawn it, on
 * `__contender.shownIn` (`SHOWN_RING`'s layout), pooled across the tables
 * as `contender:refreshed` pairs them. Preallocated: the readout adds no
 * garbage to the feed's.
 */
export class WallRing {
  readonly samples = new Float64Array(1 + 2 * SHOWN_RING);
  private readonly sent = new Float64Array(PENDING);
  private readonly mask = new Uint8Array(PENDING);
  private readonly generations = new Float64Array(PENDING * MOST_TABLES);
  private head = 0;
  private tail = 0;

  /** A visible batch folded: sent at `sent` (epoch ms), drawn once every
   *  table in `mask` draws its generation in `generations`. */
  folded(sent: number, generations: readonly number[], mask: number): void {
    if (this.tail - this.head === PENDING) this.head++;
    const slot = this.tail++ % PENDING;
    this.sent[slot] = sent;
    this.mask[slot] = mask;
    for (let table = 0; table < MOST_TABLES; table++) this.generations[slot * MOST_TABLES + table] = generations[table] ?? 0;
  }

  /** A frame at `at` (epoch ms) has drawn each table's `drawn` generation:
   *  every batch it shows whole is a sample. */
  drawn(drawn: readonly number[], at: number): void {
    const samples = this.samples;
    while (this.head < this.tail) {
      const slot = this.head % PENDING;
      const mask = this.mask[slot]!;
      let shown = true;
      for (let table = 0; table < MOST_TABLES && shown; table++) if (mask & (1 << table) && (drawn[table] ?? 0) < this.generations[slot * MOST_TABLES + table]!) shown = false;
      if (!shown) return;
      this.head++;
      const count = samples[0]!;
      const sample = 1 + 2 * (count % SHOWN_RING);
      samples[sample] = at;
      samples[sample + 1] = at - this.sent[slot]!;
      samples[0] = count + 1;
    }
  }
}

/** The wall's tables and their feed, for the view and `main.ts`. */
export interface Wall extends WallData {
  /** Starts the feed once every table has filled (`main.ts`): the feed's
   *  worker (`contenders/market/worker.ts`, made here, so only the market
   *  and wall levels' builds carry it) over the stop's desks, its batches
   *  folded into the store. A refused batch, or the worker failing, calls
   *  `failed` and ends it. */
  startFeed(failed: (message: string) => void): void;
  /** Ends the feed and every table's reads (a reopen). */
  stop(): void;
}

/** The fold of one batch: each table's last invalidation's generation (0
 *  for none) and the bitmask of the tables whose on-screen rows it ticked. */
export interface Folded {
  seq: number;
  count: number;
  sent: number;
  generations: number[];
  visible: number;
}

/** Folds `bytes` into `store`, every tick or none, then invalidates each
 *  desk's ticked runs of rows in its paging (each re-read the store's, in
 *  hand); a batch that isn't one throws. */
export function foldBatch(store: QuoteStore, desks: readonly TablePaging<TablePage>[], bytes: ArrayBuffer): Folded {
  const batch = store.fold(bytes);
  const ticked = new Uint8Array(store.rows.length);
  const view = new DataView(bytes);
  for (let k = 0; k < batch.count; k++) ticked[view.getUint16(HEADER + k * TICK + AT.instrument, true)] = 1;
  const generations = desks.map(() => 0);
  let visible = 0;
  desks.forEach((paging, desk) => {
    const base = desk * DESK_ROWS;
    const [first, end] = paging.visible();
    for (let row = 0; row < DESK_ROWS; ) {
      if (!ticked[base + row]) {
        row++;
        continue;
      }
      const start = row;
      while (row < DESK_ROWS && ticked[base + row]) row++;
      generations[desk] = invalidateRows(paging, [start, row]);
      if (start < end && first < row) visible |= 1 << desk;
    }
  });
  return { seq: batch.seq, count: batch.count, sent: batch.sent, generations, visible };
}

/**
 * The wall at `stop` over the engine's `file` source (whose columns are
 * `file`): the shown desks' rows read once and the store seeded from them,
 * then a desk's paging, cells, and flash each, and the feed.
 */
export async function wallTables(scenario: WallScenario, stop: TablesStop, limit: number, engine: PageSource<ArrowPage>, file: readonly Column[], measured: boolean, readout: boolean): Promise<Wall> {
  const { tables } = stop;
  const shown = wallInstruments(tables);
  const { rowHeight, textSize, widths } = scenario.grid;
  const sizes: Sizes = resolveSizes({ rowHeight, text: { px: textSize } });
  const [{ advances, of }, store] = await Promise.all([
    measureAdvances(`${sizes.text}px "IBM Plex Sans"`),
    engine.load([0, shown.length]).result.then((page) => seedStore(page, shown.length)),
  ]);
  // Laid out once, here, at the grid's widths: every table draws these.
  const columns: LaidOutColumn[] = layOutAll(
    DRAWN.map(([at, header], index) => ({ name: header, kind: file[at]!.kind, type: file[at]!.type, width: widths[index] })),
    sizes,
  );
  const formats = columns.map((column, index) => {
    const format = FORMATS.get(index);
    return format ? new ColumnFormat(format, column.kind === 'float', of(format.suffix)) : null;
  });
  const decimals = shown.map(({ price }) => decimalsOf(price));
  // Market watch's flashing columns, by the file's names: those the wall draws.
  const flashing = DRAWN.flatMap(([at], index) => (scenario.flash.columns.includes(COLUMNS[at]!) ? [index] : []));
  const flashColumns = flashing.map((index) => ({ index, duration: scenario.flash.ms, float: columns[index]?.kind === 'float' }));
  const room = (column: LaidOutColumn) => Math.fround(Math.fround(column.width - 2 * padOf(sizes)) - 1);

  /** With `?measure`, each batch as folded (`__contender.batches`). */
  const batches: [seq: number, ticks: number, sent: number, generations: number[], visible: number][] | null = measured ? [] : null;
  const contender = (globalThis as { __contender?: { batches?: unknown; shownIn?: unknown } }).__contender;
  if (batches && contender) contender.batches = batches;
  /** Each table's highest generation drawn: `__contenderRefreshed` with `?measure`. */
  const drawn = new Array<number>(tables).fill(0);
  if (measured) (globalThis as { __contenderRefreshed?: number[] }).__contenderRefreshed = drawn;
  const ring = readout ? new WallRing() : null;
  if (ring && contender) contender.shownIn = ring.samples;

  const desks: WallDesk[] = Array.from({ length: tables }, (_, desk) => {
    const paging = new TablePaging<TablePage>(DESK_ROWS, new DeskSource(desk, store));
    const flashes = new Flashes();
    trackChanges(paging, flashing.length > 0);
    // A re-read landed: its changed cells in the flashing columns flash from now.
    paging.onLanded = (page, old, landed, rows) => {
      const now = performance.now();
      flashes.expire(now);
      noteFlashes(flashes, flashColumns, page * PAGING.pageRows, old, landed, rows.rows(), now);
    };
    const fitted = (index: number, column: LaidOutColumn, row: number, value: CellValue): { text: string; rounded: boolean } | null => {
      const format = formats[index];
      const number = format ? numberValue(column, value) : null;
      if (!format || !number) return null;
      const text = format.fit(advances, room(column), number, index === LAST ? (decimals[desk * DESK_ROWS + row] ?? null) : null);
      return text === null ? null : { text, rounded: format.rounded(text, number) };
    };
    return {
      desk,
      title: scenario.desks[desk] ?? '',
      sizes,
      paging,
      readout,
      flashing,
      columns,
      text: (index, column, row, value) => fitted(index, column, row, value)?.text ?? shownText(column.kind, value, column.budget),
      rounded: (index, column, row, value) => {
        const fit = fitted(index, column, row, value);
        return fit ? fit.rounded : null;
      },
      tone: (index, value) => (index === CHANGE_PCT ? sign(value) : null),
      flash: (row, column, now) => {
        const flash = flashes.at(row, column, now);
        return flash && { at: flash.at, start: flash.start };
      },
      quoteOf: (page, index) => (page instanceof DeskPage ? page.quote(index) : undefined),
      refreshed: () => {
        let raised = false;
        for (const { generation } of takeRefreshed(paging)) {
          if (generation > drawn[desk]!) {
            drawn[desk] = generation;
            raised = true;
          }
        }
        return raised ? drawn[desk]! : null;
      },
    };
  });
  const pagings = desks.map((desk) => desk.paging);

  let worker: Worker | null = null;
  const stopFeed = () => {
    if (!worker) return;
    worker.onmessage = worker.onerror = worker.onmessageerror = null;
    worker.terminate();
    worker = null;
  };

  return {
    desks,
    drawn,
    shown: (at) => ring?.drawn(drawn, at),
    startFeed: (failed) => {
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
        let folded: Folded;
        try {
          folded = foldBatch(store, pagings, data);
        } catch (error) {
          return fail(`a batch was refused: ${error instanceof Error ? error.message : String(error)}`);
        }
        batches?.push([folded.seq, folded.count, folded.sent, folded.generations, folded.visible]);
        if (folded.visible) ring?.folded(folded.sent, folded.generations, folded.visible);
      };
      worker.onerror = (event) => {
        event.preventDefault();
        fail(`worker failed: ${event.message ?? ''}`);
      };
      worker.onmessageerror = () => fail("batch couldn't be read");
      const start: FeedStart = { rate: scenario.rate * tables, seed: scenario.seed, limit, prices: shown.map(({ price }) => price) };
      worker.postMessage(start);
    },
    stop: () => {
      stopFeed();
      for (const paging of pagings) paging.close();
    },
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
