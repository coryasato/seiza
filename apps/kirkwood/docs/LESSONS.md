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

## M2, part B: the belt on its orbits (2026-11-11)

**Surprises:**
- **The clock we worried about was fine, and the solver nobody questioned was wrong.** Two open questions were about the shader's 32-bit clock far from the epoch. Run in floats against the 64-bit place, the clock costs a hundredth of a pixel at 50 years; the spike's six Newton steps put a row 30 px off at the epoch itself, and hundreds of au off at the ends. The estimate that raised the worry had mirrored only the clock's sum and solved the equation in 64 bits.
- **The wrong rows were never seen.** One to three dots of 1.58 million in the wrong place can't be found by looking, and every screenshot of the spike was right. Only a comparison of every row, in arithmetic, shows them.
- **A real GPU agreed to a twentieth of a pixel.** Three rows drawn alone and found in a screenshot sat 0.02 to 0.05 px from where 64-bit math put them, a decade out as well as at the epoch.
- **The Sun came out yellow.** Three.js holds a color in linear light and a hand-written shader gets it raw: the Sun's `fff3d6` was drawn as `ffe5ab` until the shader wrote it out as the display's. The check that caught it was reading the disc's color where the crate puts the Sun.
- **Nothing had to be decided about a slow link to show something on one.** The scene's module is a hundredth of the elements' size, so starting it first puts the Sun, Jupiter, and its orbit on screen for the whole wait, as a side effect.
- **A view of memory is only good for the task that made it.** The scene asks the crate everything first, then makes its views and uploads them with no call into the wasm between: any call could grow the memory and empty the views before the GPU read them. The same fact leaves a lost WebGL context unhandled.
- **Seven rows are a sentence, not a shader.** Drawing the hyperbolas would have meant a second solver for seven points far outside the picture; counting them apart took a line of text and made the count on screen more exact than the one before it.
- **The date label had to notice the clock stopping.** The scene's own reading carries the clock to its last day, so a label that redraws only while time moves would have frozen a few days short of the end.
- **Fifty seconds to the end of time.** At a year a second the whole reach from today is under a minute, inside the two minutes the app hopes a visitor stays.

Numbers and decisions: [`DECISIONS.md`](DECISIONS.md), "Scene", "Input"; the evidence: [`PLAN.md`](../PLAN.md), M2's checks.

## M2, part C: the look, the legend, and the sky (2026-11-11)

**Surprises:**
- **The decided look came back on the first build.** Written anew from the decisions' numbers, with none of the spike's code, the opening shot sat beside the spike's and matched. The decisions had recorded every number that mattered, which is what they were for.
- **The real angles changed the picture more than the look did.** The spike's top-down shot has a faint green ring; the app's has two green clouds, 60° either side of Jupiter. Nothing in the look moved: the Trojans were finally where they are.
- **The Hildas' triangle is violet without being asked.** Lit alone, the rows from 3.7 to 4.2 au come out in the one stop the ramp gave them. The ramp chosen on a flat storyboard needed no change on the real rows.
- **The star count in the decisions was wrong, and the spike's own file said so.** The note said 760,754; the file it described was 4 bytes and 8 a star for 779,012. A count is worth pinning where it's counted.
- **A legend drawn from the scene's table can be checked, and one typed twice can't.** With the ramp in Rust the legend is the same mix the shader does, and the check reads the bar's pixels against what the scene was handed.
- **A row with no H was one comparison from vanishing.** The spike wrote 99 for none; the app's file holds NaN, and a shader's comparison with NaN is the compiler's to drop. The bits don't lie, and one such row drawn alone is now a check.
- **The Sun's name was under the glow.** Thirteen pixels below a 14 px disc is inside a 250 px glow. Board 1 had drawn it 36 px down all along.
- **The sky made the page's first claim false.** "Every dot is a row" sat over 779,012 dots that aren't. The fix was a sentence, shown when the stars are.
- **A check on a hard disc doesn't want the look.** Haze is an eighth of the buffer's resolution, so its glow around a lone disc would have been found with the disc; rows drawn alone are drawn plain.

