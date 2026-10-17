// The GPUI contender on its release build: it opens the data file, reaches
// the last row, and publishes the contender contract
// (docs/contender-contract.md). Chromium, the protocol's page (1440×900, DPR 2).
//
// Checks:
// - Reach: `count(*)` and the last row's key (spkid, in file order) from
//   native DuckDB (data/'s, `just observatory data`), independent of the
//   page's engine. With `?measure`: `state.rows` is the count; End shows the
//   last row, filled, with `lastCell` its key.
// - Marks: first-pixels (the placeholder's paint) ≤ usable (the first
//   frame's moment) ≤ open < filled; the first filled after the open and
//   after End lands right after a presented frame (shared-web/perf/'s
//   `presentedMark`).
// - State and targets only with `?measure`: `table`, `table-scroll-track`,
//   and `table-scroll-thumb` inside the viewport; without it, `state` is
//   null, no targets, the marks still set. The drawn cells and the columns
//   only with `?cells` (perf/cell-fixture.ts), so never in a measured run.
// - The replay hooks: `jump(0.9)` lands at 90% and fills (and again, onto
//   rows already loaded, resolves at once), `open()` marks a new open and fills, `fling()` ends at the last row.
// - The relay: framed in a same-origin page, each contract mark reaches the
//   parent by `postMessage`, its `at` the mark's epoch time.
//
// Usage: node apps/observatory/perf/reach.ts [--label <name>]
// --label writes perf/results/<date>-<label>.json. Needs `just observatory
// data`; run `just observatory gpui-build` first.

import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, type Page } from '@playwright/test';
import { presentedMark, presentingTaskRecorder, waitMark } from '../../../shared-web/perf/harness.ts';
import { machineInfo, option } from '../../../shared-web/perf/protocol.ts';
import { MARKS, dataFile, lastMark, perfDir, problems, protocolContext, serveGpui } from './harness.ts';

const PORT = 4314;
const label = option('label');
const failures: string[] = [];
const output: Record<string, unknown> = { date: new Date().toISOString().slice(0, 10), label, ...machineInfo() };
const check = (ok: boolean, problem: string) => {
  if (!ok) failures.push(problem);
  return ok;
};

// --- the file's facts, from native DuckDB ---

interface NativeDuckDB {
  DuckDBInstance: { create(path: string): Promise<{ connect(): Promise<{ runAndReadAll(sql: string): Promise<{ getRows(): unknown[][] }> }> }> };
}
const require = createRequire(new URL('../data/package.json', import.meta.url));
let native: NativeDuckDB;
try {
  native = (await import(pathToFileURL(require.resolve('@duckdb/node-api')).href)) as NativeDuckDB;
} catch {
  throw new Error("native DuckDB isn't installed: run `just observatory data`");
}
const conn = await (await native.DuckDBInstance.create(':memory:')).connect();
const file = `'${dataFile.replaceAll("'", "''")}'`;
const value = async (sql: string) => String((await conn.runAndReadAll(sql)).getRows()[0]?.[0]);
const count = Number(await value(`SELECT count(*) FROM read_parquet(${file})`));
const lastKey = await value(`SELECT spkid FROM read_parquet(${file}, file_row_number = true) WHERE file_row_number = ${count - 1}`);
output.file = { count, lastKey };
console.log(`native DuckDB: count(*) ${count}, last spkid ${lastKey}`);

// --- the page ---

interface State {
  rows: number;
  top: number;
  first: number;
  end: number;
  loaded: number;
  pending: number;
  lastCell: string | null;
  cacheBytes: number;
}
type Global = { __contender?: { side: string; state: State | null; replay: Record<string, unknown>; cells?: unknown; columns?: unknown }; __seizaTargets?: Record<string, number[]> };

const now = (page: Page) => page.evaluate(() => performance.now());
const filledState = (page: Page, test: string) =>
  page
    .waitForFunction(
      (test) => {
        const s = (globalThis as Global).__contender?.state;
        return s && s.end > s.first && s.loaded === s.end - s.first && new Function('s', `return ${test}`)(s) ? s : false;
      },
      test,
      { timeout: 60_000, polling: 20 },
    )
    .then(async (handle) => (await handle.jsonValue()) as State);

