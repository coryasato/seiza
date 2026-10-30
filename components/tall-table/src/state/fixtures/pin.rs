//! `pin`: `fixtures/pin.json` run against the geometry's own functions,
//! with its negative controls, and the pin drawn and driven in a window of
//! GPUI's test app, over rows answered from memory: the cells under a
//! sideways scroll, the scroll and its range, the thumb, the edge line, the
//! hover and the tooltip, the cap at half the view, and `set_columns`; with
//! `resize`, `select`, `sort`, and `custom-cells`, what each does with it.

use std::cell::RefCell;
use std::ops::Range;
use std::rc::Rc;
use std::time::Duration;

use gpui_kit::{
    App, AppContext as _, Modifiers, MouseButton, MouseDownEvent, Pixels, Point, TestAppContext,
    VisualTestContext, point, px, size,
};
use serde_json::Value;

use super::super::{Drag, TallTableEvent, TallTableState, row_height};
use crate::column::{CellKind, ColumnKind, LaidOutColumn, TallTableColumn};
use crate::delegate::{CellValue, PageLoad, TallTableDelegate, TallTablePage};
use crate::pin::{self, Control, Pin};
use crate::scroll;

const PIN: &str = include_str!("../../../fixtures/pin.json");

// --- pin.json ---

fn laid_out(widths: &[f32]) -> Vec<LaidOutColumn> {
    let mut x = 0.0;
    widths
        .iter()
        .enumerate()
        .map(|(index, width)| {
            let column = LaidOutColumn {
                name: format!("c{index}").into(),
                x,
                width: *width,
                kind: CellKind::Float,
                budget: 1,
            };
            x += width;
            column
        })
        .collect()
}

fn floats(value: &Value) -> Vec<f32> {
    value
        .as_array()
        .expect("an array")
        .iter()
        .map(|number| number.as_f64().expect("a number") as f32)
        .collect()
}

