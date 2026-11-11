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

## M1, part B: the two files (2026-11-11)

**Surprises:**
- **Real orbits cost four times the spike's bytes, and no layout gets them back.** The spike's a, e, and i were 8.7 MB on the wire because the API had rounded them; at full precision, with three angles beside them, the elements are 34.6 MB, and the digits are noise to a compressor. Every precision tried lands between 19 and 35. The slow link's answer has to be what's drawn while the file arrives, not the file.
- **The question wasn't 32 bits against 16, it was which elements.** Three of the six only turn the orbit and are fine in 16 bits. The other three set its size, its shape, and where the body is on it, and their error is multiplied: by the clock for a, and by up to a thousand near the perihelion of an orbit with e near 1.
- **The worst rows are the strange ones, and there are few of them.** With e and the mean anomaly in 16 bits, the median row is a hundredth of a pixel off and 63 rows are more than a pixel off, one by 16 au. A median would have passed it.
- **Where zero is put mattered more than a column's width.** The mean anomaly from 0 to 360, as JPL writes it, is coarsest just before perihelion; the same float from -180 to 180 is finest there, and the worst row's error fell fifty-fold for nothing.
- **The file is already finer than the GPU.** The same floats through a 32-bit clock, as the spike's shader has it, come out about three times farther off than the file puts them. Precision past 32 bits would have shown nowhere.
- **The text was a number all along.** Every full name in the catalog is a number, an optional name, and a designation, and every designation has one of a few shapes that fit 32 bits. Three text columns and their offsets, half the spike's rows file, became one integer column and a short list of names, with every row rebuilt and compared at prep.
- **The catalog's order isn't its key's.** The API returns the numbered asteroids by number and the rest by designation, not by `spkid`; the files keep that order, which puts a row's number at its place.

Numbers and decisions: [`DECISIONS.md`](DECISIONS.md), "Data"; the files: [`data.md`](data.md), "The two files".

## M1, part C: seen, and the close (2026-11-11)

**Surprises:**
- **The files were right the first time they were drawn.** The Trojans came up as two clouds on the 60° lines and the Hildas as a triangle with nothing adjusted: no frame turned the wrong way, no angle in the wrong order. The check that would have caught either is one number, a known body against JPL at the epoch, and it read a millionth of an au.
- **The Hildas' corners were 5° off the lines, and it was Jupiter, not the Hildas.** The resonance ties their far points to Jupiter's mean longitude; the Trojans keep to Jupiter's place. Jupiter was 5.3° ahead of its mean that day, so one group sat on the lines and the other beside them. Measured from the mean, the corners are a third of a degree from the rule.
- **A two-body orbit is exact for a day and a sketch for a century.** A millionth of an au at the epoch, 0.04 au for Ceres ten years on, 0.2 au at fifty. The belt as a picture doesn't change; a named body does. The research's "looks the same over decades" is true of the ring and not of Ceres.
- **The Trojans leak.** On Kepler orbits a quarter of them have left their clouds in 50 years, and Hektor is 30° from its place in 1976. The integration planned for the resonant groups was thought of as their story; it turns out to be what keeps them where they are.
- **Jupiter needed its own mass.** Placed with a row's mean motion it ran most of a degree slow in 50 years. One number, its own mean motion, made a single ellipse as good as JPL's table of elements with rates.
- **The textbook rule for a Hilda would have thrown real ones out.** Adding "e under 0.3 and i under 20°" to the orbit size turns away 807 rows the resonance's own angle holds. The plain a from 3.7 to 4.2 au is the better pick: 96% of its rows are held.
- **Eight thousand dots among 1.58 million can't be seen.** The first shot of the Hildas was an empty sky with three lines on it. Graying the rest wasn't enough; they had to be brightened sixfold. Board 2 will have the same problem.
- **Importing a script for one constant ran it.** The check imported the fetch script's output path, and every run of the check fetched from JPL again. A script that does work at its top level exports types only.
- **The spike's moves didn't notice the real orbits.** All 34 of its input and move checks passed unchanged, and a drawn group shears apart at the rate the seeded angles had said (1.5 au to 3.6 in three years).

Numbers and decisions: [`DECISIONS.md`](DECISIONS.md), "Scene"; the check: [`data.md`](data.md), "Checked against Horizons".

## M2, part A: the app stands (2026-11-11)

**Surprises:**
- **Holding a file once took no `unsafe`.** Every section of both files starts on a 4-byte boundary, so the bytes are kept as 32-bit words and a float is a word's bits. The alignment the scene's views will need and the safe read came from the same choice, made at prep a milestone ago for another reason.
- **The memory came out to the files' bytes and a tenth of a megabyte.** 90.64 MB for 90.52. A stream written straight to its place leaves nothing to free, where a response read whole would have been a second 44 MB on the page's side for a moment.
- **The first row with `A/` is also a row with no ellipse.** Asteroids on comets' orbits are where the hyperbolas are, so two of the fixture's rules landed on rows of the same kind, and both have no period.
- **A published target sat 10 px off, and the script's test of it was right to refuse.** An absolutely placed child with no inset starts inside its parent's padding, so the handle's bounds reached past the window's edge. The harness waits for bounds inside the viewport, and waited a minute.
- **The check read where the cells were while the panel was still sliding.** A press aimed with those places landed on nothing, and the key after it did nothing; the time went on the table's focus, which was fine. Places are read once what they're on has stopped moving.
- **Nothing gives the table the keys but its host.** A press on it does, but a panel opened by its handle had no focus until pressed; Tycho and the bare host both focus it themselves, and now this host does.
- **The spike's surface colors were the theme's.** Its hex constants for the handle and the panel were gpui-kit's dark `popover`, `border`, and `muted_foreground`; the app names the tokens.

Numbers and decisions: [`DECISIONS.md`](DECISIONS.md), "Table", "Data", "Scene", "Planning"; the evidence: [`PLAN.md`](../PLAN.md), M2's checks.
