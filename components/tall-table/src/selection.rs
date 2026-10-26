//! `select`: what's selected, one range from an anchor cell to a head cell,
//! and which kinds a reader can select. The state's `select` module turns
//! presses, drags, and keys into it (`docs/DECISIONS.md`, "Features").

use std::ops::RangeInclusive;

/// A cell: a row and a column (an index into `columns()`).
pub type Cell = (u64, usize);

/// What's selected: one range from `anchor` (the active cell, where a
/// plain arrow moves from) to `head` (where Shift moves), either way round.
/// The kind says how far it spans; the cells are where the reader is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum TallTableSelection {
    /// The rows between, every column.
    Rows { anchor: Cell, head: Cell },
    /// The columns between, every row, rows that arrive later included.
    Columns { anchor: Cell, head: Cell },
    /// The block between.
    Cells { anchor: Cell, head: Cell },
}

/// A selection's kind, without its cells.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Kind {
    Rows,
    Columns,
    Cells,
}

impl Kind {
    /// Whether a range of this kind spans rows: up and down move its head.
    pub(crate) fn spans_rows(self) -> bool {
        self != Kind::Columns
    }

    /// Whether it spans columns: left and right move its head.
    pub(crate) fn spans_columns(self) -> bool {
        self != Kind::Rows
    }

    #[cfg(test)]
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Kind::Rows => "rows",
            Kind::Columns => "columns",
            Kind::Cells => "cells",
        }
    }
}

fn between<T: Ord + Copy>(a: T, b: T) -> RangeInclusive<T> {
    a.min(b)..=a.max(b)
}

impl TallTableSelection {
    pub(crate) fn new(kind: Kind, anchor: Cell, head: Cell) -> Self {
        match kind {
            Kind::Rows => Self::Rows { anchor, head },
            Kind::Columns => Self::Columns { anchor, head },
            Kind::Cells => Self::Cells { anchor, head },
        }
    }

    pub(crate) fn kind(&self) -> Kind {
        match self {
            Self::Rows { .. } => Kind::Rows,
            Self::Columns { .. } => Kind::Columns,
            Self::Cells { .. } => Kind::Cells,
        }
    }

    /// The same kind, from `anchor` to `head`.
    pub(crate) fn with(&self, anchor: Cell, head: Cell) -> Self {
        Self::new(self.kind(), anchor, head)
    }

    /// The rows it covers, given the table's `rows`; `None` if none.
    pub fn rows(&self, rows: u64) -> Option<RangeInclusive<u64>> {
        let last = rows.checked_sub(1)?;
        let (start, end) = match self {
            Self::Columns { .. } => (0, last),
            Self::Rows { anchor, head } | Self::Cells { anchor, head } => {
                let range = between(anchor.0, head.0);
                (*range.start(), (*range.end()).min(last))
            }
        };
        (start <= end).then_some(start..=end)
    }

    /// The columns it covers, given the table's `columns`; `None` if none.
    pub fn columns(&self, columns: usize) -> Option<RangeInclusive<usize>> {
        let last = columns.checked_sub(1)?;
        let (start, end) = match self {
            Self::Rows { .. } => (0, last),
            Self::Columns { anchor, head } | Self::Cells { anchor, head } => {
                let range = between(anchor.1, head.1);
                (*range.start(), (*range.end()).min(last))
            }
        };
        (start <= end).then_some(start..=end)
    }

    pub fn contains(&self, row: u64, column: usize) -> bool {
        match self {
            Self::Rows { anchor, head } => between(anchor.0, head.0).contains(&row),
            Self::Columns { anchor, head } => between(anchor.1, head.1).contains(&column),
            Self::Cells { anchor, head } => {
                between(anchor.0, head.0).contains(&row)
                    && between(anchor.1, head.1).contains(&column)
            }
        }
    }

    pub fn anchor(&self) -> Cell {
        match *self {
            Self::Rows { anchor, .. }
            | Self::Columns { anchor, .. }
            | Self::Cells { anchor, .. } => anchor,
        }
    }

