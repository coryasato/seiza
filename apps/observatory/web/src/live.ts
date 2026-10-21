/**
 * This tab's live readouts of the shown contender (`docs/DECISIONS.md`,
 * "Page"): the slot hands each frame and its relayed marks over, and this
 * records what a page can read of it, raw (epoch ms): the marks, the
 * animation frames while the visitor scrolls, and the frame's memory. The
 * metrics module (loaded after first paint) turns a record into readings
 * (`liveReadings`), at ~4 Hz while anything shows them. Each side keeps its
 * last frame's readings after a flip; a side loaded after another in this
 * tab, or from the browser's cache, is warm.
 *
 * Passive: listeners on the frame's window, never on its elements; a rAF
 * loop only while a scroll is under way; one memory measurement at a time,
 * every few seconds once the frame filled, never during a scroll, only
 * while the page is visible. A refresh with nothing new costs a version
 * check, and a hidden page skips it. The meter's graphs (`meter.ts`) are
 * recomputed only while it's subscribed, and only while a frame is still in
 * its window or the record changed (`meterReadings`).
 */

import { useSyncExternalStore } from 'react';
import { MARKS, type Side } from '../../contenders/contract.ts';
import type { LiveReadings, LiveRecord, MemoryEntry, MeterReadings } from '../../metrics/metrics.ts';
import { loadMetrics } from './metrics.ts';
import { afterFirstPaint } from './paint.ts';

export interface LiveSide {
  readings: LiveReadings;
  /** Not this tab's first frame, or its files came from the cache. */
  warm: boolean;
}

export type Live = Record<Side, LiveSide | null>;

/** The meter's view of the shown side. */
export interface MeterSide {
  side: Side;
  /** Its first rows painted: only then is it cold or warm. */
  filled: boolean;
  warm: boolean;
  readings: MeterReadings;
}

/** The input that moves each side's table. GPUI draws its own scrolling:
 *  the wheel, the keys that scroll, touches, and a drag (its thumb's). The
 *  DOM's scroller says when it moved, whatever moved it (a key, the
 *  scrollbar), and the wheel and touches start it. */
const SCROLL_INPUTS: Record<Side, string[]> = { gpui: ['wheel', 'keydown', 'touchmove', 'pointermove'], tanstack: ['wheel', 'touchmove', 'scroll'] };
const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End', ' ']);

interface Tracked {
  side: Side;
  frame: HTMLIFrameElement;
  record: LiveRecord;
  warm: boolean;
  /** The frame's own URLs (its window's), for the memory's attribution. */
  base: string;
  /** A scroll under way: no memory measurement then. */
  scrolling: boolean;
  detach: () => void;
  /** Bumped by every change to `record`; `read` is the readings at one. */
  version: number;
  read: { version: number; side: LiveSide } | null;
}

type MeasureMemory = () => Promise<{ breakdown: MemoryEntry[] }>;

let framesCreated = 0;
let shown: Tracked | null = null;
const sides: Record<Side, Tracked | null> = { gpui: null, tanstack: null };
let snapshot: Live = { gpui: null, tanstack: null };
const listeners = new Set<() => void>();
let meter: { version: number; tracked: Tracked; side: MeterSide } | null = null;
const meterListeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let metrics: Awaited<ReturnType<typeof loadMetrics>> | null = null;

const epoch = (pageMs: number) => performance.timeOrigin + pageMs;

