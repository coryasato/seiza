/**
 * The observatory's metrics: every number the comparison shows, computed
 * from what the contenders publish (their marks, `__contender.state`, and
 * on the DOM side the cells' Element Timing entries) and from Chromium's
 * trace. Contenders set marks only (`docs/contender-contract.md`); the
 * Playwright scripts (`perf/metric-*.ts`) and the observatory's page read
 * them through this module, so both compute each metric one way.
 *
 * Pure: no Playwright, no Node, no DOM access at import. The scripts gather
 * the inputs and summarize the runs (`shared-web/perf/protocol.ts`); the
 * readings' choices are in `docs/DECISIONS.md`, "Measurement".
 */

import type { ContenderState, Side } from '../contenders/contract.ts';

export type { ContenderState, Side };

// ---------------------------------------------------------------- the protocol

/** One frame at 60 Hz, the reference run's refresh. */
export const FRAME_MS = 1000 / 60;

/** First usable's probe: a key right after `contender:usable` must mark
 *  `contender:input` within this many frames of the key's event. */
export const PROBE_FRAMES = 2;
export const PROBE_MS = PROBE_FRAMES * FRAME_MS;

/** The probe key: one neither contender's table handles, a plain key
 *  event on both (GPUI hears a modifier alone only on its release). */
export const PROBE_KEY = 'x';

/** The fling, one profile for both sides: equal steps, one per frame, top
 *  to bottom in ~3 s at 60 Hz. No step outruns a native scroller's room
 *  (`docs/dom-scroll-model.md`, "Scripting it"). */
export const FLING_FRAMES = 180;

/** Each fling step, CSS px, for a table of `rows` rows of `rowHeight`. */
export const flingStep = (rows: number, rowHeight: number): number => (rows * rowHeight) / FLING_FRAMES;

/** A frame interval past this many refreshes missed at least one: a late frame. */
export const LATE_FACTOR = 1.5;
export const LATE_FRAME_MS = LATE_FACTOR * FRAME_MS;

// ---------------------------------------------------------------- marks

export interface FirstUsable {
  /** `contender:usable`, ms from the page's time origin. */
  usableMs: number;
  /** The probe key's event → the presentation of the frame that drew its
   *  state change, ms; null: none did. */
  probeMs: number | null;
  /** The probe confirmed it: the key came after usable, and its frame was
   *  presented within `PROBE_MS` of the key's event. */
  confirmed: boolean;
}

/**
 * Time to first usable: the candidate moment (`contender:usable`) and the
 * probe that confirms it. `key` is the probe key's event time (its
 * `timeStamp`), `presented` the presentation of the frame that drew the
 * state it changed (`probePresented`), both page ms.
 */
export function firstUsable(usable: number, key: number, presented: number | null): FirstUsable {
  const probeMs = presented === null ? null : presented - key;
  return { usableMs: usable, probeMs, confirmed: key >= usable && probeMs !== null && probeMs >= 0 && probeMs <= PROBE_MS };
}

/** A cell's Element Timing paint (DOM only): `elementtiming="row:<row>"`. */
export interface CellPaint {
  row: number;
  /** Page clock, ms. */
  renderTime: number;
}

/** Cell paints from Element Timing entries: those named `row:<row>`. */
export function cellPaints(entries: readonly { id: string; renderTime: number }[]): CellPaint[] {
  return entries.filter((entry) => entry.id.startsWith('row:')).map((entry) => ({ row: Number(entry.id.slice(4)), renderTime: entry.renderTime }));
}

/**
 * The visible rows' cells painted since `since`, before `until` (created
 * after `since`: a cell is reported once, at its first paint): the latest
 * paint, and the visible rows with no new cell.
 */
export function rowsPainted(paints: readonly CellPaint[], since: number, first: number, end: number, until = Infinity): { latest: number | null; missing: number[] } {
  const rows = new Map<number, number>();
  for (const paint of paints) if (paint.renderTime >= since && paint.renderTime < until && paint.row >= first && paint.row < end) rows.set(paint.row, Math.max(rows.get(paint.row) ?? 0, paint.renderTime));
  const missing: number[] = [];
  for (let row = first; row < end; row++) if (!rows.has(row)) missing.push(row);
  return { latest: rows.size ? Math.max(...rows.values()) : null, missing };
}

