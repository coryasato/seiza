import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { defineConfig } from 'vite';
import { prerender } from '@seiza/web/prerender';
import { seizaViteConfig } from '@seiza/web/vite';
import { contenderBuild } from '../../../engine.ts';
import { levelConstants, levelOf, levelOutDir } from '../../../level.ts';
import { contenderBase } from '../../../paths.ts';
import type * as View from './src/view.ts';

// At /observatory/contenders/tall-table/tanstack/[<level>/] (the
// observatory's CLAUDE.md, rule 2): the engine at /observatory/duckdb/ (its
// bundles and extensions, `contenderBuild`), the data at
// /observatory/data/, the font at /fonts/. The level (`contenders/level.ts`)
// from Vite's mode: `--mode wide` is the wide sheet's build, into
// `dist-wide/`, `--mode market` market watch's, into `dist-market/`; the
// base carries none of their code.
export default defineConfig(({ mode }) => {
  const level = levelOf('tanstack', mode);
  const outDir = levelOutDir(level);
  /** The first screen, rendered by the view itself into the page's HTML
   *  (in dev too), which `main.ts` hydrates: React's prerendered first
   *  screen (root `CLAUDE.md`, "Comparison protocol"). */
  const firstScreen = prerender<typeof View>({
    module: '/src/view.ts',
    render: ({ App, FIRST_SCREEN }) => renderToString(createElement(App, { load: FIRST_SCREEN })),
    plugins: [levelConstants(level)],
  });
  return seizaViteConfig(
    // The first screen is the page's own HTML: nothing to preload.
    { preload: [] },
    {
      base: contenderBase('tall-table', 'tanstack', level),
      plugins: [firstScreen, contenderBuild(outDir), levelConstants(level)],
      // The chunks' import graph, which `perf/tanstack-sizes.ts` sizes the JS budgets from.
      build: { outDir, manifest: true },
      // The level's own styles: `wide.css` or `market.css` on their levels, nothing on the base.
      resolve: { alias: [{ find: /^\.\/level\.css$/, replacement: level === 'base' ? './base.css' : `./${level}.css` }] },
    },
  );
});
