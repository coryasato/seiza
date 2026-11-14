// The base's frame work in the bare host, the baseline every feature's
// added work is read against (PLAN.md, "Measuring a feature"). Per shape
// (narrow, wide), on the host's release build, cold, under the root's
// measurement protocol (reference and throttled, median of `--runs`):
//
// - scroll: a steady wheel scroll down, 300 px every 16 ms for 2 s (about
//   600 rows/s: it crosses a page);
// - fling: shared-web/perf/'s `fling`, top to the last row in ~3 s;
// - hfling (wide only): the same sideways, the first column to the last;
// - resize (a build with `resize`): the first float column's edge dragged
//   right 200 px and back, twice, a move every 8 ms (about 2 s), so every
//   frame re-lays out the columns; back at the press, the release changes
//   nothing. Every 8 ms, as the sideways fling's wheels and a mouse's
//   reports: at a move a frame, throttled frames outran the moves' delivery
//   and half drew nothing;
// - reorder (a build with `reorder`): the first float column's header
//   (by place) pressed and dragged right 600 px and back, twice, a move
//   every 8 ms (about 2 s), so every frame moves the preview and the gap's
//   line; released where it was pressed, beside the block, so nothing
//   moves. With `select` (or `copy`, which turns it on), the column is
//   selected first, so the press drags it;
// - select (a build with `select`): a drag-select from a cell near the top
//   left to the last fully visible row and column and back, a row a move
//   (the column following along the diagonal), a move every 8 ms, about
//   2 s of round trips, so every move changes the selection and every frame
//   redraws the block's tint. Moves that stayed in one cell would draw
//   nothing (a redraw only when the selection changes), and the trace's
//   p50 would read those idle frames.
//
// Built with `sort`, the scroll and both flings run again with a column
// sorted (`scroll-sorted`, `fling-sorted`, `hfling-sorted`: the narrow
// shape's `H`, the wide's first column, descending, through the host's
// hook, its order computed before the window), against the unsorted ones
// before them; the sort is undone before the drags.
//
// Built with `pin`, every segment runs with the shape's columns pinned (the
// host's default: 2 in the narrow shape, 1 in the wide), or `--pin <n>`'s
// (`?pin=`; `--pin 0` builds the feature with nothing pinned, the control
// that splits the code's cost from the drawing's), checked at open; the
// visible cells count the pinned columns and the scrolled ones right of
// them.
//
// Built with `density`, every segment runs at the host's default density
// (`?density=` unset: 18 px rows, 11 px text, 56 px floats), or
// `--density <row>,<text>[,<width>]`'s (`--density 30,14` the control: the
// feature built at the base's numbers, the kind widths kept), checked at
// open against the layout probe's row.
//
// Built with `select`, a select-all (a press on the corner: every column)
// stands under the scroll and both flings, so the tint draws every frame;
// between segments it's cleared for Home (which would move only its active
// cell) and pressed again.
//
// Built with `reorder`, `--order reverse` draws the columns reversed from
// the first frame (`?order=reverse`, checked at open), so every segment
// reads the columns through the order; without it, the list's own.
//
// Built with `format`, every float column formatted (2 decimals, 3 on
// every fourth row, a `+` on a rise, grouped) and the narrow shape's
// `spkid` grouped (the host's), or with `--format off` none (`?format=off`:
// the control that splits the code's cost from the drawing's).
//
// Each segment is traced on its own: per-frame work is the trace's
// `ProxyMain::BeginMainFrame` (`frameWork`), cross-checked by
// `workRecorder` (each rAF that drew); late frames and intervals come from
// `frameRecorder`'s rAFs (Chromium's compositor reporter doesn't see GPUI's
// canvas frames), with what each frame showed (`__seizaFrameSample`):
// placeholder frames and the visible cells (rows × columns on screen). Beside
// the late share, the presented frames: `workRecorder`'s rAFs that drew,
// from the segment's start to the last one, a second and as a share of the
// rAFs. The late share reads rAF intervals, which hold the display's rate
// while GPUI draws on every other rAF; and not every rAF has something new
// to draw, so a build's presented frames are read against the base's in the
// same segment, never against a rate.
//
// A segment's rest (the view filled where its input took it, and no frame
// presented for `QUIET_MS`: Playwright resolves a wheel before the page
// handles it, so a throttled dense table is still scrolling through queued
// wheels when the last one resolves; harness.ts's `restedWhere`) is waited
// for as long as the table keeps presenting frames: a slice of
// `REST_SLICE_MS` with neither ends it, as does `REST_CAP_MS` in all. Every
// reading is over the segment's start to `TAIL_MS` after its last presented
// frame, so the quiet spell adds no idle frames. A segment that doesn't rest
// is reported as not reached (`reached: false`, its numbers over what it
// drew): a failure of the reference run, never of the throttled one, where
// a dense table's frames can outlast any fixed wait.
//
// The build is whichever `just tall-table build [features]` made last
// (recorded as `build`); with `custom-cells`, `--cells text|heat|bars|color`
// paints every float column that way (`text`, the control, paints nothing).
//
// Usage: node components/tall-table/perf/perf.ts [--runs 10] [--shape narrow|wide]
//          [--profile reference|throttled] [--cells <style>] [--pin <n>]
//          [--density <row>,<text>[,<width>]] [--format off] [--order reverse]
//          [--label <name>]
// --label writes perf/results/<date>-<label>.json. Run `just tall-table build` first.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { fling, frameIntervals, frameRecorder, frameStats, open, recordedBetween, waitMark, wheel, workBetween, workRecorder, type RecordedFrame } from '../../../shared-web/perf/harness.ts';
import { PROFILES, localDate, machineInfo, median, option, percentiles, type Profile } from '../../../shared-web/perf/protocol.ts';
import { serveApp } from '../../../shared-web/perf/serve.ts';
import { ORIGIN_MARK, Trace, WORK_CATEGORIES, frameWork, lateFrames } from '../../../shared-web/perf/trace.ts';
import { CELL_STYLES, COLUMN_ORDER_GLOBAL, DEFAULT_DENSITY, DEFAULT_PINNED, FILLED_MARK, PORT, SHAPES, SELECT_OFFSET_PX, SORTED_COLUMN, bandAt, global, moveGripAt, selectOn, buildName, builtFeatures, cellAt, cornerAt, hostWebDir, restedWhere, perfDir, selected, shown, sortThrough, visibleColumns, type CellStyle, type Layout, type Shape, type Shown, type Sort, pick } from './harness.ts';

