//! `clicks`: no fixture (no DOM contender level), so only the window's
//! checks, driven through the element and the pointer in a window of GPUI's
//! test app, over rows answered from memory: each kind on each target, at
//! the pointer and with the modifiers; the table's own count of left
//! presses; Ctrl+press with the host's setting on and off (and on, a
//! `ContextMenuExt` round the table opening nothing: a Mac browser's
//! Ctrl+click is a left press, and it opens on the right button); the scrollbars',
//! bands', and arrows' right and long presses stopped (a listener and a
//! `ContextMenuExt` round the table never see them); a long press at its
//! start; a scrolled and a sideways-scrolled table; the right press's
//! focus, tooltip, and propagation. With `select`: the event after the
//! press's selection, Sheets' rule for a context press, and nothing during
//! a drag. With `resize`, `sort`, and `reorder`: what their presses keep.

use std::cell::{Cell as Counter, RefCell};
use std::ops::Range;
use std::rc::Rc;
use std::time::Duration;

use gpui_kit::component::menu::ContextMenuExt as _;
use gpui_kit::component::scroll::Scrollbar;
use gpui_kit::{
    App, AppContext as _, Context, Entity, FocusHandle, InteractiveElement as _, IntoElement,
    LongPressEvent, Modifiers, MouseButton, MouseDownEvent, ParentElement as _, Pixels, Point,
    Render, ScrollDelta, ScrollEvent, ScrollSource, Styled as _, TestAppContext, TouchPhase,
    VisualTestContext, Window, div, point, px, size,
};

use super::super::{TallTableEvent, TallTableState, row_height};
use crate::click::{ClickKind, ClickTarget, TallTableClick};
use crate::column::{ColumnKind, TallTableColumn};
use crate::delegate::{CellValue, PageLoad, TallTableDelegate, TallTablePage};
#[cfg(feature = "select")]
use crate::selection::TallTableSelection;
use crate::tall_table::TallTable;

/// Rows from memory, each value its row and a third: rounded when drawn,
/// so a rested pointer shows a tooltip.
struct Memory {
    next: u64,
}

struct Rows(Range<u64>);

impl TallTablePage for Rows {
    fn value(&self, row: usize, _: usize) -> Option<CellValue<'_>> {
        Some(CellValue::Float(
            (self.0.start + row as u64) as f64 + 1.0 / 3.0,
        ))
    }

    fn heap_bytes(&self) -> usize {
        1024
    }
}

impl TallTableDelegate for Memory {
    type Page = Rows;
    type Request = u64;

    fn load_page(&mut self, rows: Range<u64>, _: &mut App) -> (u64, PageLoad<Rows>) {
        self.next += 1;
        (self.next, Box::pin(std::future::ready(Ok(Rows(rows)))))
    }

    fn cancel(&mut self, _: u64, _: &mut App) {}
}

/// The host: the table in a `div` that counts the right presses that reach
/// it and, with `menu`, a gpui-kit `ContextMenuExt` that counts the menus
/// it builds, as a host's menu would be hung.
struct Shell {
    table: Entity<TallTableState<Memory>>,
    menu: bool,
    right_presses: Rc<Counter<usize>>,
    menus: Rc<Counter<usize>>,
    /// Somewhere else to put focus.
    elsewhere: FocusHandle,
}

impl Render for Shell {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let right_presses = self.right_presses.clone();
        let host = div()
            .id("host")
            .size_full()
            .on_mouse_down(MouseButton::Right, move |_, _, _| {
                right_presses.set(right_presses.get() + 1);
            })
            .child(TallTable::new(&self.table));
        let _ = cx;
        if self.menu {
            let menus = self.menus.clone();
            host.context_menu(move |menu, _, _| {
                menus.set(menus.get() + 1);
                menu
            })
            .into_any_element()
        } else {
            host.into_any_element()
        }
    }
}

/// `count` float columns, each the kind's 120 px.
fn floats(count: usize) -> Vec<TallTableColumn> {
    (0..count)
        .map(|index| TallTableColumn::new(format!("f{index}"), ColumnKind::Float))
        .collect()
}

/// What the table emitted, in order: a click, or a selection's change.
#[derive(Debug, Clone, PartialEq)]
enum Heard {
    Clicked(TallTableClick),
    #[cfg(feature = "select")]
    Selected(Option<TallTableSelection>),
}

/// A table in a window sized so its viewport holds `viewport_rows` rows
/// and its cells area is `cells_width` wide.
struct Sheet<'a> {
    cx: &'a mut VisualTestContext,
    shell: Entity<Shell>,
    table: Entity<TallTableState<Memory>>,
    heard: Rc<RefCell<Vec<Heard>>>,
    pointer: Point<Pixels>,
    _subscription: gpui_kit::Subscription,
}

