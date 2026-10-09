// M7 part F checks: cell overflow, on the release build.
//
// Opens each file with `?cells`, so the table publishes every drawn cell's
// exact text and the text it handed GPUI (`__tychoCells`), and where its
// cells are (`__tychoTableLayout`). The observation panel is hidden, so it
// covers nothing. Files: both samples, and data/drop/overflow.parquet
// (`just tycho drop-files overflow`: values too wide for their columns, of
// every kind).
//
// 1. Nothing cut at the front. At the top, the middle, the end, and three
//    seeded rows between, scrolled sideways across every column, each fully
//    visible cell is checked in a screenshot: a number cell's left padding
//    (and a text cell's right padding) must have no ink, i.e. the value
//    stayed inside the cell. Every non-empty cell must have ink inside,
//    so the probe is shown to see text at all.
// 2. Rounded doubles: the shown text fits the column's budget and is the
//    exact value rounded (within half a unit of its last digit). Integers,
//    decimals, and text are shown exactly, line breaks as ¶ (GPUI may still
//    cut them).
// 3. Tooltips: resting the pointer on a rounded double, a cut text, a
//    multi-line text (shown with ¶), and a 38-digit DECIMAL (cut in the
//    middle) shows the exact value; a cell that fits shows none; crossing a
//    cell that fits, the next tooltip shows at once (grace period); a scroll
//    hides it. Screenshots go to perf/results/raw/.
//
// Usage: node apps/tycho/perf/cells.ts [--label m7-cells] [--files asteroids,gaia,overflow]
// Writes perf/results/<date>-<label>.json. Run `just tycho build` first.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from '@playwright/test';
import { preview } from 'vite';
import { assertPortFree, startWorkerDev, WORKER_DEV_PORT } from '../worker/scripts/dev.ts';
import { machineInfo, option } from './common.ts';
import { clickTarget, dropFile, open, startCountingProxy, targetRect, waitMark, waitOverlay, wheel, type TableProbe } from './harness.ts';

const perfDir = dirname(fileURLToPath(import.meta.url));
const webDir = join(perfDir, '../web');
const dataDir = join(perfDir, '../data');
const rawDir = join(perfDir, 'results/raw');
const manifest = JSON.parse(readFileSync(join(dataDir, 'MANIFEST.json'), 'utf8')) as Record<string, { rows: number }>;
const FILES = {
  asteroids: { sample: 'try-sample-asteroids', manifest: 'asteroids.parquet' },
  gaia: { sample: 'try-sample-gaia', manifest: 'gaia-dr3-bright.parquet' },
  overflow: { drop: join(dataDir, 'drop/overflow.parquet'), manifest: 'drop/overflow.parquet' },
} as const;
type FileName = keyof typeof FILES;
const files = (option('files') ?? 'asteroids,gaia,overflow').split(',') as FileName[];
for (const name of files) if (!(name in FILES)) throw new Error(`--files ${name}: ${Object.keys(FILES).join(' or ')}`);
const label = option('label') ?? 'm7-cells';
if (files.includes('overflow') && !existsSync(FILES.overflow.drop)) throw new Error('data/drop/overflow.parquet is missing: run `just tycho drop-files overflow`');

interface ColumnProbe {
  name: string;
  x: number;
  width: number;
  kind: 'text' | 'integer' | 'float' | 'decimal';
  budget: number;
}
interface Layout {
  left: number;
  top: number;
  rowHeight: number;
  topRow: number;
  scrollX: number;
  cellsWidth: number;
  columns: ColumnProbe[];
}
interface Cell {
  row: number;
  column: number;
  exact: string;
  shown: string;
}
type Global = {
  __tychoTable?: TableProbe & { tooltip: string | null; scrollX: number };
  __tychoTableLayout?: Layout;
  __tychoCells?: Cell[];
  __tychoTargets?: Record<string, [number, number, number, number]>;
  __seizaPerfOverlay?: unknown;
};

const now = (page: Page) => page.evaluate(() => performance.now());
const table = (page: Page) => page.evaluate(() => (globalThis as Global).__tychoTable ?? null);
/** The layout, with the scroll position (published with the table). */
const layout = (page: Page) =>
  page.evaluate((): Layout => {
    const g = globalThis as Global;
    return { ...g.__tychoTableLayout!, topRow: g.__tychoTable!.top, scrollX: g.__tychoTable!.scrollX };
  });
const frames = (page: Page, count = 2) =>
  page.evaluate((count) => new Promise<void>((resolve) => {
    const step = (left: number) => (left === 0 ? resolve() : requestAnimationFrame(() => step(left - 1)));
    step(count);
  }), count);

