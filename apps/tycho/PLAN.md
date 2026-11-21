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
| — | Design session: the page, the thread, the profile, where answers show | Under way since 2026-11-20, on [the design canvas](https://claude.ai/artifact/CR8skvUDrUsVxE4zXJtRmK). Settled (`docs/DECISIONS.md`, "Scope", 2026-11-20 and 2026-11-21): the frame, the command bar, grouping as a view tab, the first screen, the theme, the toolbar, find's bar, the views list and its names, keeping views, the Share menu, the column's and the cell's menus, the filter's and the sort's editors, the headers, the profile's stages, the cell popover, its cue, what Enter opens, the row detail view, export's items and its cap, and the frame at a phone. Everything planned is drawn; what the session left open is in "Open questions" |
| — | Sample session: which data, under the static-asset limit | Done 2026-11-21: GCAT, the catalog of every object launched to orbit, as one file ([the research](../../docs/research/tycho-sample.md); `docs/DECISIONS.md`, "Sample data") |
| M11 | Reset: the old Tycho retired, the ground cleared | Next |
| Later | The goals below, in order; the first release is everything through export | Each becomes a milestone when it's opened |

**Closing a milestone:** every "done when" check passes; new decisions are in `docs/DECISIONS.md`; a `docs/LESSONS.md` entry is written; and the milestone's spec and evidence move from here to the end of `docs/milestones.md`, leaving one row above. Tycho records no measurements (root `docs/DECISIONS.md`, "Measurement protocol", 2026-11-17); what it still checks is in M11.

**Waiting on** (features of a component or engine Tycho needs; only that crate's `PLAN.md` builds them, and the session that closes one flips its row to *Ready*):

| Needs | For | Status |
|---|---|---|
| The tall table's `replace_rows`, then column filtering and global filtering ([its PLAN](../../components/tall-table/PLAN.md)) | "Sort and filter", below | *Ready* (2026-11-18, tall-table M18) |
| The tall table's find | Search that keeps every row | *Ready* (2026-11-19, tall-table M20) |
| The tall table's column visibility | Hide and show columns | *Ready* (2026-11-18, tall-table M19) |
| The tall table's column summaries in the header | The column profile's strip, drawn by the table from numbers Tycho gives it. Asked for only once the panel's profile proves fast enough ("Profiles and the catalog", below) | *Not ready*, and not yet asked |
| The tall table's header icon: an icon the host gives each column, first in its header, its press reported; drawn raised under the pointer | The column's menu button (`docs/DECISIONS.md`, "Scope", 2026-11-20) | *Ready* (2026-11-21, tall-table M22): `header-icon`; its press is an event of its own, on release, with the badge's bounds for the menu |
| The tall table on touch: a tap on a header reported as one press, the sort arrow not a target of its own; a long press reported as a right-click is | The column's and the cell's menus at a phone | *Not ready* (planned: tall-table M24) |
| The tall table's sort by several columns | The sort's editor as a list; after the first release | *Not ready* |
| The tall table's cell popover (a cell's full value, with a button that reports an event) | The quick look before the row detail view, which its button opens ("Table basics", below); nested values shown in it ("JSONL") | *Ready* (2026-11-20, tall-table M21): a cell's exact text; a nested value's long form apart from its cell's text waits for the JSONL work (the table's `docs/DECISIONS.md`, "Features", 2026-11-19) |
| The tall table's popover for cut text only, its cue a fade: the popover and its cue on text that is cut and nowhere else, the cue drawn as the text washing out with a chevron past it, Enter left to the host on every other cell, the button filling the popover's width | The cell popover and the way from a cell to its row (`docs/DECISIONS.md`, "Scope", 2026-11-20) | *Not ready* (planned: tall-table M23) |
| The tall table's row marks | The investigator's bookmarks and tags ([`docs/personas.md`](docs/personas.md)); no goal holds them yet | *Not ready* |
| The tall table's built features | "Table basics", below | *Ready:* `custom-cells`, `live`, `follow`, `resize`, `select`, `copy`, `sort`, `pin`, `density`, `format`, `reorder`, `clicks`, `group-headers` (their dates: the table's `docs/milestones.md`) |

---

## Next milestone: M11, the reset

Not opened yet. The sample session is done; the design session comes first.

