// M4 checks: the virtualized table over paged queries, on the release build.
//
// Per run (a new browser, Chromium headless=new, 1440×900 at DPR 2, engine
// warm, i.e. "Parquet ready"):
// 1. File → first rows: click "Try sample" → `tycho:first-rows` (set right
//    after the first frame with every visible row loaded). Budget ≤ 500 ms.
//    The overlay's "Sample → first rows" must match the app's own marks
//    (`tycho:sample-click` → `tycho:first-rows`) within 5 ms.
// 2. Jump: drag the scrollbar thumb to 90% and release → the next
//    `tycho:viewport-filled`. Budget ≤ 400 ms. Every frame meanwhile must
//    draw a row (loaded or placeholder) for every visible position.
// 3. Last row: End → the last visible row is row `count(*)`, and its key (spkid, or source_id) is
//    the file's last (both read through the app's bridge, `?bench`).
// 4. Fling: Home, then wheel events top → bottom in ~3 s. Frame intervals
//    from an in-page rAF recorder: p95 ≤ 20 ms, none > 50 ms. The overlay's
//    frame row is recorded alongside.
// 5. Steady scroll (recorded): ~1,800 rows/s for 3 s from row 400,000; the
//    share of frames that showed a placeholder.
// Fling and steady scroll also record per-frame work time (`workRecorder`:
// every rAF callback that drew), p50/p95, next to the intervals (M7).
// --sample gaia runs all of it on the big sample (M7 part B).
// The memory pass (--memory) drags the thumb one pixel at a time through the
// whole file twice, waiting for each viewport to fill, and records wasm
// memory, JS heap, the page cache, and measureUserAgentSpecificMemory (which
// includes DuckDB's worker) after each pass. Wasm + JS heap must stay under
// MEMORY_CAP_MIB and not grow more than 10% between passes.
//
// Usage: node apps/tycho/perf/table.ts [--runs 10] [--label m4-table] [--reference-only] [--sample asteroids|gaia]
//                                      [--sweep] [--sweep-runs 5] [--memory] [--passes 2]
//                                      [--memory-only] [--browsers] [--browsers-only]
// --browsers adds a table check in Chromium, Firefox, and WebKit (first rows,
// scrollbar jump, a track click and a cancelled pointer that must not leave a
// drag on, wheel, End → last row); the frame budgets are Chromium's.
// --sweep runs page size {256, 1024, 4096} × prefetch {1, 2, 4} (`?page=`,
// `?prefetch=`) instead of the protocol runs. Writes
// perf/results/<date>-<label>.json. Run `just tycho build` first.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, firefox, webkit, type BrowserType, type Page } from '@playwright/test';
import { preview } from 'vite';
import { assertPortFree, startWorkerDev, WORKER_DEV_PORT } from '../worker/scripts/dev.ts';
import { PROFILES, flag, machineInfo, option, summarize, type Profile } from './common.ts';
import {
  clickTarget,
  fling,
  frameRecorder,
  framesBetween,
  open,
  overlayValue,
  percentiles,
  startCountingProxy,
  targetRect,
  waitMark,
  waitOverlay,
  wheel,
  workBetween,
  workRecorder,
  type TableProbe,
} from './harness.ts';

const perfDir = dirname(fileURLToPath(import.meta.url));
const webDir = join(perfDir, '../web');
const manifest = JSON.parse(readFileSync(join(perfDir, '../data/MANIFEST.json'), 'utf8')) as Record<string, { rows: number; bytes: number; sha256: string }>;
/** The samples as `crate/src/dataset.rs` names them: file, button, and key column. */
const SAMPLES = {
  asteroids: { name: 'asteroids.parquet', target: 'try-sample-asteroids', key: 'spkid' },
  gaia: { name: 'gaia-dr3-bright.parquet', target: 'try-sample-gaia', key: 'source_id' },
};
const sampleName = option('sample') ?? 'asteroids';
if (!(sampleName in SAMPLES)) throw new Error(`--sample ${sampleName}: ${Object.keys(SAMPLES).join(' or ')}`);
const SAMPLE = SAMPLES[sampleName as keyof typeof SAMPLES];
const FILE = manifest[SAMPLE.name]!;

