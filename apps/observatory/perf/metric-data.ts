// Time to data, on either bare contender page, cold: `contender:open` (the
// engine is ready) → every visible row painted with real data
// (metrics/metrics.ts, `timeToData`). GPUI's filled mark lands right after
// the presented frame; the TanStack contender's in the commit, so its
// moment is the latest Element Timing paint among the visible rows' cells.
// On the tail level the log downloads first, so the measurement is the
// table keeping up, not the network: the load is split (`tailData`), from
// a light trace through it on both sides. Download: open → the file
// fetched whole (its response's end, network only, the same on both sides).
// Data: the clock's first count → the presentation of the first frame that
// drew its rows (the UI's share; from the count, so a side's slower start
// of the clock doesn't move it). Open to data: the total, for continuity
// with the other scenarios' time to data. The table opens at 0 rows and
// its rows then move, so the check is the content, not a position: the
// tail drawn is one of the clock's counts and that frame's rows are all
// real (`tailContent`).
//
// With `--fonts` (the admin table's toggle, GPUI only), the same with
// `?fonts`, then the toggle's own: Scripts drawn in, `timeOrigin` →
// `contender:fonts` (set right after the presentation of the first frame
// drawn with the faces, checked against that frame's GPU work as TTFP's
// mark is: `presentedMark`, its recorder armed only at `contender:fonts-in`,
// so the time to data before it runs unwrapped; fonts in → drawn, one frame,
// runs with its GPU calls wrapped, microseconds each, the price of the check), split into the rows
// (`timeOrigin` → the first `contender:filled`), the faces' fetch (→
// `contender:fonts-in`), and fonts in → drawn; and each face's bytes on the
// wire, every face fetched once and after the rows were in.
//
// Usage: node apps/observatory/perf/metric-data.ts [--side gpui|tanstack]
//          [--runs 10] [--profile reference|throttled] [--label <name>]
//          [--scenario <id> [--stop <id,…>]] [--fonts] (contender.ts)
// Run `just observatory gpui-build` and `tanstack-build` first.

import { presentedMark, presentingTaskRecorder, waitMark } from '../../../shared-web/perf/harness.ts';
import { PROBE_CATEGORIES, Trace, rowsPainted, tailContent, tailData, timeToData, type StateFrame, type TailData, type TimeToData } from '../metrics/metrics.ts';
import { flaggedScenario, fontsParams, frameRecorder, medianOf, opened, openSide, originMark, paintRecorder, paints, runMetric, stateRecorder, type RunContext, type RunResult } from './contender.ts';
import { MARKS, facesChecked, facesFetched } from './harness.ts';
import { SCRIPT_FACES } from '../contenders/fonts/faces.ts';
import type { Page } from '@playwright/test';
import { tailLog, tailRecorder, wholeFileWatch } from './tail-metric.ts';
import { DATA_FILE } from '../contenders/tail/data.ts';

interface Run extends RunResult, Partial<TimeToData>, Partial<TailData> {
  rows: number;
  /** With `--fonts`: the toggle's own readings. */
  fonts?: ScriptsDrawn;
}

/** The fonts toggle's readings in one run, page ms. */
interface ScriptsDrawn {
  /** `timeOrigin` → `contender:fonts`: the first frame drawn with the faces. */
  scriptsDrawnMs: number;
  /** Its split: `timeOrigin` → the first `contender:filled`, → `contender:fonts-in`, → `contender:fonts`. */
  rowsMs: number;
  fetchMs: number;
  inToDrawnMs: number;
  /** `presentedMark`'s reading of `contender:fonts`. */
  presented: string;
  /** Each face's bytes on the wire, by its served name, and their sum. */
  faceBytes: Record<string, number>;
  bytes: number;
}

/** The faces fetched, their marks, and the frame they drew (above). */
async function scriptsDrawn(page: Page, filled: number, failures: string[]): Promise<ScriptsDrawn> {
  const done = await page.waitForFunction(
    (names) => names.find((name) => performance.getEntriesByName(name, 'mark').length) ?? false,
    [MARKS.fonts, MARKS.fontsFailed],
    { timeout: 120_000, polling: 10 },
  );
  if ((await done.jsonValue()) === MARKS.fontsFailed) throw new Error('contender:fonts-failed: a face didn\'t load or match its pin');
  const at = await waitMark(page, MARKS.fonts);
  const fontsIn = await waitMark(page, MARKS.fontsIn);
  const presented = await presentedMark(page, at);
  if (!presented.ok) failures.push(`contender:fonts isn't right after a presented frame (${presented.detail})`);
  const faces = await facesFetched(page);
  const { once, afterRows } = facesChecked(faces, filled);
  if (!once) failures.push(`${faces.length} faces fetched, not each of the ${SCRIPT_FACES.length} once`);
  if (!afterRows) failures.push('a face was fetched before the rows were in');
  if (!(filled < fontsIn && fontsIn < at)) failures.push(`the marks out of order: filled ${filled.toFixed(1)}, fonts in ${fontsIn.toFixed(1)}, drawn ${at.toFixed(1)}`);
  const faceBytes = Object.fromEntries(faces.map((entry) => [entry.name.slice(entry.name.lastIndexOf('/') + 1), entry.transferSize]));
  return { scriptsDrawnMs: at, rowsMs: filled, fetchMs: fontsIn - filled, inToDrawnMs: at - fontsIn, presented: presented.detail, faceBytes, bytes: Object.values(faceBytes).reduce((sum, bytes) => sum + bytes, 0) };
}

/** On the tail level, every summary takes the split's shape, a side whose runs all failed too. */
const TAIL_LEVEL = flaggedScenario().level === 'tail';

