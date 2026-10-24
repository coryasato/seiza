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
