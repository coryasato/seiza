//! The host's rows, answered from memory: each value a function of its row
//! and column, so every run draws the same cells and no engine's bytes or
//! work mix into what's measured. A page is materialized when its read
//! resolves (outside the frames, as an engine's decoded page arrives), and
//! answers the table as the DuckDB source's Arrow pages do: floats as
//! floats, strings borrowed, and integers, booleans, and dates as text made
//! on each read.
//!
//! With `live`, each row has a version, bumped by the host's feed
//! ([`MemoryRows::bump`]); a float's value mixes it in, so a page read
//! after a bump answers new floats (the other columns, and which floats are
//! NULL, stay put).
//!
//! With `follow`, the source counts its reads ([`Reads`]) and publishes
//! the counts as they change, for the tail feed's reads a second and
//! drained reads.

use std::borrow::Cow;
#[cfg(feature = "follow")]
use std::cell::Cell;
use std::cell::RefCell;
#[cfg(feature = "live")]
use std::collections::HashMap;
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

    /// A float column's range, `min..max`, as a source would read it (its
    /// minimum and maximum); `None` for the others.
    pub fn range(self, column: usize) -> Option<(f64, f64)> {
        match self {
            Self::Narrow => match column {
                5 => Some((10.0, 22.0)),
                6 => Some((0.0, 100.0)),
                7 => Some((0.0, 0.5)),
                8 => Some((1.5, 5.0)),
                9 => Some((0.0, 0.4)),
                _ => None,
            },
            Self::Wide => (column < WIDE_COLUMNS).then(|| {
                let scale = wide_scale(column);
                (-scale, scale)
            }),
        }
    }

    /// A float column's range as its paint maps it (`custom-cells`): the
    /// whole column's, the same for every page.
    #[cfg(feature = "custom-cells")]
    pub fn domain(self, column: usize) -> Option<seiza_tall_table::Domain> {
        self.range(column)
            .map(|(min, max)| seiza_tall_table::Domain::new(min, max))
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

/// A wide column's values lie in `-scale..scale`: magnitudes from 0.01 to
/// 10⁴, signed, so the columns round to different digits.
fn wide_scale(column: usize) -> f64 {
    10f64.powi(column as i32 % 7 - 2)
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
    /// Each column's range, for its paint.
    #[cfg(feature = "custom-cells")]
    paint: Option<(Cells, Shape)>,
}

/// How the float columns are painted (`?cells=`, `custom-cells`): each
/// value mapped through its column's range at run time, so the table's
/// paint is used, not only compiled.
#[cfg(feature = "custom-cells")]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Cells {
    /// No paint: the control.
    Text,
    /// A fill through a two-stop ramp, the background to `chart_1`.
    Heat,
    /// A bar from the column's zero, in another color below it.
    Bars,
    /// The value's color through a three-stop ramp: down, none, up.
    Color,
}

#[cfg(feature = "custom-cells")]
impl Cells {
    /// `text`, `heat`, `bars`, or `color`.
    pub fn from_name(name: &str) -> Option<Self> {
        match name {
            "text" => Some(Self::Text),
            "heat" => Some(Self::Heat),
            "bars" => Some(Self::Bars),
            "color" => Some(Self::Color),
            _ => None,
        }
    }

    /// `shape`'s columns, each float column with this style's ramp or bar.
    pub fn columns(self, shape: Shape) -> Vec<TallTableColumn> {
        use seiza_tall_table::{Bar, Ramp};
        shape
            .columns()
            .into_iter()
            .enumerate()
            .map(|(index, column)| match (self, shape.domain(index)) {
                (Self::Heat, Some(_)) => column.fill(Ramp::new(&[
                    |theme| theme.background,
                    |theme| theme.chart_1,
                ])),
                (Self::Bars, Some(domain)) => column.bar(
                    Bar::new(|theme| theme.chart_1)
                        .zero(domain.unit(0.0))
                        .below(|theme| theme.chart_bearish),
                ),
                (Self::Color, Some(_)) => column.text_ramp(Ramp::new(&[
                    |theme| theme.chart_bearish,
                    |theme| theme.foreground,
                    |theme| theme.chart_bullish,
                ])),
                _ => column,
            })
            .collect()
    }
}

/// How long the host's flash fades (`?flash`).
#[cfg(all(feature = "live", feature = "custom-cells"))]
pub const FLASH: Duration = Duration::from_secs(1);

