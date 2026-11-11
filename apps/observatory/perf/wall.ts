// The contenders at the wall level (`contenders/scenarios.ts`'s monitoring
// wall), on their release builds, in Chromium, each side the same checks
// (each side that builds the level, `BUILT`):
//
// - the feed's fold on screen: with `?ticks=2000` (the wall's feed
//   fixture's count) at 8 tables, whose feed is the fixture's bytes
//   (`contenders/wall/fixtures/feed.json`), once every tick is folded and
//   every table has drawn its last re-read, at 2560×2600 and DPR 1 (every
//   table's 50 rows and 4 columns drawn), each table's drawn cells in the
//   light theme and the dark: its desk's instruments in order (table t's
//   row r is instrument 50t + r), the Symbol the instrument's, Last's and
//   Chg %'s exact text the fixture's (`last`, `change_pct`), Volume's the
//   fixture's, each shown text the scenario's format of it (Last at the
//   instrument's decimals, `feed.ts`'s `decimalsOf`; Chg % signed at 2
//   with `%`; Volume grouped), Chg %'s color the rise's or the fall's by
//   sign (within one 8-bit step of the scenario's `signs`) and a zero's
//   another, and no flash once the flash's ms have passed. The control,
//   the fold one tick short (`?ticks=1999`), must fail it;
// - a flash while the feed runs: Last alone flashing (of market watch's
//   flashing columns, the one the wall draws), at no more than the mix;
// - the marks across the tables (`docs/contender-contract.md`), under the
//   feed at each stop with `?measure`: one `contender:filled` (every table
//   filled), right after a presented frame on GPUI; every
//   `contender:refreshed` where its side sets it (GPUI's right after a
//   presented frame, `presentedMark`), `__contenderRefreshed` an entry a
//   table; every batch reached (`__contender.batches`' sequence numbers
//   0, 1, 2, … with no gap, each with a generation a table), and each
//   batch with a tick on screen (its mask not 0) paired with its frame, the
//   first refreshed mark at which every table in its mask has drawn the
//   generation it names there (`__contenderRefreshed`, logged at each
//   mark): after its send and within `PAIRED_MS` of it; `state.tables`
//   the stop's; none of the marks without `?measure`;
// - a phone's column (390×844, 4 tables): a wheel over a table scrolls
//   that table and not the column (the first title's pixels held), and a
//   wheel over a gap scrolls the column (they move);
// - what fails the load (`contender:failed`, no `contender:filled`): an
//   unknown stop or scenario, `?ticks` that isn't a count, and the wall
//   asked of the base build; and the feed's worker failing to load fails
//   the view (`contender:failed` after `contender:filled`);
// - the grid (`?cells`, light): at each stop at 1440×900, and a phone's
//   column (390×844, 4 tables), each table's frame (`box`), its `layout`
//   (its cells' left edge right of the row numbers, their top under the
//   header, the row height), and its columns (`x`, `width`).
//
// Then, when both sides run, the same on both sides: after the fold (the
// fixture's ticks, light), every table's cells' exact and shown text
// byte-identical; and after the fold and at each grid, every table's frame
// and cells where GPUI's are and its columns at the same x and width
// (`wall-grid.ts`'s `gridDiffers`): the same grid, gutter, and widths. The
// controls: TanStack's fold one tick short against GPUI's fold must
// differ, and at each grid TanStack's tables moved 2 px must differ from
// GPUI's in every table.
//
// Usage: node apps/observatory/perf/wall.ts [--side gpui|tanstack] [--label <name>]
// --label writes perf/results/<date>-<label>.json. Needs `just observatory
// data`; run `builds` first (each side's base and wall builds).

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Browser, type Page } from '@playwright/test';
import { presentedMark, presentingTaskRecorder, waitMark } from '../../../shared-web/perf/harness.ts';
import { localDate, machineInfo, option } from '../../../shared-web/perf/protocol.ts';
import { formatNumber, type NumberFormat } from '../../../components/tall-table/perf/harness.ts';
import { decimalsOf } from '../contenders/market/feed.ts';
import { DESK_ROWS } from '../contenders/wall/desks.ts';
import { WALL_INSTRUMENTS } from '../contenders/wall/instruments.ts';
import { BUILT, MONITORING_WALL } from '../contenders/scenarios.ts';
import type { AppServer } from '../../../shared-web/perf/serve.ts';
import type { Side } from '../contenders/contract.ts';
import { MARKS, perfDir, problems, serveGpui, serveTanstack } from './harness.ts';
import { PHONE, WALL_COLUMNS as COLUMNS, controlHolds, flashOff, gridDiffers, signWrong, wallTables, type WallTable as DrawnTable, type WallCell as Cell } from './wall-grid.ts';

