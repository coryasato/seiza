# PLAN.md — kirkwood

What's next for kirkwood, the density plot (named for Daniel Kirkwood, who found the gaps in the asteroid belt that it shows): its milestones in order, the active milestone's "done when" checks, its features to come, long-term goals, and open questions. Only what's still open lives here. It's the one list of the plot's features: Tycho adopts one as a milestone of its own and links here, and never restates the spec.

**Goal:** a GPUI plot of two numeric columns, every row, as a grid of counts drawn as one image: zoom, pan, a click that names a point, and a box that names a region, at row counts where a mark per row can't be drawn. The data comes from a delegate that answers bins; the plot knows no app, no engine, and no table.

**Where everything else lives:** what it offers today in [`README.md`](README.md); its rules in [`CLAUDE.md`](CLAUDE.md); finished milestones in [`docs/milestones.md`](docs/milestones.md); decisions in [`docs/DECISIONS.md`](docs/DECISIONS.md); surprises in [`docs/LESSONS.md`](docs/LESSONS.md); what it measures of itself in `perf/results/` (created with the first measurement). It has no budgets: each app measures a feature against its own when it adopts it.

---

## Where planning stands

Planned on 2026-11-10, out of the research for Tycho's long-term goal ([`../../docs/research/density-plot.md`](../../docs/research/density-plot.md); its numbers, Tycho's [`perf/results/2026-11-10-plot-research.md`](../../apps/tycho/perf/results/2026-11-10-plot-research.md)). That research is this component's too: M1 opens on it and has no research part of its own. Nothing is built: no crate, no host. The names below (the crate's types, the Cargo features) are drafts until each is built.

