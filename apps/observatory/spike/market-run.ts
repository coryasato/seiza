// The market watch spike's runs (throwaway; market watch's stops): both
// sides under a feed at each rate, cold, a few runs each (sizing, not the
// protocol).
// - tanstack: market.html, A1's feed worker into an idiomatic store, React
//   and TanStack Virtual over 50 instruments × 12 columns, Last, Bid, and
//   Ask flashing (the cell's background by keyframes; `--mode`).
// - gpui: the tall table's bare host built `live,custom-cells`,
//   `?shape=narrow&live=<rate>&flash`: its own seeded feed over the visible
//   rows (each update a row's every float), answered from memory, every
//   float column flashing (1 s). The fold a store would add is ~2 ms a
//   second at 50k (`perf/results/2026-11-04-m10-a1.md`), left out.
// Per run: 1 s to settle, then 10 s traced:
// - keeps up: the frames that showed new values (TanStack's commits, GPUI's
//   `tall-table:refreshed` marks) against the most there could be, the
//   lesser of the batches sent and the display's frames (60 Hz): under 100%,
//   batches were coalesced, the view a frame or more behind the feed;
// - Shown in: a batch's start (the worker's post; the host's feed tick) to
//   the presentation of the first frame that showed it (the trace's
//   `AnimationFrame::Presentation` for the frame holding the commit or
//   mark), p50 and p95;
// - late frames (rAF intervals over 1.5 frames), each main frame's work
//   p50 / p95 and the main thread's busy time (the trace's), V8's
//   collections on the main thread;
// - the throttle's control: a fixed busy loop timed on the page before the
//   window, which a 4× profile must slow ~4×.
// `--hold` adds TanStack's `?hold=1` (every frame's batches committed a
// frame later: Shown in's control). `--flash <ms>` and `--flash-all` (every
// numeric column flashing) set TanStack's flash to the bare host's workload
// (1 s, every float column), with `--sides tanstack`.
//
// Usage: node apps/observatory/spike/market-run.ts [--sides tanstack,gpui] [--rates 1000,5000,20000,50000]
//          [--profiles reference,throttled] [--runs 3] [--hold] [--flash <ms>|0] [--flash-all] [--mode waapi|css|bg] [--no-build] [--label m10-a2-market]
// GPUI: `just tall-table build live,custom-cells` first.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright';
import { build } from 'vite';
import { frameIntervals, frameRecorder, open, recordedBetween, waitMark } from '../../../shared-web/perf/harness.ts';
import { PROFILES, flag, localDate, machineInfo, median, option, percentiles } from '../../../shared-web/perf/protocol.ts';
import { serveApp } from '../../../shared-web/perf/serve.ts';
import { FRAME_MS, LATENCY_CATEGORIES, ORIGIN_MARK, Trace, frameWork, lateFrames } from '../../../shared-web/perf/trace.ts';
import { INVALIDATED_GLOBAL, INVALIDATED_MARK, REFRESHED_GLOBAL, REFRESHED_MARK } from '../../../components/tall-table/perf/harness.ts';

const dir = import.meta.dirname;
const SIDES = (option('sides') ?? 'tanstack,gpui').split(',') as ('tanstack' | 'gpui')[];
const RATES = (option('rates') ?? '1000,5000,20000,50000').split(',').map(Number);
const PROFILE_NAMES = (option('profiles') ?? 'reference,throttled').split(',');
const RUNS = Number(option('runs') ?? 3);
const HOLD = flag('hold');
const LABEL = option('label') ?? 'm10-a2-market';
const SETTLE_MS = 1000;
const WINDOW_MS = 10_000;
const CATEGORIES = [...LATENCY_CATEGORIES, 'blink', 'v8'];
const hostWebDir = join(dir, '../../../components/tall-table/host/web');

const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

/** GPUI's marks, logged with the generation their global holds (the bare
 *  host sets each global before its mark; its `perf/live.ts` reads them so). */
function markLog(): void {
  const names = { invalidated: ['tall-table:invalidated', '__tallTableInvalidated'], refreshed: ['tall-table:refreshed', '__tallTableRefreshed'] } as const;
  const log: [string, number, number][] = [];
  (globalThis as { __marketLog?: unknown }).__marketLog = log;
  const mark = performance.mark.bind(performance);
  performance.mark = ((name: string, options?: PerformanceMarkOptions) => {
    const entry = mark(name, options);
    for (const [kind, [markName, global]] of Object.entries(names))
      if (name === markName) log.push([kind, (globalThis as Record<string, unknown>)[global] as number, entry.startTime]);
    return entry;
  }) as typeof performance.mark;
}

