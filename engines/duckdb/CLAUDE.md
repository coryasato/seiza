# duckdb

DuckDB-Wasm for seiza's apps: the database runs in a Web Worker, behind a three-call bridge, and its results reach Rust as Arrow IPC bytes. An engine (root `CLAUDE.md`, "Tiers"): `crate/` is the Rust client (`seiza-duckdb`), `web/` the npm package (`@seiza/duckdb`).

---

The engine's context; the root `CLAUDE.md`'s rules apply too. Its API is in `README.md`, why it's built this way in `docs/DECISIONS.md` ("Engine and bridge", "Table source"). Its work is a milestone in the app that drives it (Tycho, or the observatory, which only consumes it), measured in that app's `perf/`. Paths are relative to this directory.

## Rules

1. **No app knowledge and no `seiza` dependency.** Report through `EngineEvent`s and `EngineStatus`; the host turns them into panel rows and marks. What only a host knows (what its server's refusal means, where it serves the extensions) comes in as an option (`createBridge({ refusal, extensionDir, extensionBase })`).
2. **Keep the bridge narrow.** Only three calls cross the Rust ↔ JS boundary:
   - `register_file(name, source) -> FileInfo`, where `source` is a dropped `File` or an HTTP URL
   - `query(sql, request_id) -> ArrowIpcBytes`
   - `cancel(request_id)`

   Get schema, row count, and metadata with SQL through `query`; a file's live read count rides on `FileInfo.bytesRead` (a shared `BigInt64Array`; null for a `Blob` that isn't a `File`, such as a CSV chunk). A host must be cross-origin isolated (COOP/COEP) for it. Don't add a fourth call without writing the decision here and in `docs/DECISIONS.md`.
