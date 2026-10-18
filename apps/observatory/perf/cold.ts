// Cold load of the GPUI contender, under the measurement protocol: Playwright
// Chromium headless=new, a new browser per run (cold cache), 1440×900 at
// DPR 2, median of 10; the reference run unthrottled, the throttled run CPU
// 4× and "Fast 4G". Budgets apply to the reference run (root CLAUDE.md, rule
// 1): this gates the contender's own build; the comparison's headline is
// per-use cost, measured elsewhere.
//
// Every run also checks:
// - TTFP's mark (`gpui:first-frame`) lands right after the task that drew
//   and presented the first frame (shared-web/perf/'s `firstDrawProbe`), and
//   `contender:usable` is at its moment;
// - the placeholder painted before the first frame, `contender:first-pixels`
//   is at its paint, it was released inside the presenting task, and it's
//   gone by the end;
// - the engine starts after the first frame, and no request outside the
//   first-paint set (the page, its entry JS, the contender's wasm, the UI
//   font) starts before it;
// - the canvas is at DPR 2, and the page logged no errors or warnings.
//
// Usage: node apps/observatory/perf/cold.ts [--runs 10] [--label <name>]
//                                           [--reference-only] [--check] [--write-baseline]
// --check (reference only, nothing written): fails if reference TTFP is over
// perf/baseline.json's by more than limits.gpui.ttfpOverBaseline, or the
// wasm (brotli) by more than limits.gpui.wasmOverBaseline. --write-baseline
// records this run (both profiles) as the baseline.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Request } from '@playwright/test';
import { brotli } from '../../../shared-web/src/brotli.ts';
import { firstDrawProbe, waitMark, type FirstDrawProbe } from '../../../shared-web/perf/harness.ts';
import { FAST_4G, PROFILES, flag, machineInfo, median, option, throttle, type Profile } from '../../../shared-web/perf/protocol.ts';
import { MARKS, budgetLimits, gpuiWebDir, lastMark, perfDir, problems, protocolContext, serveGpui } from './harness.ts';

const { ttfpOverBaseline, wasmOverBaseline } = budgetLimits(new URL('./budgets.json', import.meta.url))('gpui', ['ttfpOverBaseline', 'wasmOverBaseline']);
const runs = Number(option('runs') ?? 10);
const label = option('label') ?? 'gpui-cold';
const check = flag('check');
const baselinePath = join(perfDir, 'baseline.json');
const PORT = 4311;
/** What first paint may wait on, by path. */
const FIRST_PAINT = [/^\/observatory\/$/, /^\/observatory\/assets\/index-[\w-]+\.js$/, /^\/observatory\/assets\/tall_table_gpui_bg-[\w-]+\.wasm$/, /^\/observatory\/assets\/IBMPlexSans-Regular-[\w-]+\.ttf$/];

interface Run {
  ttfpMs: number;
  wasmReadyMs: number | null;
  placeholderMs: number | null;
  firstPixelsMs: number | null;
  usableMs: number | null;
  engineStartMs: number | null;
  engineReadyMs: number | null;
  api: string;
  backing: string;
  problems: string[];
}

