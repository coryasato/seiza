// Both contenders at the market level (`contenders/scenarios.ts`'s market
// watch), on their release builds, in Chromium, each side the same checks:
//
// - the feed's fold on screen: with `?ticks=2000` (the feed fixture's
//   count) at the top stop, once every tick is folded and drawn, at
//   2560×1700 and DPR 1 (every row and column drawn), each drawn cell of
//   the 50 instruments in the light theme and the dark: its exact text the
//   fixture's (`contenders/market/fixtures/feed.json`'s `expect`), the
//   Symbol and Name the feed's instruments', its shown text the scenario's
//   format of it (Last, Bid, Ask, High, and Low at the instrument's
//   decimals, `feed.ts`'s `decimalsOf`; Change signed at them; Change %
//   signed at 2 with `%`; the sizes and Volume grouped), Change's and
//   Change %'s color the rise's or the fall's by sign (within one 8-bit
//   step of the scenario's `signs`) and a zero's another, and no flash once
//   the flash's ms have passed. The control, the fold one tick short
//   (`?ticks=1999`), must fail it;
// - a flash while the feed runs: Last, Bid, and Ask cells drawn with a
//   flash of the rise's or the fall's color at no more than the mix, and
//   no other column's;
// - Shown in's marks (`docs/contender-contract.md`), under the feed at each
//   stop with `?measure`: every `contender:refreshed` where its side sets
//   it (GPUI's right after a presented frame, `presentedMark`; TanStack's
//   in the commit that draws the re-read, inside the frame's animation
//   frame callback, so that frame paints it), and each batch with a tick to a
//   visible row (`__contender.batches`) paired with its frame, the first
//   refreshed mark whose generation (`__contenderRefreshed`, logged at each
//   mark) reaches the batch's: after the batch's send, and within
//   `PAIRED_MS` of it; none without `?measure`;
// - an id the build doesn't have, or `?ticks` that isn't a count, fails the
//   load (`contender:failed`, no `contender:filled`), and market watch
//   asked of the base build fails too; and the feed's worker failing to
//   load fails the view (`contender:failed` after `contender:filled`).
// - The same on both sides (when both run): the columns where the GPUI
//   contender's are (each `x` and `width` within half a pixel), and every
//   drawn cell's text the same.
//
// Usage: node apps/observatory/perf/market.ts [--side gpui|tanstack] [--label <name>]
// --label writes perf/results/<date>-<label>.json. Needs `just observatory
// data`; run `gpui-build`, `gpui-build market`, `tanstack-build`, and
// `tanstack-build market` first (a side's own with --side).

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Browser, type Page } from '@playwright/test';
import { presentedMark, presentingTaskRecorder, waitMark } from '../../../shared-web/perf/harness.ts';
import { localDate, machineInfo, option } from '../../../shared-web/perf/protocol.ts';
import { formatNumber, type NumberFormat } from '../../../components/tall-table/perf/harness.ts';
import { COLUMNS, INSTRUMENTS, decimalsOf } from '../contenders/market/feed.ts';
import { MARKET_WATCH, type Oklch } from '../contenders/scenarios.ts';
import { fromOklch, type Rgba } from '../contenders/tall-table/tanstack/web/src/paint.ts';
import type { AppServer } from '../../../shared-web/perf/serve.ts';
import type { Side } from '../contenders/contract.ts';
import { MARKS, perfDir, problems, serveGpui, serveTanstack } from './harness.ts';

const label = option('label');
const sideOption = option('side');
if (sideOption && sideOption !== 'gpui' && sideOption !== 'tanstack') throw new Error(`--side ${sideOption}: gpui or tanstack`);
const sides: Side[] = sideOption ? [sideOption as Side] : ['gpui', 'tanstack'];
const PORTS: Record<Side, { market: number; base: number }> = { gpui: { market: 4359, base: 4360 }, tanstack: { market: 4361, base: 4362 } };
/** A batch's frame must come this soon after its send (three frames): Shown in reads
 *  ~12 ms here, so a pairing past it is a frame that didn't draw the batch. */
