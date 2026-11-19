# The tall table's `hide` (2026-11-18)

tall-table M19 added `hide`, column visibility, behind a Cargo feature of its own, off by default. The GPUI contender builds no feature of the table's at its base level, so nothing it draws or measures changes. The fixtures both contenders match gained `hidden` cases, which the TanStack contender's tests name as skipped.

Its wasm effect, release, wasm-opt with the apps' flags, brotli 11, the crate built alone at M19's parent (`0f6970b`) and at M19's part B (`ee695b8`), in one worktree at a fixed path with a target of its own, on Apple M1, machine `local`:

| Before | After | Change |
|---|---|---|
| 10,140,486 bytes after wasm-opt, 2,783.8 KiB brotli | 10,140,486 bytes, 2,781.8 KiB brotli | None after wasm-opt; the bytes that differ in place are panic locations' line numbers (the table's source files grew); −2.0 KiB brotli, its swing |

The other levels weren't built: none builds `hide`, and the base level's code is unchanged. Not rerun: `sizes --check`, `cold --check`, and the scenarios (no code a measured scenario runs changed).

The table's own note: [`components/tall-table/perf/results/2026-11-18-m19-c.md`](../../../../components/tall-table/perf/results/2026-11-18-m19-c.md).
