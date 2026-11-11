// The TanStack contender on its release build: its prerendered first
// screen, its first usable moment confirmed by the probe key, and the
// contender contract (docs/contender-contract.md), as `reach.ts` checks the
// GPUI contender's. Chromium, the protocol's page (1440×900, DPR 2).
//
// Checks:
// - Prerendered: the served HTML holds the first screen (the empty frame
//   and its line); hydration keeps that element (the same node before and
//   after) with no hydration error.
// - Marks: first-pixels at the first screen's Element Timing entry, usable
//   (the hydration commit) ≤ open < filled, and the engine started (its
//   data layer requested) after both the paint entry and usable.
// - The probe: a key right after usable marks `contender:input` within two
//   frames of the key's event. Control: the entry's JS held back, the HTML
//   paints, a key pressed then leaves no `contender:input` (and first-pixels
//   comes before usable).
// - Filled is presented: the latest Element Timing paint among the visible
//   rows' cells created after the input (the open, End) is at or after the
//   filled mark and within 50 ms of it, and every visible row has one.
// - Reach: `state.rows` is native DuckDB's `count(*)`; End shows the last
//   row, filled, `lastCell` the file's last key.
// - Only with `?measure`: state, targets inside the viewport, `elementtiming`
//   on cells, the probe key; without it, the marks only.
// - The replay hooks: `jump(0.9)` lands at 90% and fills (again: at once),
//   `open()` marks a new open and fills, `fling()` ends at the last row.
// - The relay: framed in a same-origin page, each contract mark reaches the
//   parent by `postMessage`.
// - The market level (market watch at its default stop, its own build): the
//   first screen prerendered and hydrated in place; usable ≤ open < filled,
//   the probe key; with `?measure`, state (a row per instrument, End's
//   lastCell the last symbol), every batch of the feed on
//   `__contender.batches` in order from 0 (none missing), and
//   `contender:refreshed` marks with `__contenderRefreshed` rising; the
//   replay's `open()` ending the feed (no batch after it) and filling, its
//   `fling()` ending at the last row; without `?measure` none of state,
//   batches, refreshed marks, or cell timing; framed, every mark relayed,
//   the refreshed ones too.
// - The tail level (live tail at its default stop, its own build): the
//   first screen prerendered and hydrated in place; usable ≤ open < filled,
//   the probe key; with `?measure`, the table open at 0 rows and growing,
//   following (`__contenderFollowing`), every clock message on
//   `__contender.batches` in order, `contender:tail` marks with
//   `__contenderTail` rising and never past the rows; `__contender.pause`
//   holding the rows; the replay's `jump(0.9)` landing there and letting go
//   (the top held as the rows grow), `fling()` (the clock paused) ending
//   at the end and following again, `open()` starting the replay over (a new batches array
//   from a smaller count, the rows from 0); without `?measure` none of
//   state, batches, tail marks, the globals, the pause, or cell timing;
//   framed, every mark relayed, the tail ones too.
// - The wall level (the monitoring wall at its default stop, its own
//   build): the first screen prerendered and hydrated in place; usable ≤
//   open < filled, the probe key; filled presented across the tables (every
//   table's visible rows' cells painted, Element Timing's `row:<50t + r>`,
//   the last within 50 ms after the mark); with `?measure`, state (the
//   first table's: a desk's rows, `tables` the stop's), every batch on
//   `__contender.batches` in order from 0 with a generation a table,
//   `contender:refreshed` marks, and `__contenderRefreshed` an entry a
//   table, each drawn and none past its table's last generation; the
//   replay's `open()` filling every table again (a new open mark, after it
//   a filled one) and ending the feed (no batch after it, none to the new
//   tables), `fling()` and `jump()` refused; without `?measure` none of
//   state, batches, refreshed marks, the generations, or cell timing;
//   framed, every mark relayed, the refreshed ones too.
//
// Usage: node apps/observatory/perf/tanstack-contract.ts [--label <name>]
// --label writes perf/results/<date>-<label>.json. Needs `just observatory
// data`; run `just observatory tanstack-build`, `tanstack-build market`,
// `tanstack-build tail`, and `tanstack-build wall` first.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Page } from '@playwright/test';
import { waitMark } from '../../../shared-web/perf/harness.ts';
import { localDate, machineInfo, option } from '../../../shared-web/perf/protocol.ts';
import { PROBE_KEY, PROBE_MS } from '../metrics/metrics.ts';
import { INSTRUMENTS } from '../contenders/market/feed.ts';
import { LIVE_TAIL, MARKET_WATCH, MONITORING_WALL } from '../contenders/scenarios.ts';
import { DESK_ROWS } from '../contenders/wall/desks.ts';
import { MARKS, dataFile, lastMark, nativeDuckDB, perfDir, problems, protocolContext, serveTanstack } from './harness.ts';

const PORT = 4321;
/** The market level's build. */
const MARKET_PORT = 4365;
/** The tail level's build. */
const TAIL_PORT = 4373;
/** The wall level's build. */
const WALL_PORT = 4390;
/** The data layer's chunk: the engine's start imports it first. */
const DATA_LAYER = /\/assets\/table-[\w-]+\.js$/;
/** How long after the filled mark its cells may paint: three frames. */
const PRESENT_MS = 50;
/** The entry chunk, held back for the probe's control. */
const ENTRY = /\/assets\/index-[\w-]+\.js$/;

const label = option('label');
const failures: string[] = [];
const output: Record<string, unknown> = { date: localDate(), label, ...machineInfo() };
const check = (ok: boolean, problem: string) => {
  if (!ok) failures.push(problem);
  return ok;
};

// --- the file's facts, from native DuckDB ---

const conn = await nativeDuckDB();
const file = `'${dataFile.replaceAll("'", "''")}'`;
const value = async (sql: string) => String((await conn.runAndReadAll(sql)).getRows()[0]?.[0]);
const count = Number(await value(`SELECT count(*) FROM read_parquet(${file})`));
const lastKey = await value(`SELECT spkid FROM read_parquet(${file}, file_row_number = true) WHERE file_row_number = ${count - 1}`);
output.file = { count, lastKey };
console.log(`native DuckDB: count(*) ${count}, last spkid ${lastKey}`);

// --- in the page ---

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
interface Painted {
  id: string;
  renderTime: number;
}
type Global = {
  __contender?: { side: string; state: State | null; replay: Record<string, unknown> };
  __seizaTargets?: Record<string, number[]>;
  __painted?: Painted[];
  __keys?: number[];
  __firstScreen?: Element | null;
};

