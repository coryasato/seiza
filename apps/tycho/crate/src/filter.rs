//! The view state's filters and its sort, as they're written down and as
//! SQL: a filter is a column by name, an operator, and its value or
//! values; the filters are combined with `AND` into the source's `WHERE`
//! (`docs/DECISIONS.md`, "Table and paging", 2026-11-26). Every value reaches SQL
//! through [`literal`], which reads it as the column's type and quotes it:
//! a filter's text is never joined into SQL as given.

use std::fmt;

use seiza_duckdb::sql::{ColumnInfo, quote_identifier, string_literal};
use seiza_tall_table::ColumnKind;
use serde::{Deserialize, Serialize};

/// A filter as the view state writes it: on GCAT,
/// `{"column": "inclination_deg", "op": ">=", "value": 90}`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Filter {
    pub column: String,
    pub op: Op,
    /// None for `is null` and `not null`; a list for `in` and `between`.
    #[serde(default, skip_serializing_if = "Values::is_none")]
    pub value: Values,
}

/// A filter's operator, as the grammar spells it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Op {
    #[serde(rename = "=")]
    Eq,
    #[serde(rename = "!=")]
    Ne,
    #[serde(rename = ">")]
    Gt,
    #[serde(rename = ">=")]
    Ge,
    #[serde(rename = "<")]
    Lt,
    #[serde(rename = "<=")]
    Le,
    #[serde(rename = "contains")]
    Contains,
    #[serde(rename = "starts")]
    Starts,
    #[serde(rename = "in")]
    In,
    #[serde(rename = "between")]
    Between,
    #[serde(rename = "is null")]
    IsNull,
    #[serde(rename = "not null")]
    NotNull,
}

impl Op {
    pub const ALL: [Op; 12] = [
        Op::Eq,
        Op::Ne,
        Op::Gt,
        Op::Ge,
        Op::Lt,
        Op::Le,
        Op::Contains,
        Op::Starts,
        Op::In,
        Op::Between,
        Op::IsNull,
        Op::NotNull,
    ];

    /// As the grammar writes it.
    pub fn as_str(self) -> &'static str {
        match self {
            Op::Eq => "=",
            Op::Ne => "!=",
            Op::Gt => ">",
            Op::Ge => ">=",
            Op::Lt => "<",
            Op::Le => "<=",
            Op::Contains => "contains",
            Op::Starts => "starts",
            Op::In => "in",
            Op::Between => "between",
            Op::IsNull => "is null",
            Op::NotNull => "not null",
        }
    }

    /// The operator as the grammar reads it, case ignored: its spelling,
    /// `==` for `=`, `<>` for `!=`, and `is not null` for `not null`.
    pub fn read(text: &str) -> Option<Op> {
        let lower = text.to_lowercase();
        match lower.as_str() {
            "==" => return Some(Op::Eq),
            "<>" => return Some(Op::Ne),
            "is not null" => return Some(Op::NotNull),
            _ => {}
        }
        Op::ALL.into_iter().find(|op| op.as_str() == lower)
    }

    /// The operator in a filter's words, as the editor reads it: `is at
    /// least`, and for a time `is on or after`.
    pub fn words(self, kind: Kind) -> &'static str {
        let time = kind == Kind::Time;
        match self {
            Op::Eq => "is",
            Op::Ne => "is not",
            Op::Gt if time => "is after",
            Op::Gt => "is more than",
            Op::Ge if time => "is on or after",
            Op::Ge => "is at least",
            Op::Lt if time => "is before",
            Op::Lt => "is less than",
            Op::Le if time => "is on or before",
            Op::Le => "is at most",
            Op::Contains => "contains",
            Op::Starts => "starts with",
            Op::In => "is any of",
            Op::Between => "is between",
            Op::IsNull => "has no value",
            Op::NotNull => "has a value",
        }
    }

    /// How many values it takes.
    pub fn arity(self) -> Arity {
        match self {
            Op::IsNull | Op::NotNull => Arity::None,
            Op::In => Arity::List,
            Op::Between => Arity::Two,
            _ => Arity::One,
        }
    }

    /// Whether a column of `kind` takes it: the comparisons and `between`
    /// for numbers and times, `contains` and `starts` for text, `=`, `!=`,
    /// `in`, and the nulls for every type but a boolean's, which takes
    /// `=`, `!=`, and the nulls.
    pub fn takes(self, kind: Kind) -> bool {
        match self {
            Op::Eq | Op::Ne | Op::IsNull | Op::NotNull => true,
            Op::In => kind != Kind::Boolean,
            Op::Gt | Op::Ge | Op::Lt | Op::Le | Op::Between => {
                matches!(kind, Kind::Number | Kind::Time)
            }
            Op::Contains | Op::Starts => kind == Kind::Text,
        }
    }
}

