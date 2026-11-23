//! `clicks`' `header_tap_is_press`, built with `sort`, `resize`, `select`,
//! and `header-icon`: no fixture (no DOM contender level), so only the
//! window's checks, each a raw touch (started, then ended) sent to a window
//! of GPUI's test app, whose recognizer makes the tap or the long press as
//! the web platform's does. With the setting on: a tap on an arrow or a
//! band is its header's press (counted, a second tap `Double`, its column
//! selected), sorting and resizing nothing; a long press there is its
//! header's `Context`, its lifted tap dropped; a mouse's press on either is
//! as before, between touches; a tap on an icon is the icon's. With it
//! off, each as before. A long press on a header and on a cell, either way.
//! The control: the arrow made to ignore the setting.

use std::borrow::Cow;
use std::cell::{Cell as Counter, RefCell};
use std::ops::Range;
use std::rc::Rc;
use std::sync::Arc;
use std::time::Duration;

use gpui_kit::component::Theme;
use gpui_kit::{
    App, AppContext as _, AssetSource, Context, Entity, Hsla, IntoElement, Modifiers, MouseButton,
    MouseDownEvent, ParentElement as _, Pixels, Point, Render, SharedString, Styled as _,
    TestAppContext, TouchEvent, TouchId, TouchPhase, VisualTestContext, Window, div, point, px,
    size,
};

use super::super::click::Control;
use super::super::{TallTableEvent, TallTableState, row_height};
use crate::click::{ClickKind, ClickTarget, TallTableClick};
use crate::column::{ColumnKind, TallTableColumn};
use crate::delegate::{CellValue, PageLoad, TallTableDelegate, TallTablePage};
use crate::header_icon::HeaderIcon;
use crate::selection::TallTableSelection;
use crate::sort::{Sort, SortRefused};
use crate::tall_table::TallTable;

/// Rows from memory, each value its row; counts the sorts asked of it and
/// accepts each.
struct Memory {
    next: u64,
    sorts: Rc<Counter<usize>>,
}

struct Rows(Range<u64>);

impl TallTablePage for Rows {
    fn value(&self, row: usize, _: usize) -> Option<CellValue<'_>> {
        Some(CellValue::Float((self.0.start + row as u64) as f64))
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

    fn sort(&mut self, _: &[Sort], _: &mut App) -> Result<(), SortRefused> {
        self.sorts.set(self.sorts.get() + 1);
        Ok(())
    }
}

/// Loads the icon the tests name, and nothing else.
struct Icons;

impl AssetSource for Icons {
    fn load(&self, path: &str) -> gpui_kit::Result<Option<Cow<'static, [u8]>>> {
        Ok((path == "num.svg").then_some(Cow::Borrowed(b"<svg/>".as_slice())))
    }

    fn list(&self, _: &str) -> gpui_kit::Result<Vec<SharedString>> {
        Ok(Vec::new())
    }
}

fn ink(theme: &Theme) -> Hsla {
    theme.foreground
}

/// Three float columns, each sortable, resizable, and with an icon.
fn columns() -> Vec<TallTableColumn> {
    (0..3)
        .map(|index| {
            TallTableColumn::new(format!("f{index}"), ColumnKind::Float)
                .sortable(true)
                .icon(HeaderIcon::new("num.svg", ink))
        })
        .collect()
}

struct Shell {
    table: Entity<TallTableState<Memory>>,
}

impl Render for Shell {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        div().size_full().child(TallTable::new(&self.table))
    }
}

/// What a test reads of the events: the presses, the sorts, the widths,
/// the icons' presses, and the selections.
#[derive(Debug, Clone, PartialEq)]
enum Heard {
    Clicked(ClickKind, ClickTarget, Point<Pixels>),
    Sorted,
    Widths,
    Icon(usize),
    Selected(Option<TallTableSelection>),
}

