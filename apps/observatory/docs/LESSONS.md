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
