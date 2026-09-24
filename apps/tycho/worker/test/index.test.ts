// The Worker against a fake R2 bucket, for behavior Miniflare can't show:
// production R2 might reject a range that runs past the end (error 10039)
// where Miniflare clamps it.
// Run: node --test apps/tycho/worker/test/index.test.ts (`just tycho worker-check` runs it too).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import worker from '../src/index.ts';

const SIZE = 100;
const DATA = new Uint8Array(SIZE).map((_, index) => index);

/** A bucket whose `get` rejects any range reaching past the end, and counts calls. */
function strictBucket() {
  const calls = { get: 0, head: 0 };
  const meta = (key: string) => ({ key, size: SIZE, httpEtag: '"x"', uploaded: new Date(0) });
  const bucket = {
    async head(key: string) {
      calls.head++;
      return key === 'f.parquet' ? meta(key) : null;
    },
    async get(key: string, options: { range?: { offset?: number; length?: number; suffix?: number } } = {}) {
      calls.get++;
      if (key !== 'f.parquet') return null;
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
  return { calls, env: { TYCHO_DATA: bucket } };
}

async function fetchRange(range: string) {
  const { calls, env } = strictBucket();
  const request = new Request('http://x/data/f.parquet', { headers: { Range: range } });
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
