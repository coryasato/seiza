/**
 * The market level's host (`level.ts`'s, which `vite.config.ts` resolves
 * to this on the market build): market watch's numbers for `start` (the
 * flash, the rise's and fall's colors per theme, each instrument's
 * decimals: `scenarios.ts`'s and `feed.ts`'s, never copied into Rust), and
 * the feed's worker, made by the wasm only when the feed starts, once the
 * table has filled (`crate/src/feed.rs`). `?ticks=<n>` ends the feed after
 * n ticks (0, the default: never).
 */

// The level's bindings (`pkg-market/`, by `vite.config.ts`'s alias): `market`
// exists only there, so it's reached through the namespace.
import * as pkg from '../pkg/tall_table_gpui.js';
import { INSTRUMENTS, decimalsOf } from '../../../../market/feed.ts';
import type { FeedStart } from '../../../../market/worker.ts';
import type { MarketScenario, Picked } from '../../../../scenarios.ts';
import type { LevelHost } from './level.ts';

interface MarketExports {
  market(makeWorker: () => Worker, start: FeedStart, flash: string[]): void;
}

export const TICKS_PARAM = 'ticks';

export const levelHost = (picked: Picked): LevelHost | undefined => {
  if (picked.scenario.level !== 'market') return undefined;
  const { scenario, stop } = picked as Picked<MarketScenario>;
  const { light, dark } = scenario.signs;
  const asked = new URLSearchParams(location.search).get(TICKS_PARAM) ?? '0';
  const limit = /^\d+$/.test(asked) ? Number(asked) : NaN;
  return {
    numbers: [scenario.flash.ms, scenario.flash.mix, ...light.up, ...light.down, ...dark.up, ...dark.down, ...INSTRUMENTS.map(({ price }) => decimalsOf(price))],
    failure: Number.isSafeInteger(limit) ? undefined : `?${TICKS_PARAM}=${asked}: not a count of ticks`,
    beforeStart: () =>
      (pkg as unknown as MarketExports).market(
        () => new Worker(new URL('../../../../market/worker.ts', import.meta.url), { type: 'module' }),
        { rate: stop.rate, seed: scenario.seed, limit },
        [...scenario.flash.columns],
      ),
  };
};
