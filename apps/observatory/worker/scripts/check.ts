// Checks production as the Worker serves it (`just observatory worker-check`;
// `deploy` runs it). Reads raw responses (node:https), never decoded ones.
//
// The builds, against worker/dist/ (`scripts/stage.ts`, which the deploy
// runs; stage it first to check on its own): every staged file at its path,
// each route at its URL, offering what Chromium offers: 200, the isolation
// headers, its type and Cache-Control (src/files.ts), and for a
// precompressed type exactly the staged `.br`'s bytes on the wire (so the
// quality-11 brotli, nothing recompressed, no script injected). The routes'
// HTML again without br: exactly the staged file. DuckDB's wasm bundles,
// which the upload leaves out, offering only gzip: their staged `.gz`. A
// revalidation (If-None-Match) gets a 304; a route without its slash
// redirects to it; a missing file is a 404.
//
// The data the way DuckDB-Wasm reads it (engines/duckdb/README.md,
// "Limits"): a ranged HEAD and a `bytes=0-0` GET answer 206 with
// Content-Range; closed ranges (the header, the footer, and spots between)
// come back byte-exact, with exactly their length on the wire and no
// Content-Encoding, though the request offers br, gzip, and zstd (so
// nothing recompresses the Parquet); the isolation headers and no-transform
// are on every answer; the whole file matches data/MANIFEST.json's SHA-256.
//
// With --behind-waf, also the zone's WAF rules (docs/private/zone.md at the
// root): a probe outside /observatory/ and a POST to the data both get the
// WAF's 403 before the Worker could answer.
//
// Usage: node apps/observatory/worker/scripts/check.ts [--url <origin>] [--resolve-via 1.1.1.1] [--behind-waf] [--data-only] [--wait]
// The origin defaults to https://seiza.io. --resolve-via: resolve its host
// with that DNS server (for a local resolver still caching an old NXDOMAIN).
// --data-only: skip the builds. --wait: first wait (a minute at most) for
// the routes' HTML to be the staged build's, as after a deploy.

import { createHash } from 'node:crypto';
import { Resolver } from 'node:dns/promises';
import type { LookupFunction } from 'node:net';
import { existsSync, readFileSync } from 'node:fs';
import { request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONTENT_TYPES, PRECOMPRESSED, cacheControl } from '../src/files.ts';
import { walk } from '../../../../shared-web/scripts/walk.ts';
import { dist } from './staged.ts';

const appDir = join(dirname(fileURLToPath(import.meta.url)), '../..');
const manifest = JSON.parse(readFileSync(join(appDir, 'data/MANIFEST.json'), 'utf8')) as Record<string, { bytes: number; sha256: string }>;
const expected = manifest['asteroids.parquet']!;
const local = readFileSync(join(appDir, 'data/asteroids.parquet'));
const urlFlag = process.argv.indexOf('--url');
const origin = urlFlag >= 0 ? process.argv[urlFlag + 1]! : 'https://seiza.io';
const url = new URL('/observatory/data/asteroids.parquet', origin);
const viaFlag = process.argv.indexOf('--resolve-via');
let lookup: LookupFunction | undefined;
if (viaFlag >= 0) {
  const resolver = new Resolver();
  resolver.setServers([process.argv[viaFlag + 1]!]);
  const address = (await resolver.resolve4(url.hostname))[0]!;
  lookup = (_host, options, callback) =>
    options.all ? (callback as (e: null, a: { address: string; family: number }[]) => void)(null, [{ address, family: 4 }]) : callback(null, address, 4);
}
/** What Chromium offers. */
const ENCODINGS = 'gzip, deflate, br, zstd';

interface Raw {
  status: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
}

function raw(method: 'GET' | 'HEAD' | 'POST', range?: string, target = url, extra: Record<string, string> = {}): Promise<Raw> {
  const request = target.protocol === 'https:' ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { 'Accept-Encoding': ENCODINGS, ...extra };
    if (range) headers.Range = range;
    request(target, { method, headers, lookup }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(chunks) }));
      response.on('error', reject);
    })
      .on('error', reject)
      .end();
  });
}

const failures: string[] = [];
const expect = (name: string, ok: boolean, detail: string) => {
  if (!ok) failures.push(`${name}: ${detail}`);
};
const isolated = (name: string, r: Raw) => {
  expect(name, r.headers['cross-origin-opener-policy'] === 'same-origin', `COOP ${r.headers['cross-origin-opener-policy']}`);
  expect(name, r.headers['cross-origin-embedder-policy'] === 'require-corp', `COEP ${r.headers['cross-origin-embedder-policy']}`);
  expect(name, r.headers['cross-origin-resource-policy'] === 'same-origin', `CORP ${r.headers['cross-origin-resource-policy']}`);
};
const common = (name: string, r: Raw) => {
  expect(name, r.headers['content-encoding'] === undefined, `Content-Encoding ${r.headers['content-encoding']} (the Parquet must go out as stored)`);
  expect(name, String(r.headers['cache-control']).includes('no-transform'), `Cache-Control ${r.headers['cache-control']}`);
  isolated(name, r);
};
const size = expected.bytes;
const range = (start: number, end: number) => `bytes ${start}-${end}/${size}`;

