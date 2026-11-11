# Research: a density plot linked to the table (2026-11-10)

Measured on an Apple M1, macOS 26.6.2, machine `local`. A throwaway spike, **one run each, not protocol runs**: load average 6–7, and a cargo build ran beside the second Gaia run. Bytes and request counts are exact (counted at the server); times are hints, good for telling 50 ms from 5 s. DuckDB-Wasm 1.32.0 (DuckDB v1.4.3, one thread) through Tycho's bridge in Chromium 153 headless=new; native DuckDB 1.4.5; gpui-kit 0.9.1.

Raw: `2026-11-10-plot-research.json` (every query's times, result bytes, `/data/` bytes and requests; the spike's frames; the wasm sizes).

The reasoning these numbers feed is in [`docs/research/density-plot.md`](../../../../docs/research/density-plot.md); the decisions, in [`docs/DECISIONS.md`](../../docs/DECISIONS.md), "Density plot".

## What was measured

The plan's design (bin the open file with a `GROUP BY`, per open and per zoom), and what could replace each part of it, on both samples: semi-major axis against eccentricity on the asteroids (`a`, `e`: 1,567,523 rows), color against magnitude on Gaia (`bp_rp`, `phot_g_mean_mag`: 25,067,889 rows). The files came by range from a local server with no throttling, so a time here has no network in it; the bytes and requests say what a network would add.

## The two columns in each file

| | Asteroids | Gaia |
|---|---|---|
| The two columns, compressed | 5.7 MB of 37.7 MB | 165.4 MB of 1,572.7 MB |
| Row groups | 52 | 409 |
| Read to scan them once | **17.6 MB, 155 requests** | **280.8 MB, 2,448 requests** |
| Read by the next scan | 0 (DuckDB kept the bytes) | 280.8 MB, 2,448 requests again, every time |

A scan asks for ~3 requests per column chunk (the readahead restarts at each chunk: 16 KB, 64 KB, 256 KB) and reads 1.7–3× the chunks' own bytes. At R2's 55–125 ms a range read ([`2026-10-10-m8.md`](2026-10-10-m8.md)), the requests alone come to an estimated 9–19 s for the asteroids and 2–5 min for Gaia; the busiest 10 s a visitor sends today is 93 requests ([`2026-10-12-waf-burst.md`](2026-10-12-waf-burst.md)).

## Binning: the file, a copy in DuckDB's memory, or the page

A 512² grid; "zoomed" is a twentieth of each axis or so (130,540 asteroids, 3,799,001 stars).

| | Asteroids | Gaia |
|---|---|---|
| **From the file:** full extent | 82–115 ms | 6.4–7.7 s |
| zoomed | 35–40 ms | 3.3–3.7 s |
| rows in a small box, counted | 22–25 ms | 3.1–3.3 s |
| extent: min/max; 0.1%–99.9% quantiles | 295; 227 ms | 4.3; 7.2 s |
| a slice of 16 row groups, binned | 36–45 ms | 191–263 ms (11.0 MB, 96 requests) |
| **Copied once into memory** (`CREATE TABLE … AS`, the two columns as `FLOAT`, an attached `COMPRESS` database) | 60 ms warm, 1.0 s cold under load | 4.7 s (13.6 s beside a build) |
| its DuckDB memory | +19.5 MiB | +153 MiB |
| then: full extent | 50–54 ms | 958–991 ms |
| zoomed | 14–19 ms | 423–440 ms |
| a 1024² grid, full extent | 69–74 ms | 1.19–1.39 s |
| rows in a small box, counted | 6 ms | 168–170 ms |
| the row nearest a click (in a small box) | 7–17 ms | 176–213 ms |
| 0.1%–99.9% quantiles | 192 ms | 3.1 s |
| **A 4096² grid kept as a table**, built from the copy | 215 ms (1.02 M cells) | 2.0 s (3.68 M cells, +17 MiB) |
| re-binned to 512² | 25–28 ms | 100–103 ms |
| **In the page:** the columns as `FLOAT` Arrow, per 16 row groups | 26–30 ms (4.0 MB) | 66 ms (8.1 MB) |
| a loop binning every row's float32 pair (JS, a stand-in for Rust) | 10–13 ms | 153–171 ms |

The copy's `rowid` was the file's row number at the three places checked on each file (first rows, middle, last). Native DuckDB bins Gaia in 1.09–1.16 s on one thread (243–330 ms on eight), so the wasm build's copy in memory is at the native one-thread speed; the file's 6–7 s is the reading.

## A box as the table's source

The box's rows numbered into an index (`CREATE TABLE … AS SELECT rowid … ORDER BY rowid`: 12–470 ms), then a page of 1,024 of them joined back to the file by `file_row_number`.

| Sample | Rows in the box | Share | A page spans (file rows) | A page costs |
|---|---|---|---|---|
| Asteroids | 1,135,118 | 72% | 1,380 | 45–52 ms, 0.7–1.4 MB |
| | 130,540 | 8.3% | 11,356 | 20–38 ms |
| | 6,148 | 0.39% | 281,607 | 110–134 ms |
| | 501 | 0.03% | the whole file | 0.8–1.0 s, 40.5 MB the first time |
| Gaia | 3,799,001 | 15% | 4,017 | 127–199 ms, 5.6 MB |
| | 40,753 | 0.16% | 412,777 | 542–681 ms, 34–56 MB |
| | 4,863 | 0.02% | 3.4 M | 1.4–3.6 s, 145–408 MB |
| | 1,652 | 0.007% | 15.5 M | 8.5–10.5 s, **930–945 MB, each time** |