const RUNS = Number(option('runs') ?? 10);
const shapes = pick('shape', SHAPES);
const profiles = pick('profile', PROFILES.map((profile) => profile.name)).map((name) => PROFILES.find((profile) => profile.name === name)!);
if (!Number.isInteger(RUNS) || RUNS < 1) throw new Error(`--runs ${option('runs')}: not a positive whole number`);
const features = builtFeatures();
const BUILD = buildName(features);
const CELLS = option('cells') as CellStyle | undefined;
if (CELLS !== undefined && !CELL_STYLES.includes(CELLS)) throw new Error(`--cells ${CELLS}: not one of ${CELL_STYLES.join(', ')}`);
if (CELLS !== undefined && !features.includes('custom-cells')) throw new Error('--cells needs the host built with custom-cells: `just tall-table build custom-cells`');
const PIN = features.includes('pin');
const PIN_OPTION = option('pin');
if (PIN_OPTION !== undefined && !PIN) throw new Error('--pin needs the host built with pin: `just tall-table build pin`');
if (PIN_OPTION !== undefined && !/^\d+$/.test(PIN_OPTION)) throw new Error(`--pin ${PIN_OPTION}: not a whole count`);
/** The columns each shape pins (`pin`): `--pin`'s, or the host's default. */
const pinned = (shape: Shape) => (PIN_OPTION === undefined ? DEFAULT_PINNED[shape] : Number(PIN_OPTION));
const DENSITY = features.includes('density');
const DENSITY_OPTION = option('density');
if (DENSITY_OPTION !== undefined && !DENSITY) throw new Error('--density needs the host built with density: `just tall-table build density`');
if (DENSITY_OPTION !== undefined && !/^\d+(\.\d+)?,\d+(\.\d+)?(,\d+(\.\d+)?)?$/.test(DENSITY_OPTION)) throw new Error(`--density ${DENSITY_OPTION}: not <row>,<text>[,<width>] in px`);
/** The row the layout reports at open (`density`): `--density`'s, at least
 *  its text (the table's clamp, the text at least 6 px), or the host's
 *  default. */
