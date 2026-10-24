//! The table Tycho shows: `seiza-tall-table` over DuckDB (`seiza-duckdb`'s
//! `tall-table` feature), reading a Parquet file where it lies or a CSV's chunk
//! tables. Also what Tycho does with the table's events: the first-rows and
//! viewport-filled marks, and the probes the Playwright checks read.

use std::ops::Range;

use seiza_duckdb::tall_table::{PageQuery, ParquetFile, QueryRows};
use seiza_tall_table::{TallTableEvent, TallTableState};

pub use seiza_tall_table::init;

/// Where the table's rows come from.
#[derive(Debug, Clone, PartialEq)]
pub enum Source {
    /// A registered Parquet file, read where it lies.
    Parquet(ParquetFile),
    /// A CSV file's chunk tables, growing while it loads.
    Csv(crate::csv::Chunks),
}

impl PageQuery for Source {
    fn page_sql(&self, rows: Range<u64>) -> String {
        match self {
            Self::Parquet(file) => file.page_sql(rows),
            Self::Csv(chunks) => chunks.page_sql(rows),
        }
    }
}

pub type RowTable = TallTableState<QueryRows<Source>>;

/// Set right after each frame in which the viewport becomes fully loaded,
/// while [`crate::targets::measuring`].
const VIEWPORT_FILLED_MARK: &str = "tycho:viewport-filled";
/// Set right after the first such frame for a file.
#[cfg(target_family = "wasm")]
pub const FIRST_ROWS_MARK: &str = "tycho:first-rows";

/// The table's paging: the defaults, with `?page=`, `?prefetch=`, and
/// `?budget_mib=` from the URL applied (the page-size sweep sets them).
#[cfg(target_family = "wasm")]
fn paging() -> seiza_tall_table::Paging {
    let number = |key: &str| {
        seiza::url::param(key)
            .and_then(|value| value.parse::<u64>().ok())
            .filter(|value| *value > 0)
    };
    let mut paging = seiza_tall_table::Paging::default();
    if let Some(rows) = number("page") {
        paging.page_rows = rows;
    }
    if let Some(pages) = number("prefetch") {
        paging.prefetch = pages;
    }
    // Checked: `usize` is 32 bits on wasm32, and 4096 MiB would wrap to 0.
    if let Some(bytes) = number("budget_mib")
        .and_then(|mib| usize::try_from(mib).ok())
        .and_then(|mib| mib.checked_mul(1 << 20))
    {
        paging.budget_bytes = bytes;
    }
    paging
}

/// A table over `rows` rows of `source`. It records its scrolling while the
/// observation panel is open, and reports its probes while measuring.
#[cfg(target_family = "wasm")]
pub fn new(
    source: Source,
    rows: u64,
    columns: &[seiza_duckdb::sql::ColumnInfo],
    engine: seiza_duckdb::Engine,
    cx: &mut gpui_kit::Context<RowTable>,
) -> RowTable {
    let columns = columns
        .iter()
        .map(seiza_duckdb::sql::ColumnInfo::tall_table_column)
        .collect();
    RowTable::new(QueryRows::new(engine, source), columns, rows, paging(), cx)
        .with_activity(seiza_tall_table::ActivityOptions::new(
            seiza::perf::WINDOW_MS,
            seiza::marks::now,
            seiza::perf::is_visible,
        ))
        .probe_frames(crate::targets::measuring())
        .probe_cells(crate::targets::probing_cells())
}

/// A CSV chunk became `table`, holding `rows` more rows.
pub fn grow(table: &mut RowTable, chunk: String, rows: u64, cx: &mut gpui_kit::Context<RowTable>) {
    let Source::Csv(chunks) = table.delegate_mut().query_mut() else {
        return;
    };
    chunks.push(chunk, rows);
    let total = chunks.rows();
    table.set_rows(total, cx);
}

/// A later CSV chunk had values `widened` columns' types couldn't hold, so
/// they're text from here on: `columns` are the file's columns with them
/// widened. Pages already loaded keep their values; new reads cast the
/// earlier chunks' values to text too.
pub fn widen(
    table: &mut RowTable,
    widened: &[String],
    columns: &[seiza_duckdb::sql::ColumnInfo],
    cx: &mut gpui_kit::Context<RowTable>,
) {
    if let Source::Csv(chunks) = table.delegate_mut().query_mut() {
        for column in widened {
            chunks.widen(column);
        }
    }
    let columns = columns
        .iter()
        .map(seiza_duckdb::sql::ColumnInfo::tall_table_column)
        .collect();
    table.set_columns(columns, cx);
}

/// Reads a Parquet table's rows from `name` from now on (the same file,
/// registered again), and loads the pages whose reads failed again.
pub fn read_from(table: &mut RowTable, name: String, cx: &mut gpui_kit::Context<RowTable>) {
    if let Source::Parquet(file) = table.delegate_mut().query_mut() {
        file.set_name(name);
    }
    table.retry_failed(cx);
}

/// Publishes what the shown table reports for the scripts, through
/// `tall-table-bridge`: its scrollbar's targets, its probes
/// (`globalThis.__tychoTable`, `__tychoTableLayout`, and `__tychoCells`,
/// which the table reports only while measuring), and (while measuring)
/// the `tycho:viewport-filled` mark. The table emits these while its frame
/// renders, so a mark set here lands right after the frame is presented.
/// The first-rows mark is the workbench's, which also shows it in the panel.
pub fn publish(event: &TallTableEvent) {
    tall_table_bridge::Publish {
        // The mark is what the checks read, so it's set only while
        // measuring (marks are never cleared).
        filled_mark: crate::targets::measuring().then_some(VIEWPORT_FILLED_MARK),
        scrollbar: true,
        probe: Some("__tychoTable"),
        layout: Some("__tychoTableLayout"),
        cells: Some("__tychoCells"),
    }
    .event(event);
}
