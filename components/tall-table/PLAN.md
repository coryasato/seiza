# PLAN.md — tall-table

What's next for the tall table: the candidates for its next features, the active milestone's "done when" checks, long-term goals, and open questions. Only what's still open lives here. It's the one list of the table's features to come: an app adopts one as a milestone of its own and links here, and never restates the spec.

**Goal:** the table's own features on its f64-row scroll model, each a Cargo feature off by default, so a host pays only for what it turns on. `DataTable`'s interactions are built (how each differs, and what wasn't carried over: [`README.md`](README.md), "How it differs from `DataTable`"); what comes next is a candidate from `DataTable`'s later releases or from TanStack Table, each researched before it's built ("Candidates", below). The observatory adds a feature level only for a feature both its sides build (`.claude/rules/comparison-protocol.md`).

**Where everything else lives:** what it offers today, and how it compares with `DataTable` and TanStack Table, in [`README.md`](README.md); its rules and architecture in [`CLAUDE.md`](CLAUDE.md); how a feature's cost is measured in [`perf/CLAUDE.md`](perf/CLAUDE.md), "Measuring a feature"; finished milestones in [`docs/milestones.md`](docs/milestones.md); decisions in [`docs/DECISIONS.md`](docs/DECISIONS.md) (why this file exists: root [`docs/DECISIONS.md`](../../docs/DECISIONS.md), "Repo structure", 2026-10-23); surprises in [`docs/LESSONS.md`](docs/LESSONS.md); what it measures of itself in `perf/results/`.

---

## Status

M1–M17, the two hardenings (between M7 and M8, and after M17), and the public API's review are done, the last on 2026-11-17: `DataTable`'s features, the observatory's and Kirkwood's asks, their follow-ups, and the features tested together ([`docs/milestones.md`](docs/milestones.md)).

| Milestone | Title | Status |
|---|---|---|
| M18 | `replace_rows`: every row index changed meaning, one call | Active: parts A and B done, part C next (["Active milestone"](#active-milestone)) |
| M19 | Column visibility: hide and show columns | Planned (its row under ["Candidates"](#drafted)) |
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
| **M19. Column visibility** (Cargo name a draft: `hide`) | Hide and show columns: a hidden column is laid out at no width, drawn nowhere, and hit-tested nowhere; it keeps its place, its width, its sort, and its group, and comes back where it was | Which columns are hidden, held by identity as `group-headers`' labels are: a flag on the column's state, following it through `reorder`'s moves and kept across `set_columns` for a column of the same name (the rule `sort` uses), never a list of places. An event when it changes, so a host keeps it, and a setter that gives it back (after `set_columns` too), as `set_order` and `set_pinned` do, so a host restores a saved view. Optionally, telling the delegate which columns are shown, so a source can read fewer: an optimization a source may ignore, off unless the source says it wants it | The control that hides (a menu through `clicks`, a column chooser); with the delegate told, the page query's column list (`sql.json` grows a case) | **`pin`'s count:** does it count places (a hidden pinned column still one of the *n*), or shown columns? Places keeps the count stable as columns are hidden and shown; shown columns is what the reader sees. **`select`'s ranges:** a `Columns` or `Cells` range over a hidden column keeps it (ranges are of places), drawn as one tint across the gap? Shift-extend and the arrow keys skip it? **`copy`:** are hidden columns copied? (Excel's copy of a range takes hidden columns unless told "visible cells only".) The leaning: shown columns only, the header line too, and `copy.json` gets cases. **`reorder`:** where does a drop between two shown columns with hidden ones between them land, and does a hidden column move with a dragged block? **`group-headers`:** a group with every column hidden draws no cell and takes no press; a partly hidden group spans its shown columns; a move still keeps the hidden ones in their run. **`resize`'s fit and `sort`'s arrow:** a hidden sorted column keeps the sort (nothing says so on screen: a canvas tradeoff for the README?). **`clicks`' targets and the probes:** places with hidden ones skipped, or kept. **The fixtures:** a hidden column in `pin.json`, `reorder.json`, `group-headers.json`, and `copy.json`; a DOM contender's skip. **The delegate's narrowed read:** a page then holds fewer columns, and showing one re-reads every loaded page (as `live`'s re-read, without a flash). That reaches the page's contents and the paging, unlike the rest; if the research finds it's more than a part, it's a milestone of its own after M19, decided there, not split off quietly |
| **M20. Find** (Cargo name a draft: `find`) | Every row kept; move to the next or previous match, the matched text highlighted in the visible cells. The route to closing Ctrl+F (README, "Canvas tradeoffs") | A jump to the match's row, its column brought into view; the matched text highlighted in the visible cells, from a term the host sets | The bar, its keys, and its text input (the host's DOM or its own GPUI input, so the table takes no text input); "the next match after row *r*" and "the previous before *r*" (a row and a column, or none), answered by the source's query; the match count, if the host shows one | **What matches:** what the table highlights (the shown text, so a formatted number matches as drawn?) and what the source matches (the exact value) can disagree; which one wins, and what the README says when they differ. **The source's cost:** "the next match after row *r*" over a file of 25 M rows, measured in the DuckDB engine as `sort`'s order was (a scan from *r*, and the worst case, no match); the delegate's call, its cancel when the term changes, and what the table draws while it's pending. **Ctrl+F's key:** the browser's find is useless on a canvas; does the table claim the key in its key context, or does the host, which owns the bar? One option to weigh: a second Ctrl+F falls through to the browser, for the page's DOM text. Whether the host's bar is DOM or GPUI is the host's: if Tycho's design has decided, read it; otherwise design for the host owning the bar. **The layers:** the highlight against `select`'s tint, `custom-cells`' fill, `live`'s flash, and the jump's edge ("Long-term goals", "Layers"); is the current match marked apart from the others? **The built features:** a match in a hidden column (M19 comes first: skipped, or shown?); in a pinned column; after `sort` or `replace_rows` (the current match forgotten, or found again from its row?). **Checks:** a fixture of the highlight's ranges in a cell's text (a DOM contender's `<mark>`), the jump's placement reused from `jump_to`'s |

### Notes

Not planned; each waits for a host to ask, and is researched as any candidate is.

| Candidate | What it adds | Table's part | Engine's or host's part | Notes |
|---|---|---|---|---|
| Column filtering | A predicate per column; the row count follows | `replace_rows` (M18). If a host asks: a filter control drawn in a header, its press reported through `clicks` (a new `ClickTarget`) | The `WHERE`, the new `count(*)`, pages over the filtered rows; the filter's UI and its state | Like `sort`, a source paging by row-group range can't page a filtered result; how it does is the source's (the DuckDB engine's research, as `sort`'s was). Tycho's ask is met once M18 closes; the header control is built only if it asks for one. Advice for that research: the icon needs a "filtered" state the host sets, as the sort arrow has; and a host's popover anchored under a header cell has only `Clicked`'s position today, since the layout event is a probe (`probe_frames`). That may be enough (gpui-kit's menus open at the pointer); if not, weigh a public reader of a header cell's bounds, which a column menu would use too |
| Global filtering | One predicate across every column: fewer rows | `replace_rows` (M18) | The query across every text column; the search box | The filtering half of TanStack's global filter. Fuzzy filtering is a kind of it. Tycho's ask is met once M18 closes |
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
| Tycho ([its PLAN](../../apps/tycho/PLAN.md), "Waiting on") | `replace_rows`, then column filtering and global filtering | Its "Sort and filter" goal: a filter changes what every row index means; a grouped result is a new source | M18 (filtering's table part is `replace_rows`: "Notes") | *Not ready* |
| Tycho | Column visibility | Hide and show columns | M19 | *Not ready* |
| Tycho | Find | Search that keeps every row | M20 | *Not ready* |
| Tycho | Column summaries in the header | Its column profile, if its design puts it in the header | Not planned ("Notes"): waits on Tycho's design | *Not ready* |
| Tycho | Nested values | JSONL, after its first release | Not planned ("Notes") | *Not ready* |
| Tycho | Row marks | The investigator's bookmarks and tags, after its first release | Not planned ("Notes"), with row pinning's research | *Not ready* |

Every earlier ask is built and *Ready* in its app's PLAN.

---

## Active milestone

### M18: `replace_rows`, every row index changed meaning, one call

**What it adds** (in the base, no feature): one public call for a host whose rows changed wholesale (a filter, a search's filter, a query run again, a grouped result), `sort`'s reset made public. Tycho's filters wait on it. The research and the options weighed: root [`docs/research/tall-table-features.md`](../../docs/research/tall-table-features.md), "`replace_rows`"; the spike: [`perf/results/2026-11-18-m18-a-spike.md`](perf/results/2026-11-18-m18-a-spike.md); the decisions: [`docs/DECISIONS.md`](docs/DECISIONS.md), "Features" (2026-11-18, M18 part A).

```rust
/// Where the view lands after `TallTableState::replace_rows`.
#[non_exhaustive]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ViewAt {
    /// Row 0.
    Top,
    /// The view's top at this row, clamped as `jump_to`'s; no highlight,
    /// no selection.
    Row(u64),
    /// The last rows, as `follow()` puts them; following stays as it was.
    End,
}

impl<D: TallTableDelegate> TallTableState<D> {
    /// Every row index means another row now: the source holds `rows` rows
    /// (a filter, a query run again). Swap the source in the same update
    /// (`delegate_mut`), once its count is known: the docs' example.
    pub fn replace_rows(&mut self, rows: u64, at: ViewAt, cx: &mut Context<Self>);
}

// `TallTableDelegate::sort`'s docs: it may be called again with the sort in
// effect, for new rows (`replace_rows`).
```

The spec below is what part B builds; why each rule is so is in the decisions and the research.

- **The reset, in the base:** `apply_sort`'s body becomes a base function taking the count and the target, but its first lines (the sort set, the pressed arrow forgotten), which stay `sort`'s; `forget_all` and the reset's hooks (`sort_selection`, `sort_lets_go`, `sort_load`) leave `sort`'s `cfg` under base names. `sort` calls it with the count unchanged and `Top`, then emits `Sorted`: its behavior, fixtures, and window tests unchanged.
- **What it clears and keeps:** every page and read (with `live` the invalidations, with `live` and `custom-cells` the flashes); the hover, the tooltip, the jump's highlight; with `select` a `Rows` or `Cells` range (`Selected(None)`), a `Columns` range kept with its rows at the landing row (0, the named row clamped to the rows, or the last; with no rows, as `set_rows` leaves one); with `copy` a copy running (`Failed(Cancelled)`); with `follow` the drawn tail; the scroll's direction and settle. Kept: the sideways scroll and everything held by column (a pressed or hovered arrow among them), and the sort.
- **The count:** taken as `set_rows` takes it, before the view moves. `set_rows` after it corrects the count as it would any count.
- **The target:** `Top`, `Row(r)` (the top at `r`, clamped), `End` (at `max_top`; with `follow`, the loaded tail as the reads land, if following). With `follow`, `End` leaves following as it was; `Top` and `Row` let go unless every row fits. One `Following` at most.
- **The sort:** with a sort in effect, the delegate's `sort` is called with it once the update ends, right before the reads are planned, with the sort in effect then. The pending tell is dropped by any call that tells the source after the last `replace_rows` in the update (`set_sort`, a click, `set_columns` clearing a gone column's sort); `sort`'s own reset never sets one. A refusal clears the sort with no second reset (the view stays at the target, following as the replace left it): the source told none, `Sorted` with no keys, `SortRefused` with the keys and the reason.
- **`set_columns` with the sort's column gone:** the sort cleared at once as now (the source told none, `Sorted` with no keys) and its reset run at once, but for following: let go at the update's end unless a later call decided it (a replace's own reset, a jump, `follow`). After a `replace_rows` in the update, no reset (the replace's covers it). So `set_columns` and `replace_rows` end the same in either order, and a call after `set_columns` stands. A later `set_sort` in the update wins (the view at the top, as any sort). (Revised in part B from its code review: `docs/DECISIONS.md`, "Features".)
- **Once an update:** the reads (and the sort's telling) planned once for every `replace_rows`, `set_sort`, `set_columns`, and `set_rows` in the update, during a scrollbar drag once it rests (`sort_load`'s rule).
- **A closed table:** the count and view follow; nothing read, cancelled, or told.
- **No event of its own.**
- **The docs** (the method's, the README's "Replacing the rows"; `set_rows`' stops offering "a query run again", which keeps the old rows' pages under the new indices, and points to `replace_rows`): the async shape as an example (the new source kept aside, its count awaited, then swapped and called in one update); `set_columns` in the same update for new columns, in either order; a sort kept by name may match a same-named column of another result (clear it for a clean slate); correcting the count with `set_rows` works but jumps the scrollbar; `DataTable`'s `refresh` keeps a selected row's index, and this doesn't.
- **The paging fixture** (`fixtures/paging.json`): a `replace` step (`{"rows": n, "at": "top" | <row> | "end"}`), its `expect` the sort told first (with one in effect), the cancels as one decision, then the target's reads. Scenarios: a new count at the top, at a row, at a row past the new end, at the end; with reads out (held places, an answer dropped); with `follow`, the end keeping following and the top letting go; with `sort`, the sort told again. A `replace` field's control, `keep-pages`, in every build. `fixtures/README.md` and `fixtures/CLAUDE.md` say so; the TanStack contender's test names the `replace` scenarios skipped (read `.claude/rules/comparison-protocol.md` first; `just observatory fixtures` after).
- **The random test:** a `Replace` step in every build (a new count, a permutation, every row's era bumped, a target in, past, or at the ends of the new count), placed from a stream of its own (`with_replaces`) so no case's draw changes; checked at the step: the view at its target, the count, what's kept by row cleared, following kept only at `End`, the source's last sort the table's. The cache's `SortKeepsPages` and `SortKeepsReads` become the reset's (every build), each failing invariant 5; a control that doesn't tell the sort fails the sort check. The soak.
- **The bare host:** `__tallTableReplace(stride, at)` with `?perf`: its source swapped for every `stride`-th row and `replace_rows` called in one update.

**Split into parts,** one session each, in order. Each part ends with its notes in `perf/results/` (where it measures) and `docs/LESSONS.md`. The milestone closes after part C.

- **A. Research and spec** (no shipped code). *Done 2026-11-18.* The spike, the research, the decisions (four with the owner; the sort told to the new source from a review of them), this spec; revised the same day after its code review (a sort whose column `set_columns` finds gone reset to the top and let following go, so the two orders differed: its reset now waits for the update's end and yields to a replace; a refusal keeps the target; the tell dropped once the source has heard the sort; the pressed arrow `sort`'s; `set_rows`' docs). Check A1.
- **B. The call, built and tested.** *Done 2026-11-18.* The reset moved to the base, `replace_rows` and `ViewAt`, `sort` on the reset, the sort told again, the docs, the paging fixture, the random test, the window tests, the bare host's hook, the soak, `pairs`. Checks B1–B4.
- **C. The cost and the close.** The size effect on the base and each feature, and on each app that builds the table; `sort`'s run against the parent; the smoke check in three browsers; the README; the close-out ("Closing a milestone", above). Checks C1–C3.

**Done when:**
- [x] **A1. The research and the spec:** the research in the root's `docs/research/tall-table-features.md`, "`replace_rows`"; the spike's note; its decisions in `docs/DECISIONS.md`; the API and the checks here. *Evidence (2026-11-18):* the research section (the reset's parts from `apply_sort` and `set_rows`, `DataTable`'s `refresh` keeping a selected index, the swap's race read from the cache, the target, the sort, new columns, the fixtures and random test); the spike ([`perf/results/2026-11-18-m18-a-spike.md`](perf/results/2026-11-18-m18-a-spike.md): in memory a filter's count answered in 0–548 ms against a first page in the source's order of 0–560 (with no `ORDER BY`, the global search's page 309 ms sooner); on Gaia's file a common filter's first page 10–17 ms against a count of 181–346, a rare one's 756 against 120); four decisions in `docs/DECISIONS.md`, "Features" (the swap, the count, and the named row and new columns decided with the owner); `docs/LESSONS.md`, "M18" part A.
- [x] **B1. The base unchanged in shape:** `just tall-table test` passes with every feature off, each on, and all on, `sort`'s window tests and fixtures unchanged; `just tall-table lint` and `pairs` pass (the reset's hooks move between `cfg`s); `just tall-table size --against <M18's parent>` shows no feature's symbols in the base and reports the base's change. *Evidence (2026-11-18):* `just tall-table test` passes with every feature off, each on, and all on, `sort`'s window tests and fixtures unchanged; `lint` and `pairs` (89 sets) pass. `size --against 55a9597` ([`perf/results/2026-11-18-m18-b.md`](perf/results/2026-11-18-m18-b.md)): no feature's symbols in the base; the bare host's base +11.7 KiB after wasm-opt (+2.5 brotli), split by building it three more ways: the table without a caller −0.1 KiB (unchanged), the call ~2.0, the host's hook glue ~4.5 and its strided source ~5.2.
- [x] **B2. The call, natively:** window tests, each with the features it needs: everything in "What it clears and keeps" cleared or kept; each target, `Row` past the end clamped, the count 0; `follow`'s `End` keeping following on and off and `Top` letting go, one `Following` each; a `Columns` range at each landing row; the swap in the same update drawing no mixed frame, and its control (the swap an update early) drawing one; a read out before the call answered after it never stored; `set_columns` then `replace_rows` and the reverse ending the same (the view at the target, following, the pages planned once, the sort and its events, `pin`'s count, the selection), with a sort kept and with one whose column is gone, and `set_columns` alone resetting as before; `replace_rows` then `set_sort` at the top, the source told once; `set_sort`, `set_columns`, and `replace_rows` in one update reading once; the sort told again after the update, once (not after a later `set_sort`), a refusal clearing it with `Sorted` and `SortRefused` and the view kept at the target, none told with no sort; `sort` clearing its pressed arrow and `replace_rows` keeping it; `set_rows` after it correcting the count; a closed table. Every rule mutated fails a test. *Evidence (2026-11-18):* `src/state/fixtures/replace.rs`, 22 window tests in the all-on build (6 with no feature, 16 with `sort` alone), among them the swap an update early drawing eras `[1, 2]` and in the same update `[1]`; both orders of `set_columns` and `replace_rows(End)` ending equal with a sort kept and one gone; the reads heard after `Sorted` and `SortRefused`. Twenty of the rules mutated one at a time (`perf/results/raw/`'s mutation script, gitignored), each failing at least one of these tests or the paging fixture.
- [x] **B3. The fixture and the random test:** `paging.json`'s `replace` scenarios pass, `keep-pages` fails them; the `Replace` step runs in every build with no existing case's draw changed; the reset's controls fail invariant 5 and the sort control its check (counts over `SEED`s 0–6 recorded); `just tall-table soak` passes on the final build (`CLAUDE.md`, rule 5); `just observatory fixtures` passes. *Evidence (2026-11-18):* the four `replace` scenarios pass in every build that runs them, `keep-pages` fails them (in the base, where no `sort` scenario runs); the `Replace` step placed last in every build, no case's draw changed; over `SEED`s 0–6 the reset's two controls and `Untold` are caught at every seed (21 of 21), the 25 earlier controls in 166 of 175 runs (170 without the replaces; [the note](perf/results/2026-11-18-m18-b.md)); `just tall-table soak` passes on the final build; `just observatory fixtures` passes (the TanStack contender names the `replace` scenarios skipped).
- [x] **B4. The host calls it:** `__tallTableReplace` swaps and calls in one update, so the base build's `size` measures the call. *Evidence (2026-11-18):* `__tallTableReplace` in the base with `?perf`, the source's stride and `replace_rows` in one update; the base build's call measured at ~2.0 KiB after wasm-opt ([the note](perf/results/2026-11-18-m18-b.md)). Driven in three browsers in part C's smoke check (C2).
- [ ] **C1. Its cost:** the base and each feature's build against M18's parent (brotli 11, and after wasm-opt), in a `perf/results/` note, and each app that builds the table (Tycho, the observatory's GPUI contender, Kirkwood) in its own `perf/results/` (root `CLAUDE.md`, rule 1); `just tall-table sort` reads its click → filled as at the parent.
- [ ] **C2. In the browsers:** `just tall-table smoke` drives `__tallTableReplace` in Chromium, Firefox, and WebKit, in both shapes: the cells drawn against the source's rows at each target, with `sort` the order kept.
- [ ] **C3. The README and waiting apps:** the README's "Replacing the rows" (the call, the target, the async example, new columns, the sort, the limits), its API table and "TanStack Table's features" rows (filtering's table part); Tycho's "Waiting on" row flipped to *Ready* (2026-…, tall-table M18).

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

- **M19. Column visibility:** the same, after M18. If its research finds the delegate's narrowed read is more than a part, that read becomes a milestone of its own after M19, decided there.
- **M20. Find:** the same, after M19, so a match in a hidden column is settled against a built feature.

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
