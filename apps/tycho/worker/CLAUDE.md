# Tycho's Worker (`worker/`)

Hosting: the Cloudflare Worker at tycho.seiza.io, R2, the deploy. Claude Code loads this file when a file under `worker/` is read. Tycho's rules and the map of its folders are in `apps/tycho/CLAUDE.md`, the repo's in the root `CLAUDE.md`; both apply here. Paths are relative to `apps/tycho/`.

## Hosting

- **Hosting:** Cloudflare, one Worker (`worker/`) + R2, at **https://tycho.seiza.io** (never the account's default Workers subdomain, which names its owner: `workers_dev = false`). The Worker runs first for the page, `/assets/*`, and `/duckdb-ext/*`, and serves the quality-11 `<file>.br` that `just tycho deploy` writes beside each one (Cloudflare's own compression sent the app wasm as 3.7 MiB of zstd against 2.8 MiB; ~1 s on Fast 4G), with the page `no-transform` (Cloudflare's Web Analytics injects a beacon script otherwise). DuckDB's two wasm bundles are over the 25 MiB static-asset limit: R2 holds them under `assets/` (their `.br` fit in static assets). `/data/*` comes from R2 by range. The WAF guards it before the Worker runs (a path allowlist and a per-IP rate limit, set in the dashboard), and `just tycho pause` turns the samples off. Details in `docs/hosting.md`.

- **The pause answer** (a `/data/*` 503 with `X-Tycho-Paused: 1`) is what `web/src/main.ts`'s `refusal` reads: change both together.

## Files

```
worker/           # Cloudflare Worker (src/index.ts: /data/* from R2 with byte ranges; the page, assets/, duckdb-ext/ as their .br) + wrangler.toml; scripts/ (wrangler dev launcher, range and deployed-asset checks, deploy)
```

## Commands

```
just tycho worker-check # /data/* byte-range checks: Worker unit tests (strict fake R2, fake static assets), then against `wrangler dev` (HEAD, 206, 416, 404, headers, SHA-256); `node worker/scripts/check.ts --url https://tycho.seiza.io` also checks the deployed build (every file's bytes, headers, br on the wire, no injected script)
just tycho deploy [flags] # release build, then upload changed samples and the oversize DuckDB wasm to R2 (S3 API, by SHA-256), write the .br copies, `wrangler deploy`, and check production (retries for a minute while the version propagates); needs `wrangler login` and TYCHO_R2_PROFILE (--dry-run, --skip-check)
just tycho pause / resume # production: every /data/* request answers 503 and the app says to drop a file (Worker secret DATA_PAUSED, seconds, survives deploys) / back on; needs `wrangler login`
```

`just tycho deploy` needs `wrangler login` (one account: the account ID comes from it, or CLOUDFLARE_ACCOUNT_ID) and `TYCHO_R2_PROFILE`, an AWS CLI profile holding an R2 API token's S3 keys; neither the profile's keys nor the account ID go in the repo.
