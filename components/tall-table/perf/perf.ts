// The base's frame work in the bare host, the baseline every feature's
// added work is read against (PLAN.md, "Measuring a feature"). Per shape
// (narrow, wide), on the host's release build, cold, under the root's
// measurement protocol (reference and throttled, median of `--runs`):
//
// - scroll: a steady wheel scroll down, 300 px every 16 ms for 2 s (about
//   600 rows/s: it crosses a page);
// - fling: shared-web/perf/'s `fling`, top to the last row in ~3 s;
// - hfling (wide only): the same sideways, the first column to the last.
//
// Each segment is traced on its own: per-frame work is the trace's
// `ProxyMain::BeginMainFrame` (`frameWork`), cross-checked by
// `workRecorder` (each rAF that drew); late frames and intervals come from
// `frameRecorder`'s rAFs (Chromium's compositor reporter doesn't see GPUI's
// canvas frames), with what each frame showed (`__seizaFrameSample`):
// placeholder frames and the visible cells (rows × columns on screen).
//
// The build is whichever `just tall-table build [features]` made last
// (recorded as `build`); with `custom-cells`, `--cells text|heat|bars|color`
// paints every float column that way (`text`, the control, paints nothing).
//
// Usage: node components/tall-table/perf/perf.ts [--runs 10] [--shape narrow|wide]
//          [--profile reference|throttled] [--cells <style>] [--label <name>]
// --label writes perf/results/<date>-<label>.json. Run `just tall-table build` first.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { fling, frameIntervals, frameRecorder, frameStats, open, recordedBetween, waitMark, wheel, workBetween, workRecorder, type RecordedFrame } from '../../../shared-web/perf/harness.ts';
import { PROFILES, localDate, machineInfo, median, option, percentiles, type Profile } from '../../../shared-web/perf/protocol.ts';
import { serveApp } from '../../../shared-web/perf/serve.ts';
import { ORIGIN_MARK, Trace, WORK_CATEGORIES, frameWork, lateFrames } from '../../../shared-web/perf/trace.ts';
import { CELL_STYLES, FILLED_MARK, PORT, SHAPES, buildName, builtFeatures, filledWhere, hostWebDir, perfDir, shown, visibleColumns, type CellStyle, type Layout, type Shape, type Shown } from './harness.ts';

const RUNS = Number(option('runs') ?? 10);
/** `--name`'s value, which must be one of `known`; all of them without it. */
function pick<T extends string>(name: string, known: readonly T[]): T[] {
  const given = option(name);
  if (given === undefined) return [...known];
  if (!known.includes(given as T)) throw new Error(`--${name} ${given}: not one of ${known.join(', ')}`);
  return [given as T];
}
const shapes = pick('shape', SHAPES);
const profiles = pick('profile', PROFILES.map((profile) => profile.name)).map((name) => PROFILES.find((profile) => profile.name === name)!);
if (!Number.isInteger(RUNS) || RUNS < 1) throw new Error(`--runs ${option('runs')}: not a positive whole number`);
const features = builtFeatures();
const BUILD = buildName(features);
const CELLS = option('cells') as CellStyle | undefined;
if (CELLS !== undefined && !CELL_STYLES.includes(CELLS)) throw new Error(`--cells ${CELLS}: not one of ${CELL_STYLES.join(', ')}`);
if (CELLS !== undefined && !features.includes('custom-cells')) throw new Error('--cells needs the host built with custom-cells: `just tall-table build custom-cells`');
console.log(`build: ${BUILD}${CELLS ? `, cells: ${CELLS}` : ''}`);
/** The steady scroll: this many px every `SCROLL_EVERY_MS`, for `SCROLL_STEPS`. */
const SCROLL_PX = 300;
const SCROLL_EVERY_MS = 16;
const SCROLL_STEPS = 125;
/** The sideways fling's length, as `fling`'s. */
const FLING_MS = 3_000;
/** Idle after a segment's view rests, inside its window. */
const TAIL_MS = 300;

type Segment = 'scroll' | 'fling' | 'hfling';
type Sample = Partial<Pick<Shown, 'top' | 'first' | 'end' | 'loaded' | 'pending' | 'scrollX'>>;

