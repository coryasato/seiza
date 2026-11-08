// Memory at equal work, on either bare contender page, cold: the same pages
// read on both devices, so the fast and the slow device's readings can be
// compared (the fling's can't: a throttled fling skips pages, so it reads
// less). The session: the open, then a walk to the file's last row by the
// replay's jump, `STEP_PAGES` pages at a time over its last `WALK_PAGES`
// pages, each landing waited out until no data read is in flight and the
// page cache's bytes have held for `QUIET_MS`. Prefetch leans ahead while the
// rows move and evens out once they rest, and a fast device's lean-ahead
// pages land while a slow one's are cancelled, so scattered jumps read more
// pages on the fast device; on a walk each landing's even prefetch (2 pages
// either side) reaches the next, so every page either device reads is the
// walk's, and nothing lies past the last row. Equal work is checked, not
// assumed: every run of a side must end with the same `state.cacheBytes` (the
// Arrow IPC bytes its cache holds, the 64 MiB budget's unit), on both devices.
//
// On a scenario's level (the wide sheet's file is 11 pages, too few to
// walk), the equal work is the file read whole (`readWhole`), every run's
// cache bytes the same, and then a long sideways session: `SIDEWAYS_TRIPS`
// gesture scrolls across every day and back at the sideways scroll's speed
// (`metric-scroll.ts`'s), which reads nothing, so what grows is the view's
// (GPUI's wasm memory grows to its peak and never shrinks; the DOM's frees
// on a collection). Readings once open, once read, and at the end.
//
// On market watch's level (50 rows, one page), the equal work is the feed's:
// `?ticks=FEED_TICKS` at the stop's rate, every tick folded and its last
// re-read drawn on both devices (`__contender.batches`, `?measure`'s), then
// `FLASH_WAIT_MS` for the last flash to fade. The open's reading comes once
// the table has filled, the feed (which starts there) just under way.
//
// On live tail's level (the table grows from 0 rows while it follows), the
// equal work is the replay's: `?rows=TAIL_ROWS` at the stop's rate, the
// clock stopping there (`contenders/tail/data.ts`'s `limitFrom`), every row
// drawn on both devices (the tail drawn, `__contenderTail`, reaching it),
// then the page cache quiet. The open's reading is at one point on every
// device and side: the clock paused at the open's fill (a pause asked
// before its worker exists holds from its start, at 0 rows), the file
// fetched whole and nothing in flight for `QUIET_MS`; then the clock
// resumes.
//
// Memory once open and at the end, each as measured and again after a
// forced garbage collection (what the page holds, not what it hasn't yet
// collected): `performance.measureUserAgentSpecificMemory`, the page's own
// by type and its workers' (the engine's) apart; Chromium's JS heap and DOM
// nodes; and the wasm's linear memory (every module the page instantiates:
// the GPUI contender's; DuckDB's is its worker's), which a garbage
// collection never shrinks. Also each file's bytes on the wire (body +
// headers, brotli where served so), by path with its content hash dropped.
//
// Usage: node apps/observatory/perf/metric-memory.ts [--side gpui|tanstack]
//          [--runs 10] [--profile reference|throttled] [--label <name>]
//          [--scenario <id> [--stop <id,…>]] (contender.ts)
// Run `just observatory gpui-build` and `tanstack-build` first.

import type { Page, Request } from '@playwright/test';
import { SCROLLS } from '../metrics/metrics.ts';
import { PAGE_ROWS, dataReads, state, fedTicks, fileFacts, filledState, flaggedScenario, gesture, jump, medianOf, opened, openSide, quiet, readWhole, runMetric, wideStop, type RunResult, type Session } from './contender.ts';
import { ENGINE_CHUNK, MARKS } from './harness.ts';
import { wholeFileWatch } from './tail-metric.ts';
import { MEMORY_ARGS, collectGarbage, pageMemory, unknownTypes, wasmRecorder, type PageMemory } from './memory-reading.ts';
import { waitMark } from '../../../shared-web/perf/harness.ts';
import type { RateStop, RowsStop } from '../contenders/scenarios.ts';

/** The walk: its length, and each step, in pages (a step within the even prefetch's reach). */
const WALK_PAGES = 144;
const STEP_PAGES = 4;
/** No data read in flight, and the cache's bytes unchanged, this long. */
const QUIET_MS = 1000;
/** A scenario's sideways session: across every day and back, this many times. */
const SIDEWAYS_TRIPS = 5;
/** Market watch's session: the ticks the feed sends, then ends (20 s at
 *  the default stop's 500 a second). */
