//! The column profile: what a column holds, read in stages that each
//! replace the last (`docs/DECISIONS.md`, "Scope", 2026-11-20 and
//! 2026-11-27).
//!
//! - **Stage 1, the footer:** a Parquet file's null counts and ranges, every
//!   column at once ([`footer_sql`]). It covers the whole file, so only an
//!   unfiltered view of a Parquet file shows it; a range missing a row
//!   group's end waits for the next stage.
//! - **Stage 2, a sample:** about [`SAMPLE_ROWS`] rows, every figure and the
//!   shape ([`sample_sql`]). A source of [`SMALL_ROWS`] or fewer skips it.
//! - **Stage 3, every row in view:** a number's or a timestamp's figures,
//!   then its bins over the finite range they found ([`exact_sql`],
//!   [`bins_sql`]); a text column's in one query.
//!
//! The view's filters reach every query as a `CASE` projection the query
//! keeps the rows of, never a `WHERE`: DuckDB-Wasm pushes a text comparison
//! into a Parquet scan and runs it about 10× slower ([`Scan::keep`]). Every
//! name is quoted by `quote_identifier` and every value written by
//! `filter::literal`, through the filters' SQL. Infinities and NaN are left
//! out of a number's figures and counted. Each query is sent in the engine's
//! background, so page reads go first (`Profiling`).

use std::collections::HashMap;

use gpui_kit::{Bounds, Pixels};
use seiza_duckdb::arrow::{QueryResult, Value};
use seiza_duckdb::sql::{ColumnInfo, quote_identifier, string_literal};
use serde::Serialize;

use crate::filter::Kind;

/// A source of this many rows or fewer is read whole after its footer: no
/// sample (GCAT whole answers in 60 ms; 4.7 M rows in 0.2–1.2 s).
pub const SMALL_ROWS: u64 = 2_000_000;

/// About how many rows a sample reads. On 42 M rows a sample costs the same
/// at 0.12% as at 0.47%: the row groups' setup dominates.
pub const SAMPLE_ROWS: u64 = 200_000;

/// A histogram's bins.
pub const BINS: usize = 20;

/// The most common values a text column's profile lists.
pub const TOP: usize = 10;

/// The sample's seed, so a stage read twice reads the same rows.
const SEED: u32 = 42;

/// Where a profile reads its rows: the source, its row count, and the
/// view's filters as one condition.
#[derive(Debug, Clone, PartialEq)]
pub struct Scan {
    /// The source as a relation: a Parquet file's `read_parquet(…)`, or a
    /// CSV's tables as a subquery.
    from: String,
    /// The source's rows, before any filter.
    rows: u64,
    /// The filters, combined with `AND`; none keeps every row.
    condition: Option<String>,
}

impl Scan {
    /// A registered Parquet file of `rows` rows, read as `name`.
    pub fn parquet(name: &str, rows: u64) -> Self {
        Self {
            from: format!("read_parquet({})", string_literal(name)),
            rows,
            condition: None,
        }
    }

    /// A relation's rows (a CSV's tables, as `RowSource::numbered_sql`
    /// writes them), `rows` of them.
    pub fn relation(sql: &str, rows: u64) -> Self {
        Self {
            from: format!("({sql})"),
            rows,
            condition: None,
        }
    }

    /// The view's filters, as `filter::where_sql` writes them.
    pub fn filtered(mut self, condition: Option<String>) -> Self {
        self.condition = condition;
        self
    }

    /// Whether the view keeps every row.
    pub fn unfiltered(&self) -> bool {
        self.condition.is_none()
    }

    /// The sample's share of the source, in percent, or none when the
    /// source is small enough to read whole. Set from the rows, never a
    /// fixed share: DuckDB samples whole 2,048-row vectors, so 1% of a
    /// small file is often no rows.
    pub fn sample_percent(&self) -> Option<f64> {
        if self.rows <= SMALL_ROWS {
            return None;
        }
        let percent = SAMPLE_ROWS as f64 / self.rows as f64 * 100.0;
        // Two significant figures, rounded up, at least 0.01%.
        let scale = 10f64.powi(1 - percent.log10().floor() as i32);
        Some(((percent * scale).ceil() / scale).max(0.01))
    }

    /// `column` as `v` and whether the filters keep its row as `k`, from
    /// the source sampled at `percent` if given. A `CASE`, never a `WHERE`
    /// on the source: see the module's note.
    fn rows_sql(&self, column: &str, percent: Option<f64>) -> String {
        let sample = percent
            .map(|percent| format!(" TABLESAMPLE {percent}% (system, {SEED})"))
            .unwrap_or_default();
        format!(
            "SELECT {column} AS v, {} AS k FROM {}{sample}",
            self.keep(),
            self.from
        )
    }

    /// Whether a row is in view, as a value the scan can't push down.
    fn keep(&self) -> String {
        match &self.condition {
            Some(condition) => format!("CASE WHEN {condition} THEN true ELSE false END"),
            None => "true".into(),
        }
    }
}

/// How a profile reads a column.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Read {
    /// Figures, and bins over the finite range.
    Numeric { time: bool },
    /// Figures, and the most common values as text.
    Values,
}

impl Read {
    fn of(column: &ColumnInfo) -> Self {
        match Kind::of(column) {
            Kind::Number => Self::Numeric { time: false },
            Kind::Time => Self::Numeric { time: true },
            Kind::Text | Kind::Boolean => Self::Values,
        }
    }
}

/// `column`'s value as the profile reads it: a text kind DuckDB doesn't
/// store as `VARCHAR` (a UUID, a boolean) as the text the table shows.
fn value_sql(column: &ColumnInfo, read: Read) -> String {
    let name = quote_identifier(&column.name);
    match read {
        Read::Values if column.data_type != "VARCHAR" => format!("CAST({name} AS VARCHAR)"),
        _ => name,
    }
}

/// `v` as a number to bin and to test for finite: a number as `DOUBLE`, a
/// date or a timestamp as its seconds since the epoch.
fn position(time: bool) -> &'static str {
    if time {
        "epoch(v)"
    } else {
        "CAST(v AS DOUBLE)"
    }
}

/// Whether `v` is a finite value: a date or a timestamp can be infinite too.
fn finite(time: bool) -> &'static str {
    if time {
        "v IS NOT NULL AND isfinite(v)"
    } else {
        "v IS NOT NULL AND isfinite(CAST(v AS DOUBLE))"
    }
}

/// The mean of a number's finite values, as text; none for a time.
fn mean(time: bool, finite: &str) -> String {
    if time {
        "CAST(NULL AS VARCHAR)".into()
    } else {
        format!("CAST(avg(CAST(v AS DOUBLE)) FILTER ({finite}) AS VARCHAR)")
    }
}

/// Stage 1: every column's null count and, for a number or a time, its
/// range, from `file`'s footer (one row a column: `name`, `nulls`,
/// `nulls_known`, `lo`, `hi`, `range_known`). A row group that doesn't
/// record a figure leaves it unknown (GCAT's `apogee_km` has no maximum
/// where its values are infinite), and so does an infinite end, or a
/// column the footer has no row for (a nested one, whose rows are its
/// leaves').
pub fn footer_sql(file: &str, columns: &[ColumnInfo]) -> Option<String> {
    let arms: Vec<String> = columns
        .iter()
        .map(|column| {
            let name = string_literal(&column.name);
            let (lo, hi, known) = match Read::of(column) {
                Read::Numeric { time } => {
                    let cast = |side: &str| format!("TRY_CAST({side} AS {})", column.data_type);
                    // A writer records an infinite end as any other: such a
                    // range isn't the finite one the profile shows.
                    let finite = |end: &str| {
                        if time {
                            format!("isfinite({end})")
                        } else {
                            format!("isfinite(CAST({end} AS DOUBLE))")
                        }
                    };
                    let (lo, hi) = (
                        format!("min({})", cast("stats_min")),
                        format!("max({})", cast("stats_max")),
                    );
                    (
                        format!("CAST({lo} AS VARCHAR)"),
                        format!("CAST({hi} AS VARCHAR)"),
                        format!(
                            "count(*) > 0 AND count(*) = count({}) AND count(*) = count({}) AND {} AND {}",
                            cast("stats_min"),
                            cast("stats_max"),
                            finite(&lo),
                            finite(&hi),
                        ),
                    )
                }
                Read::Values => (
                    "CAST(NULL AS VARCHAR)".into(),
                    "CAST(NULL AS VARCHAR)".into(),
                    "false".into(),
                ),
            };
            format!(
                "SELECT {name} AS name, CAST(sum(stats_null_count) AS BIGINT) AS nulls, \
                 count(*) > 0 AND count(*) = count(stats_null_count) AS nulls_known, {lo} AS lo, {hi} AS hi, \
                 {known} AS range_known FROM m WHERE path_in_schema = {name}"
            )
        })
        .collect();
    (!arms.is_empty()).then(|| {
        format!(
            "WITH m AS MATERIALIZED (SELECT path_in_schema, stats_min, stats_max, stats_null_count \
             FROM parquet_metadata({})) {}",
            string_literal(file),
            arms.join(" UNION ALL ")
        )
    })
}

