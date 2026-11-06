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
// - visit: Big file's route; GPUI fills, flings top to bottom, jumps
//   to 90%; a flip to TanStack, the same; a flip back (warm), a fling.
// - reloads: Big file's route reloaded 5 times, 1 s apart.
// - wide: the wide sheet's route; GPUI fills at the default stop, flings,
//   jumps to 90%, then the dial through every other stop (each a new frame),
//   a fling at each; a flip to TanStack (at the stop GPUI ended on), the same
//   from there: each side at every stop.
// - both: Big file's route, GPUI filled and flung, then the wide sheet's
//   (the sidebar's link), the same: both files read inside one window.
// - wide-reloads: the wide sheet's route reloaded 5 times, 1 s apart.
// - market: market watch's route; GPUI fills at the default stop and runs
//   under the feed for 2 s, then the dial through every other stop, the same
//   at each; a flip to TanStack, the same from there: each side at every stop.
// - market-reloads: market watch's route reloaded 5 times, 1 s apart.
//
// Every request counts, at the server: the page is served through a counting
// proxy (shared-web/perf/serve.ts), since Playwright doesn't see the sync
// XHRs DuckDB-Wasm's worker reads the data with. Production serves every
// file through the Worker, so each of these is a request the limit counts.
// Local reads are faster than production's, so a local burst overstates
// production's: the safe side for a limit. A peak, not a timing, so one run
// per scenario.
//
// Usage: node apps/observatory/perf/burst.ts [--label burst] [--only visit,reloads,wide,both,wide-reloads,market,market-reloads]
// Run gpui-build, tanstack-build, and build first. Writes
// perf/results/<date>-<label>.json.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Page } from '@playwright/test';
import { machineInfo, option } from '../../../shared-web/perf/protocol.ts';
import { startCountingProxy } from '../../../shared-web/perf/serve.ts';
import { MARKS } from '../contenders/contract.ts';
import { contenderBase, OBSERVATORY } from '../contenders/paths.ts';
import { BIG_FILE, type Level, MARKET_WATCH, type Scenario, WIDE_SHEET } from '../contenders/scenarios.ts';
import { COMPONENTS, SCENARIO_LINK, scenarioPath } from '../web/src/components.ts';
import { perfDir, protocolContext, servePage } from './harness.ts';

