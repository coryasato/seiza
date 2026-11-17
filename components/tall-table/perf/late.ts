// What a late frame in the fling is made of, build against build (why a
// feature's build can read more late frames than the base at the same frame
// work: perf/CLAUDE.md, "Perf script gotchas"). Builds kept aside are served side by side and run in
// turn (the order reversed every round), each run cold and as `perf.ts`
// runs its fling: the steady scroll first, Home, then the fling traced on
// its own, with `workRecorder` and `frameRecorder` installed.
//
// Each late rAF interval (over `LATE_FRAME_MS`) is read against the trace:
// the main frame that ran in the rAF before it (its start after the rAF's
// time, its work and parts), the main thread's busy time outside frames up
// to the late rAF, and what's left (idle: the main thread free and no frame
// begun). Its cause is the first that holds:
//
// - `long`: the frame before worked longer than a refresh;
// - `outside`: it fit a refresh, and with the tasks outside any frame in
//   the interval it didn't (each named by its longest event past the
//   scheduler's wrappers);
// - `idle`: neither: the main thread was free for the rest.
//
// Beside it, every main frame's work (so the two modes show), and the
// trace's events inside the frames by name (each event's whole duration,
// nested ones counted in their parents too), long frames against the rest.
//
// The timer tasks outside frames (GPUI's executor: on the web a spawned
// task runs from a timer, so a page's read and landing) are counted and
// timed for each build, since a frame that fits a refresh is late when one
// runs beside it.
//
// --cpu samples the page's CPU through the fling (CDP's profiler, every
// 250 µs) and prints the functions on the stack (inclusive ms a run) inside
// those timer tasks, inside the slow frames, and inside the rest. It slows
// the page: a run with it attributes the work and isn't a reading of the
// late share. The release build has no function names (`strip = true`): a
// build that keeps them is the host built with
// `CARGO_PROFILE_RELEASE_STRIP=false` into its own target dir, through
// wasm-bindgen, then the justfile's wasm-opt flags with `-g`, bundled with
// its own bindings (their closure names differ from the stripped build's).
//
// Usage: node components/tall-table/perf/late.ts --builds base,follow
//          [--runs 10] [--shape wide] [--profile throttled] [--traces] [--each] [--cpu]
//          [--label <name>]
// A build is a kept `host/web/dist`: perf/results/raw/late-builds/<name>/
// (`just tall-table build <features>`, then copy `host/web/dist` there).
// --traces keeps each run's trace beside them; --each prints every late
// interval; --label writes
// perf/results/<date>-<label>.json.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright';
import { fling, frameRecorder, open, recordedBetween, waitMark, wheel, workBetween, workRecorder, type RecordedFrame } from '../../../shared-web/perf/harness.ts';
import { PROFILES, flag, localDate, machineInfo, median, option, percentiles, type Profile } from '../../../shared-web/perf/protocol.ts';
import { serveApp } from '../../../shared-web/perf/serve.ts';
import { FRAME_MS, LATE_FRAME_MS, ORIGIN_MARK, Trace, WORK_CATEGORIES, frameWork, type TraceEvent } from '../../../shared-web/perf/trace.ts';
import { FILLED_MARK, PORT, SHAPES, hostWebDir, perfDir, pick, restedWhere, shown, type Shape, type Shown } from './harness.ts';

const RUNS = Number(option('runs') ?? 10);
if (!Number.isInteger(RUNS) || RUNS < 1) throw new Error(`--runs ${option('runs')}: not a positive whole number`);
const SHAPE: Shape = option('shape') ? pick('shape', SHAPES)[0]! : 'wide';
const PROFILE: Profile = PROFILES.find((profile) => profile.name === (option('profile') ?? 'throttled'))!;
if (!PROFILE) throw new Error(`--profile ${option('profile')}: not reference or throttled`);
const buildsDir = join(perfDir, 'results/raw/late-builds');
const BUILDS = (option('builds') ?? '').split(',').filter(Boolean);
if (BUILDS.length < 1) throw new Error('--builds <name>[,<name>…]: the kept builds to run, under perf/results/raw/late-builds/');
for (const build of BUILDS) if (!existsSync(join(buildsDir, build, 'build.json'))) throw new Error(`no kept build at perf/results/raw/late-builds/${build}/`);
const KEEP_TRACES = flag('traces');
const CPU = flag('cpu');
const CPU_INTERVAL_US = 250;

