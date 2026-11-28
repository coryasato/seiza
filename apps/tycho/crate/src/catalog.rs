//! The catalog: the named questions Tycho can ask of a column, one table
//! that every reader takes them from (the research's "The catalog"). The
//! grammar reads it for its verbs, their parts, completion, and refusals
//! (`command`); the capability schema and an agent's instructions will read
//! it too, so none of them offers what Tycho can't run.
//!
//! Each [`Entry`] is a name, the column types it takes, its parts, where
//! it answers (the log, a view, or both, as `duplicates` will), and its
//! SQL. Its first entries are the small answers `top`, `nulls`, and
//! `distinct` (`docs/DECISIONS.md`, "Scope", 2026-11-21), each exact over
//! every row in view: the view's filters reach the query as the profile's
//! `CASE` ([`Scan::kept`]), never a `WHERE`, every name quoted by
//! `quote_identifier`. `group` will be an entry with several columns and a
//! view for its answer ("Views and grouping").

use seiza_duckdb::arrow::QueryResult;
use seiza_duckdb::sql::{ColumnInfo, quote_identifier};
use serde::Serialize;

use crate::dataset::format_count;
use crate::filter::Kind;
use crate::profile::{Scan, Unreadable, count, finite, text};

/// Which question an entry asks: what its SQL and its answer's reading
/// match on.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Which {
    Top,
    Nulls,
    Distinct,
}

/// What a part of an entry takes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum PartKind {
    /// One column the entry's types take.
    Column,
    /// One or more columns, between commas (`group`'s keys, `duplicates`).
    Columns,
    /// A whole number from 1 to `most`, `default` when it's left out.
    Count { default: u64, most: u64 },
}

/// A part of an entry, after its name, in the order it's written.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct Part {
    /// Its name in the bar's row of parts and as JSON's key.
    pub name: &'static str,
    pub kind: PartKind,
    /// It may be left out.
    pub optional: bool,
}

/// Where an entry's answer goes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Answers {
    /// A small answer in the log, changing no view.
    Log,
    /// A view of its own (`group`).
    View,
    /// Both: a word in the log, and a view when there's one to open
    /// (`duplicates`).
    LogAndView,
}

/// One named question.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct Entry {
    pub which: Which,
    /// Its verb, typed or as JSON's key.
    pub name: &'static str,
    /// What it does, completion's hint.
    pub hint: &'static str,
    /// The column types it takes.
    pub takes: &'static [Kind],
    pub parts: &'static [Part],
    pub answers: Answers,
    /// It typed, as an example a refusal can show.
    pub example: &'static str,
}

/// Every column type.
const ANY: &[Kind] = &[Kind::Number, Kind::Text, Kind::Time, Kind::Boolean];

const COLUMN: Part = Part {
    name: "column",
    kind: PartKind::Column,
    optional: false,
};

/// `top`'s count: how many values, left out 5, at most [`TOP_MOST`].
pub const TOP_DEFAULT: u64 = 5;

/// The most values `top` lists: an answer in the log stays short.
pub const TOP_MOST: u64 = 50;

/// The catalog, in the order completion lists it.
pub const ENTRIES: &[Entry] = &[
    Entry {
        which: Which::Top,
        name: "top",
        hint: "A column's most common values",
        takes: ANY,
        parts: &[
            COLUMN,
            Part {
                name: "count",
                kind: PartKind::Count {
                    default: TOP_DEFAULT,
                    most: TOP_MOST,
                },
                optional: true,
            },
        ],
        answers: Answers::Log,
        example: "top orbit 10",
    },
    Entry {
        which: Which::Nulls,
        name: "nulls",
        hint: "Count the empty cells in a column",
        takes: ANY,
        parts: &[COLUMN],
        answers: Answers::Log,
        example: "nulls end_date",
    },
    Entry {
        which: Which::Distinct,
        name: "distinct",
        hint: "Count a column's different values",
        takes: ANY,
        parts: &[COLUMN],
        answers: Answers::Log,
        example: "distinct owner",
    },
];

