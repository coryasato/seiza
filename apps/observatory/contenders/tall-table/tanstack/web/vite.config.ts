import { defineConfig } from 'vite';
import { duckdb } from '@seiza/duckdb/vite';
import { seizaViteConfig } from '@seiza/web/vite';
import { observatoryData } from '../../../data.ts';
import { contenderBuild } from '../../../engine.ts';

// Under /observatory/ (the observatory's CLAUDE.md, rule 2): the engine at
// /observatory/duckdb/ (its bundles and extensions, `contenderBuild`), the
// data at /observatory/data/.
export default defineConfig(
  seizaViteConfig(
    // The first screen is the page's own HTML: nothing to preload.
    { preload: [] },
    { base: '/observatory/', plugins: [duckdb({ extensionDir: 'duckdb' }), observatoryData(), contenderBuild()] },
  ),
);
