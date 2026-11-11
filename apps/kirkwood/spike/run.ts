// Throwaway: the two-canvas spike's runs, in headless Chromium at
// 1440×900, DPR 2 (`shared-web/perf/`'s `open`).
//
//   shots   the scene through GPUI's canvas: on load, the panel open, a
//           menu and a tooltip over the scene, and `?opaque` (the control:
//           the canvas as GPUI configures it), each a screenshot in out/
//           and the share of the scene's area that isn't the page's
//           background.
//   input   a wheel over the scene zooms it and leaves the table; a wheel
//           over the table scrolls it and leaves the scene; a drag on the
//           scene draws a shape and holds the clock; a press on the table
//           selects, its scrollbar drags, a press on the time control
//           pauses, and none of them starts a shape.
//   frames  frame intervals and per-frame main-thread work (Chromium's
//           trace) with the panel open: at rest (the clock paused), with
//           time running, the table flinging with time paused, and both.
//           `--params` sets the scene's knobs (src/scene.ts), `--segments`
//           which of the four run.
//   bytes   the build's files at brotli 11: Three.js's chunk, the scene's
//           own module, the host's, the wasm.
//   moves   the three moves, each checked and shot: the sort flight (space
//           to a against e and back: mid-flight, landed with the 3:1 gap
//           dark, the scene drawing nothing once landed); a drawn group
//           (its rows picked, the rest gray, the camera flown in, the table
//           in over the group's rows, with the fly-in and after it; the ways
//           back); the live column (its refreshes a second at each rate,
//           none while time is paused).
//   moveframes  frame intervals and main-thread work during each move: the
//           flight out and back, the fly-in with the table arriving with it
//           and after it, the way back, and the live column at 2 and 60
//           refreshes a second. `--params` and `--segments` as for frames.
//
// Usage: node apps/kirkwood/spike/run.ts [--only shots,input,frames,bytes,moves,moveframes] [--runs 3] [--no-build]
//          [--browser firefox|webkit] [--params size=1,scale=0.5] [--segments running,rest] [--serve]
// `--serve` builds, then serves the page until interrupted, to look at.
// Needs public/elements.bin (data.ts). Writes out/ (gitignored).
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { brotliCompressSync, constants } from 'node:zlib';
import { chromium, firefox, webkit, type Browser, type Page } from '@playwright/test';
import { build } from 'vite';
import { clickTarget, frameIntervals, frameRecorder, gesture, open, recordedBetween, waitMark, wheel, workBetween, workRecorder } from '../../../shared-web/perf/harness.ts';
import { flag, machineInfo, median, option, percentiles } from '../../../shared-web/perf/protocol.ts';
import { serveApp } from '../../../shared-web/perf/serve.ts';
import { ORIGIN_MARK, Trace, WORK_CATEGORIES, frameWork, lateFrames } from '../../../shared-web/perf/trace.ts';

const dir = import.meta.dirname;
const root = join(dir, '../../..');
const out = join(dir, 'out');
const only = (option('only') ?? 'shots,input,frames,bytes').split(',');
const RUNS = Number(option('runs') ?? 3);
const PORT = 4391;
/** `--browser firefox|webkit` for shots and input (at DPR 1; frames are Chromium's). */
const ENGINE = { chromium, firefox, webkit }[option('browser') ?? 'chromium'] ?? chromium;
const SUFFIX = option('browser') ? `-${option('browser')}` : '';
/** The scene's knobs for the frames run (`--params size=1,scale=0.5`), and which segments (`--segments running`). */
const PARAMS = Object.fromEntries((option('params') ?? '').split(',').filter(Boolean).map((pair) => pair.split('=') as [string, string]));
const SEGMENTS = option('segments')?.split(',');
/** The layout, in CSS px (the crate's `PANEL_WIDTH`, its handle, its panel's header). */
const VIEW = { width: 1440, height: 900 };
const PANEL = { left: VIEW.width - 560, header: 40 };
const AT = {
  handle: { x: VIEW.width - 50, y: 450 },
  scene: { x: 420, y: 450 },
  table: { x: PANEL.left + 300, y: 500 },
  menu: { x: PANEL.left + 30, y: 20 },
  time: { x: 50, y: VIEW.height - 38 },
  /** A cell of the first column (the period, rounded to fit). */
  period: { x: PANEL.left + 150, y: 296 },
};

type Kirkwood = { state(): number[]; groupRadius(yearsAhead: number): number; alpha: boolean; scene?: { stats: { frames: number; draws: [number, number][]; rows: number; renderer: string; distance: number; flying: boolean } } };

/** The crate's `state` indices. */
const S = { panel: 0, shapePoints: 1, shapeClosed: 2, top: 3, selected: 4, filled: 5, tooltip: 6, flight: 7, groupRows: 8, pickMs: 9, flown: 10, slide: 11, liveRefreshes: 12, tableRows: 13, groupRadius: 14, liveRate: 15 } as const;

