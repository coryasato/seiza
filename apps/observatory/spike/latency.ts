// The input-latency method, tried on both kinds of page in Chromium: Tycho's
// canvas (GPUI, on WebGPU and on WebGL2) and the spike's scaled scroller (the
// DOM). For a key press, a track press, and a wheel event, three readings of
// "input to the first presented frame at the new position":
//
// - EventLatency, from Chromium's trace: the event's own timestamp to the
//   presentation of the frame it reached (every input kind, wheel included).
// - Event Timing: the trace's EventTiming events (unrounded, every event) and
//   the page's PerformanceObserver (rounded to 8 ms, only at 16 ms or more).
// - The probe: a mark set in the first frame that draws the new position (on
//   GPUI right after the task that made its GPU calls, reading the table's
//   probe; on the DOM in a rAF, reading the row under the top edge), tied to
//   that animation frame's presentation in the trace.
// - The compositor (the DOM's native scrolls): the first compositor frame
//   that applied a scroll after the input, and its presentation.
//
// And per-frame work in a fling, read from the trace the same way on both
// sides (each frame's ProxyMain::BeginMainFrame, the main thread's whole
// rendering update), against `workRecorder` on Tycho.

import { chromium, type Page } from '@playwright/test';
import { clickTarget, fling, open, setPanel, targetRect, waitMark, waitOverlay, wheel, workBetween, workRecorder, type Browsing } from '../../../shared-web/perf/harness.ts';
import { median, percentiles, summarize } from '../../../shared-web/perf/protocol.ts';
import { serveTycho } from '../../tycho/perf/harness.ts';
import { nativeWheel, openWithScrollbars, steadyFling } from './input.ts';

/** `dom-wheel-js`: the control, the DOM page with its wheel scrolled from a
 *  main-thread listener (default prevented), as GPUI's is. */
export type Side = 'gpui-webgpu' | 'gpui-webgl2' | 'dom' | 'dom-wheel-js';
const SIDES: Side[] = ['gpui-webgpu', 'gpui-webgl2', 'dom', 'dom-wheel-js'];
export type InputKind = 'key' | 'track' | 'wheel';

const TRACE_CATEGORIES = ['devtools.timeline', 'blink.user_timing', 'toplevel', 'input', 'benchmark', 'latencyInfo'];
/** The latency runs add `cc` for the compositor's own scrolling (verbose, so
 *  not in the work runs). */
const LATENCY_CATEGORIES = [...TRACE_CATEGORIES, 'cc'];
/** The work runs add `blink`, which names a frame's parts and the timers and
 *  message tasks outside frames. */
const WORK_CATEGORIES = [...TRACE_CATEGORIES, 'blink'];
/** Input kinds whose EventLatency is the input's own (not a mouse move before it). */
const LATENCY_TYPES: Record<InputKind, string[]> = {
  key: ['KEY_PRESSED'],
  track: ['MOUSE_PRESSED'],
  wheel: ['MOUSE_WHEEL', 'FIRST_GESTURE_SCROLL_UPDATE', 'GESTURE_SCROLL_UPDATE'],
};
const TIMING_TYPES: Record<InputKind, string | null> = { key: 'keydown', track: 'pointerdown', wheel: null };
/** Set right after tracing starts: the page clock's offset in the trace, and
 *  the page's main thread. */
const ORIGIN_MARK = 'trace:origin';
/** The idle time after each fling, the same on both sides. */
const FLING_TAIL_MS = 500;

// ---------------------------------------------------------------- in the page

/** Event Timing as a page reads it: entries of 16 ms or more, rounded to 8 ms. */
function eventTimingObserver(): void {
  const g = globalThis as { __eventTiming?: { type: string; start: number; duration: number }[] };
  g.__eventTiming = [];
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) g.__eventTiming!.push({ type: entry.name, start: entry.startTime, duration: entry.duration });
  }).observe({ type: 'event', durationThreshold: 16, buffered: true } as PerformanceObserverInit);
}

/** GPUI's probe: after each task that makes GPU calls, the table's top row;
 *  marks `probe:moved` when it changed. Also records the backend in use. */
