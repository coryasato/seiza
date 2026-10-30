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

## M6: `select` (part C, 2026-10-26)

**Results:** none measured; trial runs only checked the scripts work (the cost is part D's).

**Surprises:**
- Home in `perf`'s first trial did nothing with the select-all standing: Home moves the active cell to the first row, the select-all's active cell was on it already, and a key that lands where it started does nothing (the spec's "at an end"), so the view stayed at the fling's end. A reader scrolled away from the active cell meets the same: Home doesn't bring the view back while the cell is on row 0.
- A drag-select paced as the resize drag (a move every 8 ms) still left most traced frames idle: a selection changes only when the head crosses into another cell, and a diagonal of 62 moves each way stayed in one for two or three moves at a time. The resize drag never showed this, since every pixel of it moves an edge.
- Firefox's screenshot read the tint after Escape in every run, with the probe already reporting no selection: it shows the frame before the one the probe reports, about 100 ms behind. A shorter sequence in a script of its own (a press, a header, Cmd+A, a 300 ms wait, Escape) never showed it; only the smoke check's full one did. Polling the pixel up to 1 s settles it, and a redraw that never came still fails.

## M6: `select` (part D, 2026-10-26)

**Results:** [`perf/results/2026-10-26-m6-d.md`](../perf/results/2026-10-26-m6-d.md).

**Surprises:**
- A select-all standing under the scroll read up to 1.5% *faster* than the base, in both orders, inside the spread: a range costs a tint and a test per visible row and column, less than `resize`'s bands, which draw per column and showed +1–2%. Nothing to chase, but a feature's "cost" can read below zero at this resolution.
- The wide throttled drag-select's trace p50 split 6/4 between ~19 ms and ~0.9 ms, as the resize drag's did: pacing a row a move fixed the idle moves (part C), not the drawing rate, which drops to every other frame once a frame costs just over 16.7 ms. `workRecorder` stays the number for a throttled drag.

## M7: `copy` (part A, 2026-10-26)

**Results:** [`perf/results/2026-10-26-m7-a-spike.md`](../perf/results/2026-10-26-m7-a-spike.md); the research is in the root's [`docs/research/tall-table-features.md`](../../../docs/research/tall-table-features.md), "`copy`".

**Surprises:**
- The feature's row said "through the browser's clipboard event", which can't work: GPUI `preventDefault`s a key it handles, so no `copy` event follows, and the event's data must be set before its handler returns, before any read could land.
- A clipboard write is the reader's for only ~5 s after the key, in every engine, and GPUI's write drops the refusal. A `ClipboardItem` holding a promise has no such limit, which moves the write out of the table and into the host.
- Headless Chromium refuses every async clipboard write until the context is granted `clipboard-write`, which a real Chrome gives a focused page silently. Tycho's Input copy (Cmd+C through `writeText`) can't be checked headless without it.
- WebKit refuses a clipboard write from 100 MiB, where Chromium and Firefox took 256 MiB: the cap is the browsers', not the table's memory.
- The code review found the spec's copy limit had no floor (a `max_in_flight` of 1 would never read; `live`'s re-reads have one) and that `close` takes `&mut App`, so it can't emit the cancel the spec gave it: a spec that names an existing setter's behavior has to be read against its signature.
- A second review, after the spec grew a key limit and size bounds in discussion, found the bounds weren't bounds: a column's kind is a display hint, and the value is the source's text (a 128-bit integer, DuckDB's BC dates). A size promised before reading has to come from what the values can't be shorter than, never from what they're expected to be.

## M7: `copy` (part B, 2026-10-27)

**Results:** none measured beyond B1's and B3's `size` run (`PLAN.md`); the cost is part D's.