const BUDGET = { firstRowsMs: 500, jumpMs: 400, flingP95Ms: 20, flingMaxMs: 50 };
/**
 * The M4 memory cap: wasm memory + live main-thread JS heap after scrolling
 * the whole sample. The page cache holds at most 64 MiB (`Paging`'s budget)
 * and the shell ~16 MiB. Wasm memory never shrinks, and the allocator's
 * fragmentation adds ~21 MiB on top of the cache by the second pass, then
 * holds (M4: 101.2 MiB wasm from pass 2 through 5, JS ~4 MiB). DuckDB's
 * worker is recorded, not capped.
 */
const MEMORY_CAP_MIB = 128;
const runs = Number(option('runs') ?? 10);
const passes = Number(option('passes') ?? 2);
const sweepRuns = Number(option('sweep-runs') ?? 5);
const label = option('label') ?? (sampleName === 'gaia' ? (flag('sweep') ? 'm7-sweep-gaia' : 'm7-table-gaia') : flag('sweep') ? 'm4-sweep' : 'm4-table');

type Global = { __tychoTable?: TableProbe; __tychoBridge?: { query(sql: string, id: number): Promise<Uint8Array> } };

const now = (page: Page) => page.evaluate(() => performance.now());
const probe = (page: Page) => page.evaluate(() => (globalThis as Global).__tychoTable ?? null);

/** One SQL answer as text, found in the raw IPC bytes by a marker. */
async function sqlText(page: Page, sql: string): Promise<string | null> {
  return page.evaluate(async (sql) => {
    const bytes = await (globalThis as Global).__tychoBridge!.query(`SELECT 'VAL:' || (${sql}) || ':END' AS v`, 3_000_000 + Math.floor(Math.random() * 1_000_000));
    return /VAL:(.*?):END/.exec(new TextDecoder('latin1').decode(bytes))?.[1] ?? null;
  }, sql);
}

async function waitFilled(page: Page, since: number, timeout = 30_000): Promise<number> {
  return waitMark(page, 'tycho:viewport-filled', since, timeout);
}

/**
 * GPUI fires a press only on an element it considers hovered, and WebKit can
 * deliver a scripted press before the move that preceded it has updated
 * hover. A person always hovers first; the scripts wait two frames.
 */
