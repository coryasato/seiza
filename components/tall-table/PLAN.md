# PLAN.md — tall-table

What's next for the tall table: the candidates for its next features, the active milestone's "done when" checks, long-term goals, and open questions. Only what's still open lives here. It's the one list of the table's features to come: an app adopts one as a milestone of its own and links here, and never restates the spec.

**Goal:** the table's own features on its f64-row scroll model, each a Cargo feature off by default, so a host pays only for what it turns on. `DataTable`'s interactions are built (how each differs, and what wasn't carried over: [`README.md`](README.md), "How it differs from `DataTable`"); what comes next is a candidate from `DataTable`'s later releases or from TanStack Table, each researched before it's built ("Candidates", below). The observatory adds a feature level only for a feature both its sides build (`.claude/rules/comparison-protocol.md`).

**Where everything else lives:** what it offers today, and how it compares with `DataTable` and TanStack Table, in [`README.md`](README.md); its rules and architecture in [`CLAUDE.md`](CLAUDE.md); how a feature's cost is measured in [`perf/CLAUDE.md`](perf/CLAUDE.md), "Measuring a feature"; finished milestones in [`docs/milestones.md`](docs/milestones.md); decisions in [`docs/DECISIONS.md`](docs/DECISIONS.md) (why this file exists: root [`docs/DECISIONS.md`](../../docs/DECISIONS.md), "Repo structure", 2026-10-23); surprises in [`docs/LESSONS.md`](docs/LESSONS.md); what it measures of itself in `perf/results/`.

---

## Status

M1–M18, the two hardenings (between M7 and M8, and after M17), and the public API's review are done, the last on 2026-11-18: `DataTable`'s features, the observatory's and Kirkwood's asks, their follow-ups, the features tested together, and `replace_rows`, the table's part of Tycho's filters ([`docs/milestones.md`](docs/milestones.md)).

| Milestone | Title | Status |
|---|---|---|
| M19 | Column visibility: hide and show columns | Active: parts A and B done 2026-11-18, part C next |
| M20 | Find: step through matches, every row kept | Planned (its row under ["Candidates"](#drafted)) |

A *Planned* row's spec is its row under "Candidates"; its spec and checks are written into "Next milestones" when the one before it closes, after its research.

**Closing a milestone:** every "done when" check passes; a milestone that changed the paging has passed `just tall-table soak` on its final build (`CLAUDE.md`, rule 5); the numbers are in `perf/results/` with a note; new decisions are in `docs/DECISIONS.md`; a `docs/LESSONS.md` entry links the note; the README's Features table has the feature's row and cost, and its comparison tables the feature's row; and the spec and evidence move from here to the end of `docs/milestones.md`, leaving one row above. For a feature, also flip its row in each app's "Waiting on" table (listed under "Who's waiting", below) to *Ready* (the date and the milestone); each app adopts it in a milestone of its own.

---

## Candidates

**The dividing line.** The engine (DuckDB, or whatever source a host uses) decides which rows exist and in what order. The table decides how they're shown, and reacts when the meaning of a row index changes. The table never knows SQL. Every candidate is judged by it: its *Table's part* is what the table would build, and its *Engine's or host's part* what stays outside it (a source's query, a host's UI). A candidate whose part is all outside isn't the table's. Decided 2026-11-16 ([`docs/DECISIONS.md`](docs/DECISIONS.md), "Features").

**How a candidate is assessed:** its research comes first, as every feature's did ("Long-term goals"), and weighs its pros and cons for this table; a milestone's part A that finds it shouldn't be built closes the milestone with a decision and nothing built. Once built, its cost is measured in the bare host as any feature's. A drafted candidate whose research is needed before other work moves up, with a decision.

**Where candidates come from:**
- **`DataTable`'s later releases:** at each gpui-kit bump, its `src/table/` is read for what's new (`.claude/rules/toolchain.md`); each new feature gets a row in the README's "How it differs from `DataTable`" (same, differs, or not built), and one worth building a row here. Right-pinned columns (gpui-kit 0.9.1) is the first.
- **TanStack Table (v8):** what it does that `DataTable` lacks or does narrower, since people reach for it in a data grid. Its features and where each stands: the README's "TanStack Table's features".
- **An app's ask**, which moves ahead of the rest ("Who's waiting").

### Drafted

Spec rows with research questions, not specs yet; each one's research settles them, and may end it ("How a candidate is assessed", above).

| Candidate | What it adds | Table's part | Engine's or host's part | Research questions |
|---|---|---|---|---|
| **M20. Find** (Cargo name a draft: `find`) | Every row kept; move to the next or previous match, the matched text highlighted in the visible cells. The route to closing Ctrl+F (README, "Canvas tradeoffs") | A jump to the match's row, its column brought into view; the matched text highlighted in the visible cells, from a term the host sets | The bar, its keys, and its text input (the host's DOM or its own GPUI input, so the table takes no text input); "the next match after row *r*" and "the previous before *r*" (a row and a column, or none), answered by the source's query; the match count, if the host shows one | **What matches:** what the table highlights (the shown text, so a formatted number matches as drawn?) and what the source matches (the exact value) can disagree; which one wins, and what the README says when they differ. **The source's cost:** "the next match after row *r*" over a file of 25 M rows, measured in the DuckDB engine as `sort`'s order was (a scan from *r*, and the worst case, no match); the delegate's call, its cancel when the term changes, and what the table draws while it's pending. **Ctrl+F's key:** the browser's find is useless on a canvas; does the table claim the key in its key context, or does the host, which owns the bar? One option to weigh: a second Ctrl+F falls through to the browser, for the page's DOM text. Whether the host's bar is DOM or GPUI is the host's: if Tycho's design has decided, read it; otherwise design for the host owning the bar. **The layers:** the highlight against `select`'s tint, `custom-cells`' fill, `live`'s flash, and the jump's edge ("Long-term goals", "Layers"); is the current match marked apart from the others? **The built features:** a match in a hidden column (M19 comes first: skipped, or shown?); in a pinned column; after `sort` or `replace_rows` (the current match forgotten, or found again from its row?). **Checks:** a fixture of the highlight's ranges in a cell's text (a DOM contender's `<mark>`), the jump's placement reused from `jump_to`'s |

### Notes

Not planned; each waits for a host to ask, and is researched as any candidate is.

| Candidate | What it adds | Table's part | Engine's or host's part | Notes |
|---|---|---|---|---|
| Reading the shown columns only | A source told which columns are shown reads fewer | Telling the delegate the shown columns (off unless the source asks); a show re-reads every loaded page without a flash (`live`'s re-read); a copy reads only what it writes | The page query's column list (`sql.json` grows a case) | Left out of M19 (2026-11-18, [`docs/DECISIONS.md`](docs/DECISIONS.md), "Features"): it changes what a page holds and reaches the paging, the cache's bytes, and the soak. Researched if Tycho measures a wide file's page reads as its cost; weighed with "Pages of the visible columns only" ("Open questions"), its sideways twin |
| Column filtering | A predicate per column; the row count follows | `replace_rows` (M18). If a host asks: a filter control drawn in a header, its press reported through `clicks` (a new `ClickTarget`) | The `WHERE`, the new `count(*)`, pages over the filtered rows; the filter's UI and its state | Like `sort`, a source paging by row-group range can't page a filtered result; how it does is the source's (the DuckDB engine's research, as `sort`'s was). Tycho's ask is met (M18, closed 2026-11-18); the header control is built only if it asks for one. Advice for that research: the icon needs a "filtered" state the host sets, as the sort arrow has; and a host's popover anchored under a header cell has only `Clicked`'s position today, since the layout event is a probe (`probe_frames`). That may be enough (gpui-kit's menus open at the pointer); if not, weigh a public reader of a header cell's bounds, which a column menu would use too |
| Global filtering | One predicate across every column: fewer rows | `replace_rows` (M18) | The query across every text column; the search box | The filtering half of TanStack's global filter. Fuzzy filtering is a kind of it. Tycho's ask is met (M18, closed 2026-11-18) |
| Multi-column sort | Sort by several columns, Shift-click to add; priority numbers on the arrows | The arrows' Shift-click and their numbers; the list of keys | `ORDER BY a, b`, and its cost | The API's shape is settled (2026-11-17, [`docs/DECISIONS.md`](docs/DECISIONS.md), "Component API"): the delegate's `sort`, `sort()`, `set_sort`, `Sorted`, and `SortRefused` carry a list of keys, and the table sorts by one at most (`set_sort` refuses two, the state holds one). Left for the feature, each to research: the state's list, what the arrows draw (a priority, with no room in the box today), what a plain click does to a two-key sort, what `set_columns` keeps when one key's column is gone, the bridge's published shape (the first key today), and the cost in a source (`ORDER BY a, b`). It waits for a host |
| Right-pinned columns | Columns fixed at the right | An extension of `pin`, which is left only | — | Only if a host asks. How `DataTable` does it (`ColumnFixed::Right`, `fixed_right`, since gpui-kit 0.9.1): [the 0.9.1 note](perf/results/2026-11-10-gpui-kit-0.9.1.md) |
| Row pinning | Data rows kept at the top or bottom while the rest scroll | Rows drawn above or below the body, outside the scroll, read apart from the pages | Which rows are pinned, held by an identity the source gives, since the table knows only indices and `sort` (or `replace_rows`) changes what an index means | TanStack's (`row.pin('top' \| 'bottom')`, state `{ top, bottom }` of row ids, `getTopRows`/`getCenterRows`/`getBottomRows`; `keepPinnedRows`, on by default, keeps a pinned row in view when a filter drops it) pins rows by id. The table has no row identity: research first, against the footer below |
| Footer row | A row under the body, a cell per column | The row drawn under the body, outside the f64 index, its cells formatted as their columns' (`format`) | Its values (totals, averages: an aggregate query, run again as the rows change) | TanStack's column `footer` is a render slot with no access to the rows: the app computes what it shows. Suggested as row pinning's stand-in; whether it is one is part of the research, since the two answer different asks (a summary, against a row kept in view) |
| **Tree rows** | A flattened list in which expanding a row inserts its children below it, with an indent and a disclosure arrow, at the fixed row height | The indent, the arrow, and its press; a row's depth and whether it's open, from the page; an insert of *k* rows after row *r* (every index past *r* shifts: the pages after it are re-read or moved, what's kept by index past it moved) | Which rows exist, open or closed, in order (`GROUP BY`, a parent's children); a group's sums | Merges TanStack's grouping and aggregation and expanding. Its gap is the insert mid-list, which `set_rows` (the tail) and `replace_rows` (everything) don't cover. **Ruled out:** detail panels of variable height: they break the uniform f64 row index every scroll, jump, and page is built on. Tycho's grouping starts as a new table (`replace_rows` with `set_columns`: the root's research, "`replace_rows`"); tree rows only if it asks for groups expanded in place |
| Nested values | Lists, structs, and maps in a cell (JSONL's everyday shape), drawn readably at the fixed row height | Perhaps a `ColumnKind` and a `CellValue` of their own, so the width, alignment, and cut suit them (`[3 items]`, `{id: 4, …}`), and `copy` and the tooltip give JSON; or nothing, if a source's text is enough | How a DuckDB `LIST`, `STRUCT`, or `MAP` becomes a cell; an embedding's hundreds of floats summarized; reading one row in full (a host's detail view, opened by `clicks`' `Double` on a row) | Tycho's ask, after its first release. Today a nested value reaches the table only as text a source flattened; what the table and the DuckDB engine do with one now is the research's first step (Tycho's open question). Advice for that research: the likely first answer is no change in the table: the engine flattens top-level fields into columns (`user.name`) and gives deeper values as short text (`{3 fields}`, `[768 × float]`), and the host's detail view shows the whole value; a kind of its own only if that falls short |
| Row marks | Bookmarks or tags on rows, drawn in the row-number gutter | The mark drawn in the gutter, and its press through `clicks` | Which rows are marked, held by an identity the source gives, and what a mark means (a tag, a note) | Tycho's ask, after its first release. The same gap as row pinning: the table knows only indices, and `sort` or `replace_rows` changes what an index means. Researched with row pinning, so row identity is settled once for both |
| Column summaries in the header | A strip under each column's header: a small histogram, a null share | The strip drawn under the header, at the header's widths, from values the host gives (bins, shares), and its press through `clicks` | The profile's query (`SUMMARIZE`, a histogram); when it reruns as the rows change | Only if Tycho's design puts its column profile in the header; in a menu or its thread, the table has no part. Advice for that research: it's the footer row's sibling (a row outside the body's index, drawn from the host's values), so if both are asked for, research them together; a column's type label is the simplest thing the strip could show |

### Not the table's, not listed, and editing

**Not the table's:** faceting (each column's distinct values, or its min and max, for a filter's UI) is aggregate queries and a host's UI; the table has no part in it.

Not listed: TanStack's pagination (the table scrolls instead) and fuzzy filtering (a kind of global filtering).

**Editing is not on the list** (the table is read-only, and a paste lands in another app, which undoes it). If editing or paste-into-cells is ever added, undo and redo come in the same milestone, not after: a mistaken paste needs a quick remedy (noted 2026-10-26).

### Who's waiting

Only this file builds the table's features, whichever app asks (root `CLAUDE.md`, "Docs: one home per fact"). An app that needs one keeps a row in its PLAN's "Waiting on" table; closing the feature's milestone flips that row to *Ready*. When an app asks for a new feature, it gets a row under "Candidates" and one here.

| App | Asks for | Why | Status |
|---|---|---|---|
In the order they're built:

| App | Asks for | Why | Built in | Status |
|---|---|---|---|---|
| Tycho ([its PLAN](../../apps/tycho/PLAN.md), "Waiting on") | Column visibility | Hide and show columns | M19 | *Not ready* |
| Tycho | Find | Search that keeps every row | M20 | *Not ready* |
| Tycho | Column summaries in the header | Its column profile, if its design puts it in the header | Not planned ("Notes"): waits on Tycho's design | *Not ready* |
| Tycho | Nested values | JSONL, after its first release | Not planned ("Notes") | *Not ready* |
| Tycho | Row marks | The investigator's bookmarks and tags, after its first release | Not planned ("Notes"), with row pinning's research | *Not ready* |

Every earlier ask is built and *Ready* in its app's PLAN.

---

## Active milestone

### M19: `hide`, columns hidden and shown

**What it adds** (Cargo feature `hide`, off by default): a column hidden by its host keeps its place and its index, laid out at no width, drawn nowhere and hit nowhere, and comes back where it was, its width, sort, and group kept. Tycho waits on it. The research and the options weighed: root [`docs/research/tall-table-features.md`](../../docs/research/tall-table-features.md), "Column visibility (`hide`)"; the decisions: [`docs/DECISIONS.md`](docs/DECISIONS.md), "Features" (2026-11-18, M19 part A; five, each decided with the owner).

```rust
impl TallTableColumn {
    /// Hidden (`hide`): laid out at no width, drawn and hit nowhere, its
    /// place, width, sort, and group kept. Off by default.
    pub fn hidden(self, hidden: bool) -> Self;
    /// Whether it's hidden.
    pub fn is_hidden(&self) -> bool;
}

impl<D: TallTableDelegate> TallTableState<D> {
    /// Hides or shows column `index` (by index, as `columns()`):
    /// `ColumnsHidden` if it changed.
    pub fn set_column_hidden(&mut self, index: usize, hidden: bool, cx: &mut Context<Self>);
    /// Every column's flag, by index (a saved view given back): one
    /// `ColumnsHidden` if any changed. A list of another length (a view
    /// saved before `set_columns` changed the count) changes nothing,
    /// quietly: no event, no debug assertion.
    pub fn set_hidden(&mut self, hidden: Vec<bool>, cx: &mut Context<Self>);
}

// TallTableEvent:
/// A setter hid or showed a column (`hide`): every column's flag, by
/// index, for a host to keep by name and give back through `hidden`. None at
/// `set_columns`, which takes the new columns' flags.
ColumnsHidden(Vec<bool>),
```

The spec below is what part B builds; why each rule is so is in the decisions and the research.

- **The layout:** `layout_columns` lays a hidden column out at width 0 at the right edge of the column before it; the content width is the shown columns', and the sideways scroll is clamped as at a resize. `Pin::visible`, `reorder`'s `shown`, and the base's `visible_columns` take `width > 0`, so its header, cells, border, sort arrow, and `resize` band are drawn nowhere. The exact hit tests already skip it; `cell_clamped` (a drag's head past the cells, `first_visible`, a gutter press) falls back to the last *shown* place, not the last place, and to no cell with every column hidden. Every column may be hidden: the gutter and row numbers drawn, the cells area empty, a press on a row's gutter or an arrow key with nothing selected selecting nothing.
- **The setters:** a change cancels a held `reorder` drag and ends any held `resize` drag as its release would, its width reported (`repin` waits while a resize is held, and its `pin_limit` was summed at the press over the old widths; ended, not reverted, since part B: [`docs/DECISIONS.md`](docs/DECISIONS.md), "Features"), and forgets `sort`'s pressed and hovered arrow on a column now hidden; no reads planned (the pages hold every column); `ColumnsHidden` once per call that changed a flag; with `pin`, `Pinned` if the run in effect changed (the half-view cap re-summed).
- **`pin`:** the count is of places, a hidden column among the *n*; *P* is the run's right edge as laid out.
- **`select`:** a hide changes no selection that still shows a column; a `Columns` or `Cells` range left with none shown clears, not restored by a show, and `set_selection` over hidden columns alone clears (part B's code review, [`docs/DECISIONS.md`](docs/DECISIONS.md), "Features"). The arrow keys and Shift+arrows step to the next shown place that way, or stay; from a hidden head, from its place; a plain key or `jump_to` from a hidden active cell lands on the nearest shown column. `scroll_into_view` moves sideways only to a shown column. A `Columns` range's tint runs across a hidden column as one.
- **`copy`:** shown columns only, the header line too. Everything that counts a copy's columns counts the shown ones: the key's cap, `Declined`'s `columns`, and `start_copy`'s `least_bytes` against `max_bytes` (`TooLarge`). `Started`'s `columns` stays the range of places it spans, its doc saying hidden places in it aren't written. A selection of hidden columns alone starts no copy: `copy` → `None`, and the key goes on to the host, as with nothing selected (`cx.propagate()`). A copy running keeps the columns it started with: `Running` holds the shown indices taken at its start in a `hide` build (as `reorder`'s `indices`), not a range of places.
- **`reorder`:** the gap is found among units with a shown place in the pointer's region; a drop between shown A and B with hidden H between lands after A (A, X, H, B); a block carries the hidden places inside it.
- **`group-headers`:** runs are of places, unchanged; a cell spans its shown columns, a wholly hidden group draws no cell and takes no press; a press on a group selects its run's places.
- **`clicks`:** a hidden place is never a target; a `Group` target's span is its run's places.
- **The probe:** `ColumnProbe::hidden`; the layout lists every column, a hidden one at width 0.
- **The docs:** the README's "Hiding columns" (the flag, the setters, the event, `pin`'s count, `copy`'s columns, a hidden sorted column showing no arrow, the host keeping flags by name across `set_columns`), its API table, the Features table's row, the TanStack table's visibility row, and its limits.
- **The fixtures:** a `hidden` field (places; none by default, every existing case unchanged) in `pin.json` (in and past the run, the run's last hidden), `reorder.json`'s gaps (a hidden column between the pointer's neighbors, a unit all hidden), `group-headers.json` (partly and wholly hidden groups), `selection.json` (the arrow keys skipping, a range across), `copy.json` (a range across, the header line). Each fixture's controls gain one where it applies (a hidden column drawn at its width; a key landing on a hidden column; a hidden column copied). `fixtures/README.md` says so; the TanStack contender's test names the `hidden` cases skipped (read `.claude/rules/comparison-protocol.md` first; `just observatory fixtures` after).
- **The TanStack contender:** its tests skip, by name, every case with a `hidden` field in each fixture they run: `pin.json` (`wide.test.ts`'s `pinMismatches`, which lays every width out at full width), `selection.json`, and `copy.json` (`fixtures.test.ts`); `reorder.json` is skipped whole already, and `group-headers.json` isn't run.
- **The random test:** a `Hide` step (`set_column_hidden`, or `set_hidden` with a list of the columns' length and now and then one of another, which must change nothing), placed from `with_hides` after `with_replaces`, no case's draw changed; the `set_columns` step tells `Heard` the new flags, which it changes with no event (as it does for widths); invariants: nothing drawn or hit at a hidden column, a flag following its index through moves, the last `ColumnsHidden` heard the state, no hidden column in a copy's text; controls `DrawnHidden` and `FlagByPlace`. The soak on the final build (a hide can bring or take the horizontal scrollbar, and with it the viewport's rows).
- **The bare host:** `__tallTableHide(indices)` with `?perf`, and `?hidden=<n>` hiding every *n*th column at start, for the size and frame runs.

**Split into parts,** one session each, in order. Each part ends with its notes in `perf/results/` (where it measures) and `docs/LESSONS.md`. The milestone closes after part C.

- **A. Research and spec** (no shipped code). *Done 2026-11-18.* The research, five decisions with the owner, this spec; revised the same day after its code review (`cell_clamped`'s fallback to a hidden last place; any held resize cancelled, since `repin` waits on it; every count of a copy's columns, and `Running` without `reorder`; the key over an all-hidden selection going on; `set_columns` telling `Heard`; `set_hidden`'s quiet refusal; the contender's `pin.json` test). Check A1.
- **B. The feature, built and tested.** *Done 2026-11-18*, after three code reviews (a selection with no shown column cleared, nothing selectable with every column hidden, the `resize` drag ended). The flag, the setters, the event, the layout and every site above, the docs, the fixtures, the random test, the window tests, the bare host's hooks, the soak, `pairs`. Checks B1–B4.
- **C. The cost and the close.** The size on its own and against the base, and on each app that builds the table; the wide shape's frames with half its columns hidden; the smoke check in three browsers; the README; the close-out ("Closing a milestone", above). Checks C1–C3.

**Done when:**
- [x] **A1. The research and the spec:** the research in the root's `docs/research/tall-table-features.md`, "Column visibility (`hide`)"; its decisions in `docs/DECISIONS.md`; the API and the checks here. *Evidence (2026-11-18):* the research section (`DataTable` 0.10.0 has no visibility; TanStack's by id, a hidden column out of the leaf list; a place at no width weighed against leaving the places; the three tests that don't skip a zero-width column, `Pin::visible`, `reorder`'s `shown`, `visible_columns`, where the hit tests do; each built feature's rule; the narrowed read left out); five decisions in `docs/DECISIONS.md`, "Features" (the model, `pin`'s count, the flag's home, `copy`'s columns, the narrowed read), each with the owner; `docs/LESSONS.md`, "M19" part A.
- [x] **B1. The base unchanged:** `just tall-table test` passes with every feature off, each on, and all on; `lint` and `pairs` pass (`hide` meets `pin`, `select`, `copy`, `reorder`, `group-headers`, `sort`, `resize`, `clicks` in `cfg`s of two); `just tall-table size` shows no `hide` symbol in the base, and `size --against <M19's parent>` reports the base unchanged. *Evidence (2026-11-18, on the final code, after part B's three code reviews):* `just tall-table test` passes all 20 feature sets (`hide` alone, and all on: 464 tests, none ignored); `lint` passes; `pairs` passes with `hide` the 14th feature (103 clippy builds, the 71 pairs with code gated on both, 103 rustdoc builds, 30 min); `size` finds `hide`'s module in its build and in no other (0 symbols in the base), and `size --against 0f6970b` reads the base unchanged (9848.3 KiB after wasm-opt both; +0.3 brotli, within its swing); [`perf/results/2026-11-18-m19-b.md`](perf/results/2026-11-18-m19-b.md).
- [x] **B2. The feature, natively:** window tests, each with the features it needs: a hidden column drawn nowhere (header, cells, border, arrow, band, group cell) and hit nowhere (hover, tooltip, press, `clicks`, a drag's head past a hidden last column, a gutter press and an arrow key with every column hidden); its width, sort, and group kept and back on show; a flag following its column through a move and `set_order`; `set_columns` taking the new flags with no event; `ColumnsHidden` once per changing call, none for no change; `pin`'s count by place with a pinned column hidden, the run's last hidden, and `Pinned` when the cap re-sums; the keys stepping over a hidden column and from a hidden head; a `resize` drag held across any hide or show ended as its release would, with `Pinned` at the setter; a `reorder` drag cancelled; `set_hidden` of another length changing nothing; `copy`'s text, key cap, and `TooLarge` over shown columns (a range of two shown and many hidden copied), an all-hidden selection starting nothing and its key going on, a running copy unchanged without `reorder` too; every column hidden; the sideways scroll clamped. Every rule mutated fails a test. *Evidence (2026-11-18):* `src/state/fixtures/hide.rs`, 27 window tests, each built with the features it needs, passing in every set; 23 rules mutated alone (the code reviews' among them: a selection with nothing shown cleared, the outline, nothing selectable with every column hidden), each failing at least one test; the `resize` rule built as its release, not a cancel, and a selection with no shown column cleared ([`docs/DECISIONS.md`](docs/DECISIONS.md), "Features"); [`perf/results/2026-11-18-m19-b.md`](perf/results/2026-11-18-m19-b.md).
- [x] **B3. The fixtures and the random test:** the `hidden` cases of `pin.json`, `reorder.json`, `group-headers.json`, `selection.json`, and `copy.json` pass, their controls fail them; the `Hide` step runs with no existing case's draw changed; `DrawnHidden` and `FlagByPlace` fail their invariants (counts over `SEED`s 0–6 recorded); `just tall-table soak` passes on the final build; `just observatory fixtures` passes (the TanStack contender naming the `hidden` cases of `pin.json`, `selection.json`, and `copy.json` skipped). *Evidence (2026-11-18, on the final code):* the `hidden` cases (pin 3, reorder's gaps 2, group-headers 2, selection 1, copy 4) pass with `hide` and are skipped without it, each fixture's new control failing them; the `Hide` step placed by `with_hides`, every draw unchanged; `hide`'s three controls (`DrawnHidden`, `FlagByPlace`, `HiddenSelectionKept`) 21 of 21 over `SEED`s 0–6, the 28 earlier controls 185 of 196 (187 at M18's close), every one at `SEED` 0, the random test passing at every `SEED`; the soak passes (4 × 500 cases, 99–104 s a `SEED`); `just observatory fixtures` passes (before the reviews' fixes; the TanStack contender's tests again after them), its 5 `hidden` cases skipped by name; [`perf/results/2026-11-18-m19-b.md`](perf/results/2026-11-18-m19-b.md).
- [x] **B4. The host hides:** `__tallTableHide` and `?hidden=<n>` in the bare host, so `size` and `perf` measure the feature. *Evidence (2026-11-18):* a `hide` release build in Chromium, both shapes: `?hidden=2` lays every other column out at width 0 (narrow 6 of 11 shown, wide 250 of 500), the hook hides what it's given, `__tallTableHidden` and the layout agreeing, a fraction refused; `size.ts` names `hide`'s module for its symbol check.
- [ ] **C1. Its cost:** `hide`'s bytes alone and with every feature, against the base (brotli 11, and after wasm-opt), in a `perf/results/` note, and each app that builds the table (Tycho, the observatory's GPUI contender, Kirkwood) in its own `perf/results/` (root `CLAUDE.md`, rule 1); `just tall-table perf` in the wide shape with every other column hidden against none hidden: frame work within the spread.
- [ ] **C2. In the browsers:** `just tall-table smoke` hides and shows columns in Chromium, Firefox, and WebKit, in both shapes: the drawn layout skipping the hidden columns, a pinned one hidden, and the cells drawn against the source's after a show.
- [ ] **C3. The README and waiting apps:** the README's "Hiding columns", its API list, the Features row (`hide` and its cost), the `DataTable` table's row (none in 0.10.0) and the TanStack table's visibility row, the limits (a hidden sorted column, the screen reader); Tycho's "Waiting on" row flipped to *Ready* (2026-…, tall-table M19).

---

## Follow-ups to built features

### `custom-cells`

Built 2026-10-25 ([`docs/milestones.md`](docs/milestones.md), "M2 follow-up"); what's left:

**Later, as notes** (each adds without breaking; built when a host asks):

- **Stepped ramps** (`Ramp::stepped`, the nearest stop, no mix): bucketed heat maps, as Grafana's thresholds are. Not needed for categories: a category mapped to its stop's place (k / (n − 1)) lands on the stop already.
- **A bar-only column** (the text hidden, Excel's "Show Bar Only"): it widens the color-alone tradeoff (README, "Canvas tradeoffs"), since the number is no longer drawn, so the tooltip must show every hovered cell's exact value in it, not only a rounded or cut one, and the README says so.

### Rules in `CLAUDE.md` files that could be checks

Each through `/code-review` as code; once built, its sentence in the `CLAUDE.md` shrinks to a pointer.

- **The served build's gpui-kit** (`perf/CLAUDE.md`, "A build from another commit is labeled with this tree's gpui-kit"): the scripts record `versions` from the lockfile, so an A/B's results are hand-corrected. Shape: each script that writes results records gpui-kit from the served wasm (`shared-web/perf/`'s `wasmCrateVersion`, as the observatory's metric scripts do), and the gotcha goes.
- **Every length through `sizes()`** (`src/CLAUDE.md`, "Rules"): a row height, padding, or text size read from a constant skips `density`. Shape: a lint in `just tall-table lint` failing on a `px(<literal>)` length in `src/` outside `density.rs`, `column.rs`'s stand-in, and an allowlist.

---

## Next milestones

Specs drafted ahead, so a waiting app can read what's coming; each one's checks are tightened when it becomes active.

- **M20. Find:** next after M19; its row under "Candidates" is its spec until its part A's research, so a match in a hidden column is settled against the built feature.

---

## Long-term goals

### Research each feature's design before building it

Research opens each feature's milestone, not one study of them all. It's recorded in the root's [`docs/research/tall-table-features.md`](../../docs/research/tall-table-features.md), a section a feature, and covers what applies:

- **Reuse:** whether gpui-kit's pieces can sit on top of the row-based scroll model, or have to be rebuilt.
- **The delegate's calls**, for a feature that reaches the source: what the table asks and how a source answers in pages. The table asks for rows by index; what a source does to answer (an `ORDER BY` over the whole file, a sorted copy, an index) is the source's cost, measured by the engine, and the table's design must never make it hold the whole result.
- **Frame-work risks:** what could cost per frame while scrolling (hit-testing, per-column state, state across 25 M rows), checked with a spike in the bare host when it's unclear.
- **The built features:** how it meets each one already built (`pin`'s count, `select`'s ranges, `copy`, `reorder`, `group-headers`, `sort`), and the fixtures each pins.
- **Canvas gaps:** how it meets the canvas tradeoffs the README tracks (text selection, a11y, Ctrl+F).
- **Layers:** where it draws among the layers: the row's background and stripes; `custom-cells`' fill and bar, with `live`'s flash over the fill; `select`'s tint over those and under the text; the text; the jump's edge over filled cells.

### Readable values in the bare host

Not planned; noted 2026-10-24 after the manual check of `custom-cells`. The host's values are a hash of each cell's row and column, so every run draws the same cells and its numbers are the table's alone. A paint of them is noise: a heat map shows no pattern, and its bars no trend. A by-eye check can only confirm that something drew, not that it drew right.

- **What it would be:** `?values=gradient`, the float columns' values rising steadily down the rows and across the columns (the same ranges, so the paint and the rounding stay realistic). A heat map would then read as a smooth gradient, bars would lengthen row by row and cross zero at a known row, and `?cells=color` would turn from red to green at that row too.
- **How it would help:** a misplaced quad, a ramp mixed out of order, a bar drawn from the wrong edge, or a cell painted from its neighbour's value would show at a glance in the manual check each milestone ends with. Later features would gain the same: a sorted read (`sort`) or a moved column (`reorder`) shows as an unbroken gradient or a visible break.
- **What it must not touch:** the perf runs keep the hashed values, so a feature's cost is never read over data the branch predictor can learn. A gradient is for looking, not measuring.
- **Why not now:** the observatory's wide sheet will show heat and bar cells over real data once it adopts `custom-cells`; build this if a feature's manual check needs it before then.

---

## Open questions

- **Pages of the visible columns only** (two-dimensional paging): a page holds every column of its rows, so at the wide shape's 500 floats it's ~4 MB of Arrow and the 64 MiB cache holds ~16 pages. A page of the visible column range would cut the bytes read, sent, and decoded per frame of a sideways scroll, but it changes the delegate's unit and every paging decision, and a sideways scroll would then read pages too. Noted 2026-10-30 from the observatory's wide sheet, which keeps full-row pages (the same on both sides); worth research only if its data path measures the page's cost as the wide sheet's bottleneck.
- **Vertical cell borders** (`DataTable`'s `bordered`): the base draws row lines but no column lines. Nobody has asked; a wide sheet of heat cells may want them.
