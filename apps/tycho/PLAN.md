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
| M15 | Sort, filter, and find | Done 2026-11-26 |
| M16 | Profiles and the catalog: the column profile, the catalog's small answers, and the filter editor's preview | **Active**, opened 2026-11-27 (below) |
| Later | The roadmap below, in order | Each item becomes a milestone when it's opened |

**Closing a milestone:** every "done when" check passes; new decisions are in `docs/DECISIONS.md`; a `docs/LESSONS.md` entry is written; and the milestone's spec and evidence move from here to the end of `docs/milestones.md`, leaving one row above. Tycho records no measurements (root `docs/DECISIONS.md`, "Measurement protocol", 2026-11-17); what it still checks is in M11.

**Waiting on** (features of a component or engine Tycho needs; only that crate's `PLAN.md` builds them, the session that closes one flips its row to *Ready*, and a row leaves when the milestone that adopts it closes):

| Needs | For | Status |
|---|---|---|
| The tall table's column summaries in the header | The column profile's strip, drawn by the table from numbers Tycho gives it. Asked for only once the panel's profile proves fast enough (M16's E2 decides whether to ask) | *Not ready*, and not yet asked |
| The tall table's sort by several columns | The sort's editor as a list; after the first release | *Not ready* |
| The tall table's row marks | The investigator's bookmarks and tags ([`docs/personas.md`](docs/personas.md)); no roadmap item holds them yet | *Not ready* |
| The tall table's sort arrow's color, set by the host ([its PLAN](../../components/tall-table/PLAN.md), "The sort arrow's color") | Headers A's sorted arrow in the accent, as the design draws it (the table draws it in the header's text color: `docs/DECISIONS.md`, "Scope", 2026-11-26). Not urgent; adopted once *Ready* in a small milestone of its own, before "Ship the rebuild" | *Not ready* (asked 2026-11-26) |

---

## Active milestone

### M16: profiles and the catalog

Opened 2026-11-27 from the first release's first item, split from grouping at its opening (`docs/DECISIONS.md`, "Scope", 2026-11-27), and planned in five parts, one session each. It is local, as every item before "Ship the rebuild" is.

**What it is:** a column understood without scrolling it. The column profile (type, nulls, distinct count, range, median and mean, and its shape: a histogram for a number or a timestamp, the most common values for text) in the left panel's column list, opened in place on a row's press, in three stages, each replacing the last; the catalog's first entries as the grammar's `top`, `nulls`, and `distinct`, whose small answers show in the log; the column lines of the command bar's list with the profile's facts; and the filter editor's preview, drawn from the same profile (the research's "The catalog" and "The column profile's cost"). Its form is the design session's (`docs/DECISIONS.md`, "Scope", 2026-11-20: "The column profile is drawn in three stages, in the panel first"; "A column's menu, a cell's menu, and the editors") and the boards on [the design canvas](https://claude.ai/artifact/CR8skvUDrUsVxE4zXJtRmK): the "Profile" page's Panel 1 to 3; the "Columns and filters" page's Filter 1 to 3 with their preview; Grouping 1's log entry for `nulls` ("19,998 nulls · 68.7% of the rows in view"); and the phone's panels sheet, Columns tab. A gap between a board and the build is specced and decided, never silent.

**Decided at its opening** (`docs/DECISIONS.md`, "Scope", 2026-11-27): grouping and the views list leave this item for one of their own, next on the roadmap; a press on a column's row opens its profile in place, as the Profile boards draw it, and the profile's foot holds Filter, Sort, Hide, and a "More" button that opens the column's whole menu, so a keyboard still reaches every item from the list; the profile's number queries leave out infinities and NaN and count them as nulls are counted ("51 infinite"), and GCAT's `apogee_km` stays as the data has it; `undo` of a step that opened a view closes that view (built with views).