impl<'a> Sheet<'a> {
    fn open(
        cx: &'a mut TestAppContext,
        columns: Vec<TallTableColumn>,
        rows: u64,
        viewport_rows: f32,
        cells_width: f32,
        menu: bool,
    ) -> Self {
        cx.update(|cx| {
            gpui_kit::component::init(cx);
            crate::init(cx);
        });
        let (shell, cx) = cx.add_window_view(move |_, cx| {
            let table = cx.new(|cx| {
                TallTableState::new(Memory { next: 0 }, columns, rows, Default::default(), cx)
            });
            Shell {
                table,
                menu,
                right_presses: Rc::default(),
                menus: Rc::default(),
                elsewhere: cx.focus_handle(),
            }
        });
        let table = shell.read_with(cx, |shell, _| shell.table.clone());
        let (gutter, bar) = table.read_with(cx, |table, _| {
            (table.gutter_width(), f32::from(Scrollbar::width()))
        });
        let row_h = f32::from(row_height());
        cx.simulate_resize(size(
            px(cells_width + gutter + bar + 2.0),
            px(viewport_rows * row_h + row_h + bar + 2.0),
        ));
        let heard: Rc<RefCell<Vec<Heard>>> = Rc::default();
        let subscription = cx.update(|_, cx| {
            let heard = heard.clone();
            cx.subscribe(&table, move |_, event: &TallTableEvent, _| match event {
                TallTableEvent::Clicked(click) => {
                    heard.borrow_mut().push(Heard::Clicked(click.clone()))
                }
                #[cfg(feature = "select")]
                TallTableEvent::Selected(selection) => {
                    heard.borrow_mut().push(Heard::Selected(*selection))
                }
                _ => {}
            })
        });
        let mut sheet = Self {
            cx,
            shell,
            table,
            heard,
            pointer: point(px(0.), px(0.)),
            _subscription: subscription,
        };
        sheet.draw();
        sheet
    }

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
        update: impl FnOnce(&mut TallTableState<Memory>, &mut Context<TallTableState<Memory>>) -> T,
    ) -> T {
        let result = self.table.update(self.cx, update);
        self.draw();
        result
    }

    /// What was heard since the last call.
    fn heard(&mut self) -> Vec<Heard> {
        std::mem::take(&mut *self.heard.borrow_mut())
    }

    /// The clicks heard since the last call (the selections dropped).
    fn clicks(&mut self) -> Vec<TallTableClick> {
        let heard = self.heard().into_iter();
        // Without `select`, every one is a click.
        #[cfg(feature = "select")]
        let heard = heard.filter(|heard| matches!(heard, Heard::Clicked(_)));
        heard
            .map(|heard| match heard {
                Heard::Clicked(click) => click,
                #[cfg(feature = "select")]
                Heard::Selected(_) => unreachable!(),
            })
            .collect()
    }

    fn right_presses(&mut self) -> usize {
        self.shell
            .read_with(self.cx, |shell, _| shell.right_presses.get())
    }

    fn menus(&mut self) -> usize {
        self.shell.read_with(self.cx, |shell, _| shell.menus.get())
    }

    // --- where ---

    /// `x` px into the cells area (by the view, not the content) and `y`
    /// rows down the body (negative: the header).
    fn at(&mut self, x: f32, y: f32) -> Point<Pixels> {
        self.read(|table| {
            let row_h = f32::from(table.sizes().row());
            table.body.origin + point(px(table.gutter_width() + x), px(y * row_h))
        })
    }

    /// The middle of a visible cell, by its place.
    fn cell(&mut self, row: u64, place: usize) -> Point<Pixels> {
        let (x, top) = self.read(|table| {
            let column = &table.columns[place];
            (
                table.place().left(place, column.x, table.scroll_x) + column.width / 2.0,
                table.scroll.top(),
            )
        });
        self.at(x, (row as f64 - top) as f32 + 0.5)
    }

    /// A header's middle, by its place.
    fn header(&mut self, place: usize) -> Point<Pixels> {
        let x = self.read(|table| {
            let column = &table.columns[place];
            table.place().left(place, column.x, table.scroll_x) + column.width / 2.0
        });
        self.at(x, -0.5)
    }

    /// A row's number, in the gutter.
    fn gutter(&mut self, row: u64) -> Point<Pixels> {
        let (gutter, top) = self.read(|table| (table.gutter_width(), table.scroll.top()));
        self.at(-gutter / 2.0, (row as f64 - top) as f32 + 0.5)
    }

    fn corner(&mut self) -> Point<Pixels> {
        let gutter = self.read(|table| table.gutter_width());
        self.at(-gutter / 2.0, -0.5)
    }

    /// The vertical scrollbar's track, `y` rows down.
    fn vertical_bar(&mut self, y: f32) -> Point<Pixels> {
        let width = self.read(|table| table.cells_width());
        self.at(width + f32::from(Scrollbar::width()) / 2.0, y)
    }

    /// The horizontal scrollbar's track, `x` px into the cells area.
    fn horizontal_bar(&mut self, x: f32) -> Point<Pixels> {
        let (rows, bar) = self.read(|table| {
            (
                f32::from(table.viewport().height) / f32::from(table.sizes().row()),
                f32::from(Scrollbar::width()),
            )
        });
        let row_h = f32::from(row_height());
        self.at(x, rows + bar / 2.0 / row_h)
    }

    // --- the pointer ---

    fn press_with(
        &mut self,
        at: Point<Pixels>,
        button: MouseButton,
        modifiers: Modifiers,
        click_count: usize,
    ) {
        self.pointer = at;
        self.cx.simulate_event(MouseDownEvent {
            position: at,
            modifiers,
            button,
            click_count,
            first_mouse: false,
        });
        self.draw();
    }

    fn release_with(&mut self, button: MouseButton) {
        self.cx
            .simulate_mouse_up(self.pointer, button, Modifiers::default());
        self.draw();
    }

    /// A left press and its release, at gpui's `click_count`.
    fn click(&mut self, at: Point<Pixels>, modifiers: Modifiers, click_count: usize) {
        self.press_with(at, MouseButton::Left, modifiers, click_count);
        self.release_with(MouseButton::Left);
    }

    fn right_click(&mut self, at: Point<Pixels>, modifiers: Modifiers) {
        self.press_with(at, MouseButton::Right, modifiers, 1);
        self.release_with(MouseButton::Right);
    }

    fn long_press(&mut self, at: Point<Pixels>, phase: TouchPhase) {
        self.cx.simulate_event(LongPressEvent {
            phase,
            start_position: at,
            position: at + point(px(3.), px(2.)),
        });
        self.draw();
    }

    #[cfg_attr(
        not(any(feature = "select", feature = "reorder", feature = "resize")),
        expect(dead_code)
    )]
    fn drag_to(&mut self, at: Point<Pixels>) {
        self.pointer = at;
        self.cx
            .simulate_mouse_move(at, MouseButton::Left, Modifiers::default());
        self.draw();
    }
}

