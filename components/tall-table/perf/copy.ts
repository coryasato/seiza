// `copy`'s cost in the bare host, per shape (narrow, wide), on the host's
// release build with `copy`, cold, under the root's measurement protocol
// (reference and throttled, median of `--runs`):
//
// - a copy near the cap from a cold view: the first `--fraction` (0.9) of
//   the cap's worth of rows, every column, selected through the host's
//   hook and copied by the host's confirmed copy (Cmd+Shift+C: the key's
//   cell limit doesn't hold it; the cap does). Timed from the key's event
//   to the copy's text all in (`tall-table:copied`) and to the browser's
//   write resolving (`tall-table:copy-written`), with rows a second over
//   the first, and the wasm heap (its memory, which never shrinks) before
//   the key and after the write.
// - frame work and late frames under a steady scroll (perf.ts's: 300 px
//   every 16 ms for 2 s) during the same copy started again from the top,
//   against the same scroll with no copy, the selection standing in both.
//   Each traced on its own: per-frame work is the trace's
//   (`frameWork`), with the main thread's time outside frames, where a
//   copy's turns run, and the time the scroll took to rest; late frames
//   from `frameRecorder`'s rAFs. A copy that ended before the scroll did
//   is said (`coveredPct`, of the scroll's first wheel to its rest). The
//   window ends at the scroll's rest (and `TAIL_MS`), whether or not the
//   copy has ended.
//
// The rows a shape's copy takes come from a sizing pass before the runs:
// the bytes of its first page's rows, as the source's exact text
// (`__tallTableExact`) with a tab between fields and a line break between
// rows, scaled to the fraction of the cap. Chromium is granted
// `clipboard-write`, as a real Chrome grants a focused page.
//
// Usage: node components/tall-table/perf/copy.ts [--runs 10] [--shape narrow|wide]
//          [--profile reference|throttled] [--fraction 0.9] [--label <name>]
// --label writes perf/results/<date>-<label>.json. Run
// `just tall-table build copy` first.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { frameIntervals, frameRecorder, open, recordedBetween, waitMark, wheel } from '../../../shared-web/perf/harness.ts';
import { PROFILES, localDate, machineInfo, median, option, percentiles, type Profile } from '../../../shared-web/perf/protocol.ts';
import { serveApp } from '../../../shared-web/perf/serve.ts';
import { ORIGIN_MARK, Trace, WORK_CATEGORIES, frameWork, lateFrames } from '../../../shared-web/perf/trace.ts';
import { COPIED_MARK, COPY_WRITTEN_MARK, FILLED_MARK, PORT, SHAPES, buildName, builtFeatures, copyReached, exactTexts, filledWhere, hostWebDir, lastCopyId, perfDir, selectThrough, selected, shown, type Selection, type Shape , pick } from './harness.ts';

const RUNS = Number(option('runs') ?? 10);
const FRACTION = Number(option('fraction') ?? 0.9);
/** The table's default cap (`CopyOptions::max_bytes`), which the host keeps. */
const MAX_BYTES = 64 * 2 ** 20;
const PAGE_ROWS = 1024;
/** The steady scroll, as perf.ts's. */
const SCROLL_PX = 300;
const SCROLL_EVERY_MS = 16;
const SCROLL_STEPS = 125;
/** Idle after a segment's view rests, inside its window. */
const TAIL_MS = 300;
/** The longest a copy near the cap may take, throttled. */
const COPY_TIMEOUT_MS = 300_000;

const shapes = pick('shape', SHAPES);
const profiles = pick('profile', PROFILES.map((profile) => profile.name)).map((name) => PROFILES.find((profile) => profile.name === name)!);
if (!Number.isInteger(RUNS) || RUNS < 1) throw new Error(`--runs ${option('runs')}: not a positive whole number`);
if (!(FRACTION > 0 && FRACTION < 1)) throw new Error(`--fraction ${option('fraction')}: not between 0 and 1`);
const features = builtFeatures();
if (!features.includes('copy')) throw new Error('copy.ts needs the host built with copy: `just tall-table build copy`');

/** An init script: the time of each keydown with Shift and Cmd or Ctrl
 *  held on `c` (the host's confirmed copy), its event's own timestamp, on
 *  `__copyKeys`. */
