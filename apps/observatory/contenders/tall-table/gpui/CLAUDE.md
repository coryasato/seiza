# The GPUI contender (`contenders/tall-table/gpui/`)

The bare GPUI host of the tall table. Claude Code loads this file when a file under `contenders/tall-table/gpui/` is read. The observatory's rules and the map of its folders are in `apps/observatory/CLAUDE.md`, the repo's in the root `CLAUDE.md`; both apply here. Paths are relative to `apps/observatory/`.

## What it is

`crate/` (package `tall-table-gpui`) is the bare host: `seiza-tall-table` over `seiza-duckdb`'s `tall-table` source, on `seiza` without `panel` (the workspace's `seiza` entry turns defaults off; Tycho names `features = ["panel"]`). `web/` is its Vite host (base `/observatory/contenders/tall-table/gpui/`). It publishes the contract (`docs/contender-contract.md`) from the table's events through `tall-table-bridge` (`components/tall-table/bridge/`, every host's). Why each choice: `docs/DECISIONS.md`, "GPUI contender".

## A build per level

- **A build per level, alone** (`cargo build -p tall-table-gpui`, the level's feature): the base, and `wide`, `market`, `tail`, `wall` (each feature's table and bridge features: `crate/Cargo.toml`'s comments; the list is `contenders/scenarios.ts`'s `LEVEL_FEATURES`, which `sizes` checks the build against). A level's wasm goes to `web/pkg-<level>/`, its build to `web/dist-<level>/` at `…/gpui/<level>/`; `web/vite.config.ts` takes the level as Vite's mode (`--mode wide`), which the recipes and the perf harness's `preview` pass. The base carries none of a level's code.
- **The base's own feature is `fonts`** (`seiza`'s `canvas-font-fallback`, the admin table's fonts toggle): only the base build turns it on (`contenders/level.ts`'s `gpuiCargoFeatures`, the recipes), and `sizes` checks no other level carries it.
- **How its levels keep each other's wasm byte-identical** (the rule: `contenders/CLAUDE.md`):
  - a level's code sits in files of its own, reached from shared code at one place (`contract.rs`'s `watch_level` for the wide level's `wide.rs`; `lib.rs`'s `use wall as host` for the wall);
  - the edits a level makes to `contract.rs`, `host.rs`, `market.rs`, and `scene/market.rs`, the files whose panic locations market watch's wasm carries, stay on their lines, and the wall's own code is at their ends or in its own files;
  - a dependency only one level needs is an optional one its feature turns on (the tail level's `web-sys` and `wasm-bindgen-futures`);
  - in `web/`, a level's host (`src/market.ts`, `tail.ts`, `wall.ts`, `level.ts` for the wide level; `base.ts` the base's), which `vite.config.ts` swaps in by mode, holds what only that level loads, its worker's `new Worker(new URL(…))` too, so no other build carries it.

## Rules

