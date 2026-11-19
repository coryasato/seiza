# PLAN.md — tall-table

What's next for the tall table: the candidates for its next features, the active milestone's "done when" checks, long-term goals, and open questions. Only what's still open lives here. It's the one list of the table's features to come: an app adopts one as a milestone of its own and links here, and never restates the spec.

**Goal:** the table's own features on its f64-row scroll model, each a Cargo feature off by default, so a host pays only for what it turns on. `DataTable`'s interactions are built (how each differs, and what wasn't carried over: [`README.md`](README.md), "How it differs from `DataTable`"); what comes next is a candidate from `DataTable`'s later releases or from TanStack Table, each researched before it's built ("Candidates", below). The observatory adds a feature level only for a feature both its sides build (`.claude/rules/comparison-protocol.md`).

**Where everything else lives:** what it offers today, and how it compares with `DataTable` and TanStack Table, in [`README.md`](README.md); its rules and architecture in [`CLAUDE.md`](CLAUDE.md); how a feature's cost is measured in [`perf/CLAUDE.md`](perf/CLAUDE.md), "Measuring a feature"; finished milestones in [`docs/milestones.md`](docs/milestones.md); decisions in [`docs/DECISIONS.md`](docs/DECISIONS.md) (why this file exists: root [`docs/DECISIONS.md`](../../docs/DECISIONS.md), "Repo structure", 2026-10-23); surprises in [`docs/LESSONS.md`](docs/LESSONS.md); what it measures of itself in `perf/results/`.

---

## Status

M1–M19, the two hardenings (between M7 and M8, and after M17), and the public API's review are done, the last on 2026-11-18: `DataTable`'s features, the observatory's and Kirkwood's asks, their follow-ups, the features tested together, `replace_rows`, the table's part of Tycho's filters, and `hide`, its column visibility ([`docs/milestones.md`](docs/milestones.md)).

| Milestone | Title | Status |
|---|---|---|
| M20 | Find: step through matches, every row kept | Active: part A done 2026-11-18, part B next |

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

Spec rows with research questions, not specs yet; each one's research settles them, and may end it ("How a candidate is assessed", above). None now: find, the last, is the active milestone.

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

In the order they're built:

| App | Asks for | Why | Built in | Status |
|---|---|---|---|---|
| Tycho ([its PLAN](../../apps/tycho/PLAN.md), "Waiting on") | Find | Search that keeps every row | M20 | *Not ready* |
| Tycho | Column summaries in the header | Its column profile, if its design puts it in the header | Not planned ("Notes"): waits on Tycho's design | *Not ready* |
| Tycho | Nested values | JSONL, after its first release | Not planned ("Notes") | *Not ready* |
| Tycho | Row marks | The investigator's bookmarks and tags, after its first release | Not planned ("Notes"), with row pinning's research | *Not ready* |

Every earlier ask is built and *Ready* in its app's PLAN.

---

## Active milestone

### M20: `find`, matches stepped through with every row kept

**What it adds** (Cargo feature `find`, off by default): a term the host sets is highlighted in the cells drawn, and the host's bar steps to the next or previous match, which the source finds in every row, loaded or not; the current match is brought into view and marked apart. Tycho waits on it; it's the route to closing the README's Ctrl+F gap. The research and the options weighed: root [`docs/research/tall-table-features.md`](../../docs/research/tall-table-features.md), "Find (`find`)"; the spike's numbers: [`perf/results/2026-11-18-m20-a-spike.md`](perf/results/2026-11-18-m20-a-spike.md); the decisions: [`docs/DECISIONS.md`](docs/DECISIONS.md), "Features" (2026-11-18, M20 part A; four with the owner).

```rust
/// A cell, by row and column index (`find`).
pub struct FoundCell { pub row: u64, pub column: usize }

/// What the table asks a source to find (`find`): the first cell, in
/// `columns`' order along each row, then row by row (backward: the last),
/// strictly after `after` and up to `until` inclusive, whose exact text
/// contains `term`, both lowercased. A NULL never matches.
pub struct FindQuery {
    pub term: SharedString,
    /// The shown columns, by index, in their drawn order.
    pub columns: Vec<usize>,
    /// None: from the first row's first cell (backward: the last's last).
    pub after: Option<FoundCell>,
    /// None: to the last row (backward: the first).
    pub until: Option<FoundCell>,
    pub backward: bool,
}

pub type FindLoad = Pin<Box<dyn Future<Output = Result<Option<FoundCell>, PageError>>>>;

// TallTableDelegate:
/// Starts a find (`find`), a read like `load_page`: its request from the
/// same ids, cancelled through `cancel`, its load resolving after a cancel.
/// `None` refuses (the default). A long scan should run in windows, so a
/// cancel stops it and page reads go between them.
fn find(&mut self, query: &FindQuery, cx: &mut App) -> Option<(Self::Request, FindLoad)> { None }

impl<D: TallTableDelegate> TallTableState<D> {
    /// Sets the term (`None` or empty: no find): highlighted in the drawn
    /// cells; a find out cancelled, the current match forgotten. The same
    /// term again changes nothing.
    pub fn set_find(&mut self, term: Option<SharedString>, cx: &mut Context<Self>);
    /// Steps to the next or previous match: `FindStarted`, then `Found`.
    /// Ignored with no term or a find out.
    pub fn find_next(&mut self, cx: &mut Context<Self>);
    pub fn find_previous(&mut self, cx: &mut Context<Self>);
    pub fn find_term(&self) -> Option<&SharedString>;
    pub fn current_match(&self) -> Option<FoundCell>;
}

// TallTableEvent:
/// A step started (`find`): the host's bar can show it pending.
FindStarted,
/// A step ended (`find`).
Found(FindOutcome),

pub enum FindOutcome {
    /// The current match, and whether it came round from the other end.
    Match { cell: FoundCell, wrapped: bool },
    /// No cell matches in any row.
    NoMatch,
    /// The delegate refused (`find` returned `None`).
    Refused,
    /// Its read failed: the message, as a page's.
    Failed(SharedString),
    /// Cancelled before it answered: a new term, a sort, `replace_rows`,
    /// `set_columns`, a move, a hide, or `close`.
    Cancelled,
}
```

The spec below is what part B builds; why each rule is so is in the decisions and the research. Names may be tightened in part B's code review; the rules hold.

- **The match:** a cell's exact text (`CellValue`'s `Display`: what `copy` writes and the tooltip shows) contains the term, both lowercased with `str::to_lowercase`; no NULL matches; an empty term is no find. The fold is taken a character at a time, keeping where each folded character came from, so a match's range maps back to whole characters of the text it was found in (`İ` folds to three bytes from two). The source decides which cell is next; the table, what it highlights, by this rule over each drawn cell. Where a source's text differs (DuckDB's exponents, a few case folds), the found cell is still the current match, and the README says so.
- **The columns:** the shown ones (`LaidOutColumn::shown`), by index in their drawn order (with `reorder`, its places' order); hidden columns aren't searched.
- **The step:** from whichever was set last of the current match and, with `select`, the reader's own selection (a `Cells` range's active cell; a `Rows` range's active row, searched from before its first shown cell forward, or after its last backward; a `Columns` range doesn't count, nor a selection the landing made); with neither, the cell before the top row's first shown cell (forward) or that cell (backward). `after` and `until` always name a column in `columns`: a start on a hidden column (a current match or an active cell hidden since) is taken at the nearest shown cell before its place in drawn order (forward; after it, backward), the row before's last (the row after's first) if none, or none at the first row (the last). One find out at a time, not counted in `max_in_flight`, never waited on by the plan. With no match to the end, a second ask from the other end `until` the start cell, inclusive (`wrapped`), unless the first started at the end it would come round from (`after` none), which has searched every row already; none in either, `NoMatch`. `FindStarted` once per step, `Found` once.
- **The landing:** an answer at or past the row count is dropped as `NoMatch` (a source's mistake, debug-asserted). The current match is set; a row fully in view doesn't scroll, else it lands as `jump_to` lands (at the top, clamped at the end); its column comes into view sideways unless pinned. The bring-into-view (`select`'s `scroll_into_view`, pin- and hide-aware) moves to the base, written once for both builds. With `select`, the found cell is selected itself, not as `jump_select` picks: with cells on, the cell (row and the found column), else with rows on, its row (`Selected`); a `Columns`-only selection is left. The jump's `marked` row isn't set: the current match has its own mark. With `follow`, following lets go, as at a jump.
- **What cancels and forgets:** `set_find` cancels a find out and forgets the current match. A sort, `replace_rows`, and `set_columns` cancel and forget; the next step starts from the view's top. A `set_rows` that shrinks the rows cancels a find out (its rows and `until` were of the old count) and forgets a current match it cuts; one that grows keeps both (the step doesn't reach the new rows). A move (`reorder`) and a hide or show (`hide`) cancel and keep the current match by index; a hidden current match isn't drawn, and the next step starts from it. `live`'s invalidation keeps it. `close` cancels; a step on a closed table is ignored. Every cancel emits `Found(Cancelled)`; the find's answer, if it still comes, is dropped.
- **What's drawn:** in the cells' text layer, before the glyphs (`cells_text`), over `select`'s tint: each occurrence of the term in a matching cell's drawn text (after a format and the cut), its range from the shaped line's offsets, in the theme's `selection` at saturation 0.1; a matching cell whose drawn text doesn't show the term (rounded, formatted, past the "…"), its whole box in the same color. The current match, whether or not the table's rule matches it (the source found it; `live` may have changed it since): its ranges in `selection` where its drawn text shows the term, else its whole box in `selection`, and its cell edged in the theme's `ring`, over the text: not `table_active_border`, the active cell's edge, which a reader's key moves away from the match. A cell not loaded draws nothing.
- **No keys:** the table binds none; the host's bar takes Ctrl/Cmd+F, Enter, Shift+Enter, and Escape. The README's keys section says so, and that a host's Ctrl+F that propagates lets the browser's find open.
- **The probe:** each `CellProbe` gains `found` (none, `Ranges(Vec<Range<usize>>)` of the drawn text, or `Cell`) and `current`; the probe gains `find` (the term, the current match, whether a find is out).
- **The docs:** the README's "Finding" (the rule, the columns, the step, the landing, the source's windows and its cost, the two texts' differences, the host's keys), its API table, the Features table's row, the `DataTable` table's row (none in 0.10.0) and the TanStack table's (none; its global filter is `replace_rows`), its limits, and the Canvas tradeoffs' Ctrl+F row.
- **The fixture:** `find.json` (new, `fixtures/README.md` says what it is): the match rule (an exact text, a term, matches or not: case, NULL, a float's text, a term past the "…"); the drawn ranges (a drawn text, a term, the ranges or `cell`: rounded, formatted, cut at the end and in the middle, a character whose fold is longer, `İstanbul`); the steps (a grid of exact texts, the columns' drawn order, a start, a direction: the cell and `wrapped`, `NoMatch`). Its controls: `CaseSensitive` (the test without the fold), `CutRanges` (ranges from the exact text, not the drawn), `NoWrap`. No contender runs it (no observatory level); the DuckDB engine checks its find SQL against the rule and steps when Tycho adopts the feature.
- **The random test:** a `Find` step (`set_find` with a term drawn from the source's texts or none, `find_next`, `find_previous`), placed from `with_finds` after `with_hides`, no case's draw changed. The source answers a find from its rows of its era after a delay, and resolves a cancelled one. Invariants: a landed match is a matching cell of the era in effect; one find out at most; `Found` once per `FindStarted`; every drawn tint but the current match's is on a cell matching by the rule, every drawn matching cell is tinted. Controls `KeepFindOnSort` and `CaseSensitive`, each failing its invariant. The soak on the final build (a find shares the pages' request ids and `cancel`).
- **The bare host:** `?find=<term>` and `__tallTableFind(term)`, `__tallTableFindNext()`, `__tallTableFindPrevious()` with `?perf`; its source finds over its rows in windows, `?delay` per window, for the size, frame, and smoke runs.

**Split into parts,** one session each, in order. Each part ends with its notes in `perf/results/` (where it measures) and `docs/LESSONS.md`. The milestone closes after part C.

- **A. Research and spec** (no shipped code). *Done 2026-11-18.* The research, the spike, four decisions with the owner, this spec; revised the same day after its code review (the landing selecting the found cell, not `jump_select`'s; the step's start, the later of the match and the reader's selection; a start on a hidden column; a shrink cancelling a find; no wrap from the first row; the fold's offsets; the bring-into-view moved to the base; the current match drawn whole when the rule doesn't match it, and edged in `ring`). Check A1.
- **B. The feature, built and tested.** The delegate's call, the state, the step and its cancels, the landing, the drawing, the probe, the docs, the fixture, the random test, the window tests, the bare host's hooks, the soak, `pairs`. Checks B1–B4.
- **C. The cost and the close.** The size on its own and against the base, and on each app that builds the table; the wide shape's frames with a term set; a step's time to its frame; the smoke check in three browsers; the README; the close-out ("Closing a milestone", above). Checks C1–C3.

**Done when:**
- [x] **A1. The research and the spec:** the research in the root's `docs/research/tall-table-features.md`, "Find (`find`)"; its decisions in `docs/DECISIONS.md`; the API and the checks here. *Evidence (2026-11-18):* the research section (neither `DataTable` 0.10.0 nor TanStack has a find; gpui-kit's editor search as the drawing's model; the two texts and which decides what; the source's cost; the delegate's call; the step, the landing, and what forgets the current match; the keys; the layers; each built feature's rule); the spike's note, [`perf/results/2026-11-18-m20-a-spike.md`](perf/results/2026-11-18-m20-a-spike.md) (a near match windowed in 30–130 ms on the asteroids and ~1 s on Gaia, against 2.6 s and 51 s as one query; no match, 2.5 s and 47 s either way); four decisions in `docs/DECISIONS.md`, "Features" (the match and its highlight, the columns, the delegate's call, the keys), each with the owner; `docs/LESSONS.md`, "M20" part A.
- [ ] **B1. The base unchanged:** `just tall-table test` passes with every feature off, each on, and all on; `lint` and `pairs` pass (`find` meets `select`, `hide`, `reorder`, `pin`, `sort`, `follow`, `format`, `live`, `custom-cells` in `cfg`s of two); `just tall-table size` shows no `find` symbol in the base, and `size --against <M20's parent>` reports the base unchanged.
- [ ] **B2. The feature, natively:** window tests, each with the features it needs: the delegate's default refusing (`Refused`); a step forward and back, along a row in drawn order then down, a hidden column skipped, a moved column's order followed; a wrap each way, a lone match found again, `NoMatch`, and no second ask from the first row; the start from the current match, a reader's cell and row after it, a landing's selection not counted, and the view's top; a start on a hidden column taken at the nearest shown one; an answer past the rows dropped; the landing in view (no scroll), out of view (`jump_to`'s placement), sideways (scrolled, or not when pinned), the found cell selected with cells on and its row with rows only, `marked` unset, following let go with `follow`; a step ignored while one is out and on a closed table; every cancel (`set_find`, a sort, `replace_rows`, `set_columns`, a move, a hide, `close`) emitting `Cancelled` once and its late answer dropped, and which of them forget the current match; a `set_rows` shrink cancelling a find out and forgetting a cut current match, a grow keeping both; the drawn ranges in a plain, a formatted, and a cut text, a cell tinted whole, the current match's color and edge, drawn whole after `live` changes its text away from the term, a match inside a selection; a find not counted in `max_in_flight`. Every rule mutated fails a test.
- [ ] **B3. The fixture and the random test:** `find.json` passes, `CaseSensitive`, `CutRanges`, and `NoWrap` fail it; the `Find` step runs with no existing case's draw changed; `KeepFindOnSort` and `CaseSensitive` fail their invariants (counts over `SEED`s 0–6 recorded); `just tall-table soak` passes on the final build.
- [ ] **B4. The host finds:** `?find=<term>`, `__tallTableFind`, `__tallTableFindNext`, and `__tallTableFindPrevious` in the bare host, its source windowed, so `size`, `perf`, and `smoke` measure the feature.
- [ ] **C1. Its cost:** `find`'s bytes alone and with every feature, against the base (brotli 11, and after wasm-opt), in a `perf/results/` note, and each app that builds the table (Tycho, the observatory's GPUI contender, Kirkwood) in its own `perf/results/` (root `CLAUDE.md`, rule 1); `just tall-table perf` in the wide shape with a term matching often against none set: frame work within the spread, or the tests cached per page and the run again; a step's time to the frame drawing its match (the table's own work, the source answering at once).
- [ ] **C2. In the browsers:** `just tall-table smoke` finds in Chromium, Firefox, and WebKit, in both shapes: the ranges drawn at the shaped text's offsets (a probe's ranges against the glyphs), a cell tinted whole, a step landing out of view and sideways, a wrap.
- [ ] **C3. The README and waiting apps:** the README's "Finding", its API list, the Features row (`find` and its cost), the `DataTable` and TanStack tables' rows, the limits (the two texts, the source's cost of a term with no match), the Canvas tradeoffs' Ctrl+F row; Tycho's "Waiting on" row flipped to *Ready* (2026-…, tall-table M20).

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

None drafted: find is the active milestone, and every other candidate waits for a host ("Candidates", "Notes").

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