function keyLog(): void {
  const keys: number[] = [];
  (globalThis as unknown as { __copyKeys: number[] }).__copyKeys = keys;
  addEventListener('keydown', (event) => {
    if (event.shiftKey && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'c') keys.push(event.timeStamp);
  }, { capture: true });
}

interface Copying {
  rows: number;
  bytes: number;
  keyToCopiedMs: number;
  keyToWrittenMs: number;
  rowsPerS: number;
  heapBeforeMiB: number;
  heapAfterMiB: number;
}

interface Frames {
  frames: number;
  workP50Ms: number;
  workP95Ms: number;
  workMaxMs: number;
  /** Main-thread CPU over the window, and of it outside any frame (a
   *  copy's turns run there, so per-frame work alone doesn't show them). */
  busyMs: number;
  outsideFramesMs: number;
  /** From the first wheel to the view resting filled. */
  restMs: number;
  latePct: number;
  intervalsP95Ms: number;
  windowMs: number;
}

interface Reading {
  copy: Copying;
  scroll: Frames;
  scrollCopying: Frames & { coveredPct: number };
}

const now = (page: Page) => page.evaluate(() => performance.now());
const heap = (page: Page) => page.evaluate(() => (globalThis as unknown as { __tallTableHeap: () => number }).__tallTableHeap());
const mib = (bytes: number) => Number((bytes / 2 ** 20).toFixed(2));
const round = (ms: number) => Number(ms.toFixed(2));

/** Each shape's rows near the cap, from the sizing pass. */
const sized: Partial<Record<Shape, { rows: number; bytesPerRow: number }>> = {};

/** The rows `FRACTION` of the cap holds in `shape`, from its first page's
 *  bytes. */
async function size(url: string, shape: Shape): Promise<{ rows: number; bytesPerRow: number }> {
  const session = await open(chromium, url, { params: { shape } });
  try {
    await waitMark(session.page, FILLED_MARK);
    const { layout } = await shown(session.page);
    const columns = layout.columns.length;
    const cells: [number, number][] = [];
    for (let row = 0; row < PAGE_ROWS; row++) for (let column = 0; column < columns; column++) cells.push([row, column]);
    const texts = await exactTexts(session.page, cells);
    // A tab between fields, a line break between rows; NULL empty.
    const bytes = texts.reduce((sum, text) => sum + Buffer.byteLength(text ?? ''), 0) + PAGE_ROWS * columns;
    const bytesPerRow = bytes / PAGE_ROWS;
    return { rows: Math.floor((FRACTION * MAX_BYTES) / bytesPerRow), bytesPerRow: round(bytesPerRow) };
  } finally {
    await session.close();
  }
}

/** The host's confirmed copy of what's selected, once it's started:
 *  `after`, the id of the copy before it (for `copyReached`), and its
 *  state then. */
async function confirmedCopy(page: Page): Promise<{ after: number; state: Awaited<ReturnType<typeof copyReached>> }> {
  const after = await lastCopyId(page);
  await page.keyboard.press('ControlOrMeta+Shift+c');
  const state = await copyReached(page, after, ['copying', 'written', 'refused', 'failed', 'unavailable'], 5_000);
  return { after, state };
}

/** Traces `act` on its own, from right after tracing starts to its end
 *  and `TAIL_MS` more. */
async function traced(browser: Browser, page: Page, act: () => Promise<void>): Promise<Frames & { from: number; rested: number; to: number }> {
  await browser.startTracing(page, { categories: WORK_CATEGORIES });
  const from = await page.evaluate((name) => (performance.mark(name), performance.now()), ORIGIN_MARK);
  await act();
  const rested = await now(page);
  await page.waitForTimeout(TAIL_MS);
  const to = await now(page);
  const work = frameWork(new Trace(JSON.parse((await browser.stopTracing()).toString())), from, to);
  const perFrame = percentiles(work.frames.map((frame) => frame.ms));
  const intervals = frameIntervals(await recordedBetween(page, from, to));
  return {
    frames: work.frames.length,
    workP50Ms: round(perFrame.p50),
    workP95Ms: round(perFrame.p95),
    workMaxMs: round(perFrame.max),
    busyMs: round(work.busyMs),
    outsideFramesMs: round(work.busyMs - work.inFramesMs),
    restMs: round(rested - from),
    latePct: round(lateFrames(intervals).share * 100),
    intervalsP95Ms: round(percentiles(intervals).p95),
    windowMs: round(to - from),
    from,
    rested,
    to,
  };
}

