// `follow` in the bare host: the tail feed (`?rows=1000&append=<rate>&follow`,
// narrow) with the table following it. The host marks each batch as it's
// sent (`tall-table:appended`, the rows then on a global) and the bridge
// each frame whose drawn tail grew (`tall-table:tail`, the tail drawn); an
// init script logs both marks with their globals. A batch's append → pixel
// is its mark to the first tail mark at or past its rows. The source
// publishes the reads it was sent, and those cancelled in flight, as they
// change.
//
// Three windows, cold, a fresh browser each run, after `--warmup` ms of the
// feed, each with nothing on the page but what it reads:
// 1. Append → pixel, reads a second, and drained reads: only the mark log.
// 2. The presented frames (`presentedRecorder`, which wraps the GPU calls,
//    installed for this window only): the share with a placeholder row
//    over `--seconds`; then scroll-back during the feed, `--inputs` times: a
//    wheel up of 300 CSS px from the tail, from the event's timestamp to the
//    first presented frame no longer following, and to the first there with
//    every row real; then End, and following again before the next.
// 3. Per-frame work from Chromium's trace (`frameWork`, as perf.ts reads
//    it) and late frames from `frameRecorder`'s rAFs, installed only then:
//    its loop slows the page.
//
// Usage: node components/tall-table/perf/follow.ts [--rate 10000] [--runs 10]
//          [--profile reference|throttled] [--seconds 5] [--inputs 5]
//          [--warmup 1000] [--label <name>]
// --label writes perf/results/<date>-<label>.json. Run
// `just tall-table build follow` first.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright';
import { frameIntervals, frameRecorder, open, presentedAfter, presentedRecorder, recordedBetween, stopPresentedRecorder, waitMark, wheel, type RecordedFrame } from '../../../shared-web/perf/harness.ts';
import { PROFILES, localDate, machineInfo, median, option, percentiles, type Profile } from '../../../shared-web/perf/protocol.ts';
import { serveApp } from '../../../shared-web/perf/serve.ts';
import { ORIGIN_MARK, Trace, WORK_CATEGORIES, frameWork, lateFrames } from '../../../shared-web/perf/trace.ts';
import { APPENDED_GLOBAL, APPENDED_MARK, FOLLOWING_GLOBAL, PORT, READS_DRAINED_GLOBAL, READS_SENT_GLOBAL, TAIL_GLOBAL, TAIL_MARK, buildName, builtFeatures, global, hostWebDir, perfDir, shown } from './harness.ts';

const RATE = Number(option('rate') ?? 10_000);
const RUNS = Number(option('runs') ?? 10);
const SECONDS = Number(option('seconds') ?? 5);
const INPUTS = Number(option('inputs') ?? 5);
const WARMUP_MS = Number(option('warmup') ?? 1000);
/** The rows at open. */
const ROWS = 1000;
/** The scroll-back's wheel, CSS px up. */
const WHEEL_PX = 300;
/** After End has the view following again, this long before the next wheel. */
const SETTLE_MS = 250;
/** After the wheel's frame, the view holds its top this long. */
const HOLD_MS = 200;
const profileName = option('profile') ?? 'reference';
const profile = PROFILES.find((candidate) => candidate.name === profileName);
if (!profile) throw new Error(`--profile ${profileName}: not one of ${PROFILES.map((p) => p.name).join(', ')}`);
for (const [name, value] of [['rate', RATE], ['runs', RUNS], ['seconds', SECONDS], ['inputs', INPUTS], ['warmup', WARMUP_MS]] as const) if (!(value > 0)) throw new Error(`--${name} ${option(name)}: not a positive number`);
const features = builtFeatures();
if (!features.includes('follow')) throw new Error('needs the host built with follow: `just tall-table build follow`');

type Entry = [kind: 'appended' | 'tail', rows: number, at: number];
/** A presented frame: the host's `__seizaFrameSample` (`host/web/src/main.ts`). */
type Presented = RecordedFrame<{ top: number; first: number; end: number; loaded: number; pending: number; following?: boolean }>;
/** Every visible row drawn with its values. */
const real = (frame: Presented) => frame.loaded === frame.end - frame.first;

/** Logs the two marks with the rows their global holds when each is set
 *  (both globals are set before their mark), on `__followLog`. In the page,
 *  before its scripts, so it names the marks and globals itself:
 *  `harness.ts`'s (checked below). */
