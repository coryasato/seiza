# The table crate (`src/`)

The crate `seiza-tall-table`: the state entity, the element, the delegate, and each feature's pure half. Claude Code loads this file when a file under `src/` is read. The table's rules and the map of its folders are in `components/tall-table/CLAUDE.md`, the repo's in the root `CLAUDE.md`; both apply here. Paths are relative to `components/tall-table/`.

## Architecture

The modules, a line each; their doc comments and their items' say the rest.

- **`state.rs`**: `TallTableState<D>`, the entity: the scroll model and page cache, hover and tooltip, the glyph measurements, the header and body's drawing, its public setters and readers; `TallTableEvent`, `Paging`, `ActivityOptions`, the keys (`init`). Each feature's half is a child in `state/` (`src/state/CLAUDE.md`).
- **`tall_table.rs`**: `TallTable<D>`, the `RenderOnce` element a host renders (focus, key context and actions, the border), around the state's view: the split of gpui-kit's `DataTable` and `TableState`.
- **`delegate.rs`**: `TallTableDelegate`, `TallTablePage`, `CellValue`, `PageError`, `PageLoad`. **`column.rs`**: `TallTableColumn`, `ColumnKind`, and the layout (`layout_columns`). **`probe.rs`**: what scripts read (`TallTableProbe`, `TallTableLayout`, `ColumnProbe`, `CellProbe`), and what each feature adds to it: `select`'s `selection` and `sort`'s `sort` on the probe; `pin`'s `pinned` (the run in effect) and `format`'s `advances` (each character a format writes, at the text in effect) on the layout; `group-headers`' `header_rows` on the layout (its group cells drawn are an event of their own, `TallTableEvent::Groups`'s `GroupProbe`s); `sort`'s `arrow` (its box, from the column's left) and `reorder`'s `index` on each column; `custom-cells`' `PaintProbe` on each cell.
- **Pure, tested natively:** `pages.rs` (`PageCache`: what to fetch, cancel, and evict), `scroll.rs` (`RowScroll`, the f64 row position, and the thumb), `format.rs` (`fit_float`; with `format`, `NumberFormat` and its fit), `activity.rs` (rows/s and filled frames), and each feature's: `density.rs` (`Sizes`), `pin.rs`, `sort.rs`, `copy.rs`, `selection.rs`, `reorder.rs` (a move's rules and the drag's gap among its siblings), `groups.rs` (`group-headers`' runs, the cells a frame draws of them, and a drag's siblings: `children`), `click.rs` (`clicks`' types and its count of left presses), `paint.rs` (`custom-cells`), `flash.rs` (`live` with `custom-cells`).
- **`cells_text.rs`**: the loaded cells' text (below).

**The page cache's plan** (`PageCache::plan`), in order: the visible pages (no prefetch starts while a visible page is loading), their re-reads (`live`), a copy's pages (none while a visible page has nothing to show), then prefetch, which skips a page a copy reads. A canceled read drains (still answering, counted against `max_in_flight`); re-reads and a copy's reads share `background_limit` (`(max_in_flight − 1).max(1)`); a copy's reads are never cached. Why: `docs/DECISIONS.md`, "Features".

## Rules

