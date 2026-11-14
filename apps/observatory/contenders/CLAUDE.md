# The contenders (`contenders/`)

What both contenders share. Each contender's own file is beside its code: `tall-table/gpui/CLAUDE.md`, `tall-table/tanstack/CLAUDE.md`. Claude Code loads this file when a file under `contenders/` is read. The observatory's rules and the map of its folders are in `apps/observatory/CLAUDE.md`, the repo's in the root `CLAUDE.md`; both apply here. Paths are relative to `apps/observatory/`.

## Rules

- **`scenarios.ts` is the one list of scenarios and levels:** each scenario's level, data file, stops, and default stop, and every number both sides and the page's drawings draw from (the wide sheet's heat ramp and domain, market watch's seed, colors, and flash, live tail's rates, error color, and widths, the wall's tables, seed, rate, desks, and grid). Its lists: `LEVEL_FEATURES` (each level's table features), `ALL_SCENARIOS` (what `pickScenario` and the measuring scripts read), `SCENARIOS` (the page's: a scenario joins once both sides build it and the page draws it), and `BUILT` (the levels each side builds, which the recipes, `sizes`, `cold --level`, `tanstack-sizes`, `placeholder`, the page's servers, and `stage.ts` read; `built.ts` prints a side's for the justfile). A level in `LEVEL_FEATURES` that a side doesn't build yet fails that side's build (`level.ts`'s `levelOf`).
- **`level.ts` and `fonts/files.ts` are Node only** (build and script code; nothing a browser loads imports them): `level.ts` holds `gpuiCargoFeatures` (the GPUI crate's features at a level, which `built.ts --cargo` prints for the recipes), a side's `dist-<level>` directory, and `levelConstants` (the `__LEVEL__` both Vite configs define).
- **A change for one level leaves every other level's build byte-identical,** on both sides: a level's code can't move another's bytes, so each level's numbers stay the ones measured. How each side keeps it is in its file (`tall-table/gpui/CLAUDE.md`, `tall-table/tanstack/CLAUDE.md`). Each was confirmed by an A/B in the milestone that built it; a check that enforces it is planned (`PLAN.md`, "Byte-identical as checks, not habits").
- **`paths.ts` is every path** (a level's base under its contender's); the page and the perf scripts read it too. A new one is under `/observatory/` (the app's rule 2).
- **Both contenders load one engine copy:** `engine.ts`'s `contenderBuild`, in both Vite configs, emits DuckDB-Wasm's bundles under `duckdb/`, content-hashed, referenced at `/observatory/duckdb/`; in dev and preview it serves the engine and the font at their paths (`shared-web`'s `serveDirs` and `serveFonts`). The contenders don't add `@seiza/duckdb`'s `duckdb()` plugin: it guards only `<base>duckdb/`, and the engine's missing extensions 404 there. It inlines `THEME_SCRIPT` at the head of the `<head>`, and fails the build if Arrow or DuckDB-Wasm's JS is in a chunk the entry loads statically. `data.ts` serves `data/` by range at `/observatory/data/` in dev and preview, whatever the base, with the Worker's headers.
- **What only one scenario's page needs is a module of its own,** so the TanStack entry (which imports `contract.ts`) doesn't carry it: `follow.ts` (live tail's follow toggle), `tools.ts` (the wide sheet's copy line, whose reporter posts a change of the copy's state at once and the rest at most every 100 ms); the wall's desk names are `wall/names.ts`, so `scenarios.ts` never imports the 400 instruments.
- **A feed is one module for both sides, and its fixture proves the stores agree:** `market/feed.ts` (pure: market watch's instruments, their one home, the batch's layout, the seeded generator, the rate) and `market/worker.ts`, which each contender's frame starts, sending a batch about every 16 ms as one transferred `ArrayBuffer`, its send time stamped at the post. Its fixture (`market/fixtures/`) and the wall's over its 400 instruments (`wall/fixtures/`) are written by `market/fixtures/write.ts` with a reference fold of its own (`--check` regenerates them), and each side's store runs them with the same controls; live tail's clock has a fixture of its own (`tail/fixtures/clock.json`, with its test). Both instrument lists (`market/feed.ts`'s, `wall/instruments.ts`) are pinned as text: the file is the record.
- **The script faces are pinned:** `fonts/faces.ts` pins the admin table's 13 Noto faces (one commit of notofonts' release site; each face's version, bytes, and SHA-256) and serves each under a name with its version and hash. All of `fonts/faces/` (gitignored) is served, so a face missing or off its pin, or any file no pin names, is a problem (`files.ts`'s `facesProblem`); `just observatory script-fonts` fills it by the pins and removes anything else. `OFL.txt` is committed.
- **The contract's names are `contract.ts`'s:** `__contender`, the marks (`MARKS`), the readout's ring (`READOUT_PARAM`, `SHOWN_RING`), the marks' relay to a parent page, the page's theme (`THEME_SCRIPT`, `pageTheme`, `followPageTheme`); the replay's fling profile is the metrics module's. What each means: `docs/contender-contract.md`.

## Where each piece is

```
scenarios.ts, level.ts, built.ts, paths.ts    the scenarios and levels, a side's build level, the paths
contract.ts, follow.ts, tools.ts              the contract and the page's messages
engine.ts, data.ts                            the engine and the data, built and served
market/      feed.ts, worker.ts, fixtures/ (feed.json, feed.bin, write.ts)    market watch's feed, and the wall's
wall/        instruments.ts, names.ts, desks.ts, fixtures/                     the wall's instruments and its feed fixture
tail/        data.ts, clock.ts, worker.ts, fixtures/ (clock.json, its test)    live tail's file and clock
fonts/       faces.ts, files.ts, fetch.ts, OFL.txt; faces/ fetched (gitignored) the admin table's script faces
tall-table/gpui/, tall-table/tanstack/        each contender, with its own CLAUDE.md
```

## Commands

```
just observatory script-fonts  # the admin table's 13 Noto faces into contenders/fonts/faces/ by their pins (faces.ts), with OFL.txt, anything else removed (the base's gpui-dev and gpui-preview, admin, check, and deploy run it)
just observatory fixtures      # the tall table's fixtures (components/tall-table/fixtures/): their native tests and controls (the base, the wide level's features, and `copy`'s), the TanStack contender's TS run of them, and cell-fixture --check (run gpui-build and gpui-build wide first); the feed fixtures, market watch's and the monitoring wall's: write.ts --check, then each side's store against each, with its controls; live tail's clock fixture, then each side's loop SQL and time text, and the tail scene's numbers; the wall scene's numbers and each desk's rows of the store
```