A page reads every row group its rows fall in, all columns: cheap for a dense box, the file itself for a sparse one. Where a file row sits in the selection (a click on a filtered table) took 2–12 ms.

## A file laid out for the plot

The two columns as `FLOAT`, in the file's row order, ZSTD, written natively with large row groups, then copied into memory through the bridge:

| File | Size | Row groups | Read | Requests | Copy |
|---|---|---|---|---|---|
| Asteroids, the sample | 37.7 MB | 52 | 17.6 MB | 155 | 1.0 s |
| Asteroids, `a` and `e` | 5.2 MB | 2 | 5.2 MB | **5** | 101 ms |
| Gaia, the sample | 1,572.7 MB | 409 | 280.8 MB | 2,448 | 4.7–13.6 s |
| Gaia, `bp_rp` and `phot_g_mean_mag` | 165.3 MB | 24 or 3 | 165.3 MB | **15** | 2.4 s |

## Drawing the grid in GPUI

A view drawing every frame, the plot filling 1440×900 at DPR 2 (WebGPU), each rAF callback timed for 4 s, median of 3 runs. p50 ms, reference / CPU 4×:

| What a frame does | 256² | 512² | 1024² | 2048² |
|---|---|---|---|---|
| Nothing (the control) | | 0.7–1.2 / 1.6–2.3 | | |
| Paints a held image (`paint_image`) | 1.1 / 2.2 | 1.2 / 2.3 | 1.3 / 2.2 | 1.4 / 2.4 |
| Paints it cropped and scaled, differently each frame | | 1.1 / 2.2 | 1.2 / 2.3 | |
| Colors a new grid and uploads it, every frame | 1.6 / 5.1 | 4.9 / 16.7 | 13.6 / 56.2 | |

No late frames in any row but the 1024² replace (4 of 234 at the reference run; every frame throttled) and the 512² replace throttled (14 of 227). One quad per non-empty bin (`paint_quad`) cost 5.2 / 18.7 ms at 64², 29.5 / 119.5 at 128², and 173.7 / 799 at 256².

**The image's wasm:** the spike with and without the image (`paint_image`, `RenderImage`, the `image` crate's buffer type, no codecs) differed by +2.3 KiB after wasm-opt and +1.3 KiB brotli, inside the ~2 KiB brotli moves between builds (the tall table's README, "Features"). The atlas, the sprite pipeline, and `image` already link.

## Experiments and controls

- **Two group keys against one** (`GROUP BY bx, by` against `by * n + bx`): 5.7 s against 6.4–7.7 s on Gaia from the file, 81 against 82–115 ms on the asteroids; the result is half again as large (1.78 MB against 1.19 MB). Not the lever: the reading is.
- **A page bounded by its slice's first and last row** (`file_row_number >= min AND <= max` beside the join): 22 against 30 ms, 57 against 79 ms. The join already bounds the scan.
- **The first version of the spike's "new grid" frames seeded each grid inside the frame** (two `exp` a bin) and read 10.2 ms at 512²; the table's numbers are from grids seeded before the first frame.
- No negative controls: nothing here is a check.

## Reproducing it

The spike is thrown away (its scripts held machine paths). Its queries, on a file registered as `f` with columns `x` and `y`, an extent `[x0, x1) × [y0, y1)`, and an `n`² grid:

```sql
-- bins
SELECT floor((y - y0) * n / (y1 - y0))::INT * n + floor((x - x0) * n / (x1 - x0))::INT AS k, count(*)::INT AS n
FROM read_parquet('f') WHERE x >= x0 AND x < x1 AND y >= y0 AND y < y1 GROUP BY 1;
-- the copy
ATTACH ':memory:' AS plot (COMPRESS);
CREATE TABLE plot.pts AS SELECT x::FLOAT AS x, y::FLOAT AS y FROM read_parquet('f');
-- a box's rows, and a page of them
CREATE TABLE plot.sel AS SELECT rowid AS r FROM plot.pts WHERE <box> ORDER BY rowid;
SELECT f.* EXCLUDE (file_row_number) FROM read_parquet('f', file_row_number = true) f
WHERE file_row_number IN (SELECT r FROM plot.sel WHERE rowid >= k AND rowid < k + 1024) ORDER BY file_row_number;
-- the row nearest a click at (cx, cy)
SELECT rowid FROM plot.pts WHERE <a small box around it> ORDER BY (x - cx) * (x - cx) + (y - cy) * (y - cy) LIMIT 1;
```

The GPUI spike was one view calling `Window::request_animation_frame` each render and painting through a `canvas` element: `Window::paint_image(bounds, image_bounds, …)` on an `Arc<RenderImage>` made from an `image::RgbaImage` (BGRA bytes), the old image released with `Window::drop_image`.
