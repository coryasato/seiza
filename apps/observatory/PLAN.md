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
| M7 | `trim-paths`: no home paths in the shipped wasm, redeployed (with the repo-wide change and Tycho's M10, one session) | Planned |
| M8 | The scenarios on the page: the design (a design session, no code) | Planned |
| M9 | Scenario: wide sheet | Planned; waits on tall-table M10 (`density`) |
| M10 | Scenario: market watch | Planned |
| M11 | Scenario: live tail | Planned |
| M12 | Scenario: admin table (the control) | Planned |
| M13 | Scenario: monitoring wall | Planned |

**Parts are sized to one working session.** Each ends with its own checks passing and its evidence written down, so the next session starts from this file, not from the last one's context. A part that grows past a session splits before it's started, not halfway through.

**Closing a milestone:** as for every app (root `CLAUDE.md`, "Working agreements"): every "done when" check passes; the numbers are in `perf/results/` with a note; new decisions are in `docs/DECISIONS.md` (repo-wide ones in the root's); a `docs/LESSONS.md` entry is written; and the milestone's spec and evidence move from here to `docs/milestones.md`, leaving one row above.

**Component and engine changes:** the observatory consumes the tall table and the DuckDB engine; it doesn't reshape them (root `docs/DECISIONS.md`, "Repo structure"). The changes it needs, all listed here (each done, and recorded in `docs/milestones.md`): `Paging` gains the two settle times (M2 part A, the one change to the table's internals, defaults unchanged), the table's fixtures and their native tests (M2 part C, with `shown_text` split out of the render loop for them, and `seiza-duckdb`'s `summary_queries` returning the queries `open_parquet` sends), `@seiza/duckdb` takes its extension directory as an option (done, M0 part A), and `seiza` gains a `panel` feature (on by default) while its title bar and theme toggle move to Tycho, with the Mac input bindings opt-in (M2 part A), and `seiza::targets` (publishing a control's bounds) moves there from Tycho, as do Tycho's first-draw probe and placeholder screenshot match to `shared-web/perf/` (M2 part B), and `cells.json` gains two hand-written `rounding` cases (M3 part A: fixture data only, no code). Each records its effect on Tycho. The scenarios ask for more, each built by its own crate's plan: the table's `density` (tall-table M10, "Waiting on" below), and the engine's seeded feed and append path (market watch's and live tail's research, M10 and M11 below).

**Waiting on** (features of a component or engine the observatory needs, and repo-wide changes it adopts; only that crate's `PLAN.md` (or the change's plan) builds them, and the session that closes one flips its row to *Ready*):

| Needs | For | Status |
|---|---|---|
| tall-table `custom-cells` ([its PLAN](../../components/tall-table/PLAN.md), "Drawing"; [its README](../../components/tall-table/README.md), "Paint") | The wide sheet's heat and bar cells (M9); market watch's flash on change (M10) | *Ready* (2026-10-24, tall-table M2; its follow-ups, `Bar` built only through `Bar::new` among them, 2026-10-25) |
| tall-table `density` ([its PLAN](../../components/tall-table/PLAN.md), "Asked for by the observatory's scenarios" and M10's draft): a row height, a column width set without `resize`, and a text size | The wide sheet's denser stops (M9) | *Not ready* (asked for 2026-10-30; tall-table M10, next in its run) |
| tall-table `pin` ([its PLAN](../../components/tall-table/PLAN.md), "Columns"; [its README](../../components/tall-table/README.md), "Pinning columns") | The wide sheet's key columns frozen (M9) | *Ready* (2026-10-29, tall-table M9) |
| tall-table `live` ([its PLAN](../../components/tall-table/PLAN.md), "Asked for by the observatory's scenarios"; [its README](../../components/tall-table/README.md), "Live rows" and "A flash") | Market watch, its flash included (`live` with `custom-cells`) (M10) | *Ready* (2026-10-25, tall-table M3) |
| tall-table `follow` (same; [its README](../../components/tall-table/README.md), "Following the tail") | Live tail (M11) | *Ready* (2026-10-25, tall-table M4) |
| tall-table `resize`, `select`, `copy` ([its PLAN](../../components/tall-table/PLAN.md), "Columns" and "Selection") | The wide sheet's later steps, a resize drag and a range copied: not in M9, a milestone after it | *Ready* (`resize` 2026-10-26, tall-table M5; `select` 2026-10-26, M6; `copy` 2026-10-27, M7) |
| `trim-paths` in the root release profile ([the plan](../../docs/research/build-paths.md)): no home-directory paths in the shipped wasm | M7 (below) | *Not ready*: built in M7's session, before the adoption |

---

## Active milestone

None: M6, the deploy, closed 2026-10-21 ([`docs/milestones.md`](docs/milestones.md)). Next, in order: M7 (`trim-paths`, in one session with the repo-wide change and Tycho's M10), M8 (the scenarios' design), then M9 (the wide sheet) once the table's `density` is ready (tall-table M10, "Waiting on"). The table's M10 and this app's M7 and M8 don't depend on each other. The scenarios were planned as milestones on 2026-10-30 ([`docs/DECISIONS.md`](docs/DECISIONS.md), "Scenarios").

---

## Next milestones

The "done when" checks are drafts until their milestone becomes active. The scenarios (M9–M13) are in the research's build order ([`docs/research/scenarios.md`](docs/research/scenarios.md), where each one's workload, measures, dial, and needs are); each scenario's research and spec open its milestone as part A, as the table's features do, and its later parts are split there.

