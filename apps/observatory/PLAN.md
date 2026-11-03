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
| M9 | Scenario: wide sheet | Active: part A1 done 2026-11-02; next, part A2 |
| M10 | Scenario: market watch | Planned |
| M11 | Scenario: live tail | Planned |
| M12 | Scenario: admin table (the control) | Planned |
| M13 | Scenario: monitoring wall | Planned |

**Parts are sized to one working session.** Each ends with its own checks passing and its evidence written down, so the next session starts from this file, not from the last one's context. A part that grows past a session splits before it's started, not halfway through.

**Closing a milestone:** as for every app (root `CLAUDE.md`, "Working agreements"): every "done when" check passes; the numbers are in `perf/results/` with a note; new decisions are in `docs/DECISIONS.md` (repo-wide ones in the root's); a `docs/LESSONS.md` entry is written; and the milestone's spec and evidence move from here to `docs/milestones.md`, leaving one row above.

**Component and engine changes:** the observatory consumes the tall table and the DuckDB engine; it doesn't reshape them (root `docs/DECISIONS.md`, "Repo structure"). The changes it needs, all listed here (each done, and recorded in `docs/milestones.md`): `Paging` gains the two settle times (M2 part A, the one change to the table's internals, defaults unchanged), the table's fixtures and their native tests (M2 part C, with `shown_text` split out of the render loop for them, and `seiza-duckdb`'s `summary_queries` returning the queries `open_parquet` sends), `@seiza/duckdb` takes its extension directory as an option (done, M0 part A), and `seiza` gains a `panel` feature (on by default) while its title bar and theme toggle move to Tycho, with the Mac input bindings opt-in (M2 part A), and `seiza::targets` (publishing a control's bounds) moves there from Tycho, as do Tycho's first-draw probe and placeholder screenshot match to `shared-web/perf/` (M2 part B), and `cells.json` gains two hand-written `rounding` cases (M3 part A: fixture data only, no code). Each records its effect on Tycho. The scenarios ask for more, each built by its own crate's plan: the table's `density` (tall-table M10, "Waiting on" below), and the engine's seeded feed (market watch's research, M10 below).

**Waiting on** (features of a component or engine the observatory needs, and repo-wide changes it adopts; only that crate's `PLAN.md` (or the change's plan) builds them, and the session that closes one flips its row to *Ready*):

| Needs | For | Status |
|---|---|---|
| tall-table `custom-cells` ([its PLAN](../../components/tall-table/PLAN.md), "Drawing"; [its README](../../components/tall-table/README.md), "Paint") | The wide sheet's heat and bar cells (M9); market watch's flash on change (M10) | *Ready* (2026-10-24, tall-table M2; its follow-ups, `Bar` built only through `Bar::new` among them, 2026-10-25) |
| tall-table `density` ([its PLAN](../../components/tall-table/PLAN.md), "Asked for by the observatory's scenarios"; [its README](../../components/tall-table/README.md), "Density"): a row height, a column width set without `resize`, and a text size | The wide sheet's denser stops (M9) | *Ready* (2026-11-01, tall-table M10) |
| tall-table `pin` ([its PLAN](../../components/tall-table/PLAN.md), "Columns"; [its README](../../components/tall-table/README.md), "Pinning columns") | The wide sheet's key columns frozen (M9) | *Ready* (2026-10-29, tall-table M9) |
| tall-table `live` ([its PLAN](../../components/tall-table/PLAN.md), "Asked for by the observatory's scenarios"; [its README](../../components/tall-table/README.md), "Live rows" and "A flash") | Market watch, its flash included (`live` with `custom-cells`) (M10) | *Ready* (2026-10-25, tall-table M3) |
| tall-table `follow` (same; [its README](../../components/tall-table/README.md), "Following the tail") | Live tail (M11) | *Ready* (2026-10-25, tall-table M4) |
| tall-table `resize`, `select`, `copy` ([its PLAN](../../components/tall-table/PLAN.md), "Columns" and "Selection") | The wide sheet's later steps, a resize drag and a range copied: not in M9, a milestone after it | *Ready* (`resize` 2026-10-26, tall-table M5; `select` 2026-10-26, M6; `copy` 2026-10-27, M7) |

