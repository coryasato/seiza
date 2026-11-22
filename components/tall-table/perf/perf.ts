// The base's frame work in the bare host, the baseline every feature's
// added work is read against (perf/CLAUDE.md, "Measuring a feature"). Per shape
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
// Built with `group-headers`, every segment runs under the host's default
// groups (two levels, so the header is three rows tall and the body shows
// two rows fewer: compare the work at the cells drawn), or with
// `--groups 0` none (`?groups=0`: the control that splits the code's cost
// from the drawing's); the header's rows checked at open. With `reorder`
// too, the reorder drag's column is held to its group, and a
// `reorder-group` drag follows it: the inner group holding that column
// lifted by its cell and dragged as the column is, released where it was
// pressed, so nothing moves.
//
// Built with `format`, every float column formatted (2 decimals, 3 on
// every fourth row, a `+` on a rise, grouped) and the narrow shape's
// `spkid` grouped (the host's), or with `--format off` none (`?format=off`:
// the control that splits the code's cost from the drawing's).
//
// Built with `hide`, `--hidden <n>` hides every `n`th column from the first
// frame (`?hidden=<n>`, 2 or more: 2 hides every other one, so half the wide shape's
// columns lie at no width), checked at open against the layout probe; without
// it, none (the control that splits the code's cost from the drawing's). The
// visible cells count the shown columns.
//
// Built with `find`, `--find <term>` sets the term from the first frame
// (`?find=<term>`, checked at open against the probe), so every drawn cell
// is tested against it and each match's tint drawn; without it, none (the
// control that splits the code's cost from the drawing's). No step is
// taken: a step's time is `find.ts`'s.
//
// Built with `popover`, `--popover <chars>` opens the host with a long
// text of that many characters in the third column (`?popover-long=`,
// cut at the table's cap), so every segment draws that column, and adds
// two segments last, each the same wheels at the same point (40 px down a
// wheel every 16 ms, `POPOVER_STEPS` each way as the text's scroll has
// room for, then back up, in round trips for about the scroll's wheels):
// `popover-none`, with none open, so the table scrolls under them; then
// `popover-open`, with a popover open on row 1's long text (through the
// host's hook) and the point its middle, so its text scrolls and the
// table doesn't, every frame laying its text out and drawing it. Without
// it, nothing is opened: the feature built and unused (the control).
// The table's cue for the hovered cell is decided once (the pointer is
// still) in either.
//
// Built with `popover` and `select` alone, `--cue built|faded|all` (with
// `--popover <chars>`) reads the cue's own frames in place of every
// segment above, the button labeled so the popover as built cues every
// cell: `built` the cue as built (the control: the same cells cued),
// `faded` its `fade()` (`?popover-fade`), `all` the three settings
// together (`?popover-fade`, `?popover-icons`, `?popover-cells=cut`,
// `?popover-fill`). An active cell on row `CUE_ACTIVE_ROW`'s long text (a
// press) and the pointer over another row's, both cued (and faded, as
// asked: checked on the probe), then two segments: `cue-hover`, the
// pointer moved a row a move down the long text's column to the last row
// wholly in view and back (a move every `DRAG_EVERY_MS`, round trips for
// about the resize drag's moves), so every move cues, and fades, another
// cut text while the active cell's cue stands; then `cue-scroll`, the
// steady scroll from the same start: its first wheel clears the hover (the
// cells move under a still pointer) and takes the active cell out of
// view, so its frames are the setting's cost on a scroll with nothing
// cued.
//
// Built with `header-icon`, every column draws the host's icon (one a
// column, by its kind, with a fill), so the header draws a badge a
// visible column every frame, and the sideways fling brings new ones in;
// or with `--icons off` none (`?icons=off`: the control that splits the
// code's cost from the drawing's), checked at open against the layout
// probe. The pointer rests over the cells, so none is raised.
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
//          [--groups 0] [--hidden <n>] [--find <term>] [--popover <chars>]
//          [--cue built|faded|all] [--icons off] [--label <name>]
// --label writes perf/results/<date>-<label>.json. Run `just tall-table build` first.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { fling, frameIntervals, frameRecorder, frameStats, open, recordedBetween, waitMark, wheel, workBetween, workRecorder, type RecordedFrame } from '../../../shared-web/perf/harness.ts';
import { PROFILES, localDate, machineInfo, median, option, percentiles, type Profile } from '../../../shared-web/perf/protocol.ts';
import { serveApp } from '../../../shared-web/perf/serve.ts';
import { ORIGIN_MARK, Trace, WORK_CATEGORIES, frameWork, lateFrames } from '../../../shared-web/perf/trace.ts';
import { LONG_AT, popoverClosed, popoverThrough, popoverWhere, type Popover } from './harness.ts';
import { CELL_STYLES, COLUMN_ORDER_GLOBAL, GROUPS_GLOBAL, DEFAULT_DENSITY, DEFAULT_PINNED, FILLED_MARK, PORT, SHAPES, SELECT_OFFSET_PX, SORTED_COLUMN, bandAt, global, moveGripAt, selectOn, buildName, builtFeatures, cellAt, cornerAt, hostWebDir, restedWhere, perfDir, selected, shown, sortThrough, visibleColumns, type CellStyle, type Layout, type Shape, type Shown, type Sort, type GroupCell, pick } from './harness.ts';

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
const GROUPS = features.includes('group-headers');
const GROUPS_OPTION = option('groups');
if (GROUPS_OPTION !== undefined && !GROUPS) throw new Error('--groups needs the host built with group-headers: `just tall-table build group-headers`');
if (GROUPS_OPTION !== undefined && GROUPS_OPTION !== '0') throw new Error(`--groups ${GROUPS_OPTION}: only \`0\` (the control)`);
/** The header's rows at open (`group-headers`): the host's two levels and
 *  the names, or the names alone under `--groups 0`. */