/** The steady scroll before the fling, as `perf.ts`'s. */
const SCROLL_PX = 300;
const SCROLL_EVERY_MS = 16;
const SCROLL_STEPS = 125;
const TAIL_MS = 300;
/** A main frame's work past this is in the slow mode (the two sit near 15
 *  and 30 ms throttled). */
const SLOW_WORK_MS = 20;

type Sample = Partial<Pick<Shown, 'top' | 'first' | 'end' | 'loaded' | 'pending' | 'scrollX'>>;
type Cause = 'long' | 'outside' | 'idle';
const CAUSES: Cause[] = ['long', 'outside', 'idle'];
const WRAPPER = /RunTask|ThreadController|SequenceManager|Receive mojo|SimpleWatcher|MojoHandle|LatencyInfo/;

interface Late {
  /** The late interval, ms, and the page time of the rAF it ends at. */
  interval: number;
  at: number;
  cause: Cause;
  /** The main frame in the rAF before: its start after that rAF's time,
   *  its work, and its parts (`frameWork`'s). `null`: no frame began there. */
  frame: { startAfter: number; ms: number; parts: Record<string, number> } | null;
  /** Main-thread busy time outside frames within the interval, and by kind. */
  outsideMs: number;
  outside: Record<string, number>;
  /** The interval less the frame's work and the busy time outside. */
  idleMs: number;
  /** Rows the view moved over the interval, and whether the frame before
   *  showed a placeholder row. */
  rows: number;
  placeholder: boolean;
}

interface Run {
  rafs: number;
  latePct: number;
  late: Late[];
  causes: Record<Cause, number>;
  /** Every main frame's work, ms, in order. */
  work: number[];
  workP50Ms: number;
  workP95Ms: number;
  /** The share of main frames past `SLOW_WORK_MS`. */
  slowPct: number;
  /** `workRecorder`'s rAFs that drew. */
  recorder: { frames: number; p50Ms: number; p95Ms: number };
  busyMs: number;
  outside: Record<string, number>;
  /** The timer tasks outside frames of 1 ms or more: GPUI's spawned tasks. */
  timers: { n: number; p50Ms: number; p95Ms: number; maxMs: number; totalMs: number };
  /** With `--cpu`: inclusive ms of each function, by where it ran. */
  cpu?: Record<'timers' | 'slow' | 'rest', Record<string, number>>;
  /** Mean ms a frame of each event name, in slow frames and in the rest. */
  names: { slow: Record<string, number>; rest: Record<string, number> };
  windowMs: number;
  reached: boolean;
}

const round = (ms: number) => Number(ms.toFixed(2));
const now = (page: Page) => page.evaluate(() => performance.now());
const rest = (page: Page, test: string) => restedWhere(page, test, { sliceMs: 10_000, capMs: 300_000, quietMs: 300 });

/** The main thread's complete events lying inside [from, to] (trace µs). */
const inside = (events: TraceEvent[], from: number, to: number) => events.filter((event) => event.ts >= from && event.ts + (event.dur ?? 0) <= to);

/** Mean ms a frame of each event name inside the frames (their whole
 *  durations: a nested event counts in its parents' names too). */
function byName(events: TraceEvent[], frames: { ts: number; dur: number }[]): Record<string, number> {
  const sums: Record<string, number> = {};
  for (const frame of frames) for (const event of inside(events, frame.ts, frame.ts + frame.dur)) sums[event.name] = (sums[event.name] ?? 0) + (event.dur ?? 0) / 1000;
  return Object.fromEntries(
    Object.entries(sums)
      .map(([name, ms]) => [name, round(ms / Math.max(frames.length, 1))] as const)
      .filter(([, ms]) => ms >= 0.05)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 30),
  );
}

/** What a task outside any frame was: its longest event past the
 *  scheduler's wrappers. */
function kindOf(main: TraceEvent[], task: TraceEvent): string {
  const within = inside(main, task.ts, task.ts + (task.dur ?? 0)).filter((event) => event !== task && !WRAPPER.test(event.name));
  return within.sort((a, b) => (b.dur ?? 0) - (a.dur ?? 0))[0]?.name ?? 'other';
}

interface CpuProfile {
  nodes: { id: number; callFrame: { functionName: string; url: string }; children?: number[] }[];
  startTime: number;
  samples?: number[];
  timeDeltas?: number[];
}

