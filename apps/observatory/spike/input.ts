// Scripted input for a native scroller, shared by run.ts and tanstack.ts.

import { chromium, firefox, type BrowserType, type Page } from '@playwright/test';
import { targetRect, type Browsing } from '../../../shared-web/perf/harness.ts';
import { hideDevicePixelContentBox } from '../../../shared-web/perf/protocol.ts';

export const ROWS = 1_567_523;
export const ROW_HEIGHT = 30;

export interface FlingInput {
  events: number;
  largest: number;
  last: number;
}

/**
 * A wheel event that scrolls a native scroller `delta` CSS px. Not the
 * harness's `wheel()`: under Chromium's DPR 2 emulation the page's event
 * reports half of Playwright's delta, but a native scroller still moves the
 * whole of it, so `wheel()` (which doubles the delta for GPUI's listeners)
 * scrolls a native scroller twice as far.
 */
export async function nativeWheel(page: Page, delta: number): Promise<void> {
  await page.mouse.wheel(0, delta);
}

/** A steady fling: 180 equal wheel events, one per ~16 ms, top to bottom.
 *  Unlike the harness's, no event is bigger than total / 180. */
export async function steadyFling(page: Page): Promise<FlingInput> {
  const [x, y, , h] = await targetRect(page, 'table-scroll-track');
  await page.mouse.move(x - 400, y + h / 2);
  const delta = (ROWS * ROW_HEIGHT) / 180;
  for (let i = 0; i < 180; i++) {
    await nativeWheel(page, delta);
    await page.waitForTimeout(16);
  }
  return { events: 180, largest: Math.round(delta), last: Math.round(delta) };
}

/** The harness's fling, top to bottom in ~3 s, with `nativeWheel`. */
export async function nativeFling(page: Page): Promise<FlingInput> {
  const [x, y, , h] = await targetRect(page, 'table-scroll-track');
  await page.mouse.move(x - 400, y + h / 2);
  const total = ROWS * ROW_HEIGHT;
  const wallStart = Date.now();
  let sent = 0;
  const deltas: number[] = [];
  while (Date.now() - wallStart < 3_000) {
    const remaining = 3_000 - (Date.now() - wallStart);
    const delta = Math.max(1_000, ((total - sent) * 16) / Math.max(remaining, 16));
    await nativeWheel(page, delta);
    deltas.push(delta);
    sent += delta;
    await page.waitForTimeout(8);
  }
  if (sent < total) {
    await nativeWheel(page, total - sent);
    deltas.push(total - sent);
  }
  return { events: deltas.length, largest: Math.round(Math.max(...deltas)), last: Math.round(deltas.at(-1)!) };
}

/**
 * The harness's `open`, but with scrollbars a person would see: headless
 * Chromium hides them (`--hide-scrollbars`, a Playwright default) and Firefox
 * on macOS draws overlay ones; both are turned off here. DPR 1 unless `dpr`
 * (Chromium only, with the harness's DPR shim). Page errors and console
 * errors are collected in `problems`.
 */
export async function openWithScrollbars(
  engine: BrowserType,
  url: string,
  { params = {}, init = [], dpr = 1 }: { params?: Record<string, string>; init?: (() => void)[]; dpr?: number } = {},
): Promise<Browsing> {
  const browser = await engine.launch(
    engine === chromium ? { channel: 'chromium', ignoreDefaultArgs: ['--hide-scrollbars'] } : engine === firefox ? { firefoxUserPrefs: { 'ui.useOverlayScrollbars': 0 } } : {},
  );
  const scale = engine === chromium ? dpr : 1;
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: scale });
  if (scale !== 1) await context.addInitScript(hideDevicePixelContentBox);
  for (const script of init) await context.addInitScript(script);
  const page = await context.newPage();
  const problems: string[] = [];
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(message.text());
  });
  const target = new URL(url);
  for (const [key, value] of Object.entries(params)) target.searchParams.set(key, value);
  await page.goto(target.toString());
  return { page, context, problems, close: () => browser.close() };
}
