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

- **The row's shading and the jump highlight sit under a fill,** so a fill hides the jump's highlight in its cell. A highlight drawn over the cells (a border, or a quad above the text) would keep it; settled with a screenshot when it's built, since it touches the base's drawing.
- **The fixture pins resolved colors,** in light and dark, from the ramps' stops and each cell's values: the stops are theme tokens, which a JSON can't name, and a DOM contender mixes the same tokens' values. A shade is one 8-bit step a channel: the native test allows that much for rounding, and a control two steps off must fail. A bar's pixels allow one device pixel: GPUI rounds positions of exactly x.5 down and the browser rounds them up (root `CLAUDE.md`, "Known GPUI Kit web gotchas").
- **Undefined answers draw nothing:** a NaN paint value, or a field whose column has no ramp or bar, paints nothing for that field (and is a debug assertion for the second, a host's mistake).
- **A placeholder or failed row paints nothing;** only a loaded row asks its page for paint.
