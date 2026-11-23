# PLAN.md — Tycho

What's next for Tycho: milestone status, the next milestone's "done when" checks, the goals after it in order, and open questions. Only what's still open lives here. Context and rules are in `CLAUDE.md` here and at the repo root.

**Goal:** a data workbench for files too big for a spreadsheet, running entirely in the browser: open a file, understand it, check what you need, and export the part you want. The data never leaves the visitor's machine. Tycho is a utility app (root `CLAUDE.md`, "Tiers"): a public tool, built around a *controller* that sits between DuckDB-Wasm and the tall table, holds one *view state*, and can be driven by a person or by an outside LLM. Tycho hosts no model and takes no API key.

**The test for every feature:** does it help someone with a large file and a question? The first release is built for the quick checker ([`docs/personas.md`](docs/personas.md)).

**Tycho is being rebuilt.** This plan was rewritten on 2026-11-17 and replaces the old one whole: its carried-over perf reruns, its production-performance goal, and its open questions are not carried over. Until the reset (M11) lands, `CLAUDE.md`, `README.md`, and the docs beside them still describe the app as built, measurements included.

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
| M11 | Reset: the old Tycho retired, the ground cleared | Active: opened 2026-11-23, in three parts (below) |
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

## Active milestone: M11, the reset

Opened 2026-11-23 and planned in three parts, one session each. A Kirkwood session runs between parts A and B.

**What it is:** Tycho stops being a measured demo of a scrolling table. Its measurements go, the Gaia and asteroid samples go, the new sample arrives, and the docs follow the app as it changes. Nothing of the new app is built here: the crate as built stays as the ground the goals below replace, piece by piece.

**It is local.** Production stays as deployed until the rebuild ships (`docs/DECISIONS.md`, "Hosting", 2026-11-23): no deploy, and nothing deleted from production's R2, in this milestone. Both are "Ship the rebuild", below. The tag `tycho-v1` is the last commit that builds the deployed app.

### Part A: the measurements retired

Touches no data.

- [ ] **A1. The measurements are retired:** the perf suite and its scripts, every budget but the wasm's size, the time-to-first-paint gate in `check`, `just tycho report` (and its step in `lint`), and the generated numbers in `README.md`, this file ("Measurements", below), and the root README's table, with a plain sentence in their place. `perf/results/` stays as history.
- [ ] **A2. The checks are sorted, and what stays still runs.** Staying: the wasm's size (brotli) gated in `just tycho check`; the page's weight before first paint reported by `just tycho build`, ungated; the home-path check; a first frame appearing, pass or fail, in the smoke check (*proposed:* it prints the time, stored nowhere); memory when a 1 GB file is dropped, run by hand. A check that times something, drives the old page's targets, or reads a retired sample goes with the measurements, and is written again by the goal that rebuilds what it tested; its fixtures (the tricky CSV rows, the error cases' files) stay for that.
- [ ] **A3. The root says what was decided:** Tycho's exemption from rules 1 and 3 and the measurement protocol, and the reworded claim (the canvas for the GPUI components, the heavy parts; the DOM where text lives), in the root `CLAUDE.md` and README. The README's Tycho row loses its numbers.
- [ ] **A4. `README.md` says a rebuild is under way:** a short note at its top (version 2 is being built; what's below describes version 1 until its section is replaced), and what this part made false is cut, not marked. Each later goal rewrites its own section.
- [ ] **A5. `CLAUDE.md` and `perf/CLAUDE.md` follow:** their commands, probes, and rules are what part A left.
- [ ] **A6. `just tycho lint` passes,** its TypeScript step included (it fails today on `shared-web/perf/protocol.ts`: `Cannot find name 'ResizeObserverEntry'`), and so does `just tycho check`.

### Between A and B: Kirkwood takes the Gaia fetch

A Kirkwood session, in [its PLAN](../kirkwood/PLAN.md) ("Open questions"): the Gaia fetch, prep, and manifest entry move to `apps/kirkwood/data/`. Part B deletes them here, so it doesn't start until that session has run.

### Part B: the old samples out

- [ ] **B1. The asteroids are the observatory's:** the asteroid fetch, prep, and manifest entry move to `apps/observatory/data/`, where `prep.ts` reads its own folder. `just observatory data` passes and the file it builds has the hash it had, so the comparison's data is unchanged. The observatory's `data/CLAUDE.md` follows.
- [ ] **B2. Gaia and the asteroids are out of Tycho:** their buttons, the code only they used, their scripts and manifest entries in `data/`, and their `just tycho data` recipes. The test files stay.
- [ ] **B3. Locally, the bucket holds DuckDB-Wasm's two wasm bundles and nothing else** (`docs/DECISIONS.md`, "Hosting", 2026-11-21): the Worker's data path, the deploy's upload, and the local R2 that `just tycho data` fills are cut down to what the bundles need. Not deployed.
- [ ] **B4. The folders' `CLAUDE.md` files follow** (`data/`, `worker/`, `web/`, `crate/`), and `just tycho check` and the smoke check pass.

### Part C: the new sample, and the close

- [ ] **C1. `gcat.parquet` is built and served whole as a static asset,** under 25 MiB, read from memory, and the app's sample button opens it. Its columns and its build's spec, which the owner reviews before it's written: [the sample's research](../../docs/research/tycho-sample.md), "The table" and "The build". Decided here: how the file reaches the build (committed, or built by `just tycho data`), since today's Parquet files are gitignored.
- [ ] **C2. The docs describe Tycho as it stands:** `CLAUDE.md` and each folder's, `docs/data.md`, `docs/hosting.md` (which says what production still holds until the rebuild ships), and the README's sections this milestone made false. Tycho's rules are revisited with them: "keep the bridge narrow" against export and URL opening, and "scope grows through `PLAN.md`".
- [ ] **C3. `just tycho check` passes on the final build,** and the milestone closes.

