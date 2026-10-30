# PLAN.md — tall-table

What's next for the tall table: its features to come, in order, the active milestone's "done when" checks, long-term goals, and open questions. Only what's still open lives here. It's the one list of the table's features: Tycho and the observatory adopt one as a milestone of their own and link here, and never restate the spec.

**Goal:** the interactions of gpui-kit's `DataTable` (resizing, selection and copy, sorting, …) on the tall table's f64-row scroll model, each a Cargo feature off by default, so a host pays only for what it turns on. Tycho adopts the full set; the observatory adds a feature level only for a feature both its sides build (root `CLAUDE.md`, "Comparison protocol").

**Where everything else lives:** what it offers today in [`README.md`](README.md); its rules and architecture in [`CLAUDE.md`](CLAUDE.md); finished milestones in [`docs/milestones.md`](docs/milestones.md); decisions in [`docs/DECISIONS.md`](docs/DECISIONS.md) (why this file exists: root [`docs/DECISIONS.md`](../../docs/DECISIONS.md), "Repo structure", 2026-10-23); surprises in [`docs/LESSONS.md`](docs/LESSONS.md); what it measures of itself in `perf/results/` (created with the first measurement).

---

## Where planning stands

Planned on 2026-10-23. Each decision, with its reasons, is in [`docs/DECISIONS.md`](docs/DECISIONS.md), "Features"; this file holds what follows from them: the [order](#order), the [bare host](#measuring-a-feature), M1 to M8 (built, in [`docs/milestones.md`](docs/milestones.md)), the hardening between M7 and M8 (done, in [`docs/milestones.md`](docs/milestones.md)), M9 (`pin`, active: its research and spec done, part B next), `custom-cells`' [later notes](#follow-ups-to-built-features) (built when a host asks; its follow-ups built 2026-10-25), and research per feature (["Long-term goals"](#long-term-goals)). The Cargo names stay drafts until each feature's milestone.

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
| — | Hardening: a random test of the paging, and its fixes | Done 2026-10-28 ([`docs/milestones.md`](docs/milestones.md)) |
| M8 | `sort`: one column, ascending or descending | Done 2026-10-29 ([`docs/milestones.md`](docs/milestones.md)) |
| M9 | `pin`: columns fixed at the left | Active: part A done 2026-10-29, part B next |
| M10 | `reorder`: drag a column to move it | Planned |
| M11 | `context-menu`: right- and double-click events | Planned |
| M12 | `group-headers`: header rows over column groups | Planned |

One milestone per feature, in the order below. A *Planned* row's spec is its row under "Features"; its spec and checks are written into "Next milestones" when the one before it closes, after its research ("Long-term goals").

**Closing a milestone:** every "done when" check passes; a milestone that changed the paging has passed `just tall-table soak` on its final build (`CLAUDE.md`, rule 5); the numbers are in `perf/results/` with a note; new decisions are in `docs/DECISIONS.md`; a `docs/LESSONS.md` entry links the note; the README's Features table has the feature's row and cost; and the spec and evidence move from here to the end of `docs/milestones.md`, leaving one row above. For a feature, also flip its row in each app's "Waiting on" table (listed under "Who's waiting", below) to *Ready* (the date and the milestone); each app adopts it in a milestone of its own.

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
| `pin` | The first *n* columns fixed at the left while the rest scroll sideways (M9's research) | `ColumnFixed::Left` (left only), `fixed_left` | — (`resize` moves its edge) | No | Column pinning (left and right), with the first *n* ids |
| `reorder` | Drag a header to move its column; with `pin`, a drag across the run's edge pins or unpins it (the count by one), for its research to settle | `col_movable`, `MoveColumn` | `resize`'s width model | No | Column ordering (the drag is the app's) |
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
| `sort` | Click a sortable header's arrow to sort by it: its kind's first direction, the other, off; one column at a time (M8's research) | `sortable`, `perform_sort`, `ColumnSort` | — | Yes: the delegate is told the order (`sort`) and reads pages in it. Pages by row-group range (`file_row_number`) stop working: a source builds an index or a sorted copy at `sort`, or refuses; it never holds the result in the app's memory | Sorting, with `manualSorting` (its client-side sort would hold every row) |

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
- **Then Tycho's core:** `resize` first because `reorder` and `group-headers` build on its width model (and it moves `pin`'s edge); `select` and `copy` next because copy closes a canvas tradeoff (README, "Canvas tradeoffs"), and they're the wide sheet's later steps; `sort` is the hardest: paging by row-group range stops working, and its research settles how the delegate reads pages in a sorted order.
- **The component's features come first, built in a run;** the apps adopt them after, each in a milestone of its own (decided 2026-10-23). A *Ready* row in an app's "Waiting on" table doesn't interrupt the run.
- **A feature can move up** when an app needs it sooner. The change goes here, with a decision, never in the app's PLAN.

---

## Active milestone

### M9: `pin`, the first columns fixed at the left

**What it adds** (behind the `pin` feature, off by default): the first *n* columns, as a host sets them, drawn fixed at the cells' left while the rest scroll sideways under them, with a line at their edge. A count, not a flag per column, so the drawn order stays the index order; while they'd take more than half the cells' width, fewer pin. The research and the options weighed: root [`docs/research/tall-table-features.md`](../../docs/research/tall-table-features.md), "`pin`"; the decisions: [`docs/DECISIONS.md`](docs/DECISIONS.md), "Features" (2026-10-29, M9 part A).

```rust
// state.rs, behind `pin`.
impl<D: TallTableDelegate> TallTableState<D> {
    /// Pins the first `columns` columns at the left (0: none), kept across
    /// `set_columns` and clamped to the columns there are. Moves no scroll.
    pub fn set_pinned(&mut self, columns: usize, cx: &mut Context<Self>);
    /// The count the host set.
    pub fn pinned(&self) -> usize;
    /// The columns pinned now: the count, clamped to the columns, and cut
    /// to the leading ones whose right edge is within half the cells' width.
    pub fn pinned_in_effect(&self) -> usize;
}

pub enum TallTableEvent {
    // …
    /// The columns pinned in effect changed: by `set_pinned`,
    /// `set_columns`, the view's width, or a width (`resize`).
    #[cfg(feature = "pin")]
    Pinned(usize),
}

// probe.rs: `TallTableLayout::pinned` (in effect), with `pin`; column `c`'s
// left edge is `left + columns[c].x`, less `probe.scroll_x` when
// `c >= pinned`.
```

The spec below is what part B builds; why each rule is so is in [`docs/DECISIONS.md`](docs/DECISIONS.md), "Features", and the root's research.

- **The run:** the first `pinned_in_effect()` columns, laid out first as today (x from 0 to *P*, their widths' sum). The host's count is kept as set; in effect it's clamped to the columns and cut to the leading columns whose right edge is within half `cells_width`, so the scrolled columns keep at least half the view, and a wider view pins the rest again. Computed wherever the columns or the view's width change (`set_pinned`, `set_columns`, a fit, a `resize` release, and `set_body`, which takes a new width without `lay_out`), never on a drag's moves. Before the first frame's width the cells' width is 0 and `pinned_in_effect()` is 0; the run takes effect at the first `set_body`. `Pinned` is emitted when the run in effect changes (so once at the first frame when a count was set), never at construction.
- **The geometry:** a pinned column is drawn at its x, a scrolled one at `x − scroll_x`, clipped to the cells right of *P*; a scrolled column wholly under the run isn't drawn. The sideways scroll's range is unchanged (`content_width − cells_width`): pinning never moves the scroll, and at `scroll_x = 0` every cell is where it is unpinned. One mapping each way, a column's screen left and a screen x's content x, used at every site (the header, the cells, `custom-cells`' quads, flashes, and the jump's edge, the cell probe, the tooltip, the hit tests, `resize`'s bands, `sort`'s arrows, `select`'s tint, active cell, and `scroll_into_view`, and the horizontal thumb's press and drag, `press_track` and `drag_to`, which measure from *P* over the track). A table with nothing pinned draws and hit-tests exactly as without the feature.
- **What's drawn:** two clipped cells layers, pinned (the gutter's edge to *P*) and scrolled (*P* to the scrollbar), each with its own `custom-cells` canvas and `select` canvas, over the one layer of row backgrounds; the header split the same way, its bands and arrows in their column's region. A 1 px line in `border` at *P* through the header and body, over both layers, while a column is pinned in effect. The horizontal scrollbar's track starts at *P* (track and view `cells_width − P`, content `content_width − P`). A failed row's message stays across the cells.
- **With `resize`:** a pinned column's band drags as any other (its hairline under the edge line), moving *P* and the scrolled columns with it, its width clamped so the run stays within half the cells' width (or its `max_width`, the lesser), so a release unpins nothing. The run in effect is held through the drag and computed again at the release; the view narrowed during a drag can still pass the half, so while held *P* is clamped to the cells' width, the scrolled region and the thumb's track never negative. A scrolled column's band under the run isn't drawn.
- **With `select`:** a press left of *P* is on a pinned column, right of it on a scrolled one; a drag reaches the pinned columns from the scrolled ones (clamped to the visible cells, as now). A range across the boundary spans the scrolled columns under the run too and draws in two pieces, one per layer, each edged; the active cell's edge is in its layer. A key move to a scrolled column brings it into view right of *P*; to a pinned one, scrolls nothing sideways.
- **With `sort`:** a pinned column's arrow draws and clicks as any other. **`copy`, `live`, `follow`:** unchanged.
- **What's the host's:** the count (a menu: "Pin first column", later `context-menu`'s), moving a column into the run (`set_columns`, later `reorder`), and saying why fewer pin when `Pinned` reports it.
- **The bare host** (part B, so `size` measures it; its scripts part C): `?pin=<n>`, by default 2 in the narrow shape (`spkid`, `full_name`) and 1 in the wide; `?pin=0` builds the feature with nothing pinned, the control that splits the code's cost from the drawing's. With `?perf`, `__tallTablePin(n)` (the table's `set_pinned`, through GPUI's foreground executor).
- **The bridge** (part C): `Pinned` on a global the host names, and the layout probe's `pinned`.
- **Fixtures:** `fixtures/pin.json`: cases of the cells' width, the columns' widths, the count, and a `scroll_x` → the run in effect, the scroll's range, each visible column's screen left, hit tests (a screen x → a column, or none), and columns brought into view (→ the `scroll_x` that shows each right of *P*, as `select`'s keys bring the active cell); run natively against the table's own functions, with negative controls (`no-cap`, `pinned-scroll`, `under-run`, `into-view-at-gutter`), each failing. A property test of the two mappings beside it (proptest, natively: random widths, counts, cells' widths, and scrolls; a screen x → a column → its screen span holding the x, and no screen x mapping to a column wholly under the run). A DOM contender's test names it skipped until the observatory builds a pin level. The fixtures pinned without `pin` unchanged in the all-on run (nothing pinned).
- **The random test** gains a `pin` step (a count from 0 to past the columns), no invariant or control. No soak: the paging is untouched (`CLAUDE.md`, rule 5); if part B's code does touch it, the soak runs.

**Split into parts,** one session each, in order. Each part ends with its notes in `perf/results/` (where it measures) and `docs/LESSONS.md`. The milestone closes after part D.

- **A. Research and spec** (no shipped code). *Done 2026-10-29,* revised the same day after a code review (the run computed at `set_body` too, a held run clamped to the view, the thumb's press and drag through the mapping, `follow`'s pin renamed its tail pin in the docs), and after a second reading (a pinned column's drag clamped at the half, not unpinned at the release; the mappings' property test; columns brought into view in the fixture; an unclipped-paint control): the research in the root's `docs/research/tall-table-features.md`, "`pin`"; four decisions in `docs/DECISIONS.md`, "Features"; a `docs/LESSONS.md` entry; the API above and the checks below. No spike (the research's "Frame-work risk").
- **B. The pin.** The geometry (a pure module with its native tests, the fixture's subject), `set_pinned` and the run in effect, the two layers and the edge line, every site through the mappings, the scrollbar, `resize`'s, `select`'s, and `sort`'s parts; the host's `pin` feature forwarding the table's and the bridge's, with `?pin=`, so `size` measures it; `pin` in `perf/size.ts`'s `FEATURES` and the justfile's `test` runs; the fixture; the random test's step; native tests. Checks B1–B3.
- **C. The bridge and the scripts.** The bridge's `Pinned` arm and the layout's `pinned`; the host's `?perf` hook; the smoke check's pin runs; `perf.ts`'s pinned segments. Checks C1–C2.
- **D. The measurement and the close.** The cost on the final build, then every remaining check and the close-out ("Closing a milestone", above).

**Done when:**
- [x] **A1. The research and the spec:** the research in the root's `docs/research/tall-table-features.md`, "`pin`"; its decisions in `docs/DECISIONS.md`; the API and the checks here. *Evidence:* the research section (`DataTable`'s fixed columns and TanStack's pinning read; a count chosen over a flag; the geometry keeping the scroll's range; the cap at half the view; what each built feature does with it); `docs/DECISIONS.md`, "Features" (2026-10-29, M9 part A, four entries).
- [ ] **B1. Off by default, the base unchanged:** `just tall-table size --against <M9's parent>` (the base after wasm-opt within 0.1 KiB, no `pin` symbols in it, and the `pin` build's present; every other feature's build unchanged by `pin`'s code). `just tall-table test` passes with every feature off, each on (`pin` among them), and all on, the fixtures pinned without `pin` unchanged; `just tall-table lint` passes.
- [ ] **B2. Pinning, natively:** `pin.json` passes and each control fails; the mappings' property test passes. In a window: pinned cells stay put under a sideways scroll while the scrolled ones move and clip at *P*, none drawn wholly under the run; at `scroll_x = 0` every cell's left is the same pinned and unpinned; `set_pinned` moves no scroll and leaves its range as it was; the thumb's track starts at *P*, and a press and a drag on it with columns pinned grab the thumb where pressed and scroll to the fraction under the pointer; the edge line drawn while a column is pinned in effect, never otherwise; hover and the tooltip on a pinned cell and a scrolled one, the tooltip at the cell's screen left; the cap (a narrow view pins fewer, `Pinned` emitted, a wider one pins them again, through `set_body`; a count set before the first frame pinning at it) and `set_columns` keeping the count, clamped. With `resize`: a pinned column's band drags, moving the scrolled columns; a drag past the half stops at it, and the release leaves the run as it was; the view narrowed during a drag leaves *P* at the cells' width and the thumb's track at least 0; no band under the run. With `select`: presses, a drag across *P*, the keys' sideways scroll into the scrolled region and none to a pinned column, the tint in two pieces. With `sort`: a pinned arrow clicks. With `custom-cells`: a scrolled heat column passing under a pinned one, its fills, bars, and flashes clipped at *P*, with a control that draws them in one unclipped canvas, failing. The random test with its `pin` step passes.
- [ ] **B3. The host builds it:** the bare host's `pin` feature forwards the table's and the bridge's, `?pin=` pinning at run time; `just tall-table size` reports the `pin` build.
- [ ] **C1. In the browsers:** `just tall-table smoke` with `pin`, in both shapes, in Chromium, Firefox, and WebKit: a sideways scroll leaves the pinned columns' pixels unchanged and moves the rest, the drawn cells' screen lefts agreeing with the layout probe; the edge line on screen; the horizontal thumb pressed and dragged with columns pinned, the scroll landing at the fraction under the pointer; a viewport narrowed past the half pins fewer (`Pinned`, the probe) and widened pins again; with `select`, a press on a pinned cell and on a scrolled one selecting each; with `resize`, a pinned column's band dragged.
- [ ] **C2. The scripts measure it:** `perf.ts` on a `pin` build: the scroll, the fling, and (wide) the sideways fling with columns pinned, and with `?pin=0`. Reference and throttled, cold, median of 10.
- [ ] **D1. Its cost, in the host:** the added wasm (brotli 11, and after wasm-opt) against the base; the scroll and flings with columns pinned and with none, each against the base's spread at the same place in the session (M8 part D's lesson). On the final build. In `perf/results/` and the README's Features table.
- [ ] **D2. The README:** `pin`'s use (`set_pinned`, the count, `pinned_in_effect`, `Pinned`), what's drawn (the edge, the scrollbar), the run kept across `set_columns`, what `resize`, `select`, and `sort` do with it; its limits (left only; a leading run, a host moving a column into it; the half-width cap; no gesture of its own); canvas tradeoffs: which columns hold isn't announced.
- [ ] **D3. Waiting apps told:** `pin` joins Tycho's "Ready so far" list (the date and M9). The observatory has no row: it hasn't asked.

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

Specs drafted ahead, so a waiting app can read what's coming; each one's checks are tightened when it becomes active. M10's (`reorder`) is written after its research, which opens it once M9 closes; until then its spec is its row under "Features".

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