/// What the fixture's cases expect that the geometry doesn't give, under
/// `control` (one of its `controls`, or none).
fn mismatches(control: Option<&str>) -> Vec<String> {
    let fixture: Value = serde_json::from_str(PIN).expect("pin.json");
    let mut mismatches = Vec::new();
    for case in fixture["cases"].as_array().expect("cases") {
        let name = case["name"].as_str().expect("name");
        let columns = laid_out(&floats(&case["widths"]));
        let cells_width = case["cells_width"].as_f64().expect("cells_width") as f32;
        let count = case["count"].as_u64().expect("count") as usize;
        let scroll_x = case["scroll_x"].as_f64().expect("scroll_x") as f32;
        let pinned = if control == Some("no-cap") {
            count.min(columns.len())
        } else {
            pin::in_effect(&columns, count, cells_width)
        };
        let mut pin = Pin::new(&columns, pinned, cells_width);
        pin.control = match control {
            Some("pinned-scroll") => Control::PinnedScroll,
            Some("under-run") => Control::UnderRun,
            Some("into-view-at-gutter") => Control::IntoViewAtGutter,
            _ => Control::None,
        };
        let content = columns.last().map_or(0.0, |column| column.x + column.width);
        let max_scroll_x = (content - cells_width).max(0.0);
        let lefts: Vec<(usize, f32)> = columns
            .iter()
            .enumerate()
            .filter(|(index, column)| {
                pin.visible(*index, column.x, column.width, scroll_x, cells_width)
            })
            .map(|(index, column)| (index, pin.left(index, column.x, scroll_x)))
            .collect();
        // The hover's hit test (`cell_at`): a screen x's content x, then
        // the column holding it.
        let hits: Vec<(f32, Option<usize>)> = floats(&case["hits"])
            .into_iter()
            .map(|x| {
                let content_x = pin.content_x(x, scroll_x);
                let column = columns
                    .iter()
                    .position(|column| (column.x..column.x + column.width).contains(&content_x));
                (x, column)
            })
            .collect();
        // `select`'s keys: the move, then `scroll_by`'s clamp.
        let into_view: Vec<(usize, f32)> = floats(&case["into_view"])
            .into_iter()
            .map(|index| {
                let index = index as usize;
                let column = &columns[index];
                let moved =
                    scroll_x + pin.into_view(index, column.x, column.width, scroll_x, cells_width);
                (index, moved.clamp(0.0, max_scroll_x))
            })
            .collect();

        let expect = &case["expect"];
        let mut check = |what: &str, got: String, want: String| {
            if got != want {
                mismatches.push(format!("{name}: {what} {got}; the fixture's {want}"));
            }
        };
        check("pinned", pinned.to_string(), expect["pinned"].to_string());
        let number = |value: f32| serde_json::json!(value).to_string();
        let expected_number = |value: &Value| number(value.as_f64().expect("a number") as f32);
        check("edge", number(pin.edge), expected_number(&expect["edge"]));
        check(
            "max_scroll_x",
            number(max_scroll_x),
            expected_number(&expect["max_scroll_x"]),
        );
        let pairs = |value: &Value| -> Vec<String> {
            value
                .as_array()
                .expect("pairs")
                .iter()
                .map(|pair| {
                    let left = number(pair[0].as_f64().expect("a number") as f32);
                    let right = if pair[1].is_null() {
                        "null".to_string()
                    } else {
                        number(pair[1].as_f64().expect("a number") as f32)
                    };
                    format!("{left}:{right}")
                })
                .collect()
        };
        check(
            "lefts",
            format!(
                "{:?}",
                lefts
                    .iter()
                    .map(|(index, left)| format!("{}:{}", number(*index as f32), number(*left)))
                    .collect::<Vec<_>>()
            ),
            format!("{:?}", pairs(&expect["lefts"])),
        );
        check(
            "hits",
            format!(
                "{:?}",
                hits.iter()
                    .map(|(x, column)| format!(
                        "{}:{}",
                        number(*x),
                        column.map_or("null".to_string(), |column| number(column as f32))
                    ))
                    .collect::<Vec<_>>()
            ),
            format!("{:?}", pairs(&expect["hits"])),
        );
        check(
            "into_view",
            format!(
                "{:?}",
                into_view
                    .iter()
                    .map(|(index, scroll)| format!("{}:{}", number(*index as f32), number(*scroll)))
                    .collect::<Vec<_>>()
            ),
            format!("{:?}", pairs(&expect["into_view"])),
        );
    }
    mismatches
}

#[test]
fn pin_fixture() {
    let mismatches = mismatches(None);
    assert!(mismatches.is_empty(), "{mismatches:#?}");
}

#[test]
fn pin_controls_fail() {
    let fixture: Value = serde_json::from_str(PIN).expect("pin.json");
    let controls = fixture["controls"].as_array().expect("controls");
    assert_eq!(controls.len(), 4);
    for control in controls {
        let control = control.as_str().expect("a control");
        assert!(
            !mismatches(Some(control)).is_empty(),
            "the {control} control passed the pin fixture"
        );
    }
}

// --- in a window ---

/// A cell's value by its row and column: a third, rounded in every cell,
/// so a rested hover shows a tooltip.
fn third(_: u64, _: usize) -> CellValue<'static> {
    CellValue::Float(1.0 / 3.0)
}

/// Rows from memory, answered when asked; every sort accepted (`sort`),
/// every cell filled halfway (`custom-cells`).
struct Memory;

struct Rows {
    rows: Range<u64>,
}

impl TallTablePage for Rows {
    fn value(&self, row: usize, column: usize) -> Option<CellValue<'_>> {
        Some(third(self.rows.start + row as u64, column))
    }

    fn heap_bytes(&self) -> usize {
        1024
    }

    #[cfg(feature = "custom-cells")]
    fn paint(&self, _: usize, _: usize) -> crate::CellPaint {
        crate::CellPaint {
            fill: Some(0.5),
            ..Default::default()
        }
    }
}

impl TallTableDelegate for Memory {
    type Page = Rows;
    type Request = u64;

