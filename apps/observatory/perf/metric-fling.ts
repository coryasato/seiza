// Behavior under load, on either bare contender page, cold: a fling from
// the top to the last row, one profile for both sides (metrics/metrics.ts,
// `FLING_FRAMES` equal wheel steps, one every frame), each through the
// side's own input path, the pointer over the row numbers. From the frames
// (`__contender.state` each animation frame): late frames, the share of
// frames showing placeholder rows, how far the view trailed the input, how
// long after the last input it rested at the end with every row real, and
// whether it got there (`underLoad`); from the trace: per-frame work and
// main-thread CPU over the fling (`frameWork`).
//
// Usage: node apps/observatory/perf/metric-fling.ts [--side gpui|tanstack]
//          [--runs 10] [--profile reference|throttled] [--label <name>]
// Run `just observatory gpui-build` and `tanstack-build` first.

import { percentiles } from '../../../shared-web/perf/protocol.ts';
import { FLING_FRAMES, ORIGIN_MARK, Trace, WORK_CATEGORIES, frameWork, underLoad, type UnderLoad } from '../metrics/metrics.ts';
import { filledState, fling, frameRecorder, frames, inputRecorder, medianOf, now, opened, openSide, pressProbeKey, readyFling, runMetric, stateRecorder, stepsReceived, wheels, type RunResult } from './contender.ts';

/** The idle time after the view rests, the same on both sides. */
const TAIL_MS = 500;

interface Run extends RunResult, UnderLoad {
  /** Wheel events the page got (a browser may coalesce them). */
  inputs: number;
  /** Per-frame work (the trace's BeginMainFrame), ms: p50 and p95. */
  workP50Ms: number;
  workP95Ms: number;
  /** Main-thread CPU over the fling, ms, and as a share of its time. */
  busyMs: number;
  busyShare: number;
  /** Of it, outside any frame. */
  outsideFramesMs: number;
}

await runMetric<Run>(
  'fling',
  async ({ side, profile, url }) => {
    const session = await openSide(side, url, profile, { init: [inputRecorder, frameRecorder, stateRecorder] });
    const { page, browser } = session;
    try {
      const { state: start } = await opened(session);
      await pressProbeKey(page);
      await readyFling(session);
      await browser.startTracing(page, { categories: WORK_CATEGORIES });
      const from = await page.evaluate((name) => (performance.mark(name), performance.now()), ORIGIN_MARK);
      const step = await fling(session, start.rows);
      const failures = [...session.problems];
      await filledState(page, 's.end === s.rows', 30_000).catch(() => failures.push("the view didn't rest at the last row, filled"));
      await page.waitForTimeout(TAIL_MS);
      const until = await now(page);
      const trace = new Trace(JSON.parse((await browser.stopTracing()).toString()));
      // The browser may coalesce wheel events; their deltas add up to the fling.
      const inputs = (await wheels(page)).filter((input) => input.at >= from);
      const steps = await stepsReceived(session, inputs, step);
      if (Math.abs(steps - FLING_FRAMES) > 0.5) failures.push(`the page got ${steps.toFixed(1)} steps' worth of wheel events, ${FLING_FRAMES} sent`);
      const load = underLoad(await frames(page, from, until), inputs, FLING_FRAMES, step, start.top);
      if (!load.reachedEnd) failures.push("the fling didn't end at the last row, filled");
      const work = frameWork(trace, inputs[0]?.at ?? from, until);
      const perFrame = percentiles(work.frames.map((frame) => frame.ms));
      return {
        ...load,
        inputs: inputs.length,
        workP50Ms: perFrame.p50,
        workP95Ms: perFrame.p95,
        busyMs: work.busyMs,
        busyShare: work.busyMs / work.windowMs,
        outsideFramesMs: work.busyMs - work.inFramesMs,
        failures,
      };
    } finally {
      await session.close();
    }
  },
  (runs) => ({
    lateShare: medianOf(runs, (run) => run.lateShare, 3),
    placeholderShare: medianOf(runs, (run) => run.placeholderShare, 3),
    lagStepsP95: medianOf(runs, (run) => run.lagSteps.p95, 2),
    catchUpMs: medianOf(runs, (run) => run.catchUpMs),
    reachedEnd: `${runs.filter((run) => run.reachedEnd).length}/${runs.length}`,
    workP50Ms: medianOf(runs, (run) => run.workP50Ms, 2),
    workP95Ms: medianOf(runs, (run) => run.workP95Ms, 2),
    busyMs: medianOf(runs, (run) => run.busyMs),
    busyShare: medianOf(runs, (run) => run.busyShare, 3),
  }),
  { flingFrames: FLING_FRAMES },
);
