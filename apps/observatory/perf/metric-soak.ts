// Live tail's soak, on either bare contender page, cold, with `?measure`:
// the replay for `--minutes` (10, decided; shorter for a smoke run) at a
// stop (100k by default, the soak's one; `docs/DECISIONS.md`,
// "Measurement", 2026-11-07). Two windows, each read as `metric-tail.ts`'s
// (`tailWindow`: Row shown in, keeps up, late frames, work, collections):
// one at the start, `SETTLE_MS` after the first tail mark, and one ending
// at the soak's last second (a 10-minute trace is too large to read).
// Memory right after each: `performance.measureUserAgentSpecificMemory` by
// type (the page's `JavaScript` and `Canvas`, its workers apart) and the
// wasm's linear memory (`metric-memory.ts`'s readings), at the end again
// after a forced garbage collection; the cache's bytes under its cap; the
// rows due against the tail drawn. The harness's own logs (the clock's
// counts, the tail marks, the recorded frames) are emptied before each
// reading and every `CLEAR_EVERY_MS` between the windows, so the memory is
// the contender's. After the last reading, the throttle's
// control (`throttle-control.ts`).
//
// Usage: node apps/observatory/perf/metric-soak.ts --scenario live-tail
//          [--stop <id,…>] [--minutes 10] [--side gpui|tanstack] [--runs 3]
//          [--profile reference|throttled] [--label <name>]
// Run `just observatory gpui-build tail` and `tanstack-build tail` first.

import type { Page } from '@playwright/test';
import { waitMark } from '../../../shared-web/perf/harness.ts';
import { option } from '../../../shared-web/perf/protocol.ts';
import { TAIL_GRACE_MS, WORK_CATEGORIES } from '../metrics/metrics.ts';
import { frameRecorder, medianOf, now, openSide, runMetric, type RunResult } from './contender.ts';
import { MARKS } from './harness.ts';
import { MEMORY_ARGS, collectGarbage, pageMemory, unknownTypes, wasmRecorder, type PageMemory } from './memory-reading.ts';
import { clearLogs, tailRecorder, tailWindow, type TailWindow } from './tail-metric.ts';
import { THROTTLE_MIN, spin, throttleCheck } from './throttle-control.ts';

const SETTLE_MS = 1000;
const WINDOW_MS = 10_000;
const MINUTES = Number(option('minutes') ?? 10);
/** The soak's runs a side and profile (decided: 3), unless `--runs` asks for others. */
const SOAK_RUNS = 3;
/** Between the windows, the logs are emptied this often, so the soak's
 *  memory is the contender's, not the harness's (`clearLogs`). */
const CLEAR_EVERY_MS = 10_000;
/** The shortest soak: both windows, each with its settle and grace, and a margin. */
const SHORTEST_MS = 2 * (SETTLE_MS + WINDOW_MS + TAIL_GRACE_MS) + 10_000;
if (!(MINUTES * 60_000 >= SHORTEST_MS)) throw new Error(`--minutes ${option('minutes')}: at least ${SHORTEST_MS / 60_000} for two windows`);
/** The soak's stop, unless `--stop` asks for another. */
const SOAK_STOP = '100k';
/** The table's page cache: its cap, in the Arrow IPC bytes each page arrived as. */
const CACHE_CAP = 64 * 2 ** 20;

interface Reading extends PageMemory {
  /** Since the first tail mark, s. */
  atS: number;
  cacheBytes: number;
  /** The rows the table holds (the clock's latest count it was given) and the tail drawn, read together. */
  rows: number;
  tail: number;
}

async function reading(page: Page, since: number): Promise<Reading> {
  const memory = await pageMemory(page);
  const view = await page.evaluate(() => {
    const g = globalThis as { __contender?: { state: { rows: number; cacheBytes: number } | null }; __contenderTail?: number };
    return { at: performance.now(), rows: g.__contender?.state?.rows ?? 0, cacheBytes: g.__contender?.state?.cacheBytes ?? -1, tail: g.__contenderTail ?? 0 };
  });
  return { ...memory, atS: Number(((view.at - since) / 1000).toFixed(1)), cacheBytes: view.cacheBytes, rows: view.rows, tail: view.tail };
}

/** Waits until page time `until`, emptying the logs every `CLEAR_EVERY_MS`. */
async function waitClearing(page: Page, until: number): Promise<void> {
  for (;;) {
    await clearLogs(page);
    const left = until - (await now(page));
    if (left <= 0) return;
    await page.waitForTimeout(Math.min(left, CLEAR_EVERY_MS));
  }
}

interface Run extends RunResult {
  minutes: number;
  start: TailWindow;
  end: TailWindow;
  memoryStart: Reading;
  memoryEnd: Reading;
  memoryEndAfterGc: Reading;
  spinMs: number;
}

