// What the release build shows, in headless Chromium (1440×900 at DPR 2):
// things to see and a few numbers to write down, never a budget (a showcase
// has none).
//
//   paint   a load on Fast 4G with the CPU slowed 4×: a screenshot right after
//           GPUI's first frame (out/first-frame.jpg) and one while the files
//           arrive (out/loading.jpg). Then cold loads unthrottled: the order
//           of each load's requests and marks. Fails if anything but the
//           page, its script, the wasm, and the font was asked for before
//           the first frame, or if the first-frame mark isn't right after a
//           task that did GPU work.
//   table   the panel opened by its handle: the rows the table says it has
//           against the manifest's, its columns, the first row's cells as
//           drawn, the columns under a sideways wheel, then End and the last
//           row's (out/table.jpg, out/table-columns*.jpg, out/table-end.jpg). Fails unless the first row is Ceres and the
//           last the fixture's last.
//   memory  the wasm's memory at the first frame, with both files held, and
//           (with `table`) with the table open, against the files' own bytes. Fails if
//           holding the files grew it by more than their bytes and 8 MB.
//
// Usage: node apps/kirkwood/checks/see.ts [--only paint,table,memory] [--runs 5]
// --only picks what's run and checked, not only what's printed.
// Run `just kirkwood build` first. Writes out/seen.json.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Page } from '@playwright/test';
import { clickTarget, firstDrawProbe, open, waitMark, wheel, type FirstDrawProbe } from '../../../shared-web/perf/harness.ts';
import { PROFILES, localDate, machineInfo, median, option } from '../../../shared-web/perf/protocol.ts';
import { serveApp } from '../../../shared-web/perf/serve.ts';

const dir = import.meta.dirname;
const out = join(dir, 'out');
const PORT = 4370;
const RUNS = Number(option('runs') ?? 5);
const PARTS = ['paint', 'table', 'memory'];
const ONLY = new Set((option('only') ?? PARTS.join(',')).split(','));
if (!Number.isInteger(RUNS) || RUNS < 1) throw new Error(`--runs wants a whole number of loads, 1 or more; got "${option('runs')}"`);
if (!ONLY.size || [...ONLY].some((part) => !PARTS.includes(part))) throw new Error(`--only wants some of ${PARTS.join(', ')}; got "${option('only')}"`);

const FIRST_FRAME = 'gpui:first-frame';
const ELEMENTS = 'kirkwood:elements';
const ROWS = 'kirkwood:rows';
const TABLE = 'kirkwood:table';
/** What first paint may wait on, by path. */
const FIRST_PAINT = [/^\/$/, /^\/assets\/index-[\w-]+\.js$/, /^\/assets\/kirkwood_bg-[\w-]+\.wasm$/, /^\/assets\/IBMPlexSans-Regular-[\w-]+\.ttf$/];

type FileInfo = { rows: number; bytes: number };
const manifest = JSON.parse(readFileSync(join(dir, '../data/MANIFEST.json'), 'utf8')) as Record<'elements.bin' | 'rows.bin', FileInfo>;
const fixture = JSON.parse(readFileSync(join(dir, '../data/fixture.json'), 'utf8')) as { rows: { row: number; cells: { full_name: string } }[] };
const FILE_BYTES = manifest['elements.bin'].bytes + manifest['rows.bin'].bytes;
const TABLE_ROWS = manifest['rows.bin'].rows;

type Kirkwood = { wasmBytes(): number; wasmBytesAtFirstFrame: number };
type Probe = { rows: number; first: number; end: number; loaded: number; pending: number };
type Layout = { left: number; top: number; rowHeight: number; columns: { name: string }[] };
type Cell = { row: number; column: number; exact: string; shown: string };
type Page_ = { __kirkwood: Kirkwood; __kirkwoodTable?: Probe; __kirkwoodLayout?: Layout; __kirkwoodCells?: Cell[] };

const round = (ms: number) => Number(ms.toFixed(1));
const mb = (bytes: number) => Number((bytes / 1e6).toFixed(2));
const shot = (page: Page, name: string) => page.screenshot({ path: join(out, `${name}.jpg`), type: 'jpeg', quality: 85 });

/** The drawn cells of `row`, by column, once the table has drawn it loaded. */
async function drawnRow(page: Page, row: number): Promise<string[]> {
  try {
    const handle = await page.waitForFunction(
      (row) => {
        const cells = (globalThis as unknown as Page_).__kirkwoodCells?.filter((cell) => cell.row === row) ?? [];
        return cells.length ? cells.sort((a, b) => a.column - b.column).map((cell) => cell.exact) : false;
      },
      row,
      { timeout: 15_000, polling: 50 },
    );
    return (await handle.jsonValue()) as string[];
  } catch {
    const state = await page.evaluate(() => {
      const page = globalThis as unknown as Page_;
      return { probe: page.__kirkwoodTable, drawn: [...new Set(page.__kirkwoodCells?.map((cell) => cell.row))] };
    });
    throw new Error(`row ${row} wasn't drawn: the table shows ${JSON.stringify(state)}`);
  }
}