/// Stage 2: `column`'s figures and shape from a sample of `percent` of the
/// source, in one query. A number's or a time's: 20 rows, one a bin (`n`,
/// `present`, `nonfinite`, `lo`, `hi`, `mean`, `median`, `distinct`, then
/// `bin` and `c`); a text column's: a row a common value (`n`, `present`,
/// `distinct`, `v`, `c`), or one with no value when there's none. The
/// sample is small, so it's held once and read twice.
pub fn sample_sql(scan: &Scan, column: &ColumnInfo, percent: f64) -> String {
    let read = Read::of(column);
    let rows = format!(
        "SELECT v FROM ({}) WHERE k",
        scan.rows_sql(&value_sql(column, read), Some(percent))
    );
    match read {
        Read::Numeric { time } => {
            let (finite, position) = (finite(time), position(time));
            format!(
                "WITH s AS MATERIALIZED ({rows}), \
                 a AS (SELECT count(*) AS n, count(v) AS present, \
                 count(*) FILTER (v IS NOT NULL AND NOT ({finite})) AS nonfinite FROM s), \
                 b AS (SELECT CAST(min(v) FILTER ({finite}) AS VARCHAR) AS lo, \
                 CAST(max(v) FILTER ({finite}) AS VARCHAR) AS hi, {mean} AS mean, \
                 CAST(median(v) FILTER ({finite}) AS VARCHAR) AS median, \
                 count(DISTINCT v) FILTER ({finite}) AS distinct_values, \
                 min({position}) FILTER ({finite}) AS lo_at, max({position}) FILTER ({finite}) AS hi_at FROM s), \
                 h AS (SELECT {bin} AS bin, count(*) AS c FROM s, b WHERE {finite} GROUP BY bin) \
                 SELECT a.n, a.present, a.nonfinite, b.lo, b.hi, b.mean, b.median, b.distinct_values, \
                 CAST(g.bin AS INTEGER) AS bin, coalesce(h.c, 0) AS c \
                 FROM a, b, range({BINS}) AS g(bin) LEFT JOIN h ON h.bin = g.bin ORDER BY g.bin",
                mean = mean(time, finite),
                bin = bin_sql(position, "b.lo_at", "b.hi_at"),
            )
        }
        Read::Values => values_sql(&rows),
    }
}

/// Stage 3: every row in view. A number's or a time's figures alone, one
/// row (`n`, `present`, `nonfinite`, `lo`, `hi`, `mean`, `median`,
/// `distinct`, `lo_at`, `hi_at`); its bins follow from [`bins_sql`] over
/// `lo_at` and `hi_at`. A text column's figures and common values, as
/// [`sample_sql`]'s.
pub fn exact_sql(scan: &Scan, column: &ColumnInfo) -> String {
    let read = Read::of(column);
    let inner = scan.rows_sql(&value_sql(column, read), None);
    let rows = if scan.unfiltered() {
        format!("SELECT v FROM ({inner})")
    } else {
        format!("SELECT v FROM ({inner}) WHERE k")
    };
    match read {
        Read::Numeric { time } => {
            let (finite, position) = (finite(time), position(time));
            format!(
                "SELECT count(*) AS n, count(v) AS present, \
                 count(*) FILTER (v IS NOT NULL AND NOT ({finite})) AS nonfinite, \
                 CAST(min(v) FILTER ({finite}) AS VARCHAR) AS lo, \
                 CAST(max(v) FILTER ({finite}) AS VARCHAR) AS hi, {mean} AS mean, \
                 CAST(median(v) FILTER ({finite}) AS VARCHAR) AS median, \
                 count(DISTINCT v) FILTER ({finite}) AS distinct_values, \
                 min({position}) FILTER ({finite}) AS lo_at, max({position}) FILTER ({finite}) AS hi_at \
                 FROM ({rows})",
                mean = mean(time, finite),
            )
        }
        Read::Values => values_sql(&rows),
    }
}

/// Stage 3's bins for a number or a time, over the finite range
/// [`exact_sql`] found (`lo_at` to `hi_at`): a row a bin with rows
/// (`bin`, `c`). None for a text column.
pub fn bins_sql(scan: &Scan, column: &ColumnInfo, lo_at: f64, hi_at: f64) -> Option<String> {
    let Read::Numeric { time } = Read::of(column) else {
        return None;
    };
    let inner = scan.rows_sql(&value_sql(column, Read::Numeric { time }), None);
    let keep = if scan.unfiltered() { "" } else { "k AND " };
    Some(format!(
        "SELECT {bin} AS bin, count(*) AS c FROM ({inner}) WHERE {keep}{finite} GROUP BY bin ORDER BY bin",
        bin = bin_sql(position(time), &number(lo_at), &number(hi_at)),
        finite = finite(time),
    ))
}

/// The bin of `position` over `lo` to `hi`: 0 to 19, the top value in the
/// last; every value in the first when the range is one value.
fn bin_sql(position: &str, lo: &str, hi: &str) -> String {
    format!(
        "CAST(least({last}, CASE WHEN {hi} = {lo} THEN 0 ELSE floor(({position} - {lo}) / ({hi} - {lo}) * {BINS}) END) AS INTEGER)",
        last = BINS - 1
    )
}

/// `value` as a SQL number: Rust's shortest form that reads back the same.
fn number(value: f64) -> String {
    format!("CAST({value:?} AS DOUBLE)")
}

/// A text column's figures and its most common values from `rows` (a
/// relation of `v`), grouped once.
fn values_sql(rows: &str) -> String {
    format!(
        "WITH g AS MATERIALIZED (SELECT v, count(*) AS c FROM ({rows}) GROUP BY v), \
         a AS (SELECT CAST(coalesce(sum(c), 0) AS BIGINT) AS n, \
         CAST(coalesce(sum(c) FILTER (v IS NOT NULL), 0) AS BIGINT) AS present, count(v) AS distinct_values FROM g), \
         t AS (SELECT v, c FROM g WHERE v IS NOT NULL ORDER BY c DESC, v LIMIT {TOP}) \
         SELECT a.n, a.present, a.distinct_values, t.v, t.c FROM a LEFT JOIN t ON true ORDER BY t.c DESC, t.v"
    )
}

/// A stage of a profile, as its line says where it came from.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Stage {
    /// The file's footer: the range and nulls, no shape.
    Footer,
    /// A sample of this share of the source, in percent.
    Sample(f64),
    /// Every row in view.
    Exact,
}

/// How many different values a column holds, as far as it's known.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Distinct {
    /// Every row in view was read.
    Exact(u64),
    /// A sample's count: the column holds at least this many. A rare value
    /// can be missing from a sample, so even a small count is a floor.
    AtLeast(u64),
    /// Every value of a sample of this many differed (likely an ID).
    AllUnique(u64),
}

/// A column's shape.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Shape {
    /// A number's or a time's rows in each of [`BINS`] bins, low to high,
    /// over the figures' range.
    Bins(Vec<u64>),
    /// A text column's most common values and their rows, most first.
    Top(Vec<(String, u64)>),
}

/// What a stage read of a column.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub stage: Stage,
    /// The rows it read: every row in view, a sample's, or the file's for
    /// the footer.
    pub rows: u64,
    /// Rows with no value.
    pub nulls: Option<u64>,
    /// Infinities and NaN, left out of every other figure.
    pub nonfinite: u64,
    /// The finite range, as DuckDB writes the column's type.
    pub lo: Option<String>,
    pub hi: Option<String>,
    pub mean: Option<String>,
    pub median: Option<String>,
    pub distinct: Option<Distinct>,
    pub shape: Option<Shape>,
    /// The stage the shape came from: a sample's bars stay while every
    /// row's figures are in and its bins are still being read.
    pub shape_stage: Option<Stage>,
}

/// Why a profile's answer couldn't be read.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Unreadable(String);

impl std::fmt::Display for Unreadable {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "the profile's answer isn't readable: {}", self.0)
    }
}

fn count(result: &QueryResult, row: usize, column: usize) -> Result<u64, Unreadable> {
    match result.value(row, column) {
        Some(Value::Int(n)) => u64::try_from(n).map_err(|_| Unreadable(format!("a count of {n}"))),
        Some(Value::UInt(n)) => Ok(n),
        other => Err(Unreadable(format!("a count read as {other:?}"))),
    }
}

fn text(result: &QueryResult, row: usize, column: usize) -> Option<String> {
    match result.value(row, column) {
        Some(Value::Str(text)) => Some(text.to_string()),
        _ => None,
    }
}

fn float(result: &QueryResult, row: usize, column: usize) -> Option<f64> {
    match result.value(row, column) {
        Some(Value::Float(value)) => Some(value),
        Some(Value::Int(value)) => Some(value as f64),
        _ => None,
    }
}

fn boolean(result: &QueryResult, row: usize, column: usize) -> bool {
    matches!(result.value(row, column), Some(Value::Bool(true)))
}

/// What the footer says of one column.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct FooterColumn {
    pub nulls: Option<u64>,
    /// The range, when every row group records both ends.
    pub range: Option<(String, String)>,
}

/// [`footer_sql`]'s answer, by column name.
pub fn read_footer(result: &QueryResult) -> Result<HashMap<String, FooterColumn>, Unreadable> {
    (0..result.num_rows())
        .map(|row| {
            let name =
                text(result, row, 0).ok_or_else(|| Unreadable("a footer row's name".into()))?;
            // Known, but NULL: no count to give, never a failed answer.
            let nulls = boolean(result, row, 2)
                .then(|| count(result, row, 1).ok())
                .flatten();
            let range = boolean(result, row, 5)
                .then(|| Some((text(result, row, 3)?, text(result, row, 4)?)))
                .flatten();
            Ok((name, FooterColumn { nulls, range }))
        })
        .collect()
}

impl FooterColumn {
    /// The footer as a column's stage 1, read of `rows` rows.
    pub fn profile(&self, rows: u64) -> Profile {
        Profile {
            stage: Stage::Footer,
            rows,
            nulls: self.nulls,
            nonfinite: 0,
            lo: self.range.as_ref().map(|(lo, _)| lo.clone()),
            hi: self.range.as_ref().map(|(_, hi)| hi.clone()),
            mean: None,
            median: None,
            distinct: None,
            shape: None,
            shape_stage: None,
        }
    }
}