const FEED_TICKS = 10_000;
/** Live tail's session: the rows the clock counts, then stops (10 s at the
 *  default stop's 10k a second, ~98 pages). */
const TAIL_ROWS = 100_000;
/** After the last tick is drawn: its flash fades (the scenario's 400 ms). */
const FLASH_WAIT_MS = 1000;

type Kind = 'html' | 'js' | 'wasm' | 'css' | 'font' | 'engine' | 'data' | 'other';
function kindOf(url: string): Kind {
  const path = new URL(url).pathname;
  if (path.startsWith('/observatory/data/')) return 'data';
  if (path.startsWith('/observatory/duckdb/') || ENGINE_CHUNK.test(path)) return 'engine';
  if (path.startsWith('/fonts/')) return 'font';
  if (path.endsWith('/') || path.endsWith('.html')) return 'html';
  if (path.endsWith('.wasm')) return 'wasm';
  if (path.endsWith('.js')) return 'js';
  if (path.endsWith('.css')) return 'css';
  return 'other';
}
/** A file's path without its content hash (`index-AbC123de.js` → `index.js`). */
const fileOf = (url: string) => new URL(url).pathname.replace(/-[\w-]{8}(\.\w+)$/, '$1');

interface Reading extends PageMemory {
  jsHeapBytes: number;
  nodes: number;
}

async function reading(page: Page, session: Session): Promise<Reading> {
  const memory = await pageMemory(page);
  const cdp = await session.context.newCDPSession(page);
  await cdp.send('Performance.enable');
  const { metrics } = await cdp.send('Performance.getMetrics');
  await cdp.detach();
  const metric = (name: string) => metrics.find((entry) => entry.name === name)?.value ?? 0;
  return { ...memory, jsHeapBytes: metric('JSHeapUsedSize'), nodes: metric('Nodes') };
}

/** As measured, then after a forced garbage collection (the page's: the
 *  engine's worker isn't collected, so its reading is the measured one). */
async function both(page: Page, session: Session): Promise<{ measured: Reading; afterGc: Reading }> {
  const measured = await reading(page, session);
  await collectGarbage(session);
  return { measured, afterGc: await reading(page, session) };
}

interface Run extends RunResult {
  open: { measured: Reading; afterGc: Reading };
  /** A scenario's: once the file was read whole, before the sideways session. */
  read?: { measured: Reading; afterGc: Reading };
  atEnd: { measured: Reading; afterGc: Reading };
  /** The cache's Arrow IPC bytes once open and at the end. */
  cacheBytesOpen: number;
  cacheBytesEnd: number;
  dataReads: number;
  /** Bytes on the wire by file, and by kind. */
  files: Record<string, { kind: Kind; bytes: number; encoding: string | null }>;
  bytes: Record<Kind, number>;
}

/** Each side's end-of-session cache bytes, from its first run: every later run, either device, must match. */
const expected = new Map<string, number>();

/** A scenario's file's columns (native DuckDB), for the days' width: read
 *  once, and only on a scenario's level. */
let columns: Promise<number> | undefined;
const fileColumns = (): Promise<number> => (columns ??= fileFacts(flaggedScenario()).then((facts) => facts.columns));

