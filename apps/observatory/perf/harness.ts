// The observatory's own pieces of the perf harness: its budgets, and the
// contenders' release builds under test. Everything app-agnostic is in
// shared-web/perf/.

import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium, firefox, webkit, type Browser, type BrowserContext, type BrowserType, type Page } from '@playwright/test';
import { hideDevicePixelContentBox } from '../../../shared-web/perf/protocol.ts';
import { serveApp, type AppServer } from '../../../shared-web/perf/serve.ts';
import { MARKS as CONTRACT_MARKS, type Side } from '../contenders/contract.ts';
import { levelOutDir } from '../contenders/level.ts';
import { contenderBase, OBSERVATORY, SCRIPT_FONTS } from '../contenders/paths.ts';
import { SCRIPT_FACES, faceFile } from '../contenders/fonts/faces.ts';
import { ALL_SCENARIOS, LIVE_TAIL, type Level, type Oklch } from '../contenders/scenarios.ts';
import { fromOklch } from '../contenders/tall-table/tanstack/web/src/paint.ts';

/** A script's budgets, from perf/budgets.json (`limits('gpui', [...])`). */
export { budgetLimits } from '../../../shared-web/perf/protocol.ts';

export const perfDir = fileURLToPath(new URL('.', import.meta.url));
export const gpuiWebDir = fileURLToPath(new URL('../contenders/tall-table/gpui/web', import.meta.url));
export const tanstackWebDir = fileURLToPath(new URL('../contenders/tall-table/tanstack/web', import.meta.url));

/** `theme.css`'s muted foreground in each theme, 8-bit `[r, g, b]`
 *  (generated from gpui-kit's theme, which the GPUI side draws). */
