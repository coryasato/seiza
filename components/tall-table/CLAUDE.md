# tall-table

A GPUI table that reads rows a page at a time from a delegate and draws only where the viewport is, at row counts past what f32 pixels can scroll. A component (root `CLAUDE.md`, "Tiers"), crate `seiza-tall-table`.

---

This is the table's context. Why it's built this way is in `docs/DECISIONS.md`; what it offers its users, in `README.md`. Its work is a milestone in its own `PLAN.md` (the one list of its features). Each feature's own cost (added wasm, frame work) is measured in a bare host and recorded in `perf/results/`; budgets are the apps' that build it: Tycho, which adopts every feature, or the observatory, which only consumes it and adds a feature level when both its sides are built (root `CLAUDE.md`, "Tiers"). The repo-wide rules in the root `CLAUDE.md` apply here too. Paths below are relative to this directory.

Current state only: say what to do and point to the decision behind it (`docs/DECISIONS.md`, "Table and paging" and "Component API"); don't retell its measurements.

## Rules

These add to the repo-wide rules.

1. **No app knowledge and no `seiza` dependency.** The crate (`seiza-tall-table`) depends on `gpui-kit` alone; the bridge and the bare host beside it (below) are host-side crates, never its dependencies. Report what happened through `TallTableEvent`s; the host turns them into panel rows, marks, and published probes. What only a host knows comes in as settings: `Paging`, `ActivityOptions` (its clock, its window, and when to record), `probe_frames`, `probe_cells`.
2. **A frame never waits on data.** Rows whose page isn't loaded draw as placeholders; nothing in render awaits the delegate.
3. **Don't swap in gpui-kit's `DataTable`** without re-reading `docs/DECISIONS.md`, "Table and paging": its `uniform_list` places rows in f32 pixels and loses precision past ~16 M px.
4. **Events that mark a frame are emitted in render.** `Filled` (and `live`'s `Refreshed`) is emitted while the frame renders, which GPUI delivers in the task that presents it (`App::update` flushes effects after the draw and present), so a host's `mark_after_current_task` lands right after the frame. Don't move it to a deferred or spawned emit. Tycho's `just tycho table --browsers` checks the marks land in the presenting task (`shared-web/perf/`'s `presentedMark`).

## Architecture

- **`src/state.rs`**: `TallTableState<D>`, the entity: the scroll model and page cache, hover and tooltip, the glyph measurements, and the drawing of the header and body. Its public setters (`jump_to`, `set_rows`, `set_columns`, `retry_failed`, `close`, and with `live` `invalidate_rows`, whose reads are planned once at the end of the update that made them) and readers; with `live`, a re-read whose load is ready when sent lands in that turn (`answered`), not on a spawned task; `TallTableEvent`, `TallTableStats`, `Paging` (1024-row pages, prefetch 2, 64 MiB, 3 in flight, a 250 ms scroll settle, an 80 ms drag settle), `ActivityOptions`; the keys (`init`, `actions!` under `seiza_tall_table`).
- **`src/tall_table.rs`**: `TallTable<D>`, the `RenderOnce` element a host renders: focus, key context and actions, the press that focuses it, and the border (the focus ring when focused), around the state's view. The same split as gpui-kit's `DataTable` and `TableState`.
- **`src/delegate.rs`**: `TallTableDelegate` (`load_page`, `cancel`), `TallTablePage` (`value`, `heap_bytes`, and with `custom-cells` `paint`), `CellValue`, `PageError`, `PageLoad`.
- **`src/paint.rs`** (`custom-cells`): `CellPaint`, `Ramp`, `Bar`, `Stop`; a column's ramps resolved from the theme once a frame (`ColumnPaint`), mixed in Oklab, premultiplied, as CSS mixes (`Oklab`); a cell's fill and bar as quads and its text color (`draw`). `render_body` collects the quads in the row loop and paints them from one `canvas`, the cells layer's first child (`docs/DECISIONS.md`, "Features").
- **`src/flash.rs`** (`live` with `custom-cells`): what a change flashes at (`change`: a rise, a fall, any other change; two NaNs equal), its fade (`opacity`), and `Flashes`, the live flashes by (row, column) on GPUI's clock (`BackgroundExecutor::now`, read through a closure: its `Instant` isn't public). The state compares a landing re-read with the page it replaces (`note_flashes`, before the cache swaps them, over the rows `PageCache::changes` names), draws each flash as a quad over the fill in `custom-cells`' pass, asks for the next frame while one is on screen (`Window::request_animation_frame`, in render), and under `App::reduce_motion` holds it and clears it from a timer (`after_flashes`). Its `Control` (tests only) is the flash fixture's negative controls.
- **`src/column.rs`**: `TallTableColumn` (with `custom-cells`, its `fill`, `bar`, and `text_ramp`; with `live` too, its `flash`) and `ColumnKind`, and the layout: widths by kind, at least the header's width, an integer column fitting its widest value at the font's widest number advance (`Glyphs`, read once per font).
- **`src/pages.rs`**: `PageCache`, pure bookkeeping (tested natively): which pages are loaded, in flight, draining (cancelled but still answering, counted against `max_in_flight`), failed; what to fetch (visible pages first: no prefetch starts while a visible page is loading), cancel, and evict (LRU past the budget). With `live`, a loaded page's re-read state (`Live`: stale, its read in flight with the generation it started at, a failed re-read, a landed one not yet drawn), each invalidation's generation, and `take_refreshed` for render; with `custom-cells` too, each page's rows invalidated since its drawn read started (`RowSet`s: before the re-read in flight, and during it), while a column flashes (`track_changes`, `changes`); the order re-reads go in and their `max_in_flight − 1` limit are `plan`'s (`docs/DECISIONS.md`, "Features"). Its `Control` (tests only) is the paging fixture's `live` negative controls.
- **`src/scroll.rs`**: `RowScroll`, the f64 row position, and the scrollbar thumb math (tested natively).
- **`src/format.rs`**: `fit_float`, rounding a float to its column like a spreadsheet's automatic format (tested natively).
- **`src/activity.rs`**: the frames drawn over the host's window, for rows/s and filled frames.
- **`src/probe.rs`**: `TallTableProbe`, `TallTableLayout`, `ColumnProbe`, `CellProbe` (with `custom-cells`, its `PaintProbe`): what scripts read.
- **`src/state/fixtures.rs`** (tests only): the fixtures' native tests (`fixtures/README.md`). A child of `state`, so the paging scenarios drive the state's own scroll, drag, and paging paths: a `TallTableState` in GPUI's test app (gpui-kit's `test-support`, a dev-dependency), over a delegate that answers a read only when the scenario says, on GPUI's test clock (only `advance_clock` moves it, so the settle times are the table's own timers). Cell text goes through `shown_text`, what `render_body` draws. Its child `fixtures/paint.rs` (with `custom-cells`) draws the paint fixture in a window of the test app and reads the cell probe, in the light theme and then the dark; `fixtures/live.rs` (with `live`) draws re-reads in a window on the paging scenarios' scripted delegate, whose values say which read is on screen, and checks `Refreshed` and the old rows drawn meanwhile; `fixtures/flash.rs` (with both) draws flashes over a source whose values each test sets, on the test clock (`advance_clock`), and runs `paint.json`'s `flash` section and its controls.