interface State {
  panel: boolean;
  shapePoints: number;
  shapeClosed: boolean;
  top: number;
  selected: number;
  tooltip: boolean;
  /** The sort flight: 0 in space, 1 landed. */
  flight: number;
  groupRows: number;
  pickMs: number;
  /** The camera's flights finished. */
  flown: number;
  /** How far in the panel is, 0..1. */
  slide: number;
  liveRefreshes: number;
  tableRows: number;
  groupRadius: number;
  liveRate: number;
  sceneFrames: number;
  distance: number;
}
async function state(page: Page): Promise<State> {
  return page.evaluate((S) => {
    const k = (globalThis as unknown as { __kirkwood: Kirkwood }).__kirkwood;
    const s = k.state();
    return {
      panel: s[S.panel] === 1,
      shapePoints: s[S.shapePoints]!,
      shapeClosed: s[S.shapeClosed] === 1,
      top: s[S.top]!,
      selected: s[S.selected]!,
      tooltip: s[S.tooltip] === 1,
      flight: s[S.flight]!,
      groupRows: s[S.groupRows]!,
      pickMs: s[S.pickMs]!,
      flown: s[S.flown]!,
      slide: s[S.slide]!,
      liveRefreshes: s[S.liveRefreshes]!,
      tableRows: s[S.tableRows]!,
      groupRadius: s[S.groupRadius]!,
      liveRate: s[S.liveRate]!,
      sceneFrames: k.scene?.stats.frames ?? 0,
      distance: k.scene?.stats.distance ?? 0,
    };
  }, S);
}
/** Waits for one of the crate's state values to pass a test. */
const stateIs = (page: Page, index: number, test: 'eq' | 'gte', value: number, timeout = 30_000) =>
  page.waitForFunction(
    ({ index, test, value }) => {
      const now = (globalThis as unknown as { __kirkwood: Kirkwood }).__kirkwood.state()[index]!;
      return test === 'eq' ? now === value : now >= value;
    },
    { index, test, value },
    { timeout, polling: 16 },
  );
/** Opens the panel by its handle and waits for it to be in. */
async function openPanel(page: Page): Promise<void> {
  await page.mouse.click(AT.handle.x, AT.handle.y);
  await stateIs(page, S.slide, 'eq', 1);
  await stateIs(page, S.filled, 'gte', 1);
}
/** A freehand ellipse on the scene, the button still held at its end unless `release`. */
async function drawShape(page: Page, at: { x: number; y: number }, rx: number, ry: number, release = true): Promise<void> {
  await page.mouse.move(at.x - rx, at.y);
  await page.mouse.down();
  for (let step = 1; step <= 48; step++) {
    const turn = (step / 48) * 2 * Math.PI;
    await page.mouse.move(at.x + rx * Math.cos(turn + Math.PI), at.y + ry * Math.sin(turn + Math.PI));
  }
  if (release) await page.mouse.up();
}

function buildAll(): Promise<unknown> {
  const target = join(root, 'target/wasm32-unknown-unknown/release/kirkwood_spike.wasm');
  const pkg = join(dir, 'pkg');
  execFileSync('cargo', ['build', '-p', 'kirkwood-spike', '--target', 'wasm32-unknown-unknown', '--release'], { cwd: root, stdio: 'inherit' });
  execFileSync('wasm-bindgen', [target, '--out-dir', pkg, '--target', 'web'], { stdio: 'inherit' });
  const features = ['bulk-memory', 'nontrapping-float-to-int', 'sign-ext', 'mutable-globals', 'reference-types', 'multivalue', 'threads'].map((name) => `--enable-${name}`);
  execFileSync('wasm-opt', ['-Oz', ...features, `${pkg}/kirkwood_spike_bg.wasm`, '-o', `${pkg}/kirkwood_spike_bg.wasm`], { stdio: 'inherit' });
  return build({ root: dir, configFile: join(dir, 'vite.config.ts'), logLevel: 'warn' });
}

/** Opens the page and waits for the belt to be drawn. */
async function ready(url: string, params: Record<string, string> = {}, init: (() => void)[] = []) {
  const browsing = await open(init.length ? chromium : ENGINE, url, { params: { ...PARAMS, ...params }, init });
  await waitMark(browsing.page, 'kirkwood:belt', 0, 120_000);
  await browsing.page.waitForFunction(() => {
    const scene = (globalThis as unknown as { __kirkwood: Kirkwood }).__kirkwood.scene;
    return !!scene && scene.stats.rows > 0 && scene.stats.frames > 5;
  });
  return browsing;
}

/** A screenshot at CSS size, saved, and the share of `region`'s pixels (CSS
 *  px) with something drawn: any channel over 24 (the page's background is
 *  #05060a, an opaque canvas with nothing drawn black). */
async function shot(page: Page, name: string, region = { x: 0, y: 60, width: PANEL.left - 20, height: 760 }): Promise<number> {
  return (await shotOf(page, name, [region]))[0]!.lit;
}

