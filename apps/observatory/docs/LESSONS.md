# Lessons learned

One entry per milestone, written before starting the next one: what surprised us, and what it taught us. The milestone's numbers are in its results note (linked from each entry), and the decisions it made are in [`DECISIONS.md`](DECISIONS.md).

<!-- Template:
## M<n>: <title> (YYYY-MM-DD)

**Results:** [`perf/results/<date>-m<n>.md`](../perf/results/<date>-m<n>.md)

**Surprises:**
- What didn't go as expected, and what it taught us. Numbers only where the surprise needs them; the rest are in the results note.
-->

## M0: Groundwork: the app, its data file, and static hosting (2026-10-14)

**Results:** [`perf/results/2026-10-14-m0.md`](../perf/results/2026-10-14-m0.md)

**Surprises:**
- Workers static assets never answer a `Range` and never come from the edge cache, whatever `_headers` says. The plan's one stated assumption failed on the first production request; the documentation is silent on ranges either way, so only a deploy could tell. The fallback (a Worker in front, serving ranges from the edge cache) kept the file a static asset and read the first page faster than Tycho's R2 path, warm. Its cost is the first read at each location: 2.27 s, n = 1, worth measuring properly before the page ships.
- Local `wrangler dev` was worse than useless for this: no ranges either, and it gzips the Parquet, which production doesn't. Check range behavior only in production.
- A DNS lookup before the domain existed cached an NXDOMAIN on the local resolver for the zone's negative TTL (30 min), so the first checks failed with ENOTFOUND while the record was live. The scripts take `--resolve-via`.
- The code review of part A's first draft found one location spelled three ways (a path with the base for the bridge and the plugin, a directory for the script) that could disagree silently and turn the extension 404 off; one bare directory name for all three removed the class of bug.


## M1: Spikes: the DOM scroll model and the input-latency method (2026-10-15)

**Results:** [`perf/results/2026-10-15-m1-a.md`](../perf/results/2026-10-15-m1-a.md) (the scroll model), [`perf/results/2026-10-15-m1-b.md`](../perf/results/2026-10-15-m1-b.md) (the input-latency method)

**Surprises:**
- Firefox doesn't clamp a too-tall element as Chromium and WebKit do: past 17,895,696 px it lays it out at 0 px, and the table silently has no height. The spacer had to fit the smallest browser's limit, not the largest.
- Assigning `scrollTop` mid-animation loses input (Page Downs in Firefox, fling distance in WebKit); `scrollBy` doesn't. Two ways of writing the same position aren't the same to a browser that's animating.
- The cheapest-looking result was a bug. The window variant first measured twice as cheap in a fling because TanStack skipped renders when its index range didn't change, so the rows were stale; only a per-frame probe of the top row, and a negative control, showed it. Every frame-work comparison since carries a correctness probe.
- A scrollbar drag sends no `pointermove` in Chromium and WebKit, and headless Firefox has no scrollbar with width at all, so the drag settle had to come from the size of the step, and Firefox's bar could only be checked headed.
- Chromium's trace reports a wheel whose default GPUI prevents (`MOUSE_WHEEL`), so one method covers every input on both sides; Event Timing, the obvious API, rounds to 8 ms, drops anything under 16 ms, and never reports a wheel.
- A main-thread probe is the wrong witness for a native scroll. The compositor shows the move one to two frames before the main thread hears of it, and on a session's first track press a frame late even for a press: exactly the cold run the protocol measures. Only the compositor's own frame (`Scroll Delta This Frame`) agreed with `EventLatency` every time.
- Test hooks interfere with each other. A one-shot GPU-backend check restored the methods it had captured, stripping `workRecorder`'s wrapper, and a run recorded zero frames without failing; the latency probe's wrapper, left in a timing run, cost 0.03 ms a frame. Hooks now install in a fixed order, timing runs carry only the recorder, and an empty recording fails.
- Tycho's per-frame work has been the rAF callback only, ~0.4 ms under the frame's whole update, and ~8% of the main thread's work runs in no frame at all on either side. A per-frame number alone undercounts a UI's CPU cost.

## M2: The GPUI contender and the fixtures (2026-10-17)

**Results:** [`perf/results/2026-10-16-m2-b.md`](../perf/results/2026-10-16-m2-b.md) (the bare page), [`perf/results/2026-10-17-m2-c.md`](../perf/results/2026-10-17-m2-c.md) (the fixtures); the shared changes on Tycho: its [`2026-10-16-observatory-m2-a.md`](../../tycho/perf/results/2026-10-16-observatory-m2-a.md)

**Surprises:**
- "Byte-identical for Tycho" was the wrong bar for moving the title bar out of `seiza`: no change to `seiza`'s features left Tycho's bytes alone, so the bar moved to Tycho and the check became "looks and behaves the same, size recorded".
- Cargo ignores a member's `default-features = false` while the workspace entry keeps defaults on: turning `seiza`'s panel off for the contender meant turning defaults off for everyone and having Tycho name `panel`.
- A replay hook that waits for `contender:filled` hangs when the view lands already filled (rows in the cache): the mark is a change to filled, not a state. Hooks wait on a frame count instead.
- The data file never fills a float column: its longest double is 8 characters against a budget of 12, so on the comparison's own data cell parity is the exact text (`8.0` against JS's `8`), not rounding. The rounding a DOM contender still has to port is pinned with synthetic values, and without them the budget controls couldn't fail.
- The paging fixture had to drive the state, not the pure page cache: the settle times the observatory added live in the state's timers. GPUI's test app and clock made that cheap (only `advance_clock` moves time), and every hand-worked expectation matched on the first run, which is why each control's failures were listed before trusting it.
- Splitting one function out of the render loop for a test cost Tycho 219 B until it was inlined back; making the summary queries testable as sent cost 423 B. Test seams aren't free in a size-budgeted wasm, so each was measured.
- The code review found the cell fixture's generator choosing "longest" values by DuckDB's text for a double, not the table's, and able to drop the hand-written cases on a bad parse. A generator is checked code too.

## M3: The TanStack contender (2026-10-18)

**Results:** [`perf/results/2026-10-17-m3-a.md`](../perf/results/2026-10-17-m3-a.md) (the data layer), [`perf/results/2026-10-17-m3-b.md`](../perf/results/2026-10-17-m3-b.md) (the view), [`perf/results/2026-10-18-m3-c.md`](../perf/results/2026-10-18-m3-c.md) (parity), [`perf/results/2026-10-18-m3-d.md`](../perf/results/2026-10-18-m3-d.md) (the contract and the first screen)

**Surprises:**
- The cell fixture passed and still didn't pin Rust's rounding. Rust rounds a tie to even where `toFixed` rounds up, and of two equally short texts its `{:?}` takes the upper. The data file never hits either case. A fixture drawn from real data covers only what that data exercises. The port found both cases, and they're now hand-written `rounding` cases.
- "After first paint" isn't a frame callback: work started from `requestAnimationFrame` went out before Chromium's `first-paint`. And a `display: none` frame reports itself visible but never paints, so waiting for a paint can wait forever.
- The browser's scrollbar can't be told what to do. No browser lets the page cancel a track press's paging, so parity with the table meant moving the scroller first, in the press's own `pointerdown`. What happens after that differs by browser (WebKit pages twice), and the DOM side keeps those differences rather than drawing its own scrollbar.
- With a prerendered page, first usable can come before first pixels. Hydration committed before the HTML's paint in about half the runs, so the engine's start waits for both.
- Element Timing reports an element once, at its first paint, and buffers only 150 entries. Cells that went from placeholder to real in place were invisible to it, so the cells are now keyed by state, measured or not. The reader observes from the page's start.
- Measurement hooks have to cost the same work as the unmeasured page. The first probe key re-rendered the whole table on every key, but only with `?measure`, which would have inflated exactly the key latencies M4 measures. Two code reviews caught that and eight other bugs in this milestone's last part. The pattern held from M2: review before closing.
- Plain TanStack in Firefox doesn't sit stuck at the top; it crawls. Its spacer lays out at 0 px, but the drawn rows still overflow the scroller, so each End reaches the edge of the rows last drawn.

## M4: The numbers (2026-10-18)

**Results:** [`perf/results/2026-10-18-m4-a.md`](../perf/results/2026-10-18-m4-a.md) (the module and the scripts), [`perf/results/2026-10-18-m4-b.md`](../perf/results/2026-10-18-m4-b.md) (the runs)

**Surprises:**
- Neither side wins outright, and "cheaper" and "keeps up" split apart under throttling. TanStack spent less main-thread CPU over a throttled session, yet many of its main-thread fling frames ran late. Its median frame does almost nothing (the compositor scrolls), but the frames where rows re-render run long. GPUI does the same work every frame and misses almost none. A per-use comparison needs both the total and the tail.
- A late frame doesn't mean the same thing on both sides. On GPUI the main thread's frame is the presented frame; on the DOM the compositor keeps scrolling through a late one, and only the rows' update is late. The fling's late frames and lag are main-thread readings on both sides (part A's choice, since Chromium's frame reporter can't see GPUI's canvas). The docs had first said "late frames" as if the screen stuttered; the review caught it.
- The DOM side's wheel reaches the screen twice as fast and its rows go real later. The compositor's scroll is the fastest response either side gives, and one number per input would have hidden that it shows placeholders. "→ rows real" earned its place.
- First pixels, expected to be TanStack's, weren't: the GPUI side's HTML placeholder paints first under throttling. Both are HTML, so the gap is in what each first screen waits for, not in canvas against DOM.
- Part A's smoke runs looked a lot like the final numbers, but they would have been read as results: on the same date, the report's newest-file rule would have tied them with the real runs. Smoke files are now excluded by name.
- The scripts date their files in UTC, so one evening's runs landed on two dates. The report picks the newest file per glob, and that worked here, but a same-label rerun across midnight UTC would leave two "newest" candidates on different dates.

## M5: The observatory page (2026-10-21)