**Host-side crates** (beside the component, never its dependencies):

- **`bridge/`** (`tall-table-bridge`): what a seiza host does with the table's events, written once for every host (Tycho, the observatory's GPUI contender, the bare host): `Publish` (the filled mark with `mark_after_current_task`, with `live` the refreshed mark and the highest generation drawn on a global, set before the mark, the scrollbar's targets `table-scroll-track` and `table-scroll-thumb`, the probe, layout, and drawn cells on globals the host names) and `js` (the probes as JS values, for a host that puts them somewhere of its own). A host's own state and panel rows stay in its own `match`. It depends on `seiza` and the table, so it can't live in either (`docs/DECISIONS.md`, "Hosts"). `Publish::event` is `#[inline]`: its unused arms fold away in each host.
- **`host/`** (`host/crate/`, package `tall-table-host`; `host/web/`, `@seiza/tall-table-host`): the bare host, where each feature's own cost is measured (`PLAN.md`, "Measuring a feature"). The table alone over rows answered from memory (`rows.rs`: each value a function of its row and column, a page materialized when its read resolves, none for a read cancelled before then, answered as the DuckDB source's Arrow pages are), on `seiza` without the panel, no engine. `?shape=narrow` (the observatory's 11 columns' kinds) or `wide` (500 float columns), 1,567,523 rows either way; `?delay=<ms>` holds each read; `?perf` turns on the probes (`__tallTable`, `__tallTableLayout`). It marks `tall-table:filled` and publishes the scrollbar's targets; `web/src/main.ts` defines `__seizaFrameSample`. Never deployed. One Cargo feature per table feature, each switching the feature on at run time: `custom-cells` paints every float column through its range (`rows.rs`'s `Cells`: `?cells=text|heat|bars|color`, `text` the control), publishes the drawn cells with `?perf&probe-cells` (`__tallTableCells`, for the smoke check: never in a perf run, whose frames it would slow), and takes `?jump=<row>`; `live` runs a feed at `?live=<updates/s>` (`host.rs`'s `Feed`: seeded, random visible rows, a batch about every frame, each row once, its version bumped in the source, whose floats mix it in), marking each batch from the moment its rows are picked (`tall-table:invalidated`, its last generation on `__tallTableInvalidated`) and publishing the refreshed mark (`tall-table:refreshed`, `__tallTableRefreshed`); with both, `?flash` gives every float column a flash (`rows.rs`'s `with_flash`: `chart_bearish`, `warning`, `chart_bullish`, 1 s). `just tall-table build <features>` records what it was built with in `web/dist/build.json`, which the scripts read.

