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
- `delegate()`, `delegate_mut()`, `rows()`, `visible_rows()`, `columns()`, `focus_handle()`, `has_failed_reads()`.

**Events** (`TallTableEvent`):

- `Filled { first }`: a frame with every visible row loaded is being drawn, after one that wasn't. It's emitted while that frame renders, so subscribers hear it in the task that presents the frame: a mark set right after that task lands right after the rows are on screen.
- `ReadFailed`: see above.
- `Scrollbar { track, thumb }`: the vertical scrollbar's bounds, when they change, for scripts that drag it.
- `Probe`, `Layout` (with `probe_frames(true)`) and `Cells` (with `probe_cells(true)`): what a frame shows, where the cells are, and every drawn cell's exact and shown text, for scripts on a canvas with no DOM.
- `Refreshed { rows, generation }` (`live`): below.

**Paint** (`custom-cells`, off by default): a heat map, data bars, or colored values. A page answers a `CellPaint` for a cell next to its value, three 0..1 values; the column says what turns each into pixels. A host maps each value through its whole column's range with a `Domain`:

```rust
use seiza_tall_table::{Bar, CellPaint, Domain, Ramp};

let delta = Domain::new(min, max).mid(0.0);                                    // the column's stats (min < 0 < max), zero in the middle
let heat = TallTableColumn::new("change", ColumnKind::Float)
    .fill(Ramp::new(&[|theme| theme.background, |theme| theme.chart_1]));     // the whole cell
let bars = TallTableColumn::new("delta", ColumnKind::Float)
    .bar(Bar::new(|theme| theme.chart_1).zero(delta.unit(0.0)).below(|theme| theme.chart_bearish));
let signed = TallTableColumn::new("pnl", ColumnKind::Float)
    .text_ramp(Ramp::new(&[|t| t.chart_bearish, |t| t.foreground, |t| t.chart_bullish])); // the value's color

impl TallTablePage for MyPage {
    fn paint(&self, row: usize, column: usize) -> CellPaint {
        CellPaint { bar: Some(self.domain(column).unit(self.float(row, column))), ..CellPaint::default() }
    }
    // value, heap_bytes …
}
```

- **The range is the column's, never a page's.** Map a value through its whole column's range (from the source's stats, or a fixed one), never one page's minimum and maximum, or colors jump at page boundaries. `Domain { lo, mid, hi }` does the mapping: `unit(v)` puts `lo` at 0, `mid` at 0.5, and `hi` at 1, each side of `mid` scaled on its own (so a diverging ramp's middle stop lands on zero however lopsided the range is), clamped to 0..1, NaN staying NaN; `Domain::new(lo, hi)` puts `mid` halfway; set `mid` only inside the range (`lo <= mid <= hi`, a debug assertion), say 0 for a column whose values cross it. A bar's zero is `unit(0.0)` of the same domain, so the bars agree with the values. Where the range comes from is the source's.
- **Forwarding the feature:** a crate that implements `TallTablePage::paint` turns on `custom-cells` itself (`seiza-tall-table = { …, features = ["custom-cells"] }`): the method exists only with it.

