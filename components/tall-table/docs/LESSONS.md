# Lessons learned

One entry per milestone, written before starting the next one: what surprised us, and what it taught us. The milestone's numbers are in its results note (linked from each entry; an app's own measurements of the feature are in that app), and the decisions it made are in [`DECISIONS.md`](DECISIONS.md).

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
