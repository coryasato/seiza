// The wide sheet's drags, on either bare contender page, cold, at each
// stop (`--stop`, default all): nothing read whole first, the open's
// visible pages loaded and quiet, then two drags through real pointer
// events (Playwright's `mouse.down`, `move`, `up`: no gesture, so no DPR
// scaling), a move every `MOVE_EVERY_MS` on a fixed schedule (not paced by
// each move's handling), each traced on its own, as the tall table's own
// `perf` segments are (`components/tall-table/perf/perf.ts`):
//
// - resize: Jan 1's edge (the first day, right of Latitude) pressed and
//   dragged right `DRAG_PX` and back, `DRAG_TRIPS` times, `DRAG_MOVES`
//   moves each way (~2 s): every move re-lays out the columns; back at the
//   press, the release changes nothing (the width at the end must be the
//   one at the press);
// - select: from the top row's first scrolled cell (Latitude) to the last
//   fully visible row and column and back, a row a move with the column
//   following the diagonal, in whole round trips for about the resize's
//   moves: every move changes the selection, so every frame redraws its
//   tint; it ends on the cell it pressed.
//
// Where to press comes from `__contender.layout`, read once at rest before
// the first drag (published at each layout change, never a frame), and the
// table's target for the rows wholly in view.
//
// Per drag: the frames that drew (GPUI's presented frames, `workRecorder`;
// the DOM's main frames that painted, `domPainted`: both sides apply a move
// in the frame's callback, and a selection's commit over few cells can run
// under the scrolls' 1 ms of animate, `domDrawn`'s rule) as a share
// of the display's frames from the first of them to the last
// (`drewShare`), under two frames a failure; their work, p50 and p95, from
// Chromium's trace on both sides (each GPUI presented frame's main frame
// in the trace; `workRecorder`'s own timing kept beside it as the
// cross-check); late frames, from `frameRecorder`'s animation frames over
// the moves (intervals over 1.5 refreshes); the main thread's busy share
// over the frames that drew.
//
// `--control`: the same moves with no button pressed, over the cells (the
// resize's one row down, in the first row of cells: along the header the
// pointer crosses the next days' bands, whose hover draws on both sides):
// neither drag may read two frames drawn, so what the metric counts is the
// drag's (a run that does fails).
//
// Usage: node apps/observatory/perf/metric-drag.ts [--stop <id,…|all>]
//          [--side gpui|tanstack] [--runs 10] [--profile reference|throttled]
//          [--label <name>] [--control]
// Run `just observatory gpui-build wide` and `tanstack-build wide` first.

import type { Page } from '@playwright/test';
import { frameIntervals, recordedBetween, workBetween, workRecorder } from '../../../shared-web/perf/harness.ts';
import { flag, percentiles } from '../../../shared-web/perf/protocol.ts';
import { FRAME_MS, ORIGIN_MARK, Trace, WORK_CATEGORIES, domPainted, drewShare, frameWork, lateFrames, type DrewShare } from '../metrics/metrics.ts';
import { WIDE_SHEET } from '../contenders/scenarios.ts';
import { dataReads, frameRecorder, medianOf, now, opened, openSide, quiet, runMetric, wideStop, type RunResult, type Session } from './contender.ts';

/** The resize drag: out this far and back, `DRAG_TRIPS` times, `DRAG_MOVES`
 *  moves each way (the table's segment). */
const DRAG_PX = 200;
const DRAG_TRIPS = 2;
const DRAG_MOVES = 62;
/** A move every this long: a mouse's report rate; at a move a frame,
 *  throttled frames outran the moves' delivery (the table's finding). */
const MOVE_EVERY_MS = 8;
/** Idle after the release, inside the trace's window. */
const TAIL_MS = 300;
/** The control: the moves with no button pressed. */
const CONTROL = flag('control');

type Drag = 'resize' | 'select';
const DRAGS: Drag[] = ['resize', 'select'];

interface Layout {
  left: number;
  top: number;
  rowHeight: number;
  cellsWidth: number;
  pinned: number;
  columns: { name: string; x: number; width: number }[];
}

