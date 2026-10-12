// web/dist's files over Cloudflare's 25 MiB static-asset limit (DuckDB's
// wasm bundles): R2 holds them, and dist/.assetsignore keeps them out of the
// static assets. Both `wrangler deploy` and `wrangler dev` refuse to start
// while one is in the assets directory, and Vite's build empties dist/, so
// deploy.ts and dev.ts each write the ignore file before running wrangler.

import { readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

export const ASSET_LIMIT = 25 * 1024 * 1024;

/** Every file under `dir`, recursively. */
export const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]));

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