const densityRow = (() => {
  if (DENSITY_OPTION === undefined) return DEFAULT_DENSITY.row;
  const [row, text] = DENSITY_OPTION.split(',').map(Number) as [number, number];
  return Math.max(row, text, 6);
})();
const FORMAT = features.includes('format');
const FORMAT_OPTION = option('format');
if (FORMAT_OPTION !== undefined && !FORMAT) throw new Error('--format needs the host built with format: `just tall-table build format`');
if (FORMAT_OPTION !== undefined && FORMAT_OPTION !== 'off') throw new Error(`--format ${FORMAT_OPTION}: only \`off\` (the control)`);
const REORDER = features.includes('reorder');
const ORDER_OPTION = option('order');
if (ORDER_OPTION !== undefined && !REORDER) throw new Error('--order needs the host built with reorder: `just tall-table build reorder`');
if (ORDER_OPTION !== undefined && ORDER_OPTION !== 'reverse') throw new Error(`--order ${ORDER_OPTION}: only \`reverse\``);
console.log(`build: ${BUILD}${CELLS ? `, cells: ${CELLS}` : ''}${PIN ? `, pin: ${PIN_OPTION ?? 'default'}` : ''}${DENSITY ? `, density: ${DENSITY_OPTION ?? 'default'}` : ''}${FORMAT ? `, format: ${FORMAT_OPTION ?? 'on'}` : ''}${REORDER ? `, order: ${ORDER_OPTION ?? 'own'}` : ''}`);
/** The steady scroll: this many px every `SCROLL_EVERY_MS`, for `SCROLL_STEPS`. */
const SCROLL_PX = 300;
const SCROLL_EVERY_MS = 16;
const SCROLL_STEPS = 125;
/** The sideways fling's length, as `fling`'s. */
const FLING_MS = 3_000;
/** The resize drag: out this far and back, `DRAG_TRIPS` times, a move
 *  every `DRAG_EVERY_MS`, `DRAG_MOVES` moves each way. */
const DRAG_PX = 200;
const DRAG_TRIPS = 2;
const DRAG_MOVES = 62;
const DRAG_EVERY_MS = 8;
const RESIZE = features.includes('resize');
const SELECT = features.includes('select');
/** The reorder drag: right this far and back, `DRAG_TRIPS` times, at the
 *  resize drag's moves. */
const MOVE_PX = 600;

const SORT = features.includes('sort');
/** The sorted segments' order: each shape's `SORTED_COLUMN`, descending
 *  (a float's first click). */
const SORTED: Record<Shape, Sort> = { narrow: { column: SORTED_COLUMN.narrow, direction: 'descending' }, wide: { column: SORTED_COLUMN.wide, direction: 'descending' } };
/** Fewer frames drawn during the drag than this fails the run. */
const MIN_DRAG_FRAMES = 10;
/** Idle after a segment's view rests, inside its window. */
const TAIL_MS = 300;
/** A rest is waited for in slices this long while frames are presented,
 *  `REST_CAP_MS` in all. */
const REST_SLICE_MS = 10_000;
const REST_CAP_MS = 300_000;
/** A rest presents no frame for this long. */
const QUIET_MS = 300;

type Segment = 'scroll' | 'fling' | 'hfling' | 'scroll-sorted' | 'fling-sorted' | 'hfling-sorted' | 'resize' | 'select' | 'reorder';
const SEGMENTS: Segment[] = ['scroll', 'fling', 'hfling', 'scroll-sorted', 'fling-sorted', 'hfling-sorted', 'resize', 'select', 'reorder'];
type Sample = Partial<Pick<Shown, 'top' | 'first' | 'end' | 'loaded' | 'pending' | 'scrollX'>>;

interface Reading {
  /** Frames the trace saw in the window, and their work (ms). */
  frames: number;
  workP50Ms: number;
  workP95Ms: number;
  workMaxMs: number;
  /** Main-thread CPU over the window, ms, and of it outside any frame. */
  busyMs: number;
  outsideFramesMs: number;
  /** `workRecorder`'s rAFs that drew: the cross-check. */
  recorder: { frames: number; p50Ms: number; p95Ms: number };
  /** rAF intervals: p50, p95, max, and the late ones' share. */
  intervals: { p50Ms: number; p95Ms: number; maxMs: number };
  latePct: number;
  /** `workRecorder`'s rAFs that drew, from the window's start to the last
   *  one: a second, and as a share of `frameRecorder`'s rAFs. */
  presented: { frames: number; perSecond: number; ofRafsPct: number };
  /** Frames showing any placeholder row. */
  placeholderPct: number;
  /** Visible cells per frame (rows × columns on screen): p50, max. Not
   *  for the resize drag: the layout isn't reported until its release, so
   *  the columns on screen during it aren't known. */
  cells?: { p50: number; max: number };
  windowMs: number;
  /** Whether the view rested where the input took it, filled. */
  reached: boolean;
}