/** A traced window's readings, without its bounds. */
function frames({ from: _from, rested: _rested, to: _to, ...reading }: Frames & { from: number; rested: number; to: number }): Frames {
  return reading;
}

/** The steady scroll down, on a fixed schedule (not awaiting each wheel,
 *  which would pace the input by its cost), until the view rests filled. */
async function scroll(page: Page): Promise<void> {
  const sent: Promise<void>[] = [];
  for (let step = 0; step < SCROLL_STEPS; step++) {
    sent.push(wheel(page, SCROLL_PX));
    await page.waitForTimeout(SCROLL_EVERY_MS);
  }
  await Promise.all(sent);
  await filledWhere(page, 'true', 60_000);
}

/** Back to the top with `selection` standing: Escape clears it first
 *  (Home with a selection moves only its active cell, row 0 already, so it
 *  would scroll nothing), then it's selected again. Never while a copy
 *  runs: Escape would cancel it. */
async function home(page: Page, selection: Selection): Promise<void> {
  await page.keyboard.press('Escape');
  await selected(page, null);
  await page.keyboard.press('Home');
  await filledWhere(page, 's.first === 0', 60_000);
  await selectThrough(page, selection);
}

/** One cold run of `shape`. */
async function run(url: string, shape: Shape, profile: Profile): Promise<{ reading: Reading | null; failures: string[] }> {
  const failures: string[] = [];
  const rows = sized[shape]!.rows;
  let session: Awaited<ReturnType<typeof open>> | null = null;
  try {
    session = await open(chromium, url, { profile, params: { shape }, init: [keyLog, frameRecorder] });
    const { page } = session;
    const browser = session.context.browser()!;
    await session.context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(url).origin });
    await waitMark(page, FILLED_MARK, 0, 120_000);
    const { layout } = await shown(page);
    await page.mouse.move(layout.left + 300, layout.top + 300);
    const selection: Selection = { kind: 'rows', anchor: [0, 0], head: [rows - 1, 0] };
    await selectThrough(page, selection);

    // The copy from a cold view: pages 0–2 loaded, the rest read.
    const heapBefore = await heap(page);
    const { after, state: started } = await confirmedCopy(page);
    if (started.state !== 'copying' && started.state !== 'written') throw new Error(`the copy started ${JSON.stringify(started)}`);
    const ended = await copyReached(page, after, ['written', 'refused', 'failed', 'unavailable'], COPY_TIMEOUT_MS);
    if (ended.state !== 'written') throw new Error(`the copy ended ${JSON.stringify(ended)}, not written`);
    const key = (await page.evaluate(() => (globalThis as unknown as { __copyKeys: number[] }).__copyKeys)).at(-1)!;
    const copied = await waitMark(page, COPIED_MARK, key);
    const written = await waitMark(page, COPY_WRITTEN_MARK, key);
    const heapAfter = await heap(page);
    const copy: Copying = {
      rows,
      bytes: ended.bytes,
      keyToCopiedMs: round(copied - key),
      keyToWrittenMs: round(written - key),
      rowsPerS: Math.round((rows / (copied - key)) * 1000),
      heapBeforeMiB: mib(heapBefore),
      heapAfterMiB: mib(heapAfter),
    };

    // The scroll with no copy, then the same during one.
    await home(page, selection);
    const alone = frames(await traced(browser, page, () => scroll(page)));
    await home(page, selection);
    // The window is the scroll's, to its rest: the copy may run on after
    // it, and its idle frames then aren't the scroll's.
    let copying = 0;
    const during = await traced(browser, page, async () => {
      copying = (await confirmedCopy(page)).after;
      await scroll(page);
    });
    const end = await copyReached(page, copying, ['written', 'refused', 'failed', 'unavailable'], COPY_TIMEOUT_MS);
    if (end.state !== 'written') throw new Error(`the copy during the scroll ended ${JSON.stringify(end)}, not written`);
    const copyEnd = await waitMark(page, COPY_WRITTEN_MARK, during.from);
    // The share of the scroll, its first wheel to its rest, the copy ran
    // through.
    const coveredPct = round(((Math.min(copyEnd, during.rested) - during.from) / (during.rested - during.from)) * 100);
    failures.push(...session.problems);
    return { reading: { copy, scroll: alone, scrollCopying: { ...frames(during), coveredPct } }, failures };
  } catch (error) {
    failures.push((error as Error).message.split('\n')[0]!);
    return { reading: null, failures };
  } finally {
    await session?.close();
  }
}

