# Research: the tall table's features

The research that opens each feature's milestone (the table's [`PLAN.md`](../../components/tall-table/PLAN.md), "Research each feature's design before building it"): how a feature is built on the table's f64-row scroll model, not whether. One section per feature, in the order they're built, one for the hardening's random test of the paging, one for the second hardening's audits, and one for `replace_rows`, a call in the base. Each section's decisions are logged in the table's [`docs/DECISIONS.md`](../../components/tall-table/docs/DECISIONS.md), "Features", and its numbers are in the table's `perf/results/`; this file keeps the reasoning and the options weighed.

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
- **The fixture pins resolved colors,** in light and dark, from the ramps' stops and each cell's values: the stops are theme tokens, which a JSON can't name, and a DOM contender mixes the same tokens' values. A shade is one 8-bit step a channel: the native test allows that much for rounding, and a control two steps off must fail. A bar's pixels allow one device pixel: GPUI rounds positions of exactly x.5 down and the browser rounds them up (`.claude/rules/gpui-web.md`).
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

TanStack Virtual has no follow; a contender keeps `scrollTop` at its loaded tail as rows arrive, if it's following, on its own scroller ("— (the contender's own, on its scroller)", the table's [`PLAN.md`](../../components/tall-table/PLAN.md)). Past the browser's element-height cap its spacer is scaled (`.claude/rules/comparison-protocol.md`), so its tail is the scaled spacer's. The observatory works this out when it builds the scenario; the table's part is the fixture below.

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
- **`reorder` and `group-headers`** build on its width model (the table's `PLAN.md`, "Order"). `pin` was listed here too; its research (below) found it needs only the laid-out widths the base has, and `resize` moves its edge.

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

**The drag is the table's own,** as its scrollbars' are: a press on a band starts a column drag, and the move and release handlers the body's `canvas` already registers every frame (the table's `src/CLAUDE.md`, "A scrollbar release can arrive before the next paint") follow it. That gets the release in every browser, and there's no 2 px dead zone. It's a field of its own (`resizing`), not a variant of `drag`: `drag.is_some()` holds page reads until a scrollbar drag rests (`load_or_settle`, and with `live` `drag_resting`), and a wheel during a column drag must page as the base does. While the drag is on, `Window::set_window_cursor_style` keeps the resize cursor wherever the pointer goes. The cursor otherwise falls back to the cell's when the pointer outruns a narrow column's band.

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

## `copy`

Researched 2026-10-26, from gpui-pre-web 0.3.9's clipboard and key handling (`src/platform.rs`, `write_to_clipboard`; `src/events.rs`, `register_key_down` and `register_paste`), `DataTable`'s `dump_range` in gpui-component 0.8.0 (`src/table/state.rs`), the table's paging (`src/pages.rs`, `plan`) and selection (`src/selection.rs`), and a spike: a plain page in Chromium, Firefox, and WebKit under Playwright, each way of writing a copy read back through a real paste, then large writes timed (the numbers: the table's [`perf/results/2026-10-26-m7-a-spike.md`](../../components/tall-table/perf/results/2026-10-26-m7-a-spike.md)), and a page's text formatted natively.

### What asks for it

- **The canvas tradeoff:** the README's "Text selection and copy" waits on it: since `select`, a reader selects cells, rows, and columns but can't take them anywhere.
- **Tycho:** a block of a query's result pasted into a spreadsheet or a message, as every grid allows; Tycho adopts every feature.
- **The wide sheet** (the observatory): "a range selection copied", its later step; the observatory hasn't asked, and TanStack Table has no copy, so it builds no level for it.

### What `DataTable` does

Nothing a reader can trigger: no key, no clipboard call. `dump_range(rows)` (and `dump`, every row) returns the headers and each row's cells as strings, through the delegate's `cell_text`, for a host to export; it materializes the whole range at once, since a `DataTable` holds its rows. Nothing to reuse: the tall table holds a few pages, so a range past them has to be read, and its text can't be built in one call.

### How a copy reaches the clipboard on the web

- **GPUI's path is `writeText` in the key's event.** gpui-pre-web dispatches a keydown to GPUI synchronously, and `preventDefault`s it when an action handled it; `Platform::write_to_clipboard` calls `navigator.clipboard.writeText` and drops the promise ("called synchronously inside the user's input event"). It listens for `paste` (permission-free, the reason Cmd+V stays unbound) but not for `copy`.
- **The `copy` event is out:** it fires only when the key isn't handled (Cmd+C left to the browser), on the canvas (Chromium, WebKit) or the body (Firefox), and its `clipboardData` must be set before the handler returns, so it can't wait on a read. And a GPUI action for Cmd+C `preventDefault`s it.
- **A write after the key works for about 5 s.** The spike, every engine alike: `writeText` in the keydown and 0.1, 1, and 3 s later pasted; 6 s later it was refused (`NotAllowedError`): browsers count a key as the reader's for 5 s (transient activation). Through GPUI, the refusal is silent: the promise is dropped.
- **A `ClipboardItem` holding a promise outlasts the 5 s.** `navigator.clipboard.write([new ClipboardItem({'text/plain': promise})])`, called in the keydown, pasted in every engine with the promise resolved 0.1 to 12 s later (a Blob or a string). It's Safari's design for exactly this (text built after the gesture), and Chromium and Firefox follow it. Rejecting the promise leaves the clipboard as it was. Not checked: a promise resolved minutes later, or with the page blurred or hidden meanwhile, as a long copy's may be; the build checks both. If either fails, a copy that reads changes flow: the table reads first, then the host asks the reader to press Cmd+C again, which copies the text in that key's task.
- **Headless Chromium grants no `clipboard-write`:** every async write was refused until the context was granted it, which a real Chrome does for a focused page without asking (the `copy` event needed nothing). A script that checks a copy grants it in Chromium; Firefox and WebKit need nothing.
- **Size:** a 256 MiB write took 0.8 s in Chromium and 2.3 s in Firefox; WebKit refused anything from 100 MiB (96 MiB took 0.3 s). The text has to stay under ~100 MiB to copy everywhere.

So the table can't write a large copy itself: it depends on gpui-kit alone, and GPUI's write is `writeText`, which a copy longer than 5 s loses silently. The host can: the bridge depends on `seiza` and runs in the web, and the table's events reach it in the key's task (a key's action runs inside gpui-pre-web's keydown handler, and an entity's events reach its subscribers when the outermost update ends, before the handler returns; the design rests on it, so the build tests it: a copy's start reaches a subscriber before the task that asked ends). So the table builds the text and reports it through events, and the bridge opens a `ClipboardItem` when a copy starts, gives it the text as it comes, and resolves it at the end.

### The text