---

## Active milestone

### M9: Scenario: wide sheet

**Waited on** the table's `density`, ready 2026-11-01 (tall-table M10, "Waiting on"). Spreadsheets and BI exploration: hundreds of columns, compact rows, heat and bar cells ([the research](docs/research/scenarios.md), "Wide sheet"). The level, built the same on both sides: the base, `custom-cells`, `pin` (the key columns frozen, as every wide sheet freezes them: the station's name and place), and `density`. The data: NOAA's GHCN-Daily, a row per weather station by latitude, a column per day, temperature as heat ([the research](docs/research/scenarios.md), "Data"), the observatory's first file beside the asteroids.

Why `density`: the table's base at 500 columns (tall-table M1, [its results](../../components/tall-table/perf/results/2026-10-23-m1.md)) keeps up at the reference run, sideways as smoothly as down, but at its 120 px columns and 30 px rows only a few hundred cells are on screen (counted in those results), too few to separate the stacks by cost per cell, and at 4× CPU a steady scroll drops frames in both shapes. A set width exists only with `resize`, and the row height is the table's constant.

**Parts** (B–E drafts; part A2 confirms them). Part A was split in two on 2026-11-02, before its spike: the stops need both sides' cost per cell, which only the spike and the bare host at the same settings give, and the two are a session of their own.
- **A1: the data, the protocol, and M8's asks.** Done 2026-11-02 ([results](perf/results/2026-11-02-m9-a1.md); `docs/DECISIONS.md`, "Scenarios"):
  - [x] **The data, and its path, measured first:** GHCN-Daily's 2025 daily highs, 10,632 stations (≥ 300 clean days) by latitude × 365 days as `DOUBLE`, 6.36 MiB, CC0 (NOAA's NODD copy), with NOAA's citation. A page: 4 ranged requests, 1.4 MB on the wire, 3.1 MB of Arrow, ~115–125 ms in the engine (~102 with no network); each side's decode ~1 ms. The file is 11 pages, so the 64 MiB cache (~21) holds it whole and never evicts; the engine, not the table, sets time to data. The derived candidate is cheaper in the engine (~63 ms a page with no network) but saves no bytes and means nothing. The page SQL is the table's own, unchanged: `sql.json` gains a case for the file's name (part B).
  - [x] **The scenario in the root protocol:** root `CLAUDE.md`, "Comparison protocol" ("A scenario adds a workload to a level"), and root `docs/DECISIONS.md`, "Comparison protocol" (2026-11-02). The versions in every results file are written by `shared-web/perf/` beside the machine label: part B builds it (Tycho's results gaining them too) and adds the rule to root `CLAUDE.md` then, so the rule never reads as true before it is.
  - [x] **M8's asks, settled:** (1) `contenders/scenarios.ts`, the one list of scenarios, read by the page, the contenders, and the perf scripts, as `paths.ts` is: each `{ id, label, use, level, data, stops, defaultStop }`, `level` naming the build (`base`, `wide`), `data` the file in `data/`, each stop `{ id, label }` and its parameters (the wide sheet's row height, text size, and column widths in px). Big file is `big-file` on the base level with one stop. The page's `ROUTES` and the sidebar's items come from it, Big file's route moving to `/observatory/tall-table/big-file/` (part E). (2) A frame's URL gains `?scenario=<id>&stop=<id>` beside `?theme=` and `?measure`; without them a contender loads its level's first scenario at its default stop (the base level's is Big file, unchanged); an id it doesn't know fails the load (`contender:failed`), so a typo never measures the default. (3) No new mark: Smooth counts a sideways scroll on both sides already (`live.ts`: a horizontal wheel or Shift+wheel is a `wheel` event, ArrowLeft and ArrowRight are in `SCROLL_KEYS`, and the DOM side's `scroll` fires on either axis). (4) Cold results labelled `<scenario>-<stop>`, resolved by `web/cold.ts` per scenario and stop, the versions in each; the base level's files stay Big file's. (5) Shown in's stamp: market watch's part A.
  - [x] **No heat-only stop:** every stop keeps the values' text (`docs/DECISIONS.md`, "Scenarios", 2026-11-02).
