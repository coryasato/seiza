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
4. **v1 scope is fixed.** No SQL editor, charts, sort/filter, or GROUP BY. If one of these seems necessary, stop and ask. (Column resizing, selection, and sorting are a researched-first goal after M8; see `PLAN.md`, "Long-term goals".)

## Stack

- **UI:** `shared/` (crate `seiza`) on the workspace's pinned `gpui-kit`.
- **Engine:** `@duckdb/duckdb-wasm`, pinned. Runs in a Web Worker. **Self-host** the DuckDB bundles and extensions from our own origin, not jsDelivr, so they work under COEP and first-load timing doesn't depend on a third-party CDN. (Check the bundle sizes against Cloudflare's 25 MiB static-asset limit; see Hosting.) Extensions are pinned by version and SHA-256 in `web/duckdb-extensions.json`; bump them with DuckDB-Wasm. Autoload is off: Rust loads Parquet with one explicit `LOAD` at a time (`Engine::load_parquet`), which every Parquet query waits for; new extensions need the same. HTTP files are read by range only (`engine.ts`, `RANGE_READS_ONLY`): with DuckDB-Wasm's defaults, a URL is downloaded whole.
- **Hosting:** Cloudflare, one Worker (`worker/`) + R2 for data. Details in `PLAN.md`.
- **JS host:** `web/` (Vite, built on `shared-web/`) holds `index.html`, `bridge.ts` (the three calls; loads nothing until the first), and `engine.ts` (DuckDB-Wasm: bundle choice, worker, queries, cancel). New logic goes in Rust unless it must touch DuckDB's JS API.
- **Table:** `crate/src/table/`, not gpui-kit's `DataTable`, whose `uniform_list` places rows in f32 pixels and loses precision past ~16 M px (4 px steps at the asteroids' 47 M px, 64 px at Gaia's 25 M rows). The scroll position is an f64 row index (`scroll.rs`); `pages.rs` is the page cache (tested natively); `mod.rs` draws only the visible rows and columns and owns the scrollbars, wheel, and keys. Pages are 1024 rows, read with a `file_row_number` filter (`dataset::page_sql`) from files written with 30,720-row groups; prefetch 2 pages, 3 queries in flight, 64 MiB cache. Don't swap in `DataTable` without re-reading M4 in `PLAN.md`.
- **Arrow:** results cross the bridge as Arrow IPC stream bytes and are read by `crate/src/arrow.rs`, a hand-rolled reader (arrow-rs cost +127 KiB brotli; see `PLAN.md`). New column types go there, with a test.

## DuckDB-Wasm 1.32.0 gotchas (check before debugging)

