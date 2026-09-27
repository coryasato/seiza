//! The Rust half of the bridge to DuckDB (`web/src/bridge.ts`).
//!
//! Only three calls cross it: `registerFile`, `query`, and `cancel` (see
//! Tycho's CLAUDE.md, rule 2). The JS side loads DuckDB on the first call, so
//! the engine starts when [`start`] runs its warm-up query from the post-paint
//! callback, and never earlier.

use std::cell::{Cell, RefCell};
use std::rc::Rc;

use gpui_kit::{App, Global};
use js_sys::{Promise, Uint8Array};
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::JsFuture;

use super::{EngineError, EngineStatus};
use crate::arrow::{self, QueryResult, Value};

#[wasm_bindgen]
extern "C" {
    /// `web/src/bridge.ts`'s `Bridge`, created by the host and handed to `start`.
    #[derive(Clone)]
    pub type Bridge;

    #[wasm_bindgen(method, js_name = registerFile)]
    fn register_file(this: &Bridge, name: &str, source: &JsValue) -> Promise;

    #[wasm_bindgen(method)]
    fn query(this: &Bridge, sql: &str, request_id: u32) -> Promise;

    #[wasm_bindgen(method)]
    fn cancel(this: &Bridge, request_id: u32);

    type JsFileInfo;

    #[wasm_bindgen(method, getter)]
    fn name(this: &JsFileInfo) -> String;

    #[wasm_bindgen(method, getter)]
    fn size(this: &JsFileInfo) -> Option<f64>;
}

/// The `performance.mark` the JS host sets once DuckDB is instantiated and
/// open. Must match `ENGINE_READY_MARK` in `web/src/engine.ts`.
pub const ENGINE_READY_MARK: &str = "tycho:engine-ready";

/// The warm-up query. It starts the engine load, and its answer proves a query
/// makes the whole round trip: bridge, worker, Arrow IPC, decoder.
pub(crate) const WARM_UP_SQL: &str = "SELECT 42 AS x";

/// Identifies one query, so it can be cancelled.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct RequestId(u32);

/// What to register: a dropped file, or a URL on our origin.
pub enum FileSource {
    File(web_sys::File),
    Url(String),
}

/// What `registerFile` reports back.
#[derive(Debug, Clone, PartialEq)]
pub struct FileInfo {
    pub name: String,
    /// Bytes, when known (a `File`, or a URL whose HEAD had `Content-Length`).
    pub size: Option<u64>,
}

/// A cheap handle to the engine. Installed as a global at startup.
#[derive(Clone)]
pub struct Engine {
    bridge: Bridge,
    next_request: Rc<Cell<u32>>,
    /// The Parquet extension's load: see [`Engine::load_parquet`].
    parquet: Rc<RefCell<ParquetLoad>>,
}

/// Where loading the Parquet extension is.
#[derive(Default)]
enum ParquetLoad {
    /// Not loaded, and no attempt running (none yet, or the last one failed).
    #[default]
    Idle,
    /// An attempt is running; it resolves when `LOAD parquet` does.
    Loading(Promise),
    /// Loaded, at this time (ms from `timeOrigin`).
    Loaded(f64),
}

impl Global for Engine {}

impl Engine {
    pub fn new(bridge: Bridge) -> Self {
        Self {
            bridge,
            next_request: Rc::new(Cell::new(1)),
            parquet: Rc::default(),
        }
    }

