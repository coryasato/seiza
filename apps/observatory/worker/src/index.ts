/**
 * The Observatory's Worker, on the apex `seiza.io`. It runs first for every
 * request (`run_worker_first = true`), for two reasons:
 *
 * - **The builds, precompressed.** Cloudflare compresses on the fly at a low
 *   level, so the deploy writes a quality-11 `<file>.br` beside each build
 *   file (`scripts/stage.ts`), and a browser that takes br gets it as is.
 *   Any other gets the file, which Cloudflare compresses, or, for a file
 *   over the 25 MiB static-asset limit (DuckDB's wasm bundles, left out of
 *   the assets), its `<file>.gz`. A route is its `index.html`; a path
 *   without its trailing slash redirects to it. Anything outside
 *   `/observatory/` and `/fonts/` is a 404 (the zone's WAF keeps most of
 *   those from reaching here, since each is a billed request).
 * - **The data, by range** (`/observatory/data/*`). Static assets ignore
 *   `Range`: they answer every request with a 200 and the whole file, and
 *   never from the edge cache. DuckDB-Wasm reads Parquet only by range (a
 *   ranged `HEAD`, a `bytes=0-0` probe, then the footer and column chunks).
 *   So the file is put whole into the edge cache (`caches.default`), once
 *   per location, from the static asset, and every request is answered by
 *   `cache.match`, which serves ranges from a cached 200: `206` with
 *   `Content-Range`. Each file's cache key carries its own SHA-256
 *   (`DATA_FILES`, set at deploy from data/MANIFEST.json), so ranges from
 *   two versions never mix, and a file the deploy didn't name is a 404.
 *   The response goes out `no-transform` with no Content-Encoding:
 *   re-encoding would break the byte ranges.
 */

import { accepts } from '../../../../shared-web/src/encoding.ts';
import { BUILD_PREFIXES, CONTENT_TYPES, PRECOMPRESSED, cacheControl } from './files.ts';

interface Env {
  ASSETS: Fetcher;
  /** The data files and their SHA-256s, as JSON (`{"<name>.parquet": "<sha256>"}`), from
   *  data/MANIFEST.json, set by `just observatory deploy`. */
  DATA_FILES?: string;
}

const ISOLATION = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
};
/** How long a location keeps the file; a new version has a new key anyway. */
const EDGE_TTL = 7 * 24 * 3600;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'GET' && request.method !== 'HEAD') return text(405, 'GET or HEAD only', { Allow: 'GET, HEAD' });
    const url = new URL(request.url);
    if (url.pathname.startsWith('/observatory/data/')) return serveData(request, env, url);
    if (url.pathname === '/observatory' || BUILD_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) return serveBuild(request, env, url);
    return text(404, 'Not found');
  },
} satisfies ExportedHandler<Env>;

/** `DATA_FILES` parsed, once an isolate (keyed by its text); `null` when
 *  it's unset or isn't a JSON object of names to SHA-256s. */
let parsed: { text: string; files: Record<string, string> | null } | undefined;
function dataFiles(text: string | undefined): Record<string, string> | null {
  if (!text) return null;
  if (parsed?.text !== text) {
    let files: Record<string, string> | null = null;
    try {
      const value: unknown = JSON.parse(text);
      if (value && typeof value === 'object' && !Array.isArray(value) && Object.values(value).every((sha) => typeof sha === 'string' && /^[0-9a-f]{64}$/.test(sha)))
        files = value as Record<string, string>;
    } catch {
      files = null;
    }
    parsed = { text, files };
  }
  return parsed.files;
}