- **A2: the spike, the stops, and the checks.** In this order:
  - **The TanStack spike** (`spike/`, throwaway): a grid on TanStack Virtual with a column virtualizer beside the rows', the two key columns pinned by `position: sticky` inside the scroll model's translated content (the gutter is sticky there already), heat cells by `color-mix(in oklab)`, at 3–4 densities over the file's own values; in Chromium, Firefox, and WebKit, the pinned edge and the header staying put through a vertical and a sideways fling. Its frame work per visible cell from Chromium's trace, steady scroll and fling, down and sideways, a few runs each (sizing, not the protocol).
  - **GPUI at the same settings:** the bare host built `custom-cells,pin,density` (`--shape wide --cells heat --pin 2 --density …`), the same segments, a few runs each, against the density results (~14 µs a cell; the rate held to ~460 cells, lost vertically between ~660 and ~840).
  - **The stops, named by the cells on screen** at 1440 × 900 (each a row height, a text size, and column widths, the text legible: ~16 px rows, 10 px text, and 44 px columns at the densest, ~1.8 k cells), placed so each side's knee falls between two of them, and shown on the dial as "~N cells". Then whether cell style (text → heat → bars) is a dial of its own or one style throughout.
  - **The verdict's measure, defined so part D doesn't redefine it:** the cells each side holds at the display's rate, over which scrolls (steady and fling, down and sideways), the late-frame threshold for "keeps up" (the Compare panel's dashed line), whether the slower direction sets it, and the vertical scroll measured over cached pages, so it reads the table, not the engine (A1: a page is ~115–125 ms of DuckDB).
  - **The slow device:** at 4× CPU a steady scroll already drops frames in both shapes at the base, so every stop may fail on both sides there. Either stops below the base for it, or "neither holds its rate at any stop" said plainly; decided here, before the long run.
  - **The suite's time** for the stops chosen, against the full protocol ("Every scenario milestone"). Ends with the checks below written.
- **B: the data file and the GPUI contender at the level.** The file: its `prep` script and pinned source, `MANIFEST.json`'s entry (with its license and credit), and the hosting for several files (the Worker's edge cache keyed per file, not by one `DATA_SHA256`; `prep.ts`, `contenders/data.ts`, the deploy, `worker-check`); `cell-fixture` over it. The contender: a build at the level (`custom-cells`, `pin`, `density`) at a base of its own beside the base level's, staged and served by the Worker, its TTFP and wasm budgets; the stop from its URL, the file and its page SQL, the paint, the pin, the density; the fixtures natively; its wasm with the features recorded; the versions each results file records (`shared-web/perf/`, A1), and their rule in root `CLAUDE.md`'s "Comparison protocol".
- **C: the TanStack contender at the level,** a build of its own beside the base level's, with its first-paint JS budgets: `paint.json` and `pin.json` run in TS with their controls; `tanstack-parity` extended to the sideways scroll and the pinned edge.
- **D: the numbers:** the metric scripts at each stop (a sideways fling added), cold on both sides, a results note; memory after a long sideways session as well as after load (GPUI's wasm memory grows to its peak and never shrinks, while the DOM's frees on a GC). A long run: ask about a code review first.
- **E: the page,** built to M8's design (the canvas, https://claude.ai/artifact/6cHBgVwwSqpTad8GP9KnGK; the Overview, the TallTable page, and Big file's route move with it), its explainer crediting the data (NOAA's citation, and that the file is cut from it, not NOAA's unaltered data); the README (its "Data credits" too); `report`; `burst` again before the deploy (A1 expects fewer requests than the base's: a page sends 4 and the whole file ~29, but a visitor now loads two files, and the zone's rate limit counts them all); the deploy; the close.