    pub fn head(&self) -> Cell {
        match *self {
            Self::Rows { head, .. } | Self::Columns { head, .. } | Self::Cells { head, .. } => head,
        }
    }
}

/// Which kinds a reader can select: all on by default.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub struct Selectable {
    pub rows: bool,
    pub columns: bool,
    pub cells: bool,
}

impl Default for Selectable {
    fn default() -> Self {
        Self::all()
    }
}

impl Selectable {
    pub fn all() -> Self {
        Self {
            rows: true,
            columns: true,
            cells: true,
        }
    }

    pub fn none() -> Self {
        Self {
            rows: false,
            columns: false,
            cells: false,
        }
    }

    pub fn rows(self, on: bool) -> Self {
        Self { rows: on, ..self }
    }

    pub fn columns(self, on: bool) -> Self {
        Self {
            columns: on,
            ..self
        }
    }

    pub fn cells(self, on: bool) -> Self {
        Self { cells: on, ..self }
    }

    /// Whether any kind is on: the keys' context is added only then.
    pub(crate) fn any(&self) -> bool {
        self.rows || self.columns || self.cells
    }

    pub(crate) fn allows(&self, kind: Kind) -> bool {
        match kind {
            Kind::Rows => self.rows,
            Kind::Columns => self.columns,
            Kind::Cells => self.cells,
        }
    }

    /// The smallest kind that's on and holds a cell, else its row, else
    /// (`column_too`, for a key) its column.
    pub(crate) fn smallest(&self, column_too: bool) -> Option<Kind> {
        [Kind::Cells, Kind::Rows]
            .into_iter()
            .chain(column_too.then_some(Kind::Columns))
            .find(|kind| self.allows(*kind))
    }
}

#[cfg(test)]
mod tests {
    use super::{Kind, Selectable, TallTableSelection};

    #[test]
    fn ranges_either_way_round() {
        let cells = TallTableSelection::Cells {
            anchor: (9, 4),
            head: (2, 1),
        };
        assert_eq!(cells.rows(100), Some(2..=9));
        assert_eq!(cells.columns(10), Some(1..=4));
        assert!(cells.contains(2, 4) && cells.contains(9, 1));
        assert!(!cells.contains(10, 2) && !cells.contains(5, 0));
        assert_eq!((cells.anchor(), cells.head()), ((9, 4), (2, 1)));
    }

    #[test]
    fn each_kind_spans_its_way() {
        let rows = TallTableSelection::Rows {
            anchor: (3, 2),
            head: (5, 0),
        };
        assert_eq!(rows.rows(100), Some(3..=5));
        assert_eq!(rows.columns(7), Some(0..=6), "every column");
        assert!(rows.contains(4, 6) && !rows.contains(6, 2));
        let columns = TallTableSelection::Columns {
            anchor: (3, 2),
            head: (5, 4),
        };
        assert_eq!(columns.rows(1_567_523), Some(0..=1_567_522), "every row");
        assert_eq!(columns.columns(7), Some(2..=4));
        assert!(columns.contains(u64::MAX, 3), "rows that arrive too");
    }

    #[test]
    fn past_the_end_covers_nothing() {
        let rows = TallTableSelection::Rows {
            anchor: (10, 0),
            head: (20, 0),
        };
        assert_eq!(rows.rows(15), Some(10..=14));
        assert_eq!(rows.rows(10), None);
        assert_eq!(rows.rows(0), None);
        assert_eq!(rows.columns(0), None);
    }

    #[test]
    fn the_smallest_kind_on() {
        assert_eq!(Selectable::all().smallest(true), Some(Kind::Cells));
        let rows = Selectable::none().rows(true).columns(true);
        assert_eq!(rows.smallest(true), Some(Kind::Rows));
        let columns = Selectable::none().columns(true);
        assert_eq!(columns.smallest(false), None, "a press holds no column");
        assert_eq!(columns.smallest(true), Some(Kind::Columns));
        assert!(!Selectable::none().any());
    }
}