async function measure(url: string, profile: Profile): Promise<Run> {
  const browser = await chromium.launch({ channel: 'chromium' });
  try {
    const context = await protocolContext(browser, { init: [firstDrawProbe] });
    const page = await context.newPage();
    const found = problems(page);
    // Wall-clock starts of every request Playwright saw (the worker's
    // aren't in the page's Resource Timing), the browser's own once done.
    const requests = new Map<Request, { url: string; wallMs: number }>();
    page.on('request', (request) => requests.set(request, { url: request.url(), wallMs: Date.now() }));
    page.on('requestfinished', (request) => {
      const entry = requests.get(request);
      const start = request.timing().startTime;
      if (entry && start > 0) entry.wallMs = start;
    });
    page.on('response', async (response) => {
      if (GPUI_WASM_PATH.test(new URL(response.url()).pathname) && (await response.headerValue('content-encoding')) !== 'br') found.push(`wasm not served as br: ${response.url()}`);
    });
    await throttle(context, page, profile);
    await page.goto(url);
    const lastMarkOnce = (name: string) =>
      page
        .waitForFunction((name) => performance.getEntriesByName(name, 'mark').at(-1)?.startTime ?? false, name, { timeout: 120_000, polling: 50 })
        .then(async (handle) => (await handle.jsonValue()) as number);
    const ttfpMs = await lastMarkOnce(MARKS.firstFrame);
    const engineReadyMs = await lastMarkOnce(MARKS.engineReady).catch(() => null);
    // `usable` and `first-pixels` are set by an observer, a task or more
    // later: wait for them (a missing one is reported below).
    await waitMark(page, MARKS.usable, 0, 10_000).catch(() => null);
    if ((await lastMark(page, MARKS.placeholder)) !== null) await waitMark(page, MARKS.firstPixels, 0, 10_000).catch(() => null);
    const wasmReadyMs = await lastMark(page, MARKS.wasmReady);
    const placeholderMs = await lastMark(page, MARKS.placeholder);
    const firstPixelsMs = await lastMark(page, MARKS.firstPixels);
    const usableMs = await lastMark(page, MARKS.usable);
    const engineStartMs = await lastMark(page, MARKS.engineStart);
    // The placeholder fades out over 120 ms after the first frame.
    await page.waitForFunction(() => !document.getElementById('seiza-placeholder'), null, { timeout: 5_000 }).catch(() => {});
    const { probe, backing, timeOrigin, gone } = await page.evaluate(() => ({
      probe: (globalThis as { __seizaProbe?: FirstDrawProbe }).__seizaProbe ?? null,
      backing: (() => {
        const canvas = document.querySelector('canvas');
        return canvas ? `${canvas.width}x${canvas.height}` : 'none';
      })(),
      timeOrigin: performance.timeOrigin,
      gone: !document.getElementById('seiza-placeholder'),
    }));

    const fail = (problem: string) => found.push(problem);
    const presenting = probe?.gpuTasks.find((task) => task.end !== null && task.lastGpuCall <= ttfpMs && ttfpMs <= task.end);
    if (!probe || probe.firstGpuWork === null) fail('no GPU work recorded');
    else if (ttfpMs < probe.firstGpuWork) fail(`first-frame mark ${ttfpMs.toFixed(1)} ms is before the first GPU work`);
    else if (!presenting) fail(`first-frame mark ${ttfpMs.toFixed(1)} ms isn't right after any task that did GPU work`);
    if (usableMs === null || Math.abs(usableMs - ttfpMs) > 0.01) fail(`contender:usable ${usableMs} ms, not at the first frame (${ttfpMs.toFixed(1)} ms)`);
    if (placeholderMs === null) fail('the placeholder never painted');
    else if (placeholderMs > ttfpMs) fail(`the placeholder painted at ${placeholderMs.toFixed(1)} ms, after the first frame`);
    if (placeholderMs !== null && (firstPixelsMs === null || Math.abs(firstPixelsMs - placeholderMs) > 0.01)) fail(`contender:first-pixels ${firstPixelsMs} ms, not at the placeholder's paint`);
    const released = probe?.placeholderReleased ?? null;
    if (released === null) fail('the placeholder was never released');
    else if (!presenting || released < presenting.lastGpuCall || released > presenting.end!) fail(`the placeholder was released at ${released.toFixed(1)} ms, outside the presenting task`);
    if (!gone) fail('the placeholder was still on the page at the end of the run');
    if (engineReadyMs === null) fail('the engine never became ready');
    if (engineStartMs !== null && engineStartMs < ttfpMs) fail(`the engine started at ${engineStartMs.toFixed(1)} ms, before the first frame`);
    for (const { url, wallMs } of requests.values()) {
      if (/^(data|blob):/.test(url)) continue;
      const startMs = wallMs - timeOrigin;
      const path = new URL(url).pathname;
      if (startMs < ttfpMs && !FIRST_PAINT.some((pattern) => pattern.test(path))) fail(`request before the first frame: ${path} at ${startMs.toFixed(1)} ms`);
    }
    if (backing !== '2880x1800') fail(`backing store ${backing}, expected 2880x1800`);
    return { ttfpMs, wasmReadyMs, placeholderMs, firstPixelsMs, usableMs, engineStartMs, engineReadyMs, api: probe?.api ?? '', backing, problems: found };
  } finally {
    await browser.close();
  }
}

const GPUI_WASM_PATH = FIRST_PAINT[2]!;

function wasmBrotliKiB(): number {
  const assets = join(gpuiWebDir, 'dist/assets');
  const wasm = readdirSync(assets).find((name) => /^tall_table_gpui_bg-[\w-]+\.wasm$/.test(name));
  if (!wasm) throw new Error(`no contender wasm in ${assets}; run \`just observatory gpui-build\` first`);
  return brotli(readFileSync(join(assets, wasm))).length / 1024;
}

interface Baseline {
  date: string;
  machine: string;
  cpu: string;
  os: string;
  ttfpMs: { reference: number; throttled: number };
  wasmBrotliKiB: number;
}

const round = (value: number | null) => (value === null ? null : Number(value.toFixed(1)));
const medianOf = (values: (number | null)[]) => (values.every((value) => value !== null) && values.length ? round(median(values as number[])) : null);

const server = await serveGpui(PORT);
const profiles = check || flag('reference-only') ? PROFILES.slice(0, 1) : PROFILES;
const results: Record<string, { runs: Run[]; ttfpMs: number; placeholderPaintMs: number | null; engineReadyMs: number | null; wasmReadyMs: number | null }> = {};
try {
  for (const profile of profiles) {
    const profileRuns: Run[] = [];
    for (let i = 0; i < runs; i++) {
      const run = await measure(server.url, profile);
      profileRuns.push(run);
      console.log(
        `${profile.name} ${String(i + 1).padStart(2)}/${runs}  TTFP ${run.ttfpMs.toFixed(1)} ms (${run.api})  placeholder ${run.placeholderMs?.toFixed(1) ?? '—'} ms  engine ready ${run.engineReadyMs?.toFixed(0) ?? '—'} ms` +
          (run.problems.length ? `  PROBLEMS: ${run.problems.join('; ')}` : ''),
      );
    }
    results[profile.name] = {
      runs: profileRuns,
      ttfpMs: round(median(profileRuns.map((run) => run.ttfpMs)))!,
      placeholderPaintMs: medianOf(profileRuns.map((run) => run.placeholderMs)),
      engineReadyMs: medianOf(profileRuns.map((run) => run.engineReadyMs)),
      wasmReadyMs: medianOf(profileRuns.map((run) => run.wasmReadyMs)),
    };
  }
} finally {
  await server.close();
}