function markLog(): void {
  const names = {
    appended: ['tall-table:appended', '__tallTableAppended'],
    tail: ['tall-table:tail', '__tallTableTail'],
  } as const;
  const log: [string, number, number][] = [];
  (globalThis as { __followLog?: unknown }).__followLog = log;
  const mark = performance.mark.bind(performance);
  performance.mark = ((name: string, options?: PerformanceMarkOptions) => {
    const entry = mark(name, options);
    for (const [kind, [markName, global]] of Object.entries(names)) {
      if (name === markName) log.push([kind, (globalThis as Record<string, unknown>)[global] as number, entry.startTime]);
    }
    return entry;
  }) as typeof performance.mark;
}
for (const name of [APPENDED_MARK, APPENDED_GLOBAL, TAIL_MARK, TAIL_GLOBAL]) if (!markLog.toString().includes(`'${name}'`)) throw new Error(`markLog doesn't name ${name}`);

interface Reading {
  batches: number;
  /** Batches whose tail was drawn in the run. */
  matched: number;
  appendP50Ms: number;
  appendP95Ms: number;
  appendMaxMs: number;
  /** Rows appended a second, and tail frames (each drawing a longer tail) a second. */
  rowsPerS: number;
  tailFramesPerS: number;
  /** Reads the source was sent a second, and those cancelled in flight, over the first window. */
  readsPerS: number;
  drained: number;
  /** Presented frames in the second window while following, and the share
   *  with a row not drawn with its values. */
  presented: number;
  placeholderPct: number;
  /** Scroll-back, the median over the inputs: the wheel → the first frame
   *  no longer following, and → the first such frame with every row real. */
  backFrameMs: number;
  backRealMs: number;
  /** Frames the trace saw in the third window, their work (ms), and the
   *  main thread's busy time a second. */
  frames: number;
  workP50Ms: number;
  workP95Ms: number;
  workMaxMs: number;
  busyMsPerS: number;
  /** rAF intervals over 1.5 frames, as a share. */
  latePct: number;
}

const round = (ms: number) => Number(ms.toFixed(2));
const now = (page: Page) => page.evaluate(() => performance.now());
const reads = async (page: Page) => ({ sent: (await global<number>(page, READS_SENT_GLOBAL)) ?? 0, drained: (await global<number>(page, READS_DRAINED_GLOBAL)) ?? 0 });

/** One wheel up from the tail: the event's timestamp to the first presented
 *  frame no longer following, and to the first such frame with every row
 *  real. A frame's top alone can't tell the wheel's: the pin can move the
 *  view down after the last frame and before the wheel, so the wheel's
 *  frame may sit below it. Checked instead: the frames after it hold its
 *  top for `HOLD_MS` while rows arrive. */
async function scrollBack(page: Page, failures: string[], index: number): Promise<{ frame: number; real: number }> {
  if (index > 0) {
    await page.keyboard.press('End');
    await page.waitForFunction((name) => (globalThis as Record<string, unknown>)[name] === true, FOLLOWING_GLOBAL, { timeout: 5_000, polling: 10 });
    await waitMark(page, TAIL_MARK, await now(page), 5_000);
  }
  await page.waitForTimeout(SETTLE_MS);
  // The events before this wheel (its timestamp can be earlier than the
  // page's clock read before sending it).
  const sent = (await global<number[]>(page, '__wheels'))!.length;
  await wheel(page, -WHEEL_PX);
  const handle = await page.waitForFunction(
    (sent) => {
      const g = globalThis as { __seizaPresented?: Presented[]; __wheels?: number[] };
      const event = g.__wheels?.[sent];
      if (event === undefined) return false;
      const frames = (g.__seizaPresented ?? []).filter((frame) => frame.t >= event);
      const index = frames.findIndex((frame) => frame.following === false);
      if (index < 0) return false;
      const filled = frames.slice(index).find((frame) => frame.loaded === frame.end - frame.first);
      return filled ? { event, frame: frames[index]!.t, real: filled.t, top: frames[index]!.top } : false;
    },
    sent,
    { timeout: 5_000, polling: 10 },
  );
  const { event, frame, real, top } = (await handle.jsonValue()) as { event: number; frame: number; real: number; top: number };
  await page.waitForTimeout(HOLD_MS);
  const moved = (await presentedAfter<Presented>(page, frame)).find((later) => later.top !== top);
  if (moved) failures.push(`scroll-back ${index + 1}: the view moved from ${top} to ${moved.top} after the wheel`);
  if ((await global<boolean>(page, FOLLOWING_GLOBAL)) !== false) failures.push(`scroll-back ${index + 1}: still following after a wheel up`);
  return { frame: frame - event, real: real - event };
}

