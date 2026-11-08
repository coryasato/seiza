/**
 * Live tail's paging (`src/data/follow.ts`, and `live`'s grown page), what
 * `paging.json`'s scenarios don't pin, as the table's own tests check it
 * (`pages.rs`, `state/fixtures/follow.rs`): a grown page's rows past its
 * read drawn as placeholders until its re-read lands (and what it reports
 * refreshed), the drawn tail's mark, `onFollowing`, a resize while
 * following keeping the bottom, a closed table's `setRows`, the pin telling
 * the view it moved, and a mostly sideways wheel leaving following.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { follow, isFollowing, noteTailDrawn, setRows, wheel } from '../src/data/follow.ts';
import { takeRefreshed } from '../src/data/live.ts';
import { PAGING, TablePaging, type Clock, type Page, type PageSource } from '../src/data/paging.ts';
import { asLevel } from './level.ts';

/** Each test here runs as live tail's level. */
const tailTest = (name: string, run: () => Promise<void> | void) => test(name, () => asLevel('tail', run));

const clock: Clock = { setTimeout: () => 0, clearTimeout: () => {} };
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

type Versioned = Page & { version: number };

/** A source whose reads answer when a test says, each page with the source's version then. */
class Source implements PageSource<Versioned> {
  reads: Array<{ page: number; request: number; resolve(page: Versioned): void }> = [];
  log: string[] = [];
  version = 0;
  /** Answer each read at once, in hand (`ready`), as market watch's store does. */
  inHand = false;
  private next = 0;

  load([start]: readonly [number, number]) {
    const page = Math.floor(start / PAGING.pageRows);
    const request = this.next++;
    this.log.push(`load ${page}`);
    if (this.inHand) {
      const answer = { byteLength: 100, version: this.version };
      return { request, result: Promise.resolve(answer), ready: answer };
    }
    const result = new Promise<Versioned>((resolve) => this.reads.push({ page, request, resolve }));
    return { request, result };
  }

  cancel(request: number): void {
    this.log.push(`cancel ${this.reads.find((read) => read.request === request)?.page ?? '?'}`);
  }

  /** Answers every open read, and those they start, until none is open. */
  async answerAll(): Promise<void> {
    while (this.reads.length) {
      this.reads.shift()!.resolve({ byteLength: 100, version: this.version });
      await flush();
    }
  }
}

/** A table over `rows` rows, every read answered, the log cleared. */
async function opened(source: Source, rows: number, viewportRows = 27.5): Promise<TablePaging<Versioned>> {
  const table = new TablePaging(rows, source, PAGING, clock);
  table.setViewportRows(viewportRows);
  await source.answerAll();
  source.log = [];
  return table;
}

const drawn = (table: TablePaging<Versioned>, row: number): number | 'pending' | 'failed' => {
  const state = table.row(row);
  return state.kind === 'loaded' ? state.page.version : state.kind;
};

tailTest('a grown page draws the rows it was read with, placeholders past them, until its re-read lands', async () => {
  const source = new Source();
  const table = await opened(source, 1500);
  follow(table);
  setRows(table, 1600);
  await flush();
  assert.deepEqual(source.log, ['load 1'], 'the grown page is read again');
  source.version = 1;
  assert.equal(drawn(table, 1499), 0, 'its old rows stay drawn');
  assert.equal(drawn(table, 1500), 'pending', 'its new rows are placeholders');
  assert.deepEqual(takeRefreshed(table), [], 'nothing refreshed yet');
  await source.answerAll();
  assert.equal(drawn(table, 1599), 1, 'the re-read holds the new rows');
  assert.equal(table.visible()[1], 1600, 'the pin moved on to them');
  assert.deepEqual(takeRefreshed(table), [{ rows: [1024, 1600], generation: 0 }], 'the re-read reported over its rows');
});

tailTest('a page grown during its re-read reports the rows it was read with, then the rest once read again', async () => {
  const source = new Source();
  const table = await opened(source, 1500);
  follow(table);
  setRows(table, 1600);
  await flush();
  setRows(table, 1700);
  await flush();
  assert.deepEqual(source.log, ['load 1'], 'one read out: the page is read once more after it lands');
  source.reads.shift()!.resolve({ byteLength: 100, version: 1 });
  await flush();
  assert.deepEqual(takeRefreshed(table), [{ rows: [1024, 1600], generation: 0 }]);
  assert.equal(drawn(table, 1600), 'pending', 'rows past its read wait for the next');
  assert.deepEqual(source.log, ['load 1', 'load 1']);
});

