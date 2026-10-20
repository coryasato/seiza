// What every metric script (`metric-*.ts`) shares: either bare contender
// page opened cold under the measurement protocol with `?measure`, the
// recorders the metrics read, each side's own input path, and the runs
// (reference and throttled, both contenders, their order alternated),
// summarized and written to perf/results/. The metrics themselves are
// `metrics/metrics.ts`'s; a script only gathers what they read.
//
// Flags every metric script takes:
//   --side gpui|tanstack   one contender (default: both, their order alternated)
//   --runs <n>             runs per contender and profile (default 10)
//   --profile reference|throttled   one profile (default: both)
//   --label <name>         writes perf/results/<date>-<label>.json

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { frameRecorder, targetRect, waitMark, wheel } from '../../../shared-web/perf/harness.ts';
import { PROFILES, machineInfo, median, option, throttle, type Profile } from '../../../shared-web/perf/protocol.ts';
import type { AppServer } from '../../../shared-web/perf/serve.ts';
import { FLING_FRAMES, FRAME_MS, PROBE_KEY, flingStep, cellPaints, type CellPaint, type ContenderState, type Side, type StateFrame, type WheelInput } from '../metrics/metrics.ts';
import { MARKS, dataFile, nativeDuckDB, perfDir, problems, protocolContext, serveGpui, serveTanstack } from './harness.ts';

export const SIDES: Side[] = ['gpui', 'tanstack'];
/** Both contenders' rows (the TanStack contender's `layout.ts` pins GPUI's). */
export const ROW_HEIGHT = 30;

type Global = {
  __contender?: { side: Side; state: ContenderState | null; replay: { jump(fraction: number): Promise<void> } };
  __seizaFrameSample?: () => object;
  __seizaFrames?: StateFrame[];
  __keys?: number[];
  __wheels?: { at: number; delta: number }[];
  __presses?: { at: number; scroller: boolean }[];
  __painted?: { id: string; renderTime: number }[];
};

// ---------------------------------------------------------------- in the page

/** Init script: each key's and wheel event's time (`timeStamp`), each
 *  press and whether the DOM scrollbar took it (its target is the
 *  scroller); each wheel event's `deltaY` too. */
export function inputRecorder(): void {
  const g = globalThis as Global;
  g.__keys = [];
  g.__wheels = [];
  g.__presses = [];
  addEventListener('keydown', (event) => g.__keys!.push(event.timeStamp), { capture: true });
  addEventListener('wheel', (event) => g.__wheels!.push({ at: event.timeStamp, delta: event.deltaY }), { capture: true, passive: true });
  addEventListener('pointerdown', (event) => g.__presses!.push({ at: event.timeStamp, scroller: (event.target as Element).classList?.contains('scroller') ?? false }), { capture: true, passive: true });
}

/** Init script: the trace's origin (`ORIGIN_MARK`), at the document's
 *  start, for a trace started before the page loads. */
export function originMark(): void {
  performance.mark('trace:origin');
}

/** Init script (DOM): every Element Timing entry, from the page's start
 *  (the browser buffers only 150, and a screen of cells is ~330). */
export function paintRecorder(): void {
  const g = globalThis as Global;
  g.__painted = [];
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) g.__painted!.push({ id: (entry as PerformanceEntry & { identifier: string }).identifier, renderTime: (entry as PerformanceEntry & { renderTime: number }).renderTime });
  }).observe({ type: 'element', buffered: true });
}

/** Init script: `frameRecorder` sampling `__contender.state` each frame. */
export function stateRecorder(): void {
  (globalThis as Global).__seizaFrameSample = () => ({ ...(globalThis as Global).__contender?.state });
}

/** Init script (GPUI): after each task that makes GPU calls, the state's
 *  `top`; marks `probe:moved:<pending>` in the first frame at a new one. */