export interface TimeToData {
  /** `contender:open`, ms from the page's time origin. */
  openMs: number;
  /** Open → every visible row painted with real data, ms. */
  ms: number;
  /** Open → `contender:filled`, ms (GPUI: the same as `ms`; TanStack: the
   *  commit, before the paint). */
  filledMarkMs: number;
}

/**
 * Time to data: open → every visible row painted with real data. GPUI's
 * `contender:filled` lands right after the presented frame, so it is the
 * moment; the DOM's lands in the commit, and the moment is the latest
 * paint among the visible rows' cells (`painted`, from `rowsPainted`).
 */
export function timeToData(side: Side, open: number, filled: number, painted: number | null): TimeToData | null {
  const at = side === 'gpui' ? filled : painted;
  if (at === null) return null;
  return { openMs: open, ms: at - open, filledMarkMs: filled - open };
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
/** Set by the scripts right before each input (`input:<n>`) and once it
 *  settled, before anything else happens (`input:<n>:end`): each input's
 *  window in the trace. */
export const INPUT_MARK = 'input:';
/** Set by the scripts' probe in the first frame drawn at a new position:
 *  `probe:moved`, or on GPUI `probe:moved:<pending>`, the visible rows that
 *  frame drew as placeholders. */
export const MOVED_MARK = 'probe:moved';

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

interface Span {
  begin: TraceEvent;
  end: TraceEvent;
}

/** Async begin/end pairs of one event name, matched by process and id. */
function spans(events: readonly TraceEvent[], name: string): Span[] {
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

/** Trace categories for first usable's probe: the frames' presentations,
 *  the marks, and `EventLatency`, light enough to trace a cold load. */
export const PROBE_CATEGORIES = ['devtools.timeline', 'blink.user_timing', 'input', 'latencyInfo'];

/** The probe key's `EventLatency`: its event → the presentation of the
 *  first frame it reached, ms (GPUI's guard on `probePresented`); null when
 *  it reached none, as on the DOM, whose probe changes nothing visible. */
export function probeLatency(trace: Trace): { ms: number; end: number } | null {
  const latency = spans(trace.events, 'EventLatency').find(({ begin }) => begin.args?.event_latency?.event_type === 'KEY_PRESSED' && begin.args?.event_latency?.display_trace_id !== undefined);
  return latency ? { ms: round((latency.end.ts - latency.begin.ts) / 1000), end: trace.toPage(latency.end.ts) } : null;
}

/**
 * The presentation (page ms) of the frame that drew the probe key's state
 * change: the frame `contender:input` lands in (GPUI's lands right after
 * its presenting task, inside the frame), else the first frame that begins
 * after it (the DOM's lands in the commit, in the key's task).
 */
export function probePresented(trace: Trace): number | null {
  const mark = trace.marks(/^contender:input$/)[0];
  if (!mark) return null;
  const presented = trace.presentationOf(mark.ts);
  const at = presented?.inFrame ? presented.at : trace.presentationOfFrameAfter(mark.ts);
  return at === null ? null : trace.toPage(at);
}

// ---------------------------------------------------------------- input to visible response

export type InputKind = 'key' | 'track' | 'wheel';

/** `EventLatency` types that are the input's own (not a mouse move before it). */
const LATENCY_TYPES: Record<InputKind, string[]> = {
  key: ['KEY_PRESSED'],
  track: ['MOUSE_PRESSED'],
  wheel: ['MOUSE_WHEEL', 'FIRST_GESTURE_SCROLL_UPDATE', 'GESTURE_SCROLL_UPDATE'],
};

/** What names the frame that showed the new position, independently of
 *  `EventLatency`: GPUI's probe for every input (it draws its own
 *  scrolling), the DOM's main-thread probe for its keys (the contender moves
 *  the scroller), and for a native scroll the compositor's first frame
 *  that applied it (`Scroll Delta This Frame`), which the main thread
 *  learns of a frame or two late. */
export type Guard = 'probe' | 'compositor';
export const guardFor = (side: Side, kind: InputKind): Guard => (side === 'gpui' || kind === 'key' ? 'probe' : 'compositor');

/** Within this many ms, two readings end on the same frame. */
const SAME_FRAME_MS = 1;

/** One input's readings, ms from the input event's own timestamp. */
export interface InputReading {
  side: Side;
  kind: InputKind;
  /** Input to visible response: `EventLatency`, the event to the
   *  presentation of the first frame it reached. */
  ms: number | null;
  type: string | null;
  /** The guard's own reading, and whether it ended on the same frame. */
  guard: { by: Guard; ms: number | null; agrees: boolean };
  /** → that frame's rows being real data (see `readInputs`). */
  realMs: number | null;
}

/** What a script knows of one input: where the view rested after it. */
export interface Settled {
  first: number;
  end: number;
}

/**
 * Each input's readings from a trace that holds each input's window
 * (`input:<n>` … `input:<n>:end`, the last of each when a script marked a
 * retry), the probe's `probe:moved`
 * marks (`MOVED_MARK`), and for the DOM the cells' paints (`paints`) and where each
 * input left the view (`settled`).
 *
 * → rows real: GPUI, the presentation of the first `contender:filled` in
 * the input's window, or the visible response when the moved frame had no
 * placeholders; the DOM, the latest paint among the visible rows' cells
 * created in the window (a visible row with none was already real: the
 * script's window ends only once every visible row is), or the visible
 * response when none were.
 */
export function readInputs(trace: Trace, side: Side, kind: InputKind, settled: readonly Settled[] = [], paints: readonly CellPaint[] = []): InputReading[] {
  // The last start and end of each input (a retried press marks again).
  const windows = new Map<number, { start?: TraceEvent; end?: TraceEvent }>();
  for (const mark of trace.marks(new RegExp(`^${INPUT_MARK}\\d+(:end)?$`))) {
    const [, n, end] = /^[^\d]*(\d+)(:end)?$/.exec(mark.name)!;
    const window = windows.get(Number(n)) ?? {};
    window[end ? 'end' : 'start'] = mark;
    windows.set(Number(n), window);
  }
  const latencies = spans(trace.events, 'EventLatency');
  const moved = trace.marks(new RegExp(`^${MOVED_MARK}(:\\d+)?$`));
  const filled = trace.marks(/^contender:filled$/);
  const deltas = trace.events.filter((event) => event.name === 'Scroll Delta This Frame' && event.pid === trace.main.pid && event.tid !== trace.main.tid && (event.args?.x || event.args?.y));
  const submits = spans(trace.events, 'SubmitCompositorFrameToPresentationCompositorFrame').filter(({ begin }) => begin.pid === trace.main.pid);
  const by = guardFor(side, kind);
  return [...windows.keys()].sort((a, b) => a - b).map((index) => {
    const { start, end } = windows.get(index)!;
    if (!start || !end) throw new Error(`input ${index}: its window isn't marked at both ends`);
    const until = end.ts;
    const within = (event: TraceEvent) => event.ts >= start.ts && event.ts < until;
    // The first of the input's own that reached a frame (it has a display trace id).
    const latency = latencies
      .filter(({ begin }) => within(begin) && LATENCY_TYPES[kind].includes(begin.args?.event_latency?.event_type) && begin.args?.event_latency?.display_trace_id !== undefined)
      .sort((a, b) => a.end.ts - b.end.ts)[0];
    const reading: InputReading = { side, kind, ms: null, type: null, guard: { by, ms: null, agrees: false }, realMs: null };
    if (!latency) return reading;
    const eventAt = latency.begin.ts;
    const ms = (ts: number) => round((ts - eventAt) / 1000);
    reading.ms = ms(latency.end.ts);
    reading.type = latency.begin.args!.event_latency.event_type;
    // The guard: the frame that showed the new position.
    const mark = moved.find(within);
    const probed = mark ? trace.presentationOf(mark.ts) : null;
    let shownAt: number | null = null;
    if (by === 'probe') shownAt = probed?.at ?? null;
    else {
      // The frame that applied the delta is the next one submitted.
      const delta = deltas.find(within);
      shownAt = (delta && submits.find(({ begin }) => begin.ts >= delta.ts)?.end.ts) ?? null;
    }
    reading.guard = { by, ms: shownAt === null ? null : ms(shownAt), agrees: shownAt !== null && Math.abs(latency.end.ts - shownAt) <= SAME_FRAME_MS * 1000 };
    // → rows real.
    if (side === 'gpui') {
      const fill = filled.find(within);
      const pending = mark?.name.slice(MOVED_MARK.length + 1);
      if (fill) reading.realMs = ms(trace.presentationOf(fill.ts)?.at ?? fill.ts);
      else if (pending === '0') reading.realMs = reading.ms;
    } else {
      const view = settled[index];
      if (view) {
        // Within the window: a later input can bring the same rows back.
        const { latest } = rowsPainted(paints, trace.toPage(start.ts), view.first, view.end, trace.toPage(until));
        reading.realMs = latest === null ? reading.ms : Math.max(reading.ms, ms(trace.toTrace(latest)));
      }
    }
    return reading;
  });
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

// ---------------------------------------------------------------- behavior under load

/** Frame intervals over `LATE_FACTOR` refreshes (`LATE_FRAME_MS` at the
 *  reference run's 60 Hz): their count, and their share of the intervals. */
export function lateFrames(intervals: readonly number[], refreshMs = FRAME_MS): { late: number; share: number } {
  const late = intervals.filter((interval) => interval > LATE_FACTOR * refreshMs).length;
  return { late, share: intervals.length ? late / intervals.length : 0 };
}

/** The display's refresh period, from frame intervals: the 10th percentile
 *  of the latest `REFRESH_SAMPLE` (on-time frames are one refresh apart; a
 *  late one is longer, never shorter), so a long session's cost stays flat.
 *  `FRAME_MS` with too few to tell. */
export const REFRESH_SAMPLE = 600;
export function refreshPeriod(intervals: readonly number[]): number {
  if (intervals.length < 10) return FRAME_MS;
  const sorted = intervals.slice(-REFRESH_SAMPLE).sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 10)]!;
}

/** One animation frame and what the view showed then (`__contender.state`,
 *  through `shared-web/perf/`'s `frameRecorder`). */
export type StateFrame = Partial<ContenderState> & { t: number };

export interface UnderLoad {
  /** Frames from the first input until the view rested at its end. */
  frames: number;
  /** Frame intervals over `LATE_FRAME_MS`: refreshes the view missed. */
  lateFrames: number;
  lateShare: number;
  /** Frames showing any placeholder row. */
  placeholderShare: number;
  /** How far the view trailed the input, in fling steps: per frame, the
   *  input's position so far less the view's. The state is sampled as each
   *  frame starts, before its own work, so a view that shows each input in
   *  the next frame trails by about 1. p95 and max. */
  lagSteps: { p95: number; max: number };
  /** The last input → the first frame of the view's rest at its end with
   *  every row real, ms; null if it never got there. */
  catchUpMs: number | null;
  /** The view ended at the last row, filled. */
  reachedEnd: boolean;
}

/** A wheel event as the page got it: its time (page ms) and `deltaY`, in
 *  whatever unit the page sees (a browser coalesces events, so the
 *  deltas, not the events, say how far the input went). */
export interface WheelInput {
  at: number;
  delta: number;
}

/**
 * Behavior under load in a fling: `inputs` moved the view `steps` steps of
 * `stepPx` CSS px in all, from `startTop`; `frames` are the recorded
 * frames (`StateFrame`) from the first input on.
 */
export function underLoad(frames: readonly StateFrame[], inputs: readonly WheelInput[], steps: number, stepPx: number, startTop: number): UnderLoad {
  const first = inputs[0]?.at ?? 0;
  const lastInput = inputs.at(-1)?.at ?? 0;
  const total = inputs.reduce((sum, input) => sum + input.delta, 0);
  const shown = frames.filter((frame) => frame.t >= first && typeof frame.top === 'number');
  const final = shown.at(-1);
  const restsFilled = (frame: StateFrame) => frame.pending === 0 && frame.top === final?.top;
  // The first frame of the final rest, filled.
  let rest = shown.length;
  while (rest > 0 && restsFilled(shown[rest - 1]!)) rest--;
  const settled = rest < shown.length ? shown[rest]! : null;
  const during = shown.slice(0, settled ? rest + 1 : shown.length);
  const intervals = during.slice(1).map((frame, index) => frame.t - during[index]!.t);
  const { late, share } = lateFrames(intervals);
  const maxTop = Math.max(0, ...shown.map((frame) => frame.top!));
  const lags = during.map((frame) => {
    const sent = inputs.filter((input) => input.at <= frame.t).reduce((sum, input) => sum + input.delta, 0);
    const expected = Math.min(startTop + (total ? sent / total : 0) * steps * stepPx, maxTop);
    return Math.max(0, (expected - frame.top!) / stepPx);
  });
  const sorted = [...lags].sort((a, b) => a - b);
  const p95 = sorted[Math.min(sorted.length, Math.max(1, Math.ceil(0.95 * sorted.length))) - 1] ?? 0;
  return {
    frames: during.length,
    lateFrames: late,
    lateShare: share,
    placeholderShare: during.length ? during.filter((frame) => (frame.pending ?? 0) > 0).length / during.length : 0,
    lagSteps: { p95: round(p95), max: round(sorted.at(-1) ?? 0) },
    catchUpMs: settled ? round(Math.max(0, settled.t - lastInput)) : null,
    reachedEnd: !!final && final.end === final.rows && final.pending === 0,
  };
}

// ---------------------------------------------------------------- memory

/** One entry of `performance.measureUserAgentSpecificMemory()`'s breakdown. */
export interface MemoryEntry {
  bytes: number;
  attribution: { url?: string; scope: string }[];
  /** What the bytes are ("JavaScript", "Canvas", …), several joined by "+". */
  types?: string[];
}

/**
 * The page's own memory (its window's realm) and its workers' (the engine's,
 * the same on both sides), bytes. `isPage` names the page's window by its
 * URL where there are several (the observatory's page measures the
 * contender's frame); a bare page has one. The page's bytes also by type
 * (`types` joined by "+"; "untyped" without one): a canvas's backing store
 * is "Canvas", a wasm's linear memory "JavaScript".
 */
export function memoryOf(breakdown: readonly MemoryEntry[], isPage: (url: string) => boolean = () => true): { pageBytes: number; workerBytes: number; pageByType: Record<string, number> } {
  let pageBytes = 0;
  let workerBytes = 0;
  const pageByType: Record<string, number> = {};
  for (const entry of breakdown) {
    if (entry.attribution.some((attribution) => attribution.scope === 'Window' && isPage(attribution.url ?? ''))) {
      pageBytes += entry.bytes;
      const type = entry.types?.join('+') || 'untyped';
      pageByType[type] = (pageByType[type] ?? 0) + entry.bytes;
    } else if (entry.attribution.some((attribution) => attribution.scope.endsWith('WorkerGlobalScope'))) workerBytes += entry.bytes;
  }
  return { pageBytes, workerBytes, pageByType };
}

// ---------------------------------------------------------------- live, in a tab

/** How often the page's readouts refresh: ~4 Hz, as Tycho's panel. */
export const LIVE_REFRESH_MS = 250;

/** A scroll ends once its input rests this long (the paging's own rest). */
export const SCROLL_REST_MS = 250;

/** What the observatory's page records of the shown contender, as it runs
 *  in the page's frame: epoch ms throughout, since the page and the frame
 *  have different time origins. */
export interface LiveRecord {
  /** The frame's `performance.timeOrigin`. */
  timeOrigin: number;
  /** The relayed marks (`contender:usable`, `open`, every `filled`). */
  usable: number | null;
  open: number | null;
  filled: number[];
  /** Each scroll's animation frames (their rAF timestamps, epoch ms), from
   *  its first input until it rested. */
  scrolls: number[][];
  /** The memory measurements' breakdowns and their times, oldest first:
   *  the last `METER_MEMORY_MS`' (the meter's graph), at least the latest. */
  memory: { at: number; breakdown: MemoryEntry[] }[];
}

/** The page's live readouts, each a reading a page can take (no trace):
 *  marks, frame intervals, memory. */
export interface LiveReadings {
  /** Navigation → `contender:usable`, unconfirmed: a tab has no probe key. */
  usableMs: number | null;
  /** `contender:open` → the first `contender:filled` after it: GPUI's lands
   *  right after the presented frame, the DOM's in its commit, up to a frame
   *  before its paint (a page can't read the cells' Element Timing). */
  dataMs: number | null;
  /** Late frames while the visitor scrolled, at the refresh the frames
   *  themselves show (a 120 Hz display's, not the reference run's 60). The
   *  memory is re-measured every few seconds, so it moves on its own. */
  scrolling: { frames: number; lateShare: number; refreshMs: number } | null;
  /** The page's own `JavaScript` memory (a wasm's linear memory is in it),
   *  MiB: what the cold memory at equal work reads, so the canvas's backing
   *  store (`Canvas`) and the engine's workers are apart. */
  pageMiB: number | null;
}

export function liveReadings(record: LiveRecord, isPage: (url: string) => boolean): LiveReadings {
  const { open, usable } = record;
  const filled = open === null ? undefined : record.filled.find((at) => at >= open);
  const intervals = record.scrolls.flatMap((frames) => frames.slice(1).map((at, index) => at - frames[index]!));
  const refreshMs = refreshPeriod(intervals);
  const latest = record.memory.at(-1);
  return {
    usableMs: usable === null ? null : round(usable - record.timeOrigin),
    dataMs: open === null || filled === undefined ? null : round(filled - open),
    scrolling: intervals.length ? { frames: intervals.length, lateShare: lateFrames(intervals, refreshMs).share, refreshMs: round(refreshMs) } : null,
    pageMiB: latest ? pageMiB(latest.breakdown, isPage) : null,
  };
}

/** The page's `JavaScript` memory, MiB (`LiveReadings.pageMiB`). */
const pageMiB = (breakdown: readonly MemoryEntry[], isPage: (url: string) => boolean) => round((memoryOf(breakdown, isPage).pageByType.JavaScript ?? 0) / 2 ** 20);

/** The meter's frame graph spans this long, back from now. */
export const METER_WINDOW_MS = 10_000;
/** Its bars: each the slowest frame in its slice of the window. */
export const METER_BARS = 60;
/** Its memory graph spans this long: one slot per measurement, the page
 *  measuring every `METER_MEMORY_EVERY_MS`. */
export const METER_MEMORY_MS = 60_000;
export const METER_MEMORY_EVERY_MS = 5_000;
export const METER_MEMORY_SLOTS = METER_MEMORY_MS / METER_MEMORY_EVERY_MS;
/** FPS counts the frames that ended this long back from now… */
export const METER_FPS_MS = 1_000;
/** …and reads idle (null) once nothing has drawn for this long. */
export const METER_IDLE_MS = 500;

/** The meter's graphs (`docs/DECISIONS.md`, "Page", the meter): what a
 *  tab's recorded frames and memory say about now. */
export interface MeterReadings {
  /** Each slice's slowest frame, in display frames (an interval over the
   *  refresh period), oldest first; null where nothing drew. */
  bars: (number | null)[];
  /** Each slice holds a late frame: the rule `late` counts by. */
  lateBars: boolean[];
  /** Frames late in the window, by `lateFrames`' rule at the refresh
   *  period the whole record shows (Smooth's). */
  late: number;
  /** Frames a second over the last `METER_FPS_MS`; null when idle. */
  fps: number | null;
  /** Whether any frame is in the window: the graph moves until none is. */
  moving: boolean;
  /** The page's memory, MiB, the last `METER_MEMORY_SLOTS` measurements in
   *  `METER_MEMORY_MS`, oldest first, padded with null at the start. */
  memoryMiB: (number | null)[];
}

/** `now` is epoch ms on the frames' clock (`timeOrigin` + `performance.now()`), never `Date.now()`, which drifts from it. */
export function meterReadings(record: LiveRecord, now: number, isPage: (url: string) => boolean, bars = METER_BARS): MeterReadings {
  const start = now - METER_WINDOW_MS;
  // Newest scrolls first: the window's intervals (each ending at its frame),
  // stopping at the first scroll that ended before the window, and the
  // latest `REFRESH_SAMPLE` intervals for the refresh period. A scroll just
  // begun has no frames yet: skipped, not an end.
  const recent: { at: number; ms: number }[] = [];
  const sample: number[] = [];
  for (let index = record.scrolls.length - 1; index >= 0 && sample.length < REFRESH_SAMPLE; index--) {
    const frames = record.scrolls[index]!;
    for (let frame = frames.length - 1; frame > 0 && sample.length < REFRESH_SAMPLE; frame--) sample.push(frames[frame]! - frames[frame - 1]!);
  }
  for (let index = record.scrolls.length - 1; index >= 0; index--) {
    const frames = record.scrolls[index]!;
    if (!frames.length) continue;
    if (frames.at(-1)! < start) break;
    for (let frame = 1; frame < frames.length; frame++) if (frames[frame]! >= start) recent.push({ at: frames[frame]!, ms: frames[frame]! - frames[frame - 1]! });
  }
  const refreshMs = refreshPeriod(sample.reverse());
  const slowest: (number | null)[] = Array.from({ length: bars }, () => null);
  for (const { at, ms } of recent) {
    const slice = Math.min(bars - 1, Math.floor(((at - start) / METER_WINDOW_MS) * bars));
    slowest[slice] = Math.max(slowest[slice] ?? 0, ms);
  }
  const memory = record.memory.filter(({ at }) => at > now - METER_MEMORY_MS).slice(-METER_MEMORY_SLOTS);
  const lastFrame = recent.reduce((last, { at }) => Math.max(last, at), -Infinity);
  const second = recent.filter(({ at }) => at > now - METER_FPS_MS);
  const secondMs = second.reduce((sum, { ms }) => sum + ms, 0);
  return {
    bars: slowest.map((ms) => (ms === null ? null : round(ms / refreshMs))),
    // On the unrounded milliseconds, as `lateFrames` judges them.
    lateBars: slowest.map((ms) => ms !== null && ms > LATE_FACTOR * refreshMs),
    late: lateFrames(recent.map(({ ms }) => ms), refreshMs).late,
    fps: now - lastFrame > METER_IDLE_MS || !secondMs ? null : Math.round((second.length / secondMs) * 1000),
    moving: recent.length > 0,
    memoryMiB: [...Array.from({ length: METER_MEMORY_SLOTS - memory.length }, () => null), ...memory.map(({ breakdown }) => pageMiB(breakdown, isPage))],
  };
}

// ---------------------------------------------------------------- reach

export interface Reach {
  /** `state.rows` is the file's `count(*)`. */
  countMatches: boolean;
  /** At the end: the last row on screen, real, its key the file's last. */
  lastRowReached: boolean;
}

export function reach(opened: ContenderState, atEnd: ContenderState, count: number, lastKey: string): Reach {
  return { countMatches: opened.rows === count, lastRowReached: atEnd.end === count && atEnd.pending === 0 && atEnd.lastCell === lastKey };
}

const round = (value: number) => Number(value.toFixed(2));