- **Tab-separated, a row a line,** as Excel and Sheets copy and paste: a block pastes into a spreadsheet's cells, and one cell's text into a text field. Rows joined by `\n`, no newline after the last (a one-cell copy is the value alone). A value holding a tab, a line break, or a `"` is quoted, its quotes doubled, as both spreadsheets write and read it.
- **The exact value,** the tooltip's (`CellValue`'s `Display`: a float's shortest round-trip text), not the rounded or cut text drawn: a copy that rounds loses data, and pasted into a spreadsheet the column formats it again. Line breaks stay line breaks (quoted), not `¶`.
- **NULL is an empty field,** as DuckDB's CSV writer and a spreadsheet's empty cell have it; the word `NULL` pasted would be a text value.
- **What's copied is the selection's cells:** a `Cells` block; a `Rows` range's every column; a `Columns` range's every row as the table has them at the key (a later `set_rows` growing them isn't copied: a copy is of what was selected when asked). Columns in the table's order; no row numbers.
- **No header row by default,** as a spreadsheet copies only cells. A host that wants one (a data tool's "copy with headers") turns it on: the column names as a first line.
- **Plain text only.** An HTML table beside it (`text/html`, which spreadsheets also read) would add nothing a TSV paste doesn't, for a second copy of the text. A later note.

### Reading what isn't loaded

- **The rows come from loaded pages where they can,** each page at its turn (every page before it sent): from the cache if it's loaded then and holds every row the copy wants from it (a last page `set_rows` grew holds fewer than it spans), as drawn then (with `live`, a stale page's drawn rows: a copy is of what the reader sees, not a snapshot the source keeps), read from the delegate otherwise, a page at a time, through `load_page` as every read is. A page loaded when the copy starts isn't held for its turn: the cache may evict it or swap in a re-read meanwhile, and one evicted is read at its turn. A page read for a copy isn't put in the cache: a 1,500-page copy would evict every page the reader has, for rows read once.
- **The reads share the source** (`max_in_flight`, which exists because DuckDB-Wasm runs one query at a time): a copy's reads and `live`'s re-reads together hold at most `max_in_flight − 1`, at least one (`live`'s floor, so a host's `max_in_flight` of 1 still copies), so with `max_in_flight` 2 or more a visible page always finds a place (at 1, it waits behind the copy's one read); a copy starts none while a visible page is loading, and goes before prefetch (the reader asked for it). Reads in flight when the reader scrolls aren't cancelled: a newly visible page shares the source with them, finishing as late as they do, as it does with re-reads. Pages that land out of order wait for their turn, at most those in flight.
- **Each page's columns all come back:** `load_page` reads every column, so a 3-column block of the wide shape reads 500 columns a page. The source's cost, not the table's; a delegate call that narrows the columns is a later note, for when Tycho measures it.
- **The text leaves as it's made,** a turn's worth at a time, so the wasm heap holds a few pages and a turn's text, never the copy's (the heap never shrinks: a 64 MiB copy held whole would keep it 64 MiB larger for the page's life). The bridge keeps the pieces as JS strings and joins them in a Blob, dropping the strings once it's built: browsers keep ASCII at a byte a character, so the peak is about twice the text, plus the clipboard's own copy.
- **Formatting is cut into turns:** a wide page is 512 k cells; formatted natively it took ~40 ms (75 ns a cell, 9.5 MB of text), and wasm is slower. In one turn that's a long task, and a frame waits behind it. The table formats a budget of cells a turn (~16 k, about 1–2 ms natively) and yields, so a frame waits at most that. Counted in cells, not time: wasm has no `Instant`, and GPUI's test clock doesn't move while code runs, so a time budget would never expire in a test.

### How large

- **The key's limit, in cells** (rows × columns, known before any read), 100 k by default, the host's to set: Cmd+C past it copies nothing, reads nothing, and says so (an event with the size), so a reflex Cmd+C on a select-all costs nothing; a host asks the reader and calls `copy`, the confirming click a gesture of its own (Excel for the web asks before a large copy too). The cap below is then the most a confirmed copy ever attempts, not a size a key copies.
- **A floor before any read, no ceiling:** any value may be NULL (empty), so the least a copy can be is its separators (and a header line, with headers): one whose least passes the cap is refused at once. A column's kind bounds nothing above: an integer can pass `max_chars` (the column cuts it), a date arrives as text, and DuckDB writes BC dates and years past 9999 wider than ten characters. So everything else reads to find out.
- **A cap in bytes,** the host's to set, 64 MiB by default: under WebKit's ~100 MiB with room, about 7 k rows of the wide shape (9.5 MB a page of 1,024) and, by an estimate of ~150 bytes a row, some 450 k of the narrow (measured when it's built). Rows × columns alone can't say how many bytes; where the bounds don't settle it, a copy is refused early only when its first page's bytes per row project past twice the cap (a misjudgment needs the rest narrower than half the first page), and otherwise as soon as its text passes the cap. Refused, never cut: a copy missing its last rows, pasted, looks complete.
- A host that knows its browser (Chromium and Firefox took 256 MiB) can raise it.

### Its lifecycle

- **Cmd+C and Ctrl+C,** both bound (as Cmd+A is), in `TallTableSelect`, copy the selection; with nothing selected the key propagates (the browser's default is harmless). A host's menu calls `copy` (a click is a gesture too; `context-menu` will want it).
- **Events, in order, each with the copy's id:** started (the rows and columns; in the task that asked, so the bridge opens its write while the gesture counts), text (the next piece, in order, with the rows it ends at: a host's progress), copied (the totals), or failed (too large, a read that failed, or cancelled). A copy whose rows are all loaded and small emits all of them in the key's task.
- **Cancelled** by Escape (the first while a copy runs cancels it and keeps the selection; the next clears the selection), a second copy (it replaces the first), `set_columns`, `set_rows` shrinking under it, and the host's `cancel_copy`, each with the failure's event. `close` ends it quietly: it takes `&mut App`, not the entity's context, so it can't emit; a host closing the table tells its bridge, which rejects a write still open. Not by the selection changing: the copy is of what was selected when asked. A reader who pressed Cmd+C by reflex stops it with Escape, or with the host's cancel beside its progress (each piece's rows done, or `copying`).
- **A read that fails fails the copy:** no partial clipboard, no retry. A source that's broken (`read_failure`) also gets the table's own read-failed event, so the host repairs it as it does for the cache's reads.
- **A paste elsewhere before a copy that reads finishes** gets the clipboard's old contents: the write lands at its end. The table can't hold another app's paste; under the key's limit the window is a few seconds at most, the host's progress shows while it lasts, and the README says so. Copies of loaded rows finish in the key's task.
- **NULL and empty text paste alike** (both empty fields), as in a spreadsheet: quoting the empty text (`""`) would keep them apart but paste the quotes into a text field.

### Frame-work risk

A copy runs outside render: reads land on tasks, and formatting yields every few milliseconds. What it can cost a frame is that slice, and its reads competing with the visible pages': none starts while a visible page loads, and with re-reads they always leave a place, but those in flight when the reader scrolls share the source with a newly visible page. Measured, not spiked: a large copy's turns under the scroll (frame work and late frames against the base's), the copy's own time and rows per second, and the wasm heap before and after.

### Canvas gaps

- **Text selection and copy:** closed for whole cells; part of a value still can't be selected (the tooltip shows the exact value, which a copy takes whole).
- **Accessibility:** unchanged; the copy has no announcement of its own. A host's progress and result ("Copied 12,345 rows") are its own UI, which a screen reader can reach if it's DOM.

### What a DOM contender does

Nothing to compare: TanStack Table has no copy, and the observatory builds no level for a feature its DOM side lacks. The text format and the reads are pinned by native tests, not a fixture.

---

## Hardening: a random test of the paging

Not a feature: the research that opens the hardening (the table's `docs/milestones.md`, "Hardening"), a seeded random test of the paging under every feature at once. It settles how the test runs, what it drives, what it checks after each step, the faults it must catch, and what it costs a run of `just tall-table test`. Its decisions are in the table's `docs/DECISIONS.md`, "Fixtures". Building it changed some of what follows (the cases' count and draw, when invariants 6 and 8 are checked, what follows a `close`, how a bug is left out until its fix, the budget's landing): those decisions follow the research's there, and the test itself is the table's `src/state/random.rs`.

### What asks for it

Two code reviews of `copy`'s reads (the table's `docs/LESSONS.md`) each found races between `copy` and the paging that no scenario test had: a copy's places leaking (a copy that ended on a page the cache had loaded meanwhile never gave its own read's place back, so three such copies at `max_in_flight` 3 stopped every read), a copy and prefetch reading one page at once, a copy's end that freed a place without planning it (at `max_in_flight` 1 a page scrolled into view stayed a placeholder), a drag at rest that the cache read through and the copy didn't, a read the copy waited for that the same plan cancelled. Each is a timing someone had to think of; a scenario test only checks the timings someone did.

### Proptest by hand, not `property_test`

GPUI offers both at the pin: `#[gpui_kit::test(iterations = N)]` runs seeds 0..N on its `TestDispatcher` (a seeded `StdRng` argument, `SEED` and `ITERATIONS` from the environment, the failing seed printed), and `#[gpui_kit::property_test]` runs proptest with the scheduler's seed as one of the inputs. Proptest shrinks a failing input; plain seeds give a few hundred steps to read by hand. Shrinking is most of "how a failure prints its steps".

- **`property_test` doesn't compile at the pin.** It passes proptest's attribute `proptest_path`, which `proptest-macro` 0.6 (proptest 1.12) reads; the lock has proptest 1.11.0 and `proptest-macro` 0.5.0, which panics on it ("unexpected token, expected `;`"), even on `fn f(x: u8)`, and so does proptest's own attribute given the path. Bumping proptest in `Cargo.lock` would fix it, a lock change outside the gpui family's own crates for one macro.
- **What the macro does is a few lines by hand,** with what gpui-kit already exports (`gpui_kit::proptest`, `seed_strategy`, `apply_seed_to_proptest_config`, `run_test_once`, `TestAppContext::build`): a plain `#[test]` runs proptest's `TestRunner` over `(any::<u64>(), steps)`, a scheduler seed and the steps, and each case runs `run_test_once(seed, …)` on a fresh `TestAppContext`. A spike did this over `copy/tests.rs`' `Sheet` (a window, held reads, scrolls, jumps, answers, copies, cancels): it ran, and a forced failure shrank to a short input printed with its scheduler seed. No new dependency: proptest is in the lock through gpui-kit's `test-support`, with `std` on (so `PROPTEST_CASES` and the other variables work).
- **What the spike showed to set:** the steps must be `vec(step, 0..=n)`, a range, or the length can't shrink (a fixed 200 shrank only the steps' values); the shrink was capped at 32 iterations, too few for a few hundred steps, so the test sets `max_shrink_iters` and a `max_shrink_time`; `failure_persistence: None`, since a failure becomes a scenario test of its own (the hardening's rule: `PLAN.md`), not a regressions file in `src/`.
- **Replay:** `apply_seed_to_proptest_config` seeds proptest from `SEED` (0 when unset), so a plain run tries the same cases every time and a failure recurs on a rerun; `SEED=<n>` tries another set. The scheduler's seed is drawn per case with `any::<u64>()`, not `seed_strategy()`: with `SEED` set, that returns `Just(SEED)`, one task order for every case of the run, so a soak of 4 `SEED`s would try 4 orders. The minimal input prints with its scheduler seed, so its scenario test replays it through `run_test_once(seed, …)`.

### The source

The paging fixture's `Script` (reads answered when the scenario says) and `copy/tests.rs`' `Source` (values of row, column, and version, so a copy's text can be checked) merged, and wider:

- **Values** are a function of the row, the column, the row's version, and its era. `invalidate_rows` bumps the version of its rows (with `live`, a page drawn from an older version is allowed: "as drawn"); a `set_rows` that cuts rows bumps their era (a row drawn or copied from a read made before its rows were cut is never allowed). The era is what makes the shrink by more than a page visible: today the pages past the new end come back, grown, with their old era.
- **Answers:** an `answer` step picks an open read by index (`k % open`), so a step means the same thing whatever's open, which shrinking needs. It answers with the page (a cancelled read too: it won the race), fails it (`read_failure` or not), or refuses it (a ready `Failed` when sent, as a source that won't take the query). Never `Cancelled` for a read the table didn't cancel: the delegate's docs reserve it for a cancel, and the cache keeps such a read's page loading. Some reads answer when sent, as a source with the rows in hand (a ready future: with `live`, a re-read lands in the same turn).
- **Requests:** ids that never repeat, a counter, as DuckDB's `RequestId` and the bare host's are. The trait asked only `Copy + PartialEq` and said nothing of reuse, and `copy_answered`'s comment named a source whose ids are a page's first row, which a cache read and a copy read of one visible page would share while both are open: `cancel(request)` names neither, and `finished` drops every draining entry equal to an answer's request (`retain`) where `copy_answered` frees one, so one answer would free two places. Settled the other way (2026-10-28): an id is never reused for the table's life, which the trait's docs say, so the test's source never repeats one. Rejected: ids recycled once answered (a free list), and repeats supported, which would ask the table to tell apart reads a cancel can't name, for a source nobody has.
- **What it logs:** each read's page, rows, request, who asked (the cache, a re-read, or a copy, from the cache's own books at the step), whether it was cancelled, and its answer, so an invariant reads the source's truth, not the cache's counters.

### The steps

Each a small enum value whose arguments are taken modulo what they index, cfg'd with its feature, so every run of the test recipe builds the steps its features have. Weights are a starting mix for the build to tune by what the steps reach (the spike's: answers about half the steps).

- **The reader:** a wheel (a few rows to a few pages, up or down), a sideways wheel, Home and End, `jump_to` a row, `scroll_to_fraction`, a scrollbar drag (pressed, moved, resting past `drag_settle`, released), and waits on the test clock (past `scroll_settle` and `drag_settle`, or short of them).
- **The source:** `set_rows` growing, shrinking within the last page, and shrinking by more than a page (then growing back), `retry_failed`, and `set_columns` (it cancels a copy).
- **`live`:** `invalidate_rows` over visible, prefetched, and unloaded rows. **`follow`:** `follow`, and the reader's moves that let go of it (a wheel up, Home).
- **`select` and `copy`:** a selection (rows, columns, cells, possibly past the loaded pages), `copy` (the host's: no key limit), Cmd+C (the key: `Declined` past its limit), `cancel_copy`, Escape, and a second copy over a running one. Each case draws its `CopyOptions` (sometimes a cap small enough for `TooLarge`).
- **`close`,** rarely, after which the case keeps answering reads and stepping, and checks only invariant 3 (and 6's exemption): a closed table's places are never freed (`close` cancels the cache's reads without moving them to `draining`, and its answers are dropped unread), so the places and the stall don't apply.
- **A frame** (`window.draw`), so what happens in render happens (`take_refreshed`, the tail drawn, `Filled`); the spike drew after every step, and drawing only on a frame step saved ~20%, so frames are steps of their own.
- **A drain,** sometimes and always at the end: answer every read (with the page) and advance the clock past the settles, until no read is open and nothing is waiting.

**Each case draws its `Paging`:** `page_rows` 8 to 64, the viewport 20 rows (the window's), the rows up to ~40 pages, `prefetch` 0 to 2, `max_in_flight` 1 to 4, a budget of 2 to 12 pages' bytes (so eviction runs), the settle times at their defaults (the steps' waits pick around them); 2 to 6 columns, sometimes enough for a page to take two of the copy's turns (`TURN_CELLS`).

### The invariants

Checked after every step, once the executor is parked (an answer's task has run), until `close` (after it, only 3):

1. **Places.** The cache's places (`in_flight` + `draining` + `copy_reads`) equal the source's open reads, cancelled ones included. Equal, not at most: one place more is a leak (the first review's), one fewer a read the cache has forgotten (an answer that freed two places). And the open reads never pass `max_in_flight`.
2. **One read a page,** at the step a read is sent: no two open reads of a page that aren't cancelled, unless one is the copy's and the page is visible after that step. Checked when the second read goes out, not after: a page the cache read in view and the reader then moved into prefetch is still wanted, so neither read is cancelled, and that's right.
3. **Nothing after `close`:** no read sent, and every open read cancelled.
4. **The budget:** after every step, the loaded pages' bytes are what the cache counts; right after a step a page landed in, past the budget only pages wanted then (or being re-read) stay. Eviction runs only at a landing, so a move that leaves loaded pages unwanted can sit over budget until the next one, and that's right.
5. **Rows drawn are of their era:** every visible row drawn as loaded holds its current era (and, without `live`, its current version).
6. **Every copy ends,** after a drain: each `Started` has its `Copied` or `Failed`, unless `close` came first; one copy runs at a time.
7. **A copy's text:** a `Copied` copy's text is the TSV of its rows and columns, each row of its current era, the rows from one page of one version, a version the source served for that page.
8. **Nothing stalls,** after a drain: every visible row is loaded or failed, and no copy waits. This is the stall the second review found (an end that freed a place without planning it).

### The controls

Each a test-only fault (a `Control`, as the fixtures' are) that the test must catch within its cases in the all-on run:

- **The places leak** (the first review's): a copy's read that answers after the copy has moved past its page doesn't free its place. Caught by 1.
- **Copy and prefetch on one page** (the first review's second): `copy_wants` ignores `loading`. Caught by 2.
- **An end without a plan** (the second review's): a copy's end frees its place without planning. Caught by 8.
- **The limit:** `plan` counts the draining reads out of `max_in_flight`. Caught by 1.
- **A failed read that doesn't end its copy.** Caught by 6.
- **A turn that takes a page by rows it doesn't hold** (`holding` without its end). Caught by 7.
- **`close` that leaves a copy's reads out.** Caught by 3.
- **No eviction when a re-read lands.** Caught by 4.
- **A shrink that doesn't clamp the page it ends in** (`live`: the page keeps its old `end`, so grown back, its rows past the shrink draw from the read before the cut). Caught by 5.
- **The shrink's old rule,** once it's fixed: pages past the new end kept. Caught by 5, and the paging fixture's new scenario's control too. The cache's `Control` is only `cfg(all(test, feature = "live"))` today and `paging.json`'s controls only `paging`, `live`, and `follow`: this one is the base's, so the fix widens the `Control` to `cfg(test)` and gives the fixture a `cache` kind of control.

### What a run costs

Native debug tests, all features on, this machine: the spike's steps cost about 8 ms each (10 with two draws a step), the table's own work more than the drawing, so the test is counted in steps. `just tall-table test`'s all-on run takes 39 s wall, set by `selection_controls_fail` (33.5 s; the rest run beside it), so a random test up to ~25 s adds nothing to it. That's about 3,000 steps: 16 cases of up to 300 (150 on average). The other nine runs (fewer features, cheaper steps, no 33 s test) take 8 cases. A soak (before the hardening closes, and after any change to the paging) runs a release build with debug assertions and overflow checks on (`CARGO_PROFILE_RELEASE_DEBUG_ASSERTIONS=true`, `…_OVERFLOW_CHECKS=true`), several `SEED`s × many cases. The spike's steps ran ~1.4 ms each there (20 cases of 200 in 6.2 s), ~6× the debug build, after a ~10 min build (the workspace's release profile, LTO and all). So 4 `SEED`s × 500 cases (~300 k steps) is ~7 min once built, a `just tall-table soak` recipe; its build makes the whole soak a run to ask about before (root `CLAUDE.md`, the 20-minute rule) when the release build isn't cached.

### What it leaves out

- **`resize`'s and `select`'s pointer paths** (bands, drag-selects): they don't reach the paging but through `scroll_by`, which the wheel steps drive; their fixtures cover them.
- **The paint** (`custom-cells`): built in the all-on run, so a frame draws it, but nothing paints differently by timing; `live`'s flash compares a landing re-read's rows, which the era and version steps reach.
- **Browsers:** the native test runs GPUI's test platform; the smoke checks stay the browsers' check.

---

## `sort`

Researched 2026-10-29, from `DataTable`'s sort in gpui-component 0.8.0 (`src/table/state.rs`, `perform_sort` and `render_sort_icon`; `src/table/column.rs`, `ColumnSort`; `src/table/delegate.rs`, `TableDelegate::perform_sort`), the table's paging (`src/pages.rs`: `set_rows`, `forget`, `loaded`) and header (`render_header`, `select`'s `target_at`), the DuckDB source (`engines/duckdb/crate/src/tall_table.rs`, `ParquetFile::page_sql`), TanStack Table's sorting (`manualSorting`, `getAutoSortDir`, `sortDescFirst`, `enableSortingRemoval`), the bundled UI face's character map (`shared-web/fonts/IBMPlexSans-Regular.ttf`), and a spike: native DuckDB 1.4.5 over the asteroids and Gaia files, each way a source could answer a sorted page timed (the numbers: the table's [`perf/results/2026-10-29-m8-a-spike.md`](../../components/tall-table/perf/results/2026-10-29-m8-a-spike.md)).

### What asks for it

- **Tycho:** a query's result sorted by a click on a column, as every data grid does; Tycho adopts every feature, and sorting is the last of its core three (resize, select and copy, sort).
- **The observatory:** hasn't asked. TanStack Table sorts (with `manualSorting`, since a client-side sort holds every row), so a sort level could be built on both sides once a scenario wants one; none of the five does today.

### What `DataTable` does

- **The model:** each `Column` carries `sort: Option<ColumnSort>` (`None`: not sortable; `Default`, `Ascending`, `Descending`), and the table's `sortable` turns them all off. A click cycles the clicked column `Default` → `Descending` → `Ascending` → `Default` and sets every other sortable column to `Default`, so one column sorts at a time; then it calls the delegate's `perform_sort(col_ix, sort)`, which reorders the rows it holds, and redraws. No event.
- **What's drawn:** an icon button at a sortable header's right, 0.75 rem with 2 px of padding (`ChevronsUpDown` at half opacity when unsorted, `SortAscending` or `SortDescending` when on), with a hover and an active background. The rest of the header is the column's selection (`on_col_head_click`) and its drag (`col_movable`). `fit_col`'s docs ask a header measurement to count the icon's room.
- **Nothing to reuse but the shape.** Its rows are in memory and its sort is the delegate's in place; the tall table holds a few pages, so the order has to come from the source. Its icons are SVG assets (`IconName::SortAscending`, …), which a host brings through its own asset source: the table depends on gpui-kit alone and can't count on them. `ColumnSort` folds "not sorted" into the column's state, which a table sorting one column at a time doesn't need per column.

### The order

What the table asks of a source, whatever answers it:

- **One column, ascending or descending, or none** (the source's own order). Multi-column sorting stays a candidate (`PLAN.md`, "Beyond `DataTable`").
- **A row index is a position in the order.** Page *k* is the order's rows `k × page_rows` up, read as every page is (`load_page`, by index): the cache, prefetch, `jump_to`, the scrollbar, and `copy` work unchanged.
- **A total order, so pages read apart join up:** ties in the source's own order, in both directions (a stable sort: descending isn't ascending reversed), and NULLs last in both directions, as spreadsheets and DuckDB's default (`NULLS LAST`) put them. Without the tie-break a source answering `ORDER BY … LIMIT … OFFSET` page by page could repeat or skip rows across pages; the spike's queries all end in `file_row_number` (or `rowid`) for that reason. How values compare is the source's (its type's order, its collation): the table only names the column and the direction.

### The delegate's calls

The question the PLAN put: the table asks for rows by index, and a source that pages by row-group range (`file_row_number`) can't answer a sorted order that way. Three ways were weighed for how the order reaches the source:

- **The sort in every `load_page`** (a parameter): changes the trait's signature for every source and every build, with or without the feature. Rejected.
- **The host's:** the table draws the arrows and emits the click; the host prepares its source, changes its query (`delegate_mut`), and calls the table to re-read. TanStack's `manualSorting` is this shape. It keeps the trait as it is, but leaves each host to get the swap right (reads of the old order in flight, a copy running, the selection), and the random test can't reach any of it. Rejected.
- **A delegate call, `sort`** (chosen): the table tells its source the new order, then forgets its pages and reads the new order's, as it reads any page. One call, synchronous: from its return every `load_page` reads the new order; reads out when it's called are cancelled right after and their answers dropped, whatever they hold (the cache stores an answer only for the read its slot is waiting on, `PageCache::loaded`, so an old read winning its cancel's race is dropped today). It returns a refusal (`Err`) when the source can't sort that column: the table keeps its order and says so. A default refuses every sort and accepts going back to none, so a delegate written before the feature compiles with it on and is never silently wrong (an arrow over unsorted rows).

**No preparation step in the API.** A source that needs one (an index, a sorted copy: below) starts it in `sort` and holds its first reads until it's done; the table shows placeholders meanwhile, as for any read in flight, and its first filled frame after the sort is the sorted view. Weighed: a future the table awaits before it swaps, keeping the old rows drawn under a pending arrow. It shows rows in an order about to vanish, needs a pending state, a cancel of a preparation, and a second kind of read in the cache's books, for the same click → rows time. The placeholders say what's true: the new order is loading.

### What a source does to answer

The source's cost, measured by the engine when an app adopts the feature; what the spike says it will be, natively (DuckDB 1.4.5, one thread, the files on a local disk), so the table's design can be checked against it:

- **Each page its own `ORDER BY … LIMIT 1024 OFFSET k`:** no preparation, but every page sorts the column again, and the deeper the page the longer: on the asteroids 48–119 ms at the top, 558–660 ms at the middle, 710–1,037 ms at 90%; on Gaia 2.4–2.6 s for the top page alone. Fine for the first page after a click (a top-N), not for paging.
- **An index:** one query writes the order as row numbers (`CREATE TABLE … AS SELECT file_row_number … ORDER BY …`: 129–209 ms on the asteroids, ~20 MiB; 1.9 s on Gaia), and each page joins its slice of the index to the rows. Over rows already in DuckDB's memory (Tycho's CSV, copied into in-memory tables) a page took 7–43 ms. Over a Parquet file, a sorted page's rows are scattered through every row group, so the join reads every group's columns: 17–102 ms natively from a warm disk, but over HTTP the whole file each page (22.8 MB for the asteroids, 1.57 GB for Gaia), unless DuckDB's file cache holds it.
- **A sorted copy:** the rows written once in order into a compressed in-memory table (1.1 s and ~35 MiB on the asteroids), then paged by `rowid` (1–2 ms a page). It reads the whole file once and holds it in memory: fine for the asteroids, not for Gaia (at the asteroids' ratio, ~1.5× the Parquet file, about 2.4 GB, past Tycho's 1.5 GiB DuckDB budget, `apps/tycho/crate/src/csv.rs`'s `MEMORY_BUDGET`).

So a source's sort ranges from a tenth of a second to impossible: in memory, an index; a Parquet file that fits the memory budget, a sorted copy (its first page answered by a top-N while the copy builds, if the wait shows); a file past it, refused, with the reason for the host to show ("sorting reads the whole file: 1.5 GB"). That's why `sort` can refuse, and why a host can mark a column unsortable up front. None of it holds the result in the app's memory (Tycho's rule 3): the table still holds a few pages, and what a source holds is in DuckDB.

### What a sort does to the table

A sort changes which row every index means, so everything the table keeps by index goes or moves:

- **The pages:** every page forgotten, its read cancelled (draining as any cancelled read does; with `live`, re-reads too, and the invalidations with their pages); a flash on screen cleared (`live` with `custom-cells`: its cell is another row now). The cancelled reads hold their places (`max_in_flight`) until they answer, as after a jump, so on a source that can't stop a started read (DuckDB-Wasm) the new order's top page waits for them: a sort made while reads are out costs up to an old read more. Measured with reads held out, and said in the README.
- **The view goes to the top** (row 0; the sideways scroll kept): a sort is clicked to see the order's start, and the top page is the one a source answers first (a top-N). `DataTable` keeps the scroll, but its rows reorder in place and a short table shows the top anyway; at 25 M rows, staying at 47% shows the middle of the order. With `follow`, following lets go, as a landing at the top does.
- **The selection:** a `Columns` range stays (columns don't move), its anchor's and head's rows moved to the top, where the view is: kept, they'd be rows of the old order, and the next key would scroll back to one; `Rows` and `Cells` ranges are cleared (`Selected(None)`). Kept as positions, as Excel keeps a range, a selection made of three rows would now hold three other rows, and a Cmd+C would copy those. The jump's highlight goes too. Hover and the tooltip reset.
- **A copy running is cancelled** (`Failed(Cancelled)`), as `set_columns` cancels one: its later pages would come from the new order.
- **The reads of the new order** are planned once the update that sorted ends, as `copy`'s and `live`'s are, so a host that sorts and does more in one update plans once.
- **`set_columns`** can't tell whether the sorted column is still there: a `Sort` names it by index, and a column dropped before it moves it. So it keeps the sort only when the column at its index has the name it had and is sortable; otherwise it clears it, as `set_sort(None)` would (the source told, the rows read again). A host that moved the column sorts again by its new index (`reorder` will ask the same of its moves).
- **`set_rows`** under a sort means the sorted source has that many rows; **`live`'s `invalidate_rows`**, that rows at those positions changed. A change that moves rows within the order is the source's to settle: a host sorts again (`set_sort` with the same sort re-reads everything). The README says so.

### The click

- **Sortable is the host's word.** `DataTable`'s columns aren't sortable until set, and only the host knows its source can sort a column: on by default, a delegate that can't sort would put an arrow on every header, each click refused, and widen every long-named column for it. A table whose columns don't say so lays out as without the feature, so the fixtures pinned without it hold with it built.
- **An arrow at each sortable header's right,** its own target: `select` owns the rest of the header (a press selects the column) and `resize` its right edge (the band, 4 px inside it), and `reorder` will want the header's drag. One behavior with or without `select`, rather than a header click that sorts until a host turns `select` on.
- **The cycle, by kind, as TanStack's `getAutoSortDir`:** text ascending first, every other kind (numbers, dates, timestamps, booleans) descending first, then the other direction, then off. A data tool's first wish is usually the largest number or the newest date, and A→Z for names. `DataTable` starts every kind descending. Another column's arrow starts its own cycle; the old column's arrow goes back to unsorted.
- **No key.** `DataTable` has none, and a header's arrow isn't reachable by the keys today (the keys move the active cell). A host's menu (`context-menu`'s, later) calls `set_sort`.

### What's drawn

- **Text by default, a host's icons if it gives them:** IBM Plex Sans, the web build's one face, has `↑` (U+2191), `↓` (U+2193), and `↕` (U+2195), so the arrow is a glyph shaped as the header's text is: no SVG asset for a host to bring. `↕` when unsorted at half the header's text color (`DataTable`'s half opacity), full on hover; `↑` ascending and `↓` descending, full. A host that wants icons (gpui-kit's `SortAscending`, `SortDescending`, `ChevronsUpDown`, which it bundles with `icon_assets!` as Tycho bundles its theme icons, or its own) passes their asset paths, drawn as `svg()` in the same colors. The table can't see whether a host bundled an asset until it draws (GPUI logs a missing one and draws nothing), but `App::asset_source()` is public, so it loads each path once when they're set and falls back to the glyphs if any fails. GPUI's SVG renderer is linked already (`usvg`, `resvg` in the bare host's wasm), so icons cost the element's code, not a renderer.
- **Room reserved:** one fixed box for the arrow, the widest of the three glyphs' advances and at least the icon size, the arrow centered in it, plus a gap, counted in a sortable column's name estimate (`column_layout`, at least the header's width) and in `resize`'s fit (as `DataTable`'s docs ask), so neither a click nor icons change a width or move a name. The estimate isn't the shaped width, and a set width (`resize`, down to its minimum) ignores it, so the name's text box ends at the gap and a name that doesn't fit is cut with "…" there; a column too narrow for the box draws no arrow and has no target. A numeric column's name stays right-aligned, against the arrow.
- **An app's placeholder shell** (an HTML copy of its first frame, in a font subset of printable ASCII and "…") can't draw the arrows: an app whose first frame shows a sortable header adds them to its placeholder font when it adopts the feature.

### Frame-work risk

None to spike: a sortable header draws one more glyph (or one SVG, cached by GPUI as any icon is) in each visible header cell (a dozen at the protocol's 1440 px), the target is one more hit test in the header's press, and a sort is one cache clear and the reads any jump makes. Measured: the scroll and flings with a column sorted against the base, and the click → the first frame showing the new arrow (the table's own work) and → the first filled frame, over a source answering from memory with its order computed beforehand (and with `?delay`, a source's time added).

### Canvas gaps

- **Accessibility:** the sorted column and its direction aren't announced, and the arrow isn't a button a screen reader or the keys can reach. A host's own DOM ("Sorted by H, descending") can say it.
- Nothing else changes: Ctrl+F and text selection are as before.

### What a DOM contender does

TanStack Table with `manualSorting`: the header's click sets the sorting state (`getAutoSortDir`, then the other, then off), and the page queries change; with the same source the SQL is the same. No level is built until the observatory asks. Two fixtures pin what's the table's, so a contender built later matches: the paging fixture gains a sort step (the source told, every page forgotten and its read cancelled, the view at the top, the top pages read), and a sort fixture pins the cycle by kind and the order (NULLs last and ties in source order, both ways) for a source to check against, run natively against the bare host's in-memory order now and against a source's SQL when one is built.

### What the random test gains

A `sort` step (a column, a direction, or none, over columns made sortable), whose source renumbers its rows under a new permutation and bumps every row's era, so invariant 5 (rows drawn are of their era) catches a page of the old order drawn after the sort, and 7 a copy's text crossing it. Two controls: a sort that keeps the cache's pages, and one that forgets the loaded pages but leaves the reads out in their slots (an old read's answer then stored as the new order's page). A sort clears the cache and cancels reads: a change to the paging, so the build soaks before its code review (the table's `CLAUDE.md`, rule 5).

## `pin`

Researched 2026-10-29, from the table's horizontal layout and every place it turns a column's x into a screen x (`src/state.rs`: `visible_columns`, `cell_at`, `render_header`, `render_body`, `render_tooltip`, the horizontal thumb; `src/state/resize.rs`'s bands and `held_content`; `src/state/select.rs`'s `cell_clamped`, `target_at`, `scroll_into_view`, and `render_selection`; `src/state/sort.rs`'s arrows; `src/probe.rs`'s layout), `DataTable`'s fixed columns in gpui-component 0.8.0 (`src/table/column.rs`, `ColumnFixed`; `src/table/state.rs`, `fixed_left_cols_count`, `render_table_header`, `render_table_row`, `render_fixed_cols_border`, `render_horizontal_scrollbar`, `drag_gap_at`, `scroll_to_col`), and TanStack Table's column pinning (v8: `columnPinning`, `column.pin`, `getStart`, the left, center, and right leaf columns). No spike: a pin draws no more cells than the base (below), and its cost is measured in the build.

### What asks for it

- **Tycho:** a query's key columns (an id, a name) kept in view while the reader scrolls a wide result sideways; Tycho adopts every feature.
- **The wide sheet** (the observatory): 500 columns scrolled sideways lose the row's identity after the first screen; a pinned key column is how a spreadsheet keeps it. Not asked for in its PLAN.
- **`group-headers`** depends on it: a group must pin whole (the table's `PLAN.md`, "Columns").

What the table has today: one pinned column already, of a kind, the row-number gutter, drawn at the cells' left and never scrolled. Everything else sits in one cells layer (`overflow_hidden`, left of it the gutter, right of it the vertical scrollbar), each column at `column.x − scroll_x`. That expression appears at a dozen sites: the header's cells, the body's cells and their `custom-cells` quads, the flash, the jump's edge, the cell probe, the tooltip, `resize`'s bands, `sort`'s arrows, `select`'s tint and active cell; and its inverse (`x + scroll_x`) in three hit tests (`cell_at`, `cell_clamped`, `target_at`'s header case) and in `select`'s `scroll_into_view`.

### What `DataTable` does

- **The model:** `Column::fixed_left()` (`ColumnFixed`, `Left` only) and the table's `col_fixed` switch (on). `fixed_left_cols_count` counts the columns marked, and rendering pins the *first* that many: it assumes the marked columns come first. A column marked but not first pins the wrong column. Its reorder (`drag_gap_at`) refuses a move across the boundary for that reason: a move would change which columns pin without changing their flags.
- **What's drawn:** each row and the header split in two: the fixed columns in a plain flex row, then the rest in a horizontally scrolled one (`overflow_scroll`, the header's and the rows' handles shared). A 1 px line in `border` at the fixed columns' right edge, header and body (`fixed_cols_border`, on by default; off for a host whose cells draw the edge). The horizontal scrollbar starts at the fixed columns' right edge (`render_horizontal_scrollbar`'s `left`).
- **What it skips:** fixed columns wider than the view (the scrolled part gets no room, and nothing says so); `scroll_to_col` counts from the first unfixed column.
- **Nothing to reuse but the shape:** it's elements per cell in two flex rows, the tall table's cells are absolutely placed in one layer. What carries over: left only, the leading run, the edge line and its color, the scrollbar beside the pinned columns.

### TanStack Table

`columnPinning: { left: [ids], right: [ids] }`; a pinned column is drawn on its side whatever its place in the column order (`getLeftLeafColumns`, `getCenterLeafColumns`), so pinning column 7 moves it to the left. It's headless: a DOM grid draws pinned cells with `position: sticky` and a `left` from `column.getStart('left')`, each with an opaque background (a sticky cell overlaps the scrolled ones under it), on the compositor.

### A count, not a flag

Two models: a flag per column (`DataTable`, TanStack), or a count, the first *n* columns (a spreadsheet's "freeze first columns").

- **A flag on a column that isn't first** must either move it (TanStack: the drawn order is no longer the index order) or be refused (`DataTable`, silently wrong). Moving it is the costly one here: `select`'s ranges are spans of indices (`Columns`, `Cells`: anchor to head), `copy` writes them in index order, the keys step by index, and `sort` names a column by index. With a drawn order apart from the index order, a range dragged across the boundary would select columns that aren't between the two the reader pressed, and every one of those would need a mapping.
- **A count** keeps the drawn order the index order: the first *n* columns are pinned, and a host that wants column 7 pinned moves it first (`set_columns`, later `reorder`). Nothing about selection, copy, the keys, or sort changes. A DOM contender's TanStack state is `left: [the first n ids]`.

So a count, set on the state (`set_pinned`), not a flag in `TallTableColumn`: pinning is a reader's choice through a host's menu (as a spreadsheet's freeze is), and a setter changes it without `set_columns`' work (a copy cancelled, the selection cleared). It's kept across `set_columns` (a new query keeps its first columns pinned, as a sheet's freeze outlives its data), clamped to the columns there are. Right-pinned columns stay a candidate (`PLAN.md`, "Beyond `DataTable`").

### The geometry

Pinned columns come first, so they're laid out at x from 0 to *P* (their widths' sum), and the rest from *P* on, as today. A pinned column is drawn at `x`, a scrolled one at `x − scroll_x`, clipped to the cells area right of *P*. Two consequences, both worth pinning in a fixture:

- **The sideways scroll's range doesn't change:** the scrolled columns show content x from `P + scroll_x` to `cells_width + scroll_x`, so the last column is reached at `scroll_x = content_width − cells_width`, as today. Pinning or unpinning never moves the scroll, and at `scroll_x = 0` every cell is where it is unpinned.
- **One mapping each way** replaces the dozen sites' expression: a column's screen left (`x`, or `x − scroll_x` past the run), and a screen x's content x (`x` left of *P*, `x + scroll_x` right of it). The hit tests keep their one search over the columns: a screen x right of *P* maps to a content x past *P*, which no pinned column holds. A scrolled column is visible when it overlaps `P + scroll_x .. cells_width + scroll_x`, so one wholly under the pinned columns isn't drawn.

**The horizontal scrollbar** starts at *P*, as `DataTable`'s does: its track and its view are `cells_width − P`, its content `content_width − P`, the same fraction of the same range. Its press and drag (`press_track`, `drag_to`) measure from the gutter's edge over `cells_width` today; they measure from *P* over the track, or a press would miss the thumb and a drag land at the wrong fraction.

### When the pinned columns don't fit

Pinned columns wider than the view leave the scrolled ones no room, and nothing in the table could reach them. `DataTable` doesn't handle it. Options: let it be (a host's problem), refuse a `set_pinned` that doesn't fit (but the view's width changes after: a window narrowed, a column resized), or pin fewer while the view is narrow. **Pin fewer:** the run in effect is the longest leading part of the host's count whose right edge is within half the cells' width; the columns past it scroll as if unpinned, and the host's count is kept, so a wider view pins them again. Half leaves the scrolled columns at least as much room as the pinned, whatever the widths; a fixed least width would depend on the columns'. The run in effect is reported (`pinned_in_effect`, an event, the layout probe), so a host can say why a column stopped holding.

It's computed wherever the columns or the view's width change (`set_pinned`, `set_columns`, a fit, a `resize` release, and `set_body`, which takes a new width without `lay_out`), with `Pinned` emitted there, not on a `resize` drag's moves. Until the first `set_body` the cells' width is 0 and nothing pins, so the run takes effect with the first frame's width. Not on the drag's moves either: a pinned column dragged wider than the half would otherwise stop pinning under the pointer, and the edge would jump by the scroll. Nor at the release: a reader who widened a pinned column would see it (or the next one) stop pinning when they let go, something moving after the hand stopped. So **a pinned column's drag is clamped** so the run stays within half the cells' width (its max that, or its `max_width`, whichever is less), as a spreadsheet stops a frozen pane's edge rather than unfreezing it; the release changes nothing but the width. Weighed: unpinning at the release (the first draft; revised after a second reading). What can still pass the half is the view narrowing during the drag (`set_body`): the run is held, and so as not to leave the scrolled region a negative width, *P* is clamped to the cells' width while held (the scrolled region at least empty, its thumb's track at least 0); the release computes the run again.

### What's drawn

- **Two cells layers, side by side, each clipped:** the pinned one from the gutter's edge to *P*, the scrolled one from *P* to the scrollbar. Each holds its columns' cells, its own `custom-cells` canvas (fills, bars, flashes, the jump's edge), and its own `select` canvas, so nothing scrolled draws under a pinned cell. The row backgrounds (stripes, the row lines, the jump's tint) stay one layer under both, the full width, as today: the pinned cells need no opaque fill of their own, unlike a DOM grid's sticky cells. The header splits the same way, and `resize`'s bands and `sort`'s arrows go in their region's layer. A failed row's message stays across the cells, as today (it never scrolled).
- **The pin's edge:** a 1 px line in `border` at *P*, through the header and body, over both layers, while a column is pinned in effect (`DataTable`'s default). The last pinned column's band (`resize`) still drags there; its hairline is under the edge line, the same color as a lit band.
- **A selection across the boundary** draws in two pieces, one per layer, each edged: a `Columns` or `Cells` range from a pinned column to a scrolled one spans the scrolled columns under the pin too, as a spreadsheet's does, and the scrolled piece starts at *P*. The active cell's edge is in its column's layer.
- **The tooltip** is placed from the column's screen left, so a pinned cell's sits still while the rest scroll.

### What the features do with it

- **`resize`:** a pinned column's band is at its screen edge and drags as any other, its width clamped so the run stays within half the view (above); widening it moves *P* and every scrolled column with it. `held_content` is unchanged (the scroll's range is). A band of a scrolled column under the pinned run isn't drawn.
- **`select`:** a press left of *P* is on a pinned column, right of it on a scrolled one; a drag clamps to the visible cells as before, so dragging from a scrolled column across *P* reaches the pinned ones. A key move to a scrolled column brings it into view right of *P* (`scroll_into_view`'s view left is `scroll_x + P`); a pinned column is always in view, so a move there scrolls nothing sideways.
- **`sort`:** a pinned column's arrow is drawn and clicked as any other. A `Sort` names an index, and the count changes no index.
- **`copy`, `live`, `follow`:** nothing: the data and the paging don't see columns' places.
- **`reorder`** (next): a move within the run, across its edge, or into it is its research's question; `DataTable` refuses a move across. With a count, a drag across the edge is the natural pin and unpin gesture (the count changes by one), so `reorder` starts from that rather than a second model.

### Frame-work risk

None to spike: a frame draws the same visible cells (the pinned ones are among the columns a scrolled view drew at `scroll_x = 0`, and a scrolled column under them isn't drawn), plus a second clip region, a second quads canvas with `custom-cells`, a second selection canvas with `select`, and the edge line. What could cost is the per-site mapping, a comparison per column per frame. Measured: the scroll and flings (the sideways fling above all) with columns pinned against the base, and against the `pin` build with none pinned, which splits the code's cost from the drawing's, each compared with the base at the same place in the session.

### Canvas gaps

A screen reader isn't told which columns hold; the README's accessibility gap covers it. Pinning has no key or pointer gesture of its own (a host's menu), as in `DataTable` and TanStack. Nothing else changes.

### What a DOM contender does

TanStack's `columnPinning` with the first *n* ids, sticky cells with `left` from `getStart('left')` and opaque backgrounds, a shadow or line at the edge. Its cells would match only if it pins the same run in effect and its scrolled cells start where the table's do, so a fixture pins the geometry: `fixtures/pin.json`, cases of the cells' width, the columns' widths, the count, and a scroll → the run in effect, the scroll's range, each visible column's screen left, hit tests (a screen x → a column), and a column brought into view (the `scroll_x` that shows it right of *P*, as `select`'s keys do: a key move that only reached `x ≥ 0` would leave the active cell under a pinned column), run natively against the table's own functions, with negative controls (no cap; the pinned columns scrolled; a scrolled column under the run still drawn; into view at the gutter's edge, not *P*). The fixture's cases are chosen; a property test checks the mappings over random widths, counts, and scrolls (a screen x → a column → back inside it, and no screen x mapping to a column under the run), which covers every site that uses them at once. No level is built until the observatory asks.

### What the random test gains

A `pin` step (a count from 0 to past the columns), beside `set_columns` and `resize`'s steps, so a run in effect past a shrunk column list, or a held run while the view's width changes during a drag, would panic there (a drag can't outlive `set_columns`, which ends it). Pinning doesn't touch the paging: no invariant changes, no control, and no soak (the table's `CLAUDE.md`, rule 5).

---

## `density`

Researched 2026-11-01, from every place the table fixes a row height, a text size, or a horizontal length (`src/state.rs`: `ROW_SIZE`, `row_height()` and its callers, `TEXT_REMS`, `Glyphs`, `gutter_width`, the cells' `px_2`, `set_body`, `on_scroll_wheel`'s line delta, `hover_at`, the header, the body, the tooltip; `src/column.rs`: `CELL_PADDING`, `column_layout`'s widths by kind and its name estimate, `layout_columns`' budget; `src/paint.rs`: `BAR_INSET`; `src/state/resize.rs`'s bands and fit, `src/state/select.rs`'s hit tests and tint, `src/state/sort.rs`'s arrow box; `src/probe.rs`; the fixtures), gpui-component 0.8.0's sizes (`src/sizing.rs`: `Size::table_row_height`, `table_cell_padding`, `table_cell_size`; `src/table/data_table.rs`: `Sizable::with_size`, `header_row_height`; `src/table/column.rs`: `Column::width`, `min_width`, `max_width`), and TanStack Table's column sizing. One spike, in the bare host: the table's frame work at a dense setting ([`perf/results/2026-11-01-m10-a-spike.md`](../../components/tall-table/perf/results/2026-11-01-m10-a-spike.md)).

### What asks for it

- **The observatory's wide sheet** (its [`PLAN.md`](../../apps/observatory/PLAN.md), "Scenario: wide sheet"): its dial is the cells on screen, each stop a row height, a column width, and a text size. At the base's 30 px rows and 120 px floats the wide shape shows ~310–340 cells, too few to find where either stack stops holding the display's rate.
- **Tycho:** a compact view of a wide result (more of a query on screen), and a column the reader sized kept across queries without `resize`'s drag being part of the build.

What the table has today: one row height, `ROW_SIZE` (gpui-kit's `Size::Small`, `table_row_height()` 30 px), used for the body's rows and the header alike; one text size, `TEXT_REMS` (0.875 rem, `text_sm`, 14 px at the web's 16 px rem), drawn at it (`TallTable`'s `text_size`) and measured at it (`Glyphs::read`, read again when the rem size or the font changes); and horizontal lengths fixed for 14 px text: the cells' padding (`px_2`, `CELL_PADDING` 16 for both sides), each kind's width (boolean 72, date 104, float and decimal 120, timestamp 184, text 200), the header name's estimate (7.5 px a character plus 24), and the gutter's (the same estimate over the row count's digits). An integer column already follows the font (its widest value at `number_px`), and so does a float's budget (its width over `number_px`). A column's own width is `resize`'s (`TallTableColumn::width`, behind the feature).

### What `DataTable` does

- **Sizes, not numbers:** `Sizable::with_size` takes gpui-kit's `Size`. Each named size sets the row height (`table_row_height`: XSmall 26, Small 30, Medium 32, Large 40 px), the cells' padding (`table_cell_padding`: 2/4, 3/6, 4/8, 8/12 px vertical/horizontal), and the text (`table_cell_size`: `text_xs` for XSmall, `text_sm` for Small and Medium, `text_base` for Large). `Size::Size(px)` sets only the row height: its padding falls to Medium's and its text to whatever the parent sets, so a host's own density can't be expressed as a size without the text and padding drifting from it.
- **The header** is the row height unless `header_row_height` sets it apart (group rows use it too).
- **A column's width** is a plain setting (`Column::width`, 100 px unless set), with `min_width` (20) and `max_width` (1200) clamping it, whether or not the table resizes. Its resize is a separate switch.
- **Nothing to reuse but the pairing:** the table's padding isn't `table_cell_padding`'s (its Small would be 6 px a side; the table's is 8), and its text isn't set per cell. What carries over: one call sets the row and the text together, the header follows the row, and a width is a column's setting apart from resizing.

### TanStack Table

Headless: the row height is the virtualizer's `estimateSize` and the CSS's, the text size is CSS, and a column's width is column sizing's `size` (`header.getSize()`), set in the column definition, with `minSize`, `maxSize`, and `enableColumnResizing` apart from it. A DOM contender matches a density by three CSS numbers and the virtualizer's row size; what it can't take from CSS is where GPUI's layout puts the text (`.claude/rules/gpui-web.md`, "GPUI lays out in whole device pixels"), so its widths and budgets come from a fixture, as `cells.json`'s do.

### A feature, not a setting on the base

Two ways in: settings on the base (every host gets them), or a Cargo feature (the base unchanged).

- **On the base,** the row height becomes a field read at every site and the kind widths a function of the text size, in every build: bytes and frame code in hosts that never change them, and in the observatory's base level, whose DOM side has its CSS fixed. The comparison's "same scope" rule would then have the GPUI base carrying code its TanStack base has no counterpart for.
- **A feature** keeps the base's constants. Each site reads the row height and the derived lengths through one stand-in, as `pin`'s sites go through `Place`: without the feature its methods return the constants, so the base compiles to what it was (`pin`'s stand-in taught that an add of zero isn't free, so the build checks the base's bytes to 0.1 KiB). The wide sheet's level already lists `density` as a feature both sides build (the observatory's `PLAN.md`, "Scenario: wide sheet").

So a feature, `density`, as every other capability is ("Components" in the root `CLAUDE.md`: a minimal base, the rest features).

### Two numbers and a width, not presets

`DataTable`'s presets couple a row height to a text size and a padding that suit its own look; the observatory's stops are its own (named by the cells on screen) and Tycho's compact view is a menu of its own. A preset is a constant a host writes in one line, and `Size::Size` shows what presets do to a number outside them. So the table takes the numbers: **a row height and a text size, set together** (`Density { row_height, text_size }`, `set_density`), and **a width per column** (`TallTableColumn::width`). Together because a shorter row with the same text clips its glyphs, and because each change re-reads the font and lays the columns out again: one call, one layout. A text size is an `AbsoluteLength`, so the default is exactly today's (`rems(0.875)`, following the rem size) and a host can say `px(11.)`.

**What a host can set:** the text size at least 6 px, and the row height at least the text size, clamped where the font is read (in render, where the rem size is known), so a row is never shorter than its text's em box and the scroll model never divides by zero. Not clamped further: a row the height of its text clips descenders, as CSS's `line-height` would, and that's the host's choice, the same on a DOM side. `density()` returns what the host set; the layout probe's `row_height` is what's drawn.

### What follows the row height

Everything vertical reads one row height, in effect after the clamp: the scroll model's rows (`viewport_rows`, recomputed by `set_density` itself through a step factored out of `set_body`, which returns early when the body's bounds haven't moved: today a new row height moves them only because the header follows the row, which a header height of its own would end; the top row kept, or the tail while following, as a window's resize keeps it), a wheel's line delta (a line is a row, as now), `follow`'s test of whether a move is more vertical than sideways (`scroll_by` weighs the rows moved, in pixels, against the sideways pixels), every hit test that turns a y into a row (`hover_at`, `cell_at`, `select`'s `target_at` and `cell_clamped`), the header's height (it follows the row, as `DataTable`'s does unless set apart; a header height of its own is a later note), the gutter's rows, the jump's tint and edge, `select`'s tint and active cell, `sort`'s arrow box, `resize`'s bands (the header's height), the cells' line height (the text centred in the row), and `custom-cells`' bar inset: 6 px at 30 today, a fifth of the row, rounded (4 px at 18), so a bar stays the same share of a shorter row. The probe's `row_height` already exists; scripts and contenders that read it follow without change.

### What follows the text size

Every horizontal length the base fixes for 14 px text scales with it, rounded to whole px (GPUI lays out in whole device pixels; at DPR 1 a half pixel moves). The scale is the text size over the default's **in the text size's own unit**: a `px` text over 14 px, a `rems` text over 0.875 rem. The base's lengths are fixed pixels that don't follow the rem, so the default (`rems(0.875)`) must be a scale of 1 at any rem size, or merely building the feature would widen every column at a 20 px rem (17.5 px text over 14); and a `px` text must not follow the rem either, or `px(11.)` would lay out 94 px floats at a 16 px rem and 75 px at 20 with the text the same. A `rems` text below the default scales with its ratio to it, whatever the rem. So: the cells' padding (8 px a side, `round(8 × scale)`: 6 at 11 px, 7 at 12), each kind's width (`round(width × scale)`: a float 94 px at 11), the header name's estimate and the gutter's (`round((7.5 × characters + 24) × scale)`, rounded once on the total, not per character, which differs by up to 2 px a column). So a host that sets only a smaller text gets a table scaled as a whole, the rows apart. What follows the font already keeps following it, read at the new size: `number_px` (`Glyphs::read`, once per size, not per value), an integer column's fit, a float's budget, `sort`'s arrow room (`arrow_px`), `resize`'s fit (`text_width`), and the tooltip's test of whether a cell is cut (`text_width` against the width less the padding, which must be the scaled padding, or a value shown whole at 11 px would still open a tooltip, and one cut at a large text wouldn't). A set width (`TallTableColumn::width`) isn't scaled: it's the host's number. The header's text follows the cells'. **The tooltip doesn't:** it's for reading a value's exact text, in the theme's size and padding, and a dense table is exactly where its text should stay readable.

### A set width without `resize`

`TallTableColumn::width` moves out from behind `resize` to either feature (`any(resize, density)`). Without `resize` a set width is clamped to the table's defaults (40 × scale to 1200 px, the least scaled as the padding is: at 40 px a float shows two characters at the default text, and at 24 px text a fixed 40 would leave 11 px of budget (40 less a padding of 14 a side, less the 1 px slack), not one character; `min_width`, `max_width`, and `resizable` stay `resize`'s, since without a drag or a fit nothing else sets a width), and no event reports it (`ColumnWidthsChanged` is `resize`'s). With `resize`, it's the same field a drag and a fit write, as now, and a column's least unless set (`MIN_WIDTH`) is scaled the same way; a host's own `min_width` isn't. In both, a name wider than the set width is cut, as with `resize` today.

### Frame-work risk

Checked with a spike ([`perf/results/2026-11-01-m10-a-spike.md`](../../components/tall-table/perf/results/2026-11-01-m10-a-spike.md), where its numbers are): the constants edited to a dense setting, the wide shape against the base in one session. Work grew about in a straight line with the cells on screen, with no jump for the small text or the short row, so `density` needs no optimization of its own; its cost is the cells a host asks for. At the dense setting every reference segment fell behind the display, one of them with its work under a frame, so work per frame doesn't say where the rate is lost; the frames presented against the base's do, and the build's measurement finds where over a few dense settings. Making each cell cheaper (the cells' text drawn by one element rather than a `div` each) would help every host and every density: an open question in the table's `PLAN.md`, not this feature's.

**Two gaps in the scripts** the spike found, both part of the build's measuring: `perf.ts`'s late frames come from rAF intervals, which Chromium kept firing on time while GPUI drew on every other one, so a dense run read 0% late; and presented frames alone don't flag it either (the base presents on only some rAFs while keeping up, since not every rAF has something new), so they're counted against the base's in the same segment. And the throttled fling can't finish in the script's 30 s wait at that density.

### Canvas gaps

None new. A smaller text is the browser's zoom's business on a DOM grid (Ctrl+= scales its text and rows together); on the canvas the rem size scales the default text (it's in rems) but a host's `px` density doesn't follow a page zoom any more than the base's row height does today. The README says so with `density`'s limits.

### What a DOM contender does

Three CSS numbers and the virtualizer's row size: `height` and `line-height` on a row and the virtualizer's `estimateSize`, `font-size` on the grid, and each column's `size`; its padding and kind widths from the same rules. Its cells match only if its widths, padding, and budgets do, so a fixture pins them: `fixtures/density.json`, cases of a row height, a text size, the rem size, a view's height, and the columns' kinds or set widths → the rows in view, the header's height, the padding, each column's width and budget, a set width's least, and the bar inset; `number_px` at each case's text size pinned from the bare host in Chromium (as `cells.json`'s is from the contender; provisional until then), since a DOM side can't read GPUI's advances. A DOM contender's test names it skipped until the observatory builds a level with `density`.

### What the random test gains

A `density` step (a row height and a text size from a few pairs, the default among them), placed from each case's scheduler seed rather than drawn, so the other features' controls keep their draws (as `pin`'s step is). A change of row height changes the viewport's rows, and so which pages are wanted, through `set_body`'s path: no new paging code and no new invariant, but the paging sees a new input, so the soak runs on the final build (the table's `CLAUDE.md`, rule 5).

---

## The flash's frames

Researched 2026-11-04, from the observatory's market watch spike ([its results](../../apps/observatory/perf/results/2026-11-04-m10-a2.md)), a CPU profile of the bare host under its flashing feed, gpui-pre 0.3.11's frame (`window.rs`: `request_animation_frame`, `mark_view_dirty`, `paint_layer`, `reuse_paint`; `view.rs`: `cached`; `scene.rs`: `push_layer`, `insert_primitive`, `replay`; `bounds_tree.rs`; `text_system/line.rs`: `paint_line`; `text_system/line_wrapper.rs`: `truncate_line`), and the table's `render_body`. One spike, in the bare host: the cells' text drawn four ways ([`perf/results/2026-11-04-m11-a-spike.md`](../../components/tall-table/perf/results/2026-11-04-m11-a-spike.md), where its numbers are).

### What asks for it

The observatory's market watch: a screen where some cell always flashes. While a flash fades the table asks for every frame (`Window::request_animation_frame` in render, which notifies the table's view, and every ancestor with it), and every frame draws every visible cell: in the bare host at CPU 4× with every float flashing, ~17–22 ms a frame, the main thread saturated and 11–21% of frames late at 100 to 50k updates a second, where the same feed without the flash kept up. Its check: the bare host's narrow shape under `?live=<rate>&flash` at CPU 4× keeps up (late frames within the spread of the feed without the flash), and the reference run's work a frame falls.

### Where a flash frame's time goes

Not in the flash. Its quads are a few hundred fills, as `custom-cells`' are. The profile puts ~380 ms a second of the ~780 the frames take in paint, ~300 of it painting the cells' text, and ~400 more in building, laying out (taffy), and prepainting the ~300 cell `div`s. Two costs are the text's own:

- **A `div` per cell.** Each is an absolutely placed element with a text child: taffy lays it out, prepaint shapes its line (from GPUI's line cache), and it's dropped and built again every frame.
- **A layer per line.** Every shaped line paints inside a layer of its own (`paint_line`'s `window.paint_layer(line_bounds, …)`), and every layer is inserted into the scene's `BoundsTree` to find its draw order: a search of the tree for the highest order under its bounds, which takes a short cut only when the bounds meet the last leaf inserted, as a cell's never meets the cell before it. ~190 ms a second throttled went to those inserts. A primitive painted inside a layer takes the layer's order and isn't inserted at all (`Scene::insert_primitive`).

So a frame where only flashes moved costs what any frame costs, and the frame is mostly the cells' text.

### Three ways to cheaper flashing

- **Fewer frames:** fade in steps on a shared clock (say 10 a second), so flashes ask for frames at the steps only. It changes the look (a stepped fade, which a DOM side would copy with `steps()`), and it doesn't help a feed that lands a batch most frames: the observatory's feed comes from a worker each frame, and its rows redraw anyway. Rejected.
- **Cached rows:** each row's cells a cached child view (`Entity::cached`), re-rendered only when its row changed, the flashes and fills drawn outside it each frame. GPUI replays a cached view's paint, but the replay inserts every primitive and layer into the `BoundsTree` again (`Scene::replay`), so the per-line inserts stay; and it needs a pool of row entities, a key per row of everything its text depends on, and a stale cache is a wrong cell on screen. Not needed for the check; a later note if a host needs more.
- **The cells' text from one element:** each region's loaded cells (with `pin`, the pinned region's and the scrolled one's) painted by one element: each cell's line shaped, cut, aligned, and clipped to its cell, and every glyph painted inside one layer over the region. No `div` per cell, no layout for them, and one layer insert a region instead of one a cell. It's the "cheaper cells for every density" the table's `PLAN.md` left open after `density`: frames that draw text get cheaper, scrolling among them.

The spike drew the text each way in the bare host's non-`pin` path: throttled with every float flashing, today's 20.2 ms a frame and 31% late became 12.1 ms with each line painted from one canvas (no `div`s, a layer a line) and 11.0 ms and 0% late with every glyph in one layer; the floor, no cell text at all, is 5.8 ms. At the reference run the wide shape's scroll fell from 8.0 to 4.8 ms a frame and its sideways fling from 8.0 to 4.4; its vertical fling didn't move (p50 4.97 → 5.25 ms over 3 runs, its frames ~45% placeholder rows, which draw no text). So the third, glyphs in one layer.

### On the base, not a feature

It's how the base draws its text, not a capability a host turns on: the same text in the same places, cheaper. A feature would leave every host paying for the `div`s unless it knew to turn it on, and the observatory's base level would compare a GPUI side drawing its slowest way. The comparison's "same scope" rule is about capabilities both sides carry; how one side draws a cell is idiomatic to it. Its bytes are the base's and are recorded, as any change to the base's are.

### What it must keep

The cells as they're drawn today, pixel for pixel (the table's first screens compared with today's, in every browser, shape, paint style, at a density, and with `pin`):

- **The text:** `shown_text` (unchanged, so `cells.json` holds), cut to the cell's width less its padding by GPUI's own `LineWrapper::truncate_line` with "…", at the end for a text or float column and in the middle for an integer or decimal one (today's `truncate` and `text_ellipsis_middle`), in the cells' font and size (with `density`, the size in effect).
- **Its place:** left-aligned for text, right for the numeric kinds, at the padding in effect (`Sizes::padding`), the line centered in the row (the row height as line height: `(row − ascent − descent) / 2` above the ascent, as `paint_line` places it), clipped to the cell (a content mask, which inserts nothing).
- **Its pixels:** today taffy places each cell's `div` and snaps its outer edges to whole device pixels in absolute window coordinates, midpoints toward zero (`taffy.rs`, post-layout absolute edge rounding; the padding keeps its pre-layout rounded value), and the text is placed from the snapped box. The element must snap each cell's box the same way from the same absolute position, or a fractional `scroll_x` or row top moves a glyph by a device pixel. The spike placed the text at the raw coordinates and its screens sat at `scroll_x` 0, so "the same places, by eye" couldn't show it; the build's screens include a fractional scroll.
- **Its color:** the color each cell resolves today (`foreground`, NULL's `muted_foreground`, `custom-cells`' text ramp or contrast pick), per cell.
- **Glyphs as `paint_line` paints them:** each at the line's origin plus its shaped position, at the baseline, `paint_emoji` for an emoji glyph, so a value's text looks as it does.
- **Its layers:** under nothing it's under today. The fills, flashes, jump's highlight, and bars (`custom-cells`' canvas), then the selection's tint (`select`'s canvas), then the text, in each region.
- **Everything else as it is:** the header, the gutter's numbers, a loading row's bars, a failed row's message, and the tooltip stay elements (a few dozen; the gutter's ~30 numbers could join later). Hit tests are the scroll model's (`hover_at`, `cell_at`), not the cells' `div`s, so nothing reads them; the probes report what they did.

### Frame-work risk

The spike measured the drawing, not all of the build's work: it drew no "…" and called no `truncate_line`, padded by a fixed 8 px, and had no emoji path. `truncate_line` adds a width test per cell and a second shaping for a cut one, so a shape with many cut cells (the wide shape at a density) pays more than the spike's 11.0 ms; the build's measurement reads it, and if it shows, the cut is kept per cell text and width between frames. What's left of a cell's cost is shaping (GPUI's line cache, by text and run) and the glyph sprites; the profile's next lever would be GPUI's own `BoundsTree` search, which is upstream's (a scene with many small layers searching a deep tree), worth an issue with the numbers.

### Canvas gaps

None new and none closed: the text was never the DOM's, so selection, find, and screen readers are where they were (the README's "Canvas tradeoffs").

### What a DOM contender does

Nothing: its cells are its own. The observatory's GPUI contender draws through the table, so its numbers move and its placeholder check (its first frame against its HTML shell) must still pass.

### What the random test gains

Nothing: the paging is unchanged, so no soak (the table's `CLAUDE.md`, rule 5).

## `format`

Researched 2026-11-04, from the observatory's market watch board on the observatory's design canvas (https://claude.ai/artifact/6cHBgVwwSqpTad8GP9KnGK, `Main.dc.html`'s `market` rows), its decisions (`apps/observatory/PLAN.md`, market watch's research and spike), the table's cell text (`src/state.rs`'s `cell_text`, `shown_text`, `decide_tooltip`; `src/format.rs`'s `fit_float`; `src/cells_text.rs`'s cut; `src/state/resize.rs`'s `fit_column`), the TanStack contender's `format.ts`, IBM Plex Sans's advances (`shared-web/fonts/IBMPlexSans-Regular.ttf`'s `hmtx`, read with fontTools), and Rust's `{:.N}` against V8's `Intl.NumberFormat` and `toFixed` (Node 26). No spike: the cost is a string a drawn cell, which `fit_float` already makes, and the build measures it.

### What asks for it

The observatory's market watch, whose canvas draws its numbers as a trading screen writes them and not as the table's automatic format does (decided with the user: "the text is the canvas's"). Its twelve columns, at set widths (Symbol 72, Name 150, Last 84, Change 76, Change % 84, Bid 80, Ask 80, Bid size 76, Ask size 76, Volume 96, High 80, Low 80):

- **Last, Bid, Ask, High, Low:** fixed decimals, **picked per instrument**: `toFixed(px < 10 ? 3 : 2)`, `px` the instrument's reference price (the feed's prices are whole cents from 10 up and whole mills under it). So one column holds `84.21` and `9.420`, its trailing zero kept so the column's points line up.
- **Change:** the same decimals, a `+` on a rise (`(ch > 0 ? '+' : '') + f2(ch)`), `-` on a fall, nothing on a zero: `+0.37`, `-0.05`, `0.00`.
- **Change %:** two decimals always, the same sign, a `%` suffix: `+1.23%`. The value is already a percentage (`ch / px * 100`), so the suffix scales nothing.
- **Volume:** a whole number grouped by thousands (`toLocaleString('en-US')`): `4,400,000`.
- **Bid size, Ask size:** whole numbers, **not grouped** (`4400`), as drawn.

Today the table draws every float in `fit_float`'s shortest text (`84.21`, `9.42`, `0.37`, `4400000.0` for a float volume), which isn't the canvas's.

### What `DataTable` and TanStack do

Neither formats: `DataTable`'s cells are the delegate's `render_td` elements, so a host formats as it likes; TanStack Table's `cell` renderer is the app's, which an app writes with `Intl.NumberFormat` or `toFixed`. The table draws its cells' text itself (one element a region), so a host can't hand it an element; the format is a setting the table applies to the value.

### Where it lives

On the column, beside `kind`: `TallTableColumn::format(NumberFormat)`, behind `format`. A format is a fact about a column (Change % is always two decimals and `%`), and the column is what a host already sets once. Two things a column can't say:

- **The decimals per row.** The canvas's are per instrument. Three ways were weighed with the user: the page answers a cell's own (`TallTablePage::decimals(row, column) -> Option<u8>`, `None` for the column's, called as `paint` is: for a drawn cell of a formatted column, each frame, from what the page holds); one count per column (the canvas changed to 2, a sub-10 price's third decimal rounded away); or the count from each value's own size (no hook, but Change's `-0.05` on an 84.21 instrument would get three, and a price crossing 10 would change its width mid-feed). **Chosen: the page overrides** (decided with the user 2026-11-04). It's what trading screens do (a tick size per instrument), and it costs a host nothing unless it answers.
- **A scale.** Change % is a percentage already; the suffix is text, not `Intl`'s `style: 'percent'` (which multiplies by 100). A value to scale is the source's to scale.

**What a format is:** decimals (`Option<u8>`: `None` keeps the automatic format's digits), a sign (`Sign::Negative`, the default, a `-` only; `Sign::Always`, a `+` on a positive too), grouping (a `,` every three whole digits), and a suffix (any text). It applies to the numeric kinds only: a float's value is formatted; an integer's or decimal's text (the source writes them, `CellValue::Text`) gets its sign, grouping, and suffix (its decimals ignored: an integer has none, and a decimal's are its scale, exact). A text column ignores it. Without decimals, a float's text is its exact text (Rust's `{:?}`): grouping applies only to a plain one, never to an exponent (`1e16`, `1.5e-7` keep their form, with the sign and suffix), and a whole float keeps its `.0` (`4,400,000.0`; `decimals(0)` writes `4,400,000`). Separators are fixed (`,` and `.`), not a locale's: a locale is a later note if a host asks.

### The text

- **Rounding:** Rust's `{:.N}`, which rounds the double's exact binary value half to even (`1.125` at 2 is `1.12`; `0.005`, just above half, is `0.01`). The DOM side can't use `Intl.NumberFormat` as it is: V8 rounds the shortest decimal (`0.005` at `halfEven` is `0.00`), and `toFixed` rounds an exact tie up (`1.125` is `1.13`). `format.ts` already rounds the exact value in `BigInt`s for `fit_float`'s ties; its `fixed` does this too.
- **The sign follows the raw value, not the rounded text,** as the canvas's does (`ch > 0 ? '+' : ''`, and `toFixed` keeps a minus): a Change % of 0.0026% is `+0.00%`, a change of -0.001 at 2 is `-0.00`. Only an exact zero, `-0.0` included, has no sign (Rust's `{:.2}` writes `-0.00` for `-0.0`, so the build drops it), nor does an integer's or decimal's text whose digits are all zero (`0`, a written `-0.00`). Chosen with the user (2026-11-04) over `Intl`'s `signDisplay: 'exceptZero'` (`0.00%`): the cell's color comes from the raw value too (a text ramp over ±1e-9), so a green cell never reads `0.00%`.
- **Not a number:** `NaN` and `inf` show their exact text, unformatted; NULL stays `NULL`.
- **The minus stays `-`** (U+002D), weighed against U+2212 `−` (asked 2026-11-04). The `+` is ASCII U+002B too, 8.4 px at 14 px as a digit is; `−` is 8.4 and `-` 5.586. What `−` would buy is small: the cells are right-aligned, so the digits and points line up whatever the sign; only the sign's own left edge sits 2.8 px further left for a rise than a fall. What it would cost: the canvas draws `-` (`toFixed`); the exact text, the copy, and every unformatted column (`fit_float`) write `-`, so a formatted column would differ from its neighbors and from its own fallback, and the tooltip's read-back would have to map it; and the placeholder shell's font holds printable ASCII and "…" only (root `CLAUDE.md`), so a placeholder copying a formatted cell couldn't draw it. Not worth it; a later note if a design draws `−`.

### When it doesn't fit

The table never holds its rows, so no width can come from the widest formatted value (only the loaded rows are known, and a width that moved with the scroll would jump). The column keeps its kind's or set width, and a formatted text too wide for it falls back. Three ways were weighed with the user: the automatic format; a cut in the middle, as integers are cut (`+1,2…67.89`, its magnitude lost); a spreadsheet's `###`. **Chosen: the automatic format** (decided with the user 2026-11-04): the cell shows what it shows today, `fit_float` at the column's budget (an integer's or decimal's plain text, cut in the middle as today), so a number's magnitude is never wrong. The sign, grouping, and suffix go with it for that cell.

**"Fits" is a sum of advances, not a shaping.** The formatted text's width is the sum of its characters' advances in the cells' font at the size in effect, read once per font and size beside `number_px` (`Glyphs`: the digits, `+`, `-`, `.`, `,`, and each column's suffix shaped once), against the cell's content box less a pixel, the rule `cells.json`'s budget follows. A text that fits is drawn whole: the cells' text element doesn't cut it (its cut, by shaping against the content box, could otherwise disagree with the sum by a kerning pair or a rounding at another size); the build checks that the font's shaping of the characters a format writes is their advances' sum, so a fitted text never overflows its cell. A DOM side can't measure GPUI's shaping, so a fit by shaping couldn't be pinned for it; a sum over advances the fixture pins can. Plex Sans at 14 px: every digit and `+` 8.4, `-` 5.586, `.` and `,` 3.808, `%` 12.978. A count of characters at `number_px`, as `fit_float`'s budget is, would be wrong both ways: `%` is half again a digit, `,` under half.

### The tooltip and the copy

The tooltip opens for a value the format rounded, not one it only dressed: the shown number, its sign, grouping, and suffix taken off, read back as a float of the value's own width (an `f32` for `Float32`, whose widened value no `f64` text reads back as), is the value or not (`9.420` is 9.42, `+0.37` is 0.37; `84.206` at 2 isn't). A fallback opens it as the base's text does: when its text isn't the exact value (rounded) or is cut. The copy, the sort, and the tooltip's text stay the exact value.

### `resize`'s fit

A formatted column's double-click fit is its widest visible formatted text by the same sum of advances (the formatted text always, even for a cell that falls back at the current width: room for it is what the fit is for), plus the padding and the rule's pixel, rounded up (`digits_width`'s `+ 1`), so the widest cell fits right after.

### The sign's glyph

The observatory left an arrow in Change to this research (a rise and a fall shouldn't differ by hue alone). Plex Sans has `↑` and `↓` (U+2191, U+2193, 11.48 px at 14 px, wider than a digit, so not tabular) and no `▲` or `▼`, which GPUI can't draw (it draws only that face). **No arrow is needed for the text:** Change and Change % already say a rise or a fall in their `+` and `-`, which a reader who can't tell the colors apart reads; the colors without text are the flash on Last, Bid, and Ask, which the observatory's lighter rise and darker fall answer. The canvas draws none, and the format adds no sign glyph of its own; a `Sign` variant is a later note if a design draws one.

### Frame-work risk

A formatted cell makes one string a frame, as `fit_float` does for every float today, plus a sum of advances; a page's `decimals` is a call a drawn cell, as `paint` is. Measured in the build: the scroll and flings in the bare host with every float formatted, against the feature built with no format (the control) and the base.

### Canvas gaps

None new. The text is drawn, not the DOM's, as before; the tooltip still gives a rounded value's exact text.

### What a DOM contender does

The TanStack contender's `format.ts` gains the same format (its exact rounding, not `Intl`'s, above), and the fit by the fixture's advances. `cells.json` gains a `format` section: the advances, and cases of a format, a kind, a value, a page's decimals or none, a width → the exact and the shown text, each with a `why` (a tie, a value rounding to zero with each sign, grouping at 3, 4, and 7 digits, a negative grouped, a suffix, a fallback at a narrow width, an integer's and a decimal's text, NaN, inf, NULL), with negative controls.

### What the random test gains

Nothing: the paging is unchanged, so no soak (the table's `CLAUDE.md`, rule 5).

---

## `reorder`

Researched 2026-11-13, from the table's column model and every place a column's number crosses to the data (`src/state.rs`: `set_columns`, `lay_out`, `note_flashes`, `render_body`'s reads of `value`, `paint`, and `decimals`, the tooltip's `value`; `src/state/copy.rs`'s turn; `src/state/resize.rs`'s fit; `src/state/sort.rs`'s call to the delegate), the header's presses (`src/state/select.rs`'s `target_at` and `press_select`; `resize`'s bands; `sort`'s arrows), `DataTable`'s column move in gpui-component 0.9.1 (`src/table/state.rs`: `col_movable`, `render_th`'s `on_drag`, the header's `on_drag_move` and `on_drop`, `drag_gap_at`, `move_column`, `TableEvent::MoveColumn`; `src/table/column.rs`: `Column::movable`, `DragColumn`; `src/table/delegate.rs`: `move_column`), GPUI's drag threshold (gpui-pre 0.3.12, `DRAG_THRESHOLD`, 2 px), and TanStack Table's column ordering (v8: `columnOrder`, an array of ids; the drag is the app's). No spike: a move draws the cells a frame already draws, in another order (below).

### What asks for it

- **Tycho:** a query's columns put side by side to compare, without rewriting the query; Tycho adopts every feature.
- **`group-headers`** depends on it: a group must move whole (the table's `PLAN.md`, "Columns").
- **No observatory scenario** asks for it, and TanStack has no drag of its own to compare: a feature level would compare the app's drag code on each side.

### What `DataTable` does

- **The model:** `col_movable` on the table (on by default) and `Column::movable` (on by default). A header is a GPUI `on_drag` source (`DragColumn`: the column, its name and width); the drag starts past GPUI's 2 px threshold and draws a preview, a box in `table_head` at 0.9 opacity with a border and a shadow, the column's name in it, its width clamped to 100–450 px, following the pointer.
- **The gap:** while the pointer is over the header row (`on_drag_move`, its bounds containing the pointer), `drag_gap_at` finds the gap after the last column whose center is left of the pointer, among the columns of the pointer's region (the fixed ones, or the scrolled ones in view). No gap, and so no move, when the pointer's region isn't the dragged column's own (a fixed column can't leave the fixed run, nor a scrolled one join it) or when the gap is either side of the dragged column. The gap draws as a 2 px line in `drag_border` at its column's left edge (the last column's right edge for the gap after it), the header's height only.
- **The drop:** on the header row alone; a drop elsewhere moves nothing. `move_column(from, to)` tells the delegate first (which moves its own columns: the delegate's `render_td(row, col)` reads by the new index), moves its column group (width, sort, and the rest travel with it), and emits `MoveColumn(from, to)`.
- **What it skips:** the selection (`selected_col`, `selected_cell` are indices and aren't moved, so a selected column's selection lands on its neighbor), one column at a time, no sideways scroll during the drag (a column moves only within the view, or a step at a time), no Escape, no move by keys.
- **Nothing to reuse but the rules:** its preview and drop are elements and GPUI's drag machinery, its header a flex row of elements; the tall table draws its header as positioned cells and runs its drags itself (`resize`'s `Resizing`, `select`'s `selecting`, never a `Drag`), so a press, a drag, and a release on its own canvas handlers. What carries over: the 2 px threshold, the gap by column centers, the line in `drag_border`, a preview in `table_head`.

### TanStack Table

`columnOrder: string[]`, the column ids in drawn order; `getVisibleLeafColumns` and the rows' cells follow it, and pinned columns go to their side after the order is applied. The data isn't touched: a cell reads its row by its column's accessor, whatever its place. The drag is the app's (dnd-kit or pointer events), so a DOM contender's move is its own code.

### A place, and the column's own index

Who moves the columns: the host (as `DataTable`'s delegate does), or the table.

- **The host:** the table emits a move and the host passes the columns again in the new order, and its source reads them in that order. Here a page holds every column of its rows by its index in `set_columns`' list, so the source would change its query's column list and every loaded page would be read again (the wide shape's are ~4 MB each), for a gesture that changes no value. And `set_columns` cancels a copy and clears the selection. Rejected.
- **The table:** it keeps an order, each drawn place naming a column's index in `set_columns`' list, and a page is read by that index. Nothing reaches the delegate; no page is read again. TanStack's model.

So a column has two numbers once it can move: its **place** (where it's drawn, 0 at the left) and its **index** (its place in `set_columns`' list, which the pages use). Without the feature they're equal. Each of the table's numbers takes the one its meaning follows:

- **Places:** what's about where columns are on screen. `select`'s ranges (`Columns` and `Cells` span the places between the anchor and the head, as the reader sees them), the keys' steps, `pin`'s count (the first *n* places), `copy`'s column order (the text in the order on screen, as a spreadsheet copies), the hit tests, the layout probe's columns (in drawn order, each with its index), and the cell probe.
- **Indices:** what belongs to a column wherever it is. The page's `value`, `paint`, and `decimals`; `live`'s flashes (keyed by row and index, so a move doesn't move a flash off its cell); `sort` (`Sort::column` and the delegate's `sort` name an index: the source sorts its own column, and a sort follows its column across a move with no remapping); `ColumnWidthsChanged` (in index order, `set_columns`' order, since a host passes widths back through it); and everything set on `TallTableColumn` (widths, `custom-cells`' paint, `format`, `resizable`, `sortable`), which travels with the column.

The state keeps its columns in drawn order, each laid-out column holding its index: everything read by place reads as today, and only the sites that cross to the data go through the index: the page reads (the cells, their paint and decimals, the tooltip, `resize`'s fit, `copy`'s turn; the probe's last cell stays index 0's, as the scripts read it), the flash's compare, `sort`'s call to the delegate, and the widths event. `set_columns` sets the order to the list's own (each place its index); a host that keeps an order across it calls `set_order` after, as a host keeping its selection calls `select`. Weighed: keeping the order by the columns' names across `set_columns` (as `sort` is kept), but a new query's columns are a new list, and a rule for names that appear, vanish, or repeat is the host's to choose.

### The gesture, and `select`'s header press

The header has three presses today: `resize`'s band at a column's right edge, `sort`'s arrow, and with `select` a press anywhere else on a header cell, which selects the column, a drag extending the `Columns` range across headers. A drag to move a column must share the header with that drag.

- **Without `select`, or with its `Columns` kind off:** a press on a movable column's header (not its band or arrow) that moves past 2 px starts a move of that column, as `DataTable`'s.
- **With the `Columns` kind on: Google Sheets' rule.** A press on a header inside the selected `Columns` range, past 2 px, moves the whole range (a block of columns, every one movable, or no move); a press anywhere else selects as today, its drag extending the selection. A press inside the range that doesn't pass 2 px selects the pressed column alone at its release (the selection a plain press makes today), since the press can't know yet whether a move follows. Shift and Cmd presses select as today. So moving a column with `select` is a press to select it, then a drag; a block is a range selected, then dragged.

Weighed: a grip at the header's left (a target of its own, but it takes a cell's room in 56 px dense columns and the header's text), a hold before the drag (slow, and unlike either reference), and `DataTable`'s rule beside `select` (a header drag can't both extend a selection and move a column).

### The drag

- **The gap** is `DataTable`'s rule over the pointer's x at any height (the drag is window-wide, as `resize`'s and `select`'s are, so the pointer can leave the header without dropping nothing): among the visible columns of the pointer's region (with `pin`, the run in effect or the scrolled columns), the gap after the last whose center is left of the pointer; left of the cells, the region's first gap, and right of the last visible column, its last. A gap inside the block or either side of it is none: a release there moves nothing. The exception is `pin`'s edge (below): the run's end beside a block wholly on one side, with the pointer on the other, pins or unpins the block where it is.
- **Sideways while dragging:** a wheel during the drag scrolls the body sideways and the gap follows the pointer over the columns that came into view, as `select`'s drag does (a window-wide wheel through `on_scroll_wheel`). No scroll at the view's edge on its own: `select` has none either (one timer for both, later, if a host asks; a note in the README's limits). Moving a column across the wide shape's 500 columns is a wheel's work, or the host's `move_columns`.
- **Escape** cancels the drag, nothing moved; the key goes no further.
- **The release** moves the block to the gap: the order changes, the columns are laid out again (`lay_out`, at their widths: no re-read, the cache untouched), the sideways scroll kept and clamped, and `ColumnsMoved` emitted with the order after. The moved block lands under the pointer only roughly; the view doesn't scroll to it.

### What a move does to the rest

- **`select`:** a `Rows` selection is kept. A `Columns` or `Cells` range whose places are all inside the moved block moves with it (the Sheets gesture leaves the block selected at its new places); and in general a range is mapped column by column: if its columns are still a contiguous run of places it's kept as that run (its rows kept, its direction kept, the anchor at the run's end on its side), which covers a range outside the places the move shifts (unchanged), one inside them alone (shifted by the block's length), and one holding the block and every shifted place (unchanged); any other is no longer contiguous and is cleared. `Selected` is emitted whenever the range's places change, with the new range, or `None` when cleared, so a host mirroring it by place stays right.
- **`pin`:** the count is of places, so a move across the run's edge changes which columns pin unless the count changes too. The reader dragging a column into the run means to pin it, and out of it to unpin it, so the count changes by the columns that crossed, a change on the count rather than a recount (a host's count past the columns is kept as it is when nothing crosses; when something does, the change applies to the count clamped to the columns). The block lands in the run when its place after the move is within the run that's left (the clamped count, less the block's pinned columns); at the run's end, the one place both sides share, the pointer's side of the run's edge decides (left of it, the block joins the run at its end; right of it, it's the first scrolled). That makes the gap beside a block at the edge a move after all, one that only pins or unpins: the last pinned column dragged just past the edge unpins where it is, the first scrolled one dragged just left of it pins. A host's `move_columns` can't know a pointer's side, so at the run's end the block keeps its first column's side, and `move_columns_pinned` takes the side as an argument, which the drag's release calls; the fixture pins both. `set_order` is a whole order, not a move: no column crosses, so it keeps the count as a count of places (the first *n* drawn pin, whichever they are), and a host restoring an order with its pins sets the count after. The cap at half the cells' width then applies as to any count (`Pinned` if the run in effect changes): a block that doesn't fit doesn't hold, and the host's count says it was asked to. While the count passes the run in effect (a narrow view), a gap among the pinned-by-count columns drawn scrolled pins the block too, as those columns are. `DataTable` refuses a move across instead (its flags would be wrong); weighed and not taken, since with a count the move is the natural pin and unpin gesture. The count changed this way is the host's count: `set_pinned`'s value, read by `pinned()`, reported by `ColumnsMoved` alongside the order.
- **`sort`:** nothing: the sort names an index and the arrow travels with its column.
- **`resize`, `density`, `format`, `custom-cells`:** nothing: their settings are the column's and travel with it; the widths event stays in index order.
- **`live`:** flashes keyed by index stay on their cells.
- **`copy`:** a copy takes its columns' indices and names when it starts, so a move during it copies the columns as they were when it started; nothing is canceled. Its reads are pages, which hold every column. (This touches `copy`'s turn, so the soak runs: the table's `CLAUDE.md`, rule 5.)
- **`follow`, the paging:** nothing.
- **`group-headers`** (later): a group moves whole, so its research decides whether a drag inside a group stays inside it.

### What's drawn

- **During a drag:** the block's header cells, each at its width, drawn over the header in `table_head` at 0.9 opacity with a 1 px `border` edge, following the pointer's x at the offset where it was pressed (`DataTable`'s preview, at the block's real widths and the header's height, not its 100–450 px box); under it, the block's own header cells are dimmed to `muted_foreground` text so the reader sees what's lifted. The gap is a 2 px line in `drag_border` at its left edge, through the header and the body (a tall body makes the header alone hard to read across), in the gap's region's layer with `pin`. The cursor is the closed hand window-wide during the drag (`CursorStyle::ClosedHand`, CSS `grabbing`), as `resize`'s holds its own.
- **No row or cell moves until the release:** the body draws as before the drag. A drag redraws on a pointer move that moves the preview, as `resize`'s does.

### Frame-work risk

- **Scrolling with a moved order:** a cell reads its page by its column's index rather than its place, an `usize` read from the laid-out column it already holds. Pages are columnar, so a permuted order reads the same columns in another order. Measured: the scroll and flings with the order reversed against the identity order on the same build and the base.
- **The drag:** a frame a pointer move (the preview), the cells drawn as at rest plus the preview's cells and the line, as `resize`'s drag redraws. Measured as its segment: the first float column's header dragged 600 px right and back, twice, a pointer move every 8 ms (the table's `perf/CLAUDE.md`, "Perf script gotchas").
- **The release:** a layout, as a `resize` release's.

### Canvas gaps

- **Pointer only:** no keys move a column (neither `DataTable` nor Google Sheets has them). A host gives a menu or keys through `move_columns`; `context-menu` (next) gives the right-click to hang it on. The README's limits say so.
- **A screen reader isn't told** a column moved; the README's accessibility gap covers it.
- **Copy** writes the columns in their drawn order, as on screen.

### What a DOM contender does

TanStack's `columnOrder` with its own drag (pointer events on the header, a gap by centers, a line), its cells by accessor. Its cells would match only if it computes the same gap and the same after-state, so a fixture pins them: `fixtures/reorder.json`, cases of the columns' widths, the cells' width, the sideways scroll, the pin count, a block, and a pointer's x (and side) → the gap, and the move → the order, the count, and a selection before → after, run natively against the table's own functions, with negative controls (the gap by a column's left edge, not its center; a move beside the block not refused; the count kept across the edge; the selection not moved). The sort following its column is the native tests', not the fixture's (an index, unchanged). A DOM contender's test names it skipped until the observatory builds a reorder level, which no scenario asks for.

### What the random test gains

`Move` steps (a block, a `to`, and with `pin` a side, through `move_columns_pinned` or `move_columns`) and `SetOrder` steps (a permutation), placed from a stream of their own as `density`'s are (the case's seed mixed with a constant of their own), each a `u64` drawn there and expanded into the step (a seeded shuffle for an order: one byte, as `place_steps` gives `pin`'s, can't hold a block and a gap or a permutation), so every case's draw and the other features' places are unchanged. Its rows' text already carries the column (`r{row}c{column}…`), so invariants 5 and 7 gain the column: a drawn cell at a place holds its column's index's text, and a `Copied` text holds the indices the copy started with, in that order. A control that reads a page by place (`ReadByPlace`) must fail at invariant 5. The copy's turn changes (above), so the soak runs on the final build.

## `clicks`

Researched 2026-11-16, from the table's presses (`src/state.rs`: the root's `on_mouse_down`, `cell_at`; `src/tall_table.rs`: the element's press, which hides the tooltip and focuses; `src/state/select.rs`: `target_at`, `press_select`; `src/state/reorder.rs`: `press_move`; `resize`'s bands and `sort`'s arrows, which stop their presses), `DataTable`'s clicks in gpui-component 0.9.1 (`src/table/state.rs`: `on_row_right_click`, `on_cell_right_click`, `on_row_left_click`, `on_cell_click`, the right-clicked row's and cell's borders, the `context_menu` wrapper reading `right_clicked_row`; `src/table/delegate.rs`: `context_menu`), gpui-component's `ContextMenuExt` (`src/menu/context_menu.rs`), gpui-pre-web 0.3.12's pointer events (`src/events.rs`: `register_click`, `register_context_menu`, the touch path), and gpui-pre 0.3.12's gesture recognizer (`src/gestures.rs`: taps as presses, `LongPressEvent`). Drafted as `context-menu` (right- and double-click events); renamed `clicks` here, since it now carries Kirkwood's plain press too (below). No spike: nothing is drawn and nothing runs a frame (below).

### What asks for it

- **Tycho:** a menu on a cell, a row, or a header (copy, sort, pin, move, hide), and a double-click to open a row's detail; Tycho adopts every feature. `pin`'s count and `reorder`'s `move_columns` were left to "a host's menu" in their research.
- **Kirkwood** (asked 2026-11-13, the table's `PLAN.md`, "Asked for by Kirkwood"): a press on a row reported whether or not the selection changed. `Selected` fires only at a change, so the row already selected, pressed again, says nothing, and Kirkwood's camera can't fly back to it. This is the same shape as a right-click's event (a press, its kind, what it's on), so it's one feature: a press, a double press, and a context press.
- **No observatory scenario** asks for it, and TanStack has nothing (a row's `onClick` and `onContextMenu` are the DOM's): no feature level.

### What `DataTable` does

- **Events:** `RightClickedRow(Option<usize>)` (a row, or `None` for the empty area), `RightClickedCell(row, col)` (cell selection only), `DoubleClickedRow(row)`, `DoubleClickedCell(row, col)`. The right-click events fire on the right button's press; the double-clicks on the second click's release (`ClickEvent::click_count() == 2`). There's no plain-press event apart from `SelectRow`/`SelectCell`, but `set_selected_row` emits `SelectRow` on every click, the same row or not, which is what Kirkwood lacks here.
- **The selection:** a right-click doesn't change it. The right-clicked row or cell is remembered (`right_clicked_row`, `right_clicked_cell`) and drawn: a 1 px `selection` border round the row, a half-opacity `table_active_border` round the cell, until a left click selects something else.
- **The menu is the table's:** the table's inner element is wrapped in `ContextMenuExt::context_menu`, whose builder calls the delegate's `context_menu(row, menu)` for the right-clicked row. A cell's menu has no hook of its own.
- **What carries over:** the events' kinds, the right press's timing, and the empty area as a target of its own. Not the menu (below), not the remembered target drawn apart from the selection (below), and not the double-click on the release (below).

### The browser and GPUI

- **The right button reaches GPUI:** gpui-pre-web maps a `pointerdown`'s button 2 to `MouseButton::Right` and always `preventDefault`s `contextmenu` on its canvas, so the browser's own menu never shows.
- **A Mac browser's Ctrl+click** is a `pointerdown` with button 0 and `ctrlKey`, then a `contextmenu` the canvas swallows: GPUI sees a left press with `control`. `select` already ignores Ctrl+press for this reason ("`select`", "The pointer").
- **`click_count`** is gpui-pre-web's own: 400 ms and 5 px from the last press, whatever its button (a right press then a left press within them counts 2). A Ctrl+press counts as well. So the table can't read a double press off `click_count` alone (below).
- **A second button while the first is held** arrives, under Pointer Events, as a `pointermove` with its `buttons` changed, never a `pointerdown`: a right press during a left drag never reaches GPUI as a press, and gpui-pre-web's move keeps the left as its pressed button.
- **Touch:** gpui-pre's portable recognizer turns a tap into a left press and a double tap into one with `click_count` 2, and a hold of 500 ms without moving into a `LongPressEvent` (`TouchPhase::Started`, at its start). The browser's long-press menu is the canvas's `contextmenu`, swallowed too. So a long press is the touch screen's right-click, as gpui-kit's `ContextMenuExt` already treats it.
- **`ContextMenuExt`** opens a gpui-kit `PopupMenu` on a right press (bubble phase, stopping it) or a long press over its element, at the pointer, and builds it in a deferred call. Wrapped round the table, it runs after the table's own handler (the inner element's bubble listener goes first), so the table's target is set before the menu reads it, as long as the table never stops a right press. It captures the focused element at the press and gives focus back to it when the menu closes. It doesn't open on a Mac browser's Ctrl+click (a left press).

### Who draws the menu

- **The host** (chosen, 2026-11-16): the table reports the press, what it's on, and where, and a host draws its own menu, most simply by wrapping the table's element in `.context_menu(…)` and reading the target from the event. The feature stays an event and a hit test, and the table, which reports through events (its `CLAUDE.md`, rule 1), never decides what a menu holds.
- **The table, as `DataTable`'s:** a delegate method building a `PopupMenu`, drawn by the table. Simpler for a host, but gpui-kit's menu (its items, keys, submenus, and focus handling) would link into every build with the feature, and a host with a menu of its own (Tycho's, which may hold a filter field) would pay for both. Not taken.
- **The Ctrl+click gap:** a host using `ContextMenuExt` gets the context event on a Mac browser's Ctrl+click but no menu, since `ContextMenuExt` waits for the right button. The table can't open a host's menu. A gpui-kit web gotcha, not the table's; checked in the browsers before it's written into `.claude/rules/gpui-web.md` and looked for upstream.

### The presses

Three kinds, each with what it's on and where:

- **The table counts left presses itself,** since `click_count` counts every button's: a left press's count is the last left press's plus one when `click_count` is 2 or more and the last press the table saw was a left press it counted, otherwise 1. So a left press after a right one is a first press, and a double press always follows a press.
- **A press:** a left press the table counts first. On the press, not the release: `Selected` changes on the press, so a host acting on a press acts in the same frame as the selection, and a press that starts a drag (a selection, a column's move) is still a press. Weighed: a click on the release, as `DataTable`'s, which would leave out a press that drags; but a host that wants that can watch the drag's events, and Kirkwood's flight should start with the press, as its selection does.
- **A double press:** a left press the table counts second; a third and after report nothing. The first press was already a press. On the press, as the first was (`DataTable` reports it on the release). The target is the second press's.
- **A context press:** the right button's press; a touch's long press, at its start; and a left press with Ctrl when the host says it's one (`set_ctrl_press_is_context`, off by default). In a Mac browser Ctrl+click is the right-click; on Windows and Linux it's the add-to-selection gesture of most tables, and making it a context press would open a host's menu and, with `select`, replace the selection (Sheets' rule, below) on a press that today does nothing. The table can't tell the system (it knows no `navigator`, and gpui's `Modifiers::secondary` is Mac-only by `cfg`, never true on wasm), so the host, which can (`shared/`'s bootstrap already asks for Mac browsers' key bindings), says so (the table's `CLAUDE.md`, rule 1: what only a host knows comes in as settings). Off, a Ctrl+left press is a press whose modifiers say Ctrl, and `select` ignores it as today.

**What it's on:** a cell (its row, an `u64`, and its column's place), a row's number in the gutter (the row), a header cell (the column's place), the corner over the gutter, or a blank: inside the table but on no row or column (below the last row, past the last column), `DataTable`'s `RightClickedRow(None)`, where a host may still want a menu (paste, the table's settings): any point of the header row or the body, gutter included, where the hit test finds nothing. Not on the bands, the arrows, or the scrollbars: they stop their left presses today (the band's double press stays `resize`'s fit) but not a right one, and the scrollbars don't occlude, so a right press there would reach the root and hit-test the cell under them. With the feature they stop a right press and prevent a long press's default too: nothing reported, and a host's `ContextMenuExt`, which opens only when nothing prevented it, doesn't open there with the last target, now stale. The column is a place, as every screen number is (`src/CLAUDE.md`, "Places and indices"); a host turns it into its index with `order()` (`reorder`).

**Where:** the pointer's window position, so a host's own menu (one not hung on `ContextMenuExt`) can be placed, and the modifiers, so a host can tell Shift+press from a press.

### What a press does to the rest

- **`select`, a press and a double press:** as today (a press selects; a double press's second press selects nothing, keeping what the first selected). The event follows what the press did to the selection, so a host reading `selection()` in its handler sees the press's result. Except with `reorder`: a press inside the selected `Columns` range may start a move, so it selects its column only at a release that didn't drag; its press is reported with the range still selected, and `Selected` follows at the release.
- **`select`, a context press: Google Sheets' rule.** A context press inside the selection keeps it, so the menu acts on the range; anywhere else it selects what's pressed as an unmodified press would (Shift doesn't extend: a plain Shift press extends and starts a drag, and a right press that started a drag would leave one running after the menu opens), no drag starts, and the menu acts on that. Inside means: on a cell the selection covers (a `Cells`, `Rows`, or `Columns` range over it); on the gutter, a `Rows` range over the row; on a header, a `Columns` range over the column; on the corner, any selection. A blank changes nothing. `DataTable` leaves the selection alone and draws the right-clicked target apart, a second highlight a menu's reader must tell from the first; Sheets, Excel, and Finder select it.
- **Drags:** a context press during a selection's drag, a column's move, or a resize does nothing (no event, nothing changed); the drag's own release ends it. In a browser only a long press can come mid-drag (a chorded right press is a move, above); the rule is for it and for platforms that send a chord as a press.
- **The tooltip and focus:** a context press hides the tooltip and focuses the table, as a left press does, so a menu hung on `ContextMenuExt` gives focus back to the table when it closes.
- **`reorder`:** a press that may start a move is reported at the press; a double press never drags (as today). **`resize`, `sort`:** their presses stop at the band and the arrow and aren't reported. **`copy`, `pin`, `live`, `follow`, the paging:** nothing.

### What's drawn

Nothing. With `select` the selection shows what a context press is on (Sheets' rule, above); without it, the host's menu at the pointer does. `DataTable`'s remembered right-click borders aren't carried over.

### Frame-work risk

None while scrolling: the feature adds listeners each frame and nothing in the cells or the paging: on the root a right-press listener, a long-press listener, and a left one (the base registers none; `select` and `reorder` do, and the feature's branch joins theirs); the element's right press, for focus; and with `resize`, `sort`, and the scrollbars a right-press stop on each band, arrow, and track (a band a visible column). Measured anyway: the scroll and flings on the `clicks` build against the base, the reference run, at the same place in a session.

### Canvas gaps

- **No key opens a menu.** A keyboard's menu key (and Shift with the tenth function key) opens `contextmenu` on the focused element, which the canvas swallows; GPUI gets the key as a key. A key binding for it is the host's (a context press needs a target, and the keys' target is the selection's head), a line in the README's limits.
- **A screen reader isn't told** of a menu's target; the README's accessibility gap covers it.
- **Touch:** the long press is the only way to a menu; a host must hang its menu on the event or `ContextMenuExt` to get it.

### What a DOM contender does

Nothing: no scenario, and TanStack has no click handling of its own. No fixture: the hit test is `select`'s (`target_at`), and there's no rule a contender would have to match.

### What the random test gains

Nothing: the feature touches no paging, no cache, and no state a step reads. No soak (the table's `CLAUDE.md`, rule 5).

## `group-headers`

Researched 2026-11-16, from the table's header (`src/state.rs`'s `render_header` and its layers over it: `sort`'s arrows, `resize`'s bands, `pin`'s edge line, `reorder`'s gap line and preview), its hit tests (`src/state/hit.rs`: `target_at`, `header_place_at`, each finding the header as the row above the body), `reorder`'s gap and move (`src/reorder.rs`: `Move`, `gap`, `View`), `pin`'s regions (`src/pin.rs`, `src/state/pin.rs`'s `split_layer`), `DataTable`'s group headers in gpui-component 0.9.1 (`src/table/column.rs`: `ColumnGroup`; `src/table/delegate.rs`: `group_headers`, `render_group_th`; `src/table/state.rs`: `update_header_layout`, `HeaderCell`, `header_band_height`, the header's rows in `render_table_head` and `render_fixed_head_cols`, `move_column`), and TanStack Table's header groups (v8: nested `columns` definitions, `getHeaderGroups`, `getLeftHeaderGroups`/`getCenterHeaderGroups`, a header's `isPlaceholder` and `colSpan`). No spike: a group's cell is a header cell over several columns, and a frame draws at most one more per visible column per level (below).

### What asks for it

- **Tycho:** a DuckDB `STRUCT` column draws as `<struct>` today (`engines/duckdb/crate/src/arrow.rs`). Flattened to its fields, which is the engine's work and not this feature's, the fields would sit under their struct's name, and a nested struct under each level's name. Tycho adopts every feature.
- **No observatory scenario** asks for it. TanStack has header groups, so a feature level could compare them, but none is planned.
- **The order** put it last because it depends on `pin` and `reorder` (the table's `PLAN.md`, "Columns": "a group must move and pin whole").

### What `DataTable` does

- **The model:** the delegate's `group_headers()` returns rows of `ColumnGroup { label, span }`, outermost first, any number of them. Each row's spans count columns from the left by position. A row's spans don't have to cover every column, and the columns past them get no group cell. `update_header_layout` turns each group into a cell as wide as its spans' columns, and the column names become a last row. Each header row is the row height; the header is that times the rows.
- **Drawing:** the group rows aren't virtualized (every group is drawn; "far fewer cells"). Each group cell is centered text with a right border; each row has a bottom border. With fixed columns, a group cell is drawn in the region where it starts, at its full width.
- **Position, not identity:** a group spans places. `move_column` moves the column and its `ColGroup` but not the spans, so a column moved out of its group takes the group's label of wherever it lands, and the group keeps its count of columns. A resize updates the groups' widths.
- **Presses:** none on a group cell: no select, sort, resize, or drag. A column's own header drags as without groups, anywhere among the columns of its region.
- **Nothing to reuse but the shape:** its header is flex rows of elements. The tall table draws positioned cells in regions, so it carries over the rows over the names, the cell a group spans, and a row's height.

### TanStack Table

Groups are a tree of column definitions (a group's `columns`), so a group belongs to its columns. `getHeaderGroups` builds one row per depth, deepest last. A leaf shallower than the tree gets placeholder headers (`isPlaceholder`) in the rows above it, and a group's cell spans its leaves (`colSpan`). The rows are built from the leaves in drawn order: when `columnOrder` or pinning leaves a group's leaves apart, the group appears once per run, each a header of its own with the same column definition. Pinning builds each region's rows apart (`getLeftHeaderGroups`, `getCenterHeaderGroups`), so a group across the edge is drawn twice. The drag is the app's, so keeping a group whole is the app's too.

### Groups on the columns, by label

Two models: spans by place, set on the table (`DataTable`'s), or a label path on each column (TanStack's tree, flattened).

- **Spans by place:** a move changes a column's group (above), and `reorder` has kept everything that belongs to a column by its index since `reorder` was built (`src/CLAUDE.md`, "Places and indices"). With spans, every move would have to rewrite them, and a host's `move_columns` or `set_order` would have to come with spans. Rejected.
- **A label path on each column:** `TallTableColumn::group(["Astrometry", "Position"])`, outermost first, travels with its column by index as every other setting on `TallTableColumn` does, and `set_columns` brings new groups with new columns. A group is a run: at level *i*, neighboring places whose paths are both deeper than *i* and agree through *i* share one cell. So a group split by a host's `move_columns` or `set_order` is two runs, drawn as one cell each, both labeled, as TanStack does. `pin`'s edge doesn't cut a run: it splits only the run's drawn cell ("Drawn", below), so a press, a selection, and a move still take the whole group. Two separate groups with the same path become one run when they're neighbors; a host that wants them apart names them apart. The owner chose this model.

**Any depth,** as `DataTable` and TanStack allow and nested structs need. The header has one row per level of the deepest path plus the names' row. Level *i* is header row *i* from the top. A column whose path is shorter than the deepest has blanks under its last group, down to its name, which is always in the bottom row (TanStack's placeholders). With no column grouped, the header is one row and the base draws as today.

### Drawn

- **Each group row is the row height** (`density`'s, through `sizes()`), as `DataTable`'s are. The header grows by a row per level and the body loses it: the viewport is the body's bounds, so a change in depth refits the visible rows as a window resize does, and the paging is unchanged.
- **A group's cell** spans its run's columns at their laid-out x and widths, cut to each region's visible part: a run across `pin`'s edge in effect draws two cells, one a region, each labeled. The run in effect changes without `lay_out` (`repin`: a window resize, `set_pinned`, a resize's release), so the cut is the frame's, not the runs'. A cell is cut to what's visible: a cell that starts left of the view is drawn from the view's left edge. A 1 px `border` line at its right and its bottom. A blank cell draws nothing, the header's `table_head` showing through.
- **Its label** is drawn at the left of the cell's visible part, plus the padding, and truncated to that part. So a wide group scrolled half out of view keeps its name in view, which a centered label (`DataTable`'s) loses: in the wide shape, a group of 50 columns is 6,000 px wide.
- **The names' row, the arrows (`sort`), and the bands (`resize`)** are the bottom row's, as today. The hit tests already find the header as the row above the body, so they hold. Today the arrows and bands take the header's full height, so they move to the bottom row. `pin`'s edge line and `reorder`'s gap line run through every header row. The corner, over the gutter, is one cell the header's full height: `target_at` finds it only in the row above the body today, so its hit test grows with the header.
- **With `select`,** a group's cell takes the selection's tint when every one of its columns is among the selection's columns, in any kind (`selected_lines`), as a column's header does.

### The presses

The owner chose presses for the group cells: `DataTable` has none, and a press is the only way to select or lift a group as one.

- **`select`:** a press on a group's cell selects as a press on its first column's header followed by a Shift+press on its last would. In the `Columns` kind, that's the group's columns. Shift+press on a group's cell extends the range to the group's far edge from the anchor. A drag starting on a group's cell doesn't extend the selection (below). A press on a blank selects as a press on the column below it.
- **`reorder`:** a drag starting on a group's cell, past 2 px, moves the whole group. With `select`'s `Columns` kind on, the press has already selected the group, so the selection moves with it as with any selected block (`reorder`'s Sheets rule). A blank's press drags its column, as the column's own header does.
- **`clicks`:** a new target, `ClickTarget::Group { level, start, end }`, the whole run's places from either half of a cell `pin` split. Fields, not a `Range`, so `ClickTarget` stays `Copy`; and since the variant is behind a feature, the enum becomes `#[non_exhaustive]`, so the bridge (its only matcher) builds whether or not a crate in the build turns the feature on. The bridge publishes the level and places with the target's name. A blank is the column's `Column(place)`. A context press on a group whose columns are all in the selected `Columns` range keeps the range; elsewhere it selects the group, as `clicks`' Google Sheets rule does for a column.
- **Not on a group's cell:** no sort (a group has no order of its own) and no resize band (a group's width is its columns'; `DataTable` has neither).

### Moves keep a group whole

`DataTable` lets a column leave its group (its spans stay), and TanStack leaves it to the app. Here the table's own drags never split a group, and a host's `move_columns` and `set_order` may (they're drawn split, above).

- **A block's parent** is the deepest run that holds every place of the block and more (a run equal to the block is the block itself), or the whole table. A block moves only if it is **whole**: every run deeper than its parent that meets the block lies inside it. A column in a group is whole, with that group as its parent. A group lifted by its cell is whole, with the run around it as the parent. A selected range that cuts a group doesn't move: the press acts as one that never passed 2 px (`reorder`'s rule for a block with a column that can't move).
- **Its gaps** are only the boundaries between the parent's children, inside the parent's span. A child is a deeper run, or a column with no deeper run. The gap is `reorder`'s rule over the children's centers rather than the columns': the gap after the last child whose center is left of the pointer. Left of the parent's span it's the first gap, right of it the last. A gap beside the block is no move, as in `reorder`. With no groups every column is a child of the whole table, and the rule is `reorder`'s.
- **`pin`'s edge** works as in `reorder`. The edge is a gap when it falls on a boundary between the parent's children. A move across it changes the count by the columns that crossed, so a group dragged across the edge pins or unpins whole. A group the host's count split is still one run, so lifting it lifts the whole run, and `reorder`'s count lands a block wholly on one side (`Move::count_after`): the table's drag mends a split and never makes one. A column inside a split group crosses the edge only within the group's span, by the same rule.
- **The preview** is the block's header in every row: its names, and its group cells cut to the block (a lifted group carries its label, and a lifted column under a group carries the group's row as a blank).

### What a group does to the rest

- **`pin`:** the count stays the host's, and the half-view cap applies as today. A run across the edge is drawn as two cells, each labeled, which the owner chose over moving the count to the group's edge: that would make the run in effect differ from the host's count in one more way than the cap already does.
- **`copy`:** the header line (`headers(true)`) stays the names alone. A TSV with one header line stays parseable; the group rows aren't copied.
- **`sort`, `resize`, `format`, `custom-cells`, `live`, `follow`, the paging:** nothing. Every setting stays the column's, and the widths event stays in index order.
- **`density`:** each group row is the row height in effect, its text the cells'.
- **The probe:** the layout gains `header_rows` and `groups`, each drawn cell's level, label, places, left, width, and region, so the scripts and a fixture read what's drawn.

### Frame-work risk

- **Scrolling:** a frame draws each visible run's cell per level, at most a visible column's worth per level, plus the clipping of each label. The wide shape with two levels (groups of 50 columns, and of 10 inside them) draws 3–5 more cells than today's ~12 visible headers: ~1,380 px of cells show 2–3 inner groups (1,200 px each) and 1–2 outer ones (6,000 px). Measured: the scroll and flings with groups against the same build without, and the base. A taller header shows fewer rows (two rows fewer of ~30 at the base's density), so a grouped frame draws fewer cells, and the note compares at the cells drawn.
- **The runs** are worked out in `lay_out`, not a frame: one pass over the columns per level, in drawn order, again when the columns, the order, or the widths change. A pin count doesn't change them; it changes only where a frame cuts their cells.
- **The drag:** `reorder`'s, with the preview's group cells added. Measured as `reorder`'s drag segment with a group lifted.

### Canvas gaps

- **A screen reader isn't told** the groups, or which group a column is in: the accessibility gap the README tracks. *To close it:* the DOM mirror, its header rows as `role="row"`s with `aria-colspan`.
- **Copy** writes no group rows (above). The README's limits say so.

### What a DOM contender does

TanStack's header groups, from the same paths as nested definitions, with its own drag. Its cells would match only if it draws the same runs, cut and labeled the same way, and finds the same gaps. A fixture pins them: `fixtures/group-headers.json`, with cases of the columns' paths and widths, the order, the pin count, the cells' width, and the sideways scroll → each drawn group cell (level, label, places, region, left, width, the label's x). Its drag cases take a block and a pointer's x (and side) → the gap or none, run natively against the table's own functions. Its negative controls: groups by place (`DataTable`'s spans); a run not split at the pin edge; the label centered, not kept in view; a gap outside the parent; a gap by the columns' centers, not the children's. A DOM contender's test names it skipped until the observatory builds a group level, which no scenario asks for.

### What the random test gains

The case's columns get paths from a stream of their own (depth 0–3, runs of 1–8 columns), as `density`'s steps do, so every existing case's draw is unchanged. That puts the header's depth, and so the viewport, in every case with groups. `Move` steps then meet the parent rule, and the invariants gain two. The drawn group cells are the runs of the drawn order, which a `GroupsByPlace` control must fail. A move the drag makes never splits a run, which a `GapOutsideParent` control must fail. The paging's code doesn't change, but the viewport's height does with every grouped case, so the soak runs on the final build.

---

## Hardening 2: the features since the first, together

Not a feature: the research that opens the second hardening (the table's `docs/milestones.md`, "Hardening 2"). The first hardening's random test checks the paging; ten pieces of work went in after it (`sort`, `pin`, `density`, the cells' text element, `format`, `follow`'s `let_go`, `reorder`, `clicks`, `group-headers`, and the gpui-kit bumps between), each reviewed alone. This section audits what they keep and how they read a press, lists what the audit found, matches the README's promises to their tests, and specs what the random test gains. Its decisions are in the table's `docs/DECISIONS.md`, "Fixtures" and "Features".

### What asks for it

The last two milestones' code reviews each found a bug of one of two kinds: state held by a column's place where its index was meant (or the other way), and a press that read the cells the last frame drew where the layout in effect was meant (`group-headers`' press). Both are bugs between features, or between a host's call and the reader's hand, and a feature's own tests don't look there.

### How a stale frame is reached, and why the window tests can't

GPUI hit-tests a press against the frame it last drew (`Window::dispatch_mouse_event` reads `rendered_frame`), and a listener an element registered is that frame's closure. A host's call from a timer or a task changes the table and asks for a frame; a press that arrives before that frame runs the old frame's listeners against the new state. In a browser that's a press within one frame of the host's call.

GPUI's test app can't dispatch such a press: in test mode it draws every dirty window when an update's effects flush (`App::flush_effects`), so `simulate_event` after a setter always meets a fresh frame. A spike confirmed it (a band pressed after `move_columns`, no draw between, met the new layout). So a test of this kind calls the press's own function inside the update that made the change, as `a_press_before_the_next_frame_finds_the_new_groups` does, and an audit by reading is the only way to find them.

### The audit: what's held by index, by place, and by row

Each piece of state that outlives a call, what it's held by, and what happens to it at a move (`move_columns`, a drag's release), `set_order`, `set_columns`, `set_rows`, and a sort.

| State | Held by | A move | `set_order` | `set_columns` | `set_rows` cutting it | A sort | Verdict |
|---|---|---|---|---|---|---|---|
| `sort`'s column (`SortState::current`) | index | stays | stays | kept if the column at its index has its name and is sortable, else cleared, the source told | — | replaced | sound |
| `sort`'s pressed and hovered arrow | index (the listener captures it) | stays | stays | forgotten | — | pressed forgotten | sound |
| `resize`'s drag (`Resizing::column`) | index | stays on its column | stays | ended, no event | — | — | sound |
| `resize`'s band press and fit (`render_bands`' listener) | **place, from the frame that drew it** | — | — | — | — | — | **finding 2** |
| `column_width`, `ColumnWidthsChanged` | index | — | — | replaced | — | — | sound |
| `select`'s range (`anchor`, `head`) | place and row | `Columns`, `Cells`: mapped, kept while side by side; `Rows`: kept as it was (decided) | `Columns`, `Cells` cleared | cleared | `Rows`, `Cells` cut or cleared; **`Columns` rows left past the end** | `Rows`, `Cells` cleared; `Columns` rows to 0 | **finding 5** |
| `select`'s drag (`selecting`) | the range's kind | ends if the range changed | ends | ends | ends if cut | ends if the range changed | sound |
| `pin`'s count | places | changed by the columns that crossed | kept as a count of places (documented) | kept, clamped in effect | — | — | sound |
| `reorder`'s held press and drag (`Moving::block`, `units`, `select`'s cell) | places, from the press | cancelled | cancelled | cancelled | **its cell's row kept** (a release that never dragged selects it) | kept | finding 5 |
| `group-headers`' runs | places, worked out in every `lay_out` | recomputed | recomputed | recomputed | — | — | sound (a press reads them in effect) |
| `clicks`' target | worked out at the press | — | — | — | — | — | sound |
| `copy`'s columns | indices, taken at its start | kept | kept | cancelled | cancelled under its last row | cancelled | sound |
| The hover and its tooltip (`Hover`) | place and row, **its text decided once** | cleared (`lay_out`) | cleared | cleared | cleared only if the top row moved | cleared | **finding 1** |
| The jump's mark (`marked`) | row | — | — | — | **kept** | cleared | **finding 4** |
| `live`'s flashes | row and index | stay on their column | stay | cleared | **kept** | cleared | **finding 7** |
| `follow`'s drawn tail | row | — | — | — | lowered to the rows | reset by the pages forgotten | sound |

Every hit test (`cell_at`, `cell_clamped`, `target_at`, `header_place_at`, `group_row_at`, the scrollbars' thumbs, `reorder`'s gap) reads the layout, the scroll, and `pin`'s run in effect at the call. The one listener that carries a frame's value into a press is the band's.

### What the audit found

Each is fixed with a scenario test before the hardening closes; a spike (not kept) confirmed 1, 3, 4, and 5 in the all-on build.

1. **A tooltip outlives its value.** The hovered cell's tooltip is decided once the pointer rests and its page is loaded, and kept until the pointer, the scroll, or the layout moves. A re-read that lands under it (`live`) leaves the old exact value showing over a cell that draws the new one: the spike's tooltip read `r1c1v0…` over a cell drawn `r1c1v1…`. Rows cut and grown back by `set_rows` with the top row unmoved do the same without `live`. *Fix:* a page landing on the hovered row, and `set_rows`, undo the decision, so the next frame decides again from the page it draws (the tooltip stays up, its text new, or goes if the new value isn't rounded or cut). The base's code changes.
2. **A band's press holds its column by the place it was drawn at.** `render_bands`' listener captures the place and `press_band` and `fit_column` map it through the order in effect at the press, so after a host's `move_columns` or `set_order` and before the next frame, a press on column X's band drags or fits whichever column is at X's old place. By reading (above); the arrows' listeners capture the index and are right. *Fix:* the listener captures the index, and the press finds its place in the order in effect (nothing if the column is gone).
3. **Any button's release ends a scrollbar drag, a drag selecting, and a column's resize;** only `reorder`'s is the left button's own (from its code review). The spike: a right release during a band drag ended it with the left still down. A browser sends a second button's release as a pointer move, so only a native host meets it. *Fix:* the left button's release for all four.
4. **The jump's mark survives a shrink past its row,** and is drawn on whichever row has its index when the rows grow back (the spike: marked 500 after 1,000 → 100 → 1,000). A sort clears it. *Fix:* `set_rows` clears a mark at or past the new end.
5. **A `Columns` range's rows aren't clamped by `set_rows`** (the spike: anchor row 500 at 100 rows), though `select` clamps them and a sort moves them to 0. `selection()` and the probe then name a row that isn't there, and the active cell's edge is drawn nowhere. `reorder`'s held press keeps the cell it would select at a release that never dragged, so a shrink between its press and release selects a row past the end the same way. *Fix:* `set_rows` moves a `Columns` range's rows to the last row (0 with none; still never cleared: it covers rows that arrive later), with `Selected`; the held press's cell is clamped at its release.
6. **`set_density` with a new text size is half in effect until the next frame:** `sizes()` is new at once, the columns are laid out by the new font only at the next render (the font needs a window), and `pin`'s run with them. A press before that frame reads the new row height over the old columns. *Left as it is,* as a narrowed view's one frame with the old run is (the table's `docs/DECISIONS.md`, "Features", 2026-10-29): no fix reads a font without a window, and laying out by the old font moved the run twice.
7. **A flash survives its row being cut:** flashes are cleared by a sort and `set_columns`, not by `set_rows`, so a row cut and grown back within a flash's duration draws it on the new row. By reading. *Fix:* `set_rows` drops the flashes at or past the new end.

### The README's promises and their tests

Each "Use it" section's promises were matched to a window test, a fixture, or a pure test by name. Those since the first hardening (`sort` through `group-headers`) all have one but these:

| Promise | Where | Gap |
|---|---|---|
| A rounded or cut value's exact text is in a tooltip | "Columns", with "Live rows" | No test hovers a cell through a re-read (finding 1) |
| "The jump's highlight, hover, and the tooltip are cleared" by a sort | "Sorting" | The mark is checked; the hover and the tooltip aren't |
| `set_order` keeps `pin`'s count as a count of places | "Moving columns", with `pin` | No test calls `set_order` with a count set |
| A page's `paint` is read by index | "Moving columns" | Only the flash is checked after a move; a fill and a bar aren't |
| The copy's text stays the exact value under a format | "Format" | No copy test builds a formatted column |
| "The header line is the names alone, no group rows" | "Header groups", with `copy` | No copy test builds grouped columns |
| "A context press does nothing" during a drag | "Presses" | Checked for a scrollbar's and `select`'s; not `resize`'s or `reorder`'s |

Part C writes each as a window test (the first with finding 1's fix).

### What the random test gains

**Gestures, placed.** Pointer steps through the window, as `DragColumns` is: `Down` (a zone, a point in it, a button, a count, Shift or Ctrl), `Drag` (a move by a few to a few hundred px, the button held or, one in eight, up: a release unseen), `PointerWheel` (at the pointer), and `Up` (the left button's, or one in eight the right's). The zones are a header row (the names' or a group's), a band, an arrow, a body cell, a row's number, the corner, and a scrollbar's track, each skipped by a build without it. A gesture is a `Down`, up to three `Drag`s or `PointerWheel`s, and an `Up`, its steps placed in order among the case's steps from a stream of its own (up to six a case), so every case's draw is unchanged and the case's other steps (a setter, a sort, an answer, a `set_rows`) fall between a press and its release. That's the timing no window test has. It covers `resize`'s band drag and its fit (a `Down` of count 2), a wheel during any drag, a move with the button up, `clicks`' presses and their counts, `select`'s drag, and header drags in a `reorder` build without `group-headers` (`DragColumns` goes: a `Down` in a header row and its `Drag`s are it, and invariant 10 is checked at each `Up`). As built, a `group-headers` build with `reorder` keeps a stream of header drags beside the six gestures, each a `Down`, two `Drag`s, and an `Up` as steps of their own: six gestures a case finish too few header drags for invariant 10's control (the table's `docs/DECISIONS.md`, "Fixtures", 2026-11-16).

**The invariants,** numbered on from the paging's ten, checked after every step unless they say when:

11. **Every drag ends, at the left button's release.** After a left `Up` or a move with the button up, and a frame: no scrollbar drag, no resize, no drag selecting, no held or moving block. And only then: across a right `Up`, the drags on are the ones before it (added when the test was built: the first half alone can't see finding 3, a drag that ends too soon). *Control:* a release that leaves the resize on.
12. **The widths.** Every column with a set width is within its least and most (the width a pointer step writes, and at a frame the width laid out: a layout clamps a set width as it reads it, so the laid-out width alone can't see an unclamped drag); the content's width is the columns' sum; the last `ColumnWidthsChanged` is the set widths, outside a drag. *Control:* a drag's width unclamped.
13. **The order.** `order()` is a permutation of the columns' indices, each laid-out column's index is the order's at its place, and the last `ColumnsMoved` is it. *Controls:* a move that writes its block over a neighbor; `set_columns` resetting the order with no event (a bug `reorder`'s review found).
14. **`pin`'s count moves only by the columns that crossed.** Across a move or a release: with the same columns in the run before and after, the host's count is unchanged (past the columns or not); otherwise it's the run's length, and the columns that joined or left are the block's. *Controls:* `reorder`'s `CountKept` and `Recount`, which its fixture has.
15. **The selection is valid.** Its columns are places that exist; a `Rows` or `Cells` range's rows exist (a `Columns` range's too, once finding 5 is fixed: an exclusion until then); its kind is on; a drag selecting has a selection; the last `Selected` is it. *Control:* `select`'s `KeepPastRows`, which its fixture has.
16. **A point in a drawn column hits it.** At a `Frame`: for each column the frame drew, the middle of its visible part in the body is that place's cell (`cell_at`), and in the names' row its header (`target_at`), under `pin`'s run, the row height in effect, and the group rows; each group cell drawn is its run at its middle (`group_row_at`); each arrow's target and each band lies inside its column's visible part. *Control:* a hit test that ignores the run (`pin`'s `Control`; a new one, `HitIgnoresRun`: its fixture's three change the drawing and the hit test together, so a frame still agrees with itself). What a frame drew is each loaded cell's text box, cut by its region's clip, so the check needs loaded rows; a first left press on a drawn band must hold that band's column.
17. **Nothing kept by row outlives its row.** The hover's row, the mark, and every flash's row are below `rows()` (the mark and the flashes once findings 4 and 7 are fixed: exclusions until then), and a tooltip showing at a `Frame` is the exact text of the value its cell draws (finding 1: an exclusion until then). *Control:* a shrink that keeps the mark: the table's own rule until finding 4 is fixed, so until then the control is the mark's check run with its exclusion lifted.
18. **The last event is the state.** The last `Pinned` is `pinned_in_effect()`, the last `Sorted` is `sort()`, the last `Following` is `is_following()` (with 12, 13, and 15's): a host's copy never goes stale. *Control:* `repin` changing the run with no event.

**It must find findings 3, 4, and 5** by itself (a right `Up` during a drag; a `Jump`, a `ShrinkPast`, a `GrowBack`; a `Columns` selection and a shrink), as the first hardening's had to find the shrink: the proof the gestures and invariants reach what the audit did. Findings 1 and 7 need a cut text or a flash under the pointer, which the test's short values and unflashed columns never draw; their scenario tests are written by hand. Finding 2 can't be dispatched (above).

**What a run costs** is measured when the gestures are built: a pointer step draws a frame, as `DragColumns`' do (~2.5 ms a step in the all-on run), so six gestures add about 30 frames a case.

### Every feature pair, compiled

13 features; `follow` turns on `live` and `copy` turns on `select`, so 13 single builds and 78 pairs, each for the table, the bridge, and the host. `just tall-table test` runs 18 feature sets and `lint` clippies none and all, so a pair that doesn't compile alone (an import gated on one feature, used under two) reaches no check today. Part B audits the tool first, by its wall time here: `cargo hack --feature-powerset --depth 2` (not installed on this machine: `cargo install cargo-hack`), `cargo-all-features`, and a script over the feature list calling `cargo clippy` a pair; then a recipe of its own (`just tall-table pairs`), not in `lint`.

The tests run only on the pairs with code gated on both. A first list, from `all(feature = …, feature = …)` and from each feature's module naming another's `cfg` (the recipe's script derives the final one, `src/state.rs`'s own nesting included):

`custom-cells` + `live`, `custom-cells` + `pin`, `custom-cells` + `density`, `custom-cells` + `sort`; `live` + `copy`, `live` + `sort`; `follow` + `sort`; `resize` + `pin`, `resize` + `sort`, `resize` + `format`, `resize` + `reorder`, `resize` + `clicks`, `resize` + `group-headers`; `select` + `pin`, `select` + `sort`, `select` + `reorder`, `select` + `clicks`, `select` + `group-headers`; `copy` + `sort`, `copy` + `reorder`; `sort` + `pin`, `sort` + `reorder`, `sort` + `format`, `sort` + `group-headers`; `pin` + `format`, `pin` + `reorder`, `pin` + `group-headers`; `reorder` + `clicks`, `reorder` + `group-headers`; `clicks` + `group-headers`.

Thirty of the 78; `just tall-table test` runs three of them today (`custom-cells` + `live`, `custom-cells` + `follow`, `format` + `resize`).

### The soak's features

`just tall-table soak` builds every feature with steps in the random test: `custom-cells`, `follow`, `resize`, `copy`, `sort`, `pin`, `density`, `reorder`, `group-headers`. `clicks` has none today and gets them (the gestures' buttons and counts), so it joins; `format` still has none. The random test's `ALL_ON` (the run that takes 48 cases and the controls) names eight features and gains `clicks` and `group-headers`, whose controls it already runs.

### What it leaves out

- **Browsers:** the native test runs GPUI's test platform; the smoke checks stay the browsers'.
- **A press against a stale frame** (finding 2's kind): found by reading, tested by calling the press inside the update.
- **Touch:** `clicks`' long press and its tap are a window test's; the gestures are a mouse's.

## `replace_rows`

Researched 2026-11-18, from the table's reset (`src/state/sort.rs`'s `apply_sort` and `keep_sort`, `src/state.rs`'s `set_rows`, `set_columns`, `jump_to`, and `move_top_to`, `src/pages.rs`'s `forget_all`, `src/state/follow.rs`'s `Reach` and `sort_lets_go`, `src/state/select.rs`'s `sort_selection`), `DataTable`'s at gpui-component 0.10.0 (`src/table/state.rs`, `refresh`, `scroll_to_row`; `src/table/delegate.rs`, `rows_count`), Tycho's view state (root [`tycho-workbench.md`](tycho-workbench.md), "The controller"), and a spike: native DuckDB 1.4.5, a filter's `count(*)` against its first page over Tycho's CSV in memory and Gaia's Parquet file (the numbers: the table's [`perf/results/2026-11-18-m18-a-spike.md`](../../components/tall-table/perf/results/2026-11-18-m18-a-spike.md)). Not a feature: a call in the base, since a host's filter needs it with no feature on. Its decisions: the table's `docs/DECISIONS.md`, "Features" (2026-11-18).

### What asks for it

- **Tycho:** its filters (a column's, a search across columns, filter by a cell), a query run again, and a grouped result shown as a new table. Each changes which row every index means. Tycho's controller holds one view state (the source, filters, sort, columns) and compiles it to SQL and to calls on the table (`tycho-workbench.md`), so it changes the source and its count together.
- **Nothing else can say it today.** `set_rows` means the same rows grown or cut (a page past the new end forgotten, the rest kept); `live`'s `invalidate_rows`, the same indices with new values (re-read in place, flashed); `set_sort`, a new order that the table itself tells the source. A host whose filter changed has no call that forgets every page: `set_rows` with the new count would keep the old rows' pages under the new indices.

### What `DataTable` does

Its delegate holds every row; a host changes them and calls `refresh` (which lays the column groups out again) and the table reads `rows_count` at the next render. The scroll offset and a selected row's index stay, so a selection made of row 40 is now another row 40; `scroll_to_row` is the host's to call. No page to forget and no read in flight, so nothing to reuse but the gap it leaves: what's kept by index stays, and is wrong.

### `sort`'s reset, made public

`sort` already does what a new set of rows needs (root "`sort`", "What a sort does to the table"): every page forgotten and its read cancelled, what's kept by index cleared, the view moved, the reads planned once the update ends. It's base code but for its `cfg`'d hooks (`forget_all` is behind `sort`, as are `sort_selection`, `sort_lets_go`, and `sort_load`). So the reset moves to the base, a function of its own that takes the new count and where the view lands, and both callers use it:

- **`replace_rows(rows, at)`:** the new count taken (as `set_rows` takes it: the scrollbar follows), then the reset.
- **`sort`:** the reset with the count unchanged and the view at the top, then `Sorted`; its behavior doesn't change (its fixtures and window tests are the check).

What the reset clears, from `apply_sort` and `set_rows`: every page and its read (a closed table's are gone already), with `live` its invalidations and with `live` and `custom-cells` its flashes; the hover, the tooltip, and the jump's highlight; with `select` a `Rows` or `Cells` range (`Selected(None)`), a `Columns` range kept with its rows moved to the row the view lands on; with `copy` a copy running (`Failed(Cancelled)`, as a sort cancels one: its later pages would come from the new rows); with `follow` the drawn tail; the scroll's direction and its settle (a reset isn't a scroll, so prefetch doesn't lean). Kept: the sideways scroll, the columns and everything held by column (widths, order, `pin`'s count, groups, a pressed or hovered arrow), and the sort (below). `apply_sort`'s first lines (the sort set, the pressed arrow forgotten: its release has just sorted) stay `sort`'s, before it calls the reset, so `sort` clears the pressed arrow as now and `replace_rows` doesn't.

### The swap's race

`sort` is a delegate call because the table starts it (a click), so the table owns the order of events: tell the source, then forget. `replace_rows` is the host's: the new rows exist only once the host has changed its source. `sort`'s research rejected leaving the swap to the host, for a click; here there's no other way, so the question is how a host gets it right.

- **What the cache already guarantees:** a read sent before the call that answers after it is never stored. The reset forgets every slot, a forgotten read drains (still counted against `max_in_flight`), and the cache stores an answer only for the read its slot is waiting on (`PageCache::loaded`), whatever it holds. So whenever the host swaps, no page of the old source survives the call.
- **What it doesn't:** a frame drawn between the swap and the call. Swapped in an earlier update, the table may draw (and read) the new source's rows at the old count, beside old pages still cached: a mixed frame, for as long as the gap lasts. Swapped and called in the same update, nothing draws or reads between them: GPUI draws after the update, and the reset's reads are planned after it too.
- **Weighed: a closure** (`replace_rows(rows, at, |source, cx| …)`, run just before the reset), so a host can't get the order wrong. It doesn't prevent the real mistake either: a host that swaps its source while its new `count(*)` is pending, an update or more before it has the count to call with. And a source behind a shared handle doesn't swap through `&mut D`. Rejected, decided with the owner: the call documents "in the same update" with the async shape in an example (keep the new source aside, await its count, then swap and call in one update), and a window test pins both the right order and, as its control, the swap an update early, which must draw the mixed frame. A closure variant can be added later if a host asks.
- **The engine's half:** the DuckDB engine's source can carry that shape itself (a filter that counts, then swaps and calls `replace_rows`), so most hosts never write it. The engine's work when Tycho builds its filter, not this milestone's.

### The count that arrives later

The spike's question. A filter's first page can come before its count, so either the host calls once the count is known (the old rows drawn meanwhile, with nothing in the table saying a filter is pending), or it calls with an estimate and corrects it with `set_rows`.

- **In memory (Tycho's CSV), the count is never slower than the first page in the source's order:** 0–548 ms against 0–560, since both scan the same rows. With no `ORDER BY` the page's scan can stop at 1,024 matches: a few milliseconds sooner for a simple predicate, and 309 ms sooner for the global search, whose predicate is costly a row (239 against 548).
- **On a Parquet file read by row-group range, a common filter's first page is 10–30× sooner** (10–17 ms against a count of 181–346 natively; over HTTP the count downloads the predicate's column). A rare filter is the other way round (the first page 756 ms, the count 120).
- **Past the first page, a source needs the matches' row numbers** (`OFFSET` grows with depth: 372 ms at 50% of the commonest filter in memory), and writing them costs the count's scan and gives the count. So an estimate saves only the first page's wait: on a file, for a common filter, and in memory, for a costly predicate whose first page reads with no `ORDER BY`.

Decided with the owner: **the call takes the exact count, and the host calls once it's known.** The old rows stay drawn until then; saying a filter is pending is the host's (its own UI, or the controller's state). Correcting the count with `set_rows` afterwards works (it's `set_rows`' own meaning: the same rows grown or cut), so a host that wants rows sooner may do it, and a window test pins it, but the docs don't recommend it: the scrollbar jumps when the count lands. A table-side pending state (the old rows dimmed, a "filtering" probe) was not weighed further: no host has asked, and the host can draw one over the table.

### Where the view lands

A target with three values, `#[non_exhaustive]` so another can be added (the guides' rule for an enum that may grow):

- **The top** (row 0): a new filter's or query's start, as a sort's.
- **A row the host names:** the view's top at that row, clamped as `jump_to`'s is (the end of the rows allows less), with **no highlight and no selection**: decided with the owner. A host keeping the reader's place (the row it was reading is still among the filtered rows) doesn't want it marked; one that does calls `jump_to` after, in the same update. Weighed: `jump_to`'s placement and highlight, which would mark a row the reader never chose.
- **The end:** the last rows, as `follow()` puts them (the view at `rows()` until a read at the end lands, then at the loaded tail if following).

**`follow`:** as the PLAN drafted it, following is kept only when the host names the end, and lets go at any other target (a sort's rule today: lets go, unless every row fits). "Kept" is literal: the end leaves following as it was, on or off; it never turns it on, so a filter applied while the reader is paused doesn't start following. The end is a value of the target rather than the host calling `follow()` after a let-go, so one call emits one `Following` state, never `false` then `true` in one update. In every case the drawn tail is forgotten (its rows are others), so a following view's next filled frame at the end emits `TailDrawn` again.

**A `Columns` selection** keeps its columns with its rows moved to the row the view lands on (the top, the named row clamped to the rows, or the last row), as a sort moves them to row 0 and a shrink to the last row. With no rows, as `set_rows` leaves one at none.

**Left for later:** keeping the reader's place usually means the same row at the same height on screen, not at the top. A fractional top, or a row with its offset from the top, would allow it when a host asks; the enum can take it without a break.

### The sort through a new source

A filter on a sorted view keeps the sort: the reader filtered, they didn't unsort. The table keeps its sort through the reset, but the new source must read in it, or the arrow shows over rows in the source's own order.

- **Weighed: the host's** (the new source built already sorted: Tycho's controller compiles the sort and the filter into one query). It leaves each host to keep the source and the arrow agreeing, the shape `sort`'s research rejected.
- **Chosen: the table tells the new source its sort.** With a sort in effect, `replace_rows` calls the delegate's `sort` with it again, so the source's order follows the table's whatever the host built. It's told once the update ends, right before the reset's reads are planned (no read goes out before it), with the sort in effect then: so a host that calls `set_columns` and `replace_rows` in the same update, in either order, tells the new source the sort that survived `set_columns`, never an index of the old columns. A source with no sort is told nothing. The delegate's docs say `sort` may be called again with the sort in effect, for new rows.
- **Told once, and not twice:** the pending tell is dropped by any call that tells the source in the update after the last `replace_rows` (`set_sort`, a click, `set_columns` clearing a gone column's sort), since the source has heard the sort in effect from it. `set_sort` then `replace_rows` tells it twice, rightly: the swap may have come between them.
- **A refusal clears the sort without a second reset:** the source told none (which it must accept), `Sorted` with no keys, and `SortRefused` with the keys and the reason so a host can say why the arrow went. The view stays at the replace's target and following as the replace left it: the replace's reset has already forgotten the pages, and no read has gone out, so the rows read next are the source's own order. Not `keep_sort`'s path, which resets to the top.

### A new source with new columns

A grouped result is a new table (Tycho's catalog), so its columns change with its rows. Decided with the owner: **`replace_rows` doesn't take columns;** the host calls `set_columns` and `replace_rows` in the same update, in either order. Each keeps what it keeps today: `set_columns` takes widths from the new columns, resets the order (with `ColumnsMoved`), keeps `pin`'s count, clears the selection, and keeps the sort only if the column at its index has the same name and is sortable. Pages loaded before are never drawn under the new columns: the reset forgets them in the same update, before any frame. **The sort whose column is gone, in either order.** Today `set_columns` clears it through `keep_sort` → `apply_sort(None)`, the whole reset: the view to the top, following let go. In one update with `replace_rows` that breaks "either order": `replace_rows` then `set_columns` ends at the top, not the target, and `set_columns` then `replace_rows` with `End` has let following go before the replace keeps it "as it was". So the clearing and the reset come apart: `set_columns` clears the sort at once (the source told none, `Sorted` with no keys, as now), and its reset waits for the update's end, where it's dropped if a `replace_rows` came in the same update, before or after (its reset covers the clear: every page forgotten, the view at the host's target). With no `replace_rows` in the update, `set_columns` resets as it does now, at the update's end instead of the call, before any frame or read. Both orders then end the same: the target, following by the target's rule, one `Sorted([])`, the source told none and nothing after.

**A later `set_sort` wins.** `replace_rows` then `set_sort` in one update: the sort's own reset puts the view at the top, as a sort always does; the later call is the host's last word. Documented, and a window test pins it.

Each a window test: the two orders end in the same state (the view, following, the pages planned once, the sort and its events, `pin`'s count, the selection), with a sort kept and with one whose column is gone; and the reads are planned once for the update (`set_sort`, `set_columns`, and `replace_rows` in one update read the new rows' pages once).

**A sort kept by name can match the wrong column** in a new result (a `count` column in both the base table and a grouped one). The docs say so: a host that wants a clean slate clears the sort itself (`set_sort` with no keys) in the same update.

### Events

None of its own. `replace_rows` is the host's call, so the host knows it happened; what it changes that a host keeps is reported as it is today: `Selected` (a range cleared or moved), `Following` (let go), and with a refused sort `Sorted` and `SortRefused`. `sort` still emits `Sorted` after the reset, as now. A host timing a filter marks its own call and the next `Filled`.

### A closed table

As `set_rows` on one: the count and the view follow, and nothing is read, cancelled, or told (the source isn't told the sort again).

### The base's cost

Every app builds the base, so moving `apply_sort`'s body out of `sort` and `forget_all` out of its `cfg` reaches every app's wasm (root `CLAUDE.md`, rule 1). The bytes are the call's when a host calls it: a build that never calls `replace_rows` and doesn't build `sort` should strip it, so the base without a caller should be unchanged to the byte, and the bare host calls it (below) so `size` measures it. The `sort` builds (Kirkwood's, the bare host's) change by the refactor; each app's note records its effect. No frame work changes: the reset runs once a call, and the time from the call to the first filled frame is `sort`'s (its click → filled, measured when `sort` was built).

### Frame-work risk

None: no per-frame code. The reset is a cache clear and the reads a jump makes, as a sort's.

### Canvas gaps

None new. A filtered view's row count isn't announced (the table announces nothing); a host's own DOM can say it.

### What a DOM contender does

TanStack Table with `manualFiltering` and TanStack Virtual: the host sets the new data and count and scrolls the virtualizer to the target; the selection is TanStack's state, keyed by row id. No contender filters yet; the paging fixture gains `replace` scenarios (below) that a contender runs once a level filters, and until then its test names them skipped, as `sort`'s are (`.claude/rules/comparison-protocol.md`, read when the fixture changes).

### The fixtures

- **`paging.json`** gains a `replace` step (`{"rows": <n>, "at": "top" | <row> | "end"}`): with a sort in effect the source told the sort first (`sort <c> <direction>`, the first of the step's `expect`); every page forgotten and every read out cancelled (one decision); the view at the target; the target's pages read once the step's update ends. Scenarios: a replace with a new count at the top, at a row (and at a row past the new end, clamped), and at the end; a replace while reads are out (their places held until they answer, an answer dropped); with `follow`, the end keeping following and the top letting it go; with `sort`, the sort told again. The `sort` scenarios and the `sort` field's control (`keep-pages`) stay as they are. A `replace` field's control, `keep-pages`, keeps every page and read through a replace, in every build; it's a field of its own rather than a `cache` control, since the TanStack contender runs every `cache` control and doesn't filter yet.
- **No fixture of its own:** what it does to the view is `jump_to`'s placement without the highlight, which the paging fixture's steps pin.

### What the random test gains

- **A `Replace` step in every build:** a new count, a permutation of the source's rows (the source renumbers them, as a sort's does), every row's era bumped, and a target (the top, a row in or past the new count, the end). Invariant 5 (rows drawn are of their era) catches a page of the old rows drawn after it, and 7 a copy's text crossing it. Placed among a case's steps from a stream of its own (`with_replaces`), so no existing case's draw changes; the `sort` step stays as it is.
- **What's checked at the step:** the view at its target, the count the new one, and what's kept by row cleared (invariant 17's list, at the step rather than a shrink); with `follow`, the last `Following` the state (invariant 18) and following kept only at the end; with `sort`, the source's last sort the table's.
- **Controls:** the cache's two sort controls (`SortKeepsPages`, `SortKeepsReads`) become the reset's, built in every build: a replace that keeps the pages, and one that forgets the loaded pages but leaves the reads in their slots. Each must fail invariant 5. A third: a replace that doesn't tell the source the sort (fails the sort check, in a `sort` build).
- **The soak**, since the reset changes the paging (the table's `CLAUDE.md`, rule 5).

### The bare host

`__tallTableReplace(stride, at)` with `?perf`: the host's in-memory source swapped for every `stride`-th row of its rows (1: all of them) and `replace_rows` called with the new count, in one update, so `size` measures the call and the smoke check drives it in three browsers (the cells drawn against the source's rows at the target).

### What it leaves out

- **The source's filter:** the `WHERE`, its count, and how a filtered Parquet file pages are the DuckDB engine's, researched when Tycho builds its filter (the spike's last finding: a rare filter's matches span the file).
- **A filter control in the header** and **a header cell's bounds** for a popover: the column filtering candidate's, if a host asks (`PLAN.md`, "Notes").
- **An insert mid-list:** tree rows' (`PLAN.md`, "Notes"), which neither `set_rows` nor `replace_rows` covers.

---

## Column visibility (`hide`)

Researched 2026-11-18, from the table's layout (`src/column.rs`: `layout_columns`, `in_order`), `pin`'s geometry (`src/pin.rs`: `in_effect`, `Pin::visible`, `into_view`), the hit tests (`src/state/hit.rs`), `select`'s keys (`src/state/select.rs`: `key_step`, `scroll_into_view`), `copy`'s columns (`src/state/copy.rs`: `start_copy`), `reorder`'s gap (`src/reorder.rs`: `gap`'s `shown` and `parts`), `group-headers`' runs and cells (`src/groups.rs`), `set_columns` (`src/state.rs`) and `sort`'s `keep_sort`, gpui-component 0.10.0's `src/table/` (the pin), and TanStack Table v8's column visibility (`columnVisibility`, `column.getIsVisible`, `toggleVisibility`, `getVisibleLeafColumns`, `row.getVisibleCells`, `enableHiding`). No spike: a hidden column adds no frame work (below).

### What asks for it

- **Tycho:** its "Waiting on" table (column visibility: hide and show columns). A wide file (the observatory's wide shape has 500 floats) is read a few columns at a time; hiding the rest is how a reader keeps the ones they're comparing side by side, short of moving them.
- **No observatory scenario** asks for it. TanStack has it, so a feature level could compare it, but none is planned.

### What `DataTable` does

Nothing: gpui-component 0.10.0's table has no column visibility. Its delegate's `visible_columns_changed` is the columns scrolled into view, not hidden ones. A `DataTable` host hides a column by giving the delegate fewer columns, so everything held by column index (widths, the sort, fixed columns) is the host's to move.

### TanStack Table

Visibility is a map from column id to a flag (`columnVisibility`), set by `toggleVisibility` or the state's setter, and `enableHiding` per column. A hidden column leaves the leaf list (`getVisibleLeafColumns`, `getVisibleCells`), so a hidden column has no place while it's hidden: the order (`columnOrder`) and pinning (`columnPinning.left`, ids) keep it by id, and it comes back where the order puts it. A header group whose leaves are all hidden isn't drawn, and its span counts only its visible leaves. Copy is the app's (TanStack has none).

### A place at no width

Two models: a hidden column leaves the places (TanStack's), or it keeps its place, laid out at no width.

- **Leaving the places** would renumber every place right of it at each hide and show. Everything the table keeps by place (a selection's ranges and keys, `pin`'s count, `clicks`' targets, `reorder`'s block, a `Group` target's span) would have to move with it, and `set_order`'s order would have to say where a hidden column sits. Rejected.
- **Kept at its place, at no width:** `layout_columns` gives a hidden column width 0 at its `x` (the right edge of the shown column before it), so every place and every index stays what it was. Its own width, as set, kept by index, comes back when it's shown. The content width is the shown columns', so the sideways scroll's end moves in and the scroll is clamped as at a resize. The owner chose this model, and `pin`'s count by place with it (below).

**What falls out, and what doesn't.** The exact hit tests find a column by `x < column.x + column.width` or `contains`, so a column at no width is never hit: the hover, the tooltip, a press, and `clicks`' targets skip it with no change. `cell_clamped` doesn't: past every column it falls back to the last place (`unwrap_or(last_column)`), hidden or not, so a drag's head past a hidden last column, `first_visible`, and a gutter press would land on it; with the feature it falls back to the last shown place, and to no cell with none shown. Three drawing tests don't either: `Pin::visible` (a pinned column is drawn where `x < cells_width`, a scrolled one where it overlaps the view, true for a zero-width column strictly inside it), `reorder`'s `shown` (the same overlap), and the base's `visible_columns`. So with the feature each takes `width > 0` too, and a hidden column's header, cells, border, sort arrow, and `resize` band (which would sit on its neighbor's) are drawn nowhere and hit nowhere.

### Its flag, and how it comes and goes

A flag on `TallTableColumn` (`hidden(bool)`), held by index as every other column setting, so it follows its column through `reorder`'s moves with no code of its own. `set_columns` takes the new columns' flags: the host keeps them by name, as it keeps widths (`ColumnWidthsChanged`), and gives them back on the builder. Weighed: the state keeping a flag across `set_columns` for a same-named column (`sort`'s rule), which spares a host the restore but leaves a new list unable to say "shown" without a second call, and two sources of truth to merge. The owner chose the builder.

- **Changed later** by `set_column_hidden(index, hidden)` (a host's menu) and `set_hidden(Vec<bool>)` (a saved view given back, by index, the event's shape).
- **One event,** `ColumnsHidden(Vec<bool>)`, every column's flag by index, when a setter changes one; none at `set_columns` (the host gave them, as with widths) and none when nothing changed.
- **A list of another length** given to `set_hidden` (a view saved before `set_columns` changed the count, a normal sequence) changes nothing, quietly: `set_order`'s refusal debug-asserts, a host's mistake, but a stale saved view isn't one.
- **Every column may be hidden:** the gutter and the row numbers are drawn, the cells area empty; with no shown column a gutter press or an arrow key with nothing selected selects nothing.

### What a hide does to the rest

- **`pin`:** the count is of places. A hidden column in the run is still one of the *n*, drawn at no width, so `set_pinned(3)` with column 1 hidden shows two pinned columns. The half-view cap sums widths, so a hidden one costs it nothing. *P* is the run's last shown column's right edge (a hidden last column's right edge is the same x). Weighed: the count of shown columns, what the reader sees, but its meaning would change at every hide and a move across the edge would recount. The owner chose places.
- **`select`:** ranges are of places and keep a hidden column inside them; nothing is drawn of it, so the tint runs on across the gap as one. A hide never changes the selection (no `Selected`). The arrow keys and Shift+arrows step to the next shown place that way, or stay; from a head on a hidden column (hidden after it was selected), the step starts at its place. Home and End aren't column moves today, so nothing changes there. `scroll_into_view` brings a shown column into view; to a hidden one it scrolls nothing sideways.
- **`copy`:** shown columns only, the header line too (`headers(true)`). Excel copies hidden columns unless told "visible cells only"; here hiding is a view choice, as TanStack's is. A copy takes its columns' indices at its start, so a hide during a copy changes nothing it writes. Everything that counts its columns counts the shown ones, what would be written: the key's cap (`key_max_cells`), `Declined`'s `columns`, and `start_copy`'s smallest size (`least_bytes`) against `max_bytes`, so two shown columns in a range of 400 aren't refused as `TooLarge`. `Started`'s `columns` stays the range of places spanned, its doc saying hidden ones in it aren't written. Without `reorder`, `Running` holds a range of places; a `hide` build holds the shown indices taken at the start instead (as `reorder`'s `indices`). A selection whose columns are all hidden starts no copy: `copy` returns `None`, and Cmd+C goes on to the host (`cx.propagate()`), as with nothing selected. The owner chose shown only.
- **`reorder`:** the gap is found among the units with a shown place in the pointer's region (`shown`), so a unit that's all hidden has no part and no center. A drop between shown columns A and B with hidden H between lands right after A (A, X, H, B): the gap after the last shown unit left of the pointer, `gap`'s rule as written. A dragged block is its range of places, hidden ones inside it moving with it; a hidden column at its edge stays. `move_columns` and `set_order` are by place and index, unchanged.
- **`group-headers`:** the runs are of places, hidden ones in them, so a move keeps a group whole as before. A group's cell is drawn over its shown columns (their widths sum; a hidden one adds 0). A group with every column hidden draws no cell and takes no press. The label is kept in view over the shown part, as now. A press on a group selects its whole run of places.
- **`sort`:** a hidden sorted column keeps the sort; no arrow says so. The host's column chooser says it (the README's limits).
- **`resize`:** a hidden column's set width is kept and comes back with it; it has no band. Any drag held at a hide or a show is cancelled, as `set_columns` cancels one, not only one on the column hidden: `repin` returns early while a resize is held, and the drag's `pin_limit` was summed at its press, so a show of a pinned column under a drag on another would emit no `Pinned` and let the drag widen the run past half the view. `reorder`'s drag is cancelled too (its places' geometry changed), and `sort`'s pressed arrow on a hidden column is forgotten.
- **`clicks`:** targets are places, a hidden one never hit. A `Group` target's span is its run's places, hidden ones in it.
- **`format`, `custom-cells`, `live`, `follow`, `density`, the paging:** nothing. Every page still holds every column (below); a hidden column's flashes run on unseen.
- **The probe:** `ColumnProbe` gains `hidden`; the layout still lists every column, a hidden one at width 0, so a script knows where it is.

### The delegate's narrowed read: not in this milestone

Telling the delegate which columns are shown, so a source reads fewer, changes what a page holds: a page read with fewer columns can't draw a column shown later, so a show re-reads every loaded page (`live`'s re-read, without a flash), and a copy of shown columns reads only them. That reaches the paging, the cache's bytes, and the soak, more than a part. No app has measured page reads as its cost of a wide file. The owner chose to leave it to a later milestone: a "Notes" row in the PLAN, researched if Tycho measures its wide pages' reads as the cost.

### Frame-work risk

None to measure apart: a frame tests one more `width > 0` per visible column, and a hidden column draws nothing. Hiding columns brings more shown columns into the view, so a frame draws as many cells as the view holds, as without it. Measured at the close: the wide shape's flings with half its columns hidden, against the build with none hidden.

### Canvas gaps

- **A screen reader isn't told** which columns are hidden: the accessibility gap the README tracks. *To close it:* the DOM mirror leaves them out, as TanStack's DOM does.
- **A hidden sorted column** keeps its sort with nothing on screen saying so (above): a limit, not a canvas gap; the README's limits say it.

### What a DOM contender does

TanStack's `columnVisibility`, by id. It matches where the table's rules and its own agree: no hidden cell drawn, a header group over its visible leaves. It differs on `pin`'s count (TanStack pins ids; a hidden pinned column isn't counted in what it draws, and the table's count is of places), so a fixture's case of a hidden pinned column is one a contender reproduces by pinning the same ids. The fixtures gain a `hidden` field (places; none by default, so every existing case is unchanged): `pin.json` (a hidden column in and past the run, the run's last one hidden), `reorder.json`'s gaps (a hidden column between the pointer's neighbors, a unit all hidden), `group-headers.json` (a partly hidden group, a wholly hidden one), `selection.json` (the arrow keys skipping a hidden column, a range across one), and `copy.json` (a range across a hidden column, the header line). The TanStack contender's tests, which run `pin.json` (`wide.test.ts`, laying every width out at full width), `selection.json`, and `copy.json`, name the `hidden` cases skipped until the observatory builds a level with visibility, which no scenario asks for; `reorder.json` is skipped whole there already.

### What the random test gains

A `Hide` step (a column hidden or shown by `set_column_hidden`, or a whole flag list by `set_hidden`), placed from a stream of its own (`with_hides`), after `with_replaces`, so no case's draw changes. The `set_columns` step tells `Heard` the new flags, which `set_columns` changes with no event (as it does for widths). Invariants: no drawn cell, header, group cell, band, or arrow at a hidden column; no hit test returns a hidden place; a flag follows its index through moves; the last `ColumnsHidden` heard is the state; a copy's text has no hidden column. Controls: `DrawnHidden` (a hidden column drawn at its width) and `FlagByPlace` (the flag kept by place across a move), each failing its invariant. The paging's code doesn't change, but the horizontal scrollbar can come and go with a hide, which changes the body's height and the viewport's rows, so the soak runs on the final build.

### What it leaves out

- **The delegate's narrowed read** (above): a later milestone's, if asked.
- **The control that hides** (a column chooser, a header menu through `clicks`): the host's.
- **A marker where columns are hidden** (Excel's double line at the gap): not drawn; a host that wants one asks, and its research weighs where it draws among the layers.

## Find (`find`)

Researched 2026-11-18, from the table's jump (`src/state.rs`: `jump_to`, `marked`, the jump's highlight in the body's paint), `select`'s keys and scroll (`src/state/select.rs`: `jump_select`, `scroll_into_view`), the cells' text (`src/cells_text.rs`: `shape_line`, `truncate_line`), the delegate (`src/delegate.rs`: `load_page`, `cancel`, `CellValue`'s exact text), gpui-component 0.10.0's editor search (`src/input/search.rs`; gpui-base's `input/editor/search.rs` and the match paint in `input/base/element.rs`), gpui-pre-web 0.3.12's keydown (`src/events.rs`), Tycho's open questions on find's bar and its keys (its `PLAN.md`, 5 and 7) and its Cmd/Ctrl+G (its `docs/DECISIONS.md`, 2026-10-08), and a spike: native DuckDB 1.4.5 asked "the next match after row *r*" over the asteroids and Gaia (the numbers: the table's [`perf/results/2026-11-18-m20-a-spike.md`](../../components/tall-table/perf/results/2026-11-18-m20-a-spike.md)).

### What asks for it

- **Tycho:** its "Waiting on" table (find: search that keeps every row). Its visitors find a value, filter, and sort (its `docs/personas.md`); filtering drops rows (`replace_rows`), find keeps them and moves to each match in turn.
- **The canvas's Ctrl+F gap** (README, "Canvas tradeoffs"): the browser's find can't see the cells. A find of the table's own, answered by the source, is the route the README names besides a DOM mirror, and the only one that reaches rows not loaded.
- **No observatory scenario** asks for it, and TanStack Table has no find (its global filter drops rows), so no feature level compares it.

### What `DataTable` and TanStack do

Neither has one. gpui-component 0.10.0's table has no search; its code editor does (`InputState::next_search_match`, `previous_search_match`), and that's the model for what's drawn: every match in the theme's `selection` color at saturation 0.1, the current one in `selection` over it, matched ASCII-case-insensitively by default, the bar (its own input, Enter and Shift+Enter, Escape) the editor's. TanStack's global filter (`globalFilter`, `getFilteredRowModel`) is a row filter, which for this table is `replace_rows`.

### What matches

Two texts disagree: what the table draws (a float rounded to its column's digits, a `format` text, a long text cut at "…") and what a source can match in its query (the value). Only the table knows the drawn text, so a source answering "the next match" in SQL can't match it; the table matching drawn text itself would read every page past *r*, the whole file for a term with no match.

- **A cell matches when its exact text contains the term, case folded:** the exact text is `CellValue`'s (what `copy` writes and the tooltip shows: a float's shortest round-trip text, a source's text as it gave it); case folded is both lowercased (Rust's `str::to_lowercase`, DuckDB's `lower`); no regular expressions, no whole words. A NULL never matches (`CAST(NULL AS VARCHAR) ILIKE …` is NULL in SQL; its drawn `NULL` is a placeholder, not text). An empty term is no find.
- **The source decides which cell is next;** the table decides what's highlighted in the cells it draws, by the same rule over each drawn cell's exact text. They can differ where a source's text of a value isn't the table's: DuckDB writes `1e+300` and `1e-07` where the table's exact text is `1e300` and `1e-7` (the spike's check), and lowercases a few characters differently (`İ`). The found cell is the current match whatever the table's test says; the README says the two can differ at the edges, and the fixture pins the cases both agree on.
- **The highlight:** where the term shows in the drawn text (after a format and the cut), each occurrence's range is tinted behind its glyphs. Where a cell matches but the drawn text doesn't show the term (3.1391701154 drawn as 3.139 found by "3.13917", or a match past the "…"), the whole cell is tinted instead, so every match on screen shows. The owner chose this over ranges alone.
- **Which columns:** every shown column, numbers as their exact text, as the browser's Ctrl+F finds a number. Hidden columns (`hide`) aren't searched. The spike's cost is the casts: a scan of every column of the asteroids takes 2.4 s where one text column takes 0.2 s. The owner chose every shown column; a source windows its scan (below), so a near match is quick whatever the columns.

### The source's cost

The spike (one thread, native, the files warm on a local disk), each "next match" as `min(file_row_number)` over the rows past *r* matching any column's `CAST(… AS VARCHAR) ILIKE '%term%'`:

- **One query over every row past *r*** costs the whole scan however near the match: 2.6 s from the top of the asteroids (1.57 M rows, 18 columns) for a match at row 252, 51 s over Gaia (25 M rows, 11 number columns) for one at row 273,292. DuckDB's `min` and `ORDER BY … LIMIT 1` read every row in range.
- **Windows from *r*,** doubling from 65,536 rows to 4 M, stopping at the first window with a match: a near match in 30–130 ms on the asteroids and ~1 s on Gaia (three windows), a previous match the same way back. A term with no match costs the whole scan either way: 2.5 s on the asteroids, 47 s on Gaia, in 5 and 11 queries; over Gaia's one `BIGINT` column alone, 3.5 s.
- **So a source's find is windowed and cancellable.** A cancel between windows stops a long scan (a term changed, a sort); each window is a query of its own, so on a source with one connection (DuckDB-Wasm's) page reads run between windows rather than behind a 47 s scan. DuckDB-Wasm runs slower than native and over HTTP reads every column it casts; the engine measures its find when Tycho adopts the feature, and a host shows the scan's progress if it wants (a source can report the row it has reached; not the table's).
- **A count of matches** is the same whole scan (2.4 s, 51 s): the host's, if its bar shows one, never the table's.

### The delegate's call

The owner chose a delegate call over the host's (the host running its query and giving the table the match), as `sort`'s call was chosen: the table steps, cancels, and wraps, so every host gets the races right, and the random test reaches them.

- **`find(query) → (Request, FindLoad)`, or `None` to refuse** (the default: a delegate written before the feature compiles with it on and finds nothing, `Found(Refused)`). A find is a read like `load_page`: its request id comes from the same counter, it's cancelled through the same `cancel`, and its load must still resolve after a cancel (`PageError::Cancelled`, or its answer if it won the race, dropped).
- **The query:** the term; the columns to search, by index, in their drawn order (shown ones only), so "the next cell" runs left to right along a row as drawn, then down; where to start (the cell after which it searches, exclusive, or from the first row) and where to stop (inclusive, or the last row), forward or backward. The answer is the first matching cell in that order, or none.
- **Not a page read:** a find isn't counted in `max_in_flight`, and the plan never waits on it. At most one find is out at a time.
- **Wrapping is the table's:** the first ask runs from the start cell to the end (the top, backward); with no match, a second ask runs from the other end up to the start cell, inclusive, so a lone match is found again. A source answers one shape. The event says it wrapped.
- **While it's out,** another `find_next` or `find_previous` is ignored (the host's bar can show it pending from `FindStarted`); a new term cancels it; the current match stays marked. Nothing else is drawn: the rows on screen are still true.

### Where a step starts and where it lands

- **The start:** whichever was set last of the current match and, with `select`, the reader's own selection (a cell, or a row searched from its start), so a reader who moves the active cell after a landing goes on from there, and a landing's own selection never restarts the row it selected; a `Columns` range is no position (after a sort it's kept with its rows at the top). With neither, the cell before the first shown cell of the top row in view (forward) or that cell itself (backward), so a match in the view's top row is found first. A start on a column hidden since is taken at the nearest shown cell before it in drawn order, so the source's query names only columns it searches.
- **No wrap from the first row:** a forward step from before the first cell has searched every row; asking again from the top would scan the file twice (94 s on Gaia for a term with no match).
- **The landing:** the match becomes the current match. A row fully in view doesn't scroll; one out of view lands as `jump_to` places it (at the top, clamped at the end), so the matches after it are in view. Its column is brought into view sideways unless it's pinned (`select`'s `scroll_into_view`, which moves to the base so a build without `select` has it). With `select`, the found cell is selected (with cells on; its row with rows only), not as `jump_select` picks (the active cell's column), so the keys go on from it and a Cmd+C copies it (or its row); the jump's `marked` row isn't set, since the current match has its own mark. With `follow`, a landing lets go as a jump does.
- **What's kept by index goes with it:** a sort, `replace_rows`, or `set_columns` cancels a find out and forgets the current match (its index means another row, or another column); the next step starts from the view's top (row 0 after a sort). A `set_rows` that shrinks the rows cancels a find out (an answer past the new end would land nowhere; its `until` was of the old count) and forgets a current match it cuts; a grow keeps both. An answer past the row count is dropped anyway. A move (`reorder`) or a hide (`hide`) cancels a find out (its column order is stale) and keeps the current match, by index; a hidden current match isn't drawn, and the next step starts from it. `live`'s invalidation keeps it: it's a position, and the drawn highlight follows the new text. `close` cancels it; no find starts on a closed table.

### The keys

The owner chose that the table binds no find key: the host owns the bar, its input (the table takes no text input), and its keys: Ctrl/Cmd+F to open it, Enter and Shift+Enter (`find_next`, `find_previous`), Escape (`set_find(None)`). Tycho binds Cmd/Ctrl+G to its jump field already, so the browser's find-next keys aren't free for the table either.

- **A second Ctrl+F reaching the browser** is the host's choice: gpui-pre-web 0.3.12 calls `preventDefault` on a keydown only when an action handles it (`propagate` false) or when it inserts text into an input, so a host's Ctrl+F handler that calls `cx.propagate()` lets the browser's find open over the page's DOM text. Tycho's key table (its open question 7) decides it.
- The README lists the table's keys and notes it takes no find key.

### What's drawn, and where

Among the layers ("Long-term goals", "Layers"): the row's background and stripes, `custom-cells`' fill and bar, `live`'s flash, the jump's highlight, `select`'s tint, then **find's tints**, then the text, then **the current match's edge**. Over `select`'s tint, so a match inside a selection still shows, and under the text.

- **A match's range:** the theme's `selection` at saturation 0.1 (the editor's secondary), from the shaped line's offsets of each occurrence (GPUI's `ShapedLine::x_for_index`), clipped to the cell, painted in the cells' text layer before its glyphs (`cells_text`). A cell matched but not showing the term: its whole box in the same color.
- **The current match:** its ranges (or its cell) in `selection`, and the cell edged in the theme's `ring`, so it's told apart from the others in every theme and over a blue ramp. Not `table_active_border`: that's the active cell's edge, which moves away from the match at the reader's next key, leaving two cells edged alike. It's drawn whether or not the table's rule matches it (the source found it, and `live` can change its text): its whole box when its drawn text doesn't show the term.
- **The fold's offsets:** a few characters lowercase to more bytes (`İ`, two, to `i̇`, three), so a match's offsets in the folded text aren't the drawn text's. The fold is taken a character at a time, keeping each folded character's source, and a range maps back to whole drawn characters before the shaped line's offsets are read.

### Frame-work risk

A frame with a term set tests each drawn loaded cell's exact text (a lowercase and a substring search: ~310 cells in the protocol's view, ~1,100 at the densest) and shapes nothing new: a range's x comes from the line already shaped. A cell's exact text for a float is formatted per frame today only for the tooltip, so this adds a format per drawn float cell. If the wide shape's frames show it, the tests are cached per page and term (a page's matched cells, kept with the page). Measured at the close: the wide shape's flings with a term matching often, against none set.

### Canvas gaps

- **Ctrl+F:** with `find`, a host's bar finds a value in every row, loaded or not; the browser's find still can't see the cells. The README's row says what's closed and what isn't (a match isn't announced; a host's DOM bar can say "3 of 12" if it counts).
- **Accessibility:** the current match isn't announced; a host's bar can announce it, from `Found`.

### What a DOM contender does

No observatory level (no scenario; TanStack has no find). The fixture `find.json` pins what's the table's so a DOM equivalent (a `<mark>` around each range) and a source's SQL can be checked: the match rule (a cell's exact text, a term, and whether it matches: case, NULL, floats' text); the drawn ranges (a drawn text, a term, the ranges, and "cell" when the drawn text doesn't show a match: rounded, formatted, cut); and the steps (a grid of exact texts, the columns' drawn order, a start, a direction, and the cell found with whether it wrapped).

### What the random test gains

A `Find` step (a term set or cleared, a next or previous), placed from a stream of its own (`with_finds`) after `with_hides`, so no case's draw changes. The source answers a find from its rows of its era, after a delay as its pages do, and can be cancelled. Invariants: a landed match is a matching cell of the era in effect (no answer from before a sort or a `replace_rows` lands); with a find out, none other starts; every drawn tint but the current match's is on a cell that matches by the rule, and every drawn matching cell is tinted. Controls: `KeepFindOnSort` (a find out across a sort, its old answer landing) and `CaseSensitive` (the highlight's test without the fold). A find's request ids share the pages' counter and their cancel, so the soak runs on the final build.

### What it leaves out

- **The bar, its keys, and a count of matches:** the host's.
- **Options a bar may offer** (match case, whole words, a regular expression): not built; the term is matched as the rule above. A host asks, and its research weighs the source's SQL for each.
- **Find and replace:** the table is read-only (`PLAN.md`, "Editing is not on the list").
- **A source's progress through a long scan:** a source can report it to its host; the table draws nothing for it.
