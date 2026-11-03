// Keeps up, a scenario's stops (the wide sheet's), on either bare contender
// page, cold: at each stop, the file read whole first (`readWhole`: the
// scrolls then read the table, not the engine), then three gesture scrolls
// (`gesture`: Chromium's, which reaches the DOM side's compositor every
// frame and GPUI's canvas as wheel events), each from the top and the
// first day, each traced on its own:
// - down: 37,500 px at 18,750 px/s;
// - sideways: 12,000 px at 6,000 px/s;
// - fast: 120,000 px at 60,000 px/s (the fast fling: in its card, not in
//   "keeps up").
// Per scroll, the frames that drew new cells (GPUI's presented frames, from
// `workRecorder`; the DOM's main frames that rendered rows, from the trace:
// metrics/metrics.ts, `domDrawn`) as a share of the display's frames from
// the first of them to the last (`drewShare`); their work, p50 and p95
// (GPUI: the recorder's frame callbacks; the DOM: the trace's frames); the
// main thread's busy share over those frames; on the DOM, the compositor's
// frames (whole, in part, dropped: `compositorFrames`). A scroll's end is
// its rest: nothing drawn for `REST_MS`, counted from its own start. A
// scroll that drew under two frames fails the run, and so does one that
// didn't move the view its distance, short of it by at most a row
// (`MOVED_TOLERANCE_PX`) or past it by at most `OVERSHOOT_SHARE` (down by
// the state; sideways by the DOM's scroller and GPUI's wheel deltas). "Keeps up"
// (`keepsUp`) reads the median down and sideways shares of each side at
// each stop. GPUI's gesture is scaled by the device pixel ratio
// (`gesture`), so both sides move as far in the same time.
//
// Usage: node apps/observatory/perf/metric-scroll.ts --scenario wide-sheet
//          [--stop <id,…|all>] [--side gpui|tanstack] [--runs 10]
//          [--profile reference|throttled] [--label <name>]
// Run `just observatory gpui-build wide` and `tanstack-build wide` first.

import type { Page } from '@playwright/test';
import { workBetween, workRecorder } from '../../../shared-web/perf/harness.ts';
import { percentiles } from '../../../shared-web/perf/protocol.ts';
import { KEEPS_UP_SHARE, ORIGIN_MARK, SCROLLS, Trace, WORK_CATEGORIES, compositorFrames, domDrawn, drewShare, frameWork, keepsUp, type CompositorFrames, type DrewShare } from '../metrics/metrics.ts';
import { dataReads, gesture, jump, medianOf, opened, openSide, readWhole, restPoint, runMetric, state, type RunResult, type Session } from './contender.ts';

type Scroll = keyof typeof SCROLLS;
const NAMES = Object.keys(SCROLLS) as Scroll[];

/** A vertical scroll moves the view its distance to within a row (the
 *  stops' rows are 18–26 px). */
const MOVED_TOLERANCE_PX = 30;
/** …or past it by at most this share: traced, the native scroller moves a
 *  fast gesture ~3% further than asked (untraced, exactly as far), which is
 *  more work for the DOM side, not less; recorded in `movedPx`. */
const OVERSHOOT_SHARE = 0.05;

/** A scroll has ended once nothing has drawn for this long. */
const REST_MS = 300;

interface Reading extends DrewShare {
  /** How far the view moved, CSS px: down, or right for the sideways scroll. */
  movedPx: number;
  /** The frames that drew, a second, from the first to the last. */
  drewPerSecond: number;
  /** Their work, ms. */
  workP50Ms: number;
  workP95Ms: number;
  /** The main thread's busy time from the first frame that drew to the end
   *  of the last, as a share. */
  busyShare: number;
  /** The DOM's compositor over the same span. */
  compositor: CompositorFrames | null;
}

interface Run extends RunResult {
  /** The cache's bytes once the file was read whole. */
  cacheBytes: number;
  scrolls: Record<Scroll, Reading>;
}