async function hoverSettles(page: Page): Promise<void> {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

/** Drags the vertical scrollbar thumb so its top lands at `fraction` of its travel. */
async function dragThumbTo(page: Page, fraction: number): Promise<number> {
  const [tx, ty, tw, th] = await targetRect(page, 'table-scroll-thumb');
  const [, trackY, , trackH] = await targetRect(page, 'table-scroll-track');
  await page.mouse.move(tx + tw / 2, ty + th / 2);
  await hoverSettles(page);
  await page.mouse.down();
  const targetY = trackY + (trackH - th) * fraction + th / 2;
  await page.mouse.move(tx + tw / 2, targetY, { steps: 4 });
  const released = await now(page);
  await page.mouse.up();
  return released;
}

type Work = ReturnType<typeof percentiles>;
const workIn = async (page: Page, from: number, to: number): Promise<Work> => percentiles((await workBetween(page, from, to)).map((sample) => sample.ms));

interface Run {
  /** Playwright's click → the mark (what the budget applies to). */
  firstRowsMs: number;
  /** The app's click mark → the mark; the overlay must match it. */
  appFirstRowsMs: number;
  overlayFirstRowsMs: number | null;
  jumpMs: number;
  jumpTop: number;
  jumpBlankFrames: number;
  lastRow: { ok: boolean; detail: string };
  fling: Awaited<ReturnType<typeof framesBetween>> & { durationMs: number; reachedEnd: boolean; stoppedAt: string; overlay: string | null; work: Work };
  steady: Awaited<ReturnType<typeof framesBetween>> & { work: Work; from: number };
  problems: string[];
}

async function measure(url: string, profile: Profile | null, params: Record<string, string>): Promise<Run> {
  const run = await open(chromium, url, { profile, params: { bench: '', ...params }, init: [workRecorder] });
  const { page } = run;
  try {
    await page.evaluate(frameRecorder);
    await waitOverlay(page, 'Parquet ready', /ms$/, 180_000);
    // 1. File → first rows.
    const clickedAt = await now(page);
    await clickTarget(page, SAMPLE.target);
    const firstRows = await waitMark(page, 'tycho:first-rows', clickedAt, 60_000);
    const overlay = await waitOverlay(page, 'Sample → first rows', /ms$|—/, 10_000);
    // The app times from its own click handler, which marks this.
    const appClick = await waitMark(page, 'tycho:sample-click', clickedAt, 10_000);
    await page.waitForTimeout(300);

    // 2. Jump to 90% with the scrollbar.
    const released = await dragThumbTo(page, 0.9);
    const filled = await waitFilled(page, released);
    const jumped = await probe(page);
    const jumpFrames = await framesBetween(page, released - 200, filled + 50);

    // 3. The last row.
    const endPressed = await now(page);
    await page.keyboard.press('End');
    await waitFilled(page, endPressed).catch(() => null);
    await page.waitForTimeout(100);
    const atEnd = await probe(page);
    const file = `read_parquet('${SAMPLE.name}'`;
    const count = await sqlText(page, `SELECT count(*) FROM ${file})`);
    const lastKey = await sqlText(page, `SELECT ${SAMPLE.key} FROM ${file}, file_row_number = true) WHERE file_row_number = (SELECT count(*) - 1 FROM ${file}))`);
    const lastOk = !!atEnd && atEnd.end === atEnd.rows && String(atEnd.rows) === count && atEnd.lastCell === lastKey && atEnd.pending === 0;
    const lastRow = { ok: lastOk, detail: `end ${atEnd?.end}/${atEnd?.rows} rows, count(*) ${count}, last ${SAMPLE.key} shown ${atEnd?.lastCell}, file ${lastKey}` };

    // 4. Fling: Home, then top → bottom in ~3 s of wheel events.
    const homePressed = await now(page);
    await page.keyboard.press('Home');
    await waitFilled(page, homePressed).catch(() => null);
    const { start: flingStart, end: flingEnd } = await fling(page, FILE.rows);
    await page.waitForTimeout(500);
    const afterFling = await probe(page);
    const flingFrames = await framesBetween(page, flingStart, flingEnd + 500);
    const flingWork = await workIn(page, flingStart, flingEnd + 500);
    const flingOverlay = await overlayValue(page, 'Frame time (2 s)');

    // 5. Steady scroll from row 400,000: ~1,800 rows/s. Home first: the
    // fling left the thumb at the bottom of its track, under the open
    // observation panel, where a press lands on the panel (M7).
    const homeAgain = await now(page);
    await page.keyboard.press('Home');
    await waitFilled(page, homeAgain).catch(() => null);
    await dragThumbTo(page, 400_000 / FILE.rows);
    await page.waitForTimeout(800);
    const steadyFrom = (await probe(page))?.top ?? -1;
    const steadyStart = await now(page);
    const steadyWall = Date.now();
    while (Date.now() - steadyWall < 3_000) {
      await wheel(page, 900);
      await page.waitForTimeout(16);
    }
    const steadyEnd = await now(page);
    const steady = { ...(await framesBetween(page, steadyStart, steadyEnd)), work: await workIn(page, steadyStart, steadyEnd), from: steadyFrom };

    return {
      firstRowsMs: firstRows - clickedAt,
      appFirstRowsMs: firstRows - appClick,
      overlayFirstRowsMs: /ms$/.test(overlay) ? Number.parseFloat(overlay) : null,
      jumpMs: filled - released,
      jumpTop: jumped?.top ?? -1,
      jumpBlankFrames: jumpFrames.blankFrames,
      lastRow,
      fling: { ...flingFrames, durationMs: flingEnd - flingStart, reachedEnd: afterFling?.end === afterFling?.rows, stoppedAt: afterFling ? `rows ${afterFling.first}–${afterFling.end} of ${afterFling.rows}` : 'no table', overlay: flingOverlay, work: flingWork },
      steady,
      problems: run.problems,
    };
  } finally {
    await run.close();
  }
}

/** Shows or hides the observation panel (Ctrl+Shift+P). The memory passes
 *  drag with it hidden: it covers the bottom of the scrollbar track, where
 *  a press on the thumb would land on the panel (M7). */
async function setPanel(page: Page, open: boolean): Promise<void> {
  const visible = () => page.evaluate(() => (globalThis as { __seizaPerfOverlay?: unknown }).__seizaPerfOverlay !== undefined);
  if ((await visible()) === open) return;
  await page.keyboard.press('Control+Shift+P');
  await page.waitForFunction((open) => ((globalThis as { __seizaPerfOverlay?: unknown }).__seizaPerfOverlay !== undefined) === open, open, { timeout: 5_000 });
}

/**
 * App memory: the app's wasm memory and the main thread's live JS heap (after
 * a forced GC), as the overlay shows them (MiB). DuckDB's worker isn't in it; the whole page's
 * total (workers included) comes from measureUserAgentSpecificMemory.
 */
async function memorySnapshot(page: Page) {
  await setPanel(page, true);
  // Live memory, not GC timing: dropped result buffers otherwise swing the JS
  // heap by ~20 MiB between identical passes (M4). Wasm memory only grows,
  // so it's exact either way.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('HeapProfiler.collectGarbage');
  await cdp.detach();
  // The overlay refreshes every 500 ms.
  await page.waitForTimeout(1_200);
  const overlay = (await overlayValue(page, 'Memory')) ?? '';
  const [, wasm, js] = /wasm ([\d.]+) · JS ([\d.]+) MiB/.exec(overlay) ?? [];
  const allAgentsBytes = await page.evaluate(async () => {
    try {
      return (await (performance as unknown as { measureUserAgentSpecificMemory(): Promise<{ bytes: number }> }).measureUserAgentSpecificMemory()).bytes;
    } catch {
      // Needs crossOriginIsolated, which the app has; null elsewhere.
      return null;
    }
  });
  return {
    wasmMiB: wasm === undefined ? null : Number(wasm),
    jsHeapMiB: js === undefined ? null : Number(js),
    allAgentsMiB: allAgentsBytes === null ? null : Number((allAgentsBytes / 2 ** 20).toFixed(1)),
    pages: await overlayValue(page, 'Pages'),
  };
}

/** Drags the thumb through the whole file `passes` times, a pixel at a time,
 *  each step waiting for the viewport to fill; memory after each pass. */
async function memoryPass(url: string, passes = 2) {
  const run = await open(chromium, url, { params: { bench: '' } });
  const { page } = run;
  try {
    await waitOverlay(page, 'Parquet ready', /ms$/, 180_000);
    await clickTarget(page, SAMPLE.target);
    await waitMark(page, 'tycho:first-rows', 0, 60_000);
    const opened = await memorySnapshot(page);
    const [tx, ty, tw, th] = await targetRect(page, 'table-scroll-thumb');
    const [, trackY, , trackH] = await targetRect(page, 'table-scroll-track');
    const travel = Math.floor(trackH - th);
    const started = Date.now();
    const afterPass = [];
    for (let pass = 0; pass < passes; pass++) {
      await setPanel(page, false);
      await page.mouse.move(tx + tw / 2, (pass === 0 ? ty : trackY + travel) + th / 2);
      await hoverSettles(page);
      await page.mouse.down();
      for (let step = 0; step <= travel; step++) {
        const offset = pass % 2 === 0 ? step : travel - step;
        const before = await now(page);
        const previousTop = (await probe(page))?.top ?? null;
        await page.mouse.move(tx + tw / 2, trackY + offset + th / 2);
        // Read the table only once it has drawn the new position: right
        // after the move it still reports the last, filled viewport.
        await page
          .waitForFunction((previousTop) => (globalThis as Global).__tychoTable?.top !== previousTop, previousTop, { timeout: 5_000, polling: 'raf' })
          .catch(() => null);
        const table = await probe(page);
        if (table && table.pending > 0) await waitFilled(page, before, 30_000).catch(() => null);
      }
      await page.mouse.up();
      afterPass.push(await memorySnapshot(page));
    }
    return { seconds: (Date.now() - started) / 1000, thumbTravelPx: travel, opened, afterPass, problems: run.problems };
  } finally {
    await run.close();
  }
}

/** The table in another engine: it opens, jumps, scrolls by wheel, and
 *  reaches the last row, with no console errors. */
async function browserCheck(engine: BrowserType, url: string) {
  const run = await open(engine, url, { params: { bench: '' } });
  const { page } = run;
  try {
    await waitOverlay(page, 'Parquet ready', /ms$/, 180_000);
    // The track click below lands at 97% of the track, under the open panel.
    await setPanel(page, false);
    const clickedAt = await now(page);
    await clickTarget(page, SAMPLE.target);
    const firstRows = (await waitMark(page, 'tycho:first-rows', clickedAt, 60_000)) - clickedAt;
    const released = await dragThumbTo(page, 0.9);
    const jump = (await waitFilled(page, released)) - released;
    const jumped = await probe(page);
    // A quick click on the track, below the thumb, then the pointer moves
    // off: the table must jump once and then stay put (a release missed in
    // the click's frame once left the drag on, and the move scrolled).
    const [x, y, w, h] = await targetRect(page, 'table-scroll-track');
    await page.mouse.move(x + w / 2, y + h * 0.97);
    await hoverSettles(page);
    await page.mouse.click(x + w / 2, y + h * 0.97);
    await page.waitForTimeout(300);
    const clicked = await probe(page);
    await page.mouse.move(x - 400, y + h / 2, { steps: 4 });
    await page.waitForTimeout(300);
    const afterMove = await probe(page);
    const staysPut = !!clicked && clicked.top > (jumped?.top ?? 0) && afterMove?.top === clicked.top;
    // A drag whose release never arrives (the browser cancels the pointer):
    // the next move, with no button held, must end it, not drag the table.
    const [tx, ty, tw, th] = await targetRect(page, 'table-scroll-thumb');
    await page.mouse.move(tx + tw / 2, ty + th / 2);
    await hoverSettles(page);
    await page.mouse.down();
    await page.evaluate(() => {
      const canvas = document.querySelector('canvas')!;
      canvas.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1, bubbles: true }));
    });
    const cancelledAt = await probe(page);
    await page.mouse.move(x - 400, y + h * 0.1, { steps: 4 });
    await page.waitForTimeout(300);
    const afterCancel = await probe(page);
    await page.mouse.up();
    const cancelEnds = afterCancel?.top === cancelledAt?.top;
    await wheel(page, 3_000);
    await page.waitForTimeout(500);
    const wheeled = await probe(page);
    const endPressed = await now(page);
    await page.keyboard.press('End');
    await waitFilled(page, endPressed).catch(() => null);
    await page.waitForTimeout(200);
    const atEnd = await probe(page);
    const rowsMoved = (wheeled?.top ?? 0) - (afterCancel?.top ?? 0);
    const ok =
      run.problems.length === 0 &&
      staysPut &&
      cancelEnds &&
      Math.abs((jumped?.top ?? 0) / FILE.rows - 0.9) < 0.01 &&
      Math.abs(rowsMoved - 100) < 1 &&
      atEnd?.end === FILE.rows &&
      atEnd.pending === 0;
    return {
      browser: engine.name(),
      ok,
      detail:
        `first rows ${firstRows.toFixed(0)} ms, jump ${jump.toFixed(0)} ms, track click ${clicked?.top.toFixed(0)} → after moving off ${afterMove?.top.toFixed(0)}` +
        ` (${staysPut ? 'stayed' : 'MOVED'}), cancelled drag ${cancelEnds ? 'ended' : `MOVED ${cancelledAt?.top.toFixed(0)} → ${afterCancel?.top.toFixed(0)}`}, 3000 px wheel moved ${rowsMoved.toFixed(2)} rows, end ${atEnd?.end}/${FILE.rows}`,
      problems: run.problems,
    };
  } finally {
    await run.close();
  }
}

