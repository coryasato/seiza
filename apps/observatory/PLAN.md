# PLAN.md — Observatory

What's next for the Observatory: milestone status, the active milestone's "done when" checks, long-term goals, and open questions. Only what's still open lives here. The rules are the root `CLAUDE.md`'s, its "Comparison protocol" above all; this app's own are in its [`CLAUDE.md`](CLAUDE.md).

**Goal:** one page, at `seiza.io/observatory`, that runs each component against a DOM equivalent and shows with measured numbers what each costs over a session of use: opening data, scrolling, flinging, jumping. The first comparison is GPUI | TanStack: the tall table ([`components/tall-table/`](../../components/tall-table/), at `seiza.io/observatory/tall-table`) against React + TanStack Virtual, on the same engine and the same file.

**Deciding metrics:** per-use cost, as the root `CLAUDE.md`'s "Comparison protocol" defines it (time to first usable, time to data, input to visible response, behavior under load, reach and correctness, cost). One-time costs (first pixels, bundle size) are footnotes. TTFP still gates each contender's own build (root rule 1).

**Where everything else lives:** the decisions so far are repo-wide, in the root [`docs/DECISIONS.md`](../../docs/DECISIONS.md) ("Comparison protocol", "Hosting", "Repo structure"). This app's own context and rules are in [`CLAUDE.md`](CLAUDE.md), its decisions in [`docs/DECISIONS.md`](docs/DECISIONS.md).

---

## Status

| Milestone | Title | Status |
|---|---|---|
| M0 | Groundwork: the app, its data file, and static hosting (parts A–B) | Done 2026-10-14 ([`docs/milestones.md`](docs/milestones.md)) |
| M1 | Spikes: the DOM scroll model and the input-latency method (parts A–B) | Done 2026-10-15 ([`docs/milestones.md`](docs/milestones.md)) |
| M2 | The GPUI contender and the fixtures (parts A–C) | Done 2026-10-17 ([`docs/milestones.md`](docs/milestones.md)) |
| M3 | The TanStack contender (parts A–D) | Done 2026-10-18 ([`docs/milestones.md`](docs/milestones.md)) |
| M4 | The numbers: cold runs of both contenders (parts A–B) | Done 2026-10-18 ([`docs/milestones.md`](docs/milestones.md)) |
| M5 | The observatory page (parts 0, A, A1–A2, B, C, D1–D4) | Done 2026-10-21 ([`docs/milestones.md`](docs/milestones.md)) |
| M6 | The deploy | Done 2026-10-21 ([`docs/milestones.md`](docs/milestones.md)) |
| M7 | `trim-paths`: no home paths in the shipped wasm; the asteroids credited; redeployed | Done 2026-11-01 ([`docs/milestones.md`](docs/milestones.md)) |
| M8 | The scenarios on the page: the design (a design session, no code) | Done 2026-11-02 ([`docs/milestones.md`](docs/milestones.md)) |
| M9 | Scenario: wide sheet (parts A1–E4) | Done 2026-11-04 ([`docs/milestones.md`](docs/milestones.md)) |
| M10 | Scenario: market watch (parts A1–F) | Done 2026-11-06 ([`docs/milestones.md`](docs/milestones.md)) |
| M11 | Scenario: live tail (parts A1–A2, B1–B2, C1–C2, D1–D2, E, E2, F) | Done 2026-11-09 ([`docs/milestones.md`](docs/milestones.md)) |
| M12 | Scenario: admin table (the control) (parts A1–A3, B1–B2, C1–C2, D–E) | Done 2026-11-10 ([`docs/milestones.md`](docs/milestones.md)) |
| M13 | Scenario: monitoring wall (parts A1–A3, B1–B2, C1–C2, D1–D2, E, F) | Active (part E) |
| M14 | The wide sheet's later steps: a resize drag, a range copied | Planned (after M13) |

**Parts are sized to one working session.** Each ends with its own checks passing and its evidence written down, so the next session starts from this file, not from the last one's context. A part that grows past a session splits before it's started, not halfway through.

**Closing a milestone:** as for every app (root `CLAUDE.md`, "Working agreements"): every "done when" check passes; the numbers are in `perf/results/` with a note; new decisions are in `docs/DECISIONS.md` (repo-wide ones in the root's); a `docs/LESSONS.md` entry is written; and the milestone's spec and evidence move from here to `docs/milestones.md`, leaving one row above.

**Component and engine changes:** the observatory consumes the tall table and the DuckDB engine; it doesn't reshape them (root `docs/DECISIONS.md`, "Repo structure"). The changes it needs, all listed here (each done, and recorded in `docs/milestones.md`): `Paging` gains the two settle times (M2 part A, the one change to the table's internals, defaults unchanged), the table's fixtures and their native tests (M2 part C, with `shown_text` split out of the render loop for them, and `seiza-duckdb`'s `summary_queries` returning the queries `open_parquet` sends), `@seiza/duckdb` takes its extension directory as an option (done, M0 part A), and `seiza` gains a `panel` feature (on by default) while its title bar and theme toggle move to Tycho, with the Mac input bindings opt-in (M2 part A), and `seiza::targets` (publishing a control's bounds) moves there from Tycho, as do Tycho's first-draw probe and placeholder screenshot match to `shared-web/perf/` (M2 part B), and `cells.json` gains two hand-written `rounding` cases (M3 part A: fixture data only, no code). Each records its effect on Tycho. The scenarios ask for more, each built by its own crate's plan: the table's `density` (tall-table M10, adopted in M9), and its `format` (asked 2026-11-04 for market watch). Market watch's seeded feed is the observatory's own, not the engine's (decided 2026-11-04, M10 below).

**Waiting on** (features of a component or engine the observatory needs, and repo-wide changes it adopts; only that crate's `PLAN.md` (or the change's plan) builds them, and the session that closes one flips its row to *Ready*):

| Needs | For | Status |
|---|---|---|
| tall-table `follow` (same; [its README](../../components/tall-table/README.md), "Following the tail") | Live tail (M11) | *Ready* (2026-10-25, tall-table M4) |
| tall-table `let_go`: following turned off by the host, the view left where it is, `Following(false)` emitted (the reader's moves do it today; `set_following` is private) | Live tail's Pause (M11 part E2) | *Ready* (2026-11-09, tall-table M13; the TanStack contender's `letGo` built with it, in `follow.ts`, its fixture scenario and control run on the tail level) |
| tall-table `resize`, `select`, `copy` ([its PLAN](../../components/tall-table/PLAN.md), "Columns" and "Selection") | The wide sheet's later steps, a resize drag and a range copied (M14) | *Ready* (`resize` 2026-10-26, tall-table M5; `select` 2026-10-26, M6; `copy` 2026-10-27, M7) |

---

## Active milestone

### M13: Scenario: monitoring wall

Opened 2026-11-10. An ops screen: a NOC wall, a trading floor's desks, live sports. Several small tables in one frame, all updating at once ([the research](docs/research/scenarios.md), "Monitoring wall"). Mechanisms: cost per cell (A) and allocation and garbage collection (B), in the canvas's terms one canvas against N DOM trees. It's the last scenario. Every feature it uses is built; it waits on nothing. M12's spec and evidence are in [`docs/milestones.md`](docs/milestones.md).

**The design is M8's canvas** (https://claude.ai/artifact/6cHBgVwwSqpTad8GP9KnGK: its "Wall" board, dark, GPUI, eight tables, and the main board's `wall` scenario), followed as drawn ([`docs/DECISIONS.md`](docs/DECISIONS.md), "Page"):
- **The lead:** "Several live tables in one frame. Turn up the tables."
- **The dial:** "Tables", stops 4, 6, and 8, laid out 2×2, 3×2, and 4×2 (one column on a phone), each table at 2k updates/s. The canvas's default is 6.
- **The grid:** tables 8 px apart, padded 8 px, on the sidebar's color. Each table has a 26 px title (its desk: Energy, Rail and freight, Banks, Chips, Health, Retail, Materials, Utilities), then 4 columns at 24 px rows and 12 px text: Symbol 64, Last 76, Chg % 72, Volume 80 px. Last flashes and Chg % is drawn by its sign, as market watch's are.
- **The status bar:** Ready in, Shown in, Smooth, Memory (on a phone, Shown in and Smooth); the data "Simulated stock prices", 400 rows; a "Synthetic data" tag.
- **The panel:** the keeps-up chart over the three stops, both devices; then three cards at the chosen stop: Smoothness, Update shown in (p50), and Collection pauses in 10 s; then Ready in and Download.
- **The gallery card:** a mosaic of eight small tables; the mechanisms A and B.

Every number on the canvas is a sketch. Its curves and verdict now follow A2's spike ("On a slow device, GPUI keeps up to 6 tables, TanStack to 4"). Part A3 drew what the canvas lacked, decided with the user ([`docs/DECISIONS.md`](docs/DECISIONS.md), "Page", 2026-11-10; the canvas's wall row): each table scrolls on its own; a phone's frame scrolls one column of tables, each a title, a header, and 6 rows; each table draws the tall table's row-number gutter (33 px), so at 8 tables with the sidebar open Volume is cut and the table scrolls sideways.

