/**
 * Live tail's clock: the rows due at a rate, as market watch's feed counts
 * its ticks (`../market/feed.ts`'s `Rate`, whose catch-up cap it shares).
 * Pure, so its fixture (`fixtures/clock.json`) runs it on a script's times;
 * `worker.ts` runs it on the worker's own.
 *
 * Rows due = the rate × the time since the start, its fraction carried to
 * the next call, a gap past `CATCH_UP_MS` counted only that far. A pause
 * stops the count; a resume starts it again from the resume's time, owing
 * nothing for the pause.
 */

import { CATCH_UP_MS, Rate } from '../market/feed.ts';

export { CATCH_UP_MS };

export class Clock {
  private readonly rate: number;
  private owed: Rate;
  private paused = false;
  /** Rows due so far. */
  rows = 0;

  constructor(rate: number, now: number) {
    this.rate = rate;
    this.owed = new Rate(rate, now);
  }

  /** Counts the rows due by `now`; how many were added. */
  advance(now: number): number {
    if (this.paused) return 0;
    const due = this.owed.due(now);
    this.rows += due;
    return due;
  }

  pause(now: number): void {
    if (this.paused) return;
    this.advance(now);
    this.paused = true;
  }

  resume(now: number): void {
    if (!this.paused) return;
    this.paused = false;
    this.owed = new Rate(this.rate, now);
  }
}