Numbers and decisions: [`DECISIONS.md`](DECISIONS.md), "Look", "Data"; the evidence: [`PLAN.md`](../PLAN.md), M2's checks.

## M2, part D: what was left to choose (2026-11-11)

**Surprises:**
- **No lever reaches 60 but the one already turned down.** The bloom at half its size is worth under a frame a second and a dot half the size is worth one; with the sky, the haze, and the bloom all off the belt alone is still past a frame. The look was never the cost.
- **Drawing the belt small and the sky sharp bought nothing.** The belt at half resolution under a full-resolution sky drew exactly what the whole scene draws at three quarters, with a second buffer to pay for. It was built, measured, and taken out the same hour.
- **A dot's size doesn't change the frame rate, and the resolution does.** So the cost isn't the pixels a dot fills, which is what "points times pixels" had been read to mean.
- **The slow link's 34 seconds had been estimated right, and seeing them was still what decided it.** A page about dots with no dot for half a minute reads differently in screenshots than as a number in an open question.
- **A column at a time can't be drawn early at all.** No row is whole until the file's last column, so "draw what has arrived" was never a change to the page: it is a change to the file.
- **The preview server had never sent the data as a deploy would.** Every load so far read the files uncompressed, so the slow link couldn't be measured until the server could compress them.
- **Other browsers passed, and showed a difference that isn't theirs.** Firefox and WebKit ran everything; what looked different was DPR 1, where a star is one bright pixel. The look had only ever been seen at DPR 2.
- **The glass panel needed no change to the table.** The table's fills are theme tokens, so the app made them clear. And from the opening camera the glass shows almost nothing: what lies under the panel is thin sky.
- **A part can end by finding the next one.** The close was this part's, and a measurement moved it: the file in blocks is part E.

Numbers and decisions: [`DECISIONS.md`](DECISIONS.md), "Scene", "Data", "Table", "Planning"; the evidence: [`PLAN.md`](../PLAN.md), M2's checks.

## M2, part E: the belt fills in as it arrives (2026-11-11)

**Surprises:**
- **Cutting the file cost almost nothing on the wire.** The columns are noise to a compressor whether they run 1.58 million rows or 16,384: 0.6% more at the block size chosen, and 0.8% at a quarter of it. The block's size was free to be chosen for how the fill looks.
- **The plan expected a draw a block, and the belt stayed one draw.** A buffer of the scene's own, written a block at a time, left the block's size with nothing to do with the draws; "from the draws it makes" turned out to have no number in it.
- **Three.js keeps what it uploads.** Its attribute holds its array, and here an array is a view that dies when the wasm's memory grows. Before, one upload hid that; filling a block at a time needed a buffer Three.js doesn't own.
- **Drawing each block as it came made a fast load slower.** Locally the 97 blocks land in a tenth of a second, and a hand-over for each put the whole belt 230 ms later than the file whole had. The fix was also the right thing for a reader: a count that changes four times a second, not ninety.
- **The estimate of the first dots was pessimistic.** D2 guessed 5.6 s for a 65,536-row block; with a block a quarter the size they are on screen at 4.3 s, a tenth of a second after the scene itself.
- **"Counted from the rows" needed a second meaning.** The rows that have arrived and the rows the scene has drawn part ways while the scene's module loads, so the count is of what the scene says it drew, and the check counts those rows again from the file's bytes at every reading.
- **Whether time runs was settled by arithmetic before it reached the eye.** At a year a second a slow link would spend 34 of the clock's 50 years filling the belt. The knob to look at both was built and was gone the same hour.
- **A header checked as it arrives turns a wrong file down 20 bytes in.** Reading the file a block at a time moved the check from the end of 44 MB to its start, for free.

Numbers and decisions: [`DECISIONS.md`](DECISIONS.md), "Data", "Scene"; the evidence: [`milestones.md`](milestones.md), M2's checks.