/** The median over runs of each number in a reading. */
function summarize(readings: Reading[]): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const part of Object.keys(readings[0]!) as (keyof Reading)[]) {
    out[part] = {};
    for (const key of Object.keys(readings[0]![part])) out[part][key] = Number(median(readings.map((reading) => (reading[part] as unknown as Record<string, number>)[key]!)).toFixed(2));
  }
  return out;
}

const server = await serveApp(undefined, { webDir: hostWebDir, port: PORT });
const results: Record<string, Record<string, { runs: Reading[]; summary: Record<string, Record<string, number>> }>> = {};
const failures: string[] = [];
console.log(`build: ${buildName(features)}, ${FRACTION} of the ${MAX_BYTES / 2 ** 20} MiB cap`);
try {
  for (const shape of shapes) {
    sized[shape] = await size(server.url, shape);
    console.log(`${shape}: ${sized[shape].bytesPerRow} bytes a row → ${sized[shape].rows} rows`);
    for (const profile of profiles) {
      const readings: Reading[] = [];
      for (let index = 0; index < RUNS; index++) {
        const { reading, failures: found } = await run(server.url, shape, profile);
        failures.push(...found.map((failure) => `${shape} ${profile.name} run ${index + 1}: ${failure}`));
        if (!reading) continue;
        readings.push(reading);
        const { copy, scroll, scrollCopying } = reading;
        console.log(`${shape} ${profile.name} ${index + 1}/${RUNS}: ${(copy.bytes / 2 ** 20).toFixed(1)} MiB, key → copied ${copy.keyToCopiedMs} ms, → written ${copy.keyToWrittenMs} ms, ${copy.rowsPerS} rows/s, heap ${copy.heapBeforeMiB} → ${copy.heapAfterMiB} MiB; scroll work p50 ${scroll.workP50Ms} p95 ${scroll.workP95Ms} ms, late ${scroll.latePct}%, outside frames ${scroll.outsideFramesMs} ms, rest ${scroll.restMs} ms; during a copy p50 ${scrollCopying.workP50Ms} p95 ${scrollCopying.workP95Ms} ms, late ${scrollCopying.latePct}%, outside frames ${scrollCopying.outsideFramesMs} ms, rest ${scrollCopying.restMs} ms (covered ${scrollCopying.coveredPct}%)`);
      }
      if (!readings.length) continue;
      const summary = summarize(readings);
      (results[shape] ??= {})[profile.name] = { runs: readings, summary };
      const { copy, scroll, scrollCopying } = summary as Record<string, Record<string, number>>;
      console.log(`  ${shape} ${profile.name} (median of ${readings.length}): key → copied ${copy!.keyToCopiedMs} ms, → written ${copy!.keyToWrittenMs} ms, ${copy!.rowsPerS} rows/s, heap ${copy!.heapBeforeMiB} → ${copy!.heapAfterMiB} MiB; scroll p50 ${scroll!.workP50Ms} p95 ${scroll!.workP95Ms} ms late ${scroll!.latePct}%, during a copy p50 ${scrollCopying!.workP50Ms} p95 ${scrollCopying!.workP95Ms} ms late ${scrollCopying!.latePct}% (covered ${scrollCopying!.coveredPct}%)`);
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
  const protocol = { browser: 'chromium headless=new', viewport: '1440x900', dpr: 2, runs: RUNS, cold: true, fraction: FRACTION, maxBytes: MAX_BYTES, sized, scroll: { px: SCROLL_PX, everyMs: SCROLL_EVERY_MS, steps: SCROLL_STEPS }, tailMs: TAIL_MS, build: buildName(features) };
  writeFileSync(out, `${JSON.stringify({ date, label, ...machineInfo(), protocol, results, failures }, null, 2)}\n`);
  console.log(`wrote ${out}`);
}
if (failures.length) {
  console.error(`FAIL\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
