//! `resize`: `cells.json`'s `number_px` and `resize` section (widths →
//! budgets → the text shown), with its controls, and the bands, the drag,
//! and the fit driven by the pointer in a window of GPUI's test app, over
//! rows answered from memory as they're asked for.

use std::cell::{Cell, RefCell};
use std::ops::Range;
use std::rc::Rc;
use std::time::Duration;

use gpui_kit::{
    App, Entity, Modifiers, MouseButton, MouseDownEvent, Pixels, Point, TestAppContext,
    VisualTestContext, point, px, size,
};
use serde_json::Value;

use super::super::{TallTableEvent, TallTableState, row_height, shown_text};
use super::CELLS;
use crate::column::{ColumnKind, TallTableColumn, digits_width, layout_columns};
use crate::delegate::{CellValue, PageLoad, TallTableDelegate, TallTablePage};
use crate::pages::RowState;

// --- cells.json ---

/// The fixture's `resize` widths and cells that the table's layout and
/// text don't give, with each set width's column built by `column` and
/// each budget plus `skew`.
fn resize_mismatches(skew: isize, column: fn(f32) -> TallTableColumn) -> Vec<String> {
    let fixture: Value = serde_json::from_str(CELLS).expect("cells.json");
    let number_px = fixture["number_px"].as_f64().expect("number_px") as f32;
    let resize = &fixture["resize"];
    assert_eq!(resize["min_width"], 40, "the fixture's min is the default");
    assert_eq!(
        resize["max_width"], 1200,
        "the fixture's max is the default"
    );
    let laid_out = |set: f32| {
        let (mut columns, _) = layout_columns(&[column(set)], number_px);
        let mut column = columns.remove(0);
        column.budget = (column.budget as isize + skew).max(1) as usize;
        column
    };
    let mut mismatches = Vec::new();
    for case in resize["widths"].as_array().expect("widths") {
        let set = case["set"].as_f64().expect("set") as f32;
        let column = laid_out(set);
        if f64::from(column.width) != case["width"].as_f64().expect("width")
            || column.budget as u64 != case["budget"].as_u64().expect("budget")
        {
            mismatches.push(format!(
                "set {set}: width {}, budget {}; the fixture's {} {}",
                column.width, column.budget, case["width"], case["budget"]
            ));
        }
    }
    for case in resize["cells"].as_array().expect("cells") {
        let set = case["set"].as_f64().expect("set") as f32;
        let text = case["value"].as_str().expect("value");
        let value = CellValue::Float(text.parse().expect("a float"));
        let exact = value.to_string();
        let shown = shown_text(&laid_out(set), value);
        if exact != case["exact"] || shown != case["shown"] {
            mismatches.push(format!(
                "{text} at {set}: exact {exact:?}, shown {shown:?}; the fixture's {} {}",
                case["exact"], case["shown"]
            ));
        }
    }
    mismatches
}

fn float_at(width: f32) -> TallTableColumn {
    TallTableColumn::new("value", ColumnKind::Float).width(px(width))
}

#[test]
fn resize_fixture() {
    let mismatches = resize_mismatches(0, float_at);
    assert!(mismatches.is_empty(), "{mismatches:#?}");
}

/// `number_px` is the advance the GPUI contender's budgets were laid out
/// at: each listed column's budget is the table's rule at it.
#[test]
fn resize_fixture_number_px_gives_the_budgets() {
    let fixture: Value = serde_json::from_str(CELLS).expect("cells.json");
    let number_px = fixture["number_px"].as_f64().expect("number_px") as f32;
    for column in fixture["columns"].as_array().expect("columns") {
        let width = column["width"].as_f64().expect("width") as f32;
        let (laid_out, _) = layout_columns(&[float_at(width)], number_px);
        assert_eq!(
            laid_out[0].budget as u64,
            column["budget"].as_u64().expect("budget"),
            "{}: number_px {number_px} at {width} px",
            column["name"]
        );
    }
}

