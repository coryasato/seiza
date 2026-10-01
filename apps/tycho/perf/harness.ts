// Playwright helpers for the scripts that drive the app (sample.ts, paging.ts,
// table.ts, drop.ts, csv.ts): opening a page per the protocol, reading the
// perf overlay, clicking canvas controls, dropping files, recording frames,
// and counting /data/ bytes at the server.

import { createServer, request as httpRequest } from 'node:http';
import { chromium, type BrowserContext, type BrowserType, type Page } from '@playwright/test';
import { assertPortFree } from '../worker/scripts/dev.ts';
import { hideDevicePixelContentBox, throttle, type Profile } from './common.ts';

type OverlayRows = [string, string][];

/** An overlay row's current value, or null while hidden or unset. */
export const overlayValue = (page: Page, row: string) =>
  page.evaluate((row) => (globalThis as { __seizaPerfOverlay?: OverlayRows }).__seizaPerfOverlay?.find(([name]) => name === row)?.[1] ?? null, row);

/** Waits until an overlay row matches `pattern`; returns its value. */
export async function waitOverlay(page: Page, row: string, pattern: RegExp, timeout: number): Promise<string> {
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

/** A control's published bounds (crate/src/targets.rs), once they're inside
 *  the viewport: `[x, y, width, height]` in CSS pixels. */
export async function targetRect(page: Page, id: string, timeout = 60_000): Promise<[number, number, number, number]> {
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
  return (await handle.jsonValue()) as [number, number, number, number];
}

/**
 * Clicks the center of a control's published bounds. WebKit's first layout
 * pass runs before the window has its real size and puts controls off-screen
 * (x −91, y 1271 at 1440×900); `targetRect` waits for the next frame's.
 */
export async function clickTarget(page: Page, id: string, timeout = 60_000): Promise<void> {
  const [x, y, width, height] = await targetRect(page, id, timeout);
  await page.mouse.click(x + width / 2, y + height / 2);
}

/**
 * Sends a wheel event that arrives with this `deltaY` (and `deltaX`) in CSS
 * pixels. Under Playwright's `deviceScaleFactor` emulation, Chromium divides
 * synthetic wheel deltas by the scale: at DPR 2, `mouse.wheel(0, 1000)`
 * arrives as `deltaY` 500 (checked 2026-09-25, M4). The reference run is at
 * DPR 2, so every scripted scroll goes through this.
 */
export async function wheel(page: Page, deltaY: number, deltaX = 0): Promise<void> {
  const scale = await deviceScale(page);
  await page.mouse.wheel(deltaX * scale, deltaY * scale);
}

const scales = new WeakMap<Page, number>();
async function deviceScale(page: Page): Promise<number> {
  let scale = scales.get(page);
  if (scale === undefined) {
    scale = (await page.evaluate(() => devicePixelRatio)) as number;
    scales.set(page, scale);
  }
  return scale;
}

/** The first `performance.mark` named `mark` at or after `since` (page
 *  clock), once it exists. */
export async function waitMark(page: Page, mark: string, since = 0, timeout = 60_000): Promise<number> {
  const handle = await page.waitForFunction(
    ({ mark, since }) => performance.getEntriesByName(mark, 'mark').find((entry) => entry.startTime >= since)?.startTime ?? false,
    { mark, since },
    { timeout, polling: 10 },
  );
  return (await handle.jsonValue()) as number;
}

/**
 * One /data/ response, counted at the server: a proxy between Vite's preview
 * proxy and `wrangler dev`. Playwright doesn't report DuckDB's requests (sync
 * XHRs in its worker), so the page can't be the source.
 */
export interface DataResponse {
  /** Wall-clock ms when the request arrived, and when its body ended (null
   *  while it's still streaming). `bytes` counts up as the body arrives. */
  startedAt: number;
  endedAt: number | null;
  method: string;
  path: string;
  range: string | null;
  status: number;
  bytes: number;
}

export interface CountingProxy {
  log: DataResponse[];
  close(): void;
}

export async function startCountingProxy(listenPort: number, workerPort: number): Promise<CountingProxy> {
  await assertPortFree(listenPort);
  const log: DataResponse[] = [];
  const server = createServer((req, res) => {
    const entry: DataResponse = { startedAt: Date.now(), endedAt: null, method: req.method ?? '', path: req.url ?? '', range: req.headers.range ?? null, status: 0, bytes: 0 };
    log.push(entry);
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
    server.listen(listenPort, '127.0.0.1', () => resolve({ log, close: () => server.close() }));
  });
}

/** Waits (up to `timeout`) for these requests' bodies to finish. */
export async function settled(requests: DataResponse[], timeout = 30_000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (requests.some((request) => request.endedAt === null) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

export interface Browsing {
  page: Page;
  context: BrowserContext;
  problems: string[];
  close(): Promise<void>;
}

/**
 * Opens `url` with `?perf` (plus `params`) in a new browser: Chromium
 * headless=new at 1440×900, DPR 2 (with the DPR shim); other engines at DPR 1.
 * `block`ed requests are aborted. Page errors, console errors, and (Chromium)
 * browser warnings are collected in `problems`; GPUI's own `[WARN]` logs
 * aren't, and Firefox and WebKit warn about GPU usage and preloads on every
 * load, so only their errors count.
 */
export async function open(
  engine: BrowserType,
  url: string,
  options: { profile?: Profile | null; block?: RegExp; params?: Record<string, string> } = {},
): Promise<Browsing> {
  const browser = await engine.launch(engine === chromium ? { channel: 'chromium' } : {});
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: engine === chromium ? 2 : 1 });
  if (engine === chromium) await context.addInitScript(hideDevicePixelContentBox);
  if (options.block) await context.route(options.block, (route) => route.abort());
  const page = await context.newPage();
  const problems: string[] = [];
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    const text = message.text();
    const warningCounts = engine === chromium && !text.startsWith('[WARN]');
    if (message.type() === 'error' || (message.type() === 'warning' && warningCounts)) problems.push(text);
  });
  if (options.profile && engine === chromium) await throttle(context, page, options.profile);
  const target = new URL(url);
  target.searchParams.set('perf', '');
  for (const [key, value] of Object.entries(options.params ?? {})) target.searchParams.set(key, value);
  await page.goto(target.toString());
  return { page, context, problems, close: () => browser.close() };
}