/** Element Timing entries arrive after the paint, in an observer's task. */
const PAINT_WAIT_MS = 2_000;

/** The tail level's load, split (above). */
async function tail(side: RunContext['side'], profile: RunContext['profile'], url: string, picked: RunContext['picked']): Promise<Run> {
  let whole: ReturnType<typeof wholeFileWatch> | undefined;
  const session = await openSide(side, url, profile, {
    picked,
    init: [originMark, tailRecorder, stateRecorder, frameRecorder],
    before: async (page, browser) => {
      whole = wholeFileWatch(page);
      await browser.startTracing(page, { categories: PROBE_CATEGORIES });
    },
  });
  const { page, browser } = session;
  try {
    const failures = [...session.problems];
    const open = await waitMark(page, MARKS.open, 0, 180_000);
    await waitMark(page, MARKS.tail, open, 180_000);
    // The frame after the mark's: its presentation is in the trace, and the recorder's sample of it.
    await page.waitForTimeout(100);
    const trace = new Trace(JSON.parse((await browser.stopTracing()).toString()));
    const timing = whole!.request().timing();
    if (!(timing.responseEnd >= 0)) throw new Error(`${DATA_FILE} whole: no response end in its timing`);
    const { batches, marks, origin } = await tailLog(page);
    const downloaded = timing.startTime + timing.responseEnd - origin;
    const reading = tailData(trace, open, downloaded, batches, marks, origin);
    if (!reading) throw new Error("no presentation for the frame that drew the clock's first count");
    const firstFrame = marks.findIndex(([at, rows]) => at >= batches[0]![1] - origin && rows >= batches[0]![0]);
    // A few more frames for the content check, past the first's.
    await page.waitForTimeout(200);
    const later = await tailLog(page);
    const frames = await page.evaluate(() => (globalThis as { __seizaFrames?: StateFrame[] }).__seizaFrames ?? []);
    failures.push(...tailContent(later.marks.slice(firstFrame), later.batches, frames, origin));
    return { ...reading, rows: marks[firstFrame]![1], failures };
  } finally {
    await session.close();
  }
}

await runMetric<Run>(
  'data',
  async ({ side, profile, url, picked, fonts }) => {
    if (picked?.scenario.level === 'tail') return tail(side, profile, url, picked);
    const session = await openSide(side, url, profile, {
      picked,
      params: fontsParams(fonts),
      init: side === 'tanstack' ? [paintRecorder] : [],
      // Armed at the faces' arrival: nothing before it is wrapped.
      before: fonts ? async (page) => void (await page.addInitScript(presentingTaskRecorder, MARKS.fontsIn)) : undefined,
    });
    const { page } = session;
    try {
      const { open, filled, state } = await opened(session);
      let painted: number | null = null;
      const failures = [...session.problems];
      if (side === 'tanstack') {
        const deadline = Date.now() + PAINT_WAIT_MS;
        let cells = rowsPainted(await paints(page), open, state.first, state.end);
        while (cells.missing.length && Date.now() < deadline) {
          await page.waitForTimeout(50);
          cells = rowsPainted(await paints(page), open, state.first, state.end);
        }
        if (cells.missing.length) failures.push(`visible rows without a painted cell: ${cells.missing.slice(0, 5).join(', ')}`);
        painted = cells.latest;
      }
      const reading = timeToData(side, open, filled, painted);
      if (!reading) throw new Error('no paint for the visible rows');
      return { ...reading, rows: state.end - state.first, ...(fonts ? { fonts: await scriptsDrawn(page, filled, failures) } : {}), failures };
    } finally {
      await session.close();
    }
  },
  (runs) =>
    TAIL_LEVEL
      ? {
          downloadMs: medianOf(runs, (run) => run.downloadMs),
          fileToFirstBatchMs: medianOf(runs, (run) => run.fileToFirstBatchMs),
          dataMs: medianOf(runs, (run) => run.dataMs),
          dataMsRuns: runs.map((run) => run.dataMs),
          openToDataMs: medianOf(runs, (run) => run.openToDataMs),
          openMs: medianOf(runs, (run) => run.openMs),
        }
      : {
          ms: medianOf(runs, (run) => run.ms),
          openMs: medianOf(runs, (run) => run.openMs),
          filledMarkMs: medianOf(runs, (run) => run.filledMarkMs),
          ...(runs.some((run) => run.fonts)
            ? {
                fonts: {
                  scriptsDrawnMs: medianOf(runs, (run) => run.fonts?.scriptsDrawnMs),
                  scriptsDrawnMsRuns: runs.map((run) => (run.fonts ? Number(run.fonts.scriptsDrawnMs.toFixed(1)) : null)),
                  rowsMs: medianOf(runs, (run) => run.fonts?.rowsMs),
                  fetchMs: medianOf(runs, (run) => run.fonts?.fetchMs),
                  inToDrawnMs: medianOf(runs, (run) => run.fonts?.inToDrawnMs),
                  bytesKiB: medianOf(runs, (run) => (run.fonts ? run.fonts.bytes / 1024 : undefined)),
                  faceKiB: Object.fromEntries(
                    [...new Set(runs.flatMap((run) => Object.keys(run.fonts?.faceBytes ?? {})))].sort().map((face) => [face, medianOf(runs, (run) => { const bytes = run.fonts?.faceBytes[face]; return bytes === undefined ? undefined : bytes / 1024; })]),
                  ),
                },
              }
            : {}),
        },
  (picked) => (picked?.scenario.level === 'tail' ? { split: 'download: open → the file whole; data: the first count → its frame presented; openToData: the total' } : {}),
  { levels: ['base', 'wide', 'market', 'tail'], fontsToggle: true },
);