    fn load_page(&mut self, rows: Range<u64>, _: &mut App) -> (u64, PageLoad<Rows>) {
        (rows.start, Box::pin(std::future::ready(Ok(Rows { rows }))))
    }

    fn cancel(&mut self, _: u64, _: &mut App) {}

    #[cfg(feature = "sort")]
    fn sort(&mut self, _: Option<crate::Sort>, _: &mut App) -> Result<(), crate::SortRefused> {
        Ok(())
    }
}

/// `count` float columns, 120 px each (the kind's width).
fn columns(count: usize) -> Vec<TallTableColumn> {
    (0..count)
        .map(|index| {
            let column = TallTableColumn::new(format!("f{index}"), ColumnKind::Float);
            #[cfg(feature = "sort")]
            let column = column.sortable(true);
            #[cfg(feature = "custom-cells")]
            let column = column.fill(crate::Ramp::new(&[
                |theme| theme.background,
                |theme| theme.chart_1,
            ]));
            column
        })
        .collect()
}

type Table = TallTableState<Memory>;

/// A table in a window over 1,000 rows from memory, with the `Pinned`
/// events it emitted.
struct Sheet<'a> {
    cx: &'a mut VisualTestContext,
    table: gpui_kit::Entity<Table>,
    pinned: Rc<RefCell<Vec<usize>>>,
}

/// The window's view: the table, subscribed to as it's made, so the events
/// of its first frame are heard too.
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