async function serveData(request: Request, env: Env, url: URL): Promise<Response> {
  const versions = dataFiles(env.DATA_FILES);
  if (!versions) return text(503, 'DATA_FILES is unset or not JSON of names to SHA-256s: deploy with `just observatory deploy`');
  const name = url.pathname.slice('/observatory/data/'.length);
  const version = Object.hasOwn(versions, name) ? versions[name] : undefined;
  if (!version) return text(404, 'Not found');

  // The key: the path and the version, no query; a GET, whatever was asked.
  const key = new Request(`${url.origin}${url.pathname}?v=${version}`);
  const range = request.headers.get('Range');
  const lookup = new Request(key, { headers: range ? { Range: range } : {} });
  const cache = caches.default;
  let cached = await cache.match(lookup);
  if (!cached) {
    const asset = await env.ASSETS.fetch(new Request(`${url.origin}${url.pathname}`));
    if (asset.status === 404) return text(404, 'Not found');
    if (!asset.ok) return text(502, `static asset answered ${asset.status}`);
    const body = await asset.arrayBuffer();
    await cache.put(
      key,
      new Response(body, {
        headers: { 'Content-Type': 'application/vnd.apache.parquet', 'Cache-Control': `public, max-age=${EDGE_TTL}`, ETag: `"${version}"` },
      }),
    );
    cached = await cache.match(lookup);
    // A location that didn't store it (it may refuse): answer from the
    // bytes in hand, the whole file for a request without a range.
    if (!cached) {
      if (range) return text(503, 'the edge cache refused the file; try again', { 'Retry-After': '1' });
      cached = new Response(body, { headers: { 'Content-Type': 'application/vnd.apache.parquet', ETag: `"${version}"` } });
    }
  }

  const headers = new Headers(cached.headers);
  headers.set('Cache-Control', 'no-cache, no-transform');
  headers.set('Accept-Ranges', 'bytes');
  headers.delete('CF-Cache-Status');
  for (const [name, value] of Object.entries(ISOLATION)) headers.set(name, value);
  return new Response(request.method === 'HEAD' ? null : cached.body, { status: cached.status, headers, encodeBody: 'manual' });
}

/** A build file: its `.br` if the browser takes it, else the file, else
 *  (too big for static assets) its `.gz` if the browser takes gzip. */
async function serveBuild(request: Request, env: Env, url: URL): Promise<Response> {
  // A route without its slash, as a browser resolves the page's relative
  // URLs against it: `/observatory` → `/observatory/`.
  const last = url.pathname.slice(url.pathname.lastIndexOf('/') + 1);
  if (last !== '' && !last.includes('.')) return new Response(null, { status: 301, headers: { ...ISOLATION, Location: `${url.pathname}/${url.search}`, 'Cache-Control': 'no-cache' } });
  const path = url.pathname.endsWith('/') ? `${url.pathname}index.html` : url.pathname;
  const extension = path.slice(path.lastIndexOf('.') + 1);
  const type = CONTENT_TYPES[extension];
  const headers: Record<string, string> = { ...ISOLATION, ...(type ? { 'Content-Type': type } : {}), 'Cache-Control': cacheControl(path), Vary: 'Accept-Encoding' };
  // The request's own headers go along, so If-None-Match still gets a 304.
  const fetchAsset = (file: string) => env.ASSETS.fetch(new Request(new URL(file, url), request));
  const encoded = async (suffix: string, coding: string): Promise<Response | null> => {
    const asset = await fetchAsset(`${path}${suffix}`);
    if (asset.status !== 200 && asset.status !== 304) {
      await asset.body?.cancel();
      return null;
    }
    const etag = asset.headers.get('ETag');
    const length = asset.headers.get('Content-Length');
    return new Response(asset.status === 304 || request.method === 'HEAD' ? null : asset.body, {
      status: asset.status,
      headers: { ...headers, 'Content-Encoding': coding, ...(etag ? { ETag: etag } : {}), ...(length ? { 'Content-Length': length } : {}) },
      // The body is already encoded; don't let the runtime encode it again.
      encodeBody: 'manual',
    });
  };
  if (PRECOMPRESSED.includes(extension) && accepts(request, 'br')) {
    const response = await encoded('.br', 'br');
    if (response) return response;
  }
  const asset = await fetchAsset(path);
  if (asset.status !== 404) {
    const response = new Response(request.method === 'HEAD' ? null : asset.body, asset);
    for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
    return response;
  }
  await asset.body?.cancel();
  if (accepts(request, 'gzip')) {
    const response = await encoded('.gz', 'gzip');
    if (response) return response;
  }
  return text(404, 'Not found');
}

function text(status: number, body: string, headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers: { ...ISOLATION, 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...headers } });
}
