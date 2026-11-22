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

- `load_page(rows, cx)`: starts reading `rows` (0-based, end-exclusive); returns a `Request` id and a future of the page (`PageLoad`). An id is never reused for the table's life (a counter): two open reads under one id couldn't be told apart.
- `cancel(request, cx)`: the table no longer wants it. The future must still resolve (`PageError::Cancelled`, or the page if it won the race); the table counts it as in flight until then, since a source may not be able to stop a started read.
- With `sort`, `sort(keys, cx)`; with `find`, `find(query, cx)`: below.

A page (`TallTablePage`) answers `value(row, column)` with a `CellValue` (`Null`, `Float`, `Float32`, or `Text`) and `heap_bytes()` for the cache's budget (with `custom-cells`, `paint`; with `format`, `decimals`, below). A failed page (`PageError::Failed { message, read_failure }`) shows its message in its rows; `read_failure` says the source itself broke, and the table emits `TallTableEvent::ReadFailed`.

**Columns** (`TallTableColumn::new(name, kind)`): the `ColumnKind` sets width and alignment. Integers fit their widest value (`max_chars`) and are never rounded, cut in the middle if still too wide; floats round to the digits that fit; decimals are exact and cut in the middle; booleans, dates, timestamps, and text are left-aligned and cut at the end. A rounded or cut value's exact text is in a tooltip on the hovered cell; it's decided again whenever a page lands on its row (a re-read, with `live`), so it says the value its cell draws, and goes when that value fits or while its row has no page. With `format`, a number column's text is its host's (`TallTableColumn::format`; "Format", below).

**How the cells' text is drawn:** one element a region (the cells, or with `pin` the pinned columns and the scrolled ones) paints every loaded cell's text, every glyph in one layer, cut with GPUI's own "…" and placed on device pixels as a cell's own element would place it. No element a cell, so no layout for the cells and one draw-order search a region, not one a cell: in the bare host a frame that draws text costs a third less at the reference run and about half throttled, against the drawing before in the same session (Apple M1; [`perf/results/2026-11-04-m11-c.md`](perf/results/2026-11-04-m11-c.md)), and the pixels are the same. The header, the gutter's numbers, a loading row's bars, a failed row's message, and the tooltip are still elements.

**`TallTableState`:**

