# PLAN.md — tall-table

What's next for the tall table: its features to come, in order, the active milestone's "done when" checks, long-term goals, and open questions. Only what's still open lives here. It's the one list of the table's features: Tycho and the observatory adopt one as a milestone of their own and link here, and never restate the spec.

**Goal:** the interactions of gpui-kit's `DataTable` (resizing, selection and copy, sorting, …) on the tall table's f64-row scroll model, each a Cargo feature off by default, so a host pays only for what it turns on. Tycho adopts the full set; the observatory adds a feature level only for a feature both its sides build (root `CLAUDE.md`, "Comparison protocol").

**Where everything else lives:** what it offers today in [`README.md`](README.md); its rules and architecture in [`CLAUDE.md`](CLAUDE.md); finished milestones in [`docs/milestones.md`](docs/milestones.md); decisions in [`docs/DECISIONS.md`](docs/DECISIONS.md) (why this file exists: root [`docs/DECISIONS.md`](../../docs/DECISIONS.md), "Repo structure", 2026-10-23); surprises in [`docs/LESSONS.md`](docs/LESSONS.md); what it measures of itself in `perf/results/` (created with the first measurement).

---

## Where planning stands

Planned on 2026-10-23. Each decision, with its reasons, is in [`docs/DECISIONS.md`](docs/DECISIONS.md), "Features"; this file holds what follows from them: the [order](#order), the [bare host](#measuring-a-feature), M1 to M7 (built, in [`docs/milestones.md`](docs/milestones.md)), the hardening between M7 and M8 (done, in [`docs/milestones.md`](docs/milestones.md)), M8 (`sort`, active, its research, the sort, and its scripts built, [below](#active-milestone)), `custom-cells`' [later notes](#follow-ups-to-built-features) (built when a host asks; its follow-ups built 2026-10-25), and research per feature (["Long-term goals"](#long-term-goals)). The Cargo names stay drafts until each feature's milestone.

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
| M8 | `sort`: one column, ascending or descending | Active: parts A, B, and C done 2026-10-29; part D next |
| M9 | `pin`: columns fixed at the left | Planned |
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
- **Then Tycho's core:** `resize` first because `pin`, `reorder`, and `group-headers` build on its width model; `select` and `copy` next because copy closes a canvas tradeoff (README, "Canvas tradeoffs"), and they're the wide sheet's later steps; `sort` is the hardest: paging by row-group range stops working, and its research settles how the delegate reads pages in a sorted order.
- **The component's features come first, built in a run;** the apps adopt them after, each in a milestone of its own (decided 2026-10-23). A *Ready* row in an app's "Waiting on" table doesn't interrupt the run.
- **A feature can move up** when an app needs it sooner. The change goes here, with a decision, never in the app's PLAN.

---

## Active milestone

### M8: `sort`, one column, ascending or descending

**What it adds** (behind the `sort` feature, off by default): an arrow at the right of each header a host makes sortable; a click sorts the table by that column, its kind's first direction, then the other, then off. The table tells its source the order (`TallTableDelegate::sort`), which reads pages in it from then on or refuses; the table forgets its pages and reads the new order's from the top. One column at a time. The research and the options weighed: root [`docs/research/tall-table-features.md`](../../docs/research/tall-table-features.md), "`sort`"; the spike: [`perf/results/2026-10-29-m8-a-spike.md`](perf/results/2026-10-29-m8-a-spike.md); the decisions: [`docs/DECISIONS.md`](docs/DECISIONS.md), "Features" (2026-10-29, M8 part A, revised after its code review).

```rust
// sort.rs, behind `sort`.
/// Which way a column sorts.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SortDirection {
    Ascending,
    Descending,
}

/// The order the table reads its rows in: one column's values.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub struct Sort {
    /// The column's index among the columns the table was given, as
    /// `TallTablePage::value` reads it.
    pub column: usize,
    pub direction: SortDirection,
}

impl Sort {
    pub fn new(column: usize, direction: SortDirection) -> Self;
}

/// Why a source can't sort a column: for the host to show.
#[derive(Debug, Clone, PartialEq)]
#[non_exhaustive]
pub struct SortRefused {
    pub message: String,
}

impl SortRefused {
    pub fn new(message: impl Into<String>) -> Self;
}

/// The arrows as SVGs from the host's asset source, in place of the
/// glyphs (`↑`, `↓`, `↕`): gpui-kit's `IconName::SortAscending`,
/// `SortDescending`, and `ChevronsUpDown`'s paths, say, bundled by the host
/// (`icon_assets!`), or its own.
#[derive(Debug, Clone, PartialEq)]
#[non_exhaustive]
pub struct SortIcons {
    pub ascending: SharedString,
    pub descending: SharedString,
    pub unsorted: SharedString,
}

impl SortIcons {
    pub fn new(
        ascending: impl Into<SharedString>,
        descending: impl Into<SharedString>,
        unsorted: impl Into<SharedString>,
    ) -> Self;
}

// delegate.rs
pub trait TallTableDelegate: 'static {
    // …
    /// Reads in `sort`'s order from now on (`None`: the source's own), or
    /// refuses. Ascending or descending by the column's values, ties in the
    /// source's own order and NULLs last, both ways: a total order, so
    /// pages read apart join up. A source that needs to prepare (an index,
    /// a sorted copy) starts here and holds its reads until it's ready.
    /// Reads out when this is called are cancelled after it returns `Ok`;
    /// their answers are dropped, whichever order they hold. Called inside
    /// the table's update, as `load_page` is: nothing it starts may touch
    /// the table (or an entity being updated around it) before its first
    /// await. By default every sort is refused and going back to none
    /// accepted.
    #[cfg(feature = "sort")]
    fn sort(&mut self, sort: Option<Sort>, cx: &mut App) -> Result<(), SortRefused>;
}

// column.rs
impl TallTableColumn {
    /// Whether its header has an arrow to sort by it (`sort`): off unless
    /// set, since the source must be able to sort it.
    pub fn sortable(self, sortable: bool) -> Self;
}

// state.rs
impl<D: TallTableDelegate> TallTableState<D> {
    /// The order the rows are read in.
    pub fn sort(&self) -> Option<Sort>;
    /// Sorts by `sort` (`None`: the source's own order), as a click on its
    /// arrow does; the same sort again re-reads every row (a host whose rows
    /// moved within the order). The source's refusal is returned, and
    /// nothing changes; so is the table's own, for a column past the end or
    /// not sortable (and a debug assertion), and on a closed table, whose
    /// source is never told anything again.
    pub fn set_sort(
        &mut self,
        sort: Option<Sort>,
        cx: &mut Context<Self>,
    ) -> Result<(), SortRefused>;
    /// Draws the arrows from `icons` (`None`: the glyphs). Each path is
    /// loaded from the asset source once, here; if any doesn't load, the
    /// glyphs are drawn (and a debug assertion names it).
    pub fn set_sort_icons(&mut self, icons: Option<SortIcons>, cx: &mut Context<Self>);
}

pub enum TallTableEvent {
    // …
    /// The order changed, by a click or `set_sort`.
    #[cfg(feature = "sort")]
    Sorted(Option<Sort>),
    /// A click's sort the source refused; the order is as it was.
    #[cfg(feature = "sort")]
    SortRefused(Sort, SortRefused),
}

// probe.rs: `TallTableProbe::sort`, with `sort`.
```

The spec below is what part B builds; why each rule is so is in [`docs/DECISIONS.md`](docs/DECISIONS.md), "Features", and the root's research.

- **Sortable is the host's word:** a column is sortable only when the host says so (`sortable(true)`), as `DataTable`'s are, since only the host knows its source can sort it. A table whose columns don't say so draws, lays out, and hit-tests exactly as without the feature, so the fixtures pinned without `sort` hold in the all-on run unchanged.
- **The arrow:** every sortable column's header draws one at its right: `↕` at half the header's text color when the column isn't the sort (full while hovered), `↑` ascending, `↓` descending, as glyphs of the header's face, or the host's SVGs (`set_sort_icons`) in the same colors and states. Its box is one fixed width for every column and both kinds of arrow (the widest of the three glyphs' advances, at least the icon size), the arrow centered in it; a 4 px gap before it. The box and gap are counted in a sortable column's name estimate (`column_layout`) and in `resize`'s fit, so a sort, or icons set, changes no width. The name's text box ends at the gap, so a name wider than its room (a set width, a name that shapes wider than its estimate) is cut with "…" there, never drawn under the arrow; a numeric column's name stays right-aligned, against it. A column narrower than its padding, the gap, and the box draws no arrow and has no target. The target is the box with 4 px on each side, the header's height, ending where `resize`'s band begins; a press there sorts (on release inside it) and doesn't select (`select`'s press goes to the rest of the header). The pointer cursor over it.
- **The host's icons:** checked once when set, each path loaded through the asset source (`App::asset_source`); any that doesn't load, and the glyphs are drawn for all three (a debug assertion names it), so a typo or an icon the host forgot to bundle never leaves a blank target. GPUI's SVG renderer is already linked in every build, so icons cost the `svg()` element's code.
- **The cycle:** a text column ascending first, every other kind descending first, then the other direction, then off (`None`). A click on another column's arrow starts that column's cycle; the old column's arrow goes back to `↕`. No key.
- **What the source is told:** `sort` before anything else changes; refused, nothing changes (a click emits `SortRefused`, `set_sort` returns it). `set_sort` on a column past the end or not sortable tells the source nothing and returns the table's own refusal, naming the column (and a debug assertion), with no event.
- **What an accepted sort does:** every page forgotten, its read cancelled and draining as any cancelled read does (with `live`, re-reads and their invalidations too; with `live` and `custom-cells`, flashes cleared); the view at row 0, the sideways scroll kept (with `follow`, following lets go, unless every row fits); a `Rows` or `Cells` selection cleared (`Selected(None)`), a `Columns` one kept with its anchor's and head's rows moved to 0, the top, so the keys go on from the view and not from a row of the old order (`Selected` with it); the jump's highlight, hover, and the tooltip cleared; a copy running cancelled (`Failed(Cancelled)`); `Sorted` emitted; the new order's reads planned once the update ends (`live`'s and `copy`'s way). A read sent before the sort that answers after it is never stored, whatever it holds. Those reads drain and hold their places (`max_in_flight`) until they answer, as after a jump, so the new order's top page waits for them on a source that can't stop a read it started: a sort made while reads are out costs up to an old read more, which C2 measures and the README says.
- **`set_columns`** keeps the sort when the column at its index has the name it had and is sortable; otherwise it clears it as `set_sort(None)` would (the source told), before laying out. A `Sort` names a column by index, so a host that moves the sorted column (a column dropped before it, later `reorder`) calls `set_sort` with its new index. **`set_rows`** and **`invalidate_rows`** mean the sorted source's rows and positions, nothing more: a change that moves rows within the order is the host's to settle with `set_sort` (the same sort re-reads).
- **What's the host's:** which columns can be sorted (`sortable`), the source's order and its preparation, a refusal's message shown to the reader, the arrows' icons if it wants its own (`set_sort_icons`), and a menu that sorts (`set_sort`).
- **The bare host** (part B, so `size` measures it; its scripts part C): every column sortable; its source sorts from memory, a column's order (ascending, ties by row; descending, ties by row) computed at its first sort in that direction and kept while it's the last column sorted (every column's kept, a sort across the wide shape would pass wasm32's 4 GiB: revised after part B's code review), its reads then answered as before. `?sort-icons` draws gpui-kit's three sort icons, which it bundles (`icon_assets!`), so the `sort` build holds the icons' code whichever runs. `?sort=<column>,<asc|desc>` opens sorted (part C).
- **The bridge** (part C): `Sorted` published on a global the host names (`{column, direction}` or `null`) and as a mark (`tall-table:sorted`), and the probe's `sort`.
- **Fixtures:** `paging.json` gains a `sort` step (the source told, every page forgotten and its read cancelled, the view at the top, the top pages read) with a negative control (a sort that keeps the pages); `fixtures/sort.json` pins the cycle by kind and the order a source answers (values with NULLs and ties → their order, ascending and descending), run natively through the element and against the bare host's in-memory order, each with a negative control. A DOM contender's test names them skipped until the observatory builds a sort level.
- **The random test** gains a `sort` step (a column and direction, or none, its cases' columns drawn sortable or not, so a refused sort is a step too): its source answers under a new permutation and bumps every row's era, so invariants 5 and 7 cover the swap; two controls, a sort that keeps the cache's pages and one that forgets the loaded pages but leaves the reads out in their slots, each caught. A sort changes the paging: `just tall-table soak` before the code review (`CLAUDE.md`, rule 5).

**Split into parts,** one session each, in order. Each part ends with its notes in `perf/results/` (where it measures) and `docs/LESSONS.md`. The milestone closes after part D.

- **A. Research and spec** (no shipped code). *Done 2026-10-29,* revised the same day after a code review (and the host's icons added, the glyphs their fallback): the research in the root's `docs/research/tall-table-features.md`, "`sort`"; a spike of a source's sorted pages in native DuckDB (`perf/results/2026-10-29-m8-a-spike.md`); four decisions in `docs/DECISIONS.md`, "Features"; a `docs/LESSONS.md` entry; the API above and the checks below.
- **B. The sort.** *Done 2026-10-29,* with its code review's fixes (`perf/results/2026-10-29-m8-b.md`). `src/sort.rs` (the types), the delegate's `sort`, `TallTableColumn::sortable`, and `src/state/sort.rs` (the arrows drawn, glyphs or the host's icons, their target, the cycle, `set_sort` and what it does); the cache forgetting every page; the host's `sort` feature forwarding the table's and the bridge's, with its in-memory order, so `size` measures it; `sort` in `perf/size.ts`'s `FEATURES` and the justfile's `test` runs; the fixtures; the random test's step and controls; native tests; the soak. Checks B1–B3.
- **C. The bridge and the scripts.** *Done 2026-10-29,* with its code review's fixes (no results note: its runs were the scripts' trials; the numbers are part D's). The bridge's `Sorted` arm (`js::sort` on a global, the `tall-table:sorted` mark) and the probe's `sort`; each arrow's box in the layout probe (`ColumnProbe::arrow`), so a script finds it; the host's `?sort=`, its `?perf` hooks (`__tallTableSort(column, direction)`, `__tallTableSourceRow(row)` for ties, and `__tallTableExact`), its drawn cells (`?probe-cells`) and read counts with `sort`; the smoke check's sort runs; `perf.ts`'s sorted segments, and `perf/sort.ts` (`just tall-table sort`) for the click's latencies. Checks C1–C2.
- **D. The measurement and the close.** The cost on the final build, then every remaining check and the close-out ("Closing a milestone", above).

**Done when:**
- [x] **A1. The research and the spec:** the research in the root's `docs/research/tall-table-features.md`, "`sort`"; its decisions in `docs/DECISIONS.md`; the API and the checks here. *Evidence:* the research section; `docs/DECISIONS.md`, "Features" (2026-10-29, four entries); the spike's note, `perf/results/2026-10-29-m8-a-spike.md` (native DuckDB 1.4.5: OFFSET pages 48 ms at the top to 1,037 ms at 90% of the asteroids; an index over in-memory rows 145–173 ms to build, 7–43 ms a page; a sorted copy 1.1 s and ~35 MiB, then 1–2 ms a page; Gaia's index pages 2.3–2.4 s, its sorted copy past the memory budget).
- [x] **B1. Off by default, the base unchanged:** `just tall-table size --against <M8's parent>` (the base after wasm-opt within 0.1 KiB, no `sort` symbols in it, and the `sort` build's present; every other feature's build unchanged by `sort`'s code). `just tall-table test` passes with every feature off, each on (`sort` among them), and all on, the fixtures pinned without `sort` unchanged (their columns not sortable); `just tall-table lint` passes. *Evidence (2026-10-29):* [`perf/results/2026-10-29-m8-b.md`](perf/results/2026-10-29-m8-b.md): the base 9,680.1 KiB after wasm-opt against `6b6cb1b`'s 9,680.2 (−0.1), no `sort` symbols in it (3 and 12 in the `sort` build); every other feature's build within 0.1 KiB of the hardening's; `just tall-table test` (eleven runs) and `lint` pass.
- [x] **B2. Sorting, natively:** the cycle by kind (text: ascending, descending, off; a float, a date, a boolean: descending, ascending, off), another column's arrow starting its own; the arrows drawn in each state (`↕` dim and full while hovered, `↑`, `↓`), as glyphs and as the host's icons, and a column not made sortable drawing none and laid out as without the feature; icons with a path that doesn't load falling back to the glyphs; a press on the arrow sorts and selects nothing, a press beside it still selects the column (with `select`), the band still drags (with `resize`); a sortable column's width counting the box and gap, the same with glyphs or icons and unchanged by a sort, and the fit counting it; a name cut with "…" before the arrow at a narrow set width, and no arrow or target in a column too narrow for it. A delegate without `sort` refuses: the click emits `SortRefused`, nothing is read or cancelled, the arrow unchanged; `set_sort` returns the refusal, and the table's own for a column past the end or not sortable (no event, the source not told). An accepted sort: the source told first, every page forgotten and its reads cancelled (draining until they answer, and an old read's answer never stored), the view at the top, a `Rows` or `Cells` selection cleared and a `Columns` one kept with its rows at 0, the jump's highlight cleared, a copy cancelled, flashes cleared, following let go, `Sorted` emitted once, the new order's top pages read once the update ends; the same sort again re-reads; `set_columns` keeping the sort when the column at its index keeps its name and clearing it when it doesn't (the source told). `paging.json`'s sort scenario and `sort.json` pass, each control fails; the random test with its `sort` step passes and both its controls are caught; `just tall-table soak` passes on the final build. *Evidence (2026-10-29):* `src/state/fixtures/sort.rs`'s 21 tests (with every feature on; 13 with `sort` alone), `sort_fixture_cycle` and its `descending-first` control; the host's `sort_fixture_orders` and its `nulls-first` and `ties-reversed` controls, `a_columns_order_is_its_values_order`, `a_sorted_read_answers_in_the_order`; `paging.json`'s "a sort reads the new order from the top" and its `keep-pages` control; the random test's `Sort` step (weight 4: at 8 and at 3, other controls went uncaught in the 48 cases) with `a_sort_keeps_the_pages` and `a_sort_keeps_the_reads` caught at invariant 5, and all eighteen controls caught; `just tall-table test` (every run) and `just tall-table lint` pass; `just tall-table soak` passes on this build (seeds 1–4, 500 cases each, ~35 s a seed).
- [x] **B3. The host builds it:** the bare host's `sort` feature forwards the table's and the bridge's, every column sortable, its source sorting from memory; `just tall-table size` reports the `sort` build. *Evidence (2026-10-29):* `just tall-table size` reports the `sort` build: 9,755.6 KiB after wasm-opt, 2,706.4 KiB brotli, 16.7 KiB brotli more than the base ([`perf/results/2026-10-29-m8-b-size.json`](perf/results/2026-10-29-m8-b-size.json)).
- [x] **C1. In the browsers:** `just tall-table smoke` with `sort`, in both shapes, in Chromium, Firefox, and WebKit: a column's arrow clicked through its cycle, the published sort and the probe's agreeing, the arrow on screen in each state (the glyphs, and with `?sort-icons` the icons), and the visible rows read back in order against the host's exact values (non-decreasing ascending, non-increasing descending, ties by row, NULLs last), the view at the top; the source's order back at off; with `select`, the header beside the arrow still selecting the column. *Evidence (2026-10-29):* `just tall-table smoke` on a `sort,select` build passes in Chromium, Firefox, and WebKit (and on `sort` alone in Chromium): in each shape, with the glyphs and with `?sort-icons`, the narrow shape's `class` (ascending: `"AMO"` at the top, 27 ties in view, each by the source's row; descending: `"TNO"`; off: the values the top held before any sort) and `diameter` (descending from 99.99998…, ascending from 7.26e-15, a value at the top and at the end 28 NULL rows in view both ways, by row: asserted, so a NULLs-first order fails) and the wide shape's `c001` (descending from 0.0099999…, ascending from −0.0099999…), each step's published order and probe agreeing, the view at the top, the drawn cells the source's exact values; the arrow's box different dim, hovered, and each way, dim again at off, and different with the icons than with the glyphs; with `select`, a press beside the arrow selected the column and the arrow's selected nothing; and `?sort=5,desc` filled sorted at open.
- [x] **C2. The scripts measure it:** the perf script, on a `sort` build: in each shape, the click → the first frame with the new arrow (the table's own work) and → the first filled frame, the source's order computed beforehand (and with `?delay`, a source's time added); a sort made with the old order's reads held out (`?delay`), its top page waiting for them to drain; the scroll and flings with a column sorted against unsorted. Reference and throttled, cold, median of 10. *Evidence (2026-10-29, after the code review's fixes):* the scripts, run once each at the reference profile (the medians of 10, on the final build, are D1's): `just tall-table sort` (`perf/sort.ts`, its poll constant-time while a click is timed): narrow click → arrow 10.3 ms, → filled 29.4 ms with reads answered at once; with reads held 200 ms, → filled 222.3 ms with nothing out and 277.2 ms with three out (3 drained: the top page waited 55 ms); the wide shape 16.2, 40.7, 230.6, and 277.3 ms. `just tall-table perf` on a `sort` build and on `sort,select` adds `scroll-sorted`, `fling-sorted`, and (wide) `hfling-sorted` beside the unsorted segments (narrow scroll work p50 6.18 ms unsorted, 6.26 sorted; the select-all standing through the sort).
- [ ] **D1. Its cost, in the host:** the added wasm (brotli 11, and after wasm-opt) against the base; with `sort` built, unsorted and sorted, the scroll and flings within the spread of the base's; C2's latencies. On the final build. In `perf/results/` and the README's Features table.
- [ ] **D2. The README:** `sort`'s use (the arrow, the cycle, `set_sort`, the events, `sortable`), the delegate's contract (the order, ties and NULLs, positions, the refusal, a source's preparation behind its first reads, reads before the sort dropped), what a sort does (the top, the selection, a copy, `live` and `follow`), and its limits (one column; no key; a source's cost, from an index in memory to a refusal, with the research's numbers linked; a sort made while reads are out waiting for them; `set_rows` and `invalidate_rows` under a sort; a `Sort` naming its column by index across `set_columns`; an app's placeholder font needing the arrows); the host's icons and the glyphs' fallback; canvas tradeoffs: the sort not announced, the arrow not reachable by the keys.
- [ ] **D3. Waiting apps told:** `sort` joins Tycho's "Ready so far" list (the date and M8), its note saying that adopting it builds the DuckDB source's order (the research's options: an index for a CSV in memory, a sorted copy for a Parquet file within the memory budget, a refusal past it), measured against Tycho's budgets. The observatory has no row: it hasn't asked.

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

Specs drafted ahead, so a waiting app can read what's coming; each one's checks are tightened when it becomes active. M9's (`pin`) is written after its research, which opens it once M8 closes; until then its spec is its row under "Features".

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
