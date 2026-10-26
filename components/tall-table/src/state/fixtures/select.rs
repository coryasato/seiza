//! `select`: `fixtures/selection.json`'s scenarios and their controls, and
//! what the fixture doesn't pin (the events, the frames asked for, the
//! tooltip, Escape's propagation, the drawing, `follow`), driven through
//! the element (its keys and context) and the pointer in a window of GPUI's
//! test app, over rows answered from memory.

use std::cell::{Cell as Counter, RefCell};
use std::ops::Range;
use std::rc::Rc;
use std::time::Duration;

use gpui_kit::component::scroll::Scrollbar;
use gpui_kit::{
    App, AppContext as _, Context, Entity, InteractiveElement as _, IntoElement, KeyBinding,
    Modifiers, MouseButton, MouseDownEvent, ParentElement as _, Pixels, Point, Render, ScrollDelta,
    ScrollWheelEvent, Styled as _, TestAppContext, TouchPhase, VisualTestContext, Window, actions,
    div, point, px, size,
};
use serde_json::Value;

use super::super::select::Control;
use super::super::{TallTableEvent, TallTableState, row_height};
use crate::column::{ColumnKind, TallTableColumn};
use crate::delegate::{CellValue, PageLoad, TallTableDelegate, TallTablePage};
use crate::selection::{Selectable, TallTableSelection};
use crate::tall_table::TallTable;

const SELECTION: &str = include_str!("../../../fixtures/selection.json");

actions!(select_test, [HostEscape]);

/// Rows from memory, every value its row, answered when asked; with
/// `custom-cells`, painted (`true`: the first column filled halfway).
struct Memory(bool);

struct Rows(Range<u64>, bool);

impl TallTablePage for Rows {
    fn value(&self, row: usize, _: usize) -> Option<CellValue<'_>> {
        Some(CellValue::Float((self.0.start + row as u64) as f64))
    }

    #[cfg(feature = "custom-cells")]
    fn paint(&self, _: usize, column: usize) -> crate::CellPaint {
        crate::CellPaint {
            fill: (self.1 && column == 0).then_some(0.5),
            ..Default::default()
        }
    }

    fn heap_bytes(&self) -> usize {
        1024
    }
}

impl TallTableDelegate for Memory {
    type Page = Rows;
    type Request = u64;

    fn load_page(&mut self, rows: Range<u64>, _: &mut App) -> (u64, PageLoad<Rows>) {
        let page = Rows(rows.clone(), self.0);
        (rows.start, Box::pin(std::future::ready(Ok(page))))
    }

    fn cancel(&mut self, _: u64, _: &mut App) {}
}

/// The host: the table's element in a context of its own, whose Escape
/// binding counts what the table lets through.
struct Shell {
    table: Entity<TallTableState<Memory>>,
    escapes: Rc<Counter<usize>>,
}

impl Render for Shell {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        div()
            .key_context("Host")
            .on_action(cx.listener(|this, _: &HostEscape, _, _| {
                this.escapes.set(this.escapes.get() + 1);
            }))
            .size_full()
            .child(TallTable::new(&self.table))
    }
}

/// `count` float columns, each the kind's 120 px.
fn floats(count: usize) -> Vec<TallTableColumn> {
    (0..count)
        .map(|index| TallTableColumn::new(format!("f{index}"), ColumnKind::Float))
        .collect()
}

/// A table in a window sized so its viewport holds `viewport_rows` rows
/// and its cells area is `cells_width` wide, with what it emitted.
struct Sheet<'a> {
    cx: &'a mut VisualTestContext,
    table: Entity<TallTableState<Memory>>,
    selected: Rc<RefCell<Vec<Option<TallTableSelection>>>>,
    notified: Rc<Counter<usize>>,
    /// The drawn cells, last frame, when the first column is filled.
    cells: Rc<RefCell<Vec<crate::CellProbe>>>,
    escapes: Rc<Counter<usize>>,
    /// The pointer's last position.
    pointer: Point<Pixels>,
    _subscriptions: Vec<gpui_kit::Subscription>,
}