/** A Rust symbol without its crate hashes, cut to 140 characters. */
const short = (fn: string) => {
  const plain = fn.replace(/\[[0-9a-f]{16}\]/g, '');
  return plain.length > 140 ? `${plain.slice(0, 140)}…` : plain;
};

/** Inclusive ms of each function over the samples inside `spans` (trace
 *  µs: the profile's clock is the trace's): the top 25. */
function cpuIn(profile: CpuProfile, spans: { ts: number; dur: number }[]): Record<string, number> {
  const parent = new Map<number, number>();
  const name = new Map<number, string>();
  for (const node of profile.nodes) {
    name.set(node.id, node.callFrame.functionName || '(anonymous)');
    for (const child of node.children ?? []) parent.set(child, node.id);
  }
  const sorted = [...spans].sort((a, b) => a.ts - b.ts);
  const sums = new Map<string, number>();
  let at = profile.startTime;
  let span = 0;
  (profile.samples ?? []).forEach((id, index) => {
    const delta = profile.timeDeltas?.[index] ?? 0;
    at += delta;
    while (span < sorted.length && sorted[span]!.ts + sorted[span]!.dur < at) span++;
    if (span >= sorted.length || sorted[span]!.ts > at) return;
    const seen = new Set<string>();
    for (let node: number | undefined = id; node !== undefined; node = parent.get(node)) seen.add(name.get(node)!);
    for (const fn of seen) sums.set(fn, (sums.get(fn) ?? 0) + delta / 1000);
  });
  return Object.fromEntries([...sums].filter(([fn]) => !/^\((root|program|idle)\)$/.test(fn)).sort((a, b) => b[1] - a[1]).slice(0, 40).map(([fn, ms]) => [short(fn), round(ms)]));
}

function analyze(trace: Trace, from: number, to: number, rafs: RecordedFrame<Sample>[], recorded: { n: number; p50: number; p95: number }, reached: boolean, profile: CpuProfile | null): Run {
  const work = frameWork(trace, from, to);
  const main = trace.mainThread(trace.toTrace(from), trace.toTrace(to));
  // Tasks outside any frame: the top-level tasks holding no BeginMainFrame.
  const begins = main.filter((event) => event.name === 'ProxyMain::BeginMainFrame');
  const tasks = main.filter((event) => /RunTask/.test(event.name) && !main.some((other) => other !== event && /RunTask/.test(other.name) && other.ts <= event.ts && other.ts + (other.dur ?? 0) >= event.ts + (event.dur ?? 0)));
  const outsideTasks = tasks.filter((task) => !begins.some((begin) => begin.ts >= task.ts && begin.ts <= task.ts + (task.dur ?? 0)));
  const late: Late[] = [];
  for (let index = 1; index < rafs.length; index++) {
    const before = rafs[index - 1]!;
    const frame = rafs[index]!;
    const interval = frame.t - before.t;
    if (interval <= LATE_FRAME_MS) continue;
    // The main frame that ran the rAF before: the first to begin at or
    // after its time (a rAF's time is its frame's, before the work starts).
    const ran = work.frames.find((candidate) => candidate.at >= before.t - 0.5 && candidate.at < frame.t - 0.5) ?? null;
    const kinds: Record<string, number> = {};
    let outsideMs = 0;
    for (const task of outsideTasks) {
      const start = Math.max(trace.toPage(task.ts), before.t);
      const end = Math.min(trace.toPage(task.ts + (task.dur ?? 0)), frame.t);
      if (end - start <= 0) continue;
      outsideMs += end - start;
      const kind = kindOf(main, task);
      kinds[kind] = round((kinds[kind] ?? 0) + end - start);
    }
    const startAfter = ran ? ran.at - before.t : 0;
    const cause: Cause = ran && ran.ms > FRAME_MS ? 'long' : (ran?.ms ?? 0) + outsideMs > FRAME_MS ? 'outside' : 'idle';
    late.push({
      interval: round(interval),
      at: round(frame.t),
      cause,
      frame: ran && { startAfter: round(startAfter), ms: round(ran.ms), parts: Object.fromEntries(Object.entries(ran.parts).map(([part, ms]) => [part, round(ms)])) },
      outsideMs: round(outsideMs),
      outside: kinds,
      idleMs: round(interval - (ran?.ms ?? 0) - outsideMs),
      rows: (frame.first ?? 0) - (before.first ?? 0),
      placeholder: before.loaded !== undefined && before.end !== undefined && before.first !== undefined && before.loaded < before.end - before.first,
    });
  }
  const perFrame = percentiles(work.frames.map((frame) => frame.ms));
  const spans = begins.map((begin) => ({ ts: begin.ts, dur: begin.dur ?? 0 }));
  const slow = spans.filter((span) => span.dur / 1000 > SLOW_WORK_MS);
  const quick = spans.filter((span) => span.dur / 1000 <= SLOW_WORK_MS);
  const timerTasks = outsideTasks.filter((task) => (task.dur ?? 0) >= 1000 && kindOf(main, task) === 'TimerBase::run');
  const timers = percentiles(timerTasks.map((task) => (task.dur ?? 0) / 1000));
  return {
    rafs: rafs.length,
    latePct: round(rafs.length > 1 ? (late.length / (rafs.length - 1)) * 100 : 0),
    late,
    causes: Object.fromEntries(CAUSES.map((cause) => [cause, late.filter((entry) => entry.cause === cause).length])) as Record<Cause, number>,
    work: work.frames.map((frame) => round(frame.ms)),
    workP50Ms: round(perFrame.p50),
    workP95Ms: round(perFrame.p95),
    slowPct: round(spans.length ? (slow.length / spans.length) * 100 : 0),
    recorder: { frames: recorded.n, p50Ms: round(recorded.p50), p95Ms: round(recorded.p95) },
    busyMs: round(work.busyMs),
    outside: Object.fromEntries(Object.entries(work.outside).map(([kind, ms]) => [kind, round(ms)] as const).filter(([, ms]) => ms >= 1).sort((a, b) => b[1] - a[1])),
    timers: { n: timers.n, p50Ms: round(timers.p50), p95Ms: round(timers.p95), maxMs: round(timers.max), totalMs: round(timerTasks.reduce((sum, task) => sum + (task.dur ?? 0) / 1000, 0)) },
    ...(profile ? { cpu: { timers: cpuIn(profile, timerTasks.map((task) => ({ ts: task.ts, dur: task.dur ?? 0 }))), slow: cpuIn(profile, slow), rest: cpuIn(profile, quick) } } : {}),
    names: { slow: byName(main, slow), rest: byName(main, quick) },
    windowMs: round(to - from),
    reached,
  };
}

