//! Tycho's side of the DuckDB engine (`seiza-duckdb`): starts it locked down
//! after first paint, names every file it registers, and turns its events
//! into the panel's load steps and marks.

use seiza_duckdb::Lockdown;

/// The one directory the engine reads and writes once it's locked down:
/// every file Tycho registers is named inside it ([`path`]).
const DIRECTORY: &str = "tycho";

/// Tycho's lockdown (`docs/DECISIONS.md`, "Engine and bridge"): what it
/// can't send once the engine is locked goes first: the CSV tables'
/// database, and the view's (its filters' indexes, its sort's copy).
pub fn lockdown() -> Lockdown {
    Lockdown::new(DIRECTORY)
        .before(crate::csv::ATTACH_SQL)
        .before(crate::table::VIEW_ATTACH_SQL)
}

/// `name` as Tycho registers it: inside the lockdown's directory, so the
/// locked engine reads it.
pub fn path(name: &str) -> String {
    lockdown().path(name)
}

#[cfg(target_family = "wasm")]
pub use web::start;

#[cfg(target_family = "wasm")]
mod web {
    use std::cell::Cell;

    use gpui_kit::App;
    use seiza::LoadStep;
    use seiza_duckdb::{Engine, EngineEvent};

    /// Set when the Parquet extension has loaded (and its metadata cache is
    /// on).
    const PARQUET_READY_MARK: &str = "tycho:parquet-ready";
    /// Set when the engine is locked down, which is when it takes files.
    const LOCKED_MARK: &str = "tycho:engine-locked";

    /// The panel's page-load section; the engine's steps follow the shell's.
    const PAGE_LOAD: &str = seiza::perf::PAGE_LOAD;
    const ENGINE_READY_STEP: &str = "Engine ready";
    const PARQUET_READY_STEP: &str = "Parquet ready";
    const LOCKED_STEP: &str = "Engine locked";

    thread_local! {
        /// `?selftest` runs once the engine is ready and its lockdown has
        /// settled, either way: set at Ready, taken by the lockdown's event,
        /// which the engine always reports after Ready (`EngineEvent`).
        static SELFTEST_DUE: Cell<bool> = const { Cell::new(false) };
        /// When this start's engine was ready (its `Ready` event): what the
        /// Parquet and lock steps are timed from. Not the engine's mark,
        /// which a retry on the same worker doesn't set again.
        static READY_MS: Cell<Option<f64>> = const { Cell::new(None) };
    }

    /// Starts the engine, locked down: called from the post-paint callback.
    pub fn start(cx: &mut App) {
        seiza_duckdb::start_locked(cx, super::lockdown(), on_event);
    }

    fn on_event(event: &EngineEvent, cx: &mut App) {
        let step = |cx: &mut App, name, step| seiza::perf::set_load_step(cx, PAGE_LOAD, name, step);
        match *event {
            EngineEvent::Loading { at } => {
                READY_MS.set(None);
                step(cx, ENGINE_READY_STEP, LoadStep::running(at));
                step(cx, LOCKED_STEP, LoadStep::running(at));
            }
            EngineEvent::Ready {
                started_ms,
                ready_ms,
            } => {
                READY_MS.set(Some(ready_ms));
                step(cx, ENGINE_READY_STEP, LoadStep::done(started_ms, ready_ms));
                step(cx, PARQUET_READY_STEP, LoadStep::running(ready_ms));
                SELFTEST_DUE.set(crate::selftest::requested());
            }
            EngineEvent::Failed { started_ms, at } => {
                step(cx, ENGINE_READY_STEP, LoadStep::failed(started_ms, at));
                // Without an engine, the extension never loads and nothing
                // locks: "—".
                step(cx, PARQUET_READY_STEP, LoadStep::skipped(started_ms));
                step(cx, LOCKED_STEP, LoadStep::skipped(started_ms));
            }
            EngineEvent::ParquetReady { at } => {
                seiza::marks::mark_at(PARQUET_READY_MARK, at);
                let since = engine_ready_ms().unwrap_or(at);
                step(cx, PARQUET_READY_STEP, LoadStep::done(since, at));
            }
            EngineEvent::ParquetFailed { at } => {
                let since = engine_ready_ms().unwrap_or(at);
                step(cx, PARQUET_READY_STEP, LoadStep::failed(since, at));
            }
            EngineEvent::Locked { at } => {
                seiza::marks::mark_at(LOCKED_MARK, at);
                let since = engine_ready_ms().unwrap_or(at);
                step(cx, LOCKED_STEP, LoadStep::done(since, at));
                run_selftest_if_due(cx);
            }
            EngineEvent::LockFailed { at } => {
                let since = engine_ready_ms().unwrap_or(at);
                step(cx, LOCKED_STEP, LoadStep::failed(since, at));
                run_selftest_if_due(cx);
            }
        }
    }

    fn run_selftest_if_due(cx: &mut App) {
        if SELFTEST_DUE.replace(false) {
            let engine = cx.global::<Engine>().clone();
            cx.spawn(async move |cx| crate::selftest::run(&engine, cx).await)
                .detach();
        }
    }

    /// When this start's engine was ready.
    fn engine_ready_ms() -> Option<f64> {
        READY_MS.get()
    }
}
