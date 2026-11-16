//! `group-headers`: `fixtures/group-headers.json`'s drawing half run
//! against the groups' own functions, with its negative controls, and the
//! group rows drawn in a window of GPUI's test app, over rows answered
//! from memory: the header's height at each depth and the body refitted,
//! each run's cell cut at the view and labeled in view, the blanks, the
//! layout probe; with `reorder`, a run split by a move; with `pin`, a run
//! split at the edge and redrawn wherever the edge moves without a layout;
//! with `select`, the tint; with `sort` and `resize`, the arrows and bands
//! in the names' row; with `density`, its row height.

use std::cell::RefCell;
use std::ops::Range;
use std::rc::Rc;

#[cfg(any(feature = "sort", feature = "resize"))]
use gpui_kit::MouseUpEvent;
use gpui_kit::{App, AppContext as _, SharedString, TestAppContext, VisualTestContext, px, size};
#[cfg(any(feature = "sort", feature = "resize", feature = "select"))]
use gpui_kit::{Modifiers, MouseButton, MouseDownEvent, Pixels, Point, point};
use serde_json::{Value, json};

use super::super::{TallTableEvent, TallTableState, row_height};
use crate::column::{CellKind, ColumnKind, LaidOutColumn, TallTableColumn};
use crate::delegate::{CellValue, PageLoad, TallTableDelegate, TallTablePage};
use crate::groups::{self, Control, View};

const GROUPS: &str = include_str!("../../../fixtures/group-headers.json");

// --- group-headers.json ---

fn path(value: &Value) -> Vec<SharedString> {
    value
        .as_array()
        .expect("a path")
        .iter()
        .map(|label| SharedString::from(label.as_str().expect("a label").to_string()))
        .collect()
}

fn number(value: &Value) -> f32 {
    value.as_f64().expect("a number") as f32
}

/// `widths` (by index) laid out in `order` (`order[place]` the index).
fn laid_out(widths: &[f32], order: &[usize]) -> Vec<LaidOutColumn> {
    let mut x = 0.0;
    order
        .iter()
        .map(|&index| {
            let column = LaidOutColumn {
                name: format!("c{index}").into(),
                x,
                width: widths[index],
                kind: CellKind::Float,
                budget: 1,
                #[cfg(feature = "format")]
                format: None,
                #[cfg(feature = "reorder")]
                index,
            };
            x += widths[index];
            column
        })
        .collect()
}

/// A cell's fields with every number as an f32's, so `400` and `400.0`
/// compare equal.
fn normalized(cell: &Value) -> Value {
    Value::Array(
        cell.as_array()
            .expect("a cell")
            .iter()
            .map(|field| match field.as_f64() {
                Some(value) => json!(f64::from(value as f32)),
                None => field.clone(),
            })
            .collect(),
    )
}

