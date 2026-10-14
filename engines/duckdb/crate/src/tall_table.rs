//! The `tall-table` feature: DuckDB as a `seiza-tall-table` source. A query
//! result is a page of rows ([`TallTablePage`]), [`QueryRows`] reads pages with
//! whatever SQL a [`PageQuery`] writes, and [`ParquetFile`] is the query for a
//! registered Parquet file, with its summary ([`ParquetSummary`]) read from
//! the footer.

use std::borrow::Cow;
use std::ops::Range;

use gpui_kit::App;
use seiza_tall_table::{
    CellValue, ColumnKind, PageError, PageLoad, TallTableColumn, TallTableDelegate, TallTablePage,
};

use crate::arrow::{QueryResult, Value};
use crate::sql::{ColumnInfo, column, count, string_literal, text};

impl TallTablePage for QueryResult {
    fn value(&self, row: usize, column: usize) -> Option<CellValue<'_>> {
        QueryResult::value(self, row, column).map(cell_value)
    }

    fn heap_bytes(&self) -> usize {
        QueryResult::heap_bytes(self)
    }
}

/// A value as the table shows it: floats stay numbers (the table rounds
/// them to their column), text stays borrowed, and everything else is its
/// text as [`Value`]'s `Display` writes it.
fn cell_value(value: Value<'_>) -> CellValue<'_> {
    match value {
        Value::Null => CellValue::Null,
        Value::Float(value) => CellValue::Float(value),
        Value::Float32(value) => CellValue::Float32(value),
        Value::Str(text) => CellValue::Text(Cow::Borrowed(text)),
        value => CellValue::Text(Cow::Owned(value.to_string())),
    }
}

impl ColumnInfo {
    /// The column as the table lays it out, by its DuckDB type: integers fit
    /// their type's widest value (`-128`, `-32768`, `-2147483648`, …), and a
    /// 128-bit integer's 40 digits would be a wall, so it gets BIGINT's 20
    /// and the rest is cut in the middle.
    pub fn tall_table_column(&self) -> TallTableColumn {
        let data_type = self.data_type.as_str();
        let integer = |max_chars| ColumnKind::Integer { max_chars };
        let kind = match data_type {
            "BOOLEAN" => ColumnKind::Boolean,
            "DATE" => ColumnKind::Date,
            "TINYINT" => integer(4),
            "SMALLINT" => integer(6),
            "INTEGER" => integer(11),
            "UTINYINT" => integer(3),
            "USMALLINT" => integer(5),
            "UINTEGER" => integer(10),
            "BIGINT" | "UBIGINT" | "HUGEINT" | "UHUGEINT" => integer(20),
            "FLOAT" | "DOUBLE" => ColumnKind::Float,
            _ if data_type.starts_with("DECIMAL") => ColumnKind::Decimal,
            _ if data_type.starts_with("TIMESTAMP") => ColumnKind::Timestamp,
            _ => ColumnKind::Text,
        };
        TallTableColumn::new(self.name.clone(), kind)
    }
}

/// The SQL for a page of rows.
pub trait PageQuery: 'static {
    /// The query for `rows` (0-based, end-exclusive), in order.
    fn page_sql(&self, rows: Range<u64>) -> String;
}

/// A table's rows, read a page at a time with `query`'s SQL through the
/// engine.
pub struct QueryRows<Q> {
    query: Q,
    #[cfg(target_family = "wasm")]
    engine: crate::Engine,
    /// Outside the browser: the next read's id, so each has its own.
    #[cfg(not(target_family = "wasm"))]
    next_request: u32,
}

impl<Q: PageQuery> QueryRows<Q> {
    #[cfg(target_family = "wasm")]
    pub fn new(engine: crate::Engine, query: Q) -> Self {
        Self { query, engine }
    }

    /// Outside the browser there's no engine: every page fails.
    #[cfg(not(target_family = "wasm"))]
    pub fn new(query: Q) -> Self {
        Self {
            query,
            next_request: 0,
        }
    }

