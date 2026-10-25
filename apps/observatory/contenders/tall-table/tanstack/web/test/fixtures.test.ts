/**
 * The tall table's fixtures (`components/tall-table/fixtures/`; its README
 * says what each holds), run against the TanStack contender's data layer,
 * as the component's native tests run them against the table
 * (`src/state/fixtures.rs`, and the engine's `sql_fixture`). Paging
 * scenarios drive `TablePaging` on a script's clock, so the settle times
 * are its own timers; the source answers a read only when the scenario
 * says. Each fixture has negative controls, which must fail it.
 *
 * Run: `node --test` here (`just observatory tanstack-test`).
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { tableFromArrays, tableToIPC } from 'apache-arrow';
import type { Bridge } from '@seiza/duckdb/bridge';
import { exactText, shownText } from '../src/data/format.ts';
import { PAGING, TablePaging, type Clock, type Page, type PageSource, type Paging } from '../src/data/paging.ts';
import { ArrowPage, Queries, openParquet } from '../src/data/table.ts';
import { pageSql } from '../src/data/sql.ts';

const fixtures = new URL('../../../../../../../components/tall-table/fixtures/', import.meta.url);
const fixture = (name: string): any => JSON.parse(readFileSync(new URL(name, fixtures), 'utf8'));

/** Lets every settled read's answer run, and the reads it starts. */
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

/** Everything that can run at this instant runs: answers land, and timers
 *  already due fire (a 0 ms settle, as GPUI's test executor runs one once
 *  the step's work parks). */
async function settle(clock: ScriptClock): Promise<void> {
  await flush();
  clock.advance(0);
  await flush();
}

// --- paging ---

/** Timers that fire only when a step says time passes. */
class ScriptClock implements Clock {
  private now = 0;
  private seq = 0;
  private timers = new Map<number, { at: number; run: () => void }>();

  setTimeout(run: () => void, ms: number): number {
    const handle = ++this.seq;
    this.timers.set(handle, { at: this.now + ms, run });
    return handle;
  }

  clearTimeout(handle: number): void {
    this.timers.delete(handle);
  }

  /** Fires every timer due within `ms`, earliest first (the first set, at a tie). */
  advance(ms: number): void {
    const until = this.now + ms;
    for (;;) {
      let next: [number, { at: number; run: () => void }] | undefined;
      for (const entry of this.timers) if (entry[1].at <= until && (!next || entry[1].at < next[1].at)) next = entry;
      if (!next) break;
      this.timers.delete(next[0]);
      this.now = next[1].at;
      next[1].run();
    }
    this.now = until;
  }
}

interface Read {
  page: number;
  request: number;
  cancelled: boolean;
  resolve: (page: Page) => void;
  reject: (error: Error) => void;
}

/** A source whose reads answer only when the scenario says, logging what
 *  the table asked for (`load <page>`, `cancel <page>`). */
class ScriptSource implements PageSource<Page> {
  log: string[] = [];
  open: Read[] = [];
  private next = 0;
  private readonly paging: Paging;
  private readonly rows: number;

  constructor(paging: Paging, rows: number) {
    this.paging = paging;
    this.rows = rows;
  }

  load([start, end]: readonly [number, number]) {
    const page = Math.floor(start / this.paging.pageRows);
    const first = page * this.paging.pageRows;
    assert.deepEqual([start, end], [first, Math.min(first + this.paging.pageRows, this.rows)], `page ${page}'s rows`);
    const request = this.next++;
    this.log.push(`load ${page}`);
    const result = new Promise<Page>((resolve, reject) => this.open.push({ page, request, cancelled: false, resolve, reject }));
    return { request, result };
  }

  cancel(request: number): void {
    const read = this.open.find((open) => open.request === request);
    assert.ok(read, 'a cancel names an open read');
    read.cancelled = true;
    this.log.push(`cancel ${read.page}`);
  }

  /** Answers the oldest open read (of `page`, if given): a cancelled read
   *  as cancelled, the rest with a page or a failure. Whether there was one. */
  answer(page: number | null, fail: boolean, bytes: number): boolean {
    const index = this.open.findIndex((read) => page === null || read.page === page);
    if (index < 0) return false;
    const [read] = this.open.splice(index, 1);
    if (read!.cancelled) read!.reject(new DOMException('Query cancelled', 'AbortError'));
    else if (fail) read!.reject(new Error('the fixture failed it'));
    else read!.resolve({ byteLength: bytes });
    return true;
  }
}

/** `paging.json`'s field names, as `Paging`'s. */
const FIELDS: Record<string, keyof Paging> = {
  page_rows: 'pageRows',
  prefetch: 'prefetch',
  budget_bytes: 'budgetBytes',
  max_in_flight: 'maxInFlight',
  scroll_settle_ms: 'scrollSettleMs',
  drag_settle_ms: 'dragSettleMs',
};

