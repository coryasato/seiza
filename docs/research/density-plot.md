# Research: a density plot linked to the table

The research that opens Tycho's density plot ([`apps/tycho/PLAN.md`](../../apps/tycho/PLAN.md), "A density plot linked to the table"): whether it's worth building, and how. Researched 2026-11-10, from the pinned source (gpui-kit 0.9.1, gpui-pre 0.3.12, gpui-pre-wgpu 0.3.12), the DuckDB engine's gotchas ([`engines/duckdb/CLAUDE.md`](../../engines/duckdb/CLAUDE.md)), the tall table's `sort` research ([`tall-table-features.md`](tall-table-features.md), "What a source does to answer": the same problem from another side), and a spike, since thrown away: both samples binned through Tycho's bridge every way weighed below, and a GPUI view drawing a grid as an image. The numbers are in Tycho's [`perf/results/2026-11-10-plot-research.md`](../../apps/tycho/perf/results/2026-11-10-plot-research.md) (one run each on a busy machine: hints for times, exact for bytes and requests); the decisions are logged in Tycho's [`docs/DECISIONS.md`](../../apps/tycho/docs/DECISIONS.md), "Density plot". This file keeps the reasoning and the options weighed.

**The answer: worth building, as a component, with one part of the plan's design replaced.** Drawing is nearly free and the plot is useful on any file. But a plot's cost is the rows', not the grid's: binning reads the two columns of every row, and on a large file over HTTP that read can't be repeated per zoom. The two columns are read once into DuckDB's memory, and every bin, box, and click after that is answered there.

---

## What the plan assumed, and what held

| The plan said | Measured |
|---|---|
| DuckDB bins the rows into a grid with a `GROUP BY` | Holds. One integer key (`by * n + bx`) and a count: the answer is the non-empty bins, 84 k of a 512² grid on the asteroids, 147 k on Gaia (0.7–1.2 MB of Arrow). |
| The plot draws the grid as one image, no custom shader | Holds. `Window::paint_image` on a `RenderImage`: a held image costs a frame 0.1–0.2 ms at any grid size to 2048², and the image path adds ~2 KiB of wasm. |
| The cost is the grid's, not the rows': 25 M rows cost what 1.57 M do | **Doesn't hold for the query.** Gaia's two columns are 165 MB of the file; a bin of them from the file took 6.4–7.7 s against the asteroids' 82–115 ms, and read 281 MB in 2,448 requests. Only the drawing costs the grid. |
| Zoom re-bins the visible extent | **Not from the file.** A zoomed bin of Gaia read the same 281 MB again (3.3–3.7 s with no network; minutes with one). From a copy in memory: 0.42–0.44 s. |
| A box becomes a `WHERE`, and the host gives the table that query as a new source | Holds for a dense box. A sparse box's rows are scattered through every row group, so one page of it read 945 MB of Gaia: the sorted page's problem again. |
| A click becomes the nearest row's index, then `jump_to` | Holds: 7–17 ms on the asteroids, 176–213 ms on Gaia, from the copy, whose `rowid` is the file's row number. |

---

## Where the points live

