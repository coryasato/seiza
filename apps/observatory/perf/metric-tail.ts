// Live tail's numbers at its stops, on either bare contender page, cold,
// with `?measure`: once the replay first draws a grown tail
// (`contender:tail`), `SETTLE_MS` to settle, then `WINDOW_MS` traced, the
// trace kept `TAIL_GRACE_MS` past the window (`docs/DECISIONS.md`,
// "Measurement", 2026-11-06 and 2026-11-07). Read from what both sides
// publish (`__contender.batches`, each tail mark with the tail drawn then)
// and the trace (metrics/metrics.ts):
// - Row shown in (`tailFrames`, `shownIn`, `rowShownIn`): each count the
//   clock posted in the window → the presentation of the first frame whose
//   drawn tail reaches it, p50 and p95, a count with no frame by the
//   trace's end counted at the grace; keeps up is its p95 at most
//   `TAIL_KEEPS_UP_MS`, the frame share beside it;
// - late frames (the animation frames' intervals), work a frame p50 and p95
//   and the main thread's busy time a second (`frameWork`), collections.
// Then the scroll back, in a trace of its own (the latency categories, `cc`
// among them, kept out of the window's): a `GESTURE_PX` gesture up at
// `GESTURE_SPEED` under the feed, following let go and the top held
// `HELD_MS` as rows arrive. GPUI's reading is its probe's (`probeResponse`:
// the wheel's event → the first frame whose top moved while not following), since its wheel
// often reaches no frame in `EventLatency` under the feed; the DOM's is
// `readInputs`' (`EventLatency`, guarded by the compositor's frame). Its
// control: the clock paused, End back to the tail (following again), the
// same gesture; there GPUI's probe must agree with its `EventLatency`.
// After both, never before them, the throttle's control (`metric-feed.ts`'s
// busy loop): a throttled run under `THROTTLE_MIN` times the side's
// reference median fails.
//
// Usage: node apps/observatory/perf/metric-tail.ts --scenario live-tail
//          [--stop <id,…|all>] [--side gpui|tanstack] [--runs 10]
//          [--profile reference|throttled] [--label <name>]
// Run `just observatory gpui-build tail` and `tanstack-build tail` first.

import { waitMark } from '../../../shared-web/perf/harness.ts';
import { LATENCY_CATEGORIES, ORIGIN_MARK, WORK_CATEGORIES, TAIL_GRACE_MS, TAIL_KEEPS_UP_MS, Trace, probeResponse, readInputs } from '../metrics/metrics.ts';
import { frameRecorder, gesture, inputRecorder, medianOf, openSide, runMetric, state, type RunResult, type Session } from './contender.ts';
import { MARKS } from './harness.ts';
import { gpuiLetGoProbe, tailRecorder, tailWindow, type TailWindow } from './tail-metric.ts';
import { THROTTLE_MIN, spin, throttleCheck } from './throttle-control.ts';

const SETTLE_MS = 1000;
const WINDOW_MS = 10_000;
/** The scroll back (the spike's, `spike/tail-run.ts`): a gesture up, its speed, px and px/s. */
const GESTURE_PX = 300;
const GESTURE_SPEED = 10_000;
/** After the gesture, the view's top must hold this long as rows arrive. */
const HELD_MS = 1000;
/** After the gesture, before the top is read: the gesture's last frames. */
const SETTLE_GESTURE_MS = 300;
/** Within this, GPUI's probe and its `EventLatency` end on one frame. */
const SAME_FRAME_MS = 1;

type Global = {
  __contender?: { pause?(on: boolean): void };
  __contenderFollowing?: boolean;
};

const round = (value: number, digits = 2) => Number(value.toFixed(digits));
const following = (session: Session) => session.page.evaluate(() => (globalThis as Global).__contenderFollowing);

/** One scroll back (input `index`): the gesture up, then the top held. */
interface Back {
  /** Following let go by the gesture, and the top unmoved `HELD_MS` on as rows arrived. */
  letGo: boolean;
  held: boolean;
  rowsWhileHeld: number;
  /** GPUI: by its probe; the DOM: `EventLatency`. */
  ms: number | null;
  /** `EventLatency`'s reading, and its type (GPUI's often reaches no frame under the feed). */
  eventLatencyMs: number | null;
  type: string | null;
  /** The DOM: whether the compositor's frame agrees; GPUI: whether its
   *  probe and `EventLatency` agree (null when `EventLatency` reached no
   *  frame), a failure only in the control. */
  agrees: boolean | null;
}

async function scrollBack(session: Session, index: number): Promise<Omit<Back, 'ms' | 'eventLatencyMs' | 'type' | 'agrees'>> {
  const { page } = session;
  await page.evaluate((name) => performance.mark(name), `input:${index}`);
  await gesture(session, { y: GESTURE_PX, speed: GESTURE_SPEED }); // a positive y scrolls up
  await page.waitForTimeout(SETTLE_GESTURE_MS);
  const before = await state(page);
  await page.waitForTimeout(HELD_MS);
  const after = await state(page);
  const letGo = (await following(session)) === false;
  await page.evaluate((name) => performance.mark(name), `input:${index}:end`);
  return { letGo, held: before !== null && after !== null && before.top === after.top, rowsWhileHeld: (after?.rows ?? 0) - (before?.rows ?? 0) };
}

interface Run extends RunResult, TailWindow {
  back: Back;
  control: Back;
  spinMs: number;
}

