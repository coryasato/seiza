//! Live tail's level (`contenders/scenarios.ts`'s `LIVE_TAIL`): NASA-HTTP's
//! log read a page at a time through the replay's page SQL over the file
//! fetched whole (`crate::tail::TailQuery`), drawn as the design canvas
//! draws it: the time as the log wrote it (`crate::tail::time_text`, never
//! the engine's text) in the muted foreground, an error status (4xx and
//! 5xx) in the scenario's error color, the bytes grouped. The colors come
//! in from the JS host (the scenario's), so nothing here is a copy of them.

use std::borrow::Cow;
use std::ops::Range;
use std::sync::OnceLock;

use gpui_kit::component::Theme;
use gpui_kit::{App, Hsla};
use seiza_duckdb::arrow::{TimeUnit, Value};
use seiza_duckdb::tall_table::QueryRows;
use seiza_tall_table::{
    CellPaint, CellValue, NumberFormat, PageLoad, Ramp, TallTableColumn, TallTableDelegate,
    TallTablePage,
};

use crate::tail::{TailQuery, time_text};

/// The table's columns, in the file's order (`data/prep-nasa.sql`, the
/// file's one home): the open fails on any other.
pub const COLUMNS: [&str; 4] = ["time", "request", "status", "bytes"];
const TIME: usize = 0;
const STATUS: usize = 2;
const BYTES: usize = 3;

/// The first status drawn as an error.
const ERROR_FROM: u64 = 400;

/// The numbers the JS host hands in: the error color in Oklch, light then
/// dark, then each column's width (`web/src/tail.ts` writes them).
const NUMBERS: usize = 2 * 3 + COLUMNS.len();

/// The scene's settings at the tail level.
#[derive(Debug, Clone, PartialEq)]
pub struct Tail {
    /// In Oklch, `[l, c, h]`: the light theme's error color, the dark's.
    pub error: [[f32; 3]; 2],
    /// Each column's width, px, in [`COLUMNS`]' order: the design canvas's.
    pub widths: [f32; 4],
}

impl Tail {
    /// From the JS host's numbers (`[light l, c, h, dark l, c, h, …each
    /// column's width]`).
    /// Anything else is an error the host shows.
    pub fn new(level: &[f64]) -> Result<Self, String> {
        if level.len() != NUMBERS {
            return Err(format!(
                "the tail level takes {NUMBERS} numbers, not {}",
                level.len()
            ));
        }
        let (colors, widths) = level.split_at(2 * 3);
        let mut error = [[0.0; 3]; 2];
        for (color, lch) in error.iter_mut().zip(colors.as_chunks::<3>().0) {
            let &[l, c, h] = lch;
            if !((0.0..=1.0).contains(&l) && c >= 0.0 && c.is_finite() && h.is_finite()) {
                return Err(format!("the error color is out of range: {lch:?}"));
            }
            *color = [l as f32, c as f32, h as f32];
        }
        if !widths.iter().all(|width| *width > 0.0 && width.is_finite()) {
            return Err(format!("a column's width is out of range: {widths:?}"));
        }
        Ok(Self {
            error,
            widths: std::array::from_fn(|index| widths[index] as f32),
        })
    }

    /// The error colors, converted once: a column's ramp resolves its stops
    /// each frame. The first scene installs them (one a page).
    fn install(&self) {
        ERROR.get_or_init(|| self.error.map(crate::scene::oklch));
    }
}

/// The error color, as drawn: light, then dark.
static ERROR: OnceLock<[Hsla; 2]> = OnceLock::new();

fn error(theme: &Theme) -> Hsla {
    ERROR
        .get()
        .expect("the tail's colors are installed with its columns")[usize::from(theme.is_dark())]
}

/// The file's columns must be the log's, in order, and its rows the
/// replay's (`crate::tail::FILE_ROWS`, where every lap's seam falls).
#[cfg_attr(
    not(target_family = "wasm"),
    expect(dead_code, reason = "only the web build opens the file")
)]
pub fn check(columns: &[seiza_duckdb::sql::ColumnInfo], rows: u64) -> Result<(), String> {
    let names: Vec<&str> = columns.iter().map(|info| info.name.as_str()).collect();
    if names != COLUMNS {
        return Err(format!("its columns are {names:?}, not live tail's"));
    }
    if rows != crate::tail::FILE_ROWS {
        return Err(format!(
            "it has {rows} rows, but the replay's laps are {}",
            crate::tail::FILE_ROWS
        ));
    }
    Ok(())
}

