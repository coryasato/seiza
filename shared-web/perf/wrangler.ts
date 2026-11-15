// What every app's Worker scripts and checks share: where wrangler is, what a static
// asset may be, and `wrangler dev` started and waited for.

import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { assertPortFree } from './serve.ts';

/** The repo's wrangler (each Worker's package pins the same version). */
export const wrangler = join(import.meta.dirname, '../../node_modules/.bin/wrangler');
/** wrangler's environment: the caller's, with its metrics off. */
export const wranglerEnv = (): NodeJS.ProcessEnv => ({ ...process.env, WRANGLER_SEND_METRICS: 'false' });

/** What a Workers static asset may be, a file (.claude/rules/cloudflare.md). */
export const ASSET_LIMIT = 25 * 1024 * 1024;

export interface WranglerDev {
  /** `http://127.0.0.1:<port>`, no trailing slash. */
  origin: string;
  close(): Promise<void>;
}

/**
 * Starts `wrangler dev` (local mode) in `workerDir` on `port` and resolves
 * once it answers a request for `probe` (a path; any status). Fails if the
 * port is taken, since what answered would be another server, or if
 * wrangler exits or doesn't answer within a minute, with its output.
 */
export async function startWranglerDev(options: { workerDir: string; port: number; probe: string }): Promise<WranglerDev> {
  const { workerDir, port, probe } = options;
  const origin = `http://127.0.0.1:${port}`;
  await assertPortFree(port);
  const child = spawn(wrangler, ['dev', '--ip', '127.0.0.1', '--port', String(port), '--show-interactive-dev-session=false', '--log-level', 'warn'], {
    cwd: workerDir,
    env: wranglerEnv(),
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
      const response = await fetch(`${origin}${probe}`);
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
  return { origin, close };
}