/// `?flash` (`live` with `custom-cells`): `columns` of `shape`, each float
/// column flashing a change through a three-stop ramp: a fall, any other
/// change, a rise.
#[cfg(all(feature = "live", feature = "custom-cells"))]
pub fn with_flash(columns: Vec<TallTableColumn>, shape: Shape) -> Vec<TallTableColumn> {
    use seiza_tall_table::Ramp;
    columns
        .into_iter()
        .enumerate()
        .map(|(index, column)| match shape.range(index) {
            Some(_) => column.flash(
                Ramp::new(&[
                    |theme| theme.chart_bearish,
                    |theme| theme.warning,
                    |theme| theme.chart_bullish,
                ]),
                FLASH,
            ),
            None => column,
        })
        .collect()
}

/// The rows' versions (`live`): rows not in it are at 0.
#[cfg(feature = "live")]
pub type Versions = HashMap<u64, u32>;

/// What a float of `row` is hashed from: the row, with its version mixed in
/// (`live`).
#[cfg(feature = "live")]
fn versioned(row: u64, versions: &Versions) -> u64 {
    versions
        .get(&row)
        .map_or(row, |version| row ^ (u64::from(*version) << 32))
}

impl MemoryPage {
    pub fn new(
        shape: Shape,
        rows: Range<u64>,
        #[cfg(feature = "live")] versions: &Versions,
    ) -> Self {
        #[cfg(not(feature = "live"))]
        let key = |row: u64| row;
        // Each row's key once a page, not once a cell.
        #[cfg(feature = "live")]
        let keys: Vec<u64> = rows.clone().map(|row| versioned(row, versions)).collect();
        #[cfg(feature = "live")]
        let key = |row: u64| keys[(row - rows.start) as usize];
        let columns = match shape {
            Shape::Narrow => (0..NARROW.len())
                .map(|column| narrow_column(column, rows.clone(), key))
                .collect(),
            Shape::Wide => (0..WIDE_COLUMNS)
                .map(|column| {
                    let scale = wide_scale(column);
                    Values::Float(
                        rows.clone()
                            .map(|row| (unit(key(row), column) - 0.5) * 2.0 * scale)
                            .collect(),
                    )
                })
                .collect(),
        };
        Self {
            columns,
            #[cfg(feature = "custom-cells")]
            paint: None,
        }
    }
}