tailTest('the drawn tail marks only while following, as it grows, and again once following starts over', async () => {
  const source = new Source();
  const table = await opened(source, 1500);
  assert.equal(noteTailDrawn(table, 1500), false, 'not following');
  follow(table);
  assert.equal(noteTailDrawn(table, 1500), true);
  assert.equal(noteTailDrawn(table, 1500), false, 'the same tail');
  assert.equal(noteTailDrawn(table, 1600), true, 'grown');
  table.scrollBy(-1);
  assert.equal(noteTailDrawn(table, 1700), false, 'let go');
  table.scrollToFraction(1);
  assert.equal(isFollowing(table), true);
  assert.equal(noteTailDrawn(table, 1600), true, 'following again: the tail is marked again, grown or not');
  // Drawn through 1600; a shrink to 1200 forgets the tail past it, so rows
  // that come back past 1200 mark again (unclamped, 1300 wouldn't).
  setRows(table, 1200);
  await source.answerAll();
  assert.equal(noteTailDrawn(table, 1200), false, 'the tail at the new end is drawn');
  setRows(table, 1300);
  await source.answerAll();
  assert.equal(noteTailDrawn(table, 1300), true, 'grown back past the cut');
});

tailTest('onFollowing hears each change once', async () => {
  const source = new Source();
  const table = await opened(source, 1500);
  const heard: boolean[] = [];
  table.onFollowing = (following) => heard.push(following);
  follow(table);
  table.scrollBy(1);
  table.scrollBy(-1);
  table.scrollBy(-1);
  table.jumpTo(10_000);
  table.scrollToFraction(0);
  assert.deepEqual(heard, [true, false, true, false]);
});

tailTest('a resize while following keeps the bottom, then pins; otherwise it keeps the top', async () => {
  const source = new Source();
  const table = await opened(source, 1500);
  follow(table);
  await source.answerAll();
  table.setViewportRows(40);
  assert.deepEqual([table.top(), table.visible()[1]], [1460, 1500], 'the bottom kept at the tail');
  table.scrollBy(-100);
  const top = table.top();
  table.setViewportRows(20);
  assert.equal(table.top(), top, 'not following: the top kept');
});

tailTest("a closed table's setRows cancels and reads nothing", async () => {
  const source = new Source();
  const table = await opened(source, 3000);
  table.jumpTo(2500);
  table.close();
  source.log = [];
  setRows(table, 100);
  setRows(table, 5000);
  await flush();
  assert.deepEqual(source.log, []);
  assert.equal(table.rows, 5000, 'the rows still follow');
});

tailTest('the pin tells the view it moved, after a re-read lands in hand or by its promise', async () => {
  for (const inHand of [true, false]) {
    const source = new Source();
    const table = await opened(source, 1500);
    follow(table);
    // Where the view was at each change it heard.
    const heard: number[] = [];
    table.onChange = () => heard.push(table.visible()[1]);
    source.inHand = inHand;
    setRows(table, 1520);
    await flush();
    await source.answerAll();
    assert.equal(table.visible()[1], 1520, `in hand ${inHand}: the pin moved on`);
    assert.equal(heard.at(-1), 1520, `in hand ${inHand}: the view heard it there`);
  }
});

tailTest('a mostly sideways wheel moves the rows but leaves following; a vertical one lets go', async () => {
  const source = new Source();
  const table = await opened(source, 1500);
  follow(table);
  const top = table.top();
  wheel(table, -0.1, 100, 30);
  assert.equal(isFollowing(table), true, 'sideways with a little up: still following');
  assert.equal(table.top(), top - 0.1, 'the rows moved');
  wheel(table, -1, 10, 30);
  assert.equal(isFollowing(table), false, 'up: let go');
  wheel(table, 0, 100, 30);
  table.scrollToFraction(1);
  wheel(table, 0.1, 100, 30);
  assert.equal(isFollowing(table), true, 'sideways at the end leaves it on');
});
