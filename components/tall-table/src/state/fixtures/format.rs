//! `format`: `cells.json`'s `format` section run against the table's own
//! format (`ColumnFormat`) and fallback (`shown_text`), with its negative
//! controls; and formatted columns drawn in a window of GPUI's test app,
//! over rows answered from memory, read back through the cells' text
//! element (`DrawnText`): the column's decimals and a page's, a fallback,
//! the tooltip, with `resize` a fit, with `density` the fit at a small and
//! a large text, and the feature on with no format drawing as the base.
//! The test app gives every character 0.6 em (8.4 px at 14 px), so its
//! advances are all one.

use std::ops::Range;
use std::time::Duration;

use gpui_kit::{
    App, AppContext as _, Modifiers, Pixels, Point, TestAppContext, VisualTestContext, point, px,
    size,
};
use serde_json::Value;

use super::super::{Paging, TallTableState, shown_text};
use super::CELLS;
use crate::cells_text::DrawnText;
use crate::column::{CellKind, ColumnKind, LaidOutColumn, TallTableColumn};
use crate::delegate::{CellValue, PageLoad, TallTableDelegate, TallTablePage};
use crate::format::{Advances, ColumnFormat, Control, FORMAT_CHARS};
use crate::{NumberFormat, Sign};

// --- cells.json's format ---

/// A case's format, as the fixture spells it.
fn format_of(spec: &Value) -> NumberFormat {
    let mut format = NumberFormat::new()
        .sign(match spec["sign"].as_str().expect("sign") {
            "negative" => Sign::Negative,
            "always" => Sign::Always,
            sign => panic!("a sign the fixture doesn't use: {sign}"),
        })
        .grouping(spec["grouping"].as_bool().expect("grouping"))
        .suffix(spec["suffix"].as_str().expect("suffix").to_string());
    if let Some(decimals) = spec["decimals"].as_u64() {
        format = format.decimals(decimals as u8);
    }
    format
}

/// The fixture's cases that the table's format doesn't give, under
/// `control`.
fn format_mismatches(control: Control) -> Vec<String> {
    let fixture: Value = serde_json::from_str(CELLS).expect("cells.json");
    let number_px = fixture["number_px"].as_f64().expect("number_px") as f32;
    let section = &fixture["format"];
    let advance = |ch: char| {
        section["advances"][ch.to_string()]
            .as_f64()
            .unwrap_or_else(|| panic!("no advance for {ch:?}")) as f32
    };
    let advances = Advances::new(FORMAT_CHARS.map(advance));
    let mut mismatches = Vec::new();
    for case in section["cases"].as_array().expect("cases") {
        let why = case["why"].as_str().expect("why");
        let format = format_of(&case["format"]);
        let suffix_px = format.suffix.chars().map(advance).sum();
        let width = case["width"].as_f64().expect("width") as f32;
        let (kind, value) = match (case["kind"].as_str().expect("kind"), case["value"].as_str()) {
            (_, None) => (CellKind::Float, CellValue::Null),
            ("float", Some(text)) => (
                CellKind::Float,
                CellValue::Float(text.parse().expect("a float")),
            ),
            ("float32", Some(text)) => (
                CellKind::Float,
                CellValue::Float32(text.parse().expect("a float")),
            ),
            ("integer", Some(text)) => (CellKind::Integer, CellValue::Text(text.into())),
            ("decimal", Some(text)) => (CellKind::Decimal, CellValue::Text(text.into())),
            (kind, _) => panic!("a kind the fixture doesn't use: {kind}"),
        };
        // `cells.json`'s budget rule: the padding and a pixel short.
        let budget = ((width - 17.0) / number_px).floor().max(1.0) as usize;
        let column_format = ColumnFormat {
            format,
            float: kind == CellKind::Float,
            suffix_px,
            control,
        };
        let column = LaidOutColumn {
            name: "c".into(),
            x: 0.0,
            width,
            kind,
            budget,
            format: Some(column_format.clone()),
        };
        // The page's decimals are asked only of a float column.
        let decimals = case["decimals"]
            .as_u64()
            .filter(|_| kind == CellKind::Float)
            .map(|decimals| decimals as u8);
        let exact = value.to_string();
        let (shown, fallback, rounded) =
            match column_format.fit(&advances, width - 16.0 - 1.0, &value, decimals) {
                Some(text) => {
                    let rounded = column_format.rounded(&text, &value);
                    (text, false, Some(rounded))
                }
                None => (shown_text(&column, value.clone()), true, None),
            };
        let got = (exact.as_str(), shown.as_str(), fallback, rounded);
        let want = (
            case["exact"].as_str().expect("exact"),
            case["shown"].as_str().expect("shown"),
            case["fallback"].as_bool().expect("fallback"),
            case["rounded"].as_bool(),
        );
        if got != want {
            mismatches.push(format!("{why}: {got:?}; the fixture's {want:?}"));
        }
    }
    mismatches
}

