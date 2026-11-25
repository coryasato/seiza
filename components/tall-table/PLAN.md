# PLAN.md — tall-table

What's next for the tall table: the candidates for its next features, the active milestone's "done when" checks, long-term goals, and open questions. Only what's still open lives here. It's the one list of the table's features to come: an app adopts one as a milestone of its own and links here, and never restates the spec.

**Goal:** the table's own features on its f64-row scroll model, each a Cargo feature off by default, so a host pays only for what it turns on. `DataTable`'s interactions are built (how each differs, and what wasn't carried over: [`README.md`](README.md), "How it differs from `DataTable`"); what comes next is a candidate from `DataTable`'s later releases or from TanStack Table, each researched before it's built ("Candidates", below). The observatory adds a feature level only for a feature both its sides build (`.claude/rules/comparison-protocol.md`).

**Where everything else lives:** what it offers today, and how it compares with `DataTable` and TanStack Table, in [`README.md`](README.md); its rules and architecture in [`CLAUDE.md`](CLAUDE.md); how a feature's cost is measured in [`perf/CLAUDE.md`](perf/CLAUDE.md), "Measuring a feature"; finished milestones in [`docs/milestones.md`](docs/milestones.md); decisions in [`docs/DECISIONS.md`](docs/DECISIONS.md) (why this file exists: root [`docs/DECISIONS.md`](../../docs/DECISIONS.md), "Repo structure", 2026-10-23); surprises in [`docs/LESSONS.md`](docs/LESSONS.md); what it measures of itself in `perf/results/`.

---

## Status

M1–M24, the two hardenings (between M7 and M8, and after M17), and the public API's review are done, the last on 2026-11-22: `DataTable`'s features, the observatory's and Kirkwood's asks, their follow-ups, the features tested together, `replace_rows`, the table's part of Tycho's filters, `hide`, its column visibility, `find`, its search that keeps every row, `popover`, a cell's full value with a button to the host's view of its row, `header-icon`, a column's icon the host sets, its press reported, the popover's three settings (the cue and Enter on a cut text alone, a cue that fades with a mark for the open cell, a button the popover's width), with a long value's cell drawn from its start, and `clicks`' header tap, a finger's tap on a header's arrow or band its header's press ([`docs/milestones.md`](docs/milestones.md)).

| Milestone | Title | Status |
|---|---|---|
| M24 | Touch presses, a header's tap as one press | Done 2026-11-22 |

Next: M25, the fit as a call, which Tycho asked for ("Next milestones"); every other candidate waits for a host ("Candidates").

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

Spec rows with research questions, not specs yet; each one's research settles them, and may end it ("How a candidate is assessed", above). Tycho's three asks for its first release are milestones: the header icon (M22), the popover for cut text (M23), and touch presses (M24) are built; the fit as a call (M25, "Next milestones") makes a built behavior a call and has no row here; no other row is drafted, and every other candidate waits for a host ("Notes").

### Notes

Not planned; each waits for a host to ask, and is researched as any candidate is. None is built past what its note says: a candidate leaves this list when its milestone opens (Tycho's header icon was M22, its popover for cut text M23, and touch presses M24, all built). Global filtering left it built: its table's part was `replace_rows` alone (M18), and the README's "TanStack Table's features" has its row.

#### Reading the shown columns only

A source told which columns are shown reads fewer.

- **Table's part:** Telling the delegate the shown columns (off unless the source asks); a show re-reads every loaded page without a flash (`live`'s re-read); a copy reads only what it writes
- **Engine's or host's part:** The page query's column list (`sql.json` grows a case)
- **Notes:** Left out of M19 (2026-11-18, [`docs/DECISIONS.md`](docs/DECISIONS.md), "Features"): it changes what a page holds and reaches the paging, the cache's bytes, and the soak. Researched if Tycho measures a wide file's page reads as its cost; weighed with "Pages of the visible columns only" ("Open questions"), its sideways twin

#### Column filtering

A predicate per column; the row count follows.

- **Table's part:** Built: `replace_rows` (M18, closed 2026-11-18), which is all a filter needs of the table. Still open, only if a host asks: a filter control drawn in a header, which `header-icon` (M22, closed 2026-11-21) may already be: an icon whose path or color the host changes, its press an event of its own
- **Engine's or host's part:** The `WHERE`, the new `count(*)`, pages over the filtered rows; the filter's UI and its state
- **Notes:** Like `sort`, a source paging by row-group range can't page a filtered result; how it does is the source's (the DuckDB engine's research, as `sort`'s was). Tycho's ask is met (M18, closed 2026-11-18); the header control is built only if it asks for one. Advice for that research: start from `header-icon`'s decisions ([`docs/DECISIONS.md`](docs/DECISIONS.md), "Features", 2026-11-21): a "filtered" state is another path or color (`set_column_icon`), the press is reported on release with the icon's bounds for a host's popover, and a new `ClickTarget` was weighed and rejected there. What's left to weigh is a second icon in one header, and a public reader of a header cell's bounds if a host needs one with no press

#### Multi-column sort

Sort by several columns, Shift-click to add; priority numbers on the arrows.

- **Table's part:** The arrows' Shift-click and their numbers; the list of keys
- **Engine's or host's part:** `ORDER BY a, b`, and its cost
- **Notes:** The API's shape is settled (2026-11-17, [`docs/DECISIONS.md`](docs/DECISIONS.md), "Component API"): the delegate's `sort`, `sort()`, `set_sort`, `Sorted`, and `SortRefused` carry a list of keys, and the table sorts by one at most (`set_sort` refuses two, the state holds one). Left for the feature, each to research: the state's list, what the arrows draw (a priority, with no room in the box today), what a plain click does to a two-key sort, what `set_columns` keeps when one key's column is gone, the bridge's published shape (the first key today), and the cost in a source (`ORDER BY a, b`). It waits for a host

#### Right-pinned columns

Columns fixed at the right.

- **Table's part:** An extension of `pin`, which is left only
- **Engine's or host's part:** —
- **Notes:** Only if a host asks. How `DataTable` does it (`ColumnFixed::Right`, `fixed_right`, since gpui-kit 0.9.1): [the 0.9.1 note](perf/results/2026-11-10-gpui-kit-0.9.1.md)

#### Row pinning

Data rows kept at the top or bottom while the rest scroll.

- **Table's part:** Rows drawn above or below the body, outside the scroll, read apart from the pages
- **Engine's or host's part:** Which rows are pinned, held by an identity the source gives, since the table knows only indices and `sort` (or `replace_rows`) changes what an index means
- **Notes:** TanStack's (`row.pin('top' | 'bottom')`, state `{ top, bottom }` of row ids, `getTopRows`/`getCenterRows`/`getBottomRows`; `keepPinnedRows`, on by default, keeps a pinned row in view when a filter drops it) pins rows by id. The table has no row identity: research first, against the footer below

#### Footer row

A row under the body, a cell per column.

- **Table's part:** The row drawn under the body, outside the f64 index, its cells formatted as their columns' (`format`)
- **Engine's or host's part:** Its values (totals, averages: an aggregate query, run again as the rows change)
- **Notes:** TanStack's column `footer` is a render slot with no access to the rows: the app computes what it shows. Suggested as row pinning's stand-in; whether it is one is part of the research, since the two answer different asks (a summary, against a row kept in view)

#### Tree rows

A flattened list in which expanding a row inserts its children below it, with an indent and a disclosure arrow, at the fixed row height.

- **Table's part:** The indent, the arrow, and its press; a row's depth and whether it's open, from the page; an insert of *k* rows after row *r* (every index past *r* shifts: the pages after it are re-read or moved, what's kept by index past it moved)
- **Engine's or host's part:** Which rows exist, open or closed, in order (`GROUP BY`, a parent's children); a group's sums
- **Notes:** Merges TanStack's grouping and aggregation and expanding. Its gap is the insert mid-list, which `set_rows` (the tail) and `replace_rows` (everything) don't cover. **Ruled out:** detail panels of variable height: they break the uniform f64 row index every scroll, jump, and page is built on (a cell's full value is the cell popover's, `popover`). Tycho's grouping starts as a new table (`replace_rows` with `set_columns`: the root's research, "`replace_rows`"); tree rows only if it asks for groups expanded in place

#### Row marks

Bookmarks or tags on rows, drawn in the row-number gutter.

- **Table's part:** The mark drawn in the gutter, and its press through `clicks`
- **Engine's or host's part:** Which rows are marked, held by an identity the source gives, and what a mark means (a tag, a note)
- **Notes:** Tycho's ask, after its first release. The same gap as row pinning: the table knows only indices, and `sort` or `replace_rows` changes what an index means. Researched with row pinning, so row identity is settled once for both

#### Column summaries in the header

A strip under each column's header: a small histogram, a null share.

- **Table's part:** The strip drawn under the header, at the header's widths, from values the host gives (bins, shares), and its press through `clicks`
- **Engine's or host's part:** The profile's query (`SUMMARIZE`, a histogram); when it reruns as the rows change
- **Notes:** Not asked yet (2026-11-20): Tycho's design puts the profile in its columns panel first, and asks for the strip only once that proves fast enough ([its research](../../docs/research/tycho-workbench.md), "The column profile's cost": the queries are the cost, not the drawing). If asked, the table draws from the host's numbers, with a placeholder and a muted look for a summary still being read. Advice for that research: it's the footer row's sibling (a row outside the body's index, drawn from the host's values), so if both are asked for, research them together; a column's type label is the simplest thing the strip could show

### Not the table's, not listed, and editing

**Not the table's:** faceting (each column's distinct values, or its min and max, for a filter's UI) is aggregate queries and a host's UI; the table has no part in it.

Not listed: TanStack's pagination (the table scrolls instead) and fuzzy filtering (a kind of global filtering, the source's query through `replace_rows`).

