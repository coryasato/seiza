// The tab's memory over a session on the page (what it found:
// `perf/results/2026-11-09-session-memory.md`): the page's release build with both
// contenders' builds in its frames, Chromium, the protocol's page
// (1440×900, DPR 2), one scripted session: the Overview, the component's
// page, then every scenario's route, at each stop GPUI, a flip to
// TanStack, a flip back (each a frame destroyed and another created),
// `--dwell` seconds on each filled frame, then back to the Overview, idle
// for `--idle-minutes` with a reading every 30 s, and a last reading after
// a forced collection.
//
// Each reading: `measureUserAgentSpecificMemory`'s breakdown (the top
// window, the frames' windows, the workers by URL, what's attributed to
// nothing); what each frame left behind, by weak references the init
// script takes in every frame (its document, each wasm memory it
// instantiated, each worker it made), alive or collected, the current
// frame's apart from the destroyed ones'; and each process's private
// footprint (macOS `footprint`), the renderers and the GPU process. The
// number Chrome's tab hover card shows as "Memory usage" is the tab's
// renderer's, found after each navigation as the renderer whose CPU time
// rises while the page spins (`tabRenderer`). With `--gc`, a forced
// collection (twice, so weak references clear) before every reading;
// without, only on leaving each route and before the last. A reading that
// fails, or a frame that fails, is a problem: the run exits non-zero.
//
// Usage: node apps/observatory/perf/session-memory.ts [--gc] [--dwell 5]
//          [--idle-minutes 10] [--label session-memory]
// Run `just observatory builds` first.

import { execFile } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { chromium, type Browser, type Page } from '@playwright/test';
import { flag, machineInfo, option } from '../../../shared-web/perf/protocol.ts';
import { MARKS } from '../contenders/contract.ts';
import { memoryOf, type MemoryEntry } from '../metrics/metrics.ts';
import { SCENARIOS, type Scenario } from '../contenders/scenarios.ts';
import { COMPONENTS, scenarioPath } from '../web/src/components.ts';
import { perfDir, problems, protocolContext, servePage } from './harness.ts';
import { MEMORY_ARGS, collectGarbage } from './memory-reading.ts';

const forceEach = flag('gc');
const dwellMs = Number(option('dwell') ?? 5) * 1000;
const idleMs = Number(option('idle-minutes') ?? 10) * 60_000;
const label = option('label') ?? `session-memory${forceEach ? '-gc' : ''}`;
const PORT = forceEach ? 4380 : 4379;
const IDLE_EVERY_MS = 30_000;
const TALL_TABLE = COMPONENTS.find((component) => component.id === 'tall-table')!;
const run = promisify(execFile);

/** Init script, every frame: weak references to what each frame makes,
 *  kept on the top window (reset with each top document), and the marks
 *  the frames relay to the page, with each frame's creation. */