impl fmt::Display for Op {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// How many values an operator takes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Arity {
    None,
    One,
    Two,
    List,
}

/// What a column holds, as a filter reads its values.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Number,
    Text,
    Time,
    Boolean,
}

impl Kind {
    pub fn of(column: &ColumnInfo) -> Self {
        match column.tall_table_column().kind() {
            ColumnKind::Integer { .. } | ColumnKind::Float | ColumnKind::Decimal => Kind::Number,
            ColumnKind::Date | ColumnKind::Timestamp => Kind::Time,
            ColumnKind::Boolean => Kind::Boolean,
            _ => Kind::Text,
        }
    }

    /// The operators a column of this kind takes, in the grammar's order.
    pub fn ops(self) -> impl Iterator<Item = Op> {
        Op::ALL.into_iter().filter(move |op| op.takes(self))
    }

    /// A sort's direction in this kind's words: `oldest first`, `A to Z`.
    pub fn order_words(self, direction: Direction) -> &'static str {
        match (self, direction) {
            (Kind::Number, Direction::Asc) => "smallest first",
            (Kind::Number, Direction::Desc) => "largest first",
            (Kind::Time, Direction::Asc) => "oldest first",
            (Kind::Time, Direction::Desc) => "newest first",
            (Kind::Text, Direction::Asc) => "A to Z",
            (Kind::Text, Direction::Desc) => "Z to A",
            (Kind::Boolean, Direction::Asc) => "false first",
            (Kind::Boolean, Direction::Desc) => "true first",
        }
    }

    /// As a reason names it.
    pub fn name(self) -> &'static str {
        match self {
            Kind::Number => "a number",
            Kind::Text => "text",
            Kind::Time => "a time",
            Kind::Boolean => "true or false",
        }
    }
}

/// A filter's value or values, as written.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Values {
    #[default]
    None,
    One(Value),
    Many(Vec<Value>),
}

impl Values {
    pub fn is_none(&self) -> bool {
        matches!(self, Values::None)
    }
}

/// One value, as JSON writes it: a number, text (a date or a timestamp in
/// ISO form too), or a boolean.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Value {
    Bool(bool),
    Number(serde_json::Number),
    Text(String),
}

impl fmt::Display for Value {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Value::Bool(value) => write!(f, "{value}"),
            Value::Number(value) => write!(f, "{value}"),
            Value::Text(value) => f.write_str(value),
        }
    }
}

/// Why a filter can't apply to its column.
#[derive(Debug, Clone, PartialEq)]
pub enum FilterRefused {
    /// The operator isn't one the column's type takes.
    Op { op: Op, kind: Kind },
    /// Too few or too many values for the operator.
    Values { op: Op },
    /// A value that isn't the column's type.
    Value { value: String, kind: Kind },
    /// Text with a NUL character, which a SQL string can't hold.
    Nul,
}

impl fmt::Display for FilterRefused {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Op { op, kind } => write!(f, "{op} doesn't apply to {}", kind.name()),
            Self::Values { op } => match op.arity() {
                Arity::None => write!(f, "{op} takes no value"),
                Arity::One => write!(f, "{op} takes one value"),
                Arity::Two => write!(f, "{op} takes two values"),
                Arity::List => write!(f, "{op} takes a list of values"),
            },
            Self::Value { value, kind } => write!(f, "{value} isn't {}", kind.name()),
            Self::Nul => f.write_str("a value can't hold a NUL character"),
        }
    }
}