**Results:** [`perf/results/2026-10-19-m5-a.md`](../perf/results/2026-10-19-m5-a.md) (the page and its budgets), [`2026-10-19-m5-a1-phone.md`](../perf/results/2026-10-19-m5-a1-phone.md) (a phone), [`2026-10-19-m5-a2.md`](../perf/results/2026-10-19-m5-a2.md) (the dashboard), [`2026-10-19-m5-b.md`](../perf/results/2026-10-19-m5-b.md) (the live readouts), [`2026-10-20-m5-d1.md`](../perf/results/2026-10-20-m5-d1.md) (memory at equal work, bytes by part), [`2026-10-20-m5-d2.md`](../perf/results/2026-10-20-m5-d2.md) (the window and the panel), [`2026-10-20-m5-d3.md`](../perf/results/2026-10-20-m5-d3.md) (the meter), [`2026-10-21-m5-d4.md`](../perf/results/2026-10-21-m5-d4.md) (the readout's cost)

**Surprises:**
- Prerendering the numbers, meant to keep them from shifting the page, cost first paint more than the budget allowed (62.8 → 81.8 ms median). A reserved box with the numbers rendered after first paint got both. "Nothing shifts" and "nothing delays first paint" are met by layout, not by putting more in the HTML.
- DevTools' phone emulation drew GPUI zoomed 3×. Chromium misreports the device-pixel box under emulation and gpui-pre-web trusts it, so the shim the protocol already uses at DPR 2 was needed at DPR 3 too. A real phone found the other caveat: gpui's touch recognizer locks a pan to one axis.
- "Equal work" took a walk, not jumps. Scattered jumps read the same pages on both sides but not on both devices (−2.4% slow), because the prefetch leans ahead differently at different speeds.
- Bundling bit twice. A lazy chunk sharing a module with another got that module hoisted into the entry (+2.2 KiB of first-paint JS). And `Date.now()` drifts from `timeOrigin` + `performance.now()`, by a sleep's length after one, which would have put every frame outside the meter's window.
- The throttled network doesn't reach a same-process frame's worker. The frame's own wasm was throttled, but DuckDB's reads from its worker ran at full speed (1–91 ms against 172–1226). Until it was found, the page looked faster than the bare contender when throttled, for no reason of its own. A comparison of a page with its frame needs its network shaped outside the browser.
- A readout can make the compositor drop fewer frames. With the meter open, TanStack dropped fewer frames than with it hidden, and the bare page (a bigger table) more than either. A two-sided "within the noise" gate failed the open meter for doing better, and its fallback would have removed the meter. A cost gate is one-sided. The pill, the "cheaper" readout, was the one that dropped more frames.
- The trace books the whole frame tree's paint on the top frame, so the page's "own" time first read 27.6 ms a refresh; its timers, style, and layout are 0.3–0.4 ms on the reference device.

## M6: The deploy (2026-10-21)

**Results:** [`perf/results/2026-10-21-m6.md`](../perf/results/2026-10-21-m6.md)

**Surprises:**
- `wrangler dev` can't show what encoding production serves. Its proxy answered every precompressed brotli response as gzip, so the one check M6 was about, quality-11 bytes on the wire, could only pass in production.
- A test can depend on how fast its server is. "A theme change while the frame loads" holds the frame's HTML and waits on the page's `load` event. Locally the page loaded before it created the frame; over a real network the frame came first, so `load` waited on the frame the test was holding.
- Throttled, production came within 1.4% of local (GPUI 3550.5 against 3502.5 ms). At the reference speed it took about twice as long, from the network's round trips alone. So the throttle hides hosting differences, and only the reference run shows them.
- Without R2, the two DuckDB bundles over the asset limit still fit as compressed copies (5.1 and 5.7 MiB as brotli). The 25 MiB limit is on the stored file, not on what the browser decodes.

## M7: `trim-paths`, no home paths in the shipped wasm (2026-11-01)

**Results:** [`perf/results/2026-11-01-m7.md`](../perf/results/2026-11-01-m7.md)

**Surprises:**
- The paths cost almost nothing on the wire. Taking 979 of them out removed 40.9 KiB after wasm-opt but only 0.8 KiB brotli, so the wasm budget could never have noticed them. Only a search of the bytes finds them.
- An unstable Cargo setting didn't need a `-Z` flag on the pinned nightly: `cargo-features = ["trim-paths"]` in the root manifest was enough, and `"object"` covered every panic location on the first try.
- The asteroids' source states no terms. The SBDB Query API's documentation gives none, and JPL's use policy covers only images and video. The credit follows that policy's line ("Courtesy NASA/JPL-Caltech"), and `MANIFEST.json` records the terms as found, not as a license.

## M8: the scenarios on the page, designed (2026-11-02)

**Results:** none measured: a design session. The design: https://claude.ai/artifact/6cHBgVwwSqpTad8GP9KnGK

**Surprises:**
- The design's biggest change wasn't about scenarios. Designing their picker showed the Overview was really the TallTable's page, so the observatory gained a page per component, and the base level lost the component's route.
- The picker the plan had rejected came back in a place that works. A picker in the window's title bar can't be in the prerendered HTML; the same menu on the breadcrumb is, because each route's HTML already knows its scenario.
- Four drawings of the wins (dots, a bar, chips, a small spectrum) all failed for one reason: each was a tally, and a tally can't say when to pick which side. A sentence could. Charts of the same finding didn't add to it either: the two lines never cross, so the "crossover" is a drop.
- The site's sidebar fill is barely lighter than the sidebar, so an active item read as unmarked. Muting every other item's text made the active one stand out without touching the site's tokens.


## M9 part A1: the wide sheet's data (2026-11-02)

**Results:** [`perf/results/2026-11-02-m9-a1.md`](../perf/results/2026-11-02-m9-a1.md)

**Surprises:**
- A 365-column file was expected to send a request per column chunk. DuckDB-Wasm's read-ahead spans the whole row group instead: 4 ranged GETs a page, fewer in a session than the asteroids'.
- Wide pages are expensive because of the engine, not the bytes. A page costs DuckDB ~102 ms with no network at all, against ~9 ms for the asteroids' 11 columns; even 365 columns computed from 3 cost ~63. Each side's decode is ~1 ms, so on this file "Rows in" reads DuckDB.
- `DOUBLE` against `SMALLINT` tenths cost only 6% more bytes under ZSTD. The cast the research planned for the page SQL isn't needed.
- The research's ~40 k stations was every element's. Only ~10.6 k report a daily high on most days, 64% of them American, so the scroll's tropics (0–20°N) are 148 rows.
- DuckDB's writer makes no row group under 2,048 rows, whatever `ROW_GROUP_SIZE` says, so a 1,024-row page always decodes twice its rows.
- The file is small enough (11 pages) for the 64 MiB cache to hold it all. The eviction the plan worried about never happens.
- The probe's own server skewed the first numbers. Reading the whole file for each ranged request added ~30 ms to a page of the 22.8 MB asteroid file, so a local server for timing reads has to stream only the range.

## M9 part A2: the wide sheet's spike and stops (2026-11-02)

[Results](../perf/results/2026-11-02-m9-a2.md).

- A bare Playwright `mouse.wheel` reaches a native scroller's compositor only every other frame in headless Chromium. The DOM grid rendered 29 frames a second at 42 cells as at 1,500, and its p50 per frame read the idle half (~0.7 ms). A rAF loop setting `scrollTop` rendered 59, and so did Chromium's gesture scroll. Every DOM wheel reading so far went through that path.
- Per frame, the DOM's main thread is the cheaper side on a wide grid: ~5–6 µs a cell where it keeps up, against GPUI's ~16, because only rows that came into view render while GPUI redraws every cell. Even so, the DOM keeps up with fewer cells going down (~450 against ~830), and in a fast fling it renders on exactly half the frames from the base up. What limits it there is past the main thread.
- Sideways, the two sides are level to ~830 cells: a sideways step brings in a few columns on both. The stops separate the sides only by the vertical scroll.
- The bare host's vertical fling shows placeholder rows in a third of its frames or more (its rows land a frame after they're asked for), which are cheap to draw. It can't be compared with a grid reading from memory. The gesture's steady scroll and fast fling had none.
- A script's wait-for-rest that keeps a global between segments must key it by the segment. Keyed by a frame count alone, a segment drawing as many frames as the last ended at once, and 6 of 36 GPUI segments read 0, which the first write-up blamed on the host.
- `position: sticky` inside translated, absolutely placed rows held the pinned edge and the header to the pixel through flings in all three engines. The contender's gutter had shown it for one column; it holds for three.

## M9 part B: the wide sheet's file and the GPUI contender at the level (2026-11-02)

[Results](../perf/results/2026-11-02-m9-b.md).

- A pinned source can stop existing the same day. NOAA's 2025 file had changed within hours of part A1's download, and its bucket keeps no versions, so the pin can only check a copy kept locally, never fetch one. A source that is still being written needs its bytes kept beside the pin from the first download.
- The spike's cell counts didn't carry over to the contender. The spike laid out narrower key columns and left Latitude out, so the same lengths drew ~15% fewer cells in the real build. Counts measured on a stand-in need checking on the build before they become labels.
- A SQL template's comment is still substituted. `prep-ghcn.sql`'s header named its placeholders, and the 365-line column list replaced the comment's mention too, breaking out of the comment.
- An engine page's own `value` method shadows the table trait's. A wrapper calling `self.page.value(…)` got DuckDB's `Value` back, not the table's `CellValue`. It has to call the trait's method by name.
- `cold.ts` dated its results by UTC, so an evening run wrote tomorrow's date. `shared-web/perf/`'s `localDate` already existed for this.

## M9 part C: the TanStack contender at the wide level (2026-11-03)

[Results](../perf/results/2026-11-03-m9-c.md).

- The build's CSS minifier rewrites custom properties' values. `theme.css`'s `#ffffff` reached the page as `#fff`, so reading a theme color from a variable's text broke only in the release build. A page that needs a theme color as a number has to read it through a computed style.
- Porting the table's lengths in f64 needed no f32 emulation. Every density, pin, and paint case and control matched the native results to the pixel, the rounded scales included.
- The DOM side draws one more row than GPUI at every stop (396 against 384 cells at the 26 px stop, 4.2% over its label). Headless Chromium hides scrollbars, and GPUI always keeps a strip for its horizontal one. The 5% check still holds, but with little room, and part D's per-cell numbers need to count each side's own cells.
- A two-way race on `waitMark` crashes the script when the loser times out with nothing catching it. A longer run makes it surface: `wide.ts` ran both sides, outlived the 60 s timeout, and died on an unhandled rejection after its checks had passed.
- Node's type stripping rejects TypeScript parameter properties (`constructor(readonly lo: number)`). A module the node tests import has to spell its fields out.

