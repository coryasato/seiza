// Prints raw, gzip, and brotli sizes for a Vite dist/ directory, grouped by
// kind, and flags any file over Cloudflare's 25 MiB static-asset limit.
// Usage: node shared-web/scripts/asset-sizes.ts <dist-dir>

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { gzipSync } from 'node:zlib';
import { brotli } from '../src/brotli.ts';

const CLOUDFLARE_ASSET_LIMIT = 25 * 1024 * 1024;

type Kind = 'wasm' | 'js' | 'font' | 'other';

interface Asset {
  path: string;
  kind: Kind;
  raw: number;
  gzip: number;
  brotli: number;
}

function kindOf(path: string): Kind {
  if (path.endsWith('.wasm')) return 'wasm';
  if (/\.(m?js)$/.test(path)) return 'js';
  if (/\.(ttf|otf|woff2?)$/.test(path)) return 'font';
  return 'other';
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

function measure(dist: string, path: string): Asset {
  const bytes = readFileSync(path);
  return {
    path: relative(dist, path),
    kind: kindOf(path),
    raw: bytes.length,
    gzip: gzipSync(bytes, { level: 9 }).length,
    brotli: brotli(bytes).length,
  };
}

function kib(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

const dist = process.argv[2];
if (!dist) {
  console.error('usage: asset-sizes.ts <dist-dir>');
  process.exit(2);
}

const assets = walk(dist).map((path) => measure(dist, path));
const order: Kind[] = ['wasm', 'js', 'font', 'other'];
const rows = [['kind', 'file', 'raw', 'gzip', 'brotli']];
for (const kind of order) {
  for (const asset of assets.filter((a) => a.kind === kind).sort((a, b) => b.raw - a.raw)) {
    rows.push([kind, asset.path, kib(asset.raw), kib(asset.gzip), kib(asset.brotli)]);
  }
}
const total = assets.reduce(
  (sum, a) => ({ raw: sum.raw + a.raw, gzip: sum.gzip + a.gzip, brotli: sum.brotli + a.brotli }),
  { raw: 0, gzip: 0, brotli: 0 },
);
rows.push(['total', '', kib(total.raw), kib(total.gzip), kib(total.brotli)]);

const widths = rows[0]!.map((_, i) => Math.max(...rows.map((row) => row[i]!.length)));
for (const row of rows) {
  console.log(row.map((cell, i) => (i < 2 ? cell.padEnd(widths[i]!) : cell.padStart(widths[i]!))).join('  '));
}

const oversize = assets.filter((a) => a.raw > CLOUDFLARE_ASSET_LIMIT);
for (const asset of oversize) {
  console.error(`over Cloudflare's 25 MiB asset limit: ${asset.path} (${kib(asset.raw)})`);
}
process.exit(oversize.length > 0 ? 1 : 0);
