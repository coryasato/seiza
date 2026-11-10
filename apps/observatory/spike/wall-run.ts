// The monitoring wall's spike runs (throwaway): both sides
// with N tables under the feed (wall/gpui.html: N tall tables in one
// window, crate `wall-spike`; wall/dom.html: N TanStack Virtual tables in
// one React tree), each table a desk of 50 at `--rate` ticks a second a
// desk. Cold, a few runs each (sizing the stops, not the protocol).
//
// Per run: once a frame has drawn a re-read (`wall:refreshed`), 1 s to
// settle, then 10 s traced, read as `metric-feed` reads market watch
// (metrics/metrics.ts's `shownIn`, `collections`, `frameWork`), with each
// batch paired across the tables (the wall's contract): a batch's frame is the
// first `wall:refreshed` at or after its send at which every table whose
// on-screen rows it ticked (its mask) has drawn the batch's generation.
// - keeps up: the distinct frames among those over the lesser of the
//   visible batches and the display's frames (market watch's measure);
// - Shown in: a batch's send → the presentation of its frame, p50 and p95;
//   beside it Shown in to the first frame where any table of its mask drew
//   it (`anyShownIn`), and the batches whose tables drew it in different
//   frames (`splitPct`): what pooling costs a side that draws tables apart;
// - late frames, work a frame, the busy time, and collection pauses;
// then the throttle's busy-loop control.
// `--drop <seq>` drops that batch on both sides: the gap check's control.
// `--hold` adds each side's frame-late variant (GPUI: every batch held
// 17 ms; TanStack: each frame's commit a frame later): Shown in's control.
//
// Usage: node apps/observatory/spike/wall-run.ts [--sides gpui,tanstack] [--tables 4,6,8]
//          [--rate 2000] [--profiles reference,throttled] [--runs 3] [--hold] [--drop <seq>] [--no-build] [--label m13-a2-wall]

import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { build } from 'vite';
import { frameIntervals, frameRecorder, recordedBetween, waitMark } from '../../../shared-web/perf/harness.ts';
import { PROFILES, flag, localDate, machineInfo, median, option, percentiles } from '../../../shared-web/perf/protocol.ts';
import { serveApp } from '../../../shared-web/perf/serve.ts';
import { FRAME_MS, ORIGIN_MARK, Trace, WORK_CATEGORIES, collections, frameWork, lateFrames, shownIn, type BatchShown } from '../metrics/metrics.ts';
import { openSide } from '../perf/contender.ts';
import { spin, throttleCheck } from '../perf/throttle-control.ts';

type Side = 'gpui' | 'tanstack';
const dir = import.meta.dirname;
const wallDir = join(dir, 'wall');
const root = join(dir, '../../..');
const SIDES = (option('sides') ?? 'gpui,tanstack').split(',') as Side[];
const TABLES = (option('tables') ?? '4,6,8').split(',').map(Number);
const RATE = Number(option('rate') ?? 2000);
const PROFILE_NAMES = (option('profiles') ?? 'reference,throttled').split(',');
const RUNS = Number(option('runs') ?? 3);
const HOLD = flag('hold');
/** `--drop <seq>`: the gap check's control, every run must fail it. */
const DROP = option('drop');
const LABEL = option('label') ?? 'm13-a2-wall';
const SETTLE_MS = 1000;
const WINDOW_MS = 10_000;

const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;
const p = (values: number[]) => (values.length ? percentiles(values) : null);

interface WallLog {
  batches(): number[][];
  refreshed(): number[][];
  failures(): string[];
  tables: number;
}

/** Every batch the worker sent reached the side's log, in order: its
 *  sequences run 0, 1, 2, … with no gap (the worker numbers each batch it
 *  posts); a refused or lost batch is a failure, never a gap the readings
 *  pass over. */
function gaps(batches: number[][]): string[] {
  const at = batches.findIndex(([seq], index) => seq !== index);
  return at < 0 ? [] : [`the log's batch ${at} is sequence ${batches[at]![0]}: a batch is missing or out of order`];
}

/** Pairs each visible batch in the window with its frame: pooled (every
 *  table of its mask drew it) and any (the first table did). */