**Not in it:** grouping, the views list, `group` and `rows` (the next item); the header strip (Strip 1 to 3: asked of the tall table only once the panel's profile proves fast enough, which E2 judges); the rest of the catalog's entries (quantiles, outliers, text patterns, duplicate rows, a unique key), each added when an item asks; totals of the selection; `sql` ("Export").

**Done when:**

#### Part A: the profile's engine half, timed, in Rust

- [ ] **A1. The profile's queries, by stage and by source.** Stage 1 (at once): a Parquet file's range and null count from its footer (`parquet_metadata`), which covers the whole file, so only an unfiltered view of a Parquet file has a stage 1; a filtered view, and a CSV in memory (no footer), start at stage 2, with what Panel 1 shows in its place chosen here. A footer's range with an infinite end isn't shown as one (the column's range waits for stage 2). Stage 2 (soon): every figure and the shape from a sample (`TABLESAMPLE SYSTEM` on Parquet; a CSV's way chosen here), marked sampled with its share ("from a 1% sample"). Stage 3 (exact): every row in view, for the open column, or every column of a file small enough (the line chosen here, from the timings). Stages 2 and 3 run over the rows in view (the filters' index when there is one); a number's and a timestamp's histogram has 20 bins over the finite range its own query found, never the footer's; a text column has its top values with counts. A sample's distinct count isn't the column's, and is never shown scaled as "about": A1 times `approx_count_distinct` over every row in view, and if that's too slow for stage 2, stage 2 shows the sample's count as a floor ("at least 2,400") and Panel 2's board is redrawn to match; stage 3's is exact. Infinities and NaN are left out of a number's figures and counted. Every query's SQL built from the column's quoted name and `filter::literal`, never joined text. Timed in DuckDB-Wasm on the release build, as M15's A1 was, on GCAT (Parquet and as a CSV) and on `drop/asteroids-x3.parquet` and `drop/asteroids-x27.parquet`: each stage's time to its answer, and stage 3's for one column. The timings go in the decision that sets the stages, the sample's share, and the small file's line.
- [ ] **A2. A profile beside page reads.** How the engine queues a profile query and a page read today (the research's "Open, for the build"), measured on ×27: the time to a page during a stage-2 and a stage-3 query. If a page waits on a profile, page reads go first, or the profile runs in pieces that yield; decided from the numbers, in the engine's files if it changes the engine. The observatory's GPUI contender builds the engine too, so a change to it records its size effect for the observatory, passes `just observatory check`, and is read against `.claude/rules/comparison-protocol.md` before it lands. A new open, a filter change (after a pause, as the design decided), or the profile closed cancels what's in flight in DuckDB, and a filter change starts again from stage 2.
- [ ] **A3. The profile in the controller.** A column's profile as state the frame can draw (its stage, its figures, its shape, the rows it was read from: "of the 29,118 rows in view", "from a 1% sample"), held per column and per view state, never in `ViewState` (it's derived, not chosen), published read-only while measuring (`__tychoProfile`, in `perf/CLAUDE.md`'s probes). Native tests: each stage's SQL per type, the quoting, the non-finite count, the cancel on a filter change, a CSV's stages. `just tycho check`'s wasm size, its growth read against M15's final 2955.6 KiB brotli, under the gate's limit of 3283.0 (the baseline's 2854.8 + 15%) or with a row in `perf/budget-notes.md` that says why it's worth it.

#### Part B: the catalog, and `top`, `nulls`, and `distinct`

- [ ] **B1. The catalog as one table in Rust:** each entry's name, the column types it applies to, its parts, and its SQL, read by the grammar (verbs, completion, refusals) and later by the capability schema and an agent's instructions, so none of them offers what it can't run. Its first entries: `top` (a column, a count, left out 5), `nulls`, and `distinct` (a column each), from the grammar's table (`docs/DECISIONS.md`, "Scope", 2026-11-21), typed and as JSON; they leave `LATER`, and `group` and `rows` there name "views and grouping".
- [ ] **B2. Their answers in the log,** over the rows in view, as Grouping 1 draws `nulls end_date` ("19,998 nulls · 68.7% of the rows in view"): `top` a short table of values and counts, `distinct` a count. Each is exact (a small answer is a question asked; its cost on ×27 is in A1's timings, and an answer still out says so, cancelled by Escape or the next command). An answer changes no view state: `undo` and the way back pass over it, as they do an export. A type the entry doesn't take is refused with the types it does. Native tests.
- [ ] **B3. The bar's column lines** read the profile's facts where it has them (the Command page's note: "A column's line in the list is its DuckDB type until the profile gives ranges and counts"), and the type alone where it hasn't.

#### Part C: the profile in the panel, in the DOM

- [ ] **C1. Panel 1 to 3 as drawn:** a row's press opens its column's profile in place under it, one open at a time, its chevron turned; the type in mono, the stage's line ("reading a sample…", "from a 1% sample · reading every row…", "of the 29,118 rows in view"); the histogram (Panel 1's placeholder bars, Panel 2's muted, Panel 3's full) with its range under it, or a text column's top values; Nulls, Distinct, Median, Mean (a text column's figures as the Profile boards' text case draws them, or decided here if none is drawn); a row's null share at its right ("0.3% null") once stage 1 knows it; under a filter, or for a CSV, a row shows its null share only once its column's profile has been read, never the whole file's beside a filtered count. The foot's Filter (the filter editor on the column), Sort, Hide, and More (the column's menu); a column's menu gains "Show its profile", as the design's menu lists it.
- [ ] **C2. The keyboard and a phone:** Enter or Space on a row opens and closes its profile, the foot's buttons in the tab order, Escape closes it with focus back on its row; a screen reader hears the stage change through a live region once, not every bar. At a phone, the panels' sheet's Columns tab opens the same profile.

#### Part D: the filter editor's preview

- [ ] **D1. Filter 1 to 3's preview from the profile:** a number's and a timestamp's histogram under the fields, the bars the filter keeps in the accent as the value changes, "from the profile of the 29,118 rows in view" under it; a text column with few values, Filter 2's checklist (values, bars, counts, "6 of 9 values shown · counts from the profile of the rows in view"), checking a value writing `in`'s list, replacing the typed list for such a column; a column with many values keeps the typed list (the line between them decided here). Nothing is queried as the visitor types (`docs/DECISIONS.md`, "Scope", 2026-11-20): the editor reads the profile the panel has, and starts one at stage 2 if none is open.

#### Part E: the browser check, the docs, and the close

- [ ] **E1. A browser check, `just tycho profile [url]`,** on the release build in Chromium, Firefox, and WebKit, on GCAT: a row's press opening its profile through the three stages (read back from `__tychoProfile` and the DOM); a text column's top values; `apogee_km`'s infinities counted; a filter changing it back to a sample and on to exact; Enter, Escape, and More from the keyboard; `top`, `nulls`, and `distinct` typed and as JSON, their answers in the log and `undo` passing over them; the filter editor's bars and Filter 2's checklist applying `in`; at 390×760 the sheet's profile; no console errors. The existing checks (`smoke`, `lockdown`, `engine`, `view`, `command`, `table`, `filter`) pass in three browsers.
- [ ] **E2. Is the profile fast enough?** Judged by hand on ×27 and GCAT in the browser, against the design's rule (a quick estimate beats an exact shape that is late): if it is, the "Waiting on" row for the header strip is asked of the tall table's PLAN; if it isn't, the session for a faster sample is inserted before the close (the research's starting points), the open question "The profile's speed" answered either way.
- [ ] **E3. The docs describe Tycho as it stands:** `CLAUDE.md` and each folder's (`crate/`'s profile and catalog, `web/`'s panel and editor, `perf/`'s probes and the new check), the engine's files if A2 changed it, the README's features, the research's table of the table's own tools and the catalog's section, and the design canvas's notes on the Profile, "Columns and filters", Command bar, Grouping, Views, Frame, and Phone pages (grouping now names "Views and grouping"). `just tycho check` passes on the final build, and smoke passes in three browsers, nothing requested before the first frame but the first-paint set.

---

## Roadmap

Each item becomes a milestone when it's opened. Each links to its section of [the research](../../docs/research/tycho-workbench.md), which holds the reasoning and what's marked decided, proposed, or open; a proposed part is checked and reviewed when its item is opened, before it's built.

### The first release

Built locally; production stays as deployed until its last item. The order is decided in `docs/DECISIONS.md`, "Scope", 2026-11-25.

1. **Profiles and the catalog:** M16, above. The item held grouping too until it opened, and was split in two (`docs/DECISIONS.md`, "Scope", 2026-11-27).
2. **Views and grouping:** the views list in the left panel (Views 1 to 5 and at a phone: "+", duplicate, a new view of all rows, renaming in the row, closing, the cap of 20), `group` and its view (Grouping 1: the grouped table, its toolbar, its share column and bars), and "Show rows" and `rows` (Grouping 2), as the design settled them (`docs/DECISIONS.md`, "Scope", 2026-11-20 and 2026-11-21: "A grouped result opens as a view tab", "'+' is every way to make a view", "A view's name is automatic", "The views' caps", "'Show rows' on a group opens a view of its own"); `undo` of a step that opened a view closes it (2026-11-27). Keeping views, Forget, and Copy link stay with "Views kept on the device". *("The catalog".)*
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
- **A kept view's size,** measured against the caps' estimate ("Views kept on the device").