// --wait: until the edge serves this staged build (a new version takes
// seconds to arrive), poll only the routes' HTML, a few KiB, rather than
// retry the whole check: each try would fetch every file again (~35 MiB,
// each a billed request).
if (process.argv.includes('--wait')) {
  const routes = walk(dist).filter((file) => file.endsWith('/index.html') && relative(dist, file).startsWith('observatory/'));
  const current = async () => {
    for (const file of routes) {
      const at = `/${relative(dist, file)}`.slice(0, -'index.html'.length);
      const r = await raw('GET', undefined, new URL(at, origin), { 'Accept-Encoding': 'identity' });
      if (!r.body.equals(readFileSync(file))) return false;
    }
    return true;
  };
  let arrived = false;
  for (let attempt = 0; attempt < 12 && !(arrived = await current()); attempt++) {
    console.log(`the edge isn't serving this build yet; polling again in 5 s (${attempt + 1} of 12)`);
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  if (!arrived) throw new Error(`after a minute ${origin} still serves another build's HTML`);
}

if (!process.argv.includes('--data-only')) {
  if (!existsSync(join(dist, '.assetsignore'))) throw new Error('worker/dist/ is not staged: run `node apps/observatory/worker/scripts/stage.ts` (or --data-only)');
  const left = readFileSync(join(dist, '.assetsignore'), 'utf8').split('\n').filter((line) => line.startsWith('/'));
  const staged = walk(dist)
    .map((file) => `/${relative(dist, file)}`)
    .filter((path) => !/\.(br|gz)$/.test(path) && !path.endsWith('/.assetsignore') && !path.startsWith('/observatory/data/'));
  let wire = 0;
  for (const path of staged) {
    const extension = path.slice(path.lastIndexOf('.') + 1);
    const local = readFileSync(join(dist, path));
    const at = path.endsWith('/index.html') ? path.slice(0, -'index.html'.length) : path;
    const r = await raw('GET', undefined, new URL(at, origin));
    wire += r.body.length;
    expect(at, r.status === 200, `status ${r.status}`);
    isolated(at, r);
    expect(at, r.headers['cache-control'] === cacheControl(path), `Cache-Control ${r.headers['cache-control']}, expected ${cacheControl(path)}`);
    const type = CONTENT_TYPES[extension];
    if (type) expect(at, r.headers['content-type'] === type, `Content-Type ${r.headers['content-type']}, expected ${type}`);
    if (PRECOMPRESSED.includes(extension)) {
      expect(at, r.headers['content-encoding'] === 'br', `Content-Encoding ${r.headers['content-encoding']}, expected br`);
      expect(at, r.body.equals(readFileSync(join(dist, `${path}.br`))), `${r.body.length} B on the wire aren't the staged quality-11 .br's ${readFileSync(join(dist, `${path}.br`)).length}`);
    }
    if (extension === 'html') {
      const plain = await raw('GET', undefined, new URL(at, origin), { 'Accept-Encoding': 'identity' });
      expect(`${at} without br`, plain.status === 200 && plain.headers['content-encoding'] === undefined, `status ${plain.status}, Content-Encoding ${plain.headers['content-encoding']}`);
      expect(`${at} without br`, plain.body.equals(local), `the HTML differs from the build's (${plain.body.length} B against ${local.length}): ${plain.body.includes('cloudflareinsights') ? 'an injected analytics script' : 'changed'}`);
    }
    if (left.includes(path)) {
      const gz = await raw('GET', undefined, new URL(at, origin), { 'Accept-Encoding': 'gzip' });
      expect(`${at} as gzip`, gz.status === 200 && gz.headers['content-encoding'] === 'gzip', `status ${gz.status}, Content-Encoding ${gz.headers['content-encoding']}`);
      expect(`${at} as gzip`, gz.body.equals(readFileSync(join(dist, `${path}.gz`))), "the bytes aren't the staged .gz's");
    }
  }
  console.log(`builds: ${staged.length} files, ${(wire / 1024 ** 2).toFixed(1)} MiB on the wire as br; ${left.length} served as .gz without br`);

  const [first] = staged.filter((path) => path.endsWith('.wasm'));
  const etag = (await raw('HEAD', undefined, new URL(first!, origin))).headers.etag;
  const revalidated = await raw('GET', undefined, new URL(first!, origin), etag ? { 'If-None-Match': etag } : {});
  expect(`${first} revalidated`, !!etag && revalidated.status === 304, `ETag ${etag}, status ${revalidated.status}`);
  for (const [from, to] of [
    ['/observatory', '/observatory/'],
    ['/observatory/tall-table?side=tanstack', '/observatory/tall-table/?side=tanstack'],
  ]) {
    const r = await raw('GET', undefined, new URL(from!, origin));
    expect(`${from} redirect`, r.status === 301 && r.headers.location === to, `status ${r.status}, Location ${r.headers.location}`);
  }
  const missing = await raw('GET', undefined, new URL('/observatory/assets/missing.js', origin));
  expect('a missing build file', missing.status === 404, `status ${missing.status}`);
  console.log(`revalidation: 304; redirects to the routes' slashes; a missing file 404`);
}

{
  const r = await raw('HEAD');
  console.log(`HEAD: ${r.status}, Content-Length ${r.headers['content-length']}, Accept-Ranges ${r.headers['accept-ranges']}, Content-Type ${r.headers['content-type']}, Cache-Control ${r.headers['cache-control']}, cf-cache-status ${r.headers['cf-cache-status']}`);
  expect('HEAD', r.status === 200, `status ${r.status}`);
  common('HEAD', r);
}
{
  const r = await raw('HEAD', 'bytes=0-');
  console.log(`HEAD bytes=0-: ${r.status}, Content-Range ${r.headers['content-range']}`);
  expect('ranged HEAD', r.status === 206, `status ${r.status}`);
  expect('ranged HEAD', r.headers['content-range'] === range(0, size - 1), `Content-Range ${r.headers['content-range']}`);
  common('ranged HEAD', r);
}
{
  const r = await raw('GET', 'bytes=0-0');
  console.log(`GET bytes=0-0: ${r.status}, Content-Range ${r.headers['content-range']}, ${r.body.length} B on the wire`);
  expect('bytes=0-0', r.status === 206, `status ${r.status}`);
  expect('bytes=0-0', r.headers['content-range'] === range(0, 0), `Content-Range ${r.headers['content-range']}`);
  expect('bytes=0-0', r.body.equals(local.subarray(0, 1)), `body ${r.body.subarray(0, 16).toString('hex')}… (${r.body.length} B)`);
  common('bytes=0-0', r);
}
// The header, the footer DuckDB reads first, a 1 MiB read like its
// readahead, and spots across the file (fixed, so runs compare).
const closed: [number, number][] = [
  [0, 3],
  [size - 8, size - 1],
  [size - 65536, size - 1],
  [1 << 20, (2 << 20) - 1],
  ...[0.1, 0.37, 0.5, 0.9].map((f): [number, number] => [Math.floor(size * f), Math.floor(size * f) + 4095]),
];
for (const [start, end] of closed) {
  const name = `bytes=${start}-${end}`;
  const r = await raw('GET', name);
  expect(name, r.status === 206, `status ${r.status}`);
  expect(name, r.headers['content-range'] === range(start, end), `Content-Range ${r.headers['content-range']}`);
  expect(name, r.body.length === end - start + 1, `${r.body.length} B on the wire, expected ${end - start + 1}`);
  expect(name, r.body.equals(local.subarray(start, end + 1)), 'bytes differ from the local file');
  common(name, r);
}
console.log(`closed ranges: ${closed.length} checked`);
{
  const r = await raw('GET');
  const sha = createHash('sha256').update(r.body).digest('hex');
  console.log(`GET: ${r.status}, ${r.body.length} B on the wire, sha256 ${sha.slice(0, 12)}…`);
  expect('GET', r.status === 200, `status ${r.status}`);
  expect('GET', r.body.length === size, `${r.body.length} B on the wire, expected ${size}`);
  expect('GET', sha === expected.sha256, `SHA-256 ${sha}, expected ${expected.sha256}`);
  common('GET', r);
}
{
  const r = await raw('GET', undefined, new URL('/observatory/data/missing.parquet', origin));
  expect('missing file', r.status === 404, `status ${r.status}`);
}

if (process.argv.includes('--behind-waf')) {
  for (const [name, method, path] of [
    ['probe outside /observatory/', 'GET', '/wp-login.php'],
    ['POST to the data', 'POST', url.pathname],
  ] as const) {
    const r = await raw(method, undefined, new URL(path, origin));
    console.log(`${name}: ${r.status}`);
    expect(name, r.status === 403, `status ${r.status}, expected the WAF's 403`);
  }
}

if (failures.length) {
  console.error(`\n${failures.length} failure(s):\n${failures.join('\n')}`);
  process.exit(1);
}
console.log('\nPASS');
