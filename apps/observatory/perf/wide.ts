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
//   cells' width);
// - the heat as drawn, on both sides, at each stop in the light theme and
//   the dark: the pixels of a sample of the heat cells wholly in the view,
//   inside their padding, within two 8-bit steps of the scenario's ramp
//   (`scenarios.ts`'s `heat`: its stops mixed in Oklab, its domain) at the
//   cell's value, computed here; the control, the earlier two-stop ramp
//   (the theme's background to `chart-1` through the file's range), fails
//   on most of them. The ramp's stops are inside sRGB (outside it, CSS
//   gamut-maps an `oklch()` while the contenders clamp), and the GPUI
//   contender's, constants in its `scene.rs`, equal `scenarios.ts`'s;
// - without `?scenario` and `?stop`, the default stop;
// - an id the build doesn't have fails the load (`contender:failed`, no
//   `contender:filled`): an unknown stop, an unknown scenario, and the wide
//   sheet asked of the base level's build, and then the replay's open,
//   fling, and jump each reject at once; and the base build still opens
//   Big file without them. On both sides;
// - the tools (`perf/wide-tools.ts`): a band's drag and fit, a pinned
//   band held, a selection drag, the week's and a block's copies against
//   native DuckDB to the byte, the sheet declined then confirmed, the
//   copy's marks in order, the globals only with `?measure`; the page's
//   copy line from a parent page in Chromium, Firefox, and WebKit; a tap
//   and a touch drag on a band. On both sides, and with both, each copied
//   text the same on both, byte for byte.
//
// Usage: node apps/observatory/perf/wide.ts [--label <name>] [--side gpui|tanstack] [--only tools]
// --label writes perf/results/<date>-<label>.json. Needs `just observatory
// data`; run `just observatory gpui-build`, `gpui-build wide`,
// `tanstack-build`, and `tanstack-build wide` first.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Browser, type Page } from '@playwright/test';
import { waitMark } from '../../../shared-web/perf/harness.ts';
import { localDate, machineInfo, option } from '../../../shared-web/perf/protocol.ts';
import type { Side } from '../contenders/contract.ts';
import { WIDE_SHEET, type DensityStop, type Oklch } from '../contenders/scenarios.ts';
import { Domain, fromOklab, fromOklch, oklab, parseHex, rampAt, type Oklab, type Rgba } from '../contenders/tall-table/tanstack/web/src/paint.ts';
import type { AppServer } from '../../../shared-web/perf/serve.ts';
import { MARKS, dataPath, lastMark, nativeDuckDB, perfDir, problems, protocolContext, serveGpui, serveTanstack } from './harness.ts';
import { TOOL_BROWSERS, checkFromParent, checkTools, checkTouch } from './wide-tools.ts';

const label = option('label');
const only = option('side') as Side | undefined;
const SIDES: Side[] = only ? [only] : ['gpui', 'tanstack'];
/** `--only tools`: the tools alone, not the layouts and heat. */
const onlyWhat = option('only');
if (onlyWhat !== undefined && onlyWhat !== 'tools') throw new Error(`--only ${onlyWhat}: only \`tools\` is known`);
const toolsOnly = onlyWhat === 'tools';
/** The sides whose wide build has the tools. */
const TOOLED: Side[] = ['gpui', 'tanstack'];
if (toolsOnly && !SIDES.some((side) => TOOLED.includes(side))) throw new Error(`--only tools: ${SIDES.join(', ')} builds no tools yet (TOOLED: ${TOOLED.join(', ')})`);

