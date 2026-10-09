# PLAN.md — Tycho

Tycho's build plan: milestones (with done-when checks), sample datasets, hosting, decisions, and measurements. Context and rules live in `CLAUDE.md` here and at the repo root. Tick checks as they pass and log decisions as they land.

**Goal:** a local-first data workbench in the browser (DuckDB-Wasm + GPUI Kit on WebGPU, WebGL2 fallback) that proves WebAssembly + GPU-rendered UI beats the DOM for heavy apps, with a number on screen for every claim.

**Deciding metric:** time to first paint (TTFP), measured as `performance.mark("gpui:first-frame")`.

---

## Status

| Milestone | Title | Status |
|---|---|---|
| M0 | Empty GPUI Kit shell on the web | Done 2026-09-23 |
| M1 | First-paint baseline and perf overlay skeleton | Done 2026-09-23 |
| M2 | DuckDB in a worker, prefetched after first paint | Done 2026-09-23 |
| M3 | Asteroid sample over HTTP | Done 2026-09-24 |
| M4 | Virtualized table over paged queries | Done 2026-09-25 |
| M5 | Drop a Parquet file | Done 2026-09-27 |
| M6 | Drop a CSV with progressive loading | Done 2026-09-30 |
| M7 | Observation panel, jump to row, and hardening | In progress: parts A (panel) and B (Gaia sample) done 2026-10-07; part C (jump to row) done 2026-10-08: checks 4 and 8 pass, its TTFP cost accepted; part D (hardening) done 2026-10-08; part E (close-out) done 2026-10-08: every check passes, one suite (`just tycho perf`), placeholder shell decided yes. Part F (cell overflow) next, then G (placeholder shell) |
| M8 | Deploy to Cloudflare | Not started |
| Later | Table interactions: column resizing, selection, sorting | Not started; research first, after M8 |
| Later | Side-by-side comparison: WASM \| React | Not started; research first, after M8 |

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
- [x] The overlay shows TTFP, and the value matches Playwright's measured mark within 5 ms. *Within 0.5 ms on every run (the overlay reads the mark's own `startTime`). `perf.ts` also checks the mark against the page's actual GPU calls, which found and fixed a mark that was a frame late on WebGPU.*
- [x] `perf/baseline.json` records the median TTFP (reference and throttled) and the wasm brotli size for the empty shell. **This is the baseline that every later milestone is compared against.** *177.3 ms reference, 3465.2 ms throttled, 2619.5 KiB (Apple M1, 2026-09-23).*
- [x] `just tycho check` fails if the reference TTFP regresses more than 10% from the baseline, or if the app's wasm brotli size grows more than 15% with no note in `perf/budget-notes.md`. *Negative controls fail on both; a note row accepts the size. See `perf/results/2026-09-23-m1.md`.*
- [x] A `docs/LESSONS.md` entry records the numbers and which profile settings mattered.

### M2: DuckDB in a worker, prefetched after first paint

Build `duckdb.worker.ts` and `bridge.ts` with the three calls. On the Rust side, wrap them with wasm-bindgen: JS Promises → `wasm_bindgen_futures::JsFuture`, driven on GPUI's web executor. Start the engine load from `shared/`'s post-paint callback, never before. Use the self-hosted DuckDB bundle; pick the EH or MVP bundle by feature detection. Arrow results cross the boundary as IPC bytes (`Uint8Array`).

*As built:* there's no `duckdb.worker.ts`. `web/src/engine.ts` (loaded by `bridge.ts` on the first call) runs DuckDB's prebuilt worker inside a small blob: wrapper worker; see the decisions log.

**Done when:**
- [x] Reference TTFP is within noise (≤ 5%) of the M1 baseline with DuckDB loading enabled. *168.7 ms (−4.8%) on the final protocol run; earlier runs 170.7 and 180.7 ms. Interleaved A/B against a rebuilt M1, 20 runs each: 170.0 vs 173.8 ms median (+2.2%), means 177.8 vs 175.9 ms. Throttled +0.8%.*
- [x] The network waterfall in the Playwright trace shows the first DuckDB request starting **after** the `gpui:first-frame` mark. *0 of 20 runs had any non-first-paint request before the mark; the first engine request started 4.5–5.8 ms after it (reference), 24.2–35.7 ms (throttled). `perf.ts` checks this on every run; `--trace` saves the waterfall.*
- [x] The overlay shows "engine ready" time (ms from timeOrigin). *Median 622.3 ms reference, 9728.4 ms throttled; the overlay matches the `tycho:engine-ready` mark within 0.5 ms.*
- [x] `query("SELECT 42 AS x")` from Rust returns a decoded Arrow batch with `x = 42`. *It's the post-paint warm-up; the self-test repeats it (3.0 ms median round trip) and decodes 17 columns of every shown type against DuckDB's real output, in Chromium, Firefox, and WebKit.*
- [x] `cancel()` on a long query (`SELECT count(*) FROM range(1e10)`) stops it within 200 ms, and the next query still succeeds. *Stopped in 4.7 ms median, 10.0 ms max (Chromium, n=10); Firefox 98 ms; WebKit 3 ms. DuckDB won't bind `range(DOUBLE)`, so the query is written `range(10000000000)`.*
- [x] **Decision recorded:** how Arrow IPC gets decoded in Rust (`arrow-ipc` + `arrow-array` with minimal features, or a hand-rolled reader for the types we show). Choose by measured wasm size delta. The decoder is in the app binary, so it counts against the repo-wide TTFP rule. *Hand-rolled: arrow-rs costs +127.3 KiB brotli (+4.8%) more. All of M2's Rust is +12.3 KiB. See `perf/results/2026-09-23-m2.md`.*

### M3: Asteroid sample over HTTP

*Carried from M2:* **Parquet isn't built into DuckDB-Wasm 1.32.0.** By default DuckDB autoloads it from `https://extensions.duckdb.org/v1.4.3/wasm_eh/parquet.duckdb_extension.wasm` (`wasm_mvp` for MVP). M2 turned autoload and autoinstall off (`engine.ts`, `disableExtensionDownloads`) to keep the self-hosting rule, so Parquet functions currently fail with "exists in the parquet extension". M3 must self-host the Parquet extension (EH and MVP builds) from our origin, point `custom_extension_repository` at it, then load it (autoload on for that repository, or an explicit `LOAD parquet`). It counts toward the engine download, not the first paint. Check its size against the 25 MiB asset limit.

Build `data/fetch_asteroids.ts` + `data/prep.sql` (see Sample datasets below) to produce the Parquet files. Serve them from our origin with `Accept-Ranges: bytes` through the Worker under `wrangler dev` (local mode: Miniflare's R2, seeded by `just tycho data` with `wrangler r2 object put --local`). No Cloudflare account, login, or remote bucket is needed until M8. The browser still sees one origin: Vite (dev) and `vite preview` (perf, check) proxy `/data/*` to `wrangler dev`, and serve everything else as today. The Worker is written for production from the start: a `/data/*` route on R2, and every other path falls through to static assets (`env.ASSETS`), so M8 adds only config (`[assets]`, `_headers`), not Worker code. If `wrangler r2 object put --local` can't take the file, the fallback is a dashboard upload to the real bucket with the dev binding marked remote; record which one the measurements used, since remote R2 adds network latency to the checks. Turn on the "Try sample: every known asteroid" button: `register_file(url)`, then read the schema and row count from Parquet metadata with SQL (`DESCRIBE`, `parquet_metadata`, `parquet_file_metadata`). Show column names, types, row count, file size, row-group count, and the data credit in a header strip.

**Done when:**
- [x] Clicking the sample (with the engine warm) shows schema and row count within **300 ms** on the reference run. *87.8 ms median (73.7–100.4, n=10), click → the presented frame (`tycho:sample-shown`); throttled 1012.0 ms. `just tycho sample`.*
- [x] Before the first rows appear, the page has transferred **less than 2% of the file** (footer + first row group). Check this from the Playwright network log. *34,759 bytes (0.098%) in requests started before the schema frame, counted in full at the server (Playwright doesn't see DuckDB's worker XHRs); a negative control with DuckDB's default config fails at 100%. M3 shows no rows, so this is the footer only: row group 0 alone is 9.5% at 122,880 rows per group. Carried to M4's row-group decision; see `perf/results/2026-09-24-m3.md`.*
- [x] If the button is clicked before the engine is ready, the UI shows a loading state and completes once the engine is ready. It never crashes or hangs. *Chromium, Firefox, WebKit: spinner + "Waiting for the engine to load…", schema 200–350 ms after engine ready. With DuckDB's wasm, the Parquet extension, or the data file blocked, the click ends in a visible failure, and a retry after unblocking works.*

### M4: Virtualized table over paged queries (the wow moment)

*Carried from M3:* the M3 transfer check ("footer + first row group < 2%") can't hold at 122,880 rows per group: row group 0 is 3.35 MB (9.5% of the asteroid file), and a `LIMIT 50` read pulled ~5.5 MB with DuckDB's readahead. At ~27 bytes per row, first rows under 2% need row groups of roughly 20k rows or fewer. Decide the row-group size here, with the paging strategy.

Build the table with GPUI Kit's virtualized table, backed by a **page cache**: fixed-size pages keyed by page index, filled with `query` calls, and an in-flight map that `cancel`s stale requests when the viewport moves on. Prefetch N pages on each side of the viewport, and more in the direction of scrolling. When a page isn't loaded yet, draw placeholder rows (skeleton cells, same row height). Never stall a frame waiting on data. Evict pages with an LRU memory cap.

**Paging strategy (measure, then decide):**
- **A)** `SELECT * FROM t LIMIT p OFFSET o` on the raw Parquet.
- **B)** Row-group-aligned: map page → row group using `parquet_metadata`, then filter on `file_row_number` (via `read_parquet(..., file_row_number=true)`) so DuckDB reads only one row group over HTTP.
- **C)** Ingest into a DuckDB table first, then query by rowid.

Record, for each option, the latency of a random jump to row ~90% and the bytes transferred. Choose B unless the measurements say otherwise.

*As built:* not gpui-kit's `DataTable`. Its `uniform_list` positions rows in f32 pixels, which steps by 4 px at the asteroids' 47 M px and 64 px at Gaia's 25 M rows. `crate/src/table/` keeps the scroll position as an f64 row index, draws only the visible rows and columns, and owns its scrollbars, wheel, and keys. Strategy B at 30,720-row groups (see the decisions log). The "first rows under 2%" goal carried from M3 can't hold with DuckDB-Wasm 1.32.0: its HTTP readahead reads at least 1.39 MB per page, 3.8% of the file.

