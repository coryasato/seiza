# The tall table's cell popover (2026-11-20)

tall-table M21 added `popover`, a cell's full value in a popover below it with a button to the host's view of its row, behind a Cargo feature of its own, off by default. The GPUI contender builds no feature of the table's at its base level, so nothing it draws or measures changes. No fixture changed.

Its wasm effect, release, wasm-opt with the apps' flags, brotli 11, the crate built alone at M21's opening (`8ffce13`) and at M21's part B (`aa4f2b1`), in one worktree at a fixed path with a target of its own, on Apple M1, machine `local`:

| Before | After | Change |
|---|---|---|
| 10,140,486 bytes after wasm-opt, 2,782.7 KiB brotli | 10,140,486 bytes, 2,782.4 KiB brotli | None after wasm-opt; 40 bytes differ in place, all in the data section, panic locations' line numbers (the table's source files grew); −0.3 KiB brotli, its swing |

The other levels weren't built: none builds `popover`, and the base level's code is unchanged. Not rerun: `sizes --check`, `cold --check`, and the scenarios (no code a measured scenario runs changed).

The table's own note: [`components/tall-table/perf/results/2026-11-20-m21-c.md`](../../../../components/tall-table/perf/results/2026-11-20-m21-c.md).
