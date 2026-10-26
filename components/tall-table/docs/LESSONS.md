# Lessons learned

One entry per milestone part, written before starting the next one: what surprised us, and what it taught us. The milestone's numbers are in its results note (linked from each entry; an app's own measurements of the feature are in that app), and the decisions it made are in [`DECISIONS.md`](DECISIONS.md).

<!-- Template:
## M<n>: <title> (YYYY-MM-DD)

**Results:** [`perf/results/<date>-m<n>.md`](../perf/results/<date>-m<n>.md)

**Surprises:**
- What didn't go as expected, and what it taught us. Numbers only where the surprise needs them; the rest are in the results note.
-->

## M1: the bare host and the base's baseline (2026-10-23)

**Results:** [`perf/results/2026-10-23-m1.md`](../perf/results/2026-10-23-m1.md)

**Surprises:**
- The observatory's GPUI contender is only 20 KiB brotli bigger than the bare host: DuckDB's client and the Arrow reader are small next to gpui-kit's 2.6 MiB. A feature's bytes read clearly against the base, but no feature will move a host's total much.
- A shared helper isn't free until it inlines. The bridge's `Publish::event` grew the contender 0.9 KiB brotli until it was `#[inline]`: a host's `None` arms only fold away once the call is inlined into it.
- The base draws ~310–340 cells a frame at 1440×900, not the 1–2 k the wide sheet's plan assumed: at 120 px columns and 30 px rows, 500 columns put only 11–12 on screen. Width alone doesn't make a frame dense.
- In the wide fling, making the host's in-memory pages (500 floats × 1,024 rows each) took 831 ms of main-thread time outside the frames, more than the frames' own work. That cost is the stand-in source's, not the table's. It sits outside the frame columns, so it doesn't touch a feature's frame work, but it does touch a host's total CPU.
- A stand-in source has to cancel like a real one. The host's `cancel` began as a no-op, so a read the table dropped still made its page; throttled, that was half the wide fling's outside-frame time (1,290 → 702 ms once fixed). At the reference run reads resolve before the table cancels them, so it hid there.

## M2: `custom-cells` (part A, 2026-10-24)

**Results:** [`perf/results/2026-10-24-m2-spike.md`](../perf/results/2026-10-24-m2-spike.md)

**Surprises:**
- The open point "a background or quads" mixed up two things. A `div`'s background is already one quad, so a fill costs the same either way. What separates the two drawings is the layout node: a bar needs a child element per cell, and that, not the paint, is what costs (+1.14 ms against +0.74 a frame).
- The ramp's per-cell math was expected to be the heat map's cost, and looked a small share of it (a hint only: that run failed the spread gate): most of the ~0.6 ms seemed to be the 300-odd extra quads themselves.
- The first write-up read the A/B's spread as an interquartile range (1–2%) instead of the gate's (max − min) / median, and called the fill for the element on a comparison that fails the gate (11.9%). The code review caught it, and that the bar quads, painted before the cells, would have sat under any fill on the cell's element. A spike that measures two paints apart doesn't test them together.


## M2: `custom-cells` (part B, 2026-10-24)

**Results:** [`perf/results/2026-10-24-m2.md`](../perf/results/2026-10-24-m2.md)

