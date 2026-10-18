// Time to data, on either bare contender page, cold: `contender:open` (the
// engine is ready) → every visible row painted with real data
// (metrics/metrics.ts, `timeToData`). GPUI's filled mark lands right after
// the presented frame; the TanStack contender's in the commit, so its
// moment is the latest Element Timing paint among the visible rows' cells.
//
// Usage: node apps/observatory/perf/metric-data.ts [--side gpui|tanstack]
//          [--runs 10] [--profile reference|throttled] [--label <name>]
// Run `just observatory gpui-build` and `tanstack-build` first.

import { rowsPainted, timeToData, type TimeToData } from '../metrics/metrics.ts';
import { medianOf, opened, openSide, paintRecorder, paints, runMetric, type RunResult } from './contender.ts';

interface Run extends RunResult, TimeToData {
  rows: number;
}

/** Element Timing entries arrive after the paint, in an observer's task. */
const PAINT_WAIT_MS = 2_000;

await runMetric<Run>(
  'data',
  async ({ side, profile, url }) => {
    const session = await openSide(side, url, profile, { init: side === 'tanstack' ? [paintRecorder] : [] });
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
  (runs) => ({
    ms: medianOf(runs, (run) => run.ms),
    openMs: medianOf(runs, (run) => run.openMs),
    filledMarkMs: medianOf(runs, (run) => run.filledMarkMs),
  }),
);