impl<'a> Sheet<'a> {
    /// The table in a `width`×900 window, `count` columns, `pinned` set
    /// before its first frame.
    fn open(cx: &'a mut TestAppContext, width: f32, count: usize, pinned: usize) -> Self {
        cx.update(|cx| {
            gpui_kit::component::init(cx);
            crate::init(cx);
        });
        let events: Rc<RefCell<Vec<usize>>> = Rc::default();
        let heard = events.clone();
        let (shell, cx) = cx.add_window_view(move |_, cx| {
            let table = cx.new(|cx| {
                let mut table =
                    TallTableState::new(Memory, columns(count), 1000, Default::default(), cx)
                        .probe_frames(true);
                table.set_pinned(pinned, cx);
                assert_eq!(table.pinned_in_effect(), 0, "no view yet: none pinned");
                table
            });
            let subscription = cx.subscribe(&table, move |_, _, event: &TallTableEvent, _| {
                if let TallTableEvent::Pinned(pinned) = event {
                    heard.borrow_mut().push(*pinned);
                }
            });
            Shell {
                table,
                _subscription: subscription,
            }
        });
        let table = shell.read_with(cx, |shell, _| shell.table.clone());
        cx.simulate_resize(size(px(width), px(900.)));
        let mut sheet = Self {
            cx,
            table,
            pinned: events,
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

    fn update<T>(
        &mut self,
        update: impl FnOnce(&mut Table, &mut gpui_kit::Context<Table>) -> T,
    ) -> T {
        let result = self.table.update(self.cx, update);
        self.draw();
        result
    }

    fn scroll_x_by(&mut self, x: f32) {
        self.update(|table, cx| table.scroll_by(0.0, x, cx));
    }

    fn scroll_x(&mut self) -> f32 {
        self.read(|table| table.scroll_x)
    }

    fn resize(&mut self, width: f32) {
        self.cx.simulate_resize(size(px(width), px(900.)));
        self.draw();
    }

    /// The columns drawn last frame, with their screen lefts.
    fn drawn(&mut self) -> Vec<(usize, f32)> {
        self.read(|table| table.pin_state.drawn.clone())
    }

    /// The run's edge, *P*, in the cells area's pixels.
    fn edge(&mut self) -> f32 {
        self.read(|table| table.place().edge)
    }

    /// A point in the window `x` px right of the cells' left edge, on row
    /// `row` of the view.
    fn at(&mut self, x: f32, row: f32) -> Point<Pixels> {
        let (origin, gutter) = self.read(|table| (table.body.origin, table.gutter_width()));
        origin + point(px(gutter + x), row_height() * (row + 0.5))
    }

    /// A point in the header's row, `x` px right of the cells' left edge.
    #[cfg(feature = "resize")]
    fn header_at(&mut self, x: f32) -> Point<Pixels> {
        let (origin, gutter) = self.read(|table| (table.body.origin, table.gutter_width()));
        point(origin.x + px(gutter + x), origin.y - row_height() / 2.)
    }

    fn press(&mut self, at: Point<Pixels>) {
        self.cx.simulate_event(MouseDownEvent {
            position: at,
            modifiers: Modifiers::default(),
            button: MouseButton::Left,
            click_count: 1,
            first_mouse: false,
        });
        self.draw();
    }

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
}

#[gpui_kit::test]
fn pinned_cells_hold_under_a_sideways_scroll(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, 1440., 30, 0);
    let unpinned = sheet.drawn();
    let max = sheet.read(|table| table.max_scroll_x());
    assert_eq!(
        sheet.read(|table| table.pin_state.line.get()),
        None,
        "no edge"
    );

    sheet.update(|table, cx| table.set_pinned(2, cx));
    assert_eq!(sheet.read(|table| table.pinned_in_effect()), 2);
    assert_eq!(*sheet.pinned.borrow(), vec![2]);
    assert_eq!(sheet.drawn(), unpinned, "at scroll 0, where unpinned");
    assert_eq!(sheet.scroll_x(), 0.0, "pinning moved no scroll");
    assert_eq!(
        sheet.read(|table| table.max_scroll_x()),
        max,
        "nor its range"
    );
    let gutter = sheet.read(|table| table.gutter_width());
    assert_eq!(
        sheet.read(|table| table.pin_state.line.get()),
        Some(gutter + 240.0 - 1.0),
        "the edge's line at P"
    );

    sheet.scroll_x_by(300.0);
    let edge = sheet.edge();
    assert_eq!(edge, 240.0);
    let drawn = sheet.drawn();
    assert_eq!(&drawn[..2], &[(0, 0.0), (1, 120.0)], "the pinned hold");
    for (index, left) in &drawn[2..] {
        assert_eq!(*left, *index as f32 * 120.0 - 300.0, "column {index} moved");
        assert!(
            left + 120.0 > edge,
            "column {index} is wholly under the run"
        );
    }
    assert_eq!(drawn[2].0, 4, "columns 2 and 3 are under the run");

    // Unpinning moves no scroll either, and the scrolled view is unpinned's.
    sheet.update(|table, cx| table.set_pinned(0, cx));
    assert_eq!(sheet.scroll_x(), 300.0);
    assert_eq!(sheet.read(|table| table.max_scroll_x()), max);
    assert_eq!(sheet.drawn()[0], (2, -60.0));
    assert_eq!(sheet.read(|table| table.pin_state.line.get()), None);
    assert_eq!(*sheet.pinned.borrow(), vec![2, 0]);
}

#[gpui_kit::test]
fn the_horizontal_thumb_measures_from_the_run(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, 1440., 30, 2);
    sheet.scroll_x_by(500.0);
    let (thumb, cells_width, body, max) = sheet.read(|table| {
        (
            table.horizontal_thumb(),
            table.cells_width(),
            table.body,
            table.max_scroll_x(),
        )
    });
    let track = cells_width - 240.0;
    let expected = scroll::thumb(
        track,
        f64::from(track),
        30.0 * 120.0 - 240.0,
        f64::from(500.0 / max),
        super::super::MIN_THUMB,
    );
    assert_eq!(thumb, expected, "the track starts at P");
    let bar = gpui_kit::component::scroll::Scrollbar::width();
    let y = body.origin.y + body.size.height - bar / 2.;
    let grab = sheet.at(240.0 + thumb.offset + thumb.length / 2.0, 0.0).x;
    sheet.press(point(grab, y));
    assert!(matches!(
        sheet.read(|table| table.drag),
        Some(Drag::Horizontal { .. })
    ));
    assert!(
        (sheet.scroll_x() - 500.0).abs() < 0.01,
        "grabbed where pressed: {}",
        sheet.scroll_x()
    );
    sheet.drag_to(point(grab + px(100.), y));
    let fraction = scroll::fraction_at(track, thumb.length, thumb.offset + 100.0);
    assert!(
        (sheet.scroll_x() - fraction as f32 * max).abs() < 0.01,
        "the fraction under the pointer: {} for {}",
        sheet.scroll_x(),
        fraction as f32 * max
    );
    sheet.release(point(grab + px(100.), y));
    assert!(sheet.read(|table| table.drag.is_none()));
}