/// A table of [`columns`] over 100 rows in a view of 10, 600 px of cells.
struct Sheet<'a> {
    cx: &'a mut VisualTestContext,
    table: Entity<TallTableState<Memory>>,
    sorts: Rc<Counter<usize>>,
    heard: Rc<RefCell<Vec<Heard>>>,
    /// The next touch's id: a platform never reuses one.
    touch: u64,
    _subscription: gpui_kit::Subscription,
}

impl<'a> Sheet<'a> {
    fn open(cx: &'a mut TestAppContext, on: bool) -> Self {
        cx.update(|cx| {
            gpui_kit::component::init(cx);
            crate::init(cx);
        });
        let sorts: Rc<Counter<usize>> = Rc::default();
        let (shell, cx) = cx.add_window_view({
            let sorts = sorts.clone();
            move |_, cx| Shell {
                table: cx.new(|cx| {
                    TallTableState::new(
                        Memory { next: 0, sorts },
                        Vec::new(),
                        100,
                        Default::default(),
                        cx,
                    )
                }),
            }
        });
        let table = shell.read_with(cx, |shell, _| shell.table.clone());
        let heard: Rc<RefCell<Vec<Heard>>> = Rc::default();
        let subscription = cx.update(|_, cx| {
            let heard = heard.clone();
            cx.subscribe(&table, move |_, event: &TallTableEvent, _| {
                let event = match event {
                    TallTableEvent::Clicked(TallTableClick {
                        kind,
                        target,
                        position,
                        ..
                    }) => Heard::Clicked(*kind, *target, *position),
                    TallTableEvent::Sorted(_) => Heard::Sorted,
                    TallTableEvent::ColumnWidthsChanged(_) => Heard::Widths,
                    TallTableEvent::HeaderIconPressed(press) => Heard::Icon(press.column),
                    TallTableEvent::Selected(selection) => Heard::Selected(*selection),
                    _ => return,
                };
                heard.borrow_mut().push(event);
            })
        });
        // The test app's asset source loads nothing: the columns are set
        // once the table checks its paths against the tests' own.
        table.update(cx, |table, cx| {
            table.icon_state.assets = Some(Arc::new(Icons));
            table.set_columns(columns(), cx);
            table.set_header_tap_is_press(on);
        });
        let gutter = table.read_with(cx, |table, _| table.gutter_width());
        let (row_h, bar) = (
            f32::from(row_height()),
            f32::from(gpui_kit::component::scroll::Scrollbar::width()),
        );
        cx.simulate_resize(size(
            px(600.0 + gutter + bar + 2.0),
            px(10.0 * row_h + row_h + bar + 2.0),
        ));
        let mut sheet = Self {
            cx,
            table,
            sorts,
            heard,
            touch: 0,
            _subscription: subscription,
        };
        sheet.draw();
        sheet.heard();
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

    /// Everything heard since the last call.
    fn heard(&mut self) -> Vec<Heard> {
        std::mem::take(&mut *self.heard.borrow_mut())
    }

    /// The presses heard since the last call (the rest dropped).
    fn clicks(&mut self) -> Vec<(ClickKind, ClickTarget)> {
        self.heard()
            .into_iter()
            .filter_map(|heard| match heard {
                Heard::Clicked(kind, target, _) => Some((kind, target)),
                _ => None,
            })
            .collect()
    }

    fn widths(&mut self) -> Vec<Pixels> {
        self.read(|table| {
            table
                .columns
                .iter()
                .map(|column| px(column.width))
                .collect()
        })
    }

    // --- where ---

    /// The middle of the arrow of the column of index `column`.
    fn arrow(&mut self, column: usize) -> Point<Pixels> {
        self.read(|table| {
            table
                .sort_state
                .drawn
                .iter()
                .find(|arrow| arrow.column == column)
                .expect("an arrow")
                .target
                .center()
        })
    }

    /// The band at the right edge of the column at `place`, `dx` px from
    /// its hairline's middle.
    fn band(&mut self, place: usize, dx: f32) -> Point<Pixels> {
        let x = self.read(|table| {
            table
                .bands_drawn
                .borrow()
                .iter()
                .find(|band| band.column == place)
                .expect("a band")
                .x
        });
        let y = self.header(place).y;
        point(px(x + dx), y)
    }

    /// The middle of the target of column `column`'s icon.
    fn icon(&mut self, column: usize) -> Point<Pixels> {
        self.read(|table| {
            table
                .icon_state
                .drawn
                .iter()
                .find(|icon| icon.column == column)
                .expect("an icon")
                .target
                .center()
        })
    }

    /// A header's middle, by its place.
    fn header(&mut self, place: usize) -> Point<Pixels> {
        self.read(|table| {
            let column = &table.columns[place];
            let row = f32::from(table.sizes().row());
            table.body.origin
                + point(
                    px(table.gutter_width() + column.x + column.width / 2.0),
                    px(-row / 2.0),
                )
        })
    }

    fn cell(&mut self, row: u64, place: usize) -> Point<Pixels> {
        self.read(|table| {
            let column = &table.columns[place];
            let row_h = f32::from(table.sizes().row());
            table.body.origin
                + point(
                    px(table.gutter_width() + column.x + column.width / 2.0),
                    px((row as f32 + 0.5) * row_h),
                )
        })
    }

    // --- the finger and the mouse ---

    fn touch(&mut self, phase: TouchPhase, at: Point<Pixels>) {
        self.cx.simulate_event(TouchEvent {
            id: TouchId(self.touch),
            phase,
            position: at,
            ..TouchEvent::default()
        });
    }

    /// A finger landed and lifted at once: GPUI's recognizer makes it a
    /// left press and its release, at the lift.
    fn tap(&mut self, at: Point<Pixels>) {
        self.touch += 1;
        self.touch(TouchPhase::Started, at);
        self.touch(TouchPhase::Ended, at);
        self.draw();
        assert!(
            self.cx.update(|window, _| window.last_input_was_touch()),
            "the control: a touch"
        );
    }

    /// Two taps back to back, nothing drawn between: the recognizer counts
    /// a second tap within 400 ms of wall time (`Instant::now`), not of the
    /// test clock, so a draw between them on a loaded machine could make it
    /// a first.
    fn double_tap(&mut self, at: Point<Pixels>) {
        for _ in 0..2 {
            self.touch += 1;
            self.touch(TouchPhase::Started, at);
            self.touch(TouchPhase::Ended, at);
        }
        self.draw();
    }

    /// A finger held past the long press's 500 ms, then lifted.
    fn long_press(&mut self, at: Point<Pixels>) {
        self.touch += 1;
        self.touch(TouchPhase::Started, at);
        self.cx.executor().advance_clock(Duration::from_millis(501));
        self.draw();
        self.touch(TouchPhase::Ended, at);
        self.draw();
    }

    /// A mouse's left press and release, moved there first.
    fn click(&mut self, at: Point<Pixels>) {
        self.cx.simulate_mouse_move(at, None, Modifiers::default());
        self.cx.simulate_event(MouseDownEvent {
            position: at,
            modifiers: Modifiers::default(),
            button: MouseButton::Left,
            click_count: 1,
            first_mouse: false,
        });
        self.draw();
        assert!(
            !self.cx.update(|window, _| window.last_input_was_touch()),
            "the control: a mouse"
        );
        self.cx
            .simulate_mouse_up(at, MouseButton::Left, Modifiers::default());
        self.draw();
    }
}

fn column(place: usize) -> TallTableSelection {
    TallTableSelection::new(crate::selection::Kind::Columns, (0, place), (0, place))
}

// --- the setting on ---

#[gpui_kit::test]
fn a_tap_on_an_arrow_is_its_headers_press(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, true);
    let at = sheet.arrow(1);
    sheet.tap(at);
    assert_eq!(
        sheet.heard(),
        [
            Heard::Selected(Some(column(1))),
            Heard::Clicked(ClickKind::Press, ClickTarget::Column(1), at),
        ],
        "its column selected, then its press, and nothing sorted"
    );
    assert_eq!(sheet.sorts.get(), 0, "the source asked no sort");
    assert_eq!(sheet.read(|table| table.sort_state.pressed), None);
    // Far from it, so the double tap's first is a first (gpui counts taps
    // within 16 px).
    let away = sheet.cell(5, 2);
    sheet.tap(away);
    sheet.heard();
    sheet.double_tap(at);
    assert_eq!(
        sheet.clicks(),
        [
            (ClickKind::Press, ClickTarget::Column(1)),
            (ClickKind::Double, ClickTarget::Column(1)),
        ]
    );
    assert_eq!(sheet.sorts.get(), 0);
}

