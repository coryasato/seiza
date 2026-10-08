# M7 part D: hardening (2026-10-08)

Machine: Apple M1, macOS (label `local`), Chromium headless=new, 1440×900 at DPR 2, release build. Machine load 4–6 during the session (the machine's usual; see the TTFP note).

Scripts: `perf/hardening.ts` (experiments: footers, ceiling, wheel-end, csv-scan) and `perf/errors.ts` (the error-state checks). Test files from `just tycho drop-files` (data/drop/, recorded in `data/MANIFEST.json`).

## Size ceiling (check 5)

One file per fresh browser: drop, first rows, End (the last row), then memory: DuckDB's own (`duckdb_memory()`) and every agent's (`measureUserAgentSpecificMemory`, after a GC). Raw: `2026-10-08-m7-ceiling.json`, `-ceiling-past-4gib.json`, `-ceiling-parquet-9gb.json`.

| File | Bytes | Rows | Row groups | First rows | End | DuckDB | Every agent |
|---|---|---|---|---|---|---|---|
| Parquet ×27 | 0.96 GB | 42.3 M | 345 | 438 ms | 197 ms | 0.8 MiB | 105 MiB |
| Parquet ×60 | 2.13 GB | 94.1 M | 766 | 443 ms | 283 ms | 1.4 MiB | 111 MiB |
| Parquet ×120 | 4.26 GB | 188.1 M | 1,531 | 1008 ms | 897 ms | 2.6 MiB | 118 MiB |
| Parquet ×130 | 4.62 GB (> 2³²) | 203.8 M | 1,659 | 1053 ms | 799 ms | 2.8 MiB | 126 MiB |
| Parquet ×270 | 9.59 GB | 423.2 M | 3,445 | 3500 ms | 3065 ms | 5.6 MiB | 147 MiB |
| CSV ×6 | 1.07 GB | 9.4 M | — | 191 ms | 91 ms | 298 MiB | 570 MiB |
| CSV ×12 | 2.14 GB | 18.8 M | — | 206 ms | 101 ms | 610 MiB | 864 MiB |
| CSV ×24 | 4.29 GB | 37.6 M | — | 184 ms | 147 ms | 1212 MiB | 1435 MiB |
| CSV ×30 | 5.36 GB (> 2³²) | 47.0 M | — | 203 ms | 82 ms | 1508 MiB | 1815 MiB |
| CSV ×48 | 8.57 GB | 75.2 M | — | 193 ms | 91 ms | 2124 MiB | 2500 MiB |
| CSV ×60 | 10.71 GB | 94.1 M | — | 179 ms | 88 ms | 2111 MiB | 2421 MiB |

(Every Parquet file here has DuckDB's default 122,880-row groups, as a visitor's file most likely would; ×27 is `asteroids-x27-rg122880.parquet`.)

- **Parquet doesn't touch memory; time grows with row groups.** Past 2³² bytes works. At 3,445 row groups first rows take 3.5 s (~0.9 ms per group per page, in line with M5's per-group cost).
- **CSV loses rows silently past ~2.1 GiB.** ×48 and ×60 both reported "done" with 66.4 M and 66.0 M rows shown, of 75.2 M and 94.1 M. A probe run of ×48: DuckDB's `memory_limit` is 3.1 GiB; from chunk 848, 57 chunks' `CREATE TABLE … AS` answered normally with empty tables (in-memory tables at 2165 MiB), then chunk 988 errored. The other run never errored.
- **Compression varies:** the asteroid CSV takes 0.28 bytes of memory per byte of file; `random-hex.csv` (random hex strings) 0.47.

**Enforced (`crate/src/limits.rs`, `csv::MEMORY_BUDGET`):** Parquet over 10 GB and CSV over 6 GB are refused before anything is read. A CSV load checks DuckDB's memory after every chunk and stops at 1.5 GiB, keeping the rows before it; a chunk of bytes that becomes no rows stops it too. With the guard:
- CSV ×30 (5.36 GB): loads whole, 47,025,930 rows, 645 chunks, 1497 MiB of tables, no empty chunk.
- `random-hex.csv` (4.59 GB, 50 M rows): stops at 3.16 GB, 34,414,883 rows (69%), 1542 MiB, no empty chunk; the header says why.
- CSV ×48 (8.57 GB): refused at the drop.
- The 1 GB CSV's load is unchanged by the per-chunk memory query: 16.2 s, 66.3 MB/s, update gap max 217 ms (`2026-10-08-m7-d-csv.json`; 66.1 MB/s before the guard in the ceiling run, 69.5 in M6 under less load).