impl<'a> Sheet<'a> {
    fn open(
        cx: &'a mut TestAppContext,
        columns: Vec<TallTableColumn>,
        rows: u64,
        viewport_rows: f64,
        cells_width: f32,
        selectable: Selectable,
    ) -> Self {
        cx.update(|cx| {
            gpui_kit::component::init(cx);
            crate::init(cx);
            cx.bind_keys([KeyBinding::new("escape", HostEscape, Some("Host"))]);
        });
        let escapes: Rc<Counter<usize>> = Rc::default();
        let host_escapes = escapes.clone();
        #[cfg(feature = "custom-cells")]
        let painted = columns.first().is_some_and(|column| column.fill.is_some());
        #[cfg(not(feature = "custom-cells"))]
        let painted = false;
        let (shell, cx) = cx.add_window_view(move |_, cx| {
            let table = cx.new(|cx| {
                let delegate = Memory(painted);
                let mut table =
                    TallTableState::new(delegate, columns, rows, Default::default(), cx)
                        .probe_frames(true)
                        .probe_cells(painted);
                table.set_selectable(selectable, cx);
                table
            });
            Shell {
                table,
                escapes: host_escapes,
            }
        });
        let table = shell.read_with(cx, |shell, _| shell.table.clone());
        // The element's 1 px border on each side, the header's row, and
        // the scrollbars.
        let (gutter, bar) = table.read_with(cx, |table, _| {
            (table.gutter_width(), f32::from(Scrollbar::width()))
        });
        let row_h = f32::from(row_height());
        cx.simulate_resize(size(
            px(cells_width + gutter + bar + 2.0),
            px(viewport_rows as f32 * row_h + row_h + bar + 2.0),
        ));
        let selected: Rc<RefCell<Vec<Option<TallTableSelection>>>> = Rc::default();
        let notified: Rc<Counter<usize>> = Rc::default();
        let cells: Rc<RefCell<Vec<crate::CellProbe>>> = Rc::default();
        let subscriptions = cx.update(|_, cx| {
            let (selected, cells) = (selected.clone(), cells.clone());
            let notified = notified.clone();
            vec![
                cx.subscribe(&table, move |_, event: &TallTableEvent, _| match event {
                    TallTableEvent::Selected(selection) => selected.borrow_mut().push(*selection),
                    TallTableEvent::Cells(drawn) => *cells.borrow_mut() = drawn.clone(),
                    _ => {}
                }),
                cx.observe(&table, move |_, _| notified.set(notified.get() + 1)),
            ]
        });
        let mut sheet = Self {
            cx,
            table,
            selected,
            notified,
            cells,
            escapes,
            pointer: point(px(0.), px(0.)),
            _subscriptions: subscriptions,
        };
        sheet.draw();
        sheet.focus();
        let (viewport, width) =
            sheet.read(|table| (table.scroll.viewport_rows(), table.cells_width()));
        assert_eq!(
            (viewport, width),
            (viewport_rows, cells_width),
            "the window's size"
        );
        sheet
    }

    fn draw(&mut self) {
        for _ in 0..2 {
            self.cx.run_until_parked();
            self.cx.update(|window, cx| window.draw(cx).clear(cx));
        }
    }

    fn focus(&mut self) {
        let handle = self.read(|table| table.focus_handle.clone());
        self.cx.update(|window, cx| window.focus(&handle, cx));
        self.draw();
    }

    fn read<T>(&mut self, read: impl FnOnce(&TallTableState<Memory>) -> T) -> T {
        self.table.read_with(self.cx, |table, _| read(table))
    }

    fn update<T>(
        &mut self,
        update: impl FnOnce(&mut TallTableState<Memory>, &mut Context<TallTableState<Memory>>) -> T,
    ) -> T {
        let result = self.table.update(self.cx, update);
        self.draw();
        result
    }

    fn selection(&mut self) -> Option<TallTableSelection> {
        self.read(|table| table.selection())
    }

    /// Where a fixture's target is, in window pixels: a visible cell's
    /// middle, a row's in the gutter, a column's in the header, the
    /// corner, or past the cells' right (`right`, level with a row) or
    /// bottom edge (`below`, under a column), over the scrollbars.
    fn at(&mut self, target: &Value) -> Point<Pixels> {
        let row_h = f32::from(row_height());
        let (body, gutter, top, scroll_x, view_h, cells_w, xs, visible) = self.read(|table| {
            (
                table.body,
                table.gutter_width(),
                table.scroll.top(),
                table.scroll_x,
                f32::from(table.viewport().height),
                table.cells_width(),
                table
                    .columns
                    .iter()
                    .map(|column| column.x + column.width / 2.0)
                    .collect::<Vec<_>>(),
                table.scroll.visible(),
            )
        });
        let (left, top_y) = (f32::from(body.origin.x), f32::from(body.origin.y));
        let row_y = |row: u64| {
            assert!(visible.contains(&row), "row {row} isn't in view: {target}");
            top_y + ((row as f64 - top) as f32 + 0.5) * row_h
        };
        let column_x = |column: usize| left + gutter + xs[column] - scroll_x;
        let number = |key: &str| target[key].as_u64();
        let (x, y) = if let Some(cell) = target["cell"].as_array() {
            let (row, column) = (
                cell[0].as_u64().unwrap(),
                cell[1].as_u64().unwrap() as usize,
            );
            (column_x(column), row_y(row))
        } else if let Some(row) = number("gutter") {
            (left + gutter / 2.0, row_y(row))
        } else if let Some(column) = number("header") {
            (column_x(column as usize), top_y - row_h / 2.0)
        } else if target["corner"] == true {
            (left + gutter / 2.0, top_y - row_h / 2.0)
        } else if let Some(row) = number("right") {
            (left + gutter + cells_w + 4.0, row_y(row))
        } else if let Some(column) = number("below") {
            (column_x(column as usize), top_y + view_h + 4.0)
        } else {
            panic!("an unknown target: {target}");
        };
        point(px(x), px(y))
    }

