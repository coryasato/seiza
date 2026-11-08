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
// Usage: node apps/observatory/perf/metric-data.ts [--side gpui|tanstack]
//          [--runs 10] [--profile reference|throttled] [--label <name>]
//          [--scenario <id> [--stop <id,…>]] (contender.ts)
// Run `just observatory gpui-build` and `tanstack-build` first.

import { waitMark } from '../../../shared-web/perf/harness.ts';
import { PROBE_CATEGORIES, Trace, rowsPainted, tailContent, tailData, timeToData, type StateFrame, type TailData, type TimeToData } from '../metrics/metrics.ts';
import { flaggedScenario, frameRecorder, medianOf, opened, openSide, originMark, paintRecorder, paints, runMetric, stateRecorder, type RunContext, type RunResult } from './contender.ts';
import { MARKS } from './harness.ts';
import { tailLog, tailRecorder, wholeFileWatch } from './tail-metric.ts';
import { DATA_FILE } from '../contenders/tail/data.ts';

interface Run extends RunResult, Partial<TimeToData>, Partial<TailData> {
  rows: number;
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
  async ({ side, profile, url, picked }) => {
    if (picked?.scenario.level === 'tail') return tail(side, profile, url, picked);
    const session = await openSide(side, url, profile, { picked, init: side === 'tanstack' ? [paintRecorder] : [] });
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
      return { ...reading, rows: state.end - state.first, failures };
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
        },
  (picked) => (picked?.scenario.level === 'tail' ? { split: 'download: open → the file whole; data: the first count → its frame presented; openToData: the total' } : {}),
  { levels: ['base', 'wide', 'market', 'tail'] },
);
