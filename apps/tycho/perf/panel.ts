// M7 (part A) checks: the observation panel against independent
// measurements, and the M4 fling with the panel open and closed.
//
// Per run (a new browser, Chromium headless=new, 1440×900 at DPR 2, `?perf`):
// 1. Page load: each waterfall step against the page's own timings: the
//    navigation's responseEnd (HTML), the app wasm's Resource Timing entry
//    (download), the bootstrap's `seiza:wasm-ready` mark (compile), and the
//    `gpui:first-frame`, `tycho:engine-ready`, and `tycho:parquet-ready` marks.
// 2. Open: "Try sample" → "Sample → schema" and "Sample → first rows"
//    against the app's click, shown, and first-rows marks.
// 3. Live rows: a steady scroll (~3 s), and one panel refresh taken while it
//    runs, compared over that refresh's 2 s window with:
//    - frame interval p50/p95: an in-page rAF recorder (`frameRecorder`);
//    - work per frame p50/p95: every rAF callback that drew, timed by a
//      wrapper around `requestAnimationFrame` (`workRecorder`), not by the app;
//    - rows/s and cache hits: the table's published top row and loaded rows,
//      sampled by the recorder at every rAF;
//    - wasm memory: the module's `WebAssembly.Memory` (`?bench`), read just
//      before and just after the refresh. A range check: the panel's value
//      must fall between them (± the tolerance); `range` records both.
// 4. Bytes read: once the scroll's reads settle, the panel's "Read" against
//    the /data/ bytes counted at the server (a proxy in front of the Worker).
// 5. Fling (M4 budget: p95 ≤ 20 ms, none > 50 ms), panel open and closed
//    (Cmd/Ctrl+Shift+P), in alternating order, with work per frame from the
//    wrapper both times: what watching costs.
// A value matches within 5% of the measurement, or half the panel's display
// step if that's more (it shows "1.4 MiB", "12 ms"). Budgets apply to the
// reference run; every run's values must match.
//
// Usage: node apps/tycho/perf/panel.ts [--runs 10] [--label m7-panel] [--reference-only]
// Writes perf/results/<date>-<label>.json. Run `just tycho build` first.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from '@playwright/test';
import { preview } from 'vite';
import { assertPortFree, startWorkerDev, WORKER_DEV_PORT } from '../worker/scripts/dev.ts';
import { PROFILES, flag, machineInfo, median, option, type Profile } from './common.ts';
import {
  clickTarget,
  fling,
  frameRecorder,
  framesBetween,
  open,
  panelSnapshot,
  percentiles,
  recordedBetween,
  settled,
  startCountingProxy,
  targetRect,
  waitMark,
  waitOverlay,
  wheel,
  workBetween,
  workRecorder,
  type CountingProxy,
} from './harness.ts';

const perfDir = dirname(fileURLToPath(import.meta.url));
const webDir = join(perfDir, '../web');
const manifest = JSON.parse(readFileSync(join(perfDir, '../data/MANIFEST.json'), 'utf8')) as Record<string, { rows: number; bytes: number }>;
const FILE = manifest['asteroids.parquet']!;
const BUDGET = { flingP95Ms: 20, flingMaxMs: 50 };
const TOLERANCE = 0.05;
/** The panel's window for its live rows (`seiza::perf::WINDOW_MS`). */
const WINDOW_MS = 2_000;
const runs = Number(option('runs') ?? 10);
const label = option('label') ?? 'm7-panel';

/** One panel value against its independent measurement. */
interface Match {
  row: string;
  panel: number | null;
  measured: number | null;
  /** Allowed difference: 5% of the measurement or half the display step. */
  allowed: number;
  /** For a value read between two measurements: both, in order. The panel
   *  must fall between them, give or take `allowed`. */
  range?: [number, number];
  ok: boolean;
}

function match(row: string, panel: number | null, measured: number | null, step: number): Match {
  const allowed = measured === null ? 0 : Math.max(Math.abs(measured) * TOLERANCE, step / 2);
  const ok = panel !== null && measured !== null && Math.abs(panel - measured) <= allowed + 1e-9;
  return { row, panel, measured: measured === null ? null : Number(measured.toFixed(3)), allowed: Number(allowed.toFixed(3)), ok };
}

