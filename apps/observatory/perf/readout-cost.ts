// What the page's live readouts cost the contender they watch
// (`docs/DECISIONS.md`, "Page", what a visible readout may cost): each
// contender flung (metric-fling.ts's fling, the same profile and input
// path) in four variants, cold, Chromium headless=new at the protocol's
// 1440×900, DPR 2:
// - open, pill, hidden: the page at /observatory/tall-table/?side=<side>,
//   the meter stored open, a pill, or hidden (the status bar in all
//   three), the contender in its frame;
// - bare: the bare contender page.
// Every variant opens the contender with `?measure` (the page's frame gets
// it by an init script), so all four record the same state each frame.
//
// Per run, over the fling (its first input until the view rests at the
// last row, filled): late frames (`underLoad`'s) and the frame recorder's
// own callback time, in the contender's window; from the trace, the
// compositor's frames (Chromium's frame reporter: presented, dropped), the
// GPU process's main-thread time per frame, and, on the page, the top
// frame's own main-thread time (its tasks, style, layout, and paint) per
// refresh; React commits from the page's own root (a DevTools hook in the
// top window only) between the fling's first and last frame; the
// renderer (WebGL2's and WebGPU's adapter), and the contender's open mark,
// whose spread says how quiet the machine was.
//
// The gates, each side on each device: every variant's open-mark spread
// ((max − min) / median) under 6%; late frames, open against hidden and
// bare against hidden, no more than the hidden runs' interquartile range
// or 1 point above them, whichever is larger (a cost: doing better
// passes); the same for TanStack's dropped frames and
// GPUI's GPU-process time (as a share of each refresh), open against
// hidden; the page's own time ≤ 1 ms a refresh on the reference device, ≤
// 4 ms throttled, meter open; no React commit from the page mid-fling in
// any run; no software renderer (else re-run that part with --headed).
// The pill's numbers are gated only when the open meter fails (the
// fallback: the pill becomes the default).
//
// Controls, once per side on the reference device before the runs: a
// forced state change mid-fling (the status bar's Meter pressed) is
// counted as a React commit.
//
// Usage: node apps/observatory/perf/readout-cost.ts [--runs 10]
//          [--side gpui|tanstack] [--profile reference|throttled]
//          [--variants open,pill,hidden,bare] [--headed] [--label <name>]
//          [--from <results.json>,…]
// --from: no runs; the gates applied to results files' runs, a later
// file's side on a device replacing an earlier's (a part re-run).
// Run `just observatory gpui-build`, `tanstack-build`, and `build` first.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Frame, type Page } from '@playwright/test';
import { recorderCost, targetRect, waitMark, wheel } from '../../../shared-web/perf/harness.ts';
import { PROFILES, flag, machineInfo, median, option, throttle, type Profile } from '../../../shared-web/perf/protocol.ts';
import { startThrottlingProxy } from '../../../shared-web/perf/serve.ts';
import { contenderBase, OBSERVATORY } from '../contenders/paths.ts';
import { FLING_FRAMES, ORIGIN_MARK, TRACE_CATEGORIES, Trace, underLoad, type Side, type TraceEvent, type UnderLoad } from '../metrics/metrics.ts';
import { METER_KEY, type MeterMode } from '../web/src/meter.ts';
import { SIDE_PARAM } from '../web/src/components.ts';
import { SIDES, filledState, fling, frameRecorder, frames, inputRecorder, now, stateRecorder, stepsReceived, wheels, type Scope, type Session } from './contender.ts';
import { MARKS, perfDir, problems, protocolContext, servePage } from './harness.ts';

const VARIANTS = ['open', 'pill', 'hidden', 'bare'] as const;
type Variant = (typeof VARIANTS)[number];
const METER_MODES: Record<Exclude<Variant, 'bare'>, MeterMode> = { open: 'open', pill: 'pill', hidden: 'off' };

