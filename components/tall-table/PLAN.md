# PLAN.md — tall-table

What's next for the tall table: its features to come, in order, the active milestone's "done when" checks, long-term goals, and open questions. Only what's still open lives here. It's the one list of the table's features: Tycho and the observatory adopt one as a milestone of their own and link here, and never restate the spec.

**Goal:** the interactions of gpui-kit's `DataTable` (resizing, selection and copy, sorting, …) on the tall table's f64-row scroll model, each a Cargo feature off by default, so a host pays only for what it turns on. Tycho adopts the full set; the observatory adds a feature level only for a feature both its sides build (root `CLAUDE.md`, "Comparison protocol").

**Where everything else lives:** what it offers today in [`README.md`](README.md); its rules and architecture in [`CLAUDE.md`](CLAUDE.md); finished milestones in [`docs/milestones.md`](docs/milestones.md); decisions in [`docs/DECISIONS.md`](docs/DECISIONS.md) (why this file exists: root [`docs/DECISIONS.md`](../../docs/DECISIONS.md), "Repo structure", 2026-10-23); surprises in [`docs/LESSONS.md`](docs/LESSONS.md); what it measures of itself in `perf/results/` (created with the first measurement).

---

## Where planning stands

Planned on 2026-10-23. Each decision, with its reasons, is in [`docs/DECISIONS.md`](docs/DECISIONS.md), "Features"; this file holds what follows from them: the [order](#order), the [bare host](#measuring-a-feature), M1 (built, in [`docs/milestones.md`](docs/milestones.md)) and [M2](#active-milestone), active, and research per feature (["Long-term goals"](#long-term-goals)). The Cargo names stay drafts until each feature's milestone.

---

## Status

| Milestone | Title | Status |
|---|---|---|
| M1 | The bare host and the base's baseline | Done 2026-10-23 ([`docs/milestones.md`](docs/milestones.md)) |
| M2 | `custom-cells`: a cell's fill, bar, and text color | Active: part A done 2026-10-24; part B (build, pin, measure, close) next |
| M3 | `live`: changed rows re-read and redrawn in place | Planned |
| M4 | `follow`: follow the tail as rows arrive | Planned |
| M5 | `resize`: drag a column's width | Planned |
| M6 | `select`: row, column, and cell selection | Planned |
| M7 | `copy`: a selection to the clipboard | Planned |
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

Why the table isn't `DataTable`: its `uniform_list` places rows in f32 pixels and breaks past ~16 M px (`docs/DECISIONS.md`, "Table and paging"). The cost was `DataTable`'s interactions. Every feature in these tables is `DataTable`'s, read from gpui-component 0.7.3's `src/table/` (the pin); the API it comes from is in each row. Feature names are drafts until each one's milestone.

**Columns:** *Depends on* is what must exist first. *Data* says whether the feature reaches the delegate (and so the engine's SQL), the costly kind for a table that never holds its rows. *TanStack* is the counterpart a feature level would build on the DOM side (TanStack Table's headless feature, which the contender doesn't load today), or "—" when there's none and the observatory would skip it.

### Columns

| Feature (Cargo) | What it adds | In `DataTable` | Depends on | Data | TanStack |
|---|---|---|---|---|---|
| `resize` | Drag a header edge to set a column's width, within a min and max; an event with the new widths, for a host to keep | `col_resizable`, `Column::resizable`, `min_width`/`max_width`, `ColumnWidthsChanged` | — (it adds the column-width model the rest build on) | No | Column sizing (`columnResizeMode`) |
| `pin` | Columns fixed at the left while the rest scroll sideways | `ColumnFixed::Left` (left only), `fixed_left` | `resize`'s width model | No | Column pinning (left and right) |
| `reorder` | Drag a header to move its column | `col_movable`, `MoveColumn` | `resize`'s width model | No | Column ordering (the drag is the app's) |
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

### Asked for by the observatory's scenarios

The observatory leads its comparison by scenarios, real uses (its [`docs/research/scenarios.md`](../../apps/observatory/docs/research/scenarios.md)), in this order: wide sheet, market watch, live tail, admin table, monitoring wall. Two of them need features neither `DataTable` nor TanStack Table has, both useful to Tycho too (a growing CSV, a refreshed query). Drafts, like the rows above:

| Feature (Cargo) | What it adds | Scenario | Depends on | Data | TanStack |
|---|---|---|---|---|---|
| `follow` | Follow the tail: the view stays on the last row while `set_rows` grows the source, and lets go when the reader scrolls up; a way back to it | Live tail | — | No (`set_rows` exists) | — (the contender's own, on its scroller) |
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

### M2: `custom-cells` (started 2026-10-24)

**What it adds** (behind the `custom-cells` feature, off by default): a page can answer a **paint** for each cell next to its value, and the table draws it. The paint is declarative (`docs/DECISIONS.md`, "Features"): data the table draws in its own cell, not a subtree a host builds per cell, so a DOM contender matches it from numbers a fixture can pin.

```rust
// The page (delegate.rs), behind `custom-cells`.
trait TallTablePage {
    fn value(&self, row: usize, column: usize) -> Option<CellValue<'_>>;
    #[cfg(feature = "custom-cells")]
    fn paint(&self, row: usize, column: usize) -> CellPaint { CellPaint::default() }
}

/// Each field 0..=1 (clamped). `None`, NaN, or a field whose column has no
/// ramp or bar draws nothing (the last a debug assertion: a host's mistake).
#[derive(Debug, Default, Clone, Copy, PartialEq)]
pub struct CellPaint {
    pub fill: Option<f32>, // through the column's fill ramp: the whole cell
    pub bar: Option<f32>,  // the bar's end across the cell's inner width, drawn from the column's zero
    pub text: Option<f32>, // through the column's text ramp: the value's color
}

// The column (column.rs), behind `custom-cells`: what turns them into pixels.
impl TallTableColumn {
    pub fn fill(self, ramp: Ramp) -> Self;
    pub fn bar(self, bar: Bar) -> Self;
    pub fn text_ramp(self, ramp: Ramp) -> Self;
}
/// A theme token, resolved each frame (a fixed color is `|_| hsla(…)`).
pub type Stop = fn(&ThemeColor) -> Hsla;
/// Two or more stops, evenly spaced over 0..=1, mixed in Oklab.
pub struct Ramp { /* stops */ }
/// `zero`: where the bar starts, 0..=1 of the inner width (0, the left edge, by default).
pub struct Bar { pub zero: f32, pub color: Stop }
```

- **What it covers:** the wide sheet's heat-map and data-bar cells, and the color of market watch's flash (a three-stop ramp: down, none, up). The flash's fade over time is `live`'s: `custom-cells` draws what a page answers, and redraws when a page changes.
- **What stays the table's:** the value's text, its rounding and cutting, and the tooltip (the exact value), unchanged; a placeholder or failed row paints nothing (only a loaded row asks its page); a theme switch recolors every paint on its frame, with no page read again.
- **What's the host's:** each column's ramps and bar, and the 0..1 values (a host maps each value through its column's range, read from its source, as the observatory would from SQL).
- **How it's drawn** (decided, `docs/DECISIONS.md`, "Features"): a fill and a bar both as quads, collected in the row loop and painted by one `canvas`, the cells layer's first child: each cell's fill, then its bar over it, all under the text. The research and the spike: root [`docs/research/tall-table-features.md`](../../docs/research/tall-table-features.md), "`custom-cells`"; [`perf/results/2026-10-24-m2-spike.md`](perf/results/2026-10-24-m2-spike.md).

**Split into parts (2026-10-24),** one session each, in order. The open points decided the trait's shape and how it's drawn, and settling the third needed both drawings built and compared; so part A settled them with a throwaway spike, and the API is reviewed before part B builds on it. Each part ends with its notes in `perf/results/` and `docs/LESSONS.md`. The milestone closes after part B.

- **A. Research and spike** (no shipped code). *Done 2026-10-24:* the three open points settled (a value and a ramp per column; a bar from a zero point; a fill and a bar both as quads, after the code review), the research in the root's `docs/research/tall-table-features.md`, two decisions in `docs/DECISIONS.md`, "Features", the A/B in `perf/results/2026-10-24-m2-spike.md`, a `docs/LESSONS.md` entry, the API above, the checks below. The spike's code is gone.
- **B. Build, pin, measure, close.** The feature in the table as above; `CellProbe`'s paint; the host's `custom-cells` feature with `?cells=text|heat|bars`; `perf.ts`'s cell styles; `fixtures/paint.json` and its native test and controls; the recipes the checks run: `test` with the feature off and on (`--features custom-cells`), `size` building the base and the feature's build, `smoke` at each cell style. Then the checks below, and the close-out ("Closing a milestone", above). A TS test of the fixture against the TanStack contender isn't part of it: the contender draws no paints until the observatory adopts the feature.

**Done when** (part B):
- [ ] **The feature is off by default** and the base's build is unchanged: the host's base wasm, built at the milestone's parent commit and at its head with the feature off, is the same size within 0.1 KiB brotli (not to the byte: panic sites keep their line numbers in the release build, and `cfg` code above one shifts them), and an unstripped build of it holds none of the feature's functions (a symbol check). `just tall-table test` passes with the feature off and on; `just tall-table lint` passes (its clippy runs with every feature).
- [ ] **The host uses it:** its `custom-cells` feature turns on the table's and maps each float column through its range at run time (`?cells=heat` fills, `?cells=bars` bars from zero, `?cells=text` neither), so the optimizer can't strip it. `just tall-table smoke` loads, fills, and scrolls with heat and with bars in Chromium, Firefox (WebGL2), and WebKit.
- [ ] **Its cost, in the host:** the added wasm (brotli 11) of the feature's build against the base's (`just tall-table size`); the wide shape's per-frame work in the steady scroll, the fling, and the sideways fling at `text`, `heat`, and `bars`, reference and throttled, cold, median of 10, on the final build, with the feature's build at `text` against the base (paint compiled in but unused costs nothing per frame, within spread). In `perf/results/` and the README's Features table.
- [ ] **A theme switch recolors without a read:** a native test switches the theme and the drawn cells' paint changes to the other theme's colors with no `load_page` call.
- [ ] **Scripts can read it:** with `probe_cells`, `CellProbe` carries each drawn cell's paint as drawn: the fill and text colors (8-bit RGBA) and the bar's left edge and width (CSS px, from the cell's left).
- [ ] **A fixture pins it** for a DOM contender, `fixtures/paint.json` (its format in `fixtures/README.md`): ramps as their stops' resolved colors in light and dark, bars as a zero and a cell width, and cases from each paint value to the colors and the bar's pixels drawn. A native test checks the table against it, allowing one 8-bit step per channel and one device pixel in a bar's edges (GPUI rounds x.5 down, the browser up); its controls must fail it: a color two steps off, a bar 2 device pixels off, and the same ramp mixed in sRGB instead of Oklab.
- [ ] **The jump highlight in a filled cell:** the spec puts it under a fill, which hides it there. Settled with a screenshot of a jump onto heat cells: kept under, or drawn over the cells; a change to the base's drawing logs a decision.
- [ ] **Canvas tradeoffs:** a heat or bar cell carries meaning in color alone, which a screen reader can't see either; the README says so.
- [ ] **Waiting apps told:** the observatory's "Waiting on" row and Tycho's note flip to *Ready* (the date and M2).

---

## Next milestones

Specs drafted ahead, so a waiting app can read what's coming; each one's checks are tightened when it becomes active. M3's (`live`) is written when M2 closes, after its research; until then its spec is its row under "Features".

---

## Long-term goals

### Research each feature's design before building it

Moved here from Tycho's `PLAN.md`, where it was a long-term goal while the table lived in Tycho. Planned on 2026-10-23 as research that opens each feature's milestone, not one study of them all. Every feature in the order is built; the research settles how, not whether. Its cost is measured as it's built ("Measuring a feature"). Each feature's research is recorded in the root's `docs/research/tall-table-features.md` (created with the first one), and covers what applies:

- **Reuse:** whether gpui-kit's column and selection pieces can sit on top of the row-based scroll model, or have to be rebuilt (before `resize` and `select`).
- **The delegate's calls**, for the features that reach it (`live`, `copy`, `sort`): what the table asks and how a source answers in pages. Sorting's above all: the table asks for rows by index, and a source that pages by row-group range (the DuckDB source's `file_row_number`) can't answer a sorted order that way. What a source does to answer (an `ORDER BY` over the whole file, a sorted copy) is the source's cost, measured by the engine; the table's design must not make it hold the whole result.
- **Frame-work risks:** what could cost per frame while scrolling (hit-testing, resize handles, selection state across 25 M rows), checked with a spike in the bare host when it's unclear.
- **Canvas gaps:** how selection and copy interact with the canvas tradeoffs (text selection, a11y) the README tracks.

---

## Open questions

- **Vertical cell borders** (`DataTable`'s `bordered`): the base draws row lines but no column lines. Nobody has asked; a wide sheet of heat cells may want them.