## M3 part A: the flight and the landing (2026-11-12)

The sort flight, built anew from the spike's decision: the crate's progress and axes, the shader's flight, what leaves the picture, and time.

**Surprises:**
- **The haze that makes the belt in space fills the gaps on the axes.** It is the picture blurred wider than a gap: the 3:1 read 69 of 255 with it and 14 without, and the 2:1 came out brighter than the empty belt beside it. "Decide by eye" was decided by a strip of pixels.
- **The 2:1 is an edge, not a gap.** The check says "darker than a tenth of an au either side", and past 3.28 au there is almost nothing to be darker than: 8.9 against 14.0. It passes, narrowly, and only without the haze.
- **The check for the flight found a bug that wasn't the flight's.** Jupiter's orbit line crossed its disc whenever Jupiter was on the far half of its orbit: Three.js sorts transparent things by depth. No check had read Jupiter's color that far from the epoch.
- **A clear highlight color changes nothing.** GPUI blends a highlight's color over the text's own, so the sentence that was to fade stayed whole; the style's `fade_out` is what thins a run.
- **0.6 isn't a 32-bit float.** The axes' top came out 0.00003 px off the board's, and "in view" at exactly e 0.6 would have meant one thing to the shader and another to the crate; the comparison is now made once, in the shader's floats.
- **A row with no place on the axes shouldn't fly.** Sent toward where its a and e would be, it crosses the plot on its way off it. It fades where it is.
- **A screenshot from one run can't be set against the numbers of another.** A stale frame was chased that wasn't one: time was running, so each run paused on a different date.

Numbers and decisions: [`DECISIONS.md`](DECISIONS.md), "Scene", "Look"; the evidence: [`../PLAN.md`](../PLAN.md), M3's checks.

## M3 part B: the furniture, the count, and the close (2026-11-12)

GPUI's furniture on the crate's plot, the count of rows in view, the panel open, and M4's spec.

**Surprises:**
- **The board's title is not the app's.** Board 4 draws a title that ends 84 px down; the app's says three lines more and ends at 152, across the e axis's top, its 0.6, and its label. Part A landed the dots on the board's plot without anything to collide with. The axis yields, and the title's height is now a question the next board (the card) has to answer.
- **Beside the open panel two gaps are closer than a chip is wide.** The 5:2 and the 7:3 are 43 px apart on the board and 24 with the panel open. The chips part and their lines stay put.
- **The furniture was laid out a frame before the title it dodges was measured.** Held mid-flight with time paused, nothing asked for another frame, and the label sat on the legend until the next thing moved. A measurement that another element reads has to ask for the frame that uses it.
- **A target inside a bordered box is a pixel short all round.** An absolute child fills the padding box, so a chip's published bounds came out 33 by 22: the check found it against the board's 35 by 24.
- **A fill read under the pointer is the hover's.** The pressed action read 245 of 255, not the board's 250: the click had left the pointer on it. And a reading taken from one frame against bounds from another put the unpressed one at 101.
- **The flight's frame rate fell by a third, and it wasn't the furniture.** Another session's tests had the machine. Run turn about with the furniture off, the two were the same; a frame rate here is only worth setting beside one taken the same minute.
- **`1.0 - 0.9` over `0.1` isn't 1.** The axes "whole once landed" came out at 0.9999999999999998 until the ramp was counted from the landed end.

Numbers and decisions: [`DECISIONS.md`](DECISIONS.md), "Interface", "Input"; the evidence: [`milestones.md`](milestones.md), M3's checks.

## M4 part A: the frame that turns with Jupiter (2026-11-12)

The second action, the camera's flight to straight above and its turn with Jupiter, board 2's names and triangle, the two groups' light, and the two actions together. On the Kepler orbits.