/// The table's columns, from the summary's, as the canvas draws them: at
/// its widths, the time muted, an error status in the error color, the
/// bytes grouped.
pub fn columns(columns: Vec<TallTableColumn>, tail: &Tail) -> Vec<TallTableColumn> {
    tail.install();
    columns
        .into_iter()
        .enumerate()
        .map(|(index, column)| {
            let column = match tail.widths.get(index) {
                Some(width) => column.width(gpui_kit::px(*width)),
                None => column,
            };
            match index {
                // One color: every time cell asks for it (`TailPage::paint`).
                TIME => column.text_ramp(Ramp::new(&[
                    |theme| theme.muted_foreground,
                    |theme| theme.muted_foreground,
                ])),
                STATUS => column.text_ramp(Ramp::new(&[error, error])),
                BYTES => column.format(NumberFormat::new().grouping(true)),
                _ => column,
            }
        })
        .collect()
}

type Inner = QueryRows<TailQuery>;

/// The engine's pages through the replay's page SQL, each drawn as the
/// canvas draws it.
pub struct TailRows {
    pub rows: Inner,
}

impl TallTableDelegate for TailRows {
    type Page = TailPage;
    type Request = <Inner as TallTableDelegate>::Request;

    fn load_page(
        &mut self,
        rows: Range<u64>,
        cx: &mut App,
    ) -> (Self::Request, PageLoad<Self::Page>) {
        let (request, load) = self.rows.load_page(rows, cx);
        (
            request,
            Box::pin(async move { load.await.map(|page| TailPage { page }) }),
        )
    }

    fn cancel(&mut self, request: Self::Request, cx: &mut App) {
        self.rows.cancel(request, cx);
    }
}

pub struct TailPage {
    page: <Inner as TallTableDelegate>::Page,
}

/// A timestamp's value in µs from the epoch.
fn micros(value: i64, unit: TimeUnit) -> i64 {
    match unit {
        TimeUnit::Second => value.saturating_mul(1_000_000),
        TimeUnit::Millisecond => value.saturating_mul(1_000),
        TimeUnit::Microsecond => value,
        TimeUnit::Nanosecond => value.div_euclid(1_000),
    }
}

impl TallTablePage for TailPage {
    fn value(&self, row: usize, column: usize) -> Option<CellValue<'_>> {
        if column == TIME
            && let Some(Value::Timestamp { value, unit, .. }) = self.page.value(row, column)
        {
            return Some(CellValue::Text(Cow::Owned(time_text(micros(value, unit)))));
        }
        // The trait's, not the page's own (the engine's `Value`).
        TallTablePage::value(&self.page, row, column)
    }

    fn paint(&self, row: usize, column: usize) -> CellPaint {
        let mut paint = CellPaint::default();
        let error = |status: u64| (status >= ERROR_FROM).then_some(0.0);
        paint.text = match (column, self.page.value(row, column)) {
            (TIME, _) => Some(0.0),
            (STATUS, Some(Value::UInt(status))) => error(status),
            (STATUS, Some(Value::Int(status))) => error(status.max(0) as u64),
            _ => None,
        };
        paint
    }

    fn heap_bytes(&self) -> usize {
        TallTablePage::heap_bytes(&self.page)
    }
}

#[cfg(test)]
mod tests {
    use super::{COLUMNS, Tail, micros};
    use seiza_duckdb::arrow::TimeUnit;

    /// `contenders/scenarios.ts`'s live tail error colors, as
    /// `web/src/tail.ts` hands them in (market watch's fall).
    const NUMBERS: [f64; 10] = [0.45, 0.17, 27.0, 0.68, 0.19, 27.0, 196.0, 470.0, 72.0, 90.0];

    #[test]
    fn the_numbers_make_the_scene() {
        let tail = Tail::new(&NUMBERS).unwrap();
        assert_eq!(tail.error, [[0.45, 0.17, 27.0], [0.68, 0.19, 27.0]]);
        assert_eq!(tail.widths, [196.0, 470.0, 72.0, 90.0]);
        assert!(Tail::new(&NUMBERS[..9]).is_err(), "a number short");
        let with = |index: usize, value: f64| {
            let mut numbers = NUMBERS;
            numbers[index] = value;
            Tail::new(&numbers)
        };
        assert!(with(0, 1.5).is_err(), "a lightness past 1");
        assert!(with(1, -0.1).is_err(), "a negative chroma");
        assert!(with(1, f64::INFINITY).is_err(), "an infinite chroma");
        assert!(with(7, 0.0).is_err(), "a width of 0");
        assert!(with(7, f64::NAN).is_err(), "a width not a number");
    }

    #[test]
    fn the_columns_are_prep_nasas() {
        assert_eq!(COLUMNS, ["time", "request", "status", "bytes"]);
    }

    #[test]
    fn a_timestamp_in_any_unit_is_its_micros() {
        // The file's first row, 01/Jul/1995 00:00:01.
        let s = 804_556_801;
        assert_eq!(micros(s, TimeUnit::Second), s * 1_000_000);
        assert_eq!(micros(s * 1_000, TimeUnit::Millisecond), s * 1_000_000);
        assert_eq!(micros(s * 1_000_000, TimeUnit::Microsecond), s * 1_000_000);
        assert_eq!(
            micros(s * 1_000_000_000 + 999, TimeUnit::Nanosecond),
            s * 1_000_000
        );
    }
}
