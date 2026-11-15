// The release build behind the Worker, locally: stages the build's `.br`
// copies, fills `wrangler dev`'s R2 (Miniflare's, under .wrangler/state/)
// with the three files, and starts `wrangler dev`. The page is at
// <url>/kirkwood/. `wrangler dev` re-encodes what the Worker sends
// (.claude/rules/cloudflare.md), so the bytes on the wire here aren't
// production's: `see --only slow` reads those through `vite preview`.
//
// Usage: node apps/kirkwood/worker/scripts/dev.ts   (`just kirkwood worker`)
// Run `just kirkwood build` first.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startWranglerDev, wrangler, wranglerEnv } from '../../../../shared-web/perf/wrangler.ts';
import { BASE } from '../../web/src/base.ts';
import { dataFiles, dist, stageBuild, workerDir } from './stage.ts';

const BUCKET = 'kirkwood-data';
export const WORKER_DEV_PORT = 8788;

export interface WorkerDev {
  /** The page's URL: the Worker's origin and the app's base. */
  url: string;
  close(): Promise<void>;
}

/** Puts each object the local bucket doesn't hold at the file's version. The
 *  note of what was put lives in Miniflare's own state, so a bucket cleared
 *  is a note cleared. */
function fillLocalBucket(): void {
  const state = join(workerDir, '.wrangler/state');
  mkdirSync(state, { recursive: true });
  const notePath = join(state, 'kirkwood-put.json');
  const put: Record<string, string> = existsSync(notePath) ? JSON.parse(readFileSync(notePath, 'utf8')) : {};
  const putObject = (key: string, file: string, sha256: string) => {
    execFileSync(wrangler, ['r2', 'object', 'put', `${BUCKET}/${key}`, '--file', file, '--local'], { cwd: workerDir, env: wranglerEnv(), stdio: ['ignore', 'ignore', 'inherit'] });
    put[key] = sha256;
    writeFileSync(notePath, JSON.stringify(put, null, 2));
    console.log(`worker: ${key} in the local bucket`);
  };
  for (const file of dataFiles()) {
    if (put[file.name] !== file.sha256) putObject(file.name, file.path, file.sha256);
    const key = `${file.name}.br`;
    if (put[key] === file.sha256) continue;
    // wrangler reads a file: the compressed bytes, written for the put alone.
    const temp = join(state, `${key}.tmp`);
    writeFileSync(temp, file.compressed());
    try {
      putObject(key, temp, file.sha256);
    } finally {
      rmSync(temp, { force: true });
    }
  }
}

/** Stages the build and the data, starts `wrangler dev` on `port`, and
 *  resolves once it answers and holds the files. */
export async function startWorkerDev(port = WORKER_DEV_PORT): Promise<WorkerDev> {
  if (!existsSync(join(dist, 'index.html'))) throw new Error('web/dist has no build; run `just kirkwood build`');
  stageBuild();
  fillLocalBucket();
  const { origin, close } = await startWranglerDev({ workerDir, port, probe: `${BASE}data/` });
  const url = `${origin}${BASE}`;
  // The note said the bucket holds them; the bucket has the last word.
  for (const file of dataFiles()) {
    const response = await fetch(`${url}data/${file.name}`, { method: 'HEAD', headers: { 'Accept-Encoding': 'br' } });
    if (response.status !== 200) {
      await close();
      throw new Error(`the local bucket has no ${file.name}.br (HEAD ${response.status}): delete apps/kirkwood/worker/.wrangler/state and run this again`);
    }
  }
  return { url, close };
}

if (import.meta.main) {
  const worker = await startWorkerDev();
  console.log(`worker: ${worker.url}`);
  const stop = () => void worker.close().then(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
