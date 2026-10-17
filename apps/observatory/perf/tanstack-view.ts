// The TanStack contender's view on its release build: it opens the data
// file and reaches the last row in Chromium, Firefox, and WebKit, and it
// starts its engine in a page that never paints.
//
// Checks:
// - Reach, per browser (the protocol's page, 1440×900 at DPR 2): row 0
//   drawn with data, then End shows the last row, filled, its bottom at the
//   rows' viewport's bottom, its number `count(*)` and its key (spkid) the
//   file's last, both from native DuckDB (data/'s, independent of the
//   page's engine). The header names the file's columns, at the GPUI
//   contender's widths (`--gpui`: read from its build's `ColumnProbe`s).
// - A hidden frame (the observatory page's case, Chromium): the contender
//   in a same-origin `display: none` iframe (a zero-size viewport) has no
//   paint entry, yet it requests the engine at once and opens the file;
//   shown, its rows fill.
// - A page hidden from the start (Chromium, a background tab emulated: hidden,
//   no frames, no paint entries): the engine is requested at once.
// - No page errors, console errors, or failed requests.
//
// Usage: node apps/observatory/perf/tanstack-view.ts [--browsers chromium,firefox,webkit] [--gpui] [--shots <dir>] [--label <name>]
// --gpui compares the columns with the GPUI contender's build (`just
// observatory gpui-build` first); --shots writes screenshots (light and
// dark, row 0 and the end) to <dir>; --label writes
// perf/results/<date>-<label>.json. Needs `just observatory data`; run
// `just observatory tanstack-build` first.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, firefox, webkit, type Browser, type BrowserType, type Page } from '@playwright/test';
import { crossOriginIsolationHeaders } from '../../../shared-web/src/vite.ts';
import { flag, machineInfo, option } from '../../../shared-web/perf/protocol.ts';
import { waitMark } from '../../../shared-web/perf/harness.ts';
import { ENGINE_CHUNK, MARKS, dataFile, perfDir, problems, protocolContext, serveGpui, serveTanstack, nativeDuckDB } from './harness.ts';

const PORT = 4317;
const GPUI_PORT = 4318;
/** A page that can't paint starts its engine at once; one waiting for a
 *  paint that never comes would never start it. */
const HIDDEN_START_MS = 500;

/** In the page: its paint entries, and when it requested the engine's JS
 *  chunk (the open imports it first; DuckDB's worker isn't in the page's
 *  resource timing). */
const engineStart = (chunk: string) => ({
  paints: performance.getEntriesByType('paint').length,
  engine: performance.getEntriesByType('resource').find((entry) => new RegExp(chunk).test(entry.name))?.startTime ?? null,
});
/** DuckDB-Wasm's own `eh` bundle warns in Firefox; the engine's, not the view's. */
const ENGINE_WARNING = /WebAssembly exception handling 'try' instruction is deprecated/;
const label = option('label');
const shots = option('shots');
const browsers = (option('browsers') ?? 'chromium,firefox,webkit').split(',');
const failures: string[] = [];
if (shots) mkdirSync(shots, { recursive: true });
const output: Record<string, unknown> = { date: new Date().toISOString().slice(0, 10), label, ...machineInfo() };
const check = (ok: boolean, problem: string) => {
  if (!ok) failures.push(problem);
  return ok;
};

// --- the file's facts, from native DuckDB ---

const conn = await nativeDuckDB();
const file = `'${dataFile.replaceAll("'", "''")}'`;
const rowsOf = async (sql: string) => (await conn.runAndReadAll(sql)).getRows();
const count = Number((await rowsOf(`SELECT count(*) FROM read_parquet(${file})`))[0]![0]);
const lastKey = String((await rowsOf(`SELECT spkid FROM read_parquet(${file}, file_row_number = true) WHERE file_row_number = ${count - 1}`))[0]![0]);
const names = (await rowsOf(`DESCRIBE SELECT * FROM read_parquet(${file})`)).map((row) => String(row[0]));
output.file = { count, lastKey, columns: names };
console.log(`native DuckDB: count(*) ${count}, last spkid ${lastKey}, ${names.length} columns`);

// --- the page ---

interface Drawn {
  /** The header's names and widths. */
  head: { name: string; width: number }[];
  /** A drawn row: its number's text, its cells' text, and its box against
   *  the rows' viewport (the scroller below the header). */
  row: { number: string; cells: string[]; top: number; bottom: number; viewportBottom: number } | null;
}

