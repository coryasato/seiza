# Tycho

> *Tycho Brahe catalogued a thousand stars in a lifetime. Tycho scrolls 25 million before your coffee cools.*

**Tycho** is a local-first data workbench in the browser. Drop a CSV or Parquet file and scroll through every row instantly. The data is queried locally with DuckDB-Wasm, locked down to the files Tycho registers, and the table is drawn by GPUI (via GPUI Kit) on a canvas with WebGPU, or WebGL2 where WebGPU isn't available; the page's frame around it is HTML. Nothing is uploaded.

The project's claim, as Tycho takes it: the canvas for the GPUI components, the heavy parts; the DOM where text lives (root `CLAUDE.md`). Tycho is a utility app (root `CLAUDE.md`, "Tiers"): a tool people use, which grows features as it needs them. Its DuckDB layer is the repo's first engine, `engines/duckdb/`, and its table the first component, `components/tall-table/`.

---

**Tycho is being rebuilt** as a public data workbench (`PLAN.md`; the research, `docs/research/tycho-workbench.md` at the repo root; who it's for, `docs/personas.md`). The reset is done: this file and each folder's describe the app as it stands, the ground the plan's roadmap replaces piece by piece. Follow `PLAN.md` where the two differ.

This is Tycho's context. What's next is in `PLAN.md`; why things are built this way, in `docs/DECISIONS.md`; the sample and the Cloudflare setup, in `docs/data.md` and `docs/hosting.md`; finished milestones, in `docs/milestones.md`; the one budget, the wasm's size, in `perf/budgets.json` (the root `CLAUDE.md`, "Docs: one home per fact", says what goes where). The repo-wide rules in the root `CLAUDE.md` apply here too, but for rules 1 and 3 and the measurement protocol: Tycho is exempt from them, records no measurement, and its `check` times nothing (root `docs/DECISIONS.md`, "Measurement protocol", 2026-11-17). Paint before heavy loads (rule 2), the canvas tradeoffs (rule 4), and `shared/`'s conventions bind it, and so do `.claude/rules/` (the GPUI Kit gotchas, the perf harness, Cloudflare). Paths below are relative to `apps/tycho/` unless they start with `shared/` or `shared-web/`.

---

## Tycho rules

These add to the repo-wide rules.

1. **Never block the shell on DuckDB.** Paint first. Start loading the engine from `shared/`'s post-paint callback. The UI must stay usable (and say "engine loading…") until DuckDB is ready.
2. **Keep the bridge narrow.** Three calls cross the Rust ↔ JS boundary (`registerFile`, `query`, `cancel`): the engine's rule, `engines/duckdb/CLAUDE.md`, rule 2. Get schema, row count, and metadata with SQL through `query`. What comes in goes through `registerFile`: a dropped file, the sample (downloaded whole, then registered as a `File`), and a URL (it takes one already, for "Open from a URL"). Export is the first thing that needs bytes to come *out* of DuckDB: if it needs a fourth call, export changes the engine's rule, in the engine's files, before it's built.
3. **Query per viewport.** The table fetches only the visible rows plus a buffer. The app never loads the whole result into memory.
4. **Scope grows through `PLAN.md`.** What Tycho builds next is what `PLAN.md` holds: its roadmap in order, each item opened as a milestone, and the table's features as each is ready ("Waiting on"). Anything it doesn't hold goes into `PLAN.md`'s roadmap first, and a part marked *proposed* in the research is reviewed when its item opens. If one seems necessary mid-milestone, stop and ask.

## Where the detail is

Each folder's architecture, gotchas, and commands are in its own `CLAUDE.md`, which Claude Code loads when a file in that folder is read. Read the folder's file before changing anything in it, and put a new fact in the file of the folder it's about: a fact stated in two of them drifts.

| Folder | What it is | Its file |
|---|---|---|
| `crate/` | The app: the workbench, the controller and its view state (filters and sort), find, the command bar's grammar and the log, the frame's state and the page's calls, the theme, the table's source, the engine's events, files, CSV, errors and limits | `crate/CLAUDE.md` |
| `web/` | The Vite host and the page's frame (React, prerendered): the top bar, the first screen, the command bar, the toolbar and its editors, find's bar, the log's panel, the status bar, the token file, the canvas's slot | `web/CLAUDE.md` |
| `worker/` | Hosting: the Worker, R2 (DuckDB's two wasm bundles), the deploy, production's pause switch | `worker/CLAUDE.md` |
| `data/` | The sample's build (GCAT), and the test files built from the observatory's asteroid sample | `data/CLAUDE.md` |
| `perf/` | The checks (the wasm's size, smoke, the lockdown, the engine end to end, the view state, the command bar and the log, the table's menus and the row view, sort, filter, and find), the 1 GB memory check by hand, the probes the crate publishes; `results/`, version 1's measurements, as history | `perf/CLAUDE.md` |

A new folder whose detail only its own work needs gets its own `CLAUDE.md` and a row here.

## When something outside a folder changes it

Rules whose cause is elsewhere, so no folder's file would be read in time:

- **A change to a probe in `crate/`** (a `globalThis.__tycho*` value, a `tycho:*` mark, a `?bench`/`?perf`/`?cells`/`?selftest` behavior) or to an id or `data-action` the checks press in `web/src/frame/` changes the list in `perf/CLAUDE.md`, "The probes", which the checks start from.
- **A change to what the frame shows** goes on both sides: `crate/src/frame.rs`'s `FrameView` and `web/src/frame/state.ts`'s `FrameState` spell the same fields, and the page's calls are `frame.rs`'s `#[wasm_bindgen]` functions and `core.ts`'s `App`.

## Layout

```
apps/tycho/
  crate/            # Rust, package `tycho` (crate/CLAUDE.md)
  web/              # the Vite host (web/CLAUDE.md)
  worker/           # the Cloudflare Worker (worker/CLAUDE.md)
  data/             # the sample's build (gcat.ts), the test files, and their MANIFEST.json (data/CLAUDE.md)
  perf/             # the wasm's size gate, the browser checks, budgets.json, baseline.json, results/ (history) (perf/CLAUDE.md)
  docs/             # DECISIONS.md (by area), LESSONS.md (surprises, per milestone), milestones.md (finished specs), data.md, hosting.md, personas.md (who Tycho is for and what each needs); private/ is gitignored
  README.md         # for visitors: the rebuild's note, canvas tradeoffs, file size limits, how to run it
  CLAUDE.md         # this file: context and rules
  PLAN.md           # what's next: status, the active milestone, the roadmap, open questions
  justfile          # loaded from the root as the `tycho` module
```

## Commands

One line each; each recipe's line is in its folder's `CLAUDE.md` (in brackets), what it covers and its flags in its script's header and the justfile.

```
just tycho data | data-deps | drop-files               # the sample, data/'s native DuckDB, the test files (data)
just tycho extensions                                   # the DuckDB extensions the engine pins, into web/public/duckdb-ext/ (web)
just tycho worker-check | deploy | pause | resume       # the Worker's checks, the deploy, production's pause switch (worker)
just tycho smoke [url] | lockdown [url] | engine [url] | view [url] | command [url] | table [url] | filter [url] | home-paths   # checks (perf)
```

```
just setup              # npm install for every app host (run once)
just tycho dev          # build wasm (debug) + Vite dev server with COOP/COEP (http://localhost:5173), the frame prerendered on each request
just tycho build        # release wasm (+ wasm-opt), Vite build, report asset sizes and the page's weight before first paint (ungated)
just tycho preview      # serve the release build (web/dist) with the same headers
just tycho wasm [debug|release]   # cargo build + wasm-bindgen into web/pkg/ (+ wasm-opt for release)
just tycho check        # lint + release build + no home-directory path in the shipped wasm + the wasm's size (brotli ≤ baseline +15% unless noted in perf/budget-notes.md)
just tycho lint         # cargo fmt --check, clippy on wasm32 and native with -D warnings, tsc, and `check-terms` (fails on a milestone ID outside the history files)
```

The perf panel ("Observation panel": load waterfall, frame interval and work per frame, memory, bytes read, rows/s, cache hits, pages) is on with `?perf` in the URL; toggle it with Cmd/Ctrl+Shift+P, anywhere on the page. (Firefox on macOS keeps Cmd+Shift+P for a private window; use Ctrl+Shift+P or `?perf` there.)

`web/pkg/` is generated by `just tycho wasm` (gitignored). After changing Rust, rerun `just tycho dev` (or `just tycho wasm` while Vite keeps running) and reload the page.
