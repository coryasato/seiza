// The market watch feed spike's runs (throwaway; market watch's feed path): the feed's
// worker and a fold on the page (feed.html), no drawing, at each rate,
// reference and throttled, a few runs each (sizing, not the protocol). Per
// run: 1 s to settle, then 10 s traced: the ticks delivered a second, the
// batches, the transport (send → the page's handler), the handler's time a
// batch and a tick, the worker's generation time, the main thread's and the
// worker's busy time, and V8's collections on the main thread (count,
// total, longest, and the garbage the minor ones freed). The first 2,000
// ticks' digest, the same in every run of a seed; with --agree, each fold's
// store after the same ticks (a fixed count, then the feed stopped) the
// same as the others', field for field.
//
// Usage: node apps/observatory/spike/feed-run.ts [--runs 3] [--rates 1000,5000,20000,50000]
//          [--folds none,objects,typed,wasm] [--send batch|tick] [--profiles reference,throttled]
//          [--no-build] [--label m10-a1-feed] [--agree]
// Writes perf/results/<date>-<label>.json.

import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { build } from 'vite';
import { open } from '../../../shared-web/perf/harness.ts';
import { PROFILES, flag, localDate, machineInfo, median, option, percentiles } from '../../../shared-web/perf/protocol.ts';
import { serveApp } from '../../../shared-web/perf/serve.ts';
import { ORIGIN_MARK, Trace, WORK_CATEGORIES, frameWork, type TraceEvent } from '../../../shared-web/perf/trace.ts';

const dir = import.meta.dirname;
const RUNS = Number(option('runs') ?? 3);
const RATES = (option('rates') ?? '1000,5000,20000,50000').split(',').map(Number);
const FOLDS = (option('folds') ?? 'none,objects,typed').split(',');
const SEND = option('send') ?? 'batch';
const PROFILE_NAMES = (option('profiles') ?? 'reference,throttled').split(',');
const LABEL = option('label') ?? 'm10-a1-feed';
const PORT = 4355;
const SETTLE_MS = 1000;
const WINDOW_MS = 10_000;
const GC_CATEGORIES = [...WORK_CATEGORIES, 'v8', 'disabled-by-default-devtools.timeline'];

const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

interface FeedRecord {
  arrival: number[];
  sent: number[];
  ticks: number[];
  handler: number[];
  gen: number[];
  seq: number[];
}

interface Batch {
  arrival: number;
  sent: number;
  ticks: number;
  handler: number;
  gen: number;
}

function threadOf(trace: Trace, pattern: RegExp): { pid: number; tid: number } | null {
  const meta = trace.events.find((e) => e.ph === 'M' && e.name === 'thread_name' && e.pid === trace.main.pid && pattern.test(e.args?.name ?? ''));
  return meta ? { pid: meta.pid, tid: meta.tid } : null;
}

/** A thread's busy time: its outermost tasks only (a toplevel task and a
 *  devtools.timeline task nested in it count once). */
function busy(events: readonly TraceEvent[], thread: { pid: number; tid: number } | null, from: number, to: number): number {
  if (!thread) return NaN;
  let total = 0;
  let until = -Infinity;
  for (const e of events) {
    if (e.pid !== thread.pid || e.tid !== thread.tid || e.ph !== 'X' || (e.name !== 'ThreadControllerImpl::RunTask' && e.name !== 'RunTask')) continue;
    if (e.ts < from || e.ts > to || e.ts < until) continue;
    total += (e.dur ?? 0) / 1000;
    until = e.ts + (e.dur ?? 0);
  }
  return total;
}