/** The drag-select's moves in each shape, as its first run laid them out
 *  (the view's rows and columns set them); a later run laying them out
 *  otherwise fails. */
type SelectDrag = { rowsEachWay: number; lastColumn: number; trips: number; moves: number };
const selectDrags: Partial<Record<Shape, SelectDrag>> = {};

const now = (page: Page) => page.evaluate(() => performance.now());

/** A segment's rest (`restedWhere`, at the slices and quiet here). */
const rest = (page: Page, test: string) => restedWhere(page, test, { sliceMs: REST_SLICE_MS, capMs: REST_CAP_MS, quietMs: QUIET_MS });

/** Traces `act` on its own: from right after tracing starts (the origin
 *  mark) to `TAIL_MS` after the last frame presented by the end of `act`,
 *  which returns once the view rests (`false` if it didn't). Every reading
 *  is over that window, so a rest's quiet spell adds no idle frames.
 *  `layout` counts the visible cells; `null` while it changes unreported
 *  (a resize drag), when they aren't counted. */
async function traced(browser: Browser, page: Page, layout: Layout | null, act: () => Promise<boolean | void>): Promise<Reading> {
  await browser.startTracing(page, { categories: WORK_CATEGORIES });
  const from = await page.evaluate((name) => (performance.mark(name), performance.now()), ORIGIN_MARK);
  const reached = (await act()) !== false;
  const acted = await now(page);
  const drawn = await workBetween(page, from, acted);
  const lastDrawn = drawn.at(-1)?.t ?? acted;
  const to = lastDrawn + TAIL_MS;
  const left = to - (await now(page));
  if (left > 0) await page.waitForTimeout(left);
  const trace = new Trace(JSON.parse((await browser.stopTracing()).toString()));
  const work = frameWork(trace, from, to);
  const perFrame = percentiles(work.frames.map((frame) => frame.ms));
  const recorded = percentiles((await workBetween(page, from, to)).map((sample) => sample.ms));
  const frames = (await recordedBetween<Sample>(page, from, to)) as RecordedFrame<Sample>[];
  const stats = frameStats(frames);
  const intervals = frameIntervals(frames);
  const seen = frames.filter((frame) => frame.end !== undefined && frame.first !== undefined);
  const placeholders = seen.filter((frame) => frame.loaded! < frame.end! - frame.first!).length;
  const cells = layout && percentiles(seen.map((frame) => (frame.end! - frame.first!) * visibleColumns(layout, frame.scrollX ?? 0)));
  const drew = drawn.length;
  // The presented frames to the last one: the tail draws nothing.
  const rafs = frames.filter((frame) => frame.t <= lastDrawn).length;
  const round = (ms: number) => Number(ms.toFixed(2));
  return {
    frames: work.frames.length,
    workP50Ms: round(perFrame.p50),
    workP95Ms: round(perFrame.p95),
    workMaxMs: round(perFrame.max),
    busyMs: round(work.busyMs),
    outsideFramesMs: round(work.busyMs - work.inFramesMs),
    recorder: { frames: recorded.n, p50Ms: round(recorded.p50), p95Ms: round(recorded.p95) },
    intervals: { p50Ms: round(stats.p50), p95Ms: round(stats.p95), maxMs: round(stats.max) },
    latePct: round(lateFrames(intervals).share * 100),
    presented: { frames: drew, perSecond: round((drew * 1000) / Math.max(lastDrawn - from, 1)), ofRafsPct: round(rafs ? (drew / rafs) * 100 : 0) },
    placeholderPct: round(seen.length ? (placeholders / seen.length) * 100 : 0),
    ...(cells ? { cells: { p50: cells.p50, max: cells.max } } : {}),
    windowMs: round(to - from),
    reached,
  };
}

/** Home, then until row 0 is on screen, filled. With `select`, Escape
 *  first (Home moves the active cell, which the select-all left at row 0
 *  already, so it would scroll nothing), and the select-all again after
 *  unless `reselect` is false (the drags, which run with nothing selected). */
