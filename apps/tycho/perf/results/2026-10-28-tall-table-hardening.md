# The tall table's hardening fixes (2026-10-28)

tall-table's hardening (part C) changed the table's base code: a shrink forgets every page wholly past the new end, a closed table cancels nothing again, and (with `live` and `copy`, which Tycho doesn't build yet) a copy waits for the cache's read of a page that grew. Tycho grows its rows (a CSV loading) and never shrinks them, so nothing it does changes. Its wasm effect here, release, wasm-opt with the apps' flags, brotli 11, the crate built alone at the hardening's parent (`e8a1f9f`) and with the fixes, in one worktree at a fixed path, on Apple M1, machine `local`:

| Before | After | Change |
|---|---|---|
| 2,853.6 KiB | 2,853.8 KiB | +0.2 KiB brotli (+1,023 bytes after wasm-opt) |

**`just tycho check`:** the wasm 2,855.1 KiB against the 3,247.1 KiB limit; reference TTFP 221.6 ms against the 214.8 ms limit, **FAIL**, its runs 199.1–259.0 ms with the load average at 5.3–8.5 (a browser in use). A 1 KiB change can't cost 13%, so it was judged by an interleaved A/B against the parent's build (`2026-10-28-hardening-c-ab.json`, `just tycho placeholder --ab`, reference, n=10 each, load 7.4 → 5.9): TTFP median 196.0 ms with the fixes, 198.2 ms before, placeholder paint 54.6 against 44.3 ms. Both sides' spreads (9.3%, 6.3%) failed the A/B's 6% gate, so it reads as no change, not proven to 3%; rerun the A/B on a quiet machine if it matters. The placeholder checks in the same run passed.

The table's own note: [`components/tall-table/perf/results/2026-10-28-hardening-c.md`](../../../../components/tall-table/perf/results/2026-10-28-hardening-c.md).
