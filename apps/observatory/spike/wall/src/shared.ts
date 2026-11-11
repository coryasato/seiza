/** What both wall spike pages share: the stop's desks, the feed's worker
 *  (the feed spike's: market watch's format over the shown desks'
 *  instruments), started once every table has filled, and the logs. */

import { WALL_INSTRUMENTS } from '../../../contenders/wall/instruments.ts';
import { DESKS } from '../../../contenders/wall/names.ts';

export const params = new URLSearchParams(location.search);
/** `?tables=<n>`: the stop, 4, 6, or 8 desks. */
export const TABLES = Number(params.get('tables') ?? 6);
if (![4, 6, 8].includes(TABLES)) throw new Error(`?tables=${params.get('tables')}: 4, 6, or 8`);
/** `?rate=<n>`: ticks a second a desk (the canvas's 2k). */
export const RATE = Number(params.get('rate') ?? 2000);
export const SEED = 0x3a11;
export const HOLD = params.has('hold');
/** `?drop=<seq>`: that batch never reaches the side (the gap check's control). */
const DROP = params.has('drop') ? Number(params.get('drop')) : -1;
export const DESK_ROWS = 50;
export const NAMES = DESKS.slice(0, TABLES);
export const SHOWN = WALL_INSTRUMENTS.slice(0, TABLES * DESK_ROWS);

export interface WallLog {
  /** `[seq, ticks, sent (page ms), mask, …generation per table]` per batch. */
  batches(): number[][];
  /** `[at, …highest generation drawn per table]` per frame that drew a re-read. */
  refreshed(): number[][];
  /** Each batch refused whole (a bad length, an instrument past the shown) or that threw, and why. */
  failures(): string[];
  tables: number;
}

/** Splits a flat log into records of `width`. */
export function records(flat: ArrayLike<number>, width: number): number[][] {
  const out: number[][] = [];
  for (let i = 0; i + width <= flat.length; i += width) out.push(Array.from({ length: width }, (_, k) => flat[i + k]!));
  return out;
}

/** Resolves after `mark` is set. */
export function afterMark(mark: string): Promise<void> {
  return new Promise((resolve) => {
    if (performance.getEntriesByName(mark).length) return resolve();
    const observer = new PerformanceObserver(() => {
      if (!performance.getEntriesByName(mark).length) return;
      observer.disconnect();
      resolve();
    });
    observer.observe({ type: 'mark' });
  });
}

/** The feed, once every table has filled (`wall:filled`): each batch to `onBatch` in its message's task. */
export function startFeed(onBatch: (batch: ArrayBuffer) => void): void {
  void afterMark('wall:filled').then(() => {
    const worker = new Worker(new URL('../../src/feed-worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }: MessageEvent<ArrayBuffer>) => {
      if (new DataView(data).getUint32(0, true) !== DROP) onBatch(data);
    };
    worker.postMessage({ rate: RATE * TABLES, seed: SEED, send: 'batch', limit: 0, prices: SHOWN.map(([, , price]) => price) });
  });
}
