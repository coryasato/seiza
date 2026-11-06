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
| M11 | Scenario: live tail (parts A1–F) | Active, opened 2026-11-06 |
| M12 | Scenario: admin table (the control) | Planned |
| M13 | Scenario: monitoring wall | Planned |
| M14 | The wide sheet's later steps: a resize drag, a range copied | Planned (after M13) |

**Parts are sized to one working session.** Each ends with its own checks passing and its evidence written down, so the next session starts from this file, not from the last one's context. A part that grows past a session splits before it's started, not halfway through.

**Closing a milestone:** as for every app (root `CLAUDE.md`, "Working agreements"): every "done when" check passes; the numbers are in `perf/results/` with a note; new decisions are in `docs/DECISIONS.md` (repo-wide ones in the root's); a `docs/LESSONS.md` entry is written; and the milestone's spec and evidence move from here to `docs/milestones.md`, leaving one row above.

**Component and engine changes:** the observatory consumes the tall table and the DuckDB engine; it doesn't reshape them (root `docs/DECISIONS.md`, "Repo structure"). The changes it needs, all listed here (each done, and recorded in `docs/milestones.md`): `Paging` gains the two settle times (M2 part A, the one change to the table's internals, defaults unchanged), the table's fixtures and their native tests (M2 part C, with `shown_text` split out of the render loop for them, and `seiza-duckdb`'s `summary_queries` returning the queries `open_parquet` sends), `@seiza/duckdb` takes its extension directory as an option (done, M0 part A), and `seiza` gains a `panel` feature (on by default) while its title bar and theme toggle move to Tycho, with the Mac input bindings opt-in (M2 part A), and `seiza::targets` (publishing a control's bounds) moves there from Tycho, as do Tycho's first-draw probe and placeholder screenshot match to `shared-web/perf/` (M2 part B), and `cells.json` gains two hand-written `rounding` cases (M3 part A: fixture data only, no code). Each records its effect on Tycho. The scenarios ask for more, each built by its own crate's plan: the table's `density` (tall-table M10, adopted in M9), and its `format` (asked 2026-11-04 for market watch). Market watch's seeded feed is the observatory's own, not the engine's (decided 2026-11-04, M10 below).

**Waiting on** (features of a component or engine the observatory needs, and repo-wide changes it adopts; only that crate's `PLAN.md` (or the change's plan) builds them, and the session that closes one flips its row to *Ready*):

| Needs | For | Status |
|---|---|---|
| tall-table `follow` (same; [its README](../../components/tall-table/README.md), "Following the tail") | Live tail (M11) | *Ready* (2026-10-25, tall-table M4) |
| tall-table `resize`, `select`, `copy` ([its PLAN](../../components/tall-table/PLAN.md), "Columns" and "Selection") | The wide sheet's later steps, a resize drag and a range copied (M14) | *Ready* (`resize` 2026-10-26, tall-table M5; `select` 2026-10-26, M6; `copy` 2026-10-27, M7) |

---

## Active milestone

### M11: Scenario: live tail

Opened 2026-11-06. An observability tool's live tail: NASA's Kennedy Space Center web server logs, July 1995, replayed into the table at 1k–100k rows/s while the view follows the newest; a reader scrolling back during the feed; a 10-minute soak ([the research](docs/research/scenarios.md), "Live tail"). Mechanisms: allocation and garbage collection under a growing table (B), and cost per cell at density (A). Its one feature is *Ready* ("Waiting on": the table's `follow`, which turns on `live`). M10's spec and evidence are in [`docs/milestones.md`](docs/milestones.md).

**The design is M8's canvas** (https://claude.ai/artifact/6cHBgVwwSqpTad8GP9KnGK, its main board's `tail` scenario and its "live tail loading" board), followed as drawn ([`docs/DECISIONS.md`](docs/DECISIONS.md), "Page"): the lead "NASA's web server, July 1995, replayed. Turn up the rows."; the dial "Rows per second", stops 1k, 10k, 50k, 100k, the default 10k (the canvas's second stop), each "appended while the view follows the newest"; four columns, `time` (the log's own text, `13/Jul/1995 03:14:02`, drawn muted), `request` (`GET /shuttle/countdown/ HTTP/1.0`), `status` (right-aligned, a 404 in `--down`), `bytes` (right-aligned, grouped: `12,040`); **no host column**; the status bar's Ready in, Shown in, Smooth, Memory (a phone's Shown in and Smooth); the panel's keeps-up chart and its cards at a stop, Smoothness, "Row shown in", and "Memory after 10 minutes"; the load's data row "The data: NASA-HTTP logs". Every number on the canvas is a sketch. Anything it doesn't draw (the muted time and the red 404 as the table draws them, a reader's way back to the tail, a lap's seam) is specced in part A and decided with the user, never silently.

