// M3 checks: the asteroid sample over HTTP, on the release build.
//
// 1. /data/* range handling through the Vite preview proxy (worker/scripts/check.ts),
//    so the proxy provably keeps 206s, Content-Range, and no Content-Encoding.
// 2. Warm click, per the measurement protocol (Chromium headless=new, new
//    browser per run, 1440×900 at DPR 2, median of --runs; reference and
//    throttled): wait for "Parquet ready" (engine warm, extension loaded),
//    click "Try sample", and time click → the frame showing the schema
//    (`tycho:sample-shown`, set right after that frame is presented). Also
//    count the bytes of every /data/ request that started between the click
//    and that frame (all of each, even if it finishes later), against the
//    file size. Budgets: ≤ 300 ms (reference), < 2%.
// 3. Click before the engine is ready (Chromium, Firefox, WebKit): click as
//    soon as the button is on screen. The UI must show it's waiting, then
//    the schema, with no errors.
// 4. Failures don't hang (Chromium): with DuckDB's wasm, the Parquet
//    extension, or the data file blocked, the click must end in a visible
//    failure, not a spinner forever. Then, with the extension unblocked, a
//    second click (a retry after registration) must show the schema.
//
// Usage: node apps/tycho/perf/sample.ts [--runs 10] [--label m3-sample] [--reference-only]
// Starts `wrangler dev` (local R2) and `vite preview` on web/dist itself.
// Writes perf/results/<date>-<label>.json and a screenshot of the loaded
// header to perf/results/raw/ (gitignored). Exits non-zero on any failure.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, request as httpRequest } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, firefox, webkit, type BrowserContext, type BrowserType, type Page } from '@playwright/test';
import { preview } from 'vite';
import { checkDataEndpoint } from '../worker/scripts/check.ts';
import { assertPortFree, startWorkerDev, WORKER_DEV_PORT } from '../worker/scripts/dev.ts';
import { PROFILES, flag, hideDevicePixelContentBox, machineInfo, option, summarize, throttle, type Profile } from './common.ts';

const perfDir = dirname(fileURLToPath(import.meta.url));
const webDir = join(perfDir, '../web');
const manifest = JSON.parse(readFileSync(join(perfDir, '../data/MANIFEST.json'), 'utf8')) as Record<string, { bytes: number; sha256: string; fetched: string }>;
const FILE = manifest['asteroids.parquet']!;

const CLICK_BUDGET_MS = 300;
const TRANSFER_BUDGET = 0.02;
const SHOWN_MARK = 'tycho:sample-shown';
const TARGET = 'try-sample-asteroids';

const runs = Number(option('runs') ?? 10);
const label = option('label') ?? 'm3-sample';
const referenceOnly = flag('reference-only');

type OverlayRows = [string, string][];
const overlayValue = (page: Page, row: string) =>
  page.evaluate((row) => (globalThis as { __seizaPerfOverlay?: OverlayRows }).__seizaPerfOverlay?.find(([name]) => name === row)?.[1] ?? null, row);

/** Waits until an overlay row matches `pattern`; returns its value. */
async function waitOverlay(page: Page, row: string, pattern: RegExp, timeout: number): Promise<string> {
  const handle = await page.waitForFunction(
    ({ row, source }) => {
      const value = (globalThis as { __seizaPerfOverlay?: OverlayRows }).__seizaPerfOverlay?.find(([name]) => name === row)?.[1];
      return value !== undefined && new RegExp(source).test(value) ? value : false;
    },
    { row, source: pattern.source },
    { timeout, polling: 20 },
  );
  return (await handle.jsonValue()) as string;
}

/**
 * Clicks the center of a control's published bounds (crate/src/targets.rs),
 * once they're inside the viewport. WebKit's first layout pass runs before the
 * window has its real size and puts the button off-screen (x −91, y 1271 at
 * 1440×900); the next frame corrects it.
 */
async function clickTarget(page: Page, id: string, timeout = 60_000): Promise<void> {
  const handle = await page.waitForFunction(
    (id) => {
      const rect = (globalThis as { __tychoTargets?: Record<string, number[]> }).__tychoTargets?.[id];
      if (!rect) return false;
      const [x = -1, y = -1, width = 0, height = 0] = rect;
      return x >= 0 && y >= 0 && x + width <= innerWidth && y + height <= innerHeight ? rect : false;
    },
    id,
    { timeout, polling: 20 },
  );
  const [x = 0, y = 0, width = 0, height = 0] = (await handle.jsonValue()) as number[];
  await page.mouse.click(x + width / 2, y + height / 2);
}

