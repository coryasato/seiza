// Where `stage.ts` stages what the Worker serves, for the scripts that read
// it (`check.ts`). Side-effect free, so importing it never stages.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** worker/dist/ (gitignored): the files at their production paths. */
export const dist = join(dirname(fileURLToPath(import.meta.url)), '../dist');
/** Cloudflare's static-asset limit, per file. */
export const ASSET_LIMIT = 25 * 1024 * 1024;

/** data/MANIFEST.json's files and their SHA-256s: what the deploy stages
 *  and passes to the Worker as `DATA_FILES`, and what `check.ts` reads back. */
export function dataFiles(): Record<string, string> {
  const manifest = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../data/MANIFEST.json'), 'utf8')) as Record<string, { sha256: string }>;
  return Object.fromEntries(Object.entries(manifest).map(([name, { sha256 }]) => [name, sha256]));
}

// `node staged.ts --data-files`: that map as JSON, for the deploy's `--var`.
if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv.includes('--data-files')) console.log(JSON.stringify(dataFiles()));