const PORT = 4337;
const THROTTLED_PORT = 4338;
const ROUTE = `${OBSERVATORY}tall-table/`;
/** The idle time after the view rests, as metric-fling.ts's. */
const TAIL_MS = 500;
/** The gates (`docs/DECISIONS.md`, "Page", what a visible readout may cost). */
const SPREAD = 0.06;
const POINT = 1;
const OWN_MS: Record<string, number> = { reference: 1, throttled: 4 };

// ---------------------------------------------------------------- in the page

/** Init script, the top window only: a React DevTools hook that counts the
 *  page's commits (epoch ms). The contender's frame has its own window,
 *  and no hook. */
function reactCommits(): void {
  if (window !== window.top) return;
  const commits: number[] = [];
  let renderers = 0;
  (globalThis as { __pageCommits?: number[] }).__pageCommits = commits;
  (globalThis as { __REACT_DEVTOOLS_GLOBAL_HOOK__?: object }).__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    renderers: new Map(),
    supportsFiber: true,
    isDisabled: false,
    checkDCE() {},
    inject() {
      return ++renderers;
    },
    onCommitFiberRoot() {
      commits.push(performance.timeOrigin + performance.now());
    },
    onCommitFiberUnmount() {},
    onPostCommitFiberRoot() {},
    onScheduleFiberRoot() {},
  };
}

/** Init script content: `scripts` run only in the contender's window (the
 *  bare page, or the page's frame), and `?measure` added there before its
 *  own scripts read it. */
function inContender(base: string, scripts: (() => void)[]): string {
  return `if (location.pathname === ${JSON.stringify(base)}) {
  if (!new URLSearchParams(location.search).has('measure')) history.replaceState(history.state, '', location.pathname + (location.search ? location.search + '&' : '?') + 'measure' + location.hash);
  ${scripts.map((script) => `(${script.toString()})();`).join('\n  ')}
}`;
}

/** What draws: WebGL2's renderer and WebGPU's adapter, and whether either
 *  is a software one. */
async function renderer(scope: Scope): Promise<{ webgl: string | null; webgpu: string | null; software: boolean }> {
  return scope.evaluate(async () => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const info = gl?.getExtension('WEBGL_debug_renderer_info');
    const webgl = info ? String(gl!.getParameter(info.UNMASKED_RENDERER_WEBGL)) : null;
    type Adapter = { info?: { vendor?: string; architecture?: string; description?: string; isFallbackAdapter?: boolean } };
    const adapter = (await (navigator as { gpu?: { requestAdapter(): Promise<Adapter | null> } }).gpu?.requestAdapter()) ?? null;
    const webgpu = adapter ? [adapter.info?.vendor, adapter.info?.architecture, adapter.info?.description].filter(Boolean).join(' ') : null;
    const software = /swiftshader|llvmpipe|software|basic render/i.test(`${webgl} ${webgpu}`) || !!adapter?.info?.isFallbackAdapter;
    return { webgl, webgpu, software };
  });
}

// ---------------------------------------------------------------- the trace

/** Thread names by `pid:tid`, from the trace's metadata. */
function threadNames(trace: Trace): Map<string, string> {
  const names = new Map<string, string>();
  for (const event of trace.events) if (event.ph === 'M' && event.name === 'thread_name') names.set(`${event.pid}:${event.tid}`, event.args?.name);
  return names;
}

/** The total length of `spans` (trace µs) with overlaps counted once, ms. */
function covered(spans: [number, number][]): number {
  let total = 0;
  let end = -Infinity;
  for (const [from, to] of [...spans].sort((a, b) => a[0] - b[0])) {
    if (to <= end) continue;
    total += to - Math.max(from, end);
    end = to;
  }
  return total / 1000;
}

/** Chromium's frame reporter (`PipelineReporter`) in the page's renderer,
 *  for the display frames (vsyncs) that began between two trace times. A
 *  vsync can have more than one reporter (the compositor's and the main
 *  thread's): it was presented if any presented (in part, if only in
 *  part), dropped if one dropped and none presented. The dropped share is
 *  of the vsyncs that presented or dropped (one with no update wanted is
 *  neither). */
