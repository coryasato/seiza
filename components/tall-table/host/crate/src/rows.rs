//! The host's rows, answered from memory: each value a function of its row
//! and column, so every run draws the same cells and no engine's bytes or
//! work mix into what's measured. A page is materialized when its read
//! resolves (outside the frames, as an engine's decoded page arrives), and
//! answers the table as the DuckDB source's Arrow pages do: floats as
//! floats, strings borrowed, and integers, booleans, and dates as text made
//! on each read.

use std::borrow::Cow;
use std::cell::RefCell;
use std::collections::HashSet;
use std::fmt::Write as _;
use std::ops::Range;
use std::rc::Rc;
use std::time::Duration;

use gpui_kit::App;
use seiza_tall_table::{
    CellValue, ColumnKind, PageError, PageLoad, TallTableColumn, TallTableDelegate, TallTablePage,
};

/// The rows of both shapes: the observatory's data file's (its
/// `data/MANIFEST.json`), so the paging differs between them only by the
/// columns.
pub const ROWS: u64 = 1_567_523;

/// The wide shape's columns.
pub const WIDE_COLUMNS: usize = 500;

/// Which columns the rows have (the table's `PLAN.md`, "Measuring a
/// feature").
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Shape {
    /// The observatory's 11 columns' kinds.
    Narrow,
    /// [`WIDE_COLUMNS`] float columns.
    Wide,
}

/// The narrow shape: the observatory's columns (`asteroids.parquet`), as
/// the DuckDB source maps their types (`ColumnInfo::tall_table_column`).
const NARROW: [(&str, ColumnKind); 11] = [
    ("spkid", ColumnKind::Integer { max_chars: 20 }),
    ("full_name", ColumnKind::Text),
    ("class", ColumnKind::Text),
    ("neo", ColumnKind::Boolean),
    ("pha", ColumnKind::Boolean),
    ("H", ColumnKind::Float),
    ("diameter", ColumnKind::Float),
    ("albedo", ColumnKind::Float),
    ("a", ColumnKind::Float),
    ("e", ColumnKind::Float),
    ("first_obs", ColumnKind::Date),
];

/// The orbit classes `class` takes.
const CLASSES: [&str; 9] = [
    "MBA", "APO", "AMO", "ATE", "IMB", "OMB", "TJN", "CEN", "TNO",
];

impl Shape {
    /// `narrow` or `wide`.
    pub fn from_name(name: &str) -> Option<Self> {
        match name {
            "narrow" => Some(Self::Narrow),
            "wide" => Some(Self::Wide),
            _ => None,
        }
    }

    pub fn rows(self) -> u64 {
        ROWS
    }

    pub fn columns(self) -> Vec<TallTableColumn> {
        match self {
            Self::Narrow => NARROW
                .iter()
                .map(|(name, kind)| TallTableColumn::new(*name, *kind))
                .collect(),
            Self::Wide => (1..=WIDE_COLUMNS)
                .map(|column| TallTableColumn::new(format!("c{column:03}"), ColumnKind::Float))
                .collect(),
        }
    }
}

/// splitmix64 of the cell's place: the same value every run.
fn hash(row: u64, column: usize) -> u64 {
    let mut z = row
        .wrapping_mul(0x9E37_79B9_7F4A_7C15)
        .wrapping_add((column as u64).wrapping_mul(0xD1B5_4A32_D192_ED03))
        .wrapping_add(0x9E37_79B9_7F4A_7C15);
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    z ^ (z >> 31)
}

/// `hash` as a float in `0..1`.
fn unit(row: u64, column: usize) -> f64 {
    (hash(row, column) >> 11) as f64 / (1u64 << 53) as f64
}

/// A column of a page, as a source decodes it.
enum Values {
    /// NaN is NULL.
    Float(Vec<f64>),
    Integer(Vec<i64>),
    Boolean(Vec<bool>),
    /// Days since 1970-01-01.
    Date(Vec<i32>),
    Text(Vec<String>),
}

/// A page of rows, materialized from [`hash`].
pub struct MemoryPage {
    columns: Vec<Values>,
}

impl MemoryPage {
    pub fn new(shape: Shape, rows: Range<u64>) -> Self {
        let columns = match shape {
            Shape::Narrow => (0..NARROW.len())
                .map(|column| narrow_column(column, rows.clone()))
                .collect(),
            Shape::Wide => (0..WIDE_COLUMNS)
                .map(|column| {
                    // Magnitudes from 0.01 to 10⁴, signed, so the columns
                    // round to different digits.
                    let scale = 10f64.powi(column as i32 % 7 - 2);
                    Values::Float(
                        rows.clone()
                            .map(|row| (unit(row, column) - 0.5) * 2.0 * scale)
                            .collect(),
                    )
                })
                .collect(),
        };
        Self { columns }
    }
}

