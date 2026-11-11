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
| M10 | `trim-paths`: no home paths in the shipped wasm, redeployed | Done 2026-11-01 |
| Later | Table features: column resizing, selection, sorting | Planned in [the table's `PLAN.md`](../../components/tall-table/PLAN.md); adopted here one at a time |
| Later | Production performance: servers, edge, and data layout | Not started; research first, in its own session |
| Later | A density plot linked to the table | Researched 2026-11-10: worth building. Planned in [the plot's `PLAN.md`](../../components/kirkwood/PLAN.md); adopted here once its base is ready |

The comparison with a DOM table moved to the observatory ([`../observatory/PLAN.md`](../observatory/PLAN.md)), which builds on M9's component and engine.

**Closing a milestone:** every "done when" check passes; the numbers are in `perf/results/` (a dated JSON per run and a note, from [`docs/templates/app/perf/results-note.md`](../../docs/templates/app/perf/results-note.md)); new decisions are in `docs/DECISIONS.md`; a `docs/LESSONS.md` entry is written; `just tycho report` has refreshed the generated numbers; and the milestone's spec and evidence move from here to the end of `docs/milestones.md`, leaving one row above.

**Waiting on** (features of a component or engine Tycho needs, and repo-wide changes it adopts; only that crate's `PLAN.md` (or the change's plan) builds them, and the session that closes one flips its row to *Ready*):

| Needs | For | Status |
|---|---|---|
| Every tall-table feature ([its PLAN](../../components/tall-table/PLAN.md)) | "Table features" (below): each adopted as it's ready | *Ready so far:* `custom-cells` (2026-10-24, tall-table M2), `live` (2026-10-25, tall-table M3), `follow` (2026-10-25, tall-table M4; its `let_go` 2026-11-09, M13), `resize` (2026-10-26, tall-table M5), `select` (2026-10-26, tall-table M6), `copy` (2026-10-27, tall-table M7), `sort` (2026-10-29, tall-table M8: adopting it builds the DuckDB source's order, one of the research's options by source, an index for a CSV in memory, a sorted copy for a Parquet file within the memory budget, a refusal past it ([the research](../../docs/research/tall-table-features.md), "`sort`"), measured against Tycho's budgets), `pin` (2026-10-29, tall-table M9), `density` (2026-11-01, tall-table M10), `format` (2026-11-05, tall-table M12) |
| The density plot's base, then its `select` ([its PLAN](../../components/kirkwood/PLAN.md)) | "A density plot linked to the table" (below): the plot beside the table and a click jumping to its row (the base); a box filtering the table (`select`) | *Not ready* (kirkwood M1 specced, not started; M2 planned) |

---

## Active milestone

None: M10, `trim-paths`, closed 2026-11-01 ([`docs/milestones.md`](docs/milestones.md)). Tycho's own milestones after it come out of the research for a long-term goal below.

**Carried over from the gpui-kit 0.9.1 bump** (2026-11-10, [its note](perf/results/2026-11-10-gpui-kit-0.9.1.md)), for the next milestone that adopts a table feature, which runs these anyway; on their own if a deploy comes first:
- [ ] `just tycho table --reference-only` on both samples: the fling's and steady scroll's frame work under gpui-pre 0.3.12's cursor reset on every mouse and scroll event (a `document.body.style.cursor` write each), against `2026-10-13-m9-suite.json`'s, and an interleaved look against a 0.9.0 build if it moved.
- [ ] `just tycho jump --reference-only`: the context menu's Paste on 0.9.1 (gpui-component 0.9.1 sizes the menu's items in rems; `perf/jump.ts`'s `MENU_PASTE_DY` is unchecked on it), then the version in that comment.
- [ ] `just tycho lint`'s TypeScript step fails on `shared-web/perf/protocol.ts(67,11)`: `Cannot find name 'ResizeObserverEntry'` (`tsc -p shared-web/perf` from Tycho's host; the same project passes from the tall table's `lint`). Not the bump's: neither file changed with it. Fix before the next `check`, which runs `lint` first.

---

## Long-term goals

Not milestones yet. Each starts with research, and becomes a milestone only if the research says it's worth building.

### Table features: column resizing, selection, sorting

The table's features (resizing, selection and copy, sorting, and the rest of `DataTable`'s), their order, specs, and the research into their costs are the component's: [`../../components/tall-table/PLAN.md`](../../components/tall-table/PLAN.md). Only the component's PLAN builds them; Tycho waits on them ("Waiting on", above) and adopts every one, each as a milestone here that turns the feature on, wires it into the workbench, and measures it against Tycho's budgets (the table measures each feature's own cost, in a bare host).

