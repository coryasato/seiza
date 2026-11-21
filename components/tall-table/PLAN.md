# PLAN.md — tall-table

What's next for the tall table: the candidates for its next features, the active milestone's "done when" checks, long-term goals, and open questions. Only what's still open lives here. It's the one list of the table's features to come: an app adopts one as a milestone of its own and links here, and never restates the spec.

**Goal:** the table's own features on its f64-row scroll model, each a Cargo feature off by default, so a host pays only for what it turns on. `DataTable`'s interactions are built (how each differs, and what wasn't carried over: [`README.md`](README.md), "How it differs from `DataTable`"); what comes next is a candidate from `DataTable`'s later releases or from TanStack Table, each researched before it's built ("Candidates", below). The observatory adds a feature level only for a feature both its sides build (`.claude/rules/comparison-protocol.md`).

**Where everything else lives:** what it offers today, and how it compares with `DataTable` and TanStack Table, in [`README.md`](README.md); its rules and architecture in [`CLAUDE.md`](CLAUDE.md); how a feature's cost is measured in [`perf/CLAUDE.md`](perf/CLAUDE.md), "Measuring a feature"; finished milestones in [`docs/milestones.md`](docs/milestones.md); decisions in [`docs/DECISIONS.md`](docs/DECISIONS.md) (why this file exists: root [`docs/DECISIONS.md`](../../docs/DECISIONS.md), "Repo structure", 2026-10-23); surprises in [`docs/LESSONS.md`](docs/LESSONS.md); what it measures of itself in `perf/results/`.

---

## Status

M1–M21, the two hardenings (between M7 and M8, and after M17), and the public API's review are done, the last on 2026-11-20: `DataTable`'s features, the observatory's and Kirkwood's asks, their follow-ups, the features tested together, `replace_rows`, the table's part of Tycho's filters, `hide`, its column visibility, `find`, its search that keeps every row, and `popover`, a cell's full value with a button to the host's view of its row ([`docs/milestones.md`](docs/milestones.md)).

| Milestone | Title | Status |
|---|---|---|
| M22 | The header icon, a column's icon the host sets, its press reported | Planned: next to open |
| M23 | The popover for cut text only, its cue a fade, and a long value's cell | Planned |
| M24 | Touch presses, a header's tap as one press | Planned |

A *Planned* row's draft is under "Next milestones": what it adds, its research questions, its parts, and its checks. Its part A (the research) settles the spec and tightens the checks when it opens.

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

Spec rows with research questions, not specs yet; each one's research settles them, and may end it ("How a candidate is assessed", above). Tycho's three asks for its first release are drafted as milestones, M22–M24, under "Next milestones", each with its research questions; no other row is drafted, and every other candidate waits for a host ("Notes").

### Notes

Not planned; each waits for a host to ask, and is researched as any candidate is. None is built: a candidate leaves this list when its milestone opens (Tycho's header icon, popover for cut text, and touch presses are M22–M24, "Next milestones"). Global filtering left it built: its table's part was `replace_rows` alone (M18), and the README's "TanStack Table's features" has its row.

#### Reading the shown columns only

A source told which columns are shown reads fewer.

- **Table's part:** Telling the delegate the shown columns (off unless the source asks); a show re-reads every loaded page without a flash (`live`'s re-read); a copy reads only what it writes
- **Engine's or host's part:** The page query's column list (`sql.json` grows a case)
- **Notes:** Left out of M19 (2026-11-18, [`docs/DECISIONS.md`](docs/DECISIONS.md), "Features"): it changes what a page holds and reaches the paging, the cache's bytes, and the soak. Researched if Tycho measures a wide file's page reads as its cost; weighed with "Pages of the visible columns only" ("Open questions"), its sideways twin

#### Column filtering

A predicate per column; the row count follows.

- **Table's part:** Built: `replace_rows` (M18, closed 2026-11-18), which is all a filter needs of the table. Still open, only if a host asks: a filter control drawn in a header, its press reported through `clicks` (a new `ClickTarget`)
- **Engine's or host's part:** The `WHERE`, the new `count(*)`, pages over the filtered rows; the filter's UI and its state
- **Notes:** Like `sort`, a source paging by row-group range can't page a filtered result; how it does is the source's (the DuckDB engine's research, as `sort`'s was). Tycho's ask is met (M18, closed 2026-11-18); the header control is built only if it asks for one. Advice for that research: the icon needs a "filtered" state the host sets, as the sort arrow has; and a host's popover anchored under a header cell has only `Clicked`'s position today, since the layout event is a probe (`probe_frames`). That may be enough (gpui-kit's menus open at the pointer); if not, weigh a public reader of a header cell's bounds, which a column menu would use too

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
| Tycho ([its PLAN](../../apps/tycho/PLAN.md), "Waiting on") | Header icon | Its column's menu button, the column's type icon | M22, planned | *Not ready* |
| Tycho | The popover for cut text only, its cue a fade | Its cell popover: a glimpse of overflowing text, a cue that moves no text, Enter opening its row view everywhere else | M23, planned | *Not ready* |
| Tycho | Touch presses | Its column's and cell's menus at a phone | M24, planned | *Not ready* |
| Tycho | Multi-column sort | Its sort editor as a list, after its first release | Not planned ("Notes") | *Not ready* |
| Tycho | Column summaries in the header | Its column profile's strip, only once its panel's profile proves fast enough | Not planned ("Notes"): not asked yet | *Not ready* |
| Tycho | Row marks | The investigator's bookmarks and tags, after its first release | Not planned ("Notes"), with row pinning's research | *Not ready* |

