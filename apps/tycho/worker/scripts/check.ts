// Checks /data/* byte-range handling end to end: HEAD, single ranges (closed,
// open, suffix, clamped), 416s (past the end, multiple ranges, reversed),
// 404s, headers (isolation, Accept-Ranges, no Content-Encoding), and that the
// whole file matches MANIFEST.json's SHA-256. With --url, also the deployed
// assets (`checkAssets`): every web/dist file, the oversize ones from R2.
//
// Usage: node apps/tycho/worker/scripts/check.ts [--url <origin>]
// With no --url it starts `wrangler dev` (local R2). perf/sample.ts runs the
// same checks through the Vite preview proxy; deploy.ts runs them on production.

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { get as httpsGet } from 'node:https';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startWorkerDev } from './dev.ts';

const workerDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(workerDir, '../data/MANIFEST.json'), 'utf8')) as Record<string, { bytes: number; sha256: string }>;

/** Returns one line per failed check; empty means all passed. */
export async function checkDataEndpoint(origin: string, options: { file?: string; viaProxy?: boolean; edgeCache?: boolean } = {}): Promise<string[]> {
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

  if (options.edgeCache) {
    // Production keeps range reads at the edge (src/index.ts, serveData). The
    // first read's copy is stored after it answers, so give it a moment.
    const range = 'bytes=1000-1999';
    const first = await request({ range });
    let again = first;
    for (let attempt = 0; attempt < 10 && again.header('X-Tycho-Cache') !== 'hit'; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      again = await request({ range });
    }
    expect('edge cache', again.header('X-Tycho-Cache') === 'hit', `a repeated ${range} read as ${again.header('X-Tycho-Cache')}, expected hit`);
    expect('edge cache', again.response.status === 206 && again.header('Content-Range') === `bytes 1000-1999/${size}`, `status ${again.response.status}, Content-Range ${again.header('Content-Range')}`);
    expect('edge cache', Buffer.compare(again.body, whole.body.subarray(1000, 2000)) === 0, 'cached bytes differ from the file');
    commonHeaders('edge cache', again.header);
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

const ASSET_LIMIT = 25 * 1024 * 1024;
/** What Chromium sends, so Cloudflare picks what a visitor gets. */
const BROWSER_ENCODINGS = 'gzip, deflate, br, zstd';
const assetTypes: Record<string, string> = {
  wasm: 'application/wasm',
  js: 'text/javascript',
  ttf: 'font/ttf',
  html: 'text/html',
};

/** The bytes a browser's GET of `url` puts on the wire (fetch would decode
 *  them; a HEAD's Content-Length is dropped by Cloudflare for encoded bodies). */
function wireBytes(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    httpsGet(url, { headers: { 'Accept-Encoding': BROWSER_ENCODINGS } }, (response) => {
      let bytes = 0;
      response.on('data', (chunk: Buffer) => (bytes += chunk.length));
      response.on('end', () => resolve(bytes));
      response.on('error', reject);
    }).on('error', reject);
  });
}

/**
 * The deployed build against web/dist: each file is served with its bytes
 * (SHA-256), its type, the isolation headers, and `immutable` under assets/;
 * the page, wasm, JS, and font come as the deploy's quality-11 brotli (the size
 * matches the `.br` beside it); the oversize files (`oversize`, from R2) too.
 * A missing DuckDB extension and the R2 assets under /data/ are 404s.
 * Logs each wasm's Content-Encoding and bytes on the wire, which M8 records.
 */
