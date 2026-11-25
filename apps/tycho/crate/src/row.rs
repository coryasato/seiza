//! One row's values, as the page's Row tab shows them (`docs/DECISIONS.md`,
//! "Scope", 2026-11-20, "The row detail view always shows the active
//! cell's row"): every column, hidden ones included, in the view's order,
//! each value's exact text (a number and a timestamp as the source writes
//! them, never a format's), NULL as none, and text whole up to
//! [`MOST_CHARS`].
//!
//! The values come from the page the table holds when it's loaded
//! (`crate::table::Rows::loaded`), else from a query of that one row
//! (Tycho's rule 3: never the whole result); either way a page is read
//! through [`TallTablePage`], so both are the same here.

use seiza_tall_table::{CellValue, TallTablePage};
use serde::Serialize;

use crate::view::Controller;

/// The most characters of one value the page is given: the popover's cap.
/// The Row tab shows eight lines of it, with the whole length beside.
pub const MOST_CHARS: usize = 10_000;

/// The most characters of a value a press carries, for its menu's head,
/// which shows a line of it.
pub const PRESS_CHARS: usize = 200;

/// A row, as the page reads it (`web/src/frame/state.ts`, `RowValues`).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct RowValues {
    /// 0-based.
    pub row: u64,
    /// In the view's order.
    pub fields: Vec<Field>,
}

/// One column's value.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Field {
    /// The column's index in the file.
    pub index: usize,
    pub name: String,
    /// `number`, `text`, `time`, or `boolean`: its badge.
    #[serde(rename = "type")]
    pub kind: &'static str,
    /// DuckDB's type name.
    pub data_type: String,
    pub hidden: bool,
    /// Its exact text, cut at [`MOST_CHARS`]; none for NULL.
    pub value: Option<String>,
    /// The whole value's length in characters (0 for NULL).
    pub length: usize,
}

/// A value's exact text, cut at `most` characters, and its whole length:
/// none for NULL (or a cell the page doesn't have).
pub fn text(value: Option<CellValue<'_>>, most: usize) -> (Option<String>, usize) {
    match value {
        None | Some(CellValue::Null) => (None, 0),
        Some(value) => {
            let text = value.to_string();
            let length = text.chars().count();
            let cut = match text.char_indices().nth(most) {
                Some((at, _)) => text[..at].to_owned(),
                None => text,
            };
            (Some(cut), length)
        }
    }
}

/// Row `row`'s values, from its place `at` in `page`, for `view`'s columns,
/// each cut at `most` characters ([`MOST_CHARS`] for the Row tab, none for a
/// copy).
pub fn read(
    view: &Controller,
    page: &impl TallTablePage,
    at: usize,
    row: u64,
    most: usize,
) -> RowValues {
    RowValues {
        row,
        fields: view
            .order()
            .iter()
            .map(|&index| {
                let info = &view.columns()[index];
                let (value, length) = text(page.value(at, index), most);
                Field {
                    index,
                    name: info.name.clone(),
                    kind: crate::table::type_name(info),
                    data_type: info.data_type.clone(),
                    hidden: view.is_hidden(index),
                    value,
                    length,
                }
            })
            .collect(),
    }
}

/// What the Row tab's copy buttons write: column `column`'s value as it
/// is (NULL as nothing), or with none the row as two lines of
/// tab-separated fields, the columns' names then their values, every
/// column in the view's order, hidden ones included, as the tab shows
/// them. A field is quoted as the table's copy quotes it (a tab, a line
/// break, or a `"` in it: quoted, its quotes doubled), so a spreadsheet
/// reads the two lines as a header and a row. None for a column the row
/// doesn't have.
pub fn copy_text(values: &RowValues, column: Option<usize>) -> Option<String> {
    if let Some(column) = column {
        let field = values.fields.iter().find(|field| field.index == column)?;
        return Some(field.value.clone().unwrap_or_default());
    }
    let line = |fields: &mut dyn Iterator<Item = &str>| {
        let mut line = String::new();
        for (i, field) in fields.enumerate() {
            if i > 0 {
                line.push('\t');
            }
            if field.contains(['\t', '\n', '\r', '"']) {
                line.push('"');
                line.push_str(&field.replace('"', "\"\""));
                line.push('"');
            } else {
                line.push_str(field);
            }
        }
        line
    };
    let names = line(&mut values.fields.iter().map(|field| field.name.as_str()));
    let row = line(
        &mut values
            .fields
            .iter()
            .map(|field| field.value.as_deref().unwrap_or("")),
    );
    Some(format!("{names}\n{row}"))
}

#[cfg(test)]
mod tests {
    use std::borrow::Cow;
    use std::sync::Arc;

    use arrow::array::{ArrayRef, Float64Array, Int64Array, RecordBatch, StringArray};
    use arrow::ipc::writer::StreamWriter;
    use seiza_duckdb::sql::ColumnInfo;
    use seiza_tall_table::{CellValue, TallTablePage};

    use super::{MOST_CHARS, copy_text, read, text};
    use crate::view::{Controller, SourceKind, SourceView};

