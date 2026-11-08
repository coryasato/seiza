/**
 * Live tail's clock: the rows due at a rate, as market watch's feed counts
 * its ticks (`../market/feed.ts`'s `Rate`, whose catch-up cap it shares).
 * Pure, so its fixture (`fixtures/clock.json`) runs it on a script's times;
 * `worker.ts` runs it on the worker's own.
 *
 * Rows due = the rate × the time since the start, its fraction carried to
 * the next call, a gap past `CATCH_UP_MS` counted only that far. A pause
 * stops the count; a resume starts it again from the resume's time, owing
 * nothing for the pause. A limit (`?rows=<n>`, `data.ts`'s `limitFrom`: memory's
 * equal work) stops the count at n rows; 0, the default, never.
 */

import { CATCH_UP_MS, Rate } from '../market/feed.ts';

export { CATCH_UP_MS };

export class Clock {
  private readonly rate: number;
  private readonly limit: number;
  private owed: Rate;
  private paused = false;
  /** Rows due so far. */
  rows = 0;

  constructor(rate: number, now: number, limit = 0) {
    this.rate = rate;
    this.limit = limit;
    this.owed = new Rate(rate, now);
  }

  /** The limit reached: no row will come due again. */
  get done(): boolean {
    return this.limit > 0 && this.rows >= this.limit;
  }

  /** Counts the rows due by `now`; how many were added. */
  advance(now: number): number {
    if (this.paused || this.done) return 0;
    const due = this.limit > 0 ? Math.min(this.owed.due(now), this.limit - this.rows) : this.owed.due(now);
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