#[gpui_kit::test]
fn a_tap_on_a_band_is_the_press_of_the_header_under_it(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, true);
    let widths = sheet.widths();
    // The band straddles two headers: each side its own.
    let left = sheet.band(0, -3.0);
    sheet.tap(left);
    assert_eq!(sheet.clicks(), [(ClickKind::Press, ClickTarget::Column(0))]);
    assert!(sheet.read(|table| table.resizing.is_none()), "no resize");
    // Far from it, so the next tap is a first (gpui counts taps within
    // 16 px).
    let away = sheet.cell(5, 2);
    sheet.tap(away);
    sheet.heard();
    let right = sheet.band(0, 3.0);
    sheet.double_tap(right);
    let heard = sheet.heard();
    assert!(
        !heard.contains(&Heard::Widths),
        "a second tap fits nothing: {heard:?}"
    );
    assert_eq!(
        heard
            .into_iter()
            .filter(|heard| matches!(heard, Heard::Clicked(..)))
            .collect::<Vec<_>>(),
        [
            Heard::Clicked(ClickKind::Press, ClickTarget::Column(1), right),
            Heard::Clicked(ClickKind::Double, ClickTarget::Column(1), right),
        ]
    );
    assert_eq!(sheet.widths(), widths);
}

#[gpui_kit::test]
fn a_long_press_on_an_arrow_or_a_band_is_its_headers_context(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, true);
    let arrow = sheet.arrow(2);
    sheet.long_press(arrow);
    assert_eq!(
        sheet.heard(),
        [
            Heard::Selected(Some(column(2))),
            Heard::Clicked(ClickKind::Context, ClickTarget::Column(2), arrow),
        ],
        "once, at its start: the lifted finger's tap dropped"
    );
    assert_eq!(sheet.sorts.get(), 0);
    let band = sheet.band(1, -3.0);
    sheet.long_press(band);
    assert_eq!(
        sheet.heard(),
        [
            Heard::Selected(Some(column(1))),
            Heard::Clicked(ClickKind::Context, ClickTarget::Column(1), band),
        ]
    );
    assert!(sheet.read(|table| table.resizing.is_none()));
}