/** Until nothing has drawn for `REST_MS` since `since` (GPUI: its recorded
 *  frames; the DOM: its scroll position). Returns when the poll first saw
 *  the last change: at or after the last drawing, so a window ending there
 *  holds every frame that drew. */
async function rest(page: Page, side: Session['side'], since: number): Promise<number> {
  const handle = await page.waitForFunction(
    ({ side, since, restMs }) => {
      const g = globalThis as unknown as { __rest?: { at: number; key: string }; __seizaWork?: { t: number }[] };
      const t = performance.now();
      let key: string;
      if (side === 'gpui') key = `${since}:${(g.__seizaWork ?? []).filter((sample) => sample.t >= since).length}`;
      else {
        const scroller = document.querySelector('.scroller')!;
        key = `${since}:${scroller.scrollTop},${scroller.scrollLeft}`;
      }
      // Keyed by the scroll's start: a scroll never ends on the last one's rest.
      if (g.__rest?.key !== key) {
        g.__rest = { at: t, key };
        return false;
      }
      return t - g.__rest.at > restMs ? g.__rest.at : false;
    },
    { side, since, restMs: REST_MS },
    { polling: 50, timeout: 120_000 },
  );
  return (await handle.jsonValue()) as number;
}

/** Init script (GPUI): the wheel events' summed `deltaX`, CSS px, which
 *  is how far GPUI scrolls sideways (it moves by its wheel deltas); its
 *  state publishes no horizontal position. */
function wheelXRecorder(): void {
  const g = globalThis as { __wheelX?: number };
  g.__wheelX = 0;
  addEventListener('wheel', (event) => void (g.__wheelX! += event.deltaX), { capture: true, passive: true });
}

/** How far the view has scrolled right, CSS px: the DOM's scroller; GPUI's
 *  wheel deltas so far (`wheelXRecorder`). */
const left = (page: Page, side: Session['side']): Promise<number> =>
  side === 'gpui' ? page.evaluate(() => (globalThis as { __wheelX?: number }).__wheelX ?? 0) : page.evaluate(() => document.querySelector('.scroller')!.scrollLeft);

async function traced(session: Session, scroll: Scroll): Promise<Reading> {
  const { page, browser, side } = session;
  const [top, x] = [(await state(page))!.top, await left(page, side)];
  await browser.startTracing(page, { categories: WORK_CATEGORIES });
  const from = await page.evaluate((name) => (performance.mark(name), performance.now()), ORIGIN_MARK);
  await gesture(session, SCROLLS[scroll]);
  const rested = (await rest(page, side, from)) + 100;
  const trace = new Trace(JSON.parse((await browser.stopTracing()).toString()));
  const drawn = side === 'gpui' ? (await workBetween(page, from, rested)).map((sample) => ({ at: sample.t, ms: sample.ms })) : domDrawn(frameWork(trace, from, rested));
  // How far it went: down by the state, sideways by each side's own reading.
  const gestured: { x?: number; y?: number; speed: number } = SCROLLS[scroll];
  const sideways = gestured.x !== undefined;
  const movedPx = sideways ? (await left(page, side)) - x : (await state(page))!.top - top;
  const asked = -(gestured.x ?? gestured.y ?? 0);
  if (movedPx < asked - MOVED_TOLERANCE_PX || movedPx > asked * (1 + OVERSHOOT_SHARE)) throw new Error(`${scroll}: the view moved ${movedPx.toFixed(0)} px ${sideways ? 'right' : 'down'}, ${asked} asked`);
  const share = drewShare(drawn.map((frame) => frame.at));
  if (!share) throw new Error(`${scroll}: ${drawn.length} frame${drawn.length === 1 ? '' : 's'} drew new cells`);
  const p = percentiles(drawn.map((frame) => frame.ms));
  const [first, last] = [drawn[0]!.at, drawn.at(-1)!.at];
  // The main thread's time over the frames that drew, the first one's start
  // to the last one's end: the rest's wait and the gesture's setup in neither.
  const work = frameWork(trace, first, last + drawn.at(-1)!.ms);
  return {
    ...share,
    movedPx,
    drewPerSecond: share.spanMs ? ((share.drew - 1) * 1000) / share.spanMs : 0,
    workP50Ms: p.p50,
    workP95Ms: p.p95,
    busyShare: work.busyMs / work.windowMs,
    compositor: side === 'tanstack' ? compositorFrames(trace, trace.toTrace(first), trace.toTrace(last)) : null,
  };
}