/** A new frame for `side`, as the slot creates it: its readings start over. */
export function trackFrame(side: Side, frame: HTMLIFrameElement, base: string): void {
  shown?.detach();
  const tracked: Tracked = {
    side,
    frame,
    record: { timeOrigin: 0, usable: null, open: null, filled: [], scrolls: [], memory: [] },
    warm: framesCreated++ > 0,
    base: new URL(base, location.href).href,
    scrolling: false,
    detach: () => {},
    version: 0,
    read: null,
  };
  shown = tracked;
  sides[side] = tracked;
  // The window to listen on exists once the frame's document has loaded.
  const attach = () => {
    const window = frame.contentWindow;
    if (!window || shown !== tracked) return;
    tracked.record.timeOrigin ||= window.performance.timeOrigin;
    tracked.detach = listenForScrolls(tracked, window);
  };
  frame.addEventListener('load', attach, { once: true });
  // A scroll's recording ends on the module's rest time: load it with the
  // first frame (created after first paint), whether or not anything shows.
  void loadMetrics().then((loaded) => (metrics = loaded));
}

/** A mark the shown frame relayed (`publishContender`), epoch ms. */
export function frameMark(source: MessageEventSource | null, name: string, at: number): void {
  const tracked = shown;
  if (!tracked || source !== tracked.frame.contentWindow) return;
  const { record } = tracked;
  tracked.version++;
  if (!record.timeOrigin) record.timeOrigin = (source as Window).performance.timeOrigin;
  if (name === MARKS.usable) record.usable = at;
  else if (name === MARKS.open) record.open = at;
  else if (name === MARKS.filled) {
    if (!record.filled.length) {
      tracked.warm ||= fromCache(source as Window);
      measureMemory(tracked);
    }
    record.filled.push(at);
  }
}

/** Any of the frame's files served from the HTTP cache. */
function fromCache(window: Window): boolean {
  return window.performance.getEntriesByType('resource').some((entry) => {
    const resource = entry as PerformanceResourceTiming;
    return resource.transferSize === 0 && resource.decodedBodySize > 0;
  });
}

/** Records each scroll's animation frames: from its first input until the
 *  input rests `SCROLL_REST_MS`. The page's rAF runs in the frame's own
 *  animation frames (a same-origin frame shares the page's main thread). */
function listenForScrolls(tracked: Tracked, window: Window): () => void {
  let last = 0;
  let scroll: number[] | null = null;
  const tick = (now: number) => {
    if (!scroll || shown !== tracked) return;
    scroll.push(epoch(now));
    tracked.version++;
    if (metrics && now - last > metrics.SCROLL_REST_MS) scroll = null;
    else requestAnimationFrame(tick);
    tracked.scrolling = scroll !== null;
  };
  const input = (event: Event) => {
    if (event.type === 'keydown' && !SCROLL_KEYS.has((event as KeyboardEvent).key)) return;
    if (event.type === 'pointermove' && !(event as PointerEvent).buttons) return;
    last = performance.now();
    if (scroll) return;
    scroll = [];
    tracked.scrolling = true;
    tracked.record.scrolls.push(scroll);
    requestAnimationFrame(tick);
  };
  const options = { capture: true, passive: true };
  const types = SCROLL_INPUTS[tracked.side];
  for (const type of types) window.addEventListener(type, input, options);
  return () => {
    scroll = null;
    tracked.scrolling = false;
    for (const type of types) window.removeEventListener(type, input, options);
  };
}

/** The frame's memory, one measurement at a time while it's shown and the
 *  page is visible (Chromium, cross-origin isolated: the page is). */
function measureMemory(tracked: Tracked): void {
  const measure = (performance as Performance & { measureUserAgentSpecificMemory?: MeasureMemory }).measureUserAgentSpecificMemory;
  if (!measure || !crossOriginIsolated) return;
  // Between two measurements (each can wait for a GC): the meter's memory slot.
  const next = () => void loadMetrics().then(({ METER_MEMORY_EVERY_MS }) => setTimeout(run, METER_MEMORY_EVERY_MS));
  const run = () => {
    if (shown !== tracked) return;
    if (document.visibilityState !== 'visible' || tracked.scrolling) return void next();
    measure.call(performance).then(
      ({ breakdown }) => {
        if (shown !== tracked) return;
        // The frames' clock: the meter compares the two.
        const at = epoch(performance.now());
        const { memory } = tracked.record;
        memory.push({ at, breakdown });
        // The meter's minute, and the latest whatever its age.
        while (metrics && memory.length > 1 && memory[0]!.at <= at - metrics.METER_MEMORY_MS) memory.shift();
        tracked.version++;
        next();
      },
      // A measurement can fail (the frame navigating, say): try again later.
      () => next(),
    );
  };
  run();
}

