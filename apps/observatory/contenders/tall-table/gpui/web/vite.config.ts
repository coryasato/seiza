import { defineConfig } from 'vite';
import { PLACEHOLDER_ID } from '@seiza/web/placeholder';
import { seizaViteConfig } from '@seiza/web/vite';
import { readFileSync } from 'node:fs';
import { contenderBuild } from '../../../engine.ts';
import { contenderBase, UI_FONT } from '../../../paths.ts';
import { LEVEL_FEATURES, SCENARIOS, type Level } from '../../../scenarios.ts';

/**
 * The feature level a build is (`contenders/scenarios.ts`), from Vite's
 * mode: `--mode wide` (`just observatory gpui-build wide`, or the perf
 * harness's `preview({ mode })`), whose wasm `gpui-wasm` builds with the
 * crate's feature of that name into `pkg-wide/`; any other mode is the
 * base. Each level is a build of its own, at a base of its own, into
 * `dist/` or `dist-<level>/`.
 */
function levelOf(mode: string): Level {
  return Object.hasOwn(LEVEL_FEATURES, mode) ? (mode as Level) : 'base';
}

/** The level's data files' heat domains (`MANIFEST.json`'s `range`): the
 *  only numbers of the manifest the page needs, compiled in. */
function rangesOf(level: Level): Record<string, [number, number]> {
  const manifest = JSON.parse(readFileSync(new URL('../../../../data/MANIFEST.json', import.meta.url), 'utf8')) as Record<string, { range?: [number, number] }>;
  return Object.fromEntries(
    SCENARIOS.filter((scenario) => scenario.level === level && scenario.level !== 'base').map((scenario) => {
      const range = manifest[scenario.data]?.range;
      if (!range) throw new Error(`data/MANIFEST.json has no range for ${scenario.data}: run \`just observatory data\``);
      return [scenario.data, range];
    }),
  );
}

/**
 * The first frame `crate/src/host.rs` draws: the table's empty frame with
 * the engine's status line ("Engine loading…", as the first frame says:
 * the engine starts after it). Keep the two matched: `just observatory
 * placeholder` compares screenshots of both.
 */
const firstFrame = `
<div class="sz-p-4">
  <div class="sz-frame sz-text-sm sz-muted" elementtiming="${PLACEHOLDER_ID}">Engine loading…</div>
</div>`;

// At /observatory/contenders/tall-table/gpui/[<level>/] (the observatory's CLAUDE.md,
// rule 2): the engine at /observatory/duckdb/ (its bundles and extensions,
// `contenderBuild`), the data at /observatory/data/, the font at /fonts/.
export default defineConfig(({ mode }) => {
  const level = levelOf(mode);
  const suffix = level === 'base' ? '' : `-${level}`;
  const outDir = `dist${suffix}`;
  return seizaViteConfig(
    {
      // What first paint waits on. DuckDB's bundles load after it and must not be listed here.
      preload: ['tall_table_gpui_bg.wasm', UI_FONT],
      placeholder: { body: firstFrame },
    },
    {
      base: contenderBase('tall-table', 'gpui', level),
      plugins: [contenderBuild(outDir)],
      build: { outDir },
      define: { __LEVEL__: JSON.stringify(level), __RANGES__: JSON.stringify(rangesOf(level)) },
      // The level's wasm and its bindings (`pkg-<level>/`).
      resolve: { alias: suffix ? [{ find: /^\.\.\/pkg\//, replacement: `../pkg${suffix}/` }] : [] },
    },
  );
});