- `jump_to(row, cx)`: scrolls `row` to the top (or as near as the end allows) and highlights it; with `select`, selects it instead (below). The highlight stays until the next jump, a sort, a `replace_rows`, or a shrink past its row.
- `set_rows(rows, cx)`: the same rows grew (rows still loading) or shrank (other rows are `replace_rows`', below); the scrollbar follows and short pages reload. A shrink forgets every page wholly past the new end (a read of one cancelled), so rows that come back are read anew, and what's kept by row at or past the new end goes with it: the jump's highlight, the hover and its tooltip, and with `live` and `custom-cells` the flashes (a `Columns` selection's rows: "Selecting", below). With `live`, a short last page that grows stays drawn, placeholders past the rows it was read with, and is read again as an invalidated page is; its reads are planned at the end of the update, with its invalidations.
- `replace_rows(rows, at, cx)`: every row index means another row now (a filter, a query run again, a grouped result): "Replacing the rows", below.
- `set_columns(columns, cx)`: a column's kind changed (with `sort`, the sort kept while its column keeps its name; with `pin`, the count kept; with `reorder`, the order reset to the list's own: below).
- `follow(cx)`, `is_following()` (`follow`): below.
- `column_width(column)` (`resize`): the width a column is drawn at now.
- `selection()`, `set_selection(selection, cx)`, `selectable()`, `set_selectable(selectable, cx)` (`select`): below.
- `copy(cx)`, `copy_progress()`, `cancel_copy(cx)`, `set_copy_options(options)` (`copy`): below.
- `sort()`, `set_sort(keys, cx)`, `set_sort_icons(icons, cx)` (`sort`): below.
- `set_pinned(columns, cx)`, `pinned()`, `pinned_in_effect()` (`pin`): below.
- `set_density(density, cx)`, `density()` (`density`): below.
- `move_columns(places, to, cx)`, `move_columns_pinned(places, to, pinned, cx)` (with `pin`), `set_order(order, cx)`, `order()` (`reorder`): below.
- `set_ctrl_press_is_context(on)`, `ctrl_press_is_context()` (`clicks`): below.
- `set_column_hidden(index, hidden, cx)`, `set_hidden(hidden, cx)` (`hide`; a column's flag read back from `columns()`, `is_hidden()`): below.
- `set_find(term, cx)`, `find_next(cx)`, `find_previous(cx)`, `find_term()`, `current_match()` (`find`): below.
- `open_popover(cell, cx)`, `close_popover(cx)`, `popover()`, `set_popover_button(button, cx)`, `popover_button()`, `set_popover_cue(cue, cx)`, `popover_cue()`, `set_popover_cells(cells, cx)`, `popover_cells()` (`popover`): below.
- `set_column_icon(index, icon, cx)` (`header-icon`; a column's icon read back from `columns()`, `header_icon()`): below.
- `retry_failed(cx)`: loads failed pages again, after the host repaired the source.
- `close(cx)`: cancels its reads (a copy's too, with no event) and starts no more (a table being replaced); after it, nothing reads or cancels again (a second `close`, `set_rows`, which only moves the scrollbar).
- `stats(now)`: pages loaded, in flight, draining, cache bytes, and, with `with_activity(ActivityOptions)`, rows/s and the share of frames with every visible row loaded.
- `delegate()`, `delegate_mut()`, `rows()`, `visible_rows()`, `columns()`, `focus_handle()`, `has_failed_reads()`.

**Events** (`TallTableEvent`, `#[non_exhaustive]`: each feature adds its own, and Cargo may turn one on for a host that didn't, so a match on it ends in `_ => {}`; so do matches on `ClickKind`, `CellValue`, `PageError`, and `Sign`, and a struct with public fields is read by field and built by its constructor or `Default`, never a literal):

- `Filled { first }`: a frame with every visible row loaded is being drawn, after one that wasn't. It's emitted while that frame renders, so subscribers hear it in the task that presents the frame: a mark set right after that task lands right after the rows are on screen.
- `ReadFailed`: see above.
- `Scrollbar { track, thumb }`: the vertical scrollbar's bounds, when they change, for scripts that drag it.
- `Probe`, `Layout` (with `probe_frames(true)`) and `Cells` (with `probe_cells(true)`): what a frame shows, where the cells are, and every drawn cell's exact and shown text, for scripts on a canvas with no DOM. With `group-headers`, `Groups` too: below.
- `Refreshed { rows, generation }` (`live`): below.
- `Following(bool)` and `TailDrawn { rows }` (`follow`): below.
- `ColumnWidthsChanged(widths)` (`resize`): below.
- `Selected(selection)` (`select`): below.
- `Copy(TallTableCopy)` (`copy`): below.
- `Sorted(keys)` and `SortRefused(keys, refused)` (`sort`): below.
- `Pinned(columns)` (`pin`): below.
- `ColumnsMoved { order, pinned }` (`reorder`; `pinned` with `pin`): below.
- `Clicked(TallTableClick)` (`clicks`): below.
- `ColumnsHidden(hidden)` (`hide`): below.
- `FindStarted` and `Found(FindOutcome)` (`find`): below.
- `Popover(cell)` and `PopoverButton(cell)` (`popover`): below.
- `HeaderIconPressed(HeaderIconPress)` (`header-icon`): below.

**Replacing the rows** (in the base): a filter, a query run again, or a grouped result changes which row every index means. `replace_rows(rows, at, cx)` says so: every page is forgotten and its read cancelled (an answer to one is dropped, whatever it holds), the view lands at `at`, and the new rows' reads start once the update ends. No event of its own: the host made the call.

```rust
// The new source kept aside until its count is known, then swapped and
// replaced in one update: no frame draws between the two.
let filtered = source.filter(predicate);
cx.spawn(async move |this, cx| {
    let rows = filtered.count().await;
    this.update(cx, |table, cx| {
        *table.delegate_mut() = filtered;
        table.replace_rows(rows, ViewAt::Top, cx);
    })
});
```

- **Swap the source in the same update.** Swapped an update earlier, a frame can draw the new source's rows beside pages of the old one. The old rows stay drawn until the call; saying a filter is pending is the host's.
- **The target** (`ViewAt`): `Top`; `Row(r)`, the view's top at row `r` as `jump_to` puts it but with no highlight and no selection (a host keeping the reader's place); `End`, the last rows. `#[non_exhaustive]`.
- **What goes:** the hover and its tooltip, the jump's highlight, with `live` the invalidations (a `Refreshed` awaited for one never comes, since the new rows' first reads emit none: mark the replace's next `Filled` instead) and with `custom-cells` the flashes; with `select` a `Rows` or `Cells` range (`Selected(None)`), while a `Columns` range keeps its columns, its rows at row 0, the named row (clamped to the rows), or the last row, as a shrink moves them; with `copy` a copy running (`Failed(Cancelled)`); with `follow` the drawn tail. `End` leaves following as it was, and the other targets let it go unless every row fits. **What stays:** the sideways scroll, everything held by column (widths, order, pinned count, groups), and the sort.
- **The sort** (`sort`): the new source is told the sort in effect again, once the update ends and before any read. A refusal clears the sort (the source told none) with the view where it landed: `Sorted` with no keys, then `SortRefused`. A later `set_sort` in the same update tells it instead and puts the view at the top. A sort is kept by its column's name, so it may name a same-named column of another result: clear it for a clean slate.
- **New columns:** `set_columns` in the same update, before or after; either order ends the same, a sort whose column is gone cleared once, the view at the target.
- **The count is exact:** a host calls once the count is known. Correcting it with `set_rows` afterwards works, but the scrollbar jumps when it lands.
- **Unlike `DataTable`'s `refresh`,** a selected row's index isn't kept: it would be another row.
- **One plan per update,** for every `replace_rows`, `set_columns`, and `set_sort` in it (with `live`, `set_rows` too; without it, `set_rows` reads at its call, so a count corrected in the same update is read twice over); during a scrollbar drag, once its pointer rests. On a closed table the count and the view follow, and nothing is read, cancelled, or told.

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
- **One plan per update:** an invalidation's reads, and `set_rows`', start at the end of the update that made them, so a batch invalidated row by row, or appended to and invalidated, reads each page once.
- **A short last page that grows is kept:** `set_rows` growing it leaves it drawn with the rows it was read with, placeholders past them (the frame isn't filled until they land), and reads it again as an invalidated page, never cancelled for growing. Prefetch waits for it while its new rows are in view, and `Refreshed` names the rows the read holds. Without `live`, it's forgotten and read anew, its read cancelled. Shrinking forgets it either way. If its re-read fails, the new rows stay placeholders (not the error) until `retry_failed`; if the source refuses it, until the rows grow or change again.
- **A source with the rows in hand lands at once:** a re-read whose future is ready when `load_page` returns (an async block with nothing to wait on, `std::future::ready`) lands in that turn and is drawn on the next frame, with no trip through the executor (on the web, each spawned task waits for a `setTimeout(0)`). So a host that holds the new values answers the re-read from them; there's no separate push call. A read that isn't ready is awaited as any other, and first reads always are.
- **Stale pages nobody wants are dropped:** scrolled back to, the page loads as any other does. A re-read of a page that leaves the wanted pages is cancelled.
- **A failed re-read keeps the old rows drawn,** and is read again at the next invalidation of its rows or `retry_failed`; a `read_failure` still emits `ReadFailed`.
- **`Refreshed`** is emitted in the render of the first frame that draws a re-read page, if its rows are visible then (none for a page re-read off screen, then or when scrolled to), with the generation its read started at: every invalidation up to it is drawn. Like `Filled`, a mark set right after the subscriber's task lands right after that frame. Rows whose page isn't loaded or loading change nothing: their first read reads them as they are, and emits no `Refreshed`.
- **The row count is `set_rows`' job, other rows `replace_rows`':** the same rows with new values and a new count are `set_rows`, then `invalidate_rows(0..rows)`, redrawn in place; a query whose rows are others (a filter) is `replace_rows`, which forgets every page.
- **Patching pages in place isn't a feature:** a host whose pages share storage it changes can call `cx.notify()` on the table, which keeps no cell cache, and needs no feature for it. It gets no flash: the table never sees the old value.

**A flash** (`live` with `custom-cells`): a column can flash the cells a re-read changed, as a market watch's prices do.

```rust
let price = TallTableColumn::new("price", ColumnKind::Float).flash(
    Ramp::new(&[|t| t.chart_bearish, |t| t.warning, |t| t.chart_bullish]), // a fall, any other change, a rise
    Duration::from_secs(1),
);
```

- **What flashes:** when a re-read lands, the table compares the page it replaces with the new one, in the rows invalidated since that page's read started and the columns with a flash only. Rows invalidated while the read was out are compared too (a source that runs its query when it answers already holds their change) and again by the next read, so a change shows whichever read carries it, and only once. A float that rose flashes at the ramp's 1, one that fell at 0; any other change (text, NULL to a value or back, a number to NaN) at 0.5. Two NaNs are equal, as are 0 and −0. A first read flashes nothing, nor does a column without `flash`.
- **How it's drawn:** a quad over the cell's whole box, over its fill and under the jump's edged highlight, its bar, and its text, in the ramp's color, faded by opacity to nothing over the duration; a change during a flash starts it again. While a flash is on screen the table asks for every frame; with none on screen it asks for none, and an off-screen flash simply ends; a flash on a row `set_rows` cut ends with its row. Under `App::reduce_motion` (which a host sets: the web platform doesn't read `prefers-reduced-motion`), a flash holds its color for the duration with no fade and no frames, and a timer clears it.
- **Its cost:** a comparison per invalidated row and flashing column as each re-read lands, off the frame, and the frames themselves while a flash shows (the Features table). Invalidating a whole table (`invalidate_rows(0..rows)`) compares every wanted page's rows.
- **Probed:** `CellProbe::paint.flash`, the drawn color with its opacity in the alpha. What a DOM implementation must match: [`fixtures/README.md`](fixtures/README.md), `paint.json`'s `flash`.

**Following the tail** (`follow`, off by default, which turns on `live`): a log or a growing file, its new rows kept in view as they arrive.

```rust
state.update(cx, |table, cx| table.follow(cx)); // a log view: follow from the start
// As rows arrive, about once a frame:
state.update(cx, |table, cx| table.set_rows(rows, cx));
// A Pause button: stop following, the view where it is, the rows still arriving.
state.update(cx, |table, cx| table.let_go(cx));
// From the subscription:
TallTableEvent::Following(false) => { /* show a "back to the tail" button */ }
TallTableEvent::TailDrawn { rows } => { /* the rows below `rows` are on screen */ }
```

- **The flag:** off at open. A reader who goes to the end turns it on (End, a wheel or a key that ends there, a scrollbar drag released there, `jump_to` landing there) and so does `follow()`; any vertical move away from the end, by any amount, or `jump_to` elsewhere, turns it off, and so does `let_go()`. Sideways scrolling leaves it, and rows arriving or a resize never set it. A scrollbar drag holds the view under the pointer until its release decides. `Following` is emitted once per change.
- **`let_go()` is a host's pause:** following off with the view where it is, as after a scroll up but without the move. Nothing is read or cancelled at the call; rows keep arriving through `set_rows`, the view no longer moves with them, and no `TailDrawn` is emitted. `follow()` (or the reader's End) follows again, the view back at the end. The reader's moves still decide as they do: a scrollbar drag released at the end follows, even one under way when the host let go.
- **The tail pin holds the view to the rows read, not to `rows()`:** while following, its bottom is the last row the table has drawn with its values, and it moves on as each read lands, never back. So the view sits behind `rows()` by the rows not yet read, and no placeholder row is drawn once the first tail read has landed. At `follow()`, before a tail read lands, the view goes to `rows()`, as a jump does. A follow move isn't a scroll: it starts no settle timer and leaves the scroll direction as it was. While following, the visible pages are read bottom first.
- **The tail page grows in place** (`live`'s grown short page, "Live rows", above): its rows stay drawn, and its re-read lands in the turn that asks if the source has the rows in hand, so a batch is usually on screen in the next frame.
- **`TailDrawn { rows }`** is emitted in the render of each frame whose drawn tail grew while following, as `Filled` is: a host that called `set_rows(n)` takes the first at or past `n` as the frame showing them.
- **Batch the appends:** one `set_rows` a frame at most. The table plans `set_rows`' reads once at the end of the update, but each call still moves the scrollbar and the pin.
- **Its cost:** the Features table. Compiled in with nothing growing, it costs nothing a frame.

**Resizing columns** (`resize`, off by default): a band at each column's right edge in the header; drag it to set the column's width, double-click it to fit the column to what's drawn.

```rust
let name = TallTableColumn::new("name", ColumnKind::Text)
    .width(px(240.))          // a width the host kept; without it, the kind's
    .min_width(px(60.))       // 40 px unless set
    .max_width(px(600.))      // 1200 px unless set
    .resizable(true);         // on unless set
// From the subscription, at a release or a fit that changed a width:
TallTableEvent::ColumnWidthsChanged(widths) => { /* keep them, by column name */ }
```

- **The width:** a column's kind's (laid out as without the feature, never clamped) until the host sets one with `width` or a drag or fit does. A set width is clamped to `min_width` and `max_width`, and may be narrower than the header's name, which is then cut. A float column's rounding follows its width: a drag re-rounds its values on the frame that widens it.
- **The drag:** the column's edge follows the pointer from the press, live, clamped; the columns right of it move with it. A column whose kind's width is outside its min or max holds until the pointer brings it inside. The sideways scroll holds still until the release (sideways input is ignored meanwhile), so a narrowing at the right end never slides the columns under the pointer; the release clamps it. Vertical scrolling and paging work as without. The resize cursor holds through the drag; no tooltip shows. Only the left button's release ends it (another button's leaves it on, as every drag of the table's); a press on a band while a drag is still on (its release never seen) ends that drag first, as its release would, with its event.
- **The fit** (a double-click on a band): the column's header name and its visible, loaded rows, clamped. A numeric column fits its widest exact value, so a fitted float shows every digit; any other its widest shown text. Rows not loaded, and rows off screen, aren't counted: the table never asks the source for a widest value.
- **Keeping widths is the host's:** `ColumnWidthsChanged` carries each column's set width (`None` where it's still its kind's) in `columns()`' order, once at a release or a fit, never while a drag moves and never when nothing changed. Give them back through `width` when calling `set_columns` (which replaces the widths with what it's passed, and ends a drag with no event) or in a later session; matching by column name keeps them when the columns change. Reporting only set widths means a width given back never freezes a kind's (an integer column's follows the font). `columns()` returns the widths the drag or fit left.
- **A column the host doesn't want resized:** `resizable(false)`. No band is drawn for it or the row-number gutter.
- **Its cost:** the Features table. The bands are drawn every frame, a resizable column's even when nobody drags: ~0.1 ms a frame.

**Selecting** (`select`, off by default): rows, columns, or a block of cells, by pointer and by key, held as one range.

```rust
use seiza_tall_table::{Selectable, TallTableSelection};

state.update(cx, |table, cx| table.set_selectable(Selectable::all().columns(false), cx)); // rows and cells only
// From the subscription, at every change:
TallTableEvent::Selected(Some(selection)) => {
    let rows = selection.rows(table.rows());               // RangeInclusive<u64>: a status bar's count
    let columns = selection.columns(table.columns().len());
}
TallTableEvent::Selected(None) => { /* cleared */ }
```

- **The model:** one `TallTableSelection`, `Rows`, `Columns`, or `Cells`, from an `anchor` (the active cell, where a plain arrow moves from) to a `head` (where Shift moves), either way round. A range is two cells, so every one of 1.57 M rows selected costs what one row does. `rows()`, `columns()`, and `contains()` read it against the table's size; a `Columns` range covers every row, those that arrive later too.
- **The kinds:** `Selectable` turns rows, columns, and cells on (all on by default; `set_selectable` at run time, which clears a selection of a kind turned off). A press or key takes the smallest kind that's on and holds what it reached: a cell, else its row, else (a key) its column. With none on, the table is as without the feature.
- **The pointer:** a press on a cell selects it, on a row's number its row, on a header its column (a resize band's 9 px resize instead), on the corner every column (every row with columns off). Shift+press moves the head, keeping the anchor and the kind; a drag moves it to the cell under the pointer, clamped at the edges, and a wheel during the drag scrolls the body and the head follows. Cmd+press is a plain press; Ctrl+press and a double-click's second press select nothing, and a right-click selects nothing unless `clicks` is built ("Presses", below).
- **The keys,** while it has focus and a kind is on: an arrow moves the active cell and collapses the range to it; Shift+arrows extend along the range (up and down for rows and cells, left and right for columns and cells); Page Up/Down a screen, Home/End and Cmd+↑/↓ the first and last row, each with Shift to extend; Cmd+A or Ctrl+A every column (every row with columns off, every cell with only cells on); Escape clears, and reaches the host when nothing's selected. The ends stop, never loop. A moved head scrolls into view the least distance, sideways too. The first arrow with nothing selected selects the first visible cell (by kind) without moving. Space and Shift+Space page as without. Shift+End from the first row selects every row, as one range.
- **`jump_to` selects:** the row (rows on), else the cell in the active cell's column (cells on), with `Selected`; the jump's highlight isn't drawn then. With only columns on it highlights as without the feature, and can sit over a selected column's tint.
- **The host's:** `set_selection(Some(…))` sets one without scrolling (clamped to the last row and column; a kind that's off is a debug assertion), and `set_selection(None)` clears. `set_rows` shrinking cuts a `Rows` or `Cells` range (a corner past the end moves to the last row) and clears one wholly past it; a `Columns` range is never cleared (it covers the rows that arrive later too), its anchor's and head's rows moved to the last row (row 0 with none), a header drag in progress left on; `set_columns` clears it, so a host that keeps it across new columns calls `select` after. `Selected` is emitted at each change (a press, a drag's move to a new cell, a key, `set_selection`, `jump_to`, `set_rows`, `set_columns`), never when an input leaves it as it was.
- **Drawn:** the range's visible part as one tint (`table_active`, edged in `table_active_border`) under the text and over a fill, a bar, and a flash, so a heat map stays readable; the selected rows' numbers and columns' headers in the same tint; and the active cell edged 2 px while the table has focus.
- **Copying it** is `copy`'s (below).
- **Its cost:** the Features table. A standing selection is one tint a frame however many rows it spans.

**Copying** (`copy`, off by default, which turns on `select`): the selection to the clipboard as a spreadsheet's tab-separated text of exact values. The table builds the text and reports it in events; the host writes the clipboard (on the web, `tall-table-bridge`'s `clipboard::Clipboard`).

```rust
use seiza_tall_table::{CopyOptions, TallTableCopy};

state.update(cx, |table, cx| table.set_copy_options(CopyOptions::default().headers(true)));
// From the subscription: hand each to the clipboard's writer.
TallTableEvent::Copy(copy) => {
    if let Some(id) = clipboard.event(copy) {
        state.update(cx, |table, cx| table.cancel_copy(cx)); // it can't be written here
    }
    if let TallTableCopy::Declined { rows, columns } = copy { /* ask the reader; `copy` if they confirm */ }
}
// A host's menu, or its confirmation of a declined copy:
state.update(cx, |table, cx| table.copy(cx)); // Option<CopyId>: None with nothing selected
```

- **The keys:** Cmd+C or Ctrl+C copies the selection, while it has focus and a kind is on; with nothing selected the key reaches the host. Past `key_max_cells` cells (rows × columns, 100 k by default) it copies nothing, reads nothing, and emits `Declined`, so a reflex Cmd+C on a select-all costs nothing; a host that asks the reader calls `copy`, which the limit doesn't hold. Escape during a copy cancels it and keeps the selection; the next clears it.
- **What's copied:** a `Cells` block; a `Rows` range's every column; a `Columns` range's every row the table has at the key (rows arriving later aren't copied). Columns in the table's order, no row numbers.
- **The text:** a tab between cells, `\n` between rows, none after the last, so one cell copies as its value alone. Each value's exact text (the tooltip's, `CellValue`'s `Display`), never the rounded or cut text drawn; a value holding a tab, a line break, or a `"` quoted, its quotes doubled; NULL an empty field. With `headers`, the column names (quoted by the same rule) as a first line.
- **The reads:** a page loaded at its turn comes from the cache (with `live`, as drawn); any other is read through `load_page` beside the cache, never cached, ahead of prefetch and never while a visible page is loading. A copy's reads and `live`'s re-reads share at most `max_in_flight − 1` places (at least 1), so a page scrolled into view still finds one. Scrolling and changing the selection don't cancel a copy.
- **The pieces:** the text is formatted between frames, a turn of at most ~16 k cells at a time, each turn's text sent as one `Text` and dropped, so the table never holds the whole copy. A copy whose rows are loaded and that fits one turn emits `Started`, `Text`, and `Copied` in the task that asked.
- **The cap** (`max_bytes`, 64 MiB by default, under WebKit's ~100 MiB limit on a clipboard write): a copy whose separators alone pass it is refused before any read; one whose first page's worth of rows projects past twice the cap is refused there; otherwise it's refused as soon as its text passes the cap, checked a row at a time (`Failed(TooLarge)`, nothing sent after). Never cut short. A copy keeps the cap it started with.
- **Ending:** `Copied`, or `Failed` with its reason: `TooLarge`; `Read` (a read failed; never retried, and with `read_failure` the table's `ReadFailed` too); `Cancelled` (a second copy, `set_columns`, `set_rows` shrinking under its last row, `cancel_copy`, or Escape). A cancelled copy's reads are cancelled through the delegate and drain as the cache's do. `close` ends a copy without an event: a host closing the table tells its writer (`closed`), which rejects the write.
- **The events** (`TallTableEvent::Copy`): `Declined { rows, columns }`; `Started { id, rows, columns }`, in the task that asked (the key's, so a write opened there counts as the reader's gesture); `Text { id, text, rows_done }`, the next piece; `Copied { id, rows, bytes }`; `Failed { id, reason }`. `copying()` reads a running copy's progress.
- **The bridge's write:** at `Started`, `navigator.clipboard.write([new ClipboardItem({'text/plain': promise})])`; each `Text` kept as a JS string; at `Copied`, the promise resolved with a Blob of them (the strings dropped once it's built: the peak is about twice the text, plus the browser's copy); at `Failed`, rejected, the clipboard as it was. Opened at the key, the write lands however long the copy takes (checked at a minute, and with the tab in the background, in Chromium, Firefox, and WebKit). Without `ClipboardItem`, `writeText` at `Copied`, which a browser allows only within ~5 s of the key. Without `navigator.clipboard` (an insecure context), `event` returns the copy at `Started` for the host to cancel, so nothing is read. What became of each copy (`clipboard::Outcome`: declined, copying, writing, written, refused, failed, unavailable) goes on a global the host names and to a callback it gives.
- **The host's:** the write, the progress (`copy_progress`, or each `Text`'s `rows_done`) and the result shown to the reader, a cancel button (`cancel_copy`), asking about a declined copy, and the limits (`set_copy_options`).
- **Its cost:** the Features table. Compiled in with nothing copied, it costs nothing a frame.

**Sorting** (`sort`, off by default): an arrow at the right of each header the host makes sortable; a click sorts the table by that column. The table tells its source the order, and the source reads its pages in it, or refuses.

```rust
use seiza_tall_table::{Sort, SortDirection, SortIcons, SortRefused};

let name = TallTableColumn::new("name", ColumnKind::Text).sortable(true); // off unless set

impl TallTableDelegate for MyRows {
    fn sort(&mut self, keys: &[Sort], cx: &mut App) -> Result<(), SortRefused> {
        // `keys` is the order, the first the most significant; none is the source's own.
        // A source that sorts by one column refuses two: it never drops a key.
        // Start preparing the order (an index, a sorted copy); hold the next reads until it's ready.
        // Or: Err(SortRefused::new("Sorting reads the whole file: 1.5 GB"))
    }
    // load_page, cancel …
}

// A host's menu: the same as a click.
state.update(cx, |table, cx| table.set_sort(vec![Sort::new(2, SortDirection::Descending)], cx))?;
// From the subscription:
TallTableEvent::Sorted(keys) => { /* the rows are read in this order now: a click, set_sort, or set_columns clearing it */ }
TallTableEvent::SortRefused(keys, refused) => { /* a click the source refused: show refused.message */ }
```

- **Sortable is the host's word:** only a column given `sortable(true)` has an arrow, since only the host knows its source can sort it. A table with no sortable column draws and lays out as without the feature.
- **The cycle:** a text column ascending first, every other kind (numbers, dates, timestamps, booleans) descending first, then the other direction, then off (no keys, the source's own order). One column at a time: a click on another column's arrow starts that column's cycle, and the old one's arrow goes back to unsorted. No key sorts; a host's menu calls `set_sort`.
- **The arrow:** `↕` at half the header's text color when the column isn't the sort (full while hovered), `↑` ascending, `↓` descending, as glyphs of the header's face. Or the host's SVGs: `set_sort_icons(Some(SortIcons::new(ascending, descending, unsorted)))`, paths in the host's asset source (gpui-kit's `IconName::SortAscending`, `SortDescending`, and `ChevronsUpDown`, bundled with `icon_assets!`, say), drawn in the same colors and states. Each path is loaded once, when set; if any doesn't load, the glyphs are drawn for all three (and a debug assertion names it), so a missing asset never leaves a blank target. The arrow sits in one fixed box (the widest glyph's advance, at least 14 px) after a 4 px gap, both counted in the column's width by kind and in `resize`'s fit, so a sort or icons change no width. A name that doesn't fit is cut with "…" before the gap; a numeric column's name stays right-aligned, against the arrow. A column too narrow for its padding, the gap, and the box draws no arrow.
- **The click:** the target is the box with 4 px each side, the header's height, ending where `resize`'s band begins; a press there sorts on its release inside it, and selects nothing (`select`'s press is the rest of the header). The pointer cursor over it. An arrow the scrolled columns' left edge would cut (the cells' left, or with `pin` the run's) isn't drawn, since it couldn't be pressed there; one cut at the cells' right edge is.
- **The delegate's `sort`:** from its return, every `load_page` reads `keys`' order (none: the source's own). Ascending or descending by a key's column's values, ties by the next key and then in the source's own order, and NULLs last, both ways: a total order, so pages read apart join up (descending isn't ascending reversed). A row index is a position in the order, so paging, the scrollbar, `jump_to`, and `copy` work unchanged. A source that needs to prepare starts it in `sort` and holds its reads until it's ready; the table draws placeholders meanwhile, and its next `Filled` is the sorted view. Reads out when it's called are cancelled after it returns `Ok`, and their answers are dropped, whichever order they hold. It's called inside the table's update, as `load_page` is. The default refuses every sort and accepts going back to none, so a delegate written without the feature is never wrong under an arrow.
- **Refused:** by the source, nothing changes: a click emits `SortRefused`, `set_sort` returns it. `set_sort` on a column past the end or not sortable, with more than one key, or on a closed table, returns the table's own refusal, the source not told and no event (a debug assertion for the column, a host's mistake; none for the keys, which a host may ask and fall back from).
- **A list of keys, one at most:** the delegate's call, `sort()`, `set_sort`, and both events carry a list (`&[Sort]`, `Vec<Sort>`), so sorting by several columns can be built without changing them. It isn't built: a click sends none or one, `set_sort` refuses two, and no arrow draws a priority.
- **What an accepted sort does:** every page is forgotten and its read cancelled (with `live`, re-reads too, and flashes cleared); the view goes to row 0, the sideways scroll kept (with `follow`, following lets go, unless every row fits); a `Rows` or `Cells` selection is cleared, a `Columns` one kept with its rows moved to the top (`Selected` either way); the jump's highlight, hover, and the tooltip are cleared; a copy running is cancelled (`Failed(Cancelled)`); `Sorted` is emitted; the new order's reads are planned once the update ends. The same sort again re-reads every row.
- **Across `set_columns`:** the sort is kept when the column at its index has the name it had and is still sortable; otherwise it's cleared as `set_sort` with no keys would (the source told). A `Sort` names its column by index, so a host that moves the sorted column in `set_columns`' list sorts again by its new index (`reorder`'s moves change no index, so the sort stays on its column).
- **`set_rows` and `invalidate_rows` under a sort** mean the sorted source's rows and positions: the count, and rows at those positions that changed. A change that moves rows within the order is the host's to settle, with `set_sort` (the same sort re-reads).
- **The host's:** which columns are sortable, the source's order and its preparation, a refusal's message shown to the reader, the icons if it wants its own, and a menu that sorts. `tall-table-bridge` publishes each order on a global the host names (`{column, direction}` or `null`) and as a mark set in the task that sorted.
- **Its cost:** the Features table. The arrows are drawn every frame, a sortable column's even when nothing is sorted: ~0.15 ms a frame for a dozen. A sorted column costs no more a frame than an unsorted one; what a source pays for its order is its own (below, "Limits").

**Pinning columns** (`pin`, off by default): the first columns fixed at the left while the rest scroll sideways under them.

```rust
state.update(cx, |table, cx| table.set_pinned(2, cx)); // the first two; 0 for none
// From the subscription, when the columns pinned in effect change:
TallTableEvent::Pinned(columns) => {
    if columns < table.pinned() { /* the view is too narrow for them all: say so */ }
}
```

- **A count, not a flag per column:** the first *n* columns drawn pin. Pinning a column that isn't first: the host moves it into the run with `set_columns`, or with `reorder` a drag or `move_columns` does ("Moving columns", below).
- **The run in effect** (`pinned_in_effect()`): the count, clamped to the columns, and cut to the leading columns whose right edge is within half the cells' width, so the scrolled columns keep at least half the view. A narrower view pins fewer, a wider one pins them again; `Pinned` reports each change (once at the first frame when a count was set, never at construction). Before the first frame gives the view a width, nothing is pinned in effect. `pinned()` is the count as set, kept across `set_columns`.
- **Drawn:** the pinned columns at their place, the scrolled ones at their place less the sideways scroll, clipped at the run's right edge (none drawn wholly under the run), and a 1 px line in `border` at the edge through the header and body while a column is pinned. The row backgrounds are one layer under both, so a stripe runs across unbroken. The horizontal scrollbar's track starts at the edge. The sideways scroll's range is unchanged: pinning moves no scroll, and at a sideways scroll of 0 every cell is where it is unpinned.
- **With `resize`:** a pinned column's band drags as any other, moving the edge and the scrolled columns with it; its width stops where the run would pass half the cells' width (or at its `max_width`, the lesser), so a release unpins nothing. The run is held through a drag and computed again at the release. A scrolled column's band under the run isn't drawn.
- **With `select`:** a press left of the edge is on a pinned column, right of it on a scrolled one; a drag reaches across. A range across the edge draws in two pieces, each edged, and spans the scrolled columns under the run too. A key move to a scrolled column brings it into view right of the edge; to a pinned one it scrolls nothing sideways.
- **With `sort`:** a pinned column's arrow draws and clicks as any other; a scrolled column's isn't drawn while under the run. `copy`, `live`, and `follow` work unchanged.
- **The host's:** the count (a menu: "Pin first column"), moving a column into the run, and saying why fewer pin when `Pinned` reports it. `tall-table-bridge` publishes the run in effect on a global the host names, and the layout probe carries it (`pinned`: column `c`'s left edge is `left + x`, less `scroll_x` only when `c >= pinned`).
- **Its cost:** the Features table. The second region and the edge line cost a few hundredths of a millisecond a frame; built with nothing pinned, nothing.

**Density** (`density`, off by default): a row height and a text size a host sets together, the table's other lengths following them, and a column's width set without `resize`.

```rust
use seiza_tall_table::Density;

// The wide sheet's dense stop: 18 px rows, 11 px text.
state.update(cx, |table, cx| table.set_density(Density::new(px(18.), px(11.)), cx));
// A column's width without `resize` (clamped, never scaled by the text):
let day = TallTableColumn::new("d001", ColumnKind::Float).width(px(56.));
```

- **Two numbers and a width, no presets:** `Density::default()` is the base's (30 px rows, `rems(0.875)` text), and a table built with the feature at the default lays out and draws as the base does. Compact, comfortable, or a dial's stops are the host's to name.
- **What follows the row height:** the rows in view (`set_density` fits them at once, the top row kept, or while following the tail, as a resize keeps them), the header's height, the gutter's rows, the wheel's line, every hit test (hover, the tooltip, `select`'s presses and drag), the jump's tint, `select`'s tint and active cell, `sort`'s arrow box and `resize`'s bands (the header's height), and `custom-cells`' bar inset (a fifth of the row).
- **What follows the text size,** by its scale over the default's in its own unit (a `px` text over 14 px, a `rems` text over 0.875 rem), rounded to whole px: the cells' padding (8 px a side at the default), each kind's width, the header name's and the gutter's estimates, a column's least width unless set (40 px at the default), and from the font at the size the digits' advance, an integer column's fit, a float's rounding, `sort`'s arrow room, `resize`'s fit, and the tooltip's test of a cut value. The header's text is the cells'.
- **What follows neither:** a set width (`TallTableColumn::width`, the host's number), and the tooltip's text (the theme's size).
- **The clamp,** where the font is read (the first frame, or a rem size that moved): the text at least 6 px, the row at least the text. `density()` returns what was set; the layout probe's `row_height` is what's drawn. Nothing clamps further: a row the height of its text clips the glyphs' descenders.
- **A set width without `resize`:** clamped to the least (40 px, scaled with the text) and 1,200 px, no event. With `resize`, a width is clamped to the column's `min_width` and `max_width` as before; the least unless a column sets its own scales.
- **The host's:** the numbers (a menu, a dial), widths kept across queries, and saying that a `px` density doesn't follow a page zoom (below, "Canvas tradeoffs"). `tall-table-bridge` needs nothing new: the layout probe carries the row in effect and each column's width.
- **Its cost:** the Features table. The code costs nothing a frame; a denser setting costs the cells it puts on screen: ~14 µs a frame for each, and in the bare host the reference run holds the display's rate to ~460 cells (the base shows ~310), loses it scrolling down between ~660 and ~840, and scrolls sideways at the rate to 1,130.

**Format** (`format`, off by default): a number column's shown text set by its host: fixed decimals, a sign on a rise, grouping, and a suffix, as a trading screen writes `84.21`, `9.420`, `+0.37`, `+1.23%`, `4,400,000`.

```rust
use seiza_tall_table::{NumberFormat, Sign};

let last = TallTableColumn::new("last", ColumnKind::Float).format(NumberFormat::new().decimals(2));
let change_pct = TallTableColumn::new("change_pct", ColumnKind::Float)
    .format(NumberFormat::new().decimals(2).sign(Sign::Always).suffix("%"));
let volume = TallTableColumn::new("volume", ColumnKind::Integer { max_chars: 12 }).format(NumberFormat::new().grouping(true));

// A cell's own decimals (a sub-10 price at 3), `None` for its column's:
impl TallTablePage for MyPage {
    fn decimals(&self, row: usize, _column: usize) -> Option<u8> { self.decimals.get(row).copied() }
    // …
}
```

- **A format** (`NumberFormat`, built from `new()`): `decimals` (fixed, trailing zeros kept; a float's only; without them a float's text is its exact text), `sign` (`Sign::Negative`, the default, or `Sign::Always`: a `+` on a positive), `grouping` (a `,` every three whole digits), and `suffix` (any text, written after the number; it scales nothing: a percentage is the source's value). A text, boolean, or date column ignores it; a column without one draws as the base.
- **The text:** a float rounds its exact binary value half to even at its decimals (Rust's `{:.N}`: `1.125` at 2 is `1.12`, `0.005` is `0.01`, unlike JavaScript's `toFixed` and `Intl`). The sign is the raw value's, so a tiny rise is `+0.00%` and a tiny fall `-0.00`; an exact zero (`-0.0` too) has none. Grouping applies to a plain text, never an exponent. An integer's or decimal's text (the source's `CellValue::Text`) keeps its digits as written and gets the sign, grouping, and suffix; a text whose digits are all zero has no sign, a written minus dropped. NULL, NaN, the infinities, a value of another kind than its column's, and a text that isn't a plain number draw as the base.
- **A page's decimals:** `TallTablePage::decimals(row, column)` overrides the column's count for a cell (`None` keeps it), asked only of a drawn loaded cell of a formatted float column, each frame, as `paint` is, and of the tooltip's and `resize`'s fit's cells.
- **The fit:** a formatted text is drawn, whole, when its characters' advances (the cells' font at the size in effect, read once per font and size; the suffix shaped once a column) sum to at most the cell's width less its padding and a pixel. Otherwise the cell falls back to the automatic format: a float rounded to the digits its column holds, an integer or decimal cut in the middle, as without the feature. A narrow column shows the automatic format rather than a cut formatted text.
- **The tooltip** opens for a formatted cell whose number reads back as another value than the cell's (rounded: `1.125` drawn `1.12`), for a fallback that's rounded or cut as the base's does, and never for a cell only dressed (`9.420`, `+0.37`, `4,400,000`). Its text, the copy's (`copy`), and the sort (`sort`) stay the exact value.
- **With `resize`:** a double-click fits a formatted column to its widest visible loaded formatted text by the same advances (even where a cell falls back now), plus the padding and the pixel, rounded up, so the widest fits after.
- **The host's:** each column's format, and a page's decimals where they differ by row. `tall-table-bridge` needs nothing new; the layout probe carries the advances the fit sums (`advances`, each character a format writes at the text in effect), for a script or a DOM side to match.
- **Probed:** `CellProbe::shown` is the text drawn, formatted or fallen back. What a DOM implementation must match: [`fixtures/cells.json`](fixtures/cells.json), `format` (the advances, from Chromium, and the cases).
- **Its cost:** the Features table. Formatted, a frame costs no more than the base's, and less where the format writes fewer characters than the automatic format would.

**Moving columns** (`reorder`, off by default): a header dragged to another place moves its column, or with `select` a selected range of columns. The table keeps the order, so a move reads no page.

```rust
let id = TallTableColumn::new("id", ColumnKind::Integer { max_chars: 20 }).movable(false); // on unless set

// A host's menu: the columns at places 3..5 to place 0, or a whole order.
state.update(cx, |table, cx| table.move_columns(3..5, 0, cx));
state.update(cx, |table, cx| table.set_order(saved_order, cx)); // order[place] = the index drawn there
// From the subscription, at every change of the order:
TallTableEvent::ColumnsMoved { order, pinned } => { /* keep it (and, with pin, the count after) */ }
```

- **Places and indices:** a column's *index* is its place in `set_columns`' list, which a page reads it by; its *place* is where it's drawn, 0 at the left. `order()[place]` is the index drawn there; without a move they're equal. By place: `select`'s ranges, keys, and `Selected`; `pin`'s count; `copy`'s column order; the cell probe. By index: a page's `value`, `paint`, and `decimals`; `live`'s flashes; `Sort::column` and the delegate's `sort`; `ColumnWidthsChanged`'s order and `column_width`; `columns()`. The layout probe lists the columns in drawn order, each with its `index`.
- **The gesture:** a press on a movable column's header (not `resize`'s band or `sort`'s arrow) that moves past 2 px drags it: its header lifted under the pointer, a 2 px line at the gap through the header and body, the closed hand. The gap is the one after the last visible column whose center is left of the pointer, at any height in the window (`DataTable`'s rule), and a wheel during the drag scrolls sideways with the gap following. The release moves the column there; a release beside where it started moves nothing, and Escape cancels. No hover or tooltip during a drag. A press that never passes 2 px is a press as without the feature.
- **With `select`:** while the `Columns` kind is on, only a press inside the selected columns drags, and it moves the whole range (every column in it movable, or no drag), as Google Sheets does; a press elsewhere selects as before, its drag extending the selection, and a press inside the range released without moving selects that column alone. Shift and Cmd presses never move. A move maps a `Columns` or `Cells` range column by column and keeps it while its columns are still side by side (`Selected` with the new places), else clears it; a `Rows` range is kept as it was, its active cell's place included. `set_order` clears a `Columns` or `Cells` range.
- **With `pin`:** a column dragged into the run pins and one dragged out unpins, the count changing by the columns that crossed (`Pinned` if the run in effect changes); at the run's end, the place both sides share, the pointer's side of the edge says which, so a column beside the edge pins or unpins without moving. `move_columns` keeps the block's first column's side there; `move_columns_pinned` takes it as an argument. `set_order` keeps the count as a count of places: a host restoring an order with its pins calls `set_pinned` after, with the count `ColumnsMoved` gave it.
- **With `sort`, `resize`, `live`, `copy`:** the sort, a column's width, a flash, and a drag of a band stay with their column, the delegate told nothing; a copy running keeps the columns it started with, in that order, and one started after writes the drawn order.
- **The host's:** keeping the order (`ColumnsMoved` carries it, and with `pin` the count) and giving it back with `set_order` after `set_columns`, which resets it to the list's own (with `ColumnsMoved` when another was in effect); a menu that moves columns; which columns don't move (`movable(false)`: others still move around it, and the host's calls move it). `tall-table-bridge` publishes each order on a global the host names.
- **Its cost:** the Features table. Built, a frame costs what the base's does in any order (an order that puts more columns on screen costs their cells); the drag costs what `resize`'s does a frame, and redraws only when the preview or the gap moves.

**Presses** (`clicks`, off by default): every press on the table reported with its kind, what it's on, and where, whether or not the selection changed, for a host's menu, a detail view, or a camera flown to a row. The table draws no menu.

```rust
use gpui_kit::component::menu::ContextMenuExt as _;
use seiza_tall_table::{ClickKind, ClickTarget, TallTableClick};

// From the subscription:
TallTableEvent::Clicked(TallTableClick { kind, target, position, modifiers }) => match (kind, target) {
    (ClickKind::Press, ClickTarget::Cell { row, .. }) => { /* every press, the same row again too */ }
    (ClickKind::Double, ClickTarget::Row(row)) => { /* open the row's detail */ }
    (ClickKind::Context, target) => { /* remember the target (and, with select, read selection()) for the menu */ }
    _ => {}
}

// In render: the host's menu round the table, built from what the last context press was on.
div().id("table").size_full().child(TallTable::new(&state)).context_menu(move |menu, window, cx| { /* … */ menu })
```

- **The kinds:** `Context` is the right button's press, a touch's long press (at its start), or, with `set_ctrl_press_is_context(true)`, a left press with Ctrl. Every other left press is counted by the table: the first `Press`, the second within the browser's double-click (400 ms and 5 px) a `Double`, a third and after nothing. So a `Double` always follows a `Press` on its target, and a host that only wants presses ignores `Double`s. The table counts left presses itself, since gpui's count counts every button's: a left press after a right one is a `Press`.
- **The targets** (`ClickTarget`, `#[non_exhaustive]`): `Cell { row, column }`, `Row(row)` (its number, in the gutter), `Column(column)` (a header), `Corner` (the header over the gutter), `Blank` (the header row or the body where none of those is: below the last row, past the last column), and with `group-headers` `Group { level, start, end }` ("Header groups", below). A column is its place, where it's drawn; with `reorder`, `order()[place]` is its index ("Moving columns", above). `position` is the pointer's in window coordinates, and `modifiers` as pressed.
- **What reports nothing:** the scrollbars, `resize`'s bands, and `sort`'s arrows. Their left presses work as without the feature (a band's double press still fits its column), and a right press or a long press on them is stopped, so a host's menu round the table doesn't open over them.
- **A menu:** hang it on gpui-kit's `ContextMenuExt` round the table. It opens on a right press and a long press after the table's handler (the table never stops a right press it reports), so the `Clicked` it follows has already said what the menu is for; during a drag the table stops both, so no menu opens over it. Or open one of the host's own at `position`. Nothing reported asks for a frame.
- **Ctrl+click** (`set_ctrl_press_is_context`, off by default): in a Mac browser it's the reader's right-click, but the browser sends it as a left press with Ctrl, which `ContextMenuExt` doesn't open on. A host in a Mac browser turns the setting on, and then opens its menu at `position` itself; elsewhere Ctrl+click is the host's to give a meaning, so off it's a `Press` whose modifiers say Ctrl (and `select` ignores it, as without the feature).
- **With `select`:** a press and a double press select as without the feature, and `Clicked` comes after the `Selected` it caused, so `selection()` in the handler is the press's result. The exception is `reorder`'s: a press inside the selected columns reports `Press` with the range still selected, and selects its column at a release that didn't drag. A context press inside the selection keeps it (a `Cell` the range covers, a `Row` under a `Rows` range, a `Column` under a `Columns` range, the `Corner` under any), as Google Sheets does; elsewhere it selects its target as a plain press would (Shift doesn't extend, and the corner selects every column) and starts no drag; on a `Blank` it changes nothing. Either way `selection()` is what the menu acts on.
- **During a drag** (`select`'s, `reorder`'s, `resize`'s, or a scrollbar's), a context press does nothing and reaches no host's menu (the table stops the right press and the long press), and another button's release leaves the drag on: only the left button's ends one. In a browser only a long press can come then: a second button pressed while the left is held arrives as a pointer move, never a press. A press that starts a drag is reported at its press.
- **Focus and the tooltip:** a context press focuses the table and hides the tooltip, as a left press does.
- **The host's:** the menu and what's in it, the detail view, and (in a Mac browser) `set_ctrl_press_is_context`. `tall-table-bridge` publishes each press on a global the host names.
- **Its cost:** the Features table. Built, a frame costs what the base's does: the listeners do nothing until a press.

**Header groups** (`group-headers`, off by default): rows over the header naming groups of columns, any number of levels deep, from a label path on each column. A group follows its columns through a move, and the table's own drags keep it whole.

```rust
let columns = vec![
    TallTableColumn::new("a", ColumnKind::Float).group(["Orbit", "Shape"]),
    TallTableColumn::new("e", ColumnKind::Float).group(["Orbit", "Shape"]),
    TallTableColumn::new("i", ColumnKind::Float).group(["Orbit", "Tilt"]),
    TallTableColumn::new("H", ColumnKind::Float).group(["Size"]),
    TallTableColumn::new("name", ColumnKind::Text), // in no group
];
```

- **The runs:** a path is outermost first. At level *i*, neighbors in drawn order whose paths both reach *i* and agree through it share one cell, a run. A path travels with its column (by index, as every column setting does), so a move never changes a column's group; a run a host's `move_columns` or `set_order` splits is drawn as two. `group_path()` reads a column's path back.
- **The header:** one row per level of the deepest path, plus the names, always the bottom row; each the row height in effect (`density`'s too). With no paths it's one row, as without the feature. A shorter path leaves a blank under its last group, which presses as its column's header. The corner is the header's full height, and the body gets what's left: a deeper path shows fewer rows.
- **A group's cell:** its run's columns at their widths, cut to the view, its label at the visible part's left (kept in view as the table scrolls sideways), truncated to it. With `pin`, a run across the edge draws a cell in each region, each labeled; it's still one group to a press, a selection, and a move. With `select`, a cell takes the tint when all its columns are selected. `sort`'s arrows and `resize`'s bands stay on the names' row; a group has neither.
- **With `select`:** a press on a group's cell selects its columns (a `Columns` range; nothing with the kind off); a Shift+press extends to the group's far edge from the anchor; a drag from it extends nothing.
- **With `reorder`:** a group's cell dragged past 2 px moves the group whole (with `select`, the press has selected it, so the selection moves too). A column, or a selected block, moves only among its parent's children (the deepest group holding all of it and more): the gaps are the boundaries between the parent's groups and ungrouped columns, by their centers, and a pointer past the parent holds at its edge. A selected block that cuts a group doesn't lift, and its press acts as a press. With `pin`, a group crosses the edge whole, and one the host's count split lands wholly on one side, so a drag mends a split and never makes one.
- **With `clicks`:** `ClickTarget::Group { level, start, end }`, level 0 at the top and the run's places `start..end`, the whole run from either half of a split cell. A context press on a group inside the selected `Columns` range keeps the range; elsewhere it selects the group.
- **With `copy`:** the header line is the names alone, no group rows.
- **Probed:** the layout's `header_rows`, and `TallTableEvent::Groups(Vec<GroupProbe>)`, the group cells drawn (level, label, the run's places, region, the visible part's left and width, the label's x), sent when they change, a sideways scroll among the causes. What a DOM implementation must match: [`fixtures/group-headers.json`](fixtures/group-headers.json).
- **The host's:** the paths, and keeping its own `move_columns` and `set_order` from splitting a group, if it cares. `tall-table-bridge` publishes the group cells and a `Group` click on the globals the host names.
- **Its cost:** the Features table. Built, a frame costs what the base's does; grouped, the header's rows cost about what the body rows they take would, and a group dragged costs what a column does.

**Hiding columns** (`hide`, off by default): a column hidden by its host keeps its place and its index, laid out at no width, drawn nowhere and hit nowhere, and comes back where it was, its width, sort, and group kept. The table draws no column chooser: that's the host's.

```rust
// At open, or in a new list: the host keeps the flags by name.
let columns = vec![
    TallTableColumn::new("spkid", ColumnKind::Integer { max_chars: 8 }),
    TallTableColumn::new("name", ColumnKind::Text).hidden(true),
];

// Later, from the host's menu, or a saved view given back:
state.update(cx, |table, cx| table.set_column_hidden(1, false, cx));
state.update(cx, |table, cx| table.set_hidden(saved_flags, cx));

// From the subscription: every flag by index, to keep by name.
TallTableEvent::ColumnsHidden(hidden) => { /* … */ }
```

- **A place at no width:** a hidden column is laid out at width 0 at the right edge of the shown column before it, so every place and every index stays what it was: a selection's ranges, `pin`'s count, `clicks`' targets, `reorder`'s block, and the group runs hold through a hide and a show. Nothing of it is drawn (its header, cells, border, `sort`'s arrow, `resize`'s band) and nothing hits it (the hover, the tooltip, a press). The content narrows to the shown columns, and the sideways scroll is clamped as at a resize. Every column may be hidden: the row numbers are drawn, the cells area empty.
- **Its flag is the column's,** by index, as every column setting is: it follows its column through `reorder`'s moves. `set_columns` takes the new columns' flags (`TallTableColumn::hidden`, `is_hidden`), with no event, as widths: a host keeps them by name. `set_column_hidden(index, hidden)` and `set_hidden(Vec<bool>)` change them later; `ColumnsHidden(Vec<bool>)` reports every flag by index, once a call that changed one, none for a call that changed nothing. `set_hidden` with a list of another length (a view saved before the columns changed) changes nothing, quietly.
- **What a hide or a show ends:** a held `reorder` drag is canceled, and `sort`'s pressed arrow on a column now hidden forgotten; a held `resize` drag ends as its release would, its width reported; a selection with nothing left shown clears (below). Nothing is read: every page holds every column.
- **With `pin`:** the count is of places, a hidden column among the *n*: `set_pinned(3)` with column 1 hidden pins columns 0–2 and shows two. The half-view cap sums widths, so a hidden one costs it nothing, and a hide or a show that changes the run emits `Pinned`.
- **With `select`:** a range still showing a column keeps it through a hide, its tint drawn across the gap as one; a `Rows` range stays whatever is hidden. A `Columns` or `Cells` range left with no shown column clears (`Selected(None)`, after `ColumnsHidden`), and a show doesn't bring it back; `set_selection` over hidden columns alone clears too. The arrow keys and Shift+arrows step to the next shown column that way, or stay; a plain key or `jump_to` from a hidden active cell lands on the nearest shown column, right first; a sideways scroll brings only a shown column into view, and the active cell's outline isn't drawn over a hidden one. Past a hidden last column, a drag's head lands on the last shown one; with every column hidden, nothing is selectable, whichever kinds are on: a press and a jump select nothing, the keys scroll as with nothing selected, and a `Rows` range kept stays where it is and copies nothing.
- **With `copy`:** the shown columns only, the header line too. The key's cap, `Declined`'s `columns`, and the least size (`TooLarge`) count the shown ones; `Started`'s `columns` is still the range of places, hidden ones in it not written. A selection of hidden columns alone is cleared (`select`, above), so there's none to copy; a `Rows` range with every column hidden copies nothing (`copy` gives `None`, and Cmd+C goes on to the host). A copy keeps the columns it started with.
- **With `reorder`:** a drag's gap is found among the shown columns: a drop between shown A and B with hidden H between lands after A (A, X, H, B). A dragged block carries the hidden places inside it.
- **With `group-headers`:** a group's cell spans its shown columns; a group with every column hidden draws no cell and takes no press. A press on a group selects its whole run, hidden places in it.
- **With `sort`:** a hidden sorted column keeps the sort, and no arrow says so (Limits).
- **Probed:** each layout column's `hidden` (laid out at width 0, so a script knows where it sits). What a DOM implementation must match: each fixture's `hidden` cases ([`fixtures/README.md`](fixtures/README.md)).
- **The host's:** the chooser that hides and shows, and the flags kept by name across `set_columns`. `tall-table-bridge` publishes the flags on a global the host names.
- **Its cost:** the Features table. A frame tests one more width a visible column, and a hidden column draws nothing.

**Finding** (`find`, off by default): a term the host sets is highlighted in the cells drawn, and the host's bar steps to the next or previous match, which the source finds in every row, loaded or not; the current match is brought into view and marked apart. The table draws no bar and binds no key: the host's bar takes the term, Ctrl/Cmd+F, Enter, Shift+Enter, and Escape.

```rust
// The host's bar: the term as it's typed, Enter and Shift+Enter.
state.update(cx, |table, cx| table.set_find(Some(term.into()), cx));
state.update(cx, |table, cx| table.find_next(cx));
state.update(cx, |table, cx| table.find_previous(cx));
state.update(cx, |table, cx| table.set_find(None, cx)); // Escape

// The delegate finds, a window of rows at a time:
fn find(&mut self, query: &FindQuery, cx: &mut App) -> Option<(Self::Request, FindLoad)> {
    // The first cell of `query.cells(rows)` whose exact text `query.matches`.
}

// From the subscription:
TallTableEvent::FindStarted => { /* the bar shows it pending */ }
TallTableEvent::Found(FindOutcome::Match { cell, wrapped }) => { /* … */ }
TallTableEvent::Found(FindOutcome::NoMatch) => { /* "No matches" */ }
```

- **The match:** a cell's exact text (what the tooltip shows and `copy` writes: a float's shortest round-trip text, a source's text as it gave it) contains the term, both lowercased (`str::to_lowercase`, a final sigma `ς` taken as `σ`, as a SQL `lower` writes it). No NULL matches; an empty term is no find. No regular expressions, no whole words, no match case.
- **The columns:** every shown one (`hide`: a hidden column isn't searched), numbers as their exact text, as the browser's Ctrl+F finds a number, in their drawn order (`reorder`).
- **The source finds, the table draws:** the delegate's `find(query, cx)` answers the first matching cell in the query's order (along each row in drawn order, then down; backward, the reverse), strictly after `after` and up to `until`, or none; a row past the table's (a tail that grew during the scan) is taken as none to the end. `FindQuery::cells(rows)` walks that order and `FindQuery::matches` is the rule, for a source over rows in memory; a SQL source writes it as a `CAST(… AS VARCHAR)`'s `lower` containing the term's (`FindQuery::term()`; the query's other fields are public). It's a read like `load_page`: its request from the same ids, cancelled through the same `cancel`, its load still resolving after a cancel (an answer then is dropped); `None` refuses (the default: `Found(Refused)`). It isn't counted in `max_in_flight`, and one is out at a time. A long scan should run in windows, checking for a cancel between them, so page reads go between and a new term stops it.
- **A step:** `find_next` (or `find_previous`) emits `FindStarted`, asks the source, and emits `Found` once: `Match { cell, wrapped }`, `NoMatch`, `Refused`, `Failed(message)`, or `Cancelled`. It starts after whichever was set last of the current match and, with `select`, the selection (its active cell; a `Rows` range from its first row's first cell forward and its last row's last cell backward, whichever way it was dragged; a `Columns` range doesn't count), the other if that one's no start (a match in a column the table has no place for); with neither, the view's top row, from its first cell. A landing's own selection counts as the match. After a new term, a landing's cell still selected is searched from, not after, so a narrowed term that still matches it finds it again, unwrapped. A start on a column hidden since is taken at the nearest shown cell before it (after it, backward). With nothing to the end, a second ask from the other end up to the start cell, inclusive (`wrapped`), so a lone match is found again; none from the first row's start, which searched every row. A step while one is out, with no term, or on a closed table is ignored.
- **The landing:** the match becomes the current match. A row fully in view doesn't scroll; one out of view goes to the top, as `jump_to` puts it (clamped at the end), and its column comes into view sideways unless it's pinned (`pin`). With `select`, the found cell is selected (with cells on; its row with rows only), so the keys and a copy go on from it; a `Columns`-only selection is left. The jump's highlight isn't set. With `follow`, following goes as at a jump.
- **What cancels it:** a new term (`set_find`, which forgets the current match too), a sort, `replace_rows`, and `set_columns` (each forgetting the current match: its index means another cell now), a `set_rows` that shrinks the rows (forgetting a current match it cuts; a grow keeps both), a move (`reorder`) and a hide or a show (`hide`), which keep the current match by index, and `close`. Each emits `Found(Cancelled)` (`close`'s once its update ends). `live`'s invalidation cancels nothing: the highlight follows the new text.
- **What's drawn:** in each drawn cell that matches, each occurrence of the term in its drawn text (after a format and the cut) is tinted, in the theme's `selection` at saturation 0.1 (gpui-kit's editor search's); a matching cell whose drawn text doesn't show the term (rounded, formatted, past the "…") is tinted whole, so every match on screen shows. The current match's ranges (or its whole cell) are in `selection`, and it's edged in `ring`, whether or not its text still matches (the source found it; `live` may have changed it since); a hidden current match isn't drawn. Over `select`'s tint, so a match inside a selection shows; under the text. A cell not loaded draws nothing.
- **The two texts:** the source decides which cell is next, the table which drawn cells are tinted, by the same rule. They can differ where a source writes a value otherwise: DuckDB's `CAST` writes `1e+300` and `1e-07` where the table's exact text is `1e300` and `1e-7`, and lowercases a few characters differently (`İ`). The found cell is the current match either way.
- **Probed:** the probe's `find` (the term, the current match, whether a step is out), each drawn cell's `found` (its ranges in its drawn text, or the cell) and `current`. What a DOM implementation and a source's SQL must match: [`fixtures/find.json`](fixtures/find.json).
- **The host's:** the bar, its keys, and a count of matches if it shows one (a whole scan: the table never counts). `tall-table-bridge` publishes each step's outcome on a global the host names.
- **Its cost:** the Features table. A frame with a term set tests each drawn loaded cell's exact text, which costs nothing measurable; the tints cost what's drawn, ~0.25 ms a frame with every cell on screen tinted. A step costs what the source's scan does (Limits), and the table draws the match in the next frame or the one after.

**The cell popover** (`popover`, off by default): a cell's exact text in full, in a popover below it, wrapped and scrolled inside, the row height unchanged; opened by Enter on the active cell, a cue on the cell, or the host; with a button the host labels, whose press the host turns into its own view of the row (a detail panel, a dialog).

```rust
// At open: the button, in the host's words (none by default).
state.update(cx, |table, cx| table.set_popover_button(Some(PopoverButton::label("Open row")), cx));

// From the host's own gesture (a double press, say):
state.update(cx, |table, cx| table.open_popover(PopoverCell::new(row, column), cx));

// Its three settings, each its own and off by default ("Its settings", below):
state.update(cx, |table, cx| {
    table.set_popover_cells(PopoverCells::CutText, cx);
    table.set_popover_cue(Some(PopoverCue::icon(down).open_icon(up).fade()), cx);
    table.set_popover_button(Some(PopoverButton::label("Open row").fill()), cx);
});

// From the subscription:
TallTableEvent::Popover(cell) => { /* opened on a cell, moved, or closed (None) */ }
TallTableEvent::PopoverButton(cell) => { /* the host's view of cell.row */ }
```

- **The text:** the cell's exact text (`CellValue`'s, what the tooltip shows and `copy` writes, never a format's), wrapped, its line breaks as lines (the cell's `¶`); a NULL as the cell's muted `NULL`; past 10,000 characters, "…" (Limits). The cells' font, at `density`'s size. Selectable: a drag selects part of it, and Cmd+C (or Ctrl+C) copies the part, before `copy`'s key; with nothing selected in it, Cmd+C goes on to `copy`'s.
- **Opening:** Enter on `select`'s active cell (a `Cells` selection; otherwise Enter goes on to the host), a press on the cue, or `open_popover`, which refuses (`false`) a cell out of view, on a hidden column, or whose page isn't loaded. A cell is by row and column index (`PopoverCell`), so it names the same column after a move. Opening lets go of `follow`.
- **The cue:** drawn inside the right end of the hovered cell and of `select`'s active cell, when the popover would show more than the cell (a rounded, cut, or multi-line value: the tooltip's rule) or a button is set (then on every loaded cell). Its mark takes the place of the cell's "…", the cut kept, so nothing moves; with no "…" to give, the text ends short of it. Its press opens the popover there (on the open popover's own cell, closes it) and isn't `select`'s or `clicks`'. `set_popover_cue`: `PopoverCue::expand()` (the default: an expand mark in `muted_foreground`, a placeholder for a designed one), `PopoverCue::icon(path)` (an SVG from the host's assets), `PopoverCue::custom(build)` (the host's element), or `None`.
- **Closing:** Escape (before `select`'s and `reorder`'s, going on with none open); Enter with no button; a press outside it, which goes on to do what it does (a cue's press on another cell moves it there); `close_popover`; `select`'s keys moving the active cell; its cell leaving the view (scrolled out, sideways, or behind `pin`'s run); a sort, `replace_rows`, `set_columns`, a `set_rows` cutting its row, a hide of its column, and `close`. A move (`reorder`) keeps it. `live`'s re-read of its row changes its text when the page lands, its scroll kept.
- **The button:** `set_popover_button`: `PopoverButton::label(text)` (gpui-kit's small ghost button, the host's words: the table holds no app string), `PopoverButton::custom(build)` (the host's element, the table its press target), or `None` (the default: no button). A press, or Enter on the open popover, emits `PopoverButton(cell)` and closes it.
- **Placed and drawn:** below its cell, left edges aligned, flipped above at the window's bottom and kept 8 px inside its sides (gpui-base's `Positioner`), from the cell's bounds each frame, so it follows its cell through a scroll until the cell leaves; at most the cell's width or 400 px, whichever is wider, and 75% of the window wide, 50% of it tall, its text scrolled inside past that (a wheel over it scrolls it, not the table). The popover surface's colors (gpui-kit's `popover`, `popover_foreground`, `border`) and `shadow_lg`, at `POPUP_PRIORITY`; no tooltip shows while it's open. It doesn't take focus: the keys stay the table's.
- **Its settings,** three, each off by default and independent; with none set the popover is as above:
  - **Which cells:** `set_popover_cells(PopoverCells::CutText)` keeps the table's own openers, the cue and Enter, to a cut text: a `ColumnKind::Text` column's cell, not NULL, whose shown text is wider than the box its cell cuts it to (so exactly where the cell draws a "…") or whose value holds a line break, a button set or not. A number, a date, a timestamp, a boolean, and a NULL get no cue, cut or not, and Enter on one goes on to the host, which reads the active cell from the selection it already hears; the tooltip is unchanged. `open_popover` opens any cell all the same. `PopoverCells::Every` (the default) is the popover as above.
  - **The cue's look, its fade:** `PopoverCue::fade()`, on any cue. The cued cell's text is drawn without its "…", from its start, each glyph's alpha by its place: whole up to 64 px short of the cell's content box's right end and clear from 16 px short of it (at the default text size, scaled with `density`'s; never clear later than the mark's room), the mark at the cell's far right. No glyph moves, and at rest every cell is drawn as without it. Left-aligned text only: a number keeps the cue as above, cut short of it, since a fade would wash out its last digits. An emoji, which has no color to tint, is drawn whole at half alpha or more and not under it. With `find`, a faded cell's tints are its drawn line's (its text up to its last painted glyph), cut where the fade clears; in right-to-left text, whose glyphs aren't in the text's order, the glyphs fade by their place all the same, and that line runs to the furthest character painted. **And its open mark:** `PopoverCue::open_icon(path)`, an SVG from the host's assets drawn in place of the mark on the open popover's cell, in `foreground`. The cue then stays on that cell while the popover is open, hovered or active or not, where the rule in effect gives that cell a cue; its press closes the popover. A path that doesn't load is no open mark, and it does nothing on `PopoverCue::custom`, which draws itself.
  - **The button's width:** `PopoverButton::fill()`, on either look: the foot has no padding and the button is laid out the popover's whole width (the label's button stretched; the host's element in a block that wide, for a foot the host draws edge to edge).
- **With `find`:** the term's matches tinted in its text, by the same rule and fold (`selection` at saturation 0.1).
- **Probed:** the probe's `popover` (its cell, its bounds inside its 1 px border, below or above, its text's characters and whether it was cut, its scroll and its text's height, its button's bounds) and `cue` (its cell and box, whether its cell's text is faded, and whether its mark is the open one; the hovered cell's, else the active one's, else the open popover's). `tall-table-bridge` publishes each press of the button on a global the host names.
- **The host's:** the view of the row the button opens, and any gesture of its own that opens it (`open_popover`).
- **Its cost:** the Features table. Nothing a frame until one is open; an open popover lays out and draws its text each frame, ~0.3 ms with 10,000 characters (the cap). The settings add nothing a frame that shows.

**A header's icon** (`header-icon`, off by default, needing no other feature): an icon at the start of a column's header, set by the host (a type's mark, a menu button), raised under the pointer, its press reported at the release with where it is, so the host hangs its own menu or popover under it. The table draws no menu.

```rust
// At open: an SVG from the app's asset source, its color, and a fill at rest (none by default).
let icon = HeaderIcon::new("icons/hash.svg", |theme: &Theme| theme.muted_foreground).fill(|theme: &Theme| theme.muted);
TallTableColumn::new("H", ColumnKind::Float).icon(icon)

// One column's, set, changed (a filtered state: another path or color), or removed, without `set_columns`:
state.update(cx, |table, cx| table.set_column_icon(index, Some(filtered), cx));

// From the subscription:
TallTableEvent::HeaderIconPressed(press) => { /* the host's menu under press.bounds, for press.column */ }
```

- **Setting it:** `TallTableColumn::icon`, or `set_column_icon(index, Option<HeaderIcon>, cx)` for one column by index. The path is loaded from the app's asset source once, when it's set, never in a frame; one that doesn't load draws no icon and takes no room, quietly (`header_icon()` still gives back what was set, and the layout probe's `icon` says none is drawn). `set_column_icon` lays the columns out again only when the icon's room changes (one added or removed); another path or color only redraws. It has no event of its own; with `pin`, `Pinned` follows if the room changed the run in effect. The colors are `Stop`s (`fn(&Theme) -> Hsla`, exported with `custom-cells` or `header-icon`), read each frame, so a theme change redraws them.
- **At rest:** a badge at the header's left, after the cell's padding, whatever the kind's alignment: the host's fill if it gave one, the glyph in the host's color. The name starts a gap after it and keeps its alignment in what's left. At the base's sizes the badge is 18 × 16 px with corners of 4, the glyph 10, the gap 6; with `density`, each scales with the text, and a short row shrinks the badge to the row less 2 px.
- **Raised:** under the pointer and while pressed, the badge gives way to a backdrop (26 × 24 px, corners of 6, the glyph 12) in the theme's `secondary` with a 1 px `input` border and a shadow, and the cursor is the pointer. That box, the header's height tall, is where the hover and the press are found; it ends short of `resize`'s band. No icon is raised by the pointer during a drag of the table's (a resize, a selection, a carried column, a scrollbar).
- **The press:** a left press on the icon is the icon's alone: it selects nothing, starts no drag, and `clicks` neither reports nor counts it; it hides the tooltip, focuses the table, and is a press outside an open popover (`popover`), which closes. Its release on the same icon emits `HeaderIconPressed`: the column's index, the badge's bounds in window pixels (its visible part when cut), and the keys held at the release. A release anywhere else emits nothing; a double press is two.
- **A context press is its header's:** a right press, a long press, and with `clicks`' `set_ctrl_press_is_context` a Ctrl+left press on the icon go on as presses of its header (`Context` on `Column`, and `select`'s rule), so a host's header menu opens over the icon too.
- **Its room:** the layout's name estimate and `resize`'s fit count the badge and its gap. An icon is drawn at every width down to the table's least; a column a host's `min_width` or `max_width` (`resize`) leaves narrower than the padding and the badge (34 px at the base's sizes) draws none and takes no press. A header too narrow for the icon, the name, and `sort`'s arrow loses the arrow first.
- **With the other features:** an icon cut at the scrolled columns' left edge (the view's, or `pin`'s run's) is drawn cut and pressed on what shows; `pin` draws each region's own; `hide`'s hidden column draws none; with `reorder`, a lifted column's icon dims with its name, the carried preview draws it, and a press held across a move stays its column's (the release on the icon where it is now reports); with `group-headers`, the icons are in the names' row, and a group's cell has none.
- **What's kept:** the pressed icon is forgotten at `set_columns`, a hide of its column, a `set_column_icon` that removes it, and a frame that no longer draws it, so none reports for a column that draws none.
- **Probed:** each column's `icon` on the layout probe (its badge's left from the column's left edge, and its width; none where none is drawn).
- **The host's:** the menu or popover, where it opens (under `bounds`), and what a state looks like (another path or color through `set_column_icon`). `tall-table-bridge` publishes each press on a global the host names.
- **Its cost:** the Features table. Nothing a frame with none set; an icon on every header costs about 0.1 ms a frame, inside the run-to-run spread. Most of its bytes alone are GPUI's SVG drawing, which a host that builds `sort` or draws an icon of its own already has.

Keys, while it has focus: ↑/↓ a row, Page Up/Down and Space/Shift+Space a screen, Home/End and Cmd+↑/↓ the ends. With `select` and a kind on, the arrows, page keys, and ends move the selection instead ("Selecting", above); with `copy`, Cmd+C and Ctrl+C copy it ("Copying"). No key sorts (`sort`), and none finds (`find`: the host's bar binds Ctrl/Cmd+F, Enter, Shift+Enter, and Escape; a host's Ctrl+F that propagates lets the browser's find open over the page's own text). With `popover`, Enter on the active cell opens it and on it presses its button (or closes it, with none), and Escape closes it. Shift+wheel scrolls sideways. The scrollbars are its own: a press on a track jumps there, and a drag loads only once the pointer rests (80 ms).

## Features

Each feature's bytes are its build against the base in one run on 2026-11-04 (gpui-kit 0.9.0; [`perf/results/2026-11-04-m11-c-size.json`](perf/results/2026-11-04-m11-c-size.json)): the size after wasm-opt is the steady one, and brotli moves by up to ~2 KiB between runs as a few bytes shift. Each one's frame work is from its own milestone, linked, unless a later row says it was re-read.

| Feature | What it adds | Cost (wasm, brotli) | Measured in |
|---|---|---|---|
| *(base)* | Paging, prefetch, and a page cache; f64-row scrolling with its own scrollbars, wheel, and keys; columns by kind; rounding, middle cuts, and the exact-value tooltip; a jump-to-row highlight; `replace_rows` ("Replacing the rows", above) | The baseline every feature's cost is read against: the bare host's whole wasm (gpui-kit and `seiza` included) and its work per frame. The cells' text from one element a region (2026-11-04): +0.6 KiB brotli (+3.4 after wasm-opt); a frame drawing text 29–34% less work at the reference run (the wide scroll 7.0 → 4.7 ms), 46–50% throttled (28.1 → 14.5 ms, 52 frames a second against 32), each against the commit before it in the same session. gpui-kit 0.9.1 (2026-11-10): +4.2 KiB brotli, none of it the table's; its frame work within 0.9.0's spread in every segment and both drags (`resize`'s, `select`'s), in both profiles (2026-11-13). gpui-kit 0.10.0 (2026-11-16): +7.8 KiB brotli, none of it the table's. `replace_rows` (2026-11-18): ~2.0 KiB after wasm-opt in a host that calls it, none in one that doesn't (every app's build within 0.5 KiB), and no work per frame: it runs once a call; `sort`'s reset is the same code, its click → filled frame as before | [The bare host's results](perf/results/), [`perf/results/2026-11-04-m11-c.md`](perf/results/2026-11-04-m11-c.md), [`perf/results/2026-11-10-gpui-kit-0.9.1.md`](perf/results/2026-11-10-gpui-kit-0.9.1.md), [`perf/results/2026-11-13-m15-e.md`](perf/results/2026-11-13-m15-e.md), [`perf/results/2026-11-16-gpui-kit-0.10.0.md`](perf/results/2026-11-16-gpui-kit-0.10.0.md), [`perf/results/2026-11-18-m18-b.md`](perf/results/2026-11-18-m18-b.md), [`perf/results/2026-11-18-m18-c.md`](perf/results/2026-11-18-m18-c.md) |
| `custom-cells` | A page's paint for a cell: a fill through a color ramp, a bar from a zero point (its own color below zero), a text color, or over a fill the theme's text color that contrasts ("Paint", above) | +4.0 KiB brotli (+9.9 KiB after wasm-opt). Frame work: nothing compiled in but unused; with every visible cell of the wide shape filled (`heat`, its text the contrast pick), +0.0–0.4 ms a frame (0–8%: the scroll the most, the vertical fling within its spread) at the reference run, no late frames (+0.6–0.8 before the cells' text was one element) | [`perf/results/2026-10-24-m2.md`](perf/results/2026-10-24-m2.md), [`perf/results/2026-10-25-m2-follow-up.md`](perf/results/2026-10-25-m2-follow-up.md), [`perf/results/2026-11-04-m11-c.md`](perf/results/2026-11-04-m11-c.md) |
| `live` | Rows a host says changed are read again and redrawn in place, no placeholders, one read per page in flight; `Refreshed` marks the frame ("Live rows", above) | +5.2 KiB brotli (+13.8 KiB after wasm-opt, the bare host's feed included). Update → refreshed frame, a source answering from memory: 7.7–8.1 ms p50 at 1k–50k updates/s (p95 ~24: a batch landing just after a frame waits for the next). Under the feed, ~310 ms of main thread a second, no late frames (throttled: ~620 ms/s, ≤1.2% late). Compiled in, feed off: no frame cost | [`perf/results/2026-10-25-m3-d.md`](perf/results/2026-10-25-m3-d.md) |
| `live` + `custom-cells` | A changed cell's flash ("A flash", above) | The flash: ~+10 KiB after wasm-opt over each feature alone (+12.3 KiB brotli for both together). Every visible float flashing at 1k–50k updates/s: ~+50 ms of main thread a second, every frame drawn, no late frames; latency 11–13 ms p50 (a batch waits for the next frame). Throttled (4× CPU), at 100–5k updates/s: 7.6–8.6 ms a frame, no late frames, as without the flash; ~520–590 ms of main thread a second against ~310–340 without, 30 refreshed frames a second against 37 (before the cells' text was one element: 16.4 ms, 7–13% late, the main thread saturated) | [`perf/results/2026-10-25-m3-d.md`](perf/results/2026-10-25-m3-d.md), [`perf/results/2026-11-04-m11-c.md`](perf/results/2026-11-04-m11-c.md) |
| `follow` | The view kept at the tail as `set_rows` grows the rows, until the reader scrolls up or the host lets go (`let_go`); `Following` and `TailDrawn` ("Following the tail", above). Turns on `live` | +3.2 KiB brotli over `live` (+10.0 KiB after wasm-opt; +8.4 brotli over the base, the bare host's tail feed included). Append → pixel, a source answering from memory: 8.2–8.3 ms p50 at 1k and 10k rows/s, 28 at 100k (every batch starts a page); no placeholder frame at any rate; a wheel up during the feed on screen in ~28 ms. Reference: ~320 ms of main thread a second (348 at 100k), no late frames. Throttled (4× CPU): keeps up to 10k (≤1.4% late); at 100k the main thread saturates and the view trails by ~0.3 s, still without placeholders. Compiled in, feed off: no frame cost. `let_go`: the call ~0.3 KiB after wasm-opt (under 1 KiB brotli); the bare host's `follow` build +3.0 KiB after wasm-opt, +2.0 brotli with its script hook; no frame cost (it runs only when called) | [`perf/results/2026-10-25-m4-d.md`](perf/results/2026-10-25-m4-d.md), [`perf/results/2026-11-09-m13-a.md`](perf/results/2026-11-09-m13-a.md), [`perf/results/2026-11-17-late-frames.md`](perf/results/2026-11-17-late-frames.md) |
| `resize` | A column's width dragged at its header edge, or fitted to what's drawn by a double-click; `ColumnWidthsChanged` for a host to keep them ("Resizing columns", above) | +2.7 KiB brotli (+4.8 KiB after wasm-opt, the bare host's widths included). Every column resizable, nobody dragging: +0.05–0.15 ms a frame (1–2%) at the reference run, the bands; within the spread throttled. The drag: 4.8–5.5 ms a frame, under the wide shape's sideways fling (6.6), no late frames; throttled ~15–18 ms, 4–5% late | [`perf/results/2026-10-26-m5-d.md`](perf/results/2026-10-26-m5-d.md) |
| `select` | Rows, columns, or a block of cells selected by press, Shift, drag, and keys, held as one range; `Selected` for a host ("Selecting", above) | +6.5 KiB brotli (+22.5 KiB after wasm-opt, the bare host's publishing included). A select-all standing under the scroll and flings: within the spread in both profiles. The drag-select: 5.0–5.7 ms a frame, under the scroll and the sideways fling, no late frames; throttled ~16–18 ms, 5–8% late | [`perf/results/2026-10-26-m6-d.md`](perf/results/2026-10-26-m6-d.md) |
| `copy` | The selection to the clipboard as tab-separated exact values, by Cmd+C or a host's `copy`, rows not loaded read beside the cache, a cap in bytes; the bridge's write ("Copying", above). Turns on `select` | +11.0 KiB brotli over `select` (+33.7 KiB after wasm-opt; +17.5 brotli over the base, the bridge's writer and the bare host's hooks included). Built, nothing copied: within the spread in both profiles. A 58 MiB copy from a cold view: written 1.7 s after the key (2.8 s throttled), the wasm heap growing by at most its reads in flight and a piece. A scroll during it keeps its frame work, its turns running between frames: 1.2–1.3% late frames at the reference run (none alone); throttled, 43% late against 27% (narrow) | [`perf/results/2026-10-27-m7-d.md`](perf/results/2026-10-27-m7-d.md) |
| `sort` | A click on a sortable header's arrow sorts by its column, the source reading pages in the order or refusing; `set_sort`, the host's icons, `Sorted` and `SortRefused` ("Sorting", above) | +23.4 KiB brotli (+85.0 KiB after wasm-opt, the bare host's in-memory sort, icons, and hooks included). Every column sortable: +0.15–0.24 ms a frame (2.5–5%) at the reference run, ~0.13–0.15 of it the arrows; throttled within the spread but for the flings (+0.6–0.8 ms). A sorted column no more than an unsorted. A click: the table's own work under 2 ms, the top filled ~40 ms later with reads answered at once (54–70 throttled), a source's read time added; three reads out at the click add 25–45 ms (the oldest's remainder) | [`perf/results/2026-10-29-m8-d.md`](perf/results/2026-10-29-m8-d.md) |
| `pin` | The first *n* columns fixed at the left while the rest scroll sideways, at most half the view; `set_pinned`, `Pinned` ("Pinning columns", above) | +2.8 KiB brotli (+10.0 KiB after wasm-opt, the bridge's and the bare host's `?pin=` included). Pinned: within ±0.1 ms of the base a frame in both shapes at the reference run (re-read on the cells' text from one element); built with nothing pinned, the base; throttled within the spread | [`perf/results/2026-10-29-m9-d.md`](perf/results/2026-10-29-m9-d.md), [`perf/results/2026-11-04-m11-c.md`](perf/results/2026-11-04-m11-c.md) |
| `format` | A number column's shown text set by its host: fixed decimals (a page's own per cell), a sign on a rise, grouping, a suffix; drawn whole where it fits, the automatic format where it doesn't ("Format", above) | +3.8 KiB brotli (+8.2 KiB after wasm-opt, the layout probe's advances and the bare host's formats included; measured 2026-11-05, [`perf/results/2026-11-05-m12-c-size.json`](perf/results/2026-11-05-m12-c-size.json), where every other build's size after wasm-opt is the table's run's). Formatted: at the base a frame in the narrow shape, and 0.4–0.8 ms (9–17%) cheaper in the wide shape at the reference run, its 500 floats' texts shorter (`+0.12` against 12 characters); throttled the same. Built with nothing formatted: within the base's range in the wide shape, 0.10–0.14 ms (2–3%) over it in the narrow, not separated from noise | [`perf/results/2026-11-05-m12-c.md`](perf/results/2026-11-05-m12-c.md) |
| `density` | A row height and a text size set together, the padding, widths, and glyph measures following them, and a column's width set without `resize`; `set_density` ("Density", above) | +2.3 KiB brotli (+6.0 KiB after wasm-opt, the bare host's `?density=` and hook included). Built at the base's numbers: within 0.05 ms a frame of the base at the reference run, within the spread throttled. Denser, each visible cell adds frame work: at the reference run ~3.8 µs a cell scrolling and ~7–9 µs in a fling (~14 scrolling before the cells' text was one element), and every segment holds the display's rate at 1,128 cells (the wide shape at 18 px rows, 11 px text, 56 px columns: the scroll 7.7 ms a frame, the fling 9.9, 58.7–59.5 a second). Throttled not re-read since (before: frames a second falling with the work, the wide scroll 32 at the base's 308 cells, 12 at 1,128) | [`perf/results/2026-11-01-m10-d.md`](perf/results/2026-11-01-m10-d.md), [`perf/results/2026-11-04-m11-c.md`](perf/results/2026-11-04-m11-c.md) |
| `reorder` | A header dragged to move its column, or with `select` a selected range; the order kept by the table, so no page is read; with `pin`, a move across the edge pins or unpins; `move_columns`, `set_order`, `ColumnsMoved` ("Moving columns", above) | +4.8 KiB brotli (+17.1 KiB after wasm-opt, the bridge's order and the bare host's `?order=` and hooks included; measured 2026-11-13, [`perf/results/2026-11-13-m15-e-size.json`](perf/results/2026-11-13-m15-e-size.json), where every other build's size after wasm-opt is the table's run's). Built: within the base's spread a frame in both profiles, in the list's own order and reversed (reversed, the narrow shape fits one more column, 308 cells against 280, and costs their drawing: +0.1–0.4 ms at the reference run). The drag: 3.7–3.9 ms a frame at the reference run, 7.5–9.0 throttled, at the display's rate with no late frames, as `resize`'s drag in the same session | [`perf/results/2026-11-13-m15-e.md`](perf/results/2026-11-13-m15-e.md) |
| `clicks` | A press, a double press, and a context press (the right button, a long press, Ctrl+press when the host says so) reported with what it's on (a cell, a row's number, a header, the corner, a blank) and where, whether or not the selection changed; with `select`, a context press keeps a range it's inside; no menu drawn ("Presses", above) | +11.8 KiB after wasm-opt (+1.2 brotli, within its swing; the bridge's published click and the bare host's included). Built: within the base's spread a frame (−0.06 to +0.06 ms, the base itself moving 0.2 ms across the session) at the reference run; every band and arrow carrying its own stop, with `resize` and `sort`, within `resize,sort`'s spread (−0.09 to +0.14 ms), the drag included | [`perf/results/2026-11-16-m16-d.md`](perf/results/2026-11-16-m16-d.md) |
| `hide` | A column hidden by its host keeps its place and index at no width, drawn and hit nowhere, and comes back where it was; `set_column_hidden`, `set_hidden`, `ColumnsHidden`; `pin` counts places; `copy` writes the shown columns ("Hiding columns", above) | +5.4 KiB after wasm-opt (+0.2 brotli, within its swing; the bridge's flags and the bare host's `?hidden=` and hook included); with every other feature on, +4.6 (+4.8 brotli). Built: within the base's spread a frame. Every other column of the wide shape hidden: the shown columns draw the same cells, and each segment within 0.08 ms of the base's two runs, every range overlapping theirs (the base moving 0.14 ms across the session) | [`perf/results/2026-11-18-m19-c.md`](perf/results/2026-11-18-m19-c.md) |
| `find` | A term highlighted in the drawn cells, and the next or previous match in every row, loaded or not, found by the source in windows and brought into view, its cell selected; the table binds no key ("Finding", above) | +23.0 KiB after wasm-opt (+7.4 brotli; the bridge's outcome and the bare host's windowed source and hooks included); with every other feature on, +18.6 (+3.9 brotli). Built, no term: within the base's spread a frame. A term set: the tests cost nothing a run separates (a term matching no drawn cell, within the spread); the tints cost what's drawn, the wide shape's scroll +0.1 ms with about 1 in 7 cells tinted and +0.25 (~5%) with nearly every cell, the flings within the spread. A step: the match drawn in the first or second frame after the source's answer (12–18 ms reference, 17–32 throttled), a far landing's first frame already filled | [`perf/results/2026-11-19-m20-c.md`](perf/results/2026-11-19-m20-c.md) |
| `popover` | A cell's exact text in full in a popover below it, wrapped, scrolled, and selectable, opened by Enter, a cue on the cell, or the host, with a button the host labels for its view of the row ("The cell popover", above) | +49.7 KiB after wasm-opt (+14.7 brotli, 4.6 of it the selectable text; the bridge's press and the bare host's long text and hooks included); with every other feature on, +48.5 (+17.4 brotli). Built, none open: within the base's spread a frame. Open over 10,000 characters (the cap), its text scrolling: +0.34 ms a frame (7%) in the wide shape and +0.31 in the narrow, against the same wheels with none open, at the display's rate with no late frames. Its three settings (which cells, the fade and the open mark, the button's width), built since: about 6 KiB more after wasm-opt (the popover +53.0 over `sort`, +53.8 with every other feature on), and nothing a frame that shows, the cue faded on the hovered and the active cell and the pointer moved a row a move (within 0.05 ms of the cue as built). A host whose first SVG is the cue's icon also links GPUI's SVG drawing, about 47 KiB (the bare host's `popover` build reads +103.0 with its two chevrons) | [`perf/results/2026-11-20-m21-c.md`](perf/results/2026-11-20-m21-c.md), [`perf/results/2026-11-20-m21-b-spike.md`](perf/results/2026-11-20-m21-b-spike.md); the settings, [`perf/results/2026-11-22-m23-d.md`](perf/results/2026-11-22-m23-d.md) |
| `header-icon` | An icon at the start of a column's header, set by the host (an SVG path, a color, a fill at rest), raised under the pointer, its press reported at the release with its bounds for the host's menu; `set_column_icon`, `HeaderIconPressed` ("A header's icon", above) | +62.0 KiB after wasm-opt (+16.8 brotli, the bridge's press and the bare host's three icons, switch, and hook included), ~50 of it GPUI's SVG drawing, which `sort`'s icons link too: over `sort`, +9.7 (+4.3 brotli); with every other feature on, +12.7 (+0.8 brotli). Built, none set: within the base's spread a frame. An icon on every header (11 or 12 on screen): +0.1 ms a frame (2–3%) in the scroll and the sideways fling, the ranges overlapping the base's, no late frames | [`perf/results/2026-11-21-m22-c.md`](perf/results/2026-11-21-m22-c.md) |
| `group-headers` | Header rows over groups of columns, any depth, from a label path on each column; a group follows its columns through a move; with `select`, `reorder`, and `clicks`, a group's cell selects, drags, and reports the group, and the table's drags keep a group whole ("Header groups", above) | +7.6 KiB after wasm-opt (+2.1 brotli, the bridge's group cells and the bare host's `?groups=` included); with `reorder`, +10.9 over `reorder` (+4.8 brotli). Built without groups: within the base's spread a frame (the base moving 0.16 ms across the session) at the reference run. Two group rows: the body shows two rows fewer (−7% cells), and each segment reads −0.02 to −0.15 ms against the same build ungrouped, about the cells it no longer draws, so the rows cost ≤ ~0.07 ms. The drag of a group (10 columns wide) and of a column held to its group: 3.7–4.0 ms a frame, `reorder`'s, at the display's rate with no late frames | [`perf/results/2026-11-16-m17-d.md`](perf/results/2026-11-16-m17-d.md) |

What's planned, each off by default: [`PLAN.md`](PLAN.md).

## How it differs from `DataTable`

The features are gpui-kit's [`DataTable`](https://docs.rs/gpui-component/0.10.0/gpui_component/table/)'s (gpui-component 0.10.0), but several work differently here, and a few aren't built. Each row links to the decision behind it, by its date. A gpui-kit bump reads `DataTable` for what's new and adds its rows here; one worth building becomes a candidate in [`PLAN.md`](PLAN.md#candidates).

| Area | `DataTable` | The tall table | Decision |
|---|---|---|---|
| Scrolling | Rows placed in f32 pixels (`uniform_list`) | An f64 row index, with its own scrollbars, wheel, and keys | [Table and paging, 2026-09-25](docs/DECISIONS.md#table-and-paging) |
| Rows | Held by the delegate, which renders each one; `load_more` grows them | Read a page at a time from the delegate, never all held; placeholders until a page lands | [Table and paging](docs/DECISIONS.md#table-and-paging) |
| Rows changed wholesale | `refresh`: the delegate's rows read again, a selected row's index kept | `replace_rows`: every page forgotten and its read cancelled, the view at a target (the top, a row, the end), a selection by row cleared, since its index means another row now | [Features, 2026-11-18](docs/DECISIONS.md#features) |
| A cell's look | `render_td`, an element the host builds per cell | `custom-cells`: a fill, a bar, and a text color the page answers | [Features, 2026-10-23](docs/DECISIONS.md#features) |
| Stripes, row lines, row numbers | `stripe`, `bordered`, `row_header` settings | Always drawn by the base | [Features, 2026-10-23](docs/DECISIONS.md#features) |
| Sizes | Presets (`Size`), each a row height with its own padding and text | `density`: a row height and a text size set together, no presets | [Features, 2026-11-01](docs/DECISIONS.md#features) |
| Selection | One row, one column, or one cell | `select`: one range of rows, columns, or a block of cells, extended by Shift, a drag, and keys | [Features, 2026-10-26](docs/DECISIONS.md#features) |
| Copy | `dump_range` over rows in memory | `copy`: tab-separated exact values, reading rows that aren't loaded; the host writes the clipboard | [Features, 2026-10-26](docs/DECISIONS.md#features) |
| Sorting | The delegate sorts the rows it holds | `sort`: the source reads pages in the order, or refuses | [Features, 2026-10-29](docs/DECISIONS.md#features) |
| Pinning | A flag per column, left or right | `pin`: a count, the first *n* columns, left only, at most half the view | [Features, 2026-10-29](docs/DECISIONS.md#features) |
| Moving columns | The delegate moves its own columns; the selection stays at its index; one column | `reorder`: the table keeps the order (no page read again), a selected block moves whole, a move across `pin`'s edge pins or unpins, and the selection follows its columns | [Features, 2026-11-13](docs/DECISIONS.md#features) |
| Presses and menus | Right and double click events, on the release; the delegate builds a menu the table draws; a right-clicked row drawn apart | `clicks`: a press, double press, and context press on the press, with any target; the host draws the menu; a context press selects what it's on (Google Sheets' rule) | [Features, 2026-11-16](docs/DECISIONS.md#features) |
| Header groups | `group_headers`: `ColumnGroup` spans by place, which a moved column leaves behind; labels centered; group cells take no presses | `group-headers`: a label path on each column, any depth, so a group follows its columns; labels kept in view; a group's cell selects and drags the group, and the table's drags keep a group whole | [Features, 2026-11-16](docs/DECISIONS.md#features) |
| Resizing | `col_resizable`, `Column::resizable`, `min_width`/`max_width`, `ColumnWidthsChanged`; `fit_col` | `resize`: the same, a double-click fitting the column to its name and the rows drawn, since the rest aren't held | [Features, 2026-10-26](docs/DECISIONS.md#features) |
| Hiding columns | None in 0.10.0: a host gives the delegate fewer columns, and moves what's held by index (widths, the sort, fixed columns) itself | `hide`: a flag on the column, held by index; a hidden column keeps its place at no width, so every setting and every place holds | [Features, 2026-11-18](docs/DECISIONS.md#features) |
| Finding | None in 0.10.0 (its code editor's search is the model for what's drawn) | `find`: the source finds the next match in every row, the table highlights each drawn match and steps, wraps, and cancels | [Features, 2026-11-18](docs/DECISIONS.md#features) |
| A cell's full value | None in 0.10.0: a host's `render_td` can wrap a cell in gpui-kit's `Popover` (`TableRow::id` keeps it open as rows reorder) | `popover`: the table's own, on a painted cell held by index, its exact text wrapped and selectable, opened by Enter, a cue, or the host, with a button to the host's view of the row | [Features, 2026-11-19](docs/DECISIONS.md#features) |
| A header's icon | None of its own in 0.10.0: a host's `render_th` builds the header's element, a button in it with its own listeners | `header-icon`: the host gives a path and colors, the table draws the badge and the raised look, keeps the name's room, and reports the press at its release with the badge's bounds; a context press there stays its header's | [Features, 2026-11-21](docs/DECISIONS.md#features) |
| Right-pinned columns | `ColumnFixed::Right`, `fixed_right` (since gpui-kit 0.9.1) | Not built: a candidate ([`PLAN.md`](PLAN.md#notes)) | — |
| Row hover | `TableRow::hover` styles the row under the pointer (since gpui-kit 0.10.0) | Not built: the cell under the pointer is found for its tooltip, and nothing is drawn for it | — |
| Row identity | `TableRow::id` keeps a row's element state (an open popover, a tooltip) with it when rows reorder (since gpui-kit 0.10.0) | Not carried over: a row is an index into the source and holds no element state; what's kept by index is cleared when indices change meaning (`sort`) | [Table and paging](docs/DECISIONS.md#table-and-paging) |
| Scrollbar visibility | `scrollbar_mode`: always, on hover, or while scrolling, the theme's by default (since gpui-kit 0.10.0) | Always drawn, in their own space beside the rows | — |
| Loading more | `load_more`, `has_more`, `loading`, `render_loading` | Not carried over: the paging and its placeholders do this | [Table and paging](docs/DECISIONS.md#table-and-paging) |
| An empty table | `render_empty` | Not carried over: a host draws its own | — |
| Scrolling to a row or column | `scroll_to_row`, `scroll_to_col` | `jump_to` for a row; none for a column | — |
| What's in view | `visible_rows_changed`, `visible_columns_changed` | The `Probe` and `Layout` events | — |

## TanStack Table's features

[TanStack Table](https://tanstack.com/table/v8) (v8) is headless: it holds the rows and leaves the drawing to the app. Where each of its features stands here, by one rule: the source (DuckDB, or whatever a host uses) decides which rows exist and in what order, the table how they're shown ([`docs/DECISIONS.md`](docs/DECISIONS.md#features), 2026-11-16). A candidate's research and its parts are in [`PLAN.md`](PLAN.md#candidates).

| TanStack feature | The tall table |
|---|---|
| Column sizing | `resize` |
| Column pinning (left and right) | `pin`: left only, a count; the right a candidate |
| Column ordering | `reorder`: the drag is the table's, not the app's |
| Header groups | `group-headers` |
| Row selection (a map of row ids) | `select`: one range of rows, columns, or cells, never a set of rows |
| Sorting (`manualSorting`) | `sort`: one column, the source reading pages in the order |
| Multi-column sorting | A candidate: whether `sort`'s API takes a list of keys is assessed first |
| Cell renderers (`cell`) | `custom-cells`: a declarative paint, not an element per cell |
| Column visibility (`columnVisibility`, by id) | `hide`: a flag on the column, held by index, a hidden column at no width in its place rather than out of the leaf list, so `pin`'s count is of places; `copy` writes the shown columns |
| Column filtering, global filtering, fuzzy filtering | The source's query and the host's UI; the table's part is `replace_rows` (in the base): every row index means another row now, the view at a target ("Replacing the rows") |
| Faceting | Not the table's: the source's aggregate queries and the host's UI |
| Find (none: its global filter drops rows, the table's `replace_rows`) | `find`: every row kept, the matches highlighted and stepped through, the source finding each next one |
| A cell's full value (none: an app's cell renderer or tooltip) | `popover`: the exact text in full below the cell, selectable, with a button to the host's view of the row |
| A header's icon or menu button (none: the app's `header` renderer) | `header-icon`: the host's icon first in the header, its press an event with its bounds; the menu is the host's |
| Grouping, aggregation, and expanding | A candidate, as tree rows at the fixed row height; detail rows of their own heights ruled out |
| Row pinning | A candidate: the table has no row identity, only indices |
| Column footers (`footer`) | A candidate: a footer row, its values the source's |
| Pagination | Not carried over: the table scrolls |

## Limits

- **Read-only.** No editing. A filter is the source's query and the host's UI; the table's part is `replace_rows` ("Replacing the rows").
- **`replace_rows` keeps no row by identity:** the table knows row indices only, so a selected row, the hover, and the reader's place don't follow a row into the new result. A host that keeps the reader's place finds that row's new index itself and lands there with `ViewAt::Row`.
- **No header height of its own** (`density`): the header is a row tall at the row in effect, its text the cells'.
- **No presets** (`density`): two numbers and a width; compact or comfortable is the host's to name.
- **The cost grows with the cells** (`density`): a denser setting shows more cells, and each costs its frame work. In the bare host (an Apple M1, the reference run, the wide shape) the display's rate holds at 1,128 cells (18 px rows and 11 px text at 56 px columns), ~3.8 µs a cell scrolling and ~7–9 in a fling; a slower device, or 4× CPU throttling, falls behind sooner. The table doesn't stop a host from asking for more than a machine keeps up with.
- **Left only, a leading run** (`pin`): no column pins at the right, and only the first columns drawn pin; a host moves a column into the run (`set_columns`). Without `reorder`, no gesture of the table's own pins one; with it, a header dragged into the run does.
- **At most half the view pins** (`pin`): the run in effect stops at the last leading column within half the cells' width, so a narrow window pins fewer than the host set (`Pinned` says how many).
- **No locale** (`format`): `.` for the point and `,` for grouping, every three digits, always; no `Intl` style, no currency symbol but a suffix's text, no scale (a percentage is the source's value; the suffix multiplies nothing).
- **The minus is `-`** (`format`, U+002D, not U+2212 `−`), as the exact text, the copy, and every unformatted column write it, so a formatted column and its fallback agree.
- **Fixed decimals are a float's** (`format`): an integer's or decimal's digits are drawn as the source wrote them, its decimals ignored.
- **One sorted column** (`sort`): ascending or descending, never by several columns at once; no key sorts.
- **A sort costs what the source pays for its order** (`sort`): from a tenth of a second to more than it can hold. Measured natively over DuckDB ([the research](../../docs/research/tall-table-features.md), "`sort`"; [the spike](perf/results/2026-10-29-m8-a-spike.md)): an `ORDER BY … OFFSET` per page grows with depth (48 ms at the top of 1.57 M rows, ~1 s at 90%), an index over rows in memory takes ~0.15 s to build and 7–43 ms a page, a sorted copy of a Parquet file 1.1 s and ~35 MiB, then 1–2 ms a page; a file whose copy passes the memory budget is refused. The table holds a few pages whatever the source does.
- **A sort made while reads are out waits for them** (`sort`): the old order's reads are cancelled but hold their places until they answer (a source may not be able to stop a started read), so the new order's top page waits for what's left of the oldest (with 200 ms reads and three out, 25–45 ms: the Features table).
- **`set_rows` and `invalidate_rows` don't re-sort** (`sort`): a change that moves rows within the order needs `set_sort` with the same sort.
- **A `Sort` names its column by index** (`sort`): across `set_columns` it holds only while that index keeps its name; a host that moves the sorted column in the list sorts again (a `reorder` move keeps it).
- **An app's placeholder font needs the arrows** (`sort`): an HTML copy of a first frame with a sortable header, in a font subset of printable ASCII and "…", can't draw `↑`, `↓`, or `↕`; add them to the subset.
- **A key copies at most `key_max_cells` cells, and nothing copies past the cap** (`copy`): 100 k cells and 64 MiB by default. The key's limit keeps a reflex Cmd+C on a select-all from reading the whole source; the cap keeps a write under what the browsers take (WebKit's ~100 MiB) and the browser's memory sane (the bridge holds about twice the text at its peak).
- **NULL and empty text paste alike** (`copy`): both are an empty field.
- **A paste before a copy that reads has finished gets the clipboard's old contents** (`copy`): the write lands only once every row is in. Show the reader the copy's progress.
- **A `Columns` copy is of the rows at the key** (`copy`): rows that arrive during it aren't copied.
- **Plain text only** (`copy`): no HTML table or other format on the clipboard.
- **A block of a few columns reads every column of a page** (`copy`): a page is the delegate's unit, so a copy of two columns past the loaded pages costs a full page read per 1,024 rows.
- **One selection range** (`select`): rows, columns, or a block, never several ranges at once (no Cmd+press to add one), and never part of a value's text.
- **No auto-scroll during a selecting drag** (`select`): the head stops at the view's edge; a wheel during the drag scrolls and the head follows.
- **Column widths by kind** (and the header's length), not by the values: measuring the widest value would cover only the pages loaded, and a column must not widen under the reader. With `resize`, a reader sets them, and a fit counts only the visible, loaded rows.
- **A new text size is half in effect until the next frame** (`density`): `set_density` with another text size changes the row height at once, and the columns' widths (and with `pin` the run) at the next frame, where the font is read; a press that lands between reads the new row height over the old columns. One frame, as a narrowed view's one frame with the old run.
- **No auto-scroll during a resize drag** (`resize`): a column's edge dragged past the view's edge doesn't scroll the table; release, scroll, and drag again.
- **No auto-scroll during a move** (`reorder`): a header dragged to the view's edge doesn't scroll the table; a wheel during the drag scrolls sideways and the gap follows.
- **The order is reset by `set_columns`** (`reorder`): a new list is drawn in its own order (`ColumnsMoved` says so when another was in effect); a host that keeps the order across new columns calls `set_order` after.
- **One block at a time** (`reorder`): a drag moves one column, or one contiguous selected range; columns apart from each other move in separate drags.
- **No key opens a menu** (`clicks`): the keyboard's Menu key, or its Shift+function-key equivalent, reports nothing; a host that wants one binds the key itself and reads `selection()` for the target.
- **A Mac browser's Ctrl+click doesn't open `ContextMenuExt`** (`clicks`): the browser sends it as a left press with Ctrl, and gpui-kit's menu opens only on the right button or a long press. With `set_ctrl_press_is_context(true)` the table reports it as a `Context`, and the host opens its menu at `position` itself.
- **A long press only on touch** (`clicks`): gpui's touch recognizer's, 500 ms without moving; a mouse button held down is a press.
- **A hidden sorted column says nothing** (`hide`): the sort holds, but its arrow is hidden with its column; the host's chooser says it.
- **No marker where columns are hidden** (`hide`): nothing is drawn at the gap (a spreadsheet's double line); a host that wants one asks.
- **A group split by a hidden column stays split** (`hide` with `group-headers`): the runs are of places, hidden ones among them, so in `a, b, a` with `b` hidden the two `a` columns draw as two cells side by side, as they were two groups before the hide, and a press on one selects its own place. Joining them would make a hide change what a drag or a press holds as a group.
- **The delegate reads every column** (`hide`): a hidden column's values are still in each page; a source isn't told which columns are shown.
- **A term with no match costs the whole scan** (`find`): the source reads every row to say there's none, as a count of matches does (the host's, never the table's). Natively over DuckDB ([the spike](perf/results/2026-11-18-m20-a-spike.md)), a near match comes back in 30–130 ms on 1.57 M rows and ~1 s on 25 M, windowed; no match, 2.5 s and 47 s. A source windows its scan so a new term stops it.
- **The source's text and the table's can differ** (`find`): a source decides which cell is next by its own text of a value (DuckDB's `1e+300`, the table's `1e300`), the table what's tinted by its own, so at those edges a found cell may draw untinted but edged, or a tinted cell be skipped.
- **One term, as typed** (`find`): no match case, whole words, or regular expressions, and no find and replace (the table is read-only).
- **The current match isn't kept across a sort** (`find`): its index means another cell then; the next step starts from the view's top.
- **The popover's text stops at 10,000 characters** (`popover`): past them, "…"; an open popover lays out and draws its whole text each frame, and at 100,000 a frame took past a 60 Hz frame ([the cap's frames](perf/results/2026-11-20-m21-b-spike.md)). The host's view of the row (its button) shows the rest.
- **The exact text only** (`popover`): the cell's text as the source gave it, no long form apart from it (a nested value's `[3 items]` shows as itself); a source that wants the long form in the popover gives it as the cell's text.
- **One popover, on a cell in view** (`popover`): it closes when its cell leaves the view, and a second one replaces the first.
- **Copy writes no group rows** (`group-headers`): a copy's header line is the column names alone.
- **A host's moves can split a group** (`group-headers`): `move_columns` and `set_order` aren't held to the groups, and a run they split draws as two cells; only the table's own drags keep a group whole. A sort or a resize on a whole group isn't offered: a group's cell has no arrow or band.
- **Paging is the delegate's speed.** A frame never waits on data; rows not loaded yet draw as placeholders. A 3 s fling outruns any prefetch (~84% placeholder frames on Tycho's asteroids sample), while steady scrolling shows none.

## Canvas tradeoffs

- **Accessibility:** screen readers see nothing: the canvas has no accessibility tree. *Today:* it scrolls entirely from the keyboard (above), and with `select` selects from it too. *To close it:* a hidden DOM mirror of the visible rows, kept in step with each frame, its selected rows, columns, and cells marked `aria-selected`.
- **Text selection and copy:** the browser can't select the canvas's text. *Today:* with `select`, a reader selects whole cells, rows, and columns, and with `copy` copies them (Cmd+C, as tab-separated exact values); part of a value can't be selected in its cell, and the tooltip's text can't either; with `popover`, a value's text is selectable in its popover, a part of it copied by Cmd+C. *To close it:* a text selection inside a cell, from the DOM mirror above or a selection of the table's own over a cell's shaped text.
- **Color alone** (`custom-cells`): a heat map's fill, a bar's length, and a value's color carry meaning that a screen reader can't see either, and that a reader who can't tell the colors apart misses. *Today:* the value's text is always drawn over its paint, so the number is there, and over a fill it takes whichever of the theme's text colors contrasts more (a two-way pick, not a contrast score: a mid-lightness fill can leave either one weak). *To close it:* the DOM mirror above, carrying each cell's paint as text.
- **A flash says "changed" in color and motion alone** (`live` with `custom-cells`): a screen reader hears nothing of it, a reader who can't tell its colors apart can't tell a rise from a fall, and its full color can sit under the text with little contrast (a red flash under dark text). *Today:* the new value is drawn over it; under `App::reduce_motion` it holds still instead of fading. *To close it:* the DOM mirror above, announcing changes in a live region (politely, and batched: at a market watch's rates, every visible row changes every frame).
- **New rows arrive silently** (`follow`): a screen reader isn't told that rows arrived or that the view moved, the accessibility gap above. *To close it:* the DOM mirror above, announcing appended rows in a live region (politely, and batched: a busy log appends every frame).
- **Resizing is pointer-only** (`resize`): no key resizes a column, and a screen reader can't reach the bands, the accessibility gap above. *To close it:* keys of the table's own on the active cell's column (`select` gives a column focus), and the DOM mirror above exposing each header as a resizable column.
- **The sort is silent and pointer-only** (`sort`): a screen reader isn't told which column is sorted or which way, and the arrow isn't a button the keys or a screen reader can reach. *Today:* a host's menu can sort (`set_sort`), and a host's own DOM can say the order ("Sorted by H, descending"). *To close it:* the DOM mirror above, each header carrying `aria-sort` and its arrow a button.
- **Which columns hold isn't announced** (`pin`): a screen reader isn't told that the first columns stay while the rest scroll, the accessibility gap above. *To close it:* the DOM mirror above, the pinned headers marked as row headers of each row.
- **Moving a column is pointer-only, and a move isn't announced** (`reorder`): no key moves a column, and a screen reader isn't told that one moved or where, the accessibility gap above. *Today:* a host's menu can move columns (`move_columns`, `set_order`). *To close it:* keys of the table's own on the active cell's column (`select` gives a column focus), and the DOM mirror above announcing a move in a live region.
- **A press's target and a menu aren't announced** (`clicks`): a screen reader isn't told what a press or a context press was on, and a host's menu drawn on the canvas is as silent as the table, the accessibility gap above; no key opens a menu (Limits). *Today:* with `select`, a host can bind its own menu key and act on the selection. *To close it:* the DOM mirror above, each cell focusable with the Menu key reported as a `Context` on it, and the host's menu mirrored as a `role="menu"`.
- **A touch's menu needs a long press** (`clicks`): the browser's own long-press menu (copy, look up) never shows, since the canvas has no text; the table's is the host's, after 500 ms. *Today:* a touch reader gets the host's menu by the same gesture a DOM grid uses.
- **Groups aren't announced** (`group-headers`): a screen reader isn't told which group a column sits under, and a group's cell is pointer-only (no key selects or moves a group), the accessibility gap above. *Today:* a host's menu can select a group's columns (`select`) or move them (`move_columns`). *To close it:* the DOM mirror above, the group rows as header rows with `colspan`s (`aria-colspan`), each column's header naming its groups.
- **Hidden columns aren't announced** (`hide`): a screen reader isn't told which columns are hidden, the accessibility gap above. *To close it:* the DOM mirror above, leaving them out, as a DOM grid's does.
- **A `px` density doesn't follow a page zoom** (`density`): on a DOM grid, the browser's zoom scales the text and the rows together; on the canvas, a `rems` text follows the window's rem size, but a `px` text and every row height (the base's 30 px among them) stay as set. *Today:* a host that sets a density in `rems` gets the text following; the rows don't. *To close it:* a row height in rems as well as px, or the host setting the density again at the zoom.
- **The popover is silent, and the browser's find can't see it** (`popover`): a screen reader isn't told it opened or what it says, and Ctrl+F doesn't search its text, the gaps above; `find`'s term is tinted in it. *Today:* its button opens the host's view of the row, which a host builds in the DOM, where a screen reader reads it and the browser finds in it. *To close it:* the DOM mirror above, the popover's text in a dialog it announces.
- **Nothing at rest says a cell opens** (`popover`): the cue is drawn on the hovered cell, on `select`'s active cell, and with an open mark on the open popover's cell, never on a cell at rest, which shows a cut text by its "…" alone. *Today:* a keyboard reader gets the cue on the active cell and opens it with Enter; a pointer finds it by moving over the cell. *To close it:* a setting that draws the cue at rest on every cell it opens, not built.
- **A faded cue's last characters lose their contrast, on purpose** (`popover`'s `PopoverCue::fade`): over the cued cell's last 48 px the text runs from its color to nothing, so the characters there pass no contrast ratio, over a row's background or a fill alike. *Today:* it's on two cells at most (the hovered and the active one; the open popover's with an open mark), never at rest, where the cell keeps its whole text and its "…"; the popover the cue opens holds every character the fade washes out. *To close it:* leave `fade()` off: the cue then takes the place of the "…" and no text loses contrast.
- **A touch has no hover, so no cue under a finger** (`popover`): on a touch screen the cue shows on `select`'s active cell alone, and without `select` not at all. *Today:* a host opens the popover from a gesture of its own (`open_popover`). *To close it:* the table's touch presses, not built ([`PLAN.md`](PLAN.md)).
- **A header's icon is pointer-only and silent** (`header-icon`): no key reaches it or presses it, and a screen reader isn't told it's there or what it opens, the accessibility gap above. *Today:* a host gives the icon's action another way in: a key of its own acting on `select`'s active cell's column, or a control in its DOM. *To close it:* the DOM mirror above, each header's icon a button with the host's label.
- **An icon's meaning may be its shape and color alone** (`header-icon`): a type told by a glyph and a tint has no text beside it, and an SVG's letters (an "Aa" for text) are outlined paths, not text a reader can select or a screen reader hear; the table draws no tooltip for it. *Today:* the header's name is text beside it, and a host can say the type in its own UI (its menu, a panel). *To close it:* a label on the icon, drawn as its tooltip and carried by the DOM mirror above.
- **Ctrl+F:** the browser's find can't see the cells. *Today:* with `find`, a host's bar finds a value in every row, loaded or not, each match highlighted and the current one brought into view; the browser's own find still sees none of it, and a match isn't announced (a host's DOM bar can say "3 of 12" if it counts, and announce `Found`). *To close it:* the DOM mirror above, for the visible rows' text.

## Docs

| File | What's in it |
|---|---|
| [`CLAUDE.md`](CLAUDE.md) | Rules, architecture, gotchas. |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | Why it's built the way it is, by area. |
| [`fixtures/README.md`](fixtures/README.md) | What another implementation must match: page requests, cell text, page SQL, and a cell's paint. |
| [`PLAN.md`](PLAN.md) | The candidates for features to come, how each is assessed, and the active milestone. |
| [`perf/results/`](perf/results/) | What the table measures of itself in its bare host (`host/`): the base's bytes and frame work, then each feature's added cost. Budgets are the apps' that build it. |
