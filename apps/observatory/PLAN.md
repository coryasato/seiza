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
| M13 | Scenario: monitoring wall (parts A1–A3, B1–B2, C1–C2, D1–D2, E, F) | Done 2026-11-11 ([`docs/milestones.md`](docs/milestones.md)) |
| M14 | The wide sheet's later steps: a resize drag, a range copied | Active (opened 2026-11-12; A1–A2, B, C1, C2, and D1 done, D2 next) |

**Parts are sized to one working session.** Each ends with its own checks passing and its evidence written down, so the next session starts from this file, not from the last one's context. A part that grows past a session splits before it's started, not halfway through.

**Closing a milestone:** as for every app (root `CLAUDE.md`, "Working agreements"): every "done when" check passes; the numbers are in `perf/results/` with a note; new decisions are in `docs/DECISIONS.md` (repo-wide ones in the root's); a `docs/LESSONS.md` entry is written; and the milestone's spec and evidence move from here to `docs/milestones.md`, leaving one row above.

**Component and engine changes:** the observatory consumes the tall table and the DuckDB engine; it doesn't reshape them (root `docs/DECISIONS.md`, "Repo structure"). The changes it needs, all listed here (each done, and recorded in `docs/milestones.md`): `Paging` gains the two settle times (M2 part A, the one change to the table's internals, defaults unchanged), the table's fixtures and their native tests (M2 part C, with `shown_text` split out of the render loop for them, and `seiza-duckdb`'s `summary_queries` returning the queries `open_parquet` sends), `@seiza/duckdb` takes its extension directory as an option (done, M0 part A), and `seiza` gains a `panel` feature (on by default) while its title bar and theme toggle move to Tycho, with the Mac input bindings opt-in (M2 part A), and `seiza::targets` (publishing a control's bounds) moves there from Tycho, as do Tycho's first-draw probe and placeholder screenshot match to `shared-web/perf/` (M2 part B), and `cells.json` gains two hand-written `rounding` cases (M3 part A: fixture data only, no code). Each records its effect on Tycho. The scenarios ask for more, each built by its own crate's plan: the table's `density` (tall-table M10, adopted in M9), and its `format` (asked 2026-11-04 for market watch). Market watch's seeded feed is the observatory's own, not the engine's (decided 2026-11-04, M10 below).

**Waiting on** (features of a component or engine the observatory needs, and repo-wide changes it adopts; only that crate's `PLAN.md` (or the change's plan) builds them, and the session that closes one flips its row to *Ready*):