function tracker(): void {
  type Tracked = { kind: 'document' | 'wasm' | 'worker'; frame: number; url: string; ref: WeakRef<object> };
  type Top = typeof globalThis & { __tracked: Tracked[]; __frameSerial: number; __relayed: { name: string; at: number; source: string }[]; __created: number[]; __track: (kind: Tracked['kind'], frame: number, url: string, target: object) => void };
  const top = window.top as unknown as Top;
  const self = globalThis as typeof globalThis & { __frameId?: number };
  if (window === window.top) {
    top.__tracked = [];
    top.__frameSerial = 0;
    top.__relayed = [];
    top.__created = [];
    addEventListener('message', (event) => {
      if (event.origin !== location.origin || event.data?.seiza !== 'mark') return;
      const frame = [...document.querySelectorAll('iframe')].find((candidate) => candidate.contentWindow === event.source);
      top.__relayed.push({ name: event.data.name, at: performance.now(), source: frame?.src ?? 'unknown' });
    });
    new MutationObserver((mutations) => {
      for (const mutation of mutations) for (const node of mutation.addedNodes) if (node instanceof HTMLIFrameElement) top.__created.push(performance.now());
    }).observe(document, { childList: true, subtree: true });
    self.__frameId = 0;
  } else {
    self.__frameId = ++top.__frameSerial;
  }
  const frame = self.__frameId!;
  const url = location.pathname + location.search;
  // The record and its WeakRef are made by the top's function, in the top's
  // realm: an object a frame's realm made, held by the top, keeps that
  // frame's realm (its window, its document) alive.
  if (window === window.top) top.__track = (kind, frame, url, target) => void top.__tracked.push({ kind, frame, url, ref: new WeakRef(target) });
  const track = (kind: Tracked['kind'], target: object) => top.__track(kind, frame, url, target);
  if (frame) track('document', document);
  // `memory-reading.ts`'s `wasmRecorder` hook, each frame's memories to the
  // top's records: an init script is serialized alone, so it can't call it.
  const keep = (result: WebAssembly.WebAssemblyInstantiatedSource | WebAssembly.Instance) => {
    const instance = 'instance' in result ? result.instance : result;
    for (const value of Object.values(instance.exports)) if (value instanceof WebAssembly.Memory) track('wasm', value);
    return result;
  };
  const streaming = WebAssembly.instantiateStreaming;
  WebAssembly.instantiateStreaming = (...args) => streaming(...args).then(keep) as never;
  const instantiate = WebAssembly.instantiate;
  WebAssembly.instantiate = ((...args: Parameters<typeof instantiate>) => instantiate(...args).then(keep)) as typeof instantiate;
  const Base = Worker;
  globalThis.Worker = class extends Base {
    constructor(...args: ConstructorParameters<typeof Worker>) {
      super(...args);
      track('worker', this);
    }
  };
}

interface Reading {
  atS: number;
  step: string;
  forced: boolean;
  breakdown: {
    totalMiB: number;
    topMiB: number;
    framesMiB: number;
    workersMiB: number;
    unattributedMiB: number;
    byType: Record<string, number>;
    workers: { url: string; mib: number }[];
    frames: { url: string; mib: number }[];
  } | null;
  tracked: {
    currentFrame: number;
    framesCreated: number;
    destroyedAlive: { documents: number; wasm: number; wasmMiB: number; workers: number; frames: number[] };
    current: { wasm: number; wasmMiB: number; workers: number };
  } | null;
  processes: { type: string; pid: number; footprintMiB: number | null }[];
  tabPid: number | null;
  tabRendererMiB: number | null;
  gpuMiB: number | null;
}

const mib = (bytes: number) => Math.round((bytes / 2 ** 20) * 10) / 10;
/** The run's own failures: a reading that didn't happen, a frame that failed. */
const failures: string[] = [];

async function processInfo(browser: Browser): Promise<{ type: string; id: number; cpuTime: number }[]> {
  const cdp = await browser.newBrowserCDPSession();
  const { processInfo } = (await cdp.send('SystemInfo.getProcessInfo')) as { processInfo: { type: string; id: number; cpuTime: number }[] };
  await cdp.detach();
  return processInfo;
}

/** The tab's renderer: the one whose CPU time rises by most of the 300 ms
 *  the page spins (the spare renderers idle). Null, and a failure, if none
 *  rose by half of it. */
async function tabRenderer(browser: Browser, page: Page, step: string): Promise<number | null> {
  const before = new Map((await processInfo(browser)).filter((process) => process.type === 'renderer').map((process) => [process.id, process.cpuTime]));
  await page.evaluate(() => {
    const end = performance.now() + 300;
    while (performance.now() < end);
  });
  const rose = (await processInfo(browser))
    .filter((process) => process.type === 'renderer' && before.has(process.id))
    .map((process) => ({ pid: process.id, by: process.cpuTime - before.get(process.id)! }))
    .sort((a, b) => b.by - a.by)[0];
  if (!rose || rose.by < 0.15) {
    failures.push(`${step}: no renderer's CPU time rose while the page spun (most ${rose?.by.toFixed(3) ?? 'none'} s)`);
    return null;
  }
  return rose.pid;
}

async function footprints(browser: Browser, step: string): Promise<Reading['processes']> {
  const wanted = (await processInfo(browser)).filter((process) => process.type === 'renderer' || process.type === 'GPU');
  return Promise.all(
    wanted.map(async (process) => {
      try {
        const { stdout } = await run('footprint', ['-p', String(process.id), '-j', '/dev/stdout']);
        const json = JSON.parse(stdout.slice(stdout.indexOf('{'))) as { processes: { footprint: number }[] };
        return { type: process.type, pid: process.id, footprintMiB: mib(json.processes[0]!.footprint) };
      } catch (error) {
        failures.push(`${step}: footprint of ${process.type} ${process.id}: ${(error as Error).message}`);
        return { type: process.type, pid: process.id, footprintMiB: null };
      }
    }),
  );
}

