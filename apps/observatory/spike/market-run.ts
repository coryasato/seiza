// The market watch spike's runs (throwaway; market watch's stops): both
// sides under a feed at each rate, cold, a few runs each (sizing, not the
// protocol).
// - tanstack: market.html, the feed spike's worker into an idiomatic store, React
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
//   mark), p50 and p95, over the batches with a tick to a row on screen
//   (`shownInCounted`; the bare host's feed ticks only visible rows);
// - late frames (rAF intervals over 1.5 frames), each main frame's work
//   p50 / p95 and the main thread's busy time (the trace's), V8's
//   collections on the main thread;
// - the throttle's control: a fixed busy loop timed on the page after the
//   window, which a 4× profile must slow ~4× (before it, a long task leaves
//   the DOM's frame scheduling a frame or so behind for the whole window).
// `--hold` adds each side's frame-late variant, Shown in's control: the
// reading must move by what the variant moves the side's mark, keeps up
// unchanged. TanStack's runs within one page (`?hold=alt`: each frame's
// batches committed a frame later in odd seconds of the page clock, so held
// and free batches share its frame scheduling): its control is
// `heldShownInP50Ms` against `freeShownInP50Ms` (one frame, ~16.7 ms) and
// `heldToCommitP50Ms` against `freeToCommitP50Ms`, the run's whole
// `shownInP50Ms` a mix of both. The bare host's is runs of their own
// (`?delay=17`: every re-read held, which moves its mark about two frames,
// a held read making the next wait), read against the free runs in the
// same mark → presentation state (`toPresentP50Ms`). `--measure` adds
// TanStack's `?measure`: Element Timing, the rejected second reading
// (`shownInEt*`), beside the trace's, from the same frames; kept so the
// method's results note reproduces. `--flash <ms>` and `--flash-all` (every
// numeric column flashing) set TanStack's flash to the bare host's workload
// (1 s, every float column), with `--sides tanstack`.
//
// Usage: node apps/observatory/spike/market-run.ts [--sides tanstack,gpui] [--rates 1000,5000,20000,50000]
//          [--profiles reference,throttled] [--runs 3] [--hold] [--measure] [--flash <ms>|0] [--flash-all] [--mode waapi|css|bg] [--no-build] [--label m10-a2-market]
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
const MEASURE = flag('measure');
/** The bare host's frame-late variant: every read held this long, which
 *  moves its refreshed mark about two frames, not one (a batch arriving
 *  while a held re-read is out waits for it, then for its own). */
const GPUI_HOLD_MS = 17;
const LABEL = option('label') ?? 'm10-a2-market';
const SETTLE_MS = 1000;
const WINDOW_MS = 10_000;
const CATEGORIES = [...LATENCY_CATEGORIES, 'blink', 'v8'];
const hostWebDir = join(dir, '../../../components/tall-table/host/web');