fn ctrl() -> Modifiers {
    Modifiers {
        control: true,
        ..Modifiers::default()
    }
}

fn shift() -> Modifiers {
    Modifiers {
        shift: true,
        ..Modifiers::default()
    }
}

fn click(
    kind: ClickKind,
    target: ClickTarget,
    at: Point<Pixels>,
    modifiers: Modifiers,
) -> TallTableClick {
    TallTableClick {
        kind,
        target,
        position: at,
        modifiers,
    }
}

/// 3 columns (360 px) in a cells area 600 px wide, 3 rows in a view of 10:
/// room below the last row and past the last column.
fn short(cx: &mut TestAppContext) -> Sheet<'_> {
    Sheet::open(cx, floats(3), 3, 10.0, 600.0, false)
}

#[gpui_kit::test]
fn each_kind_on_each_target(cx: &mut TestAppContext) {
    let mut sheet = short(cx);
    let targets = [
        (sheet.cell(1, 2), ClickTarget::Cell { row: 1, column: 2 }),
        (sheet.gutter(2), ClickTarget::Row(2)),
        (sheet.header(1), ClickTarget::Column(1)),
        (sheet.corner(), ClickTarget::Corner),
        // Below the last row: the body, and the gutter.
        (sheet.at(60.0, 5.5), ClickTarget::Blank),
        (sheet.at(-10.0, 5.5), ClickTarget::Blank),
        // Past the last column: the body, and the header.
        (sheet.at(500.0, 1.5), ClickTarget::Blank),
        (sheet.at(500.0, -0.5), ClickTarget::Blank),
    ];
    for (at, target) in targets {
        let why = format!("{target:?} at {at:?}");
        let alt = Modifiers {
            alt: true,
            ..Modifiers::default()
        };
        sheet.click(at, alt, 1);
        sheet.click(at, alt, 2);
        sheet.click(at, alt, 3);
        sheet.right_click(at, shift());
        assert_eq!(
            sheet.clicks(),
            [
                click(ClickKind::Press, target, at, alt),
                click(ClickKind::Double, target, at, alt),
                // A third: nothing.
                click(ClickKind::Context, target, at, shift()),
            ],
            "{why}"
        );
        // Ctrl+press with the setting on, at a count of 1 and 2.
        sheet.update(|table, _| table.set_ctrl_press_is_context(true));
        sheet.click(at, ctrl(), 1);
        sheet.click(at, ctrl(), 2);
        sheet.update(|table, _| table.set_ctrl_press_is_context(false));
        assert_eq!(
            sheet.clicks(),
            [
                click(ClickKind::Context, target, at, ctrl()),
                click(ClickKind::Context, target, at, ctrl()),
            ],
            "{why}, Ctrl with the setting on"
        );
    }
}