function pair(batches: number[][], refreshed: number[][], from: number, to: number) {
  const inWindow = batches.filter(([, , sent]) => sent! >= from && sent! <= to);
  const visible = inWindow.filter(([, , , mask]) => mask! > 0);
  const pooled: BatchShown[] = [];
  const any: BatchShown[] = [];
  let split = 0;
  for (const [, , sent, mask, ...gens] of visible) {
    const tables = gens.map((_, d) => d).filter((d) => mask! & (1 << d));
    const drew = (frame: number[], d: number) => frame[1 + d]! >= gens[d]!;
    const all = refreshed.find((frame) => frame[0]! >= sent! && tables.every((d) => drew(frame, d)));
    const first = refreshed.find((frame) => frame[0]! >= sent! && tables.some((d) => drew(frame, d)));
    if (all && all[0]! <= to) pooled.push({ sent: sent!, mark: all[0]! });
    if (first && first[0]! <= to) any.push({ sent: sent!, mark: first[0]! });
    if (all && first && all[0] !== first[0]) split++;
  }
  const frames = new Set(pooled.map(({ mark }) => mark)).size;
  const most = Math.min(visible.length, (to - from) / FRAME_MS);
  return { sent: inWindow.length, visible: visible.length, pooled, any, split, frames, share: most > 0 ? Math.min(1, frames / most) : 0 };
}

async function once(url: string, side: Side, tables: number, profileName: string, hold: boolean) {
  const profile = PROFILES.find((p) => p.name === profileName)!;
  const session = await openSide(side, `${url}${side === 'gpui' ? 'gpui' : 'dom'}.html`, profile, {
    init: [frameRecorder],
    params: { tables: String(tables), rate: String(RATE), ...(hold ? { hold: '' } : {}), ...(DROP ? { drop: DROP } : {}) },
  });
  const { page, browser } = session;
  try {
    await waitMark(page, 'wall:refreshed', 0, 180_000);
    await page.evaluate(() => document.fonts.ready);
    await browser.startTracing(page, { categories: WORK_CATEGORIES });
    await page.evaluate((name) => performance.mark(name), ORIGIN_MARK);
    await page.waitForTimeout(SETTLE_MS);
    const from = await page.evaluate(() => performance.now());
    await page.waitForTimeout(WINDOW_MS);
    const to = await page.evaluate(() => performance.now());
    const trace = new Trace(JSON.parse((await browser.stopTracing()).toString()));
    const spinMs = await spin(page);
    const throttled = throttleCheck(side, profile, spinMs);
    const { batches, refreshed, refused } = await page.evaluate(() => {
      const wall = (globalThis as unknown as { __wall: WallLog }).__wall;
      return { batches: wall.batches(), refreshed: wall.refreshed(), refused: wall.failures() };
    });
    const fed = pair(batches, refreshed, from, to);
    const read = shownIn(trace, fed.pooled);
    const readAny = shownIn(trace, fed.any);
    const [shown, shownAny, toMark, toPresent] = [p(read.ms), p(readAny.ms), p(read.toMark), p(read.toPresent)];
    const work = frameWork(trace, from, to);
    const perFrame = percentiles(work.frames.map((frame) => frame.ms));
    const recorded = await recordedBetween(page, from, to);
    const seconds = (to - from) / 1000;
    const failures = [...session.problems, ...(throttled ? [throttled] : []), ...(fed.frames ? [] : ['no visible batch shown']), ...refused, ...gaps(batches)];
    if (failures.length) console.warn(`${side} ${tables} ${profileName}: ${failures.join('; ')}`);
    return {
      batchesPerSecond: round(fed.sent / seconds, 1),
      visiblePerSecond: round(fed.visible / seconds, 1),
      shownPerSecond: round(fed.frames / seconds, 1),
      keepsUpPct: round(fed.share * 100, 1),
      shownInP50Ms: shown && round(shown.p50),
      shownInP95Ms: shown && round(shown.p95),
      anyShownInP50Ms: shownAny && round(shownAny.p50),
      splitPct: round((fed.split / Math.max(1, fed.visible)) * 100, 1),
      toMarkP50Ms: toMark && round(toMark.p50),
      toPresentP50Ms: toPresent && round(toPresent.p50),
      unpaired: fed.visible - fed.pooled.length + read.unpresented,
      latePct: round(lateFrames(frameIntervals(recorded)).share * 100, 1),
      workP50Ms: round(perFrame.p50),
      workP95Ms: round(perFrame.p95),
      busyMsPerSecond: round(work.busyMs / seconds, 1),
      collections: collections(trace, from, to, recorded.map((frame) => frame.t)),
      spinMs: round(spinMs, 1),
      /** Every batch in the log since the feed started, the window's and before. */
      logged: batches.length,
      failures,
    };
  } finally {
    await session.close();
  }
}

