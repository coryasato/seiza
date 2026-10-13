//! A table's columns: what the host says about each, and how the table lays
//! them out.

use gpui_kit::SharedString;

/// A column: its name (the header) and the kind of value it holds, which
/// sets its width and how its values are aligned, rounded, and cut.
#[derive(Debug, Clone, PartialEq)]
pub struct Column {
    name: SharedString,
    kind: ColumnKind,
}

impl Column {
    pub fn new(name: impl Into<SharedString>, kind: ColumnKind) -> Self {
        Self {
            name: name.into(),
            kind,
        }
    }

    pub fn name(&self) -> &SharedString {
        &self.name
    }

    pub fn kind(&self) -> ColumnKind {
        self.kind
    }
}

/// What a column holds.
#[derive(Debug, Clone, Copy, PartialEq)]
#[non_exhaustive]
pub enum ColumnKind {
    /// `true`/`false`, left-aligned.
    Boolean,
    /// A date, left-aligned.
    Date,
    /// A date and time, left-aligned.
    Timestamp,
    /// An integer whose widest value is `max_chars` characters (sign
    /// included): right-aligned and never rounded (an ID isn't a quantity).
    /// The column fits that value at the font's widest digit; anything wider
    /// (a 128-bit integer past 20) is cut in the middle, keeping both ends:
    /// its magnitude and its last digits.
    Integer { max_chars: u8 },
    /// A float, right-aligned and rounded to the digits that fit.
    Float,
    /// A decimal, right-aligned, exact, and cut in the middle like an
    /// integer: an end cut would lose its magnitude.
    Decimal,
    /// Anything else, left-aligned and cut at the end.
    Text,
}

/// How a column's values are aligned, and what happens to one too wide for
/// it. Cells are cut by GPUI (`text_overflow`), never by clipping: a
/// right-aligned value clipped by its cell loses its front.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) enum CellKind {
    /// Left-aligned, cut at the end.
    Text,
    /// Right-aligned, cut in the middle.
    Integer,
    /// Right-aligned, rounded to the digits that fit ([`crate::format::fit_float`]).
    Float,
    /// Right-aligned, cut in the middle.
    Decimal,
}

impl CellKind {
    pub(crate) fn numeric(self) -> bool {
        self != Self::Text
    }

    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Text => "text",
            Self::Integer => "integer",
            Self::Float => "float",
            Self::Decimal => "decimal",
        }
    }
}

/// A column as drawn: its left edge in the scrolled content, and its width.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct LaidOutColumn {
    pub(crate) name: SharedString,
    pub(crate) x: f32,
    pub(crate) width: f32,
    pub(crate) kind: CellKind,
    /// How many characters a float may take ([`crate::format::fit_float`]).
    pub(crate) budget: usize,
}

/// A cell's horizontal padding (`px_2` on each side).
pub(crate) const CELL_PADDING: f32 = 16.0;

/// Width and cell kind. An integer column fits its widest value at
/// `number_px` a character. The name's width is estimated at the UI font's
/// average advance; a longer name is cut.
fn column_layout(column: &Column, number_px: f32) -> (f32, CellKind) {
    let digits = |chars: f32| chars * number_px + CELL_PADDING + 1.0;
    let (width, kind) = match column.kind {
        ColumnKind::Boolean => (72.0, CellKind::Text),
        ColumnKind::Date => (104.0, CellKind::Text),
        ColumnKind::Integer { max_chars } => (digits(f32::from(max_chars)), CellKind::Integer),
        ColumnKind::Float => (120.0, CellKind::Float),
        ColumnKind::Decimal => (120.0, CellKind::Decimal),
        ColumnKind::Timestamp => (184.0, CellKind::Text),
        ColumnKind::Text => (200.0, CellKind::Text),
    };
    let name = column.name.chars().count() as f32 * 7.5 + 24.0;
    (width.max(name), kind)
}

/// Lays `columns` out side by side; also returns their total width.
pub(crate) fn layout_columns(columns: &[Column], number_px: f32) -> (Vec<LaidOutColumn>, f32) {
    let mut x = 0.0;
    let columns = columns
        .iter()
        .map(|column| {
            let (width, kind) = column_layout(column, number_px);
            // A pixel short of the room, for rounding in the shaped width.
            let budget = ((width - CELL_PADDING - 1.0) / number_px).floor().max(1.0) as usize;
            let laid_out = LaidOutColumn {
                name: column.name.clone(),
                x,
                width,
                kind,
                budget,
            };
            x += width;
            laid_out
        })
        .collect();
    (columns, x)
}
