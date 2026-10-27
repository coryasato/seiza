# PLAN.md — tall-table

What's next for the tall table: its features to come, in order, the active milestone's "done when" checks, long-term goals, and open questions. Only what's still open lives here. It's the one list of the table's features: Tycho and the observatory adopt one as a milestone of their own and link here, and never restate the spec.

**Goal:** the interactions of gpui-kit's `DataTable` (resizing, selection and copy, sorting, …) on the tall table's f64-row scroll model, each a Cargo feature off by default, so a host pays only for what it turns on. Tycho adopts the full set; the observatory adds a feature level only for a feature both its sides build (root `CLAUDE.md`, "Comparison protocol").

**Where everything else lives:** what it offers today in [`README.md`](README.md); its rules and architecture in [`CLAUDE.md`](CLAUDE.md); finished milestones in [`docs/milestones.md`](docs/milestones.md); decisions in [`docs/DECISIONS.md`](docs/DECISIONS.md) (why this file exists: root [`docs/DECISIONS.md`](../../docs/DECISIONS.md), "Repo structure", 2026-10-23); surprises in [`docs/LESSONS.md`](docs/LESSONS.md); what it measures of itself in `perf/results/` (created with the first measurement).

---

## Where planning stands

Planned on 2026-10-23. Each decision, with its reasons, is in [`docs/DECISIONS.md`](docs/DECISIONS.md), "Features"; this file holds what follows from them: the [order](#order), the [bare host](#measuring-a-feature), M1 to M6 (built, in [`docs/milestones.md`](docs/milestones.md)), M7 (`copy`, active, its research done and the copy built, [below](#active-milestone)), the [hardening](#hardening) session between M7 and M8, `custom-cells`' [later notes](#follow-ups-to-built-features) (built when a host asks; its follow-ups built 2026-10-25), and research per feature (["Long-term goals"](#long-term-goals)). The Cargo names stay drafts until each feature's milestone.

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
| M7 | `copy`: a selection to the clipboard | Active: part A done 2026-10-26; part B done 2026-10-27; part C next |
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
| `copy` | Copy a selection as TSV; a selection larger than the loaded pages asks the delegate for its rows; the host writes the clipboard (M7's research) | `dump_range` (rows held in memory) | `select` | Yes: rows not loaded are read, in pages | — |
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

### M7: `copy`, a selection to the clipboard

**What it adds** (behind the `copy` feature, which turns on `select`; off by default): Cmd+C or Ctrl+C, or a host's `copy`, copies the selection as a spreadsheet's TSV of exact values. Rows that aren't loaded are read from the delegate a page at a time, beside the cache. The table builds the text and reports it through events; the host writes the clipboard (the bridge, through a `ClipboardItem` it opens when the copy starts, so a copy that takes longer than the browser's ~5 s for a key still lands). A cap in bytes refuses a copy too large for the browsers. The research and the options weighed: root [`docs/research/tall-table-features.md`](../../docs/research/tall-table-features.md), "`copy`"; the spike: [`perf/results/2026-10-26-m7-a-spike.md`](perf/results/2026-10-26-m7-a-spike.md); the decisions: [`docs/DECISIONS.md`](docs/DECISIONS.md), "Features" (2026-10-26, M7 part A).

```rust
// copy.rs, behind `copy`.
/// Names a copy in its events.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct CopyId(u64);

/// How a copy is made: the host's settings.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub struct CopyOptions {
    /// Refused past this many bytes of text: 64 MiB by default, under
    /// WebKit's ~100 MiB limit on a clipboard write. The most ever
    /// attempted, not a size a key copies.
    pub max_bytes: usize,
    /// The most cells (rows × columns) Cmd+C copies: 100 k by default.
    /// Past it the key copies nothing and emits `Declined`; a host that
    /// asks the reader calls `copy`, which this doesn't limit.
    pub key_max_cells: u64,
    /// The column names as a first line: off by default.
    pub headers: bool,
}

impl Default for CopyOptions { /* 64 MiB, 100 k cells, no headers */ }

impl CopyOptions {
    pub fn max_bytes(self, bytes: usize) -> Self;
    pub fn key_max_cells(self, cells: u64) -> Self;
    pub fn headers(self, on: bool) -> Self;
}

/// A copy's progress, in order: `Started`, any number of `Text`, then
/// `Copied` or `Failed`.
#[derive(Debug, Clone, PartialEq)]
#[non_exhaustive]
pub enum TallTableCopy {
    /// Cmd+C on a selection past `key_max_cells`: nothing copied, nothing
    /// read. A host may ask the reader, and call `copy` if they confirm
    /// (the confirming click is a gesture of its own).
    Declined { rows: u64, columns: usize },
    /// In the task that asked for it (the key, or `copy`): a host writing
    /// to the web's clipboard opens its write here.
    Started { id: CopyId, rows: RangeInclusive<u64>, columns: RangeInclusive<usize> },
    /// The text's next piece, to append; `rows_done` rows are in so far.
    Text { id: CopyId, text: String, rows_done: u64 },
    /// Every piece sent.
    Copied { id: CopyId, rows: u64, bytes: usize },
    /// Ended without its text: a host drops the pieces it has and leaves
    /// the clipboard as it was.
    Failed { id: CopyId, reason: CopyFailure },
}

#[derive(Debug, Clone, PartialEq)]
#[non_exhaustive]
pub enum CopyFailure {
    /// Its text passed `max_bytes`, or its first page's worth of rows said
    /// it would.
    TooLarge { bytes: usize, max_bytes: usize },
    /// A page read for it failed (with `read_failure`, the table's
    /// `ReadFailed` too, for the host to repair the source).
    Read(String),
    /// A second copy, `set_columns`, `set_rows` shrinking under it, or
    /// `cancel_copy` (`close` ends a copy without an event).
    Cancelled,
}

/// A running copy's progress.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CopyProgress { pub id: CopyId, pub rows_done: u64, pub rows: u64 }

impl<D: TallTableDelegate> TallTableState<D> {
    pub fn set_copy_options(&mut self, options: CopyOptions);
    /// Copies the selection, as Cmd+C does but past `key_max_cells` too;
    /// `None` with nothing selected.
    pub fn copy(&mut self, cx: &mut Context<Self>) -> Option<CopyId>;
    /// The copy running, if any: its id, rows done, and rows.
    pub fn copying(&self) -> Option<CopyProgress>;
    /// Ends the copy running, if any, with `Failed(Cancelled)`.
    pub fn cancel_copy(&mut self, cx: &mut Context<Self>);
}

pub enum TallTableEvent {
    // …
    #[cfg(feature = "copy")]
    Copy(TallTableCopy),
}
```

The spec below is what part B builds; why each rule is so is in [`docs/DECISIONS.md`](docs/DECISIONS.md), "Features", and the root's research.

- **The keys:** Cmd+C and Ctrl+C, bound in `TallTableSelect` (both, as Cmd+A is), copy the selection of at most `key_max_cells` cells; past it they emit `Declined` and read nothing, so a reflex Cmd+C on a select-all costs nothing; with nothing selected the key propagates. A host's menu, or its confirmation of a declined copy, calls `copy`. Escape while a copy runs cancels it and keeps the selection; the next Escape clears the selection as `select`'s does.
- **What's copied:** a `Cells` block; a `Rows` range's every column; a `Columns` range's every row the table has at the key (rows arriving later aren't copied). Columns in the table's order, no row numbers.
- **The text:** tab-separated, a row a line (`\n`), no newline after the last, so one cell's copy is its value alone. A value holding a tab, `\n`, `\r`, or `"` is quoted, its quotes doubled. Each value's exact text (`CellValue`'s `Display`, the tooltip's), never the rounded or cut text drawn; NULL an empty field. With `headers`, the column names (quoted by the same rule) as a first line.
- **The reads:** each page at its turn (every page before it sent) comes from the cache if it's loaded then and holds every row the copy wants from it, as drawn then (with `live`, a stale page's drawn rows), and is read through `load_page` otherwise (a last page `set_rows` grew holds fewer rows than it now spans, so it's read): a page not loaded when the copy reads ahead is read ahead, and one loaded then but evicted by its turn is read at its turn. Never cached. A copy's reads and `live`'s re-reads together at most `(max_in_flight − 1).max(1)`, counted against `max_in_flight` with the cache's, so with `max_in_flight` 2 or more a visible page always finds a place (at 1, it waits behind the copy's one read); none started while a visible page is loading; ahead of prefetch. Reads in flight when the reader scrolls aren't cancelled. Pages that land out of order wait for their turn.
- **The pieces:** formatting runs off render, a turn at a time, each turn at most a budget counted in cells (~16 k, a constant: about 1–2 ms natively, measured in the build; wasm has no `Instant`, and a count is the same in a test as in a browser), each turn's text sent as one `Text` and dropped, so the wasm heap holds the pages in flight and one piece, never the copy. A copy whose rows are all loaded and whose cells fit one turn emits `Started`, its `Text`, and `Copied` in the task that asked.
- **The cap:** before any read, a copy whose least text passes `max_bytes` is refused at once: any value may be NULL (empty), so the least is its separators (a tab between cells, a line break between rows) and, with `headers`, the header line. A column's kind bounds nothing above (an integer can pass `max_chars`, a date arrives as text, and DuckDB writes BC dates and years past 9999 wider than 10). Otherwise it reads: refused early when the bytes a row of its first page's worth of rows (`page_rows` of them, wherever the selection starts) × the copy's rows pass twice `max_bytes`, and else as soon as the text passes it, checked a row at a time. `Failed(TooLarge)`, nothing sent after it. Never cut short. The cap is the copy's from its start: options set during it are the next copy's.
- **Ending:** a read that fails fails the copy (`Failed(Read)`, never retried; with `read_failure`, the table's `ReadFailed` too, so the host repairs the source, and the reader copies again). A second copy cancels the first (its `Failed(Cancelled)` before the new `Started`), as do `set_columns`, `set_rows` shrinking below the copy's last row, and `cancel_copy`; a copy's reads in flight are cancelled through the delegate and drain as the cache's do. `close` cancels its reads too, but emits nothing (it takes `&mut App`): a host closing the table tells its bridge, which rejects a write still open. Escape cancels it (`Failed(Cancelled)`, the selection kept); the selection changing and scrolling don't.
- **What's the host's:** writing the clipboard (the bridge, part C), its progress (`copying`, or each `Text`'s `rows_done`) and result shown to the reader, a cancel button (`cancel_copy`), asking the reader about a declined copy, and the limits (`set_copy_options`).
- **The bridge** (part C): at `Started`, `navigator.clipboard.write([new ClipboardItem({'text/plain': promise})])`; each `Text` kept as a JS string; at `Copied`, the promise resolved with a Blob of them, the strings dropped once it's built (the peak is about twice the text, plus the clipboard's copy); at `Failed`, rejected. Without `ClipboardItem` but with `navigator.clipboard` (an old browser), `writeText` at `Copied`, which lands within ~5 s of the key; without `navigator.clipboard` (an insecure context, where `writeText` doesn't exist either), the refusal published at `Started` and the host told the copy can't be written, which calls `cancel_copy` then, so nothing is read or formatted. At the host's word that the table closed, a write still open rejected. **If a write resolved minutes after the key, or in the background, fails** (C1's checks), a copy that reads changes flow: the table reads, then the host asks the reader to press Cmd+C again, which copies from the text it holds, in that key's task. The outcome (written, or the browser's refusal, or failed) on a global the host names, and to a callback the host gives.

**Split into parts,** one session each, in order. Each part ends with its notes in `perf/results/` (where it measures) and `docs/LESSONS.md`. The milestone closes after part D.

- **A. Research and spec** (no shipped code). *Done 2026-10-26,* revised the same day after a code review: the research in the root's `docs/research/tall-table-features.md`, "`copy`"; a spike of the browsers' clipboard (`perf/results/2026-10-26-m7-a-spike.md`); three decisions in `docs/DECISIONS.md`, "Features"; a `docs/LESSONS.md` entry; the API above and the checks below.
- **B. The copy.** `src/copy.rs` (the types, the text) and `src/state/copy.rs` (the action and its binding, `copy`, the reads beside the cache, the turns, the cap, the cancels, the events); `PageCache` counting a copy's reads against `max_in_flight`; the host's `copy` feature as a forward of the table's and the bridge's, so `size` measures it; `copy` in `perf/size.ts`'s `FEATURES` and the justfile's `test` runs; native tests. Checks B1–B3. *Done 2026-10-27,* revised after two code reviews.
- **C. The bridge and the scripts.** The bridge's writer, the host publishing the copy's state (`__tallTableCopy`) and a source's exact text for a script (`?perf`), the smoke check's copy run, and `perf/copy.ts` (`just tall-table copy`). Checks C1–C2.
- **D. The measurement and the close.** The cost on the final build, then every remaining check and the close-out ("Closing a milestone", above).

**Done when:**
- [x] **B1. Off by default, the base unchanged:** `just tall-table size --against <M7's parent>` (the base after wasm-opt within 0.1 KiB, no `copy` symbols in it, and the `copy` build's present; `select`'s build unchanged by `copy`'s code). `just tall-table test` passes with every feature off, each on (`copy` among them), and all on; `just tall-table lint` passes. *Passed 2026-10-27, after the code reviews:* `just tall-table size --against 98f3505`: the base 9680.6 KiB after wasm-opt at 98f3505 and in the working tree (+0.0; 2688.6 and 2689.4 KiB brotli, within brotli's drift when bytes shift), both built in a worktree at one path; `seiza_tall_table4copy` and `seiza_tall_table5state4copy` absent from the base (0, 0) and from `select`'s build (0, 0), present with `copy` (5, 46); every other feature's symbols as before. `just tall-table test` (its `copy` run, and `copy` in the all-on run) and `lint` pass. `perf/size.ts` now also fails if a build of what a feature turns on holds its symbols (`select`'s of `copy`'s, `live`'s of `follow`'s).*
- [x] **B2. Copying, natively:** the text of a `Cells` block, a `Rows` range, and a `Columns` range (its rows at the key, not those a later `set_rows` adds); a value with a tab, a line break, and a `"` quoted; floats exact (not as drawn); NULL empty; one cell with no newline; `headers` on. Cmd+C and Ctrl+C copy and `copy` returns the id; with nothing selected the key propagates and `copy` returns `None`; without the feature Cmd+C is unbound. Past `key_max_cells` the key emits `Declined`, reads nothing, and starts no copy, and `copy` copies it; Escape during a copy cancels it and keeps the selection, the next clears it; `copying` follows the rows done. A copy's `Started` reaches a subscriber before the task that asked ends (the key's dispatch, or the host's update that called `copy`); a copy of loaded rows within one turn's cells emits `Started`, `Text`, `Copied` in that task. A copy past the loaded pages: its reads and re-reads together at most `(max_in_flight − 1).max(1)` (with `max_in_flight` 1, a copy still completes, and a page that becomes visible meanwhile loads after its read), none started while a visible page loads, before prefetch, the cache's pages and bytes unchanged by them, out-of-order landings sent in order, the text equal to a loaded copy's of the same rows; a page loaded at the start and evicted before its turn read at its turn; a last page grown by `set_rows` (with `live`) read, its grown rows copied; a wide page's text in more than one piece, each at most the turn's cells. The cap: a copy whose separators (and header line, with `headers`) pass it refused before any read; refused at the first page only past twice the cap (a first page wide and the rest narrow, fitting, copied); else at the bytes passing it, an integer wider than its `max_chars` counted; nothing sent after. A failed read fails it (`Failed(Read)`), with `read_failure` also emitting the table's `ReadFailed`. Each cancel (a second copy, `set_columns`, `set_rows` shrinking under it, `cancel_copy`) emits `Failed(Cancelled)`, cancels its reads through the delegate, and their answers drain; `close` cancels them and emits nothing; a selection change and a scroll don't cancel. With `live`, a stale page copied as drawn. *Passed 2026-10-27:* `src/state/copy/tests.rs` (24 tests, 28 with `live`), `src/copy.rs`'s 3, and `pages.rs`'s `copy_tests` (7, 9 with `live`), in `just tall-table test`'s `copy` run and its all-on run. The text: `a_block_rows_and_columns` (a `Cells` block exactly, `Copied`'s 41 bytes; a `Rows` range's every column; a `Columns` range's 1,000 rows with `set_rows(1500)` during it), `values_exact_quoted_and_null_empty` (a tab, a `"`, and `\r\n` quoted; 0.30000000000000004 where the column draws 0.3; NULL empty; one cell alone; an empty cell `Started`, `Copied`; the header line quoted). The keys: `the_keys_copy_and_nothing_selected_goes_on` (Cmd+C and Ctrl+C; nothing selected, the host's Cmd+C runs and `copy` is `None`), `the_copy_keys_are_bound_only_with_copy` (the select fixture's, in both builds), `past_the_keys_limit_its_declined` (`Declined { rows: 1000, columns: 4 }`, no read, no copy; then `copy` copies it), `escape_cancels_a_copy_then_clears`, `started_reaches_a_subscriber_in_the_task_that_asked` (a key dispatched without running the executor: `started`, `text`, `copied` for loaded rows; `started`, `text` with reads to come; and from a host's update). The reads: `a_copy_reads_beside_the_cache` (`load 3`, `load 4` at once, page 4 answered first waiting for page 3, `copying` at 300 then 500 of 1,000 rows, at most 2 open, the text equal to the TSV of the rows, the cache's 3 pages and bytes unchanged, nothing draining), `none_while_a_visible_page_loads_then_before_prefetch` (nothing while page 5 loads; then `load 3`, `load 4`, then prefetch's one place), `at_one_in_flight_a_copy_completes` (one read; the visible page loads after it; peak 1), `a_page_evicted_before_its_turn_is_read_then`, `a_grown_last_page_is_read_and_its_rows_copied` and `a_stale_page_is_copied_as_drawn` (with `live`), `a_wide_page_goes_in_pieces` (500 columns: pieces at 32, 64, 96, 100 rows, each at most 16,384 cells); the cache's grant in `pages.rs` (`a_copys_reads_and_rereads_share_one_limit` among them). The cap: `separators_past_the_cap_are_refused_before_a_read` (3,999 bytes of separators against 3,998, no read; 51 with the header line against 45), `the_first_page_refuses_only_past_twice_the_cap` (a 2,899-byte copy projecting ~11,000 copied under a 6,000 cap, refused under 5,000 with nothing sent), `past_the_cap_at_its_bytes_then_nothing` (an integer column's 30-character values, refused past 20,000 bytes, nothing after). Ending: `a_failed_read_fails_it` (`Failed(Read("gone"))`, `ReadFailed` only with `read_failure`, its other read cancelled and drained), `each_cancel_ends_it_and_drains_its_reads` (a second copy's `Failed` before its `Started`, `set_columns`, `set_rows(999)`, `cancel_copy`: each `Failed(Cancelled)`, `cancel 3`, `cancel 4`, draining back to 0), `close_cancels_its_reads_quietly`, `a_selection_change_and_a_scroll_dont_cancel`. Revised after the code review, with the races against the cache's reads: `a_page_the_cache_is_reading_isnt_read_again`, `a_copy_ending_on_the_caches_page_frees_its_own_read` (its own read cancelled, every place back), `a_page_passed_on_the_caches_copy_is_let_go`, `a_page_the_cache_failed_to_read_is_read_by_the_copy`, `a_page_the_cache_stops_reading_is_read_by_the_copy`, `nothing_after_close`, and with `live` `a_grown_page_whose_reread_failed_is_read_by_the_copy` and `a_visible_grown_page_whose_reread_failed_holds_nothing_back` (which fails without its fix); in `pages.rs`, `prefetch_leaves_a_page_the_copy_reads` and `an_answer_frees_a_copys_place_whatever_became_of_it`. After the second review: `the_cap_is_checked_a_row_at_a_time` (100 values of 10,000 characters refused near the 50,000-byte cap, not after a 1 MB piece), `a_page_of_rows_is_projected_not_the_first_pages_tail`, `a_running_copy_keeps_its_cap`, `a_copys_end_gives_its_place_to_the_reader` (copied and refused, at `max_in_flight` 1), `a_resting_drag_lets_the_copy_read` (with `live`), and `a_cache_read_the_plan_cancels_is_the_copys_at_once`; each fails with its fix undone.
- [x] **B3. The host builds it:** the bare host's `copy` feature forwards the table's and the bridge's; `just tall-table size` reports the `copy` build. *Passed 2026-10-27:* the host's and the bridge's `copy` features forward the table's; `just tall-table size` reports the `copy` build: 2700.3 KiB brotli (9716.8 after wasm-opt), 10.8 KiB brotli more than the base and 4.5 (12.9 after wasm-opt) more than `select` alone. Its cost on the final build is D1's.*
- [ ] **C1. The bridge writes it:** `just tall-table smoke` with `copy` copies in both shapes in Chromium (granted `clipboard-write`, as a real Chrome is), Firefox, and WebKit, each read back through a real paste: a cell (its exact value, no newline), a block, a Shift+press block over every visible row and column, a `Rows` range past the loaded pages with reads held (`?delay`) past 5 s, one held about 60 s, and one finishing with the page in the background (another tab in front); the paste's lines and fields match the copy's rows and columns, and sampled values match the host's source. A copy past the cap is refused, the clipboard left as it was and the refusal published; closing the table during a copy rejects its write; Escape during a copy cancels it, the clipboard left as it was; a reflex Cmd+C on a select-all of the narrow shape declined, nothing read, then copied by the host's `copy` up to the cap (refused there, the clipboard as it was); in an insecure context (`http` on a LAN address), the refusal published and no read sent.
- [ ] **C2. The scripts measure it:** `just tall-table copy` (`perf/copy.ts`, a `copy` build): in each shape, a copy of rows near the cap from a cold view: the time from the key to `Copied` and to the write resolving, rows a second, and the wasm heap before and after; then frame work and late frames under a scroll during a copy, against the same scroll without one. Reference and throttled, cold, median of 10.
- [ ] **D1. Its cost, in the host:** the added wasm (brotli 11, and after wasm-opt) against the base and against `select`; with `copy` built and nothing copied, the scroll and flings within the spread of the base's; `just tall-table copy`'s numbers (C2), the heap growing by no more than the reads in flight and a piece. On the final build. In `perf/results/` and the README's Features table.
- [ ] **D2. The README:** `copy`'s use (the keys and `copy`, the text, the events, the host's write and the bridge's) and its limits (the key's limit and the cap, and why; NULL and empty text paste alike; a paste elsewhere before a copy that reads has finished gets the clipboard's old contents; a `Columns` copy of the rows at the key; plain text only; every column of a page read for a block of a few); "Read-only" and "Selecting" lose "nothing is copied"; canvas tradeoffs: "Text selection and copy" closed for whole cells, part of a value still not selectable.
- [ ] **D3. Waiting apps told:** `copy` joins Tycho's "Ready so far" list (the date and M7). The observatory has no row: TanStack Table has no copy.

**Manual check** (at the close): Firefox and Safari (`just tall-table dev copy`, both shapes): a cell pasted into a text field, a block into a spreadsheet (Numbers or Sheets), a `Rows` range past the loaded pages with `?delay` held past 5 s and about 60 s, one finishing with the window in the background, and a copy refused near the cap. The spike checked only Playwright's engines; real Safari's clipboard rules are the ones to confirm.

---

## Hardening

Not a milestone or a feature: a session of its own after M7 closes and before M8 opens (decided 2026-10-27, after M7 part B's two code reviews each found races between `copy` and the paging that no scenario test had). Research first, then the build, in that one session.

**What it adds:** a randomized test of the paging under every feature at once, on GPUI's seeded test executor, so a failure replays from its seed. It drives the table through random sequences: scrolls, jumps, scrollbar drags (moving and resting), `set_rows` growing and shrinking, `invalidate_rows`, `follow`'s moves, copies started, cancelled, and replaced, `close`, and reads answered in random order, failed, refused, or answered after a cancel; a source whose requests repeat across reads among its delegates. After every step it checks the invariants: reads in flight (the cache's, re-reads, a copy's, draining) never past `max_in_flight`; with every read answered, no place held; every copy ends (`Copied` or `Failed`), and a `Copied` copy's text is the TSV of its rows as a source read then; no page read twice at once but a visible one a copy also reads; nothing reads after `close`; the cache within its budget but for wanted pages. Its research settles the action mix, the step counts a run of `just tall-table test` can afford, and how a failure prints its seed and steps.

**Done when:** the test runs in `just tall-table test` with every feature on; each invariant has a negative control (a fault injected that the test must catch, as the fixtures' controls do), among them the two leaks M7 part B's reviews found; the bugs it finds are fixed with a scenario test each; a `docs/LESSONS.md` entry.

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

Specs drafted ahead, so a waiting app can read what's coming; each one's checks are tightened when it becomes active. M8's (`sort`) is written after its research, which opens it once M7 closes; until then its spec is its row under "Features".

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
- **More late frames in a throttled wide fling with a feature built** (found in M4 part D with `follow`, again in M5 part D with `resize`): with `follow`, over 20 runs each, in both orders, ~8% late (median) against the base's ~3.5%, ranges overlapping (base 0.5–9.6%, `follow` 4.0–12.1%); with `resize`, 5.1% against 2.0% over 10 each (base 1.5–8.4, `resize` 1.0–12.0), its runs' p95 at ~30 ms in 7 of 10 against the base's 3 (the two modes ~15 and ~30 ms). With `select` (M6 part D), 4.1% against 2.75% (base 0.5–8.4, `select` 1.5–6.8), with no frame cost measured in any segment. Work per frame, busy time, and placeholders the same; not in the narrow fling or any reference segment. `follow`'s code on that path is a comparison per wheel and an early return per page landing, and `resize`'s the bands' ~0.1 ms a frame, which every reference segment shows without a late frame, so it's likely not either feature's code (the build's layout, say). Worth a trace comparison of the two builds' slow frames before an app adopts `follow` on a slow machine; not a blocker for the feature, whose frame work matches.
- **Vertical cell borders** (`DataTable`'s `bordered`): the base draws row lines but no column lines. Nobody has asked; a wide sheet of heat cells may want them.
