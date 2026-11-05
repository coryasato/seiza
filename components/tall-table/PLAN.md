# PLAN.md — tall-table

What's next for the tall table: its features to come, in order, the active milestone's "done when" checks, long-term goals, and open questions. Only what's still open lives here. It's the one list of the table's features: Tycho and the observatory adopt one as a milestone of their own and link here, and never restate the spec.

**Goal:** the interactions of gpui-kit's `DataTable` (resizing, selection and copy, sorting, …) on the tall table's f64-row scroll model, each a Cargo feature off by default, so a host pays only for what it turns on. Tycho adopts the full set; the observatory adds a feature level only for a feature both its sides build (root `CLAUDE.md`, "Comparison protocol").

**Where everything else lives:** what it offers today in [`README.md`](README.md); its rules and architecture in [`CLAUDE.md`](CLAUDE.md); finished milestones in [`docs/milestones.md`](docs/milestones.md); decisions in [`docs/DECISIONS.md`](docs/DECISIONS.md) (why this file exists: root [`docs/DECISIONS.md`](../../docs/DECISIONS.md), "Repo structure", 2026-10-23); surprises in [`docs/LESSONS.md`](docs/LESSONS.md); what it measures of itself in `perf/results/` (created with the first measurement).

---

## Where planning stands

Planned on 2026-10-23. Each decision, with its reasons, is in [`docs/DECISIONS.md`](docs/DECISIONS.md), "Features"; this file holds what follows from them: the [order](#order), the [bare host](#measuring-a-feature), M1 to M10 (built, in [`docs/milestones.md`](docs/milestones.md)), the hardening between M7 and M8 (done, in [`docs/milestones.md`](docs/milestones.md)), M10 (`density`, asked for by the observatory's wide sheet on 2026-10-30, built 2026-11-01), M11 (the flash's frames, built 2026-11-04: the cells' text drawn from one element a region on the base) and M12 (`format`), asked for by the observatory's market watch on 2026-11-04, then M13 (`reorder`), `custom-cells`' [later notes](#follow-ups-to-built-features) (built when a host asks; its follow-ups built 2026-10-25), and research per feature (["Long-term goals"](#long-term-goals)). The Cargo names stay drafts until each feature's milestone.

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
| M12 | `format`: a number column's shown text set by its host | Active: part A done 2026-11-04 (research and spec); part B done 2026-11-04 (the format, natively) |
| M13 | `reorder`: drag a column to move it | Planned |
| M14 | `context-menu`: right- and double-click events | Planned |
| M15 | `group-headers`: header rows over column groups | Planned |

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
| `format` | A number column's shown text set by its host: fixed decimals (`84.21`, `9.420`), a sign on a positive (`+0.37`), a suffix (`%`), thousands grouping (`4,400,000`); the value's exact text stays the tooltip's and the copy's. Defaults unchanged (today's exact text and `fit_float`). Asked for 2026-11-04 by market watch (tall-table M12; the observatory's M10, which follows its design canvas's text); its research done 2026-11-04 (M12 part A; its spec under "Active milestone") | Market watch | — | No | The contender's formatter (`format.ts`), pinned by `cells.json`'s new cases |

What each scenario needs from the rows above: the wide sheet `custom-cells` (heat and bar cells), `density` (its denser stops), and `pin` (its key columns frozen), and later `resize` and `select`/`copy`; market watch `live` and `custom-cells` (a cell flashing when it changes) and `format` (its prices, changes, and volumes as its design draws them); live tail `follow`; the admin table nothing past the base. So the wide sheet's need puts `custom-cells` first in the order below.

### Who's waiting

Only this file builds the table's features, whichever app asks (root `CLAUDE.md`, "Docs: one home per fact"). An app that needs one keeps a row in its PLAN's "Waiting on" table; closing the feature's milestone flips that row to *Ready*. When an app asks for a new feature, it gets a row in the tables above (or "Asked for by the observatory's scenarios") and one here.

| Feature | Waiting | Their note |
|---|---|---|
| `custom-cells` | Observatory: the wide sheet (heat and bar cells), then market watch (a cell flashing on change) | [`apps/observatory/PLAN.md`](../../apps/observatory/PLAN.md), "Waiting on" |
| `live` | Observatory: market watch | [`apps/observatory/PLAN.md`](../../apps/observatory/PLAN.md), "Waiting on" |
| `follow` | Observatory: live tail | [`apps/observatory/PLAN.md`](../../apps/observatory/PLAN.md), "Waiting on" |
| `density` | Observatory: the wide sheet's denser stops | [`apps/observatory/PLAN.md`](../../apps/observatory/PLAN.md), "Waiting on" |
| `pin` | Observatory: the wide sheet's key columns frozen | [`apps/observatory/PLAN.md`](../../apps/observatory/PLAN.md), "Waiting on" |
| `resize`, `select`, `copy` | Observatory: the wide sheet's later steps (a resize drag, a range copied; its M14, after its other scenarios) | [`apps/observatory/PLAN.md`](../../apps/observatory/PLAN.md), "Waiting on" |
| `format` | Observatory: market watch's prices, changes, and volumes (its M10 part B) | [`apps/observatory/PLAN.md`](../../apps/observatory/PLAN.md), "Waiting on" |
| The flash's frames (M11: the cells' text from one element, on the base, so every host's build) | Observatory: market watch, before its part B (its M10) | [`apps/observatory/PLAN.md`](../../apps/observatory/PLAN.md), "Waiting on" |
| Every feature | Tycho adopts each one as it's ready | [`apps/tycho/PLAN.md`](../../apps/tycho/PLAN.md), "Waiting on" |

### Order

Decided 2026-10-23: `custom-cells` → `live` → `follow` → `resize` → `select` → `copy` → `sort` → `pin` → `reorder` → `context-menu` → `group-headers`. (`row-header` left the list: the base draws a row-number gutter already.) Since 2026-10-30, `density` goes after `pin`, ahead of `reorder`; since 2026-11-04, the flash's frames and then `format` go after `density`, ahead of `reorder` (below).

- **The scenarios' features first,** in the observatory's scenario order: the wide sheet (`custom-cells`), market watch (`live`, and `custom-cells` for its flash), live tail (`follow`). Each is small, none breaks the paging, and Tycho uses them too (a growing CSV, a refreshed query).
- **Then Tycho's core:** `resize` first because `reorder` and `group-headers` build on its width model (and it moves `pin`'s edge); `select` and `copy` next because copy closes a canvas tradeoff (README, "Canvas tradeoffs"), and they're the wide sheet's later steps; `sort` is the hardest: paging by row-group range stops working, and its research settles how the delegate reads pages in a sorted order.
- **The component's features come first, built in a run;** the apps adopt them after, each in a milestone of its own (decided 2026-10-23). A *Ready* row in an app's "Waiting on" table doesn't interrupt the run.
- **A feature can move up** when an app needs it sooner. The change goes here, with a decision, never in the app's PLAN.
- **`density` moved up (2026-10-30)** ahead of `reorder`: the observatory's next scenario, the wide sheet, waits on it, and the rest of the run (`reorder`, `context-menu`, `group-headers`) has no app waiting ([`docs/DECISIONS.md`](docs/DECISIONS.md), "Features").
- **`format` moves up (2026-11-04)** ahead of `reorder`: the observatory's market watch (its M10) waits on it from its part B, and `reorder`'s run has no app waiting ([`docs/DECISIONS.md`](docs/DECISIONS.md), "Features").
- **The flash's frames first (2026-11-04),** then `format`: market watch's spike found a flash redraws the whole table every frame, which sinks the bare host on a slow device; the observatory measures market watch only on the improved component ([`docs/DECISIONS.md`](docs/DECISIONS.md), "Features").

---

## Active milestone

### M12: `format`, a number column's shown text set by its host

Opened 2026-11-04, asked for by the observatory's market watch (its M10 part B, "Waiting on"): its canvas draws `84.21`, `9.420`, `+0.37`, `+1.23%`, `4,400,000`, where the table draws `fit_float`'s shortest text. The research: root [`docs/research/tall-table-features.md`](../../docs/research/tall-table-features.md), "`format`"; the decisions: [`docs/DECISIONS.md`](docs/DECISIONS.md), "Features" (2026-11-04, M12 part A, three entries, two chosen with the user).

```rust
// format.rs, behind `format`.
#[derive(Debug, Clone, PartialEq, Default)]
#[non_exhaustive]
pub struct NumberFormat { /* decimals, sign, grouping, suffix */ }
impl NumberFormat {
    pub fn new() -> Self;                                  // the automatic digits, `Sign::Negative`, no grouping, no suffix
    pub fn decimals(self, decimals: u8) -> Self;           // fixed, trailing zeros kept; floats only
    pub fn sign(self, sign: Sign) -> Self;
    pub fn grouping(self, grouping: bool) -> Self;         // `,` every three whole digits
    pub fn suffix(self, suffix: impl Into<SharedString>) -> Self; // text; nothing scaled
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Sign { #[default] Negative, Always }              // `Always`: `+` on a positive, nothing on a zero

// column.rs, behind `format`.
impl TallTableColumn { pub fn format(self, format: NumberFormat) -> Self; }

// delegate.rs, behind `format`: a cell's own decimals, `None` for its column's.
// Called for a drawn cell of a formatted float column, each frame, as `paint` is.
trait TallTablePage { fn decimals(&self, row: usize, column: usize) -> Option<u8> { None } }
```

**The spec** (part B builds it; each rule's reason is in the research):

- **The text:** a float (`Float`, `Float32` widened) at fixed decimals by Rust's `{:.N}` (the exact value, ties to even), or its exact text (`{:?}`, a whole float's `.0` kept) when `decimals` is `None`; then grouping on its whole digits, only for a plain text (an exponent keeps its form), the sign (`-` U+002D on a negative; with `Always`, `+` on a positive; the sign by the raw value, so a tiny rise is `+0.00%`; none on an exact zero, `-0.0` included), then the suffix. An integer's or decimal's text (`CellValue::Text`): grouping, sign, and suffix, its digits as written; a text whose digits are all zero takes no sign, a written minus dropped. `NaN`, `inf`, `-inf`, and NULL as today. A text column ignores the format.
- **The page's decimals:** `TallTablePage::decimals(row, column)` overrides the column's count for that cell (`None` keeps it); called only for a drawn loaded cell of a formatted float column, and for the tooltip's and the fit's cells.
- **The fit:** a formatted text is drawn if the sum of its characters' advances (the cells' font at the size in effect: each character's advance read once per font and size in `Glyphs`, beside `number_px`; each column's suffix shaped once at the size) is at most the content box less a pixel (the cell's width less the padding in effect, less 1), and is then drawn uncut (the element's cut skipped for it; a native test checks the font shapes the characters a format writes at their advances' sum). Otherwise the cell shows the automatic format: `fit_float` at the column's budget for a float, the plain text cut in the middle for an integer or decimal, as without the feature.
- **The tooltip:** opens for a formatted cell whose number, its grouping, sign, and suffix taken off, reads back as another float than the value in its own width (an `f32` for `Float32`) (rounded), for a fallback whose text isn't exact, or a cut, as today; never for a cell only dressed (`9.420`, `+0.37`, `4,400,000`). Its text, the copy's, and the sort stay the exact value.
- **`resize`'s fit:** a formatted column fits its widest visible loaded formatted text by the same advances (the formatted text even where a cell falls back now), plus the padding and the rule's pixel, rounded up (`digits_width`'s), so the widest fits after; the name's width as today.
- **Off by default, the base unchanged:** every site through `#[cfg(feature = "format")]` or an inlined stand-in, so the base's bytes and `cells.json`'s cells hold; with the feature on and no column formatted, every cell as the base draws it.
- **The bare host:** `format` builds every float column formatted (2 decimals, `Always`, grouping) and the narrow shape's integer `spkid` grouped, with the page answering 3 decimals for every fourth row, so the hook is used; `?format=off` builds the feature with no column formatted (the control, the code's cost apart from the drawing's).
- **Fixtures:** `cells.json` gains `format`: `advances` (each character a format writes, CSS px at 14 px; provisional from the font natively in part B, pinned from the bare host in Chromium in part C, as `density.json`'s `number_px` was) and `cases` (a format, a kind, a value, a page's decimals or none, a width → the exact and the shown text and whether it falls back, each with a `why`: a tie at 2, `0.005` at 2, a value rounding to zero with each sign (`+0.00%`, `-0.00`), `-0.0`, an integer `0` and a decimal `-0.00` with `Always`, a `Float32` dressed (no tooltip), a float without decimals grouped (plain, an exponent, a whole `.0`), grouping at 3, 4, and 7 digits, a negative grouped, a suffix wider than a digit, a page's 3 over a column's 2, a fallback a character short, an integer's and a decimal's text, NaN, inf, NULL, the canvas's five texts). Negative controls: a `+` on an exact zero, the sign from the rounded text, ties rounded up, grouping by four, a fit by character count, the page's decimals ignored. The TanStack contender runs it through `format.ts` (the observatory's, in its M10 part B: this milestone pins the fixture and runs it natively).
- **No paging change,** so no soak; the random test unchanged.

**Split into parts,** one session each, in order. Each part ends with its notes in `perf/results/` (where it measures) and `docs/LESSONS.md`. The milestone closes after part C.

- **A. Research and spec** (no shipped code). *Done 2026-11-04:* the research section, three decisions, a `docs/LESSONS.md` entry, the spec above, and the checks below.
- **B. The format.** `NumberFormat`, `Sign`, `TallTableColumn::format`, `TallTablePage::decimals`, the text, the fit and the fallback, the tooltip's rule, `resize`'s fit; `cells.json`'s `format` section (advances provisional) and its native test and controls; the bare host's `format` feature and `?format=off`; `format` in `perf/size.ts`'s `FEATURES` and the justfile's `test` runs. Checks B1–B3.
- **C. The browsers, the measurement, and the close.** The smoke check's format run, the advances pinned from Chromium, the cost (bytes; the scroll and flings formatted against `?format=off` and the base, reference, median of 10, throttled once), the README, the waiting app told, and the close-out ("Closing a milestone", above). Checks C1–C3.

**Done when:**

- [x] **A1. The research and the spec:** the research in the root's `docs/research/tall-table-features.md`, "`format`"; its decisions in `docs/DECISIONS.md`; the API, spec, and checks here. *Evidence (2026-11-04):* the research section (the canvas's twelve columns read, its decimals per instrument; where the format lives; the text, its rounding against V8's `Intl` and `toFixed`; the fallback; the fit by advances, Plex Sans's measured; the tooltip; the minus kept `-`; no sign glyph); `docs/DECISIONS.md`, "Features" (2026-11-04, M12 part A, three entries).
- [x] **B1. Off by default, the base unchanged:** `just tall-table size --against <M12's parent>`: the base's wasm after wasm-opt unchanged; `size` reports the `format` build with its markers, and no `format` symbol in the base. *Evidence (2026-11-04, `perf/results/2026-11-04-m12-b-size.json`):* `size --against 758955d` passed: the base 9841 KiB after wasm-opt at both (10,077,146 bytes, the same length; brotli 2750.5 KiB against 2749.2, recorded, not gated: the panic locations' line numbers moved); `format`'s build 9848.4 KiB after wasm-opt, 3.5 KiB brotli more than the base (the cost is part C's to measure against `?format=off`); its marker `seiza_tall_table6format6number` 0 symbols in the base and 18 with the feature; no home path in any build. The first run failed (the base 161 bytes smaller): `text_width` calling a new shared function and a `let` before the cells' cut moved the base's code; both written back as the base had them.
- [x] **B2. Format, natively:** `cells.json`'s `format` cases pass and each control fails; the rest of `cells.json` unchanged. In a window: the drawn text of a formatted column (through the cells' text element's `DrawnText`) at the column's decimals and at a page's override; a fallback at a narrow set width; the tooltip open for a rounded and a fallen-back cell and closed for a dressed one; with `resize`, a fit of a formatted column; with `density`, the fit at a small and a large text; the feature on with no format drawing as the base. `just tall-table test` (every feature off, each on, all on) and `lint` pass. *Evidence (2026-11-04):* `fixtures/cells.json`'s `format` section (33 cases, advances provisional from the font) passes `format_fixture`, and each of its six controls fails it (`format_controls_fail`: `+` on an exact zero, the sign from the rounded text, ties up, grouping by four, a fit by character count, the page's decimals ignored); `cell_text` and `cell_controls_fail` unchanged. In a window (`src/state/fixtures/format.rs`): `+1.12` (a tie to even) and `+2.50` at the column's 2, `+0.500` and `+4.500` at the page's 3, `123456789.12` falling back at 120 px, `1,000,003` grouped, the unformatted float and a text column given a format as the base; `a_narrow_set_width_falls_back` (60 px: `+1.12` kept, `0.5` and `10.5` fallen back); the tooltip open for `1.125` at 2 and the fallback, closed for `+2.50`, `+4.500`, and `1,000,003`; with `resize`, a fit of the formatted column to its widest formatted text's advances + 17 px, rounded up, after which `+123,456,789.12` draws; with `density`, the advances read at 8 and 24 px and each drawn cell formatted or fallen back by the rule; the feature on with no format drawing every cell as `shown_text`; `set_columns` with a new suffix shaped before its frame; a suffix's line break shown as `¶`, a value of another kind than its column's unformatted, and a float near 1e300 at fixed decimals falling back without being written out (the code review's fixes). `plex_sans_shapes_formats_at_their_advances`: cosmic-text 0.19.0 (the web's shaper) lays out IBM Plex Sans's pairs a format writes at their advances' sum at 11, 14, and 18 px, but `e-` 0.01 em wider (`docs/DECISIONS.md`, "Features", M12 part B). `just tall-table test` passed (every feature off, each on, `format` with `resize`, all on: 4 min 7 s); `just tall-table lint` passed; the TanStack contender's fixtures test passes, `format` named skipped.
- [x] **B3. The host builds it:** the bare host's `format` feature, the page's decimals answered, `?format=off`; the host's tests. *Evidence (2026-11-04):* `tall-table-host/format` (and the bridge's) formats every float column (2 decimals, `Sign::Always`, grouping) and the narrow shape's `spkid` (`rows.rs`'s `with_format`), the page answering 3 decimals on every fourth row of the source, sorted or not (`MemoryPage::decimals`); `?format=off` leaves every column unformatted. `the_format_and_the_pages_decimals` (each column's `number_format`) and `the_decimals_follow_the_source_row` pass; clippy on wasm32 with every feature passes; `format` is in `perf/size.ts`'s `FEATURES` (its marker `seiza_tall_table6format6number`) and the justfile's `test`.
- [ ] **C1. In the browsers:** `just tall-table smoke` with `format`, both shapes, in Chromium, Firefox, and WebKit: the drawn cells (`__tallTableCells`) the formatted text at both decimals, against the source's exact values; a narrowed column falling back; `?format=off` screens equal to the base's. `cells.json`'s `advances` pinned from Chromium, the native run passing with them.
- [ ] **C2. Its cost, in the host:** the added wasm (brotli 11, after wasm-opt) against the base; the scroll and flings formatted against `?format=off` and the base, both shapes, reference, median of 10 (throttled once, recorded). In `perf/results/` and the README's Features table.
- [ ] **C3. Told:** the README ("Format": the API, the text's rules, the page's decimals, the fallback, the tooltip, its limits: no locale, no scale, `-` not `−`); the observatory's "Waiting on" row for `format` flipped to *Ready* (the date and tall-table M12), and `format` joins Tycho's "Ready so far".

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

M13's (`reorder`) is written after its research, which opens it once M12 closes; until then its spec is its row under "Features".

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
