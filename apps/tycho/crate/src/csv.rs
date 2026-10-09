//! CSV files (M6): cut into chunks at record boundaries, each chunk copied
//! into its own DuckDB table as it's read, so the first rows show after one
//! small chunk and the row count grows while the rest loads.
//!
//! Why not query the file where it lies, as Parquet is: CSV has no index, so
//! every page read parses from the top. On the 1 GB test file a page at 90%
//! took 5.1 s, and `count(*)` 3.3 s (`perf/ingest.ts`, M6 results).
//!
//! Why one table per chunk, not one table appended to: appends into one
//! growing table stalled for 200–600 ms every few chunks inside DuckDB (not
//! parsing, not GC, not memory growth), which broke the 500 ms row-count
//! budget, and small appends cost memory (1.2 GB at 4 MiB chunks). Each
//! chunk as `CREATE TABLE … AS` never stalls past ~215 ms. The tables live
//! in an attached in-memory database with compression on: 300 MiB of
//! DuckDB memory for the 1 GB file, against 2.1 GiB without.
//!
//! Chunks are `File` slices (no copy) registered through the bridge's
//! `registerFile`: no new bridge call. Records are found here, not by DuckDB:
//! a quoted field can hold a newline, so a chunk can end only where
//! [`Records`] says a record does.

use std::ops::Range;

use crate::arrow::{QueryResult, Value};
use crate::dataset::{ColumnInfo, column, count, sql_string, text};

/// The attached database the chunk tables live in. In memory, compressed:
/// DuckDB doesn't compress an in-memory database unless asked.
pub const ATTACH_SQL: &str = "ATTACH IF NOT EXISTS ':memory:' AS tycho_csv (COMPRESS)";

/// Each open's chunk tables go in their own schema, so one statement drops
/// them all.
pub fn schema_sql(open: u64) -> String {
    format!("CREATE SCHEMA IF NOT EXISTS tycho_csv.f{open}")
}

/// Drops an open's chunk tables. A chunk that's still being created when
/// this runs fails (its schema is gone) instead of leaking.
pub fn drop_sql(open: u64) -> String {
    format!("DROP SCHEMA IF EXISTS tycho_csv.f{open} CASCADE")
}

/// Chunk `index` of open `open`: its table.
pub fn table(open: u64, index: u64) -> String {
    format!("tycho_csv.f{open}.c{index}")
}

/// Chunk `index` of open `open`: the name its bytes are registered under.
/// Ours, never the file's (as for Parquet: `read_csv` would glob it).
pub fn chunk_file(open: u64, index: u64) -> String {
    format!("file-{open}-{index}.csv")
}

/// How the file is written, read with `sniff_csv` from its first chunk, and
/// its columns. One row per column; the dialect repeats on every row.
pub fn sniff_sql(file: &str) -> String {
    format!(
        "SELECT Delimiter, Quote, Escape, NewLineDelimiter, Comment, SkipRows, HasHeader, \
         DateFormat, TimestampFormat, unnest(Columns, recursive := true) FROM sniff_csv({})",
        sql_string(file)
    )
}

/// Copies chunk `file` into `table`. DuckDB answers with a `Count` column.
/// With `numbered`, each row also gets its place in the chunk as
/// [`NUMBER_COLUMN`] (see [`row_column`]).
pub fn create_sql(table: &str, file: &str, options: &str, numbered: bool) -> String {
    let number = if numbered {
        format!("row_number() OVER () - 1 AS {NUMBER_COLUMN}, ")
    } else {
        String::new()
    };
    format!(
        "CREATE TABLE {table} AS SELECT {number}* FROM read_csv({}, {options})",
        sql_string(file)
    )
}

/// The row number column a chunk table gets when the file has its own
/// `rowid` column.
pub const NUMBER_COLUMN: &str = "__tycho_row";

/// What a chunk table's rows are paged by: DuckDB's `rowid`, their place in
/// the table. A real column named `rowid` (SQLite and pandas exports have
/// one) hides it, so such a file's tables number their rows themselves:
/// `row_number() OVER ()` streams in file order, but costs ~2.6× natively,
/// so only these files pay it.
pub fn row_column(columns: &[ColumnInfo]) -> &'static str {
    if columns
        .iter()
        .any(|column| column.name.eq_ignore_ascii_case("rowid"))
    {
        NUMBER_COLUMN
    } else {
        "rowid"
    }
}

/// How a CSV file is written.
#[derive(Debug, Clone, PartialEq)]
pub struct Dialect {
    pub delimiter: String,
    /// None: fields are never quoted.
    pub quote: Option<u8>,
    pub escape: Option<u8>,
    /// As DuckDB writes it: `\n`, `\r\n`, or `\r`, escaped.
    pub new_line: String,
    pub comment: Option<String>,
    /// Lines before the header (or the first record).
    pub skip_rows: u64,
    pub header: bool,
    pub date_format: Option<String>,
    pub timestamp_format: Option<String>,
}

impl Default for Dialect {
    /// RFC 4180: commas, double quotes escaped by doubling, a header.
    fn default() -> Self {
        Self {
            delimiter: ",".into(),
            quote: Some(b'"'),
            escape: Some(b'"'),
            new_line: "\\n".into(),
            comment: None,
            skip_rows: 0,
            header: true,
            date_format: None,
            timestamp_format: None,
        }
    }
}