    pub fn query(&self) -> &Q {
        &self.query
    }

    /// For a query that changes (a source that grows, a file registered
    /// again). Pages already loaded keep their rows.
    pub fn query_mut(&mut self) -> &mut Q {
        &mut self.query
    }
}

impl<Q: PageQuery> TallTableDelegate for QueryRows<Q> {
    type Page = QueryResult;
    #[cfg(target_family = "wasm")]
    type Request = crate::RequestId;
    #[cfg(not(target_family = "wasm"))]
    type Request = u32;

    fn load_page(
        &mut self,
        rows: Range<u64>,
        _: &mut App,
    ) -> (Self::Request, PageLoad<Self::Page>) {
        #[cfg(target_family = "wasm")]
        {
            let (request, result) = self.engine.query(&self.query.page_sql(rows));
            (
                request,
                Box::pin(async move { result.await.map_err(page_error) }),
            )
        }
        #[cfg(not(target_family = "wasm"))]
        {
            let _ = rows;
            let request = self.next_request;
            self.next_request = request.wrapping_add(1);
            let error = PageError::Failed {
                message: "there's no engine outside the browser".into(),
                read_failure: false,
            };
            (request, Box::pin(async move { Err(error) }))
        }
    }

    fn cancel(&mut self, request: Self::Request, _: &mut App) {
        #[cfg(target_family = "wasm")]
        self.engine.cancel(request);
        #[cfg(not(target_family = "wasm"))]
        let _ = request;
    }
}

#[cfg(target_family = "wasm")]
fn page_error(error: crate::EngineError) -> PageError {
    match error {
        crate::EngineError::Cancelled => PageError::Cancelled,
        error => PageError::Failed {
            read_failure: error.is_read_failure(),
            message: error.to_string(),
        },
    }
}

/// A registered Parquet file's rows, by its SQL name.
#[derive(Debug, Clone, PartialEq)]
pub struct ParquetFile {
    name: String,
}

