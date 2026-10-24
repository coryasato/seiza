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
