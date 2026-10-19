import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { defineConfig } from 'vite';
import { prerender } from '@seiza/web/prerender';
import { seizaViteConfig } from '@seiza/web/vite';
import { contenderBuild } from '../../../engine.ts';
import { contenderBase } from '../../../paths.ts';
import type * as View from './src/view.ts';

/** The first screen, rendered by the view itself into the page's HTML (in
 *  dev too), which `main.ts` hydrates: React's prerendered first screen
 *  (root `CLAUDE.md`, "Comparison protocol"). */
const firstScreen = prerender<typeof View>({
  module: '/src/view.ts',
  render: ({ App, FIRST_SCREEN }) => renderToString(createElement(App, { load: FIRST_SCREEN })),
});

// At /observatory/contenders/tall-table/tanstack/ (the observatory's
// CLAUDE.md, rule 2): the engine at /observatory/duckdb/ (its bundles and
// extensions, `contenderBuild`), the data at /observatory/data/, the font
// at /fonts/.
export default defineConfig(
  seizaViteConfig(
    // The first screen is the page's own HTML: nothing to preload.
    { preload: [] },
    {
      base: contenderBase('tall-table', 'tanstack'),
      plugins: [firstScreen, contenderBuild()],
      // The chunks' import graph, which `perf/tanstack-sizes.ts` sizes the JS budgets from.
      build: { manifest: true },
    },
  ),
);
