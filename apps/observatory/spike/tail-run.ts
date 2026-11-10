// Live tail's spike runs (throwaway; the live tail's spike):
// both sides on the NASA logs' file, read whole and registered as a `File`,
// read a page at a time through DuckDB-Wasm, the rows growing by the clock
// worker's counts, following from the open (tail/gpui.html: the tall table
// built `follow`, crate `tail-spike`; tail/dom.html: React and TanStack
// Virtual following on a scaled native scroller). Cold, a few runs each
// (sizing the stops, not the protocol).
//
// Per run: until the table follows a tail, 1 s to settle, then 10 s traced:
// - keeps up: the frames that drew a grown tail (GPUI's `TailDrawn`, the
//   DOM's commits that drew a new last row) over the lesser of the batches
//   sent and the display's frames;
// - Row shown in: a batch's post stamp → the presentation of the first frame
//   whose drawn tail reaches the batch's count (the trace's
//   `AnimationFrame::Presentation` for the frame holding the side's log
//   entry), p50 and p95;
// - late frames (rAF intervals over 1.5 frames), each main frame's work and
//   the busy time, V8's collections;
// then the scroll back: a 300 px gesture up at 10,000 px/s under the feed,
// `EventLatency` from the event to the first frame it reached
// (`readInputs`), following let go and the top row unmoved 1 s on; its
// control the same gesture with the clock paused, after End brought the
// view back to the tail; then the throttle's busy-loop control.
// `--hold` adds each side's frame-late variant (17 ms before each count is
// applied on GPUI, each landing on the DOM): Row shown in's control.
// `--soak <minutes>`: one run per side at each rate, untraced, memory
// (`measureUserAgentSpecificMemory`) every 30 s with the interval's late
// frames and keeps up: the soak's curve.
//
// Usage: node apps/observatory/spike/tail-run.ts [--sides gpui,tanstack] [--rates 1000,10000,50000,100000]
//          [--profiles reference,throttled] [--runs 3] [--hold] [--no-scroll] [--soak <minutes>] [--no-build] [--label m11-a2-tail]

import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { build } from 'vite';
import { frameIntervals, frameRecorder, gesture, recordedBetween } from '../../../shared-web/perf/harness.ts';
import { PROFILES, flag, localDate, machineInfo, median, option, percentiles } from '../../../shared-web/perf/protocol.ts';
import { serveApp } from '../../../shared-web/perf/serve.ts';
import { FRAME_MS, LATENCY_CATEGORIES, ORIGIN_MARK, Trace, frameWork, lateFrames } from '../../../shared-web/perf/trace.ts';
import { memoryOf, readInputs, type MemoryEntry } from '../metrics/metrics.ts';
import { openSide, type Session } from '../perf/contender.ts';

type Side = 'gpui' | 'tanstack';
const dir = import.meta.dirname;
const tailDir = join(dir, 'tail');
const root = join(dir, '../../..');
const SIDES = (option('sides') ?? 'gpui,tanstack').split(',') as Side[];
const RATES = (option('rates') ?? '1000,10000,50000,100000').split(',').map(Number);
const PROFILE_NAMES = (option('profiles') ?? 'reference,throttled').split(',');
const RUNS = Number(option('runs') ?? 3);
const HOLD = flag('hold');
const SCROLL = !flag('no-scroll');
const SOAK_MIN = option('soak') ? Number(option('soak')) : 0;
const LABEL = option('label') ?? (SOAK_MIN ? 'm11-a2-tail-soak' : 'm11-a2-tail');
const SETTLE_MS = 1000;
const WINDOW_MS = Number(option('window') ?? 10_000);
const SOAK_EVERY_MS = 30_000;
const GESTURE_PX = 300;
const GESTURE_SPEED = 10_000;
const HELD_MS = 1000;
const CATEGORIES = [...LATENCY_CATEGORIES, 'blink', 'v8'];
/** Over the row numbers, halfway down: a gesture's point on both sides. */
const REST = { x: 60, y: 450 };

const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;
const p50OrNull = (values: number[]) => (values.length ? round(percentiles(values).p50) : null);

interface TailLog {
  batches: [number, number][];
  drawn(): [number, number][];
  following(): [number, number][];
  moved?(): [number, number][];
  view(): [number, number];
  pause(on: boolean): void;
  open: number;
}
type Pair = [number, number];
const logs = (page: Page): Promise<{ batches: Pair[]; drawn: Pair[]; following: Pair[]; moved: Pair[] }> =>
  page.evaluate(() => {
    const tail = (globalThis as unknown as { __tail: TailLog }).__tail;
    return { batches: tail.batches.slice(), drawn: tail.drawn().slice(), following: tail.following().slice(), moved: tail.moved?.().slice() ?? [] };
  });