type Region = { x: number; y: number; width: number; height: number };
/** The scene's knobs in a screenshot's name (`--params scale=0.5` → `-scale=0.5`). */
const TAG = option('params') ? `-${option('params')!.replaceAll(',', '-')}` : '';
/** A part of the page at the display's pixels (2 a CSS px), saved: what the scene's resolution looks like up close. */
async function detail(page: Page, name: string, clip: Region): Promise<void> {
  writeFileSync(join(out, `${name}${SUFFIX}${TAG}.png`), await page.screenshot({ clip, scale: 'device' }));
}
/** A screenshot at CSS size, saved, and for each region its lit share (as
 *  `shot`), its mean brightness (0..255, the channels' mean), and the share
 *  of its pixels with a hue (its channels more than 24 apart). */
async function shotOf(page: Page, name: string, regions: Region[]): Promise<{ lit: number; mean: number; hued: number }[]> {
  const png = await page.screenshot({ scale: 'css' });
  writeFileSync(join(out, `${name}${SUFFIX}${TAG}.png`), png);
  return page.evaluate(
    async ({ data, regions }) => {
      const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${data}`)).blob());
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext('2d', { willReadFrequently: true })!;
      context.drawImage(bitmap, 0, 0);
      return regions.map((region) => {
        const { data: pixels } = context.getImageData(region.x, region.y, region.width, region.height);
        let [lit, sum, hued] = [0, 0, 0];
        for (let at = 0; at < pixels.length; at += 4) {
          const [r, g, b] = [pixels[at]!, pixels[at + 1]!, pixels[at + 2]!];
          if (r > 24 || g > 24 || b > 24) lit++;
          if (Math.max(r, g, b) - Math.min(r, g, b) > 24) hued++;
          sum += (r + g + b) / 3;
        }
        const count = pixels.length / 4;
        return { lit: lit / count, mean: sum / count, hued: hued / count };
      });
    },
    { data: png.toString('base64'), regions },
  );
}

const check = (name: string, ok: boolean, detail: string) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: ${detail}`);
  if (!ok) process.exitCode = 1;
  return { name, ok, detail };
};

async function shots(url: string) {
  const results = [];
  const { page, problems, close } = await ready(url, { probe: '' });
  try {
    const backend = await page.evaluate(() => ({ alpha: (globalThis as unknown as { __kirkwood: Kirkwood }).__kirkwood.alpha, scene: (globalThis as unknown as { __kirkwood: Kirkwood }).__kirkwood.scene!.stats.renderer, webgpu: "gpu" in navigator }));
    const onLoad = await shot(page, 'on-load');
    results.push(check('on load, the scene shows through', onLoad > 0.2, `lit share ${onLoad.toFixed(3)}; ${JSON.stringify(backend)}`));
    await openPanel(page);
    await page.waitForTimeout(400);
    const besidePanel = await shot(page, 'panel');
    const underPanel = await shot(page, 'panel', { x: PANEL.left + 60, y: 400, width: 400, height: 3 });
    results.push(check('the panel open, the scene beside it', besidePanel > 0.2, `lit share beside the panel ${besidePanel.toFixed(3)}; a strip of the table ${underPanel.toFixed(3)}`));
    const noMenu = await shot(page, 'panel', { x: PANEL.left - 101, y: 40, width: 3, height: 118 });
    await page.mouse.click(AT.menu.x, AT.menu.y);
    await page.waitForTimeout(500);
    // Left of the panel's edge, under its header: the menu opens there,
    // its right edge at the button's. Its border is a line of lit pixels
    // down a column the scene leaves dark.
    const menu = await shot(page, 'menu', { x: PANEL.left - 101, y: 40, width: 3, height: 118 });
    results.push(check('a menu over the scene', menu > noMenu + 0.2, `lit share down its left border ${menu.toFixed(3)}, ${noMenu.toFixed(3)} with it closed`));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    // The first column's cells sit at the panel's left edge: its tooltip opens beside them.
    await page.mouse.move(AT.period.x, AT.period.y);
    await page.mouse.move(AT.period.x + 2, AT.period.y + 2);
    await page.waitForTimeout(900);
    await shot(page, 'table-tooltip');
    results.push(check("the table's tooltip", (await state(page)).tooltip, 'the table reports one shown (it opens over the panel)'));
    // The time control's, which opens over the scene: lit pixels where the scene is dark.
    const above = { x: 24, y: 800, width: 120, height: 44 };
    const noTip = await shot(page, 'table-tooltip', above);
    await page.mouse.move(AT.time.x, AT.time.y);
    await page.mouse.move(AT.time.x + 2, AT.time.y + 1);
    await page.waitForTimeout(1200);
    const tip = await shot(page, 'tooltip', above);
    results.push(check('a tooltip over the scene', tip > noTip + 0.05, `lit share above the time control ${tip.toFixed(3)}, ${noTip.toFixed(3)} before`));
    results.push(check('no page problems', problems.length === 0, problems.join(' | ') || 'none'));
  } finally {
    await close();
  }
  const control = await ready(url, { opaque: '' });
  try {
    const lit = await shot(control.page, 'opaque');
    results.push(check('the control: an opaque canvas hides the scene', lit < 0.02, `lit share ${lit.toFixed(3)}`));
  } finally {
    await control.close();
  }
  return results;
}

async function input(url: string) {
  const results = [];
  const { page, close } = await ready(url, { probe: '' });
  try {
    // A wheel over the scene.
    let before = await state(page);
    await page.mouse.move(AT.scene.x, AT.scene.y);
    await wheel(page, 300);
    await page.waitForTimeout(300);
    let after = await state(page);
    results.push(check('a wheel over the scene zooms it', after.distance !== before.distance, `camera distance ${before.distance.toFixed(2)} → ${after.distance.toFixed(2)} au`));

    await openPanel(page);
    await page.waitForTimeout(300);

    // A wheel over the table.
    before = await state(page);
    await page.mouse.move(AT.table.x, AT.table.y);
    await wheel(page, 3000);
    await page.waitForTimeout(500);
    after = await state(page);
    results.push(check('a wheel over the table scrolls it, not the scene', after.top > before.top && after.distance === before.distance, `top row ${before.top.toFixed(1)} → ${after.top.toFixed(1)}; camera ${before.distance.toFixed(2)} → ${after.distance.toFixed(2)}`));

    // A wheel over the scene with the panel open.
    before = after;
    await page.mouse.move(AT.scene.x, AT.scene.y);
    await wheel(page, -300);
    await page.waitForTimeout(300);
    after = await state(page);
    results.push(check('a wheel over the scene leaves the table', after.top === before.top && after.distance !== before.distance, `top row ${before.top.toFixed(1)} → ${after.top.toFixed(1)}; camera ${before.distance.toFixed(2)} → ${after.distance.toFixed(2)}`));

    // A press on a cell selects; no shape.
    await page.mouse.click(AT.table.x, AT.table.y);
    await page.waitForTimeout(200);
    after = await state(page);
    results.push(check('a press on a cell selects it, and draws no shape', after.selected >= 0 && after.shapePoints === 0, `selected row ${after.selected}; shape points ${after.shapePoints}`));

    // The scrollbar: a drag on its thumb.
    before = after;
    const bar = { x: VIEW.width - 6, y: PANEL.header + 30 + 6 };
    await page.mouse.move(bar.x, bar.y);
    await page.mouse.down();
    for (let step = 1; step <= 20; step++) await page.mouse.move(bar.x, bar.y + step * 15);
    await page.waitForTimeout(300);
    await page.mouse.up();
    await page.waitForTimeout(400);
    after = await state(page);
    results.push(check("the table's scrollbar drags", after.top > before.top + 10_000 && after.shapePoints === 0, `top row ${before.top.toFixed(0)} → ${after.top.toFixed(0)}`));

    // A drag on the scene: a freehand shape, the clock held meanwhile.
    await page.mouse.move(300, 300);
    const running = await state(page);
    await page.waitForTimeout(300);
    const stillRunning = await state(page);
    await drawShape(page, { x: 420, y: 320 }, 130, 110, false);
    await page.waitForTimeout(100);
    const held = await state(page);
    await page.waitForTimeout(400);
    const heldLater = await state(page);
    await shot(page, 'shape-drawing');
    await page.mouse.up();
    // The shape's rows are a group: the camera flies in, and time stays paused.
    await stateIs(page, S.flown, 'gte', 1);
    await page.waitForTimeout(300);
    after = await state(page);
    await page.waitForTimeout(300);
    const onGroup = await state(page);
    await shot(page, 'shape');
    results.push(check('a drag on the scene draws a freehand shape', held.shapePoints >= 40 && !held.shapeClosed && after.shapeClosed, `${after.shapePoints} points, closed at the release`));
    results.push(check('time holds while it is drawn, and stays paused on its group', stillRunning.sceneFrames > running.sceneFrames && heldLater.sceneFrames === held.sceneFrames && after.groupRows > 0 && onGroup.sceneFrames === after.sceneFrames, `scene frames: ${running.sceneFrames} → ${stillRunning.sceneFrames} before; ${held.sceneFrames} → ${heldLater.sceneFrames} over 400 ms of the drag; ${after.sceneFrames} → ${onGroup.sceneFrames} over 300 ms on its ${after.groupRows} rows`));
    // The way back: every row, and time moving again.
    await clickTarget(page, 'whole-belt');
    await stateIs(page, S.flown, 'gte', 2);
    await page.waitForTimeout(300);
    const back = await state(page);
    await page.waitForTimeout(300);
    results.push(check('the whole belt: no group, and time moves again', back.groupRows === 0 && (await state(page)).sceneFrames > back.sceneFrames, `group rows ${back.groupRows}; scene frames moving`));

    // A drag released over the panel still ends: the shape closes and time moves again.
    await page.mouse.move(300, 600);
    await page.mouse.down();
    for (let step = 1; step <= 10; step++) await page.mouse.move(300 + step * 70, 600);
    await page.mouse.up();
    await page.waitForTimeout(100);
    const released = await state(page);
    await page.waitForTimeout(300);
    after = await state(page);
    results.push(check('a drag released over the panel ends the shape', released.shapeClosed && after.sceneFrames > released.sceneFrames, `closed ${released.shapeClosed}; scene frames ${released.sceneFrames} → ${after.sceneFrames} over 300 ms`));

    // A press on the time control pauses, and isn't a shape.
    before = await state(page);
    await page.mouse.click(AT.time.x, AT.time.y);
    await page.waitForTimeout(200);
    const paused = await state(page);
    await page.waitForTimeout(400);
    after = await state(page);
    results.push(check('a press on the time control pauses, and draws no shape', after.sceneFrames === paused.sceneFrames && after.shapePoints === before.shapePoints, `scene frames ${paused.sceneFrames} → ${after.sceneFrames} over 400 ms; shape points ${before.shapePoints} → ${after.shapePoints}`));

    // The table's hover: its tooltip, with the scene behind.
    await page.mouse.move(AT.period.x, AT.period.y);
    await page.mouse.move(AT.period.x + 2, AT.period.y + 2);
    await page.waitForTimeout(900);
    results.push(check("the table's hover shows its tooltip", (await state(page)).tooltip, 'reported by the table'));
  } finally {
    await close();
  }
  return results;
}

interface Reading {
  intervals: { n: number; p50: number; p95: number; max: number };
  late: { late: number; share: number };
  /** Per-frame main-thread work, from the trace. */
  work: { n: number; p50: number; p95: number; max: number };
  busyShare: number;
  /** Frames the scene drew, and its `render()` time. */
  scene: { n: number; p50: number; p95: number; max: number };
  /** rAF callbacks that made GPU calls (the scene's and GPUI's). */
  drew: number;
  seconds: number;
}

async function traced(browser: Browser, page: Page, act: () => Promise<void>): Promise<Reading> {
  await browser.startTracing(page, { categories: WORK_CATEGORIES });
  const from = await page.evaluate((name) => (performance.mark(name), performance.now()), ORIGIN_MARK);
  await act();
  const to = await page.evaluate(() => performance.now());
  const trace = new Trace(JSON.parse((await browser.stopTracing()).toString()));
  const work = frameWork(trace, from, to);
  const intervals = frameIntervals(await recordedBetween(page, from, to));
  const draws = await page.evaluate(({ from, to }) => (globalThis as unknown as { __kirkwood: Kirkwood }).__kirkwood.scene!.stats.draws.filter(([t]) => t >= from && t <= to).map(([, ms]) => ms), { from, to });
  return {
    intervals: percentiles(intervals),
    late: lateFrames(intervals),
    work: percentiles(work.frames.map((frame) => frame.ms)),
    busyShare: work.busyMs / work.windowMs,
    scene: percentiles(draws),
    drew: (await workBetween(page, from, to)).length,
    seconds: (to - from) / 1000,
  };
}

const SEGMENT_MS = 4000;
const fling = (page: Page) => gesture(page, AT.table, { y: -90_000, speed: 22_500 }, { scaleByDpr: true });

async function frames(url: string) {
  const runs: Record<string, Reading>[] = [];
  let renderer = '';
  for (let run = 0; run < RUNS; run++) {
    const { page, context, close } = await ready(url, PARAMS, [frameRecorder, workRecorder]);
    try {
      renderer = await page.evaluate(() => (globalThis as unknown as { __kirkwood: Kirkwood }).__kirkwood.scene!.stats.renderer);
      const browser = context.browser()!;
      await openPanel(page);
      await page.mouse.move(AT.table.x, AT.table.y);
      await page.waitForTimeout(500);
      const reading: Record<string, Reading> = {};
      const wants = (name: string) => !SEGMENTS || SEGMENTS.includes(name);
      if (wants('running')) reading.running = await traced(browser, page, () => page.waitForTimeout(SEGMENT_MS));
      if (wants('runningFling')) reading.runningFling = await traced(browser, page, () => fling(page));
      await page.keyboard.press('Home');
      await page.mouse.click(AT.time.x, AT.time.y);
      await page.mouse.move(AT.table.x, AT.table.y);
      await page.waitForTimeout(500);
      if (wants('rest')) reading.rest = await traced(browser, page, () => page.waitForTimeout(SEGMENT_MS));
      if (wants('pausedFling')) reading.pausedFling = await traced(browser, page, () => fling(page));
      runs.push(reading);
      console.log(`run ${run + 1}: ${Object.entries(reading).map(([name, r]) => `${name} p50 ${r.intervals.p50.toFixed(1)} p95 ${r.intervals.p95.toFixed(1)} ms, work p50 ${r.work.p50.toFixed(1)}`).join('; ')}`);
    } finally {
      await close();
    }
  }
  const summary = summarize(runs);
  console.table(summary);
  return { renderer, params: PARAMS, runs: RUNS, summary, raw: runs };
}

/** Each segment's readings across the runs, as medians. */
function summarize(runs: Record<string, Reading>[]): Record<string, Record<string, number>> {
  const summary: Record<string, Record<string, number>> = {};
  for (const name of Object.keys(runs[0]!)) {
    const of = (pick: (reading: Reading) => number) => Number(median(runs.map((run) => pick(run[name]!))).toFixed(2));
    summary[name] = {
      intervalP50: of((r) => r.intervals.p50),
      intervalP95: of((r) => r.intervals.p95),
      intervalMax: of((r) => r.intervals.max),
      lateShare: of((r) => r.late.share),
      workP50: of((r) => r.work.p50),
      workP95: of((r) => r.work.p95),
      workMax: of((r) => r.work.max),
      workFrames: of((r) => r.work.n),
      busyShare: of((r) => r.busyShare),
      sceneDraws: of((r) => r.scene.n),
      sceneRenderP50: of((r) => r.scene.p50),
      sceneRenderP95: of((r) => r.scene.p95),
      drewCallbacks: of((r) => r.drew),
      seconds: of((r) => r.seconds),
    };
  }
  return summary;
}

function bytes() {
  const assets = join(dir, 'dist/assets');
  const sizes: Record<string, { raw: number; brotli: number }> = {};
  for (const file of readdirSync(assets)) {
    const data = readFileSync(join(assets, file));
    const brotli = brotliCompressSync(data, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: data.length } }).length;
    sizes[file.replace(/-[\w-]{8}\./, '.')] = { raw: data.length, brotli };
  }
  const three = JSON.parse(readFileSync(join(dir, 'node_modules/three/package.json'), 'utf8')).version as string;
  console.table(Object.fromEntries(Object.entries(sizes).map(([name, size]) => [name, { 'raw KiB': (size.raw / 1024).toFixed(1), 'brotli KiB': (size.brotli / 1024).toFixed(1) }])));
  return { three, sizes };
}