/** `paging` with a fixture's or a control's fields over it. A key it
 *  doesn't know is an error: a misspelt control would change nothing. */
function pagingWith(paging: Paging, fields: Record<string, number>): Paging {
  const changed = { ...paging };
  for (const [key, value] of Object.entries(fields)) {
    const field = FIELDS[key];
    assert.ok(field, `unknown paging field ${key}`);
    changed[field] = value;
  }
  return changed;
}

/** Cancels from one decision are a set: each run of them in page order,
 *  as the fixture writes it (and as the native test sorts them). */
function normalized(log: string[]): string[] {
  const page = (event: string) => Number(event.slice(7));
  let start = 0;
  while (start < log.length) {
    let end = start;
    while (end < log.length && log[end]!.startsWith('cancel ')) end++;
    log.splice(start, end - start, ...log.slice(start, end).sort((a, b) => page(a) - page(b)));
    start = end + 1;
  }
  return log;
}

/** One scenario under `paging`: the first step whose requests weren't the
 *  expected ones, or null. */
async function runScenario(paging: Paging, scenario: any): Promise<string | null> {
  const source = new ScriptSource(paging, scenario.rows);
  const clock = new ScriptClock();
  let table: TablePaging<Page> | null = null;
  const on = () => {
    assert.ok(table, 'the table is open');
    return table;
  };
  for (const [index, step] of (scenario.steps as any[]).entries()) {
    const action = Object.keys(step).find((key) => key !== 'expect' && key !== 'why')!;
    const argument = step[action];
    switch (action) {
      case 'open':
        table = new TablePaging(scenario.rows, source, paging, clock);
        table.setViewportRows(scenario.viewport_rows);
        break;
      case 'scroll':
        on().scrollBy(argument);
        break;
      case 'jump':
        on().jumpTo(argument);
        break;
      case 'fraction':
        on().scrollToFraction(argument);
        break;
      // The thumb dragged (or a track pressed) to the fraction.
      case 'drag':
        on().startDrag();
        on().scrollToFraction(argument);
        break;
      case 'release':
        on().endDrag();
        break;
      case 'wait':
        clock.advance(argument);
        break;
      case 'answer':
      case 'fail': {
        const fail = action === 'fail';
        if (Array.isArray(argument)) {
          for (const page of argument as number[]) {
            if (!source.answer(page, fail, scenario.page_bytes)) return `${scenario.name}, step ${index}: no read of page ${page} is open`;
            await settle(clock);
          }
        } else {
          while (source.answer(null, fail, scenario.page_bytes)) await settle(clock);
        }
        break;
      }
      default:
        throw new Error(`${scenario.name}: unknown step ${action}`);
    }
    await settle(clock);
    const actual = normalized(source.log.splice(0));
    if (JSON.stringify(actual) !== JSON.stringify(step.expect)) {
      return `${scenario.name}, step ${index} (${action} ${JSON.stringify(argument)}): expected ${JSON.stringify(step.expect)}, got ${JSON.stringify(actual)}`;
    }
  }
  return null;
}

describe('paging.json', () => {
  const paging = fixture('paging.json');
  // The contender builds the table's base level: no scenario or control of
  // a feature (`features`, a `live` control) applies to it yet.
  const scenarios = (paging.scenarios as any[]).filter((scenario) => !scenario.features?.length);
  const controls = (paging.controls as any[]).filter((control) => control.paging);

  test('its paging is the contender’s, every field', () => {
    assert.deepEqual(Object.keys(paging.paging).sort(), Object.keys(FIELDS).sort());
    assert.deepEqual(pagingWith(PAGING, paging.paging), PAGING);
  });

  test('every scenario', async () => {
    const failures: string[] = [];
    for (const scenario of scenarios) {
      const failure = await runScenario(PAGING, scenario);
      if (failure) failures.push(failure);
    }
    assert.deepEqual(failures, []);
  });

  test('every control fails a scenario', async () => {
    for (const control of controls) {
      const changed = pagingWith(PAGING, control.paging);
      assert.notDeepEqual(changed, PAGING, `control ${control.name} changes the paging`);
      let failed = 0;
      for (const scenario of scenarios) if (await runScenario(changed, scenario)) failed++;
      assert.ok(failed > 0, `control ${control.name} passed every scenario`);
    }
  });
});

// --- cells ---

/** The fixture's cells whose text `shown` (the column, the value) or
 *  `exact` (the value) doesn't give, at each column's budget plus `skew`. */
