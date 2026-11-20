# The tall table's `find` (2026-11-19)

tall-table M20 added `find`, a term highlighted and stepped through in every row, behind a Cargo feature of its own, off by default. Tycho builds no feature of the table's, so nothing it draws or does changes: it adopts `find` in a milestone of its own.

Its wasm effect, release, wasm-opt with the apps' flags, brotli 11, the crate built alone at M20's parent (`a28f098`) and at M20's part B (`9e95bf0`), in one worktree at a fixed path with a target of its own, on Apple M1, machine `local`:

| Before | After | Change |
|---|---|---|
| 10,692,021 bytes after wasm-opt, 2,943.0 KiB brotli | 10,692,021 bytes, 2,942.9 KiB brotli | None after wasm-opt; 37 bytes differ in place, all in the data section, panic locations' line numbers (the table's source files grew); −0.1 KiB brotli |

No `check` or perf run: no code it runs changed.

The table's own note: [`components/tall-table/perf/results/2026-11-19-m20-c.md`](../../../../components/tall-table/perf/results/2026-11-19-m20-c.md).
