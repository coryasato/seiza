# The tall table's `replace_rows` (2026-11-18)

tall-table M18 added `replace_rows(rows, at)` to the table's base: one call for a host whose every row index changed meaning (a filter, a query run again), `sort`'s reset made public. `sort`'s reset moved out of its feature into the base, where `replace_rows` and `sort` share it. Tycho doesn't call `replace_rows` yet and builds no feature of the table's, so nothing it draws or does changes: its filters adopt the call in a milestone of their own.

Its wasm effect, release, wasm-opt with the apps' flags, brotli 11, the crate built alone at M18's parent (`55a9597`) and with M18's `src/`, in one worktree at a fixed path with a target of its own, on Apple M1, machine `local`:

| Before | After | Change |
|---|---|---|
| 10,692,028 bytes after wasm-opt, 2,943.4 KiB brotli | 10,692,021 bytes, 2,942.4 KiB brotli | −7 bytes after wasm-opt; −1.0 KiB brotli, the noise of the bytes moving |

No `check` or perf run: 7 bytes, and no code the first paint or a frame runs changed.

The table's own note: [`components/tall-table/perf/results/2026-11-18-m18-c.md`](../../../../components/tall-table/perf/results/2026-11-18-m18-c.md).
