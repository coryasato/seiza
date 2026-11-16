# The state's feature children (`src/state/`)

Each feature's half of `TallTableState` (a child module of `src/state.rs`), and the state's tests. Claude Code loads this file when a file under `src/state/` is read. The table's rules and the map of its folders are in `components/tall-table/CLAUDE.md`, the repo's in the root `CLAUDE.md`; both apply here. `src/CLAUDE.md` (the state entity and the pure modules) loads with it. Paths are relative to `components/tall-table/`.

## Architecture

Each feature's child keeps its state in one field of the state (`SelectState`, `CopyState`, `SortState`, `PinState`, `DensityState`, `ClicksState`, `GroupState`, `reorder`'s `order`, `resize`'s `resizing`, `follow`'s flag), and its module's doc comment says the rest: `follow.rs`, `resize.rs`, `select.rs`, `copy.rs` (its window tests in `copy/tests.rs`), `sort.rs`, `pin.rs`, `density.rs`, `reorder.rs`, `groups.rs`, `click.rs`; `hit.rs` holds the presses' hit tests, built with `select`, `reorder`, or `clicks` (the base has only the hover's `cell_at`). Tests only: `cells_text_tests.rs`, `fixtures.rs` (below), `random.rs` (below).

## Rules

- **A feature's pointer drag is a field of its own, never the scrollbar's `Drag`** (`resize`'s `Resizing`, `select`'s `selecting`, `reorder`'s `Moving`): `drag.is_some()` holds page reads until a scrollbar drag rests (`load_or_settle`). It's followed by the move and release handlers the body's `canvas` registers every frame (`src/CLAUDE.md`'s scrollbar gotcha), with a window-wide wheel where the drag scrolls.
- **The root's press listener is one with `clicks`** (`click.rs`'s `press`): it takes every button's press and hands `reorder` and `select` a left press at the table's count; without the feature, their listeners are as before. A new feature's press goes through it in a `clicks` build. A scrollbar, band, or arrow added later stops a right and a long press with `click_stops`.
- **A setter that changes what a held drag or press points at cancels it** (`reorder`'s `cancel_drag` at `move_block`, `set_order`, and `set_columns`, whose places it would hold stale; `sort`'s pressed and hovered arrow forgotten at `set_columns`).
- **A setter's reads are planned once its update ends** (`live`'s `load_after_update`, `copy_load`, `sort_load`), once for everything the update changed, and after the events it emitted reach their subscribers: a host that can't write a copy cancels it at `Started` before a read is sent.
- **A copy keeps the cap it started with,** checked a row at a time; a copy that ends cancels its reads still out; `copy` and the keys start nothing on a closed table.
- **A new text size is laid out once, by the new font** (`density`'s `apply_sizes` leaves the glyphs stale, and render reads the font then lays out): laying out first by the old font's advances would move `pin`'s run and move it back.

## Tests

- **`fixtures.rs`** (tests only): the fixtures' native tests (`fixtures/README.md`), a child of `state` so the paging scenarios drive the state's own scroll, drag, and paging paths: a `TallTableState` in GPUI's test app (gpui-kit's `test-support`), over a delegate that answers a read only when the scenario says, on GPUI's test clock (only `advance_clock` moves it, so the settle times are the table's own timers). Cell text goes through `shown_text`, what `render_body` draws. The test app's text system gives every character 0.6 em, 8.4 px at the cells' 14 px, which is IBM Plex Sans's digit advance too. Its children, a feature each: `src/state/fixtures/CLAUDE.md`.
- **`random.rs`** (tests only): the random test of the paging under every feature built (`docs/DECISIONS.md`, "Fixtures"): proptest driven by hand from a plain `#[test]` (gpui-kit's `property_test` doesn't compile at the pin), each case a scheduler seed, a drawn `Paging` and table, and up to 300 steps with the element in a window, over a source that stamps each row's version and era, answers in any order, and logs every read and cancel. The invariants (`Run::check`, numbered as the research's) are checked after every step against the source's books, each read judged as it went out. Its rules:
  - **A new feature's steps never change an existing case:** they're placed among a case's steps from a stream of their own (`with_pins`, `with_densities`, `with_moves`, `with_drags`; `group-headers`' paths a case's own, `with_paths`), never drawn, so every case's draw, and the controls' cases, are the ones without the feature.
  - **A bug it finds** is an `#[ignore]`d scenario test there and an `Exclusion` (a step generated, a step run, or a pair checked) until it's fixed.
  - **Its controls** (the cache's and `copy`'s `Control`s, `reorder`'s `ReadByPlace`, `group-headers`' `GroupsByPlace` and `GapOutsideParent`; built with each control's feature, run only in the all-on run) must each fail the cases at its invariant.
  - A failure shrinks and prints its steps with the scheduler seed; `SEED` picks the cases (0 unset), `PROPTEST_CASES` how many (16, 48 in the all-on run).

## Files

```
src/state/         # follow.rs, resize.rs, select.rs, copy.rs (+ copy/tests.rs), sort.rs, pin.rs, density.rs, reorder.rs, groups.rs, click.rs, hit.rs; cells_text_tests.rs, fixtures.rs (its children in fixtures/: src/state/fixtures/CLAUDE.md), random.rs, tests only
```

## Commands

```
SEED=<n> cargo test -p seiza-tall-table --features custom-cells,follow,resize,copy,sort,pin,density,format,reorder,group-headers random_paging   # another set of the random test's cases (a failure prints its SEED)
just tall-table soak [seeds] [cases] # the random test soaked: `cases` (500) for each `SEED` of `seeds` (1 2 3 4), every feature with steps in the random test on (not `format`, which has none), release with debug assertions and overflow checks (its time: `docs/DECISIONS.md`, "Fixtures")
```
