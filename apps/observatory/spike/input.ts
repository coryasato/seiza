// Scripted input for a native scroller, shared by run.ts and tanstack.ts.

import type { Page } from '@playwright/test';
import { targetRect } from '../../../shared-web/perf/harness.ts';

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
