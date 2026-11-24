# Tycho's Worker (`worker/`)

Hosting: the Cloudflare Worker at tycho.seiza.io, R2, the deploy. Claude Code loads this file when a file under `worker/` is read. Tycho's rules and the map of its folders are in `apps/tycho/CLAUDE.md`, the repo's in the root `CLAUDE.md`; both apply here. Paths are relative to `apps/tycho/`.

## Hosting

How it works, with its numbers, is in `docs/hosting.md`.

- **Hosting:** Cloudflare, one Worker (`worker/`) + R2, at **https://tycho.seiza.io**. The Worker runs first for the page, `/assets/*`, and `/duckdb-ext/*`, and serves the quality-11 `<file>.br` that `just tycho deploy` writes beside each one, with the page `no-transform`; DuckDB's two wasm bundles are in R2 under `assets/`, served whole (their `.br` fit in static assets). The sample is a static asset like any other (`/assets/gcat-<hash>.parquet`, no `.br`). The bucket holds nothing else: no dataset goes in R2 (`docs/DECISIONS.md`, "Hosting", 2026-11-21), and `/data/*` is a 404. Why each: `.claude/rules/cloudflare.md`. The WAF guards the hostname before the Worker runs (a path allowlist and a per-IP rate limit, set in the dashboard).
- **Production is the old app until the rebuild ships** (`docs/DECISIONS.md`, "Hosting", 2026-11-23): its Worker still serves the samples from R2 by range, and `just tycho pause` sets that Worker's `DATA_PAUSED`, which this tree's Worker doesn't read. Don't deploy from this tree before then: it would take the samples away.
- **Locally,** `worker/scripts/dev.ts` puts the release build's two bundles into the local R2 (Miniflare's, under `worker/.wrangler/state/`) before it starts `wrangler dev`; nothing else goes there.
- **Neither the R2 profile's keys nor the account ID go in the repo** (`worker/scripts/deploy.ts`'s header says where each comes from).

## Files

```
worker/           # Cloudflare Worker (src/index.ts: the page, assets/, duckdb-ext/ as their .br; the two oversize bundles from R2) + wrangler.toml; scripts/ (wrangler dev launcher that fills the local bucket, the bundle and deployed-asset checks, deploy)
```

## Commands

What each covers and its flags are in its script's header (`worker/scripts/`) and the justfile's comment above its recipe.

```
just tycho worker-check   # the Worker's unit tests, then the bundles from the local bucket under `wrangler dev` (`just tycho build` first); `node worker/scripts/check.ts --url <origin>` checks a deployed build of this tree against its web/dist, so it fails on production until the rebuild ships (production's app is checked from the `tycho-v1` tag's script)
just tycho deploy [flags] # release build, the bundles to R2, the .br copies, `wrangler deploy`, then checks production; needs `wrangler login` and TYCHO_R2_PROFILE (in the gitignored worker/.env.deploy). Refuses without `--rebuild-ships` (`--dry-run` aside): not before the rebuild ships
just tycho pause / resume # production's samples off (every /data/* a 503, the app says to drop a file) / back on, on the Worker as deployed; needs `wrangler login`
```