async function run(url: string, profile: Profile): Promise<{ reading: Reading | null; failures: string[] }> {
  const failures: string[] = [];
  let session: Awaited<ReturnType<typeof open>> | null = null;
  try {
    session = await open(chromium, url, {
      profile,
      params: { shape: 'narrow', rows: String(ROWS), append: String(RATE), follow: '' },
      init: [markLog],
    });
    const { page } = session;
    const browser = session.context.browser()!;
    await waitMark(page, TAIL_MARK);
    await page.waitForTimeout(WARMUP_MS);

    // 1. Append → pixel and reads: nothing on the page but the mark log.
    const readsFrom = await reads(page);
    const from = await now(page);
    await page.waitForTimeout(SECONDS * 1000);
    const to = await now(page);
    const readsTo = await reads(page);

    // 2. Presented frames, then scroll-back, with the GPU calls wrapped.
    const { layout } = await shown(page);
    await page.mouse.move(layout.left + 300, layout.top + 300);
    await page.evaluate(presentedRecorder);
    await page.evaluate(() => {
      const wheels: number[] = [];
      (globalThis as { __wheels?: number[] }).__wheels = wheels;
      addEventListener('wheel', (event) => wheels.push(event.timeStamp), { capture: true, passive: true });
    });
    const shownFrom = await now(page);
    await page.waitForTimeout(SECONDS * 1000);
    const frames = await presentedAfter<Presented>(page, shownFrom);
    if (frames.some((frame) => frame.following !== true)) failures.push('stopped following during the feed');
    const back: { frame: number; real: number }[] = [];
    for (let index = 0; index < INPUTS; index++) {
      try {
        back.push(await scrollBack(page, failures, index));
      } catch (error) {
        failures.push(`scroll-back ${index + 1}: ${(error as Error).message.split('\n')[0]}`);
        break;
      }
    }
    await stopPresentedRecorder(page);
    // Following again for the third window, as in the first.
    await page.keyboard.press('End');
    await page.waitForFunction((name) => (globalThis as Record<string, unknown>)[name] === true, FOLLOWING_GLOBAL, { timeout: 5_000, polling: 10 });

    // 3. Frame work, traced, with the rAF recorder.
    await page.evaluate(frameRecorder);
    await browser.startTracing(page, { categories: WORK_CATEGORIES });
    const workFrom = await page.evaluate((name) => (performance.mark(name), performance.now()), ORIGIN_MARK);
    await page.waitForTimeout(SECONDS * 1000);
    const workTo = await now(page);
    const work = frameWork(new Trace(JSON.parse((await browser.stopTracing()).toString())), workFrom, workTo);
    const perFrame = percentiles(work.frames.map((frame) => frame.ms));
    const late = lateFrames(frameIntervals(await recordedBetween(page, workFrom, workTo)));
    failures.push(...session.problems);
    if (!back.length) return { reading: null, failures };

    const log = (await global<Entry[]>(page, '__followLog'))!;
    const appended = log.filter(([kind]) => kind === 'appended');
    const tails = log.filter(([kind]) => kind === 'tail');
    const batches = appended.filter(([, , at]) => at >= from && at < to);
    const latencies: number[] = [];
    for (const [, rows, at] of batches) {
      const tail = tails.find(([, drawn, drawnAt]) => drawn >= rows && drawnAt >= at);
      if (tail) latencies.push(tail[2] - at);
    }
    if (!batches.length) failures.push('the feed sent no batch');
    if (latencies.length < batches.length * 0.9) failures.push(`only ${latencies.length} of ${batches.length} batches were drawn`);
    const start = appended.filter(([, , at]) => at < from).at(-1);
    const seconds = (to - from) / 1000;
    const p = percentiles(latencies);
    return {
      reading: {
        batches: batches.length,
        matched: latencies.length,
        appendP50Ms: round(p.p50),
        appendP95Ms: round(p.p95),
        appendMaxMs: round(p.max),
        rowsPerS: start && batches.length ? round((batches.at(-1)![1] - start[1]) / seconds) : 0,
        tailFramesPerS: round(tails.filter(([, , at]) => at >= from && at < to).length / seconds),
        readsPerS: round((readsTo.sent - readsFrom.sent) / seconds),
        drained: readsTo.drained - readsFrom.drained,
        presented: frames.length,
        placeholderPct: round((frames.filter((frame) => !real(frame)).length / (frames.length || 1)) * 100),
        backFrameMs: round(median(back.map((input) => input.frame))),
        backRealMs: round(median(back.map((input) => input.real))),
        frames: work.frames.length,
        workP50Ms: round(perFrame.p50),
        workP95Ms: round(perFrame.p95),
        workMaxMs: round(perFrame.max),
        busyMsPerS: round(work.busyMs / ((workTo - workFrom) / 1000)),
        latePct: round(late.share * 100),
      },
      failures,
    };
  } catch (error) {
    failures.push((error as Error).message.split('\n')[0]!);
    return { reading: null, failures };
  } finally {
    await session?.close();
  }
}