/** A load on a slow link, for the first frame and the loading state as a visitor sees them. */
async function slowShots(url: string): Promise<void> {
  const { page, close } = await open(chromium, url, { profile: PROFILES.find((profile) => profile.name === 'throttled')! });
  try {
    await waitMark(page, FIRST_FRAME);
    await shot(page, 'first-frame');
    await page.waitForTimeout(6000);
    await shot(page, 'loading');
  } finally {
    await close();
  }
}

async function load(url: string, first: boolean) {
  const { page, problems, close } = await open(chromium, url, { init: [firstDrawProbe], params: { 'probe-cells': '' } });
  try {
    const marks = {
      firstFrame: await waitMark(page, FIRST_FRAME),
      elements: await waitMark(page, ELEMENTS),
      rows: await waitMark(page, ROWS),
    };
    const seen = await page.evaluate(() => {
      const kirkwood = (globalThis as unknown as Page_).__kirkwood;
      const probe = (globalThis as { __seizaProbe?: FirstDrawProbe }).__seizaProbe;
      return {
        requests: (performance.getEntriesByType('resource') as PerformanceResourceTiming[]).map((entry) => ({ path: new URL(entry.name).pathname, start: entry.startTime, end: entry.responseEnd })),
        gpuTasks: probe?.gpuTasks ?? [],
        api: probe?.api ?? '',
        wasmAtFirstFrame: kirkwood.wasmBytesAtFirstFrame,
        wasmWithFiles: kirkwood.wasmBytes(),
      };
    });
    const requests = [{ path: '/', start: 0, end: 0 }, ...seen.requests].sort((a, b) => a.start - b.start);

    const result = {
      marks,
      api: seen.api,
      requests: requests.filter((request) => request.start <= marks.rows).map((request) => ({ path: request.path, startMs: round(request.start), endMs: round(request.end) })),
      table: null as { rows: number; columns: string[]; firstRow: string[]; lastRow: string[] } | null,
      memory: { atFirstFrame: seen.wasmAtFirstFrame, withFiles: seen.wasmWithFiles, withTable: null as number | null },
    };
    if (ONLY.has('paint')) checkPaint(requests, marks.firstFrame, seen.gpuTasks);
    if (ONLY.has('table')) {
      result.table = await seeTable(page, first);
      result.memory.withTable = await page.evaluate(() => (globalThis as unknown as Page_).__kirkwood.wasmBytes());
    }
    if (problems.length) throw new Error(`the page's problems: ${problems.join(' | ')}`);
    return result;
  } finally {
    await close();
  }
}

/** The first frame is on screen before anything but what it's made of is
 *  asked for, and its mark is honest. */
function checkPaint(requests: { path: string; start: number }[], firstFrame: number, gpuTasks: FirstDrawProbe['gpuTasks']): void {
  const early = requests.filter((request) => request.start < firstFrame && !FIRST_PAINT.some((pattern) => pattern.test(request.path)));
  if (early.length) throw new Error(`asked for before the first frame (${round(firstFrame)} ms): ${early.map((request) => `${request.path} at ${round(request.start)}`).join(', ')}`);
  const data = requests.filter((request) => request.path.startsWith('/data/'));
  if (data.map((request) => request.path).join() !== '/data/elements.bin,/data/rows.bin') throw new Error(`the data asked for: ${data.map((request) => request.path).join(', ') || 'none'}`);
  // The mark is honest: inside the task that drew and presented the frame.
  const presenting = gpuTasks.find((task) => task.end !== null && task.lastGpuCall <= firstFrame && firstFrame <= task.end);
  if (!presenting) throw new Error(`the first-frame mark (${round(firstFrame)} ms) isn't right after a task that did GPU work`);
}