const WORKER_PORT = 8792;
// Before starting anything: a `just tycho dev` already on it would otherwise
// fail the proxy below and leave this script's Worker running.
await assertPortFree(WORKER_DEV_PORT);
const worker = await startWorkerDev({ port: WORKER_PORT, requireObject: SAMPLE.name });
// Vite's preview proxy sends /data/* to WORKER_DEV_PORT; the proxy there
// forwards to this Worker (counting bytes, unused here).
let proxy: Awaited<ReturnType<typeof startCountingProxy>>;
let server: Awaited<ReturnType<typeof preview>>;
try {
  proxy = await startCountingProxy(WORKER_DEV_PORT, WORKER_PORT);
  server = await preview({ root: webDir, preview: { port: 4179, strictPort: true }, logLevel: 'warn' });
} catch (error) {
  await worker.close();
  throw error;
}
const url = 'http://localhost:4179/';
const date = new Date().toISOString().slice(0, 10);
const failures: string[] = [];

const summarizeRuns = (list: Run[]) => ({
  runs: list.length,
  firstRowsMs: summarize(list.map((run) => run.firstRowsMs)),
  jumpMs: summarize(list.map((run) => run.jumpMs)),
  flingP95Ms: summarize(list.map((run) => run.fling.p95)),
  flingMaxMs: summarize(list.map((run) => run.fling.max)),
  flingOver50: summarize(list.map((run) => run.fling.over50), 0),
  flingPlaceholderShare: summarize(list.map((run) => run.fling.placeholderFrames / Math.max(1, run.fling.frames)), 3),
  flingWorkP50Ms: summarize(list.map((run) => run.fling.work.p50)),
  flingWorkP95Ms: summarize(list.map((run) => run.fling.work.p95)),
  steadyP95Ms: summarize(list.map((run) => run.steady.p95)),
  steadyWorkP50Ms: summarize(list.map((run) => run.steady.work.p50)),
  steadyWorkP95Ms: summarize(list.map((run) => run.steady.work.p95)),
  steadyPlaceholderShare: summarize(list.map((run) => run.steady.placeholderFrames / Math.max(1, run.steady.frames)), 3),
});