**Surprises:**
- **The turning frame needed nothing from the dots.** The plan spoke of every dot, the Sun, the orbit, and the sky turned by one angle; the angle is the camera's, and the shader never hears of it. Even the flight to the axes from a turning camera came free.
- **JPL's class for a Trojan is two comparisons.** The class is in the rows file and the shader has only the elements; a and e between JPL's own bounds pick the same 16,472 rows, every one, so the scene can light a group it was never handed.
- **Board 2's triangle isn't through the three points.** It is drawn at 0.86 of Jupiter's distance, through the Hildas' corners; the plan's is at Jupiter's a. Found only by reading the board's path against the numbers.
- **Brightening the groups is an exaggeration, and rule 3 wants it said.** The stars' sentence had just left a place in the title to say it in.
- **A year from the epoch the clouds already smear.** Riding in 2035 on the Kepler orbits the Trojans' clouds have spread along Jupiter's orbit and the Hildas' corners blurred: the ride is where two-body orbits show their age, which is what the integration is for.
- **A fill read with time running is read against a row that moves.** The date's width changes as its digits do, the two buttons shift, and bounds read a frame after the screenshot put the sample in the gap between them: 7 of 255 for 38, one run in three. The lesson of the last part again, in a new place.
- **The title had never been on the owner's screen.** Every check drew it; a real GPU draws GPUI's text subpixel, which leaves the canvas's alpha at 0 over the clear window, and the browser composites it away. Found only because a sentence was added there and the owner went looking for it. Headless Chromium can't draw the failing path at all: a real browser is the only check.
- **A sky that turns honestly is nauseating.** The arithmetic said distracting; the owner's stomach said more. Nothing now shows that the view turns, and that reads fine.
- **A test that steps a second at a time meets the stall guard.** The ride's own test moved it half its length in one reading, which the progress takes for a tab back from the background.

Numbers and decisions: [`DECISIONS.md`](DECISIONS.md), "Scene", "Look", "Interface"; the evidence: [`milestones.md`](milestones.md), M4's checks.

## M4 part B: the Hildas and the Trojans, integrated (2026-11-12)

The integrator in Rust and its tests against Horizons, the two groups as a draw of their own from places the crate hands over, the cost of a frame and of a jump, which Hildas, and the clock's reach.

**Surprises:**
- **The step's length doesn't show against Horizons.** Hektor is 0.017 au off in 2076 at a step of half a year and at a 32nd: what's left is Saturn's, not the step's. The step had to be chosen against a shorter step, row by row.
- **A Newton step that lands on the bracket's end was turned away.** The solver asked for a step strictly inside the bracket; the root was the bracket's end, so every drift fell back to bisection: right to the last digit and four times as slow. Found only when a looser stop made the answers wrong.
- **The clouds' count looked like a trend, and was an alias.** Counted every 12.5 years the Trojans in their clouds fell steadily toward 1976: 12.5 years is a hair over one of Jupiter's turns, and the count breathes with that turn. Counted every year it goes between 15,540 and 16,174.
- **It costs no frames.** Three milliseconds a frame on the processor, and the scene's rate is the same to the noise: the frame waits on the GPU.
- **An old check found the catch-up before a new one was written.** Hektor drawn alone in 2036 was 1.57 px from the crate's place: exactly its ellipse, for the frames the steps were still being taken. The checks now wait for the rows to be there, and that wait is a number.
- **A disc under the title's text reads two pixels off.** In 1976 from straight above Hektor sits behind "they're". The camera is turned half round for that date.
- **On the epoch the two pictures are the same to the pixel.** Not close: none of 3.24 million differ, a second draw and a different order of blending included.
- **`just` hands a `;` to the shell.** `--ways "a:;b:x=0"` through the recipe ran one way and then tried to run the rest as commands; the frame rates were asked of `node` itself.

Numbers and decisions: [`DECISIONS.md`](DECISIONS.md), "Scene"; the evidence: [`milestones.md`](milestones.md), M4's checks.

*After review:* a step undone isn't a step never taken. The first build stepped back the way it came when that was shorter, and a row that had passed close to Jupiter wouldn't have come back to the same float; steps are now only taken away from the epoch, and a place is the same to the bit by any way.

