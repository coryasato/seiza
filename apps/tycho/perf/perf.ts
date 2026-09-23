// Cold-load perf suite, following the repo's measurement protocol: Playwright
// Chromium in headless=new mode, a new browser per run (cold cache),
// 1440×900 at DPR 2, median of 10. The reference run is unthrottled. The
// throttled run adds CPU 4× and "Fast 4G". Budgets apply to the reference run.
//
// Every run also checks the perf overlay against the page (`?perf`): its TTFP
// must match the `gpui:first-frame` mark within 5 ms, and the mark must land
// right after the first GPU work GPUI issued (see `probe` below).
//
// Each run then waits for DuckDB (M2): the overlay's "Engine ready" must match
// the `tycho:engine-ready` mark within 5 ms, and no request outside the
// first-paint set (the document, entry JS, app wasm, and UI font) may start
// before the first-frame mark. Engine requests from the main thread come from
// Resource Timing (the same clock as the marks); the worker's own requests
// (DuckDB's wasm) come from Playwright's network events.
//
// Usage: node apps/tycho/perf/perf.ts [--url <url>] [--runs 10] [--label <name>]
//                                     [--reference-only] [--check] [--write-baseline]
//                                     [--trace]
// --trace adds one uncounted run per profile that saves a Playwright trace
// (network waterfall included) to perf/results/raw/ (gitignored).
// With no --url it starts `vite preview` on the release build in web/dist
// (brotli, like production). --check applies the budgets in perf/baseline.json
// and exits non-zero on a regression. --write-baseline records this run as the
// new baseline.

import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { arch, cpus, release, type } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type CDPSession, type Request } from '@playwright/test';
import { preview } from 'vite';
import { brotli } from '../../../shared-web/src/brotli.ts';

const FIRST_FRAME_MARK = 'gpui:first-frame';
// Set by web/src/engine.ts.
const ENGINE_START_MARK = 'tycho:engine-start';
const ENGINE_READY_MARK = 'tycho:engine-ready';
/** What first paint may wait on; any other request must start after the
 *  first-frame mark. Matched against the URL's path. */
const FIRST_PAINT_REQUESTS = [/^\/(\?.*)?$/, /^\/assets\/index-[\w-]+\.js$/, /^\/assets\/tycho_bg-[\w-]+\.wasm$/, /^\/assets\/IBMPlexSans-Regular-[\w-]+\.ttf$/];
const perfDir = dirname(fileURLToPath(import.meta.url));
const webDir = join(perfDir, '../web');
const baselinePath = join(perfDir, 'baseline.json');
const notesPath = join(perfDir, 'budget-notes.md');
const TTFP_BUDGET = 0.1;
const WASM_BUDGET = 0.15;
const OVERLAY_TOLERANCE_MS = 5;

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}
function option(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index > 0 ? process.argv[index + 1] : undefined;
}

const runs = Number(option('runs') ?? 10);
const label = option('label') ?? 'cold-load';
const check = flag('check');

/** Chrome DevTools' "Fast 4G" preset (throughput in bytes/s, latency in ms). */
const FAST_4G = { download: (9_000_000 / 8) * 0.9, upload: (1_500_000 / 8) * 0.9, latency: 60 * 2.75 };

interface Profile {
  name: 'reference' | 'throttled';
  cpuSlowdown: number;
  network: typeof FAST_4G | null;
}
const PROFILES: Profile[] = [
  { name: 'reference', cpuSlowdown: 1, network: null },
  { name: 'throttled', cpuSlowdown: 4, network: FAST_4G },
];

/**
 * Runs before any page script.
 *
 * 1. DPR shim. Headless Chromium under `deviceScaleFactor: 2` reports
 *    `devicePixelRatio` 2 but a `device-pixel-content-box` in CSS pixels, so
 *    GPUI would draw 2× layout into a 1× backing store. Hiding
 *    `devicePixelContentBoxSize` sends gpui-pre-web down its Safari path
 *    (`contentRect × devicePixelRatio`), which gives a consistent 2× backing
 *    store. Real browsers don't need it. See perf/results/2026-09-23-m0.md.
 * 2. First-draw probe, an independent check of the first-frame mark. It
 *    records the first GPU work (a WebGL2 draw call or a WebGPU queue
 *    submit), and for every task that did GPU work, its last GPU call and the
 *    end of its microtask checkpoint (a microtask queued at its first GPU
 *    call), in any callback: GPUI's first real draw can run in a
 *    ResizeObserver callback, not only in a rAF. The mark is honest if it
 *    lands inside one of those windows, after that task's last GPU call and
 *    before its checkpoint ends, meaning the task that rendered the first
 *    real frame also presented it. With WebGPU, GPUI first presents an
 *    empty frame at 0×0 in the same callback, so the mark trails the first
 *    GPU work by that callback's render time, not by a frame. If gpui-kit
 *    changes when it presents, this catches it.
 */
