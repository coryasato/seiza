// A feed's numbers, a scenario's stops (market watch's and the monitoring
// wall's), on either bare
// contender page, cold, with `?measure`: once the feed has first drawn
// (`contender:refreshed`), `SETTLE_MS` to settle, then `WINDOW_MS` traced.
// Read from what both sides publish (`__contender.batches`, each refreshed
// mark with the generation drawn then) and the trace (metrics/metrics.ts):
// - keeps up (`feedFrames`): the frames that first drew a batch with a tick
//   on screen, over the lesser of those batches and the display's frames
//   (on the wall a batch is paired across its tables: its frame is the
//   first at which every table whose on-screen rows it ticked has drawn it);
// - Shown in (`shownIn`): each such batch's send → the presentation of its
//   frame, p50 and p95, with each run's send → mark and mark → presentation
//   beside it (a run's frame scheduling state; `docs/DECISIONS.md`,
//   "Measurement");
// - collection pauses (`collections`): V8's on the main thread in the
//   window, counted, their total and longest, those in a late frame;
// - late frames (the animation frames' intervals), work a frame p50 and p95
//   and the main thread's busy time a second (the trace's `frameWork`).
// After the window, never before it, the throttle's control: a fixed busy
// loop timed on the page, which the throttled profile must slow ~4× before
// its times are read (a long task before the window moves a page's frame
// scheduling for the whole of it): a throttled run whose loop took under
// `THROTTLE_MIN` times the side's reference median fails
// (`throttle-control.ts`).
//
// Usage: node apps/observatory/perf/metric-feed.ts --scenario market-watch|monitoring-wall
//          [--stop <id,…|all>] [--side gpui|tanstack] [--runs 10]
//          [--profile reference|throttled] [--label <name>]
// Run `just observatory gpui-build <level>` and `tanstack-build <level>`
// first (`market`, `wall`).

import { frameIntervals, frameRecorder, recordedBetween, waitMark } from '../../../shared-web/perf/harness.ts';
import { percentiles } from '../../../shared-web/perf/protocol.ts';
import { KEEPS_UP_SHARE, WORK_CATEGORIES, ORIGIN_MARK, Trace, collections, feedFrames, frameWork, lateFrames, shownIn, type Collections, type FeedBatch } from '../metrics/metrics.ts';
import { medianOf, openSide, refreshedLog, refreshedRecorder, runMetric, type RunResult } from './contender.ts';
import { MARKS } from './harness.ts';
import { spin, throttleCheck } from './throttle-control.ts';

const SETTLE_MS = 1000;
const WINDOW_MS = 10_000;
/** The trace's: the frames, their presentations, the marks, and the main
 *  thread's work, V8's collections among it (`devtools.timeline`); not the
 *  compositor's verbose `cc`, which costs the frames it would read. */
const CATEGORIES = WORK_CATEGORIES;

type Global = { __contender?: { batches?: FeedBatch[] } };

const round = (value: number, digits = 2) => Number(value.toFixed(digits));
const p = (values: number[]) => (values.length ? percentiles(values) : null);

interface Run extends RunResult {
  /** The traced window, ms (a little over `WINDOW_MS`). */
  windowMs: number;
  /** The batches sent in the window, and those with a tick on screen. */
  batches: number;
  visibleBatches: number;
  /** The visible batches a second. */
  visiblePerSecond: number;
  /** The frames that showed a batch, a second. */
  shownPerSecond: number;
  keepsUpPct: number;
  shownInP50Ms: number | null;
  shownInP95Ms: number | null;
  toMarkP50Ms: number | null;
  toPresentP50Ms: number | null;
  /** Visible batches with no frame in the window, or none presented. */
  unpaired: number;
  latePct: number;
  workP50Ms: number;
  workP95Ms: number;
  busyMsPerSecond: number;
  collections: Collections;
  /** The busy loop after the window, ms. */
  spinMs: number;
}

