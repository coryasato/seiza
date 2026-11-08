/** What both spike pages share: the file fetched whole after first paint,
 *  the clock started once the table is open, and the run's logs. */

import { DATA } from '../../../contenders/paths.ts';
import { DATA_FILE, FILE } from './sql.ts';

export const params = new URLSearchParams(location.search);
export const RATE = Number(params.get('rate') ?? 10_000);
export const HOLD = params.has('hold');

export interface TailLog {
  /** `[rows, at]`: each clock message, its post stamp in page ms. */
  batches: [number, number][];
  /** `[rows, at]`: each frame's drawn tail, the page clock in its task. */
  drawn(): [number, number][];
  /** `[on, at]`: each change of following. */
  following(): [number, number][];
  /** `[top, at]`: each frame whose top moved while not following (GPUI's probe). */
  moved?(): [number, number][];
  /** `[top, rows]`: the view's top row and the rows. */
  view(): [number, number];
  pause(on: boolean): void;
  /** Rows in the file, once open. */
  open: number;
}

/** Resolves after `mark` is set (a first frame's). */
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

export const fetchFile = (): Promise<File> =>
  fetch(`${DATA}${DATA_FILE}`)
    .then((response) => {
      if (!response.ok) throw new Error(`${DATA_FILE}: ${response.status}`);
      return response.blob();
    })
    .then((blob) => new File([blob], FILE));

/** Starts the clock; each message recorded, then handed to `onRows`. */
export function startClock(log: TailLog, onRows: (rows: number) => void): Worker {
  const worker = new Worker(new URL('./clock.ts', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data: [rows, at] }: MessageEvent<[number, number]>) => {
    log.batches.push([rows, at - performance.timeOrigin]);
    onRows(rows);
  };
  worker.postMessage({ rate: RATE });
  log.pause = (on) => worker.postMessage({ pause: on });
  return worker;
}