/** Init script: every Element Timing entry (its buffer holds only 150, and
 *  a screen of cells is ~330), each key's event time, and the first
 *  screen's element as the HTML parsed it, before the page's JS runs. */
function recorder(): void {
  const g = globalThis as Global;
  g.__painted = [];
  g.__keys = [];
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) g.__painted!.push({ id: (entry as PerformanceEntry & { identifier: string }).identifier, renderTime: (entry as PerformanceEntry & { renderTime: number }).renderTime });
  }).observe({ type: 'element', buffered: true });
  addEventListener('keydown', (event) => g.__keys!.push(event.timeStamp), { capture: true });
  // At 'interactive': the HTML parsed, before any module script runs (they
  // run after it, before DOMContentLoaded), so before hydration can start.
  document.addEventListener('readystatechange', () => {
    if (document.readyState === 'interactive') g.__firstScreen = document.querySelector('#root .frame.status');
  });
}

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

/** A state's visible rows. */
const visibleRows = (state: State): number[] => Array.from({ length: Math.max(0, state.end - state.first) }, (_, i) => state.first + i);

/** `rows`' cells painted after `since` (by Element Timing's `row:<row>`):
 *  the latest paint, and the rows with none. Element Timing entries
 *  arrive after the paint, in an observer's task: waits up to 2 s for
 *  every row's. */
async function cellsPainted(page: Page, since: number, rows: number[]) {
  const read = ({ since, rows }: { since: number; rows: number[] }) => {
    const painted = new Map<number, number>();
    for (const entry of (globalThis as Global).__painted ?? []) {
      if (!entry.id.startsWith('row:') || entry.renderTime < since) continue;
      const row = Number(entry.id.slice(4));
      painted.set(row, Math.max(painted.get(row) ?? 0, entry.renderTime));
    }
    return { latest: Math.max(0, ...rows.map((row) => painted.get(row) ?? 0)), missing: rows.filter((row) => !painted.has(row)) };
  };
  const args = { since, rows };
  await page.waitForFunction(`(${read.toString()})(${JSON.stringify(args)}).missing.length === 0`, null, { timeout: 2_000, polling: 20 }).catch(() => {});
  return page.evaluate(read, args);
}

/** The filled mark after `since` is presented: `rows`' new cells all
 *  painted, the latest within PRESENT_MS after the mark. */
async function presented(page: Page, what: string, since: number, filled: number, rows: number[]) {
  const cells = await cellsPainted(page, since, rows);
  const late = cells.latest - filled;
  check(cells.missing.length === 0, `${what}: visible rows without a new cell's paint: ${cells.missing.slice(0, 5).join(', ')}${cells.missing.length > 5 ? '…' : ''}`);
  check(late >= 0 && late <= PRESENT_MS, `${what}: the cells' last paint ${late.toFixed(1)} ms after the filled mark (0–${PRESENT_MS})`);
  return { latestPaintAfterFilledMs: late, missing: cells.missing.length, rows: rows.length };
}

