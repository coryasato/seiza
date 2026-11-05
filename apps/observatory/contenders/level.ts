/**
 * A contender build's feature level (`scenarios.ts`, `Level`), at build
 * time: both contenders' Vite configs take it from Vite's mode (`--mode
 * wide`, which the recipes and the perf harness's `preview` pass; Vite's own
 * modes are the base), each level a build of its own at a base of its own,
 * into `dist/` or `dist-<level>/`. A level the side doesn't build yet (in
 * `LEVEL_FEATURES`, not its `BUILT`) fails the build rather than build one
 * it has no code for.
 */

import type { Plugin } from 'vite';
import type { Side } from './contract.ts';
import { BUILT, LEVEL_FEATURES, type Level } from './scenarios.ts';

/** `side`'s build level from Vite's `mode`: one of the levels it builds
 *  (`BUILT`), or the base for Vite's own modes. */
export function levelOf(side: Side, mode: string): Level {
  if (BUILT[side].includes(mode as Level)) return mode as Level;
  if (Object.hasOwn(LEVEL_FEATURES, mode)) throw new Error(`--mode ${mode}: the ${side} contender doesn't build that level yet (\`scenarios.ts\`'s BUILT)`);
  return 'base';
}

/** The build's directory for `level`: `dist` or `dist-<level>`. */
export const levelOutDir = (level: Level): string => `dist${level === 'base' ? '' : `-${level}`}`;

/**
 * `__LEVEL__` as a constant (`src/env.d.ts` declares it): the build drops
 * every branch of another level's, so neither level's bundle carries the
 * other's code. A plugin, so a prerender's own server (which reads no
 * config file) gets it too.
 */
export function levelConstants(level: Level): Plugin {
  return {
    name: 'observatory:level',
    config: () => ({ define: { __LEVEL__: JSON.stringify(level) } }),
  };
}
