# Tycho's checks (`perf/`)

The checks that stay, the one done by hand, the probes the crate publishes, and `results/`. Claude Code loads this file when a file under `perf/` is read. Tycho's rules and the map of its folders are in `apps/tycho/CLAUDE.md`, the repo's in the root `CLAUDE.md`; both apply here. Paths are relative to `apps/tycho/`.

Tycho's measurements are retired (`docs/DECISIONS.md`, "Perf tooling and budgets", 2026-11-17 and 2026-11-23): nothing here times the app, and a check that drove the old page or read a retired sample is gone, to be written again by the goal that rebuilds what it tested. Their fixtures stay (`data/CLAUDE.md`), and so does `results/`: version 1's measurements, history, never edited.

## What stays

- **The wasm's size,** gated by `just tycho check` (`perf/size.ts`): the app wasm, brotli at quality 11, at most 15% over `baseline.json`'s `wasmBrotliKiB` unless a `budget-notes.md` row dated on or after the baseline accepts the new size. The limit is in `budgets.json`; change it there, never in the script. `budgets.json` lists no metrics, so `report` skips Tycho.
- **The page's weight before first paint,** printed by `just tycho build` (`shared-web/scripts/asset-sizes.ts`'s `--first-paint` row: the document, the entry JS, the app wasm, the UI font). Reported, not gated. A file renamed out of that set fails the build until the justfile's parts name it again.
- **The home-path check,** in `check`, and its control, `just tycho home-paths` (`.claude/rules/toolchain.md`, "Release profile").
- **The smoke check** (`just tycho smoke`): in Chromium, Firefox, and WebKit, a first frame appears (its time printed, stored nowhere), the page is cross-origin isolated, no console errors, and the canvas follows each resize. On a release build, Chromium also holds Tycho to rule 2: no request outside the first-paint set starts before `gpui:first-frame` (`--control` must fail it). Against the dev server by default, where that part is skipped; pass the preview's URL (`just tycho preview`) for the release build. Run it on the release build after a change to what loads when.
- **Memory at a 1 GB drop, by hand,** when a change could make the engine copy a dropped file: build the files (`just tycho drop-files x3.parquet x27.parquet`: ~100 MB and ~1 GB), open the release build (`just tycho preview`) in Chrome with `?perf`, drop each in a fresh tab, press End and Home, and read the panel's Memory row and Chrome's task manager (the tab and DuckDB's worker). The 1 GB file's peak stays within a few MiB of the 100 MB file's; a copy of the file would show as its size. Version 1's numbers: `results/2026-09-27-m5.md`.

## The probes

The crate publishes these and no script reads them; the checks the rebuild writes start from this list, and a change to one in `crate/` changes it.

`?bench` exposes the bridge as `globalThis.__tychoBridge` and the app's `WebAssembly.Memory` as `globalThis.__tychoWasmMemory`; `?page=`, `?prefetch=`, and `?budget_mib=` override the table's paging (`crate/src/table.rs`, `paging`). With `?perf` or `?bench`: the table publishes what it shows to `globalThis.__tychoTable` (`marked` is the row a jump landed on, 0-based; `top` and `scrollX` the scroll position; `tooltip` the shown tooltip's text), where the cells are to `globalThis.__tychoTableLayout`, and what the workbench shows (state, file, rows, notice, a CSV's `ingest`, `readBytes`, `chunks`, the jump input's `jumpText` and `jumpRefusal`, and `focused`) to `globalThis.__tychoWorkbench`. With `?cells` too, every drawn cell's exact and shown text goes to `globalThis.__tychoCells` each frame. `?selftest` runs the engine self-test once DuckDB is ready, into the panel and `globalThis.__tychoSelftest`.

Marks: `tycho:first-rows` always; with `?perf` or `?bench`, `tycho:viewport-filled` after each frame that fills the viewport, `tycho:csv-rows` on each frame showing a CSV's count grow, and `tycho:csv-done`. Canvas controls publish their bounds from `crate/src/targets.rs` (`jump-input`, `jump-refusal`, …), clicked with `shared-web/perf/`'s `clickTarget`.

## Files

```
perf/             # size.ts (the wasm's size gate), smoke.ts, budgets.json (the one budget), baseline.json, budget-notes.md, results/ (history)
```

## Commands

```
just tycho smoke [url]         # a first frame, cross-origin isolated, no console errors, resizes, in three browsers; on a release build, no request before first paint but its own (--control)
just tycho home-paths          # the home-path check's control: a build without `trim-paths` must fail it
```

`check` runs the size gate and the home-path check after its own release build; `node perf/size.ts` alone reads whatever `web/dist` holds.