**Surprises:**
- Brotli can't tell whether a build changed. The spec's "the base within 0.1 KiB brotli" failed for the parent commit against itself: two builds of one commit at two paths read 0.5 KiB apart, and the unchanged base against its parent up to 2.2 KiB, with both the same size before brotli. A few shifted bytes (a panic site's line number) move brotli by kilobytes; the size after wasm-opt and a symbol check say more.
- The build embeds the builder's home directory: 974 absolute paths, the registry's and the toolchain's panic locations, in every release wasm. Found only because a worktree's build came out a different size. Planned as a repo-wide change (root `docs/research/build-paths.md`).
- A probe can bias a measurement it was built for. With `?perf`, the painted styles also published every drawn cell each frame and the control didn't; the code review caught it before the frame runs.
- The jump's highlight tint, drawn over a fill, vanished on a blue ramp: the same hue at 20% alpha. It needed an edge, not more tint.
- The table's Oklab mix matched Chromium's `color-mix` within one 8-bit step on every case, exactly on 34 of 36, from Björn Ottosson's published matrices alone: no gamut mapping was needed between in-gamut stops.

## M3: `live` (part A, 2026-10-24)

**Results:** none measured; the research is in the root's [`docs/research/tall-table-features.md`](../../../docs/research/tall-table-features.md), "`live`".

**Surprises:**
- The table's habit of cancelling what it no longer wants would starve a live page: cancelled and restarted on every update, a re-read under updates faster than its round trip never lands. A stale read is still newer than what's drawn, so it's kept, and the one-read-per-page limit is the coalescing.
- A row range can't time an update on screen: a read already out when an update arrives may predate it. Each invalidation needs a number the drawn page can be checked against.
- gpui-pre's `App::reduce_motion` exists, but its web platform never reads `prefers-reduced-motion`: a host has to set it.

## M3: `live` (part B, 2026-10-24)

**Results:** [`perf/results/2026-10-24-m3-b.md`](../perf/results/2026-10-24-m3-b.md)

**Surprises:**
- A source that answers at once still takes more than a frame to show an update: 18.7 ms at 10 updates/s with nothing in flight. The research assumed a read from memory costs "a spawn's round trip", which sounded like nothing; on the web each spawn is a `setTimeout(0)`, and the page lands after the frame it could have been in.
- The drag's settle couldn't be reused as it was: an invalidation calling it would restart the 80 ms on every batch, and a feed at 60 batches a second would hold a resting drag's loads off for good. It needed to know whether the pointer had already rested.
- A field behind a feature in a struct a host builds by literal breaks that host the day Cargo unifies the feature in, and `..Default::default()` can't guard it, since clippy rejects the update when every field is named. The bridge's new fields exist in every build.
- Every hand-derived `expect` in the six new paging scenarios matched the table on the first run; the one wrong expectation was in a unit test, where the cache was right to start prefetch beside a re-read.

## M3: `live` (part C, 2026-10-25)

**Results:** [`perf/results/2026-10-25-m3-c.md`](../perf/results/2026-10-25-m3-c.md)

**Surprises:**
- The push path wasn't needed. Polling a re-read once as it's sent read the same as handing the table a page (7.38 ms each), so a host with the page in hand already had the push: a ready future.
- The first A/B flattered both fixes. The batch's mark was set after the update, and once the page was built inside it, its cost fell outside the number (5.36 ms, not 7.2). A mark has to be set where the work starts, not where the call that did it returns.
- Landing reads at once turned a feed's row-by-row invalidations into a page read per row (~16 a batch), invisible while every read waited for a task. Coalescing to the update's end was needed only once reads became synchronous.
- The p95 stays over a frame (23 ms) whatever the table does: a batch that arrives just after a frame waits for the next. "Within a frame" holds at p50, not for every update.
- Landing a read in the turn that asked turns retries into loops. A failure landed at once would let a host retrying on `ReadFailed` spin inside one update, and a refused read marked stale again spun a turn at a time (a test that never parked found it). Only a page lands at once; a refusal waits for the next invalidation.

## M3: `live` (part D, 2026-10-25)

**Results:** [`perf/results/2026-10-25-m3-d.md`](../perf/results/2026-10-25-m3-d.md)

**Surprises:**
- A measurement's own rAF loop tripled the number it was there to sit beside. With `frameRecorder` on the page, invalidate → refreshed frame read ~20 ms against ~7 without: latency and frame work need separate windows.
- GPUI's `Instant` isn't public (its scheduler re-exports `web_time`'s, which the crate can't name without a dependency of its own), so the flash keeps time through a closure over the executor and an epoch.
- In GPUI's test app a frame callback, once delivered, notifies the view, and the redraw that follows asks again: "did the last frame ask for another?" can't be read from one count. The test delivers the frame asked for and checks whether the redraw asks again.
- The flash made updates slower to show, not only costlier: ~12 ms p50 against ~8. While it animates, a re-read landing between frames waits for the next one; without it, the table drew a landed page at once. Its p95 is lower, though (18 against 24 ms).
- The update rate hardly mattered: from 1k to 50k updates a second the bare host's feed changes every visible row in each ~29 ms batch, one page re-read a batch, so the cost is the redraws, not the rate. At 4× CPU the flash is what tips it over: every frame redraws every cell, and the main thread is busy ~995 ms of every second.

## M2 follow-up: `custom-cells`' follow-ups (2026-10-25)

**Results:** [`perf/results/2026-10-25-m2-follow-up.md`](../perf/results/2026-10-25-m2-follow-up.md)

**Surprises:**
- A fixture's `why` claimed more than its case showed: the fully translucent fill picks the same text color whether composited or not. Only a half-translucent one tells them apart. A claim in a fixture needs a control that fails without it, or it's prose.
- "The color under the fill" wasn't the color on screen: the jumped-to row draws its tint over a fill too, which the first build left out and the review caught. A pick made from the drawing has to follow the drawing's layers, not the row's.
- The contrast pick was free where it was feared to cost: an opaque fill's lightness falls out of the mix the fill already did, so 308 picks a frame read within the spread.
- The bare host's narrow shape never draws a bar below zero (its float ranges start at or above zero), so a smoke check that wanted both bar colors everywhere failed for want of data, not of code.

## M4: `follow` (part A, 2026-10-25)

**Results:** none measured; the research is in the root's [`docs/research/tall-table-features.md`](../../../docs/research/tall-table-features.md), "`follow`".

**Surprises:**
- Following the tail was never the hard part: the base drops a short last page whenever `set_rows` grows it, and at a tail that page is always short and always on screen. Under appends faster than a read, each append cancelled the read the last one started, so the rows in view would never have landed.
- The fix was already built: a grown page is a page whose rows changed, so `live`'s re-read path keeps it drawn and reads it again. `follow` depends on `live` rather than copying it.
- "Following means being at the end" can't start off: a table opened empty or small is at the end, so a loading CSV would have pulled its reader down with every chunk. Following had to be a flag the reader's actions set.
- Pinning to `rows()` would have put placeholders at the tail by design at high rates; pinning to the rows read so far keeps them off and moves the cost into a number (append → pixel), which then needed an event of its own (`TailDrawn`): `Refreshed` and `Filled` don't name a new page's rows.
- `set_rows` had no step in `paging.json`, so a DOM contender's behavior on a growing source was never pinned, even in the base.

## M4: `follow` (part B, 2026-10-25)

**Results:** [`perf/results/2026-10-25-m4-b.md`](../perf/results/2026-10-25-m4-b.md).

**Surprises:**
- Keeping a grown page meant a "loaded" page could have rows it never read, and every rule that asked "is this page loaded?" had to ask about rows instead: `row` (placeholders past what was read), the flash (a new row compared with the old page's `None` past its end flashed as a change from NULL), prefetch's hold (a grown visible page counted as present, so prefetch raced its re-read), and `Refreshed` (it named the page's rows, placeholders included). The first two showed up while building; the last two only in the code review.
- A shrink from a whole-page count returned before touching any page, because that early return existed for the base's drop. With `live`, the page the shrink ended in needed its row end clamped first, or a re-read in flight landed rows from before the shrink.
- The base had never pinned a shrink, and it keeps whole pages past a shrunk end, drawing them as they were if the rows grow back. It predates `live`, and fixing it would change the base, so it's a follow-up.
- Holding prefetch for a grown visible page made `live` match the base: the base drops the page, so it's missing and holds prefetch anyway.
- The probe's `last_cell` is the last visible row's, so a test of "the old rows still draw" can't read it while the last row is a placeholder: the pending count (exactly the new rows) is the evidence.

## M4: `follow` (part C, 2026-10-25)

**Results:** [`perf/results/2026-10-25-m4-c.md`](../perf/results/2026-10-25-m4-c.md).

**Surprises:**
- The pinned view sits short of the end by the rows not yet read, so "at the end" can't decide a wheel down while following: a nudge down would have let go. Down keeps following on; only a landing (End, a jump, a release) asks whether it reached the end.
- Following decided after a move plans that move's reads the old way, top first. The `follow()` scenario caught it in `follow()` on its first run; End, `jump_to`, and a wheel reaching the end had the same order and no scenario over two visible pages, so only the code review found them. Every move now decides following first, from where it will land.
- The smoke check first read the probe and the tail global whenever the script got to them, some frames after each tail mark, so "no placeholder at the mark" was checked against later, fuller frames. It now records both in the microtask that sets the mark (wrapping `performance.mark`), before another frame can draw.
- A frame can draw between two reads landing, so one growth can bring more than one `TailDrawn` (a page's first read, then its re-read). The event is right to say so; a host takes the first at or past its count, and the native test checks they only rise.
- Firefox and WebKit deliver one scripted wheel in several events. The first lets go of the tail, and the rest go on scrolling, which read at first as the view drifting while not following.


## M4: `follow` (part D, 2026-10-25)

**Results:** [`perf/results/2026-10-25-m4-d.md`](../perf/results/2026-10-25-m4-d.md).

**Surprises:**
- A frame's probe, read at its GPU calls, is the frame before's: GPUI delivers the events emitted in render after the draw and present, in the same task. The first scroll-back readings were a frame off until the frame log read the probe in the presenting task's microtask checkpoint (now `shared-web/perf/`'s `presentedRecorder`).
- A wheel up while following can land below the last frame drawn: a batch can land and the pin move the view down between that frame and the wheel, so "the first frame above where it was" never came. The wheel's frame is the first one no longer following.
- Wrapping the GPU calls cost more than expected: a trial with the wrapper on through the traced window read ~520 ms/s busy at 100k rows a second against ~320 without. It now runs only in the window that reads presented frames.
- At 100k rows a second on a 4× slowed CPU, the drawn frames cost what they do at 10k (~26 ms, ~30 a second); what saturates the main thread is the reads, three times as many, each a page the bare host's source builds on the main thread.
- The `follow` build's throttled wide fling had more late frames than the base's in both orders (median ~8% against ~3.5% over 20 runs each), with the same work per frame and busy time, and nothing in `follow`'s idle path to explain it. Left open.

## M5: `resize` (part A, 2026-10-26)

**Results:** none measured; the research is in the root's [`docs/research/tall-table-features.md`](../../../docs/research/tall-table-features.md), "`resize`".

**Surprises:**
- None of gpui-kit's resizing could be reused as code, not even gpui-base's public `resize_handle`: its drag is GPUI's typed drag, which has no release of its own. `DataTable` reads its release from `on_mouse_up_out`, which misses a release over the band the pointer drags. The table's own drag (built for its scrollbars, its handlers registered every frame) already solved that.
- The pin moved under the inventory: gpui-component 0.8.0 added a double-click fit (`fit_col`) that the 0.7.3 reading never saw. Each feature's research re-reads `DataTable` at the current pin.
- `DataTable`'s width rule (pointer minus the column's left) assumes the scroll never moves under a drag. On a table scrolled to its right end, a narrowing shrinks the content and the scroll clamps, so the columns would slide under the pointer. Anchoring at the press and holding the scroll until the release avoids it.
- Resizing reaches cell text, not just layout: a float's rounding is a function of its width, so a DOM contender at a resized width needs GPUI's glyph advance, which `cells.json` never had to carry while widths were fixed.

## M5: `resize` (part B, 2026-10-26)

**Results:** none measured beyond B1's size check (its numbers in `PLAN.md`); the cost is part D's.

**Surprises:**
- GPUI's test text system gives every character 0.6 em, 8.4 px at the cells' 14 px, which is exactly IBM Plex Sans's digit advance (600 of 1000 units). The native fit and budget tests read the same numbers a browser does.
- Fitting a numeric column to `chars × number_px + 17` can floor a character off its own budget: the product and the division back in f32 don't round-trip. The fit rounds up to a whole pixel.
- A drag that moved out and back would have set a width equal to the kind's and emitted a change nobody could see. Comparing widths to catch it failed in f32 (`width + dx − dx` drifts for a fractional integer column's width, which the code review caught); comparing the pointer's x with the press's works.
- A kind's width is never clamped, but a drag's is, so the first version jumped a 31.5 px integer column to the 40 px min on a *narrowing* move. A column outside its bounds now holds until the pointer brings it in.
- The table's own drag starts at the press, so the double-click's second press needs no "ignored until the next press" flag, as `DataTable`'s typed drag does: it fits and starts nothing.
- The test build with every feature off had carried an unfulfilled `expect(unused_variables)` in the paging fixture since `follow`: lint never compiles the tests without features.


## M5: `resize` (part C, 2026-10-26)

**Results:** none measured; trial runs only checked the scripts work (the cost is part D's).

**Surprises:**
- The smoke check's first narrowing at the right end passed with the held scroll broken (`held_content` returning the content as is): a drag's own moves never clamp the sideways scroll, so nothing moved it. It fails now that a vertical wheel arrives mid-drag, the input that clamps, as the native test does.
- That wheel first scrolled nothing: the pointer sat on the band, in the header, and the table's wheel is the body's. During a drag the width follows the pointer's x alone, so the script moves straight down into the body before it wheels.
- A drag paced at a move a frame read 0.9 ms of work per frame (p50) in the throttled wide trial, against `workRecorder`'s 19.2: half the traced frames had no move in them, because each move's delivery waited on a ~19 ms frame. The sideways fling never showed this because it sends a wheel every 8 ms; the drag does now too.

## M5: `resize` (part D, 2026-10-26)

**Results:** [`perf/results/2026-10-26-m5-d.md`](../perf/results/2026-10-26-m5-d.md).

**Surprises:**
- The drag is cheaper than the sideways fling it was feared to rival (5.5 ms a frame against 6.6, wide, reference): re-laying out 500 columns a move is less work than shaping a new set of columns' text.
- The bands aren't free when nobody drags: two styled divs per visible column, each with a hitbox, cost 0.05–0.15 ms a frame, small but past the spread in either order of the builds. "Compiled in, unused" wasn't the case to measure: the host's columns are resizable, so the bands draw.
- Pacing the drag every 8 ms (part C) wasn't the end of empty traced frames: throttled, a wide drag frame is ~18 ms, just over a frame, so Chromium draws every other one, and in 4 of 10 runs the trace's p50 landed on an idle frame (~1 ms). Part C's one trial happened to land in the other mode. `workRecorder` reads it steadily.
- The wide throttled fling's extra late frames, M4's open question for `follow`, showed up in `resize`'s build too (5.1% against the base's 2.0%), the same split of runs between a ~15 ms and a ~30 ms p95. All a fling does with `resize` is draw the bands (~0.1 ms a frame), so it's likely not either feature's code.
- brotli moved ~1 KiB between builds the same size after wasm-opt (part B read `resize` at +3.4 KiB brotli, this part +2.8): the after-wasm-opt figure is the one to compare across runs.

## M6: `select` (part A, 2026-10-26)

**Results:** none measured; the research is in the root's [`docs/research/tall-table-features.md`](../../../docs/research/tall-table-features.md), "`select`".

**Surprises:**
- `DataTable` selects one row, one column, or one cell, never a range: no Shift-extend, no drag, no select-all. The ranges in the feature's row were the table's own need (the wide sheet copies a block), not something to carry over.
- GPUI carries AccessKit roles (`DataTable` sets `aria_selected` on its rows), but gpui-pre-web has no AccessKit adapter, so on the web none of it reaches a screen reader.
- The code review found the first spec's anchor and head named only a row for `Rows` and a column for `Columns`, which left an arrow across a range's direction undefined; a cell in every kind settles every case.

## M6: `select` (part B, 2026-10-26)

**Results:** none measured; the cost is part D's. B1's `size --against` waits on the code review.

**Surprises:**
- The keys' context can't sit on a child of the element: GPUI walks contexts from the focused element up, and the element is what tracks focus. It's the element's own context, the base's and the selection's together, and which binding wins at that depth is the order `init` binds them in.
- A drag that moved the whole head would have emitted `Selected` at every column a `Rows` drag crossed, and a header drag into the body would have moved a `Columns` range's row; the spec's "a `Rows` drag across a row: none" needed the head to move only along what the press picked and the range spans, which Shift+press then shares.
