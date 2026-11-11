# Lessons learned

One entry per milestone part (per milestone if it has one part), written before starting the next: what surprised us, and what it taught us. The decisions it made are in [`DECISIONS.md`](DECISIONS.md). A showcase has no results notes; a number worth keeping sits with the decision it settled.

<!-- Template:
## M<n>, part <X>: <title> (YYYY-MM-DD)

**Surprises:**
- What didn't go as expected, and what it taught us.
-->

## M0, part A: the two canvases standing (2026-11-10)

**Surprises:**
- **The canvas was one setting from transparent.** The plan carried a fallback layout because GPUI's web canvas is opaque. It is, but only in how the browser composites it: the pixels under it were already premultiplied with a true alpha. Reading the renderer's clear and blend before building anything saved the fallback. The fix isn't one flag upstream, though: wgpu's WebGPU backend lists opaque as its only alpha mode, so the setting has to be made on the page.
- **A control can fail for a good reason.** `?opaque` (the shim off) hides the scene in Chromium and WebKit and not in Firefox, where GPUI falls back to WebGL2 and there's nothing to turn off. It read as a failure until the backend explained it.
- **The GPU, not either canvas's CPU, set the frame rate.** With 1.57 M points animating, the main thread sat idle (under 1 ms a frame) while a third of the frames came late. Smaller dots and fewer solver steps, the two things expected to matter, changed nothing; fewer pixels or fewer points did. The table flinging over a still scene never dropped a frame.
- **The table's tooltip opens inside the panel,** above its cell, so it never tested "a tooltip over the scene". The time control's (gpui-kit's own) did.
- **Five rows have no ellipse** (e at or past 1): the shader skips them, so every dot is a row but not every row is a dot. The table shows them with NULL in the columns computed from the orbit, and their own a, e, and i as the file has them.
- **A release isn't heard where the press was.** GPUI delivers a mouse-up to the element under the pointer, so a shape released over the panel left the clock held until the review caught it; the surface listens for the release outside itself too.
- **A frame sample that throws stops the frame recorder for good:** the spike's sample called into the wasm before it was ready, and every interval read 0 with no error anywhere.

Numbers and decisions: [`DECISIONS.md`](DECISIONS.md), "Scene", "Table", "Input".

## M0, part B: the moves (2026-11-10)

**Surprises:**
- **The flight, the move that looked hardest, was the cheapest:** one number from Rust and a mix in the shader, no buffer touched. It drops no more frames than time running does.
- **The pick, the move the research called affordable, is the one that stalls.** Placing 1.57 M rows once on one thread takes about 0.4 s in every browser, at the release, where a visitor is watching. A selection needs the positions only once, but once is still too long to do in one task.
- **A group drawn in space doesn't stay a group.** Time was meant to pause only while the shape is drawn. With it running again at the release, the group's radius grew by half in a second and more than doubled in three: the camera would arrive at a smear. Time now stays paused on a group.
- **Dust is only dust at one distance.** Flown in, dots of a fixed size and opacity thinned to nothing; the first fix burned the group white and lost the ramp. Brightness holds when a dot's area and its opacity each grow with the camera's nearness.
- **The outline had to change hands.** GPUI draws the shape while the pointer moves, in window pixels; the moment the camera moves, those pixels are wrong. Closed, the shape belongs to the scene, on the ecliptic.
- **The clock stopped when the scene did.** Landed in a against e the scene has nothing to draw, and the clock had only ever been moved by the scene asking for it: the date froze. A clock is read by whoever needs it, never ticked by a renderer.
- **The live column needed no `live`, and the filter did.** Cells computed at draw time refresh with a plain redraw; it was the group's filter (a new count, every row changed) that used the feature.
- **The refresh rate was the wrong lever to stare at.** At a year a second the distance moves faster than its decimals can be read at any rate; how fast the clock runs decides what's readable. And a timer asked for 60 a second gives 27 to 35.
- **A script's own screenshot reader showed up as a page problem** (Chromium's canvas readback warning, from the page the pixels were counted in).

Numbers and decisions: [`DECISIONS.md`](DECISIONS.md), "Scene", "Look", "Table".

## M0, part C: the rows' source, and the close (2026-11-11)

**Surprises:**
- **On a fast link the two sources tie.** The table's first rows came as soon from 113 MB held in Rust as from DuckDB reading one page: the engine's own download and start cost about what the whole rows file does. The choice was made by everything else: what a filter and a sort are, and what the page already has to hold.
- **The scene had already decided most of it.** Every dot needs its row's elements in memory before the belt is drawn, and a pick answers in row numbers. A table over DuckDB would have fetched the same rows a second time, in a second format, to a second place.
- **A drawn group isn't a scattered read.** The research expected a group's rows, spread through the file, to be DuckDB's hard case. In the file's own order a page of a group's rows covers a narrow run of the file (a tenth of the rows: a page spans about 10,000 of them, one row group). It's a sort that scatters them.
- **Held as it arrives, the file costs its own size and nothing more:** the wasm's memory grew by the file's bytes to the megabyte, and holding it took the time of one copy. The elements, parsed into a second buffer, leave their first copy's space behind.
- **A sort's time was mostly how it was written.** The first reading had a text column 17 times slower than a number; it was checking each name's UTF-8 at every comparison. Comparing bytes, the text sorts in half the time, and the number, given a tiebreak (most rows have no diameter), in three times its own. And the text's offsets weigh half as much as the text they point into.
- **The belt waited on the table, in the measuring page.** The rows were fetched beside the elements and the belt drawn after both: on a slow link that tripled the belt's time and said nothing of the app, which loads the elements first. The review caught it.
- **The spike's own files were the slow link's problem before the rows were:** uncompressed, the elements alone put the belt 23 s out on Fast 4G. The preview server sends a `.bin` as it is.
- **And it inflates a `.gz` by itself.** The page inflated it a second time and the fetch failed; the script, waiting ten minutes for a mark behind a pipe that showed nothing, looked like a slow run. The wait is three minutes now, and a page error ends it at once.

Numbers and decisions: [`DECISIONS.md`](DECISIONS.md), "Table", "Stack", "Planning".

## M1, part A: the fetch, and what it decides (2026-11-11)

**Surprises:**
- **The sample's three decimals were the API's doing, not the catalog's.** The query API rounds every number for display unless asked not to (`full-prec=1`); asked, a comes at 16 digits. The 9,580 distinct values of a were a display setting.
- **The join would have worked, and that wasn't the question.** Every row of the seven-week-old sample is still in the catalog under its key, with nothing renumbered. What decided against it was the 220 rows whose orbit had been refitted since: a cell from September beside a dot from November, on one row 160 au apart.
- **The rows off the common epoch are the ones nobody saw again.** A sixteenth of the catalog sits at some other epoch, back to 1927, and bringing them forward on a Kepler orbit looked like the risky step. They were watched for a median of six days: where they are now is a guess in JPL's numbers too.
- **Not every row has six elements.** One orbit was fitted as an exact circle and has no mean anomaly at all, and seven have no ellipse (two more than the sample had).
- **The raw fetch lives in the worktree.** `data/raw/` is gitignored, and this fetch's date is part of the dataset: a worktree removed takes the pinned pages with it.

Numbers and decisions: [`DECISIONS.md`](DECISIONS.md), "Data"; the fetch: [`data.md`](data.md).