function compositorFrames(trace: Trace, from: number, to: number): { presented: number; partial: number; dropped: number; droppedShare: number } {
  const vsyncs = new Map<string, Set<string>>();
  for (const event of trace.events) {
    if (event.name !== 'PipelineReporter' || event.ph !== 'b' || event.pid !== trace.main.pid || event.ts < from || event.ts > to) continue;
    const reporter = event.args?.frame_reporter as { state?: string; frame_source?: number; frame_sequence?: number } | undefined;
    if (!reporter?.state) continue;
    const key = `${reporter.frame_source}:${reporter.frame_sequence}`;
    vsyncs.set(key, (vsyncs.get(key) ?? new Set()).add(reporter.state));
  }
  let presented = 0;
  let partial = 0;
  let dropped = 0;
  for (const states of vsyncs.values()) {
    if (states.has('STATE_PRESENTED_ALL')) presented++;
    else if (states.has('STATE_PRESENTED_PARTIAL')) (presented++, partial++);
    else if (states.has('STATE_DROPPED')) dropped++;
  }
  return { presented, partial, dropped, droppedShare: presented + dropped ? dropped / (presented + dropped) : 0 };
}

/** The GPU process's main thread (`CrGpuMain`): its tasks' time between two
 *  trace times, ms. */
function gpuProcessMs(trace: Trace, names: Map<string, string>, from: number, to: number): number {
  const spans: [number, number][] = [];
  for (const event of trace.events)
    if (event.ph === 'X' && event.name === 'ThreadControllerImpl::RunTask' && names.get(`${event.pid}:${event.tid}`) === 'CrGpuMain' && event.ts >= from && event.ts <= to) spans.push([event.ts, event.ts + (event.dur ?? 0)]);
  return covered(spans);
}

/** The frame an event belongs to, where the trace says. */
const frameOf = (event: TraceEvent): string | undefined => event.args?.data?.frame ?? event.args?.beginData?.frame ?? event.args?.frame;

/** The frame tree's rendering, which the trace puts on the top frame
 *  however much of it is the contender's frame. */
const TREE_PHASES = new Set(['Paint', 'PrePaint', 'Layerize', 'UpdateLayer', 'CompositeLayers']);
/** The page's refresh: its timers, and the style and layout they force. */
const REFRESH_EVENTS = new Set(['TimerFire', 'Layout', 'UpdateLayoutTree']);

/** The page's own main-thread time between two trace times: each event the
 *  trace names the top frame on, overlaps once, but the frame tree's
 *  rendering (`TREE_PHASES`). Its refreshes (its timers, with the style and
 *  layout of the top frame) and the rest, its recording (the listeners on
 *  the frame's window, its rAF loop, the marks relayed), ms; and its
 *  longest timer. */
function topFrameMs(trace: Trace, top: string, from: number, to: number): { refreshMs: number; refreshes: number; recordingMs: number; longestTimerMs: number } {
  const all: [number, number][] = [];
  const refresh: [number, number][] = [];
  let refreshes = 0;
  let longestTimerMs = 0;
  for (const event of trace.mainThread(from, to)) {
    if (frameOf(event) !== top || TREE_PHASES.has(event.name)) continue;
    const span: [number, number] = [event.ts, event.ts + (event.dur ?? 0)];
    all.push(span);
    if (REFRESH_EVENTS.has(event.name)) refresh.push(span);
    if (event.name === 'TimerFire') {
      refreshes++;
      longestTimerMs = Math.max(longestTimerMs, (event.dur ?? 0) / 1000);
    }
  }
  const refreshMs = covered(refresh);
  return { refreshMs, refreshes, recordingMs: covered(all) - refreshMs, longestTimerMs };
}

/** The top frame's id, as the trace names frames (DevTools' frame ids). */
async function topFrameId(page: Page): Promise<string> {
  const cdp = await page.context().newCDPSession(page);
  const { frameTree } = (await cdp.send('Page.getFrameTree')) as { frameTree: { frame: { id: string } } };
  await cdp.detach();
  return frameTree.frame.id;
}