/// The entry named `word`, without regard to case.
pub fn entry(word: &str) -> Option<&'static Entry> {
    ENTRIES
        .iter()
        .find(|entry| entry.name.eq_ignore_ascii_case(word))
}

impl Entry {
    /// Its count part's default and most, if it has one.
    pub fn count_part(&self) -> Option<(u64, u64)> {
        self.parts.iter().find_map(|part| match part.kind {
            PartKind::Count { default, most } => Some((default, most)),
            _ => None,
        })
    }

    /// Its count as written (`1,000` read as 1000), or its default when
    /// none is; none when it's not a whole number from 1 to its most. 0 for
    /// an entry that takes no count.
    pub fn count_of(&self, written: Option<&str>) -> Option<u64> {
        let Some((default, most)) = self.count_part() else {
            return Some(0);
        };
        match written {
            None => Some(default),
            Some(written) => written
                .replace(',', "")
                .trim()
                .parse::<u64>()
                .ok()
                .filter(|count| (1..=most).contains(count)),
        }
    }

    /// Whether it takes a column of `kind`.
    pub fn takes(&self, kind: Kind) -> bool {
        self.takes.contains(&kind)
    }

    /// Why it doesn't take column `shown`, of `kind`, with what it takes.
    pub fn refusal(&self, shown: &str, kind: Kind) -> String {
        format!(
            "{} doesn't apply to {shown}, which holds {}: it takes {}.",
            self.name,
            kind.name(),
            crate::command::list(self.takes.iter().map(|kind| kind.name()), "or")
        )
    }

    /// Its question as plain words, of column `shown` (quoted as typed);
    /// for a count that isn't one it takes (`top x 0`), no count.
    pub fn words(&self, shown: &str, count: Option<u64>) -> String {
        match self.which {
            Which::Top if count == Some(1) => format!("The most common value of {shown}"),
            Which::Top => match count {
                Some(count) => format!("The {count} most common values of {shown}"),
                None => format!("The most common values of {shown}"),
            },
            Which::Nulls => format!("Count the nulls in {shown}"),
            Which::Distinct => format!("Count the distinct values of {shown}"),
        }
    }

    /// What the bar and the log say while it's out.
    pub fn asking(&self, shown: &str) -> String {
        match self.which {
            Which::Top => format!("Reading the most common values of {shown}…"),
            Which::Nulls => format!("Counting the nulls in {shown}…"),
            Which::Distinct => format!("Counting the distinct values of {shown}…"),
        }
    }

    /// Its SQL for `column` over the rows in view of `scan`, exact: one
    /// row for `nulls` (`n`, `nulls`, `nonfinite`) and `distinct` (`n`,
    /// `present`, `distinct_values`); for `top`, a row a value, most first,
    /// `count` at most (`n`, `present`, `distinct_values`, `v`, `c`), or
    /// one with no value when there's none.
    pub fn sql(&self, scan: &Scan, column: &ColumnInfo, count: u64) -> String {
        let rows = scan.kept(&quote_identifier(&column.name));
        match self.which {
            Which::Nulls => {
                let nonfinite = match Kind::of(column) {
                    kind @ (Kind::Number | Kind::Time) => format!(
                        "count(*) FILTER (v IS NOT NULL AND NOT ({}))",
                        finite(kind == Kind::Time)
                    ),
                    Kind::Text | Kind::Boolean => "0".into(),
                };
                format!(
                    "SELECT count(*) AS n, count(*) FILTER (v IS NULL) AS nulls, {nonfinite} AS nonfinite FROM ({rows})"
                )
            }
            Which::Distinct => format!(
                "SELECT count(*) AS n, count(v) AS present, count(DISTINCT v) AS distinct_values FROM ({rows})"
            ),
            // Grouped once, the values ranked by their own type's order
            // among ties and written as text after.
            Which::Top => format!(
                "WITH g AS MATERIALIZED (SELECT v, count(*) AS c FROM ({rows}) GROUP BY v), \
                 a AS (SELECT CAST(coalesce(sum(c), 0) AS BIGINT) AS n, \
                 CAST(coalesce(sum(c) FILTER (v IS NOT NULL), 0) AS BIGINT) AS present, \
                 count(v) AS distinct_values FROM g), \
                 t AS (SELECT CAST(g.v AS VARCHAR) AS v, g.c AS c, row_number() OVER (ORDER BY g.c DESC, g.v) AS r \
                 FROM g WHERE g.v IS NOT NULL ORDER BY r LIMIT {count}) \
                 SELECT a.n, a.present, a.distinct_values, t.v, t.c FROM a LEFT JOIN t ON true ORDER BY t.r"
            ),
        }
    }