const HEADER_ROWS = GROUPS_OPTION === '0' ? 1 : 3;
const HIDE = features.includes('hide');
const HIDDEN_OPTION = option('hidden');
if (HIDDEN_OPTION !== undefined && !HIDE) throw new Error('--hidden needs the host built with hide: `just tall-table build hide`');
if (HIDDEN_OPTION !== undefined && !(/^\d+$/.test(HIDDEN_OPTION) && Number(HIDDEN_OPTION) >= 2)) throw new Error(`--hidden ${HIDDEN_OPTION}: not a whole count of 2 or more (1 hides every column)`);
/** Whether the column at `index` is hidden at open (`hide`): every
 *  `--hidden`th, as the host's `?hidden=` (none without it). */
const hiddenAtOpen = (index: number) => HIDDEN_OPTION !== undefined && (index + 1) % Number(HIDDEN_OPTION) === 0;
const FIND = features.includes('find');
const FIND_OPTION = option('find');
if (FIND_OPTION !== undefined && !FIND) throw new Error('--find needs the host built with find: `just tall-table build find`');
if (FIND_OPTION !== undefined && !FIND_OPTION) throw new Error('--find: an empty term is no find (leave it out for the control)');
const POPOVER = features.includes('popover');
const POPOVER_OPTION = option('popover');
if (POPOVER_OPTION !== undefined && !POPOVER) throw new Error('--popover needs the host built with popover: `just tall-table build popover`');
if (POPOVER_OPTION !== undefined && !(/^\d+$/.test(POPOVER_OPTION) && Number(POPOVER_OPTION) > 0)) throw new Error(`--popover ${POPOVER_OPTION}: not a positive count of characters`);
const CUE_OPTION = option('cue') as 'built' | 'faded' | 'all' | undefined;
if (CUE_OPTION !== undefined && !['built', 'faded', 'all'].includes(CUE_OPTION)) throw new Error(`--cue ${CUE_OPTION}: not one of built, faded, all`);
if (CUE_OPTION !== undefined && [...features].sort().join(',') !== 'popover,select') throw new Error('--cue needs the host built with popover and select alone: `just tall-table build popover,select`');
if (CUE_OPTION !== undefined && POPOVER_OPTION === undefined) throw new Error('--cue needs --popover <chars>: the long text its cells cut');
const ICONS = features.includes('header-icon');
const ICONS_OPTION = option('icons');
if (ICONS_OPTION !== undefined && !ICONS) throw new Error('--icons needs the host built with header-icon: `just tall-table build header-icon`');
if (ICONS_OPTION !== undefined && ICONS_OPTION !== 'off') throw new Error(`--icons ${ICONS_OPTION}: only \`off\` (the control)`);
console.log(`build: ${BUILD}${CELLS ? `, cells: ${CELLS}` : ''}${PIN ? `, pin: ${PIN_OPTION ?? 'default'}` : ''}${DENSITY ? `, density: ${DENSITY_OPTION ?? 'default'}` : ''}${FORMAT ? `, format: ${FORMAT_OPTION ?? 'on'}` : ''}${REORDER ? `, order: ${ORDER_OPTION ?? 'own'}` : ''}${GROUPS ? `, groups: ${GROUPS_OPTION ?? 'default'}` : ''}${HIDE ? `, hidden: ${HIDDEN_OPTION ? `1 column in ${HIDDEN_OPTION}` : 'none'}` : ''}${FIND ? `, find: ${FIND_OPTION === undefined ? 'none' : JSON.stringify(FIND_OPTION)}` : ''}${POPOVER ? `, popover: ${POPOVER_OPTION === undefined ? 'none opened' : `${POPOVER_OPTION} characters`}` : ''}${CUE_OPTION ? `, cue: ${CUE_OPTION}` : ''}${ICONS ? `, icons: ${ICONS_OPTION ?? 'on'}` : ''}`);
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
/** The popover segments' wheels: this many px, every `SCROLL_EVERY_MS`,
 *  at most `POPOVER_STEPS` each way (fewer if its text has less room), in
 *  round trips for about `SCROLL_STEPS` wheels. */