// ---------------------------------------------------------------- a run

interface Run extends UnderLoad {
  variant: Variant;
  /** The contender's open mark, its own clock, ms. */
  openMs: number;
  renderer: Awaited<ReturnType<typeof renderer>>;
  /** The frame recorder's own callback time over the fling, ms. */
  recorder: Awaited<ReturnType<typeof recorderCost>>;
  presented: number;
  partial: number;
  dropped: number;
  droppedShare: number;
  /** The GPU process's main thread over the fling: ms per frame, and as a
   *  share of the fling's time (a share of each refresh). */
  gpuMsPerFrame: number;
  gpuShare: number;
  /** The page's own main-thread time over the fling (null on the bare
   *  page): its refreshes, in all and each, its longest timer, and its
   *  recording per frame. */
  pageRefreshes: number | null;
  pageRefreshMs: number | null;
  pageMsPerRefresh: number | null;
  pageLongestTimerMs: number | null;
  pageRecordingMsPerFrame: number | null;
  /** React commits from the page between the fling's first and last frame. */
  pageCommits: number | null;
  flingMs: number;
  failures: string[];
}

async function measure(variant: Variant, side: Side, profile: Profile, origins: Record<string, string>, { headed = false, forceCommit = false } = {}): Promise<Run> {
  const base = contenderBase('tall-table', side);
  const origin = origins[profile.name]!;
  const browser = await chromium.launch({ channel: 'chromium', headless: !headed, ignoreDefaultArgs: ['--hide-scrollbars'] });
  try {
    const context = await protocolContext(browser);
    await context.addInitScript({ content: inContender(base, [inputRecorder, frameRecorder, stateRecorder]) });
    if (variant !== 'bare') {
      await context.addInitScript(reactCommits);
      await context.addInitScript(({ key, mode }) => window === window.top && localStorage.setItem(key, JSON.stringify({ mode, corner: 'br' })), { key: METER_KEY, mode: METER_MODES[variant] });
    }
    const page = await context.newPage();
    const found = problems(page);
    // The network through the proxy (`origins`), the CPU here.
    await throttle(context, page, { ...profile, network: null });
    const url = variant === 'bare' ? new URL(base, origin).href : `${new URL(ROUTE, origin).href}?${SIDE_PARAM}=${side}`;
    await page.goto(url);
    const scope = variant === 'bare' ? page.mainFrame() : await contenderFrame(page, base);
    const openMs = await waitMark(scope, MARKS.open, 0, 180_000);
    await waitMark(scope, MARKS.filled, openMs, 180_000);
    const start = await filledState(scope, 's.first === 0');
    if (variant !== 'bare') await page.locator('[data-status-ready]').waitFor({ timeout: 30_000 });
    if (variant === 'open' || variant === 'pill') await page.locator(`[data-meter="${variant}"]`).waitFor({ timeout: 10_000 });
    const drawn = await renderer(scope);

    // The fling, as metric-fling.ts's: the pointer over the row numbers.
    const [x, y, , h] = await targetRect(scope, 'table');
    const offset = variant === 'bare' ? { x: 0, y: 0 } : (await page.locator('iframe').boundingBox())!;
    await page.mouse.move(offset.x + x - 20, offset.y + y + h / 2);
    if (side === 'gpui') await wheel(page, 0);
    await page.waitForTimeout(250);
    const session: Session = { side, profile, page, context, browser, problems: found, close: () => browser.close() };
    await browser.startTracing(page, { categories: [...TRACE_CATEGORIES, '__metadata'] });
    const from = await scope.evaluate((name) => (performance.mark(name), performance.now()), ORIGIN_MARK);
    const flung = fling(session, start.rows);
    if (forceCommit) {
      await page.waitForTimeout(1000);
      await page.evaluate(() => (document.querySelector('[data-meter-toggle]') as HTMLElement).click());
    }
    const step = await flung;
    const failures: string[] = [];
    await filledState(scope, 's.end === s.rows', 30_000).catch(() => failures.push("the view didn't rest at the last row, filled"));
    await page.waitForTimeout(TAIL_MS);
    const until = await now(scope);
    const trace = new Trace(JSON.parse((await browser.stopTracing()).toString()));

    const inputs = (await wheels(scope)).filter((input) => input.at >= from);
    const steps = await stepsReceived(session, inputs, step);
    if (Math.abs(steps - FLING_FRAMES) > 0.5) failures.push(`the page got ${steps.toFixed(1)} steps' worth of wheel events, ${FLING_FRAMES} sent`);
    const recorded = await frames(scope, from, until);
    const load = underLoad(recorded, inputs, FLING_FRAMES, step, start.top);
    if (!load.reachedEnd) failures.push("the fling didn't end at the last row, filled");
    // The fling's frames: its first input until the view rests (or the last frame).
    const first = inputs[0]?.at ?? from;
    const rested = load.catchUpMs !== null ? (inputs.at(-1)?.at ?? first) + load.catchUpMs : (recorded.at(-1)?.t ?? until);
    const during = recorded.filter((frame) => frame.t >= first && frame.t <= rested);
    const [traceFrom, traceTo] = [trace.toTrace(first), trace.toTrace(rested)];
    const flingMs = rested - first;
    const compositor = compositorFrames(trace, traceFrom, traceTo);
    const gpuMs = gpuProcessMs(trace, threadNames(trace), traceFrom, traceTo);
    const own = variant === 'bare' ? null : topFrameMs(trace, await topFrameId(page), traceFrom, traceTo);
    if (process.env.READOUT_TRACE) writeFileSync(process.env.READOUT_TRACE, JSON.stringify({ top: variant === 'bare' ? null : await topFrameId(page), traceFrom, traceTo, events: trace.events }));
    let pageCommits: number | null = null;
    if (variant !== 'bare') {
      const timeOrigin = await scope.evaluate(() => performance.timeOrigin);
      const [firstFrame, lastFrame] = [timeOrigin + (during[0]?.t ?? first), timeOrigin + (during.at(-1)?.t ?? rested)];
      pageCommits = (await page.evaluate(() => (globalThis as { __pageCommits?: number[] }).__pageCommits ?? [])).filter((at) => at >= firstFrame && at <= lastFrame).length;
    }
    failures.push(...found);
    return {
      variant,
      openMs,
      renderer: drawn,
      ...load,
      recorder: await recorderCost(scope, first, rested),
      ...compositor,
      gpuMsPerFrame: during.length ? gpuMs / during.length : 0,
      gpuShare: flingMs > 0 ? gpuMs / flingMs : 0,
      pageRefreshes: own?.refreshes ?? null,
      pageRefreshMs: own?.refreshMs ?? null,
      pageMsPerRefresh: own ? own.refreshMs / Math.max(1, own.refreshes) : null,
      pageLongestTimerMs: own?.longestTimerMs ?? null,
      pageRecordingMsPerFrame: own && during.length ? own.recordingMs / during.length : null,
      pageCommits,
      flingMs,
      failures,
    };
  } finally {
    await browser.close();
  }
}