impl Filter {
    /// The filter as SQL over `column`, or why it can't apply: its column
    /// is named by [`quote_identifier`], each value written by [`literal`].
    /// `contains` and `starts` ignore case (both sides through DuckDB's
    /// `lower`); `=` and `in` don't. `!=` keeps the column's NULLs, as
    /// leaving a value out of the rows would (`IS DISTINCT FROM`).
    pub fn sql(&self, column: &ColumnInfo) -> Result<String, FilterRefused> {
        let kind = Kind::of(column);
        if !self.op.takes(kind) {
            return Err(FilterRefused::Op { op: self.op, kind });
        }
        let values: Vec<&Value> = match (self.op.arity(), &self.value) {
            (Arity::None, Values::None) => Vec::new(),
            (Arity::One, Values::One(value)) => vec![value],
            (Arity::Two, Values::Many(values)) if values.len() == 2 => values.iter().collect(),
            (Arity::List, Values::Many(values)) if !values.is_empty() => values.iter().collect(),
            // A list of one is one value.
            (Arity::List, Values::One(value)) => vec![value],
            _ => return Err(FilterRefused::Values { op: self.op }),
        };
        let literals = values
            .into_iter()
            .map(|value| literal(column, value))
            .collect::<Result<Vec<_>, _>>()?;
        let name = quote_identifier(&column.name);
        // A text kind DuckDB doesn't store as VARCHAR (a UUID, a list) is
        // compared as the text the table shows.
        let operand = if kind == Kind::Text && column.data_type != "VARCHAR" {
            format!("CAST({name} AS VARCHAR)")
        } else {
            name.clone()
        };
        let one = || literals[0].as_str();
        Ok(match self.op {
            Op::Eq => format!("{operand} = {}", one()),
            Op::Ne => format!("{operand} IS DISTINCT FROM {}", one()),
            Op::Gt => format!("{operand} > {}", one()),
            Op::Ge => format!("{operand} >= {}", one()),
            Op::Lt => format!("{operand} < {}", one()),
            Op::Le => format!("{operand} <= {}", one()),
            Op::Contains => format!("contains(lower({operand}), lower({}))", one()),
            Op::Starts => format!("starts_with(lower({operand}), lower({}))", one()),
            Op::In => format!("{operand} IN ({})", literals.join(", ")),
            Op::Between => format!("{operand} BETWEEN {} AND {}", literals[0], literals[1]),
            Op::IsNull => format!("{name} IS NULL"),
            Op::NotNull => format!("{name} IS NOT NULL"),
        })
    }
}

/// `value` as a SQL literal of `column`'s type, or why it isn't one. The
/// one place a filter's value is written into SQL: a number is written
/// from the number JSON read (never its text), a date or a timestamp only
/// once it reads as ISO, a boolean as `true` or `false`, and text as a
/// string literal, its quotes doubled (no `LIKE`, so `%` and `_` are
/// themselves).
pub fn literal(column: &ColumnInfo, value: &Value) -> Result<String, FilterRefused> {
    let kind = Kind::of(column);
    let wrong = || FilterRefused::Value {
        value: value.to_string(),
        kind,
    };
    match (kind, value) {
        (Kind::Number, Value::Number(number)) => {
            if let Some(int) = number.as_i64() {
                Ok(int.to_string())
            } else if let Some(int) = number.as_u64() {
                Ok(int.to_string())
            } else {
                let float = number.as_f64().filter(|float| float.is_finite());
                float
                    .map(|float| format!("{float:?}::DOUBLE"))
                    .ok_or_else(wrong)
            }
        }
        (Kind::Time, Value::Text(text)) => {
            let timestamp = column.data_type.starts_with("TIMESTAMP");
            let iso = iso_time(text, timestamp).ok_or_else(wrong)?;
            let sql_type = match column.data_type.as_str() {
                "DATE" => "DATE",
                "TIMESTAMP WITH TIME ZONE" => "TIMESTAMPTZ",
                _ => "TIMESTAMP",
            };
            Ok(format!("{sql_type} {}", string_literal(&iso)))
        }
        (Kind::Boolean, Value::Bool(on)) => Ok(on.to_string()),
        (Kind::Text, Value::Text(text)) => {
            if text.contains('\0') {
                return Err(FilterRefused::Nul);
            }
            Ok(string_literal(text))
        }
        _ => Err(wrong()),
    }
}