impl Dialect {
    /// The dialect and columns from [`sniff_sql`]'s result.
    ///
    /// DuckDB's sniffer reports no quote when the sample has none. That's
    /// the usual case for a first chunk (quoting is rare, and it's what's
    /// quoted that's rare); the test fixture's quoted rows are at its end.
    /// Without a quote, a quoted comma splits a field and a quoted newline
    /// splits a record, so the ingest would fail late. RFC 4180's double
    /// quote is assumed instead: a file with no quotes reads the same, and
    /// a quote inside an unquoted field stays literal (`12" pizza`), for
    /// DuckDB and for [`Records`]. Except for tab-separated files, which
    /// are conventionally never quoted: there the sniffer is trusted.
    pub fn from_sniff(result: &QueryResult) -> Result<(Self, Vec<ColumnInfo>), String> {
        if result.num_rows() == 0 {
            return Err("DuckDB found no columns in it".into());
        }
        let at = |name: &str| column(result, name);
        let optional = |name: &str| -> Result<Option<String>, String> {
            let index = at(name)?;
            Ok(match result.value(0, index) {
                Some(Value::Str(value)) if !value.is_empty() && value != "(empty)" => {
                    Some(value.to_owned())
                }
                _ => None,
            })
        };
        let single = |value: Option<String>| -> Option<u8> {
            value.and_then(|value| match value.as_bytes() {
                [byte] => Some(*byte),
                _ => None,
            })
        };
        let delimiter = optional("Delimiter")?.unwrap_or_else(|| ",".into());
        let quote = match single(optional("Quote")?) {
            Some(quote) => Some(quote),
            None if delimiter == "\t" => None,
            None => Some(b'"'),
        };
        let escape = single(optional("Escape")?).or(quote);
        let new_line = match optional("NewLineDelimiter")?.as_deref() {
            Some(value @ ("\\r\\n" | "\\r")) => value.to_owned(),
            _ => "\\n".to_owned(),
        };
        let skip_rows = match result.value(0, at("SkipRows")?) {
            Some(Value::UInt(rows)) => rows,
            Some(Value::Int(rows)) if rows >= 0 => rows as u64,
            _ => 0,
        };
        let header = matches!(result.value(0, at("HasHeader")?), Some(Value::Bool(true)));
        let dialect = Self {
            delimiter,
            quote,
            escape,
            new_line,
            comment: optional("Comment")?,
            skip_rows,
            header,
            date_format: optional("DateFormat")?,
            timestamp_format: optional("TimestampFormat")?,
        };
        let (name, data_type) = (at("name")?, at("type")?);
        let columns = (0..result.num_rows())
            .map(|row| {
                Ok(ColumnInfo {
                    name: text(result, row, name)?,
                    data_type: text(result, row, data_type)?,
                })
            })
            .collect::<Result<Vec<_>, String>>()?;
        Ok((dialect, columns))
    }

    /// A scanner for this dialect's record ends.
    pub fn records(&self) -> Records {
        let newline = if self.new_line == "\\r" { b'\r' } else { b'\n' };
        let delimiter = self.delimiter.as_bytes().last().copied().unwrap_or(b',');
        Records::new(self.quote, self.escape, delimiter, newline)
    }

    /// `read_csv`'s options for a chunk: everything fixed, nothing sniffed
    /// again. Sniffing each chunk cost ~20 ms of a ~55 ms chunk (4 MiB, M6),
    /// and could pick different types per chunk. Only the first chunk has
    /// the header and the skipped lines.
    pub fn read_options(&self, columns: &[ColumnInfo], first: bool) -> String {
        let byte = |byte: Option<u8>| {
            sql_string(
                &byte
                    .map(|byte| char::from(byte).to_string())
                    .unwrap_or_default(),
            )
        };
        let mut options = format!(
            "auto_detect = false, header = {}, skip = {}, delim = {}, quote = {}, escape = {}, new_line = {}",
            first && self.header,
            if first { self.skip_rows } else { 0 },
            sql_string(&self.delimiter),
            byte(self.quote),
            byte(self.escape),
            sql_string(&self.new_line),
        );
        for (option, value) in [
            ("comment", &self.comment),
            ("dateformat", &self.date_format),
            ("timestampformat", &self.timestamp_format),
        ] {
            if let Some(value) = value {
                options.push_str(&format!(", {option} = {}", sql_string(value)));
            }
        }
        let columns: Vec<String> = columns
            .iter()
            .map(|column| {
                format!(
                    "{}: {}",
                    sql_string(&column.name),
                    sql_string(&column.data_type)
                )
            })
            .collect();
        options.push_str(&format!(", columns = {{{}}}", columns.join(", ")));
        options
    }
}

/// The column a failed chunk couldn't convert, from DuckDB's message:
/// `Error when converting column "pdes". Could not convert string …`.
/// Types come from the first chunk, and a later one can disagree: the
/// asteroids' `pdes` is numeric for 895,910 rows, then "1988 PF1".
pub fn conversion_column(message: &str) -> Option<&str> {
    const PREFIX: &str = "Error when converting column \"";
    let start = message.find(PREFIX)? + PREFIX.len();
    let end = message[start..].find("\".")?;
    Some(&message[start..start + end])
}

/// DuckDB's CSV error, cut to what a visitor can use. Its first line gives
/// a line number within the chunk, which means nothing to them; the reason
/// and the offending line follow it.
pub fn error_summary(message: &str) -> String {
    let lines: Vec<&str> = message.lines().map(str::trim).collect();
    let original = lines
        .iter()
        .find_map(|line| line.strip_prefix("Original Line: "));
    let reason = lines.iter().skip(1).find(|line| {
        !line.is_empty()
            && !line.starts_with("Original Line:")
            && !line.starts_with("Possible")
            && !line.starts_with('*')
    });
    match (reason, original) {
        (Some(reason), Some(original)) => {
            let mut shown: String = original.chars().take(60).collect();
            if shown.len() < original.len() {
                shown.push('…');
            }
            format!("{reason}, in: {shown}")
        }
        (Some(reason), None) => (*reason).to_owned(),
        _ => lines.first().copied().unwrap_or(message).to_owned(),
    }
}