| Needs | For | Status |
|---|---|---|
| tall-table `follow` (same; [its README](../../components/tall-table/README.md), "Following the tail") | Live tail (M11) | *Ready* (2026-10-25, tall-table M4) |
| tall-table `let_go`: following turned off by the host, the view left where it is, `Following(false)` emitted (the reader's moves do it today; `set_following` is private) | Live tail's Pause (M11 part E2) | *Ready* (2026-11-09, tall-table M13; the TanStack contender's `letGo` built with it, in `follow.ts`, its fixture scenario and control run on the tail level) |
| tall-table's copy fixture (`fixtures/copy.json`; tall-table M14, [its milestones](../../components/tall-table/docs/milestones.md)) | The TanStack contender's copy, ported against it (M14 part C2) | *Ready* (2026-11-12, tall-table M14) |
| tall-table `resize`, `select`, `copy` ([its PLAN](../../components/tall-table/PLAN.md), "Columns" and "Selection") | The wide sheet's later steps, a resize drag and a range copied (M14) | *Ready* (`resize` 2026-10-26, tall-table M5; `select` 2026-10-26, M6; `copy` 2026-10-27, M7) |

---

## Active milestone

### M14: The wide sheet's later steps: a resize drag, a range copied

Opened 2026-11-12. M13's spec and evidence are in [`docs/milestones.md`](docs/milestones.md).

The research's later steps for the wide sheet ([`docs/research/scenarios.md`](docs/research/scenarios.md), "Wide sheet"): a column-resize drag, and a range selected and copied. They come after the other scenarios (decided with the user, 2026-11-04). Their features are *Ready* ("Waiting on"). **The wide level grows** (decided with the user, 2026-11-04): its one build on each side gains the table's `resize`, `select`, and `copy` and their counterparts, so a visitor resizes and copies in the frame they scroll. No second wide build and no switch between them. The same scope still holds: the base level carries none of it. Because each side's bundle grows, the wide sheet's numbers are measured again at the grown level and replace M9's.

- **The GPUI side:** the crate's feature `wide` turns on `resize`, `select`, and `copy` (and the bridge's), the host writing the clipboard through `tall-table-bridge`'s `clipboard::Clipboard`, the key columns resizable as `pin` allows, the copy's limits the table's defaults (`key_max_cells`, `max_bytes`), and a declined copy said in the window. New contract marks for the measures below; `docs/contender-contract.md` gains them.
- **The TanStack side:** each feature's counterpart on its scroll model, ported from the table's own logic as the paging is. The resize band, its drag (live, clamped, the sideways scroll held until the release) and double-click fit, and a pinned column's limit. The selection model (`Rows`, `Columns`, `Cells` from an anchor to a head; the pointer, the keys, the tint and the active cell's edge). The copy: tab-separated exact values (`format.ts`), read a page at a time beside the cache, the same caps and events, the clipboard written as the bridge writes it (`ClipboardItem` with a promise opened at the key).
- **Fixtures prove "the same":** `cells.json`'s `resize` section (skipped by the TanStack contender today) and `selection.json` in TS with their controls, and a copy fixture of the component's (a range → its text, exact; the caps) if the table has none, asked of the component's PLAN, never written here. `tanstack-parity` gains the resize band and drag, the selection's pointer and keys, and Cmd+C.
- **The measures** (the research's, made exact in part A): a resize drag's frame cost (each frame's work while a day's column is dragged, both sides, at each stop), a selection drag's, and a copy's time (the key → the clipboard written) for a range under `key_max_cells` and for one past it confirmed (the copy's turns spread over frames: does the view keep up meanwhile?).
- **The page:** how the window offers the tools and where their numbers go (the status bar, the panel's cards, the description), designed first: new boards on M8's canvas, light and dark, desktop and phone, decided with the user before anything is built (the canvas draws none of it today). The admin table's capability list (M12) may already say GPUI's selection by then; part A checks the two read as one story.
**Parts** (each one session; A2 confirms B–F and splits any past a session, as M13's A3 did):
- **A1: the spec.** Everything but the boards, from the code as it is:
  - The level's shape: what `wide` gains on each side (the crate's feature and the bridge's, `LEVEL_FEATURES.wide`, the TanStack contender's `__LEVEL__ === 'wide'` branches), and what keeps every other level's build unchanged (the base, market, tail, and wall wasm and bundles; `sizes`' and `tanstack-sizes`' checks).
  - The measures made exact: which column a resize drag takes and how far, the selection drag's path, the copy's ranges (one under `key_max_cells`, one past it confirmed), what "keeps up meanwhile" reads, each at which stops, and each side's input path (the gesture scroll where a scroll is under way).
  - Their scripts: which `metric-*` script takes each (or a new one), the contract marks each needs (`docs/contender-contract.md`'s changes), and how TanStack's copy is timed the way the bridge's is.
  - The fixtures: `cells.json`'s `resize` and `selection.json` on the TanStack side; the copy fixture (the component has none: `components/tall-table/fixtures/` holds no copy cases), asked of the table's `PLAN.md` with a "Waiting on" row here, and where it lands in B–F.
  - The suite's time: the wide sheet's cold suite again at every stop plus the new measures, both sides, both devices, 10 runs.
- **A2: the boards, then B–F confirmed.** New boards on M8's canvas (https://claude.ai/artifact/6cHBgVwwSqpTad8GP9KnGK), light and dark, desktop and phone, decided with the user before anything is built:
  - How the window offers the tools: the resize band, a selection, a copy (its progress, a declined key and how a visitor confirms, the clipboard written or refused).
  - Where the new numbers go: the status bar, the panel's cards, the description.
  - What a phone offers (no pointer resize on touch; the canvas tradeoffs).
  - The admin table's capability row ("Select and copy a capital": GPUI "no" on the base build) and the wide sheet's selection read as one story.
- **B: the GPUI side at the grown level** (its build, the host's copy and the page's hooks, its contract; its wasm and TTFP against the level's baselines, rewritten).
- **C1: the TanStack side's resize and selection** (the ports, `cells.json`'s `resize` and `selection.json` with their controls, `tanstack-parity`'s band, drag, fit, and selection).
- **C2: the TanStack side's copy** (the port and its data side, the copy fixture, the clipboard, the contract and the page's hooks; its first-paint JS and data layer against the level's baselines, rewritten; a copied range byte-identical on both sides).
- **D1: the metrics** (`metric-drag`, `metric-copy`, the A/B's scrolls, each smoke-run with its controls; reviewed before D2).
- **D2: the runs** (the A/B, the suite again only where it moved, the new measures: ~2 h 10 min in one sitting).
- **E1: the window** (the Copy button and its explainer, the status bar's copy line, a phone's, the lead; `page --check`).
- **E2: the panel and the description** (the two new sections from the results, the wins, the shortfalls, the admin row; `page --check`).
- **F: shipped** (the README's sections, `burst`, the deploy, `worker-check`).

**Done when:**
- [ ] **Its builds:** the wide level on both sides carries `resize`, `select`, `copy` and their counterparts, and nothing else new; the base level byte-identical to before (every other level as `sizes` checks it: [`docs/DECISIONS.md`](docs/DECISIONS.md), "GPUI contender", 2026-11-05); the level's budgets (`gpui-wide-*`, `tanstack-wide-*`) against rewritten baselines, gated by `check`, with each feature's added bytes in a results note.
- [ ] **The same on both sides:** the fixtures above pass on both sides with their controls; `tanstack-parity` covers the band, the drag, the selection's input, and the copy, in Chromium, Firefox, and WebKit; a copied range's text is byte-identical on both sides and against native DuckDB's values.
- [ ] **Its numbers:** the wide sheet's scrolls at the grown level against M9's level, an interleaved A/B at every stop (decided with the user, 2026-11-12): M9's numbers stand, labelled with their build, where none moved, and the suite runs again where one did, replacing M9's on the page and in the README; and the new measures, both sides, both devices, median of 10, each results file with its versions; a results note.
- [ ] **The page:** the tools in the window and their numbers as the design draws them; `page --check` covers them.
- [ ] **Shipped:** the README's wide sheet sections with the new rows by `report`, `burst` under the zone's limit, the deploy, `worker-check`.

### Part A1: the spec

**Done when:**
- [x] **A1-1, the level's shape:** what `wide` gains on each side and what each touches, listed for B and C; how every other level's build stays unchanged.
  - **The scenario:** `LEVEL_FEATURES.wide` gains `resize`, `select`, `copy` (`custom-cells`, `pin`, `density`, `resize`, `select`, `copy`); `sizes` then checks the table's and the bridge's features are exactly those. No new level, stop, or file.
  - **The GPUI crate (B):** the feature `wide` gains `seiza-tall-table/{resize,select,copy}` and `tall-table-bridge/{resize,select,copy}` (the bridge's `copy` turns on its `select`).
    - `scene.rs`: every column resizable, the key columns as `pin` allows (the table's `pin_limit` holds a pinned column's drag at the press's half). The copy's limits are the table's defaults (`key_max_cells` 100,000, `max_bytes` 64 MiB), headers off. Every selection kind on (the table's default).
    - The host hands each `TallTableEvent::Copy` to `clipboard::Clipboard` and tells it at `close` (a replay's reopen). A refused or unavailable write cancels the copy (`event`'s return).
    - The confirmed copy is Cmd+C (Ctrl+C) again on the selection the key declined, the host's `copy`: a key, so the clipboard takes it as a gesture. A2's boards say how the window offers it. (*Changed in B:* first Cmd+Shift+C, as the bare host's `CopyConfirmed`, which is the browsers' Inspect Element; [`docs/DECISIONS.md`](docs/DECISIONS.md), "Scenarios", 2026-11-12.)
    - `contract.rs` publishes A1-3's marks and globals. The wide code sits at the files' ends or in its own (`src/wide.rs` if it grows past a few lines), so no other level's panic locations move.
  - **The TanStack contender (C):** `__LEVEL__ === 'wide'` branches only, each level's habits (`docs/DECISIONS.md`, "TanStack contender"):
    - `resize.ts`, a port of `state/resize.rs`: the bands (4 px each side of a 1 px hairline), the drag (width at the press plus the pointer's move, clamped; back at the press's x, the set width; a kind's width held until the pointer brings it inside), the sideways scroll held (`held_content`), the double-click fit over the visible loaded rows (each text's width as the browser measures it in the cells' font, the numbers by character count at the number advance, as `fit_column` does), and the widths published at a release or fit that changed one. TanStack Virtual's column sizes take the widths, so the column virtualizer re-measures.
    - `select.ts`, a port of `selection.rs` and `state/select.rs`: `Rows`, `Columns`, `Cells` from an anchor to a head, `target_at` (a cell, a row's number, a header, the corner), `cell_clamped`, the keys (`key_step`, `scroll_into_view`), the tint and the active cell's edge per region (pinned and scrolled), Escape.
    - `copy.ts` with its data side in `data/`: `push_value` and `header_line` (`format.ts`'s exact text, quoted for a tab, a line break, or a `"`; NULL empty), the turns (`TURN_CELLS` a turn, one `Text` each), the key's limit and the cap with `least_bytes`, and the reads beside the cache: `PageCache`'s copy reads (`set_copy_wants`, the plan's grant after the visible pages, before prefetch, `background_limit`, `holding` and `loading`, the passed page dropped, the cancels). It's a function behind `__LEVEL__ === 'wide'`, never a method, so no other level's paging chunk carries it. The clipboard is written as the bridge writes it: `ClipboardItem` with a promise opened at the key, resolved with a Blob at the last row; `writeText` where there's no `ClipboardItem`.
    - **A drag draws once a frame:** a resize or selection move is applied in the frame's callback (`flushSync`), as market watch's landings are. It's the idiomatic batching, and it puts the drag's commit in the frame's `animate` work, where `domDrawn` reads the DOM's drawn frames.
    - `copy.ts` and its data side load after first paint with the data layer. Only the bands and the selection's drawing join first-paint JS.
  - **Every other level unchanged:** the base's wasm and bundles byte-identical (the features are compile-time and `__LEVEL__` folds); the market, tail, and wall levels as `sizes` and `tanstack-sizes` check them (their Cargo features, their bundles), [`docs/DECISIONS.md`](docs/DECISIONS.md), "GPUI contender", 2026-11-05.
  - **What the bytes should be:** the table's own figures put the GPUI wide wasm at about +20 KiB brotli (`resize` +2.7, `select` +6.5, `copy` +11.0 over `select`; [the table's README](../../components/tall-table/README.md), "Features"), ~2,795 KiB against the 3,191 budget. TanStack's first-paint JS grows by the bands and the selection, its data layer by the copy. Both baselines are rewritten in B and C.
- [x] **A1-2, the measures:** the resize drag, the selection drag, and the copy (under the key's limit; past it, confirmed; the view meanwhile) made exact, each side's input path, the stops each runs at.
  - **The resize drag,** at every stop: the first day's edge (Jan 1, column 3, right of Latitude) dragged right 200 px and back, twice, a pointer move every 8 ms (~2 s), as the table's own `perf` segment does (`components/tall-table/perf/perf.ts`). Every frame re-lays out the columns; back at the press, the release changes nothing.
  - **The selection drag,** at every stop: from the top row's first scrolled cell (Latitude) to the last fully visible row and column and back, a row a move with the column following the diagonal, a move every 8 ms, ~2 s of round trips, the table's segment. Every move changes the selection, so every frame redraws the tint.
  - **The drags' readings,** both sides, both devices, median of 10, nothing read whole first (the visible pages loaded and rested):
    - "Keeps up": `drewShare` over the drag (GPUI's presented frames; the DOM's `domDrawn`), at the scrolls' 90%.
    - Work a frame, p50 and p95, from Chromium's trace (`frameWork`).
    - Late frames.
    - Real pointer events on both sides (Playwright's `mouse.down`, `move`, `up`); no gesture, so no DPR scaling.
  - **The copies,** at the default stop (`rows-20`) alone: a copy's reads and text don't depend on the density. Both sides, both devices, median of 10, each from a cold view. Native DuckDB sized the file for them: 368 columns × 10,632 rows = 3,912,576 cells, ~18.0 MiB as TSV (1,774 B a row), so a whole-sheet copy passes the key's limit (100,000 cells, 271 rows of every column) and fits the 64 MiB cap.
    - *The block:* the visible block, selected by a drag (~710 cells, every page in hand); Cmd+C → the clipboard written.
    - *A week:* seven days' columns (a header press, Shift+press six on: 74,424 cells, under the key's limit); Cmd+C → the text all in → written. A block of a few columns reads every column of a page, so it reads all 11 pages, beside the cache: the copy's reads on each side.
    - *The sheet:* Cmd+A, then Cmd+C (declined: the key's limit, said in the window, A2), then Cmd+C again (confirmed): 3.9 M cells, ~18 MiB; the key → the text all in → written, the reads, and the main thread's time outside frames (the copy's turns).
    - *The view meanwhile:* the scrolls' steady gesture down (`SCROLLS.down`) started at the sheet's confirmed key, its `drewShare`, late frames, and work, against the same scroll with no copy in the same run (the table's `copy.ts` method). A copy that ends before the scroll does is said (`coveredPct`).
- [x] **A1-3, the scripts and the contract:** each measure's script, the marks and globals it reads, `docs/contender-contract.md`'s changes listed.
  - **The scripts (D1):** `perf/metric-drag.ts` (the two drags, `--stop`), `perf/metric-copy.ts` (the copies and the view meanwhile). Each is a `metric <name>` on `perf/contender.ts`'s runner, with each side's files labelled `<label>-wide-sheet-<stop>`.
  - **The marks, with `?measure`, on the wide level only:**
    - `contender:copy-started`: GPUI's `Started`; TanStack's key handler opening the `ClipboardItem`.
    - `contender:copied`: the text all in. GPUI's `Copied`; TanStack's last turn.
    - `contender:copy-written`: the browser's write resolved. The bridge's callback; TanStack's `write()` promise.
    - `contender:copy-declined`: a key past `key_max_cells`, nothing read.
    - Each is timed from the key's event, as `metric-response` times a key (`docs/contender-contract.md`, "Reading the metrics").
  - **The globals, with `?measure`:**
    - `__contender.copy`: the copy's outcome as the bridge spells it (declined, copying, writing, written, refused, failed, unavailable).
    - `__contender.selection`: `{kind, anchor, head}` or `null`, as `selection.json` spells it.
    - `__contender.widths`: each column's set width.
  - **The drags' geometry:** the scripts read where to press from the layout once, at rest, before the traced window: `__contender.layout` (the columns' lefts and widths, the row height, the pin), today published only with `?cells`. B and C publish it with `?measure` at each layout change, never a frame. B confirms it costs a measured run no frame work; if it does, a target for each press instead (`seiza::targets`).
  - **`docs/contender-contract.md`'s changes (B and C):** the marks table's four copy rows; "State"'s three globals and the layout with `?measure`; "Reading the metrics"' drags (drew share, work, late frames) and copies (the key's event to each mark; the view meanwhile).
  - **The checks:**
    - `perf/wide.ts` gains a copied range's text byte-identical on both sides and against native DuckDB's values: the week's 74,424 cells, and a block across the pinned edge.
    - `tanstack-parity` gains the band's place and cursor, the drag (live, clamped, the sideways scroll held to the release), the fit's width within a pixel of GPUI's, the selection's press, Shift, drag, and keys, the tint's place, and Cmd+C (Chromium, Firefox, WebKit).
    - `tanstack-contract` gains the four marks and their order.
- [x] **A1-4, the fixtures:** `cells.json`'s `resize` and `selection.json` on the TanStack side with their controls; the copy fixture asked of the table's `PLAN.md` (its "Asked for" and "Who's waiting" rows, a "Waiting on" row here), and the part that waits on it.
  - **On the TanStack side (C):** `cells.json`'s `resize` section (7 widths, 6 cells: the clamp and the budgets; skipped today in `fixtures.test.ts`) and `selection.json` (skipped today), each with TS counterparts of the native controls. The fit isn't a fixture (its widths are shaped text); `tanstack-parity` checks it against GPUI's.
  - **The copy fixture, asked of the table:** `components/tall-table/fixtures/` holds none. Asked for: `fixtures/copy.json`, run natively against `copy.rs`'s text and the state's `copy`, with controls:
    - A small source's ranges (`Rows`, `Columns`, `Cells`, the anchor after the head) → their exact text.
    - Values that need quoting (a tab, a line break, a `"`), NULL and empty text, floats' exact text (exponents, −0.0), integers, and the header line when it's on.
    - The key's limit at n and n + 1 cells; `least_bytes`' refusal; the cap passed mid-copy.
    - The controls: NULL written as text, no quoting, the limit off by one.
  - **Who builds it, and when** (decided with the user, 2026-11-12): the table's PLAN, as a follow-up to `copy` ahead of `reorder` (its "Follow-ups to built features" and "Who's waiting"; "Waiting on" above). Part C waits on it; A2 and B don't.
- [x] **A1-5, the suite's time,** and whether part D splits.
  - **The new measures:** the drags at 4 stops × 2 sides × 2 devices × 10 runs, ~15 s reference and ~40 s throttled a run: ~75 min. The copies at one stop × 2 sides × 2 devices × 10, ~65 s a pair of runs: ~25 min. **About 1 h 40 min,** one sitting.
  - **M9's suite at the grown level** (the done-when's "again at every stop") is ~3.5 h more in two sittings ([`docs/milestones.md`](docs/milestones.md), M9 A2). What it would re-read is the same scrolls with resize, select, and copy built but idle. The table measured that idle cost natively: `resize`'s bands +0.05–0.15 ms a frame, `select` and `copy` within the spread. TanStack's idle cost (a selection state on each cell) isn't known.
  - **Decided with the user, 2026-11-12:** an interleaved A/B first, M9's level against the grown one, reference, the stops' scrolls, 10 rounds a side (~30 min). M9's numbers stand, labelled with the build they came from, if every reading is within the spread; the suite is re-run only if one isn't. D would be ~2 h 10 min in one sitting (the A/B, then the new measures), and the done-when's "again at every stop" becomes "the A/B, and the suite again only where it moved".

### Part A2: the boards, then B–F confirmed

**Done when:**
- [x] **A2-1, the boards,** drawn on M8's canvas and decided with the user: the tools in the window, the numbers' places, a phone, light and dark; the admin table's capability row and the wide sheet's read as one story.
  *Evidence:* the canvas's wide-sheet row (https://claude.ai/artifact/6cHBgVwwSqpTad8GP9KnGK, "The wide sheet's later steps"): WideSelect (light, GPUI, a block selected, the Copy explainer open), WideResize (dark, Jan 1's edge mid-drag), WideDeclined (light, TanStack, the sheet's key declined), WideCopying (dark, GPUI, the sheet copying, "Cancel"), WideCopied (light, TanStack, a week copied), WidePanel (the two new sections), PhoneWide and PhoneWideDark (a day selected by its header, then copied). The main board's lead, description, and admin row changed with them. [`docs/DECISIONS.md`](docs/DECISIONS.md), "Page", 2026-11-12. The four calls were the user's; the boards as drawn wait on the user's look, which E1 starts from. Every number on them is a sketch until D2.
- [x] **A2-2, B–F:** each part's checks written, split where one is over a session.
  *Evidence:* the parts below. C split in two (the resize and selection ports, then the copy's), D as every scenario's (D1's code reviewed before D2's runs), E in two (the window, then the panel and the description).

### Part B: the GPUI side at the grown level

**Done when:**
- [x] **B-1, the level's build:** the crate's feature `wide` gains `seiza-tall-table/{resize,select,copy}` and the bridge's; `LEVEL_FEATURES.wide` gains them; the wide code at the files' ends or in `src/wide.rs`. `sizes --check` passes (the wide level's features exactly `LEVEL_FEATURES.wide`), and the base, market, tail, and wall wasm are byte-identical to HEAD's. Each feature's added bytes, brotli, in the results note (A1-1's ~+20 KiB, against the 3,191 budget).
  *Evidence:* `perf/results/2026-11-12-m14-b-sizes.json` (`sizes --check` PASS: the wide level's table and bridge features `copy, custom-cells, density, pin, resize, select`); the four other levels' shipped wasm `cmp`-identical to a build of HEAD's tree; `resize` +2.4, `select` +5.8, `copy` with the host +10.9 KiB brotli, 2,798.6 KiB in all ([results note](perf/results/2026-11-12-m14-b.md)). The host's part is `src/wide.rs` ([`docs/DECISIONS.md`](docs/DECISIONS.md), "GPUI contender", 2026-11-12).
- [x] **B-2, the scene and the host's copy:** every column resizable (a pinned one held by the table's `pin_limit`), the copy's limits the table's defaults, headers off, every selection kind on. Each `TallTableEvent::Copy` handed to `clipboard::Clipboard`, a refused or unavailable write cancelling the copy, the writer told at `close`; Cmd+Shift+C and Ctrl+Shift+C the host's `copy` (now Cmd+C again on the declined selection, below). On touch, a tap selects; a band on touch is checked: if a touch drag resizes, that's put to the user before C1, not left to differ from TanStack's.
  *Evidence:* `perf/results/2026-11-12-m14-b-wide-tools.json`: Jan 1 dragged 68 → 128 px and fitted to 46; Place held with the pinned run at half the cells (668 of 1,336 px); the sheet declined by Cmd+C and written by Cmd+C again, declined again after a selection change in between (the control), Ctrl+C too, and Cmd+Shift+C copying nothing. Cmd+Shift+C was the confirm first; it opens the browsers' Inspect Element, so a second Cmd+C confirms instead ([`docs/DECISIONS.md`](docs/DECISIONS.md), "Scenarios", 2026-11-12). The writer is told when the host closes a table (`contract.rs`'s `opening_level`, right after the close in a reopen). On touch a tap selected and a touch drag on a band resized nothing, as TanStack's: nothing to put to the user ([`docs/DECISIONS.md`](docs/DECISIONS.md), "Scenarios", 2026-11-12).
- [x] **B-3, the contract:** with `?measure` on the wide level, `contender:copy-started`, `copied`, `copy-written`, `copy-declined`, and `__contender.copy`, `.selection`, `.widths`, and `.layout` published at each layout change, never a frame (a measured run's frame work with and without it within the spread, else a target per press). `docs/contender-contract.md`'s marks table, "State", and a new "The copy line" section (below).
  *Evidence:* the four marks in order for every copy (started → copied → written; `copy-declined` alone for the sheet's key), none of the globals without `?measure` (the control); `layout` the same object through a 1,200 px scroll down and sideways: the table emits `Layout` only at a layout change, so no frame carries it and the frame-work A/B was moot. `docs/contender-contract.md`: the marks' rows, the wide sheet's state, "The copy line".
- [x] **B-4, the page's hooks** ("The copy line", the follow toggle's pattern): on the wide level with `?readout`, the frame tells its parent `{ seiza: 'tools', cells, copy, done, bytes, ms }` at each selection change and copy event (never a frame), and exports `__contenderTools.copy()` and `.cancel()`, which the page calls inside its click. Checked from a parent page in Chromium, Firefox, and WebKit: the button's call writes the clipboard (a press in the parent is the gesture), and a bare page sends nothing.
  *Evidence:* in each browser, 6 messages for a 12-cell block and the button's copy (0, 1, 12 cells; copying, writing, written), the paste DuckDB's text; without `?readout` no message and no `__contenderTools`. `contenders/tools.ts`, shared with C2. Chromium refused until the frame focused itself before the copy; the message coalesces to 100 ms and adds `reason` ([`docs/DECISIONS.md`](docs/DECISIONS.md), "Page", 2026-11-12).
- [x] **B-5, its checks and budgets:** `perf/wide.ts`'s GPUI half: a band's drag and double-click (`widths`), a selection drag (`selection`), the week's Cmd+C text against native DuckDB's values to the byte and a block across the pinned edge, the sheet's key declined and Cmd+C again written, the marks in order. `gpui-wide-ttfp`, `-ttfp-throttled`, and `-wasm` against a rewritten `levels.wide`; the placeholder matching (`placeholder --level wide`). `check` passes.
  *Evidence:* `perf/wide.ts --side gpui` PASS (every stop's layout and heat, the failures, then the tools: the week's 346,361 characters and a block across the pinned edge, and the sheet's 18.0 MiB, each native DuckDB's to the byte). `cold --level wide --check` 153.1 ms against M9's 198.9 limit, then `levels.wide` rewritten: 153.4 ms reference, 3,621.1 ms throttled, 2,799.5 KiB (`2026-11-12-gpui-cold-wide.json`), from the build before the review's fixes, kept with the user (the shipped build is 2,798.6 KiB, `m14-b-sizes`). `placeholder --level wide` matched in both themes at DPR 2 and 1. `check`: every step passed, three on a rerun after a timing reading outside this part's code ([results note](perf/results/2026-11-12-m14-b.md)).

### Part C1: the TanStack side's resize and selection

**Done when:**
- [x] **C1-1, the ports** behind `__LEVEL__ === 'wide'` (A1-1's list): `resize.ts` (the bands, the drag live and clamped, the sideways scroll held to the release, the double-click fit, the widths published at a release or fit that changed one; TanStack Virtual's column sizes from them) and `select.ts` (`Rows`, `Columns`, `Cells`, the pointer, the keys, the tint and the active cell's edge per region, Escape). A drag's move applied once a frame in the frame's callback (`flushSync`). The bands take a mouse or a pen only; a tap selects. The base, market, tail, and wall bundles byte-identical to HEAD's.
  *Evidence:* `select.ts` and `resize.ts` pure, `wide-tools.ts` their DOM, the selection drawn in the cells, `wide-theme.css` its edge color ([`docs/DECISIONS.md`](docs/DECISIONS.md), "TanStack contender", 2026-11-12). The four other levels' `dist*` `diff -r`-identical to a build of HEAD's tree. The wide first-paint JS +4.4 KiB brotli, 82.2 KiB against the 84.5 budget (`2026-11-12-m14-c1-tanstack-sizes-wide.json`). With `?measure`, `__contender.selection`, `.widths`, and `.layout` published now (C2-3's other globals and marks come with the copy) ([results note](perf/results/2026-11-12-m14-c1.md)).
- [x] **C1-2, the fixtures:** `cells.json`'s `resize` section and `selection.json` run in `fixtures.test.ts` (no longer skipped), each with TS counterparts of the native controls failing.
  *Evidence:* `selection.json`'s 13 scenarios pass, each of its 5 controls failing; `resize` passes, the budgets ±1 and the unclamped widths failing. The contender's tests: 109 pass, 2 skipped (`copy.json`, `sort.json`).
- [x] **C1-3, the parity:** `tanstack-parity` at the wide level gains the band's place and cursor, the drag (live, clamped, the sideways scroll held to the release), the fit within a pixel of GPUI's, the selection's press, Shift, drag, and keys, and the tint's place against GPUI's, in Chromium, Firefox, and WebKit.
  *Evidence:* `perf/parity-tools.ts`, run by `tanstack-parity` (`2026-11-12-m14-c1-tanstack-parity.json`, all passed in all three browsers):
  - Fits 46 and 195 px, GPUI's 46 and 195.
  - Clamped at 31 px as GPUI's.
  - Twenty selection steps give GPUI's selection and top row; a page key moves by each side's own page (the views 42.3 and 41.5 rows, as the base parity allows).
  - The tint's box is GPUI's to the pixel, a block a row off differing (the control).
  - Each band's hairline is at its edge, with `col-resize`, taking the press.
  - Mid-drag the width is live with nothing published; the sideways scroll is held mid-drag (a trackpad's wheel moving the rows) and clamped at the release.
  - A pinned column narrowed leaves no strip undrawn, and two keys in one task land flush (the review's fixes).

### Part C2: the TanStack side's copy

**Done when:**
- [x] **C2-1, the port:** `copy.ts` and its data side (A1-1's list: the text exact and quoted, the turns, the key's limit, the cap, the reads beside the cache with the plan's grant), a function behind `__LEVEL__ === 'wide'`, loaded after first paint with the data layer; the clipboard written as the bridge writes it (`ClipboardItem` opened at the key, `writeText` without it); Cmd+C again on the selection the key declined confirms (a selection change in between declines again), as the GPUI host's; Escape cancels.
  *Evidence:* `data/copy.ts` (the copy, its reads granted by `plan` after the visible pages, its events told after the call, its turns on `MessageChannel` tasks) and `copy.ts` (the writer and the host's keys), loaded with the data layer and carried on the wide scene ([`docs/DECISIONS.md`](docs/DECISIONS.md), "TanStack contender", 2026-11-12). The four other levels' `dist*` `diff -r`-identical to a build of HEAD's tree. The sheet declined, declined again after a selection change, then written by Cmd+C again; Escape mid-copy `failed`/`cancelled` with the selection kept (`m14-c2-wide-tools`, `m14-c2-tanstack-contract`; [results note](perf/results/2026-11-12-m14-c2.md)).
- [x] **C2-2, the copy fixture:** the table's `fixtures/copy.json` run against it in `fixtures.test.ts`, with its controls.
  *Evidence:* its 30 cases pass, its options `COPY_OPTIONS`; each of its six controls fails every case it names; a FLOAT column copies its float32 text (the review's fix). The contender's tests: 140 pass, 1 skipped (`sort.json`).
- [x] **C2-3, the contract and the page's hooks:** B-3's marks and globals and B-4's messages and `__contenderTools`, the same on this side; `tanstack-contract` gains the four marks and their order, `tanstack-parity` Cmd+C in three browsers.
  *Evidence:* `tanstack-contract`'s wide level (`m14-c2-tanstack-contract`): a block's started +0.5, copied +0.8, written +25.8 ms from the key, started before the next frame; the sheet's key declined alone; nothing without `?measure`. The copy line from a parent page in Chromium, Firefox, and WebKit: 6 messages, as GPUI's, the button's copy pasted as DuckDB's; without `?readout` nothing. `perf/parity-tools.ts`: Cmd+C pasted GPUI's text in all three; with nothing selected no copy mark on either side (the control).
- [x] **C2-4, the same text, and its budgets:** `perf/wide.ts` with both sides: the week's copy and a block across the pinned edge byte-identical on both sides and against native DuckDB's values. `tanstack-wide-first-paint-js` and `-data-layer-js` against a rewritten `levels.wide` (the bands and the selection's drawing in first paint, the copy in the data layer). `check` passes.
  *Evidence:* `wide --only tools` with both sides (`m14-c2-wide-tools`): the week (74,424 cells), the block, and the 18.0 MiB sheet each native DuckDB's to the byte on each side, and the same SHA-256 on both. `levels.wide` rewritten: first-paint JS 82.4 KiB (+167 B), data layer 39.2 KiB (+4,496 B), `tanstack-sizes --level wide --check` PASS (`m14-c2-tanstack-sizes-wide`). Every run here is of the build with `/code-review high`'s eight fixes. `check`: every step passed but the last, `page --check`, whose checks all passed and whose first paint read over its 72.5 ms budget: a median of 94.2 ms (69.8–153.5), then 82.5 ms (57.2–110.4) alone, at a load average of 10 on the 8-core machine: the CPU was busy. The page's sources are unchanged this part.

### Part D1: the metrics

**Done when:**
- [x] **D1-1, `perf/metric-drag.ts`** (A1-2's drags at `--stop`): the layout read once at rest, the press from it, real pointer events every 8 ms, the traced window; drew share, work p50 and p95, late frames, both sides. A smoke run at one stop, its control (a run with no drag reads no drawn frames).
  *Evidence:* `2026-11-13-m14-d1-smoke-drag-wide-sheet-rows-20.json`, PASS: at the reference GPUI drew 100% of frames on both drags, TanStack 95.1% (resize) and 96.6% (select); both throttled readings gathered. The control (`--control`, the moves with no button, `…-drag-control-…`) drew 0 frames on either drag on both sides. The DOM's drawn frames are those that painted (`domPainted`): `domDrawn`'s 1 ms of animate read TanStack's select at 63% ([`docs/DECISIONS.md`](docs/DECISIONS.md), "Measurement", 2026-11-13; [results note](perf/results/2026-11-13-m14-d1.md)).
- [x] **D1-2, `perf/metric-copy.ts`** (A1-2's copies at the default stop): the block, the week, and the sheet (declined, then confirmed), each from a cold view, the key's event to each mark; the reads; the main thread's time outside frames; the view meanwhile against the same scroll with no copy, `coveredPct`. A smoke run, its control (the declined key's marks with no `copied`).
  *Evidence:* `2026-11-13-m14-d1-smoke-copy-wide-sheet-rows-20.json`, PASS in both profiles: the block (656 cells), the week (74,424), and the sheet (3,912,576) each started → copied → written on both sides, the page reads 0, 8, and 8 (counted at the engine worker's messages: DuckDB's own reads are invisible to the page; [`docs/DECISIONS.md`](docs/DECISIONS.md), "Measurement", 2026-11-13); the sheet's first key `copy-declined` alone, 0.38–4.01 ms after it (the control); the scroll down alone and during the sheet's copy, with `coveredPct` ([results note](perf/results/2026-11-13-m14-d1.md)).
- [x] **D1-3, the A/B:** the grown wide level against M9's build at every stop's scrolls, interleaved, reference, 10 rounds a side; M9's build kept from HEAD's tree. `docs/contender-contract.md`'s "Reading the metrics" gains the drags and the copies.
  *Evidence:* `perf/ab.ts` (`just observatory ab`) and `runMetric --build`; the kept build is `fe36e4c`'s (the commit before part B), in `target/ab/m9-wide/`, its engine files the tree's to the byte ([`docs/DECISIONS.md`](docs/DECISIONS.md), "Measurement", 2026-11-13). A one-round smoke at `rows-20` ran, merged, summarized, and paired (`2026-11-13-m14-d1-ab-smoke-*`); its 10 rounds at every stop are D2-1's. Every smoke run here is of the code with `/code-review high`'s ten fixes (the results note). The contract's "Reading the metrics" has the drags and the copies.

### Part D2: the runs

Ask about a code review first (D1's code). ~2 h 25 min in one sitting: the A/B ran ~1.4 min a round at one stop in D1's smoke, so ~45 min at every stop, not A1's ~30. Keep `target/ab/m9-wide/` until then (`fe36e4c`'s build; the results note says how to make it again).

**Done when:**
- [ ] **D2-1, the A/B:** each stop's readings within the spread (M9's numbers stand, labelled with their build), or the suite again where one moved, replacing M9's.
- [ ] **D2-2, the new measures:** the drags at every stop and the copies at the default stop, both sides, both devices, median of 10, each results file with its versions; a results note.

### Part E1: the window

The design: the canvas's wide-sheet row ([`docs/DECISIONS.md`](docs/DECISIONS.md), "Page", 2026-11-12).

**Done when:**
- [ ] **E1-1, the title bar:** the lead; the Copy button where the fonts toggle sits (disabled until something's selected, "Copy anyway" after a declined key, "Cancel" while copying; it calls `__contenderTools` inside its click), its explainer; the frame created with `?readout` on the wide level.
- [ ] **E1-2, the status bar:** the copy line in the data label's place while something's selected, its own polite live text (the selection, the progress and its bar, copied, declined, refused); a phone's Copy in the status bar; the title bar's state unchanged by a copy.
- [ ] **E1-3, `page --check`:** a selection's line on both sides, a declined key and Copy anyway writing the clipboard, Cancel, a phone's button; nothing sent by a bare page (the control).

### Part E2: the panel and the description

**Done when:**
- [ ] **E2-1, the panel:** "While dragging" at the picked stop and "Copying" as the canvas draws them, every value from `perf/results/` (`readouts.ts`, `cold.ts`); this tab's Smooth counting a drag's frames.
- [ ] **E2-2, the description and the admin row:** "where each side wins" generated with the drags and the copies; the shortfalls (whole cells only, resize by pointer alone); "What it models"' line; the admin row's explainer pointing to the wide sheet.
- [ ] **E2-3, `page --check`:** the sections' values as `perf/results/` has them, the wins re-derived, the admin row's link.

### Part F: shipped

**Done when:**
- [ ] **F-1:** the README's wide sheet sections with the new rows by `report` and the canvas tradeoffs; `burst` (a copy's reads included) under the zone's limit; the deploy; `worker-check`.

---

## Next milestones

None planned past M14: its scenario is the research's last step. A new milestone starts from a long-term goal below, or a scenario's own follow-up.

**Every scenario milestone** (decided 2026-10-30, [`docs/DECISIONS.md`](docs/DECISIONS.md), "Scenarios"), each item a "done when" check of its own:
- **Its builds:** each contender builds once per feature level (Cargo features are compile-time, and the same scope keeps a level's code out of every other's bundle), at a base of its own under the contender's (`contenders/paths.ts`), staged and served beside the others, with its TTFP and wasm (or first-paint JS) budgets in `perf/budgets.json`, gated by `check` (root rule 1). A scenario on a level that exists shares its build (the admin table the base's; the monitoring wall has a level of its own, `wall`, since it needs `density`, which market watch's lacks).
- **Its data credited:** the credit on the page and in the README, the license in `MANIFEST.json`; a synthetic feed is labelled synthetic on the page.
- **Its runs:** `check` gates its builds' budgets and runs its smoke, fixtures, and contract checks, never the full protocol. The full cold protocol (its stops × both sides × both devices × 10 runs, and its soaks) runs once, in its numbers part, on the final build (a long run: ask about a code review first); its part A estimates that time before fixing the stops. Its results files are labelled with its name, so it re-runs without the others.
- **Its versions:** each results file records what it was measured with (gpui-kit, React, TanStack Virtual, Arrow, DuckDB-Wasm, Chromium), and the scenario's explainer shows them ("measured with …"). A bump of any of them re-measures the scenarios it touches or labels their numbers with the versions they came from, decided per bump.

---

## Measurements

Generated by `just observatory report` from [`perf/budgets.json`](perf/budgets.json) and the newest matching file in `perf/results/`; don't edit between the markers. A metric's history is its dated results files.

<!-- report:plan:start -->
| Metric | Budget | Gate | Local | Production | From |
|---|---|---|---|---|---|
| GPUI contender: time to first paint | ≤ 187.6 ms (baseline 170.5 + 10%) | `check` | 170.5 ms | 329.5 ms | [2026-10-16-m2-b-gpui-cold](perf/results/2026-10-16-m2-b-gpui-cold.json), [2026-10-21-gpui-cold-production](perf/results/2026-10-21-gpui-cold-production.json) |
| GPUI contender: time to first paint, throttled | — | recorded | 3502.5 ms | 3550.5 ms | [2026-10-16-m2-b-gpui-cold](perf/results/2026-10-16-m2-b-gpui-cold.json), [2026-10-21-gpui-cold-production](perf/results/2026-10-21-gpui-cold-production.json) |
| GPUI contender: wasm (brotli) | ≤ 3113.3 KiB (baseline 2707.2 + 15%) | `check` | 2695.4 KiB | — | [2026-10-16-m2-b-gpui-cold](perf/results/2026-10-16-m2-b-gpui-cold.json) |
| GPUI contender at the wide level: time to first paint | ≤ 168.7 ms (baseline 153.4 + 10%) | `check` | 153.4 ms | — | [2026-11-12-gpui-cold-wide](perf/results/2026-11-12-gpui-cold-wide.json) |
| GPUI contender at the wide level: time to first paint, throttled | — | recorded | 3621.1 ms | — | [2026-11-12-gpui-cold-wide](perf/results/2026-11-12-gpui-cold-wide.json) |
| GPUI contender at the wide level: wasm (brotli) | ≤ 3219.4 KiB (baseline 2799.5 + 15%) | `check` | 2799.5 KiB | — | [2026-11-12-gpui-cold-wide](perf/results/2026-11-12-gpui-cold-wide.json) |
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
| TanStack contender at the wide level: first-paint JS (brotli) | ≤ 90.6 KiB (baseline 82.4 + 10%) | `check` | 82.4 KiB | — | [2026-11-12-m14-c2-tanstack-sizes-wide](perf/results/2026-11-12-m14-c2-tanstack-sizes-wide.json) |
| TanStack contender at the market level: first-paint JS (brotli) | ≤ 83.1 KiB (baseline 75.5 + 10%) | `check` | 75.9 KiB | — | [2026-11-09-m12-b1-tanstack-sizes-market](perf/results/2026-11-09-m12-b1-tanstack-sizes-market.json) |
| TanStack contender at the tail level: first-paint JS (brotli) | ≤ 84.2 KiB (baseline 76.5 + 10%) | `check` | 76.9 KiB | — | [2026-11-09-m12-b1-tanstack-sizes-tail](perf/results/2026-11-09-m12-b1-tanstack-sizes-tail.json) |
| TanStack contender at the wall level: first-paint JS (brotli) | ≤ 84.6 KiB (baseline 76.9 + 10%) | `check` | 76.9 KiB | — | [2026-11-10-m13-c1-tanstack-sizes-wall](perf/results/2026-11-10-m13-c1-tanstack-sizes-wall.json) |
| TanStack contender: data layer and Arrow, after first paint (brotli) | ≤ 38.2 KiB (baseline 34.7 + 10%) | `check` | 34.8 KiB | — | [2026-11-09-m12-b1-tanstack-sizes](perf/results/2026-11-09-m12-b1-tanstack-sizes.json) |
| TanStack contender at the wide level: data layer and Arrow, after first paint (brotli) | ≤ 43.1 KiB (baseline 39.2 + 10%) | `check` | 39.2 KiB | — | [2026-11-12-m14-c2-tanstack-sizes-wide](perf/results/2026-11-12-m14-c2-tanstack-sizes-wide.json) |
| TanStack contender at the market level: data layer and Arrow, after first paint (brotli) | ≤ 44.8 KiB (baseline 40.7 + 10%) | `check` | 40.9 KiB | — | [2026-11-09-m12-b1-tanstack-sizes-market](perf/results/2026-11-09-m12-b1-tanstack-sizes-market.json) |
| TanStack contender at the tail level: data layer and Arrow, after first paint (brotli) | ≤ 42.6 KiB (baseline 38.7 + 10%) | `check` | 39.2 KiB | — | [2026-11-09-m12-b1-tanstack-sizes-tail](perf/results/2026-11-09-m12-b1-tanstack-sizes-tail.json) |
| TanStack contender at the wall level: data layer and Arrow, after first paint (brotli) | ≤ 47.7 KiB (baseline 43.4 + 10%) | `check` | 43.4 KiB | — | [2026-11-10-m13-c1-tanstack-sizes-wall](perf/results/2026-11-10-m13-c1-tanstack-sizes-wall.json) |
| Page: first paint (paint timing), /observatory/tall-table/big-file/ | ≤ 72.5 ms (baseline 60.4 + 20%) | `check` | 60.4 ms | 210.2 ms | [2026-11-10-m12-d-page](perf/results/2026-11-10-m12-d-page.json), [2026-10-21-page-production](perf/results/2026-10-21-page-production.json) |
| Page: first paint (paint timing), throttled | — | recorded | 439.3 ms | 474.7 ms | [2026-11-10-m12-d-page](perf/results/2026-11-10-m12-d-page.json), [2026-10-21-page-production](perf/results/2026-10-21-page-production.json) |
| Page: first-paint JS (brotli) | ≤ 95.5 KiB (baseline 86.8 + 10%) | `check` | 86.8 KiB | — | [2026-11-10-m12-d-page](perf/results/2026-11-10-m12-d-page.json) |
| Requests in the busiest 10 s, one visitor (the zone's rate limit counts per IP) | — | recorded | 138 requests | — | [2026-11-11-m13-f-burst](perf/results/2026-11-11-m13-f-burst.json) |
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

## Known bugs

Found and not yet fixed; each gets a session of its own (a fix in the part that owns the code, or a part of its own).

None open.

## Open questions

- **The base level's wheel readings.** A bare `mouse.wheel` reaches a native scroller's compositor every other frame in headless Chromium (`perf/results/2026-11-02-m9-a2.md`), and the base level's TanStack fling and Smooth were read through it. Whether to re-measure them on the gesture scroll, which the wide sheet uses from part D on (`docs/DECISIONS.md`, "Measurement"), and say so on the page meanwhile, is open; so is whether a real trackpad in a headed Chromium matches the gesture's rate.
- **The DOM's fling, read from its compositor.** The fling's late frames and lag are main-thread readings on both sides (`underLoad`), which on GPUI are the presented frames but on the DOM aren't: its compositor scrolls on through a late main-thread frame. The README says so. Whether the DOM side should also report what its compositor presented (`cc`'s frames and `Scroll Delta This Frame`, as the wheel's guard reads them) beside it, and which reading the page headlines, is a protocol change for root `docs/DECISIONS.md`.
- **A short page's missing cells.** The tall table draws a value past a page's end as `NULL` (`render_body`'s `unwrap_or(CellValue::Null)`); the TanStack contender draws it empty. A static file never answers short, so nothing measured differs; whether the component should draw it empty too is the component's call (Tycho drives it).

- **GPUI's key at the wide level.** In 6 of 120 key inputs (`perf/results/2026-11-03-m9-d.md`) no `EventLatency` of GPUI's key reached a frame, though the view moved and filled; the base level read all 120. And GPUI's first usable at the wide level was confirmed in 8 of 10 reference runs, its probe frame ~3 ms later than the base's. Whether either is Chromium's attribution or GPUI's first frames after usable doing more at the level is untested.

- **The pill's compositor frames.** Throttled, the meter as a pill dropped more compositor frames than hidden on both sides (TanStack 7.98% against 3.5%, GPUI 4.21% against 0), while the open meter dropped none more (`perf/results/2026-10-21-m5-d4.md`). The pill isn't the default, so nothing gates it; whether it should get a layer of its own (`will-change: transform`, as the open meter has), and whether that's the cause, is untested.
- **GPUI's lost mark offsets upstream.** gpui-pre-wgpu 0.3.11 drops cosmic-text's `x_offset` and `y_offset` (`perf/results/2026-11-09-m12-a2.md`), and 0.3.12 (gpui-kit 0.9.1) still does: its `cosmic_text_system.rs` is byte-identical. The user files the issue; whether a fix lands before part C, so the shaping verdicts are measured on it, is open.
- **The landing page.** The observatory's Worker holds the apex `seiza.io` (everything outside `/observatory/` a 404). The page is basic (a title, a catchy line, a link to the observatory), built in `site/landing/` on `site/ui/`'s shell (root `docs/DECISIONS.md`, "Repo structure"); when it ships is open. Shipping it moves the Worker to `site/worker/` and adds `/`, `/index.html`, and `/assets/` to the seiza.io WAF rule (`/fonts/` is in it already).