    fn press(&mut self, at: Point<Pixels>, modifiers: Modifiers, clicks: usize) {
        self.pointer = at;
        self.cx.simulate_event(MouseDownEvent {
            position: at,
            modifiers,
            button: MouseButton::Left,
            click_count: clicks,
            first_mouse: false,
        });
        self.draw();
    }

    fn drag_to(&mut self, at: Point<Pixels>) {
        self.pointer = at;
        self.cx
            .simulate_mouse_move(at, MouseButton::Left, Modifiers::default());
        self.draw();
    }

    fn release(&mut self) {
        self.cx
            .simulate_mouse_up(self.pointer, MouseButton::Left, Modifiers::default());
        self.draw();
    }

    fn wheel(&mut self, at: Point<Pixels>, rows: f32) {
        self.pointer = at;
        self.cx.simulate_event(ScrollWheelEvent {
            position: at,
            delta: ScrollDelta::Lines(point(0., -rows)),
            modifiers: Modifiers::default(),
            touch_phase: TouchPhase::Moved,
        });
        self.draw();
    }

    fn key(&mut self, keys: &str) {
        self.cx.simulate_keystrokes(keys);
        self.draw();
    }
}

// --- selection.json ---

fn selection_json(selection: Option<TallTableSelection>) -> Value {
    match selection {
        None => Value::Null,
        Some(selection) => {
            let (anchor, head) = (selection.anchor(), selection.head());
            serde_json::json!({
                "kind": selection.kind().as_str(),
                "anchor": [anchor.0, anchor.1],
                "head": [head.0, head.1],
            })
        }
    }
}

fn selectable_of(kinds: &Value) -> Selectable {
    let on = |kind: &str| {
        kinds
            .as_array()
            .expect("selectable")
            .iter()
            .any(|value| value == kind)
    };
    Selectable::none()
        .rows(on("rows"))
        .columns(on("columns"))
        .cells(on("cells"))
}

fn control_of(name: &str) -> Control {
    match name {
        "loop" => Control::Loop,
        "center" => Control::Center,
        "plain-moves-head" => Control::PlainMovesHead,
        "extend-across" => Control::ExtendAcross,
        "keep-past-rows" => Control::KeepPastRows,
        name => panic!("an unknown control: {name}"),
    }
}

/// Each step that ended other than the fixture expects, under `control`.
fn selection_mismatches(cx: &mut TestAppContext, control: Control) -> Vec<String> {
    let fixture: Value = serde_json::from_str(SELECTION).expect("selection.json");
    let number = |key: &str| fixture[key].as_f64().expect(key);
    let (count, width) = (number("columns") as usize, number("column_width") as f32);
    let mut mismatches = Vec::new();
    for scenario in fixture["scenarios"].as_array().expect("scenarios") {
        let name = scenario["name"].as_str().expect("a name");
        let rows = scenario["rows"].as_u64().unwrap_or(number("rows") as u64);
        let mut sheet = Sheet::open(
            cx,
            floats(count),
            rows,
            number("viewport_rows"),
            number("cells_width") as f32,
            selectable_of(&scenario["selectable"]),
        );
        sheet.update(|table, _| table.selection_state.control = control);
        let widths = sheet.read(|table| {
            table
                .columns
                .iter()
                .map(|column| column.width)
                .collect::<Vec<_>>()
        });
        assert!(
            widths.iter().all(|w| *w == width),
            "the fixture's widths: {widths:?}"
        );
        for (index, step) in scenario["steps"]
            .as_array()
            .expect("steps")
            .iter()
            .enumerate()
        {
            let action = step
                .as_object()
                .and_then(|step| {
                    step.keys()
                        .find(|key| !["expect", "why"].contains(&key.as_str()))
                })
                .cloned()
                .expect("a step has an action");
            let argument = &step[action.as_str()];
            match action.as_str() {
                "press" => {
                    let at = sheet.at(argument);
                    let flag = |key: &str| argument[key] == true;
                    let modifiers = Modifiers {
                        shift: flag("shift"),
                        control: flag("ctrl"),
                        platform: flag("cmd"),
                        ..Modifiers::default()
                    };
                    sheet.press(at, modifiers, 1);
                }
                "drag" => {
                    let at = sheet.at(argument);
                    sheet.drag_to(at);
                }
                "release" => sheet.release(),
                "wheel" => {
                    let at = sheet.at(&argument["at"]);
                    sheet.wheel(at, argument["rows"].as_f64().expect("rows") as f32);
                }
                "key" => sheet.key(argument.as_str().expect("a key")),
                "rows" => {
                    let rows = argument.as_u64().expect("rows: a count");
                    sheet.update(|table, cx| table.set_rows(rows, cx));
                }
                "columns" => sheet.update(|table, cx| table.set_columns(floats(count), cx)),
                "jump" => {
                    let row = argument.as_u64().expect("jump: a row");
                    sheet.update(|table, cx| table.jump_to(row, cx));
                }
                action => panic!("{name}: an unknown action {action}"),
            }
            let got = serde_json::json!({
                "selection": selection_json(sheet.selection()),
                "top": sheet.read(|table| table.scroll.top()),
                "scroll_x": sheet.read(|table| table.scroll_x),
            });
            let expect = &step["expect"];
            let same = got["selection"] == expect["selection"]
                && got["top"].as_f64() == expect["top"].as_f64()
                && got["scroll_x"].as_f64() == expect["scroll_x"].as_f64();
            if !same {
                mismatches.push(format!(
                    "{name}, step {} ({action} {argument}): {got}; the fixture's {expect}",
                    index + 1
                ));
            }
        }
    }
    mismatches
}

