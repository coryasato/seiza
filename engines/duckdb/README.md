# duckdb

DuckDB-Wasm for GPUI apps on the web: a Rust client (`seiza-duckdb`) that sends SQL and reads the answers as Arrow, and a JS package (`@seiza/duckdb`) that runs DuckDB in a Web Worker behind three calls. It's built to stay off the first-paint path: nothing loads until the first call, and everything is served from the host's own origin.

**Used by:** [Tycho](../../apps/tycho/), and [the observatory](../../apps/observatory/)'s GPUI contender. **Crate:** `seiza-duckdb`. **Package:** `@seiza/duckdb` (an npm workspace; not published).

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
// or, locked down to the files registered under one directory:
seiza_duckdb::start_locked(cx, Lockdown::new("app").before("ATTACH …"), |event, cx| { /* … */ });

let engine = cx.global::<seiza_duckdb::Engine>().clone();
let (id, result) = engine.query("SELECT count(*) FROM 'a.parquet'");
// engine.cancel(id) stops it; `result` resolves to an arrow::QueryResult or an EngineError.
```

**Rust (`seiza-duckdb`):**

- `init(cx, bridge)`: installs the `Engine` and `EngineStatus` globals.
- `start(cx, on_event)`: starts the engine (call it after first paint). `on_event` hears each `EngineEvent`: `Loading`, `Ready`, `Failed`, `ParquetReady`, `ParquetFailed`, each with its times in ms from `performance.timeOrigin`, for the host's load steps and marks.
- `start_locked(cx, lockdown, on_event)`: `start`, then the `Lockdown` once the Parquet extension has loaded: the host's statements (`Lockdown::before`: what it can't send once locked, each safe to run twice), `allowed_directories` set to its directory, external access off, the configuration locked. `EngineStatus::Ready` waits for it, with `EngineEvent::Locked`; a failed load or step is `EngineStatus::Failed` with `EngineEvent::LockFailed`, and `retry` runs the steps that didn't finish. Name every file `Lockdown::path(name)`: a locked engine reads nothing else.
- `retry(cx)`: starts a new engine after `EngineStatus::Failed` or `Stopped`. Calls fail without reaching the bridge until then.
- `Engine::query(sql)`: sends now; returns its `RequestId` and a future of the decoded result. `Engine::cancel(id)` stops it.
- `Engine::query_background(sql)`: the same, but the query runs only while no other query is in flight, so a page read waits for no more than the one slice of it already running. It can wait as long as other queries keep coming: a host says so where it shows the answer. `Runner::query_background` sends one through a view's runner (a test's stand-in runs it as any other).
- `Engine::register_file(name, FileSource::File | Url)`: makes a dropped file or a same-origin URL readable from SQL as `name`. Its `FileInfo` carries the size and a live `ReadCounter`.
- `Engine::load_parquet()`: loads the Parquet extension, or joins the load running. Every Parquet query waits for it.
- `EngineError::is_read_failure()`: whether registering the file again under a new name could fix the error.
- `arrow::decode(bytes)`: the Arrow IPC reader, for null, bool, ints, floats, decimal128, utf8, binary, dates, times, and timestamps; any other type decodes as a column that shows its type name.
- `sql`: `ColumnInfo` (a column's name and DuckDB type), `string_literal`, `quote_identifier`, `keep_case` (a condition as the `CASE` a row is kept by, for a host's own filtered SQL), and typed reads of metadata results (`column`, `text`, `count`).

**The `tall-table` feature** makes DuckDB a [`seiza-tall-table`](../../components/tall-table/) source (in the browser; natively there's no engine, so `QueryRows::new` takes only the query and every page fails):

```rust
use seiza_duckdb::tall_table::{ParquetFile, QueryRows};

let (summary, read_counter) =
    seiza_duckdb::tall_table::open_parquet(&engine, "file-1.parquet", source, &["my.credit"], |_| {}).await?;