const PAIRED_MS = 50;
type Field = 'last' | 'change' | 'change_pct' | 'bid' | 'ask' | 'bid_size' | 'ask_size' | 'volume' | 'high' | 'low';
/** Each number column's fixture field, its kind, its format, and whether it's at the instrument's decimals. */
const NUMBERS: Record<string, { field: Field; kind: 'float' | 'integer'; format: NumberFormat; priced: boolean }> = {
  Last: { field: 'last', kind: 'float', format: { decimals: 2, sign: 'negative', grouping: false, suffix: '' }, priced: true },
  Change: { field: 'change', kind: 'float', format: { decimals: 2, sign: 'always', grouping: false, suffix: '' }, priced: true },
  'Change %': { field: 'change_pct', kind: 'float', format: { decimals: 2, sign: 'always', grouping: false, suffix: '%' }, priced: false },
  Bid: { field: 'bid', kind: 'float', format: { decimals: 2, sign: 'negative', grouping: false, suffix: '' }, priced: true },
  Ask: { field: 'ask', kind: 'float', format: { decimals: 2, sign: 'negative', grouping: false, suffix: '' }, priced: true },
  'Bid size': { field: 'bid_size', kind: 'integer', format: { decimals: null, sign: 'negative', grouping: true, suffix: '' }, priced: false },
  'Ask size': { field: 'ask_size', kind: 'integer', format: { decimals: null, sign: 'negative', grouping: true, suffix: '' }, priced: false },
  Volume: { field: 'volume', kind: 'integer', format: { decimals: null, sign: 'negative', grouping: true, suffix: '' }, priced: false },
  High: { field: 'high', kind: 'float', format: { decimals: 2, sign: 'negative', grouping: false, suffix: '' }, priced: true },
  Low: { field: 'low', kind: 'float', format: { decimals: 2, sign: 'negative', grouping: false, suffix: '' }, priced: true },
};
const SIGNED = new Set(['Change', 'Change %']);

const fixture = JSON.parse(readFileSync(new URL('../contenders/market/fixtures/feed.json', import.meta.url), 'utf8')) as { seed: number; ticks: number; expect: (Record<Field, string> & { symbol: string })[] };
if (fixture.seed !== MARKET_WATCH.seed) throw new Error(`feed.json's seed ${fixture.seed} isn't the scenario's ${MARKET_WATCH.seed}`);

interface Cell {
  row: number;
  column: number;
  exact: string;
  shown: string;
  text: number[] | null;
  flash: number[] | null;
}
interface ColumnBox {
  name: string;
  x: number;
  width: number;
}
type Global = {
  __contender?: { cells?: Cell[]; columns?: ColumnBox[]; batches?: [seq: number, ticks: number, sent: number, generation: number, visible: number][] };
  __contenderRefreshed?: number;
  __refreshedLog?: [at: number, generation: number, inFrame: boolean][];
  __inFrame?: number;
};
type Theme = 'light' | 'dark';

const failures: string[] = [];
const fail = (what: string) => failures.push(what);
const results: Record<string, unknown> = {};

const rgb8 = (color: Rgba): number[] => [color.r, color.g, color.b].map((channel) => Math.round(channel * 255));
const sign = (theme: Theme, rise: boolean): number[] => rgb8(fromOklch(...(MARKET_WATCH.signs[theme][rise ? 'up' : 'down'] as Oklch)));
const near = (a: readonly number[], b: readonly number[], steps = 1) => a.every((channel, i) => Math.abs(channel - b[i]!) <= steps);

/** Logs `__contenderRefreshed` at each refreshed mark, as it stands then
 *  (set in the frame's task, before its mark), and whether the mark was
 *  set inside an animation frame callback (every rAF callback wrapped). */
