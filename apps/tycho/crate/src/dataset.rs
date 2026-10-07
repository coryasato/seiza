//! A registered file as the header strip shows it: schema, row count, size,
//! row groups, and the data credit, all read from Parquet metadata with SQL
//! (Tycho rule 2: no bridge call beyond the three).

use crate::arrow::{QueryResult, Value};

/// A sample dataset hosted on our origin (`/data/*`, served by the Worker).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Sample {
    /// What SQL calls it once registered.
    pub name: &'static str,
    pub url: &'static str,
}

/// The default sample: every known asteroid (PLAN.md, Sample datasets).
pub const ASTEROIDS: Sample = Sample {
    name: "asteroids.parquet",
    url: "/data/asteroids.parquet",
};

#[derive(Debug, Clone, PartialEq)]
pub struct ColumnInfo {
    pub name: String,
    /// DuckDB's type name, e.g. `BIGINT`, `VARCHAR`.
    pub data_type: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct FileSummary {
    pub name: String,
    /// Bytes, when the host knows them.
    pub bytes: Option<u64>,
    pub rows: u64,
    /// Parquet only.
    pub row_groups: Option<u64>,
    pub columns: Vec<ColumnInfo>,
    /// From the file's own key/value metadata (`tycho.credit`, `tycho.fetched`),
    /// which `data/prep.sql` writes. Files from elsewhere have none.
    pub credit: Option<String>,
}

/// `name` as a SQL string literal.
pub(crate) fn sql_string(name: &str) -> String {
    format!("'{}'", name.replace('\'', "''"))
}

/// The three metadata queries for a registered Parquet file, sent together:
/// its columns, its row and row-group counts, and its key/value metadata.
/// None of them reads row data, only the footer.
pub fn summary_queries(name: &str) -> [String; 3] {
    let file = sql_string(name);
    [
        format!("DESCRIBE SELECT * FROM read_parquet({file})"),
        format!("SELECT num_rows, num_row_groups FROM parquet_file_metadata({file})"),
        // Compared as bytes, and only our keys decoded: `decode` fails on
        // invalid UTF-8, and other writers may store binary entries. The
        // credit is optional, so a bad value is NULL, not an error.
        format!(
            "SELECT decode(key) AS key, try(decode(value)) AS value FROM parquet_kv_metadata({file}) \
             WHERE key IN ('tycho.credit'::BLOB, 'tycho.fetched'::BLOB)"
        ),
    ]
}

/// One page of rows, `rows` (0-based, end-exclusive), in file order.
///
/// A filter on `file_row_number`, which DuckDB matches against each row
/// group's range and so reads only the groups that hold the page: 50 ms and
/// 1.4 MB for a jump to row 90% of the asteroids, vs 61 ms for LIMIT/OFFSET
/// and a 1.1 s full download to ingest first (M4, perf/results/2026-09-25-m4.md).
pub fn page_sql(name: &str, rows: std::ops::Range<u64>) -> String {
    format!(
        "SELECT * EXCLUDE (file_row_number) FROM read_parquet({}, file_row_number = true) \
         WHERE file_row_number >= {} AND file_row_number < {} ORDER BY file_row_number",
        sql_string(name),
        rows.start,
        rows.end
    )
}

impl FileSummary {
    /// Builds the summary from [`summary_queries`]' results, in order.
    pub fn from_results(
        name: &str,
        bytes: Option<u64>,
        describe: &QueryResult,
        metadata: &QueryResult,
        kv: &QueryResult,
    ) -> Result<Self, String> {
        let name_column = column(describe, "column_name")?;
        let type_column = column(describe, "column_type")?;
        let columns = (0..describe.num_rows())
            .map(|row| {
                Ok(ColumnInfo {
                    name: text(describe, row, name_column)?,
                    data_type: text(describe, row, type_column)?,
                })
            })
            .collect::<Result<Vec<_>, String>>()?;
        if metadata.num_rows() != 1 {
            return Err(format!(
                "expected one row of Parquet file metadata, got {}",
                metadata.num_rows()
            ));
        }
        let rows = count(metadata, column(metadata, "num_rows")?)?;
        let row_groups = count(metadata, column(metadata, "num_row_groups")?)?;

        let (key, value) = (column(kv, "key")?, column(kv, "value")?);
        let lookup = |wanted: &str| {
            (0..kv.num_rows()).find_map(|row| {
                (text(kv, row, key).ok()? == wanted)
                    .then(|| text(kv, row, value).ok())
                    .flatten()
            })
        };
        let credit = lookup("tycho.credit").map(|credit| match lookup("tycho.fetched") {
            Some(date) => format!("{credit}, fetched {date}."),
            None => format!("{credit}."),
        });

        Ok(Self {
            name: name.to_owned(),
            bytes,
            rows,
            row_groups: Some(row_groups),
            columns,
            credit,
        })
    }
}

/// Registers `source` under the SQL name `name` and reads its summary, shown
/// as `display_name`. The three metadata queries go out together, each on its
/// own connection, once the Parquet extension is loaded
/// ([`crate::engine::Engine::load_parquet`]), so none of them autoloads it.
/// Each query's id goes to `sent` as it's sent, so a caller that gives up on
/// the open can cancel them. Also returns the file's live read counter.
#[cfg(target_family = "wasm")]
pub async fn open(
    engine: &crate::engine::Engine,
    name: &str,
    display_name: &str,
    source: crate::engine::FileSource,
    sent: impl Fn(crate::engine::RequestId),
) -> Result<(FileSummary, Option<crate::engine::ReadCounter>), crate::engine::EngineError> {
    // Independent: the extension download (several round trips on a slow
    // network) overlaps the registration. Both are sent before either is
    // awaited.
    let parquet = engine.load_parquet();
    let info = engine.register_file(name, source);
    let (info, parquet) = (info.await, parquet.await);
    parquet?;
    let info = info?;
    let [describe, metadata, kv] = summary_queries(name).map(|sql| {
        let (id, result) = engine.query(&sql);
        sent(id);
        result
    });
    let (describe, metadata, kv) = (describe.await?, metadata.await?, kv.await?);
    FileSummary::from_results(display_name, info.size, &describe, &metadata, &kv)
        .map(|summary| (summary, info.bytes_read))
        .map_err(crate::engine::EngineError::Engine)
}

pub(crate) fn column(result: &QueryResult, name: &str) -> Result<usize, String> {
    result
        .fields
        .iter()
        .position(|field| field.name == name)
        .ok_or_else(|| format!("metadata query has no `{name}` column"))
}

pub(crate) fn text(result: &QueryResult, row: usize, column: usize) -> Result<String, String> {
    match result.value(row, column) {
        Some(Value::Str(text)) => Ok(text.to_owned()),
        other => Err(format!("expected text, got {other:?}")),
    }
}

pub(crate) fn count(result: &QueryResult, column: usize) -> Result<u64, String> {
    match result.value(0, column) {
        Some(Value::Int(value)) if value >= 0 => Ok(value as u64),
        Some(Value::UInt(value)) => Ok(value),
        other => Err(format!("expected a count, got {other:?}")),
    }
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
    use std::sync::Arc;

    use arrow::array::{ArrayRef, Int64Array, StringArray, UInt64Array};
    use arrow::ipc::writer::StreamWriter;
    use arrow::record_batch::RecordBatch;

    use super::*;
    use crate::arrow::decode;

    fn result(columns: Vec<(&str, ArrayRef)>) -> QueryResult {
        let batch = RecordBatch::try_from_iter(columns).unwrap();
        let mut out = Vec::new();
        let mut writer = StreamWriter::try_new(&mut out, &batch.schema()).unwrap();
        writer.write(&batch).unwrap();
        writer.finish().unwrap();
        drop(writer);
        decode(out).unwrap()
    }

    fn strings(values: &[&str]) -> ArrayRef {
        Arc::new(StringArray::from(values.to_vec()))
    }

    /// What DuckDB's DESCRIBE returns (other columns omitted).
    fn describe() -> QueryResult {
        result(vec![
            ("column_name", strings(&["spkid", "full_name"])),
            ("column_type", strings(&["BIGINT", "VARCHAR"])),
            ("null", strings(&["YES", "YES"])),
        ])
    }

    fn metadata() -> QueryResult {
        result(vec![
            ("num_rows", Arc::new(Int64Array::from(vec![1_567_523]))),
            ("num_row_groups", Arc::new(Int64Array::from(vec![13]))),
        ])
    }

    #[test]
    fn summary_from_metadata() {
        let kv = result(vec![
            ("key", strings(&["tycho.fetched", "tycho.credit"])),
            (
                "value",
                strings(&["2026-09-24", "Asteroid data: NASA/JPL Small-Body Database"]),
            ),
        ]);
        let summary = FileSummary::from_results(
            "asteroids.parquet",
            Some(35_456_966),
            &describe(),
            &metadata(),
            &kv,
        )
        .unwrap();
        assert_eq!(summary.rows, 1_567_523);
        assert_eq!(summary.row_groups, Some(13));
        assert_eq!(
            summary.columns,
            vec![
                ColumnInfo {
                    name: "spkid".into(),
                    data_type: "BIGINT".into()
                },
                ColumnInfo {
                    name: "full_name".into(),
                    data_type: "VARCHAR".into()
                },
            ]
        );
        assert_eq!(
            summary.credit.as_deref(),
            Some("Asteroid data: NASA/JPL Small-Body Database, fetched 2026-09-24.")
        );
    }

    #[test]
    fn no_credit_without_metadata() {
        let kv = result(vec![("key", strings(&[])), ("value", strings(&[]))]);
        let summary =
            FileSummary::from_results("x.parquet", None, &describe(), &metadata(), &kv).unwrap();
        assert_eq!(summary.credit, None);
    }

    #[test]
    fn unsigned_counts_and_missing_columns() {
        let metadata = result(vec![
            ("num_rows", Arc::new(UInt64Array::from(vec![5u64]))),
            ("num_row_groups", Arc::new(UInt64Array::from(vec![1u64]))),
        ]);
        let kv = result(vec![("key", strings(&[])), ("value", strings(&[]))]);
        let summary =
            FileSummary::from_results("x.parquet", None, &describe(), &metadata, &kv).unwrap();
        assert_eq!((summary.rows, summary.row_groups), (5, Some(1)));

        let broken = result(vec![("num_rows", Arc::new(Int64Array::from(vec![5])))]);
        assert!(FileSummary::from_results("x", None, &describe(), &broken, &kv).is_err());
    }

    #[test]
    fn queries_quote_the_name() {
        let [describe, ..] = summary_queries("it's.parquet");
        assert_eq!(
            describe,
            "DESCRIBE SELECT * FROM read_parquet('it''s.parquet')"
        );
    }

    #[test]
    fn page_query_filters_on_file_row_number() {
        assert_eq!(
            page_sql("it's.parquet", 2048..3072),
            "SELECT * EXCLUDE (file_row_number) FROM read_parquet('it''s.parquet', file_row_number = true) \
             WHERE file_row_number >= 2048 AND file_row_number < 3072 ORDER BY file_row_number"
        );
    }

    #[test]
    fn kv_query_never_decodes_other_keys() {
        let [.., kv] = summary_queries("x.parquet");
        assert!(kv.contains("WHERE key IN ('tycho.credit'::BLOB, 'tycho.fetched'::BLOB)"));
        assert!(kv.contains("try(decode(value))"));
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
