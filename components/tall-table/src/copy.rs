//! `copy`: a selection's text, a spreadsheet's TSV of exact values, and the
//! types a host reads a copy's progress through. The state's `copy` module
//! reads the rows and sends the text in pieces (`docs/DECISIONS.md`,
//! "Features").

use std::fmt::Write as _;
use std::ops::RangeInclusive;

use crate::delegate::CellValue;

/// Names a copy in its events.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct CopyId(pub(crate) u64);

impl CopyId {
    /// The id as a number, growing with each copy: for a host that keeps
    /// it outside Rust.
    pub fn get(self) -> u64 {
        self.0
    }
}

/// How a copy is made: the host's settings.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub struct CopyOptions {
    /// Refused past this many bytes of text: 64 MiB by default, under
    /// WebKit's ~100 MiB limit on a clipboard write. The most ever
    /// attempted, not a size a key copies.
    pub max_bytes: usize,
    /// The most cells (rows × columns) Cmd+C copies: 100 k by default.
    /// Past it the key copies nothing and emits `Declined`; a host that
    /// asks the reader calls `copy`, which this doesn't limit.
    pub key_max_cells: u64,
    /// The column names as a first line: off by default.
    pub headers: bool,
}

impl Default for CopyOptions {
    fn default() -> Self {
        Self {
            max_bytes: 64 << 20,
            key_max_cells: 100_000,
            headers: false,
        }
    }
}

impl CopyOptions {
    pub fn max_bytes(self, bytes: usize) -> Self {
        Self {
            max_bytes: bytes,
            ..self
        }
    }

    pub fn key_max_cells(self, cells: u64) -> Self {
        Self {
            key_max_cells: cells,
            ..self
        }
    }

    pub fn headers(self, on: bool) -> Self {
        Self {
            headers: on,
            ..self
        }
    }
}

/// A copy's progress, in order: `Started`, any number of `Text`, then
/// `Copied` or `Failed`.
#[derive(Debug, Clone, PartialEq)]
#[non_exhaustive]
pub enum TallTableCopy {
    /// Cmd+C on a selection past `key_max_cells`: nothing copied, nothing
    /// read. A host may ask the reader, and call `copy` if they confirm
    /// (the confirming click is a gesture of its own).
    Declined { rows: u64, columns: usize },
    /// In the task that asked for it (the key, or `copy`): a host writing
    /// to the web's clipboard opens its write here.
    Started {
        id: CopyId,
        rows: RangeInclusive<u64>,
        columns: RangeInclusive<usize>,
    },
    /// The text's next piece, to append; `rows_done` rows are in so far.
    Text {
        id: CopyId,
        text: String,
        rows_done: u64,
    },
    /// Every piece sent.
    Copied { id: CopyId, rows: u64, bytes: usize },
    /// Ended without its text: a host drops the pieces it has and leaves
    /// the clipboard as it was.
    Failed { id: CopyId, reason: CopyFailure },
}

/// Why a copy ended without its text.
#[derive(Debug, Clone, PartialEq)]
#[non_exhaustive]
pub enum CopyFailure {
    /// Its text passed `max_bytes`, or its first page's worth of rows said
    /// it would
    /// (`bytes`: the text so far, or the size the first page projected).
    TooLarge { bytes: usize, max_bytes: usize },
    /// A page read for it failed (with `read_failure`, the table's
    /// `ReadFailed` too, for the host to repair the source).
    Read(String),
    /// A second copy, `set_columns`, `set_rows` shrinking under it, Escape,
    /// or `cancel_copy` (`close` ends a copy without an event).
    Cancelled,
}

/// A running copy's progress.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CopyProgress {
    pub id: CopyId,
    pub rows_done: u64,
    pub rows: u64,
}

/// The cells a turn formats at most: about 1–2 ms natively. A count, not a
/// time: wasm has no `Instant`, and a count is the same in a test as in a
/// browser.
pub(crate) const TURN_CELLS: u64 = 16_384;

/// Appends `field`, quoted if it holds a tab, a line break, or a `"` (its
/// quotes doubled), as spreadsheets write and read it.
pub(crate) fn push_field(text: &mut String, field: &str) {
    if field.contains(['\t', '\n', '\r', '"']) {
        text.push('"');
        text.push_str(&field.replace('"', "\"\""));
        text.push('"');
    } else {
        text.push_str(field);
    }
}

/// Appends a value's exact text (the tooltip's), NULL (or a cell past a
/// page's end) as an empty field.
pub(crate) fn push_value(text: &mut String, value: Option<CellValue<'_>>) {
    match value {
        None | Some(CellValue::Null) => {}
        Some(CellValue::Text(value)) => push_field(text, &value),
        // A float's shortest round-trip text never needs quoting.
        Some(value) => {
            let _ = write!(text, "{value}");
        }
    }
}

/// The header line: the column names, quoted by the same rule.
pub(crate) fn header_line<'a>(names: impl Iterator<Item = &'a str>) -> String {
    let mut line = String::new();
    for (index, name) in names.enumerate() {
        if index > 0 {
            line.push('\t');
        }
        push_field(&mut line, name);
    }
    line
}

/// The least text a copy of `rows` × `columns` can be: every value NULL,
/// its separators alone (a tab between cells, a line break between rows),
/// and a header line of `header` bytes with its line break.
pub(crate) fn least_bytes(rows: u64, columns: usize, header: Option<usize>) -> u64 {
    let tabs = rows.saturating_mul(columns.saturating_sub(1) as u64);
    let breaks = rows.saturating_sub(1);
    let header = header.map_or(0, |bytes| bytes as u64 + 1);
    tabs.saturating_add(breaks).saturating_add(header)
}

#[cfg(test)]
mod tests {
    use std::borrow::Cow;

    use super::{header_line, least_bytes, push_value};
    use crate::delegate::CellValue;

    fn field(value: Option<CellValue<'_>>) -> String {
        let mut text = String::new();
        push_value(&mut text, value);
        text
    }

    #[test]
    fn values_are_exact_and_quoted_when_they_must_be() {
        assert_eq!(
            field(Some(CellValue::Float(0.1 + 0.2))),
            "0.30000000000000004"
        );
        assert_eq!(field(Some(CellValue::Float(1e300))), "1e300");
        assert_eq!(field(Some(CellValue::Float32(0.1))), "0.1");
        assert_eq!(field(Some(CellValue::Null)), "");
        assert_eq!(field(None), "");
        let text = |value: &'static str| field(Some(CellValue::Text(Cow::Borrowed(value))));
        assert_eq!(text("plain, text"), "plain, text");
        assert_eq!(text("a\tb"), "\"a\tb\"");
        assert_eq!(text("a\nb"), "\"a\nb\"");
        assert_eq!(text("a\rb"), "\"a\rb\"");
        assert_eq!(text("say \"hi\""), "\"say \"\"hi\"\"\"");
        assert_eq!(text(""), "");
    }

    #[test]
    fn the_header_quotes_by_the_same_rule() {
        assert_eq!(
            header_line(["a", "b c", "d\te"].into_iter()),
            "a\tb c\t\"d\te\""
        );
    }

    #[test]
    fn the_least_text_is_its_separators() {
        assert_eq!(least_bytes(1, 1, None), 0, "one cell: its value alone");
        assert_eq!(least_bytes(3, 4, None), 3 * 3 + 2);
        assert_eq!(least_bytes(3, 4, Some(10)), 3 * 3 + 2 + 11);
        assert_eq!(least_bytes(u64::MAX, 500, None), u64::MAX, "saturates");
    }
}