/**
 * Every /data/ response body, counted at the server: a proxy between Vite's
 * preview proxy and `wrangler dev`. Playwright doesn't report DuckDB's
 * requests (sync XHRs in its worker), so the page can't be the source.
 */
interface DataResponse {
  /** Wall-clock ms when the request arrived, and when its body ended (null
   *  while it's still streaming). `bytes` counts up as the body arrives. */
  startedAt: number;
  endedAt: number | null;
  method: string;
  range: string | null;
  status: number;
  bytes: number;
}
const dataLog: DataResponse[] = [];
async function startCountingProxy(listenPort: number, workerPort: number): Promise<() => void> {
  await assertPortFree(listenPort);
  const server = createServer((req, res) => {
    const entry: DataResponse = { startedAt: Date.now(), endedAt: null, method: req.method ?? '', range: req.headers.range ?? null, status: 0, bytes: 0 };
    dataLog.push(entry);
    const upstream = httpRequest({ host: '127.0.0.1', port: workerPort, path: req.url, method: req.method, headers: req.headers }, (response) => {
      entry.status = response.statusCode ?? 0;
      response.on('data', (chunk: Buffer) => (entry.bytes += chunk.length));
      response.on('end', () => (entry.endedAt = Date.now()));
      res.writeHead(response.statusCode ?? 502, response.headers);
      response.pipe(res);
    });
    upstream.on('error', (error) => res.destroy(error));
    req.pipe(upstream);
  });
  return new Promise((resolve, reject) => {
    server.once('error', (error) => reject(new Error(`counting proxy can't listen on ${listenPort}: ${error.message}`)));
    server.listen(listenPort, '127.0.0.1', () => resolve(() => server.close()));
  });
}

/** Waits (up to `timeout`) for these requests' bodies to finish. */
async function settled(requests: DataResponse[], timeout = 30_000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (requests.some((request) => request.endedAt === null) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

interface Browsing {
  page: Page;
  context: BrowserContext;
  problems: string[];
  close(): Promise<void>;
}

async function open(engine: BrowserType, url: string, profile: Profile | null, block?: RegExp): Promise<Browsing> {
  const browser = await engine.launch(engine === chromium ? { channel: 'chromium' } : {});
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: engine === chromium ? 2 : 1 });
  if (engine === chromium) await context.addInitScript(hideDevicePixelContentBox);
  if (block) await context.route(block, (route) => route.abort());
  const page = await context.newPage();
  const problems: string[] = [];
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    // Chromium follows perf.ts: browser warnings count, GPUI's own [WARN]
    // logs don't. Firefox and WebKit warn about GPU usage and preloads on
    // every load, unrelated to this check; only their errors count.
    const text = message.text();
    const warningCounts = engine === chromium && !text.startsWith('[WARN]');
    if (message.type() === 'error' || (message.type() === 'warning' && warningCounts)) problems.push(text);
  });
  if (profile && engine === chromium) await throttle(context, page, profile);
  const target = new URL(url);
  target.searchParams.set('perf', '');
  await page.goto(target.toString());
  return { page, context, problems, close: () => browser.close() };
}

interface WarmRun {
  /** Playwright's click → the shown mark, on the page's clock. */
  clickToShownMs: number;
  /** The app's own number: its click handler → shown (overlay). */
  overlayMs: number | null;
  dataBytes: number;
  dataRequests: { method: string; range: string | null; status: number; bytes: number }[];
  problems: string[];
}

async function warmRun(url: string, profile: Profile, screenshot: string | null): Promise<WarmRun> {
  const run = await open(chromium, url, profile);
  try {
    const { page } = run;
    // Warm: the engine is open and the Parquet extension is loaded.
    await waitOverlay(page, 'Parquet ready', /ms$/, 180_000);
    const clickedAt = (await page.evaluate(() => performance.now())) as number;
    const clickedWall = Date.now();
    await clickTarget(page, TARGET);
    const shownAt = (await page
      .waitForFunction((mark) => performance.getEntriesByName(mark, 'mark')[0]?.startTime ?? false, SHOWN_MARK, { timeout: 60_000, polling: 10 })
      .then((handle) => handle.jsonValue())) as number;
    const shownWall = Date.now();
    // Every /data/ request that started between the click and the frame,
    // counted in full: a read still streaming when the frame appeared (a
    // whole-file GET, say) must not slip under the budget.
    const requests = dataLog.filter((response) => response.startedAt >= clickedWall && response.startedAt <= shownWall);
    await settled(requests);
    const overlay = await waitOverlay(page, 'Sample → schema', /ms$|failed|—/, 10_000);
    if (screenshot) await page.screenshot({ path: screenshot });
    return {
      clickToShownMs: shownAt - clickedAt,
      overlayMs: /ms$/.test(overlay) ? Number.parseFloat(overlay) : null,
      dataBytes: requests.reduce((sum, response) => sum + response.bytes, 0),
      dataRequests: requests.map(({ method, range, status, bytes }) => ({ method, range, status, bytes })),
      problems: run.problems,
    };
  } finally {
    await run.close();
  }
}

