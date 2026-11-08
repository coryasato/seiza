// What live tail's metric scripts share (`metric-tail.ts`, `metric-soak.ts`):
// the init scripts that log what both sides publish under the replay, and
// one traced window's readings (`docs/DECISIONS.md`, "Measurement",
// 2026-11-06 and 2026-11-07; the math is metrics/metrics.ts's).

import type { Page, Request } from '@playwright/test';
import { frameIntervals, recordedBetween } from '../../../shared-web/perf/harness.ts';
import { percentiles } from '../../../shared-web/perf/protocol.ts';
import { ORIGIN_MARK, TAIL_GRACE_MS, Trace, LET_GO_MARK, collections, frameWork, lateFrames, rowShownIn, shownIn, tailFrames, type Collections, type TailBatch, type TailFrame } from '../metrics/metrics.ts';
import { MARKS } from './harness.ts';
import { DATA_FILE } from '../contenders/tail/data.ts';

type Global = {
  __contender?: { batches?: TailBatch[]; state?: { top: number } | null };
  __contenderTail?: number;
  __contenderFollowing?: boolean;
  __tailMarks?: [at: number, tail: number][];
};

/** Init script: each `contender:tail` mark with the tail drawn then (each
 *  side sets `__contenderTail` before its mark), from a wrapper on
 *  `performance.mark`, the same on both sides (`metric-feed.ts`'s
 *  `refreshedRecorder`). */
export function tailRecorder(): void {
  const g = globalThis as Global;
  const log: [number, number][] = [];
  g.__tailMarks = log;
  const mark = performance.mark.bind(performance);
  performance.mark = ((name: string, options?: PerformanceMarkOptions) => {
    const entry = mark(name, options);
    if (name === 'contender:tail') log.push([entry.startTime, g.__contenderTail ?? 0]);
    return entry;
  }) as typeof performance.mark;
}

/** Init script (GPUI): after each task that makes GPU calls, the state's
 *  `top` and `__contenderFollowing`; marks `probe:let-go` in the first frame
 *  whose top moved while not following (the spike's rule, `spike/tail-run.ts`): the scroll
 *  back's frame. "Up" alone can miss it: a count set in that frame before
 *  the wheel pins the view down by more than the wheel moves it up. Armed
 *  again once following comes back. As `gpuiProbe` finds a moved frame
 *  (`perf/contender.ts`). */
