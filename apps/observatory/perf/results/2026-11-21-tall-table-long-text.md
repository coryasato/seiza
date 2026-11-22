# The tall table's long text cells (2026-11-21)

tall-table M23's part B changed the table's base: a text longer than its cell could show at the narrowest advance is drawn from the start of its value, checked to cut where the whole value would. The GPUI contender draws the same pixels and the same probed text (`CellProbe::shown` stays the whole text): `just observatory fixtures` passes with no fixture changed. No scenario's data holds a text that long, so each cell's added work is one length test.

Its wasm effect at the base level, release, wasm-opt with the apps' flags, brotli 11, the crate built alone at the commit before (`4561bee`) and with the change, in one worktree at a fixed path with a target of its own, on Apple M1, machine `local`:

| Before | After | Change |
|---|---|---|
| 10,140,486 bytes after wasm-opt, 2,784.0 KiB brotli | 10,141,500 bytes, 2,784.3 KiB brotli | +1,014 bytes after wasm-opt (1.0 KiB), +0.2 KiB brotli |

The other levels weren't built: each links the same base code. Not rerun: `sizes --check`, `cold --check`, and the scenarios (the table's own scroll and fling read within its base's spread with the change: its note).

The table's own note: [`components/tall-table/perf/results/2026-11-21-m23-b.md`](../../../../components/tall-table/perf/results/2026-11-21-m23-b.md).
