//! The Rust half of the bridge to DuckDB (`web/src/bridge.ts`).
//!
//! Only three calls cross it: `registerFile`, `query`, and `cancel` (the
//! engine's CLAUDE.md, rule 2). The JS side loads DuckDB on the first call,
//! so the engine starts when [`start`] runs its warm-up query (the host calls
//! it after first paint), and never earlier.

use std::cell::{Cell, RefCell};
use std::rc::Rc;

use gpui_kit::{App, AsyncApp, Global};
use js_sys::{Promise, Uint8Array};
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::JsFuture;

use crate::arrow::{self, QueryResult, Value};
use crate::{EngineError, EngineEvent, EngineStatus};

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

    #[wasm_bindgen(method, getter, js_name = bytesRead)]
    fn bytes_read(this: &JsFileInfo) -> Option<js_sys::BigInt64Array>;

    /// `Atomics.load` with a number index. js-sys's `load_bigint` passes the
    /// index as a BigInt, which `Atomics.load` rejects.
    #[wasm_bindgen(js_namespace = Atomics, js_name = load)]
    fn atomics_load(array: &js_sys::BigInt64Array, index: u32) -> JsValue;
}

/// The `performance.mark` the JS side sets when DuckDB starts loading. Must
/// match `ENGINE_START_MARK` in `web/src/engine.ts`.
pub const ENGINE_START_MARK: &str = "duckdb:engine-start";

/// The `performance.mark` the JS side sets once DuckDB is instantiated and
/// open. Must match `ENGINE_READY_MARK` in `web/src/engine.ts`.
pub const ENGINE_READY_MARK: &str = "duckdb:engine-ready";

/// The name of the error every bridge call rejects with once DuckDB's worker
/// has stopped. Must match `ENGINE_STOPPED` in `web/src/engine.ts`.
const ENGINE_STOPPED: &str = "EngineStopped";

/// The warm-up query. It starts the engine load, and its answer proves a query
/// makes the whole round trip: bridge, worker, Arrow IPC, decoder.
pub const WARM_UP_SQL: &str = "SELECT 42 AS x";

/// `performance.now()`: ms from `performance.timeOrigin`, the clock every
/// [`EngineEvent`] time is on.
fn now() -> f64 {
    web_sys::window()
        .and_then(|window| window.performance())
        .map_or(0.0, |performance| performance.now())
}

/// The last `performance.mark` named `name` (the JS side's; a retry sets
/// them again), in ms from `timeOrigin`.
fn mark_time(name: &str) -> Option<f64> {
    let performance = web_sys::window()?.performance()?;
    let entries = performance.get_entries_by_name_with_entry_type(name, "mark");
    let entry = entries.get(entries.length().checked_sub(1)?);
    entry
        .dyn_into::<web_sys::PerformanceEntry>()
        .ok()
        .map(|entry| entry.start_time())
}

/// Identifies one query, so it can be cancelled.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct RequestId(u32);

/// What to register: a dropped file, or a URL on our origin.
#[derive(Clone)]
pub enum FileSource {
    File(web_sys::File),
    Url(String),
}

/// What `registerFile` reports back.
#[derive(Debug, Clone)]
pub struct FileInfo {
    pub name: String,
    /// Bytes, when known (a `File`, or a URL whose HEAD had `Content-Length`).
    pub size: Option<u64>,
    /// How much of it DuckDB has read, live. None for a CSV chunk.
    pub bytes_read: Option<ReadCounter>,
}

/// The bytes DuckDB has read from one registered file, counted inside its
/// worker as they arrive (`web/src/engine.ts`, `readCounter`): a URL's
/// range responses, or a dropped file's slices. Rides on `registerFile`'s
/// answer, so reading it isn't a bridge call (rule 2).
#[derive(Debug, Clone)]
pub struct ReadCounter {
    counter: js_sys::BigInt64Array,
    /// What earlier registrations of the same file read (see
    /// [`ReadCounter::continuing`]).
    base: u64,
}

impl ReadCounter {
    pub fn get(&self) -> u64 {
        self.base
            + i64::try_from(atomics_load(&self.counter, 0)).map_or(0, |bytes| bytes.max(0) as u64)
    }

    /// This counter, for a file registered again: it counts on from what
    /// `before` (the last registration's, which stops counting) read.
    pub fn continuing(self, before: &ReadCounter) -> Self {
        Self {
            base: before.get(),
            ..self
        }
    }
}

