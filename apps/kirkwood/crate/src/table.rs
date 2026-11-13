//! The table's source: every page answered at once from the catalog, a view
//! over the files' bytes. Nothing is fetched and nothing is copied.
//!
//! The table's rows are the file's, or a drawn group's ([`View::set_group`]),
//! in the file's order or sorted by a column ([`TallTableDelegate::sort`]):
//! either way an index of file rows the pages are read through
//! (`docs/DECISIONS.md`, "Table"). The interface shares the [`View`], to
//! know which file row a row of the table is.

use std::cell::RefCell;
use std::cmp::Ordering;
use std::ops::Range;
use std::rc::Rc;

use gpui_kit::App;
use seiza_tall_table::{
    CellValue, PageLoad, Sort, SortDirection, SortRefused, TallTableDelegate, TallTablePage,
    TallTableState,
};

use crate::catalog::{Catalog, column};

pub type Table = TallTableState<Source>;

/// The columns a press on a header's arrow sorts by: the numbers a row
/// holds as 32-bit floats, a key each with nothing to build.
pub const SORTABLE: [usize; 8] = [
    column::H,
    column::DIAMETER,
    column::ALBEDO,
    column::A,
    column::E,
    column::I,
    column::Q,
    column::PER_Y,
];

/// Which file rows the table reads, and in what order.
#[derive(Default)]
pub struct View {
    /// A drawn group's rows, in the file's order; every row with none.
    group: Option<Rc<[u32]>>,
    /// The rows in the table's sort's order; the file's order with none.
    order: Option<Rc<[u32]>>,
}

impl View {
    /// The rows the table reads: a group's, or with none every row.
    pub fn set_group(&mut self, group: Option<Rc<[u32]>>) {
        self.group = group;
        // (An order over the rows before is none over these: the table is
        // sorted again by whoever changed the group.)
        self.order = None;
    }

    /// The table's rows, of a file of `rows`.
    pub fn rows(&self, rows: usize) -> usize {
        self.group.as_ref().map_or(rows, |group| group.len())
    }

    /// The file rows the table's rows are, in its order; nothing when
    /// they're every row in the file's order.
    fn index(&self) -> Option<Rc<[u32]>> {
        self.order.clone().or_else(|| self.group.clone())
    }

    /// The file row at a row of the table.
    pub fn file_row(&self, at: usize) -> Option<usize> {
        match self.order.as_ref().or(self.group.as_ref()) {
            Some(index) => index.get(at).map(|&row| row as usize),
            None => Some(at),
        }
    }

    /// The row of the table a file row is at; nothing for a row that
    /// isn't in the group.
    pub fn at(&self, file_row: usize) -> Option<usize> {
        match (&self.order, &self.group) {
            (Some(order), _) => order.iter().position(|&row| row as usize == file_row),
            (None, Some(group)) => group.binary_search(&(file_row as u32)).ok(),
            (None, None) => Some(file_row),
        }
    }

    /// The rows in `sort`'s order, of a catalog: by the column's numbers,
    /// ties in the file's order and a row with none last, both ways.
    fn sort(&mut self, sort: Option<Sort>, catalog: &Catalog) {
        self.order = sort.map(|sort| {
            let mut keyed: Vec<(f32, u32)> = match &self.group {
                Some(group) => group
                    .iter()
                    .map(|&row| (catalog.number(row as usize, sort.column), row))
                    .collect(),
                None => (0..catalog.rows())
                    .map(|row| (catalog.number(row, sort.column), row as u32))
                    .collect(),
            };
            // (Stable: the rows come in the file's order.)
            keyed.sort_by(|(a, _), (b, _)| ordered(*a, *b, sort.direction));
            keyed.into_iter().map(|(_, row)| row).collect()
        });
    }
}

