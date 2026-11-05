/**
 * Market watch's feed worker: one per contender frame, ended with it (one
 * contender runs at a time). Started by a message (`FeedStart`), it sends
 * `rate` ticks a second, about every 16 ms a batch of the ticks due
 * (`feed.ts`'s `Rate`), each batch one transferred `ArrayBuffer`. The send
 * time is stamped last, right before the post, so the transport's time
 * excludes generating; the generation's ms go in the header beside it.
 *
 * A contender starts it with
 * `new Worker(new URL('…/contenders/market/worker.ts', import.meta.url), { type: 'module' })`.
 */

import { AT, Feed, Rate } from './feed.ts';

/** What starts the feed. */
export interface FeedStart {
  rate: number;
  seed: number;
  /** Stop after this many ticks (0: never). */
  limit: number;
}

/** The interval between batches, ms: about a frame. */
export const INTERVAL_MS = 16;

// The contenders' tsconfigs have no WebWorker lib: the two calls used, typed here.
declare const self: { onmessage: ((event: MessageEvent<FeedStart>) => void) | null; postMessage(message: unknown, transfer: Transferable[]): void };

if (typeof self !== 'undefined' && typeof (self as unknown as { importScripts?: unknown }).importScripts === 'function') {
  self.onmessage = ({ data: { rate, seed, limit } }: MessageEvent<FeedStart>) => {
    self.onmessage = null;
    const feed = new Feed(seed);
    const owed = new Rate(rate, performance.now());
    let seq = 0;
    let sent = 0;
    const tick = () => {
      let count = owed.due(performance.now());
      if (limit) count = Math.min(count, limit - sent);
      if (count > 0) {
        const started = performance.now();
        const buffer = feed.batch(seq++, count);
        const view = new DataView(buffer);
        view.setFloat64(AT.generation, performance.now() - started, true);
        view.setFloat64(AT.sent, performance.timeOrigin + performance.now(), true);
        self.postMessage(buffer, [buffer]);
        sent += count;
      }
      if (!limit || sent < limit) setTimeout(tick, INTERVAL_MS);
    };
    setTimeout(tick, INTERVAL_MS);
  };
}
