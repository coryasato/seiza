# PLAN.md — Tycho

What's next for Tycho: milestone status, the next milestone's "done when" checks, the goals after it in order, and open questions. Only what's still open lives here. Context and rules are in `CLAUDE.md` here and at the repo root.

**Goal:** a data workbench for files too big for a spreadsheet, running entirely in the browser: open a file, understand it, check what you need, and export the part you want. The data never leaves the visitor's machine. Tycho is a utility app (root `CLAUDE.md`, "Tiers"): a public tool, built around a *controller* that sits between DuckDB-Wasm and the tall table, holds one *view state*, and can be driven by a person or by an outside LLM. Tycho hosts no model and takes no API key.

**The test for every feature:** does it help someone with a large file and a question? The first release is built for the quick checker ([`docs/personas.md`](docs/personas.md)).

**Tycho is being rebuilt.** This plan was rewritten on 2026-11-17 and replaces the old one whole: its carried-over perf reruns, its production-performance goal, and its open questions are not carried over. The reset (M11) is done: `CLAUDE.md` and the docs beside them describe the app as it stands, the ground the goals below replace piece by piece; Tycho's measurements are retired, and the wasm's size is the one number `check` gates.

**Where everything else lives:**
- [`../../docs/research/tycho-workbench.md`](../../docs/research/tycho-workbench.md): the research behind this plan: the security model, each piece, what was tested. Every goal below links to its section and never restates it.
- [`../../docs/research/tycho-sample.md`](../../docs/research/tycho-sample.md): the sample: why GCAT, its columns, and the spec its build starts from.
- [`docs/personas.md`](docs/personas.md): who Tycho is for and what each person needs.
- [`docs/milestones.md`](docs/milestones.md): the specs, checks, and evidence of finished milestones (history; not edited).
- [`docs/DECISIONS.md`](docs/DECISIONS.md): every decision, by area. Repo-wide ones: the root [`docs/DECISIONS.md`](../../docs/DECISIONS.md).
- [`docs/LESSONS.md`](docs/LESSONS.md): what each milestone taught us.

---

## Status

