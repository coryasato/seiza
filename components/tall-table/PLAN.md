# PLAN.md — tall-table

What's next for the tall table: its features to come, in order, the active milestone's "done when" checks, long-term goals, and open questions. Only what's still open lives here. It's the one list of the table's features: Tycho and the observatory adopt one as a milestone of their own and link here, and never restate the spec.

**Goal:** the interactions of gpui-kit's `DataTable` (resizing, selection and copy, sorting, …) on the tall table's f64-row scroll model, each a Cargo feature off by default, so a host pays only for what it turns on. Tycho adopts the full set; the observatory adds a feature level only for a feature both its sides build (root `CLAUDE.md`, "Comparison protocol").

**Where everything else lives:** what it offers today in [`README.md`](README.md); its rules and architecture in [`CLAUDE.md`](CLAUDE.md); finished milestones in [`docs/milestones.md`](docs/milestones.md); decisions in [`docs/DECISIONS.md`](docs/DECISIONS.md) (why this file exists: root [`docs/DECISIONS.md`](../../docs/DECISIONS.md), "Repo structure", 2026-10-23); surprises in [`docs/LESSONS.md`](docs/LESSONS.md); what it measures of itself in `perf/results/` (created with the first measurement).

---

## Where planning stands

Planned on 2026-10-23. Each decision, with its reasons, is in [`docs/DECISIONS.md`](docs/DECISIONS.md), "Features"; this file holds what follows from them: the [order](#order), the [bare host](#measuring-a-feature), M1, M2, and M3 (built, in [`docs/milestones.md`](docs/milestones.md)), M4 (active: researched and specced 2026-10-25, [below](#active-milestone)), `custom-cells`' [later notes](#follow-ups-to-built-features) (built when a host asks; its follow-ups built 2026-10-25), and research per feature (["Long-term goals"](#long-term-goals)). The Cargo names stay drafts until each feature's milestone.

---

## Status

| Milestone | Title | Status |
|---|---|---|
| M1 | The bare host and the base's baseline | Done 2026-10-23 ([`docs/milestones.md`](docs/milestones.md)) |
| M2 | `custom-cells`: a cell's fill, bar, and text color | Done 2026-10-24 ([`docs/milestones.md`](docs/milestones.md)) |
| M3 | `live`: changed rows re-read and redrawn in place | Done 2026-10-25 ([`docs/milestones.md`](docs/milestones.md)) |
| M4 | `follow`: follow the tail as rows arrive | Active: parts A and B done 2026-10-25; next, part C |
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

### M4: `follow`, the view kept at the tail as rows arrive

**What it adds** (behind the `follow` feature, off by default, which turns on `live`): a reader who goes to the end (or a host calling `follow()`) follows it as `set_rows` grows the rows, the view pinned to the rows read so far, until the reader scrolls up; and, with `live`, a short last page that grows is kept drawn and read again, not dropped. The research and the options weighed: root [`docs/research/tall-table-features.md`](../../docs/research/tall-table-features.md), "`follow`"; the decisions: [`docs/DECISIONS.md`](docs/DECISIONS.md), "Features" (2026-10-25, M4 part A).

```rust
// The state (state.rs), behind `follow`.
impl<D: TallTableDelegate> TallTableState<D> {
    /// Scrolls to the end and follows it: as `set_rows` grows the rows, the
    /// view stays at the last rows read, until the reader scrolls up.
    pub fn follow(&mut self, cx: &mut Context<Self>);
    /// Whether the view is following the end.
    pub fn is_following(&self) -> bool;
}

pub enum TallTableEvent {
    // …
    /// Following started (`true`) or stopped: for a host's "back to the
    /// tail" button.
    #[cfg(feature = "follow")]
    Following(bool),
    /// While following, the drawn tail grew: every row below `rows` is drawn
    /// with its values. Emitted in render, as `Filled` is; a host that called
    /// `set_rows(n)` takes the first at or past `n`.
    #[cfg(feature = "follow")]
    TailDrawn { rows: u64 },
}
```

- **Following** (decided): a flag, off at open. Set by an action that reaches the end (End, a wheel or key ending there, a drag released there, `jump_to` landing there, `follow()`); cleared by vertical input leaving the end, by any amount, and by `jump_to` elsewhere; sideways scrolling leaves it; rows arriving and resizes never set it. A drag holds the view until release.
- **Pinned to the loaded tail** (decided): while following, the view's bottom is the last row the cache can draw, with every row above it in view loaded; it moves on as reads land and never back. At `follow()`, before a tail read lands, the view goes to `rows()` as a jump does. A follow move keeps the direction, starts no settle timer, and clears the hover; the visible pages are listed bottom first.
- **The grown tail page** (decided, in `live`): `set_rows` growing a short loaded page marks it stale; it draws the rows it was read with, placeholders past them (the cache answers `Pending` past the count read, not the page's `None`, which draws as NULL), and is read again on `live`'s path (one read in flight, never cancelled for growing, read once more after a read growth overtook, `Refreshed` when drawn). Growing a short page whose first read is out reads it once more after it lands. Shrinking still drops what's past the end. With `live`, `set_rows` plans its reads at the end of the update, as `invalidate_rows` does. Without `live`, the base drops the page and plans at once, as now.
- **What's the host's:** batching appends (one `set_rows` a frame), calling `follow()` to follow from the start (a log view), a "back to the tail" button on `Following(false)`, and timing appends by `TailDrawn`.

**Split into parts,** one session each, in order. Each part ends with its notes in `perf/results/` (where it measures) and `docs/LESSONS.md`. The milestone closes after part D.

- **A. Research and spec** (no shipped code). *Done 2026-10-25,* revised the same day after a code review and a design review: the research in the root's `docs/research/tall-table-features.md`, "`follow`"; four decisions in `docs/DECISIONS.md`, "Features"; a `docs/LESSONS.md` entry; the API above and the checks below. No spike: what's open needs the tail feed's numbers (part D).
- **B. The grown tail page, and `set_rows` in the fixture.** `PageCache` keeping a grown short page with `live` (the rows it holds, placeholders past them), `set_rows`' plan deferred with `live`, `paging.json`'s `rows` step and `without` field with base and `live` scenarios, and the `drop-grown` control. Checks B1–B3.
- **C. Following.** `follow`, `is_following`, `Following`, `TailDrawn`, the pin, bottom-first pages, the reader's moves, the bridge's arms (the flag on a global the host names, and a tail mark), `paging.json`'s `follow` step and `following`/`bottom` checks with their scenarios and controls, and the bare host's tail feed (`?rows=<n>`, `?append=<rows/s>`, `?follow`). Checks C1–C4.
- **D. The measurement and the close.** The tail feed at 1k, 10k, and 100k rows a second; its cost; whether a first read polled when sent is needed (D2: if so, a part is specced before the close); then every remaining check and the close-out ("Closing a milestone", above).

**Done when:**
- [x] **B1. The base is unchanged:** `just tall-table size --against <M4's parent>` (the base after wasm-opt within 0.1 KiB, no `live` symbols in it). `just tall-table test` passes with every feature off and on; `just tall-table lint` passes.
  *Done 2026-10-25:* the base 9,680.5 KiB after wasm-opt at `5878b27` and with this part (0 KiB), `14take_refreshed` 0 times in the base, 4 in `live`'s build; `test` (every feature set) and `lint` pass ([`perf/results/2026-10-25-m4-b.md`](perf/results/2026-10-25-m4-b.md)).
- [x] **B2. The grown page, natively:** with `live`, a visible short page grown by `set_rows` keeps drawing the rows it was read with, placeholders past them (not counted loaded: no `Filled` until they land), until its re-read lands (never a placeholder where a row was drawn); growing it again while that read is out reads it exactly once more after, never cancelled; growing a short page during its first read reads it once more after it lands; ten `set_rows` in one update cost one read, and `set_rows` then `invalidate_rows(old..new)` in one update one read too; shrinking drops the rows past the end as before; bytes counted once; `Refreshed` once, on the first frame drawing the grown page, and none for one grown off screen. Without `live`, `set_rows` drops the short page and cancels its read, as today.
  *Done 2026-10-25:* `pages.rs`' `a_grown_page_is_kept` (rows read drawn, `Pending` past them, re-read once per read in flight, bytes swapped), `a_page_grown_during_its_first_read_reads_again`, `a_grown_page_shrinks_or_fails_as_without_live`, `a_grown_pages_new_rows_are_never_compared`; `fixtures/live.rs`' `a_grown_last_page_draws_its_rows_until_read_again` (pending exactly the new rows, no `Filled` until they land, `Refreshed` once), `growth_in_one_update_reads_the_page_once` (ten `set_rows`, and `set_rows` + `invalidate_rows(old..new)`, one read each; answered when sent, landed in the turn), `a_last_page_grown_off_screen_reports_nothing`; without `live`, `growing_forgets_the_short_last_page`. `just tall-table test`: every feature set passes.
- [x] **B3. A fixture pins it:** `paging.json` gains `rows: <n>` and a scenario's `without: [<feature>, …]` (their format in `fixtures/README.md`); base scenarios pin today's drop and cancel, `without: ["live"]`, and pass with `live` off; `live` scenarios pin the kept page (grown while loaded, during its re-read, during its first read, shrunk); the `drop-grown` control fails at least one of them. The existing scenarios and controls pass unchanged, off and on; the TanStack contender's fixture test passes, skipping the steps and features it doesn't build.
  *Done 2026-10-25:* base scenarios "the short last page grows" (`without: ["live"]`: drop, cancel, re-read; whole pages kept) and "the rows shrink" (both builds); `live` scenarios "a grown last page is kept", "a last page grows during its first read", "a grown last page shrinks"; `drop-grown` fails the first two `live` ones. `paging_scenarios` and `paging_controls_fail` pass off and on; `just observatory fixtures` passes (the contender skips scenarios with a `rows` step).
- [ ] **C1. Off by default, the base unchanged** (as B1, no `follow` symbols in the base); `follow`'s build turns on `live`; `test` and `lint` pass.
- [ ] **C2. Following, natively:** off at open, also with rows that fit the viewport, and rows growing then don't move the view; End, a wheel past the end, a drag released at the end, `jump_to` landing at the end, and `follow()` turn it on; a wheel or key up by any amount turns it off, and rows growing then leave the top where it was; a sideways scroll leaves it on; a drag holds the view under the pointer while rows grow and decides on release; End while rows are still arriving follows them; `Following` is emitted once per change, never while unchanged. The pin: rows arriving don't move the view until their page lands, then it moves to the loaded tail; no placeholder row is drawn while following once the first tail read has landed; an eviction or a failed read never moves it up; `TailDrawn` is emitted once per growth of the drawn tail, at its new end, never when not following. A follow move leaves the direction as it was and starts no settle timer; the visible pages are planned bottom first while following.
- [ ] **C3. A fixture pins it:** `paging.json` gains `follow: true` and a step's `following` and `bottom` checks; scenarios: off at open (a small table growing, not following), `follow()` then growth (the tail page read bottom first, the view held at the loaded tail until it lands), a scroll up then growth (nothing new read, not following), a sideways scroll (still following), End while rows arrive (following); `follow-at-end`, `follow-ignores-reader`, `pin-to-rows`, and `top-first` each fail at least one; the rest pass unchanged.
- [ ] **C4. The host uses it, and smoke:** the bare host's `follow` feature runs the tail feed (`?rows=<n>&append=<rows/s>&follow`) and marks `TailDrawn` through the bridge; `just tall-table smoke` with `follow` loads, follows (the tail mark advancing, no placeholder rows once the first tail read lands, its mark right after a presented frame), scrolls up and stays put while rows grow, and follows again at End, in Chromium, Firefox, and WebKit.
- [ ] **D1. Its cost, in the host:** the added wasm (brotli 11, and after wasm-opt) of `follow` against the base and against `live`; following at 1k, 10k, and 100k rows a second in the narrow shape: append → pixel (`set_rows` → the first `TailDrawn` at or past it), per-frame work, late frames, the share of frames with placeholder rows (expected 0 after the first tail read), reads a second and drained reads, and scroll-back during the feed (a wheel up → the first frame at the new position, and → its rows real); the build with the feed off against the base (within spread); reference and throttled, cold, median of 10, on the final build. In `perf/results/` and the README's Features table.
- [ ] **D2. Is a first read polled when sent needed?** At 10k rows a second, reference: append → pixel over two frames (33.3 ms) p50 means yes, specced as a part before the close (under `follow`, the base unchanged); otherwise no, noted in `docs/DECISIONS.md`.
- [ ] **D3. The README:** `follow`'s use (the flag, `follow()` for a log view, `Following` and the host's button, `TailDrawn`, batching appends, the view behind `rows()` by the rows not yet read) and the grown page under `live`; canvas tradeoffs, if any (a screen reader hears no new rows: whether the README's accessibility gap already says it).
- [ ] **D4. Waiting apps told:** the observatory's "Waiting on" row for `follow` flips to *Ready* (the date and M4), and `follow` joins Tycho's "Ready so far" list.

**Manual check:** by hand in Firefox and Safari (`just tall-table dev follow`, `?append=10000&follow`): the view stays at the tail without placeholders, a scroll up holds still while rows arrive, End returns to it.

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

Specs drafted ahead, so a waiting app can read what's coming; each one's checks are tightened when it becomes active. M5's (`resize`) is written after its research, which opens it once M4 closes; until then its spec is its row under "Features".

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
- **Vertical cell borders** (`DataTable`'s `bordered`): the base draws row lines but no column lines. Nobody has asked; a wide sheet of heat cells may want them.
