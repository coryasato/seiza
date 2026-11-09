/**
 * The tail level's host (`level.ts`'s, which `vite.config.ts` resolves to
 * this on the tail build): live tail's numbers for `start` (the error
 * status's color per theme and the columns' widths, `scenarios.ts`'s, never
 * copied into Rust), how
 * to fetch the file whole, and the clock's worker, which the wasm makes
 * only once the table is open and the file registered (`crate/src/clock.rs`),
 * stopping at `?rows=<n>` rows if asked (`tail/data.ts`'s `limitFrom`); with
 * `?measure`, `__contender.pause`, the clock paused and resumed; with
 * `?readout`, the page's follow toggle (`followToggle`: its asks to the
 * wasm's `followTail`, the wasm's reports to the page).
 */

// The level's bindings (`pkg-tail/`, by `vite.config.ts`'s alias): `tail`
// exists only there, so it's reached through the namespace.
import * as pkg from '../pkg/tall_table_gpui.js';
import { measuring, type Contender } from '../../../../contract.ts';
import { followToggle } from '../../../../follow.ts';
import { DATA } from '../../../../paths.ts';
import { DATA_FILE, WHOLE_FILE, limitFrom } from '../../../../tail/data.ts';
import type { TailStart } from '../../../../tail/worker.ts';
import type { Picked, TailScenario } from '../../../../scenarios.ts';
import type { LevelHost } from './level.ts';

interface TailExports {
  tail(fetchWhole: () => Promise<File>, makeWorker: () => Worker, start: TailStart, report?: (on: boolean, rows: number) => void): void;
  clockPause(on: boolean): void;
  followTail(on: boolean): void;
}

/** The data file in one request, as the `File` the engine registers. */
const fetchWhole = async (): Promise<File> => {
  const response = await fetch(`${DATA}${DATA_FILE}`);
  if (!response.ok) throw new Error(`${DATA_FILE}: ${response.status}`);
  return new File([await response.blob()], WHOLE_FILE);
};

export const levelHost = (picked: Picked): LevelHost | undefined => {
  if (picked.scenario.level !== 'tail') return undefined;
  const { scenario, stop } = picked as Picked<TailScenario>;
  const limit = limitFrom(location.search);
  return {
    numbers: [...scenario.error.light, ...scenario.error.dark, ...scenario.widths],
    failure: limit instanceof Error ? limit.message : undefined,
    beforeStart: () => {
      const exports = pkg as unknown as TailExports;
      const start: TailStart = { rate: stop.rate, limit: limit instanceof Error ? 0 : limit };
      const report = followToggle((on) => exports.followTail(on)) ?? undefined;
      exports.tail(fetchWhole, () => new Worker(new URL('../../../../tail/worker.ts', import.meta.url), { type: 'module' }), start, report);
      // The scroll back's control: the same gesture without the feed.
      const contender = (globalThis as { __contender?: Contender }).__contender;
      if (measuring() && contender) contender.pause = (on) => exports.clockPause(on);
    },
  };
};