#[gpui_kit::test]
fn a_header_with_no_rows_is_its_column(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, floats(3), 0, 10.0, 600.0, false);
    let (header, body) = (sheet.header(1), sheet.at(60.0, 0.5));
    sheet.right_click(header, Modifiers::default());
    sheet.right_click(body, Modifiers::default());
    assert_eq!(
        sheet
            .clicks()
            .into_iter()
            .map(|click| click.target)
            .collect::<Vec<_>>(),
        [ClickTarget::Column(1), ClickTarget::Blank]
    );
}

#[gpui_kit::test]
fn the_table_counts_left_presses(cx: &mut TestAppContext) {
    let mut sheet = short(cx);
    let at = sheet.cell(0, 0);
    let none = Modifiers::default();
    // gpui counts a right press then a left one 2: the table, 1.
    sheet.right_click(at, none);
    sheet.click(at, none, 2);
    sheet.click(at, none, 3);
    assert_eq!(
        sheet
            .clicks()
            .into_iter()
            .map(|click| click.kind)
            .collect::<Vec<_>>(),
        [ClickKind::Context, ClickKind::Press, ClickKind::Double]
    );
    // A press on a scrollbar the table never counts: the next is a first.
    sheet.click(at, none, 1);
    let bar = sheet.vertical_bar(5.0);
    sheet.click(bar, none, 2);
    sheet.click(at, none, 3);
    assert_eq!(
        sheet
            .clicks()
            .into_iter()
            .map(|click| click.kind)
            .collect::<Vec<_>>(),
        [ClickKind::Press, ClickKind::Press]
    );
    // A long press (claimed, so no tap follows): the next is a first, too.
    sheet.click(at, none, 1);
    sheet.long_press(at, TouchPhase::Started);
    sheet.long_press(at, TouchPhase::Ended);
    sheet.click(at, none, 2);
    assert_eq!(
        sheet
            .clicks()
            .into_iter()
            .map(|click| click.kind)
            .collect::<Vec<_>>(),
        [ClickKind::Press, ClickKind::Context, ClickKind::Press]
    );
}

#[gpui_kit::test]
fn ctrl_press_with_the_setting_off_is_a_press(cx: &mut TestAppContext) {
    let mut sheet = short(cx);
    assert!(
        !sheet.read(|table| table.ctrl_press_is_context()),
        "off by default"
    );
    let at = sheet.cell(2, 1);
    sheet.click(at, ctrl(), 1);
    assert_eq!(
        sheet.heard(),
        [Heard::Clicked(click(
            ClickKind::Press,
            ClickTarget::Cell { row: 2, column: 1 },
            at,
            ctrl()
        ))],
        "a press with Ctrl, and (`select`) nothing selected"
    );
    #[cfg(feature = "select")]
    assert_eq!(sheet.read(|table| table.selection()), None);
}

/// A Mac browser's Ctrl+click reaches GPUI as a left press with Ctrl
/// (gpui-pre-web maps the DOM's button 0 to `Left`, and the smoke check
/// sees it so in each browser): with the setting on, the table reports a
/// context press, but a host's `ContextMenuExt`, which opens on the right
/// button alone, opens nothing.
#[gpui_kit::test]
fn a_ctrl_press_opens_no_context_menu_ext(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, floats(3), 3, 10.0, 600.0, true);
    sheet.update(|table, _| table.set_ctrl_press_is_context(true));
    let at = sheet.cell(1, 1);
    sheet.click(at, ctrl(), 1);
    assert_eq!(
        sheet.clicks(),
        [click(
            ClickKind::Context,
            ClickTarget::Cell { row: 1, column: 1 },
            at,
            ctrl()
        )]
    );
    assert_eq!(sheet.menus(), 0, "no menu on Ctrl+left");
    // The control: the right button opens one.
    sheet.right_click(at, Modifiers::default());
    assert_eq!(sheet.menus(), 1, "a menu on the right button");
}

#[gpui_kit::test]
fn a_long_press_is_a_context_press_at_its_start(cx: &mut TestAppContext) {
    let mut sheet = short(cx);
    let at = sheet.cell(1, 1);
    sheet.long_press(at, TouchPhase::Started);
    assert_eq!(
        sheet.clicks(),
        [click(
            ClickKind::Context,
            ClickTarget::Cell { row: 1, column: 1 },
            at,
            Modifiers::default()
        )]
    );
    // Its other phases: nothing.
    sheet.long_press(at, TouchPhase::Moved);
    sheet.long_press(at, TouchPhase::Ended);
    assert_eq!(sheet.clicks(), []);
}