#[test]
fn format_fixture() {
    let mismatches = format_mismatches(Control::None);
    assert!(mismatches.is_empty(), "{mismatches:#?}");
}

#[test]
fn format_controls_fail() {
    for control in [
        Control::PlusOnZero,
        Control::SignFromText,
        Control::TiesUp,
        Control::GroupByFour,
        Control::FitByCount,
        Control::PageIgnored,
    ] {
        assert!(
            !format_mismatches(control).is_empty(),
            "{control:?} passed the format fixture"
        );
    }
}

// --- in a window ---

/// A formatted float (2 decimals, `+`, grouped; a page's 3 on every fourth
/// row), a grouped integer, the same float unformatted, and a text column
/// given a format it ignores.
fn columns(formatted: bool) -> Vec<TallTableColumn> {
    let format = |column: TallTableColumn, format: NumberFormat| {
        if formatted {
            column.format(format)
        } else {
            column
        }
    };
    vec![
        format(
            TallTableColumn::new("f", ColumnKind::Float),
            NumberFormat::new()
                .decimals(2)
                .sign(Sign::Always)
                .grouping(true),
        ),
        format(
            TallTableColumn::new("n", ColumnKind::Integer { max_chars: 10 }),
            NumberFormat::new().grouping(true),
        ),
        TallTableColumn::new("g", ColumnKind::Float),
        format(
            TallTableColumn::new("t", ColumnKind::Text),
            NumberFormat::new().grouping(true).suffix("%"),
        ),
    ]
}

/// The row too wide formatted (`+123,456,789.12`, 15 characters) for the
/// float column's 12.
const WIDE_ROW: u64 = 7;

fn value(row: u64, column: usize) -> CellValue<'static> {
    match column {
        0 | 2 if row == WIDE_ROW => CellValue::Float(123_456_789.125),
        // Exact at 2 (or the page's 3): only dressed.
        0 | 2 if row.is_multiple_of(2) => CellValue::Float(row as f64 + 0.5),
        // A tie at the third decimal: rounded, to even.
        0 | 2 => CellValue::Float(row as f64 + 0.125),
        1 => CellValue::Text((1_000_000 + row).to_string().into()),
        _ => CellValue::Text(format!("{row}000").into()),
    }
}

struct Rows(Range<u64>);

impl TallTablePage for Rows {
    fn value(&self, row: usize, column: usize) -> Option<CellValue<'_>> {
        Some(value(self.0.start + row as u64, column))
    }

    fn decimals(&self, row: usize, column: usize) -> Option<u8> {
        // The float columns, formatted (column 2 only once a test formats it).
        assert!(
            matches!(column, 0 | 2),
            "asked of column {column}, not a float"
        );
        (self.0.start + row as u64).is_multiple_of(4).then_some(3)
    }

    fn heap_bytes(&self) -> usize {
        1024
    }

    #[cfg(feature = "custom-cells")]
    fn paint(&self, _: usize, _: usize) -> crate::CellPaint {
        crate::CellPaint::default()
    }
}

struct Memory;

impl TallTableDelegate for Memory {
    type Page = Rows;
    type Request = u64;

    fn load_page(&mut self, rows: Range<u64>, _: &mut App) -> (u64, PageLoad<Rows>) {
        (rows.start, Box::pin(std::future::ready(Ok(Rows(rows)))))
    }

    fn cancel(&mut self, _: u64, _: &mut App) {}
}