/** The table, behind its handle: what it says it has, and what it draws. */
async function seeTable(page: Page, first: boolean) {
  await clickTarget(page, 'table-handle');
  await waitMark(page, TABLE);
  const firstRow = await drawnRow(page, 0);
  // Let the panel's slide land before its picture, and before the cells' places are read.
  await page.waitForTimeout(500);
  const { probe, layout } = await page.evaluate(() => {
    const page = globalThis as unknown as Page_;
    return { probe: page.__kirkwoodTable!, layout: page.__kirkwoodLayout! };
  });
  if (first) {
    await shot(page, 'table');
    // The columns past the panel's width, by a sideways wheel, and back.
    await page.mouse.move(layout.left + 200, layout.top + layout.rowHeight * 3.5);
    for (const [name, x] of [['table-columns', 520], ['table-columns-end', 2000]] as const) {
      await wheel(page, 0, x);
      await page.waitForTimeout(400);
      await shot(page, name);
    }
    await wheel(page, 0, -4000);
    await page.waitForTimeout(400);
  }
  // Every row is there: End (the open panel has the keys), and the last
  // row drawn; then a press on a cell and Home, for the keys after a press.
  await page.keyboard.press('End');
  const lastRow = await drawnRow(page, TABLE_ROWS - 1);
  if (first) await shot(page, 'table-end');
  await page.mouse.click(layout.left + 200, layout.top + layout.rowHeight * 3.5);
  await page.keyboard.press('Home');
  await drawnRow(page, 0);
  return { rows: probe.rows, columns: layout.columns.map((column) => column.name), firstRow, lastRow };
}

mkdirSync(out, { recursive: true });
const server = await serveApp(undefined, { webDir: join(dir, '../web'), port: PORT });
try {
  if (ONLY.has('paint')) await slowShots(server.url);
  const loads: Awaited<ReturnType<typeof load>>[] = [];
  for (let run = 0; run < RUNS; run++) loads.push(await load(server.url, run === 0));
  const first = loads[0]!;
  const of = (pick: (run: Awaited<ReturnType<typeof load>>) => number) => {
    const values = loads.map(pick);
    return { median: round(median(values)), min: round(Math.min(...values)), max: round(Math.max(...values)) };
  };
  const seen: Record<string, unknown> = { date: localDate(), ...machineInfo(), runs: RUNS, viewport: '1440x900 at DPR 2, headless Chromium, cold, unthrottled, the files local and as they are' };

  if (ONLY.has('paint')) {
    seen.paint = {
      api: first.api,
      firstFrameMs: of((run) => run.marks.firstFrame),
      elementsHeldMs: of((run) => run.marks.elements),
      rowsHeldMs: of((run) => run.marks.rows),
      // One load's requests and marks, in order.
      order: [
        ...first.requests.map((request) => ({ at: request.startMs, what: `asked for ${request.path}`, until: request.endMs })),
        { at: round(first.marks.firstFrame), what: `mark ${FIRST_FRAME}` },
        { at: round(first.marks.elements), what: `mark ${ELEMENTS}` },
        { at: round(first.marks.rows), what: `mark ${ROWS}` },
      ].sort((a, b) => a.at - b.at),
    };
  }
  if (ONLY.has('table')) {
    const ceres = fixture.rows.find((row) => row.row === 0)!.cells.full_name;
    const last = fixture.rows.find((row) => row.row === TABLE_ROWS - 1)!.cells.full_name;
    for (const run of loads.flatMap(({ table }) => (table ? [{ table }] : []))) {
      if (run.table.rows !== TABLE_ROWS) throw new Error(`the table has ${run.table.rows} rows, and the manifest ${TABLE_ROWS}`);
      if (run.table.columns.length !== 18) throw new Error(`the table has ${run.table.columns.length} columns`);
      if (run.table.firstRow[1] !== ceres) throw new Error(`the first row is ${run.table.firstRow[1]}, not ${ceres}`);
      if (run.table.lastRow[1] !== last) throw new Error(`the last row is ${run.table.lastRow[1]}, not ${last}`);
    }
    seen.table = first.table;
  }
  if (ONLY.has('memory')) {
    const grew = loads.map((run) => run.memory.withFiles - run.memory.atFirstFrame);
    const worst = Math.max(...grew);
    if (worst > FILE_BYTES + 8e6) throw new Error(`holding the files grew the wasm's memory by ${mb(worst)} MB, and the files are ${mb(FILE_BYTES)} MB: a second copy of something`);
    seen.memory = {
      filesMB: mb(FILE_BYTES),
      wasmAtFirstFrameMB: mb(first.memory.atFirstFrame),
      wasmWithFilesMB: mb(first.memory.withFiles),
      grewByMB: mb(grew[0]!),
      grewByWorstMB: mb(worst),
      ...(first.memory.withTable === null ? {} : { wasmWithTableOpenMB: mb(first.memory.withTable) }),
    };
  }
  writeFileSync(join(out, 'seen.json'), `${JSON.stringify(seen, null, 2)}\n`);
  console.log(JSON.stringify(seen, null, 2));
} finally {
  await server.close();
}
