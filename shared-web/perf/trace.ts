/**
 * Chromium's trace and the frames in it, for any app's perf scripts: the
 * page's animation frames and presentations, its marks, and each frame's
 * main-thread work (`frameWork`), from `browser.stopTracing()`'s JSON; and
 * late frames from frame intervals. Pure: no Playwright, Node, or DOM
 * access, so a page's own readouts can use it too (the observatory's
 * metrics module re-exports it).
 */

// ---------------------------------------------------------------- frames

/** One frame at 60 Hz, the reference run's refresh. */
export const FRAME_MS = 1000 / 60;

/** A frame interval past this many refreshes missed at least one: a late frame. */
export const LATE_FACTOR = 1.5;
export const LATE_FRAME_MS = LATE_FACTOR * FRAME_MS;

/** Frame intervals over `LATE_FACTOR` refreshes (`LATE_FRAME_MS` at the
 *  reference run's 60 Hz): their count, and their share of the intervals. */
export function lateFrames(intervals: readonly number[], refreshMs = FRAME_MS): { late: number; share: number } {
  const late = intervals.filter((interval) => interval > LATE_FACTOR * refreshMs).length;
  return { late, share: intervals.length ? late / intervals.length : 0 };
}

// ---------------------------------------------------------------- the trace

/** Trace categories every reading needs: the animation frames and their
 *  presentations, the marks, `EventLatency`, the frames' work, the tasks. */
export const TRACE_CATEGORIES = ['devtools.timeline', 'blink.user_timing', 'toplevel', 'input', 'benchmark', 'latencyInfo'];
/** Input latency adds the compositor's scrolling (verbose: not for work). */
export const LATENCY_CATEGORIES = [...TRACE_CATEGORIES, 'cc'];
/** Work adds the frame's parts and what runs outside frames. */
export const WORK_CATEGORIES = [...TRACE_CATEGORIES, 'blink'];
/** Set right after tracing starts: the page clock's place in the trace,
 *  and the page's main thread. */
export const ORIGIN_MARK = 'trace:origin';

