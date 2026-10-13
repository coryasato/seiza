//! DuckDB-Wasm for GPUI apps: the engine as the UI sees it (its load status
//! and errors), the Arrow IPC reader for its results, and (on the web) the
//! client that queries it through `@seiza/duckdb`'s bridge
//! (`engines/duckdb/web/`).
//!
//! It knows no app and doesn't depend on `seiza`: what the host shows about
//! the engine's load (panel rows, marks) comes from [`EngineEvent`]s.
//!
//! The `table` feature makes it a `seiza-table` source ([`table`]): query
//! results as pages of rows, and registered Parquet files read a page at a
//! time.

use std::fmt;

use gpui_kit::{Global, SharedString};

pub mod arrow;
#[cfg(target_family = "wasm")]
mod bridge;
pub mod sql;
#[cfg(feature = "table")]
pub mod table;

use arrow::DecodeError;

#[cfg(target_family = "wasm")]
pub use bridge::{
    Bridge, ENGINE_READY_MARK, ENGINE_START_MARK, Engine, FileInfo, FileSource, ReadCounter,
    RequestId, WARM_UP_SQL, init, retry, start,
};

/// Whether DuckDB can take queries yet. The engine starts loading right after
/// the first frame, so the first frame always shows `Loading`.
#[derive(Debug, Clone, Default, PartialEq)]
pub enum EngineStatus {
    #[default]
    Loading,
    /// `ready_ms`: when the engine opened, in ms from `performance.timeOrigin`.
    Ready { ready_ms: f64 },
    /// It never opened: its code, worker, or wasm didn't load.
    Failed(SharedString),
    /// It opened, then its worker stopped (out of memory, say). Every
    /// registered file and query went with it.
    Stopped(SharedString),
}

impl EngineStatus {
    /// Failed or stopped: nothing answers until a retry.
    pub fn is_down(&self) -> bool {
        matches!(self, Self::Failed(_) | Self::Stopped(_))
    }
}

impl Global for EngineStatus {}

/// What the engine reports to its host, for its load steps and marks. Times
/// are in ms from `performance.timeOrigin`. Each start (and each retry)
/// reports `Loading`, then `Ready` or `Failed`; after `Ready`, exactly one of
/// `ParquetReady` or `ParquetFailed` for the prefetch, then, after a
/// `ParquetFailed`, a `ParquetReady` when a later load succeeds. The host gets them through the
/// handler it passes to [`start`]; [`EngineStatus`] is the global to
/// observe for what the UI says.
#[derive(Debug, Clone, PartialEq)]
pub enum EngineEvent {
    /// The warm-up query was sent, which starts the load.
    Loading { at: f64 },
    /// DuckDB is open: `started_ms` is when the JS side began loading it,
    /// `ready_ms` when it opened.
    Ready { started_ms: f64, ready_ms: f64 },
    /// It didn't open: its code, worker, or wasm didn't load.
    Failed { started_ms: f64, at: f64 },
    /// The Parquet extension loaded and its metadata cache is on: the
    /// prefetch after [`EngineEvent::Ready`], or a later caller's
    /// [`Engine::load_parquet`] after the prefetch failed.
    ParquetReady { at: f64 },
    /// The prefetch couldn't load the Parquet extension. The next
    /// `load_parquet` tries again.
    ParquetFailed { at: f64 },
}

/// Why a bridge call didn't produce a result.
#[derive(Debug, Clone, PartialEq)]
pub enum EngineError {
    /// `cancel` was called for this request.
    Cancelled,
    /// DuckDB, the worker, or the network reported an error.
    Engine(String),
    /// The result bytes weren't a readable Arrow IPC stream.
    Decode(DecodeError),
    /// DuckDB's worker stopped after it had loaded. Sets
    /// [`EngineStatus::Stopped`].
    Stopped(String),
}

impl fmt::Display for EngineError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Cancelled => f.write_str("cancelled"),
            Self::Engine(message) => f.write_str(message),
            Self::Decode(error) => write!(f, "{error}"),
            Self::Stopped(message) => write!(f, "the engine stopped ({message})"),
        }
    }
}

impl std::error::Error for EngineError {}

impl EngineError {
    /// Whether DuckDB failed to read the file's bytes, which registering it
    /// again under a new name can fix: a failed HTTP range read, the Thrift
    /// errors every later read of those bytes gives under the old name,
    /// or a dropped file the browser can no longer read. Not a query
    /// or decode error, nor a stopped engine: registering again can't help.
    pub fn is_read_failure(&self) -> bool {
        const SIGNS: [&str; 4] = [
            "Range request for",
            "TProtocolException",
            "NotReadableError",
            "NotFoundError",
        ];
        matches!(self, Self::Engine(message) if SIGNS.iter().any(|sign| message.contains(sign)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn read_failures_are_told_apart() {
        let engine = |message: &str| EngineError::Engine(message.into());
        assert!(engine("Invalid Error: Error: Range request for http://x/data/a.parquet failed with error: NetworkError").is_read_failure());
        assert!(engine("Invalid Error: TProtocolException: Invalid data").is_read_failure());
        assert!(engine("NotReadableError: The requested file could not be read").is_read_failure());
        assert!(!engine("Binder Error: column \"x\" not found").is_read_failure());
        assert!(!EngineError::Stopped("Range request for".into()).is_read_failure());
        assert!(!EngineError::Cancelled.is_read_failure());
    }
}
