// The Worker against fakes of its bindings: the build's static assets and an
// R2 bucket that holds DuckDB's oversize wasm bundles and nothing else.
// Run: node --test apps/tycho/worker/test/index.test.ts (`just tycho worker-check` runs it too).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import worker from '../src/index.ts';

const SIZE = 100;
const DATA = new Uint8Array(SIZE).map((_, index) => index);
/** What the fake bucket holds: one oversize asset. */
const KEYS = new Set(['assets/big-abc123.wasm']);

/** A bucket that counts its calls. */
function bucket() {
  const calls = { get: 0, head: 0 };
  const meta = (key: string) => ({ key, size: SIZE, httpEtag: '"x"', uploaded: new Date(0) });
  const r2 = {
    async head(key: string) {
      calls.head++;
      return KEYS.has(key) ? meta(key) : null;
    },
    async get(key: string) {
      calls.get++;
      return KEYS.has(key) ? { ...meta(key), body: new Blob([DATA]).stream() } : null;
    },
  };
  return { calls, env: { TYCHO_DATA: r2, ASSETS: assets } };
}

/** Static assets: a build file and its `.br`, and one with no `.br`. */
const STATIC: Record<string, string> = {
  '/assets/app-1.wasm': 'raw wasm',
  '/assets/app-1.wasm.br': 'brotli wasm',
  '/duckdb-ext/v1/wasm_eh/parquet.duckdb_extension.wasm': 'raw extension',
  '/': 'raw page',
  '/index.html.br': 'brotli page',
  '/assets/style-1.css': 'body{}',
};
const assets = {
  async fetch(request: Request) {
    const body = STATIC[new URL(request.url).pathname];
    if (body === undefined) return new Response('nope', { status: 404 });
    if (request.headers.get('If-None-Match') === '"e"') return new Response(null, { status: 304, headers: { ETag: '"e"' } });
    const type = request.url.endsWith('.css') ? 'text/css' : 'application/octet-stream';
    return new Response(body, { headers: { ETag: '"e"', 'Content-Length': String(body.length), 'Content-Type': type } });
  },
};

async function fetchPath(path: string, headers: Record<string, string> = {}, method = 'GET') {
  const { calls, env } = bucket();
  const request = new Request(`http://x${path}`, { method, headers });
  const response = await (worker.fetch as unknown as (request: Request, env: unknown) => Promise<Response>)(request, env);
  const body = new Uint8Array(await response.arrayBuffer());
  return { response, body, calls };
}

test('a build file goes out as its quality-11 .br to a browser that takes br', async () => {
  for (const accept of ['gzip, deflate, br, zstd', 'br', 'BR;q=0.5']) {
    const { response, body } = await fetchPath('/assets/app-1.wasm', { 'Accept-Encoding': accept });
    assert.equal(response.status, 200, accept);
    assert.equal(response.headers.get('Content-Encoding'), 'br', accept);
    assert.equal(response.headers.get('Content-Type'), 'application/wasm', accept);
    assert.equal(response.headers.get('Cache-Control'), 'public, max-age=31536000, immutable', accept);
    assert.equal(response.headers.get('Vary'), 'Accept-Encoding', accept);
    assert.equal(response.headers.get('Cross-Origin-Embedder-Policy'), 'require-corp', accept);
    assert.equal(new TextDecoder().decode(body), 'brotli wasm', accept);
  }
});

test('the page goes out as its .br, and never transformed', async () => {
  const { response, body } = await fetchPath('/', { 'Accept-Encoding': 'gzip, br' });
  assert.equal(response.headers.get('Content-Encoding'), 'br');
  assert.equal(response.headers.get('Content-Type'), 'text/html; charset=utf-8');
  assert.equal(response.headers.get('Cache-Control'), 'no-cache, no-transform');
  assert.equal(response.headers.get('Cross-Origin-Opener-Policy'), 'same-origin');
  assert.equal(new TextDecoder().decode(body), 'brotli page');
  const plain = await fetchPath('/', { 'Accept-Encoding': 'gzip' });
  assert.equal(plain.response.headers.get('Cache-Control'), 'no-cache, no-transform');
  assert.equal(new TextDecoder().decode(plain.body), 'raw page');
});

