/**
 * A contender build's feature level (`scenarios.ts`, `Level`), at build
 * time: both contenders' Vite configs take it from Vite's mode (`--mode
 * wide`, which the recipes and the perf harness's `preview` pass; any other
 * mode is the base), each level a build of its own at a base of its own,
 * into `dist/` or `dist-<level>/`. Node only: it reads `data/MANIFEST.json`.
 */

import { readFileSync } from 'node:fs';
import type { Plugin } from 'vite';
import { LEVEL_FEATURES, SCENARIOS, type Level } from './scenarios.ts';

export function levelOf(mode: string): Level {
  return Object.hasOwn(LEVEL_FEATURES, mode) ? (mode as Level) : 'base';
}

/** The build's directory for `level`: `dist` or `dist-<level>`. */
export const levelOutDir = (level: Level): string => `dist${level === 'base' ? '' : `-${level}`}`;

/** The level's data files' heat domains (`MANIFEST.json`'s `range`): the
 *  only numbers of the manifest a contender needs, compiled in. */
function rangesOf(level: Level): Record<string, [number, number]> {
  const manifest = JSON.parse(readFileSync(new URL('../data/MANIFEST.json', import.meta.url), 'utf8')) as Record<string, { range?: [number, number] }>;
  return Object.fromEntries(
    SCENARIOS.filter((scenario) => scenario.level === level && scenario.level !== 'base').map((scenario) => {
      const range = manifest[scenario.data]?.range;
      if (!range) throw new Error(`data/MANIFEST.json has no range for ${scenario.data}: run \`just observatory data\``);
      return [scenario.data, range];
    }),
  );
}

/**
 * `__LEVEL__` and `__RANGES__` as constants (`src/env.d.ts` declares them):
 * the build drops every branch of another level's, so neither level's
 * bundle carries the other's code. A plugin, so a prerender's own server
 * (which reads no config file) gets them too.
 */
export function levelConstants(level: Level): Plugin {
  return {
    name: 'observatory:level',
    config: () => ({ define: { __LEVEL__: JSON.stringify(level), __RANGES__: JSON.stringify(rangesOf(level)) } }),
  };
}
