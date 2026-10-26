# Research: the tall table's features

The research that opens each feature's milestone (the table's [`PLAN.md`](../../components/tall-table/PLAN.md), "Research each feature's design before building it"): how a feature is built on the table's f64-row scroll model, not whether. One section per feature, in the order they're built. Each section's decisions are logged in the table's [`docs/DECISIONS.md`](../../components/tall-table/docs/DECISIONS.md), "Features", and its numbers are in the table's `perf/results/`; this file keeps the reasoning and the options weighed.

---

## `custom-cells`

Researched 2026-10-24, from the pinned source (gpui-kit 0.7.3, gpui-pre 0.3.9, gpui-component 0.7.3) and a spike in the bare host, since thrown away.

### How a cell is drawn today

`render_body` builds one absolutely placed `div` per visible cell (`value_cell`: a plain block, so GPUI can cut its text) with the value's text as its child. The cells sit in one layer (`tall-table-cells`, clipped), over a layer of row backgrounds (stripes, row lines, the jump highlight) and under the gutter and scrollbars. About 310–340 cells a frame at 1440×900 (the table's first results note, `perf/results/2026-10-23-m1.md`).

What GPUI offers for a paint:
- **A background on the cell's element** (`.bg()`): `Div` paints it as one quad in its own paint pass. The cell already exists, so a fill adds no element and no layout node.
- **A child element** for anything that isn't the whole cell (a bar): one more `div` per cell, so one more layout node per cell per frame.
- **Quads in the body's pass:** a `canvas` element whose paint closure calls `window.paint_quad(fill(bounds, color))` for each cell. One element in total, however many cells, and no layout per quad. Painted before the cells layer's other children, so under the text, and under each cell's own background too: a quad and a cell's `.bg()` can't share a cell without the background covering the quad.

Both draw the same pixels: the spike's screenshots of the two drawings (heat and bars, the wide shape) were byte-identical.

### Colors in the page, or a value and a ramp per column

**A 0..1 value from the page, and a ramp per column, resolved from the theme each frame.** The reasons:
- **The theme switch:** the table caches pages (64 MiB), and a page holding colors keeps the old theme's colors until it's re-read or re-answered. A ramp whose stops name theme tokens resolves on the frame the theme changes, as every other color the table draws already does (`cx.theme()` in render). Nothing to re-read.
- **No `cx` in a page:** `TallTablePage::value` takes no context, so a page answering colors would have to capture the theme when it's made, which is the stale-theme problem again.
- **The page stores nothing new:** `paint` is a method, like `value`, so a page computes its answer from the value it already holds, and holds no colors or extra values.
- **A DOM contender can match it** with the same numbers: the fixture pins each cell's value and the ramp's stops, and CSS can do the same mixing (`color-mix(in oklab, …)`) or JS the same math.

**The ramp interpolates in Oklab,** the space CSS's `color-mix` and gradients default to for this, so equal steps of the value look like equal steps of color. The spike's conversion (Hsla → linear sRGB → Oklab, with the ramp's ends converted once per frame and each cell's mix converted back) was a small share of a heat cell's cost in the spike (a hint only: that run failed the spread gate; the table's [`perf/results/2026-10-24-m2-spike.md`](../../components/tall-table/perf/results/2026-10-24-m2-spike.md)). Not worth caching each ramp's colors in a table, which would also quantize the values the fixture pins. The stops' order is the host's: 2 stops for a sequential scale (heat), 3 for a diverging one (market watch's flash: down, none, up).

**Text color is a ramp value too,** through the column's text ramp, so all three fields work one way and a fixture pins them the same way. A named tone (danger, muted) would read better at the call site; that wrapper can live on the host's side.

### A bar from a zero point

