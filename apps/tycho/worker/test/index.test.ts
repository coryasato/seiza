// The Worker against a fake R2 bucket, for behavior Miniflare can't show:
// production R2 might reject a range that runs past the end (error 10039)
// where Miniflare clamps it.
// Run: node --test apps/tycho/worker/test/index.test.ts (`just tycho worker-check` runs it too).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import worker from '../src/index.ts';

const SIZE = 100;
const DATA = new Uint8Array(SIZE).map((_, index) => index);
/** What the fake bucket holds: one data file and one oversize asset. */
const KEYS = new Set(['f.parquet', 'assets/big-abc123.wasm']);

/** A bucket whose `get` rejects any range reaching past the end, and counts
 *  calls. Its objects' stored SHA-256 starts with `uploadedSha`. */
function strictBucket(uploadedSha = 'abc123') {
  const calls = { get: 0, head: 0 };
  const meta = (key: string) => ({ key, size: SIZE, httpEtag: '"x"', uploaded: new Date(0), customMetadata: { sha256: `${uploadedSha}ffff` } });
  const bucket = {
    async head(key: string) {
      calls.head++;
      return KEYS.has(key) ? meta(key) : null;
    },
    async get(key: string, options: { range?: { offset?: number; length?: number; suffix?: number } } = {}) {
      calls.get++;
      if (!KEYS.has(key)) return null;
      const range = options.range;
      let start = 0;
      let end = SIZE;
      if (range && 'suffix' in range && range.suffix !== undefined) {
        if (range.suffix > SIZE) throw new Error('get: The requested range is not satisfiable (10039)');
        start = SIZE - range.suffix;
      } else if (range) {
        start = range.offset ?? 0;
        end = range.length === undefined ? SIZE : start + range.length;
        if (start >= SIZE || end > SIZE) throw new Error('get: The requested range is not satisfiable (10039)');
      }
      return { ...meta(key), body: new Blob([DATA.slice(start, end)]).stream() };
    },
  };
  return { calls, env: { TYCHO_DATA: bucket, ASSETS: assets } };
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

async function fetchRange(range: string, path = '/data/f.parquet', headers: Record<string, string> = {}) {
  const { calls, env } = strictBucket();
  const request = new Request(`http://x${path}`, { headers: { ...headers, ...(range ? { Range: range } : {}) } });
  const response = await (worker.fetch as unknown as (request: Request, env: unknown) => Promise<Response>)(request, env);
  const body = new Uint8Array(await response.arrayBuffer());
  return { response, body, calls };
}

test('a range within the file costs one R2 call', async () => {
  const { response, body, calls } = await fetchRange('bytes=10-19');
  assert.equal(response.status, 206);
  assert.equal(response.headers.get('Content-Range'), `bytes 10-19/${SIZE}`);
  assert.deepEqual([...body], [...DATA.slice(10, 20)]);
  assert.deepEqual(calls, { get: 1, head: 0 });
});

test('a length past the end is clamped, not a 416', async () => {
  const { response, body } = await fetchRange('bytes=95-500');
  assert.equal(response.status, 206);
  assert.equal(response.headers.get('Content-Range'), `bytes 95-99/${SIZE}`);
  assert.equal(response.headers.get('Content-Length'), '5');
  assert.deepEqual([...body], [...DATA.slice(95)]);
});

test('a suffix longer than the file is the whole file', async () => {
  const { response, body } = await fetchRange('bytes=-500');
  assert.equal(response.status, 206);
  assert.equal(response.headers.get('Content-Range'), `bytes 0-99/${SIZE}`);
  assert.equal(body.length, SIZE);
});

test('a start past the end is a 416', async () => {
  const { response } = await fetchRange(`bytes=${SIZE}-`);
  assert.equal(response.status, 416);
  assert.equal(response.headers.get('Content-Range'), `bytes */${SIZE}`);
});

test('a build file goes out as its quality-11 .br to a browser that takes br', async () => {
  for (const accept of ['gzip, deflate, br, zstd', 'br', 'BR;q=0.5']) {
    const { response, body } = await fetchRange('', '/assets/app-1.wasm', { 'Accept-Encoding': accept });
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
  const { response, body } = await fetchRange('', '/', { 'Accept-Encoding': 'gzip, br' });
  assert.equal(response.headers.get('Content-Encoding'), 'br');
  assert.equal(response.headers.get('Content-Type'), 'text/html; charset=utf-8');
  assert.equal(response.headers.get('Cache-Control'), 'no-cache, no-transform');
  assert.equal(response.headers.get('Cross-Origin-Opener-Policy'), 'same-origin');
  assert.equal(new TextDecoder().decode(body), 'brotli page');
  const plain = await fetchRange('', '/', { 'Accept-Encoding': 'gzip' });
  assert.equal(plain.response.headers.get('Cache-Control'), 'no-cache, no-transform');
  assert.equal(new TextDecoder().decode(plain.body), 'raw page');
});

test('a browser without br gets the file itself', async () => {
  for (const accept of ['gzip, zstd', 'br;q=0', '']) {
    const { response, body } = await fetchRange('', '/assets/app-1.wasm', accept ? { 'Accept-Encoding': accept } : {});
    assert.equal(response.headers.get('Content-Encoding'), null, accept);
    assert.equal(response.headers.get('Content-Type'), 'application/wasm', accept);
    assert.equal(new TextDecoder().decode(body), 'raw wasm', accept);
  }
});

test('a file with no .br goes out as itself; extensions revalidate', async () => {
  const { response, body } = await fetchRange('', '/duckdb-ext/v1/wasm_eh/parquet.duckdb_extension.wasm', { 'Accept-Encoding': 'br' });
  assert.equal(response.headers.get('Content-Encoding'), null);
  assert.equal(response.headers.get('Cache-Control'), 'no-cache');
  assert.equal(new TextDecoder().decode(body), 'raw extension');
});

test('a revalidation of the .br is a 304', async () => {
  const { response } = await fetchRange('', '/assets/app-1.wasm', { 'Accept-Encoding': 'br', 'If-None-Match': '"e"' });
  assert.equal(response.status, 304);
  assert.equal(response.headers.get('Content-Encoding'), 'br');
});

test('an oversize asset comes from R2 as wasm, cached for good', async () => {
  const { response, body } = await fetchRange('', '/assets/big-abc123.wasm');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Type'), 'application/wasm');
  assert.equal(response.headers.get('Cache-Control'), 'public, max-age=31536000, immutable');
  assert.equal(response.headers.get('Cross-Origin-Embedder-Policy'), 'require-corp');
  assert.equal(body.length, SIZE);
});

test('data keeps no-transform, so Cloudflare never re-encodes its ranges', async () => {
  const { response } = await fetchRange('bytes=0-0');
  assert.equal(response.headers.get('Cache-Control'), 'no-cache, no-transform');
});

test('the oversize assets are not data', async () => {
  for (const path of ['/data/assets/big-abc123.wasm', '/data/assets%2Fbig-abc123.wasm']) {
    const { response, calls } = await fetchRange('', path);
    assert.equal(response.status, 404, path);
    assert.deepEqual(calls, { get: 0, head: 0 }, path);
  }
});

test('a path no asset matched is a 404, never index.html', async () => {
  for (const path of ['/duckdb-ext/v1.4.3/wasm_eh/json.duckdb_extension.wasm', '/nope', '/assets/missing-1.wasm']) {
    const { response } = await fetchRange('', path);
    assert.equal(response.status, 404, path);
    assert.equal(response.headers.get('Content-Type'), 'text/plain; charset=utf-8', path);
  }
});

/** An in-memory stand-in for `caches.default`, installed for one test. */
async function withEdgeCache(
  run: (fetchData: (range: string | null, method?: string, path?: string) => Promise<{ response: Response; body: Uint8Array; calls: { get: number; head: number } }>) => Promise<void>,
  uploadedSha = 'abc123',
) {
  const store = new Map<string, Response>();
  const cache = {
    async match(key: string) {
      return store.get(key)?.clone();
    },
    async put(key: string, response: Response) {
      store.set(key, new Response(await response.arrayBuffer(), response));
    },
  };
  (globalThis as { caches?: unknown }).caches = { default: cache };
  const { calls, env } = strictBucket(uploadedSha);
  const versioned = { ...env, DATA_VERSIONS: 'f.parquet=abc123, other.parquet=def456' };
  try {
    await run(async (range, method = 'GET', path = '/data/f.parquet') => {
      const pending: Promise<unknown>[] = [];
      const request = new Request(`http://x${path}`, { method, headers: range ? { Range: range } : {} });
      const response = await (worker.fetch as unknown as (request: Request, env: unknown, ctx: unknown) => Promise<Response>)(request, versioned, {
        waitUntil: (promise: Promise<unknown>) => pending.push(promise),
      });
      const body = new Uint8Array(await response.arrayBuffer());
      await Promise.all(pending);
      return { response, body, calls: { ...calls } };
    });
  } finally {
    delete (globalThis as { caches?: unknown }).caches;
  }
}

test('a range read is kept at the edge: the second costs no R2 call', async () => {
  await withEdgeCache(async (fetchData) => {
    const first = await fetchData('bytes=10-19');
    assert.equal(first.response.headers.get('X-Tycho-Cache'), 'miss');
    assert.equal(first.calls.get, 1);
    const second = await fetchData('bytes=10-19');
    assert.equal(second.response.headers.get('X-Tycho-Cache'), 'hit');
    assert.equal(second.calls.get, 1, 'no new R2 read');
    assert.equal(second.response.status, 206);
    assert.equal(second.response.headers.get('Content-Range'), `bytes 10-19/${SIZE}`);
    assert.equal(second.response.headers.get('Cache-Control'), 'no-cache, no-transform');
    assert.equal(second.response.headers.get('Cross-Origin-Embedder-Policy'), 'require-corp');
    assert.equal(second.response.headers.get('X-Tycho-Stored'), null);
    assert.deepEqual([...second.body], [...DATA.slice(10, 20)]);
    // Another range is another entry.
    assert.equal((await fetchData('bytes=20-29')).response.headers.get('X-Tycho-Cache'), 'miss');
  });
});

test('a ranged HEAD is kept too, with its headers and no body', async () => {
  await withEdgeCache(async (fetchData) => {
    await fetchData('bytes=0-', 'HEAD');
    const second = await fetchData('bytes=0-', 'HEAD');
    assert.equal(second.response.headers.get('X-Tycho-Cache'), 'hit');
    assert.equal(second.calls.head, 1);
    assert.equal(second.response.status, 206);
    assert.equal(second.response.headers.get('Content-Length'), String(SIZE));
    assert.equal(second.body.length, 0);
  });
});

test('whole files, open ranges, unknown files, and errors bypass the edge cache', async () => {
  await withEdgeCache(async (fetchData) => {
    for (const [range, method, path] of [
      [null, 'GET', '/data/f.parquet'],
      ['bytes=10-', 'GET', '/data/f.parquet'],
      [`bytes=0-${64 * 1024 * 1024}`, 'GET', '/data/f.parquet'],
      ['bytes=0-9', 'GET', '/data/unversioned.parquet'],
      [`bytes=${SIZE}-${SIZE + 5}`, 'GET', '/data/f.parquet'],
    ] as const) {
      const { response } = await fetchData(range, method, path);
      assert.equal(response.headers.get('X-Tycho-Cache'), 'bypass', `${method} ${path} ${range}`);
    }
  });
});

test('bytes from another upload are served but never kept under this version', async () => {
  await withEdgeCache(async (fetchData) => {
    const first = await fetchData('bytes=10-19');
    assert.equal(first.response.status, 206);
    assert.equal(first.response.headers.get('X-Tycho-Cache'), 'bypass');
    const second = await fetchData('bytes=10-19');
    assert.equal(second.response.headers.get('X-Tycho-Cache'), 'bypass');
    assert.equal(second.calls.get, 2, 'read from R2 both times');
  }, 'fff999');
});

test("the stored SHA-256 never leaves the Worker", async () => {
  await withEdgeCache(async (fetchData) => {
    for (const [range, method] of [['bytes=10-19', 'GET'], ['bytes=10-19', 'GET'], ['bytes=0-', 'HEAD'], [null, 'GET']] as const) {
      const { response } = await fetchData(range, method);
      assert.equal(response.headers.get('X-Tycho-Sha256'), null, `${method} ${range} (${response.headers.get('X-Tycho-Cache')})`);
    }
    const asset = await fetchData(null, 'GET', '/assets/big-abc123.wasm');
    assert.equal(asset.response.headers.get('X-Tycho-Sha256'), null);
  });
});

test('a build file of a type the Worker does not know keeps its own type', async () => {
  const { response } = await fetchRange('', '/assets/style-1.css', { 'Accept-Encoding': 'br' });
  assert.equal(response.headers.get('Content-Type'), 'text/css');
  assert.equal(response.headers.get('Cross-Origin-Embedder-Policy'), 'require-corp');
});

test('reads over 4 MiB bypass the edge cache', async () => {
  await withEdgeCache(async (fetchData) => {
    const { response } = await fetchData(`bytes=0-${4 * 1024 * 1024}`);
    assert.equal(response.headers.get('X-Tycho-Cache'), 'bypass');
  });
});

test('paused, every /data read is a 503 that touches neither R2 nor the cache; the build still serves', async () => {
  const { calls, env } = strictBucket();
  const paused = { ...env, DATA_PAUSED: '1', DATA_VERSIONS: 'f.parquet=abc123' };
  const call = (path: string, init: RequestInit = {}) =>
    (worker.fetch as unknown as (request: Request, env: unknown) => Promise<Response>)(new Request(`http://x${path}`, init), paused);
  for (const init of [{}, { headers: { Range: 'bytes=0-0' } }, { method: 'HEAD' }]) {
    const response = await call('/data/f.parquet', init);
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('X-Tycho-Paused'), '1');
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal(response.headers.get('Cross-Origin-Resource-Policy'), 'same-origin');
  }
  assert.deepEqual(calls, { get: 0, head: 0 });
  assert.equal((await call('/assets/app-1.wasm')).status, 200);
  const resumed = await (worker.fetch as unknown as (request: Request, env: unknown) => Promise<Response>)(
    new Request('http://x/data/f.parquet', { headers: { Range: 'bytes=0-0' } }),
    { ...env, DATA_PAUSED: '0' },
  );
  assert.equal(resumed.status, 206);
});