## M9 part D: the wide sheet's numbers (2026-11-03)

[Results](../perf/results/2026-11-03-m9-d.md).

- The gesture scroll inherits the DPR emulation's halved wheel deltas on GPUI's side, and the native scroller doesn't: A2's spike flung GPUI half as far, at half the speed, as TanStack, and nothing in its readings showed it. A share of frames drawn says nothing about distance. Only the check added here, how far the view moved, caught it, after a cost fling stopped short of the last row.
- With the gesture fixed, GPUI kept up at every stop, so the stops part A2 placed no longer bracket its edge. GPUI's frame redraws every cell whatever the speed, so doubling it cost nothing, and the contender draws ~15% fewer cells than the spike at the same lengths.
- Traced, the native scroller moves a fast gesture ~3% past its distance; untraced, exactly. The tracing that measures the DOM side also changes how far it scrolls.
- The long sideways session moved neither side's memory: across the days nothing is read, and both sides' views are a screen's worth. What the wide sheet's memory card shows is the file held, not the session.
- GPUI's first usable sits ~3 ms nearer the probe's limit at the wide level than at the base, enough for 2 of 10 runs to miss it; and its key lost its `EventLatency` reading in 6 of 120 inputs, which the base never did.

## M9 part E1: the routes, the dial, and a switch as a load (2026-11-03)

[Results](../perf/results/2026-11-03-m9-e1.md).

- A Base UI part costs more than the behavior it adds. The sidebar's collapsible list put 2.6 KiB brotli into the first-paint JS for what one `hidden` attribute and an `aria-expanded` do. A prerendered page's interactive parts need their bytes measured one by one before they're taken from a kit.
- The load's explainer can't say what M8 drew for the engine and the data. DuckDB's worker fetches its bundles and reads the file, and a worker's requests never reach the frame's Resource Timing, so "fetched or from your cache" is knowable only for the app and the font.
- A switch made right after a fill tears down a frame mid-read, and the dying worker logs the aborted range request as a failure. The base level's flip never showed it because its first page arrives in one quick read; the wide sheet's 4-request pages leave reads in flight longer.
- A check's "seen" list emptied between steps lost its own last entry, so the next load's first state read as a repeat of "Ready". A recorder that's drained needs its last value kept apart from what it hands out.

## M9 part E2: the numbers per scenario (2026-11-04)

[Results](../perf/results/2026-11-04-m9-e2.md).

- M8's keeps-up chart ran from 50 to 100 %, drawn from sketch numbers. The measured slow device sits at 17–62 %, so its lines would have been clipped off the bottom of the chart. A chart's axis gets set from the results, not from the mock.
- An SVG drawn in one fixed viewBox scales its text with the card: in a 530 px card the axis labels came out half again as large as the page's. Each point's x as a share of the width, at a fixed height, keeps the text at the page's size. But a polyline's points can't be percentages, so the lines are drawn as segments.
- The status bar's Smooth shows two readings under one name: this tab's frames on time, and the cold runs' frames that drew new cells. The explainer has to name both, because the scenario's measure never was the base's.


## M9 part E3: the Overview and the component's page (2026-11-04)

[Results](../perf/results/2026-11-04-m9-e3.md).

- Rolldown gives a module that both the entry and a dynamic chunk import a chunk of its own, rather than leaving it in the entry. When the gallery imported one helper from `slot.ts`, the window's 26.7 KiB moved into a second first-paint chunk, and the split cost bytes. Copying the helper kept `slot.ts` in the entry. `components.ts` still splits (3.7 KiB, shared with the gallery), which costs ~0.8 KiB over the bodies' own bytes.
- A table's screen-reader text, `sr-only` and so absolutely positioned, made the component's page 296 px wider than a phone, though the table scrolled inside its own box. The text was positioned against an ancestor outside the scroller, so the scroller never clipped it. Making the scroller `relative` fixed it.
- React's hydration keeps a Suspense boundary's server HTML while its `lazy` chunk loads. So a prerendered body can leave the first-paint JS with no shift and no fallback, as long as the prerender renders the same component directly.

## M9 part E3b: the canvas's heat (2026-11-04)

[Results](../perf/results/2026-11-04-m9-e3b.md).

- A CSS variable's form costs per use. Set as `light-dark(oklch(…), oklch(…))`, the three heat stops cost the TanStack side ~4 ms of style work a frame at ~940 cells, ~10 points of frames drawn in the scroll down, because every cell's `color-mix` resolves them again. The same colors as hex, switched by a media query and `data-theme` as `theme.css` switches its own, cost nothing measurable. The spot check caught it, the interleaved A/B confirmed it: a per-cell style is worth an A/B even when it "only picks a color".
- Chromium serializes a computed `oklch()` color as `oklch(…)`, not `rgb(…)`. A theme probe that pulls the first three numbers out of a computed color reads lightness, chroma, and hue as red, green, and blue, and nothing fails loudly. Hex variables sidestep it; a probe that reads other forms has to parse each one.
- The GPUI side's heat had never been checked by its pixels, only by its probe's colors. Its layout probe (`left + x`, `top + row × rowHeight` at rest) was enough to find each cell on the canvas, so the pixel check now covers both sides with the same code.

## M9 part E4: shipped (2026-11-04)

[Results](../perf/results/2026-11-04-m9-e4.md).

- A scenario with a dial makes its README's numbers outgrow one table. The wide sheet's are per stop or once, and one table under Big file's would have read as one comparison. `report` now renders named sections, one table each with its own sources.
- A summary written from one scroll's numbers can be wrong for another. The README's first draft said GPUI's work per frame was lower past the first stop. That held for the scroll down and the fast fling but not sideways on a fast device, which the README didn't show. A claim needs every number it covers on screen beside it.
- The heaviest burst isn't the heaviest visit. Turning the wide sheet's dial through every stop on both sides sends the most requests in all, but each stop waits for its frame to fill, so its busiest 10 s holds fewer than five quick reloads of one route.

## M10 part A1: the feed, its path, and the data (2026-11-04)

**Results:** [`perf/results/2026-11-04-m10-a1.md`](../perf/results/2026-11-04-m10-a1.md)

**Surprises:**
- The research expected DuckDB's update rate to cap the dial. The dial was flat before the engine mattered: batched once a frame onto 50 rows, every visible row changes every frame from ~5k updates/s, so the UI's work stops growing there whatever path the feed takes. The tall table's own feed had already said so ("the rates saturate early"). Only folding every tick into each side's store makes the rate matter.
- Folding the ticks is cheap on both sides, garbage included. An idiomatic JS store at 50k updates/s spends under 9 ms a second and collects 61 times in 10 s, each pause under 1 ms. Mechanism B shows up as a count, not yet as a cost; whether it costs frames is in the drawing, A2's spike.
- On a page that draws nothing, CPU throttling made short tasks read faster: ~¼ of the reference's time at 4×, scaling with the rate. It isn't the clock, since a long busy loop slowed a true 4×. Read idle-page microbenchmarks as counts and ratios only, and give any timed page a busy-loop control under throttling.
- Four of the spike's first 25 made-up tickers were real (JNPR, STRL, VRSK, UPLD). "Fictional" needs a check against the exchanges' listings, not a writer's guess.
- The design's fonts limit its glyphs: IBM Plex Sans has `↑` and `↓` but no `▲` or `▼`, so a design that reaches for triangles can't be drawn on the GPUI side.

## M10 part A2: the spike on both sides, the stops, and the measure (2026-11-04)

**Results:** [`perf/results/2026-11-04-m10-a2.md`](../perf/results/2026-11-04-m10-a2.md)

