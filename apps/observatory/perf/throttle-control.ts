// The throttle's control for a run under a feed or a replay (`metric-feed`,
// `metric-tail`, `metric-soak`): a fixed busy loop timed on the page after
// the run's windows, never before them (a long task before a window moves a
// page's frame scheduling for the whole of it). The throttled profile must
// slow it ~4× before the run's times are read as a slow device's: a
// throttled run whose loop took under `THROTTLE_MIN` times the side's
// reference median fails (unchecked when only the throttled profile runs,
// since the profiles run reference first).

import type { Page } from '@playwright/test';
import { median, type Profile } from '../../../shared-web/perf/protocol.ts';
import type { Side } from '../metrics/metrics.ts';

/** The throttled profile's busy loop must take at least this many times
 *  the reference's (the profile's 4×, less the loop's own spread). */
export const THROTTLE_MIN = 3.5;

/** The busy loop's time on the page, ms. */
export const spin = (page: Page): Promise<number> =>
  page.evaluate(() => {
    const t0 = performance.now();
    let x = 0;
    for (let i = 0; i < 3e7; i++) x = (x + i * 7) % 1000003;
    return [performance.now() - t0, x][0]!;
  });

/** Each side's reference busy loop, ms, by its runs so far in this process. */
const referenceSpin = new Map<Side, number[]>();

/** Records a reference run's loop, or checks a throttled one against the
 *  side's reference median: the failure, or null. */
export function throttleCheck(side: Side, profile: Profile, spinMs: number): string | null {
  if (profile.name === 'reference') {
    referenceSpin.set(side, [...(referenceSpin.get(side) ?? []), spinMs]);
    return null;
  }
  const reference = referenceSpin.get(side);
  const base = reference?.length ? median(reference) : null;
  return base !== null && spinMs < THROTTLE_MIN * base ? `the throttle's control: the busy loop took ${spinMs.toFixed(0)} ms, under ${THROTTLE_MIN}× the reference's ${base.toFixed(0)}` : null;
}