const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;
/** A p50, or null with nothing to take it of (`percentiles` answers 0). */
const p50OrNull = (values: number[]) => (values.length ? round(percentiles(values).p50) : null);

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
    side === 'gpui'
      ? { shape: 'narrow', live: String(rate), ...(flashMs === '0' ? {} : { flash: '' }), ...(hold ? { delay: String(GPUI_HOLD_MS) } : {}) }
      : { rate: String(rate), ...(hold ? { hold: 'alt' } : {}), ...(MEASURE ? { measure: '' } : {}), ...(flashMs ? { flash: flashMs } : {}), ...(option('mode') ? { mode: option('mode')! } : {}), ...(flag('flash-all') ? { 'flash-all': '1' } : {}) };
  const session = await open(chromium, side === 'gpui' ? url : `${url}market.html`, { profile, params, init: side === 'gpui' ? [frameRecorder, markLog] : [frameRecorder] });
  const { page } = session;
  try {
    if (side === 'gpui') await waitMark(page, 'tall-table:refreshed');
    else await page.waitForFunction(() => (globalThis as any).__market?.shown.length > 0, undefined, { timeout: 60_000 });
    await page.evaluate(() => document.fonts.ready);
    const browser = session.context.browser()!;
    await browser.startTracing(page, { categories: CATEGORIES });
    await page.evaluate((name) => performance.mark(name), ORIGIN_MARK);
    await page.waitForTimeout(SETTLE_MS);
    const from = await page.evaluate(() => performance.now());
    await page.waitForTimeout(WINDOW_MS);
    const to = await page.evaluate(() => performance.now());
    const trace = new Trace(JSON.parse((await browser.stopTracing()).toString()));
    // After the window: a long task leaves the DOM's frame scheduling in
    // another state (commit → presentation 19 ms before one, 31 after).
    const spinMs = await spin(page);

    let batches: Batch[];
    /** The batches with a tick to a row on screen: only these count in Shown in. */
    let onScreen: (batch: Batch) => boolean = () => true;
    let shown: Batch[];
    /** Element Timing's paints by the sequence drawn (TanStack with `?measure`). */
    const painted = new Map<number, number>();
    /** TanStack's batches held a frame (`?hold=alt`), each batch by its own frame. */
    let held = new Set<number>();
    if (side === 'gpui') {
      const log: [string, number, number][] = await page.evaluate(() => (globalThis as any).__marketLog);
      batches = log.filter(([k]) => k === 'invalidated').map(([, id, at]) => ({ id, at }));
      shown = log.filter(([k]) => k === 'refreshed').map(([, id, at]) => ({ id, at }));
    } else {
      const record: { batches: [number, number][]; shown: [number, number][]; visible: [number, number][]; painted: [number, number][] } = await page.evaluate(() => (globalThis as any).__market);
      // A batch with no tick to a row on screen shows nothing to time.
      const seen = new Set(record.visible.filter(([, ticks]) => ticks > 0).map(([seq]) => seq));
      batches = record.batches.map(([id, at]) => ({ id, at }));
      onScreen = (batch) => seen.has(batch.id);
      held = new Set((record as unknown as { held: number[] }).held);
      for (const [seq, at] of record.painted) painted.set(seq, Math.min(at, painted.get(seq) ?? Infinity));
      shown = record.shown.map(([id, at]) => ({ id, at }));
    }
    const inWindow = (b: Batch) => b.at >= from && b.at <= to;
    const shownInWindow = shown.filter(inWindow);
    const batchesInWindow = batches.filter(inWindow);
    if (!batchesInWindow.length) throw new Error(`${side} ${rate}: no batch in the window`);
    const latencies: number[] = [];
    const etLatencies: number[] = [];
    /** With `?hold=alt`, each batch's Shown in and its commit by whether it was held. */
    const split = { held: [] as number[], free: [] as number[], heldCommit: [] as number[], freeCommit: [] as number[] };
    const toCommit: number[] = [];
    const toPresent: number[] = [];
    let inFrame = 0;
    const counted = batchesInWindow.filter(onScreen);
    for (const batch of counted) {
      const first = shown.find((s) => s.id >= batch.id && s.at >= batch.at);
      if (!first || first.at > to) continue;
      const presented = trace.presentationOf(trace.toTrace(first.at));
      if (!presented) continue;
      latencies.push(trace.toPage(presented.at) - batch.at);
      toCommit.push(first.at - batch.at);
      toPresent.push(trace.toPage(presented.at) - first.at);
      if (presented.inFrame) inFrame++;
      if (side === 'tanstack' && hold) {
        const kind = held.has(batch.id) ? 'held' : 'free';
        split[kind].push(trace.toPage(presented.at) - batch.at);
        split[`${kind}Commit`].push(first.at - batch.at);
      }
      const paint = painted.get(first.id);
      if (paint !== undefined) etLatencies.push(paint - batch.at);
    }
    const work = frameWork(trace, from, to);
    const per = percentiles(work.frames.map((f) => f.ms));
    const intervals = frameIntervals(await recordedBetween(page, from, to));
    const gcs = trace.mainThread(trace.toTrace(from), trace.toTrace(to)).filter((e) => e.name === 'MinorGC' || e.name === 'MajorGC');
    const shownIn = percentiles(latencies);
    const shownInEt = percentiles(etLatencies);
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
      shownInEtP50Ms: etLatencies.length ? round(shownInEt.p50) : null,
      shownInEtP95Ms: etLatencies.length ? round(shownInEt.p95) : null,
      shownInEtMatched: etLatencies.length,
      shownInCounted: counted.length,
      ...(side === 'tanstack' && hold
        ? { heldShownInP50Ms: p50OrNull(split.held), freeShownInP50Ms: p50OrNull(split.free), heldToCommitP50Ms: p50OrNull(split.heldCommit), freeToCommitP50Ms: p50OrNull(split.freeCommit), heldCounted: split.held.length, freeCounted: split.free.length }
        : {}),
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
        // TanStack's control runs within one page (`?hold=alt`); GPUI's as runs of its own.
        for (const hold of HOLD ? [false, true] : [false]) {
          const runs: Awaited<ReturnType<typeof once>>[] = [];
          for (let r = 0; r < RUNS; r++) runs.push(await once(servers[side]!.url, side, rate, profile, hold));
          const pick = (f: (run: (typeof runs)[number]) => number | null | undefined) => {
            const values = runs.map(f).filter((v): v is number => typeof v === "number");
            return values.length ? round(median(values), 2) : null;
          };
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