/** The page's frame showing the contender at `base`, once it exists. */
async function contenderFrame(page: Page, base: string): Promise<Frame> {
  const deadline = Date.now() + 60_000;
  for (;;) {
    const frame = page.frames().find((candidate) => candidate !== page.mainFrame() && new URL(candidate.url(), 'http://x').pathname === base);
    if (frame) return frame;
    if (Date.now() > deadline) throw new Error(`no frame at ${base} after 60 s`);
    await page.waitForTimeout(50);
  }
}

// ---------------------------------------------------------------- the gates

/** Nearest-rank quartiles' distance (p75 − p25). */
function iqr(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (p: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))]!;
  return sorted.length ? rank(0.75) - rank(0.25) : 0;
}

const spread = (values: number[]) => (values.length ? (Math.max(...values) - Math.min(...values)) / median(values) : 0);
const round = (value: number, digits = 2) => Number(value.toFixed(digits));

interface Comparison {
  metric: string;
  against: string;
  /** Medians, in points (percent) or ms. */
  value: number;
  hidden: number;
  delta: number;
  threshold: number;
  pass: boolean;
}

/** `variant`'s median of `pick` against hidden's: no more than the hidden
 *  runs' interquartile range or 1 point above it, whichever is larger (a
 *  cost: a variant that does better passes). `pick` in points. */
