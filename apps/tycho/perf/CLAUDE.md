# Tycho's checks and measurements (`perf/`)

Every check and measurement script, the probes they read, the perf gotchas. Claude Code loads this file when a file under `perf/` is read. Tycho's rules and the map of its folders are in `apps/tycho/CLAUDE.md`, the repo's in the root `CLAUDE.md`; both apply here. Paths are relative to `apps/tycho/`.

## Perf script gotchas

The harness's helpers, headless Chromium's traps, and what every app's scripts meet (WebKit's press before hover, the placeholder's fade, `workRecorder`, the open panel's clicks and refresh, an A/B worktree's `target/`) are in `.claude/rules/perf-harness.md`, which loads with this file; these add to it. Debugging a slow or failing table, CSV, or paging check starts with the engine's DuckDB-Wasm gotchas (`crate/CLAUDE.md` points to them).

- **Canvas controls have no DOM:** Tycho publishes their bounds from `crate/src/targets.rs`; click them with `shared-web/perf/`'s `clickTarget` and `targetRect`.
- **Where the open observation panel sits in Tycho:** the window's lower right (at 1440×900, about the right 400 px from y ≈ 340 down; `perf/jump.ts` checks its targets clear of it). It keeps clear of the table's scrollbars (at 1440×900: x 1015–1399, the vertical track at x 1407), but not of the cells, nor of anything the empty state lays out wide.
- **Headless DPR 2 hides what a DPR 1 display shows.** GPUI and the browser round half-pixels in opposite directions (`.claude/rules/gpui-web.md`, "GPUI lays out in whole device pixels"); at DPR 2 that's half a CSS pixel, at DPR 1 a whole one. The placeholder's jump was invisible in every DPR 2 check and plain on a DPR 1 screen. `shared-web/perf/placeholder-shots.ts`'s `shoot` takes `{ dpr }`.
- **Budgets come from `perf/budgets.json`** (`limits('table', [...])` in `perf/harness.ts`); change a limit there, never in a script, and `just tycho report` shows it in the docs. **Label a before-run `<…>-before…`, an A/B `<…>-ab` or `<…>-ab-<detail>`, and a negative control `<…>-control…`:** the report skips those (`budgets.json`'s `exclude`), and otherwise takes the newest file holding a metric's path, so a control's numbers would become the docs' "Now".
- **Check the machine before calling a slowdown a regression.** `just tycho paging` (raw queries through the bridge, no table code) is a quick control: if it's slower by the same proportion, it's load.

## The probes

`?bench` in the URL exposes the bridge as `globalThis.__tychoBridge` for the perf scripts; `?page=`, `?prefetch=`, and `?budget_mib=` override the table's paging (`crate/src/table.rs`, `paging`). With `?perf` or `?bench`, the table publishes what it shows to `globalThis.__tychoTable` and marks `tycho:viewport-filled` after each frame that fills the viewport; `tycho:first-rows` (the overlay's "first rows") is always marked.

With `?perf` or `?bench`, what the workbench shows (state, file, rows, notice, and a CSV's `ingest` state, `readBytes`, `chunks`) is in `globalThis.__tychoWorkbench`, with the jump input's `jumpText`, `jumpRefusal` (the inline line, bounds `jump-refusal`), and `focused` (`jump`, `table`, `workbench`, or null); `__tychoTable.marked` is the row a jump landed on (0-based). Each frame showing a CSV's count grow marks `tycho:csv-rows`, and the one showing it done `tycho:csv-done`. Drop a file from a script with `perf/harness.ts`'s `dropFile()`; jump with Cmd/Ctrl+G (it focuses the input with its text selected) or a click on `jump-input`, then type and Enter.

With `?cells` too, every drawn cell's exact and shown text goes to `globalThis.__tychoCells` each frame (never in perf runs); with `?perf` or `?bench`, where the cells are is `globalThis.__tychoTableLayout` (republished only when the layout changes; the scroll position is `__tychoTable.top` and `.scrollX`) and the shown tooltip's text is `__tychoTable.tooltip`.

`?selftest` in the URL runs the engine self-test once DuckDB is ready; results show in the panel and in `globalThis.__tychoSelftest`. With `?bench`, the app's `WebAssembly.Memory` is `globalThis.__tychoWasmMemory`.

## Files

```
perf/             # Playwright scripts on shared-web/perf/ (harness.ts: Tycho's own helpers: budgets, serving with the Worker, dropFile, the table probe and its frame sample), budgets.json (every budget), baseline.json, budget-notes.md, results/
```

## Commands

What each check covers, item by item, and its flags are in its script's header comment and the justfile's comment above its recipe; read those before running or changing one. All but `smoke` (the dev server by default) run on the release build: run `just tycho build` first (`check` and `home-paths` build it themselves).

```
just tycho sample [flags]      # the sample over HTTP: click → schema, bytes read, an early click, failures
just tycho table [flags]       # the table: first rows, jump to 90%, last row, fling and steady scroll (--sample, --memory, --browsers, --sweep, --url)
just tycho panel [flags]       # every observation-panel value against an independent measurement, and the fling with it open and closed
just tycho cells [flags]       # no value spills out of its cell; rounded values and their tooltips (--files)
just tycho jump [flags]        # jump to row on both samples, and the input's edges: IME, paste, editing keys, focus (--browsers, --url)
just tycho errors [flags]      # the error states: the engine, the network, files over the limits (--only)
just tycho drop [flags]        # dropping a ~1 GB Parquet, memory, unsupported files, a drop superseding a load (--only)
just tycho csv [flags]         # dropping a ~1 GB CSV, the fixture's tricky rows, supersede, formats (--only, --url)
just tycho placeholder [flags] # the placeholder shell against GPUI's first frame, and the theme toggle (--controls, --ab <dist>)
just tycho engine [flags]      # the engine self-test (`?selftest`) in three browsers, and blocked-engine controls
just tycho smoke [url]         # paints, cross-origin isolated, no console errors, resize, in three browsers
just tycho home-paths          # the home-path check's control: a build without `trim-paths` must fail it
just tycho perf [flags]        # the full suite (~1 h 45 min): cold, panel, table, jump, the ~1 GB CSV → one results file (--only, --url); needs `just tycho drop-files csv`
just tycho cold [flags]        # cold load only, and no engine request before first paint (--url, --vs-local, --write-baseline)
just tycho burst [flags]       # the most requests one visitor sends in any 10 s, for the WAF rate limit
just tycho hardening [flags]   # experiments: footers piling up, the size ceiling, wheel at the end (--only); needs the drop files
just tycho ingest [flags]      # experiment: CSV ingest approaches, by chunk size and compression
just tycho paging [flags]      # experiment: paging strategies by row-group size; needs the bench/ files in local R2
```

`perf`, `cold`, and `check` serve `web/dist` through `vite preview`, brotli-compressed like production.