interface Reading extends Partial<DrewShare> {
  /** The pointer moves sent. */
  moves: number;
  /** Frames that drew, from the window's start to its end. */
  drewFrames: number;
  /** The drawn frames' work from the trace, ms (GPUI: the main frame each
   *  presented frame ran in). */
  workP50Ms: number | null;
  workP95Ms: number | null;
  /** GPUI: `workRecorder`'s own timing of the same frames (rAF callbacks
   *  that drew), the cross-check. */
  recorderP50Ms?: number | null;
  /** Animation frames over the moves (the first to the release), and the
   *  share of their intervals over 1.5 refreshes. */
  rafs: number;
  lateShare: number;
  /** The main thread's busy time over the frames that drew, a share. */
  busyShare: number | null;
  /** The main thread's frames in the window. */
  mainFrames: number;
}

interface Run extends RunResult {
  /** What the run did: the select drag's shape, as laid out from the view.
   *  Runs are compared only where it's the same (`perf/ab.ts` pairs a
   *  round only then). */
  workload: { selectPath: { rows: number; lastColumn: number; trips: number } };
  drags: Record<Drag, Reading>;
}

const layoutOf = (page: Page): Promise<Layout | null> => page.evaluate(() => ((globalThis as { __contender?: { layout?: Layout } }).__contender?.layout ?? null));
const widthsOf = (page: Page): Promise<(number | null)[] | null> => page.evaluate(() => (globalThis as { __contender?: { widths?: (number | null)[] } }).__contender?.widths ?? null);
const selectionOf = (page: Page): Promise<unknown> => page.evaluate(() => (globalThis as { __contender?: { selection?: unknown } }).__contender?.selection ?? null);

/** Sends `points` as pointer moves on a fixed schedule, one every
 *  `MOVE_EVERY_MS`, without awaiting each (Playwright's move waits for the
 *  page's handling, which would pace the input by its cost). */
async function moveThrough(page: Page, points: readonly [number, number][]): Promise<void> {
  const sent: Promise<unknown>[] = [];
  const t0 = performance.now();
  for (let index = 0; index < points.length; index++) {
    const wait = t0 + index * MOVE_EVERY_MS - performance.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    const [x, y] = points[index]!;
    // Settled at once, so a failed move can't go unhandled while the loop waits.
    sent.push(page.mouse.move(x, y).then(() => null, (error: unknown) => error));
  }
  const failed = (await Promise.all(sent)).find((result) => result !== null);
  if (failed) throw failed;
}

/** Traces one drag: pressed at `points[0]` (unless the control), moved
 *  through the rest, released; the window from right before the first move
 *  to `TAIL_MS` after the release. */
async function traced(session: Session, points: readonly [number, number][]): Promise<Reading> {
  const { page, browser, side } = session;
  await page.mouse.move(...points[0]!);
  if (!CONTROL) await page.mouse.down();
  await browser.startTracing(page, { categories: WORK_CATEGORIES });
  const from = await page.evaluate((name) => (performance.mark(name), performance.now()), ORIGIN_MARK);
  await moveThrough(page, points.slice(1));
  const released = await now(page);
  if (!CONTROL) await page.mouse.up();
  await page.waitForTimeout(TAIL_MS);
  const to = await now(page);
  const trace = new Trace(JSON.parse((await browser.stopTracing()).toString()));
  const work = frameWork(trace, from, to);
  // The frames that drew, each with its main frame's work from the trace.
  let drawn: { at: number; ms: number }[];
  let recorderP50Ms: number | null | undefined;
  if (side === 'gpui') {
    const presented = await workBetween(page, from, to);
    recorderP50Ms = presented.length ? percentiles(presented.map((sample) => sample.ms)).p50 : null;
    // Each main frame once, however many of its rAF callbacks drew.
    const frames = new Set<(typeof work.frames)[number]>();
    for (const sample of presented) {
      const frame = work.frames.find((candidate) => candidate.at <= sample.t && sample.t <= candidate.at + candidate.ms);
      if (!frame) throw new Error(`a presented frame at ${sample.t.toFixed(1)} ms in no main frame of the trace`);
      frames.add(frame);
    }
    drawn = [...frames].map(({ at, ms }) => ({ at, ms }));
  } else drawn = domPainted(trace, work);
  const share = drewShare(drawn.map((frame) => frame.at));
  const p = drawn.length ? percentiles(drawn.map((frame) => frame.ms)) : null;
  const span = drawn.length ? frameWork(trace, drawn[0]!.at, drawn.at(-1)!.at + drawn.at(-1)!.ms) : null;
  const rafs = await recordedBetween(page, from, released);
  return {
    ...(share ?? {}),
    moves: points.length - 1,
    drewFrames: drawn.length,
    workP50Ms: p?.p50 ?? null,
    workP95Ms: p?.p95 ?? null,
    ...(side === 'gpui' ? { recorderP50Ms } : {}),
    rafs: rafs.length,
    lateShare: lateFrames(frameIntervals(rafs), FRAME_MS).share,
    busyShare: span && span.windowMs > 0 ? span.busyMs / span.windowMs : null,
    mainFrames: work.frames.length,
  };
}