#[gpui_kit::test]
fn selection_scenarios(cx: &mut TestAppContext) {
    let mismatches = selection_mismatches(cx, Control::None);
    assert!(mismatches.is_empty(), "{mismatches:#?}");
}

#[gpui_kit::test]
fn selection_controls_fail(cx: &mut TestAppContext) {
    let fixture: Value = serde_json::from_str(SELECTION).expect("selection.json");
    for name in fixture["controls"].as_array().expect("controls") {
        let name = name.as_str().expect("a control");
        assert!(
            !selection_mismatches(cx, control_of(name)).is_empty(),
            "the control {name} passed the selection fixture"
        );
    }
}

// --- what the fixture doesn't pin ---

fn open(cx: &mut TestAppContext, rows: u64, selectable: Selectable) -> Sheet<'_> {
    Sheet::open(cx, floats(12), rows, 20.0, 600.0, selectable)
}

fn cell(sheet: &mut Sheet, row: u64, column: usize) -> Point<Pixels> {
    sheet.at(&serde_json::json!({"cell": [row, column]}))
}

#[gpui_kit::test]
fn a_drag_asks_a_frame_only_when_the_selection_changes(cx: &mut TestAppContext) {
    let mut sheet = open(cx, 1000, Selectable::none().rows(true));
    let at = cell(&mut sheet, 3, 0);
    sheet.press(at, Modifiers::default(), 1);
    assert_eq!(sheet.selected.borrow().len(), 1);
    let (events, frames) = (sheet.selected.borrow().len(), sheet.notified.get());
    for column in 1..5 {
        let at = cell(&mut sheet, 3, column);
        sheet.drag_to(at);
    }
    assert_eq!(
        sheet.selected.borrow().len(),
        events,
        "a Rows drag along a row"
    );
    assert_eq!(sheet.notified.get(), frames, "no frame asked");
    let at = cell(&mut sheet, 5, 4);
    sheet.drag_to(at);
    assert_eq!(sheet.selected.borrow().len(), events + 1);
    assert!(sheet.notified.get() > frames);
    sheet.release();
}

#[gpui_kit::test]
fn the_release_ends_it_off_the_table(cx: &mut TestAppContext) {
    let mut sheet = open(cx, 1000, Selectable::all());
    let at = cell(&mut sheet, 2, 2);
    sheet.press(at, Modifiers::default(), 1);
    sheet.pointer = point(px(-40.), px(-40.));
    sheet.release();
    assert!(!sheet.read(|table| table.is_selecting()));
    // A move with no button down ends a drag whose release never came.
    let at = cell(&mut sheet, 2, 2);
    sheet.press(at, Modifiers::default(), 1);
    sheet.cx.simulate_mouse_move(at, None, Modifiers::default());
    sheet.draw();
    assert!(!sheet.read(|table| table.is_selecting()));
}

#[gpui_kit::test]
fn a_double_click_selects_nothing_more(cx: &mut TestAppContext) {
    let mut sheet = open(cx, 1000, Selectable::all());
    let at = cell(&mut sheet, 2, 2);
    sheet.press(at, Modifiers::default(), 1);
    sheet.release();
    let shift = Modifiers {
        shift: true,
        ..Modifiers::default()
    };
    let other = cell(&mut sheet, 6, 4);
    sheet.press(other, shift, 2);
    assert!(!sheet.read(|table| table.is_selecting()), "no drag");
    assert_eq!(
        sheet.selected.borrow().len(),
        1,
        "the second press: nothing"
    );
}