/// Finds where records end in a CSV byte stream: at a newline outside a
/// quoted field. Fed the bytes in order from a record's start.
///
/// A quote opens a field only at the field's start, as for DuckDB: in
/// `12" pizza` it's a literal inch mark, and toggling on it would leave the
/// rest of the file "quoted", one chunk long.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Records {
    quote: Option<u8>,
    /// Inside quotes, takes the next byte literally. When it's the quote
    /// itself (RFC 4180's `""`), a doubled quote does that.
    escape: Option<u8>,
    /// The delimiter's last byte (DuckDB allows up to 4).
    delimiter: u8,
    newline: u8,
    state: Field,
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum Field {
    Start,
    Unquoted,
    Quoted,
    /// A quote inside a quoted field: it closes the field, unless another
    /// quote follows (with the quote as its own escape).
    QuoteInQuoted,
    /// The escape inside a quoted field (when it isn't the quote).
    Escaped,
}

impl Records {
    pub fn new(quote: Option<u8>, escape: Option<u8>, delimiter: u8, newline: u8) -> Self {
        Self {
            quote,
            escape,
            delimiter,
            newline,
            state: Field::Start,
        }
    }

    /// Reads `bytes`, which continue the ones read before. Returns the
    /// offset in `bytes` just past the last record end in them, if any.
    pub fn scan(&mut self, bytes: &[u8]) -> Option<usize> {
        let mut last = None;
        let doubled = self.escape.is_none() || self.escape == self.quote;
        for (index, &byte) in bytes.iter().enumerate() {
            let quote = Some(byte) == self.quote;
            self.state = match self.state {
                Field::Quoted if quote => Field::QuoteInQuoted,
                Field::Quoted if !doubled && Some(byte) == self.escape => Field::Escaped,
                Field::Quoted | Field::Escaped => Field::Quoted,
                Field::QuoteInQuoted if quote && doubled => Field::Quoted,
                Field::Start if quote => Field::Quoted,
                // Outside quotes (a closing quote leaves the field unquoted).
                Field::Start | Field::Unquoted | Field::QuoteInQuoted => {
                    if byte == self.newline {
                        last = Some(index + 1);
                        Field::Start
                    } else if byte == self.delimiter {
                        Field::Start
                    } else {
                        Field::Unquoted
                    }
                }
            };
        }
        last
    }
}

/// How many bytes the next chunk should hold: aimed at [`Sizer::TARGET_MS`]
/// per chunk, since the row count updates only between chunks (budget: every
/// 500 ms), and a page read waits for the chunk DuckDB is on (it doesn't
/// interleave with a CREATE TABLE, M6). Smoothed, so one slow chunk doesn't
/// halve the next.
#[derive(Debug, Clone, PartialEq)]
pub struct Sizer {
    next: u64,
}

impl Sizer {
    /// The first chunk: small, so first rows show fast; DuckDB's sniffer
    /// reads it whole (its default sample, 20,480 rows, is ~2 MiB here).
    pub const FIRST: u64 = 1 << 20;
    pub const MIN: u64 = 1 << 20;
    /// The best of 4/8/16/32 MiB in M6's experiment: 16.3 s for 1 GB, the
    /// slowest chunk 215 ms, the least memory.
    pub const MAX: u64 = 8 << 20;
    pub const TARGET_MS: f64 = 200.0;

    pub fn new() -> Self {
        Self { next: Self::FIRST }
    }

    pub fn next(&self) -> u64 {
        self.next
    }

    /// A chunk of `bytes` took `ms`.
    pub fn record(&mut self, bytes: u64, ms: f64) {
        let ideal = bytes as f64 / ms.max(1.0) * Self::TARGET_MS;
        // The geometric mean of where it was and where this chunk says.
        let next = (self.next as f64 * ideal).sqrt();
        self.next = (next as u64).clamp(Self::MIN, Self::MAX);
    }
}

impl Default for Sizer {
    fn default() -> Self {
        Self::new()
    }
}

/// The chunk tables so far, in file order, and how to read a page of rows
/// across them. Rows are numbered across the whole file.
#[derive(Debug, Clone, PartialEq)]
pub struct Chunks {
    /// Each chunk's table, first row, and rows.
    tables: Vec<(String, u64, u64)>,
    rows: u64,
    /// Columns a later chunk widened to VARCHAR: earlier chunks still hold
    /// the sniffed type, so every read casts them.
    widened: Vec<String>,
    /// What rows are paged by ([`row_column`]).
    row: &'static str,
}

impl Chunks {
    /// No chunks yet, paged by `row` ([`row_column`]).
    pub fn new(row: &'static str) -> Self {
        Self {
            tables: Vec::new(),
            rows: 0,
            widened: Vec::new(),
            row,
        }
    }

    pub fn rows(&self) -> u64 {
        self.rows
    }

    pub fn len(&self) -> usize {
        self.tables.len()
    }

    pub fn is_empty(&self) -> bool {
        self.tables.is_empty()
    }

    pub fn push(&mut self, table: String, rows: u64) {
        self.tables.push((table, self.rows, rows));
        self.rows += rows;
    }

    pub fn widen(&mut self, column: &str) {
        if !self.widened.iter().any(|widened| widened == column) {
            self.widened.push(column.to_owned());
        }
    }

