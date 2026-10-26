# PLAN.md — tall-table

What's next for the tall table: its features to come, in order, the active milestone's "done when" checks, long-term goals, and open questions. Only what's still open lives here. It's the one list of the table's features: Tycho and the observatory adopt one as a milestone of their own and link here, and never restate the spec.

**Goal:** the interactions of gpui-kit's `DataTable` (resizing, selection and copy, sorting, …) on the tall table's f64-row scroll model, each a Cargo feature off by default, so a host pays only for what it turns on. Tycho adopts the full set; the observatory adds a feature level only for a feature both its sides build (root `CLAUDE.md`, "Comparison protocol").

**Where everything else lives:** what it offers today in [`README.md`](README.md); its rules and architecture in [`CLAUDE.md`](CLAUDE.md); finished milestones in [`docs/milestones.md`](docs/milestones.md); decisions in [`docs/DECISIONS.md`](docs/DECISIONS.md) (why this file exists: root [`docs/DECISIONS.md`](../../docs/DECISIONS.md), "Repo structure", 2026-10-23); surprises in [`docs/LESSONS.md`](docs/LESSONS.md); what it measures of itself in `perf/results/` (created with the first measurement).

---

## Where planning stands

Planned on 2026-10-23. Each decision, with its reasons, is in [`docs/DECISIONS.md`](docs/DECISIONS.md), "Features"; this file holds what follows from them: the [order](#order), the [bare host](#measuring-a-feature), M1 to M4 (built, in [`docs/milestones.md`](docs/milestones.md)), M5 (active: researched and specced 2026-10-26, [below](#active-milestone)), `custom-cells`' [later notes](#follow-ups-to-built-features) (built when a host asks; its follow-ups built 2026-10-25), and research per feature (["Long-term goals"](#long-term-goals)). The Cargo names stay drafts until each feature's milestone.

---

## Status

| Milestone | Title | Status |
|---|---|---|
| M1 | The bare host and the base's baseline | Done 2026-10-23 ([`docs/milestones.md`](docs/milestones.md)) |
| M2 | `custom-cells`: a cell's fill, bar, and text color | Done 2026-10-24 ([`docs/milestones.md`](docs/milestones.md)) |
| M3 | `live`: changed rows re-read and redrawn in place | Done 2026-10-25 ([`docs/milestones.md`](docs/milestones.md)) |
| M4 | `follow`: follow the tail as rows arrive | Done 2026-10-25 ([`docs/milestones.md`](docs/milestones.md)) |
| M5 | `resize`: drag a column's width | Active: part A done 2026-10-26; next, part B |
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

### M5: `resize`, a column's width dragged at its header edge

**What it adds** (behind the `resize` feature, off by default): a band at each visible column's right edge in the header; dragging it sets the column's width live, within its min and max, and double-clicking it fits the column to what's drawn; the new widths come out in an event at the release, for a host to keep and give back. It adds the width model `pin`, `reorder`, and `group-headers` build on. The research and the options weighed: root [`docs/research/tall-table-features.md`](../../docs/research/tall-table-features.md), "`resize`"; the decisions: [`docs/DECISIONS.md`](docs/DECISIONS.md), "Features" (2026-10-26, M5 part A).

```rust
// The column (column.rs), behind `resize`.
impl TallTableColumn {
    /// Its width, in place of its kind's (a width the host kept from
    /// `ColumnWidthsChanged`), clamped to its min and max. The header's
    /// width is no longer a minimum: a name wider than it is cut.
    pub fn width(self, width: Pixels) -> Self;
    /// The narrowest a drag or a fit leaves it: 40 px unless set.
    pub fn min_width(self, width: Pixels) -> Self;
    /// The widest: 1200 px unless set.
    pub fn max_width(self, width: Pixels) -> Self;
    /// Whether its header edge has a band: on unless set.
    pub fn resizable(self, resizable: bool) -> Self;
}

// The state (state.rs), behind `resize`.
impl<D: TallTableDelegate> TallTableState<D> {
    /// The width column `column` is drawn at now, or `None` past the last.
    pub fn column_width(&self, column: usize) -> Option<Pixels>;
}

pub enum TallTableEvent {
    // …
    /// A drag released or a fit changed a width: each column's set width
    /// (by the host's `width`, a drag, or a fit), `None` where it's still
    /// its kind's, in the order of `columns()`, for a host to keep (by
    /// column name, if its columns change) and give back through `width`.
    /// Not emitted while a drag moves, or when nothing changed.
    #[cfg(feature = "resize")]
    ColumnWidthsChanged(Vec<Option<Pixels>>),
}
```

- **The width model** (decided): a column's width is its kind's, laid out as today (at least its header's), unless the host set one (`width`) or a drag or fit did; a set width is clamped to its `min_width` (40 px default) and `max_width` (1200 px), a kind's width isn't (so an unresized column draws as without the feature). It's kept in the state; `set_columns` replaces it with what the host passes. The event reports set widths only, so a host giving them back never freezes a kind's width (an integer column's follows the font's number advance). A float column's budget follows its width, so a drag re-rounds its floats on the frame that widens it.
- **The band** (decided): 4 px on each side of a 1 px hairline at each visible resizable column's right edge, in the header only (`table_row_border`; `border` while hovered or dragged), with the column-resize cursor, painted after the header's cells. The body draws no guide line. Nothing of it is drawn without the feature.
- **The drag** (decided): the table's own, followed by the move and release handlers the body's `canvas` registers every frame, not GPUI's typed drag. It's a field of its own (`resizing`), not a `Drag` variant: `drag.is_some()` holds page reads until a scrollbar drag rests, and a column drag isn't a scroll, so paging during it (a vertical wheel) is the base's. Width = the width at the press + the pointer's move since, clamped. The sideways scroll holds still until the release, which clamps it: during the drag sideways input (a wheel's sideways part, Shift+wheel, the horizontal scrollbar) is ignored, nothing clamps `scroll_x` (a move re-lays out the columns without `lay_out`'s clamp), and the content counts as at least `scroll_x` + the cells' width, so the horizontal thumb stays where the view is; vertical scrolling works as without. No auto-scroll past an edge. The resize cursor holds window-wide while dragging. No tooltip during the drag. `set_columns` ends it with no event. The layout probe is reported once at the release (moves don't bump its generation; the release does), not per move.
- **The fit** (decided): a double-click on the band fits the column to its header's name and its visible, loaded rows, clamped; the drag the second press starts is ignored until the next single press. A numeric column (float, integer, decimal) fits its widest exact text by character count at the number advance (`chars × number_px` + padding + 1, `column_layout`'s rule), so a fitted float's budget holds every digit; any other fits its widest shown text (`cell_text`: one line, `¶` for breaks), cut to what `max_width` could hold, shaped in the cells' font, plus padding. It never asks the delegate. Not public in this milestone.
- **What's the host's:** keeping widths from `ColumnWidthsChanged` and giving them back (`width`) across `set_columns` or sessions; a column it doesn't want resized (`resizable(false)`).

**Split into parts,** one session each, in order. Each part ends with its notes in `perf/results/` (where it measures) and `docs/LESSONS.md`. The milestone closes after part D.

- **A. Research and spec** (no shipped code). *Done 2026-10-26,* revised the same day after a code review: the research in the root's `docs/research/tall-table-features.md`, "`resize`"; four decisions in `docs/DECISIONS.md`, "Features"; a `docs/LESSONS.md` entry; the API above and the checks below. No spike: the one frame-work risk (a drag re-laying out 500 columns a move) needs the drag's numbers (part D).
- **B. The width model, the band, the drag, the fit.** The column settings, `column_width`, the band and its hairline, `Drag::Column`, the scroll held during a drag, `ColumnWidthsChanged`, the double-click fit, the layout probe at the release; native tests; `cells.json`'s `number_px` and `resize` section, with their controls. Checks B1–B3.
- **C. The host and its scripts.** The bare host's `resize` feature (every column resizable, so the bands draw), the bridge's arm (the widths on a global the host names), the smoke check's drag and fit in three browsers, `perf.ts`'s resize-drag segment, `size.ts`'s `resize` build. Checks C1–C2.
- **D. The measurement and the close.** The cost on the final build; whether the drag needs a part of its own (D2: if so, specced before the close); then every remaining check and the close-out ("Closing a milestone", above).

**Done when:**
- [ ] **B1. Off by default, the base unchanged:** `just tall-table size --against <M5's parent>` (the base after wasm-opt within 0.1 KiB, no `resize` symbols in it). `just tall-table test` passes with every feature off, each on, and all on; `just tall-table lint` passes.
- [ ] **B2. Resizing, natively:** a column's width is its kind's until set, as without the feature (never clamped: a 1-character integer column stays under 40 px); `width` sets it, clamped to `min_width` and `max_width` (defaults 40 and 1200 px), and may be narrower than its header's estimated width (the name cut); a drag on a band moves the column's edge with the pointer from the press (width at the press + the move), clamped, re-laying out the columns right of it and the column's float budget on that move; during the drag `scroll_x` holds even when the content ends short of the viewport (a vertical wheel scrolls without moving it, sideways input is ignored, the horizontal thumb stays at the view), and the release clamps it; paging during the drag is the base's (a wheel's reads aren't held as a scrollbar drag's are); `ColumnWidthsChanged` is emitted once at the release with each set width (`None` for a kind's), never per move and never when nothing changed; a press elsewhere, a column with `resizable(false)`, and the row-number gutter have no band; a double-click fits to the header and the visible loaded rows (rows not loaded ignored), clamped, emitting once if it changed, and the second press's drag is ignored; a fitted float column shows its widest visible value unrounded; a text column holding a line break or a value longer than `max_width` fits without a panic, to `max_width` at most; `set_columns` mid-drag ends it with no event; no tooltip during a drag; the layout probe is reported at the release, once. Without `resize`, layout is as today (the header's width a minimum, no band).
- [ ] **B3. A fixture pins it:** `cells.json` gains `number_px` and a `resize` section (a float column's widths → budgets, at and past both clamps; values shown at a narrowed and a widened width), its format in `fixtures/README.md`; the native test runs it with `resize`, and controls fail it (a budget off by a character, the clamps ignored). The existing fixtures pass unchanged, off and on; the TanStack contender's fixture test passes, skipping the section it doesn't build.
- [ ] **C1. The host uses it:** the bare host's `resize` feature builds every column resizable and publishes the widths at each `ColumnWidthsChanged` through the bridge; `just tall-table smoke` with `resize` drags a boundary in both shapes (the column's width follows and the floats re-round, the release publishes the widths once, the scroll clamped after a narrowing at the right end) and double-click fits a column, in Chromium, Firefox, and WebKit.
- [ ] **C2. The scripts measure it:** `just tall-table perf` gains a resize-drag segment (a visible boundary dragged ±200 px, a move a frame, about 2 s) run when the build has `resize`; `just tall-table size` reports the `resize` build.
- [ ] **D1. Its cost, in the host:** the added wasm (brotli 11, and after wasm-opt) against the base; the scroll, vertical fling, and horizontal fling with `resize` built against the base (within spread); the resize drag's work per frame and late frames, beside the horizontal fling's; both shapes, reference and throttled, cold, median of 10, on the final build. In `perf/results/` and the README's Features table.
- [ ] **D2. Does the drag need its own part?** In the wide shape, reference: the drag's work per frame (p50) over the horizontal fling's by more than the spread means yes, specced as a part before the close (laying out from the resized column on, say); otherwise no, noted in `docs/DECISIONS.md`.
- [ ] **D3. The README:** `resize`'s use (the column settings, the event and keeping widths across `set_columns`, the fit, the budget following the width) and its limits (no auto-scroll past an edge, the fit only over drawn rows); canvas tradeoffs: resizing is pointer-only, no keyboard or screen reader (whether the accessibility gap already says it); "Read-only"'s list loses column resizing.
- [ ] **D4. Waiting apps told:** `resize` joins Tycho's "Ready so far" list (the date and M5). The observatory has no row: its wide sheet names a resize drag as a later step but hasn't asked.

**Manual check:** by hand in Firefox and Safari (`just tall-table dev resize`, `?shape=wide`): the cursor over a band and held through a drag, the hairline's hover and drag colors, a drag narrowing at the right end without the columns sliding under the pointer, a double-click fit.

---

## Follow-ups to built features

### `custom-cells`

Built 2026-10-25 ([`docs/milestones.md`](docs/milestones.md), "M2 follow-up"); what's left:

**Later, as notes** (each adds without breaking; built when a host asks):

- **Stepped ramps** (`Ramp::stepped`, the nearest stop, no mix): bucketed heat maps, as Grafana's thresholds are. Not needed for categories: a category mapped to its stop's place (k / (n − 1)) lands on the stop already.
- **A bar-only column** (the text hidden, Excel's "Show Bar Only"): it widens the color-alone tradeoff (README, "Canvas tradeoffs"), since the number is no longer drawn, so the tooltip must show every hovered cell's exact value in it, not only a rounded or cut one, and the README says so.
- **Selection over paint:** settled in `select`'s research (["Long-term goals"](#long-term-goals)).

---

## Next milestones

Specs drafted ahead, so a waiting app can read what's coming; each one's checks are tightened when it becomes active. M6's (`select`) is written after its research, which opens it once M5 closes; until then its spec is its row under "Features".

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

- **A shrink by more than a page keeps the whole pages past the new end** (the base's `PageCache::set_rows` looks only at the old last page): grown back, they draw their old rows as loaded, with or without `live`. Found in M4 part B's review; fixing it changes the base (and `paging.json`'s base scenarios), so it waits for a decision on whether a source that shrinks then grows is a case any host has.
- **More late frames in a throttled wide fling with `follow` built** (found in M4 part D): over 20 runs each, in both orders, ~8% late (median) against the base's ~3.5%, ranges overlapping (base 0.5–9.6%, `follow` 4.0–12.1%), with work per frame, busy time, and placeholders the same; not in the narrow fling or any reference segment. `follow`'s code on that path is a comparison per wheel and an early return per page landing. Worth a trace comparison of the two builds' slow frames before an app adopts `follow` on a slow machine; not a blocker for the feature, whose frame work matches.
- **Vertical cell borders** (`DataTable`'s `bordered`): the base draws row lines but no column lines. Nobody has asked; a wide sheet of heat cells may want them.