/// A cheap handle to the engine. Installed as a global at startup.
#[derive(Clone)]
pub struct Engine {
    bridge: Bridge,
    next_request: Rc<Cell<u32>>,
    /// The Parquet extension's load: see [`Engine::load_parquet`].
    parquet: Rc<RefCell<ParquetLoad>>,
    /// Counts engine starts: an answer from an engine a retry replaced
    /// can't report the new one stopped.
    generation: Rc<Cell<u32>>,
    /// Where [`EngineEvent`]s and [`EngineStatus`] changes go (set by [`start`]).
    host: Rc<RefCell<Option<Host>>>,
    /// The Parquet prefetch has reported its result. Until then, `run`
    /// reports whichever load finished first; after, a load reports itself.
    /// So every start reports Ready (or Failed) before any Parquet event.
    prefetch_settled: Rc<Cell<bool>>,
    /// The engine failed to load or stopped: calls fail here, without
    /// reaching the bridge, until [`retry`]. The bridge starts a new engine
    /// on its next call, and that must be the retry's, not a stray page read
    /// or a file dropped meanwhile.
    down: Rc<Cell<bool>>,
}

/// The handler [`start`] was given for [`EngineEvent`]s.
type OnEvent = Rc<dyn Fn(&EngineEvent, &mut App)>;

/// The app, and its handler for [`EngineEvent`]s.
#[derive(Clone)]
struct Host {
    cx: AsyncApp,
    on_event: OnEvent,
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
            generation: Rc::default(),
            host: Rc::default(),
            prefetch_settled: Rc::default(),
            down: Rc::default(),
        }
    }

    /// Runs `update` in an app update of its own: the engine's futures
    /// don't run inside one.
    fn update_later(&self, update: impl FnOnce(&mut App, &OnEvent) + 'static) {
        let Some(Host { cx, on_event }) = self.host.borrow().clone() else {
            return;
        };
        cx.spawn(async move |cx| {
            cx.update(|cx| update(cx, &on_event));
        })
        .detach();
    }

    /// Tells the host about `event`, in an update of its own.
    fn emit_later(&self, event: EngineEvent) {
        self.update_later(move |cx, on_event| on_event(&event, cx));
    }

    /// Tells the host about `event` now, from inside an app update.
    fn emit(&self, event: EngineEvent, cx: &mut App) {
        let on_event = self
            .host
            .borrow()
            .as_ref()
            .map(|host| host.on_event.clone());
        if let Some(on_event) = on_event {
            on_event(&event, cx);
        }
    }

    /// The error a call gets while the engine is down.
    fn down_error() -> EngineError {
        EngineError::Engine("the engine isn't running; Retry starts it".into())
    }

    /// Notes `result`'s error if it says the engine stopped: the Parquet
    /// extension went with the worker, and the app hears of it once.
    fn check_stopped<T>(
        &self,
        generation: u32,
        result: Result<T, EngineError>,
    ) -> Result<T, EngineError> {
        if let Err(EngineError::Stopped(message)) = &result
            && self.generation.get() == generation
        {
            self.generation.set(generation.wrapping_add(1));
            self.down.set(true);
            *self.parquet.borrow_mut() = ParquetLoad::Idle;
            let message = message.clone();
            self.update_later(move |cx, _| cx.set_global(EngineStatus::Stopped(message.into())));
        }
        result
    }

    /// Watches a call's answer for [`EngineError::Stopped`], whether or not
    /// anyone awaits its future: a caller that gave up (an open replaced by
    /// another drops its task) must not leave the engine marked up after
    /// the bridge has forgotten it, or the next call starts a new engine
    /// unseen, without the Parquet extension (code review).
    fn watch(&self, promise: &Promise) {
        let (engine, generation) = (self.clone(), self.generation.get());
        let answer = JsFuture::from(promise.clone());
        wasm_bindgen_futures::spawn_local(async move {
            if let Err(error) = answer.await {
                let _ = engine.check_stopped::<()>(generation, Err(engine_error(error)));
            }
        });
    }

    /// Loads the Parquet extension, or joins the load already running.
    /// Every Parquet query waits for this first, so no query autoloads the
    /// extension. A success is remembered; after a failure, the next call
    /// tries again.
    ///
    /// DuckDB-Wasm 1.32.0 crashes inside its worker ("table index is out of
    /// bounds") when two loads of an extension fail at once, and no worker
    /// error fires, so every later query hangs. Found by testing: with the
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
    fn parquet_loaded_at(&self) -> Option<f64> {
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
                Ok(_) => {
                    let at = now();
                    // Before the prefetch settles, `run` reports this load.
                    if engine.prefetch_settled.get() {
                        engine.emit_later(EngineEvent::ParquetReady { at });
                    }
                    ParquetLoad::Loaded(at)
                }
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
        let promise = if self.down.get() {
            Promise::reject(&js_sys::Error::new(&Self::down_error().to_string()))
        } else {
            self.bridge.query(sql, id)
        };
        self.watch(&promise);
        let sent = JsFuture::from(promise);
        let (engine, generation) = (self.clone(), self.generation.get());
        let result = async move {
            let bytes = engine.check_stopped(generation, sent.await.map_err(engine_error))?;
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
        let promise = if self.down.get() {
            Promise::reject(&js_sys::Error::new(&Self::down_error().to_string()))
        } else {
            self.bridge.register_file(name, &source)
        };
        self.watch(&promise);
        let sent = JsFuture::from(promise);
        let (engine, generation) = (self.clone(), self.generation.get());
        async move {
            let info: JsFileInfo = engine
                .check_stopped(generation, sent.await.map_err(engine_error))?
                .unchecked_into();
            Ok(FileInfo {
                name: info.name(),
                size: info.size().map(|size| size as u64),
                bytes_read: info
                    .bytes_read()
                    .map(|counter| ReadCounter { counter, base: 0 }),
            })
        }
    }
}