async function home(page: Page, layout: Layout, reselect = true): Promise<void> {
  if (SELECT) {
    await page.keyboard.press('Escape');
    await selected(page, null);
  }
  await page.keyboard.press('Home');
  if (!(await rest(page, 's.first === 0 && s.scrollX === 0'))) throw new Error("Home didn't rest at the top, filled");
  if (SELECT && reselect) await selectAll(page, layout);
}

/** With `select`: a press on the corner, every column selected (anchored
 *  at the top visible row), then the pointer back over the cells. */
async function selectAll(page: Page, layout: Layout): Promise<void> {
  const corner = cornerAt(layout);
  await page.mouse.click(corner.x, corner.y);
  const { first } = (await shown(page)).shown;
  await selected(page, { kind: 'columns', anchor: [first, 0], head: [first, layout.columns.length - 1] });
  await page.mouse.move(layout.left + 300, layout.top + 300);
}

/** One cold run of `shape`: every segment, each traced on its own. */
async function run(url: string, shape: Shape, profile: Profile): Promise<{ readings: Partial<Record<Segment, Reading>>; failures: string[] }> {
  const failures: string[] = [];
  const readings: Partial<Record<Segment, Reading>> = {};
  let session: Awaited<ReturnType<typeof open>> | null = null;
  try {
    // Inside the try: a browser that fails to launch fails this run, not the rest.
    const params: Record<string, string> = { shape };
    if (CELLS) params.cells = CELLS;
    if (PIN_OPTION !== undefined) params.pin = PIN_OPTION;
    if (DENSITY_OPTION !== undefined) params.density = DENSITY_OPTION;
    if (FORMAT_OPTION !== undefined) params.format = FORMAT_OPTION;
    if (ORDER_OPTION !== undefined) params.order = ORDER_OPTION;
    session = await open(chromium, url, { profile, params, init: [workRecorder, frameRecorder] });
    const { page } = session;
    const browser = session.context.browser()!;
    await waitMark(page, FILLED_MARK);
    const { shown: start, layout } = await shown(page);
    // The run in effect, at 1440 wide: every count here within the half.
    if (PIN && layout.pinned !== pinned(shape)) throw new Error(`${layout.pinned} columns pinned at open, not ${pinned(shape)}`);
    if (DENSITY && layout.rowHeight !== densityRow) throw new Error(`rows ${layout.rowHeight} px at open, not ${densityRow}`);
    const order = layout.columns.map((column, place) => column.index ?? place);
    if (REORDER && JSON.stringify(order) !== JSON.stringify(ORDER_OPTION === 'reverse' ? order.map((_, place) => order.length - 1 - place) : order.map((_, place) => place))) throw new Error(`the columns at open in the order ${JSON.stringify(order.slice(0, 12))}…, not ${ORDER_OPTION ?? "the list's own"}`);
    // Over the cells, clear of the scrollbar.
    await page.mouse.move(layout.left + 300, layout.top + 300);
    if (SELECT) await selectAll(page, layout);
    /** With `select`, a failure unless the select-all stood through `segment`. */
    const stood = async (segment: Segment) => {
      if (SELECT && (await shown(page)).shown.selection?.kind !== 'columns') failures.push(`the select-all didn't stand through the ${segment}`);
    };

    /** The scroll, the fling, and (wide) the sideways fling, each from
     *  the top, named with `suffix`; the sideways scroll back at 0 after. */
    const scrollAndFlings = async (suffix: '' | '-sorted') => {
      readings[`scroll${suffix}`] = await traced(browser, page, layout, async () => {
        const sent: Promise<void>[] = [];
        // On a fixed schedule, not awaiting each wheel: Playwright's waits
        // for the page's handling, which would pace the input by its cost.
        for (let step = 0; step < SCROLL_STEPS; step++) {
          sent.push(wheel(page, SCROLL_PX));
          await page.waitForTimeout(SCROLL_EVERY_MS);
        }
        await Promise.all(sent);
        return (await rest(page, 'true')) !== null;
      });
      await stood(`scroll${suffix}`);
      await home(page, layout);

      readings[`fling${suffix}`] = await traced(browser, page, layout, async () => {
        await fling(page, start.rows, { rowHeight: layout.rowHeight });
        return (await rest(page, 's.end === s.rows')) !== null;
      });
      await stood(`fling${suffix}`);

      if (shape === 'wide') {
        await home(page, layout);
        const last = layout.columns.at(-1)!;
        const room = last.x + last.width - layout.cellsWidth;
        readings[`hfling${suffix}`] = await traced(browser, page, layout, async () => {
          const wallStart = Date.now();
          const sent: Promise<void>[] = [];
          let moved = 0;
          while (Date.now() - wallStart < FLING_MS) {
            const remaining = FLING_MS - (Date.now() - wallStart);
            const delta = Math.max(100, ((room - moved) * 16) / Math.max(remaining, 16));
            sent.push(wheel(page, 0, delta));
            moved += delta;
            await page.waitForTimeout(8);
          }
          if (moved < room) sent.push(wheel(page, 0, room - moved));
          await Promise.all(sent);
          return (await rest(page, `s.scrollX >= ${room - 1}`)) !== null;
        });
        await stood(`hfling${suffix}`);
        // For what follows: Home is vertical, so the sideways fling's
        // scroll goes back by wheel.
        await wheel(page, 0, -(layout.columns.at(-1)!.x + 1_000));
      }
    };

    await scrollAndFlings('');
    if (SORT) {
      // Sorted from the top, the order computed before the windows: the
      // host's source sorts on the main thread, at the order's first sort.
      await home(page, layout, false);
      await sortThrough(page, SORTED[shape], 60_000);
      await home(page, layout);
      await scrollAndFlings('-sorted');
      await home(page, layout, false);
      await sortThrough(page, null);
    }

    // Last, so the other segments run as in a build without it; with
    // nothing selected, as in a build without `select`.
    if (RESIZE) {
      await home(page, layout, false);
      const column = layout.columns.findIndex((column) => column.kind === 'float');
      const band = bandAt(layout, column, 0);
      await page.mouse.move(band.x, band.y);
      await page.mouse.down();
      readings.resize = await traced(browser, page, null, async () => {
        // On a fixed schedule, as the scroll's wheels.
        const sent: Promise<void>[] = [];
        for (let trip = 0; trip < DRAG_TRIPS; trip++) {
          for (let step = 1; step <= 2 * DRAG_MOVES; step++) {
            const out = step <= DRAG_MOVES ? step : 2 * DRAG_MOVES - step;
            sent.push(page.mouse.move(band.x + (DRAG_PX * out) / DRAG_MOVES, band.y));
            await page.waitForTimeout(DRAG_EVERY_MS);
          }
        }
        await Promise.all(sent);
        await page.mouse.up();
      });
      // Each move redraws: a press that missed the band draws next to
      // none. Throttled, frames drawn run well under the moves (~86 of 248).
      const moves = DRAG_TRIPS * 2 * DRAG_MOVES;
      if (readings.resize.recorder.frames < MIN_DRAG_FRAMES) failures.push(`the resize drag drew ${readings.resize.recorder.frames} frames for ${moves} moves: did it press the band?`);
    }

    // After the resize drag, which leaves the widths as they were.
    if (SELECT) {
      await home(page, layout, false);
      const view = (await shown(page)).shown;
      // A row a move, from row 1 to the last row wholly in view (the
      // column following along the diagonal to the last wholly in view)
      // and back, a move every `DRAG_EVERY_MS`, in whole round trips for
      // about the resize drag's moves (`DRAG_TRIPS × 2 × DRAG_MOVES`), so
      // it ends on the cell it pressed. Every move changes the selection:
      // a move within one cell would draw nothing.
      const lastColumn = layout.columns.findLastIndex((column) => column.x + column.width <= layout.cellsWidth);
      const span = view.end - 3;
      if (span < 1 || lastColumn < 0) throw new Error(`the drag-select needs 2 rows and a column wholly in view: rows ${view.first}–${view.end}, last whole column ${lastColumn}`);
      const trips = Math.max(1, Math.round((DRAG_TRIPS * DRAG_MOVES) / span));
      const moves = trips * 2 * span;
      const laid: SelectDrag = { rowsEachWay: span, lastColumn, trips, moves };
      const recorded = (selectDrags[shape] ??= laid);
      if (JSON.stringify(recorded) !== JSON.stringify(laid)) failures.push(`the drag-select laid out ${JSON.stringify(laid)}, not ${JSON.stringify(recorded)} as the first run did`);
      const at = (out: number) => cellAt(layout, view, 1 + out, Math.round((out / span) * lastColumn));
      const from = at(0);
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      readings.select = await traced(browser, page, layout, async () => {
        const sent: Promise<void>[] = [];
        for (let step = 1; step <= moves; step++) {
          const phase = step % (2 * span);
          const to = at(phase <= span ? phase : 2 * span - phase);
          sent.push(page.mouse.move(to.x, to.y));
          await page.waitForTimeout(DRAG_EVERY_MS);
        }
        await Promise.all(sent);
        await page.mouse.up();
      });
      // Back where it started: the press's cell alone.
      await selected(page, { kind: 'cells', anchor: [1, 0], head: [1, 0] }).catch(() => failures.push("the drag-select didn't end on the cell it pressed"));
      if (readings.select.recorder.frames < MIN_DRAG_FRAMES) failures.push(`the drag-select drew ${readings.select.recorder.frames} frames for ${moves} moves: did it press a cell?`);
    }
    // Last. With `select` (or `copy`), the column is selected first, so its
    // tint stands through the drag; otherwise nothing is selected.
    if (REORDER) {
      await home(page, layout, false);
      const place = layout.columns.findIndex((column) => column.kind === 'float');
      const grip = moveGripAt(layout, place, 0);
      // With `select` (`copy` turns it on), only a press inside a selected
      // `Columns` range drags: the column selected first, a press beside
      // the drag's.
      if (selectOn(features)) {
        await page.mouse.click(grip.x + SELECT_OFFSET_PX, grip.y);
        await selected(page, { kind: 'columns', anchor: [0, place], head: [0, place] });
      }
      await page.mouse.move(grip.x, grip.y);
      await page.mouse.down();
      readings.reorder = await traced(browser, page, layout, async () => {
        // On a fixed schedule, as the resize drag's.
        const sent: Promise<void>[] = [];
        for (let trip = 0; trip < DRAG_TRIPS; trip++) {
          for (let step = 1; step <= 2 * DRAG_MOVES; step++) {
            const out = step <= DRAG_MOVES ? step : 2 * DRAG_MOVES - step;
            sent.push(page.mouse.move(grip.x + (MOVE_PX * out) / DRAG_MOVES, grip.y));
            await page.waitForTimeout(DRAG_EVERY_MS);
          }
        }
        await Promise.all(sent);
        await page.mouse.up();
      });
      // Released beside the block: nothing moved.
      const after = (await shown(page)).layout.columns.map((column, at) => column.index ?? at);
      const published = await global<number[]>(page, COLUMN_ORDER_GLOBAL);
      if (JSON.stringify(after) !== JSON.stringify(order) || (published && JSON.stringify(published) !== JSON.stringify(order))) failures.push(`the reorder drag's release moved the columns (${JSON.stringify(after.slice(0, 12))}…)`);
      if (readings.reorder.recorder.frames < MIN_DRAG_FRAMES) failures.push(`the reorder drag drew ${readings.reorder.recorder.frames} frames for ${DRAG_TRIPS * 2 * DRAG_MOVES} moves: did it press the header?`);
    }
    for (const [segment, reading] of Object.entries(readings)) {
      if (reading.reached) continue;
      if (profile.name === 'reference') failures.push(`the ${segment} didn't rest where its input took it, filled`);
      else console.log(`  ${shape} ${profile.name} ${segment}: not reached (no rest, filled, while frames were presented)`);
    }
    failures.push(...session.problems);
  } catch (error) {
    failures.push((error as Error).message.split('\n')[0]!);
  } finally {
    await session?.close();
  }
  return { readings, failures };
}