const wasmKiB = round(wasmBrotliKiB())!;
const date = new Date().toISOString().slice(0, 10);
const { machine, cpu, os } = machineInfo();
const browserVersion = await chromium.launch({ channel: 'chromium' }).then(async (browser) => {
  const version = browser.version();
  await browser.close();
  return version;
});
const pick = <K extends 'ttfpMs' | 'placeholderPaintMs' | 'engineReadyMs' | 'wasmReadyMs'>(key: K) => Object.fromEntries(Object.entries(results).map(([name, r]) => [name, r[key]]));
const summary = {
  date,
  label,
  machine,
  cpu,
  os,
  browser: `Chromium ${browserVersion} (headless=new)`,
  contender: 'gpui',
  protocol: { viewport: '1440x900', deviceScaleFactor: 2, runs, throttled: { cpuSlowdown: 4, network: 'Fast 4G', ...FAST_4G } },
  wasmBrotliKiB: wasmKiB,
  ttfpMs: pick('ttfpMs'),
  placeholderPaintMs: pick('placeholderPaintMs'),
  engineReadyMs: pick('engineReadyMs'),
  wasmReadyMs: pick('wasmReadyMs'),
  runs: Object.fromEntries(Object.entries(results).map(([name, r]) => [name, r.runs])),
  failures: [...new Set(Object.values(results).flatMap((r) => r.runs.flatMap((run) => run.problems)))],
};
console.log(`\nwasm brotli ${wasmKiB} KiB`);
for (const [name, r] of Object.entries(results)) {
  const ttfps = r.runs.map((run) => run.ttfpMs);
  console.log(`${name}: median TTFP ${r.ttfpMs} ms (min ${Math.min(...ttfps).toFixed(1)}, max ${Math.max(...ttfps).toFixed(1)}); placeholder ${r.placeholderPaintMs ?? '—'} ms; engine ready ${r.engineReadyMs ?? '—'} ms`);
}

if (!check) {
  const out = join(perfDir, 'results', `${date}-${label}.json`);
  mkdirSync(join(perfDir, 'results'), { recursive: true });
  writeFileSync(out, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`wrote ${out}`);
}
if (flag('write-baseline')) {
  const { reference, throttled } = results;
  if (!reference || !throttled) throw new Error('--write-baseline needs both profiles');
  // Kept: the other entries (the TanStack contender's JS, `tanstack-sizes.ts`,
  // dated on their own); the top-level date and machine are this run's.
  const kept = existsSync(baselinePath) ? (JSON.parse(readFileSync(baselinePath, 'utf8')) as object) : {};
  const baseline: Baseline = { ...kept, date, machine, cpu, os, ttfpMs: { reference: reference.ttfpMs, throttled: throttled.ttfpMs }, wasmBrotliKiB: wasmKiB };
  writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
  console.log(`wrote ${baselinePath}`);
}

const failures = [...summary.failures];
if (check) {
  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8')) as Baseline;
  const reference = results.reference!.ttfpMs;
  const ttfpLimit = baseline.ttfpMs.reference * (1 + ttfpOverBaseline);
  const wasmLimit = baseline.wasmBrotliKiB * (1 + wasmOverBaseline);
  // TTFP from other hardware isn't comparable: skip that budget, say so.
  const sameMachine = machine === baseline.machine && cpu === baseline.cpu && os === baseline.os;
  if (!sameMachine) console.warn(`warning: the baseline is from "${baseline.machine}" (${baseline.cpu}, ${baseline.os}); skipping the TTFP budget here`);
  console.log(`budget: TTFP ${reference} ms vs limit ${ttfpLimit.toFixed(1)} ms (baseline ${baseline.ttfpMs.reference} + ${ttfpOverBaseline * 100}%); wasm ${wasmKiB} KiB vs limit ${wasmLimit.toFixed(1)} KiB`);
  if (sameMachine && reference > ttfpLimit) failures.push(`reference TTFP ${reference} ms is over ${ttfpLimit.toFixed(1)} ms`);
  if (wasmKiB > wasmLimit) failures.push(`wasm brotli ${wasmKiB} KiB is over ${wasmLimit.toFixed(1)} KiB`);
}
if (failures.length) {
  console.error(`\nFAIL\n${failures.map((failure) => `  ${failure}`).join('\n')}`);
  process.exit(1);
}
console.log('\nPASS');