const server = await serveTanstack(PORT);
const browser = await chromium.launch({ channel: 'chromium' });
try {
  // The served HTML: the first screen, prerendered.
  {
    const html = await (await fetch(server.url)).text();
    const prerendered = /<div id="root"><div class="page"><div class="frame status"[^>]*>Engine loading…<\/div><\/div><\/div>/.test(html);
    check(prerendered, "the served HTML doesn't hold the prerendered first screen");
    output.html = { prerendered };
  }

  // Measured: marks, the probe, state, targets, presentation, replay.
  {
    const context = await protocolContext(browser, { init: [recorder] });
    const page = await context.newPage();
    const found = problems(page);
    await page.goto(`${server.url}?measure`);
    const usable = await waitMark(page, MARKS.usable, 0);
    // Hydrated in place: the element the HTML parsed is the one on screen.
    const hydratedInPlace = await page.evaluate(() => {
      const parsed = (globalThis as Global).__firstScreen;
      return !!parsed && parsed === document.querySelector('#root .frame.status');
    });
    check(hydratedInPlace, 'hydration replaced the prerendered first screen instead of keeping it');
    // The probe, right after usable.
    await page.keyboard.press(PROBE_KEY);
    const input = await waitMark(page, MARKS.input, usable, 5_000).catch(() => null);
    const keyAt = await page.evaluate(() => (globalThis as Global).__keys?.[0] ?? null);
    const probeMs = input !== null && keyAt !== null ? input - keyAt : null;
    check(probeMs !== null && probeMs >= 0 && probeMs <= PROBE_MS, `the probe key after usable: ${MARKS.input} ${probeMs?.toFixed(1)} ms after the key (0–${PROBE_MS.toFixed(1)})`);

    const filled = await waitMark(page, MARKS.filled, 0);
    await page.waitForTimeout(100);
    const marks = Object.fromEntries(await Promise.all([MARKS.firstPixels, MARKS.usable, MARKS.open].map(async (name) => [name, await lastMark(page, name)] as const)));
    const [firstPixels, open] = [marks[MARKS.firstPixels] ?? null, marks[MARKS.open] ?? null];
    const timing = await page.evaluate((pattern) => {
      const screen = ((globalThis as Global).__painted ?? []).find((entry) => entry.id === 'first-screen');
      return {
        firstScreenPaint: screen?.renderTime ?? null,
        firstPaint: performance.getEntriesByName('first-paint')[0]?.startTime ?? null,
        dataLayer: performance.getEntriesByType('resource').find((entry) => new RegExp(pattern).test(entry.name))?.startTime ?? null,
      };
    }, DATA_LAYER.source);
    check(firstPixels !== null && firstPixels === timing.firstScreenPaint, `first-pixels ${firstPixels} isn't the first screen's Element Timing paint (${timing.firstScreenPaint})`);
    check(open !== null && usable <= open && open < filled, `marks out of order: usable ${usable}, open ${open}, filled ${filled}`);
    check(timing.dataLayer !== null && timing.firstPaint !== null && timing.dataLayer >= timing.firstPaint && timing.dataLayer >= usable, `the engine started at ${timing.dataLayer}, before first paint (${timing.firstPaint}) or usable (${usable})`);
    output.measured = { marks: { ...marks, filled, input }, probeMs, timing, hydratedInPlace };
    console.log(
      `marks: first-pixels ${firstPixels?.toFixed(1)}, first-paint ${timing.firstPaint?.toFixed(1)}, usable ${usable.toFixed(1)}, data layer requested ${timing.dataLayer?.toFixed(1)}, open ${open?.toFixed(1)}, filled ${filled.toFixed(1)} ms; probe key → ${MARKS.input} in ${probeMs?.toFixed(1)} ms`,
    );

    const opened = await filledState(page, 's.first === 0');
    check(opened.rows === count, `state.rows ${opened.rows}, count(*) ${count}`);
    check(opened.cacheBytes > 0, `state.cacheBytes ${opened.cacheBytes} with rows loaded`);
    const openPresented = await presented(page, 'open', open ?? 0, filled, visibleRows(opened));
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
    const endPresented = await presented(page, 'End', endAt, endFilled, visibleRows(atEnd));
    check(atEnd.end === count, `End: end ${atEnd.end}, count(*) ${count}`);
    check(atEnd.lastCell === lastKey, `End: lastCell ${atEnd.lastCell}, the file's last spkid ${lastKey}`);
    console.log(`reach: rows ${atEnd.rows} = count(*), End → rows ${atEnd.first}–${atEnd.end}, lastCell ${atEnd.lastCell}, filled ${(endFilled - endAt).toFixed(1)} ms after the key, its cells painted ${endPresented.latestPaintAfterFilledMs.toFixed(1)} ms after the mark`);

    // The replay hooks.
    const replay = async (call: string) => {
      const since = await now(page);
      await page.evaluate(`globalThis.__contender.replay.${call}`);
      return { since, ms: (await now(page)) - since };
    };
    const jump = await replay('jump(0.9)');
    const jumped = await filledState(page, 'true');
    check(jumped.first === Math.floor(0.9 * count), `jump(0.9): first ${jumped.first}, expected ${Math.floor(0.9 * count)}`);
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

    output.measured = {
      ...(output.measured as object),
      opened,
      openPresented,
      targets,
      atEnd,
      endFilledAfterKeyMs: endFilled - endAt,
      endPresented,
      replay: { jump: { ...jump, state: jumped }, jumpAgain: again, open: { ...reopen, state: afterOpen }, fling: { ...flung, state: afterFling } },
    };
    failures.push(...found.map((problem) => `measured page: ${problem}`));
    await context.close();
  }

  // The probe's control: a key before the hydration commit changes nothing.
  {
    const context = await protocolContext(browser, { init: [recorder] });
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    await context.route(ENTRY, async (route) => {
      await held;
      await route.continue();
    });
    const page = await context.newPage();
    const found = problems(page);
    await page.goto(`${server.url}?measure`, { waitUntil: 'commit' });
    // The HTML's first screen paints with its JS held back.
    await page.waitForFunction(() => ((globalThis as Global).__painted ?? []).some((entry) => entry.id === 'first-screen'), null, { timeout: 10_000 });
    await page.keyboard.press(PROBE_KEY);
    release();
    const usable = await waitMark(page, MARKS.usable, 0);
    await page.waitForTimeout(200);
    const seen = await page.evaluate(() => ({ inputs: performance.getEntriesByName('contender:input', 'mark').length, keys: (globalThis as Global).__keys?.length ?? 0 }));
    const firstPixels = await lastMark(page, MARKS.firstPixels);
    check(seen.keys === 1, `control: the key before hydration wasn't delivered (${seen.keys} keys)`);
    check(seen.inputs === 0, `control: a key before the hydration commit marked ${MARKS.input}`);
    check(firstPixels !== null && firstPixels < usable, `control: first-pixels ${firstPixels} not before usable ${usable} with the JS held back`);
    output.probeControl = { ...seen, firstPixels, usable };
    console.log(`probe control: a key before hydration (JS held back; first pixels ${firstPixels?.toFixed(1)}, usable ${usable.toFixed(1)} ms): ${seen.inputs} ${MARKS.input} marks`);
    failures.push(...found.map((problem) => `control page: ${problem}`));
    await context.close();
  }

  // Unmeasured: marks, no state, no targets, no cell timing, no probe.
  {
    const context = await protocolContext(browser, { init: [recorder] });
    const page = await context.newPage();
    const found = problems(page);
    await page.goto(server.url);
    await waitMark(page, MARKS.filled, 0);
    await page.keyboard.press(PROBE_KEY);
    await page.waitForTimeout(500);
    const seen = await page.evaluate(() => {
      const g = globalThis as Global;
      return {
        side: g.__contender?.side,
        state: g.__contender?.state,
        replay: Object.keys(g.__contender?.replay ?? {}).sort(),
        targets: g.__seizaTargets ?? null,
        cellTiming: document.querySelectorAll('.row [elementtiming]').length + (g.__painted ?? []).filter((entry) => entry.id.startsWith('row:')).length,
        inputs: performance.getEntriesByName('contender:input', 'mark').length,
      };
    });
    const marks = Object.fromEntries(await Promise.all([MARKS.firstPixels, MARKS.usable, MARKS.open, MARKS.filled].map(async (name) => [name, await lastMark(page, name)] as const)));
    check(seen.side === 'tanstack', `side ${seen.side}`);
    check(seen.state === null, `state without ?measure: ${JSON.stringify(seen.state)}`);
    check(seen.targets === null, `targets without ?measure: ${JSON.stringify(seen.targets)}`);
    check(seen.replay.join() === 'fling,jump,open', `replay hooks: ${seen.replay.join()}`);
    check(seen.cellTiming === 0, `elementtiming on cells without ?measure: ${seen.cellTiming}`);
    check(seen.inputs === 0, `the probe key marked ${MARKS.input} without ?measure`);
    check(Object.values(marks).every((at) => at !== null), `marks without ?measure: ${JSON.stringify(marks)}`);
    output.unmeasured = { ...seen, marks };
    failures.push(...found.map((problem) => `unmeasured page: ${problem}`));
    await context.close();
  }

  // Framed: the marks reach the parent.
  {
    const context = await protocolContext(browser);
    const frameUrl = new URL('__frame', server.url).href;
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
    await page.waitForFunction(() => ((globalThis as { __messages?: { name: string }[] }).__messages ?? []).some((message) => message.name === 'contender:filled'), null, { timeout: 60_000, polling: 50 });
    await page.waitForTimeout(200);
    const frame = page.frames().find((candidate) => candidate !== page.mainFrame())!;
    const epoch = await frame.evaluate(() => performance.getEntriesByType('mark').filter((entry) => entry.name.startsWith('contender:')).map((entry) => ({ name: entry.name, at: performance.timeOrigin + entry.startTime })));
    const all = (await page.evaluate(() => (globalThis as { __messages?: unknown[] }).__messages ?? [])) as { seiza: string; name: string; at: number }[];
    for (const mark of epoch) {
      check(all.some((message) => message.seiza === 'mark' && message.name === mark.name && Math.abs(message.at - mark.at) < 0.01), `relay: ${mark.name} at ${mark.at} never reached the parent`);
    }
    check(epoch.length >= 4, `relay: the frame set ${epoch.length} contract marks`);
    output.framed = { messages: all, marks: epoch };
    console.log(`relay: ${all.length} messages for ${epoch.length} marks (${[...new Set(all.map((message) => message.name))].join(', ')})`);
    failures.push(...found.map((problem) => `framed page: ${problem}`));
    await context.close();
  }

  await marketContract();
  await tailContract();
  await wallContract();
} finally {
  await browser.close();
  await server.close();
}