await runMetric<Run>(
  'soak',
  async ({ side, profile, url, picked }) => {
    const session = await openSide(side, url, profile, {
      picked,
      init: [frameRecorder, tailRecorder, wasmRecorder],
      // Without it, the measurement waits for a garbage collection (up to 20 s).
      args: MEMORY_ARGS,
    });
    const { page, browser } = session;
    try {
      const failures: string[] = [];
      if (!(await page.evaluate(() => crossOriginIsolated))) failures.push("the page isn't cross-origin isolated: no memory measurement");
      const since = await waitMark(page, MARKS.tail, 0, 180_000);
      await page.evaluate(() => document.fonts.ready);
      const trace = () => browser.startTracing(page, { categories: WORK_CATEGORIES });
      const stop = () => browser.stopTracing();
      const start = await tailWindow(page, trace, stop, SETTLE_MS, WINDOW_MS);
      await clearLogs(page);
      const memoryStart = await reading(page, since);
      // The end window closes at the soak's last second (its grace after it).
      await waitClearing(page, since + MINUTES * 60_000 - WINDOW_MS - SETTLE_MS);
      const end = await tailWindow(page, trace, stop, SETTLE_MS, WINDOW_MS);
      await clearLogs(page);
      const memoryEnd = await reading(page, since);
      await collectGarbage(session);
      const memoryEndAfterGc = await reading(page, since);
      for (const taken of [memoryStart, memoryEnd, memoryEndAfterGc]) {
        failures.push(...unknownTypes(taken));
        if (taken.cacheBytes < 0 || taken.cacheBytes > CACHE_CAP) failures.push(`the cache at ${taken.cacheBytes} bytes, past its cap`);
      }
      for (const [name, window] of [['the start', start], ['the end', end]] as const) if (window.rowShownInP50Ms === null) failures.push(`${name}: no count shown in its window`);
      const spinMs = await spin(page);
      const throttled = throttleCheck(side, profile, spinMs);
      if (throttled) failures.push(throttled);
      return { minutes: MINUTES, start, end, memoryStart, memoryEnd, memoryEndAfterGc, spinMs: Number(spinMs.toFixed(1)), failures: [...session.problems, ...failures] };
    } finally {
      await session.close();
    }
  },
  (runs) => {
    const mib = (pick: (run: Run) => number | undefined) => medianOf(runs, (run) => {
      const value = pick(run);
      return value === undefined ? undefined : value / 2 ** 20;
    });
    const types = [...new Set(runs.flatMap((run) => Object.keys(run.memoryEnd.pageByType)))];
    return {
      pageMiBStart: mib((run) => run.memoryStart.pageBytes),
      pageMiBEnd: mib((run) => run.memoryEnd.pageBytes),
      pageMiBEndRuns: runs.map((run) => Number((run.memoryEnd.pageBytes / 2 ** 20).toFixed(1))),
      pageMiBEndAfterGc: mib((run) => run.memoryEndAfterGc.pageBytes),
      pageMiBStartByType: Object.fromEntries(types.map((type) => [type, mib((run) => run.memoryStart.pageByType[type])])),
      pageMiBEndByType: Object.fromEntries(types.map((type) => [type, mib((run) => run.memoryEnd.pageByType[type])])),
      wasmMiBStart: mib((run) => run.memoryStart.wasmBytes),
      wasmMiBEnd: mib((run) => run.memoryEnd.wasmBytes),
      workerMiBEnd: mib((run) => run.memoryEnd.workerBytes),
      cacheMiBEnd: mib((run) => run.memoryEnd.cacheBytes),
      rowsEnd: medianOf(runs, (run) => run.memoryEnd.rows, 0),
      tailBehindRowsEnd: medianOf(runs, (run) => run.memoryEnd.rows - run.memoryEnd.tail, 0),
      latePctStart: medianOf(runs, (run) => run.start.latePct),
      latePctEnd: medianOf(runs, (run) => run.end.latePct),
      collectionsIn10sStart: medianOf(runs, (run) => (run.start.collections.count * 10_000) / run.start.windowMs),
      collectionsIn10sEnd: medianOf(runs, (run) => (run.end.collections.count * 10_000) / run.end.windowMs),
      rowShownInP95MsStart: medianOf(runs, (run) => run.start.rowShownInP95Ms),
      rowShownInP95MsEnd: medianOf(runs, (run) => run.end.rowShownInP95Ms),
      workP50MsEnd: medianOf(runs, (run) => run.end.workP50Ms, 2),
      spinMs: medianOf(runs, (run) => run.spinMs),
    };
  },
  { minutes: MINUTES, settleMs: SETTLE_MS, windowMs: WINDOW_MS, cacheCap: CACHE_CAP, throttleMin: THROTTLE_MIN },
  { levels: ['tail'], defaultStop: SOAK_STOP, defaultRuns: SOAK_RUNS },
);
