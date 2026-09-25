# Tycho

> *Tycho Brahe catalogued a thousand stars in a lifetime. Tycho scrolls 25 million before your coffee cools.*

**Tycho** is a local-first data workbench in the browser. Drop a CSV or Parquet file, or click a sample, and scroll through every row instantly. The data is queried locally with DuckDB-Wasm and drawn by GPUI (via GPUI Kit) on a canvas with WebGPU, or WebGL2 where WebGPU isn't available. Nothing is uploaded.

The project's goal is to show that **WebAssembly + GPU-rendered UI builds heavy web apps better than the DOM**. Every claim needs a number on screen to back it up.

---

This is Tycho's context. Milestones, datasets, hosting details, decisions, and measurements live in `PLAN.md`. The repo-wide rules in the root `CLAUDE.md` (TTFP first, paint before heavy loads, measurement protocol, canvas tradeoffs, GPUI Kit gotchas, `shared/` conventions) apply here too. Paths below are relative to `apps/tycho/` unless they start with `shared/` or `shared-web/`.

---

## Tycho rules

These add to the repo-wide rules.

1. **Never block the shell on DuckDB.** Paint first. Start loading the engine from `shared/`'s post-paint callback. The UI must stay usable (and say "engine loading…") until DuckDB is ready.
2. **Keep the bridge narrow.** Only three calls cross the Rust ↔ JS boundary:
   - `register_file(name, source) -> FileInfo`, where `source` is a dropped `File` or an HTTP URL
   - `query(sql, request_id) -> ArrowIpcBytes`
   - `cancel(request_id)`

   Get schema, row count, and metadata with SQL through `query`. Don't add a fourth bridge call without writing down the decision in this file and in `PLAN.md`'s decisions log. The engine loads on the first call; the post-paint callback's warm-up query (`SELECT 42 AS x`) is what starts it.
3. **Query per viewport.** The table fetches only the visible rows plus a buffer. The app never loads the whole result into memory.
4. **v1 scope is fixed.** No SQL editor, charts, sort/filter, or GROUP BY. If one of these seems necessary, stop and ask.

## Stack

- **UI:** `shared/` (crate `seiza`) on the workspace's pinned `gpui-kit`.
- **Engine:** `@duckdb/duckdb-wasm`, pinned. Runs in a Web Worker. **Self-host** the DuckDB bundles and extensions from our own origin, not jsDelivr, so they work under COEP and first-load timing doesn't depend on a third-party CDN. (Check the bundle sizes against Cloudflare's 25 MiB static-asset limit; see Hosting.) Extensions are pinned by version and SHA-256 in `web/duckdb-extensions.json`; bump them with DuckDB-Wasm. Autoload is off: Rust loads Parquet with one explicit `LOAD` at a time (`Engine::load_parquet`), which every Parquet query waits for; new extensions need the same. HTTP files are read by range only (`engine.ts`, `RANGE_READS_ONLY`): with DuckDB-Wasm's defaults, a URL is downloaded whole.
- **Hosting:** Cloudflare, one Worker (`worker/`) + R2 for data. Details in `PLAN.md`.
- **JS host:** `web/` (Vite, built on `shared-web/`) holds `index.html`, `bridge.ts` (the three calls; loads nothing until the first), and `engine.ts` (DuckDB-Wasm: bundle choice, worker, queries, cancel). New logic goes in Rust unless it must touch DuckDB's JS API.
- **Arrow:** results cross the bridge as Arrow IPC stream bytes and are read by `crate/src/arrow.rs`, a hand-rolled reader (arrow-rs cost +127 KiB brotli; see `PLAN.md`). New column types go there, with a test.

## Layout

```
apps/tycho/
  crate/            # Rust (cdylib, package `tycho`): workbench, row table (table/: scroll model, page cache, view), engine client (engine/), file summary + page SQL (dataset.rs), Arrow reader (arrow.rs), Playwright targets (targets.rs), self-test
  web/              # Vite host: index.html, src/{main,bridge,engine}.ts, vite.config.ts (proxies /data/*), duckdb-extensions.json + scripts/extensions.ts
  worker/           # Cloudflare Worker (src/index.ts: /data/* from R2 with byte ranges) + wrangler.toml; scripts/ (wrangler dev launcher, range checks)
  data/             # fetch_asteroids.ts, prep.sql + prep.ts (native DuckDB), fixtures-src/, MANIFEST.json (committed); raw/ + generated data gitignored
  perf/             # Playwright scripts (common.ts: the protocol's shared pieces; harness.ts: page, overlay, and /data helpers), baseline.json, budget-notes.md, results/
  docs/LESSONS.md   # lessons-learned log, one entry per milestone
  CLAUDE.md         # this file: context and rules
  PLAN.md           # milestones, datasets, hosting, decisions, measurements
  justfile          # loaded from the root as the `tycho` module
```