**Cells:** a value cell is a plain block, never a flex container: GPUI cuts text (`text_overflow`) only when its width is definite, and in a flex cell a right-aligned number spilled out the left and lost its front. Text ends in "…", its line breaks shown as `¶` (`cell_text`; `shape_line` debug-asserts there's no `\n`). One tooltip, for the hovered cell (`hover_at`, mapped from the scroll model, not per-cell hitboxes), shows a rounded, cut, or one-lined value's exact text once the pointer has rested 500 ms and its page is loaded (`decide_tooltip`, in render), at once within 300 ms of the last one going, drawn with gpui-kit's `Tooltip` and gpui-base's `TooltipPositioner` in a `deferred` (Root's tooltip overlay is crate-private).

**Features** (`Cargo.toml`, each off by default): code behind one is `#[cfg(feature = "…")]`, and the base build must not change with it off (`just tall-table size` checks its symbols are absent). The bridge and the host forward each one (`tall-table-host/custom-cells` turns on the table's and the bridge's). A theme color a feature draws comes in as a `Stop` (`fn(&Theme) -> Hsla`), resolved each frame, never stored in a page.

## GPUI Kit gotchas (check before debugging)

- **`use gpui_kit::*` brings gpui-kit's `test` attribute**, which shadows `#[test]` ("recursion limit reached while expanding `#[test]`"). A test module imports what it needs by name, not `super::*`.
- **A `fn` pointer compared with `==` warns** (`unpredictable_function_pointer_comparisons`), in a derived `PartialEq` too: `Bar` compares its `Stop` with `std::ptr::fn_addr_eq`. A `Vec` of them (`Ramp`) doesn't warn.
- **A scrollbar release can arrive before the next paint.** The drag's mouse-move and mouse-up handlers are registered every frame in the body's `canvas`, not only once a drag starts: a quick click on the track missed its release in WebKit, and the next pointer move scrolled the table.

## Layout

```
components/tall-table/
  src/              # lib.rs (re-exports), state.rs (+ state/fixtures.rs, state/fixtures/paint.rs, state/fixtures/live.rs, and state/fixtures/flash.rs, tests only), tall_table.rs, delegate.rs, column.rs, paint.rs, flash.rs, pages.rs, scroll.rs, format.rs, activity.rs, probe.rs
  fixtures/         # paging.json, cells.json, sql.json, paint.json: what "the same" means for a DOM contender; README.md (the formats)
  Cargo.toml        # seiza-tall-table: gpui-kit only (dev: gpui-kit's test-support, futures, serde_json); features, each off by default
  bridge/           # tall-table-bridge: the table's events → a seiza host's marks, targets, and probes (Tycho, the GPUI contender, the bare host)
  host/             # the bare host: crate/ (tall-table-host: lib.rs, host.rs, rows.rs), web/ (Vite: index.html, src/main.ts, vite.config.ts; pkg/ and dist/ gitignored)
  perf/             # harness.ts (the host's paths, port, marks, globals, the build's features), size.ts, perf.ts, live.ts, smoke.ts, paint-fixture.ts; results/: each feature's own cost, dated (no budgets)
  docs/             # DECISIONS.md, milestones.md, LESSONS.md
  PLAN.md           # its features to come, in order; the active milestone
  README.md         # for the crate's user
  CLAUDE.md         # this file
  justfile          # loaded from the root as the `tall-table` module
```

## Commands

```
just tall-table dev [features]   # the bare host: debug wasm + Vite dev server with COOP/COEP (?shape=wide, ?delay=<ms>; custom-cells: ?cells=heat; live: ?live=<updates/s>; both: ?flash)
just tall-table build [features] # its release build: wasm alone (-p) + wasm-opt, Vite build, asset sizes; the base without features
just tall-table preview      # serve that build (brotli)
just tall-table size [flags] # its wasm raw, after wasm-opt, brotli 11, the base and each feature's build; no engine or panel linked (and the control); no feature's symbols in the base (and the control); the base at another commit (--against); the GPUI contender's shipped wasm beside it (--label)
just tall-table perf [flags] # frame work per shape on the last build: a vertical scroll, a vertical fling, a horizontal fling (wide), reference + throttled, cold, median of 10 (--runs, --shape, --profile, --cells, --label); run `build` first
just tall-table live [flags]  # live's invalidate → refreshed frame in the narrow shape with the feed on, then frame work and late frames under it, cold, median of 10 (--rate, --runs, --profile, --seconds, --flash, --label); run `build live` first
just tall-table smoke [flags] # the release build loads, fills, and scrolls in both shapes in Chromium, Firefox, WebKit, at each paint style if built with custom-cells, and with the feed on if built with live (its refreshed mark right after a presented frame; with both, the drawn cells changing, and flashes drawn with ?flash) (--browsers); run `build` first
just tall-table test         # native tests with every feature off, each on, then all on: the table's and the host's rows and feed (the bridge's JS is wasm-only; Tycho's checks and the cell fixture read its fields)
just tall-table paint-fixture [--check] # fixtures/paint.json's expected colors from Chromium's color-mix(in oklab), its bars, and its flashes
just tall-table lint         # check-terms, fmt, clippy (the table, the bridge, the host; wasm32 and native), tsc (the host's page, perf/)
```

## Perf script gotchas

- **A page's own rAF loop slows `live`'s latency:** with `frameRecorder` installed, invalidate → refreshed frame read ~20 ms where it reads ~7 without, so `live.ts` measures latency first with nothing on the page, then installs the recorder and traces frame work in a second window.
- **The host's scripts serve its release build themselves** (`perf/harness.ts`: `vite preview` of `host/web/dist` on port 4350, through `shared-web/perf/`'s `serveApp`). Per-frame work comes from Chromium's trace (`shared-web/perf/trace.ts`'s `frameWork`), each segment traced on its own (a trace of every segment at once runs to hundreds of MB); `workRecorder` cross-checks it. Late frames come from `frameRecorder`'s rAFs: Chromium's compositor frame reporter doesn't see GPUI's canvas frames.

## Tests

```
cargo test -p seiza-tall-table   # native tests: page cache, scroll model, float fitting, cell text, the paging and cell fixtures
just tall-table test             # those, and the host's rows, with every feature off and then on (the paint fixture)
```

**The fixtures** (`fixtures/README.md`) pin what a DOM contender must match. A change that alters the table's page requests, its cell text, or its page SQL fails them: update the fixture in the same change (and so every DOM contender's tests). `cells.json`'s drawn cells come from the observatory's GPUI contender (`just observatory cell-fixture`; `--check` compares); its `rounding` cases, `paging.json`, and `sql.json` (whose test is the DuckDB engine's, where the SQL is written) are edited by hand. `paint.json`'s cases and stops are by hand and its expectations come from Chromium (`just tall-table paint-fixture`; `--check` compares). `just observatory fixtures` runs all three.

The view runs in Tycho's checks (`just tycho table`, `jump`, `cells`, `errors`, and the suite's table and jump parts) and in the bare host's (`just tall-table smoke`, `perf`).