#[gpui_kit::test]
fn a_mouse_still_sorts_and_resizes_between_touches(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, true);
    let arrow = sheet.arrow(0);
    sheet.click(arrow);
    assert_eq!(sheet.sorts.get(), 1, "the mouse sorts");
    sheet.tap(arrow);
    assert_eq!(sheet.sorts.get(), 1, "the finger doesn't");
    sheet.click(arrow);
    assert_eq!(sheet.sorts.get(), 2, "the mouse after a touch sorts");
    let band = sheet.band(0, 0.0);
    sheet.tap(band);
    assert!(sheet.read(|table| table.resizing.is_none()));
    sheet
        .cx
        .simulate_mouse_move(band, None, Modifiers::default());
    sheet.cx.simulate_event(MouseDownEvent {
        position: band,
        modifiers: Modifiers::default(),
        button: MouseButton::Left,
        click_count: 1,
        first_mouse: false,
    });
    sheet.draw();
    assert!(
        sheet.read(|table| table.resizing.is_some()),
        "the mouse's press starts a resize"
    );
    sheet
        .cx
        .simulate_mouse_up(band, MouseButton::Left, Modifiers::default());
    sheet.draw();
}

#[gpui_kit::test]
fn a_tap_on_an_icon_is_the_icons(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, true);
    let at = sheet.icon(1);
    sheet.tap(at);
    assert_eq!(sheet.heard(), [Heard::Icon(1)], "and no press");
}

