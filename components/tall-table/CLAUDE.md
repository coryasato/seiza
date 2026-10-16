# tall-table

A GPUI table that reads rows a page at a time from a delegate and draws only where the viewport is, at row counts past what f32 pixels can scroll. A component (root `CLAUDE.md`, "Tiers"), crate `seiza-tall-table`.

---

This is the table's context. Why it's built this way is in `docs/DECISIONS.md`; what it offers its users, in `README.md`. Its work is a milestone in the app that drives it (Tycho, `apps/tycho/PLAN.md`, or the observatory, `apps/observatory/PLAN.md`, which only consumes it: root `CLAUDE.md`, "Tiers"), measured in that app's `perf/`. The repo-wide rules in the root `CLAUDE.md` apply here too. Paths below are relative to this directory.

Current state only: say what to do and point to the decision behind it (`docs/DECISIONS.md`, "Table and paging" and "Component API"); don't retell its measurements.

## Rules

These add to the repo-wide rules.

1. **No app knowledge and no `seiza` dependency.** It depends on `gpui-kit` alone. Report what happened through `TallTableEvent`s; the host turns them into panel rows, marks, and published probes. What only a host knows comes in as settings: `Paging`, `ActivityOptions` (its clock, its window, and when to record), `probe_frames`, `probe_cells`.
2. **A frame never waits on data.** Rows whose page isn't loaded draw as placeholders; nothing in render awaits the delegate.
3. **Don't swap in gpui-kit's `DataTable`** without re-reading `docs/DECISIONS.md`, "Table and paging": its `uniform_list` places rows in f32 pixels and loses precision past ~16 M px.
4. **Events that mark a frame are emitted in render.** `Filled` is emitted while the frame renders, which GPUI delivers in the task that presents it (`App::update` flushes effects after the draw and present), so a host's `mark_after_current_task` lands right after the frame. Don't move it to a deferred or spawned emit. Tycho's `just tycho table --browsers` checks the marks land in the presenting task (`shared-web/perf/`'s `presentedMark`).

## Architecture

- **`src/state.rs`**: `TallTableState<D>`, the entity: the scroll model and page cache, hover and tooltip, the glyph measurements, and the drawing of the header and body. Its public setters (`jump_to`, `set_rows`, `set_columns`, `retry_failed`, `close`) and readers; `TallTableEvent`, `TallTableStats`, `Paging` (1024-row pages, prefetch 2, 64 MiB, 3 in flight, a 250 ms scroll settle, an 80 ms drag settle), `ActivityOptions`; the keys (`init`, `actions!` under `seiza_tall_table`).
- **`src/tall_table.rs`**: `TallTable<D>`, the `RenderOnce` element a host renders: focus, key context and actions, the press that focuses it, and the border (the focus ring when focused), around the state's view. The same split as gpui-kit's `DataTable` and `TableState`.
- **`src/delegate.rs`**: `TallTableDelegate` (`load_page`, `cancel`), `TallTablePage` (`value`, `heap_bytes`), `CellValue`, `PageError`, `PageLoad`.
- **`src/column.rs`**: `TallTableColumn` and `ColumnKind`, and the layout: widths by kind, at least the header's width, an integer column fitting its widest value at the font's widest number advance (`Glyphs`, read once per font).
- **`src/pages.rs`**: `PageCache`, pure bookkeeping (tested natively): which pages are loaded, in flight, draining (cancelled but still answering, counted against `max_in_flight`), failed; what to fetch (visible pages first: no prefetch starts while a visible page is loading), cancel, and evict (LRU past the budget).
- **`src/scroll.rs`**: `RowScroll`, the f64 row position, and the scrollbar thumb math (tested natively).
- **`src/format.rs`**: `fit_float`, rounding a float to its column like a spreadsheet's automatic format (tested natively).
- **`src/activity.rs`**: the frames drawn over the host's window, for rows/s and filled frames.
- **`src/probe.rs`**: `TallTableProbe`, `TallTableLayout`, `ColumnProbe`, `CellProbe`: what scripts read.

**Cells:** a value cell is a plain block, never a flex container: GPUI cuts text (`text_overflow`) only when its width is definite, and in a flex cell a right-aligned number spilled out the left and lost its front. Text ends in "…", its line breaks shown as `¶` (`cell_text`; `shape_line` debug-asserts there's no `\n`). One tooltip, for the hovered cell (`hover_at`, mapped from the scroll model, not per-cell hitboxes), shows a rounded, cut, or one-lined value's exact text once the pointer has rested 500 ms and its page is loaded (`decide_tooltip`, in render), at once within 300 ms of the last one going, drawn with gpui-kit's `Tooltip` and gpui-base's `TooltipPositioner` in a `deferred` (Root's tooltip overlay is crate-private).

## GPUI Kit gotchas (check before debugging)

- **`use gpui_kit::*` brings gpui-kit's `test` attribute**, which shadows `#[test]` ("recursion limit reached while expanding `#[test]`"). A test module imports what it needs by name, not `super::*`.
- **A scrollbar release can arrive before the next paint.** The drag's mouse-move and mouse-up handlers are registered every frame in the body's `canvas`, not only once a drag starts: a quick click on the track missed its release in WebKit, and the next pointer move scrolled the table.

## Layout

```
components/tall-table/
  src/              # lib.rs (re-exports), state.rs, tall_table.rs, delegate.rs, column.rs, pages.rs, scroll.rs, format.rs, activity.rs, probe.rs
  Cargo.toml        # seiza-tall-table: gpui-kit only
  docs/             # DECISIONS.md
  README.md         # for the crate's user
  CLAUDE.md         # this file
```

## Tests

```
cargo test -p seiza-tall-table   # native tests: page cache, scroll model, float fitting, cell text
```

The view runs in Tycho's checks: `just tycho table`, `jump`, `cells`, `errors`, and the suite's table and jump parts.
