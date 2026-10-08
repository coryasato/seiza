//! How big a file Tycho opens (M7, `perf/results/2026-10-08-m7-ceiling.md`).
//!
//! A Parquet file is read where it lies, so its size barely touches memory:
//! DuckDB held 2.8 MiB for a 4.6 GB file (1,659 row groups). What grows is
//! time, per row group: every page read sets up every group (CLAUDE.md,
//! DuckDB-Wasm gotchas). A CSV is copied into DuckDB's memory, about 0.28
//! bytes per byte of the asteroid CSV, and a load stops at
//! [`crate::csv::MEMORY_BUDGET`] whatever the file's size. The limits here
//! answer the obvious cases before anything is read.

const GB: u64 = 1_000_000_000;

/// The largest Parquet file Tycho opens.
pub const MAX_PARQUET_BYTES: u64 = 10 * GB;

/// The largest CSV Tycho starts loading: what the memory budget holds at
/// the asteroid CSV's compression (5.4 GB fit in 1.5 GiB), rounded up. A
/// CSV that compresses worse stops at the budget instead.
pub const MAX_CSV_BYTES: u64 = 6 * GB;

/// Why a file of `bytes` is too large to open, or None.
pub fn too_large(name: &str, bytes: u64, csv: bool) -> Option<String> {
    let gb = |bytes: u64| format!("{:.1} GB", bytes as f64 / GB as f64);
    if csv && bytes > MAX_CSV_BYTES {
        return Some(format!(
            "{name} is {}, too large: Tycho loads CSV files up to {}, because it copies them into memory, \
             and a browser tab's engine holds about 2 GB. Parquet files are read in place, up to {}.",
            gb(bytes),
            gb(MAX_CSV_BYTES),
            gb(MAX_PARQUET_BYTES)
        ));
    }
    if !csv && bytes > MAX_PARQUET_BYTES {
        return Some(format!(
            "{name} is {}, too large: Tycho opens Parquet files up to {}, the largest it's measured with.",
            gb(bytes),
            gb(MAX_PARQUET_BYTES)
        ));
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn limits_by_format() {
        assert_eq!(too_large("a.csv", MAX_CSV_BYTES, true), None);
        assert!(
            too_large("a.csv", MAX_CSV_BYTES + 1, true)
                .unwrap()
                .contains("CSV files up to 6.0 GB")
        );
        assert_eq!(too_large("a.parquet", MAX_CSV_BYTES + 1, false), None);
        assert!(
            too_large("a.parquet", MAX_PARQUET_BYTES + 1, false)
                .unwrap()
                .contains("too large")
        );
    }
}