interface Layout {
  left: number;
  top: number;
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
/** The GPUI contender's view (`__contender.probe`): its top row, fractional,
 *  and its sideways scroll, CSS px. */
interface ViewProbe {
  top: number;
  scrollX: number;
}
type Global = { __contender?: { layout?: Layout; cells?: Cell[]; probe?: ViewProbe } };

const failures: string[] = [];
const fail = (what: string) => failures.push(what);

/** The count a stop's label names: "~1,090 cells" → 1090. */
const named = (stop: DensityStop) => Number(/~([\d,]+)/.exec(stop.label)?.[1]?.replaceAll(',', '') ?? Number.NaN);

const conn = await nativeDuckDB();
const wideFile = dataPath(WIDE_SHEET.data).replaceAll("'", "''");
const topStations = (await conn.runAndReadAll(`SELECT "Station" FROM read_parquet('${wideFile}') LIMIT 5`)).getRows().map((row) => String(row[0]));

/** Opens `query` and waits for its end: filled, or failed. */
async function open(browser: Browser, url: string, query: string, theme: Theme = 'light') {
  const context = await protocolContext(browser);
  const page = await context.newPage();
  // The system's scheme, which both contenders follow outside the page's frame.
  await page.emulateMedia({ colorScheme: theme });
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

type Theme = 'light' | 'dark';

/** A ramp to check the drawn heat against: its stops in Oklab, its domain. */
interface HeatRamp {
  stops: Oklab[];
  domain: Domain;
}

const { lo, mid, hi } = WIDE_SHEET.heat.domain;
/** The scenario's ramp, per theme. */
const HEAT: Record<Theme, HeatRamp> = {
  light: { stops: WIDE_SHEET.heat.stops.light.map((stop) => oklab(fromOklch(...stop))), domain: new Domain(lo, hi, mid) },
  dark: { stops: WIDE_SHEET.heat.stops.dark.map((stop) => oklab(fromOklch(...stop))), domain: new Domain(lo, hi, mid) },
};
/** The control: the earlier ramp, the background to gpui-kit's `chart-1`
 *  (`#93c5fd` in both themes) through the file's range (`MANIFEST.json`). */
const fileRange = (() => {
  const manifest = JSON.parse(readFileSync(new URL('../data/MANIFEST.json', import.meta.url), 'utf8')) as Record<string, { range?: [number, number] }>;
  const range = manifest[WIDE_SHEET.data]?.range;
  if (!range) throw new Error(`data/MANIFEST.json has no range for ${WIDE_SHEET.data}: run \`just observatory data\``);
  return range;
})();
const TWO_STOP: Record<Theme, HeatRamp> = {
  light: { stops: ['#ffffff', '#93c5fd'].map((hex) => oklab(parseHex(hex))), domain: new Domain(...fileRange) },
  dark: { stops: ['#0a0a0a', '#93c5fd'].map((hex) => oklab(parseHex(hex))), domain: new Domain(...fileRange) },
};
const rgb8 = (color: Rgba): number[] => [color.r, color.g, color.b].map((channel) => Math.round(channel * 255));
/** `ramp`'s color at a cell's value (its exact text), 8-bit RGB. */
const heatAt = (ramp: HeatRamp, exact: string): number[] => rgb8(fromOklab(rampAt(ramp.stops, ramp.domain.unit(Number(exact)))!));

/** Every stop inside sRGB: converted and back to Oklab, it's unchanged
 *  (a clamped channel moves it). */
function outOfGamut(): string[] {
  return (['light', 'dark'] as const).flatMap((theme) =>
    WIDE_SHEET.heat.stops[theme].flatMap((stop) => {
      const [l, c, h] = stop;
      const back = oklab(fromOklch(l, c, h));
      const want = { a: c * Math.cos((h * Math.PI) / 180), b: c * Math.sin((h * Math.PI) / 180) };
      return Math.abs(back.l - l) + Math.abs(back.a - want.a) + Math.abs(back.b - want.b) > 1e-3 ? [`scenarios.ts's ${theme} stop oklch(${stop.join(' ')}) is outside sRGB`] : [];
    }),
  );
}

/** The GPUI contender's stops (`scene.rs`'s `LIGHT` and `DARK`) must be
 *  `scenarios.ts`'s: a `Stop` captures nothing, so they're a copy. */
function gpuiStops(): string[] {
  const source = readFileSync(new URL('../contenders/tall-table/gpui/crate/src/scene.rs', import.meta.url), 'utf8');
  return (['light', 'dark'] as const).flatMap((theme) => {
    const found = new RegExp(`const ${theme.toUpperCase()}: \\[\\[f32; 3\\]; 3\\] = (\\[[^;]*\\]);`).exec(source);
    if (!found) return [`scene.rs has no ${theme.toUpperCase()} stops`];
    // rustfmt may break the array over lines, with trailing commas.
    const stops = JSON.parse(found[1]!.replace(/,\s*\]/g, ']')) as Oklch[];
    const wanted = WIDE_SHEET.heat.stops[theme];
    return JSON.stringify(stops) === JSON.stringify(wanted) ? [] : [`scene.rs's ${theme} stops ${JSON.stringify(stops)}, scenarios.ts's ${JSON.stringify(wanted)}`];
  });
}

/**
 * The heat as the browser drew it: for up to `count` heat cells wholly in
 * the view (right of the pinned run's edge if scrolled, left of the
 * vertical scrollbar, above the horizontal one), the screenshot's pixel
 * just inside the cell's top-left padding (the text is right-aligned)
 * against `ramp`'s color at the cell's value, and against the control's.
 * The TanStack side's boxes are its cells' elements'; the GPUI side's from
 * its layout and its view (row `r` at `top + (r − probe.top) × rowHeight`,
 * column `c` at `left + x`, less `scrollX` past the pinned run).
 */
async function drawnHeat(page: Page, side: Side, layout: Layout, cells: Cell[], count: number, theme: Theme): Promise<{ checked: number; mismatches: string[]; controlMismatches: number }> {
  const filled = cells.filter((cell) => cell.fill);
  const view = await page.evaluate(() => ({ height: innerHeight, probe: (globalThis as Global).__contender?.probe ?? null }));
  if (side === 'gpui' && !view.probe) return { checked: 0, mismatches: ['no __contender.probe to place the cells by'], controlMismatches: 0 };
  const boxes: (number[] | null)[] =
    side === 'tanstack'
      ? await page.evaluate(
          (wanted) =>
            wanted.map(({ row, column }) => {
              const cell = document.querySelector(`.row[data-row="${row}"] > .cell[data-column="${column}"]`);
              const rect = cell?.getBoundingClientRect();
              return rect ? [rect.left, rect.top] : null;
            }),
          filled.map(({ row, column }) => ({ row, column })),
        )
      : filled.map(({ row, column }) => [layout.left + layout.columns[column]!.x - (column >= layout.pinned ? view.probe!.scrollX : 0), layout.top + (row - view.probe!.top) * layout.rowHeight]);
  const pinnedEdge = layout.pinned > 0 ? layout.left + layout.columns[layout.pinned - 1]!.x + layout.columns[layout.pinned - 1]!.width : layout.left;
  // Clear of the bottom: a horizontal scrollbar, and the TanStack frame's padding.
  const bar = 40;
  const inView = filled.flatMap((cell, index) => {
    const box = boxes[index];
    if (!box) return [];
    const width = layout.columns[cell.column]!.width;
    const whole = box[0]! >= (cell.column >= layout.pinned ? pinnedEdge : layout.left) && box[0]! + width <= layout.left + layout.cellsWidth && box[1]! >= layout.top && box[1]! + layout.rowHeight <= view.height - bar;
    return whole ? [{ cell, box }] : [];
  });
  const sample = inView.filter((_, index, all) => index % Math.max(1, Math.floor(all.length / count)) === 0).slice(0, count);
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
    { b64: shot.toString('base64'), at: sample.map(({ box }) => box) },
  );
  const near = (pixel: number[], want: number[]) => pixel.every((channel, i) => Math.abs(channel - want[i]!) <= 2);
  const mismatches: string[] = [];
  let controlMismatches = 0;
  sample.forEach(({ cell }, index) => {
    const pixel = pixels[index];
    if (!pixel) return void mismatches.push(`row ${cell.row} column ${cell.column}: not drawn`);
    const want = heatAt(HEAT[theme], cell.exact);
    if (!near(pixel, want)) mismatches.push(`row ${cell.row} column ${cell.column} (${cell.exact}): drawn ${pixel}, the ramp's ${want}`);
    if (!near(pixel, heatAt(TWO_STOP[theme], cell.exact))) controlMismatches++;
  });
  return { checked: sample.length, mismatches, controlMismatches };
}

