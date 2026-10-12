/**
 * Tycho's Worker: serves `/data/*` from R2 with byte ranges, and the build
 * (web/dist, `[assets]` in wrangler.toml) precompressed: the page,
 * `/assets/*`, and `/duckdb-ext/*` run this Worker first (`run_worker_first`;
 * any other static asset is served with the headers in `_headers`):
 *
 * - Cloudflare compresses on the fly at a low level: the app wasm went out
 *   as 3.7 MiB of zstd against 2.8 MiB at brotli quality 11, ~1 s more on
 *   Fast 4G before first paint. So the deploy writes a quality-11 `<file>.br`
 *   beside each one (`scripts/deploy.ts`), and a browser that takes br gets
 *   it as is; any other gets the file, compressed by Cloudflare.
 * - A file over the 25 MiB static-asset limit (DuckDB's wasm bundles) is in
 *   R2 under its own path; its `.br` fits in static assets.
 * - Anything else is a 404, never an SPA `index.html`: DuckDB autoloads any
 *   extension a query needs from `/duckdb-ext/`, and only the pinned ones exist.
 *
 * DuckDB-Wasm reads remote Parquet by range: a probe (`bytes=0-0`, from
 * `web/src/engine.ts`), then the footer, then column chunks. So this must
 * answer ranges exactly: `206` with a correct `Content-Range`, `416` for a
 * range past the end, and `HEAD` with `Content-Length` and
 * `Accept-Ranges: bytes`. Multi-range requests aren't needed and get `416`.
 */

import { PRECOMPRESSED } from './precompressed.ts';

interface Env {
  TYCHO_DATA: R2Bucket;
  ASSETS: Fetcher;
  /**
   * Each sample's content version, `name=<sha256 prefix>,…`, set by
   * `just tycho deploy` from MANIFEST.json (after uploading those bytes). It
   * keys the edge cache of `/data/*` reads; a file not named here isn't
   * cached. Unset in `wrangler dev`, whose local R2 is fast anyway.
   */
  DATA_VERSIONS?: string;
  /**
   * `1` while the samples are paused (`just tycho pause`; `resume` sets `0`):
   * every `/data/*` request is a 503, so no read reaches R2, and the page
   * says to drop a file instead. A secret, not a var, so a deploy keeps it.
   */
  DATA_PAUSED?: string;
}

const DATA_PREFIX = '/data/';
/** On a `/data/*` 503 while paused; `web/src/engine.ts` turns it into the page's message. */
const PAUSED_HEADER = 'X-Tycho-Paused';
/** Oversize build assets live in R2 under this key prefix, which is also
 *  their path: Vite's `assets/<name>-<hash>.<ext>`. */
const ASSET_PREFIX = 'assets/';

/** Every response is same-origin, cross-origin isolated content. */
const ISOLATION_HEADERS = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

const CONTENT_TYPES: Record<string, string> = {
  parquet: 'application/vnd.apache.parquet',
  csv: 'text/csv; charset=utf-8',
  json: 'application/json',
  wasm: 'application/wasm',
  js: 'text/javascript',
  html: 'text/html; charset=utf-8',
  ttf: 'font/ttf',
};

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith(DATA_PREFIX)) return serveData(request, env, ctx, url);
    if (url.pathname === '/' || url.pathname === '/index.html' || url.pathname.startsWith(`/${ASSET_PREFIX}`) || url.pathname.startsWith('/duckdb-ext/')) {
      return serveBuild(request, env, url);
    }
    return text(404, 'Not found');
  },
} satisfies ExportedHandler<Env>;

/** The biggest `/data/*` read the edge cache keeps. A miss tees R2's body to
 *  the client and the cache, and the runtime buffers whatever the slower
 *  reader hasn't taken: at 4 MiB a throttled client can't pile up much of the
 *  isolate's 128 MB. DuckDB's readahead steps are 16 KB to 16 MB (CLAUDE.md,
 *  DuckDB gotchas), so the 16 MB step (Gaia's deeper reads) goes uncached. */
const MAX_CACHED_BYTES = 4 * 1024 * 1024;

/** The R2 object's stored SHA-256 (the deploy's upload metadata), carried
 *  from serveObject to serveData and never sent out. */
const SHA_HEADER = 'X-Tycho-Sha256';