Every earlier ask is built and *Ready* in its app's PLAN.

---

## Active milestone

None. M22, the header icon, is the next to open ("Next milestones"): its part A is its research, which settles its spec and tightens its checks.

---

## Follow-ups to built features

### Bugs

Found by the code review of 2026-11-19 (after `find` closed), a nit; fixed in a session of its own, with a check that fails before its fix. (The review's `find` and harness findings are fixed: [`docs/milestones.md`](docs/milestones.md), "M20 follow-up".)

- **Docs: milestone IDs in the bodies of `docs/DECISIONS.md` entries** ("part A's draft", "Revises check C1's remedy", and others since 2026-10-24), where the root `CLAUDE.md` allows them only in the *[source]* tags. Fix: name the thing in each; and `check-terms` made to read `DECISIONS.md`'s bodies (outside its tags), so it can't drift again.

### A long value's cell

Found 2026-11-20, measuring the cell popover ([`perf/results/2026-11-20-m21-c.md`](perf/results/2026-11-20-m21-c.md)): with a column of 10,000-character values on screen, the wide shape's steady scroll read 5.75 ms a frame against the base's 4.67, and its fling's 10.05 against 4.89 (52.6 frames a second against 59.7). The cells' text copies each drawn cell's whole value (its line breaks replaced, `cell_text`) and shapes it before cutting it to the cell, every frame. A host with long text (Tycho's JSONL, a log's messages) meets it in the base. Shape: take only as much of the value as the widest cell could show (its width over the narrowest advance, and the "…") before replacing and shaping, keeping the drawn pixels (`just tall-table smoke --screens`) and `drawn_text`'s cut; then read the same scroll and fling again. Built as M23's part B ("Next milestones"), before Tycho adopts the popover.

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

Tycho's three asks for its first release (2026-11-20, [its decisions](../../apps/tycho/docs/DECISIONS.md), "Scope"; drawn on [its design canvas](https://claude.ai/artifact/CR8skvUDrUsVxE4zXJtRmK)), drafted 2026-11-21 while its design session goes on. Each is a draft, not a spec: its part A researches it (root [`docs/research/tall-table-features.md`](../../docs/research/tall-table-features.md), a section each), settles the API with the owner, and rewrites the rules and checks here before anything is built. One is open at a time, in this order.

**Why this order:** the header icon and the popover's narrowing are settled on the canvas; the frame at a phone is still being drawn, so touch presses come last, after the icon whose press a tap has to sit with. If the phone's design settles first and Tycho needs it sooner, M23 and M24 swap: neither builds on the other.

### M22: the header icon, a column's icon the host sets, its press reported

**What it adds** (*proposed:* a Cargo feature of its own, `header-icon`, off by default; part A decides between that and a part of `clicks`): an icon at the start of each column's header, set by the host, whose press the host is told of. Tycho's is the column's type icon and opens its column's menu, a DOM menu.

- **Table's part:** the icon drawn first in the header, at the left whatever the kind's alignment, from a path in the host's asset source (as `sort`'s icons are) in a color the host gives; under the pointer, raised on a backdrop of its own (solid, with a shadow, not outlined), with the pointer cursor; its press reported through `clicks` (a new `ClickTarget`), selecting nothing; the room it takes from the name (the fit, the least width).
- **Host's part:** which icon and color each column gets, and what its press opens.