type Table = TallTableState<Memory>;

struct Shell(gpui_kit::Entity<Table>);

impl gpui_kit::Render for Shell {
    fn render(
        &mut self,
        _: &mut gpui_kit::Window,
        _: &mut gpui_kit::Context<Self>,
    ) -> impl gpui_kit::IntoElement {
        use gpui_kit::{ParentElement as _, Styled as _};
        gpui_kit::div()
            .size_full()
            .text_size(gpui_kit::rems(crate::state::TEXT_REMS))
            .child(self.0.clone())
    }
}

/// The table in a 700×400 window.
struct Sheet<'a> {
    cx: &'a mut VisualTestContext,
    table: gpui_kit::Entity<Table>,
}

impl<'a> Sheet<'a> {
    fn open(cx: &'a mut TestAppContext, formatted: bool) -> Self {
        cx.update(|cx| {
            gpui_kit::component::init(cx);
            crate::init(cx);
        });
        let (shell, cx) = cx.add_window_view(|_, cx| {
            Shell(cx.new(|cx| {
                TallTableState::new(Memory, columns(formatted), 10_000, Paging::default(), cx)
            }))
        });
        let table = shell.read_with(cx, |shell, _| shell.0.clone());
        cx.simulate_resize(size(px(700.), px(400.)));
        let mut sheet = Self { cx, table };
        sheet.draw();
        sheet
    }

    fn draw(&mut self) {
        for _ in 0..2 {
            self.cx.run_until_parked();
            self.cx.update(|window, cx| window.draw(cx).clear(cx));
        }
    }

    fn update<T>(
        &mut self,
        update: impl FnOnce(&mut Table, &mut gpui_kit::Context<Table>) -> T,
    ) -> T {
        let result = self.table.update(self.cx, update);
        self.draw();
        result
    }

    fn read<T>(&mut self, read: impl FnOnce(&Table) -> T) -> T {
        self.table.read_with(self.cx, |table, _| read(table))
    }

    fn drawn(&mut self) -> Vec<DrawnText> {
        self.read(|table| table.drawn_text.borrow().clone())
    }

    /// Row `row`'s drawn text in column `column`.
    fn text(&mut self, row: u64, column: usize) -> String {
        self.drawn()
            .into_iter()
            .find(|drawn| drawn.row == row && drawn.column == column)
            .unwrap_or_else(|| panic!("row {row}, column {column} drawn"))
            .text
    }

    /// A point on row `row` of the view, `x` px right of column `column`'s
    /// left.
    fn at(&mut self, column: usize, row: u64) -> Point<Pixels> {
        let (origin, gutter, row_h, left) = self.read(|table| {
            (
                table.body.origin,
                table.gutter_width(),
                table.sizes().row(),
                table.columns[column].x,
            )
        });
        origin + point(px(gutter + left + 20.), row_h * (row as f32 + 0.5))
    }

    /// Whether a rested pointer at `at` shows a tooltip.
    fn tooltip_at(&mut self, at: Point<Pixels>) -> bool {
        // Away first, so the cell is a new one and its delay runs.
        let away = self.at(0, 11) + point(px(0.), px(200.));
        self.cx
            .simulate_mouse_move(away, None, Modifiers::default());
        self.draw();
        self.cx
            .executor()
            .advance_clock(Duration::from_millis(1000));
        self.cx.simulate_mouse_move(at, None, Modifiers::default());
        self.draw();
        self.cx.executor().advance_clock(Duration::from_millis(600));
        self.draw();
        self.read(|table| {
            table
                .hover
                .as_ref()
                .is_some_and(|hover| hover.tooltip.is_some())
        })
    }