**Design first** (decided 2026-11-10): M1's Part A starts once the plot's look is drawn on a design canvas (["Open questions"](#open-questions), the first).

---

## Status

| Milestone | Title | Status |
|---|---|---|
| M1 | The base and its bare host: bins drawn as an image, axes, zoom, pan, and the click | Specced, not started |
| M2 | `select`: a box drawn on the plot | Planned |

One milestone per feature after the base. A *Planned* row's spec is its row under "Features"; its spec and checks are written into "Active milestone" when the one before it closes.

**Closing a milestone:** every "done when" check passes; the numbers are in `perf/results/` with a note; new decisions are in `docs/DECISIONS.md`; a `docs/LESSONS.md` entry links the note; the README's Features table has the feature's row and cost; and the spec and evidence move from here to the end of `docs/milestones.md`, leaving one row above. For a feature, also flip its row in each app's "Waiting on" table (listed under "Who's waiting") to *Ready* (the date and the milestone); each app adopts it in a milestone of its own.

---

## Measuring a feature

As the tall table does ([its PLAN](../tall-table/PLAN.md), "Measuring a feature"): the component measures only itself, in a bare host, and nothing gates on the numbers.

- **The bare host** (`host/`, built in M1): a wasm `cdylib` that renders the plot and nothing else, built and packaged the way the apps are, never deployed. One Cargo feature per plot feature, each switching the feature on at run time, so the optimizer can't strip it and read it as free.
- **Its data is a seeded point set held in memory and binned in Rust:** no DuckDB, so the bytes and frame work are the plot's alone. Two shapes, pinned because every number is read against them, at the protocol's 1440×900, DPR 2: **1.57 M points** and **25 M points**, each a mix of clusters and empty bands so most bins at the edges are empty, as the samples' are. `?delay=<ms>` holds each bin read that long, standing in for a source that takes DuckDB's 0.4–1 s.
- **What's measured:** bytes (the base's whole wasm; each feature against the base), and frame work under the root's measurement protocol in three segments: the plot at rest, a scripted zoom-and-pan gesture with reads held (the held image moving), and a grid landing (at 256², 512², and 1024²).

---

## Features

The order: the base, then `select`. Tycho needs both; nothing else has asked. Later candidates are under ["Long-term goals"](#long-term-goals) and are built when a host asks.

| Feature | Cargo name (draft) | What it adds | Depends on |
|---|---|---|---|
| The base | *(none)* | The delegate and its bins, the grid drawn as one image through a color ramp, axes and their ticks, the count line, wheel zoom about the pointer, drag pan, a reset, their keys, a flipped axis, and the click event | — |
| A box | `select` | A box dragged on the plot, shown with its ranges; adjusted, cleared; `Selected` events | The base |

### Who's waiting

| Feature | Waiting | Their note |
|---|---|---|
| The base | Tycho | [`apps/tycho/PLAN.md`](../../apps/tycho/PLAN.md), "Waiting on": the plot beside the table, a click jumping the table to its row |
| `select` | Tycho | The same row: a box filtering the table to its rows |

---

## Active milestone

None started. M1 is next; its spec and parts are below, ready to start once the open question on its look is answered.

### M1: The base and its bare host

**What it builds.** The crate `seiza-kirkwood` (on `gpui-kit`, and the `image` crate for its buffer type, without codecs) and its bare host. The design and its reasons are the research's ([`../../docs/research/density-plot.md`](../../docs/research/density-plot.md), "Zoom and pan", "Drawing", "The component's shape"); what follows is what's pinned.

- **The delegate:** `load_bins(request, cx)` answers a task and an id, and `cancel(id, cx)` stops one, as the tall table's `load_page` and `cancel` do. A request is the extent (`x` and `y`, each a half-open range of f64) and the grid (bins across and down). The answer is the counts, dense and row-major, a u32 a bin, with how many rows the source binned them from and how many it will hold (equal once it's whole).
- **Bins:** a point is in the bin its coordinates floor to; an extent is half-open, so a point on its upper edge is out; NULL and NaN are never binned; an empty or inverted extent is the host's mistake and a refused request. Pinned by a fixture (`fixtures/bins.json`: points, extent, grid → counts) with a negative control (a closed upper edge must fail it).
- **The grid's size** follows the plot's: one bin per 2 CSS px, at most 512 a side by default; both numbers are the host's to set (`Binning`).
- **Drawing:** the landed counts colored on a log scale through a ramp (two or more stops, theme tokens, mixed in Oklab; empty bins clear), made into one `RenderImage`, painted with `Window::paint_image`, and released with `Window::drop_image` when replaced or when the state is dropped. The state keeps the counts, so a theme change re-colors without a read. An axis can be flipped (`Axis::flipped`), drawing high values at the bottom or the left.
- **The held image moves; the read sharpens.** While the view differs from the held grid's extent, each frame paints the held image where its extent falls in the view (cropped and scaled by `paint_image`). When the view has rested 80 ms (`Binning::settle`), the state asks for the view's bins. One read is in flight: a view that changed meanwhile is read when that read answers; an answer for a view since left is drawn only if it overlaps the current view more than the held grid does.
- **`invalidate(binned, total, cx)`:** the host says the source changed (more rows arrived); the state reads the current view again, under the same one-in-flight rule, and the count line follows.
- **The count line:** rows binned, of the total while they differ, and whether a read is out. Text the component draws, and the host can read (`KirkwoodState::summary`), so an app can put the same words where a screen reader finds them.
- **Axes:** ticks at round numbers (1, 2, 5 × a power of ten), their labels, and each axis's title (the host's string), drawn by the component. gpui-kit's `plot` scales are used only if the build finds they fit a zoomable axis and link nothing else.
- **Gestures and keys:** wheel zooms about the pointer (Shift: the x axis alone; Alt: y alone); a drag pans; a double-click, or `0`, resets to the extent the host set; arrows pan a tenth of the view; `+` and `-` zoom about the center. Every one moves the held image on the frame it happens.
- **Events:** `ViewChanged(extent)` when the view rests; `Drawn { extent, binned }`, emitted in render on the first frame that draws a landed grid (so a host's mark lands right after the presented frame); `Clicked { x, y, within }`, a click that wasn't a drag: the point in data coordinates, and `within`, 4 CSS px as a range on each axis, for a host to find its nearest row in.
- **A frame never waits on bins,** and nothing in the base holds a point: only the delegate does.

**Parts, one session each.**

**Part A: the crate, the fixture, and the bare host drawing a plot at rest.** The delegate and its types; the state's read of the set extent; coloring and the image, its release; axes and the count line; `invalidate`. The bare host (`host/crate`, `host/web`, the component's `justfile`: `build`, `size`, `smoke`) over the seeded points, with `?points=`, `?delay=`, and `?grow=<rows/s>` (the source filling in, calling `invalidate`). Native tests on GPUI's test app. No gestures.
- [ ] **A1** The bins fixture passes natively against the bare host's binning, and its negative control (a closed upper edge) fails.
- [ ] **A2** The host paints both shapes: screenshots in light and dark, at DPR 2 and 1, each checked against the fixture's counts at ten seeded bins (a bin's pixels are the ramp's color for its count; an empty bin's are the background's).
- [ ] **A3** A theme change re-colors the plot on its next frame with no bin read (the delegate's calls counted).
- [ ] **A4** 200 grids landing in a row (`?grow`) leave one image in the atlas: GPU memory, or the atlas's tiles through a test hook, flat from the 10th to the 200th.
- [ ] **A5** The base's wasm recorded (raw, after wasm-opt, brotli 11), and `just kirkwood size` fails if an engine, the tall table, or `seiza`'s panel links, or a build holds a home-directory path.
- [ ] **A6** Frame work at rest recorded in both shapes, reference and throttled; a frame with nothing changed draws no more than the research's held image did (within its spread).

**Part B: the gestures, the moving image, and the events.** Zoom, pan, reset, their keys; the held image painted at the view's place each frame; the settle, the one read in flight, the overlap rule; `ViewChanged`, `Drawn`, `Clicked`; the host's probes and marks for the scripts (`__kirkwood`: the view, the held extent, reads out).
- [ ] **B1** A scripted zoom-then-pan gesture (2 s, wheel events every frame) with reads held 500 ms: no late frame at the reference run, the image at a new place on every presented frame, and no bin read started before the view rested.
- [ ] **B2** After the gesture rests, the drawn grid is the fixture's counts for the final extent (the ten seeded bins again).
- [ ] **B3** Native: any number of view changes during one read start exactly one more read, for the last view; `invalidate` during a read does the same; a dropped state cancels its read and releases its image.
- [ ] **B4** `Drawn` lands in the task that presents the frame (`shared-web/perf/`'s `presentedMark`), in Chromium, Firefox, and WebKit.
- [ ] **B5** A click's `x`, `y` are the pointer's data coordinates within half a bin, at three zooms and with an axis flipped; a drag emits no click.
- [ ] **B6** The keys: each moves the view by its amount and reads once after it rests; none leaves the plot's focus.

**Part C: measured, documented, closed.** No new code but what the measurements ask for.
- [ ] **C1** `just kirkwood perf` (reference and throttled, cold, median of 10, both shapes): frame work at rest, in the gesture with reads held, and on a grid's landing at 256², 512², and 1024²; late frames; recorded in `perf/results/` with a note.
- [ ] **C2** The default grid (512 a side) lands inside one frame at the reference run; throttled, what it costs is recorded and the README says it.
- [ ] **C3** The README: the API, the Features table with the base's row, limits, and "Canvas tradeoffs" (no accessibility tree and what `summary` offers in its place, the keys, what a click can't do from a keyboard, color alone).
- [ ] **C4** A manual check in Firefox (WebGL2) and Safari: the plot draws, zooms, and lands a grid; differences noted.
- [ ] **C5** Closed: decisions logged, a `docs/LESSONS.md` entry, the spec and evidence moved to `docs/milestones.md`, Tycho's "Waiting on" row flipped to *Ready* for the base, the root `CLAUDE.md`'s layout and commands current.

### M2: `select` (spec to come)

Written when M1 closes. What the research fixed: a box is two ranges in data coordinates, half-open as an extent is; `Selected(Some(box))` when one is drawn or adjusted and `Selected(None)` when it's cleared; the box stays put in data space under zoom and pan; the component draws it and its ranges, and counts nothing (the count is the host's, from its source). To settle in its spec: how a drag tells a box from a pan (a mode, or a modifier), the keys that nudge and apply one, and whether the box is applied as it's dragged or on release (a host's count takes 6–170 ms: Tycho's research note).

