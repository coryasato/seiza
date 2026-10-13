// Starts the Worker under `wrangler dev` (local mode: Miniflare R2 from
// .wrangler/state/, filled by `just tycho data`) for the scripts that need
// /data: the Vite dev and preview proxies, perf/sample.ts, and check.ts.

import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertPortFree } from '../../../../shared-web/perf/serve.ts';
import { oversizeAssets, writeAssetsIgnore } from './assets.ts';

const workerDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const wrangler = join(workerDir, '../../../node_modules/.bin/wrangler');

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
  await assertPortFree(port);
  // wrangler.toml's [assets] directory: wrangler won't start without it, and
  // `just tycho dev` runs before any release build. Nor with a file over the
  // asset limit in it, and the build leaves DuckDB's wasm there without the
  // .assetsignore that names it (Vite empties dist/).
  const dist = join(workerDir, '../web/dist');
  mkdirSync(dist, { recursive: true });
  writeAssetsIgnore(dist, oversizeAssets(dist));
  const child = spawn(wrangler, ['dev', '--ip', '127.0.0.1', '--port', String(port), '--show-interactive-dev-session=false', '--log-level', 'warn'], {
    cwd: workerDir,
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => (output += chunk));
  child.stderr.on('data', (chunk) => (output += chunk));
  let done = false;
  const exited = new Promise<void>((resolve) => {
    child.once('exit', () => ((done = true), resolve()));
    // Spawning failed (no wrangler): there's no exit event.
    child.once('error', (error) => ((output += `\n${error.message}`), (done = true), resolve()));
  });
  const close = async () => {
    if (!done) child.kill('SIGTERM');
    await exited;
  };

  const deadline = Date.now() + 60_000;
  for (;;) {
    if (done) throw new Error(`wrangler dev exited:\n${output}`);
    try {
      const response = await fetch(`${url}/data/`);
      await response.body?.cancel();
      break;
    } catch {
      if (Date.now() > deadline) {
        await close();
        throw new Error(`wrangler dev didn't start within 60 s:\n${output}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  // The port was free, so what answered is our child, unless it lost a race
  // for the port and exited.
  if (done) throw new Error(`wrangler dev exited:\n${output}`);
  if (options.requireObject) {
    const response = await fetch(`${url}/data/${options.requireObject}`, { method: 'HEAD' });
    if (response.status !== 200) {
      await close();
      throw new Error(`local R2 has no ${options.requireObject} (HEAD ${response.status}); run \`just tycho data\``);
    }
  }
  return { url, close };
}