export function gpuiLetGoProbe(): void {
  const g = globalThis as Global;
  let last: number | null = null;
  let marked = false;
  let pending = false;
  const hook = (proto: object | undefined, names: string[]) => {
    if (!proto) return;
    const methods = proto as Record<string, (...args: unknown[]) => unknown>;
    for (const name of names) {
      const original = methods[name];
      if (!original) continue;
      methods[name] = function (this: unknown, ...args: unknown[]) {
        if (!pending) {
          pending = true;
          queueMicrotask(() => {
            pending = false;
            const state = g.__contender?.state;
            if (!state) return;
            if (g.__contenderFollowing !== false) marked = false;
            else if (!marked && last !== null && state.top !== last) {
              performance.mark('probe:let-go');
              marked = true;
            }
            last = state.top;
          });
        }
        return original.apply(this, args);
      };
    }
  };
  hook(globalThis.WebGL2RenderingContext?.prototype, ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced']);
  hook((globalThis as { GPUQueue?: { prototype: object } }).GPUQueue?.prototype, ['submit']);
}

// The init scripts name their marks themselves: fail if one drifts from its constant.
if (!tailRecorder.toString().includes(`'${MARKS.tail}'`)) throw new Error(`tailRecorder doesn't name ${MARKS.tail}`);
if (!gpuiLetGoProbe.toString().includes(`'${LET_GO_MARK}'`)) throw new Error(`gpuiLetGoProbe doesn't name ${LET_GO_MARK}`);

/** The clock's counts and the tail marks so far, and the page's time origin. */
export const tailLog = (page: Page): Promise<{ batches: TailBatch[]; marks: TailFrame[]; origin: number }> =>
  page.evaluate(() => {
    const g = globalThis as Global;
    return { batches: g.__contender?.batches?.slice() ?? [], marks: g.__tailMarks?.slice() ?? [], origin: performance.timeOrigin };
  });

/**
 * Watches for the file fetched whole: a finished GET of the data file with
 * no `Range` (the open reads by range) answered 200. Attach before the page
 * navigates (`openSide`'s `before`). `request()` is it, or throws when none
 * or more than one matched.
 */
export function wholeFileWatch(page: Page): { done(): boolean; request(): Request } {
  const found: Request[] = [];
  page.on('requestfinished', async (request) => {
    if (request.method() !== 'GET' || request.headers()['range'] || !new URL(request.url()).pathname.endsWith(`/${DATA_FILE}`)) return;
    if ((await request.response())?.status() === 200) found.push(request);
  });
  return {
    done: () => found.length > 0,
    request: () => {
      if (found.length !== 1) throw new Error(`${found.length} whole-file GETs of ${DATA_FILE} answered 200 (want 1)`);
      return found[0]!;
    },
  };
}

/** Empties the logs the scripts read (the clock's counts, the tail marks,
 *  the recorded frames and their costs) in place, so a long session's
 *  memory isn't the harness's: the page keeps each by reference. */
export const clearLogs = (page: Page): Promise<void> =>
  page.evaluate(() => {
    const g = globalThis as Global & { __seizaFrames?: unknown[]; __seizaFrameCosts?: unknown[] };
    for (const log of [g.__contender?.batches, g.__tailMarks, g.__seizaFrames, g.__seizaFrameCosts]) if (log) log.length = 0;
  });

const round = (value: number, digits = 2) => Number(value.toFixed(digits));
const p50 = (values: number[]) => (values.length ? round(percentiles(values).p50) : null);

/** One traced window's readings under the replay. */
export interface TailWindow {
  windowMs: number;
  /** The clock's counts in the window, a second; the frames that drew a grown tail, a second. */
  batchesPerSecond: number;
  drawnPerSecond: number;
  /** Row shown in, and the counts no frame reached by the trace's end. */
  rowShownInP50Ms: number | null;
  rowShownInP95Ms: number | null;
  unshown: number;
  keepsUp: boolean;
  /** The frame share, beside the verdict. */
  framesPct: number;
  /** Each paired count's stamp → its frame's mark, and mark → presentation. */
  toMarkP50Ms: number | null;
  toPresentP50Ms: number | null;
  /** The rows due at the window's end less the tail drawn by then. */
  tailBehindRows: number;
  latePct: number;
  workP50Ms: number;
  workP95Ms: number;
  busyMsPerSecond: number;
  collections: Collections;
}

/**
 * Traces `windowMs` from now (after `settleMs`), and `TAIL_GRACE_MS` past it
 * so a count sent near its end can find its frame, then reads the window.
 * Call with tracing stopped; returns with it stopped.
 */
export async function tailWindow(page: Page, startTracing: () => Promise<void>, stopTracing: () => Promise<Buffer>, settleMs: number, windowMs: number): Promise<TailWindow> {
  await startTracing();
  await page.evaluate((name) => performance.mark(name), ORIGIN_MARK);
  await page.waitForTimeout(settleMs);
  const from = await page.evaluate(() => performance.now());
  await page.waitForTimeout(windowMs);
  const to = await page.evaluate(() => performance.now());
  await page.waitForTimeout(TAIL_GRACE_MS);
  const until = await page.evaluate(() => performance.now());
  const trace = new Trace(JSON.parse((await stopTracing()).toString()));
  const { batches, marks, origin } = await tailLog(page);
  const fed = tailFrames(batches, marks, origin, from, to, until);
  const read = shownIn(trace, fed.shown);
  const rows = rowShownIn(read, fed.unshown + read.unpresented);
  const work = frameWork(trace, from, to);
  const perFrame = percentiles(work.frames.map((frame) => frame.ms));
  const recorded = await recordedBetween(page, from, to);
  const seconds = (to - from) / 1000;
  const dueAtEnd = batches.filter(([, sent]) => sent - origin <= to).at(-1)?.[0] ?? 0;
  const drawnAtEnd = marks.filter(([at]) => at <= to).at(-1)?.[1] ?? 0;
  return {
    windowMs: round(to - from, 1),
    batchesPerSecond: round(fed.sent / seconds, 1),
    drawnPerSecond: round(fed.frames / seconds, 1),
    rowShownInP50Ms: rows.p50,
    rowShownInP95Ms: rows.p95,
    unshown: fed.unshown + read.unpresented,
    keepsUp: rows.keepsUp,
    framesPct: round(fed.share * 100, 1),
    toMarkP50Ms: p50(read.toMark),
    toPresentP50Ms: p50(read.toPresent),
    tailBehindRows: dueAtEnd - drawnAtEnd,
    latePct: round(lateFrames(frameIntervals(recorded)).share * 100, 1),
    workP50Ms: round(perFrame.p50),
    workP95Ms: round(perFrame.p95),
    busyMsPerSecond: round(work.busyMs / seconds, 1),
    collections: collections(trace, from, to, recorded.map((frame) => frame.t)),
  };
}