const server = await serveApp(undefined, { webDir: hostWebDir, port: PORT });
const readings: Reading[] = [];
const failures: string[] = [];
console.log(`build: ${buildName(features)}, ${RATE} rows/s appended, ${profile.name}, ${SECONDS} s a window`);
try {
  for (let index = 0; index < RUNS; index++) {
    const { reading, failures: found } = await run(server.url, profile);
    failures.push(...found.map((failure) => `run ${index + 1}: ${failure}`));
    if (reading) readings.push(reading);
    if (reading) console.log(`${index + 1}/${RUNS}: append → pixel p50 ${reading.appendP50Ms} p95 ${reading.appendP95Ms} max ${reading.appendMaxMs} ms over ${reading.matched}/${reading.batches} batches; ${reading.rowsPerS} rows/s, ${reading.tailFramesPerS} tail frames/s; ${reading.readsPerS} reads/s, ${reading.drained} drained; placeholders ${reading.placeholderPct}% of ${reading.presented} frames; scroll-back ${reading.backFrameMs} ms, real ${reading.backRealMs} ms; work p50 ${reading.workP50Ms} p95 ${reading.workP95Ms} ms, busy ${reading.busyMsPerS} ms/s, late ${reading.latePct}%`);
  }
} finally {
  await server.close();
}
const summary = readings.length
  ? Object.fromEntries((Object.keys(readings[0]!) as (keyof Reading)[]).map((key) => [key, Number(median(readings.map((reading) => reading[key])).toFixed(2))]))
  : {};
const spread = readings.length ? (Math.max(...readings.map((r) => r.appendP50Ms)) - Math.min(...readings.map((r) => r.appendP50Ms))) / (summary.appendP50Ms || 1) : 0;
console.log(`median of ${readings.length}: append → pixel p50 ${summary.appendP50Ms} ms, p95 ${summary.appendP95Ms} ms (p50 spread ${(spread * 100).toFixed(1)}%); ${summary.readsPerS} reads/s, ${summary.drained} drained; placeholders ${summary.placeholderPct}%; scroll-back ${summary.backFrameMs} ms, real ${summary.backRealMs} ms; work p50 ${summary.workP50Ms} p95 ${summary.workP95Ms} ms, busy ${summary.busyMsPerS} ms/s, late ${summary.latePct}%`);

const label = option('label');
if (label) {
  const date = localDate();
  const out = join(perfDir, 'results', `${date}-${label}.json`);
  mkdirSync(join(perfDir, 'results'), { recursive: true });
  const protocol = { browser: 'chromium headless=new', viewport: '1440x900', dpr: 2, runs: RUNS, cold: true, profile: profile.name, shape: 'narrow', rows: ROWS, rate: RATE, warmupMs: WARMUP_MS, seconds: SECONDS, inputs: INPUTS, wheelPx: WHEEL_PX, build: buildName(features) };
  writeFileSync(out, `${JSON.stringify({ date, label, ...machineInfo(), protocol, runs: readings, summary, p50Spread: Number(spread.toFixed(3)), failures }, null, 2)}\n`);
  console.log(`wrote ${out}`);
}
if (failures.length) {
  console.error(`FAIL\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