function cellMismatches(skew: number, exact: (value: number) => string): string[] {
  const cells = fixture('cells.json');
  const budgets = new Map<string, number>();
  for (const column of cells.columns) {
    assert.equal(column.kind, 'float', "the fixture's columns are floats");
    budgets.set(column.name, Math.max(1, column.budget + skew));
  }
  const mismatches: string[] = [];
  for (const cell of [...cells.cells, ...cells.rounding]) {
    const budget = budgets.get(cell.column);
    assert.ok(budget, "the cell's column is listed");
    const value = cell.value === null ? null : Number(cell.value);
    const exactText = value === null ? 'NULL' : exact(value);
    const shown = shownText('float', value, budget);
    if (exactText !== cell.exact || shown !== cell.shown) {
      mismatches.push(`${cell.column} ${cell.value}: exact ${exactText}, shown ${shown}; the fixture's ${cell.exact} ${cell.shown}`);
    }
  }
  return mismatches;
}

describe('cells.json', () => {
  test('every cell’s exact and shown text', () => {
    assert.deepEqual(cellMismatches(0, exactText), []);
  });

  test('controls fail', () => {
    // JS's own text (`8` for 8.0, `1e+21`) isn't the table's.
    assert.notDeepEqual(cellMismatches(0, String), [], "String's text passed the cell fixture");
    // A character more or less of room rounds differently.
    for (const skew of [-1, 1]) assert.notDeepEqual(cellMismatches(skew, exactText), [], `a budget ${skew} passed the cell fixture`);
  });
});

// --- sql ---

/** A bridge that answers DuckDB's summary queries for a file of 1,567,523
 *  rows and logs what it was sent. */
function scriptBridge(sent: string[]): Bridge {
  const describe = tableToIPC(tableFromArrays({ column_name: ['spkid'], column_type: ['BIGINT'] }), 'stream');
  const metadata = tableToIPC(tableFromArrays({ num_rows: BigInt64Array.from([1_567_523n]), num_row_groups: BigInt64Array.from([52n]) }), 'stream');
  return {
    registerFile: async (name) => ({ name, size: null, bytesRead: null }),
    query: async (sql) => {
      sent.push(sql);
      return sql.startsWith('DESCRIBE') ? describe : metadata;
    },
    cancel: () => {},
  };
}

/** The fixture's queries that `page` (a page's SQL) and the open don't send. */
async function sqlMismatches(page: (file: string, start: number, end: number) => string): Promise<string[]> {
  const sql = fixture('sql.json');
  const mismatches: string[] = [];
  for (const { rows, sql: expected } of sql.pages) {
    const actual = page(sql.file, rows[0], rows[1]);
    if (actual !== expected) mismatches.push(`page ${rows}: ${actual}`);
  }
  const sent: string[] = [];
  const bridge = scriptBridge(sent);
  const opened = await openParquet(bridge, new Queries(bridge), Promise.resolve(), sql.file, '/data/asteroids.parquet');
  assert.equal(opened.rows, 1_567_523);
  if (JSON.stringify(sent) !== JSON.stringify(sql.summary)) mismatches.push(`summary: ${JSON.stringify(sent)}`);
  return mismatches;
}

describe('sql.json', () => {
  test('the page and summary queries', async () => {
    assert.deepEqual(await sqlMismatches(pageSql), []);
  });

  test('controls fail', async () => {
    for (const control of fixture('sql.json').controls) {
      const page = (file: string, start: number, end: number) => (start === control.rows[0] && end === control.rows[1] ? control.sql : pageSql(file, start, end));
      assert.notDeepEqual(await sqlMismatches(page), [], `control ${control.name} passed the SQL fixture`);
    }
  });
});

// --- the cache's bytes ---

test('the cache counts each page’s Arrow IPC bytes', async () => {
  const pages = [10, 1024].map((rows) => tableToIPC(tableFromArrays({ x: Float64Array.from({ length: rows }, (_, i) => i / 3) }), 'stream'));
  for (const bytes of pages) assert.equal(new ArrowPage(bytes).byteLength, bytes.byteLength);
  // Two pages through the paging: its bytes are theirs, summed.
  let next = 0;
  const source: PageSource<ArrowPage> = {
    load: () => ({ request: next, result: Promise.resolve(new ArrowPage(pages[next++ % 2]!)) }),
    cancel: () => {},
  };
  const table = new TablePaging(2048, source, { ...PAGING, prefetch: 0 }, new ScriptClock());
  table.setViewportRows(1500);
  await flush();
  assert.equal(table.cacheBytes(), pages[0]!.byteLength + pages[1]!.byteLength);
});

test('an open without a row count fails, naming it', async () => {
  const describe = tableToIPC(tableFromArrays({ column_name: ['spkid'], column_type: ['BIGINT'] }), 'stream');
  const metadata = tableToIPC(tableFromArrays({ rows: BigInt64Array.from([1n]), num_row_groups: BigInt64Array.from([1n]) }), 'stream');
  const bridge: Bridge = {
    registerFile: async (name) => ({ name, size: null, bytesRead: null }),
    query: async (sql) => (sql.startsWith('DESCRIBE') ? describe : metadata),
    cancel: () => {},
  };
  await assert.rejects(openParquet(bridge, new Queries(bridge), Promise.resolve(), 'a.parquet', '/a.parquet'), /no count in num_rows/);
});
