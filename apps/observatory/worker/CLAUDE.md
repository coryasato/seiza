# The observatory's Worker (`worker/`)

How seiza.io is served. Claude Code loads this file when a file under `worker/` is read. The observatory's rules and the map of its folders are in `apps/observatory/CLAUDE.md`, the repo's in the root `CLAUDE.md`; both apply here. Paths are relative to `apps/observatory/`.

## Hosting

**Hosting:** Worker `observatory` (`worker/`) on the apex **https://seiza.io**, a custom domain (`workers_dev = false`, `preview_urls = false`), deployed by `just observatory deploy`. The script (`worker/src/index.ts`) runs first for every request (`run_worker_first = true`), each a billed request. The builds: `worker/scripts/stage.ts` builds `worker/dist/` (gitignored) at the production paths (`contenders/paths.ts`: the page, both contenders at their bases, one engine copy, the data, the font at `/fonts/`, the admin table's script faces, immutable, and their `OFL.txt` at `/observatory/fonts/`) with a quality-11 `.br` beside each build file, and the Worker serves it with the isolation headers and each path's `Cache-Control` (`worker/src/files.ts`, which stage, check, and Worker share); a route is its `index.html` (`html_handling = "none"`), a path without its slash redirects to it, anything outside `/observatory/` and `/fonts/` is a 404. DuckDB's two wasm bundles are over the 25 MiB asset limit: `.assetsignore` leaves them out and they go out only as `.br` or `.gz`, never through R2. The data: static assets ignore `Range`, so the Worker puts each file whole into the edge cache once per location, keyed by its own SHA-256 (`DATA_FILES`, the deploy's JSON of every file `data/MANIFEST.json` names; any other name is a 404), and answers each request with `cache.match`, which serves 206s. The data goes out `no-cache, no-transform` with no Content-Encoding; don't let anything compress it. No pause switch. Why: `docs/DECISIONS.md`, "Hosting". The zone's WAF rules cover it (their text in the gitignored root `docs/private/zone.md`).

## Files

```
  worker/           # Cloudflare Worker: src/index.ts (the builds precompressed, the data by range through the edge cache), src/files.ts (what's served and how), wrangler.toml, scripts/ (stage.ts, staged.ts: where it stages, check.ts)
```

## Commands

```
just observatory deploy [flags] # builds, stage worker/dist/ (the builds at their paths with a .br each), `wrangler deploy` with DATA_FILES, then worker-check once the edge serves the new HTML (`--wait`; flags pass to it, e.g. --behind-waf); needs `wrangler login`
just observatory worker-check [flags] # production against the staged worker/dist/: every build file and route with its headers and exactly the staged .br on the wire, the HTML without br exactly the build's (nothing injected), the oversize wasm as .gz, a 304, the redirects, a 404; each data file MANIFEST.json names: ranged HEAD and bytes=0-0 → 206, closed ranges byte-exact, no Content-Encoding, SHA-256 (--url, --resolve-via, --behind-waf, --data-only, --wait)
```
