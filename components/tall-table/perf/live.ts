// `live`'s latency in the bare host: from the feed's invalidation of a
// batch of visible rows to the first frame that draws a re-read of them,
// the table's share of update → pixel (the host's source answers a read as
// soon as it's polled, so its re-reads land in the turn that asks). The host
// marks each batch once it's invalidated, at the time its rows were picked
// (`tall-table:invalidated`, its last generation in a global) and the
// bridge each frame that first draws a re-read page
// (`tall-table:refreshed`, the highest generation drawn); an init script
// logs both marks with their generations. A batch's latency is its mark to
// the first refreshed mark at or past its generation.
//
// The view rests at the top, rows 0..~28, all on page 0, so every refresh
// covers every row the feed changes (checked: a run whose view spans two
// pages fails). Cold, a fresh browser each run, median of `--runs`, at
// `--rate` updates a second, on the host's release build with `live`.
//
// Usage: node components/tall-table/perf/live.ts [--rate 1000] [--runs 10]
//          [--profile reference|throttled] [--seconds 5] [--label <name>]
// --label writes perf/results/<date>-<label>.json. Run
// `just tall-table build live` first.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright';
import { open, waitMark } from '../../../shared-web/perf/harness.ts';
import { PROFILES, localDate, machineInfo, median, option, percentiles, type Profile } from '../../../shared-web/perf/protocol.ts';
import { serveApp } from '../../../shared-web/perf/serve.ts';
import { FILLED_MARK, INVALIDATED_GLOBAL, INVALIDATED_MARK, PORT, REFRESHED_GLOBAL, REFRESHED_MARK, buildName, builtFeatures, hostWebDir, perfDir, shown } from './harness.ts';

const RATE = Number(option('rate') ?? 1000);
const RUNS = Number(option('runs') ?? 10);
const SECONDS = Number(option('seconds') ?? 5);
/** The feed runs this long before the window opens. */
const WARMUP_MS = 1000;
const PAGE_ROWS = 1024;
const profileName = option('profile') ?? 'reference';
const profile = PROFILES.find((candidate) => candidate.name === profileName);
if (!profile) throw new Error(`--profile ${profileName}: not one of ${PROFILES.map((p) => p.name).join(', ')}`);
for (const [name, value] of [['rate', RATE], ['runs', RUNS], ['seconds', SECONDS]] as const) if (!(value > 0)) throw new Error(`--${name} ${option(name)}: not a positive number`);
const features = builtFeatures();
if (!features.includes('live')) throw new Error('needs the host built with live: `just tall-table build live`');

type Entry = [kind: 'invalidated' | 'refreshed', generation: number, at: number];

/** Logs the two marks with the generation their global holds when each is
 *  set (both globals are set before their mark). In the page, before its
 *  scripts, so it names the marks and globals itself: `harness.ts`'s
 *  `INVALIDATED_*` and `REFRESHED_*` (checked below). */
function markLog(): void {
  const names = {
    invalidated: ['tall-table:invalidated', '__tallTableInvalidated'],
    refreshed: ['tall-table:refreshed', '__tallTableRefreshed'],
  } as const;
  const log: [string, number, number][] = [];
  (globalThis as { __liveLog?: unknown }).__liveLog = log;
  const mark = performance.mark.bind(performance);
  performance.mark = ((name: string, options?: PerformanceMarkOptions) => {
    const entry = mark(name, options);
    for (const [kind, [markName, global]] of Object.entries(names)) {
      if (name === markName) log.push([kind, (globalThis as Record<string, unknown>)[global] as number, entry.startTime]);
    }
    return entry;
  }) as typeof performance.mark;
}
const LOGGED = `${INVALIDATED_MARK} ${INVALIDATED_GLOBAL} ${REFRESHED_MARK} ${REFRESHED_GLOBAL}`;
for (const name of LOGGED.split(' ')) if (!markLog.toString().includes(`'${name}'`)) throw new Error(`markLog doesn't name ${name}`);

interface Reading {
  batches: number;
  /** Batches whose refresh landed in the window. */
  matched: number;
  latencyP50Ms: number;
  latencyP95Ms: number;
  latencyMaxMs: number;
  /** Refreshed frames a second, and invalidations a second (each a row, once a batch). */
  refreshedPerS: number;
  invalidationsPerS: number;
}