#[gpui_kit::test]
fn the_scrollbars_stop_right_and_long_presses(cx: &mut TestAppContext) {
    // 10 columns in 600 px: both scrollbars.
    let mut sheet = Sheet::open(cx, floats(10), 1000, 10.0, 600.0, true);
    for at in [sheet.vertical_bar(5.0), sheet.horizontal_bar(100.0)] {
        sheet.right_click(at, Modifiers::default());
        sheet.long_press(at, TouchPhase::Started);
        assert_eq!(sheet.clicks(), [], "nothing reported at {at:?}");
        assert_eq!(
            sheet.right_presses(),
            0,
            "nothing reached the host at {at:?}"
        );
        assert_eq!(sheet.menus(), 0, "no menu at {at:?}");
    }
    // The controls: on a cell, both reported, and the menu opens for each.
    let at = sheet.cell(3, 1);
    sheet.right_click(at, Modifiers::default());
    sheet.long_press(at, TouchPhase::Started);
    assert_eq!(sheet.clicks().len(), 2);
    assert_eq!(sheet.right_presses(), 1, "the right press reached the host");
    assert_eq!(sheet.menus(), 2, "a menu for each");
}

#[gpui_kit::test]
fn a_scrolled_table_reports_the_row_and_place_under_the_press(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, floats(10), 100_000, 10.0, 600.0, false);
    let middle = sheet.cell(5, 2);
    sheet.cx.simulate_event(ScrollEvent {
        position: middle,
        delta: ScrollDelta::Lines(point(0., -37.0)),
        modifiers: Modifiers::default(),
        touch_phase: TouchPhase::Moved,
        source: ScrollSource::Pointer,
    });
    sheet.draw();
    sheet.cx.simulate_event(ScrollEvent {
        position: middle,
        delta: ScrollDelta::Pixels(point(px(-250.), px(0.))),
        modifiers: Modifiers::default(),
        touch_phase: TouchPhase::Moved,
        source: ScrollSource::Pointer,
    });
    sheet.draw();
    let (top, scroll_x) = sheet.read(|table| (table.scroll.top(), table.scroll_x));
    assert!(
        top > 30.0 && scroll_x > 200.0,
        "scrolled: {top}, {scroll_x}"
    );
    // 10 px into the cells area, half a row down.
    let at = sheet.at(10.0, 0.5);
    sheet.click(at, Modifiers::default(), 1);
    let row = (top + 0.5).floor() as u64;
    let place = ((scroll_x + 10.0) / 120.0).floor() as usize;
    assert_eq!(
        sheet
            .clicks()
            .into_iter()
            .map(|click| click.target)
            .collect::<Vec<_>>(),
        [ClickTarget::Cell { row, column: place }]
    );
}

#[gpui_kit::test]
fn a_right_press_reaches_the_host_and_focuses_hiding_the_tooltip(cx: &mut TestAppContext) {
    let mut sheet = short(cx);
    let at = sheet.cell(1, 0);
    // A rested pointer shows the cell's tooltip (its value is rounded).
    sheet.cx.simulate_mouse_move(at, None, Modifiers::default());
    sheet.draw();
    sheet
        .cx
        .executor()
        .advance_clock(Duration::from_millis(600));
    sheet.draw();
    let tooltip = |table: &TallTableState<Memory>| {
        table
            .hover
            .as_ref()
            .is_some_and(|hover| hover.tooltip.is_some())
    };
    assert!(sheet.read(tooltip), "the control: a tooltip shown");
    let elsewhere = sheet
        .shell
        .read_with(sheet.cx, |shell, _| shell.elsewhere.clone());
    sheet.cx.update(|window, cx| window.focus(&elsewhere, cx));
    sheet.draw();
    let focused = |sheet: &mut Sheet| {
        let handle = sheet.read(|table| table.focus_handle.clone());
        sheet.cx.update(|window, _| handle.is_focused(window))
    };
    assert!(!focused(&mut sheet), "the control: focus elsewhere");
    sheet.right_click(at, Modifiers::default());
    assert!(focused(&mut sheet), "focused");
    assert!(!sheet.read(tooltip), "the tooltip hidden");
    assert_eq!(sheet.right_presses(), 1, "not stopped");
    // A long press focuses too.
    sheet.cx.update(|window, cx| window.focus(&elsewhere, cx));
    sheet.draw();
    sheet.long_press(at, TouchPhase::Started);
    assert!(focused(&mut sheet), "focused by a long press");
}

