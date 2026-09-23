# PLAN.md — Tycho

Tycho's build plan: milestones (with done-when checks), sample datasets, hosting, decisions, and measurements. Context and rules live in `CLAUDE.md` here and at the repo root. Tick checks as they pass and log decisions as they land.

**Goal:** a local-first data workbench in the browser (DuckDB-Wasm + GPUI Kit on WebGL2) that proves WebAssembly + GPU-rendered UI beats the DOM for heavy apps, with a number on screen for every claim.

**Deciding metric:** time to first paint (TTFP), measured as `performance.mark("gpui:first-frame")`.

---

## Status

| Milestone | Title | Status |
|---|---|---|
| M0 | Empty GPUI Kit shell on the web | Done 2026-09-23 |
| M1 | First-paint baseline and perf overlay skeleton | Not started |
| M2 | DuckDB in a worker, prefetched after first paint | Not started |
| M3 | Asteroid sample over HTTP | Not started |
| M4 | Virtualized table over paged queries | Not started |
| M5 | Drop a Parquet file | Not started |
| M6 | Drop a CSV with progressive loading | Not started |
| M7 | Complete the perf overlay and harden | Not started |
| M8 | Deploy to Cloudflare | Not started |

Complete them in order. Each one closes with: measurements committed to `perf/results/`, and an entry in `docs/LESSONS.md`.

---

## Milestones

Complete the milestones in order. A milestone is done only when every "done when" check passes. Commit the measurements and write a `docs/LESSONS.md` entry before moving on.

### M0: Empty GPUI Kit shell on the web

