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
 * Under a feed (market watch, live tail), the frames from the first rows painted
 * on, whatever the visitor does, and the frame's Shown in samples, read
 * from its ring (`__contender.shownIn`, kept with `?readout`) at each
 * refresh, never sent per frame.
 *
 * Passive: listeners on the frame's window, never on its elements; a rAF
 * loop only while a scroll is under way or a feed runs; one memory measurement at a time,
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
  /** Why it's warm: a frame came before it in this tab, or its files came
   *  from the cache (`warmth`). */
  second: boolean;
  cached: boolean;
  /** The frame's own URLs (its window's), for the memory's attribution. */
  base: string;
  /** A scroll under way: no memory measurement then. */
  scrolling: boolean;
  /** Its scenario runs a feed: its frames are recorded from its first rows on. */
  feed: boolean;
  /** Starts recording the feed's frames (set once the window is listened on). */
  startFeed: () => void;
  /** The feed's frames recorded, and as of the last refresh: the record's
   *  version moves once a refresh, not once a frame. */
  feedFrames: number;
  feedFramesRead: number;
  /** The frame's ring as last read, and the samples read from it. */
  ring: { samples: Float64Array; read: number } | null;
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

/** A new frame for `side`, as the slot creates it: its readings start over.
 *  `feed`: its scenario runs a feed. */
export function trackFrame(side: Side, frame: HTMLIFrameElement, base: string, feed = false): void {
  shown?.detach();
  const tracked: Tracked = {
    side,
    frame,
    record: { timeOrigin: 0, usable: null, open: null, filled: [], scrolls: [], memory: [], shown: [] },
    second: framesCreated > 0,
    cached: false,
    warm: framesCreated++ > 0,
    base: new URL(base, location.href).href,
    scrolling: false,
    feed,
    startFeed: () => {},
    feedFrames: 0,
    feedFramesRead: 0,
    ring: null,
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
    // A frame that filled before its `load`: its feed's frames start now.
    if (tracked.feed && tracked.record.filled.length) tracked.startFeed();
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
      tracked.cached = fromCache(source as Window);
      tracked.warm ||= tracked.cached;
      measureMemory(tracked);
      if (tracked.feed) tracked.startFeed();
    }
    record.filled.push(at);
  }
}

/** Any of the frame's files served from the HTTP cache. */
function fromCache(window: Window): boolean {
  const { performance } = window;
  return [...performance.getEntriesByType('navigation'), ...performance.getEntriesByType('resource')].some((entry) => cached(entry as PerformanceResourceTiming));
}

/** A file served from the HTTP cache, unrevalidated: nothing on the wire. */
export const cached = (entry: PerformanceResourceTiming): boolean => entry.transferSize === 0 && entry.decodedBodySize > 0;

/** Records each scroll's animation frames: from its first input until the
 *  input rests `SCROLL_REST_MS`. The page's rAF runs in the frame's own
 *  animation frames (a same-origin frame shares the page's main thread). */
function listenForScrolls(tracked: Tracked, window: Window): () => void {
  let last = 0;
  let scroll: number[] | null = null;
  // Under a feed, every frame from the first rows on, in runs: the page
  // having been hidden starts a new one (no frames ran then, so the gap
  // isn't a late frame), while a stall in a visible page stays one; the
  // runs kept to about the meter's window.
  let feed: number[] | null = null;
  let hidden = false;
  const visibility = () => void (document.hidden && (hidden = true));
  if (tracked.feed) document.addEventListener('visibilitychange', visibility);
  const feedTick = (now: number) => {
    if (!feed || shown !== tracked) return;
    const at = epoch(now);
    const { scrolls } = tracked.record;
    if (hidden && feed.length) scrolls.push((feed = []));
    hidden = document.hidden;
    feed.push(at);
    if (feed.length > 2 * FEED_FRAMES) feed.splice(0, feed.length - FEED_FRAMES);
    while (scrolls.length > 1 && scrolls[0]!.at(-1)! < at - 2 * FEED_FRAMES * FEED_FRAME_MS) scrolls.shift();
    tracked.feedFrames++;
    tracked.scrolling = !!metrics && performance.now() - last <= metrics.SCROLL_REST_MS;
    requestAnimationFrame(feedTick);
  };
  tracked.startFeed = () => {
    if (feed) return;
    tracked.record.scrolls.push((feed = []));
    requestAnimationFrame(feedTick);
  };
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
    // The feed's loop records every frame already, a scroll's among them.
    if (feed) return void (tracked.scrolling = true);
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
    feed = null;
    document.removeEventListener('visibilitychange', visibility);
    tracked.scrolling = false;
    for (const type of types) window.removeEventListener(type, input, options);
  };
}

/** When the page last became visible, epoch ms: a sample sent before it
 *  waited out the hidden time (no frame draws in a hidden page), and would
 *  read as that time on return, so it isn't read. */
let visibleSince = 0;
if (typeof document !== 'undefined')
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') visibleSince = epoch(performance.now());
  });

/** A feed's frames kept: about the meter's 10 s at 60 Hz. */
const FEED_FRAMES = 600;
const FEED_FRAME_MS = 1000 / 60;
/** The frame's new Shown in samples, from its ring (`SHOWN_RING`'s
 *  layout, its size the array's own): those written since the last read,
 *  only the last `SHOWN_WINDOW_MS`' back from now kept, so a feed that
 *  stopped reads as none. A new ring (a reopen) is read from its start. */
function readRing(tracked: Tracked): void {
  const { shown } = tracked.record;
  const from = epoch(performance.now()) - metrics!.SHOWN_WINDOW_MS;
  const stale = shown.findIndex(({ at }) => at >= from);
  const drop = stale < 0 ? shown.length : stale;
  if (drop) {
    shown.splice(0, drop);
    tracked.version++;
  }
  const held = (tracked.frame.contentWindow as (Window & { __contender?: { shownIn?: unknown } }) | null)?.__contender?.shownIn;
  // The frame's realm's array: not this window's `Float64Array`.
  if (Object.prototype.toString.call(held) !== '[object Float64Array]') return;
  const samples = held as Float64Array;
  const size = (samples.length - 1) / 2;
  if (!Number.isInteger(size) || size < 1) return;
  if (tracked.ring?.samples !== samples) tracked.ring = { samples, read: 0 };
  const ring = tracked.ring!;
  const written = samples[0]!;
  if (written < ring.read) ring.read = 0;
  if (written === ring.read) return;
  for (let n = Math.max(ring.read, written - size); n < written; n++) {
    const slot = 1 + 2 * (n % size);
    // Drawn in the window, and sent while the page was visible.
    if (samples[slot]! >= from && samples[slot]! - samples[slot + 1]! >= visibleSince) shown.push({ at: samples[slot]!, ms: samples[slot + 1]! });
  }
  ring.read = written;
  tracked.version++;
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
  if (shown?.feed) {
    readRing(shown);
    if (shown.feedFrames !== shown.feedFramesRead) {
      shown.feedFramesRead = shown.feedFrames;
      shown.version++;
    }
  }
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

/** Why `side`'s last frame is warm: its files from the cache (its HTML's
 *  navigation counted), a frame before it in this tab, or neither (cold). */
export const warmth = (side: Side): 'cache' | 'second' | null => {
  const tracked = sides[side];
  return tracked?.cached ? 'cache' : tracked?.second ? 'second' : null;
};
