# Tycho

> *Tycho Brahe catalogued a thousand stars in a lifetime. Tycho scrolls 25 million before your coffee cools.*

**Tycho** is a local-first data workbench in the browser. Drop a CSV or Parquet file, or click a sample, and scroll through every row instantly. The data is queried locally with DuckDB-Wasm and drawn by GPUI (via GPUI Kit) on a canvas with WebGPU, or WebGL2 where WebGPU isn't available. Nothing is uploaded.

The project's goal is to show that **WebAssembly + GPU-rendered UI builds heavy web apps better than the DOM**. Every claim needs a number on screen to back it up. Tycho is a utility app (root `CLAUDE.md`, "Tiers"): a tool people use, which grows features as it needs them. Its DuckDB layer is the repo's first engine, `engines/duckdb/`, and its table the first component, `components/tall-table/`.

---

This is Tycho's context. What's next is in `PLAN.md`; why things are built this way, in `docs/DECISIONS.md`; the samples and the Cloudflare setup, in `docs/data.md` and `docs/hosting.md`; finished milestones, in `docs/milestones.md`; budgets, in `perf/budgets.json` (the root `CLAUDE.md`, "Docs: one home per fact", says what goes where). The repo-wide rules in the root `CLAUDE.md` (TTFP first, paint before heavy loads, measurement protocol, canvas tradeoffs, `shared/` conventions) apply here too, and so do `.claude/rules/` (the GPUI Kit gotchas, the perf harness, Cloudflare). Paths below are relative to `apps/tycho/` unless they start with `shared/` or `shared-web/`.

---

## Tycho rules

These add to the repo-wide rules.

1. **Never block the shell on DuckDB.** Paint first. Start loading the engine from `shared/`'s post-paint callback. The UI must stay usable (and say "engine loading…") until DuckDB is ready.
2. **Keep the bridge narrow.** Three calls cross the Rust ↔ JS boundary (`registerFile`, `query`, `cancel`): the engine's rule, `engines/duckdb/CLAUDE.md`, rule 2. Get schema, row count, and metadata with SQL through `query`.
3. **Query per viewport.** The table fetches only the visible rows plus a buffer. The app never loads the whole result into memory.
4. **Scope grows through `PLAN.md`.** What Tycho builds next is what `PLAN.md` holds: the table's features as each is ready ("Waiting on"), then its long-term goals. Anything it doesn't hold (a SQL editor, GROUP BY, …) goes into `PLAN.md` as a goal first. If one seems necessary mid-milestone, stop and ask.

## Where the detail is

Each folder's architecture, gotchas, and commands are in its own `CLAUDE.md`, which Claude Code loads when a file in that folder is read. Read the folder's file before changing anything in it, and put a new fact in the file of the folder it's about: a fact stated in two of them drifts.

| Folder | What it is | Its file |
|---|---|---|
| `crate/` | The app: title bar, workbench, the table's source, the engine's events, files, CSV, jump to row, errors and limits | `crate/CLAUDE.md` |
| `web/` | The Vite host: the bridge, the engine's plugin, the `/data/*` proxy, the placeholder shell | `web/CLAUDE.md` |
| `worker/` | Hosting: the Worker, R2, the deploy, the pause switch | `worker/CLAUDE.md` |
| `data/` | The samples' fetch and prep, the test files | `data/CLAUDE.md` |
| `perf/` | Every check and measurement script, the probes they read, the perf gotchas | `perf/CLAUDE.md` |

A new folder whose detail only its own work needs gets its own `CLAUDE.md` and a row here.

## When something outside a folder changes it

Rules whose cause is elsewhere, so no folder's file would be read in time:

- **A change to a probe in `crate/`** (a `globalThis.__tycho*` value, a `tycho:*` mark, a `?bench`/`?perf`/`?cells` behavior) changes what `perf/`'s scripts read: the probes are listed in `perf/CLAUDE.md`, "The probes". So does a target id in `crate/src/targets.rs` (`jump-input`, `jump-refusal`, …), which the scripts click by name.

## Layout

```
apps/tycho/
  crate/            # Rust, package `tycho` (crate/CLAUDE.md)
  web/              # the Vite host (web/CLAUDE.md)
  worker/           # the Cloudflare Worker (worker/CLAUDE.md)
  data/             # the samples' prep, the test files, MANIFEST.json (data/CLAUDE.md)
  perf/             # checks and measurements, budgets.json, baseline.json, results/ (perf/CLAUDE.md)
  docs/             # DECISIONS.md (by area), LESSONS.md (surprises, per milestone), milestones.md (finished specs), data.md, hosting.md; private/ is gitignored
  README.md         # for visitors: numbers, canvas tradeoffs, file size limits, how to run it
  CLAUDE.md         # this file: context and rules
  PLAN.md           # what's next: status, the active milestone, long-term goals, open questions
  justfile          # loaded from the root as the `tycho` module
```

## Commands

One line each; each recipe's line is in its folder's `CLAUDE.md` (in brackets), what it covers and its flags in its script's header and the justfile.

```
just tycho data | data gaia | data-deps | drop-files   # the samples into local R2, data/'s native DuckDB, the test files (data)
just tycho extensions                                   # the DuckDB extensions the engine pins, into web/public/duckdb-ext/ (web)
just tycho worker-check | deploy | pause | resume       # the Worker's byte-range checks, the deploy, production's pause switch (worker)
just tycho sample | table | panel | cells | jump | errors | drop | csv | placeholder | engine | smoke | home-paths [flags] # checks (perf)
just tycho perf | cold | burst | hardening | ingest | paging [flags]   # measurements and experiments (perf); `perf` is the ~1 h 45 min suite (needs `just tycho drop-files csv`); run `just tycho build` before `perf` or `cold`
```

```
just setup              # npm install for every app host (run once)
just tycho dev          # build wasm (debug) + Vite dev server with COOP/COEP (http://localhost:5173), with `wrangler dev` behind /data/*
just tycho build        # release wasm (+ wasm-opt), Vite build, report asset sizes
just tycho preview      # serve the release build (web/dist) with the same headers, with `wrangler dev` behind /data/*
just tycho wasm [debug|release]   # cargo build + wasm-bindgen into web/pkg/ (+ wasm-opt for release)
just tycho check        # lint + release build + no home-directory path in the shipped wasm + perf budgets (reference TTFP ≤ baseline +10%, wasm brotli ≤ +15% unless noted in perf/budget-notes.md)
just tycho lint         # cargo fmt --check, clippy on wasm32 and native with -D warnings, tsc, `report --check` (fails while the docs' generated numbers are stale), and `check-terms` (fails on a milestone ID outside the history files)
just tycho report [--check] # regenerate the numbers in README.md, PLAN.md, and the root README from perf/budgets.json and the newest perf/results/ files
```

`dev`, `preview`, `sample`, `table`, and `worker-check` need the local R2 `just tycho data` fills.

The perf panel ("Observation panel": load waterfall, frame interval and work per frame, memory, bytes read, rows/s, cache hits, pages) is on with `?perf` in the URL; toggle it with the title bar's button or Cmd/Ctrl+Shift+P. (Firefox on macOS keeps Cmd+Shift+P for a private window; use Ctrl+Shift+P or `?perf` there.)

`web/pkg/` is generated by `just tycho wasm` (gitignored). After changing Rust, rerun `just tycho dev` (or `just tycho wasm` while Vite keeps running) and reload the page.