**Surprises:**
- The scenario was planned as GPUI's strongest case, and the flash, not garbage collection, decided it. A fading flash makes the tall table redraw every visible cell every frame, so on the slow device GPUI fell behind at every rate, while TanStack kept up to 1k. The DOM pays an animation per flashing cell instead: with every numeric column flashing it fell further behind than GPUI. Collections were short and many on the DOM side, and never the reason a side fell behind.
- The DOM's flash never ran in the first matrix. The default way drew no overlay, and an early return checked for one, so every "flashing" TanStack number was a no-flash number, and they looked plausible. It surfaced only because a review's unrelated fixes moved the numbers. A spike's workload needs a check that it runs (`document.getAnimations()`), not just a result that looks right.
- Moving the DOM's flash onto the compositor kept up less on the slow device, not more. Of three idiomatic ways, the cell's own background animation kept up best; ~78 overlay animations at once cost more than they saved. A tidy-up of its CSS (one keyframes pair over a per-cell custom property) cost a fifth of its frames on the slow device. The DOM's flash is measured way by way.
- The first "keeps up" measure read the feed's cadence: frames showing new data over the display's frames gave 86% and 59% to two sides that showed every batch. Counting batches shown in a frame of their own fixed it. A feed that shares the main thread (the bare host's own timer) starves instead of coalescing, so it can hide falling behind entirely.
- The trace's frame presentation didn't follow the DOM side's commits with ~80 CSS animations running: a commit made a frame later read the same Shown in. A latency read from the trace needs a control that moves it, per side and per workload.
- The design's dial was in the wrong range: from ~5k updates/s nearly every visible row of a 50-row blotter changes every frame, so 5k through 50k cost about the same.
- The design's own colors failed two of its rules: the rise and fall had one lightness, and the light rise was under 4.5:1 on white.

## M10 part B1: Shown in's method (2026-11-05)

**Results:** [`perf/results/2026-11-05-m10-b1.md`](../perf/results/2026-11-05-m10-b1.md)

**Surprises:**
- A2's "failed" control wasn't the reading's fault. Every frame had its own prompt presentation; the page's frame scheduling differed between the runs compared. The control was sound in kind but compared two states. A latency's control has to share the state it controls for: within one page, or within one run's state.
- The throttle's own control perturbed what it guarded. The busy loop timed right before the window (a ~120 ms task) put the DOM side a frame or so behind for the whole window: commit → presentation 19.5 ms before it, 31.4 after. A check that runs inside the measured page belongs after the window.
- GPUI has run states too, though its draw presents in its own task: its mark → presentation settled at 1.1, ~12, or 28 ms per run at the reference, so one setting's Shown in read 14 to 41 ms over three runs. A canvas doesn't escape the browser's frame scheduling.
- Element Timing looked like an independent check on the DOM side and wasn't. It reads the same presentation feedback as the trace, to the hundredth of a millisecond, and the elements made for it cost the DOM 11% more main thread. Two readings agreeing proves nothing when they share a source.

## M10 part B2: the feed, its fixture, the data, and the scenario (2026-11-05)

**Results:** none measured (the fixture's evidence is in `PLAN.md`).

**Surprises:**
- Five of the 50 "fictional" symbols are listed on a US exchange today, three of them the canvas's, though A1 had already taken four real tickers out of the spike's first draft. A symbol made up for a demo has to be checked against the real directories, and at every build, since listings change daily; it costs two small fetches.
- A dropped tick isn't always visible in a store's final state: a quote's fields are overwritten by the instrument's next tick, so a store skipping it ends the same. Only what accumulates (the volume) or a count of ticks folded shows it, so the fixture's control drops a trade and the stores count what they fold.
- The data's SQL template substituted its variable inside a comment that named it, so the rows landed in the comment. A template's comments shouldn't spell its placeholders.
- The feed's walk had drifted since A1: twice as likely up as down at the reference, so every price ended above it and the fall's color never showed. The spike's measurements and its digest check didn't care about direction, so nothing caught it until the code review. A seeded generator needs a check of what it means (a rise and a fall both seen), not only that it repeats.

## M10 part B3: the GPUI contender at the market level (2026-11-05)

**Results:** [`perf/results/2026-11-05-m10-b3.md`](../perf/results/2026-11-05-m10-b3.md).

**Surprises:**
- One list can't say three things that land in different parts. `SCENARIOS` meant "what the page shows", "what a frame can load", and "what each side builds" at once; the market level reaches the GPUI side, the TanStack side, and the page in three parts, so the list had to split by side before a single side could build it.
- Code behind `cfg` still moves the base's wasm: its panic locations hold line numbers, and a `cfg(feature = "market")` block above them shifts them. "Unchanged" can't be a hash; it's the same size, a handful of bytes that decode as line numbers, and the level's Cargo features.
- The fold check came out nearly free: the store's state after N ticks doesn't depend on how the worker batched them, so `?ticks=2000` reproduces the fixture's 2,000 ticks through the real worker, the real fold, and the real drawing, and one tick short is its control.

## M10 part C1: the TanStack contender's data layer, `format`, `live`, and the flash (2026-11-05)

**Results:** none measured (the fixtures' evidence and the unchanged builds' hashes are in `PLAN.md`).

**Surprises:**
- A build constant drops a branch, not a method. The first cut put `live`'s landing in a method of `TablePaging`, guarded inside, and the base's bundle would have kept it whole; the market-only paths had to become functions in a module of their own, reached by an early return behind the constant, before the base's and the wide level's chunks came out byte-identical.
- The ports passed their fixtures on the first run, which is what a port decision for decision should do, and also what a fixture that runs nothing does. A probe settled it: all 7 `live` scenarios the contender runs fail with the invalidations ignored, and each control fails its own cases.
- The code review found the port's one real drift: the drag's rest was set wherever the paging loaded during a drag, and the scroll's settle loads during one too. The fixture's scenarios never let the scroll settle first, so they passed; the table sets it in the drag's settle alone. A decision ported has to be ported at the same place, not at a place that happens to see the same calls in the fixture.

## M10 part C2: the TanStack contender at the market level (2026-11-05)

**Results:** [`perf/results/2026-11-05-m10-c2.md`](../perf/results/2026-11-05-m10-c2.md).

**Surprises:**
- The build constant wasn't enough to keep the base's bundle the same, three ways over: a `memo(…)` call at a module's top level stays unless marked pure; an import's place in `main.ts` reorders the modules of every build; and Vite emits a worker from `new Worker(new URL(…))` as it transforms a module, before any branch is dropped, so the base shipped the feed's worker. Only the hashes caught them; each looked like nothing in the source.
- The cell probe went stale: published after each commit, as the wide level's is, it showed every price still flashing 700 ms after the feed stopped, because a CSS animation fades with no commit. The DOM's flash is the one cell state that changes without React, so the probe reads the DOM when it's read. Read live, it raced the other way: it took the values from the paging, which a re-read can land in before the frame draws it, so a cell drawn at 0 was read at −0.01. A probe of what's on screen has to read the value from what drew it (`data-exact`), not from the model.
- One page holds every instrument (1,024 rows to a page, 50 rows), so the base's rule of memoizing a row by its page would have rendered every visible row at each re-read. The store's own identities (a new object only for a quote a tick moved) were the memo key that fit, and the GPUI side, which redraws every frame anyway, has no counterpart.
- The two sides' cells came out the same on the first run, all 600, though the DOM measures the format's advances in the browser and the table uses its own: no market value sits near its column's edge, so this fixture can't tell the two measurements apart.

## M10 part D: market watch's numbers (2026-11-06)

**Results:** [`perf/results/2026-11-06-m10-d2.md`](../perf/results/2026-11-06-m10-d2.md) (part D1 built the scripts and published nothing).

**Surprises:**
- The frame-scheduling states that made B1's three runs read 14–41 ms were far steadier over 10 cold runs: TanStack sat in one state in every setting, within 0.4 ms, and GPUI in one at the reference. The state follows the stop, not the run: TanStack's commit sits a frame from its presentation at 100 updates/s (18.2 ms) and 5 ms from it at 500, so its slowest Shown in comes at the lightest feed. Only GPUI's slow-device runs switched, and only they make the overlap rule matter.
- GPUI's cost hardly depends on the rate (busy 277 → 288 ms/s and 4 collections in 10 s from 100 to 5k), so at the reference TanStack is the cheaper side below 5k (162 against 279 ms/s at 500). The feed's case for the canvas is the slow device and the collections, not the reference's main-thread time.
- The contender's GPUI side has no late frames on a slow device, where the spike's bare host had 11–21%, and about half its busy time. Two changes came between them, the table's cheap flash frames and the feed moved off the main thread into a worker, and nothing here separates them.

## M10 part E: market watch on the page (2026-11-06)

**Results:** [`perf/results/2026-11-06-m10-e.md`](../perf/results/2026-11-06-m10-e.md).

**Surprises:**
- The decided rule had nothing to say about market watch: it reads the fast device, where both sides keep up to 5k updates/s. The edge is only on the slow device, so the rule now falls back to it and says so ("past 1k updates a second on a slow device"), and so does the scenario card's verdict.
- This tab's Shown in doesn't rank the sides as the cold runs do. The tab reads to the frame that draws a batch: about 12 ms on GPUI and 9 ms on TanStack, steady over four loads each. The cold runs read to the frame's presentation, 13.8 against 15.0 at 500 and even. TanStack's commit sits about 5 ms before its presentation at that stop (part D's mark → presentation), and a page can't see that without a trace. The explainer says what this tab reads, and the cold values sit beside it.
- The page's own rAF loop, recording every frame under the feed for Smooth, didn't move either side's Shown in (GPUI 12.0–12.8 ms with it, 11.6–12.9 without; TanStack 8.6–9.5 both ways). The table's `live` latency had read ~20 ms against ~7 with a recorder's loop on the page. That was the bare host's invalidate → refreshed frame; here the feed is in a worker and the frame is a child of the page.
- The rate stops' label ("1k updates/s") was the only thing that changed the base and wide level's TanStack builds: every build carries the whole scenario list, which `pickScenario` reads.

## M10 part F: market watch shipped (2026-11-06)

**Results:** [`perf/results/2026-11-06-m10-f.md`](../perf/results/2026-11-06-m10-f.md).

**Surprises:**
- `worker-check` failed the deploy on the first file smaller than its reads. Its closed ranges were written for the asteroids' file (a 64 KiB footer, a 1 MiB readahead), so on market watch's 4 KiB file it asked for ranges outside the file. It then called the Worker's correct 416 and clamped 206s failures. A check's fixed sizes are an assumption about the data, and they held only until a file broke them.
- Market watch is the lightest scenario on the wire, though it's the one that never stops updating: the feed lives in the frame's worker, so after the open's one page it sends no requests. Its reloads peak below either other scenario's.

## M11 part A1: live tail's data, the replay's path, and the measures (2026-11-06)

**Results:** [`perf/results/2026-11-06-m11-a1.md`](../perf/results/2026-11-06-m11-a1.md)

**Surprises:**
- The row group that suited the wide sheet doubles this file. At 2,048 rows a group the log is 19.1 MB against 9.3 at 30,720, and a page reads 7× slower natively: zstd does badly on a small group of short strings, and the footer grows with every group. A row group size is a property of the data, not a house setting.
- The fastest replay is the one that can't stay on ranges. At 100k rows/s the tail needs a page about every frame, so reads by range would make the request count grow with the dial's rate, against the zone's rate limit and the Worker's billed requests. The live tail reads its file whole before the feed starts, the first scenario that does.
- 1995's log isn't all text: 8 lines aren't UTF-8 and DuckDB refuses to read the file as Latin-1, so prep lets the reader skip only lines with bad encoding and fails on any other skip.

## M11 part A2: live tail's spike, the stops, and the checks (2026-11-07)

**Results:** [`perf/results/2026-11-07-m11-a2.md`](../perf/results/2026-11-07-m11-a2.md)

**Surprises:**
- Market watch's "keeps up" read nothing on a slow device here. Both sides drew fewer than 90% of the frames at every stop, even 1k, since a batch that lands while the tail's re-read is out is drawn with the next one. Yet GPUI at 100k drew 88% of its frames while its view fell 0.75 s behind the tail. A frame share counts how often a view changes, not whether it keeps pace, so live tail's verdict reads Row shown in instead.
- The rate costs GPUI and not the DOM. Across the stops on a slow device GPUI's main thread rose by 165 ms a second (660 to 825) and TanStack's by 86 (504 to 590), though both read the same pages. The likely cause is decoding: GPUI's Arrow reader decodes every row of a page, a grown tail page again at each re-read, while Arrow JS reads only the cells drawn. At the 100k stop it is the difference between keeping up and falling behind.
- Under a steady feed Chromium mostly stops tying GPUI's wheel events to a frame: `EventLatency` had no frame for 16 of 24 scroll backs. With the feed paused it worked every time. The table's own probe, the response metric's guard, matched it exactly there and stood in for it.
- The spike's DOM side drew a blank table for most of a minute and still reported numbers. Past the scroller's 2^24 px cap, it computed the content's offset in the effect after the render, one batch late, so every row was drawn below the view. Only a screenshot showed it. A tail's logs say what was committed, not what's on screen.
- Nothing leveled off in 10 minutes: GPUI's JavaScript grew ~2–3 MiB a minute and TanStack's ~1, partly the spike's own logs. The wasm memory did stop growing, at 5.5 minutes.
- The spike's own controls needed controlling. The review found two faults on the TanStack side. Its tail pin waited a page when the tail page landed before the page above it, and its hold delayed the next read as well as the frame. Holding only the draw then moved the reading by nothing, because the previous landing's delayed draw drew the new page anyway. A control has to hold exactly one thing, here what the view is allowed to see.

## M11 part B1: live tail's data and the replay's shared parts (2026-11-07)

**Results:** none measured: the file, the clock, the loop's SQL, and the time's text, each pinned by a fixture with its controls (`PLAN.md`'s B1 checks hold the evidence).

**Surprises:**
- The fixtures are read generically, so a new kind of page broke tests it never meant to join. Both sides' plain-file SQL runs walk every `scenarios` section of `sql.json` with the plain file's query, so live tail's loop needed a marker (`query`) before it could live there at all.
- `cell-fixture` rewrites `cells.json` whole and keeps only the sections it knows by name, so a hand-written section vanishes from its output and `--check` fails on the committed file. A new hand-written section is added to its kept list in the same change.
- The time's controls needed choosing with the cases. An unpadded day fails only when a case falls on days 1–9, and a local-time conversion only when it isn't UTC on the machine running it; the control shifts by the log's own −0400 instead, so it fails on any machine.

## M11 part B2: the GPUI contender at the tail level (2026-11-07)

**Results:** [`perf/results/2026-11-07-m11-b2.md`](../perf/results/2026-11-07-m11-b2.md).

**Surprises:**
- Two dependencies no other level calls changed every level's wasm throughout. With `web-sys` and `wasm-bindgen-futures` added as plain dependencies, most functions in the base were renumbered and the market level grew 36 bytes. Made optional under `tail`, the base built with the old sources was byte-identical again. A level's own dependency belongs behind its feature.
- A hash can't tell a moved line number from new code. The other levels still differ by +12 bytes and millions of shifted bytes. Rebuilding the base with the touched files put back is what showed it's only their source positions.
- The first `Following(true)` went unheard. The table follows before its first frame, while it's being made, and the contract subscribes after that. So the flag's global started unset under a feed that was following. A state a table reaches while it's built has to be read, not waited for.
- The design canvas held what the plan's summary of it didn't: each column's width. Built from the summary, `request` was laid out by kind at 200 px and cut every line. The canvas gives it 470, and setting a width needs `density`. Read the canvas itself before building a scene.
- A lap's seam can't be found under a running clock. The rows grow by ~1,700 a frame at 100k, so a jump computed from the count misses a 54-row view. The pause hook, which part D needs anyway for the scroll back's control, holds the count still, and then the jump lands exactly.

## M11 part C1: the TanStack data layer's `rows` and `follow` ports (2026-11-08)

**Results:** none (nothing measured).

**Surprises:**
- The port passed every `follow` and `rows` scenario on its first run, so a pass showed little on its own. Breaking it by hand (no pin, a landing that doesn't pin, a drag that doesn't hold, the grown page's old end kept, the shrink's clamp removed) showed the fixture catches each of those. One break it can't catch: the release's pin. A release follows only at the end, and the pin only moves down, so in a correct run it never moves the view. What a fixture pins is worth checking by breaking the port.
- A one-line method moved market's bytes. `RowSet.truncate`, used only by the grown page, stayed in market's paging chunk although every call to it was folded away. As a function it's dropped. The rule held at its smallest: a level's code goes in a function, never a method.
- A "before" build that didn't happen read as no change. `git stash` leaves an untracked file, so the new `follow.ts` stayed beside the old sources. The build's `tsc` failed on it, with the output discarded, and `dist-market/` kept the new build to compare with itself. Moving the new file out too gave the real old chunk, and a diff of it named the leak. Check a build's exit status before comparing its bytes.
- After the review, sharing two small helpers moved bytes again. `follow.ts` importing `clamp` (a value) from `paging.ts`, which imports `follow.ts`, closed a cycle, and every level's paging chunk came out in a new order, the base's too. One function for `invalidateRows` and `setRows`' deferred plan reshaped market's. Each copy stays, commented. Hash after every cleanup, not only after the feature.

## M11 part C2: the TanStack contender at the tail level (2026-11-08)

**Results:** [`perf/results/2026-11-08-m11-c2.md`](../perf/results/2026-11-08-m11-c2.md).

**Surprises:**
- The view assumed its row count never changes in places no test of the base could show. TanStack Virtual subscribes to the model's offset once, at mount, so its window kept the first render's count (0) and drew 5 rows past the end of a 50,000-row table. The window's base also moves with the rows near the end, with no scroll to tell the virtualizer. A fixed count had hidden both. Look for what captures a count before letting it grow.
- The browser moved the scroller on its own. With rows changing under the view every frame, Chromium's scroll anchoring shifted `scrollTop` by ~200 rows from where the model put it. The base never changes its rows mid-view, so it never triggered.
- On the DOM, a move's input and its scroll event don't stay together. WebKit's scripted wheel reached the model after its 300 ms input window, so the move wasn't counted as the reader's. And while following, the pin's jump could land in the frame the browser scrolled for a wheel up, so the scroll event read the pin's position and no move. Following never let go. Deciding a move up at its wheel or key event, as the table's `scroll_by` decides before it moves, fixed both.
- The check's first fling under the clock was wrong, not the contender. A fling goes the rows it started with, and 3 s at 10k adds ~30,000 more, so it can't reach a moving end. Under the clock, the end also recedes at ~300,000 px/s while let go, so no scripted wheel catches it. Both checks pause the clock for that step.
- `export` alone moved market's bytes. Exporting `quotes.ts`'s advance measure, so the tail level could share it, changed market watch's `quotes` chunk and its entry's import of it. The tail level keeps its own copy.
- After the review, one fix broke what it sat beside. Moving the paging only to the end of the rows the model holds, so a move never reaches rows not drawn yet, also fed that shorter end to the following decision. End then landed short of the paging's end and stopped following. `tail` caught it on the next run. Where a move goes and what it decides read the same number, but they need different ends.

## M11 part D1: live tail's metrics, the soak, and the once-a-scenario metrics at the level (2026-11-08)

**Results:** smoke runs only, nothing published, so no results note; the evidence is in `PLAN.md`'s D1.

**Surprises:**
- On the real contenders, the spike's one edge isn't the only one. A2's TanStack page kept up at 100k on a slow device (p95 ≤ 55 ms). The contender, with the full paging port, `follow`, and `live`, trails by about a second there, as GPUI does. Row shown in and the plain count of rows behind agree, so the lag is real: the spike's lighter data path flattered it.
- "The top went up" isn't the scroll back's frame under the replay. A count set in the wheel's frame can pin the view down by more than the wheel moves it up, so the first frame whose top rose came a frame or two late (50.9 ms against `EventLatency`'s 29.3). The spike's rule, the first frame that moves after following lets go, reads 15–19 ms.
- The tail drawn isn't always one of the clock's counts. Both sides sometimes stop at a page's end (1024, 3072): the table pins the tail to the rows read, so while the next page loads the view rests at the loaded ones' end. The content check had to allow it.
- TanStack writes `state` a frame after the commit, and at 10k a count moves the rows past the 28 in view. So the recorder rarely samples the very frame that drew a given tail. The content check verifies whichever of the first five frames it caught.
- A zsh loop passed `--scenario live-tail` as one word (no word splitting), and the scripts quietly ran the base level. A smoke loop runs under bash, or quotes its arguments as an array.

## M11 part D2: live tail's numbers (2026-11-08)

**Results:** [`perf/results/2026-11-08-m11-d2.md`](../perf/results/2026-11-08-m11-d2.md).

**Surprises:**
- The 100k lag on a slow device is mostly the replay's first seconds. The tail metric's window opens 1 s after the first tail mark, where both sides trail by 0.4–1.3 s. Ten minutes later they run 69–111 ms behind (p50). Neither keeps up even then, so the verdict holds, but a cold window alone overstates the steady lag by about 8×.
- GPUI's second canvas backing store isn't always garbage. In the soak a forced collection freed it every time. At the end of `memory`'s equal work it survived the collection in 4 of 10 reference runs and 9 of 10 throttled. The page's Memory card leaves the canvas out, so nothing changed.
- Both pages' JavaScript grew by about the same amount over the soak, apart from GPUI's wasm memory: ~10 MiB at the reference, ~7 throttled. Growth that matches on both sides is likely common code or the harness, not either view.
- The word-splitting slip came back a part after D1's lesson: a quoted `"tail --stop all"` reached `node` as one path. A long run's commands go to `just` through a shell function that passes `"$@"`, each argument its own word, never one quoted string.

## M11 part E: live tail on the page (2026-11-09)

**Results:** [`perf/results/2026-11-09-m11-e.md`](../perf/results/2026-11-09-m11-e.md).

**Surprises:**
- A count of collections hid what time shows. Live tail's 30 against 9.5 collections in 10 s read as 3×; the time paused reads 5× (35.7 against 7.1 ms), and market watch's GPUI time stays flat across the dial while TanStack's grows with it. Every run had recorded the time all along; only the summaries and the card had picked the count.
- A shared ring needs a key that only grows, nothing more: market watch's generation and live tail's rows fit the same queue. The tail's one twist is the reader: counts posted while the reader holds the view would read as the reader's time, so a change of following drops them.
- Moving the GPUI ring into its own module left market watch's code the same but swapped two string constants in its data, and the tail's new `on_event` arms moved three panic locations' line numbers in the base and wide builds. "Byte-identical" for the other levels means checking what differs, not just the hash.
- One numeric constant imported across a chunk boundary changed rolldown's chunking: the metrics module became a shared chunk instead of an entry. The check looked it up by its module path and failed, though nothing reached the first paint.

## M11 part E2: the follow toggle (2026-11-09)

**Results:** [`perf/results/2026-11-09-m11-e2.md`](../perf/results/2026-11-09-m11-e2.md).

**Surprises:**
- A function a level alone calls still lands in whatever chunk its module is in: `followToggle` first sat in `contract.ts`, which the TanStack entry imports, so the tail level's first-paint JS grew 0.1 KiB though only the after-paint `replay` chunk calls it. In a module of its own (`contenders/follow.ts`) it moved out of the entry (the code review's catch).
- Without `?measure` a page can't read where GPUI's view is, so "the view held" came from screenshots of the frame's cells, and the meter, which redraws over the frame, had to be hidden first. The control is the same clip changing while following.
- A shared anchor in a long check script is a trap: the bare-page control's closing lines are the same in market watch's section and live tail's, and the new control first went into market watch's, where it failed on a tail URL.

## M11 part F: live tail shipped (2026-11-09)

**Results:** [`perf/results/2026-11-09-m11-f.md`](../perf/results/2026-11-09-m11-f.md).

**Surprises:**
- `report` belongs after `burst`, not before: the PLAN's burst row reads the newest burst file, so the README's report run earlier in the part left it stale, and `lint`'s `report --check` caught it.
- Live tail turns the dial with more requests in 10 s than any other scenario (76) though it fetches its file whole: each new frame opens it by range first. Still well under the reloads' peak.

## The tab's memory over a session (2026-11-09)

**Results:** [`perf/results/2026-11-09-session-memory.md`](../perf/results/2026-11-09-session-memory.md).

**Surprises:**
- The tracker first kept alive the frames it was tracking: its records were object literals made by each frame's init script and held by the top window, and an object keeps the realm that made it. The smoke run showed every destroyed frame alive; the records made by a function from the top's realm fixed it. The page's own leak was the same mistake in another form: closures over the old frame's `window`, and on the feed levels an array its realm made.
- The page held exactly one frame, the one replaced last, never a growing number: `sides` keeps the other side's `Tracked` by design, and the bug was what that object still pointed to.
- The measured memory (JS, canvas, workers) stayed flat through a route while the renderer's footprint climbed 30 to 300 MiB, and a forced collection before each reading barely changed that climb. The hover card's number is the process's pages, which the allocator gives back lazily; it came back within 30 s of leaving the route.
- The largest renderer isn't always the tab's: at the first reading a spare renderer (59 MiB) outweighed the fresh Overview's (52 MiB). Spinning the page for 300 ms and taking the renderer whose CPU time rose finds it; the code review's catch, and the recorded PIDs showed the tab kept one process through every navigation.

## M12 part A1: the countries file and the capabilities' checks (2026-11-09)

**Results:** [`perf/results/2026-11-09-m12-a1.md`](../perf/results/2026-11-09-m12-a1.md).

**Surprises:**
- The flags already draw on GPUI: gpui-pre-web 0.3.11 hands emoji to the browser's Canvas 2D text, and `shared/` turns that on. M8's canvas drew them missing.
- The DOM side would have failed three of its own capabilities. Virtualized, it holds only the rows near the view (34 on the asteroids' first screen; the admin table's 250 would get about as many), so Ctrl+F, Translate, and a screen reader reach only those, and it had no ARIA roles, so a screen reader hears text, not a table. The capabilities had been assumed for the DOM, never checked; a probe with controls on both sides found both gaps before anything was built.
- CLDR leaves out a region's likely language when it's English (`und-US` isn't listed; `und` → `en-Latn` covers it), and ten languages have no region names at all, Dhivehi among them, so the Maldives' Thaana name can't come from CLDR.
- CLDR gives uninhabited Bouvet and Heard Islands a population of 1, and Wikidata gives eight regions several capitals; mechanical rules handle both, each written down.
- IBM Plex Sans covers every Latin, Greek, and Cyrillic character in the names (Vietnamese and Tajik included): the gap is exactly the 15 scripts outside those three. Noto has no sans Tibetan, and Noto Serif Tibetan is a third of the 13 faces' 582 KiB.

## M12 part A2: the fonts spike (2026-11-09)

**Results:** [`perf/results/2026-11-09-m12-a2.md`](../perf/results/2026-11-09-m12-a2.md).

**Surprises:**
- Automatic fallback was enough: faces added after first paint draw every script with nothing else set, and a `FontFallbacks` list on the host's root drew the same glyphs. The route the PLAN expected to need never changed a pixel.
- The shaping is right, and the drawing isn't. harfrust gives HarfBuzz's glyphs, but gpui-pre-wgpu places each glyph at cosmic-text's hitbox `x` and `y` and drops the mark offsets, so 29 of the file's 733 texts draw a mark off its place. Most offsets are under a pixel. Sri Lanka's Sinhala and one Arabic letter's dots are wrong enough to misread. A width check alone would never catch it: every name's width matched the DOM's within a pixel, since a mark has no advance.
- A ZWJ inside a cluster looked like the cause and wasn't. The first guess, a run split across two faces at the joiner, was ruled out by logging the shaped runs: one cluster, one face.
- A 23-byte change in Tycho's wasm costs 1.3 KiB brotli: the option moves code, and the compressor's matches move with it. The bytes on the wire, not the raw change, are what count.
- The notdef box, not an empty cell, is GPUI's default for a missing glyph, one per character. The gap is visible at a glance.

## M12 part A3: the measures and the boards (2026-11-09)

**Results:** none measured; the measures and the suite's time are in [`docs/DECISIONS.md`](DECISIONS.md), "Measurement", 2026-11-09. The boards are on M8's canvas (its admin row), awaiting the user's review.

**Surprises:**
- The wide sheet's Smooth reading can't see the admin table's DOM side. Rendering every row (A1's decision) leaves TanStack's scroll with no main-thread frames, so `domDrawn` would count none. `compositorFrames` looked like the answer and isn't: it counts without times and skips the frames that wanted no update. The compositor's scroll deltas (`Scroll Delta This Frame`) are timed per frame, so both sides divide by the same total.
- A gesture longer than the table's 6,810 px of scroll reaches the last row and stops there, before its input ends: the view rests early, the timed window is cut short, and the moved-distance check fails. So the read-through is 6,000 px, inside the table.

## M12 part B1: the countries file, the scenario, and the TanStack contender's roles (2026-11-09)

**Results:** [`perf/results/2026-11-09-m12-b1.md`](../perf/results/2026-11-09-m12-b1.md).

**Surprises:**
- Part A1 pinned the Wikidata result but didn't write down its query. A live query's pin is only half a pin: without its text the next `--repin` can't ask the same question. Rebuilt from the result's shape and the A1 note's description, it gave the same 271 bindings in another order, so other bytes: the query is now `prep.ts`'s.
- The cell fixture had only ever seen floats, in the native runner and the TS one alike, and the admin table's file has none. Its float controls (JS's own text, a budget a character off) can't fail a text, so the text section needed a control of its own: the same text decoded wrong.
- The TanStack contender's first-paint JS had grown since its sizes were last written down (wide by 0.8 KiB), all of it under the limits, so `check` stayed quiet. A results file is "now" for `report` only when someone writes one.
- `data/` can't import `contenders/scenarios.ts`: its type import of `contract.ts` drags DOM globals into a tsconfig with no DOM. Prep names the file itself, as it does the others'.


## M12 part B2: the fonts path and the capabilities' check (2026-11-09)

**Results:** [`perf/results/2026-11-09-m12-b2.md`](../perf/results/2026-11-09-m12-b2.md).

**Surprises:**
- A feature that Tycho never turns on still changed Tycho's wasm. The code was compiled out, but the lines it added sat above three `expect`s in `bootstrap.rs`, whose panic locations carry their line numbers: 3 bytes changed, and brotli grew 2.1 KiB. Code for one host goes at the end of the file, and the check is a byte comparison, not a size.
- `window.find` selects its match but doesn't scroll to it. A1's "the row lands in view" was the find bar's behavior, so a script can prove the text is findable but not that the view moves.
- Chromium reports a missing character as drawn by the first face in the stack (its notdef), never as a last-resort face, so the obvious control ("a private-use character falls to LastResort") fails. IBM Plex Sans lacking all 15 scripts is what makes the face check mean something.
- The notdef boxes can be within half a pixel of the real text's width (Lao), so width alone can't say a script is drawn. The ink's shape can: boxes correlate at 0.15 at most, the faces at 0.29 or more.
- The faces at the pin are newer than the spike's: notofonts republished several that day (Sinhala to 3.000). A face pinned only by name and branch would have moved under the numbers.
- gpui-pre-wgpu's `add_fonts` returns `Ok` for bytes it can't parse: fontdb skips them. The spike never fed it a bad face, so "a face that doesn't parse fails" was a promise the code couldn't keep until the host checked each face's hash itself (the code review's catch).
- The panic-location lesson held inside the contender too: with the toggle behind the base's own feature, the wide, market, and tail wasm were still 12 bytes larger until the base's code moved to the end of `lib.rs` and `contract.rs` and `host.rs`'s call stayed on its line. Then all three matched HEAD's bytes.

## M12 part C1: the metrics at the level (2026-11-09)

**Results:** smoke runs only (reference, 1–6 runs a side, no results file); the numbers come in part C2.

**Surprises:**
- TanStack's read-through still runs a main-thread frame every vsync (120 in 2 s, ~2.6 ms each) though no row renders: the scroll event and the contract's state write with `?measure`. The compositor's deltas are still the right witness for what moved; the main frames are its work.
- GPUI's `top` comes back from a gesture down and up as 3e-12, not 0: it sums the wheel's float deltas. A wait for `top === 0` timed out in four runs of six; "back at the top" is within a pixel.
- With fonts, GPUI's "Canvas" memory doubles (19.8 → 39.6 MiB) on the scroll back, in every run, though no second canvas exists: the browser fallback draws each glyph in a 33×33 OffscreenCanvas and reads it back. Chromium counts a second buffer for the window's canvas, and does so in about one default run in five too, from the open. A first guess, "the CJK fallback's own canvas", was wrong; listing every canvas the page creates settled it.
- `compositorScrolls` as first written counted every delta; paired with the frame reporter's vsyncs (the latest begun before each delta, on the compositor's thread), the read-through's 121 deltas were 121 distinct vsyncs, all presented, so the reading kept its value and gained its guard (the code review's catch).

