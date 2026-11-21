# The tall table's header icon (2026-11-21)

tall-table M22 added `header-icon`, a column's icon at the start of its header, set by the host, its press reported, behind a Cargo feature of its own, off by default. The GPUI contender builds no feature of the table's at its base level, so nothing it draws or measures changes. No fixture changed.

Its wasm effect, release, wasm-opt with the apps' flags, brotli 11, the crate built alone at the commit M22's part B started from (`85c0f0c`) and at M22's part C (part B's `78ff149` with part C's fix to the table's source), in one worktree at a fixed path with a target of its own, on Apple M1, machine `local`:

| Before | After | Change |
|---|---|---|
| 10,140,486 bytes after wasm-opt, 2,782.4 KiB brotli | 10,140,486 bytes, 2,784.0 KiB brotli | None after wasm-opt; 38 bytes differ in place, panic locations' line numbers (the table's source files grew); +1.6 KiB brotli, its swing |

The other levels weren't built: none builds `header-icon`, and the base level's code is unchanged. Not rerun: `sizes --check`, `cold --check`, and the scenarios (no code a measured scenario runs changed).

The table's own note: [`components/tall-table/perf/results/2026-11-21-m22-c.md`](../../../../components/tall-table/perf/results/2026-11-21-m22-c.md).