#[test]
fn resize_controls_fail() {
    for skew in [-1, 1] {
        assert!(
            !resize_mismatches(skew, float_at).is_empty(),
            "a budget {skew:+} passed the resize fixture"
        );
    }
    let unclamped = |width: f32| {
        float_at(width)
            .min_width(px(0.))
            .max_width(px(f32::INFINITY))
    };
    assert!(
        !resize_mismatches(0, unclamped).is_empty(),
        "widths laid out without the clamps passed the resize fixture"
    );
}

// --- the width model ---

#[test]
fn a_kind_width_until_set() {
    let width = |column: TallTableColumn| layout_columns(&[column], 8.4).0[0].width;
    // A kind's width isn't clamped: a one-character integer column stays
    // under the min, at its name's estimated width.
    let narrow = TallTableColumn::new("i", ColumnKind::Integer { max_chars: 1 });
    assert_eq!(width(narrow.clone()), 31.5);
    assert_eq!(width(narrow.clone().width(px(10.))), 40.0, "the min");
    assert_eq!(width(narrow.width(px(5000.))), 1200.0, "the max");
    // A set width may be narrower than the name's estimate (159 px).
    let named = TallTableColumn::new("a long column name", ColumnKind::Float);
    assert_eq!(width(named.clone()), 159.0);
    assert_eq!(width(named.width(px(60.))), 60.0);
    let float = TallTableColumn::new("f", ColumnKind::Float);
    assert_eq!(width(float.clone().min_width(px(80.)).width(px(50.))), 80.0);
    assert_eq!(width(float.max_width(px(100.)).width(px(300.))), 100.0);
}

// --- in a window ---

/// A cell's value by its row and column.
type Values = fn(u64, usize) -> CellValue<'static>;

/// Rows from memory, answered when asked, except those at or past `hold`,
/// whose reads never answer (pages still loading).
struct Memory {
    values: Values,
    hold: u64,
    page_rows: u64,
    loads: Rc<RefCell<Vec<u64>>>,
}

struct Rows {
    rows: Range<u64>,
    values: Values,
}

impl TallTablePage for Rows {
    fn value(&self, row: usize, column: usize) -> Option<CellValue<'_>> {
        Some((self.values)(self.rows.start + row as u64, column))
    }

    fn heap_bytes(&self) -> usize {
        1024
    }
}

impl TallTableDelegate for Memory {
    type Page = Rows;
    type Request = u64;

    fn load_page(&mut self, rows: Range<u64>, _: &mut App) -> (u64, PageLoad<Rows>) {
        let page = rows.start / self.page_rows;
        // Its id: the load's place in the log, never reused.
        let request = {
            let mut loads = self.loads.borrow_mut();
            loads.push(page);
            loads.len() as u64
        };
        if rows.start >= self.hold {
            return (request, Box::pin(std::future::pending()));
        }
        let values = self.values;
        (
            request,
            Box::pin(std::future::ready(Ok(Rows { rows, values }))),
        )
    }

    fn cancel(&mut self, _: u64, _: &mut App) {}
}

fn third(_: u64, _: usize) -> CellValue<'static> {
    CellValue::Float(1.0 / 3.0)
}

fn floats(count: usize) -> Vec<TallTableColumn> {
    (0..count)
        .map(|index| TallTableColumn::new(format!("f{index}"), ColumnKind::Float))
        .collect()
}

/// A table in a 1440×900 window over rows from memory, with the
/// `ColumnWidthsChanged` and `Layout` events it emitted, and the drawn
/// cells of its last frame.
struct Sheet<'a> {
    cx: &'a mut VisualTestContext,
    table: Entity<TallTableState<Memory>>,
    widths: Rc<RefCell<Vec<Vec<Option<Pixels>>>>>,
    layouts: Rc<Cell<usize>>,
    cells: Rc<RefCell<Vec<crate::CellProbe>>>,
    loads: Rc<RefCell<Vec<u64>>>,
    _subscription: gpui_kit::Subscription,
}

