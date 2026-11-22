// The bare host on its release build, in each browser: in both shapes, it
// draws its first frame, fills, scrolls down by wheel (and sideways in the
// wide shape), fills again there, and reports no page errors. In every
// build, in both shapes, it replaces the rows (`__tallTableReplace`: the
// source cut to every other row and `replace_rows` called in one update)
// at the top, a row, a row past the new last top, and the end: the view
// filled at its target, and the last row's first cell the one the whole
// source draws at twice its row (the whole source replaced back there),
// with `custom-cells`, `sort`, `format`, or `reorder` (which publish the
// drawn cells) every cell of the rows both views draw, the strided top
// differing from the whole one's; built with `sort`, a
// column sorted first, the sort kept and the strided top in its order. Built with
// `custom-cells`, it does so again at each painted style (`?cells=heat`,
// `bars`, `color`), and checks the drawn cells carry their paint and, with
// heat, that a fill is on screen in the color the table says it drew. Built
// with `live`, it runs the narrow shape again with the feed on
// (`?live=1000`): re-read rows draw, and the refreshed mark lands right
// after a presented frame (shared-web/perf/'s `presentedMark`). Built with
// both, the drawn cells' text changes under the feed, and once more with
// `?flash`, flashes are drawn. Built with `follow`, it runs the narrow shape
// with the tail feed (`?rows=1000&append=1000&follow`): the tail mark
// advances right after presented frames with no placeholder row drawn, a
// wheel up lets go and the view stays put while rows arrive, and End
// follows again. Built with `resize`, it runs both shapes again and
// resizes: a float column's edge dragged wider (the width follows the
// pointer, the float budget grows, the columns right of it move, and the
// widths are published once, at the release), a double-click fitting
// another, and at the right end a drag narrowing a column (the sideways
// scroll held while the button is down, a vertical wheel then scrolling
// without moving it, and clamped at the release). Built with `select`, it
// runs both shapes again and selects: a cell press, a Shift+press block
// (the tint on screen), a drag across columns and rows, a row's number and
// Shift+End over every row, Home, a header, Cmd+A (the tint again), and
// Escape (the cell as it was), the published selection and the probe's
// agreeing after each. Built with `copy`, it runs both shapes again and
// copies, each read back through a real paste (a textarea's Cmd+V) and
// compared with the host's source: a cell (its value alone), a block, a
// Shift+press block over every visible row and column, and a `Rows` range
// past the loaded pages; in the narrow shape, a select-all's Cmd+C declined
// with nothing read, then the host's confirmed copy (Cmd+Shift+C) refused at
// the cap, the clipboard as it was each time. Then, in the narrow shape with
// each read held (`?delay`): a copy that takes past 5 s, Escape during one
// (the selection kept) and closing the table during one (each leaving the
// clipboard as it was), a copy that takes about a minute, and one that
// finishes with another tab in front; and at the machine's LAN address
// over `http` (an insecure context, no clipboard), the refusal published
// and no read sent. Built with `sort`, it runs both shapes again, with the
// glyphs and with gpui-kit's icons (`?sort-icons`), and sorts by clicks:
// each column's arrow through its cycle (the narrow shape's `class`, a text
// column, then `diameter`, a float column mostly NULL; the wide shape's
// first), the published order and the probe's agreeing, the arrow's box on
// screen different in each state (dim, hovered, each direction) and dim
// again at off, and after each click the drawn cells at the top checked
// against the host's exact values and its own rows: in order, ties by the
// source's row, NULLs last (a value at the top, and NULLs at the end of
// `diameter`), and back at off the values the top held before any sort;
// with `select`, a press beside the arrow still selects the column, and
// the arrow's selects nothing. And once opened sorted (`?sort=` with `H`
// descending), the order at the first filled frame. Built with `pin`, it
// runs both shapes again with the shape's columns pinned (the host's
// default): the screen left and right of the run's edge at the sideways
// scroll's 0 and after a sideways wheel, against the same view with
// nothing pinned (the host's hook): the pinned columns' pixels unchanged by
// the scroll, the scrolled ones moved and drawn as unpinned (so each is
// where the layout probe puts it), and the edge line drawn only while a
// column is pinned; the horizontal thumb, its track from the edge, dragged
// half its travel and its track pressed, the scroll landing at the
// fraction under the pointer; a viewport narrowed past the half pinning
// one fewer (the published count and the probe's) and widened pinning it
// again; with `select`, a press on a pinned cell and on a scrolled one
// selecting each; with `resize`, the last pinned column's band dragged
// wider, the edge moving with it. The other runs keep the host's default
// pin. Built with `density`, every run is at the host's default density
// (18 px rows, 11 px text, 56 px floats), so each feature's checks above
// (a press, a band, an arrow, the pin's edge) run at it; and it runs both
// shapes twice more. At the default: the layout probe's row and float
// widths are what was set; the rows' stripes and borders drawn at its row;
// the text's ink inside its row and each cell's padding (so the cells'
// lefts are the probe's); and, scrolled down, the hook's `set_density` to
// 30 px rows and 14 px text (the floats keep their set width) and back,
// keeping the top row. At `?density=30,14`
// (the control), on a build with `density` alone: the first screen the same, pixel for pixel, as the
// base build's, which a smoke run of the base build saves
// (`perf/results/raw/smoke-base/`, gitignored), each beside the commit and
// the source changes it was drawn from: a screen from another tree is
// refused. With `density`, `resize`'s
// checks take the host's set float widths as the columns' at open and the
// least width at the text, and `pin`'s narrow the viewport first where the
// columns all fit, for a sideways scroll. Built with `format`, its formatter is
// first checked against `fixtures/cells.json`'s `format` cases (their text
// and fit), then it runs both shapes twice more, the cells probed (at
// `?density=30,14` with `density`: the advances are the base's 14 px). With
// the host's formats: each drawn float cell (and the narrow shape's
// `spkid`) is its formatted text if that text's advances (the host's,
// GPUI's own on the web) fit the content box less a pixel, else the
// automatic format, against the source's exact values, at the first screen
// and after a wheel down, cells at 2 and 3 decimals among them; with
// `resize`, a float column narrowed to 56 px, its cells checked again and
// some falling back. At `?format=off` (the control): no cell formatted,
// and on a build with `format` alone, the first screen the same, pixel for
// pixel, as the base build's. Built with `clicks`, it runs both shapes
// again (the narrow one widened for room past the last column), each
// press checked against the published click (`__tallTableClick`: its
// kind, its target's row and place by the layout probe, the pointer, the
// modifiers): on a cell, a row's number, a header, the corner, and in the
// narrow shape a blank in the body and the header, a press, a double
// press, the same press again apart (reported again), and a right press,
// each `contextmenu` prevented; Ctrl+click a `Press` with Ctrl, then with
// the host's hook (`set_ctrl_press_is_context`) a `Context`, each
// `pointerdown` button 0 with Ctrl (`.claude/rules/gpui-web.md` rests on
// it) and the `contextmenu`s recorded; a right press during a left
// drag sent as no `pointerdown` (so GPUI never sees it), nothing
// reported, and, with `select`, the drag
// selecting its range; with `select`, a right press inside a block
// keeping it and outside selecting its cell; in Chromium, a long press
// by touch (CDP's touch events) a `Context`, its tap dropped. Built with
// `group-headers`, every run is at the host's default groups (two levels;
// the reorder runs at `?groups=0`, since a drag is held to its group), and
// it runs both shapes again: the header's rows, and the group cells
// published (`__tallTableGroups`) against the runs of the columns' paths
// cut to the view, and on screen (each closed cell's right border and its
// label's ink where the probe puts them, no ink elsewhere but `pin`'s
// edge), at open (with `pin`, the host's run splitting the first groups)
// and scrolled sideways; with `clicks`, a press on each half of a split
// run published as a `group` with the whole run's level and places; then
// with nothing pinned, a press on the second inner group (with `select`,
// its columns selected, and a Shift+press on the first outer group
// extending to its far edge), and with `reorder` its drag before the
// first inner group: the order, the cells drawn from the source, the
// groups drawn whole, and with `select` the selection moved with it.
// Built with `hide`, it runs both shapes again and hides columns through
// the host's hook (with `pin`, the narrow shape's run's last and the wide
// shape's whole run among them): each laid out at width 0 at the right
// edge of the place before, the rest at their widths, the pin's count by
// place and its edge moved left; each column in view both ways drawn as at
// open at its new x; with the drawn cells published, none at a hidden place
// and (with `copy` or `sort`) each the source's, at the top and after a
// wheel down; shown again there, the layout as at open and the cells the
// source's; and back at the top, the screen as at open.
// Built with `find`, it runs both shapes again and finds (`12`, through
// the host's hook, the cells probed): every drawn cell marked exactly when
// its exact text holds the term (lowercased, NULL never); on screen, against
// the same view with no term, nothing drawn otherwise in an unmarked cell, a
// cell marked whole tinted across its box, and a cell's ranges tinted inside
// it, with `format` (its advances) each tint's edges where the drawn text's
// advances put the range's ends; then a step back from the top (round to the
// last row's last match: wrapped, the view moved down, and in the wide
// shape sideways), a step on (round to the first match: wrapped, its row
// at the top), and a step on again (a row in view: no scroll), each match
// fully in view, the probe's current match it, and its drawn cell marked
// current.
// Built with `popover`, it runs both shapes again with its button labeled
// and a long text in the third column (`?popover=`, `?popover-long=`): the
// cue drawn on the hovered cell, its press opening the popover there (not
// selecting), below the cell with its left edge's, within its width and
// height caps; a wheel over it scrolling its text and not the table; a
// drag along its first line and Cmd+C pasting a part of its text (before
// `copy`'s key, with it built); its button's press published with its
// cell, closing it; opened at the window's bottom (the host's hook),
// flipped above; Escape and a press outside closing it (with `select`,
// the press selecting its cell); and with `select`, Enter on the active
// cell opening it and Enter again pressing its button. Then both shapes
// with its three settings (`?popover-cells=cut`, `?popover-fade`,
// `?popover-icons`, `?popover-fill`), over a striped row, and with
// `custom-cells` again over a fill (`?cells=heat`, the long text's cells
// filled): no cue on a number's cell; on a cut text's, the cue at the
// cell's far right, the probe's `faded`, and on screen, against the cell
// at rest, the text's start as it was, its ink falling off across the
// ramp to next to none short of the mark, and the row's background (or
// the fill) as it was above the text; the mark's press opening the
// popover, the mark then another (the open one), kept with the pointer
// elsewhere, its press closing it; the button's row the popover's width,
// flush with its bottom; and with `select`, Enter on a cut text opening
// it and on a number's cell opening nothing, the browser left its key
// (GPUI cancels only a key something handled).
// Built with `header-icon`, every run draws the host's icons (one a
// column, by its kind, with a fill), so each feature's header presses
// above land clear of them; and it runs both shapes again: every column's
// badge on the layout; a number column's badge on screen (the screen
// against the same header with its icon cleared through the host's hook)
// where the layout puts it, and the screen as it was with the icon set
// again; the pointer over it drawing the raised look, past the badge on
// every side, the next icon's header unchanged, and the cursor the
// pointer; nothing published at its press, and at its release the press
// (`__tallTableIconPress`): its column by index, its bounds over the drawn
// badge within 0.75 px; a press on the raised look's ring, outside the
// badge, the icon's too; a press released off the icon nothing; none of
// them selecting (`select`), sorting (`sort`), or reported (`clicks`); a
// right press no icon press, and with `clicks` its header's context
// press; and the pointer away, the screen as at rest.
// Chromium is granted
// `clipboard-read` and
// `clipboard-write` (a real Chrome grants a focused page the write);
// WebKit on macOS writes the system pasteboard, so the run overwrites
// what was copied there.
// Headless, so it stands in for the scripted half of a manual check; how it
// looks is still a manual check. WebKit and Firefox at DPR 1, Chromium at
// DPR 2 (shared-web/perf/'s `open`).
//
// With `--screens save`, it runs only the reference screens
// (`referenceScreens`) and keeps them under this tree's commit; with
// `--screens <commit>`, it compares them with that commit's.
//
// Usage: node components/tall-table/perf/smoke.ts [--browsers chromium,firefox,webkit] [--screens save|<commit>]
// Run `just tall-table build [features]` first (with `density` or `format`,
// a smoke run of the base build first, in the same browsers, for its
// screens).

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, firefox, webkit, type BrowserType, type Page } from 'playwright';
import { firstDrawProbe, open, presentedMark, presentingTaskRecorder, waitMark, wheel, workRecorder, type FirstDrawProbe } from '../../../shared-web/perf/harness.ts';
import { option } from '../../../shared-web/perf/protocol.ts';
import { serveApp } from '../../../shared-web/perf/serve.ts';
import { ICON_CLEAR_PX, iconEnd, differingBox, iconPressAfter, iconPressCount, iconThrough, type IconPress, GROUPS_GLOBAL, HOST_GROUPS, groupCellsOf, groupRuns, groupsAs, hostPath, type GroupCell, clickAfter, clickCount, ctrlContext, type Click, COLUMN_ORDER_GLOBAL, SELECT_OFFSET_PX, gapAfterX, selectOn, moveGripAt, movedOrder, orderThrough, orderedAs, sortThrough, advances, advancesWidth, formatNumber, hostFormat, type NumberFormat, DEFAULT_DENSITY, DEFAULT_PINNED, FILLED_MARK, densityThrough, followingIs, letGo, inkIn, leastAt, paddingAt, perfDir, repo, restedWhere, runsOf, PINNED_GLOBAL, FIRST_FRAME_MARK, FOLLOWING_GLOBAL, PORT, READS_SENT_GLOBAL, REFRESHED_GLOBAL, REFRESHED_MARK, SELECTION_GLOBAL, TAIL_MARK, SHAPES, SORTED_COLUMN, WIDTHS_GLOBAL, arrowAt, bandAt, buildName, builtFeatures, builtFrom, drawnFrom, UNCHANGED, cellAt, copyReached, cornerAt, drawnCells, exactTexts, filledWhere, global, gutterAt, headerAt, hostWebDir, laidOutAt, lastCopyId, parseTsv, paste, differingPixels, hideThrough, findThrough, stepThrough, tintsIn, type Found, LONG_AT, POPOVER_BUTTON_GLOBAL, inkStrength, popoverClosed, popoverThrough, popoverWhere, type Popover, type PopoverPress, pinEdge, pinThrough, pinnedAs, pixel, screenLeft, screenshot, replaceThrough, selectThrough, selected, shown, sidewaysRoom, sortedAs, sourceRows, visibleColumns, type Cell, type CellStyle, type CopyState, type Layout, type Selection, type Shape, type Shown, type Sort } from './harness.ts';

/** A drawn fill's screen color may differ from the probe's by this much a
 *  channel (the browsers' own color handling). */
const FILL_STEPS = 3;

const engines: Record<string, BrowserType> = { chromium, firefox, webkit };
const painted: CellStyle[] = builtFeatures().includes('custom-cells') ? ['heat', 'bars', 'color'] : [];
/** The feed's rate in the `live` run, updates a second. */
const LIVE_RATE = 1000;
/** Refreshed marks checked against the frame they follow. */
const LIVE_MARKS = 3;
const live = builtFeatures().includes('live');
/** The tail feed in the `follow` run: rows at open, rows a second. */
const TAIL_ROWS = 1000;
const TAIL_RATE = 1000;
/** Tail marks checked against the frame they follow. */
const TAIL_MARKS = 3;
const follow = builtFeatures().includes('follow');
const resize = builtFeatures().includes('resize');
const select = builtFeatures().includes('select');
const copy = builtFeatures().includes('copy');
const sort = builtFeatures().includes('sort');
const pin = builtFeatures().includes('pin');
const density = builtFeatures().includes('density');
const format = builtFeatures().includes('format');
const reorder = builtFeatures().includes('reorder');
const clicks = builtFeatures().includes('clicks');
const groupHeaders = builtFeatures().includes('group-headers');
const hide = builtFeatures().includes('hide');
const find = builtFeatures().includes('find');
const popover = builtFeatures().includes('popover');
const headerIcon = builtFeatures().includes('header-icon');
/** The popover runs' button label and long text (`?popover=`,
 *  `?popover-long=`): under the cap, longer than the popover shows. */
const POPOVER_LABEL = 'Open row';
const POPOVER_LONG = 3_000;
/** The popover's border, outside the probe's bounds. */
const POPOVER_BORDER = 1;
/** The term each shape's find run sets: digits, which `format`'s advances
 *  measure. */
const FIND_TERM: Record<Shape, string> = { narrow: '12', wide: '12' };
/** A tint's edge may sit this far from where the advances put it: GPUI
 *  places quads in whole device pixels. */
const TINT_SLACK_PX = 1.5;
/** The reorder runs: a header dragged (and with `select` a range, with
 *  `pin` across the edge, with `copy` a block copied, with `sort` a sorted
 *  column), or opened at `?order=reverse`. */
type ReorderRun = 'drag' | 'reverse';
/** The format runs: the host's formats, or `?format=off` (the control). */
type FormatRun = 'on' | 'off';
/** The width `checkFormat` narrows a float column to (`resize`): the
 *  host's 2 decimals with a sign and two whole digits (`+15.12`, 45.8 px
 *  at Chromium's advances) need 63. */
const FORMAT_NARROW_PX = 56;
/** The base build's first screens (`density`'s control compares them). */
const BASE_SCREENS = join(perfDir, 'results/raw/smoke-base');
const baseScreen = (browser: string, shape: Shape) => join(BASE_SCREENS, `${browser}-${shape}.png`);
/** What a base screen was drawn from, written beside it (`drawnFrom`). */
const fromHere = JSON.stringify(drawnFrom());
type DensityRun = 'dense' | 'control';
/** The sort runs: by clicks with the glyphs or the host's icons, or
 *  opened sorted (`OPEN_SORT`, the narrow shape's `H` descending). */
type SortRun = 'glyphs' | 'icons' | 'opened';
const OPEN_SORT: Sort = { column: SORTED_COLUMN.narrow, direction: 'descending' };
/** The columns each shape's sort run clicks through their cycles. */
const SORT_COLUMNS: Record<string, number[]> = { narrow: [2, 6], wide: [0] };
/** The copy runs: `keys` in both shapes, unheld; the rest in the narrow
 *  shape, each read held `HELD_MS` (`MINUTE_HELD_MS` for `minute`), or
 *  (`insecure`) at the LAN address. */
type CopyRun = 'keys' | 'held' | 'minute' | 'background' | 'insecure';
/** Held reads: 2 in flight (`max_in_flight` 3, less one for the reader),
 *  so `COPY_PAGES` pages take 3 rounds: ~6 s, and ~60 s at a minute's. */
const HELD_MS = 2_000;
const MINUTE_HELD_MS = 20_000;
const COPY_PAGES = 6;
/** The first row of a page the view never loaded (pages 0–2 load at
 *  open: the visible one and prefetch's two). */
const UNLOADED_ROW = 3 * 1024;
/** Cells of a large paste compared with the source. */
const SAMPLED_CELLS = 64;
/** The resize run's drags: wider, then narrower at the right end, CSS px,
 *  in this many moves. */
const WIDEN_PX = 80;
const NARROW_PX = -80;
const DRAG_MOVES = 8;
/** Both: the cell probe shows the feed's changes, and `?flash` runs. */
const flashing = live && painted.length > 0;

/** With the feed on: the refreshed generation climbs, each of `LIVE_MARKS`
 *  refreshed marks lands right after a presented frame, in its presenting
 *  task, and the frame then shows no placeholder. */
async function checkLive(page: Page, label: string, flash: boolean): Promise<string> {
  const since = await page.evaluate(() => performance.now());
  const before = flashing ? await drawnCells(page) : [];
  const marks: string[] = [];
  let at = since;
  for (let index = 0; index < LIVE_MARKS; index++) {
    at = await waitMark(page, REFRESHED_MARK, at + 0.001, 10_000);
    const presented = await presentedMark(page, at);
    if (!presented.ok) failures.push(`${label}: refreshed mark ${index + 1}: ${presented.detail}`);
    marks.push(presented.detail);
    // Re-read rows draw in place: never a placeholder under the feed.
    const { shown: view } = await shown(page);
    if (view.pending) failures.push(`${label}: ${view.pending} placeholder rows under the feed`);
  }
  const generation = await page.evaluate((name) => (globalThis as Record<string, unknown>)[name] as number | undefined, REFRESHED_GLOBAL);
  if (!generation) failures.push(`${label}: no refreshed generation published`);
  let cells = '';
  if (flashing) {
    // The same cells, drawn again: the feed's rows read anew.
    const after = await drawnCells(page);
    const was = new Map(before.map((cell) => [`${cell.row},${cell.column}`, cell.exact]));
    const changed = after.filter((cell) => was.has(`${cell.row},${cell.column}`) && was.get(`${cell.row},${cell.column}`) !== cell.exact).length;
    if (!changed) failures.push(`${label}: no drawn cell's value changed under the feed`);
    cells = `, ${changed} drawn cells changed`;
    const flashes = after.filter((cell) => cell.flash && cell.flash[3]! > 0).length;
    if (flash && !flashes) failures.push(`${label}: no flash drawn`);
    if (!flash && flashes) failures.push(`${label}: ${flashes} flashes drawn without ?flash`);
    if (flash) cells += `, ${flashes}/${after.length} cells flashing`;
  }
  return `, refreshed to generation ${generation} (${marks[0]})${cells}`;
}

/** How long a wheel's view may take to rest before the check gives up. */
const REST_MS = 2_000;

/** What the frame before each tail mark drew: the tail global and the
 *  probe's placeholder rows. */
type TailMark = { at: number; tail: number; pending: number };

/** An init script: records `TailMark`s on `__tailMarks`, read in the
 *  microtask that sets each `tall-table:tail` mark (seiza's
 *  `mark_after_current_task`, right after the task that drew the frame,
 *  before another can draw). Its names are `TAIL_MARK` and `TAIL_GLOBAL`
 *  written out: an init script is sent as text. */
function tailRecorder(): void {
  const marks: { at: number; tail: number; pending: number }[] = [];
  const page = globalThis as unknown as Record<string, unknown>;
  page.__tailMarks = marks;
  const mark = Performance.prototype.mark;
  Performance.prototype.mark = function (this: Performance, ...args: Parameters<Performance['mark']>) {
    const entry = mark.apply(this, args);
    if (args[0] === 'tall-table:tail') {
      const shown = page.__tallTable as { pending: number } | undefined;
      marks.push({ at: entry.startTime, tail: (page.__tallTableTail as number | undefined) ?? 0, pending: shown?.pending ?? -1 });
    }
    return entry;
  };
}

/** The view follows `count` more tail marks, each right after a presented
 *  frame, the tail each one's frame drew further on than the last, and no
 *  placeholder row in those frames (`tailRecorder`). Returns the last
 *  mark's time and tail. */
async function followsTail(page: Page, label: string, since: number, count: number): Promise<{ at: number; tail: number }> {
  let at = since;
  let tail = 0;
  for (let index = 0; index < count; index++) {
    at = await waitMark(page, TAIL_MARK, at + 0.001, 10_000);
    const recorded = (await global<TailMark[]>(page, '__tailMarks'))?.find((entry) => entry.at === at);
    if (!recorded) {
      failures.push(`${label}: tail mark ${index + 1} at ${at.toFixed(1)} ms wasn't recorded`);
      continue;
    }
    if (recorded.tail <= tail) failures.push(`${label}: tail mark ${index + 1} drew the tail at ${recorded.tail}, not past ${tail}`);
    if (recorded.pending) failures.push(`${label}: tail mark ${index + 1}'s frame drew ${recorded.pending} placeholder rows`);
    tail = recorded.tail;
    const presented = await presentedMark(page, at);
    if (!presented.ok) failures.push(`${label}: tail mark ${index + 1}: ${presented.detail}`);
  }
  return { at, tail };
}

/** With the tail feed: it follows, a wheel up lets go and holds the view
 *  while rows arrive, and End follows again; then the host lets go (the
 *  table's `let_go`, through `__tallTableLetGo`), the view held where it
 *  was while rows arrive, and End follows again. */
async function checkFollow(page: Page, label: string, layout: Layout): Promise<string> {
  if ((await global<boolean>(page, FOLLOWING_GLOBAL)) !== true) failures.push(`${label}: not following at open with ?follow`);
  const first = await followsTail(page, label, 0, TAIL_MARKS);
  // A wheel up: following stops, and the view holds while rows arrive.
  await page.mouse.move(layout.left + 200, layout.top + 200);
  await wheel(page, -10 * layout.rowHeight);
  await followingIs(page, false);
  const wheeled = await holdsWhileLetGo(page, `${label}: a wheel up`);
  const back = await followsAgain(page, `${label} (End)`, wheeled.later.rows);
  // The host lets go: following stops with no move of the reader's, and
  // the view stays where it was as rows arrive.
  const before = (await shown(page)).shown;
  await letGo(page);
  const paused = await holdsWhileLetGo(page, `${label}: the host's let go`);
  // A batch may land between the read above and the call: the pin moves
  // only down, so the view is at or past where it was, and then holds.
  if (paused.held.top < before.top) failures.push(`${label}: let go moved the view up from ${before.top} to ${paused.held.top}`);
  const again = await followsAgain(page, `${label} (End after let go)`, paused.later.rows);
  return `, followed to ${first.tail}, held at ${wheeled.held.top.toFixed(1)} while ${wheeled.later.rows - wheeled.held.rows} rows arrived, followed again to ${back.tail}, let go at ${paused.held.top.toFixed(1)} while ${paused.later.rows - paused.held.rows} rows arrived, followed again to ${again.tail}`;
}

/** Once following is off: the view rests (Firefox and WebKit deliver one
 *  scripted wheel in parts, and the probe is a frame's, so the frame
 *  after a pin move may not be drawn yet), then stays where it rested for
 *  500 ms while rows arrive. Returns where it rested and the view after. */
async function holdsWhileLetGo(page: Page, what: string): Promise<{ held: Shown; later: Shown }> {
  let held = (await shown(page)).shown;
  for (let waited = 0; ; waited += 200) {
    if (waited >= REST_MS) {
      failures.push(`${what}: the view still moving ${REST_MS} ms after (top ${held.top})`);
      break;
    }
    await page.waitForTimeout(200);
    const now = (await shown(page)).shown;
    if (now.top === held.top) break;
    held = now;
  }
  await page.waitForTimeout(500);
  const later = (await shown(page)).shown;
  if (later.top !== held.top) failures.push(`${what}: the view moved from ${held.top} to ${later.top} while let go`);
  if (later.rows <= held.rows) failures.push(`${what}: no rows arrived while let go (${held.rows} → ${later.rows})`);
  return { held, later };
}

/** End: following again, the tail mark advancing past `rows`, the rows
 *  when it was pressed. */
async function followsAgain(page: Page, label: string, rows: number): Promise<{ at: number; tail: number }> {
  await page.keyboard.press('End');
  await followingIs(page, true);
  const back = await followsTail(page, label, await page.evaluate(() => performance.now()), TAIL_MARKS);
  if (back.tail <= rows - TAIL_RATE) failures.push(`${label}: after End the tail drawn ${back.tail} is behind the rows (${rows})`);
  return back;
}

/** What a widths global held at each set: an init script records them on
 *  `__widthsSets`, with the time. */
type WidthsSet = { at: number; widths: (number | null)[] };

/** Records each set of global `name` on `__widthsSets`; sent as text in
 *  an init script ([`widthsRecorder`]), so it closes over nothing. */
function recordWidths(name: string): void {
  const sets: { at: number; widths: (number | null)[] }[] = [];
  const page = globalThis as unknown as Record<string, unknown>;
  page.__widthsSets = sets;
  let held: unknown;
  Object.defineProperty(globalThis, name, {
    configurable: true,
    get: () => held,
    set: (value: (number | null)[]) => {
      held = value;
      sets.push({ at: performance.now(), widths: [...value] });
    },
  });
}