**Editing is not on the list** (the table is read-only, and a paste lands in another app, which undoes it). If editing or paste-into-cells is ever added, undo and redo come in the same milestone, not after: a mistaken paste needs a quick remedy (noted 2026-10-26).

### Who's waiting

Only this file builds the table's features, whichever app asks (root `CLAUDE.md`, "Docs: one home per fact"). An app that needs one keeps a row in its PLAN's "Waiting on" table; closing the feature's milestone flips that row to *Ready*. When an app asks for a new feature, it gets a row under "Candidates" and one here.

In the order they're built:

| App | Asks for | Why | Built in | Status |
|---|---|---|---|---|
| Tycho ([its PLAN](../../apps/tycho/PLAN.md), "Waiting on") | The fit as a call | Its column's menu's "Fit to its values" | Drafted ("Next milestones"), before its menus' part | *Not ready* |
| Tycho | Multi-column sort | Its sort editor as a list, after its first release | Not planned ("Notes") | *Not ready* |
| Tycho | Column summaries in the header | Its column profile's strip, only once its panel's profile proves fast enough | Not planned ("Notes"): not asked yet | *Not ready* |
| Tycho | Row marks | The investigator's bookmarks and tags, after its first release | Not planned ("Notes"), with row pinning's research | *Not ready* |