/** Waits until every visible row is loaded. */
async function loaded(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const t = (globalThis as Global).__tychoTable;
    return !!t && t.pending === 0 && t.loaded === t.end - t.first && t.loaded > 0;
  }, null, { timeout: 30_000, polling: 20 });
  await frames(page);
}

async function jump(page: Page, row: number): Promise<void> {
  await page.keyboard.press('Control+G');
  await page.waitForFunction(() => (globalThis as { __tychoWorkbench?: { focused: string | null } }).__tychoWorkbench?.focused === 'jump', null, { timeout: 5_000 });
  await page.keyboard.press('Backspace');
  await page.keyboard.type(String(row));
  await page.keyboard.press('Enter');
  await page.waitForFunction((index) => (globalThis as Global).__tychoTable?.marked === index, row - 1, { timeout: 30_000 });
  await loaded(page);
}

/** A cell is one line: line breaks show as `¶`. */
const oneLine = (text: string) => text.replaceAll('\r\n', '¶').replace(/[\r\n]/g, '¶');

/** The value's tolerance when rounded to `shown`: half a unit of its last digit. */
function halfUnit(shown: string): number {
  const [mantissa, exponent] = shown.toLowerCase().split('e') as [string, string | undefined];
  const decimals = mantissa.includes('.') ? mantissa.split('.')[1]!.length : 0;
  return 0.5 * 10 ** (Number(exponent ?? 0) - decimals);
}

interface Finding {
  where: string;
  row: number;
  column: string;
  exact: string;
  shown: string;
  problem: string;
}

/**
 * Checks every fully visible cell in the current view: values (2) from the
 * probe, ink (1) from a screenshot analysed in the page.
 */