/// What the fixture's cases expect that the groups don't give, under
/// `control` (one of its `controls`, or none). A case that pins columns
/// runs only with `pin`, whose rule finds the run in effect.
fn mismatches(control: Option<&str>) -> Vec<String> {
    let fixture: Value = serde_json::from_str(GROUPS).expect("group-headers.json");
    let mut mismatches = Vec::new();
    for case in fixture["cases"].as_array().expect("cases") {
        let name = case["name"].as_str().expect("name");
        let paths: Vec<Vec<SharedString>> = case["paths"]
            .as_array()
            .expect("paths")
            .iter()
            .map(path)
            .collect();
        let widths: Vec<f32> = case["widths"]
            .as_array()
            .expect("widths")
            .iter()
            .map(number)
            .collect();
        let order: Vec<usize> = match case["order"].as_array() {
            Some(order) => order
                .iter()
                .map(|index| index.as_u64().expect("an index") as usize)
                .collect(),
            None => (0..paths.len()).collect(),
        };
        let count = case["count"].as_u64().expect("count") as usize;
        let cells_width = number(&case["cells_width"]);
        let columns = laid_out(&widths, &order);
        #[cfg(feature = "pin")]
        let (pinned, edge) = {
            let pinned = crate::pin::in_effect(&columns, count, cells_width);
            (
                pinned,
                crate::pin::Pin::new(&columns, pinned, cells_width).edge,
            )
        };
        #[cfg(not(feature = "pin"))]
        let (pinned, edge) = {
            if count > 0 {
                continue;
            }
            (0, 0.0)
        };
        let found = if control == Some("groups-by-place") {
            groups::runs(paths.iter().map(Vec::as_slice))
        } else {
            groups::runs(order.iter().map(|&index| paths[index].as_slice()))
        };
        let view = View {
            pinned,
            edge,
            scroll_x: number(&case["scroll_x"]),
            cells_width,
            pad: number(&case["pad"]),
        };
        let control = match control {
            Some("no-split-at-edge") => Control::NoSplitAtEdge,
            Some("label-centered") => Control::LabelCentered,
            _ => Control::None,
        };
        let drawn = groups::cells(
            &found,
            |place| (columns[place].x, columns[place].width),
            view,
            control,
        );
        let expect = &case["expect"];
        let mut check = |what: &str, got: String, want: String| {
            if got != want {
                mismatches.push(format!("{name}: {what} {got}; the fixture's {want}"));
            }
        };
        check(
            "group rows",
            found.depth.to_string(),
            expect["group_rows"].to_string(),
        );
        let got: Vec<Value> = drawn
            .iter()
            .map(|cell| {
                normalized(&json!([
                    cell.level,
                    cell.label.as_ref(),
                    cell.start,
                    cell.end,
                    cell.pinned,
                    f64::from(cell.left),
                    f64::from(cell.width),
                    f64::from(cell.label_x)
                ]))
            })
            .collect();
        let want: Vec<Value> = expect["cells"]
            .as_array()
            .expect("cells")
            .iter()
            .map(normalized)
            .collect();
        check(
            "cells",
            Value::Array(got).to_string(),
            Value::Array(want).to_string(),
        );
    }
    mismatches
}

#[test]
fn group_headers_fixture() {
    let mismatches = mismatches(None);
    assert!(mismatches.is_empty(), "{mismatches:#?}");
}

#[test]
fn group_headers_controls_fail() {
    let fixture: Value = serde_json::from_str(GROUPS).expect("group-headers.json");
    let controls = fixture["controls"].as_object().expect("controls");
    assert_eq!(controls.len(), 3);
    for control in controls.keys() {
        // Without `pin`, the split cases don't run.
        if control == "no-split-at-edge" && !cfg!(feature = "pin") {
            continue;
        }
        assert!(
            !mismatches(Some(control)).is_empty(),
            "the {control} control passed the group-headers fixture"
        );
    }
}

// --- in a window ---

/// Rows from memory, answered when asked; every sort accepted (`sort`).
struct Memory;

struct Rows {
    rows: Range<u64>,
}

