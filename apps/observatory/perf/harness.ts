// The observatory's own pieces of the perf harness: its budgets, and the GPUI
// contender's release build under test. Everything app-agnostic is in
// shared-web/perf/.

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { hideDevicePixelContentBox } from '../../../shared-web/perf/protocol.ts';
import { serveApp, type AppServer } from '../../../shared-web/perf/serve.ts';
import { MARKS as CONTRACT_MARKS } from '../contenders/contract.ts';

/** A script's budgets, from perf/budgets.json (`limits('gpui', [...])`). */
export { budgetLimits } from '../../../shared-web/perf/protocol.ts';

export const perfDir = fileURLToPath(new URL('.', import.meta.url));
export const gpuiWebDir = fileURLToPath(new URL('../contenders/tall-table/gpui/web', import.meta.url));
export const dataFile = fileURLToPath(new URL('../data/asteroids.parquet', import.meta.url));

/** The GPUI contender's wasm (`tall_table_gpui_bg-<hash>.wasm`) and the
 *  engine's chunk, which loads after first paint, as request URLs. */
export const GPUI_WASM = /\/tall_table_gpui_bg-[\w-]+\.wasm$/;
export const ENGINE_CHUNK = /\/assets\/engine-[\w-]+\.js$/;

/** The contract's marks (`contenders/contract.ts`, their home), and the
 *  bootstrap's, the placeholder's, and the engine's. */
export const MARKS = {
  ...CONTRACT_MARKS,
  firstFrame: 'gpui:first-frame',
  placeholder: 'seiza:placeholder-painted',
  wasmReady: 'seiza:wasm-ready',
  engineStart: 'duckdb:engine-start',
  engineReady: 'duckdb:engine-ready',
} as const;

/**
 * The GPUI contender's release build (web/dist) through `vite preview` on
 * `port`, brotli like production, its data file served by range
 * (`contenders/data.ts`). `url` is the page, under /observatory/.
 */
export async function serveGpui(port: number): Promise<AppServer> {
  if (!existsSync(`${gpuiWebDir}/dist/index.html`)) throw new Error('no GPUI contender build: run `just observatory gpui-build` first');
  if (!existsSync(dataFile)) throw new Error('no data file: run `just observatory data` first');
  const server = await serveApp(undefined, { webDir: gpuiWebDir, port });
  return { ...server, url: `${server.url}observatory/` };
}

/** A context per the protocol: 1440×900, DPR 2 with the DPR shim (Chromium). */
export async function protocolContext(browser: Browser, options: { dpr?: number; init?: (() => void)[] } = {}): Promise<BrowserContext> {
  const dpr = options.dpr ?? 2;
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: dpr });
  if (dpr !== 1) await context.addInitScript(hideDevicePixelContentBox);
  for (const script of options.init ?? []) await context.addInitScript(script);
  return context;
}

/** Collects page errors, console errors and warnings (GPUI's `[WARN]` logs
 *  describe the GPU, not a broken page), and HTTP errors. */
export function problems(page: Page): string[] {
  const found: string[] = [];
  page.on('pageerror', (error) => found.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    const text = message.text();
    if (message.type() === 'error' || (message.type() === 'warning' && !text.startsWith('[WARN]'))) found.push(`console: ${text}`);
  });
  page.on('response', (response) => {
    if (response.status() >= 400) found.push(`${response.status()} ${response.url()}`);
  });
  return found;
}

/** The last `performance.mark` named `name`, or null. */
export const lastMark = (page: Page, name: string): Promise<number | null> =>
  page.evaluate((name) => performance.getEntriesByName(name, 'mark').at(-1)?.startTime ?? null, name);