/** One cold run of a build: the scroll, Home, then the fling traced. */
async function run(url: string, traceFile: string | null): Promise<{ reading: Run | null; failures: string[] }> {
  const failures: string[] = [];
  let reading: Run | null = null;
  let session: Awaited<ReturnType<typeof open>> | null = null;
  try {
    session = await open(chromium, url, { profile: PROFILE, params: { shape: SHAPE }, init: [workRecorder, frameRecorder] });
    const { page } = session;
    const browser = session.context.browser()!;
    await waitMark(page, FILLED_MARK);
    const { shown: start, layout } = await shown(page);
    await page.mouse.move(layout.left + 300, layout.top + 300);
    // The steady scroll `perf.ts` runs first, untraced: the fling starts
    // from the state it leaves (the cache, the heap).
    const sent: Promise<void>[] = [];
    for (let step = 0; step < SCROLL_STEPS; step++) {
      sent.push(wheel(page, SCROLL_PX));
      await page.waitForTimeout(SCROLL_EVERY_MS);
    }
    await Promise.all(sent);
    await rest(page, 'true');
    await page.keyboard.press('Home');
    if (!(await rest(page, 's.first === 0 && s.scrollX === 0'))) throw new Error("Home didn't rest at the top, filled");

    await browser.startTracing(page, { categories: WORK_CATEGORIES });
    const from = await page.evaluate((name) => (performance.mark(name), performance.now()), ORIGIN_MARK);
    const cdp = CPU ? await session.context.newCDPSession(page) : null;
    if (cdp) {
      await cdp.send('Profiler.enable');
      await cdp.send('Profiler.setSamplingInterval', { interval: CPU_INTERVAL_US });
      await cdp.send('Profiler.start');
    }
    await fling(page, start.rows, { rowHeight: layout.rowHeight });
    const reached = (await rest(page, 's.end === s.rows')) !== null;
    const acted = await now(page);
    const lastDrawn = (await workBetween(page, from, acted)).at(-1)?.t ?? acted;
    const to = lastDrawn + TAIL_MS;
    const left = to - (await now(page));
    if (left > 0) await page.waitForTimeout(left);
    const profile = cdp ? ((await cdp.send('Profiler.stop')).profile as CpuProfile) : null;
    const raw = await browser.stopTracing();
    if (traceFile) writeFileSync(traceFile, raw);
    const trace = new Trace(JSON.parse(raw.toString()));
    const recorded = percentiles((await workBetween(page, from, to)).map((sample) => sample.ms));
    const rafs = (await recordedBetween<Sample>(page, from, to)) as RecordedFrame<Sample>[];
    reading = analyze(trace, from, to, rafs, recorded, reached, profile);
    if (!reached && PROFILE.name === 'reference') failures.push("the fling didn't rest at the last row, filled");
    failures.push(...session.problems);
  } catch (error) {
    failures.push((error as Error).message.split('\n')[0]!);
  } finally {
    await session?.close();
  }
  return { reading, failures };
}