/** Jan 1's band: out `DRAG_PX` and back, `DRAG_TRIPS` times, from its edge on the header row. */
function resizePath(layout: Layout): [number, number][] {
  const column = layout.columns[WIDE_SHEET.heatFrom]!;
  const x = layout.left + column.x + column.width;
  // The control's moves run in the first row of cells: along the header,
  // with no button pressed, they cross the next days' bands, whose hover
  // draws (23 frames a run on both sides).
  const y = CONTROL ? layout.top + layout.rowHeight / 2 : layout.top - Math.min(8, layout.rowHeight / 2);
  const points: [number, number][] = [[x, y]];
  for (let trip = 0; trip < DRAG_TRIPS; trip++)
    for (let step = 1; step <= 2 * DRAG_MOVES; step++) {
      const out = step <= DRAG_MOVES ? step : 2 * DRAG_MOVES - step;
      points.push([x + (DRAG_PX * out) / DRAG_MOVES, y]);
    }
  return points;
}

/** The select drag: from the top row's first scrolled cell to the last row
 *  and column wholly in view and back, a row a move, the column following
 *  the diagonal, in whole round trips for about the resize's moves. */
async function selectPath(page: Page, layout: Layout): Promise<{ points: [number, number][]; shape: Run['workload']['selectPath'] }> {
  const height = await page.evaluate(() => innerHeight);
  const first = WIDE_SHEET.pinned;
  // Rows wholly in the window less two (a horizontal scrollbar's strip):
  // from the layout and the window alone, so both sides lay out the same.
  const rows = Math.floor((height - layout.top) / layout.rowHeight) - 2;
  const lastColumn = layout.columns.findLastIndex((column) => column.x + column.width <= layout.cellsWidth);
  if (rows < 2 || lastColumn <= first) throw new Error(`the select drag needs 2 rows and a scrolled column wholly in view: ${rows} rows, last whole column ${lastColumn}`);
  const span = rows - 1;
  const trips = Math.max(1, Math.round((DRAG_TRIPS * DRAG_MOVES) / span));
  const at = (out: number): [number, number] => {
    const column = layout.columns[first + Math.round((out / span) * (lastColumn - first))]!;
    return [layout.left + column.x + column.width / 2, layout.top + (out + 0.5) * layout.rowHeight];
  };
  const points: [number, number][] = [at(0)];
  for (let step = 1; step <= trips * 2 * span; step++) {
    const phase = step % (2 * span);
    points.push(at(phase <= span ? phase : 2 * span - phase));
  }
  return { points, shape: { rows, lastColumn, trips } };
}

/** Each stop's select drag, as its first run laid it out: a later run
 *  laying it out otherwise fails (the view's rows set it). */
const laidOut = new Map<string, string>();