| Milestone | Title | Status |
|---|---|---|
| M0 | Empty GPUI Kit shell on the web | Done 2026-09-23 |
| M1 | First-paint baseline and perf overlay skeleton | Done 2026-09-23 |
| M2 | DuckDB in a worker, prefetched after first paint | Done 2026-09-23 |
| M3 | Asteroid sample over HTTP | Done 2026-09-24 |
| M4 | Virtualized table over paged queries | Done 2026-09-25 |
| M5 | Drop a Parquet file | Done 2026-09-27 |
| M6 | Drop a CSV with progressive loading | Done 2026-09-30 |
| M7 | Observation panel, jump to row, and hardening (parts A–G) | Done 2026-10-09 |
| M8 | Deploy to Cloudflare | Done 2026-10-10: https://tycho.seiza.io |
| M9 | Extract the table component and the DuckDB engine | Done 2026-10-13 |
| M10 | `trim-paths`: no home paths in the shipped wasm, redeployed | Done 2026-11-01 |
| — | Design session: the page, the thread, the profile, where answers show | Done 2026-11-21, on [the design canvas](https://claude.ai/artifact/CR8skvUDrUsVxE4zXJtRmK). Settled (`docs/DECISIONS.md`, "Scope", 2026-11-20 and 2026-11-21): the frame, the command bar, grouping as a view tab, the first screen, the theme, the toolbar, find's bar, the views list and its names, keeping views, the Share menu, the column's and the cell's menus, the filter's and the sort's editors, the headers, the profile's stages, the cell popover, its cue, what Enter opens, the row detail view, export's items and its cap, the frame at a phone, the page's keys and Ctrl+F, the double-click and the row view's focus, the command bar's grammar, what a pasted action and an export may do, "Show rows" as a view of its own, the views' caps, a link to a dropped file's view, and the sample's credit. What it left for the build or for a later goal is in "Open questions" |
| — | Sample session: which data, under the static-asset limit | Done 2026-11-21: GCAT, the catalog of every object launched to orbit, as one file ([the research](../../docs/research/tycho-sample.md); `docs/DECISIONS.md`, "Sample data") |
| M11 | Reset: the old Tycho retired, the ground cleared | Done 2026-11-23 |
| M12 | The engine locked down, the page's frame in the DOM, the controller thin | Done 2026-11-24 |
| M13 | The command bar and the log, minimal | Done 2026-11-24 |
| M14 | Table basics: the menus, the columns list, the popover, and the row view | Active, opened 2026-11-24 (below) |
| Later | The goals below, in order; the first release is everything through export, then "Ship the rebuild" | Each becomes a milestone when it's opened |

**Closing a milestone:** every "done when" check passes; new decisions are in `docs/DECISIONS.md`; a `docs/LESSONS.md` entry is written; and the milestone's spec and evidence move from here to the end of `docs/milestones.md`, leaving one row above. Tycho records no measurements (root `docs/DECISIONS.md`, "Measurement protocol", 2026-11-17); what it still checks is in M11.

**Waiting on** (features of a component or engine Tycho needs; only that crate's `PLAN.md` builds them, and the session that closes one flips its row to *Ready*):

| Needs | For | Status |
|---|---|---|
| The tall table's `replace_rows`, then column filtering and global filtering ([its PLAN](../../components/tall-table/PLAN.md)) | "Sort and filter", below | *Ready* (2026-11-18, tall-table M18) |
| The tall table's find | Search that keeps every row | *Ready* (2026-11-19, tall-table M20) |
| The tall table's column visibility | Hide and show columns | *Ready* (2026-11-18, tall-table M19) |
| The tall table's column summaries in the header | The column profile's strip, drawn by the table from numbers Tycho gives it. Asked for only once the panel's profile proves fast enough ("Profiles and the catalog", below) | *Not ready*, and not yet asked |
| The tall table's header icon: an icon the host gives each column, first in its header, its press reported; drawn raised under the pointer | The column's menu button (`docs/DECISIONS.md`, "Scope", 2026-11-20) | *Ready* (2026-11-21, tall-table M22): `header-icon`; its press is an event of its own, on release, with the badge's bounds for the menu |
| The tall table on touch: a tap on a header reported as one press, the sort arrow not a target of its own; a long press reported as a right-click is | The column's and the cell's menus at a phone | *Ready* (2026-11-22, tall-table M24): `clicks`' `set_header_tap_is_press(true)` makes a finger's tap anywhere on a header one `Clicked` (`Press` on its `Column`), a mouse's press on the arrow and band as before; a tap on the header's icon stays `HeaderIconPressed`; a long press is `Context` at its start, as built; a sort in the bare host's main-thread source froze a phone a noticeable while (the table's PLAN, "A sort's wait") |
| The tall table's sort by several columns | The sort's editor as a list; after the first release | *Not ready* |
| The tall table's cell popover (a cell's full value, with a button that reports an event) | The quick look before the row detail view, which its button opens ("Table basics", below); nested values shown in it ("JSONL") | *Ready* (2026-11-20, tall-table M21): a cell's exact text; a nested value's long form apart from its cell's text waits for the JSONL work (the table's `docs/DECISIONS.md`, "Features", 2026-11-19) |
| The tall table's popover for cut text only, its cue a fade: the popover and its cue on text that is cut and nowhere else, the cue drawn as the text washing out with a chevron past it, Enter left to the host on every other cell, the button filling the popover's width | The cell popover and the way from a cell to its row (`docs/DECISIONS.md`, "Scope", 2026-11-20) | *Ready* (2026-11-22, tall-table M23): three settings of `popover`, each off by default: `PopoverCells::CutText` (the cue and Enter on a text column's cut cells alone; `open_popover` still opens any cell), `PopoverCue::fade()` and `open_icon`, `PopoverButton::fill()` |
| The tall table's row marks | The investigator's bookmarks and tags ([`docs/personas.md`](docs/personas.md)); no goal holds them yet | *Not ready* |
| The tall table's fit as a call: a column fitted to its values by the host, as a double-click on its header's edge fits it | The column's menu's "Fit to its values" (M14 part B; `docs/DECISIONS.md`, "Scope", 2026-11-24) | *Ready* (2026-11-24, tall-table M25): `TallTableState::fit_column(column, window, cx)`, by index, the double-click's fit; a pinned column fitted past half the table's width leaves the run, `Pinned` heard before the widths (the table's `docs/DECISIONS.md`, "Features", 2026-11-24) |
| The tall table's built features | "Table basics", below | *Ready:* `custom-cells`, `live`, `follow`, `resize`, `select`, `copy`, `sort`, `pin`, `density`, `format`, `reorder`, `clicks`, `group-headers` (their dates: the table's `docs/milestones.md`) |

---

## M14: table basics, the menus, the columns list, the popover, and the row view

Opened 2026-11-24 from goal 3, and planned in four parts, one session each, after a short tall-table milestone that Part B waits on. It is local, as every goal before "Ship the rebuild" is.

**What it is:** the tall table's built features that need nothing from the engine, each adopted through the controller, and the DOM they open: a column's menu, a cell's menu, the left panel's column list, the cell popover, and the row detail view in the right panel's Row tab (the research's "The table's own tools"). Its form is the design session's (`docs/DECISIONS.md`, "Scope", 2026-11-20 and 2026-11-21: a header's type icon is its column's menu button; a column's menu, a cell's menu; the hidden columns' list; the cell popover and its cue; the row detail view; the double-click; Enter and focus; the page's keys; the panels' sheet at a phone) and the boards on [the design canvas](https://claude.ai/artifact/CR8skvUDrUsVxE4zXJtRmK): the "columns" page's Columns 1 and 2, Columns 4, and Headers A; the "views" page's Views 1, its lower half (the column list); the "cell" page's Cue C, the fade, Popover, Flow 1 and 2, and Row 1 to 4; Frame C's Row tab; and Phone 1, 2, and 4. A gap between a board and the build is specced and decided, never silent.

**Decided at its opening** (`docs/DECISIONS.md`, "Scope", 2026-11-24): the features adopted are `select`, `copy`, `clicks`, `hide`, `popover`, and `header-icon`, and no others (`density`, `live`, `follow`, `custom-cells`, and `group-headers` wait for a goal that asks); the menus hold only what runs, each later item joining the menu with its goal, where its board draws it; the left panel is built with its column list alone, no views and no profile; until the profile comes, a press on a column's row in that list opens the column's menu; "Fit to its values" is asked of the tall table as a call and built there first (its PLAN, "Next milestones").

**Not in it:** sorting, filtering, and find, and with them the menus' sort, filter, keep and leave-out items, the toolbar and its hidden chip (goal 4); "Group by this column", "Show its profile", the profile in the list, and the views list (goal 5); Copy as SQL and the Share menu (export, and open question 12); nested values in the popover and the row view (JSONL); a link that holds a view.

### Before Part B: the table's fit as a call

The tall table's milestone that makes its fit a call the host can make (its PLAN, "Next milestones"). Part B's "Fit to its values" waits on it ("Waiting on", above); Part A doesn't.

### Part A: the features through the controller, in Rust

- [ ] **A1. The table's features on, and the view state's new fields:** `select`, `copy`, `clicks`, `hide`, `popover`, and `header-icon` in the crate's and the bridge's features. The view state gains each column's hidden flag (`__tychoView` and the log's states with it), taken from the table's `ColumnsHidden` as M12 takes widths, so `undo` and the way back give a hide back. The selection stays the table's and isn't in the view state; the frame's state gains the active cell (its row and column) for the Row tab. `jump` selects its row now that the table can (M13 left it unselected for want of `select`), so the Row tab shows the row it jumped to. `copy`'s Cmd/Ctrl+C writes the selection through the bridge's clipboard writer, and a copy past its cap is answered in the frame's line.
- [ ] **A2. `hide` and `show` in the grammar** (`docs/DECISIONS.md`, "Scope", 2026-11-21, "A command is a verb, then a column, then its parts"): one or more columns (`hide nst, dmin, rms`), and `show all`; the agent's JSON `{"hide": ["nst", "dmin", "rms"]}` as the Log board draws it, and `{"show": …}`, typed and pasted reading to the same steps; completion offers shown columns to `hide` and hidden ones to `show`; all or none, as M13's verbs are ("nst is hidden already." is an answer, not an error); hiding the last shown column refused. Their words ("Hide nst, dmin, and rms", "Show all 3 hidden columns") and their log entries, a hide from a menu or the list an entry from a click.
- [ ] **A3. The header icons, the presses, and the popover's settings:** each header's icon is its type's badge, drawn as the Headers A board draws it, its raised look under the pointer with the 1 px border (`docs/DECISIONS.md`, "Scope", 2026-11-21); `set_header_tap_is_press(true)` and Ctrl+press as a context press on a Mac; the popover's settings as decided (`PopoverCells::CutText`, `PopoverCue::fade()` with its chevron, `PopoverButton::custom(…).fill()`, drawing "Open row" in the accent at its left and "Enter" muted at its right, as Popover and the fade's boards draw it: `PopoverButton::label` draws one text and can't hold the hint). Each press the table reports (the icon's press with its bounds, a header's context press, a cell's context press, a double press, Enter on a cell with no popover, the popover's button) reaches the page as one event in the frame's calls, spelled alike on both sides, with what the menu needs to draw: the column's name, type, DuckDB type, and pinned or hidden; a cell's column, row, and shown value.
- [ ] **A4. The row's values for the Row tab:** a call that gives the page the active row's every column, hidden ones included, in the view's order: from the page cache when it's loaded, else read through `query` as one row, never the whole result (Tycho's rule 3). Each value as the row view shows it: text whole up to a cap, a number and a timestamp in their exact form, NULL as NULL. Native tests: `hide` and `show` (parse, JSON, completion, all or none, the log, `undo` giving a hide back), the hidden flags taken from the table in GPUI's test app, and the row's values from a loaded and an unloaded page. The wasm's size against the baseline in the part's notes (`just tycho check`): about +40 KiB brotli in all, by the table's README's rows (`select` 6.5, `copy` 11.0, `popover` about 17 with its settings, `header-icon` about 4 over the SVG drawing `popover` already links, `clicks` and `hide` about 1 each), within the size gate's 15%.

### Part B: the menus and the columns list, in the DOM

- [ ] **B1. A column's menu, as Columns 1 draws it:** its head the type's badge, the name, and the DuckDB type; then Pin to the left (Unpin on a pinned column), Hide, and Fit to its values (the table's call, built before this part), in the board's places with its icons. Opened by the header icon's press under its bounds, a right-click or long press on the header, and a press on the column's row in the list; acting puts focus on the table, Escape puts it back where it came from. At a phone, a tap anywhere on a header opens it as a sheet from the bottom, rows 44 px tall (Phone 4). Built on Base UI's Menu.
- [ ] **B2. A cell's menu, as Columns 2 draws it:** its head the type's badge, the column and the row ("place · row 7"), and the value cut to a line; then Copy (⌘C or Ctrl C by the platform) and Open the row. Opened by a right-click, a long press, or Ctrl+click on a Mac, on a cell; a context press inside a selected range keeps it (the table's `clicks`), and Copy copies that range. At a phone, a sheet from the bottom (`docs/DECISIONS.md`, "Scope", 2026-11-21).
- [ ] **B3. The left panel's column list, as Views 1 draws its lower half:** opened from the top bar's left button ("Toggle the left panel"), 264 px, a column of the page's grid beside the table as the right panel is; its head "Columns" with the shown count of all ("19 of 22"); the search field ("Search columns"), filtering the list as typed; each column a row of its badge and name, a hidden one muted with the eye-off icon; a press or Enter on a row opens its menu (the one way in for a keyboard or a screen reader), a hidden column's menu holding Show in Hide's place. The head's "Show and hide columns" button opens Columns 4's list (each column's eye, "3 of 22 hidden", Show all) as a dropdown anchored under that button, 288 px, its left edge at the button's and kept inside the page, as Columns 4 anchors it under the toolbar's chip, which waits for goal 4 (a gap no board draws, decided here). At a phone it's the Columns tab of the panels' sheet, beside Row and Log (Phone 2), without a profile.

### Part C: the popover and the row view

- [ ] **C1. The cell popover, as the cell page draws it:** the cue and the popover on cut text only (Cue C, the fade), opened by the chevron or by Enter (Flow 1), its button "Open row" opening the Row tab; Enter on any cell with no popover opens the Row tab, that field marked (Flow 2); a double-click on a cell opens it too, the right panel opening if it was closed (`docs/DECISIONS.md`, "Scope", 2026-11-21). Opened by Enter, the row view takes focus at the active cell's field; opened by the pointer, focus stays on the table; Escape in the view puts focus on the table and leaves the panel open.
- [ ] **C2. The Row tab, as Row 1 to 4 and Frame C draw it:** the right panel's second tab (Log, Row), its head "Row 7 of 38,112" with Previous row and Next row, which move the table's selection, and Copy the row; every column a field in the table's order, its badge and name, a hidden one marked "hidden in the table", the active cell's field in the accent; a field under the pointer or in focus showing Copy this value and the cell's menu (Row 2: Copy alone, until the filters); long text cut at eight lines with "Show all N characters" (Row 3); "No row selected" and its line with nothing selected (Row 4). The tab follows the table's selection, one state. Select-all in the tab takes its fields' text and none of its chrome. At a phone, the Row tab of the panels' sheet (Phone 1).

### Part D: the browser check, the docs, and the close

- [ ] **D1. A browser check, `just tycho table [url]`,** on the release build in Chromium, Firefox, and WebKit: the header icon's press opens the column's menu, and Hide, Pin, Unpin, and Fit each land in `__tychoView` and the log; a right-click on a cell opens its menu, and Copy writes the cell's text; `hide nst, dmin` typed and `{"show": ["nst"]}` pasted, read back, `undo` giving a hide back; the column list's search, a row's Enter opening its menu, a hidden column shown from it; Enter on a cut cell opening the popover, Enter again opening the Row tab with focus at that field, and on a number opening the Row tab at once; a double-click opening it with focus left on the table; Next row moving the selection; a hidden column's field marked; Cmd/Ctrl+C on a selected range; no console errors. At 390×760, a tap on a header opening the menu's sheet, and the sheet's Columns and Row tabs.
- [ ] **D2. The docs describe Tycho as it stands, and the milestone closes:** `CLAUDE.md` and each folder's (`crate/`, `web/`, `perf/`'s probes), the README (its features, and the canvas tradeoffs: the menus, the column list, and the row view are DOM, so a keyboard and a screen reader reach every column's actions and every value through them, while the popover is drawn on the canvas), and the research's table of the table's own tools. `just tycho check` passes on the final build, and smoke passes in three browsers, nothing requested before the first frame but the first-paint set.

---

## Goals, in order

Not milestones yet. Each links to its section of [the research](../../docs/research/tycho-workbench.md), which holds the reasoning and what's marked decided, proposed, or open; a proposed item is checked and reviewed when its goal is opened, before it's built. **The first release is everything through "Export", the connection policy if it's taken, and then "Ship the rebuild".** It is built locally: production stays as deployed until it ships.

1. **The controller, thin, and the engine's lockdown.** *Done as M12, with the page's frame in the DOM added to it ([`docs/milestones.md`](docs/milestones.md)).*
2. **The command bar and the log, minimal.** *Done as M13 ([`docs/milestones.md`](docs/milestones.md)).*
3. **Table basics.** *Opened as M14, above.*
4. **Sort, filter, and find,** with filter by a cell. Not thin: the DuckDB source's order, its `WHERE`, and its find are unbuilt engine work; the table's parts, `replace_rows` for filtering and `find`, are ready ("Waiting on"). *("The controller".)*
5. **Profiles and the catalog,** grouping included, whose result is a new view. The profile comes in three stages, in the columns panel first. If it's too slow in use, a session of its own makes the sample faster before anything is cut; the header strip is asked of the tall table only after the panel's proves itself. *("The catalog"; "The column profile's cost", which holds the timings and that session's starting points.)*
6. **Export,** and the view copied as SQL. Its size plan is a cap (`docs/DECISIONS.md`, "Scope", 2026-11-21); the cap is measured and the storage route tested first (question 5). *("The table's own tools".)*
7. **The connection policy.** *Proposed* as part of the first release, since the input is drivable from the day it ships. *("Trust".)*
8. **Ship the rebuild.** The new Tycho replaces the deployed one: the deploy; Gaia and the asteroids out of production's R2, which then holds DuckDB-Wasm's two wasm bundles alone; the zone's WAF rules and rate limit looked at again against the new build's requests, right after; and `README.md` and the root README's row as a visitor finds the app. It comes after the last goal the first release takes. (Kirkwood moved to `kirkwood.seiza.io` on 2026-11-23, so nothing of its runs on Tycho's hostname: the zone's redirect for its old path answers before Tycho's rules and Worker.) *The owner confirms every deletion in production and the deploy.* *(`docs/DECISIONS.md`, "Hosting", 2026-11-23.)*
9. **Open from a URL:** Parquet only, read by range, on a route of its own. It changes what the first screen's input takes: a Parquet file's URL alone ("Paste a Parquet file's URL", as the Start boards draw it), anything else answered with an error, the command answers there now a stand-in it replaces; a URL pasted before React loads opens too (`docs/DECISIONS.md`, "Scope", 2026-11-24). *("Opening a file".)*
10. **The instructions, and the clipboard and agent routes.** *("How an LLM reaches it".)*
11. **Trust:** offline, and the panel. *("Trust".)*
12. **JSONL,** then nested values: the engine's half (how a `LIST`, `STRUCT`, or `MAP` becomes cells and short text) and their full form in the cell popover and the row detail view. *("Opening a file".)*
13. **More than one file,** and joins. *("Opening a file".)*
14. **Charts,** after a planning session of their own. *("Charts".)*
15. **Checked SQL expressions,** after an ideation session of their own. *("Later: checked SQL expressions".)*
16. **A SQL editor,** once the lockdown is proven. *("Later: a SQL editor".)*
17. **More samples,** each with a job the others don't do. GCAT's is "readable, with stories"; the next is "too big for a spreadsheet, and still instant": over a million rows, with text and categories a visitor recognizes. Its data is its own research, and the asteroids aren't a candidate: they left Tycho in the reset. If a sample is one another app builds too, its fetch moves to a folder both read; until then each built file has one owner, the app that reads it (`docs/DECISIONS.md`, "Sample data", 2026-11-23). No sample goes in R2: one Tycho serves stays under the static-asset limit, and a larger one is a Parquet file on someone else's host, read by range through "Open from a URL". A second sample reopens the first screen's one sample row. *([The sample's research](../../docs/research/tycho-sample.md).)*