const log = (name: string, run: Run) =>
  console.log(
    `${name} first rows ${run.firstRowsMs.toFixed(1)} ms (app ${run.overlayFirstRowsMs ?? '—'}), jump ${run.jumpMs.toFixed(1)} ms (top ${run.jumpTop.toFixed(0)}, ${run.jumpBlankFrames} blank), ` +
      `fling ${run.fling.durationMs.toFixed(0)} ms p50 ${run.fling.p50.toFixed(1)} p95 ${run.fling.p95.toFixed(1)} max ${run.fling.max.toFixed(1)} (${run.fling.over50} >50, ${(
        (run.fling.placeholderFrames / Math.max(1, run.fling.frames)) *
        100
      ).toFixed(0)}% placeholder, end ${run.fling.reachedEnd}; overlay ${run.fling.overlay}; work p50 ${run.fling.work.p50.toFixed(1)} p95 ${run.fling.work.p95.toFixed(1)}), ` +
      `steady p95 ${run.steady.p95.toFixed(1)} work p50 ${run.steady.work.p50.toFixed(1)} p95 ${run.steady.work.p95.toFixed(1)} ${((run.steady.placeholderFrames / Math.max(1, run.steady.frames)) * 100).toFixed(0)}% placeholder; last row ${run.lastRow.ok ? 'ok' : `FAIL ${run.lastRow.detail}`}` +
      (run.problems.length ? `  PROBLEMS: ${run.problems.join('; ')}` : ''),
  );

