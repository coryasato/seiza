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
//
// Usage: node apps/observatory/perf/tanstack-contract.ts [--label <name>]
// --label writes perf/results/<date>-<label>.json. Needs `just observatory
// data`; run `just observatory tanstack-build` first.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Page } from '@playwright/test';
import { waitMark } from '../../../shared-web/perf/harness.ts';
import { machineInfo, option } from '../../../shared-web/perf/protocol.ts';
import { MARKS, dataFile, lastMark, nativeDuckDB, perfDir, problems, protocolContext, serveTanstack } from './harness.ts';

const PORT = 4321;
/** The data layer's chunk: the engine's start imports it first. */
const DATA_LAYER = /\/assets\/table-[\w-]+\.js$/;
/** Two frames at 60 Hz: the probe's "within a frame or two". */
const PROBE_MS = 2 * (1000 / 60);
/** How long after the filled mark its cells may paint: three frames. */
const PRESENT_MS = 50;
/** The entry chunk, held back for the probe's control. */
const ENTRY = /\/assets\/index-[\w-]+\.js$/;

const label = option('label');
const failures: string[] = [];
const output: Record<string, unknown> = { date: new Date().toISOString().slice(0, 10), label, ...machineInfo() };
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

/** The visible rows' cells painted after `since`: the latest paint, and
 *  the visible rows with none. Element Timing entries arrive after the
 *  paint, in an observer's task: waits up to 2 s for every row's. */
async function cellsPainted(page: Page, since: number, state: State) {
  const read = ({ since, first, end }: { since: number; first: number; end: number }) => {
    const painted = ((globalThis as Global).__painted ?? []).filter((entry) => entry.id.startsWith('row:') && entry.renderTime >= since);
    const rows = new Map<number, number>();
    for (const entry of painted) {
      const row = Number(entry.id.slice(4));
      if (row >= first && row < end) rows.set(row, Math.max(rows.get(row) ?? 0, entry.renderTime));
    }
    const missing: number[] = [];
    for (let row = first; row < end; row++) if (!rows.has(row)) missing.push(row);
    return { latest: Math.max(0, ...rows.values()), missing };
  };
  const args = { since, first: state.first, end: state.end };
  await page.waitForFunction(`(${read.toString()})(${JSON.stringify(args)}).missing.length === 0`, null, { timeout: 2_000, polling: 20 }).catch(() => {});
  return page.evaluate(read, args);
}

/** The filled mark after `since` is presented: the visible rows' new
 *  cells all painted, the latest within PRESENT_MS after the mark. */
async function presented(page: Page, what: string, since: number, filled: number, state: State) {
  const cells = await cellsPainted(page, since, state);
  const late = cells.latest - filled;
  check(cells.missing.length === 0, `${what}: visible rows without a new cell's paint: ${cells.missing.slice(0, 5).join(', ')}${cells.missing.length > 5 ? '…' : ''}`);
  check(late >= 0 && late <= PRESENT_MS, `${what}: the cells' last paint ${late.toFixed(1)} ms after the filled mark (0–${PRESENT_MS})`);
  return { latestPaintAfterFilledMs: late, missing: cells.missing.length };
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
    await page.keyboard.press('Shift');
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
    const openPresented = await presented(page, 'open', open ?? 0, filled, opened);
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
    const endPresented = await presented(page, 'End', endAt, endFilled, atEnd);
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
    await page.keyboard.press('Shift');
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
    await page.keyboard.press('Shift');
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
