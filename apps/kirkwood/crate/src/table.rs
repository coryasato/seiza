//! The table's source: every page answered at once from the catalog, a view
//! over the files' bytes. Nothing is fetched and nothing is copied.
//!
//! The table's rows are the file's, or a drawn group's ([`View::set_group`]),
//! in the file's order or sorted by a column ([`TallTableDelegate::sort`]):
//! either way an index of file rows the pages are read through
//! (`docs/DECISIONS.md`, "Table"). The interface shares the [`View`], to
//! know which file row a row of the table is.
//!
//! The table's columns are the files' and the live ones ([`shown`]): a
//! live cell is worked out when it's drawn ([`crate::live`]).

use std::cell::{Cell, RefCell};
use std::ops::Range;
use std::rc::Rc;

use gpui_kit::{App, px};
use seiza_tall_table::{
    CellValue, ColumnKind, NumberFormat, PageLoad, Sort, SortDirection, SortRefused,
    TallTableColumn, TallTableDelegate, TallTablePage, TallTableState,
};

use crate::catalog::{self, Catalog, column};
use crate::live::{self, Live};

pub type Table = TallTableState<Source>;

/// Where the live columns stand among the table's: after the row's full
/// name, so they're in the panel as it opens, beside the name they're of.
const LIVE_AT: usize = column::FULL_NAME + 1;

/// What a column of the table shows.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Shown {
    /// A column of the two files (`catalog::column`).
    File(usize),
    /// A live column, worked out when it's drawn.
    Live(Live),
}

/// What the table's `column` shows: the files' columns in the sample's
/// order, with the live ones after the full name.
pub fn shown(column: usize) -> Shown {
    match column.checked_sub(LIVE_AT) {
        None => Shown::File(column),
        Some(live) => match Live::ALL.get(live) {
            Some(&live) => Shown::Live(live),
            None => Shown::File(column - Live::ALL.len()),
        },
    }
}

/// The table's columns: the files' ([`catalog::columns`]) and the live
/// ones, each a float at [`live::DECIMALS`] decimals (a page answers
/// fewer while time runs). A live column doesn't sort: its order would be
/// another at every refresh.
pub fn columns() -> Vec<TallTableColumn> {
    let mut columns = catalog::columns();
    for (at, live) in Live::ALL.into_iter().enumerate() {
        columns.insert(
            LIVE_AT + at,
            TallTableColumn::new(live.name(), ColumnKind::Float)
                .format(NumberFormat::new().decimals(live::DECIMALS))
                .width(px(live_width(live))),
        );
    }
    columns
}

/// A live column's width, CSS px: its name's and no more, so the two end
/// inside the panel as it opens (a float column's own 120 px each puts
/// the second past the panel's edge). A cell of the belt's is five
/// characters; the narrower column holds seven, a row under 1,000 au at
/// three decimals, and past that a cell falls back to the table's own
/// rounding to what fits (a handful of rows, at the far end of orbits
/// that reach hundreds of au).
fn live_width(live: Live) -> f32 {
    match live {
        Live::Sun => 76.,
        Live::Jupiter => 96.,
    }
}

thread_local! {
    /// What the last sort's order took to make, ms.
    static SORT_MS: Cell<f64> = const { Cell::new(0.0) };
}

/// What the last sort's order took to make, ms: the stall of a press on
/// a column's arrow (`docs/DECISIONS.md`, "Table"). For the checks.
#[cfg(target_family = "wasm")]
pub fn sort_cost() -> f64 {
    SORT_MS.get()
}

/// The column of the files a press on the table's `column`'s arrow sorts
/// by; nothing for a column that doesn't sort (a text one, a live one).
/// The one rule: the delegate refuses by it, and the checks' hook asks it.
pub fn sortable(column: usize) -> Option<usize> {
    match shown(column) {
        Shown::File(column) if SORTABLE.contains(&column) => Some(column),
        _ => None,
    }
}

/// The columns of the files a press on a header's arrow sorts by: the
/// numbers a row holds as 32-bit floats, a key each with nothing to build.
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

    /// The rows in a sort's order, of a catalog: by the numbers of a
    /// column of the files, ties in the file's order and a row with none
    /// last, both ways.
    fn sort(&mut self, sort: Option<(usize, SortDirection)>, catalog: &Catalog) {
        self.order = sort.map(|(column, direction)| match &self.group {
            Some(group) => order(
                group
                    .iter()
                    .map(|&row| (catalog.number(row as usize, column), row)),
                direction,
            ),
            None => order(
                (0..catalog.rows()).map(|row| (catalog.number(row, column), row as u32)),
                direction,
            ),
        });
    }
}

