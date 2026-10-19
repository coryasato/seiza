/**
 * The metrics module (`metrics/metrics.ts`), loaded once after the page's
 * first paint, never in its first-paint JS: the page's readouts compute
 * from it, as the perf scripts do.
 */

type Metrics = typeof import('../../metrics/metrics.ts');

let loading: Promise<Metrics> | null = null;

/** Starts loading it (once); the page calls this after its first paint. */
export const loadMetrics = (): Promise<Metrics> => (loading ??= import('../../metrics/metrics.ts'));