function compare(runs: Record<Variant, Run[]>, variant: Variant, metric: string, pick: (run: Run) => number): Comparison | null {
  const hidden = (runs.hidden ?? []).map(pick);
  const values = (runs[variant] ?? []).map(pick);
  if (!hidden.length || !values.length) return null;
  const threshold = Math.max(iqr(hidden), POINT);
  const delta = median(values) - median(hidden);
  return { metric, against: variant, value: round(median(values)), hidden: round(median(hidden)), delta: round(delta), threshold: round(threshold), pass: delta <= threshold };
}

/** One side on one device: its summaries and its gates' verdicts. */
function judge(side: Side, profile: string, runs: Record<Variant, Run[]>): { summary: Record<string, unknown>; gates: Comparison[]; failures: string[] } {
  const failures: string[] = [];
  const summary: Record<string, unknown> = {};
  for (const variant of VARIANTS) {
    const list = runs[variant] ?? [];
    if (!list.length) continue;
    const m = (pick: (run: Run) => number | null, digits = 2) => {
      const values = list.map(pick).filter((value): value is number => value !== null);
      return values.length ? round(median(values), digits) : null;
    };
    const openSpread = spread(list.map((run) => run.openMs));
    summary[variant] = {
      runs: list.length,
      openSpreadPct: round(openSpread * 100, 1),
      latePct: m((run) => run.lateShare * 100),
      lateIqr: round(iqr(list.map((run) => run.lateShare * 100))),
      frames: m((run) => run.frames, 0),
      recorderMsPerFrame: m((run) => run.recorder.p50, 3),
      recorderMsP95: m((run) => run.recorder.p95, 3),
      recorderMsTotal: m((run) => run.recorder.totalMs),
      presented: m((run) => run.presented, 0),
      partial: m((run) => run.partial, 0),
      dropped: m((run) => run.dropped, 0),
      droppedPct: m((run) => run.droppedShare * 100),
      gpuMsPerFrame: m((run) => run.gpuMsPerFrame, 3),
      gpuPct: m((run) => run.gpuShare * 100),
      pageMsPerRefresh: m((run) => run.pageMsPerRefresh, 3),
      pageMsPerRefreshMax: list.some((run) => run.pageMsPerRefresh !== null) ? round(Math.max(...list.map((run) => run.pageMsPerRefresh ?? 0)), 3) : null,
      pageLongestTimerMs: m((run) => run.pageLongestTimerMs, 3),
      pageRefreshes: m((run) => run.pageRefreshes, 0),
      pageRecordingMsPerFrame: m((run) => run.pageRecordingMsPerFrame, 3),
      pageCommits: list.some((run) => run.pageCommits !== null) ? list.reduce((sum, run) => sum + (run.pageCommits ?? 0), 0) : null,
      renderers: [...new Set(list.map((run) => `${run.renderer.webgpu ?? 'no WebGPU'} | ${run.renderer.webgl ?? 'no WebGL2'}`))],
    };
    if (openSpread >= SPREAD) failures.push(`${side} ${profile} ${variant}: the open mark's spread ${(openSpread * 100).toFixed(1)}% (max ${SPREAD * 100}%): the machine wasn't quiet`);
    if (list.some((run) => run.renderer.software)) failures.push(`${side} ${profile} ${variant}: a software renderer drew it (${JSON.stringify(list.find((run) => run.renderer.software)!.renderer)}): re-run this part with --headed`);
    const commits = list.reduce((sum, run) => sum + (run.pageCommits ?? 0), 0);
    if (commits) failures.push(`${side} ${profile} ${variant}: ${commits} React commits from the page mid-fling`);
  }
  const late = (run: Run) => run.lateShare * 100;
  const gates: (Comparison | null)[] = [compare(runs, 'open', 'late frames', late), compare(runs, 'bare', 'late frames', late)];
  const second = side === 'tanstack' ? compare(runs, 'open', 'dropped frames', (run) => run.droppedShare * 100) : compare(runs, 'open', 'GPU process per refresh', (run) => run.gpuShare * 100);
  gates.push(second);
  const openFailed = gates.some((gate) => gate && gate.against === 'open' && !gate.pass);
  // The fallback: only when the open meter fails is the pill judged.
  if (openFailed) {
    gates.push(compare(runs, 'pill', 'late frames', late));
    gates.push(side === 'tanstack' ? compare(runs, 'pill', 'dropped frames', (run) => run.droppedShare * 100) : compare(runs, 'pill', 'GPU process per refresh', (run) => run.gpuShare * 100));
  }
  for (const gate of gates) if (gate && !gate.pass) failures.push(`${side} ${profile}: ${gate.metric}, ${gate.against} ${gate.value} against hidden ${gate.hidden} (Δ ${gate.delta}, max ${gate.threshold})`);
  const own = (runs.open ?? []).map((run) => run.pageMsPerRefresh).filter((value): value is number => value !== null);
  if (own.length) {
    const ownMs = median(own);
    summary.pageMsPerRefreshOpen = round(ownMs, 3);
    if (ownMs > OWN_MS[profile]!) failures.push(`${side} ${profile}: the page's own time ${ownMs.toFixed(2)} ms a refresh, meter open (max ${OWN_MS[profile]} ms)`);
  }
  return { summary, gates: gates.filter((gate): gate is Comparison => gate !== null), failures };
}