- **A ramp** (`Ramp::new`, two or more stops, evenly spaced) mixes in Oklab, as CSS's `color-mix(in oklab, …)` does. Its stops are theme tokens, read each frame: a theme switch recolors every cell on its frame, with no page read again.
- **A bar** spans from the column's `zero` (0..1 of the cell's inner width, the left edge by default) to the page's value, so a value below zero grows left. `Bar::below(stop)` draws a bar that ends left of its zero in that color, as spreadsheets draw negative bars; without it both sides draw in `color`. A `Bar` is built with `Bar::new` and its setters, never a struct literal (it's `#[non_exhaustive]`).
- **Text over a fill picks its own contrast:** a cell with a fill and no text color draws its text in the theme's `foreground` or `background`, whichever's Oklab lightness is farther from the fill's (ties go to `foreground`). The color it reads is the one on screen: a translucent fill composited over the row's background (the table's, an odd row's stripe, or the jump's tint), and on the jumped-to row its tint over the fill. It picks one of two colors that already contrast with each other; it doesn't score contrast (not WCAG's or APCA's), and a theme switch flips it on its frame. A text ramp still wins; for one fixed text color over every fill, give a two-stop ramp of it. A NULL keeps its muted color. A flash doesn't count: the text reads the page's fill, not the fading quad over it.
- **Drawn** under the text, a fill first and a bar over it, both clear of the line under the row. A loaded row's drawn cells ask their page each frame (a placeholder or failed row paints nothing), so `paint` computes from the value the page holds. A value past 0..1 is clamped; `None` or NaN draws nothing, as does a field whose column has no ramp or bar (a debug assertion). The jump's highlight is drawn over a filled cell, edged, so it still shows there.
- **Probed:** with `probe_cells`, each `CellProbe` carries its `paint` as drawn: fill, bar, and text colors as 8-bit RGBA (the text's from a ramp or a fill's contrast), the bar's left edge and width in CSS px. What a DOM implementation must match: [`fixtures/README.md`](fixtures/README.md), `paint.json`.

**Live rows** (`live`, off by default): rows that change in place, a market watch's prices or a query run again. The host says which rows changed, and the table reads their pages again through the delegate's own `load_page`:

```rust
let generation = state.update(cx, |table, cx| table.invalidate_rows(row..row + 1, cx));
// Later, from the subscription: the first Refreshed at or past `generation`
// over the row is the frame that shows the change.
TallTableEvent::Refreshed { rows, generation } => { /* … */ }
```

- **No placeholders:** a loaded page keeps drawing its old rows until its new page lands, and the frame still counts as filled (no `Filled`). Only a page that isn't loaded draws placeholders, as ever.
- **One read per page in flight:** a page invalidated while it's being read (a re-read, or its first read) is read once more after that read lands, never cancelled and restarted, so invalidating a page ten times in a frame costs one more read. A page with nothing to show reads first, then the visible stale pages, then prefetch (stale prefetch pages among it, in order); re-reads hold at most `max_in_flight − 1` reads at once, so re-reads alone never fill every place (a page scrolled into view can still wait behind prefetch, as without `live`). During a scrollbar drag they wait for the pointer to rest, as every load does.
- **One plan per update:** an invalidation's reads start at the end of the update that made it, so a batch invalidated row by row reads each page once.
- **A source with the rows in hand lands at once:** a re-read whose future is ready when `load_page` returns (an async block with nothing to wait on, `std::future::ready`) lands in that turn and is drawn on the next frame, with no trip through the executor (on the web, each spawned task waits for a `setTimeout(0)`). So a host that holds the new values answers the re-read from them; there's no separate push call. A read that isn't ready is awaited as any other, and first reads always are.
- **Stale pages nobody wants are dropped:** scrolled back to, the page loads as any other does. A re-read of a page that leaves the wanted pages is cancelled.
- **A failed re-read keeps the old rows drawn,** and is read again at the next invalidation of its rows or `retry_failed`; a `read_failure` still emits `ReadFailed`.
- **`Refreshed`** is emitted in the render of the first frame that draws a re-read page, if its rows are visible then (none for a page re-read off screen, then or when scrolled to), with the generation its read started at: every invalidation up to it is drawn. Like `Filled`, a mark set right after the subscriber's task lands right after that frame. Rows whose page isn't loaded or loading change nothing: their first read reads them as they are, and emits no `Refreshed`.
- **The row count is `set_rows`' job:** a query run again with a new count is `set_rows`, then `invalidate_rows(0..rows)`.
- **Patching pages in place isn't a feature:** a host whose pages share storage it changes can call `cx.notify()` on the table, which keeps no cell cache, and needs no feature for it. It gets no flash: the table never sees the old value.

**A flash** (`live` with `custom-cells`): a column can flash the cells a re-read changed, as a market watch's prices do.

```rust
let price = TallTableColumn::new("price", ColumnKind::Float).flash(
    Ramp::new(&[|t| t.chart_bearish, |t| t.warning, |t| t.chart_bullish]), // a fall, any other change, a rise
    Duration::from_secs(1),
);
```

- **What flashes:** when a re-read lands, the table compares the page it replaces with the new one, in the rows invalidated since that page's read started and the columns with a flash only. Rows invalidated while the read was out are compared too (a source that runs its query when it answers already holds their change) and again by the next read, so a change shows whichever read carries it, and only once. A float that rose flashes at the ramp's 1, one that fell at 0; any other change (text, NULL to a value or back, a number to NaN) at 0.5. Two NaNs are equal, as are 0 and −0. A first read flashes nothing, nor does a column without `flash`.
- **How it's drawn:** a quad over the cell's whole box, over its fill and under the jump's edged highlight, its bar, and its text, in the ramp's color, faded by opacity to nothing over the duration; a change during a flash starts it again. While a flash is on screen the table asks for every frame; with none on screen it asks for none, and an off-screen flash simply ends. Under `App::reduce_motion` (which a host sets: the web platform doesn't read `prefers-reduced-motion`), a flash holds its color for the duration with no fade and no frames, and a timer clears it.
- **Its cost:** a comparison per invalidated row and flashing column as each re-read lands, off the frame, and the frames themselves while a flash shows (the Features table). Invalidating a whole table (`invalidate_rows(0..rows)`) compares every wanted page's rows.
- **Probed:** `CellProbe::paint.flash`, the drawn color with its opacity in the alpha. What a DOM implementation must match: [`fixtures/README.md`](fixtures/README.md), `paint.json`'s `flash`.

Keys, while it has focus: ↑/↓ a row, Page Up/Down and Space/Shift+Space a screen, Home/End and Cmd+↑/↓ the ends. Shift+wheel scrolls sideways. The scrollbars are its own: a press on a track jumps there, and a drag loads only once the pointer rests (80 ms).

## Features

| Feature | What it adds | Cost (wasm, brotli) | Measured in |
|---|---|---|---|
| *(base)* | Paging, prefetch, and a page cache; f64-row scrolling with its own scrollbars, wheel, and keys; columns by kind; rounding, middle cuts, and the exact-value tooltip; a jump-to-row highlight | The baseline every feature's cost is read against: the bare host's whole wasm (gpui-kit and `seiza` included) and its work per frame | [The bare host's results](perf/results/) |
| `custom-cells` | A page's paint for a cell: a fill through a color ramp, a bar from a zero point (its own color below zero), a text color, or over a fill the theme's text color that contrasts ("Paint", above) | +3.3 KiB brotli (+10.0 KiB after wasm-opt). Frame work: nothing compiled in but unused; with every visible cell of the wide shape painted, +0.6–0.8 ms a frame (9–12%) at the reference run, no late frames; the text's contrast within the spread | [`perf/results/2026-10-24-m2.md`](perf/results/2026-10-24-m2.md), [`perf/results/2026-10-25-m2-follow-up.md`](perf/results/2026-10-25-m2-follow-up.md) |
| `live` | Rows a host says changed are read again and redrawn in place, no placeholders, one read per page in flight; `Refreshed` marks the frame ("Live rows", above) | +3.1 KiB brotli (+14.1 KiB after wasm-opt, the bare host's feed included). Update → refreshed frame, a source answering from memory: 7.7–8.1 ms p50 at 1k–50k updates/s (p95 ~24: a batch landing just after a frame waits for the next). Under the feed, ~310 ms of main thread a second, no late frames (throttled: ~620 ms/s, ≤1.2% late). Compiled in, feed off: no frame cost | [`perf/results/2026-10-25-m3-d.md`](perf/results/2026-10-25-m3-d.md) |
| `live` + `custom-cells` | A changed cell's flash ("A flash", above) | The flash: ~+10 KiB after wasm-opt over each feature alone (+11.3 KiB brotli for both together). Every visible float flashing at 1k–50k updates/s: ~+50 ms of main thread a second, every frame drawn, no late frames; latency 11–13 ms p50 (a batch waits for the next frame). Throttled (4× CPU), it saturates the main thread: 11–13% late frames, re-reads halved | [`perf/results/2026-10-25-m3-d.md`](perf/results/2026-10-25-m3-d.md) |

What's planned, each off by default: [`PLAN.md`](PLAN.md).

## Limits

- **Read-only.** No editing, selection, sorting, filtering, or column resizing.
- **Fixed column widths** by kind (and the header's length), not by the values: measuring the widest value would cover only the pages loaded, and a column must not widen under the reader.
- **Paging is the delegate's speed.** A frame never waits on data; rows not loaded yet draw as placeholders. A 3 s fling outruns any prefetch (~84% placeholder frames on Tycho's asteroids sample), while steady scrolling shows none.

## Canvas tradeoffs

- **Accessibility:** screen readers see nothing: the canvas has no accessibility tree. *Today:* it scrolls entirely from the keyboard (above). *To close it:* a hidden DOM mirror of the visible rows, kept in step with each frame.
- **Text selection and copy:** cells can't be selected or copied. *To close it:* a selection feature, with copy through the browser's clipboard event.
- **Color alone** (`custom-cells`): a heat map's fill, a bar's length, and a value's color carry meaning that a screen reader can't see either, and that a reader who can't tell the colors apart misses. *Today:* the value's text is always drawn over its paint, so the number is there, and over a fill it takes whichever of the theme's text colors contrasts more (a two-way pick, not a contrast score: a mid-lightness fill can leave either one weak). *To close it:* the DOM mirror above, carrying each cell's paint as text.
- **A flash says "changed" in color and motion alone** (`live` with `custom-cells`): a screen reader hears nothing of it, a reader who can't tell its colors apart can't tell a rise from a fall, and its full color can sit under the text with little contrast (a red flash under dark text). *Today:* the new value is drawn over it; under `App::reduce_motion` it holds still instead of fading. *To close it:* the DOM mirror above, announcing changes in a live region (politely, and batched: at a market watch's rates, every visible row changes every frame).
- **Ctrl+F:** the browser's find can't see the cells. *To close it:* the DOM mirror above, or a find of the table's own that queries the source.

## Docs

| File | What's in it |
|---|---|
| [`CLAUDE.md`](CLAUDE.md) | Rules, architecture, gotchas. |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | Why it's built the way it is, by area. |
| [`fixtures/README.md`](fixtures/README.md) | What another implementation must match: page requests, cell text, page SQL, and a cell's paint. |
| [`PLAN.md`](PLAN.md) | The features to come, in order, and the active milestone. |
| [`perf/results/`](perf/results/) | What the table measures of itself in its bare host (`host/`): the base's bytes and frame work, then each feature's added cost. Budgets are the apps' that build it. |
