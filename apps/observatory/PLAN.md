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
| M13 | Scenario: monitoring wall | Planned |
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

None: M12 closed 2026-11-10 (its spec and evidence in [`docs/milestones.md`](docs/milestones.md)). M13 opens next, with its research and spec as part A.

---

## Next milestones

The "done when" checks are drafts until their milestone becomes active. The scenarios (M9–M13) are in the research's build order ([`docs/research/scenarios.md`](docs/research/scenarios.md), where each one's workload, measures, dial, and needs are); each scenario's research and spec open its milestone as part A, as the table's features do, and its later parts are split there.

**Every scenario milestone** (decided 2026-10-30, [`docs/DECISIONS.md`](docs/DECISIONS.md), "Scenarios"), each item a "done when" check of its own:
- **Its builds:** each contender builds once per feature level (Cargo features are compile-time, and the same scope keeps a level's code out of every other's bundle), at a base of its own under the contender's (`contenders/paths.ts`), staged and served beside the others, with its TTFP and wasm (or first-paint JS) budgets in `perf/budgets.json`, gated by `check` (root rule 1). A scenario on a level that exists shares its build (the admin table the base's; the monitoring wall market watch's, if its features match).
- **Its data credited:** the credit on the page and in the README, the license in `MANIFEST.json`; a synthetic feed is labelled synthetic on the page.
- **Its runs:** `check` gates its builds' budgets and runs its smoke, fixtures, and contract checks, never the full protocol. The full cold protocol (its stops × both sides × both devices × 10 runs, and its soaks) runs once, in its numbers part, on the final build (a long run: ask about a code review first); its part A estimates that time before fixing the stops. Its results files are labelled with its name, so it re-runs without the others.
- **Its versions:** each results file records what it was measured with (gpui-kit, React, TanStack Virtual, Arrow, DuckDB-Wasm, Chromium), and the scenario's explainer shows them ("measured with …"). A bump of any of them re-measures the scenarios it touches or labels their numbers with the versions they came from, decided per bump.

### M13: Scenario: monitoring wall

4–8 small tables updating at once: one canvas against N DOM trees. Market watch's updates N times, in the layout M8 decides. The last scenario.

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
| TanStack contender: first-paint JS (brotli) | ≤ 79.3 KiB (baseline 72.1 + 10%) | `check` | 73.8 KiB | — | [2026-11-09-m12-b1-tanstack-sizes](perf/results/2026-11-09-m12-b1-tanstack-sizes.json) |
| TanStack contender at the wide level: first-paint JS (brotli) | ≤ 84.5 KiB (baseline 76.8 + 10%) | `check` | 77.7 KiB | — | [2026-11-09-m12-b1-tanstack-sizes-wide](perf/results/2026-11-09-m12-b1-tanstack-sizes-wide.json) |
| TanStack contender at the market level: first-paint JS (brotli) | ≤ 83.1 KiB (baseline 75.5 + 10%) | `check` | 75.9 KiB | — | [2026-11-09-m12-b1-tanstack-sizes-market](perf/results/2026-11-09-m12-b1-tanstack-sizes-market.json) |
| TanStack contender at the tail level: first-paint JS (brotli) | ≤ 84.2 KiB (baseline 76.5 + 10%) | `check` | 76.9 KiB | — | [2026-11-09-m12-b1-tanstack-sizes-tail](perf/results/2026-11-09-m12-b1-tanstack-sizes-tail.json) |
| TanStack contender: data layer and Arrow, after first paint (brotli) | ≤ 38.2 KiB (baseline 34.7 + 10%) | `check` | 34.8 KiB | — | [2026-11-09-m12-b1-tanstack-sizes](perf/results/2026-11-09-m12-b1-tanstack-sizes.json) |
| TanStack contender at the wide level: data layer and Arrow, after first paint (brotli) | ≤ 38.3 KiB (baseline 34.8 + 10%) | `check` | 34.8 KiB | — | [2026-11-09-m12-b1-tanstack-sizes-wide](perf/results/2026-11-09-m12-b1-tanstack-sizes-wide.json) |
| TanStack contender at the market level: data layer and Arrow, after first paint (brotli) | ≤ 44.8 KiB (baseline 40.7 + 10%) | `check` | 40.9 KiB | — | [2026-11-09-m12-b1-tanstack-sizes-market](perf/results/2026-11-09-m12-b1-tanstack-sizes-market.json) |
| TanStack contender at the tail level: data layer and Arrow, after first paint (brotli) | ≤ 42.6 KiB (baseline 38.7 + 10%) | `check` | 39.2 KiB | — | [2026-11-09-m12-b1-tanstack-sizes-tail](perf/results/2026-11-09-m12-b1-tanstack-sizes-tail.json) |
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
- **A spread for a short mark.** The quiet-machine gate is (max − min) / median under 6% of each variant's open mark. TanStack's reference mark is ~500 ms, so one 15–30 ms stray fails it (7.0–7.7% in both D4 runs, while its gates read 0 against 0). Whether short marks get a floor in ms, or the gate uses the interquartile range over the median, is open.
- **GPUI's lost mark offsets upstream.** gpui-pre-wgpu 0.3.11 drops cosmic-text's `x_offset` and `y_offset` (`perf/results/2026-11-09-m12-a2.md`), and 0.3.12 (gpui-kit 0.9.1) still does: its `cosmic_text_system.rs` is byte-identical. The user files the issue; whether a fix lands before part C, so the shaping verdicts are measured on it, is open.
- **GPUI's numbers on gpui-kit 0.9.1.** Every scenario's results are labelled 0.9.0. gpui-pre 0.3.12 resets the cursor on every mouse and scroll event (a `document.body.style.cursor` write each on the web; [the bump's note](perf/results/2026-11-10-gpui-kit-0.9.1.md)), so GPUI's fling, scroll, and response readings may differ on the build the page serves. The root protocol says a bump re-measures the scenarios it touches or keeps their versions' label, decided per bump. To decide it: a GPUI-only A/B, 0.9.0 against 0.9.1, of the input-heavy readings (`metric response` and the wide sheet's `scroll` at one stop, reference, median of 10); re-measure the scenarios if it moves past the spread, else keep the label. M13's cold runs measure only the monitoring wall, and M14's re-measure only the wide sheet, so neither settles it; run it in M13's measuring part, beside its suite.
- **The landing page.** The observatory's Worker holds the apex `seiza.io` (everything outside `/observatory/` a 404). The page is basic (a title, a catchy line, a link to the observatory), built in `site/landing/` on `site/ui/`'s shell (root `docs/DECISIONS.md`, "Repo structure"); when it ships is open. Shipping it moves the Worker to `site/worker/` and adds `/`, `/index.html`, and `/assets/` to the seiza.io WAF rule (`/fonts/` is in it already).
