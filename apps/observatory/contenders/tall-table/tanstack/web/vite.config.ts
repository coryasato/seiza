import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { defineConfig, type Plugin } from 'vite';
import { duckdb } from '@seiza/duckdb/vite';
import { seizaViteConfig } from '@seiza/web/vite';
import { observatoryData } from '../../../data.ts';
import { contenderBuild } from '../../../engine.ts';
import type * as View from './src/view.ts';

/** The page's root, empty in index.html until the first screen fills it. */
const ROOT = '<div id="root"></div>';

/** The first screen, rendered by the view itself into the page's HTML (in
 *  dev too), which `main.ts` hydrates: React's prerendered first screen
 *  (root `CLAUDE.md`, "Comparison protocol"). In dev the view is loaded
 *  through the dev server on each request, so an edit to it reaches the
 *  HTML as it reaches the client. */
function prerender(): Plugin {
  return {
    name: 'tanstack:prerender',
    async transformIndexHtml(html, context) {
      if (!html.includes(ROOT)) throw new Error(`index.html has no ${ROOT} to prerender into`);
      const { App, FIRST_SCREEN } = (context.server ? await context.server.ssrLoadModule('/src/view.ts') : await import('./src/view.ts')) as typeof View;
      return html.replace(ROOT, `<div id="root">${renderToString(createElement(App, { load: FIRST_SCREEN }))}</div>`);
    },
  };
}

// Under /observatory/ (the observatory's CLAUDE.md, rule 2): the engine at
// /observatory/duckdb/ (its bundles and extensions, `contenderBuild`), the
// data at /observatory/data/.
export default defineConfig(
  seizaViteConfig(
    // The first screen is the page's own HTML: nothing to preload.
    { preload: [] },
    {
      base: '/observatory/',
      plugins: [prerender(), duckdb({ extensionDir: 'duckdb' }), observatoryData(), contenderBuild()],
      // The chunks' import graph, which `perf/tanstack-sizes.ts` sizes the JS budgets from.
      build: { manifest: true },
    },
  ),
);