async function once(url: string, rate: number, fold: string, profileName: string) {
  const profile = PROFILES.find((p) => p.name === profileName)!;
  const session = await open(chromium, `${url}feed.html`, { profile, params: { rate: String(rate), fold, send: SEND } });
  const { page } = session;
  // --cdp-rate <n>: a CDP session setting that CPU rate (1: none), to tell
  // the session's effect from the slowdown's.
  if (option('cdp-rate')) await (await session.context.newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate: Number(option('cdp-rate')) });
  try {
    await page.waitForFunction(() => typeof (globalThis as any).__feedStart === 'function');
    const browser = page.context().browser()!;
    await browser.startTracing(page, { categories: GC_CATEGORIES });
    await page.evaluate((name) => performance.mark(name), ORIGIN_MARK);
    await page.evaluate(() => (globalThis as any).__feedStart());
    await page.waitForTimeout(SETTLE_MS);
    const from = await page.evaluate(() => performance.now());
    await page.waitForTimeout(WINDOW_MS);
    const to = await page.evaluate(() => performance.now());
    const trace = new Trace(JSON.parse((await browser.stopTracing()).toString()));
    const record: FeedRecord = await page.evaluate(() => (globalThis as any).__feed);
    const digest: { ticks: number; digest: string } = await page.evaluate(() => (globalThis as any).__feedDigest());
    const batches: Batch[] = record.arrival
      .map((arrival, i) => ({ arrival, sent: record.sent[i]!, ticks: record.ticks[i]!, handler: record.handler[i]!, gen: record.gen[i]! }))
      .filter((b) => b.arrival >= from && b.arrival <= to);
    const ticks = batches.reduce((sum, b) => sum + b.ticks, 0);
    const handlerMs = batches.reduce((sum, b) => sum + b.handler, 0);
    const windowS = (to - from) / 1000;
    const t0 = trace.toTrace(from);
    const t1 = trace.toTrace(to);
    const gcs = trace.mainThread(t0, t1).filter((e) => e.name === 'MinorGC' || e.name === 'MajorGC');
    const minor = gcs.filter((e) => e.name === 'MinorGC');
    const freed = minor.reduce((sum, e) => sum + Math.max(0, (e.args?.usedHeapSizeBefore ?? 0) - (e.args?.usedHeapSizeAfter ?? 0)), 0);
    const workerThread = threadOf(trace, /^DedicatedWorker/);
    const gaps = batches.slice(1).map((b, k) => b.arrival - batches[k]!.arrival);
    if (session.problems.length) throw new Error(`${rate}/s ${fold}: ${session.problems.join('; ')}`);
    return {
      ticksPerSecond: round(ticks / windowS, 0),
      deliveredShare: round(ticks / (rate * windowS), 3),
      batchesPerSecond: round(batches.length / windowS, 1),
      ticksPerBatch: percentiles(batches.map((b) => b.ticks)),
      batchGapMs: percentiles(gaps),
      transportMs: percentiles(batches.map((b) => b.arrival - b.sent)),
      handlerMs: percentiles(batches.map((b) => b.handler)),
      handlerUsPerTick: round((handlerMs * 1000) / Math.max(1, ticks), 3),
      handlerMsPerSecond: round(handlerMs / windowS),
      genMs: SEND === 'batch' ? percentiles(batches.map((b) => b.gen)) : null,
      mainBusyMsPerSecond: round(frameWork(trace, from, to).busyMs / windowS),
      workerBusyMsPerSecond: round(busy(trace.events, workerThread, t0, t1) / windowS),
      gc: {
        minor: minor.length,
        major: gcs.length - minor.length,
        perTenSeconds: round((gcs.length * 10) / windowS, 1),
        totalMs: round(gcs.reduce((sum, e) => sum + (e.dur ?? 0) / 1000, 0)),
        longestMs: round(Math.max(0, ...gcs.map((e) => (e.dur ?? 0) / 1000))),
        minorFreedMiBPerSecond: round(freed / 2 ** 20 / windowS, 2),
      },
      digest,
      problems: session.problems,
    };
  } finally {
    await session.close();
  }
}

/** Each fold's store after the same 20,000 ticks at 50k/s, against `objects`'; the control drops one tick.
 *  The store depends on the ticks alone, never on their batches' boundaries
 *  (a batch is at most 5,000 ticks, which every fold takes). */
