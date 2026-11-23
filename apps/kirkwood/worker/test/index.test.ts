// The Worker against a fake bucket and fake static assets: what it takes
// off a path, which copy it picks, and what it refuses.
// Run: node --test apps/kirkwood/worker/test/index.test.ts (`just kirkwood test` runs it too).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import worker, { type Env } from '../src/index.ts';
import { PAUSED_HEADER } from '../src/names.ts';
import { keyOf } from '../src/versions.ts';

const ORIGIN = 'https://kirkwood.seiza.io';
// Each file under its key (the manifest's hash, then its name), and what
// isn't to be served: a file under its bare name, and another key.
const [ELEMENTS, ROWS, STARS] = [keyOf('elements.bin')!, keyOf('rows.bin')!, keyOf('stars.bin')!];
const OBJECTS: Record<string, string> = { [ELEMENTS]: 'elements', [`${ELEMENTS}.br`]: 'elements-br', [ROWS]: 'rows', [`${ROWS}.br`]: 'rows-br', [STARS]: 'stars', [`${STARS}.br`]: 'stars-br', 'secret.bin': 'secret', 'put.json': '{}' };
const ASSETS: Record<string, string> = { '/index.html': '<page>', '/index.html.br': 'page-br', '/assets/app-abc.wasm': 'wasm', '/assets/app-abc.wasm.br': 'wasm-br', '/assets/notes.txt': 'notes' };

function env(paused?: string) {
  const calls = { get: [] as string[], head: [] as string[], assets: [] as string[] };
  const meta = (key: string) => ({ key, size: OBJECTS[key]!.length, httpEtag: `"${key}"`, uploaded: new Date(0) });
  const bucket = {
    async head(key: string) {
      calls.head.push(key);
      return key in OBJECTS ? meta(key) : null;
    },
    async get(key: string, options: { onlyIf?: Headers } = {}) {
      calls.get.push(key);
      if (!(key in OBJECTS)) return null;
      // As R2: any condition that fails comes back with no body.
      if (options.onlyIf?.get('If-None-Match') === `"${key}"` || options.onlyIf?.has('If-Match')) return meta(key);
      return { ...meta(key), body: new Blob([OBJECTS[key]!]).stream() };
    },
  };
  const assets = {
    async fetch(request: Request) {
      const path = new URL(request.url).pathname;
      calls.assets.push(path);
      return path in ASSETS ? new Response(request.method === 'HEAD' ? null : ASSETS[path]!, { headers: { ETag: `"${path}"`, 'Content-Length': String(ASSETS[path]!.length) } }) : new Response('nothing', { status: 404 });
    },
  };
  return { calls, env: { KIRKWOOD_DATA: bucket, ASSETS: assets, ...(paused ? { DATA_PAUSED: paused } : {}) } as unknown as Env };
}

const ask = (e: Env, path: string, init: RequestInit & { br?: boolean } = {}) =>
  worker.fetch(new Request(`${ORIGIN}${path}`, { ...init, headers: { ...(init.br === false ? {} : { 'Accept-Encoding': 'gzip, br' }), ...init.headers } }) as never, e);

test('the page is at the root, its query no matter', async () => {
  const { env: e } = env();
  for (const path of ['/', '/?roll=0']) {
    const response = await ask(e, path);
    assert.equal(response.status, 200, path);
    assert.equal(await response.text(), 'page-br', path);
  }
});

test("the old address is the zone's to redirect, never this Worker's: no 301, no page, no file", async () => {
  const { env: e, calls } = env();
  for (const path of ['/kirkwood', '/kirkwood?roll=0', '/kirkwood/', '/kirkwood/?roll=0', '/kirkwood/index.html', '/kirkwood/assets/app-abc.wasm', '/kirkwood/data/elements.bin']) {
    const response = await ask(e, path);
    assert.equal(response.status, 404, path);
    assert.equal(response.headers.get('Location'), null, path);
  }
  assert.deepEqual(calls.get, []);
});

test('the page and a build file go out as their .br, isolated', async () => {
  const { env: e } = env();
  for (const [path, body, cache] of [
    ['/', 'page-br', 'no-cache, no-transform'],
    ['/index.html', 'page-br', 'no-cache, no-transform'],
    ['/assets/app-abc.wasm', 'wasm-br', 'public, max-age=31536000, immutable'],
  ] as const) {
    const response = await ask(e, path);
    assert.equal(response.status, 200, path);
    assert.equal(await response.text(), body, path);
    assert.equal(response.headers.get('Content-Encoding'), 'br', path);
    assert.equal(response.headers.get('Cache-Control'), cache, path);
    assert.equal(response.headers.get('Cross-Origin-Opener-Policy'), 'same-origin', path);
    assert.equal(response.headers.get('Cross-Origin-Embedder-Policy'), 'require-corp', path);
  }
});