**For part A to answer:**

- **The feature's edge:** a feature of its own or `clicks`' part; what a build with the icon and without `clicks` does (drawn, its press reporting nothing, or the feature turning `clicks` on).
- **The built features:** `sort`'s arrow, which stays at the right edge, and a header too narrow for both; `resize`'s band, and the fit and least width with the icon's room; `reorder`, whose drag starts on a header's press (a press on the icon starts none); `select`, whose header press selects the column (the icon's selects nothing); `group-headers` (the leaf headers only, or a group's cell too); `pin`, `hide`, `density` (the icon's size through `sizes()`); a context press and a double press on the icon.
- **Setting it:** the icon and its color on `TallTableColumn`, and whether a host changes one column's without `set_columns` (Tycho's menu button may show a state, as the column filtering note's "filtered" does).
- **Where the host's menu opens:** `Clicked`'s position is the pointer's; a DOM menu anchored under the icon wants the icon's bounds. Weigh the bounds carried in the event against a public reader of a header cell's bounds (the column filtering note's advice, "Notes").
- **Canvas gaps:** the icon is a button no keyboard or screen reader reaches; Tycho's way in is its columns panel's row, and the README says so.
- **Frame-work risk:** an icon and a hover backdrop a header, on a wide sheet's sideways fling.

**Parts,** one session each:

- **A. Research and spec** (no shipped code): the research section, the decisions, the API and the tightened checks here.
- **B. The feature, built and tested:** the column's icon, the drawing and the raised look, the press and its target, the fit, the probe, the window tests, the random test's step if it holds state, the bare host's switch and hooks, the docs, `pairs`.
- **C. The cost and the close:** its size alone and with every feature; frame work; the smoke check in three browsers; the README; the close-out.

**Done when** (drafted; part A tightens them):

