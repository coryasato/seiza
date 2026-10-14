# PLAN.md — Tycho

What's next for Tycho: milestone status, the active milestone's "done when" checks, long-term goals, and open questions. Only what's still open lives here. Context and rules are in `CLAUDE.md` here and at the repo root.

**Goal:** a local-first data workbench in the browser (DuckDB-Wasm + GPUI Kit on WebGPU, WebGL2 fallback) that people use as a real tool: a utility app (root `CLAUDE.md`, "Tiers"), with a number on screen for every claim. Its table and DuckDB layer become the repo's first component and engine, and the observatory compares that component with React ([`../observatory/PLAN.md`](../observatory/PLAN.md)).

**Deciding metric:** time to first paint (TTFP), measured as `performance.mark("gpui:first-frame")`.

**Where everything else lives:**
- [`docs/milestones.md`](docs/milestones.md): the specs, checks, and evidence of finished milestones (history; not edited).
- [`docs/DECISIONS.md`](docs/DECISIONS.md): every decision, by area, with its numbers. Repo-wide ones: the root [`docs/DECISIONS.md`](../../docs/DECISIONS.md).
- [`docs/LESSONS.md`](docs/LESSONS.md): what each milestone taught us.
- [`docs/data.md`](docs/data.md), [`docs/hosting.md`](docs/hosting.md): the samples and the Cloudflare setup.
- [`perf/budgets.json`](perf/budgets.json) and [`perf/results/`](perf/results/): every budget, and every measurement, dated.

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
| M7 | Observation panel, jump to row, and hardening (parts A–G) | Done 2026-10-09 |
| M8 | Deploy to Cloudflare | Done 2026-10-10: https://tycho.seiza.io |
| M9 | Extract the table component and the DuckDB engine | Active |
| Later | Table features: column resizing, selection, sorting | Not started; research first |
| Later | Production performance: servers, edge, and data layout | Not started; research first, in its own session |

The side-by-side comparison with React moved to the observatory ([`../observatory/PLAN.md`](../observatory/PLAN.md)); it needs this milestone's component and engine first.

**Closing a milestone:** every "done when" check passes; the numbers are in `perf/results/` (a dated JSON per run and a note, from [`docs/templates/app/perf/results-note.md`](../../docs/templates/app/perf/results-note.md)); new decisions are in `docs/DECISIONS.md`; a `docs/LESSONS.md` entry is written; `just tycho report` has refreshed the generated numbers; and the milestone's spec and evidence move from here to the end of `docs/milestones.md`, leaving one row above.

---

## Active milestone

### M9: Extract the table component and the DuckDB engine

Tycho's table becomes `components/table/` (crate `seiza-table`) and its DuckDB layer becomes `engines/duckdb/` (crate `seiza-duckdb` and npm package `@seiza/duckdb`), as root `docs/DECISIONS.md`, "Repo structure", decided. The observatory's GPUI contender will be their second consumer, so it runs Tycho's code, not a copy. **No behavior change:** Tycho looks, measures, and deploys as before. Do the parts in order and keep every check passing between them.

