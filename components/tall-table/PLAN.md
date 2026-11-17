# PLAN.md — tall-table

What's next for the tall table: the candidates for its next features, the active milestone's "done when" checks, long-term goals, and open questions. Only what's still open lives here. It's the one list of the table's features to come: an app adopts one as a milestone of its own and links here, and never restates the spec.

**Goal:** the table's own features on its f64-row scroll model, each a Cargo feature off by default, so a host pays only for what it turns on. `DataTable`'s interactions are built (how each differs, and what wasn't carried over: [`README.md`](README.md), "How it differs from `DataTable`"); what comes next is a candidate from `DataTable`'s later releases or from TanStack Table, each researched before it's built ("Candidates", below). The observatory adds a feature level only for a feature both its sides build (`.claude/rules/comparison-protocol.md`).

**Where everything else lives:** what it offers today, and how it compares with `DataTable` and TanStack Table, in [`README.md`](README.md); its rules and architecture in [`CLAUDE.md`](CLAUDE.md); how a feature's cost is measured in [`perf/CLAUDE.md`](perf/CLAUDE.md), "Measuring a feature"; finished milestones in [`docs/milestones.md`](docs/milestones.md); decisions in [`docs/DECISIONS.md`](docs/DECISIONS.md) (why this file exists: root [`docs/DECISIONS.md`](../../docs/DECISIONS.md), "Repo structure", 2026-10-23); surprises in [`docs/LESSONS.md`](docs/LESSONS.md); what it measures of itself in `perf/results/`.

---

## Status

M1–M17 and the hardening between M7 and M8 are done, the last on 2026-11-16: `DataTable`'s features, the observatory's and Kirkwood's asks, and their follow-ups ([`docs/milestones.md`](docs/milestones.md)).

| Milestone | Title | Status |
|---|---|---|
| — | Hardening 2: the features since the first hardening, together | Planned, next ("Next milestones") |
| — | The public API reviewed, with `sort`'s keys: one break, if any | Planned, after the hardening ("Next milestones") |
| M18 | `replace_rows`: every row index changed meaning, one call | Planned (its row under ["Candidates"](#drafted)) |
| M19 | Column visibility: hide and show columns | Planned (its row under ["Candidates"](#drafted)) |

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
| **M18. `replace_rows`** (a working name: `set_rows` means the same rows grown or cut, `invalidate_rows` the same indices with new values; this means every index means another row) | One public call for "every row index changed meaning", `sort`'s reset made public: every page forgotten and its read cancelled; what's kept by index cleared (a `Rows` or `Cells` selection, the jump's highlight, hover, the tooltip, `live`'s invalidations and flashes, `follow`'s drawn tail, a copy running); the new count taken; the view at the top or a row the host names; the new rows' reads planned once the update ends. What a filter, a global search's filter, or a query run again needs from the table | The reset, in the base: `apply_sort` is base code already but for its `cfg`'d hooks, and a host's filter needs it with no feature on. `sort` calls it, with the count unchanged and the top, then emits `Sorted`; `sort`'s behavior doesn't change. With `follow`, following is kept only when the host names the end (a filtered live tail stays live), and lets go at any other row, as `sort`'s top does today | The new rows: the source swapped (a `WHERE`, a new query) and its count (`count(*)`), the filter's or the query's UI | **The swap's race:** `sort` rejected a host swapping its source and calling the table to re-read (each host gets the races right on its own); here the host must. Does the call take the swap (a closure given the delegate, run before the reset, so nothing reads between), or does it document "in the same update"? A read sent before the call that answers after it is never stored (the cache's rule today); check it holds at the call. **The count that arrives later:** a filter's `count(*)` answers after its first page could; is the call made once the count is known (the old rows drawn meanwhile, with nothing saying a filter is pending), or with an estimate grown by `set_rows`? **The named row:** `jump_to`'s placement and highlight, or the top at that row and no highlight? **A `Columns` selection:** kept with its rows at the named row, as `sort` moves them to 0? **`follow`'s kept case:** is "the end" a value of the target (`At::End`), so one call sets one `Following` state, rather than the host calling `follow()` after a let-go (`Following(false)`, then `true`, in one update)? **The base's cost:** the bytes it adds to every app's base (rule 1: recorded in each app's notes), small but not zero, since a function's body moves out of `sort`. **Checks:** the paging fixture's `sort` step generalized (`paging.json`: a replace with a new count, at the top and at a row, a control that keeps the pages); the random test's `sort` step becoming a `Replace` step (a new count, a permutation, every row's era bumped), `sort`'s invariants kept; the soak, since it changes the paging (`CLAUDE.md`, rule 5) |
| **M19. Column visibility** (Cargo name a draft: `hide`) | Hide and show columns: a hidden column is laid out at no width, drawn nowhere, and hit-tested nowhere; it keeps its place, its width, its sort, and its group, and comes back where it was | Which columns are hidden, held by identity as `group-headers`' labels are: a flag on the column's state, following it through `reorder`'s moves and kept across `set_columns` for a column of the same name (the rule `sort` uses), never a list of places. An event when it changes, so a host keeps it. Optionally, telling the delegate which columns are shown, so a source can read fewer: an optimization a source may ignore, off unless the source says it wants it | The control that hides (a menu through `clicks`, a column chooser); with the delegate told, the page query's column list (`sql.json` grows a case) | **`pin`'s count:** does it count places (a hidden pinned column still one of the *n*), or shown columns? Places keeps the count stable as columns are hidden and shown; shown columns is what the reader sees. **`select`'s ranges:** a `Columns` or `Cells` range over a hidden column keeps it (ranges are of places), drawn as one tint across the gap? Shift-extend and the arrow keys skip it? **`copy`:** are hidden columns copied? (Excel's copy of a range takes hidden columns unless told "visible cells only".) The leaning: shown columns only, the header line too, and `copy.json` gets cases. **`reorder`:** where does a drop between two shown columns with hidden ones between them land, and does a hidden column move with a dragged block? **`group-headers`:** a group with every column hidden draws no cell and takes no press; a partly hidden group spans its shown columns; a move still keeps the hidden ones in their run. **`resize`'s fit and `sort`'s arrow:** a hidden sorted column keeps the sort (nothing says so on screen: a canvas tradeoff for the README?). **`clicks`' targets and the probes:** places with hidden ones skipped, or kept. **The fixtures:** a hidden column in `pin.json`, `reorder.json`, `group-headers.json`, and `copy.json`; a DOM contender's skip. **The delegate's narrowed read:** a page then holds fewer columns, and showing one re-reads every loaded page (as `live`'s re-read, without a flash). That reaches the page's contents and the paging, unlike the rest; if the research finds it's more than a part, it's a milestone of its own after M19, decided there, not split off quietly |

### Notes

Not planned; each waits for a host to ask, and is researched as any candidate is.

| Candidate | What it adds | Table's part | Engine's or host's part | Notes |
|---|---|---|---|---|
| Column filtering | A predicate per column; the row count follows | `replace_rows` (M18). If a host asks: a filter control drawn in a header, its press reported through `clicks` (a new `ClickTarget`) | The `WHERE`, the new `count(*)`, pages over the filtered rows; the filter's UI and its state | Like `sort`, a source paging by row-group range can't page a filtered result; how it does is the source's (the DuckDB engine's research, as `sort`'s was) |
| Global filtering | One predicate across every column: fewer rows | `replace_rows` (M18) | The query across every text column; the search box | The filtering half of TanStack's global filter. Fuzzy filtering is a kind of it |
| **Find** | Every row kept; move to the next or previous match, the matched text highlighted in the visible cells. The route to closing Ctrl+F (README, "Canvas tradeoffs") | A jump to the match's row, its column brought into view; the matched text highlighted in the visible cells, from a term the host sets | The bar, its keys, and its text input (the host's DOM or its own GPUI input, so the table takes no text input); "the next match after row *r*" and "the previous before *r*" (a row and a column, or none), answered by the source's query; the match count, if the host shows one | Its own candidate, not filtering's. What the table highlights (the shown text, so a formatted number matches as drawn?) and what the source matches (the exact value) can disagree: research first |
| Multi-column sort | Sort by several columns, Shift-click to add; priority numbers on the arrows | The arrows' Shift-click and their numbers; the list of keys | `ORDER BY a, b`, and its cost | Checked 2026-11-16: `sort`'s delegate call can't grow from one column to a list without a break. `TallTableDelegate::sort(Option<Sort>)`, `state.sort() -> Option<Sort>`, `set_sort`, `Sorted(Option<Sort>)`, and `SortRefused(Sort, _)` all carry one `Sort`, and `Sort` is `Copy`, so a list inside it would drop the derive. It extends additively: a new delegate call taking `&[Sort]`, whose default calls `sort` for zero or one key and refuses more, with a state getter and event beside today's, the one-key API kept as the list's first key. Or one break while every consumer is in this repo (0.1.0): the call takes a list from the start. The API question is settled with the public API review, before M18 ("Next milestones"); the feature waits for a host |
| Right-pinned columns | Columns fixed at the right | An extension of `pin`, which is left only | — | Only if a host asks. How `DataTable` does it (`ColumnFixed::Right`, `fixed_right`, since gpui-kit 0.9.1): [the 0.9.1 note](perf/results/2026-11-10-gpui-kit-0.9.1.md) |
| Row pinning | Data rows kept at the top or bottom while the rest scroll | Rows drawn above or below the body, outside the scroll, read apart from the pages | Which rows are pinned, held by an identity the source gives, since the table knows only indices and `sort` (or `replace_rows`) changes what an index means | TanStack's (`row.pin('top' \| 'bottom')`, state `{ top, bottom }` of row ids, `getTopRows`/`getCenterRows`/`getBottomRows`; `keepPinnedRows`, on by default, keeps a pinned row in view when a filter drops it) pins rows by id. The table has no row identity: research first, against the footer below |
| Footer row | A row under the body, a cell per column | The row drawn under the body, outside the f64 index, its cells formatted as their columns' (`format`) | Its values (totals, averages: an aggregate query, run again as the rows change) | TanStack's column `footer` is a render slot with no access to the rows: the app computes what it shows. Suggested as row pinning's stand-in; whether it is one is part of the research, since the two answer different asks (a summary, against a row kept in view) |
| **Tree rows** | A flattened list in which expanding a row inserts its children below it, with an indent and a disclosure arrow, at the fixed row height | The indent, the arrow, and its press; a row's depth and whether it's open, from the page; an insert of *k* rows after row *r* (every index past *r* shifts: the pages after it are re-read or moved, what's kept by index past it moved) | Which rows exist, open or closed, in order (`GROUP BY`, a parent's children); a group's sums | Merges TanStack's grouping and aggregation and expanding. Its gap is the insert mid-list, which `set_rows` (the tail) and `replace_rows` (everything) don't cover. **Ruled out:** detail panels of variable height: they break the uniform f64 row index every scroll, jump, and page is built on |

### Not the table's, not listed, and editing

**Not the table's:** faceting (each column's distinct values, or its min and max, for a filter's UI) is aggregate queries and a host's UI; the table has no part in it.

Not listed: TanStack's pagination (the table scrolls instead) and fuzzy filtering (a kind of global filtering).

**Editing is not on the list** (the table is read-only, and a paste lands in another app, which undoes it). If editing or paste-into-cells is ever added, undo and redo come in the same milestone, not after: a mistaken paste needs a quick remedy (noted 2026-10-26).

### Who's waiting

Only this file builds the table's features, whichever app asks (root `CLAUDE.md`, "Docs: one home per fact"). An app that needs one keeps a row in its PLAN's "Waiting on" table; closing the feature's milestone flips that row to *Ready*. When an app asks for a new feature, it gets a row under "Candidates" and one here.

None open: every ask so far is built and *Ready* in its app's PLAN.

---

## Active milestone

None. The second hardening comes next, then the API review with `sort`'s keys, then M18 (`replace_rows`), unless an app's ask comes first ("Next milestones", below).

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

- **Hardening 2** (decided 2026-11-16; not a feature, three parts as the first hardening's: [`docs/milestones.md`](docs/milestones.md), "Hardening"). Ten pieces of work went in since the first (`sort` through `group-headers`), each reviewed alone, never tested together.
  - **A. Audits and spec:** every piece of state held by index or by place (`sort`'s column, `resize`'s drag and `column_width`, `select`'s ranges, `clicks`' targets, `pin`'s count, `group-headers`' paths), each mapping checked through a move, `set_columns`, and `set_order`; every press or key that reads the last frame's geometry instead of what's in effect after a host's call (M17's group press was one); each behavior the README promises matched to the test that proves it, the gaps listed. The new steps and invariants specced, each with the control that must fail it.
  - **B. The random test grown:** pointer steps it lacks (`resize`'s band drag and fit, a wheel during a drag, a move with the button up, `clicks`' presses and their counts) and header drags in a `reorder` build without `group-headers` (today `DragColumns` needs both). Invariants beyond the paging: every drag ends idle, widths within their least and most, the order a permutation, the table's own moves keep groups whole, `pin`'s count moves only by the columns that crossed, the selection valid for the columns and rows, a point in a drawn column hits it (under `pin`, `density`, the groups' rows, the arrows, and the bands). Every feature pair compiled and clippy-clean (13 features: 13 builds and 78 pairs, the table, the bridge, the host): its tool audited first (`cargo-hack`'s `--feature-powerset --depth 2` against the alternatives and a script over the feature list, by time), then a recipe of its own, not in `lint`; the tests run only on the pairs with code gated on both. The soak's feature list checked against every feature built.
  - **C. The fixes, the soak, the close:** each bug found a scenario test, the soak on the final build, the size effect if shipped code changed.
- **The public API reviewed, with `sort`'s keys** (after the hardening). Every public item listed and read against gpui-kit's Coding Guides ("Public API design", "File and naming conventions") and the table's own prefixes: public fields (`Sort`, `GroupProbe`, `TallTableLayout`, …) against the guides' builders and readers, decided type by type (a probe is a snapshot); `#[non_exhaustive]` where a type may grow; events emitted only at a change, marks in render (`CLAUDE.md`, rule 4); a doc comment on every item (`#![warn(missing_docs)]`). With it, whether `sort`'s API takes a list of keys (the multi-column sort note under ["Candidates"](#notes)), the one candidate whose cost grows the longer it waits. Findings first; the clear non-breaking fixes applied; every breaking change listed with its reason for the owner's yes, then made as one change while every consumer is in this repo (0.1.0).
- **M18. `replace_rows`:** drafted as a spec row with research questions (["Candidates"](#drafted)); its spec and checks are written in its part A.
- **M19. Column visibility:** the same, after M18. If its research finds the delegate's narrowed read is more than a part, that read becomes a milestone of its own after M19, decided there.

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

- **More late frames in a throttled wide fling with a feature built** (found in M4 part D with `follow`, again in M5 part D with `resize`): with `follow`, over 20 runs each, in both orders, ~8% late (median) against the base's ~3.5%, ranges overlapping (base 0.5–9.6%, `follow` 4.0–12.1%); with `resize`, 5.1% against 2.0% over 10 each (base 1.5–8.4, `resize` 1.0–12.0), its runs' p95 at ~30 ms in 7 of 10 against the base's 3 (the two modes ~15 and ~30 ms). With `select` (M6 part D), 4.1% against 2.75% (base 0.5–8.4, `select` 1.5–6.8), with no frame cost measured in any segment. With `pin` (M9 part D) it didn't show: 1.96% against the base's 2.99% (base 1.5–6.8, `pin` 0.5–4.5). Work per frame, busy time, and placeholders the same; not in the narrow fling or any reference segment. `follow`'s code on that path is a comparison per wheel and an early return per page landing, and `resize`'s the bands' ~0.1 ms a frame, which every reference segment shows without a late frame, so it's likely not either feature's code (the build's layout, say). Worth a trace comparison of the two builds' slow frames before an app adopts `follow` on a slow machine; not a blocker for the feature, whose frame work matches.
- **Pages of the visible columns only** (two-dimensional paging): a page holds every column of its rows, so at the wide shape's 500 floats it's ~4 MB of Arrow and the 64 MiB cache holds ~16 pages. A page of the visible column range would cut the bytes read, sent, and decoded per frame of a sideways scroll, but it changes the delegate's unit and every paging decision, and a sideways scroll would then read pages too. Noted 2026-10-30 from the observatory's wide sheet, which keeps full-row pages (the same on both sides); worth research only if its data path measures the page's cost as the wide sheet's bottleneck.
- **Vertical cell borders** (`DataTable`'s `bordered`): the base draws row lines but no column lines. Nobody has asked; a wide sheet of heat cells may want them.
