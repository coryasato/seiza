// M7 part C checks: jump to row, the app's first text input, on the release
// build.
//
// Per run (a new browser, Chromium headless=new, 1440×900 at DPR 2, the
// observation panel open, engine warm), for each sample:
// 1. The jump input and its refusal line sit clear of the open panel (their
//    published bounds against `__seizaPerfOverlayRect`): a press on the panel
//    never reaches what's under it.
// 2. First, middle, last: click the input, type the row, Enter. The table's
//    top is that row (the last row: the table's end, with the row in view),
//    the row is highlighted (`marked`), every visible row loads, and focus
//    moved to the table. Enter → `tycho:viewport-filled` is recorded.
// 3. Out of range (0, rows + 1) and not a number: an inline refusal, the
//    table doesn't move, focus stays in the input.
// 4. Keys typed in the input don't reach the table: arrows, Page Up/Down,
//    Space, Home, End leave its top where it was.
// Once per sample (reference), the input's edges:
// 5. IME: a composition committing full-width digits ("１２３", as a Japanese
//    IME does) through CDP's Input.imeSetComposition + Input.insertText
//    lands on row 123.
// 6. Paste: Ctrl/Cmd+V from the clipboard, and the context menu's Paste
//    (gpui-kit draws it on the canvas; its async clipboard read needs the
//    clipboard-read permission, granted here, then denied).
// 7. Focus after a failed open: a Parquet file that fails to open replaces
//    the table with the empty state; focus goes back to the workbench (not
//    nowhere), so its Cmd/Ctrl+G binding keeps firing.
// --browsers adds Firefox and WebKit: first, middle, last, out of range.
//
// Usage: node apps/tycho/perf/jump.ts [--runs 10] [--label m7-jump] [--reference-only] [--samples asteroids,gaia] [--browsers]
// Writes perf/results/<date>-<label>.json. Run `just tycho build` first.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, firefox, webkit, type BrowserType, type Page } from '@playwright/test';
import { preview } from 'vite';
import { assertPortFree, startWorkerDev, WORKER_DEV_PORT } from '../worker/scripts/dev.ts';
import { PROFILES, flag, machineInfo, option, summarize, type Profile } from './common.ts';
import { clickTarget, dropFile, open, startCountingProxy, targetRect, waitMark, waitOverlay, type TableProbe } from './harness.ts';

const perfDir = dirname(fileURLToPath(import.meta.url));
const webDir = join(perfDir, '../web');
const manifest = JSON.parse(readFileSync(join(perfDir, '../data/MANIFEST.json'), 'utf8')) as Record<string, { rows: number }>;
const SAMPLES = {
  asteroids: { name: 'asteroids.parquet', target: 'try-sample-asteroids' },
  gaia: { name: 'gaia-dr3-bright.parquet', target: 'try-sample-gaia' },
};
type SampleName = keyof typeof SAMPLES;
const samples = (option('samples') ?? 'asteroids,gaia').split(',') as SampleName[];
for (const name of samples) if (!(name in SAMPLES)) throw new Error(`--samples ${name}: ${Object.keys(SAMPLES).join(' or ')}`);
const runs = Number(option('runs') ?? 10);
const label = option('label') ?? 'm7-jump';

interface WorkbenchProbe {
  state: string;
  rows: number | null;
  jumpText: string;
  jumpRefusal: string | null;
  focused: string | null;
}
type Global = { __tychoTable?: TableProbe; __tychoWorkbench?: WorkbenchProbe; __seizaPerfOverlayRect?: number[] };
type Rect = [number, number, number, number];

const now = (page: Page) => page.evaluate(() => performance.now());
const table = (page: Page) => page.evaluate(() => (globalThis as Global).__tychoTable ?? null);
const workbench = (page: Page) => page.evaluate(() => (globalThis as Global).__tychoWorkbench ?? null);
const frames = (page: Page, count = 2) =>
  page.evaluate((count) => new Promise<void>((resolve) => {
    const step = (left: number) => (left === 0 ? resolve() : requestAnimationFrame(() => step(left - 1)));
    step(count);
  }), count);

