// What the Worker serves that the build and data/ don't hold as they are:
// a brotli quality-11 `<file>.br` beside each of the build's wasm, JS, font,
// and HTML files, and each of the three files at quality 11. Compressed once
// and kept in shared-web's cache (a minute or two a file of data/, the first
// time). scripts/dev.ts stages for `wrangler dev`; the deploy stages the same.

import { createHash } from 'node:crypto';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotli } from '../../../../shared-web/src/brotli.ts';
import { walk } from '../../../../shared-web/scripts/walk.ts';
import { ASSET_LIMIT } from '../../../../shared-web/perf/wrangler.ts';
import { FILES, PRECOMPRESSED } from '../src/names.ts';

export const workerDir = join(dirname(fileURLToPath(import.meta.url)), '..');
export const dist = join(workerDir, '../web/dist');
export const dataDir = join(workerDir, '../data');

const manifest = JSON.parse(readFileSync(join(dataDir, 'MANIFEST.json'), 'utf8')) as Record<string, { bytes: number; sha256: string }>;

/** Writes the build's `.br` copies into web/dist; fails on a file a static asset can't be. */
export function stageBuild(): { path: string; bytes: number; brBytes: number | null }[] {
  const staged = [];
  for (const file of walk(dist)) {
    const path = relative(dist, file);
    const extension = path.split('.').pop() ?? '';
    if (extension === 'br') continue;
    const bytes = statSync(file).size;
    if (bytes > ASSET_LIMIT) throw new Error(`${path} is over the 25 MiB a static asset may be`);
    let brBytes: number | null = null;
    if (PRECOMPRESSED.includes(extension)) {
      const compressed = brotli(readFileSync(file));
      writeFileSync(`${file}.br`, compressed);
      brBytes = compressed.length;
    }
    staged.push({ path, bytes, brBytes });
  }
  return staged;
}

/** One of the three files, read and found to be MANIFEST.json's bytes. */
export interface DataFile {
  name: string;
  /** Its path in data/: the bucket's object `name` is this file as it is. */
  path: string;
  /** Its SHA-256, the manifest's and the file's own. */
  sha256: string;
  /** The bucket's object `<name>.br`: the file at brotli 11 (from the cache, or a minute or two). */
  compressed(): Buffer;
}

/** The three files, each read against MANIFEST.json's length and SHA-256:
 *  a file built again without its manifest fails here, not in the bucket. */
export function dataFiles(): DataFile[] {
  return FILES.map((name) => {
    const entry = manifest[name];
    if (!entry) throw new Error(`data/MANIFEST.json has no ${name}`);
    const path = join(dataDir, name);
    let body: Buffer;
    try {
      body = readFileSync(path);
    } catch {
      throw new Error(`no data/${name}: docs/data.md says how it's built`);
    }
    const sha256 = createHash('sha256').update(body).digest('hex');
    if (body.length !== entry.bytes || sha256 !== entry.sha256) throw new Error(`data/${name} (${body.length} bytes, SHA-256 ${sha256.slice(0, 16)}…) isn't MANIFEST.json's (${entry.bytes} bytes, ${entry.sha256.slice(0, 16)}…): docs/data.md says how both are built`);
    return { name, path, sha256, compressed: () => brotli(body) };
  });
}