const output: Record<string, unknown> = { date, label, ...machineInfo(), file: { name: SAMPLE.name, ...FILE }, budgets: { ...BUDGET, memoryCapMiB: MEMORY_CAP_MIB } };
try {
  if (flag('memory-only') || flag('browsers-only')) {
    // Just the passes below.
  } else if (flag('sweep')) {
    const sweep: Record<string, ReturnType<typeof summarizeRuns>> = {};
    for (const pageRows of [256, 1024, 4096]) {
      for (const prefetch of [1, 2, 4]) {
        const name = `page ${pageRows} × prefetch ${prefetch}`;
        const list: Run[] = [];
        for (let index = 0; index < sweepRuns; index++) {
          const run = await measure(url, null, { page: String(pageRows), prefetch: String(prefetch) });
          list.push(run);
          log(name.padEnd(24), run);
        }
        sweep[name] = summarizeRuns(list);
      }
    }
    output.sweep = sweep;
  } else {
    const profiles: Record<string, ReturnType<typeof summarizeRuns>> = {};
    const all: Record<string, Run[]> = {};
    for (const profile of flag('reference-only') ? PROFILES.slice(0, 1) : PROFILES) {
      const list: Run[] = [];
      for (let index = 0; index < runs; index++) {
        const run = await measure(url, profile, {});
        list.push(run);
        log(profile.name.padEnd(9), run);
        const where = `${profile.name} run ${index + 1}`;
        failures.push(...run.problems.map((problem) => `${where}: ${problem}`));
        if (!run.lastRow.ok) failures.push(`${where}: last row ${run.lastRow.detail}`);
        if (run.jumpBlankFrames > 0) failures.push(`${where}: ${run.jumpBlankFrames} frames drew a blank row position during the jump`);
        if (!run.fling.reachedEnd) failures.push(`${where}: the fling didn't reach the last row (stopped at ${run.fling.stoppedAt})`);
        if (Math.abs(run.steady.from - 400_000) > FILE.rows * 0.01) failures.push(`${where}: the steady scroll started at row ${run.steady.from}, not ~400,000`);
        if (Math.abs(run.jumpTop / FILE.rows - 0.9) > 0.01) failures.push(`${where}: the jump landed at row ${run.jumpTop}, not ~90%`);
        if (run.overlayFirstRowsMs === null || Math.abs(run.overlayFirstRowsMs - run.appFirstRowsMs) > 5) {
          failures.push(`${where}: overlay first rows ${run.overlayFirstRowsMs} ms vs the marks' ${run.appFirstRowsMs.toFixed(1)} ms`);
        }
      }
      profiles[profile.name] = summarizeRuns(list);
      all[profile.name] = list;
    }
    const reference = profiles.reference!;
    if (reference.firstRowsMs!.median > BUDGET.firstRowsMs) failures.push(`reference first rows ${reference.firstRowsMs!.median} ms > ${BUDGET.firstRowsMs} ms`);
    if (reference.jumpMs!.median > BUDGET.jumpMs) failures.push(`reference jump ${reference.jumpMs!.median} ms > ${BUDGET.jumpMs} ms`);
    if (reference.flingP95Ms!.max > BUDGET.flingP95Ms) failures.push(`reference fling p95 up to ${reference.flingP95Ms!.max} ms > ${BUDGET.flingP95Ms} ms`);
    if (reference.flingMaxMs!.max > BUDGET.flingMaxMs) failures.push(`reference fling frame up to ${reference.flingMaxMs!.max} ms > ${BUDGET.flingMaxMs} ms`);
    output.profiles = profiles;
    output.runs = all;
  }
  if (flag('browsers') || flag('browsers-only')) {
    const checks = [];
    for (const engine of [chromium, firefox, webkit]) {
      const check = await browserCheck(engine, url);
      checks.push(check);
      console.log(`${check.browser}: ${check.ok ? 'ok' : 'FAIL'} (${check.detail})${check.problems.length ? `  PROBLEMS: ${check.problems.join('; ')}` : ''}`);
      if (!check.ok) failures.push(`${check.browser}: ${check.detail} ${check.problems.join('; ')}`);
    }
    output.browsers = checks;
  }
  if (flag('memory') || flag('memory-only')) {
    const memory = await memoryPass(url, passes);
    const show = (snapshot: (typeof memory)['opened']) =>
      `wasm ${snapshot.wasmMiB} + JS ${snapshot.jsHeapMiB} MiB (all agents ${snapshot.allAgentsMiB} MiB; ${snapshot.pages})`;
    console.log(`memory: opened ${show(memory.opened)}`);
    memory.afterPass.forEach((snapshot, index) => console.log(`memory: after pass ${index + 1} ${show(snapshot)}`));
    failures.push(...memory.problems.map((problem) => `memory pass: ${problem}`));
    const last = memory.afterPass.at(-1)!;
    // Growth is judged from the second-to-last pass, after the cache first filled.
    const first = memory.afterPass.at(-2) ?? memory.afterPass[0]!;
    const app = (snapshot: typeof last) => (snapshot.wasmMiB ?? Infinity) + (snapshot.jsHeapMiB ?? Infinity);
    if (app(last) > MEMORY_CAP_MIB) failures.push(`app memory ${app(last).toFixed(1)} MiB after ${memory.afterPass.length} passes > cap ${MEMORY_CAP_MIB} MiB`);
    // A leak grows every pass; a full cache doesn't.
    if (app(last) > app(first) * 1.1) failures.push(`app memory grew ${app(first).toFixed(1)} → ${app(last).toFixed(1)} MiB between passes`);
    output.memory = memory;
  }
} finally {
  await server.close();
  proxy.close();
  await worker.close();
}

output.failures = failures;
const out = option('out') ?? join(perfDir, 'results', `${date}-${label}.json`);
writeFileSync(out, `${JSON.stringify(output, null, 2)}\n`);
for (const [name, summary] of Object.entries((output.profiles ?? output.sweep ?? {}) as Record<string, ReturnType<typeof summarizeRuns>>)) {
  console.log(`\n${name}: ${JSON.stringify(summary)}`);
}
console.log(`wrote ${out}`);
if (failures.length) {
  console.error(`\nFAIL\n${failures.map((failure) => `  ${failure}`).join('\n')}`);
  process.exit(1);
}
console.log('\nPASS');
