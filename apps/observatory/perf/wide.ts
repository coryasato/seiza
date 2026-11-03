// Both contenders at the wide level (`contenders/scenarios.ts`, the wide
// sheet), on their release builds, in Chromium at 1440×900, DPR 2:
//
// - at each stop (`?scenario=wide-sheet&stop=<id>&cells`), on each side:
//   the layout the stop asks for (the row height, every day at the stop's
//   width, the key columns pinned in effect, the file's 368 columns in
//   order), heat on every day with a value and on nothing else (the key
//   columns, Latitude, a NULL day), the top rows' Station names as native
//   DuckDB has them, and the cells on screen at the top: the count each
//   stop's label names (`~N cells`), within 5%;
// - the TanStack contender's layout the GPUI contender's at each stop
//   (every column's left and width, the rows, the run in effect, the
//   cells' width), and its heat as drawn: the pixels of a sample of its
//   heat cells, inside their padding, within two 8-bit steps of the ramp's
//   color its probe reports;
// - without `?scenario` and `?stop`, the default stop;
// - an id the build doesn't have fails the load (`contender:failed`, no
//   `contender:filled`): an unknown stop, an unknown scenario, and the wide
//   sheet asked of the base level's build, and then the replay's open,
//   fling, and jump each reject at once; and the base build still opens
//   Big file without them. On both sides.
//
// Usage: node apps/observatory/perf/wide.ts [--label <name>] [--side gpui|tanstack]
// --label writes perf/results/<date>-<label>.json. Needs `just observatory
// data`; run `just observatory gpui-build`, `gpui-build wide`,
// `tanstack-build`, and `tanstack-build wide` first.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Browser, type Page } from '@playwright/test';
import { waitMark } from '../../../shared-web/perf/harness.ts';
import { localDate, machineInfo, option } from '../../../shared-web/perf/protocol.ts';
import type { Side } from '../contenders/contract.ts';
import { WIDE_SHEET, type DensityStop } from '../contenders/scenarios.ts';
import type { AppServer } from '../../../shared-web/perf/serve.ts';
import { MARKS, dataPath, lastMark, nativeDuckDB, perfDir, problems, protocolContext, serveGpui, serveTanstack } from './harness.ts';

const label = option('label');
const only = option('side') as Side | undefined;
const SIDES: Side[] = only ? [only] : ['gpui', 'tanstack'];

interface Layout {
  rowHeight: number;
  cellsWidth: number;
  pinned: number;
  columns: { name: string; x: number; width: number; kind: string }[];
}
interface Cell {
  row: number;
  column: number;
  exact: string;
  shown: string;
  fill: number[] | null;
}
type Global = { __contender?: { layout?: Layout; cells?: Cell[] } };

const failures: string[] = [];
const fail = (what: string) => failures.push(what);

/** The count a stop's label names: "~1,090 cells" → 1090. */
const named = (stop: DensityStop) => Number(/~([\d,]+)/.exec(stop.label)?.[1]?.replaceAll(',', '') ?? Number.NaN);

const conn = await nativeDuckDB();
const wideFile = dataPath(WIDE_SHEET.data).replaceAll("'", "''");
const topStations = (await conn.runAndReadAll(`SELECT "Station" FROM read_parquet('${wideFile}') LIMIT 5`)).getRows().map((row) => String(row[0]));

/** Opens `query` and waits for its end: filled, or failed. */
async function open(browser: Browser, url: string, query: string) {
  const context = await protocolContext(browser);
  const page = await context.newPage();
  const found = problems(page);
  await page.goto(`${url}${query}`);
  // The mark that didn't come times out later: its rejection is the race's, not a failure.
  const ended = [waitMark(page, MARKS.filled, 0, 60_000).then(() => 'filled' as const), waitMark(page, MARKS.failed, 0, 60_000).then(() => 'failed' as const)];
  for (const waiting of ended) waiting.catch(() => {});
  const end = await Promise.race(ended).catch(() => 'neither' as const);
  return { context, page, found, end };
}

