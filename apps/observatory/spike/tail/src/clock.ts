/**
 * Live tail's clock, the spike's (throwaway): one worker per page, as
 * market watch's feed is. Started by `{ rate }`, it posts the rows due about
 * every 16 ms, `[rows, at]`: the running count and the post's stamp in epoch
 * ms (the page subtracts its own `timeOrigin`). A gap past 100 ms catches up
 * only that much (market watch's `Rate`). `{ pause: true }` stops the count
 * (the scroll back's control), `{ pause: false }` resumes it.
 */

import { Rate } from '../../../contenders/market/feed.ts';

const INTERVAL_MS = 16;

declare const self: { onmessage: ((event: MessageEvent<{ rate?: number; pause?: boolean }>) => void) | null; postMessage(message: unknown): void };

let rate: Rate | null = null;
let rows = 0;
let paused = false;
let perRate = 0;

self.onmessage = ({ data }) => {
  if (data.pause !== undefined) {
    paused = data.pause;
    if (!paused && rate) rate = new Rate(perRate, performance.now());
    return;
  }
  if (rate || data.rate === undefined) return;
  perRate = data.rate;
  rate = new Rate(data.rate, performance.now());
  const tick = () => {
    const due = paused ? 0 : rate!.due(performance.now());
    if (due > 0) {
      rows += due;
      self.postMessage([rows, performance.timeOrigin + performance.now()]);
    }
    setTimeout(tick, INTERVAL_MS);
  };
  setTimeout(tick, INTERVAL_MS);
};
