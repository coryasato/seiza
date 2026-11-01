//! `density`: `fixtures/density.json` run against the table's own lengths
//! (`Sizes`) and layout (`layout_columns`), with its negative controls; and
//! the density set and drawn in a window of GPUI's test app, over rows
//! answered from memory: the rows in view and the top row, following, the
//! header, the gutter, the hit test and the tooltip, the clamp, the default
//! at another rem, a set width, and with `resize`, `sort`, and `select`
//! what each does at a short row. The test app gives every character
//! 0.6 em.

use std::cell::RefCell;
use std::ops::Range;
use std::rc::Rc;
use std::time::Duration;

use gpui_kit::{
    AbsoluteLength, App, AppContext as _, Modifiers, Pixels, Point, TestAppContext,
    VisualTestContext, point, px, rems, size,
};
use serde_json::Value;

use super::super::{Paging, TallTableEvent, TallTableState};
use crate::column::{ColumnKind, TallTableColumn, layout_columns};
use crate::delegate::{CellValue, PageLoad, TallTableDelegate, TallTablePage};
use crate::density::{Control, Density, Sizes};

const DENSITY: &str = include_str!("../../../fixtures/density.json");

// --- density.json ---

fn column(spec: &Value) -> TallTableColumn {
    let name = spec["name"].as_str().expect("name");
    let kind = match spec["kind"].as_str().expect("kind") {
        "float" => ColumnKind::Float,
        "text" => ColumnKind::Text,
        "boolean" => ColumnKind::Boolean,
        "integer" => ColumnKind::Integer {
            max_chars: spec["max_chars"].as_u64().expect("max_chars") as u8,
        },
        kind => panic!("a kind the fixture doesn't use: {kind}"),
    };
    let column = TallTableColumn::new(name, kind);
    match spec["width"].as_f64() {
        Some(width) => column.width(px(width as f32)),
        None => column,
    }
}

fn density_of(case: &Value) -> Density {
    let text = &case["text"];
    let text_size: AbsoluteLength = match (text["px"].as_f64(), text["rems"].as_f64()) {
        (Some(size), None) => px(size as f32).into(),
        (None, Some(size)) => rems(size as f32).into(),
        _ => panic!("a text in px or rems"),
    };
    Density {
        row_height: px(case["row_height"].as_f64().expect("row_height") as f32),
        text_size,
    }
}

fn control_of(name: Option<&str>) -> Control {
    match name {
        None => Control::None,
        Some("row-unclamped") => Control::RowUnclamped,
        Some("padding-fixed") => Control::PaddingFixed,
        Some("width-scaled") => Control::WidthScaled,
        Some("inset-fixed") => Control::InsetFixed,
        Some("scale-over-default-at-rem") => Control::ScaleOverDefaultAtRem,
        Some("scale-over-14-for-rems") => Control::ScaleOver14ForRems,
        Some("name-rounded-per-character") => Control::NameRoundedPerCharacter,
        Some("least-fixed") => Control::LeastFixed,
        Some(control) => panic!("a control the test doesn't know: {control}"),
    }
}