#[gpui_kit::test]
fn an_unclaimed_long_press_drops_its_tap(cx: &mut TestAppContext) {
    let mut sheet = short(cx);
    let (at, other) = (sheet.cell(1, 1), sheet.cell(2, 2));
    // Lifted where it was: gpui-pre's tap, a left press at the lift.
    sheet.long_press(at, TouchPhase::Started);
    let lift = at + point(px(2.), px(1.));
    sheet.click(lift, Modifiers::default(), 1);
    assert_eq!(
        sheet
            .clicks()
            .into_iter()
            .map(|click| click.kind)
            .collect::<Vec<_>>(),
        [ClickKind::Context],
        "the tap dropped"
    );
    sheet.click(at, Modifiers::default(), 1);
    assert_eq!(sheet.clicks().len(), 1, "the next press reported");
    // Claimed (a phase after its start came): no tap follows, so the next
    // press is the reader's.
    sheet.long_press(at, TouchPhase::Started);
    sheet.long_press(at, TouchPhase::Ended);
    sheet.click(other, Modifiers::default(), 1);
    assert_eq!(sheet.clicks().len(), 2, "after a claimed long press");
    // Panned: no tap either.
    sheet.long_press(at, TouchPhase::Started);
    sheet.cx.simulate_event(ScrollEvent {
        position: at,
        delta: ScrollDelta::Pixels(point(px(0.), px(-1.))),
        modifiers: Modifiers::default(),
        touch_phase: TouchPhase::Moved,
        source: ScrollSource::Touch,
    });
    sheet.draw();
    sheet.click(other, Modifiers::default(), 1);
    assert_eq!(sheet.clicks().len(), 2, "after a pan");
}

#[gpui_kit::test]
fn a_context_press_during_a_scrollbar_drag_reports_nothing(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, floats(3), 1000, 10.0, 600.0, false);
    let bar = sheet.vertical_bar(5.0);
    sheet.press_with(bar, MouseButton::Left, Modifiers::default(), 1);
    assert!(
        sheet.read(|table| table.drag.is_some()),
        "the control: dragging"
    );
    // (Focus isn't checked: GPUI focuses the element on any button's press,
    // and the drag's own press focused it already.)
    let at = sheet.at(60.0, 1.5);
    sheet.press_with(at, MouseButton::Right, Modifiers::default(), 1);
    sheet.long_press(at, TouchPhase::Started);
    assert_eq!(sheet.clicks(), [], "nothing reported");
    assert!(sheet.read(|table| table.drag.is_some()), "the drag goes on");
    sheet.release_with(MouseButton::Left);
}

// --- with `select` ---

#[cfg(feature = "select")]
mod select {
    use gpui_kit::{Modifiers, MouseButton, TestAppContext, TouchPhase};

    use super::{Heard, Sheet, shift, short};
    use crate::selection::TallTableSelection;

    fn cells(anchor: (u64, usize), head: (u64, usize)) -> TallTableSelection {
        TallTableSelection::Cells { anchor, head }
    }

    fn rows(anchor: u64, head: u64) -> TallTableSelection {
        TallTableSelection::Rows {
            anchor: (anchor, 0),
            head: (head, 0),
        }
    }

    fn columns(anchor: usize, head: usize) -> TallTableSelection {
        TallTableSelection::Columns {
            anchor: (0, anchor),
            head: (0, head),
        }
    }

    impl Sheet<'_> {
        fn selection(&mut self) -> Option<TallTableSelection> {
            self.read(|table| table.selection())
        }

        fn select(&mut self, selection: Option<TallTableSelection>) {
            self.update(|table, cx| table.select(selection, cx));
            self.heard();
        }