/** The median over runs of each number in a reading. */
function summarize(readings: Reading[]): Record<string, number> {
  const out: Record<string, number> = {};
  const flat = (reading: Reading) => {
    const entries: [string, number][] = [];
    const walk = (prefix: string, value: object) => {
      for (const [key, inner] of Object.entries(value)) {
        if (typeof inner === 'number') entries.push([prefix + key, inner]);
        else walk(`${prefix}${key}.`, inner as object);
      }
    };
    walk('', reading);
    return entries;
  };
  for (const [key] of flat(readings[0]!)) out[key] = Number(median(readings.map((reading) => Object.fromEntries(flat(reading))[key]!)).toFixed(2));
  return out;
}

const server = await serveApp(undefined, { webDir: hostWebDir, port: PORT });
const results: Record<string, Record<string, { runs: Partial<Record<Segment, Reading>>[]; summary: Partial<Record<Segment, Record<string, number>>> }>> = {};
const failures: string[] = [];
try {
  for (const shape of shapes) {
    for (const profile of profiles) {
      const runs: Partial<Record<Segment, Reading>>[] = [];
      for (let index = 0; index < RUNS; index++) {
        const { readings, failures: found } = await run(server.url, shape, profile);
        failures.push(...found.map((failure) => `${shape} ${profile.name} run ${index + 1}: ${failure}`));
        runs.push(readings);
        const line = Object.entries(readings).map(([segment, reading]) => `${segment}${reading.reached ? '' : ' (not reached)'} work p50 ${reading.workP50Ms} p95 ${reading.workP95Ms} ms, late ${reading.latePct}%, presented ${reading.presented.perSecond}/s (${reading.presented.ofRafsPct}% of rAFs)${reading.cells ? `, cells ${reading.cells.p50}` : ''}`);
        console.log(`${shape} ${profile.name} ${index + 1}/${RUNS}: ${line.join('; ')}`);
      }
      const summary: Partial<Record<Segment, Record<string, number>>> = {};
      for (const segment of SEGMENTS) {
        const readings = runs.flatMap((reading) => (reading[segment] ? [reading[segment]] : []));
        if (readings.length) summary[segment] = { ...summarize(readings), notReached: readings.filter((reading) => !reading.reached).length };
      }
      (results[shape] ??= {})[profile.name] = { runs, summary };
      for (const [segment, numbers] of Object.entries(summary))
        console.log(`  ${shape} ${profile.name} ${segment} (median of ${RUNS}): work p50 ${numbers.workP50Ms} p95 ${numbers.workP95Ms} ms (recorder ${numbers['recorder.p50Ms']}/${numbers['recorder.p95Ms']}), late ${numbers.latePct}%, presented ${numbers['presented.perSecond']}/s (${numbers['presented.ofRafsPct']}% of rAFs)${numbers.notReached ? `, not reached in ${numbers.notReached}` : ''}, intervals p95 ${numbers['intervals.p95Ms']} ms, placeholders ${numbers.placeholderPct}%${numbers['cells.p50'] === undefined ? '' : `, cells p50 ${numbers['cells.p50']} max ${numbers['cells.max']}`}, busy ${numbers.busyMs} ms`);
    }
  }
} finally {
  await server.close();
}