/** The header, and row `row` once it's drawn with data. */
function drawnRow(page: Pick<Page, 'waitForFunction'>, row: number): Promise<Drawn> {
  return page
    .waitForFunction(
      (row) => {
        const scroller = document.querySelector('.scroller');
        const element = document.querySelector(`.row[data-row="${row}"]`);
        const head = [...document.querySelectorAll('.head > .cell')].map((cell) => ({ name: cell.textContent ?? '', width: cell.getBoundingClientRect().width }));
        if (!scroller || !element) return false;
        const failed = element.querySelector('.failed')?.textContent;
        if (failed) return { head, row: null, failed };
        if (element.querySelector('.cell.pending')) return false;
        const cells = [...element.querySelectorAll('.cell')].map((cell) => cell.textContent ?? '');
        if (cells.length !== head.length) return false;
        const box = element.getBoundingClientRect();
        const outer = scroller.getBoundingClientRect();
        return {
          head,
          row: {
            number: element.querySelector('.num')?.textContent ?? '',
            cells,
            top: box.top,
            bottom: box.bottom,
            viewportBottom: outer.top + scroller.clientTop + scroller.clientHeight,
          },
        };
      },
      row,
      { timeout: 60_000, polling: 20 },
    )
    .then(async (handle) => {
      const drawn = (await handle.jsonValue()) as Drawn & { failed?: string };
      if (drawn.failed) throw new Error(`row ${row} failed: ${drawn.failed}`);
      return drawn;
    });
}

/** The GPUI contender's columns (its `ColumnProbe`s, with `?cells`). */
async function gpuiColumns(browser: Browser): Promise<{ name: string; width: number }[]> {
  const server = await serveGpui(GPUI_PORT);
  try {
    const context = await browser.newContext({ viewport: { width: 2560, height: 900 } });
    const page = await context.newPage();
    await page.goto(`${server.url}?measure&cells`);
    await waitMark(page, MARKS.filled, 0);
    const handle = await page.waitForFunction(() => (globalThis as { __contender?: { columns?: unknown } }).__contender?.columns ?? false, null, { timeout: 60_000 });
    const columns = (await handle.jsonValue()) as { name: string; width: number }[];
    await context.close();
    return columns;
  } finally {
    await server.close();
  }
}

