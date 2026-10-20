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
// Run `just observatory gpui-build` and `tanstack-build` first.

import type { Page, Request } from '@playwright/test';
import { memoryOf, type MemoryEntry } from '../metrics/metrics.ts';
import { filledState, medianOf, opened, openSide, runMetric, state, type RunResult, type Session } from './contender.ts';
import { ENGINE_CHUNK } from './harness.ts';

/** The paging's page (the component's `Paging::default()`). */
const PAGE_ROWS = 1024;
/** The walk: its length, and each step, in pages (a step within the even prefetch's reach). */
const WALK_PAGES = 144;
const STEP_PAGES = 4;
/** No data read in flight, and the cache's bytes unchanged, this long. */
const QUIET_MS = 1000;
/** A landing that isn't quiet by then fails the run. */
const QUIET_TIMEOUT_MS = 120_000;
/** The page's memory types the budgets' rows account for: the canvas's
 *  backing store apart, the rest "JavaScript". Any other fails the run. */
const KNOWN_TYPES = new Set(['JavaScript', 'Canvas']);

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

/** Init script: every wasm memory the page instantiates. */
function wasmRecorder(): void {
  const g = globalThis as { __wasmMemories?: WebAssembly.Memory[] };
  g.__wasmMemories = [];
  const keep = (result: WebAssembly.WebAssemblyInstantiatedSource | WebAssembly.Instance) => {
    const instance = 'instance' in result ? result.instance : result;
    for (const value of Object.values(instance.exports)) if (value instanceof WebAssembly.Memory) g.__wasmMemories!.push(value);
    return result;
  };
  const streaming = WebAssembly.instantiateStreaming;
  WebAssembly.instantiateStreaming = (...args) => streaming(...args).then(keep) as never;
  const instantiate = WebAssembly.instantiate;
  WebAssembly.instantiate = ((...args: Parameters<typeof instantiate>) => instantiate(...args).then(keep)) as typeof instantiate;
}

interface Reading {
  /** The page's own (its window), by `types` ("JavaScript", "DOM", …), and its workers'. */
  pageBytes: number;
  pageByType: Record<string, number>;
  workerBytes: number;
  jsHeapBytes: number;
  nodes: number;
  wasmBytes: number;
}

async function reading(page: Page, session: Session): Promise<Reading> {
  const breakdown = await page.evaluate(async () => {
    const result = await (performance as Performance & { measureUserAgentSpecificMemory(): Promise<{ breakdown: MemoryEntry[] }> }).measureUserAgentSpecificMemory();
    return result.breakdown;
  });
  const { pageBytes, workerBytes, pageByType } = memoryOf(breakdown);
  const cdp = await session.context.newCDPSession(page);
  await cdp.send('Performance.enable');
  const { metrics } = await cdp.send('Performance.getMetrics');
  await cdp.detach();
  const metric = (name: string) => metrics.find((entry) => entry.name === name)?.value ?? 0;
  const wasmBytes = await page.evaluate(() => ((globalThis as { __wasmMemories?: WebAssembly.Memory[] }).__wasmMemories ?? []).reduce((sum, memory) => sum + memory.buffer.byteLength, 0));
  return { pageBytes, pageByType, workerBytes, jsHeapBytes: metric('JSHeapUsedSize'), nodes: metric('Nodes'), wasmBytes };
}

/** As measured, then after a forced garbage collection (the page's: the
 *  engine's worker isn't collected, so its reading is the measured one). */
async function both(page: Page, session: Session): Promise<{ measured: Reading; afterGc: Reading }> {
  const measured = await reading(page, session);
  const cdp = await session.context.newCDPSession(page);
  await cdp.send('HeapProfiler.collectGarbage');
  await cdp.detach();
  return { measured, afterGc: await reading(page, session) };
}

/** Until no data read has been in flight, and the cache's bytes unchanged, for `QUIET_MS`. */
async function quiet(page: Page, inFlight: () => number): Promise<number> {
  let bytes = -1;
  let since = Date.now();
  const deadline = since + QUIET_TIMEOUT_MS;
  for (;;) {
    if (Date.now() > deadline) throw new Error(`not quiet within ${QUIET_TIMEOUT_MS / 1000} s: ${inFlight()} data reads in flight`);
    const now = (await state(page))?.cacheBytes ?? -1;
    if (now !== bytes || inFlight() > 0) {
      bytes = now;
      since = Date.now();
    } else if (Date.now() - since >= QUIET_MS) return bytes;
    await page.waitForTimeout(50);
  }
}

interface Run extends RunResult {
  open: { measured: Reading; afterGc: Reading };
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

await runMetric<Run>(
  'memory',
  async ({ side, profile, url }) => {
    const requests: Request[] = [];
    const pending = new Set<Request>();
    let dataReads = 0;
    const session = await openSide(side, url, profile, {
      init: [wasmRecorder],
      // Without it, the measurement waits for a garbage collection (up to 20 s).
      args: ['--enable-blink-features=ForceEagerMeasureMemory'],
      before: async (page) => {
        page.on('request', (request) => {
          if (kindOf(request.url()) !== 'data') return;
          pending.add(request);
          dataReads++;
        });
        page.on('requestfinished', (request) => {
          pending.delete(request);
          // Not a download: a script the page made (the engine's worker, by blob URL).
          if (!request.url().startsWith('blob:')) requests.push(request);
        });
        page.on('requestfailed', (request) => pending.delete(request));
      },
    });
    const { page } = session;
    try {
      const failures = [...session.problems];
      if (!(await page.evaluate(() => crossOriginIsolated))) failures.push("the page isn't cross-origin isolated: no memory measurement");
      const { state: start } = await opened(session);
      const cacheBytesOpen = await quiet(page, () => pending.size);
      const open = await both(page, session);
      const lastPage = Math.ceil(start.rows / PAGE_ROWS) - 1;
      if (lastPage < WALK_PAGES) throw new Error(`the file has ${lastPage + 1} pages, fewer than the walk's ${WALK_PAGES}`);
      const fractions = [];
      for (let walked = lastPage - WALK_PAGES; walked < lastPage; walked += STEP_PAGES) fractions.push((walked * PAGE_ROWS) / start.rows);
      fractions.push(1);
      for (const fraction of fractions) {
        await page.evaluate((fraction) => (globalThis as { __contender?: { replay: { jump(fraction: number): Promise<void> } } }).__contender!.replay.jump(fraction), fraction);
        await filledState(page, 'true', 60_000);
        await quiet(page, () => pending.size);
      }
      const cacheBytesEnd = await quiet(page, () => pending.size);
      const atEnd = await both(page, session);
      for (const taken of [open.measured, open.afterGc, atEnd.measured, atEnd.afterGc])
        for (const type of Object.keys(taken.pageByType)) if (!KNOWN_TYPES.has(type)) failures.push(`page memory of an unaccounted type: ${type}`);
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
      return { open, atEnd, cacheBytesOpen, cacheBytesEnd, dataReads, files, bytes, failures };
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
  { walkPages: WALK_PAGES, stepPages: STEP_PAGES, quietMs: QUIET_MS },
);