const features = (build: string) => (JSON.parse(readFileSync(join(buildsDir, build, 'build.json'), 'utf8')) as { features: string }).features || 'base';
const servers = await Promise.all(BUILDS.map((build, index) => serveApp(undefined, { webDir: hostWebDir, port: PORT + index, outDir: join(buildsDir, build) })));
const runs: Record<string, Run[]> = Object.fromEntries(BUILDS.map((build) => [build, []]));
const failures: string[] = [];
const loadBefore = loadavg()[0]!;
if (KEEP_TRACES) mkdirSync(join(buildsDir, 'traces'), { recursive: true });
try {
  for (let index = 0; index < RUNS; index++) {
    // In turn, the order reversed every round.
    const order = BUILDS.map((_, at) => at);
    if (index % 2) order.reverse();
    for (const at of order) {
      const build = BUILDS[at]!;
      const { reading, failures: found } = await run(servers[at]!.url, KEEP_TRACES ? join(buildsDir, 'traces', `${build}-${index + 1}.json`) : null);
      failures.push(...found.map((failure) => `${build} run ${index + 1}: ${failure}`));
      if (!reading) continue;
      runs[build]!.push(reading);
      if (flag('each')) for (const entry of reading.late) console.log(`  ${entry.cause.padEnd(12)} ${entry.interval} ms at ${entry.at}: frame ${entry.frame ? `+${entry.frame.startAfter} for ${entry.frame.ms} (animate ${entry.frame.parts.animate})` : 'none'}, outside ${entry.outsideMs} ${JSON.stringify(entry.outside)}, idle ${entry.idleMs}, rows ${entry.rows}${entry.placeholder ? ', placeholder' : ''}`);
      console.log(`${build} ${index + 1}/${RUNS}: late ${reading.latePct}% (${CAUSES.map((cause) => `${cause} ${reading.causes[cause]}`).join(', ')}), work p50 ${reading.workP50Ms} p95 ${reading.workP95Ms} ms, slow frames ${reading.slowPct}%, timers ${reading.timers.n} (p50 ${reading.timers.p50Ms} p95 ${reading.timers.p95Ms} ms, ${reading.timers.totalMs} in all), busy ${reading.busyMs} ms${reading.reached ? '' : ' (not reached)'}`);
    }
  }
} finally {
  await Promise.all(servers.map((server) => server.close()));
}
const loadAfter = loadavg()[0]!;