await runMetric<Run>(
  'memory',
  async ({ side, profile, url, picked }) => {
    const requests: Request[] = [];
    const market = picked?.scenario.level === 'market';
    const tail = picked?.scenario.level === 'tail';
    let reads: ReturnType<typeof dataReads> | undefined;
    let whole: ReturnType<typeof wholeFileWatch> | undefined;
    const session = await openSide(side, url, profile, {
      picked,
      params: market ? { ticks: String(FEED_TICKS) } : tail ? { rows: String(TAIL_ROWS) } : {},
      init: [wasmRecorder],
      // Without it, the measurement waits for a garbage collection (up to 20 s).
      args: MEMORY_ARGS,
      before: async (page) => {
        reads = dataReads(page);
        if (tail) whole = wholeFileWatch(page);
        page.on('requestfinished', (request) => {
          // Not a download: a script the page made (the engine's worker, by blob URL).
          if (!request.url().startsWith('blob:')) requests.push(request);
        });
      },
    });
    const { page } = session;
    try {
      const failures = [...session.problems];
      if (!(await page.evaluate(() => crossOriginIsolated))) failures.push("the page isn't cross-origin isolated: no memory measurement");
      // The tail's view never rests at row 0: opened is its first fill (at 0 rows).
      const start = tail ? null : (await opened(session)).state;
      const inFlight = reads!.inFlight;
      if (tail) {
        await waitMark(page, MARKS.filled, await waitMark(page, MARKS.open, 0, 180_000), 180_000);
        await page.evaluate(() => (globalThis as { __contender?: { pause?(on: boolean): void } }).__contender?.pause?.(true));
          const deadline = Date.now() + 180_000;
        while (!whole!.done()) {
          if (Date.now() > deadline) throw new Error('the file was never fetched whole');
          await page.waitForTimeout(50);
        }
        await quiet(page, inFlight, QUIET_MS);
        whole!.request();
      }
      // Market watch's feed starts at the fill: its open reading at once,
      // before the devices' different waits fold different counts of ticks
      // (its one page is read by then).
      const open = market || tail ? await both(page, session) : null;
      // The tail's clock, held for the open's reading, runs to its limit.
      if (tail) await page.evaluate(() => (globalThis as { __contender?: { pause?(on: boolean): void } }).__contender?.pause?.(false));
      const cacheBytesOpen = tail ? ((await state(page))?.cacheBytes ?? 0) : await quiet(page, inFlight, QUIET_MS);
      const openReading = open ?? (await both(page, session));
      const wide = wideStop(picked);
      let read: Run['read'];
      if (wide) {
        await readWhole(session, inFlight);
        read = await both(page, session);
        const days = ((await fileColumns()) - wide.scenario.heatFrom) * wide.stop.columnWidth;
        for (let trip = 0; trip < SIDEWAYS_TRIPS; trip++) {
          await gesture(session, { x: -days, speed: SCROLLS.sideways.speed });
          await gesture(session, { x: days, speed: SCROLLS.sideways.speed });
        }
      } else if (market) {
        // The feed's time at the stop's rate, twice over, and a minute.
        await fedTicks(page, FEED_TICKS, (2 * FEED_TICKS * 1000) / (picked!.stop as RateStop).rate + 60_000);
        await page.waitForTimeout(FLASH_WAIT_MS);
      } else if (tail) {
        // The replay's time at the stop's rate, twice over, and a minute.
        await page.waitForFunction((rows) => ((globalThis as { __contenderTail?: number }).__contenderTail ?? 0) >= rows, TAIL_ROWS, { timeout: (2 * TAIL_ROWS * 1000) / (picked!.stop as RowsStop).rate + 60_000, polling: 50 });
      } else {
        const lastPage = Math.ceil(start!.rows / PAGE_ROWS) - 1;
        if (lastPage < WALK_PAGES) throw new Error(`the file has ${lastPage + 1} pages, fewer than the walk's ${WALK_PAGES}`);
        const fractions = [];
        for (let walked = lastPage - WALK_PAGES; walked < lastPage; walked += STEP_PAGES) fractions.push((walked * PAGE_ROWS) / start!.rows);
        fractions.push(1);
        for (const fraction of fractions) {
          await jump(page, fraction);
          await filledState(page, 'true', 60_000);
          await quiet(page, inFlight, QUIET_MS);
        }
      }
      const cacheBytesEnd = await quiet(page, inFlight, QUIET_MS);
      const atEnd = await both(page, session);
      for (const taken of [openReading.measured, openReading.afterGc, ...(read ? [read.measured, read.afterGc] : []), atEnd.measured, atEnd.afterGc])
        failures.push(...unknownTypes(taken));
      const seen = expected.get(side);
      if (seen === undefined) expected.set(side, cacheBytesEnd);
      else if (seen !== cacheBytesEnd) failures.push(`unequal work: the cache ended at ${cacheBytesEnd} bytes, the side's first run at ${seen}`);
      const files: Run['files'] = {};
      const bytes: Record<Kind, number> = { html: 0, js: 0, wasm: 0, css: 0, font: 0, engine: 0, data: 0, other: 0 };
      for (const request of requests) {
        const sizes = await request.sizes().catch(() => null);
        if (!sizes) continue;
        const kind = kindOf(request.url());
        const size = sizes.responseBodySize + sizes.responseHeadersSize;
        bytes[kind] += size;
        if (kind === 'data') continue;
        const file = (files[fileOf(request.url())] ??= { kind, bytes: 0, encoding: (await request.response())?.headers()['content-encoding'] ?? null });
        file.bytes += size;
      }
      return { open: openReading, ...(read ? { read } : {}), atEnd, cacheBytesOpen, cacheBytesEnd, dataReads: reads!.total(), files, bytes, failures };
    } finally {
      await session.close();
    }
  },
  (runs) => {
    // A value a run lacks (`undefined`) is left out of the median, not counted as 0.
    const mib = (pick: (run: Run) => number | undefined) => medianOf(runs, (run) => {
      const value = pick(run);
      return value === undefined ? undefined : value / 2 ** 20;
    });
    const types = [...new Set(runs.flatMap((run) => Object.keys(run.atEnd.afterGc.pageByType)))];
    const files = [...new Set(runs.flatMap((run) => Object.keys(run.files)))].sort();
    return {
      cacheMiBOpen: mib((run) => run.cacheBytesOpen),
      cacheMiBEnd: mib((run) => run.cacheBytesEnd),
      cacheBytesEndAllEqual: runs.every((run) => run.cacheBytesEnd === runs[0]?.cacheBytesEnd),
      dataReads: medianOf(runs, (run) => run.dataReads, 0),
      pageMiBOpen: mib((run) => run.open.measured.pageBytes),
      pageMiBOpenAfterGc: mib((run) => run.open.afterGc.pageBytes),
      ...(runs[0]?.read
        ? {
            pageMiBRead: mib((run) => run.read?.measured.pageBytes),
            pageMiBReadAfterGc: mib((run) => run.read?.afterGc.pageBytes),
            pageMiBReadAfterGcByType: Object.fromEntries(types.map((type) => [type, mib((run) => run.read?.afterGc.pageByType[type])])),
            wasmMiBRead: mib((run) => run.read?.measured.wasmBytes),
            jsHeapMiBReadAfterGc: mib((run) => run.read?.afterGc.jsHeapBytes),
          }
        : {}),
      pageMiBEnd: mib((run) => run.atEnd.measured.pageBytes),
      pageMiBEndAfterGc: mib((run) => run.atEnd.afterGc.pageBytes),
      pageMiBEndAfterGcByType: Object.fromEntries(types.map((type) => [type, mib((run) => run.atEnd.afterGc.pageByType[type])])),
      wasmMiBOpen: mib((run) => run.open.measured.wasmBytes),
      wasmMiBEnd: mib((run) => run.atEnd.measured.wasmBytes),
      jsHeapMiBEndAfterGc: mib((run) => run.atEnd.afterGc.jsHeapBytes),
      nodesEnd: medianOf(runs, (run) => run.atEnd.afterGc.nodes, 0),
      workerMiBEnd: mib((run) => run.atEnd.measured.workerBytes),
      bytesKiB: Object.fromEntries((['html', 'js', 'wasm', 'css', 'font', 'other', 'engine', 'data'] as Kind[]).map((kind) => [kind, medianOf(runs, (run) => run.bytes[kind] / 1024)])),
      filesKiB: Object.fromEntries(files.map((file) => [file, { kind: runs.find((run) => run.files[file])!.files[file]!.kind, encoding: runs.find((run) => run.files[file])!.files[file]!.encoding, kib: medianOf(runs, (run) => (run.files[file]?.bytes ?? 0) / 1024) }])),
    };
  },
  (picked) => (picked?.scenario.level === 'tail' ? { session: 'the replay to its row limit', tailRows: TAIL_ROWS, quietMs: QUIET_MS } : picked?.scenario.level === 'market' ? { session: 'the feed to its tick limit', feedTicks: FEED_TICKS, flashWaitMs: FLASH_WAIT_MS, quietMs: QUIET_MS } : picked ? { session: 'read whole, then sideways', sidewaysTrips: SIDEWAYS_TRIPS, sidewaysSpeed: SCROLLS.sideways.speed, quietMs: QUIET_MS } : { walkPages: WALK_PAGES, stepPages: STEP_PAGES, quietMs: QUIET_MS }),
  { levels: ['base', 'wide', 'market', 'tail'] },
);