impl<'a> Sheet<'a> {
    fn open(
        cx: &'a mut TestAppContext,
        columns: Vec<TallTableColumn>,
        rows: u64,
        values: Values,
        hold: u64,
    ) -> Self {
        cx.update(gpui_kit::component::init);
        let loads: Rc<RefCell<Vec<u64>>> = Rc::default();
        let delegate = Memory {
            values,
            hold,
            page_rows: 1024,
            loads: loads.clone(),
        };
        let (table, cx) = cx.add_window_view(move |_, cx| {
            TallTableState::new(delegate, columns, rows, Default::default(), cx)
                .probe_frames(true)
                .probe_cells(true)
        });
        cx.simulate_resize(size(px(1440.), px(900.)));
        let widths: Rc<RefCell<Vec<Vec<Option<Pixels>>>>> = Rc::default();
        let layouts: Rc<Cell<usize>> = Rc::default();
        let cells: Rc<RefCell<Vec<crate::CellProbe>>> = Rc::default();
        let subscription = cx.update(|_, cx| {
            let (widths, layouts, cells) = (widths.clone(), layouts.clone(), cells.clone());
            cx.subscribe(&table, move |_, event: &TallTableEvent, _| match event {
                TallTableEvent::ColumnWidthsChanged(set) => widths.borrow_mut().push(set.clone()),
                TallTableEvent::Layout(_) => layouts.set(layouts.get() + 1),
                TallTableEvent::Cells(drawn) => *cells.borrow_mut() = drawn.clone(),
                _ => {}
            })
        });
        let mut sheet = Self {
            cx,
            table,
            widths,
            layouts,
            cells,
            loads,
            _subscription: subscription,
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

    fn read<T>(&mut self, read: impl FnOnce(&TallTableState<Memory>) -> T) -> T {
        self.table.read_with(self.cx, |table, _| read(table))
    }

    fn update<T>(
        &mut self,
        update: impl FnOnce(
            &mut TallTableState<Memory>,
            &mut gpui_kit::Context<TallTableState<Memory>>,
        ) -> T,
    ) -> T {
        let result = self.table.update(self.cx, update);
        self.draw();
        result
    }

    /// The middle of the header's row, in window pixels.
    fn header_y() -> Pixels {
        row_height() / 2.
    }

    /// Column `column`'s right edge in the header: its hairline, the band's
    /// middle.
    fn edge(&mut self, column: usize) -> Point<Pixels> {
        let x = self.read(|table| {
            let laid_out = &table.columns[column];
            table.gutter_width() + laid_out.x + laid_out.width - table.scroll_x - 0.5
        });
        point(px(x), Self::header_y())
    }

    fn press(&mut self, at: Point<Pixels>, clicks: usize) {
        self.cx.simulate_event(MouseDownEvent {
            position: at,
            modifiers: Modifiers::default(),
            button: MouseButton::Left,
            click_count: clicks,
            first_mouse: false,
        });
        self.draw();
    }

    /// The pointer moved with the button down.
    fn drag_to(&mut self, at: Point<Pixels>) {
        self.cx
            .simulate_mouse_move(at, MouseButton::Left, Modifiers::default());
        self.draw();
    }

    fn release(&mut self, at: Point<Pixels>) {
        self.cx
            .simulate_mouse_up(at, MouseButton::Left, Modifiers::default());
        self.draw();
    }

    fn double_click(&mut self, at: Point<Pixels>) {
        self.press(at, 1);
        self.release(at);
        self.press(at, 2);
        self.release(at);
    }

    fn width(&mut self, column: usize) -> f32 {
        let width = self.read(|table| table.column_width(column));
        f32::from(width.expect("a column"))
    }

    fn resizing(&mut self) -> bool {
        self.read(|table| table.resizing.is_some())
    }

    /// The text drawn in column `column`'s cells, last frame.
    fn shown(&self, column: usize) -> Vec<(String, String)> {
        self.cells
            .borrow()
            .iter()
            .filter(|cell| cell.column == column)
            .map(|cell| (cell.exact.clone(), cell.shown.clone()))
            .collect()
    }
}

#[gpui_kit::test]
fn a_drag_moves_the_edge_with_the_pointer(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, floats(3), 1000, third, u64::MAX);
    let (x0, budget0) = sheet.read(|table| (table.columns[1].x, table.columns[0].budget));
    assert_eq!((x0, budget0), (120.0, 12));
    let rounded = sheet.shown(0);
    assert!(rounded.iter().all(|(_, shown)| shown == "0.3333333333"));

    let edge = sheet.edge(0);
    sheet.press(edge, 1);
    let layouts = sheet.layouts.get();
    sheet.drag_to(edge + point(px(50.), px(0.)));
    assert_eq!(sheet.width(0), 170.0, "the press's width + the move");
    let (x1, budget) = sheet.read(|table| (table.columns[1].x, table.columns[0].budget));
    assert_eq!(x1, 170.0, "the next column moved with it");
    // (170 − 17) / 8.4: the floats re-round on the move's frame.
    let number_px = sheet.read(|table| table.glyphs.number_px);
    assert_eq!(budget, ((153.0 / number_px) as usize).max(1));
    assert!(
        sheet
            .shown(0)
            .iter()
            .all(|(exact, shown)| shown == exact && shown == "0.3333333333333333"),
        "{:?}",
        sheet.shown(0)
    );
    sheet.drag_to(edge - point(px(500.), px(0.)));
    assert_eq!(sheet.width(0), 40.0, "the min");
    sheet.drag_to(edge + point(px(5000.), px(0.)));
    assert_eq!(sheet.width(0), 1200.0, "the max");
    sheet.drag_to(edge + point(px(50.), px(0.)));
    assert!(sheet.widths.borrow().is_empty(), "no event while moving");
    assert_eq!(sheet.layouts.get(), layouts, "no layout probe while moving");

    sheet.release(edge + point(px(50.), px(0.)));
    assert!(!sheet.resizing());
    assert_eq!(
        *sheet.widths.borrow(),
        vec![vec![Some(px(170.)), None, None]],
        "one event at the release, with the set widths"
    );
    assert_eq!(sheet.layouts.get(), layouts + 1, "the layout probe, once");
    let columns = sheet.read(|table| table.columns().to_vec());
    assert_eq!(columns[0].set_width(), Some(px(170.)));
}

#[gpui_kit::test]
fn a_drag_holds_the_sideways_scroll(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, floats(30), 100_000, third, u64::MAX);
    sheet.update(|table, cx| table.scroll_by(0.0, 1e6, cx));
    let (max, thumb) = sheet.read(|table| (table.max_scroll_x(), table.horizontal_thumb()));
    assert!(max > 0.0);
    assert_eq!(sheet.read(|table| table.scroll_x), max, "at the right end");

