/**
 * What a feature level adds to the host (`main.ts`), on the wide level:
 * the page's copy line (`contenders/tools.ts`, with `?readout` only: the
 * wasm's reports posted to the page, and `__contenderTools` calling its
 * `toolsCopy` and `toolsCancel` inside the page's click). The wide sheet's
 * numbers are `main.ts`'s. The base level's build resolves this module to
 * `base.ts` instead (the admin table's fonts toggle), the market level's to
 * `market.ts`, the tail level's to `tail.ts`, and the wall level's to
 * `wall.ts` (`vite.config.ts`), so no other build carries its toggle, its
 * feed, its clock, its desks, or these tools.
 */

// The level's bindings (`pkg-wide/`, by `vite.config.ts`'s alias): `tools`
// exists only there, so it's reached through the namespace.
import * as pkg from '../pkg/tall_table_gpui.js';
import { toolsReporter, type ToolsMessage } from '../../../../tools.ts';
import type { Picked } from '../../../../scenarios.ts';

export interface LevelHost {
  /** What `start` takes as the level's numbers (`crate/src/scene.rs`). */
  numbers: number[];
  /** Why the frame can't load (a parameter out of range), shown and marked. */
  failure?: string;
  /** Runs right before `start`. */
  beforeStart(): void;
}

interface WideExports {
  tools(report: (message: Omit<ToolsMessage, 'seiza'>) => void): void;
  toolsCopy(): void;
  toolsCancel(): void;
}

export const levelHost = (picked: Picked): LevelHost | undefined => {
  if (picked.scenario.level !== 'wide') return undefined;
  return {
    numbers: [],
    beforeStart: () => {
      const exports = pkg as unknown as WideExports;
      const report = toolsReporter({ copy: () => exports.toolsCopy(), cancel: () => exports.toolsCancel() });
      if (report) exports.tools(report);
    },
  };
};