Set up the Cargo workspace (root `Cargo.toml`, `shared/`, `crate/`), `shared-web/`, the Vite host in `web/`, the root justfile with the `tycho` module, the root `.gitignore`, and COOP/COEP headers in the dev server. The shell has a title bar ("Tycho"), an empty main panel with a centered placeholder ("Drop a CSV or Parquet file"), and a disabled "Try sample: every known asteroid" button. Load fonts before init (see the root gotchas; this belongs in `shared/`'s bootstrap).

The root `.gitignore` covers: `target/`, `node_modules/`, `.wrangler/`, `apps/*/data/raw/`, `apps/*/data/*.parquet`, `apps/*/data/fixtures/*.csv`, `apps/*/perf/results/raw/`. Everything else under `perf/results/` is committed, and so is `data/MANIFEST.json`.

**Done when:**
- [x] `just tycho dev` serves the page, and the shell paints in Chromium, Firefox, and Safari with no console errors or panics. *`just tycho smoke` passes in Playwright Chromium, Firefox, and WebKit (debug and release). Manual check in real Firefox and Safari done.*
- [x] `self.crossOriginIsolated === true` in the page console. *True in all three engines, dev and preview.*
- [x] Resizing the window reflows the shell with no blank frames. *Smoke resizes through five sizes and checks each settled frame is painted edge to edge, with a canvas that followed the resize (CSS box and backing store). A negative control with a canvas that can't shrink fails.*
- [x] `just tycho build` prints the release asset sizes: app wasm raw, gzip, and brotli; JS; fonts. *wasm 9522.8 / 3740.2 / 2615.6 KiB. See `perf/results/2026-09-23-m0.md`.*

`just tycho check` doesn't enforce the TTFP or wasm-size budgets in M0; there's no baseline yet. That lands in M1 (below), together with `perf/baseline.json`.

### M1: First-paint baseline and perf overlay skeleton

Tune the release profile: `opt-level="z"` vs `"s"` (measure both), `lto = true`, `codegen-units = 1`, `panic = "abort"`, `strip = true`, then `wasm-opt -Oz`. Use `WebAssembly.instantiateStreaming`. Preload the wasm and the one UI font. Add the perf overlay (toggle with Cmd/Ctrl+Shift+P, and `?perf` in the URL) showing TTFP. Write `just tycho perf` for cold load.

**Done when:**
- [ ] The overlay shows TTFP, and the value matches Playwright's measured mark within 5 ms.
- [ ] `perf/baseline.json` records the median TTFP (reference and throttled) and the wasm brotli size for the empty shell. **This is the baseline that every later milestone is compared against.**
- [ ] `just tycho check` fails if the reference TTFP regresses more than 10% from the baseline, or if the app's wasm brotli size grows more than 15% with no note in `perf/budget-notes.md`.
- [ ] A `docs/LESSONS.md` entry records the numbers and which profile settings mattered.

### M2: DuckDB in a worker, prefetched after first paint

Build `duckdb.worker.ts` and `bridge.ts` with the three calls. On the Rust side, wrap them with wasm-bindgen: JS Promises → `wasm_bindgen_futures::JsFuture`, driven on GPUI's web executor. Start the engine load from `shared/`'s post-paint callback, never before. Use the self-hosted DuckDB bundle; pick the EH or MVP bundle by feature detection. Arrow results cross the boundary as IPC bytes (`Uint8Array`).

**Done when:**
- [ ] Reference TTFP is within noise (≤ 5%) of the M1 baseline with DuckDB loading enabled.
- [ ] The network waterfall in the Playwright trace shows the first DuckDB request starting **after** the `gpui:first-frame` mark.
- [ ] The overlay shows "engine ready" time (ms from timeOrigin).
- [ ] `query("SELECT 42 AS x")` from Rust returns a decoded Arrow batch with `x = 42`.
- [ ] `cancel()` on a long query (`SELECT count(*) FROM range(1e10)`) stops it within 200 ms, and the next query still succeeds.
- [ ] **Decision recorded:** how Arrow IPC gets decoded in Rust (`arrow-ipc` + `arrow-array` with minimal features, or a hand-rolled reader for the types we show). Choose by measured wasm size delta. The decoder is in the app binary, so it counts against the repo-wide TTFP rule.

### M3: Asteroid sample over HTTP

Build `data/fetch_asteroids.py` + `data/prep.sql` (see Sample datasets below) to produce the Parquet files. Serve them from our origin with `Accept-Ranges: bytes`: through `wrangler dev` if possible, otherwise a dev server with equivalent range handling. Turn on the "Try sample: every known asteroid" button: `register_file(url)`, then read the schema and row count from Parquet metadata with SQL (`DESCRIBE`, `parquet_metadata`, `parquet_file_metadata`). Show column names, types, row count, file size, row-group count, and the data credit in a header strip.

**Done when:**
- [ ] Clicking the sample (with the engine warm) shows schema and row count within **300 ms** on the reference run.
- [ ] Before the first rows appear, the page has transferred **less than 2% of the file** (footer + first row group). Check this from the Playwright network log.
- [ ] If the button is clicked before the engine is ready, the UI shows a loading state and completes once the engine is ready. It never crashes or hangs.

### M4: Virtualized table over paged queries (the wow moment)

Build the table with GPUI Kit's virtualized table, backed by a **page cache**: fixed-size pages keyed by page index, filled with `query` calls, and an in-flight map that `cancel`s stale requests when the viewport moves on. Prefetch N pages on each side of the viewport, and more in the direction of scrolling. When a page isn't loaded yet, draw placeholder rows (skeleton cells, same row height). Never stall a frame waiting on data. Evict pages with an LRU memory cap.

**Paging strategy (measure, then decide):**
- **A)** `SELECT * FROM t LIMIT p OFFSET o` on the raw Parquet.
- **B)** Row-group-aligned: map page → row group using `parquet_metadata`, then filter on `file_row_number` (via `read_parquet(..., file_row_number=true)`) so DuckDB reads only one row group over HTTP.
- **C)** Ingest into a DuckDB table first, then query by rowid.

Record, for each option, the latency of a random jump to row ~90% and the bytes transferred. Choose B unless the measurements say otherwise.

**Done when:**
- [ ] **File → first rows** (click → first real cell painted) is **≤ 500 ms** with the engine warm, and shown in the overlay.
- [ ] The overlay shows **scroll FPS** (frame-time p50/p95 over the last 2 s).
- [ ] A scripted fling (Playwright wheel events, top → bottom in ~3 s) keeps **p95 frame time ≤ 20 ms** with **no frame > 50 ms**. Placeholders may appear during the fling.
- [ ] Dragging the scrollbar to ~90% shows real rows in **≤ 400 ms** (reference) and never shows a blank table.
- [ ] Scrolling to the last row shows the last row. The row count matches `SELECT count(*)`.
- [ ] JS heap + wasm memory stay under the cap you set (write it down) after scrolling the whole sample twice.
- [ ] **Decision recorded:** page size and prefetch depth, chosen from a small sweep (e.g. 256/1024/4096 rows × 1/2/4 pages).

### M5: Drop a Parquet file

