# The tall table's event bridge (2026-10-23)

tall-table M1 moved what this app did with the table's events (the filled mark, the scrollbar's targets, the probes as JS values) into `components/tall-table/bridge/` (`tall-table-bridge`), which every host of the table now uses. Its wasm effect here, release, wasm-opt with the apps' flags, brotli 11, the crate built alone before and after, on Apple M1, machine `local`:

| Before | After | Change |
|---|---|---|
| 2,842.4 KiB | 2,843.0 KiB | +0.6 KiB brotli (−0.1 KiB before brotli) |

The noise of the bytes moving; no behavior changed. `just tycho table --runs 2 --reference-only` passes after it (first rows 201 ms, jump 79 ms, the last row reached). The table's own note: [`components/tall-table/perf/results/2026-10-23-m1.md`](../../../../components/tall-table/perf/results/2026-10-23-m1.md).
