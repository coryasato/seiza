// Smoke check: the shell paints in Chromium, Firefox, and WebKit with no
// console errors, the page is cross-origin isolated, and every resize ends
// with a canvas that followed the new viewport (CSS box and backing store)
// and is painted edge to edge. Each first frame's time is printed, stored
// nowhere, and judged against nothing.
//
// Rule 2 (root CLAUDE.md), in Chromium on a release build: no request
// outside the first-paint set (the document, the entry JS, the app wasm, the
// UI font) starts before `gpui:first-frame`. The page's own requests come
// from Resource Timing, on the marks' clock; its workers' (DuckDB's wasm)
// from Playwright's network events. On the dev server, whose module graph
// isn't the build's, this part is skipped and says so. --control starts a
// request as the page loads (an init script's fetch): Chromium must fail,
// and on that request alone (its 404's console error and every other check
// don't count), so the control shows the early-request check catching it.
// Usage: node apps/tycho/perf/smoke.ts [url] [--out <dir>] [--control]

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, firefox, webkit, type BrowserType, type LaunchOptions, type Page, type Request } from '@playwright/test';

const FIRST_FRAME_MARK = 'gpui:first-frame';
/** What first paint may wait on in the release build, by path. */
const FIRST_PAINT_REQUESTS = [/^\/$/, /^\/index\.html$/, /^\/assets\/index-[\w-]+\.js$/, /^\/assets\/tycho_bg-[\w-]+\.wasm$/, /^\/assets\/IBMPlexSans-Regular-[\w-]+\.ttf$/];
/** How long after the first frame to keep listening, so a request that
 *  started before it but was reported late is still seen. */
const SETTLE_MS = 1000;
const url = process.argv.find((arg) => /^https?:/.test(arg)) ?? 'http://localhost:5173/';
const outIndex = process.argv.indexOf('--out');
const outDir = outIndex > 0 ? process.argv[outIndex + 1] : undefined;
if (outDir) mkdirSync(outDir, { recursive: true });
const control = process.argv.includes('--control');
/** The control's request: no such file, so its 404 logs a console error,
 *  which `--control` leaves out of the verdict. */
const CONTROL_PATH = '/assets/engine-control.js';

const RESIZES = [
  { width: 1440, height: 900 },
  { width: 1024, height: 700 },
  { width: 640, height: 480 },
  { width: 1600, height: 1000 },
  { width: 1440, height: 900 },
];

interface Result {
  browser: string;
  firstFrameMs: number | null;
  crossOriginIsolated: boolean;
  consoleErrors: string[];
  blankFrames: string[];
  sizeMismatches: string[];
  dpr: number | null;
  backingRatio: number | null;
  /** Chromium on a release build: requests outside the first-paint set that
   *  started before the first frame. Null where it wasn't checked. */
  earlyRequests: string[] | null;
  error?: string;
}

interface CanvasSize {
  cssWidth: number;
  cssHeight: number;
  width: number;
  height: number;
}

async function canvasSize(page: Page): Promise<CanvasSize | null> {
  return page.evaluate(() => {
    const element = document.querySelector('canvas');
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return { cssWidth: rect.width, cssHeight: rect.height, width: element.width, height: element.height };
  });
}

/** Whether the canvas followed a resize: its CSS box fills the new viewport,
 *  and its backing store kept the same backing/CSS ratio it had at first
 *  paint. A canvas that failed to shrink or grow, or kept a stale backing
 *  image, fails here even when the screenshot looks painted. The ratio is
 *  compared to itself rather than to devicePixelRatio, because DPR emulation
 *  isn't consistent across engines (see ENGINES). */
function followsResize(canvas: CanvasSize | null, size: { width: number; height: number }, ratio: number): string | null {
  if (!canvas) return 'no canvas';
  const expected = { width: Math.round(size.width * ratio), height: Math.round(size.height * ratio) };
  const ok =
    Math.abs(canvas.cssWidth - size.width) <= 1 &&
    Math.abs(canvas.cssHeight - size.height) <= 1 &&
    Math.abs(canvas.width - expected.width) <= Math.ceil(ratio) &&
    Math.abs(canvas.height - expected.height) <= Math.ceil(ratio);
  return ok
    ? null
    : `css ${canvas.cssWidth}x${canvas.cssHeight}, backing ${canvas.width}x${canvas.height}, expected backing ${expected.width}x${expected.height}`;
}