/// What the fixture's cases expect that the lengths don't give, under
/// `control` (one of its `controls`, or none).
fn mismatches(control: Option<&str>) -> Vec<String> {
    let fixture: Value = serde_json::from_str(DENSITY).expect("density.json");
    let columns: Vec<TallTableColumn> = fixture["columns"]
        .as_array()
        .expect("columns")
        .iter()
        .map(column)
        .collect();
    let mut mismatches = Vec::new();
    for case in fixture["cases"].as_array().expect("cases") {
        let name = case["name"].as_str().expect("name");
        let rem = px(case["rem"].as_f64().expect("rem") as f32);
        let sizes = Sizes::resolve_with(density_of(case), rem, control_of(control));
        let number_px = case["number_px"].as_f64().expect("number_px") as f32;
        let (laid_out, _) = layout_columns(
            &columns,
            number_px,
            #[cfg(feature = "sort")]
            0.0,
            sizes,
        );
        let view_height = case["view_height"].as_f64().expect("view_height") as f32;
        let rows = case["rows"].as_u64().expect("rows");
        let row = f32::from(sizes.row());
        // The table's own sums: `fit_viewport`'s rows, `gutter_width`'s.
        let got = [
            ("text_px", f32::from(sizes.text(rem))),
            ("row_height", row),
            ("header_height", row),
            ("viewport_rows", view_height / row),
            ("padding", sizes.padding() / 2.0),
            (
                "gutter",
                sizes.estimate(super::super::format_count(rows).len() as f32),
            ),
            ("bar_inset", sizes.inset()),
        ];
        let expect = &case["expect"];
        let number = |value: &Value| value.as_f64().expect("a number") as f32;
        for (what, got) in got {
            let want = number(&expect[what]);
            if (got - want).abs() > 1e-3 {
                mismatches.push(format!("{name}: {what} {got}; the fixture's {want}"));
            }
        }
        let wants = expect["columns"].as_array().expect("columns");
        if wants.len() != laid_out.len() {
            mismatches.push(format!(
                "{name}: {} columns laid out; the fixture expects {}",
                laid_out.len(),
                wants.len()
            ));
        }
        for (index, (laid_out, want)) in laid_out.iter().zip(wants).enumerate() {
            if (laid_out.width - number(&want["width"])).abs() > 1e-3 {
                mismatches.push(format!(
                    "{name}: column {index}'s width {}; the fixture's {}",
                    laid_out.width, want["width"]
                ));
            }
            if let Some(budget) = want["budget"].as_u64()
                && laid_out.budget as u64 != budget
            {
                mismatches.push(format!(
                    "{name}: column {index}'s budget {}; the fixture's {budget}",
                    laid_out.budget
                ));
            }
        }
    }
    mismatches
}

#[test]
fn density_fixture() {
    let mismatches = mismatches(None);
    assert!(mismatches.is_empty(), "{}", mismatches.join("\n"));
}

#[test]
fn density_controls_fail() {
    let fixture: Value = serde_json::from_str(DENSITY).expect("density.json");
    let controls = fixture["controls"].as_array().expect("controls");
    assert_eq!(controls.len(), 8);
    for control in controls {
        let control = control.as_str().expect("a control");
        assert!(
            !mismatches(Some(control)).is_empty(),
            "the {control} control passed the density fixture"
        );
    }
}

/// The fixture's `number_px`, pinned from the bare host in Chromium
/// (`just tall-table density-fixture`), is 0.6 em at each case's size, the
/// test app's advance too: so the tests in a window lay out as the fixture
/// does. A pin that moves off it fails here first.
#[test]
fn density_fixture_number_px_is_the_test_apps() {
    let fixture: Value = serde_json::from_str(DENSITY).expect("density.json");
    for case in fixture["cases"].as_array().expect("cases") {
        let rem = px(case["rem"].as_f64().expect("rem") as f32);
        let text = f32::from(Sizes::resolve(density_of(case), rem).text(rem));
        let number_px = case["number_px"].as_f64().expect("number_px") as f32;
        assert!((number_px - 0.6 * text).abs() < 1e-3, "{case}");
    }
}

// --- in a window ---

/// Column 0's text at row `row`: `row % 20 + 1` characters, so a row's text
/// is as long as a test needs; every other column a whole float.
fn value(row: u64, column: usize) -> CellValue<'static> {
    if column == 0 {
        CellValue::Text("x".repeat(row as usize % 20 + 1).into())
    } else {
        CellValue::Float(row as f64)
    }
}

/// Rows from memory, answered when asked, each read's rows logged; every
/// sort accepted (`sort`).
struct Memory {
    reads: Rc<RefCell<Vec<Range<u64>>>>,
}

struct Rows {
    rows: Range<u64>,
}

impl TallTablePage for Rows {
    fn value(&self, row: usize, column: usize) -> Option<CellValue<'_>> {
        Some(value(self.rows.start + row as u64, column))
    }

    fn heap_bytes(&self) -> usize {
        1024
    }

    #[cfg(feature = "custom-cells")]
    fn paint(&self, _: usize, _: usize) -> crate::CellPaint {
        crate::CellPaint::default()
    }
}

impl TallTableDelegate for Memory {
    type Page = Rows;
    type Request = u64;

    fn load_page(&mut self, rows: Range<u64>, _: &mut App) -> (u64, PageLoad<Rows>) {
        self.reads.borrow_mut().push(rows.clone());
        (rows.start, Box::pin(std::future::ready(Ok(Rows { rows }))))
    }

    fn cancel(&mut self, _: u64, _: &mut App) {}

    #[cfg(feature = "sort")]
    fn sort(&mut self, _: Option<crate::Sort>, _: &mut App) -> Result<(), crate::SortRefused> {
        Ok(())
    }
}