/** Like `match`, for a panel value that saw something between two
 *  measurements (`low` before, `high` after). A range check, not a point
 *  check: it can't tell a value from an older one inside the bracket. With
 *  nothing changing between the reads, the bracket is a point. */
function matchRange(row: string, panel: number | null, low: number | null, high: number | null, step: number): Match {
  if (low === null || high === null) return { ...match(row, panel, null, step), ok: false };
  const allowed = Math.max(high * TOLERANCE, step / 2);
  const ok = panel !== null && panel >= low - allowed - 1e-9 && panel <= high + allowed + 1e-9;
  const round = (value: number) => Number(value.toFixed(3));
  return { row, panel, measured: round(high), allowed: round(allowed), range: [round(low), round(high)], ok };
}

const ms = (value: string | undefined) => (value && /^-?[\d.]+ ms$/.test(value) ? Number.parseFloat(value) : null);
/** `p50 16.7 · p95 16.7 · max 33 ms` → its p50 and p95. */
function stats(value: string | undefined): { p50: number; p95: number } | null {
  const found = value && /p50 ([\d.]+) · p95 ([\d.]+)/.exec(value);
  return found ? { p50: Number(found[1]), p95: Number(found[2]) } : null;
}
const UNITS: Record<string, number> = { B: 1, KiB: 1024, MiB: 1024 ** 2, GiB: 1024 ** 3 };
/** `1.4 MiB of 35.9 MiB (3.9%)` → bytes read, and the display step. */
function bytes(value: string | undefined): { bytes: number; step: number } | null {
  const found = value && /^([\d.]+) (B|KiB|MiB|GiB)/.exec(value);
  if (!found) return null;
  const unit = UNITS[found[2]!]!;
  return { bytes: Number(found[1]) * unit, step: found[2] === 'B' ? 1 : 0.1 * unit };
}

interface FlingResult {
  panel: 'open' | 'closed';
  frames: Awaited<ReturnType<typeof framesBetween>>;
  work: ReturnType<typeof percentiles>;
  reachedEnd: boolean;
}

interface Run {
  matches: Match[];
  steady: { frames: number; work: ReturnType<typeof percentiles>; panelWork: string | null; panelFrames: string | null };
  flings: FlingResult[];
  problems: string[];
}

const now = (page: Page) => page.evaluate(() => performance.now());

async function pageLoad(page: Page): Promise<Match[]> {
  const snapshot = await panelSnapshot(page);
  const timings = await page.evaluate(() => {
    const mark = (name: string) => performance.getEntriesByName(name, 'mark').at(-1)?.startTime ?? null;
    const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    const wasm = (performance.getEntriesByType('resource') as PerformanceResourceTiming[]).find((entry) => /\/tycho_bg-[\w-]+\.wasm$/.test(entry.name));
    return {
      html: navigation?.responseEnd ?? null,
      wasm: wasm?.responseEnd ?? null,
      compiled: mark('seiza:wasm-ready'),
      firstFrame: mark('gpui:first-frame'),
      engine: mark('tycho:engine-ready'),
      parquet: mark('tycho:parquet-ready'),
    };
  });
  const rows = snapshot?.rows ?? {};
  return [
    match('TTFP', ms(rows['TTFP']), timings.firstFrame, 1),
    match('HTML', ms(rows['HTML']), timings.html, 1),
    match('Wasm download', ms(rows['Wasm download']), timings.wasm, 1),
    match('Compile', ms(rows['Compile']), timings.compiled, 1),
    match('First frame', ms(rows['First frame']), timings.firstFrame, 1),
    match('Engine ready', ms(rows['Engine ready']), timings.engine, 1),
    match('Parquet ready', ms(rows['Parquet ready']), timings.parquet, 1),
  ];
}

async function openSample(page: Page): Promise<Match[]> {
  const before = await now(page);
  await clickTarget(page, 'try-sample-asteroids');
  const click = await waitMark(page, 'tycho:sample-click', before, 60_000);
  const shown = await waitMark(page, 'tycho:sample-shown', before, 60_000);
  const firstRows = await waitMark(page, 'tycho:first-rows', before, 60_000);
  const schema = await waitOverlay(page, 'Sample → schema', /ms$/, 10_000);
  const rows = await waitOverlay(page, 'Sample → first rows', /ms$/, 10_000);
  return [match('Sample → schema', ms(schema), shown - click, 1), match('Sample → first rows', ms(rows), firstRows - click, 1)];
}

