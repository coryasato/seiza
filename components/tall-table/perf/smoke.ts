// The bare host on its release build, in each browser: in both shapes, it
// draws its first frame, fills, scrolls down by wheel (and sideways in the
// wide shape), fills again there, and reports no page errors. Built with
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
// agreeing after each.
// Headless, so it stands in for the scripted half of a manual check; how it
// looks is still a manual check. WebKit and Firefox at DPR 1, Chromium at
// DPR 2 (shared-web/perf/'s `open`).
//
// Usage: node components/tall-table/perf/smoke.ts [--browsers chromium,firefox,webkit]
// Run `just tall-table build [features]` first.

import { chromium, firefox, webkit, type BrowserType, type Page } from 'playwright';
import { firstDrawProbe, open, presentedMark, presentingTaskRecorder, waitMark, wheel, type FirstDrawProbe } from '../../../shared-web/perf/harness.ts';
import { option } from '../../../shared-web/perf/protocol.ts';
import { serveApp } from '../../../shared-web/perf/serve.ts';
import { FILLED_MARK, FIRST_FRAME_MARK, FOLLOWING_GLOBAL, PORT, REFRESHED_GLOBAL, REFRESHED_MARK, SELECTION_GLOBAL, TAIL_MARK, SHAPES, WIDTHS_GLOBAL, bandAt, builtFeatures, cellAt, drawnCells, filledWhere, global, gutterAt, headerAt, hostWebDir, laidOutAt, pixel, selected, shown, sidewaysRoom, visibleColumns, type Cell, type CellStyle, type Layout, type Selection, type Shown } from './harness.ts';

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
 *  while rows arrive, and End follows again. */