/** a against e's place on screen (src/scene.ts's `PLOT`), with the panel closed. */
const plotX = (a: number) => 80 + ((a - 1.5) / 4) * (VIEW.width - 160);
const plotY = (e: number) => VIEW.height - 129 - (e / 0.6) * (VIEW.height - 129 - 96);
/** A shape over the belt's left limb, on load. */
const GROUP = { at: { x: 480, y: 520 }, rx: 80, ry: 70 };
/** The scene, left of where the panel comes in. */
const BESIDE: Region = { x: 0, y: 60, width: PANEL.left - 20, height: 760 };

async function moves(url: string) {
  const results = [];
  // The sort flight.
  {
    const { page, problems, close } = await ready(url);
    try {
      const space = await shot(page, 'sort-space');
      await detail(page, 'detail-space', { x: 380, y: 420, width: 360, height: 240 });
      await clickTarget(page, 'sort');
      await stateIs(page, S.flight, 'gte', 0.5);
      const mid = await state(page);
      await shot(page, 'sort-mid');
      await stateIs(page, S.flight, 'eq', 1);
      await page.waitForTimeout(300);
      // The 3:1 gap at 2.50 au against the belt 0.1 au each side of it, between e 0.05 and 0.25.
      const strip = (a: number): Region => ({ x: Math.round(plotX(a)) - 3, y: Math.round(plotY(0.25)), width: 6, height: Math.round(plotY(0.05) - plotY(0.25)) });
      const [gap, inner, outer] = await shotOf(page, 'sort-landed', [strip(2.5), strip(2.4), strip(2.6)]);
      await detail(page, 'detail-landed', { x: 330, y: 480, width: 360, height: 240 });
      results.push(check('the flight lands in a against e, the 3:1 gap open', mid.flight < 1 && gap!.mean < 0.5 * Math.min(inner!.mean, outer!.mean), `mean brightness at 2.50 au ${gap!.mean.toFixed(1)}, at 2.40 ${inner!.mean.toFixed(1)}, at 2.60 ${outer!.mean.toFixed(1)}; shot mid-flight at ${mid.flight.toFixed(2)}`));
      const landed = await state(page);
      await page.waitForTimeout(500);
      const later = await state(page);
      results.push(check('landed, the scene draws nothing while time runs', later.sceneFrames === landed.sceneFrames, `scene frames ${landed.sceneFrames} → ${later.sceneFrames} over 500 ms`));
      await clickTarget(page, 'sort');
      await stateIs(page, S.flight, 'eq', 0);
      await page.waitForTimeout(300);
      const back = await shot(page, 'sort-back');
      results.push(check('and back to space', Math.abs(back - space) < 0.05, `lit share ${space.toFixed(3)} on load, ${back.toFixed(3)} back`));
      results.push(check('no page problems (sort)', problems.length === 0, problems.join(' | ') || 'none'));
    } finally {
      await close();
    }
  }
  // A drawn group, the table arriving with the fly-in and after it.
  for (const arrive of ['with', 'after']) {
    const { page, problems, close } = await ready(url, { arrive });
    try {
      const rows = (await state(page)).tableRows;
      const [before] = await shotOf(page, `group-before-${arrive}`, [BESIDE]);
      await drawShape(page, GROUP.at, GROUP.rx, GROUP.ry, false);
      await shot(page, `group-drawn-${arrive}`);
      await page.mouse.up();
      const picked = await state(page);
      // Partway through the fly-in.
      await page.waitForTimeout(700);
      const mid = await state(page);
      await shot(page, `fly-mid-${arrive}`);
      await stateIs(page, S.flown, 'gte', 1);
      const arrived = await state(page);
      await stateIs(page, S.slide, 'eq', 1);
      await page.waitForTimeout(300);
      const settled = await state(page);
      // Flown in, the group is at the middle of what the panel leaves; the belt above it isn't the group's.
      const [group, rest] = await shotOf(page, `fly-in-${arrive}`, [{ x: 340, y: 380, width: 200, height: 160 }, { x: 300, y: 70, width: 500, height: 110 }]);
      const radii = await page.evaluate(() => [0, 1, 3, 10].map((years) => (globalThis as unknown as { __kirkwood: Kirkwood }).__kirkwood.groupRadius(years)));
      results.push(check(`a shape's rows are picked (${arrive})`, picked.groupRows > 0 && picked.shapeClosed, `${picked.groupRows} rows of ${rows} in ${picked.pickMs.toFixed(0)} ms; radius ${picked.groupRadius.toFixed(2)} au`));
      results.push(check(`the group keeps its color and the rest goes gray (${arrive})`, group!.hued > 0.2 && rest!.lit > 0.2 && rest!.hued < 0.02, `pixels with a hue: ${(group!.hued * 100).toFixed(0)}% in the group, ${(rest!.hued * 100).toFixed(1)}% in the belt beyond it (${(rest!.lit * 100).toFixed(0)}% of it lit)`));
      results.push(check(`the camera flies in (${arrive})`, settled.distance < mid.distance && mid.distance < 13, `camera ${mid.distance.toFixed(2)} au away mid-flight, ${settled.distance.toFixed(2)} arrived (13 on load)`));
      results.push(check(
        arrive === 'with' ? 'the table comes in with the fly-in' : 'the table comes in after the fly-in',
        settled.panel && (arrive === 'with' ? mid.slide > 0 && mid.slide < 1 : mid.slide === 0 && arrived.slide < 1),
        `the panel ${mid.slide.toFixed(2)} in mid-flight, ${arrived.slide.toFixed(2)} as the camera arrived, ${settled.slide.toFixed(2)} settled`,
      ));
      results.push(check(`the table is filtered to the group's rows (${arrive})`, settled.tableRows === picked.groupRows, `${settled.tableRows} rows`));
      await page.waitForTimeout(300);
      results.push(check(`time stays paused on the group (${arrive})`, (await state(page)).sceneFrames === settled.sceneFrames, `the group's radius ${radii.map((radius) => radius.toFixed(2)).join(' → ')} au after 0, 1, 3, and 10 years (seconds, at a year a second)`));
      if (arrive === 'with') {
        await clickTarget(page, 'all-rows');
        await page.waitForTimeout(300);
        const all = await state(page);
        await shot(page, 'all-rows');
        results.push(check('Show all rows: every row, the group still drawn', all.tableRows === rows && all.groupRows === picked.groupRows, `${all.tableRows} rows; the group's ${all.groupRows}`));
        await clickTarget(page, 'whole-belt');
        await stateIs(page, S.flown, 'gte', 2);
        await page.waitForTimeout(400);
        const home = await state(page);
        const [belt] = await shotOf(page, 'whole-belt', [{ ...BESIDE, width: BESIDE.width - 300 }]);
        results.push(check('The whole belt: the camera back out, the colors back', home.groupRows === 0 && home.distance === 13 && belt!.hued > 0.5 * before!.hued, `camera ${home.distance.toFixed(2)} au away; hued share ${belt!.hued.toFixed(3)}`));
      }
      results.push(check(`no page problems (${arrive})`, problems.length === 0, problems.join(' | ') || 'none'));
    } finally {
      await close();
    }
  }
  // The live column.
  {
    const { page, problems, close } = await ready(url);
    try {
      await openPanel(page);
      const rates: string[] = [];
      let ok = true;
      for (let turn = 0; turn < 5; turn++) {
        const from = await state(page);
        await page.waitForTimeout(3000);
        const to = await state(page);
        const measured = (to.liveRefreshes - from.liveRefreshes) / 3;
        // A timer's rate: 60 a second runs short of it (each refresh waits on a timeout).
        // 60 a second is as fast as a timer goes: about 35 in Chromium, 27 in WebKit.
        ok &&= measured <= from.liveRate + 0.5 && measured >= (from.liveRate >= 60 ? 20 : 0.8 * from.liveRate);
        rates.push(`${from.liveRate}/s: ${measured.toFixed(1)}`);
        if (turn === 0) {
          await shot(page, 'live-a');
          await page.waitForTimeout(600);
          await shot(page, 'live-b');
        }
        await clickTarget(page, 'live-rate');
        await page.waitForTimeout(200);
      }
      results.push(check('the live column refreshes at its rate', ok, rates.join('; ')));
      await page.mouse.click(AT.time.x, AT.time.y);
      // One more refresh, to the time it stopped at, comes within the column's interval.
      await page.waitForTimeout(1300);
      const paused = await state(page);
      await page.waitForTimeout(1200);
      const later = await state(page);
      results.push(check('and not while time is paused', later.liveRefreshes === paused.liveRefreshes, `refreshes ${paused.liveRefreshes} → ${later.liveRefreshes} over 1.2 s`));
      results.push(check('no page problems (live)', problems.length === 0, problems.join(' | ') || 'none'));
    } finally {
      await close();
    }
  }
  return results;
}