- [ ] **A1. The research and the spec:** the research section answers each question above; its decisions are in `docs/DECISIONS.md`; the API, the rules, and the checks are here.
- [ ] **B1. Off by default, the base unchanged:** `just tall-table test`, `lint`, and `pairs` pass; `size` shows none of the feature's symbols in the base, and `size --against <M22's parent>` reports the base unchanged; the fixtures pass untouched.
- [ ] **B2. The feature, natively:** window tests for each rule part A writes: the icon at the left of a left- and a right-aligned header; the name's room and the least width with it; the raised look only under the pointer; its press reported with its column, by index after a move, selecting nothing and starting no drag; `sort`'s arrow and `resize`'s band still pressed where they were; a column with no icon drawn as today.
- [ ] **B3. The host shows it:** the bare host's switch and hooks (an icon on every column, the press read back), so `size`, `perf`, and `smoke` reach it.
- [ ] **C1. Its cost:** its bytes alone and with every feature, against the base, in a `perf/results/` note, and each app that builds the table in its own `perf/results/` (root `CLAUDE.md`, rule 1); frame work in the protocol's scroll and the wide shape's sideways fling with an icon on every header, against none, within the spread.
- [ ] **C2. In the browsers:** `just tall-table smoke` draws the icons, hovers one, and presses it, in Chromium, Firefox, and WebKit, both shapes, alone and with `sort,resize,reorder,select,clicks,group-headers`.
- [ ] **C3. The README and waiting apps:** the README's section, the Features row and cost, the `DataTable` and TanStack tables' rows, the Canvas tradeoffs; Tycho's "Waiting on" row flipped to *Ready*.

### M23: the popover for cut text only, its cue a fade, and a long value's cell

**What it adds:** `popover` narrowed, at the host's request, to a text that is cut: a cue that moves no text, and Enter left to the host everywhere else. Each is a setting of the host's, off by default, the popover as built unchanged without them. With it, the base's fix for a long value's cell ("Follow-ups to built features", "A long value's cell"), which Tycho's popover would meet first: both change the cells' text element, so they're built and measured together.

- **Which cells:** the popover and its cue only on a text cut at its end or holding a line break, even with a button set, so a number or a text that fits is never cut short of the cue, and a rounded value keeps the tooltip alone.
- **Enter:** on an active cell with no popover to open, Enter goes on to the host, as it does with no `Cells` selection.
- **The cue's look:** the cell's "…" at rest; under the pointer and on the active cell the text drawn without it, washing out over its last stretch short of the cue's box, the mark at the cell's far right (turned up on the open popover's cell). Only the hovered and the active cell are drawn faded, the two cells the cue already cuts again.
- **The button:** a host's own element may fill the popover's width (today it's laid out at its own size, from the left).
- **Host's part:** which settings; the row view Enter opens.

**For part A to answer:**

- **The fade, first:** how the cells' text element fades a line (each glyph's alpha by its place, or a gradient) and what it costs. The row's background varies (stripes, `custom-cells`' fill, `select`'s tint, `live`'s flash, `find`'s tint), which ruled out a quad over the text for the mark. A spike in the bare host if it's unclear.
- **The settings' shape:** one setting or several (which cells, the cue's look, the button's width), and their names beside `set_popover_cue` and `set_popover_button`.
- **Which cells, exactly:** a NULL, a middle cut, a text cut by `format`'s fallback, a `custom-cells` cell, and `open_popover` from the host on a cell the setting excludes (refused, or the host's to decide).
- **The mark turned up:** the same mark rotated, or a second path from the host's assets.
- **Canvas gaps:** what the README's "Canvas tradeoffs" says of a cue that is only a fade and a mark.

**Parts,** one session each:

- **A. Research and spec** (no shipped code), the fade's spike with it if needed.
- **B. A long value's cell** (the base): only as much of a value as the widest cell could show is replaced and shaped, the drawn pixels and `drawn_text`'s cut kept.
- **C. The settings, built and tested:** which cells, Enter, the fade and the mark, the button's width, the probe, the window tests, the random test's step, the bare host's switches, the docs, `pairs`.
- **D. The cost and the close.**

**Done when** (drafted; part A tightens them):

- [ ] **A1. The research and the spec:** the research section answers each question above, the fade's way chosen from a measured frame; its decisions are in `docs/DECISIONS.md`; the API, the rules, and the checks are here.
- [ ] **B1. A long value's cell, the same pixels:** `just tall-table smoke --screens` matches the saved screens; the cell fixtures pass untouched, and `just observatory fixtures` after; Tycho's table checks (`just tycho table`, `cells`) pass.
- [ ] **B2. Its frames:** the wide shape's steady scroll and fling with a column of 10,000-character values, read again against the base's (5.75 ms a frame against 4.67, and 10.05 against 4.89, on 2026-11-20), within the base's spread; the base's size change recorded for each app that builds the table.
- [ ] **C1. Off by default, the popover unchanged:** `just tall-table test`, `lint`, and `pairs` pass; with no setting on, the popover's window tests and its smoke run pass untouched; `size --against <part B's commit>` reports the base unchanged.
- [ ] **C2. The settings, natively:** window tests for each rule: no cue and no popover on a number, a rounded value, and a text that fits, with a button set; Enter on such a cell propagating, and opening the popover on a cut one; the "…" at rest, the fade and the mark on the hovered and the active cell only, no text moved; the mark turned up on the open cell; the button filling the width; the random test's step where the popover's has one.
- [ ] **C3. The host sets them:** the bare host's switches for each setting, so `size`, `perf`, and `smoke` reach them.
- [ ] **D1. Its cost:** the added bytes on `popover`, in a `perf/results/` note, and each app's; frame work in the protocol's scroll with the pointer over a cut cell and an active cell faded, against the popover as built, within the spread.
- [ ] **D2. In the browsers:** `just tall-table smoke` in Chromium, Firefox, and WebKit, both shapes: the fade over a striped row and a filled cell, the mark's press, Enter on a cut cell and on one that fits.
- [ ] **D3. The README and waiting apps:** "The cell popover" and its settings, the Features row's cost, the Canvas tradeoffs; the follow-up's section removed from this file; Tycho's "Waiting on" row flipped to *Ready*.

