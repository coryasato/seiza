// The measurement protocol's shared pieces (root CLAUDE.md, "Measurement
// protocol"), used by perf.ts, engine.ts, and sample.ts so they can't drift:
// the throttling profiles, the DPR shim, and how runs are summarized and
// labeled.

import { arch, cpus, release, type } from 'node:os';
import type { BrowserContext, Page } from '@playwright/test';

export function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

export function option(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index > 0 ? process.argv[index + 1] : undefined;
}

/** Chrome DevTools' "Fast 4G" preset (throughput in bytes/s, latency in ms). */
export const FAST_4G = { download: (9_000_000 / 8) * 0.9, upload: (1_500_000 / 8) * 0.9, latency: 60 * 2.75 };

export interface Profile {
  name: 'reference' | 'throttled';
  cpuSlowdown: number;
  network: typeof FAST_4G | null;
}

/** Budgets apply to the reference run; the throttled run is recorded. */
export const PROFILES: Profile[] = [
  { name: 'reference', cpuSlowdown: 1, network: null },
  { name: 'throttled', cpuSlowdown: 4, network: FAST_4G },
];

/**
 * Init script for Chromium at DPR 2. Headless Chromium under
 * `deviceScaleFactor: 2` reports `devicePixelRatio` 2 but a
 * `device-pixel-content-box` in CSS pixels, so GPUI would draw 2× layout into
 * a 1× backing store. Hiding `devicePixelContentBoxSize` sends gpui-pre-web
 * down its Safari path (`contentRect × devicePixelRatio`), which gives a
 * consistent 2× backing store. Real browsers don't need it. See
 * perf/results/2026-09-23-m0.md.
 */
export function hideDevicePixelContentBox(): void {
  delete (ResizeObserverEntry.prototype as { devicePixelContentBoxSize?: unknown }).devicePixelContentBoxSize;
}

/** Applies a profile's CPU and network throttling to a Chromium page. */
export async function throttle(context: BrowserContext, page: Page, profile: Profile): Promise<void> {
  if (profile.cpuSlowdown <= 1 && !profile.network) return;
  const cdp = await context.newCDPSession(page);
  if (profile.cpuSlowdown > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: profile.cpuSlowdown });
  if (profile.network) {
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: profile.network.latency,
      downloadThroughput: profile.network.download,
      uploadThroughput: profile.network.upload,
    });
  }
}

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Median, min, and max, rounded to `digits`; null for no values. */
export function summarize(values: number[], digits = 1): { median: number; min: number; max: number } | null {
  if (values.length === 0) return null;
  const round = (value: number) => Number(value.toFixed(digits));
  return { median: round(median(values)), min: round(Math.min(...values)), max: round(Math.max(...values)) };
}

/**
 * What results record about the machine. A label, not the hostname: results
 * are committed to a public repo. Set SEIZA_MACHINE to tell machines apart
 * (e.g. "ci-m1"); the CPU model is recorded separately.
 */
export function machineInfo(): { machine: string; cpu: string; os: string } {
  return { machine: process.env.SEIZA_MACHINE ?? 'local', cpu: cpus()[0]?.model ?? 'unknown', os: `${type()} ${release()} ${arch()}` };
}
