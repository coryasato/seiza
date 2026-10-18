// Cost, on either bare contender page, cold, over one session of use: the
// load until the file's first rows are on screen, then the fling to the last
// row (`metric-fling.ts`'s input), until it rests there. Main-thread CPU
// from Chromium's trace, started before the page loads (every task's busy
// time, the load and the use apart: metrics/metrics.ts, `frameWork`);
// memory once open and at the end (`performance.measureUserAgentSpecificMemory`,
// the page's own and its workers' (the engine's, the same on both sides)
// apart, and Chromium's JS heap and DOM nodes); and the bytes received, by
// what they are: the page (its HTML, JS, wasm, CSS, font), the engine
// (DuckDB-Wasm and its JS chunk, the same files on both sides), the data.
//
// Usage: node apps/observatory/perf/metric-cost.ts [--side gpui|tanstack]
//          [--runs 10] [--profile reference|throttled] [--label <name>]
// Run `just observatory gpui-build` and `tanstack-build` first.

import type { Page, Request } from '@playwright/test';
import { ORIGIN_MARK, Trace, WORK_CATEGORIES, frameWork } from '../metrics/metrics.ts';
import { filledState, fling, inputRecorder, medianOf, now, opened, openSide, originMark, pressProbeKey, readyFling, runMetric, wheels, type RunResult, type Session } from './contender.ts';
import { ENGINE_CHUNK } from './harness.ts';

type Kind = 'page' | 'engine' | 'data';
const kindOf = (url: string): Kind => {
  const path = new URL(url).pathname;
  if (path.startsWith('/observatory/data/')) return 'data';
  if (path.startsWith('/observatory/duckdb/') || ENGINE_CHUNK.test(path)) return 'engine';
  return 'page';
};

interface Memory {
  /** The page's own (its window), and its workers', bytes. */
  pageBytes: number;
  workerBytes: number;
  /** Chromium's JS heap in use (the page's), and its DOM nodes. */
  jsHeapBytes: number;
  nodes: number;
}

async function memory(page: Page, session: Session): Promise<Memory> {
  const measured = await page.evaluate(async () => {
    const result = await (performance as Performance & { measureUserAgentSpecificMemory(): Promise<{ breakdown: { bytes: number; attribution: { scope: string }[] }[] }> }).measureUserAgentSpecificMemory();
    let pageBytes = 0;
    let workerBytes = 0;
    for (const entry of result.breakdown) {
      if (entry.attribution.some((attribution) => attribution.scope === 'Window')) pageBytes += entry.bytes;
      else if (entry.attribution.some((attribution) => attribution.scope.endsWith('WorkerGlobalScope'))) workerBytes += entry.bytes;
    }
    return { pageBytes, workerBytes };
  });
  const cdp = await session.context.newCDPSession(page);
  await cdp.send('Performance.enable');
  const { metrics } = await cdp.send('Performance.getMetrics');
  const metric = (name: string) => metrics.find((entry) => entry.name === name)?.value ?? 0;
  await cdp.detach();
  return { ...measured, jsHeapBytes: metric('JSHeapUsedSize'), nodes: metric('Nodes') };
}

interface Run extends RunResult {
  /** Main-thread CPU, ms: the load (navigation → time to data's moment) and the use (the fling's first wheel event → at rest at the end). */
  loadBusyMs: number;
  useBusyMs: number;
  busyMs: number;
  open: Memory;
  atEnd: Memory;
  bytes: Record<Kind, number>;
}

await runMetric<Run>(
  'cost',
  async ({ side, profile, url }) => {
    const requests: Request[] = [];
    const session = await openSide(side, url, profile, {
      init: [originMark, inputRecorder],
      // Without it, the measurement waits for a garbage collection (up to 20 s).
      args: ['--enable-blink-features=ForceEagerMeasureMemory'],
      before: async (page, browser) => {
        page.on('requestfinished', (request) => requests.push(request));
        await browser.startTracing(page, { categories: WORK_CATEGORIES });
      },
    });
    const { page, browser } = session;
    try {
      const failures = [...session.problems];
      if (!(await page.evaluate(() => crossOriginIsolated))) failures.push("the page isn't cross-origin isolated: no memory measurement");
      const { filled, state: start } = await opened(session);
      const open = await memory(page, session);
      await pressProbeKey(page);
      // metric-fling.ts's fling.
      await readyFling(session);
      await fling(session, start.rows);
      await filledState(page, 's.end === s.rows', 30_000).catch(() => failures.push("the view didn't rest at the last row, filled"));
      const until = await now(page);
      const trace = new Trace(JSON.parse((await browser.stopTracing()).toString()));
      const atEnd = await memory(page, session);
      if (trace.marks(new RegExp(`^${ORIGIN_MARK}$`)).length !== 1) failures.push(`the trace has ${trace.marks(new RegExp(`^${ORIGIN_MARK}$`)).length} origin marks`);
      const load = frameWork(trace, 0, filled);
      // The use is the fling's: from its first wheel event, so the memory
      // measurement and the probe key after the open count in neither.
      const flung = (await wheels(page)).find((input) => input.at > filled)?.at;
      if (flung === undefined) throw new Error('no wheel event reached the page');
      const use = frameWork(trace, flung, until);
      const bytes: Record<Kind, number> = { page: 0, engine: 0, data: 0 };
      for (const request of requests) {
        const sizes = await request.sizes().catch(() => null);
        if (sizes) bytes[kindOf(request.url())] += sizes.responseBodySize + sizes.responseHeadersSize;
      }
      return { loadBusyMs: load.busyMs, useBusyMs: use.busyMs, busyMs: load.busyMs + use.busyMs, open, atEnd, bytes, failures };
    } finally {
      await session.close();
    }
  },
  (runs) => ({
    busyMs: medianOf(runs, (run) => run.busyMs),
    loadBusyMs: medianOf(runs, (run) => run.loadBusyMs),
    useBusyMs: medianOf(runs, (run) => run.useBusyMs),
    pageMemoryOpenMiB: medianOf(runs, (run) => run.open.pageBytes / 2 ** 20),
    pageMemoryEndMiB: medianOf(runs, (run) => run.atEnd.pageBytes / 2 ** 20),
    workerMemoryEndMiB: medianOf(runs, (run) => run.atEnd.workerBytes / 2 ** 20),
    jsHeapEndMiB: medianOf(runs, (run) => run.atEnd.jsHeapBytes / 2 ** 20),
    nodesEnd: medianOf(runs, (run) => run.atEnd.nodes, 0),
    pageKiB: medianOf(runs, (run) => run.bytes.page / 1024),
    engineKiB: medianOf(runs, (run) => run.bytes.engine / 1024),
    dataKiB: medianOf(runs, (run) => run.bytes.data / 1024),
  }),
);