/// A text column (`t`) and four floats (`f1`..`f4`), sortable with `sort`.
fn columns() -> Vec<TallTableColumn> {
    std::iter::once(TallTableColumn::new("t", ColumnKind::Text))
        .chain((1..5).map(|index| TallTableColumn::new(format!("f{index}"), ColumnKind::Float)))
        .map(column_sortable)
        .collect()
}

/// `column`, sortable with `sort`.
fn column_sortable(column: TallTableColumn) -> TallTableColumn {
    #[cfg(feature = "sort")]
    let column = column.sortable(true);
    column
}

type Table = TallTableState<Memory>;

/// The window's view: the table, subscribed to as it's made.
struct Shell {
    table: gpui_kit::Entity<Table>,
    _subscription: gpui_kit::Subscription,
}

impl gpui_kit::Render for Shell {
    fn render(
        &mut self,
        _: &mut gpui_kit::Window,
        _: &mut gpui_kit::Context<Self>,
    ) -> impl gpui_kit::IntoElement {
        use gpui_kit::{ParentElement as _, Styled as _};
        gpui_kit::div().size_full().child(self.table.clone())
    }
}

/// A table in a 1440×900 window over `rows` rows from memory, with the
/// layout probe's last row height and the reads sent.
struct Sheet<'a> {
    cx: &'a mut VisualTestContext,
    table: gpui_kit::Entity<Table>,
    row_height: Rc<RefCell<Option<f32>>>,
    reads: Rc<RefCell<Vec<Range<u64>>>>,
}

impl<'a> Sheet<'a> {
    fn open(cx: &'a mut TestAppContext, rows: u64, rem: f32) -> Self {
        cx.update(|cx| {
            gpui_kit::component::init(cx);
            crate::init(cx);
        });
        let reads: Rc<RefCell<Vec<Range<u64>>>> = Rc::default();
        let row_height: Rc<RefCell<Option<f32>>> = Rc::default();
        let (sent, heard) = (reads.clone(), row_height.clone());
        let (shell, cx) = cx.add_window_view(move |window, cx| {
            window.set_rem_size(px(rem));
            let paging = Paging {
                prefetch: 0,
                ..Paging::default()
            };
            let table = cx.new(|cx| {
                TallTableState::new(Memory { reads: sent }, columns(), rows, paging, cx)
                    .probe_frames(true)
            });
            let subscription = cx.subscribe(&table, move |_, _, event: &TallTableEvent, _| {
                if let TallTableEvent::Layout(layout) = event {
                    *heard.borrow_mut() = Some(layout.row_height);
                }
            });
            Shell {
                table,
                _subscription: subscription,
            }
        });
        let table = shell.read_with(cx, |shell, _| shell.table.clone());
        cx.simulate_resize(size(px(1440.), px(900.)));
        let mut sheet = Self {
            cx,
            table,
            row_height,
            reads,
        };
        sheet.draw();
        sheet
    }

    /// Runs what can run, then draws a frame (twice: the body is measured
    /// in the first).
    fn draw(&mut self) {
        for _ in 0..2 {
            self.cx.run_until_parked();
            self.cx.update(|window, cx| window.draw(cx).clear(cx));
        }
    }

    fn read<T>(&mut self, read: impl FnOnce(&Table) -> T) -> T {
        self.table.read_with(self.cx, |table, _| read(table))
    }

    /// `update`, without drawing after.
    fn now<T>(&mut self, update: impl FnOnce(&mut Table, &mut gpui_kit::Context<Table>) -> T) -> T {
        self.table.update(self.cx, update)
    }

    fn update<T>(
        &mut self,
        update: impl FnOnce(&mut Table, &mut gpui_kit::Context<Table>) -> T,
    ) -> T {
        let result = self.now(update);
        self.draw();
        result
    }

    fn set(&mut self, row: f32, text: impl Into<AbsoluteLength>) {
        let density = Density {
            row_height: px(row),
            text_size: text.into(),
        };
        self.update(|table, cx| table.set_density(density, cx));
    }

    /// A point on row `row` of the view, `x` px right of the cells' left.
    fn at(&mut self, x: f32, row: f32) -> Point<Pixels> {
        let (origin, gutter, row_h) =
            self.read(|table| (table.body.origin, table.gutter_width(), table.sizes().row()));
        origin + point(px(gutter + x), row_h * (row + 0.5))
    }