/** Frame times during each move, read as `frames` reads them. */
async function moveFrames(url: string) {
  const runs: Record<string, Reading>[] = [];
  const picks: number[] = [];
  const wants = (name: string) => !SEGMENTS || SEGMENTS.includes(name);
  const session = async (params: Record<string, string>, act: (page: Page, browser: Browser) => Promise<void>) => {
    const { page, context, close } = await ready(url, { ...PARAMS, ...params }, [frameRecorder, workRecorder]);
    try {
      await act(page, context.browser()!);
    } finally {
      await close();
    }
  };
  for (let run = 0; run < RUNS; run++) {
    const reading: Record<string, Reading> = {};
    if (['flight', 'flightBack', 'flyIn', 'flyHome'].some(wants)) {
      await session({ arrive: 'with' }, async (page, browser) => {
        const sort = async (to: number) => {
          await clickTarget(page, 'sort');
          await stateIs(page, S.flight, 'eq', to);
        };
        if (wants('flight')) reading.flight = await traced(browser, page, () => sort(1));
        else await sort(1);
        await page.waitForTimeout(300);
        if (wants('flightBack')) reading.flightBack = await traced(browser, page, () => sort(0));
        else await sort(0);
        await page.waitForTimeout(300);
        await drawShape(page, GROUP.at, GROUP.rx, GROUP.ry, false);
        const flyIn = async () => {
          await page.mouse.up();
          await stateIs(page, S.flown, 'gte', 1);
          await stateIs(page, S.slide, 'eq', 1);
        };
        if (wants('flyIn')) reading.flyIn = await traced(browser, page, flyIn);
        else await flyIn();
        picks.push((await state(page)).pickMs);
        await page.waitForTimeout(300);
        if (wants('flyHome')) {
          reading.flyHome = await traced(browser, page, async () => {
            await clickTarget(page, 'whole-belt');
            await stateIs(page, S.flown, 'gte', 2);
          });
        }
      });
    }
    if (wants('flyInAfter')) {
      await session({ arrive: 'after' }, async (page, browser) => {
        await drawShape(page, GROUP.at, GROUP.rx, GROUP.ry, false);
        reading.flyInAfter = await traced(browser, page, async () => {
          await page.mouse.up();
          await stateIs(page, S.flown, 'gte', 1);
          await stateIs(page, S.slide, 'eq', 1);
        });
      });
    }
    for (const rate of ['2', '60']) {
      if (!wants(`live${rate}`)) continue;
      await session({ live: rate }, async (page, browser) => {
        await openPanel(page);
        await page.mouse.move(AT.table.x, AT.table.y);
        await page.waitForTimeout(500);
        reading[`live${rate}`] = await traced(browser, page, () => page.waitForTimeout(SEGMENT_MS));
      });
    }
    runs.push(reading);
    console.log(`run ${run + 1}: ${Object.entries(reading).map(([name, r]) => `${name} ${r.seconds.toFixed(1)} s, p50 ${r.intervals.p50.toFixed(1)} p95 ${r.intervals.p95.toFixed(1)} max ${r.intervals.max.toFixed(0)} ms, late ${(r.late.share * 100).toFixed(0)}%, work p50 ${r.work.p50.toFixed(1)}`).join('; ')}`);
  }
  const summary = summarize(runs);
  console.table(summary);
  return { params: PARAMS, runs: RUNS, pickMs: picks.length ? Number(median(picks).toFixed(1)) : undefined, summary, raw: runs };
}

if (!flag('no-build')) await buildAll();
mkdirSync(out, { recursive: true });
const result: Record<string, unknown> = { ...machineInfo() };
if (only.includes('bytes') && !flag('serve')) result.bytes = bytes();
const server = await serveApp(undefined, { webDir: dir, port: PORT });
if (flag('serve')) {
  console.log(`Serving the spike at ${server.url} until interrupted. Knobs: ?arrive=after, ?slide=<ms>, ?live=<refreshes a second>, ?decimals=<n>, ?scale=<0..1>`);
  await new Promise(() => {});
}
try {
  if (only.includes('shots')) result.shots = await shots(server.url);
  if (only.includes('input')) result.input = await input(server.url);
  if (only.includes('frames')) result.frames = await frames(server.url);
  if (only.includes('moves')) result.moves = await moves(server.url);
  if (only.includes('moveframes')) result.moveFrames = await moveFrames(server.url);
} finally {
  await server.close();
}
writeFileSync(join(out, `run-${only.join('-')}${SUFFIX}${option('params') ? `-${option('params')!.replaceAll(',', '-')}` : ''}.json`), `${JSON.stringify(result, null, 2)}\n`);
