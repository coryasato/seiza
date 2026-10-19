import { defineConfig } from 'vite';
import { PLACEHOLDER_ID } from '@seiza/web/placeholder';
import { seizaViteConfig } from '@seiza/web/vite';
import { contenderBuild } from '../../../engine.ts';
import { contenderBase, UI_FONT } from '../../../paths.ts';

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

// At /observatory/contenders/tall-table/gpui/ (the observatory's CLAUDE.md,
// rule 2): the engine at /observatory/duckdb/ (its bundles and extensions,
// `contenderBuild`), the data at /observatory/data/, the font at /fonts/.
export default defineConfig(
  seizaViteConfig(
    {
      // What first paint waits on. DuckDB's bundles load after it and must not be listed here.
      preload: ['tall_table_gpui_bg.wasm', UI_FONT],
      placeholder: { body: firstFrame },
    },
    { base: contenderBase('tall-table', 'gpui'), plugins: [contenderBuild()] },
  ),
);