Handle file drop and a file picker (the fallback) on the canvas. Register the file with DuckDB using the `File` handle, so it's read lazily and never copied whole into memory. Reuse the M3/M4 pipeline unchanged.

**Done when:**
- [ ] Dropping a ~1 GB Parquet shows schema and first rows within **1 s** of the drop, with the engine warm.
- [ ] Peak memory stays roughly the same whether the file is 100 MB or 1 GB, which shows the file isn't being copied.
- [ ] Dropping an unsupported file shows a clear inline message. Dropping while a load is running cancels the old load cleanly.

### M6: Drop a CSV with progressive loading

Show first rows fast: sniff with `read_csv(..., sample_size=...)` and show `LIMIT` rows right away. Then ingest in the background in **chunks** so the row count can grow: JS slices the `File` by byte range at newline boundaries, then for each chunk runs `INSERT INTO t SELECT * FROM read_csv(chunk, columns=<sniffed schema>, header=<first chunk only>)`. After each chunk, the row count and scrollbar extent update. The table scrolls over the rows already ingested.

**Done when:**
- [ ] A ~1 GB CSV shows its first rows within **1 s** of the drop.
- [ ] The row count in the header updates **at least every 500 ms** during ingest, and the scrollbar grows with it.
- [ ] Scrolling during ingest stays within the M4 frame budget.
- [ ] The final row count matches the file's data-line count, using `data/fixtures/asteroids.csv` (which includes quoted commas and newlines).
- [ ] Ingest throughput (MB/s) and total time are shown in load stats and recorded.
- [ ] **Decision recorded:** chunked ingest vs. raw-file queries, backed by the numbers.

### M7: Complete the perf overlay and harden

Finish the overlay: TTFP, engine ready, file → first rows, scroll FPS (p50/p95 plus a small frame-time sparkline), rows loaded, bytes fetched, and wasm memory. Add error states: engine failed to load, network failure on the sample, and file too large. Add the second sample button, "Big: 25M Gaia stars" (with the ESA credit). Measure the practical file-size ceiling (wasm32 has about 4 GB of memory) for Parquet and CSV, and fail gracefully above it.

**Done when:**
- [ ] All overlay metrics show live values and match `just tycho perf` within 5%.
- [ ] The ceiling is measured, documented in the README, and enforced with a friendly message before the tab can run out of memory.
- [ ] The Gaia sample meets the M4 scroll and jump budgets. If it can't, lower the row target in `prep.sql` and record why.
- [ ] `just tycho perf` runs the full suite (cold load, both samples, fling, jump, CSV) and writes one results file.
- [ ] The README has a "Canvas tradeoffs" section giving the current status of a11y, IME, selection, Ctrl+F, and bundle size, each with what we do today.

### M8: Deploy to Cloudflare

Deploy to Cloudflare as one Worker on one origin (see Hosting below). The app shell is served as Worker static assets, and `/data/*` (plus any file over 25 MiB) is streamed from R2 through the same Worker.

