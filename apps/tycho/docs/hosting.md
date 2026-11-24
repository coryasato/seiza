# Hosting

How Tycho is served: one Cloudflare Worker on one origin, with static assets and R2. Paths are relative to `apps/tycho/`. Why each choice was made is in [`DECISIONS.md`](DECISIONS.md), "Hosting"; the Cloudflare gotchas every app shares are in `.claude/rules/cloudflare.md`.

**Production is version 1 until the rebuild ships** (`DECISIONS.md`, "Hosting", 2026-11-23): what this tree builds is described first, then what production still holds.

## This tree

- **Names:** Worker `tycho`, R2 bucket `tycho-data`, bound as `TYCHO_DATA`. `wrangler.toml` doesn't commit the account ID; wrangler takes it from `wrangler login` (or `CLOUDFLARE_ACCOUNT_ID` with an API token), and API tokens never go in the repo.
- **Origin:** **https://tycho.seiza.io**, a Workers custom domain on the `seiza.io` zone (`routes` in `wrangler.toml`), with `workers_dev = false` and `preview_urls = false` (the account's `*.workers.dev` subdomain names its owner). Workers Logs stay on (`[observability]`).
- **Static assets** serve the build (`web/dist`), at most **25 MiB a file**: `just tycho build` checks every file against it. `_headers` (written by `shared-web`'s Vite config) sets COOP/COEP/CORP on every asset and `immutable` on `assets/`.
- **The sample** is one of them: `/assets/gcat-<hash>.parquet` (1.7 MiB), content-hashed and `immutable`, downloaded whole on the sample button's press ([`data.md`](data.md)). Parquet is already compressed, so it gets no `.br` and isn't read by range.
- **Precompressed build files:** the Worker runs first (`run_worker_first`) for `/`, `/index.html`, `/assets/*`, and `/duckdb-ext/*`. To a browser that takes br it returns the file's quality-11 `.br` as is (`encodeBody: 'manual'`); otherwise the file itself, which Cloudflare compresses (zstd or gzip). Cloudflare's own compression sent the app wasm as 3.7 MiB of zstd against 2.8 MiB at quality 11. The page goes out `no-cache, no-transform`, so the zone's Web Analytics can't inject its beacon script before first paint. A path no asset matches is a 404, never `index.html` (`not_found_handling = "none"`): DuckDB autoloads any extension a query needs from `/duckdb-ext/`. `/data/*` is a 404 that reads nothing.
- **R2 holds DuckDB-Wasm's two wasm bundles and nothing else** (33 and 38 MiB, over the static-asset limit), under `assets/<name>`, their own path; the Worker serves each whole to a browser that doesn't take br. Their `.br` (5 and 6 MiB) are static assets. No dataset goes in R2 (`DECISIONS.md`, "Hosting", 2026-11-21).
- **Deploy:** `just tycho deploy` (`worker/scripts/deploy.ts`): release build; the bundles to R2 through its S3 API (the AWS CLI profile named by `TYCHO_R2_PROFILE`) when R2's copy differs; a quality-11 `.br` beside every wasm, JS, font, and HTML file; `.assetsignore` for the oversize files; `wrangler deploy`; then `check.ts` against production, retried for a minute while the version propagates. It refuses without `--rebuild-ships` (`--dry-run` aside) until the rebuild ships.
- **Local:** `just tycho dev` and `preview` run Vite alone, with the same isolation headers. `just tycho worker-check` runs the Worker under `wrangler dev`, its local bucket filled from the release build's two bundles by `worker/scripts/dev.ts`.

## Production until the rebuild ships

Production runs version 1, built from the tag `tycho-v1`, whose `docs/hosting.md` describes it whole. What it holds that this tree doesn't:

- **The two old samples in R2,** read by byte range at `/data/*` (every known asteroid, 37.7 MB, and Gaia DR3's 25 M brightest stars, 1.57 GB), with range reads kept in Cloudflare's edge cache keyed by each sample's SHA-256.
- **The pause switch:** `just tycho pause` sets that Worker's `DATA_PAUSED`, and its `/data/*` answers 503 while the page and dropped files keep working; `just tycho resume` clears it. This tree's Worker doesn't read it.

The deploy that ships the rebuild deletes both samples from R2, leaving the two bundles, and looks at the zone's WAF rules and rate limit again against the new build's requests (`PLAN.md`, "Ship the rebuild"). The owner confirms each deletion.

## Abuse guards

Cost scales with Worker requests and R2 reads, not bytes, and Cloudflare has no hard spending cap. Every path the app uses runs the Worker or its static assets, and only requests that reach the Worker are billed, so the guards stop requests before it, at the zone's WAF.

- **Path allowlist and rate limit:** the zone's WAF rules, shared with the observatory's Worker on seiza.io: dashboard settings, their text in the gitignored root `docs/private/zone.md`. Requests outside the app's paths are blocked before the Worker runs, and requests are rate-limited per IP. A new path goes into the rule before it deploys: `worker/scripts/check.ts` requests every file in `web/dist` in production (a blocked one fails) and expects a probe to get the WAF's 403.
- **Pause switch:** production's, above. Whether the new sample needs one is decided when the rebuild ships.