interface EarlyRun {
  browser: string;
  ok: boolean;
  detail: string;
  problems: string[];
}

/** Click the moment the button is on screen, with the engine still loading. */
async function earlyRun(engine: BrowserType, url: string): Promise<EarlyRun> {
  const run = await open(engine, url, null);
  try {
    const { page } = run;
    await clickTarget(page, TARGET);
    const readyAtClick = await page.evaluate(() => performance.getEntriesByName('tycho:engine-ready', 'mark').length > 0);
    // The loading state: the app sets the row to "…" when the click lands.
    const waiting = await waitOverlay(page, 'Sample → schema', /…|ms$|failed/, 10_000).catch(() => null);
    const shown = await page
      .waitForFunction((mark) => performance.getEntriesByName(mark, 'mark')[0]?.startTime ?? false, SHOWN_MARK, { timeout: 120_000, polling: 20 })
      .then((handle) => handle.jsonValue() as Promise<number>)
      .catch(() => null);
    const engineReady = await page.evaluate(() => performance.getEntriesByName('tycho:engine-ready', 'mark')[0]?.startTime ?? null);
    const ok = !readyAtClick && waiting === '…' && shown !== null && run.problems.length === 0;
    const detail = readyAtClick
      ? 'engine was already ready at the click (not an early click)'
      : `clicked while loading (overlay "${waiting}"), engine ready ${engineReady?.toFixed(0) ?? '—'} ms, schema shown ${shown?.toFixed(0) ?? 'never'} ms`;
    return { browser: engine.name(), ok, detail, problems: run.problems };
  } finally {
    await run.close();
  }
}

/**
 * With `block`ed requests, a click must end in a visible failure, not hang.
 * With `retry`, the block is then lifted and a second click must show the
 * schema: the file is registered again, and the engine must still work.
 */
async function failureRun(url: string, name: string, block: RegExp, retry = false): Promise<{ name: string; ok: boolean; detail: string }> {
  const run = await open(chromium, url, null, block);
  try {
    const { page, context } = run;
    await clickTarget(page, TARGET);
    const outcome = await waitOverlay(page, 'Sample → schema', /failed|ms$/, 120_000).catch(() => 'hung (no outcome in 120 s)');
    const engine = await overlayValue(page, 'Engine ready');
    let detail = `sample: ${outcome}; engine: ${engine}`;
    let ok = outcome === 'failed';
    if (retry && ok) {
      await context.unroute(block);
      await clickTarget(page, TARGET);
      // The row still says "failed" from the first click until this one lands.
      const restarted = await waitOverlay(page, 'Sample → schema', /…/, 10_000).then(() => true, () => false);
      const second = restarted
        ? await waitOverlay(page, 'Sample → schema', /ms$|failed/, 60_000).catch(() => 'hung (no outcome in 60 s)')
        : 'the second click never started a load';
      ok = /ms$/.test(second);
      detail += `; retry after unblocking: ${second}`;
    }
    return { name, ok, detail };
  } finally {
    await run.close();
  }
}

// Vite's proxy → the counting proxy (WORKER_DEV_PORT) → wrangler dev.
const WORKER_PORT = 8790;
await assertPortFree(WORKER_DEV_PORT);
const worker = await startWorkerDev({ port: WORKER_PORT, requireObject: 'asteroids.parquet' });
const stopCounting = await startCountingProxy(WORKER_DEV_PORT, WORKER_PORT);
const server = await preview({ root: webDir, preview: { port: 4176, strictPort: true }, logLevel: 'warn' });
const url = 'http://localhost:4176/';
const date = new Date().toISOString().slice(0, 10);
const rawDir = join(perfDir, 'results/raw');
mkdirSync(rawDir, { recursive: true });