/** Whether two `[x, y, w, h]` rects overlap. */
const overlaps = (a: Rect, b: Rect) => a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];

async function panelRect(page: Page): Promise<Rect | null> {
  return page.evaluate(() => ((globalThis as Global).__seizaPerfOverlayRect as Rect | undefined) ?? null);
}

/** The bounds of `id`, and whether the open panel covers any of it. */
async function clearOfPanel(page: Page, id: string): Promise<{ rect: Rect; panel: Rect | null; clear: boolean }> {
  const rect = await targetRect(page, id, 5_000);
  const panel = await panelRect(page);
  return { rect, panel, clear: !panel || !overlaps(rect, panel) };
}

/** Selects whatever is in the input and types over it, then Enter. Returns
 *  the page time just before Enter. */
async function typeAndEnter(page: Page, text: string, how: 'click' | 'shortcut'): Promise<number> {
  if (how === 'click') {
    await clickTarget(page, 'jump-input', 5_000);
    await frames(page);
    // gpui-kit binds select-all to Ctrl+A in the web build, on every OS
    // (its Cmd bindings are behind `target_os = "macos"`; see `shortcuts`).
    await page.keyboard.press('Control+A');
  } else {
    // Cmd/Ctrl+G focuses the input with its text selected.
    await page.keyboard.press('Control+G');
  }
  await page.waitForFunction(() => (globalThis as Global).__tychoWorkbench?.focused === 'jump', null, { timeout: 5_000 });
  await page.keyboard.press('Backspace');
  await page.keyboard.type(text);
  const at = await now(page);
  await page.keyboard.press('Enter');
  return at;
}

interface Landing {
  row: number;
  ok: boolean;
  detail: string;
  /** Enter → the next frame with every visible row loaded; null when the
   *  rows were already loaded (no frame went without them). */
  filledMs: number | null;
}

/** Jumps to `row` (1-based) and checks where the table landed. */
async function jumpTo(page: Page, row: number, how: 'click' | 'shortcut', timeout: number): Promise<Landing> {
  const at = await typeAndEnter(page, String(row), how);
  const index = row - 1;
  const landed = await page
    .waitForFunction(
      (index) => {
        const t = (globalThis as Global).__tychoTable;
        return !!t && t.marked === index && t.first <= index && index < t.end && t.pending === 0 && t.loaded === t.end - t.first;
      },
      index,
      { timeout, polling: 10 },
    )
    .then(() => true)
    .catch(() => false);
  const filled = landed ? await waitMark(page, 'tycho:viewport-filled', at, 1_000).catch(() => null) : null;
  await frames(page);
  const t = await table(page);
  const w = await workbench(page);
  // The row goes to the top, unless the file ends first: then the table's
  // end is the file's.
  const top = t ? (t.end === t.rows ? t.top <= index : t.top === index) : false;
  const ok = landed && top && w?.focused === 'table' && w.jumpRefusal === null;
  return {
    row,
    ok,
    detail: `top ${t?.top} rows ${t?.first}–${t?.end} of ${t?.rows}, marked ${t?.marked}, pending ${t?.pending}, focus ${w?.focused}, refusal ${w?.jumpRefusal}`,
    filledMs: filled === null ? null : filled - at,
  };
}

interface Refused {
  text: string;
  ok: boolean;
  detail: string;
  refusal: string | null;
  clearOfPanel: boolean;
}