**Done when:**
- [x] **File → first rows** (click → first real cell painted) is **≤ 500 ms** with the engine warm, and shown in the overlay. *239.2 ms median (n=10), click → `tycho:first-rows`, set right after the first frame with every visible row loaded; throttled 3416.4 ms. The overlay row "Sample → first rows" matches the app's marks within 0.5 ms. `just tycho table`.*
- [x] The overlay shows **scroll FPS** (frame-time p50/p95 over the last 2 s). *`shared/`'s "Frame time (2 s)" row: p50, p95, and max of rAF intervals, refreshed every 500 ms while the overlay is visible. It agrees with the harness's own rAF recorder.*
- [x] A scripted fling (Playwright wheel events, top → bottom in ~3 s) keeps **p95 frame time ≤ 20 ms** with **no frame > 50 ms**. Placeholders may appear during the fling. *p95 16.7 ms and worst frame 33.3 ms over all 10 reference runs, 0 over 50 ms; throttled (CPU 4×) worst 50.0 ms. Placeholders show in ~85% of fling frames: at ~520,000 rows/s no prefetch keeps up.*
- [x] Dragging the scrollbar to ~90% shows real rows in **≤ 400 ms** (reference) and never shows a blank table. *133.0 ms median, release → `tycho:viewport-filled`; 0 frames with a blank row position; throttled 2228.2 ms.*
- [x] Scrolling to the last row shows the last row. The row count matches `SELECT count(*)`. *All 20 runs: rows end at 1,567,523 = `count(*)`, and the last spkid matches the file's last row. Chromium, Firefox, and WebKit (`--browsers`).*
- [x] JS heap + wasm memory stay under the cap you set (write it down) after scrolling the whole sample twice. *Cap **128 MiB** (wasm + live JS heap; `perf/table.ts`). 89.4 MiB after two passes, with the page cache at its 64 MiB budget. Wasm plateaus from the second pass on (5-pass run: no growth).*
- [x] **Decision recorded:** page size and prefetch depth, chosen from a small sweep (e.g. 256/1024/4096 rows × 1/2/4 pages). *1024 rows × 2 pages; see the decisions log.*

### M5: Drop a Parquet file

Handle file drop and a file picker (the fallback) on the canvas. Register the file with DuckDB using the `File` handle, so it's read lazily and never copied whole into memory. Reuse the M3/M4 pipeline unchanged.

*As built:* `crate/src/files.rs` listens for drops on `window` (GPUI swallows them on its canvas) and opens the file dialog through a hidden `<input type=file>`; `files::sniff` checks `PAR1` at both ends first. The pipeline is M3/M4's, plus two changes the 1 GB file forced: a global Parquet metadata cache and visible-pages-first paging (decisions log). Test files: `just tycho drop-files`; checks: `just tycho drop`.

**Done when:**
- [x] Dropping a ~1 GB Parquet shows schema and first rows within **1 s** of the drop, with the engine warm. *969.7 MiB, 42.3 M rows, our 30,720-row groups (1,378): schema **213.6 ms**, first rows **796.0 ms** median (n=10); throttled 254.1 / 864.5 ms. Before the two fixes: 536.9 / 2658.8 ms. At 122,880- and 1,048,576-row groups: 219 and 230 ms to first rows. The overlay's "File → first rows" matches within 0.5 ms.*
- [x] Peak memory stays roughly the same whether the file is 100 MB or 1 GB, which shows the file isn't being copied. *App (wasm + JS) 17.6 vs 17.5 MiB; every agent (DuckDB's worker included) 135.1 vs 129.2 MiB. A held copy of the 100 MB file reads +127.6 MiB (negative control). Bounds: app ±16 MiB, every agent ±10% of the size difference; see `perf/results/2026-09-27-m5.md`.*
- [x] Dropping an unsupported file shows a clear inline message. Dropping while a load is running cancels the old load cleanly. *Text, CSV, junk `.parquet`, 5-byte, and encrypted-Parquet files, on the empty state and over an open file: each gets its message, and an open file stays open. Four supersede cases (while opening, while pages load, over the sample, before the engine is ready): the last file wins, nothing else shows after, no console errors, the engine still answers.*
- [x] Manual check in real Firefox and Safari (drop from Finder, file dialog). *Passed 2026-09-27; drop and dialog also pass in Playwright Chromium, Firefox, and WebKit.*

*Carried to M7:* a page read costs ~0.4 ms per row group whatever its size, because a `file_row_number` filter doesn't prune row groups in DuckDB 1.4 (~490 ms at 1,378 groups; ~20 ms for the asteroids' 52). Pick Gaia's row-group size with this in view, and watch it in the work-time sparkline.

### M6: Drop a CSV with progressive loading

Show first rows fast: sniff with `read_csv(..., sample_size=...)` and show `LIMIT` rows right away. Then ingest in the background in **chunks** so the row count can grow: JS slices the `File` by byte range at newline boundaries, then for each chunk runs `INSERT INTO t SELECT * FROM read_csv(chunk, columns=<sniffed schema>, header=<first chunk only>)`. After each chunk, the row count and scrollbar extent update. The table scrolls over the rows already ingested.

*As built:* `crate/src/csv.rs`. Rust cuts the file at record boundaries (a quote-aware scan, 1 MiB per read), registers each chunk as a `File` slice (no copy, no new bridge call), and makes each chunk **its own table**, `CREATE TABLE tycho_csv.f<n>.c<k> AS SELECT * FROM read_csv(…, auto_detect = false, …)`, in an attached compressed in-memory database. Not one table appended to, as planned above: appends stalled 200–600 ms every few chunks. The dialect and types come from one `sniff_csv` of the first 1 MiB chunk, with RFC 4180 quoting forced (the sniffer picks no quote when the head has none); a later value that doesn't fit its type widens that column to VARCHAR and the chunk goes again. Chunks aim at 200 ms (1–8 MiB). The table (`RowSource::Csv`) grows after every chunk, and reads a page from the one or two chunk tables it spans. A replaced CSV's schema is dropped. Test file: `just tycho drop-files csv` (the fixture ×6, 1,021.7 MiB, 9,405,186 rows); checks: `just tycho csv`; experiment: `just tycho ingest`.

**Done when:**
- [x] A ~1 GB CSV shows its first rows within **1 s** of the drop. *1,021.7 MiB, 9.4 M rows: schema **143.0 ms**, first rows **183.8 ms** median (n=10); throttled 193.7 / 342.9 ms. The overlay's "File → first rows" matches.*
- [x] The row count in the header updates **at least every 500 ms** during ingest, and the scrollbar grows with it. *130 updates per load; the longest gap between frames showing the count grow was **202.4 ms** over all 10 reference runs (median gap 102.8 ms); throttled worst 455.1 ms. Sampled every 100 ms, the table's row extent equalled the header's count in every sample, and never shrank.*
- [x] Scrolling during ingest stays within the M4 frame budget. *A 3 s fling down and up the loaded rows, mid-load: p95 **16.7 ms**, worst **16.7 ms**, 0 over 50 ms in all 10 reference runs. Throttled (recorded only): p95 33.3 ms median (50.0 in some runs), worst 66.7 ms, one frame over 50 in one run, against 16.7 / 33.3 ms throttled without an ingest (M5): the scan's main-thread work shows at CPU 4× (carried to M7).*
- [x] The final row count matches the file's data-line count, using `data/fixtures/asteroids.csv` (which includes quoted commas and newlines). *1,567,531 = MANIFEST.json's count (and 9,405,186 for the 1 GB file, every run). End shows spkid 99000008, and the 8 tricky rows read back byte for byte. Firefox and WebKit: same count and last row. Generated files with a `rowid` column, a literal `12"` inside a field, and an unquoted TSV load exactly; a malformed row stops the load and keeps the rows before it.*
- [x] Ingest throughput (MB/s) and total time are shown in load stats and recorded. *The overlay's "CSV load" ("1021.7 MiB in 15.5 s · 69.0 MB/s") and "CSV chunks" ("131 · slowest 188 ms"), and the header strip ("loading 30% · 67.6 MB/s", then "loaded in 15.5 s · 69.0 MB/s"). **15.4 s, 69.5 MB/s** median (n=10); throttled 21.2 s, 50.5 MB/s.*
- [x] **Decision recorded:** chunked ingest vs. raw-file queries, backed by the numbers. *Chunked, one compressed table per chunk; see the decisions log and `perf/results/2026-09-30-m6.md`.*

*Known cost:* every chunk stays registered with DuckDB for the session (`file-<n>-<k>.csv`, ~130 for the 1 GB file), like M5's file handles: unregistering is a fourth bridge call, and a registration holds a `File` slice, no bytes. Fold it into M7's footer-cache question (dropping on `registerFile`).