/// `text`, a value as typed, read as `column`'s type: a number from its
/// digits (`4.5`, `-3`, `1e3`, `.5`), `true` or `false` without regard to
/// case, and any other text as text, which [`literal`] then checks (a time
/// once it reads as ISO, a number that wasn't one refused).
pub fn typed_value(column: &ColumnInfo, text: &str) -> Value {
    match Kind::of(column) {
        Kind::Number => number(text).map_or_else(|| Value::Text(text.to_owned()), Value::Number),
        Kind::Boolean if text.eq_ignore_ascii_case("true") => Value::Bool(true),
        Kind::Boolean if text.eq_ignore_ascii_case("false") => Value::Bool(false),
        _ => Value::Text(text.to_owned()),
    }
}

/// `text` as a number, as JSON reads one, or as a finite float Rust reads
/// (`.5`, `+5`); none for anything else (`1,000`, `inf`).
fn number(text: &str) -> Option<serde_json::Number> {
    let text = text.trim();
    if let Ok(number) = serde_json::from_str::<serde_json::Number>(text) {
        return Some(number);
    }
    // `nan` and `inf` parse, and `from_f64` takes neither.
    serde_json::Number::from_f64(text.parse().ok()?)
}

/// The direction a sort of `column` takes when none is written: the
/// table's own first, a text column A to Z and every other kind the
/// largest, latest, or true first (the tall table's `SortDirection::first`).
pub fn first_direction(column: &ColumnInfo) -> Direction {
    match column.tall_table_column().kind() {
        ColumnKind::Text => Direction::Asc,
        _ => Direction::Desc,
    }
}

/// `text` as an ISO date (`2024-03-01`), or with `timestamp` also a date and
/// a time (`2024-03-01T12:30`, seconds and their fraction optional, a
/// space for the `T`): its normal form, or none.
pub(crate) fn iso_time(text: &str, timestamp: bool) -> Option<String> {
    let text = text.trim();
    let (date, time) = match text.split_once(['T', ' ']) {
        Some((date, time)) if timestamp => (date, Some(time)),
        Some(_) => return None,
        None => (text, None),
    };
    let mut parts = date.splitn(3, '-');
    let (year, month, day) = (parts.next()?, parts.next()?, parts.next()?);
    let digits =
        |part: &str, len: usize| part.len() == len && part.bytes().all(|b| b.is_ascii_digit());
    if !(digits(year, 4) && digits(month, 2) && digits(day, 2)) {
        return None;
    }
    let (year_n, month_n, day_n) = (
        year.parse::<u32>().ok()?,
        month.parse::<u32>().ok()?,
        day.parse::<u32>().ok()?,
    );
    let leap = year_n % 4 == 0 && (year_n % 100 != 0 || year_n % 400 == 0);
    let days = match month_n {
        2 if leap => 29,
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        1..=12 => 31,
        _ => return None,
    };
    if !(1..=days).contains(&day_n) {
        return None;
    }
    let Some(time) = time else {
        return Some(date.to_owned());
    };
    let (clock, fraction) = match time.split_once('.') {
        Some((clock, fraction)) => (clock, Some(fraction)),
        None => (time, None),
    };
    let fields: Vec<&str> = clock.split(':').collect();
    let limits = [23, 59, 59];
    if !(2..=3).contains(&fields.len())
        || fields.iter().zip(limits).any(|(field, most)| {
            !digits(field, 2) || field.parse::<u32>().map_or(true, |v| v > most)
        })
    {
        return None;
    }
    if let Some(fraction) = fraction
        && (fields.len() < 3
            || fraction.is_empty()
            || fraction.len() > 9
            || !fraction.bytes().all(|b| b.is_ascii_digit()))
    {
        return None;
    }
    Some(format!("{date} {time}"))
}

/// The filters as one `WHERE` condition, combined with `AND`, each over
/// its column in `columns` (by name, the first of that name), or the
/// first that can't apply. None with no filters.
pub fn where_sql(
    filters: &[Filter],
    columns: &[ColumnInfo],
) -> Result<Option<String>, (usize, String)> {
    let mut parts = Vec::with_capacity(filters.len());
    for (index, filter) in filters.iter().enumerate() {
        let column = columns
            .iter()
            .find(|column| column.name == filter.column)
            .ok_or_else(|| (index, format!("there's no column {}", filter.column)))?;
        let sql = filter
            .sql(column)
            .map_err(|refused| (index, refused.to_string()))?;
        parts.push(format!("({sql})"));
    }
    Ok((!parts.is_empty()).then(|| parts.join(" AND ")))
}

