// Runs a command with the Worker up on WORKER_DEV_PORT, where Vite's dev and
// preview servers proxy /data/*, and stops the Worker when the command exits.
//
// Usage: node apps/tycho/worker/scripts/with-worker.ts <command> [args…]

import { spawn } from 'node:child_process';
import { startWorkerDev } from './dev.ts';

const [command, ...args] = process.argv.slice(2);
if (!command) throw new Error('usage: with-worker.ts <command> [args…]');

const worker = await startWorkerDev();
console.log(`worker: ${worker.url} (/data/* from local R2)`);
const child = spawn(command, args, { stdio: 'inherit' });
const stop = () => child.kill('SIGINT');
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
const code = await new Promise<number>((resolve) => child.once('exit', (exitCode) => resolve(exitCode ?? 1)));
await worker.close();
process.exit(code);
