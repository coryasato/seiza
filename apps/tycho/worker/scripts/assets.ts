// web/dist's files over Cloudflare's 25 MiB static-asset limit (DuckDB's
// wasm bundles): R2 holds them, and dist/.assetsignore keeps them out of the
// static assets. Both `wrangler deploy` and `wrangler dev` refuse to start
// while one is in the assets directory, and Vite's build empties dist/, so
// deploy.ts and dev.ts each write the ignore file before running wrangler.

import { statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { walk } from '../../../../shared-web/scripts/walk.ts';
import { ASSET_LIMIT } from '../../../../shared-web/perf/wrangler.ts';

export { ASSET_LIMIT, walk };

/** `dist`'s files over the asset limit, relative to it. */
export function oversizeAssets(dist: string): string[] {
  return walk(dist)
    .filter((file) => statSync(file).size > ASSET_LIMIT)
    .map((file) => relative(dist, file));
}

/** Writes dist/.assetsignore naming `oversize` (paths relative to `dist`). */
export function writeAssetsIgnore(dist: string, oversize: string[]): void {
  writeFileSync(join(dist, '.assetsignore'), `# Served from R2 by the Worker (worker/scripts/assets.ts)\n${oversize.map((path) => `/${path}`).join('\n')}\n`);
}