async function checkFollow(page: Page, label: string, layout: Layout): Promise<string> {
  if ((await global<boolean>(page, FOLLOWING_GLOBAL)) !== true) failures.push(`${label}: not following at open with ?follow`);
  const first = await followsTail(page, label, 0, TAIL_MARKS);
  // A wheel up: following stops, and the view holds while rows arrive.
  await page.mouse.move(layout.left + 200, layout.top + 200);
  await wheel(page, -10 * layout.rowHeight);
  await page.waitForFunction((name) => (globalThis as Record<string, unknown>)[name] === false, FOLLOWING_GLOBAL, { timeout: 10_000, polling: 10 });
  // Firefox and WebKit deliver one scripted wheel in parts: the view is
  // the reader's until it rests.
  let held = (await shown(page)).shown;
  for (let waited = 0; ; waited += 200) {
    if (waited >= REST_MS) {
      failures.push(`${label}: the view still moving ${REST_MS} ms after a wheel up (top ${held.top})`);
      break;
    }
    await page.waitForTimeout(200);
    const now = (await shown(page)).shown;
    if (now.top === held.top) break;
    held = now;
  }
  await page.waitForTimeout(500);
  const later = (await shown(page)).shown;
  if (later.top !== held.top) failures.push(`${label}: the view moved from ${held.top} to ${later.top} after a wheel up`);
  if (later.rows <= held.rows) failures.push(`${label}: no rows arrived while let go (${held.rows} → ${later.rows})`);
  // End: following again, the tail mark advancing past where it was.
  await page.keyboard.press('End');
  await page.waitForFunction((name) => (globalThis as Record<string, unknown>)[name] === true, FOLLOWING_GLOBAL, { timeout: 10_000, polling: 10 });
  const back = await followsTail(page, `${label} (End)`, await page.evaluate(() => performance.now()), TAIL_MARKS);
  if (back.tail <= later.rows - TAIL_RATE) failures.push(`${label}: after End the tail drawn ${back.tail} is behind the rows (${later.rows})`);
  return `, followed to ${first.tail}, held at ${held.top.toFixed(1)} while ${later.rows - held.rows} rows arrived, followed again to ${back.tail}`;
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
  if (published.some((width, index) => index !== wide && width !== null)) failures.push(`${label}: widths set for columns not dragged (${published.join(',')})`);

  // A double-click fits another float column, published once more.
  const fitBand = bandAt(widened, fit, 0);
  await page.mouse.dblclick(fitBand.x, fitBand.y);
  // Its width was its kind's (null), so a fit sets one, whatever its size.
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
  // The last column whose edge is in view with room left of it.
  const edges = laid.columns.map((column, index) => ({ index, edge: column.x + column.width - end.scrollX }));
  const narrow = edges.filter(({ edge }) => edge > 0 && edge < laid.cellsWidth - 2).at(-1)!.index;
  const was = laid.columns[narrow]!.width;
  const width = Math.min(Math.max(was + NARROW_PX, 40), 1200);
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
  const x = layout.left + layout.columns[cell.column]!.x - view.scrollX + 2;
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
    const column = layout.columns[cell.column]!;
    return cell.row >= Math.ceil(view.top) && cell.row < view.end - 1 && column.x >= view.scrollX && column.x + column.width <= view.scrollX + layout.cellsWidth;
  });
  const sum = (cell: Cell) => cell.fill![0]! + cell.fill![1]! + cell.fill![2]!;
  return (onScreen.length ? onScreen : cells).reduce((darkest, cell) => (sum(cell) < sum(darkest) ? cell : darkest));
}
const browsers = (option('browsers') ?? 'chromium,firefox,webkit').split(',');
const server = await serveApp(undefined, { webDir: hostWebDir, port: PORT });
const failures: string[] = [];
try {
  for (const name of browsers) {
    const engine = engines[name];
    if (!engine) {
      failures.push(`unknown browser ${name}`);
      continue;
    }
    const quiet = { cells: undefined as CellStyle | undefined, feed: false, flash: false, tail: false, resizing: false, selecting: false };
    const runs = SHAPES.flatMap((shape) => [{ ...quiet, shape }, ...painted.map((cells) => ({ ...quiet, shape, cells }))]);
    if (live) runs.push({ ...quiet, shape: 'narrow', feed: true });
    if (flashing) runs.push({ ...quiet, shape: 'narrow', feed: true, flash: true });
    if (follow) runs.push({ ...quiet, shape: 'narrow', tail: true });
    if (resize) runs.push(...SHAPES.map((shape) => ({ ...quiet, shape, resizing: true })));
    if (select) runs.push(...SHAPES.map((shape) => ({ ...quiet, shape, selecting: true })));
    for (const { shape, cells, feed, flash, tail, resizing, selecting } of runs) {
      const label = `${name} ${shape}${cells ? ` ${cells}` : ''}${feed ? ` live=${LIVE_RATE}` : ''}${flash ? ' flash' : ''}${tail ? ` append=${TAIL_RATE}` : ''}${resizing ? ' resize' : ''}${selecting ? ' select' : ''}`;
      const params: Record<string, string> = { shape };
      if (cells) Object.assign(params, { cells, 'probe-cells': '' });
      if (feed) params.live = String(LIVE_RATE);
      if (feed && flashing) params['probe-cells'] = '';
      if (flash) params.flash = '';
      if (tail) Object.assign(params, { rows: String(TAIL_ROWS), append: String(TAIL_RATE), follow: '' });
      let session: Awaited<ReturnType<typeof open>> | null = null;
      try {
        // Inside the try: a browser that fails to launch is a failure, and the rest still run.
        session = await open(engine, server.url, { params, init: tail ? [firstDrawProbe, presentingTaskRecorder, tailRecorder] : feed ? [firstDrawProbe, presentingTaskRecorder] : resizing ? [firstDrawProbe, widthsRecorder] : [firstDrawProbe] });
        const { page } = session;
        const first = await waitMark(page, FIRST_FRAME_MARK);
        const filled = await waitMark(page, FILLED_MARK);
        const { shown: start, layout } = await shown(page);
        const api = await page.evaluate(() => (globalThis as { __seizaProbe?: FirstDrawProbe }).__seizaProbe?.api ?? 'none');
        // The resize run checks its own moves, from the first screen.
        if (resizing) {
          const resized = await checkResize(page, label, layout);
          if (session.problems.length) failures.push(`${label}: ${session.problems.join('; ')}`);
          console.log(`${label}: first frame ${first.toFixed(0)} ms, filled ${filled.toFixed(0)} ms (${api})${resized}`);
          continue;
        }
        // The select run too, from the first screen.
        if (selecting) {
          const chose = await checkSelect(page, label, layout, start);
          if (session.problems.length) failures.push(`${label}: ${session.problems.join('; ')}`);
          console.log(`${label}: first frame ${first.toFixed(0)} ms, filled ${filled.toFixed(0)} ms (${api})${chose}`);
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
}
if (failures.length) {
  console.error(`FAIL\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log('ok');
