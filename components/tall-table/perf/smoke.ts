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
// pin. Chromium is granted
// `clipboard-read` and
// `clipboard-write` (a real Chrome grants a focused page the write);
// WebKit on macOS writes the system pasteboard, so the run overwrites
// what was copied there.
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
import { DEFAULT_PINNED, FILLED_MARK, PINNED_GLOBAL, FIRST_FRAME_MARK, FOLLOWING_GLOBAL, PORT, READS_SENT_GLOBAL, REFRESHED_GLOBAL, REFRESHED_MARK, SELECTION_GLOBAL, TAIL_MARK, SHAPES, SORTED_COLUMN, WIDTHS_GLOBAL, arrowAt, bandAt, builtFeatures, cellAt, copyReached, drawnCells, exactTexts, filledWhere, global, gutterAt, headerAt, hostWebDir, laidOutAt, lastCopyId, parseTsv, paste, differingPixels, pinEdge, pinThrough, pinnedAs, pixel, screenLeft, screenshot, selectThrough, selected, shown, sidewaysRoom, sortedAs, sourceRows, visibleColumns, type Cell, type CellStyle, type CopyState, type Layout, type Selection, type Shape, type Shown, type Sort } from './harness.ts';

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
  // The last column whose edge is in view with room left of it (with
  // `pin`, past the last pinned column's band, which reaches its 4 px half
  // right of the run's edge and takes a press there).
  const edges = laid.columns.map((column, index) => ({ index, edge: screenLeft(laid, index, end.scrollX) + column.width }));
  const clear = (laid.pinned ?? 0) > 0 ? pinEdge(laid) + 4 : 0;
  const narrow = edges.filter(({ edge }) => edge > clear && edge < laid.cellsWidth - 2).at(-1)!.index;
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
      await pressAt(page, { x: layout.left + screenLeft(layout, column, 0) + 8, y: arrow.y });
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

/** With `pin`: the pinned and scrolled regions' screen under a sideways
 *  scroll, against the same table with nothing pinned (the host's hook),
 *  the edge line, the horizontal thumb pressed and dragged from the run's
 *  edge, a viewport narrowed past the half and widened again, and with
 *  `select` a press on a pinned cell and a scrolled one, with `resize` the
 *  last pinned column's band dragged. */
async function checkPin(page: Page, label: string, start: Layout, shape: Shape): Promise<string> {
  const notes: string[] = [];
  const want = DEFAULT_PINNED[shape];
  const layout = await pinnedAs(page, want).catch(async () => failed(`${label}: ${start.pinned} pinned at open (published ${JSON.stringify(await global(page, PINNED_GLOBAL))}), not the shape's ${want}`));
  if (!layout) return '';
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
const browsers = (option('browsers') ?? 'chromium,firefox,webkit').split(',');
const server = await serveApp(undefined, { webDir: hostWebDir, port: PORT });
/** The build again at the LAN address, for the insecure-context run alone:
 *  started at its first run, so a machine without one fails only that. */
let lanServer: Awaited<ReturnType<typeof serveApp>> | null = null;
const failures: string[] = [];
try {
  for (const name of browsers) {
    const engine = engines[name];
    if (!engine) {
      failures.push(`unknown browser ${name}`);
      continue;
    }
    const quiet = { cells: undefined as CellStyle | undefined, feed: false, flash: false, tail: false, resizing: false, selecting: false, copying: undefined as CopyRun | undefined, sorting: undefined as SortRun | undefined, pinning: false };
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
    for (const { shape, cells, feed, flash, tail, resizing, selecting, copying, sorting, pinning } of runs) {
      const label = `${name} ${shape}${cells ? ` ${cells}` : ''}${feed ? ` live=${LIVE_RATE}` : ''}${flash ? ' flash' : ''}${tail ? ` append=${TAIL_RATE}` : ''}${resizing ? ' resize' : ''}${selecting ? ' select' : ''}${copying ? ` copy ${copying}` : ''}${sorting ? ` sort ${sorting}` : ''}${pinning ? ' pin' : ''}`;
      const params: Record<string, string> = { shape };
      if (sorting) params['probe-cells'] = '';
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
        session = await open(engine, url, { params, init: tail ? [firstDrawProbe, presentingTaskRecorder, tailRecorder] : feed ? [firstDrawProbe, presentingTaskRecorder] : resizing ? [firstDrawProbe, widthsRecorder] : [firstDrawProbe] });
        const { page } = session;
        // The clipboard's permissions, which a real Chrome grants a focused
        // page (the write); none to grant in an insecure context.
        if (copying && copying !== 'insecure' && engine === chromium) await session.context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(url).origin });
        const first = await waitMark(page, FIRST_FRAME_MARK);
        const filled = await waitMark(page, FILLED_MARK, 0, 60_000 + 2 * heldMs);
        const { shown: start, layout } = await shown(page);
        const api = await page.evaluate(() => (globalThis as { __seizaProbe?: FirstDrawProbe }).__seizaProbe?.api ?? 'none');
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