    /// Loads the Parquet extension, or joins the load already running.
    /// Every Parquet query waits for this first, so no query autoloads the
    /// extension. A success is remembered; after a failure, the next call
    /// tries again.
    ///
    /// DuckDB-Wasm 1.32.0 crashes inside its worker ("table index is out of
    /// bounds") when two loads of an extension fail at once, and no worker
    /// error fires, so every later query hangs. M4 found it: with the
    /// extension unreachable, a sample click racing the prefetch hung the
    /// retry in 4 of 8 runs. Only one attempt ever runs at a time here.
    pub fn load_parquet(&self) -> impl Future<Output = Result<(), EngineError>> + 'static {
        // The borrow ends before `start_parquet_load` takes a mutable one.
        let current = match &*self.parquet.borrow() {
            ParquetLoad::Loaded(_) => Some(None),
            ParquetLoad::Loading(attempt) => Some(Some(attempt.clone())),
            ParquetLoad::Idle => None,
        };
        let attempt = current.unwrap_or_else(|| Some(self.start_parquet_load()));
        async move {
            match attempt {
                None => Ok(()),
                Some(attempt) => JsFuture::from(attempt)
                    .await
                    .map(drop)
                    .map_err(engine_error),
            }
        }
    }

    /// When the Parquet extension loaded (ms from `timeOrigin`), if it has.
    pub fn parquet_loaded_at(&self) -> Option<f64> {
        match *self.parquet.borrow() {
            ParquetLoad::Loaded(at) => Some(at),
            _ => None,
        }
    }

    fn start_parquet_load(&self) -> Promise {
        let (_, load) = self.query(LOAD_PARQUET_SQL);
        let engine = self.clone();
        let state = self.parquet.clone();
        let attempt = wasm_bindgen_futures::future_to_promise(async move {
            let result = match load.await {
                Ok(_) => engine.query(PARQUET_METADATA_CACHE_SQL).1.await,
                failed => failed,
            };
            *state.borrow_mut() = match result {
                Ok(_) => ParquetLoad::Loaded(now()),
                Err(_) => ParquetLoad::Idle,
            };
            result
                .map(|_| JsValue::UNDEFINED)
                .map_err(|error| js_sys::Error::new(&error.to_string()).into())
        });
        // Set before the attempt can finish: it runs on a later microtask.
        *self.parquet.borrow_mut() = ParquetLoad::Loading(attempt.clone());
        attempt
    }

    /// Sends `sql` now and returns its id (for [`Engine::cancel`]) and its
    /// decoded result.
    pub fn query(
        &self,
        sql: &str,
    ) -> (
        RequestId,
        impl Future<Output = Result<QueryResult, EngineError>> + 'static,
    ) {
        let id = self.next_request.get();
        self.next_request.set(id.wrapping_add(1));
        let sent = JsFuture::from(self.bridge.query(sql, id));
        let result = async move {
            let bytes = sent.await.map_err(engine_error)?;
            arrow::decode(Uint8Array::new(&bytes).to_vec()).map_err(EngineError::Decode)
        };
        (RequestId(id), result)
    }

    /// Stops a query. Its future resolves to [`EngineError::Cancelled`]
    /// unless it already finished. Unknown or finished ids are ignored.
    pub fn cancel(&self, id: RequestId) {
        self.bridge.cancel(id.0);
    }

    /// Makes `source` readable from SQL as `name`. Files are read lazily,
    /// never copied whole.
    pub fn register_file(
        &self,
        name: &str,
        source: FileSource,
    ) -> impl Future<Output = Result<FileInfo, EngineError>> + 'static {
        let source = match source {
            FileSource::File(file) => JsValue::from(file),
            FileSource::Url(url) => JsValue::from(url),
        };
        let sent = JsFuture::from(self.bridge.register_file(name, &source));
        async move {
            let info: JsFileInfo = sent.await.map_err(engine_error)?.unchecked_into();
            Ok(FileInfo {
                name: info.name(),
                size: info.size().map(|size| size as u64),
            })
        }
    }
}

/// Maps a bridge rejection: an `AbortError` means the request was cancelled.
fn engine_error(error: JsValue) -> EngineError {
    match error.dyn_ref::<js_sys::Error>() {
        Some(error) if error.name() == "AbortError" => EngineError::Cancelled,
        Some(error) => EngineError::Engine(error.message().into()),
        None => EngineError::Engine(
            error
                .as_string()
                .unwrap_or_else(|| "unknown engine error".into()),
        ),
    }
}

/// Loads the Parquet extension from our origin (`web/src/engine.ts` points
/// DuckDB's extension repository there). [`start`] sends it right after the
/// warm-up, so a sample click with the engine warm doesn't wait for the
/// download; [`Engine::load_parquet`] keeps it to one attempt at a time.
const LOAD_PARQUET_SQL: &str = "LOAD parquet";

