//! Tycho's side of the DuckDB engine (`seiza-duckdb`): starts it after first
//! paint, and turns its events into the panel's load steps and marks.

use std::cell::Cell;

use gpui_kit::App;
use seiza::LoadStep;
use seiza_duckdb::{Engine, EngineEvent, EngineStatus};

/// Set when the Parquet extension has loaded (and its metadata cache is
/// on); the perf scripts check the panel's "Parquet ready" against it.
const PARQUET_READY_MARK: &str = "tycho:parquet-ready";

/// The panel's page-load section; the engine's steps follow the shell's.
const PAGE_LOAD: &str = seiza::perf::PAGE_LOAD;
/// Step names the perf scripts read; don't rename them.
const ENGINE_READY_STEP: &str = "Engine ready";
const PARQUET_READY_STEP: &str = "Parquet ready";

thread_local! {
    /// `?selftest` runs once the engine is ready and its Parquet prefetch has
    /// settled, either way: set at Ready, taken by the prefetch's event,
    /// which the engine always reports after Ready (`EngineEvent`).
    static SELFTEST_DUE: Cell<bool> = const { Cell::new(false) };
}

/// Starts the engine: called from the post-paint callback.
pub fn start(cx: &mut App) {
    seiza_duckdb::start(cx, on_event);
}

fn on_event(event: &EngineEvent, cx: &mut App) {
    let step = |cx: &mut App, name, step| seiza::perf::set_load_step(cx, PAGE_LOAD, name, step);
    match *event {
        EngineEvent::Loading { at } => step(cx, ENGINE_READY_STEP, LoadStep::running(at)),
        EngineEvent::Ready {
            started_ms,
            ready_ms,
        } => {
            step(cx, ENGINE_READY_STEP, LoadStep::done(started_ms, ready_ms));
            step(cx, PARQUET_READY_STEP, LoadStep::running(ready_ms));
            SELFTEST_DUE.set(crate::selftest::requested());
        }
        EngineEvent::Failed { started_ms, at } => {
            step(cx, ENGINE_READY_STEP, LoadStep::failed(started_ms, at));
            // Without an engine, the extension never loads: "—".
            step(cx, PARQUET_READY_STEP, LoadStep::skipped(started_ms));
        }
        // After a failed prefetch, the load a file open makes is the one
        // that works: the step shows it then.
        EngineEvent::ParquetReady { at } => {
            seiza::marks::mark_at(PARQUET_READY_MARK, at);
            let since = engine_ready_ms(cx).unwrap_or(at);
            step(cx, PARQUET_READY_STEP, LoadStep::done(since, at));
            run_selftest_if_due(cx);
        }
        EngineEvent::ParquetFailed { at } => {
            let since = engine_ready_ms(cx).unwrap_or(at);
            step(cx, PARQUET_READY_STEP, LoadStep::failed(since, at));
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

fn engine_ready_ms(cx: &App) -> Option<f64> {
    match cx.try_global::<EngineStatus>()? {
        EngineStatus::Ready { ready_ms } => Some(*ready_ms),
        _ => None,
    }
}
