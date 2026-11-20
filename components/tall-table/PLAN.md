# PLAN.md — tall-table

What's next for the tall table: the candidates for its next features, the active milestone's "done when" checks, long-term goals, and open questions. Only what's still open lives here. It's the one list of the table's features to come: an app adopts one as a milestone of its own and links here, and never restates the spec.

**Goal:** the table's own features on its f64-row scroll model, each a Cargo feature off by default, so a host pays only for what it turns on. `DataTable`'s interactions are built (how each differs, and what wasn't carried over: [`README.md`](README.md), "How it differs from `DataTable`"); what comes next is a candidate from `DataTable`'s later releases or from TanStack Table, each researched before it's built ("Candidates", below). The observatory adds a feature level only for a feature both its sides build (`.claude/rules/comparison-protocol.md`).

**Where everything else lives:** what it offers today, and how it compares with `DataTable` and TanStack Table, in [`README.md`](README.md); its rules and architecture in [`CLAUDE.md`](CLAUDE.md); how a feature's cost is measured in [`perf/CLAUDE.md`](perf/CLAUDE.md), "Measuring a feature"; finished milestones in [`docs/milestones.md`](docs/milestones.md); decisions in [`docs/DECISIONS.md`](docs/DECISIONS.md) (why this file exists: root [`docs/DECISIONS.md`](../../docs/DECISIONS.md), "Repo structure", 2026-10-23); surprises in [`docs/LESSONS.md`](docs/LESSONS.md); what it measures of itself in `perf/results/`.

---

## Status

M1–M20, the two hardenings (between M7 and M8, and after M17), and the public API's review are done, the last on 2026-11-19: `DataTable`'s features, the observatory's and Kirkwood's asks, their follow-ups, the features tested together, `replace_rows`, the table's part of Tycho's filters, `hide`, its column visibility, and `find`, its search that keeps every row ([`docs/milestones.md`](docs/milestones.md)).

| Milestone | Title | Status |
|---|---|---|
| M21 | Cell popover: a cell's full value, and a button to the host's view of its row | Active: part C next |

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

Spec rows with research questions, not specs yet; each one's research settles them, and may end it ("How a candidate is assessed", above). None drafted: the cell popover's research is done, and its spec is the active milestone's.

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
| **Tree rows** | A flattened list in which expanding a row inserts its children below it, with an indent and a disclosure arrow, at the fixed row height | The indent, the arrow, and its press; a row's depth and whether it's open, from the page; an insert of *k* rows after row *r* (every index past *r* shifts: the pages after it are re-read or moved, what's kept by index past it moved) | Which rows exist, open or closed, in order (`GROUP BY`, a parent's children); a group's sums | Merges TanStack's grouping and aggregation and expanding. Its gap is the insert mid-list, which `set_rows` (the tail) and `replace_rows` (everything) don't cover. **Ruled out:** detail panels of variable height: they break the uniform f64 row index every scroll, jump, and page is built on (a cell's full value is the cell popover's, the active milestone). Tycho's grouping starts as a new table (`replace_rows` with `set_columns`: the root's research, "`replace_rows`"); tree rows only if it asks for groups expanded in place |
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
| Tycho ([its PLAN](../../apps/tycho/PLAN.md), "Waiting on") | Cell popover | The quick look before its row detail view (its first release), and nested values in it (JSONL, after) | M21 ("Active milestone") | *Not ready* |
| Tycho | Column summaries in the header | Its column profile, if its design puts it in the header | Not planned ("Notes"): waits on Tycho's design | *Not ready* |
| Tycho | Row marks | The investigator's bookmarks and tags, after its first release | Not planned ("Notes"), with row pinning's research | *Not ready* |

Every earlier ask is built and *Ready* in its app's PLAN.

---

## Active milestone

### M21: the cell popover, a cell's full value and a button to the host's view

**What it adds** (Cargo feature `popover`, off by default): a cell's exact text in a popover below it, wrapped and scrolled inside, the row height unchanged; opened by Enter on the active cell, a cue on the cell, or the host; and a button the host labels, whose press the host turns into its own view of the row. Tycho waits on it, for the quick look before its row detail view (its first release) and for nested values after (JSONL). Why it's the table's and drawn by it: [`docs/DECISIONS.md`](docs/DECISIONS.md), "Features" (2026-11-19, the planning discussion). The research and the options weighed: root [`docs/research/tall-table-features.md`](../../docs/research/tall-table-features.md), "Cell popover (`popover`)"; the decisions: [`docs/DECISIONS.md`](docs/DECISIONS.md), "Features" (2026-11-19, M21 part A; three with the owner).

```rust
/// A cell, by row and column index (`popover`): the column's index in
/// `set_columns`' list, so it names the same column after a move.
pub struct PopoverCell { pub row: u64, pub column: usize }

/// The button: the table's look with the host's label, or the host's own
/// element; the table makes either its press target.
impl PopoverButton {
    pub fn label(label: impl Into<SharedString>) -> Self;
    pub fn custom(build: impl Fn(&mut Window, &mut App) -> AnyElement + 'static) -> Self;
}
/// The cue: the table's expand mark (the default), an SVG from the
/// host's assets, or the host's own element.
impl PopoverCue {
    pub fn expand() -> Self;
    pub fn icon(path: impl Into<SharedString>) -> Self;
    pub fn custom(build: impl Fn(&mut Window, &mut App) -> AnyElement + 'static) -> Self;
}

impl<D: TallTableDelegate> TallTableState<D> {
    /// Opens the popover on a cell (`popover`), closing any other. Refused
    /// (false) unless the cell is in view, its column shown, and its page
    /// loaded. Lets go of `follow`.
    pub fn open_popover(&mut self, cell: PopoverCell, cx: &mut Context<Self>) -> bool;
    pub fn close_popover(&mut self, cx: &mut Context<Self>);
    pub fn popover(&self) -> Option<PopoverCell>;
    /// `None` (the default): no button.
    pub fn set_popover_button(&mut self, button: Option<PopoverButton>, cx: &mut Context<Self>);
    pub fn popover_button(&self) -> Option<&PopoverButton>;
    /// `Some(PopoverCue::expand())` by default; `None` opts the cue out.
    pub fn set_popover_cue(&mut self, cue: Option<PopoverCue>, cx: &mut Context<Self>);
    pub fn popover_cue(&self) -> Option<&PopoverCue>;
}

// TallTableEvent:
/// The popover opened on a cell, moved to another, or closed (`None`).
Popover(Option<PopoverCell>),
/// Its button was pressed, or Enter on it (`popover`); it closes.
PopoverButton(PopoverCell),

// TallTableProbe: `popover: Option<Box<PopoverProbe>>` (its cell, its
// bounds, the side it's on, its text's characters and whether it was cut,
// its scroll and content height, its button's bounds) and
// `cue: Option<Box<CueProbe>>` (its cell and box), for scripts.
```

Settled in part B: the button and the cue each the table's look or the host's element, the readers beside the setters, the probe's fields boxed (`docs/DECISIONS.md`, "Features", 2026-11-20).

**The rules:**
- **The text:** the cell's exact text (`CellValue`'s: `copy`'s and the tooltip's, never `format`'s), wrapped, its line breaks as lines; a NULL as the cell's muted `NULL`; past 10,000 characters, "…" (set from a measured frame: `docs/DECISIONS.md`, "Features", 2026-11-20). The cells' font at `density`'s size. Selectable with gpui-base's `SelectableText`; Cmd+C copies the part selected, the popover's own key, before `copy`'s.
- **Opening:** Enter on `select`'s active cell (a `Cells` selection; otherwise Enter propagates); a press on the cue; `open_popover`. The cue is drawn inside the right end of the hovered cell, and of `select`'s active cell, when the popover shows more than the cell (rounded, cut, or with line breaks: the tooltip's rule, decided when that cell changes) or a button is set; its press is stopped (not `select`'s, not reported by `clicks`) and focuses the table, and on the open popover's own cell closes it. The table's expand mark, the host's SVG, or the host's element; `None` opts it out. Opening lets go of `follow`.
- **Closing:** Escape (bound to see it before `select`'s `ClearSelection` and `reorder`'s `CancelMove`, propagating when none is open); Enter with no button; a press outside it, which goes on to do what it does (a cue's press on another cell moves it there); `close_popover`; `select`'s keys moving the active cell; its cell leaving the view (scrolled out, sideways, or behind `pin`'s run); a sort, `replace_rows`, `set_columns`, a `set_rows` cutting its row, a hide of its column, `close`. A move (`reorder`) keeps it, by index. `live`'s re-read of its row decides its text again when the page lands, its scroll kept, clamped.
- **The button:** shown only with a label set; its press, or Enter on the open popover, emits `PopoverButton` and closes it.
- **Placement:** below the cell, left edges aligned, flipped above at the window's bottom, clamped sideways (gpui-base's `Positioner::side`, an 8 px margin), from the cell's bounds each frame (the tooltip's, with `pin`'s visible part); at most `max(cell width, 400 px)` and 75% of the window wide, 50% of it tall, scrolled inside past that; a wheel over it scrolls it, not the table. At `POPUP_PRIORITY`, under the tooltip; no tooltip shows while it's open. Doesn't take focus.
- **Drawn:** the popover surface's colors (gpui-kit's `popover`, `popover_foreground`, `border`), `shadow_lg`. The cue at its cell's right end, 2 px inside its edges, an expand mark in `muted_foreground` with no box, painted with its cell's text: in place of the text's "…", the cut kept (nothing moves); with no "…" to give (a rounded float, a middle cut, a text that fits), at the cell's right end, the text cut and aligned short of it. A placeholder until Tycho's design session draws one (`docs/DECISIONS.md`, "Features", 2026-11-20).
- **The built features:** `find`'s matches tinted in its text (the same rule and fold, the theme's `selection` at saturation 0.1); with the text selected, Cmd+C copies it (the table's `CopySelection` propagates); the rest as the research's "The built features".

**Split into parts,** one session each, in order. Each part ends with its notes in `perf/results/` (where it measures) and `docs/LESSONS.md`. The milestone closes after part C.

- **A. Research and spec** (no shipped code). Done 2026-11-19: the research section, the decisions, this spec.
- **B. The feature, built and tested.** First the spike (`SelectableText` in a `deferred`: a drag selects, Cmd+C copies with `copy` built, in Chromium, Firefox, and WebKit; its bytes), its outcome a decision; then the state, the opening and closing, the cue, the placement, the drawing, the button's event, the probe, the docs, the random test's step, the window tests, the bare host's hooks, `pairs`; the text cap set from a measured frame. Checks B1–B5.
- **C. The cost and the close.** The size on its own and against the base, and on each app that builds the table; frame work with one open; the smoke check in three browsers; the README; the close-out ("Closing a milestone", above). Checks C1–C3.

**Done when:**
- [x] **A1. The research and the spec:** the research section answers each question in the candidate's row (what it shows, the tooltip, what opens and closes it, where it's placed, the built features, the canvas gaps) and reads the prior art (EuiDataGrid's and Glide Data Grid's source, gpui-kit's `Popover`); its decisions in `docs/DECISIONS.md`; the API and checks here; the Drafted row removed. *Evidence:* root `docs/research/tall-table-features.md`, "Cell popover (`popover`)"; `docs/DECISIONS.md`, "Features", five entries tagged M21 part A.
- [x] **B1. The spike decided:** `SelectableText` in the popover selects part of a value by drag and Cmd+C copies it with `copy` built, in Chromium, Firefox, and WebKit, and its added bytes are recorded; or it fails one, and the text is plain with the whole value copied. Either way a decision in `docs/DECISIONS.md` and a note in `perf/results/`. *Evidence:* it held in all three, the same 32 characters of a 3,000-character value pasted, with a `Cells` selection standing too; +4.6 KiB brotli over plain text (`perf/results/2026-11-20-m21-b-spike.md`; `docs/DECISIONS.md`, "Features", 2026-11-20, with the popover's own Cmd+C, which a wasm `Root` lacks).
- [x] **B2. The base unchanged:** `just tall-table test`, `lint`, and `pairs` pass; `size` shows no `popover` symbol in the base, and `size --against 8ffce13` reports the base unchanged. *Evidence (2026-11-20, after the code review's fixes):* `test`, `lint`, and the soak passed; `pairs` passed all 134 builds in 2,445 s; `size`: `seiza_tall_table7popover` and `seiza_tall_table5state7popover` 0 in the base, 18 and 86 with `popover`; the base 9,848.3 KiB after wasm-opt at 8ffce13 and in the working tree, 0 KiB apart (`perf/results/2026-11-20-m21-b-size.json`). `popover` alone: +14.7 KiB brotli, part C's to read.
- [x] **B3. The feature, natively:** window tests for each rule above: each way it opens (Enter on a `Cells` active cell and not on a `Rows` one, the cue's press stopped from `select` and `clicks`, `open_popover` refused out of view, on a hidden column, and on a page not loaded); each way it closes (Escape before `select`'s clear and propagated with none open, Enter with no button, a press outside going on to select, `select`'s keys, scrolled out down and sideways and behind `pin`'s run, a sort, `replace_rows`, `set_columns`, a cutting `set_rows`, a hide, `close`); a move keeping it; `live`'s re-read changing its text; the button's event by Enter and by press, by index after a move; the cue shown only when the cell has more to show or a button is set; the placement below and flipped above at the window's bottom, its width and height capped; no tooltip while open; `find`'s tints in it; the text cut at the cap. *Evidence:* `src/state/fixtures/popover.rs`, 31 window tests with every feature on, 20 with `popover` alone, among them `a_part_of_its_text_is_selected_and_copied`; the cap at 10,000 from a measured frame (`perf/results/2026-11-20-m21-b-spike.md`).
- [x] **B4. The random test:** its `Popover` step from `with_popovers`, after `with_finds`, with no existing case's draw changed; `KeepPopoverOnSort` and `StalePopoverText` fail their invariants. The soak on the final build only if B touches the paging (the popover reads no page). *Evidence:* `Step::Popover` placed by `with_popovers` (three streams) after `with_finds`; invariants 25 (an open popover's cell in view, its text the page drawn's) and 26 (none open across a sort or `set_columns`), and its lines in 17, 18, and 19 (`replace_rows`); `a_popover_kept_across_a_sort` fails at 26, `a_stale_popover_text` at 25 (48 cases; with two streams it took 200, so its step changes its row, sorts, and frames). `set_rows` gained a line, so the soak ran: `just tall-table soak` (seeds 1 to 4, 500 cases each, `popover` among its features) passed, 2026-11-20.
- [x] **B5. The host opens it:** the bare host's switch (`?popover`, with a button label and a long-text column for the cap) and hooks (open, close, press the button, read the probe), so `size`, `perf`, and `smoke` measure it. *Evidence:* `?popover=<label>`, `?popover-cue=off`, `?popover-long=<chars>` (a third column of one shared text); `__tallTablePopoverOpen`, `__tallTablePopoverClose`, `__tallTablePopoverEnter`; the probe's `popover` and `cue` and `__tallTablePopoverButton` through the bridge; the spike and the cap's frames ran on them.
- [ ] **C1. Its cost:** its bytes alone and with every feature, against the base, in a `perf/results/` note, and each app that builds the table in its own `perf/results/` (root `CLAUDE.md`, rule 1); frame work in the protocol's scroll with a popover open over a long text, against none, within the spread (if not, the cap is lowered or the layout cached, with a decision).
- [ ] **C2. In the browsers:** `just tall-table smoke` opens it by Enter and by the cue, places it below and flipped, scrolls its text, presses its button, selects and copies part of its text (if B1 kept `SelectableText`), and closes it by Escape and a press outside, in Chromium, Firefox, and WebKit.
- [ ] **C3. The README and waiting apps:** the README's section, its API list and keys (Enter, Escape), the Features row and cost, the `DataTable` and TanStack tables' rows, the Canvas tradeoffs (what's selectable in it, no Ctrl+F or announcement inside, the host's view for both); Tycho's "Waiting on" row flipped to *Ready* (2026-…, tall-table M21).

---

## Follow-ups to built features

### Bugs

Found by the code review of 2026-11-19 (after `find` closed), a nit; fixed in a session of its own, with a check that fails before its fix. (The review's `find` and harness findings are fixed: [`docs/milestones.md`](docs/milestones.md), "M20 follow-up".)

- **Docs: milestone IDs in the bodies of `docs/DECISIONS.md` entries** ("part A's draft", "Revises check C1's remedy", and others since 2026-10-24), where the root `CLAUDE.md` allows them only in the *[source]* tags. Fix: name the thing in each; and `check-terms` made to read `DECISIONS.md`'s bodies (outside its tags), so it can't drift again.

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

None drafted: the cell popover is active ("Active milestone"), and every other candidate waits for a host ("Candidates", "Notes").

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
