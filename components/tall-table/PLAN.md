# PLAN.md — tall-table

What's next for the tall table: its features to come, in order, the active milestone's "done when" checks, long-term goals, and open questions. Only what's still open lives here. It's the one list of the table's features: Tycho and the observatory adopt one as a milestone of their own and link here, and never restate the spec.

**Goal:** the interactions of gpui-kit's `DataTable` (resizing, selection and copy, sorting, …) on the tall table's f64-row scroll model, each a Cargo feature off by default, so a host pays only for what it turns on. Tycho adopts the full set; the observatory adds a feature level only for a feature both its sides build (root `CLAUDE.md`, "Comparison protocol").

**Where everything else lives:** what it offers today in [`README.md`](README.md); its rules and architecture in [`CLAUDE.md`](CLAUDE.md); finished milestones in [`docs/milestones.md`](docs/milestones.md); decisions in [`docs/DECISIONS.md`](docs/DECISIONS.md) (why this file exists: root [`docs/DECISIONS.md`](../../docs/DECISIONS.md), "Repo structure", 2026-10-23); surprises in [`docs/LESSONS.md`](docs/LESSONS.md); what it measures of itself in `perf/results/` (created with the first measurement).

---

## Where planning stands

Planned on 2026-10-23. Each decision, with its reasons, is in [`docs/DECISIONS.md`](docs/DECISIONS.md), "Features"; this file holds what follows from them: the [order](#order), the [bare host](#measuring-a-feature), M1 to M7 (built, in [`docs/milestones.md`](docs/milestones.md)), the [hardening](#hardening) between M7 and M8 (three parts, under way), `custom-cells`' [later notes](#follow-ups-to-built-features) (built when a host asks; its follow-ups built 2026-10-25), and research per feature (["Long-term goals"](#long-term-goals)). The Cargo names stay drafts until each feature's milestone.

---

## Status

| Milestone | Title | Status |
|---|---|---|
| M1 | The bare host and the base's baseline | Done 2026-10-23 ([`docs/milestones.md`](docs/milestones.md)) |
| M2 | `custom-cells`: a cell's fill, bar, and text color | Done 2026-10-24 ([`docs/milestones.md`](docs/milestones.md)) |
| M3 | `live`: changed rows re-read and redrawn in place | Done 2026-10-25 ([`docs/milestones.md`](docs/milestones.md)) |
| M4 | `follow`: follow the tail as rows arrive | Done 2026-10-25 ([`docs/milestones.md`](docs/milestones.md)) |
| M5 | `resize`: drag a column's width | Done 2026-10-26 ([`docs/milestones.md`](docs/milestones.md)) |
| M6 | `select`: row, column, and cell selection | Done 2026-10-26 ([`docs/milestones.md`](docs/milestones.md)) |
| M7 | `copy`: a selection to the clipboard | Done 2026-10-27 ([`docs/milestones.md`](docs/milestones.md)) |
| M8 | `sort`: one column, ascending or descending | Planned |
| M9 | `pin`: columns fixed at the left | Planned |
| M10 | `reorder`: drag a column to move it | Planned |
| M11 | `context-menu`: right- and double-click events | Planned |
| M12 | `group-headers`: header rows over column groups | Planned |

One milestone per feature, in the order below. A *Planned* row's spec is its row under "Features"; its spec and checks are written into "Next milestones" when the one before it closes, after its research ("Long-term goals").

**Closing a milestone:** every "done when" check passes; the numbers are in `perf/results/` with a note; new decisions are in `docs/DECISIONS.md`; a `docs/LESSONS.md` entry links the note; the README's Features table has the feature's row and cost; and the spec and evidence move from here to the end of `docs/milestones.md`, leaving one row above. For a feature, also flip its row in each app's "Waiting on" table (listed under "Who's waiting", below) to *Ready* (the date and the milestone); each app adopts it in a milestone of its own.

---

## Measuring a feature

**Two kinds of numbers, two homes.**
**The component measures only itself.** Each feature's own cost: the wasm it adds (brotli) and the work per frame it adds while scrolling (and in its own interaction), each against the base, in the bare host. Recorded in `perf/results/` (dated JSON and a note, as an app's are) and in the README's Features table ("Cost", "Measured in"). There's no `budgets.json` and nothing gates on these: every feature in the order is built, because an app needs it, and the numbers tell a host what turning it on costs.