export function mutedForeground(): Record<'light' | 'dark', number[]> {
  const css = readFileSync(`${tanstackWebDir}/src/theme.css`, 'utf8');
  const hex = [...css.matchAll(/--muted-foreground:\s*#([0-9a-f]{6})/g)].map(([, value]) => [0, 2, 4].map((i) => parseInt(value!.slice(i, i + 2), 16)));
  if (hex.length < 2) throw new Error('theme.css: no muted foreground per theme');
  return { light: hex[0]!, dark: hex[1]! };
}

/** Live tail's error color in `theme`, 8-bit `[r, g, b]`. */
export function tailError(theme: 'light' | 'dark'): number[] {
  const color = fromOklch(...(LIVE_TAIL.error[theme] as Oklch));
  return [color.r, color.g, color.b].map((channel) => Math.round(channel * 255));
}
export const pageWebDir = fileURLToPath(new URL('../web', import.meta.url));
/** A file in `data/`, by name. */
export const dataPath = (name: string): string => fileURLToPath(new URL(`../data/${name}`, import.meta.url));
export const dataFile = dataPath('asteroids.parquet');

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
 * (`contenderBase`). With `given` (a script's `--url`: production)
 * nothing starts.
 */
export const serveGpui = (port: number, given?: string, level: Level = 'base', outDir?: string): Promise<AppServer> => serveContender('gpui', gpuiWebDir, port, given, level, outDir);

/** A contender's build directory at a level (`dist/`, `dist-<level>/`). */
export const distDir = (webDir: string, level: Level = 'base'): string => `${webDir}/${levelOutDir(level)}`;

/** The TanStack contender's release build, as `serveGpui`. */
export const serveTanstack = (port: number, given?: string, level: Level = 'base', outDir?: string): Promise<AppServer> => serveContender('tanstack', tanstackWebDir, port, given, level, outDir);

/** `outDir`: a kept build of the level to serve instead of the tree's (an
 *  A/B's: `perf/ab.ts`), an absolute path. The engine's files still come
 *  from the tree's build (the config's mount), which `perf/ab.ts` checks
 *  are the kept build's to the byte. */
async function serveContender(side: Side, webDir: string, port: number, given?: string, level: Level = 'base', outDir?: string): Promise<AppServer> {
  const base = contenderBase('tall-table', side, level);
  if (given) return { url: new URL(base, given).href, proxy: null, close: async () => {} };
  if (outDir && !existsSync(`${outDir}/index.html`)) throw new Error(`no kept ${side} build at ${outDir}`);
  if (!existsSync(`${distDir(webDir, level)}/index.html`))
    throw new Error(`no ${side === 'gpui' ? 'GPUI' : 'TanStack'} contender build at the ${level} level: run \`just observatory ${side}-build${level === 'base' ? '' : ` ${level}`}\` first`);
  // The level's own data files, which its scenarios read.
  for (const file of new Set(ALL_SCENARIOS.filter((scenario) => scenario.level === level).map((scenario) => scenario.data)))
    if (!existsSync(dataPath(file))) throw new Error(`no data file ${file}: run \`just observatory data\` first`);
  // The build's Vite config takes its level from the mode (its outDir and base).
  const server = await serveApp(undefined, { webDir, port, ...(level === 'base' ? {} : { mode: level }), ...(outDir ? { outDir } : {}) });
  return { ...server, url: new URL(base, server.url).href };
}

/**
 * The page's release build (web/dist) through `vite preview` on `port`,
 * brotli, with what its frames load as the deploy will serve it: both
 * contenders' release builds at their bases, the engine, the font, and
 * the data (`web/vite.config.ts`). `url` is the observatory's root,
 * `/observatory/`. With `given` (a script's `--url`: production) nothing
 * starts.
 */
export async function servePage(port: number, given?: string): Promise<AppServer> {
  if (given) return { url: new URL(OBSERVATORY, given).href, proxy: null, close: async () => {} };
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
/** Warnings that aren't a contender's view's: DuckDB-Wasm's own `eh`
 *  bundle warns in Firefox (the engine's), and Firefox warns of the scroll
 *  model's content placed from its scroll listener, which is its design
 *  (`docs/dom-scroll-model.md`). The parity checks drop them from
 *  `problems`. */
export const KNOWN_WARNINGS = [/WebAssembly exception handling 'try' instruction is deprecated/, /appears to use a scroll-linked positioning effect/];

/** Playwright's browsers by name, as `--browsers` lists them. */
export const BROWSER_TYPES: Record<string, BrowserType> = { chromium, firefox, webkit };

/** Whether `a` is within `tolerance` of `b`. */
export const near = (a: number, b: number, tolerance: number): boolean => Math.abs(a - b) <= tolerance;

/** Resolves after `n` animation frames in the page. */
export const frames = (page: Page, n = 2): Promise<void> =>
  page.evaluate((n) => new Promise<void>((resolve) => { const step = (k: number) => (k === 0 ? resolve() : requestAnimationFrame(() => step(k - 1))); step(n); }), n);

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

/** The admin table's script faces the page fetched (`/observatory/fonts/`,
 *  GPUI with `?fonts`), from its Resource Timing: each one's start, page ms,
 *  and its bytes (`transferSize`: on the wire, headers included). */
export async function facesFetched(page: Page): Promise<{ name: string; fetchStart: number; transferSize: number; encodedBodySize: number; decodedBodySize: number }[]> {
  return page.evaluate((path) => performance.getEntriesByType('resource').filter((entry) => new URL(entry.name).pathname.startsWith(path) && entry.name.endsWith('.ttf')).map((entry) => {
    const resource = entry as PerformanceResourceTiming;
    return { name: resource.name, fetchStart: resource.fetchStart, transferSize: resource.transferSize, encodedBodySize: resource.encodedBodySize, decodedBodySize: resource.decodedBodySize };
  }), SCRIPT_FONTS);
}

/** The faces fetched as the fonts path promises: each of the pinned faces
 *  exactly once (by its served name), and every fetch after the rows were
 *  in (`filled`, page ms). */
export function facesChecked(faces: readonly { name: string; fetchStart: number }[], filled: number): { once: boolean; afterRows: boolean } {
  const once = faces.length === SCRIPT_FACES.length && SCRIPT_FACES.every((face) => faces.filter((entry) => entry.name.endsWith(`${SCRIPT_FONTS}${faceFile(face)}`)).length === 1);
  return { once, afterRows: faces.every((entry) => entry.fetchStart >= filled) };
}

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
