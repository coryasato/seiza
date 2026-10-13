# duckdb

DuckDB-Wasm for GPUI apps on the web: a Rust client (`seiza-duckdb`) that sends SQL and reads the answers as Arrow, and a JS package (`@seiza/duckdb`) that runs DuckDB in a Web Worker behind three calls. It's built to stay off the first-paint path: nothing loads until the first call, and everything is served from the host's own origin.

**Used by:** [Tycho](../../apps/tycho/). **Crate:** `seiza-duckdb`. **Package:** `@seiza/duckdb` (an npm workspace; not published).

## Use it

The JS host creates the bridge and hands it to its wasm:

```ts
import { createBridge } from '@seiza/duckdb/bridge';

const bridge = createBridge(); // loads nothing yet
start(fontBytes, bridge);      // your wasm-bindgen entry point
```

Its Vite config adds the plugin, and its build fills `public/duckdb-ext/` with the pinned extensions:

```ts
import { duckdb } from '@seiza/duckdb/vite';
export default defineConfig({ plugins: [duckdb()] /* + COOP/COEP headers */ });
```

```sh
node engines/duckdb/web/scripts/extensions.ts <host>/web/public
```

The Rust side installs the engine, starts it after first paint, and queries it:

```rust
seiza_duckdb::init(cx, bridge);                  // at startup: the Engine global, EngineStatus::Loading
seiza_duckdb::start(cx, |event, cx| { /* … */ }); // after first paint: warm-up, then the Parquet prefetch

let engine = cx.global::<seiza_duckdb::Engine>().clone();
let (id, result) = engine.query("SELECT count(*) FROM 'a.parquet'");
// engine.cancel(id) stops it; `result` resolves to an arrow::QueryResult or an EngineError.
```

**Rust (`seiza-duckdb`):**

- `init(cx, bridge)`: installs the `Engine` and `EngineStatus` globals.
- `start(cx, on_event)`: starts the engine (call it after first paint). `on_event` hears each `EngineEvent`: `Loading`, `Ready`, `Failed`, `ParquetReady`, `ParquetFailed`, each with its times in ms from `performance.timeOrigin`, for the host's load steps and marks.
- `retry(cx)`: starts a new engine after `EngineStatus::Failed` or `Stopped`. Calls fail without reaching the bridge until then.
- `Engine::query(sql)`: sends now; returns its `RequestId` and a future of the decoded result. `Engine::cancel(id)` stops it.
- `Engine::register_file(name, FileSource::File | Url)`: makes a dropped file or a same-origin URL readable from SQL as `name`. Its `FileInfo` carries the size and a live `ReadCounter`.
- `Engine::load_parquet()`: loads the Parquet extension, or joins the load running. Every Parquet query waits for it.
- `EngineError::is_read_failure()`: whether registering the file again under a new name could fix the error.
- `arrow::decode(bytes)`: the Arrow IPC reader, for null, bool, ints, floats, decimal128, utf8, binary, dates, times, and timestamps; any other type decodes as a column that shows its type name.
- `sql`: `ColumnInfo` (a column's name and DuckDB type), `string_literal`, and typed reads of metadata results (`column`, `text`, `count`).

**The `table` feature** makes DuckDB a [`seiza-table`](../../components/table/) source (in the browser; natively there's no engine, so `QueryRows::new` takes only the query and every page fails):

```rust
use seiza_duckdb::table::{ParquetFile, QueryRows};

let (summary, read_counter) =
    seiza_duckdb::table::open_parquet(&engine, "file-1.parquet", source, &["my.credit"], |_| {}).await?;
let columns = summary.columns.iter().map(ColumnInfo::table_column).collect();
let state = cx.new(|cx| {
    TableState::new(QueryRows::new(engine, ParquetFile::new("file-1.parquet")), columns, summary.rows, Paging::default(), cx)
});
```

- `QueryRows<Q: PageQuery>`: a `TableDelegate` that reads each page with `Q::page_sql(rows)` through the engine; a read failure (`EngineError::is_read_failure`) becomes the table's `ReadFailed`. `query_mut()` changes the query (a source that grows, a file registered again).
- `ParquetFile`: the page query for a registered Parquet file, filtered on `file_row_number` (reads only the row groups that hold the page). `set_name` points it at the file registered again.
- `ParquetSummary` and `open_parquet`: register a file and read its columns, row and row-group counts, and the key/value metadata under the keys you ask for, from the footer only.
- `ColumnInfo::table_column()`: the table's `ColumnKind` for a DuckDB type.
- `QueryResult` is a `TablePage`.

**JS (`@seiza/duckdb`):**

- `createBridge({ refusal? })`: the three calls (`registerFile`, `query`, `cancel`). `refusal(response)` gives the message for a URL whose server answered the range probe with something other than 206 on purpose (a pause switch, say).
- `duckdb()` (`/vite`): answers a missing extension with a 404, not the SPA fallback.
- Marks: `duckdb:engine-start` when DuckDB starts loading, `duckdb:engine-ready` when it's open.

A host must be cross-origin isolated (COOP/COEP): the read counters are `SharedArrayBuffer`s.

## Features

| Feature | What it adds | Cost (wasm, brotli) | Measured in |
|---|---|---|---|
| *(base)* | The client, its status and events, the Arrow reader, and the SQL helpers | +12.3 KiB when first built, with Tycho's bridge self-test (arrow-rs would have added 127 KiB more) | [Tycho's 2026-09-23 note](../../apps/tycho/perf/results/2026-09-23-m2.md) |
| `table` | A `seiza-table` source: query results as pages, Parquet files read a page at a time, their summary | — | [Tycho's results](../../apps/tycho/perf/results/) |

The JS side loads after first paint and costs no first-paint bytes: the engine chunk (38.8 KiB br), DuckDB's worker (~152 KiB br), its wasm (~5 MiB br, EH), and the Parquet extension (~487 KiB br), as Tycho's `just tycho build` reports them.

## Limits

- **HTTP files are read by byte range only.** A server must answer a ranged `HEAD` and a `bytes=0-0` GET with 206; anything else fails at `registerFile`.
- **Every page read costs at least ~1.39 MB** over HTTP, and a page query costs ~0.4 ms per row group in the worker, whatever the page's size ([`CLAUDE.md`](CLAUDE.md), gotchas).
- **One query runs at a time;** pending ones share the worker round-robin, and a started read can't be cancelled.
- **Registered files stay registered** for the session, and each Parquet file's parsed footer stays in memory (~2.2 MiB per open of a 1,378-group file; [Tycho's measurement](../../apps/tycho/perf/results/2026-10-08-m7-footers.json)).
- **In-memory tables stop storing anything past ~2.1 GiB** in a browser tab, silently ([`CLAUDE.md`](CLAUDE.md), gotchas).

## Docs

| File | What's in it |
|---|---|
| [`CLAUDE.md`](CLAUDE.md) | Rules, architecture, DuckDB-Wasm gotchas. |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | Why it's built the way it is, by area. |

Its work is planned and measured in the app that drives it; there's no PLAN.md here.
