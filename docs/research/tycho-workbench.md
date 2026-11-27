# Research: Tycho as a data workbench

The thinking behind Tycho's rebuild as a public utility app: what it becomes, its security model, each of its pieces, and what was tested. It came out of the planning conversation of 2026-11-17 and the review of its proposal the same day. What's built next and in what order is Tycho's [`PLAN.md`](../../apps/tycho/PLAN.md); the decisions are in its [`docs/DECISIONS.md`](../../apps/tycho/docs/DECISIONS.md) and the root's; who it's for is [`apps/tycho/docs/personas.md`](../../apps/tycho/docs/personas.md).

Each item is marked **Decided** (the owner said so), **Proposed** (suggested, not yet confirmed), or **Open**. A **Proposed** item is checked and reviewed at the step that builds it, before it's built; none is settled by being written here.

---

## Why change

Tycho was the first step: it proved that a canvas table over DuckDB-Wasm scrolls tens of millions of rows. That is all it does, and scrolling a big dataset isn't useful on its own. Since then the measuring moved to the observatory and the table became a component of its own, which leaves Tycho free to be what the tiers call it: a utility app, a tool anyone can open and get something from.

## What Tycho becomes

**A data workbench for files too big for a spreadsheet,** running entirely in your browser: open it, understand it, check what you need, and export the part you want. Your data never leaves your machine.

- **Decided:** it is public and useful to people outside this repo.
- **Decided:** the table and the data are the focus of the page.
- **Decided:** Tycho hosts a *controller*: a layer around the tall table that speaks to the database, holds the logic, and can be driven by an LLM. (Named "the controller" for the layer and "the view state" for what it holds; not "smart table".) The LLM is one driver of the app, not the app.
- **Decided:** the page is redesigned, in a design session that follows this planning. It began 2026-11-20; what it has settled is marked below with that date, and its decisions are Tycho's `docs/DECISIONS.md`, "Scope".
- **Decided:** Tycho's measurements are retired (the root `docs/DECISIONS.md`, "Measurement protocol", 2026-11-17).

The test for every feature: does it help someone with a large file and a question?

## Security: the rules everything else follows

- **Decided:** Tycho hosts no model and no API to one.
- **Decided:** Tycho never asks for or stores a visitor's API key.
- **Decided:** security for the visitor and for us comes first, since the app is public.

What follows from them: **Tycho is never an LLM's client. It is the tool an outside LLM operates.** The model runs in something the visitor already uses and trusts; Tycho describes itself and accepts requests.

