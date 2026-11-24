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
| M13 | The command bar and the log, minimal | Active, opened 2026-11-24 (below) |
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
| The tall table's built features | "Table basics", below | *Ready:* `custom-cells`, `live`, `follow`, `resize`, `select`, `copy`, `sort`, `pin`, `density`, `format`, `reorder`, `clicks`, `group-headers` (their dates: the table's `docs/milestones.md`) |

---

## M13: the command bar and the log, minimal

Opened 2026-11-24 from goal 2, and planned in three parts, one session each. It is local, as every goal before "Ship the rebuild" is.

**What it is:** the input and the history every later goal shows its commands and answers in (the research's "The thread"). The command bar sits in the top bar's middle and is the first screen's box, as the design draws it; the log is a tab of a collapsible panel at the right. The controller parses, completes, runs, and replies in Rust; the page draws the bar and the log from what the app publishes. Its form is the design session's (`docs/DECISIONS.md`, "Scope", 2026-11-20 and 2026-11-21: the command bar, the grammar, a pasted action, the page's keys) and the boards on [the design canvas](https://claude.ai/artifact/CR8skvUDrUsVxE4zXJtRmK)'s "Command bar" page, Frame C, and Phone 3 and 6.

**Decided at its opening** (`docs/DECISIONS.md`, "Scope", 2026-11-24): the bar runs only what the controller can do today (`pin`, `unpin`, `jump`, `undo`), and each later goal adds its verbs; a drag of the table's is a log entry in words; with nothing typed, the bar's list ends with the first screen's rows, which is how another file opens once one is; a sentence is answered without Copy context until the clipboard goal; the research's two proposed items for the thread are taken (each entry holds a view state; the logic is Rust's); `pin` and `unpin` name a column and move it across the pinned run's edge.

**Not in it:** every other verb of the grammar (each with its goal: `hide` and `show` with "Table basics"; `sort`, `filter`, `find`, and `clear` with "Sort, filter, and find"; `group`, `rows`, `top`, `nulls`, and `distinct` with "Profiles and the catalog"; `sql` and `export` with "Export"); Copy context and the text an assistant is given ("The instructions, and the clipboard and agent routes"); the Row tab ("Table basics"); the left panel, the views list, the toolbar, and the Share menu; the first screen's URL row ("Open from a URL"); Ctrl+F (find's goal).

### Part A: the grammar, the commands, and the log, in Rust

- [ ] **A1. One parser reads the grammar, typed and as JSON** (`docs/DECISIONS.md`, "Scope", 2026-11-21, "A command is a verb, then a column, then its parts"): a column's name bare or in double quotes, a quote inside written twice, matched without regard to case, and a name that isn't a column answered with the nearest ones ("Did you mean…"); an agent's JSON (`{"pin": {"column": "mag"}}`, several steps under `"actions"`) and a typed line parse to the same action. Its verbs are `pin`, `unpin`, `jump` (a row's number, read as `jump.rs` reads it now), and `undo`; any other verb of the grammar's table is answered with the goal it comes with, never a parse error; a line that starts with no verb and reads as words is a sentence. Completion is a call of its own: for the text and the caret, the part being typed (a verb, a column with its type, a part's choices) and what matches. Every step has its plain words ("Pin mag", "Jump to row 1,204").
- [ ] **A2. The controller runs an action all or none** ("A pasted action waits for Enter, always, and its steps run all or none"): every step is checked against the open file before any runs, and a refusal says which step and why. `pin x` moves `x` to the end of the pinned run and pins one more; `unpin x` moves it to just past the run and pins one fewer; a column already on that side is answered, not moved. `jump` brings the row into view, without selecting it (the table's `select` comes with "Table basics"); on a CSV still loading, a row past those read says so, as `jump.rs` does.
- [ ] **A3. The log, as history:** each entry holds its command line (none for a drag), its plain words, Tycho's reply (rows and columns, a small answer, or an error), where it came from (drop, pick, the sample, typed, pasted, click), its time, and the view state after it. Opening a file is its first entry (`open <name>`, as a record), and a new file starts the log again. A drag is an entry in words ("Moved mag after time", "Widened place to 240 px"), a run of resizes of one column one entry; a pin made in the table is the entry `pin x`, from a click. One entry is current; the way back on an entry restores its state, `undo` restores the state of the entry before the current one, and neither adds an entry; a step taken after going back is added at the end, from the current state. An entry whose state can't be given back (a refusal, an answer) has no way back. Native tests: the parser (names, quotes, case, nearest names, JSON and typed alike, verbs not built yet, sentences), completion, all-or-none, `pin` and `unpin` against the table in GPUI's test app, and the log's entries, current, undo, and the way back.
- [ ] **A4. The page's calls and the frame's state:** `command(text, source)` and `complete(text, caret)` (synchronous, so completion keeps up with typing), and `back_to(entry)`, beside the frame's calls (`crate/src/frame.rs`, `core.ts`'s `App`); the frame's state gains the log and the bar's last answer, both sides spelled alike. `globalThis.__tychoView` stays read-only. The wasm's size against the baseline is in the part's notes (`just tycho check`).

### Part B: the command bar in the DOM