Every earlier ask is built and *Ready* in its app's PLAN.

---

## Active milestone

None. M25, the fit as a call, is drafted for Tycho ("Next milestones"); every other candidate waits for a host ("Candidates").

---

## Follow-ups to built features

### Bugs

Found by the code review of 2026-11-19 (after `find` closed), a nit; fixed in a session of its own, with a check that fails before its fix. (The review's `find` and harness findings are fixed: [`docs/milestones.md`](docs/milestones.md), "M20 follow-up".)

- **Docs: milestone IDs in the bodies of `docs/DECISIONS.md` entries** ("part A's draft", "Revises check C1's remedy", and others since 2026-10-24), where the root `CLAUDE.md` allows them only in the *[source]* tags. Fix: name the thing in each; and `check-terms` made to read `DECISIONS.md`'s bodies (outside its tags), so it can't drift again.

### A sort's wait

Found on a phone (2026-11-22, by hand, an iPhone 13 in Safari and Chrome): every sort in the bare host froze the table for a noticeable while, its scroll included. Its in-memory source works out a column's order of 1.57 M rows inside the delegate's `sort`, on the main thread, so no frame draws until it returns; the table can show nothing then, an indicator included. Researched before anything's built: how long a sort takes on a phone; whether the bare host sorts off the main thread (or in steps) so its sorts look like a real source's; and whether the table shows a sort in progress (its arrow, the header, or the placeholders already drawn while the first page of the new order is out) for a source that sorts in the background, as Tycho's DuckDB does in a worker. The owner asked for a "working" indicator.

### A sideways scroll over the header

Found by M24's research (2026-11-22): a wheel or a finger's pan that starts on the header scrolls nothing, since the table's wheel is the body's. With a mouse nobody noticed; at a phone a finger that lands on the header to pan the columns reads as stuck. The base's scroll, not `clicks`'. Built if a host's phone layout needs it (Tycho's hasn't asked): a sideways delta over the header scrolls the columns, a vertical one still nothing, with its size reading on the base.

### `custom-cells`

Built 2026-10-25 ([`docs/milestones.md`](docs/milestones.md), "M2 follow-up"); what's left:

**Later, as notes** (each adds without breaking; built when a host asks):

- **Stepped ramps** (`Ramp::stepped`, the nearest stop, no mix): bucketed heat maps, as Grafana's thresholds are. Not needed for categories: a category mapped to its stop's place (k / (n − 1)) lands on the stop already.
- **A bar-only column** (the text hidden, Excel's "Show Bar Only"): it widens the color-alone tradeoff (README, "Canvas tradeoffs"), since the number is no longer drawn, so the tooltip must show every hovered cell's exact value in it, not only a rounded or cut one, and the README says so.

### Rules in `CLAUDE.md` files that could be checks

Each through `/code-review` as code; once built, its sentence in the `CLAUDE.md` shrinks to a pointer.

- **The served build's gpui-kit** (`perf/CLAUDE.md`, "A build from another commit is labeled with this tree's gpui-kit"): the scripts record `versions` from the lockfile, so an A/B's results are hand-corrected. Shape: each script that writes results records gpui-kit from the served wasm (`shared-web/perf/`'s `wasmCrateVersion`, as the observatory's metric scripts do), and the gotcha goes.
- **`Filled`'s mark lands in the presenting task** (`CLAUDE.md`, rule 4): Tycho's table check asserted it, and was retired with Tycho's measurements on 2026-11-23 (Tycho M11 part A's code review); `smoke` asserts `live`'s and `follow`'s marks and not the base's. Shape: the bare host marks after `Filled` as Tycho did, and `smoke` checks it with `presentedMark` after the first rows and after a scroll that loads a page, in all three browsers.
- **Every length through `sizes()`** (`src/CLAUDE.md`, "Rules"): a row height, padding, or text size read from a constant skips `density`. Shape: a lint in `just tall-table lint` failing on a `px(<literal>)` length in `src/` outside `density.rs`, `column.rs`'s stand-in, and an allowlist.

---

## Next milestones

Specs drafted ahead, so a waiting app can read what's coming; each one's checks are tightened when it becomes active.

### M25: the fit as a call

Asked by Tycho for its column's menu ("Who's waiting"). One session; no research part, since it builds no new behavior (`docs/DECISIONS.md`, "Features", 2026-11-24): the fit a double-click at a header's edge already does (`resize`, `src/state/resize.rs`'s `fit_column`), made a call a host can make.

- [ ] **A1. `TallTableState::fit_column(column, window, cx)`,** behind `resize`, by the column's index (not its place, so a host's call means the same column after a move, `reorder`), fitting it as the double-click does. The private `fit_column(at, …)`, by place, is the one fit: it becomes this call, by index, and the double-click passes its column's index, so there's one function and one meaning for its argument. It fits the column to its header's name, sort arrow, and icon, and its visible, loaded rows, clamped; `ColumnWidthsChanged` emitted when the width changed, nothing when it didn't; a hidden column (`hide`) or an index past the columns does nothing. The double-click calls the same code.
- [ ] **A2. Its checks and its cost:** a window test (the call and the double-click give one width, by index after a move; a hidden column untouched); `just tall-table test`, `lint`, and `pairs` (the call reads `hide`'s flag under `cfg(feature = "hide")`, since a host can name a hidden column where a double-click never reaches one: a `resize` and `hide` pair, so `pairs` runs before the code review); its bytes in the bare host by `just tall-table size` against M24's, recorded in `perf/results/` with a note, and the README's `resize` row and API section updated. Closing it flips Tycho's "Waiting on" row to *Ready*.

Tycho's earlier asks for its first release, the header icon (M22), the popover for cut text (M23), and touch presses (M24), are built ([`docs/milestones.md`](docs/milestones.md)).

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
