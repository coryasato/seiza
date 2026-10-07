//! The DuckDB engine as the UI sees it: its load status, and (on the web) the
//! client that queries it through the JS bridge.

use std::fmt;

use gpui_kit::{Global, SharedString};

use crate::arrow::DecodeError;

#[cfg(target_family = "wasm")]
mod bridge;

#[cfg(target_family = "wasm")]
pub use bridge::{
    Bridge, ENGINE_READY_MARK, Engine, FileInfo, FileSource, ReadCounter, RequestId,
    show_parquet_ready, start,
};
#[cfg(target_family = "wasm")]
pub(crate) use bridge::{WARM_UP_SQL, now};

/// Whether DuckDB can take queries yet. The engine starts loading right after
/// the first frame, so the first frame always shows `Loading`.
#[derive(Debug, Clone, Default, PartialEq)]
pub enum EngineStatus {
    #[default]
    Loading,
    /// `ready_ms`: when the engine opened, in ms from `performance.timeOrigin`.
    Ready {
        ready_ms: f64,
    },
    Failed(SharedString),
}

impl Global for EngineStatus {}

/// Why a bridge call didn't produce a result.
#[derive(Debug, Clone, PartialEq)]
pub enum EngineError {
    /// `cancel` was called for this request.
    Cancelled,
    /// DuckDB, the worker, or the network reported an error.
    Engine(String),
    /// The result bytes weren't a readable Arrow IPC stream.
    Decode(DecodeError),
}

impl fmt::Display for EngineError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Cancelled => f.write_str("cancelled"),
            Self::Engine(message) => f.write_str(message),
            Self::Decode(error) => write!(f, "{error}"),
        }
    }
}

impl std::error::Error for EngineError {}