---

## Long-term goals

Built when a host asks; each opens with its own research.

- **A log axis:** the asteroids' semi-major axis spans 0.9 to 64 au between its 0.1% and 99.9% quantiles.
- **A hover readout:** a bin's ranges and count under the pointer.
- **Color by a third column:** the mean or the mode of a column per bin, in place of the count.
- **A marginal histogram** along each axis.
- **Points at a deep zoom:** marks for single rows once the view holds few enough (a quad a bin cost 5 ms a frame at 4,096 bins in the research's spike, so a few thousand at most).
- **A lasso,** and whatever the asteroid-belt showcase needs of the plot ([`../../docs/research/asteroid-belt.md`](../../docs/research/asteroid-belt.md)).
- **A fine grid kept by the source** for shallow zooms (the research's 4096² table: 25–100 ms a re-bin against 14 ms–1 s): the source's, but the plot's read may want to say "an approximate answer now, the exact one after".

## Open questions

- **The plot's look:** the ramp's stops in both themes, the legend, the axes' and the count line's place and wording, and the empty state before the first grid. Drawn on a design canvas before M1's Part A (decided 2026-11-10), so the build follows a design and not a guess; the canvas also draws the plot in Tycho's workbench (its place beside the table, the axis pickers), which Tycho's adoption waits on.
- **Linear sampling at a deep zoom:** whether single-count bins read as points or smudges when the image is magnified; settled with Part B's screenshots, and if smudges, the image is made at a multiple of the grid.
- **The color scale's top:** the view's fullest bin (colors re-scale as the view zooms) or the first grid's (a deep zoom is dim). The first, unless the legend built in Part A reads badly.
- **The ramp's Oklab mixing** is also in the tall table (`src/paint.rs`). A copy here until a third user appears; then a small crate both depend on.
- **The crate's name:** whether `seiza-kirkwood` is free on crates.io. Only matters if it's published.