/** The probes' layout and cells, once the frame after the fill has them. */
const probed = (page: Page) =>
  page
    .waitForFunction(() => {
      const contender = (globalThis as Global).__contender;
      return contender?.layout && contender.cells?.length ? { layout: contender.layout, cells: contender.cells } : false;
    }, null, { timeout: 10_000 })
    .then(async (handle) => (await handle.jsonValue()) as { layout: Layout; cells: Cell[] });

/**
 * The TanStack side's heat as the browser drew it: for up to `count` heat
 * cells, the screenshot's pixel just inside the cell's top-left padding
 * (the text is right-aligned) against the fill its probe reports. A list of
 * mismatches.
 */
async function drawnHeat(page: Page, cells: Cell[], count: number): Promise<{ checked: number; mismatches: string[] }> {
  const sample = cells.filter((cell) => cell.fill).filter((_, index, all) => index % Math.max(1, Math.floor(all.length / count)) === 0).slice(0, count);
  const boxes = await page.evaluate(
    (wanted) =>
      wanted.map(({ row, column }) => {
        const cell = document.querySelector(`.row[data-row="${row}"] > .cell[data-column="${column}"]`);
        const rect = cell?.getBoundingClientRect();
        return rect ? [rect.left, rect.top] : null;
      }),
    sample.map(({ row, column }) => ({ row, column })),
  );
  // The screenshot decoded in the page (device pixels), each box's pixel read there.
  const shot = await page.screenshot({ type: 'png' });
  const pixels = await page.evaluate(
    async ({ b64, at }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${b64}`;
      await image.decode();
      const canvas = new OffscreenCanvas(image.width, image.height);
      const context = canvas.getContext('2d', { willReadFrequently: true })!;
      context.drawImage(image, 0, 0);
      const dpr = image.width / innerWidth;
      return at.map((box) => (box ? [...context.getImageData(Math.round((box[0]! + 2) * dpr), Math.round((box[1]! + 2) * dpr), 1, 1).data.slice(0, 3)] : null));
    },
    { b64: shot.toString('base64'), at: boxes },
  );
  const mismatches: string[] = [];
  sample.forEach((cell, index) => {
    const pixel = pixels[index];
    if (!pixel) return void mismatches.push(`row ${cell.row} column ${cell.column}: not drawn`);
    if (pixel.some((channel, i) => Math.abs(channel - cell.fill![i]!) > 2)) mismatches.push(`row ${cell.row} column ${cell.column}: drawn ${pixel}, the ramp's ${cell.fill!.slice(0, 3)}`);
  });
  return { checked: sample.length, mismatches };
}

const results: Record<string, Record<string, unknown>> = {};
/** The builds the run reads: GPUI's wide one always (the TanStack side's
 *  layout is compared with it), each base only for a side it checks. Each
 *  started inside the `try`, so one that's missing closes the others. */
