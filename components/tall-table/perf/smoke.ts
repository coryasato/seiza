// The bare host on its release build, in each browser: in both shapes, it
// draws its first frame, fills, scrolls down by wheel (and sideways in the
// wide shape), fills again there, and reports no page errors. Built with
// `custom-cells`, it does so again at each painted style (`?cells=heat`,
// `bars`, `color`), and checks the drawn cells carry their paint and, with
// heat, that a fill is on screen in the color the table says it drew. Built
// with `live`, it runs the narrow shape again with the feed on
// (`?live=1000`): re-read rows draw, and the refreshed mark lands right
// after a presented frame (shared-web/perf/'s `presentedMark`).
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
import { FILLED_MARK, FIRST_FRAME_MARK, PORT, REFRESHED_GLOBAL, REFRESHED_MARK, SHAPES, builtFeatures, drawnCells, filledWhere, hostWebDir, pixel, shown, visibleColumns, type Cell, type CellStyle, type Layout, type Shown } from './harness.ts';

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

/** With the feed on: the refreshed generation climbs, each of `LIVE_MARKS`
 *  refreshed marks lands right after a presented frame, in its presenting
 *  task, and the frame then shows no placeholder. */
async function checkLive(page: Page, label: string): Promise<string> {
  const since = await page.evaluate(() => performance.now());
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
  return `, refreshed to generation ${generation} (${marks[0]})`;
}

/** The drawn cells carry `style`'s paint, and (heat) a fill shows on screen
 *  in its color, sampled clear of the text at its cell's top-left. */
async function checkPaint(page: Page, style: CellStyle, layout: Layout, label: string): Promise<string> {
  const view = await filledWhere(page, 'true');
  const drawn = await drawnCells(page);
  const field = ({ heat: 'fill', bars: 'bar', color: 'text' } as const)[style as 'heat' | 'bars' | 'color'];
  const paintedCells = drawn.filter((cell) => cell[field]);
  if (!paintedCells.length) {
    failures.push(`${label}: no drawn cell has a ${field}`);
    return '';
  }
  if (style !== 'heat') return `, ${paintedCells.length}/${drawn.length} cells with a ${field}`;
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
    const runs = SHAPES.flatMap((shape) => [{ shape, cells: undefined as CellStyle | undefined, feed: false }, ...painted.map((cells) => ({ shape, cells, feed: false }))]);
    if (live) runs.push({ shape: 'narrow', cells: undefined, feed: true });
    for (const { shape, cells, feed } of runs) {
      const label = `${name} ${shape}${cells ? ` ${cells}` : ''}${feed ? ` live=${LIVE_RATE}` : ''}`;
      const params: Record<string, string> = { shape };
      if (cells) Object.assign(params, { cells, 'probe-cells': '' });
      if (feed) params.live = String(LIVE_RATE);
      let session: Awaited<ReturnType<typeof open>> | null = null;
      try {
        // Inside the try: a browser that fails to launch is a failure, and the rest still run.
        session = await open(engine, server.url, { params, init: feed ? [firstDrawProbe, presentingTaskRecorder] : [firstDrawProbe] });
        const { page } = session;
        const first = await waitMark(page, FIRST_FRAME_MARK);
        const filled = await waitMark(page, FILLED_MARK);
        const { shown: start, layout } = await shown(page);
        const api = await page.evaluate(() => (globalThis as { __seizaProbe?: FirstDrawProbe }).__seizaProbe?.api ?? 'none');
        await page.mouse.move(layout.left + 200, layout.top + 200);
        await wheel(page, 40 * layout.rowHeight);
        const down = await filledWhere(page, `s.first >= ${start.first + 30}`);
        let sideways = '';
        if (shape === 'wide') {
          await wheel(page, 0, 3_000);
          const right = await filledWhere(page, 's.scrollX >= 2000');
          sideways = `, sideways to ${right.scrollX.toFixed(0)} px (${visibleColumns(layout, right.scrollX)} columns visible)`;
        }
        const paint = cells ? await checkPaint(page, cells, layout, label) : '';
        const refreshed = feed ? await checkLive(page, label) : '';
        if (session.problems.length) failures.push(`${label}: ${session.problems.join('; ')}`);
        console.log(`${label}: first frame ${first.toFixed(0)} ms, filled ${filled.toFixed(0)} ms (${api}), ${start.rows} rows, ${layout.columns.length} columns, rows ${start.first}–${start.end} → ${down.first}–${down.end}${sideways}${paint}${refreshed}`);
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
