/**
 * The wall level's host (`level.ts`'s, which `vite.config.ts` resolves to
 * this on the wall build): the monitoring wall's numbers for `start` (the
 * stop's tables, the file's rows, the grid; then market watch's: the flash,
 * the rise's and fall's colors per theme, and each shown instrument's
 * decimals, `crate/src/scene/wall.rs`'s `Wall::new`), the desks' names, and
 * the feed's worker over the stop's desks, made by the wasm only once every
 * table has filled (`crate/src/feed.rs`). All of it `scenarios.ts`'s and
 * `contenders/wall/`'s, never copied into Rust. `?ticks=<n>` ends the feed
 * after n ticks (0, the default: never), as on market watch.
 */

// The level's bindings (`pkg-wall/`, by `vite.config.ts`'s alias): `market`
// and `wallDesks` exist only there, so they're reached through the namespace.
import * as pkg from '../pkg/tall_table_gpui.js';
import { decimalsOf } from '../../../../market/feed.ts';
import type { FeedStart } from '../../../../market/worker.ts';
import { WALL_INSTRUMENTS } from '../../../../wall/instruments.ts';
import { wallInstruments } from '../../../../wall/desks.ts';
import type { Picked, WallScenario } from '../../../../scenarios.ts';
import type { LevelHost } from './level.ts';

interface WallExports {
  market(makeWorker: () => Worker, start: FeedStart, flash: string[]): void;
  wallDesks(names: string[]): void;
}

/** Market watch's (`market.ts`'s `TICKS_PARAM`): a module of its own, so
 *  this build carries none of market watch's host. */
const TICKS_PARAM = 'ticks';

export const levelHost = (picked: Picked): LevelHost | undefined => {
  if (picked.scenario.level !== 'wall') return undefined;
  const { scenario, stop } = picked as Picked<WallScenario>;
  const { light, dark } = scenario.signs;
  const { gap, title, rowHeight, textSize, widths, oneColumnBelow, phoneRows, columnWidth } = scenario.grid;
  const shown = wallInstruments(stop.tables);
  const asked = new URLSearchParams(location.search).get(TICKS_PARAM) ?? '0';
  const limit = /^\d+$/.test(asked) ? Number(asked) : NaN;
  return {
    numbers: [
      stop.tables,
      WALL_INSTRUMENTS.length,
      gap,
      title,
      rowHeight,
      textSize,
      ...widths,
      oneColumnBelow,
      phoneRows,
      columnWidth,
      scenario.flash.ms,
      scenario.flash.mix,
      ...light.up,
      ...light.down,
      ...dark.up,
      ...dark.down,
      ...shown.map(({ price }) => decimalsOf(price)),
    ],
    failure: Number.isSafeInteger(limit) ? undefined : `?${TICKS_PARAM}=${asked}: not a count of ticks`,
    beforeStart: () => {
      const exports = pkg as unknown as WallExports;
      exports.wallDesks([...scenario.desks]);
      exports.market(
        () => new Worker(new URL('../../../../market/worker.ts', import.meta.url), { type: 'module' }),
        { rate: scenario.rate * stop.tables, seed: scenario.seed, limit, prices: shown.map(({ price }) => price) },
        [...scenario.flash.columns],
      );
    },
  };
};