    fn view() -> Controller {
        let file = [
            ColumnInfo::new("id", "BIGINT"),
            ColumnInfo::new("name", "VARCHAR"),
            ColumnInfo::new("mass", "DOUBLE"),
        ];
        Controller::of_file(
            SourceView {
                kind: SourceKind::Parquet,
                name: "launches.parquet".into(),
                rows: 3,
            },
            &file,
        )
    }

    /// A loaded page as the table holds one: rows 1024 to 1026.
    struct Loaded;

    impl TallTablePage for Loaded {
        fn value(&self, row: usize, column: usize) -> Option<CellValue<'_>> {
            match (row, column) {
                (_, 0) => Some(CellValue::Text(Cow::Owned((1024 + row).to_string()))),
                (1, 1) => Some(CellValue::Null),
                (_, 1) => Some(CellValue::Text(Cow::Borrowed("Sputnik 1"))),
                _ => Some(CellValue::Float(83.6)),
            }
        }

        fn heap_bytes(&self) -> usize {
            0
        }
    }

    #[test]
    fn a_rows_values_from_a_loaded_page() {
        let mut view = view();
        view.pin(2).unwrap();
        view.hide(1).unwrap();
        let row = read(&view, &Loaded, 1, 1025, MOST_CHARS);
        assert_eq!(row.row, 1025);
        // The view's order, the hidden column kept and marked.
        let names: Vec<_> = row.fields.iter().map(|field| field.name.as_str()).collect();
        assert_eq!(names, ["mass", "id", "name"]);
        assert_eq!(row.fields[0].value.as_deref(), Some("83.6"));
        assert_eq!(row.fields[0].kind, "number");
        assert_eq!(row.fields[1].value.as_deref(), Some("1025"));
        assert!(row.fields[2].hidden);
        assert_eq!(
            (row.fields[2].value.as_deref(), row.fields[2].length),
            (None, 0)
        );
        let json = serde_json::to_string(&row.fields[0]).unwrap();
        assert_eq!(
            json,
            r#"{"index":2,"name":"mass","type":"number","dataType":"DOUBLE","hidden":false,"value":"83.6","length":4}"#
        );
    }

    /// The bytes DuckDB answers one row's query with.
    fn one_row(name: &str) -> Vec<u8> {
        let columns: Vec<ArrayRef> = vec![
            Arc::new(Int64Array::from(vec![7])),
            Arc::new(StringArray::from(vec![name])),
            Arc::new(Float64Array::from(vec![0.1 + 0.2])),
        ];
        let batch =
            RecordBatch::try_from_iter(["id", "name", "mass"].into_iter().zip(columns)).unwrap();
        let mut bytes = Vec::new();
        let mut writer = StreamWriter::try_new(&mut bytes, &batch.schema()).unwrap();
        writer.write(&batch).unwrap();
        writer.finish().unwrap();
        drop(writer);
        bytes
    }

    #[test]
    fn a_rows_values_read_as_one_row() {
        // An unloaded row is read alone, its answer a page of one row.
        let long = "x".repeat(MOST_CHARS + 5);
        let page = seiza_duckdb::arrow::decode(one_row(&long)).unwrap();
        assert_eq!(page.num_rows(), 1);
        let row = read(&view(), &page, 0, 70_000, MOST_CHARS);
        assert_eq!(row.fields[0].value.as_deref(), Some("7"));
        // Text whole up to the cap, its length whole.
        assert_eq!(
            row.fields[1].value.as_ref().map(String::len),
            Some(MOST_CHARS)
        );
        assert_eq!(row.fields[1].length, MOST_CHARS + 5);
        // A float's exact text, not a rounding.
        assert_eq!(row.fields[2].value.as_deref(), Some("0.30000000000000004"));
    }

    #[test]
    fn a_values_text_is_cut_by_characters() {
        let value = Some(CellValue::Text(Cow::Borrowed("日付日付")));
        assert_eq!(text(value.clone(), 2), (Some("日付".into()), 4));
        assert_eq!(text(value, 10), (Some("日付日付".into()), 4));
        assert_eq!(text(Some(CellValue::Null), 10), (None, 0));
        assert_eq!(text(None, 10), (None, 0));
    }

    #[test]
    fn a_copy_is_whole_and_quoted_as_the_tables() {
        let long = "x".repeat(MOST_CHARS + 5);
        let page = seiza_duckdb::arrow::decode(one_row(&long)).unwrap();
        let whole = read(&view(), &page, 0, 70_000, usize::MAX);
        assert_eq!(copy_text(&whole, Some(1)), Some(long));
        let page = seiza_duckdb::arrow::decode(one_row("say \"hi\"\tthere")).unwrap();
        let row = read(&view(), &page, 0, 0, usize::MAX);
        assert_eq!(
            copy_text(&row, None).as_deref(),
            Some("id\tname\tmass\n7\t\"say \"\"hi\"\"\tthere\"\t0.30000000000000004")
        );
        // NULL is nothing; a column the row lacks is no copy.
        let mut view = view();
        view.hide(1).unwrap();
        let row = read(&view, &Loaded, 1, 1025, usize::MAX);
        assert_eq!(copy_text(&row, Some(1)).as_deref(), Some(""));
        assert_eq!(
            copy_text(&row, None).as_deref(),
            Some("id\tname\tmass\n1025\t\t83.6")
        );
        assert_eq!(copy_text(&row, Some(9)), None);
    }
}