## Footer pile-up

The 1 GB Parquet file (1,378 row groups) dropped 20 times, each under a new SQL name, as the app does. `2026-10-08-m7-footers.json`.

| Opens | DuckDB, keep | DuckDB, `dropFile` the last | DuckDB, `SET GLOBAL parquet_metadata_cache` off/on | Every agent, keep / drop / SQL |
|---|---|---|---|---|
| 1 | 2.2 MiB | 2.2 | 2.2 | 130.6 / 110.8 / 110.8 MiB |
| 10 | 22.1 | 22.1 | 22.1 | 269.6 / 249.9 / 249.9 |
| 20 | 44.2 | 44.2 | 44.2 | 454.9 / 435.1 / 435.1 |

Neither unregistering nor the SQL toggle frees anything (the drop variant ran on an experiment build, `?dropfiles`, since removed). Decision: no change to `registerFile`; a documented cost of ~16 MiB per open of such a file across the tab, ~250 opens before 4 GB.

## Engine and network errors

`perf/errors.ts`, all checks pass (nine after the code review below) (`2026-10-08-m7-errors.json`; three consecutive full runs pass after the fixes below, and check 4 alone 4/4):

1. DuckDB's wasm blocked: "The engine didn't load: … Retry loads it again", sample buttons disabled, a dropped file refused without starting an engine; unblocked, Retry loads it and the sample opens.
2. DuckDB's worker throws with the sample open: at the next read (End) the file closes, "The engine stopped while asteroids.parquet was open…", **no engine starts before Retry**, and Retry starts one; the sample opens and pages to its end.
3. `/data/` blocked: "Couldn't open the sample: the network request failed. Check the connection, then try again"; unblocked, the same click opens it.
4. `/data/` blocked mid-session: End's rows show their error; unblocked, the rows in view load **with no input in 5.1 s**, and Home and End load.
5. The 1 GB file reopened while End's reads drain: "Read" 5.2 MiB, as a fresh open's. The reopen's first rows: 1226–1293 ms against 796–828 fresh (the drained reads run first).
6. Sparse files just over the limits (10 GB Parquet, 6 GB CSV): refused with their message, over the empty state and over an open file, which stays.
7. The open panel `[1015, 219.5, 384, 639.5]` is clear of the vertical thumb at the bottom `[1407, 843, 16, 24]`; dragging it to the top scrolls there.

Found on the way:
- **A failed range read breaks the file's SQL name for good** (check 4's first runs). Every later read of those bytes fails with "TProtocolException: Invalid data", online, with `enable_external_file_cache` off, and after registering the URL again under the same name. A new name reads fine. The workbench re-registers under `<name>-r<n>.parquet`, waiting 5 s, then 10, 20, 40, 60 between tries.
- **A stray call restarted a stopped engine unseen** (check 2): the bridge forgot the dead engine at once, so End's read started a new one, without Parquet loaded. The bridge now forgets it only after rejecting a call with `EngineStopped`, and Rust refuses calls while the engine is down.
- **Retry first sat under the panel**, after a long status line. It's now first in the centered button row.

**Negative control for check 5:** with the open's wait for draining reads removed (`idle()` resolving at once), check 5 still passed, with the same Read and the same first rows (1236 ms; `2026-10-08-m7-errors-control-no-idle.json`). DuckDB's worker takes messages in order, and every queued poll of a cancelled query was posted before the new open's counter and register messages, so those reads land on the old counter. The wait bought nothing and was removed; the check stays as a regression check on Read.

## Code review fixes (same day)