let columns = summary.columns.iter().map(ColumnInfo::tall_table_column).collect();
let state = cx.new(|cx| {
    TallTableState::new(QueryRows::new(engine, ParquetFile::new("file-1.parquet")), columns, summary.rows, Paging::default(), cx)
});
```

- `QueryRows<Q: PageQuery>`: a `TallTableDelegate` that reads each page with `Q::page_sql(rows)` through the engine; a read failure (`EngineError::is_read_failure`) becomes the table's `ReadFailed`. `query_mut()` changes the query (a source that grows, a file registered again).
- `ParquetFile`: the page query for a registered Parquet file, filtered on `file_row_number` (reads only the row groups that hold the page). `set_name` points it at the file registered again.
- `ParquetSummary` and `open_parquet`: register a file and read its columns, row and row-group counts, and the key/value metadata under the keys you ask for, from the footer only.
- `ColumnInfo::tall_table_column()`: the table's `ColumnKind` for a DuckDB type.
- `QueryResult` is a `TallTablePage`.

**A view of a source** (`view`, with `tall-table`): `ViewRows<Q: RowSource, R: Runner>` is a table delegate over a source's rows chosen by a filter and ordered by a sort, built in an in-memory database the host attaches `(COMPRESS)` before any lockdown (`ViewSettings`: the database, a prefix of the view's own for its tables' names, and the DuckDB memory past which nothing more is built).

- `RowSource`: a `PageQuery` that can number its rows in the source's order (`numbered_sql`, the row number in `ROW`), read a range of them, and say why it can't be filtered or sorted now (`busy`) or sorted at all (`refuse_sort`). `ParquetFile` is one; a host's CSV is its own.
- **A filter** is an index of row numbers written by one query, in the source's order: `filter_job(where_sql)` gives the `CREATE TABLE` to run (off the table, cancelled by its `FilterHandle`), and `set_filter(Some(Filtered))` gives the table its result, whose `rows()` is the new count for `replace_rows`. A page is its slice of the index joined to the source's rows between the slice's first and last row number, so a Parquet file reads only those row groups. The host writes the condition as SQL; `ViewRows` keeps the rows it holds for through a `CASE` projection, never a `WHERE` (the index, its sort's copy, and find's count and place alike), since DuckDB-Wasm runs a text comparison pushed into a Parquet scan about 10× slower.
- **A sort** (feature `sort`, which turns on the table's): the delegate's `sort` writes a sorted copy of the rows in view and pages it by `rowid`; `on_order` hears when one starts, is built, or fails.
- **Find** (feature `find`, which turns on the table's): the delegate's `find` searches the rows in view in their order, in windows from 16,384 rows doubling to 1,048,576, each a query of its own, a cancel landing between them; `find_count_sql` and `find_place_sql` are the host's queries for the count of matching cells and the current match's place among them.
- `Runner` sends a query: the `Engine`, or a test's stand-in. `close()` drops the view's tables.

Every index and copy is checked against the count it was built from, and DuckDB's memory against the budget before it's built: a short one fails, never "no rows" (Limits, below).

**JS (`@seiza/duckdb`):**

- `createBridge({ refusal?, extensionDir?, extensionBase?, sliceMs? })`: the three calls (`registerFile`, `query`, `cancel`); `query(sql, id, { background })` runs a query in the background, as `Engine::query_background` does. `sliceMs` is how long DuckDB runs a query before it answers a poll (DuckDB-Wasm's `queryPollingInterval`, its own when unset): one setting for every query, so a host that runs long queries beside page reads sets a short one (Tycho, 10 ms; `docs/DECISIONS.md`, "Engine and bridge", 2026-11-27). `refusal(response)` gives the message for a URL whose server answered the range probe with something other than 206 on purpose (a pause switch, say). `extensionDir` is the directory under the host's Vite `base` the extensions load from: one name, no slashes, `duckdb-ext` by default. A host that picks another (`duckdb`) gives `duckdb()` and `extensions.ts <public dir> duckdb` the same name; a name with a slash throws. `extensionBase` is the path that directory sits under (starting and ending in `/`), Vite's `BASE_URL` by default: a host whose builds share one engine path apart from their bases (the observatory's contenders, `/observatory/duckdb/`) names it, and serves the directory there itself.
- `duckdb({ extensionDir? })` (`/vite`): answers a missing extension under `<base><extensionDir>/` with a 404, not the SPA fallback.
- Marks: `duckdb:engine-start` when DuckDB starts loading, `duckdb:engine-ready` when it's open.

A host must be cross-origin isolated (COOP/COEP): the read counters are `SharedArrayBuffer`s.

## Features

| Feature | What it adds | Cost (wasm, brotli) | Measured in |
|---|---|---|---|
| *(base)* | The client, its status and events, the Arrow reader, and the SQL helpers | +12.3 KiB when first built, with Tycho's bridge self-test (arrow-rs would have added 127 KiB more) | [Tycho's 2026-09-23 note](../../apps/tycho/perf/results/2026-09-23-m2.md) |
| `tall-table` | A `seiza-tall-table` source: query results as pages, Parquet files read a page at a time, their summary | — | [Tycho's results](../../apps/tycho/perf/results/) |
| `sort` | A view's sort: a sorted copy of the rows in view; turns on the table's `sort` | With Tycho's filter and its controller, +20.0 KiB on Tycho; the table's own `sort` +23.4 KiB in its bare host | [Tycho's milestones](../../apps/tycho/docs/milestones.md) ("Sort, filter, and find") |
| `find` | A view's find: the rows in view searched in windows, and the count's and the place's SQL; turns on the table's `find` | In the same +20.0 KiB; the table's own `find` +7.4 KiB in its bare host | [Tycho's milestones](../../apps/tycho/docs/milestones.md) ("Sort, filter, and find") |

The JS side loads after first paint and costs no first-paint bytes: the engine chunk (38.8 KiB br), DuckDB's worker (~152 KiB br), its wasm (~5 MiB br, EH), and the Parquet extension (~487 KiB br), as Tycho's `just tycho build` reports them.

## Limits

- **HTTP files are read by byte range only.** A server must answer a ranged `HEAD` and a `bytes=0-0` GET with 206; anything else fails at `registerFile`.
- **Every page read costs at least ~1.39 MB** over HTTP, and a page query costs ~0.4 ms per row group in the worker, whatever the page's size ([`CLAUDE.md`](CLAUDE.md), gotchas).
- **One query runs at a time;** pending ones share the worker round-robin, and a started read can't be cancelled.
- **Registered files stay registered** for the session, and each Parquet file's parsed footer stays in memory (~2.2 MiB per open of a 1,378-group file; [Tycho's measurement](../../apps/tycho/perf/results/2026-10-08-m7-footers.json)).
- **In-memory tables stop storing anything past ~2.1 GiB** in a browser tab, silently ([`CLAUDE.md`](CLAUDE.md), gotchas).
- **A view's sort copies the rows in view into memory,** reading the whole source: ~145 MiB and 7.5–8 s for a 108 MiB Parquet file's 4.7 M rows; a sorted index paged instead reads every row group a page (~2 s a page there). A filter's index holds row numbers alone. A host refuses a sort its source is too large for (`RowSource::refuse_sort`). Find's count and place are each a whole scan (67 s on a 970 MiB file). Every number: [`docs/DECISIONS.md`](docs/DECISIONS.md), "Table source", 2026-11-26.
- **A source with a column named `__seiza_row`, `__seiza_at`, or `__seiza_keep`** (the names the view's SQL gives its own columns) can't be filtered, sorted, or searched: each is refused with the column's name, before anything is sent; its pages still read.
- **Locked (`start_locked`), a query reaches the directory's files and nothing else:** a URL, a file outside it, a `../` path, `COPY` outside it or to a URL, `ATTACH` of a file or URL, `LOAD` of an extension not yet loaded, and every `SET` and `RESET` are refused. Still allowed, since none reaches outside: `ATTACH ':memory:'`, an `ATTACH` or `COPY` inside the directory, `LOAD` of a loaded extension, and `INSTALL` (DuckDB-Wasm fetches at `LOAD`). Checked in Chromium, Firefox, and WebKit by Tycho's `perf/lockdown.ts`.

## Docs

| File | What's in it |
|---|---|
| [`CLAUDE.md`](CLAUDE.md) | Rules, a map of its files, DuckDB-Wasm gotchas. |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | Why it's built the way it is, by area. |

Its work is planned and measured in the app that drives it; there's no PLAN.md here.
