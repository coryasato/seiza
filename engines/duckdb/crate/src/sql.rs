//! Small helpers for writing SQL and reading DuckDB's answers: string
//! literals, a column as DuckDB describes it, and typed reads of metadata
//! results.

use crate::arrow::{QueryResult, Value};

/// A column as DuckDB describes it (`DESCRIBE`, `sniff_csv`).
#[derive(Debug, Clone, PartialEq)]
#[non_exhaustive]
pub struct ColumnInfo {
    pub name: String,
    /// DuckDB's type name, e.g. `BIGINT`, `VARCHAR`, `DECIMAL(18,3)`.
    pub data_type: String,
}

impl ColumnInfo {
    pub fn new(name: impl Into<String>, data_type: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            data_type: data_type.into(),
        }
    }
}

/// `text` as a SQL string literal.
pub fn string_literal(text: &str) -> String {
    format!("'{}'", text.replace('\'', "''"))
}

/// `name` as a SQL identifier (`"…"`, quotes doubled).
pub fn quote_identifier(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

/// The index of `result`'s column named `name`.
pub fn column(result: &QueryResult, name: &str) -> Result<usize, String> {
    result
        .fields
        .iter()
        .position(|field| field.name == name)
        .ok_or_else(|| format!("metadata query has no `{name}` column"))
}

/// A text value of `result`.
pub fn text(result: &QueryResult, row: usize, column: usize) -> Result<String, String> {
    match result.value(row, column) {
        Some(Value::Str(text)) => Ok(text.to_owned()),
        other => Err(format!("expected text, got {other:?}")),
    }
}

/// A count in `result`'s first row: a non-negative integer, signed or not.
pub fn count(result: &QueryResult, column: usize) -> Result<u64, String> {
    match result.value(0, column) {
        Some(Value::Int(value)) if value >= 0 => Ok(value as u64),
        Some(Value::UInt(value)) => Ok(value),
        other => Err(format!("expected a count, got {other:?}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn literals_double_quotes() {
        assert_eq!(string_literal("it's"), "'it''s'");
        assert_eq!(quote_identifier("a\"b"), "\"a\"\"b\"");
    }
}
