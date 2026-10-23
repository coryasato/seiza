# PLAN.md — tall-table

What's next for the tall table: its features to come, in order, the active milestone's "done when" checks, long-term goals, and open questions. Only what's still open lives here. It's the one list of the table's features: Tycho and the observatory adopt one as a milestone of their own and link here, and never restate the spec.

**Goal:** the interactions of gpui-kit's `DataTable` (resizing, selection and copy, sorting, …) on the tall table's f64-row scroll model, each a Cargo feature off by default, so a host pays only for what it turns on. Tycho adopts the full set; the observatory adds a feature level only for a feature both its sides build (root `CLAUDE.md`, "Comparison protocol").

**Where everything else lives:** what it offers today in [`README.md`](README.md); its rules and architecture in [`CLAUDE.md`](CLAUDE.md); finished milestones in [`docs/milestones.md`](docs/milestones.md); decisions in [`docs/DECISIONS.md`](docs/DECISIONS.md) (why this file exists: root [`docs/DECISIONS.md`](../../docs/DECISIONS.md), "Repo structure", 2026-10-23); surprises in [`docs/LESSONS.md`](docs/LESSONS.md); what it measures of itself in `perf/results/` (created with the first measurement).

---

## Where planning stands

This file was drafted on 2026-10-23, when the table's features moved here from Tycho's `PLAN.md`. Its first milestone is planned in a session of its own; start there.