    /// Whether a rested pointer at `at` shows a tooltip.
    fn tooltip_at(&mut self, at: Point<Pixels>) -> bool {
        // Away first, so the cell is a new one and its delay runs.
        let away = self.at(1200., 0.);
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
}

#[gpui_kit::test]
fn set_density_keeps_the_top_row_and_changes_the_rows_in_view(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, 100_000, 16.);
    sheet.update(|table, cx| table.move_top_to(5000.0, cx));
    let (rows_before, visible) =
        sheet.read(|table| (table.scroll.viewport_rows(), table.scroll.visible()));
    assert!(visible.end <= 5120, "page 4 alone in view: {visible:?}");
    sheet.reads.borrow_mut().clear();

    // Fitted by `set_density` itself, before a frame: the header's height,
    // and so the body's bounds, haven't moved yet.
    let density = Density {
        row_height: px(6.),
        text_size: px(6.).into(),
    };
    let (rows, height) = sheet.now(|table, cx| {
        table.set_density(density, cx);
        (
            table.scroll.viewport_rows(),
            f32::from(table.viewport().height),
        )
    });
    assert_eq!(rows, f64::from(height / 6.0), "the rows at the new height");
    assert!(rows > 4.0 * rows_before);
    assert_eq!(
        sheet.read(|table| table.scroll.top()),
        5000.0,
        "the top kept"
    );
    sheet.draw();
    assert_eq!(sheet.read(|table| table.scroll.top()), 5000.0);
    assert!(
        sheet.reads.borrow().contains(&(5120..6144)),
        "the page come into view read: {:?}",
        sheet.reads.borrow()
    );
    // Drawn: the header follows the row, so the body moved up and the view
    // fitted again.
    let (origin, rows) = sheet.read(|table| (table.body.origin.y, table.scroll.viewport_rows()));
    assert_eq!(origin, px(6.), "the header is a row high");
    assert_eq!(
        rows,
        f64::from(sheet.read(|table| f32::from(table.viewport().height)) / 6.0)
    );
}

#[cfg(feature = "follow")]
#[gpui_kit::test]
fn following_keeps_the_tail_and_weighs_a_move_at_the_row(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, 1000, 16.);
    sheet.update(|table, cx| table.follow(cx));
    sheet.set(10., px(8.));
    let (top, max, following) = sheet.read(|table| {
        (
            table.scroll.top(),
            table.scroll.max_top(),
            table.is_following(),
        )
    });
    assert!(following);
    assert_eq!(top, max, "the bottom at the end");

    // A row's 10 px down against 20 sideways: mostly sideways, so following
    // stays; at 30 px rows the same move is vertical and lets go.
    sheet.update(|table, cx| table.scroll_by(-1.0, 20.0, cx));
    assert!(sheet.read(|table| table.is_following()), "a sideways move");
    sheet.update(|table, cx| table.follow(cx));
    sheet.set(30., rems(0.875));
    sheet.update(|table, cx| table.scroll_by(-1.0, 20.0, cx));
    assert!(!sheet.read(|table| table.is_following()), "a vertical move");
}

#[gpui_kit::test]
fn a_short_row_draws_and_hits_at_its_height(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, 1000, 16.);
    sheet.set(12., px(8.));
    let sizes = sheet.read(|table| table.sizes());
    assert_eq!(sizes.row(), px(12.));
    assert_eq!(*sheet.row_height.borrow(), Some(12.0), "the probe's row");
    assert_eq!(
        sheet.read(|table| table.body.origin.y),
        px(12.),
        "the header"
    );
    // The gutter's estimate scaled: 1,000's 61.5 px at 8/14.
    assert_eq!(sheet.read(|table| table.gutter_width()), 35.0);
    assert_eq!(sheet.read(|table| table.glyphs.font_size), px(8.));
    // A hit three and a half rows down is row 3.
    let at = sheet.at(10., 3.0);
    assert_eq!(sheet.read(|table| table.cell_at(at)), Some((3, 0)));
}