// The init script names the marks itself: fail if they drift from the host's.
for (const name of [INVALIDATED_MARK, INVALIDATED_GLOBAL, REFRESHED_MARK, REFRESHED_GLOBAL])
  if (!markLog.toString().includes(`'${name}'`)) throw new Error(`markLog doesn't name ${name}`);

/** The throttle's control: a fixed loop's time on the page. */
const spin = (page: Page) =>
  page.evaluate(() => {
    const t0 = performance.now();
    let x = 0;
    for (let i = 0; i < 3e7; i++) x = (x + i * 7) % 1000003;
    return [performance.now() - t0, x][0]!;
  });

interface Batch {
  /** A batch's start and what shows it: TanStack's sequence, GPUI's generation. */
  id: number;
  at: number;
}

async function once(url: string, side: 'tanstack' | 'gpui', rate: number, profileName: string, hold: boolean) {
  const profile = PROFILES.find((p) => p.name === profileName)!;
  const flashMs = option('flash');
  if ((flashMs && flashMs !== '0') || flag('flash-all')) if (SIDES.includes('gpui')) throw new Error('--flash <ms> and --flash-all set TanStack alone: the bare host always flashes every float column for 1 s');
  const params: Record<string, string> =
    side === 'gpui' ? { shape: 'narrow', live: String(rate), ...(flashMs === '0' ? {} : { flash: '' }) } : { rate: String(rate), ...(hold ? { hold: '1' } : {}), ...(flashMs ? { flash: flashMs } : {}), ...(option('mode') ? { mode: option('mode')! } : {}), ...(flag('flash-all') ? { 'flash-all': '1' } : {}) };
  const session = await open(chromium, side === 'gpui' ? url : `${url}market.html`, { profile, params, init: side === 'gpui' ? [frameRecorder, markLog] : [frameRecorder] });
  const { page } = session;
  try {
    if (side === 'gpui') await waitMark(page, 'tall-table:refreshed');
    else await page.waitForFunction(() => (globalThis as any).__market?.shown.length > 0, undefined, { timeout: 60_000 });
    await page.evaluate(() => document.fonts.ready);
    const spinMs = await spin(page);
    const browser = session.context.browser()!;
    await browser.startTracing(page, { categories: CATEGORIES });
    await page.evaluate((name) => performance.mark(name), ORIGIN_MARK);
    await page.waitForTimeout(SETTLE_MS);
    const from = await page.evaluate(() => performance.now());
    await page.waitForTimeout(WINDOW_MS);
    const to = await page.evaluate(() => performance.now());
    const trace = new Trace(JSON.parse((await browser.stopTracing()).toString()));

    let batches: Batch[];
    let shown: Batch[];
    if (side === 'gpui') {
      const log: [string, number, number][] = await page.evaluate(() => (globalThis as any).__marketLog);
      batches = log.filter(([k]) => k === 'invalidated').map(([, id, at]) => ({ id, at }));
      shown = log.filter(([k]) => k === 'refreshed').map(([, id, at]) => ({ id, at }));
    } else {
      const record: { batches: [number, number][]; shown: [number, number][] } = await page.evaluate(() => (globalThis as any).__market);
      batches = record.batches.map(([id, at]) => ({ id, at }));
      shown = record.shown.map(([id, at]) => ({ id, at }));
    }
    const inWindow = (b: Batch) => b.at >= from && b.at <= to;
    const shownInWindow = shown.filter(inWindow);
    const batchesInWindow = batches.filter(inWindow);
    if (!batchesInWindow.length) throw new Error(`${side} ${rate}: no batch in the window`);
    const latencies: number[] = [];
    const toCommit: number[] = [];
    const toPresent: number[] = [];
    let inFrame = 0;
    for (const batch of batchesInWindow) {
      const first = shown.find((s) => s.id >= batch.id && s.at >= batch.at);
      if (!first || first.at > to) continue;
      const presented = trace.presentationOf(trace.toTrace(first.at));
      if (!presented) continue;
      latencies.push(trace.toPage(presented.at) - batch.at);
      toCommit.push(first.at - batch.at);
      toPresent.push(trace.toPage(presented.at) - first.at);
      if (presented.inFrame) inFrame++;
    }
    const work = frameWork(trace, from, to);
    const per = percentiles(work.frames.map((f) => f.ms));
    const intervals = frameIntervals(await recordedBetween(page, from, to));
    const gcs = trace.mainThread(trace.toTrace(from), trace.toTrace(to)).filter((e) => e.name === 'MinorGC' || e.name === 'MajorGC');
    const shownIn = percentiles(latencies);
    if (session.problems.length) throw new Error(`${side} ${rate}: ${session.problems.join('; ')}`);
    return {
      spinMs: round(spinMs),
      shownPct: round(Math.min(1, shownInWindow.length / ((to - from) / FRAME_MS)) * 100, 1),
      keepsUpPct: round(Math.min(1, shownInWindow.length / Math.min(batchesInWindow.length, (to - from) / FRAME_MS)) * 100, 1),
      shownPerSecond: round((shownInWindow.length * 1000) / (to - from), 1),
      batchesPerSecond: round((batchesInWindow.length * 1000) / (to - from), 1),
      shownInP50Ms: round(shownIn.p50),
      shownInP95Ms: round(shownIn.p95),
      shownInMatched: latencies.length,
      toCommitP50Ms: round(percentiles(toCommit).p50),
      toPresentP50Ms: round(percentiles(toPresent).p50),
      inFrameShare: round(inFrame / Math.max(1, latencies.length), 2),
      latePct: round(lateFrames(intervals).share * 100, 1),
      workP50Ms: round(per.p50),
      workP95Ms: round(per.p95),
      busyMsPerSecond: round(work.busyMs / ((to - from) / 1000)),
      gcPerTenSeconds: round((gcs.length * 10_000) / (to - from), 1),
      gcLongestMs: round(Math.max(0, ...gcs.map((e) => (e.dur ?? 0) / 1000))),
    };
  } finally {
    await session.close();
  }
}