const label = option('label');
const sideOption = option('side');
if (sideOption && sideOption !== 'gpui' && sideOption !== 'tanstack') throw new Error(`--side ${sideOption}: gpui or tanstack`);
const sides: Side[] = sideOption ? [sideOption as Side] : (['gpui', 'tanstack'] as const).filter((side) => BUILT[side].includes('wall'));
for (const side of sides) if (!BUILT[side].includes('wall')) throw new Error(`--side ${side}: it doesn't build the wall level yet (\`scenarios.ts\`'s BUILT)`);
const PORTS: Record<Side, { wall: number; base: number }> = { gpui: { wall: 4386, base: 4387 }, tanstack: { wall: 4388, base: 4389 } };
/** A batch's frame must come this soon after its send (three frames). */
const PAIRED_MS = 50;
/** The fixture's stop: its feed is the fixture's bytes (all 8 desks). */
const FOLD_TABLES = 8;
/** Every table's 50 rows drawn, at 4 × 2 tables. */
const TALL = { width: 2560, height: 2600 };
/** The fixture's field for each column a table draws, and its format. */
type Field = 'last' | 'change_pct' | 'volume';
const NUMBERS: Record<string, { field: Field; kind: 'float' | 'integer'; format: NumberFormat; priced: boolean }> = {
  Last: { field: 'last', kind: 'float', format: { decimals: 2, sign: 'negative', grouping: false, suffix: '' }, priced: true },
  'Chg %': { field: 'change_pct', kind: 'float', format: { decimals: 2, sign: 'always', grouping: false, suffix: '%' }, priced: false },
  Volume: { field: 'volume', kind: 'integer', format: { decimals: null, sign: 'negative', grouping: true, suffix: '' }, priced: false },
};

const fixture = JSON.parse(readFileSync(new URL('../contenders/wall/fixtures/feed.json', import.meta.url), 'utf8')) as { seed: number; ticks: number; expect: (Record<Field, string> & { symbol: string })[] };
if (fixture.seed !== MONITORING_WALL.seed) throw new Error(`the wall's feed.json's seed ${fixture.seed} isn't the scenario's ${MONITORING_WALL.seed}`);
if (fixture.expect.length !== FOLD_TABLES * DESK_ROWS) throw new Error(`the wall's feed.json holds ${fixture.expect.length} instruments, not ${FOLD_TABLES * DESK_ROWS}`);

type Batch = [seq: number, ticks: number, sent: number, generations: number[], visible: number];
type Global = {
  __contender?: { tables?: DrawnTable[]; batches?: Batch[]; state?: { tables?: number; top?: number } };
  __contenderRefreshed?: number[];
  __refreshedLog?: [at: number, drawn: number[]][];
};
type Theme = 'light' | 'dark';

const failures: string[] = [];
const results: Record<string, unknown> = {};
/** Each side's tables after the fold (light), and at each grid. */
const drawn: Partial<Record<Side, { fold: DrawnTable[]; foldControl: DrawnTable[]; grids: Record<string, DrawnTable[]> }>> = {};


/** Logs `__contenderRefreshed` at each refreshed mark, a copy as it stands
 *  then (each entry raised in the frame's task, before its mark). */
function refreshedLog(): void {
  const g = globalThis as Global;
  const log: [number, number[]][] = [];
  g.__refreshedLog = log;
  const mark = performance.mark.bind(performance);
  performance.mark = (name: string, options?: PerformanceMarkOptions) => {
    const entry = mark(name, options);
    if (name === 'contender:refreshed') log.push([entry.startTime, [...(g.__contenderRefreshed ?? [])]]);
    return entry;
  };
}