    let edge = sheet.edge(27);
    sheet.press(edge, 1);
    sheet.drag_to(edge - point(px(80.), px(0.)));
    assert_eq!(sheet.width(27), 40.0);
    let held = sheet.read(|table| (table.scroll_x, table.horizontal_thumb()));
    assert_eq!(
        held.0, max,
        "the scroll holds though the content ends short"
    );
    assert_eq!(held.1.offset, thumb.offset, "the thumb stays at the view");
    assert_eq!(held.1.length, thumb.length);
    // A vertical wheel scrolls; sideways input is ignored.
    let top = sheet.read(|table| table.scroll.top());
    sheet.update(|table, cx| table.scroll_by(5.0, 0.0, cx));
    sheet.update(|table, cx| table.scroll_by(0.0, -100.0, cx));
    let (moved, scroll_x) = sheet.read(|table| (table.scroll.top(), table.scroll_x));
    assert_eq!((moved, scroll_x), (top + 5.0, max));

    sheet.release(edge - point(px(80.), px(0.)));
    let (scroll_x, new_max) = sheet.read(|table| (table.scroll_x, table.max_scroll_x()));
    assert_eq!(new_max, max - 80.0);
    assert_eq!(scroll_x, new_max, "the release clamps the scroll");
}

#[gpui_kit::test]
fn paging_during_a_drag_is_the_bases(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, floats(3), 1_000_000, third, u64::MAX);
    let edge = sheet.edge(0);
    sheet.press(edge, 1);
    sheet.drag_to(edge + point(px(20.), px(0.)));
    sheet.loads.borrow_mut().clear();
    // No drag settle: the wheel's page is read at once, and drawn.
    sheet.update(|table, cx| table.scroll_by(100_000.0, 0.0, cx));
    assert!(sheet.loads.borrow().contains(&(100_000 / 1024)));
    let loaded = sheet.read(|table| matches!(table.cache.row(100_001), RowState::Loaded(..)));
    assert!(loaded, "the rows a wheel reaches load as without the drag");
    sheet.release(edge + point(px(20.), px(0.)));
}

