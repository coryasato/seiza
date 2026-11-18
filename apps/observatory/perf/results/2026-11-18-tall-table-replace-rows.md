# The tall table's `replace_rows` (2026-11-18)

tall-table M18 added `replace_rows(rows, at)` to the table's base: one call for a host whose every row index changed meaning (a filter, a query run again), `sort`'s reset made public, its reset moved out of `sort` into the base. No paging number, cell text, or page SQL changed for a table that doesn't call it, so the fixtures both contenders match are as they were; `paging.json` gained `replace` scenarios, which the TanStack contender's test names as skipped (no DOM contender replaces its rows).

The GPUI contender's wasm effect at the base level, release, wasm-opt with the apps' flags, brotli 11, the crate built alone at M18's parent (`55a9597`) and with M18's `src/`, in one worktree at a fixed path with a target of its own, on Apple M1, machine `local`:

| Before | After | Change |
|---|---|---|
| 10,140,533 bytes after wasm-opt, 2,780.8 KiB brotli | 10,140,486 bytes, 2,780.8 KiB brotli | −47 bytes after wasm-opt; brotli unchanged |

The other levels weren't built: none calls `replace_rows` or builds `sort`, and the table's own run found every feature's added bytes over the base within 1.4 KiB of the parent's after wasm-opt. Not rerun: `sizes --check`, `cold --check`, and the scenarios (47 bytes, and no code a measured scenario runs changed).

The table's own note: [`components/tall-table/perf/results/2026-11-18-m18-c.md`](../../../../components/tall-table/perf/results/2026-11-18-m18-c.md).