const out = join(dir, '../perf/results', `${localDate()}-${LABEL}.json`);
if (existsSync(out)) throw new Error(`${out} exists: pass another --label`);
if (SIDES.includes('gpui')) {
  const built = JSON.parse(readFileSync(join(hostWebDir, 'dist/build.json'), 'utf8')).features;
  if (built !== 'live,custom-cells') throw new Error(`the bare host is built '${built}': just tall-table build live,custom-cells`);
}
if (!flag('no-build') && SIDES.includes('tanstack')) await build({ root: dir, configFile: `${dir}/vite.config.ts`, logLevel: 'warn' });
const servers = {
  tanstack: SIDES.includes('tanstack') ? await serveApp(undefined, { webDir: dir, port: 4356 }) : null,
  gpui: SIDES.includes('gpui') ? await serveApp(undefined, { webDir: hostWebDir, port: 4357 }) : null,
};
const results: unknown[] = [];
try {
  for (const profile of PROFILE_NAMES)
    for (const rate of RATES)
      for (const side of SIDES)
        for (const hold of side === 'tanstack' && HOLD ? [false, true] : [false]) {
          const runs: Awaited<ReturnType<typeof once>>[] = [];
          for (let r = 0; r < RUNS; r++) runs.push(await once(servers[side]!.url, side, rate, profile, hold));
          const pick = (f: (run: (typeof runs)[number]) => number) => round(median(runs.map(f)), 2);
          const keys = Object.keys(runs[0]!) as (keyof (typeof runs)[number])[];
          const summary = {
            profile, rate, side: hold ? `${side}-hold` : side, runs: runs.length,
            ...Object.fromEntries(keys.map((key) => [key, pick((r) => r[key])])),
            keepsUpPctRuns: runs.map((r) => r.keepsUpPct),
          };
          console.log(JSON.stringify(summary));
          results.push({ summary, runs });
        }
} finally {
  await servers.tanstack?.close();
  await servers.gpui?.close();
}
writeFileSync(out, JSON.stringify({ date: localDate(), ...machineInfo(), windowMs: WINDOW_MS, settleMs: SETTLE_MS, results }, null, 2) + '\n');
console.log(`wrote ${out}`);