## M4 part C: a gap picked, and the close (2026-11-12)

The chips as buttons, the marker on an orbit exactly in step with Jupiter, its path in the turning frame, the dim, the card under the title, and M5's spec.

**Surprises:**
- **The plan's loop couldn't close.** "Over one of Jupiter's orbits" is true of the 3:1 and the 2:1 only: at 5:2 the marker is half a turn from where it began, 411 px away. The path closes after the ratio's second number of Jupiter's orbits, and the five-lobed and seven-lobed curves that makes are the better pictures.
- **The card's numbers named which Jupiter.** The check asked for 11.86 years "from Jupiter's a"; Jupiter's a alone gives 11.87, since Kepler's third law for a row counts no mass. The period is from Jupiter's own mean motion, and the marker has to turn by that too or its path drifts open.
- **The path is one curve, whatever the date.** The frame turns by Jupiter's true longitude and Jupiter's orbit isn't a circle, so it looked as if the path would have to be redrawn as the clock ran. Exactly in step, everything repeats together: the crate hands the curve over once.
- **Board 5 had quietly dropped board 2.** No Trojans' names, no Hildas', no triangle: found by reading its markup for what wasn't there. The triangle's sides would cross every path.
- **A target in a bordered box, again.** The card's bounds came back a pixel short all round, the gotcha already written down for the chips.
- **A screenshot of a moving marker is of the next frame.** Its color read at the place the scene last said was the dust beside it. The same lesson a third time: read a moving thing's pixels on a held clock.

Numbers and decisions: [`DECISIONS.md`](DECISIONS.md), "Scene", "Look", "Interface"; the evidence: [`milestones.md`](milestones.md), M4's checks.

*After review:* every check waited for the page to come to rest, and every fault was in between: a press while the camera was still flying, a second press on a chip still fading, a crossfade whose two halves did not meet. A check of a thing that moves needs a step taken while it moves.

## M5 part A: the drag, the wheel, and the glide (2026-11-12)

**Surprises:**
- **The pan needed no camera math of its own.** Asking where the pointer's ray meets the plane, through the camera as it's placed, and sliding by the difference is exact at any tilt, with the roll, and beside the panel: every check read 0.00 px. The view offset and the roll, the two things expected to need care, came free.
- **A map's horizon was the part the plan hadn't named.** The opening shot has sky in two corners and ground 76 au away along its top edge. A point held there flings the camera, and a wheel there carries it tens of au a notch: both needed a reach, and what the camera looks at a bound.
- **"Over the sky" came back as a place.** A ray that never meets the plane was given an infinite reach, and infinity isn't past an infinite limit: the check for the sky read a point of the ecliptic at infinity. The check caught it only because it asked for nothing there.
- **The pinch was already a wheel.** The first look the plan asked for was one read of gpui-pre-web: the default is taken whatever is held, and Ctrl is in the event.
- **Stepping the resolution costs the frame a hand feels, and the eye turned it down for another reason.** Three quarters while the camera moves buys 8 frames a second and spends 100 ms on the first frame of every drag; what the owner saw was the picture flickering back to sharp after a fling. The number said "maybe"; a real browser said no in a minute.
- **Up close, a dot is a star.** Nothing swells or breaks at the nearest zoom; the surprise is that the belt's few near dots and Gaia's stars are the same small points.
- **A flag read from the next frame reads late.** The glide's flag was set by the frame after the release, and the check read it before one came.

Numbers and decisions: [`DECISIONS.md`](DECISIONS.md), "Input", "Scene".

## M5 part B: tilt and turn, and each mode's rules (2026-11-12)