**What it is:** Tycho stops being a measured demo of a scrolling table. Its measurements go, the Gaia sample goes, the new sample arrives, and every doc that describes the old app is rewritten for the new one. Nothing of the new app is built here.

**Done when:**

- [ ] **The measurements are retired:** the perf suite and its scripts, every budget but the wasm's size, `just tycho report`, and the generated numbers in `README.md`, this file ("Measurements", below), and the root README's table, with a plain sentence in their place. `perf/results/` stays as history.
- [ ] **Four things are kept and still run:** the wasm's size (brotli) gated in `just tycho check`; the page's weight before first paint reported by `just tycho build`, ungated; a first frame appearing, pass or fail, in the smoke check (*proposed:* it prints the time, stored nowhere); memory when a 1 GB file is dropped, run by hand.
- [ ] **The behavior checks are sorted from the speed checks** and kept: the smoke check, the error cases, the tricky CSV rows, the home-path check.
- [ ] **The root says what was decided:** Tycho's exemption from rules 1 and 3 and the measurement protocol, and the reworded claim (the canvas for the GPUI components, the heavy parts; the DOM where text lives), in the root `CLAUDE.md` and README.
- [ ] **Gaia is out of Tycho's production R2 and its button is gone.** The Gaia fetch and prep aren't deleted here: Kirkwood's `data/stars.ts` reads the local file they build, and a Kirkwood session moves them or decides they stay ([its PLAN](../kirkwood/PLAN.md), "Open questions"). If that session hasn't run when this check is reached, stop and tell the owner. *The owner confirms the deletion in production.*
- [ ] **The asteroid file stays a build input:** the observatory's `data/prep.ts` reads `data/asteroids.parquet` and its hash in `data/MANIFEST.json`, so the asteroid fetch, prep, and manifest entry stay here or move to the observatory with that script. `just observatory` data prep still passes.
- [ ] **The new sample, `gcat.parquet`, is built and served whole as a static asset,** under 25 MiB, read from memory. Its columns and its build's spec, which is reviewed here before it's written: [the sample's research](../../docs/research/tycho-sample.md), "The table" and "The build". Decided here: how the file reaches the build (committed, or built by `just tycho data`), since today's Parquet files are gitignored.
- [ ] **The bucket holds DuckDB-Wasm's two wasm bundles and nothing else** (`docs/DECISIONS.md`, "Hosting", 2026-11-21): the samples are out of it, and the Worker's data path, the deploy's upload, and the local R2 that `just tycho data` fills are cut down to what the bundles need. *The owner confirms any deletion and the deploy.*
- [ ] **The docs describe the new Tycho:** `README.md`, `CLAUDE.md` and each folder's, `docs/data.md`, `docs/hosting.md`. Tycho's rules are revisited with them: "keep the bridge narrow" against export and URL opening, and "scope grows through `PLAN.md`".
- [ ] **`just tycho lint` passes,** its TypeScript step included (it fails today on `shared-web/perf/protocol.ts`: `Cannot find name 'ResizeObserverEntry'`).
- [ ] *Proposed:* the burst script (a visitor's requests against the zone's rate limit) run once on the new build, then retired.

---

## Goals, in order

Not milestones yet. Each links to its section of [the research](../../docs/research/tycho-workbench.md), which holds the reasoning and what's marked decided, proposed, or open; a proposed item is checked and reviewed when its goal is opened, before it's built. **The first release is everything through "Export".**

1. **The controller, thin, and the engine's lockdown.** One serializable view state behind every driver; first the parts that need nothing new from the engine (source, columns, their order, widths, pins, formats). The lockdown is repeated in a browser first, with what Tycho sends lazily today moved ahead of the lock. *("The controller"; "Security", layer 2.)*
2. **The command bar and the log, minimal,** in the DOM, so every later goal has somewhere to show its commands and answers. Their form: `docs/DECISIONS.md`, "Scope", 2026-11-20. *("The thread".)*
3. **Table basics:** the tall table's built features that need nothing from the engine, each adopted through the controller, and the row detail view, in the DOM, opened from the table's cell popover. *("The table's own tools".)*
4. **Sort, filter, and find,** with filter by a cell. Not thin: the DuckDB source's order, its `WHERE`, and its find are unbuilt engine work; the table's parts, `replace_rows` for filtering and `find`, are ready ("Waiting on"). *("The controller".)*
5. **Profiles and the catalog,** grouping included, whose result is a new view. The profile comes in three stages, in the columns panel first. If it's too slow in use, a session of its own makes the sample faster before anything is cut; the header strip is asked of the tall table only after the panel's proves itself. *("The catalog"; "The column profile's cost", which holds the timings and that session's starting points.)*
6. **Export,** and the view copied as SQL. Its size plan is a cap (`docs/DECISIONS.md`, "Scope", 2026-11-21); the cap is measured and the storage route tested first (question 11). *("The table's own tools".)*
7. **The connection policy.** *Proposed* as part of the first release, since the input is drivable from the day it ships. *("Trust".)*
8. **Open from a URL:** Parquet only, read by range, on a route of its own. *("Opening a file".)*
9. **The instructions, and the clipboard and agent routes.** *("How an LLM reaches it".)*
10. **Trust:** offline, and the panel. *("Trust".)*
11. **JSONL,** then nested values: the engine's half (how a `LIST`, `STRUCT`, or `MAP` becomes cells and short text) and their full form in the cell popover and the row detail view. *("Opening a file".)*
12. **More than one file,** and joins. *("Opening a file".)*
13. **Charts,** after a planning session of their own. *("Charts".)*
14. **Checked SQL expressions,** after an ideation session of their own. *("Later: checked SQL expressions".)*
15. **A SQL editor,** once the lockdown is proven. *("Later: a SQL editor".)*
16. **More samples,** each with a job the others don't do. GCAT's is "readable, with stories"; the next is "too big for a spreadsheet, and still instant": over a million rows, with text and categories a visitor recognizes. Its data is its own research; the asteroids, cut to fit, are the fallback. No sample goes in R2: one Tycho serves stays under the static-asset limit, and a larger one is a Parquet file on someone else's host, read by range through "Open from a URL". A second sample reopens the first screen's one sample row. *([The sample's research](../../docs/research/tycho-sample.md).)*

---

## Open questions

1. Where the sample's credit shows. Its license (CC BY 4.0) needs the credit visible to a visitor, and the first screen and the frame have no place drawn for it (the design session).
2. The command bar's grammar: the catalog's command names and each one's parts (the canvas's are drafts), and whether a pasted action waits for Enter, as drawn, or runs on paste.
3. Views: whether "Show rows" on a group should open a view of its own rather than filter the base view; the caps on kept views (the 10 latest files and 20 views a file are proposed, from estimates); and where kept views are stored, given the origin is shared with Kirkwood (the design session, with "The connection policy").
4. Ctrl+F: whether the table claims the key while it has focus, and whether a second press falls through to the browser for the DOM's text. Find's bar is settled: the toolbar's right side (the design session).
5. The profile's speed: how the engine keeps page reads ahead of a profile query, and whether a smarter sample is needed, tried before the graphic is cut (the build, then a session of its own).
6. Which part of the page owns each key (Ctrl+F, Cmd+C, Cmd+A, Escape) as focus moves between the thread's DOM and the canvas, written as one table. The tall table's README lists the keys it takes and which reach the host (the design session).
7. What an input or a link may do to the source and to export, so the grammar's boundary holds.
8. How column names, which are the file's text, go out in the copied context and the capability schema.
9. The connection policy: what DuckDB-Wasm needs it to allow, how the URL route loosens it, and what sharing an origin with Kirkwood means for it and for anything saved in the browser.
10. The lockdown in a browser: a dropped file's handle, a remote file, an export, and the engine unlocked until `LOAD parquet` succeeds.
11. Export: the cap's size, measured; whether a file can be written to the browser's own storage and saved from there, with the engine locked down, which would lift the cap (tested before export is built).
12. JSONL's size limit, if it loads into memory as a CSV does, and what the engine's reader does with nested values today.
13. Whether the URL route takes dropped files.
14. Where WebMCP and on-device models stand.
15. Whether a double-click on a cell goes straight to the row detail view, and the view's keys in question 6's table (the design session).
16. At a phone: how tall the panels' sheet opens, and whether it drags taller (the build).
17. How a link to a view finds its file again when the file was dropped: by name, by its columns, or by asking (the design session, with "The connection policy").
18. The DOM's framework. The lean is React with shadcn's components on Base UI, copied into Tycho with its own tokens (nothing imported from `site/ui/`); `docs/DECISIONS.md`, "Scope", 2026-11-17, says it's measured before it's chosen.

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