type DropGlobal = { __tychoDropInput?: HTMLInputElement };

/**
 * Drops the file at `file` (a disk path) on the canvas, the way the OS does:
 * dragenter, dragover, drop, each carrying a DataTransfer with the file. The
 * file is set on a scratch <input type=file> by path, so Chromium reads it
 * from disk (no copy), like a visitor's file. Returns the page time just
 * before the drop event.
 */
export async function dropFile(page: Page, file: string): Promise<number> {
  await page.evaluate(() => {
    const g = globalThis as DropGlobal;
    if (!g.__tychoDropInput) {
      const input = document.createElement('input');
      input.type = 'file';
      input.hidden = true;
      document.body.append(input);
      g.__tychoDropInput = input;
    }
  });
  const input = await page.evaluateHandle(() => (globalThis as DropGlobal).__tychoDropInput!);
  await input.asElement()!.setInputFiles(file);
  return page.evaluate(() => {
    const file = (globalThis as DropGlobal).__tychoDropInput!.files![0]!;
    const canvas = document.querySelector('canvas')!;
    const transfer = new DataTransfer();
    transfer.items.add(file);
    const fire = (type: string) => canvas.dispatchEvent(new DragEvent(type, { dataTransfer: transfer, bubbles: true, cancelable: true, clientX: 720, clientY: 450 }));
    fire('dragenter');
    fire('dragover');
    const at = performance.now();
    fire('drop');
    return at;
  });
}

/** What the table publishes to `globalThis.__tychoTable` with `?perf` or `?bench`. */
export interface TableProbe {
  rows: number;
  top: number;
  first: number;
  end: number;
  loaded: number;
  pending: number;
  failed: number;
  lastCell: string | null;
}
type FrameGlobal = { __tychoTable?: TableProbe; __tychoFrames?: { t: number; blank: boolean; pending: boolean }[] };

/** Records every rAF: its time, and whether the table drew a blank row
 *  position or a placeholder. Install with `context.addInitScript`. */
export function frameRecorder(): void {
  const frames: { t: number; blank: boolean; pending: boolean }[] = [];
  (globalThis as FrameGlobal).__tychoFrames = frames;
  const tick = (t: number) => {
    const table = (globalThis as FrameGlobal).__tychoTable;
    const shown = table ? table.loaded + table.pending + table.failed : 0;
    frames.push({ t, blank: !!table && (table.end <= table.first || shown !== table.end - table.first), pending: !!table && table.pending > 0 });
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/** Frame intervals (ms) recorded between two page times, plus what the
 *  table showed in those frames. */
export async function framesBetween(page: Page, from: number, to: number) {
  const frames = await page.evaluate(({ from, to }) => ((globalThis as FrameGlobal).__tychoFrames ?? []).filter((frame) => frame.t >= from && frame.t <= to), { from, to });
  const intervals = frames.slice(1).map((frame, index) => frame.t - frames[index]!.t);
  const sorted = [...intervals].sort((a, b) => a - b);
  const rank = (p: number) => sorted[Math.min(sorted.length, Math.max(1, Math.ceil(p * sorted.length))) - 1] ?? 0;
  return {
    frames: frames.length,
    p50: rank(0.5),
    p95: rank(0.95),
    max: sorted.at(-1) ?? 0,
    over50: intervals.filter((interval) => interval > 50).length,
    blankFrames: frames.filter((frame) => frame.blank).length,
    placeholderFrames: frames.filter((frame) => frame.pending).length,
  };
}
