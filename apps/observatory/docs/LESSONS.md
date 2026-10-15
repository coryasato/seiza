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