/// The narrow shape's `column` over `rows`, in the ranges the asteroids'
/// columns hold (`diameter` and `albedo` mostly NULL, as there).
fn narrow_column(column: usize, rows: Range<u64>) -> Values {
    let floats = |value: fn(u64, f64) -> f64| {
        Values::Float(
            rows.clone()
                .map(|row| value(row, unit(row, column)))
                .collect(),
        )
    };
    // `diameter` and `albedo` are NULL in the same rows, most of them.
    let measured = |row: u64| hash(row, 6) % 100 < 15;
    match column {
        0 => Values::Integer(rows.map(|row| 20_000_001 + row as i64).collect()),
        1 => Values::Text(
            rows.map(|row| {
                let h = hash(row, column);
                let mut name = String::with_capacity(28);
                let letter = |shift: u32| char::from(b'A' + ((h >> shift) % 26) as u8);
                let _ = write!(
                    name,
                    "{:>7} S{:05} ({} {}{}{})",
                    row + 1,
                    h % 100_000,
                    1801 + (h >> 20) % 225,
                    letter(30),
                    letter(35),
                    (h >> 40) % 100,
                );
                name
            })
            .collect(),
        ),
        2 => Values::Text(
            rows.map(|row| {
                CLASSES[(hash(row, column) % CLASSES.len() as u64) as usize].to_string()
            })
            .collect(),
        ),
        3 => Values::Boolean(
            rows.map(|row| hash(row, column).is_multiple_of(20))
                .collect(),
        ),
        4 => Values::Boolean(
            rows.map(|row| hash(row, column).is_multiple_of(200))
                .collect(),
        ),
        5 => floats(|_, u| 10.0 + u * 12.0),
        6 => Values::Float(
            rows.map(|row| {
                if measured(row) {
                    unit(row, column).powi(3) * 100.0
                } else {
                    f64::NAN
                }
            })
            .collect(),
        ),
        7 => Values::Float(
            rows.map(|row| {
                if measured(row) {
                    unit(row, column) * 0.5
                } else {
                    f64::NAN
                }
            })
            .collect(),
        ),
        8 => floats(|_, u| 1.5 + u * 3.5),
        9 => floats(|_, u| u * 0.4),
        // 1900-01-01 (-25567) on.
        _ => Values::Date(
            rows.map(|row| -25_567 + (hash(row, column) % 45_000) as i32)
                .collect(),
        ),
    }
}

/// `days` since 1970-01-01 as `YYYY-MM-DD` (Howard Hinnant's
/// `civil_from_days`), as DuckDB writes a `DATE`.
fn date_text(days: i32) -> String {
    let z = i64::from(days) + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!("{year:04}-{month:02}-{day:02}")
}

impl TallTablePage for MemoryPage {
    fn value(&self, row: usize, column: usize) -> Option<CellValue<'_>> {
        Some(match self.columns.get(column)? {
            Values::Float(values) => {
                let value = *values.get(row)?;
                if value.is_nan() {
                    CellValue::Null
                } else {
                    CellValue::Float(value)
                }
            }
            Values::Integer(values) => CellValue::Text(Cow::Owned(values.get(row)?.to_string())),
            Values::Boolean(values) => CellValue::Text(Cow::Owned(values.get(row)?.to_string())),
            Values::Date(values) => CellValue::Text(Cow::Owned(date_text(*values.get(row)?))),
            Values::Text(values) => CellValue::Text(Cow::Borrowed(values.get(row)?)),
        })
    }

    fn heap_bytes(&self) -> usize {
        self.columns
            .iter()
            .map(|values| match values {
                Values::Float(values) => values.capacity() * size_of::<f64>(),
                Values::Integer(values) => values.capacity() * size_of::<i64>(),
                Values::Boolean(values) => values.capacity(),
                Values::Date(values) => values.capacity() * size_of::<i32>(),
                Values::Text(values) => {
                    values.capacity() * size_of::<String>()
                        + values.iter().map(String::capacity).sum::<usize>()
                }
            })
            .sum()
    }
}

/// The table's delegate: each read resolves with its page on GPUI's next
/// turn, or after `delay`. A read cancelled before then resolves with
/// [`PageError::Cancelled`] and makes no page, so the pages the table drops
/// in a fling cost nothing.
pub struct MemoryRows {
    shape: Shape,
    delay: Option<Duration>,
    next_request: u32,
    /// The reads not yet resolved or cancelled.
    pending: Rc<RefCell<HashSet<u32>>>,
}

