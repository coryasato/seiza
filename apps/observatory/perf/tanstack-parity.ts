// The TanStack contender's base-level parity with the tall table, item by
// item against the component's README (`components/tall-table/README.md`):
// its keys, Shift+wheel, a track press, the drag settle, the tooltip, and
// the focus ring. On the release build, `?probe` (the paging and the scroll
// model as `__tanstackProbe`, whose calls the script logs).
//
// Checks:
// - Keys (Chromium, Firefox, WebKit; the GPUI contender in Chromium, the
//   same keys): ↓/↑ a row, Page Down/Up and Space/Shift+Space a screen less
//   a row (each side's own screen), Home/End and Cmd+↑/↓ the ends. Control:
//   a whole screen's step is told apart from it.
// - Shift+wheel (all three): a vertical wheel with Shift scrolls sideways
//   by its delta, the rows stay. Control: without Shift it scrolls the rows.
// - A track press (Chromium and WebKit, scrollbars shown): the thumb jumps
//   to the press, centered on it, not a page; a quick press loads nothing
//   until its release, which loads at once (`endDrag`); a held press loads
//   once it has rested the drag settle; moved while held, the thumb
//   follows where the browser lets it (recorded; checked in Firefox, where
//   the page drives it); nothing moves after the release (WebKit pages on
//   after the jump). `--firefox` adds a headed Firefox (classic
//   scrollbars).
// - The drag settle: a thumb drag (Chromium) calls `startDrag` before its
//   first move and loads only once the pointer rests 80 ms, or at the
//   release; a
//   scripted thumb jump with no release (all three) ends the drag 80 ms
//   after its last scroll; a wheel ends it at once.
// - The tooltip (all three): a cut name's whole text (the file's, from
//   native DuckDB) after a 500 ms rest, above the cell or below it when
//   there's no room; none for a plain cell or a NULL; at once on another
//   cell while one shows or within 300 ms of one going, after 500 ms past
//   that; gone on a scroll or a press, and none until the pointer moves; a
//   cell rested on while its page loads gets its tooltip when the page
//   lands. (No float in the file needs more than its 12 characters, so
//   none is rounded; `test/view.test.ts` covers a rounded float's text.)
// - The focus ring (Chromium): focused at open, the frame's border the
//   ring's color on both contenders; a press outside the table keeps the
//   focus (and the keys); blurred, the border's color; a press on a cell or
//   on the track focuses it again.
// - The wide level (all three; the wide sheet at its default stop): the
//   pinned edge's line where the GPUI contender's is (Chromium); a sideways
//   wheel scrolls the scrolled columns by the scroll and holds the pinned
//   ones and the row numbers to the pixel (the run's screenshot the same),
//   the header's names over their columns; a scrolled cell under the run
//   is covered by the pinned one (the hit test there finds it), right of
//   the edge a scrolled one; Shift+wheel scrolls sideways as a horizontal
//   wheel does; a vertical wheel holds the header and its pinned names to
//   the pixel, the pinned cells at their place in the new rows. Control:
//   the screenshot of a region that scrolls differs.
// - The market level (all three; market watch at its default stop, `?cells`,
//   light and dark): under the feed, Change and Change % drawn in the rise's
//   or the fall's color by sign (`scenarios.ts`'s, within one 8-bit step), a
//   zero in neither; cells flashing, only in the scenario's columns, each in
//   the rise's or the fall's color at no more than its mix; and a short
//   feed (`?ticks`) lighting cells whose fade ends, no cell left lit. In the
//   light theme, the tooltip as the table's under `format`: a cell whose
//   fitted text the format rounded (a Change % at 2 decimals) shows its
//   exact text, one it only dressed (a Last at its decimals) shows none.
// - The tail level (all three; live tail at its default stop, `?measure`):
//   following under the clock (`__contenderFollowing`, the tail marks
//   rising, the view's bottom at the tail); a wheel up lets go, and the top
//   holds as the rows grow, with no tail mark; End follows again, the tail
//   marks resuming; with the clock paused (the end recedes at the rate
//   while let go), let go again and a wheel down that reaches the end
//   follows again. Then, the clock paused and the view jumped to the file's
//   first error status (`?cells`), light and dark: the
//   time in the muted foreground (`theme.css`'s), an error status in the
//   scenario's error color (within one 8-bit step), any other status and
//   the request and bytes unpainted.
// - The wall level (all three; the monitoring wall, `?cells`): the grid,
//   at each stop at 1440×900 and a phone's column (390×844, 4 tables),
//   DPR 1, in each browser at its defaults (no scrollbar width), each
//   table's frame and cells where the GPUI contender's are (its wall build,
//   Chromium) and its columns at the same x and width (`wall-grid.ts`'s
//   `gridDiffers`; the control, the tables moved 2 px, differing in every
//   table); then at the default stop, light and dark, under the feed in
//   every table, Chg % drawn in the rise's or the fall's color by sign
//   (within one 8-bit step), a zero in neither; Last alone flashing, in
//   every table, in the rise's or the fall's color at no more than the
//   mix; and a short feed (`?ticks`) lighting cells whose fade ends, no
//   cell left lit in any table.
//
// Usage: node apps/observatory/perf/tanstack-parity.ts [--browsers chromium,firefox,webkit] [--firefox] [--label <name>]
// Needs `just observatory data`; run `just observatory tanstack-build`,
// `tanstack-build wide`, `tanstack-build market`, `tanstack-build tail`,
// `tanstack-build wall`, `gpui-build`, `gpui-build wide`, and
// `gpui-build wall` first.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, firefox, webkit, type Browser, type BrowserType, type Page } from '@playwright/test';
import { flag, localDate, machineInfo, option } from '../../../shared-web/perf/protocol.ts';
import { waitMark } from '../../../shared-web/perf/harness.ts';
import { ROW_HEIGHT } from '../contenders/tall-table/tanstack/web/src/layout.ts';
import { PAGING } from '../contenders/tall-table/tanstack/web/src/data/paging.ts';
import { TOOLTIP_DELAY, TOOLTIP_GRACE } from '../contenders/tall-table/tanstack/web/src/tooltip.ts';
import { LIVE_TAIL, MARKET_WATCH, MONITORING_WALL, WIDE_SHEET, type Oklch } from '../contenders/scenarios.ts';
import { fromOklch } from '../contenders/tall-table/tanstack/web/src/paint.ts';
import { COLUMNS } from '../contenders/market/feed.ts';
import { MARKS, dataFile, dataPath, mutedForeground, nativeDuckDB, perfDir, problems, protocolContext, serveGpui, serveTanstack, tailError } from './harness.ts';
import { DATA_FILE } from '../contenders/tail/data.ts';
import { PHONE, WALL_COLUMNS, controlHolds, flashOff, gridDiffers, signWrong, wallTables, type WallTable } from './wall-grid.ts';

const PORT = 4319;
const GPUI_PORT = 4320;
/** The wide level's builds. */
const WIDE_PORT = 4351;
const GPUI_WIDE_PORT = 4352;
/** The market level's build. */
const MARKET_PORT = 4364;
/** The tail level's build. */
const TAIL_PORT = 4374;
/** The wall level's builds. */
const WALL_PORT = 4391;
const GPUI_WALL_PORT = 4392;
/** The row height (both contenders': `layout.ts` pins it to GPUI's), the
 *  tooltip's delay and grace, and the drag settle, from the contender. */
const ROW = ROW_HEIGHT;
const DELAY = TOOLTIP_DELAY;
const GRACE = TOOLTIP_GRACE;
const DRAG_SETTLE = PAGING.dragSettleMs;
/** DuckDB-Wasm's own `eh` bundle warns in Firefox (the engine's, not the
 *  view's), and Firefox warns of the scroll model's content placed from its
 *  scroll listener, which is its design (`docs/dom-scroll-model.md`). */
const KNOWN_WARNINGS = [/WebAssembly exception handling 'try' instruction is deprecated/, /appears to use a scroll-linked positioning effect/];

const label = option('label');
const browsers = (option('browsers') ?? 'chromium,firefox,webkit').split(',');
const failures: string[] = [];
const output: Record<string, unknown> = { date: localDate(), label, ...machineInfo() };
const check = (ok: boolean, problem: string) => {
  if (!ok) failures.push(problem);
  return ok;
};
const types: Record<string, BrowserType> = { chromium, firefox, webkit };
const near = (a: number, b: number, tolerance: number) => Math.abs(a - b) <= tolerance;

// --- the file, from native DuckDB ---

const conn = await nativeDuckDB();
const file = `'${dataFile.replaceAll("'", "''")}'`;
const rowsOf = async (sql: string) => (await conn.runAndReadAll(sql)).getRows();
const count = Number((await rowsOf(`SELECT count(*) FROM read_parquet(${file})`))[0]![0]);
const names = (await rowsOf(`DESCRIBE SELECT * FROM read_parquet(${file})`)).map((row) => String(row[0]));
const fullName = names.indexOf('full_name');
// A long name, cut in its 200 px column.
const longName = (await rowsOf(`SELECT file_row_number, full_name FROM read_parquet(${file}, file_row_number = true) ORDER BY length(full_name) DESC, file_row_number LIMIT 1`))[0]!;
console.log(`native DuckDB: ${count} rows; a long name at row ${longName[0]} (${String(longName[1]).length} characters)`);

// --- the pages ---

interface Probe {
  paging: { top(): number; rows: number } & Record<string, unknown>;
  model: { viewport: number; s: number; v: number; range: number; total: number; valueFor(s: number): number; jumpTo(v: number): void };
}
type Global = { __tanstackProbe?: Probe; __log?: { call: string; at: number; arg?: unknown }[]; __contender?: { state: { top: number; rows: number } | null } };

const tanstack = await serveTanstack(PORT);
const gpui = await serveGpui(GPUI_PORT);

/** Chromium with its scrollbars shown (Playwright hides them), headless=new. */
const launch = (name: string, headed = false): Promise<Browser> =>
  name === 'chromium'
    ? chromium.launch({ channel: 'chromium', ignoreDefaultArgs: ['--hide-scrollbars'] })
    : name === 'firefox'
      ? firefox.launch({ headless: !headed, firefoxUserPrefs: { 'ui.useOverlayScrollbars': 0 } })
      : types[name]!.launch();