/** Decodes a PNG in the page and reports whether the title bar row at the
 *  far right edge was drawn. A blank frame leaves that edge as bare page
 *  background. */
async function isPainted(page: Page, png: Buffer): Promise<boolean> {
  return page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = new OffscreenCanvas(image.width, image.height);
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);
    // The title bar's bottom border spans the full width. Scan a column at the
    // far right edge for any pixel that differs from the one in the corner.
    const column = context.getImageData(image.width - 4, 0, 1, Math.min(image.height, 120)).data;
    const [r, g, b] = [column[0], column[1], column[2]];
    for (let i = 4; i < column.length; i += 4) {
      if (Math.abs(column[i]! - r!) + Math.abs(column[i + 1]! - g!) + Math.abs(column[i + 2]! - b!) > 6) {
        return true;
      }
    }
    return false;
  }, png.toString('base64'));
}

/**
 * Each engine runs where its devicePixelRatio and the canvas's
 * device-pixel-content-box agree, since gpui-pre-web sizes the backing store
 * from the latter:
 * - Chromium at DPR 1. Under DPR-2 emulation (old and new headless), the
 *   device-pixel-content-box reports CSS pixels, so GPUI draws 2× layout into
 *   a 1× backing store. `--force-device-scale-factor=2` flips it the other way
 *   (DPR reads 1, the box reads 2×). Measurements get a real DPR 2 by hiding
 *   `devicePixelContentBoxSize` (`shared-web/perf/`); smoke keeps Chromium on
 *   the unshimmed path, so it checks the code path real Chrome uses.
 * - Firefox at DPR 2 through `layout.css.devPixelsPerPx`. Playwright's
 *   `deviceScaleFactor` isn't reliably honored there.
 * - WebKit at DPR 2 through `deviceScaleFactor`, which it honors.
 */
const firstPaintRequest = (url: string) => FIRST_PAINT_REQUESTS.some((pattern) => pattern.test(new URL(url).pathname));

/** Requests outside the first-paint set that started before the first frame,
 *  or null on a page that isn't a release build (no hashed entry script). */
async function earlyRequests(page: Page, network: Map<Request, { url: string; wallMs: number }>, firstFrameMs: number): Promise<string[] | null> {
  await page.waitForTimeout(SETTLE_MS);
  const { timeOrigin, resources } = await page.evaluate(() => ({
    timeOrigin: performance.timeOrigin,
    resources: performance.getEntriesByType('resource').map((entry) => ({ url: entry.name, startMs: entry.startTime })),
  }));
  if (!resources.some((r) => /\/assets\/index-[\w-]+\.js$/.test(new URL(r.url).pathname))) return null;
  const requests = [
    ...resources,
    ...[...network.values()].filter((r) => !resources.some((resource) => resource.url === r.url)).map((r) => ({ url: r.url, startMs: r.wallMs - timeOrigin })),
  ];
  return requests
    .filter((r) => !/^(data|blob):/.test(r.url) && !firstPaintRequest(r.url) && r.startMs < firstFrameMs)
    .map((r) => `${new URL(r.url).pathname} at ${r.startMs.toFixed(1)} ms (first frame ${firstFrameMs.toFixed(1)} ms)`);
}

const ENGINES: { name: string; type: BrowserType; launch: LaunchOptions; deviceScaleFactor: number }[] = [
  { name: 'chromium', type: chromium, launch: {}, deviceScaleFactor: 1 },
  { name: 'firefox', type: firefox, launch: { firefoxUserPrefs: { 'layout.css.devPixelsPerPx': '2' } }, deviceScaleFactor: 1 },
  { name: 'webkit', type: webkit, launch: {}, deviceScaleFactor: 2 },
];

