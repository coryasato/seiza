//! A registered file as the header strip shows it: schema, row count, size,
//! row groups, and the data credit, all read from Parquet metadata with SQL
//! (the engine's rule 2: no bridge call beyond the three; the queries are
//! `seiza_duckdb::tall_table`'s).

use seiza_duckdb::sql::ColumnInfo;
use seiza_duckdb::tall_table::ParquetSummary;

/// A sample dataset hosted on our origin (`/data/*`, served by the Worker).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Sample {
    /// What SQL calls it once registered.
    pub name: &'static str,
    pub url: &'static str,
    /// Its button's element id, which the Playwright checks click by.
    pub target: &'static str,
    pub label: &'static str,
}

/// The default sample: every known asteroid (docs/data.md).
pub const ASTEROIDS: Sample = Sample {
    name: "asteroids.parquet",
    url: "/data/asteroids.parquet",
    target: "try-sample-asteroids",
    label: "Try sample: every known asteroid",
};

/// The big sample: Gaia DR3's 25 M brightest stars (docs/data.md).
/// Its ESA credit is in the file's metadata, like the asteroids'.
pub const GAIA: Sample = Sample {
    name: "gaia-dr3-bright.parquet",
    url: "/data/gaia-dr3-bright.parquet",
    target: "try-sample-gaia",
    label: "Big: 25M Gaia stars",
};

#[derive(Debug, Clone, PartialEq)]
pub struct FileSummary {
    pub name: String,
    /// Bytes, when the host knows them.
    pub bytes: Option<u64>,
    pub rows: u64,
    /// Parquet only.
    pub row_groups: Option<u64>,
    pub columns: Vec<ColumnInfo>,
    /// From the file's own key/value metadata ([`CREDIT_KEY`],
    /// [`FETCHED_KEY`]), which `data/prep.sql` writes. Files from elsewhere
    /// have none.
    pub credit: Option<String>,
}

/// The Parquet metadata keys `data/prep.sql` writes the data's credit and
/// the date it was fetched under.
const CREDIT_KEY: &str = "tycho.credit";
const FETCHED_KEY: &str = "tycho.fetched";

impl FileSummary {
    /// A Parquet file's summary, shown as `name`, with its credit.
    pub fn parquet(name: &str, summary: ParquetSummary) -> Self {
        let credit = credit(summary.metadata(CREDIT_KEY), summary.metadata(FETCHED_KEY));
        Self {
            name: name.to_owned(),
            bytes: summary.bytes,
            rows: summary.rows,
            row_groups: Some(summary.row_groups),
            columns: summary.columns,
            credit,
        }
    }
}

/// The credit line: the data's credit, and when it was fetched if known.
fn credit(credit: Option<&str>, fetched: Option<&str>) -> Option<String> {
    credit.map(|credit| match fetched {
        Some(date) => format!("{credit}, fetched {date}."),
        None => format!("{credit}."),
    })
}

/// Registers `source` under the SQL name `name` and reads its summary, shown
/// as `display_name` ([`seiza_duckdb::tall_table::open_parquet`]). Each query's id
/// goes to `sent` as it's sent. Also returns the file's live read counter.
#[cfg(target_family = "wasm")]
pub async fn open(
    engine: &seiza_duckdb::Engine,
    name: &str,
    display_name: &str,
    source: seiza_duckdb::FileSource,
    sent: impl Fn(seiza_duckdb::RequestId),
) -> Result<(FileSummary, Option<seiza_duckdb::ReadCounter>), seiza_duckdb::EngineError> {
    let (summary, counter) = seiza_duckdb::tall_table::open_parquet(
        engine,
        name,
        source,
        &[CREDIT_KEY, FETCHED_KEY],
        sent,
    )
    .await?;
    Ok((FileSummary::parquet(display_name, summary), counter))
}

/// `1567523` → `1,567,523`.
pub fn format_count(value: u64) -> String {
    let digits = value.to_string();
    let mut out = String::with_capacity(digits.len() + digits.len() / 3);
    for (index, digit) in digits.chars().enumerate() {
        if index > 0 && (digits.len() - index).is_multiple_of(3) {
            out.push(',');
        }
        out.push(digit);
    }
    out
}

/// Binary units, one decimal from KiB up: `35456966` → `33.8 MiB`.
pub fn format_bytes(bytes: u64) -> String {
    const UNITS: [&str; 4] = ["KiB", "MiB", "GiB", "TiB"];
    /// Moves up a unit at what would print as `1024.0`.
    const NEXT: f64 = 1023.95;
    if bytes < 1024 {
        return format!("{bytes} B");
    }
    let mut value = bytes as f64 / 1024.0;
    let mut unit = 0;
    while value >= NEXT && unit < UNITS.len() - 1 {
        value /= 1024.0;
        unit += 1;
    }
    format!("{value:.1} {}", UNITS[unit])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn credit_line() {
        assert_eq!(
            credit(
                Some("Asteroid data: NASA/JPL Small-Body Database"),
                Some("2026-09-24")
            )
            .as_deref(),
            Some("Asteroid data: NASA/JPL Small-Body Database, fetched 2026-09-24.")
        );
        assert_eq!(
            credit(Some("Data: ESA"), None).as_deref(),
            Some("Data: ESA.")
        );
        assert_eq!(credit(None, Some("2026-09-24")), None);
    }

    #[test]
    fn formats() {
        assert_eq!(format_count(0), "0");
        assert_eq!(format_count(999), "999");
        assert_eq!(format_count(1_000), "1,000");
        assert_eq!(format_count(1_567_523), "1,567,523");
        assert_eq!(format_bytes(512), "512 B");
        assert_eq!(format_bytes(35_456_966), "33.8 MiB");
        assert_eq!(format_bytes(3 * 1024 * 1024 * 1024), "3.0 GiB");
        // Just under a unit boundary: never "1024.0 KiB".
        assert_eq!(format_bytes(1_048_575), "1.0 MiB");
        assert_eq!(format_bytes(1_048_524), "1023.9 KiB");
        assert_eq!(format_bytes(1024 * 1024 * 1024 - 1), "1.0 GiB");
    }
}