/** The TanStack contender, open, row 0 drawn with data, its calls logged. */
async function openTanstack(browser: Browser) {
  const context = await protocolContext(browser);
  const page = await context.newPage();
  const found = problems(page);
  await page.goto(`${tanstack.url}?probe`);
  await page.waitForFunction(() => document.querySelector('.row[data-row="0"] .cell') && !document.querySelector('.row[data-row="0"] .cell.pending'), null, { timeout: 60_000 });
  await page.evaluate(() => {
    const g = globalThis as Global;
    const paging = g.__tanstackProbe!.paging as unknown as Record<string, (...args: unknown[]) => unknown> & { source: { load(rows: number[]): unknown } };
    const log: NonNullable<Global['__log']> = (g.__log = []);
    for (const name of ['startDrag', 'endDrag', 'moveTopTo']) {
      const call = paging[name]!.bind(paging);
      paging[name] = (...args: unknown[]) => {
        log.push({ call: name, at: performance.now(), arg: args[0] });
        return call(...args);
      };
    }
    const source = paging.source;
    const load = source.load.bind(source);
    source.load = (rows: number[]) => {
      log.push({ call: 'load', at: performance.now(), arg: rows[0] });
      return load(rows);
    };
    const scroller = document.querySelector('.scroller');
    // A press's `arg`: whether the scrollbar took it (its target is the scroller).
    for (const type of ['pointerdown', 'pointerup', 'wheel']) window.addEventListener(type, (event) => log.push({ call: type, at: performance.now(), arg: event.target === scroller }), { capture: true, passive: true });
  });
  const real = () => found.filter((problem) => !KNOWN_WARNINGS.some((warning) => warning.test(problem)));
  return { page, context, problems: real };
}

const top = (page: Page) => page.evaluate(() => (globalThis as Global).__tanstackProbe!.paging.top());
const log = (page: Page, since = 0) => page.evaluate((since) => (globalThis as Global).__log!.filter((entry) => entry.at >= since), since);
const now = (page: Page) => page.evaluate(() => performance.now());
const frames = (page: Page, n = 2) => page.evaluate((n) => new Promise<void>((resolve) => { const step = (k: number) => (k === 0 ? resolve() : requestAnimationFrame(() => step(k - 1))); step(n); }), n);
/** Waits for `read` to settle: the same value two frames apart. */
async function settled(page: Page, read: () => Promise<number>, timeout = 2_000): Promise<number> {
  const until = Date.now() + timeout;
  let last = await read();
  for (;;) {
    await frames(page, 3);
    const next = await read();
    if (next === last || Date.now() > until) return next;
    last = next;
  }
}

// --- keys ---

const KEYS: [string, (vr: number, rows: number) => number][] = [
  ['ArrowDown', () => 1],
  ['ArrowDown', () => 2],
  ['ArrowDown', () => 3],
  ['ArrowUp', () => 2],
  ['PageDown', (vr) => 2 + Math.max(vr - 1, 1)],
  ['PageUp', () => 2],
  ['Space', (vr) => 2 + Math.max(vr - 1, 1)],
  ['Shift+Space', () => 2],
  ['End', (vr, rows) => rows - vr],
  ['Home', () => 0],
  ['Meta+ArrowDown', (vr, rows) => rows - vr],
  ['Meta+ArrowUp', () => 0],
];

/** Presses the keys in turn; `read` gives the top row after each. */
async function pressKeys(page: Page, read: () => Promise<number>, vr: number) {
  const seen: { key: string; top: number; expected: number }[] = [];
  for (const [key, expected] of KEYS) {
    await page.keyboard.press(key);
    seen.push({ key, top: await settled(page, read), expected: expected(vr, count) });
  }
  return seen;
}

const keys: Record<string, unknown> = {};
for (const name of browsers) {
  const browser = await launch(name);
  try {
    const { page, context, problems: found } = await openTanstack(browser);
    const vr = await page.evaluate((row) => (globalThis as Global).__tanstackProbe!.model.viewport / row, ROW);
    const seen = await pressKeys(page, () => top(page), vr);
    for (const step of seen) check(near(step.top, step.expected, 0.02), `${name} keys: ${step.key} → top ${step.top}, expected ${step.expected} (viewport ${vr} rows)`);
    // Control: a whole screen's step (the browser's own, and the
    // contender's before) differs from a screen less a row.
    check(!near(seen[4]!.top, 2 + vr, 0.5), `${name} keys control: Page Down moved a whole screen`);
    keys[name] = { viewportRows: vr, seen };
    console.log(`${name} keys: ${seen.map((step) => `${step.key} ${step.top.toFixed(2)}`).join(', ')} (viewport ${vr.toFixed(2)} rows)`);
    check(found().length === 0, `${name} keys: page problems ${found().join('; ')}`);
    await context.close();
  } finally {
    await browser.close();
  }
}
// The GPUI contender, the same keys: its own viewport (the body less its
// 16 px scrollbar), read from where End puts the top.
{
  const browser = await launch('chromium');
  try {
    const context = await protocolContext(browser);
    const page = await context.newPage();
    await page.goto(`${gpui.url}?measure`);
    await waitMark(page, MARKS.filled, 0);
    const read = () => page.evaluate((row) => (globalThis as Global).__contender!.state!.top / row, ROW);
    await page.keyboard.press('End');
    const vr = count - (await settled(page, read));
    await page.keyboard.press('Home');
    await settled(page, read);
    const seen = await pressKeys(page, read, vr);
    for (const step of seen) check(near(step.top, step.expected, 0.02), `GPUI keys: ${step.key} → top ${step.top}, expected ${step.expected} (viewport ${vr} rows)`);
    keys.gpui = { viewportRows: vr, seen };
    console.log(`GPUI keys: ${seen.map((step) => `${step.key} ${step.top.toFixed(2)}`).join(', ')} (viewport ${vr.toFixed(2)} rows)`);
    await context.close();
  } finally {
    await browser.close();
  }
}
output.keys = keys;

// --- Shift+wheel ---

const shiftWheel: Record<string, unknown> = {};
for (const name of browsers) {
  const browser = await launch(name);
  try {
    const { page, context } = await openTanstack(browser);
    const geometry = () => page.evaluate(() => {
      const scroller = document.querySelector<HTMLElement>('.scroller')!;
      return { left: scroller.scrollLeft, maxLeft: scroller.scrollWidth - scroller.clientWidth, top: (globalThis as Global).__tanstackProbe!.paging.top() };
    });
    await page.evaluate(() => window.addEventListener('wheel', (event) => ((globalThis as { __dy?: number }).__dy = event.deltaY * (event.deltaMode === 1 ? 30 : 1)), { capture: true, passive: true }));
    await page.mouse.move(700, 400);
    await page.keyboard.down('Shift');
    // Held a moment, as a person does: the listener goes on with Shift,
    // and WebKit can't let the page cancel a wheel in that same frame.
    await page.waitForTimeout(100);
    await page.mouse.wheel(0, 40);
    await page.keyboard.up('Shift');
    await frames(page, 4);
    const shifted = await geometry();
    const dy = await page.evaluate(() => (globalThis as { __dy?: number }).__dy ?? 0);
    check(shifted.maxLeft > 0 && near(shifted.left, Math.min(dy, shifted.maxLeft), 1), `${name} Shift+wheel: scrollLeft ${shifted.left}, the wheel's ${dy} (room ${shifted.maxLeft})`);
    check(shifted.top === 0, `${name} Shift+wheel: the rows moved to ${shifted.top}`);
    // Control: the same wheel without Shift scrolls the rows.
    await page.evaluate(() => (document.querySelector('.scroller')!.scrollLeft = 0));
    await page.mouse.wheel(0, 40);
    await frames(page, 4);
    const plain = await geometry();
    check(plain.left === 0 && plain.top > 0, `${name} Shift+wheel control: without Shift scrollLeft ${plain.left}, top ${plain.top}`);
    shiftWheel[name] = { deltaY: dy, shifted, plain };
    console.log(`${name} Shift+wheel: sideways ${shifted.left} px (delta ${dy}, room ${shifted.maxLeft.toFixed(1)}), rows still; without Shift top ${plain.top.toFixed(2)}`);
    await context.close();
  } finally {
    await browser.close();
  }
}
output.shiftWheel = shiftWheel;

// --- the track press and the drag settle ---

/** The scrollbar's strip and the thumb as the model estimates it. */
const bar = (page: Page) =>
  page.evaluate(() => {
    const scroller = document.querySelector<HTMLElement>('.scroller')!;
    const rect = scroller.getBoundingClientRect();
    const model = (globalThis as Global).__tanstackProbe!.model;
    const track = scroller.clientHeight;
    const length = Math.min(track, Math.max(24, (track * track) / (model.range + track)));
    return {
      x: rect.right - (scroller.offsetWidth - scroller.clientWidth || 12) / 2,
      top: rect.top + scroller.clientTop,
      track,
      length,
      thumbCenter: rect.top + scroller.clientTop + ((track - length) * scroller.scrollTop) / model.range + length / 2,
      s: scroller.scrollTop,
      v: model.v,
      range: model.range,
      total: model.total,
      consistent: Math.abs(model.v - model.valueFor(scroller.scrollTop)) < 1,
    };
  });

/** Brings the scrollbar up where it's an overlay (macOS's, which takes a
 *  press only while shown): a wheel there and back, the pointer over it. */
async function showBar(page: Page, x: number, y: number): Promise<void> {
  await page.mouse.move(x - 40, y);
  await page.mouse.wheel(0, 30);
  await page.waitForTimeout(50);
  await page.mouse.wheel(0, -30);
  await page.mouse.move(x, y);
  await page.waitForTimeout(300);
}

/** Waits until no read is out and none started for 300 ms: a page landing
 *  sends the reads its prefetch wants, drag or not, as the table's does. */
async function quiet(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const g = globalThis as unknown as { __tanstackProbe: { paging: { cache: { requests(): unknown[] } } }; __log: { call: string; at: number }[] };
      const last = g.__log.filter((entry) => entry.call === 'load').at(-1)?.at ?? 0;
      return g.__tanstackProbe.paging.cache.requests().length === 0 && performance.now() - last > 300;
    },
    null,
    { timeout: 30_000, polling: 50 },
  );
}

/** Presses at (x, y) once the scrollbar has taken the press (an overlay
 *  one can fade out before it lands: then up, and again); returns the page
 *  clock just before the press that counted. */