        /// The kinds heard since the last call: `"clicked"` or
        /// `"selected"`.
        fn order(&mut self) -> Vec<&'static str> {
            self.heard()
                .into_iter()
                .map(|heard| match heard {
                    Heard::Clicked(_) => "clicked",
                    Heard::Selected(_) => "selected",
                })
                .collect()
        }
    }

    #[gpui_kit::test]
    fn a_press_reports_after_its_selection_and_again_on_the_same_row(cx: &mut TestAppContext) {
        let mut sheet = short(cx);
        let at = sheet.gutter(1);
        sheet.click(at, Modifiers::default(), 1);
        assert_eq!(sheet.order(), ["selected", "clicked"]);
        assert_eq!(sheet.selection(), Some(rows(1, 1)));
        let selected_in_handler = sheet.selection();
        // Pressed again: a press, no selection's change.
        sheet.click(at, Modifiers::default(), 1);
        assert_eq!(sheet.order(), ["clicked"]);
        assert_eq!(sheet.selection(), selected_in_handler);
    }

    #[gpui_kit::test]
    fn a_context_press_keeps_the_selection_inside_it(cx: &mut TestAppContext) {
        let mut sheet = short(cx);
        let none = Modifiers::default();
        let cases = [
            (
                cells((0, 0), (1, 1)),
                vec![sheet.cell(1, 1), sheet.cell(0, 0)],
            ),
            (
                rows(0, 1),
                vec![sheet.gutter(1), sheet.cell(0, 2), sheet.corner()],
            ),
            (
                columns(0, 1),
                vec![sheet.header(1), sheet.cell(2, 0), sheet.corner()],
            ),
        ];
        for (selection, inside) in cases {
            for at in inside {
                sheet.select(Some(selection));
                sheet.right_click(at, none);
                assert_eq!(
                    sheet.selection(),
                    Some(selection),
                    "{selection:?} at {at:?}"
                );
                assert_eq!(sheet.order(), ["clicked"], "{selection:?} at {at:?}");
            }
        }
    }

    #[gpui_kit::test]
    fn a_context_press_outside_selects_its_target_without_a_drag(cx: &mut TestAppContext) {
        let mut sheet = short(cx);
        let cases = [
            (
                cells((0, 0), (1, 1)),
                sheet.cell(2, 2),
                cells((2, 2), (2, 2)),
            ),
            // A row's number outside a `Cells` range covering its cells.
            (cells((0, 0), (1, 2)), sheet.gutter(1), rows(1, 1)),
            (rows(0, 1), sheet.gutter(2), rows(2, 2)),
            (rows(0, 1), sheet.header(1), columns(1, 1)),
            (columns(0, 1), sheet.header(2), columns(2, 2)),
            (columns(0, 1), sheet.gutter(0), rows(0, 0)),
        ];
        for modifiers in [Modifiers::default(), shift()] {
            for (selection, at, then) in cases {
                sheet.select(Some(selection));
                sheet.press_with(at, MouseButton::Right, modifiers, 1);
                let why = format!("{selection:?} at {at:?}, {modifiers:?}");
                // What a plain press selects (Shift doesn't extend).
                assert_eq!(sheet.selection(), Some(then), "{why}");
                assert_eq!(sheet.order(), ["selected", "clicked"], "{why}");
                // No drag: a move with the left button down changes nothing.
                assert!(!sheet.read(|table| table.is_selecting()), "{why}");
                let before = sheet.selection();
                let far = sheet.cell(0, 0);
                sheet.drag_to(far);
                sheet.release_with(MouseButton::Right);
                assert_eq!(sheet.selection(), before, "nothing moved: {why}");
            }
        }
    }

    #[gpui_kit::test]
    fn the_corner_and_a_blank(cx: &mut TestAppContext) {
        let mut sheet = short(cx);
        let corner = sheet.corner();
        sheet.right_click(corner, Modifiers::default());
        assert_eq!(sheet.selection(), Some(columns(0, 2)), "every column");
        assert_eq!(sheet.order(), ["selected", "clicked"]);
        for blank in [sheet.at(60.0, 5.5), sheet.at(500.0, -0.5)] {
            for selection in [None, Some(rows(0, 0))] {
                sheet.select(selection);
                sheet.right_click(blank, Modifiers::default());
                assert_eq!(sheet.selection(), selection, "a blank at {blank:?}");
                assert_eq!(sheet.order(), ["clicked"]);
            }
        }
    }

    #[gpui_kit::test]
    fn a_context_press_during_a_drag_does_nothing(cx: &mut TestAppContext) {
        let mut sheet = short(cx);
        let (from, to, other) = (sheet.cell(0, 0), sheet.cell(1, 1), sheet.cell(2, 2));
        sheet.press_with(from, MouseButton::Left, Modifiers::default(), 1);
        sheet.drag_to(to);
        sheet.heard();
        let dragged = sheet.selection();
        sheet.press_with(other, MouseButton::Right, Modifiers::default(), 1);
        sheet.long_press(other, TouchPhase::Started);
        assert_eq!(sheet.heard(), [], "nothing reported");
        assert_eq!(sheet.selection(), dragged, "nothing changed");
        // The drag goes on.
        sheet.drag_to(other);
        assert_eq!(sheet.selection(), Some(cells((0, 0), (2, 2))));
        sheet.release_with(MouseButton::Left);
    }
}

// --- with `resize` and `sort` ---

#[cfg(feature = "resize")]
#[gpui_kit::test]
fn a_band_keeps_its_presses(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, floats(3), 3, 10.0, 600.0, true);
    // Column 0's edge, the band's middle.
    let edge = sheet.read(|table| table.columns[0].x + table.columns[0].width - 0.5);
    let at = sheet.at(edge, -0.5);
    let width = sheet.read(|table| table.columns[0].width);
    sheet.click(at, Modifiers::default(), 1);
    sheet.click(at, Modifiers::default(), 2);
    assert_ne!(
        sheet.read(|table| table.columns[0].width),
        width,
        "the double press fits"
    );
    // The band, where the fit moved it.
    let edge = sheet.read(|table| table.columns[0].x + table.columns[0].width - 0.5);
    let at = sheet.at(edge, -0.5);
    sheet.right_click(at, Modifiers::default());
    sheet.long_press(at, TouchPhase::Started);
    assert_eq!(sheet.clicks(), [], "nothing reported");
    assert_eq!(
        (sheet.right_presses(), sheet.menus()),
        (0, 0),
        "nothing reached the host"
    );
    // Dragged wider than its fit, then a left press gpui counts 2 after a
    // right one: a first press to the table, so no fit.
    sheet.press_with(at, MouseButton::Left, Modifiers::default(), 1);
    sheet.drag_to(at + point(px(40.), px(0.)));
    sheet.release_with(MouseButton::Left);
    let dragged = sheet.read(|table| table.columns[0].width);
    let edge = sheet.read(|table| table.columns[0].x + table.columns[0].width - 0.5);
    let at = sheet.at(edge, -0.5);
    sheet.right_click(at, Modifiers::default());
    sheet.click(at, Modifiers::default(), 2);
    assert_eq!(
        sheet.read(|table| table.columns[0].width),
        dragged,
        "no fit"
    );
}