/// The narrow shape's `column` over `rows`, in the ranges the asteroids'
/// columns hold (`diameter` and `albedo` mostly NULL, as there). A float is
/// hashed from `key(row)`.
fn narrow_column(column: usize, rows: Range<u64>, key: impl Fn(u64) -> u64) -> Values {
    let floats = |value: fn(u64, f64) -> f64| {
        Values::Float(
            rows.clone()
                .map(|row| value(row, unit(key(row), column)))
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
                    unit(key(row), column).powi(3) * 100.0
                } else {
                    f64::NAN
                }
            })
            .collect(),
        ),
        7 => Values::Float(
            rows.map(|row| {
                if measured(row) {
                    unit(key(row), column) * 0.5
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

    /// Each float value through its column's range, as the style says.
    #[cfg(feature = "custom-cells")]
    fn paint(&self, row: usize, column: usize) -> seiza_tall_table::CellPaint {
        let mut paint = seiza_tall_table::CellPaint::default();
        let Some((cells, shape)) = self.paint else {
            return paint;
        };
        let (Some(domain), Some(Values::Float(values))) =
            (shape.domain(column), self.columns.get(column))
        else {
            return paint;
        };
        let Some(value) = values.get(row).filter(|value| !value.is_nan()) else {
            return paint;
        };
        let at = Some(domain.unit(*value));
        match cells {
            Cells::Text => {}
            Cells::Heat => paint.fill = at,
            Cells::Bars => paint.bar = at,
            Cells::Color => paint.text = at,
        }
        paint
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

/// The table's delegate: each read resolves with its page as soon as it's
/// polled (a first read on GPUI's next turn, from its task; with `live`, a
/// re-read in the turn that asked), or after `delay`. A read cancelled before then resolves with
/// [`PageError::Cancelled`] and makes no page, so the pages the table drops
/// in a fling cost nothing.
pub struct MemoryRows {
    shape: Shape,
    delay: Option<Duration>,
    #[cfg(feature = "custom-cells")]
    cells: Cells,
    next_request: u32,
    /// The reads not yet resolved or cancelled.
    pending: Rc<RefCell<HashSet<u32>>>,
    /// Each row's version (`live`), read when a page is materialized.
    #[cfg(feature = "live")]
    versions: Rc<RefCell<Versions>>,
    /// The reads it was sent and those cancelled before they resolved
    /// (`follow`).
    #[cfg(feature = "follow")]
    reads: Reads,
}

/// What a [`MemoryRows`] was asked (`follow`): each count published on
/// its global as it changes (wasm), for the scripts.
#[cfg(feature = "follow")]
#[derive(Debug, Default)]
pub struct Reads {
    sent: Cell<u64>,
    drained: Cell<u64>,
}

/// The reads sent so far, and those cancelled in flight ([`Reads`]).
#[cfg(feature = "follow")]
pub const READS_SENT_GLOBAL: &str = "__tallTableReadsSent";
#[cfg(feature = "follow")]
pub const READS_DRAINED_GLOBAL: &str = "__tallTableReadsDrained";

#[cfg(feature = "follow")]
impl Reads {
    fn count(counter: &Cell<u64>, global: &str) {
        counter.set(counter.get() + 1);
        #[cfg(target_family = "wasm")]
        tall_table_bridge::js::set_global(global, &(counter.get() as f64).into());
        #[cfg(not(target_family = "wasm"))]
        let _ = global;
    }

    /// Reads sent so far.
    pub fn sent(&self) -> u64 {
        self.sent.get()
    }

    /// Reads cancelled while still in flight: the table counts them as
    /// draining until they resolve.
    pub fn drained(&self) -> u64 {
        self.drained.get()
    }
}

impl MemoryRows {
    pub fn new(shape: Shape, delay: Option<Duration>) -> Self {
        Self {
            shape,
            delay,
            #[cfg(feature = "custom-cells")]
            cells: Cells::Text,
            next_request: 0,
            pending: Rc::default(),
            #[cfg(feature = "live")]
            versions: Rc::default(),
            #[cfg(feature = "follow")]
            reads: Reads::default(),
        }
    }

    /// Its read counts (`follow`).
    #[cfg(feature = "follow")]
    pub fn reads(&self) -> &Reads {
        &self.reads
    }

    /// `row` changed (`live`): a page read from now on answers its new
    /// floats.
    #[cfg(feature = "live")]
    pub fn bump(&mut self, row: u64) {
        *self.versions.borrow_mut().entry(row).or_default() += 1;
    }

    /// Its pages paint their float columns `cells`' way.
    #[cfg(feature = "custom-cells")]
    pub fn with_cells(self, cells: Cells) -> Self {
        Self { cells, ..self }
    }
}

impl TallTableDelegate for MemoryRows {
    type Page = MemoryPage;
    type Request = u32;

    fn load_page(&mut self, rows: Range<u64>, cx: &mut App) -> (u32, PageLoad<MemoryPage>) {
        let request = self.next_request;
        self.next_request = self.next_request.wrapping_add(1);
        self.pending.borrow_mut().insert(request);
        #[cfg(feature = "follow")]
        Reads::count(&self.reads.sent, READS_SENT_GLOBAL);
        let pending = self.pending.clone();
        let shape = self.shape;
        #[cfg(feature = "custom-cells")]
        let cells = self.cells;
        let timer = self
            .delay
            .map(|delay| cx.background_executor().timer(delay));
        #[cfg(feature = "live")]
        let versions = self.versions.clone();
        let load = async move {
            if let Some(timer) = timer {
                timer.await;
            }
            if !pending.borrow_mut().remove(&request) {
                return Err(PageError::Cancelled);
            }
            #[cfg_attr(not(feature = "custom-cells"), expect(unused_mut))]
            let mut page = MemoryPage::new(
                shape,
                rows,
                #[cfg(feature = "live")]
                &versions.borrow(),
            );
            #[cfg(feature = "custom-cells")]
            if cells != Cells::Text {
                page.paint = Some((cells, shape));
            }
            Ok(page)
        };
        (request, Box::pin(load))
    }

    /// The read makes no page when it resolves; one already resolved won
    /// the race.
    fn cancel(&mut self, request: u32, _: &mut App) {
        #[cfg_attr(not(feature = "follow"), expect(unused_variables))]
        let in_flight = self.pending.borrow_mut().remove(&request);
        #[cfg(feature = "follow")]
        if in_flight {
            Reads::count(&self.reads.drained, READS_DRAINED_GLOBAL);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{MemoryPage, MemoryRows, ROWS, Shape, WIDE_COLUMNS, date_text};

    /// A page at every row's first version.
    fn fresh_page(shape: Shape, rows: std::ops::Range<u64>) -> MemoryPage {
        MemoryPage::new(
            shape,
            rows,
            #[cfg(feature = "live")]
            &Default::default(),
        )
    }
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
            let page = fresh_page(shape, 1024..2048);
            let again = fresh_page(shape, 1000..2048);
            for column in 0..shape.columns().len() {
                assert_eq!(page.value(5, column), again.value(29, column));
            }
            assert_eq!(page.value(1024, 0), None, "past the page's end");
        }
    }

    #[test]
    fn narrow_values() {
        let page = fresh_page(Shape::Narrow, 0..1024);
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

    #[cfg(feature = "custom-cells")]
    #[test]
    fn paint_maps_each_float_through_its_range() {
        use super::Cells;
        for shape in [Shape::Narrow, Shape::Wide] {
            for cells in [Cells::Heat, Cells::Bars, Cells::Color] {
                let mut page = fresh_page(shape, 0..1024);
                page.paint = Some((cells, shape));
                let columns = cells.columns(shape);
                let mut painted = 0;
                for column in 0..columns.len() {
                    for row in 0..1024 {
                        let paint = page.paint(row, column);
                        let at = match cells {
                            Cells::Heat => paint.fill,
                            Cells::Bars => paint.bar,
                            _ => paint.text,
                        };
                        if let Some(at) = at {
                            assert!((0.0..=1.0).contains(&at), "{shape:?} {column}: {at}");
                            assert!(shape.range(column).is_some(), "only float columns paint");
                            painted += 1;
                        } else if shape.range(column).is_some() {
                            assert_eq!(page.value(row, column), Some(CellValue::Null));
                        }
                    }
                }
                assert!(
                    painted > 1024,
                    "{shape:?} {cells:?} painted {painted} cells"
                );
            }
        }
        // `text` paints nothing: the control.
        let page = fresh_page(Shape::Wide, 0..1024);
        assert_eq!(page.paint(0, 0), Default::default());
        assert_eq!(Cells::from_name("heat"), Some(Cells::Heat));
        assert_eq!(Cells::from_name("blue"), None);
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
        // Two reads sent, one cancelled in flight (`follow`).
        #[cfg(feature = "follow")]
        assert_eq!((rows.reads().sent(), rows.reads().drained()), (2, 1));
    }

    #[cfg(feature = "live")]
    #[gpui_kit::test]
    fn a_bumped_row_reads_new_floats(cx: &mut TestAppContext) {
        let read = |rows: &mut MemoryRows, cx: &mut TestAppContext| {
            let (_, load) = cx.update(|cx| rows.load_page(0..1024, cx));
            futures::executor::block_on(load).expect("a page")
        };
        let mut rows = MemoryRows::new(Shape::Narrow, None);
        let before = read(&mut rows, cx);
        // A NULL row and a measured one, so both cases are seen.
        let (null_row, measured_row) = (
            (0..1024).find(|row| before.value(*row, 6) == Some(CellValue::Null)),
            (0..1024).find(|row| before.value(*row, 6) != Some(CellValue::Null)),
        );
        let changed_rows = [null_row.expect("a NULL"), measured_row.expect("a value")];
        for row in changed_rows {
            rows.bump(row as u64);
        }
        let after = read(&mut rows, cx);
        for row in changed_rows {
            for column in 0..11 {
                let float = Shape::Narrow.range(column).is_some();
                let null = before.value(row, column) == Some(CellValue::Null);
                // A float changes, unless NULL; nothing else does.
                let changed = before.value(row, column) != after.value(row, column);
                assert_eq!(changed, float && !null, "row {row}, column {column}");
                assert_eq!(null, after.value(row, column) == Some(CellValue::Null));
            }
        }
        let unchanged = (0..1024).find(|row| !changed_rows.contains(row)).unwrap();
        for column in 0..11 {
            assert_eq!(
                before.value(unchanged, column),
                after.value(unchanged, column)
            );
        }
        // The same versions, the same values: every run reads the same.
        let mut again = MemoryRows::new(Shape::Narrow, None);
        for row in changed_rows {
            again.bump(row as u64);
        }
        let page = read(&mut again, cx);
        assert_eq!(
            page.value(changed_rows[1], 5),
            after.value(changed_rows[1], 5)
        );
    }
}