Every interaction after the first paint of the plot (a zoom, a pan, a box's count, a click) needs the two columns again. Three places they could be:

- **In the file, read each time** (the plan's design). On the asteroids DuckDB kept the bytes after the first scan (every later query read 0 bytes) and a re-bin took 35–115 ms. On Gaia nothing was kept: every query read 281 MB again. Which files are kept isn't a setting the engine exposes (its gotchas: no `db.open` option changes the reading), so one design can't count on it. Rejected.
- **Copied once into DuckDB's memory** (chosen): `CREATE TABLE … AS SELECT x::FLOAT, y::FLOAT`, in an attached `COMPRESS` database as the CSV's chunks are. 20 MiB for the asteroids, 153 MiB for Gaia, against the engine's 1.5 GiB budget for a CSV. A re-bin then took 14–54 ms on the asteroids and 0.42–0.99 s on Gaia (native DuckDB on one thread takes 1.1 s for Gaia's, so that's the engine's speed, not the wasm build's). A box's count took 6 / 170 ms and the nearest row 7–17 / 176–213 ms. The copy keeps the file's order, so its `rowid` is the table's row index: the link to the table is a number, with no join to the file.
- **In the app's memory, binned in Rust.** A loop over every row's float32 pair binned Gaia in 153–171 ms (JS typed arrays, a stand-in), 3–6 times faster than DuckDB's hash aggregate. But it's 200 MB of the app's wasm memory for Gaia, which never shrinks (Tycho's memory budget is 128 MiB, and its rule 3 says the app never holds the result), and the box and the click still need the rows in DuckDB, so the points would be held twice. Rejected; it stays the fallback if a re-bin's 0.4–1 s proves too slow in use.

**`FLOAT`, not `DOUBLE`:** a plot bins to a few hundred steps an axis; float32 holds 7 digits. It halves the copy. The box's `WHERE` on the table's own source compares the file's doubles, so a row on a box's edge can count in the plot's number and not in the table's, or the reverse: the table's count comes from its own query, never the plot's.

**A fine grid kept beside the copy** (4096², the default extent's counts as a table) re-binned to 512² in 25 / 100 ms, a tenth of the copy's time on Gaia, for zooms shallower than 8×. It's 2 s to build and another path to keep right (two answers for one view must agree). Not in the first build: the held image already answers a zoom at once (below), and the fine grid is added only if the re-bin's wait reads as slow.

**A CSV is already there.** Tycho copies a CSV into in-memory tables, one per chunk, so its plot bins those tables and copies nothing; its row index is the chunks' `rowid`s in order.

---

## The first read

The copy is the plot's one read of the file, and it's the rows': 17.6 MB for the asteroids, 281 MB for Gaia, more than the columns' own bytes (5.7 and 165 MB) because DuckDB's readahead restarts at every column chunk. What that means differs by where the file is:

- **A dropped file** reads from disk: 60 ms–1 s for the asteroids' size, 5–14 s for Gaia's, with nothing on the network.
- **A file over HTTP** pays per request: ~3 requests per column chunk, so 155 for the asteroids and 2,448 for Gaia, one after another (the worker reads with synchronous XHRs). At R2's 55–125 ms a read that's an estimated 9–19 s and 2–5 min, and more requests in 10 s than anything Tycho sends today (93 at its busiest), which the WAF's rate limit was set from.

Two things follow.

**The read is progressive, and says so.** The copy runs in slices of row groups, one `CREATE TABLE … AS` per slice, as a CSV's chunks do (appending to one table stalls: the engine's gotchas). A slice of 16 row groups took 36–45 ms on the asteroids and 191–263 ms on Gaia. After each, the plot bins what's arrived and draws it with the count beside it ("12.4 M of 25.1 M rows"), so the first picture is up after one slice and the UI stays usable (repo rule 2). Both samples are sorted by an id, not by a plotted column, so a partial plot covers the whole plot's area with the file's first rows, not one corner of it; its proportions aren't the whole's (the first asteroids numbered are the main belt's brightest), which is why the count says how many rows it holds.

**The hosted samples need a file laid out for the plot.** Their row groups are sized for the table's paging (30,720 and 61,440 rows), which is what makes a column scan 155 or 2,448 requests. The same two columns as `FLOAT` in a file of their own with large row groups read in **5 requests (5.2 MB) for the asteroids and 15 (165 MB) for Gaia**, and copied in 0.1 and 2.4 s. A file per sample holding every numeric column that way serves any pair, since a scan reads only the two it's asked for. It's a data-layout change (a second file per sample, its rows in the first's order, a manifest entry, R2), so it's Tycho's to decide when it adopts the plot, measured in production; until then Gaia's plot over HTTP is minutes. Gaia's 165 MB stays a large download either way, and Tycho says the size before it starts ("plotting reads 165 MB").

A file's column sizes are in its footer (`parquet_metadata`'s `total_compressed_size`, free once the footer is read), so the UI can say what a plot will read before reading it.

---

## Zoom and pan

**The held image answers first; the re-bin sharpens it.** `paint_image` takes the bounds to paint into and the bounds the whole image would cover, and crops and scales between them in the sprite's own math: a frame that paints the held image at a new zoom or offset cost the same 1.1–1.2 ms as one that paints it still. So a wheel or a drag moves the last grid immediately, magnified or shifted, every frame; when the view rests, the plot asks for the new extent's bins, and swaps the image when they land. This is how a map draws tiles, and it makes the re-bin's time (14–54 ms on the asteroids, 0.4–1 s on Gaia) a sharpening delay, never a frozen frame.

- **One bin read in flight; the newest view wins.** A started DuckDB query can't be stopped (the engine's gotchas), so a view that changed while a read was out is read once that read answers, and its answer is drawn meanwhile if it's nearer the view than what's held. The tall table's `live` re-reads coalesce the same way.
- **The view rests before it reads,** as a scrollbar drag does in the table (80 ms there): a wheel gesture is dozens of events, and each read is up to a second of the worker.
- **Zoomed out past the held grid,** the image covers part of the plot and the rest is empty until the read lands. Drawn as it is; the count line says a read is out.

---

## Drawing