#[gpui_kit::test]
fn no_tooltip_while_selecting(cx: &mut TestAppContext) {
    let mut sheet = open(cx, 1000, Selectable::all());
    let at = cell(&mut sheet, 2, 2);
    sheet.press(at, Modifiers::default(), 1);
    // A cell whose value (row 7, "7.0") isn't rounded or cut has no tooltip,
    // so the hover is what's watched.
    let at = cell(&mut sheet, 7, 3);
    sheet.drag_to(at);
    sheet
        .cx
        .executor()
        .advance_clock(Duration::from_millis(600));
    sheet.draw();
    assert!(
        sheet.read(|table| table.hover.is_none()),
        "no hover during the drag"
    );
    sheet.release();
    sheet
        .cx
        .simulate_mouse_move(at + point(px(1.), px(0.)), None, Modifiers::default());
    sheet.draw();
    assert!(
        sheet.read(|table| table.hover.is_some()),
        "the control: hovered after"
    );
}

#[gpui_kit::test]
fn escape_goes_on_with_nothing_selected(cx: &mut TestAppContext) {
    let mut sheet = open(cx, 1000, Selectable::all());
    sheet.key("down");
    assert!(sheet.selection().is_some());
    sheet.key("escape");
    assert_eq!(sheet.selection(), None);
    assert_eq!(sheet.escapes.get(), 0, "it cleared the selection");
    sheet.key("escape");
    assert_eq!(sheet.escapes.get(), 1, "nothing selected: the host's");
}

#[gpui_kit::test]
fn no_kind_on_keeps_the_base_keys(cx: &mut TestAppContext) {
    let mut sheet = open(cx, 1000, Selectable::none());
    for (keys, top) in [
        ("down", 1.0),
        ("pagedown", 20.0),
        ("up", 19.0),
        ("end", 980.0),
        ("home", 0.0),
    ] {
        sheet.key(keys);
        assert_eq!(sheet.read(|table| table.scroll.top()), top, "{keys}");
    }
    sheet.key("escape");
    assert_eq!(sheet.escapes.get(), 1, "the host's");
    assert!(sheet.selected.borrow().is_empty());
}

#[gpui_kit::test]
fn set_selectable_clears_a_kind_turned_off(cx: &mut TestAppContext) {
    let mut sheet = open(cx, 1000, Selectable::all());
    let at = sheet.at(&serde_json::json!({"gutter": 4}));
    sheet.press(at, Modifiers::default(), 1);
    sheet.release();
    sheet.update(|table, cx| table.set_selectable(Selectable::all().cells(false), cx));
    assert!(sheet.selection().is_some(), "rows are still on");
    sheet.update(|table, cx| table.set_selectable(Selectable::all().rows(false), cx));
    assert_eq!(sheet.selection(), None);
    assert_eq!(
        *sheet.selected.borrow().last().unwrap(),
        None,
        "with the event"
    );
}

#[gpui_kit::test]
fn select_sets_it_without_scrolling(cx: &mut TestAppContext) {
    let mut sheet = open(cx, 1000, Selectable::all());
    let far = TallTableSelection::Cells {
        anchor: (500, 9),
        head: (600, 11),
    };
    sheet.update(|table, cx| table.select(Some(far), cx));
    assert_eq!(sheet.selection(), Some(far));
    assert_eq!(
        sheet.read(|table| (table.scroll.top(), table.scroll_x)),
        (0.0, 0.0)
    );
    sheet.update(|table, cx| table.select(Some(far), cx));
    assert_eq!(sheet.selected.borrow().len(), 1, "unchanged: no event");
}

#[gpui_kit::test]
fn a_band_press_resizes_and_selects_nothing(cx: &mut TestAppContext) {
    if !cfg!(feature = "resize") {
        return;
    }
    let mut sheet = open(cx, 1000, Selectable::all());
    let x = sheet.read(|table| {
        f32::from(table.body.origin.x) + table.gutter_width() + table.columns[0].width - 0.5
    });
    let y = sheet.read(|table| f32::from(table.body.origin.y)) - f32::from(row_height()) / 2.0;
    sheet.press(point(px(x), px(y)), Modifiers::default(), 1);
    assert_eq!(sheet.selection(), None);
    #[cfg(feature = "resize")]
    assert!(sheet.read(|table| table.resizing.is_some()), "it resizes");
    sheet.release();
}

#[gpui_kit::test]
fn a_jumps_mark_is_drawn_only_when_it_selects_nothing(cx: &mut TestAppContext) {
    let mut sheet = open(cx, 1000, Selectable::all());
    sheet.update(|table, cx| table.jump_to(300, cx));
    assert_eq!(
        sheet.read(|table| (table.marked, table.drawn_mark())),
        (Some(300), None)
    );
    sheet.key("down");
    assert_eq!(
        sheet.read(|table| table.drawn_mark()),
        None,
        "nor after it moves on"
    );
    sheet.update(|table, cx| table.set_selectable(Selectable::none().columns(true), cx));
    sheet.update(|table, cx| table.jump_to(400, cx));
    assert_eq!(
        sheet.read(|table| table.drawn_mark()),
        Some(400),
        "columns only: drawn"
    );
    let marked = sheet.read(|table| {
        table
            .published_probe
            .as_ref()
            .and_then(|probe| probe.marked)
    });
    assert_eq!(marked, Some(400), "the probe's mark");
}