async function breakdownOf(page: Page, step: string): Promise<Reading['breakdown']> {
  let entries: MemoryEntry[];
  try {
    entries = await page.evaluate(async () => (await (performance as Performance & { measureUserAgentSpecificMemory(): Promise<{ breakdown: MemoryEntry[] }> }).measureUserAgentSpecificMemory()).breakdown);
  } catch (error) {
    failures.push(`${step}: measureUserAgentSpecificMemory: ${(error as Error).message}`);
    return null;
  }
  // The top window apart from its frames, as `memoryOf` splits a page.
  const top = page.url();
  const isTop = (url: string) => url === top;
  const { pageBytes: topBytes, workerBytes } = memoryOf(entries, isTop);
  const framesBytes = memoryOf(entries, (url) => !isTop(url)).pageBytes;
  const total = entries.reduce((sum, entry) => sum + entry.bytes, 0);
  const byType: Record<string, number> = {};
  const workers = new Map<string, number>();
  const frames = new Map<string, number>();
  const add = (map: Map<string, number>, url: string | undefined, bytes: number) => {
    const path = url ? new URL(url).pathname : 'unknown';
    map.set(path, (map.get(path) ?? 0) + bytes);
  };
  for (const entry of entries) {
    const type = entry.types?.join('+') || 'untyped';
    byType[type] = (byType[type] ?? 0) + entry.bytes;
    const frame = entry.attribution.find((attribution) => attribution.scope === 'Window' && !isTop(attribution.url ?? ''));
    const worker = entry.attribution.find((attribution) => attribution.scope.endsWith('WorkerGlobalScope'));
    if (frame && !entry.attribution.some((attribution) => attribution.scope === 'Window' && isTop(attribution.url ?? ''))) add(frames, frame.url, entry.bytes);
    else if (worker && !entry.attribution.some((attribution) => attribution.scope === 'Window')) add(workers, worker.url, entry.bytes);
  }
  const list = (map: Map<string, number>) => [...map].map(([url, bytes]) => ({ url, mib: mib(bytes) })).sort((a, b) => b.mib - a.mib);
  return {
    totalMiB: mib(total),
    topMiB: mib(topBytes),
    framesMiB: mib(framesBytes),
    workersMiB: mib(workerBytes),
    unattributedMiB: mib(total - topBytes - framesBytes - workerBytes),
    byType: Object.fromEntries(Object.entries(byType).map(([type, bytes]) => [type, mib(bytes)])),
    workers: list(workers),
    frames: list(frames),
  };
}

async function trackedOf(page: Page, step: string): Promise<Reading['tracked']> {
  try {
    const { currentFrame, framesCreated, destroyed, current } = await page.evaluate(() => {
      type Tracked = { kind: string; frame: number; url: string; ref: WeakRef<object> };
      const g = globalThis as typeof globalThis & { __tracked?: Tracked[]; __frameSerial?: number };
      if (!g.__tracked) throw new Error('the tracker isn\'t installed');
      const iframe = document.querySelector('iframe');
      const currentFrame = (iframe?.contentWindow as (Window & { __frameId?: number }) | null)?.__frameId ?? -1;
      const destroyed = { documents: 0, wasm: 0, wasmBytes: 0, workers: 0, frames: new Set<number>() };
      const current = { wasm: 0, wasmBytes: 0, workers: 0 };
      for (const item of g.__tracked) {
        const target = item.ref.deref();
        if (!target || item.frame === 0) continue;
        const bytes = item.kind === 'wasm' ? (target as WebAssembly.Memory).buffer.byteLength : 0;
        if (item.frame === currentFrame) {
          if (item.kind === 'wasm') (current.wasm++, (current.wasmBytes += bytes));
          if (item.kind === 'worker') current.workers++;
        } else {
          destroyed.frames.add(item.frame);
          if (item.kind === 'document') destroyed.documents++;
          if (item.kind === 'wasm') (destroyed.wasm++, (destroyed.wasmBytes += bytes));
          if (item.kind === 'worker') destroyed.workers++;
        }
      }
      return { currentFrame, framesCreated: g.__frameSerial ?? 0, destroyed: { ...destroyed, frames: [...destroyed.frames] }, current };
    });
    if (iframeExpected && currentFrame < 1) failures.push(`${step}: the shown frame has no tracker id`);
    return {
      currentFrame,
      framesCreated,
      destroyedAlive: { documents: destroyed.documents, wasm: destroyed.wasm, wasmMiB: mib(destroyed.wasmBytes), workers: destroyed.workers, frames: destroyed.frames },
      current: { wasm: current.wasm, wasmMiB: mib(current.wasmBytes), workers: current.workers },
    };
  } catch (error) {
    failures.push(`${step}: the tracker's records: ${(error as Error).message}`);
    return null;
  }
}

