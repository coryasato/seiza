# The tall table's second hardening's fixes (2026-11-17)

tall-table's second hardening (part C) changed the table's base code: `set_rows` clears what's kept by row at or past the new end (the hover, the jump's highlight) and has the tooltip decided again; a page landing on the hovered row does too; only the left button's release ends a drag, and a move with no button ends every drag that's on. Tycho grows its rows (a CSV loading) and never shrinks them, and builds no feature of the table's, so what a reader sees changes in one place: a tooltip over a cell whose page is read again says the value drawn.

Its wasm effect, release, wasm-opt with the apps' flags, brotli 11, the crate built alone at the hardening's part C's parent (`ec85d34`) and with the fixes, in one worktree at a fixed path with a target of its own, on Apple M1, machine `local`:

| Before | After | Change |
|---|---|---|
| 10,691,605 bytes after wasm-opt, 2,943.4 KiB brotli | 10,692,027 bytes, 2,942.2 KiB brotli | +422 bytes after wasm-opt; −1.2 KiB brotli, the noise of the bytes moving |

No `check` or perf run: 422 bytes are far inside the wasm budget, and nothing the first paint or a frame runs changed but a branch in the pointer's handlers.

The table's own note: [`components/tall-table/perf/results/2026-11-17-hardening-2-c.md`](../../../../components/tall-table/perf/results/2026-11-17-hardening-2-c.md).