const POPOVER_WHEEL_PX = 40;
const POPOVER_STEPS = 60;
/** The popover's text must scroll at least this many wheels each way. */
const MIN_POPOVER_STEPS = 10;
/** The cue segments (`--cue`): the button's label, the active cell's row,
 *  and the row the pointer starts over. */
const CUE_LABEL = 'Open row';
const CUE_ACTIVE_ROW = 2;
const CUE_HOVER_ROW = 4;

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

type Segment = 'scroll' | 'fling' | 'hfling' | 'scroll-sorted' | 'fling-sorted' | 'hfling-sorted' | 'resize' | 'select' | 'reorder' | 'reorder-group' | 'popover-none' | 'popover-open' | 'cue-hover' | 'cue-scroll';
const SEGMENTS: Segment[] = ['scroll', 'fling', 'hfling', 'scroll-sorted', 'fling-sorted', 'hfling-sorted', 'resize', 'select', 'reorder', 'reorder-group', 'popover-none', 'popover-open', 'cue-hover', 'cue-scroll'];
/** The popover segments' wheels in each shape, as its first run laid them
 *  out (the text's room set them); a later run laying them out otherwise
 *  fails. */
type PopoverWheels = { stepsEachWay: number; trips: number; chars: number; cut: boolean };
const popoverWheels: Partial<Record<Shape, PopoverWheels>> = {};
/** The cue's hover moves in each shape, as its first run laid them out. */
type CueMoves = { rowsEachWay: number; trips: number; moves: number };
const cueMoves: Partial<Record<Shape, CueMoves>> = {};
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

/** With `--popover`: the same wheels at the same point with no popover
 *  open (the table scrolls) and with one open on row 1's long text (its
 *  text scrolls), each traced on its own (the header's comment). */
