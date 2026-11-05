/**
 * `live` on market watch's level (`src/data/live.ts`), what `paging.json`'s
 * scenarios don't pin, as the table's own tests check it (`pages.rs`,
 * `state.rs`): a source's refusal of a re-read, a re-read answered in hand
 * landing in the call that planned it, the refreshed generations, `close`
 * cancelling re-reads, and a page being read again never evicted.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { invalidateRows, takeRefreshed } from '../src/data/live.ts';
import { PageCache } from '../src/data/pages.ts';
import { PAGING, TablePaging, type Clock, type Page, type PageSource } from '../src/data/paging.ts';
import { asLevel } from './level.ts';

/** Each test here runs as the market level's. */
const marketTest = (name: string, run: () => Promise<void> | void) => test(name, () => asLevel('market', run));

const clock: Clock = { setTimeout: () => 0, clearTimeout: () => {} };
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

interface Read {
  page: number;
  request: number;
  resolve(page: Page): void;
  reject(error: Error): void;
}

/** A source whose reads answer when a test says, or (`inHand`) at once. */
class Source implements PageSource<Page & { version: number }> {
  reads: Read[] = [];
  log: string[] = [];
  version = 0;
  inHand = false;
  bytes = 100;
  private next = 0;

  load([start]: readonly [number, number]) {
    const page = Math.floor(start / PAGING.pageRows);
    const request = this.next++;
    this.log.push(`load ${page}`);
    if (this.inHand) {
      const answer = { byteLength: this.bytes, version: this.version };
      return { request, result: Promise.resolve(answer), ready: answer };
    }
    const result = new Promise<Page & { version: number }>((resolve, reject) => this.reads.push({ page, request, resolve: resolve as Read['resolve'], reject }));
    return { request, result };
  }

  cancel(request: number): void {
    this.log.push(`cancel ${this.reads.find((read) => read.request === request)?.page ?? '?'}`);
  }

  answer(page: number, error?: Error): void {
    const index = this.reads.findIndex((read) => read.page === page);
    const [read] = this.reads.splice(index, 1);
    if (error) read!.reject(error);
    else read!.resolve({ byteLength: this.bytes, version: this.version } as Page);
  }
}

/** A table over three pages' rows, its first page shown and every read answered. */
async function opened(source: Source, viewportRows = 27.5): Promise<TablePaging<Page & { version: number }>> {
  const table = new TablePaging(3 * PAGING.pageRows, source, PAGING, clock);
  table.setViewportRows(viewportRows);
  while (source.reads.length) {
    source.answer(source.reads[0]!.page);
    await flush();
  }
  source.log = [];
  return table;
}

const drawnVersion = (table: TablePaging<Page & { version: number }>, row: number): number | null => {
  const state = table.row(row);
  return state.kind === 'loaded' ? state.page.version : null;
};

marketTest("a source's refusal frees the re-read's place and keeps the page drawn, not read again until its rows change", async () => {
  const source = new Source();
  const table = await opened(source);
  invalidateRows(table, [0, 10]);
  await flush();
  assert.deepEqual(source.log.splice(0), ['load 0']);
  source.answer(0, new DOMException('refused', 'AbortError') as unknown as Error);
  await flush();
  assert.deepEqual(source.log.splice(0), [], 'not read again at once');
  assert.equal(drawnVersion(table, 0), 0, 'the old page drawn');
  assert.equal((table as unknown as { cache: PageCache<Page, number> }).cache.inFlight(), 0, 'its place freed');
  invalidateRows(table, [0, 10]);
  await flush();
  assert.deepEqual(source.log.splice(0), ['load 0'], 'read at the next invalidation');
});

marketTest('a re-read answered in hand lands in the plan that sent it, and the refreshed generation is its', async () => {
  const source = new Source();
  const table = await opened(source);
  source.inHand = true;
  source.version = 1;
  let changes = 0;
  table.onChange = () => changes++;
  const generation = invalidateRows(table, [0, 10]);
  assert.equal(drawnVersion(table, 0), 0, 'planned at the end of the task, not in the call');
  await Promise.resolve();
  assert.equal(drawnVersion(table, 0), 1, 'landed in the microtask that planned it');
  assert.equal(changes, 1);
  assert.deepEqual(takeRefreshed(table), [{ rows: [0, PAGING.pageRows], generation }]);
  assert.deepEqual(takeRefreshed(table), [], 'once');
  // Two invalidations in one task: one plan, one read.
  source.log = [];
  invalidateRows(table, [0, 1]);
  const second = invalidateRows(table, [5, 6]);
  await Promise.resolve();
  assert.deepEqual(source.log, ['load 0']);
  assert.deepEqual(takeRefreshed(table), [{ rows: [0, PAGING.pageRows], generation: second }]);
});

marketTest('a page re-read off screen reports nothing refreshed', async () => {
  const source = new Source();
  const table = await opened(source);
  source.inHand = true;
  // Page 1 is prefetch: wanted, loaded, off screen.
  invalidateRows(table, [PAGING.pageRows, PAGING.pageRows + 1]);
  await Promise.resolve();
  assert.deepEqual(source.log, ['load 1']);
  assert.deepEqual(takeRefreshed(table), []);
});

marketTest('close cancels the re-reads out', async () => {
  const source = new Source();
  const table = await opened(source);
  invalidateRows(table, [0, 10]);
  await flush();
  assert.deepEqual(source.log.splice(0), ['load 0']);
  table.close();
  assert.deepEqual(source.log, ['cancel 0']);
});

marketTest('a page being read again is never evicted', () => {
  // A budget for one page: page 1 landing evicts the least recently used
  // page outside `wanted`, unless it's being read again.
  for (const rereading of [true, false]) {
    const cache = new PageCache<string, number>(3 * 1024, 1024, 150, 3);
    cache.started(0, 0);
    cache.loaded(0, 0, 'page 0', 100, [0]);
    if (rereading) cache.started(0, 1);
    cache.started(1, 2);
    cache.loaded(1, 2, 'page 1', 100, [1]);
    assert.equal(cache.row(0).kind, rereading ? 'loaded' : 'pending', rereading ? 'kept while read again' : 'evicted (the control)');
  }
});

marketTest("a drag rests at its own settle, never the scroll's", async () => {
  // Timers that fire only when the test moves time.
  let now = 0;
  const timers = new Map<number, { at: number; run: () => void }>();
  let next = 0;
  const scripted: Clock = {
    setTimeout: (run, ms) => (timers.set(++next, { at: now + ms, run }), next),
    clearTimeout: (handle) => void timers.delete(handle),
  };
  const advance = (ms: number) => {
    now += ms;
    for (const [handle, timer] of [...timers].sort(([, a], [, b]) => a.at - b.at))
      if (timer.at <= now) {
        timers.delete(handle);
        timer.run();
      }
  };
  const source = new Source();
  const table = new TablePaging(3 * PAGING.pageRows, source, { ...PAGING, scrollSettleMs: 10, dragSettleMs: 80 }, scripted);
  table.setViewportRows(27.5);
  while (source.reads.length) {
    source.answer(source.reads[0]!.page);
    await flush();
  }
  source.log = [];
  table.startDrag();
  table.moveTopTo(10);
  advance(10);
  await flush();
  assert.deepEqual(source.log.splice(0), [], 'the scroll settled: the drag still moves');
  invalidateRows(table, [0, 10]);
  await flush();
  assert.deepEqual(source.log.splice(0), [], 'no re-read until the drag rests');
  advance(70);
  await flush();
  assert.deepEqual(source.log.splice(0), ['load 0'], "the drag's settle: rested, the re-read goes");
});