// --- the drawing ---

#[gpui_kit::test]
fn the_tint_is_the_ranges_visible_part(cx: &mut TestAppContext) {
    let mut sheet = open(cx, 1000, Selectable::all());
    let row_h = f32::from(row_height());
    sheet.update(|table, cx| {
        table.select(
            Some(TallTableSelection::Cells {
                anchor: (2, 1),
                head: (4, 2),
            }),
            cx,
        )
    });
    let drawn = sheet.read(|table| table.selection_state.drawn.clone());
    let tint = drawn.tint.expect("a tint");
    assert_eq!(
        (f32::from(tint.origin.x), f32::from(tint.origin.y)),
        (120.0, 2.0 * row_h)
    );
    assert_eq!(
        (f32::from(tint.size.width), f32::from(tint.size.height)),
        (240.0, 3.0 * row_h)
    );
    assert_eq!(drawn.gutter, vec![2, 3, 4]);
    assert_eq!(drawn.header, vec![1, 2]);
    let active = drawn.active.expect("focused: the active cell's edge");
    assert_eq!(
        (f32::from(active.origin.x), f32::from(active.origin.y)),
        (120.0, 2.0 * row_h)
    );

    // A range going on past the view: its edges past the view's.
    sheet.update(|table, cx| {
        table.select(
            Some(TallTableSelection::Columns {
                anchor: (0, 3),
                head: (0, 11),
            }),
            cx,
        )
    });
    sheet.update(|table, cx| table.scroll_by(10.0, 0.0, cx));
    let drawn = sheet.read(|table| table.selection_state.drawn.clone());
    let tint = drawn.tint.expect("a tint");
    assert_eq!(f32::from(tint.origin.y), -1.0);
    assert_eq!(f32::from(tint.origin.x), 360.0);
    assert_eq!(f32::from(tint.origin.x + tint.size.width), 601.0);
    assert_eq!(
        drawn.gutter,
        (10..30).collect::<Vec<_>>(),
        "every visible row's number"
    );
    assert_eq!(drawn.header, vec![3, 4]);
    assert_eq!(drawn.active, None, "the active cell is off screen");

    // Off screen altogether: nothing.
    sheet.update(|table, cx| {
        table.select(
            Some(TallTableSelection::Rows {
                anchor: (500, 0),
                head: (600, 0),
            }),
            cx,
        )
    });
    let drawn = sheet.read(|table| table.selection_state.drawn.clone());
    assert_eq!((drawn.tint, drawn.gutter.len()), (None, 0));
}

#[gpui_kit::test]
fn every_row_is_one_tint(cx: &mut TestAppContext) {
    let mut sheet = open(cx, 1_567_523, Selectable::all());
    let at = sheet.at(&serde_json::json!({"gutter": 0}));
    sheet.press(at, Modifiers::default(), 1);
    sheet.release();
    sheet.key("shift-end");
    assert_eq!(
        sheet.selection(),
        Some(TallTableSelection::Rows {
            anchor: (0, 0),
            head: (1_567_522, 0),
        })
    );
    sheet.update(|table, cx| table.scroll_by(-700_000.0, 0.0, cx));
    let drawn = sheet.read(|table| table.selection_state.drawn.clone());
    let tint = drawn.tint.expect("one tint");
    let view_h = sheet.read(|table| f32::from(table.viewport().height));
    assert_eq!(f32::from(tint.origin.y), -1.0);
    assert_eq!(f32::from(tint.origin.y + tint.size.height), view_h + 1.0);
    assert_eq!(drawn.header.len(), 5, "every visible column's header");
}

#[gpui_kit::test]
fn the_active_cell_is_edged_only_while_focused(cx: &mut TestAppContext) {
    let mut sheet = open(cx, 1000, Selectable::all());
    for selectable in [
        Selectable::none().rows(true),
        Selectable::none().columns(true),
        Selectable::none().cells(true),
    ] {
        sheet.update(|table, cx| table.set_selectable(selectable, cx));
        sheet.key("down");
        let drawn = sheet.read(|table| table.selection_state.drawn.clone());
        assert!(drawn.active.is_some(), "{selectable:?}: edged");
        sheet.key("escape");
    }
    sheet.key("down");
    sheet.cx.update(|window, cx| window.blur(cx));
    sheet.draw();
    let drawn = sheet.read(|table| table.selection_state.drawn.clone());
    assert!(
        drawn.tint.is_some() && drawn.active.is_none(),
        "blurred: no edge"
    );
}