const failures: string[] = [];
const warm: Record<string, WarmRun[]> = {};
const early: EarlyRun[] = [];
const failuresRuns: Awaited<ReturnType<typeof failureRun>>[] = [];
try {
  const proxyFailures = await checkDataEndpoint(url.replace(/\/$/, ''), { viaProxy: true });
  console.log(`/data through the preview proxy: ${proxyFailures.length ? 'FAIL' : 'ok'}`);
  failures.push(...proxyFailures.map((failure) => `proxy ${failure}`));

  for (const profile of referenceOnly ? PROFILES.slice(0, 1) : PROFILES) {
    warm[profile.name] = [];
    for (let index = 0; index < runs; index++) {
      const screenshot = profile.name === 'reference' && index === 0 ? join(rawDir, `${date}-${label}-header.png`) : null;
      const run = await warmRun(url, profile, screenshot);
      warm[profile.name]!.push(run);
      console.log(
        `${profile.name.padEnd(9)} click → schema ${run.clickToShownMs.toFixed(1)} ms (app ${run.overlayMs ?? '—'} ms), ` +
          `${run.dataBytes} B in ${run.dataRequests.length} requests (${((run.dataBytes / FILE.bytes) * 100).toFixed(3)}%)` +
          (run.problems.length ? `  PROBLEMS: ${run.problems.join('; ')}` : ''),
      );
      failures.push(...run.problems.map((problem) => `${profile.name} run ${index + 1}: ${problem}`));
    }
  }

  for (const engine of [chromium, firefox, webkit]) {
    const run = await earlyRun(engine, url);
    early.push(run);
    console.log(`early click, ${run.browser.padEnd(8)} ${run.ok ? 'ok' : 'FAIL'}: ${run.detail}${run.problems.length ? `  PROBLEMS: ${run.problems.join('; ')}` : ''}`);
    if (!run.ok) failures.push(`early click (${run.browser}): ${run.detail} ${run.problems.join('; ')}`);
  }

  for (const [name, block, retry] of [
    ['DuckDB wasm blocked', /duckdb-(eh|mvp)-[\w-]+\.wasm$/, false],
    ['Parquet extension blocked, then retried', /parquet\.duckdb_extension\.wasm$/, true],
    ['data file blocked', /\/data\/asteroids\.parquet$/, false],
  ] as const) {
    const run = await failureRun(url, name, block, retry);
    failuresRuns.push(run);
    console.log(`${name}: ${run.ok ? 'ok' : 'FAIL'} (${run.detail})`);
    if (!run.ok) failures.push(`${name}: ${run.detail}`);
  }
} finally {
  await server.close();
  stopCounting();
  await worker.close();
}

const profiles = Object.fromEntries(
  Object.entries(warm).map(([name, list]) => [
    name,
    {
      runs: list.length,
      clickToSchemaMs: summarize(list.map((run) => run.clickToShownMs)),
      appClickToSchemaMs: summarize(list.map((run) => run.overlayMs).filter((ms): ms is number => ms !== null)),
      dataBytes: summarize(list.map((run) => run.dataBytes)),
      dataFraction: summarize(list.map((run) => (run.dataBytes / FILE.bytes) * 100), 3),
    },
  ]),
);
const reference = profiles.reference;
if (reference?.clickToSchemaMs && reference.clickToSchemaMs.median > CLICK_BUDGET_MS) {
  failures.push(`reference click → schema median ${reference.clickToSchemaMs.median} ms, budget ${CLICK_BUDGET_MS} ms`);
}
if (reference?.dataFraction && reference.dataFraction.max >= TRANSFER_BUDGET * 100) {
  failures.push(`transferred up to ${reference.dataFraction.max}% of the file before the schema showed, budget < ${TRANSFER_BUDGET * 100}%`);
}

const summary = {
  date,
  label,
  ...machineInfo(),
  file: { name: 'asteroids.parquet', bytes: FILE.bytes, sha256: FILE.sha256, fetched: FILE.fetched },
  budgets: { clickToSchemaMs: CLICK_BUDGET_MS, transferPercent: TRANSFER_BUDGET * 100 },
  profiles,
  earlyClick: early,
  failureModes: failuresRuns,
  runs: warm,
};
const out = join(perfDir, 'results', `${date}-${label}.json`);
writeFileSync(out, `${JSON.stringify(summary, null, 2)}\n`);
for (const [name, profile] of Object.entries(profiles)) {
  console.log(
    `\n${name} (n=${profile.runs}): click → schema ${JSON.stringify(profile.clickToSchemaMs)} ms, ` +
      `app ${JSON.stringify(profile.appClickToSchemaMs)} ms, transferred ${JSON.stringify(profile.dataFraction)} % of ${FILE.bytes} B`,
  );
}
console.log(`wrote ${out}`);
if (failures.length > 0) {
  console.error(`\nFAIL\n${failures.map((failure) => `  ${failure}`).join('\n')}`);
  process.exit(1);
}
console.log('\nPASS');
