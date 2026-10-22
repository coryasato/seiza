// Where `stage.ts` stages what the Worker serves, for the scripts that read
// it (`check.ts`). Side-effect free, so importing it never stages.

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** worker/dist/ (gitignored): the files at their production paths. */
export const dist = join(dirname(fileURLToPath(import.meta.url)), '../dist');
/** Cloudflare's static-asset limit, per file. */
export const ASSET_LIMIT = 25 * 1024 * 1024;