/// Keeps each Parquet file's parsed footer, so a file's metadata is parsed
/// once, not by every query. Off by default, and `GLOBAL` because every
/// query has its own connection. On a 1 GB file with 1,378 row groups, each
/// parse costs ~165 ms in the worker: the three summary queries paid it three
/// times and every page read once more (M5, `perf/results/2026-09-27-m5.md`).
/// The cache keeps a footer as long as its file stays registered, which is the
/// rest of the session: each dropped file registers under a new name, and
/// unregistering would be a fourth bridge call. So each opened file costs its
/// parsed footer in the worker (a few MB at 1,378 row groups). Known cost,
/// recorded in M5's results; revisit if a session opens many big files.
const PARQUET_METADATA_CACHE_SQL: &str = "SET GLOBAL parquet_metadata_cache = true";

/// Starts the engine: called from the post-paint callback. Runs the warm-up
/// query (which makes the bridge load DuckDB), then sets [`EngineStatus`] and
/// the overlay's "Engine ready" row, then prefetches the Parquet extension
/// ("Parquet ready"). With `?selftest` in the URL, it then runs the bridge
/// self-test.
pub fn start(cx: &mut App) {
    let engine = cx.global::<Engine>().clone();
    seiza::perf::set_metric(cx, "Engine ready", "…");
    seiza::perf::set_metric(cx, PARQUET_READY_METRIC, "…");
    cx.spawn(async move |cx| {
        let status = match warm_up(&engine).await {
            Ok(()) => EngineStatus::Ready {
                ready_ms: mark_start_time(ENGINE_READY_MARK).unwrap_or_else(now),
            },
            Err(error) => EngineStatus::Failed(error.to_string().into()),
        };
        cx.update(|cx| {
            let metric = match &status {
                EngineStatus::Ready { ready_ms } => format!("{ready_ms:.0} ms"),
                _ => "failed".into(),
            };
            seiza::perf::set_metric(cx, "Engine ready", metric);
            cx.set_global(status.clone());
        });
        if !matches!(status, EngineStatus::Ready { .. }) {
            cx.update(|cx| seiza::perf::set_metric(cx, PARQUET_READY_METRIC, "—"));
            return;
        }
        let loaded = engine.load_parquet().await;
        cx.update(|cx| match loaded {
            Ok(()) => show_parquet_ready(cx, &engine),
            // Opening a file tries again: `show_parquet_ready` then.
            Err(error) => {
                seiza::perf::set_metric(cx, PARQUET_READY_METRIC, format!("failed: {error}"))
            }
        });
        if crate::selftest::requested() {
            crate::selftest::run(&engine, cx).await;
        }
    })
    .detach();
}

const PARQUET_READY_METRIC: &str = "Parquet ready";

/// Sets the overlay's "Parquet ready" row to when the extension loaded. The
/// prefetch calls it, and so does a file open that succeeds: after a failed
/// prefetch, the open's own load is the one that works.
pub fn show_parquet_ready(cx: &mut App, engine: &Engine) {
    if let Some(at) = engine.parquet_loaded_at() {
        seiza::perf::set_metric(cx, PARQUET_READY_METRIC, format!("{at:.0} ms"));
    }
}

async fn warm_up(engine: &Engine) -> Result<(), EngineError> {
    let (_, result) = engine.query(WARM_UP_SQL);
    let result = result.await?;
    match result.value(0, 0) {
        Some(Value::Int(42)) => Ok(()),
        other => Err(EngineError::Engine(format!(
            "warm-up query returned {other:?}, expected 42"
        ))),
    }
}

/// `performance.now()`: ms from `performance.timeOrigin`.
pub(crate) fn now() -> f64 {
    web_sys::window()
        .and_then(|window| window.performance())
        .map_or(0.0, |performance| performance.now())
}

/// The first `performance.mark` named `name`, in ms from `timeOrigin`.
fn mark_start_time(name: &str) -> Option<f64> {
    let performance = web_sys::window()?.performance()?;
    let entry = performance
        .get_entries_by_name_with_entry_type(name, "mark")
        .get(0);
    entry
        .dyn_into::<web_sys::PerformanceEntry>()
        .ok()
        .map(|entry| entry.start_time())
}