    /// Its answer from what [`Entry::sql`] returned, for `column` written
    /// as `shown`.
    pub fn read(&self, shown: &str, result: &QueryResult) -> Result<Answer, String> {
        let unreadable = |Unreadable(why): Unreadable| format!("Its answer isn't readable: {why}.");
        if result.num_rows() == 0 {
            return Err("It answered nothing.".into());
        }
        let rows = count(result, 0, 0).map_err(unreadable)?;
        if rows == 0 {
            return Ok(Answer::text("No row is in view."));
        }
        let of = format!(
            "{} row{} in view",
            format_count(rows),
            if rows == 1 { "" } else { "s" }
        );
        Ok(match self.which {
            Which::Nulls => {
                let nulls = count(result, 0, 1).map_err(unreadable)?;
                let nonfinite = count(result, 0, 2).map_err(unreadable)?;
                let mut text = if nulls == 0 {
                    format!("No nulls in {shown} · {of}")
                } else {
                    format!(
                        "{} null{} · {} of the rows in view",
                        format_count(nulls),
                        if nulls == 1 { "" } else { "s" },
                        percent(nulls, rows)
                    )
                };
                if nonfinite > 0 {
                    text.push_str(&format!(" · {} infinite or NaN", format_count(nonfinite)));
                }
                Answer::text(text)
            }
            Which::Distinct => {
                let present = count(result, 0, 1).map_err(unreadable)?;
                let distinct = count(result, 0, 2).map_err(unreadable)?;
                Answer::text(format!(
                    "{} distinct value{}{} · {of}",
                    format_count(distinct),
                    if distinct == 1 { "" } else { "s" },
                    nulls_besides(rows - present)
                ))
            }
            Which::Top => {
                let present = count(result, 0, 1).map_err(unreadable)?;
                let distinct = count(result, 0, 2).map_err(unreadable)?;
                let values = (0..result.num_rows())
                    .filter_map(|row| {
                        let value = text(result, row, 3)?;
                        Some(count(result, row, 4).map(|c| TopValue {
                            value,
                            count: format_count(c),
                            share: percent(c, rows),
                        }))
                    })
                    .collect::<Result<Vec<_>, _>>()
                    .map_err(unreadable)?;
                let nulls = nulls_besides(rows - present);
                let head = match (distinct, values.len() as u64) {
                    (0, _) => format!("No value but null · {of}"),
                    (1, _) => format!("One value{nulls} · {of}"),
                    (distinct, 1) => format!(
                        "The most common of {} values{nulls} · {of}",
                        format_count(distinct)
                    ),
                    (distinct, shown) if shown >= distinct => {
                        format!("All {} values{nulls} · {of}", format_count(distinct))
                    }
                    (distinct, shown) => format!(
                        "The {} most common of {} values{nulls} · {of}",
                        format_count(shown),
                        format_count(distinct)
                    ),
                };
                Answer { text: head, values }
            }
        })
    }
}

/// ", and null" for a column with nulls besides its values: neither
/// `distinct` nor `top` counts null as a value.
fn nulls_besides(nulls: u64) -> String {
    match nulls {
        0 => String::new(),
        nulls => format!(
            " and {} null{}",
            format_count(nulls),
            if nulls == 1 { "" } else { "s" }
        ),
    }
}

/// `part` of `of` as a share: one decimal, `<0.1%` for a few, `>99.9%`
/// for all but a few, and `100%` only for all.
pub fn percent(part: u64, of: u64) -> String {
    if of == 0 || part == 0 {
        return "0%".into();
    }
    if part >= of {
        return "100%".into();
    }
    let share = part as f64 / of as f64 * 100.0;
    if share < 0.1 {
        "<0.1%".into()
    } else if share > 99.9 {
        ">99.9%".into()
    } else {
        let text = format!("{share:.1}");
        format!("{}%", text.strip_suffix(".0").unwrap_or(&text))
    }
}