function gpuiProbe(): void {
  const g = globalThis as { __tychoTable?: { top: number }; __probeBackend?: string };
  let last: number | null = null;
  let pending = false;
  const hook = (proto: object | undefined, names: string[], backend: string) => {
    if (!proto) return;
    const methods = proto as Record<string, (...args: unknown[]) => unknown>;
    for (const name of names) {
      const original = methods[name];
      if (!original) continue;
      methods[name] = function (this: unknown, ...args: unknown[]) {
        g.__probeBackend ??= backend;
        if (!pending) {
          pending = true;
          queueMicrotask(() => {
            pending = false;
            const top = g.__tychoTable?.top;
            if (top === undefined || top === last) return;
            if (last !== null) performance.mark('probe:moved', { detail: top });
            last = top;
          });
        }
        return original.apply(this, args);
      };
    }
  };
  hook(globalThis.WebGL2RenderingContext?.prototype, ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced'], 'webgl2');
  hook((globalThis as { GPUQueue?: { prototype: object } }).GPUQueue?.prototype, ['submit'], 'webgpu');
}

/** The DOM's probe: in every rAF, the content position under the scroller's
 *  top edge (the spike's `?probe` sample); marks `probe:moved` when it changed. */
function domProbe(): void {
  const g = globalThis as { __seizaFrameSample?: () => { shown?: number } };
  let last: number | null = null;
  const tick = () => {
    const shown = g.__seizaFrameSample?.().shown;
    if (shown !== undefined && shown >= 0 && shown !== last) {
      if (last !== null) performance.mark('probe:moved', { detail: shown });
      last = shown;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/** The control's wheel: prevented, and scrolled by the main thread. */
function wheelOnMainThread(): void {
  addEventListener(
    'wheel',
    (event) => {
      const scroller = document.querySelector('.scroller');
      if (!scroller) return;
      event.preventDefault();
      scroller.scrollBy(0, event.deltaY * devicePixelRatio);
    },
    { passive: false, capture: true },
  );
}

/** The backend GPUI draws with, from its first GPU call; then the hooks are
 *  removed, so nothing wraps the GPU calls of a timing run. */
function gpuBackend(): void {
  const g = globalThis as { __probeBackend?: string };
  const hooks: [Record<string, unknown>, string, unknown][] = [];
  const hook = (proto: object | undefined, names: string[], backend: string) => {
    if (!proto) return;
    const methods = proto as Record<string, (...args: unknown[]) => unknown>;
    for (const name of names) {
      const original = methods[name];
      if (!original) continue;
      hooks.push([methods, name, original]);
      methods[name] = function (this: unknown, ...args: unknown[]) {
        g.__probeBackend ??= backend;
        for (const [target, key, value] of hooks) target[key] = value;
        return original.apply(this, args);
      };
    }
  };
  hook(globalThis.WebGL2RenderingContext?.prototype, ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced'], 'webgl2');
  hook((globalThis as { GPUQueue?: { prototype: object } }).GPUQueue?.prototype, ['submit'], 'webgpu');
}

/** No WebGPU: GPUI's `Auto` falls back to WebGL2. */
function hideWebGpu(): void {
  delete (Navigator.prototype as { gpu?: unknown }).gpu;
}

// ---------------------------------------------------------------- the trace

interface TraceEvent {
  name: string;
  cat: string;
  ph: string;
  ts: number;
  dur?: number;
  pid: number;
  tid: number;
  id?: string;
  id2?: { local?: string; global?: string };
  args?: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
}

interface Span {
  begin: TraceEvent;
  end: TraceEvent;
}

/** Async begin/end pairs of one event name, matched by process and id. */
function spans(events: TraceEvent[], name: string): Span[] {
  const open = new Map<string, TraceEvent[]>();
  const out: Span[] = [];
  for (const event of events) {
    if (event.name !== name || (event.ph !== 'b' && event.ph !== 'e')) continue;
    const key = `${event.pid}:${event.id ?? event.id2?.local ?? event.id2?.global}`;
    if (event.ph === 'b') open.set(key, [...(open.get(key) ?? []), event]);
    else {
      const begin = open.get(key)?.shift();
      if (begin) out.push({ begin, end: event });
    }
  }
  return out;
}

class Trace {
  readonly events: TraceEvent[];
  /** Trace µs at page time 0, from `ORIGIN_MARK`. */
  readonly origin: number;
  readonly main: { pid: number; tid: number };
  /** The page's animation frames, in order, and each one's presentation (by its id). */
  private readonly frames: Span[];
  private readonly presentations = new Map<string, number>();

  constructor(buffer: Buffer) {
    this.events = (JSON.parse(buffer.toString()) as { traceEvents: TraceEvent[] }).traceEvents.sort((a, b) => a.ts - b.ts);
    const mark = this.events.find((event) => event.name === ORIGIN_MARK && typeof event.args?.data?.startTime === 'number');
    if (!mark) throw new Error(`trace has no ${ORIGIN_MARK} mark`);
    this.origin = mark.ts - mark.args!.data.startTime * 1000;
    this.main = { pid: mark.pid, tid: mark.tid };
    this.frames = spans(this.events, 'AnimationFrame').filter(({ begin }) => begin.pid === this.main.pid);
    for (const event of this.events)
      if (event.name === 'AnimationFrame::Presentation' && event.args?.id && !this.presentations.has(event.args.id)) this.presentations.set(event.args.id, event.ts);
  }

  marks(pattern: RegExp): TraceEvent[] {
    return this.events.filter((event) => event.cat.includes('blink.user_timing') && pattern.test(event.name) && event.ph !== 'e');
  }

  toTrace(pageMs: number): number {
    return this.origin + pageMs * 1000;
  }

  /** The presentation of the animation frame running at `ts` on the page's
   *  main thread, or null when no animation frame covers it. */
  presentationAt(ts: number): number | null {
    const id = this.frames.find(({ begin, end }) => begin.ts <= ts && ts <= end.ts)?.begin.args?.id;
    return id ? (this.presentations.get(id) ?? null) : null;
  }

  /** The first presentation at or after `ts`. */
  presentationAfter(ts: number): number | null {
    let first: number | null = null;
    for (const at of this.presentations.values()) if (at >= ts && (first === null || at < first)) first = at;
    return first;
  }

  /** Complete ('X') events on the page's main thread between two trace times. */
  mainThread(from: number, to: number): TraceEvent[] {
    return this.events.filter((event) => event.pid === this.main.pid && event.tid === this.main.tid && event.ph === 'X' && event.ts >= from && event.ts <= to);
  }
}

// ---------------------------------------------------------------- one input

export interface Reading {
  side: Side;
  input: InputKind;
  /** EventLatency: the input's type, and its timestamp → the presentation. */
  eventLatency: { type: string; ms: number } | null;
  /** The trace's EventTiming entry (unrounded), and what the page's observer got (null: under 16 ms). */
  eventTiming: { type: string; ms: number; observed: number | null } | null;
  /** Every EventLatency in the input's window that reached a frame, but mouse
   *  moves: its type, ms, and its end against the probe's presentation. */
  allLatencies: { type: string; ms: number; vsProbe: number | null }[];
  /** The input's timestamp → the presentation of the first frame drawn at the new position. */
  probe: { ms: number; inFrame: boolean } | null;
  /** The input's timestamp → the presentation of the first compositor frame
   *  that applied a scroll (`Scroll Delta This Frame`); null when none did
   *  (GPUI draws its own scrolling). Its end against EventLatency's and the probe's. */
  compositor: { ms: number; vsEventLatency: number | null; vsProbe: number | null } | null;
  /** End against the probe's presentation, ms (0: the same frame). */
  eventLatencyVsProbe: number | null;
  eventTimingVsProbe: number | null;
}

function readInputs(trace: Trace, side: Side, input: InputKind, observed: { type: string; start: number; duration: number }[]): Reading[] {
  // `in:end` closes the last input's window.
  const starts = trace.marks(/^in:(\d+|end)$/);
  const latencies = spans(trace.events, 'EventLatency');
  const timings = spans(trace.events, 'EventTiming');
  const moved = trace.marks(/^probe:moved$/);
  const deltas = trace.events.filter((event) => event.name === 'Scroll Delta This Frame' && event.pid === trace.main.pid && event.tid !== trace.main.tid && (event.args?.x || event.args?.y));
  const submits = spans(trace.events, 'SubmitCompositorFrameToPresentationCompositorFrame').filter(({ begin }) => begin.pid === trace.main.pid);
  return starts.slice(0, -1).map((start, index) => {
    const until = starts[index + 1]!.ts;
    const within = (event: TraceEvent) => event.ts >= start.ts && event.ts < until;
    // The first one that reached a frame (it has a display trace id).
    const latency = latencies
      .filter(({ begin }) => within(begin) && LATENCY_TYPES[input].includes(begin.args?.event_latency?.event_type) && begin.args?.event_latency?.display_trace_id !== undefined)
      .sort((a, b) => a.end.ts - b.end.ts)[0];
    const timing = TIMING_TYPES[input] ? timings.find(({ begin }) => within(begin) && begin.args?.data?.type === TIMING_TYPES[input]) : undefined;
    const eventStart = latency?.begin.ts ?? (timing ? trace.toTrace(timing.begin.args!.data.timeStamp) : null);
    const mark = moved.find(within);
    let probe: Reading['probe'] = null;
    let presented: number | null = null;
    if (mark && eventStart !== null) {
      presented = trace.presentationAt(mark.ts);
      const inFrame = presented !== null;
      // Outside an animation frame: the next presentation after the mark.
      presented ??= trace.presentationAfter(mark.ts);
      if (presented !== null) probe = { ms: (presented - eventStart) / 1000, inFrame };
    }
    let eventTiming: Reading['eventTiming'] = null;
    let timingEnd: number | null = null;
    if (timing) {
      const data = timing.begin.args!.data as { type: string; timeStamp: number; duration: number };
      timingEnd = trace.toTrace(data.timeStamp + data.duration);
      const seen = observed.find((entry) => entry.type === data.type && Math.abs(entry.start - data.timeStamp) < 0.5);
      eventTiming = { type: data.type, ms: round(data.duration), observed: seen?.duration ?? null };
    }
    // The frame that applied the delta is the next one submitted.
    const delta = deltas.find(within);
    const shown = delta && submits.find(({ begin }) => begin.ts >= delta.ts);
    const compositor: Reading['compositor'] =
      shown && eventStart !== null
        ? {
            ms: round((shown.end.ts - eventStart) / 1000),
            vsEventLatency: latency ? round((latency.end.ts - shown.end.ts) / 1000) : null,
            vsProbe: presented === null ? null : round((presented - shown.end.ts) / 1000),
          }
        : null;
    const allLatencies = latencies
      .filter(({ begin }) => within(begin) && begin.args?.event_latency?.display_trace_id !== undefined && begin.args?.event_latency?.event_type !== 'MOUSE_MOVED_EVENT')
      .map(({ begin, end }) => ({ type: begin.args!.event_latency.event_type as string, ms: round((end.ts - begin.ts) / 1000), vsProbe: presented === null ? null : round((end.ts - presented) / 1000) }));
    return {
      side,
      input,
      allLatencies,
      eventLatency: latency ? { type: latency.begin.args!.event_latency.event_type, ms: round((latency.end.ts - latency.begin.ts) / 1000) } : null,
      eventTiming,
      probe: probe && { ms: round(probe.ms), inFrame: probe.inFrame },
      compositor,
      eventLatencyVsProbe: latency && presented !== null ? round((latency.end.ts - presented) / 1000) : null,
      eventTimingVsProbe: timingEnd !== null && presented !== null ? round((timingEnd - presented) / 1000) : null,
    };
  });
}

const round = (value: number) => Number(value.toFixed(2));

// ---------------------------------------------------------------- the pages

interface Subject {
  side: Side;
  page: Page;
  /** Page errors and console errors (see the harness's `open`). */
  problems: string[];
  close(): Promise<void>;
  /** Puts the view somewhere in the middle, with room both ways. */
  center(): Promise<void>;
  send(input: InputKind, index: number): Promise<void>;
}

/** Tycho with the asteroids open. `probe`: the latency readings' observer
 *  and probe; without it (timing runs) only a one-shot backend check. */
async function tychoSubject(url: string, side: 'gpui-webgpu' | 'gpui-webgl2', { probe = true, init = [] as (() => void)[] } = {}): Promise<Subject> {
  const hooks = probe ? [eventTimingObserver, gpuiProbe] : [gpuBackend];
  // The hooks last: `gpuBackend` restores the methods it wrapped, so it must
  // wrap any other script's hooks (`workRecorder`'s), not sit under them.
  const browsing = await open(chromium, url, { params: { bench: '' }, init: [...(side === 'gpui-webgl2' ? [hideWebGpu] : []), ...init, ...hooks] });
  const { page } = browsing;
  await waitOverlay(page, 'Parquet ready', /ms$/, 180_000);
  // The panel draws every refresh; the probe and the work are the table's.
  await setPanel(page, false);
  await clickTarget(page, 'try-sample-asteroids');
  await waitMark(page, 'tycho:first-rows', 0, 60_000);
  const backend = await page.evaluate(() => (globalThis as { __probeBackend?: string }).__probeBackend);
  if (backend !== side.slice(5)) throw new Error(`${side}: GPUI drew with ${backend}`);
  const [x, y, w, h] = await targetRect(page, 'table-scroll-track');
  await page.mouse.click(x - 400, y + 100); // focus
  const settle = async (since: number) => {
    await waitMark(page, 'tycho:viewport-filled', since, 5_000).catch(() => null);
    await page.waitForTimeout(250);
  };
  return {
    side,
    page,
    problems: browsing.problems,
    close: () => browsing.close(),
    async center() {
      const since = await page.evaluate(() => performance.now());
      await page.mouse.click(x + w / 2, y + h / 2);
      await page.mouse.move(x - 400, y + h / 2);
      await settle(since);
    },
    async send(input, index) {
      const since = await page.evaluate((index) => (performance.mark(`in:${index}`), performance.now()), index);
      if (input === 'key') await page.keyboard.press(index % 2 ? 'PageUp' : 'PageDown');
      // The component jumps to the press: alternate above and below the middle.
      else if (input === 'track') await page.mouse.click(x + w / 2, y + h * (index % 2 ? 0.4 : 0.6));
      else await wheel(page, index % 2 ? -300 : 300);
      await settle(since);
      if (input === 'track') await page.mouse.move(x - 400, y + h / 2);
    },
  };
}

async function domSubject(url: string, side: 'dom' | 'dom-wheel-js' = 'dom'): Promise<Subject> {
  // As the harness's `open` (Chromium, 1440×900 at DPR 2), with the scrollbar
  // a person sees: Playwright hides it by default.
  const browsing = await openWithScrollbars(chromium, url, {
    params: { bar: 'classic', probe: '' },
    init: [eventTimingObserver, domProbe, ...(side === 'dom-wheel-js' ? [wheelOnMainThread] : [])],
    dpr: 2,
  });
  const { page } = browsing;
  await waitMark(page, 'spike:rows');
  await page.focus('.scroller');
  const thumb = () =>
    page.evaluate(() => {
      const scroller = document.querySelector('.scroller') as HTMLElement;
      const box = scroller.getBoundingClientRect();
      const bar = scroller.offsetWidth - scroller.clientWidth;
      const thumbHeight = Math.max(24, (scroller.clientHeight * scroller.clientHeight) / scroller.scrollHeight);
      const top = box.top + (scroller.scrollTop / (scroller.scrollHeight - scroller.clientHeight)) * (scroller.clientHeight - thumbHeight);
      return { x: box.right - bar / 2, top, bottom: top + thumbHeight, height: scroller.clientHeight };
    });
  const settle = () => page.waitForTimeout(400);
  return {
    side,
    page,
    problems: browsing.problems,
    close: () => browsing.close(),
    async center() {
      await page.evaluate(() => {
        const model = (globalThis as { __spike?: { model?: { jumpTo(v: number): void; total: number } } }).__spike!.model!;
        model.jumpTo(Math.round(model.total / 2 / 30) * 30);
      });
      await page.mouse.move(400, 450);
      await settle();
    },
    async send(input, index) {
      const bar = input === 'track' ? await thumb() : null;
      await page.evaluate((index) => performance.mark(`in:${index}`), index);
      if (input === 'key') await page.keyboard.press(index % 2 ? 'PageUp' : 'PageDown');
      // A press on the track pages toward it: below the thumb, then above.
      else if (input === 'track') await page.mouse.click(bar!.x, index % 2 ? bar!.top - 40 : bar!.bottom + 40);
      else await nativeWheel(page, index % 2 ? -300 : 300);
      await settle();
      if (input === 'track') await page.mouse.move(400, 450);
    },
  };
}

// ---------------------------------------------------------------- scenarios

async function measureInputs(subject: Subject, input: InputKind, count: number): Promise<Reading[]> {
  const { page } = subject;
  await subject.center();
  await page.evaluate(() => ((globalThis as { __eventTiming?: unknown[] }).__eventTiming!.length = 0));
  const browser = page.context().browser()!;
  await browser.startTracing(page, { categories: LATENCY_CATEGORIES });
  await page.evaluate((name) => performance.mark(name), ORIGIN_MARK);
  for (let index = 0; index < count; index++) await subject.send(input, index);
  await page.evaluate(() => performance.mark('in:end'));
  const trace = new Trace(await browser.stopTracing());
  const observed = await page.evaluate(() => (globalThis as { __eventTiming?: { type: string; start: number; duration: number }[] }).__eventTiming!);
  return readInputs(trace, subject.side, input, observed);
}

function summarizeReadings(readings: Reading[]) {
  const values = (pick: (reading: Reading) => number | null | undefined) => readings.map(pick).filter((value): value is number => typeof value === 'number');
  const near = (list: number[], within: number) => list.filter((value) => Math.abs(value) <= within).length;
  const elVsProbe = values((reading) => reading.eventLatencyVsProbe);
  const etVsProbe = values((reading) => reading.eventTimingVsProbe);
  return {
    inputs: readings.length,
    eventLatency: { found: values((reading) => reading.eventLatency?.ms).length, types: [...new Set(readings.map((reading) => reading.eventLatency?.type).filter(Boolean))], ms: percentiles(values((reading) => reading.eventLatency?.ms)) },
    eventTiming: {
      found: values((reading) => reading.eventTiming?.ms).length,
      ms: percentiles(values((reading) => reading.eventTiming?.ms)),
      observedByPage: values((reading) => reading.eventTiming?.observed).length,
    },
    probe: { found: values((reading) => reading.probe?.ms).length, inFrame: readings.filter((reading) => reading.probe?.inFrame).length, ms: percentiles(values((reading) => reading.probe?.ms)) },
    compositor: (() => {
      const vsLatency = values((reading) => reading.compositor?.vsEventLatency);
      const vsProbe = values((reading) => reading.compositor?.vsProbe);
      return {
        found: values((reading) => reading.compositor?.ms).length,
        ms: percentiles(values((reading) => reading.compositor?.ms)),
        // > 0: that reading ends after the compositor's frame; < 0: before it.
        eventLatency: { sameFrame: near(vsLatency, 1), before: vsLatency.filter((value) => value < -1).length, after: vsLatency.filter((value) => value > 1).length },
        probe: { sameFrame: near(vsProbe, 1), before: vsProbe.filter((value) => value < -1).length, after: vsProbe.filter((value) => value > 1).length },
      };
    })(),
    eventLatencyVsProbe: { n: elVsProbe.length, sameFrame: near(elVsProbe, 1), worst: Math.max(0, ...elVsProbe.map(Math.abs)), values: elVsProbe },
    eventTimingVsProbe: { n: etVsProbe.length, sameFrame: near(etVsProbe, 1), worst: Math.max(0, ...etVsProbe.map(Math.abs)), values: etVsProbe },
  };
}

/** Every input kind on every side, `sessions` browsers each, `count` inputs per kind. */
export async function latency(spikeUrl: string, { sessions = 3, count = 10 } = {}) {
  const tycho = await serveTycho(undefined, 4179, { port: 8792, requireObject: 'asteroids.parquet' });
  const readings: Reading[] = [];
  const problems: { side: Side; session: number; problems: string[] }[] = [];
  try {
    for (let session = 0; session < sessions; session++) {
      for (const side of SIDES) {
        console.log(`latency ${side} session ${session + 1}/${sessions}`);
        const subject = side === 'dom' || side === 'dom-wheel-js' ? await domSubject(spikeUrl, side) : await tychoSubject(tycho.url, side);
        // The control changes only the wheel.
        const inputs: InputKind[] = side === 'dom-wheel-js' ? ['wheel'] : ['key', 'track', 'wheel'];
        try {
          for (const input of inputs) readings.push(...(await measureInputs(subject, input, count)));
        } finally {
          if (subject.problems.length) console.log(`${side} problems: ${subject.problems.join(' | ')}`);
          problems.push({ side, session: session + 1, problems: [...subject.problems] });
          await subject.close();
        }
      }
    }
  } finally {
    await tycho.close();
  }
  const summary: Record<string, unknown> = {};
  for (const side of SIDES)
    for (const input of ['key', 'track', 'wheel'] as InputKind[]) {
      const some = readings.filter((reading) => reading.side === side && reading.input === input);
      if (some.length) summary[`${side} ${input}`] = summarizeReadings(some);
    }
  return { profile: 'reference (Chromium, 1440×900 at DPR 2), warm', sessions, inputsPerKind: count, categories: LATENCY_CATEGORIES, summary, problems, readings };
}

// ---------------------------------------------------------------- per-frame work

/** A main-thread event with the events nested in it (by time, same thread). */
interface Node {
  event: TraceEvent;
  children: Node[];
}

/** The main thread's complete events between two trace times, as trees of tasks. */
function taskTrees(trace: Trace, from: number, to: number): Node[] {
  const events = trace.mainThread(from, to).sort((a, b) => a.ts - b.ts || (b.dur ?? 0) - (a.dur ?? 0));
  const roots: Node[] = [];
  const stack: Node[] = [];
  for (const event of events) {
    const end = event.ts + (event.dur ?? 0);
    while (stack.length && stack.at(-1)!.event.ts + (stack.at(-1)!.event.dur ?? 0) < end) stack.pop();
    const node = { event, children: [] };
    (stack.at(-1)?.children ?? roots).push(node);
    stack.push(node);
  }
  return roots;
}

function find(node: Node, name: string): Node | null {
  if (node.event.name === name) return node;
  for (const child of node.children) {
    const found = find(child, name);
    if (found) return found;
  }
  return null;
}

function total(node: Node, name: string): number {
  return (node.event.name === name ? (node.event.dur ?? 0) / 1000 : 0) + (node.event.name === name ? 0 : node.children.reduce((sum, child) => sum + total(child, name), 0));
}

/** What a task outside any frame was: its first descendant that names work,
 *  past the scheduler's wrappers. */
function taskKind(node: Node): string {
  if (!WRAPPER.test(node.event.name)) return node.event.name;
  for (const child of [...node.children].sort((a, b) => (b.event.dur ?? 0) - (a.event.dur ?? 0))) {
    const kind = taskKind(child);
    if (kind !== 'other') return kind;
  }
  return 'other';
}

/** The parts of a frame (ProxyMain::BeginMainFrame's own children), which sum to it. */
const FRAME_PARTS: Record<string, string> = {
  'WidgetBaseInputHandler::OnHandleInputEvent': 'input',
  'WebFrameWidgetImpl::BeginMainFrame': 'animate',
  'WebFrameWidgetImpl::UpdateLifecycle': 'lifecycle',
};
const WRAPPER = /RunTask|ThreadController|SequenceManager|Receive mojo|SimpleWatcher|MojoHandle/;

/**
 * Each main frame's rendering update on the page's main thread between two
 * page times: ProxyMain::BeginMainFrame (start, ms), its parts (input
 * dispatched in the frame, animate: the rAF callbacks and scroll events,
 * lifecycle: style, layout, and paint, other: the commit and the rest), and the rAF callbacks
 * alone (FireAnimationFrame, what `workRecorder` times); and the busy time of
 * every task, with the tasks outside any frame tallied by kind.
 */
function framesInTrace(trace: Trace, from: number, to: number) {
  const start = trace.toTrace(from);
  const end = trace.toTrace(to);
  const frames: { ts: number; ms: number; rafMs: number; inputMs: number; parts: Record<string, number> }[] = [];
  const outside: Record<string, number> = {};
  let busy = 0;
  for (const task of taskTrees(trace, start, end)) {
    busy += (task.event.dur ?? 0) / 1000;
    const frame = find(task, 'ProxyMain::BeginMainFrame');
    if (!frame) {
      const kind = taskKind(task);
      outside[kind] = (outside[kind] ?? 0) + (task.event.dur ?? 0) / 1000;
      continue;
    }
    const ms = (frame.event.dur ?? 0) / 1000;
    // `other`: the commit and the frame's own bookkeeping.
    const parts: Record<string, number> = { input: 0, animate: 0, lifecycle: 0, other: ms };
    for (const child of frame.children) {
      const part = FRAME_PARTS[child.event.name];
      if (!part) continue;
      parts[part]! += (child.event.dur ?? 0) / 1000;
      parts.other! -= (child.event.dur ?? 0) / 1000;
    }
    frames.push({ ts: frame.event.ts, ms, rafMs: total(frame, 'FireAnimationFrame'), inputMs: parts.input!, parts });
  }
  const inFrames = frames.reduce((sum, frame) => sum + frame.ms, 0);
  return { frames, busy, inFrames, outside, windowMs: (end - start) / 1000 };
}

/** Per frame (mean ms over the frames), each part of the frame. */
function partsPerFrame(frames: { parts: Record<string, number> }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const frame of frames) for (const [part, ms] of Object.entries(frame.parts)) out[part] = (out[part] ?? 0) + ms / frames.length;
  return Object.fromEntries(Object.entries(out).map(([part, ms]) => [part, round(ms * 1000) / 1000]));
}

/** The busy time outside any frame, by kind (ms), the largest first. */
function outsideByKind(outside: Record<string, number>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(outside)
      .sort((a, b) => b[1] - a[1])
      .map(([kind, ms]) => [kind, round(ms)]),
  );
}

async function tychoFlingWork(url: string) {
  const subject = await tychoSubject(url, 'gpui-webgpu', { probe: false, init: [workRecorder] });
  const { page } = subject;
  try {
    const since = await page.evaluate(() => performance.now());
    await page.keyboard.press('Home');
    await waitMark(page, 'tycho:viewport-filled', since, 10_000).catch(() => null);
    await page.waitForTimeout(300);
    const rows = await page.evaluate(() => (globalThis as { __tychoTable?: { rows: number } }).__tychoTable?.rows ?? 0);
    if (!rows) throw new Error('Tycho shows no table');
    const browser = page.context().browser()!;
    await browser.startTracing(page, { categories: WORK_CATEGORIES });
    await page.evaluate((name) => performance.mark(name), ORIGIN_MARK);
    const { start, end } = await fling(page, rows);
    await page.waitForTimeout(FLING_TAIL_MS);
    const until = await page.evaluate(() => performance.now());
    const trace = new Trace(await browser.stopTracing());
    const recorded = await workBetween(page, start, until);
    if (recorded.length === 0) throw new Error('workRecorder recorded no frames in the fling');
    const { frames, busy, inFrames, outside, windowMs } = framesInTrace(trace, start, until);
    // Each recorded rAF callback in the frame whose BeginMainFrame holds it
    // (both in time order).
    let at = 0;
    const pairs = recorded.flatMap((sample) => {
      const ts = trace.toTrace(sample.t);
      while (at < frames.length && frames[at]!.ts + frames[at]!.ms * 1000 < ts) at++;
      const frame = frames[at];
      return frame && frame.ts <= ts ? [{ recorder: sample.ms, trace: frame.ms, raf: frame.rafMs, input: frame.inputMs }] : [];
    });
    return {
      flingMs: end - start,
      recorder: percentiles(recorded.map((sample) => sample.ms)),
      trace: percentiles(frames.map((frame) => frame.ms)),
      traceRaf: percentiles(pairs.map((pair) => pair.raf)),
      paired: {
        n: pairs.length,
        of: recorded.length,
        difference: percentiles(pairs.map((pair) => pair.trace - pair.recorder)),
        rafDifference: percentiles(pairs.map((pair) => pair.raf - pair.recorder)),
        inputMs: percentiles(pairs.map((pair) => pair.input)),
        restMs: percentiles(pairs.map((pair) => pair.trace - pair.raf - pair.input)),
      },
      parts: partsPerFrame(frames),
      busyPerFrame: busy / Math.max(1, frames.length),
      busyShare: busy / windowMs,
      busyMs: busy,
      outsideFramesMs: busy - inFrames,
      outside: outsideByKind(outside),
      problems: [...subject.problems],
    };
  } finally {
    await subject.close();
  }
}

async function domFlingWork(url: string) {
  const browsing: Browsing = await open(chromium, url, { params: { v: 'window' } });
  const { page } = browsing;
  try {
    await waitMark(page, 'spike:rows');
    await page.focus('.scroller');
    const browser = page.context().browser()!;
    await browser.startTracing(page, { categories: WORK_CATEGORIES });
    const start = await page.evaluate((name) => (performance.mark(name), performance.now()), ORIGIN_MARK);
    await steadyFling(page);
    await page.waitForTimeout(FLING_TAIL_MS);
    const until = await page.evaluate(() => performance.now());
    const trace = new Trace(await browser.stopTracing());
    const { frames, busy, inFrames, outside, windowMs } = framesInTrace(trace, start, until);
    return {
      trace: percentiles(frames.map((frame) => frame.ms)),
      parts: partsPerFrame(frames),
      busyPerFrame: busy / Math.max(1, frames.length),
      busyShare: busy / windowMs,
      busyMs: busy,
      outsideFramesMs: busy - inFrames,
      outside: outsideByKind(outside),
      problems: browsing.problems,
    };
  } finally {
    await browsing.close();
  }
}

/** Each key's median over the runs (a missing key counts as 0), the largest first. */
function medianParts(runs: Record<string, number>[]): Record<string, number> {
  const keys = [...new Set(runs.flatMap((run) => Object.keys(run)))];
  return Object.fromEntries(
    keys
      .map((key) => [key, round(median(runs.map((run) => run[key] ?? 0)) * 1000) / 1000] as [string, number])
      .filter(([, ms]) => ms > 0)
      .sort((a, b) => b[1] - a[1]),
  );
}

/** Per-frame work in a fling, cold, `runs` times per side, sides alternating. */
export async function work(spikeUrl: string, runs: number) {
  const tycho = await serveTycho(undefined, 4179, { port: 8792, requireObject: 'asteroids.parquet' });
  const gpui: Awaited<ReturnType<typeof tychoFlingWork>>[] = [];
  const dom: Awaited<ReturnType<typeof domFlingWork>>[] = [];
  try {
    for (let run = 0; run < runs; run++) {
      const order = run % 2 ? ['dom', 'gpui'] : ['gpui', 'dom'];
      for (const side of order) {
        console.log(`work ${side} run ${run + 1}/${runs}`);
        if (side === 'gpui') gpui.push(await tychoFlingWork(tycho.url));
        else dom.push(await domFlingWork(spikeUrl));
      }
    }
  } finally {
    await tycho.close();
  }
  const pick = <T>(list: T[], read: (run: T) => number, digits = 2) => summarize(list.map(read), digits);
  const recorderP50 = gpui.map((run) => run.recorder.p50);
  const recorderP95 = gpui.map((run) => run.recorder.p95);
  const traceP50 = gpui.map((run) => run.trace.p50);
  const traceP95 = gpui.map((run) => run.trace.p95);
  const rafP50 = gpui.map((run) => run.traceRaf.p50);
  const rafP95 = gpui.map((run) => run.traceRaf.p95);
  const spread = (values: number[]) => Math.max(...values) - Math.min(...values);
  const agrees = (trace: number[], recorder: number[]) => ({
    difference: round(median(trace) - median(recorder)),
    recorderSpread: round(spread(recorder)),
    within: Math.abs(median(trace) - median(recorder)) <= spread(recorder),
  });
  return {
    profile: 'reference (Chromium, 1440×900 at DPR 2), cold',
    runs,
    categories: WORK_CATEGORIES,
    gpui: {
      recorderP50Ms: pick(gpui, (run) => run.recorder.p50),
      recorderP95Ms: pick(gpui, (run) => run.recorder.p95),
      traceP50Ms: pick(gpui, (run) => run.trace.p50),
      traceP95Ms: pick(gpui, (run) => run.trace.p95),
      pairedDifferenceP50Ms: pick(gpui, (run) => run.paired.difference.p50),
      pairedDifferenceP95Ms: pick(gpui, (run) => run.paired.difference.p95),
      pairedShare: pick(gpui, (run) => run.paired.n / Math.max(1, run.paired.of), 3),
      busyPerFrameMs: pick(gpui, (run) => run.busyPerFrame),
      busyShare: pick(gpui, (run) => run.busyShare, 3),
      outsideFramesShare: pick(gpui, (run) => run.outsideFramesMs / run.busyMs, 3),
      partsPerFrameMs: medianParts(gpui.map((run) => run.parts)),
      outsideFramesMs: medianParts(gpui.map((run) => run.outside)),
      traceRafP50Ms: pick(gpui, (run) => run.traceRaf.p50),
      traceRafP95Ms: pick(gpui, (run) => run.traceRaf.p95),
      pairedRafDifferenceP50Ms: pick(gpui, (run) => run.paired.rafDifference.p50, 3),
      pairedInputP50Ms: pick(gpui, (run) => run.paired.inputMs.p50, 3),
      pairedRestP50Ms: pick(gpui, (run) => run.paired.restMs.p50, 3),
      agreementP50: agrees(traceP50, recorderP50),
      agreementP95: agrees(traceP95, recorderP95),
      rafAgreementP50: agrees(rafP50, recorderP50),
      rafAgreementP95: agrees(rafP95, recorderP95),
    },
    dom: {
      traceP50Ms: pick(dom, (run) => run.trace.p50),
      traceP95Ms: pick(dom, (run) => run.trace.p95),
      busyPerFrameMs: pick(dom, (run) => run.busyPerFrame),
      busyShare: pick(dom, (run) => run.busyShare, 3),
      outsideFramesShare: pick(dom, (run) => run.outsideFramesMs / run.busyMs, 3),
      partsPerFrameMs: medianParts(dom.map((run) => run.parts)),
      outsideFramesMs: medianParts(dom.map((run) => run.outside)),
    },
    problems: [...gpui, ...dom].flatMap((run) => run.problems),
    raw: { gpui, dom },
  };
}