impl ParquetFile {
    pub fn new(name: impl Into<String>) -> Self {
        Self { name: name.into() }
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    /// Reads from `name` from now on: the same file, registered again.
    pub fn set_name(&mut self, name: impl Into<String>) {
        self.name = name.into();
    }
}

impl PageQuery for ParquetFile {
    /// A filter on `file_row_number`, which DuckDB matches against each row
    /// group's range and so reads only the groups that hold the page
    /// (`docs/DECISIONS.md`, "Table source").
    fn page_sql(&self, rows: Range<u64>) -> String {
        format!(
            "SELECT * EXCLUDE (file_row_number) FROM read_parquet({}, file_row_number = true) \
             WHERE file_row_number >= {} AND file_row_number < {} ORDER BY file_row_number",
            string_literal(&self.name),
            rows.start,
            rows.end
        )
    }
}

/// A registered Parquet file as its footer describes it.
#[derive(Debug, Clone, PartialEq)]
#[non_exhaustive]
pub struct ParquetSummary {
    /// Bytes, when the source knows them.
    pub bytes: Option<u64>,
    pub rows: u64,
    pub row_groups: u64,
    pub columns: Vec<ColumnInfo>,
    /// The key/value metadata asked for that the file holds, as text, in
    /// the file's order. A value that isn't UTF-8 is left out.
    pub metadata: Vec<(String, String)>,
}

/// The three metadata queries for a registered Parquet file, sent together:
/// its columns, its row and row-group counts, and its key/value metadata
/// under `keys` (with no keys, a query that returns nothing: don't send it).
/// None of them reads row data, only the footer.
pub fn summary_queries(name: &str, keys: &[&str]) -> [String; 3] {
    let file = string_literal(name);
    let keys = if keys.is_empty() {
        "false".to_owned()
    } else {
        let keys: Vec<String> = keys
            .iter()
            .map(|key| format!("{}::BLOB", string_literal(key)))
            .collect();
        format!("key IN ({})", keys.join(", "))
    };
    [
        format!("DESCRIBE SELECT * FROM read_parquet({file})"),
        format!("SELECT num_rows, num_row_groups FROM parquet_file_metadata({file})"),
        // Compared as bytes, and only the asked-for keys decoded: `decode`
        // fails on invalid UTF-8, and writers may store binary entries. A
        // bad value is NULL, not an error.
        format!(
            "SELECT decode(key) AS key, try(decode(value)) AS value FROM parquet_kv_metadata({file}) \
             WHERE {keys}"
        ),
    ]
}

impl ParquetSummary {
    /// Builds the summary from [`summary_queries`]' results, in order; `kv`
    /// is `None` when no metadata keys were asked for (its query isn't sent).
    pub fn from_results(
        bytes: Option<u64>,
        describe: &QueryResult,
        metadata: &QueryResult,
        kv: Option<&QueryResult>,
    ) -> Result<Self, String> {
        let name_column = column(describe, "column_name")?;
        let type_column = column(describe, "column_type")?;
        let columns = (0..describe.num_rows())
            .map(|row| {
                Ok(ColumnInfo::new(
                    text(describe, row, name_column)?,
                    text(describe, row, type_column)?,
                ))
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
        let metadata = match kv {
            Some(kv) => {
                let (key, value) = (column(kv, "key")?, column(kv, "value")?);
                (0..kv.num_rows())
                    .filter_map(|row| Some((text(kv, row, key).ok()?, text(kv, row, value).ok()?)))
                    .collect()
            }
            None => Vec::new(),
        };
        Ok(Self {
            bytes,
            rows,
            row_groups,
            columns,
            metadata,
        })
    }

    /// The metadata value under `key`, if the file has it.
    pub fn metadata(&self, key: &str) -> Option<&str> {
        self.metadata
            .iter()
            .find(|(found, _)| found == key)
            .map(|(_, value)| value.as_str())
    }
}

/// Registers `source` under the SQL name `name` and reads its summary, with
/// the metadata under `keys`. The three metadata queries go out together,
/// each on its own connection, once the Parquet extension is loaded
/// ([`crate::Engine::load_parquet`]), so none of them autoloads it. Each
/// query's id goes to `sent` as it's sent, so a caller that gives up on the
/// open can cancel them. Also returns the file's live read counter.
#[cfg(target_family = "wasm")]
pub async fn open_parquet(
    engine: &crate::Engine,
    name: &str,
    source: crate::FileSource,
    keys: &[&str],
    sent: impl Fn(crate::RequestId),
) -> Result<(ParquetSummary, Option<crate::ReadCounter>), crate::EngineError> {
    // Independent: the extension download (several round trips on a slow
    // network) overlaps the registration. Both are sent before either is
    // awaited.
    let parquet = engine.load_parquet();
    let info = engine.register_file(name, source);
    let (info, parquet) = (info.await, parquet.await);
    parquet?;
    let info = info?;
    let [describe, metadata, kv] = summary_queries(name, keys);
    let send = |sql: String| {
        let (id, result) = engine.query(&sql);
        sent(id);
        result
    };
    let (describe, metadata) = (send(describe), send(metadata));
    // No keys asked for: no third query.
    let kv = (!keys.is_empty()).then(|| send(kv));
    let (describe, metadata) = (describe.await?, metadata.await?);
    let kv = match kv {
        Some(kv) => Some(kv.await?),
        None => None,
    };
    ParquetSummary::from_results(info.size, &describe, &metadata, kv.as_ref())
        .map(|summary| (summary, info.bytes_read))
        .map_err(crate::EngineError::Engine)
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
            ("key", strings(&["app.fetched", "app.credit"])),
            ("value", strings(&["2026-09-24", "Asteroid data: NASA/JPL"])),
        ]);
        let summary =
            ParquetSummary::from_results(Some(35_456_966), &describe(), &metadata(), Some(&kv))
                .unwrap();
        assert_eq!((summary.rows, summary.row_groups), (1_567_523, 13));
        assert_eq!(
            summary.columns,
            vec![
                ColumnInfo::new("spkid", "BIGINT"),
                ColumnInfo::new("full_name", "VARCHAR")
            ]
        );
        assert_eq!(
            summary.metadata("app.credit"),
            Some("Asteroid data: NASA/JPL")
        );
        assert_eq!(summary.metadata("app.fetched"), Some("2026-09-24"));
        assert_eq!(summary.metadata("other"), None);
    }