const label = option('label');
if (label) {
  const date = localDate();
  const out = join(perfDir, 'results', `${date}-${label}.json`);
  mkdirSync(join(perfDir, 'results'), { recursive: true });
  const protocol = { browser: 'chromium headless=new', viewport: '1440x900', dpr: 2, runs: RUNS, cold: true, scroll: { px: SCROLL_PX, everyMs: SCROLL_EVERY_MS, steps: SCROLL_STEPS }, flingMs: FLING_MS, ...(RESIZE ? { resizeDrag: { px: DRAG_PX, trips: DRAG_TRIPS, movesEachWay: DRAG_MOVES, everyMs: DRAG_EVERY_MS } } : {}), ...(SELECT ? { selectAllStanding: true, selectDrag: { ...selectDrags, everyMs: DRAG_EVERY_MS } } : {}), ...(SORT ? { sorted: SORTED } : {}), ...(PIN ? { pinned: Object.fromEntries(shapes.map((shape) => [shape, pinned(shape)])) } : {}), ...(DENSITY ? { density: DENSITY_OPTION ?? `${DEFAULT_DENSITY.row},${DEFAULT_DENSITY.text},${DEFAULT_DENSITY.width}` } : {}), ...(FORMAT ? { format: FORMAT_OPTION ?? 'on' } : {}), ...(REORDER ? { order: ORDER_OPTION ?? 'own', reorderDrag: { px: MOVE_PX, trips: DRAG_TRIPS, movesEachWay: DRAG_MOVES, everyMs: DRAG_EVERY_MS } } : {}), restSliceMs: REST_SLICE_MS, tailMs: TAIL_MS, build: BUILD, cells: CELLS ?? null };
  writeFileSync(out, `${JSON.stringify({ date, label, ...machineInfo(), protocol, results, failures }, null, 2)}\n`);
  console.log(`wrote ${out}`);
}
if (failures.length) {
  console.error(`FAIL\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