/// [`sample_sql`]'s answer, a sample of `percent` of the source.
pub fn read_sample(
    column: &ColumnInfo,
    percent: f64,
    result: &QueryResult,
) -> Result<Profile, Unreadable> {
    let mut profile = match Read::of(column) {
        Read::Numeric { .. } => read_numeric(result, Stage::Sample(percent))?,
        Read::Values => read_values(result, Stage::Sample(percent))?,
    };
    // Exact for the sample, a floor for the column.
    profile.distinct = profile.distinct.map(|distinct| match distinct {
        Distinct::Exact(n) => {
            let present = profile.rows - profile.nulls.unwrap_or(0) - profile.nonfinite;
            if n > 1 && n == present {
                Distinct::AllUnique(n)
            } else {
                Distinct::AtLeast(n)
            }
        }
        other => other,
    });
    Ok(profile)
}

/// [`exact_sql`]'s answer, and for a number or a time the range to ask
/// [`bins_sql`] over (none when it has no finite value).
pub fn read_exact(
    column: &ColumnInfo,
    result: &QueryResult,
) -> Result<(Profile, Option<(f64, f64)>), Unreadable> {
    match Read::of(column) {
        Read::Numeric { .. } => {
            let profile = read_figures(result, 0, Stage::Exact)?;
            let range = float(result, 0, 8).zip(float(result, 0, 9));
            // Nothing to bin with no finite value: the shape is empty.
            let profile = if range.is_none() {
                Profile {
                    shape: Some(Shape::Bins(vec![0; BINS])),
                    shape_stage: Some(Stage::Exact),
                    ..profile
                }
            } else {
                profile
            };
            Ok((profile, range))
        }
        Read::Values => Ok((read_values(result, Stage::Exact)?, None)),
    }
}

/// [`bins_sql`]'s answer as the shape.
pub fn read_bins(result: &QueryResult) -> Result<Shape, Unreadable> {
    let mut bins = vec![0; BINS];
    for row in 0..result.num_rows() {
        let bin = count(result, row, 0)? as usize;
        let slot = bins
            .get_mut(bin)
            .ok_or_else(|| Unreadable(format!("bin {bin}")))?;
        *slot = count(result, row, 1)?;
    }
    Ok(Shape::Bins(bins))
}

/// A number's or a time's figures from row `row` (`n`, `present`,
/// `nonfinite`, `lo`, `hi`, `mean`, `median`, `distinct`).
fn read_figures(result: &QueryResult, row: usize, stage: Stage) -> Result<Profile, Unreadable> {
    if result.num_rows() <= row {
        return Err(Unreadable("no figures".into()));
    }
    let rows = count(result, row, 0)?;
    let present = count(result, row, 1)?;
    Ok(Profile {
        stage,
        rows,
        nulls: Some(rows - present),
        nonfinite: count(result, row, 2)?,
        lo: text(result, row, 3),
        hi: text(result, row, 4),
        mean: text(result, row, 5),
        median: text(result, row, 6),
        distinct: Some(Distinct::Exact(count(result, row, 7)?)),
        shape: None,
        shape_stage: None,
    })
}

/// [`sample_sql`]'s 20 rows for a number or a time.
fn read_numeric(result: &QueryResult, stage: Stage) -> Result<Profile, Unreadable> {
    let mut profile = read_figures(result, 0, stage)?;
    let mut bins = vec![0; BINS];
    for row in 0..result.num_rows() {
        let bin = count(result, row, 8)? as usize;
        let slot = bins
            .get_mut(bin)
            .ok_or_else(|| Unreadable(format!("bin {bin}")))?;
        *slot = count(result, row, 9)?;
    }
    profile.shape = Some(Shape::Bins(bins));
    profile.shape_stage = Some(stage);
    Ok(profile)
}

/// A text column's figures and common values (`n`, `present`, `distinct`,
/// `v`, `c`): a row a value, or one with none.
fn read_values(result: &QueryResult, stage: Stage) -> Result<Profile, Unreadable> {
    if result.num_rows() == 0 {
        return Err(Unreadable("no figures".into()));
    }
    let rows = count(result, 0, 0)?;
    let present = count(result, 0, 1)?;
    let top = (0..result.num_rows())
        .filter_map(|row| {
            let value = text(result, row, 3)?;
            Some(count(result, row, 4).map(|c| (value, c)))
        })
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Profile {
        stage,
        rows,
        nulls: Some(rows - present),
        nonfinite: 0,
        lo: None,
        hi: None,
        mean: None,
        median: None,
        distinct: Some(Distinct::Exact(count(result, 0, 2)?)),
        shape: Some(Shape::Top(top)),
        shape_stage: Some(stage),
    })
}

/// How long a change to the rows in view waits before the profile reads
/// them again, so a run of changes (an undo pressed again and again) reads
/// once.
pub const PAUSE_MS: f64 = 300.0;

/// How recently the table scrolled for a profile query out to be said to
/// wait for it: page reads go first. Any move of the table's view is a
/// scroll (a drag, a wheel, `jump`, a find step, the Row tab's Next): each
/// reads its pages first.
pub const SCROLL_MS: f64 = 500.0;

/// What a profile waits for, as its line says it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Waiting {
    /// A CSV still loading: its rows aren't all in.
    Loading,
    /// The filters' index is being built, in the foreground.
    Filter,
    /// A sort's copy is being built, in the foreground.
    Sort,
    /// Find's count or its place is out, in the foreground.
    Find,
    /// Page reads go first, and the table is reading them.
    Scrolling,
}

impl Waiting {
    pub fn words(self) -> &'static str {
        match self {
            Self::Loading => "waiting for the file to finish loading",
            Self::Filter => "waiting for the filter to finish",
            Self::Sort => "waiting for the sort to finish",
            Self::Find => "waiting for find to finish",
            Self::Scrolling => "waiting for scrolling to settle",
        }
    }
}

/// What a column's profile was read of: the table, its source as the
/// profile names it, and the filters applied. A change to any of them
/// reads the column again.
#[derive(Debug, Clone, PartialEq)]
pub struct Key {
    pub table: u64,
    pub scan: Scan,
}

/// What reads next for a column.
#[derive(Debug, Clone, Copy, PartialEq)]
enum Next {
    Sample(f64),
    Exact,
    Bins(f64, f64),
    Done,
}

impl Next {
    fn first(scan: &Scan) -> Self {
        scan.sample_percent().map_or(Self::Exact, Self::Sample)
    }
}

/// One column's profile, as far as it has been read.
struct Entry {
    key: Key,
    profile: Option<Profile>,
    next: Next,
    /// Not before this page time: the rows in view changed just now.
    after: f64,
    /// Its next query is out.
    out: bool,
    /// Why its last query failed, if it did: read again when its rows
    /// change or it's asked again after it was closed.
    failed: Option<String>,
}

/// What the frame and the probe read of one column's profile.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileFacts {
    pub column: String,
    pub profile: Option<Profile>,
    /// Whether a later stage is still to come.
    pub reading: bool,
    pub waiting: Option<Waiting>,
    pub failed: Option<String>,
}

/// A query a profile sends: for a column, or the footer.
#[derive(Debug, Clone, PartialEq)]
pub struct Due {
    /// The column it reads, or none for the footer.
    pub column: Option<String>,
    pub key: Key,
    pub sql: String,
}

/// The footer's figures of every column, and what they were read of.
struct Footer {
    key: Key,
    /// None until its answer is in (or if it couldn't be read).
    columns: Option<HashMap<String, FooterColumn>>,
    /// Its query is out.
    out: bool,
}

/// The profiles of the columns asked for (the panel's open column, the
/// filter editor's), each read in stages; and the footer's figures of every
/// column, for the column list's null shares. Which query is due and what
/// its answer means is here; sending them, in the engine's background, and
/// canceling them is the workbench's (`web`).
#[derive(Default)]
pub struct Profiling {
    /// The columns asked for, by name.
    asked: Vec<String>,
    entries: HashMap<String, Entry>,
    /// The footer's figures, for the table and the file they were read of.
    footer: Option<Footer>,
    /// When the table last scrolled, in page time.
    scrolled: Option<f64>,
    /// The shown table's vertical scrollbar last reported: the table, its
    /// rows, its track, and its thumb (`scrollbar`).
    thumb: Option<(u64, u64, Bounds<Pixels>, Bounds<Pixels>)>,
    /// Whether the source's rows are all in (a CSV still loading isn't).
    loading: bool,
    /// Whether the view in front keeps every row: the footer speaks for it
    /// only then.
    unfiltered: bool,
    /// The asked columns the file doesn't have.
    missing: Vec<String>,
    /// Why the filters applied can't be written as SQL, if they can't (a
    /// column retyped since): nothing is read until they can.
    refused: Option<String>,
    /// The workbench's own long foreground query in flight (the filters'
    /// index, a sort's copy, find's count), which a query out waits behind.
    foreground: Option<Waiting>,
    /// Something changed that the next sync has to see (an ask, an answer,
    /// a wait ended), whatever the rows in view.
    changed: bool,
    #[cfg(target_family = "wasm")]
    outs: web::Outs,
}

impl Profiling {
    /// The columns to profile, by name. Another's query out is no longer
    /// out (the workbench cancels it, `Profiling::dropped`); what it read
    /// is kept.
    /// A column asked again after it was closed is read again if its last
    /// query failed.
    pub fn ask(&mut self, columns: Vec<String>) {
        let before = std::mem::replace(&mut self.asked, columns);
        self.changed = true;
        for (name, entry) in &mut self.entries {
            if !self.asked.contains(name) {
                entry.out = false;
            } else if !before.contains(name) {
                entry.failed = None;
            }
        }
    }

    /// The file the columns were asked of is closed or replaced: they
    /// aren't asked of the next (a column of the same name in another file
    /// isn't the one asked for). An ask made while the next opens is kept.
    pub fn forget(&mut self) {
        self.ask(Vec::new());
    }

    pub fn asked(&self) -> &[String] {
        &self.asked
    }