**The level: `wall`, a build of its own** (decided with the user 2026-11-10, [`docs/DECISIONS.md`](docs/DECISIONS.md), "Scenarios"). It is market watch's features plus `density` (`custom-cells`, `live`, `format`, `density`). Without `density`, the table sizes its columns by kind: Symbol 200 px and each number 120, about 560 px a table, against ~280 px for a table in a 4-across grid at 1440 × 900. Market watch's level stays as it is, so its builds and its numbers are unchanged. The wall gets one more build per side, with budgets of its own.

**The data: 400 fictional instruments in 8 desks of 50** (decided with the user 2026-11-10, the same entry). A file of their own: each instrument's desk, symbol, and reference price (no name: the wall draws none; A1-1), written by `prep.ts` from one home in the feed's module and checked against US listings, as market watch's 50 are. It is labelled synthetic and credited as the observatory's own. Market watch's file and feed are unchanged. One seeded feed sends every desk's ticks in a worker per frame, in market watch's tick format (its u16 instrument holds 0–399), so each side's store and fold are market watch's, widened to 400 rows.

**On each side:**
- **GPUI:** N `TallTableState`s in one window, each a desk's 50 rows, laid out by the host in the stop's grid.
- **TanStack:** N tables in one React tree, each its own virtualizer over its desk.

Both take the same feed, the same desks, the same widths, and the same flash. The marks a stop's readings need with N tables are A1's: "filled" once every table has its rows, and Shown in pooled across the tables or per table.

**Parts** (each one session; A3 confirms B–F):
- **A1: the data, the feed, and the level's shape.**
  - The instruments: 400 fictional symbols and price levels by desk, the US-listing check, a draft `prep-wall` (rows, bytes).
  - The feed: market watch's module widened, or a module of its own over the same format, and which. Its rate sustained in its worker at 4, 6, and 8 desks × 2k (8k–16k ticks a second, inside the 50k market watch's worker held, [M10 A1](perf/results/2026-11-04-m10-a1.md)), and each side's fold at 16k.
  - The per-table rate kept at the canvas's 2k or moved: at 2k a desk gets ~33 ticks a frame over 50 rows, so a third of its visible rows change a drawn cell each frame (A1-3).
  - The level's build shape on each side: the Cargo feature `wall`, `contenders/level.ts`, `BUILT`, the staging.
  - The contract with N tables: which marks, and how Shown in and "filled" read across tables.
  - The fixtures: the feed fixture's fold at 400 rows, and `cells.json`'s section if the wall's text isn't market watch's.
- **A2: the spike on both sides and the stops.** N tables at each stop on each side, on A1's feed: the GPUI bare host (or the contender) with N table entities in a grid, and the TanStack spike with N virtualizers. Measured at each stop, both devices: Smooth, work per frame, Shown in, and collection pauses.
  - The verdict's measure: market watch's "keeps up" (≥ 90% of batches shown in a frame of their own) taken across N tables, or changed.
  - The stops kept at 4/6/8 or moved to where the edges fall, decided with the user.
  - The suite's time.
- **A3: the measures, the boards, and B–F confirmed.**
  - The measures made exact: Ready in, Shown in, Smooth, Memory, Download, collection pauses.
  - The boards on M8's canvas, decided with the user before anything is built: the phone's one column, a table's rows past its tenth, light and dark, desktop and phone.
- **B1: the data, the scenario, and the feed fixture** (split in A3, as were C and D).
  - The data: `prep-wall` in `prep.ts` (`--only wall`, from A1-1's draft and `contenders/wall/`'s 400), its `MANIFEST.json` entry, credited as the observatory's own and synthetic.
  - The scenario: `MONITORING_WALL` and `LEVEL_FEATURES.wall` in `contenders/scenarios.ts` (A1-4), on neither side's `BUILT` yet.
  - The feed fixture at 400 rows (`contenders/wall/fixtures/`, market watch's `write.ts` widened), run by GPUI's native store and TanStack's `QuoteStore` with the dropped-tick control; market watch's fixture regenerated byte-identical.
  - `docs/contender-contract.md`'s changes for N tables (A1-5's list).
