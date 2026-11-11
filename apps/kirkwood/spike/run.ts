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
//
// Usage: node apps/kirkwood/spike/run.ts [--only shots,input,frames,bytes] [--runs 3] [--no-build]
//          [--browser firefox|webkit] [--params size=1,scale=0.5] [--segments running,rest]
// Needs public/elements.bin (data.ts). Writes out/ (gitignored).
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { brotliCompressSync, constants } from 'node:zlib';
import { chromium, firefox, webkit, type Browser, type Page } from '@playwright/test';
import { build } from 'vite';
import { frameIntervals, frameRecorder, gesture, open, recordedBetween, waitMark, wheel, workBetween, workRecorder } from '../../../shared-web/perf/harness.ts';
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

type Kirkwood = { state(): number[]; alpha: boolean; scene?: { stats: { frames: number; draws: [number, number][]; rows: number; renderer: string; distance: number } } };

interface State {
  panel: boolean;
  shapePoints: number;
  shapeClosed: boolean;
  top: number;
  selected: number;
  tooltip: boolean;
  sceneFrames: number;
  distance: number;
}
async function state(page: Page): Promise<State> {
  return page.evaluate(() => {
    const k = (globalThis as unknown as { __kirkwood: Kirkwood }).__kirkwood;
    const s = k.state();
    return { panel: s[0] === 1, shapePoints: s[1]!, shapeClosed: s[2] === 1, top: s[3]!, selected: s[4]!, tooltip: s[6] === 1, sceneFrames: k.scene?.stats.frames ?? 0, distance: k.scene?.stats.distance ?? 0 };
  });
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
  const browsing = await open(init.length ? chromium : ENGINE, url, { params, init });
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
  const png = await page.screenshot({ scale: 'css' });
  writeFileSync(join(out, `${name}${SUFFIX}.png`), png);
  return page.evaluate(
    async ({ data, region }) => {
      const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${data}`)).blob());
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext('2d')!;
      context.drawImage(bitmap, 0, 0);
      const { data: pixels } = context.getImageData(region.x, region.y, region.width, region.height);
      let lit = 0;
      for (let at = 0; at < pixels.length; at += 4) if (pixels[at]! > 24 || pixels[at + 1]! > 24 || pixels[at + 2]! > 24) lit++;
      return lit / (pixels.length / 4);
    },
    { data: png.toString('base64'), region },
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
    await page.mouse.click(AT.handle.x, AT.handle.y);
    await page.waitForFunction(() => (globalThis as unknown as { __kirkwood: Kirkwood }).__kirkwood.state()[0] === 1);
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

    await page.mouse.click(AT.handle.x, AT.handle.y);
    await page.waitForFunction(() => (globalThis as unknown as { __kirkwood: Kirkwood }).__kirkwood.state()[5]! > 0);
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
    await page.mouse.down();
    for (let step = 1; step <= 48; step++) {
      const turn = (step / 48) * 2 * Math.PI;
      await page.mouse.move(420 + 130 * Math.cos(turn + Math.PI), 320 + 110 * Math.sin(turn + Math.PI));
    }
    await page.waitForTimeout(100);
    const held = await state(page);
    await page.waitForTimeout(400);
    const heldLater = await state(page);
    await shot(page, 'shape-drawing');
    await page.mouse.up();
    await page.waitForTimeout(300);
    after = await state(page);
    await shot(page, 'shape');
    results.push(check('a drag on the scene draws a freehand shape', held.shapePoints >= 40 && !held.shapeClosed && after.shapeClosed, `${after.shapePoints} points, closed at the release`));
    results.push(check('time holds while it is drawn', stillRunning.sceneFrames > running.sceneFrames && heldLater.sceneFrames === held.sceneFrames && (await page.waitForTimeout(300), (await state(page)).sceneFrames > after.sceneFrames), `scene frames: ${running.sceneFrames} → ${stillRunning.sceneFrames} before; ${held.sceneFrames} → ${heldLater.sceneFrames} over 400 ms of the drag; moving again after`));

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
      await page.mouse.click(AT.handle.x, AT.handle.y);
      await page.waitForFunction(() => (globalThis as unknown as { __kirkwood: Kirkwood }).__kirkwood.state()[5]! > 0);
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
      workFrames: of((r) => r.work.n),
      busyShare: of((r) => r.busyShare),
      sceneDraws: of((r) => r.scene.n),
      sceneRenderP50: of((r) => r.scene.p50),
      sceneRenderP95: of((r) => r.scene.p95),
      drewCallbacks: of((r) => r.drew),
      seconds: of((r) => r.seconds),
    };
  }
  console.table(summary);
  return { renderer, params: PARAMS, runs: RUNS, summary, raw: runs };
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

if (!flag('no-build')) await buildAll();
mkdirSync(out, { recursive: true });
const result: Record<string, unknown> = { ...machineInfo() };
if (only.includes('bytes')) result.bytes = bytes();
const server = await serveApp(undefined, { webDir: dir, port: PORT });
try {
  if (only.includes('shots')) result.shots = await shots(server.url);
  if (only.includes('input')) result.input = await input(server.url);
  if (only.includes('frames')) result.frames = await frames(server.url);
} finally {
  await server.close();
}
writeFileSync(join(out, `run-${only.join('-')}${SUFFIX}${option('params') ? `-${option('params')!.replaceAll(',', '-')}` : ''}.json`), `${JSON.stringify(result, null, 2)}\n`);
