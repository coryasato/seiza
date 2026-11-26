# PLAN.md — Tycho

What's next for Tycho: milestone status, the next milestone's "done when" checks, the roadmap after it in order, and open questions. Only what's still open lives here. Context and rules are in `CLAUDE.md` here and at the repo root.

**Goal:** a data workbench for files too big for a spreadsheet, running entirely in the browser: open a file, understand it, check what you need, and export the part you want. The data never leaves the visitor's machine. Tycho is a utility app (root `CLAUDE.md`, "Tiers"): a public tool, built around a *controller* that sits between DuckDB-Wasm and the tall table, holds one *view state*, and can be driven by a person or by an outside LLM. Tycho hosts no model and takes no API key.

**The test for every feature:** does it help someone with a large file and a question? The first release is built for the quick checker, and takes the ML engineer's JSONL with it ([`docs/personas.md`](docs/personas.md); `docs/DECISIONS.md`, "Scope", 2026-11-25).

**Tycho is being rebuilt,** locally: production stays as deployed (tag `tycho-v1`) until "Ship the rebuild", the first release's last item.

**Where everything else lives:**
- [`../../docs/research/tycho-workbench.md`](../../docs/research/tycho-workbench.md): the research behind this plan: the security model, each piece, what was tested. Every roadmap item links to its section and never restates it.
- [`../../docs/research/tycho-sample.md`](../../docs/research/tycho-sample.md): the sample: why GCAT, its columns, and the spec its build starts from.
- [`docs/personas.md`](docs/personas.md): who Tycho is for and what each person needs.
- [`docs/milestones.md`](docs/milestones.md): the specs, checks, and evidence of finished milestones (history; not edited).
- [`docs/DECISIONS.md`](docs/DECISIONS.md): every decision, by area. Repo-wide ones: the root [`docs/DECISIONS.md`](../../docs/DECISIONS.md).
- [`docs/LESSONS.md`](docs/LESSONS.md): what each milestone taught us.

---

## Status

