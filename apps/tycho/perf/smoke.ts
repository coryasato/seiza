// M0 smoke check: the shell paints in Chromium, Firefox, and WebKit with no
// console errors, the page is cross-origin isolated, and every resize ends
// with a canvas that followed the new viewport (CSS box and backing store)
// and is painted edge to edge.
// Usage: node apps/tycho/perf/smoke.ts [url] [--out <dir>]

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, firefox, webkit, type BrowserType, type LaunchOptions, type Page } from '@playwright/test';

const FIRST_FRAME_MARK = 'gpui:first-frame';
const url = process.argv.find((arg) => /^https?:/.test(arg)) ?? 'http://localhost:5173/';
const outIndex = process.argv.indexOf('--out');
const outDir = outIndex > 0 ? process.argv[outIndex + 1] : undefined;
if (outDir) mkdirSync(outDir, { recursive: true });

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
 *   (DPR reads 1, the box reads 2×). The perf suite (perf.ts) gets a real DPR 2
 *   by hiding `devicePixelContentBoxSize`; smoke keeps Chromium on the
 *   unshimmed path, so it still checks the code path real Chrome uses.
 * - Firefox at DPR 2 through `layout.css.devPixelsPerPx`. Playwright's
 *   `deviceScaleFactor` isn't reliably honored there.
 * - WebKit at DPR 2 through `deviceScaleFactor`, which it honors.
 */
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
  };
  const browser = await type.launch(launch);
  try {
    const context = await browser.newContext({ viewport: RESIZES[0], deviceScaleFactor });
    const page = await context.newPage();
    page.on('console', (message) => {
      if (message.type() === 'error') result.consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => result.consoleErrors.push(`pageerror: ${error.message}`));

    await page.goto(url);
    result.firstFrameMs = await page
      .waitForFunction(
        (mark) => performance.getEntriesByName(mark, 'mark')[0]?.startTime ?? false,
        FIRST_FRAME_MARK,
        { timeout: 120_000, polling: 50 },
      )
      .then((handle) => handle.jsonValue() as Promise<number>)
      .catch(() => null);
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
  const ok =
    !r.error &&
    r.firstFrameMs !== null &&
    r.crossOriginIsolated &&
    r.consoleErrors.length === 0 &&
    r.blankFrames.length === 0 &&
    r.sizeMismatches.length === 0;
  failed ||= !ok;
  console.log(
    `${ok ? 'PASS' : 'FAIL'} ${r.browser.padEnd(8)} dpr=${r.dpr} backing=${r.backingRatio}x first-frame=${r.firstFrameMs?.toFixed(0) ?? '—'}ms ` +
      `crossOriginIsolated=${r.crossOriginIsolated} consoleErrors=${r.consoleErrors.length} ` +
      `blankFrames=${r.blankFrames.length} sizeMismatches=${r.sizeMismatches.length}`,
  );
  if (r.error) console.log(`    error: ${r.error}`);
  for (const error of r.consoleErrors) console.log(`    console: ${error}`);
  for (const size of r.blankFrames) console.log(`    blank frame at ${size}`);
  for (const mismatch of r.sizeMismatches) console.log(`    canvas size mismatch at ${mismatch}`);
}
process.exit(failed ? 1 : 0);