function probe(): void {
  delete (ResizeObserverEntry.prototype as { devicePixelContentBoxSize?: unknown }).devicePixelContentBoxSize;

  type GpuTask = { lastGpuCall: number; end: number | null };
  const state = { firstGpuWork: null as number | null, gpuTasks: [] as GpuTask[], api: '', current: null as GpuTask | null };
  (globalThis as { __seizaProbe?: typeof state }).__seizaProbe = state;
  const hook = (proto: object | undefined, names: string[], api: string) => {
    if (!proto) return;
    const methods = proto as Record<string, (...args: unknown[]) => unknown>;
    for (const name of names) {
      const original = methods[name];
      if (!original) continue;
      methods[name] = function (this: unknown, ...args: unknown[]) {
        if (state.firstGpuWork === null) {
          state.firstGpuWork = performance.now();
          state.api = api;
        }
        if (!state.current && state.gpuTasks.length < 50) {
          const task: GpuTask = { lastGpuCall: 0, end: null };
          state.current = task;
          state.gpuTasks.push(task);
          queueMicrotask(() => {
            task.end = performance.now();
            state.current = null;
          });
        }
        const result = original.apply(this, args);
        if (state.current) state.current.lastGpuCall = performance.now();
        return result;
      };
    }
  };
  hook(globalThis.WebGL2RenderingContext?.prototype, ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced'], 'webgl2');
  hook((globalThis as { GPUQueue?: { prototype: object } }).GPUQueue?.prototype, ['submit'], 'webgpu');
}

interface EngineLoad {
  startMs: number | null;
  readyMs: number | null;
  overlayReadyMs: number | null;
  /** The earliest request outside the first-paint set. */
  firstRequest: { url: string; startMs: number } | null;
  /** Requests outside the first-paint set that started before the mark. */
  beforeFirstFrame: string[];
  /** Every request outside the first-paint set, in start order. */
  requests: { url: string; startMs: number | null; from: 'page' | 'network' }[];
}

interface Run {
  ttfpMs: number;
  overlayTtfpMs: number | null;
  engine: EngineLoad;
  firstGpuWorkMs: number | null;
  /** The GPU task whose window (last GPU call → checkpoint end) holds the
   *  mark, or null when none does. */
  presentingTask: { lastGpuCallMs: number; endMs: number } | null;
  gpuTaskCount: number;
  /** Which API drew the first frame: `webgl2` or `webgpu`. */
  api: string;
  backing: string;
  consoleProblems: string[];
}

const isFirstPaintRequest = (url: string) => {
  const { pathname, search } = new URL(url);
  return FIRST_PAINT_REQUESTS.some((pattern) => pattern.test(pathname === '/' ? `/${search}` : pathname));
};

/** Reads an overlay row's value as a number of ms, once it has one. */
async function overlayMs(page: import('@playwright/test').Page, row: string, timeout: number): Promise<number | null> {
  return page
    .waitForFunction(
      (row) => {
        const rows = (globalThis as { __seizaPerfOverlay?: [string, string][] }).__seizaPerfOverlay;
        const value = rows?.find(([name]) => name === row)?.[1];
        return value && /^\d/.test(value) ? value : false;
      },
      row,
      { timeout, polling: 50 },
    )
    .then(async (handle) => Number.parseFloat((await handle.jsonValue()) as string))
    .catch(() => null);
}

async function measure(url: string, profile: Profile, tracePath: string | null): Promise<Run> {
  // A new browser per run: empty HTTP cache and no compiled-wasm cache.
  const browser = await chromium.launch({ channel: 'chromium' });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
    if (tracePath) await context.tracing.start({ snapshots: true, screenshots: false });
    await context.addInitScript(probe);
    const page = await context.newPage();
    const consoleProblems: string[] = [];
    page.on('console', (message) => {
      // GPUI's own `[WARN]` logs describe the GPU (no dual-source blending on
      // WebGL2, and so on), not a broken page. Browser warnings still count.
      const text = message.text();
      if (message.type() === 'error' || (message.type() === 'warning' && !text.startsWith('[WARN]'))) {
        consoleProblems.push(text);
      }
    });
    page.on('response', async (response) => {
      if (response.status() >= 400) consoleProblems.push(`${response.status()} ${response.url()}`);
      // Production serves the wasm compressed; a run that downloaded it raw
      // measured the wrong thing.
      if (response.url().endsWith('.wasm') && (await response.headerValue('content-encoding')) !== 'br') {
        consoleProblems.push(`wasm served without brotli: ${response.url()}`);
      }
    });
    page.on('pageerror', (error) => consoleProblems.push(`pageerror: ${error.message}`));
    // Every request Playwright saw, failed ones included, with a wall-clock
    // start. Worker requests (DuckDB's wasm) aren't in the page's Resource
    // Timing. The start is first when Playwright reported the request (an
    // upper bound, a few ms late at most), then the browser's own start time
    // once it finishes. Failed requests have no browser start time.
    const networkRequests = new Map<Request, { url: string; wallMs: number; failed: boolean }>();
    page.on('request', (request) => networkRequests.set(request, { url: request.url(), wallMs: Date.now(), failed: false }));
    page.on('requestfinished', (request) => {
      const entry = networkRequests.get(request);
      const start = request.timing().startTime;
      if (entry && start > 0) entry.wallMs = start;
    });
    page.on('requestfailed', (request) => {
      const entry = networkRequests.get(request);
      if (entry) entry.failed = true;
      consoleProblems.push(`request failed: ${request.url()} (${request.failure()?.errorText ?? 'unknown'})`);
    });

    const cdp: CDPSession = await context.newCDPSession(page);
    if (profile.cpuSlowdown > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: profile.cpuSlowdown });
    if (profile.network) {
      await cdp.send('Network.enable');
      await cdp.send('Network.emulateNetworkConditions', {
        offline: false,
        latency: profile.network.latency,
        downloadThroughput: profile.network.download,
        uploadThroughput: profile.network.upload,
      });
    }

    const target = new URL(url);
    target.searchParams.set('perf', '');
    await page.goto(target.toString());
    const ttfpMs = (await page
      .waitForFunction((mark) => performance.getEntriesByName(mark, 'mark')[0]?.startTime ?? false, FIRST_FRAME_MARK, {
        timeout: 120_000,
        polling: 50,
      })
      .then((handle) => handle.jsonValue())) as number;

    // The overlay learns TTFP one frame after the mark; wait for it to draw it.
    const overlayTtfpMs = await overlayMs(page, 'TTFP', 10_000);

    // DuckDB loads after first paint; wait for it, then read the waterfall.
    const readyMs = (await page
      .waitForFunction((mark) => performance.getEntriesByName(mark, 'mark')[0]?.startTime ?? false, ENGINE_READY_MARK, {
        timeout: 120_000,
        polling: 50,
      })
      .then((handle) => handle.jsonValue())
      .catch(() => null)) as number | null;
    const overlayReadyMs = await overlayMs(page, 'Engine ready', 10_000);
    const timeline = await page.evaluate((mark) => {
      const resources = performance
        .getEntriesByType('resource')
        .map((entry) => ({ url: entry.name, startMs: entry.startTime }));
      return {
        timeOrigin: performance.timeOrigin,
        startMs: performance.getEntriesByName(mark, 'mark')[0]?.startTime ?? null,
        resources,
      };
    }, ENGINE_START_MARK);
    const requests: EngineLoad['requests'] = [
      ...timeline.resources.map((r) => ({ url: r.url, startMs: r.startMs as number | null, from: 'page' as const })),
      ...[...networkRequests.values()]
        .filter((r) => !timeline.resources.some((resource) => resource.url === r.url) && !/^(data|blob):/.test(r.url))
        .map((r) => ({
        url: r.url,
        startMs: r.wallMs > 0 ? r.wallMs - timeline.timeOrigin : null,
        from: 'network' as const,
      })),
    ]
      .filter((r) => !isFirstPaintRequest(r.url))
      .sort((a, b) => (a.startMs ?? Infinity) - (b.startMs ?? Infinity));
    const first = requests.find((r) => r.startMs !== null);
    const engine: EngineLoad = {
      startMs: timeline.startMs,
      readyMs,
      overlayReadyMs,
      firstRequest: first && first.startMs !== null ? { url: new URL(first.url).pathname, startMs: first.startMs } : null,
      beforeFirstFrame: requests
        .filter((r) => r.startMs !== null && r.startMs < ttfpMs)
        .map((r) => `${new URL(r.url).pathname} at ${r.startMs!.toFixed(1)} ms`),
      requests: requests.map((r) => ({ ...r, url: new URL(r.url).pathname, startMs: r.startMs === null ? null : Number(r.startMs.toFixed(1)) })),
    };
    if (tracePath) await context.tracing.stop({ path: tracePath });

    const { firstGpuWorkMs, gpuTasks, api, backing } = await page.evaluate(() => {
      const canvas = document.querySelector('canvas');
      const state = (
        globalThis as {
          __seizaProbe?: { firstGpuWork: number | null; gpuTasks: { lastGpuCall: number; end: number | null }[]; api: string };
        }
      ).__seizaProbe;
      return {
        firstGpuWorkMs: state?.firstGpuWork ?? null,
        gpuTasks: state?.gpuTasks ?? [],
        api: state?.api ?? '',
        backing: canvas ? `${canvas.width}x${canvas.height}` : 'none',
      };
    });
    return {
      ttfpMs,
      overlayTtfpMs,
      engine,
      firstGpuWorkMs,
      presentingTask:
        gpuTasks
          .filter((task) => task.end !== null && task.lastGpuCall <= ttfpMs && ttfpMs <= task.end)
          .map((task) => ({ lastGpuCallMs: task.lastGpuCall, endMs: task.end! }))[0] ?? null,
      gpuTaskCount: gpuTasks.length,
      api,
      backing,
      consoleProblems,
    };
  } finally {
    await browser.close();
  }
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Problems with one run: the overlay disagrees with the mark, the mark
 *  landed before anything was drawn, the canvas isn't at DPR 2, or the page
 *  logged errors or warnings (instantiateStreaming falling back, a preload
 *  that went unused). */