await runMetric<Run>(
  'tail',
  async ({ side, profile, url, picked }) => {
    const session = await openSide(side, url, profile, { picked, init: [frameRecorder, tailRecorder, inputRecorder, ...(side === 'gpui' ? [gpuiLetGoProbe] : [])] });
    const { page, browser } = session;
    try {
      const failures: string[] = [];
      await waitMark(page, MARKS.tail, 0, 180_000);
      await page.evaluate(() => document.fonts.ready);
      const window = await tailWindow(page, () => browser.startTracing(page, { categories: WORK_CATEGORIES }), () => browser.stopTracing(), SETTLE_MS, WINDOW_MS);
      if (window.drawnPerSecond === 0 || window.rowShownInP50Ms === null) failures.push('no count shown in the window');

      // The scroll back under the feed, then its control: the clock paused, End back to the tail.
      await browser.startTracing(page, { categories: LATENCY_CATEGORIES });
      await page.evaluate((name) => performance.mark(name), ORIGIN_MARK);
      const back = await scrollBack(session, 0);
      await page.evaluate(() => (globalThis as Global).__contender?.pause?.(true));
      await page.keyboard.press('End');
      await page.waitForTimeout(500);
      const followingAgain = (await following(session)) === true;
      if (!followingAgain) failures.push("End didn't follow the tail again");
      const control = await scrollBack(session, 1);
      const latency = new Trace(JSON.parse((await browser.stopTracing()).toString()));
      const inputs = readInputs(latency, side, 'wheel');
      const reading = (index: number, taken: Awaited<ReturnType<typeof scrollBack>>, guarded: boolean): Back => {
        const input = inputs[index];
        const byEvent = input?.ms ?? null;
        if (side === 'tanstack') return { ...taken, ms: byEvent, eventLatencyMs: byEvent, type: input?.type ?? null, agrees: input?.guard.agrees ?? false };
        const byProbe = probeResponse(latency, index);
        // Under the feed GPUI's wheel often reaches no frame in `EventLatency`, or ends after the
        // frame that moved (`docs/DECISIONS.md`, "Measurement"): recorded there, a guard only in the control.
        const agrees = byEvent === null || byProbe === null ? (guarded ? false : null) : Math.abs(byEvent - byProbe) <= SAME_FRAME_MS;
        return { ...taken, ms: byProbe, eventLatencyMs: byEvent, type: input?.type ?? null, agrees };
      };
      const backRead = reading(0, back, false);
      const controlRead = reading(1, control, true);
      for (const [name, read] of [['the scroll back', backRead], ['its control', controlRead]] as const) {
        if (!read.letGo) failures.push(`${name}: the gesture up didn't let go of the tail`);
        if (!read.held) failures.push(`${name}: the top moved while let go`);
        if (read.ms === null) failures.push(`${name}: no frame read`);
        if (read.agrees === false && (side === 'tanstack' || read === controlRead)) failures.push(`${name}: ${side === 'gpui' ? `the probe's ${read.ms ?? 'no frame'} against EventLatency's ${read.eventLatencyMs ?? 'no frame'}` : `EventLatency ${read.ms ?? 'no frame'}, its compositor guard disagreeing`}`);
      }
      if (backRead.rowsWhileHeld <= 0) failures.push("the scroll back: the rows didn't grow while it held");

      const spinMs = await spin(page);
      const throttled = throttleCheck(side, profile, spinMs);
      if (throttled) failures.push(throttled);
      return {
        ...window,
        back: backRead,
        control: controlRead,
        spinMs: round(spinMs, 1),
        failures: [...session.problems, ...failures],
      };
    } finally {
      await session.close();
    }
  },
  (runs) => {
    const rowShownInP95Ms = medianOf(runs, (run) => run.rowShownInP95Ms);
    return {
      keepsUp: rowShownInP95Ms === null ? null : rowShownInP95Ms <= TAIL_KEEPS_UP_MS,
      rowShownInP95Ms,
      rowShownInP95MsRuns: runs.map((run) => run.rowShownInP95Ms),
      rowShownInP50Ms: medianOf(runs, (run) => run.rowShownInP50Ms),
      rowShownInP50MsRuns: runs.map((run) => run.rowShownInP50Ms),
      toMarkP50Ms: medianOf(runs, (run) => run.toMarkP50Ms),
      toPresentP50MsRuns: runs.map((run) => run.toPresentP50Ms),
      unshown: medianOf(runs, (run) => run.unshown, 0),
      framesPct: medianOf(runs, (run) => run.framesPct),
      tailBehindRows: medianOf(runs, (run) => run.tailBehindRows, 0),
      latePct: medianOf(runs, (run) => run.latePct),
      workP50Ms: medianOf(runs, (run) => run.workP50Ms, 2),
      workP95Ms: medianOf(runs, (run) => run.workP95Ms, 2),
      busyMsPerSecond: medianOf(runs, (run) => run.busyMsPerSecond),
      collectionsIn10s: medianOf(runs, (run) => (run.collections.count * 10_000) / run.windowMs),
      collectionLongestMs: medianOf(runs, (run) => run.collections.longestMs, 2),
      collectionTotalMs: medianOf(runs, (run) => run.collections.totalMs, 2),
      // To 2 decimals, as the page's median over the runs reads it.
      collectionsInLateFrame: medianOf(runs, (run) => run.collections.inLateFrame, 2),
      scrollBackMs: medianOf(runs, (run) => run.back.ms, 2),
      scrollBackMsRuns: runs.map((run) => run.back.ms),
      scrollBackControlMs: medianOf(runs, (run) => run.control.ms, 2),
      spinMs: medianOf(runs, (run) => run.spinMs),
    };
  },
  { settleMs: SETTLE_MS, windowMs: WINDOW_MS, graceMs: TAIL_GRACE_MS, keepsUpMs: TAIL_KEEPS_UP_MS, gesturePx: GESTURE_PX, gestureSpeed: GESTURE_SPEED, heldMs: HELD_MS, throttleMin: THROTTLE_MIN },
  { levels: ['tail'], allStops: true },
);
