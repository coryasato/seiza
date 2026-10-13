# duckdb

DuckDB-Wasm for seiza's apps: the database runs in a Web Worker, behind a three-call bridge, and its results reach Rust as Arrow IPC bytes. An engine (root `CLAUDE.md`, "Tiers"): `crate/` is the Rust client (`seiza-duckdb`), `web/` the npm package (`@seiza/duckdb`).

---

This is the DuckDB engine's context. Why it's built this way is in `docs/DECISIONS.md`; what it offers its users, in `README.md`. Its work is a milestone in the app that drives it (Tycho, `apps/tycho/PLAN.md`), measured in that app's `perf/`. The repo-wide rules in the root `CLAUDE.md` apply here too. Paths below are relative to this directory.

Current state only: say what to do and point to the decision behind it (`docs/DECISIONS.md`, "Engine and bridge"); don't retell its measurements.

## Rules

These add to the repo-wide rules.

1. **No app knowledge and no `seiza` dependency.** Report what happened through `EngineEvent`s and `EngineStatus`; the host turns them into panel rows and marks. `web/` names no app; what only a host knows (what its server's refusal means) comes in as an option (`createBridge({ refusal })`).
2. **Keep the bridge narrow.** Only three calls cross the Rust ↔ JS boundary:
   - `register_file(name, source) -> FileInfo`, where `source` is a dropped `File` or an HTTP URL
   - `query(sql, request_id) -> ArrowIpcBytes`
   - `cancel(request_id)`

   Get schema, row count, and metadata with SQL through `query`. Don't add a fourth bridge call without writing down the decision here and in `docs/DECISIONS.md`. The engine loads on the first call; `start`'s warm-up query (`SELECT 42 AS x`) is what starts it, and the host calls `start` after first paint. A load that fails is forgotten, and so is an engine whose worker stopped once a call has been rejected with `EngineStopped`; the next call starts a new one. Rust's `Engine` refuses calls while it's down (`EngineStatus::Failed`/`Stopped`), so that next call is always `retry`'s warm-up, and it watches every call's answer for `EngineStopped` even when nobody awaits it (`Engine::watch`). A failed engine-chunk import is retried under `?retry=<n>`: Chromium remembers a failed dynamic import. `FileInfo` carries `bytesRead`, a live counter (a `SharedArrayBuffer` that DuckDB's worker wrapper adds to as it reads; Rust reads it with `Atomics.load`), so a host's "read X of Y" isn't a fourth call.
3. **Self-host everything.** The DuckDB bundles and extensions come from the host's own origin, never jsDelivr or extensions.duckdb.org, so they work under COEP and load time doesn't depend on a third party. Extensions are pinned by version and SHA-256 in `web/duckdb-extensions.json`; bump them with DuckDB-Wasm.
4. **One `LOAD` at a time, and no autoload.** Rust loads Parquet with one explicit `LOAD` (`Engine::load_parquet`), which every Parquet query waits for; a new extension needs the same.

## Architecture

- **`web/src/bridge.ts`** (`@seiza/duckdb/bridge`): `createBridge(options)` returns the three calls. It loads nothing; the first call imports `engine.ts` (a chunk of its own), so DuckDB's JS, worker, and wasm are all requests that start after first paint.
- **`web/src/engine.ts`**: DuckDB-Wasm itself. Bundle choice (EH or MVP by `selectBundle`; not COI), the worker (DuckDB's prebuilt script inside a small blob: classic worker that reports unhandled rejections as errors and counts reads per registered file: sync XHRs for a URL, `FileReaderSync` slices for a `File`), one connection per query on the pending-query API (`cancel` lands between poll slices), and range-only HTTP reads (`RANGE_READS_ONLY`: with DuckDB-Wasm's defaults, a URL is downloaded whole). Every call races the worker's `error` event. Marks `duckdb:engine-start` and `duckdb:engine-ready`.
- **`web/src/vite.ts`** (`@seiza/duckdb/vite`): `duckdb()`, the plugin a Vite host adds: a missing extension under `/duckdb-ext/` is a 404, not the SPA fallback. A host's production server needs the same rule. **`web/scripts/extensions.ts <public dir>`** downloads the pinned extensions into the host's `public/duckdb-ext/`.
- **`crate/src/lib.rs`**: `EngineStatus` (a global: Loading, Ready, Failed, Stopped), `EngineError` (`is_read_failure` tells a failed file read, which registering again under a new name can fix, from the rest), and `EngineEvent` (Loading, Ready, Failed, ParquetReady, ParquetFailed, with their times in ms from `timeOrigin`).
- **`crate/src/bridge.rs`** (web only): `init(cx, bridge)` installs the `Engine` global; `start(cx, on_event)` runs the warm-up, sets `EngineStatus`, then prefetches the Parquet extension; `retry(cx)` starts a new engine after a failure, reporting to the same handler. `Engine` has `query` (returns its `RequestId` and its decoded result), `cancel`, `register_file`, and `load_parquet`. `ReadCounter` reads a file's live byte count.
- **`crate/src/arrow.rs`**: the hand-rolled Arrow IPC stream reader (arrow-rs cost +127 KiB brotli). It reads the flatbuffer metadata by hand and decodes cells on access; unsupported types decode as a named placeholder column. New column types go here, with a test.

## DuckDB-Wasm 1.32.0 gotchas (check before debugging)

Each was found in Tycho, and the paths to what handles it there are under `apps/tycho/`.

- **A started page read can't be cancelled.** DuckDB's worker reads over HTTP with synchronous XHRs, and `cancel` lands between query slices. A cancelled query still occupies the worker until it answers. So Tycho's page cache counts cancelled requests as in flight until they answer (`PageCache::draining`), and a scrollbar drag loads only when the pointer rests (`DRAG_SETTLE`).
- **Every page read costs at least ~1.39 MB.** The HTTP readahead (`WebFileSystem`'s `ReadAheadBuffer`) reads 16 KB, 64 KB, 256 KB, 1 MB, then 4 MB and 16 MB while the reads stay sequential, so a page read stops at the step that covers its row group: 1.39 MB for the asteroids' 0.7 MB groups, 5.59 MB for Gaia's 3.8 MB groups (at 30,720 or 61,440 rows), 22.4 MB from 122,880. No `db.open` option or Parquet setting changes it (`useDirectIO` and `disable_parquet_prefetching` were tested). On Fast 4G that's four round trips, ~2.1 s per page for the asteroids. It's also why "first rows under 2% of the file" can't hold for the 38 MB sample.
- **Two failing loads of one extension at once crash the worker** ("table index is out of bounds"), with no worker `error` event, and every later query hangs. That's why autoload is off and `Engine::load_parquet` runs one attempt at a time.
- **With default settings, a URL is downloaded whole** (`RANGE_READS_ONLY` in `web/src/engine.ts`). The server must answer a ranged `HEAD` with 206.
- **A `file_row_number` filter doesn't prune row groups.** DuckDB 1.4 sets up every row group's column readers for each page query, so a page costs ~0.4 ms per row group (19 columns) in the worker, whatever its size: 50 ms on the 52-group sample, ~540 ms on a 1 GB file with 1,378 groups, ~120 ms on the same file at 345 groups. Native DuckDB 1.4.5 scales the same way (`apps/tycho/perf/results/2026-09-27-m5.md`). Gaia's 11 columns cost ~0.16–0.2 ms a group: 166 ms a page at 817 groups, 68 ms at 409 (its 61,440-row groups), 34 ms at 205.
- **The Parquet metadata cache is off by default, and `SET` is per connection.** Every query has its own connection, so the cache is set with `SET GLOBAL parquet_metadata_cache = true`, right after `LOAD parquet` (`Engine::load_parquet`). Without it, every query re-parses the footer (~165 ms at 1,378 row groups).
- **`sniff_csv` reads only the file's head** (20,480 rows). With no quotes in it, it picks *no* quote, and a quoted comma or newline later breaks the parse; its types can be wrong later too (the asteroids' `pdes` is numeric for 895,910 rows). Tycho's `csv.rs` forces `"` and widens on a conversion error, whose message names the column (`Error when converting column "pdes"`). Its `Quote`/`Escape`/`Comment` fields read as the text `(empty)`, and `NewLineDelimiter` is escaped text (`\n`).
- **Appending to one growing table stalls.** INSERTs of 4–8 MiB chunks into one table took 200–600 ms every few chunks, inside DuckDB (not parsing, not GC, not memory growth), and small appends cost memory (1.2 GB for 1 GB at 4 MiB). One `CREATE TABLE AS` per chunk never passed ~255 ms.
- **In-memory tables aren't compressed** unless the database is attached with `(COMPRESS)`: 1 GB of CSV took 2.1 GiB of DuckDB memory in plain per-chunk tables, 300 MiB compressed.
- **A query sent during a `CREATE TABLE … AS` waits for it**, rather than round-robining: a page read during a CSV load waits up to one chunk (so Tycho's chunks aim at 200 ms).
- **Queries run round-robin.** DuckDB-Wasm runs one query slice at a time across all pending queries, so two 500 ms queries both finish at ~1 s. That's why Tycho's prefetch waits for the visible pages.
- **A failed HTTP range read breaks that file's name for good.** After one read fails (the network dropped), every later read of those bytes under that SQL name fails with "TProtocolException: Invalid data", online or not, even after registering the URL again under the same name, and with `enable_external_file_cache` off. Registering it under a new name reads fine (`EngineError::is_read_failure` tells these apart). That's why Tycho's workbench re-registers under `<name>-r<n>.parquet`.
- **Past ~2.1 GiB of in-memory tables, `CREATE TABLE … AS` stores nothing and says nothing.** `memory_limit` is 3.1 GiB, but at ~2.1 GiB of tables (an 8.6 GB CSV, chunk 848 of 988) each chunk's table came back empty with a normal answer, until one finally errored (or never did). Hence Tycho's `csv::MEMORY_BUDGET` and its empty-chunk check.
- **Nothing frees a parsed Parquet footer.** `db.dropFile` after the next open, and `SET GLOBAL parquet_metadata_cache = false` then `true`, left DuckDB's memory exactly where keeping the file did: +2.2 MiB per open of a 1,378-group file (~16 MiB per open across the tab; `apps/tycho/perf/results/2026-10-08-m7-footers.json`). A documented cost; files stay registered.
- **The worker takes messages in order, so cancelled reads can't leak into the next open.** A cancelled query's queued poll still runs (and reads) before the next open's register message, so its bytes land on the old file's read counter, never the new one, even when the new open reuses the counter's key (same URL, or the same dropped file). Waiting for them before an open changed neither "Read" nor first rows (checked with a negative control).
- **A stopped worker rejects only the calls made after it stopped.** With nothing in flight, the host learns at its next query (a scroll, an open). Scripts that kill the worker (`page.workers()`, throw in a `setTimeout`) must then make a call, e.g. press End.
- **Playwright doesn't see DuckDB's requests** (sync XHRs inside its worker). Count `/data/` bytes at the server: `shared-web/perf/serve.ts`'s counting proxy, which Tycho's `perf/harness.ts` (`serveTycho`) puts in front of `wrangler dev`.

## Layout

```
engines/duckdb/
  crate/            # seiza-duckdb: src/lib.rs (status, errors, events), bridge.rs (the client; web only), arrow.rs (Arrow IPC reader)
  web/              # @seiza/duckdb: src/bridge.ts, engine.ts, vite.ts, extensions.ts; duckdb-extensions.json + scripts/extensions.ts
  docs/             # DECISIONS.md
  README.md         # for the crate's and the package's user
  CLAUDE.md         # this file
```

## Tests

```
cargo test -p seiza-duckdb   # native tests: the Arrow reader, read-failure errors
```

The client itself runs only in a browser: Tycho's `just tycho engine` (the self-test: `SELECT 42`, every shown type, cancel) and `just tycho errors` (failed load, stopped worker, Retry) check it end to end.