**Done when:**
- [ ] The public URL passes `just tycho perf` against production, with TTFP within 15% of the local release build.
- [ ] `crossOriginIsolated === true` in production.
- [ ] Range requests to `/data/*` return `206` with a correct `Content-Range`. `HEAD` returns `Content-Length` and `Accept-Ranges: bytes`. Both samples load and scroll in production.
- [ ] The wasm is served compressed (`Content-Encoding: br`, or `zstd` if that's what Cloudflare negotiates on our plan; record which).
- [ ] The perf-overlay numbers from the public URL are recorded in the README as the headline results.

---

## Sample datasets

**Decided 2026-09-22.** Both datasets are space-themed: asteroids are the default, and Gaia stars are the big one. Both are re-hosted on our origin.

### Default: every known asteroid (NASA/JPL Small-Body Database)

- **Rows:** about 1.5 million: every asteroid with a known orbit. Confirm the count with `just tycho data`, since Rubin discoveries grow it every day.
- **Source:** the JPL SBDB Query API (`ssd-api.jpl.nasa.gov/sbdb_query.api`), which returns JSON (`fields` + `data` arrays). `data/fetch_asteroids.py` pulls the full catalog in pages (`limit` / `limit-from`) and writes raw JSON. `prep.sql` then turns that into Parquet. Record the fetch date. The catalog can change between pages, so dedupe on `spkid`.
- **Columns:** `full_name`, `pdes`, `name`, `neo`, `pha`, `class`, `H`, `diameter`, `albedo`, `a`, `e`, `i`, `q`, `per_y`, `first_obs`, `last_obs`, `n_obs_used`, plus `spkid` as the key. Many physical fields are null, which is realistic and a good test of how the table renders nulls.
- **Sort:** by `spkid`, so row 1 is **(1) Ceres**, then Pallas, Juno, Vesta… Scrolling top to bottom goes from the oldest discoveries to last week's.
- **Credit in the UI:** "Asteroid data: NASA/JPL Small-Body Database, fetched <date>."

### Big: Gaia DR3 stars (ESA)

- **Rows:** a slice of Gaia DR3's ~1.8 billion sources. Target **~25 million rows**, then tune after M7 measures the ceiling. Pick the cut by brightness (`phot_g_mean_mag < X`) and choose X in `prep.sql` to hit the target.
- **Source:** Gaia DR3 as HATS-partitioned Parquet on AWS Open Data (`s3://stpubdata/gaia/`, us-east-1, no AWS account needed). Read it with the DuckDB CLI (`httpfs`, anonymous S3) and push the filter down.
- **Columns:** `source_id`, `ra`, `dec`, `parallax`, `distance_pc` (1000/parallax where parallax > 0; label it approximate), `pmra`, `pmdec`, `phot_g_mean_mag`, `bp_rp`, `radial_velocity`, `teff_gspphot`.
- **Sort:** by `source_id`. That ID encodes a HEALPix sky position, so scrolling sweeps across the sky, and neighboring rows compress well.
- **Role:** this is the scale test. It gives the M4 paging and the M7 ceiling real work, and it sets up v1.1 charts (a GPU star map).
- **Credit in the UI (required):** "This work has made use of data from the European Space Agency (ESA) mission Gaia, processed by the Gaia Data Processing and Analysis Consortium (DPAC)."

### `just tycho data` produces

- `data/raw/`: raw API/S3 fetches (asteroid JSON pages, Gaia extracts). Gitignored.
- `asteroids.parquet`: default button. ZSTD compression, fixed `ROW_GROUP_SIZE` (start at 122,880; revisit in M4).
- `gaia-dr3-bright.parquet`: "big" button. Same writer settings.
- `data/fixtures/asteroids.csv`: the asteroid table as CSV, with the rows from `data/fixtures-src/tricky_rows.csv` appended by prep. `tricky_rows.csv` is hand-written and committed, and holds rows with quoted commas and newlines in the name field. The generated `asteroids.csv` is gitignored. This is the M6 fixture. It also gives the "drop a CSV" demo a matching file people can download and try.
- `data/MANIFEST.json`: for each file, the row count, byte size, SHA-256, source, fetch date, and the Gaia magnitude cut used. **Committed**, so every benchmark names the exact files it ran against.
- All other generated files are gitignored. Upload them to R2 with the S3-compatible API (rclone or `aws s3 cp` with the R2 endpoint), because Gaia is too big for `wrangler r2 object put`.

### Why re-host instead of linking the sources

- Under `COEP: require-corp`, every cross-origin fetch needs CORS or CORP headers that we don't control. Serving from the same origin avoids the problem.
- Rewriting the files lets us **control row-group size and sort order**, and the M4 paging strategy depends on both.
- Pinned files make every benchmark reproducible.

---

## Hosting: Cloudflare

**Decided 2026-09-22.** One Worker (`worker/`) handles one origin.

- **Worker static assets** serve `index.html`, JS, fonts, and the app wasm. Set COOP/COEP in `_headers`. The limit is **25 MiB per file**, so check the release wasm size and each DuckDB bundle against it in `just tycho build`. Any file over the limit moves to R2 and is served like the data.
- **R2** holds the datasets (and oversize engine files) and is read through a Worker binding at `/data/*`. R2 has **no egress fees**, which matters when every visitor may pull hundreds of MB of Gaia rows. That's the main reason to choose it over Google Cloud Storage/Firebase.
- **The Worker's range handling is ours to get right:**
  - Call `env.DATA.get(key, { range: request.headers })`.
  - Set `Content-Range` ourselves from `object.range` + `object.size`, since R2's example code doesn't.
  - Return `206`.
  - Answer `HEAD` with `Content-Length` and `Accept-Ranges: bytes` (DuckDB-Wasm sends a HEAD first).
  - Add COOP/COEP (or `Cross-Origin-Resource-Policy: same-origin`) to these responses too.
  - Set `Cache-Control: public, max-age=31536000, immutable` on content-hashed files.
  - Multi-range requests aren't needed; answer them with a single range or `416`.
- **Compression:** Cloudflare compresses `application/wasm` automatically. Which encoding (br or zstd) depends on the plan and Compression Rules. Record what production actually serves. Parquet is already compressed: send it with `Cache-Control: no-transform` so Cloudflare doesn't re-encode it and break byte ranges.
- **Local dev:** `wrangler dev` runs the same Worker, so the headers and range behavior in dev match production. `just tycho dev` should use it, or at least the M3 checks must also pass under `wrangler dev`.

---

## Decisions log

| Date | Decision | Source |
|---|---|---|
| 2026-09-22 | Sample datasets: JPL SBDB asteroids (default), Gaia DR3 bright slice (big), both re-hosted | initial spec |
| 2026-09-22 | Hosting: Cloudflare, one Worker + static assets + R2 | initial spec |
| 2026-09-23 | Rust toolchain: dated nightly (`nightly-2026-09-20`), because `gpui-pre-web`'s default `multithreaded` feature pulls in `wasm_thread` (`#![feature]`) | M0 build failure on stable |
| 2026-09-23 | `Cargo.lock` seeded from gpui-kit 0.6.4's published lock, so the whole gpui family is what 0.6.4 shipped with (gpui-pre 0.3.5, wasm-bindgen 0.2.121) | caret deps floated to 0.6.6 / 0.3.6 |
| 2026-09-23 | Web platform: single-threaded, WebGL2 forced (not the WebGPU-first `Auto`), `CanvasFontFallback::Emoji` | M0; M1 measures `Auto` vs `WebGl` |
| 2026-09-23 | UI font: IBM Plex Sans Regular (what `gpui-pre-web` maps `.SystemUIFont` to), fetched by the JS host in parallel with the wasm, not `include_bytes!` | M0 |

### Pending decisions

- [ ] `opt-level` `"z"` vs `"s"` (M1)
- [ ] Graphics backend: forced WebGL2 vs `Auto` (WebGPU first), by cold-start TTFP (M1)
- [ ] UI font subsetting (Latin + Latin Extended covers asteroid names?) vs the full 196 KiB face (M1)
- [ ] Release logging and panic hook: keep `init_logging` in release or strip it for size (M1)
- [ ] **Reference-run DPR (blocks M1's protocol):** headless Chromium can't give GPUI a consistent DPR 2. With emulation the `device-pixel-content-box` reads CSS px, so GPUI draws into a 1× backing store; the launch flag reads DPR 1. Options: run the reference at DPR 1 and record it, run headed Chromium, or patch gpui-pre-web's sizing in `shared/`. See `perf/results/2026-09-23-m0.md` (M1)
- [ ] Arrow IPC decoder approach (M2)
- [ ] Paging strategy A/B/C (M4)
- [ ] Page size and prefetch depth (M4)
- [ ] Memory cap for page cache (M4)
- [ ] Chunked CSV ingest vs raw-file queries (M6)
- [ ] Gaia magnitude cut / final row target (M7)
- [ ] Production wasm encoding, br vs zstd (M8)

---

## Measurements

Filled in as milestones close. Raw results live in `perf/results/`.

| Metric | Budget | M1 baseline | Latest |
|---|---|---|---|
| TTFP (reference, median of 10) | ≤ +10% vs baseline | — | — |
| TTFP (throttled) | recorded only | — | — |
| App wasm (brotli) | ≤ +15% without note | — | 2615.6 KiB (M0, pre-tuning) |
| Engine ready | — | — | — |
| Sample click → schema | ≤ 300 ms | — | — |
| File → first rows | ≤ 500 ms | — | — |
| Fling p95 frame time | ≤ 20 ms, none > 50 ms | — | — |
| Jump to 90% | ≤ 400 ms | — | — |
| Drop Parquet (~1 GB) → first rows | ≤ 1 s | — | — |
| Drop CSV (~1 GB) → first rows | ≤ 1 s | — | — |
| CSV row-count update interval | ≤ 500 ms | — | — |
| CSV ingest throughput | recorded only | — | — |
| Peak memory, 100 MB vs 1 GB Parquet | roughly flat | — | — |

---

## Open questions / notes

- `docs/LESSONS.md` is on probation: remove it if it doesn't prove useful.