#[cfg(feature = "follow")]
#[gpui_kit::test]
fn a_head_moved_down_at_the_end_keeps_following(cx: &mut TestAppContext) {
    let mut sheet = open(cx, 1000, Selectable::all());
    sheet.update(|table, cx| table.follow(cx));
    assert!(sheet.read(|table| table.is_following()));
    let at = cell(&mut sheet, 995, 0);
    sheet.press(at, Modifiers::default(), 1);
    sheet.release();
    sheet.key("shift-down");
    assert!(
        sheet.read(|table| table.is_following()),
        "a move down keeps it"
    );
    sheet.update(|table, cx| table.set_rows(1010, cx));
    sheet.key("down");
    assert!(sheet.read(|table| table.is_following()));
    sheet.key("up");
    assert!(
        sheet.read(|table| table.is_following()),
        "in view: no scroll up"
    );
    sheet.key("cmd-up");
    assert!(
        !sheet.read(|table| table.is_following()),
        "to the top: let go"
    );
}

#[gpui_kit::test]
fn a_wheel_during_a_drag_pages_as_the_bases(cx: &mut TestAppContext) {
    let mut sheet = open(cx, 1_000_000, Selectable::all());
    let at = cell(&mut sheet, 3, 1);
    sheet.press(at, Modifiers::default(), 1);
    let header = sheet.at(&serde_json::json!({"header": 2}));
    sheet.drag_to(header);
    sheet.wheel(header, 500_000.0);
    let (top, loaded) = sheet.read(|table| {
        let visible = table.scroll.visible();
        let loaded = visible
            .clone()
            .all(|row| matches!(table.cache.row(row), crate::pages::RowState::Loaded(..)));
        (table.scroll.top(), loaded)
    });
    assert_eq!(top, 500_000.0);
    assert!(
        loaded,
        "the rows the wheel reached load, with no drag settle"
    );
    assert_eq!(
        sheet.selection().map(|selection| selection.head()),
        Some((500_000, 2))
    );
    sheet.release();
}

/// The tint is its own canvas after the fills' and before the text: a
/// filled cell under it draws its fill and text as without a selection,
/// and the tint covers it.
#[cfg(feature = "custom-cells")]
#[gpui_kit::test]
fn a_fill_stays_under_the_tint(cx: &mut TestAppContext) {
    let stops: [crate::Stop; 2] = [|_| gpui_kit::red(), |_| gpui_kit::blue()];
    let mut columns = floats(12);
    columns[0] = columns[0].clone().fill(crate::Ramp::new(&stops));
    let mut sheet = Sheet::open(cx, columns, 1000, 20.0, 600.0, Selectable::all());
    let paint = |sheet: &mut Sheet| {
        sheet
            .cells
            .borrow()
            .iter()
            .find(|cell| (cell.row, cell.column) == (2, 0))
            .map(|cell| cell.paint.clone())
            .expect("cell (2, 0) drawn")
    };
    let before = paint(&mut sheet);
    assert!(before.fill.is_some(), "filled");
    let at = cell(&mut sheet, 2, 0);
    sheet.press(at, Modifiers::default(), 1);
    sheet.release();
    assert_eq!(paint(&mut sheet), before, "the fill and text as they were");
    let row_h = f32::from(row_height());
    let tint = sheet.read(|table| table.selection_state.drawn.tint);
    assert_eq!(
        tint,
        Some(gpui_kit::Bounds::new(
            point(px(0.), px(2.0 * row_h)),
            size(px(120.), px(row_h))
        ))
    );
}

#[gpui_kit::test]
fn a_press_after_a_hover_shows_no_tooltip_during_the_drag(cx: &mut TestAppContext) {
    let mut sheet = open(cx, 1000, Selectable::all());
    // The pointer comes to rest on a cell: its rest timer starts.
    let at = cell(&mut sheet, 4, 1);
    sheet.cx.simulate_mouse_move(at, None, Modifiers::default());
    sheet.draw();
    assert!(sheet.read(|table| table.hover.is_some()), "hovered");
    sheet.press(at, Modifiers::default(), 1);
    let away = cell(&mut sheet, 9, 3);
    sheet.drag_to(away);
    sheet
        .cx
        .executor()
        .advance_clock(Duration::from_millis(600));
    sheet.draw();
    assert!(
        sheet.read(|table| table.hover.is_none()),
        "the hover went with the press"
    );
    sheet.release();
}