**Left out, on purpose:** the burst script's last run (it measured the old app's requests against the zone's rate limit, and needs Gaia; the rate limit is looked at again on the new build, in "Ship the rebuild").

---

## Goals, in order

Not milestones yet. Each links to its section of [the research](../../docs/research/tycho-workbench.md), which holds the reasoning and what's marked decided, proposed, or open; a proposed item is checked and reviewed when its goal is opened, before it's built. **The first release is everything through "Export", the connection policy if it's taken, and then "Ship the rebuild".** It is built locally: production stays as deployed until it ships.

1. **The controller, thin, and the engine's lockdown.** One serializable view state behind every driver; first the parts that need nothing new from the engine (source, columns, their order, widths, pins, formats). The lockdown is repeated in a browser first, with what Tycho sends lazily today moved ahead of the lock. *("The controller"; "Security", layer 2.)*
2. **The command bar and the log, minimal,** in the DOM, so every later goal has somewhere to show its commands and answers. Their form: `docs/DECISIONS.md`, "Scope", 2026-11-20. *("The thread".)*
3. **Table basics:** the tall table's built features that need nothing from the engine, each adopted through the controller, and the row detail view, in the DOM, opened from the table's cell popover. *("The table's own tools".)*
4. **Sort, filter, and find,** with filter by a cell. Not thin: the DuckDB source's order, its `WHERE`, and its find are unbuilt engine work; the table's parts, `replace_rows` for filtering and `find`, are ready ("Waiting on"). *("The controller".)*
5. **Profiles and the catalog,** grouping included, whose result is a new view. The profile comes in three stages, in the columns panel first. If it's too slow in use, a session of its own makes the sample faster before anything is cut; the header strip is asked of the tall table only after the panel's proves itself. *("The catalog"; "The column profile's cost", which holds the timings and that session's starting points.)*
6. **Export,** and the view copied as SQL. Its size plan is a cap (`docs/DECISIONS.md`, "Scope", 2026-11-21); the cap is measured and the storage route tested first (question 5). *("The table's own tools".)*
7. **The connection policy.** *Proposed* as part of the first release, since the input is drivable from the day it ships. *("Trust".)*
8. **Ship the rebuild.** The new Tycho replaces the deployed one: the deploy; Gaia and the asteroids out of production's R2, which then holds DuckDB-Wasm's two wasm bundles alone; the zone's WAF rules and rate limit looked at again against the new build's requests, right after; and `README.md` and the root README's row as a visitor finds the app. It comes after the last goal the first release takes, and after Kirkwood has moved to a subdomain of its own ([its PLAN](../kirkwood/PLAN.md)), since the two share a hostname and a pause switch until then. *The owner confirms every deletion in production and the deploy.* *(`docs/DECISIONS.md`, "Hosting", 2026-11-23.)*
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
3. The connection policy: what DuckDB-Wasm needs it to allow, how the URL route loosens it, and where anything saved in the browser is stored, kept views first. Kirkwood shares the origin only until it moves to a subdomain of its own, which is before the rebuild ships.
4. The lockdown in a browser: a dropped file's handle, a remote file, an export, and the engine unlocked until `LOAD parquet` succeeds.
5. Export: the cap's size, measured; whether a file can be written to the browser's own storage and saved from there, with the engine locked down, which would lift the cap (tested before export is built).
6. JSONL's size limit, if it loads into memory as a CSV does, and what the engine's reader does with nested values today.
7. Whether the URL route takes dropped files.
8. Where WebMCP and on-device models stand.
9. At a phone: how tall the panels' sheet opens, and whether it drags taller (the build).
10. The DOM's framework. The lean is React with shadcn's components on Base UI, copied into Tycho with its own tokens (nothing imported from `site/ui/`); `docs/DECISIONS.md`, "Scope", 2026-11-17, says it's measured before it's chosen.
11. Left by the design session for the build: that a key pressed while the canvas has focus reaches the page's own listener (Cmd/Ctrl+K and Ctrl+F from the table depend on it); what `undo` does after a command that opened a view; and a kept view's size, measured against the caps' estimate.
12. The design canvas still draws its stand-in earthquakes, the first screen's sample row included: whether its boards are redrawn with GCAT before the build.

---

## Measurements

Generated by `just tycho report` from [`perf/budgets.json`](perf/budgets.json) and the newest matching file in `perf/results/`; don't edit between the markers. A metric's history is its dated results files.

<!-- report:plan:start -->
| Metric | Budget | Gate | Local | Production | From |
|---|---|---|---|---|---|
| Time to first paint | ≤ 214.8 ms (baseline 195.3 + 10%) | `check` | 187.5 ms | 327.2 ms | [2026-10-13-m9-suite](perf/results/2026-10-13-m9-suite.json), [2026-10-10-m8-prod](perf/results/2026-10-10-m8-prod.json) |
| Time to first paint, throttled | — | recorded | 3727.2 ms | 3778.5 ms | [2026-10-13-m9-suite](perf/results/2026-10-13-m9-suite.json), [2026-10-10-m8-prod](perf/results/2026-10-10-m8-prod.json) |
| App wasm (brotli) | ≤ 3283 KiB (baseline 2854.8 + 15%, or a `budget-notes.md` row) | `check` | 2840.2 KiB | — | [2026-10-13-m9-suite](perf/results/2026-10-13-m9-suite.json) |
| Static shell painted, reference / throttled | — | recorded | 33.4 / 254 ms | 106.1 / 294.9 ms | [2026-10-13-m9-suite](perf/results/2026-10-13-m9-suite.json), [2026-10-10-m8-prod](perf/results/2026-10-10-m8-prod.json) |
| DuckDB engine ready (after first paint) | — | recorded | 626 ms | 985.1 ms | [2026-10-13-m9-suite](perf/results/2026-10-13-m9-suite.json), [2026-10-10-m8-prod](perf/results/2026-10-10-m8-prod.json) |
| Sample click → schema (asteroids) | ≤ 300 ms | `sample` | 108 ms | — | [2026-10-13-m9-c-sample](perf/results/2026-10-13-m9-c-sample.json) |
| Sample click → first rows: asteroids / Gaia | ≤ 500 ms | `perf` suite | 198.8 / 289.4 ms | 506.8 / 810.8 ms | [2026-10-13-m9-suite](perf/results/2026-10-13-m9-suite.json), [2026-10-11-m8-prod-table](perf/results/2026-10-11-m8-prod-table.json) |
| Scrollbar jump to 90% → real rows: asteroids / Gaia | ≤ 400 ms | `perf` suite | 81.7 / 134.9 ms | 200.9 / 362.8 ms | [2026-10-13-m9-suite](perf/results/2026-10-13-m9-suite.json), [2026-10-11-m8-prod-table](perf/results/2026-10-11-m8-prod-table.json) |
| Fling top → bottom in 3 s, asteroids: p95 / worst frame | ≤ 20 / 50 ms | `perf` suite | 16.7 / 33.3 ms | 16.7 / 16.7 ms | [2026-10-13-m9-suite](perf/results/2026-10-13-m9-suite.json), [2026-10-11-m8-prod-table](perf/results/2026-10-11-m8-prod-table.json) |
| Fling top → bottom in 3 s, Gaia: p95 / worst frame | ≤ 20 / 50 ms | `perf` suite | 16.7 / 33.3 ms | 16.7 / 16.7 ms | [2026-10-13-m9-suite](perf/results/2026-10-13-m9-suite.json), [2026-10-11-m8-prod-table](perf/results/2026-10-11-m8-prod-table.json) |
| Work per frame, fling p50 / p95 (asteroids) | — | recorded | 5.8 / 7.6 ms | — | [2026-10-13-m9-suite](perf/results/2026-10-13-m9-suite.json) |
| Work per frame, steady scroll p50 / p95 (asteroids) | — | recorded | 12.6 / 15.8 ms | — | [2026-10-13-m9-suite](perf/results/2026-10-13-m9-suite.json) |
| Jump to row, Enter → rows (middle): asteroids / Gaia | lands on the row | `perf` suite | 77.4 / 131.4 ms | 199.5 / 397.4 ms | [2026-10-13-m9-suite](perf/results/2026-10-13-m9-suite.json), [2026-10-10-m8-prod](perf/results/2026-10-10-m8-prod.json) |
| Drop a 1 GB Parquet → first rows | ≤ 1000 ms | `drop` | 796 ms | — | [2026-09-27-m5-drop](perf/results/2026-09-27-m5-drop.json) |
| Drop a 1 GB CSV → first rows | ≤ 1000 ms | `perf` suite | 185.6 ms | 199.7 ms | [2026-10-13-m9-suite](perf/results/2026-10-13-m9-suite.json), [2026-10-10-m8-prod](perf/results/2026-10-10-m8-prod.json) |
| CSV row count, longest gap between updates | ≤ 500 ms | `perf` suite | 219.5 ms | — | [2026-10-13-m9-suite](perf/results/2026-10-13-m9-suite.json) |
| Fling while a CSV loads: p95 / worst frame | ≤ 20 / 50 ms | `perf` suite | 16.7 / 33.3 ms | — | [2026-10-13-m9-suite](perf/results/2026-10-13-m9-suite.json) |
| CSV load throughput (1 GB) | — | recorded | 70.2 MB/s | — | [2026-10-13-m9-suite](perf/results/2026-10-13-m9-suite.json) |
| App memory after scrolling every row twice: asteroids / Gaia | ≤ 128 MiB | `table --memory` | 91.2 / 70.8 MiB | — | [2026-09-27-m5-table](perf/results/2026-09-27-m5-table.json), [2026-10-07-m7-table-gaia](perf/results/2026-10-07-m7-table-gaia.json) |
| Observation panel vs independent measurements: reference / throttled | all within 5% | `perf` suite | 170/170 / 170/170 | — | [2026-10-13-m9-suite](perf/results/2026-10-13-m9-suite.json) |
<!-- report:plan:end -->
