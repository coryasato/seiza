/**
 * Live tail's clock fixture (`clock.json`): the rows due on a script's
 * times, the same count each side's receiver gets. Its controls, each a
 * clock gone wrong, must fail it.
 *
 * Run: `node --test` on this file (`just observatory fixtures`).
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { CATCH_UP_MS, Clock } from '../clock.ts';

interface Step {
  at?: number;
  pause?: number;
  resume?: number;
  rows: number;
}
interface Scenario {
  name: string;
  rate: number;
  steps: Step[];
}

/** What a step drives: the clock's three calls and its count. */
interface Counter {
  advance(now: number): unknown;
  pause(now: number): void;
  resume(now: number): void;
  readonly rows: number;
}

const fixture: { scenarios: Scenario[] } = JSON.parse(readFileSync(new URL('clock.json', import.meta.url), 'utf8'));

/** Each step whose count isn't the fixture's, as text. */
function mismatches(make: (rate: number, now: number) => Counter): string[] {
  const found: string[] = [];
  for (const { name, rate, steps } of fixture.scenarios) {
    const clock = make(rate, 0);
    for (const step of steps) {
      if (step.at !== undefined) clock.advance(step.at);
      else if (step.pause !== undefined) clock.pause(step.pause);
      else if (step.resume !== undefined) clock.resume(step.resume);
      if (clock.rows !== step.rows) found.push(`${name}, ${JSON.stringify(step)}: ${clock.rows}`);
    }
  }
  return found;
}

/** A control: the clock's rule changed in one way. */
class Control implements Counter {
  rows = 0;
  private owed = 0;
  private paused = false;
  private readonly rate: number;
  private last: number;
  private readonly kind: 'no-cap' | 'round' | 'pause-counts';
  constructor(rate: number, now: number, kind: 'no-cap' | 'round' | 'pause-counts') {
    this.rate = rate;
    this.last = now;
    this.kind = kind;
  }
  advance(now: number): void {
    if (this.paused && this.kind !== 'pause-counts') return;
    const ms = this.kind === 'no-cap' ? now - this.last : Math.min(now - this.last, CATCH_UP_MS);
    this.last = now;
    if (this.kind === 'round') {
      this.rows += Math.round((this.rate * ms) / 1000);
      return;
    }
    this.owed += this.rate * (ms / 1000);
    const count = Math.floor(this.owed);
    this.owed -= count;
    this.rows += count;
  }
  pause(now: number): void {
    this.advance(now);
    this.paused = true;
  }
  resume(now: number): void {
    this.paused = false;
    if (this.kind !== 'pause-counts') {
      this.last = now;
      this.owed = 0;
    }
  }
}

describe('clock.json', () => {
  test('the clock counts the rows due', () => {
    assert.ok(fixture.scenarios.length >= 4);
    assert.deepEqual(mismatches((rate, now) => new Clock(rate, now)), []);
  });

  for (const kind of ['no-cap', 'round', 'pause-counts'] as const)
    test(`control ${kind} fails it`, () => {
      assert.notDeepEqual(mismatches((rate, now) => new Control(rate, now, kind)), []);
    });
});