**What protects the apps is the component's tests,** not a measurement in each app. Every feature is off by default, so an app's build doesn't change until it turns one on: each feature's milestone checks that the base build is unchanged with the feature off, and that the native tests and the fixtures pass with it off and on. An app measures a feature against its own budgets when it adopts it, in its own milestone; if it finds a cost it can't carry, the optimization is a milestone here.

**The bare host** (built: `host/`, its use in `CLAUDE.md`). A small crate in this component, `components/tall-table/host/`: a wasm `cdylib` that renders the tall table and nothing else, built the way the apps are (`cargo build -p <host crate>` on its own, `wasm-bindgen --target web`, `wasm-opt -Oz --enable-threads` with the apps' flags, brotli quality 11), and never deployed.
- **Why its own crate, not an app:** a cost read in Tycho mixes in Tycho's code, and the observatory's GPUI contender can't carry code for a feature its DOM side lacks (root `CLAUDE.md`, "Comparison protocol", "The same scope").
- **It must use the feature, not only compile it.** The host has one Cargo feature per table feature, each turning on the table's and the host's code that switches the feature on at run time (a resizable column, a selection mode, a sorted read). A feature compiled but never switched on can be stripped by the optimizer and read as free.
- **Its data is synthetic,** a delegate answering pages from memory: no DuckDB, so the bytes and frame work are the table's alone. A feature that reaches the delegate (`sort`, `copy`) gets the delegate calls it needs, answered in memory; its data cost (SQL, bytes read) is the source's that answers it (the DuckDB engine's `tall-table` source), not the table's.
- **The measurement:** bytes are the base build against each feature's build. Frame work is a scripted scroll (and the feature's own interaction: a resize drag, a selection drag) recorded with `shared-web/perf/`'s harness (`workRecorder`, `wheel`), under the root's measurement protocol (reference and throttled).

**Its details** are a decision (`docs/DECISIONS.md`, "Features", "The bare host's shape"). The spec pins the delegate's two shapes, since every feature's numbers are read against them, at the protocol's 1440×900, DPR 2:
- **Narrow:** the observatory's: its 11 columns' kinds, 1.57 M rows.
- **Wide:** 500 `ColumnKind::Float` columns (120 px each, the kind's width), 1.57 M rows, so the paging differs from the narrow shape only by the columns.
- **Rows** are the table's own height (`table_row_height`, not a setting today). The wide sheet's row-height dial would need a setting, a change to the base that the observatory asks for when it plans that stop.

---

## Features

Why the table isn't `DataTable`: its `uniform_list` places rows in f32 pixels and breaks past ~16 M px (`docs/DECISIONS.md`, "Table and paging"). The cost was `DataTable`'s interactions. Every feature in these tables is `DataTable`'s, read from gpui-component 0.7.3's `src/table/` (the pin when planned; 0.8.0, the pin since 2026-10-24, adds `resize`'s fit); the API it comes from is in each row. Feature names are drafts until each one's milestone.

**Columns:** *Depends on* is what must exist first. *Data* says whether the feature reaches the delegate (and so the engine's SQL), the costly kind for a table that never holds its rows. *TanStack* is the counterpart a feature level would build on the DOM side (TanStack Table's headless feature, which the contender doesn't load today), or "—" when there's none and the observatory would skip it.

### Columns

| Feature (Cargo) | What it adds | In `DataTable` | Depends on | Data | TanStack |
|---|---|---|---|---|---|
| `resize` | Drag a header edge to set a column's width, within a min and max; a double-click fits it; an event with the new widths, for a host to keep | `col_resizable`, `Column::resizable`, `min_width`/`max_width`, `ColumnWidthsChanged`; `fit_col` (0.8.0) | — (it adds the column-width model the rest build on) | No | Column sizing (`columnResizeMode`) |
| `pin` | Columns fixed at the left while the rest scroll sideways | `ColumnFixed::Left` (left only), `fixed_left` | `resize`'s width model | No | Column pinning (left and right) |
| `reorder` | Drag a header to move its column | `col_movable`, `MoveColumn` | `resize`'s width model | No | Column ordering (the drag is the app's) |
| `group-headers` | Header rows spanning column groups | `group_headers`, `ColumnGroup` | `pin`, `reorder` (a group must move and pin whole) | No | Header groups |

### Selection

| Feature (Cargo) | What it adds | In `DataTable` | Depends on | Data | TanStack |
|---|---|---|---|---|---|
| `select` | Row, column, and cell selection, by click, Shift-extend, and keys; events for each; held as ranges, never a set of rows (25 M rows select in one range). One feature for all three modes, the host picking at run time | `row_selectable`, `col_selectable`, `cell_selectable`, `loop_selection`, `SelectRow`/`SelectColumn`/`SelectCell` | — | No | Row selection (a map of row ids: select-all over 1.57 M rows is a fair stress) |
| `copy` | Copy a selection as TSV; a selection larger than the loaded pages asks the delegate for its rows; the host writes the clipboard (M7's research) | `dump_range` (rows held in memory) | `select` | Yes: rows not loaded are read, in pages | — |
| `context-menu` | Right-click and double-click events on a row or cell, for a host's menu | `context_menu`, `RightClickedRow`/`RightClickedCell`, `DoubleClickedRow`/`DoubleClickedCell` | `select` (the clicked cell becomes the selection) | No | — |

### Data

| Feature (Cargo) | What it adds | In `DataTable` | Depends on | Data | TanStack |
|---|---|---|---|---|---|
| `sort` | Click a header to sort by it: ascending, descending, off; one column at a time | `sortable`, `perform_sort`, `ColumnSort` | — | Yes: the delegate reads pages in a sorted order. Pages by row-group range (`file_row_number`) stop working; `ORDER BY` over the whole file, or a sorted copy, against Tycho's rule to never load the whole result | Sorting, with `manualSorting` (its client-side sort would hold every row) |

### Drawing

| Feature (Cargo) | What it adds | In `DataTable` | Depends on | Data | TanStack |
|---|---|---|---|---|---|
| `custom-cells` | A page's paint for a cell: a fill (a color scale), a bar, a text color, drawn under or in place of its text's color (M2) | `render_td` (an element per cell; `render_th` and `render_tr` aren't carried over) | — | No: the page answers it with its values | Cell renderers (`cell`) |
| *(base)* | Alternating row shading and a line under each row: drawn today (`render_body`) | `stripe`, `bordered` | — | No | CSS |
| *(base)* | A row-number gutter, the f64 row index + 1 as a label: drawn today (`render_body`'s `gutter_cells`) | `row_header` | — | No | — (a column the app writes) |

**Not carried over:** `load_more`, `has_more`, `loading`, and `render_loading` (the table's paging and placeholders do this); `render_empty` (a host draws its own); `scroll_to_row` and `scroll_to_col` (`jump_to` is the row's; a column's comes with `pin`, if a host asks); `visible_rows_changed` and `visible_columns_changed` (the `Probe` and `Layout` events).

### Beyond `DataTable`: TanStack Table's features

Candidates, not plans: features of TanStack Table (v8) that `DataTable` lacks or does narrower, kept here because people reach for them in a data grid. None is built or measured. One joins the tables above only after its cost is measured (in the bare host, as any feature) and Tycho or an observatory workload wants it; until then a row here is a note. For a table that never holds its rows, most of them are SQL: the *Data* column says what the delegate would answer.

| TanStack feature | What it adds | Nearest in `DataTable` | Data | Notes |
|---|---|---|---|---|
| Column visibility | Hide and show columns | — | Narrows the page query (fewer columns read) | Cheap in the view; the page SQL's column list changes, so the fixtures' `sql.json` would grow a case |
| Column filtering | A predicate per column; the row count follows | — | Yes: `WHERE`, a new `count(*)`, pages over the filtered rows | Like `sort`, breaks paging by row-group range; the two share that research |
| Global filtering and search | One query across every column | — | Yes: as filtering, over every text column | Also a route to closing Ctrl+F (README, "Canvas tradeoffs"): a find of the table's own |
| Faceting | Each column's distinct values, or its min and max, for a filter's UI | — | Yes: one aggregate query per column, cacheable | Only with filtering |
| Multi-column sort | Sort by several columns, Shift-click to add | `sort` is one column | Yes: `ORDER BY a, b` | An extension of `sort`, not a feature of its own |
| Right-pinned columns | Columns fixed at the right | `pin` is left only | No | An extension of `pin` |
| Row pinning | Rows kept at the top or bottom while the rest scroll | — | Yes: the pinned rows are read apart from the pages | Fits the f64 scroll model awkwardly; research first |
| Grouping and aggregation | Rows grouped by a column's values, with sums and counts, collapsible | — | Yes: `GROUP BY`; the row count becomes the groups' | Changes what a row is; the largest of these |
| Expanding | A row opens to show a detail row or sub-rows | — | Depends on what's shown | Variable row heights break the uniform f64 row index; research first |

Not listed: TanStack's pagination (the table scrolls instead) and fuzzy filtering (a kind of global filtering).

**Editing is not on the list** (the table is read-only, and a paste lands in another app, which undoes it). If editing or paste-into-cells is ever added, undo and redo come in the same milestone, not after: a mistaken paste needs a quick remedy (noted 2026-10-26).

### Asked for by the observatory's scenarios

The observatory leads its comparison by scenarios, real uses (its [`docs/research/scenarios.md`](../../apps/observatory/docs/research/scenarios.md)), in this order: wide sheet, market watch, live tail, admin table, monitoring wall. Two of them need features neither `DataTable` nor TanStack Table has, both useful to Tycho too (a growing CSV, a refreshed query). Drafts, like the rows above:

| Feature (Cargo) | What it adds | Scenario | Depends on | Data | TanStack |
|---|---|---|---|---|---|
| `follow` | Follow the tail: the view stays at the last rows read while `set_rows` grows the source, and lets go when the reader scrolls up; a way back to it | Live tail | `live` (a grown tail page kept and read again; M4's research) | No (`set_rows` exists) | — (the contender's own, on its scroller) |
| `live` | A host says "these rows changed"; their pages are re-read (or patched) and redrawn, the scroll unmoved | Market watch | — | Yes: the changed pages are read again | — (the contender's own, through its cache) |

What each scenario needs from the rows above: the wide sheet `custom-cells` (heat and bar cells) and later `resize` and `select`/`copy`; market watch `live` and `custom-cells` (a cell flashing when it changes); live tail `follow`; the admin table nothing past the base. So the wide sheet's need puts `custom-cells` first in the order below.

### Who's waiting

Only this file builds the table's features, whichever app asks (root `CLAUDE.md`, "Docs: one home per fact"). An app that needs one keeps a row in its PLAN's "Waiting on" table; closing the feature's milestone flips that row to *Ready*. When an app asks for a new feature, it gets a row in the tables above (or "Asked for by the observatory's scenarios") and one here.

| Feature | Waiting | Their note |
|---|---|---|
| `custom-cells` | Observatory: the wide sheet (heat and bar cells), then market watch (a cell flashing on change) | [`apps/observatory/PLAN.md`](../../apps/observatory/PLAN.md), "Waiting on" |
| `live` | Observatory: market watch | [`apps/observatory/PLAN.md`](../../apps/observatory/PLAN.md), "Waiting on" |
| `follow` | Observatory: live tail | [`apps/observatory/PLAN.md`](../../apps/observatory/PLAN.md), "Waiting on" |
| Every feature | Tycho adopts each one as it's ready | [`apps/tycho/PLAN.md`](../../apps/tycho/PLAN.md), "Waiting on" |

### Order

Decided 2026-10-23: `custom-cells` → `live` → `follow` → `resize` → `select` → `copy` → `sort` → `pin` → `reorder` → `context-menu` → `group-headers`. (`row-header` left the list: the base draws a row-number gutter already.)

- **The scenarios' features first,** in the observatory's scenario order: the wide sheet (`custom-cells`), market watch (`live`, and `custom-cells` for its flash), live tail (`follow`). Each is small, none breaks the paging, and Tycho uses them too (a growing CSV, a refreshed query).
- **Then Tycho's core:** `resize` first because `pin`, `reorder`, and `group-headers` build on its width model; `select` and `copy` next because copy closes a canvas tradeoff (README, "Canvas tradeoffs"), and they're the wide sheet's later steps; `sort` is the hardest: paging by row-group range stops working, and its research settles how the delegate reads pages in a sorted order.
- **The component's features come first, built in a run;** the apps adopt them after, each in a milestone of its own (decided 2026-10-23). A *Ready* row in an app's "Waiting on" table doesn't interrupt the run.
- **A feature can move up** when an app needs it sooner. The change goes here, with a decision, never in the app's PLAN.

---

## Active milestone

None: the [hardening](#hardening) is under way (parts A and B done, part C next), then M8 (`sort`), which opens with its research.

---

## Hardening

Not a feature: work of its own after M7 closes and before M8 opens (decided 2026-10-27, after M7 part B's two code reviews each found races between `copy` and the paging that no scenario test had). Three parts, one session each (split 2026-10-28, [`docs/DECISIONS.md`](docs/DECISIONS.md), "Fixtures"). Its commits read `tall-table: … (hardening part <X>)`; it closes into [`docs/milestones.md`](docs/milestones.md) as "Hardening".

**What it adds:** a randomized test of the paging under every feature at once, on GPUI's seeded test executor, so a failure replays from its seed. It drives the table through random sequences: scrolls, jumps, scrollbar drags (moving and resting), `set_rows` growing and shrinking, `invalidate_rows`, `follow`'s moves, copies started, cancelled, and replaced, `close`, and reads answered in random order, failed, refused, or answered after a cancel. After every step it checks the invariants: reads in flight (the cache's, re-reads, a copy's, draining) never past `max_in_flight`; with every read answered, no place held; every copy ends (`Copied` or `Failed`), and a `Copied` copy's text is the TSV of its rows as a source read then; no page read twice at once but a visible one a copy also reads; nothing reads after `close`; the cache within its budget but for wanted pages.

**And a fix to the base: a shrink by more than a page** (an open question until 2026-10-28). `PageCache::set_rows` looks only at the old last page, so a shrink by more than a page keeps the whole pages past the new end, and grown back they draw their old rows as loaded, with or without `live`. A shrink forgets every page past the new end: a loaded one's bytes freed, a read or re-read out cancelled and draining, as a short last page is forgotten today. `paging.json` gains a base scenario for it. The TanStack contender's fixture test skips every scenario with a `rows` step (its row count is fixed), so no DOM change. The random test's source changes its values across a shrink and a grow, so the bug fails the test before it's fixed.

**Part A: research and spec** (2026-10-28, the session that split it). Recorded in the root's [`docs/research/tall-table-features.md`](../../docs/research/tall-table-features.md), "Hardening" (the source, the steps, the invariants, the controls, the cost), its decisions in `docs/DECISIONS.md`, "Fixtures". In short: proptest driven by hand from a plain `#[test]` (GPUI's `property_test` doesn't compile at the pin), each case a scheduler seed and up to 300 steps on a fresh `TestAppContext`, in a window; a source whose values carry a version (`invalidate_rows`) and an era (rows cut by `set_rows`), whose answers come in any order, fail, refuse, or win a cancel's race; eight invariants checked against the source's own log after every step (after `close`, only that nothing is read); each case's `Paging` drawn (`max_in_flight` 1 to 4, small pages and budget).

**Part B: the test and its controls.** In `src/state/random.rs`, a child of `state` (the fixtures' access to the cache): the source, the steps, the invariants, the controls, the printing; and a `just tall-table soak` recipe. And the request-id contract in the docs (decided 2026-10-28): `TallTableDelegate::Request`'s docs say an id is never reused for the table's life, and `copy_answered`'s comment stops naming a source whose ids repeat. A bug it finds is recorded here (its seed and its shrunk steps) with a scenario test marked `#[ignore]`, and the generator is kept from the step that triggers it by a named exclusion, so `just tall-table test` stays green until part C. It must find the shrink: the test's proof that it reaches what the scenarios didn't think of.

Built 2026-10-28, with these changes from the spec (each in `docs/DECISIONS.md`, "Fixtures"): 48 cases in the all-on run and 16 in the others (a step costs ~2.5 ms, and 16 cases left controls uncaught); invariants 6 and 8 checked whenever no read is open and no drag moves, not only after a drain (the drain's clock advance fired a settle timer that planned the missed read); eight steps on a closed table, then a drain and a new table over the source; an exclusion is a step generated, a step run, or a pair checked; the budget checked after any step a page landed in; the cases drawn toward the controls' states, inside the spec's ranges.

**Found by the random test** (each fixed in part C; its scenario test runs without exclusions and fails today):

1. **A shrink past a page** (the one it had to find): `PageCache::set_rows` keeps the pages wholly past a shrink's new end. Grown back, they draw their old rows as loaded (invariant 5), and with `live`, the page a shrink to its start kept (its end clamped to its start) is never read again, from a row count that's a page's multiple, so not marked stale: its rows stay placeholders with no read open (invariant 8). First run, `SEED` 0, scheduler seed 0, shrunk in ~20 s to: `page_rows` 10, prefetch 0, `max_in_flight` 1, budget 2 pages, 1 row; `Answer(0, 0)`, `Grow(318)` (then +19 rows), `Answer(0, 24)`, `Answer(0, 0)`, `ShrinkPast(56)`, `GrowBack`: row 10 drawn from era 0, its era 1. Scenario tests `shrink_past_a_page_forgets_the_pages_past_it` (30 rows of 10-row pages read, shrunk to 5, grown back: row 10 from the read before the cut) and, with `live`, `shrink_to_a_page_start_reads_its_page_when_grown` (10 rows, shrunk to 0, grown back: row 0 a placeholder for good). Exclusion `ShrinkPast`: the step isn't generated.
2. **A closed table cancels a read again:** `set_rows` after `close` cancels the short last page's read, which `close` cancelled (or which has answered since): `close` cancels through the delegate and leaves the cache's slots, and `PageCache::set_rows` still returns the request. A second `close` would do the same (the test closes a table once). Second run, `SEED` 0, scheduler seed 0, shrunk to: `page_rows` 8, prefetch 0, `max_in_flight` 2, budget 2 pages, 46 rows; `Answer(0, 0)`, `Move(0)`, `Follow`, `Answer(0, 0)`, `Close`, `ShrinkWithin(0)`: read 3 cancelled once cancelled (invariant 1, the source's contract). Scenario test `a_closed_table_cancels_nothing_again` (three short pages read at open, closed, shrunk within the last). Exclusion `RowsAfterClose`: the rows' steps do nothing once the table is closed.
3. **A prefetch re-read beside a copy's read** (`live` with `copy`): a copy reads a grown last page itself (the cache's drawn page lacks the new rows), and `PageCache::plan` re-reads that stale page as prefetch beside it, off screen: two reads of one page (invariant 2). A prefetch first read skips a page the copy reads (`copy_reads_it`); the re-read path (`reread`) doesn't. `SEED` 3 (before the closed table's steps were bounded), scheduler seed 0, shrunk to 15 steps (`page_rows` 8, prefetch 1, `max_in_flight` 3, 10 rows, answering when sent, then held: grows to 33 rows, a close and a drain, a wheel to the end, grows to 36 and 60, a row on page 4 selected and copied, a wheel up a row). Scenario test `a_prefetch_reread_skips_a_page_the_copy_reads`, the shrunk case as found. Exclusion `GrownPageBesideCopy` (with 4): the pair of a copy's read and the cache's read of a page that grew left out of invariant 2's check (no step alone triggers it).
4. **A copy beside a short read of a grown page** (`live` with `copy`): a prefetch read of the short last page is out when the rows grow to fill it; a copy of the rows reads the page itself, since the cache's read doesn't hold the new rows (`PageCache::loading` asks for the rows up to the copy's end), and the two are out at once, off screen; the cache reads the page a third time once its own read lands (stale). Found by the soak, `SEED` 3, scheduler seed 0, shrunk to: `page_rows` 14, prefetch 1, `max_in_flight` 2, budget 2 pages, 0 rows, answering when sent; `AtOnce(false)`, `Grow(13348)` (to 35 rows), `Answer(0, 32)`, a `Columns` selection of column 0, `Answer(0, 16)` (prefetch's read of page 2 goes out), `Grow(0)` (to 42), `Copy`: page 2 read twice at once. Scenario test `a_copy_beside_a_short_read_of_a_grown_page`. Exclusion `GrownPageBesideCopy`, as 3's: 3 and 4 are one gap, a copy and the cache each reading a page that grew under them.

**Part C: the fixes and the close.** The shrink's fix and each bug part B found (above: a closed table's cancels, and a copy and the cache both reading a page that grew), each scenario test un-ignored, every exclusion removed, a soak of many seeds on the final build; the fixes' size effect (they change shipped code, root `CLAUDE.md` rule 1); the close.

**Done when:**
- [x] **A1.** The research is in the root's `docs/research/tall-table-features.md`, "Hardening"; its decisions are in `docs/DECISIONS.md`; the checks below name the controls, the steps and cases, and the run's time. *Evidence:* the research section; `docs/DECISIONS.md`, "Fixtures" (2026-10-28, five entries); a spike over `copy/tests.rs`' `Sheet` (not kept): ~8 ms a step in a native debug build, a forced failure shrunk and printed with its scheduler seed.
- [x] **B1.** The test runs in `just tall-table test`, in each of its ten feature runs with the steps and invariants that run's features have: 48 cases of up to 300 steps in the all-on run, ~5 s on its wall, 16 cases in each other run (changed 2026-10-28 from 16 cases adding nothing to the all-on run's wall and 8 in the others: `docs/DECISIONS.md`, "Fixtures"). *Evidence:* all ten runs pass (`perf/results/2026-10-28-hardening-b.md`: 8 to 10 s each without `select`, 35 s `select`, 37 s `copy`, 46 s all on); the all-on run 41–42 s without the random tests, 46–47 s with them (two runs each); the main test alone ~18 s (16.7–19.9 over eight `SEED`s, all passing).
- [x] **B2.** Each invariant fails under its control within the all-on run's cases: the places leak, copy and prefetch on one page, an end without a plan (the three that M7 part B's reviews found), the limit counting draining reads out, a failed read that doesn't end its copy, a turn taking a page by rows it doesn't hold, `close` leaving a copy's reads out, no eviction when a re-read lands, a shrink that doesn't clamp the page it ends in. A failure prints its minimal steps and scheduler seed; a rerun recurs it (cases fixed by `SEED`, 0 unset). *Evidence:* `state::random::controls`, one test a control, each asserting its invariant: all nine fail `SEED` 0's 48 cases (an end without a plan at 8 or 6, the copy it leaves waiting: `docs/DECISIONS.md`, "Fixtures"); across `SEED`s 0–6, 57 of 63 control runs fail (missed: copy and prefetch on one page, a turn taking rows a page lacks, and a shrink unclamped, twice each). The findings below printed their shrunk steps and seeds, and each recurs in its scenario test.
- [x] **B3.** It finds the shrink by more than a page (invariant 5: rows drawn of their era); each bug found is recorded here with its minimal steps, an `#[ignore]`d scenario test, and its exclusion. *Evidence:* found on its first run (above, "Found by the random test", 1: invariant 5), and three more (2 and 3 in the test's runs, 4 in the soak), each with its scenario test (failing with `--include-ignored`) and exclusion; the soak then passed 12 `SEED`s × 500 cases (`perf/results/2026-10-28-hardening-b.md`).
- [ ] **C1.** A shrink forgets every page past the new end; `paging.json`'s new scenario passes natively and fails under the old rule (a control of a new `cache` kind, the cache's `Control` widened from `live` to every test build); `just observatory fixtures` still passes.
- [ ] **C2.** Each bug part B found is fixed with a scenario test, its exclusion removed; the shrink's old rule joins the controls (caught by invariant 5); a soak passes on the final build (`just tall-table soak`, added in part B: 4 `SEED`s × 500 cases in a release build with debug assertions; ~2.5 min once built); `just tall-table test` and `lint` pass.
- [ ] **C3.** The fixes' effect on the base build (`just tall-table size --against` part C's parent, after the code review) is in a `perf/results/` note, and on each app that builds the table, in its own `perf/results/` (root `CLAUDE.md`, rule 1).
- [ ] **C4.** A `docs/LESSONS.md` entry per part; the README and `CLAUDE.md` say what changed (the shrink's rule, the test); the spec and evidence move to `docs/milestones.md`.

---

## Follow-ups to built features

### `custom-cells`

Built 2026-10-25 ([`docs/milestones.md`](docs/milestones.md), "M2 follow-up"); what's left:

**Later, as notes** (each adds without breaking; built when a host asks):

- **Stepped ramps** (`Ramp::stepped`, the nearest stop, no mix): bucketed heat maps, as Grafana's thresholds are. Not needed for categories: a category mapped to its stop's place (k / (n − 1)) lands on the stop already.
- **A bar-only column** (the text hidden, Excel's "Show Bar Only"): it widens the color-alone tradeoff (README, "Canvas tradeoffs"), since the number is no longer drawn, so the tooltip must show every hovered cell's exact value in it, not only a rounded or cut one, and the README says so.
- **Selection over paint:** settled in `select`'s research: a tint under the text, over the fill, bar, and flash ([`docs/DECISIONS.md`](docs/DECISIONS.md), "Features", 2026-10-26); built in M6.

---

## Next milestones

Specs drafted ahead, so a waiting app can read what's coming; each one's checks are tightened when it becomes active. M8's (`sort`) is written after its research, which opens it once M7 closes; until then its spec is its row under "Features".

---

## Long-term goals

### Research each feature's design before building it

Moved here from Tycho's `PLAN.md`, where it was a long-term goal while the table lived in Tycho. Planned on 2026-10-23 as research that opens each feature's milestone, not one study of them all. Every feature in the order is built; the research settles how, not whether. Its cost is measured as it's built ("Measuring a feature"). Each feature's research is recorded in the root's `docs/research/tall-table-features.md` (created with the first one), and covers what applies:

- **Reuse:** whether gpui-kit's column and selection pieces can sit on top of the row-based scroll model, or have to be rebuilt (before `resize` and `select`).
- **The delegate's calls**, for the features that reach it (`live`, `copy`, `sort`): what the table asks and how a source answers in pages. Sorting's above all: the table asks for rows by index, and a source that pages by row-group range (the DuckDB source's `file_row_number`) can't answer a sorted order that way. What a source does to answer (an `ORDER BY` over the whole file, a sorted copy) is the source's cost, measured by the engine; the table's design must not make it hold the whole result.
- **Frame-work risks:** what could cost per frame while scrolling (hit-testing, resize handles, selection state across 25 M rows), checked with a spike in the bare host when it's unclear.
- **Canvas gaps:** how selection and copy interact with the canvas tradeoffs (text selection, a11y) the README tracks.
- **Layers** (before `select`): where a selection draws among `custom-cells`' layers. Today, bottom to top: the row's background and stripes, the fill, the bar, the text, the jump's edge over filled cells; `live` adds the flash over the fill. A translucent tint over the fill keeps a heat map readable while selected.

### Readable values in the bare host

Not planned; noted 2026-10-24 after the manual check of `custom-cells`. The host's values are a hash of each cell's row and column, so every run draws the same cells and its numbers are the table's alone. A paint of them is noise: a heat map shows no pattern, and its bars no trend. A by-eye check can only confirm that something drew, not that it drew right.

- **What it would be:** `?values=gradient`, the float columns' values rising steadily down the rows and across the columns (the same ranges, so the paint and the rounding stay realistic). A heat map would then read as a smooth gradient, bars would lengthen row by row and cross zero at a known row, and `?cells=color` would turn from red to green at that row too.
- **How it would help:** a misplaced quad, a ramp mixed out of order, a bar drawn from the wrong edge, or a cell painted from its neighbour's value would show at a glance in the manual check each milestone ends with. Later features would gain the same: a sorted read (`sort`) or a moved column (`reorder`) shows as an unbroken gradient or a visible break.
- **What it must not touch:** the perf runs keep the hashed values, so a feature's cost is never read over data the branch predictor can learn. A gradient is for looking, not measuring.
- **Why not now:** the observatory's wide sheet will show heat and bar cells over real data once it adopts `custom-cells`; build this if a feature's manual check needs it before then.

---

## Open questions

- **More late frames in a throttled wide fling with a feature built** (found in M4 part D with `follow`, again in M5 part D with `resize`): with `follow`, over 20 runs each, in both orders, ~8% late (median) against the base's ~3.5%, ranges overlapping (base 0.5–9.6%, `follow` 4.0–12.1%); with `resize`, 5.1% against 2.0% over 10 each (base 1.5–8.4, `resize` 1.0–12.0), its runs' p95 at ~30 ms in 7 of 10 against the base's 3 (the two modes ~15 and ~30 ms). With `select` (M6 part D), 4.1% against 2.75% (base 0.5–8.4, `select` 1.5–6.8), with no frame cost measured in any segment. Work per frame, busy time, and placeholders the same; not in the narrow fling or any reference segment. `follow`'s code on that path is a comparison per wheel and an early return per page landing, and `resize`'s the bands' ~0.1 ms a frame, which every reference segment shows without a late frame, so it's likely not either feature's code (the build's layout, say). Worth a trace comparison of the two builds' slow frames before an app adopts `follow` on a slow machine; not a blocker for the feature, whose frame work matches.
- **Vertical cell borders** (`DataTable`'s `bordered`): the base draws row lines but no column lines. Nobody has asked; a wide sheet of heat cells may want them.