/**
 * `/data/*`, through Cloudflare's edge cache. Each read from R2 cost
 * 55–125 ms against 20–35 ms for a static asset, and a page read is several
 * sequential ranges (DuckDB's readahead), so first rows took ~0.9–1.8 s in
 * production. The cache key is the file's content version (`DATA_VERSIONS`)
 * plus the method and the `Range` header as sent, so the stable data names
 * never serve another upload's bytes. Only HEADs and closed ranges up to
 * `MAX_CACHED_BYTES` are kept; a 206 is stored as a 200 (the Cache API won't
 * take a 206) with its status and headers in `X-Tycho-Stored`. The cache is
 * per data center: a visitor's first read of a range there still goes to R2.
 * `X-Tycho-Cache` says which: `hit`, `miss` (read from R2 and kept), or
 * `bypass`.
 *
 * A miss is kept only if the bytes R2 returned are that version (the
 * object's `sha256` metadata): a deploy uploads new data before the Worker
 * with the new `DATA_VERSIONS` is live, and the old Worker must not store the
 * new bytes under the old version's key, next to old bytes already there.
 */
async function serveData(request: Request, env: Env, ctx: ExecutionContext, url: URL): Promise<Response> {
  if (env.DATA_PAUSED === '1') {
    // no-store: a cached 503 would outlive the pause.
    return text(503, 'The samples are paused. Drop your own Parquet or CSV file instead.', { [PAUSED_HEADER]: '1', 'Cache-Control': 'no-store' });
  }
  const rawKey = url.pathname.slice(DATA_PREFIX.length);
  const cache = (globalThis as { caches?: { default?: Cache } }).caches?.default;
  const entry = cache ? dataCacheKey(request, env, url) : null;
  if (!cache || !entry) return withCacheStatus(await serveObject(request, env, rawKey, 'data'), 'bypass');
  const { key: cacheKey, version } = entry;
  const cached = await cache.match(cacheKey);
  if (cached) {
    const stored = JSON.parse(cached.headers.get('X-Tycho-Stored') ?? '{}') as { status: number; headers: [string, string][] };
    const headers = new Headers(stored.headers);
    headers.set('X-Tycho-Cache', 'hit');
    return new Response(request.method === 'HEAD' ? null : cached.body, { status: stored.status, headers });
  }
  const response = await serveObject(request, env, rawKey, 'data');
  const sha = response.headers.get(SHA_HEADER);
  if ((response.status !== 200 && response.status !== 206) || !sha?.startsWith(version)) return withCacheStatus(response, 'bypass');
  const stored = JSON.stringify({ status: response.status, headers: [...response.headers].filter(([name]) => name.toLowerCase() !== SHA_HEADER.toLowerCase()) });
  const keep = (body: BodyInit | null) =>
    new Response(body, { headers: { 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Tycho-Stored': stored } });
  if (!response.body) {
    ctx.waitUntil(cache.put(cacheKey, keep(null)));
    return withCacheStatus(response, 'miss');
  }
  const [client, copy] = response.body.tee();
  ctx.waitUntil(cache.put(cacheKey, keep(copy)));
  return withCacheStatus(new Response(client, response), 'miss');
}

/** The edge-cache key for a `/data/*` request and the file's version, or null if it isn't kept:
 *  a file with no known version, a whole-file GET, or a read that's open-ended
 *  or over `MAX_CACHED_BYTES`. */
export function dataCacheKey(request: Request, env: Env, url: URL): { key: string; version: string } | null {
  if (request.method !== 'GET' && request.method !== 'HEAD') return null;
  let name: string;
  try {
    name = decodeURIComponent(url.pathname.slice(DATA_PREFIX.length));
  } catch {
    return null;
  }
  const version = (env.DATA_VERSIONS ?? '')
    .split(',')
    .map((entry) => entry.trim().split('='))
    .find(([file]) => file === name)?.[1];
  if (!version) return null;
  const header = request.headers.get('Range');
  if (request.method === 'GET') {
    const range = parseRange(header);
    if (range === null || range === 'unsatisfiable') return null;
    const length = 'suffix' in range ? range.suffix : range.length;
    if (length === undefined || length > MAX_CACHED_BYTES) return null;
  }
  const key = new URL(`/__edge-cache/data/${version}/${encodeURIComponent(name)}`, url.origin);
  key.searchParams.set('method', request.method);
  key.searchParams.set('range', header?.trim() ?? '');
  return { key: key.toString(), version };
}

function withCacheStatus(response: Response, status: 'hit' | 'miss' | 'bypass'): Response {
  const copy = new Response(response.body, response);
  copy.headers.delete(SHA_HEADER);
  copy.headers.set('X-Tycho-Cache', status);
  return copy;
}

/**
 * Whether the browser takes brotli. Cloudflare documents
 * `cf.clientAcceptEncoding` as what the browser sent (the header a Worker
 * sees may differ); the header is the fallback, as in `wrangler dev`.
 */
export function acceptsBrotli(request: Request): boolean {
  const cf = (request as { cf?: { clientAcceptEncoding?: string } }).cf;
  const header = cf?.clientAcceptEncoding ?? request.headers.get('Accept-Encoding') ?? '';
  return header.split(',').some((part) => {
    const [coding, ...params] = part.trim().split(';');
    if (coding?.trim().toLowerCase() !== 'br') return false;
    const q = params.map((param) => /^\s*q=([\d.]+)\s*$/.exec(param)?.[1]).find((value) => value !== undefined);
    return q === undefined || Number(q) > 0;
  });
}

/** A build file: its `.br` if the browser takes it, else the file itself,
 *  from static assets or (too big for them) R2. */
async function serveBuild(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return text(405, 'Method not allowed', { Allow: 'GET, HEAD' });
  }
  const path = url.pathname === '/' ? '/index.html' : url.pathname;
  const extension = path.split('.').pop() ?? '';
  // Only types this Worker knows; static assets type everything else
  // themselves (a future .css or .mjs must keep its own).
  const type = CONTENT_TYPES[extension];
  const headers = {
    ...ISOLATION_HEADERS,
    ...(type ? { 'Content-Type': type } : {}),
    // assets/ names are content-hashed; the page and duckdb-ext/ (pinned by
    // version, not by content) revalidate. The page is no-transform too:
    // Cloudflare's Web Analytics injects a beacon script into HTML, a request
    // before first paint (rule 1), unless the response forbids transforms.
    'Cache-Control': path.startsWith(`/${ASSET_PREFIX}`) ? CACHE_CONTROL.asset : extension === 'html' ? 'no-cache, no-transform' : 'no-cache',
    Vary: 'Accept-Encoding',
  };
  if (PRECOMPRESSED.includes(extension) && acceptsBrotli(request)) {
    // The request's own headers go along, so If-None-Match still gets a 304.
    const compressed = await env.ASSETS.fetch(new Request(new URL(`${path}.br`, url), request));
    if (compressed.status === 200 || compressed.status === 304) {
      const etag = compressed.headers.get('ETag');
      const length = compressed.headers.get('Content-Length');
      return new Response(compressed.status === 304 || request.method === 'HEAD' ? null : compressed.body, {
        status: compressed.status,
        headers: { ...headers, 'Content-Encoding': 'br', ...(etag ? { ETag: etag } : {}), ...(length ? { 'Content-Length': length } : {}) },
        // The body is already brotli; don't let the runtime encode it again.
        encodeBody: 'manual',
      });
    }
    await compressed.body?.cancel();
  }
  const asset = await env.ASSETS.fetch(request);
  if (asset.status !== 404) {
    const response = new Response(asset.body, asset);
    for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
    return response;
  }
  await asset.body?.cancel();
  if (url.pathname.startsWith(`/${ASSET_PREFIX}`)) {
    const object = await serveObject(request, env, url.pathname.slice(1), 'asset');
    const response = new Response(object.body, object);
    response.headers.delete(SHA_HEADER);
    return response;
  }
  return text(404, 'Not found');
}

const CACHE_CONTROL = {
  // Data names are stable (asteroids.parquet), so they revalidate: a cached
  // copy mixed with ranges from a new upload would be corrupt. no-transform
  // keeps Cloudflare from compressing Parquet, which would break ranges.
  data: 'no-cache, no-transform',
  // Content-hashed names: a name's bytes never change. Cloudflare may
  // compress these (for a browser without br), which is the point.
  asset: 'public, max-age=31536000, immutable',
};

/** One R2 object by key (still URL-encoded), as a GET or HEAD with byte
 *  ranges. Data keys never reach the oversize assets that share the bucket. */
async function serveObject(request: Request, env: Env, rawKey: string, kind: keyof typeof CACHE_CONTROL): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return text(405, 'Method not allowed', { Allow: 'GET, HEAD' });
  }
  let key: string;
  try {
    key = decodeURIComponent(rawKey);
  } catch {
    return text(400, 'Bad path');
  }
  if (key === '' || key.split('/').some((part) => part === '' || part === '.' || part === '..')) return text(404, 'Not found');
  if (kind === 'data' && key.startsWith(ASSET_PREFIX)) return text(404, 'Not found');
  const headersFor = (object: R2Object, extra: Record<string, string>) => objectHeaders(object, CACHE_CONTROL[kind], extra);
  const partialHeaders = (object: R2Object, range: R2Range) => {
    const { offset, length } = resolveRange(range, object.size);
    return headersFor(object, {
      'Content-Length': String(length),
      'Content-Range': `bytes ${offset}-${offset + length - 1}/${object.size}`,
    });
  };

  const range = parseRange(request.headers.get('Range'));
  if (request.method === 'HEAD' || range === 'unsatisfiable') {
    const object = await env.TYCHO_DATA.head(key);
    if (!object) return text(404, 'Not found');
    if (range === 'unsatisfiable') return rangeNotSatisfiable(object.size);
    if (!range) return new Response(null, { headers: headersFor(object, { 'Content-Length': String(object.size) }) });
    // A ranged HEAD gets the headers the ranged GET would. DuckDB-Wasm sizes
    // an HTTP file with `HEAD` + `Range: bytes=0-` and reads by range only if
    // that answers 206 with a Content-Length; otherwise it downloads the file.
    if ('offset' in range && (range.offset ?? 0) >= object.size) return rangeNotSatisfiable(object.size);
    return new Response(null, { status: 206, headers: partialHeaders(object, range) });
  }

  let object: R2ObjectBody | null;
  try {
    object = await env.TYCHO_DATA.get(key, range ? { range } : {});
  } catch (error) {
    // R2 throws "The requested range is not satisfiable (10039)" for an
    // offset at or past the end. Miniflare clamps a length or suffix that
    // runs past the end; production R2 might reject it instead. Only on this
    // error pay for a HEAD: past the end is a 416, anything else is retried
    // clamped to the object's size, as RFC 9110 asks.
    if (!range || !String(error).includes('10039')) throw error;
    const head = await env.TYCHO_DATA.head(key);
    if (!head) return text(404, 'Not found');
    const clamped = resolveRange(range, head.size);
    if (clamped.length <= 0 || clamped.offset >= head.size) return rangeNotSatisfiable(head.size);
    object = await env.TYCHO_DATA.get(key, { range: clamped });
  }
  if (!object) return text(404, 'Not found');
  if (!range) {
    return new Response(object.body, { headers: headersFor(object, { 'Content-Length': String(object.size) }) });
  }
  if (resolveRange(range, object.size).length <= 0) return rangeNotSatisfiable(object.size);
  return new Response(object.body, { status: 206, headers: partialHeaders(object, range) });
}

