/**
 * Build rules every contender's Vite config adds (`contenderBuild()`):
 *
 * - **One engine path.** DuckDB's bundles (its worker scripts and wasm) are
 *   emitted under `duckdb/`, beside the extensions, named by their content:
 *   both contenders load them from `/observatory/duckdb/`, the same bytes at
 *   the same URLs, so the second to load finds them cached (root
 *   `CLAUDE.md`, "Comparison protocol"). `perf/engine-files.ts` checks it.
 * - **Nothing heavy before first paint.** The build fails if a module of
 *   DuckDB-Wasm or the Arrow library is in a chunk the page's entry loads
 *   statically (root `CLAUDE.md`, rule 2): they load with the engine, after
 *   first paint. `perf/engine-files.ts --controls` checks that it fails.
 */

import type { Plugin, Rolldown } from 'vite';

/** Where an asset of DuckDB-Wasm's own comes from. */
const ENGINE_ASSET = /[\\/]@duckdb[\\/]duckdb-wasm[\\/]dist[\\/]/;

/** Modules that must stay out of the first-paint chunks. */
const AFTER_PAINT = [/[\\/]node_modules[\\/]apache-arrow[\\/]/, /[\\/]node_modules[\\/]@duckdb[\\/]duckdb-wasm[\\/]/];

/** The message the build fails with; the control looks for it. */
export const FIRST_PAINT_ERROR = 'loads before first paint';

export function contenderBuild(): Plugin {
  return {
    name: 'observatory:contender-build',
    config: () => ({
      build: {
        rolldownOptions: {
          output: {
            assetFileNames: (asset: Rolldown.PreRenderedAsset) =>
              asset.originalFileNames.some((file) => ENGINE_ASSET.test(file)) ? 'duckdb/[name]-[hash][extname]' : 'assets/[name]-[hash][extname]',
          },
        },
      },
    }),
    generateBundle(_, bundle) {
      const chunks = new Map(Object.values(bundle).flatMap((output) => (output.type === 'chunk' ? [[output.fileName, output] as const] : [])));
      // The entry chunks and everything they import statically.
      const firstPaint = new Set<string>();
      const visit = (fileName: string) => {
        if (firstPaint.has(fileName)) return;
        firstPaint.add(fileName);
        for (const imported of chunks.get(fileName)?.imports ?? []) visit(imported);
      };
      for (const chunk of chunks.values()) if (chunk.isEntry) visit(chunk.fileName);
      for (const fileName of firstPaint) {
        const heavy = chunks.get(fileName)?.moduleIds.find((id) => AFTER_PAINT.some((pattern) => pattern.test(id)));
        if (heavy) this.error(`${heavy} ${FIRST_PAINT_ERROR}: it's in ${fileName}, which the page's entry loads statically`);
      }
    },
  };
}
