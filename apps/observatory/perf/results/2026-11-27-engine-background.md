# The engine's background queries and slice length (2026-11-27)

Tycho M16's part A gave the engine (`engines/duckdb/`) two options, each off by default: a query in the background (`Engine::query_background`, `Runner::query_background`, and the bridge's `query(sql, id, { background })`), which asks for its next slice only while no other query is in flight; and the host's slice length (`createBridge`'s `sliceMs`, DuckDB-Wasm's `queryPollingInterval`). The GPUI contender sends no background query, and neither contender sets `sliceMs`, so both send what they sent, on the same engine: "only the UI differs" holds. On their path the change is the bridge's `query` taking one more argument (undefined) and an empty await before each of a query's slices, the same on both sides. The engine's decision: its `docs/DECISIONS.md`, "Engine and bridge", 2026-11-27. No fixture changed.

Its wasm effect at the base level, release, wasm-opt with the apps' flags, brotli 11, the crate built alone at `ad3b0a8` and on the working tree with this change, each with a target of its own, on Apple M1, machine `local`:

| Before | After | Change |
|---|---|---|
| 10,144,218 bytes after wasm-opt, 2,783.6 KiB brotli | 10,144,261 bytes, 2,784.7 KiB brotli | +43 bytes after wasm-opt (the bridge's extra argument); +1.1 KiB brotli, mostly its swing |

`just observatory check` passes on the working tree: lint, the builds, `sizes --check`, `tanstack-sizes --check`, `cold --check` at every GPUI level (median TTFP 154–162 ms, each under its limit; wasm 2,783–2,808 KiB), the level checks, `placeholder`, `reach`, `engine-files --controls`, the TanStack checks, `page --check`, and `fixtures`. Its first run failed `tail`'s clock drift (a clock message 2.25 rows off, the limit 2); run again twice alone it read 1.05 and 0.95, so a busy machine's, not the change's. The recipe's steps after `tail` were run on their own after it, and passed. On the way, `lint` failed on `HEAD` as on the working tree: the engine's `view.rs` expected `Ordered` to be dead code without `sort`, which it isn't (`set_order` reads its fields); the expectation was dropped from the struct, its methods' kept.

Tycho's own measurements of the change: Tycho's `docs/DECISIONS.md`, "Scope", 2026-11-27, and the engine's, "Engine and bridge", 2026-11-27.
