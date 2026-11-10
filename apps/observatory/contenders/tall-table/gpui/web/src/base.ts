/**
 * The base level's host (`level.ts`'s, which `vite.config.ts` resolves to
 * this on the base build): the admin table's fonts toggle
 * (`docs/DECISIONS.md`, "Scenarios"). With `?fonts` on the admin table, it
 * turns the wasm's toggle on before `start` (`crate/src/fonts.rs`: the
 * browser draws Han and Hangul, and the mark to set once the faces are
 * drawn), then at the first `contender:filled` loads `fonts.ts`, which
 * fetches the script faces. Big file, and the admin table without
 * `?fonts`, get nothing.
 */

// The base level's bindings: `scriptFonts` exists only there (the crate's
// `fonts`), so it's reached through the namespace, as the tail level's are.
import * as pkg from '../pkg/tall_table_gpui.js';
import { FONTS_PARAM, MARKS } from '../../../../contract.ts';
import { ADMIN_TABLE, type Picked } from '../../../../scenarios.ts';
import type { LevelHost } from './level.ts';

/** `crate/src/fonts.rs`'s exports. */
export interface FontsExports {
  scriptFonts(mark: string): void;
  addFonts(faces: Uint8Array[]): void;
}

export const levelHost = (picked: Picked): LevelHost | undefined => {
  if (picked.scenario.id !== ADMIN_TABLE.id || !new URLSearchParams(location.search).has(FONTS_PARAM)) return undefined;
  return {
    numbers: [],
    beforeStart: () => {
      (pkg as unknown as FontsExports).scriptFonts(MARKS.fonts);
      new PerformanceObserver((list, observer) => {
        if (!list.getEntriesByName(MARKS.filled).length) return;
        observer.disconnect();
        void import('./fonts.ts').then(({ loadScriptFonts }) => loadScriptFonts());
      }).observe({ type: 'mark', buffered: true });
    },
  };
};
