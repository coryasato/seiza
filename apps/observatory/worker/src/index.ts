/**
 * The Observatory's Worker. Everything is a static asset; this runs first for
 * `/observatory/data/*` (`run_worker_first`), and for any path no asset
 * matches (a 404 here; the zone's WAF keeps most of those from reaching it,
 * since each is a billed request). It exists because static assets
 * ignore `Range`: they answer every request with a 200 and the whole file,
 * and never from the edge cache. DuckDB-Wasm reads Parquet only by range
 * (a ranged `HEAD`, a `bytes=0-0` probe, then the footer and column chunks).
 *
 * So the file is put whole into the edge cache (`caches.default`), once per
 * location, from the static asset, and every request is answered by
 * `cache.match`, which serves ranges from a cached 200: `206` with
 * `Content-Range`. The cache key carries the file's SHA-256 (`DATA_SHA256`,
 * set at deploy from data/MANIFEST.json), so ranges from two versions never
 * mix. The response goes out `no-transform` with no Content-Encoding:
 * re-encoding would break the byte ranges.
 */

interface Env {
  ASSETS: Fetcher;
  /** data/MANIFEST.json's SHA-256 of asteroids.parquet, set by `just observatory deploy`. */
  DATA_SHA256?: string;
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
    if (!url.pathname.startsWith('/observatory/data/')) return text(404, 'Not found');
    const version = env.DATA_SHA256;
    if (!version) return text(503, 'DATA_SHA256 is unset: deploy with `just observatory deploy`');

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
  },
} satisfies ExportedHandler<Env>;

function text(status: number, body: string, headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers: { ...ISOLATION, 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...headers } });
}
