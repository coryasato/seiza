// Starts the Worker under `wrangler dev` (local mode) on the release build
// in web/dist, for check.ts. Its local R2 (Miniflare's, under
// .wrangler/state/) is the bucket as production uses it: DuckDB's two wasm
// bundles, which this puts there from the build, and nothing else.

import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startWranglerDev, wrangler, wranglerEnv } from '../../../../shared-web/perf/wrangler.ts';
import { oversizeAssets, writeAssetsIgnore } from './assets.ts';

const workerDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUCKET = 'tycho-data';

export interface WorkerDev {
  url: string;
  close(): Promise<void>;
}

/**
 * Puts the build's oversize files (`oversize`, paths relative to `dist`)
 * into the local bucket under their own paths, as the deploy does in R2.
 * Their names are content-hashed, so an older build's stay beside them.
 */
export function fillLocalBucket(dist: string, oversize: string[]): void {
  for (const path of oversize) {
    execFileSync(wrangler, ['r2', 'object', 'put', `${BUCKET}/${path}`, '--file', join(dist, path), '--local'], {
      cwd: workerDir,
      env: wranglerEnv(),
      stdio: ['ignore', 'ignore', 'inherit'],
    });
  }
}

/** Starts `wrangler dev` on `port` and resolves once it answers, with the
 *  build's oversize files in the local bucket. */
export async function startWorkerDev(options: { port: number }): Promise<WorkerDev> {
  const url = `http://127.0.0.1:${options.port}`;
  // wrangler.toml's [assets] directory: wrangler won't start without it, nor
  // with a file over the asset limit in it, and the build leaves DuckDB's
  // wasm there without the .assetsignore that names it (Vite empties dist/).
  const dist = join(workerDir, '../web/dist');
  mkdirSync(dist, { recursive: true });
  const oversize = oversizeAssets(dist);
  writeAssetsIgnore(dist, oversize);
  fillLocalBucket(dist, oversize);
  const { close } = await startWranglerDev({ workerDir, port: options.port, probe: '/' });
  return { url, close };
}