const servers: Partial<Record<Side, { wide?: AppServer; base?: AppServer }>> = {};
const served = (side: Side, level: 'wide' | 'base'): AppServer => {
  const server = servers[side]?.[level];
  if (!server) throw new Error(`${side} ${level}: not served`);
  return server;
};
/** Each stop's GPUI layout, which the TanStack side's must equal. */
const gpuiLayouts = new Map<string, Layout>();
let browser: Browser | null = null;
try {
  servers.gpui = { wide: await serveGpui(4345, undefined, 'wide') };
  if (SIDES.includes('gpui')) servers.gpui.base = await serveGpui(4346, undefined, 'base');
  if (SIDES.includes('tanstack')) {
    servers.tanstack = { wide: await serveTanstack(4347, undefined, 'wide') };
    servers.tanstack.base = await serveTanstack(4349, undefined, 'base');
  }
  browser = await chromium.launch({ channel: 'chromium' });
  for (const side of [...new Set<Side>(['gpui', ...SIDES])]) {
    const checked = SIDES.includes(side);
    const sideResults: Record<string, unknown> = {};
    for (const stop of [...WIDE_SHEET.stops, null]) {
      const name = `${side} ${stop?.id ?? 'default'}`;
      const query = stop ? `?cells&scenario=${WIDE_SHEET.id}&stop=${stop.id}` : '?cells';
      const expected = stop ?? WIDE_SHEET.stops.find((candidate) => candidate.id === WIDE_SHEET.defaultStop)!;
      const { context, page, found, end } = await open(browser, served(side, 'wide').url, query);
      try {
        if (end !== 'filled') {
          fail(`${name}: the load ended ${end}`);
          continue;
        }
        const { layout, cells } = await probed(page);
        // GPUI's layout is read for the TanStack side's comparison even when only it's checked.
        if (side === 'gpui') gpuiLayouts.set(expected.id, layout);
        if (!checked) continue;
        const days = layout.columns.slice(WIDE_SHEET.heatFrom);
        const names = layout.columns.map((column) => column.name);
        if (layout.columns.length !== 368) fail(`${name}: ${layout.columns.length} columns, not 368`);
        if (names.slice(0, 4).join(',') !== 'Station,Place,Latitude,Jan 1' || names.at(-1) !== 'Dec 31') fail(`${name}: columns ${names.slice(0, 4).join(', ')} … ${names.at(-1)}`);
        if (layout.rowHeight !== expected.rowHeight) fail(`${name}: rows ${layout.rowHeight} px, not ${expected.rowHeight}`);
        const widths = new Set(days.map((column) => column.width));
        if (widths.size !== 1 || !widths.has(expected.columnWidth)) fail(`${name}: day widths ${[...widths].join(', ')}, not ${expected.columnWidth}`);
        if (layout.pinned !== WIDE_SHEET.pinned) fail(`${name}: ${layout.pinned} columns pinned in effect, not ${WIDE_SHEET.pinned}`);

        // The DOM side lays out as GPUI does, to the pixel.
        if (side === 'tanstack') {
          const gpui = gpuiLayouts.get(expected.id);
          if (!gpui) fail(`${name}: no GPUI layout to compare with`);
          else {
            const differs = layout.columns.flatMap((column, index) => {
              const other = gpui.columns[index];
              return other && Math.abs(other.x - column.x) < 0.01 && Math.abs(other.width - column.width) < 0.01 ? [] : [`${column.name} ${column.x}+${column.width} (GPUI ${other?.x}+${other?.width})`];
            });
            if (differs.length) fail(`${name}: columns unlike GPUI's: ${differs.slice(0, 4).join('; ')}${differs.length > 4 ? ` and ${differs.length - 4} more` : ''}`);
            if (layout.rowHeight !== gpui.rowHeight || layout.pinned !== gpui.pinned) fail(`${name}: rows ${layout.rowHeight}, pinned ${layout.pinned}; GPUI's ${gpui.rowHeight}, ${gpui.pinned}`);
            if (Math.abs(layout.cellsWidth - gpui.cellsWidth) > 16) fail(`${name}: cells ${layout.cellsWidth} px wide, GPUI's ${gpui.cellsWidth}`);
          }
        }

        // Heat on every day with a value, on nothing else.
        const fills = new Set<string>();
        for (const cell of cells) {
          const day = cell.column >= WIDE_SHEET.heatFrom;
          const painted = cell.fill !== null;
          if (day && cell.exact !== 'NULL' && !painted) fail(`${name}: row ${cell.row} ${names[cell.column]} (${cell.exact}) has no heat`);
          if ((!day || cell.exact === 'NULL') && painted) fail(`${name}: row ${cell.row} ${names[cell.column]} (${cell.exact}) is painted`);
          if (painted) fills.add(cell.fill!.join(','));
        }
        if (fills.size < 10) fail(`${name}: only ${fills.size} different heat fills on screen`);
        const stations = [...new Set(cells.filter((cell) => cell.column === 0).sort((a, b) => a.row - b.row).map((cell) => cell.exact))].slice(0, 5);
        if (stations.join('|') !== topStations.join('|')) fail(`${name}: top stations ${stations.join(', ')}, DuckDB ${topStations.join(', ')}`);

        const rows = new Set(cells.map((cell) => cell.row)).size;
        const columns = new Set(cells.map((cell) => cell.column)).size;
        const onScreen = cells.length;
        const target = named(expected);
        if (Math.abs(onScreen - target) / target > 0.05) fail(`${name}: ${onScreen} cells on screen, its label says ~${target}`);
        let heat = '';
        if (side === 'tanstack') {
          const drawn = await drawnHeat(page, cells, 40);
          for (const mismatch of drawn.mismatches) fail(`${name}: heat ${mismatch}`);
          heat = `; ${drawn.checked} heat cells' pixels against the ramp`;
        }
        sideResults[stop?.id ?? 'default'] = { stop: expected.id, rowHeight: layout.rowHeight, dayWidth: expected.columnWidth, textSize: expected.textSize, pinned: layout.pinned, rows, columns, cells: onScreen, heatFills: fills.size };
        console.log(`${name}: ${layout.rowHeight} px rows, ${expected.columnWidth} px days, ${layout.pinned} pinned: ${rows} rows × ${columns} columns = ${onScreen} cells on screen (label ~${target}); ${fills.size} heat fills${heat}`);
        for (const problem of found) fail(`${name}: ${problem}`);
      } finally {
        await context.close();
      }
    }
    if (!checked) continue;

    // The TanStack side's probe and Element Timing under a sideways scroll.
    if (side === 'tanstack') {
      const stop = WIDE_SHEET.stops.find((candidate) => candidate.id === WIDE_SHEET.defaultStop)!;
      const context = await protocolContext(browser);
      // Every cell paint Element Timing reports, from the page's start.
      await context.addInitScript(() => {
        const paints: { id: string; at: number }[] = ((globalThis as { __paints?: unknown }).__paints = []) as never;
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries() as (PerformanceEntry & { identifier: string; renderTime: number })[]) if (entry.identifier.startsWith('row:')) paints.push({ id: entry.identifier, at: entry.renderTime || entry.startTime });
        }).observe({ type: 'element', buffered: true });
      });
      const page = await context.newPage();
      const found = problems(page);
      try {
        await page.goto(`${served(side, 'wide').url}?cells&measure&scenario=${WIDE_SHEET.id}&stop=${stop.id}`);
        await waitMark(page, MARKS.filled, 0, 60_000);
        await probed(page);
        const frames = (n: number) => page.evaluate((n) => new Promise<void>((resolve) => { const step = (k: number) => (k === 0 ? resolve() : requestAnimationFrame(() => step(k - 1))); step(n); }), n);
        const latitude = 2;
        const cellsNow = async () => ((await page.evaluate(() => (globalThis as Global).__contender!.cells!)) ?? []) as Cell[];
        const had = (await cellsNow()).some((cell) => cell.column === latitude);
        // Mid-scroll, past Latitude's width (94 px), within the drawn
        // columns' overscan and inside the columns' 150 ms scroll: the probe
        // follows, read before the scroll's rest renders again. (It's
        // republished at each render; the columns' virtualizer's view is the
        // probe's, right of the run's edge, so the cells on screen change
        // only when its range does, which renders.)
        await page.evaluate(() => (document.querySelector('.scroller')!.scrollLeft = 50));
        await frames(2);
        await page.evaluate(() => (document.querySelector('.scroller')!.scrollLeft = 100));
        await frames(2);
        const gone = !(await cellsNow()).some((cell) => cell.column === latitude);
        if (!had || !gone) fail(`tanstack sideways: the probe ${had ? 'kept' : 'never had'} Latitude mid-scroll at 100 px (stale cells)`);
        // A sideways scroll's new columns: created, but no paint reported.
        const lastDrawn = () => page.evaluate(() => Math.max(...[...document.querySelectorAll<HTMLElement>('.row[data-row="0"] > .cell[data-column]')].map((cell) => Number(cell.dataset.column))));
        const before = await lastDrawn();
        const since = await page.evaluate(() => performance.now());
        await page.evaluate(() => (document.querySelector('.scroller')!.scrollLeft = 700));
        await frames(6);
        await page.waitForTimeout(300);
        const after = await lastDrawn();
        const sideways = await page.evaluate((since) => ((globalThis as { __paints?: { at: number }[] }).__paints ?? []).filter((paint) => paint.at > since).length, since);
        if (after <= before) fail(`tanstack sideways: no new columns drawn (last ${before} → ${after}), so the paint check proves nothing`);
        if (sideways !== 0) fail(`tanstack sideways: ${sideways} Element Timing cell paints after a sideways scroll into loaded rows`);
        // Control: new rows report theirs.
        const down = await page.evaluate(() => performance.now());
        await page.evaluate((px) => document.querySelector('.scroller')!.scrollBy(0, px), stop.rowHeight * 10);
        await frames(6);
        await page.waitForTimeout(300);
        const vertical = await page.evaluate((since) => ((globalThis as { __paints?: { at: number }[] }).__paints ?? []).filter((paint) => paint.at > since).length, down);
        if (vertical === 0) fail('tanstack sideways control: a vertical scroll into new rows reported no Element Timing paints');
        sideResults.sideways = { probeFollowed: had && gone, newColumns: after - before, sidewaysPaints: sideways, verticalPaints: vertical };
        console.log(`tanstack sideways: the probe followed a scroll mid-way, at 100 px; ${after - before} new columns at 700 px, ${sideways} cell paints reported; 10 rows down, ${vertical} (the control)`);
        for (const problem of found) fail(`tanstack sideways: ${problem}`);
      } finally {
        await context.close();
      }
    }

    // Ids the build doesn't have fail the load; the base still opens Big file.
    for (const [what, url, query, want] of [
      ['an unknown stop', served(side, 'wide').url, `?scenario=${WIDE_SHEET.id}&stop=rows-99`, 'failed'],
      ['an unknown scenario', served(side, 'wide').url, '?scenario=wide-shet', 'failed'],
      ['the wide sheet on the base build', served(side, 'base').url, `?scenario=${WIDE_SHEET.id}`, 'failed'],
      ['Big file on the base build, by default', served(side, 'base').url, '', 'filled'],
    ] as const) {
      const { context, page, found, end } = await open(browser, url, query);
      const filled = await lastMark(page, MARKS.filled);
      if (end !== want || (want === 'failed' && filled !== null)) fail(`${side} ${what}: the load ended ${end}${filled !== null ? ', with a filled mark' : ''}, wanted ${want}`);
      // After a failed load the replay rejects at once, never waiting for a fill.
      if (want === 'failed') {
        const replay = await page.evaluate(async () => {
          const replay = (globalThis as { __contender?: { replay: Record<'open' | 'fling', () => Promise<void>> & { jump(fraction: number): Promise<void> } } }).__contender!.replay;
          const settle = (call: () => Promise<void>) => Promise.race([call().then(() => 'resolved', () => 'rejected'), new Promise<string>((resolve) => setTimeout(() => resolve('pending'), 2_000))]);
          return [await settle(() => replay.open()), await settle(() => replay.fling()), await settle(() => replay.jump(0.5))];
        });
        if (replay.some((outcome) => outcome !== 'rejected')) fail(`${side} ${what}: the replay's open, fling, and jump ${replay.join(', ')}, not rejected`);
      }
      // A failed load reports nothing else wrong: the failure is its message.
      for (const problem of found) fail(`${side} ${what}: ${problem}`);
      sideResults[what] = end;
      console.log(`${side} ${what}: ${end}`);
      await context.close();
    }
    results[side] = sideResults;
  }
} finally {
  await browser?.close();
  for (const levels of Object.values(servers)) for (const server of Object.values(levels)) await server?.close();
}

if (label) {
  const out = join(perfDir, 'results', `${localDate()}-${label}.json`);
  mkdirSync(join(perfDir, 'results'), { recursive: true });
  writeFileSync(out, `${JSON.stringify({ date: localDate(), label, ...machineInfo(), viewport: '1440x900', deviceScaleFactor: 2, scenario: WIDE_SHEET.id, results, failures }, null, 2)}\n`);
  console.log(`wrote ${out}`);
}
if (failures.length) {
  console.error(`\nFAIL\n${failures.map((failure) => `  ${failure}`).join('\n')}`);
  process.exit(1);
}
console.log('\nPASS');
