/**
 * The build constant a contender's bundle folds (`__LEVEL__`,
 * `vite.config.ts`): the data layer reads it as it runs, so the tests set
 * it. Importing this sets the base level, so no test depends on another
 * having set it; `asLevel` runs a test as another level's, restoring the
 * one before (the tests in a file run one at a time).
 */

import type { Level } from '../../../../scenarios.ts';

const global = globalThis as { __LEVEL__?: Level };
global.__LEVEL__ ??= 'base';

export async function asLevel<T>(level: Level, run: () => T | Promise<T>): Promise<T> {
  const before = global.__LEVEL__;
  global.__LEVEL__ = level;
  try {
    return await run();
  } finally {
    global.__LEVEL__ = before;
  }
}