*Code review (M6):* a finished or stopped CSV's tables weren't dropped when another file replaced it (only a loading one's were), ~300 MiB each for the 1 GB file; a CSV with its own `rowid` column paged by its values; a quote inside a field (`12" pizza`) could make the scanner treat the rest of the file as one quoted field; a stop between queries didn't stop the next chunk; a chunk's time could include the next chunk's scan. All fixed, each with a check (`just tycho csv`: supersede and formats).

*Manual check (Firefox, Safari):* passed 2026-09-30; the 1 GB CSV loads in ~20 s there. End on the 1 GB Parquet showed skeleton rows for ~1.5 s, with or without a CSV before it (measured): M5's per-row-group cost, below.

*Carried to M7:* during a CSV load at CPU 4×, fling frames reach 33–50 ms at p95 and 66.7 ms at worst, against 16.7 / 33.3 ms without one: the record scan copies 1 MiB windows into wasm on the main thread. Check it with the per-frame work time, and try smaller windows. And a 1 GB CSV holds ~300 MiB in DuckDB (~590 MiB every agent): the file-size ceiling M7 measures is lower for CSV than for Parquet.

### M7: Observation panel, jump to row, and hardening

Turn the perf overlay into an **observation panel**: something a visitor keeps open to watch the app work, while it loads and while they use it, not only a debug readout. It shows:
- **Live load waterfall:** HTML → wasm download → compile → first frame → engine ready → Parquet loaded → first rows. Each step fills in as it happens, so a visitor on a slow link watches the load instead of waiting on it.
- **Bytes read vs file size**, e.g. "read 1.4 MB of 38 MB". DuckDB reads over sync XHRs inside its worker, which the page doesn't see by default. Find where to count them, and get the count to Rust through `query` if possible: a fourth bridge call needs a recorded decision (Tycho rule 2).
- **While scrolling:** rows/s, pages in flight, cache hits, wasm and JS memory, and a frame-time sparkline with **two lines**: the rAF interval and the **per-frame work time** (main-thread time spent in our frame: layout, table draw, GPUI present). The interval pins at 16.7 ms whether a frame took 1 ms or 12 ms, so it can't show headroom; the work time can. It's how to decide on the cell-string cache below, and how to re-run M4's page-size sweep on Gaia so its configs finally separate.

The panel refreshes at ~4 Hz, not every frame, so watching doesn't cost the frames it measures.

Add **jump to row**: a text input that scrolls the table to a row number. It's navigation, not analysis, so it's inside v1 scope (Tycho rule 4). It's the app's first text input, so it meets the canvas input gaps first: the Input context-menu "Paste" was disabled on web until gpui-kit 0.7.0 (#3187), which falls back to an async clipboard read (#3244); check it works and what permission prompt the browser shows, and IME composition runs through GPUI's canvas input path (a Japanese IME can commit full-width digits like "１２３"; accept them or say why not). Keys typed in the input must not also scroll the table. Record what works in the README's "Canvas tradeoffs" section.

Add error states: engine failed to load, network failure on the sample, and file too large.

*Candidate (pending decision): static placeholder shell.* An HTML/CSS copy of the empty shell in `index.html`, painted before the wasm arrives and swapped for the canvas in the same step as `gpui:first-frame`, with no blank frame between. It must match the shell exactly (IBM Plex, theme colors, `prefers-color-scheme`) and stays non-interactive; optionally it catches an early file drop and hands it to the app once it starts. **TTFP keeps meaning GPUI's real first frame.** The placeholder paint is a separate metric, and the panel shows both. Decide by the throttled run, where first paint is ~3.5 s; the reference run's ~170 ms leaves little to win.

*Carried from M5 (code review):* when a file is replaced, DuckDB reads already started keep running (up to 3 pages) next to the new file's first queries; the page cache counts them per table. Track in-flight and draining requests in `Engine` so a new table waits for them.

*Carried from M5 (code review): parsed footers pile up.* With `parquet_metadata_cache` global and each open under a new SQL name, every opened file's parsed footer stays in DuckDB's worker for the session (a few MB for a 1,378-group file). Measure before deciding anything, and don't add a fourth bridge call on a guess:
1. **Does unregistering free it?** The cache is keyed by path, so dropping the file handle (`db.dropFile`) may leave the footer cached, and a fourth call would buy nothing. Open 20 big files and record the worker's memory (`measureUserAgentSpecificMemory`, as `perf/drop.ts` does) with and without dropping each one after the next opens.
2. **Can SQL clear it?** Test whether `SET GLOBAL parquet_metadata_cache = false` followed by `= true` empties the cache, or only stops it filling. If SQL can clear it, it goes through `query`, and the bridge stays at three calls.
3. **If dropping does free it, fold it into `register_file`, not a new call.** v1 shows one file at a time, so "open a file" can mean "replace the open file": `engine.ts` drops the previously registered file when a new one registers. Rule 2 holds, but its wording changes, so update Tycho's CLAUDE.md and the decisions log. Drop only after the old file's reads have settled (the in-flight tracking above): a read DuckDB already started on a dropped handle would fail, or worse, hang the worker. The sample re-registers under the same name each time; check that dropping and re-registering it works.
Record the numbers in M7's results either way. If the growth is small next to the file-size ceiling M7 measures, a documented cost may be the right answer.

*Carried from M5:* a page read costs ~0.4 ms per row group (19 columns), whatever the page size: DuckDB 1.4 doesn't prune row groups on `file_row_number`, so every query sets up every group's column readers. At Gaia's 25 M rows, 30,720-row groups would be ~800 groups, ~0.3 s a page before any network. Weigh that against M4's HTTP readahead finding (bigger groups read more bytes per jump) when choosing Gaia's row-group size, and measure both. *Done in part B: 61,440-row groups (see the decisions log).*

*Note from M4's code review:* the table formats every visible cell (`Value::to_string`) on every frame, ~360 strings per frame. Frames hold 16.7 ms p95 on the asteroids, so there's no cache yet (measure before adding one). Re-check with Gaia's wider rows here, using per-frame work time (not frame intervals), and cache formatted strings per loaded page if the work time needs it. *Decided in part B: no cache; formatting is 0.6% of a Gaia draw (decisions log).*

*Note from M2's code review, for this milestone to decide:* `bridge.ts` caches the engine load promise, including a rejected one (`engine ??= import(...)`). One transient failure (a network blip on the engine chunk or DuckDB's wasm) makes every later call fail with the same error until a reload. Today's UI says "Reload the page to try again", which matches. Decide whether "engine failed to load" should retry instead: reset the cached promise on rejection and offer a Retry button, or keep reload-only. A dead worker is terminated, so a retry must start a new one. Add the second sample button, "Big: 25M Gaia stars" (with the ESA credit). Measure the practical file-size ceiling (wasm32 has about 4 GB of memory) for Parquet and CSV, and fail gracefully above it.

**Done when:**
- [x] All panel metrics show live values and match `just tycho perf` within 5%. *2026-10-07 (part A):* 17 values a run, 340/340 within 5% (or half the display step) over 10 reference + 10 throttled runs, each against an independent measurement, in `just tycho panel`. *Part E:* it's in `just tycho perf` (the suite's `panel` part).
- [x] The panel updates at **~4 Hz**, not every frame, and the M4 fling budget holds with the panel **open and closed** (the perf suite measures both). *2026-10-07:* fling p95 16.7 ms, worst 16.7 ms, both ways (reference, 10 runs each).
- [x] **Per-frame work time** (p50/p95) is shown in the panel and recorded in the Measurements table: reference and throttled, asteroids and Gaia. *Asteroids 2026-10-07 (part A). Gaia 2026-10-07 (part B, `just tycho table --sample gaia`, 10 runs each): fling 5.7 / 7.9 ms ref, 21.7 / 28.7 throttled; steady scroll 12.6 / 14.7 ref, 21.3 / 26.7 throttled.*
- [x] **Jump to row** lands on the requested row: first, middle, last, and out of range (a clear inline message, no scroll). *2026-10-08 (part C, `just tycho jump --browsers`):* every case passed in 10 reference + 10 throttled Chromium runs per sample, and in Firefox and WebKit, both samples, with the panel open and clear of the input. Enter → rows shown: asteroids 79.4 ms (middle) / 68.7 (last), Gaia 153.2 / 151.1 (reference). IME full-width digits, paste (keys and menu), keys kept from the table, and focus after a failed open checked too. `perf/results/2026-10-08-m7-jump.md`.
- [x] The ceiling is measured, documented in the README, and enforced with a friendly message before the tab can run out of memory. *2026-10-08 (part D, `perf/results/2026-10-08-m7-hardening.md`):* Parquet opens to 9.6 GB (423 M rows) with flat memory (DuckDB 5.6 MiB), but time grows with row groups (first rows 3.5 s at 3,445); CSV costs 0.28–0.47 bytes of DuckDB memory per byte, and past ~2.1 GiB DuckDB-Wasm silently stored empty tables (an 8.6 GB CSV lost 8.8 M rows). Enforced: Parquet over 10 GB and CSV over 6 GB refused at the drop (`limits.rs`); a CSV load stops at 1.5 GiB of DuckDB memory, or at a chunk that yields no rows, keeping the rows before it (`csv::MEMORY_BUDGET`). README, "File size limits". `just tycho errors` check 6, and a 4.6 GB random-text CSV stopped at 69% with no empty chunk.
- [x] The Gaia sample meets the M4 scroll and jump budgets. If it can't, lower the row target in `prep.sql` and record why. *2026-10-07 (part B), 25,067,889 rows, reference, 10 runs: first rows **290.6 ms** (≤ 500), jump to 90% **136.8 ms** (≤ 400), fling p95 **16.7 ms**, worst 16.7 (≤ 20, none > 50), last row = `count(*)`; app memory 71.2 MiB after two full passes (≤ 128). The row target stays. Throttled (recorded only): first rows 8470.6 ms, jump 6584.5 ms: 5.6 MB per page read on Fast 4G.*
- [x] `just tycho perf` runs the full suite (cold load, both samples, fling, jump, CSV) and writes one results file. *2026-10-08 (part E, `perf/suite.ts`):* six parts (cold load, the panel against independent measurements, the table on the asteroids and on Gaia, jump to row on both, the ~1 GB CSV), reference + throttled, median of 10, into `perf/results/2026-10-08-m7-suite.json` with a headline per part, each budget's pass/fail, and the load average. Every budget passes; see Measurements. The panel's wasm-memory row failed 2 of 10 throttled runs on the check's own timing (read up to 250 ms after the refresh, while pages were still arriving), fixed in `panel.ts` and that part re-run (`--update`). ~1 h 45 min.
- [x] The README has a "Canvas tradeoffs" section giving the current status of a11y, IME, selection, Ctrl+F, and bundle size, each with what we do today. *2026-10-08 (part C): also text input, paste, and the overlapping panel.*