async function run(url: string, profile: Profile): Promise<{ reading: Reading | null; failures: string[] }> {
  const failures: string[] = [];
  let session: Awaited<ReturnType<typeof open>> | null = null;
  try {
    session = await open(chromium, url, {
      profile,
      params: { shape: 'narrow', live: String(RATE) },
      init: [markLog],
    });
    const { page } = session;
    await waitMark(page, FILLED_MARK);
    const { shown: view } = await shown(page);
    if (Math.floor(view.first / PAGE_ROWS) !== Math.floor((view.end - 1) / PAGE_ROWS)) failures.push(`rows ${view.first}..${view.end} span two pages`);
    await page.waitForTimeout(WARMUP_MS);
    const from = await now(page);
    await page.waitForTimeout(SECONDS * 1000);
    const to = await now(page);
    // Batches in the window, and every refresh to the end of the log.
    const log = await page.evaluate(() => (globalThis as { __liveLog?: Entry[] }).__liveLog ?? []);
    failures.push(...session.problems);
    const batches = log.filter(([kind, , at]) => kind === 'invalidated' && at >= from && at < to);
    const refreshes = log.filter(([kind]) => kind === 'refreshed');
    const latencies: number[] = [];
    for (const [, generation, at] of batches) {
      const refresh = refreshes.find(([, drawn, drawnAt]) => drawn >= generation && drawnAt >= at);
      if (refresh) latencies.push(refresh[2] - at);
    }
    if (!batches.length) failures.push('the feed sent no batch');
    if (latencies.length < batches.length * 0.9) failures.push(`only ${latencies.length} of ${batches.length} batches were drawn`);
    const p = percentiles(latencies);
    const round = (ms: number) => Number(ms.toFixed(2));
    const seconds = (to - from) / 1000;
    const sent = batches.length ? batches.at(-1)![1] - (log.filter(([kind, , at]) => kind === 'invalidated' && at < from).at(-1)?.[1] ?? 0) : 0;
    return {
      reading: {
        batches: batches.length,
        matched: latencies.length,
        latencyP50Ms: round(p.p50),
        latencyP95Ms: round(p.p95),
        latencyMaxMs: round(p.max),
        refreshedPerS: round(refreshes.filter(([, , at]) => at >= from && at < to).length / seconds),
        invalidationsPerS: round(sent / seconds),
      },
      failures,
    };
  } catch (error) {
    failures.push((error as Error).message.split('\n')[0]!);
    return { reading: null, failures };
  } finally {
    await session?.close();
  }
}

const now = (page: Page) => page.evaluate(() => performance.now());

const server = await serveApp(undefined, { webDir: hostWebDir, port: PORT });
const readings: Reading[] = [];
const failures: string[] = [];
console.log(`build: ${buildName(features)}, ${RATE} updates/s, ${profile.name}, ${SECONDS} s a run`);
try {
  for (let index = 0; index < RUNS; index++) {
    const { reading, failures: found } = await run(server.url, profile);
    failures.push(...found.map((failure) => `run ${index + 1}: ${failure}`));
    if (reading) readings.push(reading);
    if (reading) console.log(`${index + 1}/${RUNS}: invalidate → refreshed p50 ${reading.latencyP50Ms} p95 ${reading.latencyP95Ms} max ${reading.latencyMaxMs} ms over ${reading.matched}/${reading.batches} batches; ${reading.refreshedPerS} refreshed frames/s, ${reading.invalidationsPerS} invalidations/s`);
  }
} finally {
  await server.close();
}
const summary = readings.length
  ? Object.fromEntries((Object.keys(readings[0]!) as (keyof Reading)[]).map((key) => [key, Number(median(readings.map((reading) => reading[key])).toFixed(2))]))
  : {};
const spread = readings.length ? (Math.max(...readings.map((r) => r.latencyP50Ms)) - Math.min(...readings.map((r) => r.latencyP50Ms))) / (summary.latencyP50Ms || 1) : 0;
console.log(`median of ${readings.length}: p50 ${summary.latencyP50Ms} ms, p95 ${summary.latencyP95Ms} ms (p50 spread ${(spread * 100).toFixed(1)}%)`);

const label = option('label');
if (label) {
  const date = localDate();
  const out = join(perfDir, 'results', `${date}-${label}.json`);
  mkdirSync(join(perfDir, 'results'), { recursive: true });
  const protocol = { browser: 'chromium headless=new', viewport: '1440x900', dpr: 2, runs: RUNS, cold: true, profile: profile.name, shape: 'narrow', rate: RATE, warmupMs: WARMUP_MS, seconds: SECONDS, build: buildName(features) };
  writeFileSync(out, `${JSON.stringify({ date, label, ...machineInfo(), protocol, runs: readings, summary, p50Spread: Number(spread.toFixed(3)), failures }, null, 2)}\n`);
  console.log(`wrote ${out}`);
}
if (failures.length) {
  console.error(`FAIL\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