---

## Open questions

1. The profile's speed: how the engine keeps page reads ahead of a profile query, and whether a smarter sample is needed, tried before the graphic is cut (the build, then a session of its own). The engine's speed has had no measurement of its own since Tycho's were retired, so this is where its page reads and CSV loading are timed again if a number is needed.
2. How column names, which are the file's text, go out in the copied context and the capability schema.
3. The connection policy: what DuckDB-Wasm needs it to allow, how the URL route loosens it, and where anything saved in the browser is stored, kept views first. Kirkwood no longer shares the origin (it moved to `kirkwood.seiza.io`, 2026-11-23).
4. The lockdown in a browser: answered for a dropped file's handle and the engine unlocked until `LOAD parquet` succeeds (M12 part A). Left: a remote file in Chromium (a 416 on a URL the page had downloaded whole; "Open from a URL"), and an export handed to the page (export).
5. Export: the cap's size, measured; whether a file can be written to the browser's own storage and saved from there, with the engine locked down, which would lift the cap (tested before export is built).
6. JSONL's size limit, if it loads into memory as a CSV does, and what the engine's reader does with nested values today.
7. Whether the URL route takes dropped files.
8. Where WebMCP and on-device models stand.
9. *Answered 2026-11-24:* the panels' sheet opens at 62% of the page's height and drags to its height under the top bar (`docs/DECISIONS.md`, "Scope"). Kept so the questions after it keep their numbers.
10. Left by the design session for the build: what `undo` does after a command that opened a view; a kept view's size, measured against the caps' estimate; and Ctrl+F from the table, taken on the way down as the page's other keys are (a key the canvas has focus for may never bubble up: M12 part B), checked when find is built. Cmd/Ctrl+K from the table reached the page in three browsers (M13 part B).
11. The design canvas still draws its stand-in earthquakes, the first screen's sample row included: whether its boards are redrawn with GCAT before the build.
12. A link that holds a view: the design decided what it holds and how it opens (`docs/DECISIONS.md`, "Scope", 2026-11-20 and 2026-11-21), but no goal builds it. Which goal takes it, with the Share menu.