    /// The shown table's vertical scrollbar, as it reported at page time
    /// `now` with the table's `rows`: a thumb moved at the same size on the
    /// same track of the same table with the same rows is a scroll; any
    /// other change (rows, a resize, another table) isn't. The rows are
    /// compared too: on a large table the thumb is at its least size, and a
    /// new row count moves it without resizing it.
    pub fn scrollbar(
        &mut self,
        table: u64,
        rows: u64,
        track: Bounds<Pixels>,
        thumb: Bounds<Pixels>,
        now: f64,
    ) {
        let moved = self
            .thumb
            .is_some_and(|(last_table, last_rows, last_track, last_thumb)| {
                last_table == table
                    && last_rows == rows
                    && last_track == track
                    && last_thumb.size == thumb.size
                    && last_thumb.origin != thumb.origin
            });
        self.thumb = Some((table, rows, track, thumb));
        if moved {
            self.scrolled(now);
        }
    }

    /// The table scrolled at page time `now`. Only a scroll that starts a
    /// wait (a query out, no scroll within `SCROLL_MS`) has the next sync
    /// do anything: it schedules the wait's end, and each end the next
    /// (`due`), so the frames of a scroll sync nothing.
    pub fn scrolled(&mut self, now: f64) {
        let starts = self.scrolled.is_none_or(|at| now - at >= SCROLL_MS)
            && self.entries.values().any(|entry| entry.out);
        self.scrolled = Some(now);
        self.changed |= starts;
    }

    /// The workbench's own long foreground query in flight, if any: one of
    /// `Waiting`'s `Filter`, `Sort`, or `Find`. Read by `facts`.
    pub fn set_foreground(&mut self, query: Option<Waiting>) {
        self.foreground = query;
    }

    /// What `table`'s rows are read of: `scan` kept to the filters'
    /// `condition`. If the filters can't be written (a column retyped
    /// since), which rows are in view isn't known: nothing is read, what's
    /// out is canceled, and each asked column says why (`due`, `facts`)
    /// until they can.
    pub fn key_of(
        &mut self,
        table: u64,
        scan: Scan,
        condition: Result<Option<String>, String>,
    ) -> Key {
        let condition = match condition {
            Ok(condition) => {
                self.refused = None;
                condition
            }
            Err(why) => {
                self.refused = Some(why);
                None
            }
        };
        Key {
            table,
            scan: scan.filtered(condition),
        }
    }

    /// Whether something changed since the last sync that it has to see;
    /// clears it.
    pub fn take_changed(&mut self) -> bool {
        std::mem::take(&mut self.changed)
    }

    /// A wait ended: the next sync has something to do.
    pub fn touch(&mut self) {
        self.changed = true;
    }

    /// Every column's null count and the rows it's of, from the footer,
    /// while the view is unfiltered: a filtered view's counts are only the
    /// profile's own.
    pub fn footer_nulls(&self) -> HashMap<String, (u64, u64)> {
        let Some(Footer {
            key,
            columns: Some(columns),
            ..
        }) = &self.footer
        else {
            return HashMap::new();
        };
        if !self.unfiltered {
            return HashMap::new();
        }
        columns
            .iter()
            .filter_map(|(name, column)| Some((name.clone(), (column.nulls?, key.scan.rows))))
            .collect()
    }

    /// Each asked column's profile, at page time `now`.
    pub fn facts(&self, now: f64) -> Vec<ProfileFacts> {
        self.asked
            .iter()
            .map(|column| {
                if self.missing.contains(column) {
                    return ProfileFacts {
                        column: column.clone(),
                        profile: None,
                        reading: false,
                        waiting: None,
                        failed: Some(format!("there's no column {column}")),
                    };
                }
                if let Some(why) = &self.refused {
                    return ProfileFacts {
                        column: column.clone(),
                        profile: None,
                        reading: false,
                        waiting: None,
                        failed: Some(format!("the filters can't be read: {why}")),
                    };
                }
                let entry = self.entries.get(column);
                let out = entry.is_some_and(|entry| entry.out);
                let scrolling = self.scrolled.is_some_and(|at| now - at < SCROLL_MS);
                let waiting = if self.loading {
                    Some(Waiting::Loading)
                } else if !out {
                    None
                } else if self.foreground.is_some() {
                    self.foreground
                } else {
                    scrolling.then_some(Waiting::Scrolling)
                };
                ProfileFacts {
                    column: column.clone(),
                    profile: entry
                        .and_then(|entry| entry.profile.clone())
                        .or_else(|| self.footer_profile(column)),
                    reading: entry
                        .is_none_or(|entry| entry.next != Next::Done && entry.failed.is_none()),
                    waiting,
                    failed: entry.and_then(|entry| entry.failed.clone()),
                }
            })
            .collect()
    }

    /// The footer's stage 1 of `column`, if the view is unfiltered.
    fn footer_profile(&self, column: &str) -> Option<Profile> {
        let Footer {
            key,
            columns: Some(columns),
            ..
        } = self.footer.as_ref()?
        else {
            return None;
        };
        self.unfiltered
            .then(|| {
                columns
                    .get(column)
                    .map(|footer| footer.profile(key.scan.rows))
            })
            .flatten()
    }

    /// The queries due now for the table and its rows as `key` names them
    /// (none with no file), each marked out; a column read of anything else
    /// starts over, after a pause if only its rows changed. `parquet`: the
    /// file's name, whose footer is read once; `columns`: the file's;
    /// `loading`: a CSV whose rows aren't all in, which nothing reads.
    /// Returns the queries, and the page time the next is due if one waits
    /// for a pause or a scroll. The columns asked are kept with no key (a
    /// file opening): the workbench forgets them when a file closes
    /// (`forget`).
    pub fn due(
        &mut self,
        key: Option<&Key>,
        parquet: Option<&str>,
        columns: &[ColumnInfo],
        loading: bool,
        now: f64,
    ) -> (Vec<Due>, Option<f64>) {
        self.loading = loading;
        self.unfiltered = self.refused.is_none() && key.is_some_and(|key| key.scan.unfiltered());
        let Some(key) = key else {
            self.entries.clear();
            self.footer = None;
            self.missing.clear();
            return (Vec::new(), None);
        };
        // What was read of another table, or a footer this source hasn't,
        // never speaks for this one, loading or not.
        self.entries.retain(|_, entry| entry.key.table == key.table);
        if parquet.is_none()
            || self
                .footer
                .as_ref()
                .is_some_and(|footer| footer.key.table != key.table)
        {
            self.footer = None;
        }
        self.missing = self
            .asked
            .iter()
            .filter(|name| !columns.iter().any(|column| column.name == **name))
            .cloned()
            .collect();
        if loading || self.refused.is_some() {
            for entry in self.entries.values_mut() {
                entry.out = false;
            }
            return (Vec::new(), None);
        }
        let mut due = Vec::new();
        match parquet {
            Some(file) => {
                let footer_key = Key {
                    table: key.table,
                    scan: key.scan.clone().filtered(None),
                };
                if self
                    .footer
                    .as_ref()
                    .is_none_or(|footer| footer.key != footer_key)
                {
                    let sql = footer_sql(file, columns);
                    self.footer = Some(Footer {
                        key: footer_key.clone(),
                        columns: None,
                        out: sql.is_some(),
                    });
                    due.extend(sql.map(|sql| Due {
                        column: None,
                        key: footer_key,
                        sql,
                    }));
                }
            }
            None => self.footer = None,
        }
        let mut wake: Option<f64> = None;
        for name in self.asked.clone() {
            let Some(column) = columns.iter().find(|column| column.name == name) else {
                continue;
            };
            let stale = self
                .entries
                .get(&name)
                .is_none_or(|entry| entry.key != *key);
            if stale {
                let pause = self
                    .entries
                    .get(&name)
                    .is_some_and(|entry| entry.key.table == key.table);
                self.entries.insert(
                    name.clone(),
                    Entry {
                        key: key.clone(),
                        profile: None,
                        next: Next::first(&key.scan),
                        after: if pause { now + PAUSE_MS } else { now },
                        out: false,
                        failed: None,
                    },
                );
            }
            let entry = self.entries.get_mut(&name).expect("inserted");
            if entry.out || entry.failed.is_some() {
                continue;
            }
            if entry.after > now {
                wake = Some(wake.map_or(entry.after, |at: f64| at.min(entry.after)));
                continue;
            }
            if let Some(sql) = next_sql(entry, column) {
                entry.out = true;
                due.push(Due {
                    column: Some(name),
                    key: key.clone(),
                    sql,
                });
            }
        }
        // A query out while the table scrolled (one sent just now included)
        // says so until the scroll is over: the next sync, then, says it no
        // longer is.
        if let Some(at) = self.scrolled
            && at + SCROLL_MS > now
            && self.entries.values().any(|entry| entry.out)
        {
            let end = at + SCROLL_MS;
            wake = Some(wake.map_or(end, |at: f64| at.min(end)));
        }
        (due, wake)
    }