#[gpui_kit::test]
fn the_tooltip_tests_a_cut_at_the_scaled_padding(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, 1000, 16.);
    // At 8 px text a character is 4.8 px, the padding 5 a side: a 60 px
    // column holds 50 px, 10 characters whole and 11 cut (at the base's 16
    // px of padding, 10 would be cut).
    sheet.set(12., px(8.));
    sheet.update(|table, cx| {
        let mut columns = columns();
        columns[0] = TallTableColumn::new("t", ColumnKind::Text).width(px(60.));
        table.set_columns(columns, cx);
    });
    for (row, cut) in [(9, false), (10, true)] {
        let at = sheet.at(30., row as f32);
        assert_eq!(sheet.read(|table| table.cell_at(at)), Some((row, 0)));
        assert_eq!(sheet.tooltip_at(at), cut, "row {row}, at 8 px");
    }
    // At 24 px text a character is 14.4 px, the padding 14 a side: a 200 px
    // column holds 172, 11 characters whole and 12 cut (at 16 px of padding,
    // 12 would show whole).
    sheet.set(30., px(24.));
    sheet.update(|table, cx| {
        let mut columns = columns();
        columns[0] = TallTableColumn::new("t", ColumnKind::Text).width(px(200.));
        table.set_columns(columns, cx);
    });
    for (row, cut) in [(10, false), (11, true)] {
        let at = sheet.at(100., row as f32);
        assert_eq!(sheet.tooltip_at(at), cut, "row {row}, at 24 px");
    }
}

#[gpui_kit::test]
fn the_clamp(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, 1000, 16.);
    let under = Density {
        row_height: px(4.),
        text_size: px(12.).into(),
    };
    sheet.update(|table, cx| table.set_density(under, cx));
    assert_eq!(sheet.read(|table| table.density()), under, "as set");
    assert_eq!(sheet.read(|table| table.sizes().row()), px(12.));
    assert_eq!(
        *sheet.row_height.borrow(),
        Some(12.0),
        "the probe's, in effect"
    );
    sheet.set(4., px(3.));
    assert_eq!(sheet.read(|table| table.glyphs.font_size), px(6.));
    assert_eq!(sheet.read(|table| table.sizes().row()), px(6.));
    // A loading cell's bar inside the 6 px row's 1 px insets.
    assert_eq!(sheet.read(|table| table.sizes().skeleton()), 4.0);
    sheet.set(30., rems(0.875));
    assert_eq!(
        sheet.read(|table| table.sizes().skeleton()),
        8.0,
        "the base's"
    );
}

/// A new text size lays the columns out once, by the font read at it: not
/// first by the old font's advances.
#[gpui_kit::test]
fn a_new_text_lays_out_once_by_its_font(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, 1000, 16.);
    let generation = sheet.read(|table| table.layout_generation);
    let density = Density {
        row_height: px(18.),
        text_size: px(11.).into(),
    };
    let laid_out = sheet.now(|table, cx| {
        table.set_density(density, cx);
        table.layout_generation
    });
    assert_eq!(laid_out, generation, "not laid out by the old font");
    sheet.draw();
    let (generation_now, font_size, budget) = sheet.read(|table| {
        (
            table.layout_generation,
            table.glyphs.font_size,
            table.columns[1].budget,
        )
    });
    assert_eq!(generation_now, generation + 1, "laid out once");
    assert_eq!(font_size, px(11.));
    // A float's 94 px at 11 px text, 6 px of padding a side, 6.6 px a
    // character: 12.
    assert_eq!(budget, 12);
    // A row alone moves no font: laid out now.
    sheet.set(24., px(11.));
    assert_eq!(sheet.read(|table| table.layout_generation), generation + 2);
}

/// A rem size that moves the row fits the viewport's rows before the frame
/// it's drawn in.
#[gpui_kit::test]
fn a_new_rem_fits_the_rows_in_its_frame(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, 1000, 20.);
    // The row clamped up to the text: 17.5 px at a 20 px rem.
    sheet.set(10., rems(0.875));
    assert_eq!(sheet.read(|table| table.sizes().row()), px(17.5));
    sheet.cx.update(|window, _| window.set_rem_size(px(16.)));
    // One frame drawn, nothing run after it.
    sheet.cx.update(|window, cx| window.draw(cx).clear(cx));
    let (row, rows, height) = sheet.read(|table| {
        (
            table.sizes().row(),
            table.scroll.viewport_rows(),
            f32::from(table.viewport().height),
        )
    });
    assert_eq!(row, px(14.));
    assert_eq!(rows, f64::from(height / 14.0), "fitted in the frame");
}

