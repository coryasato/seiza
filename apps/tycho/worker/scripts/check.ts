// Checks /data/* byte-range handling end to end: HEAD, single ranges (closed,
// open, suffix, clamped), 416s (past the end, multiple ranges, reversed),
// 404s, headers (isolation, Accept-Ranges, no Content-Encoding), and that the
// whole file matches MANIFEST.json's SHA-256.
//
// Usage: node apps/tycho/worker/scripts/check.ts [--url <origin>]
// With no --url it starts `wrangler dev` (local R2). perf/sample.ts runs the
// same checks through the Vite preview proxy.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startWorkerDev } from './dev.ts';

const workerDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(workerDir, '../data/MANIFEST.json'), 'utf8')) as Record<string, { bytes: number; sha256: string }>;

/** Returns one line per failed check; empty means all passed. */
export async function checkDataEndpoint(origin: string, options: { file?: string; viaProxy?: boolean } = {}): Promise<string[]> {
  const file = options.file ?? 'asteroids.parquet';
  const expected = manifest[file];
  if (!expected) return [`MANIFEST.json has no ${file}`];
  const size = expected.bytes;
  const url = `${origin}/data/${file}`;
  const failures: string[] = [];
  const expect = (name: string, ok: boolean, detail: string) => {
    if (!ok) failures.push(`${name}: ${detail}`);
  };
  const request = async (init: RequestInit & { range?: string }, target = url) => {
    const headers = new Headers(init.headers);
    if (init.range) headers.set('Range', init.range);
    headers.set('Accept-Encoding', 'br, gzip');
    const response = await fetch(target, { ...init, headers });
    const body = new Uint8Array(await response.arrayBuffer());
    return { response, body, header: (name: string) => response.headers.get(name) };
  };
  const commonHeaders = (name: string, header: (name: string) => string | null) => {
    expect(name, header('Content-Encoding') === null, `Content-Encoding ${header('Content-Encoding')} (Parquet must go out as stored)`);
    expect(name, header('Cross-Origin-Resource-Policy') === 'same-origin', `CORP ${header('Cross-Origin-Resource-Policy')}`);
    expect(name, header('Cross-Origin-Embedder-Policy') === 'require-corp', `COEP ${header('Cross-Origin-Embedder-Policy')}`);
  };

  {
    const { response, header } = await request({ method: 'HEAD' });
    expect('HEAD', response.status === 200, `status ${response.status}`);
    expect('HEAD', header('Content-Length') === String(size), `Content-Length ${header('Content-Length')}, expected ${size}`);
    expect('HEAD', header('Accept-Ranges') === 'bytes', `Accept-Ranges ${header('Accept-Ranges')}`);
    commonHeaders('HEAD', header);
  }

  {
    // DuckDB-Wasm sizes HTTP files this way; without a 206 it downloads the whole file.
    const { response, header } = await request({ method: 'HEAD', range: 'bytes=0-' });
    expect('HEAD bytes=0-', response.status === 206, `status ${response.status}`);
    expect('HEAD bytes=0-', header('Content-Length') === String(size), `Content-Length ${header('Content-Length')}, expected ${size}`);
    expect('HEAD bytes=0-', header('Content-Range') === `bytes 0-${size - 1}/${size}`, `Content-Range ${header('Content-Range')}`);
    const past = await request({ method: 'HEAD', range: `bytes=${size}-` });
    expect(`HEAD bytes=${size}-`, past.response.status === 416, `status ${past.response.status}, expected 416`);
  }

  const ranges: [range: string, offset: number, length: number][] = [
    ['bytes=0-0', 0, 1],
    ['bytes=0-3', 0, 4],
    ['bytes=-8', size - 8, 8],
    [`bytes=${size - 4}-`, size - 4, 4],
    [`bytes=${size - 5}-${size + 100}`, size - 5, 5],
    [`bytes=-${size + 100}`, 0, size],
  ];
  const whole = await request({});
  for (const [range, offset, length] of ranges) {
    const { response, body, header } = await request({ range });
    const name = `GET ${range}`;
    expect(name, response.status === 206, `status ${response.status}`);
    expect(name, header('Content-Range') === `bytes ${offset}-${offset + length - 1}/${size}`, `Content-Range ${header('Content-Range')}`);
    expect(name, body.length === length, `${body.length} bytes, expected ${length}`);
    expect(name, Buffer.compare(body, whole.body.subarray(offset, offset + length)) === 0, 'bytes differ from the same range of the whole file');
    commonHeaders(name, header);
  }
  {
    const { body } = await request({ range: 'bytes=0-3' });
    expect('Parquet magic', new TextDecoder().decode(body) === 'PAR1', `first bytes ${JSON.stringify(new TextDecoder().decode(body))}`);
  }

  for (const range of [`bytes=${size}-`, `bytes=${size + 10}-${size + 20}`, 'bytes=0-1,4-5', 'bytes=5-2', 'bytes=-0', 'items=0-1', 'bytes=x-y']) {
    const { response, header } = await request({ range });
    expect(`GET ${range}`, response.status === 416, `status ${response.status}, expected 416`);
    expect(`GET ${range}`, header('Content-Range') === `bytes */${size}`, `Content-Range ${header('Content-Range')}`);
  }

  expect('GET whole', whole.response.status === 200, `status ${whole.response.status}`);
  expect('GET whole', whole.body.length === size, `${whole.body.length} bytes, expected ${size}`);
  const sha256 = createHash('sha256').update(whole.body).digest('hex');
  expect('GET whole', sha256 === expected.sha256, `SHA-256 ${sha256} doesn't match MANIFEST.json; rerun \`just tycho data\``);
  commonHeaders('GET whole', whole.header);

  for (const [name, target, init] of [
    ['missing file', `${origin}/data/missing.parquet`, {}],
    ['missing file, ranged', `${origin}/data/missing.parquet`, { range: 'bytes=0-0' }],
    // A proxy (Vite's) normalizes dot segments before the Worker sees them.
    ...(options.viaProxy ? [] : [['dot segments', `${origin}/data/%2e%2e/secret`, {}] as const]),
  ] as const) {
    const { response } = await request(init, target);
    expect(name, response.status === 404, `status ${response.status}, expected 404`);
  }
  {
    const { response } = await request({ method: 'POST' });
    expect('POST', response.status === 405, `status ${response.status}, expected 405`);
  }
  return failures;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const index = process.argv.indexOf('--url');
  const given = index > 0 ? process.argv[index + 1] : undefined;
  const worker = given ? null : await startWorkerDev({ port: 8788, requireObject: 'asteroids.parquet' });
  try {
    const failures = await checkDataEndpoint(given ?? worker!.url);
    if (failures.length > 0) {
      console.error(`FAIL\n${failures.map((failure) => `  ${failure}`).join('\n')}`);
      process.exitCode = 1;
    } else {
      console.log('PASS: /data range handling');
    }
  } finally {
    await worker?.close();
  }
}
