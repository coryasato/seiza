# The tall table's event bridge (2026-10-23)

tall-table M1 moved what this app did with the table's events (the filled mark, the scrollbar's targets, the probes as JS values) into `components/tall-table/bridge/` (`tall-table-bridge`), which every host of the table now uses. Its wasm effect here, release, wasm-opt with the apps' flags, brotli 11, the crate built alone before and after, on Apple M1, machine `local`:

| Before | After | Change |
|---|---|---|
| 2,698.0 KiB | 2,697.4 KiB | −0.6 KiB brotli (+0.2 KiB before brotli) |

The noise of the bytes moving. One visible change: `__contender.columns` gains each column's `x` (the bridge writes the table's whole `ColumnProbe`; `docs/contender-contract.md` says so). `just observatory reach` and `just observatory cell-fixture --check` pass after it. Also moved: the trace's frame math (`Trace`, `frameWork`, `lateFrames`) to `shared-web/perf/trace.ts`, re-exported by `metrics/metrics.ts`; the page, both contenders' hosts, and `perf/` typecheck unchanged. The table's own note: [`components/tall-table/perf/results/2026-10-23-m1.md`](../../../../components/tall-table/perf/results/2026-10-23-m1.md).