| Milestone | Title | Status |
|---|---|---|
| M0–M10 | The old Tycho: a canvas table scrolling tens of millions of rows over DuckDB-Wasm, deployed at https://tycho.seiza.io | Done 2026-09-23 to 2026-11-01; retired by M11, its last build tagged `tycho-v1` |
| — | Design session: the page, the thread, the profile, where answers show | Done 2026-11-21, on [the design canvas](https://claude.ai/artifact/CR8skvUDrUsVxE4zXJtRmK). What it settled: `docs/DECISIONS.md`, "Scope", 2026-11-20 and 2026-11-21; what it left, "Open questions" |
| — | Sample session: which data, under the static-asset limit | Done 2026-11-21: GCAT, the catalog of every object launched to orbit, as one file ([the research](../../docs/research/tycho-sample.md); `docs/DECISIONS.md`, "Sample data") |
| M11 | Reset: the old Tycho retired, the ground cleared | Done 2026-11-23 |
| M12 | The engine locked down, the page's frame in the DOM, the controller thin | Done 2026-11-24 |
| M13 | The command bar and the log, minimal | Done 2026-11-24 |
| M14 | Table basics: the menus, the columns list, the popover, and the row view | Done 2026-11-25 |
| — | Design sync: the design canvas brought to the build, through M14 | Done 2026-11-25, on [the design canvas](https://claude.ai/artifact/CR8skvUDrUsVxE4zXJtRmK): the boards stay the spec for the whole app, redrawn where the build decided otherwise and drawn with GCAT; each page's note says what's built of it and which item builds the rest (`docs/DECISIONS.md`, "Scope", 2026-11-25) |
| M15 | Sort, filter, and find | Active, opened 2026-11-26 (below) |
| Later | The roadmap below, in order | Each item becomes a milestone when it's opened |

**Closing a milestone:** every "done when" check passes; new decisions are in `docs/DECISIONS.md`; a `docs/LESSONS.md` entry is written; and the milestone's spec and evidence move from here to the end of `docs/milestones.md`, leaving one row above. Tycho records no measurements (root `docs/DECISIONS.md`, "Measurement protocol", 2026-11-17); what it still checks is in M11.

**Waiting on** (features of a component or engine Tycho needs; only that crate's `PLAN.md` builds them, the session that closes one flips its row to *Ready*, and a row leaves when the milestone that adopts it closes):

| Needs | For | Status |
|---|---|---|
| The tall table's `replace_rows`, then column filtering and global filtering ([its PLAN](../../components/tall-table/PLAN.md)) | "Sort, filter, and find", below | *Ready* (2026-11-18, tall-table M18) |
| The tall table's find | Search that keeps every row ("Sort, filter, and find") | *Ready* (2026-11-19, tall-table M20) |
| The tall table's `sort` | The sort's arrow and editor ("Sort, filter, and find") | *Ready* (2026-10-29, tall-table M8) |
| The tall table's column summaries in the header | The column profile's strip, drawn by the table from numbers Tycho gives it. Asked for only once the panel's profile proves fast enough ("Profiles and the catalog", below) | *Not ready*, and not yet asked |
| The tall table's sort by several columns | The sort's editor as a list; after the first release | *Not ready* |
| The tall table's row marks | The investigator's bookmarks and tags ([`docs/personas.md`](docs/personas.md)); no roadmap item holds them yet | *Not ready* |

---

## M15: sort, filter, and find

Opened 2026-11-26 from the first release's first item, and planned in five parts, one session each. It is local, as every item before "Ship the rebuild" is.

**What it is:** the rows in view chosen and ordered by the view state, and every row searched: the DuckDB source's order, its `WHERE`, and its find, which are the engine's unbuilt half; the view state's filters and sort, compiled to SQL and to the table's calls; the grammar's `filter`, `sort`, `clear`, and `find`; and the DOM they open, the toolbar's controls, the sort's and the filter's editors, the menus' sort, filter, keep, and leave-out items, and find's bar (the research's "The controller" and "The table's own tools"). Its form is the design session's (`docs/DECISIONS.md`, "Scope", 2026-11-20 and 2026-11-21: one toolbar control a kind, never a chip a filter; the row count beside the chips, find at the toolbar's right; a column's menu, a cell's menu, and the editors; Ctrl+F; the page's keys; a command is a verb, then a column, then its parts; a pasted action waits for Enter) and the boards on [the design canvas](https://claude.ai/artifact/CR8skvUDrUsVxE4zXJtRmK): the "Toolbar" page (Toolbar 0 and 1, Option 1 with its list open, Option 3 and the icons at a phone, Find inline, Find at a phone and just opened); the "Columns and filters" page's Columns 3 (the sort chip, open), Headers A's sort arrow, and Filter 1 to 3; the menus' sort and filter items on Columns 1 and 2; and Phone 5's line under the toolbar. A gap between a board and the build is specced and decided, never silent.

**Decided at its opening** (`docs/DECISIONS.md`, "Scope", 2026-11-26): the table's `sort` and `find` are turned on, the table's, the bridge's, and the engine's adapter's (`seiza-duckdb` gains `sort` and `find`, each turning on the table's, since the delegate's calls exist only under them), and no other feature (`replace_rows` is the base's); the filter editor is built with its fields and its foot, and the profile's preview in it (Filter 1's and 3's bars, Filter 2's checklist and counts) comes with the profile, `is any of` a typed list until then; find counts its matches with a query of Tycho's own, as Find inline's "3 of 18" draws it.

**Not in it:** the profile and its preview in the editors, the header strip, and grouping ("Profiles and the catalog"); a sort by several columns (after the first release); `OR` between filters (none in the first release); a filter control drawn in a header (not asked of the table); `sql` and the view copied as SQL ("Export"); a link that holds a view.

### Part A: the engine's half, and the view state's filters and sort, in Rust

- [ ] **A1. How a filtered or sorted view pages, chosen by its timings.** The research's three ways ([`tall-table-features.md`](../../docs/research/tall-table-features.md), "`sort`"), now for a `WHERE` too: an index of row numbers written by one query (`CREATE TABLE … AS SELECT <row> … WHERE … ORDER BY …, <row>`) in an in-memory database the lockdown attaches, each page its slice of the index joined to the rows; a filtered or sorted copy; or a refusal past the memory budget, with its reason for the frame. Timed in DuckDB-Wasm, on the release build, on GCAT as the sample (Parquet) and as a CSV, and on `drop/asteroids-x3.parquet` and `drop/asteroids-x27.parquet` (`just tycho drop-files`, about 100 MB and 1 GB; the x27 with the default 30,720-row groups, not its `-rg` variants): the time to the first filled frame after a sort and after a filter, a page's read after it, and DuckDB's memory. Tycho keeps no results file: the timings go in the decision that picks the way, which says what a file too large is answered with. Also decided here, from the same runs: what a sort or a filter does while a CSV is still loading. An index or a copy goes in a database attached with `(COMPRESS)`, and its row count is checked against the count it was built from: past about 2.1 GiB of in-memory tables `CREATE TABLE … AS` stores nothing and says nothing (`engines/duckdb/CLAUDE.md`), so an empty or short one is a refusal, never "no rows".
- [ ] **A2. The view state's filters and sort, compiled to SQL.** The view state gains `filters` (each a column by name, an operator, a value; combined with `AND`) and `sort` (a column and a direction, at most one), in `__tychoView` and the log's states, so `undo` and the way back restore them. The controller compiles them to the source's `WHERE` and `ORDER BY` (ties in the file's order, NULLs last both ways, as the table's `sort` asks), the new count to `replace_rows` (the view at the top), and a sort to the table's `set_sort`. The table tells its source the sort again after every `replace_rows`, so the source takes the new `WHERE` before `replace_rows` is called, the delegate's `sort` builds its order over the filter in effect, and the controller calls `set_sort` only when the sort changed (a filter alone is one rebuild, not two); the table's `Sorted` and `SortRefused` go into the view as its widths do. Every operator of the grammar for each column type, `contains` and `starts` ignoring case, `=` and `in` not; a value is written into SQL by one function that types and quotes it, never by joining the text the visitor or an agent gave (tested with quotes, backslashes, `%` and `_` in `contains`, and a NUL). The status bar's and Phone 5's count reads the rows in view of the file's ("29,118 of 71,431 rows").
- [ ] **A3. Find's source, and its count.** The delegate's `find` over the rows in view in their order, in windows, a new term cancelling it (the table's README, "Finding": the cell's text as `lower(CAST(… AS VARCHAR))`, hidden columns not searched); the count of matching cells and the current match's place among them in the order the steps follow (the shown columns in their drawn order, then down), each a query of their own, cancelled by a new term, so the bar can show "3 of 18". Timed on `drop/asteroids-x27.parquet` as A1's runs are, and what the bar shows while a count is out decided from them.
- [ ] **A4. Native tests, and the size.** The compiled SQL of every operator and type, the quoting, a filter and a sort through `undo` and the way back in GPUI's test app, the table's own sort taken into the view, the paging over an index (or the way A1 picks) against a CSV's rows, and find's windows. `just tycho check`'s wasm size against the baseline, in the check's *Done* line as every part before has it: the table's rows read `sort` +23.4 KiB brotli and `find` +7.4 in the bare host, the engine's source, the SQL, and the grammar adding to them; within the size gate's 15%, or a row in `perf/budget-notes.md` that says why it's worth it.

### Part B: `filter`, `sort`, `clear`, and `find` in the command bar

- [ ] **B1. The verbs, typed and as JSON** (`docs/DECISIONS.md`, "Scope", 2026-11-21, "A command is a verb, then a column, then its parts"): `filter` with each operator (`=`, `!=`, `>`, `>=`, `<`, `<=`, `contains`, `starts`, `in` a list, `between … and …`, `is null`, `not null`), its value read as the column's type (a date or a timestamp in ISO form, text quoted when it holds a space or a comma); `sort` a column with `asc` or `desc`, left out its type's first direction (the table's cycle); `clear filter <column>`, `filters`, `sort`, or `all`; `find` a term, opening find's bar on it (Part D). Their JSON as the grammar's entry spells it (on GCAT, `{"filter": {"column": "inclination_deg", "op": ">=", "value": 90}}`), several steps under `"actions"`, all or none. Each leaves `LATER` for `VERBS`.
- [ ] **B2. Their answers, completion, and the log.** A value that isn't the column's type, an operator its type doesn't take, and an unknown column (with the nearest) are refused with the reason; a filter already in the view is an answer, not an error. Completion offers, after a column, the operators its type takes, and after `sort`'s column, `asc` and `desc`; the bar's parts follow the verb. Their words ("Keep rows where inclination_deg is at least 90", "Sort by launch_date, oldest first", "Clear 2 filters") and lines; a header's arrow, a menu's item, an editor's Apply, and a chip's remove each a click's entry; a filter that leaves no row applied and said so.

### Part C: the toolbar, the editors, and the menus' items, in the DOM

- [ ] **C1. The toolbar, as the Toolbar page draws it:** a 40 px row over the table; Filter, Sort, and Columns outlined with nothing applied (Toolbar 0); a chip a kind with something ("Filters · 5", "launch_date ↓" with its remove, "3 hidden"), as Toolbar 1 and Option 1 draw them; the count beside them (Toolbar 1: "29,118 of 71,431 rows"; "71,431 rows" with nothing applied); at a phone the icons with counts (Option 3 at a phone, Toolbar 0 at a phone). The filters' chip opens their list (Option 1, its list open): each filter's column, operator, and value read in words, removed one at a time, and "Add a filter"; the hidden chip opens the left panel's column list, or with the panel closed Columns 4's dropdown, anchored under the chip now (`docs/DECISIONS.md`, "Scope", 2026-11-20, "The hidden-columns chip opens the left panel's column list"). Phone 5's line moves under the toolbar.
- [ ] **C2. The editors.** The sort's, as Columns 3 draws it ("Sort by", a column, the two directions in the type's words, "One column at a time. A header's arrow does the same.", the command at its foot, Remove the sort). The filter's, as Filter 1 to 3 draw it but for the profile's preview: "Keep rows where", a column, an operator in words ("is at least", "is any of", "is between"), its value or values, Filter 3's From and To and its shortcuts, the command at its foot as the bar would read it, Cancel and Apply; `is any of` a typed list until the profile (`docs/DECISIONS.md`, "Scope", 2026-11-26). Both a sheet from the bottom at a phone. Each acts through the page's `command` as a click.
- [ ] **C3. The menus' items, and the header's arrow.** A column's menu gains sort either way and "Filter this column" (opening the editor on it), in Columns 1's places; a cell's menu, keep the rows with this value and leave them out (a NULL's `is null` and `not null`), in Columns 2's; a field's menu in the Row tab, the same two beside Copy (Row 2). Each header draws the table's sort arrow as Headers A does, Tycho's SVGs in `crate/assets/icons/` through `set_sort_icons`; a column is sortable unless A1's way refuses its file.

### Part D: find

- [ ] **D1. Find's bar, as Find inline and the phone's two boards draw it:** at the toolbar's right, the chips stepping down to icons while it's open; at a phone a second row of its own, the first unchanged. "Find in the table", the count ("3 of 18"), Previous match, Next match, and Close find. Cmd/Ctrl+F opens it once a file's rows are shown, wherever focus is, the table's canvas included (open question "Ctrl+F from the table", answered here); a second press in its bar goes to the browser; before a file, and while one opens, the key is the browser's (`docs/DECISIONS.md`, "Scope", 2026-11-21, "Ctrl+F is Tycho's find on the first press"). The tag "⌘F again for the browser's find" ("Ctrl+F" off a Mac) under the input until a character is typed, said through a live region too. Enter and Shift+Enter step; a step lands on its cell, selected; Escape closes it, focus back where find opened, or on the table at the found cell once a step has landed. The term as typed sets the table's highlight; the count follows A3.
- [ ] **D2. Find with the rest:** a filter, a sort, a hide, a show, a move, or a new file cancels a step out and counts again (the table's README, "What cancels it"); `find <term>` from the bar opens the bar on it (B1); the Row tab follows a landing, as it follows the selection.

### Part E: the browser check, the docs, and the close

- [ ] **E1. A browser check, `just tycho filter [url]`,** on the release build in Chromium, Firefox, and WebKit, on GCAT: a header's arrow sorting and its log entry; `sort launch_date desc` typed and a sort's chip removed; a filter from the editor's Apply, one typed, and one pasted as JSON, each in `__tychoView`, the count, and the log; keep and leave out from a cell's menu; `undo` and the way back giving filters and a sort back; `clear all`; a filter leaving no row; Ctrl+F from the table opening find, a step landing on its cell with the count read, a second Ctrl+F in the bar not taken; Escape's focus; at 390×760 the toolbar's icons and find's second row; no console errors. The existing checks (`smoke`, `lockdown`, `engine`, `view`, `command`, `table`) pass in three browsers.
- [ ] **E2. The docs describe Tycho as it stands:** `CLAUDE.md` and each folder's (`crate/`'s source and controller, `web/`'s toolbar, editors, and find, `perf/`'s probes and the new check), the engine's README and `CLAUDE.md` for its source's order, filter, and find, the README (its features, and the canvas tradeoffs: find reaches every row, which the browser's Ctrl+F can't see, and gives it the second press), the research's table of the table's own tools, and the design canvas's notes on the Toolbar, "Columns and filters", and Phone pages. The "Waiting on" rows for `replace_rows`, find, and `sort` leave at the close. `just tycho check` passes on the final build, and smoke passes in three browsers, nothing requested before the first frame but the first-paint set.

---

## Roadmap

Each item becomes a milestone when it's opened. Each links to its section of [the research](../../docs/research/tycho-workbench.md), which holds the reasoning and what's marked decided, proposed, or open; a proposed part is checked and reviewed when its item is opened, before it's built.

### The first release

Built locally; production stays as deployed until its last item. The order is decided in `docs/DECISIONS.md`, "Scope", 2026-11-25.

1. **Sort, filter, and find,** with filter by a cell. Not thin: the DuckDB source's order, its `WHERE`, and its find are unbuilt engine work; the table's parts, `replace_rows` for filtering and `find`, are ready ("Waiting on"). *("The controller".)* *Opened as M15, above.*
2. **Profiles and the catalog,** grouping included, whose result is a new view. The profile comes in three stages, in the columns panel first. If it's too slow in use, a session of its own makes the sample faster before anything is cut; the header strip is asked of the tall table only after the panel's proves itself. *("The catalog"; "The column profile's cost", which holds the timings and that session's starting points.)*
3. **Export,** and the view copied as SQL. Its size plan is a cap (`docs/DECISIONS.md`, "Scope", 2026-11-21); the cap is measured and the storage route tested first ("Export's cap", below). *("The table's own tools".)*
4. **Open from a URL:** Parquet only, read by range, on a route of its own. It changes what the first screen's input takes: a Parquet file's URL alone ("Paste a Parquet file's URL", as the Start boards draw it), anything else answered with an error, the command answers there now a stand-in it replaces; a URL pasted before React loads opens too (`docs/DECISIONS.md`, "Scope", 2026-11-24). It comes before the connection policy, which has to know how this route loosens it. *("Opening a file".)*
5. **The instructions, and the clipboard and agent routes:** the Share menu's "Copy context", and the instructions an agent reads. *("How an LLM reaches it".)*
6. **Trust: the connection policy, offline, and the panel.** The policy is built against the URL route and the agent route as they stand, since it exists because the input is drivable. *("Trust".)*
7. **Views kept on the device, and the link to a view:** the views list's "Keep on this device" and "Forget", and the Share menu's "Copy link", as the design settled them (`docs/DECISIONS.md`, "Scope", 2026-11-20 and 2026-11-21: "Views last for the session", "One Share menu", "A link to a view of a dropped file"). Where a kept view is stored is the policy's question, so it follows Trust.
8. **JSONL,** then nested values: the engine's half (how a `LIST`, `STRUCT`, or `MAP` becomes cells and short text) and their full form in the cell popover and the row detail view. A long form in the popover apart from the cell's text would be a new ask of the tall table (its `docs/DECISIONS.md`, "Features", 2026-11-19). *("Opening a file".)*
9. **Ship the rebuild.** The new Tycho replaces the deployed one: the deploy; Gaia and the asteroids out of production's R2, which then holds DuckDB-Wasm's two wasm bundles alone; the zone's WAF rules and rate limit looked at again against the new build's requests, right after; and `README.md` and the root README's row as a visitor finds the app. Nothing of Kirkwood runs on Tycho's hostname: the zone's redirect for its old path answers before Tycho's rules and Worker. *The owner confirms every deletion in production and the deploy.* *(`docs/DECISIONS.md`, "Hosting", 2026-11-23.)*

### After the first release

1. **More than one file,** and joins. *("Opening a file".)*
2. **Charts,** after a planning session of their own. *("Charts".)*
3. **More samples,** each with a job the others don't do. GCAT's is "readable, with stories"; the next is "too big for a spreadsheet, and still instant": over a million rows, with text and categories a visitor recognizes. Its data is its own research, and the asteroids aren't a candidate: they left Tycho in the reset. If a sample is one another app builds too, its fetch moves to a folder both read; until then each built file has one owner, the app that reads it (`docs/DECISIONS.md`, "Sample data", 2026-11-23). No sample goes in R2: one Tycho serves stays under the static-asset limit, and a larger one is a Parquet file on someone else's host, read by range through "Open from a URL". A second sample reopens the first screen's one sample row. *([The sample's research](../../docs/research/tycho-sample.md).)*
4. **Checked SQL expressions,** after an ideation session of their own. *("Later: checked SQL expressions".)*
5. **A SQL editor,** once the lockdown is proven. *("Later: a SQL editor".)*