/** The init script recording `WIDTHS_GLOBAL`'s sets: `recordWidths` with
 *  the name written into its text. */
// eslint-disable-next-line no-new-func
const widthsRecorder = new Function(`(${recordWidths.toString()})(${JSON.stringify(WIDTHS_GLOBAL)})`) as () => void;

/** The widths sets so far, once there are `count`, or after 10 s, however
 *  many there are. */
async function widthsSets(page: Page, count: number): Promise<WidthsSet[]> {
  await page.waitForFunction((count) => ((globalThis as { __widthsSets?: unknown[] }).__widthsSets?.length ?? 0) >= count, count, { timeout: 10_000, polling: 10 }).catch(() => {});
  return (await global<WidthsSet[]>(page, '__widthsSets')) ?? [];
}

/** Presses column `column`'s band, moves the pointer `by` CSS px in
 *  `DRAG_MOVES` moves, and calls `held` before the release. */
async function dragBand(page: Page, layout: Layout, column: number, scrollX: number, by: number, held: () => Promise<void>): Promise<void> {
  const band = bandAt(layout, column, scrollX);
  await page.mouse.move(band.x, band.y);
  await page.mouse.down();
  for (let step = 1; step <= DRAG_MOVES; step++) await page.mouse.move(band.x + (by * step) / DRAG_MOVES, band.y);
  await held();
  await page.mouse.up();
}

/** A column's set width at open: with `density`, the host's on every float
 *  column; else none. */
const setAtOpen = (kind: string) => (density && kind === 'float' ? DEFAULT_DENSITY.width : null);

/** With `resize`: a float column dragged wider, another fitted by a
 *  double-click, and at the right end a column dragged narrower. */
async function checkResize(page: Page, label: string, start: Layout): Promise<string> {
  const near = (a: number, b: number) => Math.abs(a - b) < 0.01;
  const floats = start.columns.flatMap((column, index) => (column.kind === 'float' ? [index] : []));
  const [wide, fit] = floats as [number, number];
  const before = start.columns[wide]!;
  // Wider: no widths and no layout while the button is down.
  await dragBand(page, start, wide, 0, WIDEN_PX, async () => {
    await page.waitForTimeout(200);
    const sets = (await global<WidthsSet[]>(page, '__widthsSets'))!.length;
    if (sets) failures.push(`${label}: ${sets} widths published during the drag`);
    const layout = (await shown(page)).layout;
    if (!near(layout.columns[wide]!.width, before.width)) failures.push(`${label}: the layout reported during the drag (${layout.columns[wide]!.width})`);
  });
  const widened = await laidOutAt(page, wide, before.width + WIDEN_PX).catch(async () => {
    failures.push(`${label}: column ${wide} is ${(await shown(page)).layout.columns[wide]!.width} px after a +${WIDEN_PX} px drag from ${before.width}`);
    return null;
  });
  if (!widened) return '';
  const after = widened.columns[wide]!;
  if (after.budget <= before.budget) failures.push(`${label}: the float budget ${before.budget} → ${after.budget} after widening`);
  const next = widened.columns[wide + 1];
  if (next && !near(next.x, start.columns[wide + 1]!.x + WIDEN_PX)) failures.push(`${label}: the next column at ${next.x}, not moved ${WIDEN_PX} px`);
  // Published once, at the release: the dragged column's width, null elsewhere.
  await page.waitForTimeout(300);
  let sets = await widthsSets(page, 1);
  if (!sets.length) {
    failures.push(`${label}: no widths published at the release`);
    return '';
  }
  if (sets.length !== 1) failures.push(`${label}: ${sets.length} widths published by one drag`);
  const published = sets[0]!.widths;
  if (published.length !== start.columns.length) failures.push(`${label}: ${published.length} widths for ${start.columns.length} columns`);
  if (!near(published[wide] ?? NaN, after.width)) failures.push(`${label}: column ${wide}'s published width ${published[wide]}, drawn ${after.width}`);
  if (published.some((width, index) => index !== wide && width !== setAtOpen(start.columns[index]!.kind))) failures.push(`${label}: widths set for columns not dragged (${published.join(',')})`);

  // A double-click fits another float column, published once more.
  const fitBand = bandAt(widened, fit, 0);
  await page.mouse.dblclick(fitBand.x, fitBand.y);
  // Its width was its kind's (null), so a fit sets one, whatever its size;
  // with `density`, the host's 56 px, under any float's fit.
  sets = await widthsSets(page, 2);
  if (sets.length !== 2) {
    failures.push(`${label}: a double-click on column ${fit}'s band published ${sets.length - 1} widths, not 1`);
    return '';
  }
  const fitted = sets[1]!.widths[fit];
  const fittedLayout = typeof fitted === 'number' ? await laidOutAt(page, fit, fitted).catch(() => null) : null;
  if (typeof fitted !== 'number') failures.push(`${label}: the fit published ${fitted} for column ${fit}, no width`);
  else if (!fittedLayout) failures.push(`${label}: the fit published ${fitted} px for column ${fit}, but didn't draw it`);
  if (!near(sets[1]!.widths[wide] ?? NaN, after.width)) failures.push(`${label}: the fit changed column ${wide}'s published width`);
  const laid = fittedLayout ?? widened;

  // At the right end, narrower: the scroll holds while the button is down,
  // and is clamped at the release.
  const room = sidewaysRoom(laid);
  await page.mouse.move(laid.left + 200, laid.top + 200);
  await wheel(page, 0, room + 500);
  const end = await filledWhere(page, `s.scrollX >= ${room - 1}`);
  // The last column whose edge is in view with room left of it (with
  // `pin`, past the last pinned column's band, which reaches its 4 px half
  // right of the run's edge and takes a press there).
  const edges = laid.columns.map((column, index) => ({ index, edge: screenLeft(laid, index, end.scrollX) + column.width }));
  const clear = (laid.pinned ?? 0) > 0 ? pinEdge(laid) + 4 : 0;
  const narrow = edges.filter(({ edge }) => edge > clear && edge < laid.cellsWidth - 2).at(-1)!.index;
  const was = laid.columns[narrow]!.width;
  const width = Math.min(Math.max(was + NARROW_PX, density ? leastAt(DEFAULT_DENSITY.text) : 40), 1200);
  // A vertical wheel during the drag, over the body (the pointer moved
  // straight down: the width follows its x alone), scrolls, and clamps
  // nothing sideways.
  const band = bandAt(laid, narrow, end.scrollX);
  await dragBand(page, laid, narrow, end.scrollX, NARROW_PX, async () => {
    await page.mouse.move(band.x + NARROW_PX, laid.top + 200);
    await wheel(page, 5 * laid.rowHeight);
    const during = await filledWhere(page, `s.first >= ${end.first + 5}`).catch(() => null);
    if (!during) failures.push(`${label}: a vertical wheel during a drag didn't scroll`);
    const { shown: now } = await shown(page);
    if (!near(now.scrollX, end.scrollX)) failures.push(`${label}: the sideways scroll moved ${end.scrollX} → ${now.scrollX} during a narrowing drag`);
  });
  const narrowed = await laidOutAt(page, narrow, width).catch(() => null);
  if (!narrowed) {
    failures.push(`${label}: column ${narrow} isn't ${width} px after a ${NARROW_PX} px drag at the right end`);
    return '';
  }
  const clamped = sidewaysRoom(narrowed);
  const rested = await filledWhere(page, `Math.abs(s.scrollX - ${clamped}) < 0.5`).catch(() => null);
  if (!rested) failures.push(`${label}: the sideways scroll at ${(await shown(page)).shown.scrollX} after the release, not clamped to ${clamped}`);
  sets = await widthsSets(page, 3);
  if (sets.length !== 3) failures.push(`${label}: ${sets.length} widths published after two drags and a fit`);
  return `, column ${wide} ${before.width} → ${after.width} px (budget ${before.budget} → ${after.budget}), column ${fit} fitted to ${fitted} px, column ${narrow} ${was} → ${width} px at the right end (scroll ${end.scrollX.toFixed(1)} held, then ${rested?.scrollX.toFixed(1)}), widths published ${sets.length}×`;
}

/** A left press at `at`, with Shift held if `shift`: the pointer moved
 *  there first and given two frames (WebKit can deliver a scripted press
 *  before hover updates). */
async function pressAt(page: Page, at: { x: number; y: number }, shift = false): Promise<void> {
  await page.mouse.move(at.x, at.y);
  await page.waitForTimeout(50);
  if (shift) await page.keyboard.down('Shift');
  await page.mouse.down({ clickCount: 1 });
  await page.mouse.up({ clickCount: 1 });
  if (shift) await page.keyboard.up('Shift');
}

/** The screen's color at `at` once `done` holds for it, or after 1 s,
 *  whatever it is then. Firefox's screenshot can show the frame before the
 *  one the probe reports (seen after Escape, ~100 ms behind); a redraw
 *  that never came still fails. */
async function settled(page: Page, at: { x: number; y: number }, done: (seen: number[]) => boolean): Promise<number[]> {
  let seen = await pixel(page, at.x, at.y);
  for (let waited = 0; waited < 1_000 && !done(seen); waited += 50) {
    await page.waitForTimeout(50);
    seen = await pixel(page, at.x, at.y);
  }
  return seen;
}

/** With `select` and every kind on: presses, a drag, and keys select what
 *  the model says, the published selection and the probe's agreeing; the
 *  tint shows under a block and a select-all and is gone after Escape. */
async function checkSelect(page: Page, label: string, layout: Layout, start: Shown): Promise<string> {
  const range = (kind: Selection['kind'], anchor: [number, number], head: [number, number] = anchor): Selection => ({ kind, anchor, head });
  const step = async (what: string, want: Selection | null) =>
    selected(page, want).catch(async () => {
      const now = (await shown(page)).shown;
      failures.push(`${label}: ${what}: selected ${JSON.stringify(now.selection ?? null)} (published ${JSON.stringify(await global(page, SELECTION_GLOBAL))}), not ${JSON.stringify(want)}`);
      return null;
    });
  // A spot inside cell (3, 2), clear of its text and of a block's edge:
  // the tint is checked there, against how it looked before.
  const spot = { x: layout.left + layout.columns[2]!.x + 3, y: layout.top + 3 * layout.rowHeight + 3 };
  const off = (a: number[], b: number[]) => Math.max(...a.slice(0, 3).map((channel, index) => Math.abs(channel - b[index]!)));
  // The pointer off the table, so no hover is drawn at the spot.
  await page.mouse.move(1, 1);
  const bare = await pixel(page, spot.x, spot.y);
  const tinted: string[] = [];

  await pressAt(page, cellAt(layout, start, 2, 1));
  await step('a cell press', range('cells', [2, 1]));
  await pressAt(page, cellAt(layout, start, 5, 3), true);
  await step('a Shift+press', range('cells', [2, 1], [5, 3]));
  await page.mouse.move(1, 1);
  const block = await settled(page, spot, (seen) => off(seen, bare) > FILL_STEPS);
  if (off(block, bare) <= FILL_STEPS) failures.push(`${label}: no tint inside a block (${block.join(',')}, ${bare.join(',')} unselected)`);
  tinted.push(`block ${block.slice(0, 3).join(',')}`);

  // A drag across columns and rows, in moves.
  const from = cellAt(layout, start, 4, 0);
  const to = cellAt(layout, start, 9, 3);
  await page.mouse.move(from.x, from.y);
  await page.waitForTimeout(50);
  await page.mouse.down({ clickCount: 1 });
  for (let index = 1; index <= DRAG_MOVES; index++) await page.mouse.move(from.x + ((to.x - from.x) * index) / DRAG_MOVES, from.y + ((to.y - from.y) * index) / DRAG_MOVES);
  await page.mouse.up({ clickCount: 1 });
  await step('a drag', range('cells', [4, 0], [9, 3]));

  // A row's number, then Shift+End: every row from it, as one range.
  await pressAt(page, gutterAt(layout, start, 3));
  await step("a row's number", range('rows', [3, 0]));
  await page.keyboard.press('Shift+End');
  await step('Shift+End', range('rows', [3, 0], [start.rows - 1, 0]));
  const end = await filledWhere(page, 's.end === s.rows').catch(() => null);
  if (!end) failures.push(`${label}: Shift+End didn't bring the last row into view`);
  // Home: the active cell to the first row, collapsed to it.
  await page.keyboard.press('Home');
  await step('Home', range('cells', [0, 0]));
  const top = await filledWhere(page, 's.first === 0').catch(() => null);
  if (!top) failures.push(`${label}: Home didn't bring the first row into view`);

  await pressAt(page, headerAt(layout, start, 2));
  await step('a header press', range('columns', [0, 2]));
  // Cmd+A where it's a Mac, Ctrl+A elsewhere: both are bound.
  await page.keyboard.press('ControlOrMeta+A');
  const columns = layout.columns.length;
  await step('Cmd+A', range('columns', [0, 0], [0, columns - 1]));
  await page.mouse.move(1, 1);
  const all = await settled(page, spot, (seen) => off(seen, bare) > FILL_STEPS);
  if (off(all, bare) <= FILL_STEPS) failures.push(`${label}: no tint under a select-all (${all.join(',')}, ${bare.join(',')} unselected)`);
  tinted.push(`all ${all.slice(0, 3).join(',')}`);

  await page.keyboard.press('Escape');
  await step('Escape', null);
  const cleared = await settled(page, spot, (seen) => off(seen, bare) <= FILL_STEPS);
  if (off(cleared, bare) > FILL_STEPS) failures.push(`${label}: the tint still drawn after Escape (${cleared.join(',')}, ${bare.join(',')} before)`);
  return `, selected and cleared (unselected ${bare.slice(0, 3).join(',')}, ${tinted.join(', ')}, Shift+End to row ${end?.end ?? '?'})`;
}

/** With `copy`: `text` holds `rows` × `columns` from (`firstRow`,
 *  `firstColumn`), each field the source's exact text (NULL empty), every
 *  cell compared when there are few, else `SAMPLED_CELLS` spread over
 *  them. Returns a note, or null with the failure pushed. */
async function matchesSource(page: Page, label: string, what: string, text: string, firstRow: number, rows: number, firstColumn: number, columns: number): Promise<string | null> {
  const lines = parseTsv(text);
  if (lines.length !== rows) return failed(`${label}: ${what}: pasted ${lines.length} lines, not ${rows} (${JSON.stringify(text.slice(0, 80))})`);
  const ragged = lines.findIndex((fields) => fields.length !== columns);
  if (ragged >= 0) return failed(`${label}: ${what}: line ${ragged + 1} holds ${lines[ragged]!.length} fields, not ${columns}`);
  const cells: [number, number][] = [];
  const total = rows * columns;
  const step = total <= SAMPLED_CELLS * 4 ? 1 : Math.floor(total / SAMPLED_CELLS);
  for (let index = 0; index < total; index += step) cells.push([Math.floor(index / columns), index % columns]);
  cells.push([rows - 1, columns - 1]);
  const exact = await exactTexts(page, cells.map(([row, column]) => [firstRow + row, firstColumn + column]));
  const wrong = cells.findIndex(([row, column], index) => lines[row]![column] !== (exact[index] ?? ''));
  if (wrong >= 0) {
    const [row, column] = cells[wrong]!;
    return failed(`${label}: ${what}: row ${firstRow + row}, column ${firstColumn + column} pasted ${JSON.stringify(lines[row]![column])}, the source holds ${JSON.stringify(exact[wrong])}`);
  }
  return `${rows}×${columns} (${cells.length} cells compared, ${(text.length / 1024).toFixed(0)} KiB)`;
}

function failed(failure: string): null {
  failures.push(failure);
  return null;
}

/** Cmd+C (Ctrl+C elsewhere) on the canvas, then the copy's end. */
async function copyByKey(page: Page, timeout = 30_000): Promise<CopyState> {
  const after = await lastCopyId(page);
  await page.keyboard.press('ControlOrMeta+c');
  return copyReached(page, after, ['written', 'refused', 'failed', 'unavailable'], timeout);
}

/** The reads the host's source was sent so far. */
const readsSent = async (page: Page) => (await global<number>(page, READS_SENT_GLOBAL)) ?? 0;

/** A `Rows` selection of `rows` rows from `first`, through the host's hook. */
const rowsFrom = (first: number, rows: number): Selection => ({ kind: 'rows', anchor: [first, 0], head: [first + rows - 1, 0] });

/** With `copy`, unheld: a cell, a block, a Shift+press block over the
 *  visible cells, and a `Rows` range past the loaded pages, each pasted
 *  and compared; in the narrow shape, a select-all's key declined and the
 *  host's copy of it refused at the cap. */
async function checkCopyKeys(page: Page, label: string, layout: Layout, start: Shown, shape: string): Promise<string> {
  const notes: string[] = [];
  const written = (what: string, state: CopyState) => state.state === 'written' || !failed(`${label}: ${what}: ${JSON.stringify(state)}, not written`);

  await pressAt(page, cellAt(layout, start, 2, 1));
  await selected(page, { kind: 'cells', anchor: [2, 1], head: [2, 1] });
  if (written('a cell', await copyByKey(page))) {
    const text = await paste(page);
    const [exact] = await exactTexts(page, [[2, 1]]);
    if (text !== (exact ?? '')) failed(`${label}: a cell pasted ${JSON.stringify(text)}, the source holds ${JSON.stringify(exact)}`);
    else notes.push(`a cell ${JSON.stringify(text)}`);
  }

  await pressAt(page, cellAt(layout, start, 1, 0));
  await pressAt(page, cellAt(layout, start, 4, 2), true);
  await selected(page, { kind: 'cells', anchor: [1, 0], head: [4, 2] });
  if (written('a block', await copyByKey(page))) {
    const note = await matchesSource(page, label, 'a block', await paste(page), 1, 4, 0, 3);
    if (note) notes.push(`a block ${note}`);
  }

  // Every row and column wholly in view: the last row above the partial
  // one under the scrollbar.
  const lastRow = start.end - 2;
  const lastColumn = layout.columns.findLastIndex((column) => column.x + column.width <= layout.cellsWidth);
  await pressAt(page, cellAt(layout, start, start.first, 0));
  await pressAt(page, cellAt(layout, start, lastRow, lastColumn), true);
  await selected(page, { kind: 'cells', anchor: [start.first, 0], head: [lastRow, lastColumn] });
  if (written('the visible block', await copyByKey(page))) {
    const note = await matchesSource(page, label, 'the visible block', await paste(page), start.first, lastRow - start.first + 1, 0, lastColumn + 1);
    if (note) notes.push(`the visible block ${note}`);
  }

  // Past the loaded pages, within the key's limit: two pages of the narrow
  // shape, 200 rows (100 k cells) of the wide.
  const columns = layout.columns.length;
  const rows = shape === 'wide' ? 200 : 2048;
  await selectThrough(page, rowsFrom(UNLOADED_ROW, rows));
  const before = await readsSent(page);
  if (written('a Rows range past the loaded pages', await copyByKey(page))) {
    const read = (await readsSent(page)) - before;
    if (!read) failed(`${label}: a Rows range past the loaded pages read nothing`);
    const note = await matchesSource(page, label, 'a Rows range', await paste(page), UNLOADED_ROW, rows, 0, columns);
    if (note) notes.push(`rows ${UNLOADED_ROW}+ ${note}, ${read} reads`);
  }

  if (shape === 'narrow') {
    const kept = await paste(page);
    // A press gives the table its focus back from the paste's textarea.
    await pressAt(page, cellAt(layout, start, 2, 1));
    await page.keyboard.press('ControlOrMeta+A');
    await selected(page, { kind: 'columns', anchor: [0, 0], head: [0, columns - 1] }).catch(() => failed(`${label}: Cmd+A didn't select every column`));
    const reads = await readsSent(page);
    const after = await lastCopyId(page);
    await page.keyboard.press('ControlOrMeta+c');
    const declined = await copyReached(page, after, ['declined'], 5_000).catch(() => null);
    await page.waitForTimeout(300);
    if (!declined) failed(`${label}: a select-all's Cmd+C wasn't declined`);
    else if (declined.state === 'declined' && (declined.rows !== start.rows || declined.columns !== columns)) failed(`${label}: declined ${declined.rows}×${declined.columns}, not ${start.rows}×${columns}`);
    if ((await readsSent(page)) !== reads) failed(`${label}: a declined copy read ${(await readsSent(page)) - reads} pages`);
    // The host's confirmed copy: no key limit, and the cap refuses it.
    await page.keyboard.press('ControlOrMeta+Shift+c');
    const capped = await copyReached(page, after, ['written', 'refused', 'failed', 'unavailable'], 300_000);
    if (capped.state !== 'failed' || capped.reason !== 'too-large') failed(`${label}: the confirmed select-all ended ${JSON.stringify(capped)}, not refused at the cap`);
    const left = await paste(page);
    if (left !== kept) failed(`${label}: the clipboard changed under a declined and a refused copy (${left.length} characters, ${kept.length} before)`);
    else if (capped.state === 'failed') notes.push(`select-all declined (${(await readsSent(page)) - reads} reads), then refused at ${((capped.bytes ?? 0) / 2 ** 20).toFixed(0)} of ${((capped.maxBytes ?? 0) / 2 ** 20).toFixed(0)} MiB, the clipboard kept`);
    await page.keyboard.press('Escape');
  }
  return `, copied ${notes.join('; ')}`;
}

/** With `copy`, reads held: a copy of `COPY_PAGES` unloaded pages, written
 *  and pasted whole. `held` (~6 s) then cancels one with Escape and one by
 *  closing the table, the clipboard as it was each time; `background`
 *  finishes with another tab in front. */
async function checkCopyHeld(page: Page, label: string, layout: Layout, run: CopyRun, heldMs: number): Promise<string> {
  const columns = layout.columns.length;
  const rows = COPY_PAGES * 1024;
  // Prefetch's two reads go out once the visible page lands: past them,
  // the copy has its two places from the start.
  await page.waitForTimeout(heldMs + 500);
  await selectThrough(page, rowsFrom(UNLOADED_ROW, rows));
  const from = Date.now();
  const after = await lastCopyId(page);
  await page.keyboard.press('ControlOrMeta+c');
  await copyReached(page, after, ['copying'], 5_000);
  let other: Page | null = null;
  if (run === 'background') {
    other = await page.context().newPage();
    await other.goto('about:blank');
    await other.bringToFront();
  }
  const state = await copyReached(page, after, ['written', 'refused', 'failed', 'unavailable'], 3 * heldMs * 4 + 60_000);
  const tookMs = Date.now() - from;
  if (other) {
    // Hidden until its write settled: the tab in front all along.
    await page.bringToFront();
    await other.close();
  }
  if (state.state !== 'written') return failed(`${label}: a held copy ended ${JSON.stringify(state)}, not written`) ?? '';
  if (tookMs < 5_000) failed(`${label}: the held copy took ${tookMs} ms, not past the key's 5 s`);
  const text = await paste(page);
  const note = await matchesSource(page, label, 'a held copy', text, UNLOADED_ROW, rows, 0, columns);
  if (!note) return '';
  const notes = [`${note} in ${(tookMs / 1000).toFixed(1)} s${other ? ', in the background' : ''}`];
  if (run !== 'held') return `, copied ${notes.join('; ')}`;

  // Escape while a copy runs: cancelled, the selection kept, the
  // clipboard as it was. Then closing the table during one.
  const cancels: [string, Selection, () => Promise<unknown>, string][] = [
    ['Escape', rowsFrom(UNLOADED_ROW + rows, 2048), () => page.keyboard.press('Escape'), 'cancelled'],
    ['closing the table', rowsFrom(UNLOADED_ROW + rows + 2048, 2048), () => page.evaluate(() => (globalThis as { __tallTableClose?: () => void }).__tallTableClose!()), 'closed'],
  ];
  for (const [what, selection, cancel, reason] of cancels) {
    await selectThrough(page, selection);
    const id = await lastCopyId(page);
    await page.keyboard.press('ControlOrMeta+c');
    await copyReached(page, id, ['copying'], 5_000);
    await page.waitForTimeout(500);
    await cancel();
    const ended = await copyReached(page, id, ['failed', 'written', 'refused'], 10_000);
    if (ended.state !== 'failed' || ended.reason !== reason) failed(`${label}: ${what} during a copy ended it ${JSON.stringify(ended)}, not ${reason}`);
    if (what === 'Escape') await selected(page, selection).catch(() => failed(`${label}: Escape during a copy didn't keep the selection`));
    const left = await paste(page);
    if (left !== text) failed(`${label}: ${what} during a copy changed the clipboard (${left.length} characters, ${text.length} before)`);
    else notes.push(`${what} during one: ${reason}, the clipboard kept`);
  }
  return `, copied ${notes.join('; ')}`;
}

/** With `copy`, in an insecure context: no clipboard, so a copy of rows
 *  that aren't loaded is refused at its start and reads nothing. */
async function checkCopyInsecure(page: Page, label: string): Promise<string> {
  if (await page.evaluate(() => isSecureContext)) return failed(`${label}: the LAN address is a secure context`) ?? '';
  await selectThrough(page, rowsFrom(UNLOADED_ROW, 1024));
  const reads = await readsSent(page);
  const state = await copyByKey(page, 5_000);
  await page.waitForTimeout(500);
  const read = (await readsSent(page)) - reads;
  if (state.state !== 'unavailable') failed(`${label}: a copy with no clipboard ended ${JSON.stringify(state)}, not unavailable`);
  if (read) failed(`${label}: a copy with no clipboard read ${read} pages`);
  return `, a copy refused (${state.state}), ${read} reads`;
}

/** With `sort`: the cells the table drew at the top (or the end) once
 *  they're the order's (each of `column`'s visible cells the host's exact
 *  value at its row), checked in `want`'s order: each pair non-decreasing
 *  ascending, non-increasing descending, ties by the source's row, NULLs
 *  last: a value first at the top, and at the end (`at`, for a column
 *  holding NULLs) a NULL last; for none, the values `unsorted` held there
 *  before any sort. Polls: a frame or two can pass before the cells probe
 *  shows the new order's. Returns a note. */