### M7: `trim-paths`, no home paths in the shipped wasm

Every release wasm the repo builds embeds the builder's home-directory paths, its dependencies' and the toolchain's panic locations: the GPUI contender's `web/dist` holds 977 (counted 2026-10-30), and it's what's deployed at seiza.io, against the root's rule never to publish a home-directory path. It goes first because it moves every wasm's bytes: done before the scenarios, the contender's wasm baseline is rewritten once, before the scenarios' feature levels are measured against it, and builds identical across checkouts make those byte changes exact.

**One session, three records**, each in its own home:
1. **The repo-wide change**, first: [`docs/research/build-paths.md`](../../docs/research/build-paths.md)'s "Done when" (the profile setting and its decision, the home-path check in the table's `size` with its control, the bare host byte-identical across checkouts, both apps' rows flipped to *Ready*). It checks first that the pinned nightly takes `trim-paths` and that its `"object"` scope covers the panic locations.
2. **This app's adoption**, the checks below.
3. **Tycho's adoption**, its own M10 ([its PLAN](../tycho/PLAN.md)), its evidence in its own `perf/results/` and `docs/milestones.md`.

**Done when:**
- [ ] The GPUI contender's wasm before and after the change (raw, after wasm-opt, brotli 11) in a results note; `perf/baseline.json`'s wasm rewritten, and TTFP's only if `check` shows it moved.
- [ ] `sizes --check` (in `check`) fails on a home path in the shipped wasm (the builder's `$HOME`, `/Users/`, `/home/`), with a control (a build without the setting fails it).
- [ ] Redeployed (`just observatory deploy`, `worker-check` passing), and the wasm fetched from production holds no home path.
- [ ] `just observatory report`; "Waiting on"'s row removed (adopted).

### M8: the scenarios on the page, designed (a design session, no code)

How a visitor picks a scenario and a stop, and what the contender's window shows for each, decided for all five scenarios before the first is built, as M5's parts A1 and C decided the page's layout and its numbers ([`docs/milestones.md`](docs/milestones.md)). It needs no scenario built: each one's dial and measures are in the research. What it decides, mocked in light and dark, desktop and phone:

- **Where a scenario is picked:** the sidebar (items under the tall table), a route per scenario (`/observatory/tall-table/<scenario>`), a control in the window's title bar, or a mix (the research's open question); and the base level's place (the session the page shows today: a scenario of its own, or the default).
- **The dial:** a few stops, each labelled with what it sets; what a switch does (the frame destroyed and made again, as a flip is; the toggle disabled until the new frame fills; a second load labelled warm); the URL (`?side=` today, a scenario and a stop added).
- **The numbers per scenario:** the status bar's readings and the meter (today's four, or each scenario's own: market watch's update → pixel, live tail's append rate held), the Compare panel's cards (cold numbers per stop and side, both devices), and how a verdict reads across stops (where each side stops keeping up), with room for the benchmark button's curves later ("Long-term goals").
- **The two that aren't speed:** the admin table's capabilities (prompts to try on each side, a yes/no list), and the monitoring wall's several tables in one frame.
- **The description below the window** per scenario (what it models, the mechanisms behind its result), and the phone.