function refreshedLog(): void {
  const g = globalThis as Global;
  const log: [number, number, boolean][] = [];
  g.__refreshedLog = log;
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
    if (name === 'contender:refreshed') log.push([entry.startTime, g.__contenderRefreshed ?? 0, g.__inFrame! > 0]);
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

/** Waits until `ticks` are folded and the last batch's re-read is drawn. */
async function folded(page: Page, ticks: number): Promise<void> {
  await page.waitForFunction(
    (ticks) => {
      const batches = (globalThis as Global).__contender?.batches ?? [];
      const sum = batches.reduce((total, [, count]) => total + count, 0);
      const last = batches.at(-1)?.[3] ?? 0;
      return sum === ticks && ((globalThis as Global).__contenderRefreshed ?? 0) >= last;
    },
    ticks,
    { timeout: 30_000, polling: 20 },
  );
}

/** The drawn cells against the fold of `ticks`, in `theme`: what differs. */
function compare(cells: Cell[], theme: Theme): string[] {
  const wrong: string[] = [];
  const seen = new Set<string>();
  for (const cell of cells) {
    const name = COLUMNS[cell.column]!;
    const expect = fixture.expect[cell.row];
    const instrument = INSTRUMENTS[cell.row];
    if (!expect || !instrument) {
      wrong.push(`row ${cell.row}: no instrument`);
      continue;
    }
    seen.add(`${cell.row}:${cell.column}`);
    const at = `${instrument.symbol} ${name}`;
    if (name === 'Symbol' || name === 'Name') {
      const want = name === 'Symbol' ? instrument.symbol : instrument.name;
      if (cell.exact !== want || cell.shown !== want) wrong.push(`${at}: ${cell.shown} (${cell.exact}), want ${want}`);
      continue;
    }
    const number = NUMBERS[name]!;
    const exact = expect[number.field];
    if (cell.exact !== exact) wrong.push(`${at}: exact ${cell.exact}, the fold's ${exact}`);
    const shown = formatNumber(number.kind, exact, number.format, number.priced ? decimalsOf(instrument.price) : number.format.decimals);
    if (cell.shown !== shown) wrong.push(`${at}: shown ${cell.shown}, the format's ${shown}`);
    if (cell.flash) wrong.push(`${at}: still flashing ${cell.flash}`);
    if (SIGNED.has(name)) {
      const value = Number(exact);
      const color = cell.text?.slice(0, 3) ?? [];
      if (value !== 0 && !near(color, sign(theme, value > 0))) wrong.push(`${at}: ${exact} drawn ${color}, not the ${value > 0 ? 'rise' : 'fall'}'s ${sign(theme, value > 0)}`);
      if (value === 0 && (near(color, sign(theme, true), 8) || near(color, sign(theme, false), 8))) wrong.push(`${at}: a zero drawn in a sign's color ${color}`);
    }
  }
  for (let row = 0; row < INSTRUMENTS.length; row++)
    for (let column = 0; column < COLUMNS.length; column++) if (!seen.has(`${row}:${column}`)) wrong.push(`${INSTRUMENTS[row]!.symbol} ${COLUMNS[column]}: not drawn`);
  return wrong;
}

/** Each side's drawn cells after the fixture's ticks, light, and its columns. */
const drawn: Partial<Record<Side, { cells: Cell[]; columns: ColumnBox[] }>> = {};

const servers: AppServer[] = [];
const browser = await chromium.launch({ channel: 'chromium' });
try {
  for (const side of sides) await runSide(side);
  if (drawn.gpui && drawn.tanstack) sameOnBoth(drawn.gpui, drawn.tanstack);
} finally {
  await browser.close();
  for (const server of servers) await server.close();
}

/** Both sides drew the fold the same: the columns where GPUI's are, and
 *  every cell's text the same. */
function sameOnBoth(gpui: { cells: Cell[]; columns: ColumnBox[] }, tanstack: { cells: Cell[]; columns: ColumnBox[] }): void {
  const moved = gpui.columns.flatMap((column, index) => {
    const other = tanstack.columns[index];
    return other && other.name === column.name && Math.abs(other.x - column.x) <= 0.5 && Math.abs(other.width - column.width) <= 0.5
      ? []
      : [`${column.name}: GPUI x ${column.x} width ${column.width}, TanStack ${other ? `${other.name} x ${other.x} width ${other.width}` : 'none'}`];
  });
  if (gpui.columns.length !== tanstack.columns.length) moved.push(`${gpui.columns.length} columns on GPUI, ${tanstack.columns.length} on TanStack`);
  const text = (cells: Cell[]) => new Map(cells.map((cell) => [`${cell.row}:${cell.column}`, cell.shown]));
  const [a, b] = [text(gpui.cells), text(tanstack.cells)];
  const differ = [...a].filter(([key, shown]) => b.get(key) !== shown).map(([key, shown]) => `${key}: GPUI ${shown}, TanStack ${b.get(key)}`);
  results.same = { columns: gpui.columns.length, moved: moved.length, cells: a.size, differ: differ.length };
  console.log(`\nboth sides: ${gpui.columns.length} columns, ${moved.length} placed differently; ${a.size} cells, ${differ.length} written differently`);
  if (moved.length) fail(`the columns differ: ${moved.slice(0, 4).join('; ')}`);
  if (differ.length || a.size !== b.size) fail(`the cells differ (${a.size} on GPUI, ${b.size} on TanStack): ${differ.slice(0, 4).join('; ')}`);
}

async function runSide(side: Side): Promise<void> {
  const serve = side === 'gpui' ? serveGpui : serveTanstack;
  const fail = (what: string) => failures.push(`${side}: ${what}`);
  const out: Record<string, unknown> = {};
  results[side] = out;
  console.log(`\n${side}:`);
  const market = await serve(PORTS[side].market, undefined, 'market');
  servers.push(market);
  const base = await serve(PORTS[side].base);
  servers.push(base);
  const stop = MARKET_WATCH.stops.at(-1)!;
  const scene = `?scenario=${MARKET_WATCH.id}&stop=${stop.id}`;

  // The fold on screen, and its control.
  const fold: Record<string, unknown> = {};
  for (const [ticks, control] of [
    [fixture.ticks, false],
    [fixture.ticks - 1, true],
  ] as const) {
    for (const theme of ['light', 'dark'] as const) {
      const { context, page, found, end } = await open(browser, market.url, `${scene}&ticks=${ticks}&cells&measure&theme=${theme}`, { theme, viewport: { width: 2560, height: 1700 } });
      try {
        if (end !== 'filled') {
          fail(`fold ${ticks} ${theme}: ${end}, not filled`);
          continue;
        }
        await folded(page, ticks);
        // The last flash fades out, and the frame after it is drawn.
        await page.waitForTimeout(MARKET_WATCH.flash.ms + 300);
        const cells = await page.evaluate(() => (globalThis as Global).__contender?.cells ?? []);
        const wrong = compare(cells, theme);
        if (!control && theme === 'light') drawn[side] = { cells, columns: await page.evaluate(() => (globalThis as Global).__contender?.columns ?? []) };
        fold[`${ticks}-${theme}`] = { cells: cells.length, wrong: wrong.length, first: wrong.slice(0, 5) };
        console.log(`fold of ${ticks} ticks, ${theme}: ${cells.length} cells drawn, ${wrong.length} differ${control ? ' (the control: some must)' : ''}`);
        if (control ? wrong.length === 0 : wrong.length > 0) fail(control ? `the control (${ticks} ticks, ${theme}) matched the fixture` : `fold ${ticks} ${theme}: ${wrong.slice(0, 5).join('; ')}`);
        if (found.length) fail(`fold ${ticks} ${theme}: ${found.join('; ')}`);
      } finally {
        await context.close();
      }
    }
  }
  out.fold = fold;

  // A flash while the feed runs: only Last, Bid, and Ask, at the mix at most.
  {
    const { context, page, end } = await open(browser, market.url, `${scene}&cells&theme=light`, { viewport: { width: 2560, height: 1700 } });
    try {
      if (end !== 'filled') fail(`flash: ${end}`);
      await page.waitForTimeout(1000);
      const cells = await page.evaluate(() => (globalThis as Global).__contender?.cells ?? []);
      const flashing = cells.filter((cell) => cell.flash);
      const columns = new Set(flashing.map((cell) => COLUMNS[cell.column]));
      const flashColumns = new Set<string>(MARKET_WATCH.flash.columns);
      const wrongColumn = [...columns].filter((column) => !flashColumns.has(column!));
      const mix = Math.round(MARKET_WATCH.flash.mix * 255);
      const signs = [sign('light', true), sign('light', false)];
      const off = flashing.filter((cell) => {
        const [r = 0, g = 0, b = 0, a = 0] = cell.flash!;
        return a > mix + 1 || !signs.some((color) => near([r, g, b], color));
      });
      out.flash = { flashing: flashing.length, columns: [...columns], off: off.length };
      console.log(`flash: ${flashing.length} cells flashing, in ${[...columns].join(', ')}; ${off.length} off the rise's or fall's color at the mix`);
      if (flashing.length === 0) fail('flash: nothing flashing under the feed');
      if (wrongColumn.length) fail(`flash: ${wrongColumn.join(', ')} flashing`);
      if (off.length) fail(`flash: ${off.length} cells off color, e.g. ${JSON.stringify(off[0])}`);
    } finally {
      await context.close();
    }
  }

  // Shown in's marks at each stop.
  const marks: Record<string, unknown> = {};
  for (const at of MARKET_WATCH.stops) {
    const { context, page, found, end } = await open(browser, market.url, `?scenario=${MARKET_WATCH.id}&stop=${at.id}&measure`, { init: [presentingTaskRecorder, refreshedLog] });
    try {
      if (end !== 'filled') {
        fail(`marks ${at.id}: ${end}`);
        continue;
      }
      await page.waitForTimeout(3000);
      const { log, batches, origin } = await page.evaluate(() => ({ log: (globalThis as Global).__refreshedLog ?? [], batches: (globalThis as Global).__contender?.batches ?? [], origin: performance.timeOrigin }));
      // Where each side sets the mark. GPUI's right after a presented frame:
      // a sample spread over the window (each check waits). TanStack's in
      // the commit inside the frame's animation frame callback: every mark.
      const sample = side === 'gpui' ? log.filter((_, i) => i % Math.max(1, Math.floor(log.length / 20)) === 0) : log;
      let presented = 0;
      if (side === 'gpui') for (const [time] of sample) if ((await presentedMark(page, time)).ok) presented++;
      if (side === 'tanstack') presented = log.filter(([, , inFrame]) => inFrame).length;
      // Each visible batch's frame: the first mark whose generation reaches
      // its own, after its send and within PAIRED_MS. One folded in the
      // window's last frames may have none yet.
      const visible = batches.filter(([, , , generation, seen]) => seen && generation > 0);
      const lags: number[] = [];
      let unpaired = 0;
      for (const [, , sent, generation] of visible) {
        const sentAt = sent - origin;
        const frame = log.find(([, drawn]) => drawn >= generation);
        if (frame && frame[0] >= sentAt && frame[0] - sentAt <= PAIRED_MS) lags.push(frame[0] - sentAt);
        else unpaired++;
      }
      lags.sort((a, b) => a - b);
      const reached = lags.length;
      const lag = { p50: Number((lags[Math.floor(lags.length / 2)] ?? 0).toFixed(1)), max: Number((lags.at(-1) ?? 0).toFixed(1)) };
      const ticks = batches.reduce((total, [, count]) => total + count, 0);
      marks[at.id] = { refreshed: log.length, sampled: sample.length, presented, batches: batches.length, visible: visible.length, reached, sendToMarkMs: lag, ticks };
      console.log(`marks at ${at.id}: ${log.length} refreshed, ${presented} of ${sample.length} ${side === 'gpui' ? 'sampled right after a presented frame' : 'set in a frame callback'}; ${batches.length} batches (${ticks} ticks), ${reached} of ${visible.length} visible paired with their frame (send → mark p50 ${lag.p50}, max ${lag.max} ms)`);
      if (log.length === 0) fail(`marks ${at.id}: no refreshed mark`);
      // TanStack: a commit of the virtualizer's own (its scroll state reset,
      // ~150 ms after a scroll event, in a task of its own) can draw a
      // landed re-read before the frame's callback does; it's still the
      // commit that draws it, painted by the next frame. At most two a run.
      const strays = sample.length - presented;
      if (side === 'gpui' ? strays > 0 : strays > 2) fail(`marks ${at.id}: ${strays} refreshed marks not ${side === 'gpui' ? 'right after a presented frame' : 'set in a frame callback'}`);
      if (unpaired > 2) fail(`marks ${at.id}: ${unpaired} visible batches with no frame of their own within ${PAIRED_MS} ms`);
      if (found.length) fail(`marks ${at.id}: ${found.join('; ')}`);
    } finally {
      await context.close();
    }
  }
  out.marks = marks;

  // Unmeasured, no refreshed marks: they'd pile up in a long session.
  {
    const { context, page, end } = await open(browser, market.url, scene);
    await page.waitForTimeout(1000);
    const count = await page.evaluate(() => performance.getEntriesByName('contender:refreshed', 'mark').length);
    console.log(`unmeasured: ${end}, ${count} refreshed marks`);
    if (end !== 'filled' || count !== 0) fail(`unmeasured: ${end}, ${count} refreshed marks (want filled, none)`);
    await context.close();
  }

  // The feed's worker failing to load fails the view, once it filled.
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    await context.route('**/assets/worker-*.js', (route) => route.fulfill({ status: 404, body: '' }));
    const page = await context.newPage();
    await page.goto(`${market.url}${scene}`);
    const filled = await waitMark(page, MARKS.filled, 0, 60_000).then(() => true, () => false);
    const failed = await waitMark(page, MARKS.failed, 0, 10_000).then(() => true, () => false);
    console.log(`worker 404: filled ${filled}, failed ${failed}`);
    if (!filled || !failed) fail(`worker 404: filled ${filled}, failed ${failed} (want both)`);
    await context.close();
  }

  // What fails the load.
  const failing: [string, string][] = [
    ['an unknown stop', `${market.url}?scenario=${MARKET_WATCH.id}&stop=nope`],
    ['an unknown scenario', `${market.url}?scenario=nope`],
    ['ticks that aren\'t a count', `${market.url}${scene}&ticks=x`],
    ['market watch on the base build', `${base.url}?scenario=${MARKET_WATCH.id}`],
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