const started = Date.now();
const readings: Reading[] = [];
/** The tab's renderer, found after each navigation. */
let tabPid: number | null = null;
/** A scenario's route is shown: its reading must find the shown frame. */
let iframeExpected = false;

async function read(browser: Browser, page: Page, step: string, force = forceEach): Promise<void> {
  if (force) await collectGarbage({ context: page.context(), page }, 2);
  // One after another: the footprint isn't read while the page measures.
  const breakdown = await breakdownOf(page, step);
  const tracked = await trackedOf(page, step);
  const processes = await footprints(browser, step);
  const tab = processes.find((process) => process.pid === tabPid);
  if (tabPid !== null && !tab) failures.push(`${step}: the tab's renderer ${tabPid} is gone`);
  const reading: Reading = {
    atS: Math.round((Date.now() - started) / 1000),
    step,
    forced: force,
    breakdown,
    tracked,
    processes,
    tabPid,
    tabRendererMiB: tab?.footprintMiB ?? null,
    gpuMiB: processes.find((process) => process.type === 'GPU')?.footprintMiB ?? null,
  };
  readings.push(reading);
  const left = tracked ? ` | destroyed frames alive: ${tracked.destroyedAlive.documents} docs, ${tracked.destroyedAlive.wasm} wasm (${tracked.destroyedAlive.wasmMiB} MiB), ${tracked.destroyedAlive.workers} workers of ${tracked.framesCreated} frames` : ' | tracker: no reading';
  console.log(
    `${String(reading.atS).padStart(5)} s ${step.padEnd(40)} renderer ${reading.tabRendererMiB} MiB, GPU ${reading.gpuMiB} MiB | measured ${breakdown?.totalMiB ?? '?'} MiB (frames ${breakdown?.framesMiB ?? '?'}, workers ${breakdown?.workersMiB ?? '?'} in ${breakdown?.workers.length ?? '?'}, unattributed ${breakdown?.unattributedMiB ?? '?'})${left}`,
  );
}

/** Whether the shown frame has relayed `contender:failed` since it was created. */
const shownFailed = (page: Page): Promise<boolean> =>
  page.evaluate((failed) => {
    const g = globalThis as unknown as { __created: number[]; __relayed: { name: string; at: number; source: string }[] };
    const createdAt = g.__created.at(-1) ?? 0;
    const src = document.querySelector('iframe')?.src;
    return g.__relayed.some((mark) => mark.at > createdAt && mark.source === src && mark.name === failed);
  }, MARKS.failed);

/** Runs `act`, then waits for a new frame's `contender:filled` (or failed);
 *  `navigates`: `act` loads a new top document, whose counts start at 0. */
async function untilFilled(page: Page, act: () => Promise<unknown>, what: string, navigates = false): Promise<void> {
  const before = navigates ? 0 : await page.evaluate(() => (globalThis as unknown as { __created: number[] }).__created.length);
  await act();
  await page
    .waitForFunction(
      ({ before, filled, failed }) => {
        const g = globalThis as unknown as { __created: number[]; __relayed: { name: string; at: number; source: string }[] };
        if (g.__created.length <= before) return false;
        const createdAt = g.__created.at(-1)!;
        const src = document.querySelector('iframe')?.src;
        return g.__relayed.some((mark) => mark.at > createdAt && mark.source === src && (mark.name === filled || mark.name === failed));
      },
      { before, filled: MARKS.filled, failed: MARKS.failed },
      { timeout: 120_000 },
    )
    .catch(() => {
      throw new Error(`${what}: no contender:filled within 2 min`);
    });
  if (await shownFailed(page)) throw new Error(`${what}: contender:failed`);
}

