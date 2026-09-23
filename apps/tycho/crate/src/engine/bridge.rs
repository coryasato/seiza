//! The Rust half of the bridge to DuckDB (`web/src/bridge.ts`).
//!
//! Only three calls cross it: `registerFile`, `query`, and `cancel` (see
//! Tycho's CLAUDE.md, rule 2). The JS side loads DuckDB on the first call, so
//! the engine starts when [`start`] runs its warm-up query from the post-paint
//! callback, and never earlier.

use std::cell::Cell;
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
}

impl Global for Engine {}

impl Engine {
    pub fn new(bridge: Bridge) -> Self {
        Self {
            bridge,
            next_request: Rc::new(Cell::new(1)),
        }
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

/// Starts the engine: called from the post-paint callback. Runs the warm-up
/// query (which makes the bridge load DuckDB), then sets [`EngineStatus`] and
/// the overlay's "Engine ready" row. With `?selftest` in the URL, it then runs
/// the bridge self-test.
pub fn start(cx: &mut App) {
    let engine = cx.global::<Engine>().clone();
    seiza::perf::set_metric(cx, "Engine ready", "…");
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
        if matches!(status, EngineStatus::Ready { .. }) && crate::selftest::requested() {
            crate::selftest::run(&engine, cx).await;
        }
    })
    .detach();
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
