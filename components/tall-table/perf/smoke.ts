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
// follows again.
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
import { FILLED_MARK, FIRST_FRAME_MARK, FOLLOWING_GLOBAL, PORT, REFRESHED_GLOBAL, REFRESHED_MARK, TAIL_MARK, SHAPES, builtFeatures, drawnCells, filledWhere, hostWebDir, pixel, shown, visibleColumns, type Cell, type CellStyle, type Layout, type Shown } from './harness.ts';

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

/** Global `name` on the page. */
async function global<T>(page: Page, name: string): Promise<T | undefined> {
  return page.evaluate((name) => (globalThis as Record<string, unknown>)[name] as T | undefined, name);
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
    const runs = SHAPES.flatMap((shape) => [{ shape, cells: undefined as CellStyle | undefined, feed: false, flash: false, tail: false }, ...painted.map((cells) => ({ shape, cells, feed: false, flash: false, tail: false }))]);
    if (live) runs.push({ shape: 'narrow', cells: undefined, feed: true, flash: false, tail: false });
    if (flashing) runs.push({ shape: 'narrow', cells: undefined, feed: true, flash: true, tail: false });
    if (follow) runs.push({ shape: 'narrow', cells: undefined, feed: false, flash: false, tail: true });
    for (const { shape, cells, feed, flash, tail } of runs) {
      const label = `${name} ${shape}${cells ? ` ${cells}` : ''}${feed ? ` live=${LIVE_RATE}` : ''}${flash ? ' flash' : ''}${tail ? ` append=${TAIL_RATE}` : ''}`;
      const params: Record<string, string> = { shape };
      if (cells) Object.assign(params, { cells, 'probe-cells': '' });
      if (feed) params.live = String(LIVE_RATE);
      if (feed && flashing) params['probe-cells'] = '';
      if (flash) params.flash = '';
      if (tail) Object.assign(params, { rows: String(TAIL_ROWS), append: String(TAIL_RATE), follow: '' });
      let session: Awaited<ReturnType<typeof open>> | null = null;
      try {
        // Inside the try: a browser that fails to launch is a failure, and the rest still run.
        session = await open(engine, server.url, { params, init: tail ? [firstDrawProbe, presentingTaskRecorder, tailRecorder] : feed ? [firstDrawProbe, presentingTaskRecorder] : [firstDrawProbe] });
        const { page } = session;
        const first = await waitMark(page, FIRST_FRAME_MARK);
        const filled = await waitMark(page, FILLED_MARK);
        const { shown: start, layout } = await shown(page);
        const api = await page.evaluate(() => (globalThis as { __seizaProbe?: FirstDrawProbe }).__seizaProbe?.api ?? 'none');
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