interface Reading {
  /** Frames the trace saw in the window, and their work (ms). */
  frames: number;
  workP50Ms: number;
  workP95Ms: number;
  workMaxMs: number;
  /** Main-thread CPU over the window, ms, and of it outside any frame. */
  busyMs: number;
  outsideFramesMs: number;
  /** `workRecorder`'s rAFs that drew: the cross-check. */
  recorder: { frames: number; p50Ms: number; p95Ms: number };
  /** rAF intervals: p50, p95, max, and the late ones' share. */
  intervals: { p50Ms: number; p95Ms: number; maxMs: number };
  latePct: number;
  /** Frames showing any placeholder row. */
  placeholderPct: number;
  /** Visible cells per frame (rows × columns on screen): p50, max. */
  cells: { p50: number; max: number };
  windowMs: number;
}

const now = (page: Page) => page.evaluate(() => performance.now());

/** Traces `act` on its own: from right after tracing starts (the origin
 *  mark) to the end of `act`, which returns once the view rests. */
async function traced(browser: Browser, page: Page, layout: Layout, act: () => Promise<void>): Promise<Reading> {
  await browser.startTracing(page, { categories: WORK_CATEGORIES });
  const from = await page.evaluate((name) => (performance.mark(name), performance.now()), ORIGIN_MARK);
  await act();
  await page.waitForTimeout(TAIL_MS);
  const to = await now(page);
  const trace = new Trace(JSON.parse((await browser.stopTracing()).toString()));
  const work = frameWork(trace, from, to);
  const perFrame = percentiles(work.frames.map((frame) => frame.ms));
  const recorded = percentiles((await workBetween(page, from, to)).map((sample) => sample.ms));
  const frames = (await recordedBetween<Sample>(page, from, to)) as RecordedFrame<Sample>[];
  const stats = frameStats(frames);
  const intervals = frameIntervals(frames);
  const seen = frames.filter((frame) => frame.end !== undefined && frame.first !== undefined);
  const placeholders = seen.filter((frame) => frame.loaded! < frame.end! - frame.first!).length;
  const cells = percentiles(seen.map((frame) => (frame.end! - frame.first!) * visibleColumns(layout, frame.scrollX ?? 0)));
  const round = (ms: number) => Number(ms.toFixed(2));
  return {
    frames: work.frames.length,
    workP50Ms: round(perFrame.p50),
    workP95Ms: round(perFrame.p95),
    workMaxMs: round(perFrame.max),
    busyMs: round(work.busyMs),
    outsideFramesMs: round(work.busyMs - work.inFramesMs),
    recorder: { frames: recorded.n, p50Ms: round(recorded.p50), p95Ms: round(recorded.p95) },
    intervals: { p50Ms: round(stats.p50), p95Ms: round(stats.p95), maxMs: round(stats.max) },
    latePct: round(lateFrames(intervals).share * 100),
    placeholderPct: round(seen.length ? (placeholders / seen.length) * 100 : 0),
    cells: { p50: cells.p50, max: cells.max },
    windowMs: round(to - from),
  };
}

/** Home, then until row 0 is on screen, filled. */
async function home(page: Page): Promise<void> {
  await page.keyboard.press('Home');
  await filledWhere(page, 's.first === 0 && s.scrollX === 0');
}

/** One cold run of `shape`: every segment, each traced on its own. */
async function run(url: string, shape: Shape, profile: Profile): Promise<{ readings: Partial<Record<Segment, Reading>>; failures: string[] }> {
  const failures: string[] = [];
  const readings: Partial<Record<Segment, Reading>> = {};
  let session: Awaited<ReturnType<typeof open>> | null = null;
  try {
    // Inside the try: a browser that fails to launch fails this run, not the rest.
    session = await open(chromium, url, { profile, params: CELLS ? { shape, cells: CELLS } : { shape }, init: [workRecorder, frameRecorder] });
    const { page } = session;
    const browser = session.context.browser()!;
    await waitMark(page, FILLED_MARK);
    const { shown: start, layout } = await shown(page);
    // Over the cells, clear of the scrollbar.
    await page.mouse.move(layout.left + 300, layout.top + 300);

    readings.scroll = await traced(browser, page, layout, async () => {
      const sent: Promise<void>[] = [];
      // On a fixed schedule, not awaiting each wheel: Playwright's waits
      // for the page's handling, which would pace the input by its cost.
      for (let step = 0; step < SCROLL_STEPS; step++) {
        sent.push(wheel(page, SCROLL_PX));
        await page.waitForTimeout(SCROLL_EVERY_MS);
      }
      await Promise.all(sent);
      await filledWhere(page, 'true');
    });
    await home(page);

    readings.fling = await traced(browser, page, layout, async () => {
      await fling(page, start.rows, { rowHeight: layout.rowHeight });
      await filledWhere(page, 's.end === s.rows').catch(() => failures.push("the fling didn't rest at the last row, filled"));
    });

    if (shape === 'wide') {
      await home(page);
      const last = layout.columns.at(-1)!;
      const room = last.x + last.width - layout.cellsWidth;
      readings.hfling = await traced(browser, page, layout, async () => {
        const wallStart = Date.now();
        const sent: Promise<void>[] = [];
        let moved = 0;
        while (Date.now() - wallStart < FLING_MS) {
          const remaining = FLING_MS - (Date.now() - wallStart);
          const delta = Math.max(100, ((room - moved) * 16) / Math.max(remaining, 16));
          sent.push(wheel(page, 0, delta));
          moved += delta;
          await page.waitForTimeout(8);
        }
        if (moved < room) sent.push(wheel(page, 0, room - moved));
        await Promise.all(sent);
        await filledWhere(page, `s.scrollX >= ${room - 1}`).catch(() => failures.push("the sideways fling didn't rest at the last column"));
      });
    }
    failures.push(...session.problems);
  } catch (error) {
    failures.push((error as Error).message.split('\n')[0]!);
  } finally {
    await session?.close();
  }
  return { readings, failures };
}