3. **Nothing loads before the first call.** `bridge.ts` imports `engine.ts` (its own chunk) on the first call; `start`'s warm-up (`SELECT 42 AS x`) is that call, and the host calls `start` after first paint.
4. **A down engine is replaced, never reused.** A failed load is forgotten, and so is a stopped worker once a call is rejected with `EngineStopped`. Rust's `Engine` refuses calls while it's `Failed`/`Stopped`, so the next engine is always started by `retry`'s warm-up, and it watches every call's answer for `EngineStopped` even when nobody awaits it (`Engine::watch`). A failed engine-chunk import is retried under `?retry=<n>`: Chromium remembers a failed dynamic import. One exception: a lockdown that failed leaves its worker up (rule 9).
5. **Every engine call races the worker's `error` event,** so a dying worker rejects its calls instead of leaving them pending.
6. **Self-host everything.** DuckDB's bundles and extensions come from the host's own origin, never jsDelivr or extensions.duckdb.org (COEP, and no third party in the load time). Extensions are pinned by version and SHA-256 in `web/duckdb-extensions.json`; bump them with DuckDB-Wasm.
7. **A missing extension is a 404, not the SPA fallback,** on every server that serves them: `duckdb()` does it in Vite under `<base><extensionDir>/` only; a host's production server, and a host that names its own `extensionBase` (the observatory's contenders: `shared-web`'s `serveDirs`), do it themselves. `extensionDir` is one directory name, the same for the bridge, the plugin, and `scripts/extensions.ts` (`src/extensions.ts` checks it).
8. **One `LOAD` at a time, and no autoload.** Parquet loads through one explicit `LOAD` (`Engine::load_parquet`), which every Parquet query waits for; a new extension needs the same, and loads before a host's lockdown (rule 9), which refuses `LOAD`.
9. **A lockdown is the host's to ask for, and `Ready` waits for it.** `start_locked` runs the `Lockdown`'s steps after the Parquet extension loads; only then is `EngineStatus::Ready` set. A failed step makes it `Failed` on a worker that's still up, and `retry` runs on from the step that failed (`Engine::locked_steps`, reset with a new worker). Never report an unlocked engine ready to a host that asked for one, and keep `start`'s path (the observatory's) sending what it sent. What's refused once locked, and what isn't: `README.md`, "Limits"; why: `docs/DECISIONS.md`.

## Files

- `web/src/bridge.ts` (`@seiza/duckdb/bridge`): `createBridge`, the three calls (rule 3).
- `web/src/engine.ts`: DuckDB-Wasm: the bundle, the blob worker wrapper (rejections as errors, per-file read counts), a connection per query on the pending-query API, `RANGE_READS_ONLY`. Marks `duckdb:engine-start` and `duckdb:engine-ready`.
- `web/src/vite.ts` (`@seiza/duckdb/vite`): the `duckdb()` plugin. `web/scripts/extensions.ts <public dir> [<extensionDir>]` fetches the pinned extensions.
- `crate/src/lib.rs`: `EngineStatus`, `EngineError`, `EngineEvent`, `Lockdown` (its statements, tested natively). `bridge.rs` (web only): `init`, `start`, `start_locked`, `retry`, `Engine`, `ReadCounter`. `sql.rs`: `ColumnInfo` and SQL helpers.
- `crate/src/tall_table.rs` (feature `tall-table`): the `seiza-tall-table` source (`QueryRows`, `ParquetFile`, `open_parquet`). It knows no app: Tycho's CSV source is a `PageQuery` of its own.
- `crate/src/arrow.rs`: the hand-rolled Arrow IPC reader (not arrow-rs: `docs/DECISIONS.md`); unsupported types decode as a named placeholder column. New column types go here, with a test.

## DuckDB-Wasm 1.32.0 gotchas (check before debugging)

Each was found in Tycho; its paths are under `apps/tycho/`.

- **A started page read can't be canceled.** The worker reads over HTTP with synchronous XHRs and `cancel` lands between query slices, so a canceled query holds the worker until it answers. Hence the tall table's `PageCache::draining` and `Paging::drag_settle` (`components/tall-table/`).
- **Every page read costs at least ~1.39 MB.** The HTTP readahead (`WebFileSystem`'s `ReadAheadBuffer`) steps 16 KB, 64 KB, 256 KB, 1 MB, 4 MB, 16 MB while reads stay sequential, so a page read stops at the step that covers its row group (1.39 MB for 0.7 MB groups). No `db.open` option or Parquet setting changes it (`useDirectIO` and `disable_parquet_prefetching` were tried).
- **Two failing loads of one extension at once crash the worker** ("table index is out of bounds"), with no worker `error` event; every later query hangs. Hence rule 8.
- **With default settings, a URL is downloaded whole** (hence `RANGE_READS_ONLY`). The server must answer a ranged `HEAD` with 206.
- **A `file_row_number` filter doesn't prune row groups.** DuckDB 1.4 sets up every row group's readers for each page query: ~0.4 ms per row group at 19 columns (~540 ms a page at 1,378 groups), ~0.16–0.2 ms at Gaia's 11, whatever the page's size. Native DuckDB 1.4.5 scales the same (`apps/tycho/perf/results/2026-09-27-m5.md`).
- **The Parquet metadata cache is off by default, and `SET` is per connection.** Every query has its own, so `Engine::load_parquet` runs `SET GLOBAL parquet_metadata_cache = true` right after `LOAD parquet`; without it every query re-parses the footer.
- **`sniff_csv` reads only the file's head** (20,480 rows). With no quotes there it picks *no* quote, so a later quoted comma or newline breaks the parse, and its types can be wrong later too. Tycho's `csv.rs` forces `"` and widens on a conversion error, whose message names the column (`Error when converting column "pdes"`). Its `Quote`/`Escape`/`Comment` read as the text `(empty)`; `NewLineDelimiter` is escaped text (`\n`).
- **Appending to one growing table stalls** (hundreds of ms every few chunks, inside DuckDB) and small appends cost memory. One `CREATE TABLE AS` per chunk never passed ~255 ms (its memory: next gotcha).
- **In-memory tables aren't compressed** unless the database is attached with `(COMPRESS)` (about 7× the memory without).
- **A query sent during a `CREATE TABLE … AS` waits for it** rather than round-robining, so a page read during a CSV load waits up to a chunk (Tycho's chunks aim at 200 ms).
- **Queries run round-robin,** one slice at a time across all pending ones: two 500 ms queries both finish at ~1 s. Hence Tycho's prefetch waits for the visible pages.
- **A failed HTTP range read breaks that file's SQL name for good:** every later read of those bytes under it fails ("TProtocolException: Invalid data"), online or not, even registered again under the same name or with `enable_external_file_cache` off. A new name reads fine (`EngineError::is_read_failure`), hence Tycho's `<name>-r<n>.parquet`.
- **Past ~2.1 GiB of in-memory tables, `CREATE TABLE … AS` stores nothing and says nothing** (`memory_limit` is 3.1 GiB): each chunk's table comes back empty with a normal answer. Hence Tycho's `csv::MEMORY_BUDGET` and its empty-chunk check.
- **Nothing frees a parsed Parquet footer:** neither `db.dropFile` nor toggling `parquet_metadata_cache` (~2.2 MiB per open of a 1,378-group file; `apps/tycho/perf/results/2026-10-08-m7-footers.json`). Files stay registered; it's a documented cost.
- **The worker takes messages in order,** so a canceled query's reads land on the old file's read counter, never the next open's, even under the same key; an open needn't wait for them (`docs/DECISIONS.md`, "Engine and bridge").
- **A stopped worker rejects only the calls made after it stopped,** so with nothing in flight the host learns at its next call. A script that kills the worker (`page.workers()`, a throw in a `setTimeout`) must then make one (press End, say).
- **Playwright doesn't see DuckDB's requests** (sync XHRs in its worker). Count `/data/` bytes at the server: `shared-web/perf/serve.ts`'s counting proxy (`serveApp`'s `data`), in front of the app's data server.

## Tests

```
cargo test -p seiza-duckdb --all-features   # native: the Arrow reader, errors, SQL helpers, the table source, the tall table's SQL fixture
```

The SQL fixture (`components/tall-table/fixtures/sql.json`) pins, as text, the page SQL and summary queries a contender sends; its test is here, where the SQL is written. A change to `ParquetFile::page_sql` or `summary_queries` fails it: update the fixture in the same change.

The client runs only in a browser. Tycho's `perf/lockdown.ts` checks the lockdown end to end in three browsers (what a locked engine refuses and reads, a failed `LOAD` and its Retry); nothing yet checks its self-test (`?selftest` in Tycho) or a failed load and a stopped worker, which Tycho's rebuild checks again (its `PLAN.md`). The observatory's GPUI contender reads every page through it.
