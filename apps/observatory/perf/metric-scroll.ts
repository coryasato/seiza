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
// The admin table's Smooth (`--scenario admin-table`, the base level's
// builds): one scroll, the read-through (`READ_THROUGH`, 6,000 px at
// 3,000 px/s from the top, inside the table), after the open's one page is
// in and quiet. TanStack renders every row there, so its scroll runs no
// main-thread frame for `domDrawn` to count: its frames that moved the view
// are the presented vsyncs its compositor applied a scroll delta in, each
// once (`compositorScrolls`, timed); its work the main thread's frames over
// the span, if any. The trace adds `cc` on both sides, GPUI's too, so both
// carry the same tracing (its cost mostly off the main thread); these work
// readings aren't compared with the wide sheet's, traced without it. GPUI's are its
// presented frames, as above. The share is `drewShare`'s, one total on both
// sides; no "keeps up" verdict (`docs/DECISIONS.md`, "Measurement", the
// admin table's measures).
//
// Usage: node apps/observatory/perf/metric-scroll.ts --scenario wide-sheet|admin-table
//          [--stop <id,…|all>] [--side gpui|tanstack] [--runs 10]
//          [--profile reference|throttled] [--label <name>]
// Run `just observatory gpui-build wide` and `tanstack-build wide` (the
// admin table: `gpui-build` and `tanstack-build`) first.

import type { Page } from '@playwright/test';
import { workBetween, workRecorder } from '../../../shared-web/perf/harness.ts';
import { percentiles } from '../../../shared-web/perf/protocol.ts';
import { KEEPS_UP_SHARE, ORIGIN_MARK, READ_THROUGH, SCROLLS, SCROLL_CATEGORIES, Trace, WORK_CATEGORIES, compositorFrames, compositorScrolls, domDrawn, drewShare, frameWork, keepsUp, type CompositorFrames, type DrewShare } from '../metrics/metrics.ts';
import { ADMIN_TABLE } from '../contenders/scenarios.ts';
import { dataReads, flaggedScenario, gesture, jump, medianOf, opened, openSide, quiet, readWhole, restPoint, runMetric, scrollRest, state, type Gesture, type RunResult, type Session } from './contender.ts';

/** The admin table's read-through, else the wide sheet's three scrolls. */
const ADMIN = flaggedScenario().id === ADMIN_TABLE.id;
if (flaggedScenario().level === 'base' && !ADMIN) throw new Error(`metric scroll on the base level: the ${ADMIN_TABLE.id} scenario alone`);
const PLAN: Record<string, Gesture> = ADMIN ? { readThrough: READ_THROUGH } : SCROLLS;
type Scroll = string;
const NAMES = Object.keys(PLAN);
/** The admin table's trace adds the compositor's scrolls, on both sides. */
const CATEGORIES = ADMIN ? SCROLL_CATEGORIES : WORK_CATEGORIES;

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
  /** The main thread's frames over the span (the admin table's TanStack
   *  side: its work, often none). */
  mainFrames: number;
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
  await browser.startTracing(page, { categories: CATEGORIES });
  const from = await page.evaluate((name) => (performance.mark(name), performance.now()), ORIGIN_MARK);
  await gesture(session, PLAN[scroll]!);
  const rested = (await scrollRest(page, side, from, REST_MS)) + 100;
  const trace = new Trace(JSON.parse((await browser.stopTracing()).toString()));
  // The frames that moved the view: GPUI's presented; the DOM's that
  // rendered rows, or on the admin table (every row rendered) those its
  // compositor scrolled in, whose work is the main frames' over the span.
  const compositor = side === 'tanstack' && ADMIN;
  const drawn = side === 'gpui' ? (await workBetween(page, from, rested)).map((sample) => ({ at: sample.t, ms: sample.ms })) : compositor ? compositorScrolls(trace, from, rested).map((at) => ({ at, ms: 0 })) : domDrawn(frameWork(trace, from, rested));
  // How far it went: down by the state, sideways by each side's own reading.
  const gestured: { x?: number; y?: number; speed: number } = PLAN[scroll]!;
  const sideways = gestured.x !== undefined;
  const movedPx = sideways ? (await left(page, side)) - x : (await state(page))!.top - top;
  const asked = -(gestured.x ?? gestured.y ?? 0);
  if (movedPx < asked - MOVED_TOLERANCE_PX || movedPx > asked * (1 + OVERSHOOT_SHARE)) throw new Error(`${scroll}: the view moved ${movedPx.toFixed(0)} px ${sideways ? 'right' : 'down'}, ${asked} asked`);
  const share = drewShare(drawn.map((frame) => frame.at));
  if (!share) throw new Error(`${scroll}: ${drawn.length} frame${drawn.length === 1 ? '' : 's'} drew new cells`);
  const [first, last] = [drawn[0]!.at, drawn.at(-1)!.at];
  // The main thread's time over the frames that drew, the first one's start
  // to the last one's end: the rest's wait and the gesture's setup in neither.
  const work = frameWork(trace, first, last + drawn.at(-1)!.ms);
  const p = percentiles(compositor ? work.frames.map((frame) => frame.ms) : drawn.map((frame) => frame.ms));
  return {
    ...share,
    movedPx,
    drewPerSecond: share.spanMs ? ((share.drew - 1) * 1000) / share.spanMs : 0,
    mainFrames: work.frames.length,
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
  await scrollRest(page, side, since, REST_MS);
}