    #[test]
    fn unsigned_counts_and_missing_columns() {
        let metadata = result(vec![
            ("num_rows", Arc::new(UInt64Array::from(vec![5u64]))),
            ("num_row_groups", Arc::new(UInt64Array::from(vec![1u64]))),
        ]);
        let kv = result(vec![("key", strings(&[])), ("value", strings(&[]))]);
        let summary =
            ParquetSummary::from_results(None, &describe(), &metadata, Some(&kv)).unwrap();
        assert_eq!((summary.rows, summary.row_groups), (5, 1));
        assert!(summary.metadata.is_empty());

        let broken = result(vec![("num_rows", Arc::new(Int64Array::from(vec![5])))]);
        assert!(ParquetSummary::from_results(None, &describe(), &broken, Some(&kv)).is_err());
        let none = ParquetSummary::from_results(None, &describe(), &metadata, None).unwrap();
        assert!(none.metadata.is_empty());
    }

    #[test]
    fn queries_quote_the_name_and_keys() {
        let [describe, _, kv] = summary_queries("it's.parquet", &["a.credit", "it's"]);
        assert_eq!(
            describe,
            "DESCRIBE SELECT * FROM read_parquet('it''s.parquet')"
        );
        assert!(kv.contains("WHERE key IN ('a.credit'::BLOB, 'it''s'::BLOB)"));
        assert!(kv.contains("try(decode(value))"));
        let [.., none] = summary_queries("x.parquet", &[]);
        assert!(none.ends_with("WHERE false"));
    }

    #[test]
    fn page_query_filters_on_file_row_number() {
        assert_eq!(
            ParquetFile::new("it's.parquet").page_sql(2048..3072),
            "SELECT * EXCLUDE (file_row_number) FROM read_parquet('it''s.parquet', file_row_number = true) \
             WHERE file_row_number >= 2048 AND file_row_number < 3072 ORDER BY file_row_number"
        );
    }

    #[test]
    fn columns_by_type() {
        let kind = |data_type: &str| ColumnInfo::new("c", data_type).tall_table_column().kind();
        assert_eq!(kind("INTEGER"), ColumnKind::Integer { max_chars: 11 });
        assert_eq!(kind("HUGEINT"), ColumnKind::Integer { max_chars: 20 });
        assert_eq!(kind("DOUBLE"), ColumnKind::Float);
        assert_eq!(kind("DECIMAL(18,3)"), ColumnKind::Decimal);
        assert_eq!(kind("TIMESTAMP WITH TIME ZONE"), ColumnKind::Timestamp);
        assert_eq!(kind("VARCHAR"), ColumnKind::Text);
    }

    #[test]
    fn values_for_the_table() {
        assert_eq!(cell_value(Value::Null), CellValue::Null);
        assert_eq!(cell_value(Value::Float(0.5)), CellValue::Float(0.5));
        assert_eq!(
            cell_value(Value::Str("a")),
            CellValue::Text(Cow::Borrowed("a"))
        );
        assert_eq!(
            cell_value(Value::Int(-3)),
            CellValue::Text(Cow::Owned("-3".into()))
        );
        assert_eq!(cell_value(Value::Date(0)).to_string(), "1970-01-01");
    }
}