async function checkView(page: Page, where: string, findings: Finding[]): Promise<{ cells: number; rounded: number }> {
  await frames(page);
  const l = await layout(page);
  const cells = await page.evaluate(() => (globalThis as Global).__tychoCells ?? []);
  const track = await targetRect(page, 'table-scroll-track');
  const bottom = track[1] + track[3];
  const right = l.left + l.cellsWidth;
  const rects = [];
  let rounded = 0;
  for (const cell of cells) {
    const column = l.columns[cell.column]!;
    const x = l.left + column.x - l.scrollX;
    const y = l.top + (cell.row - l.topRow) * l.rowHeight;
    const flag = (problem: string) => findings.push({ where, row: cell.row + 1, column: column.name, exact: cell.exact, shown: cell.shown, problem });
    if (column.kind === 'float' && cell.shown !== cell.exact && cell.exact !== 'NULL') {
      rounded++;
      if (cell.shown.length > column.budget) flag(`rounded text is ${cell.shown.length} characters, budget ${column.budget}`);
      const error = Math.abs(Number(cell.shown) - Number(cell.exact));
      if (!(error <= halfUnit(cell.shown) * (1 + 1e-9))) flag(`rounded off by ${error}, more than half a unit (${halfUnit(cell.shown)})`);
    } else if (cell.shown !== oneLine(cell.exact)) {
      flag('shown text differs from the exact value (line breaks as ¶)');
    }
    if (x < l.left || x + column.width > right || y < l.top || y + l.rowHeight > bottom) continue;
    rects.push({ x, y, w: column.width, h: l.rowHeight, numeric: column.kind !== 'text', index: cells.indexOf(cell) });
  }
  const clip = { x: l.left, y: l.top, width: l.cellsWidth, height: bottom - l.top };
  const png = (await page.screenshot({ clip })).toString('base64');
  const ink = await page.evaluate(async ({ png, rects, clip }) => {
    const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${png}`)).blob());
    const scale = bitmap.width / clip.width;
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d')!;
    context.drawImage(bitmap, 0, 0);
    const { data, width } = context.getImageData(0, 0, bitmap.width, bitmap.height);
    const lum = (px: number, py: number) => {
      const at = (py * width + px) * 4;
      return 0.2126 * data[at]! + 0.7152 * data[at + 1]! + 0.0722 * data[at + 2]!;
    };
    return rects.map((rect) => {
      // CSS → image pixels; rows trimmed 2 px top and bottom (the border).
      const x0 = Math.round((rect.x - clip.x) * scale);
      const x1 = Math.round((rect.x + rect.w - clip.x) * scale);
      const y0 = Math.round((rect.y - clip.y + 2) * scale);
      const y1 = Math.round((rect.y + rect.h - clip.y - 2) * scale);
      // The background is the most common luminance in the cell.
      const histogram = new Map<number, number>();
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const value = Math.round(lum(x, y));
        histogram.set(value, (histogram.get(value) ?? 0) + 1);
      }
      const background = [...histogram].sort((a, b) => b[1] - a[1])[0]![0];
      const inked = (from: number, to: number) => {
        let count = 0;
        for (let y = y0; y < y1; y++) for (let x = Math.round(from * scale); x < Math.round(to * scale); x++) {
          if (Math.abs(lum(x0 + x, y) - background) > 64) count++;
        }
        return count;
      };
      // The padding is 8 px; 1–6 px in from the edge is clear of the text's
      // antialiasing.
      const padding = rect.numeric ? inked(1, 6) : inked(rect.w - 6, rect.w - 1);
      return { index: rect.index, padding, inside: inked(8, rect.w - 8) };
    });
  }, { png, rects, clip });
  for (const result of ink) {
    const cell = cells[result.index]!;
    const column = l.columns[cell.column]!;
    const flag = (problem: string) => findings.push({ where, row: cell.row + 1, column: column.name, exact: cell.exact, shown: cell.shown, problem });
    if (result.padding > 0) flag(`${result.padding} ink pixels in the ${column.kind === 'text' ? 'right' : 'left'} padding: the value spills out of its cell`);
    if (result.inside === 0 && cell.shown !== '') flag('no ink inside the cell: the probe sees no text');
  }
  return { cells: ink.length, rounded };
}

/** Scrolls sideways through every column at this row, checking each view. */
async function checkRow(page: Page, where: string, findings: Finding[]): Promise<{ views: number; cells: number; rounded: number }> {
  let l = await layout(page);
  // Over the row numbers, so no cell is hovered (no tooltip in the shots).
  await page.mouse.move(l.left - 12, l.top + 40);
  await wheel(page, 0, -1e6);
  await frames(page);
  const totals = { views: 0, cells: 0, rounded: 0 };
  const content = Math.max(...l.columns.map((column) => column.x + column.width));
  for (;;) {
    l = await layout(page);
    const view = await checkView(page, `${where}, x ${Math.round(l.scrollX)}`, findings);
    totals.views++;
    totals.cells += view.cells;
    totals.rounded += view.rounded;
    if (l.scrollX + l.cellsWidth >= content - 0.5) break;
    await wheel(page, 0, l.cellsWidth * 0.75);
    await page.waitForFunction((before) => (globalThis as Global).__tychoTable!.scrollX !== before, l.scrollX, { timeout: 5_000 });
    await frames(page);
  }
  return totals;
}

interface TooltipCheck {
  name: string;
  ok: boolean;
  detail: string;
  /** Pointer at rest → tooltip published (ms). */
  shownMs?: number;
}

/** Rests the pointer on `cell` and checks its tooltip. */
async function hover(page: Page, name: string, cell: Cell | undefined, expect: 'exact' | 'none'): Promise<TooltipCheck> {
  if (!cell) return { name, ok: false, detail: 'no such cell in view' };
  const l = await layout(page);
  const column = l.columns[cell.column]!;
  const x = l.left + column.x - l.scrollX + column.width / 2;
  const y = l.top + (cell.row - l.topRow + 0.5) * l.rowHeight;
  // Away first, so the move below is a new cell.
  await page.mouse.move(l.left - 12, y);
  await frames(page);
  const at = await now(page);
  await page.mouse.move(x, y);
  if (expect === 'none') {
    await page.waitForTimeout(1_200);
    const tooltip = (await table(page))?.tooltip ?? null;
    return { name, ok: tooltip === null, detail: `tooltip ${JSON.stringify(tooltip)} on ${JSON.stringify(cell.shown)}` };
  }
  const shown = await page
    .waitForFunction(() => (globalThis as Global).__tychoTable?.tooltip ?? null, null, { timeout: 3_000, polling: 10 })
    .then(async (handle) => ((await handle.jsonValue()) as string))
    .catch(() => null);
  const shownMs = (await now(page)) - at;
  await frames(page);
  await page.screenshot({ path: join(rawDir, `${date}-${label}-${name}.png`), clip: { x: Math.max(0, x - 360), y: Math.max(0, y - 120), width: 720, height: 240 } });
  return { name, ok: shown === cell.exact, detail: `tooltip ${JSON.stringify(shown)}, exact ${JSON.stringify(cell.exact)}, shown ${JSON.stringify(cell.shown)}`, shownMs };
}

/**
 * Sweeping: a tooltip shows on a rounded double; the pointer crosses a cell
 * that fits (the tooltip goes) and lands on another rounded double within
 * the grace period, whose tooltip must show at once, not after the delay.
 */
async function grace(page: Page, cells: Cell[], rounded: number, fits: number): Promise<TooltipCheck> {
  const roundedCells = cells.filter((cell) => cell.column === rounded && cell.shown !== cell.exact);
  const [first, second] = roundedCells;
  const between = cells.find((cell) => cell.column === fits && cell.row === first?.row);
  if (!first || !second || !between) return { name: 'overflow-grace', ok: false, detail: 'no such cells in view' };
  const l = await layout(page);
  const center = (cell: Cell) => {
    const column = l.columns[cell.column]!;
    return [l.left + column.x - l.scrollX + column.width / 2, l.top + (cell.row - l.topRow + 0.5) * l.rowHeight] as const;
  };
  await page.mouse.move(l.left - 12, center(first)[1]);
  await frames(page);
  await page.mouse.move(...center(first));
  const shown = await page.waitForFunction(() => (globalThis as Global).__tychoTable?.tooltip ?? null, null, { timeout: 3_000, polling: 10 }).then(() => true).catch(() => false);
  await page.mouse.move(...center(between));
  await page.waitForTimeout(100);
  const at = await now(page);
  await page.mouse.move(...center(second));
  const switched = await page
    .waitForFunction((exact) => (globalThis as Global).__tychoTable?.tooltip === exact, second.exact, { timeout: 3_000, polling: 10 })
    .then(() => true)
    .catch(() => false);
  const shownMs = (await now(page)) - at;
  return { name: 'overflow-grace', ok: shown && switched && shownMs < 250, detail: `first ${shown}, second ${switched} after ${shownMs.toFixed(0)} ms (delay 500, grace 300)`, shownMs };
}

async function cellsInView(page: Page): Promise<{ l: Layout; cells: Cell[] }> {
  const l = await layout(page);
  const track = await targetRect(page, 'table-scroll-track');
  const cells = (await page.evaluate(() => (globalThis as Global).__tychoCells ?? [])).filter((cell) => {
    const column = l.columns[cell.column]!;
    const x = l.left + column.x - l.scrollX;
    const y = l.top + (cell.row - l.topRow) * l.rowHeight;
    return x >= l.left && x + column.width <= l.left + l.cellsWidth && y >= l.top && y + l.rowHeight <= track[1] + track[3] - 40;
  });
  return { l, cells };
}

async function tooltips(page: Page, file: FileName): Promise<TooltipCheck[]> {
  await jump(page, 1);
  let { l, cells } = await cellsInView(page);
  const kind = (cell: Cell) => l.columns[cell.column]!.kind;
  const checks: TooltipCheck[] = [];
  const roundedCell = cells.find((cell) => kind(cell) === 'float' && cell.shown !== cell.exact);
  if (file !== 'asteroids' || roundedCell) checks.push(await hover(page, `${file}-rounded`, roundedCell, 'exact'));
  const fits = cells.find((cell) => cell.shown === cell.exact && cell.shown.length <= 12 && cell.shown !== 'NULL');
  checks.push(await hover(page, `${file}-fits`, fits, 'none'));
  if (file === 'overflow') {
    const named = (name: string) => l.columns.findIndex((column) => column.name === name);
    checks.push(await hover(page, 'overflow-long-text', cells.find((cell) => cell.column === named('long_text') && cell.exact.length > 60), 'exact'));
    // A line break shows as ¶; the tooltip has the real one (and shaping the
    // cell's text for the cut check must not see it: debug builds assert).
    checks.push(await hover(page, 'overflow-multi-line', cells.find((cell) => cell.column === named('multi_line') && cell.exact.includes('\n')), 'exact'));
    checks.push(await grace(page, cells, named('dbl'), named('id')));
    // A 38-digit DECIMAL, cut at its end, is further right.
    await page.mouse.move(l.left - 12, l.top + 40);
    await wheel(page, 0, l.columns[named('wide_decimal')]!.x - l.scrollX);
    await frames(page, 3);
    ({ l, cells } = await cellsInView(page));
    checks.push(await hover(page, 'overflow-decimal', cells.find((cell) => cell.column === named('wide_decimal')), 'exact'));
  }
  // A scroll hides a shown tooltip (the last check's, if it showed one).
  const before = (await table(page))?.tooltip ?? null;
  if (before !== null) {
    await wheel(page, 120);
    await frames(page);
    const after = (await table(page))?.tooltip ?? null;
    checks.push({ name: `${file}-scroll-hides`, ok: after === null, detail: `tooltip before ${JSON.stringify(before).slice(0, 40)}, after ${JSON.stringify(after)}` });
  }
  return checks;
}

async function measure(file: FileName) {
  const run = await open(chromium, url, { params: { cells: '' } });
  const { page } = run;
  try {
    await waitOverlay(page, 'Parquet ready', /ms$/, 180_000);
    // Hidden: the panel covers cells.
    await page.keyboard.press('Control+Shift+P');
    await page.waitForFunction(() => (globalThis as Global).__seizaPerfOverlay === undefined, null, { timeout: 5_000 });
    const spec = FILES[file];
    const started = await now(page);
    if ('sample' in spec) await clickTarget(page, spec.sample);
    else await dropFile(page, spec.drop);
    await waitMark(page, 'tycho:first-rows', started, 60_000);
    await targetRect(page, 'jump-input', 10_000);
    const rows = manifest[spec.manifest]!.rows;
    // Seeded: the same rows every run.
    let seed = 0x2545f491;
    const random = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
    const at = [1, Math.ceil(rows / 2), rows, ...[0, 1, 2].map(() => 1 + Math.floor(random() * rows))];
    const findings: Finding[] = [];
    const totals = { views: 0, cells: 0, rounded: 0 };
    for (const row of at) {
      await jump(page, row);
      const result = await checkRow(page, `${file} row ${row}`, findings);
      totals.views += result.views;
      totals.cells += result.cells;
      totals.rounded += result.rounded;
    }
    await wheel(page, 0, -1e6);
    await jump(page, 1);
    await page.mouse.move(0, 0);
    await frames(page);
    await page.screenshot({ path: join(rawDir, `${date}-${label}-${file}.png`) });
    const tips = await tooltips(page, file);
    return { file, rows: at, ...totals, findings, tooltips: tips, layout: await layout(page), problems: run.problems };
  } finally {
    await run.close();
  }
}

const WORKER_PORT = 8793;
await assertPortFree(WORKER_DEV_PORT);
const worker = await startWorkerDev({ port: WORKER_PORT, requireObject: 'gaia-dr3-bright.parquet' });
let proxy: Awaited<ReturnType<typeof startCountingProxy>>;
let server: Awaited<ReturnType<typeof preview>>;
try {
  proxy = await startCountingProxy(WORKER_DEV_PORT, WORKER_PORT);
  server = await preview({ root: webDir, preview: { port: 4180, strictPort: true }, logLevel: 'warn' });
} catch (error) {
  await worker.close();
  throw error;
}
const url = 'http://localhost:4180/';
const date = new Date().toISOString().slice(0, 10);
mkdirSync(rawDir, { recursive: true });
const failures: string[] = [];
const output: Record<string, unknown> = { date, label, ...machineInfo() };

try {
  const results = [];
  for (const file of files) {
    const result = await measure(file);
    results.push(result);
    console.log(
      `${file}: ${result.cells} cells in ${result.views} views (rows ${result.rows.join(', ')}), ${result.rounded} rounded doubles, ${result.findings.length} findings; ` +
        result.tooltips.map((tip) => `${tip.name} ${tip.ok ? 'ok' : 'FAIL'}${tip.shownMs ? ` (${tip.shownMs.toFixed(0)} ms)` : ''}`).join(', ') +
        (result.problems.length ? `  PROBLEMS: ${result.problems.join('; ')}` : ''),
    );
    for (const finding of result.findings.slice(0, 20)) console.log(`  ${JSON.stringify(finding)}`);
    failures.push(...result.findings.map((finding) => `${file}: ${JSON.stringify(finding)}`));
    failures.push(...result.tooltips.filter((tip) => !tip.ok).map((tip) => `${tip.name}: ${tip.detail}`));
    failures.push(...result.problems.map((problem) => `${file}: ${problem}`));
  }
  output.files = results;
} finally {
  await server.close();
  proxy.close();
  await worker.close();
}

output.failures = failures;
const out = option('out') ?? join(perfDir, 'results', `${date}-${label}.json`);
writeFileSync(out, `${JSON.stringify(output, null, 2)}\n`);
console.log(`wrote ${out}`);
if (failures.length) {
  console.error(`\nFAIL (${failures.length})\n${failures.slice(0, 40).map((failure) => `  ${failure}`).join('\n')}`);
  process.exit(1);
}
console.log('\nPASS');
