// The observatory's own pieces of the perf harness: its budgets, and the
// contenders' release builds under test. Everything app-agnostic is in
// shared-web/perf/.

import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { hideDevicePixelContentBox } from '../../../shared-web/perf/protocol.ts';
import { serveApp, type AppServer } from '../../../shared-web/perf/serve.ts';
import { MARKS as CONTRACT_MARKS, type Side } from '../contenders/contract.ts';
import { contenderBase, OBSERVATORY } from '../contenders/paths.ts';

/** A script's budgets, from perf/budgets.json (`limits('gpui', [...])`). */
export { budgetLimits } from '../../../shared-web/perf/protocol.ts';

export const perfDir = fileURLToPath(new URL('.', import.meta.url));
export const gpuiWebDir = fileURLToPath(new URL('../contenders/tall-table/gpui/web', import.meta.url));
export const tanstackWebDir = fileURLToPath(new URL('../contenders/tall-table/tanstack/web', import.meta.url));
export const pageWebDir = fileURLToPath(new URL('../web', import.meta.url));
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
 * (`contenders/data.ts`), the engine at /observatory/duckdb/ and the font
 * at /fonts/ (`contenderBuild`). `url` is the page, at its base
 * (`contenderBase`).
 */
export const serveGpui = (port: number): Promise<AppServer> => serveContender('gpui', gpuiWebDir, port);

/** The TanStack contender's release build, as `serveGpui`. */
export const serveTanstack = (port: number): Promise<AppServer> => serveContender('tanstack', tanstackWebDir, port);

async function serveContender(side: Side, webDir: string, port: number): Promise<AppServer> {
  if (!existsSync(`${webDir}/dist/index.html`)) throw new Error(`no ${side === 'gpui' ? 'GPUI' : 'TanStack'} contender build: run \`just observatory ${side}-build\` first`);
  if (!existsSync(dataFile)) throw new Error('no data file: run `just observatory data` first');
  const server = await serveApp(undefined, { webDir, port });
  return { ...server, url: new URL(contenderBase('tall-table', side), server.url).href };
}

/**
 * The page's release build (web/dist) through `vite preview` on `port`,
 * brotli, with what its frames load as the deploy will serve it: both
 * contenders' release builds at their bases, the engine, the font, and
 * the data (`web/vite.config.ts`). `url` is the observatory's root,
 * `/observatory/`.
 */
export async function servePage(port: number): Promise<AppServer> {
  if (!existsSync(`${pageWebDir}/dist/index.html`)) throw new Error('no page build: run `just observatory build` first');
  for (const [side, webDir] of [['gpui', gpuiWebDir], ['tanstack', tanstackWebDir]] as const)
    if (!existsSync(`${webDir}/dist/index.html`)) throw new Error(`the page's frames need the ${side} contender's build: run \`just observatory ${side}-build\` first`);
  if (!existsSync(dataFile)) throw new Error('no data file: run `just observatory data` first');
  const server = await serveApp(undefined, { webDir: pageWebDir, port });
  return { ...server, url: new URL(OBSERVATORY, server.url).href };
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

/** A connection to data/'s native DuckDB (`just observatory data` installs
 *  it): the file's facts, independent of the pages' engine. */
export interface NativeConnection {
  runAndReadAll(sql: string): Promise<{ getRows(): unknown[][] }>;
}

export async function nativeDuckDB(): Promise<NativeConnection> {
  interface NativeDuckDB {
    DuckDBInstance: { create(path: string): Promise<{ connect(): Promise<NativeConnection> }> };
  }
  const require = createRequire(new URL('../data/package.json', import.meta.url));
  let native: NativeDuckDB;
  try {
    native = (await import(pathToFileURL(require.resolve('@duckdb/node-api')).href)) as NativeDuckDB;
  } catch {
    throw new Error("native DuckDB isn't installed: run `just observatory data`");
  }
  return (await native.DuckDBInstance.create(':memory:')).connect();
}