**Surprises:**
- **The live map wouldn't be read by a script.** The plan opened the part with "read the modifier off the live map". Scripted drags on it under every key only panned, as a Mac and as Windows, headless and in a window: a real map does not take a script's modifier as a hand's. Google's own documentation says Shift and the recollection said Ctrl, so both are built and the reading is the owner's, in ten seconds by hand.
- **Jupiter doesn't hold its place, and never did.** "Jupiter holds its place in the window" failed twice before the check was right: its orbit isn't a circle, so it goes 21 px in and out along its line from the Sun; and tilted it left that line by 6 px, which is its own 1.3° of inclination lifting it off the plane. What holds is the ecliptic's point under it, on its line. Straight above, neither showed.
- **The ride's camera was one more map, not a special case.** The ride had been "straight above the Sun, turned by one angle". Written as a map's numbers in the turning frame, with the same hand on it, its opening is bearing 0 and tilt 0, and every gesture came with no new arithmetic: the pan's one fact (the ray through the pointer meets the plane where the camera says) holds in any frame.
- **A Mac's Ctrl+click was already taken care of.** The worry was the browser's context menu on every tilt. gpui-pre-web takes every one; headless Chromium on a Mac does raise them (4 over the check's drags), and the drag turns the camera all the same.
- **Edge-on, the Trojans are the tall thing.** At 85° the main belt is a band and the Trojans' cloud stands well above and below it: the picture the tilt was for is more theirs than the belt's.

Numbers and decisions: [`DECISIONS.md`](DECISIONS.md), "Input"; the evidence: [`../PLAN.md`](../PLAN.md), M5's checks.

*After review:* the modifier became Shift alone, the owner's call: the live map tilted under no key by hand either, so there was nothing to copy. And every fault found was a place the ride's new camera could reach that the old one, fixed straight above, never could: the path of a picked gap behind the eye, a press in the one frame where the crate says "riding" and the picture hasn't arrived, a stop that was exact only while the distance was a plain number. A camera a hand moves goes where no check has stood.

## M5 part C: the way home, the hint, the legend, the keys, and the close (2026-11-12)

**Surprises:**
- **Board 10's list lay under the table's handle, and the board couldn't show it.** The list is as tall as the handle is high up; in the board's markup the list comes later and paints over the handle, in the app the handle is drawn last. Nobody saw it on the canvas. A board over a real screenshot still has its own paint order: what overlaps is found by adding up heights, or by building it.
- **The boards' fill wasn't the app's.** They paint the time control, the handle, and the corner neutral-900; the app's time control has been neutral-950 since it was built. The first run of the check read 10 where it expected 23. The corner took the fill of what it sits beside.
- **"Names the modifier as the machine does" had nothing left to check.** The check was written while the key might be Ctrl or Cmd. Part B chose Shift, which is Shift on every keyboard, so the list is one list.
- **The keys worked before any click.** The worry was a canvas with no keyboard until pressed. GPUI's web platform hears keys without one; what was missing was on GPUI's side, where a key with nothing focused reaches only the window's root, so the interface holds a focus of its own and takes it back when nothing has it.
- **An arrow up is 44 px and an arrow left 119.** The same distance along the ecliptic, at the opening's 66° of tilt. A pan by keys is measured on the plane, not in the window, and looks right.
- **The compass was free while the camera pans.** Told only when the turn or the tilt moves, the interface redraws for a tilt and for nothing else a hand does.
- **A hint beside an open panel had no room, and the boards never drew that state.** Their note says the corner moves left of the panel; at 1440 px the hint whole would then run under the row of actions. It became its button there, without counting as folded.

Numbers and decisions: [`DECISIONS.md`](DECISIONS.md), "Interface" and "Input"; the evidence: [`milestones.md`](milestones.md), M5's checks.

*After review, and the owner's look:* the review's faults were nearly all one kind, an input arriving while something else had the camera (H mid-drag, + at a stop during a flight, a press on the corner as it faded, a list left open under a sort); each new way to move the camera has to be asked what it does during every other. And the opening's roll came back the same day it was closed as gone. Part B had turned down "eased out on the first turn" by hand; with a way home, the same ease was right. A choice made by hand is a choice about the app as it was that day: the thing that was missing (a way back) wasn't in the question.
