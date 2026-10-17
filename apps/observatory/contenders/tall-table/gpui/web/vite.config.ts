import { defineConfig } from 'vite';
import { duckdb } from '@seiza/duckdb/vite';
import { PLACEHOLDER_ID } from '@seiza/web/placeholder';
import { seizaViteConfig } from '@seiza/web/vite';
import { observatoryData } from '../../../data.ts';
import { contenderBuild } from '../../../engine.ts';

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

// Under /observatory/ (the observatory's CLAUDE.md, rule 2): the engine at
// /observatory/duckdb/ (its bundles and extensions, `contenderBuild`), the
// data at /observatory/data/.
export default defineConfig(
  seizaViteConfig(
    {
      // What first paint waits on. DuckDB's bundles load after it and must not be listed here.
      preload: ['tall_table_gpui_bg.wasm', 'IBMPlexSans-Regular.ttf'],
      placeholder: { body: firstFrame },
    },
    { base: '/observatory/', plugins: [duckdb({ extensionDir: 'duckdb' }), observatoryData(), contenderBuild()] },
  ),
);