#[gpui_kit::test]
fn hover_and_tooltip_on_pinned_and_scrolled_cells(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, 1440., 30, 1);
    sheet.scroll_x_by(500.0);
    let body_x = sheet.read(|table| table.body.origin.x);
    let gutter = sheet.read(|table| table.gutter_width());
    // A pinned cell, then a scrolled one partly under the run: column 5
    // (600..720) is at 100..220 on screen, the run's edge at 120, so its
    // tooltip is placed beside the part right of it.
    for (x, column, left, width) in [(60.0, 0, 0.0, 120.0), (130.0, 5, 120.0, 100.0)] {
        let at = sheet.at(x, 2.0);
        sheet.cx.simulate_mouse_move(at, None, Modifiers::default());
        sheet.draw();
        assert_eq!(
            sheet.read(|table| table.hover.as_ref().map(|hover| (hover.row, hover.column))),
            Some((2, column))
        );
        sheet
            .cx
            .executor()
            .advance_clock(Duration::from_millis(600));
        sheet.draw();
        assert!(
            sheet.read(|table| table
                .hover
                .as_ref()
                .is_some_and(|hover| hover.tooltip.is_some())),
            "a rounded cell's tooltip"
        );
        let cell = sheet.read(|table| table.tooltip_cell()).expect("its cell");
        assert_eq!(
            cell.origin.x,
            body_x + px(gutter + left),
            "at the cell's left"
        );
        assert_eq!(cell.size.width, px(width));
    }
}

#[gpui_kit::test]
fn fewer_pin_in_a_narrow_view(cx: &mut TestAppContext) {
    // Four pinned (480 px) before the first frame: pinned at it, once.
    let mut sheet = Sheet::open(cx, 1440., 30, 4);
    assert_eq!(sheet.read(|table| table.pinned_in_effect()), 4);
    assert_eq!(*sheet.pinned.borrow(), vec![4]);
    // A view whose cells are under 960 px pins three.
    let gutter = sheet.read(|table| table.gutter_width());
    let bar = f32::from(gpui_kit::component::scroll::Scrollbar::width());
    sheet.resize(800.0 + gutter + bar);
    assert_eq!(
        sheet.read(|table| (table.pinned(), table.pinned_in_effect())),
        (4, 3)
    );
    assert_eq!(sheet.edge(), 360.0);
    sheet.resize(1440.);
    assert_eq!(
        sheet.read(|table| table.pinned_in_effect()),
        4,
        "wider: again"
    );
    assert_eq!(*sheet.pinned.borrow(), vec![4, 3, 4]);
}

#[gpui_kit::test]
fn set_columns_keeps_the_count_clamped(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, 1440., 30, 3);
    sheet.update(|table, cx| table.set_columns(columns(2), cx));
    assert_eq!(
        sheet.read(|table| (table.pinned(), table.pinned_in_effect())),
        (3, 2)
    );
    sheet.update(|table, cx| table.set_columns(columns(30), cx));
    assert_eq!(sheet.read(|table| table.pinned_in_effect()), 3);
    assert_eq!(*sheet.pinned.borrow(), vec![3, 2, 3]);
}

#[gpui_kit::test]
fn the_layout_probe_reports_the_run(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, 1440., 30, 0);
    let layouts: Rc<RefCell<Vec<usize>>> = Rc::default();
    let _subscription = sheet.cx.update(|_, cx| {
        let layouts = layouts.clone();
        cx.subscribe(&sheet.table, move |_, event: &TallTableEvent, _| {
            if let TallTableEvent::Layout(layout) = event {
                layouts.borrow_mut().push(layout.pinned);
            }
        })
    });
    sheet.update(|table, cx| table.set_pinned(2, cx));
    assert_eq!(*layouts.borrow(), vec![2]);
}