/// Which way a sort runs, as the view state writes it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Direction {
    Asc,
    Desc,
}

impl Direction {
    /// As a command writes it.
    pub fn as_str(self) -> &'static str {
        match self {
            Direction::Asc => "asc",
            Direction::Desc => "desc",
        }
    }

    pub fn table(self) -> seiza_tall_table::SortDirection {
        match self {
            Direction::Asc => seiza_tall_table::SortDirection::Ascending,
            Direction::Desc => seiza_tall_table::SortDirection::Descending,
        }
    }

    pub fn of(direction: seiza_tall_table::SortDirection) -> Self {
        match direction {
            seiza_tall_table::SortDirection::Ascending => Direction::Asc,
            seiza_tall_table::SortDirection::Descending => Direction::Desc,
        }
    }
}

/// The view's sort: one column and its direction.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SortView {
    pub column: String,
    pub direction: Direction,
}

#[cfg(test)]
mod tests {
    use seiza_duckdb::sql::ColumnInfo;

    use super::{Direction, Filter, FilterRefused, Kind, Op, Value, Values, literal, where_sql};

    fn number(value: serde_json::Value) -> Value {
        serde_json::from_value(value).unwrap()
    }

    fn filter(column: &str, op: Op, value: Values) -> Filter {
        Filter {
            column: column.into(),
            op,
            value,
        }
    }

    fn one(value: Value) -> Values {
        Values::One(value)
    }

    fn text(value: &str) -> Value {
        Value::Text(value.into())
    }

    fn columns() -> Vec<ColumnInfo> {
        vec![
            ColumnInfo::new("satcat_no", "INTEGER"),
            ColumnInfo::new("name", "VARCHAR"),
            ColumnInfo::new("inclination_deg", "DOUBLE"),
            ColumnInfo::new("launch_date", "DATE"),
            ColumnInfo::new("launch_time", "TIMESTAMP"),
            ColumnInfo::new("crewed", "BOOLEAN"),
            ColumnInfo::new("mass", "DECIMAL(18,3)"),
            ColumnInfo::new("id", "UUID"),
            ColumnInfo::new("odd \"name\"", "BIGINT"),
        ]
    }

    fn sql(filter: &Filter) -> Result<String, FilterRefused> {
        let columns = columns();
        let column = columns.iter().find(|c| c.name == filter.column).unwrap();
        filter.sql(column)
    }

