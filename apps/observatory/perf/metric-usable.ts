// Time to first usable, on either bare contender page, cold: the candidate
// moment (`contender:usable`) confirmed by the probe: a key right after it
// must change the view's state, and the frame that draws the change must be
// presented within two frames of the key's event (metrics/metrics.ts,
// `firstUsable`, `probePresented`: from Chromium's trace, light enough to
// run through the load). On GPUI the key's own `EventLatency` must end on
// that frame; the DOM's probe changes nothing visible (a hidden element),
// so no frame presents it and its frame is the first after the commit,
// unguarded. First pixels (`contender:first-pixels`) is
// recorded beside it, a footnote.
//
// Usage: node apps/observatory/perf/metric-usable.ts [--side gpui|tanstack]
//          [--runs 10] [--profile reference|throttled] [--label <name>]
// Run `just observatory gpui-build` and `tanstack-build` first.

import { waitMark } from '../../../shared-web/perf/harness.ts';
import { PROBE_CATEGORIES, PROBE_KEY, Trace, firstUsable, probeLatency, probePresented, type FirstUsable } from '../metrics/metrics.ts';
import { inputRecorder, keys, medianOf, now, openSide, originMark, runMetric, type RunResult } from './contender.ts';
import { MARKS, lastMark } from './harness.ts';

interface Run extends RunResult, FirstUsable {
  /** The key's event → `contender:input`, ms (GPUI: after the presented
   *  frame; TanStack: the commit, before it). */
  markMs: number | null;
  /** The guard (GPUI): the key's `EventLatency`, ms, and whether it ended
   *  on the probe's frame. The DOM's probe changes nothing visible, so its
   *  key reaches no presented frame: null there. */
  eventLatencyMs: number | null;
  guarded: boolean | null;
  firstPixelsMs: number | null;
}

await runMetric<Run>(
  'usable',
  async ({ side, profile, url }) => {
    const session = await openSide(side, url, profile, {
      init: [originMark, inputRecorder],
      before: (page, browser) => browser.startTracing(page, { categories: PROBE_CATEGORIES }),
    });
    const { page, browser } = session;
    try {
      const usable = await waitMark(page, MARKS.usable, 0, 120_000);
      const since = await now(page);
      await page.keyboard.press(PROBE_KEY);
      const input = await waitMark(page, MARKS.input, since, 5_000).catch(() => null);
      // The frame after the mark's: its presentation is in the trace.
      await page.waitForTimeout(100);
      const trace = new Trace(JSON.parse((await browser.stopTracing()).toString()));
      const key = (await keys(page))[0];
      if (key === undefined) throw new Error('the probe key never reached the page');
      const presented = probePresented(trace);
      const reading = firstUsable(usable, key, presented);
      const latency = probeLatency(trace);
      const guarded = side === 'gpui' ? latency !== null && presented !== null && Math.abs(latency.end - presented) <= 1 : null;
      const failures = [...session.problems];
      if (guarded === false) failures.push(`the probe key's EventLatency ${latency ? `ended ${(latency.end - (presented ?? 0)).toFixed(1)} ms from` : "reached no frame, not even"} the probe's frame`);
      if (!reading.confirmed) failures.push(`the probe didn't confirm usable: key at ${key.toFixed(1)}, usable ${usable.toFixed(1)}, its frame presented ${reading.probeMs?.toFixed(1) ?? 'never'} ms after the key (mark ${input === null ? 'never' : `${(input - key).toFixed(1)} ms`})`);
      return { ...reading, markMs: input === null ? null : input - key, eventLatencyMs: latency?.ms ?? null, guarded, firstPixelsMs: await lastMark(page, MARKS.firstPixels), failures };
    } finally {
      await session.close();
    }
  },
  (runs) => ({
    usableMs: medianOf(runs, (run) => run.usableMs),
    probeMs: medianOf(runs, (run) => run.probeMs),
    markMs: medianOf(runs, (run) => run.markMs),
    confirmed: `${runs.filter((run) => run.confirmed).length}/${runs.length}`,
    guarded: runs.some((run) => run.guarded !== null) ? `${runs.filter((run) => run.guarded).length}/${runs.length}` : null,
    firstPixelsMs: medianOf(runs, (run) => run.firstPixelsMs),
  }),
);