    /// The query for `rows`, in file order. Within a chunk table, `rowid` (or
    /// [`NUMBER_COLUMN`]) is the record's position in the chunk:
    /// `CREATE TABLE … AS` keeps insertion order, and DuckDB-Wasm runs one
    /// thread.
    pub fn page_sql(&self, rows: Range<u64>) -> String {
        let row = self.row;
        let mut projection = "*".to_owned();
        if row == NUMBER_COLUMN {
            projection.push_str(&format!(" EXCLUDE ({NUMBER_COLUMN})"));
        }
        if !self.widened.is_empty() {
            let casts: Vec<String> = self
                .widened
                .iter()
                .map(|column| {
                    let column = quote_identifier(column);
                    format!("CAST({column} AS VARCHAR) AS {column}")
                })
                .collect();
            projection.push_str(&format!(" REPLACE ({})", casts.join(", ")));
        }
        let first = self
            .tables
            .partition_point(|(_, start, count)| start + count <= rows.start);
        let parts: Vec<(&str, Range<u64>)> = self.tables[first..]
            .iter()
            .take_while(|(_, start, _)| *start < rows.end)
            .map(|(table, start, count)| {
                let from = rows.start.max(*start) - start;
                let to = rows.end.min(start + count) - start;
                (table.as_str(), from..to)
            })
            .filter(|(_, range)| !range.is_empty())
            .collect();
        match parts.as_slice() {
            [] => match self.tables.first() {
                Some((table, ..)) => format!("SELECT {projection} FROM {table} LIMIT 0"),
                None => "SELECT NULL LIMIT 0".into(),
            },
            [(table, range)] => format!(
                "SELECT {projection} FROM {table} WHERE {row} >= {} AND {row} < {} ORDER BY {row}",
                range.start, range.end
            ),
            parts => {
                let selects: Vec<String> = parts
                    .iter()
                    .enumerate()
                    .map(|(part, (table, range))| {
                        format!(
                            "SELECT {part} AS tycho_part, {row} AS tycho_row, {projection} FROM {table} \
                             WHERE {row} >= {} AND {row} < {}",
                            range.start, range.end
                        )
                    })
                    .collect();
                format!(
                    "SELECT * EXCLUDE (tycho_part, tycho_row) FROM ({}) ORDER BY tycho_part, tycho_row",
                    selects.join(" UNION ALL ")
                )
            }
        }
    }
}