async function downOnBar(page: Page, x: number, y: number): Promise<number> {
  for (let attempt = 0; attempt < 3; attempt++) {
    await showBar(page, x, y);
    const since = await now(page);
    await page.mouse.down();
    const press = (await log(page, since)).find((entry) => entry.call === 'pointerdown');
    if (press?.arg === true) return since;
    await page.mouse.up();
    await page.waitForTimeout(400);
  }
  throw new Error(`the scrollbar took no press at (${x}, ${y}) in 3 tries`);
}

const calls = (entries: { call: string; at: number }[], call: string) => entries.filter((entry) => entry.call === call);

async function trackPress(name: string, browser: Browser) {
  const { page, context, problems: found } = await openTanstack(browser);
  const result: Record<string, unknown> = {};
  // A quick press at 30% of the track: shorter than the drag settle.
  {
    await quiet(page);
    const before = await bar(page);
    const y = before.top + before.track * 0.3;
    const since = await downOnBar(page, before.x, y);
    await page.waitForTimeout(30);
    await page.mouse.up();
    await page.waitForTimeout(600);
    const after = await bar(page);
    const entries = await log(page, since);
    const down = calls(entries, 'pointerdown')[0];
    const up = calls(entries, 'pointerup')[0];
    const start = calls(entries, 'startDrag');
    const end = calls(entries, 'endDrag');
    const loads = calls(entries, 'load');
    check(down !== undefined && up !== undefined, `${name} track press: pointerdown ${down?.at}, pointerup ${up?.at} (is the scrollbar shown?)`);
    check(near(after.thumbCenter, y, 3), `${name} track press: the thumb's center at ${after.thumbCenter.toFixed(1)}, the press at ${y.toFixed(1)}`);
    check(after.v > 1000 * before.track, `${name} track press: the content at ${after.v} px, a page's move or none`);
    check(after.consistent, `${name} track press: V ${after.v} isn't valueFor(s ${after.s})`);
    check(start.length === 1 && end.length === 1, `${name} track press: startDrag ×${start.length}, endDrag ×${end.length}`);
    check(down !== undefined && start[0] !== undefined && start[0].at - down.at < 5, `${name} track press: startDrag ${start[0]?.at}, not in the press's task (${down?.at})`);
    // The model hears the release before this script's listener does.
    check(loads.length > 0 && up !== undefined && loads.every((load) => load.at >= up.at - 2), `${name} track press: loads at ${loads.map((load) => load.at.toFixed(1))} before the release at ${up?.at}`);
    check(end[0] !== undefined && loads[0] !== undefined && loads[0].at - end[0].at < 2 && up !== undefined && Math.abs(end[0].at - up.at) < 5, `${name} track press: the release at ${up?.at}, endDrag at ${end[0]?.at}, the first load at ${loads[0]?.at}`);
    result.quick = { pressAt: y, fractionOfTrack: 0.3, after, startAfterDown: start[0] && down ? start[0].at - down.at : null, endAfterUp: end[0] && up ? end[0].at - up.at : null, loads: loads.length, rowsFraction: after.v / after.total };
    console.log(`${name} track press at 30%: thumb ${after.thumbCenter.toFixed(1)} for the press at ${y.toFixed(1)}, rows at ${((after.v / after.total) * 100).toFixed(2)}%; loads at the release (+${end[0] && up ? (end[0].at - up.at).toFixed(1) : '?'} ms)`);
  }
  // A held press at 70%: it loads once it rests the drag settle, and
  // nothing moves after (WebKit pages on after the jump).
  {
    await quiet(page);
    const before = await bar(page);
    const y = before.top + before.track * 0.7;
    const since = await downOnBar(page, before.x, y);
    await page.waitForTimeout(300);
    const held = await bar(page);
    // Still held, the pointer moves on: the table drags the thumb it
    // jumped. Here the browser's scrollbar decides: Firefox lets the page
    // drag it (checked); Chromium grabs it with classic scrollbars, not with
    // macOS's overlay ones, and WebKit doesn't, sending the page no moves
    // either (recorded): the content stays at the jump.
    await page.mouse.move(before.x, y + 40, { steps: 4 });
    await page.waitForTimeout(150);
    const dragged = await bar(page);
    await page.mouse.up();
    await page.waitForTimeout(600);
    const after = await bar(page);
    const entries = await log(page, since);
    const start = calls(entries, 'startDrag')[0];
    const loads = calls(entries, 'load');
    const settle = loads[0] && start ? loads[0].at - start.at : null;
    const grabbed = near(dragged.thumbCenter, y + 40, 3);
    check(near(held.thumbCenter, y, 3), `${name} held press: the thumb's center at ${held.thumbCenter.toFixed(1)}, the press at ${y.toFixed(1)}`);
    check(settle !== null && settle >= DRAG_SETTLE - 2 && settle < DRAG_SETTLE + 40, `${name} held press: the first load ${settle} ms after the jump, not the drag settle`);
    if (name.startsWith('firefox')) check(grabbed, `${name} held press: the thumb at ${dragged.thumbCenter.toFixed(1)} after the pointer moved to ${(y + 40).toFixed(1)}`);
    check(after.v === dragged.v, `${name} held press: the content moved after the release, ${dragged.v} → ${after.v}`);
    result.held = { pressAt: y, held, dragged, grabbed, after, settleMs: settle, rowsFraction: after.v / after.total };
    console.log(`${name} held press at 70%: thumb ${held.thumbCenter.toFixed(1)} for ${y.toFixed(1)}, loads ${settle?.toFixed(1)} ms after the jump; the pointer moved 40 px: thumb ${grabbed ? 'followed' : `stayed (${dragged.thumbCenter.toFixed(1)})`}; still after the release`);
  }
  check(found().length === 0, `${name} track press: page problems ${found().join('; ')}`);
  await context.close();
  return result;
}

const press: Record<string, unknown> = {};
const settle: Record<string, unknown> = {};
for (const name of browsers.filter((name) => name !== 'firefox')) {
  const browser = await launch(name);
  try {
    press[name] = await trackPress(name, browser);
  } finally {
    await browser.close();
  }
}
if (flag('firefox')) {
  const browser = await launch('firefox', true);
  try {
    press.firefoxHeaded = await trackPress('firefox (headed)', browser);
  } finally {
    await browser.close();
  }
}
output.trackPress = press;

