# PLAN.md — tall-table

What's next for the tall table: its features to come, in order, the active milestone's "done when" checks, long-term goals, and open questions. Only what's still open lives here. It's the one list of the table's features: Tycho and the observatory adopt one as a milestone of their own and link here, and never restate the spec.

**Goal:** the interactions of gpui-kit's `DataTable` (resizing, selection and copy, sorting, …) on the tall table's f64-row scroll model, each a Cargo feature off by default, so a host pays only for what it turns on. Tycho adopts the full set; the observatory adds a feature level only for a feature both its sides build (`.claude/rules/comparison-protocol.md`).

**Where everything else lives:** what it offers today in [`README.md`](README.md); its rules and architecture in [`CLAUDE.md`](CLAUDE.md); finished milestones in [`docs/milestones.md`](docs/milestones.md); decisions in [`docs/DECISIONS.md`](docs/DECISIONS.md) (why this file exists: root [`docs/DECISIONS.md`](../../docs/DECISIONS.md), "Repo structure", 2026-10-23); surprises in [`docs/LESSONS.md`](docs/LESSONS.md); what it measures of itself in `perf/results/` (created with the first measurement).

---

## Where planning stands

Planned on 2026-10-23. Each decision, with its reasons, is in [`docs/DECISIONS.md`](docs/DECISIONS.md), "Features"; this file holds what follows from them: the [order](#order), the [bare host](#measuring-a-feature), M1 to M12 (built, in [`docs/milestones.md`](docs/milestones.md)), the hardening between M7 and M8 (done, in [`docs/milestones.md`](docs/milestones.md)), M10 (`density`, asked for by the observatory's wide sheet on 2026-10-30, built 2026-11-01), M11 (the flash's frames, built 2026-11-04: the cells' text drawn from one element a region on the base) and M12 (`format`, asked for by the observatory's market watch on 2026-11-04, built 2026-11-05), then M13 (`follow`'s `let_go`, asked for by the observatory's live tail on 2026-11-09, built the same day), then M14 (`copy`'s fixture, asked for by the observatory's wide sheet on 2026-11-12, built the same day), then M15 (`reorder`, built 2026-11-13), then M16 (`clicks`, drafted as `context-menu`, with Kirkwood's press folded in; opened 2026-11-16), `custom-cells`' [later notes](#follow-ups-to-built-features) (built when a host asks; its follow-ups built 2026-10-25), and research per feature (["Long-term goals"](#long-term-goals)). The Cargo names stay drafts until each feature's milestone.

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
| M16 | `clicks`: a press, a double press, and a context press reported | Active (part A done 2026-11-16) |
| M17 | `group-headers`: header rows over column groups | Planned |

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
| `group-headers` | Header rows spanning column groups | `group_headers`, `ColumnGroup` | `pin`, `reorder` (a group must move and pin whole) | No | Header groups |

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
| A press reported: `clicks`' `Press` (M16) | The host hears a press on a row or a cell whether or not the selection changed: today `Selected` is emitted only at a change, so a press on the row already selected says nothing. Kirkwood flies its camera to the pressed row's dot, and a second press on the same row should fly it there again | Kirkwood: a found row a pan let go, and its tour's rows | — (its spec: the `clicks` row under "Selection") | No | — |

### Who's waiting

Only this file builds the table's features, whichever app asks (root `CLAUDE.md`, "Docs: one home per fact"). An app that needs one keeps a row in its PLAN's "Waiting on" table; closing the feature's milestone flips that row to *Ready*. When an app asks for a new feature, it gets a row in the tables above (or "Asked for by the observatory's scenarios") and one here.

| Feature | Waiting | Their note |
|---|---|---|
| `follow` | Observatory: live tail | [`apps/observatory/PLAN.md`](../../apps/observatory/PLAN.md), "Waiting on" |
| `follow`'s `let_go` (M13, built) | Observatory: live tail's Pause button (its M11 part E2) | [`apps/observatory/PLAN.md`](../../apps/observatory/PLAN.md), "Waiting on" |
| `resize`, `select`, `copy` | Observatory: the wide sheet's later steps (a resize drag, a range copied; its M14, after its other scenarios) | [`apps/observatory/PLAN.md`](../../apps/observatory/PLAN.md), "Waiting on" |
| `clicks`' `Press` (M16; "Asked for by Kirkwood") | Kirkwood: the same row pressed again flies the camera back to it | [`apps/kirkwood/PLAN.md`](../../apps/kirkwood/PLAN.md), "Waiting on" |
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

### M16: `clicks`, a press, a double press, and a context press reported

**What it adds** (behind the `clicks` feature, off by default; drafted as `context-menu`): every press on the table's cells, row numbers, headers, corner, or blank reported with what it's on and where, whether or not the selection changed: a press, a double press, and a context press (the right button, a Mac browser's Ctrl+click, a touch's long press), for a host's menu, its detail view, or Kirkwood's camera. The table draws no menu. The research and the options weighed: root [`docs/research/tall-table-features.md`](../../docs/research/tall-table-features.md), "`clicks`"; the decisions: [`docs/DECISIONS.md`](docs/DECISIONS.md), "Features" (2026-11-16, M16 part A).

```rust
// click.rs, behind `clicks`.
pub enum ClickKind {
    /// A left press the table counts first ("The kinds", below).
    Press,
    /// A left press the table counts second; the first was a `Press`.
    Double,
    /// The right button's press, a touch's long press, or (when the host
    /// says Ctrl+press is one, `set_ctrl_press_is_context`) a left press
    /// with Ctrl.
    Context,
}

/// What a press is on. A column is its place (where it's drawn); with
/// `reorder`, `order()[place]` is its index.
pub enum ClickTarget {
    Cell { row: u64, column: usize },
    /// A row's number, in the gutter.
    Row(u64),
    /// A header cell.
    Column(usize),
    /// The header over the gutter.
    Corner,
    /// The header row or the body (gutter included) where none of the
    /// above is: below the last row, past the last column.
    Blank,
}

pub struct TallTableClick {
    pub kind: ClickKind,
    pub target: ClickTarget,
    /// The pointer, in window coordinates (a long press's start).
    pub position: Point<Pixels>,
    pub modifiers: Modifiers,
}

pub enum TallTableEvent {
    // …
    /// A press on the table, after what it did to the selection (`select`).
    #[cfg(feature = "clicks")]
    Clicked(TallTableClick),
}

impl<D: TallTableDelegate> TallTableState<D> {
    /// Whether a left press with Ctrl is a context press (off by default:
    /// a Mac browser's right-click, which a host in a Mac browser turns on;
    /// elsewhere Ctrl+click is the host's to give a meaning). Off, it's a
    /// `Press` whose modifiers say Ctrl, and `select` ignores it as today.
    #[cfg(feature = "clicks")]
    pub fn set_ctrl_press_is_context(&mut self, on: bool);
}
```

The spec below is what parts B and C build; why each rule is so is in [`docs/DECISIONS.md`](docs/DECISIONS.md), "Features", and the root's research.

- **The kinds** (part B), each on the press: `Context`, the right button's press, a `LongPressEvent` in `TouchPhase::Started` (at its `start_position`), or with `set_ctrl_press_is_context(true)` a left press with Ctrl, at any count. Every other left press is counted by the table, since gpui-pre-web's `click_count` counts presses of any button (a right press then a left one within 400 ms and 5 px is 2): a left press's count is the last left press's plus one when `click_count` is 2 or more and the last press the table saw was a left press it counted, otherwise 1. Count 1 is a `Press`, 2 a `Double`, 3 and after nothing. So a `Double` always follows a `Press`, and a left press after a context press is a `Press`. A Ctrl+left press, when it isn't a context press, is counted as any left press is.
- **The target** (part B): the hit test `select`'s `target_at` does today, moved where a build with `select` or `clicks` reaches it (the base unchanged), returning the target above; `Blank` for a point of the header row or the body (the gutter included) where `target_at` finds nothing: below the last row, past the last column. The scrollbars, the bands, and the arrows are no target: their left presses stop as today (the band's double press stays `resize`'s fit), and with `clicks` they stop a right press too and prevent a long press's default, so nothing is reported and a host's `ContextMenuExt` round the table doesn't open over them (it would read a stale target).
- **With `select`** (part B): a press and a double press select as today, and the event follows what the press did to the selection, so `selection()` in a host's handler is the press's result. The exception is `reorder`'s: a press inside the selected `Columns` range selects its column only at a release that didn't drag, so its `Press` comes with the range still selected and `Selected` follows at the release. A context press inside the selection keeps it (a `Cell` the range covers, whatever its kind; a `Row` under a `Rows` range; a `Column` under a `Columns` range; the `Corner` under any); elsewhere it selects its target as an unmodified press would (Shift doesn't extend, Cmd does nothing more), the corner's every-column select included, and no drag starts; `Blank` changes nothing; the event follows, so `selection()` is what a menu acts on.
- **Drags** (part B): a context press during `select`'s drag, `reorder`'s move, `resize`'s drag, or a scrollbar's does nothing (no event, nothing changed). In a browser this comes from a long press only: a second button pressed while the left is held arrives as a `pointermove` with its `buttons` changed, never a `pointerdown`, so the drag carries on (C1 checks it). A press that starts a drag is reported at its press.
- **Focus and the tooltip** (part B): a context press hides the tooltip and focuses the table, as a left press does; the table never stops a right press's propagation, so a host's `ContextMenuExt` round it opens after the table's handler.
- **Nothing drawn**, no frame asked for by the event itself (a selection's change redraws as today).
- **The bare host** (part B, so `size` measures it): the host's `clicks` feature forwarding the table's and the bridge's, and the bridge's arm (part C) publishing each `Clicked` (with `?perf`) on a global the host names (`__tallTableClick`: kind, target, row, column, x, y, and a running count, so a script sees a second press on the same row), so the event is used, not only compiled.
- **No fixture, no random test steps, no soak:** no DOM contender level (no scenario, TanStack has none), no paging touched (the research's last two sections).

**Split into parts,** one session each, in order. Each part ends with its notes in `perf/results/` (where it measures) and `docs/LESSONS.md`. The milestone closes after part D.

- **A. Research and spec** (no shipped code). *Done 2026-11-16,* revised the same day after a code review (the table's own count of left presses, since `click_count` counts every button; Ctrl+press a context press only when the host says so, as Ctrl+click means something else off a Mac; the scrollbars', bands', and arrows' right and long presses stopped; Shift ignored by a context press; `reorder`'s press inside a range, whose selection comes at the release; `Blank` pinned; a chorded right press in a browser being a move): the research in the root's `docs/research/tall-table-features.md`, "`clicks`"; four decisions in `docs/DECISIONS.md`, "Features"; a `docs/LESSONS.md` entry; the API above and the checks below. No spike (the research's "Frame-work risk").
- **B. The events, natively.** `click.rs`; the hit test moved; the three kinds and the table's count, `set_ctrl_press_is_context`, the scrollbars', bands', and arrows' right and long presses stopped, `select`'s rule, the drags, focus and the tooltip; the host's `clicks` feature; `clicks` in `perf/size.ts`'s `FEATURES` and the justfile's `test` runs; window tests. Checks B1–B3.
- **C. The bridge and the browsers.** The bridge's `Clicked` arm and the host's global; the smoke check's clicks runs (each kind and target in three browsers, Ctrl+click with the setting on and off, a long press where the browser can be driven to one, a right press during a left drag); whether a host's `ContextMenuExt` opens on a Mac browser's Ctrl+click, and if not, its line in `.claude/rules/gpui-web.md` after a look upstream. Check C1.
- **D. The measurement and the close.** The cost on the final build, then every remaining check and the close-out ("Closing a milestone", above). Checks D1–D3.

**Done when:**
- [x] **A1. The research and the spec:** the research in the root's `docs/research/tall-table-features.md`, "`clicks`"; its decisions in `docs/DECISIONS.md`; the API and the checks here. *Evidence (2026-11-16):* the research section (`DataTable`'s four click events and its delegate's menu in gpui-component 0.9.1; gpui-pre-web 0.3.12's right button, swallowed `contextmenu`, and `click_count`; gpui-pre 0.3.12's taps and 500 ms long press; `ContextMenuExt`'s order beside the table's handler and its Ctrl+click gap; the presses' kinds and targets; Sheets' rule for a context press); `docs/DECISIONS.md`, "Features" (2026-11-16, M16 part A, five entries).
- [ ] **B1. Off by default, the base unchanged:** `just tall-table size --against <M16's parent>` (the base after wasm-opt within 0.1 KiB, no `clicks` symbols in it, the `clicks` build's present; `select`'s build unchanged by the hit test's move, to 0.1 KiB). `just tall-table test` passes with every feature off, each on (`clicks` among them), and all on; `just tall-table lint` passes.
- [ ] **B2. The events, natively:** in a window (`simulate_event`), with `clicks` alone: a press, a double press, and a context press (right button; Ctrl+left with the setting on, at a count of 1 and 2) on a cell, a row's number, a header, the corner, and a blank (below the last row in the body and the gutter, past the last column in the body and the header) each report their kind and target, at the pointer, with the modifiers; a third press reports nothing; a right press then a left press at `click_count` 2 reports `Context` then `Press`; Ctrl+left with the setting off reports `Press` with Ctrl and, with `select`, selects nothing; a right press and a long press on a scrollbar (and with `resize`, a band; with `sort`, an arrow) report nothing and don't reach a listener round the table; a long press reports `Context` at its start; a press on a scrolled and a sideways-scrolled table reports the row and place under it; the right press reaches a listener round the table (not stopped) and focuses the table, hiding a tooltip shown. With `select`: a press on the selected row reports again with no `Selected`; a press's event comes after its `Selected`; a context press inside a `Cells`, `Rows`, and `Columns` range keeps it, outside each selects its target (no drag started: a pointer move after it moves nothing; with Shift, the same, not extended), on the corner with nothing selected selects every column, on a blank changes nothing; a context press mid-drag does nothing. With `resize` and `sort`: the band's double press fits and reports nothing, the arrow's press reports nothing. With `reorder`: a press that starts a move reports `Press` once; with `select`, a press inside the selected `Columns` range reports `Press` with the range still selected, then `Selected` with its column at a release that didn't drag; the target's column is the place with the order reversed. Each test fails under a mutation of what it covers.
- [ ] **B3. The host builds it:** the bare host's `clicks` feature forwards the table's and the bridge's; `just tall-table size` reports the `clicks` build.
- [ ] **C1. In the browsers:** `just tall-table smoke` with `clicks` (and `clicks,select,reorder`), in both shapes, in Chromium, Firefox, and WebKit: each kind on each target, the published click against the layout probe's cells; the same row pressed twice, two reports; a right press with no browser menu shown; Ctrl+click as `Context` with the setting on and a `Press` with it off; a right press during a left selection drag, nothing reported and the drag unbroken; with `select`, a right-click outside a range selecting its target and inside it keeping it; a long press where the browser can be driven to one (Chromium's touch emulation). Whether a `ContextMenuExt` round a GPUI element opens on a Mac browser's Ctrl+click, recorded.
- [ ] **D1. Its cost, in the host:** the added wasm (brotli 11, and after wasm-opt) against the base; the scroll and flings on the `clicks` build against the base's spread at the same place in the session, the reference run (the feature adds no per-frame work but its listeners: the research's "Frame-work risk"). On the final build. In `perf/results/` and the README's Features table.
- [ ] **D2. The README:** `clicks`' use (`Clicked`, its kinds and targets, places), a menu hung on `ContextMenuExt` round the table, Sheets' rule with `select`, what the bands and arrows keep; the pointer line's "`context-menu`'s, later" replaced; `set_ctrl_press_is_context` (a host in a Mac browser turns it on); limits (no key opens a menu; a Mac browser's Ctrl+click and `ContextMenuExt`, per C1); canvas tradeoffs (a menu's target not announced; touch's long press).
- [ ] **D3. Waiting apps told:** `clicks` joins Tycho's "Ready so far" list; Kirkwood's "Waiting on" row (a press reported) flips to *Ready* (the date and M16), its text naming `clicks`' `Press` (a double press's first press is a `Press`, so a second press within 400 ms is a `Double` Kirkwood can ignore). The observatory has no row.

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

M17's (`group-headers`) is written after its research, which opens it once M16 closes; until then its spec is its row under "Features".

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