#[cfg(feature = "resize")]
mod resize {
    use gpui_kit::{TestAppContext, point, px};

    use super::Sheet;

    #[gpui_kit::test]
    fn a_pinned_band_drags_and_stops_at_the_half(cx: &mut TestAppContext) {
        let mut sheet = Sheet::open(cx, 1440., 30, 2);
        let half = sheet.read(|table| table.cells_width()) / 2.0;
        let edge = sheet.header_at(240.0 - 0.5);
        sheet.press(edge);
        assert!(sheet.read(|table| table.resizing.is_some()));
        sheet.drag_to(edge + point(px(100.), px(0.)));
        assert_eq!(sheet.read(|table| table.columns[1].width), 220.0);
        assert_eq!(sheet.edge(), 340.0, "P moved with it");
        assert_eq!(sheet.drawn()[2], (2, 340.0), "and the scrolled columns");
        sheet.drag_to(edge + point(px(5000.), px(0.)));
        assert_eq!(
            sheet.read(|table| table.columns[1].width),
            half - 120.0,
            "stopped at the half"
        );
        sheet.release(edge + point(px(5000.), px(0.)));
        assert_eq!(
            sheet.read(|table| table.pinned_in_effect()),
            2,
            "nothing unpinned"
        );
        assert_eq!(*sheet.pinned.borrow(), vec![2]);
    }

    #[gpui_kit::test]
    fn a_view_narrowed_during_a_drag_holds_the_run(cx: &mut TestAppContext) {
        let mut sheet = Sheet::open(cx, 1440., 30, 2);
        let edge = sheet.header_at(240.0 - 0.5);
        sheet.press(edge);
        // Cells about 200 px wide: the held run's 240 px is past them.
        let gutter = sheet.read(|table| table.gutter_width());
        let bar = f32::from(gpui_kit::component::scroll::Scrollbar::width());
        sheet.resize(200.0 + gutter + bar);
        let cells_width = sheet.read(|table| table.cells_width());
        assert_eq!(sheet.read(|table| table.pinned_in_effect()), 2, "held");
        assert_eq!(sheet.edge(), cells_width, "P clamped to the cells");
        let thumb = sheet.read(|table| table.horizontal_thumb());
        assert!(thumb.length >= 0.0 && thumb.offset >= 0.0, "{thumb:?}");
        sheet.release(edge);
        assert_eq!(
            sheet.read(|table| table.pinned_in_effect()),
            0,
            "at the release"
        );
        assert_eq!(*sheet.pinned.borrow(), vec![2, 0]);
    }

    /// The last pinned column's band straddles the run's edge: its right
    /// half, over the first scrolled column's header, takes the press too.
    #[gpui_kit::test]
    fn the_last_pinned_band_takes_presses_past_the_edge(cx: &mut TestAppContext) {
        let mut sheet = Sheet::open(cx, 1440., 30, 2);
        sheet.scroll_x_by(50.0);
        let at = sheet.header_at(240.0 + 3.0);
        sheet.press(at);
        assert_eq!(
            sheet.read(|table| table.resizing.map(|drag| drag.column)),
            Some(1)
        );
    }

    /// A drag clamped at the half with fractional widths: re-summed at the
    /// release, the run still fits, and nothing unpins.
    #[gpui_kit::test]
    fn a_fractional_clamp_holds_at_the_release(cx: &mut TestAppContext) {
        let mut sheet = Sheet::open(cx, 1443.7, 30, 2);
        let mut columns = super::columns(30);
        columns[0] = columns[0].clone().width(px(137.3));
        sheet.update(|table, cx| table.set_columns(columns, cx));
        let edge = sheet.header_at(137.3 + 120.0 - 0.5);
        sheet.press(edge);
        sheet.drag_to(edge + point(px(5000.37), px(0.)));
        sheet.release(edge + point(px(5000.37), px(0.)));
        assert_eq!(sheet.read(|table| table.pinned_in_effect()), 2);
        assert_eq!(*sheet.pinned.borrow(), vec![2]);
    }

