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
- **Static assets: 25 MiB per file.** Bigger files (DuckDB-Wasm's bundles) go in R2 and are served by the Worker; `.assetsignore` keeps them out of the upload.