## M12 part C2: the runs (2026-11-09)

**Results:** [`perf/results/2026-11-09-m12-c2.md`](../perf/results/2026-11-09-m12-c2.md).

**Surprises:**
- The suite took about half A3's estimate: the estimate borrowed market watch's run length, and a 250-row file loads and scrolls in a few seconds.
- On a slow device, Chromium counted a second buffer for GPUI's canvas in every default run, not the occasional one C1 saw at the reference. What C1 read as the fonts toggle's memory was mostly that buffer, which a slow frame brings on too; it now has its own line, outside the card.
- TanStack's work per frame in the read-through didn't grow under the CPU throttle, though the wide sheet's did. With no row to render, `BeginMainFrame` is likely mostly the commit's wait on the compositor thread, which the throttle doesn't slow.
- Rows in (open → rows) favors GPUI, but TanStack opens sooner, so its rows appear first from the page's start. Neither card shows that alone.

## M12 part D: the page (2026-11-09)

**Results:** [`perf/results/2026-11-09-m12-d.md`](../perf/results/2026-11-09-m12-d.md).

**Surprises:**
- The page's first-paint JS was at its limit already (86.0 of 86.0 KiB): any route added crosses it. Its baseline, from part A of M5, had drifted 10% in eight scenarios' worth of work without a re-baseline.
- Importing one value from a module the first-paint chunk also holds moves code between chunks: the numbers' chunk importing `scenarios.ts` values moved it into the shared chunk with React, and the two compress apart, so the total moved even where the code didn't.
- The canvas's sketch names aren't the file's: Thailand is ไทย in CLDR's likely-language name, not ประเทศไทย.
- The page's `--check` measures first paint right after its own checks, so its first runs read the load those checks leave (154.9 ms against an A/B's 65): a first paint failure there needs the A/B before it means anything.
- The page's own servers didn't serve the script faces (only the GPUI contender's did), so GPUI's frame inside the page failed to fetch them until the page's Vite config served `/observatory/fonts/` too.

## M12 part E: shipped (2026-11-10)

**Results:** [`perf/results/2026-11-10-m12-e.md`](../perf/results/2026-11-10-m12-e.md).

**Surprises:**
- `burst` didn't know the admin table: a scenario joining the page doesn't join `burst` by itself, and the fonts toggle's 13 faces were a new kind of request. Measured, the admin table is the lightest scenario on the wire (55 in its busiest 10 s, the toggle on and off included), since its file is one page.
- gpui-kit 0.9.1's budget gate, deferred from the bump to this deploy, held on every level with TTFP within a couple of ms of each level's baseline: the per-event cursor write the bump's note flagged doesn't touch first paint.

## M13 part A1: the monitoring wall's instruments, its feed, and its rate (2026-11-10)

**Results:** [`perf/results/2026-11-10-m13-a1.md`](../perf/results/2026-11-10-m13-a1.md).

**Surprises:**
- The canvas assumed the wall could share market watch's build, but its column widths need `density`, which market watch's level lacks: at the table's widths by kind, one of its tables is twice as wide as its grid cell. A design's sizes are worth checking against the level before planning the build.
- The wall's new values are lighter than its tick rate suggests, but its flash isn't. It draws Last, Chg %, and Volume, which a quote tick never changes, so at the canvas's 2k a desk only a third of each desk's visible rows get a new value a frame. But a Last that moved flashes for 400 ms, so nearly every Last on screen is flashing at any moment, from 1k a desk up.
- The spike's copy of the feed had kept the upward drift that market watch's contender fixed on 2026-11-05, and its first runs measured that walk; the code review found it. The spike now checks its copy writes the contender's bytes (`spike/wall/same-feed.ts`). A spike's copy of shipped code drifts unless something compares them.
- The term check's `part [A-G]\b` never matched "part A1", so milestone IDs in code passed lint; its pattern takes a number after the letter now.
- 16k ticks a second costs the feed's worker no more than 8k did: the stops' cost is all in the drawing, as at market watch.

## M13 part A2: the monitoring wall's spike, its stops, and its measure (2026-11-10)

**Results:** [`perf/results/2026-11-10-m13-a2.md`](../perf/results/2026-11-10-m13-a2.md).

**Surprises:**
- The scenario's premise, one canvas against N DOM trees, didn't show as tables drawn apart: one React root committing every table in one `flushSync` draws them all in one frame, as one canvas does. The difference is each frame's cost and its collections, not how many frames a batch is spread across.
- The canvas's sketch was a stop too generous to GPUI: on the slow device it keeps up at 6 tables only just (90.0% over 6 runs) and not at 8. TanStack's edge is where the canvas put it (4).
- The stop where both main threads first saturate (6 tables, slow device) is the only one whose runs spread widely: 13 points on GPUI, 7 on TanStack, across two sweeps at different loads. Every other stop held within a point or two. A verdict on the line there needs its spread read beside its median.
- The spike's runs didn't check that every batch reached the side, and GPUI's fold could drop half a batch in silence; the code review found both. The rerun with a gap check (and its control, a dropped batch) lost none, but only the rerun can say so.
- `check-terms` read only the files git tracks, so a session's new files went unchecked until they were added; and it missed a part's bare ID ("A1's").
- A frame-late control that commits "a frame later" has to commit the frame's snapshot. The first one rendered the store as it was at the commit, which the next frame's own data had already reached, so nothing was held and the control read the free run's numbers. It passed only once it committed what the frame had taken, as market watch's A2 had to learn for its own hold.
- GPUI's tables show about half a row less than the DOM's at the same box: the tall table's frame keeps some room at the bottom that the DOM's scroller doesn't.

## M13 part A3: the monitoring wall's measures and boards (2026-11-10)

No measurements: the measures and the boards' decisions are in [`docs/DECISIONS.md`](DECISIONS.md) ("Measurement" and "Page", 2026-11-10).

**Surprises:**
- The canvas's wall tables have no row-number gutter, but the tall table always draws one, and the spike's TanStack side copied it. The 33 px it adds is what pushes 4 tables across past the page's frame with the sidebar open. Every other scenario's board leaves out the gutter too; the wall is the first where it changes the layout.
- A GPUI scroller doesn't nest the way a DOM one does. A `div`'s `overflow_y_scroll` scrolls on any wheel or swipe whose hit test reaches it, and the tall table doesn't stop the event, so a frame that scrolls around tables would move together with the table under the finger. The phone's layout had to say where the GPUI frame takes its scroll, which the DOM side never has to.
- The canvas's keeps-up chart drew every scenario's threshold at 95%, while market watch's and the wall's measure is 90%. GPUI's slow-device 6 tables (90.0%) reads as kept up only at the measure's own line, so the wall's sketch draws it there.

## M13 part B1: the monitoring wall's data, scenario, and feed fixture (2026-11-10)

**Results:** [`perf/results/2026-11-10-m13-b1.md`](../perf/results/2026-11-10-m13-b1.md).

**Surprises:**
- A scenario that no side builds yet still costs every contender bytes. `pickScenario` reads `ALL_SCENARIOS`, so the wall's entry rides in every level's first-paint JS (141–185 B brotli) from the day it joins the list, before any build of its own.
- "Market watch's feed unchanged" holds for its ticks, not its worker's bytes. Widening `Feed` adds 33 B to the market level's worker, while `write.ts --check` proves its output byte-identical. A check that a level is unchanged has to say which: its wasm, its JS, or what it sends.
- In `prep.ts`, a cache declared below the top-level `await`s isn't initialized yet when they run: `let` and `const` there are in their temporal dead zone. A memo shared by two builds has to live above them, or on the function itself.

## M13 part B2: the GPUI contender at the wall level (2026-11-10)

**Results:** [`perf/results/2026-11-10-m13-b2.md`](../perf/results/2026-11-10-m13-b2.md).

**Surprises:**
- A byte-identical level is a question of which files carry panic locations, and they're few. Market watch's wasm names only four of the crate's files in its strings, so the wall could change `lib.rs`, `scene.rs`, `feed.rs`, and `readout.rs` freely and keep those four's lines in place. The wide level, whose heat has a panic site in `scene.rs`, moved by one byte for it.
- Keeping lines in place isn't enough: a semantically neutral wrapper changed the codegen. Passing the state's `Object` through a by-value `fn(Object) -> Object`, even `#[inline(always)]` and returning it untouched, made market watch's wasm 10 bytes larger. A move of a type with `Drop` isn't free after LTO. The by-reference wrapper compiled to nothing.
- The phone's 196 px tables, counted from the canvas in A3, showed 5⅓ rows: the tall table keeps its horizontal scrollbar's 16 px whether or not it scrolls sideways. A board's height for a GPUI table has to count the room the table keeps, not only what it draws.

## M13 part C1: the TanStack contender at the wall level (2026-11-10)

**Results:** [`perf/results/2026-11-10-m13-c1.md`](../perf/results/2026-11-10-m13-c1.md).

**Surprises:**
- Widening the build constant's branches (`'market' || 'tail'` to `|| 'wall'`) in 20 places, adding a `Load` variant, and adding branches to `App`, `Table`, `TableContract`, and `main.ts` left every other level's bundle byte-identical. The minifier folds a constant comparison and drops its branch whole, so on the DOM side the habits were enough: no line-keeping as on the GPUI side, where panic locations carry line numbers.
- One generated color would have moved every level. The sidebar's color isn't in `theme.css`, and regenerating it with one more variable changes every level's CSS. A second generated file, which only the wall's CSS imports, kept them all.
- The tall table draws its header and rows to the frame's edge, past its last column, and the DOM side didn't. No earlier level showed it, since their columns overflow the frame. Live tail's (about 880 px of columns in a 1,408 px frame) likely differs the same way, unchecked.
- The pooled pairing is the shape of a React tree, not a choice: one `flushSync` over every table's state commits them all, so a batch's tables draw it in one frame by construction. Each table's own frame callback (market watch's way, copied N times) would make N commits a frame, and the wall's question would read React's scheduling.