async function agree(url: string): Promise<{ ok: boolean; lines: string[] }> {
  const TICKS = 20_000;
  const lines: string[] = [];
  const storeOf = async (fold: string, extra: Record<string, string> = {}) => {
    const session = await open(chromium, `${url}feed.html`, { params: { rate: '50000', fold, send: 'batch', ticks: String(TICKS), ...extra } });
    try {
      await session.page.waitForFunction(() => typeof (globalThis as any).__feedStart === 'function');
      await session.page.evaluate(() => (globalThis as any).__feedStart());
      // `folded` counts the dropped tick too: wait for every tick either way.
      await session.page.waitForFunction((n) => (globalThis as any).__feedFolded() >= n, TICKS, { timeout: 30_000 });
      if (session.problems.length) throw new Error(`${fold}: ${session.problems.join('; ')}`);
      return JSON.stringify(await session.page.evaluate(() => (globalThis as any).__feedStore()));
    } finally {
      await session.close();
    }
  };
  const reference = await storeOf('objects');
  let ok = true;
  for (const fold of ['typed', 'wasm']) {
    const same = (await storeOf(fold)) === reference;
    lines.push(`${fold} against objects after ${TICKS} ticks: ${same ? 'the same' : 'DIFFERENT'}`);
    ok &&= same;
  }
  const dropped = (await storeOf('objects', { drop: '10000' })) === reference;
  lines.push(`control, objects dropping tick 10,000: ${dropped ? 'the same (the control FAILED)' : 'different, as it must be'}`);
  ok &&= !dropped;
  return { ok, lines };
}

const out = join(dir, '../perf/results', `${localDate()}-${LABEL}.json`);
if (!flag('agree') && existsSync(out)) throw new Error(`${out} exists: pass another --label`);
if (!flag('no-build')) {
  // The Rust fold first: Vite copies public/ into the build.
  execFileSync('cargo', ['build', '--release', '--target', 'wasm32-unknown-unknown'], { cwd: join(dir, 'fold'), stdio: 'inherit' });
  mkdirSync(join(dir, 'public/fold'), { recursive: true });
  copyFileSync(join(dir, 'fold/target/wasm32-unknown-unknown/release/feed_fold_spike.wasm'), join(dir, 'public/fold/fold.wasm'));
}
if (!flag('no-build')) await build({ root: dir, configFile: `${dir}/vite.config.ts`, logLevel: 'warn' });
const server = await serveApp(undefined, { webDir: dir, port: PORT });
if (flag('agree')) {
  try {
    const { ok, lines } = await agree(server.url);
    console.log(lines.join('\n'));
    if (!ok) process.exitCode = 1;
  } finally {
    await server.close();
  }
  process.exit();
}
const results: unknown[] = [];
try {
  for (const profile of PROFILE_NAMES)
    for (const rate of RATES)
      for (const fold of FOLDS) {
        const runs: Awaited<ReturnType<typeof once>>[] = [];
        for (let r = 0; r < RUNS; r++) runs.push(await once(server.url, rate, fold, profile));
        const pick = (f: (run: (typeof runs)[number]) => number) => round(median(runs.map(f)), 3);
        const summary = {
          profile, rate, fold, send: SEND, runs: runs.length,
          ticksPerSecond: pick((r) => r.ticksPerSecond),
          deliveredShare: pick((r) => r.deliveredShare),
          batchesPerSecond: pick((r) => r.batchesPerSecond),
          transportP50Ms: pick((r) => r.transportMs.p50),
          transportP95Ms: pick((r) => r.transportMs.p95),
          handlerP50Ms: pick((r) => r.handlerMs.p50),
          handlerP95Ms: pick((r) => r.handlerMs.p95),
          handlerUsPerTick: pick((r) => r.handlerUsPerTick),
          handlerMsPerSecond: pick((r) => r.handlerMsPerSecond),
          genP50Ms: SEND === 'batch' ? pick((r) => r.genMs!.p50) : null,
          mainBusyMsPerSecond: pick((r) => r.mainBusyMsPerSecond),
          workerBusyMsPerSecond: pick((r) => r.workerBusyMsPerSecond),
          gcPerTenSeconds: pick((r) => r.gc.perTenSeconds),
          gcTotalMs: pick((r) => r.gc.totalMs),
          gcLongestMs: pick((r) => r.gc.longestMs),
          minorFreedMiBPerSecond: pick((r) => r.gc.minorFreedMiBPerSecond),
          digests: [...new Set(runs.map((r) => r.digest.digest))],
        };
        console.log(JSON.stringify(summary));
        results.push({ summary, runs });
      }
} finally {
  await server.close();
}
writeFileSync(out, JSON.stringify({ date: localDate(), ...machineInfo(), windowMs: WINDOW_MS, settleMs: SETTLE_MS, results }, null, 2) + '\n');
console.log(`wrote ${out}`);
