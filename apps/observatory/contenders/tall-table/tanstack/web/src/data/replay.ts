/**
 * Live tail's level in the data layer, the GPUI contender's `scene/tail.rs`
 * and `clock.rs` on the DOM side: the log's file checked at the open (its
 * four columns, the replay's rows), every page read through the replay's
 * page SQL over the file fetched whole (`tail.ts`'s `tailSql`, the same
 * text as the GPUI side's), the cells as the design canvas writes them (the
 * time as the log wrote it, `timeText`; an error status, 4xx and 5xx; the
 * bytes grouped, `number.ts`'s format at the cells' advances), and the
 * replay's path: once the table is open (at 0 rows, following), the file
 * fetched whole and registered as `WHOLE_FILE` (once a page), and only then
 * the clock's worker started at the stop's rate, each count set on the
 * paging (`follow.ts`'s `setRows`) in its message's task. The view draws
 * what `TailCells` answers (`tail.ts`, beside `view.ts`).
 *
 * Every setting is the scenario's (`scenarios.ts`) or the replay's
 * (`contenders/tail/`), read here, never copied. `main.ts` imports this
 * module on the tail level only, after first paint, with the rest of the
 * data layer: no other level's bundle carries it, nor the worker it makes.
 */

import type { Bridge } from '@seiza/duckdb/bridge';
import { DATA } from '../../../../../paths.ts';
import { DATA_FILE, FILE_ROWS, WHOLE_FILE } from '../../../../../tail/data.ts';
import type { TailRows, TailStart } from '../../../../../tail/worker.ts';
import type { RowsStop, TailScenario } from '../../../../../scenarios.ts';
import { BASE_SIZES, layOutAll, padOf, type LaidOutColumn } from '../layout.ts';
import type { TailCells } from '../tail.ts';
import { follow, setRows } from './follow.ts';
import { shownText, type CellValue } from './format.ts';
import { Advances, ColumnFormat } from './number.ts';
import type { PageSource, TablePaging } from './paging.ts';
import { tailSql, timeText } from './tail.ts';
import { ArrowPage, type Column, type Queries, type TablePage } from './table.ts';

/** The table's columns, in the file's order (`data/prep-nasa.sql`, the
 *  file's one home; the GPUI side's `COLUMNS`): the open fails on any other. */
export const COLUMNS = ['time', 'request', 'status', 'bytes'] as const;
const [TIME, , STATUS, BYTES] = [0, 1, 2, 3] as const;
/** The first status drawn as an error. */
const ERROR_FROM = 400;

/** The file's columns are the log's and its rows the replay's (where every
 *  lap's seam falls); else why not. */
export function checkFile(columns: readonly Column[], rows: number): string | null {
  const names = columns.map((column) => column.name);
  if (names.join('\u0000') !== COLUMNS.join('\u0000')) return `its columns are ${JSON.stringify(names)}, not live tail's`;
  if (rows !== FILE_ROWS) return `it has ${rows} rows, but the replay's laps are ${FILE_ROWS}`;
  return null;
}

/** The replay's rows, a page at a time, through the page SQL over the file
 *  fetched whole (`WHOLE_FILE`): row i the file's row i mod n, its time
 *  moved on by its laps. */
export const tailSource = (queries: Queries): PageSource<TablePage> => ({
  load: ([start, end]) => {
    const { request, result } = queries.send(tailSql(start, end));
    return { request, result: result.then((bytes) => new ArrowPage(bytes)) };
  },
  cancel: (request) => queries.cancel(request),
});

/** The cells' font, as `view.css` sets it: what the format measures with. */
const CELL_FONT = '14px "IBM Plex Sans"';

/** Each of the format's characters' advance at the cells' font, as the
 *  browser measures it (the font loaded first), as `quotes.ts` measures
 *  them: a copy, since exporting its own changes market watch's chunk. */
async function measureAdvances(): Promise<Advances> {
  await document.fonts.load(CELL_FONT);
  const context = document.createElement('canvas').getContext('2d')!;
  context.font = CELL_FONT;
  return new Advances((ch) => context.measureText(ch).width);
}

/** The data file in one request, as the `File` the engine registers. */
async function fetchWhole(): Promise<File> {
  const response = await fetch(`${DATA}${DATA_FILE}`);
  if (!response.ok) throw new Error(`${DATA_FILE}: ${response.status}`);
  return new File([await response.blob()], WHOLE_FILE);
}

/** Where the file fetched whole is: once registered, every replay's pages
 *  read it (a reopen doesn't fetch it again). */
let whole: Promise<void> | null = null;