function runProblems(run: Run): string[] {
  const problems: string[] = [];
  if (run.overlayTtfpMs === null) problems.push('overlay never showed TTFP');
  else if (Math.abs(run.overlayTtfpMs - run.ttfpMs) > OVERLAY_TOLERANCE_MS)
    problems.push(`overlay TTFP ${run.overlayTtfpMs} ms vs mark ${run.ttfpMs.toFixed(1)} ms`);
  if (run.firstGpuWorkMs === null) problems.push('no GPU work recorded');
  else if (run.ttfpMs < run.firstGpuWorkMs)
    problems.push(`mark ${run.ttfpMs.toFixed(1)} ms landed before the first GPU work (${run.firstGpuWorkMs.toFixed(1)} ms)`);
  else if (run.presentingTask === null)
    problems.push(`mark ${run.ttfpMs.toFixed(1)} ms isn't right after any of the ${run.gpuTaskCount} tasks that did GPU work`);
  if (run.backing !== '2880x1800') problems.push(`backing store ${run.backing}, expected 2880x1800`);
  const { engine } = run;
  if (engine.readyMs === null) problems.push('engine never became ready');
  else if (engine.overlayReadyMs === null) problems.push('overlay never showed Engine ready');
  else if (Math.abs(engine.overlayReadyMs - engine.readyMs) > OVERLAY_TOLERANCE_MS)
    problems.push(`overlay Engine ready ${engine.overlayReadyMs} ms vs mark ${engine.readyMs.toFixed(1)} ms`);
  if (engine.startMs !== null && engine.startMs < run.ttfpMs)
    problems.push(`engine load started at ${engine.startMs.toFixed(1)} ms, before first frame ${run.ttfpMs.toFixed(1)} ms`);
  if (engine.firstRequest === null) problems.push('no engine requests recorded');
  problems.push(...engine.beforeFirstFrame.map((request) => `request before first frame: ${request}`));
  problems.push(...run.consoleProblems.map((text) => `console: ${text}`));
  return problems;
}