    /// A query's answer, or why it failed: kept if it's still the one
    /// out for what it was asked of.
    pub fn answer(
        &mut self,
        due: &Due,
        columns: &[ColumnInfo],
        result: Result<QueryResult, String>,
    ) {
        let Some(name) = &due.column else {
            if let Some(footer) = &mut self.footer
                && footer.key == due.key
            {
                footer.out = false;
                footer.columns = result.ok().and_then(|result| read_footer(&result).ok());
                self.changed = true;
            }
            return;
        };
        let Some(column) = columns.iter().find(|column| column.name == *name) else {
            return;
        };
        let Some(entry) = self.entries.get_mut(name) else {
            return;
        };
        if entry.key != due.key || !entry.out {
            return;
        }
        entry.out = false;
        self.changed = true;
        let read = result.and_then(|result| {
            match entry.next {
                Next::Sample(percent) => read_sample(column, percent, &result).map(|profile| {
                    entry.profile = Some(profile);
                    Next::Exact
                }),
                Next::Exact => read_exact(column, &result).map(|(mut profile, range)| {
                    let next = match range {
                        Some((lo, hi)) => {
                            // The sample's bars stay until every row's are in.
                            if let Some(previous) = entry.profile.take() {
                                profile.shape = previous.shape;
                                profile.shape_stage = previous.shape_stage;
                            }
                            Next::Bins(lo, hi)
                        }
                        None => Next::Done,
                    };
                    entry.profile = Some(profile);
                    next
                }),
                Next::Bins(..) => read_bins(&result).map(|shape| {
                    if let Some(profile) = &mut entry.profile {
                        profile.shape = Some(shape);
                        profile.shape_stage = Some(Stage::Exact);
                    }
                    Next::Done
                }),
                Next::Done => Ok(Next::Done),
            }
            .map_err(|unreadable| unreadable.to_string())
        });
        match read {
            Ok(next) => entry.next = next,
            Err(message) => entry.failed = Some(message),
        }
    }
}

/// The SQL an entry sends next, if any.
fn next_sql(entry: &Entry, column: &ColumnInfo) -> Option<String> {
    let scan = &entry.key.scan;
    match entry.next {
        Next::Sample(percent) => Some(sample_sql(scan, column, percent)),
        Next::Exact => Some(exact_sql(scan, column)),
        Next::Bins(lo, hi) => bins_sql(scan, column, lo, hi),
        Next::Done => None,
    }
}

/// Publishes `json` (the profiles, as the workbench writes them) to
/// `globalThis.__tychoProfile`, frozen: the checks read it.
#[cfg(target_family = "wasm")]
pub fn publish(json: &str) {
    use wasm_bindgen::JsValue;

    let value = js_sys::JSON::parse(json).unwrap_or(JsValue::NULL);
    crate::view::freeze(&value);
    let _ = js_sys::Reflect::set(
        &js_sys::global(),
        &JsValue::from_str("__tychoProfile"),
        &value,
    );
}

#[cfg(target_family = "wasm")]
mod web {
    use std::collections::HashMap;

    use gpui_kit::{AsyncApp, Context, Task, WeakEntity};
    use seiza_duckdb::sql::ColumnInfo;

    use super::{Due, Key, Profiling};
    use crate::Workbench;

    /// A query out: canceled in DuckDB when dropped, its task with it.
    struct Out {
        engine: seiza_duckdb::Engine,
        id: seiza_duckdb::RequestId,
        /// None once it has answered: nothing to cancel.
        task: Option<Task<()>>,
    }

    impl Drop for Out {
        fn drop(&mut self) {
            if self.task.is_some() {
                self.engine.cancel(self.id);
            }
        }
    }

    /// What's out, by column (none for the footer); and the task that
    /// wakes the workbench when a pause ends.
    #[derive(Default)]
    pub struct Outs {
        out: HashMap<Option<String>, (Due, Out)>,
        wake: Option<Task<()>>,
    }

    impl Profiling {
        /// Sends each query due, in the engine's background, and cancels
        /// any out that no longer is (a column no longer asked, rows that
        /// changed, another file). See [`Profiling::due`].
        pub fn sync(
            &mut self,
            key: Option<Key>,
            parquet: Option<&str>,
            columns: &[ColumnInfo],
            loading: bool,
            cx: &mut Context<Workbench>,
        ) {
            let now = seiza::marks::now();
            let (due, wake) = self.due(key.as_ref(), parquet, columns, loading, now);
            // Drop (cancel) what's out but no longer wanted.
            let wanted = |which: &Option<String>, asked: &Due| match which {
                None => self
                    .footer
                    .as_ref()
                    .is_some_and(|footer| footer.out && footer.key == asked.key),
                Some(name) => self
                    .entries
                    .get(name)
                    .is_some_and(|entry| entry.out && entry.key == asked.key),
            };
            let keep: Vec<Option<String>> = self
                .outs
                .out
                .iter()
                .filter(|(which, (asked, _))| wanted(which, asked))
                .map(|(which, _)| which.clone())
                .collect();
            self.outs.out.retain(|which, _| keep.contains(which));
            for due in due {
                let out = send(&due, columns.to_vec(), cx);
                self.outs.out.insert(due.column.clone(), (due, out));
            }
            self.outs.wake = wake.map(|at| {
                let wait = std::time::Duration::from_millis((at - now).max(0.0) as u64 + 1);
                cx.spawn(
                    async move |this: WeakEntity<Workbench>, cx: &mut AsyncApp| {
                        cx.background_executor().timer(wait).await;
                        let _ = this.update(cx, |this, cx| {
                            this.profiling().touch();
                            cx.notify();
                        });
                    },
                )
            });
        }
    }