impl MemoryRows {
    pub fn new(shape: Shape, delay: Option<Duration>) -> Self {
        Self {
            shape,
            delay,
            next_request: 0,
            pending: Rc::default(),
        }
    }
}

impl TallTableDelegate for MemoryRows {
    type Page = MemoryPage;
    type Request = u32;

    fn load_page(&mut self, rows: Range<u64>, cx: &mut App) -> (u32, PageLoad<MemoryPage>) {
        let request = self.next_request;
        self.next_request = self.next_request.wrapping_add(1);
        self.pending.borrow_mut().insert(request);
        let pending = self.pending.clone();
        let shape = self.shape;
        let timer = self
            .delay
            .map(|delay| cx.background_executor().timer(delay));
        let load = async move {
            if let Some(timer) = timer {
                timer.await;
            }
            if !pending.borrow_mut().remove(&request) {
                return Err(PageError::Cancelled);
            }
            Ok(MemoryPage::new(shape, rows))
        };
        (request, Box::pin(load))
    }

    /// The read makes no page when it resolves; one already resolved won
    /// the race.
    fn cancel(&mut self, request: u32, _: &mut App) {
        self.pending.borrow_mut().remove(&request);
    }
}

#[cfg(test)]
mod tests {
    use super::{MemoryPage, MemoryRows, ROWS, Shape, WIDE_COLUMNS, date_text};
    use gpui_kit::TestAppContext;
    use seiza_tall_table::{CellValue, PageError, TallTableDelegate, TallTablePage};

    #[test]
    fn shapes() {
        assert_eq!(Shape::Narrow.columns().len(), 11);
        assert_eq!(Shape::Wide.columns().len(), WIDE_COLUMNS);
        assert_eq!(Shape::Wide.columns()[499].name().as_ref(), "c500");
        assert_eq!(Shape::from_name("wide"), Some(Shape::Wide));
        assert_eq!(Shape::from_name("tall"), None);
        assert_eq!(Shape::Narrow.rows(), ROWS);
    }

    #[test]
    fn values_are_a_function_of_row_and_column() {
        for shape in [Shape::Narrow, Shape::Wide] {
            let page = MemoryPage::new(shape, 1024..2048);
            let again = MemoryPage::new(shape, 1000..2048);
            for column in 0..shape.columns().len() {
                assert_eq!(page.value(5, column), again.value(29, column));
            }
            assert_eq!(page.value(1024, 0), None, "past the page's end");
        }
    }

    #[test]
    fn narrow_values() {
        let page = MemoryPage::new(Shape::Narrow, 0..1024);
        assert_eq!(page.value(0, 0), Some(CellValue::Text("20000001".into())));
        assert!(
            matches!(page.value(0, 3), Some(CellValue::Text(text)) if text == "true" || text == "false")
        );
        let nulls = (0..1024)
            .filter(|row| page.value(*row, 6) == Some(CellValue::Null))
            .count();
        assert!(
            (800..940).contains(&nulls),
            "{nulls} NULL diameters of 1024"
        );
        for row in 0..1024 {
            assert_eq!(
                page.value(row, 6) == Some(CellValue::Null),
                page.value(row, 7) == Some(CellValue::Null)
            );
        }
        assert!(page.heap_bytes() > 1024 * 8 * 6);
    }

    #[test]
    fn dates() {
        assert_eq!(date_text(0), "1970-01-01");
        assert_eq!(date_text(-25_567), "1900-01-01");
        assert_eq!(date_text(19_723), "2024-01-01");
        assert_eq!(date_text(19_782), "2024-02-29");
    }

    #[gpui_kit::test]
    fn a_cancelled_read_makes_no_page(cx: &mut TestAppContext) {
        let mut rows = MemoryRows::new(Shape::Wide, None);
        let (kept, kept_load) = cx.update(|cx| rows.load_page(0..1024, cx));
        let (dropped, dropped_load) = cx.update(|cx| rows.load_page(1024..2048, cx));
        assert_ne!(kept, dropped);
        cx.update(|cx| rows.cancel(dropped, cx));
        let page = futures::executor::block_on(kept_load).expect("the kept read loads");
        assert!(page.value(0, 0).is_some());
        assert_eq!(
            futures::executor::block_on(dropped_load).err(),
            Some(PageError::Cancelled)
        );
        // A cancel after the read resolved changes nothing.
        cx.update(|cx| rows.cancel(kept, cx));
    }
}
