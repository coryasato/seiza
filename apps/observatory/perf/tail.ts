// The contenders at the tail level (`contenders/scenarios.ts`'s live tail),
// on their release builds, in Chromium, each side the same checks:
//
// - the replay's cells: at the top stop with `?measure&cells`, at
//   2560×1700 and DPR 1 (every column drawn), once the tail is past the
//   file's end, the clock paused (`__contender.pause`), in the light theme
//   and the dark, three views (the tail where it follows, a lap's seam by
//   the replay's jump, the first rows): every drawn cell against native
//   DuckDB's row of the file (row i the file's row i mod n): the time the
//   log's text moved on by its laps (`contenders/tail/data.ts`), drawn in
//   the muted foreground (`theme.css`'s, which is gpui-kit's); the request
//   as the file has it; a 4xx or 5xx status in the scenario's error color
//   (within one 8-bit step) and any other unpainted; the bytes grouped, a
//   NULL `NULL`; the columns at the scenario's widths (the canvas's, each
//   within half a pixel; the control, the table's widths by kind, must
//   differ). The seam's view must hold rows of both laps, and the
//   control (every time read with no lap's shift) must fail the tail's and
//   the seam's;
// - the same on both sides (when both run): the seam's and the first rows'
//   cells, light and dark, byte-identical in their exact and shown text (a
//   request either side cut with "…" by its exact text alone) and within
//   one 8-bit step in their color; the columns at the same x and width;
// - the marks (`docs/contender-contract.md`), at the default stop with
//   `?measure`: `contender:tail` right after a presented frame on GPUI
//   (`presentedMark`, a sample over the window), set in a frame's callback
//   on TanStack (the commit that draws it), `__contenderTail` at each
//   mark rising, each clock message on `__contender.batches` (`[rows,
//   at]`) reached by a later tail mark, its counts the clock's (each
//   message's rows since the last the rate times the time between their
//   stamps, within 2, at each side's receiver); following on
//   `__contenderFollowing`;
//   a wheel up lets go, and the state's top holds for a second as the rows
//   grow; End follows again, the tail marks resuming;
// - unmeasured, none of it: no tail mark, no batches, no tail global, no
//   pause;
// - a replay `open()` starts over: the rows from 0 again, then growing,
//   and `__contender.batches` starting over with them; a pause asked at
//   the open's fill, before the clock's worker exists, holds the rows at 0
//   until it's lifted;
// - the clock's worker, or the file fetched whole, answered 404 fails the
//   view (`contender:failed` after `contender:filled`); an unknown stop or
//   scenario, and live tail asked of the base build, fail the load.
//
// Usage: node apps/observatory/perf/tail.ts [--side gpui] [--label <name>]
// --label writes perf/results/<date>-<label>.json. Needs `just observatory
// data`; run `gpui-build`, `gpui-build tail`, `tanstack-build`, and
// `tanstack-build tail` first.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Browser, type Page } from '@playwright/test';
import { presentedMark, presentingTaskRecorder, waitMark } from '../../../shared-web/perf/harness.ts';
import { localDate, machineInfo, option } from '../../../shared-web/perf/protocol.ts';
import { LIVE_TAIL, BUILT } from '../contenders/scenarios.ts';
import { CATCH_UP_MS } from '../contenders/tail/clock.ts';
import { DATA_FILE, FILE_ROWS, SPAN_S } from '../contenders/tail/data.ts';
import { timeText } from '../contenders/tall-table/tanstack/web/src/data/tail.ts';
import type { AppServer } from '../../../shared-web/perf/serve.ts';
import type { Contender, Side } from '../contenders/contract.ts';
import { MARKS, dataPath, mutedForeground, nativeDuckDB, perfDir, problems, serveGpui, serveTanstack, tailError } from './harness.ts';

const label = option('label');
const sideOption = option('side');
if (sideOption && sideOption !== 'gpui' && sideOption !== 'tanstack') throw new Error(`--side ${sideOption}: gpui or tanstack`);
/** The sides that build the level (`BUILT`), or the one asked for. */
const sides: Side[] = sideOption ? [sideOption as Side] : (['gpui', 'tanstack'] as const).filter((side) => BUILT[side].includes('tail'));
for (const side of sides) if (!BUILT[side].includes('tail')) throw new Error(`--side ${side}: it doesn't build the tail level yet`);
const PORTS: Record<Side, { tail: number; base: number }> = { gpui: { tail: 4369, base: 4370 }, tanstack: { tail: 4371, base: 4372 } };
/** How soon after a clock message a tail mark must reach its count: a few
 *  frames and a page's read in DuckDB-Wasm (~8 ms). */