const summary: Record<string, object> = {};
for (const build of BUILDS) {
  const readings = runs[build]!;
  if (!readings.length) continue;
  const of = (pick: (reading: Run) => number) => readings.map(pick);
  const late = readings.flatMap((reading) => reading.late);
  const longs = late.filter((entry) => entry.cause === 'long' && entry.frame);
  const mean = (values: number[]) => round(values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1));
  const names = (which: 'slow' | 'rest') => {
    const all = new Set(readings.flatMap((reading) => Object.keys(reading.names[which])));
    return Object.fromEntries(
      [...all]
        .map((name) => [name, mean(readings.map((reading) => reading.names[which][name] ?? 0))] as const)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20),
    );
  };
  const built = {
    features: features(build),
    runs: readings.length,
    latePct: { median: round(median(of((reading) => reading.latePct))), min: Math.min(...of((reading) => reading.latePct)), max: Math.max(...of((reading) => reading.latePct)) },
    slowPct: { median: round(median(of((reading) => reading.slowPct))), min: Math.min(...of((reading) => reading.slowPct)), max: Math.max(...of((reading) => reading.slowPct)) },
    workP50Ms: round(median(of((reading) => reading.workP50Ms))),
    workP95Ms: round(median(of((reading) => reading.workP95Ms))),
    busyMs: round(median(of((reading) => reading.busyMs))),
    /** The timer tasks outside frames: each number's median over the runs. */
    timers: Object.fromEntries((['n', 'p50Ms', 'p95Ms', 'maxMs', 'totalMs'] as const).map((key) => [key, round(median(of((reading) => reading.timers[key])))])),
    lateIntervals: late.length,
    causes: Object.fromEntries(CAUSES.map((cause) => [cause, late.filter((entry) => entry.cause === cause).length])),
    /** The long frames behind late intervals: their mean work and parts. */
    longFrames: { ms: mean(longs.map((entry) => entry.frame!.ms)), ...Object.fromEntries(['input', 'animate', 'lifecycle', 'other'].map((part) => [part, mean(longs.map((entry) => entry.frame!.parts[part] ?? 0))])), placeholderPct: round(longs.length ? (longs.filter((entry) => entry.placeholder).length / longs.length) * 100 : 0) },
    /** Busy time outside frames over the window, by kind: the runs' mean. */
    outside: Object.fromEntries([...new Set(readings.flatMap((reading) => Object.keys(reading.outside)))].map((kind) => [kind, mean(readings.map((reading) => reading.outside[kind] ?? 0))] as const).sort((a, b) => b[1] - a[1])),
    /** And within the late intervals, by kind: the sum over the runs. */
    outsideInLate: Object.fromEntries(Object.entries(late.reduce<Record<string, number>>((sums, entry) => (Object.entries(entry.outside).forEach(([kind, ms]) => (sums[kind] = round((sums[kind] ?? 0) + ms))), sums), {})).sort((a, b) => b[1] - a[1])),
    names: { slow: names('slow'), rest: names('rest') },
  };
  summary[build] = built;
  console.log(`\n${build} (${built.features}), ${built.runs} runs: late ${built.latePct.median}% (${built.latePct.min}–${built.latePct.max}), slow frames ${built.slowPct.median}% (${built.slowPct.min}–${built.slowPct.max}), work p50 ${built.workP50Ms} p95 ${built.workP95Ms} ms, busy ${built.busyMs} ms`);
  console.log(`  ${late.length} late intervals: ${CAUSES.map((cause) => `${cause} ${built.causes[cause]}`).join(', ')}`);
  console.log(`  timer tasks outside frames (medians): ${JSON.stringify(built.timers)}`);
  if (CPU) for (const where of ['timers', 'slow', 'rest'] as const) console.log(`  cpu in ${where}, ms (last run): ${JSON.stringify(readings.at(-1)!.cpu?.[where], null, 1)}`);
  console.log(`  outside frames, ms a run: ${JSON.stringify(built.outside)}`);
  console.log(`  outside frames in the late intervals, ms in all: ${JSON.stringify(built.outsideInLate)}`);
  console.log(`  long frames behind them: ${JSON.stringify(built.longFrames)}`);
  console.log(`  in slow frames, ms a frame: ${JSON.stringify(built.names.slow)}`);
  console.log(`  in the rest:                ${JSON.stringify(built.names.rest)}`);
}
console.log(`\nload average ${loadBefore.toFixed(2)} before, ${loadAfter.toFixed(2)} after`);

const label = option('label');
if (label) {
  const date = localDate();
  const out = join(perfDir, 'results', `${date}-${label}.json`);
  const protocol = { browser: 'chromium headless=new', viewport: '1440x900', dpr: 2, runs: RUNS, cold: true, shape: SHAPE, profile: PROFILE.name, interleaved: true, scrollFirst: { px: SCROLL_PX, everyMs: SCROLL_EVERY_MS, steps: SCROLL_STEPS }, lateFrameMs: round(LATE_FRAME_MS), cpuProfiled: CPU, slowWorkMs: SLOW_WORK_MS, tailMs: TAIL_MS };
  writeFileSync(out, `${JSON.stringify({ date, label, ...machineInfo(), load: { before: round(loadBefore), after: round(loadAfter) }, protocol, summary, runs, failures }, null, 2)}\n`);
  console.log(`wrote ${out}`);
}
if (failures.length) {
  console.error(`FAIL\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