/// An entry's answer: its line, and for `top` its values.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Answer {
    pub text: String,
    pub values: Vec<TopValue>,
}

impl Answer {
    fn text(text: impl Into<String>) -> Self {
        Self {
            text: text.into(),
            values: Vec::new(),
        }
    }
}

/// One of `top`'s values, its count and share of the rows in view as the
/// log shows them.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct TopValue {
    pub value: String,
    pub count: String,
    pub share: String,
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use arrow::array::{ArrayRef, Int64Array, StringArray};
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

    fn ints(values: &[i64]) -> ArrayRef {
        Arc::new(Int64Array::from(values.to_vec()))
    }

    fn strings(values: &[Option<&str>]) -> ArrayRef {
        Arc::new(StringArray::from(values.to_vec()))
    }

    fn named(name: &str) -> &'static Entry {
        entry(name).unwrap()
    }

    #[test]
    fn the_first_entries_are_named_and_typed() {
        let names: Vec<&str> = ENTRIES.iter().map(|entry| entry.name).collect();
        assert_eq!(names, ["top", "nulls", "distinct"]);
        assert_eq!(entry("TOP").map(|entry| entry.which), Some(Which::Top));
        assert_eq!(entry("group"), None);
        assert_eq!(named("top").count_part(), Some((5, 50)));
        assert_eq!(named("nulls").count_part(), None);
        assert!(ENTRIES.iter().all(|entry| entry.answers == Answers::Log));
        assert!(ENTRIES.iter().all(|entry| entry.takes(Kind::Boolean)));
        assert_eq!(
            named("nulls").refusal("mag", Kind::Number),
            "nulls doesn't apply to mag, which holds a number: it takes a number, text, a time, or true or false."
        );
        // The table reads as JSON, for the capability schema to come.
        let json = serde_json::to_value(named("top")).unwrap();
        assert_eq!(json["parts"][1]["kind"]["kind"], "count");
        assert_eq!(json["answers"], "log");
    }

    #[test]
    fn its_sql_reads_every_row_in_view_through_the_filters_case() {
        let scan = Scan::parquet("tycho/file-1.parquet", 71_431);
        let column = ColumnInfo::new("end date", "DATE");
        let sql = named("nulls").sql(&scan, &column, 0);
        assert_eq!(
            sql,
            "SELECT count(*) AS n, count(*) FILTER (v IS NULL) AS nulls, \
             count(*) FILTER (v IS NOT NULL AND NOT (v IS NOT NULL AND isfinite(v))) AS nonfinite \
             FROM (SELECT v FROM (SELECT \"end date\" AS v, true AS k FROM read_parquet('tycho/file-1.parquet')))"
        );
        let filtered = scan.filtered(Some("\"object_type\" = 'P'".into()));
        let sql = named("distinct").sql(&filtered, &ColumnInfo::new("owner", "VARCHAR"), 0);
        assert!(sql.contains("CASE WHEN \"object_type\" = 'P' THEN true ELSE false END AS k"));
        assert!(sql.contains(") WHERE k)"));
        assert!(!sql.contains("WHERE \"object_type\""));
        let top = named("top").sql(&filtered, &ColumnInfo::new("orbit", "VARCHAR"), 7);
        assert!(top.contains("LIMIT 7"));
        // Text alone has no infinities to count.
        assert!(
            named("nulls")
                .sql(&filtered, &ColumnInfo::new("orbit", "VARCHAR"), 0)
                .contains(", 0 AS nonfinite")
        );
    }

    #[test]
    fn nulls_says_the_share_of_the_rows_in_view() {
        let answer = |n, nulls, nonfinite| {
            named("nulls")
                .read(
                    "end_date",
                    &result(vec![
                        ("n", ints(&[n])),
                        ("nulls", ints(&[nulls])),
                        ("nonfinite", ints(&[nonfinite])),
                    ]),
                )
                .unwrap()
                .text
        };
        assert_eq!(
            answer(29_118, 19_998, 0),
            "19,998 nulls · 68.7% of the rows in view"
        );
        assert_eq!(
            answer(71_431, 1, 51),
            "1 null · <0.1% of the rows in view · 51 infinite or NaN"
        );
        assert_eq!(answer(10, 0, 0), "No nulls in end_date · 10 rows in view");
        assert_eq!(answer(0, 0, 0), "No row is in view.");
        assert_eq!(answer(4, 4, 0), "4 nulls · 100% of the rows in view");
    }

    #[test]
    fn distinct_counts_values_and_says_the_nulls_besides() {
        let answer = |n, present, distinct| {
            named("distinct")
                .read(
                    "x",
                    &result(vec![
                        ("n", ints(&[n])),
                        ("present", ints(&[present])),
                        ("distinct_values", ints(&[distinct])),
                    ]),
                )
                .unwrap()
                .text
        };
        assert_eq!(
            answer(29_118, 29_118, 2_369),
            "2,369 distinct values · 29,118 rows in view"
        );
        assert_eq!(
            answer(71_431, 71_430, 7_931),
            "7,931 distinct values and 1 null · 71,431 rows in view"
        );
        assert_eq!(answer(1, 1, 1), "1 distinct value · 1 row in view");
    }

    #[test]
    fn top_lists_values_most_first_with_counts_and_shares() {
        let read = |n: i64, present: i64, distinct: i64, values: &[(Option<&str>, i64)]| {
            let rows = values.len().max(1);
            let pad = |value: i64| ints(&vec![value; rows]);
            let (v, c): (Vec<Option<&str>>, Vec<i64>) = if values.is_empty() {
                (vec![None], vec![0])
            } else {
                values.iter().copied().unzip()
            };
            named("top")
                .read(
                    "orbit",
                    &result(vec![
                        ("n", pad(n)),
                        ("present", pad(present)),
                        ("distinct_values", pad(distinct)),
                        ("v", strings(&v)),
                        ("c", ints(&c)),
                    ]),
                )
                .unwrap()
        };
        let answer = read(
            29_118,
            29_034,
            9,
            &[(Some("LEO/I"), 18_101), (Some("GEO/S"), 1_364)],
        );
        assert_eq!(
            answer.text,
            "The 2 most common of 9 values and 84 nulls · 29,118 rows in view"
        );
        assert_eq!(
            answer.values[0],
            TopValue {
                value: "LEO/I".into(),
                count: "18,101".into(),
                share: "62.2%".into()
            }
        );
        assert_eq!(
            read(29_118, 29_034, 9, &[(Some("LEO/I"), 18_101)]).text,
            "The most common of 9 values and 84 nulls · 29,118 rows in view"
        );
        let top = named("top");
        assert_eq!(top.count_of(None), Some(5));
        assert_eq!(top.count_of(Some("1,0")), Some(10));
        assert_eq!(top.count_of(Some("0")), None);
        assert_eq!(top.count_of(Some("1,000")), None);
        assert_eq!(named("nulls").count_of(Some("3")), Some(0));
        assert_eq!(top.words("mag", None), "The most common values of mag");
        assert_eq!(top.words("mag", Some(1)), "The most common value of mag");
        let all = read(3, 3, 2, &[(Some("a"), 2), (Some("b"), 1)]);
        assert_eq!(all.text, "All 2 values · 3 rows in view");
        assert_eq!(
            read(3, 0, 0, &[]).text,
            "No value but null · 3 rows in view"
        );
        assert!(read(3, 0, 0, &[]).values.is_empty());
    }

    #[test]
    fn shares() {
        assert_eq!(percent(0, 10), "0%");
        assert_eq!(percent(1, 3), "33.3%");
        assert_eq!(percent(1, 2), "50%");
        assert_eq!(percent(1, 10_000), "<0.1%");
        assert_eq!(percent(9_999, 10_000), ">99.9%");
        assert_eq!(percent(5, 5), "100%");
    }
}