export async function checkAssets(origin: string, dist: string, oversize?: string[]): Promise<string[]> {
  const failures: string[] = [];
  const expect = (name: string, ok: boolean, detail: string) => {
    if (!ok) failures.push(`${name}: ${detail}`);
  };
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]));
  const files = walk(dist)
    .map((file) => relative(dist, file))
    .filter((path) => path !== '_headers' && path !== '.assetsignore' && !path.endsWith('.br'));
  const big = oversize ?? files.filter((path) => statSync(join(dist, path)).size > ASSET_LIMIT);
  for (const path of files) {
    const target = path === 'index.html' ? `${origin}/` : `${origin}/${path}`;
    const response = await fetch(target, { headers: { 'Accept-Encoding': BROWSER_ENCODINGS } });
    // fetch decodes the body; Content-Encoding still says how it came.
    const body = new Uint8Array(await response.arrayBuffer());
    const header = (name: string) => response.headers.get(name);
    const name = `${path}${big.includes(path) ? ' (R2)' : ''}`;
    expect(name, response.status === 200, `status ${response.status}`);
    if (response.status !== 200) continue;
    const sum = createHash('sha256').update(body).digest('hex');
    const local = createHash('sha256').update(readFileSync(join(dist, path))).digest('hex');
    expect(name, sum === local, `bytes differ from web/dist (${body.length} bytes)`);
    const type = assetTypes[path.split('.').pop() ?? ''];
    if (type) expect(name, header('Content-Type')?.startsWith(type) ?? false, `Content-Type ${header('Content-Type')}, expected ${type}`);
    expect(name, header('Cross-Origin-Opener-Policy') === 'same-origin', `COOP ${header('Cross-Origin-Opener-Policy')}`);
    expect(name, header('Cross-Origin-Embedder-Policy') === 'require-corp', `COEP ${header('Cross-Origin-Embedder-Policy')}`);
    if (path.startsWith('assets/')) expect(name, header('Cache-Control')?.includes('immutable') ?? false, `Cache-Control ${header('Cache-Control')}`);
    if (path === 'index.html') {
      // Nothing may load before first paint: no injected scripts (Cloudflare's
      // Web Analytics beacon) and no-transform so none get in.
      expect(name, header('Cache-Control')?.includes('no-transform') ?? false, `Cache-Control ${header('Cache-Control')}, expected no-transform`);
      expect(name, !/cloudflareinsights|cdn-cgi\//.test(new TextDecoder().decode(body)), 'the page has an injected Cloudflare script');
    }
    const encoding = header('Content-Encoding');
    if (/\.(wasm|js|ttf|html)$/.test(path)) {
      const wire = await wireBytes(target);
      const br = statSync(join(dist, `${path}.br`), { throwIfNoEntry: false })?.size;
      if (path.endsWith('.wasm')) console.log(`  ${name}: Content-Encoding ${encoding ?? 'none'}, ${wire} bytes on the wire (raw ${body.length})`);
      expect(name, encoding === 'br', `Content-Encoding ${encoding}, expected br (the deploy's quality 11)`);
      if (br !== undefined) expect(name, wire === br, `${wire} bytes on the wire, expected the .br's ${br}`);
    }
  }
  const missing: [string, string][] = [
    ['missing DuckDB extension', `${origin}/duckdb-ext/v0.0.0/wasm_eh/json.duckdb_extension.wasm`],
    ['missing asset', `${origin}/assets/missing-00000000.wasm`],
    ...big.map((path): [string, string] => [`${path} under /data/`, `${origin}/data/${path}`]),
  ];
  for (const [name, target] of missing) {
    const response = await fetch(target);
    await response.body?.cancel();
    expect(name, response.status === 404, `status ${response.status}, expected 404`);
  }
  return failures;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const index = process.argv.indexOf('--url');
  const given = index > 0 ? process.argv[index + 1] : undefined;
  const worker = given ? null : await startWorkerDev({ port: 8788, requireObject: 'asteroids.parquet' });
  try {
    const failures = await checkDataEndpoint(given ?? worker!.url, { edgeCache: Boolean(given) });
    if (given) failures.push(...(await checkAssets(given, join(workerDir, '../web/dist'))));
    if (failures.length > 0) {
      console.error(`FAIL\n${failures.map((failure) => `  ${failure}`).join('\n')}`);
      process.exitCode = 1;
    } else {
      console.log(`PASS: /data range handling${given ? ', assets' : ''}`);
    }
  } finally {
    await worker?.close();
  }
}