/** The market level's contract (its own build, market watch at its default stop). */
async function marketContract(): Promise<void> {
  const market = await serveTanstack(MARKET_PORT, undefined, 'market');
  const out: Record<string, unknown> = {};
  output.market = out;
  type Batches = [seq: number, ticks: number, sent: number, generation: number, visible: number][];
  type MarketGlobal = Global & { __contender?: { batches?: Batches }; __contenderRefreshed?: number };
  const url = `${market.url}?scenario=${MARKET_WATCH.id}&stop=${MARKET_WATCH.defaultStop}`;
  const symbols = INSTRUMENTS.map(({ symbol }) => symbol);
  try {
    {
      const html = await (await fetch(market.url)).text();
      check(/<div id="root"><div class="page"><div class="frame status"[^>]*>Engine loading…<\/div><\/div><\/div>/.test(html), "market: the served HTML doesn't hold the prerendered first screen");
    }

    // Measured.
    {
      const context = await protocolContext(browser, { init: [recorder] });
      const page = await context.newPage();
      const found = problems(page);
      await page.goto(`${url}&measure`);
      const usable = await waitMark(page, MARKS.usable, 0);
      const hydratedInPlace = await page.evaluate(() => {
        const parsed = (globalThis as Global).__firstScreen;
        return !!parsed && parsed === document.querySelector('#root .frame.status');
      });
      check(hydratedInPlace, 'market: hydration replaced the prerendered first screen');
      await page.keyboard.press(PROBE_KEY);
      const input = await waitMark(page, MARKS.input, usable, 5_000).catch(() => null);
      const keyAt = await page.evaluate(() => (globalThis as Global).__keys?.[0] ?? null);
      const probeMs = input !== null && keyAt !== null ? input - keyAt : null;
      check(probeMs !== null && probeMs >= 0 && probeMs <= PROBE_MS, `market: the probe key after usable: ${probeMs?.toFixed(1)} ms (0–${PROBE_MS.toFixed(1)})`);
      const filled = await waitMark(page, MARKS.filled, 0);
      const open = await lastMark(page, MARKS.open);
      check(open !== null && usable <= open && open < filled, `market: marks out of order: usable ${usable}, open ${open}, filled ${filled}`);
      const opened = await filledState(page, 's.first === 0');
      check(opened.rows === symbols.length, `market: state.rows ${opened.rows}, the feed's ${symbols.length} instruments`);
      check(opened.cacheBytes > 0, `market: state.cacheBytes ${opened.cacheBytes}`);

      // Under the feed: every batch in order, the refreshed marks rising.
      await page.waitForTimeout(1500);
      const feed = await page.evaluate(() => {
        const g = globalThis as MarketGlobal;
        return { batches: g.__contender?.batches ?? [], refreshed: performance.getEntriesByName('contender:refreshed', 'mark').length, drawn: g.__contenderRefreshed ?? 0 };
      });
      const inOrder = feed.batches.every(([seq], index) => seq === index);
      const lastGeneration = feed.batches.at(-1)?.[3] ?? 0;
      check(feed.batches.length > 50, `market: ${feed.batches.length} batches in 1.5 s`);
      check(inOrder, `market: the batches out of order or missing: ${feed.batches.slice(0, 8).map(([seq]) => seq).join(', ')}…`);
      check(feed.refreshed > 50, `market: ${feed.refreshed} refreshed marks in 1.5 s`);
      check(feed.drawn > 0 && feed.drawn <= lastGeneration, `market: __contenderRefreshed ${feed.drawn}, the last batch's generation ${lastGeneration}`);
      console.log(`market: usable ${usable.toFixed(1)}, open ${open?.toFixed(1)}, filled ${filled.toFixed(1)} ms; probe key ${probeMs?.toFixed(1)} ms; ${opened.rows} rows; ${feed.batches.length} batches in order from 0, ${feed.refreshed} refreshed marks, generation ${feed.drawn} drawn of ${lastGeneration}`);

      // End: the last instrument.
      await page.keyboard.press('End');
      const atEnd = await filledState(page, 's.end === s.rows');
      check(atEnd.lastCell === symbols.at(-1), `market: End's lastCell ${atEnd.lastCell}, the last symbol ${symbols.at(-1)}`);

      // The replay: open() ends the feed and fills; fling() reaches the end.
      // The old feed's batches array, kept: the reopened table publishes a
      // new one, which a feed still running wouldn't reach.
      await page.evaluate(() => ((globalThis as MarketGlobal & { __oldBatches?: Batches }).__oldBatches = (globalThis as MarketGlobal).__contender?.batches));
      const since = await now(page);
      await page.evaluate('globalThis.__contender.replay.open()');
      const reopened = await lastMark(page, MARKS.open);
      check(reopened !== null && reopened >= since, 'market: open() set no new open mark');
      await filledState(page, 's.first === 0');
      const lengths = () =>
        page.evaluate(() => {
          const g = globalThis as MarketGlobal & { __oldBatches?: Batches };
          return { old: g.__oldBatches?.length ?? -1, fresh: g.__contender?.batches?.length ?? 0, replaced: g.__oldBatches !== g.__contender?.batches };
        });
      const was = await lengths();
      await page.waitForTimeout(500);
      const now_ = await lengths();
      const before = was.old;
      const after = now_.old;
      check(was.old > 0 && was.replaced, `market: the reopen's batches ${JSON.stringify(was)}, want the old feed's array kept apart from a new one`);
      check(after === before && now_.fresh === 0, `market: ${after - before} batches to the old feed and ${now_.fresh} to the new table after the replay's open(), want the feed ended and none started`);
      await page.evaluate('globalThis.__contender.replay.fling()');
      const flung = await filledState(page, 'true');
      check(flung.end === symbols.length && flung.lastCell === symbols.at(-1), `market: fling() ended at ${flung.first}–${flung.end}, lastCell ${flung.lastCell}`);
      out.measured = { usable, open, filled, input, probeMs, opened, feed: { batches: feed.batches.length, inOrder, refreshed: feed.refreshed, drawn: feed.drawn, lastGeneration }, atEnd, batchesAfterOpen: after - before, flung };
      console.log(`market: End → ${atEnd.lastCell}; open() ended the feed (${after - before} batches after it); fling() → ${flung.first}–${flung.end}`);
      failures.push(...found.map((problem) => `market measured page: ${problem}`));
      await context.close();
    }

    // Unmeasured: none of state, batches, refreshed marks, cell timing.
    {
      const context = await protocolContext(browser, { init: [recorder] });
      const page = await context.newPage();
      const found = problems(page);
      await page.goto(url);
      await waitMark(page, MARKS.filled, 0);
      await page.waitForTimeout(1000);
      const seen = await page.evaluate(() => {
        const g = globalThis as MarketGlobal;
        return {
          state: g.__contender?.state ?? null,
          batches: g.__contender?.batches ?? null,
          refreshed: performance.getEntriesByName('contender:refreshed', 'mark').length,
          drawn: g.__contenderRefreshed ?? null,
          cellTiming: document.querySelectorAll('.row [elementtiming]').length,
        };
      });
      check(seen.state === null && seen.batches === null && seen.refreshed === 0 && seen.drawn === null && seen.cellTiming === 0, `market without ?measure: ${JSON.stringify(seen)}`);
      out.unmeasured = seen;
      failures.push(...found.map((problem) => `market unmeasured page: ${problem}`));
      await context.close();
    }

    // Framed, measured: every mark relayed, the refreshed ones too.
    {
      const context = await protocolContext(browser);
      const frameUrl = new URL('__frame', market.url).href;
      await context.route(frameUrl, (route) =>
        route.fulfill({
          contentType: 'text/html',
          headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' },
          body: `<!doctype html><body style="margin:0"><script>window.__messages = []; addEventListener('message', (event) => event.origin === location.origin && __messages.push(event.data));</script><iframe src="${url}&measure" style="border:0;width:100vw;height:100vh"></iframe></body>`,
        }),
      );
      const page = await context.newPage();
      const found = problems(page);
      await page.goto(frameUrl);
      await page.waitForFunction(() => ((globalThis as { __messages?: { name: string }[] }).__messages ?? []).some((message) => message.name === 'contender:refreshed'), null, { timeout: 60_000, polling: 50 });
      await page.waitForTimeout(300);
      const frame = page.frames().find((candidate) => candidate !== page.mainFrame())!;
      const epoch = await frame.evaluate(() => performance.getEntriesByType('mark').filter((entry) => entry.name.startsWith('contender:')).map((entry) => ({ name: entry.name, at: performance.timeOrigin + entry.startTime })));
      const all = (await page.evaluate(() => (globalThis as { __messages?: unknown[] }).__messages ?? [])) as { seiza: string; name: string; at: number }[];
      // The marks set by the time the messages were read (the newest may still be on its way).
      const read = epoch.filter((mark) => mark.at <= Math.max(...all.map((message) => message.at)));
      const missing = read.filter((mark) => !all.some((message) => message.seiza === 'mark' && message.name === mark.name && Math.abs(message.at - mark.at) < 0.01));
      check(missing.length === 0, `market relay: ${missing.length} marks never reached the parent, e.g. ${JSON.stringify(missing[0])}`);
      const names = [...new Set(all.map((message) => message.name))];
      check(names.includes(MARKS.filled) && names.includes(MARKS.refreshed), `market relay: ${names.join(', ')}`);
      out.framed = { messages: all.length, marks: read.length, names };
      console.log(`market relay: ${all.length} messages for ${read.length} marks (${names.join(', ')})`);
      failures.push(...found.map((problem) => `market framed page: ${problem}`));
      await context.close();
    }
  } finally {
    await market.close();
  }
}

