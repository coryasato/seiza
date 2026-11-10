/**
 * What a feature level adds to the host (`main.ts`), on the wide level:
 * nothing (the wide sheet's numbers are `main.ts`'s). The base level's
 * build resolves this module to `base.ts` instead (the admin table's fonts
 * toggle), the market level's to `market.ts`, and the tail level's to
 * `tail.ts` (`vite.config.ts`), so no other build carries its toggle, its
 * feed, or its clock.
 */

import type { Picked } from '../../../../scenarios.ts';

export interface LevelHost {
  /** What `start` takes as the level's numbers (`crate/src/scene.rs`). */
  numbers: number[];
  /** Why the frame can't load (a parameter out of range), shown and marked. */
  failure?: string;
  /** Runs right before `start`. */
  beforeStart(): void;
}

export const levelHost = (picked: Picked): LevelHost | undefined => {
  void picked;
  return undefined;
};
