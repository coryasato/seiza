import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { siteVite } from '@seiza/site-ui/vite';
import { prerender } from '@seiza/web/prerender';
import { seizaViteConfig, serveDirs } from '@seiza/web/vite';
import { observatoryData } from '../contenders/data.ts';
import { coldNumbers } from './cold.ts';
import { contenderBase, ENGINE, ENGINE_DIR, OBSERVATORY } from '../contenders/paths.ts';
import { ROUTES } from './src/components.ts';
import type * as Prerender from './src/prerender.ts';
import { SIDEBAR_SCRIPT } from './src/sidebar.ts';

const contender = (side: 'gpui' | 'tanstack') => fileURLToPath(new URL(`../contenders/tall-table/${side}/web/dist/`, import.meta.url));

// The page at /observatory/ and /observatory/<component>/ (the observatory's
// CLAUDE.md, rule 2), one HTML file per route, each prerendered. The dev and
// preview servers also serve what its frames load, as the deploy will: the
// contenders' release builds at their bases (`just observatory gpui-build`,
// `tanstack-build` first), the engine at /observatory/duckdb/ (the GPUI
// build's copy: `engine-files` checks both are the same bytes), and the data.
export default defineConfig(
  seizaViteConfig(
    // The first screen is the page's own HTML: nothing to preload.
    { preload: [] },
    {
      base: OBSERVATORY,
      plugins: [
        siteVite(),
        // The sidebar's state before first paint, as the theme's (`src/sidebar.ts`).
        { name: 'observatory:sidebar', transformIndexHtml: () => [{ tag: 'script', children: SIDEBAR_SCRIPT, injectTo: 'head-prepend' }] },
        // The cold numbers, from perf/results/ at build time (`cold.ts`).
        coldNumbers(),
        prerender<typeof Prerender>({ module: '/src/prerender.ts', render: ({ render }, page) => render(page) }),
        serveDirs([
          { at: contenderBase('tall-table', 'gpui'), dir: contender('gpui') },
          { at: contenderBase('tall-table', 'tanstack'), dir: contender('tanstack') },
          { at: ENGINE, dir: `${contender('gpui')}${ENGINE_DIR}` },
        ]),
        observatoryData(),
      ],
      build: {
        // The chunks' import graph, which `perf/page.ts` sizes the JS budget from.
        manifest: true,
        rolldownOptions: {
          input: Object.fromEntries(ROUTES.map(({ html }) => [html.slice(1, -'.html'.length).replace('/index', '') || 'index', fileURLToPath(new URL(`.${html}`, import.meta.url))])),
          // React Server Components' "use client" means nothing in a client bundle.
          onwarn: (warning, warn) => {
            if (warning.code === 'MODULE_LEVEL_DIRECTIVE' && warning.message.includes('"use client"')) return;
            warn(warning);
          },
        },
      },
    },
  ),
);