async function popoverSegments(browser: Browser, page: Page, layout: Layout, shape: Shape, readings: Partial<Record<Segment, Reading>>, failures: string[]): Promise<void> {
  await home(page, layout, false);
  const row = 1;
  const place = layout.columns.findIndex((column, at) => (column.index ?? at) === LONG_AT);
  if (place < 0 || layout.columns[place]!.kind !== 'text') throw new Error(`no long text's column at index ${LONG_AT}: ${JSON.stringify(layout.columns.slice(0, 4).map((column) => column.name))}`);
  const opened = await popoverThrough(page, row, LONG_AT);
  const [x, y, width, height] = opened.bounds;
  const room = opened.contentHeight - height;
  const stepsEachWay = Math.min(POPOVER_STEPS, Math.floor(room / POPOVER_WHEEL_PX));
  if (stepsEachWay < MIN_POPOVER_STEPS) throw new Error(`the popover's text scrolls ${room.toFixed(0)} px, under ${MIN_POPOVER_STEPS} wheels of ${POPOVER_WHEEL_PX}: is --popover long enough?`);
  const trips = Math.max(1, Math.round(SCROLL_STEPS / (2 * stepsEachWay)));
  const laid: PopoverWheels = { stepsEachWay, trips, chars: opened.chars, cut: opened.cut };
  if (!popoverWheels[shape]) console.log(`  ${shape}: the popover's text ${opened.chars} characters${opened.cut ? ', cut' : ''}, ${opened.contentHeight.toFixed(0)} px in ${height.toFixed(0)}: ${stepsEachWay} wheels each way, ${trips} round trips`);
  const recorded = (popoverWheels[shape] ??= laid);
  if (JSON.stringify(recorded) !== JSON.stringify(laid)) failures.push(`the popover's wheels laid out ${JSON.stringify(laid)}, not ${JSON.stringify(recorded)} as the first run did`);
  const at = { x: x + width / 2, y: y + height / 2 };
  /** Down and back up, `trips` times, on a fixed schedule (the scroll's). */
  const wheels = async () => {
    const sent: Promise<void>[] = [];
    for (let trip = 0; trip < trips; trip++) {
      for (let step = 0; step < 2 * stepsEachWay; step++) {
        sent.push(wheel(page, step < stepsEachWay ? POPOVER_WHEEL_PX : -POPOVER_WHEEL_PX));
        await page.waitForTimeout(SCROLL_EVERY_MS);
      }
    }
    await Promise.all(sent);
  };
  await popoverClosed(page);
  await page.mouse.move(at.x, at.y);
  const none = (readings['popover-none'] = await traced(browser, page, layout, async () => {
    await wheels();
    return (await rest(page, 's.first === 0')) !== null;
  }));
  if (none.recorder.frames < MIN_DRAG_FRAMES) failures.push(`the popover-none wheels drew ${none.recorder.frames} frames: did the table scroll?`);
  await home(page, layout, false);
  const again = await popoverThrough(page, row, LONG_AT);
  if (again.bounds.some((value, index) => Math.abs(value - opened.bounds[index]!) > 0.5)) throw new Error(`the popover opened again at ${JSON.stringify(again.bounds)}, not ${JSON.stringify(opened.bounds)}`);
  const open = (readings['popover-open'] = await traced(browser, page, layout, async () => {
    await wheels();
    return (await rest(page, 's.first === 0 && s.top === 0 && s.popover && s.popover.scroll === 0')) !== null;
  }));
  if (open.recorder.frames < MIN_DRAG_FRAMES) failures.push(`the popover-open wheels drew ${open.recorder.frames} frames: did its text scroll?`);
  // Still open on its cell, the table where it was.
  const after: Popover | null = await popoverWhere(page, 'true');
  if (!after || after.cell.row !== row || after.cell.column !== LONG_AT) failures.push(`the popover-open wheels left ${JSON.stringify(after?.cell ?? null)} open, not (${row}, ${LONG_AT})`);
  await popoverClosed(page);
}

/** With `--cue`: an active cell and a hovered one on the long text's
 *  column, both cued as asked, then the pointer moved a row a move down
 *  that column and back (`cue-hover`), and the steady scroll from the same
 *  start (`cue-scroll`), each traced on its own (the header's comment). */
