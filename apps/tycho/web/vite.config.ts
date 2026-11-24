import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { duckdb } from '@seiza/duckdb/vite';
import { prerender } from '@seiza/web/prerender';
import { seizaViteConfig } from '@seiza/web/vite';
import type * as Prerender from './src/frame/prerender.tsx';

/**
 * The sample (`src/main.ts` imports it) is built by `just tycho data` and
 * gitignored: refuse to build or serve without it, or with a file that isn't
 * the one `data/MANIFEST.json` records.
 */
function checkSample() {
  const path = fileURLToPath(new URL('../data/gcat.parquet', import.meta.url));
  const manifest = JSON.parse(readFileSync(new URL('../data/MANIFEST.json', import.meta.url), 'utf8')) as Record<string, { sha256?: string }>;
  const pinned = manifest['gcat.parquet']?.sha256;
  if (!existsSync(path)) throw new Error(`apps/tycho/data/gcat.parquet is missing: build it with \`just tycho data\``);
  if (!pinned) throw new Error(`apps/tycho/data/MANIFEST.json records no gcat.parquet: build it with \`just tycho data\`, which records it`);
  const found = createHash('sha256').update(readFileSync(path)).digest('hex');
  if (found !== pinned) {
    throw new Error(`apps/tycho/data/gcat.parquet has SHA-256 ${found}, but data/MANIFEST.json records ${pinned}: build it again with \`just tycho data\``);
  }
}
checkSample();

/**
 * `virtual:tycho-sample`: what the first screen's sample row says before
 * the download, from `data/MANIFEST.json` (its title is the design's: the
 * row names GCAT, so the credit is there before the download).
 */
function sampleFacts(): Plugin {
  const id = 'virtual:tycho-sample';
  const manifest = fileURLToPath(new URL('../data/MANIFEST.json', import.meta.url));
  return {
    name: 'tycho:sample',
    resolveId: (source) => (source === id ? `\0${id}` : undefined),
    load(resolved) {
      if (resolved !== `\0${id}`) return;
      this.addWatchFile(manifest);
      const entry = (JSON.parse(readFileSync(manifest, 'utf8')) as Record<string, { rows: number; bytes: number }>)['gcat.parquet']!;
      return `export default ${JSON.stringify({ title: 'GCAT, every object launched to orbit', rows: entry.rows, bytes: entry.bytes })};`;
    },
  };
}

export default defineConfig(
  seizaViteConfig(
    {
      // What first paint waits on. DuckDB's bundles and React (`src/main.ts`)
      // load after it and must not be listed here.
      preload: ['tycho_bg.wasm', 'IBMPlexSans-Regular.ttf'],
    },
    {
      plugins: [
        tailwindcss(),
        sampleFacts(),
        // The frame, as HTML: the page before the wasm and before React.
        prerender<typeof Prerender>({ module: '/src/frame/prerender.tsx', render: ({ render }) => render(), plugins: [sampleFacts()] }),
        duckdb(),
      ],
      build: {
        rolldownOptions: {
          output: {
            // The frame's stylesheet by a name of its own, so the size
            // report's first-paint parts tell it from the entry's JS.
            assetFileNames: ({ names }) => (names.some((name) => name.endsWith('.css')) ? 'assets/frame-[hash][extname]' : 'assets/[name]-[hash][extname]'),
          },
          // React's "use client" means nothing in a client bundle.
          onwarn: (warning, warn) => {
            if (warning.code === 'MODULE_LEVEL_DIRECTIVE' && warning.message.includes('"use client"')) return;
            warn(warning);
          },
        },
      },
    },
  ),
);