#[gpui_kit::test]
fn an_extended_head_scrolls_only_along_the_range(cx: &mut TestAppContext) {
    let mut sheet = open(cx, 1000, Selectable::all());
    // A Columns range from the top row, then the view scrolled down.
    let at = sheet.at(&serde_json::json!({"header": 1}));
    sheet.press(at, Modifiers::default(), 1);
    sheet.release();
    sheet.update(|table, cx| table.scroll_by(500.0, 0.0, cx));
    sheet.key("shift-right");
    assert_eq!(
        sheet.selection(),
        Some(TallTableSelection::Columns {
            anchor: (0, 1),
            head: (0, 2),
        })
    );
    assert_eq!(
        sheet.read(|table| table.scroll.top()),
        500.0,
        "no scroll back up"
    );
    // A Rows range from the first column, then the view scrolled sideways.
    sheet.update(|table, cx| table.scroll_by(-500.0, 0.0, cx));
    let at = sheet.at(&serde_json::json!({"gutter": 2}));
    sheet.press(at, Modifiers::default(), 1);
    sheet.release();
    sheet.update(|table, cx| table.scroll_by(0.0, 600.0, cx));
    sheet.key("shift-down");
    assert_eq!(
        sheet.selection(),
        Some(TallTableSelection::Rows {
            anchor: (2, 0),
            head: (3, 0),
        })
    );
    assert_eq!(
        sheet.read(|table| table.scroll_x),
        600.0,
        "no scroll back left"
    );
}

#[gpui_kit::test]
fn the_tint_ends_at_the_last_row(cx: &mut TestAppContext) {
    let mut sheet = open(cx, 5, Selectable::all());
    let at = sheet.at(&serde_json::json!({"header": 0}));
    sheet.press(at, Modifiers::default(), 1);
    sheet.release();
    let tint = sheet
        .read(|table| table.selection_state.drawn.tint)
        .expect("a tint");
    assert_eq!(
        f32::from(tint.origin.y + tint.size.height),
        5.0 * f32::from(row_height()),
        "not into the empty view below"
    );
}

#[gpui_kit::test]
fn a_change_mid_drag_ends_the_drag(cx: &mut TestAppContext) {
    let mut sheet = open(cx, 1000, Selectable::all());
    for keys in ["escape", "cmd-a", "down"] {
        let at = cell(&mut sheet, 3, 1);
        sheet.press(at, Modifiers::default(), 1);
        assert!(sheet.read(|table| table.is_selecting()));
        sheet.key(keys);
        assert!(!sheet.read(|table| table.is_selecting()), "{keys} ends it");
        let selection = sheet.selection();
        let away = cell(&mut sheet, 8, 4);
        sheet.drag_to(away);
        assert_eq!(
            sheet.selection(),
            selection,
            "{keys}: the pointer moves nothing"
        );
        sheet.release();
    }
    // Nor does the wheel stay captured: over the header it scrolls nothing.
    let at = cell(&mut sheet, 3, 1);
    sheet.press(at, Modifiers::default(), 1);
    sheet.key("escape");
    let header = sheet.at(&serde_json::json!({"header": 1}));
    sheet.wheel(header, 10.0);
    assert_eq!(sheet.read(|table| table.scroll.top()), 0.0);
    sheet.release();
}

#[gpui_kit::test]
fn turning_jumps_selection_off_draws_its_mark(cx: &mut TestAppContext) {
    let mut sheet = open(cx, 1000, Selectable::all());
    sheet.update(|table, cx| table.jump_to(500, cx));
    assert_eq!(sheet.read(|table| table.drawn_mark()), None);
    sheet.update(|table, cx| table.set_selectable(Selectable::none(), cx));
    assert_eq!(sheet.selection(), None);
    assert_eq!(sheet.read(|table| table.drawn_mark()), Some(500));
}

#[gpui_kit::test]
fn select_clamps_past_the_end(cx: &mut TestAppContext) {
    let mut sheet = open(cx, 1000, Selectable::all());
    sheet.update(|table, cx| {
        table.select(
            Some(TallTableSelection::Cells {
                anchor: (900, 3),
                head: (2_000_000, 40),
            }),
            cx,
        )
    });
    let clamped = Some(TallTableSelection::Cells {
        anchor: (900, 3),
        head: (999, 11),
    });
    assert_eq!(sheet.selection(), clamped);
    assert_eq!(*sheet.selected.borrow(), vec![clamped], "with the event");
    sheet.update(|table, cx| table.set_rows(0, cx));
    sheet.update(|table, cx| {
        table.select(
            Some(TallTableSelection::Columns {
                anchor: (0, 0),
                head: (0, 2),
            }),
            cx,
        )
    });
    assert_eq!(sheet.selection(), None, "no rows: nothing to clamp to");
}

#[gpui_kit::test]
#[should_panic(expected = "while that kind is off")]
fn select_of_a_kind_thats_off_asserts(cx: &mut TestAppContext) {
    let mut sheet = open(cx, 1000, Selectable::all().columns(false));
    sheet.update(|table, cx| {
        table.select(
            Some(TallTableSelection::Columns {
                anchor: (0, 0),
                head: (0, 2),
            }),
            cx,
        )
    });
}