## M13 part C2: the same on both sides at the wall level (2026-11-10)

**Results:** [`perf/results/2026-11-10-m13-c2.md`](../perf/results/2026-11-10-m13-c2.md).

**Surprises:**
- The grid can't be found in the pixels. In the light theme the table's header and its striped rows are the sidebar's color (`#fafafa`), so a scan for the gaps' color runs into the tables. The tall table already reported where its cells are (`TallTableLayout`, window coordinates), and gpui's `on_children_prepainted` gives a table's frame. The DOM side reads the same from its scroller and its `.frame`.
- A size measured against the baseline's build isn't a change's size. The first version was reported as +1.5 KiB against B2's baseline; against HEAD built the same day it was +0.7 KiB, and this tree's wall wasm built from HEAD is 0.8 KiB over that baseline with no Rust changed since. The review's fix, which left out the bridge's layout to save bytes, came to +1.2 KiB with the frame's box. A size effect is this tree against HEAD, built and measured the same way.
- A control has to fail for the reason the check exists. Comparing GPUI's grid at 6 tables with TanStack's at 8 always differed, on the table count, whatever the comparison of places did; the same tables moved 2 px differ only if each place is compared. The same holds for "the flash fades": it passes on a feed that never lit anything.
- One tick short changes 3 cells' text, while each side's fixture check reports 7 differences for the same control. The fixture check counts each wrong attribute (exact text, shown text, color) on its own, the cross-side check counts cells. Neither count is the size of a change.