const results: Record<string, Record<string, unknown>> = {};
for (const problem of [...outOfGamut(), ...gpuiStops()]) fail(problem);
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
  // With `--only tools`, only the tooled sides' wide builds.
  const wanted = (side: Side) => SIDES.includes(side) && (!toolsOnly || TOOLED.includes(side));
  if (!toolsOnly || wanted('gpui')) servers.gpui = { wide: await serveGpui(4345, undefined, 'wide') };
  if (wanted('gpui') && !toolsOnly) servers.gpui!.base = await serveGpui(4346, undefined, 'base');
  if (wanted('tanstack')) {
    servers.tanstack = { wide: await serveTanstack(4347, undefined, 'wide') };
    if (!toolsOnly) servers.tanstack.base = await serveTanstack(4349, undefined, 'base');
  }
  browser = await chromium.launch({ channel: 'chromium' });
  for (const side of toolsOnly ? [] : [...new Set<Side>(['gpui', ...SIDES])]) {
    const checked = SIDES.includes(side);
    const sideResults: Record<string, unknown> = {};
    // Each stop in both themes, then the default (no `?stop`); a side read
    // only for its layouts, each stop once.
    const runs: [DensityStop | null, Theme][] = checked
      ? [...WIDE_SHEET.stops.flatMap((stop): [DensityStop, Theme][] => [[stop, 'light'], [stop, 'dark']]), [null, 'light']]
      : WIDE_SHEET.stops.map((stop): [DensityStop, Theme] => [stop, 'light']);
    for (const [stop, theme] of runs) {
      const run = `${stop?.id ?? 'default'}${theme === 'dark' ? ' dark' : ''}`;
      const name = `${side} ${run}`;
      const query = stop ? `?cells&scenario=${WIDE_SHEET.id}&stop=${stop.id}` : '?cells';
      const expected = stop ?? WIDE_SHEET.stops.find((candidate) => candidate.id === WIDE_SHEET.defaultStop)!;
      const { context, page, found, end } = await open(browser, served(side, 'wide').url, query, theme);
      try {
        if (end !== 'filled') {
          fail(`${name}: the load ended ${end}`);
          continue;
        }
        const { layout, cells } = await probed(page);
        // GPUI's layout is read for the TanStack side's comparison even when only it's checked.
        if (side === 'gpui' && theme === 'light') gpuiLayouts.set(expected.id, layout);
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
        const drawn = await drawnHeat(page, side, layout, cells, 40, theme);
        for (const mismatch of drawn.mismatches) fail(`${name}: heat ${mismatch}`);
        if (drawn.checked < 20) fail(`${name}: only ${drawn.checked} heat cells sampled`);
        // The control: the old two-stop ramp misses most of the same pixels.
        if (drawn.controlMismatches < drawn.checked / 2) fail(`${name}: heat control: the two-stop ramp matched ${drawn.checked - drawn.controlMismatches} of ${drawn.checked} cells`);
        const heat = `; ${drawn.checked} heat cells' pixels against the ramp, ${drawn.checked - drawn.mismatches.length} within 2 steps (the two-stop control: ${drawn.checked - drawn.controlMismatches})`;
        sideResults[run] = { stop: expected.id, theme, rowHeight: layout.rowHeight, dayWidth: expected.columnWidth, textSize: expected.textSize, pinned: layout.pinned, rows, columns, cells: onScreen, heatFills: fills.size, heatChecked: drawn.checked, heatMatched: drawn.checked - drawn.mismatches.length, controlMatched: drawn.checked - drawn.controlMismatches };
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
  // The tools, on each side that builds them.
  for (const side of SIDES.filter((side) => TOOLED.includes(side))) {
    const url = served(side, 'wide').url;
    const tools: Record<string, unknown> = { window: await checkTools(browser, side, url, conn, fail), touch: await checkTouch(browser, side, url, fail) };
    for (const type of TOOL_BROWSERS) tools[`page-${type.name()}`] = await checkFromParent(type, side, url, conn, fail);
    results[side] = { ...results[side], tools };
  }
  if (toolsOnly && !SIDES.some((side) => results[side])) fail('--only tools: no side was checked');
  // With both sides, each copy's text the same on both, byte for byte.
  const copies = SIDES.map((side) => ((results[side] as { tools?: { window?: { copy?: Record<string, unknown> } } } | undefined)?.tools?.window?.copy ?? {}));
  if (copies.length === 2) {
    const same = Object.fromEntries(['weekSha256', 'blockSha256', 'sheetSha256'].map((key) => [key, copies[0]![key] !== undefined && copies[0]![key] === copies[1]![key]]));
    for (const [key, ok] of Object.entries(same)) if (!ok) fail(`the copies' ${key.replace('Sha256', '')} text differs between the sides (${copies.map((copy) => String(copy[key]).slice(0, 12)).join(' vs ')})`);
    results.copiesSameOnBothSides = same;
    console.log(`the copies on both sides: ${Object.entries(same).map(([key, ok]) => `${key.replace('Sha256', '')} ${ok ? 'the same' : 'DIFFERENT'}`).join(', ')}`);
  }
} finally {
  await browser?.close();
  for (const levels of Object.values(servers)) for (const server of Object.values(levels)) await server?.close();
}

if (label) {
  const out = join(perfDir, 'results', `${localDate()}-${label}.json`);
  mkdirSync(join(perfDir, 'results'), { recursive: true });
  writeFileSync(out, `${JSON.stringify({ date: localDate(), label, ...machineInfo(), viewport: '1440x900', deviceScaleFactor: 2, dprNote: "the tools' page and touch sections ran at DPR 1, in the browsers they name", scenario: WIDE_SHEET.id, results, failures }, null, 2)}\n`);
  console.log(`wrote ${out}`);
}
if (failures.length) {
  console.error(`\nFAIL\n${failures.map((failure) => `  ${failure}`).join('\n')}`);
  process.exit(1);
}
console.log('\nPASS');