fn quote_identifier(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

/// Reads [`create_sql`]'s answer: the rows the chunk held.
pub fn created_rows(result: &QueryResult) -> Result<u64, String> {
    count(result, column(result, "Count")?)
}

/// DuckDB's memory, in bytes: asked after each chunk.
pub const MEMORY_SQL: &str = "SELECT sum(memory_usage_bytes)::BIGINT AS bytes FROM duckdb_memory()";

/// How much memory DuckDB may hold before a CSV's load stops: 1.5 GiB.
/// DuckDB-Wasm 1.32.0 (memory limit 3.1 GiB) stops storing rows at ~2.1 GiB
/// of in-memory tables, and doesn't say so: `CREATE TABLE … AS` answers
/// with an empty table, chunk after chunk, until one finally errors (M7: an
/// 8.6 GB CSV lost 57 chunks that way). The asteroid CSV takes 0.28 bytes of
/// memory per byte of file, so 1.5 GiB holds ~5.4 GB of it; a CSV that
/// compresses worse stops sooner.
pub const MEMORY_BUDGET: u64 = 1536 << 20;

/// Above this much DuckDB memory, a chunk of bytes that became no rows is
/// taken as DuckDB dropping them (see [`MEMORY_BUDGET`]). Below it, an empty
/// chunk is a block of comment or blank lines, which a CSV can have.
pub const EMPTY_CHUNK_SUSPECT: u64 = 1 << 30;

/// Whether a load can go on after a chunk of `bytes` became `rows` rows and
/// DuckDB holds `memory` bytes.
pub fn check_chunk(bytes: u64, rows: u64, memory: u64) -> Result<(), String> {
    if rows == 0 && bytes > 4096 && memory >= EMPTY_CHUNK_SUSPECT {
        return Err(format!(
            "DuckDB stored no rows from the last {} it read: it's out of memory",
            crate::dataset::format_bytes(bytes)
        ));
    }
    if memory >= MEMORY_BUDGET {
        return Err(format!(
            "the rows so far take {} of DuckDB's memory, Tycho's limit for a CSV (past ~2 GiB, DuckDB-Wasm drops rows without an error)",
            crate::dataset::format_bytes(memory)
        ));
    }
    Ok(())
}

#[cfg(target_family = "wasm")]
pub use web::{Chunk, Ingest, Stop};

#[cfg(target_family = "wasm")]
mod web {
    use std::cell::Cell;
    use std::rc::Rc;

    use super::*;
    use crate::engine::{Engine, EngineError, FileSource, RequestId};
    use seiza::marks::now;

    /// How much of the file the scanner reads at a time. Each read is an
    /// `await`, so frames draw between them. 256 and 64 KiB didn't change a
    /// fling during the load, and slowed it (M7 part D).
    const WINDOW: f64 = (1 << 20) as f64;

    /// Stops an ingest: its next query isn't sent, and the one DuckDB is
    /// running for it is cancelled. The task running the ingest drops its
    /// tables once that query has answered (a table being created can't be
    /// dropped under it).
    #[derive(Clone, Default)]
    pub struct Stop {
        stopped: Rc<Cell<bool>>,
        current: Rc<Cell<Option<RequestId>>>,
    }

    impl Stop {
        pub fn stop(&self, engine: &Engine) {
            self.stopped.set(true);
            if let Some(request) = self.current.take() {
                engine.cancel(request);
            }
        }

        pub fn stopped(&self) -> bool {
            self.stopped.get()
        }

        /// Sends `sql` now, unless stopped, and keeps its id until it
        /// answers, for [`Stop::stop`] to cancel.
        fn send(
            &self,
            engine: &Engine,
            sql: &str,
        ) -> Result<impl Future<Output = Result<QueryResult, EngineError>> + 'static, EngineError>
        {
            if self.stopped() {
                return Err(EngineError::Cancelled);
            }
            let (id, result) = engine.query(sql);
            self.current.set(Some(id));
            let current = self.current.clone();
            Ok(async move {
                let result = result.await;
                if current.get() == Some(id) {
                    current.set(None);
                }
                result
            })
        }

        fn check(&self) -> Result<(), EngineError> {
            if self.stopped() {
                Err(EngineError::Cancelled)
            } else {
                Ok(())
            }
        }
    }

    /// A chunk that's now a table.
    #[derive(Debug, Clone)]
    pub struct Chunk {
        pub table: String,
        pub rows: u64,
        /// Bytes of the file read so far, this chunk included.
        pub bytes_read: f64,
        /// From sending the chunk's CREATE TABLE to its answer (the last
        /// attempt, if a column widened).
        pub ms: f64,
        /// Columns this chunk widened to VARCHAR.
        pub widened: Vec<String>,
    }

    /// Copies a CSV file into chunk tables, one chunk per [`Ingest::next`].
    pub struct Ingest {
        engine: Engine,
        file: web_sys::File,
        open: u64,
        dialect: Dialect,
        columns: Vec<ColumnInfo>,
        /// Where the next chunk starts, and where it ends once found (the
        /// next chunk's end is found while DuckDB reads the current one).
        start: f64,
        end: Option<f64>,
        /// The next chunk's name, when it's registered already (chunk 0).
        registered: Option<String>,
        index: u64,
        sizer: Sizer,
        /// What the chunk tables are paged by ([`row_column`]).
        row: &'static str,
        stop: Stop,
    }

    impl Ingest {
        /// Finds the first chunk, reads the dialect and columns from it, and
        /// sets up the tables' schema. [`Ingest::next`] then makes chunk 0.
        pub async fn start(
            engine: Engine,
            file: web_sys::File,
            open: u64,
            stop: Stop,
        ) -> Result<Self, EngineError> {
            let failed = |error: String| EngineError::Engine(error);
            // Independent of the file: sent first, awaited last.
            let attach = engine.query(ATTACH_SQL).1;
            let rfc4180 = Dialect::default().records();
            let end = record_end(&file, 0.0, Sizer::FIRST as f64, rfc4180)
                .await
                .map_err(failed)?;
            let mut name = chunk_file(open, 0);
            engine
                .register_file(&name, FileSource::File(slice(&file, 0.0, end, &name)?))
                .await?;
            let sniff = stop.send(&engine, &sniff_sql(&name))?.await;
            let (dialect, columns) = Dialect::from_sniff(&sniff?).map_err(|error| {
                EngineError::Engine(format!("couldn't read it as CSV: {error}"))
            })?;
            // Another quote, escape, or line end may end the first record
            // elsewhere: cut the chunk again with the dialect it has.
            let end = if dialect.records() == rfc4180 {
                end
            } else {
                let end = record_end(&file, 0.0, Sizer::FIRST as f64, dialect.records())
                    .await
                    .map_err(failed)?;
                name = format!("file-{open}-0b.csv");
                stop.check()?;
                engine
                    .register_file(&name, FileSource::File(slice(&file, 0.0, end, &name)?))
                    .await?;
                end
            };
            attach.await?;
            stop.send(&engine, &schema_sql(open))?.await?;
            let row = row_column(&columns);
            Ok(Self {
                engine,
                file,
                open,
                dialect,
                columns,
                start: 0.0,
                end: Some(end),
                registered: Some(name),
                index: 0,
                sizer: Sizer::new(),
                row,
                stop,
            })
        }

        pub fn columns(&self) -> &[ColumnInfo] {
            &self.columns
        }

        /// What the chunk tables are paged by, for [`Chunks::new`].
        pub fn row_column(&self) -> &'static str {
            self.row
        }

        pub fn size(&self) -> f64 {
            self.file.size()
        }

        /// Makes the next chunk's table. `None` once the whole file is in.
        pub async fn next(&mut self) -> Option<Result<Chunk, EngineError>> {
            let size = self.file.size();
            if self.start >= size && self.index > 0 {
                return None;
            }
            Some(self.make_chunk(size).await)
        }

        async fn make_chunk(&mut self, size: f64) -> Result<Chunk, EngineError> {
            let failed = |error: String| EngineError::Engine(error);
            let (start, index) = (self.start, self.index);
            let end = match self.end.take() {
                Some(end) => end,
                None => self.find_end(start).await.map_err(failed)?,
            };
            let name = match self.registered.take() {
                Some(name) => name,
                None => {
                    let name = chunk_file(self.open, index);
                    self.stop.check()?;
                    self.engine
                        .register_file(
                            &name,
                            FileSource::File(slice(&self.file, start, end, &name)?),
                        )
                        .await?;
                    name
                }
            };
            let table = table(self.open, index);
            let mut widened = Vec::new();
            let numbered = self.row == NUMBER_COLUMN;
            loop {
                let options = self.dialect.read_options(&self.columns, index == 0);
                let sent = now();
                let result = self
                    .stop
                    .send(&self.engine, &create_sql(&table, &name, &options, numbered))?;
                let created = async {
                    let result = result.await;
                    (result, now())
                };
                // While DuckDB reads this chunk, find where the next one ends.
                // Both are awaited, so the chunk's time is its own, and a
                // failed scan doesn't abandon the query (it's found again,
                // and reported, at the next chunk).
                let scan = async {
                    if self.end.is_none() && end < size {
                        self.find_end(end).await.ok()
                    } else {
                        None
                    }
                };
                let ((result, answered), next_end) = futures::future::join(created, scan).await;
                if next_end.is_some() {
                    self.end = next_end;
                }
                let ms = answered - sent;
                match result {
                    Ok(result) => {
                        let rows = created_rows(&result).map_err(failed)?;
                        let memory = self.stop.send(&self.engine, MEMORY_SQL)?.await?;
                        let memory = count(&memory, column(&memory, "bytes").map_err(failed)?)
                            .map_err(failed)?;
                        check_chunk((end - start) as u64, rows, memory).map_err(failed)?;
                        self.sizer.record((end - start) as u64, ms);
                        self.start = end;
                        self.index += 1;
                        return Ok(Chunk {
                            rows,
                            table,
                            bytes_read: end,
                            ms,
                            widened,
                        });
                    }
                    Err(EngineError::Engine(message)) => {
                        // A value the column's type can't hold: from here
                        // on the column is text, and this chunk goes again
                        // (a failed CREATE TABLE leaves nothing behind).
                        match conversion_column(&message).and_then(|name| self.widen(name)) {
                            Some(column) => widened.push(column),
                            None => return Err(EngineError::Engine(error_summary(&message))),
                        }
                    }
                    Err(error) => return Err(error),
                }
            }
        }

        async fn find_end(&self, start: f64) -> Result<f64, String> {
            let target = start + self.sizer.next() as f64;
            record_end(&self.file, start, target, self.dialect.records()).await
        }

        /// Makes `name` VARCHAR from the next chunk on. `None` if it's
        /// unknown or text already (widening can't help).
        fn widen(&mut self, name: &str) -> Option<String> {
            let column = self
                .columns
                .iter_mut()
                .find(|column| column.name == name && column.data_type != "VARCHAR")?;
            column.data_type = "VARCHAR".into();
            Some(column.name.clone())
        }
    }

    /// The end of the last whole record between `start` (where one starts)
    /// and `target`. If none ends by `target` (a record longer than the
    /// chunk), reads on until one does. At the end of the file, its size.
    async fn record_end(
        file: &web_sys::File,
        start: f64,
        target: f64,
        mut records: Records,
    ) -> Result<f64, String> {
        let size = file.size();
        let target = target.min(size);
        let mut position = start;
        let mut last = None;
        while position < size {
            let limit = if position < target { target } else { size };
            let end = (position + WINDOW).min(limit);
            let bytes = crate::files::read(file, position, end).await?;
            if let Some(offset) = records.scan(&bytes) {
                last = Some(position + offset as f64);
            }
            position = end;
            if position >= target && last.is_some() {
                break;
            }
        }
        Ok(match last {
            Some(last) if position < size => last,
            _ => size,
        })
    }

    /// Bytes `start..end` of `file`, as a `File` named `name`. The browser
    /// keeps a reference to the original's bytes; nothing is copied.
    fn slice(
        file: &web_sys::File,
        start: f64,
        end: f64,
        name: &str,
    ) -> Result<web_sys::File, EngineError> {
        let failed = |_| EngineError::Engine("the browser couldn't slice the file".into());
        let blob = file.slice_with_f64_and_f64(start, end).map_err(failed)?;
        web_sys::File::new_with_blob_sequence(&js_sys::Array::of1(&blob), name).map_err(failed)
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use arrow::array::{ArrayRef, BooleanArray, Int64Array, StringArray, UInt32Array};
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

    fn strings(values: &[Option<&str>]) -> ArrayRef {
        Arc::new(StringArray::from(values.to_vec()))
    }

    /// What `sniff_csv` answered for the asteroid fixture's first chunk
    /// (DuckDB 1.4.5), cut to two columns.
    fn sniffed(quote: &str, date_format: Option<&str>) -> QueryResult {
        let two = |value: &str| strings(&[Some(value), Some(value)]);
        result(vec![
            ("Delimiter", two(",")),
            ("Quote", two(quote)),
            ("Escape", two("(empty)")),
            ("NewLineDelimiter", two("\\n")),
            ("Comment", two("(empty)")),
            ("SkipRows", Arc::new(UInt32Array::from(vec![0, 0]))),
            ("HasHeader", Arc::new(BooleanArray::from(vec![true, true]))),
            ("DateFormat", strings(&[date_format, date_format])),
            ("TimestampFormat", strings(&[None, None])),
            ("name", strings(&[Some("spkid"), Some("it's")])),
            ("type", strings(&[Some("BIGINT"), Some("DATE")])),
        ])
    }

    #[test]
    fn dialect_from_sniff_assumes_rfc4180_quotes() {
        let (dialect, columns) =
            Dialect::from_sniff(&sniffed("(empty)", Some("%Y-%m-%d"))).unwrap();
        assert_eq!(
            dialect,
            Dialect {
                date_format: Some("%Y-%m-%d".into()),
                ..Dialect::default()
            }
        );
        assert_eq!(columns[1].name, "it's");
        assert_eq!(columns[1].data_type, "DATE");
        let (single, _) = Dialect::from_sniff(&sniffed("'", None)).unwrap();
        assert_eq!((single.quote, single.escape), (Some(b'\''), Some(b'\'')));
        assert!(Dialect::from_sniff(&result(vec![("Quote", strings(&[]))])).is_err());
    }

    #[test]
    fn read_options_fix_everything() {
        let (dialect, columns) =
            Dialect::from_sniff(&sniffed("(empty)", Some("%Y-%m-%d"))).unwrap();
        assert_eq!(
            dialect.read_options(&columns, true),
            "auto_detect = false, header = true, skip = 0, delim = ',', quote = '\"', escape = '\"', \
             new_line = '\\n', dateformat = '%Y-%m-%d', columns = {'spkid': 'BIGINT', 'it''s': 'DATE'}"
        );
        let later = dialect.read_options(&columns, false);
        assert!(later.starts_with("auto_detect = false, header = false, skip = 0,"));
        let quoted = Dialect {
            quote: Some(b'\''),
            escape: Some(b'\\'),
            ..Dialect::default()
        };
        assert!(
            quoted
                .read_options(&[], true)
                .contains("quote = '''', escape = '\\'")
        );
    }

    #[test]
    fn records_end_only_outside_quotes() {
        let mut records = Dialect::default().records();
        let csv = b"a,b\n1,\"x\ny\"\n2,\"say \"\"hi\"\"\nthere\"\n3,z";
        // Ends after "a,b\n", after the quoted x/y record, after the quoted
        // "hi" record; "3,z" has no end yet.
        let last = records.scan(csv).unwrap();
        assert_eq!(
            &csv[..last],
            b"a,b\n1,\"x\ny\"\n2,\"say \"\"hi\"\"\nthere\"\n"
        );
        // Fed in pieces that split inside a quoted field: the same ends.
        let mut records = Dialect::default().records();
        let (head, tail) = csv.split_at(8);
        assert_eq!(records.scan(head), Some(4));
        assert_eq!(records.scan(tail).map(|end| end + head.len()), Some(last));
    }

    #[test]
    fn records_with_a_backslash_escape() {
        let mut records = Records::new(Some(b'"'), Some(b'\\'), b',', b'\n');
        let csv = b"1,\"a \\\" still\nquoted\"\n2\n";
        assert_eq!(records.scan(csv), Some(csv.len()));
        let mut records = Records::new(Some(b'"'), Some(b'\\'), b',', b'\n');
        assert_eq!(records.scan(b"1,\"a \\\" still\n"), None);
    }

    #[test]
    fn a_quote_inside_a_field_is_literal() {
        // `12" pizza`: DuckDB reads it as is; so must the scanner, or the
        // rest of the file would look quoted.
        let csv = b"size,name\n12\" pizza,x\n14,y\n";
        assert_eq!(Dialect::default().records().scan(csv), Some(csv.len()));
        // A quoted field after a closing quote and more text stays closed.
        let csv = b"\"a\"b,c\n";
        assert_eq!(Dialect::default().records().scan(csv), Some(csv.len()));
    }

    #[test]
    fn a_tsv_the_sniffer_found_unquoted_stays_unquoted() {
        let two = |value: &str| strings(&[Some(value), Some(value)]);
        let tsv = result(vec![
            ("Delimiter", two("\t")),
            ("Quote", two("(empty)")),
            ("Escape", two("(empty)")),
            ("NewLineDelimiter", two("\\n")),
            ("Comment", two("(empty)")),
            ("SkipRows", Arc::new(UInt32Array::from(vec![0, 0]))),
            ("HasHeader", Arc::new(BooleanArray::from(vec![true, true]))),
            ("DateFormat", strings(&[None, None])),
            ("TimestampFormat", strings(&[None, None])),
            ("name", strings(&[Some("a"), Some("b")])),
            ("type", strings(&[Some("VARCHAR"), Some("VARCHAR")])),
        ]);
        let (dialect, columns) = Dialect::from_sniff(&tsv).unwrap();
        assert_eq!((dialect.quote, dialect.escape), (None, None));
        assert!(
            dialect
                .read_options(&columns, true)
                .contains("delim = '\t', quote = '', escape = ''")
        );
        // A field starting with a quote is just text.
        let data = b"a\tb\n\"x\ty\n";
        assert_eq!(dialect.records().scan(data), Some(data.len()));
    }

    #[test]
    fn a_file_with_its_own_rowid_numbers_its_rows() {
        let column = |name: &str| ColumnInfo {
            name: name.into(),
            data_type: "BIGINT".into(),
        };
        assert_eq!(row_column(&[column("a"), column("b")]), "rowid");
        assert_eq!(row_column(&[column("a"), column("RowID")]), NUMBER_COLUMN);
        assert_eq!(
            create_sql("t", "f.csv", "o", true),
            "CREATE TABLE t AS SELECT row_number() OVER () - 1 AS __tycho_row, * FROM read_csv('f.csv', o)"
        );
        assert_eq!(
            create_sql("t", "f.csv", "o", false),
            "CREATE TABLE t AS SELECT * FROM read_csv('f.csv', o)"
        );
        let mut chunks = Chunks::new(NUMBER_COLUMN);
        chunks.push(table(1, 0), 100);
        chunks.push(table(1, 1), 100);
        assert_eq!(
            chunks.page_sql(10..20),
            "SELECT * EXCLUDE (__tycho_row) FROM tycho_csv.f1.c0 WHERE __tycho_row >= 10 AND __tycho_row < 20 ORDER BY __tycho_row"
        );
        chunks.widen("pdes");
        let across = chunks.page_sql(90..110);
        assert!(across.contains(
            "SELECT 1 AS tycho_part, __tycho_row AS tycho_row, * EXCLUDE (__tycho_row) REPLACE (CAST(\"pdes\" AS VARCHAR) AS \"pdes\") \
             FROM tycho_csv.f1.c1 WHERE __tycho_row >= 0 AND __tycho_row < 10"
        ));
    }

    #[test]
    fn carriage_return_line_ends() {
        let dialect = Dialect {
            new_line: "\\r".into(),
            ..Dialect::default()
        };
        assert_eq!(dialect.records().scan(b"a\rb\rc"), Some(4));
        // CRLF ends at the \n.
        assert_eq!(Dialect::default().records().scan(b"a\r\nb"), Some(3));
    }

    #[test]
    fn conversion_errors_name_their_column() {
        let message = "Conversion Error: CSV Error on Line: 2\nOriginal Line: 99000001,\"Tycho test row 1\"\n\
                       Error when converting column \"pdes\". Could not convert string \"TEST-1\" to 'BIGINT'\n\n\
                       Column pdes is being converted as type BIGINT";
        assert_eq!(conversion_column(message), Some("pdes"));
        assert_eq!(
            conversion_column("Invalid Input Error: something else"),
            None
        );
    }

    #[test]
    fn error_summaries_drop_the_chunk_line_number() {
        let message = "Invalid Input Error: CSV Error on Line: 7794\n\
                       Original Line: 20007793,7793 Mutlu-Pakdil (1995 YC3),7793,Mutlu-\n\
                       Expected Number of Columns: 18 Found: 4\n\
                       Possible fixes:\n* Disable the parser's strict mode";
        assert_eq!(
            error_summary(message),
            "Expected Number of Columns: 18 Found: 4, in: 20007793,7793 Mutlu-Pakdil (1995 YC3),7793,Mutlu-"
        );
        assert_eq!(
            error_summary("Out of Memory Error: failed"),
            "Out of Memory Error: failed"
        );
    }

    #[test]
    fn a_chunk_stops_the_load_when_memory_runs_out() {
        assert_eq!(check_chunk(8 << 20, 70_000, 1 << 30), Ok(()));
        // Empty but tiny: a trailing blank line.
        assert_eq!(check_chunk(2, 0, 1 << 30), Ok(()));
        // Empty with little memory used: a block of comment lines.
        assert_eq!(check_chunk(8 << 20, 0, 300 << 20), Ok(()));
        let empty = check_chunk(8 << 20, 0, EMPTY_CHUNK_SUSPECT).unwrap_err();
        assert!(empty.contains("no rows"), "{empty}");
        let full = check_chunk(8 << 20, 70_000, MEMORY_BUDGET).unwrap_err();
        assert!(full.contains("limit for a CSV"), "{full}");
    }

    #[test]
    fn sizer_aims_at_the_target_and_stays_in_bounds() {
        let mut sizer = Sizer::new();
        assert_eq!(sizer.next(), Sizer::FIRST);
        // 1 MiB in 10 ms: 200 ms would hold 20 MiB. Halfway (geometrically),
        // then capped.
        sizer.record(1 << 20, 10.0);
        assert_eq!(
            sizer.next(),
            (((1u64 << 20) as f64 * (20u64 << 20) as f64).sqrt() as u64).min(Sizer::MAX)
        );
        for _ in 0..10 {
            sizer.record(sizer.next(), 10.0);
        }
        assert_eq!(sizer.next(), Sizer::MAX);
        // Very slow chunks (throttled CPU): down to the floor, not below.
        for _ in 0..20 {
            sizer.record(sizer.next(), 5_000.0);
        }
        assert_eq!(sizer.next(), Sizer::MIN);
    }

    fn chunks() -> Chunks {
        let mut chunks = Chunks::new("rowid");
        chunks.push(table(1, 0), 100);
        chunks.push(table(1, 1), 0);
        chunks.push(table(1, 2), 50);
        chunks
    }

    #[test]
    fn a_page_inside_one_chunk() {
        let chunks = chunks();
        assert_eq!((chunks.rows(), chunks.len()), (150, 3));
        assert_eq!(
            chunks.page_sql(10..20),
            "SELECT * FROM tycho_csv.f1.c0 WHERE rowid >= 10 AND rowid < 20 ORDER BY rowid"
        );
        assert_eq!(
            chunks.page_sql(120..150),
            "SELECT * FROM tycho_csv.f1.c2 WHERE rowid >= 20 AND rowid < 50 ORDER BY rowid"
        );
    }

    #[test]
    fn a_page_across_chunks_skips_empty_ones() {
        let mut chunks = chunks();
        chunks.widen("pdes");
        chunks.widen("pdes");
        assert_eq!(
            chunks.page_sql(90..110),
            "SELECT * EXCLUDE (tycho_part, tycho_row) FROM (\
             SELECT 0 AS tycho_part, rowid AS tycho_row, * REPLACE (CAST(\"pdes\" AS VARCHAR) AS \"pdes\") \
             FROM tycho_csv.f1.c0 WHERE rowid >= 90 AND rowid < 100 UNION ALL \
             SELECT 1 AS tycho_part, rowid AS tycho_row, * REPLACE (CAST(\"pdes\" AS VARCHAR) AS \"pdes\") \
             FROM tycho_csv.f1.c2 WHERE rowid >= 0 AND rowid < 10) ORDER BY tycho_part, tycho_row"
        );
    }

    #[test]
    fn a_page_past_the_end_reads_nothing() {
        assert_eq!(
            chunks().page_sql(150..160),
            "SELECT * FROM tycho_csv.f1.c0 LIMIT 0"
        );
        assert_eq!(Chunks::new("rowid").page_sql(0..10), "SELECT NULL LIMIT 0");
    }

    #[test]
    fn created_rows_reads_the_count() {
        let answer = result(vec![("Count", Arc::new(Int64Array::from(vec![7792])))]);
        assert_eq!(created_rows(&answer), Ok(7792));
    }

    #[test]
    fn names() {
        assert_eq!(table(3, 12), "tycho_csv.f3.c12");
        assert_eq!(chunk_file(3, 12), "file-3-12.csv");
        assert_eq!(schema_sql(3), "CREATE SCHEMA IF NOT EXISTS tycho_csv.f3");
        assert_eq!(drop_sql(3), "DROP SCHEMA IF EXISTS tycho_csv.f3 CASCADE");
        assert!(sniff_sql("file-3-0.csv").ends_with("FROM sniff_csv('file-3-0.csv')"));
    }
}