**One image, through `paint_image`.** The pinned GPUI has no custom-shader API on the web (`paint_surface` is macOS and iOS only), and the other primitives don't scale to a grid: a quad per non-empty bin cost 5 ms a frame at 64², 30 ms at 128², and 174 ms at 256². The image is a polychrome sprite in GPUI's atlas, sampled linearly, drawn by the WebGPU and WebGL2 paths alike.

- **What a new grid costs:** coloring 512² counts and uploading them took ~4 ms over an empty frame (~15 ms at CPU 4×); 1024² took ~13 ms (~54 throttled). It's paid when bins land, not per frame. So the grid is **at most 512 bins a side by default**, about one bin per 2–3 CSS px of a plot filling the window: a landing grid stays inside a frame at the reference run, and one late frame throttled. The side is the host's to set.
- **The image is released when it's replaced** (`Window::drop_image`): an atlas tile is kept until its image is dropped, and a plot makes a new image per re-bin.
- **Linear sampling:** a bin drawn 2–3 px wide is blended with its neighbors, and a held image magnified by a zoom is smooth, not blocky. Right for a density; whether single-count bins at a deep zoom read as points or as smudges is settled with a screenshot in the build.
- **Counts to colors:** a log scale by default (a density's counts span four or five decades: the asteroids' fullest bin holds thousands, most hold one), through a ramp whose stops are theme tokens, mixed in Oklab as the table's cell ramps are. The state keeps the landed counts, not only the image, so a theme change re-colors without a read. Empty bins are clear: the plot's background shows.
- **The scale's top is the grid's fullest bin,** so a zoom re-scales the colors. The alternative (a fixed scale from the first grid) makes deep zooms dim. Settled in the build, with the legend that shows it.
- **Axes** (ticks at round numbers, their labels, the column names) are text and lines the component draws itself. gpui-kit's `plot` module has scales and axes for its charts; whether they fit a zoomable axis and what they link is checked in the build before reusing them (its `Input` linked three engines for one field: root `CLAUDE.md`, "Known GPUI Kit web gotchas").

---

## The link to the table

**A click** is the nearest row to the pointer within a few pixels, asked of the copy; its `rowid` is the table's row, so the host calls `jump_to`. With a box applied, the table's rows are the box's, and the click's row is its position among them (2–12 ms from the index below).

**A box** is two ranges, and the table needs three things from them: a count, a page by index, and the same rows as the plot.

- **The count** comes from the copy (6 ms / 170 ms), and is shown as the box is drawn.
- **A page by index** needs to know which file row is the box's *k*-th. An index (`CREATE TABLE … AS SELECT rowid … ORDER BY rowid`, 12–470 ms) answers that, and a page joins its 1,024 rows back to the file. What that page costs is how far apart its rows are in the file:

  | The box holds | A page reads |
  |---|---|
  | 15% of Gaia (3.8 M stars) | one row group: 5.6 MB, 127–199 ms |
  | 0.16% (40,753) | 34–56 MB, 0.5–0.7 s |
  | 0.02% (4,863) | 145–408 MB, 1.4–3.6 s |
  | 0.007% (1,652) | 930–945 MB, 8.5–10.5 s, each time |

  A box is drawn around few points as often as many, so the sparse case is ordinary. What a source can do, by how sparse the box is, is the `sort` research's ladder again:
  - **Dense** (a page spans a few row groups): pages join from the file, as measured.
  - **Sparse, and small enough:** the box's rows copied once into an in-memory table and paged by `rowid` (3–4 ms a page on the asteroids, after a 0.9 s copy of 130,540 rows). The copy reads every row group the box touches, once, where paging would read them per page; few rows is what makes a box sparse, so the copy is small.
  - **Sparse, over HTTP, in a large file:** the copy is most of the file (a 1,652-star box touches every row group of Gaia: 1.5 GB). Tycho says the size and asks first, or refuses past a limit, as `sort` refuses a Parquet file past the memory budget.

  The thresholds are Tycho's, set when it adopts the plot, measured against its budgets; `sort`'s adoption builds the same machinery (an index, a copy within a budget, a refusal past it), so the two share a source.
- **The same rows as the plot:** the index is built from the copy's float32 values, so the table shows exactly the rows the plot counted, edges included.

