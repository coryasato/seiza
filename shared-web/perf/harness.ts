// Playwright helpers for the scripts that drive an app: opening a page per
// the protocol, reading the perf panel, clicking canvas controls, scrolling,
// waiting for marks, and recording frames and per-frame work.

import { chromium, type BrowserContext, type BrowserType, type Page } from '@playwright/test';
import { hideDevicePixelContentBox, percentiles, throttle, type Profile } from './protocol.ts';

type OverlayRows = [string, string][];

/** A perf panel row's current value, or null while hidden or unset. */
export const overlayValue = (page: Page, row: string) =>
  page.evaluate((row) => (globalThis as { __seizaPerfOverlay?: OverlayRows }).__seizaPerfOverlay?.find(([name]) => name === row)?.[1] ?? null, row);

/** Waits until a perf panel row matches `pattern`; returns its value. */
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

/** The perf panel's rows and when they were taken (page clock), or null
 *  while it's hidden. */
export async function panelSnapshot(page: Page): Promise<{ at: number; rows: Record<string, string> } | null> {
  return page.evaluate(() => {
    const g = globalThis as { __seizaPerfOverlay?: OverlayRows; __seizaPerfOverlayAt?: number };
    if (!g.__seizaPerfOverlay || g.__seizaPerfOverlayAt === undefined) return null;
    return { at: g.__seizaPerfOverlayAt, rows: Object.fromEntries(g.__seizaPerfOverlay) };
  });
}

/** Shows or hides the perf panel (Ctrl+Shift+P), if it isn't already. It
 *  swallows clicks under it and draws at every refresh, so scripts hide it
 *  for presses near its corner and for timing a component alone. */
export async function setPanel(page: Page, open: boolean): Promise<void> {
  const visible = () => page.evaluate(() => (globalThis as { __seizaPerfOverlay?: unknown }).__seizaPerfOverlay !== undefined);
  if ((await visible()) === open) return;
  await page.keyboard.press('Control+Shift+P');
  await page.waitForFunction((open) => ((globalThis as { __seizaPerfOverlay?: unknown }).__seizaPerfOverlay !== undefined) === open, open, { timeout: 5_000 });
}

/** A control's published bounds (`globalThis.__seizaTargets[id]`), once
 *  they're inside the viewport: `[x, y, width, height]` in CSS pixels. */