/// A column's number as a key whose order as an integer is the sort's: a
/// float's own order (as `total_cmp` has it) ascending, and the other way
/// round descending.
fn key(number: f32, direction: SortDirection) -> u32 {
    let bits = number.to_bits();
    // (A float's bits order as its value does once the sign is turned
    // over, and a negative's the other way round.)
    let ascending = if bits >> 31 == 1 {
        !bits
    } else {
        bits | 0x8000_0000
    };
    match direction {
        SortDirection::Ascending => ascending,
        SortDirection::Descending => !ascending,
    }
}

/// The rows of `numbers` (a column's number and its row, the rows in the
/// file's order) in a direction's order: equal numbers in the order they
/// came, and the rows with none (NaN) after every other, in the order
/// they came, both ways. Only the rows with a number are sorted (a tenth
/// of the file has a diameter), by a radix sort of their keys: a
/// comparison sort of every row took three times as long
/// (`docs/DECISIONS.md`, "Table").
fn order(numbers: impl Iterator<Item = (f32, u32)>, direction: SortDirection) -> Rc<[u32]> {
    let mut keyed = Vec::with_capacity(numbers.size_hint().0);
    let mut none = Vec::new();
    for (number, row) in numbers {
        if number.is_nan() {
            none.push(row);
        } else {
            keyed.push((key(number, direction), row));
        }
    }
    sort_by_key(&mut keyed);
    keyed.into_iter().map(|(_, row)| row).chain(none).collect()
}