/// `Density::default()` lays out as without the feature, at the web's rem
/// and at another: the base's widths, padding, gutter, and inset, the
/// budgets at the font's size there.
#[gpui_kit::test]
fn the_default_is_the_base_at_any_rem(cx: &mut TestAppContext) {
    for (rem, budget) in [(16., 12), (20., 9)] {
        let mut sheet = Sheet::open(cx, 1000, rem);
        let (sizes, columns, gutter) = sheet.read(|table| {
            let columns: Vec<(f32, usize)> = table
                .columns
                .iter()
                .map(|column| (column.width, column.budget))
                .collect();
            (table.sizes(), columns, table.gutter_width())
        });
        assert_eq!(sizes.text(px(rem)), px(0.875 * rem));
        assert_eq!(sizes.row(), px(30.));
        assert_eq!(sizes.padding(), 16.0);
        assert_eq!(sizes.inset(), 6.0);
        assert_eq!(gutter, 61.5, "unrounded, as the base's");
        assert_eq!(columns[0].0, 200.0);
        assert_eq!(&columns[1..], &[(120.0, budget); 4], "at {rem} px");
    }
}

#[gpui_kit::test]
fn a_set_width_is_clamped_and_not_scaled(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, 1000, 16.);
    sheet.set(12., px(8.));
    sheet.update(|table, cx| {
        let columns = vec![
            TallTableColumn::new("a", ColumnKind::Float).width(px(10.)),
            TallTableColumn::new("b", ColumnKind::Float).width(px(56.)),
            TallTableColumn::new("c", ColumnKind::Float).width(px(5000.)),
            TallTableColumn::new("d", ColumnKind::Float),
        ];
        table.set_columns(columns, cx);
    });
    let widths: Vec<f32> =
        sheet.read(|table| table.columns.iter().map(|column| column.width).collect());
    // The least 40 px scaled (23), the host's 56 as set, the most 1200; a
    // kind's 120 scaled (69).
    assert_eq!(widths, vec![23.0, 56.0, 1200.0, 69.0]);
}

/// With `resize`, a drag and a fit at a small text: the fit shapes at the
/// text's size and counts the scaled padding.
#[cfg(feature = "resize")]
#[gpui_kit::test]
fn resize_drags_and_fits_at_the_text(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, 1000, 16.);
    sheet.set(12., px(8.));
    let x = sheet.read(|table| table.body.origin.x + px(table.gutter_width()));
    let edge = x + px(sheet.read(|table| table.columns[1].width + table.columns[1].x));
    sheet.cx.update(|window, cx| {
        sheet
            .table
            .update(cx, |table, cx| table.press_band(1, edge, 1, window, cx));
    });
    sheet.update(|table, cx| table.resize_to(edge + px(30.), cx));
    sheet.update(|table, cx| table.end_resize(cx));
    assert_eq!(sheet.read(|table| table.columns[1].width), 69.0 + 30.0);
    // The text column's widest visible value, 20 characters shaped at 8 px
    // (4.8 each, about 96), with 5 px of padding a side and the pixel's
    // slack, rounded up.
    let shaped = sheet.cx.update(|window, cx| {
        sheet
            .table
            .read(cx)
            .text_width("x".repeat(20).into(), window)
    });
    assert!((shaped - 96.0).abs() < 0.01, "shaped at 8 px: {shaped}");
    let edge = x + px(sheet.read(|table| table.columns[0].width));
    sheet.cx.update(|window, cx| {
        sheet
            .table
            .update(cx, |table, cx| table.press_band(0, edge, 2, window, cx));
    });
    sheet.draw();
    assert_eq!(
        sheet.read(|table| table.columns[0].width),
        (shaped + 10.0 + 1.0).ceil()
    );
}

#[cfg(feature = "sort")]
#[gpui_kit::test]
fn sort_arrows_at_a_short_row(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, 1000, 16.);
    sheet.set(12., px(8.));
    let drawn = sheet.read(|table| table.sort_state.drawn.clone());
    assert!(!drawn.is_empty());
    for arrow in drawn {
        assert_eq!(arrow.target.size.height, px(12.), "a row high");
        assert_eq!(arrow.target.origin.y, px(0.), "in the header");
    }
}

#[cfg(feature = "select")]
#[gpui_kit::test]
fn the_tint_at_a_short_row(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, 1000, 16.);
    sheet.set(12., px(8.));
    sheet.update(|table, cx| {
        table.select(
            Some(crate::TallTableSelection::Cells {
                anchor: (2, 1),
                head: (3, 1),
            }),
            cx,
        )
    });
    let tint = sheet
        .read(|table| table.selection_state.drawn.tint)
        .expect("a tint");
    assert_eq!(tint.origin.y, px(24.));
    assert_eq!(tint.size.height, px(24.), "two rows of 12");
}