async function checkOrder(page: Page, label: string, what: string, layout: Layout, column: number, want: Sort | null, { at = 'top', unsorted }: { at?: 'top' | 'end'; unsorted?: (string | null)[] } = {}): Promise<string> {
  const view = await filledWhere(page, at === 'top' ? 's.first === 0 && s.top === 0' : 's.end === s.rows').catch(() => null);
  if (!view) return failed(`${label}: ${what}: the view didn't rest at the ${at}, filled`) ?? '';
  // The rows wholly drawn: the partial last one sits under the scrollbar.
  const rows = Array.from({ length: view.end - view.first }, (_, index) => view.first + index);
  const exact = await exactTexts(page, rows.map((row) => [row, column]));
  const expected = exact.map((text) => text ?? 'NULL');
  let drawn: Cell[] = [];
  for (let waited = 0; waited < 5_000; waited += 50) {
    const cells = new Map((await drawnCells(page)).filter((cell) => cell.column === column).map((cell) => [cell.row, cell.exact]));
    if (rows.every((row, index) => cells.get(row) === expected[index])) {
      drawn = rows.map((row, index) => ({ row, column, exact: expected[index]!, shown: '' }));
      break;
    }
    await page.waitForTimeout(50);
  }
  if (!drawn.length) {
    const cells = (await drawnCells(page)).filter((cell) => cell.column === column).slice(0, 4);
    return failed(`${label}: ${what}: the drawn cells of column ${column} aren't the source's at rows ${view.first}–${view.end} (drawn ${JSON.stringify(cells.map((cell) => [cell.row, cell.exact]))}, the source ${JSON.stringify(expected.slice(0, 4))})`) ?? '';
  }
  if (!want) {
    if (!unsorted || unsorted.length !== exact.length) return failed(`${label}: ${what}: ${exact.length} rows at the top, ${unsorted?.length} before any sort`) ?? '';
    const moved = exact.findIndex((text, index) => text !== unsorted[index]);
    if (moved >= 0) return failed(`${label}: ${what}: row ${rows[moved]} drew ${JSON.stringify(exact[moved])}, ${JSON.stringify(unsorted[moved])} before any sort`) ?? '';
    return `${what} the source's order`;
  }
  // NULLs last both ways: a NULL-first order passes the pairs below.
  if (at === 'top' && exact[0] === null) return failed(`${label}: ${what}: a NULL at the top`) ?? '';
  if (at === 'end' && exact.at(-1) !== null) return failed(`${label}: ${what}: ${JSON.stringify(exact.at(-1))} at the end, not a NULL`) ?? '';
  const source = await sourceRows(page, rows);
  const kind = layout.columns[column]!.kind;
  const compare = (a: string, b: string) => (kind === 'float' ? Number(a) - Number(b) : a < b ? -1 : a > b ? 1 : 0);
  const sign = want.direction === 'ascending' ? 1 : -1;
  for (let index = 1; index < rows.length; index++) {
    const [a, b] = [exact[index - 1]!, exact[index]!];
    const tie = (a === null && b === null) || (a !== null && b !== null && compare(a, b) === 0);
    const wrong =
      a === null && b !== null ? 'a NULL before a value'
      : tie && source[index - 1]! >= source[index]! ? `a tie out of the source's order (rows ${source[index - 1]}, ${source[index]})`
      : !tie && a !== null && b !== null && sign * compare(a, b) > 0 ? `out of ${want.direction} order`
      : null;
    if (wrong) return failed(`${label}: ${what}: rows ${rows[index - 1]}, ${rows[index]} (${JSON.stringify(a)}, ${JSON.stringify(b)}): ${wrong}`) ?? '';
  }
  const ties = rows.slice(1).filter((_, index) => exact[index] === exact[index + 1]).length;
  const nulls = exact.filter((text) => text === null).length;
  return `${what} (${JSON.stringify(exact[0])}…${JSON.stringify(exact.at(-1))}${ties ? `, ${ties} ties` : ''}${nulls ? `, ${nulls} NULL` : ''})`;
}

/** The arrow's box of `column` on screen, as a PNG's base64, once it
 *  differs from each of `not` (or after 1 s, whatever it is then). */
async function arrowShot(page: Page, layout: Layout, column: number, not: string[] = []): Promise<string> {
  const { arrow } = layout.columns[column]!;
  // At the sideways scroll's 0, where `checkSort` runs.
  const clip = { x: layout.left + screenLeft(layout, column, 0) + arrow!.x, y: layout.top - layout.rowHeight, width: arrow!.width, height: layout.rowHeight };
  let shot = (await page.screenshot({ clip })).toString('base64');
  for (let waited = 0; waited < 1_000 && not.includes(shot); waited += 50) {
    await page.waitForTimeout(50);
    shot = (await page.screenshot({ clip })).toString('base64');
  }
  return shot;
}

/** Each sort run's dim arrow by browser, shape, and column, with the
 *  glyphs or the icons: the two must differ. */
const dimArrows = new Map<string, Partial<Record<SortRun, string>>>();

/** With `sort`: each of the shape's `SORT_COLUMNS` clicked through its
 *  cycle (a text column ascending first, any other descending), the order
 *  and the arrow checked at each step. */
async function checkSort(page: Page, label: string, layout: Layout, shape: string, key: string, sorting: SortRun): Promise<string> {
  const notes: string[] = [];
  // Off the arrows, into the body: at the page's corner sits gpui-pre-web's
  // key textarea, and a move over it never reaches the canvas.
  const away = () => page.mouse.move(layout.left + 300, layout.top + 300);
  for (const column of SORT_COLUMNS[shape]!) {
    const arrow = arrowAt(layout, column, 0);
    if (!arrow) {
      failed(`${label}: column ${column} draws no arrow`);
      continue;
    }
    const kind = layout.columns[column]!.kind;
    // The values at the top before any sort, for off to come back to.
    const top = await filledWhere(page, 's.first === 0 && s.top === 0');
    const unsorted = await exactTexts(page, Array.from({ length: top.end - top.first }, (_, index) => [top.first + index, column] as [number, number]));
    const first = kind === 'text' ? 'ascending' : 'descending';
    const second = first === 'ascending' ? 'descending' : 'ascending';
    await away();
    const dim = await arrowShot(page, layout, column);
    await page.mouse.move(arrow.x, arrow.y);
    const hovered = await arrowShot(page, layout, column, [dim]);
    if (hovered === dim) failed(`${label}: column ${column}'s arrow drew the same hovered as dim`);
    const other = dimArrows.get(`${key} ${column}`) ?? {};
    other[sorting] = dim;
    dimArrows.set(`${key} ${column}`, other);
    if (other.glyphs && other.glyphs === other.icons) failed(`${label}: column ${column}'s arrow drew the same with the icons as with the glyphs`);
    if (select) {
      // A press beside the arrow selects the column; one on it, nothing.
      // Past the column's icon (`header-icon`), whose press is its own.
      const icon = iconEnd(layout, column);
      await pressAt(page, { x: layout.left + screenLeft(layout, column, 0) + (icon ? icon + ICON_CLEAR_PX : 8), y: arrow.y });
      await selected(page, { kind: 'columns', anchor: [0, column], head: [0, column] }).catch(() => failed(`${label}: a press beside column ${column}'s arrow didn't select the column`));
      await page.keyboard.press('Escape');
      await selected(page, null).catch(() => failed(`${label}: Escape kept the selection`));
    }
    const shots = [dim, hovered];
    const steps: [string, Sort | null][] = [
      [first, { column, direction: first }],
      [second, { column, direction: second }],
      ['off', null],
    ];
    for (const [what, want] of steps) {
      await pressAt(page, arrow);
      const done = await sortedAs(page, want).catch(() => null);
      if (!done) {
        failed(`${label}: a click on column ${column}'s arrow didn't sort ${JSON.stringify(want)} (probe ${JSON.stringify((await shown(page)).shown.sort ?? null)})`);
        break;
      }
      if (select && (await shown(page)).shown.selection) failed(`${label}: a click on column ${column}'s arrow selected ${JSON.stringify((await shown(page)).shown.selection)}`);
      notes.push(`${layout.columns[column]!.name} ${await checkOrder(page, label, what, layout, column, want, { unsorted })}`);
      // NULLs last both ways: at the end, mostly NULL (diameter's).
      if (want && kind === 'float' && shape === 'narrow') {
        await page.keyboard.press('End');
        notes.push(`${await checkOrder(page, label, `${what} at the end`, layout, column, want, { at: 'end' })}`);
      }
      await away();
      if (want) {
        const shot = await arrowShot(page, layout, column, shots);
        if (shots.includes(shot)) failed(`${label}: column ${column}'s arrow ${what} drew as an earlier state`);
        shots.push(shot);
      } else {
        const shot = await arrowShot(page, layout, column, shots.slice(1));
        if (shot !== dim) failed(`${label}: column ${column}'s arrow at off isn't dim as before the cycle`);
      }
    }
    // The End check left the view there; the next column's starts at the top.
    await page.keyboard.press('Home');
  }
  return `, sorted ${notes.join('; ')}`;
}

/** `__tallTableReplace`'s stride: a source of every other row. */
const REPLACE_STRIDE = 2;
/** The named row the replace runs land at, inside the strided rows. */
const REPLACE_ROW = 400_000;
/** Past the strided rows' last top by this many: clamped to the end. */
const REPLACE_PAST = 1_000;

/** The builds that publish the drawn cells (`?probe-cells`): elsewhere a
 *  view's last visible row's first cell (the probe's `lastCell`) is what a
 *  check reads of the cells. */
const cellsProbed = ['custom-cells', 'sort', 'format', 'reorder', 'find'].some((feature) => builtFeatures().includes(feature));

/** The drawn cells, `row,column` → exact text, once a frame draws from
 *  `view`'s first row and covers every wholly drawn row of it; none in a
 *  build that doesn't publish them. */
async function cellsOf(page: Page, view: Shown): Promise<Map<string, string>> {
  if (!cellsProbed) return new Map();
  for (let waited = 0; ; waited += 50) {
    const cells = await drawnCells(page);
    const rows = new Set(cells.map((cell) => cell.row));
    const covered = Array.from({ length: view.end - view.first }, (_, index) => view.first + index).every((row) => rows.has(row));
    if ((covered && Math.min(...rows) === view.first) || waited >= 5_000) return new Map(cells.map((cell) => [`${cell.row},${cell.column}`, cell.exact]));
    await page.waitForTimeout(50);
  }
}

/** In every build: the rows replaced (`__tallTableReplace`) by every
 *  `REPLACE_STRIDE`-th row of the source, at each target (the top, a row,
 *  a row past the new last top, the end), the view checked at the target
 *  and what it draws against the source's rows. The whole source replaced
 *  back at the row whose view ends at the strided last row × the stride:
 *  its last visible row's first cell must be the strided view's, and,
 *  where the build publishes the drawn cells, each strided row `r`'s
 *  cells those the whole source draws at row `r × stride`. At the top the
 *  strided view must draw otherwise than the whole one (the swap drew).
 *  With `sort`, a column sorted first: kept through each replace, and the
 *  strided top in its order. */