// A thumb drag (Chromium): a quick burst of moves, a rest, another burst,
// the release. Reads wait for a rest of the drag settle, or the release.
{
  const browser = await launch('chromium');
  try {
    const { page, context } = await openTanstack(browser);
    await quiet(page);
    const before = await bar(page);
    const since = await downOnBar(page, before.x, before.thumbCenter);
    await page.mouse.move(before.x, before.thumbCenter + 100, { steps: 5 });
    const rest = await now(page);
    await page.waitForTimeout(250);
    const resumed = await now(page);
    await page.mouse.move(before.x, before.thumbCenter + 200, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(400);
    const entries = await log(page, since);
    const up = calls(entries, 'pointerup')[0]!;
    const moves = calls(entries, 'moveTopTo');
    const loads = calls(entries, 'load');
    const after = await bar(page);
    // Each load comes a drag settle after the move before it, or at the
    // release (or after a page landed, which only follows such a load).
    const early = loads.filter((load) => {
      const move = moves.filter((entry) => entry.at <= load.at).at(-1);
      const released = load.at >= up.at - 2;
      return move !== undefined && load.at - move.at < DRAG_SETTLE - 2 && !released && load.at < rest;
    });
    const firstBurst = loads.filter((load) => load.at < rest);
    const atRest = loads.filter((load) => load.at >= rest && load.at < resumed);
    const secondBurst = loads.filter((load) => load.at >= resumed && load.at < up.at - 2);
    const atRelease = loads.filter((load) => load.at >= up.at - 2 && load.at < up.at + 5);
    const restLoad = atRest[0] ? atRest[0].at - (moves.filter((move) => move.at < atRest[0]!.at).at(-1)?.at ?? 0) : null;
    check(calls(entries, 'startDrag')[0] !== undefined && calls(entries, 'startDrag')[0]!.at <= (moves[0]?.at ?? 0), 'drag: startDrag not before the first move');
    check(firstBurst.length === 0 && secondBurst.length === 0 && early.length === 0, `drag: loads while moving: ${[...firstBurst, ...secondBurst].map((load) => load.at.toFixed(1))}`);
    check(atRest.length > 0 && restLoad !== null && restLoad >= DRAG_SETTLE - 2 && restLoad < DRAG_SETTLE + 40, `drag: the rest's load ${restLoad} ms after its last move`);
    check(atRelease.length > 0, `drag: nothing loaded at the release (${up.at.toFixed(1)}): ${loads.map((load) => load.at.toFixed(1))}`);
    check(after.v > 0 && after.consistent, `drag: V ${after.v}, s ${after.s}`);
    settle.drag = { moves: moves.length, loadsAtRest: atRest.length, restLoadAfterMove: restLoad, loadsAtRelease: atRelease.length, startDrag: calls(entries, 'startDrag').length, endDrag: calls(entries, 'endDrag').length, rowsFraction: after.v / after.total };
    console.log(`drag (Chromium): ${moves.length} moves in two bursts; nothing loaded while moving, the rest's load ${restLoad?.toFixed(1)} ms after its last move, the release's at once`);
    await context.close();
  } finally {
    await browser.close();
  }
}

// A scripted thumb jump with no release (all three): the drag settles
// 80 ms after its scroll; a wheel ends a drag at once.
for (const name of browsers) {
  const browser = await launch(name);
  try {
    const { page, context } = await openTanstack(browser);
    await quiet(page);
    let since = await now(page);
    await page.evaluate(() => {
      const scroller = document.querySelector<HTMLElement>('.scroller')!;
      scroller.scrollTop = scroller.scrollHeight / 2;
    });
    await page.waitForTimeout(400);
    let entries = await log(page, since);
    const start = calls(entries, 'startDrag');
    const end = calls(entries, 'endDrag');
    const loads = calls(entries, 'load');
    const settleMs = start[0] && end[0] ? end[0].at - start[0].at : null;
    check(start.length === 1 && end.length === 1, `${name} scripted thumb: startDrag ×${start.length}, endDrag ×${end.length}`);
    check(settleMs !== null && settleMs >= DRAG_SETTLE - 2 && settleMs < DRAG_SETTLE + 40, `${name} scripted thumb: endDrag ${settleMs} ms after startDrag`);
    check(loads.length > 0 && end[0] !== undefined && loads[0]!.at >= end[0].at, `${name} scripted thumb: loads before the drag ended`);
    // A wheel or a key during a drag ends it at once (none comes from a held
    // thumb). Each counts only if it arrived inside the drag: WebKit's
    // scripted wheel can take the whole settle to arrive.
    const ends: Record<string, number | null> = {};
    for (const [input, send] of [
      ['wheel', () => page.mouse.wheel(0, 40)],
      ['keydown', () => page.keyboard.press('ArrowDown')],
    ] as const) {
      await page.mouse.move(700, 400);
      await quiet(page);
      since = await now(page);
      await page.evaluate((input) => {
        window.addEventListener(input, () => (globalThis as Global).__log!.push({ call: input, at: performance.now() }), { capture: true, passive: true, once: true });
        const scroller = document.querySelector<HTMLElement>('.scroller')!;
        scroller.scrollTop = scroller.scrollTop > scroller.scrollHeight / 3 ? scroller.scrollHeight / 4 : scroller.scrollHeight / 2;
      }, input);
      await page.waitForFunction((since) => (globalThis as Global).__log!.some((entry) => entry.call === 'startDrag' && entry.at >= since), since, { polling: 'raf' });
      await send();
      await page.waitForTimeout(400);
      entries = await log(page, since);
      const started = calls(entries, 'startDrag')[0]!;
      const arrived = calls(entries, input)[0];
      const ended = calls(entries, 'endDrag')[0];
      if (arrived === undefined || arrived.at - started.at > DRAG_SETTLE - 5) {
        ends[input] = null;
        continue;
      }
      ends[input] = ended ? ended.at - arrived.at : null;
      check(ended !== undefined && ended.at >= arrived.at - 1 && ended.at - arrived.at < 5, `${name} ${input} in a drag: endDrag at ${ended?.at}, the ${input} at ${arrived.at}`);
    }
    check(Object.values(ends).some((end) => end !== null), `${name}: no wheel or key arrived inside a drag`);
    settle[name] = { settleMs, endAfterInput: ends };
    console.log(`${name} scripted thumb: endDrag ${settleMs?.toFixed(1)} ms after startDrag, loads from then; an input ends a drag at once (${Object.entries(ends).map(([input, end]) => `${input} ${end === null ? 'arrived after the settle' : `+${end.toFixed(1)} ms`}`).join(', ')})`);
    await context.close();
  } finally {
    await browser.close();
  }
}
output.dragSettle = settle;

// --- the tooltip ---

/** The page side of the tooltip's timing: when it last showed and hid, and
 *  when the pointer last moved. */
function tooltipWatch() {
  const g = globalThis as { __tip?: { shown: number; hidden: number; moved: number } };
  const tip = (g.__tip = { shown: 0, hidden: 0, moved: 0 });
  window.addEventListener('pointermove', () => (tip.moved = performance.now()), { capture: true, passive: true });
  const element = document.querySelector('.tooltip')!;
  new MutationObserver(() => {
    if ((element as HTMLElement).hidden) tip.hidden = performance.now();
    else tip.shown = performance.now();
  }).observe(element, { attributes: true, attributeFilter: ['hidden'] });
}
type Tip = { visible: boolean; text: string; box: DOMRect | null; shown: number; hidden: number; moved: number };
const tip = (page: Page): Promise<Tip> =>
  page.evaluate(() => {
    const element = document.querySelector<HTMLElement>('.tooltip')!;
    const g = (globalThis as unknown as { __tip: { shown: number; hidden: number; moved: number } }).__tip;
    return { visible: !element.hidden, text: element.textContent ?? '', box: element.hidden ? null : (element.getBoundingClientRect().toJSON() as DOMRect), ...g };
  });
const cellBox = (page: Page, row: number, column: number) =>
  page.evaluate(([row, column]) => {
    const cell = document.querySelector(`.row[data-row="${row}"]`)?.children[column + 1];
    return cell ? (cell.getBoundingClientRect().toJSON() as DOMRect) : null;
  }, [row, column] as const);
const moveTo = async (page: Page, box: DOMRect, dx = 0) => page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2);
/** Waits for the tooltip to be `visible` (or not), `timeout` ms at most. */
async function tipState(page: Page, visible: boolean, timeout: number): Promise<Tip> {
  await page.waitForFunction((visible) => !document.querySelector<HTMLElement>('.tooltip')!.hidden === visible, visible, { timeout, polling: 'raf' }).catch(() => {});
  return tip(page);
}
/** Puts `row` at the top of the view and waits for it to load. */
async function showRow(page: Page, row: number): Promise<void> {
  await page.evaluate((v) => (globalThis as Global).__tanstackProbe!.model.jumpTo(v), row * ROW);
  await page.waitForFunction((row) => { const cell = document.querySelector(`.row[data-row="${row}"] .cell`); return cell && !cell.classList.contains('pending'); }, row, { timeout: 30_000 });
}

// A screen of rows with three names long enough to be cut (this file's
// floats all fit their 12 characters, so none is rounded: the cell
// tests cover a rounded float's tooltip text) and a NULL.
const LONG = 30;
const window_ = Number((await rowsOf(`WITH t AS (SELECT file_row_number AS r, (length(full_name) >= ${LONG})::INT AS long, (diameter IS NULL)::INT AS missing FROM read_parquet(${file}, file_row_number = true)) SELECT r FROM (SELECT r, sum(long) OVER (ORDER BY r ROWS BETWEEN CURRENT ROW AND 20 FOLLOWING) AS longs, sum(missing) OVER (ORDER BY r ROWS BETWEEN CURRENT ROW AND 20 FOLLOWING) AS missings FROM t) WHERE longs >= 3 AND missings >= 1 ORDER BY r LIMIT 1`))[0]![0]);
const screen = await rowsOf(`SELECT file_row_number, full_name, diameter IS NULL FROM read_parquet(${file}, file_row_number = true) WHERE file_row_number BETWEEN ${window_} AND ${window_ + 20} ORDER BY file_row_number`);
const longs = screen.filter((row) => String(row[1]).length >= LONG).map((row) => ({ row: Number(row[0]), name: String(row[1]) }));
const nullRow = Number(screen.find((row) => row[2] === true)![0]);
const diameter = names.indexOf('diameter');
const farLong = (await rowsOf(`SELECT file_row_number, full_name FROM read_parquet(${file}, file_row_number = true) WHERE file_row_number >= 50000 AND length(full_name) >= ${LONG} ORDER BY file_row_number LIMIT 1`))[0]!;
console.log(`tooltip rows: long names at ${longs.map((long) => long.row).join(', ')}, a NULL diameter at ${nullRow}; a loading row's long name at ${farLong[0]}`);

const tooltip: Record<string, unknown> = {};
for (const name of browsers) {
  const browser = await launch(name);
  try {
    const { page, context, problems: found } = await openTanstack(browser);
    await page.evaluate(tooltipWatch);
    const r: Record<string, unknown> = {};
    const [a, b, c] = longs as [(typeof longs)[number], (typeof longs)[number], (typeof longs)[number]];
    // Three rows above the first, so there's room above every one.
    await showRow(page, window_ - 3);
    await page.waitForFunction((row) => !document.querySelector(`.row[data-row="${row}"] .cell.pending`), window_ + 20, { timeout: 30_000 });

    // a. A rested pointer: the whole name after 500 ms, above the cell.
    const boxA = (await cellBox(page, a.row, fullName))!;
    await moveTo(page, boxA);
    const early = await tipState(page, true, DELAY - 100);
    check(!early.visible, `${name} tooltip: showing ${early.shown - early.moved} ms after the rest began`);
    const shownA = await tipState(page, true, 2_000);
    const delay = shownA.shown - shownA.moved;
    check(shownA.visible && delay >= DELAY - 1 && delay < DELAY + 60, `${name} tooltip: shown ${delay} ms after the pointer rested`);
    check(shownA.text === a.name, `${name} tooltip: '${shownA.text}', the file's '${a.name}'`);
    const box = shownA.box ?? { x: 0, y: 0, width: 0, height: 0, top: 0, bottom: 0 };
    check(near(box.bottom, boxA.top - 12, 1) && near(box.x + box.width / 2, boxA.x + boxA.width / 2, 1), `${name} tooltip: box ${JSON.stringify(box)} for the cell ${JSON.stringify(boxA)}`);
    r.rested = { delay, text: shownA.text, gap: boxA.top - box.bottom, centerOffset: box.x + box.width / 2 - (boxA.x + boxA.width / 2), box };

    // b. Another cut cell while one shows: at once.
    await moveTo(page, (await cellBox(page, b.row, fullName))!);
    const shownB = await tipState(page, true, 1_000);
    const switchMs = shownB.shown - shownB.moved;
    check(shownB.text === b.name && switchMs < 50, `${name} tooltip: the next cell's '${shownB.text}' (the file's '${b.name}') ${switchMs} ms after the move`);
    // c. A plain cell (the spkid): none, and the one showing goes; within
    // the grace, a cut cell shows at once.
    const [plainBox, boxC] = [(await cellBox(page, b.row, 0))!, (await cellBox(page, c.row, fullName))!];
    await moveTo(page, plainBox);
    const onPlain = await tipState(page, false, 500);
    check(!onPlain.visible, `${name} tooltip: showing over a plain cell`);
    await page.waitForTimeout(100);
    await moveTo(page, boxC);
    const inGrace = await tipState(page, true, 1_000);
    const graceMs = inGrace.shown - inGrace.moved;
    const sinceHidden = inGrace.moved - onPlain.hidden;
    check(sinceHidden < GRACE, `${name} tooltip: the script took ${sinceHidden} ms to move on, past the grace`);
    check(inGrace.visible && inGrace.text === c.name && graceMs < 50, `${name} tooltip: ${graceMs} ms within the grace, ${sinceHidden} ms after one went ('${inGrace.text}')`);
    // d. Off the cells past the grace: the next waits the delay again.
    await page.mouse.move(40, 400);
    await page.waitForTimeout(GRACE + 100);
    await moveTo(page, boxA);
    const cold = await tipState(page, true, 2_000);
    const coldMs = cold.shown - cold.moved;
    check(coldMs >= DELAY - 1, `${name} tooltip: ${coldMs} ms past the grace, not the delay`);
    // e. A NULL: none.
    await moveTo(page, (await cellBox(page, nullRow, diameter))!);
    await page.waitForTimeout(DELAY + 200);
    check(!(await tip(page)).visible, `${name} tooltip: showing over a NULL`);
    // f. A press hides it.
    await moveTo(page, boxA);
    await tipState(page, true, 2_000);
    await page.mouse.down();
    await page.mouse.up();
    check(!(await tipState(page, false, 200)).visible, `${name} tooltip: still showing after a press`);
    // g. A scroll hides it; none until the pointer moves.
    await moveTo(page, boxA, 2);
    await tipState(page, true, 2_000);
    await page.mouse.wheel(0, 30);
    const scrolled = await tipState(page, false, 500);
    await page.waitForTimeout(DELAY + 200);
    check(!scrolled.visible && !(await tip(page)).visible, `${name} tooltip: showing after a scroll with the pointer still`);
    // h. In the first visible row, no room above: below the cell.
    await page.mouse.move(40, 400);
    await showRow(page, a.row);
    await page.waitForTimeout(GRACE + 50);
    const boxTop = (await cellBox(page, a.row, fullName))!;
    await moveTo(page, boxTop);
    const below = await tipState(page, true, 2_000);
    check(below.visible && near(below.box?.y ?? 0, boxTop.bottom + 12, 1), `${name} tooltip: the top row's box at ${below.box?.y}, the cell's bottom ${boxTop.bottom}`);
    r.below = { gap: below.box ? below.box.y - boxTop.bottom : null };
    // i. Rested while its page loads: shown once it lands.
    const far = Number(farLong[0]);
    await page.mouse.move(40, 400);
    await page.waitForTimeout(GRACE + 50);
    await page.evaluate((v) => (globalThis as Global).__tanstackProbe!.model.jumpTo(v), (far - 5) * ROW);
    await frames(page, 2);
    const pending = await page.evaluate((row) => !!document.querySelector(`.row[data-row="${row}"] .cell.pending`), far);
    await moveTo(page, (await cellBox(page, far, fullName))!);
    const landed = await tipState(page, true, 10_000);
    check(landed.visible && landed.text === String(farLong[1]), `${name} tooltip: rested on a loading row: '${landed.text}', the file's '${farLong[1]}'`);
    r.whileLoading = { pendingAtRest: pending, shownAfterMove: landed.shown - landed.moved };
    r.timings = { switchMs, graceMs, graceAfterHideMs: sinceHidden, coldMs };
    tooltip[name] = r;
    console.log(`${name} tooltip: ${delay.toFixed(1)} ms rest, the whole name, above (${(r.rested as { gap: number }).gap.toFixed(1)} px gap) or below; at once within the grace (${graceMs.toFixed(1)} ms); none on a plain cell or a NULL; gone on a press or a scroll; a loading row's once it lands (pending: ${pending})`);
    check(found().length === 0, `${name} tooltip: page problems ${found().join('; ')}`);
    await context.close();
  } finally {
    await browser.close();
  }
}
output.tooltip = tooltip;

