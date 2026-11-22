# The tall table's long text cells (2026-11-21)

tall-table M23's part B changed the table's base: a text longer than its cell could show is drawn from the start of its value, checked to cut where the whole value would, so a frame no longer copies and shapes every drawn cell's whole value. Tycho draws the same pixels (the table's reference screens, and `just tycho cells`, its long text and multi-line cases among them, pass); a file with long text (JSONL, a log's messages) scrolls at the cost of one with short text.

Its wasm effect, release, wasm-opt with the apps' flags, brotli 11, the crate built alone at the commit before (`4561bee`) and with the change, in one worktree at a fixed path with a target of its own, on Apple M1, machine `local`:

| Before | After | Change |
|---|---|---|
| 10,692,021 bytes after wasm-opt, 2,944.0 KiB brotli | 10,692,868 bytes, 2,940.5 KiB brotli | +847 bytes after wasm-opt (0.8 KiB); −3.5 KiB brotli, its swing when a few bytes shift |

`just tycho cells` passes on the change as reviewed (`2026-11-22-tall-table-long-text-cells.json`); `just tycho table` passed on it before the review's fixes, which left the paging alone (`2026-11-22-m4-table.json`). Not rerun: `check` (the size is far inside its 15%, and no cell is loaded at the first frame).

The table's own note: [`components/tall-table/perf/results/2026-11-21-m23-b.md`](../../../../components/tall-table/perf/results/2026-11-21-m23-b.md).