// ---------------------------------------------------------------- the runs

const runs = Number(option('runs') ?? 10);
const sides = option('side') ? [option('side') as Side] : SIDES;
const profiles = option('profile') ? PROFILES.filter((profile) => profile.name === option('profile')) : PROFILES;
const variants = (option('variants')?.split(',') ?? VARIANTS) as Variant[];
const headed = flag('headed');
const label = option('label');
if (!sides.every((side) => SIDES.includes(side))) throw new Error(`--side ${option('side')}: gpui or tanstack`);
if (!profiles.length) throw new Error(`--profile ${option('profile')}: reference or throttled`);
if (!variants.every((variant) => VARIANTS.includes(variant))) throw new Error(`--variants ${option('variants')}: of ${VARIANTS.join(',')}`);

const failures: string[] = [];
const output: Record<string, unknown> = { date: new Date().toISOString().slice(0, 10), label, metric: 'readout-cost', ...machineInfo(), headed, runs, variants, flingFrames: FLING_FRAMES, profiles: {}, controls: {} };

/** One side on one device, judged and printed: what the results file keeps. */
function judged(side: Side, profile: string, results: Record<Variant, Run[]>): Record<string, unknown> {
  const verdict = judge(side, profile, results);
  failures.push(...verdict.failures);
  console.log(`\n${profile} ${side}: ${JSON.stringify(verdict.summary)}`);
  for (const gate of verdict.gates) console.log(`  ${gate.pass ? 'PASS' : 'FAIL'} ${gate.metric}: ${gate.against} ${gate.value} against hidden ${gate.hidden} (Δ ${gate.delta}, max ${gate.threshold})`);
  return { ...verdict, runs: results };
}

