/**
 * Live tail's clock worker: one per contender frame, ended with it (one
 * contender runs at a time), as market watch's feed worker is. Started by
 * `{ rate }` (`TailStart`), it posts `[rows, at]` about every 16 ms while
 * rows came due: the running count (`clock.ts`) and the post's stamp in
 * epoch ms (the page subtracts its own `timeOrigin`); with a `limit`, it
 * stops once the count reaches it (its last post the limit). `{ pause: true }`
 * stops the count (the scroll back's control), posting the rows due by
 * then, and stops the timer; `{ pause: false }` resumes both. A pause sent
 * before the start holds from the start.
 *
 * A contender starts it with
 * `new Worker(new URL('…/contenders/tail/worker.ts', import.meta.url), { type: 'module' })`.
 */

import { Clock } from './clock.ts';

/** What starts the clock. */
export interface TailStart {
  rate: number;
  /** The rows at which the clock stops (`data.ts`'s `limitFrom`); 0 or none: never. */
  limit?: number;
}

/** What pauses or resumes it. */
export interface TailPause {
  pause: boolean;
}

/** What it posts: the rows due so far and the post's epoch ms. */
export type TailRows = [rows: number, at: number];

/** The interval between posts, ms: about a frame. */
export const INTERVAL_MS = 16;

// The contenders' tsconfigs have no WebWorker lib: the two calls used, typed here.
declare const self: { onmessage: ((event: MessageEvent<TailStart | TailPause>) => void) | null; postMessage(message: TailRows): void };

if (typeof self !== 'undefined' && typeof (self as unknown as { importScripts?: unknown }).importScripts === 'function') {
  let clock: Clock | null = null;
  let paused = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const post = (clock: Clock) => self.postMessage([clock.rows, performance.timeOrigin + performance.now()]);
  const tick = () => {
    if (clock && clock.advance(performance.now()) > 0) post(clock);
    timer = clock?.done ? undefined : setTimeout(tick, INTERVAL_MS);
  };
  const stop = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  self.onmessage = ({ data }) => {
    if ('pause' in data) {
      if (data.pause === paused) return;
      paused = data.pause;
      if (!clock) return;
      if (paused) {
        stop();
        const before = clock.rows;
        clock.pause(performance.now());
        if (clock.rows > before) post(clock);
      } else {
        clock.resume(performance.now());
        if (!clock.done) timer = setTimeout(tick, INTERVAL_MS);
      }
      return;
    }
    if (clock) return;
    clock = new Clock(data.rate, performance.now(), data.limit ?? 0);
    if (paused) clock.pause(performance.now());
    else timer = setTimeout(tick, INTERVAL_MS);
  };
}
