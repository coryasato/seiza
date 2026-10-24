# tall-table

A GPUI table that reads rows a page at a time from a source you write, smooth from a hundred rows to tens of millions. It never holds the whole dataset and draws only the rows and columns in view. Its scroll position is an f64 row index, so it scrolls 25 M rows as precisely as 25. Tables that place rows in f32 pixels (gpui-kit's `DataTable` among them) lose precision past ~16 M px, about half a million rows at 32 px.

"Tall" as in MATLAB's tall arrays: more rows than are ever held at once, read when needed. The element itself fills its parent and scrolls.

**Used by:** [Tycho](../../apps/tycho/), and [the observatory](../../apps/observatory/)'s GPUI contender. **Crate:** `seiza-tall-table`. A DuckDB source is [`seiza-duckdb`](../../engines/duckdb/)'s `tall-table` feature. A host built on `seiza` turns the table's events into marks, targets, and probes with `tall-table-bridge` (`bridge/`).

## Use it

```rust
use seiza_tall_table::{ColumnKind, Paging, TallTable, TallTableColumn, TallTableEvent, TallTableState};

seiza_tall_table::init(cx); // once, at startup: the scrolling keys

let state = cx.new(|cx| {
    TallTableState::new(
        my_rows,                                            // impl TallTableDelegate
        vec![TallTableColumn::new("id", ColumnKind::Integer { max_chars: 20 }), TallTableColumn::new("name", ColumnKind::Text)],
        row_count,
        Paging::default(),                                  // 1024-row pages, prefetch 2, 64 MiB, 3 reads in flight, 250/80 ms settles
        cx,
    )
});
cx.subscribe(&state, |this, state, event: &TallTableEvent, cx| { /* … */ }).detach();

// In render: fills its parent.
TallTable::new(&state)
```

**The delegate** (`TallTableDelegate`) reads pages of rows when the table asks:

- `load_page(rows, cx)`: starts reading `rows` (0-based, end-exclusive); returns a `Request` id and a future of the page (`PageLoad`).
- `cancel(request, cx)`: the table no longer wants it. The future must still resolve (`PageError::Cancelled`, or the page if it won the race); the table counts it as in flight until then, since a source may not be able to stop a started read.

A page (`TallTablePage`) answers `value(row, column)` with a `CellValue` (`Null`, `Float`, `Float32`, or `Text`) and `heap_bytes()` for the cache's budget. A failed page (`PageError::Failed { message, read_failure }`) shows its message in its rows; `read_failure` says the source itself broke, and the table emits `TallTableEvent::ReadFailed`.

**Columns** (`TallTableColumn::new(name, kind)`): the `ColumnKind` sets width and alignment. Integers fit their widest value (`max_chars`) and are never rounded, cut in the middle if still too wide; floats round to the digits that fit; decimals are exact and cut in the middle; booleans, dates, timestamps, and text are left-aligned and cut at the end. A rounded or cut value's exact text is in a tooltip on the hovered cell.

**`TallTableState`:**

- `jump_to(row, cx)`: scrolls `row` to the top (or as near as the end allows) and highlights it.
- `set_rows(rows, cx)`: the source grew (rows still loading); the scrollbar follows and short pages reload.
- `set_columns(columns, cx)`: a column's kind changed.
- `retry_failed(cx)`: loads failed pages again, after the host repaired the source.
- `close(cx)`: cancels its reads and starts no more (a table being replaced).
- `stats(now)`: pages loaded, in flight, draining, cache bytes, and, with `with_activity(ActivityOptions)`, rows/s and the share of frames with every visible row loaded.
- `delegate()`, `delegate_mut()`, `rows()`, `columns()`, `focus_handle()`, `has_failed_reads()`.

**Events** (`TallTableEvent`):

- `Filled { first }`: a frame with every visible row loaded is being drawn, after one that wasn't. It's emitted while that frame renders, so subscribers hear it in the task that presents the frame: a mark set right after that task lands right after the rows are on screen.
- `ReadFailed`: see above.
- `Scrollbar { track, thumb }`: the vertical scrollbar's bounds, when they change, for scripts that drag it.
- `Probe`, `Layout` (with `probe_frames(true)`) and `Cells` (with `probe_cells(true)`): what a frame shows, where the cells are, and every drawn cell's exact and shown text, for scripts on a canvas with no DOM.

Keys, while it has focus: ↑/↓ a row, Page Up/Down and Space/Shift+Space a screen, Home/End and Cmd+↑/↓ the ends. Shift+wheel scrolls sideways. The scrollbars are its own: a press on a track jumps there, and a drag loads only once the pointer rests (80 ms).

## Features

| Feature | What it adds | Cost (wasm, brotli) | Measured in |
|---|---|---|---|
| *(base)* | Paging, prefetch, and a page cache; f64-row scrolling with its own scrollbars, wheel, and keys; columns by kind; rounding, middle cuts, and the exact-value tooltip; a jump-to-row highlight | The baseline every feature's cost is read against: the bare host's whole wasm (gpui-kit and `seiza` included) and its work per frame | [The bare host's results](perf/results/) |

No features yet. What's planned, each off by default: [`PLAN.md`](PLAN.md).

## Limits

- **Read-only.** No editing, selection, sorting, filtering, or column resizing.
- **Fixed column widths** by kind (and the header's length), not by the values: measuring the widest value would cover only the pages loaded, and a column must not widen under the reader.
- **Paging is the delegate's speed.** A frame never waits on data; rows not loaded yet draw as placeholders. A 3 s fling outruns any prefetch (~84% placeholder frames on Tycho's asteroids sample), while steady scrolling shows none.

## Canvas tradeoffs

- **Accessibility:** screen readers see nothing: the canvas has no accessibility tree. *Today:* it scrolls entirely from the keyboard (above). *To close it:* a hidden DOM mirror of the visible rows, kept in step with each frame.
- **Text selection and copy:** cells can't be selected or copied. *To close it:* a selection feature, with copy through the browser's clipboard event.
- **Ctrl+F:** the browser's find can't see the cells. *To close it:* the DOM mirror above, or a find of the table's own that queries the source.

## Docs

| File | What's in it |
|---|---|
| [`CLAUDE.md`](CLAUDE.md) | Rules, architecture, gotchas. |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | Why it's built the way it is, by area. |
| [`fixtures/README.md`](fixtures/README.md) | What another implementation of the base level must match: page requests, cell text, page SQL. |
| [`PLAN.md`](PLAN.md) | The features to come, in order, and the active milestone. |
| [`perf/results/`](perf/results/) | What the table measures of itself in its bare host (`host/`): the base's bytes and frame work, then each feature's added cost. Budgets are the apps' that build it. |