/// Maps a bridge rejection: an `AbortError` means the request was cancelled.
fn engine_error(error: JsValue) -> EngineError {
    match error.dyn_ref::<js_sys::Error>() {
        Some(error) if error.name() == "AbortError" => EngineError::Cancelled,
        Some(error) if error.name() == ENGINE_STOPPED => {
            EngineError::Stopped(error.message().into())
        }
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
/// parse costs ~165 ms in the worker: a file's summary queries paid it once each,
/// and every page read once more (`apps/tycho/perf/results/2026-09-27-m5.md`).
/// The cache keeps a footer as long as its file stays registered, which is the
/// rest of the session: each dropped file registers under a new name, and
/// unregistering would be a fourth bridge call. So each opened file costs its
/// parsed footer in the worker (a few MB at 1,378 row groups). Known cost,
/// recorded in `apps/tycho/perf/results/2026-09-27-m5.md`; revisit if a session opens many big files.
const PARQUET_METADATA_CACHE_SQL: &str = "SET GLOBAL parquet_metadata_cache = true";

/// Installs the engine as a global, with [`EngineStatus::Loading`]. Loads
/// nothing: `bridge` (`@seiza/duckdb`'s `createBridge()`) loads DuckDB on its
/// first call, which [`start`] makes.
pub fn init(cx: &mut App, bridge: Bridge) {
    cx.set_global(Engine::new(bridge));
    cx.set_global(EngineStatus::Loading);
}

/// Starts the engine: call it after first paint (DuckDB must never delay
/// it). Runs the warm-up query, which makes the bridge load DuckDB, then
/// sets [`EngineStatus`], then prefetches the Parquet extension. `on_event`
/// hears each step ([`EngineEvent`]), now and after a [`retry`].
pub fn start(cx: &mut App, on_event: impl Fn(&EngineEvent, &mut App) + 'static) {
    let engine = cx.global::<Engine>().clone();
    *engine.host.borrow_mut() = Some(Host {
        cx: cx.to_async(),
        on_event: Rc::new(on_event),
    });
    run(cx);
}

fn run(cx: &mut App) {
    let engine = cx.global::<Engine>().clone();
    let started = now();
    engine.emit(EngineEvent::Loading { at: started }, cx);
    cx.spawn(async move |cx| {
        let status = match warm_up(&engine).await {
            Ok(()) => EngineStatus::Ready {
                ready_ms: mark_time(ENGINE_READY_MARK)
                    .filter(|at| *at >= started)
                    .unwrap_or_else(now),
            },
            Err(error) => {
                engine.down.set(true);
                EngineStatus::Failed(error.to_string().into())
            }
        };
        // The JS side marks when it actually began loading: this attempt's
        // mark, not an earlier one's (a retry can fail before it sets one).
        let started = mark_time(ENGINE_START_MARK)
            .filter(|at| *at >= started)
            .unwrap_or(started);
        cx.update(|cx| {
            let event = match &status {
                EngineStatus::Ready { ready_ms } => EngineEvent::Ready {
                    started_ms: started,
                    ready_ms: *ready_ms,
                },
                _ => EngineEvent::Failed {
                    started_ms: started,
                    at: now(),
                },
            };
            engine.emit(event, cx);
            cx.set_global(status.clone());
        });
        if !matches!(status, EngineStatus::Ready { .. }) {
            return;
        }
        // A load that an open started can finish before the prefetch's
        // answer comes back, or after it failed: either way it's reported
        // here, after Ready, and loads that finish later report themselves.
        let failed = engine.load_parquet().await.is_err().then(now);
        cx.update(|cx| {
            engine.prefetch_settled.set(true);
            if let Some(at) = failed {
                engine.emit(EngineEvent::ParquetFailed { at }, cx);
            }
            if let Some(at) = engine.parquet_loaded_at() {
                engine.emit(EngineEvent::ParquetReady { at }, cx);
            }
        });
    })
    .detach();
}

/// Starts the engine again after it failed to load or stopped: the bridge
/// forgot the dead one, so the warm-up starts a new worker. The handler
/// given to [`start`] hears this start too.
pub fn retry(cx: &mut App) {
    if !cx
        .try_global::<EngineStatus>()
        .is_some_and(EngineStatus::is_down)
    {
        return;
    }
    let engine = cx.global::<Engine>();
    engine
        .generation
        .set(engine.generation.get().wrapping_add(1));
    engine.down.set(false);
    engine.prefetch_settled.set(false);
    *engine.parquet.borrow_mut() = ParquetLoad::Idle;
    cx.set_global(EngineStatus::Loading);
    run(cx);
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
