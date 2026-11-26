//! DuckDB-Wasm for GPUI apps: the engine as the UI sees it (its load status
//! and errors), the Arrow IPC reader for its results, and (on the web) the
//! client that queries it through `@seiza/duckdb`'s bridge
//! (`engines/duckdb/web/`).
//!
//! It knows no app and doesn't depend on `seiza`: what the host shows about
//! the engine's load (panel rows, marks) comes from [`EngineEvent`]s.
//!
//! The `tall-table` feature makes it a `seiza-tall-table` source
//! ([`tall_table`]): query results as pages of rows, and registered Parquet
//! files read a page at a time; and a source's rows filtered and sorted in
//! DuckDB ([`view`]), searched with `find`.

use std::fmt;

use gpui_kit::{Global, SharedString};

pub mod arrow;
#[cfg(target_family = "wasm")]
mod bridge;
pub mod sql;
#[cfg(feature = "tall-table")]
pub mod tall_table;
#[cfg(feature = "tall-table")]
pub mod view;

use arrow::DecodeError;

#[cfg(target_family = "wasm")]
pub use bridge::{
    Bridge, ENGINE_READY_MARK, ENGINE_START_MARK, Engine, FileInfo, FileSource, ReadCounter,
    RequestId, WARM_UP_SQL, init, retry, start, start_locked,
};

/// A host's lockdown of the engine: once it's on, no query reads or writes
/// anything but the files registered under one directory, and nothing
/// changes a setting, loads an extension, or attaches a database
/// (`docs/DECISIONS.md`, "Engine and bridge"). Off unless a host asks for
/// it ([`start_locked`]); the directory is the host's, since the engine
/// knows no app.
#[derive(Debug, Clone, PartialEq)]
pub struct Lockdown {
    directory: String,
    before: Vec<String>,
}

impl Lockdown {
    /// Allows reads and writes under `directory` alone: one name of ASCII
    /// letters, digits, `-`, or `_` (it's written into SQL and into paths).
    ///
    /// # Panics
    ///
    /// If `directory` is empty or holds any other character.
    pub fn new(directory: impl Into<String>) -> Self {
        let directory = directory.into();
        assert!(
            !directory.is_empty()
                && directory
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_'),
            "a lockdown's directory is one plain name, not {directory:?}"
        );
        Self {
            directory,
            before: Vec::new(),
        }
    }

    /// Runs `sql` before the lock, after the Parquet extension has loaded:
    /// what the host can't send once it's on (an `ATTACH`, a `SET`). Each
    /// statement must be safe to run twice (`IF NOT EXISTS`): after a
    /// failure, Retry runs the steps that didn't finish again.
    pub fn before(mut self, sql: impl Into<String>) -> Self {
        self.before.push(sql.into());
        self
    }

    /// `name` inside the directory: what a host registers a file as.
    pub fn path(&self, name: &str) -> String {
        format!("{}/{name}", self.directory)
    }

    /// The statements that lock the engine, in order: the host's, then the
    /// three that lock it. `enable_external_access = false` alone would
    /// refuse every registered file too; `allowed_directories` lets the
    /// directory's through, and `lock_configuration` keeps any `SET` from
    /// undoing it. `LOAD` is refused once external access is off, so every
    /// extension loads before (the Parquet extension, by [`start_locked`]).
    pub fn steps(&self) -> Vec<String> {
        let mut steps = self.before.clone();
        steps.push(format!(
            "SET allowed_directories = [{}]",
            sql::string_literal(&format!("{}/", self.directory))
        ));
        steps.push("SET enable_external_access = false".into());
        steps.push("SET lock_configuration = true".into());
        steps
    }
}

/// Whether DuckDB can take queries yet. The engine starts loading right after
/// the first frame, so the first frame always shows `Loading`. With a
/// [`Lockdown`], it's `Ready` only once the lockdown is on, so a host that
/// opens files only while `Ready` never opens one on an unlocked engine.
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
/// `ParquetFailed`, a `ParquetReady` when a later load succeeds. With a
/// [`Lockdown`], the prefetch's event is followed by exactly one of `Locked`
/// or `LockFailed`. The host gets them through the handler it passes to
/// [`start`]; [`EngineStatus`] is the global to observe for what the UI says.
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
    /// After a [`retry`] on a worker that had it loaded (a failed lockdown
    /// step), `at` is this start's ready time.
    ParquetReady { at: f64 },
    /// The prefetch couldn't load the Parquet extension. The next
    /// `load_parquet` tries again.
    ParquetFailed { at: f64 },
    /// The [`Lockdown`] is on: [`EngineStatus::Ready`] is set with it.
    Locked { at: f64 },
    /// The [`Lockdown`] couldn't finish: the Parquet extension didn't load
    /// or one of its statements failed ([`EngineStatus::Failed`] is set, and
    /// [`retry`] runs what didn't finish again), or the worker stopped under
    /// it ([`EngineStatus::Stopped`], and [`retry`] starts over on a new one).
    LockFailed { at: f64 },
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

    #[test]
    fn a_lockdown_runs_the_hosts_sql_then_locks() {
        let lockdown = Lockdown::new("app").before("ATTACH IF NOT EXISTS ':memory:' AS t");
        assert_eq!(lockdown.path("file-1.parquet"), "app/file-1.parquet");
        assert_eq!(
            lockdown.steps(),
            [
                "ATTACH IF NOT EXISTS ':memory:' AS t",
                "SET allowed_directories = ['app/']",
                "SET enable_external_access = false",
                "SET lock_configuration = true",
            ]
        );
    }

    #[test]
    #[should_panic(expected = "one plain name")]
    fn a_lockdowns_directory_is_one_plain_name() {
        Lockdown::new("app/../x");
    }
}