/// Two of a column's numbers in a direction's order; NaN (none) is last
/// both ways, and equal to another.
fn ordered(a: f32, b: f32, direction: SortDirection) -> Ordering {
    match (a.is_nan(), b.is_nan()) {
        (true, true) => Ordering::Equal,
        (true, false) => Ordering::Greater,
        (false, true) => Ordering::Less,
        (false, false) => match direction {
            SortDirection::Ascending => a.total_cmp(&b),
            SortDirection::Descending => b.total_cmp(&a),
        },
    }
}

pub struct Source {
    catalog: Rc<Catalog>,
    view: Rc<RefCell<View>>,
    /// Each read's id: never reused.
    next: u64,
}

impl Source {
    pub fn new(catalog: Rc<Catalog>, view: Rc<RefCell<View>>) -> Self {
        Self {
            catalog,
            view,
            next: 0,
        }
    }
}

/// Rows `first..first + rows` of the table: of the catalog, or of the
/// index the table read through when the page was asked for.
pub struct Page {
    catalog: Rc<Catalog>,
    index: Option<Rc<[u32]>>,
    first: usize,
    rows: usize,
}

impl TallTableDelegate for Source {
    type Page = Page;
    type Request = u64;

    fn load_page(&mut self, rows: Range<u64>, _: &mut App) -> (u64, PageLoad<Page>) {
        let page = Page {
            catalog: self.catalog.clone(),
            index: self.view.borrow().index(),
            first: rows.start as usize,
            rows: (rows.end - rows.start) as usize,
        };
        self.next += 1;
        (self.next, Box::pin(std::future::ready(Ok(page))))
    }

    /// Every read has answered by the time it could be cancelled.
    fn cancel(&mut self, _: u64, _: &mut App) {}

    /// The order is made here, in one go (`docs/DECISIONS.md`, "Table").
    fn sort(&mut self, sort: Option<Sort>, _: &mut App) -> Result<(), SortRefused> {
        if let Some(sort) = sort
            && !SORTABLE.contains(&sort.column)
        {
            return Err(SortRefused::new("This column doesn't sort yet"));
        }
        self.view.borrow_mut().sort(sort, &self.catalog);
        Ok(())
    }
}

impl TallTablePage for Page {
    fn value(&self, row: usize, column: usize) -> Option<CellValue<'_>> {
        if row >= self.rows {
            return None;
        }
        let row = match &self.index {
            Some(index) => *index.get(self.first + row)? as usize,
            None => self.first + row,
        };
        (row < self.catalog.rows()).then(|| self.catalog.value(row, column))
    }

    fn heap_bytes(&self) -> usize {
        // A view over the files' bytes: nothing of its own.
        0
    }
}

#[cfg(test)]
mod tests {
    use std::cmp::Ordering;

    use seiza_tall_table::SortDirection::{Ascending, Descending};

    use super::{View, ordered};

    #[test]
    fn a_row_with_no_number_sorts_last_both_ways() {
        for direction in [Ascending, Descending] {
            assert_eq!(ordered(f32::NAN, 1.0, direction), Ordering::Greater);
            assert_eq!(ordered(1.0, f32::NAN, direction), Ordering::Less);
            assert_eq!(ordered(f32::NAN, f32::NAN, direction), Ordering::Equal);
        }
        assert_eq!(ordered(1.0, 2.0, Ascending), Ordering::Less);
        assert_eq!(ordered(1.0, 2.0, Descending), Ordering::Greater);
    }

    #[test]
    fn the_tables_rows_are_the_files_or_a_groups() {
        let mut view = View::default();
        assert_eq!(view.rows(100), 100);
        assert_eq!((view.file_row(7), view.at(7)), (Some(7), Some(7)));
        view.set_group(Some([3, 8, 21].into()));
        assert_eq!(view.rows(100), 3);
        assert_eq!(view.file_row(1), Some(8));
        assert_eq!(view.file_row(3), None);
        assert_eq!((view.at(21), view.at(7)), (Some(2), None));
        view.set_group(None);
        assert_eq!(view.file_row(1), Some(1));
    }
}