const view = (page: Page): Promise<Pair> => page.evaluate(() => (globalThis as unknown as { __tail: TailLog }).__tail.view());
const pause = (page: Page, on: boolean) => page.evaluate((on) => (globalThis as unknown as { __tail: TailLog }).__tail.pause(on), on);
const pageNow = (page: Page): Promise<number> => page.evaluate(() => performance.now());
const mark = (page: Page, name: string) => page.evaluate((name) => void performance.mark(name), name);

/** The throttle's control: a fixed loop's time on the page. */
const spin = (page: Page) =>
  page.evaluate(() => {
    const t0 = performance.now();
    let x = 0;
    for (let i = 0; i < 3e7; i++) x = (x + i * 7) % 1000003;
    return [performance.now() - t0, x][0]!;
  });

/** Init script: every wasm memory the page instantiates (`perf/metric-memory.ts`'s). */
function wasmRecorder(): void {
  const g = globalThis as { __wasmMemories?: WebAssembly.Memory[] };
  g.__wasmMemories = [];
  const keep = (result: WebAssembly.WebAssemblyInstantiatedSource | WebAssembly.Instance) => {
    const instance = 'instance' in result ? result.instance : result;
    for (const value of Object.values(instance.exports)) if (value instanceof WebAssembly.Memory) g.__wasmMemories!.push(value);
    return result;
  };
  const streaming = WebAssembly.instantiateStreaming;
  WebAssembly.instantiateStreaming = (...args) => streaming(...args).then(keep) as never;
}

async function openTail(url: string, side: Side, rate: number, profileName: string, hold: boolean): Promise<Session> {
  const profile = PROFILES.find((p) => p.name === profileName)!;
  const session = await openSide(side, `${url}${side === 'gpui' ? 'gpui' : 'dom'}.html`, profile, {
    init: [frameRecorder, wasmRecorder],
    args: SOAK_MIN ? ['--enable-blink-features=ForceEagerMeasureMemory'] : [],
    params: { rate: String(rate), ...(hold ? { hold: '' } : {}) },
  });
  await session.page.waitForFunction(() => {
    const tail = (globalThis as unknown as { __tail?: TailLog }).__tail;
    return tail && tail.open > 0 && tail.drawn().length > 2;
  }, undefined, { timeout: 180_000, polling: 100 });
  await session.page.evaluate(() => document.fonts.ready);
  return session;
}

/** The feed's readings between two page times. */
function feedReadings(trace: Trace | null, batches: Pair[], drawn: Pair[], from: number, to: number) {
  const inWindow = ([, at]: Pair) => at >= from && at <= to;
  const sent = batches.filter(inWindow);
  const drew = drawn.filter(inWindow);
  const latencies: number[] = [];
  const toDraw: number[] = [];
  let behind = 0;
  if (trace)
    for (const [rows, at] of sent) {
      const first = drawn.find(([n, t]) => n >= rows && t >= at);
      if (!first || first[1] > to + 2000) {
        behind++;
        continue;
      }
      const presented = trace.presentationOf(trace.toTrace(first[1]));
      if (!presented) continue;
      latencies.push(trace.toPage(presented.at) - at);
      toDraw.push(first[1] - at);
    }
  const shownIn = percentiles(latencies);
  return {
    keepsUpPct: round(Math.min(1, drew.length / Math.max(1, Math.min(sent.length, (to - from) / FRAME_MS))) * 100, 1),
    batchesPerSecond: round((sent.length * 1000) / (to - from), 1),
    drawnPerSecond: round((drew.length * 1000) / (to - from), 1),
    rowShownInP50Ms: latencies.length ? round(shownIn.p50) : null,
    rowShownInP95Ms: latencies.length ? round(shownIn.p95) : null,
    toDrawP50Ms: p50OrNull(toDraw),
    matched: latencies.length,
    unmatched: behind,
    /** How far the drawn tail trails the rows due at the window's end. */
    tailBehindRows: (sent.at(-1)?.[0] ?? 0) - (drew.at(-1)?.[0] ?? 0),
  };
}

/** The scroll back: a gesture up, then the view held `HELD_MS`. */
async function scrollBack(session: Session, index: number) {
  const { page } = session;
  await mark(page, `input:${index}`);
  const sent = await pageNow(page);
  await gesture(page, REST, { y: GESTURE_PX, speed: GESTURE_SPEED }, { scaleByDpr: session.side === 'gpui' });
  await page.waitForTimeout(300);
  const [top] = await view(page);
  await page.waitForTimeout(HELD_MS);
  const [after] = await view(page);
  await mark(page, `input:${index}:end`);
  const { following } = await logs(page);
  return { sent, letGo: following.some(([on, at]) => on === 0 && at >= sent), held: top === after, top, after };
}

