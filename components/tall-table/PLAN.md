# PLAN.md — tall-table

What's next for the tall table: its features to come, in order, the active milestone's "done when" checks, long-term goals, and open questions. Only what's still open lives here. It's the one list of the table's features: Tycho and the observatory adopt one as a milestone of their own and link here, and never restate the spec.

**Goal:** the interactions of gpui-kit's `DataTable` (resizing, selection and copy, sorting, …) on the tall table's f64-row scroll model, each a Cargo feature off by default, so a host pays only for what it turns on. Tycho adopts the full set; the observatory adds a feature level only for a feature both its sides build (`.claude/rules/comparison-protocol.md`).

**Where everything else lives:** what it offers today in [`README.md`](README.md); its rules and architecture in [`CLAUDE.md`](CLAUDE.md); finished milestones in [`docs/milestones.md`](docs/milestones.md); decisions in [`docs/DECISIONS.md`](docs/DECISIONS.md) (why this file exists: root [`docs/DECISIONS.md`](../../docs/DECISIONS.md), "Repo structure", 2026-10-23); surprises in [`docs/LESSONS.md`](docs/LESSONS.md); what it measures of itself in `perf/results/` (created with the first measurement).

---

## Where planning stands

Planned on 2026-10-23. Each decision, with its reasons, is in [`docs/DECISIONS.md`](docs/DECISIONS.md), "Features"; this file holds what follows from them: the [order](#order), the [bare host](#measuring-a-feature), M1 to M12 (built, in [`docs/milestones.md`](docs/milestones.md)), the hardening between M7 and M8 (done, in [`docs/milestones.md`](docs/milestones.md)), M10 (`density`, asked for by the observatory's wide sheet on 2026-10-30, built 2026-11-01), M11 (the flash's frames, built 2026-11-04: the cells' text drawn from one element a region on the base) and M12 (`format`, asked for by the observatory's market watch on 2026-11-04, built 2026-11-05), then M13 (`follow`'s `let_go`, asked for by the observatory's live tail on 2026-11-09, built the same day), then M14 (`copy`'s fixture, asked for by the observatory's wide sheet on 2026-11-12, built the same day), then M15 (`reorder`, built 2026-11-13), then M16 (`clicks`, drafted as `context-menu`, with Kirkwood's press folded in; built 2026-11-16), then M17 (`group-headers`, researched and specced 2026-11-16), `custom-cells`' [later notes](#follow-ups-to-built-features) (built when a host asks; its follow-ups built 2026-10-25), and research per feature (["Long-term goals"](#long-term-goals)). The Cargo names stay drafts until each feature's milestone.

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
| M15 | `reorder`: drag a column to move it | Done 2026-11-13 ([`docs/milestones.md`](docs/milestones.md)) |
| M16 | `clicks`: a press, a double press, and a context press reported | Done 2026-11-16 ([`docs/milestones.md`](docs/milestones.md)) |
| M17 | `group-headers`: header rows over column groups | Active: parts A, B, and C done 2026-11-16 |

One milestone per feature, in the order below. A *Planned* row's spec is its row under "Features"; its spec and checks are written into "Next milestones" when the one before it closes, after its research ("Long-term goals").

**Closing a milestone:** every "done when" check passes; a milestone that changed the paging has passed `just tall-table soak` on its final build (`CLAUDE.md`, rule 5); the numbers are in `perf/results/` with a note; new decisions are in `docs/DECISIONS.md`; a `docs/LESSONS.md` entry links the note; the README's Features table has the feature's row and cost; and the spec and evidence move from here to the end of `docs/milestones.md`, leaving one row above. For a feature, also flip its row in each app's "Waiting on" table (listed under "Who's waiting", below) to *Ready* (the date and the milestone); each app adopts it in a milestone of its own.

---

## Measuring a feature

**Two kinds of numbers, two homes.**
**The component measures only itself.** Each feature's own cost: the wasm it adds (brotli) and the work per frame it adds while scrolling (and in its own interaction), each against the base, in the bare host. Recorded in `perf/results/` (dated JSON and a note, as an app's are) and in the README's Features table ("Cost", "Measured in"). There's no `budgets.json` and nothing gates on these: every feature in the order is built, because an app needs it, and the numbers tell a host what turning it on costs.

