// Downloads the DuckDB extensions pinned in duckdb-extensions.json into
// public/duckdb-ext/, where Vite serves them in dev and copies them into the
// build. Each file is checked against its pinned SHA-256; files already
// present and matching are kept, so this is a no-op after the first run.
//
// Usage: node apps/tycho/web/scripts/extensions.ts

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

interface Pins {
  source: string;
  duckdbVersion: string;
  extensions: Record<string, Record<string, string>>;
}

const webDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const pins = JSON.parse(readFileSync(join(webDir, 'duckdb-extensions.json'), 'utf8')) as Pins;
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

for (const [name, platforms] of Object.entries(pins.extensions)) {
  for (const [platform, expected] of Object.entries(platforms)) {
    const path = `${pins.duckdbVersion}/${platform}/${name}.duckdb_extension.wasm`;
    const file = join(webDir, 'public/duckdb-ext', path);
    try {
      if (sha256(readFileSync(file)) === expected) continue;
    } catch {
      // Not downloaded yet.
    }
    const response = await fetch(`${pins.source}/${path}`);
    if (!response.ok) throw new Error(`${pins.source}/${path}: ${response.status} ${response.statusText}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const actual = sha256(bytes);
    if (actual !== expected) throw new Error(`${path}: SHA-256 ${actual}, pinned ${expected}. Update duckdb-extensions.json only for a deliberate DuckDB bump.`);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(`${file}.tmp`, bytes);
    renameSync(`${file}.tmp`, file);
    console.log(`duckdb-ext: ${path} (${(bytes.length / 2 ** 20).toFixed(1)} MiB)`);
  }
}
