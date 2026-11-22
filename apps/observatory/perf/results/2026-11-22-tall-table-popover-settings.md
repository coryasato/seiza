# The tall table's popover settings (2026-11-22)

tall-table M23's part C added three settings to the table's `popover` (the cue and Enter on a cut text alone, a cue that fades its cell's text with a mark of its own on the open cell, and a button the popover's width), each off by default, behind the Cargo feature `popover`. The GPUI contender builds no feature of the table's at its base level, and `popover` at none, so nothing it draws or measures changes. No fixture changed.

Its wasm effect, release, wasm-opt with the apps' flags, brotli 11, the crate built alone at M23's part B (`466d2f8`) and at its part C (`f2bee44`), in one worktree with a target of its own, on Apple M1, machine `local`:

| Before | After | Change |
|---|---|---|
| 10,141,500 bytes after wasm-opt, 2,784.3 KiB brotli | 10,141,502 bytes, 2,784.0 KiB brotli | +2 bytes after wasm-opt, as the table's bare host's base; −0.3 KiB brotli, its swing |

The other levels weren't built: none builds `popover`, and the base level's code is unchanged. Not rerun: `sizes --check`, `cold --check`, and the scenarios (no code a measured scenario runs changed).

The table's own note: [`components/tall-table/perf/results/2026-11-22-m23-d.md`](../../../../components/tall-table/perf/results/2026-11-22-m23-d.md).