async function run({ name, type, launch, deviceScaleFactor }: (typeof ENGINES)[number]): Promise<Result> {
  const result: Result = {
    browser: name,
    firstFrameMs: null,
    crossOriginIsolated: false,
    consoleErrors: [],
    blankFrames: [],
    sizeMismatches: [],
    dpr: null,
    backingRatio: null,
    earlyRequests: null,
  };
  const browser = await type.launch(launch);
  try {
    const context = await browser.newContext({ viewport: RESIZES[0], deviceScaleFactor });
    if (control) await context.addInitScript((path) => void fetch(path).catch(() => {}), CONTROL_PATH);
    const page = await context.newPage();
    page.on('console', (message) => {
      if (message.type() === 'error') result.consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => result.consoleErrors.push(`pageerror: ${error.message}`));
    // Every request Playwright saw, workers' included, with a wall-clock start:
    // when Playwright reported it (a few ms late at most), then the browser's
    // own start once it finishes.
    const network = new Map<Request, { url: string; wallMs: number }>();
    page.on('request', (request) => network.set(request, { url: request.url(), wallMs: Date.now() }));
    page.on('requestfinished', (request) => {
      const entry = network.get(request);
      const start = request.timing().startTime;
      if (entry && start > 0) entry.wallMs = start;
    });

    await page.goto(url);
    result.firstFrameMs = await page
      .waitForFunction(
        (mark) => performance.getEntriesByName(mark, 'mark')[0]?.startTime ?? false,
        FIRST_FRAME_MARK,
        { timeout: 120_000, polling: 50 },
      )
      .then((handle) => handle.jsonValue() as Promise<number>)
      .catch(() => null);
    if (name === 'chromium' && result.firstFrameMs !== null) result.earlyRequests = await earlyRequests(page, network, result.firstFrameMs);
    result.crossOriginIsolated = await page.evaluate(() => self.crossOriginIsolated);
    result.dpr = await page.evaluate(() => devicePixelRatio);

    const initial = await canvasSize(page);
    const ratio = initial && initial.cssWidth > 0 ? initial.width / initial.cssWidth : 1;
    result.backingRatio = ratio;
    for (const size of RESIZES) {
      await page.setViewportSize(size);
      const png = await page.screenshot();
      const label = `${size.width}x${size.height}`;
      if (outDir) writeFileSync(join(outDir, `${name}-${label}.png`), png);
      if (!(await isPainted(page, png))) result.blankFrames.push(label);
      const mismatch = followsResize(await canvasSize(page), size, ratio);
      if (mismatch) result.sizeMismatches.push(`${label}: ${mismatch}`);
    }
  } catch (error) {
    result.error = error instanceof Error ? error.message.split('\n')[0] : String(error);
  } finally {
    await browser.close();
  }
  return result;
}

const results: Result[] = [];
for (const engine of ENGINES) {
  results.push(await run(engine));
}

let failed = false;
for (const r of results) {
  // --control: a run fails only where the early-request check caught the
  // control's request (Chromium); a browser that doesn't run it passes.
  const caught = (r.earlyRequests ?? []).some((request) => request.startsWith(`${CONTROL_PATH} `));
  const ok = control
    ? !caught
    : !r.error &&
      r.firstFrameMs !== null &&
      r.crossOriginIsolated &&
      r.consoleErrors.length === 0 &&
      r.blankFrames.length === 0 &&
      r.sizeMismatches.length === 0 &&
      (r.earlyRequests ?? []).length === 0;
  failed ||= !ok;
  console.log(
    `${ok ? 'PASS' : 'FAIL'} ${r.browser.padEnd(8)} dpr=${r.dpr} backing=${r.backingRatio}x first-frame=${r.firstFrameMs?.toFixed(0) ?? '—'}ms ` +
      `crossOriginIsolated=${r.crossOriginIsolated} consoleErrors=${r.consoleErrors.length} ` +
      `blankFrames=${r.blankFrames.length} sizeMismatches=${r.sizeMismatches.length}` +
      (r.browser === 'chromium' ? ` requestsBeforeFirstFrame=${r.earlyRequests === null ? 'skipped (not a release build)' : r.earlyRequests.length}` : '') +
      (control && r.browser === 'chromium' ? ` control=${caught ? 'caught' : 'missed'}` : ''),
  );
  if (r.error) console.log(`    error: ${r.error}`);
  for (const error of r.consoleErrors) console.log(`    console: ${error}`);
  for (const size of r.blankFrames) console.log(`    blank frame at ${size}`);
  for (const mismatch of r.sizeMismatches) console.log(`    canvas size mismatch at ${mismatch}`);
  for (const request of r.earlyRequests ?? []) console.log(`    request before the first frame: ${request}`);
}
process.exit(failed ? 1 : 0);
