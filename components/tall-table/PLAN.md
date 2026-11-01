# PLAN.md — tall-table

What's next for the tall table: its features to come, in order, the active milestone's "done when" checks, long-term goals, and open questions. Only what's still open lives here. It's the one list of the table's features: Tycho and the observatory adopt one as a milestone of their own and link here, and never restate the spec.

**Goal:** the interactions of gpui-kit's `DataTable` (resizing, selection and copy, sorting, …) on the tall table's f64-row scroll model, each a Cargo feature off by default, so a host pays only for what it turns on. Tycho adopts the full set; the observatory adds a feature level only for a feature both its sides build (root `CLAUDE.md`, "Comparison protocol").

**Where everything else lives:** what it offers today in [`README.md`](README.md); its rules and architecture in [`CLAUDE.md`](CLAUDE.md); finished milestones in [`docs/milestones.md`](docs/milestones.md); decisions in [`docs/DECISIONS.md`](docs/DECISIONS.md) (why this file exists: root [`docs/DECISIONS.md`](../../docs/DECISIONS.md), "Repo structure", 2026-10-23); surprises in [`docs/LESSONS.md`](docs/LESSONS.md); what it measures of itself in `perf/results/` (created with the first measurement).

---

## Where planning stands

Planned on 2026-10-23. Each decision, with its reasons, is in [`docs/DECISIONS.md`](docs/DECISIONS.md), "Features"; this file holds what follows from them: the [order](#order), the [bare host](#measuring-a-feature), M1 to M9 (built, in [`docs/milestones.md`](docs/milestones.md)), the hardening between M7 and M8 (done, in [`docs/milestones.md`](docs/milestones.md)), M10 (`density`, asked for by the observatory's wide sheet on 2026-10-30, active: its research and spec done 2026-11-01, the feature built 2026-11-01 (part B), its scripts and browsers' checks 2026-11-01 (part C)), M11 (`reorder`), `custom-cells`' [later notes](#follow-ups-to-built-features) (built when a host asks; its follow-ups built 2026-10-25), and research per feature (["Long-term goals"](#long-term-goals)). The Cargo names stay drafts until each feature's milestone.

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
| M10 | `density`: a row height, a set column width, and a text size | Active: parts A, B, and C done 2026-11-01 |
| M11 | `reorder`: drag a column to move it | Planned |
| M12 | `context-menu`: right- and double-click events | Planned |
| M13 | `group-headers`: header rows over column groups | Planned |

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
| `density` | Three numbers a host sets: the row height, a column's width without `resize`'s drag, and the cells' text size (a shorter row with the same text clips its glyphs); the padding and paint fitting them; defaults unchanged. A feature of its own, the width shared with `resize`'s model (M10 part A; its spec under "Active milestone"). Asked for 2026-10-30 | Wide sheet (its denser stops: today ~310–340 cells are on screen at 120 px × 30 px) | — | No | Row height and column widths in CSS (column sizing's `size`, no resizing) |

What each scenario needs from the rows above: the wide sheet `custom-cells` (heat and bar cells), `density` (its denser stops), and `pin` (its key columns frozen), and later `resize` and `select`/`copy`; market watch `live` and `custom-cells` (a cell flashing when it changes); live tail `follow`; the admin table nothing past the base. So the wide sheet's need puts `custom-cells` first in the order below.

### Who's waiting

Only this file builds the table's features, whichever app asks (root `CLAUDE.md`, "Docs: one home per fact"). An app that needs one keeps a row in its PLAN's "Waiting on" table; closing the feature's milestone flips that row to *Ready*. When an app asks for a new feature, it gets a row in the tables above (or "Asked for by the observatory's scenarios") and one here.

| Feature | Waiting | Their note |
|---|---|---|
| `custom-cells` | Observatory: the wide sheet (heat and bar cells), then market watch (a cell flashing on change) | [`apps/observatory/PLAN.md`](../../apps/observatory/PLAN.md), "Waiting on" |
| `live` | Observatory: market watch | [`apps/observatory/PLAN.md`](../../apps/observatory/PLAN.md), "Waiting on" |
| `follow` | Observatory: live tail | [`apps/observatory/PLAN.md`](../../apps/observatory/PLAN.md), "Waiting on" |
| `density` | Observatory: the wide sheet's denser stops | [`apps/observatory/PLAN.md`](../../apps/observatory/PLAN.md), "Waiting on" |
| `pin` | Observatory: the wide sheet's key columns frozen | [`apps/observatory/PLAN.md`](../../apps/observatory/PLAN.md), "Waiting on" |
| `resize`, `select`, `copy` | Observatory: the wide sheet's later steps (a resize drag, a range copied) | [`apps/observatory/PLAN.md`](../../apps/observatory/PLAN.md), "Waiting on" |
| Every feature | Tycho adopts each one as it's ready | [`apps/tycho/PLAN.md`](../../apps/tycho/PLAN.md), "Waiting on" |

### Order

Decided 2026-10-23: `custom-cells` → `live` → `follow` → `resize` → `select` → `copy` → `sort` → `pin` → `reorder` → `context-menu` → `group-headers`. (`row-header` left the list: the base draws a row-number gutter already.) Since 2026-10-30, `density` goes after `pin`, ahead of `reorder` (below).

- **The scenarios' features first,** in the observatory's scenario order: the wide sheet (`custom-cells`), market watch (`live`, and `custom-cells` for its flash), live tail (`follow`). Each is small, none breaks the paging, and Tycho uses them too (a growing CSV, a refreshed query).
- **Then Tycho's core:** `resize` first because `reorder` and `group-headers` build on its width model (and it moves `pin`'s edge); `select` and `copy` next because copy closes a canvas tradeoff (README, "Canvas tradeoffs"), and they're the wide sheet's later steps; `sort` is the hardest: paging by row-group range stops working, and its research settles how the delegate reads pages in a sorted order.
- **The component's features come first, built in a run;** the apps adopt them after, each in a milestone of its own (decided 2026-10-23). A *Ready* row in an app's "Waiting on" table doesn't interrupt the run.
- **A feature can move up** when an app needs it sooner. The change goes here, with a decision, never in the app's PLAN.
- **`density` moved up (2026-10-30)** ahead of `reorder`: the observatory's next scenario, the wide sheet, waits on it, and the rest of the run (`reorder`, `context-menu`, `group-headers`) has no app waiting ([`docs/DECISIONS.md`](docs/DECISIONS.md), "Features").

---

## Active milestone

### M10: `density`, a row height, a text size, and a set column width

**What it adds** (behind the `density` feature, off by default): a row height and a text size a host sets together, the table's other lengths following them, and a column's width set without `resize`. The research and the options weighed: root [`docs/research/tall-table-features.md`](../../docs/research/tall-table-features.md), "`density`"; the decisions: [`docs/DECISIONS.md`](docs/DECISIONS.md), "Features" (2026-11-01, M10 part A); the spike: [`perf/results/2026-11-01-m10-a-spike.md`](perf/results/2026-11-01-m10-a-spike.md).

```rust
// density.rs, behind `density`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Density {
    /// The body's rows and the header: 30 px by default.
    pub row_height: Pixels,
    /// The cells' and the header's text: `rems(0.875)` by default.
    pub text_size: AbsoluteLength,
}
impl Default for Density { /* 30 px, rems(0.875): the base's */ }

// state.rs, behind `density`.
impl<D: TallTableDelegate> TallTableState<D> {
    /// Sets the row height and the text size; the font is read again at the
    /// size and the columns laid out at the next frame. The top row stays
    /// (while following, the tail), as on a resize.
    pub fn set_density(&mut self, density: Density, cx: &mut Context<Self>);
    /// What the host set (the layout probe's `row_height` is what's drawn).
    pub fn density(&self) -> Density;
}

// column.rs: `TallTableColumn::width` behind `any(resize, density)`;
// `min_width`, `max_width`, `resizable` stay `resize`'s.
```

The spec below is what part B builds; why each rule is so is in [`docs/DECISIONS.md`](docs/DECISIONS.md), "Features", and the root's research.

- **The clamp:** where the font is read (render, where the rem size is known), the text size is at least 6 px and the row height at least the text size; the row in effect is what every site reads and what the layout probe reports. Nothing clamps further: a row the height of its text clips descenders.
- **What follows the row height** (in effect): the viewport's rows (recomputed by `set_density` itself, through a step factored out of `set_body`, which returns early when the body's bounds haven't moved; the top row kept, or the tail while following, as a resize keeps them), a wheel's line delta, `follow`'s test of whether a move is more vertical than sideways (`scroll_by`), every y → row hit test (`hover_at`, `cell_at`, `select`'s `target_at` and `cell_clamped`), the header's height, the gutter's rows, the cells' line height, the jump's tint and edge, `select`'s tint and active cell, `sort`'s arrow box, `resize`'s bands, and `custom-cells`' bar inset (`round(row / 5)`: 6 at 30).
- **What follows the text size,** rounded to whole px, by a scale that's the text size over the default's in its own unit (a `px` text over 14 px, a `rems` text over 0.875 rem), so `Density::default()` is a scale of 1 at any rem and a `px` density lays out the same at any rem: the cells' padding a side (`round(8 × scale)`), each kind's width, the header name's and gutter's estimates (`round((7.5 × characters + 24) × scale)`, rounded once on the total), a column's least width unless set (`round(40 × scale)`, so a float still shows two characters), and, read from the font at the size, `number_px`, an integer column's fit, a float's budget, `sort`'s arrow room, `resize`'s fit, and the tooltip's test of whether a cell is cut (`text_width` against the width less the scaled padding). The header's text follows the cells'. A set width and the tooltip's own text follow neither.
- **A set width without `resize`:** `TallTableColumn::width` clamped to the scaled least (40 px at the default) and 1200 px, no event. With `resize`, unchanged, but for the least unless a column sets its own, which scales.
- **The base unchanged:** each site reads through one stand-in whose methods return the base's constants without the feature (as `pin`'s `Place`); with the feature on at `Density::default()` every length is the base's, so every fixture pinned without it passes unchanged.
- **What's the host's:** the numbers (the observatory's stops, Tycho's compact view and its menu), widths kept across queries, and saying that a `px` density doesn't follow a page zoom.
- **The bare host** (part B, so `size` measures it; its scripts part C): `?density=<row>,<text>[,<width>]`, the width set on every float column; by default with the feature, 18,11,56 (the spike's dense setting); `?density=30,14` the control (the feature built at the base's numbers, the kind widths kept), splitting the code's cost from the drawing's. With `?perf`, `__tallTableDensity(row, text)` (the table's `set_density`, through GPUI's foreground executor).
- **The bridge:** nothing new (the layout probe's `row_height` and the columns' widths are there); part C checks they report the row in effect and the set widths.
- **Fixtures:** `fixtures/density.json`: cases of a row height, a text size, a view's height, and columns (kinds, or set widths) → the rows in view, the header's height, the padding, each column's width and budget, and the bar inset; `number_px` at each case's size pinned from the bare host in Chromium (provisional in part B, from the font natively; part C pins them from Chromium and re-runs B2's fixture checks against them). Run natively against the table's own functions, with cases at a rem size other than 16 (the default laid out as the base, and a `px` density laid out as at 16) and at a large text (a set width at the least showing two characters), and negative controls (`row-unclamped`, `padding-fixed`, `width-scaled`, `inset-fixed`, `scale-over-default-at-rem`, `scale-over-14-for-rems`, `name-rounded-per-character`, `least-fixed`), each failing. A DOM contender's test names it skipped until the observatory builds a level with `density`. The fixtures pinned without `density` unchanged in the all-on run (`Density::default()`).
- **The random test** gains a `density` step (a few row and text pairs, the default among them), placed from each case's scheduler seed; no invariant or control. It feeds the paging a new input (the viewport's rows), so **the soak runs** on part B's final build (`CLAUDE.md`, rule 5).
- **The scripts** (part C): `perf.ts --density <row>,<text>[,<width>]` (the host's param) and, in every segment, the presented frames (the recorder's, a second) beside the late share, which reads rAF intervals and read 0% while GPUI drew on every other rAF (the spike); read against the base's in the same segment, since the base presents on only ~85% of rAFs while keeping up; the throttled segments' waits follow the frame time, or a segment not reached is reported as such, never a failure of the run.

