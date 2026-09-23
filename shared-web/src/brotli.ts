import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, constants } from 'node:zlib';

/**
 * Brotli quality 11, cached on disk by content hash. `asset-sizes.ts` reports
 * these sizes after each build (and fills the cache), and the preview server
 * serves these bytes, so the size the budget checks is the size perf runs load.
 * Quality 11 on the release wasm takes ~20 s, which is why it's cached.
 */
const cacheDir = fileURLToPath(new URL('../../node_modules/.cache/seiza-brotli/', import.meta.url));

export function brotli(bytes: Buffer): Buffer {
  const path = `${cacheDir}${createHash('sha256').update(bytes).digest('hex')}.br`;
  try {
    return readFileSync(path);
  } catch {
    const compressed = brotliCompressSync(bytes, {
      params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: bytes.length },
    });
    mkdirSync(cacheDir, { recursive: true });
    // Write then rename, so a reader (the preview server, a parallel build)
    // never sees a half-written file, and a killed process leaves no entry.
    const temp = `${path}.${process.pid}.tmp`;
    writeFileSync(temp, compressed);
    renameSync(temp, path);
    return compressed;
  }
}
