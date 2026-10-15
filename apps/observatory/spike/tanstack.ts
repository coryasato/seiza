// TanStack Virtual over the full count against a moving window, in Chromium
// per the measurement protocol (headless=new, 1440×900 at DPR 2, cold): its
// measurements' build time and memory, the page's time to rows and heap, and
// per-frame work in a steady fling, read from the trace.

import { chromium, type Page } from '@playwright/test';
import { frameRecorder, frameStats, open, recordedBetween, waitMark } from '../../../shared-web/perf/harness.ts';
import { percentiles, summarize } from '../../../shared-web/perf/protocol.ts';
import { ROWS, steadyFling } from './input.ts';

const WINDOW_ROWS = 4096;

type Spike = { build(count: number): number; held: unknown[]; model: { handlerMs: number[]; reanchors: unknown[] } };

async function heap(page: Page): Promise<number> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('HeapProfiler.collectGarbage');
  await cdp.send('HeapProfiler.collectGarbage');
  // The JS heap plus ArrayBuffer backing stores (TanStack keeps its
  // measurements in a Float64Array, outside `usedSize`).
  const usage = (await cdp.send('Runtime.getHeapUsage')) as { usedSize: number; backingStorageSize?: number };
  await cdp.detach();
  return usage.usedSize + (usage.backingStorageSize ?? 0);
}

interface TraceEvent {
  name: string;
  ph: string;
  ts: number;
  dur?: number;
  pid: number;
  tid: number;
}

/** Main-thread tasks between the trace's `fling:start` and `fling:end` marks. */
function mainThreadWork(trace: Buffer): { tasks: number[]; windowMs: number } {
  const events = (JSON.parse(trace.toString()) as { traceEvents: TraceEvent[] }).traceEvents;
  const start = events.find((event) => event.name === 'fling:start');
  const end = events.find((event) => event.name === 'fling:end');
  if (!start || !end) throw new Error('trace has no fling marks');
  // The marks are set on the page's main thread (CrRendererMain).
  const tasks = events
    .filter((event) => event.pid === start.pid && event.tid === start.tid && event.name === 'ThreadControllerImpl::RunTask' && event.ph === 'X' && event.ts >= start.ts && event.ts <= end.ts)
    .map((event) => (event.dur ?? 0) / 1000);
  return { tasks, windowMs: (end.ts - start.ts) / 1000 };
}

async function one(url: string, variant: 'full' | 'window') {
  const { page, context, problems, close } = await open(chromium, url, { params: { v: variant }, init: [frameRecorder] });
  try {
    const rows = await waitMark(page, 'spike:rows');
    const mount = await page.evaluate(() => performance.getEntriesByName('spike:mount')[0]!.startTime);
    await page.waitForTimeout(500);
    const heapAfterMount = await heap(page);

    // A detached virtualizer of each size, built and held.
    const heapBefore = await heap(page);
    const buildFull = await page.evaluate((rows) => (globalThis as { __spike?: Spike }).__spike!.build(rows), ROWS);
    const heapFull = await heap(page);
    const buildWindow = await page.evaluate((rows) => (globalThis as { __spike?: Spike }).__spike!.build(rows), WINDOW_ROWS);
    const heapWindow = await heap(page);
    await page.evaluate(() => ((globalThis as { __spike?: Spike }).__spike!.held.length = 0));

    await page.focus('.scroller');
    const browser = context.browser()!;
    await browser.startTracing(page, { categories: ['devtools.timeline', 'blink.user_timing', 'toplevel'] });
    await page.evaluate(() => {
      (globalThis as { __spike?: Spike }).__spike!.model.handlerMs.length = 0;
      performance.mark('fling:start');
    });
    const t0 = await page.evaluate(() => performance.now());
    await steadyFling(page);
    await page.waitForTimeout(300);
    const t1 = await page.evaluate(() => {
      performance.mark('fling:end');
      return performance.now();
    });
    const trace = await browser.stopTracing();
    const frames = await recordedBetween(page, t0, t1);
    const handler = await page.evaluate(() => (globalThis as { __spike?: Spike }).__spike!.model.handlerMs);
    const work = mainThreadWork(trace);
    const busy = work.tasks.reduce((sum, ms) => sum + ms, 0);
    return {
      timeToRows: rows,
      mountToRows: rows - mount,
      heapAfterMount,
      buildFullMs: buildFull,
      buildWindowMs: buildWindow,
      heldFullBytes: heapFull - heapBefore,
      heldWindowBytes: heapWindow - heapFull,
      fling: {
        frames: frameStats(frames),
        mainThreadBusyMs: busy,
        mainThreadBusyPerFrame: busy / Math.max(1, frames.length),
        busyShare: busy / work.windowMs,
        tasks: percentiles(work.tasks),
        scrollHandlerMs: percentiles(handler),
      },
      problems,
    };
  } finally {
    await close();
  }
}

export async function tanstack(url: string, runs: number) {
  const results: Record<string, Awaited<ReturnType<typeof one>>[]> = { full: [], window: [] };
  for (let run = 0; run < runs; run++) {
    // Alternate which variant goes first.
    const order: ('full' | 'window')[] = run % 2 ? ['window', 'full'] : ['full', 'window'];
    for (const variant of order) {
      console.log(`tanstack ${variant} run ${run + 1}/${runs}`);
      results[variant]!.push(await one(url, variant));
    }
  }
  const pick = (variant: string, read: (run: Awaited<ReturnType<typeof one>>) => number, digits = 1) => summarize(results[variant]!.map(read), digits);
  const summary = Object.fromEntries(
    ['full', 'window'].map((variant) => [
      variant,
      {
        timeToRowsMs: pick(variant, (run) => run.timeToRows),
        mountToRowsMs: pick(variant, (run) => run.mountToRows),
        heapAfterMountMiB: pick(variant, (run) => run.heapAfterMount / 2 ** 20, 2),
        flingBusyPerFrameMs: pick(variant, (run) => run.fling.mainThreadBusyPerFrame, 2),
        flingBusyShare: pick(variant, (run) => run.fling.busyShare, 3),
        flingTaskP95Ms: pick(variant, (run) => run.fling.tasks.p95, 2),
        flingTaskMaxMs: pick(variant, (run) => run.fling.tasks.max, 2),
        flingFrameP95Ms: pick(variant, (run) => run.fling.frames.p95, 1),
        flingFramesOver50: pick(variant, (run) => run.fling.frames.over50, 0),
        scrollHandlerP50Ms: pick(variant, (run) => run.fling.scrollHandlerMs.p50, 2),
        scrollHandlerP95Ms: pick(variant, (run) => run.fling.scrollHandlerMs.p95, 2),
      },
    ]),
  );
  const all = [...results.full!, ...results.window!];
  const detached = {
    buildFullMs: summarize(all.map((run) => run.buildFullMs), 2),
    buildWindowMs: summarize(all.map((run) => run.buildWindowMs), 3),
    heldFullMiB: summarize(all.map((run) => run.heldFullBytes / 2 ** 20), 2),
    heldWindowKiB: summarize(all.map((run) => run.heldWindowBytes / 1024), 1),
  };
  return { profile: 'reference', runs, rows: ROWS, windowRows: WINDOW_ROWS, summary, detached, raw: results };
}