**The replay, as the research has it:** the rows grow by the stop's rate through `set_rows`, read from the file through the engine and the page SQL, so the engine inserts nothing and the dial's ceiling is the UI's; past the file's end the rows loop (row *i* is the file's row *i* mod *n*, its time moved on by a lap, the file's span of ~27.6 days), so a 10-minute soak at 100k (60 M rows) never runs out. Part A1 decides who keeps the clock (a worker of each frame's own sending the rows due, as market watch's feed sends ticks, so both sides get the same counts at the same times, or each side's frame), what Shown in times for a row (its due time → the first presented frame that draws it, GPUI's from `TailDrawn`), and how the TanStack side follows on its native scroller (the table's rule, `paging.json`'s `follow` scenarios, which it skips today with every `rows` step).

**Parts** (each one session; A2 confirms B–F):
- **A1: the data, the replay's path, and the measures.** The source pinned (NASA-HTTP's July file, 20.7 MB gzipped, its SHA-256 in `MANIFEST.json`'s `sources`); its terms ("The traces may be freely redistributed", and the archive asks that nothing be analyzed beyond general traffic patterns) against the data rule's licenses (public domain, CC0, CC BY: decided with the user); what's kept (time, request, status, bytes; the host dropped, as the canvas draws; requests checked for what identifies a visitor: query strings, `~user` paths, mail addresses, cut or dropped by a rule written down); the time as text or a `Timestamp` (a lap's shift needs the value; the canvas draws the log's text; a new kind widens `cells.json`); the file's size and row groups under 25 MiB; the replay's clock and its batches, the loop's page that straddles a lap, and the measures: keeps up (a frame drawn at the tail with every row due by its start?), Row shown in, scroll-back latency under the feed, and the soak's memory and late frames.
- **A2: the spike on both sides, the stops, and the checks.** The bare host built `follow` and a TanStack spike following its native scroller, on A1's file and clock, at 1k–100k, both profiles, with the busy-loop control; Row shown in's control (a side holding the tail a frame reads a frame more, B1's lesson from M10); the stops kept or moved (the canvas's four, decided with the user); the verdict's measure; the soak's length and runs (10 minutes × 4 stops × 2 sides × 2 devices × 10 runs is ~27 h: fewer runs or stops, decided with the user); the suite's time.
- **B: the data, the scenario, and the GPUI contender at the level** (the level `tail`: the base, `follow` and its `live`, and `custom-cells` for the muted time and the error status), its source looping the file, the clock, the marks, its wasm and TTFP budgets. Split in A2 if it's over a session.
- **C: the TanStack contender at the level:** `follow` ported (the flag, the tail pin to the rows read, bottom-first reads) and `paging.json`'s `follow` and `rows` scenarios run in TS with their controls; the view following on its native scroller; its first-paint JS and data layer budgets; `tanstack-parity` and `tanstack-contract` at the level. Split as C1 (the ports and fixtures) and C2 (the contender), as market watch's was.
- **D: the numbers.** D1: the tail's metric and the once-a-scenario metrics at the level, smoke runs only, then the code review. D2: the runs on a quiet machine, and their results note.
- **E: the page,** as the canvas draws it (the route, the dial, the status bar, the panel, the description), and the Overview's rule's rows clause.
- **F: shipped.** The README's live tail section by `report`, `burst` under the zone's limit, the deploy, `worker-check`.