    /// Every drawn cell of the formatted float column is its formatted text
    /// where that takes at most the content box less a pixel (the test
    /// app's advance a character), else the automatic format; returns how
    /// many of each it drew.
    fn check_fit(&mut self) -> (usize, usize) {
        let (advance, room, column) = self.read(|table| {
            let column = table.columns[0].clone();
            (
                table.glyphs.advances.zero(),
                column.width - table.sizes().padding() - 1.0,
                column,
            )
        });
        assert!(
            table_advances_are_one(&self.read(|table| table.glyphs.advances)),
            "the test app's advances"
        );
        let (mut formatted, mut fallen_back) = (0, 0);
        for drawn in self.drawn().into_iter().filter(|drawn| drawn.column == 0) {
            let value = value(drawn.row, 0);
            let decimals = drawn.row.is_multiple_of(4).then_some(3);
            let format = column.format.as_ref().expect("formatted");
            let (text, _) = format
                .measure(&Advances::new([advance; 15]), &value, decimals)
                .expect("a float");
            if text.chars().count() as f32 * advance <= room {
                assert_eq!(drawn.text, text, "row {}", drawn.row);
                formatted += 1;
            } else {
                assert_eq!(drawn.text, shown_text(&column, value), "row {}", drawn.row);
                fallen_back += 1;
            }
        }
        (formatted, fallen_back)
    }
}

fn table_advances_are_one(advances: &Advances) -> bool {
    FORMAT_CHARS
        .iter()
        .all(|ch| advances.width(&ch.to_string()) == advances.zero())
}

#[gpui_kit::test]
fn a_formatted_column_draws_its_decimals_and_the_pages(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, true);
    // The column's 2: a tie to even, and a dressed value's zero kept.
    assert_eq!(sheet.text(1, 0), "+1.12");
    assert_eq!(sheet.text(2, 0), "+2.50");
    // The page's 3 on every fourth row.
    assert_eq!(sheet.text(0, 0), "+0.500");
    assert_eq!(sheet.text(4, 0), "+4.500");
    // Too wide formatted: the automatic format at the column's budget.
    let wide = sheet.text(WIDE_ROW, 0);
    assert_eq!(wide, "123456789.12");
    // An integer's text grouped; the unformatted float and the text column
    // as the base draws them.
    assert_eq!(sheet.text(3, 1), "1,000,003");
    assert_eq!(sheet.text(1, 2), "1.125");
    assert_eq!(sheet.text(1, 3), "1000");
    assert_eq!(sheet.check_fit(), (11, 1));
}

#[gpui_kit::test]
fn the_tooltip_opens_for_a_rounded_or_fallen_back_cell(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, true);
    for (row, column, open, why) in [
        (1, 0, true, "rounded: 1.125 at 2"),
        (WIDE_ROW, 0, true, "fallen back, rounded"),
        (2, 0, false, "only dressed: +2.50"),
        (4, 0, false, "only dressed at the page's 3: +4.500"),
        (3, 1, false, "an integer only grouped"),
    ] {
        let at = sheet.at(column, row);
        assert_eq!(sheet.read(|table| table.cell_at(at)), Some((row, column)));
        assert_eq!(sheet.tooltip_at(at), open, "row {row}: {why}");
    }
}

#[gpui_kit::test]
fn the_feature_on_with_no_format_draws_as_the_base(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, false);
    let columns = sheet.read(|table| table.columns.clone());
    let drawn = sheet.drawn();
    assert!(drawn.len() > 30);
    for cell in drawn {
        let column = &columns[cell.column];
        assert!(column.format.is_none());
        assert_eq!(
            cell.text,
            shown_text(column, value(cell.row, cell.column)),
            "row {}, column {}",
            cell.row,
            cell.column
        );
    }
}

/// A set format reaches the drawing through `set_columns`, its suffix
/// shaped before the frame that draws it.
#[gpui_kit::test]
fn set_columns_formats_and_measures_a_new_suffix(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, false);
    sheet.update(|table, cx| {
        let mut columns = columns(true);
        columns[2] = TallTableColumn::new("g", ColumnKind::Float)
            .format(NumberFormat::new().decimals(1).suffix(" pt"));
        table.set_columns(columns, cx);
    });
    assert_eq!(sheet.text(2, 2), "2.5 pt");
    let suffix = sheet.read(|table| {
        table.columns[2]
            .format
            .as_ref()
            .map(|format| format.suffix_px)
    });
    // Shaped after a digit, less the digit: 3 characters at 0.6 em.
    let suffix = suffix.expect("formatted");
    assert!((suffix - 3.0 * 8.4).abs() < 1e-3, "\" pt\": {suffix}");
}