**What protects the apps is the component's tests,** not a measurement in each app. Every feature is off by default, so an app's build doesn't change until it turns one on: each feature's milestone checks that the base build is unchanged with the feature off, and that the native tests and the fixtures pass with it off and on. An app measures a feature against its own budgets when it adopts it, in its own milestone; if it finds a cost it can't carry, the optimization is a milestone here.

**The bare host** (built: `host/`, its use in `CLAUDE.md`). A small crate in this component, `components/tall-table/host/`: a wasm `cdylib` that renders the tall table and nothing else, built the way the apps are (`cargo build -p <host crate>` on its own, `wasm-bindgen --target web`, `wasm-opt -Oz --enable-threads` with the apps' flags, brotli quality 11), and never deployed.
- **Why its own crate, not an app:** a cost read in Tycho mixes in Tycho's code, and the observatory's GPUI contender can't carry code for a feature its DOM side lacks (`.claude/rules/comparison-protocol.md`, "The same scope").
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
| `group-headers` | Header rows over groups of columns, any depth, from a label path on each column; a group's cell selects and drags the group, and the table's drags keep a group whole (M17's research) | `group_headers`, `ColumnGroup` | `pin`, `reorder` (a group moves whole; at `pin`'s edge it's drawn split) | No | Header groups |

### Selection

| Feature (Cargo) | What it adds | In `DataTable` | Depends on | Data | TanStack |
|---|---|---|---|---|---|
| `select` | Row, column, and cell selection, by click, Shift-extend, and keys; events for each; held as ranges, never a set of rows (25 M rows select in one range). One feature for all three modes, the host picking at run time | `row_selectable`, `col_selectable`, `cell_selectable`, `loop_selection`, `SelectRow`/`SelectColumn`/`SelectCell` | — | No | Row selection (a map of row ids: select-all over 1.57 M rows is a fair stress) |
| `copy` | Copy a selection as TSV; a selection larger than the loaded pages asks the delegate for its rows; the host writes the clipboard (M7's research) | `dump_range` (rows held in memory) | `select` | Yes: rows not loaded are read, in pages | — |
| `clicks` (drafted as `context-menu`) | A press, a double press, and a context press (right button, Ctrl+click, long press) on a cell, row number, header, corner, or blank, reported whether or not the selection changed, for a host's menu (M16's research; Kirkwood's press folded in) | `context_menu`, `RightClickedRow`/`RightClickedCell`, `DoubleClickedRow`/`DoubleClickedCell` | — (with `select`, a context press outside the selection selects its target) | No | — |

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

### Asked for by Kirkwood

Asked for 2026-11-13 ([`apps/kirkwood/docs/DECISIONS.md`](../../apps/kirkwood/docs/DECISIONS.md), "Interface"); folded into `clicks` (M16) on 2026-11-16 as its `Press` ([`docs/DECISIONS.md`](docs/DECISIONS.md), "Features").

| Feature (Cargo) | What it adds | Asked for by | Depends on | Data | TanStack |
|---|---|---|---|---|---|
| A press reported: `clicks`' `Press` (M16, built) | The host hears a press on a row or a cell whether or not the selection changed: today `Selected` is emitted only at a change, so a press on the row already selected says nothing. Kirkwood flies its camera to the pressed row's dot, and a second press on the same row should fly it there again | Kirkwood: a found row a pan let go, and its tour's rows | — (its spec: the `clicks` row under "Selection") | No | — |

### Who's waiting

Only this file builds the table's features, whichever app asks (root `CLAUDE.md`, "Docs: one home per fact"). An app that needs one keeps a row in its PLAN's "Waiting on" table; closing the feature's milestone flips that row to *Ready*. When an app asks for a new feature, it gets a row in the tables above (or "Asked for by the observatory's scenarios") and one here.

| Feature | Waiting | Their note |
|---|---|---|
| `follow` | Observatory: live tail | [`apps/observatory/PLAN.md`](../../apps/observatory/PLAN.md), "Waiting on" |
| `follow`'s `let_go` (M13, built) | Observatory: live tail's Pause button (its M11 part E2) | [`apps/observatory/PLAN.md`](../../apps/observatory/PLAN.md), "Waiting on" |
| `resize`, `select`, `copy` | Observatory: the wide sheet's later steps (a resize drag, a range copied; its M14, after its other scenarios) | [`apps/observatory/PLAN.md`](../../apps/observatory/PLAN.md), "Waiting on" |
| `clicks`' `Press` (M16, built; "Asked for by Kirkwood") | Kirkwood: the same row pressed again flies the camera back to it | [`apps/kirkwood/PLAN.md`](../../apps/kirkwood/PLAN.md), "Waiting on" |
| `copy`'s fixture (M14, built) | Observatory: the wide sheet's TanStack copy, ported against it (its M14 part C2) | [`apps/observatory/PLAN.md`](../../apps/observatory/PLAN.md), "Waiting on" |
| Every feature | Tycho adopts each one as it's ready | [`apps/tycho/PLAN.md`](../../apps/tycho/PLAN.md), "Waiting on" |

### Order

Decided 2026-10-23: `custom-cells` → `live` → `follow` → `resize` → `select` → `copy` → `sort` → `pin` → `reorder` → `context-menu` → `group-headers`. (`row-header` left the list: the base draws a row-number gutter already; `context-menu` became `clicks` on 2026-11-16, Kirkwood's press folded in.) Since 2026-10-30, `density` goes after `pin`, ahead of `reorder`; since 2026-11-04, the flash's frames and then `format` go after `density`, ahead of `reorder` (below).

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

### M17: `group-headers`, header rows over groups of columns

**What it adds** (behind the `group-headers` feature, off by default): rows over the header naming groups of columns, any number of levels deep, from a label path on each column. A group follows its columns through a move. The table's own drags keep a group whole: a group's cell drags the group, and a column moves only within its group. Pressing a group's cell selects its columns. The research and the options weighed: root [`docs/research/tall-table-features.md`](../../docs/research/tall-table-features.md), "`group-headers`"; the decisions: [`docs/DECISIONS.md`](docs/DECISIONS.md), "Features" (2026-11-16, M17 part A).

```rust
impl TallTableColumn {
    /// The groups this column sits under, outermost first (`group-headers`).
    /// Neighbors in drawn order whose paths agree through a level share
    /// that level's cell; with none set, the column is in no group.
    #[cfg(feature = "group-headers")]
    pub fn group<S: Into<SharedString>>(self, path: impl IntoIterator<Item = S>) -> Self;
}

// With `clicks`, a new target. `ClickTarget` becomes `#[non_exhaustive]`
// (part C), so a crate matching it builds whether or not the variant is
// compiled in; it stays `Copy`.
#[non_exhaustive]
pub enum ClickTarget {
    // …
    /// A group's cell: its level (0 at the top) and its run's places,
    /// `start..end`, the whole run even when `pin`'s edge splits its cell.
    #[cfg(feature = "group-headers")]
    Group { level: usize, start: usize, end: usize },
}

// The layout probe (`probe.rs`), with the feature.
pub struct TallTableLayout {
    // …
    /// The header's rows: the groups' levels plus the names' row.
    pub header_rows: usize,
}

// The group cells drawn, level by level, when they change (a sideways
// scroll among the causes), apart from the layout, which carries every
// column (part B's code review).
pub enum TallTableEvent {
    // …
    #[cfg(feature = "group-headers")]
    Groups(Vec<GroupProbe>),
}

pub struct GroupProbe {
    pub level: usize,
    pub label: String,
    /// The run's places, `start..end`: the whole run, so the two cells of
    /// a run split by `pin`'s edge share them.
    pub start: usize,
    pub end: usize,
    pub pinned: bool,
    /// The drawn cell's left and width, cut to its region's visible part,
    /// from the cells area's left; the label's left from the same edge.
    pub left: f32,
    pub width: f32,
    pub label_x: f32,
}
```

The spec below is what parts B and C build; why each rule is so is in [`docs/DECISIONS.md`](docs/DECISIONS.md), "Features", and the root's research.

- **The runs** (part B): at level *i*, neighboring places whose paths are both deeper than *i* and agree through *i* are one run. A run is a group's columns, never cut by `pin`: the edge splits only its drawn cell (below), so a press, a selection, and a move take the whole run. The runs are worked out where the columns are laid out (`lay_out`: a change in the columns, the order, or the widths), never during a frame. They're a pure function in `src/groups.rs` (the paths in drawn order → each level's runs), tested natively. Their cells' geometry is the frame's, from the run in effect, which `repin` changes without `lay_out` (a window resize, `set_pinned`, a resize's release).
- **The header** (part B): one row per level of the deepest path plus the names' row, each the row height in effect (`sizes()`). With no paths it's one row and draws as today. Level *i* is row *i* from the top, and the names are always the bottom row. A shorter path leaves blanks below its last group. The corner (over the gutter) is one cell the header's full height, and a press anywhere in it is the corner's. The body gets what's left, so a change in depth refits the viewport as a resize does.
- **A group's cell** (part B): its run's columns at their laid-out x and widths, cut to each region's visible part: a run across `pin`'s edge in effect draws two cells, one a region, each labeled. A 1 px `border` line at its right and bottom. Its label sits at the left of the visible part plus the padding, truncated to that part, in `table_head_foreground`. A blank draws nothing. With `select`, a cell takes the selection's tint when all its columns are among the selection's columns (`selected_lines`, any kind), as a column's header does.
- **The layers over the header** (part B): `sort`'s arrows and `resize`'s bands on the bottom row only, `pin`'s edge line and `reorder`'s gap line through every row, `reorder`'s preview drawing the block's header in every row (its group cells cut to the block).
- **The probe** (part B): `header_rows` on the layout, and the group cells drawn in `TallTableEvent::Groups` as they change (the bare host's `__tallTableGroups` with `?perf`), so the scripts and the fixture read what's drawn.
- **The presses** (part C), by the hit test's new arm: a point in a group row over a run's cell is the group, and over a blank it's the column's header. With `select`, a press on a group selects as a press on its first column's header followed by a Shift+press on its last would; a Shift+press on a group extends to the group's far edge from the anchor; a drag starting there extends nothing. With `reorder`, a drag past 2 px from a group's cell lifts the group (with `Columns` on, it's selected at the press, so the selection moves with it). With `clicks`, a `Group { level, start, end }` target, the whole run's places from either half of a split cell; a context press on a group whose columns are all in the selected `Columns` range keeps the range, and elsewhere selects the group.
- **A move keeps a group whole** (part C): a block's parent is the deepest run that holds all of it and more (a run equal to the block is the block, not its parent), or the whole table. A lifted group's parent is so the run around it. The block lifts only if every run deeper than its parent that it meets lies inside it; if not, the press acts as one that never passed 2 px. Its gaps are the boundaries between the parent's children (deeper runs, or columns in no deeper run), inside the parent's span, by `reorder`'s rule over the children's centers. Left of the span it's the first gap, right of it the last. A gap beside the block moves nothing. `pin`'s edge works as in `reorder`: a group the host's count split is lifted whole and lands wholly on one side (`Move::count_after`), so the table's drag mends a split and never makes one. A host's `move_columns` and `set_order` aren't held to this; what they split is drawn split.
- **`copy`** (part B): the header line stays the names alone.
- **The fixture** (B for the drawing, C for the drag): `fixtures/group-headers.json`. Cases of paths, widths, an order, a pin count, the cells' width, and a sideways scroll → each group cell drawn (level, label, places, region, left, width, the label's x). Cases of a block and a pointer's x (and side) → the gap or none. Run natively against the table's own functions, with negative controls: `GroupsByPlace` (`DataTable`'s spans), `NoSplitAtEdge`, `LabelCentered`, `GapOutsideParent`, `GapByColumnCenters`. `fixtures/CLAUDE.md` gets its line, and a DOM contender's test names it skipped.
- **The random test** (part C): the case's columns get paths from a stream of their own (depth 0–3, runs of 1–8 columns), so every existing case's draw is unchanged. Two new invariants: the drawn group cells are the runs of the drawn order, and a move the drag makes never splits a run. Each gets a control that must fail it (`GroupsByPlace`, `GapOutsideParent`). The soak runs on the final build: the paging is unchanged, but the viewport's height changes with every grouped case.
- **The bare host** (part B, so `size` measures it): the host's `group-headers` feature forwarding the table's and the bridge's, and `?groups=<outer>,<inner>`: the columns in groups of `outer`, each cut into groups of `inner` (by default 50,10 in the wide shape and 6,3 in the narrow), so the feature is used, not only compiled. The bridge publishes a `Group` click (part C) as `target: "group"` with `level`, `start`, and `end` (each `null` for another target), and an unknown target (the enum's `#[non_exhaustive]` arm) as `"unknown"`.

**Split into parts,** one session each, in order. Each part ends with its notes in `perf/results/` (where it measures) and `docs/LESSONS.md`. The milestone closes after part D.

- **A. Research and spec** (no shipped code). *Done 2026-11-16,* revised the same day after a code review (`pin`'s edge cuts a run's cell, not the run, since `repin` moves the edge without `lay_out` and a cut run would let a drag split its group; a block's parent strictly around it; `ClickTarget::Group`'s places as fields and the enum `#[non_exhaustive]`; the corner the header's height; the tint under any kind; the bridge's fields). The research, the decisions, this spec, and the README's "How it differs from `DataTable`" table (asked for while the research ran). Check A1.
- **B. The groups drawn.** *Done 2026-11-16,* revised after its code review (the group cells an event of their own, not on the layout; the corner's press in every header row; one helper for a group cell and for the layer without `pin`). `TallTableColumn::group`, `src/groups.rs`'s runs, the header's rows and cells, the label kept in view, the layers moved to the bottom row, the probe, `copy`'s header line, the bare host's `?groups=`, the fixture's drawing half. Checks B1–B3.
- **C. The presses and the moves.** *Done 2026-11-16,* revised after its code review (a group row's press hit-tested against the runs in effect, not the last frame's cells; a sibling split by `pin`'s edge offering only its near boundary in each region). The hit test's group arm, `select`'s group press, `reorder`'s parent rule, gaps, and preview, `clicks`' `Group`, the bridge's publish, the fixture's drag half, the random test, the soak, the smoke check in three browsers. Checks C1–C3.
- **D. The measurement and the close.** The cost on the final build, then every remaining check and the close-out ("Closing a milestone", above). Checks D1–D3.

**Done when:**
- [x] **A1. The research and the spec:** the research in the root's `docs/research/tall-table-features.md`, "`group-headers`"; its decisions in `docs/DECISIONS.md`; the API and the checks here. *Evidence (2026-11-16):* the research section (`DataTable`'s `group_headers` and `ColumnGroup` spans by place in gpui-component 0.9.1, which `move_column` doesn't move; TanStack's header groups, placeholders, and per-region rows); six decisions in `docs/DECISIONS.md`, "Features" (the model, the depth, and the presses decided with the owner); this spec, revised after its code review (part A's line).
- [x] **B1. Off by default, the base unchanged:** `just tall-table size --against <M17's parent>` (the base after wasm-opt within 0.1 KiB, no `group-headers` symbols in it, the feature's build present). `just tall-table test` passes with every feature off, each on (`group-headers` among them), and all on; `just tall-table lint` passes. *Evidence (2026-11-16):* `just tall-table size --against d103b53` ([`perf/results/2026-11-16-m17-b-size.json`](perf/results/2026-11-16-m17-b-size.json)): the base 9809.1 KiB after wasm-opt in the working tree and at d103b53 (0 KiB apart); no `group-headers` symbols in the base (`seiza_tall_table6groups` 0, `seiza_tall_table5state6groups` 0), 16 and 10 in the feature's build. `just tall-table test` passes with every feature off, each on (`group-headers` among them), and all on (365 tests); `just tall-table lint` passes.
- [x] **B2. The groups drawn, natively:** in a window, with `group-headers` alone and with `pin`, `select`, `resize`, `sort`, `density`: the header's height at one, two, and three levels (and one row with no paths); each run's cell, its cut at the view's left and right and at `pin`'s edge, and its label's x scrolled half out; the blanks; the corner the header's height; a run split by `move_columns` and by `set_order` drawn as two cells; a run split at `pin`'s edge redrawn at a window resize, `set_pinned`, and a resize's release that move the edge (without `lay_out`); a group's tint under a `Columns` range and a `Cells` block over its columns; the arrows and bands on the bottom row, the hit tests of a cell, a header, and a band unchanged; `copy`'s header line the names alone. The fixture's drawing half passes, each control fails it, and every check mutated fails a test. *Evidence (2026-11-16):* `src/state/fixtures/groups.rs`'s window tests, with `group-headers` alone and all on: the header 1, 2, 3, and 4 rows tall at no paths and one to three levels, the body refitted a row a level (`the_header_grows_a_row_a_level`); cells cut at the view's left and right, labels at the visible part's left (`cells_are_cut_at_the_view_and_labeled_in_it`); the blanks (`blanks_draw_nothing`); the group cells reported as they move, a sideways scroll reporting no layout (`the_group_cells_are_reported_as_they_move`); the corner's press in every header row (`the_corner_is_the_headers_height`); a run split by `move_columns` and by `set_order` (`a_hosts_move_splits_a_run`); a split at `pin`'s edge redrawn at a window resize and `set_pinned` with no layout, and at a resize's release (`a_run_split_at_the_edge_follows_it`, `a_resize_release_moves_the_cut`); the tint under a `Columns` range and a `Cells` block, both halves of a split run (`a_group_takes_the_tint`, `both_halves_take_the_tint`); a names'-row press selecting its column and a cell's its cell; the arrows and bands pressed in the names' row only (`the_arrows_are_in_the_names_row`, `the_bands_are_in_the_names_row`); the preview's group rows cut to the column (`the_preview_carries_the_groups_rows`); `density`'s row height (`a_group_row_is_the_row_height`); `copy`'s header line the names alone (`the_header_line_is_the_names_alone`). The corner is the header's own background over the gutter, so it's the header's height by construction. `group_headers_fixture` passes, and its three controls each fail it. Fourteen mutations, each failing at least one test, but one: the pinned cell cut at the cells' width instead of the edge, which is equivalent (a pinned column never ends past the edge, which is clamped only to the cells' width).
- [x] **B3. The host builds it:** the bare host's `group-headers` feature forwards the table's and the bridge's, `?groups=` groups both shapes, and `just tall-table size` reports the build. *Evidence (2026-11-16):* the host's `group-headers` feature forwards the table's and the bridge's (the lint's wasm32 all-features clippy builds it); `?groups=` parsed and both shapes grouped by default, `?groups=0` none (`host.rs`'s `groups_parse_their_sizes`, `the_shapes_are_grouped`); `just tall-table size` reports the build: 9816.7 KiB after wasm-opt, +1.1 KiB brotli over the base (a check, not the cost: part D measures).
- [x] **C1. The presses and the moves, natively:** a press, a Shift+press, and a drag on a group's cell with `select` (each kind), with `reorder` (with and without `Columns` on), with `clicks` (each kind; a context press inside and outside the selection); a blank's press as its column's; a press in the corner's group rows as the corner's; a press on either half of a group split at `pin`'s edge as the whole run's; a column dragged within its group, held at the group's edges; a group dragged among its siblings and across `pin`'s edge; a group split at the edge lifted whole and landing on one side; a selected block that cuts a group not lifting. The fixture's drag half passes, each control fails it, and every rule mutated fails a test. *Evidence (2026-11-16):* `src/state/fixtures/groups.rs`'s window tests, all on and with each feature alone: a group's press selecting its columns at either level and nothing without `Columns` (`a_group_press_selects_its_columns`), a drag from it extending nothing (`a_drag_from_a_group_extends_nothing`), Shift to its far edge from the right, the left, and inside, under `Columns` and `Cells`, a `Rows` range kept (`shift_extends_to_the_groups_far_edge`), a blank as its column's header (`a_blank_is_its_columns_header`), either half of a split run selecting and reporting the whole run (`either_half_of_a_split_group_is_the_whole`, `either_half_reports_the_whole_run`), the corner's group rows the corner's (part B's `the_corner_is_the_headers_height`); `Group` targets for a press, a double press, and a context press (`a_group_is_reported_with_its_run`), and a context press inside a `Columns` range kept, partly outside or under `Cells` selecting the group (`a_context_press_keeps_a_range_holding_the_group`); a group moved among its siblings, held at its parent's end, a top group moved (`a_group_moves_among_its_siblings`), a column held in its group at both edges (`a_column_moves_only_within_its_group`), the selection moved with a lifted group (`the_selection_moves_with_a_lifted_group`), a selected block cutting a group not lifting and its press selecting its column alone, a range of whole groups lifting (`a_block_cutting_a_group_doesnt_lift`), a group pinned whole across the edge (`a_group_crosses_the_edge_whole`), a split group unpinned whole from its pinned half and a group pinned before it (`a_split_group_lands_whole`). A press before the next frame finds the groups a host's move made (`a_press_before_the_next_frame_finds_the_new_groups`). The drag half of `fixtures/group-headers.json` (15 cases, two from the code review: a sibling split at the edge, from each half) passes, `gap-outside-parent` and `gap-by-column-centers` each fail it, and `reorder.json` passes unchanged with every column its own sibling. Twenty rules mutated: seventeen failed a test at once. Of the three that survived, two now fail one: a group press starting a selection drag (its test had been built only without `reorder`, so the columns are made unmovable and it runs in every build) and `reorder`'s none with every column pinned (a new gap case). The third was dead code (`header_place_at` skipping group cells, which each caller had found first), and it's removed.
- [x] **C2. The random test and the soak:** the paths' stream and the two invariants, each control failing its invariant; `just tall-table soak` passes on the final build. *Evidence (2026-11-16):* `random.rs`: each case's paths from a stream of its own (`with_paths`, depth 0–3, runs of 1–8), header drags placed from another (`with_drags`), invariant 9 (each group cell drawn is a run of the drawn order, at frames and drags) and 10 (a drag never splits a run). `GroupsByPlace` fails the all-on run at 9 and `GapOutsideParent` at 10 (`controls::groups_by_place`, `controls::a_gap_outside_the_parent`). `just tall-table soak`, `group-headers` added to its features, passes on the final build: 500 cases at each of seeds 1–4 (66–69 s a seed). `just tall-table test` passes (382 tests all on) and `just tall-table lint` passes.
- [x] **C3. In the browsers:** `just tall-table smoke` with `group-headers` (and `group-headers,pin,select,reorder,clicks`), in both shapes, in Chromium, Firefox, and WebKit: the probe's group cells against the screens (`--screens save`), a group's press, its drag, and its published `Group` click (`level`, `start`, `end`). *Evidence (2026-11-16):* `perf/smoke.ts`'s group run (its header) passes on the final tree in Chromium, Firefox, and WebKit, in both shapes, for both builds. It checks 3 header rows, and the group cells published against the runs of the host's paths cut to the view: at open (8 cells narrow, 5 wide, `pin`'s run splitting `g1` and `g1.1`) and scrolled sideways. It checks them on screen too: each closed cell's border and each label's ink where the probe puts them, nothing else. A probe shifted 12 px failed it in every view. With `clicks`, each half of a split run reports the whole run (`target: "group"`, `level`, `start`, `end`). With nothing pinned, a press on `g1.2` selects its columns, and a Shift+press on `g1` extends to its far edge. `g1.2` dragged before `g1.1` gives the order, the source's cells, the groups whole, and the selection moved. The other features' runs pass at the default groups, `reorder`'s at `?groups=0` (`docs/DECISIONS.md`, "Features"). `just tall-table smoke --screens save` saved both builds' screens (`perf/results/raw/smoke-screens/`, gitignored), groups drawn as the spec has them.
- [ ] **D1. Its cost, in the host:** the added wasm (brotli 11, and after wasm-opt) against the base. The scroll and flings with `?groups=` against the same build without and the base, at the reference run, compared at the cells drawn (a taller header draws fewer rows). `reorder`'s drag segment with a group lifted.
- [ ] **D2. The README:** `group-headers`' use (`group`, the runs, the presses, moves kept whole), its Features row and cost, its row in "How it differs from `DataTable`", its limits (copy writes no group rows; a host's moves can split a group), and its canvas gap (groups aren't announced).
- [ ] **D3. Waiting apps told:** `group-headers` joins Tycho's "Ready so far" list. No other app has a row.

---

## Follow-ups to built features

### `custom-cells`

Built 2026-10-25 ([`docs/milestones.md`](docs/milestones.md), "M2 follow-up"); what's left:

**Later, as notes** (each adds without breaking; built when a host asks):

- **Stepped ramps** (`Ramp::stepped`, the nearest stop, no mix): bucketed heat maps, as Grafana's thresholds are. Not needed for categories: a category mapped to its stop's place (k / (n − 1)) lands on the stop already.
- **A bar-only column** (the text hidden, Excel's "Show Bar Only"): it widens the color-alone tradeoff (README, "Canvas tradeoffs"), since the number is no longer drawn, so the tooltip must show every hovered cell's exact value in it, not only a rounded or cut one, and the README says so.
- **Selection over paint:** settled in `select`'s research: a tint under the text, over the fill, bar, and flash ([`docs/DECISIONS.md`](docs/DECISIONS.md), "Features", 2026-10-26); built in M6.

### Rules in `CLAUDE.md` files that could be checks

Each through `/code-review` as code; once built, its sentence in the `CLAUDE.md` shrinks to a pointer.

- **The served build's gpui-kit** (`perf/CLAUDE.md`, "A build from another commit is labeled with this tree's gpui-kit"): the scripts record `versions` from the lockfile, so an A/B's results are hand-corrected. Shape: each script that writes results records gpui-kit from the served wasm (`shared-web/perf/`'s `wasmCrateVersion`, as the observatory's metric scripts do), and the gotcha goes.
- **Every length through `sizes()`** (`src/CLAUDE.md`, "Rules"): a row height, padding, or text size read from a constant skips `density`. Shape: a lint in `just tall-table lint` failing on a `px(<literal>)` length in `src/` outside `density.rs`, `column.rs`'s stand-in, and an allowlist.

---

## Next milestones

Specs drafted ahead, so a waiting app can read what's coming; each one's checks are tightened when it becomes active.

None: M17 (`group-headers`) is the last feature in the order. The next one comes from an app's ask, or from TanStack's candidates ("Beyond `DataTable`", above) once one is measured.

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