**Done when** (the measures made exact in A1 and A2):
- [ ] **Its builds:** the level `tail` on both sides carries the base, `follow` (with `live`), and `custom-cells`, and their counterparts, and nothing else; the other levels byte-identical to before; its budgets (`gpui-tail-*`, `tanstack-tail-*`) against baselines of their own, gated by `check`, each feature's added bytes in a results note.
- [ ] **Its data credited:** the logs' file in `MANIFEST.json` (rows, bytes, SHA-256, its pinned source, credit, terms), the host dropped and the rule for the requests written down; the page and the README credit NASA-HTTP (Jim Dumoulin, KSC; contributed by Martin Arlitt and Carey Williamson) and say the feed is a replay.
- [ ] **The same on both sides:** one clock, the same rows due at the same times (checked at each side's receiver); `paging.json`'s `follow` scenarios and those with a `rows` step in TS with their controls; the loop's rows exact across a lap on both sides (a fixture: a row index past the end → its cells' text); the cells shown after a fixed replay byte-identical on both sides; `tanstack-parity` covering following, letting go on a scroll up, and coming back at the end, in Chromium, Firefox, and WebKit.
- [ ] **Its runs:** `check` gates its builds' budgets and runs its smoke, fixtures, and contract checks; the full cold protocol runs once, in part D, each results file labelled `live-tail-<stop>`, with its versions.
- [ ] **Its numbers:** at each stop, both sides, both devices: keeps up, Row shown in p50, late frames, work per frame, and a scroll back's latency under the feed; the soak's memory and late frames after 10 minutes; once a scenario: usable, data, memory; a results note.
- [ ] **The page:** the route, the dial, the status bar, the panel, and the description as the canvas draws them, "Measured with …" from the results; the Overview's rule gains its rows clause; `page --check` covers them.
- [ ] **Shipped:** the README's live tail section by `report`, `burst` under the zone's limit, the deploy, `worker-check`.

#### Part A1: the data, the replay's path, and the measures

**Done when:**
- [x] **A1-1, the source and its terms:** NASA-HTTP's July 1995 file downloaded into `data/raw/nasa/` (gitignored) and its SHA-256 recorded (pinned in `MANIFEST.json`'s `sources` by part B's prep, which fails on another download); its terms quoted; whether "freely redistributed" (no named license) meets the data rule, decided with the user and written down. *Evidence:* the file from `https://ita.ee.lbl.gov/traces/`, its size and SHA-256 and the rule widened in [`docs/DECISIONS.md`](docs/DECISIONS.md), "Scenarios", 2026-11-06.
- [ ] **A1-2, what's kept:** the columns (time, request, status, bytes; the host dropped), the malformed lines counted and their rule, the requests scanned for what identifies a visitor and the rule for them; the time's kind (text or `Timestamp`) and the lap's shift; the file's rows, bytes, and row groups under 25 MiB with native DuckDB (a draft of `prep-nasa.sql`). *So far:* every rule decided with the user and counted on a scratch file ([`docs/DECISIONS.md`](docs/DECISIONS.md), "Scenarios", 2026-11-06: what's dropped and cut, in order; the time a zoneless `TIMESTAMP` drawn as wall time; a lap the cleaned file's span). Left: `prep-nasa.sql`'s draft, the file's exact rows, bytes, and row groups from it, and the time's text format pinned for `cells.json`.
- [ ] **A1-3, the replay's path:** the clock (a worker per frame sending the rows due, or each side's own), the loop (row *i* → the file's row *i* mod *n*, a page across a lap read in two), and the rate's batches at each stop; where the TanStack side's follow comes from (the table's rule ported, on its scroller).
- [ ] **A1-4, the measures:** keeps up, Row shown in (from which stamp to which presented frame, each side's mark), a scroll back's latency under the feed, and the soak's memory and late frames, each defined so part D's scripts can read it, with the control each needs.
- [ ] **A1-5, what the canvas doesn't draw,** decided with the user: the time muted and a 404 in `--down` (*decided:* `custom-cells` on both sides, an error status, 4xx and 5xx, in the fall's color), a lap's seam (*decided:* the time moved on by the file's span), a way back to the tail once the reader has let go (open: End, as the table's own, or a button the canvas would need drawn).

## Next milestones

The "done when" checks are drafts until their milestone becomes active. The scenarios (M9–M13) are in the research's build order ([`docs/research/scenarios.md`](docs/research/scenarios.md), where each one's workload, measures, dial, and needs are); each scenario's research and spec open its milestone as part A, as the table's features do, and its later parts are split there.

