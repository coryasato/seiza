# Tycho's Worker (`worker/`)

Hosting: the Cloudflare Worker at tycho.seiza.io, R2, the deploy. Claude Code loads this file when a file under `worker/` is read. Tycho's rules and the map of its folders are in `apps/tycho/CLAUDE.md`, the repo's in the root `CLAUDE.md`; both apply here. Paths are relative to `apps/tycho/`.

## Hosting

How it works, with its numbers, is in `docs/hosting.md`.

- **Hosting:** Cloudflare, one Worker (`worker/`) + R2, at **https://tycho.seiza.io**. The Worker runs first for the page, `/assets/*`, and `/duckdb-ext/*`, and serves the quality-11 `<file>.br` that `just tycho deploy` writes beside each one, with the page `no-transform`; DuckDB's two wasm bundles are in R2 under `assets/` (their `.br` fit in static assets). Why each: `.claude/rules/cloudflare.md`. `/data/*` comes from R2 by range. The WAF guards it before the Worker runs (a path allowlist and a per-IP rate limit, set in the dashboard), and `just tycho pause` turns the samples off.
- **The pause answer** (a `/data/*` 503 with `X-Tycho-Paused: 1`) is what `web/src/main.ts`'s `refusal` reads: change both together.
- **Neither the R2 profile's keys nor the account ID go in the repo** (`worker/scripts/deploy.ts`'s header says where each comes from).

## Files

```
worker/           # Cloudflare Worker (src/index.ts: /data/* from R2 with byte ranges; the page, assets/, duckdb-ext/ as their .br) + wrangler.toml; scripts/ (wrangler dev launcher, range and deployed-asset checks, deploy)
```

## Commands

What each covers and its flags are in its script's header (`worker/scripts/`) and the justfile's comment above its recipe.

```
just tycho worker-check   # /data/* byte ranges: the Worker's unit tests, then `wrangler dev`; `node worker/scripts/check.ts --url https://tycho.seiza.io` checks production
just tycho deploy [flags] # release build, R2 uploads, the .br copies, `wrangler deploy`, then checks production; needs `wrangler login` and TYCHO_R2_PROFILE
just tycho pause / resume # production's samples off (every /data/* a 503, the app says to drop a file) / back on; needs `wrangler login`
```