### M24: touch presses, a header's tap as one press

**What it adds** (*proposed:* a setting of `clicks`, no feature of its own): at a touch screen, a tap anywhere on a header reports the column's press, and `sort`'s arrow isn't a target of its own. At a phone a header's zones (the arrow's box, `resize`'s 9 px band) are too small for a finger and a stray sort reads as a mistake, so Tycho's menu holds every ability. A long press on a header or a cell is already `clicks`' context press (gpui's touch recognizer, 500 ms: the README's "Presses"); this milestone checks it on a touch screen and builds only what's missing.

- **Table's part:** the host's setting, and what a header's tap reports under it.
- **Host's part:** the menu it opens; when the setting is on.

**For part A to answer:**

- **What arrives, first:** what touch input GPUI's web platform delivers (a tap as a mouse press, a pan as a scroll, the long press) in Chromium, Firefox, and WebKit, on a real phone and under Playwright's touch emulation, and what the harness can drive (`.claude/rules/perf-harness.md`). If a tap or a long press doesn't arrive, the milestone closes with a decision and what gpui-kit would need.
- **The setting's reach:** the host's for the whole table, or each press judged by its pointer's kind; whether `resize`'s band, `reorder`'s drag, and `select`'s column press stand down under it too, or only the arrow.
- **The header icon (M22):** whether a tap on it reports the icon's target or the header's under the setting.
- **A tap against a pan:** a finger that moves before lifting scrolls and reports nothing.
- **A long press's place:** `Clicked`'s position at its start, enough for a menu at a phone.

**Parts,** one session each:

- **A. Research and spec** (no shipped code): what arrives, in each browser, the decisions, the API and the tightened checks here.
- **B. The setting, built and tested,** with its cost and the close if part A finds it small; else a part C for those.

**Done when** (drafted; part A tightens them):

- [ ] **A1. The research and the spec:** the research section says what touch input arrives in each browser, with how it was read; its decisions are in `docs/DECISIONS.md`; the API, the rules, and the checks are here, or the milestone closes on a decision.
- [ ] **B1. Off by default, the base and `clicks` unchanged:** `just tall-table test`, `lint`, and `pairs` pass; `clicks`' window tests pass untouched with the setting off; `size --against <M24's parent>` reports the base unchanged.
- [ ] **B2. The setting, natively:** window tests: with it on, a press anywhere on a header (the arrow's box included) reports the header's press once and sorts nothing; with it off, as today; a long press on a header and on a cell reported as a context press, with its target.
- [ ] **B3. On touch, in the browsers:** the smoke check under touch emulation, as far as part A finds each browser can be driven: a header's tap, a cell's long press, a pan that reports nothing; and once by hand on a phone, noted.
- [ ] **B4. Its cost and the README:** the added bytes on `clicks` in a `perf/results/` note, and each app's; the README's "Presses" and its Canvas tradeoffs; Tycho's "Waiting on" row flipped to *Ready*.

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