**Part A: the perf harness to `shared-web/perf/`.** The pieces of `perf/common.ts` and `perf/harness.ts` that know no app move there: throttle profiles and the DPR shim, run summaries and labels, `limits()` (taking the app's `budgets.json`), `wheel()`, `waitMark`, the frame and work recorders, `percentiles`, `fling`, the counting proxy, and `serveApp`. Target clicks read `__seizaTargets` (renamed from `__tychoTargets`, in `crate/src/targets.rs` and every script), so every app and contender publishes targets the same way. Tycho-only helpers (`dropFile`, the `__tychoTable` probe, panel helpers that read Tycho rows) stay in `perf/`.

**Part B: the engine to `engines/duckdb/`.**
- `web/`: `engine.ts` and `bridge.ts` become `@seiza/duckdb` (an npm workspace), with `duckdb-extensions.json` and `scripts/extensions.ts`, and a Vite plugin for what Tycho's config does for DuckDB today (`extensionMisses`), so any host serves DuckDB the same way. Tycho's `web/` imports it.
- `crate/`: `crate/src/engine/` and `crate/src/arrow.rs` become `seiza-duckdb`. Its `seiza::perf::set_load_step` and `seiza::marks` calls become events (engine ready, Parquet ready, and their times) that Tycho's workbench turns into load steps and marks.
- Docs: the bridge rule (Tycho rule 2), the DuckDB-Wasm gotchas, and the "Engine and bridge" decisions move to the engine's `CLAUDE.md`, `README.md`, and `docs/DECISIONS.md` (from `docs/templates/component/`); Tycho's files keep pointers.

*Part B done 2026-10-13:* every part-end check passed; TTFP −0.2% / +0.15% (reference / throttled) against the pre-M9 build in an interleaved A/B, app wasm +2.2 KiB brotli (+0.08%), and the suite's asteroids and CSV numbers match part A's ([`perf/results/2026-10-13-m9-b.md`](perf/results/2026-10-13-m9-b.md)). The engine reports through `EngineEvent`s, and its JS marks are `duckdb:engine-start` and `duckdb:engine-ready`.

**Part C: the table to `components/table/`.**
- `crate/src/table/` (scroll model, page cache, view, format, activity) becomes `seiza-table`, with a `RowSource` delegate in place of `crate::arrow` and `crate::dataset` types: columns, row count, and pages of the component's own values. GPUI Kit's `TableDelegate` is the model; read the gpui-kit skill's Coding Guides (public API, naming, state ownership) before designing it.
- Its `seiza` calls leave: `seiza::url::param` paging overrides become a `Paging` the host passes in; `seiza::perf::is_visible` and `WINDOW_MS` become settings the host passes; the first-rows and viewport-filled marks become events the host marks (see Open questions for marks that must sit in render).
- The Parquet source (`dataset::page_sql` and the file summary) becomes `seiza-duckdb`'s `table` feature. The CSV source stays in Tycho, wrapping it.
- Docs: the table paragraph of Tycho's `CLAUDE.md` and the "Table and paging" decisions move to the component's files; the component's `README.md` holds its API, its (no) features, and the canvas tradeoffs that are the table's.

*Part C done 2026-10-13:* every part-end check passed; TTFP +0.9% / +0.03% (reference / throttled) against the pre-M9 build in an interleaved A/B (spreads 4.9% and 0.2%), app wasm 2840.2 KiB brotli (+0.08% on pre-M9, unchanged from part B), and the suite's table and jump numbers match part A's ([`perf/results/2026-10-13-m9-c.md`](perf/results/2026-10-13-m9-c.md)). The table is `seiza-table` behind a `TableDelegate`; Tycho marks first rows from its `Filled` event, checked to land in the presenting task by `table --browsers`.

**Throughout:** the Cargo workspace and npm workspaces gain the new members; `report.ts` and `check-terms.ts` cover `components/` and `engines/` where they need to; the root `CLAUDE.md` layout and the root, Tycho, component, and engine READMEs describe what exists after each part.

**Measuring between parts:** the full suite (about 1 h 45 min) runs once, on the final build, in the same session as the final A/B; part A's run (`perf/results/2026-10-13-m9-a-suite.json`) showed the moved harness reproduces the pre-M9 numbers. After each change: `just tycho check` and the behavior checks the part touches. At the end of a part, the A/B and only the suite parts it touches, at 3 runs, reference only: part B (the engine) `just tycho perf --only table-asteroids,csv --runs 3 --reference-only`, plus `sample` and `drop`; part C (the table) `--only table-asteroids,table-gaia,jump`.

**Done when:**
- [x] **No regression against pre-M9 HEAD**, interleaved A/B (`placeholder --ab`), reference and throttled, median of 10: TTFP within 3% of HEAD's, with each side's TTFP spread under 6% (the script fails a noisier run; the load average is recorded, not gated), app wasm (brotli) within +1% (the size effect recorded either way). *2026-10-13 (part C, the final code):* TTFP 181.3 vs 179.7 ms reference (+0.9%), 3698.8 vs 3697.7 throttled (+0.03%); spreads 4.9% / 3.4% and 0.2% / 0.6%; load 1.65 → 2.00. App wasm 2840.2 KiB brotli vs 2838.0 (+0.08%) ([`perf/results/2026-10-13-m9-c.md`](perf/results/2026-10-13-m9-c.md)).
- [x] **The full suite passes every budget** (`just tycho perf`), and first rows, jump to 90%, and fling on both samples are within 10% of the newest suite before M9. *2026-10-13:* every part passes ([`perf/results/2026-10-13-m9-suite.json`](perf/results/2026-10-13-m9-suite.json), 1 h 43 min, load 1.3–3.1). Against the newest suite before M9 (`2026-10-08-m7-suite.json`), reference: asteroids first rows 198.8 vs 201.8 ms, jump 81.7 vs 82.6, fling p95 16.7 both; Gaia 289.4 vs 295.7, 134.9 vs 135.7, 16.7 both. Cold TTFP 187.5 ms (−4.0% on the baseline).
- [x] **Every check script passes** on the extracted build: `check`, `smoke`, `engine`, `sample`, `errors`, `cells`, `jump --browsers`, `drop`, `csv`, `placeholder`, `worker-check`. *2026-10-13:* `check`, `engine`, `errors`, `sample`, `cells`, `jump --browsers`, `drop` and `csv` (each part, and their timed parts in the suite), `placeholder` (with the A/B), `table --browsers` (now with the marks against the GPU calls), `smoke` against the local release build, and `worker-check` (21/21) all pass (`perf/results/2026-10-13-m9-c*.json`).
- [x] **Native tests pass where they now live:** `cargo test -p seiza-table -p seiza-duckdb --all-features -p tycho` (scroll model, page cache, format, Arrow reader, page SQL, CSV). *2026-10-13 (part C):* `seiza-table` 29, `seiza-duckdb --all-features` 18, `tycho` 25 pass.
- [x] **The boundaries hold:** `cargo tree -p seiza-table` and `cargo tree -p seiza-duckdb --all-features` contain neither `seiza` nor `tycho`; `seiza-table` builds without `seiza-duckdb`; `seiza-duckdb` builds with and without `table`; `shared-web/perf/` and `engines/duckdb/web/` mention no app. *2026-10-13 (part C):* neither tree (native or wasm32) holds `seiza` or `tycho`; `seiza-table`, and `seiza-duckdb` with and without `table`, each build alone for wasm32; the only app names in `engines/duckdb/` and `shared-web/perf/` are paths to Tycho's results files in doc comments.
- [x] **No copies:** no Tycho script redefines a helper that moved to `shared-web/perf/`, and no Tycho file keeps a moved gotcha or decision (a pointer only). *2026-10-13:* no Tycho script defines a function or constant named like a `shared-web/perf/` export (the four name matches are unrelated locals); Tycho's `CLAUDE.md` and `docs/DECISIONS.md` point to the engine's and the component's files for the table, the bridge, and the DuckDB-Wasm gotchas.
- [x] **Production unchanged:** `just tycho deploy` succeeds, and `node worker/scripts/check.ts --url https://tycho.seiza.io` and `just tycho smoke https://tycho.seiza.io/` pass. *2026-10-13:* `just tycho deploy` succeeded (8 changed static assets, the samples and DuckDB's wasm unchanged in R2) and its own production check passed; `worker/scripts/check.ts --url https://tycho.seiza.io` passes (every file's bytes, br on the wire: app wasm 2908409 bytes; a first run right after the deploy died on a connection reset, the second passed), and `smoke https://tycho.seiza.io/` passes in Chromium, Firefox, and WebKit.
- [x] **Docs current:** `just tycho lint` passes (check-terms, `report --check`), and every README and `CLAUDE.md` touched describes the new layout. *2026-10-13:* `just tycho lint` passes; the root, Tycho, component, and engine READMEs and `CLAUDE.md`s describe the extracted layout.

---

## Long-term goals

Not milestones yet. Each starts with research, and becomes a milestone only if the research says it's worth building.

### Table features: column resizing, selection, sorting

M4 built its own table instead of gpui-kit's `DataTable`, whose f32-pixel scrolling breaks past ~16 M px (`docs/DECISIONS.md`, "Table and paging"). The cost was `DataTable`'s interactions: resizable columns, row/cell selection (and copying it), and sorting. After M9 each would be a Cargo feature of the table component, off by default (root `docs/DECISIONS.md`, "Repo structure"): Tycho turns on what it adopts, and the observatory adds a feature level only when both its sides are built. Sorting is also out of v1 scope (Tycho rule 4), so this is post-v1 work.

**Research costs first, then decide whether it's worth building.** Before writing any of it, measure or estimate and record in `docs/research/<goal>.md`:
- **Size and first paint:** the added wasm (brotli) for each feature, against the TTFP and size budgets.
- **Frame cost:** what each adds per frame while scrolling (hit-testing, resize handles, selection state across 25 M rows).
- **Sorting's data cost:** the table pages by row-group ranges (`file_row_number`). A sort needs `ORDER BY` over the whole file, which reads all of it (37.7 MB for the asteroids, far more for Gaia), or a sorted copy in DuckDB's memory, against rule 3 (never load the whole result). Measure time, bytes, and memory on both samples.
- **Reuse:** whether gpui-kit's column and selection pieces can sit on top of the row-based scroll model, or have to be rebuilt.
- **Canvas gaps:** how selection and copy interact with the canvas tradeoffs (text selection, a11y) `README.md` tracks.

Record the decision (build all, some, or none) in `docs/DECISIONS.md` with the numbers, and only then add a milestone with "done when" checks.

### Production performance: servers, edge, and data layout

M8 measured production and stopped there: **budgets apply to the local build only**, and production numbers are recorded, never gates (root `docs/DECISIONS.md`, "Measurement protocol", 2026-10-10). Making production faster is goal work for its own session(s), with its own token budget: the upstream variables (network, edge, R2) are unknowns. Numbers below are from `perf/results/2026-10-10-m8.md`: one Apple M1 on a home connection, ~25 ms to Cloudflare's SJC data center, ~100 Mbit/s, reference run.

**Where production's time goes (M8):**
- **First paint:** 327 ms against 211 locally (interleaved). All of the gap comes before wasm ready: connection 27 ms, HTML +28, the wasm's first byte 81 ms after its request (one round trip plus the edge), its transfer 65 ms. From wasm ready to the first frame, production matches local (100.5 vs 97.9 ms).
- **First page of rows:** ~8 sequential round trips. The app's `bytes=0-0` size probe (`engine.ts`, `remoteSize`), DuckDB's sizing HEAD, two footer reads, then the readahead steps (16 KB, 64 KB, 256 KB, 1 MB, plus 4 MB for Gaia; not configurable, see the DuckDB gotchas in CLAUDE.md). First rows: 506.8 ms asteroids, 810.8 Gaia (local 201.8 / 295.7).
- **R2 is the slow hop:** a range read takes 55–125 ms, a static asset 20–35, an edge-cache hit 40–75.
- **The edge cache is per data center** (Cache API). The first visitor at one pays R2: 873.8 ms first rows (asteroids), 1971.3 (Gaia). Reads over 4 MiB are never cached (the tee/isolate-memory cap), so Gaia's 16 MB readahead step always reads R2.
- **A Gaia page is 5.6 MB:** on a normal link, most of its time is transfer.
- **Engine ready:** 985 ms (local ~680 in a single run), much of it DuckDB's 5.2 MB br bundle.

**Ideas, roughly cheapest first** (each needs measuring before and after, and a decisions-log entry):
1. **Drop the app's `bytes=0-0` size probe:** DuckDB's ranged HEAD already sizes the file. One round trip per open. First check why M3 added it (`docs/DECISIONS.md` and LESSONS).
2. **Worker-side readahead prefetch:** DuckDB's step pattern is predictable, so on a miss the Worker could read the next step from R2 into the edge cache (`ctx.waitUntil`) before DuckDB asks. Helps at a cold edge too.
3. **Prefetch the default sample's footer after the engine is ready,** before a click: saves ~3 round trips on the first click. It's a product decision: it downloads bytes a visitor may never ask for (repo rule 2 allows it after first paint; still say so in the UI's loading line).
4. **Tiered caching for R2 reads** instead of the per-colo Cache API: the Worker fetches R2 through a cached route (an R2 custom domain, read only by the Worker as a subrequest), so a miss here can come from Cloudflare's upper tier, not R2. The browser still sees one origin (COEP). Check range support and cache keys there.
5. **Cache big reads in 4 MiB chunks,** so the 16 MB step is cached without the tee buffering risk.
6. **Re-tune Gaia's row-group size for the network:** M7 chose 61,440 rows on per-group CPU cost (local, no network); in production, bytes per page weigh more. Rerun the M7 trade-off with the network in it.
7. **Zone settings:** 103 Early Hints for the wasm and font preloads, HTTP/3. Measure; don't assume.
8. **Engine ready:** whether DuckDB's bundle and worker can start sooner after first paint, or share the connection better with the app's own requests.

**Fix the method first:**
- **A deliberate cold-edge measurement:** today the edge state depends on what ran before (the table part's `firstRun` is cold only on the first run after a deploy). A cache-key salt (a query parameter or a `DATA_VERSIONS` suffix) would make cold-edge runs repeatable.
- **More than one vantage point:** every production number so far comes from one home connection near SJC. Add at least one far-away run (a CI runner or a remote browser) before generalizing.
- **Keep interleaving with the local build** (`perf.ts --vs-local`): the same build read 304.8 and 327.2 ms TTFP an hour apart.

Record each decision with its numbers in `docs/DECISIONS.md`; production stays recorded, not budgeted, unless that rule is revisited on purpose.

---

## Open questions

- **Crate names:** whether `seiza-table` and `seiza-duckdb` are free on crates.io. Only matters if they're published; nothing is yet.

---

## Measurements

Generated by `just tycho report` from [`perf/budgets.json`](perf/budgets.json) and the newest matching file in `perf/results/`; don't edit between the markers. A metric's history is its dated results files.

<!-- report:plan:start -->
| Metric | Budget | Gate | Local | Production | From |
|---|---|---|---|---|---|
| Time to first paint | ≤ 214.8 ms (baseline 195.3 + 10%) | `check` | 187.5 ms | 327.2 ms | [2026-10-13-m9-suite](perf/results/2026-10-13-m9-suite.json), [2026-10-10-m8-prod](perf/results/2026-10-10-m8-prod.json) |
| Time to first paint, throttled | — | recorded | 3727.2 ms | 3778.5 ms | [2026-10-13-m9-suite](perf/results/2026-10-13-m9-suite.json), [2026-10-10-m8-prod](perf/results/2026-10-10-m8-prod.json) |
| App wasm (brotli) | ≤ 3247.1 KiB (baseline 2823.6 + 15%, or a `budget-notes.md` row) | `check` | 2840.2 KiB | — | [2026-10-13-m9-suite](perf/results/2026-10-13-m9-suite.json) |
| Static shell painted, reference / throttled | — | recorded | 33.4 / 254 ms | 106.1 / 294.9 ms | [2026-10-13-m9-suite](perf/results/2026-10-13-m9-suite.json), [2026-10-10-m8-prod](perf/results/2026-10-10-m8-prod.json) |
| DuckDB engine ready (after first paint) | — | recorded | 626 ms | 985.1 ms | [2026-10-13-m9-suite](perf/results/2026-10-13-m9-suite.json), [2026-10-10-m8-prod](perf/results/2026-10-10-m8-prod.json) |
| Sample click → schema (asteroids) | ≤ 300 ms | `sample` | 108 ms | — | [2026-10-13-m9-c-sample](perf/results/2026-10-13-m9-c-sample.json) |
| Sample click → first rows: asteroids / Gaia | ≤ 500 ms | `perf` suite | 198.8 / 289.4 ms | 506.8 / 810.8 ms | [2026-10-13-m9-suite](perf/results/2026-10-13-m9-suite.json), [2026-10-11-m8-prod-table](perf/results/2026-10-11-m8-prod-table.json) |
| Scrollbar jump to 90% → real rows: asteroids / Gaia | ≤ 400 ms | `perf` suite | 81.7 / 134.9 ms | 200.9 / 362.8 ms | [2026-10-13-m9-suite](perf/results/2026-10-13-m9-suite.json), [2026-10-11-m8-prod-table](perf/results/2026-10-11-m8-prod-table.json) |
| Fling top → bottom in 3 s, asteroids: p95 / worst frame | ≤ 20 / 50 ms | `perf` suite | 16.7 / 33.3 ms | 16.7 / 16.7 ms | [2026-10-13-m9-suite](perf/results/2026-10-13-m9-suite.json), [2026-10-11-m8-prod-table](perf/results/2026-10-11-m8-prod-table.json) |
| Fling top → bottom in 3 s, Gaia: p95 / worst frame | ≤ 20 / 50 ms | `perf` suite | 16.7 / 33.3 ms | 16.7 / 16.7 ms | [2026-10-13-m9-suite](perf/results/2026-10-13-m9-suite.json), [2026-10-11-m8-prod-table](perf/results/2026-10-11-m8-prod-table.json) |
| Work per frame, fling p50 / p95 (asteroids) | — | recorded | 5.8 / 7.6 ms | — | [2026-10-13-m9-suite](perf/results/2026-10-13-m9-suite.json) |
| Work per frame, steady scroll p50 / p95 (asteroids) | — | recorded | 12.6 / 15.8 ms | — | [2026-10-13-m9-suite](perf/results/2026-10-13-m9-suite.json) |
| Jump to row, Enter → rows (middle): asteroids / Gaia | lands on the row | `perf` suite | 77.4 / 131.4 ms | 199.5 / 397.4 ms | [2026-10-13-m9-suite](perf/results/2026-10-13-m9-suite.json), [2026-10-10-m8-prod](perf/results/2026-10-10-m8-prod.json) |
| Drop a 1 GB Parquet → first rows | ≤ 1000 ms | `drop` | 796 ms | — | [2026-09-27-m5-drop](perf/results/2026-09-27-m5-drop.json) |
| Drop a 1 GB CSV → first rows | ≤ 1000 ms | `perf` suite | 185.6 ms | 199.7 ms | [2026-10-13-m9-suite](perf/results/2026-10-13-m9-suite.json), [2026-10-10-m8-prod](perf/results/2026-10-10-m8-prod.json) |
| CSV row count, longest gap between updates | ≤ 500 ms | `perf` suite | 219.5 ms | — | [2026-10-13-m9-suite](perf/results/2026-10-13-m9-suite.json) |
| Fling while a CSV loads: p95 / worst frame | ≤ 20 / 50 ms | `perf` suite | 16.7 / 33.3 ms | — | [2026-10-13-m9-suite](perf/results/2026-10-13-m9-suite.json) |
| CSV load throughput (1 GB) | — | recorded | 70.2 MB/s | — | [2026-10-13-m9-suite](perf/results/2026-10-13-m9-suite.json) |
| App memory after scrolling every row twice: asteroids / Gaia | ≤ 128 MiB | `table --memory` | 91.2 / 70.8 MiB | — | [2026-09-27-m5-table](perf/results/2026-09-27-m5-table.json), [2026-10-07-m7-table-gaia](perf/results/2026-10-07-m7-table-gaia.json) |
| Observation panel vs independent measurements: reference / throttled | all within 5% | `perf` suite | 170/170 / 170/170 | — | [2026-10-13-m9-suite](perf/results/2026-10-13-m9-suite.json) |
<!-- report:plan:end -->