    #[gpui_kit::test]
    fn no_band_under_the_run(cx: &mut TestAppContext) {
        let mut sheet = Sheet::open(cx, 1440., 30, 2);
        sheet.scroll_x_by(300.0);
        // Column 3's right edge (480) would be at 180 on screen, over
        // pinned column 1: its band isn't drawn.
        let at = sheet.header_at(180.0 - 0.5);
        sheet.press(at);
        assert!(sheet.read(|table| table.resizing.is_none()));
        // The control: column 4's, right of the run, drags.
        let at = sheet.header_at(300.0 - 0.5);
        sheet.press(at);
        assert_eq!(
            sheet.read(|table| table.resizing.map(|drag| drag.column)),
            Some(4)
        );
    }
}

#[cfg(feature = "select")]
mod select {
    use gpui_kit::{TestAppContext, px};

    use super::Sheet;
    use crate::selection::{Kind, TallTableSelection};
    use crate::state::select::{SelectLeft, SelectRight};

    fn anchor(sheet: &mut Sheet) -> Option<(u64, usize)> {
        sheet.read(|table| {
            table
                .selection_state
                .current
                .map(|current| current.anchor())
        })
    }

    #[gpui_kit::test]
    fn presses_and_a_drag_across_the_edge(cx: &mut TestAppContext) {
        let mut sheet = Sheet::open(cx, 1440., 30, 2);
        sheet.scroll_x_by(500.0);
        let pinned = sheet.at(60.0, 1.0);
        sheet.press(pinned);
        sheet.release(pinned);
        assert_eq!(anchor(&mut sheet), Some((1, 0)), "a pinned cell");
        // Screen 250 is content 750: column 6.
        let scrolled = sheet.at(250.0, 3.0);
        sheet.press(scrolled);
        assert_eq!(anchor(&mut sheet), Some((3, 6)), "a scrolled cell");
        let to = sheet.at(130.0, 1.0);
        sheet.drag_to(to);
        sheet.release(to);
        let selection = sheet.read(|table| table.selection_state.current);
        assert_eq!(
            selection.map(|selection| (selection.anchor(), selection.head())),
            Some(((3, 6), (1, 1))),
            "the drag reached the pinned columns"
        );
        // The tint: a piece a region, each edged.
        let (pinned, scrolled) = sheet.read(|table| {
            (
                table.selection_state.drawn.pinned_tint,
                table.selection_state.drawn.tint,
            )
        });
        let pinned = pinned.expect("a pinned piece");
        let scrolled = scrolled.expect("a scrolled piece");
        assert_eq!((pinned.origin.x, pinned.size.width), (px(120.), px(120.)));
        assert_eq!(
            scrolled.origin.x,
            px(240.0 - 1.0),
            "from P, its left edge hidden"
        );
        assert_eq!(
            scrolled.origin.x + scrolled.size.width,
            px(7.0 * 120.0 - 500.0),
            "to column 6's right"
        );
    }

    #[gpui_kit::test]
    fn keys_bring_a_column_right_of_the_run(cx: &mut TestAppContext) {
        let mut sheet = Sheet::open(cx, 1440., 30, 2);
        sheet.scroll_x_by(500.0);
        let at_one = TallTableSelection::new(Kind::Cells, (0, 1), (0, 1));
        sheet.update(|table, cx| table.select(Some(at_one), cx));
        let table = sheet.table.clone();
        sheet.cx.update(|window, cx| {
            table.update(cx, |table, cx| table.select_right(&SelectRight, window, cx));
        });
        sheet.draw();
        assert_eq!(anchor(&mut sheet), Some((0, 2)));
        assert_eq!(sheet.scroll_x(), 0.0, "column 2 (240..) at P");
        sheet.scroll_x_by(500.0);
        sheet.cx.update(|window, cx| {
            table.update(cx, |table, cx| table.select_left(&SelectLeft, window, cx));
        });
        sheet.draw();
        assert_eq!(anchor(&mut sheet), Some((0, 1)));
        assert_eq!(
            sheet.scroll_x(),
            500.0,
            "a pinned column: no sideways scroll"
        );
    }
}

