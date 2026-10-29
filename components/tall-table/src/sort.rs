//! `sort`: the order the table reads its rows in, one column ascending or
//! descending, which its source answers or refuses
//! ([`TallTableDelegate::sort`](crate::TallTableDelegate::sort)). The
//! state's `sort` module draws the arrows and turns their clicks into it
//! (`docs/DECISIONS.md`, "Features").

use gpui_kit::SharedString;

use crate::column::ColumnKind;

/// Which way a column sorts.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SortDirection {
    Ascending,
    Descending,
}

impl SortDirection {
    /// The other way.
    pub(crate) fn flipped(self) -> Self {
        match self {
            Self::Ascending => Self::Descending,
            Self::Descending => Self::Ascending,
        }
    }

    /// The first direction a click on a column of `kind` sorts it: a text
    /// column ascending (A to Z), every other kind descending (the largest,
    /// latest, or true first), as TanStack's `getAutoSortDir`.
    pub(crate) fn first(kind: ColumnKind) -> Self {
        match kind {
            ColumnKind::Text => Self::Ascending,
            _ => Self::Descending,
        }
    }
}

/// The order the table reads its rows in: one column's values.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub struct Sort {
    /// The column's index among the columns the table was given, as
    /// `TallTablePage::value` reads it.
    pub column: usize,
    pub direction: SortDirection,
}

impl Sort {
    pub fn new(column: usize, direction: SortDirection) -> Self {
        Self { column, direction }
    }
}

/// What a click on column `column`'s arrow (of kind `kind`) sorts by, from
/// `current`: the column's first direction, then the other, then off.
pub(crate) fn next(current: Option<Sort>, column: usize, kind: ColumnKind) -> Option<Sort> {
    let first = SortDirection::first(kind);
    match current {
        Some(sort) if sort.column == column && sort.direction == first => {
            Some(Sort::new(column, first.flipped()))
        }
        Some(sort) if sort.column == column => None,
        _ => Some(Sort::new(column, first)),
    }
}

/// Why a source can't sort a column: for the host to show.
#[derive(Debug, Clone, PartialEq)]
#[non_exhaustive]
pub struct SortRefused {
    pub message: String,
}

impl SortRefused {
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

/// The arrows as SVGs from the host's asset source, in place of the
/// glyphs (`↑`, `↓`, `↕`): gpui-kit's `IconName::SortAscending`,
/// `SortDescending`, and `ChevronsUpDown`'s paths, say, bundled by the host
/// (`icon_assets!`), or its own.
#[derive(Debug, Clone, PartialEq)]
#[non_exhaustive]
pub struct SortIcons {
    pub ascending: SharedString,
    pub descending: SharedString,
    pub unsorted: SharedString,
}

impl SortIcons {
    pub fn new(
        ascending: impl Into<SharedString>,
        descending: impl Into<SharedString>,
        unsorted: impl Into<SharedString>,
    ) -> Self {
        Self {
            ascending: ascending.into(),
            descending: descending.into(),
            unsorted: unsorted.into(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{Sort, SortDirection, next};
    use crate::column::ColumnKind;

    #[test]
    fn the_cycle_by_kind() {
        use SortDirection::{Ascending, Descending};
        let cycle = |kind| {
            let first = next(None, 2, kind);
            let second = next(first, 2, kind);
            (first, second, next(second, 2, kind))
        };
        let (asc, desc) = (
            Some(Sort::new(2, Ascending)),
            Some(Sort::new(2, Descending)),
        );
        assert_eq!(cycle(ColumnKind::Text), (asc, desc, None));
        for kind in [ColumnKind::Float, ColumnKind::Date, ColumnKind::Boolean] {
            assert_eq!(cycle(kind), (desc, asc, None), "{kind:?}");
        }
        // Another column starts its own.
        assert_eq!(
            next(asc, 3, ColumnKind::Float),
            Some(Sort::new(3, Descending))
        );
    }
}