/** Each side's cache bytes once the file is read whole: every run must match. */
const expected = new Map<string, number>();

await runMetric<Run>(
  'scroll',
  async ({ side, profile, url, picked }) => {
    let reads: ReturnType<typeof dataReads> | undefined;
    const session = await openSide(side, url, profile, {
      picked,
      init: side === 'gpui' ? (ADMIN ? [workRecorder] : [workRecorder, wheelXRecorder]) : [],
      before: async (page) => void (reads = dataReads(page)),
    });
    const { page } = session;
    try {
      await opened(session);
      const failures = [...session.problems];
      // The admin table's one page is in at the open: quiet is enough.
      const cacheBytes = ADMIN ? await quiet(page, reads!.inFlight) : await readWhole(session, reads!.inFlight);
      const seen = expected.get(side);
      if (seen === undefined) expected.set(side, cacheBytes);
      else if (seen !== cacheBytes) failures.push(`the file read whole came to ${cacheBytes} cache bytes, the side's first run ${seen}`);
      const at = await restPoint(page);
      await page.mouse.move(at.x, at.y);
      await page.waitForTimeout(500);
      const scrolls = {} as Record<Scroll, Reading>;
      for (const scroll of NAMES) {
        scrolls[scroll] = await traced(session, scroll);
        if (!ADMIN) await home(session, scroll);
      }
      return { cacheBytes, scrolls, failures };
    } finally {
      await session.close();
    }
  },
  (runs) => {
    const of = (scroll: Scroll) => {
      const read = (run: Run) => run.scrolls[scroll]!;
      return {
      drewPct: medianOf(runs, (run) => read(run).share * 100),
      drewPctRuns: runs.map((run) => Number((read(run).share * 100).toFixed(1))),
      drewPerSecond: medianOf(runs, (run) => read(run).drewPerSecond),
      mainFrames: medianOf(runs, (run) => read(run).mainFrames, 0),
      workP50Ms: medianOf(runs, (run) => read(run).workP50Ms, 2),
      workP95Ms: medianOf(runs, (run) => read(run).workP95Ms, 2),
      busyPct: medianOf(runs, (run) => read(run).busyShare * 100),
      movedPx: medianOf(runs, (run) => read(run).movedPx, 0),
      ...(runs[0] && read(runs[0]).compositor
        ? {
            compositorPerSecond: {
              whole: medianOf(runs, (run) => (read(run).compositor!.whole * 1000) / read(run).spanMs),
              partial: medianOf(runs, (run) => (read(run).compositor!.partial * 1000) / read(run).spanMs),
              dropped: medianOf(runs, (run) => (read(run).compositor!.dropped * 1000) / read(run).spanMs),
            },
          }
        : {}),
      };
    };
    const scrolls = Object.fromEntries(NAMES.map((scroll) => [scroll, of(scroll)])) as Record<Scroll, ReturnType<typeof of>>;
    if (ADMIN) return { cacheBytes: [...new Set(runs.map((run) => run.cacheBytes))], ...scrolls };
    const [down, sideways] = [scrolls.down!.drewPct, scrolls.sideways!.drewPct];
    return {
      keepsUp: down === null || sideways === null ? null : keepsUp(down / 100, sideways / 100),
      cacheBytes: [...new Set(runs.map((run) => run.cacheBytes))],
      ...scrolls,
    };
  },
  ADMIN ? { scrolls: PLAN, frames: { gpui: 'presented', tanstack: 'compositor scroll deltas' }, restMs: REST_MS } : { scrolls: SCROLLS, keepsUpShare: KEEPS_UP_SHARE, restMs: REST_MS },
  { levels: ['wide', 'base'], allStops: true },
);