## Commands (set up in M0; keep this list current)

```
just setup              # npm install for every app host (run once)
just tycho dev          # build wasm (debug) + Vite dev server with COOP/COEP (http://localhost:5173), with `wrangler dev` behind /data/*
just tycho build        # release wasm (+ wasm-opt), Vite build, report asset sizes
just tycho preview      # serve the release build (web/dist) with the same headers, with `wrangler dev` behind /data/*
just tycho data [--refresh] # fetch the asteroid catalog once (data/raw/), prep.sql → asteroids.parquet + CSV fixture + MANIFEST.json, load it into local R2
just tycho extensions   # download the pinned DuckDB extensions (web/duckdb-extensions.json) into web/public/duckdb-ext/; dev and build run it
just tycho data-deps    # install data/'s native DuckDB (its own lockfile; not an npm workspace, so `just setup` skips it)
just tycho worker-check # /data/* byte-range checks: Worker unit tests (strict fake R2), then against `wrangler dev` (HEAD, 206, 416, 404, headers, SHA-256)
just tycho sample [flags] # M3 checks on the release build: click → schema time, bytes transferred, early click (Chromium/Firefox/WebKit), failure modes and retry
just tycho table [flags] # M4 table checks on the release build: first rows, jump to 90%, last row, fling frame times (--sweep: page size × prefetch; --memory: two full passes)
just tycho paging [flags] # M4 paging experiment: LIMIT/OFFSET vs file_row_number vs ingest, by row-group size (bench/ files in local R2)
just tycho smoke [url]  # Playwright Chromium/Firefox/WebKit: paints, crossOriginIsolated, no console errors, resize
just tycho check        # lint + release build + perf budgets (reference TTFP ≤ baseline +10%, wasm brotli ≤ +15% unless noted in perf/budget-notes.md)
just tycho perf [flags] # cold-load suite, reference + throttled, median of 10 → perf/results/<date>-<label>.json (--label, --runs, --write-baseline, --trace); also checks no engine request starts before first paint
just tycho engine [flags] # engine self-test from Rust (`?selftest`: SELECT 42, every shown type, cancel) in Chromium ×10 + Firefox + WebKit, plus blocked-engine negative controls (--label, --runs)
just tycho lint         # cargo fmt --check, clippy on wasm32 with -D warnings, tsc
just tycho wasm [debug|release]   # cargo build + wasm-bindgen into web/pkg/ (+ wasm-opt for release)
```

Planned, not built yet:

```
just tycho data gaia    # Gaia slice (M7)
just tycho deploy       # build, upload changed data to R2, wrangler deploy (M8)
```

`just tycho data` needs network once (the JPL API, ~2.5 min); after that it reuses `data/raw/`. `dev`, `preview`, `sample`, and `worker-check` need the local R2 it fills. `wrangler dev` keeps it under `worker/.wrangler/state/` (gitignored). Vite's dev and preview servers proxy `/data/*` to `wrangler dev` on port 8787, so the page stays same-origin under COEP.

`?bench` in the URL exposes the bridge as `globalThis.__tychoBridge` for the perf scripts; `?page=`, `?prefetch=`, and `?budget_mib=` override the table's paging (`crate/src/table/mod.rs`, `Paging`). With `?perf` or `?bench`, the table publishes what it shows to `globalThis.__tychoTable` and marks `tycho:viewport-filled` after each frame that fills the viewport; `tycho:first-rows` (the overlay's "first rows") is always marked.

`?selftest` in the URL runs the engine self-test once DuckDB is ready; results show in the overlay and in `globalThis.__tychoSelftest`. The perf overlay is on with `?perf` in the URL, or toggle it with Cmd/Ctrl+Shift+P. (Firefox on macOS keeps Cmd+Shift+P for a private window; use Ctrl+Shift+P or `?perf` there.) `just tycho perf` and `check` serve `web/dist` through `vite preview`, brotli-compressed like production. `check` builds first; before `perf`, run `just tycho build` yourself.

`web/pkg/` is generated by `just tycho wasm` (gitignored). After changing Rust, rerun `just tycho dev` (or `just tycho wasm` while Vite keeps running) and reload the page.