### A density plot linked to the table

Plot any two numeric columns of the open file, every row, linked to the table: a box drawn on the plot filters the table to the rows inside it, and a click on a point jumps the table to its row. On the asteroids, semi-major axis against eccentricity shows the Kirkwood gaps; on Gaia, color against magnitude is the Hertzsprung–Russell diagram, from 25 M stars.

**Researched 2026-11-10: worth building** ([the research](../../docs/research/density-plot.md); its numbers, [`perf/results/2026-11-10-plot-research.md`](perf/results/2026-11-10-plot-research.md); the decisions, [`docs/DECISIONS.md`](docs/DECISIONS.md), "Density plot"). DuckDB bins the rows into a grid of counts and the plot draws the grid as one image, which costs a frame next to nothing. What changed from the first design: the cost of the data is the rows', so the two plotted columns are copied once into DuckDB's memory, a slice at a time with the plot filling in, and every zoom, box, and click is answered from the copy.

**Where it lives:** the plot is a component, [`components/kirkwood/`](../../components/kirkwood/), with its own `PLAN.md`, which builds its base (the drawing, zoom and pan, the click) and then `select` (the box). Tycho waits on both ("Waiting on", above). The asteroid-belt showcase builds on the same component ([`../../docs/research/asteroid-belt.md`](../../docs/research/asteroid-belt.md)).

**What Tycho builds when it adopts it** (a milestone here, specced when the plot's base is *Ready*; the engine's part can start before, since it needs only the delegate's shape):
- **The plot's source, in the engine** (`seiza-duckdb`'s `kirkwood` feature, as the table's source is its `tall-table`): the copy in slices, the bin query, a box's count and its index of rows, the row nearest a click, and the Arrow answer turned into the plot's counts, pinned against the plot's bins fixture. A CSV's chunk tables are binned as they are.
- **The panel in the workbench:** the plot beside the table, a picker for each axis (the open file's numeric columns), a default extent from each column's 0.1%–99.9% quantiles (the asteroids' `a` runs from −15,680 to 14,510), what a plot will read said before it reads (the columns' bytes are in the footer), and the rows binned so far while it fills.
- **The link:** a click jumps the table to the nearest row (`jump_to`); a box gives the table the box's rows as its source and its count as its rows, and clearing it gives the file back.
- **Its measurements** against Tycho's budgets: the wasm, the fling with a plot open, a table page read during a re-bin, memory with Gaia's copy held.

**To settle in that milestone's spec** (each has numbers in the research to start from):
- **The hosted samples need a file laid out for the plot.** Their row groups are sized for paging, so the copy's first read is 155 requests for the asteroids and 2,448 for Gaia (an estimated 9–19 s and 2–5 min at R2's read times, and past the 93 requests in 10 s the WAF's rate limit was set from). The plotted columns as `FLOAT` in large row groups read in 5 and 15. **Decided 2026-11-10:** each sample gets such a file (every numeric column, the sample's row order). Still to settle: its row-group size and what it costs to host, with a production measurement, and with "Production performance" below, which owns the data's layout; and the limit: `just tycho burst` gets a plot scenario, and the WAF's rate limit may rise slightly if the plot files' read still passes it, never by the 155 or 2,448 requests the samples' own layout would need.
- **A sparse box as the table's source.** A page of a box reads every row group its rows fall in: one row group (5.6 MB) for a box holding 15% of Gaia, 945 MB for one holding 1,652 stars. The ladder is `sort`'s (pages joined from the file when dense, the box's rows copied into memory when sparse and small, the size said and asked, or refused, past a limit), and `sort`'s adoption builds the same machinery: one source for both, and which milestone builds it first.
- **Gaia's 165 MB.** Even in 15 requests, the plot of the big sample downloads 165 MB. **Decided 2026-11-10:** the big sample's plot waits behind a button that says the size; the asteroids' starts on its own. Still to settle: the size past which any file's plot asks first (a dropped file reads from disk, so its limit is time, not bytes).
- **What the table does when a box is applied:** its scroll position, its selection, the jump highlight, and whether the swap is `set_rows` with `live`'s `invalidate_rows` or a new table state.
- **The plot's place in the workbench** and its controls, on a design canvas first.

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
| App wasm (brotli) | ≤ 3283 KiB (baseline 2854.8 + 15%, or a `budget-notes.md` row) | `check` | 2840.2 KiB | — | [2026-10-13-m9-suite](perf/results/2026-10-13-m9-suite.json) |
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