## M13 part D1: the metrics at the wall level (2026-11-10)

**Results:** [`perf/results/2026-11-10-m13-d1.md`](../perf/results/2026-11-10-m13-d1.md).

**Surprises:**
- The sides showed different rows, and only a metric found it. C2's grid check compared where each table and its cells sit, never how many rows show, and both sides placed them identically. `metric data` counts the visible rows it waits for and read 96 on GPUI and 102 on TanStack: the tall table keeps 16 px under its rows for a scrollbar it doesn't draw, and the DOM's scroller keeps none. A sliver of a 17th row, 3 px, is a sixteenth more cells for TanStack to paint every frame of the feed.
- A new check passed until its control ran. The rows-shown comparison passed at every grid on the first run, because `perf/wall.ts` stripped the cells from the grids' tables (only places were compared), so there were no rows to compare. The one-more-row control, which must differ in every table, differed in none.
- Market watch's one-pass pairing rested on a property the wall doesn't have. With one table, each batch's frame comes no earlier than the last batch's, so one cursor serves both. On the wall a later batch can tick other tables than an earlier one, and its frame can come first. The rewrite keeps a cursor only over the send times, and a random check pinned it to the old pairing on market watch's batches.
- No headless browser here draws a scrollbar with height, so a fix for a classic scrollbar can't be seen by any check as it stands. Showing scrollbars isn't enough: Chromium (scrollbars shown or hidden) and Firefox with classic bars set both reported a 0 px bar on an overflowing table. A `::-webkit-scrollbar` style forces one, but only where `--hide-scrollbars` is off: the check's first run measured 0 px and failed on its guard, not on its result.