    /// Sends `due` in the engine's background and gives its answer to the
    /// workbench's profiles. A canceled query answers nothing: its `Out`
    /// was dropped, and its task with it.
    fn send(due: &Due, columns: Vec<ColumnInfo>, cx: &mut Context<Workbench>) -> Out {
        let engine = cx.global::<seiza_duckdb::Engine>().clone();
        let (id, result) = engine.query_background(&due.sql);
        let asked = due.clone();
        let task = cx.spawn(
            async move |this: WeakEntity<Workbench>, cx: &mut AsyncApp| {
                let result = result.await.map_err(|error| error.to_string());
                let _ = this.update(cx, |this, cx| {
                    let profiling = this.profiling();
                    // Answered: nothing to cancel, and this task is the one
                    // running.
                    let ours = profiling
                        .outs
                        .out
                        .get(&asked.column)
                        .is_some_and(|(out, _)| *out == asked);
                    if ours
                        && let Some((_, mut out)) = profiling.outs.out.remove(&asked.column)
                        && let Some(task) = out.task.take()
                    {
                        task.detach();
                    }
                    profiling.answer(&asked, &columns, result);
                    cx.notify();
                });
            },
        );
        Out {
            engine,
            id,
            task: Some(task),
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use arrow::array::{ArrayRef, BooleanArray, Float64Array, Int32Array, Int64Array, StringArray};
    use arrow::ipc::writer::StreamWriter;
    use arrow::record_batch::RecordBatch;
    use seiza_duckdb::arrow::decode;

    use super::*;

    fn result(columns: Vec<(&str, ArrayRef)>) -> QueryResult {
        let batch = RecordBatch::try_from_iter(columns).unwrap();
        let mut out = Vec::new();
        let mut writer = StreamWriter::try_new(&mut out, &batch.schema()).unwrap();
        writer.write(&batch).unwrap();
        writer.finish().unwrap();
        drop(writer);
        decode(out).unwrap()
    }

    fn column(name: &str, data_type: &str) -> ColumnInfo {
        ColumnInfo::new(name, data_type)
    }

    fn ints(values: &[i64]) -> ArrayRef {
        Arc::new(Int64Array::from(values.to_vec()))
    }

    fn strings(values: &[Option<&str>]) -> ArrayRef {
        Arc::new(StringArray::from(values.to_vec()))
    }

    /// Prints each stage's SQL over a file named by `TYCHO_PROFILE_FILE`,
    /// one JSON line each, to run against native DuckDB by hand: SQL a test
    /// pins as text is checked as text only.
    #[test]
    #[ignore]
    fn print_sql_for_a_file() {
        let file = std::env::var("TYCHO_PROFILE_FILE").unwrap();
        let columns = [
            column("apogee_km", "DOUBLE"),
            column("inclination_deg", "DOUBLE"),
            column("satcat_no", "INTEGER"),
            column("launch_date", "DATE"),
            column("launch_time", "TIMESTAMP"),
            column("orbit", "VARCHAR"),
            column("crewed", "BOOLEAN"),
            column("name", "VARCHAR"),
        ];
        let print = |label: String, sql: String| {
            println!("{}", serde_json::json!({ "label": label, "sql": sql }));
        };
        print("footer".into(), footer_sql(&file, &columns).unwrap());
        for filtered in [false, true] {
            let scan = Scan::parquet(&file, 71_431)
                .filtered(filtered.then(|| r#"("object_type" = 'Payload')"#.to_string()));
            for column in &columns {
                let tag = format!("{}{}", column.name, if filtered { " payloads" } else { "" });
                print(format!("exact {tag}"), exact_sql(&scan, column));
                print(format!("sample {tag}"), sample_sql(&scan, column, 100.0));
                if let Some(bins) = bins_sql(&scan, column, 0.0, 150.97) {
                    print(format!("bins {tag}"), bins);
                }
            }
        }
    }

    fn key(table: u64, rows: u64, condition: Option<&str>) -> Key {
        Key {
            table,
            scan: Scan::parquet("tycho/f.parquet", rows).filtered(condition.map(str::to_string)),
        }
    }

    fn sql_of(due: &[Due], column: Option<&str>) -> String {
        due.iter()
            .find(|due| due.column.as_deref() == column)
            .map(|due| due.sql.clone())
            .unwrap_or_default()
    }

    fn figures(n: i64, distinct: i64, lo_at: f64, hi_at: f64) -> QueryResult {
        result(vec![
            ("n", ints(&[n])),
            ("present", ints(&[n])),
            ("nonfinite", ints(&[0])),
            ("lo", strings(&[Some("0.0")])),
            ("hi", strings(&[Some("150.97")])),
            ("mean", strings(&[Some("68.6")])),
            ("median", strings(&[Some("70.0")])),
            ("distinct_values", ints(&[distinct])),
            ("lo_at", Arc::new(Float64Array::from(vec![lo_at]))),
            ("hi_at", Arc::new(Float64Array::from(vec![hi_at]))),
        ])
    }

    #[test]
    fn a_small_file_reads_its_footer_then_every_row_then_its_bins() {
        let columns = [column("inclination_deg", "DOUBLE")];
        let mut profiling = Profiling::default();
        profiling.ask(vec!["inclination_deg".into()]);
        let key = key(1, 71_431, None);
        let (due, wake) = profiling.due(Some(&key), Some("tycho/f.parquet"), &columns, false, 0.0);
        assert_eq!((due.len(), wake), (2, None));
        assert!(sql_of(&due, None).contains("parquet_metadata"));
        let exact = due.iter().find(|due| due.column.is_some()).unwrap().clone();
        assert!(exact.sql.contains("count(DISTINCT v)") && !exact.sql.contains("TABLESAMPLE"));
        // Nothing more is due while it's out.
        assert!(
            profiling
                .due(Some(&key), Some("tycho/f.parquet"), &columns, false, 1.0)
                .0
                .is_empty()
        );
        profiling.answer(&exact, &columns, Ok(figures(71_431, 6_382, 0.0, 150.97)));
        let facts = &profiling.facts(2.0)[0];
        let profile = facts.profile.as_ref().unwrap();
        assert_eq!(
            (profile.stage, profile.distinct),
            (Stage::Exact, Some(Distinct::Exact(6_382)))
        );
        assert!(facts.reading);
        let (due, _) = profiling.due(Some(&key), Some("tycho/f.parquet"), &columns, false, 3.0);
        assert!(sql_of(&due, Some("inclination_deg")).contains("CAST(150.97 AS DOUBLE)"));
        profiling.answer(
            &due[0],
            &columns,
            Ok(result(vec![
                ("bin", Arc::new(Int32Array::from(vec![0]))),
                ("c", ints(&[2_493])),
            ])),
        );
        let facts = &profiling.facts(4.0)[0];
        assert!(!facts.reading);
        assert_eq!(
            facts.profile.as_ref().unwrap().shape_stage,
            Some(Stage::Exact)
        );
    }

    #[test]
    fn a_large_file_is_sampled_first_and_a_filter_reads_again_after_a_pause() {
        let columns = [column("H", "DOUBLE")];
        let mut profiling = Profiling::default();
        profiling.ask(vec!["H".into()]);
        let all = key(1, 42_323_121, None);
        let (due, _) = profiling.due(Some(&all), None, &columns, false, 0.0);
        assert!(sql_of(&due, Some("H")).contains("TABLESAMPLE 0.48%"));
        // A filter on the same table: stale, read again after the pause,
        // from the sample.
        let some = key(1, 42_323_121, Some(r#"("class" = 'MCA')"#));
        let (due, wake) = profiling.due(Some(&some), None, &columns, false, 10.0);
        assert!(due.is_empty());
        assert_eq!(wake, Some(10.0 + PAUSE_MS));
        let (due, _) = profiling.due(Some(&some), None, &columns, false, 10.0 + PAUSE_MS);
        assert!(sql_of(&due, Some("H")).contains("TABLESAMPLE 0.48%"));
        assert!(sql_of(&due, Some("H")).contains("CASE WHEN"));
        // The first answer, of the unfiltered rows, is stale: dropped.
        let stale = Due {
            column: Some("H".into()),
            key: all,
            sql: String::new(),
        };
        profiling.answer(&stale, &columns, Ok(figures(10, 10, 0.0, 1.0)));
        assert_eq!(profiling.facts(400.0)[0].profile, None);
        // Another file: no pause.
        let other = key(2, 42_323_121, None);
        let (due, _) = profiling.due(Some(&other), None, &columns, false, 500.0);
        assert_eq!(due.len(), 1);
    }

    #[test]
    fn a_csv_loading_reads_nothing_and_says_so() {
        let columns = [column("H", "DOUBLE")];
        let mut profiling = Profiling::default();
        profiling.ask(vec!["H".into()]);
        let key = Key {
            table: 1,
            scan: Scan::relation("SELECT 1", 10),
        };
        let (due, _) = profiling.due(Some(&key), None, &columns, true, 0.0);
        assert!(due.is_empty());
        assert_eq!(profiling.facts(0.0)[0].waiting, Some(Waiting::Loading));
        let (due, _) = profiling.due(Some(&key), None, &columns, false, 1.0);
        assert_eq!(due.len(), 1);
        assert_eq!(profiling.facts(1.0)[0].waiting, None);
        // Scrolling just now, with its query out: it waits for the pages.
        profiling.scrolled(1.0);
        assert_eq!(profiling.facts(100.0)[0].waiting, Some(Waiting::Scrolling));
        assert_eq!(profiling.facts(1.0 + SCROLL_MS)[0].waiting, None);
    }

    #[test]
    fn a_column_no_longer_asked_is_not_out_and_keeps_what_it_read() {
        let columns = [column("H", "DOUBLE"), column("class", "VARCHAR")];
        let mut profiling = Profiling::default();
        profiling.ask(vec!["H".into()]);
        let key = key(1, 100, None);
        let (due, _) = profiling.due(Some(&key), None, &columns, false, 0.0);
        profiling.answer(&due[0], &columns, Ok(figures(100, 50, 0.0, 1.0)));
        profiling.due(Some(&key), None, &columns, false, 1.0);
        profiling.ask(vec!["class".into()]);
        assert!(profiling.entries["H"].profile.is_some());
        assert!(!profiling.entries["H"].out);
        // Asked again, it goes on from where it was: its bins.
        profiling.ask(vec!["H".into()]);
        let (due, _) = profiling.due(Some(&key), None, &columns, false, 2.0);
        assert!(sql_of(&due, Some("H")).contains("GROUP BY bin"));
        // A failure is kept and said; nothing more is sent.
        profiling.answer(&due[0], &columns, Err("Out of memory".into()));
        assert_eq!(
            profiling.facts(3.0)[0].failed.as_deref(),
            Some("Out of memory")
        );
        assert!(
            profiling
                .due(Some(&key), None, &columns, false, 3.0)
                .0
                .is_empty()
        );
    }

    #[test]
    fn the_footers_null_counts_are_the_unfiltered_views_alone() {
        let columns = [column("orbit", "VARCHAR")];
        let mut profiling = Profiling::default();
        let all = key(1, 71_431, None);
        let (due, _) = profiling.due(Some(&all), Some("tycho/f.parquet"), &columns, false, 0.0);
        profiling.answer(
            &due[0],
            &columns,
            Ok(result(vec![
                ("name", strings(&[Some("orbit")])),
                ("nulls", ints(&[86])),
                ("nulls_known", Arc::new(BooleanArray::from(vec![true]))),
                ("lo", strings(&[None])),
                ("hi", strings(&[None])),
                ("range_known", Arc::new(BooleanArray::from(vec![false]))),
            ])),
        );
        assert_eq!(profiling.footer_nulls()["orbit"], (86, 71_431));
        let some = key(1, 71_431, Some("true"));
        profiling.due(Some(&some), Some("tycho/f.parquet"), &columns, false, 1.0);
        assert!(profiling.footer_nulls().is_empty());
    }

    #[test]
    fn a_column_the_footer_has_no_row_for_costs_the_others_nothing() {
        // A nested column's arm finds no row: no count, known or not.
        let sql = footer_sql("tycho/f.parquet", &[column("tags", "VARCHAR[]")]).unwrap();
        assert!(
            sql.contains("count(*) > 0 AND count(*) = count(stats_null_count)"),
            "{sql}"
        );
        let footer = read_footer(&result(vec![
            ("name", strings(&[Some("tags"), Some("orbit")])),
            ("nulls", Arc::new(Int64Array::from(vec![None, Some(86)]))),
            (
                "nulls_known",
                Arc::new(BooleanArray::from(vec![true, true])),
            ),
            ("lo", strings(&[None, None])),
            ("hi", strings(&[None, None])),
            (
                "range_known",
                Arc::new(BooleanArray::from(vec![false, false])),
            ),
        ]))
        .unwrap();
        assert_eq!(
            (footer["tags"].nulls, footer["orbit"].nulls),
            (None, Some(86))
        );
        // An infinite end is no range.
        let sql = footer_sql(
            "tycho/f.parquet",
            &[column("H", "DOUBLE"), column("d", "DATE")],
        )
        .unwrap();
        assert!(
            sql.contains("isfinite(CAST(max(TRY_CAST(stats_max AS DOUBLE)) AS DOUBLE))"),
            "{sql}"
        );
        assert!(
            sql.contains("isfinite(min(TRY_CAST(stats_min AS DATE)))"),
            "{sql}"
        );
    }

    #[test]
    fn another_tables_profiles_never_speak_for_a_csv_loading() {
        let columns = [column("name", "VARCHAR")];
        let mut profiling = Profiling::default();
        profiling.ask(vec!["name".into()]);
        let parquet = key(1, 100, None);
        let (due, _) = profiling.due(
            Some(&parquet),
            Some("tycho/f.parquet"),
            &columns,
            false,
            0.0,
        );
        let values = result(vec![
            ("n", ints(&[100])),
            ("present", ints(&[100])),
            ("distinct_values", ints(&[1])),
            ("v", strings(&[Some("x")])),
            ("c", ints(&[100])),
        ]);
        let exact = due.iter().find(|due| due.column.is_some()).unwrap();
        profiling.answer(exact, &columns, Ok(values));
        assert!(profiling.facts(1.0)[0].profile.is_some());
        let csv = Key {
            table: 2,
            scan: Scan::relation("SELECT 1", 10),
        };
        profiling.due(Some(&csv), None, &columns, true, 2.0);
        let facts = &profiling.facts(2.0)[0];
        assert_eq!(
            (facts.profile.clone(), facts.waiting),
            (None, Some(Waiting::Loading))
        );
        assert!(profiling.footer_nulls().is_empty());
    }

    #[test]
    fn a_column_the_file_doesnt_have_is_said_and_never_read() {
        let mut profiling = Profiling::default();
        profiling.ask(vec!["nope".into()]);
        let (due, _) = profiling.due(
            Some(&key(1, 10, None)),
            None,
            &[column("H", "DOUBLE")],
            false,
            0.0,
        );
        assert!(due.is_empty());
        let facts = &profiling.facts(0.0)[0];
        assert!(!facts.reading);
        assert_eq!(facts.failed.as_deref(), Some("there's no column nope"));
    }

    #[test]
    fn a_scroll_wakes_the_profile_when_its_wait_is_over() {
        let columns = [column("H", "DOUBLE")];
        let mut profiling = Profiling::default();
        profiling.ask(vec!["H".into()]);
        let key = key(1, 10, None);
        profiling.due(Some(&key), None, &columns, false, 0.0);
        assert!(profiling.take_changed());
        profiling.scrolled(100.0);
        assert!(profiling.take_changed());
        let (_, wake) = profiling.due(Some(&key), None, &columns, false, 150.0);
        assert_eq!(wake, Some(100.0 + SCROLL_MS));
        assert_eq!(profiling.facts(150.0)[0].waiting, Some(Waiting::Scrolling));
    }

    #[test]
    fn a_profile_asked_while_scrolling_is_woken_when_the_scroll_is_over() {
        let columns = [column("H", "DOUBLE")];
        let mut profiling = Profiling::default();
        profiling.scrolled(100.0);
        profiling.ask(vec!["H".into()]);
        let (due, wake) = profiling.due(Some(&key(1, 10, None)), None, &columns, false, 150.0);
        assert_eq!(due.len(), 1);
        assert_eq!(profiling.facts(150.0)[0].waiting, Some(Waiting::Scrolling));
        assert_eq!(wake, Some(100.0 + SCROLL_MS));
    }

    #[test]
    fn only_a_scroll_that_starts_a_wait_has_the_sync_do_anything() {
        let columns = [column("H", "DOUBLE")];
        let mut profiling = Profiling::default();
        // Nothing out: a scroll changes nothing a sync would see.
        profiling.scrolled(0.0);
        assert!(!profiling.take_changed());
        profiling.ask(vec!["H".into()]);
        profiling.due(Some(&key(1, 10, None)), None, &columns, false, 1_000.0);
        assert!(profiling.take_changed());
        profiling.scrolled(1_000.0);
        assert!(profiling.take_changed());
        for frame in 1..30 {
            profiling.scrolled(1_000.0 + 16.0 * f64::from(frame));
            assert!(!profiling.take_changed(), "frame {frame}");
        }
        // Its end is scheduled from the last move.
        let (_, wake) = profiling.due(Some(&key(1, 10, None)), None, &columns, false, 1_500.0);
        assert_eq!(wake, Some(1_000.0 + 16.0 * 29.0 + SCROLL_MS));
        // A scroll after that one settled starts another wait.
        profiling.scrolled(3_000.0);
        assert!(profiling.take_changed());
    }

    #[test]
    fn a_scroll_is_the_thumb_moved_on_one_table_with_the_same_rows() {
        let bounds = |y: f32, h: f32| Bounds {
            origin: gpui_kit::point(gpui_kit::px(0.), gpui_kit::px(y)),
            size: gpui_kit::size(gpui_kit::px(10.), gpui_kit::px(h)),
        };
        let track = bounds(0., 800.);
        let mut profiling = Profiling::default();
        profiling.scrollbar(1, 100, track, bounds(300., 40.), 0.0);
        // Another table's first report, its thumb at the top: no scroll.
        profiling.scrollbar(2, 100, track, bounds(0., 40.), 10.0);
        assert_eq!(profiling.scrolled, None);
        // New rows (another size) or a resize (another track): no scroll.
        profiling.scrollbar(2, 90, track, bounds(20., 60.), 20.0);
        profiling.scrollbar(2, 90, bounds(0., 700.), bounds(30., 60.), 30.0);
        assert_eq!(profiling.scrolled, None);
        // A filter on a large table: the thumb at its least size, moved to
        // the top by the new rows, isn't a scroll.
        profiling.scrollbar(2, 42_000_000, bounds(0., 700.), bounds(300., 24.), 35.0);
        profiling.scrollbar(2, 813_348, bounds(0., 700.), bounds(0., 24.), 36.0);
        assert_eq!(profiling.scrolled, None);
        // The same thumb moved on the same track, whatever moved it.
        profiling.scrollbar(2, 813_348, bounds(0., 700.), bounds(90., 24.), 40.0);
        assert_eq!(profiling.scrolled, Some(40.0));
    }

    #[test]
    fn a_failed_profile_is_read_again_when_it_is_asked_again() {
        let columns = [column("H", "DOUBLE")];
        let mut profiling = Profiling::default();
        let key = key(1, 10, None);
        profiling.ask(vec!["H".into()]);
        let (due, _) = profiling.due(Some(&key), None, &columns, false, 0.0);
        profiling.answer(&due[0], &columns, Err("out of memory".into()));
        assert_eq!(
            profiling.facts(1.0)[0].failed.as_deref(),
            Some("out of memory")
        );
        // Still open: said, not sent again.
        profiling.ask(vec!["H".into()]);
        assert!(
            profiling
                .due(Some(&key), None, &columns, false, 2.0)
                .0
                .is_empty()
        );
        // Closed, then asked again: read again.
        profiling.ask(Vec::new());
        profiling.due(Some(&key), None, &columns, false, 3.0);
        profiling.ask(vec!["H".into()]);
        let (due, _) = profiling.due(Some(&key), None, &columns, false, 4.0);
        assert_eq!(due.len(), 1);
        assert_eq!(profiling.facts(4.0)[0].failed, None);
    }

    #[test]
    fn filters_that_cant_be_written_read_nothing_and_say_why() {
        let columns = [column("H", "DOUBLE"), column("e", "DOUBLE")];
        let mut profiling = Profiling::default();
        let scan = || Scan::parquet("tycho/f.parquet", 10);
        let some = profiling.key_of(1, scan(), Ok(Some(r#"("H" > 1)"#.into())));
        profiling.ask(vec!["H".into()]);
        let (due, _) = profiling.due(Some(&some), Some("tycho/f.parquet"), &columns, false, 0.0);
        assert_eq!(due.len(), 2);
        // A column retyped since: the rows in view aren't known. Nothing is
        // read, what's out is no longer out (so canceled), an ask is kept,
        // and each column says why; the footer speaks for no filtered view.
        let refused = profiling.key_of(1, scan(), Err("there's no column H".into()));
        profiling.ask(vec!["H".into(), "e".into()]);
        let (due, _) = profiling.due(
            Some(&refused),
            Some("tycho/f.parquet"),
            &columns,
            false,
            1.0,
        );
        assert!(due.iter().all(|due| due.column.is_none()));
        assert!(!profiling.entries["H"].out);
        let facts = profiling.facts(1.0);
        assert!(facts.iter().all(|facts| facts.failed.as_deref()
            == Some("the filters can't be read: there's no column H")
            && facts.profile.is_none()
            && !facts.reading));
        assert!(profiling.footer_nulls().is_empty());
        // Written again: `e`, never read, at once; `H`, read before of
        // these rows' table, after the pause.
        let again = profiling.key_of(1, scan(), Ok(Some(r#"("H" > 2)"#.into())));
        let (due, _) = profiling.due(Some(&again), Some("tycho/f.parquet"), &columns, false, 2.0);
        assert_eq!(
            due.iter()
                .filter_map(|due| due.column.as_deref())
                .collect::<Vec<_>>(),
            ["e"]
        );
        let (due, _) = profiling.due(
            Some(&again),
            Some("tycho/f.parquet"),
            &columns,
            false,
            2.0 + PAUSE_MS,
        );
        assert_eq!(
            due.iter()
                .filter_map(|due| due.column.as_deref())
                .collect::<Vec<_>>(),
            ["H"]
        );
    }

    #[test]
    fn a_closed_file_forgets_the_columns_asked_and_an_ask_while_opening_is_kept() {
        let columns = [column("H", "DOUBLE")];
        let mut profiling = Profiling::default();
        profiling.ask(vec!["H".into()]);
        profiling.due(Some(&key(1, 10, None)), None, &columns, false, 0.0);
        // Closed: forgotten, so a column of the same name in the next file
        // isn't read.
        profiling.forget();
        profiling.due(None, None, &[], false, 1.0);
        let (due, _) = profiling.due(Some(&key(2, 10, None)), None, &columns, false, 2.0);
        assert!(due.is_empty() && profiling.asked().is_empty());
        // Asked while the next file opens (no key, render after render):
        // read once it's open.
        profiling.forget();
        profiling.ask(vec!["H".into()]);
        profiling.due(None, None, &[], false, 3.0);
        profiling.due(None, None, &[], false, 4.0);
        let (due, _) = profiling.due(Some(&key(3, 10, None)), None, &columns, false, 5.0);
        assert_eq!(due.len(), 1);
    }

    #[test]
    fn a_query_out_says_which_foreground_query_it_waits_behind() {
        let columns = [column("H", "DOUBLE")];
        let mut profiling = Profiling::default();
        profiling.set_foreground(Some(Waiting::Find));
        profiling.ask(vec!["H".into()]);
        // Nothing out yet: nothing waits.
        assert_eq!(profiling.facts(0.0)[0].waiting, None);
        profiling.due(Some(&key(1, 10, None)), None, &columns, false, 0.0);
        profiling.scrolled(0.0);
        assert_eq!(profiling.facts(1.0)[0].waiting, Some(Waiting::Find));
        profiling.set_foreground(Some(Waiting::Sort));
        assert_eq!(profiling.facts(1.0)[0].waiting, Some(Waiting::Sort));
        profiling.set_foreground(None);
        assert_eq!(profiling.facts(1.0)[0].waiting, Some(Waiting::Scrolling));
        assert_eq!(Waiting::Filter.words(), "waiting for the filter to finish");
    }

    #[test]
    fn a_small_source_is_read_whole_and_a_large_one_sampled_by_its_rows() {
        assert_eq!(
            Scan::parquet("tycho/f.parquet", 71_431).sample_percent(),
            None
        );
        assert_eq!(
            Scan::parquet("tycho/f.parquet", SMALL_ROWS).sample_percent(),
            None
        );
        // 200,000 of 4,702,569 is 4.25%: 4.3, rounded up.
        assert_eq!(
            Scan::parquet("tycho/f.parquet", 4_702_569).sample_percent(),
            Some(4.3)
        );
        // Of 42,323,121, 0.4726%: 0.48.
        assert_eq!(
            Scan::parquet("tycho/f.parquet", 42_323_121).sample_percent(),
            Some(0.48)
        );
        // Never under 0.01%.
        assert_eq!(
            Scan::parquet("tycho/f.parquet", 1 << 40).sample_percent(),
            Some(0.01)
        );
    }

    #[test]
    fn a_filter_is_a_case_the_scan_cant_push_down() {
        let scan =
            Scan::parquet("tycho/f.parquet", 10).filtered(Some(r#"("class" = 'MCA')"#.into()));
        let sql = exact_sql(&scan, &column("H", "DOUBLE"));
        assert!(
            sql.contains(r#"CASE WHEN ("class" = 'MCA') THEN true ELSE false END AS k"#),
            "{sql}"
        );
        assert!(sql.contains(") WHERE k)"), "{sql}");
        assert!(!sql.contains(r#"WHERE ("class""#), "{sql}");
        // Unfiltered, no condition at all.
        let sql = exact_sql(
            &Scan::parquet("tycho/f.parquet", 10),
            &column("H", "DOUBLE"),
        );
        assert!(!sql.contains("WHERE k"), "{sql}");
    }

    #[test]
    fn names_and_files_are_quoted() {
        let scan = Scan::parquet("tycho/it's.parquet", 10);
        let odd = column(r#"say "hi""#, "VARCHAR");
        let sql = exact_sql(&scan, &odd);
        assert!(sql.contains(r#""say ""hi""""#), "{sql}");
        assert!(sql.contains("read_parquet('tycho/it''s.parquet')"), "{sql}");
        let footer = footer_sql("tycho/it's.parquet", &[odd]).unwrap();
        assert!(
            footer.contains(r#"path_in_schema = 'say "hi"'"#),
            "{footer}"
        );
        assert!(
            footer.contains("parquet_metadata('tycho/it''s.parquet')"),
            "{footer}"
        );
    }

    #[test]
    fn a_sample_is_taken_on_the_source_and_the_bins_are_numbers() {
        let scan = Scan::parquet("tycho/f.parquet", 42_323_121);
        let sql = sample_sql(&scan, &column("H", "DOUBLE"), 0.48);
        assert!(
            sql.contains("FROM read_parquet('tycho/f.parquet') TABLESAMPLE 0.48% (system, 42)"),
            "{sql}"
        );
        assert!(sql.contains("range(20)"), "{sql}");
        let bins = bins_sql(&scan, &column("first_obs", "DATE"), -5e9, 1.8e9).unwrap();
        assert!(bins.contains("epoch(v)"), "{bins}");
        assert!(bins.contains("CAST(-5000000000.0 AS DOUBLE)"), "{bins}");
        assert_eq!(bins_sql(&scan, &column("class", "VARCHAR"), 0.0, 1.0), None);
    }

    #[test]
    fn text_kinds_not_stored_as_text_are_read_as_text() {
        let scan = Scan::parquet("tycho/f.parquet", 10);
        assert!(
            exact_sql(&scan, &column("crewed", "BOOLEAN")).contains(r#"CAST("crewed" AS VARCHAR)"#)
        );
        assert!(!exact_sql(&scan, &column("orbit", "VARCHAR")).contains("CAST(\"orbit\""));
    }

    #[test]
    fn the_footer_gives_a_range_only_when_every_row_group_has_both_ends() {
        let footer = read_footer(&result(vec![
            (
                "name",
                strings(&[Some("apogee_km"), Some("inclination_deg"), Some("orbit")]),
            ),
            ("nulls", ints(&[1, 1, 86])),
            (
                "nulls_known",
                Arc::new(BooleanArray::from(vec![true, true, true])),
            ),
            ("lo", strings(&[Some("-4788696.0"), Some("0.0"), None])),
            ("hi", strings(&[Some("3971603.0"), Some("150.97"), None])),
            (
                "range_known",
                Arc::new(BooleanArray::from(vec![false, true, false])),
            ),
        ]))
        .unwrap();
        assert_eq!(
            footer["apogee_km"],
            FooterColumn {
                nulls: Some(1),
                range: None
            }
        );
        assert_eq!(
            footer["inclination_deg"].profile(71_431).hi.as_deref(),
            Some("150.97")
        );
        assert_eq!(footer["orbit"].nulls, Some(86));
    }

    fn numeric_rows(
        n: i64,
        present: i64,
        nonfinite: i64,
        distinct: i64,
        counts: [i64; BINS],
    ) -> QueryResult {
        let repeat = |value: i64| ints(&[value; BINS]);
        let text = |value: &str| strings(&[Some(value); BINS]);
        result(vec![
            ("n", repeat(n)),
            ("present", repeat(present)),
            ("nonfinite", repeat(nonfinite)),
            ("lo", text("0.0")),
            ("hi", text("150.97")),
            ("mean", text("62.869")),
            ("median", text("53.22")),
            ("distinct_values", repeat(distinct)),
            (
                "bin",
                Arc::new(Int32Array::from((0..BINS as i32).collect::<Vec<_>>())),
            ),
            ("c", ints(&counts)),
        ])
    }

    #[test]
    fn a_samples_distinct_count_is_a_floor_or_all_unique() {
        let inclination = column("inclination_deg", "DOUBLE");
        let mut counts = [0; BINS];
        counts[0] = 400;
        let profile =
            read_sample(&inclination, 0.48, &numeric_rows(1000, 999, 0, 400, counts)).unwrap();
        assert_eq!(profile.stage, Stage::Sample(0.48));
        assert_eq!(profile.nulls, Some(1));
        assert_eq!(profile.distinct, Some(Distinct::AtLeast(400)));
        assert_eq!(profile.median.as_deref(), Some("53.22"));
        assert!(matches!(&profile.shape, Some(Shape::Bins(bins)) if bins[0] == 400));
        // Every finite value differs: likely an ID, not a floor.
        let profile =
            read_sample(&inclination, 0.48, &numeric_rows(1000, 999, 9, 990, counts)).unwrap();
        assert_eq!(profile.distinct, Some(Distinct::AllUnique(990)));
        assert_eq!(profile.nonfinite, 9);
    }

    #[test]
    fn a_text_columns_values_are_read_most_first_and_none_is_no_value() {
        let orbit = column("orbit", "VARCHAR");
        let values = result(vec![
            ("n", ints(&[29_118, 29_118])),
            ("present", ints(&[29_035, 29_035])),
            ("distinct_values", ints(&[9, 9])),
            ("v", strings(&[Some("Low Earth"), Some("Geosynchronous")])),
            ("c", ints(&[26_382, 1_364])),
        ]);
        let (profile, range) = read_exact(&orbit, &values).unwrap();
        assert_eq!(range, None);
        assert_eq!(profile.nulls, Some(83));
        assert_eq!(profile.distinct, Some(Distinct::Exact(9)));
        assert_eq!(
            profile.shape,
            Some(Shape::Top(vec![
                ("Low Earth".into(), 26_382),
                ("Geosynchronous".into(), 1_364)
            ]))
        );
        // Every value null: the figures, and no values.
        let empty = result(vec![
            ("n", ints(&[5])),
            ("present", ints(&[0])),
            ("distinct_values", ints(&[0])),
            ("v", strings(&[None])),
            ("c", Arc::new(Int64Array::from(vec![None::<i64>]))),
        ]);
        let (profile, _) = read_exact(&orbit, &empty).unwrap();
        assert_eq!(profile.nulls, Some(5));
        assert_eq!(profile.shape, Some(Shape::Top(Vec::new())));
    }

    #[test]
    fn an_exact_number_gives_its_range_to_bin_over_and_then_its_bins() {
        let apogee = column("apogee_km", "DOUBLE");
        let figures = result(vec![
            ("n", ints(&[71_431])),
            ("present", ints(&[71_430])),
            ("nonfinite", ints(&[51])),
            ("lo", strings(&[Some("-4788696.0")])),
            ("hi", strings(&[Some("3971603.0")])),
            ("mean", strings(&[Some("5506.67")])),
            ("median", strings(&[Some("588.0")])),
            ("distinct_values", ints(&[7_931])),
            ("lo_at", Arc::new(Float64Array::from(vec![-4_788_696.0]))),
            ("hi_at", Arc::new(Float64Array::from(vec![3_971_603.0]))),
        ]);
        let (profile, range) = read_exact(&apogee, &figures).unwrap();
        assert_eq!((profile.nonfinite, profile.nulls), (51, Some(1)));
        assert_eq!(profile.distinct, Some(Distinct::Exact(7_931)));
        assert_eq!(range, Some((-4_788_696.0, 3_971_603.0)));
        let bins = read_bins(&result(vec![
            ("bin", Arc::new(Int32Array::from(vec![10, 19]))),
            ("c", ints(&[65_934, 2])),
        ]))
        .unwrap();
        let Shape::Bins(bins) = bins else { panic!() };
        assert_eq!(
            (bins[10], bins[19], bins.iter().sum::<u64>()),
            (65_934, 2, 65_936)
        );
    }
}