async function checkReplace(page: Page, label: string, layout: Layout, start: Shown, shape: Shape): Promise<string> {
  const notes: string[] = [];
  const whole = start.rows;
  const strided = Math.ceil(whole / REPLACE_STRIDE);
  const want: Sort | null = sort ? { column: SORTED_COLUMN[shape], direction: 'descending' } : null;
  if (want) await sortThrough(page, want);
  // The whole source at the top: what the strided top must differ from.
  const top = await filledWhere(page, 's.top === 0');
  const topCells = await cellsOf(page, top);
  const targets: [string, number | 'top' | 'end', 'row' | 'end'][] = [
    ['top', 'top', 'row'],
    [`row ${REPLACE_ROW}`, REPLACE_ROW, 'row'],
    [`row ${strided + REPLACE_PAST}`, strided + REPLACE_PAST, 'end'],
    ['end', 'end', 'end'],
  ];
  for (const [what, at, landsAt] of targets) {
    const view = await replaceThrough(page, REPLACE_STRIDE, at, strided, landsAt).catch(() => null);
    if (!view) {
      failed(`${label}: replaced at ${what}: the view didn't fill at its target with ${strided} rows (${JSON.stringify((await shown(page)).shown)})`);
      continue;
    }
    const cells = await cellsOf(page, view);
    if (at === 'top') {
      if (view.lastCell === top.lastCell) failed(`${label}: replaced at the top: the last row's first cell ${JSON.stringify(view.lastCell)} as before the replace`);
      if (cellsProbed && [...cells].every(([key, text]) => topCells.get(key) === text)) failed(`${label}: replaced at the top: the cells drawn as before the replace`);
    }
    if (want) {
      if (JSON.stringify(view.sort ?? null) !== JSON.stringify(want)) failed(`${label}: replaced at ${what}: the sort ${JSON.stringify(view.sort ?? null)}, not kept as ${JSON.stringify(want)}`);
      if (at === 'top') notes.push(`${what} ${await checkOrder(page, label, 'in order', layout, want.column, want)}`);
    }
    // The whole source, its last visible row the strided last row's source
    // row: the view as tall, so its first row is that less the rows above.
    const last = view.end - 1;
    const backAt = last * REPLACE_STRIDE - (last - view.first);
    const back = await replaceThrough(page, 1, backAt, whole).catch(() => null);
    if (!back) {
      failed(`${label}: replaced back at row ${backAt}: the view didn't fill there with ${whole} rows`);
      continue;
    }
    if (back.end - 1 !== last * REPLACE_STRIDE) failed(`${label}: replaced back at row ${backAt}: the last row ${back.end - 1}, not ${last * REPLACE_STRIDE}`);
    else if (back.lastCell !== view.lastCell) failed(`${label}: replaced at ${what}: row ${last} drew ${JSON.stringify(view.lastCell)} first, the source's row ${last * REPLACE_STRIDE} ${JSON.stringify(back.lastCell)}`);
    // Each strided cell whose source row the whole view draws.
    const pairs = [...cells]
      .map(([key, text]) => {
        const [row, column] = key.split(',').map(Number) as [number, number];
        return { key, text, source: `${row * REPLACE_STRIDE},${column}`, row: row * REPLACE_STRIDE };
      })
      .filter(({ row }) => row >= back.first && row < back.end);
    let wholeCells = await cellsOf(page, back);
    for (let waited = 0; waited < 5_000 && pairs.some(({ text, source }) => wholeCells.get(source) !== text); waited += 50) {
      await page.waitForTimeout(50);
      wholeCells = await cellsOf(page, back);
    }
    const wrong = pairs.find(({ text, source }) => wholeCells.get(source) !== text);
    if (cellsProbed && pairs.length < 2) failed(`${label}: replaced at ${what}: ${pairs.length} cells to compare with the source`);
    else if (wrong) failed(`${label}: replaced at ${what}: cell ${wrong.key} drew ${JSON.stringify(wrong.text)}, the source's ${wrong.source} ${JSON.stringify(wholeCells.get(wrong.source))}`);
    notes.push(`${what} rows ${view.first}–${view.end} of ${strided}${cellsProbed ? ` (${pairs.length} cells the source's)` : ''}`);
    if (want && JSON.stringify(back.sort ?? null) !== JSON.stringify(want)) failed(`${label}: replaced back: the sort ${JSON.stringify(back.sort ?? null)}, not kept`);
  }
  return `, replaced ${want ? `sorted ${want.column} ${want.direction}: ` : ''}${notes.join('; ')}`;
}

/** The columns each shape's hide run hides (by index): with `pin`, the
 *  narrow shape's run's last (`full_name`) and the wide shape's whole run
 *  (its first column), and scrolled ones beside them. */
const HIDE_AT: Record<Shape, number[]> = { narrow: [1, 4, 5], wide: [0, 2, 3] };
/** A column's screen is compared this far inside its edges: its border,
 *  and `pin`'s edge line over the last pinned column's right, move with a
 *  hide. */
const HIDE_INSET_PX = 2;

/** With `hide`: `HIDE_AT[shape]` hidden through the host's hook, then
 *  shown. Hidden: each laid out at width 0 at the right edge of the place
 *  before, every place starting where the one before ends, every shown
 *  column at its width at open; with `pin`, the count in effect the
 *  shape's (a pinned column among it) and the edge moved left by the
 *  hidden pinned widths; each column shown both ways and wholly in view
 *  drawn as it was at open, inside its edges, at its new x (so the drawn
 *  layout skips the hidden ones). With the drawn cells published
 *  (`cellsProbed`), none at a hidden place, and with the source's exact
 *  values (`copy` or `sort`), each drawn cell the source's, at the top and
 *  after a wheel down. Shown again there: the layout as at open and the
 *  cells the source's (the pages read while hidden hold every column);
 *  then back at the top, the screen as at open, pixel for pixel. */
async function checkHide(page: Page, label: string, start: Layout, shape: Shape): Promise<string> {
  const notes: string[] = [];
  const indices = HIDE_AT[shape];
  // The source's exact values: `copy`, `sort`, and `reorder` give the hook.
  const exact = copy || sort || reorder;
  const identity = start.columns.map((column, place) => column.index ?? place);
  // The pointer over the row numbers, in the body: no hover in any shot.
  await page.mouse.move(start.left - 6, start.top + 12 * start.rowHeight);
  const y = Math.ceil(start.top - start.rowHeight) + 1;
  const height = Math.floor(9 * start.rowHeight);
  const cellsClip = { x: Math.ceil(start.left), y, width: Math.floor(start.left + start.cellsWidth) - Math.ceil(start.left), height };
  const columnClip = (layout: Layout, place: number) => ({ x: Math.round(layout.left + layout.columns[place]!.x) + HIDE_INSET_PX, y, width: Math.floor(layout.columns[place]!.width) - 2 * HIDE_INSET_PX, height });
  const inView = (layout: Layout, place: number) => layout.columns[place]!.width > 0 && layout.columns[place]!.x + layout.columns[place]!.width <= layout.cellsWidth;
  const differing = (a: string, b: string) => differingPixels(page, a, b, FILL_STEPS);
  /** The pixels of `clip` differing from `want`, polled up to 1 s (Firefox's
   *  shot can lag the probe's frame). */
  const differsFrom = async (clip: { x: number; y: number; width: number; height: number }, want: string) => {
    let off = 0;
    for (let waited = 0; waited <= 1_000; waited += 100) {
      off = await differing(await screenshot(page, clip), want);
      if (!off) return 0;
      await page.waitForTimeout(100);
    }
    return off;
  };
  /** With the drawn cells published: none at a hidden place, and with the
   *  source's values, each the source's; read from a frame whose rows start
   *  at `first` or past it (after a scroll). */
  const cellsRight = async (what: string, layout: Layout, first = 0) => {
    if (!cellsProbed) return;
    const atHidden = (await drawnCells(page, { first })).find((cell) => layout.columns[cell.column]?.hidden);
    if (atHidden) failed(`${label}: ${what}: a cell drawn at hidden place ${atHidden.column}, row ${atHidden.row}`);
    if (exact) {
      const checked = await cellsInOrder(page, label, what, identity);
      if (checked) notes.push(`${what} ${checked} the source's`);
    }
  };
  await page.waitForTimeout(200);
  const openScreen = await settledScreen(page, cellsClip);
  const openColumns = new Map(start.columns.map((_, place) => place).filter((place) => inView(start, place) && !indices.includes(identity[place]!)).map((place) => [place, '']));
  for (const place of openColumns.keys()) openColumns.set(place, await screenshot(page, columnClip(start, place)));

  const hidden = await hideThrough(page, indices).catch((error: Error) => failed(`${label}: hid ${JSON.stringify(indices)}: ${error.message.split('\n')[0]}`));
  if (!hidden) return '';
  hidden.columns.forEach((column, place) => {
    const at = place ? hidden.columns[place - 1]!.x + hidden.columns[place - 1]!.width : 0;
    if (Math.abs(column.x - at) > 0.01) failed(`${label}: hidden: place ${place} at ${column.x}, not ${at}, where the place before ends`);
    const was = start.columns[place]!.width;
    if (column.hidden ? column.width !== 0 : Math.abs(column.width - was) > 0.01) failed(`${label}: hidden: place ${place} ${column.hidden ? 'hidden' : 'shown'} at width ${column.width}, not ${column.hidden ? 0 : was}`);
  });
  const want = DEFAULT_PINNED[shape];
  // The run at open must be the shape's whole default (not cut by the
  // half-view cap) for the count and the edge to be read against it.
  if (pin && start.pinned !== want) failed(`${label}: ${start.pinned} pinned at open, not the shape's ${want}: the hide's pin checks need the whole run`);
  else if (pin) {
    const lost = start.columns.slice(0, want).reduce((sum, column, place) => sum + (indices.includes(identity[place]!) ? column.width : 0), 0);
    if (hidden.pinned !== want || ((await global<number>(page, PINNED_GLOBAL)) ?? want) !== want) failed(`${label}: hidden: ${hidden.pinned} pinned in effect (published ${await global(page, PINNED_GLOBAL)}), not the shape's ${want}, counted by place`);
    else if (Math.abs(pinEdge(hidden) - (pinEdge(start) - lost)) > 0.01) failed(`${label}: hidden: the run's edge at ${pinEdge(hidden)}, not ${pinEdge(start) - lost}`);
    else notes.push(`${want} pinned, the edge ${pinEdge(start).toFixed(0)} → ${pinEdge(hidden).toFixed(0)} px`);
  }
  let compared = 0;
  for (const [place, shot] of openColumns) {
    // Only a column moved by whole CSS px draws its text at the same
    // sub-pixel phase (a glyph-measured width, with `density`, can be
    // fractional).
    const shift = start.columns[place]!.x - hidden.columns[place]!.x;
    if (!inView(hidden, place) || Math.abs(shift - Math.round(shift)) > 0.01) continue;
    const off = await differsFrom(columnClip(hidden, place), shot);
    if (off) failed(`${label}: hidden: place ${place}, now at ${hidden.columns[place]!.x} px, drew ${off} px otherwise than at ${start.columns[place]!.x} at open`);
    compared++;
  }
  if (compared < 2) failed(`${label}: hidden: ${compared} columns in view both ways to compare`);
  notes.push(`hid ${JSON.stringify(indices)}: ${compared} columns drawn as at open, moved left`);
  await cellsRight('hidden at the top', hidden);

  // A wheel down while hidden: its pages read, then shown there.
  const view = (await shown(page)).shown;
  await page.mouse.move(start.left + 200, start.top + 200);
  await wheel(page, 40 * start.rowHeight);
  const down = await filledWhere(page, `s.first >= ${view.first + 30}`).catch(() => failed(`${label}: hidden: a wheel down didn't fill`));
  if (!down) return '';
  await cellsRight(`hidden at row ${down.first}`, hidden, down.first);
  const back = await hideThrough(page, []).catch((error: Error) => failed(`${label}: shown again: ${error.message.split('\n')[0]}`));
  if (!back) return '';
  const moved = back.columns.findIndex((column, place) => Math.abs(column.x - start.columns[place]!.x) > 0.01 || Math.abs(column.width - start.columns[place]!.width) > 0.01 || column.hidden);
  if (moved >= 0) failed(`${label}: shown again: place ${moved} at ${back.columns[moved]!.x} wide ${back.columns[moved]!.width}, not as at open`);
  if (pin && back.pinned !== DEFAULT_PINNED[shape]) failed(`${label}: shown again: ${back.pinned} pinned`);
  await cellsRight(`shown at row ${down.first}`, back, down.first);

  // Back at the top: the screen as at open.
  await wheel(page, -80 * start.rowHeight);
  if (!(await filledWhere(page, 's.top === 0').catch(() => null))) return failed(`${label}: shown again: a wheel up didn't reach the top`) ?? '';
  await page.mouse.move(start.left - 6, start.top + 12 * start.rowHeight);
  const off = await differsFrom(cellsClip, openScreen);
  if (off) failed(`${label}: shown again at the top: ${off} px drew otherwise than at open`);
  notes.push(`shown at row ${down.first} and back at the top as at open`);
  return `, ${notes.join('; ')}`;
}

/** With `find`: the drawn cells marked by the rule, the tints on screen
 *  against the view with no term (with `format`, placed by its advances),
 *  and three steps: back from the top and on (each round the other end) and
 *  on again (in view), each landing fully in view and drawn current. */
async function checkFind(page: Page, label: string, start: Layout, shape: Shape): Promise<string> {
  const notes: string[] = [];
  const term = FIND_TERM[shape];
  const viewport = page.viewportSize()!;
  const placeOf = (layout: Layout, index: number) => layout.columns.findIndex((column, place) => (column.index ?? place) === index);
  const view = (await shown(page)).shown;
  // The pointer over the row numbers, in the body: no hover in any shot.
  await page.mouse.move(start.left - 6, start.top + 12 * start.rowHeight);
  const rows = Math.min(20, Math.floor((viewport.height - start.top) / start.rowHeight) - 2);
  const clip = { x: Math.ceil(start.left), y: Math.ceil(start.top), width: Math.floor(start.left + start.cellsWidth) - Math.ceil(start.left), height: Math.floor(rows * start.rowHeight) };
  await page.waitForTimeout(200);
  const bare = await settledScreen(page, clip);

  await findThrough(page, term).catch((error: Error) => failed(`${label}: the term ${term}: ${error.message.split('\n')[0]}`));
  // A frame drawn with the term: its cells carry what they draw of it.
  const marked = await page
    .waitForFunction(() => ((globalThis as { __tallTableCells?: Cell[] }).__tallTableCells ?? []).some((cell) => cell.found), null, { timeout: 10_000, polling: 10 })
    .then(() => true, () => false);
  if (!marked) return failed(`${label}: no drawn cell marked with the term ${term}`) ?? '';
  const tinted = await settledScreen(page, clip);
  const cells = await drawnCells(page);
  const wrong = cells.find((cell) => Boolean(cell.found) !== (cell.exact !== 'NULL' && cell.exact.toLowerCase().includes(term)));
  if (wrong) failed(`${label}: cell (${wrong.row}, ${wrong.column}) ${JSON.stringify(wrong.exact)} ${wrong.found ? 'marked' : 'not marked'} for ${term}`);
  const offShown = cells.find((cell) => Array.isArray(cell.found) && cell.found.some(([from, to]) => new TextDecoder().decode(new TextEncoder().encode(cell.shown).slice(from, to)).toLowerCase() !== term));
  if (offShown) failed(`${label}: cell (${offShown.row}, ${offShown.column}): a range ${JSON.stringify(offShown.found)} of ${JSON.stringify(offShown.shown)} isn't the term`);
  notes.push(`${cells.filter((cell) => cell.found).length} of ${cells.length} drawn cells marked by the rule`);

  // On screen: each cell wholly in the clip, its box less a pixel a side.
  const adv = format ? await advances(page) : null;
  const pad = paddingAt(14);
  const inClip = cells.filter((cell) => {
    const column = start.columns[cell.column]!;
    return cell.row >= view.top && cell.row < view.top + rows && column.width > 0 && column.x + column.width <= start.cellsWidth;
  });
  const boxes = inClip.map((cell) => {
    const column = start.columns[cell.column]!;
    return { x: start.left + column.x + 1, y: start.top + (cell.row - view.top) * start.rowHeight + 2, width: column.width - 2, height: start.rowHeight - 4 };
  });
  const seen = await tintsIn(page, bare, tinted, clip, boxes, 2);
  let whole = 0;
  let ranged = 0;
  let placed = 0;
  inClip.forEach((cell, index) => {
    const { runs, ink } = seen[index]!;
    const box = boxes[index]!;
    const at = `${label}: cell (${cell.row}, ${cell.column}) ${JSON.stringify(cell.shown)}`;
    if (!cell.found) {
      if (runs.length) failed(`${at}: unmarked, drawn otherwise at ${JSON.stringify(runs)}`);
      return;
    }
    if (cell.found === 'cell') {
      whole++;
      if (runs.length !== 1 || runs[0]![0] > box.x + 0.5 || runs[0]![1] < box.x + box.width - 0.5) failed(`${at}: marked whole, tinted at ${JSON.stringify(runs)}, not across ${box.x}–${box.x + box.width}`);
      return;
    }
    ranged++;
    if (!runs.length || !ink) return failed(`${at}: ranges ${JSON.stringify(cell.found)}, nothing tinted`);
    if (runs[0]![0] <= box.x + 0.5 && runs.at(-1)![1] >= box.x + box.width - 0.5) return failed(`${at}: ranges ${JSON.stringify(cell.found)}, tinted whole`);
    if (!adv || ![...cell.shown].every((ch) => adv[ch] !== undefined)) return;
    // The drawn text's start, right- or left-aligned, whichever its ink is at.
    const textWidth = advancesWidth(cell.shown, adv);
    const cellLeft = box.x - 1;
    const x0 = [cellLeft + box.width + 2 - pad - textWidth, cellLeft + pad].find((x) => Math.abs(ink[0] - x) <= 2);
    if (x0 === undefined) return failed(`${at}: its ink starts at ${ink[0].toFixed(1)}, where no alignment of its advances (${textWidth.toFixed(1)} px) puts it`);
    const charsTo = (byte: number) => new TextDecoder().decode(new TextEncoder().encode(cell.shown).slice(0, byte));
    const want: [number, number][] = [];
    for (const [from, to] of cell.found) {
      const left = x0 + advancesWidth(charsTo(from), adv);
      const right = x0 + advancesWidth(charsTo(to), adv);
      const last = want.at(-1);
      if (last && left - last[1] < 0.5) last[1] = right;
      else want.push([left, right]);
    }
    const off = want.length !== runs.length || want.some(([left, right], at) => Math.abs(runs[at]![0] - left) > TINT_SLACK_PX || Math.abs(runs[at]![1] - right) > TINT_SLACK_PX);
    if (off) failed(`${at}: ranges ${JSON.stringify(cell.found)} tinted at ${JSON.stringify(runs.map(([a, b]) => [Number(a.toFixed(1)), Number(b.toFixed(1))]))}, the advances put them at ${JSON.stringify(want.map(([a, b]) => [Number(a.toFixed(1)), Number(b.toFixed(1))]))}`);
    placed++;
  });
  if (!ranged) failed(`${label}: no cell in view with ranges to check`);
  if (format && !placed) failed(`${label}: no ranged cell placed by the advances`);
  notes.push(`on screen: ${ranged} cells' ranges tinted${adv ? ` (${placed} at the advances' offsets)` : ''}, ${whole} tinted whole, ${inClip.length - ranged - whole} untouched`);

  // An empty term over the term is no term, as the hook takes it: the
  // probe's term null and no drawn cell marked; then the term again.
  const emptied = await findThrough(page, '').then(() => true, (error: Error) => failed(`${label}: the empty term: ${error.message.split('\n')[0]}`) ?? false);
  if (emptied) {
    const unmarked = await page
      .waitForFunction(() => !((globalThis as { __tallTableCells?: Cell[] }).__tallTableCells ?? []).some((cell) => cell.found), null, { timeout: 10_000, polling: 10 })
      .then(() => true, () => false);
    if (!unmarked) failed(`${label}: drawn cells still marked after the empty term`);
    else notes.push('the empty term cleared it');
  }
  await findThrough(page, term).catch((error: Error) => failed(`${label}: the term ${term} again: ${error.message.split('\n')[0]}`));

  /** A step: a match, its wrap as `wrapped`; its row and column fully in
   *  view, the probe's current match, and its drawn cell current. */
  const landed = async (what: string, backward: boolean, wrapped: boolean): Promise<{ found: Found; view: Shown } | null> => {
    const found = await stepThrough(page, backward).catch((error: Error) => failed(`${label}: ${what}: ${error.message.split('\n')[0]}`));
    if (!found) return null;
    if (found.outcome !== 'match' || !found.cell) return failed(`${label}: ${what}: ${found.outcome}`);
    if (found.wrapped !== wrapped) failed(`${label}: ${what}: ${found.wrapped ? '' : 'not '}wrapped`);
    const { row, column } = found.cell;
    const now = await filledWhere(page, `s.find && s.find.current && s.find.current.row === ${row} && s.find.current.column === ${column}`).catch(() => failed(`${label}: ${what}: (${row}, ${column}) never the probe's current match, filled`));
    if (!now) return null;
    const layout = (await shown(page)).layout;
    const place = placeOf(layout, column);
    const left = screenLeft(layout, place, now.scrollX);
    const edge = place < (layout.pinned ?? 0) ? 0 : pinEdge(layout);
    const bottom = layout.top + (row - now.top + 1) * layout.rowHeight;
    // The cells area ends where the vertical track does, above the
    // horizontal bar.
    const [, trackY, , trackHeight] = (await page.evaluate(() => (globalThis as { __seizaTargets?: Record<string, number[]> }).__seizaTargets?.['table-scroll-track'])) ?? [];
    if (trackY === undefined || trackHeight === undefined) return failed(`${label}: ${what}: no scroll track published`);
    const cellsBottom = trackY + trackHeight;
    if (row < now.top || bottom > cellsBottom + 0.5) failed(`${label}: ${what}: row ${row} not wholly in view (top ${now.top}, its bottom at ${bottom.toFixed(1)} px, the cells' at ${cellsBottom.toFixed(1)})`);
    if (left < edge - 0.5 || left + layout.columns[place]!.width > layout.cellsWidth + 0.5) failed(`${label}: ${what}: column ${column} at ${left.toFixed(0)}–${(left + layout.columns[place]!.width).toFixed(0)} px, not wholly in view (${edge.toFixed(0)}–${layout.cellsWidth.toFixed(0)})`);
    const current = (await drawnCells(page)).filter((cell) => cell.current);
    if (current.length !== 1 || current[0]!.row !== row || current[0]!.column !== place) failed(`${label}: ${what}: the drawn current cells ${JSON.stringify(current.map((cell) => [cell.row, cell.column]))}, not (${row}, ${place})`);
    return { found, view: now };
  };
  const back = await landed('back from the top', true, true);
  if (!back) return `, ${notes.join('; ')}`;
  if (back.view.top <= view.top) failed(`${label}: back from the top: the view didn't move down (top ${back.view.top})`);
  if (shape === 'wide' && back.view.scrollX < 1) failed(`${label}: back from the top: column ${back.found.cell!.column} landed with no sideways scroll`);
  notes.push(`back from the top to (${back.found.cell!.row}, ${back.found.cell!.column}), wrapped, the view at row ${back.view.top} and ${back.view.scrollX.toFixed(0)} px sideways`);
  const on = await landed('on from the last row', false, true);
  if (!on) return `, ${notes.join('; ')}`;
  // Out of view, it lands as `jump_to` does: its row at the top.
  if (on.view.top !== on.found.cell!.row || on.found.cell!.row >= rows) failed(`${label}: on from the last row: (${on.found.cell!.row}, ${on.found.cell!.column}), the view at row ${on.view.top}, not the first match's row at the top`);
  notes.push(`on to (${on.found.cell!.row}, ${on.found.cell!.column}), wrapped, the view at row ${on.view.top} and ${on.view.scrollX.toFixed(0)} px sideways`);
  const again = await landed('on again', false, false);
  if (!again) return `, ${notes.join('; ')}`;
  if (again.found.cell!.row < on.view.top + rows && again.view.top !== on.view.top) failed(`${label}: on again: row ${again.found.cell!.row} was in view, yet the view moved to row ${again.view.top}`);
  notes.push(`on again to (${again.found.cell!.row}, ${again.found.cell!.column}), the view ${again.view.top === on.view.top ? 'kept' : `at row ${again.view.top}`}`);
  return `, ${notes.join('; ')}`;
}

/** With `popover` (the button labeled, the long text's column at
 *  `LONG_AT`): opened by the cue and placed below its cell, its text
 *  scrolled by a wheel over it (the table kept), a part of its text
 *  selected and copied (Cmd+C, before `copy`'s with it built), its button
 *  pressed, opened at the window's bottom and flipped above, closed by
 *  Escape and by a press outside, and with `select` opened and its button
 *  pressed by Enter. */
async function checkPopover(page: Page, label: string, start: Layout): Promise<string> {
  const notes: string[] = [];
  const viewport = page.viewportSize()!;
  const place = start.columns.findIndex((column, at) => (column.index ?? at) === LONG_AT);
  if (place < 0) return failed(`${label}: no long text's column at index ${LONG_AT}`) ?? '';
  const view = (await shown(page)).shown;
  const cellWidth = start.columns[place]!.width;
  /** The popover's size and place against its cell's: below it (or above,
   *  flipped), its left at the cell's unless clamped 8 px inside the
   *  window, at most `max(cell, 400)` and 75% of the window wide and 50% of
   *  it tall. The probe's bounds are its box inside its 1 px border, and
   *  gpui-base's `Positioner` rounds its place to a whole px: so the box
   *  drawn is the probe's grown by `POPOVER_BORDER`, its left within 0.5 px
   *  of the cell's. */
  const placed = (what: string, popover: Popover, row: number, below: boolean): void => {
    const [x, y, width, height] = [popover.bounds[0] - POPOVER_BORDER, popover.bounds[1] - POPOVER_BORDER, popover.bounds[2] + 2 * POPOVER_BORDER, popover.bounds[3] + 2 * POPOVER_BORDER];
    const cellLeft = start.left + screenLeft(start, place, view.scrollX);
    const cellTop = start.top + (row - view.top) * start.rowHeight;
    if (popover.below !== below) failed(`${label}: ${what}: ${popover.below ? 'below' : 'above'} its cell, not ${below ? 'below' : 'above'}`);
    if (below ? y < cellTop + start.rowHeight - 0.5 : y + height > cellTop + 0.5) failed(`${label}: ${what}: at ${y.toFixed(1)}–${(y + height).toFixed(1)} px, not ${below ? 'below' : 'above'} its cell (${cellTop.toFixed(1)}–${(cellTop + start.rowHeight).toFixed(1)})`);
    if (Math.abs(x - cellLeft) > 0.51 && Math.abs(x + width - (viewport.width - 8)) > 0.51) failed(`${label}: ${what}: its left at ${x.toFixed(1)} px, not its cell's ${cellLeft.toFixed(1)} nor clamped at the window's right`);
    if (width > Math.min(Math.max(cellWidth, 400), 0.75 * viewport.width) + 0.5) failed(`${label}: ${what}: ${width.toFixed(1)} px wide, past max(${cellWidth}, 400) and 75% of ${viewport.width}`);
    if (height > 0.5 * viewport.height + 0.5) failed(`${label}: ${what}: ${height.toFixed(1)} px tall, past 50% of ${viewport.height}`);
  };
  const center = (bounds: [number, number, number, number]) => ({ x: bounds[0] + bounds[2] / 2, y: bounds[1] + bounds[3] / 2 });

  // The cue: on the hovered cell (the button set, so every cell has one),
  // its press opening the popover there, below it.
  const row = view.first + 1;
  const hovered = cellAt(start, view, row, place);
  await page.mouse.move(hovered.x, hovered.y);
  const cue = await page
    .waitForFunction(({ row, column }) => {
      const cue = (globalThis as { __tallTable?: Shown }).__tallTable?.cue;
      return cue && cue.cell.row === row && cue.cell.column === column && cue;
    }, { row, column: LONG_AT }, { timeout: 5_000, polling: 10 })
    .then((handle) => handle.jsonValue() as Promise<NonNullable<Shown['cue']>>, () => null);
  if (!cue) return failed(`${label}: no cue drawn on the hovered cell (${row}, ${LONG_AT})`) ?? '';
  await pressAt(page, center(cue.bounds));
  const opened = await popoverWhere(page, `p && p.cell.row === ${row} && p.cell.column === ${LONG_AT}`).catch(() => null);
  if (!opened) return failed(`${label}: the cue's press opened no popover on (${row}, ${LONG_AT})`) ?? '';
  placed('by the cue', opened, row, true);
  if (!opened.button) failed(`${label}: by the cue: no button drawn, with a label set`);
  if ((await shown(page)).shown.selection) failed(`${label}: the cue's press selected ${JSON.stringify((await shown(page)).shown.selection)}`);
  notes.push(`the cue opened it below (${opened.bounds.map((value) => value.toFixed(0)).join(', ')}), ${opened.chars} characters`);

  // A wheel over it scrolls its text, not the table.
  if (opened.contentHeight <= opened.bounds[3]) failed(`${label}: its text ${opened.contentHeight.toFixed(0)} px tall fits its ${opened.bounds[3].toFixed(0)} px: nothing to scroll`);
  const middle = center(opened.bounds);
  await page.mouse.move(middle.x, middle.y);
  await wheel(page, 200);
  const scrolled = await popoverWhere(page, 'p && p.scroll > 0').catch(() => null);
  const kept = (await shown(page)).shown;
  if (!scrolled) failed(`${label}: a wheel over it didn't scroll its text`);
  else notes.push(`a wheel scrolled its text ${scrolled.scroll.toFixed(0)} px`);
  if (kept.top !== view.top || kept.scrollX !== view.scrollX) failed(`${label}: a wheel over it moved the table to row ${kept.top}, ${kept.scrollX} px sideways`);
  await wheel(page, -2_000);
  await popoverWhere(page, 'p && p.scroll < 0.5').catch(async () => failed(`${label}: its text didn't scroll back to its top (at ${(await popoverWhere(page, 'true'))?.scroll} px)`));

  // A drag along its first line selects a part, and Cmd+C copies it (the
  // popover's own key, before `copy`'s).
  const [px, py] = opened.bounds;
  await page.mouse.move(px + 14, py + 16);
  await page.waitForTimeout(50);
  await page.mouse.down();
  for (let step = 1; step <= 8; step++) await page.mouse.move(px + 14 + (226 * step) / 8, py + 16);
  await page.mouse.up();
  await page.keyboard.press('ControlOrMeta+C');
  const pasted = await paste(page);
  if (!pasted) failed(`${label}: nothing pasted after a drag in its text and Cmd+C`);
  else if (!/^[a-z \n]+$/.test(pasted) || pasted.length >= opened.chars || !pasted.trim()) failed(`${label}: pasted ${JSON.stringify(pasted.slice(0, 60))} (${pasted.length} characters), not a part of its text`);
  else notes.push(`a drag selected and Cmd+C copied ${pasted.length} of its characters`);
  if (!(await popoverWhere(page, `p && p.cell.row === ${row}`).catch(() => null))) failed(`${label}: it closed during the drag`);

  // Its button: the event with its cell, and it closes.
  const pressed = async (what: string, before: number, act: () => Promise<void>): Promise<void> => {
    await act();
    const press = await page
      .waitForFunction(({ name, before }) => {
        const press = (globalThis as unknown as Record<string, PopoverPress | undefined>)[name];
        return press && press.count > before && press;
      }, { name: POPOVER_BUTTON_GLOBAL, before }, { timeout: 5_000, polling: 10 })
      .then((handle) => handle.jsonValue() as Promise<PopoverPress>, () => null);
    if (!press) failed(`${label}: ${what}: no button press published`);
    else if (press.column !== LONG_AT) failed(`${label}: ${what}: the press named (${press.row}, ${press.column}), not column ${LONG_AT}`);
    await popoverWhere(page, 'p === null').catch(() => failed(`${label}: ${what}: still open after its button`));
  };
  const presses = async () => (await global<PopoverPress>(page, POPOVER_BUTTON_GLOBAL))?.count ?? 0;
  const button = (await popoverWhere(page, 'p && p.button'))!.button!;
  await pressed('its button pressed', await presses(), () => pressAt(page, center(button)));
  notes.push('its button pressed and published');

  // At the window's bottom: flipped above.
  const lastRow = view.first + Math.floor((viewport.height - start.top) / start.rowHeight) - 2;
  const flipped = await popoverThrough(page, lastRow, LONG_AT).catch((error: Error) => failed(`${label}: opened on row ${lastRow}: ${error.message.split('\n')[0]}`));
  if (flipped) {
    placed(`opened on row ${lastRow}`, flipped, lastRow, false);
    notes.push(`opened on row ${lastRow}, flipped above`);
  }

  // Escape closes it (the table focused by the presses before).
  await page.keyboard.press('Escape');
  await popoverWhere(page, 'p === null').then(() => notes.push('Escape closed it'), () => failed(`${label}: Escape didn't close it`));

  // A press outside closes it, and goes on to do what it does.
  await popoverThrough(page, row, LONG_AT);
  const outside = cellAt(start, view, row + 6, 0);
  await pressAt(page, outside);
  await popoverWhere(page, 'p === null').then(() => notes.push('a press outside closed it'), () => failed(`${label}: a press outside didn't close it`));
  if (select) await selected(page, { kind: 'cells', anchor: [row + 6, 0], head: [row + 6, 0] }, 5_000).catch(() => failed(`${label}: the press outside didn't select its cell`));

  // With `select`: Enter on the active cell opens it, Enter again presses
  // its button.
  if (select) {
    const entered = row + 2;
    await pressAt(page, cellAt(start, view, entered, place));
    await selected(page, { kind: 'cells', anchor: [entered, LONG_AT], head: [entered, LONG_AT] }, 5_000).catch(() => failed(`${label}: a press didn't select (${entered}, ${LONG_AT})`));
    await page.keyboard.press('Enter');
    const byEnter = await popoverWhere(page, `p && p.cell.row === ${entered} && p.cell.column === ${LONG_AT}`).catch(() => null);
    if (!byEnter) failed(`${label}: Enter on the active cell opened no popover`);
    else {
      placed('by Enter', byEnter, entered, true);
      await pressed('Enter on it', await presses(), () => page.keyboard.press('Enter'));
      notes.push('Enter opened it and Enter pressed its button');
    }
  }
  return `, ${notes.join('; ')}`;
}

/** The faded cue's lengths at the base's 14 px text, in CSS px short of
 *  the cell's right edge: the cells' padding, where the fade starts and
 *  where it's clear (`popover.rs`'s `FADE_RAMP` and `FADE_CLEAR` short of
 *  the content box's end), the cue's inset, and the widest glyph (one whose
 *  middle is past the fade's start reaches this far before it). */
const FADE = { pad: 8, start: 72, clear: 24, inset: 2, glyph: 14 };
/** How long an Enter that opens nothing is waited on. */
const ENTER_QUIET_MS = 400;

/** With `popover` and its three settings on (`?popover-cells=cut`,
 *  `?popover-fade`, `?popover-icons`, `?popover-fill`; the long text's
 *  column at `LONG_AT`), `over` saying what its cells are drawn over (a
 *  striped row, or `custom-cells`' fill): the smoke check's header says
 *  what's checked. */
async function checkPopoverSettings(page: Page, label: string, start: Layout, over: 'stripe' | 'fill'): Promise<string> {
  const notes: string[] = [];
  const place = start.columns.findIndex((column, at) => (column.index ?? at) === LONG_AT);
  if (place < 0) return failed(`${label}: no long text's column at index ${LONG_AT}`) ?? '';
  const number = start.columns.findIndex((column) => ['float', 'integer'].includes(column.kind));
  if (number < 0) return failed(`${label}: no number's column`) ?? '';
  const view = (await shown(page)).shown;
  const cellLeft = start.left + screenLeft(start, place, view.scrollX);
  const cellWidth = start.columns[place]!.width;
  const cellRight = cellLeft + cellWidth;
  if (cellWidth < FADE.start + 4 * FADE.glyph) return failed(`${label}: the long text's column ${cellWidth} px wide: no room to read its fade`) ?? '';
  /** The probe's cue once `test` holds of it (null for none), or null. */
  const cueWhere = (test: string, timeout = 5_000): Promise<NonNullable<Shown['cue']> | null> =>
    page
      .waitForFunction((test) => {
        const s = (globalThis as { __tallTable?: Shown }).__tallTable;
        if (!s || s.cue === undefined) return false;
        return new Function('c', `return ${test}`)(s.cue) ? { cue: s.cue } : false;
      }, test, { timeout, polling: 10 })
      .then(async (handle) => ((await handle.jsonValue()) as { cue: NonNullable<Shown['cue']> | null }).cue, () => null);
  const center = (bounds: [number, number, number, number]) => ({ x: bounds[0] + bounds[2] / 2, y: bounds[1] + bounds[3] / 2 });
  // An odd row: striped.
  const row = view.first + 1 + (view.first % 2);
  const rowTop = start.top + (row - view.top) * start.rowHeight;
  /** Row `row`'s long cell from `from` to `to` px left of its right edge,
   *  a pixel inside its top and bottom. */
  const span = (from: number, to: number, top = rowTop + 1, height = start.rowHeight - 2) => ({ x: Math.round(cellRight - from), y: Math.round(top), width: Math.round(from - to), height: Math.round(height) });
  const whole = span(cellWidth - 2, 0);
  const lead = span(cellWidth - 2, FADE.start + FADE.glyph);
  // Above the text's ink: the row's background, or the fill, short of the cue.
  const above = span(cellWidth - 2, FADE.clear + 4, rowTop + 1, 3);

  // A number's cell: no cue under `CutText`, a button set.
  const plain = cellAt(start, view, row, number);
  await page.mouse.move(plain.x, plain.y);
  await page.waitForTimeout(150);
  const none = await cueWhere('true');
  if (none) failed(`${label}: a cue on a number's cell (${none.cell.row}, ${none.cell.column}) under CutText`);
  const [restWhole, restLead, restAbove] = [await settledScreen(page, whole), await screenshot(page, lead), await screenshot(page, above)];
  if (over === 'stripe') {
    // The row is striped: its bare padding against the next row's.
    const [striped, next] = [await pixel(page, whole.x, rowTop + 2), await pixel(page, whole.x, rowTop + start.rowHeight + 2)];
    if (striped.every((channel, at) => channel === next[at])) failed(`${label}: row ${row} isn't striped: ${striped} as row ${row + 1}'s`);
  } else {
    const [fill, bare] = [await pixel(page, whole.x, rowTop + 2), await pixel(page, cellLeft - 4, rowTop + 2)];
    if (fill.every((channel, at) => Math.abs(channel - bare[at]!) <= FILL_STEPS)) failed(`${label}: row ${row}'s long text has no fill: ${fill} as the cell's before it`);
  }

  // The pointer on the cell, at its bottom left (clear of its tooltip and
  // of the text read): the cue at its far right, its text faded.
  await page.mouse.move(cellLeft + 3, rowTop + start.rowHeight - 3);
  const cue = await cueWhere(`c && c.cell.row === ${row} && c.cell.column === ${LONG_AT}`);
  if (!cue) return failed(`${label}: no cue on the hovered cut text (${row}, ${LONG_AT})`) ?? '';
  if (!cue.faded || cue.open) failed(`${label}: the hovered cue ${cue.faded ? 'faded' : 'not faded'}, ${cue.open ? 'the open mark' : 'the closed mark'}`);
  if (Math.abs(cue.bounds[0] + cue.bounds[2] - (cellRight - FADE.inset)) > 0.75) failed(`${label}: the cue ends at ${(cue.bounds[0] + cue.bounds[2]).toFixed(1)} px, not ${FADE.inset} px inside its cell's right edge (${cellRight.toFixed(1)})`);
  const cueBox = { x: Math.round(cue.bounds[0]), y: Math.round(cue.bounds[1]), width: Math.round(cue.bounds[2]), height: Math.round(cue.bounds[3]) };
  const fadedWhole = await settledScreen(page, whole);
  const moved = await differingPixels(page, restLead, await screenshot(page, lead), 8);
  if (moved) failed(`${label}: ${moved} pixels of the text before its fade differ from the cell at rest: a glyph moved or lost ink`);
  const tinted = await differingPixels(page, restAbove, await screenshot(page, above), 2);
  if (tinted) failed(`${label}: ${tinted} pixels above the faded text differ from the cell at rest: its ${over} changed under the fade`);
  const [rest, faded] = [await inkStrength(page, restWhole, whole.width), await inkStrength(page, fadedWhole, whole.width)];
  /** The strongest ink from `from` to `to` px left of the cell's right edge. */
  const most = (ink: { strength: number[]; scale: number }, from: number, to: number) => Math.max(0, ...ink.strength.slice(Math.round((whole.width - from) * ink.scale), Math.round((whole.width - to) * ink.scale)));
  const full = most(faded, cellWidth - 2, FADE.start + FADE.glyph);
  const third = (FADE.start - FADE.clear) / 3;
  const bands = [0, 1, 2].map((band) => most(faded, FADE.start - band * third, FADE.start - (band + 1) * third));
  const last = most(faded, FADE.clear + 6, FADE.clear);
  const past = most(faded, FADE.clear, FADE.clear - 2);
  const inked = most(rest, FADE.start, FADE.pad);
  if (full < 48 || inked < 48) failed(`${label}: the long text's ink reads ${full} of 255 before its fade and ${inked} at rest: no text to fade`);
  else {
    const share = (ink: number) => (ink / full).toFixed(2);
    if (!(bands[0]! > bands[1]! - 0.1 * full && bands[1]! > bands[2]! - 0.1 * full && bands[0]! - bands[2]! > 0.2 * full)) failed(`${label}: the faded text's ink across its ramp's thirds is ${bands.map(share).join(', ')} of its whole ink: not falling off toward the mark`);
    if (bands[2]! > 0.6 * full || last > 0.3 * full) failed(`${label}: the faded text's ink is ${share(bands[2]!)} of its whole in the ramp's last third and ${share(last)} in its last 6 px: not next to none short of the mark`);
    if (past > 0.15 * full) failed(`${label}: ink ${share(past)} of the text's whole past where the fade is clear`);
    notes.push(`over a ${over}, the cut text faded to its cue (ink ${bands.map(share).join(', ')} of its whole across the ramp, ${share(last)} in its last 6 px, ${share(past)} past it), its start and its ${over} as at rest`);
  }

  // The mark's press opens the popover; its mark is then the open one,
  // kept with the pointer elsewhere, and its press closes it.
  const closedMark = await settledScreen(page, cueBox);
  await pressAt(page, center(cue.bounds));
  const opened = await popoverWhere(page, `p && p.cell.row === ${row} && p.cell.column === ${LONG_AT}`).catch(() => null);
  if (!opened) return failed(`${label}: the mark's press opened no popover on (${row}, ${LONG_AT})`) ?? '';
  if (!(await cueWhere(`c && c.cell.row === ${row} && c.cell.column === ${LONG_AT} && c.open`))) failed(`${label}: the open popover's cell's cue isn't the open mark`);
  const openMark = await settledScreen(page, cueBox);
  if (!(await differingPixels(page, closedMark, openMark, 24))) failed(`${label}: the open popover's cell draws the mark it drew closed`);
  await page.mouse.move(plain.x, plain.y + 8 * start.rowHeight);
  await page.waitForTimeout(150);
  const kept = await cueWhere(`c && c.cell.row === ${row} && c.cell.column === ${LONG_AT} && c.open && c.faded`, 1_000);
  if (!kept) failed(`${label}: with the pointer elsewhere, the open popover's cell kept no open, faded cue`);
  const away = await differingPixels(page, openMark, await settledScreen(page, cueBox), 8);
  if (away) failed(`${label}: with the pointer elsewhere, ${away} pixels of the open mark changed`);

  // The button's row: the popover's width, flush with its sides and bottom.
  const [x, y, width, height] = opened.bounds;
  if (!opened.button) failed(`${label}: no button drawn, with a label set`);
  else {
    const [bx, by, bw, bh] = opened.button;
    if (Math.abs(bx - x) > 0.5 || Math.abs(bw - width) > 0.5 || Math.abs(by + bh - (y + height)) > 0.5) failed(`${label}: the filled button at ${opened.button.map((value) => value.toFixed(1)).join(', ')}, not the popover's width at its bottom (${opened.bounds.map((value) => value.toFixed(1)).join(', ')})`);
    else notes.push(`the filled button ${bw.toFixed(0)} px, the popover's width`);
  }
  await pressAt(page, center(cue.bounds));
  await popoverWhere(page, 'p === null').then(() => notes.push("the mark's press opened it, the open mark kept with the pointer away, its press closed it"), () => failed(`${label}: the open mark's press didn't close the popover`));

  // With `select`: Enter on a cut text opens it; on a number's cell it
  // opens nothing and isn't cancelled, so it goes on past the table.
  if (select) {
    await page.evaluate(() => {
      const g = globalThis as { __enters?: boolean[] };
      g.__enters = [];
      // After GPUI's own listener, on its key target: what it left of the key.
      window.addEventListener('keydown', (event) => event.key === 'Enter' && g.__enters!.push(event.defaultPrevented));
    });
    const enters = () => page.evaluate(() => (globalThis as { __enters?: boolean[] }).__enters!);
    const entered = row + 2;
    await pressAt(page, cellAt(start, view, entered, place));
    await selected(page, { kind: 'cells', anchor: [entered, place], head: [entered, place] }, 5_000).catch(() => failed(`${label}: a press didn't select (${entered}, ${LONG_AT})`));
    await page.keyboard.press('Enter');
    const byEnter = await popoverWhere(page, `p && p.cell.row === ${entered} && p.cell.column === ${LONG_AT}`).catch(() => null);
    if (!byEnter) failed(`${label}: Enter on an active cut text opened no popover`);
    await popoverClosed(page);
    await pressAt(page, cellAt(start, view, entered, number));
    await selected(page, { kind: 'cells', anchor: [entered, number], head: [entered, number] }, 5_000).catch(() => failed(`${label}: a press didn't select the number's cell (${entered}, ${number})`));
    await page.keyboard.press('Enter');
    await page.waitForTimeout(ENTER_QUIET_MS);
    const still = await popoverWhere(page, 'true');
    if (still) failed(`${label}: Enter on a number's cell opened a popover on (${still.cell.row}, ${still.cell.column}) under CutText`);
    const cancelled = await enters();
    if (cancelled.length !== 2 || cancelled[0] !== true || cancelled[1] !== false) failed(`${label}: the two Enters' keydowns cancelled ${JSON.stringify(cancelled)}, not the cut text's alone (the number's goes on)`);
    else notes.push("Enter opened a cut text's and went on from a number's cell");
  }
  return `, ${notes.join('; ')}`;
}

/** How long an icon press that reports nothing is waited on. */
const ICON_QUIET_MS = 400;
/** The badge's width at the base's text; `density`'s text scales it. */
const ICON_BADGE_PX = 18;
/** A press's bounds may sit this far from the badge on screen: GPUI
 *  paints in whole device pixels, half a CSS px at Chromium's DPR 2 and
 *  one at the others' 1, where a badge at an x of .5 is painted half a px
 *  off. Under a pixel, so bounds a row off the badge fail. */
const ICON_DRAWN_PX = 0.75;
/** The raised look's reach past the badge at the base's text (the
 *  table's `REACH`), scaled with `density`'s text as the badge's width
 *  is. */
const ICON_REACH_PX = 4;

/** With `header-icon`: the icons on the layout; one number column's badge
 *  drawn where the layout puts it (against its header with the icon
 *  cleared), raised under the pointer, pressed (the press published at
 *  the release, its bounds over the drawn badge), pressed on its ring,
 *  released off it, and right-pressed (its header's context press, with
 *  `clicks`), none of it selecting, sorting, or a `clicks` press. */
async function checkIcons(page: Page, label: string, opened: Layout, view: Shown): Promise<string> {
  const notes: string[] = [];
  const shownColumns = opened.columns.filter((column) => !column.hidden);
  const without = shownColumns.filter((column) => !column.icon);
  if (without.length) return failed(`${label}: ${without.length} of ${shownColumns.length} columns have no icon on the layout (${without.slice(0, 3).map((column) => column.name).join(', ')}…)`) ?? '';
  notes.push(`${shownColumns.length} columns' badges on the layout`);
  // A right-aligned column wholly in view, not the first: clearing its
  // icon moves nothing in its header's left half, where its name isn't.
  const numbers = ['integer', 'float', 'decimal'];
  const inView = (place: number) => {
    const left = screenLeft(opened, place, view.scrollX);
    const column = opened.columns[place]!;
    return !column.hidden && column.icon && left >= pinEdgeOr0(opened, place) && left + column.width <= opened.cellsWidth;
  };
  const place = opened.columns.findIndex((column, at) => at > 0 && numbers.includes(column.kind) && inView(at));
  const other = opened.columns.findIndex((_, at) => at !== place && at !== place - 1 && at !== place + 1 && inView(at));
  if (place < 0 || other < 0) return failed(`${label}: no number column with an icon wholly in view, and another apart from it`) ?? '';
  const column = opened.columns[place]!;
  const index = column.index ?? place;
  const icon = column.icon!;
  const scale = icon.width / ICON_BADGE_PX;
  const reach = ICON_REACH_PX * scale;
  const headerTop = opened.top - opened.rowHeight;
  const columnLeft = opened.left + screenLeft(opened, place, view.scrollX);
  /** The badge by the layout: its left and width, and the top of one
   *  `height` tall: centered in the names' row, floored to a whole px as
   *  the table floors it. Its height is the table's to say (a short row
   *  shrinks it). */
  const badge = { x: columnLeft + icon.x, width: icon.width, top: (height: number) => headerTop + Math.floor((opened.rowHeight - height) / 2), middle: opened.top - opened.rowHeight / 2 };
  const center = { x: badge.x + badge.width / 2, y: badge.middle };
  const away = { x: opened.left + 300, y: opened.top + 300 };
  /** The header's left part: the badge and the raised look's reach, short
   *  of the name. Whole px, so a screenshot's pixels are the clip's. */
  const clipOf = (at: number) => {
    const left = opened.left + screenLeft(opened, at, view.scrollX);
    const end = opened.columns[at]!.icon!.x + opened.columns[at]!.icon!.width + reach + 1;
    return { x: Math.floor(left), y: Math.floor(headerTop), width: Math.ceil(end) + 1, height: Math.floor(opened.rowHeight) };
  };
  const clip = clipOf(place);
  /** A screen of `clip` once `done` holds for it, or after 1 s, whatever
   *  it is then (`settled`'s reason: Firefox's screenshot can run a frame
   *  behind). */
  const screenWhen = async (clip: { x: number; y: number; width: number; height: number }, done: (png: string) => Promise<boolean>): Promise<string> => {
    let png = await screenshot(page, clip);
    for (let waited = 0; waited < 1_000 && !(await done(png)); waited += 50) {
      await page.waitForTimeout(50);
      png = await screenshot(page, clip);
    }
    return png;
  };
  const same = (a: string) => async (b: string) => (await differingPixels(page, a, b, 0)) === 0;
  const differs = (a: string) => async (b: string) => (await differingPixels(page, a, b, 0)) > 0;

  // At rest, then cleared: what differs is the badge.
  await page.mouse.move(away.x, away.y);
  await page.waitForTimeout(100);
  const rest = await screenshot(page, clip);
  const otherRest = await screenshot(page, clipOf(other));
  const clearedLayout = await iconThrough(page, index, null);
  if (clearedLayout.columns[place]!.icon) failed(`${label}: column ${index}'s icon cleared, the layout still has its badge`);
  const cleared = await screenWhen(clip, differs(rest));
  const drawn = await differingBox(page, rest, cleared, clip, 0);
  await iconThrough(page, index, 'number');
  const again = await screenWhen(clip, same(rest));
  if ((await differingPixels(page, rest, again, 0)) > 0) failed(`${label}: column ${index}'s icon set again doesn't draw as at open`);
  if (!drawn) return failed(`${label}: column ${index}'s header draws the same with its icon cleared: no badge on screen`) ?? '';
  if (Math.abs(drawn[0] - badge.x) > ICON_DRAWN_PX || Math.abs(drawn[2] - badge.width) > ICON_DRAWN_PX || Math.abs(drawn[1] - badge.top(drawn[3])) > ICON_DRAWN_PX || drawn[3] > opened.rowHeight - 1)
    failed(`${label}: column ${index}'s badge drawn at ${JSON.stringify(drawn.map((value) => Number(value.toFixed(2))))}, the layout's at x ${badge.x.toFixed(2)}, ${badge.width} wide, its top ${badge.top(drawn[3]).toFixed(2)}`);
  notes.push(`column ${index}'s badge drawn at [${drawn.map((value) => value.toFixed(1)).join(', ')}], where the layout puts it, and again after a clear and a set`);

  // Under the pointer: the raised look, past the badge on every side;
  // the other icon's header as it was.
  await page.mouse.move(center.x, center.y);
  await page.waitForTimeout(50);
  const raised = await screenWhen(clip, differs(rest));
  const lifted = await differingBox(page, rest, raised, clip, 0);
  if (!lifted) failed(`${label}: the pointer over column ${index}'s icon drew nothing new: no raised look`);
  else if (lifted[0] > drawn[0] - 1 || lifted[0] + lifted[2] < drawn[0] + drawn[2] + 1 || lifted[1] > drawn[1] - 1 || lifted[1] + lifted[3] < drawn[1] + drawn[3] + 1)
    failed(`${label}: the raised look redrew ${JSON.stringify(lifted.map((value) => Number(value.toFixed(2))))}, not past the badge ${JSON.stringify(drawn.map((value) => Number(value.toFixed(2))))} on every side`);
  if ((await differingPixels(page, otherRest, await screenshot(page, clipOf(other)), 0)) > 0) failed(`${label}: the pointer over column ${index}'s icon redrew column ${opened.columns[other]!.index ?? other}'s`);
  const cursor = await page.evaluate(() => getComputedStyle(document.querySelector('canvas')!).cursor);
  if (cursor !== 'pointer') failed(`${label}: the cursor over an icon is ${cursor}, not the pointer`);
  if (lifted) notes.push(`raised under the pointer (redrawn [${lifted.map((value) => value.toFixed(1)).join(', ')}]), the cursor the pointer, column ${opened.columns[other]!.index ?? other}'s as it was`);

  // What its presses must leave alone.
  const before = (await shown(page)).shown;
  const clicksBefore = clicks ? await clickCount(page) : 0;
  const untouched = async (what: string) => {
    const now = (await shown(page)).shown;
    if (select && JSON.stringify(now.selection ?? null) !== JSON.stringify(before.selection ?? null)) failed(`${label}: ${what} selected ${JSON.stringify(now.selection)}`);
    if (sort && JSON.stringify(now.sort ?? null) !== JSON.stringify(before.sort ?? null)) failed(`${label}: ${what} sorted ${JSON.stringify(now.sort)}`);
  };
  /** The press published after `count`, checked: its column, its bounds
   *  over the layout's badge and over the drawn one, each within
   *  `ICON_DRAWN_PX`, no key. */
  const expect = async (what: string, count: number): Promise<IconPress | null> => {
    const press = await iconPressAfter(page, count);
    if (!press) return failed(`${label}: ${what}: no icon press published`);
    const [x, y, width, height] = press.bounds;
    const offLayout = Math.max(Math.abs(x - badge.x), Math.abs(width - badge.width), Math.abs(y - badge.top(height)));
    const offDrawn = Math.max(...press.bounds.map((value, at) => Math.abs(value - drawn[at]!)));
    if (press.count !== count + 1 || press.column !== index || offLayout > ICON_DRAWN_PX || offDrawn > ICON_DRAWN_PX || press.modifiers.length)
      return failed(`${label}: ${what}: published ${JSON.stringify(press)}, not column ${index} over the drawn badge ${JSON.stringify(drawn.map((value) => Number(value.toFixed(2))))} with no key, count ${count + 1}`);
    return press;
  };
  const silent = async (what: string, count: number): Promise<boolean> => {
    const press = await iconPressAfter(page, count, ICON_QUIET_MS);
    if (press) failed(`${label}: ${what}: published ${JSON.stringify(press)}`);
    return !press;
  };

  // The press: nothing at the button's going down, the press at its release.
  let count = await iconPressCount(page);
  await page.mouse.down({ clickCount: 1 });
  const held = await silent("an icon's press, the button down", count);
  await page.mouse.up({ clickCount: 1 });
  const pressed = await expect("an icon's press", count);
  await untouched("an icon's press");
  if (held && pressed) notes.push(`pressed: nothing at the press, column ${pressed.column} at the release, its bounds [${pressed.bounds.map((value) => value.toFixed(1)).join(', ')}] over the drawn badge within ${ICON_DRAWN_PX} px`);
  // The host's count, not this script's: a press published and failed
  // above still counted there.
  count = await iconPressCount(page);
  await page.waitForTimeout(APART_MS);

  // On the raised look's ring, outside the badge: the icon's too.
  const ring = { x: badge.x - reach / 2, y: badge.middle };
  await pressAt(page, ring);
  const ringed = await expect("a press on the raised look's ring", count);
  await untouched("a press on the raised look's ring");
  count = await iconPressCount(page);
  if (ringed) {
    notes.push(`a press on its ring (${(reach / 2).toFixed(1)} px left of the badge) the icon's`);
  }
  await page.waitForTimeout(APART_MS);

  // Pressed on the icon, released off it: nothing.
  await page.mouse.move(center.x, center.y);
  await page.waitForTimeout(50);
  await page.mouse.down({ clickCount: 1 });
  await page.mouse.move(away.x, away.y, { steps: 4 });
  await page.mouse.up({ clickCount: 1 });
  const off = await silent('a press released off the icon', count);
  await untouched('a press released off the icon');
  if (off) notes.push('released off it, nothing');
  await page.waitForTimeout(APART_MS);
  if (clicks && (await clickCount(page)) !== clicksBefore) failed(`${label}: the icon's left presses were reported as ${(await clickCount(page)) - clicksBefore} presses of \`clicks\``);

  // A right press: not the icon's; with `clicks`, its header's context press.
  await page.mouse.move(center.x, center.y);
  await page.waitForTimeout(50);
  await page.mouse.down({ button: 'right', clickCount: 1 });
  await page.mouse.up({ button: 'right', clickCount: 1 });
  const notIcon = await silent('a right press on an icon', count);
  if (clicks) {
    const click = await clickAfter(page, clicksBefore);
    if (!click || click.kind !== 'context' || click.target !== 'column' || click.column !== place || click.count !== clicksBefore + 1) failed(`${label}: a right press on an icon: reported ${JSON.stringify(click)}, not a context press on the column at place ${place}`);
    else if (notIcon) notes.push("a right press its header's context press, no icon press");
  } else if (notIcon) notes.push('a right press no icon press');
  if (select) {
    // A context press selects its header's column (`clicks`' rule, or
    // nothing without it): cleared for the rest check.
    await page.keyboard.press('Escape');
  }

  // The pointer away: at rest again.
  await page.mouse.move(away.x, away.y);
  const settledRest = await screenWhen(clip, same(rest));
  if ((await differingPixels(page, rest, settledRest, 0)) > 0) failed(`${label}: with the pointer away, column ${index}'s header doesn't draw as at rest`);
  else notes.push('at rest again with the pointer away');
  return `, ${notes.join('; ')}`;
}

/** The left edge a scrolled column must clear to be wholly in view, CSS px
 *  from the cells' left: `pin`'s run's edge for a scrolled column, 0 for a
 *  pinned one (or without `pin`). */
function pinEdgeOr0(layout: Layout, place: number): number {
  return place < (layout.pinned ?? 0) ? 0 : pinEdge(layout);
}

/** With `pin`: the pinned and scrolled regions' screen under a sideways
 *  scroll, against the same table with nothing pinned (the host's hook),
 *  the edge line, the horizontal thumb pressed and dragged from the run's
 *  edge, a viewport narrowed past the half and widened again, and with
 *  `select` a press on a pinned cell and a scrolled one, with `resize` the
 *  last pinned column's band dragged. */
async function checkPin(page: Page, label: string, start: Layout, shape: Shape): Promise<string> {
  const notes: string[] = [];
  const want = DEFAULT_PINNED[shape];
  let layout = await pinnedAs(page, want).catch(async () => failed(`${label}: ${start.pinned} pinned at open (published ${JSON.stringify(await global(page, PINNED_GLOBAL))}), not the shape's ${want}`));
  if (!layout) return '';
  // With `density`, where the columns all fit (the narrow shape at the
  // host's default), narrower, for `PIN_ROOM_PX` of sideways scroll.
  if (density && sidewaysRoom(layout) < PIN_ROOM_PX) {
    const viewport = page.viewportSize()!;
    const last = layout.columns.at(-1)!;
    const width = Math.round(viewport.width - layout.cellsWidth + last.x + last.width - PIN_ROOM_PX);
    const cells = layout.cellsWidth;
    await page.setViewportSize({ width, height: viewport.height });
    await page.waitForFunction((cells) => ((globalThis as { __tallTableLayout?: Layout }).__tallTableLayout?.cellsWidth ?? cells) < cells - 1, cells, { timeout: 10_000, polling: 10 });
    layout = await pinnedAs(page, want).catch(async () => failed(`${label}: ${(await shown(page)).layout.pinned} pinned at ${width} px wide, not ${want}`));
    if (!layout) return '';
    notes.push(`at ${width} px wide for ${sidewaysRoom(layout).toFixed(0)} px of sideways room`);
  }
  const edge = pinEdge(layout);
  // Whole CSS px inside each region, a band of rows below the header: the
  // pinned one up to the edge line (`edge - 1 .. edge`), the scrolled one
  // from the edge to the cells' right.
  const top = Math.ceil(layout.top + layout.rowHeight);
  const height = Math.floor(8 * layout.rowHeight);
  const pinnedClip = { x: Math.ceil(layout.left), y: top, width: Math.floor(layout.left + edge - 1) - Math.ceil(layout.left), height };
  const scrolledFrom = Math.ceil(layout.left + edge);
  const scrolledClip = { x: scrolledFrom, y: top, width: Math.floor(layout.left + layout.cellsWidth) - scrolledFrom, height };
  // The line's two CSS px, whichever a device pixel rounds it to, mid-row.
  const lineAt = [Math.floor(layout.left + edge - 1), Math.floor(layout.left + edge - 1) + 1].map((x) => ({ x, y: Math.floor(layout.top + 2.5 * layout.rowHeight) }));
  // The pointer over the row numbers, in the body: it wheels the body and
  // hovers no cell, so every shot draws the same hover (none).
  const rest = { x: layout.left - 6, y: layout.top + 12 * layout.rowHeight };
  await page.mouse.move(rest.x, rest.y);
  const shots = async () => ({ pinned: await screenshot(page, pinnedClip), scrolled: await screenshot(page, scrolledClip), line: await Promise.all(lineAt.map((at) => pixel(page, at.x, at.y))) });
  // Pixels differing beyond the browsers' own color handling.
  const differing = (a: string, b: string) => differingPixels(page, a, b, FILL_STEPS);
  const lineOff = (a: number[][], b: number[][]) => Math.max(...a.map((seen, index) => Math.max(...seen.slice(0, 3).map((channel, at) => Math.abs(channel - b[index]![at]!)))));
  const settle = () => page.waitForTimeout(200);

  // At the sideways scroll's 0: pinned and unpinned the same but the line.
  await settle();
  const at0 = await shots();
  await pinThrough(page, 0);
  await settle();
  const at0Unpinned = await shots();
  const at0Left = await differing(at0.pinned, at0Unpinned.pinned);
  const at0Right = await differing(at0.scrolled, at0Unpinned.scrolled);
  if (at0Left || at0Right) failed(`${label}: at scroll 0, pinned and unpinned drew differently (${at0Left} px left of the edge, ${at0Right} right)`);
  if (lineOff(at0.line, at0Unpinned.line) <= FILL_STEPS) failed(`${label}: no edge line at ${lineAt[0]!.x}: ${at0.line.map((seen) => seen.slice(0, 3).join(',')).join(' ')} pinned, ${at0Unpinned.line.map((seen) => seen.slice(0, 3).join(',')).join(' ')} not`);

  // Sideways: the pinned region's pixels unchanged, the scrolled one's
  // moved, and drawn as with nothing pinned (each column at x - scrollX).
  await pinThrough(page, want);
  const by = Math.min(shape === 'wide' ? 600 : 100, sidewaysRoom(layout));
  await wheel(page, 0, by);
  const moved = await filledWhere(page, `s.scrollX >= ${by - 1}`).catch(() => null);
  if (!moved) return failed(`${label}: a sideways wheel of ${by} px left the scroll at ${(await shown(page)).shown.scrollX}`) ?? '';
  await settle();
  const atBy = await shots();
  // The scroll at rest, the wheel's last frame drawn: what unpinning keeps.
  const rested = (await shown(page)).shown.scrollX;
  const pinnedChanged = await differing(atBy.pinned, at0.pinned);
  const scrolledMoved = await differing(atBy.scrolled, at0.scrolled);
  if (pinnedChanged) failed(`${label}: ${pinnedChanged} px of the pinned columns changed under a sideways scroll`);
  if (!scrolledMoved) failed(`${label}: the scrolled columns didn't move under a sideways scroll`);
  await pinThrough(page, 0);
  const unpinnedView = (await shown(page)).shown;
  if (unpinnedView.scrollX !== rested) failed(`${label}: unpinning moved the sideways scroll ${rested} → ${unpinnedView.scrollX}`);
  await settle();
  const atByUnpinned = await shots();
  const rightOff = await differing(atBy.scrolled, atByUnpinned.scrolled);
  if (rightOff) failed(`${label}: right of the edge, ${rightOff} px drew otherwise than with nothing pinned`);
  if (!(await differing(atBy.pinned, atByUnpinned.pinned))) failed(`${label}: left of the edge drew the same pinned as scrolled unpinned`);
  await pinThrough(page, want);
  notes.push(`${want} pinned to ${edge.toFixed(1)} px, scrolled ${rested.toFixed(1)} px: ${pinnedClip.width}×${pinnedClip.height} CSS px pinned held, ${scrolledMoved} px moved`);

  // With `select`, at the sideways scroll: a pinned cell, then a scrolled
  // one wholly right of the run.
  if (select) {
    const view = (await shown(page)).shown;
    const scrolled = layout.columns.findIndex((column, index) => index >= want && screenLeft(layout, index, view.scrollX) >= edge && screenLeft(layout, index, view.scrollX) + column.width <= layout.cellsWidth);
    if (scrolled < 0) failed(`${label}: no scrolled column wholly in view at scroll ${view.scrollX} to press`);
    for (const [row, column] of (scrolled < 0 ? [[2, 0]] : [[2, 0], [3, scrolled]]) as [number, number][]) {
      await pressAt(page, cellAt(layout, view, view.first + row, column));
      const want: Selection = { kind: 'cells', anchor: [view.first + row, column], head: [view.first + row, column] };
      await selected(page, want).catch(async () => failed(`${label}: a press on cell (${view.first + row}, ${column}) at scroll ${view.scrollX} selected ${JSON.stringify((await shown(page)).shown.selection ?? null)}`));
    }
    await page.keyboard.press('Escape');
    await selected(page, null).catch(() => failed(`${label}: Escape kept the selection`));
    await page.mouse.move(rest.x, rest.y);
    notes.push(`pressed pinned (·, 0) and scrolled (·, ${scrolled})`);
  }

  // The horizontal thumb, its track from the edge: a drag from its middle
  // (grabbed where pressed: the scroll stays), half its travel along; then
  // a press on the track past it (the thumb centred under the pointer).
  const [, trackY, bar, trackHeight] = (await page.evaluate(() => (globalThis as { __seizaTargets?: Record<string, number[]> }).__seizaTargets?.['table-scroll-track'])) ?? [];
  const y = trackY! + trackHeight! + bar! / 2;
  const track = layout.cellsWidth - edge;
  const content = layout.columns.at(-1)!.x + layout.columns.at(-1)!.width - edge;
  const length = Math.min(track, Math.max(24, (track * track) / content));
  const travel = track - length;
  const room = sidewaysRoom(layout);
  // Through the thumb, within a pixel of its travel: what a pointer
  // resolves (the wide shape's is ~51 px of scroll).
  const thumbPx = travel > 0 ? room / travel : 1;
  const scrollTo = async (x: number, what: string, within = 1) => {
    const done = await filledWhere(page, `Math.abs(s.scrollX - ${x}) < ${within}`).catch(() => null);
    if (!done) failed(`${label}: ${what}: the sideways scroll at ${(await shown(page)).shown.scrollX}, not ${x.toFixed(1)} (within ${within.toFixed(1)})`);
    return done?.scrollX ?? NaN;
  };
  await wheel(page, 0, -(room + 1_000));
  await scrollTo(0, 'back to the left');
  const grab = layout.left + edge + length / 2;
  await page.mouse.move(grab, y);
  await page.mouse.down();
  await page.waitForTimeout(50);
  await scrollTo(0, 'a press on the thumb', thumbPx);
  for (let step = 1; step <= DRAG_MOVES; step++) await page.mouse.move(grab + (travel / 2) * (step / DRAG_MOVES), y);
  const dragged = await scrollTo(room / 2, 'a thumb dragged half its travel', thumbPx);
  await page.mouse.up();
  await wheel(page, 0, -(room + 1_000));
  await scrollTo(0, 'back to the left');
  const along = Math.min(Math.max(0.75 * track, length + 4), track - 2);
  const expected = Math.min(Math.max((along - length / 2) / travel, 0), 1) * room;
  await page.mouse.move(layout.left + edge + along, y);
  await page.mouse.down();
  await page.mouse.up();
  const pressed = await scrollTo(expected, `a track press ${along.toFixed(0)} px from the edge`, thumbPx);
  notes.push(`thumb dragged to ${dragged.toFixed(1)} (${(room / 2).toFixed(1)}), track pressed to ${pressed.toFixed(1)} (${expected.toFixed(1)})`);
  await wheel(page, 0, -(room + 1_000));
  await scrollTo(0, 'back to the left');

  // Narrowed past the half: the last pinned column unpins; widened, it pins
  // again.
  const viewport = page.viewportSize()!;
  const lastPinned = layout.columns[want - 1]!;
  const narrowTo = Math.round(viewport.width - (layout.cellsWidth - (2 * edge - lastPinned.width)));
  await page.setViewportSize({ width: narrowTo, height: viewport.height });
  const narrowed = await pinnedAs(page, want - 1).catch(async () => failed(`${label}: at ${narrowTo} px wide, ${(await shown(page)).layout.pinned} pinned (published ${JSON.stringify(await global(page, PINNED_GLOBAL))}), not ${want - 1}`));
  await page.setViewportSize(viewport);
  const widened = await pinnedAs(page, want).catch(() => failed(`${label}: widened again, not ${want} pinned`));
  if (narrowed) notes.push(`${narrowed.pinned} pinned at ${narrowTo} px wide (cells ${narrowed.cellsWidth.toFixed(1)}), ${widened?.pinned} again at ${viewport.width}`);

  // With `resize`: the last pinned column's band dragged wider, the run's
  // edge and the scrolled columns moving with it, nothing unpinned.
  if (resize && widened) {
    const column = want - 1;
    const before = widened.columns[column]!.width;
    const band = bandAt(widened, column, 0);
    await page.mouse.move(band.x, band.y);
    await page.mouse.down();
    for (let step = 1; step <= DRAG_MOVES; step++) await page.mouse.move(band.x + (20 * step) / DRAG_MOVES, band.y);
    await page.mouse.up();
    const after = await laidOutAt(page, column, before + 20).catch(() => failed(`${label}: the pinned column ${column}'s band dragged 20 px didn't widen it`));
    if (after) {
      if (after.pinned !== want) failed(`${label}: ${after.pinned} pinned after the pinned band's drag, not ${want}`);
      if (Math.abs(pinEdge(after) - edge - 20) > 0.01) failed(`${label}: the run's edge at ${pinEdge(after)} after a 20 px drag, from ${edge}`);
      if (Math.abs(after.columns[want]!.x - widened.columns[want]!.x - 20) > 0.01) failed(`${label}: the first scrolled column at ${after.columns[want]!.x}, not moved 20 px`);
      notes.push(`pinned column ${column} dragged ${before} → ${after.columns[column]!.width} px, the edge at ${pinEdge(after).toFixed(1)}`);
    }
  }
  return `, ${notes.join('; ')}`;
}

/** What `checkFormat` read of a screen's formatted cells. */
interface FormatSeen { dressed: Map<number | null, number>; fellBack: number; borderline: number }

/** Whether `cell` is drawn as the base draws it (the automatic format): an
 *  integer's exact text (or cut, with "…"); a float's exact text while it
 *  fits its column's budget, else another float's text, plain or
 *  scientific (`fit_float`), never with a `+` or `,` (or cut). */
function automatic(column: Layout['columns'][number], cell: Cell): boolean {
  if (column.kind !== 'float') return cell.shown === cell.exact || cell.shown.includes('…');
  if (cell.exact.length <= column.budget) return cell.shown === cell.exact;
  return cell.shown !== cell.exact && /^-?[0-9.]+(e-?[0-9]+)?…?$/.test(cell.shown);
}

/** The drawn cells in the host's formats (`hostFormat`): each whose
 *  formatted text's advances fit its content box less a pixel is drawn as
 *  that text, and any other is drawn as the base draws it (`automatic`).
 *  A text within 0.01 px of the edge isn't judged: the table sums f32s.
 *  `onlyColumn` keeps one column's cells. */
function judgeFormat(label: string, cells: Cell[], layout: Layout, adv: Record<string, number>, onlyColumn?: number): FormatSeen {
  const seen: FormatSeen = { dressed: new Map(), fellBack: 0, borderline: 0 };
  const room = (width: number) => width - 2 * paddingAt(14) - 1;
  for (const cell of cells) {
    if (onlyColumn !== undefined && cell.column !== onlyColumn) continue;
    const column = layout.columns[cell.column]!;
    const want = hostFormat(column, cell.row, cell.exact);
    if (!want) continue;
    const over = advancesWidth(want.text, adv) - room(column.width);
    if (Math.abs(over) < 0.01) {
      seen.borderline++;
      continue;
    }
    if (over < 0) {
      if (cell.shown !== want.text) failed(`${label}: ${column.name} row ${cell.row} (${cell.exact}) drawn ${JSON.stringify(cell.shown)}, not ${JSON.stringify(want.text)}`);
      else seen.dressed.set(want.decimals, (seen.dressed.get(want.decimals) ?? 0) + 1);
    } else if (!automatic(column, cell)) {
      failed(`${label}: ${column.name} row ${cell.row} (${cell.exact}) drawn ${JSON.stringify(cell.shown)} at ${column.width} px (budget ${column.budget}), where ${JSON.stringify(want.text)} needs ${(advancesWidth(want.text, adv) + 2 * paddingAt(14) + 1).toFixed(2)}: not the automatic format`);
    } else seen.fellBack++;
  }
  return seen;
}

const describeSeen = (seen: FormatSeen) => [...[...seen.dressed].map(([decimals, count]) => `${count} at ${decimals ?? 'its digits'}`), ...(seen.fellBack ? [`${seen.fellBack} fallen back`] : []), ...(seen.borderline ? [`${seen.borderline} at the edge unjudged`] : [])].join(', ');

/** The first screen against the base build's (`density`'s and `format`'s
 *  controls), which a smoke run of the base build saves beside the tree it
 *  was drawn from: a screen from another tree is refused. */
async function againstBaseScreen(page: Page, label: string, browser: string, shape: Shape): Promise<string> {
  const file = baseScreen(browser, shape);
  const again = `run \`just tall-table build && just tall-table smoke --browsers ${browser}\` first`;
  if (!existsSync(file)) return failed(`${label}: no base screen at ${file}: ${again}`) ?? '';
  const from = existsSync(`${file}.json`) ? readFileSync(`${file}.json`, 'utf8').trim() : null;
  if (from !== fromHere) return failed(`${label}: the base screen was drawn from ${from ?? 'an unknown tree'}, not this one (${fromHere}): ${again}`) ?? '';
  const off = await differingPixels(page, await settledScreen(page), readFileSync(file).toString('base64'), 0);
  if (off) failed(`${label}: ${off} px differ from the base build's first screen`);
  return `, the base's screen${off ? '' : ', pixel for pixel'}`;
}

/** `format`'s checks. On (the host's formats): the drawn cells against the
 *  source's exact values (`judgeFormat`), at the first screen and after a
 *  wheel down, both decimals among them; with `resize`, a float column
 *  narrowed to `FORMAT_NARROW_PX`, its cells judged again from a frame at
 *  that width, some falling back. Off (`?format=off`): every float and
 *  `spkid` cell drawn as the base draws it (`automatic`); on a build with
 *  `format` alone, the first screen the same, pixel for pixel, as the base
 *  build's. */
async function checkFormat(page: Page, label: string, layout: Layout, start: Shown, browser: string, shape: Shape, run: FormatRun): Promise<string> {
  if (run === 'off') {
    const screen = builtFeatures().every((feature) => feature === 'format') ? await againstBaseScreen(page, label, browser, shape) : '';
    const cells = (await drawnCells(page)).filter((cell) => hostFormat(layout.columns[cell.column]!, cell.row, cell.exact));
    const dressed = cells.filter((cell) => !automatic(layout.columns[cell.column]!, cell));
    if (dressed.length) failed(`${label}: ${dressed.length} cells not drawn as the base at ?format=off (${dressed.slice(0, 3).map((cell) => `${cell.exact} as ${cell.shown}`).join(', ')})`);
    if (!cells.length) failed(`${label}: no float or spkid cell drawn`);
    return `, ${cells.length} float and spkid cells as the base draws them${screen}`;
  }
  const adv = await advances(page);
  const first = judgeFormat(label, await drawnCells(page), layout, adv);
  await page.mouse.move(layout.left + 200, layout.top + 200);
  await wheel(page, 40 * layout.rowHeight);
  const down = await filledWhere(page, `s.first >= ${start.first + 30}`);
  const after = judgeFormat(label, await drawnCells(page, { first: down.first }), layout, adv);
  for (const decimals of shape === 'narrow' ? [2, 3, null] : [2, 3]) {
    if (!first.dressed.get(decimals) && !after.dressed.get(decimals)) failed(`${label}: no cell drawn formatted at ${decimals ?? 'spkid\'s digits'}`);
  }
  let narrowed = '';
  if (resize) {
    // The first float column right of the pinned run, narrowed from the
    // view's top.
    const column = layout.columns.findIndex((column, index) => column.kind === 'float' && index >= (layout.pinned ?? 0));
    const was = layout.columns[column]!.width;
    await page.keyboard.press('Home');
    await filledWhere(page, 's.first === 0 && s.scrollX === 0');
    await dragBand(page, layout, column, 0, FORMAT_NARROW_PX - was, async () => {});
    const laid = await laidOutAt(page, column, FORMAT_NARROW_PX).catch(() => null);
    if (!laid) return failed(`${label}: column ${column} isn't ${FORMAT_NARROW_PX} px after a drag`) ?? '';
    const seen = judgeFormat(label, await drawnCells(page, { column: { index: column, width: FORMAT_NARROW_PX } }), laid, adv, column);
    if (!seen.fellBack) failed(`${label}: no cell of ${laid.columns[column]!.name} fell back at ${FORMAT_NARROW_PX} px`);
    narrowed = `; ${laid.columns[column]!.name} ${was} → ${FORMAT_NARROW_PX} px: ${describeSeen(seen)}`;
  }
  return `, formatted ${describeSeen(first)}; down ${down.first}–${down.end}: ${describeSeen(after)}${narrowed}`;
}

/** `formatNumber` against `fixtures/cells.json`'s `format` cases, and the
 *  fit by their advances: the smoke check's own formatter first proved on
 *  the table's fixture. It skips only what it doesn't write by design: a
 *  float without fixed decimals (JS and Rust write the shortest text
 *  apart), NULL, NaN, and the infinities; a `null` for any other case
 *  fails. */
function checkFormatter(): string {
  const fixture = JSON.parse(readFileSync(join(perfDir, '../fixtures/cells.json'), 'utf8')) as { format: { advances: Record<string, number>; cases: { format: NumberFormat; kind: string; value: string | null; decimals: number | null; width: number; shown: string; fallback: boolean; why: string }[] } };
  const { advances: adv, cases } = fixture.format;
  let checked = 0;
  for (const test of cases) {
    const decimals = test.decimals ?? test.format.decimals;
    const text = formatNumber(test.kind, test.value, test.format, decimals);
    if (text === null) {
      const float = test.kind === 'float' || test.kind === 'float32';
      const skipped = test.value === null || (float && (decimals === null || !Number.isFinite(Number(test.value))));
      if (!skipped) failed(`the smoke check's formatter writes nothing for ${test.kind} ${test.value} (${test.why})`);
      continue;
    }
    checked++;
    let fits: boolean;
    try {
      fits = advancesWidth(text, adv) <= test.width - 2 * paddingAt(14) - 1;
    } catch (error) {
      failed(`cells.json's format advances: ${(error as Error).message}`);
      continue;
    }
    if (fits === test.fallback) failed(`the smoke check's fit of ${JSON.stringify(text)} at ${test.width} px: ${fits ? 'fits' : 'falls back'}, the fixture's ${test.fallback ? 'falls back' : 'fits'} (${test.why})`);
    if (!test.fallback && text !== test.shown) failed(`the smoke check's format of ${test.kind} ${test.value}: ${JSON.stringify(text)}, the fixture's ${JSON.stringify(test.shown)} (${test.why})`);
  }
  return `${checked} of ${cases.length} cases`;
}

/** The screen (or `clip` of it) once two shots `SETTLE_MS` apart agree
 *  (Firefox's can show the frame before the one the probe reports), at
 *  most `SETTLE_TRIES`. */
async function settledScreen(page: Page, clip?: { x: number; y: number; width: number; height: number }): Promise<string> {
  const viewport = page.viewportSize()!;
  clip ??= { x: 0, y: 0, width: viewport.width, height: viewport.height };
  let last = await screenshot(page, clip);
  for (let tries = 0; tries < SETTLE_TRIES; tries++) {
    await page.waitForTimeout(SETTLE_MS);
    const now = await screenshot(page, clip);
    if (now === last) return now;
    last = now;
  }
  return last;
}
const SETTLE_MS = 150;
const SETTLE_TRIES = 8;

/** `density`'s checks. At the default (`dense`): the probe's row and float
 *  widths; the stripes and borders at the row; the text's ink inside its
 *  row and its cell's padding; the hook to 30 px rows and 14 px text and
 *  back keeping the top row. At `?density=30,14` (`control`): the first screen
 *  as the base build's. */
async function checkDensity(page: Page, label: string, layout: Layout, start: Shown, browser: string, shape: Shape, run: DensityRun): Promise<string> {
  if (run === 'control') {
    if (layout.rowHeight !== 30) failed(`${label}: rows ${layout.rowHeight} px at ?density=30,14`);
    return againstBaseScreen(page, label, browser, shape);
  }
  const { row, text, width } = DEFAULT_DENSITY;
  const pad = paddingAt(text);
  if (layout.rowHeight !== row) failed(`${label}: rows ${layout.rowHeight} px, not ${row}`);
  const floats = layout.columns.filter((column) => column.kind === 'float');
  const unset = floats.filter((column) => column.width !== width);
  if (unset.length) failed(`${label}: float columns ${unset.map((column) => `${column.name} ${column.width}`).join(', ')} px wide, not ${width}`);

  // The rows: rows 1 to `ROWS_SAMPLED` (row 0's top is the header's
  // border), each one's middle in the first column's padding against the
  // next one's (the stripes alternate) and its last pixel (its border).
  const x = layout.left + 2;
  const mids: number[][] = [];
  const borders: number[][] = [];
  for (let at = 1; at <= ROWS_SAMPLED; at++) {
    const top = layout.top + (at - start.top) * layout.rowHeight;
    mids.push(await pixel(page, x, top + layout.rowHeight / 2));
    borders.push(await pixel(page, x, top + layout.rowHeight - 1));
  }
  const off = (a: number[], b: number[]) => Math.max(...a.slice(0, 3).map((channel, index) => Math.abs(channel - b[index]!)));
  const stripes = mids.every((mid, index) => index < 2 || off(mid, mids[index - 2]!) <= FILL_STEPS) && mids.slice(1).every((mid, index) => off(mid, mids[index]!) > 0);
  if (!stripes) failed(`${label}: the rows' middles at ${row} px don't alternate (${mids.map((seen) => seen.slice(0, 3).join(',')).join(' ')})`);
  const bordered = borders.every((border, index) => off(border, mids[index]!) > 0);
  if (!bordered) failed(`${label}: no border at each ${row} px row's last pixel (${borders.map((seen) => seen.slice(0, 3).join(',')).join(' ')})`);

  // The text: the same rows' ink, from the first column's padding to the
  // last column wholly in view.
  const last = layout.columns.findLast((column) => column.x + column.width <= layout.cellsWidth)!;
  const clip = { x: layout.left + 1, y: layout.top + (1 - start.top) * layout.rowHeight, width: last.x + last.width - 1, height: ROWS_SAMPLED * layout.rowHeight };
  const ink = await inkIn(page, clip);
  const across = runsOf(ink.y, ink.scale, clip.y).filter(([from, to]) => Math.floor((from - clip.y) / row) !== Math.floor((to - clip.y - 1 / ink.scale) / row));
  if (across.length) failed(`${label}: ink across a row's edge at y ${across.map(([from, to]) => `${from.toFixed(1)}–${to.toFixed(1)}`).join(', ')}`);
  // With `pin`, the edge line is ink between two columns.
  const edge = layout.left + pinEdge(layout);
  const inside = (from: number, to: number) => (pin && (layout.pinned ?? 0) > 0 && from >= edge - INK_SLACK_PX && to <= edge + INK_SLACK_PX) || layout.columns.some((column) => from >= layout.left + column.x + pad - INK_SLACK_PX && to <= layout.left + column.x + column.width - pad + INK_SLACK_PX);
  const outside = runsOf(ink.x, ink.scale, clip.x).filter(([from, to]) => !inside(from, to));
  if (outside.length) failed(`${label}: ink outside the cells' ${pad} px padding at x ${outside.map(([from, to]) => `${from.toFixed(1)}–${to.toFixed(1)}`).join(', ')}`);
  const inked = layout.columns.filter((column) => ink.x.some((mark, index) => mark && clip.x + index / ink.scale >= layout.left + column.x && clip.x + index / ink.scale < layout.left + column.x + column.width)).length;
  if (inked < 2) failed(`${label}: ink in ${inked} columns`);

  // The hook, scrolled down: to 30 px rows and 14 px text (the floats'
  // set width kept) and back, the top row kept. From a rest: the wheel's
  // queued events done.
  await page.mouse.move(layout.left + 200, layout.top + 200);
  await wheel(page, 40 * layout.rowHeight);
  const rested = await restedWhere(page, `s.first >= ${start.first + 30}`);
  if (!rested) return failed(`${label}: no rest after a wheel down`) ?? '';
  const kept = async (at: number) =>
    filledWhere(page, `Math.abs(s.top - ${rested.top}) < 1e-6`, 5_000).catch(async () => failed(`${label}: the top ${(await shown(page)).shown.top} at ${at} px rows, not ${rested.top} as before`));
  const based = await densityThrough(page, 30, 14);
  await kept(based.rowHeight);
  const back = await densityThrough(page, row, text);
  await kept(back.rowHeight);
  return `, rows ${row} px, floats ${width} px, ink in ${inked} columns inside ${pad} px padding, top ${rested.top.toFixed(2)} kept at 30 and ${row} px rows`;
}
/** Rows `checkDensity` samples, from row 1. */
const ROWS_SAMPLED = 6;
/** A header drag (`reorder`): the pointer to `from`, pressed, moved to
 *  `toX` in `DRAG_MOVES` steps, given a few frames (the release takes the
 *  gap the last frame drew), and released. */
async function dragHeader(page: Page, from: { x: number; y: number }, toX: number): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.waitForTimeout(50);
  await page.mouse.down({ clickCount: 1 });
  for (let step = 1; step <= DRAG_MOVES; step++) await page.mouse.move(from.x + ((toX - from.x) * step) / DRAG_MOVES, from.y);
  await page.waitForTimeout(150);
  await page.mouse.up({ clickCount: 1 });
}

/** The cells the last frame drew are the source's at their column's index
 *  (`order[place]`), polled up to 5 s (the cells published may be a frame
 *  behind the layout); a note, or `null` after a failure. */
async function cellsInOrder(page: Page, label: string, what: string, order: number[]): Promise<string | null> {
  let wrong = '';
  for (let waited = 0; waited < 5_000; waited += 50) {
    const cells = await drawnCells(page);
    const exact = await exactTexts(page, cells.map((cell) => [cell.row, order[cell.column]!]));
    const at = cells.findIndex((cell, index) => cell.exact !== (exact[index] ?? 'NULL'));
    if (cells.length && at < 0) return `${cells.length} cells`;
    wrong = at < 0 ? 'no cells drawn' : `place ${cells[at]!.column} (column ${order[cells[at]!.column]}), row ${cells[at]!.row} drew ${JSON.stringify(cells[at]!.exact)}, the source holds ${JSON.stringify(exact[at])}`;
    await page.waitForTimeout(50);
  }
  return failed(`${label}: ${what}: ${wrong}`);
}

/** Each place's header name is its column's (`names` in index order, as
 *  the list's own order draws them); each place's index is checked by
 *  `orderedAs`. */
function namesInOrder(label: string, what: string, layout: Layout, names: string[]): void {
  const at = layout.columns.findIndex((column, place) => column.name !== names[column.index ?? place]);
  if (at >= 0) failed(`${label}: ${what}: place ${at} named ${JSON.stringify(layout.columns[at]!.name)}, its column ${layout.columns[at]!.index} is ${JSON.stringify(names[layout.columns[at]!.index!])}`);
}

/** The run `pin` keeps in effect for a count: cut at half the cells'
 *  width (`src/pin.rs`'s `in_effect`, its 0.001 px slack). */
function pinInEffect(layout: Layout, count: number): number {
  let run = Math.min(count, layout.columns.length);
  while (run > 0 && layout.columns[run - 1]!.x + layout.columns[run - 1]!.width > layout.cellsWidth / 2 + 0.001) run--;
  return run;
}

/** `reorder`: at `?order=reverse`, the first screen drawn reversed against
 *  the source, then the list's own through the hook. Otherwise a header
 *  dragged two places right and back, the published order and the layout
 *  probe agreeing and the drawn cells the source's at each place's column;
 *  with `sort`, all of it sorted (the order kept); with `select`, the
 *  column selected first and still selected at its new place, then a
 *  two-column range dragged; with `copy`, a block copied after the move,
 *  pasted back in drawn order; with `pin`, a column dragged into the run
 *  and out, the published count following. */
async function checkReorder(page: Page, label: string, start: Layout, run: ReorderRun): Promise<string> {
  const notes: string[] = [];
  const selects = selectOn();
  const own = start.columns.map((_, place) => place);
  if (run === 'reverse') {
    const reversed = [...own].reverse();
    const layout = await orderedAs(page, reversed).catch(async () => failed(`${label}: opened at ${JSON.stringify(start.columns.map((column) => column.index))} (published ${JSON.stringify(await global(page, COLUMN_ORDER_GLOBAL))}), not reversed`));
    if (!layout) return '';
    const drawn = await cellsInOrder(page, label, 'reversed at open', reversed);
    const back = await orderThrough(page, own).catch(() => failed(`${label}: the list's own order through the hook not drawn`));
    if (!back) return '';
    // The list's own names, each at its place: the reversed screen's
    // headers checked against them.
    namesInOrder(label, 'reversed at open', layout, back.columns.map((column) => column.name));
    const ownDrawn = await cellsInOrder(page, label, "the list's own", own);
    if (drawn && ownDrawn) notes.push(`reversed at open (${drawn}), then the list's own (${ownDrawn})`);
    return notes.length ? `, ${notes.join('; ')}` : '';
  }

  const names = start.columns.map((column) => column.name);
  const pinned = start.pinned ?? 0;
  // The first scrolled column but one: the one left of it stays scrolled.
  const column = pinned + 1;
  const sorted: Sort | null = sort ? { column, direction: 'descending' } : null;
  if (sorted && !(await sortThrough(page, sorted).catch(() => failed(`${label}: not sorted ${JSON.stringify(sorted)}`)))) return '';
  const view = () => shown(page).then(({ shown }) => shown);
  /** Drags the column (or the selected range) at `place` so the gap is
   *  after `after`, then waits for `want`. */
  const drag = async (what: string, layout: Layout, place: number, after: number, want: number[]): Promise<Layout | null> => {
    const scrollX = (await view()).scrollX;
    await dragHeader(page, moveGripAt(layout, place, scrollX), gapAfterX(layout, after, scrollX));
    const moved = await orderedAs(page, want).catch(async () => failed(`${label}: ${what}: from ${JSON.stringify(moveGripAt(layout, place, scrollX))} to ${gapAfterX(layout, after, scrollX)}, selection ${JSON.stringify((await view()).selection)}: the order ${JSON.stringify((await shown(page)).layout.columns.map((column) => column.index))} (published ${JSON.stringify(await global(page, COLUMN_ORDER_GLOBAL))}), not ${JSON.stringify(want)}`));
    if (moved) namesInOrder(label, what, moved, names);
    return moved;
  };
  const columnsAt = (from: number, to = from): Selection => ({ kind: 'columns', anchor: [0, from], head: [0, to] });
  /** A press that selects the column at `place` (`SELECT_OFFSET_PX`). */
  const selectHeader = async (layout: Layout, place: number, shift = false) => {
    const grip = moveGripAt(layout, place, (await view()).scrollX);
    await pressAt(page, { ...grip, x: grip.x + SELECT_OFFSET_PX }, shift);
  };

  // Two places right: with `select`, selected first, so the press drags it.
  if (selects) {
    await selectHeader(start, column);
    await selected(page, columnsAt(column)).catch(() => failed(`${label}: a press on column ${column}'s header didn't select it`));
  }
  const right = movedOrder(own, column, column + 1, column + 2);
  const moved = await drag('two places right', start, column, column + 2, right);
  if (!moved) return '';
  const rightDrawn = await cellsInOrder(page, label, 'two places right', right);
  if (selects) await selected(page, columnsAt(column + 2)).catch(async () => failed(`${label}: two places right: selected ${JSON.stringify((await view()).selection ?? null)}, not column ${column}'s new place`));
  if (sorted) await sortedAs(page, sorted, 5_000).catch(async () => failed(`${label}: two places right: sorted ${JSON.stringify((await view()).sort ?? null)}, not ${JSON.stringify(sorted)}`));
  if (rightDrawn) notes.push(`column ${column} two places right (${rightDrawn}${sorted ? ', sorted' : ''})`);

  // A block copied in drawn order: the columns at places column..column+2.
  if (copy) {
    const block: Selection = { kind: 'cells', anchor: [1, column], head: [3, column + 2] };
    await selectThrough(page, block);
    const state = await copyByKey(page);
    if (state.state !== 'written') failed(`${label}: a block after the move: ${JSON.stringify(state)}, not written`);
    else {
      const lines = parseTsv(await paste(page));
      const places = [column, column + 1, column + 2];
      const cells = [1, 2, 3].flatMap((row) => places.map((place) => [row, right[place]!] as [number, number]));
      const exact = await exactTexts(page, cells);
      const at = cells.findIndex(([row], index) => lines[row - 1]?.[index % 3] !== (exact[index] ?? ''));
      if (lines.length !== 3 || at >= 0) failed(`${label}: a block after the move pasted ${JSON.stringify(lines)}, the source's in drawn order ${JSON.stringify(exact)}`);
      else notes.push(`a block copied in drawn order (columns ${places.map((place) => right[place]).join(', ')})`);
    }
    await selectThrough(page, columnsAt(column + 2));
  }

  // And back: the gap after the place left of where it started.
  const back = await drag('back', moved, column + 2, column - 1, own);
  if (!back) return '';
  const backDrawn = await cellsInOrder(page, label, 'back', own);
  if (selects) await selected(page, columnsAt(column)).catch(async () => failed(`${label}: back: selected ${JSON.stringify((await view()).selection ?? null)}, not column ${column}'s place`));
  if (sorted) await sortedAs(page, sorted, 5_000).catch(async () => failed(`${label}: back: sorted ${JSON.stringify((await view()).sort ?? null)}, not ${JSON.stringify(sorted)}`));
  if (backDrawn) notes.push(`and back (${backDrawn})`);

  // With `select`, a two-column range two places right, still selected.
  if (selects) {
    await selectHeader(back, column + 1, true);
    await selected(page, columnsAt(column, column + 1)).catch(() => failed(`${label}: a Shift+press on column ${column + 1}'s header didn't select columns ${column}–${column + 1}`));
    const pair = movedOrder(own, column, column + 2, column + 2);
    const pairMoved = await drag('a two-column range', back, column, column + 3, pair);
    if (pairMoved) {
      await selected(page, columnsAt(column + 2, column + 3)).catch(async () => failed(`${label}: a two-column range: selected ${JSON.stringify((await view()).selection ?? null)} after the move`));
      const drawn = await cellsInOrder(page, label, 'a two-column range', pair);
      if (drawn) notes.push(`columns ${column}–${column + 1} dragged as a range (${drawn})`);
    }
    await orderThrough(page, own).catch(() => failed(`${label}: the list's own order through the hook not drawn`));
    await selected(page, null).catch(() => failed(`${label}: set_order kept a Columns selection`));
  }

  // With `pin`, into the run (the gap after place 0) and out again.
  if (pin && pinned) {
    let layout = (await shown(page)).layout;
    if (selects) {
      await selectHeader(layout, column);
      await selected(page, columnsAt(column)).catch(() => failed(`${label}: a press on column ${column}'s header didn't select it`));
    }
    const into = movedOrder(own, column, column + 1, 1);
    const pinnedIn = await drag('into the run', layout, column, 0, into);
    if (pinnedIn) {
      const inEffect = pinInEffect(pinnedIn, pinned + 1);
      layout = (await pinnedAs(page, inEffect).catch(async () => failed(`${label}: into the run: ${JSON.stringify(await global(page, PINNED_GLOBAL))} pinned, not ${inEffect}`))) ?? pinnedIn;
      // Out: the gap after the run's last column but the one moved in,
      // right of the edge (the count back to `pinned`).
      const out = await drag('out of the run', layout, 1, pinned + 1, own);
      if (out) {
        const outPinned = await pinnedAs(page, pinInEffect(out, pinned)).catch(async () => failed(`${label}: out of the run: ${JSON.stringify(await global(page, PINNED_GLOBAL))} pinned, not ${pinned}`));
        const drawn = await cellsInOrder(page, label, 'out of the run', own);
        if (outPinned && drawn) notes.push(`column ${column} pinned (${inEffect} in effect) and unpinned (${pinned}) by drags (${drawn})`);
      }
    }
  }
  if (selects) {
    await page.keyboard.press('Escape');
    await selected(page, null).catch(() => failed(`${label}: Escape kept the selection`));
  }
  if (sorted) await sortThrough(page, null).catch(() => failed(`${label}: the sort not undone`));
  return notes.length ? `, ${notes.join('; ')}` : '';
}

/** The group cells on screen against the probe's, one row at a time
 *  (polled up to 1 s: Firefox's screenshot can be a frame behind): in each
 *  group row, every closed cell's right border has ink, every cell wide
 *  enough for one has its label's ink starting at its `labelX`, and no ink
 *  lies elsewhere but at `pin`'s edge line. A note, or `null` after a
 *  failure. */
async function groupsOnScreen(page: Page, label: string, what: string, layout: Layout, cells: GroupCell[]): Promise<string | null> {
  const depth = (layout.headerRows ?? 1) - 1;
  const edge = pinEdge(layout);
  // Within 1.5 px: GPUI snaps lines to device pixels.
  const near = (a: number, b: number) => Math.abs(a - b) <= 1.5;
  let wrong = '';
  for (let waited = 0; waited <= 1_000; waited += 100) {
    wrong = '';
    let checked = 0;
    for (let level = 0; level < depth && !wrong; level++) {
      const row = cells.filter((cell) => cell.level === level);
      // The row's middle, short of its bottom border.
      const top = layout.top - layout.rowHeight * (depth + 1 - level);
      const clip = { x: layout.left, y: top + 2, width: layout.cellsWidth, height: layout.rowHeight - 4 };
      const ink = await inkIn(page, clip, 16);
      const runs = runsOf(ink.x, ink.scale, 0);
      for (const cell of row) {
        const right = cell.left + cell.width;
        const closed = cell.pinned ? right < edge - 1 : right < layout.cellsWidth - 1;
        if (closed && !runs.some(([from, to]) => near(from, right - 1) || near(to, right))) wrong ||= `${cell.label}'s right border at ${right.toFixed(1)} px has no ink (level ${level}: ${JSON.stringify(runs.map(([a, b]) => [+a.toFixed(1), +b.toFixed(1)]))})`;
        if (cell.width > 40 && !runs.some(([from]) => from >= cell.labelX - 1.5 && from <= cell.labelX + 4)) wrong ||= `${cell.label}'s label at ${cell.labelX.toFixed(1)} px has no ink there (level ${level})`;
        checked++;
      }
      const explained = ([from, to]: [number, number]) =>
        (edge > 0 && near(from, edge - 1)) || row.some((cell) => near(to, cell.left + cell.width) || (from >= cell.labelX - 1.5 && to <= cell.left + cell.width + 0.5));
      const stray = runs.find((run) => !explained(run));
      if (stray) wrong ||= `ink at ${stray[0].toFixed(1)}–${stray[1].toFixed(1)} px in level ${level}'s row that no group cell draws`;
    }
    if (!wrong) return `${checked} cells on screen`;
    await page.waitForTimeout(100);
  }
  return failed(`${label}: ${what}: ${wrong}`);
}

/** With `group-headers`, at the host's groups: the header's rows, and the
 *  group cells published against the runs of the columns' paths and the
 *  layout (each cut to its region's visible part) and on screen, at open
 *  (with `pin`, the host's run splitting the first group) and after a
 *  sideways scroll; with `clicks`, a press on each half of a run split at
 *  the edge published as a `group` with the whole run's level and places.
 *  Then with nothing pinned: with `select`, a group's press selecting its
 *  columns and a Shift+press on another group extending to its far edge;
 *  with `clicks`, those presses published; with `reorder`, the second
 *  inner group dragged before the first, the order, the groups drawn whole
 *  in it, (with `select`) the selection moved with the group, then the
 *  list's own order through the hook. */
async function checkGroups(page: Page, label: string, opened: Layout, shape: Shape): Promise<string> {
  const notes: string[] = [];
  const view = () => shown(page).then(({ shown }) => shown);
  const pathsIn = (layout: Layout) => layout.columns.map((column, place) => hostPath(shape, column.index ?? place));
  const depth = 2;
  if (opened.headerRows !== depth + 1) failed(`${label}: ${opened.headerRows} header rows, not ${depth + 1}`);
  /** The probe and the screen at `layout` as it is now. */
  const drawnAs = async (what: string, layout: Layout): Promise<boolean> => {
    // Off the header, so nothing hovered is drawn over it.
    await page.mouse.move(layout.left + 200, layout.top + 200);
    const want = groupCellsOf(layout, (await view()).scrollX, groupRuns(pathsIn(layout)));
    const { ok, cells } = await groupsAs(page, want);
    if (!ok) {
      failed(`${label}: ${what}: the groups published ${JSON.stringify(cells.map(({ level, label, start, end, pinned, left, width }) => [level, label, start, end, pinned, +left.toFixed(2), +width.toFixed(2)]))}, the runs drawn ${JSON.stringify(want.map(({ level, label, start, end, pinned, left, width }) => [level, label, start, end, pinned, +left.toFixed(2), +width.toFixed(2)]))}`);
      return false;
    }
    const screen = await groupsOnScreen(page, label, what, layout, cells);
    if (screen) notes.push(`${what}: ${cells.length} group cells (${screen})`);
    return screen !== null;
  };
  /** A point inside `cell`, `into` px right of its visible left. */
  const inside = (layout: Layout, cell: GroupCell, into = 0.5) => ({
    x: layout.left + cell.left + Math.min(cell.width - 4, Math.max(4, cell.width * into)),
    y: layout.top - layout.rowHeight * (depth + 1 - cell.level) + layout.rowHeight / 2,
  });
  const cellsNow = async () => (await global<GroupCell[]>(page, GROUPS_GLOBAL)) ?? [];
  /** A press at `at` published as `cell`'s run's group (`clicks`). */
  const pressedAs = async (what: string, at: { x: number; y: number }, cell: GroupCell, shift = false) => {
    const before = clicks ? await clickCount(page) : 0;
    await pressAt(page, at, shift);
    if (!clicks) return;
    const click = await clickAfter(page, before);
    if (!click || click.target !== 'group' || click.level !== cell.level || click.start !== cell.start || click.end !== cell.end) failed(`${label}: ${what}: published ${JSON.stringify(click)}, not group ${cell.label} (level ${cell.level}, ${cell.start}..${cell.end})`);
  };

  // At open (with `pin`, the host's run cutting the first inner group).
  let layout = opened;
  await drawnAs('at open', layout);
  const split = (await cellsNow()).filter((cell, _, all) => all.some((other) => other !== cell && other.level === cell.level && other.start === cell.start));
  if (pin && (layout.pinned ?? 0) && !split.length) failed(`${label}: the host's pin (${layout.pinned}) cuts no group's cell in two`);
  if (clicks && split.length) {
    for (const half of split) await pressedAs(`the ${half.pinned ? 'pinned' : 'scrolled'} half of ${half.label}`, inside(layout, half), half);
    notes.push(`${split.map((half) => `${half.label}'s ${half.pinned ? 'pinned' : 'scrolled'} half`).join(', ')} pressed as the whole run`);
  }
  // Sideways, where there's room: the cells cut at the view's left.
  if (sidewaysRoom(layout) > 0) {
    await page.mouse.move(layout.left + 200, layout.top + 200);
    await wheel(page, 0, Math.min(400.3, sidewaysRoom(layout)));
    await filledWhere(page, 's.scrollX > 0');
    await drawnAs('scrolled sideways', layout);
    await page.mouse.move(layout.left + 200, layout.top + 200);
    await wheel(page, 0, -10_000);
    await filledWhere(page, 's.scrollX === 0');
  }

  // Nothing pinned, so no group is split, for the presses and the drag.
  if (pin && (layout.pinned ?? 0)) layout = await pinThrough(page, 0);
  const own = layout.columns.map((_, place) => place);
  const [, inner] = HOST_GROUPS[shape];
  const selects = selectOn();
  const at = async (level: number, start: number) => (await cellsNow()).find((cell) => cell.level === level && cell.start === start);
  const columnsAt = (from: number, to: number): Selection => ({ kind: 'columns', anchor: [0, from], head: [0, to] });

  // A press on the second inner group: its columns (`select`).
  const second = await at(1, inner);
  if (!second) return failed(`${label}: no cell of the second inner group (from place ${inner})`) ?? '';
  await pressedAs(`a press on ${second.label}`, inside(layout, second), second);
  if (selects) {
    const ok = await selected(page, columnsAt(second.start, second.end - 1)).catch(async () => failed(`${label}: a press on ${second.label}: selected ${JSON.stringify((await view()).selection ?? null)}, not columns ${second.start}–${second.end - 1}`));
    // Shift on the first outer group, from the anchor: its edge farther
    // from it.
    const outer = await at(0, 0);
    if (ok && outer) {
      const far = second.start - outer.start > outer.end - 1 - second.start ? outer.start : outer.end - 1;
      await page.waitForTimeout(500);
      await pressedAs(`a Shift+press on ${outer.label}`, inside(layout, outer, 0.1), outer, true);
      const extended = await selected(page, columnsAt(second.start, far)).catch(async () => failed(`${label}: a Shift+press on ${outer.label}: selected ${JSON.stringify((await view()).selection ?? null)}, not columns ${second.start} to ${far}`));
      if (extended) notes.push(`${second.label} pressed (its columns selected), then Shift+${outer.label} (to its far edge)`);
    }
  } else notes.push(`${second.label} pressed`);

  // Its drag before the first inner group (`reorder`).
  if (reorder) {
    const first = await at(1, 0);
    if (!first) return failed(`${label}: no cell of the first inner group`) ?? '';
    await page.waitForTimeout(500);
    const from = inside(layout, second, 0.3);
    await dragHeader(page, from, layout.left + first.left + 4);
    const want = movedOrder(own, second.start, second.end, 0);
    const moved = await orderedAs(page, want).catch(async () => failed(`${label}: ${second.label} dragged before ${first.label}: the order ${JSON.stringify((await shown(page)).layout.columns.map((column) => column.index))}, not ${JSON.stringify(want)}`));
    if (moved) {
      layout = moved;
      if (selects) {
        await selected(page, columnsAt(0, second.end - second.start - 1)).catch(async () => failed(`${label}: ${second.label} moved: selected ${JSON.stringify((await view()).selection ?? null)}, not its new places`));
        // No tint over the cells read on screen.
        await page.keyboard.press('Escape');
        await selected(page, null).catch(() => failed(`${label}: Escape kept the selection`));
      }
      const whole = await drawnAs(`${second.label} moved before ${first.label}`, moved);
      const drawn = await cellsInOrder(page, label, `${second.label} moved`, want);
      if (whole && drawn) notes.push(`${second.label} dragged before ${first.label}, every group whole (${drawn})`);
      layout = await orderThrough(page, own);
    }
  }
  return notes.length ? `, ${notes.join('; ')}` : '';
}

/** With `clicks`: each `pointerdown` the page saw (its button, Ctrl, and
 *  type) and each `contextmenu` (and whether it came prevented, read in
 *  the window's bubble phase, after gpui-pre-web's canvas listener). */
function recordPointers(): void {
  const g = globalThis as unknown as { __smokePointers: { button: number; ctrl: boolean; type: string }[]; __smokeMenus: { seen: number; prevented: number } };
  g.__smokePointers = [];
  g.__smokeMenus = { seen: 0, prevented: 0 };
  addEventListener('pointerdown', (event) => g.__smokePointers.push({ button: event.button, ctrl: event.ctrlKey, type: event.pointerType }), true);
  addEventListener('contextmenu', (event) => {
    g.__smokeMenus.seen++;
    if (event.defaultPrevented) g.__smokeMenus.prevented++;
  });
}
type Pointers = { button: number; ctrl: boolean; type: string }[];
const pointersSeen = (page: Page) => page.evaluate(() => (globalThis as unknown as { __smokePointers: Pointers }).__smokePointers.slice());
const menusSeen = (page: Page) => page.evaluate(() => ({ ...(globalThis as unknown as { __smokeMenus: { seen: number; prevented: number } }).__smokeMenus }));

/** The widest the clicks run makes the view for a blank past the last
 *  column. */
const BLANK_VIEW_PX = 3_000;
/** Past gpui-pre-web's double-click window (400 ms, timed at handling). */
const APART_MS = 500;
/** How long a press that reports nothing is waited on. */
const QUIET_MS = 400;
/** A long press held this long: gpui-pre's is 500 ms. */
const LONG_PRESS_MS = 800;

/** With `clicks`: each kind on each target, published at the pointer
 *  with the layout's row and place; the same target pressed twice
 *  reported twice; a right press's `contextmenu` prevented; Ctrl+click a
 *  `Press` with Ctrl, then a `Context` with the host's setting on (and
 *  what the page's `pointerdown` said of it); a right press during a left
 *  drag reporting nothing and leaving the drag whole (with `select`, its
 *  range); with `select`, a context press inside a block keeping it and
 *  outside selecting its cell; in Chromium, a long press by touch. */
async function checkClicks(page: Page, label: string, opened: Layout, opening: Shown, chromiumPage: boolean): Promise<string> {
  const notes: string[] = [];
  // Room past the last column for a blank: the view widened where the
  // content ends within reach (the narrow shape), else none.
  let [layout, start] = [opened, opening];
  const ends = (laid: Layout) => laid.left + laid.columns.at(-1)!.x + laid.columns.at(-1)!.width;
  const viewport = page.viewportSize()!;
  const width = Math.ceil(viewport.width + ends(layout) - (layout.left + layout.cellsWidth) + 160);
  if (ends(layout) + 30 > layout.left + layout.cellsWidth && width <= BLANK_VIEW_PX) {
    await page.setViewportSize({ width, height: viewport.height });
    const wide = await page.waitForFunction((cells) => ((globalThis as { __tallTableLayout?: Layout }).__tallTableLayout?.cellsWidth ?? 0) > cells + 100, layout.cellsWidth, { timeout: 10_000, polling: 10 }).catch(() => null);
    if (!wide) failed(`${label}: the view widened to ${width} px didn't lay out wider`);
    ({ shown: start, layout } = await filledWhere(page, 's.first === 0').then(() => shown(page)));
    notes.push(`the view widened to ${width} px`);
  }
  const selects = selectOn();
  type Want = Pick<Click, 'target' | 'row' | 'column'>;
  const press = async (at: { x: number; y: number }, { button = 'left' as 'left' | 'right', ctrl = false, move = true } = {}) => {
    if (move) {
      await page.mouse.move(at.x, at.y);
      await page.waitForTimeout(50);
    }
    if (ctrl) await page.keyboard.down('Control');
    await page.mouse.down({ button, clickCount: 1 });
    await page.mouse.up({ button, clickCount: 1 });
    if (ctrl) await page.keyboard.up('Control');
  };
  /** The next report after `count`, checked against `kind`, `want`, the
   *  pointer, and the modifiers. */
  const expect = async (what: string, count: number, kind: Click['kind'], want: Want, at: { x: number; y: number }, modifiers: Click['modifiers'] = []): Promise<Click | null> => {
    const click = await clickAfter(page, count);
    if (!click) return failed(`${label}: ${what}: nothing reported`);
    const off = Math.max(Math.abs(click.x - at.x), Math.abs(click.y - at.y));
    if (click.count !== count + 1 || click.kind !== kind || click.target !== want.target || click.row !== want.row || click.column !== want.column || off > 1 || JSON.stringify(click.modifiers) !== JSON.stringify(modifiers))
      return failed(`${label}: ${what}: reported ${JSON.stringify(click)}, not ${kind} on ${JSON.stringify(want)} at (${at.x.toFixed(1)}, ${at.y.toFixed(1)}) with ${JSON.stringify(modifiers)}, count ${count + 1}`);
    return click;
  };
  /** Nothing reported after `count` for `QUIET_MS`. */
  const quiet = async (what: string, count: number): Promise<boolean> => {
    const click = await clickAfter(page, count, QUIET_MS);
    if (click) failed(`${label}: ${what}: reported ${JSON.stringify(click)}`);
    return !click;
  };

  // The targets: a cell, a row's number, a header, the corner, and where
  // the content ends left of the view's right edge, a blank past the last
  // column in the body and in the header.
  const view = start;
  const targets: { name: string; at: { x: number; y: number }; want: Want }[] = [
    { name: 'a cell', at: cellAt(layout, view, view.first + 3, 2), want: { target: 'cell', row: view.first + 3, column: 2 } },
    { name: "a row's number", at: gutterAt(layout, view, view.first + 4), want: { target: 'row', row: view.first + 4, column: null } },
    { name: 'a header', at: headerAt(layout, view, 1), want: { target: 'column', row: null, column: 1 } },
    { name: 'the corner', at: cornerAt(layout), want: { target: 'corner', row: null, column: null } },
  ];
  const last = layout.columns[layout.columns.length - 1]!;
  const contentEnd = layout.left + last.x + last.width - view.scrollX;
  const blankX = contentEnd + 20;
  if (blankX < layout.left + layout.cellsWidth - 10) {
    targets.push({ name: 'a blank in the body', at: { x: blankX, y: cellAt(layout, view, view.first + 2, 0).y }, want: { target: 'blank', row: null, column: null } });
    targets.push({ name: 'a blank in the header', at: { x: blankX, y: layout.top - layout.rowHeight / 2 }, want: { target: 'blank', row: null, column: null } });
  } else notes.push('no blank past the last column in view');

  const menusBefore = await menusSeen(page);
  let rights = 0;
  for (const { name, at, want } of targets) {
    let count = await clickCount(page);
    await press(at);
    if (!(await expect(`a press on ${name}`, count++, 'press', want, at))) continue;
    // The second press at once (inside 400 ms and 5 px): a double press.
    await press(at, { move: false });
    if (!(await expect(`a double press on ${name}`, count++, 'double', want, at))) continue;
    // The same target again, apart: a press again, reported again.
    await page.waitForTimeout(APART_MS);
    await press(at, { move: false });
    if (!(await expect(`a second press on ${name}`, count++, 'press', want, at))) continue;
    await page.waitForTimeout(APART_MS);
    await press(at, { button: 'right', move: false });
    rights++;
    await expect(`a right press on ${name}`, count++, 'context', want, at);
    await page.waitForTimeout(APART_MS);
  }
  const menus = await menusSeen(page);
  const seen = menus.seen - menusBefore.seen;
  const prevented = menus.prevented - menusBefore.prevented;
  if (seen !== rights) failed(`${label}: ${seen} contextmenu events for ${rights} right presses: the browser's menu went unwatched`);
  else if (seen !== prevented) failed(`${label}: ${seen - prevented} of ${seen} contextmenu events not prevented (the browser's menu would show)`);
  notes.push(`each kind on ${targets.map(({ name }) => name).join(', ')}; ${rights} right presses, ${seen} contextmenu events, ${prevented} prevented`);

  // Ctrl+click: a `Press` with Ctrl by default (and with `select`,
  // nothing selected by it), a `Context` with the host's setting on.
  {
    const cell = { row: view.first + 6, column: 3 };
    const at = cellAt(layout, view, cell.row, cell.column);
    const want: Want = { target: 'cell', ...cell };
    if (selects) {
      await page.keyboard.press('Escape');
      await selected(page, null).catch(() => failed(`${label}: Escape kept the selection before Ctrl+click`));
    }
    const pointers = (await pointersSeen(page)).length;
    const menusBefore = await menusSeen(page);
    let count = await clickCount(page);
    await press(at, { ctrl: true });
    const off = await expect('Ctrl+click with the setting off', count++, 'press', want, at, ['control']);
    if (selects) await selected(page, null, 1_000).catch(async () => failed(`${label}: Ctrl+click with the setting off selected ${JSON.stringify((await shown(page)).shown.selection)}`));
    await page.waitForTimeout(APART_MS);
    await ctrlContext(page, true);
    await press(at, { ctrl: true, move: false });
    const on = await expect('Ctrl+click with the setting on', count++, 'context', want, at, ['control']);
    await ctrlContext(page, false);
    const downs = (await pointersSeen(page)).slice(pointers);
    const menus = await menusSeen(page);
    // What `.claude/rules/gpui-web.md`'s Ctrl+click line rests on: the
    // browser's press is button 0 with Ctrl, which gpui-pre-web makes a
    // left press (a `ContextMenuExt` doesn't open on it).
    if (downs.length !== 2 || downs.some(({ button, ctrl }) => button !== 0 || !ctrl)) failed(`${label}: Ctrl+click's pointerdowns ${JSON.stringify(downs)}, not two of button 0 with Ctrl`);
    if (off && on) notes.push(`Ctrl+click a press, and a context press with the setting on (the page's pointerdowns: ${JSON.stringify(downs.map(({ button, ctrl }) => ({ button, ctrl })))}, ${menus.seen - menusBefore.seen} contextmenu events)`);
    await page.waitForTimeout(APART_MS);
  }

  // A right press during a left drag: no pointerdown, nothing reported,
  // and (with `select`) the drag's range at its release.
  {
    const from = cellAt(layout, view, view.first + 2, 1);
    const to = cellAt(layout, view, view.first + 7, 4);
    const pointers = (await pointersSeen(page)).length;
    const count = await clickCount(page);
    await page.mouse.move(from.x, from.y);
    await page.waitForTimeout(50);
    await page.mouse.down({ clickCount: 1 });
    const step = (index: number) => page.mouse.move(from.x + ((to.x - from.x) * index) / DRAG_MOVES, from.y + ((to.y - from.y) * index) / DRAG_MOVES);
    for (let index = 1; index <= DRAG_MOVES / 2; index++) await step(index);
    await page.mouse.down({ button: 'right', clickCount: 1 });
    await page.waitForTimeout(50);
    await page.mouse.up({ button: 'right', clickCount: 1 });
    for (let index = DRAG_MOVES / 2 + 1; index <= DRAG_MOVES; index++) await step(index);
    await page.mouse.up({ clickCount: 1 });
    const first = await expect("a left drag's press", count, 'press', { target: 'cell', row: view.first + 2, column: 1 }, from);
    const still = first ? await quiet('a right press during a left drag', count + 1) : false;
    // The browser sends the right press as a move, never a pointerdown, so
    // GPUI never sees it: this checks the browser's half and the drag;
    // the table's own rule for a press mid-drag is the window test's.
    const downs = (await pointersSeen(page)).slice(pointers);
    if (downs.length !== 1) failed(`${label}: a right press during a left drag: ${downs.length} pointerdowns, not the drag's one`);
    let dragged = true;
    if (selects) {
      const want: Selection = { kind: 'cells', anchor: [view.first + 2, 1], head: [view.first + 7, 4] };
      dragged = !!(await selected(page, want).catch(async () => failed(`${label}: a right press during a left drag: selected ${JSON.stringify((await shown(page)).shown.selection)}, not ${JSON.stringify(want)}`)));
    }
    if (first && still && dragged && downs.length === 1) notes.push(`a right press during a left drag no pointerdown and nothing reported${selects ? ', the drag selecting its range' : ''}`);
    await page.waitForTimeout(APART_MS);
  }

  // With `select`, Sheets' rule: a context press inside a block keeps it,
  // outside selects its cell.
  if (selects) {
    const block: Selection = { kind: 'cells', anchor: [view.first + 2, 1], head: [view.first + 5, 3] };
    await pressAt(page, cellAt(layout, view, view.first + 2, 1));
    await page.waitForTimeout(APART_MS);
    await pressAt(page, cellAt(layout, view, view.first + 5, 3), true);
    if (await selected(page, block).catch(() => failed(`${label}: the block before the context presses not selected`))) {
      let count = await clickCount(page);
      const inside = cellAt(layout, view, view.first + 4, 2);
      await press(inside, { button: 'right' });
      await expect('a right press inside a block', count++, 'context', { target: 'cell', row: view.first + 4, column: 2 }, inside);
      const kept = await selected(page, block, 1_000).catch(async () => failed(`${label}: a right press inside a block: selected ${JSON.stringify((await shown(page)).shown.selection)}`));
      await page.waitForTimeout(APART_MS);
      const outside = cellAt(layout, view, view.first + 8, 5);
      await press(outside, { button: 'right' });
      await expect('a right press outside a block', count++, 'context', { target: 'cell', row: view.first + 8, column: 5 }, outside);
      const moved = await selected(page, { kind: 'cells', anchor: [view.first + 8, 5], head: [view.first + 8, 5] }).catch(async () => failed(`${label}: a right press outside a block: selected ${JSON.stringify((await shown(page)).shown.selection)}, not its cell`));
      if (kept && moved) notes.push('a right press inside a block kept it, outside selected its cell');
    }
    await page.keyboard.press('Escape');
    await page.waitForTimeout(APART_MS);
  }

  // A long press by touch (Chromium's, through CDP): a context press at
  // its start, and its tap dropped.
  if (chromiumPage) {
    const at = cellAt(layout, view, view.first + 9, 2);
    const cdp = await page.context().newCDPSession(page);
    const pointers = (await pointersSeen(page)).length;
    const count = await clickCount(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: at.x, y: at.y }] });
    await page.waitForTimeout(LONG_PRESS_MS);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const long = await expect('a long press', count, 'context', { target: 'cell', row: view.first + 9, column: 2 }, at);
    const tapDropped = long ? await quiet("a long press's tap", count + 1) : false;
    const touched = (await pointersSeen(page)).slice(pointers).some(({ type }) => type === 'touch');
    if (long && tapDropped) notes.push(`a long press a context press, its tap dropped (pointer type touch seen: ${touched})`);
    if (selects) await selected(page, { kind: 'cells', anchor: [view.first + 9, 2], head: [view.first + 9, 2] }).catch(async () => failed(`${label}: a long press: selected ${JSON.stringify((await shown(page)).shown.selection)}, not its cell`));
    await cdp.detach();
  } else notes.push('no long press (not drivable here)');
  return `, ${notes.join('; ')}`;
}

/** The sideways room `checkPin` narrows the viewport for, where it has
 *  less. */
const PIN_ROOM_PX = 150;
/** A glyph's ink may overhang its advance by this much. */
const INK_SLACK_PX = 1.5;

/** The drawn cells carry `style`'s paint, and (heat) a fill shows on screen
 *  in its color, sampled clear of the text at its cell's top-left. */
async function checkPaint(page: Page, style: CellStyle, shape: string, layout: Layout, label: string): Promise<string> {
  const view = await filledWhere(page, 'true');
  const drawn = await drawnCells(page);
  const field = ({ heat: 'fill', bars: 'bar', color: 'text' } as const)[style as 'heat' | 'bars' | 'color'];
  const paintedCells = drawn.filter((cell) => cell[field]);
  if (!paintedCells.length) {
    failures.push(`${label}: no drawn cell has a ${field}`);
    return '';
  }
  if (style === 'bars') {
    // The host's bars take `below`'s color left of zero: both sides drawn
    // where values are signed (the wide shape; the narrow's are all >= 0).
    const colors = new Set(paintedCells.map((cell) => cell.bar!.color.join(',')));
    if (shape === 'wide' && colors.size < 2) failures.push(`${label}: every bar drawn in one color (${[...colors].join(' ')}), none below zero in its own`);
    return `, ${paintedCells.length}/${drawn.length} cells with a bar, in ${colors.size} colors`;
  }
  if (style !== 'heat') return `, ${paintedCells.length}/${drawn.length} cells with a ${field}`;
  // Over a fill the text picks its own contrast.
  const unset = paintedCells.filter((cell) => !cell.text).length;
  if (unset) failures.push(`${label}: ${unset} filled cells drew their text in no color of their own`);
  const cell = darkestOnScreen(paintedCells, view, layout);
  const x = layout.left + screenLeft(layout, cell.column, view.scrollX) + 2;
  const y = layout.top + (cell.row - view.top) * layout.rowHeight + 2;
  const seen = await pixel(page, x, y);
  const off = Math.max(...cell.fill!.map((channel, index) => Math.abs(channel - seen[index]!)));
  if (off > FILL_STEPS) failures.push(`${label}: the fill at row ${cell.row}, column ${cell.column} drew ${seen.join(',')}, the table says ${cell.fill!.join(',')}`);
  return `, ${paintedCells.length}/${drawn.length} cells with a fill (on screen ${seen.slice(0, 3).join(',')}, within ${off} of its color)`;
}

/** The painted cell wholly on screen (its row between the top's and the
 *  bottom's partial ones, which sit under the header and the scrollbar)
 *  whose fill is darkest, the furthest from the light theme's background,
 *  so a sample of the bare background can't pass. */
function darkestOnScreen(cells: Cell[], view: Shown, layout: Layout): Cell {
  const onScreen = cells.filter((cell) => {
    // Wholly in its region: a pinned one, or a scrolled one right of the
    // run (`pin`) and left of the cells' right edge.
    const left = screenLeft(layout, cell.column, view.scrollX);
    const from = cell.column < (layout.pinned ?? 0) ? 0 : pinEdge(layout);
    return cell.row >= Math.ceil(view.top) && cell.row < view.end - 1 && left >= from && left + layout.columns[cell.column]!.width <= layout.cellsWidth;
  });
  const sum = (cell: Cell) => cell.fill![0]! + cell.fill![1]! + cell.fill![2]!;
  return (onScreen.length ? onScreen : cells).reduce((darkest, cell) => (sum(cell) < sum(darkest) ? cell : darkest));
}
/** The reference screens (`--screens`): each build's screens, saved beside
 *  the commit they were drawn from, so a later tree's are compared with a
 *  named commit's pixel for pixel. Per shape and paint style (each with
 *  `custom-cells`; the host's default density and pin come with the
 *  build): the first screen, before the pointer moves; one after a wheel
 *  down and (where the columns have room) sideways to a fractional
 *  `scrollX` and a row top off the device pixel; with `select`, a block
 *  selected (the tint under the text); and with `resize`, in the narrow
 *  shape, `spkid` and `full_name` narrowed (an integer cut in the middle,
 *  a text at its end). */
const SCREENS = join(perfDir, 'results/raw/smoke-screens');
/** The wheel to the scrolled screen, CSS px: off any whole row and pixel. */
const SCROLL_DOWN_PX = 1_207.3;
const SCROLL_SIDEWAYS_PX = 1_234.3;
/** The `resize` build's narrowed screen: each column's band dragged to
 *  this width, CSS px (cut at the base's text and the dense default's). */
const SCREEN_NARROWED: [number, number][] = [
  [0, 60],
  [1, 90],
];
/** Where a tree's screens go: the commit, with the hash of its source
 *  changes when it has any (a named commit is a clean tree's). */
function screensDir(features: string[], from: { commit: string; changes: string }): string {
  const commit = from.commit.slice(0, 10);
  return join(SCREENS, from.changes === UNCHANGED ? commit : `${commit}+${from.changes}`, buildName(features));
}
type ScreenView = { top: number; scrollX: number };

async function referenceScreens(against: string | null): Promise<void> {
  const features = builtFeatures();
  const from = drawnFrom();
  const clean = from.changes === UNCHANGED;
  // The screens are the build's: refused unless it was built from this tree.
  const built = builtFrom();
  if (!built || built.commit !== from.commit || built.changes !== from.changes) {
    failures.push(`the build in host/web/dist was built from ${built ? JSON.stringify(built) : 'an unknown tree'}, not this one (${JSON.stringify(from)}): run \`just tall-table build ${features.join(',')}\` first`);
    return;
  }
  let reference: string | null = null;
  if (against !== null) {
    let commit: string;
    try {
      commit = execFileSync('git', ['rev-parse', '--verify', '--quiet', `${against}^{commit}`], { cwd: repo }).toString().trim();
    } catch {
      failures.push(`--screens ${against}: not a commit`);
      return;
    }
    reference = screensDir(features, { commit, changes: UNCHANGED });
  }
  // Compared with its own commit's, this tree's go beside them.
  const ownDir = screensDir(features, from);
  const dir = ownDir === reference ? `${ownDir}-again` : ownDir;
  if (reference && !existsSync(reference)) {
    failures.push(`no screens of the ${buildName(features)} build at ${reference}: check out ${against}, build it, and run \`just tall-table smoke --screens save\``);
    return;
  }
  mkdirSync(dir, { recursive: true });
  const styles: (CellStyle | undefined)[] = painted.length ? ['text', ...painted] : [undefined];
  let compared = 0;
  for (const name of browsers) {
    const engine = engines[name];
    if (!engine) {
      failures.push(`unknown browser ${name}`);
      continue;
    }
    for (const shape of SHAPES) {
      for (const cells of styles) {
        const label = `${name} ${shape}${cells ? ` ${cells}` : ''}`;
        const params: Record<string, string> = { shape };
        if (cells) params.cells = cells;
        let session: Awaited<ReturnType<typeof open>> | null = null;
        try {
          session = await open(engine, server.url, { params, init: [firstDrawProbe] });
          const { page } = session;
          await waitMark(page, FILLED_MARK, 0, 60_000);
          const { shown: start, layout } = await shown(page);
          const shots: [string, string, ScreenView][] = [['first', await settledScreen(page), { top: start.top, scrollX: start.scrollX }]];
          await page.mouse.move(layout.left + 200, layout.top + 200);
          // Inside the room, short of its end (where the scroll clamps).
          const room = sidewaysRoom(layout) > 0;
          await wheel(page, SCROLL_DOWN_PX, room ? Math.min(SCROLL_SIDEWAYS_PX, sidewaysRoom(layout) / 2 + 0.3) : 0);
          let down = await filledWhere(page, `s.first >= ${start.first + 30}${room ? ' && s.scrollX > 0' : ''}`);
          const scale = await page.evaluate(() => devicePixelRatio);
          const off = (value: number) => Math.abs(value * scale - Math.round(value * scale)) > 1e-3;
          if (!off(down.top * layout.rowHeight)) {
            // WebKit's wheel moves whole pixels: the thumb dragged 5 px
            // lands the top at a fraction of the rows.
            const [x, y, width, height] = await page.evaluate(() => (globalThis as { __seizaTargets?: Record<string, number[]> }).__seizaTargets!['table-scroll-thumb']!);
            await page.mouse.move(x! + width! / 2, y! + height! / 2);
            await page.mouse.down();
            await page.mouse.move(x! + width! / 2, y! + height! / 2 + 5, { steps: 5 });
            await page.mouse.up();
            down = await filledWhere(page, `s.first >= ${down.first + 100}`);
          }
          // Off the hover: a tooltip would show over a cut cell.
          const corner = cornerAt(layout);
          await page.mouse.move(corner.x, corner.y);
          const scrolled = (await shown(page)).shown;
          shots.push(['scrolled', await settledScreen(page), { top: scrolled.top, scrollX: scrolled.scrollX }]);
          if (!off(scrolled.top * layout.rowHeight)) failures.push(`${label}: the scrolled screen's row top ${(scrolled.top * layout.rowHeight).toFixed(3)} px is on the device pixel`);
          // WebKit's wheel moves whole pixels (said, not failed).
          if (room && !off(scrolled.scrollX) && engine !== webkit) failures.push(`${label}: the scrolled screen's scrollX ${scrolled.scrollX} is on the device pixel`);
          if (select && (!cells || cells === 'text')) {
            // A block: a press, then a Shift+press three rows and columns on.
            const at = (row: number, column: number) => cellAt(layout, scrolled, row, column);
            const first = Math.ceil(down.top) + 1;
            // The first scrolled column wholly right of the run's edge, and
            // the two after it, all within the view.
            const column = layout.columns.findIndex((laid, index) => screenLeft(layout, index, scrolled.scrollX) >= pinEdge(layout) && laid.x - scrolled.scrollX >= 0);
            if (column < 0 || screenLeft(layout, column + 2, scrolled.scrollX) + layout.columns[column + 2]!.width > layout.cellsWidth) throw new Error(`no three scrolled columns in view to select at scrollX ${scrolled.scrollX}`);
            const a = at(first, column);
            const b = at(first + 3, column + 2);
            await page.mouse.click(a.x, a.y);
            await page.keyboard.down('Shift');
            await page.mouse.click(b.x, b.y);
            await page.keyboard.up('Shift');
            await page.mouse.move(corner.x, corner.y);
            // The block, not the first press's cell.
            await selected(page, { kind: 'cells', anchor: [first, column], head: [first + 3, column + 2] });
            shots.push(['selected', await settledScreen(page), { top: scrolled.top, scrollX: scrolled.scrollX }]);
          }
          if (resize && (!cells || cells === 'text') && shape === 'narrow') {
            // Narrowed, from the scrolled view: an integer cut in the
            // middle (`spkid`) and a text at its end (`full_name`).
            for (const [column, to] of SCREEN_NARROWED) {
              const { shown: view, layout: now } = await shown(page);
              const band = bandAt(now, column, view.scrollX);
              const width = now.columns[column]!.width;
              const by = to - width;
              await page.mouse.move(band.x, band.y);
              await page.mouse.down();
              await page.mouse.move(band.x + by, band.y, { steps: DRAG_MOVES });
              await page.mouse.up();
              await laidOutAt(page, column, width + by).catch(() => failed(`${label}: column ${column} not ${width + by} px after its band's drag`));
            }
            await page.mouse.move(corner.x, corner.y);
            const narrowed = (await shown(page)).shown;
            shots.push(['narrowed', await settledScreen(page), { top: narrowed.top, scrollX: narrowed.scrollX }]);
          }
          for (const [variant, png, view] of shots) {
            const file = `${name}-${shape}${cells ? `-${cells}` : ''}-${variant}`;
            writeFileSync(join(dir, `${file}.png`), Buffer.from(png, 'base64'));
            writeFileSync(join(dir, `${file}.json`), JSON.stringify({ ...from, ...view }));
            if (!reference) continue;
            const was = join(reference, `${file}.png`);
            if (!existsSync(was) || !existsSync(join(reference, `${file}.json`))) {
              failures.push(`${label} ${variant}: no reference screen ${was} (or its .json)`);
              continue;
            }
            const then = JSON.parse(readFileSync(join(reference, `${file}.json`), 'utf8')) as ScreenView;
            if (then.top !== view.top || then.scrollX !== view.scrollX) failures.push(`${label} ${variant}: landed at top ${view.top}, scrollX ${view.scrollX}; the reference at ${then.top}, ${then.scrollX}`);
            const differ = await differingPixels(page, png, readFileSync(was).toString('base64'), 0);
            if (differ) failures.push(`${label} ${variant}: ${differ} px differ from ${against}'s (${join(dir, `${file}.png`)} against ${was})`);
            compared++;
            console.log(`${label} ${variant}: top ${view.top.toFixed(4)}, scrollX ${view.scrollX.toFixed(2)}${differ ? `, ${differ} px differ` : ', pixel for pixel'}`);
          }
          if (!reference) console.log(`${label}: ${shots.map(([variant, , view]) => `${variant} (top ${view.top.toFixed(4)}, scrollX ${view.scrollX.toFixed(2)})`).join(', ')} saved`);
          if (session.problems.length) failures.push(`${label}: ${session.problems.join('; ')}`);
        } catch (error) {
          failures.push(`${label}: ${(error as Error).message.split('\n')[0]}`);
        } finally {
          await session?.close();
        }
      }
    }
  }
  console.log(reference ? `${compared} screens compared with ${against}'s; this tree's in ${dir}` : `saved in ${dir}${clean ? '' : ' (a tree with source changes: no commit names it)'}`);
}

const failures: string[] = [];
const browsers = (option('browsers') ?? 'chromium,firefox,webkit').split(',');
const server = await serveApp(undefined, { webDir: hostWebDir, port: PORT });
// `--screens` needs its value: alone or before another flag, it's refused
// rather than read as missing (the full run) or as a commit.
const screensGiven = process.argv.includes('--screens');
const screensOption = option('screens');
if (screensGiven && (screensOption === undefined || screensOption.startsWith('--'))) {
  console.error('FAIL\n  --screens takes `save` or a commit');
  await server.close();
  process.exit(1);
}
if (screensOption !== undefined) {
  try {
    await referenceScreens(screensOption === 'save' ? null : screensOption);
  } finally {
    await server.close();
  }
  if (failures.length) {
    console.error(`FAIL\n  ${failures.join('\n  ')}`);
    process.exit(1);
  }
  console.log('ok');
  process.exit(0);
}
/** The build again at the LAN address, for the insecure-context run alone:
 *  started at its first run, so a machine without one fails only that. */
let lanServer: Awaited<ReturnType<typeof serveApp>> | null = null;
if (format) console.log(`format: the smoke check's formatter against cells.json, ${checkFormatter()}`);
try {
  for (const name of browsers) {
    const engine = engines[name];
    if (!engine) {
      failures.push(`unknown browser ${name}`);
      continue;
    }
    const quiet = { cells: undefined as CellStyle | undefined, feed: false, flash: false, tail: false, resizing: false, selecting: false, copying: undefined as CopyRun | undefined, sorting: undefined as SortRun | undefined, pinning: false, densities: undefined as DensityRun | undefined, formatting: undefined as FormatRun | undefined, reordering: undefined as ReorderRun | undefined, clicking: false, grouping: false, replacing: false, hiding: false, finding: false, popping: false, setting: undefined as 'stripe' | 'fill' | undefined, iconing: false };
    const runs = SHAPES.flatMap((shape) => [{ ...quiet, shape }, ...painted.map((cells) => ({ ...quiet, shape, cells }))]);
    if (live) runs.push({ ...quiet, shape: 'narrow', feed: true });
    if (flashing) runs.push({ ...quiet, shape: 'narrow', feed: true, flash: true });
    if (follow) runs.push({ ...quiet, shape: 'narrow', tail: true });
    if (resize) runs.push(...SHAPES.map((shape) => ({ ...quiet, shape, resizing: true })));
    if (select) runs.push(...SHAPES.map((shape) => ({ ...quiet, shape, selecting: true })));
    if (copy) {
      runs.push(...SHAPES.map((shape) => ({ ...quiet, shape, copying: 'keys' as CopyRun })));
      runs.push(...(['held', 'minute', 'background', 'insecure'] as CopyRun[]).map((copying) => ({ ...quiet, shape: 'narrow' as const, copying })));
    }
    if (sort) {
      runs.push(...SHAPES.flatMap((shape) => (['glyphs', 'icons'] as SortRun[]).map((sorting) => ({ ...quiet, shape, sorting }))));
      runs.push({ ...quiet, shape: 'narrow', sorting: 'opened' });
    }
    if (pin) runs.push(...SHAPES.map((shape) => ({ ...quiet, shape, pinning: true })));
    // The control only where nothing else is built (`resize`'s hairlines,
    // `pin`'s edge, `sort`'s arrows differ from the base at rest).
    const controlled = builtFeatures().every((feature) => feature === 'density');
    if (density) runs.push(...SHAPES.flatMap((shape) => (controlled ? (['dense', 'control'] as DensityRun[]) : (['dense'] as DensityRun[])).map((densities) => ({ ...quiet, shape, densities }))));
    if (format) runs.push(...SHAPES.flatMap((shape) => (['on', 'off'] as FormatRun[]).map((formatting) => ({ ...quiet, shape, formatting }))));
    if (reorder) runs.push(...SHAPES.flatMap((shape) => (['drag', 'reverse'] as ReorderRun[]).map((reordering) => ({ ...quiet, shape, reordering }))));
    if (clicks) runs.push(...SHAPES.map((shape) => ({ ...quiet, shape, clicking: true })));
    if (groupHeaders) runs.push(...SHAPES.map((shape) => ({ ...quiet, shape, grouping: true })));
    if (hide) runs.push(...SHAPES.map((shape) => ({ ...quiet, shape, hiding: true })));
    if (find) runs.push(...SHAPES.map((shape) => ({ ...quiet, shape, finding: true })));
    if (popover) runs.push(...SHAPES.map((shape) => ({ ...quiet, shape, popping: true })));
    // Its settings, over a striped row and (`custom-cells`) over a fill.
    if (popover) runs.push(...SHAPES.flatMap((shape) => (painted.length ? (['stripe', 'fill'] as const) : (['stripe'] as const)).map((setting) => ({ ...quiet, shape, setting }))));
    if (headerIcon) runs.push(...SHAPES.map((shape) => ({ ...quiet, shape, iconing: true })));
    // In every build: the base's `replace_rows`.
    runs.push(...SHAPES.map((shape) => ({ ...quiet, shape, replacing: true })));
    for (const { shape, cells, feed, flash, tail, resizing, selecting, copying, sorting, pinning, densities, formatting, reordering, clicking, grouping, replacing, hiding, finding, popping, setting, iconing } of runs) {
      const label = `${name} ${shape}${cells ? ` ${cells}` : ''}${feed ? ` live=${LIVE_RATE}` : ''}${flash ? ' flash' : ''}${tail ? ` append=${TAIL_RATE}` : ''}${resizing ? ' resize' : ''}${selecting ? ' select' : ''}${copying ? ` copy ${copying}` : ''}${sorting ? ` sort ${sorting}` : ''}${pinning ? ' pin' : ''}${densities ? ` density ${densities}` : ''}${formatting ? ` format ${formatting}` : ''}${reordering ? ` reorder ${reordering}` : ''}${clicking ? ' clicks' : ''}${grouping ? ' groups' : ''}${replacing ? ' replace' : ''}${hiding ? ' hide' : ''}${finding ? ' find' : ''}${popping ? ' popover' : ''}${setting ? ` popover settings ${setting}` : ''}${iconing ? ' icons' : ''}`;
      const params: Record<string, string> = { shape };
      if (densities === 'control') params.density = '30,14';
      // The format runs: the cells probed, at the base's 14 px text (the
      // advances' size) with `density`; `?format=off` for the control.
      if (formatting) Object.assign(params, { 'probe-cells': '', ...(density ? { density: '30,14' } : {}), ...(formatting === 'off' ? { format: 'off' } : {}) });
      if (sorting) params['probe-cells'] = '';
      if (reordering || grouping) params['probe-cells'] = '';
      if ((replacing || hiding || finding) && cellsProbed) params['probe-cells'] = '';
      // The find runs place each tint by the advances at the base's 14 px
      // text and its padding (`paddingAt(14)`), with `density` too.
      if (finding && density) params.density = '30,14';
      if (popping) Object.assign(params, { popover: POPOVER_LABEL, 'popover-long': String(POPOVER_LONG) });
      // The settings runs read the fade's lengths at the base's 14 px text.
      if (setting) Object.assign(params, { popover: POPOVER_LABEL, 'popover-long': String(POPOVER_LONG), 'popover-cells': 'cut', 'popover-fade': '', 'popover-icons': '', 'popover-fill': '', ...(setting === 'fill' ? { cells: 'heat' } : {}), ...(density ? { density: '30,14' } : {}) });
      if (reordering === 'reverse') params.order = 'reverse';
      // A drag is held to its group (`group-headers`): the reorder runs'
      // moves are the ungrouped table's; the group runs drag groups.
      if (reordering && groupHeaders) params.groups = '0';
      if (sorting === 'icons') params['sort-icons'] = '';
      if (sorting === 'opened') params.sort = `${OPEN_SORT.column},${OPEN_SORT.direction === 'ascending' ? 'asc' : 'desc'}`;
      if (cells) Object.assign(params, { cells, 'probe-cells': '' });
      if (feed) params.live = String(LIVE_RATE);
      if (feed && flashing) params['probe-cells'] = '';
      if (flash) params.flash = '';
      if (tail) Object.assign(params, { rows: String(TAIL_ROWS), append: String(TAIL_RATE), follow: '' });
      const heldMs = copying === 'minute' ? MINUTE_HELD_MS : copying === 'held' || copying === 'background' ? HELD_MS : 0;
      if (heldMs) params.delay = String(heldMs);
      let session: Awaited<ReturnType<typeof open>> | null = null;
      try {
        if (copying === 'insecure') lanServer ??= await serveApp(undefined, { webDir: hostWebDir, port: PORT + 1, lan: true });
        const url = copying === 'insecure' ? lanServer!.url : server.url;
        // Inside the try: a browser that fails to launch is a failure, and the rest still run.
        session = await open(engine, url, { params, init: tail ? [firstDrawProbe, presentingTaskRecorder, tailRecorder] : feed ? [firstDrawProbe, presentingTaskRecorder] : resizing ? [firstDrawProbe, widthsRecorder] : densities ? [firstDrawProbe, workRecorder] : clicking ? [firstDrawProbe, recordPointers] : [firstDrawProbe] });
        const { page } = session;
        // The clipboard's permissions, which a real Chrome grants a focused
        // page (the write); none to grant in an insecure context.
        if (((copying && copying !== 'insecure') || popping) && engine === chromium) await session.context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(url).origin });
        const first = await waitMark(page, FIRST_FRAME_MARK);
        const filled = await waitMark(page, FILLED_MARK, 0, 60_000 + 2 * heldMs);
        const { shown: start, layout } = await shown(page);
        const api = await page.evaluate(() => (globalThis as { __seizaProbe?: FirstDrawProbe }).__seizaProbe?.api ?? 'none');
        // The base build's first screen, for `density`'s control: before
        // the pointer moves.
        if (!builtFeatures().length && params.shape === shape && Object.keys(params).length === 1) {
          mkdirSync(BASE_SCREENS, { recursive: true });
          writeFileSync(baseScreen(name, shape), Buffer.from(await settledScreen(page), 'base64'));
          writeFileSync(`${baseScreen(name, shape)}.json`, fromHere);
        }
        // The icon runs check their own, from the first screen.
        if (iconing) {
          const iconed = await checkIcons(page, label, layout, start);
          if (session.problems.length) failures.push(`${label}: ${session.problems.join('; ')}`);
          console.log(`${label}: first frame ${first.toFixed(0)} ms, filled ${filled.toFixed(0)} ms (${api})${iconed}`);
          continue;
        }
        // The popover's settings runs too.
        if (setting) {
          const set = await checkPopoverSettings(page, label, layout, setting);
          if (session.problems.length) failures.push(`${label}: ${session.problems.join('; ')}`);
          console.log(`${label}: first frame ${first.toFixed(0)} ms, filled ${filled.toFixed(0)} ms (${api})${set}`);
          continue;
        }
        // The popover runs check their own, from the first screen.
        if (popping) {
          const popped = await checkPopover(page, label, layout);
          if (session.problems.length) failures.push(`${label}: ${session.problems.join('; ')}`);
          console.log(`${label}: first frame ${first.toFixed(0)} ms, filled ${filled.toFixed(0)} ms (${api})${popped}`);
          continue;
        }
        // The find runs check their own, from the first screen.
        if (finding) {
          const found = await checkFind(page, label, layout, shape);
          if (session.problems.length) failures.push(`${label}: ${session.problems.join('; ')}`);
          console.log(`${label}: first frame ${first.toFixed(0)} ms, filled ${filled.toFixed(0)} ms (${api})${found}`);
          continue;
        }
        // The hide runs check their own, from the first screen.
        if (hiding) {
          const hid = await checkHide(page, label, layout, shape);
          if (session.problems.length) failures.push(`${label}: ${session.problems.join('; ')}`);
          console.log(`${label}: first frame ${first.toFixed(0)} ms, filled ${filled.toFixed(0)} ms (${api})${hid}`);
          continue;
        }
        // The replace runs check their own, from the first screen.
        if (replacing) {
          const replaced = await checkReplace(page, label, layout, start, shape);
          if (session.problems.length) failures.push(`${label}: ${session.problems.join('; ')}`);
          console.log(`${label}: first frame ${first.toFixed(0)} ms, filled ${filled.toFixed(0)} ms (${api})${replaced}`);
          continue;
        }
        // The group runs check their own, from the first screen.
        if (grouping) {
          const grouped = await checkGroups(page, label, layout, shape);
          if (session.problems.length) failures.push(`${label}: ${session.problems.join('; ')}`);
          console.log(`${label}: first frame ${first.toFixed(0)} ms, filled ${filled.toFixed(0)} ms (${api})${grouped}`);
          continue;
        }
        // The clicks runs check their own, from the first screen.
        if (clicking) {
          const clicked = await checkClicks(page, label, layout, start, engine === chromium);
          if (session.problems.length) failures.push(`${label}: ${session.problems.join('; ')}`);
          console.log(`${label}: first frame ${first.toFixed(0)} ms, filled ${filled.toFixed(0)} ms (${api})${clicked}`);
          continue;
        }
        // The reorder runs check their own, from the first screen.
        if (reordering) {
          const reordered = await checkReorder(page, label, layout, reordering);
          if (session.problems.length) failures.push(`${label}: ${session.problems.join('; ')}`);
          console.log(`${label}: first frame ${first.toFixed(0)} ms, filled ${filled.toFixed(0)} ms (${api})${reordered}`);
          continue;
        }
        // The format runs check their own, from the first screen.
        if (formatting) {
          const checked = await checkFormat(page, label, layout, start, name, shape, formatting);
          if (session.problems.length) failures.push(`${label}: ${session.problems.join('; ')}`);
          console.log(`${label}: first frame ${first.toFixed(0)} ms, filled ${filled.toFixed(0)} ms (${api})${checked}`);
          continue;
        }
        // The density runs check their own, from the first screen.
        if (densities) {
          const checked = await checkDensity(page, label, layout, start, name, shape, densities);
          if (session.problems.length) failures.push(`${label}: ${session.problems.join('; ')}`);
          console.log(`${label}: first frame ${first.toFixed(0)} ms, filled ${filled.toFixed(0)} ms (${api})${checked}`);
          continue;
        }
        // The resize run checks its own moves, from the first screen.
        if (resizing) {
          const resized = await checkResize(page, label, layout);
          if (session.problems.length) failures.push(`${label}: ${session.problems.join('; ')}`);
          console.log(`${label}: first frame ${first.toFixed(0)} ms, filled ${filled.toFixed(0)} ms (${api})${resized}`);
          continue;
        }
        // The pin run too, from the first screen.
        if (pinning) {
          const pinned = await checkPin(page, label, layout, shape);
          if (session.problems.length) failures.push(`${label}: ${session.problems.join('; ')}`);
          console.log(`${label}: first frame ${first.toFixed(0)} ms, filled ${filled.toFixed(0)} ms (${api})${pinned}`);
          continue;
        }
        // The select run too, from the first screen.
        if (selecting) {
          const chose = await checkSelect(page, label, layout, start);
          if (session.problems.length) failures.push(`${label}: ${session.problems.join('; ')}`);
          console.log(`${label}: first frame ${first.toFixed(0)} ms, filled ${filled.toFixed(0)} ms (${api})${chose}`);
          continue;
        }
        // The sort runs too, from the first screen.
        if (sorting) {
          const sorted =
            sorting === 'opened'
              ? await sortedAs(page, OPEN_SORT, 5_000)
                  .then(async () => `, opened ${await checkOrder(page, label, 'sorted', layout, OPEN_SORT.column, OPEN_SORT)}`)
                  .catch(() => failed(`${label}: not sorted ${JSON.stringify(OPEN_SORT)} at open`) ?? '')
              : await checkSort(page, label, layout, shape, `${name} ${shape}`, sorting);
          if (session.problems.length) failures.push(`${label}: ${session.problems.join('; ')}`);
          console.log(`${label}: first frame ${first.toFixed(0)} ms, filled ${filled.toFixed(0)} ms (${api})${sorted}`);
          continue;
        }
        // The copy runs too, from the first screen.
        if (copying) {
          const copied = copying === 'keys' ? await checkCopyKeys(page, label, layout, start, shape) : copying === 'insecure' ? await checkCopyInsecure(page, label) : await checkCopyHeld(page, label, layout, copying, heldMs);
          // Over `http` off localhost, Chromium says it ignored COOP: so it should.
          const problems = session.problems.filter((problem) => !(copying === 'insecure' && problem.includes('Cross-Origin-Opener-Policy header has been ignored')));
          if (problems.length) failures.push(`${label}: ${problems.join('; ')}`);
          console.log(`${label}: first frame ${first.toFixed(0)} ms, filled ${filled.toFixed(0)} ms (${api})${copied}`);
          continue;
        }
        // At the tail already: the tail run checks its own moves.
        const followed = tail ? await checkFollow(page, label, layout) : '';
        await page.mouse.move(layout.left + 200, layout.top + 200);
        if (!tail) await wheel(page, 40 * layout.rowHeight);
        const down = tail ? (await shown(page)).shown : await filledWhere(page, `s.first >= ${start.first + 30}`);
        let sideways = '';
        if (shape === 'wide') {
          await wheel(page, 0, 3_000);
          const right = await filledWhere(page, 's.scrollX >= 2000');
          sideways = `, sideways to ${right.scrollX.toFixed(0)} px (${visibleColumns(layout, right.scrollX)} columns visible)`;
        }
        const paint = cells ? await checkPaint(page, cells, shape, layout, label) : '';
        const refreshed = feed ? await checkLive(page, label, flash) : '';
        if (session.problems.length) failures.push(`${label}: ${session.problems.join('; ')}`);
        console.log(`${label}: first frame ${first.toFixed(0)} ms, filled ${filled.toFixed(0)} ms (${api}), ${start.rows} rows, ${layout.columns.length} columns, rows ${start.first}–${start.end} → ${down.first}–${down.end}${sideways}${paint}${refreshed}${followed}`);
      } catch (error) {
        failures.push(`${label}: ${(error as Error).message.split('\n')[0]}`);
      } finally {
        await session?.close();
      }
    }
  }
} finally {
  await server.close();
  await lanServer?.close();
}
if (failures.length) {
  console.error(`FAIL\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log('ok');