/** Types `text`, which isn't a row; checks the refusal and that nothing moved. */
async function refuse(page: Page, text: string, expect: RegExp): Promise<Refused> {
  const before = await table(page);
  await typeAndEnter(page, text, 'shortcut');
  const refusal = await page
    .waitForFunction(() => (globalThis as Global).__tychoWorkbench?.jumpRefusal ?? false, null, { timeout: 5_000 })
    .then(async (handle) => (await handle.jsonValue()) as string)
    .catch(() => null);
  await frames(page, 3);
  const after = await table(page);
  const w = await workbench(page);
  const placed = refusal ? await clearOfPanel(page, 'jump-refusal') : null;
  const still = !!before && !!after && before.top === after.top && before.marked === after.marked;
  const ok = !!refusal && expect.test(refusal) && still && w?.focused === 'jump' && !!placed?.clear;
  return {
    text,
    ok,
    refusal,
    clearOfPanel: !!placed?.clear,
    detail: `refusal ${JSON.stringify(refusal)}, top ${before?.top} → ${after?.top}, focus ${w?.focused}, refusal at ${placed?.rect} vs panel ${placed?.panel}`,
  };
}

/** Keys pressed in the input must stay there: the table doesn't move. */
async function keysStayInInput(page: Page): Promise<{ ok: boolean; detail: string }> {
  await page.keyboard.press('Control+G');
  await page.waitForFunction(() => (globalThis as Global).__tychoWorkbench?.focused === 'jump', null, { timeout: 5_000 });
  const before = await table(page);
  const keys = ['ArrowDown', 'ArrowDown', 'PageDown', 'Space', 'End', 'ArrowUp', 'PageUp', 'Home', 'Control+ArrowDown', 'Meta+ArrowDown'];
  for (const key of keys) {
    await page.keyboard.press(key);
    await frames(page, 1);
  }
  await page.keyboard.type('12 34');
  await frames(page, 3);
  const after = await table(page);
  const w = await workbench(page);
  // Leave the input empty again.
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Backspace');
  return {
    ok: !!before && !!after && before.top === after.top && w?.focused === 'jump',
    detail: `top ${before?.top} → ${after?.top} after ${keys.join(', ')} and typing; focus ${w?.focused}`,
  };
}