export async function targetRect(page: Page, id: string, timeout = 60_000): Promise<[number, number, number, number]> {
  const handle = await page.waitForFunction(
    (id) => {
      const rect = (globalThis as { __seizaTargets?: Record<string, number[]> }).__seizaTargets?.[id];
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
 * arrives as `deltaY` 500 (checked 2026-09-25). The reference run is at
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
  options: { profile?: Profile | null; block?: RegExp; params?: Record<string, string>; init?: (() => void)[] } = {},
): Promise<Browsing> {
  const browser = await engine.launch(engine === chromium ? { channel: 'chromium' } : {});
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: engine === chromium ? 2 : 1 });
  if (engine === chromium) await context.addInitScript(hideDevicePixelContentBox);
  for (const script of options.init ?? []) await context.addInitScript(script);
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

/** What `firstDrawProbe` records: the first GPU work and its API (`webgl2`
 *  or `webgpu`), each of the first 50 GPU tasks' last GPU call and the end of
 *  its microtask checkpoint, and when the placeholder shell was released. The
 *  mark is honest if it lands inside one task's window (last call → end). */
export interface FirstDrawProbe {
  firstGpuWork: number | null;
  gpuTasks: { lastGpuCall: number; end: number | null }[];
  api: string;
  placeholderReleased: number | null;
}

/**
 * The first-draw probe, an independent check of the first-frame mark
 * (`gpui:first-frame`). Install with `context.addInitScript`, after the DPR
 * shim (`hideDevicePixelContentBox`), so it runs before any page script;
 * read `globalThis.__seizaProbe` (`FirstDrawProbe`) after the mark. It
 * records the first GPU work (a WebGL2 draw call or a WebGPU queue submit),
 * and for every task that did GPU work, its last GPU call and the
 * end of its microtask checkpoint (a microtask queued at its first GPU
 * call), in any callback: GPUI's first real draw can run in a
 * ResizeObserver callback, not only in a rAF. The mark is honest if it
 * lands inside one of those windows, after that task's last GPU call and
 * before its checkpoint ends, meaning the task that rendered the first
 * real frame also presented it. With WebGPU, GPUI first presents an
 * empty frame at 0×0 in the same callback, so the mark trails the first
 * GPU work by that callback's render time, not by a frame. If gpui-kit
 * changes when it presents, this catches it.
 */
export function firstDrawProbe(): void {
  type GpuTask = FirstDrawProbe['gpuTasks'][number];
  const state: FirstDrawProbe & { current: GpuTask | null } = {
    firstGpuWork: null,
    gpuTasks: [],
    api: '',
    current: null,
    placeholderReleased: null,
  };
  // When the placeholder shell is released, timed here rather than by the
  // app: shared/ adds `sz-leaving` to it, and it fades out.
  const add = DOMTokenList.prototype.add;
  DOMTokenList.prototype.add = function (this: DOMTokenList, ...tokens: string[]) {
    if (tokens.includes('sz-leaving') && state.placeholderReleased === null) state.placeholderReleased = performance.now();
    return add.apply(this, tokens);
  };
  (globalThis as { __seizaProbe?: typeof state }).__seizaProbe = state;
  const hook = (proto: object | undefined, names: string[], api: string) => {
    if (!proto) return;
    const methods = proto as Record<string, (...args: unknown[]) => unknown>;
    for (const name of names) {
      const original = methods[name];
      if (!original) continue;
      methods[name] = function (this: unknown, ...args: unknown[]) {
        if (state.firstGpuWork === null) {
          state.firstGpuWork = performance.now();
          state.api = api;
        }
        if (!state.current && state.gpuTasks.length < 50) {
          const task: GpuTask = { lastGpuCall: 0, end: null };
          state.current = task;
          state.gpuTasks.push(task);
          queueMicrotask(() => {
            task.end = performance.now();
            state.current = null;
          });
        }
        const result = original.apply(this, args);
        if (state.current) state.current.lastGpuCall = performance.now();
        return result;
      };
    }
  };
  hook(globalThis.WebGL2RenderingContext?.prototype, ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced'], 'webgl2');
  hook((globalThis as { GPUQueue?: { prototype: object } }).GPUQueue?.prototype, ['submit'], 'webgpu');
}

/** One rAF as the recorder saw it: its time, plus whatever
 *  `globalThis.__seizaFrameSample()` returned then (an app's view state). */
export type RecordedFrame<S extends object = object> = S & { t: number };
type FrameGlobal = { __seizaFrames?: RecordedFrame[]; __seizaFrameSample?: () => object };

/** Records every rAF (see `RecordedFrame`). Install with
 *  `context.addInitScript` or `page.evaluate`, and an app's
 *  `__seizaFrameSample` the same way to record what each frame showed. */
export function frameRecorder(): void {
  const g = globalThis as FrameGlobal;
  const frames: RecordedFrame[] = [];
  g.__seizaFrames = frames;
  const tick = (t: number) => {
    frames.push({ ...g.__seizaFrameSample?.(), t });
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/** Frames recorded between two page times (see `frameRecorder`). */
export async function recordedBetween<S extends object = object>(page: Page, from: number, to: number): Promise<RecordedFrame<S>[]> {
  const frames = await page.evaluate(({ from, to }) => ((globalThis as FrameGlobal).__seizaFrames ?? []).filter((frame) => frame.t >= from && frame.t <= to), { from, to });
  return frames as RecordedFrame<S>[];
}

/** Frame intervals (ms) between recorded frames: nearest-rank p50, p95, max,
 *  and how many were over 50 ms. */
export function frameStats(frames: RecordedFrame[]): { frames: number; p50: number; p95: number; max: number; over50: number } {
  const intervals = frames.slice(1).map((frame, index) => frame.t - frames[index]!.t);
  const { p50, p95, max } = percentiles(intervals);
  return { frames: frames.length, p50, p95, max, over50: intervals.filter((interval) => interval > 50).length };
}

/** One rAF callback that drew (made a WebGL2 draw call or a WebGPU submit):
 *  when it started and how long it ran, on the main thread. */
export interface WorkSample {
  t: number;
  ms: number;
}

/** A task that made GPU calls: its last GPU call, and when the next task
 *  started (a message posted at its first GPU call). */
interface PresentingTask {
  lastGpuCall: number;
  next: number | null;
}
type PresentingGlobal = { __seizaPresentingTasks?: PresentingTask[] };

/**
 * Records every task that makes GPU calls (WebGL2 draws, WebGPU submits):
 * its last GPU call and when the next task started. With `presentedMark`,
 * it checks that a mark set "right after the frame is presented" landed in
 * the presenting task's own microtask checkpoint: after its last GPU call,
 * before anything else could run or render. Install with
 * `context.addInitScript` (before the app's scripts). It wraps every GPU
 * call, so keep it out of timing runs.
 */
export function presentingTaskRecorder(): void {
  const tasks: PresentingTask[] = [];
  (globalThis as PresentingGlobal).__seizaPresentingTasks = tasks;
  const channel = new MessageChannel();
  const waiting: PresentingTask[] = [];
  channel.port1.onmessage = () => {
    const task = waiting.shift();
    if (task) task.next = performance.now();
  };
  let current: PresentingTask | null = null;
  const hook = (proto: object | undefined, names: string[]) => {
    if (!proto) return;
    const methods = proto as Record<string, (...args: unknown[]) => unknown>;
    for (const name of names) {
      const original = methods[name];
      if (!original) continue;
      methods[name] = function (this: unknown, ...args: unknown[]) {
        if (!current) {
          const task: PresentingTask = { lastGpuCall: 0, next: null };
          current = task;
          tasks.push(task);
          if (tasks.length > 2000) tasks.shift();
          waiting.push(task);
          channel.port2.postMessage(0);
          queueMicrotask(() => (current = null));
        }
        const result = original.apply(this, args);
        if (current) current.lastGpuCall = performance.now();
        return result;
      };
    }
  };
  hook(globalThis.WebGL2RenderingContext?.prototype, ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced']);
  hook((globalThis as { GPUQueue?: { prototype: object } }).GPUQueue?.prototype, ['submit']);
}

/** Whether a mark at `at` (page time) landed right after a presented frame
 *  (see `presentingTaskRecorder`): after the last GPU task's last call
 *  before it, and before the next task started. */
export async function presentedMark(page: Page, at: number): Promise<{ ok: boolean; detail: string }> {
  // The next task may not have run yet when this is called right after the mark.
  await page.waitForTimeout(50);
  const tasks = await page.evaluate(() => (globalThis as PresentingGlobal).__seizaPresentingTasks ?? []);
  const task = tasks.filter((candidate) => candidate.lastGpuCall <= at).at(-1);
  if (!task) return { ok: false, detail: 'no GPU task before it' };
  const ok = task.next !== null && at < task.next;
  const after = (at - task.lastGpuCall).toFixed(2);
  return { ok, detail: ok ? `${after} ms after its last GPU call, same task` : `${after} ms after the last GPU call, a later task` };
}

/**
 * Times every `requestAnimationFrame` callback that does GPU work: GPUI's
 * frames. An independent check of the perf panel's "work per frame", which
 * `seiza` times from the shell's render to a microtask after the present.
 * Install with `context.addInitScript` (before the app's scripts).
 */
export function workRecorder(): void {
  const work: WorkSample[] = [];
  (globalThis as { __seizaWork?: WorkSample[] }).__seizaWork = work;
  let drew = false;
  const hook = (proto: object | undefined, names: string[]) => {
    if (!proto) return;
    const methods = proto as Record<string, (...args: unknown[]) => unknown>;
    for (const name of names) {
      const original = methods[name];
      if (!original) continue;
      methods[name] = function (this: unknown, ...args: unknown[]) {
        drew = true;
        return original.apply(this, args);
      };
    }
  };
  hook(globalThis.WebGL2RenderingContext?.prototype, ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced']);
  hook((globalThis as { GPUQueue?: { prototype: object } }).GPUQueue?.prototype, ['submit']);
  const request = globalThis.requestAnimationFrame.bind(globalThis);
  globalThis.requestAnimationFrame = (callback) =>
    request((time) => {
      drew = false;
      const start = performance.now();
      try {
        callback(time);
      } finally {
        if (drew) work.push({ t: start, ms: performance.now() - start });
      }
    });
}

/** Work samples (see `workRecorder`) that started between two page times. */
export async function workBetween(page: Page, from: number, to: number): Promise<WorkSample[]> {
  return page.evaluate(
    ({ from, to }) => ((globalThis as { __seizaWork?: WorkSample[] }).__seizaWork ?? []).filter((sample) => sample.t >= from && sample.t <= to),
    { from, to },
  );
}

/**
 * The fling: wheel events from the top to the bottom of a `rows`-row table
 * (`rowHeight` CSS pixels each) in ~3 s, the pointer over the table, left of
 * the `track` target (its vertical scrollbar). Returns the page times it
 * started and ended. Press Home and wait for the rows first.
 */
export async function fling(page: Page, rows: number, { rowHeight = 30, track = 'table-scroll-track' } = {}): Promise<{ start: number; end: number }> {
  const [x, y, , h] = await targetRect(page, track);
  await page.mouse.move(x - 400, y + h / 2);
  const total = rows * rowHeight;
  const now = () => page.evaluate(() => performance.now());
  const start = await now();
  const wallStart = Date.now();
  let sent = 0;
  while (Date.now() - wallStart < 3_000) {
    const remaining = 3_000 - (Date.now() - wallStart);
    const delta = Math.max(1_000, ((total - sent) * 16) / Math.max(remaining, 16));
    await wheel(page, delta);
    sent += delta;
    await page.waitForTimeout(8);
  }
  // Whatever the loop didn't cover in its 3 s: the fling ends at the bottom.
  if (sent < total) await wheel(page, total - sent);
  return { start, end: await now() };
}