test('a browser without br gets the file itself', async () => {
  const response = await ask(env().env, '/assets/app-abc.wasm', { br: false });
  assert.equal(await response.text(), 'wasm');
  assert.equal(response.headers.get('Content-Encoding'), null);
  assert.equal(response.headers.get('Content-Type'), 'application/wasm');
});

test('a file with no .br is served, a .br by name and a missing file are not, and the page is never the fallback', async () => {
  const { env: e } = env();
  assert.equal(await (await ask(e, '/assets/notes.txt')).text(), 'notes');
  for (const path of ['/assets/app-abc.wasm.br', '/index.html.br', '/assets/missing.js', '/anything', '//index.html', '//x/index.html', '/\\x/index.html', '//x/assets/app-abc.wasm', '/assets//app-abc.wasm']) {
    const response = await ask(e, path);
    assert.equal(response.status, 404, path);
    assert.equal(await response.text(), 'Not found', path);
  }
});

test("each of the three files goes out as its .br object, whole, with the object's length", async () => {
  const { env: e, calls } = env();
  for (const name of ['elements.bin', 'rows.bin', 'stars.bin']) {
    const response = await ask(e, `/data/${name}`);
    assert.equal(response.status, 200, name);
    assert.equal(await response.text(), OBJECTS[`${keyOf(name)}.br`], name);
    assert.equal(response.headers.get('Content-Encoding'), 'br', name);
    assert.equal(response.headers.get('Content-Length'), String(OBJECTS[`${keyOf(name)}.br`]!.length), name);
    assert.equal(response.headers.get('Cache-Control'), 'no-cache, no-transform', name);
    assert.equal(response.headers.get('Cross-Origin-Resource-Policy'), 'same-origin', name);
  }
  assert.deepEqual(calls.get, [`${ELEMENTS}.br`, `${ROWS}.br`, `${STARS}.br`]);
});

test('a file without br is the file itself; a HEAD reads no body', async () => {
  const { env: e, calls } = env();
  const plain = await ask(e, '/data/rows.bin', { br: false });
  assert.equal(await plain.text(), 'rows');
  assert.equal(plain.headers.get('Content-Encoding'), null);
  const head = await ask(e, '/data/rows.bin', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('Content-Length'), String('rows-br'.length));
  assert.deepEqual(calls, { get: [ROWS], head: [`${ROWS}.br`], assets: [] });
});

test("a browser holding the object is answered 304, and the other encoding's tag isn't a match", async () => {
  const { env: e } = env();
  const held = await ask(e, '/data/stars.bin', { headers: { 'If-None-Match': `"${STARS}.br"` } });
  assert.equal(held.status, 304);
  assert.equal(held.headers.get('ETag'), `"${STARS}.br"`);
  assert.equal((await ask(e, '/data/stars.bin', { headers: { 'If-None-Match': `"${STARS}"` } })).status, 200);
  const head = await ask(e, '/data/stars.bin', { method: 'HEAD', headers: { 'If-None-Match': `W/"${STARS}.br"` } });
  assert.equal(head.status, 304);
});

test('no other condition is a 304', async () => {
  const response = await ask(env().env, '/data/stars.bin', { headers: { 'If-Match': '"other"', 'If-Unmodified-Since': 'Thu, 01 Jan 1970 00:00:00 GMT' } });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'stars-br');
});

test('nothing else of the bucket is served, by any spelling', async () => {
  const { env: e, calls } = env();
  for (const path of ['/data/secret.bin', '/data/put.json', `/data/${ELEMENTS}`, `/data/${ELEMENTS}.br`, '/data/elements.bin.br', '/data/', '/data/a/elements.bin', '/data/%65lements.bin']) assert.equal((await ask(e, path)).status, 404, path);
  assert.deepEqual(calls.get, []);
});

test('paused, a file is a 503 that says so and nothing reads the bucket; the page still loads', async () => {
  const { env: e, calls } = env('1');
  const response = await ask(e, '/data/elements.bin');
  assert.equal(response.status, 503);
  assert.equal(response.headers.get(PAUSED_HEADER), '1');
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(calls.get, []);
  assert.equal((await ask(e, '/')).status, 200);
  assert.equal((await ask(env('0').env, '/data/elements.bin')).status, 200);
});

test('only GET and HEAD', async () => {
  const response = await ask(env().env, '/data/elements.bin', { method: 'POST' });
  assert.equal(response.status, 405);
  assert.equal(response.headers.get('Allow'), 'GET, HEAD');
});