async function once(url: string, side: Side, rate: number, profileName: string, hold: boolean) {
  const session = await openTail(url, side, rate, profileName, hold);
  const { page } = session;
  try {
    const browser = session.context.browser()!;
    await browser.startTracing(page, { categories: CATEGORIES });
    await mark(page, ORIGIN_MARK);
    await page.waitForTimeout(SETTLE_MS);
    const from = await pageNow(page);
    await page.waitForTimeout(WINDOW_MS);
    const to = await pageNow(page);
    let back: Awaited<ReturnType<typeof scrollBack>> | null = null;
    let control: Awaited<ReturnType<typeof scrollBack>> | null = null;
    if (SCROLL && !hold) {
      back = await scrollBack(session, 0);
      // The control: the clock paused, End back to the tail, the same gesture.
      await pause(page, true);
      if (side === 'tanstack') await page.focus('.scroller');
      await page.keyboard.press('End');
      await page.waitForTimeout(500);
      control = await scrollBack(session, 1);
    }
    const trace = new Trace(JSON.parse((await browser.stopTracing()).toString()));
    const spinMs = await spin(page);
    const { batches, drawn } = await logs(page);
    const feed = feedReadings(trace, batches, drawn, from, to);
    const work = frameWork(trace, from, to);
    const per = percentiles(work.frames.map((f) => f.ms));
    const intervals = frameIntervals(await recordedBetween(page, from, to));
    const gcs = trace.mainThread(trace.toTrace(from), trace.toTrace(to)).filter((e) => e.name === 'MinorGC' || e.name === 'MajorGC');
    const inputs = back ? readInputs(trace, side, 'wheel') : [];
    // By the frame (GPUI): the gesture's first event → the presentation of
    // the first frame that drew the view moved (its probe, the response
    // metric's guard). GPUI's wheel often reaches no frame in `EventLatency`
    // under the feed; the control, with both, checks the two agree.
    const { moved } = await logs(page);
    const byFrame = (index: number, sentAt: number | undefined): number | null => {
      if (sentAt === undefined) return null;
      const start = trace.marks(new RegExp(`^input:${index}$`))[0]?.ts;
      const end = trace.marks(new RegExp(`^input:${index}:end$`))[0]?.ts;
      if (start === undefined || end === undefined) return null;
      const first = trace.events.find((e) => e.name === 'EventLatency' && e.ph === 'b' && e.ts >= start && e.ts <= end && ['MOUSE_WHEEL', 'FIRST_GESTURE_SCROLL_UPDATE', 'GESTURE_SCROLL_UPDATE'].includes(e.args?.event_latency?.event_type));
      const drew = moved.find(([, at]) => at >= sentAt);
      if (!first || !drew) return null;
      const presented = trace.presentationOf(trace.toTrace(drew[1]));
      return presented === null ? null : round((presented.at - first.ts) / 1000);
    };
    if (session.problems.length) throw new Error(`${side} ${rate}: ${session.problems.join('; ')}`);
    return {
      spinMs: round(spinMs),
      ...feed,
      latePct: round(lateFrames(intervals).share * 100, 1),
      workP50Ms: round(per.p50),
      workP95Ms: round(per.p95),
      busyMsPerSecond: round(work.busyMs / ((to - from) / 1000)),
      gcPerTenSeconds: round((gcs.length * 10_000) / (to - from), 1),
      gcLongestMs: round(Math.max(0, ...gcs.map((e) => (e.dur ?? 0) / 1000))),
      backMs: inputs[0]?.ms ?? null,
      backType: inputs[0]?.type ?? null,
      backFrameMs: byFrame(0, back?.sent),
      backLetGo: back?.letGo ?? null,
      backHeld: back?.held ?? null,
      controlMs: inputs[1]?.ms ?? null,
      controlFrameMs: byFrame(1, control?.sent),
      controlLetGo: control?.letGo ?? null,
      controlHeld: control?.held ?? null,
    };
  } finally {
    await session.close();
  }
}

async function memory(session: Session) {
  const { page } = session;
  const breakdown = await page.evaluate(async () => (await (performance as Performance & { measureUserAgentSpecificMemory(): Promise<{ breakdown: unknown[] }> }).measureUserAgentSpecificMemory()).breakdown);
  const { pageBytes, workerBytes, pageByType } = memoryOf(breakdown as MemoryEntry[]);
  const wasmBytes = await page.evaluate(() => ((globalThis as { __wasmMemories?: WebAssembly.Memory[] }).__wasmMemories ?? []).reduce((sum, m) => sum + m.buffer.byteLength, 0));
  const mib = (b: number) => round(b / 2 ** 20, 1);
  return { pageMiB: mib(pageBytes), workerMiB: mib(workerBytes), jsMiB: mib(pageByType['JavaScript'] ?? 0), canvasMiB: mib(pageByType['Canvas'] ?? 0), domMiB: mib(pageByType['DOM'] ?? 0), wasmMiB: mib(wasmBytes) };
}

