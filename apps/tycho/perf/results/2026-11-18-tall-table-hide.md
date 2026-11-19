# The tall table's `hide` (2026-11-18)

tall-table M19 added `hide`, column visibility, behind a Cargo feature of its own, off by default. Tycho builds no feature of the table's, so nothing it draws or does changes: it adopts `hide` in a milestone of its own.

Its wasm effect, release, wasm-opt with the apps' flags, brotli 11, the crate built alone at M19's parent (`0f6970b`) and at M19's part B (`ee695b8`), in one worktree at a fixed path with a target of its own, on Apple M1, machine `local`:

| Before | After | Change |
|---|---|---|
| 10,692,021 bytes after wasm-opt, 2,943.1 KiB brotli | 10,692,021 bytes, 2,943.0 KiB brotli | None after wasm-opt; 33 bytes differ in place, all panic locations' line numbers (the table's source files grew); −0.1 KiB brotli |

No `check` or perf run: no code it runs changed.

The table's own note: [`components/tall-table/perf/results/2026-11-18-m19-c.md`](../../../../components/tall-table/perf/results/2026-11-18-m19-c.md).
