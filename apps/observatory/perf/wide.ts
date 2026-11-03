// The GPUI contender at the wide level (`contenders/scenarios.ts`, the wide
// sheet), on its release build, in Chromium at 1440×900, DPR 2:
//
// - at each stop (`?scenario=wide-sheet&stop=<id>&cells`): the layout the
//   stop asks for (the row height, every day at the stop's width, the key
//   columns pinned in effect, the file's 368 columns in order), heat on
//   every day with a value and on nothing else (the key columns, Latitude,
//   a NULL day), the top rows' Station names as native DuckDB has them, and
//   the cells on screen at the top: the count each stop's label names
//   (`~N cells`), within 5%;
// - without `?scenario` and `?stop`, the default stop;
// - an id the build doesn't have fails the load (`contender:failed`, no
//   `contender:filled`): an unknown stop, an unknown scenario, and the wide
//   sheet asked of the base level's build, and then the replay's open,
//   fling, and jump each reject at once; and the base build still opens
//   Big file without them.
//
// Usage: node apps/observatory/perf/wide.ts [--label <name>]
// --label writes perf/results/<date>-<label>.json. Needs `just observatory
// data`; run `just observatory gpui-build` and `gpui-build wide` first.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Browser } from '@playwright/test';
import { waitMark } from '../../../shared-web/perf/harness.ts';
import { localDate, machineInfo, option } from '../../../shared-web/perf/protocol.ts';
import { WIDE_SHEET, type DensityStop } from '../contenders/scenarios.ts';
import { MARKS, dataPath, lastMark, nativeDuckDB, perfDir, problems, protocolContext, serveGpui } from './harness.ts';

const label = option('label');

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
  const end = await Promise.race([waitMark(page, MARKS.filled, 0, 60_000).then(() => 'filled' as const), waitMark(page, MARKS.failed, 0, 60_000).then(() => 'failed' as const)]);
  return { context, page, found, end };
}

const results: Record<string, unknown> = {};
const wide = await serveGpui(4345, undefined, 'wide');
const base = await serveGpui(4346, undefined, 'base');
const browser = await chromium.launch({ channel: 'chromium' });
try {
  for (const stop of [...WIDE_SHEET.stops, null]) {
    const name = stop?.id ?? 'default';
    const query = stop ? `?cells&scenario=${WIDE_SHEET.id}&stop=${stop.id}` : '?cells';
    const expected = stop ?? WIDE_SHEET.stops.find((candidate) => candidate.id === WIDE_SHEET.defaultStop)!;
    const { context, page, found, end } = await open(browser, wide.url, query);
    try {
      if (end !== 'filled') {
        fail(`${name}: the load ended ${end}`);
        continue;
      }
      // The frame after the fill holds the cells and the layout the probe reported.
      const { layout, cells } = await page
        .waitForFunction(() => {
          const contender = (globalThis as Global).__contender;
          return contender?.layout && contender.cells?.length ? { layout: contender.layout, cells: contender.cells } : false;
        }, null, { timeout: 10_000 })
        .then(async (handle) => (await handle.jsonValue()) as { layout: Layout; cells: Cell[] });
      const days = layout.columns.slice(WIDE_SHEET.heatFrom);
      const names = layout.columns.map((column) => column.name);
      if (layout.columns.length !== 368) fail(`${name}: ${layout.columns.length} columns, not 368`);
      if (names.slice(0, 4).join(',') !== 'Station,Place,Latitude,Jan 1' || names.at(-1) !== 'Dec 31') fail(`${name}: columns ${names.slice(0, 4).join(', ')} … ${names.at(-1)}`);
      if (layout.rowHeight !== expected.rowHeight) fail(`${name}: rows ${layout.rowHeight} px, not ${expected.rowHeight}`);
      const widths = new Set(days.map((column) => column.width));
      if (widths.size !== 1 || !widths.has(expected.columnWidth)) fail(`${name}: day widths ${[...widths].join(', ')}, not ${expected.columnWidth}`);
      if (layout.pinned !== WIDE_SHEET.pinned) fail(`${name}: ${layout.pinned} columns pinned in effect, not ${WIDE_SHEET.pinned}`);

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
      results[name] = { stop: expected.id, rowHeight: layout.rowHeight, dayWidth: expected.columnWidth, textSize: expected.textSize, pinned: layout.pinned, rows, columns, cells: onScreen, heatFills: fills.size };
      console.log(`${name}: ${layout.rowHeight} px rows, ${expected.columnWidth} px days, ${layout.pinned} pinned: ${rows} rows × ${columns} columns = ${onScreen} cells on screen (label ~${target}); ${fills.size} heat fills`);
      for (const problem of found) fail(`${name}: ${problem}`);
    } finally {
      await context.close();
    }
  }

  // Ids the build doesn't have fail the load; the base still opens Big file.
  for (const [what, url, query, want] of [
    ['an unknown stop', wide.url, `?scenario=${WIDE_SHEET.id}&stop=rows-99`, 'failed'],
    ['an unknown scenario', wide.url, '?scenario=wide-shet', 'failed'],
    ['the wide sheet on the base build', base.url, `?scenario=${WIDE_SHEET.id}`, 'failed'],
    ['Big file on the base build, by default', base.url, '', 'filled'],
  ] as const) {
    const { context, page, found, end } = await open(browser, url, query);
    const filled = await lastMark(page, MARKS.filled);
    if (end !== want || (want === 'failed' && filled !== null)) fail(`${what}: the load ended ${end}${filled !== null ? ', with a filled mark' : ''}, wanted ${want}`);
    // After a failed load the replay rejects at once, never waiting for a fill.
    if (want === 'failed') {
      const replay = await page.evaluate(async () => {
        const replay = (globalThis as { __contender?: { replay: Record<'open' | 'fling', () => Promise<void>> & { jump(fraction: number): Promise<void> } } }).__contender!.replay;
        const settle = (call: () => Promise<void>) => Promise.race([call().then(() => 'resolved', () => 'rejected'), new Promise<string>((resolve) => setTimeout(() => resolve('pending'), 2_000))]);
        return [await settle(() => replay.open()), await settle(() => replay.fling()), await settle(() => replay.jump(0.5))];
      });
      if (replay.some((outcome) => outcome !== 'rejected')) fail(`${what}: the replay's open, fling, and jump ${replay.join(', ')}, not rejected`);
    }
    // A failed load reports nothing else wrong: the failure is its message.
    for (const problem of found) fail(`${what}: ${problem}`);
    results[what] = end;
    console.log(`${what}: ${end}`);
    await context.close();
  }
} finally {
  await browser.close();
  await wide.close();
  await base.close();
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