/** The median over runs of each number in a reading. */
function summarize(readings: Reading[]): Record<string, number> {
  const out: Record<string, number> = {};
  const flat = (reading: Reading) => {
    const entries: [string, number][] = [];
    const walk = (prefix: string, value: object) => {
      for (const [key, inner] of Object.entries(value)) {
        if (typeof inner === 'number') entries.push([prefix + key, inner]);
        else walk(`${prefix}${key}.`, inner as object);
      }
    };
    walk('', reading);
    return entries;
  };
  for (const [key] of flat(readings[0]!)) out[key] = Number(median(readings.map((reading) => Object.fromEntries(flat(reading))[key]!)).toFixed(2));
  return out;
}

const server = await serveApp(undefined, { webDir: hostWebDir, port: PORT });
const results: Record<string, Record<string, { runs: Partial<Record<Segment, Reading>>[]; summary: Partial<Record<Segment, Record<string, number>>> }>> = {};
const failures: string[] = [];
try {
  for (const shape of shapes) {
    for (const profile of profiles) {
      const runs: Partial<Record<Segment, Reading>>[] = [];
      for (let index = 0; index < RUNS; index++) {
        const { readings, failures: found } = await run(server.url, shape, profile);
        failures.push(...found.map((failure) => `${shape} ${profile.name} run ${index + 1}: ${failure}`));
        runs.push(readings);
        const line = Object.entries(readings).map(([segment, reading]) => `${segment} work p50 ${reading.workP50Ms} p95 ${reading.workP95Ms} ms, late ${reading.latePct}%, cells ${reading.cells.p50}`);
        console.log(`${shape} ${profile.name} ${index + 1}/${RUNS}: ${line.join('; ')}`);
      }
      const summary: Partial<Record<Segment, Record<string, number>>> = {};
      for (const segment of ['scroll', 'fling', 'hfling'] as Segment[]) {
        const readings = runs.flatMap((reading) => (reading[segment] ? [reading[segment]] : []));
        if (readings.length) summary[segment] = summarize(readings);
      }
      (results[shape] ??= {})[profile.name] = { runs, summary };
      for (const [segment, numbers] of Object.entries(summary))
        console.log(`  ${shape} ${profile.name} ${segment} (median of ${RUNS}): work p50 ${numbers.workP50Ms} p95 ${numbers.workP95Ms} ms (recorder ${numbers['recorder.p50Ms']}/${numbers['recorder.p95Ms']}), late ${numbers.latePct}%, intervals p95 ${numbers['intervals.p95Ms']} ms, placeholders ${numbers.placeholderPct}%, cells p50 ${numbers['cells.p50']} max ${numbers['cells.max']}, busy ${numbers.busyMs} ms`);
    }
  }
} finally {
  await server.close();
}

const label = option('label');
if (label) {
  const date = localDate();
  const out = join(perfDir, 'results', `${date}-${label}.json`);
  mkdirSync(join(perfDir, 'results'), { recursive: true });
  const protocol = { browser: 'chromium headless=new', viewport: '1440x900', dpr: 2, runs: RUNS, cold: true, scroll: { px: SCROLL_PX, everyMs: SCROLL_EVERY_MS, steps: SCROLL_STEPS }, flingMs: FLING_MS, tailMs: TAIL_MS, build: BUILD, cells: CELLS ?? null };
  writeFileSync(out, `${JSON.stringify({ date, label, ...machineInfo(), protocol, results, failures }, null, 2)}\n`);
  console.log(`wrote ${out}`);
}
if (failures.length) {
  console.error(`FAIL\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