type ParsedRange = R2Range | 'unsatisfiable' | null;

/**
 * One `bytes=` range as R2 takes it, `null` for none (serve the whole file),
 * or `'unsatisfiable'` for anything this Worker won't serve: multiple ranges,
 * other units, or a malformed header. `bytes=-0` is unsatisfiable too.
 *
 * Parsed here rather than passing `request.headers` to R2: given a header it
 * can't satisfy (several ranges, or a start past the end), R2 returns the
 * whole object with no error (seen in Miniflare), which would go out as a
 * `206` that isn't one.
 */
export function parseRange(header: string | null): ParsedRange {
  if (header === null) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return 'unsatisfiable';
  const [, start = '', end = ''] = match;
  if (start === '' && end === '') return 'unsatisfiable';
  if (start === '') {
    const suffix = Number(end);
    return suffix > 0 ? { suffix } : 'unsatisfiable';
  }
  const offset = Number(start);
  if (end === '') return { offset };
  const last = Number(end);
  return last >= offset ? { offset, length: last - offset + 1 } : 'unsatisfiable';
}

/** The bytes a range covers in an object of `size` bytes. Computed from our
 *  own range, not `object.range`, which R2 may report as given (a suffix). */
export function resolveRange(range: R2Range, size: number): { offset: number; length: number } {
  if ('suffix' in range) {
    const length = Math.min(range.suffix, size);
    return { offset: size - length, length };
  }
  const offset = range.offset ?? 0;
  return { offset, length: Math.min(range.length ?? size - offset, size - offset) };
}

function objectHeaders(object: R2Object, cacheControl: string, extra: Record<string, string>): Headers {
  const extension = object.key.split('.').pop() ?? '';
  return new Headers({
    ...ISOLATION_HEADERS,
    'Content-Type': CONTENT_TYPES[extension] ?? 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    ETag: object.httpEtag,
    ...(object.customMetadata?.sha256 ? { [SHA_HEADER]: object.customMetadata.sha256 } : {}),
    'Last-Modified': object.uploaded.toUTCString(),
    'Cache-Control': cacheControl,
    ...extra,
  });
}

function rangeNotSatisfiable(size: number): Response {
  return text(416, 'Range not satisfiable', { 'Content-Range': `bytes */${size}`, 'Accept-Ranges': 'bytes' });
}

function text(status: number, body: string, headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers: { ...ISOLATION_HEADERS, 'Content-Type': 'text/plain; charset=utf-8', ...headers } });
}