await runMetric<Run>(
  'drag',
  async ({ side, profile, url, picked }) => {
    const wide = wideStop(picked);
    if (!wide) throw new Error('metric drag: the wide sheet alone (--scenario wide-sheet)');
    let reads: ReturnType<typeof dataReads> | undefined;
    const session = await openSide(side, url, profile, {
      picked,
      init: side === 'gpui' ? [workRecorder, frameRecorder] : [frameRecorder],
      before: async (page) => void (reads = dataReads(page)),
    });
    const { page } = session;
    try {
      await opened(session);
      const failures = [...session.problems];
      // The open's visible pages in and quiet; nothing read whole.
      await quiet(page, reads!.inFlight);
      const layout = await layoutOf(page);
      if (!layout) throw new Error('no __contender.layout with ?measure');
      const drags = {} as Record<Drag, Reading>;

      // Resize: Jan 1's edge out and back; the width at the end the press's.
      const before = layout.columns[WIDE_SHEET.heatFrom]!.width;
      drags.resize = await traced(session, resizePath(layout));
      const after = (await layoutOf(page))?.columns[WIDE_SHEET.heatFrom]?.width;
      const set = (await widthsOf(page))?.[WIDE_SHEET.heatFrom] ?? null;
      if (after !== before || (set !== null && set !== before)) failures.push(`resize: Jan 1 ended at ${after} px (set ${set}), not the press's ${before}`);

      // Select: the diagonal and back, ending on the pressed cell.
      const { points, shape } = await selectPath(page, layout);
      const key = `${side} ${wide.stop.id}`;
      const laid = JSON.stringify(shape);
      if (laidOut.has(key) && laidOut.get(key) !== laid) failures.push(`select: laid out ${laid}, not ${laidOut.get(key)} as the first run`);
      laidOut.set(key, laid);
      drags.select = await traced(session, points);
      const selection = JSON.stringify(await selectionOf(page));
      const pressed = JSON.stringify({ kind: 'cells', anchor: [0, WIDE_SHEET.pinned], head: [0, WIDE_SHEET.pinned] });
      if (!CONTROL && selection !== pressed) failures.push(`select: ended on ${selection}, not the pressed cell ${pressed}`);
      if (CONTROL && selection !== 'null') failures.push(`control: the moves alone selected ${selection}`);

      for (const drag of DRAGS) {
        const reading = drags[drag];
        if (CONTROL ? reading.drewFrames >= 2 : reading.share === undefined) failures.push(`${drag}: ${reading.drewFrames} frame${reading.drewFrames === 1 ? '' : 's'} drew${CONTROL ? ' with no button pressed (the control)' : ` for ${reading.moves} moves`}`);
      }
      return { workload: { selectPath: shape }, drags, failures };
    } finally {
      await session.close();
    }
  },
  (runs) => {
    const of = (drag: Drag) => {
      const read = (run: Run) => run.drags[drag];
      return {
        drewPct: medianOf(runs, (run) => (read(run).share ?? NaN) * 100),
        drewPctRuns: runs.map((run) => (read(run).share === undefined ? null : Number((read(run).share! * 100).toFixed(1)))),
        drewFrames: medianOf(runs, (run) => read(run).drewFrames, 0),
        workP50Ms: medianOf(runs, (run) => read(run).workP50Ms, 2),
        workP95Ms: medianOf(runs, (run) => read(run).workP95Ms, 2),
        ...(runs[0] && read(runs[0]).recorderP50Ms !== undefined ? { recorderP50Ms: medianOf(runs, (run) => read(run).recorderP50Ms, 2) } : {}),
        latePct: medianOf(runs, (run) => read(run).lateShare * 100),
        busyPct: medianOf(runs, (run) => (read(run).busyShare ?? NaN) * 100),
        moves: medianOf(runs, (run) => read(run).moves, 0),
      };
    };
    return { ...Object.fromEntries(DRAGS.map((drag) => [drag, of(drag)])), workloads: [...new Set(runs.map((run) => JSON.stringify(run.workload)))].map((workload) => JSON.parse(workload)) };
  },
  { drags: { resize: { column: WIDE_SHEET.heatFrom, px: DRAG_PX, trips: DRAG_TRIPS, movesEachWay: DRAG_MOVES }, select: { from: [0, WIDE_SHEET.pinned] } }, moveEveryMs: MOVE_EVERY_MS, tailMs: TAIL_MS, ...(CONTROL ? { control: 'the moves with no button pressed' } : {}) },
  { levels: ['wide'], allStops: true },
);