**Every scenario milestone** (decided 2026-10-30, [`docs/DECISIONS.md`](docs/DECISIONS.md), "Scenarios"), each item a "done when" check of its own:
- **Its builds:** each contender builds once per feature level (Cargo features are compile-time, and the same scope keeps a level's code out of every other's bundle), at a base of its own under the contender's (`contenders/paths.ts`), staged and served beside the others, with its TTFP and wasm (or first-paint JS) budgets in `perf/budgets.json`, gated by `check` (root rule 1). A scenario on a level that exists shares its build (the admin table the base's; the monitoring wall market watch's, if its features match).
- **Its data credited:** the credit on the page and in the README, the license in `MANIFEST.json`; a synthetic feed is labelled synthetic on the page.
- **Its runs:** `check` gates its builds' budgets and runs its smoke, fixtures, and contract checks, never the full protocol. The full cold protocol (its stops × both sides × both devices × 10 runs, and its soaks) runs once, in its numbers part, on the final build (a long run: ask about a code review first); its part A estimates that time before fixing the stops. Its results files are labelled with its name, so it re-runs without the others.
- **Its versions:** each results file records what it was measured with (gpui-kit, React, TanStack Virtual, Arrow, DuckDB-Wasm, Chromium), and the scenario's explainer shows them ("measured with …"). A bump of any of them re-measures the scenarios it touches or labels their numbers with the versions they came from, decided per bump.

### M12: Scenario: admin table (the control)