export function gpuiProbe(): void {
  const g = globalThis as Global;
  let last: number | null = null;
  let pending = false;
  const hook = (proto: object | undefined, names: string[]) => {
    if (!proto) return;
    const methods = proto as Record<string, (...args: unknown[]) => unknown>;
    for (const name of names) {
      const original = methods[name];
      if (!original) continue;
      methods[name] = function (this: unknown, ...args: unknown[]) {
        if (!pending) {
          pending = true;
          queueMicrotask(() => {
            pending = false;
            const state = g.__contender?.state;
            if (!state || state.top === last) return;
            if (last !== null) performance.mark(`probe:moved:${state.pending}`);
            last = state.top;
          });
        }
        return original.apply(this, args);
      };
    }
  };
  hook(globalThis.WebGL2RenderingContext?.prototype, ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced']);
  hook((globalThis as { GPUQueue?: { prototype: object } }).GPUQueue?.prototype, ['submit']);
}

/** Init script (DOM): in every animation frame, the scroller's position;
 *  marks `probe:moved` in the first frame at a new one. */
export function domProbe(): void {
  let last: number | null = null;
  const tick = () => {
    const top = document.querySelector('.scroller')?.scrollTop;
    if (top !== undefined && top !== last) {
      if (last !== null) performance.mark('probe:moved');
      last = top;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// ---------------------------------------------------------------- a session

export interface Session {
  side: Side;
  profile: Profile;
  page: Page;
  context: BrowserContext;
  browser: Browser;
  /** Page errors, console errors and warnings, HTTP errors. */
  problems: string[];
  close(): Promise<void>;
}

/**
 * Opens `side` cold (a new browser) at `url` with `?measure`, under
 * `profile`: Chromium headless=new, 1440×900 at DPR 2 with the DPR shim,
 * the scrollbars a person sees (Playwright hides them), `init` scripts
 * before the page's own. `before` runs on the page before it navigates
 * (a trace that must see the load starts there).
 */
export async function openSide(
  side: Side,
  url: string,
  profile: Profile,
  { init = [], args = [], before }: { init?: (() => void)[]; args?: string[]; before?: (page: Page, browser: Browser) => Promise<void> } = {},
): Promise<Session> {
  const browser = await chromium.launch({ channel: 'chromium', ignoreDefaultArgs: ['--hide-scrollbars'], args });
  try {
    const context = await protocolContext(browser, { init });
    const page = await context.newPage();
    const found = problems(page);
    await throttle(context, page, profile);
    await before?.(page, browser);
    await page.goto(`${url}?measure`);
    return { side, profile, page, context, browser, problems: found, close: () => browser.close() };
  } catch (error) {
    await browser.close();
    throw error;
  }
}

export const now = (page: Page): Promise<number> => page.evaluate(() => performance.now());

export const state = (page: Page): Promise<ContenderState | null> => page.evaluate(() => (globalThis as Global).__contender?.state ?? null);

/** Waits for a filled state passing `test` (an expression over `s`). */
export const filledState = (page: Page, test = 'true', timeout = 120_000): Promise<ContenderState> =>
  page
    .waitForFunction(
      (test) => {
        const s = (globalThis as Global).__contender?.state;
        return s && s.end > s.first && s.loaded === s.end - s.first && new Function('s', `return ${test}`)(s) ? s : false;
      },
      test,
      { timeout, polling: 20 },
    )
    .then(async (handle) => (await handle.jsonValue()) as ContenderState);

/** Opened: the first `contender:filled` after the open, and the view at
 *  row 0 with every row real. */
export async function opened(session: Session): Promise<{ open: number; filled: number; state: ContenderState }> {
  const { page } = session;
  const open = await waitMark(page, MARKS.open, 0, 180_000);
  const filled = await waitMark(page, MARKS.filled, open, 180_000);
  return { open, filled, state: await filledState(page, 's.first === 0') };
}

/** The probe key, so a later measured key isn't the first (the first key
 *  changes the probe's state on both sides). */
export async function pressProbeKey(page: Page): Promise<void> {
  const since = await now(page);
  await page.keyboard.press(PROBE_KEY);
  await waitMark(page, MARKS.input, since, 5_000);
}

/** Each key's event time, in order. */
export const keys = (page: Page): Promise<number[]> => page.evaluate(() => (globalThis as Global).__keys ?? []);
export const wheels = (page: Page): Promise<WheelInput[]> => page.evaluate(() => (globalThis as Global).__wheels ?? []);
export const presses = (page: Page): Promise<{ at: number; scroller: boolean }[]> => page.evaluate(() => (globalThis as Global).__presses ?? []);
export const paints = async (page: Page): Promise<CellPaint[]> => cellPaints(await page.evaluate(() => (globalThis as Global).__painted ?? []));
export const frames = (page: Page, from: number, to: number): Promise<StateFrame[]> =>
  page.evaluate(({ from, to }) => ((globalThis as Global).__seizaFrames ?? []).filter((frame) => frame.t >= from && frame.t <= to), { from, to });

export { frameRecorder };

// ---------------------------------------------------------------- each side's input

/** Where the pointer rests for a wheel: over the row numbers (inside the
 *  scroller, no cell tooltip), halfway down. */
export async function restPoint(page: Page): Promise<{ x: number; y: number }> {
  const [x, y, , h] = await targetRect(page, 'table');
  return { x: x - 20, y: y + h / 2 };
}

/** A wheel of `px` CSS px through each side's own path: GPUI's listeners
 *  get a DPR-scaled delta (`wheel`); a native scroller moves the whole of
 *  Playwright's delta (`docs/dom-scroll-model.md`, "Scripting it"). */
export async function wheelBy(session: Session, px: number): Promise<void> {
  if (session.side === 'gpui') await wheel(session.page, px);
  else await session.page.mouse.wheel(0, px);
}

/** The fling, ready to go: the pointer at the rest point, and on GPUI the
 *  wheel's device scale read (`wheel` reads it on its first call, which
 *  would hold back the fling's first steps). Run before tracing starts. */
export async function readyFling(session: Session): Promise<void> {
  const rest = await restPoint(session.page);
  await session.page.mouse.move(rest.x, rest.y);
  if (session.side === 'gpui') await wheel(session.page, 0);
  await session.page.waitForTimeout(250);
}

/**
 * The fling (`FLING_FRAMES` steps of `flingStep`, the metrics module's
 * profile) on a schedule, one step every frame, not paced by each event's
 * handling (Playwright's wheel waits for the page's): the input is the same
 * on both sides, whatever it costs. Returns the step, CSS px.
 */
export async function fling(session: Session, rows: number): Promise<number> {
  const step = flingStep(rows, ROW_HEIGHT);
  const sent: Promise<unknown>[] = [];
  const t0 = performance.now();
  for (let index = 0; index < FLING_FRAMES; index++) {
    const wait = t0 + index * FRAME_MS - performance.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    // Settled at once, so a failed step can't go unhandled while the loop waits.
    sent.push(wheelBy(session, step).then(() => null, (error: unknown) => error));
  }
  const failed = (await Promise.all(sent)).find((result) => result !== null);
  if (failed) throw failed;
  return step;
}

/** How many fling steps the page's wheel events add up to (a browser may
 *  coalesce them): their summed `deltaY` over one step as the page sees it
 *  (GPUI's `wheel` scales to CSS px; a native scroller's event reports
 *  Playwright's delta over the device scale). */
export async function stepsReceived(session: Session, inputs: readonly WheelInput[], step: number): Promise<number> {
  const perStep = session.side === 'gpui' ? step : step / (await session.page.evaluate(() => devicePixelRatio));
  return inputs.reduce((sum, input) => sum + input.delta, 0) / perStep;
}

/** Brings the scrollbar up where it's an overlay (macOS's takes a press
 *  only while shown), the same on both sides: a wheel there and back, the
 *  pointer over the bar. */
async function showBar(session: Session, x: number, y: number): Promise<void> {
  const { page } = session;
  await page.mouse.move(x - 40, y);
  await wheelBy(session, 30);
  await page.waitForTimeout(50);
  await wheelBy(session, -30);
  await page.mouse.move(x, y);
  await page.waitForTimeout(300);
}

/**
 * A press on the vertical scrollbar's track at `fraction` of it (both
 * tables jump to the press), released at once. `mark` runs right before
 * the press that counts. On the DOM an overlay bar can fade before the
 * press lands: then again, up to three times.
 */
export async function trackPress(session: Session, fraction: number, mark: () => Promise<void>): Promise<void> {
  const { page } = session;
  const [x, y, w, h] = await targetRect(page, 'table-scroll-track');
  const at = { x: x + w / 2, y: y + h * fraction };
  for (let attempt = 0; attempt < 3; attempt++) {
    await showBar(session, at.x, at.y);
    const since = await now(page);
    await mark();
    await page.mouse.down();
    await page.mouse.up();
    if (session.side === 'gpui') return;
    const press = (await presses(page)).find((entry) => entry.at >= since);
    if (press?.scroller) return;
    await page.waitForTimeout(400);
  }
  throw new Error(`the scrollbar took no press at (${at.x}, ${at.y}) in 3 tries`);
}

// ---------------------------------------------------------------- the file's facts

/** `count(*)` and the last row's key (spkid, in file order), from data/'s
 *  native DuckDB: independent of the pages' engine. */
export async function fileFacts(): Promise<{ count: number; lastKey: string }> {
  const conn = await nativeDuckDB();
  const file = `'${dataFile.replaceAll("'", "''")}'`;
  const value = async (sql: string) => String((await conn.runAndReadAll(sql)).getRows()[0]?.[0]);
  const count = Number(await value(`SELECT count(*) FROM read_parquet(${file})`));
  const lastKey = await value(`SELECT spkid FROM read_parquet(${file}, file_row_number = true) WHERE file_row_number = ${count - 1}`);
  return { count, lastKey };
}

// ---------------------------------------------------------------- the runs

/** What one run of a metric returns: its readings, and what it found wrong. */
export interface RunResult {
  failures: string[];
}

export interface RunContext {
  side: Side;
  profile: Profile;
  url: string;
  run: number;
}

/** Each metric script's ports: the GPUI contender's server, then the TanStack's. */
const PORTS: Record<string, [number, number]> = {
  usable: [4322, 4323],
  data: [4324, 4325],
  response: [4326, 4327],
  fling: [4328, 4329],
  reach: [4330, 4331],
  cost: [4332, 4333],
  memory: [4335, 4336],
};

/**
 * Runs `measure` per the flags (see the top of this file): for each
 * profile, `runs` rounds, each round both contenders, the first round GPUI
 * first and then alternating. Prints and writes each run and
 * `summarize`'s summary per contender and profile; exits non-zero if a run
 * failed, a page logged a problem, or a run threw.
 */
export async function runMetric<R extends RunResult>(
  metric: keyof typeof PORTS,
  measure: (context: RunContext) => Promise<R>,
  summarize: (runs: R[]) => Record<string, unknown>,
  extra: Record<string, unknown> = {},
): Promise<void> {
  const sides = option('side') ? [option('side') as Side] : SIDES;
  if (!sides.every((side) => SIDES.includes(side))) throw new Error(`--side ${option('side')}: gpui or tanstack`);
  const runs = Number(option('runs') ?? 10);
  const profiles = option('profile') ? PROFILES.filter((profile) => profile.name === option('profile')) : PROFILES;
  if (!profiles.length) throw new Error(`--profile ${option('profile')}: reference or throttled`);
  const label = option('label');
  const [gpuiPort, tanstackPort] = PORTS[metric]!;
  const servers: Partial<Record<Side, AppServer>> = {};
  const output: Record<string, unknown> = { date: new Date().toISOString().slice(0, 10), label, metric, ...machineInfo(), runs, ...extra, profiles: {} };
  const failures: string[] = [];
  try {
    if (sides.includes('gpui')) servers.gpui = await serveGpui(gpuiPort);
    if (sides.includes('tanstack')) servers.tanstack = await serveTanstack(tanstackPort);
    for (const profile of profiles) {
      const results: Partial<Record<Side, R[]>> = {};
      for (let run = 0; run < runs; run++) {
        const order = run % 2 ? [...sides].reverse() : sides;
        for (const side of order) {
          const where = `${metric} ${profile.name} ${side} run ${run + 1}/${runs}`;
          let result: R;
          try {
            result = await measure({ side, profile, url: servers[side]!.url, run });
          } catch (error) {
            failures.push(`${where}: ${(error as Error).message.split('\n')[0]}`);
            console.log(`${where}: FAILED: ${(error as Error).message.split('\n')[0]}`);
            continue;
          }
          (results[side] ??= []).push(result);
          failures.push(...result.failures.map((failure) => `${where}: ${failure}`));
          console.log(`${where}: ${brief(result)}`);
        }
      }
      (output.profiles as Record<string, unknown>)[profile.name] = Object.fromEntries(sides.map((side) => [side, { summary: summarize(results[side] ?? []), runs: results[side] ?? [] }]));
      for (const side of sides) console.log(`\n${metric} ${profile.name} ${side}: ${JSON.stringify(summarize(results[side] ?? []))}\n`);
    }
  } finally {
    await Promise.all(Object.values(servers).map((server) => server.close()));
  }
  output.failures = failures;
  if (label) {
    const out = join(perfDir, 'results', `${output.date}-${label}.json`);
    mkdirSync(join(perfDir, 'results'), { recursive: true });
    writeFileSync(out, `${JSON.stringify(output, null, 2)}\n`);
    console.log(`wrote ${out}`);
  }
  if (failures.length) {
    console.error(`\nFAIL\n${failures.map((failure) => `  ${failure}`).join('\n')}`);
    process.exit(1);
  }
  console.log('\nPASS');
}

/** A run's numbers on one line: its top-level numbers and booleans. */
function brief(result: object): string {
  return Object.entries(result)
    .filter(([, value]) => typeof value === 'number' || typeof value === 'boolean')
    .map(([key, value]) => `${key} ${typeof value === 'number' ? Number(value.toFixed(1)) : value}`)
    .join(', ');
}

/** The median of the runs' values that are numbers, rounded; null if none. */
export function medianOf<R>(runs: R[], pick: (run: R) => number | null | undefined, digits = 1): number | null {
  const values = runs.map(pick).filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  return values.length ? Number(median(values).toFixed(digits)) : null;
}
