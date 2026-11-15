// Starts the Worker under `wrangler dev` (local mode: Miniflare R2 from
// .wrangler/state/, filled by `just tycho data`) for the scripts that need
// /data: the Vite dev and preview proxies, perf/sample.ts, and check.ts.

import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startWranglerDev } from '../../../../shared-web/perf/wrangler.ts';
import { oversizeAssets, writeAssetsIgnore } from './assets.ts';

const workerDir = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Where Vite's proxies send /data/*. `just tycho dev` starts it here. */
export const WORKER_DEV_PORT = 8787;

export interface WorkerDev {
  url: string;
  close(): Promise<void>;
}

/**
 * Starts `wrangler dev` on `port` and resolves once it answers, and once
 * `requireObject` (if given) is in the local bucket.
 */
export async function startWorkerDev(options: { port?: number; requireObject?: string } = {}): Promise<WorkerDev> {
  const port = options.port ?? WORKER_DEV_PORT;
  const url = `http://127.0.0.1:${port}`;
  // wrangler.toml's [assets] directory: wrangler won't start without it, and
  // `just tycho dev` runs before any release build. Nor with a file over the
  // asset limit in it, and the build leaves DuckDB's wasm there without the
  // .assetsignore that names it (Vite empties dist/).
  const dist = join(workerDir, '../web/dist');
  mkdirSync(dist, { recursive: true });
  writeAssetsIgnore(dist, oversizeAssets(dist));
  const { close } = await startWranglerDev({ workerDir, port, probe: '/data/' });
  if (options.requireObject) {
    const response = await fetch(`${url}/data/${options.requireObject}`, { method: 'HEAD' });
    if (response.status !== 200) {
      await close();
      throw new Error(`local R2 has no ${options.requireObject} (HEAD ${response.status}); run \`just tycho data\``);
    }
  }
  return { url, close };
}