#[cfg(feature = "sort")]
mod sort {
    use gpui_kit::{TestAppContext, px};

    use super::Sheet;

    #[gpui_kit::test]
    fn a_pinned_arrow_clicks(cx: &mut TestAppContext) {
        let mut sheet = Sheet::open(cx, 1440., 30, 1);
        sheet.scroll_x_by(500.0);
        let target = sheet.read(|table| {
            table
                .sort_state
                .drawn
                .iter()
                .find(|arrow| arrow.column == 0)
                .map(|arrow| arrow.target)
        });
        let target = target.expect("the pinned column's arrow");
        let at = target.center();
        sheet.press(at);
        sheet.release(at);
        assert_eq!(
            sheet.read(|table| table.sort_state.current.map(|sort| sort.column)),
            Some(0)
        );
    }

    /// A scrolled column's arrow under the run isn't drawn; right of it,
    /// it is.
    #[gpui_kit::test]
    fn no_arrow_under_the_run(cx: &mut TestAppContext) {
        let mut sheet = Sheet::open(cx, 1440., 30, 1);
        // Column 2 (240..360) is at 20..140 at scroll 220, its arrow's
        // target under the run (to 120); at scroll 180, at 60..180, right
        // of it.
        for (scroll, drawn) in [(220.0, false), (180.0, true)] {
            sheet.update(|table, cx| table.scroll_by(0.0, scroll - table.scroll_x, cx));
            let arrow = sheet.read(|table| {
                table
                    .sort_state
                    .drawn
                    .iter()
                    .find(|arrow| arrow.column == 2)
                    .map(|arrow| arrow.target)
            });
            assert_eq!(arrow.is_some(), drawn, "at scroll {scroll}: {arrow:?}");
            if let Some(target) = arrow {
                let (origin, gutter, edge) = sheet
                    .read(|table| (table.body.origin, table.gutter_width(), table.place().edge));
                assert!(target.origin.x >= origin.x + px(gutter + edge));
            }
        }
    }
}

#[cfg(feature = "custom-cells")]
mod paint {
    use gpui_kit::{TestAppContext, px};

    use super::Sheet;
    use crate::pin::Control;

    /// Every scrolled quad's visible part, under `control`: right of P.
    fn scrolled_left_of_the_edge(cx: &mut TestAppContext, control: Control) -> usize {
        let mut sheet = Sheet::open(cx, 1440., 30, 2);
        sheet.update(|table, _| table.pin_state.control = Some(control));
        // Column 4 (480..600) passes partly under the pinned ones (to 240),
        // at 150..270.
        sheet.scroll_x_by(330.0);
        sheet.read(|table| table.pin_state.painted.borrow_mut().clear());
        sheet.draw();
        let (origin, gutter, edge) =
            sheet.read(|table| (table.body.origin, table.gutter_width(), table.place().edge));
        let edge = origin.x + px(gutter + edge);
        let painted = sheet.read(|table| table.pin_state.painted.borrow().clone());
        assert!(painted.iter().any(|(scrolled, _)| *scrolled));
        assert!(painted.iter().any(|(scrolled, _)| !*scrolled));
        painted
            .iter()
            .filter(|(scrolled, bounds)| {
                *scrolled && bounds.size.width > px(0.) && bounds.origin.x < edge
            })
            .count()
    }

    #[gpui_kit::test]
    fn scrolled_fills_clip_at_the_edge(cx: &mut TestAppContext) {
        assert_eq!(scrolled_left_of_the_edge(cx, Control::None), 0);
    }

    #[gpui_kit::test]
    fn the_unclipped_control_fails(cx: &mut TestAppContext) {
        assert!(scrolled_left_of_the_edge(cx, Control::Unclipped) > 0);
    }
}