#[gpui_kit::test]
fn nothing_changed_emits_nothing(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, floats(3), 1000, third, u64::MAX);
    let edge = sheet.edge(1);
    sheet.press(edge, 1);
    sheet.release(edge);
    sheet.press(edge, 1);
    sheet.drag_to(edge + point(px(30.), px(0.)));
    sheet.drag_to(edge);
    sheet.release(edge);
    assert!(sheet.widths.borrow().is_empty());
    let columns = sheet.read(|table| table.columns().to_vec());
    assert!(columns.iter().all(|column| column.set_width().is_none()));
}

#[gpui_kit::test]
fn bands_only_at_resizable_edges(cx: &mut TestAppContext) {
    let mut columns = floats(3);
    columns[1] = columns[1].clone().resizable(false);
    let mut sheet = Sheet::open(cx, columns, 1000, third, u64::MAX);
    let gutter = sheet.read(|table| table.gutter_width());
    let edge0 = sheet.edge(0);
    let edge1 = sheet.edge(1);
    for (why, at) in [
        (
            "a header cell's middle",
            point(px(gutter + 60.), Sheet::header_y()),
        ),
        (
            "the gutter's edge",
            point(px(gutter + 0.5), Sheet::header_y()),
        ),
        ("a column with resizable(false)", edge1),
        (
            "a body row under an edge",
            point(edge0.x, row_height() * 3.),
        ),
    ] {
        sheet.press(at, 1);
        assert!(!sheet.resizing(), "{why} has no band");
        sheet.release(at);
    }
    sheet.press(edge0, 1);
    assert!(sheet.resizing(), "a resizable column's edge has one");
    sheet.release(edge0);
}

/// Row 1020 holds the widest value of the first page; rows past it are
/// wider still, but their page never loads.
fn widest_on_row_1020(row: u64, _: usize) -> CellValue<'static> {
    CellValue::Float(match row {
        1020 => 123.456789012345,
        row if row >= 1024 => 1.0 / 3.0 * 1e-10,
        _ => 1.5,
    })
}

#[gpui_kit::test]
fn a_double_click_fits_the_drawn_rows(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(
        cx,
        vec![TallTableColumn::new("f", ColumnKind::Float)],
        5000,
        widest_on_row_1020,
        1024,
    );
    // Row 1020 in view, and below it rows of a page still loading.
    sheet.update(|table, cx| table.jump_to(1010, cx));
    let pending = sheet.read(|table| {
        let visible = table.scroll.visible();
        visible.contains(&1020)
            && visible
                .clone()
                .any(|row| matches!(table.cache.row(row), RowState::Pending))
    });
    assert!(pending, "row 1020 in view, some rows still loading");

    let edge = sheet.edge(0);
    sheet.press(edge, 1);
    sheet.release(edge);
    sheet.press(edge, 2);
    assert!(!sheet.resizing(), "the second press starts no drag");
    sheet.release(edge);
    let number_px = sheet.read(|table| table.glyphs.number_px);
    // "123.456789012345": 16 characters at the number advance.
    let fitted = digits_width(16.0, number_px).ceil();
    assert_eq!(sheet.width(0), fitted);
    assert_eq!(*sheet.widths.borrow(), vec![vec![Some(px(fitted))]]);
    assert!(
        sheet.shown(0).iter().all(|(exact, shown)| exact == shown),
        "the widest visible value unrounded: {:?}",
        sheet.shown(0)
    );
    // At the fitted edge: another second press fits again, changing
    // nothing, and a move with the button down after it moves nothing.
    let edge = sheet.edge(0);
    sheet.press(edge, 2);
    assert!(!sheet.resizing(), "the second press starts no drag");
    sheet.drag_to(edge + point(px(80.), px(0.)));
    assert_eq!(sheet.width(0), fitted);
    sheet.release(edge + point(px(80.), px(0.)));
    assert_eq!(
        sheet.widths.borrow().len(),
        1,
        "a fit that changes nothing emits nothing"
    );
}