/** The tail level's contract (its own build, live tail at its default stop). */
async function tailContract(): Promise<void> {
  const tail = await serveTanstack(TAIL_PORT, undefined, 'tail');
  const out: Record<string, unknown> = {};
  output.tail = out;
  type TailGlobal = Global & {
    __contender?: { batches?: [rows: number, at: number][]; pause?: (on: boolean) => void };
    __contenderTail?: number;
    __contenderFollowing?: boolean;
    __oldBatches?: [number, number][];
  };
  const url = `${tail.url}?scenario=${LIVE_TAIL.id}&stop=${LIVE_TAIL.defaultStop}`;
  const state = (page: Page) => page.evaluate(() => (globalThis as TailGlobal).__contender?.state ?? null);
  const following = (page: Page) => page.evaluate(() => (globalThis as TailGlobal).__contenderFollowing);
  try {
    {
      const html = await (await fetch(tail.url)).text();
      check(/<div id="root"><div class="page"><div class="frame status"[^>]*>Engine loading…<\/div><\/div><\/div>/.test(html), "tail: the served HTML doesn't hold the prerendered first screen");
    }

    // Measured.
    {
      const context = await protocolContext(browser, { init: [recorder] });
      const page = await context.newPage();
      const found = problems(page);
      await page.goto(`${url}&measure`);
      const usable = await waitMark(page, MARKS.usable, 0);
      const hydratedInPlace = await page.evaluate(() => {
        const parsed = (globalThis as Global).__firstScreen;
        return !!parsed && parsed === document.querySelector('#root .frame.status');
      });
      check(hydratedInPlace, 'tail: hydration replaced the prerendered first screen');
      await page.keyboard.press(PROBE_KEY);
      const input = await waitMark(page, MARKS.input, usable, 5_000).catch(() => null);
      const keyAt = await page.evaluate(() => (globalThis as Global).__keys?.[0] ?? null);
      const probeMs = input !== null && keyAt !== null ? input - keyAt : null;
      check(probeMs !== null && probeMs >= 0 && probeMs <= PROBE_MS, `tail: the probe key after usable: ${probeMs?.toFixed(1)} ms (0–${PROBE_MS.toFixed(1)})`);
      const filled = await waitMark(page, MARKS.filled, 0);
      const open = await lastMark(page, MARKS.open);
      check(open !== null && usable <= open && open < filled, `tail: marks out of order: usable ${usable}, open ${open}, filled ${filled}`);

      // Under the clock: the rows growing, following, the messages in order, the tail marks rising.
      await page.waitForTimeout(1500);
      const fed = await page.evaluate(() => {
        const g = globalThis as TailGlobal;
        return { batches: g.__contender?.batches ?? [], marks: performance.getEntriesByName('contender:tail', 'mark').length, tail: g.__contenderTail ?? 0, following: g.__contenderFollowing, rows: g.__contender?.state?.rows ?? 0 };
      });
      const inOrder = fed.batches.every(([rows], index) => index === 0 || rows >= fed.batches[index - 1]![0]);
      check(fed.batches.length > 50 && inOrder, `tail: ${fed.batches.length} clock messages in 1.5 s, in order ${inOrder}`);
      check(fed.following === true, `tail: following ${fed.following} under the clock`);
      check(fed.marks > 20 && fed.tail > 0 && fed.tail <= fed.rows, `tail: ${fed.marks} tail marks, the tail ${fed.tail} of ${fed.rows} rows`);
      console.log(`tail: usable ${usable.toFixed(1)}, open ${open?.toFixed(1)}, filled ${filled.toFixed(1)} ms; probe key ${probeMs?.toFixed(1)} ms; ${fed.batches.length} clock messages in order, ${fed.marks} tail marks, the tail ${fed.tail} of ${fed.rows} rows, following ${fed.following}`);

      // The pause holds the rows.
      await page.evaluate(() => (globalThis as TailGlobal).__contender?.pause?.(true));
      await page.waitForTimeout(200);
      const paused = (await state(page))?.rows ?? -1;
      await page.waitForTimeout(500);
      const held = (await state(page))?.rows ?? -2;
      check(paused === held && paused > 0, `tail: the pause held ${paused} → ${held} rows`);

      // The replay's jump lands at 90% of the rows (still paused, so the
      // count it's judged by is the jump's) and lets go: then, the clock
      // resumed, the top holds as the rows grow.
      await page.evaluate('globalThis.__contender.replay.jump(0.9)');
      const jumped = await filledState(page, 'true');
      const letGo = await following(page);
      await page.evaluate(() => (globalThis as TailGlobal).__contender?.pause?.(false));
      await page.waitForTimeout(500);
      const later = await state(page);
      check(jumped.rows === held && jumped.first === Math.floor(0.9 * held), `tail: jump(0.9) landed at ${jumped.first} of ${jumped.rows}, want ${Math.floor(0.9 * held)} of ${held}`);
      check(letGo === false && later?.top === jumped.top && (later?.rows ?? 0) > jumped.rows, `tail: after jump(0.9) following ${letGo}, top ${jumped.top} → ${later?.top}, rows ${jumped.rows} → ${later?.rows}`);

      // The fling ends at the end, following again: the clock paused for it,
      // since it goes the rows it started with.
      await page.evaluate(() => (globalThis as TailGlobal).__contender?.pause?.(true));
      await page.waitForTimeout(200);
      await page.evaluate('globalThis.__contender.replay.fling()');
      const flung = await filledState(page, 's.end === s.rows');
      const flungFollowing = await following(page);
      await page.evaluate(() => (globalThis as TailGlobal).__contender?.pause?.(false));
      check(flungFollowing === true, `tail: fling() ended at ${flung.first}–${flung.end} of ${flung.rows}, following ${flungFollowing}`);

      // The replay's open starts over: a new batches array, the rows from 0.
      await page.evaluate(() => ((globalThis as TailGlobal).__oldBatches = (globalThis as TailGlobal).__contender?.batches));
      const before = (await state(page))?.rows ?? 0;
      const since = await now(page);
      await page.evaluate('globalThis.__contender.replay.open()');
      const reopened = await lastMark(page, MARKS.open);
      check(reopened !== null && reopened >= since, 'tail: open() set no new open mark');
      const restarted = await page.evaluate(() => {
        const g = globalThis as TailGlobal;
        return { replaced: g.__oldBatches !== g.__contender?.batches, rows: g.__contender?.state?.rows ?? -1 };
      });
      await page.waitForTimeout(500);
      const regrown = await page.evaluate(() => {
        const g = globalThis as TailGlobal;
        return { first: g.__contender?.batches?.[0]?.[0] ?? -1, rows: g.__contender?.state?.rows ?? -1, following: g.__contenderFollowing };
      });
      check(restarted.replaced && restarted.rows < before && regrown.rows > restarted.rows && regrown.first >= 0 && regrown.first < before && regrown.following === true, `tail: open() from ${before} rows: ${JSON.stringify({ restarted, regrown })}`);
      out.measured = { usable, open, filled, input, probeMs, fed: { batches: fed.batches.length, inOrder, marks: fed.marks, tail: fed.tail, rows: fed.rows }, paused: [paused, held], jumped, letGo, flung, flungFollowing, reopen: { before, restarted, regrown } };
      console.log(`tail: the pause held ${held} rows; jump(0.9) → ${jumped.first} of ${jumped.rows}, following ${letGo}, the top held; fling() → ${flung.first}–${flung.end} of ${flung.rows}, following ${flungFollowing}; open() from ${before} rows → ${restarted.rows}, then ${regrown.rows}`);
      failures.push(...found.map((problem) => `tail measured page: ${problem}`));
      await context.close();
    }

    // Unmeasured: none of state, batches, tail marks, the globals, the pause, cell timing.
    {
      const context = await protocolContext(browser, { init: [recorder] });
      const page = await context.newPage();
      const found = problems(page);
      await page.goto(url);
      await waitMark(page, MARKS.filled, 0);
      await page.waitForTimeout(1000);
      const seen = await page.evaluate(() => {
        const g = globalThis as TailGlobal;
        return {
          state: g.__contender?.state ?? null,
          batches: g.__contender?.batches ?? null,
          pause: g.__contender?.pause ?? null,
          marks: performance.getEntriesByName('contender:tail', 'mark').length,
          tail: g.__contenderTail ?? null,
          following: g.__contenderFollowing ?? null,
          cellTiming: document.querySelectorAll('.row [elementtiming]').length,
          rows: document.querySelectorAll('.content > .row').length,
        };
      });
      check(seen.state === null && seen.batches === null && seen.pause === null && seen.marks === 0 && seen.tail === null && seen.following === null && seen.cellTiming === 0 && seen.rows > 0, `tail without ?measure: ${JSON.stringify(seen)}`);
      out.unmeasured = seen;
      failures.push(...found.map((problem) => `tail unmeasured page: ${problem}`));
      await context.close();
    }

    // Framed, measured: every mark relayed, the tail ones too.
    {
      const context = await protocolContext(browser);
      const frameUrl = new URL('__frame', tail.url).href;
      await context.route(frameUrl, (route) =>
        route.fulfill({
          contentType: 'text/html',
          headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' },
          body: `<!doctype html><body style="margin:0"><script>window.__messages = []; addEventListener('message', (event) => event.origin === location.origin && __messages.push(event.data));</script><iframe src="${url}&measure" style="border:0;width:100vw;height:100vh"></iframe></body>`,
        }),
      );
      const page = await context.newPage();
      const found = problems(page);
      await page.goto(frameUrl);
      await page.waitForFunction(() => ((globalThis as { __messages?: { name: string }[] }).__messages ?? []).some((message) => message.name === 'contender:tail'), null, { timeout: 60_000, polling: 50 });
      await page.waitForTimeout(300);
      const frame = page.frames().find((candidate) => candidate !== page.mainFrame())!;
      const epoch = await frame.evaluate(() => performance.getEntriesByType('mark').filter((entry) => entry.name.startsWith('contender:')).map((entry) => ({ name: entry.name, at: performance.timeOrigin + entry.startTime })));
      const all = (await page.evaluate(() => (globalThis as { __messages?: unknown[] }).__messages ?? [])) as { seiza: string; name: string; at: number }[];
      const read = epoch.filter((mark) => mark.at <= Math.max(...all.map((message) => message.at)));
      const missing = read.filter((mark) => !all.some((message) => message.seiza === 'mark' && message.name === mark.name && Math.abs(message.at - mark.at) < 0.01));
      check(missing.length === 0, `tail relay: ${missing.length} marks never reached the parent, e.g. ${JSON.stringify(missing[0])}`);
      const names = [...new Set(all.map((message) => message.name))];
      check(names.includes(MARKS.filled) && names.includes(MARKS.tail), `tail relay: ${names.join(', ')}`);
      out.framed = { messages: all.length, marks: read.length, names };
      console.log(`tail relay: ${all.length} messages for ${read.length} marks (${names.join(', ')})`);
      failures.push(...found.map((problem) => `tail framed page: ${problem}`));
      await context.close();
    }
  } finally {
    await tail.close();
  }
}

