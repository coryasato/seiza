// Request bursts: the most requests one visitor sends in any 10 s, the
// window the zone's per-IP rate limit counts in (root docs/private/zone.md;
// one counter for seiza.io and tycho.seiza.io). The limit is set well above
// a person's heaviest use; rerun this before tightening it.
//
// Each scenario is a heavy but human use of the page's release build, in a
// fresh browser (cold cache, Chromium headless=new, 1440×900 at DPR 2,
// unthrottled), driving each side through the contenders' replay hooks
// (`__contender.replay`, what the benchmark will play):
//
// - visit: the tall table's route; GPUI fills, flings top to bottom, jumps
//   to 90%; a flip to TanStack, the same; a flip back (warm), a fling.
// - reloads: the route reloaded 5 times, 1 s apart.
//
// Every request counts, at the server: the page is served through a counting
// proxy (shared-web/perf/serve.ts), since Playwright doesn't see the sync
// XHRs DuckDB-Wasm's worker reads the data with. Production serves every
// file through the Worker, so each of these is a request the limit counts.
// Local reads are faster than production's, so a local burst overstates
// production's: the safe side for a limit. A peak, not a timing, so one run
// per scenario.
//
// Usage: node apps/observatory/perf/burst.ts [--label burst] [--only visit,reloads]
// Run gpui-build, tanstack-build, and build first. Writes
// perf/results/<date>-<label>.json.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Page } from '@playwright/test';
import { machineInfo, option } from '../../../shared-web/perf/protocol.ts';
import { startCountingProxy } from '../../../shared-web/perf/serve.ts';
import { MARKS } from '../contenders/contract.ts';
import { contenderBase, OBSERVATORY } from '../contenders/paths.ts';
import { perfDir, protocolContext, servePage } from './harness.ts';

const WINDOW_MS = 10_000;
const PORT = 4339;
const PROXY_PORT = 4340;
const label = option('label') ?? 'burst';
const only = option('only')?.split(',');
const ROUTE = `${OBSERVATORY}tall-table/`;

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

/** Counts the shown contender's relayed marks, so a wait sees only new ones. */
function markRecorder(): void {
  const recorded: { name: string; source: string }[] = [];
  (globalThis as { __relayed?: typeof recorded }).__relayed = recorded;
  addEventListener('message', (event) => {
    if (event.origin !== location.origin || event.data?.seiza !== 'mark') return;
    const frame = [...document.querySelectorAll('iframe')].find((frame) => frame.contentWindow === event.source);
    recorded.push({ name: event.data.name, source: frame?.src ?? 'unknown' });
  });
}

/** Waits for `side`'s frame to fill, then plays the replay's fling and jump in it. */
async function play(page: Page, side: 'gpui' | 'tanstack', steps: ('fling' | 'jump')[]): Promise<void> {
  const base = contenderBase('tall-table', side);
  await page.waitForFunction(
    ({ base, filled }) => (globalThis as unknown as { __relayed: { name: string; source: string }[] }).__relayed.some((mark) => mark.name === filled && new URL(mark.source).pathname === base),
    { base, filled: MARKS.filled },
    { timeout: 60_000 },
  );
  const frame = page.frames().find((frame) => new URL(frame.url()).pathname === base);
  if (!frame) throw new Error(`no ${side} frame`);
  for (const step of steps)
    await frame.evaluate(
      (step) => {
        const { replay } = (globalThis as unknown as { __contender: { replay: { fling(): Promise<void>; jump(fraction: number): Promise<void> } } }).__contender;
        return step === 'fling' ? replay.fling() : replay.jump(0.9);
      },
      step,
    );
}

async function flip(page: Page, to: 'GPUI' | 'TanStack'): Promise<void> {
  await page.waitForFunction(() => !document.querySelector('[aria-label="Contender"]')?.hasAttribute('data-disabled'), null, { timeout: 60_000 });
  await page.getByRole('button', { name: to }).click();
}

const scenarios: Record<string, (page: Page) => Promise<void>> = {
  visit: async (page) => {
    await play(page, 'gpui', ['fling', 'jump']);
    await flip(page, 'TanStack');
    await play(page, 'tanstack', ['fling', 'jump']);
    // Cleared before the flip: a warm frame can fill before the click returns.
    await page.waitForFunction(() => !document.querySelector('[aria-label="Contender"]')?.hasAttribute('data-disabled'), null, { timeout: 60_000 });
    await page.evaluate(() => ((globalThis as unknown as { __relayed: unknown[] }).__relayed.length = 0));
    await flip(page, 'GPUI');
    await play(page, 'gpui', ['fling']);
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

const server = await servePage(PORT);
const proxy = await startCountingProxy(PROXY_PORT, PORT, 'localhost');
const results: Record<string, { requests: number; data: number; peak10s: number; peakData10s: number }> = {};
try {
  for (const [name, run] of Object.entries(scenarios)) {
    if (only && !only.includes(name)) continue;
    proxy.log.length = 0;
    const browser = await chromium.launch({ channel: 'chromium' });
    try {
      const context = await protocolContext(browser, { init: [markRecorder] });
      const page = await context.newPage();
      await page.goto(`http://localhost:${PROXY_PORT}${ROUTE}`);
      await run(page);
    } finally {
      await browser.close();
    }
    const all = proxy.log.map((entry) => entry.startedAt);
    const data = proxy.log.filter((entry) => entry.path.startsWith(`${OBSERVATORY}data/`)).map((entry) => entry.startedAt);
    results[name] = { requests: all.length, data: data.length, peak10s: peak(all), peakData10s: peak(data) };
    console.log(`${name}: ${results[name].peak10s} requests in the busiest 10 s (${results[name].peakData10s} of them data reads); ${results[name].requests} in all`);
  }
} finally {
  proxy.close();
  await server.close();
}

if (!Object.keys(results).length) throw new Error('no scenario ran');
const date = new Date().toISOString().slice(0, 10);
const out = join(perfDir, 'results', `${date}-${label}.json`);
mkdirSync(join(perfDir, 'results'), { recursive: true });
writeFileSync(out, `${JSON.stringify({ date, label, ...machineInfo(), windowMs: WINDOW_MS, scenarios: results, peak10s: Math.max(...Object.values(results).map((r) => r.peak10s)) }, null, 2)}\n`);
console.log(`wrote ${out}`);