async function cueSegments(browser: Browser, page: Page, layout: Layout, shape: Shape, readings: Partial<Record<Segment, Reading>>, failures: string[]): Promise<void> {
  const place = layout.columns.findIndex((column, at) => (column.index ?? at) === LONG_AT);
  if (place < 0 || layout.columns[place]!.kind !== 'text') throw new Error(`no long text's column at index ${LONG_AT}: ${JSON.stringify(layout.columns.slice(0, 4).map((column) => column.name))}`);
  const faded = CUE_OPTION !== 'built';
  /** The probe's cue once it's on `row`'s long text, faded as asked and
   *  not the open mark; a failure otherwise. */
  const cued = async (what: string, row: number): Promise<void> => {
    await page
      .waitForFunction(({ row, column, faded }) => {
        const cue = (globalThis as { __tallTable?: Shown }).__tallTable?.cue;
        return Boolean(cue && cue.cell.row === row && cue.cell.column === column && cue.faded === faded && !cue.open);
      }, { row, column: LONG_AT, faded }, { timeout: 5_000, polling: 10 })
      .catch(async () => failures.push(`${what}: the cue ${JSON.stringify((await shown(page)).shown.cue ?? null)}, not on (${row}, ${LONG_AT}) ${faded ? 'faded' : 'unfaded'}`));
  };
  /** From the top: the active cell pressed, then the pointer over
   *  `CUE_HOVER_ROW`'s long text, its cue the probe's. */
  const setUp = async (what: string): Promise<Shown> => {
    await home(page, layout, false);
    const view = (await shown(page)).shown;
    const active = cellAt(layout, view, CUE_ACTIVE_ROW, place);
    await page.mouse.click(active.x, active.y);
    await selected(page, { kind: 'cells', anchor: [CUE_ACTIVE_ROW, place], head: [CUE_ACTIVE_ROW, place] });
    // The active cell's cue, the pointer still on it, then the hovered one's.
    await cued(`${what}, the active cell`, CUE_ACTIVE_ROW);
    const hovered = cellAt(layout, view, CUE_HOVER_ROW, place);
    await page.mouse.move(hovered.x, hovered.y);
    await cued(`${what}, the hovered cell`, CUE_HOVER_ROW);
    return view;
  };

  const view = await setUp('cue-hover');
  const span = view.end - 3 - CUE_HOVER_ROW;
  if (span < 1) throw new Error(`the cue's hover needs 2 rows wholly in view past row ${CUE_HOVER_ROW}: rows ${view.first}–${view.end}`);
  const trips = Math.max(1, Math.round((DRAG_TRIPS * DRAG_MOVES) / span));
  const moves = trips * 2 * span;
  const laid: CueMoves = { rowsEachWay: span, trips, moves };
  const recorded = (cueMoves[shape] ??= laid);
  if (JSON.stringify(recorded) !== JSON.stringify(laid)) failures.push(`the cue's hover laid out ${JSON.stringify(laid)}, not ${JSON.stringify(recorded)} as the first run did`);
  const hover = (readings['cue-hover'] = await traced(browser, page, layout, async () => {
    // On a fixed schedule, as the drags' moves.
    const sent: Promise<void>[] = [];
    for (let step = 1; step <= moves; step++) {
      const phase = step % (2 * span);
      const to = cellAt(layout, view, CUE_HOVER_ROW + (phase <= span ? phase : 2 * span - phase), place);
      sent.push(page.mouse.move(to.x, to.y));
      await page.waitForTimeout(DRAG_EVERY_MS);
    }
    await Promise.all(sent);
  }));
  // Back on the row it started over, cued as asked, the active cell kept.
  await cued('after the cue-hover moves', CUE_HOVER_ROW);
  await selected(page, { kind: 'cells', anchor: [CUE_ACTIVE_ROW, place], head: [CUE_ACTIVE_ROW, place] }).catch(() => failures.push("the cue's hover moves changed the selection"));
  if (hover.recorder.frames < MIN_DRAG_FRAMES) failures.push(`the cue's hover drew ${hover.recorder.frames} frames for ${moves} moves: did the cue follow the pointer?`);

  await setUp('cue-scroll');
  readings['cue-scroll'] = await traced(browser, page, layout, async () => {
    const sent: Promise<void>[] = [];
    for (let step = 0; step < SCROLL_STEPS; step++) {
      sent.push(wheel(page, SCROLL_PX));
      await page.waitForTimeout(SCROLL_EVERY_MS);
    }
    await Promise.all(sent);
    return (await rest(page, 'true')) !== null;
  });
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
    if (GROUPS_OPTION !== undefined) params.groups = GROUPS_OPTION;
    if (HIDDEN_OPTION !== undefined) params.hidden = HIDDEN_OPTION;
    if (FIND_OPTION !== undefined) params.find = FIND_OPTION;
    if (POPOVER_OPTION !== undefined) params['popover-long'] = POPOVER_OPTION;
    if (CUE_OPTION !== undefined) params.popover = CUE_LABEL;
    if (CUE_OPTION === 'faded' || CUE_OPTION === 'all') params['popover-fade'] = '';
    if (CUE_OPTION === 'all') Object.assign(params, { 'popover-icons': '', 'popover-cells': 'cut', 'popover-fill': '' });
    if (ICONS_OPTION !== undefined) params.icons = ICONS_OPTION;
    session = await open(chromium, url, { profile, params, init: [workRecorder, frameRecorder] });
    const { page } = session;
    const browser = session.context.browser()!;
    await waitMark(page, FILLED_MARK);
    const { shown: start, layout } = await shown(page);
    // The run in effect, at 1440 wide: every count here within the half.
    if (PIN && layout.pinned !== pinned(shape)) throw new Error(`${layout.pinned} columns pinned at open, not ${pinned(shape)}`);
    if (DENSITY && layout.rowHeight !== densityRow) throw new Error(`rows ${layout.rowHeight} px at open, not ${densityRow}`);
    if (GROUPS && layout.headerRows !== HEADER_ROWS) throw new Error(`the header ${layout.headerRows} rows tall at open, not ${HEADER_ROWS}`);
    const order = layout.columns.map((column, place) => column.index ?? place);
    if (HIDE) {
      const wrong = layout.columns.findIndex((column, place) => Boolean(column.hidden) !== hiddenAtOpen(order[place]!) || (column.hidden ? column.width !== 0 : column.width === 0));
      if (wrong >= 0) throw new Error(`column ${order[wrong]} ${layout.columns[wrong]!.hidden ? 'hidden' : 'shown'} at open, width ${layout.columns[wrong]!.width}, not ${hiddenAtOpen(order[wrong]!) ? 'hidden' : 'shown'} (--hidden ${HIDDEN_OPTION ?? 'unset'})`);
    }
    if (ICONS) {
      // Every shown column's badge on the layout, or none (`--icons off`).
      const wrong = layout.columns.findIndex((column) => !column.hidden && Boolean(column.icon) !== (ICONS_OPTION !== 'off'));
      if (wrong >= 0) throw new Error(`column ${order[wrong]} ${layout.columns[wrong]!.icon ? 'has' : 'has no'} icon at open (--icons ${ICONS_OPTION ?? 'unset'})`);
    }
    if (FIND && (start.find?.term ?? null) !== (FIND_OPTION ?? null)) throw new Error(`the term ${JSON.stringify(start.find?.term)} at open, not ${JSON.stringify(FIND_OPTION ?? null)}`);
    if (REORDER && JSON.stringify(order) !== JSON.stringify(ORDER_OPTION === 'reverse' ? order.map((_, place) => order.length - 1 - place) : order.map((_, place) => place))) throw new Error(`the columns at open in the order ${JSON.stringify(order.slice(0, 12))}…, not ${ORDER_OPTION ?? "the list's own"}`);
    // Over the cells, clear of the scrollbar.
    await page.mouse.move(layout.left + 300, layout.top + 300);
    if (SELECT && !CUE_OPTION) await selectAll(page, layout);
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

    if (!CUE_OPTION) await scrollAndFlings('');
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
    if (SELECT && !CUE_OPTION) {
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
      /** Right `MOVE_PX` and back from `from`, `DRAG_TRIPS` times, on a
       *  fixed schedule (the resize drag's), released where it was pressed,
       *  beside the block: a failure if anything moved or next to nothing
       *  drew. */
      const drag = async (segment: 'reorder' | 'reorder-group', from: { x: number; y: number }) => {
        await page.mouse.move(from.x, from.y);
        await page.mouse.down();
        const reading = (readings[segment] = await traced(browser, page, layout, async () => {
          const sent: Promise<void>[] = [];
          for (let trip = 0; trip < DRAG_TRIPS; trip++) {
            for (let step = 1; step <= 2 * DRAG_MOVES; step++) {
              const out = step <= DRAG_MOVES ? step : 2 * DRAG_MOVES - step;
              sent.push(page.mouse.move(from.x + (MOVE_PX * out) / DRAG_MOVES, from.y));
              await page.waitForTimeout(DRAG_EVERY_MS);
            }
          }
          await Promise.all(sent);
          await page.mouse.up();
        }));
        const after = (await shown(page)).layout.columns.map((column, at) => column.index ?? at);
        const published = await global<number[]>(page, COLUMN_ORDER_GLOBAL);
        if (JSON.stringify(after) !== JSON.stringify(order) || (published && JSON.stringify(published) !== JSON.stringify(order))) failures.push(`the ${segment} drag's release moved the columns (${JSON.stringify(after.slice(0, 12))}…)`);
        if (reading.recorder.frames < MIN_DRAG_FRAMES) failures.push(`the ${segment} drag drew ${reading.recorder.frames} frames for ${DRAG_TRIPS * 2 * DRAG_MOVES} moves: did it press the header?`);
      };
      await drag('reorder', grip);

      // With the host's groups: the inner group holding that column, lifted
      // by its cell (with `select`, the press selects its columns, so their
      // tint moves with it), nothing selected before.
      if (GROUPS && GROUPS_OPTION === undefined) {
        await home(page, layout, false);
        const cells = (await global<GroupCell[]>(page, GROUPS_GLOBAL)) ?? [];
        const group = cells.find((cell) => cell.level === HEADER_ROWS - 2 && cell.start <= place && place < cell.end);
        if (!group) throw new Error(`no inner group cell holds place ${place}: ${JSON.stringify(cells.slice(0, 6))}`);
        const y = layout.top - layout.rowHeight * (HEADER_ROWS - group.level) + layout.rowHeight / 2;
        await drag('reorder-group', { x: layout.left + group.left + Math.min(12, group.width / 4), y });
        if (selectOn(features)) await selected(page, { kind: 'columns', anchor: [0, group.start], head: [0, group.end - 1] }).catch(() => failures.push(`the reorder-group drag left a selection other than ${group.label}'s columns`));
      }
    }
    // Last, so every other segment runs as in a build without it.
    if (CUE_OPTION) await cueSegments(browser, page, layout, shape, readings, failures);
    else if (POPOVER_OPTION !== undefined) await popoverSegments(browser, page, layout, shape, readings, failures);
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
  // A `--cue` run is the cue's segments alone (its `cue-scroll` is the
  // steady scroll's wheels): no fling, no select-all or select drag, no
  // wheels over the popover, so none of those is recorded as run.
  const protocol = { browser: 'chromium headless=new', viewport: '1440x900', dpr: 2, runs: RUNS, cold: true, scroll: { px: SCROLL_PX, everyMs: SCROLL_EVERY_MS, steps: SCROLL_STEPS }, ...(CUE_OPTION ? {} : { flingMs: FLING_MS }), ...(RESIZE ? { resizeDrag: { px: DRAG_PX, trips: DRAG_TRIPS, movesEachWay: DRAG_MOVES, everyMs: DRAG_EVERY_MS } } : {}), ...(SELECT && !CUE_OPTION ? { selectAllStanding: true, selectDrag: { ...selectDrags, everyMs: DRAG_EVERY_MS } } : {}), ...(SORT ? { sorted: SORTED } : {}), ...(PIN ? { pinned: Object.fromEntries(shapes.map((shape) => [shape, pinned(shape)])) } : {}), ...(DENSITY ? { density: DENSITY_OPTION ?? `${DEFAULT_DENSITY.row},${DEFAULT_DENSITY.text},${DEFAULT_DENSITY.width}` } : {}), ...(FORMAT ? { format: FORMAT_OPTION ?? 'on' } : {}), ...(REORDER ? { order: ORDER_OPTION ?? 'own', reorderDrag: { px: MOVE_PX, trips: DRAG_TRIPS, movesEachWay: DRAG_MOVES, everyMs: DRAG_EVERY_MS } } : {}), ...(GROUPS ? { groups: GROUPS_OPTION ?? 'default', headerRows: HEADER_ROWS } : {}), ...(HIDE ? { hiddenEvery: HIDDEN_OPTION === undefined ? null : Number(HIDDEN_OPTION) } : {}), ...(FIND ? { find: FIND_OPTION ?? null } : {}), ...(POPOVER ? { popoverLong: POPOVER_OPTION === undefined ? null : Number(POPOVER_OPTION), ...(POPOVER_OPTION === undefined || CUE_OPTION ? {} : { popoverWheels: { ...popoverWheels, px: POPOVER_WHEEL_PX, everyMs: SCROLL_EVERY_MS } }) } : {}), ...(CUE_OPTION ? { cue: CUE_OPTION, cueLabel: CUE_LABEL, cueActiveRow: CUE_ACTIVE_ROW, cueHover: { ...cueMoves, fromRow: CUE_HOVER_ROW, everyMs: DRAG_EVERY_MS } } : {}), ...(ICONS ? { icons: ICONS_OPTION ?? 'on' } : {}), restSliceMs: REST_SLICE_MS, tailMs: TAIL_MS, build: BUILD, cells: CELLS ?? null };
  writeFileSync(out, `${JSON.stringify({ date, label, ...machineInfo(), protocol, results, failures }, null, 2)}\n`);
  console.log(`wrote ${out}`);
}
if (failures.length) {
  console.error(`FAIL\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