async function soak(url: string, side: Side, rate: number, profileName: string) {
  const session = await openTail(url, side, rate, profileName, false);
  const { page } = session;
  const samples: unknown[] = [];
  try {
    const start = await pageNow(page);
    samples.push({ s: 0, ...(await memory(session)) });
    for (let at = SOAK_EVERY_MS; at <= SOAK_MIN * 60_000; at += SOAK_EVERY_MS) {
      const from = await pageNow(page);
      await page.waitForTimeout(start + at - from);
      const to = await pageNow(page);
      const { batches, drawn } = await logs(page);
      const feed = feedReadings(null, batches, drawn, from, to);
      const intervals = frameIntervals(await recordedBetween(page, from, to));
      const [, rows] = await view(page);
      const sample = { s: round(at / 1000, 0), rows, keepsUpPct: feed.keepsUpPct, tailBehindRows: feed.tailBehindRows, latePct: round(lateFrames(intervals).share * 100, 1), ...(await memory(session)) };
      console.log(JSON.stringify({ side, rate, ...sample }));
      samples.push(sample);
    }
    if (session.problems.length) throw new Error(`${side} ${rate}: ${session.problems.join('; ')}`);
    return samples;
  } finally {
    await session.close();
  }
}

const out = join(dir, '../perf/results', `${localDate()}-${LABEL}.json`);
if (existsSync(out)) throw new Error(`${out} exists: pass another --label`);
if (!flag('no-build')) {
  const target = join(root, 'target/wasm32-unknown-unknown/release/tail_spike.wasm');
  const pkg = join(tailDir, 'pkg');
  execFileSync('cargo', ['build', '-p', 'tail-spike', '--target', 'wasm32-unknown-unknown', '--release'], { cwd: root, stdio: 'inherit' });
  execFileSync('wasm-bindgen', [target, '--out-dir', pkg, '--target', 'web'], { stdio: 'inherit' });
  const features = ['bulk-memory', 'nontrapping-float-to-int', 'sign-ext', 'mutable-globals', 'reference-types', 'multivalue', 'threads'].map((f) => `--enable-${f}`);
  execFileSync('wasm-opt', ['-Oz', ...features, `${pkg}/tail_spike_bg.wasm`, '-o', `${pkg}/tail_spike_bg.wasm`], { stdio: 'inherit' });
  await build({ root: tailDir, configFile: join(tailDir, 'vite.config.ts'), logLevel: 'warn' });
}
const server = await serveApp(undefined, { webDir: tailDir, port: 4368 });
const results: unknown[] = [];
try {
  for (const profile of PROFILE_NAMES)
    for (const rate of RATES)
      for (const side of SIDES) {
        if (SOAK_MIN) {
          const samples = await soak(server.url, side, rate, profile);
          results.push({ profile, rate, side, minutes: SOAK_MIN, samples });
          continue;
        }
        for (const hold of HOLD ? [false, true] : [false]) {
          const runs: Awaited<ReturnType<typeof once>>[] = [];
          for (let r = 0; r < RUNS; r++) runs.push(await once(server.url, side, rate, profile, hold));
          const pick = (f: (run: (typeof runs)[number]) => unknown) => {
            const values = runs.map(f).filter((v): v is number => typeof v === 'number');
            return values.length ? round(median(values), 2) : null;
          };
          const keys = Object.keys(runs[0]!) as (keyof (typeof runs)[number])[];
          const summary = {
            profile, rate, side: hold ? `${side}-hold` : side, runs: runs.length,
            ...Object.fromEntries(keys.map((key) => [key, typeof runs[0]![key] === 'boolean' ? runs.map((r) => r[key]) : pick((r) => r[key])])),
            keepsUpPctRuns: runs.map((r) => r.keepsUpPct),
            rowShownInP50Runs: runs.map((r) => r.rowShownInP50Ms),
          };
          console.log(JSON.stringify(summary));
          results.push({ summary, runs });
        }
      }
} finally {
  await server.close();
}
writeFileSync(out, JSON.stringify({ date: localDate(), ...machineInfo(), windowMs: WINDOW_MS, settleMs: SETTLE_MS, results }, null, 2) + '\n');
console.log(`wrote ${out}`);