/** Back to the top and the first day, at rest. */
async function home(session: Session, scroll: Scroll): Promise<void> {
  const { page, side } = session;
  const since = await page.evaluate(() => performance.now());
  if (scroll === 'sideways') await gesture(session, { x: 20_000, speed: 60_000 });
  else await jump(page, 0);
  await rest(page, side, since);
}

/** Each side's cache bytes once the file is read whole: every run must match. */
const expected = new Map<string, number>();

await runMetric<Run>(
  'scroll',
  async ({ side, profile, url, picked }) => {
    let reads: ReturnType<typeof dataReads> | undefined;
    const session = await openSide(side, url, profile, {
      picked,
      init: side === 'gpui' ? [workRecorder, wheelXRecorder] : [],
      before: async (page) => void (reads = dataReads(page)),
    });
    const { page } = session;
    try {
      await opened(session);
      const failures = [...session.problems];
      const cacheBytes = await readWhole(session, reads!.inFlight);
      const seen = expected.get(side);
      if (seen === undefined) expected.set(side, cacheBytes);
      else if (seen !== cacheBytes) failures.push(`the file read whole came to ${cacheBytes} cache bytes, the side's first run ${seen}`);
      const at = await restPoint(page);
      await page.mouse.move(at.x, at.y);
      await page.waitForTimeout(500);
      const scrolls = {} as Record<Scroll, Reading>;
      for (const scroll of NAMES) {
        scrolls[scroll] = await traced(session, scroll);
        await home(session, scroll);
      }
      return { cacheBytes, scrolls, failures };
    } finally {
      await session.close();
    }
  },
  (runs) => {
    const of = (scroll: Scroll) => ({
      drewPct: medianOf(runs, (run) => run.scrolls[scroll].share * 100),
      drewPctRuns: runs.map((run) => Number((run.scrolls[scroll].share * 100).toFixed(1))),
      drewPerSecond: medianOf(runs, (run) => run.scrolls[scroll].drewPerSecond),
      workP50Ms: medianOf(runs, (run) => run.scrolls[scroll].workP50Ms, 2),
      workP95Ms: medianOf(runs, (run) => run.scrolls[scroll].workP95Ms, 2),
      busyPct: medianOf(runs, (run) => run.scrolls[scroll].busyShare * 100),
      movedPx: medianOf(runs, (run) => run.scrolls[scroll].movedPx, 0),
      ...(runs[0]?.scrolls[scroll].compositor
        ? {
            compositorPerSecond: {
              whole: medianOf(runs, (run) => (run.scrolls[scroll].compositor!.whole * 1000) / run.scrolls[scroll].spanMs),
              partial: medianOf(runs, (run) => (run.scrolls[scroll].compositor!.partial * 1000) / run.scrolls[scroll].spanMs),
              dropped: medianOf(runs, (run) => (run.scrolls[scroll].compositor!.dropped * 1000) / run.scrolls[scroll].spanMs),
            },
          }
        : {}),
    });
    const scrolls = Object.fromEntries(NAMES.map((scroll) => [scroll, of(scroll)])) as Record<Scroll, ReturnType<typeof of>>;
    const [down, sideways] = [scrolls.down.drewPct, scrolls.sideways.drewPct];
    return {
      keepsUp: down === null || sideways === null ? null : keepsUp(down / 100, sideways / 100),
      cacheBytes: [...new Set(runs.map((run) => run.cacheBytes))],
      ...scrolls,
    };
  },
  { scrolls: SCROLLS, keepsUpShare: KEEPS_UP_SHARE, restMs: REST_MS },
  { levels: ['wide'], allStops: true },
);