/**
 * Scrolls steadily (~900 px per 16 ms) and takes the first panel refresh
 * whose whole window falls inside the scroll; returns it with the recorder's
 * frames and the wrapper's work samples over the same window.
 */
async function steadyScroll(page: Page) {
  const [x, y, , h] = await targetRect(page, 'table-scroll-track');
  await page.mouse.move(x - 400, y + h / 2);
  const start = await now(page);
  const wallStart = Date.now();
  let snapshot: Awaited<ReturnType<typeof panelSnapshot>> = null;
  // Wasm memory only grows, and the panel read it at its refresh. A read
  // made before that refresh and the first read after it bound what it saw:
  // on a throttled run, pages arriving between the refresh and a later read
  // grew it 1.3 MiB (part E).
  let memory: { before: number | null; after: number | null } | null = null;
  let previous: { at: number; memory: number | null } | null = null;
  while (Date.now() - wallStart < 4_000) {
    await wheel(page, 900);
    await page.waitForTimeout(16);
    if (!snapshot && Date.now() - wallStart > 2_400) {
      const taken = await page.evaluate(() => {
        const g = globalThis as { __seizaPerfOverlay?: [string, string][]; __seizaPerfOverlayAt?: number; __tychoWasmMemory?: WebAssembly.Memory };
        return { at: g.__seizaPerfOverlayAt ?? 0, rows: Object.fromEntries(g.__seizaPerfOverlay ?? []), memory: g.__tychoWasmMemory?.buffer.byteLength ?? null };
      });
      if (taken.at - WINDOW_MS > start + 100 && previous && previous.at < taken.at) {
        snapshot = { at: taken.at, rows: taken.rows };
        memory = { before: previous.memory, after: taken.memory };
      }
      previous = { at: taken.at, memory: taken.memory };
    }
  }
  if (!snapshot) throw new Error('no panel refresh fell inside the steady scroll');
  const from = snapshot.at - WINDOW_MS;
  const frames = await recordedBetween(page, from, snapshot.at);
  const work = await workBetween(page, from, snapshot.at);
  return { snapshot, frames, work, memory };
}

function liveMatches(steady: Awaited<ReturnType<typeof steadyScroll>>): Match[] {
  const { snapshot, frames, work, memory } = steady;
  const rows = snapshot.rows;
  const intervals = percentiles(frames.slice(1).map((frame, index) => frame.t - frames[index]!.t));
  const workStats = percentiles(work.map((sample) => sample.ms));
  const panelFrames = stats(rows['Frame time (2 s)']);
  const panelWork = stats(rows['Work per frame (2 s)']);
  const withTable = frames.filter((frame) => frame.top !== null);
  let moved = 0;
  for (let i = 1; i < withTable.length; i++) moved += Math.abs(withTable[i]!.top! - withTable[i - 1]!.top!);
  const rowsPerS = moved / (WINDOW_MS / 1000);
  const hits = withTable.length ? (withTable.filter((frame) => frame.filled).length * 100) / withTable.length : null;
  const panelRate = rows['Rows/s (2 s)'] ? Number(rows['Rows/s (2 s)'].replaceAll(',', '')) : null;
  const panelHits = /^([\d.]+)%/.exec(rows['Cache hits (2 s)'] ?? '');
  const panelWasm = /^wasm ([\d.]+)/.exec(rows['Memory'] ?? '');
  const panelWasmMiB = panelWasm ? Number(panelWasm[1]) : null;
  const mib = (bytes: number | null | undefined) => (bytes == null ? null : bytes / 1024 ** 2);
  return [
    match('Frame interval p50', panelFrames?.p50 ?? null, intervals.p50, 0.1),
    match('Frame interval p95', panelFrames?.p95 ?? null, intervals.p95, 0.1),
    match('Work per frame p50', panelWork?.p50 ?? null, workStats.p50, 0.1),
    match('Work per frame p95', panelWork?.p95 ?? null, workStats.p95, 0.1),
    match('Rows/s', panelRate, rowsPerS, 1),
    match('Cache hits %', panelHits ? Number(panelHits[1]) : null, hits, 1),
    matchRange('Wasm memory MiB', panelWasmMiB, mib(memory?.before), mib(memory?.after), 0.1),
  ];
}