- [ ] **B1. The bar, as the "Command bar" page draws it,** in the top bar's middle once a file is open: opened, the commands with their lines, then the first screen's rows (choose a file, the sample) under "Open"; completing a part, the matches below with a column's type; a whole command, its plain words before Enter; a pasted action, its steps listed and run on Enter ("Nothing runs until you press Enter…"); a sentence, "Tycho reads commands, not sentences" and See the commands; a refusal, its step named. Keys as the page's keys table says: Cmd/Ctrl+K from anywhere, the table's focus included (open question 10, checked here), Enter runs and puts focus on the table, Escape closes and puts focus back where it came from, the arrows move in the list. Built on Base UI, so its focus, keys, and ARIA are the component's.
- [ ] **B2. The first screen's box is the bar** (`docs/DECISIONS.md`, "Scope", 2026-11-20, "The first screen is the command bar, open in a blank workbench"): the input over the two rows, prerendered and run by `core.ts` before React, so a row is chosen as it is now; a command typed before a file is open is answered that a file opens first. When a file opens, the bar moves to its place in the top bar (about 200 ms; no motion under reduced motion).
- [ ] **B3. At a phone, and rule 2:** the bar takes the top bar's row and its list fills the page under it, in rows a finger tall, with no key hints (Phone 6). Plex Mono, the bar's and the log's face, loads after the first frame. Smoke passes in three browsers on the release build, nothing requested before the first frame but the first-paint set, and `just tycho build`'s weight before first paint is printed against M12's (2933.1 KiB brotli).

### Part C: the log, the checks, and the close

- [ ] **C1. The log, as Frame C draws it:** a panel at the right with its Log tab (the Row tab comes with "Table basics"), collapsed and opened from the top bar's button; each entry's command in Plex Mono (a drag's words in its place), the reply, an error in the error color, its source's icon and time, the way back where there is one, "current" on the current entry; the foot "Replies are Tycho's own. Nothing is sent to a model." The chrome isn't selectable, so select-all in the tab takes its entries alone; Escape puts focus on the table and leaves the panel open. At a phone, the Log tab in the panels' sheet (Phone 3), and how tall that sheet opens is chosen (open question 9).
- [ ] **C2. A browser check, `just tycho command [url]`,** on the release build in Chromium, Firefox, and WebKit: Cmd/Ctrl+K from the table and from the first screen; `pin` typed, read back from `__tychoView` and the log; a pasted JSON action of two steps, one naming a column the file doesn't have, runs neither and names it; a sentence answered; `jump` to a row brings it into view; a column dragged lands as an entry; `undo` and a way back give back the state each names; another file opened from the bar's list starts the log again; no console errors.
- [ ] **C3. The docs describe Tycho as it stands, and the milestone closes:** `CLAUDE.md` and each folder's (`crate/`, `web/`, `perf/`'s probes), the README (its features, and the canvas tradeoffs: the bar and the log are DOM, read by a screen reader and the browser's find), and the research's marks for the thread. `just tycho check` passes on the final build and smoke passes in three browsers.

---

## Goals, in order

Not milestones yet. Each links to its section of [the research](../../docs/research/tycho-workbench.md), which holds the reasoning and what's marked decided, proposed, or open; a proposed item is checked and reviewed when its goal is opened, before it's built. **The first release is everything through "Export", the connection policy if it's taken, and then "Ship the rebuild".** It is built locally: production stays as deployed until it ships.

1. **The controller, thin, and the engine's lockdown.** *Done as M12, with the page's frame in the DOM added to it ([`docs/milestones.md`](docs/milestones.md)).*
2. **The command bar and the log, minimal.** *Opened as M13, above.*
3. **Table basics:** the tall table's built features that need nothing from the engine (M12 takes `resize`, `reorder`, `pin`, and `format`), each adopted through the controller, and the row detail view, in the DOM, opened from the table's cell popover. *("The table's own tools".)*
4. **Sort, filter, and find,** with filter by a cell. Not thin: the DuckDB source's order, its `WHERE`, and its find are unbuilt engine work; the table's parts, `replace_rows` for filtering and `find`, are ready ("Waiting on"). *("The controller".)*
5. **Profiles and the catalog,** grouping included, whose result is a new view. The profile comes in three stages, in the columns panel first. If it's too slow in use, a session of its own makes the sample faster before anything is cut; the header strip is asked of the tall table only after the panel's proves itself. *("The catalog"; "The column profile's cost", which holds the timings and that session's starting points.)*
6. **Export,** and the view copied as SQL. Its size plan is a cap (`docs/DECISIONS.md`, "Scope", 2026-11-21); the cap is measured and the storage route tested first (question 5). *("The table's own tools".)*
7. **The connection policy.** *Proposed* as part of the first release, since the input is drivable from the day it ships. *("Trust".)*
8. **Ship the rebuild.** The new Tycho replaces the deployed one: the deploy; Gaia and the asteroids out of production's R2, which then holds DuckDB-Wasm's two wasm bundles alone; the zone's WAF rules and rate limit looked at again against the new build's requests, right after; and `README.md` and the root README's row as a visitor finds the app. It comes after the last goal the first release takes. (Kirkwood moved to `kirkwood.seiza.io` on 2026-11-23, so nothing of its runs on Tycho's hostname: the zone's redirect for its old path answers before Tycho's rules and Worker.) *The owner confirms every deletion in production and the deploy.* *(`docs/DECISIONS.md`, "Hosting", 2026-11-23.)*
9. **Open from a URL:** Parquet only, read by range, on a route of its own. *("Opening a file".)*
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
9. At a phone: how tall the panels' sheet opens, and whether it drags taller (the build).
10. Left by the design session for the build: what `undo` does after a command that opened a view; a kept view's size, measured against the caps' estimate; and Cmd/Ctrl+K and Ctrl+F from the table, taken on the way down as the page's other keys are (a key the canvas has focus for may never bubble up: M12 part B), checked when each is built.
11. The design canvas still draws its stand-in earthquakes, the first screen's sample row included: whether its boards are redrawn with GCAT before the build.
12. A link that holds a view: the design decided what it holds and how it opens (`docs/DECISIONS.md`, "Scope", 2026-11-20 and 2026-11-21), but no goal builds it. Which goal takes it, with the Share menu.