/** The scene's cells for the view, and the replay's path into the paging. */
export interface Tail extends TailCells {
  /** The table is open: fetches the file whole and registers it (once a
   *  page), then starts the clock's worker at the stop's rate. Any of that
   *  failing, or the worker failing later, calls `failed` and ends it. */
  watch(failed: (message: string) => void): void;
  /** Ends the clock (a reopen starts the replay over, or the view failed). */
  stop(): void;
}

/** Live tail's table over `paging` (at 0 rows, following once this
 *  returns), its `file` columns laid out at the scenario's widths. */
export async function tailTable(scenario: TailScenario, stop: RowsStop, paging: TablePaging<TablePage>, file: readonly Column[], bridge: Bridge, measured: boolean): Promise<Tail> {
  const advances = await measureAdvances();
  // The canvas's widths, set as the GPUI side's `density` sets them.
  const columns = layOutAll(file.map((column, index) => ({ ...column, width: scenario.widths[index] })));
  const bytesFormat = new ColumnFormat({ decimals: null, sign: 'negative', grouping: true, suffix: '' }, false, 0);
  /** The bytes' fitted text, or null for the automatic format's. */
  const bytesText = (column: LaidOutColumn, value: CellValue): string | null => {
    if (typeof value !== 'number' && typeof value !== 'bigint') return null;
    const room = Math.fround(Math.fround(column.width - 2 * padOf(BASE_SIZES)) - 1);
    return bytesFormat.fit(advances, room, { kind: 'text', value: String(value) }, null);
  };

  // A replay starts with no rows, following: the clock grows them.
  setRows(paging, 0);
  follow(paging);

  let worker: Worker | null = null;
  /** With `?measure`, each count as the clock posted it (`__contender.batches`). */
  const batches: TailRows[] | null = measured ? [] : null;
  if (batches) (globalThis as { __contender?: { batches?: unknown } }).__contender!.batches = batches;
  let paused = false;
  let ended = false;
  const cells: Tail = {
    columns,
    rows: () => {},
    following: () => {},
    text: (index, column, value) => {
      if (value === null) return 'NULL';
      if (index === TIME && typeof value === 'number') return timeText(value);
      if (index === BYTES) return bytesText(column, value) ?? shownText(column.kind, value, column.budget);
      return shownText(column.kind, value, column.budget);
    },
    muted: (index) => index === TIME,
    error: (index, value) => index === STATUS && (typeof value === 'number' || typeof value === 'bigint') && Number(value) >= ERROR_FROM,
    pause: (on) => {
      paused = on;
      worker?.postMessage({ pause: on });
    },
    watch: (failed) => {
      /** Why the clock can't go on: before its start message is sent, it
       *  didn't start; after, it stopped. */
      let started = false;
      const fail = (message: string) => {
        if (ended) return;
        cells.stop();
        failed(started ? `The clock stopped: ${message}` : `The clock didn't start: ${message}`);
      };
      if (!whole) {
        const registering = (async () => {
          const file = await fetchWhole().catch((error: unknown) => {
            throw new Error(`the file wasn't fetched whole: ${message(error)}`);
          });
          await bridge.registerFile(WHOLE_FILE, file).catch((error: unknown) => {
            throw new Error(`the file wasn't registered: ${message(error)}`);
          });
        })();
        // A failure is tried again by the next table.
        registering.catch(() => {
          if (whole === registering) whole = null;
        });
        whole = registering;
      }
      whole.then(
        () => {
          if (ended) return;
          try {
            worker = new Worker(new URL('../../../../../tail/worker.ts', import.meta.url), { type: 'module' });
          } catch (error) {
            return fail(`its worker wasn't made: ${message(error)}`);
          }
          worker.onmessage = ({ data }: MessageEvent<TailRows>) => {
            const [rows, at] = Array.isArray(data) ? data : [];
            if (typeof rows !== 'number' || typeof at !== 'number') return fail('the clock sent something other than [rows, at]');
            batches?.push([rows, at]);
            setRows(paging, rows);
            cells.rows();
          };
          worker.onerror = (event) => {
            event.preventDefault();
            fail(`its worker failed: ${event.message ?? ''}`);
          };
          worker.onmessageerror = () => fail("its count couldn't be read");
          const start: TailStart = { rate: stop.rate };
          worker.postMessage(start);
          started = true;
          // A pause asked before the worker existed holds from its start.
          if (paused) worker.postMessage({ pause: true });
        },
        (error: unknown) => fail(message(error)),
      );
    },
    stop: () => {
      ended = true;
      if (!worker) return;
      worker.onmessage = worker.onerror = worker.onmessageerror = null;
      worker.terminate();
      worker = null;
    },
  };
  paging.onFollowing = (on) => cells.following(on);
  return cells;
}

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));
