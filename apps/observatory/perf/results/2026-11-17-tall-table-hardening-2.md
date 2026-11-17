# The tall table's second hardening's fixes (2026-11-17)

tall-table's second hardening (part C) changed the table's base code: `set_rows` clears what's kept by row at or past the new end (the hover, the jump's highlight) and has the tooltip decided again; a page landing on the hovered row does too; only the left button's release ends a drag, and a move with no button ends every drag that's on. No paging number, cell text, or page SQL changed, so the fixtures both contenders match are as they were.

The GPUI contender's wasm effect at the base level, release, wasm-opt with the apps' flags, brotli 11, the crate built alone at the hardening's part C's parent (`ec85d34`) and with the fixes, in one worktree at a fixed path with a target of its own, on Apple M1, machine `local`:

| Before | After | Change |
|---|---|---|
| 10,140,263 bytes after wasm-opt, 2,780.8 KiB brotli | 10,140,534 bytes, 2,781.7 KiB brotli | +271 bytes after wasm-opt; +0.9 KiB brotli, the noise of the bytes moving |

The other levels weren't built: each adds its features' code to the same base, and the table's own run found every feature's added bytes unchanged within 0.1 KiB after wasm-opt. Not rerun: `sizes --check`, `cold --check`, and the scenarios (271 bytes, and no code a measured scenario runs changed but a branch in the pointer's handlers).

The table's own note: [`components/tall-table/perf/results/2026-11-17-hardening-2-c.md`](../../../../components/tall-table/perf/results/2026-11-17-hardening-2-c.md).