- **The scene's numbers come from the page's one list:** `web/src/main.ts` resolves `?scenario=` and `?stop=` against the build's level (`pickScenario`) and hands `start` the numbers from `contenders/scenarios.ts` (the stop's density and widths, the heat's domain, market watch's flash and colors, live tail's error color and widths, the wall's grid); the Rust side holds them for the table's `fn` stops and keeps no copy. The heat ramp's stops are constants in `scene.rs`, which `just observatory wide` checks against `scenarios.ts`'s `heat`. An unknown id is the error `start` shows, marked `contender:failed`.
- **Marks are set from the table's events, after the frame they describe:** `contender:filled` with `mark_after_current_task`, always (a view that lands already filled sets none, so the replay reads `replayView`); the probe key's `contender:input` is the first key the window gets after `gpui:first-frame` (`intercept_keystrokes`), marked by the host's next render.
- **The table probes every frame** (`probe_frames(true)`), measured or not: the replay's fling reads the rows and row height from them. `state.cacheBytes` is read at most every 100 ms, outside the frames.
- **A feed's batch is folded whole or refused whole,** in its message's task (`Host::feed`), and a refused batch fails the host, as does its worker failing to load or throwing. Live tail's open shows the table at 0 rows, following; then `watch` fetches the file whole and registers it (once a page), and only then starts the clock's worker, each count set in its message's task (`Host::rows_due`); the fetch, the registration, or the worker failing fails the host (`Host::fail_feed`). A replay's `open()` ends the feed or the clock (the tail's next table starts another, at 0 rows). `?ticks=` anything but a count is a failure.
- **Live tail's time is the log's text** (`tail.rs`'s `time_text`), never the engine's.
- **The fonts toggle trusts no face it didn't check:** gpui-pre-wgpu's `add_fonts` skips bytes it can't parse without an error, so `web/src/fonts.ts` checks each face against its pin before `addFonts` (a fetch or a pin failing marks `contender:fonts-failed`); the faces are fetched at the first `contender:filled`, and `contender:fonts` is set from the host's next render, right after the frame drawn with them.
- **The wide sheet's copy keys:** a second Cmd+C (Ctrl+C) on a selection the key declined copies it anyway, in the key's task; a selection change in between declines again. No chord: Cmd+Shift+C is the browsers' Inspect Element. A copy the clipboard can't write is canceled, and the writer is told when the host closes the table. A touch drag on a band resizes nothing; a tap selects.
- **What's published only for a measurement:** with `?measure`, the probe key, the copy's marks and globals, the feed's and clock's batches, and the levels' refreshed and tail marks; with `?cells`, the cell probe (`docs/contender-contract.md`, "The cell probe") and, on the wide and wall levels, the layout (published at each layout change, never each frame); with `?readout`, the readout's ring and the page's copy line or follow toggle.

## Where each piece is

```
crate/src/lib.rs        the wasm entry; `use wall as host` on the wall level
crate/src/host.rs       the bare host: opens the file once the engine is ready, the status line until then
crate/src/contract.rs   the contract from the table's events (marks, targets, state, probes, the replay's exports)
crate/src/scene.rs      the scenario the page asked for; scene/market.rs, scene/tail.rs, scene/wall.rs: each level's
                        numbers, the file checked at the open, its columns as the canvas writes them, and its source
crate/src/wide.rs       the wide sheet's tools: resize, select, copy (the bridge's clipboard), the copy line
crate/src/market.rs     the feed's store (Quotes); feed.rs: its worker and the fold; readout.rs: the readout's ring
crate/src/tail.rs       the replay's page SQL and time text; clock.rs: its clock
crate/src/wall.rs       the wall's host: N tables over one store, the grid, the marks across the tables
crate/src/fonts.rs      the fonts toggle (feature `fonts`): scriptFonts, addFonts
crate/examples/theme_css.rs  writes the TanStack contender's theme.css from gpui-kit's (`just observatory theme-css`)
web/src/main.ts         the bridge, first-pixels and usable, the theme, the replay hooks
web/src/base.ts, fonts.ts, level.ts, market.ts, tail.ts, wall.ts   each level's host (vite.config.ts swaps them by mode)
web/vite.config.ts      the level's mode, the placeholder (`.sz-frame`), the preloads (the wasm, the font at /fonts/)
```

Native tests: `cargo test -p tall-table-gpui` with the level's feature (`--features market market::`, `--features wall scene::wall::`); `just observatory fixtures` runs them with the rest.

## Commands

Its checks (`cold`, `placeholder`, `sizes`, `gpui-parts`, `cell-fixture`, and each level's) are in `perf/CLAUDE.md`.

```
just observatory gpui-dev [level]     # the GPUI contender: debug wasm + Vite dev server at /observatory/contenders/tall-table/gpui/ (a level's under it: `wide`, `market`, `tail`, `wall`), with the engine, the font, and the data files by range
just observatory gpui-build [level]   # its release build at a level (`base`, `wide`, `market`, `tail`, `wall`): wasm alone (-p, the level's feature) + wasm-opt into web/pkg[-<level>]/, Vite build into web/dist[-<level>]/, asset sizes (the base's wasm with the crate's `fonts`)
just observatory gpui-preview [level] # serve that build (brotli), with the data files
```