#[cfg(feature = "resize")]
#[gpui_kit::test]
fn a_fit_measures_the_formatted_text(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, true);
    assert_eq!(
        sheet.text(WIDE_ROW, 0),
        "123456789.12",
        "falls back at 120 px"
    );
    let table = sheet.table.clone();
    let widths = sheet.cx.update(|window, cx| {
        table.update(cx, |table, cx| {
            table.fit_column(0, window, cx);
            table.columns[0].width
        })
    });
    sheet.draw();
    // `+123,456,789.12`'s advances (15 at the test app's 8.4, read as a
    // hair over), the padding, and the pixel, rounded up.
    let advances = sheet.read(|table| table.glyphs.advances);
    assert_eq!(
        widths,
        (advances.width("+123,456,789.12") + 16.0 + 1.0).ceil()
    );
    assert_eq!(
        sheet.text(WIDE_ROW, 0),
        "+123,456,789.12",
        "fits right after"
    );
}

#[cfg(feature = "density")]
#[gpui_kit::test]
fn the_fit_follows_the_text_in_effect(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, true);
    for text in [8.0, 24.0] {
        let density = crate::Density {
            row_height: px(text + 6.0),
            text_size: px(text).into(),
        };
        sheet.update(|table, cx| table.set_density(density, cx));
        let advance = sheet.read(|table| table.glyphs.advances.zero());
        assert_eq!(advance, 0.6 * text, "read at {text} px");
        let (formatted, fallen_back) = sheet.check_fit();
        assert!(formatted > 0 && fallen_back > 0, "both at {text} px");
    }
}

/// At a narrow set width, a text a character too wide falls back where one
/// that fits stays formatted.
#[cfg(any(feature = "resize", feature = "density"))]
#[gpui_kit::test]
fn a_narrow_set_width_falls_back(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, true);
    sheet.update(|table, cx| {
        let mut columns = columns(true);
        columns[0] = columns[0].clone().width(px(60.));
        table.set_columns(columns, cx);
    });
    // 43 px of room: `+1.12` is 42, `+0.500` 50.4.
    assert_eq!(sheet.text(1, 0), "+1.12");
    assert_eq!(
        sheet.text(0, 0),
        "0.5",
        "the automatic format at 5 characters"
    );
    assert_eq!(sheet.text(10, 0), "10.5");
    let (formatted, fallen_back) = sheet.check_fit();
    assert!(formatted > 0 && fallen_back > 0);
}

/// A suffix's line break shows as `¶`, as a cell's does: a cell is one line
/// (`shape_line` asserts it).
#[test]
fn a_suffix_is_one_line() {
    assert_eq!(NumberFormat::new().suffix("%\n").suffix.as_ref(), "%¶");
    assert_eq!(
        NumberFormat::new().suffix("a\r\nb\rc").suffix.as_ref(),
        "a¶b¶c"
    );
    assert_eq!(NumberFormat::new().suffix(" pt").suffix.as_ref(), " pt");
}

/// A format writes a float's value only in a float column, and an
/// integer's or decimal's text only in theirs: a float answered for an
/// integer column shows as the base draws it.
#[test]
fn a_value_of_another_kind_is_unformatted() {
    let advances = Advances::new([8.4; 15]);
    let format = |float| ColumnFormat {
        format: NumberFormat::new().decimals(2).grouping(true),
        float,
        suffix_px: 0.0,
        control: Control::None,
    };
    let float = CellValue::Float(1234.5);
    let text = CellValue::Text("1234".into());
    assert_eq!(
        format(true).fit(&advances, 200.0, &float, None).as_deref(),
        Some("1,234.50")
    );
    assert_eq!(format(false).fit(&advances, 200.0, &float, None), None);
    assert_eq!(
        format(false).fit(&advances, 200.0, &text, None).as_deref(),
        Some("1,234")
    );
    assert_eq!(format(true).fit(&advances, 200.0, &text, None), None);
    // Near 1e300, its whole digits alone can't fit: never written out by
    // a fit (`resize`'s measure still writes it).
    let huge = CellValue::Float(1e300);
    assert_eq!(format(true).fit(&advances, 1200.0, &huge, None), None);
    assert!(format(true).measure(&advances, &huge, None).is_some());
}
