/**
 * Tycho's Worker: serves the build (web/dist, `[assets]` in wrangler.toml)
 * precompressed: the page, `/assets/*`, and `/duckdb-ext/*` run this Worker
 * first (`run_worker_first`; any other static asset is served with the
 * headers in `_headers`):
 *
 * - Cloudflare compresses on the fly at a low level: the app wasm went out
 *   as 3.7 MiB of zstd against 2.8 MiB at brotli quality 11, ~1 s more on
 *   Fast 4G before first paint. So the deploy writes a quality-11 `<file>.br`
 *   beside each one (`scripts/deploy.ts`), and a browser that takes br gets
 *   it as is; any other gets the file, compressed by Cloudflare.
 * - A file over the 25 MiB static-asset limit (DuckDB's two wasm bundles) is
 *   in R2 under its own path, and the bucket holds nothing else; its `.br`
 *   fits in static assets. It's fetched whole, so no ranges.
 * - Anything else is a 404, never an SPA `index.html`: DuckDB autoloads any
 *   extension a query needs from `/duckdb-ext/`, and only the pinned ones
 *   exist. `/data/*` is one too: no dataset is in the bucket.
 */

import { accepts } from '../../../../shared-web/src/encoding.ts';
import { PRECOMPRESSED } from './precompressed.ts';

interface Env {
  /** The bucket (`tycho-data`): DuckDB's two wasm bundles, and nothing else. */
  TYCHO_DATA: R2Bucket;
  ASSETS: Fetcher;
}

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
  wasm: 'application/wasm',
  js: 'text/javascript',
  html: 'text/html; charset=utf-8',
  ttf: 'font/ttf',
};

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/' || url.pathname === '/index.html' || url.pathname.startsWith(`/${ASSET_PREFIX}`) || url.pathname.startsWith('/duckdb-ext/')) {
      return serveBuild(request, env, url);
    }
    return text(404, 'Not found');
  },
} satisfies ExportedHandler<Env>;

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
    'Cache-Control': path.startsWith(`/${ASSET_PREFIX}`) ? IMMUTABLE : extension === 'html' ? 'no-cache, no-transform' : 'no-cache',
    Vary: 'Accept-Encoding',
  };
  if (PRECOMPRESSED.includes(extension) && accepts(request, 'br')) {
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
    return serveObject(request, env, url.pathname.slice(1));
  }
  return text(404, 'Not found');
}

/** Content-hashed names: a name's bytes never change. Cloudflare may
 *  compress these (for a browser without br), which is the point. */
const IMMUTABLE = 'public, max-age=31536000, immutable';

/** One R2 object by key (still URL-encoded), whole, as a GET or HEAD. */
async function serveObject(request: Request, env: Env, rawKey: string): Promise<Response> {
  let key: string;
  try {
    key = decodeURIComponent(rawKey);
  } catch {
    return text(400, 'Bad path');
  }
  if (key.split('/').some((part) => part === '' || part === '.' || part === '..')) return text(404, 'Not found');
  const object: R2Object | R2ObjectBody | null = request.method === 'HEAD' ? await env.TYCHO_DATA.head(key) : await env.TYCHO_DATA.get(key);
  if (!object) return text(404, 'Not found');
  const extension = object.key.split('.').pop() ?? '';
  const headers = {
    ...ISOLATION_HEADERS,
    'Content-Type': CONTENT_TYPES[extension] ?? 'application/octet-stream',
    ETag: object.httpEtag,
    'Last-Modified': object.uploaded.toUTCString(),
    'Cache-Control': IMMUTABLE,
    'Content-Length': String(object.size),
  };
  return new Response('body' in object ? (object as R2ObjectBody).body : null, { headers });
}

function text(status: number, body: string, headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers: { ...ISOLATION_HEADERS, 'Content-Type': 'text/plain; charset=utf-8', ...headers } });
}