/** Waits for /data/ reads to stop, then for a panel refresh after that. */
async function bytesRead(page: Page, proxy: CountingProxy, since: number): Promise<Match> {
  await page.waitForTimeout(1_500);
  const requests = proxy.log.slice(since);
  await settled(requests);
  const counted = requests.filter((r) => r.method === 'GET' && r.path.startsWith('/data/asteroids.parquet')).reduce((sum, r) => sum + r.bytes, 0);
  const after = await now(page);
  await page.waitForFunction((after) => ((globalThis as { __seizaPerfOverlayAt?: number }).__seizaPerfOverlayAt ?? 0) > after, after, { timeout: 5_000 });
  const read = bytes((await panelSnapshot(page))?.rows['Read']);
  return match('Read bytes', read?.bytes ?? null, counted, read?.step ?? 1);
}

async function measureFling(page: Page, panel: 'open' | 'closed'): Promise<FlingResult> {
  const visible = await page.evaluate(() => (globalThis as { __seizaPerfOverlay?: unknown }).__seizaPerfOverlay !== undefined);
  if (visible !== (panel === 'open')) {
    await page.keyboard.press('Control+Shift+P');
    await page.waitForFunction(
      (open) => ((globalThis as { __seizaPerfOverlay?: unknown }).__seizaPerfOverlay !== undefined) === open,
      panel === 'open',
      { timeout: 5_000 },
    );
  }
  const home = await now(page);
  await page.keyboard.press('Home');
  await waitMark(page, 'tycho:viewport-filled', home, 30_000).catch(() => null);
  await page.waitForTimeout(500);
  const { start, end } = await fling(page, FILE.rows);
  await page.waitForTimeout(500);
  const frames = await framesBetween(page, start, end + 500);
  const work = percentiles((await workBetween(page, start, end + 500)).map((sample) => sample.ms));
  const table = await page.evaluate(() => (globalThis as { __tychoTable?: { end: number; rows: number } }).__tychoTable ?? null);
  return { panel, frames, work, reachedEnd: !!table && table.end === table.rows };
}

async function measure(url: string, profile: Profile, proxy: CountingProxy, index: number): Promise<Run> {
  const run = await open(chromium, url, { profile, params: { bench: '' }, init: [frameRecorder, workRecorder] });
  const { page } = run;
  try {
    await waitOverlay(page, 'Parquet ready', /ms$/, 180_000);
    // A refresh after Parquet ready, so its step is in the snapshot.
    await page.waitForTimeout(300);
    const matches = await pageLoad(page);
    const since = proxy.log.length;
    matches.push(...(await openSample(page)));
    await page.waitForTimeout(500);
    const steady = await steadyScroll(page);
    matches.push(...liveMatches(steady));
    matches.push(await bytesRead(page, proxy, since));
    // Alternate the order, so neither fling always runs on a warmer cache.
    const order: ('open' | 'closed')[] = index % 2 === 0 ? ['open', 'closed'] : ['closed', 'open'];
    const flings: FlingResult[] = [];
    for (const panel of order) flings.push(await measureFling(page, panel));
    return {
      matches,
      steady: {
        frames: steady.frames.length,
        work: percentiles(steady.work.map((sample) => sample.ms)),
        panelWork: steady.snapshot.rows['Work per frame (2 s)'] ?? null,
        panelFrames: steady.snapshot.rows['Frame time (2 s)'] ?? null,
      },
      flings,
      problems: run.problems,
    };
  } finally {
    await run.close();
  }
}

// --- main ---