/** Each side's readings, recomputed only when its record changed, and
 *  published only when they did. */
function refresh(): void {
  if (!metrics || document.visibilityState !== 'visible') return;
  if (meterListeners.size) refreshMeter();
  if (!listeners.size) return;
  let changed = false;
  const read = (tracked: Tracked | null, was: LiveSide | null): LiveSide | null => {
    if (!tracked) return null;
    if (tracked.read?.version !== tracked.version) {
      const side = { readings: metrics!.liveReadings(tracked.record, (url) => url.startsWith(tracked.base)), warm: tracked.warm };
      tracked.read = { version: tracked.version, side: JSON.stringify(side) === JSON.stringify(was) ? was! : side };
    }
    changed ||= tracked.read.side !== was;
    return tracked.read.side;
  };
  const next: Live = { gpui: read(sides.gpui, snapshot.gpui), tanstack: read(sides.tanstack, snapshot.tanstack) };
  if (!changed) return;
  snapshot = next;
  for (const listener of listeners) listener();
}

/** The meter's readings of the shown side, recomputed while a frame is in
 *  its window (the graph moves with the clock) or the record changed, and
 *  published only when they changed. */
function refreshMeter(): void {
  const tracked = shown;
  if (!tracked) return;
  if (meter?.tracked === tracked && meter.version === tracked.version && !meter.side.readings.moving) return;
  const readings = metrics!.meterReadings(tracked.record, epoch(performance.now()), (url) => url.startsWith(tracked.base));
  const side: MeterSide = { side: tracked.side, filled: tracked.record.filled.length > 0, warm: tracked.warm, readings };
  const changed = meter?.tracked !== tracked || JSON.stringify(side) !== JSON.stringify(meter.side);
  meter = { version: tracked.version, tracked, side: changed ? side : meter!.side };
  if (changed) for (const listener of meterListeners) listener();
}

/** Adds `listener` to `set`, refreshing at ~4 Hz while any is subscribed. */
function subscribe(set: Set<() => void>, listener: () => void): () => void {
  set.add(listener);
  // The metrics module loads after the page's first paint, never for it.
  afterFirstPaint(() =>
    void loadMetrics().then((loaded) => {
      metrics = loaded;
      if (listeners.size || meterListeners.size) timer ??= setInterval(refresh, loaded.LIVE_REFRESH_MS);
    }),
  );
  return () => {
    set.delete(listener);
    if (!listeners.size && !meterListeners.size && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

/** Calls `listener` after each refresh that changed a reading: the status
 *  bar writes its text from it by reference, never by a React render. */
export const subscribeLive = (listener: () => void): (() => void) => subscribe(listeners, listener);

/** Calls `listener` after each refresh that changed the meter's readings;
 *  the meter draws from `meterSnapshot` by reference. */
export const subscribeMeter = (listener: () => void): (() => void) => subscribe(meterListeners, listener);

/** The meter's readings of the shown side now, or null before any. */
export const meterSnapshot = (): MeterSide | null => (meter?.tracked === shown ? meter.side : null);

const EMPTY: Live = { gpui: null, tanstack: null };

/** This tab's readings now. */
export const liveSnapshot = (): Live => snapshot;

/** This tab's readings, refreshed at ~4 Hz, for a view that renders them
 *  (the panel, which covers the frame). */
export const useLive = (): Live => useSyncExternalStore(subscribeLive, liveSnapshot, () => EMPTY);

/** Whether `side`'s last frame is warm: not the tab's first, or its files
 *  came from the cache (known once it filled). */
export const isWarm = (side: Side): boolean => sides[side]?.warm ?? false;