const pick = (page: Page, side: 'GPUI' | 'TanStack') => page.getByRole('group', { name: 'Contender' }).getByRole('button', { name: side }).click();

const server = await servePage(PORT);
const browser = await chromium.launch({ channel: 'chromium', args: MEMORY_ARGS });
let found: string[] = [];
try {
  const context = await protocolContext(browser, { init: [tracker] });
  const page = await context.newPage();
  found = problems(page);
  const goto = async (path: string) => {
    iframeExpected = false;
    await page.goto(new URL(path, server.url).href);
    await page.waitForLoadState('load');
    tabPid = await tabRenderer(browser, page, path);
  };
  /** `--dwell` on what's shown; a frame that failed meanwhile fails the run. */
  const dwell = async (what = '') => {
    await page.waitForTimeout(dwellMs);
    if (iframeExpected && (await shownFailed(page))) throw new Error(`${what}: contender:failed during the dwell`);
  };

  await goto(server.url);
  await dwell();
  await read(browser, page, 'overview');
  await goto(TALL_TABLE.path);
  await dwell();
  await read(browser, page, 'component page');

  for (const scenario of SCENARIOS as readonly Scenario[]) {
    const route = new URL(scenarioPath(TALL_TABLE, scenario), server.url).href;
    await untilFilled(page, () => page.goto(route), `${scenario.id} open`, true);
    iframeExpected = true;
    tabPid = await tabRenderer(browser, page, scenario.id);
    await dwell(`${scenario.id} open`);
    await read(browser, page, `${scenario.id} ${scenario.defaultStop} gpui`);
    const stops = scenario.stops.map((stop) => stop.id);
    for (const stop of [scenario.defaultStop, ...stops.filter((id) => id !== scenario.defaultStop)]) {
      if (stop !== scenario.defaultStop) {
        await untilFilled(page, () => page.locator(`[data-dial] [data-stop="${stop}"]`).click(), `${scenario.id} ${stop}`);
        await dwell(`${scenario.id} ${stop}`);
        await read(browser, page, `${scenario.id} ${stop} gpui`);
      }
      await untilFilled(page, () => pick(page, 'TanStack'), `${scenario.id} ${stop} → TanStack`);
      await dwell(`${scenario.id} ${stop} tanstack`);
      await read(browser, page, `${scenario.id} ${stop} tanstack`);
      await untilFilled(page, () => pick(page, 'GPUI'), `${scenario.id} ${stop} → GPUI`);
      await dwell(`${scenario.id} ${stop} gpui again`);
      await read(browser, page, `${scenario.id} ${stop} gpui again`);
    }
    // What this route's destroyed frames leave once collected (the route's
    // weak references go with its document at the next navigation).
    if (!forceEach) await read(browser, page, `${scenario.id} leaving, forced`, true);
  }

  await goto(server.url);
  await read(browser, page, 'overview again');
  for (let at = IDLE_EVERY_MS; at <= idleMs; at += IDLE_EVERY_MS) {
    await page.waitForTimeout(IDLE_EVERY_MS);
    await read(browser, page, `idle ${at / 1000} s`);
  }
  await read(browser, page, 'idle end, forced', true);
} finally {
  await browser.close();
  await server.close();
}

const date = new Date().toISOString().slice(0, 10);
const out = join(perfDir, 'results', `${date}-${label}.json`);
mkdirSync(join(perfDir, 'results'), { recursive: true });
const all = [...found, ...failures];
writeFileSync(out, `${JSON.stringify({ date, label, ...machineInfo(), forcedEachReading: forceEach, dwellMs, idleMs, problems: all, readings }, null, 2)}\n`);
console.log(`wrote ${out}`);
if (all.length) {
  console.error(`problems (${all.length}):\n${all.join('\n')}`);
  process.exitCode = 1;
}