const out = join(dir, '../perf/results', `${localDate()}-${LABEL}.json`);
if (existsSync(out)) throw new Error(`${out} exists: pass another --label`);
if (!flag('no-build')) {
  const target = join(root, 'target/wasm32-unknown-unknown/release/wall_spike.wasm');
  const pkg = join(wallDir, 'pkg');
  execFileSync('cargo', ['build', '-p', 'wall-spike', '--target', 'wasm32-unknown-unknown', '--release'], { cwd: root, stdio: 'inherit' });
  execFileSync('wasm-bindgen', [target, '--out-dir', pkg, '--target', 'web'], { stdio: 'inherit' });
  const features = ['bulk-memory', 'nontrapping-float-to-int', 'sign-ext', 'mutable-globals', 'reference-types', 'multivalue', 'threads'].map((f) => `--enable-${f}`);
  execFileSync('wasm-opt', ['-Oz', ...features, `${pkg}/wall_spike_bg.wasm`, '-o', `${pkg}/wall_spike_bg.wasm`], { stdio: 'inherit' });
  await build({ root: wallDir, configFile: join(wallDir, 'vite.config.ts'), logLevel: 'warn' });
}
const server = await serveApp(undefined, { webDir: wallDir, port: 4385 });
const results: unknown[] = [];
try {
  for (const profile of PROFILE_NAMES)
    for (const tables of TABLES)
      for (const side of SIDES)
        for (const hold of HOLD ? [false, true] : [false]) {
          const runs: Awaited<ReturnType<typeof once>>[] = [];
          for (let r = 0; r < RUNS; r++) runs.push(await once(server.url, side, tables, profile, hold));
          const pick = (f: (run: (typeof runs)[number]) => number | null) => {
            const values = runs.map(f).filter((v): v is number => typeof v === 'number');
            return values.length ? round(median(values)) : null;
          };
          const summary = {
            profile, tables, rate: RATE, side: hold ? `${side}-hold` : side, runs: runs.length,
            keepsUpPct: pick((r) => r.keepsUpPct),
            keepsUpPctRuns: runs.map((r) => r.keepsUpPct),
            shownInP50Ms: pick((r) => r.shownInP50Ms),
            shownInP95Ms: pick((r) => r.shownInP95Ms),
            anyShownInP50Ms: pick((r) => r.anyShownInP50Ms),
            splitPct: pick((r) => r.splitPct),
            toMarkP50Ms: pick((r) => r.toMarkP50Ms),
            toPresentP50MsRuns: runs.map((r) => r.toPresentP50Ms),
            latePct: pick((r) => r.latePct),
            workP50Ms: pick((r) => r.workP50Ms),
            workP95Ms: pick((r) => r.workP95Ms),
            busyMsPerSecond: pick((r) => r.busyMsPerSecond),
            collectionsIn10s: pick((r) => r.collections.count),
            collectionLongestMs: pick((r) => r.collections.longestMs),
            collectionsInLateFrame: pick((r) => r.collections.inLateFrame),
            visiblePerSecond: pick((r) => r.visiblePerSecond),
            batchesPerSecond: pick((r) => r.batchesPerSecond),
            spinMs: pick((r) => r.spinMs),
            failures: runs.flatMap((r) => r.failures),
          };
          console.log(JSON.stringify(summary));
          results.push({ summary, runs });
        }
} finally {
  await server.close();
}
writeFileSync(out, JSON.stringify({ date: localDate(), ...machineInfo(), windowMs: WINDOW_MS, settleMs: SETTLE_MS, rate: RATE, results }, null, 2) + '\n');
console.log(`wrote ${out}`);
