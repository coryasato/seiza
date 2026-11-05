/**
 * The flash (the table's `live` with `custom-cells`, market watch's level):
 * a cell whose value a re-read changed is drawn over its fill in its
 * column's flash ramp, faded by opacity to nothing. A port of the tall
 * table's `src/flash.rs`, decision for decision: `paint.json`'s `flash`
 * pins it, with its controls. The changes are found off the frame, when a
 * re-read lands (`TablePaging`'s `onLanded`, over the rows `live.ts` kept),
 * by comparing the old page with the new; the live flashes are kept here,
 * each dropped once it ends.
 *
 * Market watch's level alone imports it: no other level's bundle carries it.
 */

import type { CellValue } from './format.ts';

/** Where a change flashes in its column's ramp, or null for no change: a
 *  float's rise at 1, its fall at 0, any other change (text, NULL to a
 *  value or back, NaN to a number or back, an integer's or a date's) at
 *  0.5. Two NaNs are equal, so a NaN cell doesn't flash on every read; so
 *  are 0 and -0. Arrow gives an INTEGER and a DATE as a `number` too, so
 *  whether its values are floats is the column's (`float`), never `typeof`'s. */
export function change(old: CellValue | undefined, next: CellValue | undefined, float: boolean): number | null {
  if (float && typeof old === 'number' && typeof next === 'number') {
    if (Number.isNaN(old) && Number.isNaN(next)) return null;
    if (next > old) return 1;
    if (next < old) return 0;
    if (next === old) return null;
    return 0.5;
  }
  return old === next ? null : 0.5;
}

/** A flash's opacity `elapsed` ms into its `duration`, faded linearly to
 *  nothing, or null once it's over. Under reduced motion it holds at 1. */
export function opacity(elapsed: number, duration: number, reduceMotion: boolean): number | null {
  if (elapsed >= duration) return null;
  if (reduceMotion) return 1;
  return 1 - elapsed / duration;
}

/** The flash fixture's negative controls (`paint.json`'s `flash`); `null` in the contender. */
export type FlashControl = 'fade-backwards' | 'fall-as-rise' | null;

/** A cell's key: its row and column in one number (columns under 2^16). */
const key = (row: number, column: number): number => row * 65_536 + column;

interface Flash {
  /** Its place in the column's ramp. */
  at: number;
  /** When it started, ms on the caller's clock, and how long it lasts. */
  start: number;
  duration: number;
}

/** The live flashes, by row and column. */
export class Flashes {
  private readonly live = new Map<number, Flash>();
  private readonly control: FlashControl;

  constructor(control: FlashControl = null) {
    this.control = control;
  }

  get size(): number {
    return this.live.size;
  }

  clear(): void {
    this.live.clear();
  }

  /** `row`'s cell in `column` changed at `now`: it flashes at `at` for
   *  `duration` ms, from the start again if it was flashing. */
  start(row: number, column: number, at: number, now: number, duration: number): void {
    this.live.set(key(row, column), { at: this.control === 'fall-as-rise' && at === 0 ? 1 : at, start: now, duration });
  }

  /** Drops the flashes that ended by `now`, on screen or not. */
  expire(now: number): void {
    for (const [cell, flash] of this.live) if (now >= flash.start + flash.duration) this.live.delete(cell);
  }

  /** The cell's flash at `now`: its place in the ramp, its opacity, and
   *  when it started (a DOM side's animation runs from there). */
  at(row: number, column: number, now: number, reduceMotion = false): { at: number; opacity: number; start: number } | null {
    const flash = this.live.get(key(row, column));
    if (!flash) return null;
    const faded = opacity(Math.max(0, now - flash.start), flash.duration, reduceMotion);
    if (faded === null) return null;
    return { at: flash.at, opacity: this.control === 'fade-backwards' ? 1 - faded : faded, start: flash.start };
  }

  /** When the next flash ends, if any is live. */
  nextEnd(): number | null {
    let next: number | null = null;
    for (const flash of this.live.values()) next = Math.min(next ?? Infinity, flash.start + flash.duration);
    return next;
  }
}

/** A page's cell values, as the flash compares them. */
export interface FlashPage {
  value(row: number, column: number): CellValue | undefined;
}

/**
 * A re-read of the page whose first row is `first` landed (`note_flashes`):
 * the cells of the flashing `columns` (each its index, its duration in ms,
 * and whether its values are floats) in
 * `rows`, the rows invalidated since the drawn page's read started, whose
 * values differ from the page it replaces start to flash at `now`.
 */
export function noteFlashes(flashes: Flashes, columns: ReadonlyArray<{ index: number; duration: number; float: boolean }>, first: number, old: FlashPage, landed: FlashPage, rows: Iterable<number>, now: number): void {
  const changed = [...rows];
  for (const { index, duration, float } of columns) {
    for (const row of changed) {
      const at = change(old.value(row - first, index), landed.value(row - first, index), float);
      if (at !== null) flashes.start(row, index, at, now, duration);
    }
  }
}
