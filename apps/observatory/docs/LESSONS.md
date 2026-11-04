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