`/code-review high` found ten issues; nine were fixed, and one was declined (the per-chunk memory query is on the ingest's path, but the 1 GB CSV loaded at 66.3 MB/s with it and 66.1 without).
- **A stopped engine could still restart unseen:** Rust learned of the stop only from a call whose future someone still awaited, and an open replaced mid-flight drops its futures. Every call's answer is now watched for `EngineStopped` whether or not anyone awaits it (`Engine::watch`). New check 2b (the worker dies under an open, a second drop replaces it: no engine starts before Retry) passes, **but so does its negative control** (`2026-10-08-m7-errors-control-no-watch.json`, 3 of 3): in that sequence the stop still reaches Rust through an awaited call. The fix rests on the code path, not on a check that fails without it.
- **A failed engine chunk couldn't be retried:** Chromium remembers a failed dynamic import, and Retry failed at once without a request (new check 1, engine chunk blocked: failed before the fix). The bridge now imports the chunk again under `?retry=<n>`, taking its URL from the error (Chromium and Firefox name it; Safari falls back to the plain import). Passes.
- **Re-registration only for read failures** (`EngineError::is_read_failure`: "Range request for", "TProtocolException", `NotReadableError`, `NotFoundError`), not for query, decode, or stopped-engine errors; and only while the table is still shown, still has failed reads, and the engine runs. A success cancels a retry already scheduled.
- **An empty chunk counts as out of memory only above 1 GiB of DuckDB memory**, so a block of comment or blank lines can't stop a load.
- **The status line blames a file only when the engine stopped under it** (`Load::Failed { engine_stopped }`).
- **A retry's waterfall step starts at the retry**, not at an earlier attempt's mark.
- **`?scan_kib=` removed** with the experiment that needed it.

After the fixes: `just tycho errors` 9/9, `just tycho csv --reference-only` all ok (16.3 s, Firefox included). `just tycho check` read 203.0 and 203.2 ms (FAIL, over 195.0) under load 6; an interleaved A/B against HEAD (d126f6c, built in a worktree), 4 rounds × 5 reference runs each, under load 8–16, read **this change 195.1 / 190.6 / 191.9 / 195.1 ms against HEAD 197.3 / 199.5 / 206.0 / 207.4 ms**: no regression, the machine. App wasm 2804.4 KiB (HEAD 2799.2 KiB brotli, +5.2).

## Wheel against the table's end

`2026-10-08-m7-wheel-end.json`, asteroids, 120 wheel events over ~6 s:

| Case | Frames drawn | Work p50 / p95 |
|---|---|---|
| Panel closed, still at the end | 0 | — |
| Panel closed, wheeling at the end | 0 | — |
| Panel closed, wheeling from the top | 121 | 10.8 / 13.1 ms |
| Panel open, still at the end (2.1 s) | 9 | 17.5 / 22.6 ms |
| Panel open, wheeling at the end (6.2 s) | 23 | 19.8 / 24.6 ms |

The wheel at the end draws nothing; part B's ~22 ms draws were the open panel's 4 Hz refreshes, each a whole-window redraw. No fix; recorded in the README.

## CSV scanner window vs the fling during a load

Throttled (CPU 4×, Fast 4G), 1 GB CSV, a 3 s fling while it loads, then the same fling once loaded; 5 interleaved runs per window. `2026-10-08-m7-csv-scan.json`, medians:

| Window | Loading: interval p95 / max | Work p50 / p95 | Long tasks (> 50 ms) | Loaded: interval p95 / work p95 | Ingest |
|---|---|---|---|---|---|
| 1024 KiB | 50.0 / 50.0 ms | 40.8 / 49.7 ms | 4, longest 56 ms | 33.3 / 38.5 ms | 22.1 s |
| 256 KiB | 50.0 / 50.0 | 41.4 / 50.6 | 5, longest 55 | 33.3 / 39.1 | 24.1 s |
| 64 KiB | 50.0 / 50.0 | 40.9 / 49.3 | 4, longest 54 | 33.3 / 37.8 | 34.7 s |

The window changes nothing a fling feels, and a smaller one slows the load (+57% at 64 KiB). The long tasks are frames: a frame's own work is ~50 ms at p95 during the load and ~38 ms after it. The scanner stays at 1 MiB. What adds ~10 ms per frame during the load is not found; carried.

## Size and first paint

App wasm **2805.7 KiB** brotli at first, +6.4 KiB (2799.3 in part C); 2804.4 KiB after the review fixes: engine states and Retry, the CSV budget, the size limits, re-registration, and the panel clearance (`shared/`, Tycho is its only app). `just tycho check`: **PASS**, TTFP 193.1 ms (min 184.9, max 216.3) against the 195.0 limit, under load 4–6; no interleaved A/B this time (the change is 6.4 KiB, none of it before first paint's code paths).
