# The tall table's `find` (2026-11-19)

tall-table M20 added `find`, a term highlighted and stepped through in every row, behind a Cargo feature of its own, off by default. The GPUI contender builds no feature of the table's at its base level, so nothing it draws or measures changes. The table's new fixture, `find.json`, isn't one the contenders run: no observatory level finds.

Its wasm effect, release, wasm-opt with the apps' flags, brotli 11, the crate built alone at M20's parent (`a28f098`) and at M20's part B (`9e95bf0`), in one worktree at a fixed path with a target of its own, on Apple M1, machine `local`:

| Before | After | Change |
|---|---|---|
| 10,140,486 bytes after wasm-opt, 2,781.8 KiB brotli | 10,140,486 bytes, 2,782.7 KiB brotli | None after wasm-opt; 37 bytes differ in place, all in the data section, panic locations' line numbers (the table's source files grew); +1.0 KiB brotli, its swing |

The other levels weren't built: none builds `find`, and the base level's code is unchanged. Not rerun: `sizes --check`, `cold --check`, and the scenarios (no code a measured scenario runs changed).

The table's own note: [`components/tall-table/perf/results/2026-11-19-m20-c.md`](../../../../components/tall-table/perf/results/2026-11-19-m20-c.md).