- **A started page read can't be cancelled.** DuckDB's worker reads over HTTP with synchronous XHRs, and `cancel` lands between query slices. A cancelled query still occupies the worker until it answers. So the page cache counts cancelled requests as in flight until they answer (`PageCache::draining`), and a scrollbar drag loads only when the pointer rests (`DRAG_SETTLE`).
- **Every page read costs at least ~1.39 MB.** The HTTP readahead (`WebFileSystem`'s `ReadAheadBuffer`) reads 16 KB, 64 KB, 256 KB, then 1 MB. No `db.open` option or Parquet setting changes it (`useDirectIO` and `disable_parquet_prefetching` were tested). On Fast 4G that's four round trips, ~2.1 s per page. It's also why "first rows under 2% of the file" can't hold for the 38 MB sample.
- **Two failing loads of one extension at once crash the worker** ("table index is out of bounds"), with no worker `error` event, and every later query hangs. That's why autoload is off and `Engine::load_parquet` runs one attempt at a time.
- **With default settings, a URL is downloaded whole** (`RANGE_READS_ONLY` in `engine.ts`; M3). The Worker must answer a ranged `HEAD` with 206.
- **Playwright doesn't see DuckDB's requests** (sync XHRs inside its worker). Count `/data/` bytes at the server: `perf/harness.ts`'s counting proxy.

## Perf script gotchas

- **Headless DPR 2 halves wheel deltas:** `mouse.wheel(0, 1000)` arrives as `deltaY` 500. Scroll through `harness.ts`'s `wheel()`, which corrects for it.
- **WebKit can deliver a scripted press before hover updates,** and GPUI fires a press only on a hovered element. Wait two frames after moving to a control (`hoverSettles` in `table.ts`).
- **Canvas controls have no DOM.** The app publishes their bounds to `globalThis.__tychoTargets` (`crate/src/targets.rs`), and scripts click through `harness.ts`'s `clickTarget` and `targetRect`.
- **Check the machine before calling a slowdown a regression.** `just tycho paging` (raw queries through the bridge, no table code) is a quick control: if it's slower by the same proportion, it's load.

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
just tycho table [flags] # M4 table checks on the release build: first rows, jump to 90%, last row vs count(*), fling and steady-scroll frame times, reference + throttled (--runs, --reference-only, --label; --memory [--passes N]: full passes with a 128 MiB cap; --browsers: Chromium/Firefox/WebKit table check; --sweep: page size × prefetch; --memory-only, --browsers-only)
just tycho paging [flags] # M4 paging experiment: LIMIT/OFFSET vs file_row_number vs ingest, by row-group size (--files, --strategies, --setup; needs bench/ files in local R2, built as in perf/results/2026-09-25-m4.md)
just tycho smoke [url]  # Playwright Chromium/Firefox/WebKit: paints, crossOriginIsolated, no console errors, resize
just tycho check        # lint + release build + perf budgets (reference TTFP ≤ baseline +10%, wasm brotli ≤ +15% unless noted in perf/budget-notes.md)
just tycho perf [flags] # cold-load suite, reference + throttled, median of 10 → perf/results/<date>-<label>.json (--label, --runs, --write-baseline, --trace); also checks no engine request starts before first paint
just tycho engine [flags] # engine self-test from Rust (`?selftest`: SELECT 42, every shown type, cancel) in Chromium ×10 + Firefox + WebKit, plus blocked-engine negative controls (--label, --runs)
just tycho lint         # cargo fmt --check, clippy on wasm32 and native with -D warnings, tsc
just tycho wasm [debug|release]   # cargo build + wasm-bindgen into web/pkg/ (+ wasm-opt for release)
```

Planned, not built yet:

```
just tycho data gaia    # Gaia slice (M7)
just tycho deploy       # build, upload changed data to R2, wrangler deploy (M8)
```

`just tycho data` needs network once (the JPL API, ~2.5 min); after that it reuses `data/raw/`. `dev`, `preview`, `sample`, `table`, and `worker-check` need the local R2 it fills. `wrangler dev` keeps it under `worker/.wrangler/state/` (gitignored). Vite's dev and preview servers proxy `/data/*` to `wrangler dev` on port 8787, so the page stays same-origin under COEP.

`?bench` in the URL exposes the bridge as `globalThis.__tychoBridge` for the perf scripts; `?page=`, `?prefetch=`, and `?budget_mib=` override the table's paging (`crate/src/table/mod.rs`, `Paging`). With `?perf` or `?bench`, the table publishes what it shows to `globalThis.__tychoTable` and marks `tycho:viewport-filled` after each frame that fills the viewport; `tycho:first-rows` (the overlay's "first rows") is always marked.

`?selftest` in the URL runs the engine self-test once DuckDB is ready; results show in the overlay and in `globalThis.__tychoSelftest`. The perf overlay is on with `?perf` in the URL, or toggle it with Cmd/Ctrl+Shift+P. (Firefox on macOS keeps Cmd+Shift+P for a private window; use Ctrl+Shift+P or `?perf` there.) `just tycho perf` and `check` serve `web/dist` through `vite preview`, brotli-compressed like production. `check` builds first; before `perf`, run `just tycho build` yourself.

`web/pkg/` is generated by `just tycho wasm` (gitignored). After changing Rust, rerun `just tycho dev` (or `just tycho wasm` while Vite keeps running) and reload the page.
