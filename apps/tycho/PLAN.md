# PLAN.md — Tycho

What's next for Tycho: milestone status, the active milestone's "done when" checks, long-term goals, and open questions. Only what's still open lives here. Context and rules are in `CLAUDE.md` here and at the repo root.

**Goal:** a local-first data workbench in the browser (DuckDB-Wasm + GPUI Kit on WebGPU, WebGL2 fallback) that people use as a real tool: a utility app (root `CLAUDE.md`, "Tiers"), with a number on screen for every claim. Its table and DuckDB layer become the repo's first component and engine, and the observatory compares that component with a DOM equivalent, GPUI | TanStack ([`../observatory/PLAN.md`](../observatory/PLAN.md)).

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
| M9 | Extract the table component and the DuckDB engine | Done 2026-10-13 |
| M10 | `trim-paths`: no home paths in the shipped wasm, redeployed | Planned: in one session with the repo-wide change and the observatory's M7 |
| Later | Table features: column resizing, selection, sorting | Planned in [the table's `PLAN.md`](../../components/tall-table/PLAN.md); adopted here one at a time |
| Later | Production performance: servers, edge, and data layout | Not started; research first, in its own session |
| Later | A density plot linked to the table | Not started; research first |

The comparison with a DOM table moved to the observatory ([`../observatory/PLAN.md`](../observatory/PLAN.md)), which builds on M9's component and engine.

**Closing a milestone:** every "done when" check passes; the numbers are in `perf/results/` (a dated JSON per run and a note, from [`docs/templates/app/perf/results-note.md`](../../docs/templates/app/perf/results-note.md)); new decisions are in `docs/DECISIONS.md`; a `docs/LESSONS.md` entry is written; `just tycho report` has refreshed the generated numbers; and the milestone's spec and evidence move from here to the end of `docs/milestones.md`, leaving one row above.

**Waiting on** (features of a component or engine Tycho needs, and repo-wide changes it adopts; only that crate's `PLAN.md` (or the change's plan) builds them, and the session that closes one flips its row to *Ready*):

| Needs | For | Status |
|---|---|---|
| Every tall-table feature ([its PLAN](../../components/tall-table/PLAN.md)) | "Table features" (below): each adopted as it's ready | *Ready so far:* `custom-cells` (2026-10-24, tall-table M2), `live` (2026-10-25, tall-table M3), `follow` (2026-10-25, tall-table M4), `resize` (2026-10-26, tall-table M5), `select` (2026-10-26, tall-table M6), `copy` (2026-10-27, tall-table M7), `sort` (2026-10-29, tall-table M8: adopting it builds the DuckDB source's order, one of the research's options by source, an index for a CSV in memory, a sorted copy for a Parquet file within the memory budget, a refusal past it ([the research](../../docs/research/tall-table-features.md), "`sort`"), measured against Tycho's budgets), `pin` (2026-10-29, tall-table M9) |
| `trim-paths` in the root release profile ([the plan](../../docs/research/build-paths.md)): no home-directory paths in the shipped wasm | M10 (below) | *Not ready*: built in M10's session, before the adoption |

---

## Active milestone

None. M10 is next, in one session with the repo-wide change it adopts and the observatory's M7 ([`../observatory/PLAN.md`](../observatory/PLAN.md)); Tycho's own milestones after it come out of the research for a long-term goal below.

### M10: `trim-paths`, no home paths in the shipped wasm (draft)

Tycho's release wasm embeds the builder's home-directory paths, its dependencies' and the toolchain's panic locations: 1,013 in `web/dist` on 2026-10-30, deployed at tycho.seiza.io. The repo-wide change is [`docs/research/build-paths.md`](../../docs/research/build-paths.md)'s; this milestone adopts it. One session builds the change, this, and the observatory's M7, but each records its own evidence: this one's goes in Tycho's `perf/results/` and `docs/milestones.md`.

**Done when:**
- [ ] The app wasm before and after the change (raw, after wasm-opt, brotli 11) in a results note; `perf/baseline.json`'s wasm rewritten, and TTFP's only if `check` shows it moved.
- [ ] `check` fails on a home path in the shipped wasm (the builder's `$HOME`, `/Users/`, `/home/`), with a control (a build without the setting fails it).
- [ ] Redeployed: the deploy's checks pass, and the wasm fetched from production holds no home path.
- [ ] `just tycho report`; "Waiting on"'s row removed (adopted).

---

## Long-term goals

Not milestones yet. Each starts with research, and becomes a milestone only if the research says it's worth building.

### Table features: column resizing, selection, sorting

The table's features (resizing, selection and copy, sorting, and the rest of `DataTable`'s), their order, specs, and the research into their costs are the component's: [`../../components/tall-table/PLAN.md`](../../components/tall-table/PLAN.md). Only the component's PLAN builds them; Tycho waits on them ("Waiting on", above) and adopts every one, each as a milestone here that turns the feature on, wires it into the workbench, and measures it against Tycho's budgets (the table measures each feature's own cost, in a bare host).

### A density plot linked to the table

Plot any two numeric columns of the open file, every row, linked to the table: a box drawn on the plot filters the table to the rows inside it, and a click on a point jumps the table to its row. On the asteroids, semi-major axis against eccentricity shows the Kirkwood gaps; on Gaia, color against magnitude is the Hertzsprung–Russell diagram, from 25 M stars.

**How (to research):** DuckDB bins the rows into a grid of counts (`GROUP BY` the two columns scaled to the plot's pixels), and the plot draws the grid as one image: no custom GPU shader (GPUI has no public API for one), and the cost is the grid's, not the rows', so 25 M rows cost what 1.57 M do. Zoom re-bins the visible extent. A box becomes a `WHERE` on the two columns: the host gives the table that query and its `count(*)` as a new source (the delegate takes any query); a click becomes the nearest row's index, then `jump_to`.

**Where it lives:** a new component (a plot, the view, its state, a delegate for the bins), with its own `PLAN.md` (root `CLAUDE.md`, "Docs: one home per fact"); Tycho waits on it in "Waiting on" and adopts it. The asteroid-belt showcase builds on the same component ([`../../docs/research/asteroid-belt.md`](../../docs/research/asteroid-belt.md)).

**Research first:** the binning query's time on both samples (at the open and per zoom), the image's cost per frame, the plot's added wasm, and the canvas tradeoffs (a plot has no accessibility tree either). Record the decision with its numbers in `docs/DECISIONS.md`, then create the component.

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

- **Tycho standing alone:** Tycho is a utility app whose look and features follow its component, and it shares no UI with the apex site (root `docs/DECISIONS.md`, "Repo structure"). Whether it should also stop building on `shared-web/`'s host pieces (the placeholder's CSS copies of gpui-kit's components, the Vite config), so a change made for the observatory or the site can't reach it, is open; `shared-web/`'s rules are revisited with it.
- **Crate names:** whether `seiza-tall-table` and `seiza-duckdb` are free on crates.io. Only matters if they're published; nothing is yet.

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
