# PLAN.md — tall-table

What's next for the tall table: its features to come, in order, the active milestone's "done when" checks, long-term goals, and open questions. Only what's still open lives here. It's the one list of the table's features: Tycho and the observatory adopt one as a milestone of their own and link here, and never restate the spec.

**Goal:** the interactions of gpui-kit's `DataTable` (resizing, selection and copy, sorting, …) on the tall table's f64-row scroll model, each a Cargo feature off by default, so a host pays only for what it turns on. Tycho adopts the full set; the observatory adds a feature level only for a feature both its sides build (root `CLAUDE.md`, "Comparison protocol").

**Where everything else lives:** what it offers today in [`README.md`](README.md); its rules and architecture in [`CLAUDE.md`](CLAUDE.md); finished milestones in [`docs/milestones.md`](docs/milestones.md); decisions in [`docs/DECISIONS.md`](docs/DECISIONS.md) (why this file exists: root [`docs/DECISIONS.md`](../../docs/DECISIONS.md), "Repo structure", 2026-10-23); surprises in [`docs/LESSONS.md`](docs/LESSONS.md); what it measures of itself in `perf/results/` (created with the first measurement).

---

## Where planning stands

Planned on 2026-10-23. Each decision, with its reasons, is in [`docs/DECISIONS.md`](docs/DECISIONS.md), "Features"; this file holds what follows from them: the [order](#order), the [bare host](#measuring-a-feature), M1 to M12 (built, in [`docs/milestones.md`](docs/milestones.md)), the hardening between M7 and M8 (done, in [`docs/milestones.md`](docs/milestones.md)), M10 (`density`, asked for by the observatory's wide sheet on 2026-10-30, built 2026-11-01), M11 (the flash's frames, built 2026-11-04: the cells' text drawn from one element a region on the base) and M12 (`format`, asked for by the observatory's market watch on 2026-11-04, built 2026-11-05), then M13 (`follow`'s `let_go`, asked for by the observatory's live tail on 2026-11-09, built the same day), then M14 (`copy`'s fixture, asked for by the observatory's wide sheet on 2026-11-12, built the same day), then M15 (`reorder`, active: its research done 2026-11-13), `custom-cells`' [later notes](#follow-ups-to-built-features) (built when a host asks; its follow-ups built 2026-10-25), and research per feature (["Long-term goals"](#long-term-goals)). The Cargo names stay drafts until each feature's milestone.

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
| M9 | `pin`: columns fixed at the left | Done 2026-10-29 ([`docs/milestones.md`](docs/milestones.md)) |
| M10 | `density`: a row height, a set column width, and a text size | Done 2026-11-01 ([`docs/milestones.md`](docs/milestones.md)) |
| M11 | The flash's frames, cheap: the cells' text from one element | Done 2026-11-04 ([`docs/milestones.md`](docs/milestones.md)) |
| M12 | `format`: a number column's shown text set by its host | Done 2026-11-05 ([`docs/milestones.md`](docs/milestones.md)) |
| M13 | `follow`'s `let_go`: following turned off by the host | Done 2026-11-09 ([`docs/milestones.md`](docs/milestones.md)) |
| M14 | `copy`'s fixture: a selection → its text, and the limits | Done 2026-11-12 ([`docs/milestones.md`](docs/milestones.md)) |
| M15 | `reorder`: drag a column to move it | Active: part A done 2026-11-13 |
| M16 | `context-menu`: right- and double-click events | Planned |
| M17 | `group-headers`: header rows over column groups | Planned |

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
- **Rows** are the table's own height (`table_row_height`, not a setting today). The wide sheet's denser stops need one, and a column width set without `resize`: asked for by the observatory on 2026-10-30 as `density` (M10, "Asked for by the observatory's scenarios").

---

## Features

Why the table isn't `DataTable`: its `uniform_list` places rows in f32 pixels and breaks past ~16 M px (`docs/DECISIONS.md`, "Table and paging"). The cost was `DataTable`'s interactions. Every feature in these tables is `DataTable`'s, read from gpui-component 0.7.3's `src/table/` (the pin when planned; 0.8.0, the pin since 2026-10-24, adds `resize`'s fit); the API it comes from is in each row. Feature names are drafts until each one's milestone.

**Columns:** *Depends on* is what must exist first. *Data* says whether the feature reaches the delegate (and so the engine's SQL), the costly kind for a table that never holds its rows. *TanStack* is the counterpart a feature level would build on the DOM side (TanStack Table's headless feature, which the contender doesn't load today), or "—" when there's none and the observatory would skip it.

### Columns

| Feature (Cargo) | What it adds | In `DataTable` | Depends on | Data | TanStack |
|---|---|---|---|---|---|
| `resize` | Drag a header edge to set a column's width, within a min and max; a double-click fits it; an event with the new widths, for a host to keep | `col_resizable`, `Column::resizable`, `min_width`/`max_width`, `ColumnWidthsChanged`; `fit_col` (0.8.0) | — (it adds the column-width model the rest build on) | No | Column sizing (`columnResizeMode`) |
| `pin` | The first *n* columns fixed at the left while the rest scroll sideways (M9's research) | `ColumnFixed::Left`, `fixed_left` (`ColumnFixed::Right`, `fixed_right`, since 0.9.1: "Right-pinned columns", below) | — (`resize` moves its edge) | No | Column pinning (left and right), with the first *n* ids |
| `reorder` | Drag a header to move its column; with `pin`, a drag across the run's edge pins or unpins it (the count by the columns that crossed); with `select`, a selected range moves whole (M15's research) | `col_movable`, `MoveColumn` | `resize`'s width model | No | Column ordering (the drag is the app's) |
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
| Right-pinned columns | Columns fixed at the right | `ColumnFixed::Right`, `fixed_right` (since gpui-kit 0.9.1) | No | An extension of `pin`, which is left only; how `DataTable` does it: [the 0.9.1 note](perf/results/2026-11-10-gpui-kit-0.9.1.md) |
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
| `density` | Three numbers a host sets: the row height, a column's width without `resize`'s drag, and the cells' text size (a shorter row with the same text clips its glyphs); the padding and paint fitting them; defaults unchanged. A feature of its own, the width shared with `resize`'s model (M10 part A; its spec under "Active milestone"). Asked for 2026-10-30 | Wide sheet (its denser stops: today ~310–340 cells are on screen at 120 px × 30 px) | — | No | Row height and column widths in CSS (column sizing's `size`, no resizing) |
| `format` | A number column's shown text set by its host: fixed decimals (`84.21`, `9.420`), a sign on a positive (`+0.37`), a suffix (`%`), thousands grouping (`4,400,000`); the value's exact text stays the tooltip's and the copy's. Defaults unchanged (today's exact text and `fit_float`). Asked for 2026-11-04 by market watch (tall-table M12; the observatory's M10, which follows its design canvas's text); its research done 2026-11-04 (M12 part A; its spec under "Active milestone") | Market watch | — | No | The contender's formatter (`format.ts`), pinned by `cells.json`'s new cases |

What each scenario needs from the rows above: the wide sheet `custom-cells` (heat and bar cells), `density` (its denser stops), and `pin` (its key columns frozen), and later `resize` and `select`/`copy`; market watch `live` and `custom-cells` (a cell flashing when it changes) and `format` (its prices, changes, and volumes as its design draws them); live tail `follow`; the admin table nothing past the base. So the wide sheet's need puts `custom-cells` first in the order below.

### Who's waiting

Only this file builds the table's features, whichever app asks (root `CLAUDE.md`, "Docs: one home per fact"). An app that needs one keeps a row in its PLAN's "Waiting on" table; closing the feature's milestone flips that row to *Ready*. When an app asks for a new feature, it gets a row in the tables above (or "Asked for by the observatory's scenarios") and one here.

| Feature | Waiting | Their note |
|---|---|---|
| `follow` | Observatory: live tail | [`apps/observatory/PLAN.md`](../../apps/observatory/PLAN.md), "Waiting on" |
| `follow`'s `let_go` (M13, built) | Observatory: live tail's Pause button (its M11 part E2) | [`apps/observatory/PLAN.md`](../../apps/observatory/PLAN.md), "Waiting on" |
| `resize`, `select`, `copy` | Observatory: the wide sheet's later steps (a resize drag, a range copied; its M14, after its other scenarios) | [`apps/observatory/PLAN.md`](../../apps/observatory/PLAN.md), "Waiting on" |
| `copy`'s fixture (M14, built) | Observatory: the wide sheet's TanStack copy, ported against it (its M14 part C2) | [`apps/observatory/PLAN.md`](../../apps/observatory/PLAN.md), "Waiting on" |
| Every feature | Tycho adopts each one as it's ready | [`apps/tycho/PLAN.md`](../../apps/tycho/PLAN.md), "Waiting on" |

### Order

Decided 2026-10-23: `custom-cells` → `live` → `follow` → `resize` → `select` → `copy` → `sort` → `pin` → `reorder` → `context-menu` → `group-headers`. (`row-header` left the list: the base draws a row-number gutter already.) Since 2026-10-30, `density` goes after `pin`, ahead of `reorder`; since 2026-11-04, the flash's frames and then `format` go after `density`, ahead of `reorder` (below).

- **The scenarios' features first,** in the observatory's scenario order: the wide sheet (`custom-cells`), market watch (`live`, and `custom-cells` for its flash), live tail (`follow`). Each is small, none breaks the paging, and Tycho uses them too (a growing CSV, a refreshed query).
- **Then Tycho's core:** `resize` first because `reorder` and `group-headers` build on its width model (and it moves `pin`'s edge); `select` and `copy` next because copy closes a canvas tradeoff (README, "Canvas tradeoffs"), and they're the wide sheet's later steps; `sort` is the hardest: paging by row-group range stops working, and its research settles how the delegate reads pages in a sorted order.
- **The component's features come first, built in a run;** the apps adopt them after, each in a milestone of its own (decided 2026-10-23). A *Ready* row in an app's "Waiting on" table doesn't interrupt the run.
- **A feature can move up** when an app needs it sooner. The change goes here, with a decision, never in the app's PLAN.
- **`density` moved up (2026-10-30)** ahead of `reorder`: the observatory's next scenario, the wide sheet, waits on it, and the rest of the run (`reorder`, `context-menu`, `group-headers`) has no app waiting ([`docs/DECISIONS.md`](docs/DECISIONS.md), "Features").
- **`format` moves up (2026-11-04)** ahead of `reorder`: the observatory's market watch (its M10) waits on it from its part B, and `reorder`'s run has no app waiting ([`docs/DECISIONS.md`](docs/DECISIONS.md), "Features").
- **`follow`'s `let_go` first (2026-11-09),** ahead of `reorder`, as M13 (`reorder` and the two after it moved down one, to M14–M16): a follow-up to a built feature, small, and the observatory's live tail waits on it before it ships (its M11 part E2).
- **`copy`'s fixture first (2026-11-12),** ahead of `reorder`, as M14 (`reorder` and the two after it moved down one, to M15–M17): a follow-up to a built feature, small, and the observatory's wide sheet ports the copy to its TanStack contender against it (its M14 part C2; [`docs/DECISIONS.md`](docs/DECISIONS.md), "Features").
- **The flash's frames first (2026-11-04),** then `format`: market watch's spike found a flash redraws the whole table every frame, which sinks the bare host on a slow device; the observatory measures market watch only on the improved component ([`docs/DECISIONS.md`](docs/DECISIONS.md), "Features").

---

## Active milestone

### M15: `reorder`, a column dragged to another place

**What it adds** (behind the `reorder` feature, off by default): a header dragged to move its column, or with `select` a selected range of columns; the order kept by the table, so no page is read again; a move across `pin`'s edge pins or unpins what crossed. The research and the options weighed: root [`docs/research/tall-table-features.md`](../../docs/research/tall-table-features.md), "`reorder`"; the decisions: [`docs/DECISIONS.md`](docs/DECISIONS.md), "Features" (2026-11-13, M15 part A).

```rust
// column.rs, behind `reorder`.
impl TallTableColumn {
    /// Whether a drag can move it (on by default). Others still move around it.
    pub fn movable(self, movable: bool) -> Self;
}

// state.rs, behind `reorder`. A column's place is where it's drawn (0 at
// the left); its index is its place in `set_columns`' list, which a page
// reads by. Without a move they're equal.
impl<D: TallTableDelegate> TallTableState<D> {
    /// Moves the columns at `places` so the first lands at place `to` (in
    /// the order after the move): the selection and `pin`'s count follow
    /// ("A move", below), `ColumnsMoved`. With `pin`, at the run's end the
    /// block keeps its first column's side. Nothing for an empty block, a
    /// block past the columns, a `to` past `columns − block length`, or a
    /// move that changes neither the order nor the count.
    pub fn move_columns(&mut self, places: Range<usize>, to: usize, cx: &mut Context<Self>);
    /// As `move_columns`, the block landing pinned or not as `pinned` says
    /// where `to` is the run's end (a drag's release calls this, with the
    /// pointer's side); nothing where `to` is on the other side of the run.
    #[cfg(feature = "pin")]
    pub fn move_columns_pinned(&mut self, places: Range<usize>, to: usize, pinned: bool, cx: &mut Context<Self>);
    /// Sets the order: `order[place]` is the index drawn there. Refused
    /// (a debug assertion, nothing changed) unless a permutation of the
    /// columns' indices. A `Columns` or `Cells` selection is cleared
    /// (`Selected(None)`); `pin`'s count is kept as a count of places, so
    /// the first *n* drawn pin, whichever they are now: a host restoring an
    /// order with its pins calls `set_pinned` after, with the count
    /// `ColumnsMoved` gave it. `ColumnsMoved` if it changed.
    pub fn set_order(&mut self, order: Vec<usize>, cx: &mut Context<Self>);
    /// The order in effect: `order()[place]` is the index drawn there.
    pub fn order(&self) -> &[usize];
}

pub enum TallTableEvent {
    // …
    /// The order changed (a drag's release, `move_columns`, `set_order`),
    /// with the order after; with `pin`, the host's count after too.
    #[cfg(feature = "reorder")]
    ColumnsMoved { order: Vec<usize>, #[cfg(feature = "pin")] pinned: usize },
}

// probe.rs: `ColumnProbe::index` with `reorder`; the layout's columns are
// in drawn order. `Sort::column` and `ColumnWidthsChanged` stay by index.
```

The spec below is what parts B and C build; why each rule is so is in [`docs/DECISIONS.md`](docs/DECISIONS.md), "Features", and the root's research.

- **Places and indices:** the state keeps its columns in drawn order, each with its index. By place: `select`'s ranges, keys, and events; `pin`'s count; `copy`'s column order; the hit tests; the layout and cell probes. By index: a page's `value`, `paint`, and `decimals` (the cells, the tooltip, `resize`'s fit, `copy`'s turn), `live`'s flashes, `Sort::column` and the delegate's `sort`, `ColumnWidthsChanged`'s order, and the probe's last cell (index 0's, as the scripts read it). `set_columns` resets the order to the list's own.
- **The press** (part C): on a movable column's header, not its band or arrow, a move past 2 px starts the drag of that column. With `select`'s `Columns` kind on, only a press inside the selected `Columns` range does, and the drag is the range (every column in it movable, or no drag); such a press that never passes 2 px selects that column alone at its release. Every other press selects as today; Shift and Cmd presses never move.
- **The drag** (part C), window-wide: the gap is among the visible columns of the pointer's region (with `pin`, the run in effect or the scrolled columns), after the last whose center is left of the pointer's x, at any height; left of the cells the region's first gap, past its last visible column its last. A gap inside the block or beside it is none, except the run's end with the pointer on the other side of the edge from a block wholly on one side (a pin or an unpin with no reorder). A wheel scrolls the body sideways and the gap follows. Escape cancels (the key stops there). Drawn: the block's header cells over the header in `table_head` at 0.9 opacity with a 1 px `border` edge, at the pointer's x less the press's offset, the block's own header text in `muted_foreground` meanwhile; a 2 px `drag_border` line at the gap's left edge (its column's left, or the last visible column's right) through the header and body, in its region's layer; the closed-hand cursor window-wide. A frame only when the preview or the gap moves. No hover or tooltip during it.
- **The release** with a gap: as `move_columns_pinned` with the pointer's side (without `pin`, `move_columns`). Without one, nothing.
- **A move** (part B): the order changes, the columns are laid out (`lay_out`: no read, cancel, or eviction), the sideways scroll kept and clamped; the selection: `Rows` kept; a `Columns` or `Cells` range mapped column by column, kept if its columns are still a contiguous run of places (that run, its rows and its direction kept: the anchor at the run's end on its side), otherwise cleared; `Selected` with the range whenever its places change (`None` when cleared); with `pin`, the block lands on a side, pinned or scrolled: with *r* the run's columns outside the block (the count clamped to the columns, less the block's pinned ones), a `to` below *r* is pinned, above it scrolled, and at *r*, the run's end, the side given (the drag's: the pointer's side of the edge; `move_columns`: the block's first column's; `move_columns_pinned`: its argument). If any column changes side, the count becomes the clamped count plus the columns that joined the run less those that left it (a change, never a recount); otherwise the host's count is kept as it was, past the columns or not. Then the cap (`Pinned` if the run in effect changes); `ColumnsMoved`. A copy running keeps the columns it started with; `sort`, flashes, widths, and settings stay with their columns.
- **The bare host** (part B, so `size` measures it; the drag's use part C): every column movable; `?order=reverse` (the columns reversed before the first frame; `?order=` alone or absent the list's own, the control); with `?perf`, `__tallTableMove(start, end, to)` and `__tallTableOrder(…)` (the table's `move_columns` and `set_order`, through GPUI's foreground executor; `false`, nothing sent, for numbers that aren't whole or a block, `to`, or order out of range).
- **The bridge** (part D): `ColumnsMoved`'s order on a global the host names (`__tallTableColumnOrder` in the host), and the layout probe's `index`.
- **Fixtures** (part B its move cases, part C its gap cases): `fixtures/reorder.json`: cases of the columns' widths, the cells' width, a sideways scroll, the pin count, a block, and a pointer's x → the gap (or none), and the move → the order, the count, and a selection before → after; run natively against the table's own functions, with negative controls (`gap-by-left-edge`, `beside-the-block`, `no-edge-gap` (the run's end beside the block refused), `count-kept`, `recount` (the count recounted from the columns, not changed), `selection-unmoved`), each failing the cases it names. A DOM contender's test names it skipped (no observatory level). The fixtures pinned without `reorder` unchanged in the all-on run (the order the list's own).
- **The random test** (part B): `Move` and `SetOrder` steps placed from a stream of their own (the case's seed mixed with a constant of their own, as `density`'s), up to eight, each a `u64` drawn there and expanded into a block, a `to`, and a side, or a permutation (a seeded shuffle), so every case's draw and `pin`'s and `density`'s places are unchanged; invariants 5 and 7 check each drawn and copied cell's column through the order; a control, `ReadByPlace`, failing at 5. The soak on the final build (`copy`'s turn changes: `CLAUDE.md`, rule 5).

**Split into parts,** one session each, in order. Each part ends with its notes in `perf/results/` (where it measures) and `docs/LESSONS.md`. The milestone closes after part E.

- **A. Research and spec** (no shipped code). *Done 2026-11-13,* revised the same day after a code review (the run's end decided by a side `move_columns_pinned` takes, so the API can say what a drag does, and the gap beside a block at the edge a pin or an unpin; the count changed, never recounted; the selection mapped column by column, `Selected` at each change of places; `set_order` keeping the count by place; `to` bounded; the random test's steps from a stream of their own; the rustdocs that name a column): the research in the root's `docs/research/tall-table-features.md`, "`reorder`"; six decisions in `docs/DECISIONS.md`, "Features"; a `docs/LESSONS.md` entry; the API above and the checks below. No spike (the research's "Frame-work risk").
- **B. The order.** Places and indices through every site, `move_columns`, `set_order`, `order`, `ColumnsMoved`, the selection's and `pin`'s rules, `copy`'s columns taken at its start, `TallTableColumn::movable`; the rustdocs that name a column say which number (`Cell` and `TallTableSelection`: places; `Sort::column`, `ColumnWidthsChanged`, `set_columns`' line on the sorted column: indices); the host's `reorder` feature forwarding the table's and the bridge's, `?order=` and the two hooks, so `size` measures it; `reorder` in `perf/size.ts`'s `FEATURES` and the justfile's `test` runs; the fixture; the random test's steps, invariants, and control; native tests; the soak before the code review. Checks B1–B3.
- **C. The drag.** The press beside `select`'s, `resize`'s, and `sort`'s, the gap, the wheel, Escape, the preview, the line, the cursor; the fixture's gap cases (a pointer's x and side → the gap) and their controls. Check C1.
- **D. The bridge and the scripts.** The bridge's `ColumnsMoved` arm and the layout's `index`; the smoke check's reorder runs; `perf.ts`'s reorder drag segment and `--order reverse`. Checks D1–D2.
- **E. The measurement and the close.** The cost on the final build, with the gpui-kit 0.9.0 comparison carried from the bump (below), then every remaining check and the close-out ("Closing a milestone", above). Checks E1–E3.

**Done when:**
- [x] **A1. The research and the spec:** the research in the root's `docs/research/tall-table-features.md`, "`reorder`"; its decisions in `docs/DECISIONS.md`; the API and the checks here. *Evidence (2026-11-13):* the research section (`DataTable`'s move in gpui-component 0.9.1 read: its gap by centers, its drop on the header alone, its selection left behind, its refusal across the fixed edge; TanStack's `columnOrder`; the order kept by the table over the host moving its source; places and indices; Sheets' rule beside `select`; the count changed by the columns crossing `pin`'s edge); `docs/DECISIONS.md`, "Features" (2026-11-13, M15 part A, six entries).
- [ ] **B1. Off by default, the base unchanged:** `just tall-table size --against <M15's parent>` (the base after wasm-opt within 0.1 KiB, no `reorder` symbols in it, and the `reorder` build's present; each other feature's build's change reported). `just tall-table test` passes with every feature off, each on (`reorder` among them), and all on, the fixtures pinned without `reorder` unchanged; `just tall-table lint` passes; `just tall-table soak` passes on B's final build.
- [ ] **B2. The order, natively:** `reorder.json`'s move cases pass and each control fails the cases it names. In a window, with the order reversed and after `move_columns`: each drawn cell is its column's index's value, at its place's left; the tooltip's text and `resize`'s fit read the column's own; `ColumnWidthsChanged` stays in index order; `set_columns` resets the order; `set_order` refuses a non-permutation; `ColumnsMoved` once a change, never for a move that changes nothing; a `to` past the end does nothing. With `select`: a range inside the block moved, one outside the shifted places kept, one inside them shifted, one holding the block and the shifted places kept in place, one split cleared; `Selected` at each change of places, `None` only when cleared. With `pin`: a block moved into the run pins (the count up by its length), out of it unpins, within either side leaves the count (a count past the columns kept), at the run's end by the block's side (`move_columns`) or the argument (`move_columns_pinned`), a column beside the edge pinned and unpinned without moving; `set_order` keeping the count by place; a block that passes the half cap pins in count, not in effect (`Pinned`). With `sort`: the arrow and the sort stay on the moved column, the delegate told nothing. With `copy`: a copy started before a move writes the columns it started with, in that order. With `live` and `custom-cells`: a flash stays on its cell. The random test with its steps passes, `ReadByPlace` failing at invariant 5, in the all-on run.
- [ ] **B3. The host builds it:** the bare host's `reorder` feature forwards the table's and the bridge's, `?order=reverse` reversing at run time; `just tall-table size` reports the `reorder` build.
- [ ] **C1. The drag, natively:** `reorder.json`'s gap cases pass and its controls fail. In a window (`simulate_event`): a press and a move under 2 px moves nothing and, with `select`, selects as today; past 2 px the preview follows and the line is at the gap, through the header and body; the pointer below the header keeps the gap; a wheel during the drag scrolls sideways and the gap follows; Escape cancels and goes no further; a release beside the block moves nothing, except across the run's edge (`pin`); a release at a gap moves as `move_columns_pinned` with the pointer's side. With `select`: a press outside the selected `Columns` range selects and drags a selection as today, inside it moves the range, a press inside it never passing 2 px selects that column at its release, a range holding an unmovable column doesn't drag; a `Cells` or `Rows` selection doesn't make headers movable beyond the plain rule. With `resize` and `sort`: the band and the arrow keep their presses. With `pin`: the drag across the edge pins and unpins, and the gap at the run's end by the pointer's side. Nothing hovered and no tooltip during the drag.
- [ ] **D1. In the browsers:** `just tall-table smoke` with `reorder`, in both shapes, in Chromium, Firefox, and WebKit: a column dragged two places right and back, the published order and the layout probe agreeing, the drawn cells at their new places against the source's exact values; `?order=reverse`'s first screen drawn reversed against the source; with `select`, a two-column range selected and dragged, still selected at its new places; with `pin`, a column dragged into the run and out, the published count following; with `copy`, a block copied after a move pasted back in drawn order; with `sort`, a sorted column moved, the order kept.
- [ ] **D2. The scripts measure it:** `perf.ts` on a `reorder` build: every segment with `--order reverse` and with the list's own, and a reorder drag segment (the first float column's header dragged 600 px right and back, twice, a pointer move every 8 ms). Reference and throttled, cold, median of 10.
- [ ] **E1. Its cost, in the host:** the added wasm (brotli 11, and after wasm-opt) against the base; the scroll, flings, and the drag reversed and not, each against the base's spread at the same place in the session. The base's `perf` (both shapes, reference and throttled, median of 10) against a gpui-kit 0.9.0 build of the base, with `resize`'s and `select`'s drags, to tell the bump's cost apart (below). On the final build. In `perf/results/` and the README's Features table.
- [ ] **E2. The README:** `reorder`'s use (`move_columns`, `set_order`, `order`, `ColumnsMoved`, `movable`), places and indices (which of the table's numbers is which), the gesture with and without `select`, what `pin`, `select`, `sort`, and `copy` do with a move; its limits (no scroll at the edge during a drag; the order reset by `set_columns`); canvas tradeoffs (pointer only; a move isn't announced).
- [ ] **E3. Waiting apps told:** `reorder` joins Tycho's "Ready so far" list (the date and M15). The observatory has no row: it hasn't asked.

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

Specs drafted ahead, so a waiting app can read what's coming; each one's checks are tightened when it becomes active.

M16's (`context-menu`) is written after its research, which opens it; until then its spec is its row under "Features".

**Carried into M15's cost check (its check E1), from the gpui-kit 0.9.1 bump** (2026-11-10, [its note](perf/results/2026-11-10-gpui-kit-0.9.1.md), which names it M14: `reorder` was renumbered M15 on 2026-11-12): gpui-pre 0.3.12 resets the cursor on every mouse and scroll event, a `document.body.style.cursor` write each on the web, and the base's frame work wasn't measured after it. M15's `perf` on the base (both shapes, reference and throttled, median of 10) also runs against a gpui-kit 0.9.0 build of the base (the commit before the bump, in a worktree with its own `target/`), with the `resize` and `select` drags (a pointer move every 8 ms) among the segments read, so the bump's cost is told apart from `reorder`'s, in M15's results note; a milestone of its own only if it moved.

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

- **More late frames in a throttled wide fling with a feature built** (found in M4 part D with `follow`, again in M5 part D with `resize`): with `follow`, over 20 runs each, in both orders, ~8% late (median) against the base's ~3.5%, ranges overlapping (base 0.5–9.6%, `follow` 4.0–12.1%); with `resize`, 5.1% against 2.0% over 10 each (base 1.5–8.4, `resize` 1.0–12.0), its runs' p95 at ~30 ms in 7 of 10 against the base's 3 (the two modes ~15 and ~30 ms). With `select` (M6 part D), 4.1% against 2.75% (base 0.5–8.4, `select` 1.5–6.8), with no frame cost measured in any segment. With `pin` (M9 part D) it didn't show: 1.96% against the base's 2.99% (base 1.5–6.8, `pin` 0.5–4.5). Work per frame, busy time, and placeholders the same; not in the narrow fling or any reference segment. `follow`'s code on that path is a comparison per wheel and an early return per page landing, and `resize`'s the bands' ~0.1 ms a frame, which every reference segment shows without a late frame, so it's likely not either feature's code (the build's layout, say). Worth a trace comparison of the two builds' slow frames before an app adopts `follow` on a slow machine; not a blocker for the feature, whose frame work matches.
- **Pages of the visible columns only** (two-dimensional paging): a page holds every column of its rows, so at the wide shape's 500 floats it's ~4 MB of Arrow and the 64 MiB cache holds ~16 pages. A page of the visible column range would cut the bytes read, sent, and decoded per frame of a sideways scroll, but it changes the delegate's unit and every paging decision, and a sideways scroll would then read pages too. Noted 2026-10-30 from the observatory's wide sheet, which keeps full-row pages (the same on both sides); worth research only if its data path measures the page's cost as the wide sheet's bottleneck.
- **Vertical cell borders** (`DataTable`'s `bordered`): the base draws row lines but no column lines. Nobody has asked; a wide sheet of heat cells may want them.