fn texts(row: u64, column: usize) -> CellValue<'static> {
    CellValue::Text(match (column, row) {
        (0, 0) | (1, _) => "a\nb".into(),
        (0, 1) => "x".repeat(1_000_000).into(),
        _ => "y".into(),
    })
}

#[gpui_kit::test]
fn a_text_fit_stays_within_the_max(cx: &mut TestAppContext) {
    let columns = vec![
        TallTableColumn::new("t", ColumnKind::Text),
        TallTableColumn::new("u", ColumnKind::Text),
    ];
    let mut sheet = Sheet::open(cx, columns, 100, texts, u64::MAX);
    let edge = sheet.edge(1);
    sheet.double_click(edge);
    // "a¶b", one line, shaped: three characters of the test font's 8.4 px.
    let number_px = sheet.read(|table| table.glyphs.number_px);
    assert_eq!(sheet.width(1), (3.0 * number_px + 17.0).ceil());
    let edge = sheet.edge(0);
    sheet.double_click(edge);
    assert_eq!(sheet.width(0), 1200.0, "a megabyte of text fits to the max");
}

#[gpui_kit::test]
fn set_columns_mid_drag_ends_it_quietly(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, floats(3), 1000, third, u64::MAX);
    let edge = sheet.edge(0);
    sheet.press(edge, 1);
    sheet.drag_to(edge + point(px(40.), px(0.)));
    sheet.update(|table, cx| table.set_columns(floats(3), cx));
    assert!(!sheet.resizing());
    sheet.drag_to(edge + point(px(80.), px(0.)));
    sheet.release(edge + point(px(80.), px(0.)));
    assert!(sheet.widths.borrow().is_empty());
    assert_eq!(sheet.width(0), 120.0, "the host's columns, as passed");
}

#[gpui_kit::test]
fn no_tooltip_during_a_drag(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, floats(3), 1000, third, u64::MAX);
    let gutter = sheet.read(|table| table.gutter_width());
    // A rounded cell, which shows a tooltip once the pointer rests on it.
    let cell = point(px(gutter + 300.), row_height() * 3.);
    let edge = sheet.edge(0);
    sheet.press(edge, 1);
    sheet.drag_to(cell);
    sheet
        .cx
        .executor()
        .advance_clock(Duration::from_millis(600));
    sheet.draw();
    assert!(sheet.read(|table| table.hover.is_none()), "no tooltip");
    sheet.release(cell);
    // The control: the same rest without a drag shows it.
    sheet
        .cx
        .simulate_mouse_move(cell + point(px(1.), px(0.)), None, Modifiers::default());
    sheet.draw();
    sheet
        .cx
        .executor()
        .advance_clock(Duration::from_millis(600));
    sheet.draw();
    let tooltip = sheet.read(|table| {
        table
            .hover
            .as_ref()
            .and_then(|hover| hover.tooltip.as_ref())
            .is_some()
    });
    assert!(tooltip, "a rested pointer shows the tooltip after the drag");
}

fn digits(_: u64, _: usize) -> CellValue<'static> {
    CellValue::Text("7".into())
}

