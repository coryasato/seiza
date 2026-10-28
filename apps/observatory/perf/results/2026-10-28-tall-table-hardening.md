# The tall table's hardening fixes (2026-10-28)

tall-table's hardening (part C) changed the table's base code: a shrink forgets every page wholly past the new end, and a closed table cancels nothing again. The GPUI contender opens one file and never changes its row count, so nothing it does changes. Its wasm effect here, release, wasm-opt with the apps' flags, brotli 11, the crate built alone at the hardening's parent (`e8a1f9f`) and with the fixes, in one worktree at a fixed path, on Apple M1, machine `local`:

| Before | After | Change |
|---|---|---|
| 2,707.8 KiB | 2,707.0 KiB | −0.8 KiB brotli (+13 bytes after wasm-opt) |

The noise of the bytes moving. After it, on the contender's release build: `just observatory sizes --check` passes (no panel linked), `just observatory reach` passes (End reaches row 1,567,523 = `count(*)`, the last key drawn), and `just observatory fixtures` passes (`paging.json`'s two new scenarios, a shrink past a page and its cancels, and its `cache` control are skipped by the TanStack contender's test, as a `rows` step and a fault in the table's own code). Not rerun: `cold --check` (the machine was loaded, and the change is 13 bytes).

The table's own note: [`components/tall-table/perf/results/2026-10-28-hardening-c.md`](../../../../components/tall-table/perf/results/2026-10-28-hardening-c.md).