async function open(browser: Browser, url: string, query: string, options: { theme?: Theme; viewport?: { width: number; height: number }; init?: (() => void)[] } = {}) {
  const context = await browser.newContext({ viewport: options.viewport ?? { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  for (const script of options.init ?? []) await context.addInitScript(script);
  const page = await context.newPage();
  await page.emulateMedia({ colorScheme: options.theme ?? 'light' });
  const found = problems(page);
  await page.goto(`${url}${query}`);
  const ended = [waitMark(page, MARKS.filled, 0, 60_000).then(() => 'filled' as const), waitMark(page, MARKS.failed, 0, 60_000).then(() => 'failed' as const)];
  for (const waiting of ended) waiting.catch(() => {});
  const end = await Promise.race(ended).catch(() => 'neither' as const);
  return { context, page, found, end };
}

/** Waits until `ticks` are folded and every table has drawn its last re-read. */
async function folded(page: Page, ticks: number): Promise<void> {
  await page.waitForFunction(
    (ticks) => {
      const g = globalThis as Global;
      const batches = g.__contender?.batches ?? [];
      const sum = batches.reduce((total, [, count]) => total + count, 0);
      const drawn = g.__contenderRefreshed ?? [];
      const last = new Map<number, number>();
      for (const [, , , generations] of batches) generations.forEach((generation, table) => generation && last.set(table, generation));
      return sum === ticks && [...last].every(([table, generation]) => (drawn[table] ?? 0) >= generation);
    },
    ticks,
    { timeout: 30_000, polling: 20 },
  );
}

/** Each table's drawn cells against the fold, in `theme`: what differs. */
function compare(tables: { cells?: Cell[] }[], theme: Theme): string[] {
  const wrong: string[] = [];
  if (tables.length !== FOLD_TABLES) wrong.push(`${tables.length} tables, not ${FOLD_TABLES}`);
  tables.forEach(({ cells = [] }, table) => {
    const seen = new Set<string>();
    for (const cell of cells) {
      const name = COLUMNS[cell.column];
      const at = table * DESK_ROWS + cell.row;
      const expect = fixture.expect[at];
      const instrument = WALL_INSTRUMENTS[at];
      if (!name || !expect || !instrument || cell.row >= DESK_ROWS) {
        wrong.push(`table ${table} row ${cell.row} column ${cell.column}: no such cell`);
        continue;
      }
      seen.add(`${cell.row}:${cell.column}`);
      const [desk, symbol, price] = instrument;
      const where = `table ${table} ${symbol} ${name}`;
      if (desk !== table) wrong.push(`${where}: desk ${desk}`);
      if (name === 'Symbol') {
        if (cell.exact !== symbol || cell.shown !== symbol || expect.symbol !== symbol) wrong.push(`${where}: ${cell.shown} (${cell.exact}), want ${symbol}`);
        continue;
      }
      const number = NUMBERS[name]!;
      const exact = expect[number.field];
      if (cell.exact !== exact) wrong.push(`${where}: exact ${cell.exact}, the fold's ${exact}`);
      const shown = formatNumber(number.kind, exact, number.format, number.priced ? decimalsOf(price) : number.format.decimals);
      if (cell.shown !== shown) wrong.push(`${where}: shown ${cell.shown}, the format's ${shown}`);
      if (cell.flash) wrong.push(`${where}: still flashing ${cell.flash}`);
      const signed = name === 'Chg %' ? signWrong(theme, exact, cell.text) : null;
      if (signed) wrong.push(`${where}: ${signed}`);
    }
    for (let row = 0; row < DESK_ROWS; row++) for (let column = 0; column < COLUMNS.length; column++) if (!seen.has(`${row}:${column}`)) wrong.push(`table ${table} row ${row} ${COLUMNS[column]}: not drawn`);
  });
  return wrong;
}

const servers: AppServer[] = [];
const browser = await chromium.launch({ channel: 'chromium' });
try {
  if (sides.length === 0) throw new Error('no side builds the wall level yet');
  for (const side of sides) await runSide(side);
  if (drawn.gpui && drawn.tanstack) sameOnBoth(drawn.gpui, drawn.tanstack);
} finally {
  await browser.close();
  for (const server of servers) await server.close();
}

/** Both sides drew the same: after the fold, every table's cells' text
 *  byte-identical; after the fold and at each grid, every table where
 *  GPUI's is (`gridDiffers`), with its control. */
function sameOnBoth(gpui: NonNullable<(typeof drawn)['gpui']>, tanstack: NonNullable<(typeof drawn)['tanstack']>): void {
  const fail = (what: string) => failures.push(`both sides: ${what}`);
  const same: Record<string, unknown> = {};
  results.same = same;
  console.log('\nboth sides:');
  // The fold's cells, exact and shown text.
  const text = (tables: DrawnTable[]) => new Map(tables.flatMap(({ cells = [] }, table) => cells.map((cell) => [`${table}:${cell.row}:${cell.column}`, `${cell.exact}\u0000${cell.shown}`] as const)));
  const [a, b] = [text(gpui.fold), text(tanstack.fold)];
  const differ = [...a].filter(([key, value]) => b.get(key) !== value).map(([key, value]) => `${key}: GPUI ${value.replace('\u0000', ' / ')}, TanStack ${b.get(key)?.replace('\u0000', ' / ')}`);
  // The control: TanStack's fold one tick short must differ from GPUI's.
  const short = text(tanstack.foldControl);
  const controlDiffers = [...a].filter(([key, value]) => short.get(key) !== value).length;
  const foldGrid = gridDiffers(gpui.fold, tanstack.fold);
  same.fold = { tables: gpui.fold.length, cells: a.size, differ: differ.length, gridDiffers: foldGrid.length, controlDiffers };
  console.log(`the fold: ${a.size} cells over ${gpui.fold.length} tables, ${differ.length} written differently; ${foldGrid.length} tables or columns placed differently; the control (TanStack's fold one tick short): ${controlDiffers} differ (some must)`);
  if (controlDiffers === 0) fail("the fold's control: TanStack's fold one tick short matched GPUI's");
  if (a.size === 0 || differ.length || a.size !== b.size) fail(`the fold's cells differ (${a.size} on GPUI, ${b.size} on TanStack): ${differ.slice(0, 4).join('; ')}`);
  if (foldGrid.length) fail(`the fold's grid differs: ${foldGrid.slice(0, 4).join('; ')}`);
  // Each grid.
  const grids: Record<string, unknown> = {};
  for (const key of Object.keys(gpui.grids)) {
    const other = tanstack.grids[key];
    if (!other) {
      fail(`grid ${key}: none on TanStack`);
      continue;
    }
    const wrong = gridDiffers(gpui.grids[key]!, other);
    // The control: TanStack's tables moved past the tolerance differ, every one.
    const control = controlHolds(gpui.grids[key]!, other);
    grids[key] = { differ: wrong.length, controlTablesDiffer: control.differ };
    console.log(`grid ${key}: ${gpui.grids[key]!.length} tables, ${wrong.length} differences; the control (TanStack's moved 2 px): ${control.differ} of ${gpui.grids[key]!.length} tables differ (all must)`);
    if (wrong.length) fail(`grid ${key}: ${wrong.slice(0, 4).join('; ')}`);
    if (!control.holds) fail(`grid ${key}: the control (TanStack's tables moved 2 px) differs in ${control.differ} of ${gpui.grids[key]!.length} tables`);
  }
  same.grids = grids;
}

async function runSide(side: Side): Promise<void> {
  const serve = side === 'gpui' ? serveGpui : serveTanstack;
  const fail = (what: string) => failures.push(`${side}: ${what}`);
  const out: Record<string, unknown> = {};
  results[side] = out;
  console.log(`\n${side}:`);
  const wall = await serve(PORTS[side].wall, undefined, 'wall');
  servers.push(wall);
  const base = await serve(PORTS[side].base);
  servers.push(base);
  const at = (stop: string) => `?scenario=${MONITORING_WALL.id}&stop=${stop}`;
  const scene = at(MONITORING_WALL.defaultStop);
  const seen: { fold: DrawnTable[]; foldControl: DrawnTable[]; grids: Record<string, DrawnTable[]> } = { fold: [], foldControl: [], grids: {} };
  drawn[side] = seen;

  // The fold on screen, every table, and its control.
  const fold: Record<string, unknown> = {};
  for (const [ticks, control] of [
    [fixture.ticks, false],
    [fixture.ticks - 1, true],
  ] as const) {
    for (const theme of ['light', 'dark'] as const) {
      const { context, page, found, end } = await open(browser, wall.url, `${at(String(FOLD_TABLES))}&ticks=${ticks}&cells&measure&theme=${theme}`, { theme, viewport: TALL });
      try {
        if (end !== 'filled') {
          fail(`fold ${ticks} ${theme}: ${end}, not filled`);
          continue;
        }
        await folded(page, ticks);
        // The last flash fades out, and the frame after it is drawn.
        await page.waitForTimeout(MONITORING_WALL.flash.ms + 300);
        const tables = await wallTables(page);
        if (theme === 'light') seen[control ? 'foldControl' : 'fold'] = tables;
        const wrong = compare(tables, theme);
        const cells = tables.reduce((total, { cells = [] }) => total + cells.length, 0);
        fold[`${ticks}-${theme}`] = { tables: tables.length, cells, wrong: wrong.length, first: wrong.slice(0, 5) };
        console.log(`fold of ${ticks} ticks, ${theme}: ${tables.length} tables, ${cells} cells drawn, ${wrong.length} differ${control ? ' (the control: some must)' : ''}`);
        if (control ? wrong.length === 0 : wrong.length > 0) fail(control ? `the control (${ticks} ticks, ${theme}) matched the fixture` : `fold ${ticks} ${theme}: ${wrong.slice(0, 5).join('; ')}`);
        if (found.length) fail(`fold ${ticks} ${theme}: ${found.join('; ')}`);
      } finally {
        await context.close();
      }
    }
  }
  out.fold = fold;

  // A flash while the feed runs: Last alone, at the mix at most.
  {
    const { context, page, end } = await open(browser, wall.url, `${scene}&cells&theme=light`);
    try {
      if (end !== 'filled') fail(`flash: ${end}`);
      await page.waitForTimeout(1000);
      const tables = await wallTables(page);
      const flashing = tables.flatMap(({ cells = [] }) => cells.filter((cell) => cell.flash));
      const columns = new Set(flashing.map((cell) => COLUMNS[cell.column]));
      const drawnFlashing = COLUMNS.filter((column) => MONITORING_WALL.flash.columns.includes(column));
      const wrongColumn = [...columns].filter((column) => !drawnFlashing.includes(column!));
      const off = flashing.filter((cell) => flashOff('light', cell.flash!));
      const tablesFlashing = tables.filter(({ cells = [] }) => cells.some((cell) => cell.flash)).length;
      out.flash = { flashing: flashing.length, tables: tablesFlashing, columns: [...columns], off: off.length };
      console.log(`flash: ${flashing.length} cells flashing in ${tablesFlashing} of ${tables.length} tables, in ${[...columns].join(', ')}; ${off.length} off the rise's or fall's color at the mix`);
      if (tablesFlashing !== tables.length) fail(`flash: ${tablesFlashing} of ${tables.length} tables flashing under the feed`);
      if (wrongColumn.length) fail(`flash: ${wrongColumn.join(', ')} flashing`);
      if (off.length) fail(`flash: ${off.length} cells off color, e.g. ${JSON.stringify(off[0])}`);
    } finally {
      await context.close();
    }
  }

  // The marks across the tables at each stop.
  const marks: Record<string, unknown> = {};
  for (const stop of MONITORING_WALL.stops) {
    const { context, page, found, end } = await open(browser, wall.url, `${at(stop.id)}&measure`, { init: [presentingTaskRecorder, refreshedLog] });
    try {
      if (end !== 'filled') {
        fail(`marks ${stop.id}: ${end}`);
        continue;
      }
      await page.waitForTimeout(3000);
      const { log, batches, origin, filled, state } = await page.evaluate(() => {
        const g = globalThis as Global;
        return {
          log: g.__refreshedLog ?? [],
          batches: g.__contender?.batches ?? [],
          origin: performance.timeOrigin,
          filled: performance.getEntriesByName('contender:filled', 'mark').map((entry) => entry.startTime),
          state: g.__contender?.state,
        };
      });
      // The filled mark: once, every table filled.
      const filledPresented = side === 'gpui' && filled[0] !== undefined ? (await presentedMark(page, filled[0])).ok : true;
      // GPUI's refreshed marks right after a presented frame: a sample
      // spread over the window (each check waits).
      const sample = log.filter((_, i) => i % Math.max(1, Math.floor(log.length / 20)) === 0);
      let presented = 0;
      if (side === 'gpui') for (const [time] of sample) if ((await presentedMark(page, time)).ok) presented++;
      // Every batch reached, a generation a table.
      const gaps = batches.filter(([seq], i) => seq !== i).length;
      const shaped = batches.filter(([, , , generations]) => generations.length !== stop.tables).length;
      const wide = log.filter(([, drawn]) => drawn.length !== stop.tables).length;
      // Each batch with a tick on screen paired across its tables.
      const visible = batches.filter(([, , , , mask]) => mask !== 0);
      const lags: number[] = [];
      let unpaired = 0;
      for (const [, , sent, generations, mask] of visible) {
        const sentAt = sent - origin;
        const frame = log.find(([, drawn]) => generations.every((generation, table) => !(mask & (1 << table)) || (drawn[table] ?? 0) >= generation));
        if (frame && frame[0] >= sentAt && frame[0] - sentAt <= PAIRED_MS) lags.push(frame[0] - sentAt);
        else unpaired++;
      }
      lags.sort((a, b) => a - b);
      const lag = { p50: Number((lags[Math.floor(lags.length / 2)] ?? 0).toFixed(1)), max: Number((lags.at(-1) ?? 0).toFixed(1)) };
      const ticks = batches.reduce((total, [, count]) => total + count, 0);
      marks[stop.id] = { filled: filled.length, filledPresented, refreshed: log.length, sampled: sample.length, presented, batches: batches.length, gaps, ticks, visible: visible.length, reached: lags.length, sendToMarkMs: lag, stateTables: state?.tables };
      console.log(
        `marks at ${stop.id}: ${filled.length} filled${side === 'gpui' ? ` (right after a presented frame: ${filledPresented})` : ''}; ${log.length} refreshed, ${presented} of ${sample.length} sampled right after a presented frame; ${batches.length} batches (${ticks} ticks, ${gaps} out of order), ${lags.length} of ${visible.length} visible paired across their tables (send → mark p50 ${lag.p50}, max ${lag.max} ms); state.tables ${state?.tables}`,
      );
      if (filled.length !== 1) fail(`marks ${stop.id}: ${filled.length} filled marks, not 1`);
      if (!filledPresented) fail(`marks ${stop.id}: the filled mark isn't right after a presented frame`);
      if (log.length === 0) fail(`marks ${stop.id}: no refreshed mark`);
      if (side === 'gpui' && presented !== sample.length) fail(`marks ${stop.id}: ${sample.length - presented} refreshed marks not right after a presented frame`);
      if (batches.length === 0 || gaps) fail(`marks ${stop.id}: ${batches.length} batches, ${gaps} out of order or missing`);
      if (shaped || wide) fail(`marks ${stop.id}: ${shaped} batches and ${wide} refreshed logs without a generation a table`);
      if (unpaired > 2) fail(`marks ${stop.id}: ${unpaired} visible batches with no frame of their own within ${PAIRED_MS} ms`);
      if (state?.tables !== stop.tables) fail(`marks ${stop.id}: state.tables ${state?.tables}, not ${stop.tables}`);
      if (found.length) fail(`marks ${stop.id}: ${found.join('; ')}`);
    } finally {
      await context.close();
    }
  }
  out.marks = marks;

  // Unmeasured, no refreshed marks: they'd pile up in a long session.
  {
    const { context, page, end } = await open(browser, wall.url, scene);
    await page.waitForTimeout(1000);
    const count = await page.evaluate(() => performance.getEntriesByName('contender:refreshed', 'mark').length);
    console.log(`unmeasured: ${end}, ${count} refreshed marks`);
    if (end !== 'filled' || count !== 0) fail(`unmeasured: ${end}, ${count} refreshed marks (want filled, none)`);
    await context.close();
  }

  // A phone's column: a wheel over a table scrolls the table alone, one
  // over a gap the column.
  {
    const { context, page, end } = await open(browser, wall.url, `${at('4')}&measure`, { viewport: { width: 390, height: 844 } });
    try {
      if (end !== 'filled') fail(`phone: ${end}`);
      const { gap, title } = MONITORING_WALL.grid;
      const strip = { x: 0, y: gap, width: 390, height: title };
      const shot = () => page.screenshot({ clip: strip });
      const top = () => page.evaluate(() => (globalThis as Global).__contender?.state?.top ?? 0);
      await page.waitForTimeout(300);
      const before = await shot();
      // Over the first table's rows.
      await page.mouse.move(195, gap + title + 100);
      await page.mouse.wheel(0, 120);
      await page.waitForTimeout(400);
      const [overTable, tableTop] = [await shot(), await top()];
      // Over the top gap.
      await page.mouse.move(195, gap / 2);
      await page.mouse.wheel(0, 120);
      await page.waitForTimeout(400);
      const overGap = await shot();
      const columnHeld = before.equals(overTable);
      const columnMoved = !overTable.equals(overGap);
      out.phone = { tableScrolled: tableTop > 0, columnHeld, columnMoved };
      console.log(`phone: a wheel over a table scrolls it (top ${tableTop}) and ${columnHeld ? 'holds' : 'moves'} the column; over a gap ${columnMoved ? 'moves' : 'holds'} it`);
      if (!(tableTop > 0) || !columnHeld || !columnMoved) fail(`phone: table scrolled ${tableTop > 0}, column held under the table ${columnHeld}, column moved from a gap ${columnMoved}`);
    } finally {
      await context.close();
    }
  }

  // The feed's worker failing to load fails the view, once it filled.
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    await context.route('**/assets/worker-*.js', (route) => route.fulfill({ status: 404, body: '' }));
    const page = await context.newPage();
    await page.goto(`${wall.url}${scene}`);
    const filled = await waitMark(page, MARKS.filled, 0, 60_000).then(() => true, () => false);
    const failed = await waitMark(page, MARKS.failed, 0, 10_000).then(() => true, () => false);
    console.log(`worker 404: filled ${filled}, failed ${failed}`);
    if (!filled || !failed) fail(`worker 404: filled ${filled}, failed ${failed} (want both)`);
    await context.close();
  }

  // The grid: each table's cells' place, row height, and columns, at each
  // stop and on a phone.
  const grids: Record<string, unknown> = {};
  for (const [key, stop, viewport] of [...MONITORING_WALL.stops.map((stop) => [stop.id, stop.id, undefined] as const), ['phone', '4', PHONE] as const]) {
    const { context, page, found, end } = await open(browser, wall.url, `${at(stop)}&cells&theme=light`, { viewport });
    try {
      if (end !== 'filled') {
        fail(`grid ${key}: ${end}`);
        continue;
      }
      await page.waitForTimeout(300);
      const tables = (await wallTables(page)).map(({ columns, layout, box }) => ({ columns, layout, box }));
      seen.grids[key] = tables;
      const missing = tables.filter((table) => !table.layout || !table.box || !table.columns?.length).length;
      grids[key] = tables.map(({ layout }) => layout && [layout.left, layout.top]);
      console.log(`grid ${key}: ${tables.length} tables, cells at ${tables.map(({ layout }) => (layout ? `(${layout.left}, ${layout.top})` : '?')).join(' ')}`);
      if (missing) fail(`grid ${key}: ${missing} tables without a layout, a box, or columns`);
      if (found.length) fail(`grid ${key}: ${found.join('; ')}`);
    } finally {
      await context.close();
    }
  }
  out.grids = grids;

  // What fails the load.
  const failing: [string, string][] = [
    ['an unknown stop', `${wall.url}${at('5')}`],
    ['an unknown scenario', `${wall.url}?scenario=nope`],
    ["ticks that aren't a count", `${wall.url}${scene}&ticks=x`],
    ['the wall on the base build', `${base.url}?scenario=${MONITORING_WALL.id}`],
  ];
  for (const [what, url] of failing) {
    const { context, end } = await open(browser, url, '');
    console.log(`${what}: ${end}`);
    if (end !== 'failed') fail(`${what}: ${end}, not failed`);
    await context.close();
  }
}

if (label) {
  mkdirSync(join(perfDir, 'results'), { recursive: true });
  const path = join(perfDir, 'results', `${localDate()}-${label}.json`);
  writeFileSync(path, `${JSON.stringify({ date: localDate(), label, ...machineInfo(), ...results, failures }, null, 2)}\n`);
  console.log(`wrote ${path}`);
}
if (failures.length) {
  for (const failure of failures) console.error(`FAIL: ${failure}`);
  process.exit(1);
}
console.log('PASS');