#[gpui_kit::test]
fn a_column_past_its_bounds_never_jumps_to_them(cx: &mut TestAppContext) {
    let columns = vec![
        // 31.5 px, under the 40 px min.
        TallTableColumn::new("i", ColumnKind::Integer { max_chars: 1 }),
        // 120 px, over its 100 px max.
        TallTableColumn::new("f", ColumnKind::Float).max_width(px(100.)),
    ];
    let mut sheet = Sheet::open(cx, columns, 100, digits, u64::MAX);
    let edge = sheet.edge(0);
    sheet.press(edge, 1);
    sheet.drag_to(edge - point(px(1.), px(0.)));
    assert_eq!(
        sheet.width(0),
        31.5,
        "a narrowing doesn't widen it to the min"
    );
    sheet.drag_to(edge + point(px(5.), px(0.)));
    assert_eq!(
        sheet.width(0),
        31.5,
        "held until the pointer reaches the min"
    );
    sheet.drag_to(edge + point(px(10.), px(0.)));
    assert_eq!(sheet.width(0), 41.5, "then it follows");
    sheet.drag_to(edge - point(px(3.), px(0.)));
    assert_eq!(sheet.width(0), 31.5, "back under the min, as it was");
    sheet.release(edge - point(px(3.), px(0.)));
    assert!(sheet.widths.borrow().is_empty());

    let edge = sheet.edge(1);
    sheet.press(edge, 1);
    sheet.drag_to(edge + point(px(1.), px(0.)));
    assert_eq!(
        sheet.width(1),
        120.0,
        "a widening doesn't narrow it to the max"
    );
    sheet.drag_to(edge - point(px(30.), px(0.)));
    assert_eq!(sheet.width(1), 90.0);
    sheet.release(edge - point(px(30.), px(0.)));
    assert_eq!(*sheet.widths.borrow(), vec![vec![None, Some(px(90.))]]);
}

#[gpui_kit::test]
fn a_fractional_width_moved_out_and_back_is_unchanged(cx: &mut TestAppContext) {
    // n × 8.4 + 17: no move adds and takes back exactly in f32.
    let columns = (1..=8)
        .map(|chars| {
            TallTableColumn::new(
                "",
                ColumnKind::Integer {
                    max_chars: chars * 3,
                },
            )
        })
        .collect();
    let mut sheet = Sheet::open(cx, columns, 100, digits, u64::MAX);
    for column in 0..8 {
        let edge = sheet.edge(column);
        let width = sheet.width(column);
        sheet.press(edge, 1);
        sheet.drag_to(edge + point(px(100.5), px(0.)));
        sheet.drag_to(edge);
        sheet.release(edge);
        assert_eq!(sheet.width(column), width, "column {column}");
    }
    assert!(
        sheet.widths.borrow().is_empty(),
        "{:?}",
        sheet.widths.borrow()
    );
}

#[gpui_kit::test]
fn a_click_on_a_band_redoes_nothing(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, floats(3), 1000, third, u64::MAX);
    let layouts = sheet.layouts.get();
    let edge = sheet.edge(0);
    sheet.press(edge, 1);
    sheet.release(edge);
    assert_eq!(sheet.layouts.get(), layouts, "no layout probe for a click");
}

#[gpui_kit::test]
fn a_fit_at_a_hosts_width_past_the_max_emits_nothing(cx: &mut TestAppContext) {
    let columns = vec![TallTableColumn::new("t", ColumnKind::Text).width(px(5000.))];
    let mut sheet = Sheet::open(cx, columns, 100, texts, u64::MAX);
    assert_eq!(sheet.width(0), 1200.0);
    let edge = sheet.edge(0);
    sheet.double_click(edge);
    assert_eq!(sheet.width(0), 1200.0);
    assert!(sheet.widths.borrow().is_empty(), "drawn at the max already");
}

#[gpui_kit::test]
fn a_name_with_a_line_break_fits(cx: &mut TestAppContext) {
    let columns = vec![TallTableColumn::new("a\nb\r\nc", ColumnKind::Float)];
    let mut sheet = Sheet::open(cx, columns, 100, third, u64::MAX);
    let edge = sheet.edge(0);
    sheet.double_click(edge);
    // "0.3333333333333333": 18 characters, wider than "a¶b¶c".
    let number_px = sheet.read(|table| table.glyphs.number_px);
    assert_eq!(sheet.width(0), digits_width(18.0, number_px).ceil());
}
