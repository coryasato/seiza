# The tall table's popover settings (2026-11-22)

tall-table M23's part C added three settings to the table's `popover` (the cue and Enter on a cut text alone, a cue that fades its cell's text with a mark of its own on the open cell, and a button the popover's width), each off by default, behind the Cargo feature `popover`. Tycho builds no feature of the table's, so nothing it draws or does changes: it adopts them in a milestone of its own (its PLAN's "Waiting on").

Its wasm effect, release, wasm-opt with the apps' flags, brotli 11, the crate built alone at M23's part B (`466d2f8`) and at its part C (`f2bee44`), in one worktree with a target of its own, on Apple M1, machine `local`:

| Before | After | Change |
|---|---|---|
| 10,692,868 bytes after wasm-opt, 2,940.5 KiB brotli | 10,692,870 bytes, 2,940.5 KiB brotli | +2 bytes after wasm-opt, as the table's bare host's base; brotli +23 bytes |

No `check` or perf run: no code it runs changed.

The table's own note: [`components/tall-table/perf/results/2026-11-22-m23-d.md`](../../../../components/tall-table/perf/results/2026-11-22-m23-d.md).