/** A Japanese IME committing full-width digits: composition, then commit. */
async function imeFullWidth(page: Page): Promise<Landing> {
  await page.keyboard.press('Control+G');
  await page.waitForFunction(() => (globalThis as Global).__tychoWorkbench?.focused === 'jump', null, { timeout: 5_000 });
  await page.keyboard.press('Backspace');
  const cdp = await page.context().newCDPSession(page);
  for (const text of ['１', '１２', '１２３']) {
    await cdp.send('Input.imeSetComposition', { text, selectionStart: text.length, selectionEnd: text.length });
    await frames(page, 1);
  }
  await cdp.send('Input.insertText', { text: '１２３' });
  await cdp.detach();
  await frames(page);
  const at = await now(page);
  await page.keyboard.press('Enter');
  const landed = await page
    .waitForFunction(() => (globalThis as Global).__tychoTable?.marked === 122, null, { timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
  const t = await table(page);
  const w = await workbench(page);
  return {
    row: 123,
    ok: landed && t?.top === 122,
    detail: `top ${t?.top}, marked ${t?.marked}, refusal ${w?.jumpRefusal}`,
    filledMs: landed ? await waitMark(page, 'tycho:viewport-filled', at, 5_000).then((filled) => filled - at, () => null) : null,
  };
}

/**
 * Pastes `row` into the empty input, by keyboard or through the context
 * menu; returns whether the input then holds it. gpui-kit 0.7.1 draws the
 * menu on the canvas (Cut, Copy, Paste, a separator, Select All) at the
 * pointer; it has no published bounds, so Paste is clicked by its offset
 * below the pointer (`MENU_PASTE_DY`, read off `raw/jump-context-menu.png`).
 */
async function paste(page: Page, row: number, how: 'Control+V' | 'Meta+V' | 'menu'): Promise<{ landed: boolean; detail: string }> {
  await page.evaluate((text) => navigator.clipboard.writeText(text), String(row));
  await clickTarget(page, 'jump-input', 5_000);
  await page.waitForFunction(() => (globalThis as Global).__tychoWorkbench?.focused === 'jump', null, { timeout: 5_000 });
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Backspace');
  if (how === 'menu') {
    const [x, y, w, h] = await targetRect(page, 'jump-input', 5_000);
    const [px, py] = [x + w / 2, y + h / 2];
    await page.mouse.click(px, py, { button: 'right' });
    await frames(page, 3);
    await page.screenshot({ path: join(rawDir, 'jump-context-menu.png'), clip: { x: px - 40, y: py - 40, width: 320, height: 240 } });
    await page.mouse.move(px + 30, py + MENU_PASTE_DY);
    await frames(page);
    await page.mouse.click(px + 30, py + MENU_PASTE_DY);
  } else {
    await page.keyboard.press(how);
  }
  const landed = await page
    .waitForFunction((text) => (globalThis as Global).__tychoWorkbench?.jumpText === text, String(row), { timeout: 3_000 })
    .then(() => true)
    .catch(() => false);
  const w = await workbench(page);
  // Close a menu left open.
  await page.keyboard.press('Escape');
  return { landed, detail: `input ${JSON.stringify(w?.jumpText)}, focus ${w?.focused}` };
}

/**
 * Editing shortcuts in the input, both spellings: Ctrl (what gpui-kit binds
 * in a web build) and Cmd (what a Mac user presses; `shared/`'s bootstrap
 * binds it, `bind_mac_input_keys`). Select all, copy (read back from the
 * clipboard; needs clipboard-read), and undo.
 */
async function shortcuts(page: Page): Promise<Record<string, { ok: boolean; detail: string }>> {
  const result: Record<string, { ok: boolean; detail: string }> = {};
  const text = async () => (await workbench(page))?.jumpText;
  const clear = async () => {
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Backspace');
  };
  await clickTarget(page, 'jump-input', 5_000);
  for (const modifier of ['Control', 'Meta']) {
    await clear();
    await page.keyboard.type('98765');
    await page.keyboard.press(`${modifier}+A`);
    await page.keyboard.press('Backspace');
    await frames(page);
    const cleared = await text();
    result[`${modifier}+A selects all`] = { ok: cleared === '', detail: `input ${JSON.stringify(cleared)} after typing 98765, ${modifier}+A, Backspace` };

    await page.evaluate(() => navigator.clipboard.writeText('-'));
    await page.keyboard.type('31415');
    await page.keyboard.press(`${modifier}+A`);
    await page.keyboard.press(`${modifier}+C`);
    await page.waitForTimeout(200);
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    result[`${modifier}+C copies`] = { ok: copied === '31415', detail: `clipboard ${JSON.stringify(copied)}` };

    await clear();
    await page.keyboard.type('27');
    await page.waitForTimeout(600);
    await page.keyboard.type('18');
    await page.keyboard.press(`${modifier}+Z`);
    await frames(page);
    const undone = await text();
    result[`${modifier}+Z undoes`] = { ok: undone !== '2718', detail: `input ${JSON.stringify(undone)} after typing 27, 18, ${modifier}+Z` };
  }
  // The Mac word and line keys (`bind_mac_input_keys`; this machine's
  // browser reports a Mac `navigator.platform`).
  const macKeys: [string, string][] = [
    ['Alt+Shift+ArrowLeft', '123 '],
    ['Meta+Shift+ArrowLeft', ''],
    ['Alt+Backspace', '123 '],
  ];
  for (const [keys, expected] of macKeys) {
    await clear();
    await page.keyboard.type('123 456');
    await page.keyboard.press(keys);
    if (keys.includes('Shift')) await page.keyboard.press('Backspace');
    await frames(page);
    const left = await text();
    result[`${keys} (Mac word/line)`] = { ok: left === expected, detail: `input ${JSON.stringify(left)} after typing "123 456", ${keys}${keys.includes('Shift') ? ', Backspace' : ''}` };
  }
  await clear();
  return result;
}

/** A press on the header strip (not a control) leaves the table its keys. */
async function headerClickKeepsTableFocus(page: Page): Promise<{ ok: boolean; detail: string }> {
  const before = await table(page);
  const [x, y, , h] = await targetRect(page, 'jump-input', 5_000);
  // Left of the input in the same row: the stats line or blank strip.
  await page.mouse.click(x - 200, y + h / 2);
  await frames(page);
  const focused = (await workbench(page))?.focused;
  await page.keyboard.press('ArrowDown');
  await frames(page, 3);
  const after = await table(page);
  return {
    ok: focused === 'table' && !!before && !!after && after.top === before.top + 1,
    detail: `focus after the click ${focused}, top ${before?.top} → ${after?.top} after ArrowDown`,
  };
}

/** Paste's row in the context menu, below the pointer (CSS px). */
const MENU_PASTE_DY = Number(option('menu-paste-dy') ?? 66);
const rawDir = join(perfDir, 'results', 'raw');
mkdirSync(rawDir, { recursive: true });

/** A file with PAR1 at both ends and nothing Parquet between: it passes the
 *  sniff, then fails to open. */
function brokenParquet(): string {
  const path = join(rawDir, 'broken.parquet');
  writeFileSync(path, Buffer.concat([Buffer.from('PAR1'), Buffer.alloc(4096, 7), Buffer.from('PAR1')]));
  return path;
}

async function focusAfterFailedOpen(page: Page): Promise<{ ok: boolean; detail: string }> {
  // The table has focus before the drop: a jump hands it the keys. (Not a
  // click on the table: its scrollbar track's middle is under the panel.)
  await jumpTo(page, 10, 'shortcut', 15_000);
  const before = (await workbench(page))?.focused;
  await dropFile(page, brokenParquet());
  await page.waitForFunction(() => (globalThis as Global).__tychoWorkbench?.state === 'failed', null, { timeout: 30_000 });
  // The restore runs in GPUI's focus phase, after the frame that lost focus
  // was drawn (and published `focused: null`); the next frame has it.
  const restored = await page
    .waitForFunction(() => (globalThis as Global).__tychoWorkbench?.focused === 'workbench', null, { timeout: 2_000 })
    .then(() => true)
    .catch(() => false);
  const w = await workbench(page);
  return { ok: before === 'table' && restored, detail: `focus ${before} → ${w?.focused} (state ${w?.state})` };
}

async function openSample(page: Page, sample: SampleName, timeout: number): Promise<number> {
  await waitOverlay(page, 'Parquet ready', /ms$/, 180_000);
  const clicked = await now(page);
  await clickTarget(page, SAMPLES[sample].target);
  await waitMark(page, 'tycho:first-rows', clicked, timeout);
  await targetRect(page, 'jump-input', 10_000);
  return manifest[SAMPLES[sample].name]!.rows;
}

interface Run {
  sample: SampleName;
  inputClearOfPanel: boolean;
  inputRect: Rect;
  panelRect: Rect | null;
  landings: Landing[];
  refused: Refused[];
  keys: { ok: boolean; detail: string };
  header: { ok: boolean; detail: string };
  problems: string[];
}

async function measure(sample: SampleName, profile: Profile | null): Promise<Run> {
  const throttled = !!profile && profile.cpuSlowdown > 1;
  const timeout = throttled ? 60_000 : 15_000;
  const run = await open(chromium, url, { profile });
  const { page } = run;
  try {
    const rows = await openSample(page, sample, throttled ? 120_000 : 30_000);
    const input = await clearOfPanel(page, 'jump-input');
    const landings = [
      await jumpTo(page, Math.ceil(rows / 2), 'click', timeout),
      await jumpTo(page, rows, 'shortcut', timeout),
      await jumpTo(page, 1, 'shortcut', timeout),
    ];
    const refused = [
      await refuse(page, String(rows + 1), /^No row .*: rows run from 1 to /),
      await refuse(page, '0', /^No row 0:/),
      await refuse(page, 'abc', /^Type a row number/),
    ];
    const keys = await keysStayInInput(page);
    // Focus the table (a jump does), then press the header.
    await jumpTo(page, 100, 'shortcut', timeout);
    const header = await headerClickKeepsTableFocus(page);
    return { sample, header, inputClearOfPanel: input.clear, inputRect: input.rect, panelRect: input.panel, landings, refused, keys, problems: run.problems };
  } finally {
    await run.close();
  }
}

/** The input's edges, once per sample: IME, paste, and focus after a failed open. */
async function edges(sample: SampleName) {
  const run = await open(chromium, url, {});
  const { page } = run;
  try {
    await openSample(page, sample, 30_000);
    const ime = await imeFullWidth(page);
    await run.context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const keys = await shortcuts(page);
    const ctrlV = await paste(page, 4242, 'Control+V');
    const cmdV = await paste(page, 4141, 'Meta+V');
    const menuPaste = await paste(page, 4343, 'menu');
    await run.context.clearPermissions();
    await run.context.grantPermissions(['clipboard-write']);
    const menuPasteDenied = await paste(page, 4444, 'menu');
    const focus = await focusAfterFailedOpen(page);
    return { sample, ime, keys, ctrlV, cmdV, menuPaste, menuPasteDenied, focus, problems: run.problems };
  } finally {
    await run.close();
  }
}

/** Firefox and WebKit: first, middle, last, and out of range, by clicking. */
async function browserCheck(engine: BrowserType, sample: SampleName) {
  const run = await open(engine, url, {});
  const { page } = run;
  try {
    const rows = await openSample(page, sample, 60_000);
    const results = [];
    for (const row of [Math.ceil(rows / 2), rows, 1]) {
      // WebKit can deliver a press before hover updates (CLAUDE.md).
      const [x, y, w, h] = await targetRect(page, 'jump-input', 5_000);
      await page.mouse.move(x + w / 2, y + h / 2);
      await frames(page);
      results.push(await jumpTo(page, row, 'click', 30_000));
    }
    const [x, y, w, h] = await targetRect(page, 'jump-input', 5_000);
    await page.mouse.move(x + w / 2, y + h / 2);
    await frames(page);
    const before = await table(page);
    await clickTarget(page, 'jump-input', 5_000);
    await frames(page);
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Backspace');
    await page.keyboard.type(String(rows + 1));
    await page.keyboard.press('Enter');
    const refusal = await page
      .waitForFunction(() => (globalThis as Global).__tychoWorkbench?.jumpRefusal ?? false, null, { timeout: 5_000 })
      .then(async (handle) => (await handle.jsonValue()) as string)
      .catch(() => null);
    const after = await table(page);
    const outOfRange = { ok: !!refusal && before?.top === after?.top, detail: `refusal ${JSON.stringify(refusal)}, top ${before?.top} → ${after?.top}` };
    const ok = results.every((result) => result.ok) && outOfRange.ok;
    return { browser: engine.name(), sample, ok, landings: results, outOfRange, problems: run.problems };
  } finally {
    await run.close();
  }
}

const WORKER_PORT = 8793;
await assertPortFree(WORKER_DEV_PORT);
const worker = await startWorkerDev({ port: WORKER_PORT, requireObject: SAMPLES[samples.at(-1)!].name });
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
const failures: string[] = [];
const output: Record<string, unknown> = { date, label, ...machineInfo() };

try {
  const results: Record<string, unknown> = {};
  for (const sample of samples) {
    const bySample: Record<string, unknown> = {};
    for (const profile of flag('reference-only') ? PROFILES.slice(0, 1) : PROFILES) {
      const list: Run[] = [];
      for (let index = 0; index < runs; index++) {
        const run = await measure(sample, profile);
        list.push(run);
        const where = `${sample} ${profile.name} run ${index + 1}`;
        console.log(
          `${where}: ` +
            run.landings.map((l) => `row ${l.row} ${l.ok ? 'ok' : 'FAIL'} ${l.filledMs === null ? 'cached' : `${l.filledMs.toFixed(1)} ms`}`).join(', ') +
            `; refused ${run.refused.filter((r) => r.ok).length}/${run.refused.length}; keys ${run.keys.ok ? 'ok' : 'FAIL'}; header press ${run.header.ok ? 'ok' : 'FAIL'}; input ${run.inputClearOfPanel ? 'clear of' : 'UNDER'} the panel` +
            (run.problems.length ? `  PROBLEMS: ${run.problems.join('; ')}` : ''),
        );
        failures.push(...run.problems.map((problem) => `${where}: ${problem}`));
        if (!run.inputClearOfPanel) failures.push(`${where}: the jump input ${run.inputRect} is under the panel ${run.panelRect}`);
        for (const landing of run.landings) if (!landing.ok) failures.push(`${where}: jump to ${landing.row}: ${landing.detail}`);
        for (const refused of run.refused) if (!refused.ok) failures.push(`${where}: ${JSON.stringify(refused.text)}: ${refused.detail}`);
        if (!run.keys.ok) failures.push(`${where}: keys in the input: ${run.keys.detail}`);
        if (!run.header.ok) failures.push(`${where}: a press on the header: ${run.header.detail}`);
      }
      // Jumps whose rows were already cached have no time; they're counted.
      const ms = (which: number) => {
        const times = list.map((run) => run.landings[which]!.filledMs).filter((value) => value !== null);
        return { ...summarize(times), cached: list.length - times.length };
      };
      bySample[profile.name] = { runs: list.length, middleFilledMs: ms(0), lastFilledMs: ms(1), firstFilledMs: ms(2), list };
    }
    const edge = await edges(sample);
    const show = (name: string, result: { ok?: boolean; landed?: boolean; detail: string }) => `${name} ${(result.ok ?? result.landed) ? 'ok' : 'no'} (${result.detail})`;
    console.log(
      `${sample} edges: ${show('IME', edge.ime)}; ${show('Ctrl+V', edge.ctrlV)}; ${show('Cmd+V', edge.cmdV)}; ${show('menu Paste (granted)', edge.menuPaste)}; ` +
        `${show('menu Paste (denied)', edge.menuPasteDenied)}; ${show('focus after a failed open', edge.focus)}; ` +
        Object.entries(edge.keys).map(([name, result]) => show(name, result)).join('; '),
    );
    if (!edge.ime.ok) failures.push(`${sample}: IME full-width digits: ${edge.ime.detail}`);
    if (!edge.ctrlV.landed) failures.push(`${sample}: Ctrl+V: ${edge.ctrlV.detail}`);
    if (!edge.cmdV.landed) failures.push(`${sample}: Cmd+V: ${edge.cmdV.detail}`);
    if (!edge.menuPaste.landed) failures.push(`${sample}: context-menu paste with permission: ${edge.menuPaste.detail}`);
    if (edge.menuPasteDenied.landed) failures.push(`${sample}: context-menu paste pasted without clipboard-read: ${edge.menuPasteDenied.detail}`);
    if (!edge.focus.ok) failures.push(`${sample}: focus after a failed open: ${edge.focus.detail}`);
    for (const [name, result] of Object.entries(edge.keys)) if (!result.ok) failures.push(`${sample}: ${name}: ${result.detail}`);
    bySample.edges = edge;
    results[sample] = bySample;
  }
  output.samples = results;
  if (flag('browsers')) {
    const checks = [];
    for (const engine of [firefox, webkit]) {
      for (const sample of samples) {
        const check = await browserCheck(engine, sample);
        checks.push(check);
        console.log(`${check.browser} ${sample}: ${check.ok ? 'ok' : 'FAIL'} ${check.landings.map((l) => `row ${l.row} ${l.ok ? 'ok' : `FAIL ${l.detail}`}`).join(', ')}; out of range ${check.outOfRange.detail}`);
        if (!check.ok) failures.push(`${check.browser} ${sample}: ${JSON.stringify(check)}`);
      }
    }
    output.browsers = checks;
  }
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
  console.error(`\nFAIL\n${failures.map((failure) => `  ${failure}`).join('\n')}`);
  process.exit(1);
}
console.log('\nPASS');