export interface TraceEvent {
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

export interface Span {
  begin: TraceEvent;
  end: TraceEvent;
}

/** Async begin/end pairs of one event name, matched by process and id. */
export function spans(events: readonly TraceEvent[], name: string): Span[] {
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

/** A Chromium trace (`browser.stopTracing()`'s JSON) of one page. */
export class Trace {
  readonly events: TraceEvent[];
  /** Trace µs at page time 0, from `ORIGIN_MARK`. */
  readonly origin: number;
  readonly main: { pid: number; tid: number };
  /** The page's animation frames, in order, and each one's presentation (by id). */
  private readonly frames: Span[];
  private readonly presentations = new Map<string, number>();

  constructor(json: { traceEvents: TraceEvent[] }) {
    this.events = [...json.traceEvents].sort((a, b) => a.ts - b.ts);
    const mark = this.events.find((event) => event.name === ORIGIN_MARK && typeof event.args?.data?.startTime === 'number');
    if (!mark) throw new Error(`trace has no ${ORIGIN_MARK} mark`);
    this.origin = mark.ts - mark.args!.data.startTime * 1000;
    this.main = { pid: mark.pid, tid: mark.tid };
    this.frames = spans(this.events, 'AnimationFrame').filter(({ begin }) => begin.pid === this.main.pid);
    for (const event of this.events)
      if (event.name === 'AnimationFrame::Presentation' && event.args?.id && !this.presentations.has(event.args.id)) this.presentations.set(event.args.id, event.ts);
  }

  /** The page's user-timing marks matching `pattern`. */
  marks(pattern: RegExp): TraceEvent[] {
    return this.events.filter((event) => event.cat.includes('blink.user_timing') && event.pid === this.main.pid && pattern.test(event.name) && event.ph !== 'e');
  }

  /** Page ms → trace µs. */
  toTrace(pageMs: number): number {
    return this.origin + pageMs * 1000;
  }

  /** Trace µs → page ms. */
  toPage(ts: number): number {
    return (ts - this.origin) / 1000;
  }

  /** The presentation of the animation frame running at `ts` on the main
   *  thread, else (a mark right after a frame's task) the next one. */
  presentationOf(ts: number): { at: number; inFrame: boolean } | null {
    const id = this.frames.find(({ begin, end }) => begin.ts <= ts && ts <= end.ts)?.begin.args?.id;
    const at = id ? this.presentations.get(id) : undefined;
    if (at !== undefined) return { at, inFrame: true };
    let next: number | null = null;
    for (const presented of this.presentations.values()) if (presented >= ts && (next === null || presented < next)) next = presented;
    return next === null ? null : { at: next, inFrame: false };
  }

  /** The presentation of the first animation frame that begins at or
   *  after `ts`: the frame that paints what a task outside any frame
   *  changed at `ts` (one already under way was drawn without it). */
  presentationOfFrameAfter(ts: number): number | null {
    // A frame with nothing new to show presents nothing: the next that does.
    for (const { begin } of this.frames) {
      const at = begin.ts >= ts && begin.args?.id ? this.presentations.get(begin.args.id) : undefined;
      if (at !== undefined) return at;
    }
    return null;
  }

  /** Complete ('X') events on the page's main thread between two trace times. */
  mainThread(from: number, to: number): TraceEvent[] {
    return this.events.filter((event) => event.pid === this.main.pid && event.tid === this.main.tid && event.ph === 'X' && event.ts >= from && event.ts <= to);
  }
}

// ---------------------------------------------------------------- per-frame work and CPU

/** A main-thread event with the events nested in it (by time, same thread). */
interface Node {
  event: TraceEvent;
  children: Node[];
}

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

const WRAPPER = /RunTask|ThreadController|SequenceManager|Receive mojo|SimpleWatcher|MojoHandle/;

/** What a task outside any frame was: its first descendant that names
 *  work, past the scheduler's wrappers. */
function taskKind(node: Node): string {
  if (!WRAPPER.test(node.event.name)) return node.event.name;
  for (const child of [...node.children].sort((a, b) => (b.event.dur ?? 0) - (a.event.dur ?? 0))) {
    const kind = taskKind(child);
    if (kind !== 'other') return kind;
  }
  return 'other';
}

/** The parts of a frame (ProxyMain::BeginMainFrame's own children). */
const FRAME_PARTS: Record<string, string> = {
  'WidgetBaseInputHandler::OnHandleInputEvent': 'input',
  'WebFrameWidgetImpl::BeginMainFrame': 'animate',
  'WebFrameWidgetImpl::UpdateLifecycle': 'lifecycle',
};

export interface FrameWork {
  /** Each main frame: its start (page ms), its whole rendering update
   *  (ms), and its parts: input dispatched in it, animate (rAF callbacks,
   *  scroll events), lifecycle (style, layout, paint), other (the commit
   *  and bookkeeping). */
  frames: { at: number; ms: number; parts: Record<string, number> }[];
  /** Main-thread CPU: the busy time of every task, ms. */
  busyMs: number;
  /** Of it, inside frames. */
  inFramesMs: number;
  /** Busy time outside any frame, by kind, ms. */
  outside: Record<string, number>;
  windowMs: number;
}

/**
 * Per-frame work and main-thread CPU between two page times: each frame's
 * `ProxyMain::BeginMainFrame`, itemized, and every task's busy time, the
 * tasks outside any frame tallied by kind (some work runs in no frame, so
 * frames × per-frame work undercounts the CPU).
 */
export function frameWork(trace: Trace, from: number, to: number): FrameWork {
  const start = trace.toTrace(from);
  const end = trace.toTrace(to);
  const frames: FrameWork['frames'] = [];
  const outside: Record<string, number> = {};
  let busyMs = 0;
  for (const task of taskTrees(trace, start, end)) {
    const taskMs = (task.event.dur ?? 0) / 1000;
    busyMs += taskMs;
    const frame = find(task, 'ProxyMain::BeginMainFrame');
    if (!frame) {
      const kind = taskKind(task);
      outside[kind] = (outside[kind] ?? 0) + taskMs;
      continue;
    }
    const ms = (frame.event.dur ?? 0) / 1000;
    const parts: Record<string, number> = { input: 0, animate: 0, lifecycle: 0, other: ms };
    for (const child of frame.children) {
      const part = FRAME_PARTS[child.event.name];
      if (!part) continue;
      parts[part]! += (child.event.dur ?? 0) / 1000;
      parts.other! -= (child.event.dur ?? 0) / 1000;
    }
    frames.push({ at: trace.toPage(frame.event.ts), ms, parts });
  }
  const inFramesMs = frames.reduce((sum, frame) => sum + frame.ms, 0);
  return { frames, busyMs, inFramesMs, outside, windowMs: (end - start) / 1000 };
}
