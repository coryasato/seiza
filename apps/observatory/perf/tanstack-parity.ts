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
//
// Usage: node apps/observatory/perf/tanstack-parity.ts [--browsers chromium,firefox,webkit] [--firefox] [--label <name>]
// Needs `just observatory data`; run `just observatory tanstack-build` and
// `gpui-build` first.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, firefox, webkit, type Browser, type BrowserType, type Page } from '@playwright/test';
import { flag, machineInfo, option } from '../../../shared-web/perf/protocol.ts';
import { waitMark } from '../../../shared-web/perf/harness.ts';
import { ROW_HEIGHT } from '../contenders/tall-table/tanstack/web/src/layout.ts';
import { PAGING } from '../contenders/tall-table/tanstack/web/src/data/paging.ts';
import { TOOLTIP_DELAY, TOOLTIP_GRACE } from '../contenders/tall-table/tanstack/web/src/tooltip.ts';
import { MARKS, dataFile, nativeDuckDB, perfDir, problems, protocolContext, serveGpui, serveTanstack } from './harness.ts';

const PORT = 4319;
const GPUI_PORT = 4320;
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
const output: Record<string, unknown> = { date: new Date().toISOString().slice(0, 10), label, ...machineInfo() };
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