const WINDOW_MS = 10_000;
const PORT = 4339;
const PROXY_PORT = 4340;
const label = option('label') ?? 'burst';
const only = option('only')?.split(',');
const TALL_TABLE = COMPONENTS.find((component) => component.id === 'tall-table')!;
const BIG_ROUTE = scenarioPath(TALL_TABLE, BIG_FILE);
const WIDE_ROUTE = scenarioPath(TALL_TABLE, WIDE_SHEET);
const MARKET_ROUTE = scenarioPath(TALL_TABLE, MARKET_WATCH);
/** How long a market watch frame runs under the feed at each stop. */
const FEED_MS = 2_000;

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
async function play(page: Page, side: 'gpui' | 'tanstack', steps: ('fling' | 'jump')[], level: Level = 'base'): Promise<void> {
  const base = contenderBase('tall-table', side, level);
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

/** Waits for the toggle (and the dial, where there is one) to come back, then forgets the marks so far. */
async function settle(page: Page): Promise<void> {
  await page.waitForFunction(
    () => !document.querySelector('[aria-label="Contender"]')?.hasAttribute('data-disabled') && !document.querySelector('[data-dial] [role="group"]')?.hasAttribute('data-disabled'),
    null,
    { timeout: 60_000 },
  );
  // Cleared before the switch: a warm frame can fill before the click returns.
  await page.evaluate(() => ((globalThis as unknown as { __relayed: unknown[] }).__relayed.length = 0));
}

async function flip(page: Page, to: 'GPUI' | 'TanStack'): Promise<void> {
  await settle(page);
  await page.getByRole('button', { name: to }).click();
}

/**
 * On a scenario's route with a dial: `side` filled at the stop it opens at
 * (the default for the first side; a flip keeps the stop) and used there,
 * then used at each other stop, each a new frame. The wide sheet's use is a
 * fling and a jump, then a fling; market watch's, the feed running a while.
 */
async function dial(page: Page, side: 'gpui' | 'tanstack', scenario: Scenario): Promise<void> {
  const use = async (first: boolean): Promise<void> => {
    if (scenario.level === 'market') {
      await play(page, side, [], 'market');
      await page.waitForTimeout(FEED_MS);
    } else await play(page, side, first ? ['fling', 'jump'] : ['fling'], scenario.level);
  };
  await use(true);
  const shown = await page.locator('[data-dial] [data-stop][aria-pressed="true"]').getAttribute('data-stop');
  if (!shown) throw new Error('no stop pressed on the dial');
  for (const stop of scenario.stops.filter((stop) => stop.id !== shown)) {
    await settle(page);
    await page.locator(`[data-dial] [data-stop="${stop.id}"]`).click();
    await use(false);
  }
}

async function reloads(page: Page): Promise<void> {
  for (let reload = 0; reload < 5; reload++) {
    await page.reload();
    await page.waitForTimeout(1_000);
  }
  await page.waitForTimeout(2_000);
}

const scenarios: Record<string, { route: string; run: (page: Page) => Promise<void> }> = {
  visit: {
    route: BIG_ROUTE,
    run: async (page) => {
      await play(page, 'gpui', ['fling', 'jump']);
      await flip(page, 'TanStack');
      await play(page, 'tanstack', ['fling', 'jump']);
      await flip(page, 'GPUI');
      await play(page, 'gpui', ['fling']);
      await page.waitForTimeout(2_000);
    },
  },
  reloads: { route: BIG_ROUTE, run: reloads },
  wide: {
    route: WIDE_ROUTE,
    run: async (page) => {
      await dial(page, 'gpui', WIDE_SHEET);
      await flip(page, 'TanStack');
      await dial(page, 'tanstack', WIDE_SHEET);
      await page.waitForTimeout(2_000);
    },
  },
  both: {
    route: BIG_ROUTE,
    run: async (page) => {
      await play(page, 'gpui', ['fling']);
      await page.locator(`a[data-sidebar="menu-sub-button"][${SCENARIO_LINK}][href="${WIDE_ROUTE}"]`).click();
      await page.waitForURL((url) => url.pathname === WIDE_ROUTE);
      await play(page, 'gpui', ['fling'], 'wide');
      await page.waitForTimeout(2_000);
    },
  },
  'wide-reloads': { route: WIDE_ROUTE, run: reloads },
  market: {
    route: MARKET_ROUTE,
    run: async (page) => {
      await dial(page, 'gpui', MARKET_WATCH);
      await flip(page, 'TanStack');
      await dial(page, 'tanstack', MARKET_WATCH);
      await page.waitForTimeout(2_000);
    },
  },
  'market-reloads': { route: MARKET_ROUTE, run: reloads },
};

const unknown = only?.filter((name) => !(name in scenarios)) ?? [];
if (unknown.length) throw new Error(`--only ${unknown.join(',')}: the scenarios are ${Object.keys(scenarios).join(', ')}`);

const server = await servePage(PORT);
const proxy = await startCountingProxy(PROXY_PORT, PORT, 'localhost');
const results: Record<string, { requests: number; data: number; peak10s: number; peakData10s: number }> = {};
try {
  for (const [name, { route, run }] of Object.entries(scenarios)) {
    if (only && !only.includes(name)) continue;
    proxy.log.length = 0;
    const browser = await chromium.launch({ channel: 'chromium' });
    try {
      const context = await protocolContext(browser, { init: [markRecorder] });
      const page = await context.newPage();
      await page.goto(`http://localhost:${PROXY_PORT}${route}`);
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
