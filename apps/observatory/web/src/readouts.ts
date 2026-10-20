/**
 * What the page's numbers show (`docs/DECISIONS.md`, "Page"): the headline
 * cards, each a metric of `perf/budgets.json` with its live reading in this
 * tab, and the input-to-response chart, cold only. Pure data: the build's
 * plugin (`../cold.ts`) and `perf/page.ts` read it too.
 */

import type { LiveReadings } from '../../metrics/metrics.ts';

export type Profile = 'reference' | 'throttled';
export const PROFILES: Profile[] = ['reference', 'throttled'];

export interface Card {
  /** A `perf/budgets.json` metric, less its profile: `<metric>-<profile>`. */
  metric: string;
  label: string;
  unit: string;
  /** Its reading in this tab, or what stands in for one. */
  live: (readings: LiveReadings) => number | null;
  /** What the live row reads, where it differs from the cold reading. */
  liveNote: string;
  /** Said where the live reading is missing. */
  liveEmpty: string;
}

/** The headline cards, the most important first (the only one open on a
 *  phone). Each has a reading a page can take; the trace's (input latency,
 *  per-frame work) are the chart's and the README's. */
export const CARDS: Card[] = [
  {
    metric: 'usable',
    label: 'Time to first usable',
    unit: 'ms',
    live: (readings) => readings.usableMs,
    liveNote: 'The frame’s navigation to its usable mark; a tab has no probe key to confirm it.',
    liveEmpty: 'loading',
  },
  {
    metric: 'data',
    label: 'Time to data',
    unit: 'ms',
    live: (readings) => readings.dataMs,
    liveNote: 'The open to its first filled mark: GPUI’s after the presented frame, TanStack’s in its commit, up to a frame before its paint.',
    liveEmpty: 'loading',
  },
  {
    metric: 'fling-late',
    label: 'Fling: late main-thread frames',
    unit: '%',
    live: (readings) => (readings.scrolling ? Number((readings.scrolling.lateShare * 100).toFixed(1)) : null),
    liveNote: 'Frames over 1.5 refreshes while you scroll, at your display’s refresh.',
    liveEmpty: 'scroll to measure',
  },
  {
    metric: 'memory',
    label: 'Page memory',
    unit: 'MiB',
    live: (readings) => readings.pageMiB,
    liveNote: 'The frame’s own memory now, the engine’s workers apart (Chromium only). Cold: after the fling.',
    liveEmpty: 'measuring',
  },
];

/** The chart's rows: input to visible response, cold. */
export const BARS: { metric: string; label: string }[] = [
  { metric: 'key', label: 'Key → new position' },
  { metric: 'track', label: 'Track press → new position' },
  { metric: 'track-real', label: 'Track press → rows real' },
  { metric: 'wheel', label: 'Wheel → new position' },
  { metric: 'wheel-real', label: 'Wheel → rows real' },
];

/** Every budgets.json metric the page shows. */
export const METRICS = [...CARDS, ...BARS].flatMap(({ metric }) => PROFILES.map((profile) => `${metric}-${profile}`));

/** The cold numbers, resolved at build time (`virtual:cold-numbers`). */
export interface ColdNumbers {
  /** Each metric's GPUI and TanStack medians. */
  values: Record<string, [number, number]>;
  /** The results files' dates, runs per median, and machine. */
  dates: string[];
  runs: number[];
  cpus: string[];
}
