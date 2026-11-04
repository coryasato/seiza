/**
 * A contender build's feature level (`scenarios.ts`, `Level`), at build
 * time: both contenders' Vite configs take it from Vite's mode (`--mode
 * wide`, which the recipes and the perf harness's `preview` pass; any other
 * mode is the base), each level a build of its own at a base of its own,
 * into `dist/` or `dist-<level>/`.
 */

import type { Plugin } from 'vite';
import { LEVEL_FEATURES, type Level } from './scenarios.ts';

export function levelOf(mode: string): Level {
  return Object.hasOwn(LEVEL_FEATURES, mode) ? (mode as Level) : 'base';
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
