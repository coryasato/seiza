/**
 * The contender contract's page side (docs/contender-contract.md), shared by
 * every contender page: `globalThis.__contender`, the relay of the
 * contender's marks to the observatory's page, and the waits the replay
 * hooks resolve on. Contenders set marks and publish state; they compute no
 * metric (`metrics/metrics.ts` does, and owns the replay's fling profile).
 */

export type Side = 'gpui' | 'tanstack';

/** What the last presented frame showed (`?measure` only). Replaced, never
 *  mutated in place. */
export interface ContenderState {
  /** The row count the view uses (after the open's count). */
  rows: number;
  /** The content's position, CSS px from row 0's top. */
  top: number;
  /** First visible row, 0-based, and one past the last. */
  first: number;
  end: number;
  /** Visible rows with real data, and drawn as placeholders. */
  loaded: number;
  pending: number;
  /** The key (spkid) of the last row, when it's visible. */
  lastCell: string | null;
  /** The page cache's Arrow IPC bytes. */
  cacheBytes: number;
}

export interface Replay {
  /** Closes and reopens the file; resolves once the view is filled (the
   *  first `contender:filled` after it, or at once if it lands filled). */
  open(): Promise<void>;
  /** Top to bottom in ~3 s; resolves once it rests at the end and fills. */
  fling(): Promise<void>;
  /** To that fraction of the rows; resolves once the view is filled, as `open`. */
  jump(fraction: number): Promise<void>;
}

export interface Contender {
  side: Side;
  state: ContenderState | null;
  replay: Replay;
}

export const MARKS = {
  /** The first frame with anything of the contender's own on screen. */
  firstPixels: 'contender:first-pixels',
  /** The candidate moment of first usable. */
  usable: 'contender:usable',
  /** The contender starts opening the data file. */
  open: 'contender:open',
  /** Right after a frame in which every visible row holds real data. */
  filled: 'contender:filled',
  /** `?measure`: the view handled the probe key (any key) and drew it. */
  input: 'contender:input',
} as const;

/** Whether the page was opened for measuring (`?measure`). */
export const measuring = (): boolean => new URLSearchParams(location.search).has('measure');

/**
 * Publishes `globalThis.__contender` (`state` stays null until the side
 * publishes one, and without `?measure` for good), and relays every
 * contender mark to the parent page while in a frame:
 * `parent.postMessage({ seiza: 'mark', name, at }, location.origin)`, `at` in
 * epoch ms, since the page and the frame have different time origins.
 */
export function publishContender(side: Side, replay: Replay): Contender {
  const contender: Contender = { side, state: null, replay };
  (globalThis as { __contender?: Contender }).__contender = contender;
  if (window.parent !== window) {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!entry.name.startsWith('contender:')) continue;
        window.parent.postMessage({ seiza: 'mark', name: entry.name, at: performance.timeOrigin + entry.startTime }, location.origin);
      }
    }).observe({ type: 'mark', buffered: true });
  }
  return contender;
}

/** Sets mark `to` at the time of each mark named `from` (those already
 *  set, and later ones): for a contract mark that is another mark's moment.
 *  Readers take a mark's last entry, so `to`'s last is `from`'s. */
export function markAt(from: string, to: string): void {
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) if (entry.name === from) performance.mark(to, { startTime: entry.startTime });
  }).observe({ type: 'mark', buffered: true });
}

/** The first mark named `name` at or after `since` (page clock), once it's
 *  set; rejects after `timeoutMs`. */
export function nextMark(name: string, since: number, timeoutMs = 30_000): Promise<number> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      observer.disconnect();
      reject(new Error(`no ${name} within ${timeoutMs} ms`));
    }, timeoutMs);
    const observer = new PerformanceObserver((list) => {
      const entry = list.getEntries().find((entry) => entry.name === name && entry.startTime >= since);
      if (!entry) return;
      clearTimeout(timer);
      observer.disconnect();
      resolve(entry.startTime);
    });
    observer.observe({ type: 'mark', buffered: true });
  });
}

/** Resolves at the next animation frame. */
export const nextFrame = (): Promise<number> => new Promise((resolve) => requestAnimationFrame(resolve));
