// Starts the Worker under `wrangler dev` (local mode: Miniflare R2 from
// .wrangler/state/, filled by `just tycho data`) for the scripts that need
// /data: the Vite dev and preview proxies, perf/sample.ts, and check.ts.

import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const workerDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const wrangler = join(workerDir, '../../../node_modules/.bin/wrangler');

/** Where Vite's proxies send /data/*. `just tycho dev` starts it here. */
export const WORKER_DEV_PORT = 8787;

export interface WorkerDev {
  url: string;
  close(): Promise<void>;
}

/**
 * Fails with a clear message if something already listens on `port`, such as
 * the `wrangler dev` of a running `just tycho dev`. Without this, a second
 * Worker would exit with EADDRINUSE while the readiness probe happily talked
 * to the first one.
 */
export function assertPortFree(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', (error: NodeJS.ErrnoException) =>
      reject(
        new Error(
          error.code === 'EADDRINUSE'
            ? `port ${port} is in use (another \`just tycho dev\` or \`preview\`?); stop it first`
            : `can't check port ${port}: ${error.message}`,
        ),
      ),
    );
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolve()));
  });
}

/**
 * Starts `wrangler dev` on `port` and resolves once it answers, and once
 * `requireObject` (if given) is in the local bucket.
 */
export async function startWorkerDev(options: { port?: number; requireObject?: string } = {}): Promise<WorkerDev> {
  const port = options.port ?? WORKER_DEV_PORT;
  const url = `http://127.0.0.1:${port}`;
  await assertPortFree(port);
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