function wasmBrotliKiB(): number {
  const assets = join(webDir, 'dist/assets');
  // The app's wasm, not DuckDB's (which loads after first paint).
  const wasm = readdirSync(assets).find((name) => name.startsWith('tycho_bg') && name.endsWith('.wasm'));
  if (!wasm) throw new Error(`no .wasm in ${assets}; run \`just tycho build\` first`);
  return brotli(readFileSync(join(assets, wasm))).length / 1024;
}

interface Baseline {
  date: string;
  machine: string;
  /** Hardware and OS the TTFP was measured on. `--check` only compares TTFP
   *  when these and `machine` match this run. */
  cpu: string;
  os: string;
  ttfpMs: { reference: number; throttled: number };
  wasmBrotliKiB: number;
}

/** The largest wasm size perf/budget-notes.md accepts. Each note is a table
 *  row: `| YYYY-MM-DD | accepted KiB | … |`. Only notes dated on or after the
 *  baseline count, so rewriting the baseline retires older acceptances. */
function acceptedWasmKiB(since: string): number {
  let text = '';
  try {
    text = readFileSync(notesPath, 'utf8');
  } catch {
    return 0;
  }
  const sizes = text
    .split('\n')
    .map((line) => line.split('|').map((cell) => cell.trim()))
    .filter((cells) => /^\d{4}-\d{2}-\d{2}$/.test(cells[1] ?? '') && cells[1]! >= since)
    .map((cells) => Number.parseFloat(cells[2] ?? ''))
    .filter((size) => Number.isFinite(size));
  return Math.max(0, ...sizes);
}

