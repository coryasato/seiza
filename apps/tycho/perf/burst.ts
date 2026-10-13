// Request bursts: the most requests a real visitor sends in any 10 s, the
// window the WAF's per-IP rate limit counts in (docs/hosting.md, "Abuse
// guards"). The limit is set well above this; rerun before tightening it.
//
// Each scenario is a heavy but human use of the release build, in a fresh
// browser (cold cache, Chromium headless=new, 1440×900 at DPR 2, unthrottled):
//
// - visit: load, open the asteroids, fling to the bottom, End, Home. (The
//   sample buttons show only with no file open, so Gaia gets its own runs.)
// - jumps: Gaia, then 20 jumps to random rows, one every ~0.5 s, never
//   waiting for rows.
// - pagedown: Gaia, then PageDown held for 10 s (a key repeat every 33 ms).
// - reloads: the page reloaded 5 times, 1 s apart.
//
// Every request the Worker would run counts: /data/* at the server (the
// counting proxy: Playwright doesn't see DuckDB's sync XHRs), the rest (page,
// assets, extensions) from the browser. Local reads are faster than R2's
// 55–125 ms, so a local burst overstates production's: the safe side for a
// limit. A peak, not a timing, so one run per scenario.
//
// Usage: node apps/tycho/perf/burst.ts [--label burst] [--only visit,jumps,pagedown,reloads]
// Run `just tycho build` and `just tycho data gaia` first. Writes
// perf/results/<date>-<label>.json.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from '@playwright/test';
import { hideDevicePixelContentBox, machineInfo, option } from '../../../shared-web/perf/protocol.ts';
import { clickTarget, fling, waitMark, waitOverlay } from '../../../shared-web/perf/harness.ts';
import { type DataResponse } from '../../../shared-web/perf/serve.ts';
import { serveTycho } from './harness.ts';

const perfDir = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(join(perfDir, '../data/MANIFEST.json'), 'utf8')) as Record<string, { rows: number }>;
const ROWS = { asteroids: manifest['asteroids.parquet']!.rows, gaia: manifest['gaia-dr3-bright.parquet']!.rows };
const WINDOW_MS = 10_000;
const label = option('label') ?? 'burst';
const only = option('only')?.split(',');

/** The most of `times` (ms) inside any `WINDOW_MS`. */
function peak(times: number[]): number {
  const sorted = [...times].sort((a, b) => a - b);
  let best = 0;
  for (let end = 0, start = 0; end < sorted.length; end++) {
    while (sorted[end]! - sorted[start]! >= WINDOW_MS) start++;
    best = Math.max(best, end - start + 1);
  }
  return best;
}

async function openSample(page: Page, target: 'try-sample-asteroids' | 'try-sample-gaia'): Promise<void> {
  const at = await page.evaluate(() => performance.now());
  await clickTarget(page, target);
  await waitMark(page, 'tycho:first-rows', at, 60_000);
}

const scenarios: Record<string, (page: Page) => Promise<void>> = {
  visit: async (page) => {
    await openSample(page, 'try-sample-asteroids');
    await page.keyboard.press('Home');
    await fling(page, ROWS.asteroids);
    await page.keyboard.press('End');
    await page.waitForTimeout(1_000);
    await page.keyboard.press('Home');
    await page.waitForTimeout(2_000);
  },
  jumps: async (page) => {
    await openSample(page, 'try-sample-gaia');
    for (let jump = 0; jump < 20; jump++) {
      await page.keyboard.press('Control+G');
      await page.keyboard.press('Backspace');
      await page.keyboard.type(String(1 + Math.floor(Math.random() * ROWS.gaia)));
      await page.keyboard.press('Enter');
      await page.waitForTimeout(500);
    }
    await page.waitForTimeout(2_000);
  },
  pagedown: async (page) => {
    await openSample(page, 'try-sample-gaia');
    const until = Date.now() + 10_000;
    while (Date.now() < until) {
      await page.keyboard.press('PageDown');
      await page.waitForTimeout(33);
    }
    await page.waitForTimeout(2_000);
  },
  reloads: async (page) => {
    for (let reload = 0; reload < 5; reload++) {
      await page.reload();
      await page.waitForTimeout(1_000);
    }
    await page.waitForTimeout(2_000);
  },
};

const unknown = only?.filter((name) => !(name in scenarios)) ?? [];
if (unknown.length) throw new Error(`--only ${unknown.join(',')}: the scenarios are ${Object.keys(scenarios).join(', ')}`);

const app = await serveTycho(undefined, 4186, { port: 8796, requireObject: 'gaia-dr3-bright.parquet' });
const results: Record<string, { requests: number; data: number; build: number; peak10s: number; peakData10s: number }> = {};
try {
  for (const [name, run] of Object.entries(scenarios)) {
    if (only && !only.includes(name)) continue;
    const proxy = app.proxy!;
    proxy.log.length = 0;
    const build: number[] = [];
    // `open` would navigate before a listener could see the page's requests.
    const browser = await chromium.launch({ channel: 'chromium' });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
    await context.addInitScript(hideDevicePixelContentBox);
    context.on('request', (request) => {
      // DuckDB's worker fetches its wasm and extension; Chromium reports those here too.
      if (request.url().startsWith(app.url) && !new URL(request.url()).pathname.startsWith('/data/')) build.push(Date.now());
    });
    const page = await context.newPage();
    await page.goto(`${app.url}?perf&bench`);
    try {
      await waitOverlay(page, 'Parquet ready', /ms$/, 180_000);
      await run(page);
    } finally {
      await browser.close();
    }
    const data = proxy.log.map((entry: DataResponse) => entry.startedAt);
    results[name] = { requests: data.length + build.length, data: data.length, build: build.length, peak10s: peak([...data, ...build]), peakData10s: peak(data) };
    console.log(`${name}: ${results[name].peak10s} requests in the busiest 10 s (${results[name].peakData10s} of them /data/*); ${results[name].requests} in all`);
  }
} finally {
  await app.close();
}

if (!Object.keys(results).length) throw new Error('no scenario ran');
const out = join(perfDir, 'results', `${new Date().toISOString().slice(0, 10)}-${label}.json`);
writeFileSync(out, `${JSON.stringify({ date: new Date().toISOString(), ...machineInfo(), windowMs: WINDOW_MS, scenarios: results, peak10s: Math.max(...Object.values(results).map((r) => r.peak10s)) }, null, 2)}\n`);
console.log(`wrote ${out}`);