const REACHED_MS = 250;
const COLUMNS = ['time', 'request', 'status', 'bytes'] as const;

interface Cell {
  row: number;
  column: number;
  exact: string;
  shown: string;
  text: number[] | null;
}
interface ColumnBox {
  name: string;
  x: number;
  width: number;
}
type Global = {
  __contender?: Contender & { cells?: Cell[]; columns?: ColumnBox[]; batches?: [rows: number, at: number][] };
  __contenderTail?: number;
  __contenderFollowing?: boolean;
  __tailLog?: [at: number, tail: number, inFrame: boolean][];
  __inFrame?: number;
};
type Theme = 'light' | 'dark';

const failures: string[] = [];
const results: Record<string, unknown> = {};

const near = (a: readonly number[], b: readonly number[], steps = 1) => a.length === b.length && a.every((channel, i) => Math.abs(channel - b[i]!) <= steps);

const muted = mutedForeground();
const grouped = new Intl.NumberFormat('en-US', { useGrouping: true });

/** Logs `__contenderTail` at each tail mark, as it stands then (set in the
 *  frame's task, before its mark), and whether the mark was set inside an
 *  animation frame callback (every rAF callback wrapped). */
function tailLog(): void {
  const g = globalThis as Global;
  const log: [number, number, boolean][] = [];
  g.__tailLog = log;
  g.__inFrame = 0;
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (callback: FrameRequestCallback) =>
    raf((time) => {
      g.__inFrame!++;
      try {
        callback(time);
      } finally {
        g.__inFrame!--;
      }
    });
  const mark = performance.mark.bind(performance);
  performance.mark = (name: string, options?: PerformanceMarkOptions) => {
    const entry = mark(name, options);
    if (name === 'contender:tail') log.push([entry.startTime, g.__contenderTail ?? 0, g.__inFrame! > 0]);
    return entry;
  };
}

/** Each message's rows since the last against the rate times the time
 *  between their stamps (a gap past the clock's catch-up cap skipped): the
 *  largest difference, rows. The clock carries a fraction, so the one
 *  clock's counts are within 1 of it, and a stamp taken after the count
 *  within 2. */
function clockDrift(batches: readonly (readonly [number, number])[], rate: number): number {
  let worst = 0;
  for (let i = 1; i < batches.length; i++) {
    const [rows, at] = batches[i]!;
    const [before, then] = batches[i - 1]!;
    if (at - then > CATCH_UP_MS) continue;
    worst = Math.max(worst, Math.abs(rows - before - (rate * (at - then)) / 1000));
  }
  return worst;
}

/** Each side's drawn cells by view and theme, and its columns, for the
 *  comparison of the two sides. */
const drawnBySide: Partial<Record<Side, { cells: Map<string, Cell[]>; columns: ColumnBox[] }>> = {};