function toolVersions(): Record<string, string> {
  const run = (command: string, args: string[]) => {
    try {
      return execFileSync(command, args, { encoding: 'utf8' }).trim();
    } catch {
      return 'unknown';
    }
  };
  return { rustc: run('rustc', ['--version']), wasmOpt: run('wasm-opt', ['--version']), node: process.version };
}

// --- main ---

let url = option('url');
const server = url ? null : await preview({ root: webDir, preview: { port: 4174, strictPort: true }, logLevel: 'warn' });
url ??= 'http://localhost:4174/';

const profiles = check || flag('reference-only') ? PROFILES.slice(0, 1) : PROFILES;
// A label, not the hostname: results are committed to a public repo. Set
// SEIZA_MACHINE to tell machines apart (e.g. "ci-m1"); the CPU model is
// recorded separately.
const machine = process.env.SEIZA_MACHINE ?? 'local';
const cpu = cpus()[0]?.model ?? 'unknown';
const os = `${type()} ${release()} ${arch()}`;
const browserVersion = await chromium.launch({ channel: 'chromium' }).then(async (browser) => {
  const version = browser.version();
  await browser.close();
  return version;
});

const results: Record<string, { runs: Run[]; medianTtfpMs: number; medianEngineReadyMs: number | null; problems: string[] }> = {};
try {
  for (const profile of profiles) {
    const profileRuns: Run[] = [];
    if (flag('trace')) {
      // An extra run, not counted: tracing (with snapshots, which network
      // capture needs) slows the page it records.
      const tracePath = join(perfDir, 'results/raw', `${label}-${profile.name}-trace.zip`);
      mkdirSync(dirname(tracePath), { recursive: true });
      await measure(url, profile, tracePath);
      console.log(`${profile.name} trace run (not counted) → ${tracePath}`);
    }
    for (let i = 0; i < runs; i++) {
      const run = await measure(url, profile, null);
      profileRuns.push(run);
      const problems = runProblems(run);
      console.log(
        `${profile.name} ${String(i + 1).padStart(2)}/${runs}  TTFP ${run.ttfpMs.toFixed(1)} ms  ` +
          `overlay ${run.overlayTtfpMs ?? '—'}  engine ready ${run.engine.readyMs?.toFixed(0) ?? '—'} ms (first request +${run.engine.firstRequest ? (run.engine.firstRequest.startMs - run.ttfpMs).toFixed(1) : '—'} ms after mark)  first GPU work (${run.api || '?'}) ${run.firstGpuWorkMs?.toFixed(1) ?? '—'} ms  presenting task ${run.presentingTask ? `${run.presentingTask.lastGpuCallMs.toFixed(1)}–${run.presentingTask.endMs.toFixed(1)}` : '—'} ms` +
          (problems.length ? `  PROBLEMS: ${problems.join('; ')}` : ''),
      );
    }
    results[profile.name] = {
      runs: profileRuns,
      medianTtfpMs: median(profileRuns.map((run) => run.ttfpMs)),
      medianEngineReadyMs: profileRuns.every((run) => run.engine.readyMs !== null)
        ? median(profileRuns.map((run) => run.engine.readyMs!))
        : null,
      problems: profileRuns.flatMap(runProblems),
    };
  }
} finally {
  await server?.close();
}