const server = await serveTanstack(PORT);
try {
  const types: Record<string, BrowserType> = { chromium, firefox, webkit };
  const reach: Record<string, unknown> = {};
  for (const name of browsers) {
    const type = types[name];
    if (!type) throw new Error(`unknown browser ${name}`);
    const browser = await type.launch();
    try {
      for (const scheme of shots ? (['light', 'dark'] as const) : (['light'] as const)) {
        const context = await protocolContext(browser);
        const page = await context.newPage();
        await page.emulateMedia({ colorScheme: scheme });
        const found = problems(page);
        await page.goto(server.url);
        const first = await drawnRow(page, 0);
        const shot = (what: string) => (shots ? page.screenshot({ path: join(shots, `tanstack-${name}-${scheme}-${what}.png`) }) : undefined);
        await shot('top');
        await page.keyboard.press('End');
        const last = await drawnRow(page, count - 1);
        await shot('end');
        const row = last.row!;
        if (scheme === 'light') {
          check(first.head.map((cell) => cell.name).join() === names.join(), `${name}: the header ${first.head.map((cell) => cell.name).join()}, the file's columns ${names.join()}`);
          check(first.row!.number === '1', `${name}: row 0's number ${first.row!.number}`);
          check(row.number === count.toLocaleString('en-US'), `${name}: the last row's number ${row.number}, count(*) ${count}`);
          check(row.cells[0] === lastKey, `${name}: the last row's spkid ${row.cells[0]}, the file's last ${lastKey}`);
          check(Math.abs(row.bottom - row.viewportBottom) <= 1, `${name}: the last row's bottom ${row.bottom}, the viewport's ${row.viewportBottom}`);
          reach[name] = { head: first.head, firstRow: first.row, lastRow: row };
          console.log(`${name}: End → row ${row.number} (spkid ${row.cells[0]}), bottom ${row.bottom.toFixed(1)} of ${row.viewportBottom.toFixed(1)}`);
        }
        const real = found.filter((problem) => !ENGINE_WARNING.test(problem));
        check(real.length === 0, `${name} (${scheme}) page problems: ${real.join('; ')}`);
        await context.close();
      }
    } finally {
      await browser.close();
    }
  }
  output.reach = reach;

  const browser = await chromium.launch();
  try {
    if (flag('gpui') && reach.chromium) {
      const gpui = await gpuiColumns(browser);
      const head = (reach.chromium as { head: { name: string; width: number }[] }).head;
      const differ = gpui.filter((column, index) => head[index]?.name !== column.name || Math.abs(head[index]!.width - column.width) > 0.01);
      check(differ.length === 0 && gpui.length === head.length, `columns differ from the GPUI contender's: ${JSON.stringify(differ)} (TanStack ${JSON.stringify(head)})`);
      output.gpuiColumns = gpui;
      console.log(`columns: the GPUI contender's widths (${gpui.map((column) => `${column.name} ${column.width.toFixed(1)}`).join(', ')})`);
    }

    // A hidden frame: a same-origin parent with the contender in a
    // `display: none` iframe, which never paints.
    {
      const context = await protocolContext(browser);
      const parent = `${server.url}hidden-frame.html`;
      await context.route(parent, (route) =>
        route.fulfill({
          contentType: 'text/html',
          headers: { ...crossOriginIsolationHeaders },
          body: `<!doctype html><body style="margin:0"><iframe id="contender" src="./" style="display:none;border:0;width:100%;height:900px"></iframe></body>`,
        }),
      );
      const page = await context.newPage();
      const found = problems(page);
      await page.goto(parent);
      const frame = await (await page.waitForSelector('#contender', { state: 'attached' })).contentFrame();
      if (!frame) throw new Error('no contender frame');
      // Open: the table's header is drawn (the file's columns are known).
      await frame.waitForSelector('.head', { state: 'attached', timeout: 60_000 });
      const hidden = await frame.evaluate(engineStart, ENGINE_CHUNK.source);
      check(hidden.paints === 0, `hidden frame: ${hidden.paints} paint entries (it painted, so the hidden path isn't what started it)`);
      check(hidden.engine !== null && hidden.engine < HIDDEN_START_MS, `hidden frame: engine chunk requested at ${hidden.engine} ms, not before ${HIDDEN_START_MS} ms`);
      await page.evaluate(() => (document.getElementById('contender')!.style.display = 'block'));
      const shown = await drawnRow(frame, 0);
      check(shown.row !== null, 'hidden frame: no rows once shown');
      check(found.length === 0, `hidden frame problems: ${found.join('; ')}`);
      output.hiddenFrame = { ...hidden, shownRow0: shown.row?.cells.slice(0, 2) };
      console.log(`hidden frame: no paint, a zero-size viewport; engine chunk requested at ${hidden.engine?.toFixed(1)} ms, the file opened; shown, row 0 filled`);
      await context.close();
    }

    // A page hidden from the start (a background tab): no wait for a paint.
    {
      const context = await protocolContext(browser, {
        init: [
          // A background tab: hidden, no frames, no paint entries: only the
          // visibility path can start the engine.
          () => {
            Object.defineProperty(Document.prototype, 'visibilityState', { get: () => 'hidden' });
            Object.defineProperty(Document.prototype, 'hidden', { get: () => true });
            Object.defineProperty(PerformanceObserver, 'supportedEntryTypes', { value: PerformanceObserver.supportedEntryTypes.filter((type) => type !== 'paint') });
            window.requestAnimationFrame = () => 0;
          },
        ],
      });
      const page = await context.newPage();
      const found = problems(page);
      await page.goto(server.url);
      await page.waitForSelector('.head', { state: 'attached', timeout: 60_000 });
      const timing = await page.evaluate(engineStart, ENGINE_CHUNK.source);
      check(timing.engine !== null && timing.engine < HIDDEN_START_MS, `hidden page: engine chunk requested at ${timing.engine} ms, not before ${HIDDEN_START_MS} ms`);
      check(found.length === 0, `hidden page problems: ${found.join('; ')}`);
      output.hiddenPage = timing;
      console.log(`hidden page: engine chunk requested at ${timing.engine?.toFixed(1)} ms, with no paint or frame to wait for`);
      await context.close();
    }
  } finally {
    await browser.close();
  }
} finally {
  await server.close();
}

if (label) {
  const out = join(perfDir, 'results', `${output.date}-${label}.json`);
  mkdirSync(join(perfDir, 'results'), { recursive: true });
  writeFileSync(out, `${JSON.stringify({ ...output, failures }, null, 2)}\n`);
  console.log(`wrote ${out}`);
}
if (failures.length > 0) {
  console.error(`\n${failures.length} failed:\n${failures.map((failure) => `- ${failure}`).join('\n')}`);
  process.exit(1);
}
console.log('\nall passed');
