# PLAN.md — tall-table

What's next for the tall table: its features to come, in order, the active milestone's "done when" checks, long-term goals, and open questions. Only what's still open lives here. It's the one list of the table's features: Tycho and the observatory adopt one as a milestone of their own and link here, and never restate the spec.

**Goal:** the interactions of gpui-kit's `DataTable` (resizing, selection and copy, sorting, …) on the tall table's f64-row scroll model, each a Cargo feature off by default, so a host pays only for what it turns on. Tycho adopts the full set; the observatory adds a feature level only for a feature both its sides build (root `CLAUDE.md`, "Comparison protocol").

**Where everything else lives:** what it offers today in [`README.md`](README.md); its rules and architecture in [`CLAUDE.md`](CLAUDE.md); finished milestones in [`docs/milestones.md`](docs/milestones.md); decisions in [`docs/DECISIONS.md`](docs/DECISIONS.md) (why this file exists: root [`docs/DECISIONS.md`](../../docs/DECISIONS.md), "Repo structure", 2026-10-23); surprises in [`docs/LESSONS.md`](docs/LESSONS.md); what it measures of itself in `perf/results/` (created with the first measurement).

---

## Where planning stands

Planned on 2026-10-23. Each decision, with its reasons, is in [`docs/DECISIONS.md`](docs/DECISIONS.md), "Features"; this file holds what follows from them: the [order](#order), the [bare host](#measuring-a-feature), M1 and M2 (built, in [`docs/milestones.md`](docs/milestones.md)), M3 (active), `custom-cells`' [follow-ups](#follow-ups-to-built-features) (one session, before an app adopts it), and research per feature (["Long-term goals"](#long-term-goals)). The Cargo names stay drafts until each feature's milestone.

---

## Status

| Milestone | Title | Status |
|---|---|---|
| M1 | The bare host and the base's baseline | Done 2026-10-23 ([`docs/milestones.md`](docs/milestones.md)) |
| M2 | `custom-cells`: a cell's fill, bar, and text color | Done 2026-10-24 ([`docs/milestones.md`](docs/milestones.md)) |
| M3 | `live`: changed rows re-read and redrawn in place | Active: parts A (research, spec), B (the re-read path), and C (a re-read landed in the turn that asks) done; part D (the flash and the close) next |
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

### M3: `live`, changed rows re-read and redrawn in place

**What it adds** (behind the `live` feature, off by default): a host says which rows changed, and the table reads their pages again and redraws them, the scroll unmoved; with `custom-cells` too, a column can flash the cells whose values changed. The research and the options weighed: root [`docs/research/tall-table-features.md`](../../docs/research/tall-table-features.md), "`live`"; the decisions: [`docs/DECISIONS.md`](docs/DECISIONS.md), "Features" (2026-10-24, M3 part A).

```rust
// The state (state.rs), behind `live`.
impl<D: TallTableDelegate> TallTableState<D> {
    /// `rows` changed in the source. Their pages that are wanted, loaded or
    /// loading, are read again (`load_page`), a loaded one drawn as it is
    /// until the new page lands; the others are dropped. Loads as a scroll
    /// does: during a scrollbar drag, once the pointer rests. Returns this invalidation's generation, which
    /// grows with each call.
    pub fn invalidate_rows(&mut self, rows: Range<u64>, cx: &mut Context<Self>) -> u64;
}

pub enum TallTableEvent {
    // …
    /// A re-read page is drawn for the first time, its rows visible.
    /// Emitted in render, as `Filled` is; none for a page re-read off screen. Its read started after every invalidation up to
    /// `generation`.
    #[cfg(feature = "live")]
    Refreshed { rows: Range<u64>, generation: u64 },
}

// The column (column.rs), behind `live` and `custom-cells`.
impl TallTableColumn {
    /// When a re-read changes a cell's value: a float's rise at the ramp's 1,
    /// its fall at 0, any other change at 0.5; faded by opacity to nothing
    /// over `duration`.
    pub fn flash(self, ramp: Ramp, duration: Duration) -> Self;
}
```

- **How the cache re-reads** (decided): one read per page in flight; a page invalidated during its read (a re-read or its first) is read once more after it lands, and never cancelled for being stale; an invalidation's loads wait out a scrollbar drag (`drag_settle`) as a scroll's do; a failed re-read keeps the stale page drawn, read again at the next invalidation or `retry_failed` (a `read_failure` still emits `ReadFailed`); a re-read's page swaps its bytes for the old page's, counts in flight, and is cancelled by `close`; a page with nothing to show goes first, then a stale visible page's re-read, then prefetch (a stale page doesn't hold prefetch back); re-reads hold at most `max_in_flight − 1` slots together; a stale page outside `wanted` is dropped; a re-read in flight for a page that leaves `wanted` is cancelled, as any read is. Placeholders only where a page isn't loaded; a re-read emits no `Filled`.
- **What stays the same:** `set_rows`, including the base forgetting a short last page (a host re-running a query with a new count calls `set_rows`, then `invalidate_rows(0..rows)`); the scroll, the hover, and the tooltip, which reads the new value on the next frame.
- **What's the host's:** knowing which rows changed (the engine's feed, in market watch), and mapping an update to the generation it got back. Patching a page in place isn't a feature: a host whose pages share storage it mutates calls `cx.notify()` on the table, and gets no flash. A host that has the new page in hand answers the re-read with a ready future, which lands in the turn that asked (part C); there's no push call.
- **The flash** (decided): compared in `page_done`, off the frame, over the invalidated rows of flashing columns only (rows invalidated during a read wait for the next read's comparison; two NaNs are equal); kept in a map of live flashes, each removed as it ends; drawn as a fill quad in `custom-cells`' pass over the page's fill, faded by opacity (the order settled with a screenshot); frames requested (`Window::request_animation_frame`) only while a flash is on screen; under `App::reduce_motion`, held at its first color for the duration, no fade and no frames, cleared by a timer. The clock is GPUI's (`BackgroundExecutor::now`).

**Split into parts (2026-10-24),** one session each, in order. Each part ends with its notes in `perf/results/` (B, C, and D) and `docs/LESSONS.md`. The milestone closes after part D.

- **A. Research and spec** (no shipped code). *Done 2026-10-24:* the research in the root's `docs/research/tall-table-features.md`, "`live`"; four decisions in `docs/DECISIONS.md`, "Features"; a `docs/LESSONS.md` entry; the API above and the checks below. No spike: nothing open needed numbers before the build (the research, "What needs no spike").
- **B. The re-read path.** *Done 2026-10-24* ([`perf/results/2026-10-24-m3-b.md`](perf/results/2026-10-24-m3-b.md)). `PageCache`'s stale and re-reading pages, `invalidate_rows`, `Refreshed`, the bridge's arm for it (a `tall-table:refreshed` mark and the last generation drawn, on a global the host names), `paging.json`'s `invalidate` step with its scenarios and controls, and the bare host's feed (`?live=<updates/s>`, seeded, over the visible rows; the source's per-row version), with a first read of update → pixel in it (B5). Checks B1–B5.
- **C. A re-read landed in the turn that asks** (added 2026-10-24: B5 read 22.5 ms, over a frame). *Done 2026-10-25* ([`perf/results/2026-10-25-m3-c.md`](perf/results/2026-10-25-m3-c.md)). Specced as a push path (`replace_page`); the table's own fix, open in the spec, read the same and was kept: a re-read ready when sent lands then, and an invalidation's reads are planned once at the end of its update. Checks C1–C4, below.
- **D. The flash, the measurement, and the close.** `flash` on the column, the comparison, the fade and its frames, `CellProbe`'s flash, `paint.json`'s `flash` section; the host's `?flash`; then every remaining check and the close-out ("Closing a milestone", above).

**Done when:**
- [x] **B1. The feature is off by default** and the base's build is unchanged: `just tall-table size --against <M3's parent>` (the size after wasm-opt within 0.1 KiB, no `live` symbols in the unstripped base). `just tall-table test` passes with every feature off and on; `just tall-table lint` passes. *Evidence:* against `24f8e76`, each built in one worktree, the base 9,645.3 → 9,645.4 KiB after wasm-opt (+0.1, at the gate; brotli 2,679.1 → 2,676.8, its noise); `14take_refreshed` in the base 0 times, in `live`'s build 6. `test` passes off, with each feature, and with both (52 table tests, 8 host); `lint` passes.
- [x] **B2. The cache re-reads as decided,** in native tests of `PageCache` and the state: a visible invalidated page keeps drawing its old rows (never a placeholder) until the re-read lands; a page invalidated during its re-read, or during its first read, is read exactly once more after it, never cancelled; invalidating during a scrollbar drag starts no read until the pointer rests; with three visible pages invalidated without pause, a page scrolled into view starts its read at once (re-reads never hold more than `max_in_flight − 1` slots); a failed re-read keeps the old rows drawn and reads again at the next invalidation; after re-reads, `used_bytes` counts each page once, `in_flight` counts the re-reads (never past `max_in_flight`), and `close` cancels them; invalidating a page ten times before its read lands costs one more read; a stale page outside `wanted` is dropped and reloads when scrolled back to; a re-read doesn't hold prefetch back and starts before prefetch under the in-flight limit; no `Filled` event for a re-read. *Evidence:* `src/pages.rs`'s eight `live` tests (each rule above) and `src/state/fixtures/live.rs` (old rows drawn while a re-read is out, no `Filled`, a failed re-read kept and retried by `retry_failed`, `close` cancelling a re-read); the drag's rule through the state in `paging.json`'s "a page changes during a drag".
- [x] **B3. A fixture pins it:** `paging.json` gains the `invalidate: [start, end]` step (its format in `fixtures/README.md`) and scenarios for each rule in B2 that page requests show; `paging_scenarios` passes with `live`, and its new controls fail: re-reading invalidated pages outside `wanted`, and cancelling a stale read to restart it. The existing scenarios and controls pass unchanged, with the feature off and on. *Evidence:* seven scenarios (`features: ["live"]`): a visible page changes, during its first read, during a drag, three visible pages, a re-read fails, a stale page nobody wants, a re-read landing during a drag (added after the code review: a landing read had started the drag's pages at once; it fails without the fix). `reread-unwanted` fails two (three visible pages, a stale page nobody wants), `restart-stale` two (a visible page changes, during a drag). The paging controls and the old scenarios pass unchanged, off and on; the TanStack contender's fixture test skips the `live` ones (13 of 13 pass).
- [x] **B4. `Refreshed` marks the frame:** a native test shows each re-read page emits it once, on the first frame that draws it, with the generation its read started at, and a page re-read off screen emits none, then or when scrolled to; `just tall-table smoke` with `live` checks the bridge's `tall-table:refreshed` mark lands right after a presented frame (`shared-web/perf/`'s `presentedMark`) in Chromium, Firefox, and WebKit, with the feed on. *Evidence:* `a_reread_draws_the_old_rows_until_it_lands` (two re-reads, each `Refreshed` once with the generation its read started at) and `a_page_reread_off_screen_reports_nothing`; `just tall-table smoke` on the `live` build at `?live=1000`: the mark 0.22 ms (Chromium), 0.34 (Firefox), 0.24 (WebKit) after its frame's last GPU call, in the same task, three marks each, no placeholder rows.
- [x] **B5. Is a push path needed?** In the bare host (its source answers on GPUI's next turn), the reference run's invalidate → `Refreshed` frame at 1k updates/s, median of 10, in the part's results note. Within one frame (16.7 ms): no push path, noted in `docs/DECISIONS.md`. Over: a push path (`replace_page`) is specced before part C. *Evidence:* 22.52 ms p50 (p95 28.78), median of 10, spread 1.9% (`2026-10-24-m3-b-live.json`): over a frame. At 10 updates/s, nothing in flight, it's still 18.7: most of it isn't coalescing but the read's round trip through GPUI's web executor (a `setTimeout(0)` a spawned task) and the frame it then waits for. So part C specs a push path.
**Part C, a re-read landed in the turn that asks** (specced 2026-10-24 from B5 as a push path, `replace_page`; settled 2026-10-25 by measuring both, `docs/DECISIONS.md`, "Features"):

- **As built:** with `live`, a re-read's load is polled once as it's sent; a ready answer lands in that turn, after the plan's other reads have started, and is drawn on the next frame; a pending one is spawned as before. First reads aren't polled, so the base and a first read's timing don't change. `invalidate_rows` plans its reads once, at the end of the update that made them (`App::defer`), so a batch invalidated row by row reads each page once.
- **Not built:** `replace_page`. Its spike read the same latency as poll-once's in one build (7.38 ms p50 each, the results note), and a host with the page in hand gets it by answering `load_page` with a ready future.

- [x] **C1. Off by default, the base unchanged** (as B1); `test` and `lint` pass. *Evidence:* `just tall-table size --against 60ed458`: the base 9,680.5 KiB after wasm-opt at both (0 KiB; brotli 2,689.4 → 2,688.9, its noise); `14take_refreshed` 0 times in the base, 6 in `live`'s build. `test` passes off, with each feature, and with both (55 table tests, 8 host); `lint` passes.
- [x] **C2. Natively:** a re-read answered at once lands in the update that asked, is drawn on the next frame, and emits `Refreshed` with its generation once; a batch's invalidations of one page in one update read it once; bytes counted once; a first read still lands from its task. *Evidence:* `src/state/fixtures/live.rs`'s `a_reread_answered_at_once_lands_in_the_turn_that_asked` (ten single-row invalidations, one `load 0`, nothing in flight or draining after the update, 3 pages' bytes, one `Refreshed` with the tenth generation, a jump's first read in flight until its task runs). It fails with the poll switched off (`(1, 0)` in flight and draining). After the code review: `a_reread_failing_at_once_lands_from_a_task` (one `ReadFailed`, from a task, the old rows kept) and `a_reread_the_source_refuses_is_read_again` (a refusal frees its place; the next invalidation reads it). The scripted delegate's other tests and the paging fixture pass unchanged.
- [x] **C3. Within a frame:** `just tall-table live` at 1k updates/s, reference, median of 10, beside B5's 22.5 ms, measured from the batch's start (the host's mark moved there, so a read landing in the update counts). *Evidence:* 7.16 ms p50 (p95 22.4, spread 1.8%, `2026-10-25-m3-c-live.json`), against HEAD's 22.55 ms with the same host (`2026-10-25-m3-c-live-before.json`). The p95 is a batch landing just after a frame, which waits for the next: both paths showed it. The push spike's numbers are in the results note.
- [x] **C4. Smoke:** `just tall-table smoke` with `live`, its refreshed mark right after a presented frame in all three browsers. *Evidence:* 0.27 ms (Chromium), 0.32 (Firefox), 1.10 (WebKit) after the frame's last GPU call, in its task, three marks each, no placeholder rows. (No `?push` run: the source's re-reads land at once under the plain feed.)

**Part D, the flash and the close:**
- [ ] **D1. The host uses it:** its `live` feature runs the feed at `?live=<updates/s>`, and with `custom-cells` too, `?flash` gives every float column a three-stop flash ramp; `just tall-table smoke` loads, fills, scrolls, and sees re-read rows change (the cell probe's text) with the feed on, and flashes drawn with `?flash`, in all three browsers.
- [ ] **D2. The flash, natively:** a test re-reads a page whose values rose, fell, and stayed, and the drawn cells' probe shows the rise at the ramp's 1, the fall at 0, a text change at 0.5, the unchanged cell and a NaN that stayed NaN unpainted, and each fading by opacity on GPUI's test clock (nothing drawn and the map empty after the duration); a row invalidated while a read is out flashes when the next read lands; frames are requested only while a flash is visible; under `reduce_motion` the color holds with no frames requested, then clears at the duration (a timer). A column without `flash` compares nothing (no change recorded).
- [ ] **D3. A fixture pins the flash:** `paint.json`'s `flash` section ((old, new, elapsed) → the ramp's value and the opacity, and through the ramp, the colors in light and dark); the native test passes, and its controls fail: the fade run the wrong way, a fall flashed as a rise.
- [ ] **D4. Its cost, in the host:** the added wasm (brotli 11, and after wasm-opt) of `live`, and of `live` with `custom-cells`, against the base and against `custom-cells` alone (`just tall-table size`); per-frame work, re-reads a second, late frames, and invalidate → `Refreshed` frame (the table's share of update → pixel, from the batch's start) in the narrow shape at a few feed rates (1k, 10k, 50k updates/s), with and without `?flash`, and the feature's build with the feed off against the base (within spread), reference and throttled, cold, median of 10, on the final build. In `perf/results/` and the README's Features table.
- [ ] **D5. The flash over a fill:** a screenshot of flashing heat cells settles the order (the flash over the page's fill, or another drawing); a change from the spec logs a decision.
- [ ] **D6. Canvas tradeoffs:** a flash, like a heat cell, says "changed" in color and motion alone, and a screen reader hears nothing of it; the README says so.
- [ ] **D7. Waiting apps told:** the observatory's "Waiting on" row for `live` and Tycho's note flip to *Ready* (the date and M3).

**Manual check:** in Firefox and Safari, `just tall-table dev live,custom-cells` with `?live=10000&flash`: rows update in place without placeholders, flashes fade, scrolling still works under the feed.

---

## Follow-ups to built features

### `custom-cells`

From a design review after M2 and a comparison with other tables' heat and bar cells (Perspective, Excel, pandas' Styler, Great Tables, Grafana), 2026-10-24. Each judged on the table's merits, none for the observatory's sake.

**Before an app adopts it:** one session, after M3 and before any app's milestone builds a column's paint, whichever comes first (the observatory's wide sheet is the first; its "Waiting on" row points here). Commit as `tall-table: custom-cells follow-ups (M2 follow-up)`.

- **A bar's color below zero:** `Bar::below(stop)`, the color of a bar that ends left of its zero, as Excel's, pandas', and Perspective's negative bars are; `None` draws both sides in `color`. A branch per bar, no extra quad. **And `Bar` becomes `#[non_exhaustive]`:** today a host can build `Bar { zero, color }`, which any added field breaks. `Bar` has no `Default`, so unlike `CellPaint` (`docs/DECISIONS.md`, "Features", the API as built) the attribute takes nothing a host needs: it builds with `Bar::new(color).zero(z).below(stop)`. This is the one breaking change here, so it lands before a host names `Bar`'s fields.
- **Text over a fill picks its own contrast:** a cell with a fill and no text color draws its text in `foreground` or `background`, whichever's Oklab lightness is farther from the fill's (the mix has it in hand; a translucent fill is composited over the row's background first). Two theme tokens that already contrast with each other, so no threshold to tune, and a theme switch flips them on its frame. Oklab L, not WCAG or APCA: this picks one of two colors, it doesn't score a contrast, and it costs a compare per cell. A text ramp still wins; a host that wants one fixed color gives a two-stop ramp of it. The flash (M3) reads the page's fill only, not its own fading quad. Without it, every heat column needs a text ramp to stay readable in both themes.
- **The range rule, written down, and a helper:** `CellPaint`'s docs and the README say a value maps through its whole column's range (from the source's stats, or fixed), never one page's minimum and maximum, or colors jump at page boundaries. `Domain { lo, mid, hi }` with `unit(v) -> f32` (`mid` maps to 0.5, each side scaled on its own; NaN stays NaN), pure, behind `custom-cells`, in the component: a bar's zero (`unit(0.0)`) must agree with its values' mapping, which the bare host does by hand today (`rows.rs`), and the observatory's wide sheet will be its second user. Where the range comes from stays the source's (for DuckDB, its column stats).
- **Forwarding the feature:** a crate that implements `TallTablePage::paint` turns on `custom-cells` itself; the README says so. `seiza-duckdb`'s `tall-table` source has no forwarding feature; it gains `tall-table-custom-cells` in the milestone of the first app that paints DuckDB pages (the engine's work is planned in the app that drives it).

**Done when:**
- [ ] **F1.** The base build is unchanged (`just tall-table size --against <the parent>`, as B1); `just tall-table test` passes with every feature off and on; `just tall-table lint` passes.
- [ ] **F2.** `paint.json` gains a bar below zero with and without `below`, and text over light and dark fills (one translucent) in both themes; the native test passes, `just tall-table paint-fixture --check` passes, and its controls fail: `below` ignored, the nearer token picked.
- [ ] **F3.** `Domain`'s native tests: the ends, an asymmetric `mid` at 0.5, NaN, `lo == hi`; the bare host's ranges and bar zeros go through it.
- [ ] **F4.** Its cost against `custom-cells` as M2 measured it: the added wasm (brotli and after wasm-opt), and `?cells=heat`'s frame work in the wide shape, reference, within spread or recorded; in `perf/results/` and the README's Features row.
- [ ] **F5.** The README's "Paint" has `below`, the text's contrast, the range rule, and forwarding; `docs/DECISIONS.md` has each decision.

**Later, as notes** (each adds without breaking; built when a host asks):

- **Stepped ramps** (`Ramp::stepped`, the nearest stop, no mix): bucketed heat maps, as Grafana's thresholds are. Not needed for categories: a category mapped to its stop's place (k / (n − 1)) lands on the stop already.
- **A bar-only column** (the text hidden, Excel's "Show Bar Only"): it widens the color-alone tradeoff (README, "Canvas tradeoffs"), since the number is no longer drawn, so the tooltip must show every hovered cell's exact value in it, not only a rounded or cut one, and the README says so.
- **Selection over paint:** settled in `select`'s research (["Long-term goals"](#long-term-goals)).

---

## Next milestones

Specs drafted ahead, so a waiting app can read what's coming; each one's checks are tightened when it becomes active. M4's (`follow`) is written after its research, which opens it once M3 closes; until then its spec is its row under "Features".

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

- **Vertical cell borders** (`DataTable`'s `bordered`): the base draws row lines but no column lines. Nobody has asked; a wide sheet of heat cells may want them.