## M13 part D2: the monitoring wall's runs (2026-11-11)

**Results:** [`perf/results/2026-11-11-m13-d2.md`](../perf/results/2026-11-11-m13-d2.md).

**Surprises:**
- A metric's results file is named for its label, scenario, and stop, not the metric. With one label for the feed and the once-a-scenario metrics, each later metric would have overwritten the feed's 6-table file. Each metric needs its own label (`m13-d2-feed`, `-usable`, …), as M10's runs had; the scripts now refuse an existing file.
- On a slow device the contenders moved further apart than the spike's pages did, GPUI up and TanStack down, with the edges where the spike put them. The spike had no paging, no re-reads, and no engine loaded.
- At the reference Shown in takes one of two values on both sides, run by run. Its send → presentation part takes one of two values a frame's half apart: the feed's 16 ms batches against the display's frames, phased at each cold start. A median of 10 lands on whichever value most runs drew, so a stop's card can move by a frame's worth between suites with nothing changed.
- `machineInfo` read the versions from the lockfile, not from the build being measured, so an A/B's other build was recorded as the tree's. The build names its own: under `trim-paths` a wasm's panic locations keep `gpui-kit-<version>/`, exactly one, which the metric scripts now record.
- Two A/Bs, one back to back and one interleaved, both put sideways work +3.7–3.9% on 0.9.1 by the sets' medians, and pairing the interleaved rounds put it at +1%, either way. The reading takes one of two values a run, so a set's median follows how many runs drew which. A two-valued reading spreads past the quiet gate on a quiet machine, and only a paired comparison reads it.

## M13 part E: the monitoring wall on the page (2026-11-11)

**Results:** [`perf/results/2026-11-11-m13-e.md`](../perf/results/2026-11-11-m13-e.md).

**Surprises:**
- A build directory isn't the tree's build until it's rebuilt. The GPUI contender's market and tail directories predated part B1, though every part since had built other levels, so comparing "before" and "after" first showed this part changing their wasm. B2's recorded hash settled it. Rebuild every level before comparing any.
- The page needed no new reading for N tables. The frame's ring is pooled across the tables on both sides, so the page reads it as market watch's, and the status bar and panel are market watch's cards with the wall's words.
- This tab's Smooth read 66.7 % on TanStack in the check, right after the flip, on a window of a few frames; read for 15 s it held at 100 %. A single early reading says little; the check asks only for a number.
- Chrome's Responsive mode isn't a narrow window for GPUI. Under its emulated DPR the canvas's backing store comes out half the size, so GPUI lays out for half the frame's width (one column of tables from about twice the breakpoint) and reads the pointer in that half-size layout. The same frame without emulation (a resized window) lays out and scrolls correctly. Check narrow layouts by resizing the window.
- The stacked view's scrolling needed a person's hands. Every check passed: a wheel over a gap moved the column, over a table didn't. In use, an incremental scroll or a trackpad fling between two tables lands on the next table within a few events, and 8 px sides can't be aimed at. Only a review with a trackpad found it.
- In GPUI, as in CSS, `flex_1` on an item and its siblings splits the row evenly, so a `max_w` on a share smaller than the cap never applies: the first try drew 130 px tables on a phone. A width that's the item's own is its basis (`flex_basis`, no grow).

## M13 part F: the monitoring wall shipped (2026-11-11)

**Results:** [`perf/results/2026-11-11-m13-f.md`](../perf/results/2026-11-11-m13-f.md).

**Surprises:**
- The wall is light on the wire. Its uses peaked at 60 and 107 requests in 10 s, under market watch's: eight tables are one file, read once a frame in a few requests, and the feed runs in the frame. What reaches the zone's limit is still reloading a scenario whose file is read by range.
- Read under the protocol's overlap rule, an update's time to show is even at every stop on a fast device, though GPUI's median is the lower at each. Both sides' runs take one of two values, so the ranges overlap.

## M14 part A1: the wide sheet's later steps, specced (2026-11-12)

**Results:** none measured; the spec and the file's sizing are in `PLAN.md`'s part A1, the decisions in [`DECISIONS.md`](DECISIONS.md), "Measurement" and "Scenarios", 2026-11-12.

**Surprises:**
- The table has no copy fixture. Every other feature a scenario ports has one, but `copy`'s text is tested only inside the crate, where a DOM port can't reach it. M14 asked the table for one before the port, rather than writing it here.
- The whole sheet is copyable. At ~18 MiB of TSV for 3.9 M cells, it passes the key's 100,000-cell limit forty times over but fits the 64 MiB cap, so a confirmed select-all copies every page. It's the one copy that makes both sides read the whole file while the view must keep up.
- A few columns cost a whole file. A week of days is under the key's limit, but a page is the source's unit, so it reads all 11 pages: the copy's paging, not its text, is what the week measures.

## M14 part B: the GPUI side at the grown wide level (2026-11-12)

**Results:** [`perf/results/2026-11-12-m14-b.md`](../perf/results/2026-11-12-m14-b.md).

**Surprises:**
- A same-origin frame can take the parent's click as its clipboard gesture, but Chromium also wants its document focused. Firefox and WebKit wrote the button's copy at once; Chromium refused it until the frame focused its own window first, in the click's task.
- The layout global costs a measured run nothing per frame by construction. The table emits `Layout` only when the layout changes, not when the view moves, so the frame-work A/B the spec allowed for had nothing to measure: the object stays the same through a scroll.
- `cold --write-baseline` on a level dropped that level's TanStack baseline. It replaced the level's entry whole, where the base's merge keeps the TanStack side's. Nothing had rewritten a level's GPUI baseline since that entry was added.
- The tools cost what the table's bare host measured, the host's code included: +18.9 KiB brotli against its +20.2. Brotli moved the wasm up to 1.6 KiB for under half a KiB of raw code, so a size read before a build's last fix needs reading again.

## M14 part C1: the TanStack side's resize and selection (2026-11-12)

**Results:** [`perf/results/2026-11-12-m14-c1.md`](../perf/results/2026-11-12-m14-c1.md).

**Surprises:**
- A resize would have rebuilt the scroll model every frame. The view's model, contract, and tooltip were keyed by the laid-out columns, which never changed until a width could. They're now keyed by the file's columns, and read the laid-out ones through a ref.
- TanStack Virtual doesn't see a column's new width through `estimateSize`. Its measurements are memoized on the item keys, so the column virtualizer's key function now changes with the widths. It also asks for the view's rect only once: the review found that narrowing a pinned column left a blank strip at the right until the view was told again.
- The table's selection tint covers the rows' lines; DOM cells stop a pixel short of them. Matching it took selected cells that reach over the line, and key columns and row numbers that always do and draw the line themselves, or a selected cell scrolled under the run would tint the line there.
- A key's scroll on the DOM lands a frame later. The review found that two keys before the scroll event both measured from the old top and overshot. Nothing else in the contender reads the top right after moving it.
- Sharing the set width's clamp from `layout.ts` moved the base's bundle. Rollup kept the helper as a top-level function and renamed React's internals around it. `layOut` keeps its inline copy, and the test pins the two equal.
- The view's page is its own. In headless runs the DOM's overlay scrollbar takes no height, so TanStack's view holds 42.3 rows against GPUI's 41.5, and Page Down moves 41 rows against 40. The base parity already allowed for this, so the tools' parity reads each side's page from its own End.