**The table changes its rows** when a box is applied or cleared: a new count, every page another row's. That's `set_rows` and a re-read of everything, which the table has (`live`'s `invalidate_rows`, or a new state as an open makes); which one, and what the scroll position does, is the adoption's.

---

## The component's shape

A component (root `CLAUDE.md`, "Tiers"), `components/kirkwood/`, in the tall table's shape: a view, a state entity, and a delegate trait for the data. It knows no app, no DuckDB, and no table.

- **The delegate answers bins:** given an extent and a grid size, a task that resolves to the counts, and a cancel, as `load_page` answers a page. What's behind it (a file, a copy, a seeded point set in the bare host) is the source's.
- **The state** holds the view's extent, the held grid (its counts, extent, and image), the read in flight, and the selection; it asks the delegate when the view rests and when the host says the source changed (`invalidate`, with how many rows the source holds now of how many, for the count line).
- **Events, not callbacks into an app:** a click (the point in data coordinates and the pixel tolerance as data ranges), a box drawn or cleared, the view changed, and a grid drawn (emitted in render, so a host's mark lands right after the presented frame: the table's rule 4).
- **Base and features.** The base draws bins for a view, axes, the count line, wheel zoom, drag pan, a reset, and the click. A box is a Cargo feature (`select`), off by default; Tycho turns it on. Candidates after it, built when a host asks: a log axis (semi-major axis spans 0.9 to 64 au at the 0.1% quantiles, and Gaia's diagram reads fine linear), a hover readout of a bin's ranges and count, color by a third column, a marginal histogram per axis, and the showcase's lasso ([`asteroid-belt.md`](asteroid-belt.md)).
- **A bare host** for its own costs, as the table has: the plot alone over a seeded point set binned in Rust, where each feature's bytes and frame work are read against the base.
- **A fixture for the bins:** points, an extent, and a grid → the counts, with the edges pinned (an extent is half-open, a point on the upper edge is out; NULL and NaN are never binned; a zero-width extent is refused). It runs natively against the bare host's binning and against the SQL the engine writes, so the two can't drift.

**What's the engine's:** the bin SQL, the copy and its slices, the box's index, the nearest-row query, and Arrow's `(k, n)` pairs turned into the delegate's counts, behind a feature named for the component (`seiza-duckdb`'s `kirkwood`), as the table's source is. **What's Tycho's:** the panel beside the table, the two columns' pickers, the default extent (quantiles, so two hyperbolic comets don't flatten the belt: `a` runs from −15,680 to 14,510, and its 0.1%–99.9% quantiles from 0.9 to 64), the link to the table, the sizes it says before reading, and the samples' plot files.

---

## Canvas tradeoffs

A plot on a canvas has what the table's canvas has, and one more:

- **No accessibility tree.** The plot is pixels; a screen reader sees nothing. The same is true of a plot drawn with WebGL in a DOM app, but a DOM app can put a description and a data table behind it. What the plot can honestly offer is its numbers as text the host can surface: the extent, the rows binned, a box's ranges and count. The README says so.
- **Keyboard:** the base's zoom, pan, and reset get keys (arrows, `+`/`-`, `0`), and a box can be nudged and applied by keys once it exists; a click's "nearest point" has no keyboard form. Listed as a gap.
- **No text selection or Ctrl+F** on tick labels or the count line, as on the table's cells.
- **Color alone carries the density.** The ramp is checked for both themes, and the legend gives the numbers.

---

## What it costs

- **Wasm:** the image path is ~2 KiB over a host that already links GPUI (inside build-to-build noise). The component's own code (axes, gestures, the ramp, the state) is measured in its bare host when it's built; Tycho measures it against its wasm budget when it adopts it.
- **Frame work:** a held or moving plot, 0.1–0.2 ms a frame. A landing grid, ~4 ms once (512²).
- **Memory:** the copy is DuckDB's (20 MiB for the asteroids, 153 MiB for Gaia), freed when the file closes or the columns change. The app holds one grid's counts and its image: 1 MiB each at 512².
- **The worker:** a re-bin is up to a second of DuckDB's one thread on Gaia, and queries run round-robin, so a table page asked for during a re-bin waits with it. The plot reads only when the view rests; whether a table scroll during a re-bin shows is measured at adoption.

---

## Open for the build

- **Bins that land for a view already left:** drawn if nearer the current view than the held grid, by what measure (overlap of extents) settled with the gesture built.
- **The count line under a partial read** and under a box: its wording, and where it sits, on the design canvas before the build.
- **The ramp's stops** and the legend, in both themes.
- **Gaia's magnitude axis runs downward** (bright is up in a Hertzsprung–Russell diagram): an axis can be flipped by the host. In the base, since the showcase sample needs it.
- **Whether the ramp's Oklab mixing is shared with the tall table's** (its `paint.rs` has the conversion): two components can't depend on each other or on `seiza`, so it's a copy or a third crate. A copy until a third user appears.
- **Firefox and Safari:** the spike ran in Chromium on WebGPU. Headless Firefox falls back to WebGL2, where the atlas upload is a different path; both get the build's manual check.