async function open(browser: Browser, url: string, query: string, options: { theme?: Theme; viewport?: { width: number; height: number }; init?: (() => void)[]; route?: (page: Page) => Promise<void> } = {}) {
  const context = await browser.newContext({ viewport: options.viewport ?? { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  for (const script of options.init ?? []) await context.addInitScript(script);
  const page = await context.newPage();
  await options.route?.(page);
  await page.emulateMedia({ colorScheme: options.theme ?? 'light' });
  const found = problems(page);
  await page.goto(`${url}${query}`);
  const ended = [waitMark(page, MARKS.filled, 0, 60_000).then(() => 'filled' as const), waitMark(page, MARKS.failed, 0, 60_000).then(() => 'failed' as const)];
  for (const waiting of ended) waiting.catch(() => {});
  const end = await Promise.race(ended).catch(() => 'neither' as const);
  return { context, page, found, end };
}

const stateOf = (page: Page) => page.evaluate(() => (globalThis as Global).__contender?.state ?? null);

/** Waits until every visible row is drawn with its values, and a frame more. */
async function filledView(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const state = (globalThis as Global).__contender?.state;
    return !!state && state.end > state.first && state.pending === 0 && state.loaded === state.end - state.first;
  }, undefined, { timeout: 15_000, polling: 20 });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

/** The file's rows `rows` (each mod the file's), from native DuckDB. */
async function fileRows(rows: number[]): Promise<Map<number, { micros: number; request: string; status: number; bytes: number | null }>> {
  const native = await nativeDuckDB();
  const wanted = [...new Set(rows.map((row) => row % FILE_ROWS))];
  const read = await native.runAndReadAll(
    `SELECT file_row_number, epoch_us("time"), request, status, bytes FROM read_parquet('${dataPath(DATA_FILE)}', file_row_number = true) WHERE file_row_number IN (${wanted.join(', ')})`,
  );
  return new Map(read.getRows().map(([row, micros, request, status, bytes]) => [Number(row), { micros: Number(micros), request: String(request), status: Number(status), bytes: bytes === null ? null : Number(bytes) }]));
}

/** The drawn cells against the file's rows, in `theme`: what differs.
 *  `noShift`, the control: every time read as lap 0's. */
async function compare(cells: Cell[], theme: Theme, noShift = false): Promise<string[]> {
  const wrong: string[] = [];
  const file = await fileRows(cells.map((cell) => cell.row));
  const rows = new Set(cells.map((cell) => cell.row));
  for (const row of rows) for (let column = 0; column < COLUMNS.length; column++) if (!cells.some((cell) => cell.row === row && cell.column === column)) wrong.push(`row ${row} ${COLUMNS[column]}: not drawn`);
  for (const cell of cells) {
    const want = file.get(cell.row % FILE_ROWS);
    const at = `row ${cell.row} ${COLUMNS[cell.column]}`;
    if (!want) {
      wrong.push(`${at}: no such file row`);
      continue;
    }
    const color = cell.text?.slice(0, 3) ?? null;
    switch (COLUMNS[cell.column]) {
      case 'time': {
        const lap = noShift ? 0 : Math.floor(cell.row / FILE_ROWS);
        const text = timeText(want.micros / 1000 + lap * SPAN_S * 1000);
        if (cell.exact !== text || cell.shown !== text) wrong.push(`${at}: ${cell.shown} (${cell.exact}), want ${text}`);
        if (!color || !near(color, muted[theme])) wrong.push(`${at}: drawn ${color}, not the muted ${muted[theme]}`);
        break;
      }
      case 'request':
        if (cell.exact !== want.request) wrong.push(`${at}: ${cell.exact}, want ${want.request}`);
        if (cell.shown !== cell.exact && !cell.shown.endsWith('…')) wrong.push(`${at}: shown ${cell.shown}`);
        if (color) wrong.push(`${at}: painted ${color}`);
        break;
      case 'status': {
        if (cell.exact !== String(want.status)) wrong.push(`${at}: ${cell.exact}, want ${want.status}`);
        const error = want.status >= 400;
        if (error ? !color || !near(color, tailError(theme)) : color !== null) wrong.push(`${at}: ${want.status} drawn ${color}, want ${error ? tailError(theme) : 'no paint'}`);
        break;
      }
      case 'bytes': {
        const [exact, shown] = want.bytes === null ? ['NULL', 'NULL'] : [String(want.bytes), grouped.format(want.bytes)];
        if (cell.exact !== exact || cell.shown !== shown) wrong.push(`${at}: ${cell.shown} (${cell.exact}), want ${shown} (${exact})`);
        break;
      }
      default:
        wrong.push(`${at}: a column past the four`);
    }
  }
  return wrong;
}

const servers: AppServer[] = [];
const browser = await chromium.launch({ channel: 'chromium' });
try {
  for (const side of sides) await runSide(side);
  if (drawnBySide.gpui && drawnBySide.tanstack) bothSides(drawnBySide.gpui, drawnBySide.tanstack);
} finally {
  await browser.close();
  for (const server of servers) await server.close();
}

/** The two sides' drawn cells at the same rows (the seam's and the first
 *  rows', by the replay's jump), and their columns. */
function bothSides(gpui: NonNullable<(typeof drawnBySide)['gpui']>, tanstack: NonNullable<(typeof drawnBySide)['gpui']>): void {
  const out: Record<string, unknown> = {};
  results.same = out;
  const geometry = gpui.columns.map((column, i) => ({ column, other: tanstack.columns[i] }));
  const columnsOff = geometry.filter(({ column, other }) => !other || other.name !== column.name || Math.abs(other.x - column.x) > 0.5 || Math.abs(other.width - column.width) > 0.5);
  out.columns = { gpui: gpui.columns.map(({ name, x, width }) => [name, x, width]), off: columnsOff.length };
  console.log(`\nboth sides: the columns ${gpui.columns.map(({ name, x, width }) => `${name} at ${x}, ${width}`).join('; ')}; ${columnsOff.length} off on TanStack`);
  if (columnsOff.length || gpui.columns.length !== tanstack.columns.length) failures.push(`same: columns ${JSON.stringify(columnsOff)}`);
  for (const [key, cells] of gpui.cells) {
    if (key.startsWith('tail-')) continue;
    const theirs = new Map((tanstack.cells.get(key) ?? []).map((cell) => [`${cell.row}:${cell.column}`, cell]));
    let shared = 0;
    const wrong: string[] = [];
    for (const cell of cells) {
      const other = theirs.get(`${cell.row}:${cell.column}`);
      if (!other) continue;
      shared++;
      const cut = COLUMNS[cell.column] === 'request' && (cell.shown.endsWith('…') || other.shown.endsWith('…'));
      const colors = cell.text === null || other.text === null ? cell.text === other.text : near(cell.text.slice(0, 3), other.text.slice(0, 3));
      if (cell.exact !== other.exact || (!cut && cell.shown !== other.shown) || !colors) wrong.push(`row ${cell.row} ${COLUMNS[cell.column]}: ${cell.shown} ${cell.text} | ${other.shown} ${other.text}`);
    }
    out[key] = { shared, differ: wrong.length, examples: wrong.slice(0, 5) };
    console.log(`both sides, ${key}: ${shared} cells at the same rows, ${wrong.length} differ`);
    if (shared < cells.length / 2) failures.push(`same ${key}: ${shared} of ${cells.length} cells at rows both drew`);
    if (wrong.length) failures.push(`same ${key}: ${wrong.slice(0, 5).join('; ')}`);
  }
}

async function runSide(side: Side): Promise<void> {
  const serve = side === 'gpui' ? serveGpui : serveTanstack;
  const fail = (what: string) => failures.push(`${side}: ${what}`);
  const out: Record<string, unknown> = {};
  results[side] = out;
  console.log(`\n${side}:`);
  const tail = await serve(PORTS[side].tail, undefined, 'tail');
  servers.push(tail);
  const base = await serve(PORTS[side].base);
  servers.push(base);
  const scene = `?scenario=${LIVE_TAIL.id}`;

  // The replay's cells past a lap, the clock paused: the tail, the seam, the first rows.
  const top = LIVE_TAIL.stops.at(-1)!;
  const cellsOut: Record<string, unknown> = {};
  const drawn: { cells: Map<string, Cell[]>; columns: ColumnBox[] } = { cells: new Map(), columns: [] };
  drawnBySide[side] = drawn;
  for (const theme of ['light', 'dark'] as const) {
    const { context, page, found, end } = await open(browser, tail.url, `${scene}&stop=${top.id}&measure&cells&theme=${theme}`, { theme, viewport: { width: 2560, height: 1700 } });
    try {
      if (end !== 'filled') {
        fail(`cells ${theme}: ${end}, not filled`);
        continue;
      }
      // A lap at the top stop is ~19 s.
      await page.waitForFunction((past) => ((globalThis as Global).__contenderTail ?? 0) > past, FILE_ROWS + 100, { timeout: 60_000, polling: 100 });
      await page.evaluate(() => (globalThis as Global).__contender?.pause?.(true));
      // The paused count reaches the table, and its tail is drawn.
      let rows = -1;
      for (let tries = 0; tries < 50; tries++) {
        await page.waitForTimeout(100);
        const now = (await stateOf(page))?.rows ?? -1;
        if (now === rows) break;
        rows = now;
      }
      await filledView(page);
      // The columns at the canvas's widths, and the control: the table's by
      // kind (time 184, request 200, status 69, bytes 101 at 14 px text).
      const columns = await page.evaluate(() => (globalThis as Global).__contender?.columns ?? []);
      drawn.columns = columns;
      const widthsOff = (want: readonly number[]) => columns.filter((column, i) => column.name !== COLUMNS[i] || Math.abs(column.width - want[i]!) > 0.5).map((column) => `${column.name} ${column.width}`);
      const off = columns.length === COLUMNS.length ? widthsOff(LIVE_TAIL.widths) : [`${columns.length} columns`];
      const control = widthsOff([184, 200, 69, 101]);
      cellsOut[`widths-${theme}`] = { widths: columns.map((column) => column.width), off, controlOff: control.length };
      console.log(`widths, ${theme}: ${columns.map((column) => `${column.name} ${column.width}`).join(', ')}; ${off.length} off the scenario's; the control (the kinds' widths) ${control.length} off`);
      if (off.length) fail(`widths ${theme}: ${off.join('; ')}, not ${LIVE_TAIL.widths.join(', ')}`);
      if (!control.length) fail(`widths ${theme}: the control (the kinds' widths) matched`);
      const views: [string, () => Promise<void>][] = [
        ['tail', async () => {}],
        ['seam', () => page.evaluate((fraction) => (globalThis as Global).__contender!.replay.jump(fraction), (FILE_ROWS - 20) / rows)],
        ['first', () => page.evaluate(() => (globalThis as Global).__contender!.replay.jump(0))],
      ];
      for (const [view, go] of views) {
        await go();
        await filledView(page);
        const cells = await page.evaluate(() => (globalThis as Global).__contender?.cells ?? []);
        drawn.cells.set(`${view}-${theme}`, cells);
        const wrong = await compare(cells, theme);
        const control = view === 'first' ? null : (await compare(cells, theme, true)).length;
        const drawnRows = [...new Set(cells.map((cell) => cell.row))].sort((a, b) => a - b);
        const laps = [...new Set(drawnRows.map((row) => Math.floor(row / FILE_ROWS)))];
        const errors = cells.filter((cell) => cell.column === 2 && Number(cell.exact) >= 400).length;
        cellsOut[`${view}-${theme}`] = { rows: drawnRows.length, first: drawnRows[0], last: drawnRows.at(-1), laps, errors, wrong: wrong.length, examples: wrong.slice(0, 5), control };
        console.log(`cells, ${theme}, the ${view}: rows ${drawnRows[0]}–${drawnRows.at(-1)} (laps ${laps.join(', ')}), ${cells.length} cells, ${errors} error statuses, ${wrong.length} differ${control === null ? '' : `; the control (no shift) ${control} differ`}`);
        if (control === 0) fail(`cells ${theme} ${view}: the control (no lap's shift) matched`);
        if (!cells.length) fail(`cells ${theme} ${view}: nothing drawn`);
        if (wrong.length) fail(`cells ${theme} ${view}: ${wrong.slice(0, 5).join('; ')}`);
        if (view === 'seam' && laps.length < 2) fail(`cells ${theme} seam: one lap drawn (${laps.join(', ')}), want both sides of the seam`);
        if (view === 'tail' && !laps.some((lap) => lap > 0)) fail(`cells ${theme} tail: no row past the file's end`);
      }
      if (found.length) fail(`cells ${theme}: ${found.join('; ')}`);
    } finally {
      await context.close();
    }
  }
  out.cells = cellsOut;

  // The marks at the default stop, the scroll back, and End.
  {
    const { context, page, found, end } = await open(browser, tail.url, `${scene}&measure`, { init: [presentingTaskRecorder, tailLog] });
    try {
      if (end !== 'filled') fail(`marks: ${end}`);
      await page.waitForFunction(() => ((globalThis as Global).__tailLog ?? []).length > 0, undefined, { timeout: 30_000 });
      await page.waitForTimeout(3000);
      const { log, batches, origin, following } = await page.evaluate(() => ({
        log: (globalThis as Global).__tailLog ?? [],
        batches: (globalThis as Global).__contender?.batches ?? [],
        origin: performance.timeOrigin,
        following: (globalThis as Global).__contenderFollowing,
      }));
      // Where each side sets the mark: GPUI's right after a presented frame
      // (a sample), TanStack's in a frame's callback (every one).
      const sample = side === 'gpui' ? log.filter((_, i) => i % Math.max(1, Math.floor(log.length / 20)) === 0) : log;
      let presented = 0;
      if (side === 'gpui') for (const [time] of sample) if ((await presentedMark(page, time)).ok) presented++;
      if (side === 'tanstack') presented = log.filter(([, , inFrame]) => inFrame).length;
      const rising = log.every(([, rows], i) => i === 0 || rows >= log[i - 1]![1]);
      // Each message's count reached by a tail mark after it, soon; the
      // window's last messages may not be yet.
      const last = log.at(-1)?.[0] ?? 0;
      const lags: number[] = [];
      let unreached = 0;
      for (const [rows, at] of batches) {
        const sentAt = at - origin;
        if (sentAt > last - REACHED_MS) continue;
        const frame = log.find(([time, drawn]) => time >= sentAt && drawn >= rows);
        if (frame && frame[0] - sentAt <= REACHED_MS) lags.push(frame[0] - sentAt);
        else unreached++;
      }
      lags.sort((a, b) => a - b);
      const ordered = batches.every(([rows], i) => i === 0 || rows >= batches[i - 1]![0]);
      const lag = { p50: Number((lags[Math.floor(lags.length / 2)] ?? 0).toFixed(1)), max: Number((lags.at(-1) ?? 0).toFixed(1)) };
      const where = side === 'gpui' ? 'sampled right after a presented frame' : 'set in a frame callback';
      const drift = Number(clockDrift(batches, LIVE_TAIL.stops.find((stop) => stop.id === LIVE_TAIL.defaultStop)!.rate).toFixed(2));
      out.marks = { tail: log.length, sampled: sample.length, presented, rising, batches: batches.length, ordered, reached: lags.length, unreached, messageToMarkMs: lag, clockDrift: drift, following };
      console.log(`marks: ${log.length} tail marks, ${presented} of ${sample.length} ${where}, rising ${rising}; ${batches.length} clock messages (in order ${ordered}, the clock's counts within ${drift} rows), ${lags.length} reached by a tail mark (p50 ${lag.p50}, max ${lag.max} ms), ${unreached} not; following ${following}`);
      if (presented < sample.length) fail(`marks: ${sample.length - presented} tail marks not ${where}`);
      if (drift > 2) fail(`marks: a clock message ${drift} rows off the rate between stamps`);
      if (!rising || !ordered) fail(`marks: the tail falling (${rising}) or the messages out of order (${ordered})`);
      if (!batches.length || unreached > 2) fail(`marks: ${batches.length} messages, ${unreached} not reached within ${REACHED_MS} ms`);
      if (following !== true) fail(`marks: following ${following} under the feed`);

      // A wheel up lets go; the top holds as the rows grow.
      await page.mouse.move(720, 450);
      await page.mouse.wheel(0, -300);
      await page.waitForFunction(() => (globalThis as Global).__contenderFollowing === false, undefined, { timeout: 5_000 }).catch(() => {});
      await page.waitForTimeout(300);
      const held = await stateOf(page);
      await page.waitForTimeout(1000);
      const after = await stateOf(page);
      const letGo = await page.evaluate(() => (globalThis as Global).__contenderFollowing);
      const marksBefore = await page.evaluate(() => (globalThis as Global).__tailLog?.length ?? 0);
      await page.waitForTimeout(500);
      const marksHeld = (await page.evaluate(() => (globalThis as Global).__tailLog?.length ?? 0)) - marksBefore;
      // End follows again.
      await page.keyboard.press('End');
      await page.waitForTimeout(1000);
      const back = await page.evaluate(() => ({ following: (globalThis as Global).__contenderFollowing, marks: (globalThis as Global).__tailLog?.length ?? 0 }));
      out.scrollBack = { letGo, heldTop: held?.top === after?.top, rowsGrew: (after?.rows ?? 0) - (held?.rows ?? 0), marksWhileHeld: marksHeld, followingAfterEnd: back.following, marksAfterEnd: back.marks - marksBefore - marksHeld };
      console.log(`scroll back: following ${letGo}, top ${held?.top} → ${after?.top} while the rows grew by ${(after?.rows ?? 0) - (held?.rows ?? 0)}, ${marksHeld} tail marks while held; End: following ${back.following}, ${back.marks - marksBefore - marksHeld} tail marks`);
      if (letGo !== false) fail('scroll back: a wheel up did not let go');
      if (held?.top !== after?.top || (after?.rows ?? 0) <= (held?.rows ?? 0)) fail(`scroll back: top ${held?.top} → ${after?.top}, rows ${held?.rows} → ${after?.rows} (want the top held as the rows grow)`);
      if (marksHeld) fail(`scroll back: ${marksHeld} tail marks while let go`);
      if (back.following !== true || back.marks - marksBefore - marksHeld === 0) fail(`End: following ${back.following}, no tail marks after it`);
      if (found.length) fail(`marks: ${found.join('; ')}`);
    } finally {
      await context.close();
    }
  }

  // Unmeasured: nothing that grows with the feed.
  {
    const { context, page, end } = await open(browser, tail.url, scene);
    await page.waitForTimeout(2000);
    const left = await page.evaluate(() => ({
      marks: performance.getEntriesByName('contender:tail', 'mark').length,
      batches: (globalThis as Global).__contender?.batches !== undefined,
      tail: (globalThis as Global).__contenderTail !== undefined,
      following: (globalThis as Global).__contenderFollowing !== undefined,
      pause: (globalThis as Global).__contender?.pause !== undefined,
    }));
    out.unmeasured = { end, ...left };
    console.log(`unmeasured: ${end}, ${left.marks} tail marks, batches ${left.batches}, tail ${left.tail}, following ${left.following}, pause ${left.pause}`);
    if (end !== 'filled' || left.marks || left.batches || left.tail || left.following || left.pause) fail(`unmeasured: ${JSON.stringify({ end, ...left })} (want filled and none)`);
    await context.close();
  }

  // A replay open starts over.
  {
    const { context, page, end } = await open(browser, tail.url, `${scene}&measure`);
    try {
      await page.waitForTimeout(1500);
      const before = (await stateOf(page))?.rows ?? 0;
      await page.evaluate(() => (globalThis as Global).__contender!.replay.open());
      const reopened = (await stateOf(page))?.rows ?? -1;
      await page.waitForTimeout(1000);
      const grown = (await stateOf(page))?.rows ?? -1;
      // The log starts over: its first count is the new clock's.
      const firstLogged = await page.evaluate(() => (globalThis as Global).__contender?.batches?.[0]?.[0] ?? -1);
      out.reopen = { end, before, reopened, grown, firstLogged };
      console.log(`reopen: ${before} rows, then ${reopened} at the reopen's fill, ${grown} a second later; the log's first count ${firstLogged}`);
      if (end !== 'filled' || reopened >= before || grown <= reopened) fail(`reopen: ${before} → ${reopened} → ${grown} rows (want fewer, then growing)`);
      if (firstLogged < 0 || firstLogged > grown || firstLogged >= before) fail(`reopen: the log's first count ${firstLogged}, not the new clock's (≤ ${grown})`);
    } finally {
      await context.close();
    }
  }

  // A pause before the worker exists holds from its start.
  {
    const { context, page, end } = await open(browser, tail.url, `${scene}&measure`);
    try {
      await page.evaluate(() => (globalThis as Global).__contender?.pause?.(true));
      await page.waitForTimeout(1500);
      const held = (await stateOf(page))?.rows ?? -1;
      await page.evaluate(() => (globalThis as Global).__contender?.pause?.(false));
      await page.waitForTimeout(1000);
      const lifted = (await stateOf(page))?.rows ?? -1;
      out.earlyPause = { end, held, lifted };
      console.log(`a pause at the fill: ${held} rows 1.5 s on, ${lifted} a second after it's lifted`);
      if (end !== 'filled' || held !== 0 || lifted <= 0) fail(`a pause at the fill: ${held} rows held, ${lifted} after (want 0, then growing)`);
    } finally {
      await context.close();
    }
  }

  // The clock's worker or the file fetched whole failing fails the view, once it filled.
  const broken: [string, (page: Page) => Promise<void>][] = [
    ['the worker 404', async (page) => void (await page.route('**/assets/worker-*.js', (route) => route.fulfill({ status: 404, body: '' })))],
    // The open reads by range; the whole file is one request without one.
    ['the whole file 404', async (page) => void (await page.route(`**/${DATA_FILE}`, (route) => (route.request().headers().range ? route.fallback() : route.fulfill({ status: 404, body: '' }))))],
  ];
  for (const [what, route] of broken) {
    const { context, page, end } = await open(browser, tail.url, scene, { route });
    const failed = await waitMark(page, MARKS.failed, 0, 15_000).then(() => true, () => false);
    console.log(`${what}: ${end}, failed ${failed}`);
    if (end !== 'filled' || !failed) fail(`${what}: ${end}, failed ${failed} (want filled, then failed)`);
    await context.close();
  }

  // What fails the load.
  const failing: [string, string][] = [
    ['an unknown stop', `${tail.url}${scene}&stop=nope`],
    ['an unknown scenario', `${tail.url}?scenario=nope`],
    ['live tail on the base build', `${base.url}${scene}`],
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