/** The wall level's contract (its own build, the monitoring wall at its default stop). */
async function wallContract(): Promise<void> {
  const wall = await serveTanstack(WALL_PORT, undefined, 'wall');
  const out: Record<string, unknown> = {};
  output.wall = out;
  type Batches = [seq: number, ticks: number, sent: number, generations: number[], visible: number][];
  type WallGlobal = Omit<Global, '__contender'> & { __contender?: { state: (State & { tables?: number }) | null; replay: Record<string, () => Promise<unknown>>; batches?: Batches }; __contenderRefreshed?: number[] };
  const stop = MONITORING_WALL.stops.find((candidate) => candidate.id === MONITORING_WALL.defaultStop)!;
  const url = `${wall.url}?scenario=${MONITORING_WALL.id}&stop=${stop.id}`;
  try {
    {
      const html = await (await fetch(wall.url)).text();
      check(/<div id="root"><div class="page"><div class="frame status"[^>]*>Engine loading…<\/div><\/div><\/div>/.test(html), "wall: the served HTML doesn't hold the prerendered first screen");
    }

    // Measured.
    {
      const context = await protocolContext(browser, { init: [recorder] });
      const page = await context.newPage();
      const found = problems(page);
      await page.goto(`${url}&measure`);
      const usable = await waitMark(page, MARKS.usable, 0);
      const hydratedInPlace = await page.evaluate(() => {
        const parsed = (globalThis as Global).__firstScreen;
        return !!parsed && parsed === document.querySelector('#root .frame.status');
      });
      check(hydratedInPlace, 'wall: hydration replaced the prerendered first screen');
      await page.keyboard.press(PROBE_KEY);
      const input = await waitMark(page, MARKS.input, usable, 5_000).catch(() => null);
      const keyAt = await page.evaluate(() => (globalThis as Global).__keys?.[0] ?? null);
      const probeMs = input !== null && keyAt !== null ? input - keyAt : null;
      check(probeMs !== null && probeMs >= 0 && probeMs <= PROBE_MS, `wall: the probe key after usable: ${probeMs?.toFixed(1)} ms (0–${PROBE_MS.toFixed(1)})`);
      const filled = await waitMark(page, MARKS.filled, 0);
      const open = await lastMark(page, MARKS.open);
      check(open !== null && usable <= open && open < filled, `wall: marks out of order: usable ${usable}, open ${open}, filled ${filled}`);
      const opened = (await filledState(page, 's.first === 0')) as State & { tables?: number };
      check(opened.rows === DESK_ROWS, `wall: state.rows ${opened.rows}, a desk's ${DESK_ROWS}`);
      check(opened.tables === stop.tables, `wall: state.tables ${opened.tables}, the stop's ${stop.tables}`);
      check(opened.cacheBytes > 0, `wall: state.cacheBytes ${opened.cacheBytes}`);
      // Filled presented across the tables: each table's visible rows' cells
      // (the first table's rows: the tables are the same height), named by
      // the instrument's row, `row:<50t + r>`.
      const filledPresented = await presented(page, 'wall open', open ?? 0, filled, Array.from({ length: stop.tables }, (_, table) => visibleRows(opened).map((row) => table * DESK_ROWS + row)).flat());

      // Under the feed: every batch in order with a generation a table, the
      // refreshed marks, each table's generation drawn.
      await page.waitForTimeout(1500);
      const feed = await page.evaluate(() => {
        const g = globalThis as WallGlobal;
        return { batches: g.__contender?.batches ?? [], refreshed: performance.getEntriesByName('contender:refreshed', 'mark').length, drawn: [...(g.__contenderRefreshed ?? [])] };
      });
      const inOrder = feed.batches.every(([seq], index) => seq === index);
      const shaped = feed.batches.every(([, , , generations]) => generations.length === stop.tables);
      const last = Array.from({ length: stop.tables }, (_, table) => Math.max(0, ...feed.batches.map(([, , , generations]) => generations[table] ?? 0)));
      check(feed.batches.length > 50, `wall: ${feed.batches.length} batches in 1.5 s`);
      check(inOrder, `wall: the batches out of order or missing: ${feed.batches.slice(0, 8).map(([seq]) => seq).join(', ')}…`);
      check(shaped, `wall: batches without a generation a table (${stop.tables})`);
      check(feed.refreshed > 50, `wall: ${feed.refreshed} refreshed marks in 1.5 s`);
      check(feed.drawn.length === stop.tables && feed.drawn.every((drawn, table) => drawn > 0 && drawn <= last[table]!), `wall: __contenderRefreshed ${JSON.stringify(feed.drawn)}, each table's last generation ${JSON.stringify(last)}`);
      console.log(`wall: usable ${usable.toFixed(1)}, open ${open?.toFixed(1)}, filled ${filled.toFixed(1)} ms (the cells' last paint ${filledPresented.latestPaintAfterFilledMs.toFixed(1)} ms after it); probe key ${probeMs?.toFixed(1)} ms; ${opened.rows} rows a table, ${opened.tables} tables; ${feed.batches.length} batches in order from 0, ${feed.refreshed} refreshed marks, generations drawn ${feed.drawn.join(', ')} of ${last.join(', ')}`);

      // The replay: open() fills every table again and ends the feed;
      // fling() and jump() are refused.
      await page.evaluate(() => ((globalThis as WallGlobal & { __oldBatches?: Batches }).__oldBatches = (globalThis as WallGlobal).__contender?.batches));
      const since = await now(page);
      await page.evaluate(() => (globalThis as WallGlobal).__contender!.replay.open!());
      const reopened = await lastMark(page, MARKS.open);
      const refilled = await lastMark(page, MARKS.filled);
      check(reopened !== null && reopened >= since && refilled !== null && refilled > reopened, `wall: open() resolved with open ${reopened}, filled ${refilled} (after ${since})`);
      const lengths = () =>
        page.evaluate(() => {
          const g = globalThis as WallGlobal & { __oldBatches?: Batches };
          return { old: g.__oldBatches?.length ?? -1, fresh: g.__contender?.batches?.length ?? 0, replaced: g.__oldBatches !== g.__contender?.batches };
        });
      const was = await lengths();
      await page.waitForTimeout(500);
      const then = await lengths();
      check(was.old > 0 && was.replaced, `wall: the reopen's batches ${JSON.stringify(was)}, want the old feed's array kept apart from a new one`);
      check(then.old === was.old && then.fresh === 0, `wall: ${then.old - was.old} batches to the old feed and ${then.fresh} to the new tables after the replay's open(), want the feed ended and none started`);
      const refused = await page.evaluate(async () => {
        const replay = (globalThis as WallGlobal).__contender!.replay;
        const refuses = (call: () => Promise<unknown>) => call().then(() => false, () => true);
        return { fling: await refuses(() => replay.fling!()), jump: await refuses(() => (replay.jump as unknown as (fraction: number) => Promise<unknown>)(0.9)) };
      });
      check(refused.fling && refused.jump, `wall: the replay's fling() and jump() refused: ${JSON.stringify(refused)}`);
      out.measured = { usable, open, filled, input, probeMs, opened, filledPresented, feed: { batches: feed.batches.length, inOrder, shaped, refreshed: feed.refreshed, drawn: feed.drawn, last }, reopen: { open: reopened, filled: refilled, batchesAfterOpen: then.old - was.old }, refused };
      console.log(`wall: open() → open ${reopened?.toFixed(1)}, filled ${refilled?.toFixed(1)} ms, the feed ended (${then.old - was.old} batches after it); fling() and jump() refused ${refused.fling && refused.jump}`);
      failures.push(...found.map((problem) => `wall measured page: ${problem}`));
      await context.close();
    }

    // Unmeasured: none of state, batches, refreshed marks, the generations, cell timing.
    {
      const context = await protocolContext(browser, { init: [recorder] });
      const page = await context.newPage();
      const found = problems(page);
      await page.goto(url);
      await waitMark(page, MARKS.filled, 0);
      await page.waitForTimeout(1000);
      const seen = await page.evaluate(() => {
        const g = globalThis as WallGlobal;
        return {
          state: g.__contender?.state ?? null,
          batches: g.__contender?.batches ?? null,
          refreshed: performance.getEntriesByName('contender:refreshed', 'mark').length,
          drawn: g.__contenderRefreshed ?? null,
          cellTiming: document.querySelectorAll('.row [elementtiming]').length,
        };
      });
      check(seen.state === null && seen.batches === null && seen.refreshed === 0 && seen.drawn === null && seen.cellTiming === 0, `wall without ?measure: ${JSON.stringify(seen)}`);
      out.unmeasured = seen;
      failures.push(...found.map((problem) => `wall unmeasured page: ${problem}`));
      await context.close();
    }

    // Framed, measured: every mark relayed, the refreshed ones too.
    {
      const context = await protocolContext(browser);
      const frameUrl = new URL('__frame', wall.url).href;
      await context.route(frameUrl, (route) =>
        route.fulfill({
          contentType: 'text/html',
          headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' },
          body: `<!doctype html><body style="margin:0"><script>window.__messages = []; addEventListener('message', (event) => event.origin === location.origin && __messages.push(event.data));</script><iframe src="${url}&measure" style="border:0;width:100vw;height:100vh"></iframe></body>`,
        }),
      );
      const page = await context.newPage();
      const found = problems(page);
      await page.goto(frameUrl);
      await page.waitForFunction(() => ((globalThis as { __messages?: { name: string }[] }).__messages ?? []).some((message) => message.name === 'contender:refreshed'), null, { timeout: 60_000, polling: 50 });
      await page.waitForTimeout(300);
      const frame = page.frames().find((candidate) => candidate !== page.mainFrame())!;
      const epoch = await frame.evaluate(() => performance.getEntriesByType('mark').filter((entry) => entry.name.startsWith('contender:')).map((entry) => ({ name: entry.name, at: performance.timeOrigin + entry.startTime })));
      const all = (await page.evaluate(() => (globalThis as { __messages?: unknown[] }).__messages ?? [])) as { seiza: string; name: string; at: number }[];
      const read = epoch.filter((mark) => mark.at <= Math.max(...all.map((message) => message.at)));
      const missing = read.filter((mark) => !all.some((message) => message.seiza === 'mark' && message.name === mark.name && Math.abs(message.at - mark.at) < 0.01));
      check(missing.length === 0, `wall relay: ${missing.length} marks never reached the parent, e.g. ${JSON.stringify(missing[0])}`);
      const names = [...new Set(all.map((message) => message.name))];
      check(names.includes(MARKS.filled) && names.includes(MARKS.refreshed), `wall relay: ${names.join(', ')}`);
      out.framed = { messages: all.length, marks: read.length, names };
      console.log(`wall relay: ${all.length} messages for ${read.length} marks (${names.join(', ')})`);
      failures.push(...found.map((problem) => `wall framed page: ${problem}`));
      await context.close();
    }
  } finally {
    await wall.close();
  }
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