const wasmKiB = wasmBrotliKiB();
const date = new Date().toISOString().slice(0, 10);
const summary = {
  date,
  label,
  machine,
  cpu,
  os,
  browser: `Chromium ${browserVersion} (headless=new)`,
  tools: toolVersions(),
  url,
  protocol: { viewport: '1440x900', deviceScaleFactor: 2, runs, throttled: { cpuSlowdown: 4, network: 'Fast 4G', ...FAST_4G } },
  wasmBrotliKiB: Number(wasmKiB.toFixed(1)),
  ttfpMs: Object.fromEntries(Object.entries(results).map(([name, r]) => [name, Number(r.medianTtfpMs.toFixed(1))])),
  engineReadyMs: Object.fromEntries(
    Object.entries(results).map(([name, r]) => [name, r.medianEngineReadyMs === null ? null : Number(r.medianEngineReadyMs.toFixed(1))]),
  ),
  runs: Object.fromEntries(Object.entries(results).map(([name, r]) => [name, r.runs])),
};

console.log(`\nwasm brotli ${wasmKiB.toFixed(1)} KiB`);
for (const [name, r] of Object.entries(results)) {
  const ttfps = r.runs.map((run) => run.ttfpMs);
  console.log(
    `${name}: median TTFP ${r.medianTtfpMs.toFixed(1)} ms (min ${Math.min(...ttfps).toFixed(1)}, max ${Math.max(...ttfps).toFixed(1)}, n=${ttfps.length}); ` +
      `median engine ready ${r.medianEngineReadyMs?.toFixed(1) ?? '—'} ms`,
  );
}
try {
  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8')) as Baseline;
  for (const [name, r] of Object.entries(results)) {
    const base = baseline.ttfpMs[name as keyof Baseline['ttfpMs']];
    console.log(`${name}: ${(((r.medianTtfpMs - base) / base) * 100).toFixed(1)}% vs baseline ${base} ms (${baseline.date})`);
  }
} catch {
  // No baseline yet.
}

if (!check) {
  const out = join(perfDir, 'results', `${date}-${label}.json`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`wrote ${out}`);
}

if (flag('write-baseline')) {
  const reference = results.reference?.medianTtfpMs;
  const throttled = results.throttled?.medianTtfpMs;
  if (reference === undefined || throttled === undefined) throw new Error('--write-baseline needs both profiles');
  const baseline: Baseline = {
    date,
    machine,
    cpu,
    os,
    ttfpMs: { reference: Number(reference.toFixed(1)), throttled: Number(throttled.toFixed(1)) },
    wasmBrotliKiB: Number(wasmKiB.toFixed(1)),
  };
  writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
  console.log(`wrote ${baselinePath}`);
}

const failures = Object.values(results).flatMap((r) => r.problems);
if (check) {
  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8')) as Baseline;
  const reference = results.reference!.medianTtfpMs;
  const ttfpLimit = baseline.ttfpMs.reference * (1 + TTFP_BUDGET);
  const wasmLimit = Math.max(baseline.wasmBrotliKiB * (1 + WASM_BUDGET), acceptedWasmKiB(baseline.date));
  // TTFP from different hardware isn't comparable: say so and skip that
  // budget rather than pass or fail on the hardware difference.
  const sameMachine = machine === baseline.machine && cpu === baseline.cpu && os === baseline.os;
  if (!sameMachine) {
    console.warn(
      `warning: baseline was measured on "${baseline.machine}" (${baseline.cpu}, ${baseline.os}), ` +
        `this is "${machine}" (${cpu}, ${os}). Skipping the TTFP budget; record a baseline for this machine ` +
        `with --write-baseline (and SEIZA_MACHINE) to enforce it here.`,
    );
  }
  console.log(
    `budget: TTFP ${reference.toFixed(1)} ms vs limit ${ttfpLimit.toFixed(1)} ms (baseline ${baseline.ttfpMs.reference} + 10%); ` +
      `wasm ${wasmKiB.toFixed(1)} KiB vs limit ${wasmLimit.toFixed(1)} KiB`,
  );
  if (sameMachine && reference > ttfpLimit) failures.push(`reference TTFP ${reference.toFixed(1)} ms is over ${ttfpLimit.toFixed(1)} ms`);
  if (wasmKiB > wasmLimit) {
    failures.push(
      `wasm brotli ${wasmKiB.toFixed(1)} KiB is over ${wasmLimit.toFixed(1)} KiB; add a row to perf/budget-notes.md to accept it`,
    );
  }
}

if (failures.length > 0) {
  console.error(`\nFAIL\n${[...new Set(failures)].map((failure) => `  ${failure}`).join('\n')}`);
  process.exit(1);
}
console.log('\nPASS');
