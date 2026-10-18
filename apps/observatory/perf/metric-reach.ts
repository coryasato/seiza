// Reach and correctness, on either bare contender page, cold: the view's
// row count is the file's `count(*)`, and End shows the last row, real, its
// key the file's last (metrics/metrics.ts, `reach`), both from data/'s
// native DuckDB, independent of the pages' engine. Also how long End took
// to show the last row filled (the key's event → `contender:filled`).
//
// Usage: node apps/observatory/perf/metric-reach.ts [--side gpui|tanstack]
//          [--runs 10] [--profile reference|throttled] [--label <name>]
// Needs `just observatory data`; run `just observatory gpui-build` and
// `tanstack-build` first.

import { waitMark } from '../../../shared-web/perf/harness.ts';
import { reach, type Reach } from '../metrics/metrics.ts';
import { fileFacts, filledState, inputRecorder, keys, medianOf, now, opened, openSide, pressProbeKey, runMetric, type RunResult } from './contender.ts';
import { MARKS } from './harness.ts';

const facts = await fileFacts();
console.log(`native DuckDB: count(*) ${facts.count}, last spkid ${facts.lastKey}`);

interface Run extends RunResult, Reach {
  rows: number;
  lastCell: string | null;
  /** End's event → its `contender:filled`, ms. */
  endFilledMs: number;
}

await runMetric<Run>(
  'reach',
  async ({ side, profile, url }) => {
    const session = await openSide(side, url, profile, { init: [inputRecorder] });
    const { page } = session;
    try {
      const { state: start } = await opened(session);
      await pressProbeKey(page);
      const since = await now(page);
      await page.keyboard.press('End');
      const atEnd = await filledState(page, 's.end === s.rows', 60_000);
      const filled = await waitMark(page, MARKS.filled, since, 60_000);
      const endKey = (await keys(page)).find((at) => at >= since) ?? since;
      const reading = reach(start, atEnd, facts.count, facts.lastKey);
      const failures = [...session.problems];
      if (!reading.countMatches) failures.push(`rows ${start.rows}, count(*) ${facts.count}`);
      if (!reading.lastRowReached) failures.push(`End: rows ${atEnd.first}–${atEnd.end}, lastCell ${atEnd.lastCell}, the file's last spkid ${facts.lastKey}`);
      return { ...reading, rows: start.rows, lastCell: atEnd.lastCell, endFilledMs: filled - endKey, failures };
    } finally {
      await session.close();
    }
  },
  (runs) => ({
    countMatches: `${runs.filter((run) => run.countMatches).length}/${runs.length}`,
    lastRowReached: `${runs.filter((run) => run.lastRowReached).length}/${runs.length}`,
    endFilledMs: medianOf(runs, (run) => run.endFilledMs),
  }),
  { file: facts },
);