    #[test]
    fn json_reads_and_writes_the_grammars_form() {
        let json = r#"{"column":"inclination_deg","op":">=","value":90}"#;
        let read: Filter = serde_json::from_str(json).unwrap();
        assert_eq!(
            read,
            filter(
                "inclination_deg",
                Op::Ge,
                one(number(serde_json::json!(90)))
            )
        );
        assert_eq!(serde_json::to_string(&read).unwrap(), json);
        let null: Filter = serde_json::from_str(r#"{"column":"name","op":"is null"}"#).unwrap();
        assert_eq!(null.value, Values::None);
        assert_eq!(
            serde_json::to_string(&null).unwrap(),
            r#"{"column":"name","op":"is null"}"#
        );
        let between: Filter = serde_json::from_str(
            r#"{"column":"launch_date","op":"between","value":["1990-01-01","1999-12-31"]}"#,
        )
        .unwrap();
        assert_eq!(
            between.value,
            Values::Many(vec![text("1990-01-01"), text("1999-12-31")])
        );
        assert!(serde_json::from_str::<Filter>(r#"{"column":"a","op":"like","value":1}"#).is_err());
        assert!(
            serde_json::from_str::<Filter>(r#"{"column":"a","op":"=","value":1,"x":2}"#).is_err()
        );
        assert_eq!(
            serde_json::to_string(&super::SortView {
                column: "launch_date".into(),
                direction: Direction::Desc
            })
            .unwrap(),
            r#"{"column":"launch_date","direction":"desc"}"#
        );
    }

    #[test]
    fn every_operator_for_each_type() {
        let n = |v: serde_json::Value| one(number(v));
        let cases: Vec<(Filter, &str)> = vec![
            // Numbers: an integer column, a float one, a decimal.
            (
                filter("satcat_no", Op::Eq, n(serde_json::json!(25544))),
                r#""satcat_no" = 25544"#,
            ),
            (
                filter("satcat_no", Op::Ne, n(serde_json::json!(-3))),
                r#""satcat_no" IS DISTINCT FROM -3"#,
            ),
            (
                filter("satcat_no", Op::Gt, n(serde_json::json!(1.5))),
                r#""satcat_no" > 1.5::DOUBLE"#,
            ),
            (
                filter("inclination_deg", Op::Ge, n(serde_json::json!(90))),
                r#""inclination_deg" >= 90"#,
            ),
            (
                filter("inclination_deg", Op::Lt, n(serde_json::json!(1e300))),
                r#""inclination_deg" < 1e300::DOUBLE"#,
            ),
            (
                filter("inclination_deg", Op::Le, n(serde_json::json!(0.1))),
                r#""inclination_deg" <= 0.1::DOUBLE"#,
            ),
            (
                filter(
                    "mass",
                    Op::Between,
                    Values::Many(vec![
                        number(serde_json::json!(1)),
                        number(serde_json::json!(2.5)),
                    ]),
                ),
                r#""mass" BETWEEN 1 AND 2.5::DOUBLE"#,
            ),
            (
                filter(
                    "satcat_no",
                    Op::In,
                    Values::Many(vec![
                        number(serde_json::json!(1)),
                        number(serde_json::json!(2)),
                    ]),
                ),
                r#""satcat_no" IN (1, 2)"#,
            ),
            (
                filter("satcat_no", Op::IsNull, Values::None),
                r#""satcat_no" IS NULL"#,
            ),
            (
                filter("satcat_no", Op::NotNull, Values::None),
                r#""satcat_no" IS NOT NULL"#,
            ),
            // Text.
            (
                filter("name", Op::Eq, one(text("ISS (ZARYA)"))),
                r#""name" = 'ISS (ZARYA)'"#,
            ),
            (
                filter("name", Op::Ne, one(text("x"))),
                r#""name" IS DISTINCT FROM 'x'"#,
            ),
            (
                filter("name", Op::Contains, one(text("StarLink"))),
                r#"contains(lower("name"), lower('StarLink'))"#,
            ),
            (
                filter("name", Op::Starts, one(text("Cosmos"))),
                r#"starts_with(lower("name"), lower('Cosmos'))"#,
            ),
            (
                filter("name", Op::In, Values::Many(vec![text("a"), text("b")])),
                r#""name" IN ('a', 'b')"#,
            ),
            (filter("name", Op::In, one(text("a"))), r#""name" IN ('a')"#),
            (
                filter("name", Op::IsNull, Values::None),
                r#""name" IS NULL"#,
            ),
            // A text kind DuckDB stores otherwise is compared as its text.
            (
                filter("id", Op::Contains, one(text("ab"))),
                r#"contains(lower(CAST("id" AS VARCHAR)), lower('ab'))"#,
            ),
            (filter("id", Op::IsNull, Values::None), r#""id" IS NULL"#),
            // Times.
            (
                filter("launch_date", Op::Gt, one(text("1999-12-31"))),
                r#""launch_date" > DATE '1999-12-31'"#,
            ),
            (
                filter(
                    "launch_date",
                    Op::Between,
                    Values::Many(vec![text("1990-01-01"), text("1999-12-31")]),
                ),
                r#""launch_date" BETWEEN DATE '1990-01-01' AND DATE '1999-12-31'"#,
            ),
            (
                filter(
                    "launch_date",
                    Op::In,
                    Values::Many(vec![text("1957-10-04")]),
                ),
                r#""launch_date" IN (DATE '1957-10-04')"#,
            ),
            (
                filter("launch_time", Op::Ge, one(text("1969-07-16T13:32"))),
                r#""launch_time" >= TIMESTAMP '1969-07-16 13:32'"#,
            ),
            (
                filter("launch_time", Op::Lt, one(text("1969-07-16 13:32:00.5"))),
                r#""launch_time" < TIMESTAMP '1969-07-16 13:32:00.5'"#,
            ),
            (
                filter("launch_time", Op::Eq, one(text("1969-07-16"))),
                r#""launch_time" = TIMESTAMP '1969-07-16'"#,
            ),
            // Booleans.
            (
                filter("crewed", Op::Eq, one(Value::Bool(true))),
                r#""crewed" = true"#,
            ),
            (
                filter("crewed", Op::Ne, one(Value::Bool(false))),
                r#""crewed" IS DISTINCT FROM false"#,
            ),
            (
                filter("crewed", Op::NotNull, Values::None),
                r#""crewed" IS NOT NULL"#,
            ),
            // A column name with quotes.
            (
                filter("odd \"name\"", Op::Eq, n(serde_json::json!(1))),
                r#""odd ""name""" = 1"#,
            ),
        ];
        for (filter, expected) in cases {
            assert_eq!(sql(&filter).as_deref(), Ok(expected), "{filter:?}");
        }
    }

    #[test]
    fn values_are_quoted_never_joined() {
        // Quotes, backslashes, LIKE's wildcards, and a NUL.
        let cases = [
            ("it's", r#"contains(lower("name"), lower('it''s'))"#),
            (
                "'; DROP TABLE x; --",
                r#"contains(lower("name"), lower('''; DROP TABLE x; --'))"#,
            ),
            (
                r"back\slash",
                r#"contains(lower("name"), lower('back\slash'))"#,
            ),
            (
                "100%_done",
                r#"contains(lower("name"), lower('100%_done'))"#,
            ),
        ];
        for (value, expected) in cases {
            let filter = filter("name", Op::Contains, one(text(value)));
            assert_eq!(sql(&filter).as_deref(), Ok(expected), "{value:?}");
        }
        assert_eq!(
            sql(&filter("name", Op::Eq, one(text("a\0b")))),
            Err(FilterRefused::Nul)
        );
        // A date that's SQL is no date.
        assert!(matches!(
            sql(&filter(
                "launch_date",
                Op::Eq,
                one(text("2020-01-01' OR '1'='1"))
            )),
            Err(FilterRefused::Value { .. })
        ));
        assert!(matches!(
            sql(&filter(
                "launch_time",
                Op::Eq,
                one(text("2020-01-01T10:00:00'--"))
            )),
            Err(FilterRefused::Value { .. })
        ));
    }

    #[test]
    fn a_value_is_read_as_its_columns_type() {
        let refused = |f: Filter| sql(&f).unwrap_err();
        let wrong = |value: &str, kind| FilterRefused::Value {
            value: value.into(),
            kind,
        };
        assert_eq!(
            refused(filter("satcat_no", Op::Eq, one(text("25544")))),
            wrong("25544", Kind::Number)
        );
        assert_eq!(
            refused(filter("name", Op::Eq, one(number(serde_json::json!(5))))),
            wrong("5", Kind::Text)
        );
        assert_eq!(
            refused(filter("crewed", Op::Eq, one(text("yes")))),
            wrong("yes", Kind::Boolean)
        );
        for bad in [
            "2020-13-01",
            "2020-1-01",
            "20-01-01",
            "2020-01-01T10:00",
            "yesterday",
            "2024-02-31",
            "2023-02-29",
            "2024-04-31",
        ] {
            assert_eq!(
                refused(filter("launch_date", Op::Eq, one(text(bad)))),
                wrong(bad, Kind::Time),
                "{bad}"
            );
        }
        for bad in [
            "2020-01-01T25:00",
            "2020-01-01T10",
            "2020-01-01T10:00:00.",
            "2020-01-01T10:60",
            "2020-01-01T12:30.5",
        ] {
            assert!(
                matches!(
                    refused(filter("launch_time", Op::Eq, one(text(bad)))),
                    FilterRefused::Value { .. }
                ),
                "{bad}"
            );
        }
        // An operator its type doesn't take, and the wrong count of values.
        assert_eq!(
            refused(filter("crewed", Op::Gt, one(Value::Bool(true)))),
            FilterRefused::Op {
                op: Op::Gt,
                kind: Kind::Boolean
            }
        );
        assert_eq!(
            refused(filter("satcat_no", Op::Contains, one(text("1")))),
            FilterRefused::Op {
                op: Op::Contains,
                kind: Kind::Number
            }
        );
        assert_eq!(
            refused(filter("name", Op::Gt, one(text("a")))),
            FilterRefused::Op {
                op: Op::Gt,
                kind: Kind::Text
            }
        );
        assert_eq!(
            refused(filter(
                "satcat_no",
                Op::Between,
                one(number(serde_json::json!(1)))
            )),
            FilterRefused::Values { op: Op::Between }
        );
        assert_eq!(
            refused(filter(
                "satcat_no",
                Op::IsNull,
                one(number(serde_json::json!(1)))
            )),
            FilterRefused::Values { op: Op::IsNull }
        );
        assert_eq!(
            refused(filter("satcat_no", Op::In, Values::Many(Vec::new()))),
            FilterRefused::Values { op: Op::In }
        );
        assert_eq!(
            refused(filter("crewed", Op::Gt, one(Value::Bool(true)))).to_string(),
            "> doesn't apply to true or false"
        );
        // Every operator's spelling reads back.
        for op in Op::ALL {
            let json = serde_json::to_string(&op).unwrap();
            assert_eq!(json, format!("\"{op}\""));
            assert_eq!(serde_json::from_str::<Op>(&json).unwrap(), op);
        }
        let _ = literal;
    }

    #[test]
    fn typed_values_read_as_their_columns_type() {
        let columns = columns();
        let column = |name: &str| columns.iter().find(|c| c.name == name).unwrap();
        let typed = |name: &str, text: &str| super::typed_value(column(name), text);
        assert_eq!(
            typed("satcat_no", "25544"),
            number(serde_json::json!(25544))
        );
        assert_eq!(
            typed("inclination_deg", "-0.5"),
            number(serde_json::json!(-0.5))
        );
        assert_eq!(
            typed("inclination_deg", ".5"),
            number(serde_json::json!(0.5))
        );
        assert_eq!(
            typed("inclination_deg", "1e3"),
            number(serde_json::json!(1000.0))
        );
        // Not numbers: text, which `literal` refuses for a number column.
        for text in ["1,000", "inf", "NaN", "90deg", ""] {
            assert_eq!(
                typed("inclination_deg", text),
                Value::Text(text.into()),
                "{text}"
            );
        }
        assert_eq!(typed("crewed", "TRUE"), Value::Bool(true));
        assert_eq!(typed("crewed", "false"), Value::Bool(false));
        assert_eq!(typed("crewed", "yes"), Value::Text("yes".into()));
        // Text stays text, digits too.
        assert_eq!(typed("name", "42"), Value::Text("42".into()));
        assert_eq!(
            typed("launch_date", "1990-01-01"),
            Value::Text("1990-01-01".into())
        );
        assert_eq!(Op::read(">="), Some(Op::Ge));
        assert_eq!(Op::read("=="), Some(Op::Eq));
        assert_eq!(Op::read("<>"), Some(Op::Ne));
        assert_eq!(Op::read("Contains"), Some(Op::Contains));
        assert_eq!(Op::read("IS NOT NULL"), Some(Op::NotNull));
        assert_eq!(Op::read("=>"), None);
        assert_eq!(Op::read("is"), None);
        assert_eq!(
            Kind::Boolean.ops().collect::<Vec<_>>(),
            [Op::Eq, Op::Ne, Op::IsNull, Op::NotNull]
        );
        assert_eq!(super::first_direction(column("name")), Direction::Asc);
        assert_eq!(
            super::first_direction(column("launch_date")),
            Direction::Desc
        );
        assert_eq!(super::first_direction(column("crewed")), Direction::Desc);
    }

    #[test]
    fn filters_combine_with_and() {
        let filters = [
            filter(
                "inclination_deg",
                Op::Ge,
                one(number(serde_json::json!(90))),
            ),
            filter("name", Op::Contains, one(text("starlink"))),
        ];
        assert_eq!(
            where_sql(&filters, &columns()),
            Ok(Some(
                r#"("inclination_deg" >= 90) AND (contains(lower("name"), lower('starlink')))"#
                    .into()
            ))
        );
        assert_eq!(where_sql(&[], &columns()), Ok(None));
        let gone = [filter("gone", Op::IsNull, Values::None)];
        assert_eq!(where_sql(&gone, &columns()).unwrap_err().0, 0);
    }
}