**Split into parts (2026-10-07),** one session each, in order. M7 is five pieces of work (seven since part E: F fixes cell overflow, G builds the placeholder shell E decided on). Each has its own measurement pass, and later checks depend on the panel's work time. Each part ends with its numbers in `perf/results/` and a short note under M7 in `docs/LESSONS.md`. The milestone closes after part G.
- **A. Observation panel** (`shared/` overlay → panel): the load waterfall, bytes read vs file size (find where to count DuckDB's XHRs; get it to Rust without a fourth call if possible), rows/s, pages in flight, cache hits, memory, and a two-line sparkline (rAF interval + per-frame work time). It refreshes at 4 Hz. `just tycho perf` checks the panel against its own numbers (within 5%) and measures the fling with the panel open and closed. Checks 1–3 (asteroids). Start the Gaia fetch in the background if it's slow.
- **B. Gaia sample:** `just tycho data gaia`, the row-group size (per-row-group cost vs readahead; measure both), the magnitude cut, the "Big: 25M Gaia stars" button with the ESA credit, M4's scroll and jump budgets on Gaia, the page-size sweep re-run, and the cell-string cache decision by work time. Check 6, and check 3 for Gaia.
- **C. Jump to row:** the first text input. Restore lost focus per the gpui-kit skill (`cx.on_focus_lost` + `window.focus_lost_restore_target`, both in 0.7.1): when a focused input or table stops rendering (a failed open shows the empty state), key dispatch starts at the root and `key_context` bindings stop firing. Paste via the context menu (#3244) and its permission prompt, IME full-width digits, keys not reaching the table. The README's "Canvas tradeoffs" section. Checks 4 and 8.
- **D. Hardening:** error states (engine, network, too large), the engine-retry decision, the Parquet and CSV size ceiling (measured, enforced, in the README), in-flight/draining tracking in `Engine`, footer pile-up measurements, the CSV scan window vs fling work time. Then the read counter's key collision (part A review): counters are keyed by URL, or by a dropped file's name, size, and mtime, so re-opening the same sample or file shares the key. The old open's cancelled reads that are still draining count toward the new open's "Read". Key them per registration once `Engine` knows which reads belong to which open. From part B: the open observation panel covers the bottom of the table's vertical scrollbar, so a thumb at the bottom (after End or a fling) can't be grabbed; and a wheel against the table's end (nothing moves) still redraws, at ~22 ms a draw against ~12.5 ms for a scrolling draw (both samples; measured with `perf/table.ts`'s old steady step, which wheeled there by mistake). Check 5.
  *Done 2026-10-08* (`perf/results/2026-10-08-m7-hardening.md`): check 5 above. Engine Retry for both a failed load and a stopped worker (decisions log). Network failures: the sample says so; failed page reads recover once online, by themselves (a failed range read breaks the file's SQL name in DuckDB-Wasm; the workbench re-registers under a new one). In-flight tracking: built, measured with no effect (DuckDB's worker already orders cancelled reads before the next open's messages), and removed; that also settles the read counter's key collision, which can't happen. Footers: nothing frees them; documented cost. CSV scan window: no effect on the fling; stays 1 MiB. The panel keeps clear of the scrollbars (`seiza::perf::set_clearance`). The wheel at the end draws nothing: the draws were the open panel's 4 Hz refreshes. *Carried:* during a CSV load at CPU 4× a fling's frames take ~10 ms more work (p95 ~50 vs ~38 ms after it), and it isn't the scanner; and the open panel's refresh is a ~20 ms whole-window draw, 4 times a second.
- **E. Close-out:** one `just tycho perf` suite and one results file (cold load, both samples, fling, jump, CSV). The static-placeholder-shell decision from the throttled run. Final Measurements rows, LESSONS entry. One copy of the performance-mark and clock helpers (part A review): `seiza`'s `frames.rs` (`mark`, last entry), Tycho's `engine::bridge` (`mark_start_time`, first entry; `now`; an inline `performance.mark`), and `first_frame.rs` each have their own, and they disagree on which entry a re-set mark reads. Make them `seiza` helpers and settle first or last. Check 7, and a re-check of everything.
  *Done 2026-10-08* (`perf/results/2026-10-08-m7-close-out.md`): check 7 above, and every M7 budget re-checked in that one run. `seiza::marks` holds the clock and marks (readers take the last entry; part D had already settled it, so the copies agreed). Static placeholder shell: **yes, built in part G** (decisions log): on the throttled run it paints at 234.5 ms against GPUI's 3696.9 ms, with no TTFP cost. `check` read 201.6 ms over the 195.0 limit under load, but an interleaved A/B read this change 199.8 ms vs HEAD 197.1 (n=20; throttled 3713.0 vs 3720.9): HEAD is over the limit too. The re-baseline is still pending a quiet session.
- **F. Cell overflow** (found in part E's manual check, Gaia): a value wider than its column is cut off at the **front** with no ellipsis. Number cells are right-aligned (`justify_end`, `table/mod.rs`), so the overflow spills left and the cell clips it: `45.12345678901234` (a DOUBLE printed as its shortest round-trip text, 16–17 characters, in a fixed 120 px column) can read as `5.12345678901234`, a different number with no sign of the cut. Text cells keep their start but have no ellipsis either.
  1. **Never cut the front of a number.** Size each column to the widest formatted value in its loaded pages (measured, not estimated), up to a cap; past the cap, keep the leading characters and end in "…". Decide whether a column may widen while scrolling (columns jumping under the reader) or only from the first pages, and say why.
  2. **One tooltip for the hovered cell, not one per cell.** `.tooltip()` on every cell would give ~360 cells an id and a hitbox every frame, flings included. The table maps the pointer to row and column from its own scroll model and draws a single tooltip (gpui-kit's `Tooltip` look) beside that cell after the usual delay, only when its text was cut. No HoverCard (dropped in part E: copy belongs to "Table interactions", after M8).
  Checks: no number cell anywhere in either sample shows its digits cut at the front (a script compares each visible cell's shown text with its value); a cut value ends in "…" and its tooltip shows the whole value; fling and steady work per frame within noise of part E's (both samples, reference and throttled); first rows and jump within budget; wasm size recorded. The README's "Canvas tradeoffs" says the tooltip, like the cells, is invisible to screen readers.
- **G. Static placeholder shell** (decided in part E): the HTML/CSS copy of the empty shell in `index.html` (in `shared-web/`, so every app can have one), above the canvas until `gpui:first-frame`, inert, saying what's loading. Decide the font (system fonts and a visible swap, or one Plex download both can use: the preload is `as=fetch` for GPUI, which CSS can't share). Checks: the placeholder's paint as its own metric in `perf.ts` and the panel's waterfall (reference and throttled); a screenshot match against the first frame, light and dark; no blank frame at the swap; TTFP within noise of part E (interleaved A/B). The README's "Canvas tradeoffs" says it's a DOM layer and what it does. Prototype and numbers: `perf/placeholder.ts`, `perf/results/2026-10-08-m7-close-out.md`.

### M8: Deploy to Cloudflare

Deploy to Cloudflare as one Worker on one origin (see Hosting below). The app shell is served as Worker static assets, and `/data/*` (plus any file over 25 MiB) is streamed from R2 through the same Worker.

**Serve it from a custom domain, not `*.workers.dev`.** The account's workers.dev subdomain is the owner's personal handle, and this repo is public. The workers.dev hostname must not appear in anything committed: README, `perf/results/`, `docs/`, `wrangler.toml`, or any script default. Run `perf.ts --url` against the custom domain, and check that the results JSON records only that host. Consider `workers_dev = false` in `wrangler.toml` so the handle URL isn't served at all.

*Carried from M3:* the Worker's static-asset fallthrough must answer a missing `/duckdb-ext/*` file with 404, never an SPA `index.html`: DuckDB autoloads any extension a query needs from there, and only the pinned ones exist. `web/vite.config.ts` does this for dev and preview.

**Done when:**
- [ ] The app is served from a custom domain, and `git grep workers.dev` finds nothing but this note and the Hosting section.
- [ ] The public URL passes `just tycho perf` against production, with TTFP within 15% of the local release build. *(Since M7 part E, `perf` is the full suite and only its `cold` part takes `--url`; give the other parts `--url` here, or name which parts run against production.)*
- [ ] `crossOriginIsolated === true` in production.
- [ ] Range requests to `/data/*` return `206` with a correct `Content-Range`. `HEAD` returns `Content-Length` and `Accept-Ranges: bytes`. Both samples load and scroll in production.
- [ ] The wasm is served compressed (`Content-Encoding: br`, or `zstd` if that's what Cloudflare negotiates on our plan; record which).
- [ ] The perf-overlay numbers from the public URL are recorded in the README as the headline results.

---

## Long-term goals (after M8)

Not milestones yet. Each starts with research, and becomes a milestone only if the research says it's worth building.

### Table interactions: column resizing, selection, sorting

M4 built its own table instead of gpui-kit's `DataTable`, whose f32-pixel scrolling breaks past ~16 M px (see M4 and the decisions log). The cost was `DataTable`'s interactions: resizable columns, row/cell selection (and copying it), and sorting. Sorting is also out of v1 scope (Tycho rule 4), so this is post-v1 work.

**Research costs first, then decide whether it's worth building.** Before writing any of it, measure or estimate and record in `docs/`:
- **Size and first paint:** the added wasm (brotli) for each feature, against the TTFP and size budgets.
- **Frame cost:** what each adds per frame while scrolling (hit-testing, resize handles, selection state across 25 M rows).
- **Sorting's data cost:** the table pages by row-group ranges (`file_row_number`). A sort needs `ORDER BY` over the whole file, which reads all of it (37.7 MB for the asteroids, far more for Gaia), or a sorted copy in DuckDB's memory, against rule 3 (never load the whole result). Measure time, bytes, and memory on both samples.
- **Reuse:** whether gpui-kit's column and selection pieces can sit on top of the row-based scroll model, or have to be rebuilt.
- **Canvas gaps:** how selection and copy interact with the canvas tradeoffs (text selection, a11y) the README tracks.

Record the decision (build all, some, or none) in the decisions log with the numbers, and only then add a milestone with "done when" checks.

### Side-by-side comparison: WASM | React

The "React comparison mode" in Pending decisions. One page shows Tycho next to a React version (TanStack Virtual over a DOM grid), each with its own observation panel (M7). An optional third column: React with a canvas grid (Glide Data Grid), which separates "canvas vs DOM" from "wasm vs JS".

- **Only the UI differs.** Same DuckDB engine layer, same file, same paging logic. Likely a separate host, `apps/tycho-react/`, reusing Tycho's engine layer; check what would have to move to a shared place (`web/engine.ts`, the page SQL and paging now in Rust) and whether that breaks the `shared/` rules.
- **Not a live race in one tab.** Two apps in one tab share a main thread and a GPU and distort each other's numbers. Use a **replay mode**: the same scripted run (load, fling, jump to 90%) on each side in turn, with results side by side. Visitors can use either side, one active at a time.
- **Show where React wins,** not only where Tycho does: first paint and bundle size are likely React's.

**Research first, then decide.** Before building the page, measure through the same Playwright harness and record in `docs/`:
- **Size and first paint:** the React app's bundle (brotli) and TTFP, reference and throttled.
- **Row counts:** how its grid handles 1.5 M and 25 M rows. Browsers cap element height at roughly 33 M px in Chrome and under 18 M px in Firefox, below 25 M rows at any usable row height, so check what TanStack Virtual does past the cap (scaling, paging, or breaking).
- **Frame cost:** fling frame intervals and per-frame work time, measured as for Tycho.

Record the decision in the decisions log, and only then add a milestone with "done when" checks.

---

## Sample datasets

**Decided 2026-09-22.** Both datasets are space-themed: asteroids are the default, and Gaia stars are the big one. Both are re-hosted on our origin.

### Default: every known asteroid (NASA/JPL Small-Body Database)

- **Rows:** about 1.5 million: every asteroid with a known orbit. Confirm the count with `just tycho data`, since Rubin discoveries grow it every day.
- **Source:** the JPL SBDB Query API (`ssd-api.jpl.nasa.gov/sbdb_query.api`), which returns JSON (`fields` + `data` arrays). `data/fetch_asteroids.ts` (run by Node directly, like the `perf/` scripts) pulls the full catalog in pages (`limit` / `limit-from`) and writes raw JSON. `prep.sql` then turns that into Parquet. Record the fetch date. The catalog can change between pages, so dedupe on `spkid`.
- **Columns:** `full_name`, `pdes`, `name`, `neo`, `pha`, `class`, `H`, `diameter`, `albedo`, `a`, `e`, `i`, `q`, `per_y`, `first_obs`, `last_obs`, `n_obs_used`, plus `spkid` as the key. Many physical fields are null, which is realistic and a good test of how the table renders nulls.
- **Sort:** by `spkid`, so row 1 is **(1) Ceres**, then Pallas, Juno, Vesta… Scrolling top to bottom goes from the oldest discoveries to last week's.
- **Credit in the UI:** "Asteroid data: NASA/JPL Small-Body Database, fetched <date>."

### Big: Gaia DR3 stars (ESA)

- **Rows:** a slice of Gaia DR3's ~1.8 billion sources. Target **~25 million rows**, then tune after M7 measures the ceiling. Pick the cut by brightness (`phot_g_mean_mag < X`) and choose X in `prep.sql` to hit the target. *M7 part B:* **G < 14.5, 25,067,889 stars** (the ESA archive's count, which prep checks); `prep.ts`'s `--cut` moves it without a refetch, down from G < 15 (36.9 M).
- **Source:** Gaia DR3 as HATS-partitioned Parquet on AWS Open Data (`s3://stpubdata/gaia/`, us-east-1, no AWS account needed). Read it with native DuckDB (`@duckdb/node-api`, `httpfs`, anonymous S3) and push the filter down. *M7 part B:* the pushdown can't skip data. The 2,016 partitions are sorted by `source_id`, so every row group holds every magnitude, and the fetch reads the ten columns of all 1.8 billion rows (~90 GB, ~50 min at 8 jobs). `fetch_gaia.ts` keeps one extract per partition (G < 15, 2.3 GB) in `data/raw/gaia/`, so a rerun or a new cut reads nothing. Two partitions hold 17,842 identical duplicate rows at G < 14.5; prep drops them.
- **Columns:** `source_id`, `ra`, `dec`, `parallax`, `distance_pc` (1000/parallax where parallax > 0; label it approximate), `pmra`, `pmdec`, `phot_g_mean_mag`, `bp_rp`, `radial_velocity`, `teff_gspphot`.
- **Sort:** by `source_id`. That ID encodes a HEALPix sky position, so scrolling sweeps across the sky, and neighboring rows compress well.
- **Role:** this is the scale test. It gives the M4 paging and the M7 ceiling real work, and it sets up v1.1 charts (a GPU star map).
- **Credit in the UI (required):** "This work has made use of data from the European Space Agency (ESA) mission Gaia, processed by the Gaia Data Processing and Analysis Consortium (DPAC)."

### `just tycho data` produces

The data scripts are TypeScript run by Node, like `perf/`. `prep.sql` stays plain SQL, run by a small TS runner on `@duckdb/node-api` (pinned, in its own npm workspace at `data/` so its native binary stays out of the web host's install).

- `data/raw/`: raw API/S3 fetches (asteroid JSON pages, Gaia extracts). Gitignored.
- `asteroids.parquet`: default button. ZSTD compression, `ROW_GROUP_SIZE` 30,720 (M4; was 122,880).
- `gaia-dr3-bright.parquet`: "big" button. ZSTD, **`ROW_GROUP_SIZE` 61,440** (M7: same bytes per page as 30,720, half the per-group cost; see the decisions log), 1.57 GB, 409 row groups. `just tycho data gaia` builds it; `--bench` writes row-group variants to `data/bench/`.
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

- **Names (2026-09-24):** Worker `tycho` (public on a custom domain; the account's `*.workers.dev` subdomain exposes a personal handle, so it's never committed, see M8), R2 bucket `tycho-data`, bound as `TYCHO_DATA`. `wrangler.toml` doesn't commit the account ID; deploys read `CLOUDFLARE_ACCOUNT_ID` from the environment, and API tokens never go in the repo.

- **Worker static assets** serve `index.html`, JS, fonts, and the app wasm. Set COOP/COEP in `_headers`. The limit is **25 MiB per file**, so check the release wasm size and each DuckDB bundle against it in `just tycho build`. Any file over the limit moves to R2 and is served like the data.
- **R2** holds the datasets (and oversize engine files) and is read through a Worker binding at `/data/*`. R2 has **no egress fees**, which matters when every visitor may pull hundreds of MB of Gaia rows. That's the main reason to choose it over Google Cloud Storage/Firebase.
- **The Worker's range handling is ours to get right:**
  - Parse `Range` in the Worker and call `env.TYCHO_DATA.get(key, { range: { offset, length } | { suffix } })`. Don't pass `request.headers`: for several ranges or a start past the end, R2 returns the whole object with no error (M3, Miniflare).
  - Set `Content-Range` ourselves from `object.range` + `object.size`, since R2's example code doesn't.
  - Return `206`.
  - Answer `HEAD` with `Content-Length` and `Accept-Ranges: bytes`, and a ranged `HEAD` with the 206 headers the ranged GET would get: DuckDB-Wasm sizes files with `HEAD` + `Range: bytes=0-` and needs the 206 (M3).
  - Add COOP/COEP (or `Cross-Origin-Resource-Policy: same-origin`) to these responses too.
  - Set `Cache-Control: public, max-age=31536000, immutable` on content-hashed files. The data files keep stable names for now and go out as `no-cache, no-transform`; M8 decides on hashed names.
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
| 2026-09-23 | `opt-level = "z"`: "s" is 8.6% bigger (2842 vs 2618 KiB br) and slower (291.5 vs 284.6 ms ref, 3963 vs 3741 ms throttled) | M1 `m1-opt-*` |
| 2026-09-23 | Graphics backend: GPUI `Auto` (WebGPU, WebGL2 fallback), replacing forced WebGL2. Chromium 173.5 vs 291.0 ms ref (−40%), 3460 vs 3765 ms throttled; WebKit 296 vs 412 ms; Firefox falls back at no cost | M1 `m1-backend-*` |
| 2026-09-23 | Preload the wasm and UI font from the HTML (`as=fetch crossorigin`): −10 ms ref, −188 ms throttled | M1 `m1-no-preload` |
| 2026-09-23 | UI font stays the full face: a Latin subset saves 42 KiB br and 21 ms throttled (0.6%) but drops Greek and Cyrillic, which dropped files may contain | M1 `m1-font-subset` |
| 2026-09-23 | Release logging stays on: 0.8 KiB br, no measurable TTFP, and it reports backend fallbacks and graphics failures | M1 `m1-no-release-logging` |
| 2026-09-23 | Reference run at a true DPR 2: the perf suite hides `devicePixelContentBoxSize` so gpui-pre-web uses its Safari sizing path | M1 |
| 2026-09-23 | First-frame mark: a microtask queued by the first render with a non-zero viewport (was: a rAF requested from the first render, a frame late on WebGPU). Verified every run by a GPU-call probe | M1 |
| 2026-09-23 | Perf and check runs serve `web/dist` brotli-compressed (quality 11, cached) through `vite preview` | M1 |
| 2026-09-23 | `@duckdb/duckdb-wasm` pinned to **1.32.0**, the newest stable release. npm's `latest` tag points at a dev build (1.33.1-dev57) | M2 |
| 2026-09-23 | Arrow IPC decoded by a **hand-rolled reader** (`crate/src/arrow.rs`), not arrow-rs: arrow-ipc + arrow-array + arrow-schema 60 with default features off cost +127.3 KiB brotli (+4.8%) more. Unsupported types decode as named placeholder columns | M2 `perf/results/2026-09-23-m2.md` |
| 2026-09-23 | **The engine loads on the first bridge call**, not through a fourth call. The post-paint callback sends the warm-up `SELECT 42 AS x`, which starts the load; its answer is checked in Rust before the UI says "Engine ready" | M2 |
| 2026-09-23 | DuckDB's own prebuilt worker, run inside a small blob: classic worker that turns unhandled rejections into worker errors. DuckDB-Wasm 1.32.0 never rejects `instantiate` when its worker fails, which hung the UI on "Engine loading…". No `duckdb.worker.ts` file: Vite's dev server serves worker entries as ES modules, which can't `importScripts` | M2 negative controls |
| 2026-09-23 | One DuckDB connection per query. Results come from the pending-query API (`startPendingQuery`/`pollPendingQuery`/`fetchQueryResults`) as raw IPC bytes, concatenated in JS; no Arrow decoding in JS. `cancel` aborts an `AbortSignal`, which calls `cancelPendingQuery` between poll slices | M2 |
| 2026-09-23 | Bundles: EH or MVP by DuckDB's `selectBundle` (every engine we test gets EH). The COI (threads) bundle isn't used | M2 |
| 2026-09-23 | Both DuckDB wasm bundles (32.7 / 37.5 MiB raw) are over Cloudflare's 25 MiB asset limit and go to R2 in M8. `just tycho build` names them (`asset-sizes.ts --r2`); any other oversize file still fails | M2 |
| 2026-09-23 | The bridge self-test ships in release behind `?selftest` (part of M2's +12.3 KiB), so it checks the build that's measured | M2 |
| 2026-09-23 | DuckDB extension autoload and autoinstall are **off**. Parquet isn't built into DuckDB-Wasm, and by default it would be fetched from extensions.duckdb.org on first use. M3 self-hosts it | M2 code review |
| 2026-09-23 | `registerFile(url)` first sends a one-byte range request and requires `206`: it rejects missing files, servers without range support, and SPA fallbacks (Vite answers unknown paths with `index.html`), and reads the real size from `Content-Range` (a compressed HEAD's `Content-Length` isn't the file size) | M2 code review |
| 2026-09-23 | Every engine call races the worker's `error` event, at load and after, so a worker that dies mid-query rejects that query instead of leaving it pending | M2 code review |
| 2026-09-24 | Data scripts in TypeScript (Node runs `.ts` directly), not Python: no second toolchain, and `tsc` checks them. `prep.sql` runs on `@duckdb/node-api`, pinned by the lockfile, instead of a Homebrew DuckDB CLI whose version nothing pins | M3 planning |
| 2026-09-24 | M3 serves data through `wrangler dev` in local mode (Miniflare R2); the Cloudflare account is first used in M8. Worker `tycho`, bucket `tycho-data`, binding `TYCHO_DATA` | M3 planning |
| 2026-09-24 | Dev and preview proxy `/data/*` to `wrangler dev`, so the page stays same-origin under COEP and keeps Vite's HMR and the M1 perf setup. The Worker's `/data` route falls through to static assets, so M8 adds config, not a rewrite | M3 planning |
| 2026-09-24 | Gaia's data step moves to M7, its first user; M3 builds only the asteroids and the CSV fixture | M3 planning |
| 2026-09-24 | DuckDB opens with `filesystem: { reliableHeadRequests: true, allowFullHTTPReads: false, forceFullHTTPReads: false }`. With 1.32.0's defaults it misreads its own `bytes=0-0` probe and downloads the whole file (all 35 MB to show a schema); with these settings it reads only the footer (34.8 KB) | M3 `perf/results/2026-09-24-m3.md` |
| 2026-09-24 | The Worker parses `Range` itself (single range; 416 for multi-range, past-the-end, or malformed) and answers a ranged `HEAD` with 206 | M3 |
| 2026-09-24 | The Parquet extension (EH + MVP, v1.4.3) is self-hosted from `web/public/duckdb-ext/`, fetched by `just tycho extensions` and checked against SHA-256 pins in `web/duckdb-extensions.json`. DuckDB's extension repository points at our origin; autoload stays on. Rust prefetches it with `LOAD parquet` right after the warm-up ("Parquet ready" in the overlay) | M3 |
| 2026-09-24 | The data credit and fetch date live in the Parquet file's key/value metadata (`tycho.credit`, `tycho.fetched`), read with `parquet_kv_metadata`: no extra request, no new bridge call | M3 |
| 2026-09-24 | Asteroid types: numbers as DOUBLE, `neo`/`pha` BOOLEAN, dates DATE. The 3,569 year-only `first_obs` values (0.23%) become NULL, counted in `MANIFEST.json` | M3 |
| 2026-09-24 | "Sample → schema" is timed to the presented frame: `shared/`'s after-present mark is now public (`seiza::mark_after_current_task(name)`) | M3 |
| 2026-09-24 | Missing DuckDB extensions are 404s (dev, preview; M8 Worker): autoload asks our origin for any extension a query needs, and an SPA fallback would hand it `index.html` | M3 code review |
| 2026-09-24 | The Worker retries an R2 range rejected with 10039 clamped to the object's size (416 only when the start is past the end); unit-tested against a strict fake R2, since Miniflare clamps | M3 code review |
| 2026-09-24 | `data/` isn't an npm workspace: native DuckDB installs only with `just tycho data`, from its own lockfile | M3 code review |
| 2026-09-24 | Playwright clicks canvas controls through bounds the app publishes to `globalThis.__tychoTargets` (`crate/src/targets.rs`); `/data` bytes are counted server-side, since Playwright doesn't see DuckDB's worker XHRs | M3 |
| 2026-09-25 | **Own table, not gpui-kit's `DataTable`:** its `uniform_list` positions rows in f32 pixels (4 px steps at 47 M px, 64 px at 25 M rows). `crate/src/table/` scrolls in f64 rows and owns its scrollbars, wheel, and keys; no column resizing, selection, or sorting | M4 |
| 2026-09-25 | Paging strategy **B** (`read_parquet(..., file_row_number = true)` filtered to the page): 49.6 ms and 1.39 MB for a jump to 90%, vs 60.5 ms (A, `LIMIT/OFFSET`, same bytes) and a 1.1 s, 37.7 MB ingest before any row (C) | M4 `perf/results/2026-09-25-m4.md` |
| 2026-09-25 | Samples written with **30,720-row groups** (was 122,880): fastest first/next/jump pages, 3.6× fewer bytes per jump, +6.3% file size. Smaller groups were slower and bigger. DuckDB-Wasm's readahead sets a 1.39 MB floor per page read, so "first rows < 2%" is out of reach for this file | M4 |
| 2026-09-25 | Pages of **1024 rows, prefetch 2** (twice ahead while scrolling), 3 queries in flight, **64 MiB** LRU page cache. The sweep didn't separate 256/1024/4096 × 1/2/4 beyond noise; 1024 divides the row groups | M4 sweep |
| 2026-09-25 | App memory cap **128 MiB** (wasm + live JS heap) after scrolling the whole sample: 16 MiB shell + 64 MiB cache + allocator slack | M4 |
| 2026-09-25 | Cancelled page queries count against the 3-in-flight limit until DuckDB answers them (it keeps reading a started page); failed pages retry once scrolled away and back; prefetch leans ahead only while the rows move (250 ms) | M4 code review |
| 2026-09-25 | A scrollbar drag loads pages only once the pointer rests 80 ms, or on release: a started page read can't be cancelled (DuckDB's worker uses sync XHRs), and a stale one delayed the jump's target (throttled 4.3 → 2.2 s) | M4 |
| 2026-09-25 | One `LOAD parquet` at a time (`Engine::load_parquet`): the prefetch and every file open share one attempt, a success is remembered, a failure lets the next caller retry. **Extension autoload is now off** (superseding M3's "autoload stays on"): `LOAD` is the only way an extension loads, and a query needing an unloaded one fails with a clear error. Two failing loads of one extension at once crash DuckDB-Wasm 1.32.0 without a worker error | M4 (M3 retry check, two code reviews) |
| 2026-09-25 | The overlay's common rows (`shared/`): "Frame time (2 s)" (p50/p95/max of rAF intervals) and "Memory" (app wasm, JS heap), sampled only while the overlay is visible, starting after first paint | M4 |
| 2026-09-25 | `?bench` exposes the bridge to the perf scripts as `globalThis.__tychoBridge`; `?page=`, `?prefetch=`, `?budget_mib=` override paging | M4 |
| 2026-09-25 | M7's overlay becomes a user-facing **observation panel**: live load waterfall, bytes read vs file size, and while scrolling rows/s, pages in flight, cache hits, memory, and a sparkline of both rAF interval and per-frame work time. It refreshes at ~4 Hz; the fling budget is checked with it open and closed | M7 planning |
| 2026-09-25 | **Jump to row** is navigation, not analysis, so it's inside v1 scope (Tycho rule 4). It's the first text input | M7 planning |
| 2026-09-25 | The React comparison, if built, is a **replay mode** (the same scripted run on each side in turn), not a live race in one tab, where both sides would share a main thread and GPU. Research first; see Long-term goals | planning |
| 2026-09-27 | Drops and the file dialog are Rust (`crate/src/files.rs`, web-sys): a `window` listener, since gpui-pre-web 0.3.5 swallows `drop` on its canvas, and a hidden `<input type=file>` clicked from a GPUI click handler. No new bridge call | M5 |
| 2026-09-27 | A chosen file is sniffed (`PAR1` at both ends) before the engine sees it; a refused file leaves the current one open and shows why inline | M5 |
| 2026-09-27 | Each open registers under its own SQL name (`file-<n>.parquet`), never the file's (a glob to `read_parquet`); a new open drops the old one's task, cancels its queries, and closes its table. Registered handles stay (unregistering is a fourth bridge call; a handle holds no bytes) | M5 |
| 2026-09-27 | `SET GLOBAL parquet_metadata_cache = true` after `LOAD parquet`: each footer is parsed once, not by every query (~165 ms each at 1,378 row groups). `GLOBAL` because each query has its own connection | M5 `perf/results/2026-09-27-m5.md` |
| 2026-09-27 | **Visible pages first:** no prefetch page starts while a visible page isn't loaded. DuckDB-Wasm round-robins query slices, so prefetch in flight delayed the visible page (1 GB first rows 2.7 s → 0.8 s with the cache fix; jump to 90% 133 → 92 ms) | M5 |
| 2026-09-27 | M5 memory check: app memory within 16 MiB between the 100 MB and 1 GB files; every agent within 10% of their size difference, since it swings ~20 MiB between snapshots of one file. Set after the first runs; a held-copy negative control proves it catches a copy | M5 |
| 2026-09-30 | **Chunked ingest, not raw-file queries**, for CSV. Raw `read_csv` pages re-parse from the top: a page at 90% of the 1 GB CSV took 5.1 s and `count(*)` 3.3 s. Chunked: first rows in ~0.2 s, the count grows, a page at 90% reads in ~4 ms | M6 `perf/results/2026-09-30-m6.md` |
| 2026-09-30 | **One table per chunk** (`CREATE TABLE … AS`), not appends to one table. Appends stalled 200–600 ms every few chunks inside DuckDB and grew memory with the chunk count; per-chunk tables never passed ~255 ms. Pages spanning two chunks read both with `UNION ALL` | M6 |
| 2026-09-30 | Chunk tables live in `ATTACH ':memory:' AS tycho_csv (COMPRESS)`: 300 MiB of DuckDB memory for the 1 GB CSV, against 2.1 GiB uncompressed, for ~40% slower chunks. One schema per open, so `DROP SCHEMA … CASCADE` frees a replaced CSV | M6 |
| 2026-09-30 | `read_csv` with `auto_detect = false` and every option from one `sniff_csv` of the first chunk (1 MiB): sniffing each chunk cost ~20 ms of ~55. RFC 4180 quoting is forced (the sniffer sees no quotes in the head and picks none); a conversion error widens that column to VARCHAR and retries the chunk | M6 |
| 2026-09-30 | Chunks aim at 200 ms (1 MiB first, then 1–8 MiB, smoothed): the count updates between chunks, and a page read waits for the chunk in progress. Record boundaries are found in Rust (quote-aware), 1 MiB per read; the next chunk's end is found while DuckDB reads the current one. Chunks are `File` slices through `registerFile`: no new bridge call | M6 |
| 2026-09-30 | A replaced CSV's load task stops, cancels its query, and drops its schema only after that query answers (a table mid-creation can't be dropped under it); a CSV that's done or stopped has its schema dropped by the workbench on close | M6, code review |
| 2026-09-30 | Chunk tables are paged by `rowid`, except when the file has a `rowid` column (it hides DuckDB's): then each table numbers its rows with `row_number() OVER ()`, which streams in order but cost ~2.6× natively, so only those files pay it | M6 code review |
| 2026-09-30 | A quote opens a field only at the field's start, in the scanner as in DuckDB; RFC 4180's quote is forced unless the sniffer found an unquoted TSV | M6 code review |
| 2026-10-07 | gpui-kit 0.6.4 → **0.7.1**, `Cargo.lock` re-seeded from its published lock (gpui-pre 0.3.8, wasm-bindgen still 0.2.121). `shared/` uses `gpui_kit::open_window`; 0.7's `Root` hosts the overlay layers. +31.2 KiB brotli, TTFP unchanged (interleaved A/B) | `perf/results/2026-10-07-gpui-kit-0.7.1.md` |
| 2026-10-07 | DuckDB's reads are counted inside its worker: `startWorker`'s wrapper wraps `XMLHttpRequest` (GET bodies) and `FileReaderSync` (slices of a dropped `File`) and adds them to a per-file `SharedArrayBuffer` counter. The counter rides on `registerFile`'s `FileInfo` (`bytesRead`), and Rust reads it with `Atomics.load`, so **no fourth bridge call**. SQL can't see the bytes: DuckDB-Wasm's own file statistics are a JS API (a fourth call), and its readahead happens below DuckDB's reads | M7 part A |
| 2026-10-07 | The perf panel is a cached GPUI view refreshed at 4 Hz: fling frames replay its drawing. Work per frame is timed from the shell's render to a microtask queued there, which runs after GPUI's draw-and-present callback; the sparkline is drawn with quads, not paths (paths would link lyon into every app) | M7 part A |
| 2026-10-07 | The table reports its first rows with an event (`TableEvent::FirstRows`) and its paging and scrolling through `RowTable::stats`; the workbench decides what the panel shows (the open-questions note). Rows/s and cache hits cover the panel's 2 s window; a cache hit is a drawn frame with every visible row loaded | M7 part A |
| 2026-10-07 | Gaia comes from the HATS Parquet on AWS with native DuckDB, one extract per partition kept in `data/raw/gaia/` at G < 15. The magnitude filter can't prune (partitions are sorted by sky position), so the first fetch reads ~90 GB; the extracts make every later build local | M7 part B |
| 2026-10-07 | Gaia's cut is **G < 14.5**: 25,067,889 stars, PLAN's ~25 M target. Prep checks the count against the ESA archive (TAP `COUNT(*)`, asked once and kept), and drops 17,842 identical duplicate rows in two HATS partitions with `DISTINCT` | M7 part B |
| 2026-10-07 | Gaia's row groups are **61,440 rows** (409 groups), not the asteroids' 30,720. A page read costs 5.59 MB at both (DuckDB-Wasm's readahead runs 16 K/64 K/256 K/1 M/4 M; the 3.8 MB group fits the 4 MB step) and 22.4 MB from 122,880 (the 16 MB step). The page's per-group setup halves: next page 67.5 vs 165.8 ms, jump to 90% 103.1 vs 193.1 ms (medians of 5) | M7 part B `perf/results/2026-10-07-m7-gaia.md` |
| 2026-10-07 | **No cell-string cache.** Formatting every visible cell takes 0.075 ms p50 of a 13.1 ms draw on Gaia (0.045 of 11.8 on the asteroids), timed alone in an instrumented build. Gaia's cells hold 2.4× the characters and cost +11% work per draw | M7 part B |
| 2026-10-07 | Pages stay **1024 rows × prefetch 2** on Gaia too. Re-run with work per frame, the sweep still barely separates: steady work 11.9 ms at 256-row pages vs 12.5 at 1024, first rows and jumps within noise, no placeholders in any steady scroll | M7 part B `perf/results/2026-10-08-m7-sweep-gaia.json` |
| 2026-10-07 | The ESA credit rides in the Gaia file's key/value metadata (`tycho.credit`), like the asteroids', and shows in the header strip; no fetch date (DR3 is a fixed release), so it reads as ESA's sentence word for word | M7 part B |
| 2026-10-08 | Jump to row is **gpui-base's unstyled single-line `Input`** (`gpui_kit::base::input::Input`), styled in `workbench.rs`, with the right-click menu (Cut, Copy, Paste, Select All) built there through `InputState::on_context_menu`. Not gpui-kit's `Input`: it renders any of three input states, so it linked the textarea and code-editor engines too, +194.1 KiB brotli and +199.7 ms throttled TTFP, against +88.0 KiB and +101.0 ms for the base input (interleaved A/Bs). The field sits in the header strip's top row, clear of the panel. Enter puts the row at the table's top (clamped at the end), highlights it, and hands the table focus; anything else refuses inline and doesn't scroll. Rows count from 1, as the gutter shows; full-width digits and `,` `_` space separators are accepted (`jump.rs`). Cmd/Ctrl+G focuses it (the browser's find-next has nothing to find on a canvas) | M7 part C `perf/results/2026-10-08-m7-jump.md` |
| 2026-10-08 | The workbench tracks focus on its root and restores lost focus there (`cx.on_focus_lost` + `focus_lost_restore_target`), so its key context survives the table going away. The root cancels its own focus-on-press (`on_any_mouse_down` → `prevent_default`, which runs before it), or a press on the header strip took the table's keys (code review; `jump.ts` checks it, failing without the fix). With no file open, Cmd/Ctrl+G propagates to the browser | M7 part C, code review |
| 2026-10-08 | Jump-to-row separators only between thousands groups (1–3 digits, then threes): `1,5`, `1,0`, `12 34` are refused, not read as rows 15, 10, 1234 | M7 part C, code review |
| 2026-10-08 | `shared/` binds gpui-base's macOS input shortcuts in Mac browsers (`navigator.platform`), where its `cfg(target_os = "macos")` never holds on wasm: Cmd+A/C/X/Z, Cmd+arrows with and without Shift, Opt+arrows with and without Shift, Cmd/Opt+Backspace and Delete. Not elsewhere: Alt+←/→ is Back/Forward. Not Cmd+V: unbound, it reaches the browser's permission-free paste event. Cmd+A/C/X are bound before `gpui_kit::init`, so the menu keeps labelling the Ctrl keys (the latest binding labels an action; wasm spells Cmd "Win"); the rest after, to outrank the wasm build's Shift+Alt+←/→ | M7 part C, code review |
| 2026-10-08 | The open panel publishes its bounds (`__seizaPerfOverlayRect`) so scripts can check a target is clear of it | M7 part C |
| 2026-10-08 | **Engine failures retry, not reload.** A failed load and a worker that stops after loading both show in the empty state with Retry, which starts a new worker. The bridge forgets a failed load at once, and a stopped engine once a call has been rejected with `EngineStopped`; Rust's `Engine` refuses calls while it's down, so only Retry's warm-up starts the new one (a stray page read did, unseen, before). A stopped worker closes the open file; the app learns at its next call. No fourth bridge call | M7 part D |
| 2026-10-08 | **Size limits:** Parquet up to 10 GB (flat memory to 9.6 GB measured; time grows with row groups), CSV up to 6 GB at the drop and 1.5 GiB of DuckDB memory during the load (`csv::MEMORY_BUDGET`, checked after every chunk with one `duckdb_memory()` query; a chunk of bytes that yields no rows also stops it). DuckDB-Wasm 1.32.0 stores empty tables without an error past ~2.1 GiB, below its 3.1 GiB `memory_limit`. Refusals happen before anything is read, and leave an open file open | M7 part D `perf/results/2026-10-08-m7-hardening.md` |
| 2026-10-08 | **A failed Parquet page read re-registers the file under a new SQL name** (`<name>-r<n>.parquet`) and the table reads from it (`TableEvent::ReadFailed`, `RowTable::read_from`). After a failed HTTP range read, every later read of those bytes under the old name fails ("TProtocolException"), online, after re-registering the same name, and with `enable_external_file_cache` off. Tries wait 5 s, doubling to 60 s, so a file that keeps failing can't loop; a failed registration (still offline) tries again after its wait, so rows in view recover with no input (5.1 s in the check). The read counter carries on across registrations | M7 part D |
| 2026-10-08 | **Files stay registered; footers are a documented cost.** `db.dropFile` and toggling `parquet_metadata_cache` free nothing (44.2 MiB in DuckDB after 20 opens of a 1,378-group file, every variant). `registerFile` and Tycho rule 2 keep their wording | M7 part D |
| 2026-10-08 | **No in-flight tracking in `Engine`.** Built (`Engine::idle`, a new open waiting for the last one's cancelled reads) and measured against a build without it: same "Read", same first rows (1236 ms). DuckDB's worker runs messages in order, and every poll of a cancelled query is queued before the next open's counter and register messages, so its reads land on the old counter. That's also why part A's read-counter key collision can't happen. Removed | M7 part D |
| 2026-10-08 | The CSV scanner's window stays 1 MiB: at 256 and 64 KiB the throttled fling during a load was the same (interval p95 50 ms, work p95 ~50 ms, 4–5 long tasks of ~55 ms, which are frames) and the load slower (+9%, +57%) | M7 part D |
| 2026-10-08 | Code review fixes: every bridge call's answer is watched for `EngineStopped` even when nobody awaits it (an open replaced mid-flight drops its futures); a failed engine-chunk import is retried under `?retry=<n>` (Chromium remembers failed dynamic imports); re-registration only for read failures (`EngineError::is_read_failure`) on the shown table; an empty chunk is out of memory only above 1 GiB; `?scan_kib=` removed. Declined: batching the per-chunk memory query (no measurable cost) | M7 part D, code review |
| 2026-10-08 | The observation panel keeps clear of edge controls an app names (`seiza::perf::set_clearance`; Tycho: its padding, border, scrollbar, and a gap) rather than moving or docking | M7 part D |
| 2026-10-08 | **`just tycho perf` is the full suite** (`perf/suite.ts`): cold load, the panel check, the table on both samples, jump to row, and the ~1 GB CSV, each script in its own child process, into one results file with a headline per part and the load average. The cold load alone is `just tycho cold`; `check` still runs only the cold load. ~1 h 45 min | M7 part E |
| 2026-10-08 | **One copy of the clock and marks: `seiza::marks`** (`now`, `mark`, `mark_at`, `mark_time`, `mark_after_current_task`). Readers take the last entry, since a retry sets marks again. +0.6 KiB brotli after the review (one `performance.mark` call, `startTime` off the returned entry) | M7 part E |
| 2026-10-08 | **Static placeholder shell: yes, built as M7 part G.** Interleaved A/B with a prototype: it paints at 234.5 ms throttled (66.5 ms reference; Element Timing on its heading) against TTFP 3696.9 ms (193.7), and TTFP stays within noise (3668.5, 193.3). TTFP keeps meaning GPUI's first frame; the placeholder's paint is its own metric. Its costs (a second copy of the shell to keep matched, the font, a DOM layer in the demo) are part G's checks | M7 part E `perf/results/2026-10-08-m7-close-out.md` |
| 2026-10-08 | The panel check brackets wasm memory between reads just before and just after the refresh it compares, a range check (± 5%): a read 250 ms later, while pages arrived on a throttled run, failed 2 of 10 runs on the check's timing | M7 part E, code review |
| 2026-10-08 | Code review fixes (part E): each part's script writes its `failures` and the suite reads them there (csv.ts printed a different format, and its failures were lost); `--update` needs `--only`; the suite decodes stderr as a UTF-8 stream; the committed results keep summaries, per-run lists stay in `raw/` (394 → 29 KB); the placeholder A/B times the placeholder with Element Timing, not FCP (the protocol rules FCP out), and fails if the placeholder wasn't injected or didn't paint before the first frame | M7 part E, code review |

### Pending decisions

- [x] `opt-level` `"z"` vs `"s"` (M1): "z"
- [x] Graphics backend: forced WebGL2 vs `Auto` (WebGPU first), by cold-start TTFP (M1): `Auto`
- [x] UI font subsetting vs the full 196 KiB face (M1): full face
- [x] Release logging and panic hook (M1): logging stays in release; the panic hook stays debug-only
- [x] **Reference-run DPR (M1):** true DPR 2 in headless Chromium by hiding `devicePixelContentBoxSize` in the perf suite (see decisions log)
- [x] Arrow IPC decoder approach (M2): hand-rolled reader
- [x] Paging strategy A/B/C (M4): B, a `file_row_number` filter
- [x] Row-group size for the samples (M4): 30,720
- [ ] Data file names: stable + `no-cache`, or content-hashed + `immutable` (M8)
- [x] Page size and prefetch depth (M4): 1024 rows × 2 pages
- [x] Memory cap for page cache (M4): 64 MiB cache; 128 MiB app (wasm + JS heap)
- [x] Chunked CSV ingest vs raw-file queries (M6): chunked, one compressed table per chunk
- [x] Gaia magnitude cut / final row target (M7): G < 14.5, 25,067,889 stars
- [x] Static placeholder shell painted before the wasm, decided by the throttled run; TTFP stays GPUI's first frame (M7 part E): **yes**, 234.5 vs 3696.9 ms throttled, no TTFP cost; built in part G
- [x] Engine failed to load: retry or reload-only (M7 part D): Retry, for a failed load and a stopped worker
- [x] Parsed-footer pile-up (M7 part D): nothing frees them; a documented cost, files stay registered
- [x] Jump-to-row input (M7 part C): gpui-base's single-line `Input`, +88.0 KiB brotli, not gpui-kit's (+194.1 KiB)
- [x] **Part C's TTFP cost (M7 part C, 2026-10-08): accepted.** +3.4 ms reference and +101.0 ms throttled (interleaved A/B), for an input that IME, paste, and keyboard users can rely on. `check` read 196.5 ms against the 195.0 limit, but HEAD read 194.9 right after: the gate fires on noise because the September baseline (177.3 ms) predates the machine's current load, not because of part C. 195.0 stays the target
- [ ] **Re-record the TTFP baseline** in a quiet session (`perf.ts --write-baseline`), so the 10% margin is measured on today's machine. Until then `check` can fail on noise near 195 ms; compare against HEAD with an interleaved A/B before calling a regression
- [x] **Win back part C's throttled +101 ms** (part E): not in TTFP, which the placeholder leaves unchanged; a visitor on Fast 4G sees the shell 3.46 s sooner instead (part G builds it)
- [ ] Production wasm encoding, br vs zstd (M8)
- [ ] React comparison mode: build the side-by-side page or not, after research (after M8; see Long-term goals)

---

## Measurements

Filled in as milestones close. Raw results live in `perf/results/`.

| Metric | Budget | M1 baseline | Latest |
|---|---|---|---|
| TTFP (reference, median of 10) | ≤ +10% vs baseline | 177.3 ms | 191.8 ms (gpui-kit 0.7.1 protocol run, +8.2%, machine load ~4; 186.5 ms in its `check`, +5.2%); 173.3 ms in M6's final `check` (−2.2%); M7 A interleaved A/B: 195.5 ms vs master 195.8 under load 6–7; **M7 C `check`: 196.5 ms, over the 195.0 limit; HEAD 194.9 right after** (load 4–7; part C's +3.4 ms accepted, re-baseline pending); M7 D `check`: 193.1 ms, PASS (load 4–6); after the review fixes 203.2 ms FAIL under load 6, but an interleaved A/B read 193 vs HEAD 203 ms under load 8–16 (the machine); M7 E suite 201.8 ms (load 7.5 at its start), `check` 201.6 FAIL, but an interleaved A/B read 199.8 vs HEAD 197.1 ms (n=20, load 3.4–5.3): the machine |
| TTFP (throttled) | recorded only | 3465.2 ms | 3703.3 ms (M7 E suite; A/B 3713.0 vs HEAD 3720.9); 3565.1 ms (gpui-kit 0.7.1, +2.9%; 0.6.4 rebuilt in the same session: 3536.5 ms) |
| TTFP, gpui-kit 0.7.1 interleaved A/B (20 runs each) | — | 191.4 ms (0.6.4 rebuilt) | 190.0 ms (−0.7%) |
| TTFP, M7 E interleaved A/B (20 ref / 10 throttled each) | — | 197.1 / 3720.9 ms (HEAD 20bae8a) | 199.8 / 3713.0 ms (+2.7 / −7.9; `seiza::marks`) |
| TTFP, M7 C interleaved A/B (20 ref / 10 throttled each) | — | 192.6 / 3590.6 ms (HEAD 5545fdf) | 196.0 / 3691.6 ms (+3.4 / +101.0; gpui-kit's `Input`, rejected: +9.5 / +199.7) |
| TTFP, M3 interleaved A/B (20 runs each) | — | 186.2 ms (M2 rebuilt) | 186.9 ms (+0.4%) |
| TTFP, M2 interleaved A/B (20 runs each) | — | 170.0 ms (M1 rebuilt) | 173.8 ms (+2.2%) |
| App wasm (brotli) | ≤ +15% without note | 2619.5 KiB | 2805.0 KiB (M7 E after review, +0.6: `seiza::marks`; the suite ran at 2806.2); 2804.4 KiB (M7 D after review, +5.2 KiB; 2799.3 in M7 C, +86.0 KiB: gpui-base's single-line `Input`; 2711.2 in M7 A) |
| Engine ready (reference / throttled) | recorded only | — | 688.8 / 9977.5 ms (M7 E suite); 621.5 / 9719.4 ms (M4; 726.1 / 9821.8 in M3, load differs) |
| `SELECT 42` round trip, engine warm | recorded only | — | 3.0 ms (M2) |
| Cancel → query stopped | ≤ 200 ms | — | 4.7 ms median, 10.0 max (M2) |
| Sample click → schema | ≤ 300 ms | — | 97.3 ms ref, 1063.3 ms throttled (M5; 107.6 in M4, 87.8 in M3) |
| Bytes before schema shown | < 2% of file | — | 90,824 B, 0.241% (M4; 34,759 B in M3) |
| Parquet extension (EH, brotli) | recorded only | — | 487.2 KiB, after engine ready (M3) |
| File → first rows | ≤ 500 ms | — | 201.8 ms ref, 3449.1 ms throttled (M7 E suite); 235.7 ms ref, 3359.7 ms throttled (M5; 239.2 in M4) |
| Fling p95 frame time | ≤ 20 ms, none > 50 ms | — | 16.7 ms p95 in every run, worst 33.3 ms (M7 E suite, asteroids and Gaia); 16.7 ms p95, worst 33.3 ms (M4) |
| Fling p95 frame time, panel open | ≤ 20 ms, none > 50 ms | — | 16.7 / 16.7 ms open and closed (M7 E suite); 16.7 ms p95, worst 16.7 ms; closed in the same runs: 16.7 / 16.7 (M7 A) |
| Per-frame work time, fling p50/p95 (asteroids, ref / throttled) | recorded only | — | 6.1 / 8.2 ms ref, 24.5 / 33.3 throttled (M7 E suite); 5.2 / 7.3 ms ref, 21.0 / 26.4 ms throttled; panel open 5.9 / 8.1, 23.8 / 29.8 (M7 A) |
| Per-frame work time, steady scroll p50/p95 (asteroids, ref / throttled) | recorded only | — | 12.5 / 15.7 ms ref, 27.9 / 40.0 throttled (M7 E suite); 12.7 / 15.1 ms ref, 36.9 / 42.8 ms throttled (M7 A) |
| Per-frame work time, fling p50/p95 (Gaia, ref / throttled) | recorded only | — | 6.0 / 8.1 ms ref, 22.2 / 31.1 throttled (M7 E suite); 5.7 / 7.9 ms ref, 21.7 / 28.7 ms throttled (M7 B) |
| Per-frame work time, steady scroll p50/p95 (Gaia, ref / throttled) | recorded only | — | 13.1 / 15.5 ms ref, 22.0 / 28.2 throttled (M7 E suite); 12.6 / 14.7 ms ref, 21.3 / 26.7 ms throttled (M7 B) |
| Gaia (25.1 M rows): first rows, jump to 90%, fling p95 / max | ≤ 500 ms, ≤ 400 ms, ≤ 20 / 50 ms | — | 295.7 ms, 135.7 ms, 16.7 / 33.3 ms ref; 8477.3, 6573.1 ms throttled (M7 E suite); 290.6 ms, 136.8 ms, 16.7 / 16.7 ms ref; 8470.6 ms, 6584.5 ms, 16.7 / 33.3 throttled (M7 B) |
| Gaia app memory after two full passes | ≤ 128 MiB | — | 71.2 MiB (wasm 66.6 + JS 4.6); every agent 523.8 MiB (M7 B) |
| Gaia page read (61,440-row groups): bytes, next page, jump to 90% | recorded only | — | 5.59 MB, 67.5 ms, 103.1 ms (M7 B, raw bridge queries) |
| Jump to row (first, middle, last, out of range) | lands on the row | — | all land / refuse; Enter → rows 82.3 / 68.9 ms (asteroids middle / last), 150.3 / 150.4 (Gaia), ref (M7 E suite); all land / refuse, Chromium ×20 per sample, Firefox, WebKit; Enter → rows 79.4 / 68.7 ms (asteroids middle / last), 153.2 / 151.1 ms (Gaia), ref; 2177.9 / 517.9 and 6569.0 / 4874.9 ms throttled (M7 C) |
| Jump to 90% | ≤ 400 ms | — | 82.6 ms ref, 2208.6 ms throttled (M7 E suite); 91.6 ms ref, 2166.3 ms throttled (M5, visible pages first; 133.0 in M4) |
| App memory after two full passes | ≤ 128 MiB | — | 91.2 MiB (M5; 89.4 in M4) |
| Drop Parquet (~1 GB) → first rows | ≤ 1 s | — | 796.0 ms ref, 864.5 ms throttled; schema 213.6 / 254.1 ms (M5, 1,378 row groups) |
| Drop CSV (~1 GB) → first rows | ≤ 1 s | — | 205.2 ms ref, 404.9 throttled; schema 158.9 / 239.7 (M7 E suite); 183.8 ms ref, 342.9 ms throttled; schema 143.0 / 193.7 ms (M6, 1,021.7 MiB) |
| CSV row-count update interval | ≤ 500 ms | — | worst 300.0 ms ref, 486.9 throttled (M7 E suite); worst 202.4 ms ref (median gap 102.8), worst 455.1 ms throttled (M6) |
| CSV ingest throughput | recorded only | — | 65.3 MB/s, 16.4 s ref; 47.0 MB/s, 22.8 s throttled (M7 E suite); 69.5 MB/s, 15.4 s for 1,021.7 MiB ref; 50.5 MB/s, 21.2 s throttled (M6) |
| Fling p95 frame time during CSV ingest | ≤ 20 ms, none > 50 ms | — | 16.7 / 33.3 ms ref; 50.0 / 66.7 throttled (M7 E suite); 16.7 ms p95, worst 16.7 ms ref; 33.3 ms p95, worst 66.7 ms throttled (M6) |
| DuckDB + every agent memory, 1 GB CSV loaded | recorded only | — | ~300 MiB DuckDB; 589.5 MiB every agent (M6) |
| Peak memory, 100 MB vs 1 GB Parquet | roughly flat | — | app 17.6 vs 17.5 MiB; every agent 135.1 vs 129.2 MiB (M5) |
| Size ceiling, Parquet: first rows / DuckDB memory | recorded only (limit 10 GB) | — | 2.1 GB 443 ms / 1.4 MiB; 4.6 GB 1053 ms / 2.8 MiB; 9.6 GB (3,445 row groups) 3500 ms / 5.6 MiB (M7 D) |
| Size ceiling, CSV: DuckDB memory per file byte | limit 6 GB, 1.5 GiB in memory | — | 0.28 (asteroids; 5.36 GB → 1508 MiB, loads whole), 0.47 (random hex; 4.6 GB stops at 69%); past ~2.1 GiB DuckDB-Wasm drops rows silently (M7 D) |
| Parsed footers, 20 opens of a 1,378-group file | recorded only | — | DuckDB +2.2 MiB per open (44.2 MiB), every agent ~+16 MiB per open; unregistering frees nothing (M7 D) |
| Fling during a CSV load, throttled, by scanner window 1024/256/64 KiB | recorded only | — | interval p95 50 / 50 / 50 ms, work p95 49.7 / 50.6 / 49.3 ms; after the load 33.3 ms, work p95 38.5 (M7 D) |
| Error states (`just tycho errors`) | each recovers | — | engine didn't load (DuckDB's wasm, or the engine chunk) → Retry; engine stopped → Retry, no stray start; sample offline; page reads recover by themselves 5.1 s after the network; files over the limits refused; panel clear of the scrollbars (M7 D) |
| Observation panel vs independent measurements | all within 5% | — | 340/340 values, reference + throttled; wasm memory is a range check since part E (M7 E suite; 340/340 in M7 A) |
| Static placeholder shell (prototype): its paint vs TTFP | recorded only | — | 66.5 vs 193.3 ms ref, 234.5 vs 3668.5 ms throttled (Element Timing); HEAD's TTFP 193.7 / 3696.9 (M7 E A/B) |

---

## Open questions / notes

- **Possible later extraction of the table and engine as a standalone GPUI component.** Undecided; revisit after M8. Until then, `table/` and `engine/` report what happened through events, and the workbench decides what to display; they don't call `seiza::perf` directly.

(`docs/LESSONS.md` came off probation after M4: several of its surprises became decisions.)
