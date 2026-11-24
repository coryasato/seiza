---
paths:
  - "apps/*/worker/**"
  - "site/worker/**"
  - "**/wrangler.toml"
  - "**/.assetsignore"
---

# Known Cloudflare gotchas (found deploying Tycho and the observatory)

- **Cloudflare's own compression is weak.** It compresses on the fly at a low level and prefers zstd when the browser offers it: Tycho's app wasm went out as 3.7 MiB (3.6 as br) against 2.8 MiB at brotli quality 11, the size the budgets measure, ~1 s more before first paint on Fast 4G. Workers static assets can't serve precompressed files, so Tycho's Worker runs first (`run_worker_first`) for the page and build files and returns a quality-11 `.br` (written at deploy) with `Content-Encoding: br` and `encodeBody: 'manual'`; browsers without br fall through to Cloudflare's compression.
- **Workers static assets ignore `Range`:** every request gets a 200 and the whole file, and `cf-cache-status` stays MISS (static assets skip the zone's cache, which is what answers ranges), whatever `_headers` says. Local `wrangler dev` is no guide: it gzips the file too. Data read by range (DuckDB) runs a Worker first: `apps/observatory/worker/src/index.ts` serves a static asset by range through `caches.default`.
- **Cloudflare Web Analytics injects a script into HTML** (`static.cloudflareinsights.com/beacon.min.js`, then `/cdn-cgi/rum`), before first paint, when the zone has it on. Serving the page with `Cache-Control: no-transform` stops it. Tycho's check fails if the page holds an injected script.
- **A ranged or encoded response loses `Content-Length` on HEAD** through Cloudflare's edge; count wire bytes from a raw GET (Tycho's `worker/scripts/check.ts`, `wireBytes`).
- **`wrangler dev` re-encodes a Worker's precompressed responses** (gzip, whatever `Content-Encoding` and `encodeBody: 'manual'` say), so a local run can't check what encoding production serves; check the bytes on the wire in production.
- **A new version takes seconds to reach the edge.** Checks right after `wrangler deploy` read the old version; retry before failing.
- **A custom domain's first deploy creates its DNS record, and a machine that asked for the name before keeps its miss** for the zone's negative TTL (30 min on seiza.io): `dig @1.1.1.1` resolves it, Node's `getaddrinfo` doesn't. Don't probe a new hostname before its deploy; to check it sooner without `sudo` to flush the cache, resolve through 1.1.1.1 (a `dns.lookup` override preloaded with `node --import`).
- **Single Redirects (Rules → Redirect Rules) run before the WAF's custom rules, the rate limit, and any Worker:** a path a redirect answers needs no allowlist row, and its 301 costs no Worker request. "Preserve query string" is off by default.
- **A route runs before a custom domain's Worker on the same hostname,** so a second Worker can take a path of a hostname another holds (as Kirkwood's once did on Tycho's): its `fetch(request)` reaches the custom domain's Worker as its origin, and the WAF runs before both. A pattern is matched against the whole URL: one ending `name*` takes `names` too, and one with no `*` misses the same path with a query. Take `path*`, and have the WAF's allowlist and the Worker refuse what isn't the path's.
- **The edge resolves dot segments before it routes,** encoded ones too: `/kirkwood/%2e%2e/data/x` is `/data/x` to the WAF, the route, and the Worker. A path isn't proof of which Worker answered.
- **Cloudflare doesn't compress `application/octet-stream`:** a data file sent as it is goes out whole to a browser that doesn't take the encoding the Worker precompressed.
- **Static assets: 25 MiB per file.** Bigger files (DuckDB-Wasm's bundles) go in R2 and are served by the Worker; `.assetsignore` keeps them out of the upload.