- **Every length goes through `sizes()`:** a row height, padding, text size, or horizontal estimate is read from the `Sizes` in effect, and the viewport's rows are fitted by `fit_viewport`, never from a constant.
- **Write a site once for both builds.** Where a feature changes a mapping every site reads, the build without it has a stand-in with the same methods, inlined, so each site is written once and the base compiles as before: `Sizes` in `column.rs` (`density`), `Place` in `state.rs` (`pin`), `LaidOutColumn::index` (`reorder`), `copy`'s `Writer`. Where a stand-in costs bytes, the base's path keeps its shape (`pin`'s `visible_columns`, `cell`, the thumb).
- **Places and indices** (`reorder`): a column's place is where it's drawn, its index its place in `set_columns`' list. Everything about the screen goes by place (a selection's ranges and keys, `pin`'s count, the hit tests, the hover, `CellProbe::column`); everything that crosses to the data or a column's settings goes through its index (a page's `value`, `paint`, and `decimals`, the tooltip, `resize`'s fit and `ColumnWidthsChanged`, `live`'s flashes, `column_info`, `sort`'s column, `copy`'s columns taken at its start). A drag or press held across a move (`resize`'s, `sort`'s arrow) is held by index, so it stays on its column (`docs/DECISIONS.md`, "Features").
- **`pub` means a host can name it, and every public item has a doc comment** (`missing_docs`, `unreachable_pub`; a crate-private struct's fields are `pub(crate)` by hand). A doc names another feature's item as a code span, never a link: the link breaks in a build without that feature (`lint` and `pairs` build rustdoc with `-D warnings`; `docs/DECISIONS.md`, "Component API").
- **Negative controls:** each fixture's controls are a `Control` type in the module whose rule they break (tests only), and each must fail its fixture.
- **Cells:** a loaded cell's text is drawn by `cells_text`, one `canvas` a region painting every glyph in one `paint_layer`, never an element a cell (`docs/DECISIONS.md`, "Features"). Its pixels are the `div`s' it replaced (snapped and cut as taffy and `paint_line` do); a change to how it's drawn keeps them, checked against the commit before (`just tall-table smoke --screens`). Text ends in "…", its line breaks shown as `¶` (`cell_text`; `shape_line` debug-asserts there's no `\n`).
- **One tooltip,** for the hovered cell, found from the scroll model (`hover_at`), never per-cell hitboxes; decided at a frame once the pointer has rested, and again after each page that lands on its row (`undecide_tooltip`), so it says what its cell draws; drawn with gpui-kit's `Tooltip` and gpui-base's `TooltipPositioner` in a `deferred`, since `Root`'s tooltip overlay is crate-private.
- **`flash.rs` reads GPUI's clock through a closure** (`BackgroundExecutor::now`): its `Instant` isn't public.
- **`format.rs`'s test shapes IBM Plex Sans with cosmic-text,** the web's shaper, a dev-dependency pinned at gpui-pre-wgpu's locked version (`plex_sans_shapes_formats_at_their_advances`).

## GPUI gotchas (check before debugging)

These are GPUI's, not the web's; the web's are in `.claude/rules/gpui-web.md`.

- **`use gpui_kit::*` brings gpui-kit's `test` attribute**, which shadows `#[test]` ("recursion limit reached while expanding `#[test]`"). A test module imports what it needs by name, not `super::*`.
- **A `fn` pointer compared with `==` warns** (`unpredictable_function_pointer_comparisons`), in a derived `PartialEq` too: `Bar` compares its `Stop` with `std::ptr::fn_addr_eq`. A `Vec` of them (`Ramp`) doesn't warn.
- **A key context only counts on the focused element's path.** Key dispatch walks from the focused element up, so a context on a child of the element that tracks focus never matches: `select`'s context is the element's own (`TallTable TallTableSelect`). Bindings matching at the same depth go latest-bound first, so `select::init` runs after the base's bindings and its keys win while a kind is on.
- **An action that calls `cx.propagate()` hands its key to the next binding that matches** (deeper first, then latest-bound first at a depth): `reorder`'s `CancelMove` is bound to Escape last, so it sees Escape first, and with no drag it propagates to `select`'s `ClearSelection` and then the host's. A binding that only sometimes wants a key doesn't need a key context switched on and off.
- **A scrollbar release can arrive before the next paint.** The drag's mouse-move and mouse-up handlers are registered every frame in the body's `canvas`, not only once a drag starts: a quick click on the track missed its release in WebKit, and the next pointer move scrolled the table.

## Files

```
  src/              # lib.rs (re-exports), cells_text.rs, click.rs, state.rs (its children in state/: src/state/CLAUDE.md), tall_table.rs, delegate.rs, column.rs, selection.rs, copy.rs, sort.rs, pin.rs, density.rs, reorder.rs, groups.rs, paint.rs, flash.rs, pages.rs, scroll.rs, format.rs, activity.rs, probe.rs
```

## Commands

The native tests are `cargo test -p seiza-tall-table` and `just tall-table test` (`components/tall-table/CLAUDE.md`); the random test's, `src/state/CLAUDE.md`.