- **B2: the GPUI contender at the level:** the crate's feature `wall` (market watch's code under `cfg(any(feature = "market", feature = "wall"))`), N tables in the stop's grid (two rows; a phone's one column of 196 px tables, its frame scrolled from a title or a gap), one fold a batch and each table's ticked rows invalidated, the marks across tables (`filled`, `refreshed` per table, the batches' generations and mask, the readout's ring pooled); `wall` in `BUILT.gpui`; its wasm and TTFP budgets (`gpui-wall-*`); market watch's wasm byte-identical; a check script's GPUI half (`perf/wall.ts`: the fixture's ticks drawn, each table's cells, the marks right after presented frames, every batch reached, an unknown stop failing).
- **C1: the TanStack contender at the level:** N tables in one React tree, each its own virtualizer over its desk (a phone's one column, the frame scrolling, its nested scrollers chaining), market watch's store widened to 400 rows, the fold, the flash, and the marks; `wall.css`; `wall` in `BUILT.tanstack`; its first-paint JS and data-layer budgets; market watch's bundle unchanged.
- **C2: the same on both sides:** `perf/wall.ts` on both sides (each table's cells byte-identical after a fixed run of ticks, the same grid, widths, and gutter), `tanstack-contract` and `tanstack-parity` at the level (the grid, the flash, the sign colors, light and dark; Chromium, Firefox, WebKit), and all of it in `check`.
- **D1: the metrics at the level:** A3's measures in the metric scripts at `--scenario monitoring-wall`: `metric-feed`'s pairing across the tables (the batches' generations and mask), `usable`, `data` (every table filled), and `memory` (`?ticks=60000`, Download); smoke runs only, then the code review.
- **D2: the runs** (~1.5 h, one sitting on a quiet machine: A2-4): the feed at each stop, both sides, both devices, 10 runs, each file labelled `monitoring-wall-<stop>` with its versions; usable, data, and memory once; and the GPUI-only A/B of gpui-kit 0.9.0 against 0.9.1 (settled: root `docs/DECISIONS.md`, "Comparison protocol", 2026-11-11); a results note.
- **E: the page,** as the canvas and A3's boards draw it (the dial, the grid, the status bar, the panel, the description, the gallery card), and the Overview's rule if the wall changes it; split at its start if it's over a session.
- **F: shipped.** The README's section by `report` (its canvas tradeoffs too: the phone's scrolling differs between the sides), `burst` under the zone's limit, the deploy, `worker-check`.

**Done when** (draft; the measures made exact in A1–A3):
- [ ] **Its builds:** the level `wall` on both sides carries market watch's features and `density` (and their counterparts), and nothing else; every other level byte-identical to before. Its budgets (`gpui-wall-*`, `tanstack-wall-*`) are against baselines of their own, gated by `check`, with each feature's added bytes in a results note.
- [ ] **Its data credited:** the instruments' file in `MANIFEST.json` (rows, bytes, SHA-256, credited as the observatory's own, synthetic); the page and the README say the feed is synthetic and seeded.
- [ ] **The same on both sides:**
  - One feed module sends the same bytes to either side, and every tick reaches its table's store.
  - The feed fixture at 400 rows passes on both sides' stores, with its control.
  - The cells shown after a fixed run of ticks are byte-identical on both sides, every table.
  - Both sides draw the tables in the same grid and at the same widths.
  - `tanstack-parity` covers the grid, the flash, and the sign colors in Chromium, Firefox, and WebKit.
- [ ] **Its runs:** `check` gates the level's budgets and runs its smoke, fixtures, and contract checks. The full cold protocol (its stops × both sides × both devices × 10 runs) runs once, in part D, each results file labelled `monitoring-wall-<stop>` with its versions. *The cold protocol ran in part D2 ([results](perf/results/2026-11-11-m13-d2.md)); left: one full `check` run (C2-4 ran its steps one by one).*
- [x] **Its numbers:** at each stop, both sides, both devices: whether it keeps up, Shown in p50, collection pauses in 10 s, late frames, work per frame. Once a scenario: usable, data, memory. A results note, which also holds the 0.9.0 against 0.9.1 A/B and its verdict. *Evidence:* part D2 ([results](perf/results/2026-11-11-m13-d2.md)).
- [ ] **The page:** the route, the dial, the grid, the status bar, the panel, and the description as the canvas and A3's boards draw them, "Measured with …" from the results; `page --check` covers them.
- [ ] **Shipped:** the README's monitoring wall section by `report`, `burst` under the zone's limit, the deploy, `worker-check`.

### Part A1: the data, the feed, and the level's shape

**Done when:**
- [x] **A1-1, the instruments:** 400 fictional instruments in the canvas's 8 desks of 50 (desk, symbol, reference price), none listed on a US exchange (the check market watch's prep runs) and none repeating market watch's 50 symbols; a draft `prep-wall` with native DuckDB (rows, bytes, row groups).
  *Evidence* ([results](perf/results/2026-11-10-m13-a1.md)): 400 symbols generated once (`spike/wall/gen.ts`, seed `0x3a11`) and pinned as text in `spike/wall/instruments.ts`, 110 listed candidates rejected (NASDAQ Trader's directories, 14,246 symbols, with the AAPL and IBM control), none repeating market watch's or each other. Prices are log-uniform in a range per desk (Materials 4–85 up to Chips 25–480). No name column: the wall draws none. The draft file (`spike/wall/prep-wall.sql`, native DuckDB 1.4.5) is `Desk`, `Symbol`, `Last`, `Change %`, `Volume`: 400 rows in the feed's order, 3,646 B, one row group.
- [x] **A1-2, the feed:** where its module lives and how it's shared with market watch's (same tick format, the instrument a u16 over 400); its rate held in its worker at 8k, 12k, and 16k ticks a second (every tick delivered, the worker's busy ms a second), each side's fold of a batch at 16k, and the first 2,000 ticks' digest the same across runs.
  *Evidence* ([results](perf/results/2026-11-10-m13-a1.md)), reference, median of 3:
  - **Delivered:** 100% at 8k, 12k, and 16k (4, 6, 8 desks × 2k), ~52 batches a second, post → handler ~0.2 ms p50, the worker busy 16–23 ms a second.
  - **The fold of a batch at 16k:** `objects` 0.37 µs a tick (5.9 ms a second, 17 collections in 10 s, longest 0.94 ms), `typed` 0.08, `wasm` 0.15, neither making garbage.
  - **The same ticks:** each stop's digest the same in every run (`8c545d85` at 8 desks), and the three folds agree after 20,000 ticks, over the 400 and over market watch's 50, the dropped-tick control differing. The spike's feed writes the contender's bytes (`spike/wall/same-feed.ts`, with another seed as its control): the first runs, on a stale copy, are superseded (the note says how).
  - **Throttled:** reads faster than the reference on this idle page, as in M10 A1, so only its counts are read (100% delivered at every stop).
  - **The module:** market watch's `Feed`, taking its instruments' prices (market watch's 50 the default, its fixture to regenerate byte-identical in B). The worker's start names the instruments and the stop's desks; the 400's home is `contenders/wall/`.
- [x] **A1-3, the per-table rate:** the canvas's 2k a table kept or moved, from the share of each desk's visible rows changed a frame at 1k, 2k, and 5k. *Kept for A2's spike, which moves it if no edge falls inside the dial.*
  - **What changes a drawn cell:** the wall draws Last, Chg %, and Volume. A quote tick (40%) changes none of them, only Bid and Ask, which market watch draws and the wall doesn't. A trade always adds to Volume, and moves Last half the time.
  - **What a frame redraws, counted from the store's values** (`spike/wall/changed.ts`: the feed's own ticks, 3,000 frames at 60 Hz, the visible rows only). Cells changed counts only columns whose value moved, and cells flashing counts those within 400 ms of a change. The wall has 8 desks × 16 rows on screen (a bare page's 900 px in two rows of tables); market watch has 29 of its 50.

    | | Rows changed a frame | Cells changed a frame | Cells flashing |
    |---|---|---|---|
    | Wall, 1k a desk | 23 (18%) | 47 | 116 of 128 |
    | Wall, 2k a desk | 42 (33%) | 87 | 127 of 128 |
    | Wall, 5k a desk | 81 (63%) | 172 | 128 of 128 |
    | Market watch, 1k | 8 (28%) | 39 | 83 of 87 |
    | Market watch, 5k | 24 (81%) | 125 | 87 of 87 |

  - **At 2k:** the wall changes 87 cells a frame, between market watch's 1k and 5k (39 and 125), where its edges fell (TanStack on the slow device kept up to 1k). Nearly every Last on screen is flashing at any moment, more flashing cells than market watch ever has. The share of rows changed doesn't depend on how many show, since the feed spreads a desk's ticks evenly over its 50.
  - **A2 settles it:** the spike runs 2k a desk, and 5k a desk too if neither side's edge falls between 4 and 8 tables on either device. A rate that moves is decided with the user, as market watch's stops were.
- [x] **A1-4, the level's shape:** the `wall` level in `LEVEL_FEATURES`, `BUILT`, `contenders/level.ts`, the GPUI crate's feature, and the staging; what each touches, listed for parts B and C.
  - **Unchanged, and driven by the lists:** the recipes, `sizes`, `cold`, `tanstack-sizes`, `placeholder`, the page's servers, and `worker/scripts/stage.ts` all loop over `BUILT` (`contenders/built.ts`), and `level.ts`'s `levelOf`, `gpuiCargoFeatures` (`[level]`), and `levelOutDir` (`dist-wall/`) take any level. Adding `wall` to `BUILT` builds, sizes, stages, and gates it. `perf/budgets.json` and `baseline.json` gain `gpui-wall-*` and `tanstack-wall-*`, written by each side's first `--level wall` run.
  - **`contenders/scenarios.ts` (part B):** `Level` gains `wall`, and `LEVEL_FEATURES.wall` is `custom-cells`, `live`, `format`, `density`. A `WallScenario` holds its stops (`{ id, label, tables }`: 4, 6, 8), the rate a desk, the desks' names, the seed, and market watch's signs and flash (shared, not copied). `MONITORING_WALL` joins `ALL_SCENARIOS`, then `BUILT.gpui` in B and `BUILT.tanstack` in C, then `SCENARIOS` in E.
  - **The GPUI crate (B):** a feature `wall`, market watch's six features plus `seiza-tall-table/density` and `tall-table-bridge/density`.
    - The market code it shares is the feed's receiver (`feed.rs`), the store (`market.rs`), and the market source (`scene/market.rs`). It goes under `cfg(any(feature = "market", feature = "wall"))`, not a `wall` that turns on `market`: market watch's file check and single-table host stay market's.
    - The host's `Load::Open` holds N tables (a wall of entities over one store), and `Host::feed` folds once, then invalidates each ticked row in its own table. A grid view lays them out at the stop's columns. `scene/wall.rs` holds the 4 columns, their widths, and the title row.
    - Market watch's wasm stays byte-identical: `sizes` at the market level against its file of record.
  - **The TanStack contender (C):** `__LEVEL__ === 'wall'` branches. `App` renders N table components in a grid, each with its own virtualizer, over market watch's store widened to 400 rows (`data/quotes.ts`, `data/market.ts`), with a `wall.css`. Market watch's bundle is unchanged: `tanstack-sizes` at the market level.
  - **The data (B):** `prep.ts --only wall`, its SQL (`prep-wall.sql`, from A1-1's draft), and a `MANIFEST.json` entry; `stage.ts` stages every file `MANIFEST.json` names, so the entry is all it needs.
  - **Later parts:** the page's lists (`web/src/components.ts`, `gallery.ts`, `slot.ts`) in E; `metric-feed` and the once-a-scenario metrics at the level in D; `tanstack-contract` and `tanstack-parity` at the level in C; `burst` in F.
- [x] **A1-5, the contract and the fixtures with N tables:** the marks (filled, usable, Shown in's stamps) and how each reads across tables, `docs/contender-contract.md`'s changes listed; the fixtures the wall adds (the feed fixture at 400 rows, a cells section if its text differs from market watch's).
  - **Unchanged:** `first-pixels`, `usable`, `open` (one open of the file; a desk's 50 rows are one page, read once and then answered from the store, as market watch's are), and `input` (the window's first key; on GPUI the first table holds the focus).
  - **`filled`, across the tables:** set once every table's visible rows hold real data, and again each time that becomes true. On GPUI, the host marks when the last table's `Filled` arrives; on TanStack, in the commit that makes every table's rows real. Time to data is the open → all N filled.
  - **`refreshed` and Shown in, per table, then pooled:**
    - Each table keeps its own generation (GPUI's `invalidate_rows` already counts per table). `__contenderRefreshed` becomes an array, the highest generation drawn per table, and `contender:refreshed` is set after each frame that draws any table's re-read.
    - A batch's entry in `__contender.batches` becomes `[seq, ticks, sent, generations: number[] (per table, 0 for none), visible: number (a bitmask of the tables whose on-screen rows it ticked)]`.
    - A batch is shown in the first frame at whose `refreshed` mark every table in its mask has drawn its generation: one reading per batch, pooled across the wall. Why: a batch is what the wall shows at once. One canvas draws every table in one frame, while N DOM trees may not, and that's the scenario's question. Keeps up is market watch's `feedFrames` over those pairs. The readout's ring takes the pooled reading.
  - **`state`:** the first table's, as today, plus `tables: N`. The wall's measures don't scroll; A3 confirms none needs more.
  - **Replay hooks and targets:** `load` only. The fling and the jump to 90% have no meaning on a 50-row desk; A3 confirms on the boards that the page offers none.
  - **`failed`:** as market watch's, its file check being the wall's instruments (400 rows, the five columns).
  - **The fixtures:**
    - The feed fixture at 400 rows: `contenders/wall/fixtures/feed.json`, the first 2,000 ticks over the 8 desks and the store after them, written by market watch's `write.ts` widened. It's run by both stores with the control (a dropped tick), beside market watch's, which must regenerate byte-identical.
    - No `cells.json` section: the wall draws market watch's formats (Last at its decimals, Chg % as "+1.23%", Volume grouped) through the same code, and its flash is `paint.json`'s. The done-when's cross-side check (the cells after a fixed run of ticks, every table) covers the wall's own text.
    - The paging fixtures are unchanged: a desk is one page.
  - **`docs/contender-contract.md`'s changes, for B and C:** the marks table's `filled` and `refreshed` rows, the state's `batches` and `__contenderRefreshed`, "Reading the metrics"'s Shown in and keeps up, and the feed's paragraph (one worker, the stop's desks of 50 from the 400).

### Part A2: the spike on both sides and the stops

**Done when:**
- [x] **A2-1, the spike on both sides:** N tables at 4, 6, and 8 on each side under A1's feed at 2k a desk, the same wall drawn (screenshots), and each stop measured on both devices: keeps up, Shown in, late frames, work a frame, the busy time, and collection pauses.
  *Evidence* ([results](perf/results/2026-11-10-m13-a2.md)), median of 3, after the code review's fixes (each run checked that every batch reached the side; none was lost):
  - **The sides:** GPUI is N tall tables in one window (`spike/wall-gpui/`, crate `wall-spike`). TanStack is N virtualizers in one React tree with one `flushSync` commit a frame (`spike/wall/`). Both have the canvas's columns, 24 px rows, 12 px text, Last's flash, and Chg % by sign, over the store in hand (no engine).
  - **Fast device:** both keep up at every stop (≥ 99.4%), with no late frames. Work a frame is 4.6 → 6.8 ms on GPUI and 3.8 → 6.9 on TanStack.
  - **Slow device:** at 4 tables both keep up (98.9%, 98.5%). At 6, over both sweeps' 6 runs, GPUI reads 90.0% (79.4–92.4) and TanStack 81.0% (77.6–85.0): the one stop where runs spread 8–13 points. At 8, GPUI reads 71.6% and TanStack 52.6%, with late frames at 54% and 94%. Both main threads are saturated from 6 tables; GPUI's frames are the cheaper at 8 (24.5 against 33.6 ms).
  - **Collections in 10 s:** GPUI 2–4, TanStack 18–27. Throttled at 6 and 8 tables, 13 and 18 of TanStack's land in a late frame, against 2 and 2 of GPUI's.
  - **Shown in's control** (a frame late, 8 tables, reference) moves send → mark by +16.8 ms on GPUI and +17.1 on TanStack, keeps up unchanged. The gap check's control (one batch dropped) fails both sides.
- [x] **A2-2, the verdict's measure:** market watch's "keeps up" (≥ 90% of visible batches shown in a frame of their own) across N tables, kept or changed. *Kept, with A1-5's pooled pairing* (decided with the user): every batch's tables drew it in one frame on both sides (one canvas; one React root committing every table at once), so pooled and per-table read the same. The split share stays a diagnostic.
- [x] **A2-3, the stops:** kept at 4/6/8 or moved to where the edges fall, decided with the user. *Kept at 4, 6, and 8 tables at 2k a desk:* on the slow device TanStack's edge falls between 4 and 6 and GPUI's between 6 and 8, its 6 on the line (90.0% over 6 runs, 79.4–92.4), so the dial holds both edges. The canvas's sketch ("GPUI keeps up at 8 tables") is a stop too generous to GPUI.
- [x] **A2-4, the suite's time:** the spike's 36 runs took 11–13.5 minutes, 18–23 s a run. Part D is the feed at 3 stops × 2 sides × 2 devices × 10 runs (~40 min), usable, data, and memory once (~25 min), and the 0.9.0 against 0.9.1 A/B (~20 min): **about 1.5 h, one sitting.**

### Part A3: the measures, the boards, and B–F confirmed

**Done when:**
- [x] **A3-1, the measures:** Ready in, Shown in, Smooth, Memory, Download, and collection pauses made exact; the suite's time. *Evidence:* [`docs/DECISIONS.md`](docs/DECISIONS.md), "Measurement", 2026-11-10, "The monitoring wall's measures": market watch's at each stop (keeps up, Shown in paired across the tables, Smooth, the pauses' time, late frames, work), and once at 6 tables Ready in, time to data (every table filled), Memory after `?ticks=60000` (10,000 a desk), and Download by kind from the memory run. The runs use the bare pages at 1440 × 900, nothing scrolled. The suite: A2-4's ~1.5 h.
- [x] **A3-2, the boards,** decided with the user and drawn on M8's canvas. *Evidence:* the canvas's wall row (https://claude.ai/artifact/6cHBgVwwSqpTad8GP9KnGK: WallLight, six tables with Banks scrolled to rows 21–30; WallTanstack, dark, four tables; WallPanel, the keeps-up charts at the 90% line and the cards at 6; PhoneWall, light; PhoneWallDark, the frame scrolled; Wall, eight tables with Volume cut, retitled); [`docs/DECISIONS.md`](docs/DECISIONS.md), "Page", 2026-11-10. The three layout calls were the user's; the boards as drawn wait on the user's look, which part E starts from.
- [x] **A3-3, A1-5's two open points and B–F:** `state` needs nothing more (no measure scrolls) and the replay hooks are `load` alone (no board draws a fling or a jump); B–F split as listed under "Parts": B1 and B2, C1 and C2, D1 (code, reviewed before the runs) and D2 (the ~1.5 h runs), E, F.

### Part B1: the data, the scenario, and the feed fixture

**Done when:**
- [x] **B1-1, the data:** `prep.ts --only wall` writes the wall's file from `contenders/wall/`'s 400 by `prep-wall.sql`, after the US-listing check and checks that no symbol repeats market watch's or another of the wall's, and records it in `MANIFEST.json`, credited as the observatory's own and synthetic.
  *Evidence* ([results](perf/results/2026-11-10-m13-b1.md)): `wall-instruments.parquet`, 400 rows, 3,716 B, one row group, SHA-256 `5cbf2407…`, with the columns `Desk`, `Symbol`, `Last`, `Change %`, `Volume`. The listing check read 5,607 + 7,674 securities (the AAPL and IBM control) and found none of the 400. The manifest entry: credit "Fictional instruments, the observatory's own: synthetic", CC0 1.0. Market watch's file rebuilt to its SHA-256 of record. The instruments moved from the spike to `contenders/wall/instruments.ts` (the desks' names in `names.ts`, and `desks.ts` a stop's first N desks); the spike imports them from there.
- [x] **B1-2, the scenario:** `MONITORING_WALL` and `LEVEL_FEATURES.wall` in `contenders/scenarios.ts`, on neither side's `BUILT` and not in `SCENARIOS`.
  *Evidence:* `wall` is `custom-cells`, `live`, `format`, `density`. `MONITORING_WALL` (`monitoring-wall`, file `wall-instruments.parquet`) has the stops `4`, `6`, `8` (`TablesStop.tables`), default `6`, seed `0x3a11`, 2k a table, the desks' names, market watch's signs and flash shared, and the canvas's grid. It's in `ALL_SCENARIOS` only; `cell-fixture` lists it as unsampled. Lint passes (tsc, clippy, check-terms). Every contender's first-paint JS grows 141–185 B brotli, inside its budget.
- [x] **B1-3, the feed fixture at 400 rows:** `contenders/wall/fixtures/`, written by market watch's `write.ts` widened, run by GPUI's native store and TanStack's `QuoteStore` with the dropped-tick control; market watch's fixture regenerated byte-identical.
  *Evidence:* `Feed` takes its instruments' prices, market watch's 50 by default. `write.ts` writes both fixtures, and `--check` passes both, market watch's unchanged (`c824a33a…`). The wall's holds 2,000 ticks over 400 instruments in 10 batches (`975414de…`), and each stop's feed bytes by SHA-256 (4: `ed3547cc…`, 6: `6cb23d78…`, 8: the fixture's own), which TanStack's test regenerates through `wallInstruments(N)` (its control: 4 desks' bytes aren't 6's). GPUI's `market::tests` and TanStack's `market.test.ts` run each fixture with the three controls (a skipped trade, a conflated batch, another change %), and each control fails both. A store of market watch's 50 refuses the wall's batches, on both sides. One volume changed in the wall's fixture failed GPUI's test. `just observatory fixtures` passes.
- [x] **B1-4, the contract for N tables:** `docs/contender-contract.md`'s changes from A1-5's list.
  *Evidence:* the marks table's `filled` (across the tables), `failed` (the wall's file), and `refreshed` (any table's, each table's generation); the state (`__contenderRefreshed` an array, a batch's per-table generations and visible mask, `state.tables`); the wall's feed paragraph; the readout's ring and Shown in pooled across the tables; keeps up on the wall's stops; the targets (the first table's) and the replay (`open()` alone).

### Part B2: the GPUI contender at the level

**Done when:**
- [x] **B2-1, the level's build:** the crate's feature `wall` (the table's and the bridge's `custom-cells`, `live`, `format`, `density`), market watch's store, feed, and ring shared under `cfg(any(feature = "market", feature = "wall"))`; `wall` in `BUILT.gpui`; market watch's wasm byte-identical.
  *Evidence* ([results](perf/results/2026-11-10-m13-b2.md)): `sizes --check` passes, the wall's features exactly `LEVEL_FEATURES.wall`, no panel, no home path. Its wasm is 2,798.8 KiB brotli (+4.0 KiB against market watch's). Market watch's wasm built from this tree is byte-identical to HEAD's (`5e65b0bf…`), and so are the base's and the tail's. The wide level's moved one byte, a panic location's line in `scene.rs`. The wall's host is a module of its own in the bare host's place (`src/wall.rs`; [`docs/DECISIONS.md`](docs/DECISIONS.md), "GPUI contender").
- [x] **B2-2, N tables in the stop's grid:** two rows of N / 2, the gap, the titles, the canvas's columns, rows, and text; a phone's one column scrolled from a title or a gap.
  *Evidence:* `perf/wall.ts` draws 8 tables of 50 rows × 4 columns at 2560×2600. On a phone (390×844, 4 tables), a wheel over a table scrolls that table (top 120) and holds the column, and a wheel over a gap moves the column. The phone's tables are 212 px, not 196, so each shows its 6 rows whole above the table's scrollbar room ([`docs/DECISIONS.md`](docs/DECISIONS.md), "Page"; decided with the user).
- [x] **B2-3, the feed and the marks across the tables:** one fold a batch, each table's ticked rows invalidated; `filled` across the tables, `refreshed` per frame, `__contenderRefreshed` per table, each batch's generations and mask, the readout's ring pooled.
  *Evidence:* the fixture's 2,000 ticks at 8 tables drawn in all 1,600 cells as the fixture has them, light and dark; the control (1,999 ticks) differs in 7. At 4, 6, and 8 tables: one `filled` right after a presented frame, every sampled refreshed mark right after one, every batch reached in order with a generation per table, 154–156 of 155–157 visible batches paired across their tables (send → mark p50 12.5, 14.0, 16.4 ms). None of the marks unmeasured. The wall's natively tested numbers and source pass (`cargo test -p tall-table-gpui --features wall -- market:: scene::wall::`, in `fixtures`).
- [x] **B2-4, its budgets:** `gpui-wall-ttfp`, `-ttfp-throttled`, and `-wasm` against a baseline of their own.
  *Evidence:* the cold runs (`2026-11-10-gpui-cold-wall.json`): TTFP 160.5 ms reference and 3,633.9 ms throttled, the wasm 2,798.8 KiB, written as `levels.wall`. The placeholder matches the wall's first frame (`placeholder --level wall`).
- [x] **B2-5, the check script's GPUI half:** `perf/wall.ts` (`just observatory wall`, in `check`): the fixture's ticks drawn, each table's cells, the marks right after presented frames, every batch reached, an unknown stop failing.
  *Evidence:* it passes ([`2026-11-10-m13-b2-wall.json`](perf/results/2026-11-10-m13-b2-wall.json)). The worker's 404, an unknown scenario, `?ticks=x`, and the wall on the base build also fail. `lint` and `fixtures` pass.

### Part C1: the TanStack contender at the level

**Done when:**
- [x] **C1-1, the level's build:** `wall` in `BUILT.tanstack`, its code behind `__LEVEL__ === 'wall'` (and `live`'s branches widened to it), `wall.css`; market watch's bundle unchanged, and every other level's.
  *Evidence* ([results](perf/results/2026-11-10-m13-c1.md)): the base, wide, market, and tail builds from this tree are byte-identical to HEAD's, every file of each `dist*/` by SHA-256. The wall's sidebar color comes from a generated file of its own (`wall-theme.css`, `theme_css.rs`), so `theme.css`, in every level's CSS, is unchanged. The wall's data layer is a module of its own (`data/wall.ts`), not market watch's `quotes.ts` shared.
- [x] **C1-2, N tables in one React tree:** each desk the contender's own table (its scroller, its TanStack Virtual, its paging over the desk's 50 rows of one store, in hand), in two rows of N / 2 with the titles, the gutter, the grid's columns, rows, and text; a phone's one column, the frame scrolling and each table's scroller chaining into it.
  *Evidence:* screenshots at 6 tables light, 8 dark, and a phone (390×844, 4 tables) beside the GPUI side's, the same grid and cells; `perf/wall.ts`'s phone check (a wheel over a table scrolls it, top 120, and holds the column; a wheel over a gap moves it). The header and rows span the frame as the tall table's do (the columns are narrower than it at every stop).
- [x] **C1-3, the fold, the flash, and the marks:** one fold a batch, each desk's ticked runs invalidated; every table with a landed page committed in one `flushSync` a frame; `filled` across the tables; one `refreshed` after each commit that draws any table's re-read, `__contenderRefreshed` an entry a table; each batch's generations and mask; the readout's ring pooled.
  *Evidence:* `perf/wall.ts` passes on both sides ([`2026-11-10-m13-c1-wall.json`](perf/results/2026-11-10-m13-c1-wall.json)): the fixture's 2,000 ticks at 8 tables drawn in all 1,600 cells as the fixture has them, light and dark, the 1,999-tick control differing in 7; Last alone flashing, at the mix; at 4, 6, and 8 tables one `filled`, every batch reached in order with a generation a table, 151–155 of 151–155 visible batches paired across their tables (send → mark p50 10.9, 11.4, 13.3 ms); each cell's Element Timing name its instrument's row, unique across the tables; none of the marks unmeasured; the worker's 404, an unknown stop or scenario, `?ticks=x`, and the wall on the base build failing. `test/wall.test.ts` (the file's check, the seed, a desk's reads in hand, a fold's generations and mask with its control, the fixture through the fold, the pooled ring) in `npm test`.
- [x] **C1-4, its budgets:** `tanstack-wall-first-paint-js` and `-data-layer-js` against a baseline of their own.
  *Evidence:* first-paint JS 76.9 KiB and the data layer 43.4 KiB brotli ([`2026-11-10-m13-c1-tanstack-sizes-wall.json`](perf/results/2026-11-10-m13-c1-tanstack-sizes-wall.json)), written as `levels.wall`; every level's `tanstack-sizes --check`, `engine-files --controls` (the wall's `duckdb/` the base's), `lint`, and `page --check` pass.


### Part C2: the same on both sides

**Done when:**
- [x] **C2-1, `perf/wall.ts` on both sides:** each table's cells byte-identical after a fixed run of ticks, the same grid, widths, and gutter, each with a control.
  *Evidence* ([results](perf/results/2026-11-10-m13-c2.md), [`2026-11-10-m13-c2-wall.json`](perf/results/2026-11-10-m13-c2-wall.json)): after the fixture's 2,000 ticks at 8 tables, 1,600 cells' exact and shown text the same on both sides; the control (TanStack's fold one tick short) differs in 3. Each table's frame (its four edges) and cells within 1 px, its row height, and its columns' x and width the same at 4, 6, and 8 tables, on a phone's column, and in the fold's 2560×2600 grid (`perf/wall-grid.ts`); the control (TanStack's tables moved 2 px) differs in every table at each. Each wall table publishes its `layout` and `box` with `?cells` on both sides ([`docs/contender-contract.md`](docs/contender-contract.md)): GPUI's wall wasm +1.2 KiB brotli against HEAD, TanStack's first-paint JS +0.1 KiB, both inside their budgets; every other TanStack level byte-identical.
- [x] **C2-2, `tanstack-contract` at the level:** the first screen hydrated in place, the marks in order, the probe key, filled presented across the tables, the batches and the generations, the replay's `open()` alone, nothing unmeasured, the relay.
  *Evidence:* [`2026-11-10-m13-c2-tanstack-contract.json`](perf/results/2026-11-10-m13-c2-tanstack-contract.json): at 6 tables, the cells' last paint 16.2 ms after filled with every table's visible rows painted; 78 batches in order, each with 6 generations, 78 refreshed marks, each table's generation drawn its last; `open()` refilled every table and ended the feed; `fling()` and `jump()` refused; 22 marks relayed.
- [x] **C2-3, `tanstack-parity` at the level:** the grid, the flash, and the sign colors, light and dark, in Chromium, Firefox, and WebKit.
  *Evidence:* [`2026-11-10-m13-c2-tanstack-parity.json`](perf/results/2026-11-10-m13-c2-tanstack-parity.json): in each browser at its defaults, the grid at 4, 6, 8, and a phone's column as the GPUI contender's (its control differing in every table); Chg % in the rise's or the fall's color by sign, Last alone flashing in all 6 tables at the mix, and a 200-tick feed lighting 20 cells whose fade ends, light and dark. One full run failed in the tail level's WebKit section (the view a frame behind the clock at the instant read), which this part doesn't touch; the two WebKit runs after it and the full run above passed.
- [x] **C2-4, all of it in `check`:** `wall`, `tanstack-contract`, and `tanstack-parity` run there with their wall sections.
  *Evidence:* each passes on its own (above), as do `lint`, `sizes --check`, `tanstack-sizes --level wall --check`, `cold --level wall --check` (TTFP 165.6 ms, limit 176.6), and `placeholder --level wall`. The full `check` wasn't run in this session.


### Part D1: the metrics at the level

**Done when:**
- [x] **D1-1, the feed's pairing across the tables:** `metric feed --scenario monitoring-wall` at every stop, each batch paired with the first frame at which every table in its mask has drawn the generation it names there (`feedFrames`), market watch's pairing unchanged.
  *Evidence* ([results](perf/results/2026-11-10-m13-d1.md)): `feedFrames` takes a generation a table and a mask (`batchVisible`, `drawnReaches`), and keeps a cursor over the send times alone (on the wall a later batch's frame can come first). Over 2,000 random market-shaped feeds it paired every batch as the old one-pass code did, and a wall case with one table a frame late paired across it. The smoke run (1 run, both sides, both devices, 4, 6, and 8 tables) passed, every batch visible and paired. The slow device read 99.3, 93.8, and 69.2% on GPUI and 89.5, 55.1, and 34.6% on TanStack, where A2's spike put them. Market watch's feed at 1k still passes.
- [x] **D1-2, once a scenario: `usable`, `data`, and `memory` at the level** (6 tables): usable confirmed by the probe, time to data every table's visible rows filled, memory after `?ticks=60000` with Download by kind.
  *Evidence:* all three pass on both sides and devices (1 run each). Usable was confirmed and guarded on GPUI (139.3 ms reference) and confirmed on TanStack (38.3 ms). Data waits for GPUI's `filled` across the tables, and on TanStack for the latest paint among every table's visible rows (`row:<50t + r>`; 197.9 and 205.4 ms). Memory folded 60,000 ticks on both sides, with each table's last re-read drawn (`fedTicks` per table), the cache at 4,000 B open and at the end in every run. Download by kind came from the same run: GPUI 2,801.2 KiB wasm, TanStack 122.5 KiB JS, the engine about 5.7 MiB on each.
- [x] **D1-3, the same rows on both sides** (inserted: the data smoke read 16 visible rows a table on GPUI and 17 on TanStack). Each TanStack wall table keeps the tall table's 16 px scrollbar room under its rows; `gridDiffers` compares the rows each table shows, with a control.
  *Evidence:* decided with the user ([`docs/DECISIONS.md`](docs/DECISIONS.md), "TanStack contender"); the room less the table's own horizontal bar after the review (`wall.ts`'s `keepBarRoom`, D1-4). TanStack now shows 16 rows a table at 4, 6, and 8 (`state.end` and its cells), and data's smoke reads 96 rows on both sides. `perf/wall.ts` passes on both sides with the rows shown compared at each grid and a phone's column. The control (one more row shown) differs in every table at each grid; the first run's control differed in none, which showed the grids had dropped their cells. `tanstack-parity` passes in full ([`2026-11-10-m13-d1-tanstack-parity.json`](perf/results/2026-11-10-m13-d1-tanstack-parity.json)): in Chromium, Firefox, and WebKit the wall's grid and rows shown match GPUI's at 4, 6, 8, and a phone's column, and both controls differ in every table. `tanstack-sizes --level wall --check` passes: first-paint JS 77.1 KiB, limit 84.6. `lint` passes.
- [x] **D1-4, the code review** (the user's `/code-review high`), before D2's runs: its 8 findings fixed.
  *Evidence* ([results](perf/results/2026-11-10-m13-d1.md), "After the code review"):
  - Under a classic scrollbar TanStack kept the whole room and showed a row fewer. The room is now 16 px less the bar's height. `perf/wall.ts` forces a 15 px bar on 8 overflowing tables (1200×900), and every table shows 16 rows; the control (the room kept whole) shows fewer in all 8.
  - The batches counted are now one rule: `batchVisible` and `drawnReaches`, which `perf/wall.ts` now pairs with too.
  - `metric feed` and `perf/wall.ts` share one refreshed recorder and one wait (`fedTicks`, a running tally on the page).
  - The pairing's scan stops at the window's end, and `metric data` checks `state.tables` on both sides.
  - The base, wide, market, and tail TanStack builds are byte-identical with and without this part's TanStack changes.
  - Passing after the fixes: `perf/wall.ts` on both sides; `tanstack-contract`; `tanstack-parity` in full, its wall grid and rows in all three browsers; `tanstack-sizes --level wall --check` (77.2 KiB, limit 84.6); `lint`.
  - The smoke runs again (1 run): the feed at 6 tables (GPUI 99.4 / 92.7%, TanStack 96.9 / 56.7%, reference / throttled), memory (60,000 ticks, cache equal), and data at the reference (96 rows on both sides).


### Part D2: the runs

**Done when:**
- [x] **D2-1, the feed at each stop:** 4, 6, and 8 tables, both sides, both devices, 10 runs, each file labelled `monitoring-wall-<stop>` with its versions.
  *Evidence* ([results](perf/results/2026-11-11-m13-d2.md), `2026-11-11-m13-d2-feed-monitoring-wall-{4,6,8}.json`): all 120 runs passed, gpui-kit 0.9.1. Keeps up, throttled: GPUI 97.2, 95.5, and 80.0%; TanStack 97.4, 68.8, and 43.3%. Both sides keep up at every stop at the reference (96.3–99.2%). On a slow device GPUI keeps up through 6 tables and TanStack only at 4, the edges A2's spike found. Collections in 10 s: GPUI 3–4, TanStack 22–33, of which 20–22 land in a late frame at 6 and 8 throttled. The throttle control read 4.09–4.18× in every throttled run, its busy loop's spread at most 1.4%.
- [x] **D2-2, once a scenario at 6 tables:** usable, data, and memory, both sides, both devices, 10 runs.
  *Evidence:* usable 139.3 ms GPUI (confirmed and guarded 10/10) against 39.9 TanStack at the reference. Time to data 188.0 against 201.8 ms. Memory after 60,000 ticks, less the canvas, 14.1 against 5.2 MiB. Download 2,801.2 KiB wasm against 122.7 KiB JS, with the engine ~5.7 MiB on each. Every published run passed. `usable` ran twice: the first set lost one TanStack run's trace mark, so the whole metric ran again alternated, 40 of 40 passing, and the first set is in `raw/`.
- [x] **D2-3, the 0.9.0 against 0.9.1 A/B** (GPUI only, reference, median of 10: `metric response` and the wide sheet's `scroll` at `rows-20`).
  *Evidence:* interleaved, 10 rounds of one cold run a version, the order alternating; each file's gpui-kit read from its build's wasm. Paired by round, every median difference is under 2% (key −0.02 ms, track −0.24, wheel +0.22; work down +0.04, sideways +0.05, fast −0.02) and none is distinguishable from zero (sign tests p ≥ 0.34). So the published scenarios keep their 0.9.0 labels (root [`docs/DECISIONS.md`](../../docs/DECISIONS.md), "Comparison protocol", 2026-11-11). Found on the way and fixed in `perf/contender.ts`: `versions` recorded the lock's gpui-kit, not the served build's, and a shared label could overwrite a results file.

---

## Next milestones

The "done when" checks are drafts until their milestone becomes active. The scenarios (M9–M13; M13 now active, above) are in the research's build order ([`docs/research/scenarios.md`](docs/research/scenarios.md), where each one's workload, measures, dial, and needs are); each scenario's research and spec open its milestone as part A, as the table's features do, and its later parts are split there.

**Every scenario milestone** (decided 2026-10-30, [`docs/DECISIONS.md`](docs/DECISIONS.md), "Scenarios"), each item a "done when" check of its own:
- **Its builds:** each contender builds once per feature level (Cargo features are compile-time, and the same scope keeps a level's code out of every other's bundle), at a base of its own under the contender's (`contenders/paths.ts`), staged and served beside the others, with its TTFP and wasm (or first-paint JS) budgets in `perf/budgets.json`, gated by `check` (root rule 1). A scenario on a level that exists shares its build (the admin table the base's; the monitoring wall has a level of its own, `wall`, since it needs `density`, which market watch's lacks).
- **Its data credited:** the credit on the page and in the README, the license in `MANIFEST.json`; a synthetic feed is labelled synthetic on the page.
- **Its runs:** `check` gates its builds' budgets and runs its smoke, fixtures, and contract checks, never the full protocol. The full cold protocol (its stops × both sides × both devices × 10 runs, and its soaks) runs once, in its numbers part, on the final build (a long run: ask about a code review first); its part A estimates that time before fixing the stops. Its results files are labelled with its name, so it re-runs without the others.
- **Its versions:** each results file records what it was measured with (gpui-kit, React, TanStack Virtual, Arrow, DuckDB-Wasm, Chromium), and the scenario's explainer shows them ("measured with …"). A bump of any of them re-measures the scenarios it touches or labels their numbers with the versions they came from, decided per bump.

### M14: The wide sheet's later steps: a resize drag, a range copied

The research's later steps for the wide sheet ([`docs/research/scenarios.md`](docs/research/scenarios.md), "Wide sheet"): a column-resize drag, and a range selected and copied. They come after the other scenarios (decided with the user, 2026-11-04). Their features are *Ready* ("Waiting on"). **The wide level grows** (decided with the user, 2026-11-04): its one build on each side gains the table's `resize`, `select`, and `copy` and their counterparts, so a visitor resizes and copies in the frame they scroll. No second wide build and no switch between them. The same scope still holds: the base level carries none of it. Because each side's bundle grows, the wide sheet's numbers are measured again at the grown level and replace M9's.

- **The GPUI side:** the crate's feature `wide` turns on `resize`, `select`, and `copy` (and the bridge's), the host writing the clipboard through `tall-table-bridge`'s `clipboard::Clipboard`, the key columns resizable as `pin` allows, the copy's limits the table's defaults (`key_max_cells`, `max_bytes`), and a declined copy said in the window. New contract marks for the measures below; `docs/contender-contract.md` gains them.
- **The TanStack side:** each feature's counterpart on its scroll model, ported from the table's own logic as the paging is. The resize band, its drag (live, clamped, the sideways scroll held until the release) and double-click fit, and a pinned column's limit. The selection model (`Rows`, `Columns`, `Cells` from an anchor to a head; the pointer, the keys, the tint and the active cell's edge). The copy: tab-separated exact values (`format.ts`), read a page at a time beside the cache, the same caps and events, the clipboard written as the bridge writes it (`ClipboardItem` with a promise opened at the key).
- **Fixtures prove "the same":** `cells.json`'s `resize` section (skipped by the TanStack contender today) and `selection.json` in TS with their controls, and a copy fixture of the component's (a range → its text, exact; the caps) if the table has none, asked of the component's PLAN, never written here. `tanstack-parity` gains the resize band and drag, the selection's pointer and keys, and Cmd+C.
- **The measures** (the research's, made exact in part A): a resize drag's frame cost (each frame's work while a day's column is dragged, both sides, at each stop), a selection drag's, and a copy's time (the key → the clipboard written) for a range under `key_max_cells` and for one past it confirmed (the copy's turns spread over frames: does the view keep up meanwhile?).
- **The page:** how the window offers the tools and where their numbers go (the status bar, the panel's cards, the description), designed first: new boards on M8's canvas, light and dark, desktop and phone, decided with the user before anything is built (the canvas draws none of it today). The admin table's capability list (M12) may already say GPUI's selection by then; part A checks the two read as one story.
- **Parts (draft):** A, the design and the spec (the boards, the measures and their scripts, the suite's time); B, the GPUI side at the grown level (its wasm and TTFP against the level's baselines, rewritten); C, the TanStack side (its first-paint JS and data layer against the level's baselines); D, the numbers (the wide sheet's whole cold suite at the grown level, then the new measures: a long run, so a code review first); E, the page; F, shipped (the README's sections, `burst`, the deploy, `worker-check`).

**Done when** (draft):
1. **Its builds:** the wide level on both sides carries `resize`, `select`, `copy` and their counterparts, and nothing else new; the base level byte-identical to before; the level's budgets (`gpui-wide-*`, `tanstack-wide-*`) against rewritten baselines, gated by `check`, with each feature's added bytes in a results note.
2. **The same on both sides:** the fixtures above pass on both sides with their controls; `tanstack-parity` covers the band, the drag, the selection's input, and the copy, in Chromium, Firefox, and WebKit; a copied range's text is byte-identical on both sides and against native DuckDB's values.
3. **Its numbers:** the wide sheet's cold suite again at every stop (M9's measures, replacing part D's on the page and in the README), and the new measures, both sides, both devices, median of 10, each results file with its versions; a results note.
4. **The page:** the tools in the window and their numbers as the design draws them; `page --check` covers them.
5. **Shipped:** the README's wide sheet sections with the new rows by `report`, `burst` under the zone's limit, the deploy, `worker-check`.

---

## Measurements

Generated by `just observatory report` from [`perf/budgets.json`](perf/budgets.json) and the newest matching file in `perf/results/`; don't edit between the markers. A metric's history is its dated results files.

<!-- report:plan:start -->
| Metric | Budget | Gate | Local | Production | From |
|---|---|---|---|---|---|
| GPUI contender: time to first paint | ≤ 187.6 ms (baseline 170.5 + 10%) | `check` | 170.5 ms | 329.5 ms | [2026-10-16-m2-b-gpui-cold](perf/results/2026-10-16-m2-b-gpui-cold.json), [2026-10-21-gpui-cold-production](perf/results/2026-10-21-gpui-cold-production.json) |
| GPUI contender: time to first paint, throttled | — | recorded | 3502.5 ms | 3550.5 ms | [2026-10-16-m2-b-gpui-cold](perf/results/2026-10-16-m2-b-gpui-cold.json), [2026-10-21-gpui-cold-production](perf/results/2026-10-21-gpui-cold-production.json) |
| GPUI contender: wasm (brotli) | ≤ 3113.3 KiB (baseline 2707.2 + 15%) | `check` | 2695.4 KiB | — | [2026-10-16-m2-b-gpui-cold](perf/results/2026-10-16-m2-b-gpui-cold.json) |
| GPUI contender at the wide level: time to first paint | ≤ 198.9 ms (baseline 180.8 + 10%) | `check` | 180.8 ms | — | [2026-11-02-gpui-cold-wide](perf/results/2026-11-02-gpui-cold-wide.json) |
| GPUI contender at the wide level: time to first paint, throttled | — | recorded | 3585.2 ms | — | [2026-11-02-gpui-cold-wide](perf/results/2026-11-02-gpui-cold-wide.json) |
| GPUI contender at the wide level: wasm (brotli) | ≤ 3191.2 KiB (baseline 2775 + 15%) | `check` | 2775 KiB | — | [2026-11-02-gpui-cold-wide](perf/results/2026-11-02-gpui-cold-wide.json) |
| GPUI contender at the market level: time to first paint | ≤ 195.8 ms (baseline 178 + 10%) | `check` | 178 ms | — | [2026-11-05-gpui-cold-market](perf/results/2026-11-05-gpui-cold-market.json) |
| GPUI contender at the market level: time to first paint, throttled | — | recorded | 3610.4 ms | — | [2026-11-05-gpui-cold-market](perf/results/2026-11-05-gpui-cold-market.json) |
| GPUI contender at the market level: wasm (brotli) | ≤ 3209.2 KiB (baseline 2790.6 + 15%) | `check` | 2790.6 KiB | — | [2026-11-05-gpui-cold-market](perf/results/2026-11-05-gpui-cold-market.json) |
| GPUI contender at the tail level: time to first paint | ≤ 189 ms (baseline 171.8 + 10%) | `check` | 171.8 ms | — | [2026-11-07-gpui-cold-tail](perf/results/2026-11-07-gpui-cold-tail.json) |
| GPUI contender at the tail level: time to first paint, throttled | — | recorded | 3595.2 ms | — | [2026-11-07-gpui-cold-tail](perf/results/2026-11-07-gpui-cold-tail.json) |
| GPUI contender at the tail level: wasm (brotli) | ≤ 3208.7 KiB (baseline 2790.2 + 15%) | `check` | 2790.2 KiB | — | [2026-11-07-gpui-cold-tail](perf/results/2026-11-07-gpui-cold-tail.json) |
| GPUI contender at the wall level: time to first paint | ≤ 176.6 ms (baseline 160.5 + 10%) | `check` | 160.5 ms | — | [2026-11-10-gpui-cold-wall](perf/results/2026-11-10-gpui-cold-wall.json) |
| GPUI contender at the wall level: time to first paint, throttled | — | recorded | 3633.9 ms | — | [2026-11-10-gpui-cold-wall](perf/results/2026-11-10-gpui-cold-wall.json) |
| GPUI contender at the wall level: wasm (brotli) | ≤ 3218.6 KiB (baseline 2798.8 + 15%) | `check` | 2798.8 KiB | — | [2026-11-10-gpui-cold-wall](perf/results/2026-11-10-gpui-cold-wall.json) |
| TanStack contender: first-paint JS (brotli) | ≤ 79.3 KiB (baseline 72.1 + 10%) | `check` | 73.8 KiB | — | [2026-11-09-m12-b1-tanstack-sizes](perf/results/2026-11-09-m12-b1-tanstack-sizes.json) |
| TanStack contender at the wide level: first-paint JS (brotli) | ≤ 84.5 KiB (baseline 76.8 + 10%) | `check` | 77.7 KiB | — | [2026-11-09-m12-b1-tanstack-sizes-wide](perf/results/2026-11-09-m12-b1-tanstack-sizes-wide.json) |
| TanStack contender at the market level: first-paint JS (brotli) | ≤ 83.1 KiB (baseline 75.5 + 10%) | `check` | 75.9 KiB | — | [2026-11-09-m12-b1-tanstack-sizes-market](perf/results/2026-11-09-m12-b1-tanstack-sizes-market.json) |
| TanStack contender at the tail level: first-paint JS (brotli) | ≤ 84.2 KiB (baseline 76.5 + 10%) | `check` | 76.9 KiB | — | [2026-11-09-m12-b1-tanstack-sizes-tail](perf/results/2026-11-09-m12-b1-tanstack-sizes-tail.json) |
| TanStack contender at the wall level: first-paint JS (brotli) | ≤ 84.6 KiB (baseline 76.9 + 10%) | `check` | 76.9 KiB | — | [2026-11-10-m13-c1-tanstack-sizes-wall](perf/results/2026-11-10-m13-c1-tanstack-sizes-wall.json) |
| TanStack contender: data layer and Arrow, after first paint (brotli) | ≤ 38.2 KiB (baseline 34.7 + 10%) | `check` | 34.8 KiB | — | [2026-11-09-m12-b1-tanstack-sizes](perf/results/2026-11-09-m12-b1-tanstack-sizes.json) |
| TanStack contender at the wide level: data layer and Arrow, after first paint (brotli) | ≤ 38.3 KiB (baseline 34.8 + 10%) | `check` | 34.8 KiB | — | [2026-11-09-m12-b1-tanstack-sizes-wide](perf/results/2026-11-09-m12-b1-tanstack-sizes-wide.json) |
| TanStack contender at the market level: data layer and Arrow, after first paint (brotli) | ≤ 44.8 KiB (baseline 40.7 + 10%) | `check` | 40.9 KiB | — | [2026-11-09-m12-b1-tanstack-sizes-market](perf/results/2026-11-09-m12-b1-tanstack-sizes-market.json) |
| TanStack contender at the tail level: data layer and Arrow, after first paint (brotli) | ≤ 42.6 KiB (baseline 38.7 + 10%) | `check` | 39.2 KiB | — | [2026-11-09-m12-b1-tanstack-sizes-tail](perf/results/2026-11-09-m12-b1-tanstack-sizes-tail.json) |
| TanStack contender at the wall level: data layer and Arrow, after first paint (brotli) | ≤ 47.7 KiB (baseline 43.4 + 10%) | `check` | 43.4 KiB | — | [2026-11-10-m13-c1-tanstack-sizes-wall](perf/results/2026-11-10-m13-c1-tanstack-sizes-wall.json) |
| Page: first paint (paint timing), /observatory/tall-table/big-file/ | ≤ 72.5 ms (baseline 60.4 + 20%) | `check` | 60.4 ms | 210.2 ms | [2026-11-10-m12-d-page](perf/results/2026-11-10-m12-d-page.json), [2026-10-21-page-production](perf/results/2026-10-21-page-production.json) |
| Page: first paint (paint timing), throttled | — | recorded | 439.3 ms | 474.7 ms | [2026-11-10-m12-d-page](perf/results/2026-11-10-m12-d-page.json), [2026-10-21-page-production](perf/results/2026-10-21-page-production.json) |
| Page: first-paint JS (brotli) | ≤ 95.5 KiB (baseline 86.8 + 10%) | `check` | 86.8 KiB | — | [2026-11-10-m12-d-page](perf/results/2026-11-10-m12-d-page.json) |
| Requests in the busiest 10 s, one visitor (the zone's rate limit counts per IP) | — | recorded | 142 requests | — | [2026-11-10-m12-e-burst](perf/results/2026-11-10-m12-e-burst.json) |
<!-- report:plan:end -->

---

## Long-term goals

Not milestones. Each starts with research.

- **A scenario's advanced panel:** its parameters beyond the stops, a later toggle, its readings labelled warm and never published ([`docs/research/scenarios.md`](docs/research/scenarios.md)). The scenarios themselves are M9–M13 ("Next milestones").
- **A third contender: Glide Data Grid** (GPUI | TanStack / Glide): a DOM-hosted canvas grid, which would separate "canvas vs DOM" from "Wasm vs JS" (the scenarios' mechanisms A against B and C, [`docs/research/scenarios.md`](docs/research/scenarios.md)). Another contender app against the same GPUI side, under the same protocol. It may never happen.
- **A dataset easier to read at a glance** than a sea of floats, within the static-asset budget. The wide sheet's heat and bar cells answer part of it.
- **Feature levels:** a level adds a table feature on both sides (root `CLAUDE.md`, "Comparison protocol"), each feature's cost measured against the base. A level comes in with the scenario that needs it, not on its own. The features, their order, and each one's TanStack counterpart are in [the table's `PLAN.md`](../../components/tall-table/PLAN.md); a level is a milestone here that links to it.
- **The benchmark button:** "Run benchmark" plays a scripted session on each side in turn (the order alternated between runs), drives each through its own input path (script-made wheel events reach GPUI's listeners but never scroll a native scroller, so the DOM side is driven through its scroll position), and shows the results labelled warm beside the cold ones, from production too. Deferred: at the base level its session (load, fling, jump to 90%) replays what the cold numbers already show, a workload on which the GPUI side reads mostly as heavier in memory. It's worth building once the scenarios exist: it then sweeps a scenario's stops on each side and draws each side's curve, where each one stops keeping up. The status bar keeps it, disabled.
- **Future UI improvements** (ideas, none designed; each is drawn on M8's canvas, light and dark, desktop and phone, and decided with the user before it's built, on both sides):
  - **Live tail's "Back to the tail" button,** shown once a reader has let go of the tail (the table's `Following(false)`, its README's suggestion), returning the view to the tail and following again. Until then the way back is the table's own: End, or a move that reaches the end.
- **Dropping your own file:** out of the base level. It would widen the cell fixtures to every column kind (decimals, timestamps, 128-bit integers). Opening any dataset (a dropped file, HuggingFace) is Tycho's, as a utility app's job.

---

## Open questions

- **The base level's wheel readings.** A bare `mouse.wheel` reaches a native scroller's compositor every other frame in headless Chromium (`perf/results/2026-11-02-m9-a2.md`), and the base level's TanStack fling and Smooth were read through it. Whether to re-measure them on the gesture scroll, which the wide sheet uses from part D on (`docs/DECISIONS.md`, "Measurement"), and say so on the page meanwhile, is open; so is whether a real trackpad in a headed Chromium matches the gesture's rate.
- **The DOM's fling, read from its compositor.** The fling's late frames and lag are main-thread readings on both sides (`underLoad`), which on GPUI are the presented frames but on the DOM aren't: its compositor scrolls on through a late main-thread frame. The README says so. Whether the DOM side should also report what its compositor presented (`cc`'s frames and `Scroll Delta This Frame`, as the wheel's guard reads them) beside it, and which reading the page headlines, is a protocol change for root `docs/DECISIONS.md`.
- **A short page's missing cells.** The tall table draws a value past a page's end as `NULL` (`render_body`'s `unwrap_or(CellValue::Null)`); the TanStack contender draws it empty. A static file never answers short, so nothing measured differs; whether the component should draw it empty too is the component's call (Tycho drives it).

- **GPUI's key at the wide level.** In 6 of 120 key inputs (`perf/results/2026-11-03-m9-d.md`) no `EventLatency` of GPUI's key reached a frame, though the view moved and filled; the base level read all 120. And GPUI's first usable at the wide level was confirmed in 8 of 10 reference runs, its probe frame ~3 ms later than the base's. Whether either is Chromium's attribution or GPUI's first frames after usable doing more at the level is untested.

- **The pill's compositor frames.** Throttled, the meter as a pill dropped more compositor frames than hidden on both sides (TanStack 7.98% against 3.5%, GPUI 4.21% against 0), while the open meter dropped none more (`perf/results/2026-10-21-m5-d4.md`). The pill isn't the default, so nothing gates it; whether it should get a layer of its own (`will-change: transform`, as the open meter has), and whether that's the cause, is untested.
- **GPUI's lost mark offsets upstream.** gpui-pre-wgpu 0.3.11 drops cosmic-text's `x_offset` and `y_offset` (`perf/results/2026-11-09-m12-a2.md`), and 0.3.12 (gpui-kit 0.9.1) still does: its `cosmic_text_system.rs` is byte-identical. The user files the issue; whether a fix lands before part C, so the shaping verdicts are measured on it, is open.
- **The landing page.** The observatory's Worker holds the apex `seiza.io` (everything outside `/observatory/` a 404). The page is basic (a title, a catchy line, a link to the observatory), built in `site/landing/` on `site/ui/`'s shell (root `docs/DECISIONS.md`, "Repo structure"); when it ships is open. Shipping it moves the Worker to `site/worker/` and adds `/`, `/index.html`, and `/assets/` to the seiza.io WAF rule (`/fonts/` is in it already).