const server = await serveGpui(PORT);
const browser = await chromium.launch({ channel: 'chromium' });
try {
  // Measured: reach, marks, state, targets, replay.
  {
    const context = await protocolContext(browser, { init: [presentingTaskRecorder] });
    const page = await context.newPage();
    const found = problems(page);
    await page.goto(`${server.url}?measure`);
    const filled = await waitMark(page, MARKS.filled, 0);
    await page.waitForTimeout(100);
    const marks = Object.fromEntries(await Promise.all([MARKS.placeholder, MARKS.firstPixels, MARKS.firstFrame, MARKS.usable, MARKS.open].map(async (name) => [name, await lastMark(page, name)] as const)));
    const [firstPixels, usable, open] = [marks[MARKS.firstPixels] ?? null, marks[MARKS.usable] ?? null, marks[MARKS.open] ?? null];
    check(firstPixels !== null && firstPixels === marks[MARKS.placeholder], `first-pixels ${firstPixels} isn't the placeholder's paint (${marks[MARKS.placeholder]})`);
    check(usable !== null && usable === marks[MARKS.firstFrame], `usable ${usable} isn't the first frame (${marks[MARKS.firstFrame]})`);
    check(firstPixels !== null && usable !== null && open !== null && firstPixels <= usable && usable <= open && open < filled, `marks out of order: first-pixels ${firstPixels}, usable ${usable}, open ${open}, filled ${filled}`);
    const presented = await presentedMark(page, filled);
    check(presented.ok, `the first filled mark isn't right after a presented frame: ${presented.detail}`);
    const opened = await filledState(page, 's.first === 0');
    check(opened.rows === count, `state.rows ${opened.rows}, count(*) ${count}`);
    check(opened.cacheBytes > 0, `state.cacheBytes ${opened.cacheBytes} with rows loaded`);
    const cellProbe = await page.evaluate(() => ['cells', 'columns'].some((key) => key in ((globalThis as Global).__contender ?? {})));
    check(!cellProbe, 'a measured run (no ?cells) publishes the drawn cells or the columns');
    const targets = await page.evaluate(() => ({ ...(globalThis as Global).__seizaTargets }));
    for (const id of ['table', 'table-scroll-track', 'table-scroll-thumb']) {
      const [x = -1, y = -1, w = 0, h = 0] = targets[id] ?? [];
      check(x >= 0 && y >= 0 && w > 0 && h > 0 && x + w <= 1440 && y + h <= 900, `target ${id}: ${JSON.stringify(targets[id])}`);
    }

    // End: the last row.
    const endAt = await now(page);
    await page.keyboard.press('End');
    const atEnd = await filledState(page, 's.end === s.rows');
    const endFilled = await waitMark(page, MARKS.filled, endAt);
    const endPresented = await presentedMark(page, endFilled);
    check(atEnd.end === count, `End: end ${atEnd.end}, count(*) ${count}`);
    check(atEnd.lastCell === lastKey, `End: lastCell ${atEnd.lastCell}, the file's last spkid ${lastKey}`);
    check(endPresented.ok, `the filled mark after End isn't right after a presented frame: ${endPresented.detail}`);
    console.log(`reach: rows ${atEnd.rows} = count(*), End → rows ${atEnd.first}–${atEnd.end}, lastCell ${atEnd.lastCell}, filled ${(endFilled - endAt).toFixed(1)} ms after the key (${endPresented.detail})`);

    // The replay hooks.
    const replay = async (call: string) => {
      const since = await now(page);
      await page.evaluate(`globalThis.__contender.replay.${call}`);
      return { since, ms: (await now(page)) - since };
    };
    const jump = await replay('jump(0.9)');
    const jumped = await filledState(page, 'true');
    check(jumped.first === Math.floor(0.9 * count), `jump(0.9): first ${jumped.first}, expected ${Math.floor(0.9 * count)}`);
    // Again: the view lands where it is, filled, and sets no filled mark;
    // the hook must still resolve, at once.
    const again = await replay('jump(0.9)');
    check(again.ms < 1_000, `jump(0.9) again, onto loaded rows: ${again.ms.toFixed(0)} ms`);
    const reopen = await replay('open()');
    const reopened = await lastMark(page, MARKS.open);
    const afterOpen = await filledState(page, 's.first === 0');
    check(reopened !== null && reopened >= reopen.since, `open(): no new ${MARKS.open} mark`);
    check(afterOpen.rows === count, `open(): rows ${afterOpen.rows}`);
    const flung = await replay('fling()');
    const afterFling = await filledState(page, 'true');
    check(afterFling.end === count && afterFling.lastCell === lastKey, `fling(): ended at ${afterFling.first}–${afterFling.end}, lastCell ${afterFling.lastCell}`);
    console.log(`replay: jump(0.9) ${jump.ms.toFixed(0)} ms → row ${jumped.first}, again ${again.ms.toFixed(0)} ms; open() ${reopen.ms.toFixed(0)} ms; fling() ${flung.ms.toFixed(0)} ms → ${afterFling.first}–${afterFling.end}`);
    output.measured = { marks: { ...marks, filled }, presented, opened, targets, atEnd, endFilledAfterKeyMs: endFilled - endAt, endPresented, replay: { jump: { ...jump, state: jumped }, jumpAgain: again, open: { ...reopen, state: afterOpen }, fling: { ...flung, state: afterFling } } };
    failures.push(...found.map((problem) => `measured page: ${problem}`));
    await context.close();
  }

  // Unmeasured: marks, no state, no targets.
  {
    const context = await protocolContext(browser);
    const page = await context.newPage();
    const found = problems(page);
    await page.goto(server.url);
    await waitMark(page, MARKS.filled, 0);
    await page.waitForTimeout(500);
    const seen = await page.evaluate(() => {
      const g = globalThis as Global;
      return { side: g.__contender?.side, state: g.__contender?.state, replay: Object.keys(g.__contender?.replay ?? {}).sort(), targets: g.__seizaTargets ?? null, cellProbe: 'cells' in (g.__contender ?? {}) || 'columns' in (g.__contender ?? {}) };
    });
    const marks = Object.fromEntries(await Promise.all([MARKS.firstPixels, MARKS.usable, MARKS.open, MARKS.filled].map(async (name) => [name, await lastMark(page, name)] as const)));
    check(seen.side === 'gpui', `side ${seen.side}`);
    check(seen.state === null, `state without ?measure: ${JSON.stringify(seen.state)}`);
    check(seen.targets === null, `targets without ?measure: ${JSON.stringify(seen.targets)}`);
    check(seen.replay.join() === 'fling,jump,open', `replay hooks: ${seen.replay.join()}`);
    check(!seen.cellProbe, 'cells or columns published without ?cells');
    check(Object.values(marks).every((at) => at !== null), `marks without ?measure: ${JSON.stringify(marks)}`);
    output.unmeasured = { ...seen, marks };
    failures.push(...found.map((problem) => `unmeasured page: ${problem}`));
    await context.close();
  }

  // Framed: the marks reach the parent.
  {
    const context = await protocolContext(browser);
    const frameUrl = new URL('__frame', server.url).href;
    // A same-origin parent, with the isolation headers every page here has.
    await context.route(frameUrl, (route) =>
      route.fulfill({
        contentType: 'text/html',
        headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' },
        body: `<!doctype html><body style="margin:0"><script>window.__messages = []; addEventListener('message', (event) => event.origin === location.origin && __messages.push(event.data));</script><iframe src="${server.url}" style="border:0;width:100vw;height:100vh"></iframe></body>`,
      }),
    );
    const page = await context.newPage();
    const found = problems(page);
    await page.goto(frameUrl);
    const messages = await page
      .waitForFunction(() => {
        const messages = (globalThis as { __messages?: { name: string }[] }).__messages ?? [];
        return messages.some((message) => message.name === 'contender:filled') ? messages : false;
      }, null, { timeout: 60_000, polling: 50 })
      .then(async (handle) => (await handle.jsonValue()) as { seiza: string; name: string; at: number }[]);
    await page.waitForTimeout(200);
    const frame = page.frames().find((candidate) => candidate !== page.mainFrame())!;
    const epoch = await frame.evaluate(() => performance.getEntriesByType('mark').filter((entry) => entry.name.startsWith('contender:')).map((entry) => ({ name: entry.name, at: performance.timeOrigin + entry.startTime })));
    const all = (await page.evaluate(() => (globalThis as { __messages?: { seiza: string; name: string; at: number }[] }).__messages ?? [])) as typeof messages;
    for (const mark of epoch) {
      check(all.some((message) => message.seiza === 'mark' && message.name === mark.name && Math.abs(message.at - mark.at) < 0.01), `relay: ${mark.name} at ${mark.at} never reached the parent`);
    }
    check(epoch.length >= 4, `relay: the frame set ${epoch.length} contract marks`);
    output.framed = { messages: all, marks: epoch };
    console.log(`relay: ${all.length} messages for ${epoch.length} marks (${[...new Set(all.map((message) => message.name))].join(', ')})`);
    failures.push(...found.map((problem) => `framed page: ${problem}`));
    await context.close();
  }
} finally {
  await browser.close();
  await server.close();
}

output.failures = failures;
if (label) {
  const out = join(perfDir, 'results', `${output.date}-${label}.json`);
  mkdirSync(join(perfDir, 'results'), { recursive: true });
  writeFileSync(out, `${JSON.stringify(output, null, 2)}\n`);
  console.log(`wrote ${out}`);
}
if (failures.length) {
  console.error(`\nFAIL\n${failures.map((failure) => `  ${failure}`).join('\n')}`);
  process.exit(1);
}
console.log('\nPASS');