---

## Open questions

Named, not numbered: a question leaves when it's answered, its answer in `docs/DECISIONS.md`.

- **The profile's speed.** How the engine keeps page reads ahead of a profile query, and whether a smarter sample is needed, tried before the graphic is cut (the build, then a session of its own). The engine's speed has had no measurement of its own since Tycho's were retired, so this is where its page reads and CSV loading are timed again if a number is needed.
- **Column names going out.** How column names, which are the file's text, go out in the copied context and the capability schema.
- **The policy and the URL route.** What DuckDB-Wasm needs the connection policy to allow, how the URL route loosens it, and where anything saved in the browser is stored, kept views first.
- **The lockdown in a browser.** A dropped file's handle is answered, with the engine unlocked until `LOAD parquet` succeeds (M12 part A). Left: a remote file in Chromium (a 416 on a URL the page had downloaded whole; "Open from a URL"), and an export handed to the page ("Export").
- **Export's cap.** The cap's size, measured; and whether a file can be written to the browser's own storage and saved from there, with the engine locked down, which would lift the cap (tested before export is built).
- **JSONL's size limit,** if it loads into memory as a CSV does, and what the engine's reader does with nested values today.
- **Dropped files on the URL route.** Whether the URL route takes them.
- **WebMCP and on-device models.** Where each stands in the browsers that ship today.
- **`undo` after a view opens.** What `undo` does after a command that opened a view (left by the design session for the build).
- **A kept view's size,** measured against the caps' estimate ("Views kept on the device").
- **Ctrl+F from the table.** Taken on the way down as the page's other keys are (a key the canvas has focus for may never bubble up: M12 part B), checked when find is built. Cmd/Ctrl+K from the table reached the page in three browsers (M13 part B).