**Done when:** written in part A2.

**After it:** the wide sheet's later steps (a resize drag, a range selected and copied, both *Ready*) as a milestone of their own, planned when M9 closes.

---

## Next milestones

The "done when" checks are drafts until their milestone becomes active. The scenarios (M9–M13) are in the research's build order ([`docs/research/scenarios.md`](docs/research/scenarios.md), where each one's workload, measures, dial, and needs are); each scenario's research and spec open its milestone as part A, as the table's features do, and its later parts are split there.

**Every scenario milestone** (decided 2026-10-30, [`docs/DECISIONS.md`](docs/DECISIONS.md), "Scenarios"), each item a "done when" check of its own:
- **Its builds:** each contender builds once per feature level (Cargo features are compile-time, and the same scope keeps a level's code out of every other's bundle), at a base of its own under the contender's (`contenders/paths.ts`), staged and served beside the others, with its TTFP and wasm (or first-paint JS) budgets in `perf/budgets.json`, gated by `check` (root rule 1). A scenario on a level that exists shares its build (the admin table the base's; the monitoring wall market watch's, if its features match).
- **Its data credited:** the credit on the page and in the README, the license in `MANIFEST.json`; a synthetic feed is labelled synthetic on the page.
- **Its runs:** `check` gates its builds' budgets and runs its smoke, fixtures, and contract checks, never the full protocol. The full cold protocol (its stops × both sides × both devices × 10 runs, and its soaks) runs once, in its numbers part, on the final build (a long run: ask about a code review first); its part A estimates that time before fixing the stops. Its results files are labelled with its name, so it re-runs without the others.
- **Its versions:** each results file records what it was measured with (gpui-kit, React, TanStack Virtual, Arrow, DuckDB-Wasm, Chromium), and the scenario's explainer shows them ("measured with …"). A bump of any of them re-measures the scenarios it touches or labels their numbers with the versions they came from, decided per bump.

### M10: Scenario: market watch

Cells updated in place at 1k–50k updates/s, each change flashing: the strongest test of what WebAssembly adds beyond the canvas (garbage collection under churn). The level: the base, `custom-cells`, and `live` (the flash), ~20 columns × ~50 rows. The data: a seeded feed over ~50 fictional instruments from realistic price levels, labelled synthetic ([the research](docs/research/scenarios.md), "Data"). The table keeps up across that range reading from memory (the bare host; [its README](../../components/tall-table/README.md), "Features"), so the dial's ceiling is likely the engine's: part A opens with a spike of DuckDB-Wasm's update rate in its worker, and where the seeded feed lives (`engines/duckdb/` behind a feature, or the observatory's own code). The TanStack side ports `live`'s re-reads (`paging.json`'s `live` scenarios in TS) and draws the flash. Drafted when M9 closes.

### M11: Scenario: live tail

Rows appended at 1k–100k rows/s while the view follows the tail; scrolling back during the feed; a 10-minute soak. The level: the base and `follow` (with `live`). The data: NASA Kennedy Space Center's web server logs, July 1995 (~1.9 M requests), replayed by growing the rows read (`set_rows`) and looped past the file's end, a lap's times shifted, so the engine inserts nothing and the dial's ceiling is the UI's (the table keeps up across the range reading from memory). To check: the logs' terms, their host column (1995 visitors' hostnames and IPs: dropped or cut to the domain's suffix), their times as text or a `Timestamp` (a new kind for the fixtures), their size ([the research](docs/research/scenarios.md), "Data"). The TanStack side follows the tail on its own scroller. Drafted when M10 closes.