const WORKER_PORT = 8793;
await assertPortFree(WORKER_DEV_PORT);
const worker = await startWorkerDev({ port: WORKER_PORT, requireObject: 'asteroids.parquet' });
let proxy: CountingProxy;
let server: Awaited<ReturnType<typeof preview>>;
try {
  proxy = await startCountingProxy(WORKER_DEV_PORT, WORKER_PORT);
  server = await preview({ root: webDir, preview: { port: 4180, strictPort: true }, logLevel: 'warn' });
} catch (error) {
  await worker.close();
  throw error;
}
const url = 'http://localhost:4180/';
const profiles = flag('reference-only') ? PROFILES.slice(0, 1) : PROFILES;
const results: Record<string, Run[]> = {};
const failures: string[] = [];
try {
  for (const profile of profiles) {
    results[profile.name] = [];
    for (let i = 0; i < runs; i++) {
      const run = await measure(url, profile, proxy, i);
      results[profile.name]!.push(run);
      const where = `${profile.name} run ${i + 1}`;
      const bad = run.matches.filter((m) => !m.ok);
      failures.push(...bad.map((m) => `${where}: panel ${m.row} ${m.panel} vs measured ${m.range ? `${m.range[0]}–${m.range[1]}` : m.measured} (allowed ±${m.allowed})`));
      failures.push(...run.problems.map((problem) => `${where}: ${problem}`));
      for (const f of run.flings) {
        if (!f.reachedEnd) failures.push(`${where}: the fling (panel ${f.panel}) didn't reach the last row`);
        if (profile.name === 'reference' && (f.frames.p95 > BUDGET.flingP95Ms || f.frames.max > BUDGET.flingMaxMs))
          failures.push(`${where}: fling with the panel ${f.panel}: p95 ${f.frames.p95.toFixed(1)} ms, max ${f.frames.max.toFixed(1)} ms`);
      }
      const fl = (f: FlingResult) =>
        `panel ${f.panel}: p95 ${f.frames.p95.toFixed(1)} max ${f.frames.max.toFixed(1)} ms, work p50 ${f.work.p50.toFixed(1)} p95 ${f.work.p95.toFixed(1)} ms (${f.work.n})`;
      console.log(
        `${profile.name.padEnd(9)} ${String(i + 1).padStart(2)}/${runs}  ${run.matches.length - bad.length}/${run.matches.length} match` +
          `  steady work p50 ${run.steady.work.p50.toFixed(1)} p95 ${run.steady.work.p95.toFixed(1)} ms (panel ${run.steady.panelWork})` +
          `  fling ${run.flings.map(fl).join('; ')}` +
          (bad.length ? `  MISMATCH: ${bad.map((m) => `${m.row} ${m.panel} vs ${m.range ? `${m.range[0]}–${m.range[1]}` : m.measured}`).join(', ')}` : ''),
      );
    }
  }
} finally {
  await server.close();
  proxy.close();
  await worker.close();
}

const med = (values: number[]) => Number(median(values).toFixed(1));
const summary = Object.fromEntries(
  Object.entries(results).map(([name, list]) => {
    const flings = (panel: 'open' | 'closed') => list.flatMap((run) => run.flings.filter((f) => f.panel === panel));
    const flingSummary = (panel: 'open' | 'closed') => ({
      intervalP95Ms: med(flings(panel).map((f) => f.frames.p95)),
      intervalMaxMs: Number(Math.max(...flings(panel).map((f) => f.frames.max)).toFixed(1)),
      over50: flings(panel).reduce((sum, f) => sum + f.frames.over50, 0),
      workP50Ms: med(flings(panel).map((f) => f.work.p50)),
      workP95Ms: med(flings(panel).map((f) => f.work.p95)),
    });
    return [
      name,
      {
        runs: list.length,
        matched: `${list.reduce((sum, run) => sum + run.matches.filter((m) => m.ok).length, 0)}/${list.reduce((sum, run) => sum + run.matches.length, 0)}`,
        steadyWork: { p50Ms: med(list.map((run) => run.steady.work.p50)), p95Ms: med(list.map((run) => run.steady.work.p95)) },
        flingPanelOpen: flingSummary('open'),
        flingPanelClosed: flingSummary('closed'),
      },
    ];
  }),
);
console.log(`\n${JSON.stringify(summary, null, 2)}`);

const date = new Date().toISOString().slice(0, 10);
const out = option('out') ?? join(perfDir, 'results', `${date}-${label}.json`);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(
  out,
  `${JSON.stringify(
    {
      date,
      label,
      ...machineInfo(),
      browser: 'Chromium (headless=new)',
      protocol: { viewport: '1440x900', deviceScaleFactor: 2, runs, tolerance: TOLERANCE, windowMs: WINDOW_MS },
      file: { name: 'asteroids.parquet', ...FILE },
      summary,
      runs: results,
      failures,
    },
    null,
    2,
  )}\n`,
);
console.log(`wrote ${out}`);
if (failures.length) {
  console.error(`\nFAIL\n${failures.map((failure) => `  ${failure}`).join('\n')}`);
  process.exit(1);
}
console.log('\nPASS');