#[cfg(feature = "sort")]
#[gpui_kit::test]
fn an_arrow_keeps_its_presses(cx: &mut TestAppContext) {
    let columns = floats(3)
        .into_iter()
        .map(|column| column.sortable(true))
        .collect();
    let mut sheet = Sheet::open(cx, columns, 3, 10.0, 600.0, true);
    let at = sheet.read(|table| {
        table
            .sort_state
            .drawn
            .iter()
            .find(|arrow| arrow.column == 1)
            .expect("an arrow")
            .target
            .center()
    });
    sheet.press_with(at, MouseButton::Left, Modifiers::default(), 1);
    assert_eq!(
        sheet.read(|table| table.sort_state.pressed),
        Some(1),
        "the control: the arrow's press"
    );
    sheet.release_with(MouseButton::Left);
    sheet.right_click(at, Modifiers::default());
    sheet.long_press(at, TouchPhase::Started);
    assert_eq!(sheet.clicks(), [], "nothing reported");
    assert_eq!(
        (sheet.right_presses(), sheet.menus()),
        (0, 0),
        "nothing reached the host"
    );
}

// --- with `reorder` ---

#[cfg(feature = "reorder")]
#[gpui_kit::test]
fn a_press_that_starts_a_move_reports_once(cx: &mut TestAppContext) {
    let mut sheet = short(cx);
    // With `select`, a move starts inside a selected `Columns` range.
    #[cfg(feature = "select")]
    sheet.update(|table, cx| {
        table.select(
            Some(crate::selection::TallTableSelection::Columns {
                anchor: (0, 0),
                head: (0, 0),
            }),
            cx,
        )
    });
    sheet.heard();
    let from = sheet.header(0);
    sheet.press_with(from, MouseButton::Left, Modifiers::default(), 1);
    let to = sheet.header(2);
    sheet.drag_to(to);
    sheet.release_with(MouseButton::Left);
    assert_ne!(
        sheet.read(|table| table.order().to_vec()),
        [0, 1, 2],
        "the control: moved"
    );
    assert_eq!(
        sheet.clicks(),
        [click(
            ClickKind::Press,
            ClickTarget::Column(0),
            from,
            Modifiers::default()
        )]
    );
}

#[cfg(all(feature = "reorder", feature = "select"))]
#[gpui_kit::test]
fn a_press_inside_the_selected_columns_selects_at_its_release(cx: &mut TestAppContext) {
    use crate::selection::TallTableSelection;
    let mut sheet = short(cx);
    let range = TallTableSelection::Columns {
        anchor: (0, 0),
        head: (0, 1),
    };
    sheet.update(|table, cx| table.select(Some(range), cx));
    sheet.heard();
    let at = sheet.header(1);
    sheet.press_with(at, MouseButton::Left, Modifiers::default(), 1);
    assert_eq!(
        sheet.heard(),
        [Heard::Clicked(click(
            ClickKind::Press,
            ClickTarget::Column(1),
            at,
            Modifiers::default()
        ))],
        "a press, the range still selected"
    );
    assert_eq!(sheet.read(|table| table.selection()), Some(range));
    sheet.release_with(MouseButton::Left);
    assert_eq!(
        sheet.heard(),
        [Heard::Selected(Some(TallTableSelection::Columns {
            anchor: (0, 1),
            head: (0, 1),
        }))],
        "its column at the release"
    );
}

#[cfg(feature = "reorder")]
#[gpui_kit::test]
fn a_column_is_its_place(cx: &mut TestAppContext) {
    let mut sheet = short(cx);
    sheet.update(|table, cx| table.set_order(vec![2, 1, 0], cx));
    let (header, cell) = (sheet.header(0), sheet.cell(1, 0));
    sheet.right_click(header, Modifiers::default());
    sheet.right_click(cell, Modifiers::default());
    assert_eq!(
        sheet
            .clicks()
            .into_iter()
            .map(|click| click.target)
            .collect::<Vec<_>>(),
        [
            ClickTarget::Column(0),
            ClickTarget::Cell { row: 1, column: 0 }
        ],
        "places, not the indices (2)"
    );
}