- **Proposed:** what an LLM sends is untrusted input, and whatever an input accepts, an LLM can send: an agent types where a person types, and a person pastes what their assistant wrote. So no rule of the form "a person may, an LLM may not" can hold, and the defense is in three layers:
  1. **The grammar:** requests are validated actions from the catalog (below). Two things the view state holds can't be left to an input or a link: **the source** (a link or a pasted action could point it at any URL) and **export** (it writes a file). **Decided (2026-11-21):** an action or a link may describe a view of the source that's open, and nothing else. No command names a source in the first release; what one that does waits on is decided with "Opening a file". An export is a command on a line of its own, never a step of a pasted action and never in a link; it ends in the browser's save dialog where there is one (Chrome and Edge) and in Downloads elsewhere (`apps/tycho/docs/DECISIONS.md`, "Scope", 2026-11-21). Without that carve-out, "no action can name a host or write a file" doesn't hold.
  2. **The engine, locked down** (**decided and built 2026-11-23:** a host's option of the engine, which Tycho takes; Tycho's `docs/DECISIONS.md`, "Engine and bridge"): DuckDB-Wasm reads an `https://` path written straight into a query, with no extension to load, so a raw query could send a visitor's data out. Proposed even if Tycho never takes SQL, since it also covers a mistake in the grammar. Tested 2026-11-17 on the pinned build (DuckDB-Wasm 1.32.0, DuckDB v1.4.3) in Node, to repeat in a browser:
     - `SET enable_external_access = false` alone is too blunt: it also blocks every file Tycho registers.
     - What works, in this order at the engine's start: load every extension Tycho will need (`LOAD` is refused afterwards, autoloading included), `SET allowed_directories = ['tycho/']`, `SET enable_external_access = false`, `SET lock_configuration = true`.
     - After it, a file registered under `tycho/` reads (registered after the lockdown too, so a dropped file works), and so do `CREATE TABLE … AS`, `SUMMARIZE`, and `parquet_metadata` over it. A file outside the directory, a `tycho/../` path, an `https://` path in a query, `COPY … TO` outside the directory or to a URL, `ATTACH`, and every `SET` are refused. **Repeated in Chromium, Firefox, and WebKit on 2026-11-23** (Tycho's `perf/lockdown.ts`): as above, except that `ATTACH` is refused only for a file or a URL; `ATTACH ':memory:'`, `INSTALL`, and a `LOAD` of a loaded extension run, and reach nothing. `enable_external_access` can't be turned back on while the database runs, locked or not.
     - **The directory is the host's, passed to the engine.** The registered names are built in Tycho's crate and written into its SQL (`workbench.rs`, `csv.rs`, `dataset.rs`); the engine only receives them and may know no app (`engines/duckdb/CLAUDE.md`, rule 1). The observatory's contenders share the engine with names of their own, so the lockdown is a host's choice, off unless asked for.
     - **What Tycho sends lazily today breaks under it, and has to move before the lock:** every CSV open sends `ATTACH IF NOT EXISTS ':memory:' AS tycho_csv (COMPRESS)` (`csv.rs`), and `LOAD parquet` is a prefetch that can fail and be retried, followed by `SET GLOBAL parquet_metadata_cache = true` (the engine's `bridge.rs`). The lock has to wait for the load to succeed, so until it does the engine is unlocked: **decided (2026-11-23)** that nothing reaches the engine until the lock is on; a file chosen before it waits, unregistered (Tycho's `docs/DECISIONS.md`, "Engine and bridge").
     - Tested in a browser since: a dropped file's handle (`BROWSER_FILEREADER`) reads under the directory, and `COPY … TO` inside it writes a file that reads back. A remote file registered under it reads in Firefox and WebKit and got a 416 in Chromium, on a URL the page had downloaded whole; that, and handing an export to the page, are left for "Opening a file" and export.
  3. **The connection policy** ("Trust", below), enforced by the browser.
- **Proposed:** the context a visitor copies out is, by default, the schema and the statistics of number columns. Anything that carries cell text is a visible opt-in: sample rows, and also a text column's top values, min, and max. Cell text is data leaving the tab, and it can be written to steer a model. **Column names are the file's text too:** a hostile CSV's header can carry instructions, and names can't be left out of a schema, so they go out marked as data like any cell, cut to a length, in the copied context, the capability schema, and every reply.
- **Proposed:** a reply that holds data marks it as data, apart from Tycho's own wording, and the instructions tell an agent that cell text is content, never a command. This lowers the risk and doesn't remove it; the boundary is still that an agent can ask only for what the catalog holds.

## The pieces

### 1. The controller

- **Decided:** it holds one serializable **view state**: the source, the columns and their order, filters, sort, pins, formats, color rules, and later a grouping. It compiles the state to SQL for the engine and to calls on the tall table.
- **Decided:** every driver produces that same state: a click in a column menu, a typed command, a pasted reply from an assistant, a browser agent, a link.
- **Decided:** it is built first and thin (source, columns, their order, widths, pins, formats: what needs nothing new from the engine), and each of the table's features is adopted through it, so none is wired to the table and then wired again. Each adoption is also a new field in the capability schema. What the table owns and reports (widths, pins, order) the controller takes from the table's events. **Sort and filter aren't thin:** the table's `sort` is built, but the DuckDB source's order isn't (an index for a CSV in memory, a sorted copy of a Parquet file within the memory budget, a refusal past it: [`tall-table-features.md`](tall-table-features.md), "`sort`"), and a source that pages by row-group range can't page a filtered result. On a remote file read by range, either would read all of it. They are a step of their own, with the engine's part. Built thin on 2026-11-23 (Tycho's `crate/src/view.rs`; its `docs/DECISIONS.md`, "Table and paging"): the source, the columns and their types, their order, widths, the pinned count, and formats, from the table's own events.
- **Decided (2026-11-23):** it lives in Tycho's crate, in Rust. It moves to a component or the engine only when a second consumer needs it (root `CLAUDE.md`, "Tiers").
- **Proposed:** it publishes a **capability schema** generated from what the build holds (the table's compiled features, the current columns and their types, the catalog), so it can't offer what it can't do.

### 2. The table's own tools

What someone needs to check something in a large file, with no LLM anywhere:

| Tool | State |
|---|---|
| Resize, select, copy, pin, reorder | Built in the tall table and adopted in Tycho: a column's menu (from its header's badge), a cell's menu, and the column list |
| Sort | Built in the tall table and adopted in Tycho: a header's arrow, a column's menu, the toolbar's editor, and `sort`, one column at a time, over a sorted copy of the rows in view (a Parquet file over 256 MiB isn't sorted) |
| Format, density | Built in the tall table; not yet adopted |
| Jump to row | Built in Tycho |
| Filter a column | Built in Tycho over the table's `replace_rows`: the toolbar's editor, its list, and `filter`, each filter a column, an operator, and a value, combined with `AND`, over an index of row numbers |
| Search across columns (keep the rows any column matches) | Not adopted: find steps through matches and keeps every row; a filter over every column is the table's global filtering, built in its PLAN |
| Find (keep every row, step through matches) | Built in the tall table and adopted in Tycho: find's bar (Cmd/Ctrl+F on the first press, the second the browser's), its count and place, and `find` |
| Hide and show columns | Built in the tall table and adopted in Tycho: the menus, the column list, `hide` and `show` |
| A column profile: type, null share, distinct count, min and max, top values, a small histogram | New, Tycho's |
| Totals of the selection (count, sum, average, minimum, maximum) | New, Tycho's: a query over the selection's range in the catalog, since most of a large selection isn't loaded ("The selection's summary", below) |
| Export the current view as CSV or Parquet (and so convert between them) | New, Tycho's and the engine's; needs a size plan (below) |
| Schema and file facts (types, row groups, compression) | New, Tycho's |
| Filter by a cell: every row that shares this value, or every row that doesn't | Built in Tycho: a cell's menu and a Row tab field's, keep and leave out |
| A row detail view: one row opened and read in full, long text and nested values included | Built in Tycho (the panel's Row tab, opened from the cell popover, Enter, or a double-click), nested values aside until JSONL |
| The view copied as SQL, to continue in another tool | New, Tycho's; **decided** |

**Export's size, decided 2026-11-21:** a cap with a clear message, in every browser, and a test of writing to the browser's own storage first, which would lift it (`apps/tycho/docs/DECISIONS.md`, "Scope"). What was open: an export is written inside DuckDB-Wasm before the browser saves it (to confirm how), so a large one could run out of memory. The choices: a cap with a clear message, which covers the common case of a small piece of a big file; or writing in pieces to a file the visitor picks (the save-file picker, Chromium only). It also needs a call the bridge doesn't have. Decided before export is built.

**The selection's summary, planned 2026-11-27** (`apps/tycho/docs/DECISIONS.md`, "Scope"): a line at the status bar's right end, never the table's footer row, which is the view's totals.

- **Decided:** one query over the selection's range in the view (its filter's index and its sorted copy, as page reads use them), sent in the engine's background as a profile's are, so it counts cells that were never loaded.
- **Proposed:** a count for any cells; a sum, an average, a minimum, and a maximum for numbers, and the earliest and latest for dates; infinities and NaN left out and counted, as the profile does.
- **Open:** a whole column selected (the profile's exact stage holds the same figures: read from it, or asked again), a range across columns of different types, a selection of several ranges, a CSV still loading, and a phone, which has no status bar.

### 3. The catalog: formulas by type

- **Proposed:** a catalog of named, parameterized queries, each keyed by the column types it applies to.

| Applies to | Entries |
|---|---|
| Any column | nulls, distinct count, top values, duplicates |
| Numbers | quantiles, histogram, outliers |
| Text | pattern match, length spread, stray whitespace, numbers stored as text, detected shapes (email, URL, UUID, JSON) |
| Timestamps | range, gaps, counts per day or hour |
| Two columns | group one and aggregate the other, pivot |
| The table | duplicate rows, whether a column is a unique key |

- **Proposed:** one catalog, three readers: the column menus, the command grammar, and the instructions an LLM is given. An LLM can ask only for what the catalog holds, which is the security boundary.
- **Proposed:** the first profile is cheap: DuckDB's `SUMMARIZE` profiles every column in one statement, and a Parquet footer already holds each column's min, max, and null count. Measured 2026-11-20 ("The column profile's cost", below): `SUMMARIZE` is not cheap on a large file, 90 s on 42 million rows.
- An entry returns either a new view of the rows or a small answer (a number, a short table). Small answers show in the thread.
- **Decided (2026-11-20):** a grouped result opens as a view tab. Grouping is more than one entry: every person in `personas.md` needs it, and a grouped result isn't a view of the file's rows but a new table, which can itself run to a million rows and so needs the table, not the thread. The tab keeps the filters it was made with. "Show rows" on a group first went back to the base rows with a filter on its key; since 2026-11-21 it opens the group's rows as a view of their own (`apps/tycho/docs/DECISIONS.md`, "Scope", 2026-11-20 and 2026-11-21).
- **Decided (2026-11-21):** an action has two spellings. An agent's is JSON, which models write reliably and which validates against the capability schema (`{"filter": {"column": "mass", "op": ">", "value": 10}}`). A person's is a short typed command (`filter mass > 10`) that parses to the same action. The thread shows what was typed and the action it became. The command names, their parts, and the grammar's rules: `apps/tycho/docs/DECISIONS.md`, "Scope", 2026-11-21.

#### Grouping and the pivot

Planned 2026-11-27, from the question a spreadsheet's user asks first: "does it have pivot tables?" The decisions are Tycho's `docs/DECISIONS.md`, "Scope", 2026-11-27; this holds what each is made of. A grouped or pivoted result stays what 2026-11-20 and 2026-11-21 made it: a view of its own in the views list, keeping the filters it was made with, with "Show rows" (`rows`) opening a group's rows as another view. No breadcrumb, and nothing filters the view it came from.

**With "Views and grouping":**

- **Decided:** a grouping takes several keys, one row for each combination: `group owner, object_type`.
- **Decided:** a date or a timestamp key takes a period, written after its own key: `group launch_date by year`, and in JSON on the key (`{"column": "launch_date", "period": "year"}`), so two keys can each have one. The periods: `year`, `quarter`, `month`, `week`, `day`, and the cyclic `weekday` and `hour`.
  - **Proposed:** the period offered first follows the column's range, which the profile knows (60 years: `year`; three weeks: `day`).
  - **Open:** which time zone a timestamp is bucketed in when the file's type carries one, and how the view says it. Not checked in DuckDB-Wasm.
- **Decided:** three more summaries beside `count`, `sum`, `avg`, `min`, and `max`: a distinct count, a median, and a count of the values that aren't null. **Proposed** spellings: `distinct(col)`, `median(col)`, `count(col)`. An exact distinct count and a median for every group are the costly ones, so they are timed first.
- **Already the design's:** a NULL key is a group of its own (its "Show rows" view is `column is null`), `filter` typed in a grouped view filters the grouped table, and a count's share of the total is Grouping 1's share column.
- **Decided:** a group editor in the family of the filter's and the sort's: the keys, a key's period, the values, and from "Pivot" on, the column spread across, with the command it makes in its foot. "Group this view by…" and a column's "Group by this column" open it. No drag-and-drop builder of fields into areas: it would be a second way to do the editor's job.
- **Decided (2026-11-27):** a grouping reads every row in view, in the engine's background, so every other view stays in use while it reads; its view opens at once and shows the task ("A task under way", below). Its own timings confirm the background lane when the item opens.
- **A check to keep, for every kind of key** (one, several, a period, NULL): a "Show rows" view's row count equals the count in the group's row.

**With "Pivot":**

- **Decided:** a pivot is a grouping with one key spread across the top, and one verb says both: `group owner across launch_date by year sum(mass_kg)`. The menus and the editor say "Pivot", so the word a visitor looks for is there. Dropped: a `pivot` verb, a second spelling of one view; and `by` for the spread column, which already means a key's period.
- **Decided:** the columns are known before the query runs. The spread column's values are read first (the profile has them, or a query of their own), at most a cap of them become columns, the rest fold into one "Other" column, and NULL is a column of its own. So the table has its columns before a row arrives, the cap is said before anything is read ("status has 22 values: 22 columns"), and a link reopens the same columns. The cap's number is **open**, set from the design and the timings.
- **Decided:** Tycho writes the SQL, never DuckDB's `PIVOT` statement, which picks its columns as it runs and isn't checked under the lockdown. The file's values never become SQL identifiers: the query's columns are `c0`, `c1`, …, each value is in the SQL only as a literal (`filter::literal`, as a filter's is), and the controller gives the table the labels.
  - **Open:** one aggregate with a `FILTER` for each column, or one `GROUP BY` of both keys into a small table that is then spread. A text comparison in a `WHERE` on a Parquet file measured about 10× slower in DuckDB-Wasm than the same test as a `CASE` (2026-11-27), so both are timed before either is built.
- **Decided:** "Show rows" on a cell opens the rows of its row's keys and its column's value; a period's is its range. An "Other" cell's rows are every value but the shown ones, so the grammar gains `not in` with this item. SQL's `NOT IN` drops NULLs, which is why NULL is never folded into "Other": the count would stop matching the cell.
- **A cross-tab's header labels are the file's text,** as cell values are. What goes out in the copied context and the capability schema marks them as data, never as column names (PLAN's open question "Column names going out").
- **Decided (2026-11-27), from the boards:** a pivot takes one value. Its cells are shaded by value, on by default, with a switch held in the view's state (in the group editor and on the toolbar's values chip), for a visitor who finds the shading noisy. The shade is the table's `custom-cells`, on a scale that keeps a column that dwarfs the rest from flattening the others (a log scale on the board); text over the darkest fill keeps its contrast. A count of the whole row sits beside the key, before the spread columns, and a zero is drawn muted.
- **Decided, for later ("More of grouping"):**
  - several values, with a header row over each spread value's columns (the table's `group-headers`, built and not yet adopted);
  - a value shown as its share of its row or of its column. It adds grammar and view state, and with the shading on, the shade has to follow what the cell shows;
  - a totals row, once the table has a footer row: asked for when "Pivot" opens, researched with the header strip if that has been asked for. A total of an average is the average of every row, not of the groups' averages. **The footer is the view's totals and never a selection's:** a summary of the selected cells (count, sum, average, minimum, maximum) is a line of its own, in the status bar where the selection is named today, so the totals don't vanish when cells are selected. It has a planning session of its own, and the footer's research is told of both;
  - a period spread across the top listing every period in its range, the empty ones too.

**Later, after the first release ("More of grouping"):** a number key in ranges (`group mass_kg by 100`), once the filter preview's histogram is in use; the first N groups and an "Other" row (a grouped view is sorted and scrolled, so its first ten rows are its top ten); a running total and the change from the period before; empty periods filled down the rows; text keys (an email's domain, a URL's host), with the catalog's detected shapes. A computed value before grouping belongs to "Later: checked SQL expressions", and a chart of a grouped view to "Charts".

#### A task under way

Decided 2026-11-27, on [the design canvas](https://claude.ai/artifact/CR8skvUDrUsVxE4zXJtRmK) (Task 1 to 4, at the foot of the Grouping page): one component for every slow task, since a grouping is not the only one. A sort's copy, a filter's index, an export, a pivot, `duplicates`, "Show all rows", and a CSV loading all make a visitor wait on a large file, and an export's progress sat in the status bar, which a phone hasn't.

- **The component:** the task's name ("Grouping by model"), a bar where the whole is known and a ring where it isn't, what's read of the whole, and Stop where stopping does something. Nothing is drawn for a wait under about 0.4 s, so a quick answer never flashes one.
- **A new view reads under a haze.** A grouping, a pivot, or "Show all rows" opens its view at once: its columns and placeholder rows, hazed as a dragged file hazes the page, with the task on the haze. Stop closes the view. Its row in the views list shows a ring, and the row's close is its Stop.
- **A sort or a filter never hazes the view it's asked of.** The rows stay as they were, and in use, until the answer is ready; the chip that asked carries the ring, and its × stops it. They are the commonest steps there are, and a locked table would make them the costliest on a large file. The cost taken: for the wait, the toolbar says one thing and the rows show another, which the ring says. What the table draws during the wait today wasn't read from the code; keeping the rows may mean holding `replace_rows` back until the answer is ready.
- **Everything running is one press away:** a button in the top bar, there only while a task runs, opens the list of them, each with the component. The same at the desk and at a phone. An export's progress is there, and no longer in the status bar.
- **The log says it in words,** then the result; it holds no bar and no Stop. One place has the control.
- **Within a view the latest step wins:** a sort replaced by another is canceled, and a filter changed under a sort starts the sort again, since a view has only what was asked and what is shown. Nothing queues there.
- **Across views and exports, one slow task runs at a time,** the next waiting its turn and saying what it waits for: DuckDB-Wasm runs on one thread, so two at once each take twice as long. A page read goes ahead of all of them.
- **Later, if use asks for it:** an answer that comes back after the visitor has scrolled or selected isn't shown under them; the chip says it's ready ("Sorted by tokens is ready · Show"). Someone reading rows a minute into a wait may have forgotten the sort, and a table re-sorted under them loses their place. Not built first: it adds a press to the commonest steps, and leaves the toolbar and the rows apart until it's pressed.

#### The column profile's cost

Timed 2026-11-20 to decide whether the table's headers carry a profile of every column (the design session; the decision is Tycho's `docs/DECISIONS.md`, "Scope"). DuckDB-Wasm 1.32.0, the pinned build, under Node 26 on an Apple M1, reading local files; one run each, so sizes, not medians, and a browser tab reading a dropped file is unlikely to be faster. The 1 GB file is the asteroid data 27 times over, which may flatter it.

| What | Asteroids, 38 MB, 1.6 M rows, 18 columns | Asteroids ×27, 1 GB, 42 M rows | Gaia, 1.6 GB, 25 M rows, 11 columns |
|---|---|---|---|
| `SUMMARIZE`, every column | 3.4 s | 89.7 s | 53.5 s |
| Min, max, nulls of every column, by a scan | 0.55 s | 14.9 s | 6.3 s |
| A 20-bin histogram of every number column, one pass | 0.94 s | 25.9 s | 23.3 s |
| The top 5 values of every text column, a pass each | 0.61 s | 12.1 s | none |
| The same three after a filter keeping 2% | 0.7 s in all | 19.7 s in all | not run |
| One number column's histogram | not run | 2.5 s | not run |
| Min, max, nulls of every column, from the Parquet footer (`parquet_metadata`) | not run | 0.24 s | not run |
| Every number column's histogram from a 1% sample (`TABLESAMPLE SYSTEM`) | not run | 3.1 s, against 30.0 s for every row | not run |

What follows from it:

- **Decided (2026-11-20):** an exact profile of every column is ruled out for the files Tycho exists for: half a minute or more on open, about 20 s after each filter.
- **Decided (2026-11-20):** the profile is drawn in three stages, each replacing the last in place: at once, the range and null count from the footer over placeholder bars; soon, the shape from a sample, muted and marked as sampled; then every row, for a column the visitor opens (2.5 s on 1 GB) or a small file. A filter change waits for a pause, cancels what's in flight, and starts again from the sample. Only columns in sight are profiled.
- **Decided (2026-11-20):** it is built in the columns panel first. The strip under the headers is the same numbers drawn smaller, and is asked of the tall table only once the panel's profile proves fast enough in use.
- **Decided (2026-11-20):** before the graphic is given up as too slow, a session of its own tries to make the sample faster and smarter; only if that fails does the graphic leave the panel, the figures staying. The profile is closer to an infographic than a measurement, so an estimate that is quick beats an exact shape that is late.
- **Open, for that session.** Starting points, none tested:
  - Parquet's row-group statistics: each group records its range and row count, so spreading each group's count across its range gives a rough histogram with no scan.
  - Timestamps: files are often written in time order, so the row groups' ranges alone may give a near-exact histogram over time.
  - Text with few values: Parquet stores these as a dictionary, so the distinct values can be read from the dictionary pages, not the rows.
  - Distinct counts: DuckDB's approximate counter, far cheaper than an exact one.
  - A time budget for each profile query, as Datasette gives its facets: one that runs over is dropped, and what the sample gave stays.
  - A CSV held in memory has no footer and no row groups: what its first stage shows.
- **Open, for the build:** a profile query and the table's page reads share one engine. If a 3 s sample holds up page reads, scrolling stalls while a profile fills: page reads go first, or the profile runs in pieces that yield. How the engine queues today wasn't checked.
- How others do it (from memory, 2026-11-20, not checked): Hugging Face's dataset viewer and Kaggle profile on a server when a dataset is uploaded; Observable's table summarizes rows already in memory; Quak, Mosaic, Positron's data explorer, and Rill push a binned query per column to a database as columns come into view. Tycho, with no server, is in the last group.

### 4. The thread

- **Decided (2026-11-20):** a log with history and scroll, as a tab of the collapsible panel at the right, and the input apart from it: a command bar at the top center (`apps/tycho/docs/DECISIONS.md`, "Scope", 2026-11-20). First planned as one panel at the left with the input beside it.
- **Decided:** the input and the replies are DOM beside the canvas.
- **Decided:** it is a log of requests and Tycho's replies, not a conversation with a model. Every action lands in it, clicks included, so a menu click shows the command it made. A reply is the new row count, a small answer, or an error.
- **Decided (2026-11-24):** each entry is a view state, so an old entry can be returned to: history and undo (Tycho's `docs/DECISIONS.md`, "Scope", 2026-11-24). Built with the command bar.
- **Decided (2026-11-24):** the logic stays in Rust (the controller parses and replies); the DOM side only shows the thread. This is an exception to "everything on the canvas", to be logged as a decision with its reason: text entry, selection, Ctrl+F, screen readers, and agents all need the DOM. *Taken further since:* only the table is canvas (Tycho's `docs/DECISIONS.md`, "Scope", 2026-11-20), and the page's frame already works this way, its words written in Rust and drawn by the page (2026-11-23, "The page owns the page's events; the app owns what they mean"). Taken for the thread when the command bar was built (Tycho's `docs/DECISIONS.md`, "Scope", 2026-11-24): the controller parses, completes, runs, and replies, and the page draws the bar and the log.
- **Decided:** the thread's input takes commands and actions, never SQL. SQL gets an editor of its own (many lines, its own errors, its own results), a later goal, with the engine's lockdown under it.
- **Decided (2026-11-20):** the input is a command bar with completion, not a chat box. Tycho holds no model, so its input can't read natural language: that goes to the visitor's assistant, and an action comes back. A box that looks like a chat invites a sentence and answers with a parse error; the bar answers a sentence by saying what it takes and offering the context to copy.
- **Decided (2026-11-20):** it is named "Log", which says "not a chat" better than styling can.
- **Decided (2026-11-20):** no chat layout, which would suggest someone is answering. The log's foot says the replies are Tycho's own and that nothing is sent to a model.

### 5. How an LLM reaches it

- **Decided:** the clipboard. A "copy context" button gives the visitor a text for their own assistant; they paste its reply into the input.
- **Decided:** browser agents. The visitor's agent reads the instructions and drives the same input.
- **Proposed:** the instructions also live on the page (a section or a linked text file), so an agent finds them without a copy.
- **Proposed:** both routes use the one input and the one validation path. An agent can't read a canvas, so it reads the thread's replies.
- **Open:** a tool surface registered with the browser (the WebMCP proposal), and a model that runs on the visitor's device. Both need research into what browsers ship today.
- **Proposed, ruled out:** a server-side MCP (the data is in the visitor's tab) and a local bridge to a desktop client (a page talking to localhost is its own risk).

### 6. Opening a file

- Drop a CSV or Parquet file: built.
- **Decided:** JSONL joins them.
- **Decided:** more than one file: several opened together, a dataset split across many files opened as one, and joins between them. Its shape is open (what a join looks like in the view state and the catalog), and it comes after the single-file app works.
- **Decided:** open from a URL.
- **Decided:** Parquet only, read by range: the footer and then only the row groups in view, as the samples are today, so part of a huge remote file opens quickly (a file on Hugging Face, say: checked 2026-11-17, its `resolve` URL answers a cross-origin request, allows the `Range` header in a preflight, and redirects to a CDN that answers `206` with `Access-Control-Allow-Origin: *`; each read pays that redirect). What the engine needs of any host is narrower than "allows cross-origin reads": a ranged `HEAD` answered with 206, and `Content-Range` exposed to the page, since that is how it sizes the file (`engines/duckdb/CLAUDE.md`; `remoteSize` in the engine's `engine.ts`). Hugging Face does both, through the redirect, checked with `curl` and not yet through DuckDB in a browser. A remote CSV has no index and isn't offered.
- **Proposed:** no proxy through our Worker (the data would pass through us). The remote host must allow cross-origin reads, and the page says so when one doesn't.
- **Proposed, to research before it's built:** URL opening gets a route of its own with a looser connection policy, so the drop-a-file page keeps the strict one (below). That route holds only what anyone can fetch, so it takes no dropped files: a private file never sits on the page where the browser allows other hosts. The engine's lockdown likely holds here too: the remote file is registered under the allowed directory and read by that name, so a query still can't name a host (to test in a browser).

#### A CSV read wrongly

Planned 2026-11-27 (`apps/tycho/docs/DECISIONS.md`, "Scope"). Today the dialect and the types come from one `sniff_csv` of the first chunk, and a later value that doesn't fit widens its column to text. What's left is the guess that parses and is wrong.

- **Decided:** the visitor sees what was chosen and can correct it: a column read as text, dates day-first, the delimiter, the header row. The file is then read again from its start, as a task.
- **Decided:** the corrections are part of the view state's source, so a link to the view asks for the file and reads it the same way; without them a filter on `zip = '02134'` would meet a number column.
- **Proposed:** they are `read_csv`'s own options (`types`, `dateformat`, `delim`, `header`) over the sniffer's answer, so nothing new is parsed by Tycho; the scanner's record boundaries don't depend on them, the quote aside.
- **Open:** how a wrong guess is noticed (a number column whose text has leading zeros; a date column where both readings parse), and what a correction does to the views and the log of the file as first read.
- **Deferred:** other encodings. The scanner finds record boundaries in bytes, so UTF-16 is its own work, and DuckDB reads only a few encodings without an extension. Until then a file that isn't UTF-8 is refused with the way on, and so is a spreadsheet's file: save a UTF-8 CSV from the spreadsheet app in use.
- **To research, after the first release:** a spreadsheet's file opened. Whether DuckDB's Excel reader runs in DuckDB-Wasm, what it weighs, and how it loads when the lockdown refuses `LOAD` after the lock (before it for every visitor, or the engine started again for such a file); a workbook's sheets would each be a source. No `.xlsx` is exported.

#### Two files compared

- **Decided (2026-11-27):** named within "more than one file": the rows only in one, only in the other, and those whose values differ, matched on a key. Its shape waits for a join's. A join that adds a column from another file is a lookup in the menus and the help.

### 7. Trust

- **Decided (long-term):** a collapsible panel, a small `htop` for the page, showing what comes in and what goes out, for visitors who won't open devtools. The observation panel's bytes-read and waterfall rows are its start.
- **Proposed:** two guarantees that don't depend on believing the panel. A Content-Security-Policy that allows connections only to Tycho's origin, enforced by the browser and readable in the response headers. And working offline: once loaded, with a dropped file, nothing needs the network.
- **Proposed:** the policy ships with the first release, not after it. The input exists from the moment the thread does, and an agent types wherever a person types, so a release without the policy is drivable with one of the three layers missing. Offline and the panel can follow.
- **Kirkwood shares the origin** (`tycho.seiza.io/kirkwood`, a Worker of its own): "only Tycho's origin" still reaches Kirkwood's Worker, and anything Tycho saves in the browser's storage is readable by Kirkwood's page. Both are ours, so it's a limit to state, not a hole: the policy can name Tycho's own paths, and a saved view is either accepted as shared or Kirkwood moves to a hostname of its own (which reopens the root's hosting decision). **Settled 2026-11-23:** Kirkwood moved to `kirkwood.seiza.io`, so Tycho's origin is its own (root `docs/DECISIONS.md`, "Hosting").
- **Open:** what the policy must allow for DuckDB-Wasm's worker, wasm, and extensions.

### 8. Samples

- **Decided:** the Gaia sample leaves Tycho's R2. Kirkwood is unaffected in production: it has a bucket of its own and ships `stars.bin`. Its `data/stars.ts` builds that file from the local Gaia Parquet that `just tycho data gaia` makes, so the Gaia fetch and prep scripts stay (or move to Kirkwood) even after the sample button goes.
- **Decided:** the sample is downloaded whole, after first paint and on the visitor's click, and read from memory. It isn't read by range over the network: range reads are for Parquet files opened from a URL ("Opening a file"), and are tested locally against a server that answers ranges.
- **Decided:** so the sample is a static asset under the Workers per-file limit (25 MiB on every plan, confirmed 2026-11-17 against Cloudflare's limits page; a larger file fails the deploy), and the samples leave R2. **The bucket itself stays, for these alone (decided 2026-11-21; what was weighed):** it also holds DuckDB-Wasm's two wasm bundles (33 and 38 MiB, over the limit; only their `.br`, 5 and 6 MiB, are static assets), which the Worker serves to a browser that doesn't take br (`apps/tycho/docs/hosting.md`). Either the bucket stays for those two files alone, or they get a home under the limit (a gzip copy as a static asset, say, which every browser takes). The Worker keeps the headers and the pause switch.
- **Decided:** the sample should show the feature set at its best. The asteroids alone are a dull table.
- **Proposed:** what a good sample has: text, categories, timestamps, numbers, and nulls, so every catalog entry has something to do; a known story a visitor can find; a license that allows re-hosting; and a size under the static-asset limit.
- **Decided (2026-11-21):** the sample is GCAT, the catalog of every object launched to orbit, as one file: [`tycho-sample.md`](tycho-sample.md) holds the reasons, the columns, and the build's spec. What was open until then: which data. A subset of Gaia that keeps the star map (the stars within 100 parsecs draw the color-magnitude diagram once charts exist; it needs a new fetch, since today's extract holds only bright stars), or a set with more text and dates (a catalog of every object launched to orbit, exoplanets, earthquakes). Possibly two samples: one rich in types, one for charts. Its own research.
- Today's `asteroids.parquet` is 37.7 MB, over that limit as it stands. **It stays as a build input whatever the sample becomes:** the observatory's `data/prep.ts` builds its base-level file from `apps/tycho/data/asteroids.parquet` and checks its SHA-256 against Tycho's `MANIFEST.json`, so the asteroid fetch, its prep, and its manifest entry stay where they are or move to the observatory with that script.

### 9. Charts

- **Decided:** a goal: "view my query as a chart". It gets a planning session of its own, which starts from the decision it reopens: "Tycho builds no plot" (root `docs/DECISIONS.md`, "Repo structure", 2026-11-10) and the research behind it ([`density-plot.md`](density-plot.md)).
- **Proposed:** a chart is another view of the same view state, and one more catalog entry. Two sizes to separate then: a chart of an aggregate (the profile's histogram is the first), and a plot of every row on the GPU.

### 10. Later: checked SQL expressions, before a SQL editor

- **Decided:** explored before Tycho reaches for a full SQL editor, in an ideation session of its own when its turn comes. What follows is the starting point for that session, not a spec.
- **What it adds:** the catalog's actions compose (several filters, a sort, a column list), and what they can't say is narrow: a computed value (mass divided by diameter), a compound condition (nested and/or), anything across two files. An action could carry a SQL *expression* in a slot, a filter's condition or a computed column, never a whole statement. Models already write SQL expressions well, so nothing new has to be taught to them.
- **How it's checked:** by its structure, before it runs. DuckDB parses a query into a tree without running it (`json_serialize_sql`), and Tycho walks that tree. Using DuckDB's own parser matters: a parser of ours could read a query differently than DuckDB does, and that difference is how such checks get bypassed.
- **What the check must hold to:**
  - Default-deny: a short list of allowed node types and functions, everything else refused, subqueries included (a condition can hide one that reads a URL).
  - The expression is wrapped in a statement Tycho writes, and the whole must parse as exactly one statement, so an expression can't close ours and start its own.
  - The tree's format isn't a stable interface: a fixture test at each DuckDB-Wasm bump.
  - One allowlist for everyone. The input can't tell who typed.
- **To check first:** whether `json_serialize_sql` works in DuckDB-Wasm. It is in the JSON extension, which Tycho would serve from its own origin as the engine does its others, and which must load before the lockdown: an extension can't load after it.
- **What it touches:** "the thread's input never takes SQL" becomes "never a statement", since `filter mass / diameter > 2` carries an expression. The engine's lockdown stays under it as the second layer.

### 11. Later: a SQL editor

- **Decided:** a later goal, after checked expressions have been explored, and only once the engine's lockdown is proven: with full SQL the grammar is a convenience and the lockdown is the defense.
- On the drop-a-file page the connection policy is behind the lockdown, but it still allows requests to Tycho's own origin, so a leak could land in our Worker's logs: the lockdown has to hold for our sake too.
- A query's result isn't a view of the file. The likely shape: the result becomes a new source, which the controller filters and sorts as usual.

## Who it's for

[`apps/tycho/docs/personas.md`](../../apps/tycho/docs/personas.md) holds the people Tycho is built for (the quick checker, the ML engineer, the investigator), what each needs, and why anyone exports. It is kept apart from the PLAN on purpose: a reference to come back to while building, in the people's terms, with no feature states in it. Five of the tools above came out of it: filter by a cell, the row detail view, the view copied as SQL, JSONL, and more than one file.

- **Decided:** the first release is built for the quick checker. What the other two need sits on what that person needs (filter, profile, group, export), so nothing built for them is wasted. The ML engineer is second (JSONL, the row detail view, nested values: contained work); the investigator third (several files, joins, fuzzy matching: the largest).

## What it needs from elsewhere

- **The tall table:** `replace_rows`, then column filtering, global filtering, find, and column visibility. Tycho becomes the host waiting on them, which the table's PLAN should record.
- **The engine:** the `WHERE` and `ORDER BY` behind the table's source, export, the profile queries, remote files beyond the samples, and the lockdown settings (built 2026-11-23).
- **The page's technology:** static and prerendered, plain TypeScript for the thread to start. A framework (React with TanStack, or another) is measured only if the page's DOM state grows enough to need one. **Decided** that this is measured, not assumed. **Measured and decided 2026-11-23:** React with shadcn's components on Base UI and Tailwind, loaded after the first frame, the frame prerendered and run by plain TypeScript until then (Tycho's `docs/DECISIONS.md`, "Scope", 2026-11-23).