**Split into parts,** one session each, in order. Each part ends with its notes in `perf/results/` (where it measures) and `docs/LESSONS.md`. The milestone closes after part D.

- **A. Research and spec** (no shipped code). *Done 2026-11-01:* the research in the root's `docs/research/tall-table-features.md`, "`density`"; six decisions in `docs/DECISIONS.md`, "Features"; the spike's note; a `docs/LESSONS.md` entry; the API above and the checks below.
- **B. The density.** *Done 2026-11-01* (B1–B3). Three decisions came of it ([`docs/DECISIONS.md`](docs/DECISIONS.md), "Features", M10 part B): at a scale of 1 the base's lengths stay unrounded; the padding is drawn in px, so at a rem other than 16 the default draws 2 px narrower a side than the base's `px_2`; `sort`'s arrow box scales with the text. `Density` and `set_density`, the clamp, the stand-in and every site through it, the derived lengths, `width` out from behind `resize`; the host's `density` feature forwarding the table's, with `?density=`, so `size` measures it; `density` in `perf/size.ts`'s `FEATURES` and the justfile's `test` runs; the fixture (its `number_px` provisional until part C pins it); the random test's step; native tests; the soak. Checks B1–B3.
- **C. The scripts and the browsers.** *Done 2026-11-01* (C1–C2). Three decisions came of it ([`docs/DECISIONS.md`](docs/DECISIONS.md), "Features", M10 part C): `number_px` read from the layout probe's integer column; `perf.ts`'s rests wait for a quiet spell and follow the frames (the spike's timeout was queued wheels, not the fling); the control compared with the base build's own saved screen. The host's `?perf` hook; `perf.ts`'s `--density` and presented frames, its waits; the smoke check's density runs; `density.json`'s `number_px` pinned from Chromium. Checks C1–C2.
- **D. The measurement and the close.** The cost on the final build at the control and at a few dense settings (the cells against frame work and the presented frames, against the base's), then every remaining check and the close-out ("Closing a milestone", above).

**Done when:**
- [x] **A1. The research and the spec:** the research in the root's `docs/research/tall-table-features.md`, "`density`"; its decisions in `docs/DECISIONS.md`; the API and the checks here. *Evidence:* the research section (`DataTable`'s sizes and TanStack's column sizing read; a feature chosen over a base setting; two numbers set together and a width, no presets; what follows each; the clamp; the spike); `docs/DECISIONS.md`, "Features" (2026-11-01, M10 part A, six entries); [`perf/results/2026-11-01-m10-a-spike.md`](perf/results/2026-11-01-m10-a-spike.md).
- [x] **B1. Off by default, the base unchanged:** *Evidence (2026-11-01, after the code review's fixes):* `just tall-table size --against 5ffe22a --label m10-b-against` ([`perf/results/2026-11-01-m10-b-against.json`](perf/results/2026-11-01-m10-b-against.json)): the base at M10's parent and in the working tree 9640.5 KiB after wasm-opt both, 0 KiB apart (brotli −1 KiB, recorded, not gated). Before it, `just tall-table size --label m10-b-size` ([`perf/results/2026-11-01-m10-b-size.json`](perf/results/2026-11-01-m10-b-size.json)) against the last recorded sizes ([`perf/results/2026-11-01-trim-paths-size.json`](perf/results/2026-11-01-trim-paths-size.json), M10's parent's base): the base 9640.5 KiB after wasm-opt, unchanged; no `density` symbols in it (`seiza_tall_table7density` and `5state7density`: base 0, `density` 4 and 4); every other feature's build within 0.1 KiB after wasm-opt (`follow`, `resize`, `sort` +0.1, the rest equal); the `density` build +1.1 KiB brotli (+2.9 after wasm-opt); no home paths. `just tall-table test` passes (every feature off, each on, `density` among them, and all on, `density` in it); `just tall-table lint` passes; `just tall-table soak` passes on this build (4 seeds × 500 cases). The soak runs again only if a later fix touches the paging.
- [x] **B2. Density, natively:** `density.json` passes and each control fails. In a window: `set_density` keeps the top row and changes the rows in view (and so the pages wanted), also with the header's height held (bounds unchanged); while following, keeps the tail; with `follow`, a move's direction weighed at the row in effect (a mostly sideways move at a short row leaving following as it is); the header, the gutter, a cell's hit test, hover and the tooltip (in the theme's size) at a short row, the tooltip opening for a cut value and not for one shown whole at a small and a large text; the clamp (a row under the text drawn at the text, `density()` as set, the probe's `row_height` in effect; a text under 6 px at 6); `Density::default()` laying out every column, padding, and the bar inset as without the feature, at the web's rem and at another; a set width without `resize` clamped (its least scaled) and not scaled by the text, with `resize` dragged and fitted as before (the fit at the text's size); `sort`'s arrow and `select`'s tint at a short row. *Evidence (2026-11-01):* `src/state/fixtures/density.rs`: `density_fixture`, `density_controls_fail` (all 8 fail), `density_fixture_number_px_is_provisional`; `set_density_keeps_the_top_row_and_changes_the_rows_in_view` (fitted before a frame with the bounds unchanged, top 5000 kept, page 5 read once in view), `following_keeps_the_tail_and_weighs_a_move_at_the_row`, `a_short_row_draws_and_hits_at_its_height`, `the_tooltip_tests_a_cut_at_the_scaled_padding` (8 px and 24 px), `the_clamp`, `the_default_is_the_base_at_any_rem` (16 and 20 px), `a_set_width_is_clamped_and_not_scaled`, `a_new_text_lays_out_once_by_its_font`, `a_new_rem_fits_the_rows_in_its_frame` (both after the code review), `resize_drags_and_fits_at_the_text`, `sort_arrows_at_a_short_row`, `the_tint_at_a_short_row`; every fixture pinned without `density` passing in the all-on run (one `sort` test's expected header padding is the px the feature draws, the decision above).
- [x] **B3. The host builds it:** the bare host's `density` feature forwards the table's, `?density=` setting it at run time; `just tall-table size` reports the `density` build with its markers. *Evidence (2026-11-01):* `host/crate`'s `density` feature (forwarding the table's and the bridge's), `host.rs`'s `Density` (`?density=`, by default 18,11,56; `the_density_param_parses`); `perf/size.ts`'s `FEATURES` gains `density`, and `size` reports its build with its markers ([`perf/results/2026-11-01-m10-b-size.json`](perf/results/2026-11-01-m10-b-size.json)).
- [x] **C1. In the browsers:** `just tall-table smoke` with `density`, in both shapes, in Chromium, Firefox, and WebKit: at the dense default the layout probe's `row_height` and widths are what was set, the drawn rows' tops and the cells' lefts agree with it, the text inside its row; `?density=30,14` screens the same as the base; `__tallTableDensity` changing it at run time keeping the top row; with `select`, `resize`, `sort`, and `pin`, a press, a band, an arrow, and the pin's edge at the dense setting. `density.json`'s `number_px` pinned from Chromium and the native run passing with it. *Evidence (2026-11-01,* [`perf/results/2026-11-01-m10-c.md`](perf/results/2026-11-01-m10-c.md)*):* `just tall-table smoke` passes in the three browsers on the base (its first screens saved, byte-identical across two runs, each beside the commit and source changes it was drawn from, and refused from another tree), on `density` (at the default: rows 18 px and floats 56 px in the probe, the stripes and borders at 18 px, the ink inside its row and its cell's 6 px padding in all 11 narrow columns and 23 wide, from a rest at row 40, the top kept through `__tallTableDensity(30, 14)` and back; at `?density=30,14` the base's first screen pixel for pixel in every browser and shape), and on `density,select,resize,sort,pin` (every feature's checks at the dense default: a float dragged 56 → 136 px, a fit, the least 31 px at 11 px text; the selection's presses, drag, keys, and tint; the arrows through their cycles; the pin's edge, held pixels, thumb, and band, the narrow shape at 912 px wide for a sideways scroll). Its negative control (a padding 2 px wider, rows sampled at 30 px) fails. `just tall-table density-fixture --check` passes: `number_px` 0.6 em at all six sizes, the values part B wrote; `density_fixture`, its controls, and `density_fixture_number_px_is_the_test_apps` pass, with `density` and all on. `just tall-table lint` passes. All of it re-run after the code review's fixes.
- [x] **C2. The scripts measure it:** `perf.ts` on a `density` build at the dense default and at `--density 30,14`, every segment with its presented frames; the throttled segments reported (reached or not), not failing the run. Reference and throttled, cold, run once each (the medians are D1's). *Evidence (2026-11-01):* [`perf/results/2026-11-01-m10-c-perf-dense.json`](perf/results/2026-11-01-m10-c-perf-dense.json) and [`-control.json`](perf/results/2026-11-01-m10-c-perf-control.json), every segment of both shapes and profiles reached (the throttled dense wide fling included), no failures; each segment with its presented frames a second and as a share of rAFs beside the late share (the dense wide scroll, reference: 0% late, 30 frames a second on 50% of rAFs; the control's 59 on 98%), each reading ending 300 ms after the segment's last presented frame (after the code review: the first runs counted the rest's quiet spell); the table in [`perf/results/2026-11-01-m10-c.md`](perf/results/2026-11-01-m10-c.md).
- [ ] **D1. Its cost, in the host:** the added wasm (brotli 11, and after wasm-opt) against the base; the scroll and flings at `--density 30,14` against the base's spread at the same place in the session (the code's cost), and in the wide shape at a few dense settings (the cells on screen against frame work and the presented frames against the base's: where between ~340 and ~1,130 cells the reference run loses the display's rate, the curve the observatory's dial reads), reference and throttled, median of 10. On the final build. In `perf/results/` and the README's Features table.
- [ ] **D2. The README:** `density`'s use (`Density`, `set_density`, `density()`, `TallTableColumn::width` without `resize`), what follows each number and what doesn't (a set width, the tooltip), the clamp; its limits (no header height of its own; no presets; the cost grows with the cells, and where the reference run stops holding the display's rate, from D1); canvas tradeoffs: a `px` density doesn't follow a page zoom.
- [ ] **D3. Waiting apps told:** the observatory's "Waiting on" row for `density` flipped to *Ready* (the date and tall-table M10); `density` joins Tycho's "Ready so far" list.

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

M11's (`reorder`) is written after its research, which opens it once M10 closes; until then its spec is its row under "Features".

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
- **Cheaper cells for every density:** frame work grows about in a straight line with the cells on screen, and a dense wide sheet falls behind the display at the reference run (M10 part A's spike, [`perf/results/2026-11-01-m10-a-spike.md`](perf/results/2026-11-01-m10-a-spike.md)). Each cell is a `div` with its shaped line; the cells' text drawn by one element per layer (as `custom-cells`' quads are by one canvas) might cut the per-cell part for every host. Worth a spike once M10's part D has found where the rate is lost, and before an app needs more cells than that.
- **Vertical cell borders** (`DataTable`'s `bordered`): the base draws row lines but no column lines. Nobody has asked; a wide sheet of heat cells may want them.