// --- the setting off ---

#[gpui_kit::test]
fn off_each_tap_is_as_before(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, false);
    assert!(!sheet.read(|table| table.header_tap_is_press()));
    let arrow = sheet.arrow(1);
    sheet.tap(arrow);
    assert_eq!(sheet.sorts.get(), 1, "the arrow sorts");
    let heard = sheet.heard();
    assert!(heard.contains(&Heard::Sorted), "{heard:?}");
    assert!(
        !heard
            .iter()
            .any(|heard| matches!(heard, Heard::Clicked(..))),
        "{heard:?}"
    );
    let widths = sheet.widths();
    let band = sheet.band(0, 0.0);
    sheet.tap(band);
    assert_eq!(sheet.heard(), [], "the band's tap: nothing");
    let away = sheet.cell(5, 2);
    sheet.tap(away);
    sheet.heard();
    sheet.double_tap(band);
    assert!(sheet.heard().contains(&Heard::Widths), "a double tap fits");
    assert_ne!(sheet.widths(), widths);
    let arrow = sheet.arrow(2);
    sheet.long_press(arrow);
    let band = sheet.band(1, 0.0);
    sheet.long_press(band);
    assert_eq!(sheet.heard(), [], "a long press on either: nothing");
    assert_eq!(sheet.sorts.get(), 1);
    let at = sheet.icon(0);
    sheet.tap(at);
    assert_eq!(sheet.heard(), [Heard::Icon(0)]);
}

// --- on and off ---

#[gpui_kit::test]
fn a_long_press_on_a_header_or_a_cell_is_its_context(cx: &mut TestAppContext) {
    for on in [true, false] {
        let mut sheet = Sheet::open(cx, on);
        let header = sheet.header(1);
        sheet.long_press(header);
        assert_eq!(
            sheet.clicks(),
            [(ClickKind::Context, ClickTarget::Column(1))],
            "on: {on}"
        );
        let cell = sheet.cell(3, 2);
        sheet.long_press(cell);
        assert_eq!(
            sheet
                .heard()
                .into_iter()
                .filter(|heard| matches!(heard, Heard::Clicked(..)))
                .collect::<Vec<_>>(),
            [Heard::Clicked(
                ClickKind::Context,
                ClickTarget::Cell { row: 3, column: 2 },
                cell
            )],
            "on: {on}"
        );
        sheet.cx.update(|window, _| window.remove_window());
    }
}

// --- the control ---

/// The arrow made to ignore the setting: its tap sorts, and
/// [`a_tap_on_an_arrow_is_its_headers_press`]'s first check fails.
#[gpui_kit::test]
fn the_control_an_arrow_that_ignores_the_setting_sorts(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, true);
    sheet.table.update(sheet.cx, |table, _| {
        table.clicks_state.control = Control::ArrowIgnoresSetting;
    });
    let at = sheet.arrow(1);
    sheet.tap(at);
    let heard = sheet.heard();
    assert_ne!(
        heard,
        [
            Heard::Selected(Some(column(1))),
            Heard::Clicked(ClickKind::Press, ClickTarget::Column(1), at),
        ]
    );
    assert_eq!(sheet.sorts.get(), 1, "{heard:?}");
}