type Results = { profiles: Record<string, Record<Side, { runs: Record<Variant, Run[]> }>>; controls: Record<string, unknown> };
const from = option('from')?.split(',');
if (from) {
  // The gates on saved runs: each file's sides by device, later files winning.
  const merged: Record<string, Partial<Record<Side, Record<Variant, Run[]>>>> = {};
  for (const file of from) {
    const results = JSON.parse(readFileSync(file, 'utf8')) as Results;
    Object.assign(output.controls as object, results.controls);
    for (const [profile, bySide] of Object.entries(results.profiles)) for (const [side, { runs }] of Object.entries(bySide)) (merged[profile] ??= {})[side as Side] = runs;
  }
  output.from = from.map((file) => file.slice(file.lastIndexOf('/') + 1));
  for (const profile of profiles) {
    const bySide: Record<string, unknown> = {};
    for (const side of sides) {
      const results = merged[profile.name]?.[side];
      if (!results) continue;
      for (const [variant, list] of Object.entries(results)) list.forEach((run, index) => failures.push(...run.failures.map((failure) => `${profile.name} ${side} ${variant} run ${index + 1}: ${failure}`)));
      bySide[side] = judged(side, profile.name, results);
    }
    (output.profiles as Record<string, unknown>)[profile.name] = bySide;
  }
} else {
  const server = await servePage(PORT);
  // The throttled device's network: the proxy, for every variant alike (its
  // comment says why Chromium's own can't be used here).
  const throttledNetwork = PROFILES.find((profile) => profile.name === 'throttled')!.network!;
  const shaper = await startThrottlingProxy(THROTTLED_PORT, PORT, throttledNetwork);
  const origins: Record<string, string> = { reference: new URL(server.url).origin, throttled: new URL(shaper.url).origin };
  const brief = (run: Run) =>
    `open ${run.openMs.toFixed(0)} ms, late ${(run.lateShare * 100).toFixed(1)}%, frames ${run.frames}, dropped ${run.dropped}/${run.presented + run.dropped}, GPU ${run.gpuMsPerFrame.toFixed(2)} ms/frame, recorder ${run.recorder.p50.toFixed(3)} ms/frame` +
    (run.pageMsPerRefresh !== null ? `, page ${run.pageMsPerRefresh.toFixed(3)} ms/refresh (${run.pageRefreshes}), recording ${run.pageRecordingMsPerFrame?.toFixed(3)} ms/frame, ${run.pageCommits} commits` : '');
  try {
    // The control: a forced state change mid-fling is counted.
    if (variants.some((variant) => variant !== 'bare') && profiles.some((profile) => profile.name === 'reference'))
      for (const side of sides) {
        const run = await measure('open', side, PROFILES[0]!, origins, { headed, forceCommit: true });
        (output.controls as Record<string, unknown>)[side] = { pageCommits: run.pageCommits };
        const ok = (run.pageCommits ?? 0) > 0;
        console.log(`control ${side}: the Meter pressed mid-fling, ${run.pageCommits} commits counted${ok ? '' : ": the counter can't fail"}`);
        if (!ok) failures.push(`control ${side}: a forced state change mid-fling counted no commit`);
      }
    for (const profile of profiles) {
      const bySide: Record<string, unknown> = {};
      const results = Object.fromEntries(sides.map((side) => [side, {} as Record<Variant, Run[]>])) as Record<Side, Record<Variant, Run[]>>;
      for (let round = 0; round < runs; round++) {
        // Interleaved by round: every variant on each side, the sides and the
        // variants' order rotating.
        const order = round % 2 ? [...sides].reverse() : sides;
        for (const side of order)
          for (let index = 0; index < variants.length; index++) {
            const variant = variants[(index + round) % variants.length]!;
            const where = `${profile.name} ${side} ${variant} run ${round + 1}/${runs}`;
            try {
              const run = await measure(variant, side, profile, origins, { headed });
              (results[side][variant] ??= []).push(run);
              failures.push(...run.failures.map((failure) => `${where}: ${failure}`));
              console.log(`${where}: ${brief(run)}`);
            } catch (error) {
              failures.push(`${where}: ${(error as Error).message.split('\n')[0]}`);
              console.log(`${where}: FAILED: ${(error as Error).message.split('\n')[0]}`);
            }
          }
      }
      for (const side of sides) bySide[side] = judged(side, profile.name, results[side]);
      (output.profiles as Record<string, unknown>)[profile.name] = bySide;
    }
  } finally {
    shaper.close();
    await server.close();
  }
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