**Decided:**
- **This file is the one list of the table's features.** Tycho and the observatory adopt a feature as a milestone in their own `PLAN.md` that links here.
- **The inventory is `DataTable`'s** (["Features"](#features), read from gpui-component 0.7.3, the pin). TanStack Table's features that `DataTable` lacks are [candidates](#beyond-datatable-tanstack-tables-features), not plans.
- **One `select` feature** for row, column, and cell selection, the host picking the mode at run time, as `DataTable` does. Finer features would multiply the `cfg`s for little saved.
- **What's measured where** (["Measuring a feature"](#measuring-a-feature)): the table measures each feature's own cost in a bare host crate of its own; each app measures a feature against its own budgets when it adopts it.

**To decide in the planning session:**
1. **The first milestone and its "done when" checks.** Likely the cost research (["Long-term goals"](#long-term-goals)) together with building the bare host, since the research needs the host. Whether the research is one milestone, or the host comes first on its own, is open.
2. **The build order** (["Order"](#order), a draft).
3. **The Cargo feature names** in the tables (drafts).
4. **The bare host's details** (["Measuring a feature"](#measuring-a-feature), its open points).
5. **Whether stripes and borders are base settings** or a feature.
6. **Whether any TanStack candidate joins the list.**
7. **The scenarios' features** (`custom-cells` for the wide sheet, the first; `live`, `follow`): where they go in the order, since the observatory's next milestone waits on `custom-cells`.

---

## Status

| Milestone | Title | Status |
|---|---|---|

No milestones yet: the first is planned in its own session (above).

**Closing a milestone:** every "done when" check passes; the numbers are in `perf/results/` with a note; new decisions are in `docs/DECISIONS.md`; a `docs/LESSONS.md` entry links the note; the README's Features table has the feature's row and cost; and the spec and evidence move from here to the end of `docs/milestones.md`, leaving one row above. For a feature, also flip its row in each app's "Waiting on" table (listed under "Who's waiting", below) to *Ready* (the date and the milestone); each app adopts it in a milestone of its own.

---

## Measuring a feature

**Two kinds of numbers, two homes.**
- **The feature's own cost, measured here:** the wasm it adds (brotli), and the work per frame it adds while scrolling, each against the base. Recorded in `perf/results/` (dated JSON and a note, as an app's are) and in the README's Features table ("Cost", "Measured in"). There's no `budgets.json` and nothing gates on these: they inform the decision to build and to adopt.
- **What it does to an app, measured in that app:** Tycho's and the observatory's TTFP, wasm-size, and fling budgets, in their own `perf/`, when they adopt the feature. Budgets are a build's (Cargo unifies features per build), so they stay the apps'.

**The bare host** (decided; built by the first milestone that measures). A small crate in this component, `components/tall-table/host/`: a wasm `cdylib` that renders the tall table and nothing else, built the way the apps are (`cargo build -p <host crate>` on its own, `wasm-opt --enable-threads`, brotli quality 11), and never deployed.
- **Why its own crate, not an app:** a cost read in Tycho mixes in Tycho's code, and the observatory's GPUI contender can't carry code for a feature its DOM side lacks (root `CLAUDE.md`, "Comparison protocol", "The same scope").
- **It must use the feature, not only compile it.** The host has one Cargo feature per table feature, each turning on the table's and the host's code that switches the feature on at run time (a resizable column, a selection mode, a sorted read). A feature compiled but never switched on can be stripped by the optimizer and read as free.
- **Its data is synthetic,** a delegate answering pages from memory: no DuckDB, so the bytes and frame work are the table's alone. A feature that reaches the delegate (`sort`, `copy`) gets the delegate calls it needs, answered in memory; its data cost (SQL, bytes read) is measured in Tycho on its real samples.
- **The measurement:** bytes are the base build against each feature's build. Frame work is a scripted scroll (and the feature's own interaction: a resize drag, a selection drag) recorded with `shared-web/perf/`'s harness (`workRecorder`, `wheel`), under the root's measurement protocol (reference and throttled).

**Its open points, for the planning session:**
- Whether it bootstraps through `seiza` (fonts, `gpui_kit::init`, the first-frame mark; `default-features = false`, no panel) like the observatory's GPUI contender. A component can't depend on `seiza`, but a host crate in its directory can, as any host does; the crate's name and where it sits in the workspace follow from that.
- Its JS host (a minimal Vite page on `shared-web/`) and where its scripts live, and how they're run: components have no `justfile` today, so a `just tall-table <recipe>` module, or recipes in the root `justfile`.
- Whether one build with every feature on is also worth recording, as the cost of Tycho's full set.

---

## Features

Why the table isn't `DataTable`: its `uniform_list` places rows in f32 pixels and breaks past ~16 M px (`docs/DECISIONS.md`, "Table and paging"). The cost was `DataTable`'s interactions. Every feature in these tables is `DataTable`'s, read from gpui-component 0.7.3's `src/table/` (the pin); the API it comes from is in each row. Feature names and the order are drafts.

**Columns:** *Depends on* is what must exist first. *Data* says whether the feature reaches the delegate (and so the engine's SQL), the costly kind for a table that never holds its rows. *TanStack* is the counterpart a feature level would build on the DOM side (TanStack Table's headless feature, which the contender doesn't load today), or "—" when there's none and the observatory would skip it.

### Columns

| Feature (Cargo) | What it adds | In `DataTable` | Depends on | Data | TanStack |
|---|---|---|---|---|---|
| `resize` | Drag a header edge to set a column's width, within a min and max; an event with the new widths, for a host to keep | `col_resizable`, `Column::resizable`, `min_width`/`max_width`, `ColumnWidthsChanged` | — (it adds the column-width model the rest build on) | No | Column sizing (`columnResizeMode`) |
| `pin` | Columns fixed at the left while the rest scroll sideways | `ColumnFixed::Left` (left only), `fixed_left` | `resize`'s width model | No | Column pinning (left and right) |
| `reorder` | Drag a header to move its column | `col_movable`, `MoveColumn` | `resize`'s width model | No | Column ordering (the drag is the app's) |
| `row-header` | A row-number column, the f64 row index as a label | `row_header` | — | No | — (a column the app writes) |
| `group-headers` | Header rows spanning column groups | `group_headers`, `ColumnGroup` | `pin`, `reorder` (a group must move and pin whole) | No | Header groups |

### Selection

| Feature (Cargo) | What it adds | In `DataTable` | Depends on | Data | TanStack |
|---|---|---|---|---|---|
| `select` | Row, column, and cell selection, by click, Shift-extend, and keys; events for each; held as ranges, never a set of rows (25 M rows select in one range). One feature for all three modes, the host picking at run time | `row_selectable`, `col_selectable`, `cell_selectable`, `loop_selection`, `SelectRow`/`SelectColumn`/`SelectCell` | — | No | Row selection (a map of row ids: select-all over 1.57 M rows is a fair stress) |
| `copy` | Copy a selection through the browser's clipboard event; a selection larger than the loaded pages asks the delegate for its rows | `dump_range` (rows held in memory) | `select` | Yes: rows not loaded are read, in pages | — |
| `context-menu` | Right-click and double-click events on a row or cell, for a host's menu | `context_menu`, `RightClickedRow`/`RightClickedCell`, `DoubleClickedRow`/`DoubleClickedCell` | `select` (the clicked cell becomes the selection) | No | — |

### Data

| Feature (Cargo) | What it adds | In `DataTable` | Depends on | Data | TanStack |
|---|---|---|---|---|---|
| `sort` | Click a header to sort by it: ascending, descending, off; one column at a time | `sortable`, `perform_sort`, `ColumnSort` | — | Yes: the delegate reads pages in a sorted order. Pages by row-group range (`file_row_number`) stop working; `ORDER BY` over the whole file, or a sorted copy, against Tycho's rule to never load the whole result | Sorting, with `manualSorting` (its client-side sort would hold every row) |

### Drawing

| Feature (Cargo) | What it adds | In `DataTable` | Depends on | Data | TanStack |
|---|---|---|---|---|---|
| `custom-cells` | A delegate hook that draws a cell (a bar, a color scale) instead of its text | `render_td`, `render_th`, `render_tr` | — | No | Cell renderers (`cell`) |
| *(base?)* | Alternating row shading, cell borders | `stripe`, `bordered` | — | No | CSS |

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

### Asked for by the observatory's scenarios

The observatory leads its comparison by scenarios, real uses (its [`docs/research/scenarios.md`](../../apps/observatory/docs/research/scenarios.md)), in this order: wide sheet, market watch, live tail, admin table, monitoring wall. Two of them need features neither `DataTable` nor TanStack Table has, both useful to Tycho too (a growing CSV, a refreshed query). Drafts, like the rows above:

| Feature (Cargo) | What it adds | Scenario | Depends on | Data | TanStack |
|---|---|---|---|---|---|
| `follow` | Follow the tail: the view stays on the last row while `set_rows` grows the source, and lets go when the reader scrolls up; a way back to it | Live tail | — | No (`set_rows` exists) | — (the contender's own, on its scroller) |
| `live` | A host says "these rows changed"; their pages are re-read (or patched) and redrawn, the scroll unmoved | Market watch | — | Yes: the changed pages are read again | — (the contender's own, through its cache) |

What each scenario needs from the rows above: the wide sheet `custom-cells` (heat and bar cells) and later `resize` and `select`/`copy`; market watch `live` and `custom-cells` (a cell flashing when it changes); live tail `follow`; the admin table nothing past the base. So the wide sheet's need puts `custom-cells` early in the order below.

### Who's waiting

Only this file builds the table's features, whichever app asks (root `CLAUDE.md`, "Docs: one home per fact"). An app that needs one keeps a row in its PLAN's "Waiting on" table; closing the feature's milestone flips that row to *Ready*. When an app asks for a new feature, it gets a row in the tables above (or "Asked for by the observatory's scenarios") and one here.

| Feature | Waiting | Their note |
|---|---|---|
| `custom-cells` | Observatory: the wide sheet (heat and bar cells), then market watch (a cell flashing on change) | [`apps/observatory/PLAN.md`](../../apps/observatory/PLAN.md), "Waiting on" |
| `live` | Observatory: market watch | [`apps/observatory/PLAN.md`](../../apps/observatory/PLAN.md), "Waiting on" |
| `follow` | Observatory: live tail | [`apps/observatory/PLAN.md`](../../apps/observatory/PLAN.md), "Waiting on" |
| Every feature | Tycho adopts each one as it's ready | [`apps/tycho/PLAN.md`](../../apps/tycho/PLAN.md), "Waiting on" |

### Order

Draft, to settle in the planning session: `resize` → `select` → `copy` → `sort` → `pin` → `reorder` → `row-header` → `context-menu` → `group-headers`, with the scenarios' `custom-cells` (asked for first, by the wide sheet), `live`, and `follow` placed where their scenarios need them. `resize` first because `pin`, `reorder`, and `group-headers` build on its width model; `select` and `copy` next because copy closes a canvas tradeoff (README, "Canvas tradeoffs"); `sort` is the hardest, and its data cost decides whether it's built at all.

---

## Active milestone

None: the first is planned in its own session ("Where planning stands", above).

---

## Long-term goals

### Research the features' costs, then decide which to build

Moved here from Tycho's `PLAN.md`, where it was a long-term goal while the table lived in Tycho. Before writing any feature, measure or estimate, and record in the root's `docs/research/tall-table-features.md` (created with the research):

- **Size:** the added wasm (brotli) for each feature, in the bare host; then what that does to Tycho's TTFP and size budgets, in Tycho.
- **Frame cost:** what each adds per frame while scrolling (hit-testing, resize handles, selection state across 25 M rows), in the bare host.
- **Sorting's data cost:** the table pages by row-group ranges (`file_row_number`). A sort needs `ORDER BY` over the whole file, which reads all of it (37.7 MB for Tycho's asteroids, far more for Gaia), or a sorted copy in DuckDB's memory, against Tycho's rule 3 (never load the whole result). Measure time, bytes, and memory on both samples, in Tycho.
- **Reuse:** whether gpui-kit's column and selection pieces can sit on top of the row-based scroll model, or have to be rebuilt.
- **Canvas gaps:** how selection and copy interact with the canvas tradeoffs (text selection, a11y) the README tracks.

A feature's size and frame cost can only be measured once it's written; before that, the research estimates them (from `DataTable`'s code, or a spike in the bare host). Record the decision (build all, some, or none) in `docs/DECISIONS.md` with the numbers, and only then add a feature's milestone with "done when" checks.

---

## Open questions

- **Stripes and borders:** a few lines of drawing, so likely part of the base (as a setting) rather than a feature; the research's byte count decides.