The DOM's scenario: 50–500 rows of multilingual text, shown as capabilities (Ctrl+F, text selection, a screen reader, every script drawn), not speed. The base level and the world's countries (~250), each name in its own script, with a flag emoji, from CLDR or Wikidata ([the research](docs/research/scenarios.md), "Data"). GPUI bundles one face, so scripts outside it have no glyphs there, missing rather than shaped badly: part A decides whether the page shows that gap as it is or loads script fonts on the GPUI side after first paint (bytes, root rule 1) to test its shaping, and the page says which. Cheap: it moves ahead of M10 if the page needs its counterweight sooner.

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
| TanStack contender: first-paint JS (brotli) | ≤ 79.3 KiB (baseline 72.1 + 10%) | `check` | 73.3 KiB | — | [2026-11-03-m9-c-tanstack-sizes](perf/results/2026-11-03-m9-c-tanstack-sizes.json) |
| TanStack contender at the wide level: first-paint JS (brotli) | ≤ 84.5 KiB (baseline 76.8 + 10%) | `check` | 76.8 KiB | — | [2026-11-03-tanstack-sizes-wide](perf/results/2026-11-03-tanstack-sizes-wide.json) |
| TanStack contender at the market level: first-paint JS (brotli) | ≤ 83.1 KiB (baseline 75.5 + 10%) | `check` | 75.5 KiB | — | [2026-11-05-m10-c2-tanstack-sizes-market](perf/results/2026-11-05-m10-c2-tanstack-sizes-market.json) |
| TanStack contender: data layer and Arrow, after first paint (brotli) | ≤ 38.2 KiB (baseline 34.7 + 10%) | `check` | 34.8 KiB | — | [2026-11-03-m9-c-tanstack-sizes](perf/results/2026-11-03-m9-c-tanstack-sizes.json) |
| TanStack contender at the wide level: data layer and Arrow, after first paint (brotli) | ≤ 38.3 KiB (baseline 34.8 + 10%) | `check` | 34.8 KiB | — | [2026-11-03-tanstack-sizes-wide](perf/results/2026-11-03-tanstack-sizes-wide.json) |
| TanStack contender at the market level: data layer and Arrow, after first paint (brotli) | ≤ 44.8 KiB (baseline 40.7 + 10%) | `check` | 40.7 KiB | — | [2026-11-05-m10-c2-tanstack-sizes-market](perf/results/2026-11-05-m10-c2-tanstack-sizes-market.json) |
| Page: first paint (paint timing), /observatory/tall-table/big-file/ | ≤ 85 ms (baseline 70.8 + 20%) | `check` | 70.8 ms | 210.2 ms | [2026-10-19-m5-a-page](perf/results/2026-10-19-m5-a-page.json), [2026-10-21-page-production](perf/results/2026-10-21-page-production.json) |
| Page: first paint (paint timing), throttled | — | recorded | 437.4 ms | 474.7 ms | [2026-10-19-m5-a-page](perf/results/2026-10-19-m5-a-page.json), [2026-10-21-page-production](perf/results/2026-10-21-page-production.json) |
| Page: first-paint JS (brotli) | ≤ 86 KiB (baseline 78.2 + 10%) | `check` | 78.2 KiB | — | [2026-10-19-m5-a-page](perf/results/2026-10-19-m5-a-page.json) |
| Requests in the busiest 10 s, one visitor (the zone's rate limit counts per IP) | — | recorded | 141 requests | — | [2026-11-06-m10-f-burst](perf/results/2026-11-06-m10-f-burst.json) |
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

- **The base level's wheel readings.** A bare `mouse.wheel` reaches a native scroller's compositor every other frame in headless Chromium (`perf/results/2026-11-02-m9-a2.md`), and the base level's TanStack fling and Smooth were read through it. Whether to re-measure them on the gesture scroll, which the wide sheet uses from part D on (`docs/DECISIONS.md`, "Measurement"), and say so on the page meanwhile, is open; so is whether a real trackpad in a headed Chromium matches the gesture's rate.
- **The DOM's fling, read from its compositor.** The fling's late frames and lag are main-thread readings on both sides (`underLoad`), which on GPUI are the presented frames but on the DOM aren't: its compositor scrolls on through a late main-thread frame. The README says so. Whether the DOM side should also report what its compositor presented (`cc`'s frames and `Scroll Delta This Frame`, as the wheel's guard reads them) beside it, and which reading the page headlines, is a protocol change for root `docs/DECISIONS.md`.
- **A short page's missing cells.** The tall table draws a value past a page's end as `NULL` (`render_body`'s `unwrap_or(CellValue::Null)`); the TanStack contender draws it empty. A static file never answers short, so nothing measured differs; whether the component should draw it empty too is the component's call (Tycho drives it).

- **GPUI's key at the wide level.** In 6 of 120 key inputs (`perf/results/2026-11-03-m9-d.md`) no `EventLatency` of GPUI's key reached a frame, though the view moved and filled; the base level read all 120. And GPUI's first usable at the wide level was confirmed in 8 of 10 reference runs, its probe frame ~3 ms later than the base's. Whether either is Chromium's attribution or GPUI's first frames after usable doing more at the level is untested.

- **The pill's compositor frames.** Throttled, the meter as a pill dropped more compositor frames than hidden on both sides (TanStack 7.98% against 3.5%, GPUI 4.21% against 0), while the open meter dropped none more (`perf/results/2026-10-21-m5-d4.md`). The pill isn't the default, so nothing gates it; whether it should get a layer of its own (`will-change: transform`, as the open meter has), and whether that's the cause, is untested.
- **A spread for a short mark.** The quiet-machine gate is (max − min) / median under 6% of each variant's open mark. TanStack's reference mark is ~500 ms, so one 15–30 ms stray fails it (7.0–7.7% in both D4 runs, while its gates read 0 against 0). Whether short marks get a floor in ms, or the gate uses the interquartile range over the median, is open.
- **The landing page.** The observatory's Worker holds the apex `seiza.io` (everything outside `/observatory/` a 404). The page is basic (a title, a catchy line, a link to the observatory), built in `site/landing/` on `site/ui/`'s shell (root `docs/DECISIONS.md`, "Repo structure"); when it ships is open. Shipping it moves the Worker to `site/worker/` and adds `/`, `/index.html`, and `/assets/` to the seiza.io WAF rule (`/fonts/` is in it already).