**Surprises:**
- Found writing it, not by a test: a copy waiting on a page could stall: a page it skipped because the cache had it, evicted, then loaded again by the cache for the reader, landed in the cache's slot and woke nothing. Every plan now checks the copy's turn page, which a cache landing always runs.
- The first-page projection, written after a turn, read more than the first page: a turn crosses pages (16 k cells is 4,096 rows of the narrow shape's few columns), so it's taken inside the turn at the first page's end.
- With two places, a page landing out of order starts nothing until the one before it lands: it keeps its place in the copy's window. The window bounds what the copy holds, at the cost of a source that answers out of order waiting on its slowest read.
- The code review found a copy's places leaking: the cache counted a copy's reads apart from their requests, and a copy that finished on a page the cache had loaded meanwhile never gave its own read's place back. Three such copies at `max_in_flight` 3 would stop every read. The cache now holds them by request, and every answer frees one, so no end path has to remember to.
- The sweep for races that followed found the copy and prefetch reading one page at once (each blind to the other's read), and one stall in `live`'s own planning: a visible grown page whose re-read failed held prefetch back for good, so it held a copy back too.
- A second review found more of the same kind: a copy's end that freed a place without planning it (at `max_in_flight` 1 a page scrolled into view stayed a placeholder), a drag at rest that the cache read through and the copy didn't, a read the copy waited for that the same plan cancelled. And a cap checked only after a turn: cells bound a turn's work, not its bytes. Each was a timing between the copy and the paging that a scenario has to think of; the hardening session (`PLAN.md`) is for those no one thinks of.
- An eviction can't be staged through the budget in a native test: the copy's turns run in the same park as the reads that would evict, and finish from the cache first. A test-only `evict_page` stands in for the budget.

## M7: `copy` (part C, 2026-10-27)

**Results:** [`perf/results/2026-10-27-m7-c.md`](../perf/results/2026-10-27-m7-c.md).

**Surprises:**
- The spike's open question settled the easy way: a `ClipboardItem` resolved 60 s after the key, or with another tab in front, landed in all three engines, so the "press Cmd+C again" fallback isn't needed.
- The insecure-context check caught a read the spec said wouldn't happen: the copy's first turn planned its reads inside the key's update, before the host heard `Started` and cancelled. Deferring the plan to the update's end fixed it. A native test only catches this with a subscriber that cancels, which no part B test had.
- The bare host loads fine over `http` at a LAN address. Its wasm needs no `SharedArrayBuffer`, so losing COOP/COEP costs nothing, and the insecure context is a real one rather than a shim. Chromium refuses even to grant clipboard permissions there.
- A scripted paste into a textarea takes GPUI's focus, and focusing the canvas doesn't give it back: keys go to another element of gpui-pre-web's. Copies after a press still worked, which hid it until the first copy started from the select hook.
- With reads held, a copy started at the filled mark loses a round to prefetch, whose reads only go out once the visible page lands. Correct paging, but a timed check has to wait it out.
- A scroll during a copy costs late frames, not per-frame work: the copy's turns run as tasks between frames (~0.8 s of them in a 2 s scroll), and throttled, 53% of frames were late against 42% alone. The first trial's window waited for the copy's end and read the copy's tail as the scroll's (a "doubled" rest time, and a 0.6 ms p50 from idle frames). The code review caught it; a window has to end where the act it measures ends.

## M7: `copy` (part D, 2026-10-27)

**Results:** [`perf/results/2026-10-27-m7-d.md`](../perf/results/2026-10-27-m7-d.md).

**Surprises:**
- Part C added more bytes than part B: the bridge's writer and the host's hooks took the `copy` build from +4.5 to +8.8 KiB brotli over `select` (+12.9 to +33.3 after wasm-opt). The table's copy is the smaller half of the feature's cost; a host that writes the clipboard its own way pays less.
- The scripts read a build's features as `just tall-table build` was given them, not as Cargo resolved them: the `copy` build turns on `select` but ran `perf`'s base segments, with no select-all standing. That's the comparison D1 asked for (built, nothing copied), but a build that turns another feature on doesn't run that feature's segments.
- The wide heap's growth came out at the reads in flight almost exactly (7.0 MiB against 7.8 for two 500-column pages), and the narrow shape's not at all: wasm memory grown once stays, so a copy's heap cost shows only where its pages are larger than anything the view had held.
- Throttled, a scroll during a copy lost more frames in the narrow shape (27 → 43% late) than in the wide (54 → 55%): the wide scroll alone already misses most frames, probably leaving the copy's turns little more to take.
- The manual check couldn't select a range past the loaded pages by hand: a Shift+press far away has to get there first, and scrolling there reads the pages between. It took `?perf`'s `__tallTableSelect` in the console. The bare host's Cmd+Shift+C (the host's copy) showed no refusal in the manual check either; raising the key's limit (`?copy-key-cells=`) refused a plain Cmd+C at the cap instead.

## Hardening (part A, 2026-10-28)

**Results:** none measured (a spike's timings are in the root's `docs/research/tall-table-features.md`, "Hardening").

**Surprises:**
- GPUI's `#[property_test]` is exported at the pin and doesn't compile: it passes `proptest_path`, which the locked `proptest-macro` 0.5.0 doesn't know, and the panic ("expected `;`") reads like a mistake in the test, not the macro. Proptest's own attribute fails the same way. What the macro does is a few lines by hand on what gpui-kit exports.
- Proptest can't shrink a fixed-length `vec`: a forced failure at step 23 of 200 came back with all 200, and the default shrink stopped at 32 iterations.
- Drawing isn't a step's cost: drawing only on a frame step saved ~20% of ~10 ms. The table's own work in a debug build is.
- Reading the cache for the test's invariants found a gap in the contract before any test ran: `finished` drops every draining entry equal to an answer's request, where `copy_answered` frees one and its comment names a source whose ids repeat (a page's first row). Two cancelled reads under one id would free two places with one answer. The trait never says whether ids may repeat while their reads are open, and no source the repo has repeats them.
- The code review found the spec's invariants checked a rule at the wrong moment: places after `close` (a closed table never frees them), a page read twice judged by where the view is now rather than when the read went out, the budget between landings (the cache evicts only at one). An invariant read off the cache's state has to hold whenever it's checked, and the table's own rules hold at events. It also found `seed_strategy()` gives every case one task order once `SEED` is set, so a soak by `SEED` would have tried four.

## Hardening (part B, 2026-10-28)

**Results:** [`perf/results/2026-10-28-hardening-b.md`](../perf/results/2026-10-28-hardening-b.md).

**Surprises:**
- The test found the shrink on its first run and shrank it to six steps in ~20 s. Its second run found a bug nobody had named (a closed table cancelling a read again on `set_rows`), and a later seed one of `copy`'s review family by a route the reviews hadn't taken (a prefetch re-read beside a copy's read, where a prefetch first read skips the page).
- Seven of the nine controls passed every case at first, with the invariants right: the cases never reached the states the faults live in. Counting what each case did showed why. `close` came every few dozen steps and took the rest of its case; reads answered when sent kept most cases at one read open; copies had reads out in ~4% of steps; a full last page (what a shrink within it keeps) came up only when a row count happened to be a multiple of `page_rows`; and "small" tables of four pages were up to 256 rows, their end out of view.
- The drain hid what it was there to find. Moving the clock past the settles fired the scroll's settle timer, which planned the read the end-without-a-plan control had skipped. Checking for a stall whenever no read is open caught it at once.
- A control is caught by what it causes, which isn't always what it names: a failed read that kept its place in the copy was found when `close` cancelled that answered read (invariant 1), and an end without a plan by the next copy left waiting (6) as often as by the rows (8).
- A step cost ~2.5 ms, not the spike's 8 (it drew every step), and ~0.07 s a case in the soak's release build, so the budget the research counted in steps had room for three times the cases, and a soak is minutes, not a run to plan around. The first soak found a fourth bug the 48 cases hadn't: cheap cases are worth running by the thousand.
- The code review found the invariants judged a read when the step's checks ran, not when it went out: a read answered when sent was already delivered then, so a duplicate or one past the limit, sent with reads answered at once, passed. The source now records what was open at each send. And the first exclusion for the grown-page findings was wide enough to excuse copy and prefetch on one page in most seeds once growths came more often: an exclusion needs the finding's shape, not its neighbourhood.
- Changing what a step means re-means every recorded case: making a third of `Grow`s fill the last page turned the shrink's six recorded steps into another symptom of the same bug (a shrink to a page's start, its page never read again). A scenario test is written from the bug, not copied from the shrunk steps.

## Hardening (part C, 2026-10-28)

**Results:** [`perf/results/2026-10-28-hardening-c.md`](../perf/results/2026-10-28-hardening-c.md).

**Surprises:**
- The four bugs took three small changes: the shrink one rule in `PageCache::set_rows` (every page past the end, not the old last one), a closed table one flag checked twice, and both grown-page bugs one rule (a copy waits for any read the cache has out of a page, and the cache's prefetch re-read gives way to the copy's read as its first read did). Part B's third and fourth findings were one gap, as their one exclusion said: the copy had been told to wait only for a read that held its rows.
- Generating the shrink step again cost a control its catches: copy and prefetch on one page fell from 5 of 7 `SEED`s to 3, at a step weight of 8 in 427. A shrink cuts the copy the control needs, so a step that finds one bug starves another's fault of its state. Halving the weight brought it back; a new step's weight is checked against every control, not only the bug it was added for. A second mix without the shrink, for half the cases, didn't help: it moved which `SEED`s missed (65 of 70 caught against 68), so at 48 cases a control's catch rate across seven seeds is partly the draw, and a few points either way is noise.
- The shrink's old rule, run as a control, was caught at "nothing stalls" before "rows of their era" in the first case that hit it: with `live`, a page shrunk to its start kept and never read again shows first as a placeholder that no read will fill. A control names the fault; the invariant is whichever symptom a case reaches first.
- The closed table's first fix was half a fix: it stopped `set_rows`' second cancel but still let the cache forget the pages `close` had cancelled, counting their reads draining twice, for good. The random test couldn't see it (after `close` it checks only that nothing is read); the code review did. A guard on a closed object belongs before the bookkeeping, not just before the call out.
- The fixes cost the base nothing after wasm-opt and Tycho 1 KiB, but `just tycho check` failed TTFP by 3% under a browser's load; only an interleaved A/B against the parent's build could say it was the load (196 against 198 ms). And `just` runs a module's recipe from its directory: the A/B's relative `--ab` path served a 404 until it was absolute.

## M8: `sort` (part A, 2026-10-29)

**Results:** [`perf/results/2026-10-29-m8-a-spike.md`](../perf/results/2026-10-29-m8-a-spike.md); the research is in the root's [`docs/research/tall-table-features.md`](../../../docs/research/tall-table-features.md), "`sort`".

**Surprises:**
- A sorted page's cost isn't the sort, it's the scatter. An index of 1.57 M row numbers built in ~0.15 s natively, but each page's 1,024 rows lie in every row group, so joined to a Parquet file a page reads the whole file: tolerable from a warm disk, the whole file a page over HTTP. Only rows already in DuckDB's memory (Tycho's CSV) page cheaply by index; a remote file needs a sorted copy, and Gaia's doesn't fit. Sorting turned out to be a question of where the rows live, which is why the source must be able to refuse.
- `DataTable`'s header click doesn't sort either: its sort is an icon button of its own, the header being the column's selection and drag. The conflict between `select`'s header press and a click to sort was already settled upstream, the same way.
- The race a sort seemed to bring, an old order's read landing after the swap and stored as the new order's page, was already closed: the cache stores an answer only for the read its slot is waiting on, so forgetting every page is enough. What a sort does to the paging is a `set_rows` to nothing and back, plus the view and the selection.
- `ORDER BY … LIMIT … OFFSET` pages are only correct with a tie-break: without one, two reads of neighbouring pages may split a run of equal values differently, repeating or skipping rows. The contract names the tie-break (the source's own order, both ways), so descending isn't ascending reversed.
- The bundled face has `↑`, `↓`, and `↕` but not `▲` or `▼`, so the arrows could be text: no icon assets for a host to bring, which gpui-kit's sort icons would have needed.
- The code review found what a default can cost. Columns sortable unless a host said not, as they're resizable, would have drawn an arrow on every header of a delegate that can't sort (each click refused) and widened every long-named column, which moves the cells and pointer positions the fixtures pinned without the feature. A resize needs nothing of the source; a sort needs the source's consent, so `DataTable`'s opt-in is the right default here. It also found that a `Sort` naming its column by index can't survive `set_columns` unless something says the column is the same one (its name), and that a kept `Columns` selection still carried rows of the old order.

## M8: `sort` (part B, 2026-10-29)

**Results:** [`perf/results/2026-10-29-m8-b.md`](../perf/results/2026-10-29-m8-b.md) (the tests, the soak, and the sizes; the feature's frame work is parts C and D's).

**Surprises:**
- The swap needed no new bookkeeping in the cache. `forget_all` is the shrink's `forget` over every page, and the race part A feared was already closed by `loaded` ignoring an answer its slot isn't waiting on: the paging fixture's sort scenario and the random test's era bump (every row of the old order a gone era) show it, and two controls (a sort that keeps the pages, one that keeps the reads in their slots) are caught at "rows drawn of their era".
- Adding a step re-dealt every control's cases. With the `sort` step at weight 8, `copy`'s holding-without-end control passed all 48 cases; at 3, two other controls did; at 4, all eighteen were caught. The hardening's lesson again: a new step's weight is checked against every control, and at 48 cases which ones a weight starves is partly the draw.
- The spec's debug assertions on the table's own refusals (a column not sortable, an icon that doesn't load) would fire in the very tests that check those paths, and in the random test's refused sorts under the soak's debug assertions. They're compiled out of the test builds; the paths are tested by their results instead.
- My first paging scenario was wrong, not the table: after a sort's three cancelled reads, the top page's landing had two places free, not one, since only one read was still draining. A scenario's `why` is worth writing before its `expect`, as the arithmetic.
- A source's in-memory order over text can't hold 1.57 M strings for a sort (~80 MB, in a wasm heap that never shrinks). The bare host sorts text by an 8-byte prefix key, reading a value again only for a tie there; its names are unique within their first 8 bytes, so none is read twice.
- The code review found the arrow's room never reached the header: the extra right padding was set before the cell's `px_2`, which sets both sides, so a long name ran under the arrow. The narrow-column test checked the room the table computed, not the style the cell ended with. The test now reads the built cell's padding (`header_padding`), and it read 0.5 rem where the test expected 8 px: what a test compares with should come from the same place as what's drawn.
- The review also found a host bug that only the all-on build has: the `live` feed bumps the row at a table index, which under a sort is a position in the order, so a re-read changed nothing and an unrelated cached row went stale. Two features that each pass alone can disagree about what a row index means.
- The base grew 0.6 KiB after wasm-opt with the feature off, from one refactor on the base's path: `Glyphs::read` shared a closure over a `&mut dyn Iterator` between the number advance and the arrows, and the dynamic dispatch cost the base what the inlined iterator didn't. Reading the arrows in a `cfg`'d copy of the old expression put the base back within 54 bytes of M8's parent. A refactor that "only" shares code on the base's path is a base change; a small script building just the base at `size.ts`'s fixed worktree path found it in two builds, not a full size run.

## M8: `sort` (part C, 2026-10-29)

**Results:** none of its own: the scripts were run once each to try them; their medians on the final build are part D's.

**Surprises:**
- An arrow stayed hovered after its cycle in every browser, while the native test of the same states passed. The table was fine: the smoke check moved the pointer "away" to (1, 1), where gpui-pre-web's key textarea sits over the canvas, so GPUI never heard the move. The native test moves into the body. An `elementFromPoint` found it in one probe script; a pointer parked off a canvas is a spot to check, not to assume.
- The first order check passed with every NULL treated as a value. The exact-value hook answers `None` as `undefined`, not `null` (wasm-bindgen), so the NULL tests never matched, and a NaN comparison is never out of order. The note it printed (`undefined…undefined`) gave it away, not a failure. And the code review found the fixed check still couldn't fail for a NULLs-first source (its NULLs at the top read as ties, its values at the end in order): "NULLs last" needed its own assertions, a value at the top and a NULL at the end, as did "back at off", which compared the source's rows with themselves until it compared the top with what it held before any sort. Each claim a check prints needs a case that would make it fail.
- A sort made with three reads out waited 45 ms of a 200 ms read, not a read: by the time the script's three wheels had each drawn, the oldest read was most of the way back. What a sort pays for reads out is what's left of the oldest, which the README's limit should say.

## M8: `sort` (part D, 2026-10-29)

**Results:** [`perf/results/2026-10-29-m8-d.md`](../perf/results/2026-10-29-m8-d.md) (the bytes, frame work built and sorted, a click's latency, and the close).

**Surprises:**
- The feature's frame cost came from what's drawn while nothing is sorted. Part A's research had no frame-work risk to spike, since a sort is one cache clear and a jump's reads; the cost the check found (+0.15–0.24 ms at the reference run, outside the base's spread, the same to 0.02 ms on a re-run) is the arrows, a dozen glyphs drawn every frame. A build with the host's columns not sortable read within 0.04–0.09 ms of the base on the scroll: one line changed, built, measured, reverted, and the cost had an owner.
- The sorted segments read *faster* than the unsorted ones in the same build (wide scroll 6.92 against 7.23 ms), below the base in the flings. Sorting can't make a frame cheaper; those segments run second in each session. A segment's place in the session is a variable of its own, so a feature's segments are compared with the base's at the same place, never with the ones run after them.
- The bare host's raw wasm has no name section, so `twiggy diff` can't split the `sort` build's 83 KiB between the table and the host's own sort: part B's note expected part D to measure the table's share, and the bytes can't say it. The frame cost could be split by building the host without the thing to measure; the bytes would need a build with names.
- A click's own work is under a millisecond at the reference run; what a reader waits for is the next frame, then the source. With three reads out, the top page waited 25–45 ms of a 200 ms read: part C's lesson held at the median of 10, so the README's limit says "what's left of the oldest", not "a read".