/// `keyed` (a key and its row) by its keys, equal keys in the order they
/// came: three passes over the key's bits, from the least.
fn sort_by_key(keyed: &mut Vec<(u32, u32)>) {
    const BITS: u32 = 11;
    const BUCKETS: usize = 1 << BITS;
    const SHIFTS: [u32; 3] = [0, BITS, 2 * BITS];
    let bucket = |key: u32, shift: u32| (key >> shift) as usize & (BUCKETS - 1);
    // Every pass's counts, in one reading of the keys.
    let mut counts = vec![[0u32; BUCKETS]; SHIFTS.len()];
    for &(key, _) in keyed.iter() {
        for (counts, shift) in counts.iter_mut().zip(SHIFTS) {
            counts[bucket(key, shift)] += 1;
        }
    }
    let mut sorted = vec![(0, 0); keyed.len()];
    for (starts, shift) in counts.iter_mut().zip(SHIFTS) {
        // (Every key in one bucket: the pass would move nothing.)
        if starts.iter().any(|&count| count as usize == keyed.len()) {
            continue;
        }
        // Each bucket's count becomes where its first row goes.
        let mut next = 0;
        for start in starts.iter_mut() {
            next += std::mem::replace(start, next);
        }
        for &pair in keyed.iter() {
            let at = &mut starts[bucket(pair.0, shift)];
            sorted[*at as usize] = pair;
            *at += 1;
        }
        std::mem::swap(keyed, &mut sorted);
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

    /// The order is made here, in the task that asked: a few frames'
    /// worth for every row (`docs/DECISIONS.md`, "Table").
    fn sort(&mut self, sort: Option<Sort>, _: &mut App) -> Result<(), SortRefused> {
        let sort = match sort {
            None => None,
            Some(sort) => match sortable(sort.column) {
                Some(column) => Some((column, sort.direction)),
                None => return Err(SortRefused::new("This column doesn't sort")),
            },
        };
        let start = crate::clock::page_ms();
        self.view.borrow_mut().sort(sort, &self.catalog);
        SORT_MS.set(crate::clock::page_ms() - start);
        Ok(())
    }
}

impl Page {
    /// The file row at a row of the page; nothing past its end.
    fn file_row(&self, row: usize) -> Option<usize> {
        if row >= self.rows {
            return None;
        }
        let row = match &self.index {
            Some(index) => *index.get(self.first + row)? as usize,
            None => self.first + row,
        };
        (row < self.catalog.rows()).then_some(row)
    }
}

impl TallTablePage for Page {
    fn value(&self, row: usize, column: usize) -> Option<CellValue<'_>> {
        let row = self.file_row(row)?;
        Some(match shown(column) {
            Shown::File(column) => self.catalog.value(row, column),
            // Worked out now, for the instant the live cells show: the
            // table asks each drawn cell every frame.
            Shown::Live(live) => live::value(self.catalog.elements(), row, live)
                .map_or(CellValue::Null, CellValue::Float),
        })
    }

    /// A live cell's decimals: fewer while time runs.
    fn decimals(&self, _: usize, column: usize) -> Option<u8> {
        matches!(shown(column), Shown::Live(_)).then(live::decimals)
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

    use seiza_tall_table::SortDirection;

    use super::{LIVE_AT, Shown, View, columns, key, order, shown};
    use crate::catalog::{self, column};
    use crate::live::Live;

    /// Two of a column's numbers in a direction's order, by comparison:
    /// what the keys' order must be. NaN (none) is last both ways, and
    /// equal to another.
    fn ordered(a: f32, b: f32, direction: SortDirection) -> Ordering {
        match (a.is_nan(), b.is_nan()) {
            (true, true) => Ordering::Equal,
            (true, false) => Ordering::Greater,
            (false, true) => Ordering::Less,
            (false, false) => match direction {
                Ascending => a.total_cmp(&b),
                Descending => b.total_cmp(&a),
            },
        }
    }

    #[test]
    fn a_row_with_no_number_sorts_last_both_ways() {
        let numbers = [f32::NAN, 2.0, -f32::NAN, 1.0, f32::INFINITY, 2.0];
        let rows = |direction| {
            let numbers = numbers.iter().enumerate();
            order(
                numbers.map(|(row, &number)| (number, row as u32)),
                direction,
            )
        };
        assert_eq!(&*rows(Ascending), &[3, 1, 5, 4, 0, 2]);
        assert_eq!(&*rows(Descending), &[4, 1, 5, 3, 0, 2]);
        assert!(key(1.0, Ascending) < key(2.0, Ascending));
        assert!(key(1.0, Descending) > key(2.0, Descending));
        assert!(key(-0.0, Ascending) < key(0.0, Ascending));
    }

    /// The radix sort against a stable comparison sort, over numbers of
    /// every kind a column holds and many ties.
    #[test]
    fn the_keys_order_is_the_comparisons() {
        // A fixed scramble: no dependency for a few thousand numbers.
        let mut state = 0x2545_f491_u32;
        let mut next = || {
            state ^= state << 13;
            state ^= state >> 17;
            state ^= state << 5;
            state
        };
        let special = [
            0.0,
            -0.0,
            f32::INFINITY,
            f32::NEG_INFINITY,
            f32::NAN,
            f32::MIN_POSITIVE,
            -f32::MIN_POSITIVE,
            f32::MAX,
            f32::MIN,
            1e-40,
        ];
        let values: Vec<f32> = (0..20_000)
            .map(|at| match next() % 10 {
                0 => special[at % special.len()],
                // (Few distinct values: ties.)
                1..=4 => (next() % 50) as f32 / 4.0 - 6.0,
                _ => f32::from_bits(next()),
            })
            .collect();
        for direction in [Ascending, Descending] {
            let mut expected: Vec<u32> = (0..values.len() as u32).collect();
            expected.sort_by(|&a, &b| ordered(values[a as usize], values[b as usize], direction));
            let numbers = values.iter().enumerate();
            let rows = order(numbers.map(|(row, &value)| (value, row as u32)), direction);
            assert_eq!(&*rows, &expected[..], "{direction:?}");
        }
        assert!(order(std::iter::empty(), Ascending).is_empty());
    }

    #[test]
    fn the_live_columns_stand_after_the_full_name() {
        let columns = columns();
        assert_eq!(columns.len(), column::COUNT + Live::ALL.len());
        assert_eq!(shown(column::FULL_NAME), Shown::File(column::FULL_NAME));
        assert_eq!(shown(LIVE_AT), Shown::Live(Live::Sun));
        assert_eq!(shown(LIVE_AT + 1), Shown::Live(Live::Jupiter));
        assert_eq!(shown(LIVE_AT + 2), Shown::File(column::PDES));
        // Every column of the files is shown once, in the sample's order.
        let files: Vec<usize> = (0..columns.len())
            .filter_map(|column| match shown(column) {
                Shown::File(file) => Some(file),
                Shown::Live(_) => None,
            })
            .collect();
        assert_eq!(files, (0..column::COUNT).collect::<Vec<_>>());
        assert_eq!(catalog::columns().len(), column::COUNT);
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
