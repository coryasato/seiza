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
| — | Design sync: the design canvas brought to the build, through M14 | Next, before "Sort, filter, and find" opens. The boards stay the spec for the whole app. A departure the build made on purpose (`docs/DECISIONS.md`, "Scope", 2026-11-21 on) is redrawn from `web/src` and the crate as built; what isn't built yet, or is built as a stand-in a later item replaces, keeps its markup and data, noted with the item that builds it. Answers "The canvas's stand-in data" |
| Later | The roadmap below, in order | Each item becomes a milestone when it's opened |

**Closing a milestone:** every "done when" check passes; new decisions are in `docs/DECISIONS.md`; a `docs/LESSONS.md` entry is written; and the milestone's spec and evidence move from here to the end of `docs/milestones.md`, leaving one row above. Tycho records no measurements (root `docs/DECISIONS.md`, "Measurement protocol", 2026-11-17); what it still checks is in M11.

**Waiting on** (features of a component or engine Tycho needs; only that crate's `PLAN.md` builds them, the session that closes one flips its row to *Ready*, and a row leaves when the milestone that adopts it closes):

| Needs | For | Status |
|---|---|---|
| The tall table's `replace_rows`, then column filtering and global filtering ([its PLAN](../../components/tall-table/PLAN.md)) | "Sort, filter, and find", below | *Ready* (2026-11-18, tall-table M18) |
| The tall table's find | Search that keeps every row ("Sort, filter, and find") | *Ready* (2026-11-19, tall-table M20) |
| The tall table's column summaries in the header | The column profile's strip, drawn by the table from numbers Tycho gives it. Asked for only once the panel's profile proves fast enough ("Profiles and the catalog", below) | *Not ready*, and not yet asked |
| The tall table's sort by several columns | The sort's editor as a list; after the first release | *Not ready* |
| The tall table's row marks | The investigator's bookmarks and tags ([`docs/personas.md`](docs/personas.md)); no roadmap item holds them yet | *Not ready* |

---

## Roadmap

Each item becomes a milestone when it's opened. Each links to its section of [the research](../../docs/research/tycho-workbench.md), which holds the reasoning and what's marked decided, proposed, or open; a proposed part is checked and reviewed when its item is opened, before it's built.

### The first release

Built locally; production stays as deployed until its last item. The order is decided in `docs/DECISIONS.md`, "Scope", 2026-11-25.

1. **Sort, filter, and find,** with filter by a cell. Not thin: the DuckDB source's order, its `WHERE`, and its find are unbuilt engine work; the table's parts, `replace_rows` for filtering and `find`, are ready ("Waiting on"). *("The controller".)*
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
- **The canvas's stand-in data.** The design canvas still draws its stand-in earthquakes, the first screen's sample row included: whether its boards are redrawn with GCAT (the design sync).