**Done when:**
- [ ] A design canvas (an artifact): the chosen design in light and dark, desktop and phone, the picker and the dial interactive; the options compared, and why one won.
- [ ] A decision under `docs/DECISIONS.md`, "Page"; the research's open question on presentation closed there.
- [ ] What it asks of the contenders (the URL parameters a frame takes, any mark a scenario's readings need) listed for M9's part A.

### M9: Scenario: wide sheet

**Waits on** the table's `density` (tall-table M10, "Waiting on"). Spreadsheets and BI exploration: hundreds of columns, compact rows, heat and bar cells ([the research](docs/research/scenarios.md), "Wide sheet"). The level, built the same on both sides: the base, `custom-cells`, `pin` (`spkid` and `full_name` frozen, as every wide sheet freezes its key), and `density`.

Why `density`: the table's base at 500 columns (tall-table M1, [its results](../../components/tall-table/perf/results/2026-10-23-m1.md)) keeps up at the reference run, sideways as smoothly as down, but at its 120 px columns and 30 px rows only ~360 cells are on screen, too few to separate the stacks by cost per cell, and at 4× CPU a steady scroll drops frames in both shapes. A set width exists only with `resize`, and the row height is the table's constant.

**Parts** (drafts; part A confirms the split):
- **A: research and spec.** In this order, each settled before the next:
  - **The data path, measured first.** The table pages by rows with every column in a page: at 500 floats a page is ~4 MB of Arrow (1,024 × 500 × 8 bytes), so the 64 MiB cache holds ~16 pages, not the base's hundreds, and prefetch and eviction behave differently. The wire bytes don't grow (the columns derive from the file's five floats), but DuckDB evaluates every derived column per page, the page crosses from the worker, and each side decodes it. Per page and per column count: engine time, Arrow bytes, the hand-off, each side's decode. Engine time is the same on both sides; if it dominates time to data, the scenario reads DuckDB, not the table, and the stops and the readings must keep it apart. The pages stay full rows here, the same on both sides; pages of the visible columns only are a table idea ([its PLAN](../../components/tall-table/PLAN.md), "Open questions"), not this milestone's.
  - **The projection:** 100–500 columns from the five floats, derived in the page SQL alike on both sides, a case in `sql.json`; their distributions drive the heat and bar paint, so they're chosen to read as data, and the page says they're derived (part E).
  - **The stops, named by the cells on screen** (each one's row height, column width, and text size: a shorter row without smaller text clips glyphs, and the text size changes glyph cost on both sides), chosen within what stays legible at 1440×900, and shown on the dial, so a verdict reads "TanStack holds the display's rate to ~N cells, GPUI to ~M". Then cell style (text → heat → bars).
  - **The verdict's measure, defined so part D doesn't redefine it:** the cells each side holds at the display's rate, over which scrolls (steady and fling, down and sideways), the late-frame threshold for "held", and whether the slower direction sets it.
  - **The slow device:** at 4× CPU a steady scroll already drops frames in both shapes at the base, so every stop may fail on both sides there. Either stops below the base for it, or "neither holds its rate at any stop" said plainly; decided here, before the long run.
  - **The TanStack side's counterparts:** two-axis virtualization (a column virtualizer beside the rows'), cell renderers matched to `paint.json` (its colors are Chromium's `color-mix(in oklab)`, which the DOM side uses itself), and pinned columns matched to `pin.json`. A spike of the one risky combination: sticky pinned columns beside a column virtualizer, inside the scroll model's translated content (the gutter is sticky there already).
  - **The scenario in the root protocol** (root `CLAUDE.md`, "Comparison protocol", and root `docs/DECISIONS.md`), and M8's asks of the contenders. Ends with the checks below written.
- **B: the GPUI contender at the level:** the scenario and stop from its URL, the projection, the paint, the pin, the density; the fixtures natively; its wasm with the features recorded.
- **C: the TanStack contender at the level:** `paint.json` and `pin.json` run in TS with their controls; `tanstack-parity` extended to the sideways scroll and the pinned edge.
- **D: the numbers:** the metric scripts at each stop (a sideways fling added), cold on both sides, a results note; memory after a long sideways session as well as after load (GPUI's wasm memory grows to its peak and never shrinks, while the DOM's frees on a GC). A long run: ask about a code review first.
- **E: the page,** built to M8's design, its explainer saying the wide columns are derived from five; the README; `report`; `burst` again before the deploy (a ~16-page cache re-reads more, which can change the requests a visitor sends in 10 s against the zone's rate limit); the deploy; the close.

**Done when:** written in part A.

**After it:** the wide sheet's later steps (a resize drag, a range selected and copied, both *Ready*) as a milestone of their own, planned when M9 closes.

### M10: Scenario: market watch

Cells updated in place at 1k–50k updates/s, each change flashing: the strongest test of what WebAssembly adds beyond the canvas (garbage collection under churn). The level: the base, `custom-cells`, and `live` (the flash), ~20 columns × ~50 rows. The table keeps up across that range reading from memory (the bare host; [its README](../../components/tall-table/README.md), "Features"), so the dial's ceiling is likely the engine's: part A opens with a spike of DuckDB-Wasm's update rate in its worker, and where the seeded feed lives (`engines/duckdb/` behind a feature, or the observatory's own code). The TanStack side ports `live`'s re-reads (`paging.json`'s `live` scenarios in TS) and draws the flash. Drafted when M9 closes.

### M11: Scenario: live tail

Rows appended at 1k–100k rows/s while the view follows the tail; scrolling back during the feed; a 10-minute soak. The level: the base and `follow` (with `live`). The table keeps up across that range reading from memory, so again the engine's append rate caps the dial (the same spike). The TanStack side follows the tail on its own scroller. Drafted when M10 closes.

### M12: Scenario: admin table (the control)

The DOM's scenario: 50–500 rows of multilingual text, shown as capabilities (Ctrl+F, text selection, a screen reader, every script drawn), not speed. The base level and a small multilingual file (a new static asset, within today's data size). Cheap: it moves ahead of M10 if the page needs its counterweight sooner.

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
| GPUI contender: wasm (brotli) | ≤ 3099.7 KiB (baseline 2695.4 + 15%) | `check` | 2695.4 KiB | — | [2026-10-16-m2-b-gpui-cold](perf/results/2026-10-16-m2-b-gpui-cold.json) |
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