**The column says where zero sits** (0..1 of the cell's inner width, 0 by default, the left edge), and the page answers the bar's end as a position on the same 0..1 axis. The bar spans zero to that end, so a negative value grows left of zero. It costs a subtraction per bar over a left-edge bar (the spike drew from a zero point), and the wide sheet's columns are signed (gains and losses, deltas): a left-edge-only bar would make a host shift negative values into a fake range. The bar's color is the column's, a theme token.

### How the paint is drawn

**Both as quads, in one `canvas` under the cells:** each cell's fill, then its bar over it, collected while the row loop builds the cells, so they're clipped with the cells and drawn under the text. Measured in the bare host, the wide shape with every float cell painted (the numbers and spreads: the table's [`perf/results/2026-10-24-m2-spike.md`](../../components/tall-table/perf/results/2026-10-24-m2-spike.md)):

- **A bar** as a child element adds a layout node per cell; as a quad it's placed by the table's own arithmetic (it knows every cell's place from the scroll model, as `cell_at` does), and costs about a third less. That comparison passed the spread gate.
- **A fill** costs about the same on the cell's element (`.bg()`) as a quad; that comparison failed the spread gate, so it settles nothing by itself. What settles it is the order: a bar quad paints before the cells, so a fill on the cell's element would cover the bar in a cell that has both. With both as quads the fill paints first and the bar over it, in one pass, and the cell elements stay as they are.
- **What a paint costs:** with every visible cell painted, bars added 10–12% to the base's frame work and fills a little less. A host that paints only some columns pays for those.

### Open for the build

Settled when it was built (2026-10-24): the table's `docs/DECISIONS.md`, "Features" (the jump's highlight, the fixture's colors from Chromium, the API as built).

- **The row's shading and the jump highlight sit under a fill,** so a fill hides the jump's highlight in its cell. A highlight drawn over the cells (a border, or a quad above the text) would keep it; settled with a screenshot when it's built, since it touches the base's drawing.
- **The fixture pins resolved colors,** in light and dark, from the ramps' stops and each cell's values: the stops are theme tokens, which a JSON can't name, and a DOM contender mixes the same tokens' values. A shade is one 8-bit step a channel: the native test allows that much for rounding, and a control two steps off must fail. A bar's pixels allow one device pixel: GPUI rounds positions of exactly x.5 down and the browser rounds them up (root `CLAUDE.md`, "Known GPUI Kit web gotchas").
- **Undefined answers draw nothing:** a NaN paint value, or a field whose column has no ramp or bar, paints nothing for that field (and is a debug assertion for the second, a host's mistake).
- **A placeholder or failed row paints nothing;** only a loaded row asks its page for paint.

---

## `live`

Researched 2026-10-24, from the table's paging code (`src/pages.rs`, `src/state.rs`), the DuckDB source (`engines/duckdb/crate/src/tall_table.rs`), the observatory's market watch scenario ([`apps/observatory/docs/research/scenarios.md`](../../apps/observatory/docs/research/scenarios.md), "Market watch"), and the pinned source (gpui-pre 0.3.9). No spike: nothing open needs numbers before the build (below, "What needs no spike").

### What asks for it

- **Market watch** (the observatory): ~20 columns × ~50 rows, cells updated in place at 1k–50k updates a second, each change flashing; measured as update → pixel latency and the highest rate held before frames go late. Only the UI differs, so an update reaches both sides through the same engine.
- **Tycho:** a query re-run over changed data (a refreshed result, a file registered again), with or without a new row count. `set_rows` already grows the rows; nothing re-reads a page that's loaded.

What the table has today: a loaded page stays until it's evicted, and nothing but eviction, a failure, or a short last page under `set_rows` makes it read again.

### Re-read, or patch

**The table re-reads; it doesn't patch.** A host says which rows changed (`invalidate_rows`), and the table reads their pages again with the delegate's own `load_page`: no new delegate call. The reasons:
- **The table holds no rows to patch.** A page is the delegate's opaque `D::Page`, and the table asks it for values; to patch one it would need a mutation API on `TallTablePage` that every source would write (Arrow pages are immutable buffers in the DuckDB source).
- **One path for every source:** the delegate keeps one call, `load_page`, for first reads and re-reads alike.
- **A source that has the values in memory answers a re-read from memory** (the bare host's source answers on GPUI's next turn). The cost is a spawn's round trip and a read slot per update; the build measures update → pixel with such a source, and if it's within a frame, a push path isn't needed. One can be added later without breaking the delegate (`replace_page(page, P)`, a host handing the table a page): not rejected, not built.
- **Patching in place needs nothing from the table:** a host whose pages share storage it mutates can call `cx.notify()` on the table, which keeps no per-cell cache (the table's [`docs/DECISIONS.md`](../../components/tall-table/docs/DECISIONS.md), "Table and paging", 2026-10-07: no cell-string cache). It gets no flash (the table never sees the old value), and the README can say so.

### What a re-read does to the cache

- **A stale page keeps drawing until its fresh one lands.** A market-watch cell shows its last price, not a placeholder, between updates; the frame still counts as filled (no `Filled` event for a re-read). Only a page that isn't loaded draws placeholders, as now.
- **One read per page in flight; never cancelled for being stale.** A page invalidated again while its re-read is out is read once more after that read lands, and its answer is drawn meanwhile (it's newer than what's shown). Cancelling and restarting would never land under updates faster than a read: at 50k updates a second every row of market watch changes every frame. DuckDB-Wasm can't stop a started read anyway (the table's `docs/DECISIONS.md`, "Table and paging", 2026-09-25), so the cancelled read would hold its place in flight too. This caps re-reads at one per page per read's round trip, which is the coalescing: invalidating ten times in a frame costs one read.
- **A first read counts too.** A page invalidated while its first read is out (not loaded yet) is stale when that read lands: it's drawn and read once more, as a re-read is. Otherwise the update is lost until the next one, and its generation never shows.
- **An invalidation loads as a scroll does:** through `load_or_settle`, so during a scrollbar drag its re-reads wait for the pointer to rest (`Paging::drag_settle`) with every other load. A feed calling it each frame must not start reads of the pages a drag only passes (the table's `docs/DECISIONS.md`, "Table and paging", 2026-09-25).
- **A failed re-read keeps the stale page drawing,** still stale: rows the reader saw don't turn into an error message. It's read again at the next invalidation of its rows, or by `retry_failed`; a `read_failure` still emits `ReadFailed`. A failed first read shows its error, as now.
- **The bookkeeping:** a page being re-read holds its old bytes until the new page replaces them (the bytes swapped, never added twice); its read counts in flight (`in_flight`, against `max_in_flight`) and is among the reads `close` cancels.
- **Priority: a page with nothing to show first, then stale visible pages, then prefetch.** A stale visible page is drawable, so it doesn't count as missing and doesn't hold prefetch back (`PageCache::plan`'s `visible_missing`), but its re-read starts before a prefetch page's. **Re-reads hold at most `max_in_flight − 1` slots together:** three visible pages changing without pause would otherwise keep every slot busy, and a page scrolled into view would wait behind refreshes of pages already drawn.
- **A stale page nobody wants is dropped,** not kept stale: scrolled back to, it loads as any page does, showing placeholders rather than rows known to be old. A re-read in flight for a page that leaves `wanted` is cancelled, as any read is.
- **The row count is `set_rows`' job, unchanged.** A query re-run with a new count is `set_rows` and then `invalidate_rows(0..rows)`. (The base still forgets a short last page under `set_rows`, a placeholder flash on a growing CSV's last page; with `live`, it could stay drawn as stale instead. Not in this milestone: it changes the base's behavior, so it waits for a host to ask.)
- **The base must not change:** a loaded page's re-read state lives behind `#[cfg(feature = "live")]` in `PageCache`'s slot and the state's paths.

### Marking a re-read on screen

Market watch's headline is update → pixel latency, so a host needs a mark on the frame that first shows a re-read's rows, as `Filled` marks the first rows (the table's [`CLAUDE.md`](../../components/tall-table/CLAUDE.md), rule 4: emitted in render, so a mark after the current task lands right after the presented frame).

**A generation, not a row range alone.** `invalidate_rows` returns a number that grows with each call; a read remembers the generation when it starts, and a page drawn for the first time after its read lands emits `Refreshed { rows, generation }` from render. A page read once covers every invalidation up to its generation, so a host maps an update to the generation it got back and takes the first `Refreshed` at or past it whose rows hold the update's row. A row range alone would mis-time an update that arrived while a read was in flight: that read's answer may predate it.

**Only on screen.** `Refreshed` comes from the first frame after the read lands, and only if the page's rows are visible in it: a prefetch page re-read off screen emits none, so a reader scrolling to it later doesn't read as a 10 s update. An update to a row nobody sees has no update → pixel time, and a host doesn't wait for one (the bare host's feed, and market watch's, update visible rows).

### The flash

`custom-cells` left the flash's fade to `live` (its spec: "`custom-cells` draws what a page answers, and redraws when a page changes"). The fade needs to know which cells changed and when, which only a re-read sees: a page's `paint` has neither the old value nor a clock.

- **The table finds the changes, by comparing the old page with the new** when a re-read lands, in the invalidated rows and the columns that flash only. A page keeps the rows invalidated since its drawn page's read started, each with its generation; a landing read compares the rows invalidated before it started and clears those, and rows invalidated during it wait for the next read (coalesced reads must not lose a change). Two NaNs are equal (by bits, not `PartialEq`, where `NaN != NaN` would flash every NaN cell on every read and keep the frames running). Market watch's 50 rows × 20 columns are 1,000 comparisons a read; a wide page's invalidated rows are bounded the same way. In `page_done`, outside the frames. Rejected: the host naming changed cells (a wider API, and a DOM contender would need the same feed of cells; comparing in each side's cache is what each would do natively).
- **Its color:** a `Float` or `Float32` that rose flashes at the ramp's 1, one that fell at 0; any other change (text, NULL to a value or back) at 0.5, "changed". The source's integers arrive as text (`CellValue`), so an integer column flashes "changed", never a rise or a fall. A column says `flash(ramp, duration)`; a column without one doesn't compare.
- **It fades by opacity,** from the ramp's color to nothing over the duration, drawn over the page's fill. Rejected: fading the value toward the ramp's middle, which leaves that color painted once the flash is over, over the row's stripe or a heat cell's fill.
- **Flashes live in a small map,** keyed by (row, column), each entry removed when its flash ends; nothing is stored in a page.
- **Drawn as a fill quad** in `custom-cells`' pass, over the page's own fill (a heat cell can flash); the order is settled with a screenshot in the build, as the jump highlight's was. So it compiles only with both features (`#[cfg(all(feature = "live", feature = "custom-cells"))]`), and a host turns it on per column at run time.
- **It animates:** while a flash is on screen, render asks GPUI for the next frame (`Window::request_animation_frame`, gpui-pre 0.3.9). Off screen, flashes expire by the clock and draw nothing. The clock is GPUI's (`BackgroundExecutor::now`), so the native tests run it on the test clock.
- **Reduced motion:** gpui-pre's `App::reduce_motion` asks for non-essential animation to hold still, but the web platform never sets it from `prefers-reduced-motion` (gpui-pre-web 0.3.9 doesn't read it); a host would. A flash carries meaning, so under it the table holds the flash's first color for the duration, then clears it: no fade, and no frames requested while it holds; a timer (`BackgroundExecutor::timer`) notifies the table when the last held flash ends.
- **What it costs:** the frames themselves. A flash keeps the table drawing every frame while one is visible; at market watch's rates that's every frame, each a full redraw of the visible cells. Measured in the bare host at a few update rates, with and without the flash.

### The bare host's feed

`?live=<updates/s>`: a timer on the host's side invalidates random rows among the visible ones at that rate, in batches each frame, and the memory source mixes a per-row version into each value's hash, so a re-read answers new values. `?flash` gives the float columns a flash ramp. Its updates come from a seeded generator, so every run invalidates the same rows. What it measures is the table's: per-frame work at each rate, re-reads a second, and invalidate → `Refreshed` frame (the table's share of update → pixel; the bare host's reads take one turn).

### What needs no spike

- **The flash's quads** cost what `custom-cells`' fills cost (the table's [`perf/results/2026-10-24-m2.md`](../../components/tall-table/perf/results/2026-10-24-m2.md)): a few hundred quads a frame at most, and market watch flashes fewer.
- **The comparison** is bounded by invalidated rows × flashing columns, off the frame.
- **The continuous frames** are the base's frame work, every frame; the bare host measures it at each rate rather than a spike guessing it.

### A fixture for a DOM contender

- **`paging.json` gains an `invalidate: [start, end]` step:** the re-reads it causes appear as `load <page>` in `expect`, so a DOM contender's cache must re-read the same pages in the same order (visible first, one read per page, no cancel for staleness, a stale unwanted page dropped). Controls: re-reading invalidated pages that aren't wanted, cancelling a stale read to restart it.
- **The flash's colors** reuse `paint.json`'s machinery: a ramp, a value, the colors. A `flash` section pins (old value, new value, elapsed) → the ramp's value and the opacity, and through the ramp, the color; its controls: a fade that runs the wrong way, a fall flashed as a rise.

## `follow`

Researched 2026-10-25, from the table's scroll and paging code (`src/scroll.rs`, `src/state.rs`, `src/pages.rs`), `live`'s re-read path (above), and the observatory's live tail scenario ([`apps/observatory/docs/research/scenarios.md`](../../apps/observatory/docs/research/scenarios.md), "Live tail"); revised the same day after a code review and a design review. No spike: what's open needs the feed's numbers, which the build measures in the bare host (below, "What's measured in the build").

### What asks for it

- **Live tail** (the observatory): rows appended at 1k–100k a second while the view follows the tail; the reader scrolls back while rows keep arriving; minutes long. Measured as the append rate held while following, scroll-back latency during ingest, and memory and late frames over a 10-minute soak.
- **Tycho:** a CSV that grows while it loads (`set_rows` already grows the rows), and later a file appended to.

What the table has today: `set_rows` grows the rows and keeps the top row where it is, so the tail runs away from a reader who was at it. Nothing pins the view to the end.

### The tail page is dropped on every append

The base forgets a short last page when the row count changes (`PageCache::set_rows`): the page no longer holds every row it covers, so it's dropped, and its read, if one is out, cancelled. That's harmless for a CSV growing a chunk at a time, read from the top. At the tail it's the whole problem:

- **The tail page is always short and always visible.** Each append drops it, so the rows the reader is looking at turn into placeholders until it's read again.
- **Under appends faster than a read's round trip, it never lands.** Each `set_rows` cancels the read the last one started, as `live`'s research found for invalidations ("never cancelled for being stale"). A source that can't take a read back (DuckDB-Wasm) keeps answering it, so the cancelled reads hold places in flight (`draining`) too.

**So a grown short page is kept, as a stale page is:** its rows drawn as they were read, the rows past them drawn as placeholders, and the page read again, once per read in flight and never cancelled for growing. This is `live`'s re-read path exactly (a page whose rows changed): the slot's re-read state, one read in flight, read once more after a read that a change overtook, `max_in_flight − 1` places for re-reads, a ready answer landing in the turn that asked, `Refreshed` on the frame that draws it. `live`'s research left it as a note ("with `live`, it could stay drawn as stale instead. Not in this milestone: it changes the base's behavior, so it waits for a host to ask"); live tail asks.

**Where it lives: in `live`, and `follow` depends on `live`.** The options:
- **In `live`** (chosen): with `live` on, `set_rows` growing a short page marks it stale instead of dropping it. A host with `live` and a growing source (Tycho's CSV) gets its last page kept drawn too, and `Refreshed` for it. `follow` turns on `live` (`follow = ["live"]`), so a host following a tail pays `live`'s bytes (the table's README, "Features").
- **In `follow`, sharing `live`'s slot state under `any(feature = "live", feature = "follow")`:** the same code compiled from two features, so `live`'s paths would carry a second cfg everywhere, to save `live`'s bytes for a host following a growing source.
- **Not at all** (`follow` pins the view; the tail flickers): the scenario's view would be placeholders whenever appends come faster than reads.

**Which rows a kept page holds:** the rows it was read with. The slot keeps that count, and `PageCache::row` answers `Pending` past it, so those rows draw as placeholders and don't count as loaded (no early `Filled`). Not the page's own `None` past its end (`TallTablePage::value`): `render_body` draws that as a NULL cell and counts the row loaded. Shrinking (`set_rows` below a page's rows) still drops what's past the end, as now.

### Following

**A flag set by the reader's actions, never by position alone.** The first draft made following the same as being at the end (the top at `max_top`). That can't start off: a table opened empty or small is at the end (`max_top` is 0), so a source growing while it loads (Tycho's CSV) would pull the reader to its tail on every chunk, where today the view stays at the top. So following is its own state:
- **Off at open.** A host that wants a tail followed from the start (a log view) calls `follow()` before its first frame.
- **Set by an action that reaches the end:** End, a wheel or key that ends at the end, a scrollbar drag released there, `jump_to` landing there, or `follow()` (which scrolls there first). "Reaches the end" compares the top with `max_top` after the move, exactly: every path to the end clamps to `max_top` (`RowScroll::set_top`), so no tolerance is needed.
- **Cleared by vertical input that leaves the end** (a wheel or key up, by any amount, as a terminal's lets go) **and by `jump_to` anywhere else.** Sideways scrolling leaves it as it is: a reader of the wide shape scrolling across the tail is still watching it. A drag holds the view where the pointer puts it, so the tail doesn't move under the thumb mid-drag; its release decides.
- **Never set by rows arriving or a resize:** a view that happens to be at the end when rows grow, not following, stays where it was.
- **While on, rows arriving and a viewport resize keep the view at the tail** (below, "Pinned to the loaded tail").
- **Pressing End while a source is still loading follows it:** the reader asked for the end, and each chunk then moves them down. The fixture pins it, since it's the first case a reviewer questions.
- **The way back:** End, scrolling or dragging to the end, or the host's button calling `follow()`. The table draws no button (it draws no host chrome; `DataTable` has none either), so it reports `Following(bool)` when the flag changes, for a host to show "back to the tail" while it's off.
- **Rejected:** following as being at the end (above); a tolerance near the end, which a scroll by a fraction of a row could never leave; a mode the host switches on apart from the flag (a host that never wants following leaves the feature off).

**Pinned to the loaded tail, not to `rows()`.** At 100k rows a second the tail crosses into a page not yet read nearly every frame, so a view kept at `rows()` would show placeholders whatever the paging does. Instead, while following, the view's bottom is the end of the loaded rows at the tail: the last row the cache can draw (a grown page's rows read so far, `PageCache::row`), with every row above it in view loaded. Rows the source has but the table hasn't read sit below the view, and the scrollbar's thumb sits just short of the end by them.
- **It only moves down.** A read landing moves it on; rows arriving don't move it until read; an eviction or a failed read never moves it back.
- **At `follow()`, before a read near the tail has landed,** the view goes to `rows()` as a jump does, its placeholders drawn until the read lands; from then the pin holds.
- **What it costs:** the view moves in steps, as reads land, not row by row. At low rates a grown tail page's re-read lands within a frame or two (a ready answer lands in the turn that asked, `live`'s path); at high rates rows fly past faster than anyone reads them anyway. The lag is measured, not hidden: append → the frame that draws the rows (below, "Marking an append on screen").
- **Rejected: pinned to `rows()`,** with placeholders at the tail whenever appends outrun reads, leaving the build to find out whether first reads must land in the turn that asks.

**A follow move isn't a scroll.** A reader's scroll leans prefetch ahead and starts a settle timer (`rows_moved`, `Paging::scroll_settle`). At the tail there's nothing ahead, and a timer per append would allocate a task each frame for nothing. So a follow move keeps the direction as it is and starts no timer; it clears the hover, since the cells moved under the pointer, as any move does.

**Prefetch at the tail: the visible pages bottom first.** `wanted` lists the visible pages top to bottom unless the direction is `Up`, so when two pages are visible the older one would be planned first and the tail page last. While following, they're listed bottom first, as `Up` lists them: the newest rows are the ones the reader is watching. Then two pages behind. Reads of pages the tail has passed may stay in flight (still wanted, behind); the build measures how far the view runs behind at each rate.

### What `set_rows` costs while following

Each append is a `set_rows`, which moves the view and redraws. A host batches appends per frame (the bare host's feed does, as `live`'s does). Today `set_rows` plans its reads at once (`load_pages`), unlike `invalidate_rows`, whose reads are planned once at the end of the update that made them (`App::defer`). With `live`, a grown short page's re-read would then go out on the first `set_rows` of an update, and a second in the same update would find it in flight and read it once more after. So with `live`, `set_rows` defers its plan as `invalidate_rows` does (one pending at a time): an update's growth and invalidations read each page once. Without `live` it plans at once, as now.

### Marking an append on screen

Live tail's headlines are the rate held while following, append → pixel, and scroll-back during ingest. Scroll-back is input to visible response (the event → the first frame at the new position, and → its rows real) while rows arrive, which the bare host measures from a scripted wheel up during the feed.

**Append → pixel needs an event of its own.** `Refreshed` times a grown tail page's re-read, but at 10k rows a second and up most appended rows land in pages read for the first time, and `invalidate_rows` over rows whose page isn't loaded emits nothing; `Filled` says only that a frame has every visible row loaded, not which. So with `follow`, render emits `TailDrawn { rows }` when the loaded tail it draws grows: every row below `rows` is drawn with its values. Row indices only grow, so they're the number: a host that called `set_rows(n)` takes the first `TailDrawn` at or past `n`. Rejected: a number returned by `set_rows`, which would change a base function's signature under a feature. Emitted in render, as `Filled` and `Refreshed` are (the table's `CLAUDE.md`, rule 4), only while following.

### What a DOM contender does

TanStack Virtual has no follow; a contender keeps `scrollTop` at its loaded tail as rows arrive, if it's following, on its own scroller ("— (the contender's own, on its scroller)", the table's [`PLAN.md`](../../components/tall-table/PLAN.md)). Past the browser's element-height cap its spacer is scaled (root `CLAUDE.md`, "Comparison protocol"), so its tail is the scaled spacer's. The observatory works this out when it builds the scenario; the table's part is the fixture below.

### A fixture for a DOM contender

- **`paging.json` gains a `rows: <n>` step** (`set_rows`), in the base: today's behavior pinned (a short last page dropped, its read cancelled), so a contender's cache matches it. Those scenarios hold only without `live`, which keeps the page, so a scenario gains `without: [<feature>, …]`, the features under which it's skipped (`features` only says what it needs). With `live`, scenarios where the short page is kept, read again once per read in flight, never cancelled for growing. Control: `drop-grown` (the base's drop, with `live` on).
- **And `follow: true`** (the host's `follow()`), with `follow` scenarios. A step may carry `following: <bool>` and `bottom: <row>` (the view's bottom row after it), checked after it, since page requests alone can't show a release that reads nothing or where the pin sits. Scenarios: off at open, rows growing at the end not following; `follow()` then rows growing (the tail page read, bottom first; the view held at the loaded tail until it lands); a scroll up, then growth, reads nothing new; a sideways scroll keeps following; End while rows are still arriving follows. Controls: `follow-at-end` (following as being at the end: a small table follows at open), `follow-ignores-reader` (never lets go), `pin-to-rows` (the view kept at `rows()`), `top-first` (visible pages listed top to bottom while following).

### What's measured in the build

- **The bare host's tail feed:** `?append=<rows/s>`, a batch about every 16 ms (as the `live` feed's), starting from `?rows=<n>` rows and growing the source's count (its rows are already a function of their index); `?follow` calls `follow()` at open. In the narrow shape.
- **At 1k, 10k, and 100k rows a second, following:** append → pixel (`set_rows` → the first `TailDrawn` at or past it), per-frame work and late frames, reads a second and drained reads, and scroll-back during the feed; reference and throttled, cold, median of 10. The share of frames with placeholder rows is recorded too, expected 0 once the first tail read lands (the pin's point).
- **The question it answers, as `live`'s push-path check did:** how far behind the tail the view runs with a source answering from memory. A first read isn't polled when sent (only `live`'s re-reads are), so a new tail page always waits for a task. If append → pixel at 10k rows a second is over two frames, a first read polled when sent (under `follow`, the base unchanged) is specced in its own part.

## `resize`

Researched 2026-10-26, from the table's layout and drag code (`src/column.rs`, `src/state.rs`), `DataTable`'s resizing in gpui-component 0.8.0 (the pin since 2026-10-24; `src/table/state.rs`, `column.rs`, `delegate.rs`), gpui-base 0.8.0's `resizable/resize_handle.rs`, and gpui-pre 0.3.9's drag and cursor code; revised the same day after a code review. No spike: the one frame-work risk (below) needs the drag's numbers, which the build measures in the bare host.

### What asks for it

- **Tycho:** columns a reader sizes to the data, as every grid allows; Tycho adopts every feature.
- **The wide sheet** (the observatory): "later, a column-resize drag", measured as its frame cost ([`apps/observatory/docs/research/scenarios.md`](../../apps/observatory/docs/research/scenarios.md), "Wide sheet"). The observatory hasn't asked in its PLAN yet.
- **`pin`, `reorder`, `group-headers`** build on its width model (the table's `PLAN.md`, "Order").

What the table has today: each column's width comes from its kind (`column_layout`: 120 px for a float, 200 for text, an integer's widest value at the font's widest number advance), at least its header's estimated width; `layout_columns` places them side by side and gives each float column its character budget from its width. Nothing changes a width but `set_columns`.

### What `DataTable` does

- **The model:** `Column::resizable` (default on), `min_width` (20 px), `max_width` (1200 px); the table's `col_resizable` (default on); a runtime width per column (`ColGroup::width`), read from the delegate again only on `refresh`.
- **The handle:** a band straddling each boundary, `HANDLE_PADDING` (4 px) on each side of a 1 px hairline drawn in `table_row_border` (`border` on hover), split into two halves, one in the header cell on each side, each painted after its cell so it beats the next column's reorder drag. `cursor_col_resize`, `occlude`. In the header only.
- **The drag:** GPUI's typed drag (`on_drag(ResizeColumn)`, `on_drag_move`): width = pointer x − 2 px − the column's left as last laid out, clamped. Near the table's left or right edge it scrolls sideways 1 px per move.
- **The event:** `ColumnWidthsChanged(Vec<Pixels>)`, every column's width, at the release (`on_mouse_up_out` on the band) and after a fit. Not per move.
- **The fit** (new since 0.7.3, so not in the feature inventory): a double-click on the band calls `TableDelegate::fit_column`, which measures the widest cell, and the table adds the padding and clamps. The double-click's second press also starts a drag, which would move the fitted edge back under the pointer, so drags on that column are ignored until the next single press (`fitted_col`).

### Reuse

Nothing can be reused as code. `ColGroup`, the bands, and `resize_cols` are crate-private and tied to `TableState<D>` and `uniform_list`'s layout. gpui-base's public `resize_handle` is a band for panels: it owns its id, cursor, occlusion, and appearance, and its drag is GPUI's typed drag, which starts only after the pointer moves 2 px (`DRAG_THRESHOLD`) and has no release of its own. `DataTable` reads the release from `on_mouse_up_out`, which fires only when the pointer comes up *off* the band, and the band follows the pointer: a release on the band would emit nothing.

What carries over is behavior and measures: the 4 px on each side of a 1 px hairline, its colors, the header-only grab, the cursor, min and max per column, the event at the release, the double-click fit, and ignoring the second press's drag.

**The drag is the table's own,** as its scrollbars' are: a press on a band starts a column drag, and the move and release handlers the body's `canvas` already registers every frame (the table's `CLAUDE.md`, "A scrollbar release can arrive before the next paint") follow it. That gets the release in every browser, and there's no 2 px dead zone. It's a field of its own (`resizing`), not a variant of `drag`: `drag.is_some()` holds page reads until a scrollbar drag rests (`load_or_settle`, and with `live` `drag_resting`), and a wheel during a column drag must page as the base does. While the drag is on, `Window::set_window_cursor_style` keeps the resize cursor wherever the pointer goes. The cursor otherwise falls back to the cell's when the pointer outruns a narrow column's band.

### The width model

- **A column's width is its kind's unless set:** with `resize`, `TallTableColumn::width` sets it (a width the host kept), clamped to the column's `min_width` and `max_width`. A drag or a fit sets it in the state. A kind's width is laid out as today and never clamped, so a column nobody resized draws as without the feature (a 1-character integer column stays under 40 px), and the with-and-without comparison reads the same layout. The header's estimated width stops being a minimum once a width is set: a reader may narrow a column past its name, which `truncate` already cuts.
- **Kept where:** in the state, beside the host's columns. `set_columns` replaces them, so a host that changes a column's kind and wants its widths kept passes them back (`width`), as with `DataTable`'s `refresh`. A host keeps widths from the event, which carries only set widths (`Vec<Option<Pixels>>`, `None` for a kind's), not `DataTable`'s every width. Every width given back would freeze the kind's: an integer column's width follows the font's number advance, read again when the font changes. The event is in the order of `columns()`; a host whose columns change (a new query) keys what it keeps by column name. The table stores nothing across sessions.
- **Defaults:** `max_width` 1200 px (`DataTable`'s). `min_width` 40 px, not `DataTable`'s 20: a value cell's padding is 16 px, so at 20 a float's budget is 1 character, cut to "…". At 40 it's 2 characters at IBM Plex Sans 14 px (a sign and a digit, or `1e` cut), the least that still says something. `resizable` defaults on, as `DataTable`'s does, so a host with the feature built gets it by building columns. There's no table-wide switch: a host that wants none leaves the feature off.
- **Float budgets follow the width.** A float column's budget (`(width − 17) / number_px`, at least 1) is recomputed with each width. A drag re-rounds the column's floats live, on the frame that widens it: the point of widening a rounded column is to see more digits.

### The drag

- **Width from the start of the drag:** width = the width at the press + (pointer x − x at the press), clamped. Not `DataTable`'s pointer minus the column's laid-out left: that left moves when the sideways scroll clamps, and the edge then jumps from the pointer.
- **The sideways scroll holds still during the drag.** Narrowing a column with the view scrolled to the right end shrinks the content. Clamping `scroll_x` at once would slide every column right under the pointer, so the drag edge would run ahead of it. So during a drag the content may end short of the viewport (drawn empty), and the release clamps `scroll_x`. Browsers' table resizers behave the same way. Holding it takes three things: a move re-lays out the columns without `lay_out`'s clamp; sideways input during the drag (a wheel's sideways part, Shift+wheel, the horizontal scrollbar) is ignored, since `scroll_by` clamps `scroll_x` on every call, a vertical one too, and so skips the clamp then; and the content counts as at least `scroll_x` + the cells' width, so the horizontal thumb stays at the view (it would draw past the track's end, or jump to its start once the content fits).
- **No auto-scroll past an edge** in this milestone: a column grows only as far as the pointer can go in the window. `DataTable`'s scroll of 1 px per move is barely movement; a real one (speed by distance past the edge, on a timer) is a later note if Tycho asks. A reader widens, scrolls, and widens again.
- **Re-laid out on each move:** `layout_columns` is O(columns) with no allocation past the column list (500 in the wide shape). The resized column's text is re-cut on the frame; the others only move.
- **During a drag:** no tooltip (the hover is cleared at the press, and the pointer's moves over cells don't start one until the release); `set_columns` ends the drag with no event; a vertical wheel still scrolls, paging as without the drag.
- **The layout probe** (`TallTableEvent::Layout`, behind `probe_frames`) is reported at the release, not on each move. Each report clones every column's name: 500 strings a frame in the wide shape would land in the drag's frame work, which is what's being measured. So a move doesn't bump the layout's generation, and the release does, which republishes it once.

### The fit

A double-click on a band fits the column to its header's name and its visible, loaded rows, clamped. Only what's drawn counts, because the table never holds the column's other rows: a fit here is "make what I see readable".

- **A numeric column** (float, integer, decimal) fits its widest exact text (`CellValue`'s, not the rounded) by character count at the number advance: `chars × number_px` + padding + 1, `column_layout`'s rule for an integer. Not the text's shaped width: a float's budget is `(width − 17) / number_px`, counted at the *widest* number glyph, so a width fitted to the shaped text (narrower digits, a narrow `.`) would give a budget short of the text, and the fitted value would still be rounded.
- **Any other column** fits its widest shown text (`cell_text`: one line, `¶` for a break, since `shape_line` debug-asserts there's no `\n`), cut to the characters `max_width` could hold, so a multi-megabyte value isn't shaped whole, shaped in the cells' font, plus padding.

Rejected: asking the delegate for the column's widest value (a `max(length(…))` query per double-click, which makes resize reach the data); a host that knows a better width sets it with `width`. It's not public in this milestone (`DataTable`'s `fit_col` is). A host button to fit every column can come later without breaking anything.

### What's drawn

With `resize`, the header draws a band at the right edge of each visible resizable column. Its hairline (`table_row_border`, `border` while hovered or dragged) is the header's only vertical line. The body draws no guide line: the columns resize live, as `DataTable`'s do. The bands are painted after the header's cells, so `reorder`'s header drag will sit under them, as in `DataTable`. Only visible columns get a band, about a dozen at 1440 px in either shape, so the header's elements grow by that, not by the column count.

### Frame-work risk

The one risk is the drag itself: a frame per pointer move that re-lays out every column and re-rounds and re-cuts one column's visible cells (about 45 rows). The rest of the frame is what a sideways scroll draws already. It's measured, not spiked: a scripted drag of a visible boundary back and forth, in both shapes, against the horizontal fling's work per frame. If the wide drag's work per frame is over the wide horizontal fling's by more than the spread, the re-layout is the first suspect (laying out only from the resized column on).

### Canvas gaps

The bands can't be reached by keyboard or a screen reader. `DataTable`'s can't either, and TanStack Table's sizing gives no keyboard of its own; a DOM grid could add a `role="separator"` with `aria-valuenow`. That's covered by the README's accessibility gap; the README says resizing is pointer-only.

### What a DOM contender does

TanStack Table's column sizing (`columnResizeMode: 'onChange'`, to match the live resize), its own min and max, the contender's own handle. Its cells must then show what the table's show at the same width. The DOM side can't measure GPUI's glyph advance, which is why `cells.json` hands it the budgets today. So the fixture hands it the rule: `cells.json` gains `number_px` (GPUI's widest number advance, read from the table in Chromium) and a `resize` section of widths and the budgets they give, at and past the clamps. The observatory adds the level only when both its sides build it.

## `select`

Researched 2026-10-26, from the table's input and drawing code (`src/state.rs`, `src/tall_table.rs`, `src/state/resize.rs`), `DataTable`'s selection in gpui-component 0.8.0 (`src/table/state.rs`, `data_table.rs`; the theme's `table_active` in `src/theme/schema.rs`), and gpui-pre 0.3.9's and gpui-pre-web 0.3.9's accessibility code; revised the same day after a code review. No spike: the selection draws one rectangle a frame and tests a range per visible row and column (below), and the drag's cost is measured in the build.

### What asks for it

- **Tycho:** selecting rows or a block of cells to copy, as every grid allows; Tycho adopts every feature.
- **The wide sheet** (the observatory): "a range selection copied" ([`apps/observatory/docs/research/scenarios.md`](../../apps/observatory/docs/research/scenarios.md), "Wide sheet"): a block of cells, not one cell or one row. The observatory hasn't asked in its PLAN yet.
- **`copy`** copies a selection; **`context-menu`** makes the clicked cell the selection (the table's `PLAN.md`, "Features"). And `resize`'s keyboard gap waits for a focused column (the README, "Canvas tradeoffs").

What the table has today: a press anywhere focuses it and hides the tooltip; the keys scroll (up, down, page up and down, space, Home, End, Cmd+Up and Down; nothing sideways); `jump_to` marks a row, drawn in `table_active` under the cells and, over a fill, as a tinted and edged quad (`custom-cells`). Nothing is selected.

### What `DataTable` does

- **Three modes, one thing selected:** `row_selectable` and `col_selectable` (on by default), `cell_selectable` (off). One row, one column, or one cell, never a range: no Shift-extend, no drag, no select-all. A click on a body row selects it; on a header, its column (a column can opt out, `Column::selectable`); with `cell_selectable`, a click selects the cell, and a row header column appears for rows (or, hidden, a second click on the selected cell selects its row). `select_on_modifier_click` lets a delegate keep its own multi-row selection.
- **Keys:** up and down move the row or cell, looping at the ends by default (`loop_selection`); left, right, Tab, and Shift+Tab the column or cell; Home and End the first and last column; page up and down by a page; Escape clears. Without a selection, a key selects row 0 (or cell (0, 0)). Moving a cell scrolls it to the vertical center.
- **Drawn:** a selected row in `table_active` (or `accent`, by the theme's `list.active_highlight`); a selected column's cells in `table_active`; a selected cell with a `table_active` overlay over its content. The theme clamps `table_active`'s alpha to 0.2 (`clamp_alpha`), so it's always a tint. A right-clicked row or cell is edged.
- **Events:** `SelectRow`, `SelectColumn`, `SelectCell`, `ClearSelection` (with every change), and `TableSelection`, the selection as one value. Rows carry `aria_selected`.

### Reuse

Nothing can be reused as code: the selection is crate-private state on `TableState<D>`, its indices are `usize` rows of `uniform_list`, and its scrolling is `scroll_to_item`. What carries over is behavior: the three modes, picked by the host; header click for a column; Escape to clear; the colors (`table_active`, `table_active_border`); an event with each change.

What doesn't carry over, and why:

- **Ranges, not one row:** the wide sheet copies a block, and `copy` would be a one-cell copy otherwise. A range is two corners, so a million rows cost what one does.
- **No looping:** Up on row 0 jumping to row 1,567,522 is a surprise, and no spreadsheet does it.
- **No Tab:** `DataTable` binds Tab and Shift+Tab to columns, so the keyboard can't leave the table. The canvas is one focus stop; Tab has to reach the rest of the page.
- **Home and End keep the table's meaning** (top and end of the rows), not the first and last column: the base binds them so, and Shift+End is how a keyboard selects to the last of 25 M rows.
- **No centering:** a moved cell is scrolled into view the least distance, as the base's line keys scroll, so the view doesn't jump half a screen per arrow.

### The model

- **One range, from an anchor to a head, each a cell** (a row as `u64`, a column), whatever the kind: `Rows` (the rows between, every column), `Columns` (the columns between, every row, however many there are or come), or `Cells` (the block between). The kind says how far the range spans; the cells say where the reader is, so a gutter press records a column too (the first visible one) and a header press a row (the top visible one). One representation for every kind, the spreadsheet's: the active cell always exists. Disjoint ranges (Cmd-click in a spreadsheet) aren't in this milestone: a copy of two blocks that don't line up has no table shape (Excel refuses it), and a later variant adds them without breaking the API if the enum is `#[non_exhaustive]`.
- **The anchor is the active cell,** where a plain arrow moves from, as in Excel and Sheets; Shift moves the head.
- **Columns are indices into `columns()`**, the host's order, a display position. Once `reorder` moves columns, a selection may have to follow a column's identity rather than its position; `reorder`'s research decides.
- **Kept across `set_rows`:** rows past a shrunk end are cut off the range (a cell past it moves to the last row); a range wholly past it is cleared. A `Columns` range covers rows that arrive (`follow`'s tail); a `Rows` or `Cells` range doesn't grow.
- **Cleared by `set_columns`** (the columns may be others; Tycho calls it for a new query), with the event.
- **The host picks the modes at run time:** rows, columns, cells, each on or off (all three on by default once the feature is built: the spreadsheet's model). A selection always takes the smallest kind that's on and holds what was pressed: a cell press is a `Cells` range with cells on, else a `Rows` range with rows on, else nothing. With all three off the table is as without the feature, but for the code.
- **`jump_to` selects** the row with rows on, else the cell (in the active cell's column, or the first visible column with nothing selected) with cells on, emitting the selection's event as any change does, so a host has one path to what's selected. It still sets the mark (the probe's `marked`, which Tycho's checks read), but a mark set by a jump that selected is never drawn: the selection is its highlight, so no stale second highlight stays behind when the selection moves on. With only columns on, it marks and draws as today, and a selected column's tint and the mark's can overlap (the README says so). The mark is `table_active`, the selection's color: two highlights that look the same would mean different things.
- **Never reaches the delegate.** A selection is indices; `copy` reads its rows.

### The pointer

- **A press on a cell** starts a selection there (anchor and head); **Shift+press** moves the head to it, keeping the anchor and the range's kind (a Shift+press on a cell during a `Rows` range extends the rows). A press on the row-number gutter does the same for rows, on a header cell for columns (the resize band, painted over it, wins its 9 px), on the header over the gutter for every column.
- **The drag is the table's own,** as the scrollbars' and `resize`'s are: a field of its own (`selecting`), followed by the move and release handlers the body's `canvas` registers every frame, so a release off the table is never lost. Each move hit-tests the pointer (`cell_at`'s maths, clamped to the cells at the edges, so a pointer past the last column picks the last column) and moves the head; the event and a redraw come only when the selection changes (a `Rows` drag moving across a row's cells changes nothing).
- **A header drag selects columns.** `reorder` moves a column by a header drag too; Sheets' answer is to move a column by dragging an already-selected header, and `reorder`'s research takes it from there.
- **No auto-scroll past an edge**, as with `resize`: during the drag a wheel anywhere in the window scrolls the body, as the base's wheel does, and the head follows the cell now under the pointer, which is how a spreadsheet extends a drag too. The table's wheel is the body's, so a header drag needs the window-wide wheel, registered every frame with the drag's other handlers, to reach columns off screen. Shift+press and Shift+keys reach any row.
- **Cmd+press is a plain press; Ctrl+press selects nothing.** In a Mac browser Ctrl+click is a right-click, and right-click and double-click are `context-menu`'s. No tooltip during the drag (as `resize`).

### The keys

The selection's keys are actions of their own, bound in a key context of their own (`TallTableSelect`) that the element adds only while a mode is on, so they win over the base's there and the base's bindings are untouched. Space and Shift+Space keep the base's page down and up, whose action the base's Page Down and Page Up share.

- **A plain arrow** moves the active cell one cell (left and right too, which the base doesn't bind) and collapses the range to the smallest kind that's on and holds it (a cell, else its row, else its column). **Shift+arrows** move the head along the range's own direction: up and down in `Rows` and `Cells`, left and right in `Columns` and `Cells`. Across it (Shift+Left in a `Rows` range) nothing moves, not even the active cell. At an end they stop.
- **Page up and down** move by the rows in view and scroll a page, as the base; **Shift** extends. **Home and End** (and Cmd+Up and Down) move to the first and last row in the same column; **Shift** extends, so Shift+End selects to the last row in one range. In a `Columns` range, which spans every row, plain Home and End move the active cell and collapse as an arrow does, and with Shift do nothing.
- **Cmd+A or Ctrl+A** (both bound: the table can't tell the platform without the browser, which it doesn't depend on) selects every column when columns are selectable, every row (to the current end) otherwise, every cell in cells-only mode. **Escape** clears, and propagates when nothing is selected.
- **The first arrow with nothing selected** selects the first visible cell (or its row, or its column, by mode) without moving, so the keyboard alone can start one. Page keys, Home, and End with nothing selected scroll as the base's.
- **A moved head is scrolled into view** the least distance, vertically and sideways, through the base's scroll paths (so `follow` sees a move down as the reader's).

### What's drawn, and where

The layers today, bottom to top: the row's background and stripe (and the jump's mark); with `custom-cells`, one `canvas` of quads (the fill, a flash, the jump's edge over a covered cell, the bar); the text.

- **One tint for the visible part of the range:** a range's intersection with the visible rows and columns is one rectangle, drawn as one element in `table_active` with a 1 px `table_active_border` edge, after the quads and before the text. Under the text, so the text keeps its contrast; over the fill and the bar, so a heat map stays readable and visibly selected (the theme's 0.2 alpha cap makes it a tint at most). A flash shows through it.
- **The active cell edged** in `table_active_border`, 2 px, in every kind (it's where the keys move from), only while the table has focus, as a spreadsheet's is: an unfocused table shouldn't look like it takes keys.
- **The gutter cells of selected rows and the header cells of selected columns** drawn in `table_active`, so a reader sees which rows and columns a block spans when its edges are off screen.
- **Per frame:** a range test per visible row (the gutter) and per visible column (the header), and two elements. Without the feature nothing is drawn and nothing tested.

### Frame-work risk

Low: the standing selection is two elements and a range test per visible row and column, O(visible), never O(selected). The drag's frame is the base's frame plus a hit-test per pointer move (a scan of the laid-out columns, 500 in the wide shape, as the tooltip's hover already does); a frame is asked only when the selection changes. Measured, not spiked: the scroll and flings with a select-all standing (so the tint draws on every frame), and a drag-select segment, against the base.

### Canvas gaps

- **Text selection:** a cell's text still can't be selected in part, and nothing is copied until `copy`. The README's "Text selection and copy" becomes: cells and blocks can be selected (`select`), copied once `copy` lands; part of a value can't.
- **Accessibility:** GPUI has AccessKit roles (`role`, `aria_selected`, which `DataTable` sets on rows), but gpui-pre-web 0.3.9 has no AccessKit adapter, so nothing reaches a screen reader on the web. The DOM mirror the README names would carry `aria-selected` and announce the range ("rows 12 to 40 selected").
- **Keyboard:** selecting becomes keyboard-complete (the first arrow starts one), and Tab still leaves the table. The anchor gives a column focus, which `resize`'s keyboard gap waited on; keys to resize it stay a later note.

### What a DOM contender does

TanStack Table's row selection holds a map of row ids (`rowSelection`), built for rows the table holds; select-all over 1.57 M rows would write 1.57 M keys, which the PLAN calls a fair stress. A range model of the contender's own would match the table's behavior at a range's cost. Which is idiomatic is the observatory's decision when it adds the level. Either way the behavior is pinned: a new fixture, `fixtures/selection.json`, of scenarios (presses with Shift, drags, wheels during a drag, keys, `set_rows` and `set_columns`, `jump_to`, under each mode) → the selection after each step and the view's top and `scroll_x`, so a DOM side matches what's selected and what's scrolled into view without matching how it's held.