impl TallTablePage for Rows {
    fn value(&self, row: usize, _: usize) -> Option<CellValue<'_>> {
        Some(CellValue::Float((self.rows.start + row as u64) as f64))
    }

    fn heap_bytes(&self) -> usize {
        1024
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

/// `count` float columns, 120 px each (the kind's width), in groups of
/// `outer` (`g1`, `g2`, …), each cut into groups of `inner` (`g1.1`, …);
/// an `outer` of 0, none, an `inner` of 0, one level.
fn grouped(count: usize, outer: usize, inner: usize) -> Vec<TallTableColumn> {
    (0..count)
        .map(|index| {
            let column = TallTableColumn::new(format!("f{index}"), ColumnKind::Float);
            #[cfg(feature = "sort")]
            let column = column.sortable(true);
            if outer == 0 {
                return column;
            }
            let group = format!("g{}", index / outer + 1);
            match (index % outer).checked_div(inner) {
                None => column.group([group]),
                Some(within) => {
                    let inner = format!("{group}.{}", within + 1);
                    column.group([group, inner])
                }
            }
        })
        .collect()
}

type Table = TallTableState<Memory>;

/// A drawn cell: level, label, places, pinned, left, width, label's x.
type Drawn = (usize, String, Range<usize>, bool, f32, f32, f32);

/// A table in a window over 1,000 rows from memory, with the layouts and
/// the group cells it reported.
struct Sheet<'a> {
    cx: &'a mut VisualTestContext,
    table: gpui_kit::Entity<Table>,
    layouts: Rc<RefCell<Vec<crate::TallTableLayout>>>,
    groups: Rc<RefCell<Vec<Vec<crate::GroupProbe>>>>,
}

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
    /// The table in a `width`×900 window over `columns`.
    fn open(cx: &'a mut TestAppContext, width: f32, columns: Vec<TallTableColumn>) -> Self {
        cx.update(|cx| {
            gpui_kit::component::init(cx);
            crate::init(cx);
        });
        let layouts: Rc<RefCell<Vec<crate::TallTableLayout>>> = Rc::default();
        let groups: Rc<RefCell<Vec<Vec<crate::GroupProbe>>>> = Rc::default();
        let (heard, heard_groups) = (layouts.clone(), groups.clone());
        let (shell, cx) = cx.add_window_view(move |_, cx| {
            let table = cx.new(|cx| {
                TallTableState::new(Memory, columns, 1000, Default::default(), cx)
                    .probe_frames(true)
            });
            let subscription =
                cx.subscribe(&table, move |_, _, event: &TallTableEvent, _| match event {
                    TallTableEvent::Layout(layout) => heard.borrow_mut().push(layout.clone()),
                    TallTableEvent::Groups(cells) => heard_groups.borrow_mut().push(cells.clone()),
                    _ => {}
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
            layouts,
            groups,
        };
        sheet.draw();
        sheet
    }

    /// Runs what can run, then draws a frame (three times: the body is
    /// measured in the first, refitted in the second).
    fn draw(&mut self) {
        for _ in 0..3 {
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

    fn set_columns(&mut self, columns: Vec<TallTableColumn>) {
        self.update(|table, cx| table.set_columns(columns, cx));
    }

    /// The header's height: the body starts under it, at the window's top.
    fn header(&mut self) -> f32 {
        self.read(|table| f32::from(table.body.origin.y))
    }

    fn viewport_rows(&mut self) -> f64 {
        self.read(|table| table.scroll.viewport_rows())
    }

    fn cells_width(&mut self) -> f32 {
        self.read(|table| table.cells_width())
    }

    fn drawn(&mut self) -> Vec<Drawn> {
        self.read(|table| {
            table
                .group_state
                .drawn
                .iter()
                .map(|cell| {
                    (
                        cell.level,
                        cell.label.to_string(),
                        cell.start..cell.end,
                        cell.pinned,
                        cell.left,
                        cell.width,
                        cell.label_x,
                    )
                })
                .collect()
        })
    }

    /// A point `x` px right of the cells' left edge, in header row `row`
    /// counted up from the names' (0) row.
    #[cfg(any(feature = "sort", feature = "resize", feature = "select"))]
    fn header_at(&mut self, x: f32, row: f32) -> Point<Pixels> {
        let (origin, gutter) = self.read(|table| (table.body.origin, table.gutter_width()));
        point(
            origin.x + px(gutter + x),
            origin.y - row_height() * (row + 0.5),
        )
    }

    #[cfg(any(feature = "sort", feature = "resize", feature = "select"))]
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

    #[cfg(any(feature = "sort", feature = "resize"))]
    fn release(&mut self, at: Point<Pixels>) {
        self.cx.simulate_event(MouseUpEvent {
            position: at,
            modifiers: Modifiers::default(),
            button: MouseButton::Left,
            click_count: 1,
        });
        self.draw();
    }
}

#[gpui_kit::test]
fn the_header_grows_a_row_a_level(cx: &mut TestAppContext) {
    let row = f32::from(row_height());
    let mut sheet = Sheet::open(cx, 1440., grouped(30, 0, 0));
    assert_eq!(sheet.header(), row, "no paths: one row, as without");
    assert!(sheet.drawn().is_empty());
    let rows = sheet.viewport_rows();
    let last = sheet.layouts.borrow().last().cloned().expect("a layout");
    assert_eq!(last.header_rows, 1);

    sheet.set_columns(grouped(30, 10, 0));
    assert_eq!(sheet.header(), 2.0 * row, "a level");
    assert_eq!(sheet.viewport_rows(), rows - 1.0, "the body refitted");
    sheet.set_columns(grouped(30, 10, 5));
    assert_eq!(sheet.header(), 3.0 * row, "two levels");
    assert_eq!(sheet.viewport_rows(), rows - 2.0);
    let deep: Vec<TallTableColumn> = grouped(30, 0, 0)
        .into_iter()
        .map(|column| column.group(["a", "b", "c"]))
        .collect();
    sheet.set_columns(deep);
    assert_eq!(sheet.header(), 4.0 * row, "three levels");
    let last = sheet.layouts.borrow().last().cloned().expect("a layout");
    assert_eq!(last.header_rows, 4);
    assert_eq!(last.top, 4.0 * row, "the probe's cells under it");
    sheet.set_columns(grouped(30, 0, 0));
    assert_eq!(sheet.header(), row, "and back");
    assert_eq!(sheet.viewport_rows(), rows);
}

#[gpui_kit::test]
fn cells_are_cut_at_the_view_and_labeled_in_it(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, 1440., grouped(30, 10, 5));
    let width = sheet.cells_width();
    let drawn = sheet.drawn();
    let outer: Vec<_> = drawn.iter().filter(|cell| cell.0 == 0).collect();
    assert_eq!(outer[0], &(0, "g1".into(), 0..10, false, 0.0, 1200.0, 8.0));
    assert_eq!(
        outer[1],
        &(
            0,
            "g2".into(),
            10..20,
            false,
            1200.0,
            width - 1200.0,
            1208.0
        ),
        "cut at the view's right"
    );
    assert_eq!(outer.len(), 2);
    assert_eq!(drawn.iter().filter(|cell| cell.0 == 1).count(), 3);

    sheet.update(|table, cx| table.scroll_by(0.0, 900.0, cx));
    let drawn = sheet.drawn();
    assert_eq!(
        drawn[0],
        (0, "g1".into(), 0..10, false, 0.0, 300.0, 8.0),
        "scrolled half out, its label at the view's left"
    );
    assert_eq!(drawn[1].1, "g2");
    assert_eq!((drawn[1].4, drawn[1].6), (300.0, 308.0));
    let inner: Vec<_> = drawn.iter().filter(|cell| cell.0 == 1).collect();
    assert_eq!(inner[0], &(1, "g1.2".into(), 5..10, false, 0.0, 300.0, 8.0));
    // Every cell is within the view.
    for cell in &drawn {
        assert!(cell.4 >= 0.0 && cell.4 + cell.5 <= width, "{cell:?}");
    }
}

#[gpui_kit::test]
fn blanks_draw_nothing(cx: &mut TestAppContext) {
    let mut columns = grouped(6, 0, 0);
    columns[0] = columns[0].clone().group(["A", "x"]);
    columns[1] = columns[1].clone().group(["A"]);
    let mut sheet = Sheet::open(cx, 1440., columns);
    assert_eq!(sheet.header(), 3.0 * f32::from(row_height()));
    assert_eq!(
        sheet.drawn(),
        [
            (0, "A".into(), 0..2, false, 0.0, 240.0, 8.0),
            (1, "x".into(), 0..1, false, 0.0, 120.0, 8.0),
        ]
    );
}

/// The group cells are reported as they change, a sideways scroll among
/// the causes, apart from the layout, which a scroll leaves alone; with no
/// groups, nothing.
#[gpui_kit::test]
fn the_group_cells_are_reported_as_they_move(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, 1440., grouped(30, 0, 0));
    sheet.update(|table, cx| table.scroll_by(0.0, 100.0, cx));
    assert!(sheet.groups.borrow().is_empty(), "no groups, none reported");
    sheet.set_columns(grouped(30, 10, 0));
    let (layouts, reported) = (sheet.layouts.borrow().len(), sheet.groups.borrow().len());
    assert!(reported > 0, "the new columns' groups");
    sheet.update(|table, cx| table.scroll_by(0.0, 100.0, cx));
    assert_eq!(
        sheet.layouts.borrow().len(),
        layouts,
        "a sideways scroll reports no layout"
    );
    let all = sheet.groups.borrow();
    assert_eq!(all.len(), reported + 1, "the groups' cells moved");
    let groups = all.last().expect("the cells");
    assert_eq!(
        (groups[0].label.as_str(), groups[0].left, groups[0].width),
        ("g1", 0.0, 1000.0)
    );
    assert_eq!(
        (groups[0].start, groups[0].end, groups[0].pinned),
        (0, 10, false)
    );
    assert_eq!(groups[0].label_x, 8.0);
    drop(all);
    // A vertical scroll moves no group cell.
    sheet.update(|table, cx| table.scroll_by(5.0, 0.0, cx));
    assert_eq!(sheet.groups.borrow().len(), reported + 1);
}

#[cfg(feature = "reorder")]
mod reorder {
    use gpui_kit::TestAppContext;

    use super::{Sheet, grouped};

    /// A host's move splits a group into two runs, a cell each, both
    /// labeled; `set_order` too, and its own order mends it.
    #[gpui_kit::test]
    fn a_hosts_move_splits_a_run(cx: &mut TestAppContext) {
        let mut sheet = Sheet::open(cx, 1440., grouped(12, 4, 0));
        sheet.update(|table, cx| table.move_columns(5..6, 1, cx));
        let labels: Vec<_> = sheet
            .drawn()
            .into_iter()
            .map(|cell| (cell.1, cell.2))
            .collect();
        assert_eq!(
            labels,
            [
                ("g1".to_string(), 0..1),
                ("g2".into(), 1..2),
                ("g1".into(), 2..5),
                ("g2".into(), 5..8),
                ("g3".into(), 8..12),
            ]
        );
        let order: Vec<usize> = (0..12).rev().collect();
        sheet.update(|table, cx| table.set_order(order, cx));
        let labels: Vec<_> = sheet
            .drawn()
            .into_iter()
            .map(|cell| (cell.1, cell.2))
            .collect();
        assert_eq!(
            labels,
            [
                ("g3".to_string(), 0..4),
                ("g2".into(), 4..8),
                ("g1".into(), 8..12)
            ],
            "reversed, each whole"
        );
        sheet.update(|table, cx| table.set_order((0..12).collect(), cx));
        assert_eq!(sheet.drawn().len(), 3);
    }

    /// A lifted column's preview draws its name in the names' row and,
    /// above it, each group's row cut to the column.
    #[gpui_kit::test]
    fn the_preview_carries_the_groups_rows(cx: &mut TestAppContext) {
        use gpui_kit::{Modifiers, MouseButton, MouseDownEvent, point, px};

        let row = f32::from(super::row_height());
        let mut sheet = Sheet::open(cx, 1440., grouped(12, 4, 2));
        let (origin, gutter) = sheet.read(|table| (table.body.origin, table.gutter_width()));
        let at = point(
            origin.x + px(gutter + 3.0 * 120.0 + 60.0),
            origin.y - px(row / 2.0),
        );
        // With `select`, a header drags once its column is selected: the
        // first press selects it.
        let presses = if cfg!(feature = "select") { 2 } else { 1 };
        for press in 0..presses {
            sheet.cx.simulate_event(MouseDownEvent {
                position: at,
                modifiers: Modifiers::default(),
                button: MouseButton::Left,
                click_count: 1,
                first_mouse: false,
            });
            sheet.draw();
            if press + 1 < presses {
                sheet
                    .cx
                    .simulate_mouse_up(at, MouseButton::Left, Modifiers::default());
                sheet.draw();
            }
        }
        assert!(
            sheet.read(|table| table.moving.is_some()),
            "pressed to move"
        );
        sheet.cx.simulate_mouse_move(
            at + point(px(40.), px(0.)),
            MouseButton::Left,
            Modifiers::default(),
        );
        sheet.draw();
        let drawn = sheet.read(|table| table.move_drawn.borrow().clone());
        assert_eq!(drawn.names_top, 2.0 * row);
        assert_eq!(
            drawn.groups,
            [(0, 0.0, 0.0, 120.0), (1, row, 0.0, 120.0)],
            "each level cut to the column"
        );
        sheet.cx.simulate_mouse_up(
            at + point(px(40.), px(0.)),
            MouseButton::Left,
            Modifiers::default(),
        );
        sheet.draw();
    }

    /// The groups by place (`DataTable`'s spans) leave the labels where
    /// they were: the control fails the move above.
    #[gpui_kit::test]
    fn groups_by_place_fail_a_move(cx: &mut TestAppContext) {
        let mut sheet = Sheet::open(cx, 1440., grouped(12, 4, 0));
        sheet.update(|table, cx| {
            table.group_state.control = crate::groups::Control::GroupsByPlace;
            table.move_columns(5..6, 1, cx);
        });
        assert_eq!(sheet.drawn().len(), 3, "the spans stayed");
    }
}

#[cfg(feature = "pin")]
mod pin {
    use gpui_kit::{TestAppContext, px, size};

    use super::{Sheet, grouped};

    /// The pinned and scrolled cells of a run, as `(pinned, left, width)`.
    fn halves(sheet: &mut Sheet, label: &str) -> Vec<(bool, f32, f32)> {
        sheet
            .drawn()
            .into_iter()
            .filter(|cell| cell.0 == 0 && cell.1 == label)
            .map(|cell| (cell.3, cell.4, cell.5))
            .collect()
    }

    /// A run across the edge draws a cell in each region, and the cut
    /// follows the edge where it moves without a layout: a window resize
    /// and `set_pinned`.
    #[gpui_kit::test]
    fn a_run_split_at_the_edge_follows_it(cx: &mut TestAppContext) {
        let mut sheet = Sheet::open(cx, 1440., grouped(30, 10, 0));
        sheet.update(|table, cx| table.set_pinned(3, cx));
        sheet.update(|table, cx| table.scroll_by(0.0, 120.0, cx));
        assert_eq!(
            halves(&mut sheet, "g1"),
            [(true, 0.0, 360.0), (false, 360.0, 720.0)]
        );
        let generation = sheet.read(|table| table.layout_generation);
        // A narrower view: two fit in its half.
        let gutter = sheet.read(|table| table.gutter_width());
        let bar = f32::from(gpui_kit::component::scroll::Scrollbar::width());
        sheet
            .cx
            .simulate_resize(size(px(600.0 + gutter + bar), px(900.)));
        sheet.draw();
        assert_eq!(sheet.read(|table| table.pinned_in_effect()), 2);
        assert_eq!(
            halves(&mut sheet, "g1"),
            [(true, 0.0, 240.0), (false, 240.0, 360.0)]
        );
        sheet.update(|table, cx| table.set_pinned(1, cx));
        assert_eq!(
            halves(&mut sheet, "g1"),
            [(true, 0.0, 120.0), (false, 120.0, 480.0)]
        );
        assert_eq!(
            sheet.read(|table| table.layout_generation) - generation,
            2,
            "no layout: only the run in effect moved"
        );
        // The labels stay in view, each at its part's left.
        let labels: Vec<f32> = sheet
            .drawn()
            .into_iter()
            .filter(|cell| cell.1 == "g1")
            .map(|cell| cell.6)
            .collect();
        assert_eq!(labels, [8.0, 128.0]);
    }

    /// A resize's release that moves the run in effect redraws the cut:
    /// the host pins 4, 3 fit in half the view, and a pinned column
    /// narrowed lets the fourth pin at the release.
    #[cfg(feature = "resize")]
    #[gpui_kit::test]
    fn a_resize_release_moves_the_cut(cx: &mut TestAppContext) {
        use gpui_kit::point;

        let mut sheet = Sheet::open(cx, 1440., grouped(30, 10, 0));
        let gutter = sheet.read(|table| table.gutter_width());
        let bar = f32::from(gpui_kit::component::scroll::Scrollbar::width());
        sheet
            .cx
            .simulate_resize(size(px(820.0 + gutter + bar), px(900.)));
        sheet.draw();
        sheet.update(|table, cx| table.set_pinned(4, cx));
        assert_eq!(sheet.read(|table| table.pinned_in_effect()), 3);
        assert_eq!(halves(&mut sheet, "g1")[0], (true, 0.0, 360.0));
        let band = sheet.header_at(120.0 - 0.5, 0.0);
        sheet.press(band);
        let to = band - point(px(80.), px(0.));
        sheet
            .cx
            .simulate_mouse_move(to, gpui_kit::MouseButton::Left, Default::default());
        sheet.draw();
        assert_eq!(sheet.read(|table| table.pinned_in_effect()), 3, "held");
        sheet.release(to);
        assert_eq!(sheet.read(|table| table.pinned_in_effect()), 4);
        assert_eq!(
            halves(&mut sheet, "g1"),
            [(true, 0.0, 400.0), (false, 400.0, 420.0)],
            "cut at the new edge"
        );
    }
}

#[cfg(feature = "select")]
mod select {
    use gpui_kit::TestAppContext;

    use super::{Sheet, grouped};
    use crate::TallTableSelection;

    /// A group's cell takes the tint when all its columns are among the
    /// selection's, in any kind; a press on a cell or a header is as
    /// without groups.
    #[gpui_kit::test]
    fn a_group_takes_the_tint(cx: &mut TestAppContext) {
        let mut sheet = Sheet::open(cx, 1440., grouped(30, 10, 5));
        let select = |sheet: &mut Sheet, selection| {
            sheet.update(|table, cx| table.select(Some(selection), cx));
            sheet.read(|table| table.group_state.tinted.clone())
        };
        let columns = TallTableSelection::Columns {
            anchor: (0, 0),
            head: (0, 9),
        };
        assert_eq!(
            select(&mut sheet, columns),
            [(0, 0, false), (1, 0, false), (1, 5, false)]
        );
        let part = TallTableSelection::Columns {
            anchor: (0, 2),
            head: (0, 9),
        };
        assert_eq!(select(&mut sheet, part), [(1, 5, false)]);
        let block = TallTableSelection::Cells {
            anchor: (3, 0),
            head: (5, 4),
        };
        assert_eq!(select(&mut sheet, block), [(1, 0, false)]);
        sheet.update(|table, cx| table.select(None, cx));
        assert!(sheet.read(|table| table.group_state.tinted.is_empty()));

        // The names' row's press selects its column, a cell's its cell.
        let header = sheet.header_at(130.0, 0.0);
        sheet.press(header);
        assert!(matches!(
            sheet.read(|table| table.selection_state.current),
            Some(TallTableSelection::Columns {
                anchor: (_, 1),
                head: (_, 1)
            })
        ));
        let cell = sheet.header_at(250.0, -1.0);
        sheet.press(cell);
        assert!(matches!(
            sheet.read(|table| table.selection_state.current),
            Some(TallTableSelection::Cells { anchor: (0, 2), .. })
        ));
    }

    /// A press anywhere in the corner, the header's full height, is the
    /// corner's: the top row's selects as the names' row's does.
    #[gpui_kit::test]
    fn the_corner_is_the_headers_height(cx: &mut TestAppContext) {
        let mut sheet = Sheet::open(cx, 1440., grouped(30, 10, 5));
        let corner = |sheet: &mut Sheet, row: f32| {
            let at =
                sheet.header_at(0.0, row) - gpui_kit::point(gpui_kit::px(10.), gpui_kit::px(0.));
            sheet.update(|table, cx| table.select(None, cx));
            sheet.press(at);
            sheet.read(|table| table.selection_state.current)
        };
        let names = corner(&mut sheet, 0.0);
        assert!(names.is_some(), "the corner selects");
        assert_eq!(corner(&mut sheet, 2.0), names, "its top row too");
        assert_eq!(corner(&mut sheet, 3.0), None, "above the header, nothing");
    }

    /// With `pin`, both halves of a split run take the tint.
    #[cfg(feature = "pin")]
    #[gpui_kit::test]
    fn both_halves_take_the_tint(cx: &mut TestAppContext) {
        let mut sheet = Sheet::open(cx, 1440., grouped(30, 10, 0));
        sheet.update(|table, cx| table.set_pinned(3, cx));
        sheet.update(|table, cx| {
            table.select(
                Some(TallTableSelection::Columns {
                    anchor: (0, 0),
                    head: (0, 9),
                }),
                cx,
            )
        });
        assert_eq!(
            sheet.read(|table| table.group_state.tinted.clone()),
            [(0, 0, true), (0, 0, false)]
        );
    }
}

#[cfg(feature = "sort")]
mod sort {
    use gpui_kit::TestAppContext;

    use super::{Sheet, grouped};

    /// An arrow is in the names' row: a press and release there sorts, the
    /// same x in a group row doesn't.
    #[gpui_kit::test]
    fn the_arrows_are_in_the_names_row(cx: &mut TestAppContext) {
        let mut sheet = Sheet::open(cx, 1440., grouped(30, 10, 0));
        let (column, (box_x, box_w)) = sheet.read(|table| {
            let column = &table.columns[1];
            (column.x, table.arrow_box(1, column).expect("an arrow"))
        });
        let x = column + box_x + box_w / 2.0;
        let above = sheet.header_at(x, 1.0);
        sheet.press(above);
        sheet.release(above);
        assert_eq!(sheet.read(|table| table.sort()), None, "a group row");
        let arrow = sheet.header_at(x, 0.0);
        sheet.press(arrow);
        sheet.release(arrow);
        assert_eq!(
            sheet.read(|table| table.sort()).map(|sort| sort.column),
            Some(1)
        );
    }
}

#[cfg(feature = "resize")]
mod resize {
    use gpui_kit::TestAppContext;

    use super::{Sheet, grouped};

    /// A band is in the names' row: a press there resizes, the same x in a
    /// group row doesn't.
    #[gpui_kit::test]
    fn the_bands_are_in_the_names_row(cx: &mut TestAppContext) {
        let mut sheet = Sheet::open(cx, 1440., grouped(30, 10, 5));
        let above = sheet.header_at(240.0 - 0.5, 1.0);
        sheet.press(above);
        assert!(sheet.read(|table| table.resizing.is_none()), "a group row");
        sheet.release(above);
        let band = sheet.header_at(240.0 - 0.5, 0.0);
        sheet.press(band);
        assert_eq!(
            sheet.read(|table| table.resizing.map(|drag| drag.column)),
            Some(1)
        );
        sheet.release(band);
    }
}

#[cfg(feature = "density")]
mod density {
    use gpui_kit::{TestAppContext, px};

    use super::{Sheet, grouped};
    use crate::Density;

    /// Each group row is the row height in effect.
    #[gpui_kit::test]
    fn a_group_row_is_the_row_height(cx: &mut TestAppContext) {
        let mut sheet = Sheet::open(cx, 1440., grouped(30, 10, 5));
        sheet.update(|table, cx| {
            table.set_density(
                Density {
                    row_height: px(18.),
                    text_size: px(11.).into(),
                },
                cx,
            )
        });
        assert_eq!(sheet.header(), 54.0);
        let layout = sheet.layouts.borrow().last().cloned().expect("a layout");
        assert_eq!((layout.header_rows, layout.row_height), (3, 18.0));
    }
}