// --- the focus ring ---

/** The frame's left border, as drawn: a screenshot's pixel. */
async function borderPixel(page: Page): Promise<number[]> {
  const png = await page.screenshot({ clip: { x: 16, y: 450, width: 1, height: 1 } });
  return page.evaluate(async (b64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${b64}`;
    await image.decode();
    const canvas = new OffscreenCanvas(image.width, image.height);
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);
    return [...context.getImageData(0, 0, 1, 1).data.slice(0, 3)];
  }, png.toString('base64'));
}
{
  const browser = await launch('chromium');
  try {
    const { page, context } = await openTanstack(browser);
    const colors = await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement);
      return { ring: style.getPropertyValue('--ring').trim(), border: style.getPropertyValue('--border').trim() };
    });
    const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const isColor = (pixel: number[], hex: string) => pixel.every((value, i) => Math.abs(value - rgb(hex)[i]!) <= 2);
    const focused = () => page.evaluate(() => document.activeElement === document.querySelector('.scroller'));
    const open = { focused: await focused(), border: await borderPixel(page) };
    check(open.focused && isColor(open.border, colors.ring), `focus: at open focused ${open.focused}, border ${open.border} (ring ${colors.ring})`);
    // A press outside the table, in the page's padding.
    await page.mouse.click(8, 450);
    const before = await top(page);
    await page.keyboard.press('ArrowDown');
    const outside = { focused: await focused(), border: await borderPixel(page), moved: (await settled(page, () => top(page))) - before };
    check(outside.focused && isColor(outside.border, colors.ring) && near(outside.moved, 1, 0.02), `focus: after a press outside focused ${outside.focused}, border ${outside.border}, ↓ moved ${outside.moved}`);
    // Blurred, then a cell, then the track.
    await page.evaluate(() => (document.activeElement as HTMLElement).blur());
    const blurred = { focused: await focused(), border: await borderPixel(page) };
    check(!blurred.focused && isColor(blurred.border, colors.border), `focus: blurred, border ${blurred.border} (border ${colors.border})`);
    await page.mouse.click(700, 400);
    const cell = { focused: await focused(), border: await borderPixel(page) };
    check(cell.focused && isColor(cell.border, colors.ring), `focus: after a press on a cell focused ${cell.focused}, border ${cell.border}`);
    await page.evaluate(() => (document.activeElement as HTMLElement).blur());
    const geometry = await bar(page);
    await page.mouse.click(geometry.x, geometry.top + geometry.track * 0.5);
    const track = { focused: await focused() };
    check(track.focused, 'focus: a press on the track left it unfocused');
    // The GPUI contender's at open.
    const gpuiContext = await protocolContext(browser);
    const gpuiPage = await gpuiContext.newPage();
    await gpuiPage.goto(`${gpui.url}?measure`);
    await waitMark(gpuiPage, MARKS.filled, 0);
    await frames(gpuiPage, 2);
    const gpuiBorder = await borderPixel(gpuiPage);
    check(isColor(gpuiBorder, colors.ring), `focus: the GPUI contender's border ${gpuiBorder} at open (ring ${colors.ring})`);
    output.focus = { colors, open, outside, blurred, cell, track, gpuiBorder };
    console.log(`focus: ring ${colors.ring} at open on both contenders; kept on a press outside (↓ still moves); ${colors.border} blurred; back on a press on a cell or the track`);
    await gpuiContext.close();
    await context.close();
  } finally {
    await browser.close();
  }
}

// --- the wide level: the sideways scroll and the pinned edge ---

{
  // Started inside the `try`, so a failure anywhere in the block closes them.
  let wideTanstack: Awaited<ReturnType<typeof serveTanstack>> | null = null;
  let wideGpui: Awaited<ReturnType<typeof serveGpui>> | null = null;
  try {
    wideTanstack = await serveTanstack(WIDE_PORT, undefined, 'wide');
    wideGpui = await serveGpui(GPUI_WIDE_PORT, undefined, 'wide');
    const query = `?scenario=${WIDE_SHEET.id}&stop=${WIDE_SHEET.defaultStop}`;
    const wide: Record<string, unknown> = {};

    /** The GPUI contender's run edge on screen: its layout probe's (`?cells`). */
    let gpuiEdge: number | null = null;
    {
      const browser = await chromium.launch({ channel: 'chromium' });
      try {
        const context = await protocolContext(browser);
        const page = await context.newPage();
        await page.goto(`${wideGpui.url}${query}&cells`);
        await waitMark(page, MARKS.filled, 0, 60_000);
        const layout = (await (
          await page.waitForFunction(() => (globalThis as { __contender?: { layout?: unknown } }).__contender?.layout ?? false, null, { timeout: 10_000 })
        ).jsonValue()) as { left: number; pinned: number; columns: { x: number; width: number }[] };
        const last = layout.columns[layout.pinned - 1]!;
        // Its edge line's left: a pixel inside the run's right.
        gpuiEdge = layout.left + last.x + last.width - 1;
        await context.close();
      } finally {
        await browser.close();
      }
    }

    for (const name of browsers) {
      const browser = await launch(name);
      try {
        const context = await protocolContext(browser);
        const page = await context.newPage();
        const found = problems(page);
        await page.goto(`${wideTanstack.url}${query}`);
        await page.waitForFunction(() => document.querySelector('.row[data-row="0"] > .cell[data-column="3"]') && !document.querySelector('.row[data-row="0"] > .cell.pending'), null, { timeout: 60_000 });
        await frames(page, 2);
        /** What a sideways or vertical scroll must hold, and what it moves. */
        const geometry = () =>
          page.evaluate(() => {
            const scroller = document.querySelector<HTMLElement>('.scroller')!;
            const box = (element: Element | null) => {
              const rect = element?.getBoundingClientRect();
              return rect ? { left: rect.left, top: rect.top, right: rect.right } : null;
            };
            const head = document.querySelector('.head')!;
            const rows = [...document.querySelectorAll<HTMLElement>('.content > .row')].filter((row) => {
              const rect = row.getBoundingClientRect();
              return rect.top >= head.getBoundingClientRect().bottom - 0.5;
            });
            rows.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
            const top = rows[0]!;
            const edge = document.querySelector('.frame > .edge');
            // A scrolled header name over its column: the header cell and the
            // top row's cell of the first scrolled column drawn past the edge.
            const edgeX = edge ? edge.getBoundingClientRect().right : 0;
            const headCells = [...head.querySelectorAll<HTMLElement>(':scope > .cell:not(.pin)')];
            const firstScrolled = headCells.find((cell) => cell.getBoundingClientRect().left >= edgeX - 0.5);
            const column = firstScrolled ? headCells.indexOf(firstScrolled) : -1;
            const rowCell = column >= 0 ? [...top.querySelectorAll(':scope > .cell:not(.pin)')][column] : null;
            return {
              scrollLeft: scroller.scrollLeft,
              headTop: head.getBoundingClientRect().top,
              headPins: [...head.querySelectorAll('.pin')].map(box),
              topRow: Number(top.dataset.row),
              rowPins: [...top.querySelectorAll('.pin')].map(box),
              rowNumber: box(top.querySelector('.num')),
              edge: box(edge),
              scrolledName: firstScrolled ? { text: firstScrolled.textContent, left: firstScrolled.getBoundingClientRect().left, below: box(rowCell ?? null)?.left ?? null } : null,
              // A day in view before and after the sideways wheel.
              jan5: box([...head.querySelectorAll('.cell:not(.pin)')].find((cell) => cell.textContent === 'Jan 5') ?? null),
            };
          });
        /** A screenshot of the run: the frame's left (row numbers and pinned
         *  columns, header and body) up to its edge line. */
        const runShot = async (right?: number) => {
          const { edge, headTop } = await geometry();
          const x = 17;
          const width = (right ?? edge!.left) - x;
          return (await page.screenshot({ clip: { x, y: headTop, width, height: 600 } })).toString('base64');
        };
        const before = await geometry();
        // Without the run drawn, the rest of the block has nothing to hold: it's one failure, not a crash.
        if (!check(before.edge !== null && before.headPins.length === WIDE_SHEET.pinned && before.rowPins.length === WIDE_SHEET.pinned, `${name} wide: ${before.headPins.length} pinned names, ${before.rowPins.length} pinned cells, edge ${JSON.stringify(before.edge)}`)) continue;
        if (name === 'chromium' && gpuiEdge !== null && before.edge) check(near(before.edge.left, gpuiEdge, 0.5), `${name} wide: the edge line at ${before.edge.left}, the GPUI contender's at ${gpuiEdge}`);
        const runBefore = await runShot();

        // A sideways wheel, over the scrolled cells.
        await page.mouse.move(1000, 500);
        await page.mouse.wheel(300, 0);
        await page.waitForFunction(() => document.querySelector<HTMLElement>('.scroller')!.scrollLeft > 0, null, { timeout: 5_000 }).catch(() => {});
        await frames(page, 6);
        const sideways = await geometry();
        check(sideways.scrollLeft > 0, `${name} wide: a sideways wheel didn't scroll (scrollLeft ${sideways.scrollLeft})`);
        check(JSON.stringify(sideways.headPins) === JSON.stringify(before.headPins) && JSON.stringify(sideways.rowPins) === JSON.stringify(before.rowPins), `${name} wide: the pinned cells moved sideways: ${JSON.stringify(before.rowPins)} → ${JSON.stringify(sideways.rowPins)}`);
        check(JSON.stringify(sideways.rowNumber) === JSON.stringify(before.rowNumber) && JSON.stringify(sideways.edge) === JSON.stringify(before.edge), `${name} wide: the row numbers or the edge moved sideways`);
        check(sideways.topRow === before.topRow, `${name} wide: a sideways wheel moved the rows (${before.topRow} → ${sideways.topRow})`);
        check(sideways.jan5 !== null && before.jan5 !== null && near(sideways.jan5.left, before.jan5.left - sideways.scrollLeft, 0.5), `${name} wide: Jan 5 at ${sideways.jan5?.left}, not ${before.jan5?.left} − ${sideways.scrollLeft}`);
        check(sideways.scrolledName !== null && sideways.scrolledName.below !== null && near(sideways.scrolledName.left, sideways.scrolledName.below, 0.5), `${name} wide: the header's ${sideways.scrolledName?.text} at ${sideways.scrolledName?.left}, its column at ${sideways.scrolledName?.below}`);
        const runAfter = await runShot();
        check(runAfter === runBefore, `${name} wide: the run's pixels changed under a sideways scroll`);
        // Control: a region past the edge, which scrolls, differs.
        const scrolledShot = async () => (await page.screenshot({ clip: { x: before.edge!.left + 2, y: before.headTop, width: 300, height: 600 } })).toString('base64');
        const scrolledAfter = await scrolledShot();
        // Under the run and right of it: what the hit test finds.
        const hits = await page.evaluate(
          ({ y, pinX, scrolledX }) => {
            const at = (x: number) => {
              const cell = document.elementFromPoint(x, y)?.closest<HTMLElement>('.cell');
              return cell ? { pinned: cell.classList.contains('pin'), column: Number(cell.dataset.column) } : null;
            };
            return { under: at(pinX), right: at(scrolledX) };
          },
          { y: before.rowPins[0]!.top + 5, pinX: before.edge!.left - 10, scrolledX: before.edge!.left + 10 },
        );
        check(hits.under?.pinned === true && hits.under.column === WIDE_SHEET.pinned - 1, `${name} wide: left of the edge the hit test found ${JSON.stringify(hits.under)}, not the last pinned cell`);
        check(hits.right?.pinned === false && hits.right.column >= WIDE_SHEET.pinned, `${name} wide: right of the edge the hit test found ${JSON.stringify(hits.right)}, not a scrolled cell`);

        // Shift+wheel: sideways too, as the base's.
        await page.keyboard.down('Shift');
        await page.waitForTimeout(100);
        await page.mouse.wheel(0, 40);
        await page.keyboard.up('Shift');
        await frames(page, 6);
        const shifted = await geometry();
        check(shifted.scrollLeft > sideways.scrollLeft && shifted.topRow === sideways.topRow, `${name} wide: Shift+wheel scrollLeft ${sideways.scrollLeft} → ${shifted.scrollLeft}, top row ${sideways.topRow} → ${shifted.topRow}`);
        check((await runShot()) === runBefore, `${name} wide: the run's pixels changed under Shift+wheel`);
        check((await scrolledShot()) !== scrolledAfter, `${name} wide control: the scrolled region's pixels didn't change under Shift+wheel`);

        // A vertical wheel: the header and its pinned names held, new rows.
        // From past the frame's rounded corner, whose antialiased edge blends
        // the scrolled layer under its clip (8 px of it differed).
        const headShot = async () => (await page.screenshot({ clip: { x: 24, y: before.headTop, width: before.edge!.left - 24, height: WIDE_SHEET.stops.find((stop) => stop.id === WIDE_SHEET.defaultStop)!.rowHeight } })).toString('base64');
        const headBefore = await headShot();
        await page.mouse.wheel(0, 600);
        await frames(page, 6);
        await page.waitForFunction(() => !document.querySelector('.content > .row > .cell.pending'), null, { timeout: 10_000 }).catch(() => {});
        const down = await geometry();
        check(down.topRow > shifted.topRow, `${name} wide: a vertical wheel left the top row at ${down.topRow}`);
        check(down.headTop === before.headTop && JSON.stringify(down.headPins) === JSON.stringify(before.headPins), `${name} wide: the header moved under a vertical scroll: top ${before.headTop} → ${down.headTop}, pinned ${JSON.stringify(before.headPins)} → ${JSON.stringify(down.headPins)}`);
        const headAfter = await headShot();
        if (!check(headAfter === headBefore, `${name} wide: the header's run changed pixels under a vertical scroll`)) {
          mkdirSync(join(perfDir, 'results', 'raw'), { recursive: true });
          writeFileSync(join(perfDir, 'results', 'raw', `parity-wide-head-${name}.txt`), `${headBefore}\n${headAfter}\n`);
        }
        check(down.rowPins.every((pin, index) => near(pin!.left, before.rowPins[index]!.left, 0.01)), `${name} wide: the new top row's pinned cells at ${JSON.stringify(down.rowPins)}`);
        const real = found.filter((problem) => !KNOWN_WARNINGS.some((warning) => warning.test(problem)));
        for (const problem of real) check(false, `${name} wide: ${problem}`);
        wide[name] = { before, sideways, shifted, down, hits };
        console.log(`${name} wide: edge at ${before.edge?.left}${name === 'chromium' ? ` (GPUI ${gpuiEdge})` : ''}; sideways ${sideways.scrollLeft} px and Shift+wheel to ${shifted.scrollLeft}, the run's pixels held; a vertical wheel to row ${down.topRow}, the header held`);
        await context.close();
      } finally {
        await browser.close();
      }
    }
    output.wide = wide;
  } finally {
    await wideTanstack?.close();
    await wideGpui?.close();
  }
}

// --- the market level: the sign colors and the flash ---

{
  let market: Awaited<ReturnType<typeof serveTanstack>> | null = null;
  try {
    market = await serveTanstack(MARKET_PORT, undefined, 'market');
    const query = `?scenario=${MARKET_WATCH.id}&stop=${MARKET_WATCH.defaultStop}&cells`;
    const columns: readonly string[] = COLUMNS;
    const signed = new Set(['Change', 'Change %']);
    const flashColumns = new Set<string>(MARKET_WATCH.flash.columns);
    const mix = Math.round(MARKET_WATCH.flash.mix * 255);
    const rgb8 = (lch: Oklch) => {
      const color = fromOklch(...lch);
      return [color.r, color.g, color.b].map((channel) => Math.round(channel * 255));
    };
    const close = (a: readonly number[], b: readonly number[], steps: number) => a.every((channel, i) => Math.abs(channel - b[i]!) <= steps);
    type Cell = { row: number; column: number; exact: string; text: number[] | null; flash: number[] | null };
    const cellsOf = (page: Page) => page.evaluate(() => ((globalThis as { __contender?: { cells?: Cell[] } }).__contender?.cells ?? []) as Cell[]);
    const marketOut: Record<string, unknown> = {};
    for (const name of browsers) {
      const browser = await launch(name);
      try {
        for (const theme of ['light', 'dark'] as const) {
          const [up, down] = [rgb8(MARKET_WATCH.signs[theme].up), rgb8(MARKET_WATCH.signs[theme].down)];
          const at = `${name} market ${theme}`;
          const context = await protocolContext(browser, { dpr: name === 'chromium' ? 2 : 1 });
          const page = await context.newPage();
          await page.emulateMedia({ colorScheme: theme });
          const found = problems(page);
          await page.goto(`${market.url}${query}&theme=${theme}`);
          await waitMark(page, MARKS.filled, 0, 60_000);
          await page.waitForTimeout(1000);
          const cells = await cellsOf(page);
          // The sign colors.
          let rises = 0;
          let falls = 0;
          const wrongSign: string[] = [];
          for (const cell of cells.filter((cell) => signed.has(columns[cell.column]!))) {
            const value = Number(cell.exact);
            const color = cell.text?.slice(0, 3) ?? [];
            if (value > 0) rises++;
            if (value < 0) falls++;
            if (value !== 0 && !close(color, value > 0 ? up : down, 1)) wrongSign.push(`row ${cell.row} ${columns[cell.column]} ${cell.exact}: ${color}`);
            if (value === 0 && (close(color, up, 8) || close(color, down, 8))) wrongSign.push(`row ${cell.row} ${columns[cell.column]} 0: a sign's color ${color}`);
          }
          check(rises > 0 && falls > 0, `${at}: ${rises} rises and ${falls} falls under the feed, want both`);
          check(wrongSign.length === 0, `${at}: sign colors off: ${wrongSign.slice(0, 4).join('; ')}`);
          // The flash.
          const flashing = cells.filter((cell) => cell.flash);
          const wrongColumn = [...new Set(flashing.map((cell) => columns[cell.column]!))].filter((column) => !flashColumns.has(column));
          const offColor = flashing.filter((cell) => {
            const [r = 0, g = 0, b = 0, a = 0] = cell.flash!;
            return a > mix + 1 || !(close([r, g, b], up, 1) || close([r, g, b], down, 1));
          });
          check(flashing.length > 0, `${at}: nothing flashing under the feed`);
          check(wrongColumn.length === 0, `${at}: ${wrongColumn.join(', ')} flashing`);
          check(offColor.length === 0, `${at}: ${offColor.length} flashes off the rise's or the fall's color at the mix, e.g. ${JSON.stringify(offColor[0])}`);
          await context.close();
          // The fade ends: a short feed, then no cell lit.
          const short = await protocolContext(browser, { dpr: name === 'chromium' ? 2 : 1 });
          const quiet = await short.newPage();
          await quiet.emulateMedia({ colorScheme: theme });
          await quiet.goto(`${market.url}${query}&theme=${theme}&ticks=200`);
          await waitMark(quiet, MARKS.filled, 0, 60_000);
          await quiet.waitForTimeout(300);
          const lit = (await cellsOf(quiet)).filter((cell) => cell.flash).length;
          const ended = await quiet
            .waitForFunction(() => !((globalThis as { __contender?: { cells?: { flash: unknown }[] } }).__contender?.cells ?? []).some((cell) => cell.flash), null, { timeout: 5_000, polling: 100 })
            .then(() => true, () => false);
          check(lit > 0, `${at}: no cell lit by a 200-tick feed, so its fade proves nothing`);
          check(ended, `${at}: a flash still lit 5 s after a 200-tick feed`);
          // The tooltip under the format, once the short feed is still.
          let tooltips: Record<string, unknown> | null = null;
          if (theme === 'light') {
            await quiet.evaluate(tooltipWatch);
            const still = (await cellsOf(quiet)) as (Cell & { shown: string })[];
            const number = (text: string) => Number(text.replace(/[+,%]/g, ''));
            const rounded = still.find((cell) => columns[cell.column] === 'Change %' && cell.row < 20 && number(cell.shown) !== Number(cell.exact));
            const dressed = still.find((cell) => columns[cell.column] === 'Last' && cell.row < 20 && number(cell.shown) === Number(cell.exact) && cell.shown !== cell.exact);
            if (check(!!rounded && !!dressed, `${at}: no rounded Change % or dressed Last on screen to hover`)) {
              const away = (await cellBox(quiet, 0, 0))!;
              const hover = async (cell: Cell) => {
                await moveTo(quiet, away);
                await tipState(quiet, false, 1_000);
                await quiet.waitForTimeout(GRACE + 100);
                await moveTo(quiet, (await cellBox(quiet, cell.row, cell.column))!);
                return tipState(quiet, true, DELAY + 400);
              };
              const shownRounded = await hover(rounded!);
              const shownDressed = await hover(dressed!);
              check(shownRounded.visible && shownRounded.text === rounded!.exact, `${at}: the rounded ${rounded!.shown}'s tooltip ${shownRounded.visible ? `'${shownRounded.text}'` : 'not shown'}, want '${rounded!.exact}'`);
              check(!shownDressed.visible, `${at}: the dressed ${dressed!.shown} showed a tooltip '${shownDressed.text}'`);
              tooltips = { rounded: [rounded!.shown, shownRounded.visible ? shownRounded.text : null], dressed: [dressed!.shown, shownDressed.visible ? shownDressed.text : null] };
            }
          }
          await short.close();
          const real = found.filter((problem) => !KNOWN_WARNINGS.some((warning) => warning.test(problem)));
          for (const problem of real) check(false, `${at}: ${problem}`);
          marketOut[`${name}-${theme}`] = { cells: cells.length, rises, falls, flashing: flashing.length, wrongSign: wrongSign.length, offColor: offColor.length, litAfterShortFeed: lit, ended, tooltips };
          console.log(`${at}: ${cells.length} cells; ${rises} rises, ${falls} falls in their colors${wrongSign.length ? ` (${wrongSign.length} off)` : ''}; ${flashing.length} flashing, in ${[...new Set(flashing.map((cell) => columns[cell.column]))].join(', ')}${offColor.length ? `, ${offColor.length} off color` : ''}; a short feed's ${lit} lit cells ${ended ? 'faded' : 'still lit'}${tooltips ? `; tooltips ${JSON.stringify(tooltips)}` : ''}`);
        }
      } finally {
        await browser.close();
      }
    }
    output.market = marketOut;
  } finally {
    await market?.close();
  }
}

// --- the tail level: following, letting go, coming back; the time and an error's color ---

{
  let tail: Awaited<ReturnType<typeof serveTanstack>> | null = null;
  try {
    tail = await serveTanstack(TAIL_PORT, undefined, 'tail');
    const query = `?scenario=${LIVE_TAIL.id}&stop=${LIVE_TAIL.defaultStop}&measure&cells`;
    type TailGlobal = {
      __contender?: { state: { top: number; rows: number; first: number; end: number } | null; pause?: (on: boolean) => void; replay: { jump(fraction: number): Promise<void> }; cells?: { row: number; column: number; exact: string; text: number[] | null }[] };
      __contenderFollowing?: boolean;
      __contenderTail?: number;
    };
    const muted = mutedForeground();
    const close = (a: readonly number[], b: readonly number[], steps: number) => a.length >= 3 && b.every((channel, i) => Math.abs(channel - a[i]!) <= steps);
    const read = (page: Page) =>
      page.evaluate(() => {
        const g = globalThis as TailGlobal;
        return { following: g.__contenderFollowing, tail: g.__contenderTail ?? 0, marks: performance.getEntriesByName('contender:tail', 'mark').length, state: g.__contender?.state ?? null };
      });
    const firstError = Number((await rowsOf(`SELECT min(file_row_number) FROM read_parquet('${dataPath(DATA_FILE)}', file_row_number = true) WHERE status >= 400`))[0]![0]);
    const tailOut: Record<string, unknown> = {};
    for (const name of browsers) {
      const browser = await launch(name);
      try {
        for (const theme of ['light', 'dark'] as const) {
          const at = `${name} tail ${theme}`;
          const context = await protocolContext(browser, { dpr: name === 'chromium' ? 2 : 1 });
          const page = await context.newPage();
          await page.emulateMedia({ colorScheme: theme });
          const found = problems(page);
          await page.goto(`${tail.url}${query}&theme=${theme}`);
          await waitMark(page, MARKS.filled, 0, 60_000);
          await page.waitForFunction(() => ((globalThis as TailGlobal).__contenderTail ?? 0) > 2000, null, { timeout: 30_000, polling: 50 });
          let follow: Record<string, unknown> | null = null;
          if (theme === 'light') {
            // Following under the clock.
            const fed = await read(page);
            check(fed.following === true && fed.state !== null && fed.state.end >= fed.tail - 1, `${at}: under the clock following ${fed.following}, the view ${fed.state?.first}–${fed.state?.end}, the tail ${fed.tail}`);
            // A wheel up lets go; the top holds as the rows grow.
            await page.mouse.move(720, 450);
            await page.mouse.wheel(0, -300);
            const letGo = await page.waitForFunction(() => (globalThis as TailGlobal).__contenderFollowing === false, null, { timeout: 5_000 }).then(() => true, () => false);
            await page.waitForTimeout(300);
            const held = await read(page);
            await page.waitForTimeout(1000);
            const after = await read(page);
            check(letGo && held.state?.top === after.state?.top && (after.state?.rows ?? 0) > (held.state?.rows ?? 0) && after.marks === held.marks, `${at}: a wheel up: following ${!letGo}, top ${held.state?.top} → ${after.state?.top}, rows ${held.state?.rows} → ${after.state?.rows}, ${after.marks - held.marks} tail marks while let go`);
            // Let go again, then End follows again, under the clock.
            await page.waitForTimeout(500);
            const before = await read(page);
            await page.keyboard.press('End');
            const ended = await page.waitForFunction(() => (globalThis as TailGlobal).__contenderFollowing === true, null, { timeout: 5_000 }).then(() => true, () => false);
            await page.waitForTimeout(1000);
            const afterEnd = await read(page);
            check(before.following === false && ended && afterEnd.marks > before.marks, `${at}: End: let go ${before.following === false}, following ${ended}, ${afterEnd.marks - before.marks} tail marks after it`);
            // A wheel down that reaches the end follows again: the clock
            // paused, since the end recedes at the rate while let go.
            await page.evaluate(() => (globalThis as TailGlobal).__contender?.pause?.(true));
            await page.waitForTimeout(300);
            await page.mouse.wheel(0, -300);
            await page.waitForFunction(() => (globalThis as TailGlobal).__contenderFollowing === false, null, { timeout: 5_000 }).catch(() => {});
            await page.waitForTimeout(500);
            const away = await read(page);
            for (let i = 0; i < 3; i++) await page.mouse.wheel(0, 400);
            const wheeledBack = await page.waitForFunction(() => (globalThis as TailGlobal).__contenderFollowing === true, null, { timeout: 5_000 }).then(() => true, () => false);
            check(away.following === false && wheeledBack, `${at}: a wheel down to the end (the clock paused): let go ${away.following === false}, following ${wheeledBack}`);
            follow = { fed: fed.following, letGo, heldTop: held.state?.top === after.state?.top, rowsGrew: (after.state?.rows ?? 0) - (held.state?.rows ?? 0), wheeledBack, endFollowed: ended };
          }
          // The colors: the clock paused, the view at the file's first
          // error status (from native DuckDB), the rows due by then past it.
          await page.evaluate(() => (globalThis as TailGlobal).__contender?.pause?.(true));
          await page.waitForTimeout(300);
          const rows = (await read(page)).state?.rows ?? 0;
          await page.evaluate((fraction) => (globalThis as TailGlobal).__contender!.replay.jump(fraction), (firstError + 0.5) / rows);
          await page.waitForTimeout(300);
          const cells = await page.evaluate(() => (globalThis as TailGlobal).__contender?.cells ?? []);
          const wrong: string[] = [];
          let errors = 0;
          for (const cell of cells) {
            const color = cell.text?.slice(0, 3) ?? null;
            const where = `row ${cell.row} column ${cell.column} ${cell.exact}`;
            if (cell.column === 0 && !(color && close(color, muted[theme], 1))) wrong.push(`${where}: ${color}, not muted`);
            if (cell.column === 2 && Number(cell.exact) >= 400) {
              errors++;
              if (!(color && close(color, tailError(theme), 1))) wrong.push(`${where}: ${color}, not the error color`);
            } else if (cell.column !== 0 && color !== null) wrong.push(`${where}: painted ${color}`);
          }
          check(cells.length > 100 && errors > 0, `${at}: ${cells.length} cells at the first rows, ${errors} error statuses`);
          check(wrong.length === 0, `${at}: ${wrong.slice(0, 4).join('; ')}`);
          const real = found.filter((problem) => !KNOWN_WARNINGS.some((warning) => warning.test(problem)));
          for (const problem of real) check(false, `${at}: ${problem}`);
          tailOut[`${name}-${theme}`] = { follow, cells: cells.length, errors, wrong: wrong.length };
          console.log(`${at}: ${follow ? `following ${follow.fed}, a wheel up let go ${follow.letGo} (top held ${follow.heldTop} as ${follow.rowsGrew} rows came), a wheel to the end followed ${follow.wheeledBack}, End followed ${follow.endFollowed}; ` : ''}${cells.length} cells, the time muted, ${errors} error statuses in the error color${wrong.length ? `; ${wrong.length} off` : ''}`);
          await context.close();
        }
      } finally {
        await browser.close();
      }
    }
    output.tail = tailOut;
  } finally {
    await tail?.close();
  }
}

// --- the wall level: the grid, the sign colors, and the flash, in every table ---

{
  let wallTanstack: Awaited<ReturnType<typeof serveTanstack>> | null = null;
  let wallGpui: Awaited<ReturnType<typeof serveGpui>> | null = null;
  try {
    wallTanstack = await serveTanstack(WALL_PORT, undefined, 'wall');
    wallGpui = await serveGpui(GPUI_WALL_PORT, undefined, 'wall');
    const at = (stop: string) => `?scenario=${MONITORING_WALL.id}&stop=${stop}&cells`;
    const grids = [...MONITORING_WALL.stops.map((stop) => ({ key: stop.id, stop: stop.id, viewport: { width: 1440, height: 900 } })), { key: 'phone', stop: '4', viewport: PHONE }];
    /** The tables at a grid, light, DPR 1. Read in a browser at its
     *  defaults, the GPUI reference's too: headless, none of them gives a
     *  scrollbar width (this script's `launch` shows classic scrollbars,
     *  which would narrow a phone's column on the DOM side alone). */
    const tablesAt = async (browser: Browser, url: string, grid: (typeof grids)[number]) => {
      const context = await browser.newContext({ viewport: grid.viewport, deviceScaleFactor: 1 });
      try {
        const page = await context.newPage();
        const found = problems(page);
        await page.goto(`${url}${at(grid.stop)}&theme=light`);
        await waitMark(page, MARKS.filled, 0, 60_000);
        await page.waitForTimeout(300);
        return { tables: (await wallTables(page)).map(({ columns, layout, box }) => ({ columns, layout, box })), found };
      } finally {
        await context.close();
      }
    };
    const plain = (name: string): Promise<Browser> => (name === 'chromium' ? chromium.launch({ channel: 'chromium' }) : types[name]!.launch());
    // GPUI's grids, the reference (Chromium).
    const reference: Record<string, WallTable[]> = {};
    {
      const browser = await plain('chromium');
      try {
        for (const grid of grids) {
          const { tables, found } = await tablesAt(browser, wallGpui.url, grid);
          reference[grid.key] = tables;
          for (const problem of found) check(false, `GPUI wall grid ${grid.key}: ${problem}`);
        }
      } finally {
        await browser.close();
      }
    }
    const wallOut: Record<string, unknown> = {};
    for (const name of browsers) {
      // The grid at each stop and on a phone, with its control.
      const gridOut: Record<string, { differ: number; controlTablesDiffer: number }> = {};
      {
        const browser = await plain(name);
        try {
          for (const grid of grids) {
            const { tables, found } = await tablesAt(browser, wallTanstack.url, grid);
            const wrong = gridDiffers(reference[grid.key]!, tables);
            const control = controlHolds(reference[grid.key]!, tables);
            gridOut[grid.key] = { differ: wrong.length, controlTablesDiffer: control.differ };
            check(wrong.length === 0, `${name} wall grid ${grid.key}: ${wrong.slice(0, 4).join('; ')}`);
            check(control.holds, `${name} wall grid ${grid.key}: the control (moved 2 px) differs in ${control.differ} of ${tables.length} tables`);
            for (const problem of found.filter((problem) => !KNOWN_WARNINGS.some((warning) => warning.test(problem)))) check(false, `${name} wall grid ${grid.key}: ${problem}`);
          }
        } finally {
          await browser.close();
        }
      }
      console.log(`${name} wall grid: ${Object.entries(gridOut).map(([key, { differ, controlTablesDiffer }]) => `${key} ${differ ? `${differ} off` : 'as GPUI'} (control: ${controlTablesDiffer} tables differ)`).join(', ')}`);
      wallOut[`${name}-grid`] = gridOut;
      const browser = await launch(name);
      try {
        for (const theme of ['light', 'dark'] as const) {
          const where = `${name} wall ${theme}`;
          const context = await protocolContext(browser, { dpr: name === 'chromium' ? 2 : 1 });
          const page = await context.newPage();
          await page.emulateMedia({ colorScheme: theme });
          const found = problems(page);
          await page.goto(`${wallTanstack.url}${at(MONITORING_WALL.defaultStop)}&theme=${theme}`);
          await waitMark(page, MARKS.filled, 0, 60_000);
          await page.waitForTimeout(1000);
          const tables = await wallTables(page);
          // The sign colors, every table.
          let rises = 0;
          let falls = 0;
          const wrongSign: string[] = [];
          const cells = tables.flatMap(({ cells = [] }, table) => cells.map((cell) => ({ ...cell, table })));
          for (const cell of cells.filter((cell) => WALL_COLUMNS[cell.column] === 'Chg %')) {
            const value = Number(cell.exact);
            if (value > 0) rises++;
            if (value < 0) falls++;
            const wrong = signWrong(theme, cell.exact, cell.text);
            if (wrong) wrongSign.push(`table ${cell.table} row ${cell.row}: ${wrong}`);
          }
          check(rises > 0 && falls > 0, `${where}: ${rises} rises and ${falls} falls under the feed, want both`);
          check(wrongSign.length === 0, `${where}: sign colors off: ${wrongSign.slice(0, 4).join('; ')}`);
          // The flash: Last alone, every table, at the mix.
          const flashing = cells.filter((cell) => cell.flash);
          const flashingTables = new Set(flashing.map((cell) => cell.table)).size;
          const wrongColumn = [...new Set(flashing.map((cell) => WALL_COLUMNS[cell.column]!))].filter((column) => column !== 'Last');
          const offColor = flashing.filter((cell) => flashOff(theme, cell.flash!));
          check(flashingTables === tables.length && tables.length > 0, `${where}: ${flashingTables} of ${tables.length} tables flashing under the feed`);
          check(wrongColumn.length === 0, `${where}: ${wrongColumn.join(', ')} flashing`);
          check(offColor.length === 0, `${where}: ${offColor.length} flashes off the rise's or the fall's color at the mix, e.g. ${JSON.stringify(offColor[0])}`);
          await context.close();
          // The fade ends: a short feed lights cells, then none is lit in any table.
          const short = await protocolContext(browser, { dpr: name === 'chromium' ? 2 : 1 });
          const quiet = await short.newPage();
          await quiet.emulateMedia({ colorScheme: theme });
          await quiet.goto(`${wallTanstack.url}${at(MONITORING_WALL.defaultStop)}&theme=${theme}&ticks=200`);
          await waitMark(quiet, MARKS.filled, 0, 60_000);
          await quiet.waitForTimeout(300);
          const lit = (await wallTables(quiet)).flatMap(({ cells = [] }) => cells).filter((cell) => cell.flash).length;
          const ended = await quiet
            .waitForFunction(() => !((globalThis as { __contender?: { tables?: { cells?: { flash: unknown }[] }[] } }).__contender?.tables ?? []).some(({ cells = [] }) => cells.some((cell) => cell.flash)), null, { timeout: 5_000, polling: 100 })
            .then(() => true, () => false);
          check(lit > 0, `${where}: no cell lit by a 200-tick feed, so its fade proves nothing`);
          check(ended, `${where}: a flash still lit 5 s after a 200-tick feed`);
          await short.close();
          const real = found.filter((problem) => !KNOWN_WARNINGS.some((warning) => warning.test(problem)));
          for (const problem of real) check(false, `${where}: ${problem}`);
          wallOut[`${name}-${theme}`] = { tables: tables.length, cells: cells.length, rises, falls, flashing: flashing.length, flashingTables, wrongSign: wrongSign.length, offColor: offColor.length, litAfterShortFeed: lit, ended };
          console.log(`${where}: ${tables.length} tables, ${cells.length} cells; ${rises} rises, ${falls} falls in their colors${wrongSign.length ? ` (${wrongSign.length} off)` : ''}; ${flashing.length} flashing in ${flashingTables} tables, in ${[...new Set(flashing.map((cell) => WALL_COLUMNS[cell.column]))].join(', ')}${offColor.length ? `, ${offColor.length} off color` : ''}; a short feed's ${lit} lit cells ${ended ? 'faded' : 'still lit'}`);
        }
      } finally {
        await browser.close();
      }
    }
    output.wall = wallOut;
  } finally {
    await wallTanstack?.close();
    await wallGpui?.close();
  }
}

await tanstack.close();
await gpui.close();

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
