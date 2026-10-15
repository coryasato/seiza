// Stages what the Worker serves into worker/dist/ (gitignored): the data file
// at observatory/data/asteroids.parquet, checked against data/MANIFEST.json,
// and `_headers` for Workers static assets.
//
// Usage: node apps/observatory/worker/scripts/stage.ts   (`just observatory deploy` runs it)

import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = join(dirname(fileURLToPath(import.meta.url)), '../..');
const dist = join(appDir, 'worker/dist');
const data = join(appDir, 'data/asteroids.parquet');
const pinned = (JSON.parse(readFileSync(join(appDir, 'data/MANIFEST.json'), 'utf8')) as Record<string, { sha256: string }>)['asteroids.parquet'];

let bytes: Buffer;
try {
  bytes = readFileSync(data);
} catch {
  throw new Error(`${data} is missing: build it with \`just observatory data\``);
}
const actual = createHash('sha256').update(bytes).digest('hex');
if (actual !== pinned?.sha256) throw new Error(`asteroids.parquet: SHA-256 ${actual}, but data/MANIFEST.json says ${pinned?.sha256}`);

rmSync(dist, { recursive: true, force: true });
mkdirSync(join(dist, 'observatory/data'), { recursive: true });
copyFileSync(data, join(dist, 'observatory/data/asteroids.parquet'));
// The data keeps a stable name, so it revalidates (no-cache), as Tycho's
// does; no-transform keeps Cloudflare from re-encoding it, which would
// break DuckDB's byte ranges.
writeFileSync(
  join(dist, '_headers'),
  [
    '/observatory/*',
    '  Cross-Origin-Opener-Policy: same-origin',
    '  Cross-Origin-Embedder-Policy: require-corp',
    '  Cross-Origin-Resource-Policy: same-origin',
    '/observatory/data/*',
    '  Cache-Control: no-cache, no-transform',
    '',
  ].join('\n'),
);
console.log(`staged worker/dist/: observatory/data/asteroids.parquet (${bytes.length} B, sha256 ${actual.slice(0, 12)}…), _headers`);