### M12: Scenario: admin table (the control)

The DOM's scenario: 50–500 rows of multilingual text, shown as capabilities (Ctrl+F, text selection, a screen reader, every script drawn), not speed. The base level and the world's countries (~250), each name in its own script, with a flag emoji, from CLDR or Wikidata ([the research](docs/research/scenarios.md), "Data"). GPUI bundles one face, so scripts outside it have no glyphs there, missing rather than shaped badly: part A decides whether the page shows that gap as it is or loads script fonts on the GPUI side after first paint (bytes, root rule 1) to test its shaping, and the page says which. Cheap: it moves ahead of M10 if the page needs its counterweight sooner.

### M13: Scenario: monitoring wall

4–8 small tables updating at once: one canvas against N DOM trees. Market watch's updates N times, in the layout M8 decides. Last.

---

## Measurements

Generated by `just observatory report` from [`perf/budgets.json`](perf/budgets.json) and the newest matching file in `perf/results/`; don't edit between the markers. A metric's history is its dated results files.

<!-- report:plan:start -->
| Metric | Budget | Gate | Local | Production | From |
|---|---|---|---|---|---|
| GPUI contender: time to first paint | ≤ 187.6 ms (baseline 170.5 + 10%) | `check` | 170.5 ms | 329.5 ms | [2026-10-16-m2-b-gpui-cold](perf/results/2026-10-16-m2-b-gpui-cold.json), [2026-10-21-gpui-cold-production](perf/results/2026-10-21-gpui-cold-production.json) |
| GPUI contender: time to first paint, throttled | — | recorded | 3502.5 ms | 3550.5 ms | [2026-10-16-m2-b-gpui-cold](perf/results/2026-10-16-m2-b-gpui-cold.json), [2026-10-21-gpui-cold-production](perf/results/2026-10-21-gpui-cold-production.json) |
| GPUI contender: wasm (brotli) | ≤ 3113.3 KiB (baseline 2707.2 + 15%) | `check` | 2695.4 KiB | — | [2026-10-16-m2-b-gpui-cold](perf/results/2026-10-16-m2-b-gpui-cold.json) |
| TanStack contender: first-paint JS (brotli) | ≤ 79.3 KiB (baseline 72.1 + 10%) | `check` | 72.2 KiB | — | [2026-10-18-m4-b-tanstack-sizes](perf/results/2026-10-18-m4-b-tanstack-sizes.json) |
| TanStack contender: data layer and Arrow, after first paint (brotli) | ≤ 38.2 KiB (baseline 34.7 + 10%) | `check` | 34.7 KiB | — | [2026-10-18-m4-b-tanstack-sizes](perf/results/2026-10-18-m4-b-tanstack-sizes.json) |
| Page: first paint (paint timing), /observatory/tall-table/ | ≤ 85 ms (baseline 70.8 + 20%) | `check` | 70.8 ms | 210.2 ms | [2026-10-19-m5-a-page](perf/results/2026-10-19-m5-a-page.json), [2026-10-21-page-production](perf/results/2026-10-21-page-production.json) |
| Page: first paint (paint timing), throttled | — | recorded | 437.4 ms | 474.7 ms | [2026-10-19-m5-a-page](perf/results/2026-10-19-m5-a-page.json), [2026-10-21-page-production](perf/results/2026-10-21-page-production.json) |
| Page: first-paint JS (brotli) | ≤ 86 KiB (baseline 78.2 + 10%) | `check` | 78.2 KiB | — | [2026-10-19-m5-a-page](perf/results/2026-10-19-m5-a-page.json) |
| Requests in the busiest 10 s, one visitor (the zone's rate limit counts per IP) | — | recorded | 125 requests | — | [2026-10-21-m6-burst](perf/results/2026-10-21-m6-burst.json) |
<!-- report:plan:end -->

---

## Long-term goals

Not milestones. Each starts with research.

- **A scenario's advanced panel:** its parameters beyond the stops, a later toggle, its readings labelled warm and never published ([`docs/research/scenarios.md`](docs/research/scenarios.md)). The scenarios themselves are M9–M13 ("Next milestones").
- **A third contender: Glide Data Grid** (GPUI | TanStack / Glide): a DOM-hosted canvas grid, which would separate "canvas vs DOM" from "Wasm vs JS" (the scenarios' mechanisms A against B and C, [`docs/research/scenarios.md`](docs/research/scenarios.md)). Another contender app against the same GPUI side, under the same protocol. It may never happen.
- **A dataset easier to read at a glance** than a sea of floats, within the static-asset budget. The wide sheet's heat and bar cells answer part of it.
- **Feature levels:** a level adds a table feature on both sides (root `CLAUDE.md`, "Comparison protocol"), each feature's cost measured against the base. A level comes in with the scenario that needs it, not on its own. The features, their order, and each one's TanStack counterpart are in [the table's `PLAN.md`](../../components/tall-table/PLAN.md); a level is a milestone here that links to it.
- **The benchmark button:** "Run benchmark" plays a scripted session on each side in turn (the order alternated between runs), drives each through its own input path (script-made wheel events reach GPUI's listeners but never scroll a native scroller, so the DOM side is driven through its scroll position), and shows the results labelled warm beside the cold ones, from production too. Deferred: at the base level its session (load, fling, jump to 90%) replays what the cold numbers already show, a workload on which the GPUI side reads mostly as heavier in memory. It's worth building once the scenarios exist: it then sweeps a scenario's stops on each side and draws each side's curve, where each one stops keeping up. The status bar keeps it, disabled.
- **Dropping your own file:** out of the base level. It would widen the cell fixtures to every column kind (decimals, timestamps, 128-bit integers). Opening any dataset (a dropped file, HuggingFace) is Tycho's, as a utility app's job.

---

## Open questions

- **The DOM's fling, read from its compositor.** The fling's late frames and lag are main-thread readings on both sides (`underLoad`), which on GPUI are the presented frames but on the DOM aren't: its compositor scrolls on through a late main-thread frame. The README says so. Whether the DOM side should also report what its compositor presented (`cc`'s frames and `Scroll Delta This Frame`, as the wheel's guard reads them) beside it, and which reading the page headlines, is a protocol change for root `docs/DECISIONS.md`.
- **A short page's missing cells.** The tall table draws a value past a page's end as `NULL` (`render_body`'s `unwrap_or(CellValue::Null)`); the TanStack contender draws it empty. A static file never answers short, so nothing measured differs; whether the component should draw it empty too is the component's call (Tycho drives it).

- **The pill's compositor frames.** Throttled, the meter as a pill dropped more compositor frames than hidden on both sides (TanStack 7.98% against 3.5%, GPUI 4.21% against 0), while the open meter dropped none more (`perf/results/2026-10-21-m5-d4.md`). The pill isn't the default, so nothing gates it; whether it should get a layer of its own (`will-change: transform`, as the open meter has), and whether that's the cause, is untested.
- **A spread for a short mark.** The quiet-machine gate is (max − min) / median under 6% of each variant's open mark. TanStack's reference mark is ~500 ms, so one 15–30 ms stray fails it (7.0–7.7% in both D4 runs, while its gates read 0 against 0). Whether short marks get a floor in ms, or the gate uses the interquartile range over the median, is open.
- **The landing page.** The observatory's Worker holds the apex `seiza.io` (everything outside `/observatory/` a 404). The page is basic (a title, a catchy line, a link to the observatory), built in `site/landing/` on `site/ui/`'s shell (root `docs/DECISIONS.md`, "Repo structure"); when it ships is open. Shipping it moves the Worker to `site/worker/` and adds `/`, `/index.html`, and `/assets/` to the seiza.io WAF rule (`/fonts/` is in it already).