await runMetric<Run>(
  'feed',
  async ({ side, profile, url, picked }) => {
    const session = await openSide(side, url, profile, { picked, init: [frameRecorder, refreshedRecorder] });
    const { page, browser } = session;
    try {
      const failures: string[] = [];
      await waitMark(page, MARKS.refreshed, 0, 180_000);
      await page.evaluate(() => document.fonts.ready);
      await browser.startTracing(page, { categories: CATEGORIES });
      await page.evaluate((name) => performance.mark(name), ORIGIN_MARK);
      await page.waitForTimeout(SETTLE_MS);
      const from = await page.evaluate(() => performance.now());
      await page.waitForTimeout(WINDOW_MS);
      const to = await page.evaluate(() => performance.now());
      const trace = new Trace(JSON.parse((await browser.stopTracing()).toString()));
      const spinMs = await spin(page);
      const throttled = throttleCheck(side, profile, spinMs);
      if (throttled) failures.push(throttled);

      const { batches, origin } = await page.evaluate(() => ({ batches: (globalThis as Global).__contender?.batches ?? [], origin: performance.timeOrigin }));
      const fed = feedFrames(batches, await refreshedLog(page), origin, from, to);
      if (!fed.frames) failures.push('no visible batch shown in the window');
      const read = shownIn(trace, fed.shown);
      const [shown, toMark, toPresent] = [p(read.ms), p(read.toMark), p(read.toPresent)];
      const work = frameWork(trace, from, to);
      const perFrame = percentiles(work.frames.map((frame) => frame.ms));
      const recorded = await recordedBetween(page, from, to);
      const times = recorded.map((frame) => frame.t);
      const seconds = (to - from) / 1000;
      return {
        windowMs: round(to - from, 1),
        batches: fed.sent,
        visibleBatches: fed.visible,
        visiblePerSecond: round(fed.visible / seconds, 1),
        shownPerSecond: round(fed.frames / seconds, 1),
        keepsUpPct: round(fed.share * 100, 1),
        shownInP50Ms: shown && round(shown.p50),
        shownInP95Ms: shown && round(shown.p95),
        toMarkP50Ms: toMark && round(toMark.p50),
        toPresentP50Ms: toPresent && round(toPresent.p50),
        unpaired: fed.visible - fed.shown.length + read.unpresented,
        latePct: round(lateFrames(frameIntervals(recorded)).share * 100, 1),
        workP50Ms: round(perFrame.p50),
        workP95Ms: round(perFrame.p95),
        busyMsPerSecond: round(work.busyMs / seconds, 1),
        collections: collections(trace, from, to, times),
        spinMs: round(spinMs, 1),
        failures: [...session.problems, ...failures],
      };
    } finally {
      await session.close();
    }
  },
  (runs) => {
    const keepsUpPct = medianOf(runs, (run) => run.keepsUpPct);
    return {
      keepsUp: keepsUpPct === null ? null : keepsUpPct / 100 >= KEEPS_UP_SHARE,
      keepsUpPct,
      keepsUpPctRuns: runs.map((run) => run.keepsUpPct),
      shownInP50Ms: medianOf(runs, (run) => run.shownInP50Ms),
      shownInP50MsRuns: runs.map((run) => run.shownInP50Ms),
      shownInP95Ms: medianOf(runs, (run) => run.shownInP95Ms),
      toMarkP50Ms: medianOf(runs, (run) => run.toMarkP50Ms),
      toPresentP50MsRuns: runs.map((run) => run.toPresentP50Ms),
      collectionsIn10s: medianOf(runs, (run) => (run.collections.count * 10_000) / run.windowMs),
      collectionLongestMs: medianOf(runs, (run) => run.collections.longestMs, 2),
      collectionTotalMs: medianOf(runs, (run) => run.collections.totalMs, 2),
      // To 2 decimals, as live tail's (`metric tail`) and the page's median over runs.
      collectionsInLateFrame: medianOf(runs, (run) => run.collections.inLateFrame, 2),
      latePct: medianOf(runs, (run) => run.latePct),
      workP50Ms: medianOf(runs, (run) => run.workP50Ms, 2),
      workP95Ms: medianOf(runs, (run) => run.workP95Ms, 2),
      busyMsPerSecond: medianOf(runs, (run) => run.busyMsPerSecond),
      visiblePerSecond: medianOf(runs, (run) => run.visiblePerSecond),
      spinMs: medianOf(runs, (run) => run.spinMs),
    };
  },
  { settleMs: SETTLE_MS, windowMs: WINDOW_MS, keepsUpShare: KEEPS_UP_SHARE },
  { levels: ['market', 'wall'], allStops: true },
);