test('a browser without br gets the file itself', async () => {
  for (const accept of ['gzip, zstd', 'br;q=0', '']) {
    const { response, body } = await fetchPath('/assets/app-1.wasm', accept ? { 'Accept-Encoding': accept } : {});
    assert.equal(response.headers.get('Content-Encoding'), null, accept);
    assert.equal(response.headers.get('Content-Type'), 'application/wasm', accept);
    assert.equal(new TextDecoder().decode(body), 'raw wasm', accept);
  }
});

test('a file with no .br goes out as itself; extensions revalidate', async () => {
  const { response, body } = await fetchPath('/duckdb-ext/v1/wasm_eh/parquet.duckdb_extension.wasm', { 'Accept-Encoding': 'br' });
  assert.equal(response.headers.get('Content-Encoding'), null);
  assert.equal(response.headers.get('Cache-Control'), 'no-cache');
  assert.equal(new TextDecoder().decode(body), 'raw extension');
});

test('a revalidation of the .br is a 304', async () => {
  const { response } = await fetchPath('/assets/app-1.wasm', { 'Accept-Encoding': 'br', 'If-None-Match': '"e"' });
  assert.equal(response.status, 304);
  assert.equal(response.headers.get('Content-Encoding'), 'br');
});

test('an oversize asset comes from R2 whole, as wasm, cached for good', async () => {
  const { response, body, calls } = await fetchPath('/assets/big-abc123.wasm', { 'Accept-Encoding': 'gzip' });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Type'), 'application/wasm');
  assert.equal(response.headers.get('Content-Length'), String(SIZE));
  assert.equal(response.headers.get('Cache-Control'), 'public, max-age=31536000, immutable');
  assert.equal(response.headers.get('Cross-Origin-Embedder-Policy'), 'require-corp');
  assert.deepEqual([...body], [...DATA]);
  assert.deepEqual(calls, { get: 1, head: 0 });
  const head = await fetchPath('/assets/big-abc123.wasm', { 'Accept-Encoding': 'gzip' }, 'HEAD');
  assert.equal(head.response.status, 200);
  assert.equal(head.response.headers.get('Content-Length'), String(SIZE));
  assert.equal(head.body.length, 0);
  assert.deepEqual(head.calls, { get: 0, head: 1 });
});

test('/data/* is a 404 that never reads the bucket', async () => {
  for (const path of ['/data/asteroids.parquet', '/data/assets/big-abc123.wasm', '/data/assets%2Fbig-abc123.wasm']) {
    const { response, calls } = await fetchPath(path);
    assert.equal(response.status, 404, path);
    assert.deepEqual(calls, { get: 0, head: 0 }, path);
  }
});

test('a write to the build is refused', async () => {
  const { response, calls } = await fetchPath('/assets/big-abc123.wasm', {}, 'POST');
  assert.equal(response.status, 405);
  assert.deepEqual(calls, { get: 0, head: 0 });
});

test('a path no asset matched is a 404, never index.html', async () => {
  for (const path of ['/duckdb-ext/v1.4.3/wasm_eh/json.duckdb_extension.wasm', '/nope', '/assets/missing-1.wasm']) {
    const { response } = await fetchPath(path);
    assert.equal(response.status, 404, path);
    assert.equal(response.headers.get('Content-Type'), 'text/plain; charset=utf-8', path);
  }
});

test('a build file of a type the Worker does not know keeps its own type', async () => {
  const { response } = await fetchPath('/assets/style-1.css', { 'Accept-Encoding': 'br' });
  assert.equal(response.headers.get('Content-Type'), 'text/css');
  assert.equal(response.headers.get('Cross-Origin-Embedder-Policy'), 'require-corp');
});
