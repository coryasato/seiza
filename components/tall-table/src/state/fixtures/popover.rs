//! `popover`: the popover in a window of GPUI's test app, over rows
//! answered from memory, driven through the element (its keys and
//! contexts, in a host view with Enter and Escape of its own, and gpui-base's
//! `TextSelectionLayer`, as `Root` draws it) and the pointer. No fixture of
//! its own: its text is the cell's exact text, which the cell fixture pins.
//! Checked: each way it opens and is refused, each way it closes (and what
//! it leaves to the keys and presses after it), its text (exact, its lines,
//! NULL, the cap), the button by Enter and by press, the cue's rule and its
//! press, the placing (below, flipped above, its width and height capped),
//! no tooltip while open, and each built feature's rule (`select`'s keys
//! and Enter, a press outside selecting, `clicks` not told of the cue,
//! `copy` stepping aside for a part of its text selected, `sort`, `hide`,
//! `reorder`'s move kept by index, `pin`'s run, `live`'s re-read, `follow`
//! let go, `find`'s tints). Then its three settings, over the same rows
//! and a column a kind more ([`Sheet::open_kinds`]): under
//! `PopoverCells::CutText`, which cells draw a cue and which Enter opens
//! (the others' reaching the host), `open_popover` on any, the decision
//! made again at a new width and a landed page; the cue's fade (nothing at
//! rest, the glyphs' alphas by their place and none moved, a number left
//! alone, the view's edge, a narrow cell, another density, `find`'s tints);
//! its open mark kept on the open popover's cell; and the filled button's
//! width.

use std::cell::{Cell as Counter, RefCell};
use std::ops::Range;
use std::rc::Rc;

use gpui_kit::component::scroll::Scrollbar;
use gpui_kit::prelude::FluentBuilder as _;
use gpui_kit::{
    App, AppContext as _, Context, Entity, InteractiveElement as _, IntoElement, KeyBinding,
    Modifiers, MouseButton, MouseDownEvent, MouseMoveEvent, MouseUpEvent, ParentElement as _,
    Pixels, Point, Render, Styled as _, TestAppContext, VisualTestContext, Window, actions, div,
    point, px, size,
};

use super::super::{TallTableEvent, TallTableState, row_height};
use crate::column::{ColumnKind, TallTableColumn};
use crate::delegate::{CellValue, PageLoad, TallTableDelegate, TallTablePage};
use crate::popover::{POPOVER_CHARS, PopoverButton, PopoverCell, PopoverCue};
use crate::probe::PopoverProbe;
use crate::tall_table::TallTable;

actions!(popover_test, [HostEnter, HostEscape, HostCopy]);

/// The rows' values, by column: a rounded float, a short text carrying the
/// source's version, a long text, two lines, a NULL on even rows, and with
/// `huge` a text past the cap.
#[derive(Clone)]
struct Source {
    version: Rc<Counter<u64>>,
    huge: Option<Rc<str>>,
    /// The settings' columns after the fifth ([`kinds_columns`]).
    kinds: bool,
}

/// A timestamp too long for its column, cut at its end.
const STAMP: &str = "2026-11-21 12:34:56.123456789 +00:00";
/// A text cut at a text column's 200 px and whole at 300.
const MIDDLING: &str = "exactly thirty characters long";

const LONG: &str = "lorem ipsum dolor sit amet ";
const LONG_REPEAT: usize = 120;

struct Memory(Source);

struct Rows {
    rows: Range<u64>,
    version: u64,
    huge: Option<Rc<str>>,
    long: Rc<str>,
    kinds: bool,
}

impl TallTablePage for Rows {
    fn value(&self, row: usize, column: usize) -> Option<CellValue<'_>> {
        let row = self.rows.start + row as u64;
        Some(match column {
            0 => CellValue::Float(row as f64 + 1.0 / 3.0),
            1 => CellValue::Text(format!("r{row}v{}", self.version).into()),
            2 => CellValue::Text(self.long.as_ref().into()),
            3 => CellValue::Text("first\r\nsecond".into()),
            4 if row.is_multiple_of(2) => CellValue::Null,
            4 => CellValue::Text("odd".into()),
            // The settings' columns: an integer, a timestamp, a text that
            // grows with the source's version, one over a fill, and one a
            // wider column shows whole.
            5 if self.kinds => CellValue::Text((row * 7).to_string().into()),
            6 if self.kinds => CellValue::Text(STAMP.into()),
            7 if self.kinds && self.version == 0 => CellValue::Text("small".into()),
            7 | 8 if self.kinds => CellValue::Text(self.long.as_ref().into()),
            9 if self.kinds => CellValue::Text(MIDDLING.into()),
            5 => CellValue::Text(self.huge.as_deref()?.into()),
            _ => return None,
        })
    }

    fn heap_bytes(&self) -> usize {
        1024
    }

    #[cfg(feature = "custom-cells")]
    fn paint(&self, _: usize, column: usize) -> crate::CellPaint {
        let mut paint = crate::CellPaint::default();
        if self.kinds && column == 8 {
            paint.fill = Some(0.5);
        }
        paint
    }
}

impl TallTableDelegate for Memory {
    type Page = Rows;
    type Request = u64;

    fn load_page(&mut self, rows: Range<u64>, _: &mut App) -> (u64, PageLoad<Rows>) {
        let page = Rows {
            rows: rows.clone(),
            version: self.0.version.get(),
            huge: self.0.huge.clone(),
            long: LONG.repeat(LONG_REPEAT).into(),
            kinds: self.0.kinds,
        };
        (rows.start, Box::pin(std::future::ready(Ok(page))))
    }

    fn cancel(&mut self, _: u64, _: &mut App) {}

    #[cfg(feature = "sort")]
    fn sort(&mut self, _: &[crate::Sort], _: &mut App) -> Result<(), crate::SortRefused> {
        Ok(())
    }
}

type Table = TallTableState<Memory>;

/// The host: the table's element in a context of its own, whose Enter,
/// Escape, and Cmd+C count what the table lets through, under the
/// window's text selection layer (`Root`'s).
struct Shell {
    table: Entity<Table>,
    heard: Rc<RefCell<Vec<&'static str>>>,
    /// A line of the host's own selectable text, over the table's
    /// bottom-left corner.
    host_text: bool,
}

/// The host's own selectable text, with `host_text`.
const HOST_TEXT: &str = "the host's own words";

impl Render for Shell {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        div()
            .key_context("Host")
            .on_action(cx.listener(|this, _: &HostEnter, _, _| {
                this.heard.borrow_mut().push("enter");
            }))
            .on_action(cx.listener(|this, _: &HostEscape, _, _| {
                this.heard.borrow_mut().push("escape");
            }))
            .on_action(cx.listener(|this, _: &HostCopy, _, _| {
                this.heard.borrow_mut().push("copy");
            }))
            .size_full()
            .relative()
            .child(gpui_kit::base::TextSelectionLayer)
            .child(TallTable::new(&self.table))
            .when(self.host_text, |shell| {
                shell.child(
                    div()
                        .absolute()
                        .left_0()
                        .bottom_0()
                        .w(px(240.))
                        .h(px(20.))
                        .child(gpui_kit::base::SelectableText::new("host-text", HOST_TEXT)),
                )
            })
    }
}

/// The columns: `f` (a float), `short`, `long`, `lines`, `maybe` (NULL on
/// even rows), and with `huge` the cap's; each its kind's width (120 px a
/// float, 200 a text).
fn columns(huge: bool) -> Vec<TallTableColumn> {
    let mut columns = vec![
        TallTableColumn::new("f", ColumnKind::Float),
        TallTableColumn::new("short", ColumnKind::Text),
        TallTableColumn::new("long", ColumnKind::Text),
        TallTableColumn::new("lines", ColumnKind::Text),
        TallTableColumn::new("maybe", ColumnKind::Text),
    ];
    if huge {
        columns.push(TallTableColumn::new("huge", ColumnKind::Text));
    }
    #[cfg(feature = "sort")]
    let columns = columns
        .into_iter()
        .map(|column| column.sortable(true))
        .collect();
    columns
}

/// A table in a window 20 rows tall whose cells area is `cells_width`
/// wide, over [`ROWS`] rows, with every event it emitted.
struct Sheet<'a> {
    cx: &'a mut VisualTestContext,
    table: Entity<Table>,
    /// The source's version, which a test bumps (`live`).
    #[cfg_attr(not(feature = "live"), expect(dead_code))]
    source: Source,
    events: Rc<RefCell<Vec<TallTableEvent>>>,
    heard: Rc<RefCell<Vec<&'static str>>>,
    _subscription: gpui_kit::Subscription,
}

impl<'a> Sheet<'a> {
    fn open(cx: &'a mut TestAppContext, cells_width: f32) -> Self {
        Self::open_with(cx, cells_width, false, false)
    }

    fn open_with(
        cx: &'a mut TestAppContext,
        cells_width: f32,
        huge: bool,
        host_text: bool,
    ) -> Self {
        Self::open_over(cx, cells_width, huge, false, host_text)
    }

    /// The settings' table: [`kinds_columns`], every one in view.
    fn open_kinds(cx: &'a mut TestAppContext) -> Self {
        Self::open_over(cx, KINDS_WIDTH, false, true, false)
    }

    fn open_over(
        cx: &'a mut TestAppContext,
        cells_width: f32,
        huge: bool,
        kinds: bool,
        host_text: bool,
    ) -> Self {
        cx.update(|cx| {
            gpui_kit::component::init(cx);
            crate::init(cx);
            cx.bind_keys([
                KeyBinding::new("enter", HostEnter, Some("Host")),
                KeyBinding::new("escape", HostEscape, Some("Host")),
                KeyBinding::new("cmd-c", HostCopy, Some("Host")),
            ]);
        });
        let source = Source {
            version: Rc::default(),
            huge: huge.then(|| "a".repeat(POPOVER_CHARS + 10).into()),
            kinds,
        };
        let heard: Rc<RefCell<Vec<&'static str>>> = Rc::default();
        let (shell, cx) = cx.add_window_view({
            let (source, heard) = (source.clone(), heard.clone());
            move |_, cx| {
                let table = cx.new(|cx| {
                    let columns = if kinds {
                        kinds_columns(None)
                    } else {
                        columns(huge)
                    };
                    TallTableState::new(Memory(source), columns, ROWS, Default::default(), cx)
                        .probe_frames(true)
                });
                Shell {
                    table,
                    heard,
                    host_text,
                }
            }
        });
        let table = shell.read_with(cx, |shell, _| shell.table.clone());
        let (gutter, bar) = table.read_with(cx, |table, _| {
            (table.gutter_width(), f32::from(Scrollbar::width()))
        });
        let row_h = f32::from(row_height());
        cx.simulate_resize(size(
            px(cells_width + gutter + bar + 2.0),
            px(20.0 * row_h + row_h + bar + 2.0),
        ));
        let events: Rc<RefCell<Vec<TallTableEvent>>> = Rc::default();
        let heard_events = events.clone();
        let subscription = cx.update(|_, cx| {
            cx.subscribe(&table, move |_, event: &TallTableEvent, _| {
                heard_events.borrow_mut().push(event.clone());
            })
        });
        let mut sheet = Self {
            cx,
            table,
            source,
            events,
            heard,
            _subscription: subscription,
        };
        sheet.draw();
        let handle = sheet.read(|table| table.focus_handle.clone());
        sheet.cx.update(|window, cx| window.focus(&handle, cx));
        sheet.draw();
        assert_eq!(sheet.read(|table| table.cells_width()), cells_width);
        sheet.events.borrow_mut().clear();
        sheet
    }

    fn draw(&mut self) {
        for _ in 0..3 {
            self.cx.run_until_parked();
            self.cx.update(|window, cx| window.draw(cx).clear(cx));
        }
    }

    fn read<T>(&mut self, read: impl FnOnce(&Table) -> T) -> T {
        self.table.read_with(self.cx, |table, _| read(table))
    }

    fn update<T>(&mut self, update: impl FnOnce(&mut Table, &mut Context<Table>) -> T) -> T {
        let result = self.table.update(self.cx, update);
        self.draw();
        result
    }

    fn open_on(&mut self, row: u64, column: usize) -> bool {
        self.update(|table, cx| table.open_popover(PopoverCell::new(row, column), cx))
    }

    fn popover(&mut self) -> Option<PopoverCell> {
        self.read(|table| table.popover())
    }

    fn probe(&mut self) -> Option<PopoverProbe> {
        self.read(|table| table.popover_probe())
    }

    fn text(&mut self) -> String {
        self.read(|table| {
            let open = table.popover_state.open.as_ref().expect("open");
            open.text.text.to_string()
        })
    }

    /// The `Popover` and `PopoverButton` events heard since the last call,
    /// as `Some(cell)`/`None` and `("button", cell)`.
    fn popover_events(&mut self) -> Vec<(&'static str, Option<PopoverCell>)> {
        self.events
            .borrow_mut()
            .drain(..)
            .filter_map(|event| match event {
                TallTableEvent::Popover(cell) => Some(("popover", cell)),
                TallTableEvent::PopoverButton(cell) => Some(("button", Some(cell))),
                _ => None,
            })
            .collect()
    }

    fn heard(&mut self) -> Vec<&'static str> {
        self.heard.borrow_mut().drain(..).collect()
    }

    /// The middle of the cell on row `row` of the view (from its top) at
    /// place `place`, unscrolled.
    fn at(&mut self, row: f32, place: usize) -> Point<Pixels> {
        let (origin, gutter, column) = self.read(|table| {
            let column = &table.columns[place];
            (
                table.body.origin,
                table.gutter_width(),
                (column.x, column.width),
            )
        });
        origin
            + point(
                px(gutter + column.0 + column.1 / 2.0),
                row_height() * (row + 0.5),
            )
    }

    /// The left edge of the cell at place `place`, unscrolled.
    fn left(&mut self, place: usize) -> f32 {
        self.read(|table| {
            f32::from(table.body.origin.x) + table.gutter_width() + table.columns[place].x
        })
    }

    fn hover(&mut self, at: Point<Pixels>) {
        self.cx.simulate_event(MouseMoveEvent {
            position: at,
            pressed_button: None,
            modifiers: Modifiers::default(),
        });
        self.draw();
    }

    fn press(&mut self, at: Point<Pixels>) {
        self.cx.simulate_event(MouseDownEvent {
            position: at,
            modifiers: Modifiers::default(),
            button: MouseButton::Left,
            click_count: 1,
            first_mouse: false,
        });
        self.cx.simulate_event(MouseUpEvent {
            position: at,
            modifiers: Modifiers::default(),
            button: MouseButton::Left,
            click_count: 1,
        });
        self.draw();
    }

    fn key(&mut self, keys: &str) {
        self.cx.simulate_keystrokes(keys);
        self.draw();
    }

    fn window_size(&mut self) -> (f32, f32) {
        self.cx.update(|window, _| {
            let size = window.viewport_size();
            (f32::from(size.width), f32::from(size.height))
        })
    }

    /// The cue drawn this frame, by cell.
    fn cues(&mut self) -> Vec<PopoverCell> {
        self.read(|table| {
            table
                .popover_state_cues()
                .into_iter()
                .map(|(cell, _)| cell)
                .collect()
        })
    }

    fn cue_center(&mut self, cell: PopoverCell) -> Point<Pixels> {
        self.read(|table| {
            let (_, bounds) = table
                .popover_state_cues()
                .into_iter()
                .find(|(at, _)| *at == cell)
                .expect("a cue on the cell");
            bounds.center()
        })
    }

    /// Scrolls by `rows` and `x` px, as a wheel would.
    fn scroll(&mut self, rows: f64, x: f32) {
        self.update(|table, cx| table.scroll_by(rows, x, cx));
    }
}

/// Every column of [`columns`] without the cap's: a float's 120 px and
/// four texts' 200.
const WIDTH: f32 = 920.0;

/// Past the first page's 1,024 rows.
const ROWS: u64 = 10_000;

#[gpui_kit::test]
fn open_shows_the_exact_text_below_its_cell(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, WIDTH);
    assert!(sheet.open_on(2, 0));
    assert_eq!(sheet.popover(), Some(PopoverCell::new(2, 0)));
    assert_eq!(
        sheet.popover_events(),
        [("popover", Some(PopoverCell::new(2, 0)))]
    );
    // The float's exact text, not the cell's rounding.
    assert_eq!(sheet.text(), format!("{:?}", 2.0 + 1.0 / 3.0));
    let probe = sheet.probe().expect("placed");
    assert!(probe.below);
    let cell = sheet.at(2.0, 0);
    let row_h = f32::from(row_height());
    let [x, y, width, _] = probe.bounds;
    // Its left edge on the cell's, under the cell's bottom.
    let left = sheet.left(0);
    assert!((x - left).abs() <= 1.5, "{x} against {left}");
    assert!(y >= f32::from(cell.y) + row_h / 2.0);
    assert!(width >= 120.0, "at least its cell's width: {width}");
    assert_eq!(probe.button, None);
    // The same cell again: no event.
    assert!(sheet.open_on(2, 0));
    assert_eq!(sheet.popover_events(), []);
    // Another: moved, one event.
    assert!(sheet.open_on(3, 1));
    assert_eq!(
        sheet.popover_events(),
        [("popover", Some(PopoverCell::new(3, 1)))]
    );
    assert_eq!(sheet.text(), "r3v0");
}

#[gpui_kit::test]
fn its_text_keeps_lines_and_shows_null(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, WIDTH);
    assert!(sheet.open_on(1, 3));
    assert_eq!(sheet.text(), "first\nsecond");
    assert!(sheet.open_on(2, 4));
    assert_eq!(sheet.text(), "NULL");
    assert!(sheet.read(|table| table.popover_state.open.as_ref().unwrap().text.null));
    assert!(sheet.open_on(3, 4));
    assert_eq!(sheet.text(), "odd");
}

#[gpui_kit::test]
fn open_is_refused_out_of_view_and_unloaded(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, WIDTH);
    // A row below the view.
    assert!(!sheet.open_on(500, 0));
    // A column that isn't there.
    assert!(!sheet.open_on(0, 9));
    // A row in view whose page hasn't landed: scrolled there and asked in
    // one update, before the read answers.
    let opened = sheet.table.update(sheet.cx, |table, cx| {
        table.scroll_by(6000.0, 0.0, cx);
        table.open_popover(PopoverCell::new(6001, 0), cx)
    });
    assert!(!opened);
    sheet.draw();
    assert!(sheet.open_on(6001, 0));
}

#[gpui_kit::test]
fn open_is_refused_off_to_the_side(cx: &mut TestAppContext) {
    // The third column, right of a narrow view.
    let mut sheet = Sheet::open(cx, 300.0);
    assert!(!sheet.open_on(0, 2));
    assert!(sheet.popover_events().is_empty());
}

#[gpui_kit::test]
fn escape_closes_it_and_goes_on_with_none(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, WIDTH);
    sheet.key("escape");
    assert_eq!(sheet.heard(), ["escape"]);
    assert!(sheet.open_on(1, 1));
    sheet.popover_events();
    sheet.key("escape");
    assert_eq!(sheet.popover(), None);
    assert_eq!(sheet.popover_events(), [("popover", None)]);
    assert_eq!(sheet.heard(), Vec::<&str>::new());
}

#[gpui_kit::test]
fn enter_closes_it_with_no_button_and_goes_on_with_none(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, WIDTH);
    sheet.key("enter");
    assert_eq!(sheet.heard(), ["enter"]);
    assert!(sheet.open_on(1, 1));
    sheet.popover_events();
    sheet.key("enter");
    assert_eq!(sheet.popover(), None);
    assert_eq!(sheet.popover_events(), [("popover", None)]);
    assert_eq!(sheet.heard(), Vec::<&str>::new());
}

#[gpui_kit::test]
fn the_button_is_pressed_by_enter_and_by_a_press(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, WIDTH);
    sheet.update(|table, cx| table.set_popover_button(Some(PopoverButton::label("Open row")), cx));
    assert!(sheet.open_on(1, 1));
    sheet.popover_events();
    let button = sheet.probe().and_then(|probe| probe.button).expect("drawn");
    assert!(button[2] > 0.0 && button[3] > 0.0);
    sheet.key("enter");
    assert_eq!(
        sheet.popover_events(),
        [("button", Some(PopoverCell::new(1, 1))), ("popover", None)]
    );
    // By a press: the table keeps its focus.
    assert!(sheet.open_on(2, 1));
    sheet.popover_events();
    let [x, y, width, height] = sheet.probe().and_then(|probe| probe.button).unwrap();
    sheet.press(point(px(x + width / 2.0), px(y + height / 2.0)));
    assert_eq!(
        sheet.popover_events(),
        [("button", Some(PopoverCell::new(2, 1))), ("popover", None)]
    );
    let focused = sheet
        .table
        .read_with(sheet.cx, |table, _| table.focus_handle.clone());
    assert!(sheet.cx.update(|window, _| focused.is_focused(window)));
    // A host's own element, pressed the same way.
    sheet.update(|table, cx| {
        table.set_popover_button(
            Some(PopoverButton::custom(|_, _| {
                div().w(px(80.)).h(px(24.)).child("Mine").into_any_element()
            })),
            cx,
        )
    });
    assert!(sheet.open_on(3, 1));
    sheet.popover_events();
    let [x, y, width, height] = sheet.probe().and_then(|probe| probe.button).unwrap();
    assert_eq!((width, height), (80.0, 24.0));
    sheet.press(point(px(x + 40.0), px(y + 12.0)));
    assert_eq!(
        sheet.popover_events(),
        [("button", Some(PopoverCell::new(3, 1))), ("popover", None)]
    );
}

#[gpui_kit::test]
fn a_press_outside_closes_it(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, WIDTH);
    assert!(sheet.open_on(1, 1));
    sheet.popover_events();
    // Inside: stays.
    let [x, y, width, height] = sheet.probe().unwrap().bounds;
    sheet.press(point(px(x + width / 2.0), px(y + height / 2.0)));
    assert_eq!(sheet.popover(), Some(PopoverCell::new(1, 1)));
    let at = sheet.at(12.0, 4);
    sheet.press(at);
    assert_eq!(sheet.popover(), None);
    assert_eq!(sheet.popover_events(), [("popover", None)]);
}

#[gpui_kit::test]
fn its_cell_leaving_the_view_closes_it(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, 400.0);
    // Down: row 3 scrolled past the top.
    assert!(sheet.open_on(3, 0));
    sheet.scroll(2.0, 0.0);
    assert_eq!(
        sheet.popover(),
        Some(PopoverCell::new(3, 0)),
        "still in view"
    );
    sheet.scroll(2.0, 0.0);
    assert_eq!(sheet.popover(), None);
    // Sideways: column 0 scrolled out to the left.
    assert!(sheet.open_on(10, 0));
    sheet.scroll(0.0, 100.0);
    assert_eq!(
        sheet.popover(),
        Some(PopoverCell::new(10, 0)),
        "partly in view"
    );
    sheet.scroll(0.0, 40.0);
    assert_eq!(sheet.popover(), None);
}

#[gpui_kit::test]
fn what_renames_its_cell_closes_it(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, WIDTH);
    // `replace_rows`.
    assert!(sheet.open_on(1, 1));
    sheet.update(|table, cx| table.replace_rows(1000, crate::ViewAt::Top, cx));
    assert_eq!(sheet.popover(), None);
    // `set_columns`.
    assert!(sheet.open_on(1, 1));
    sheet.update(|table, cx| table.set_columns(columns(false), cx));
    assert_eq!(sheet.popover(), None);
    // A `set_rows` cutting its row; one that doesn't keeps it.
    assert!(sheet.open_on(5, 1));
    sheet.update(|table, cx| table.set_rows(10, cx));
    assert_eq!(sheet.popover(), Some(PopoverCell::new(5, 1)));
    sheet.update(|table, cx| table.set_rows(5, cx));
    assert_eq!(sheet.popover(), None);
    sheet.popover_events();
    // `close`: its event once the update ends.
    sheet.update(|table, cx| table.set_rows(1000, cx));
    assert!(sheet.open_on(1, 1));
    sheet.popover_events();
    sheet.update(|table, cx| table.close(cx));
    assert_eq!(sheet.popover(), None);
    assert_eq!(sheet.popover_events(), [("popover", None)]);
    assert!(!sheet.open_on(1, 1), "a closed table opens none");
}

#[gpui_kit::test]
fn it_flips_above_at_the_bottom_and_its_size_is_capped(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, WIDTH);
    let (window_width, window_height) = sheet.window_size();
    // The long text, on the last whole row: no room below.
    assert!(sheet.open_on(19, 2));
    let probe = sheet.probe().unwrap();
    assert!(!probe.below, "flipped above");
    let cell_top = f32::from(sheet.at(19.0, 2).y) - f32::from(row_height()) / 2.0;
    assert!(probe.bounds[1] + probe.bounds[3] <= cell_top + 0.5);
    // Its height half the window's, its text scrolled inside.
    assert!(probe.bounds[3] <= window_height * 0.5 + 0.5, "{probe:?}");
    assert!(probe.content_height > probe.bounds[3], "{probe:?}");
    assert!(probe.bounds[2] <= (window_width * 0.75).max(0.0) + 0.5);
    assert!(probe.bounds[2] <= 400.0 + 0.5, "max(120, 400): {probe:?}");
    // Near the top, below.
    assert!(sheet.open_on(0, 2));
    assert!(sheet.probe().unwrap().below);
}

#[gpui_kit::test]
fn a_wheel_over_it_scrolls_it_not_the_table(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, WIDTH);
    assert!(sheet.open_on(0, 2));
    let [x, y, width, height] = sheet.probe().unwrap().bounds;
    let top = sheet.read(|table| table.scroll.top());
    sheet.cx.simulate_event(gpui_kit::ScrollEvent {
        position: point(px(x + width / 2.0), px(y + height / 2.0)),
        delta: gpui_kit::ScrollDelta::Pixels(point(px(0.), px(-60.))),
        modifiers: Modifiers::default(),
        touch_phase: gpui_kit::TouchPhase::Moved,
        source: gpui_kit::ScrollSource::Pointer,
    });
    sheet.draw();
    assert_eq!(sheet.read(|table| table.scroll.top()), top);
    assert!(sheet.probe().unwrap().scroll > 0.0);
}

#[gpui_kit::test]
fn its_text_is_cut_at_the_cap(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open_with(cx, WIDTH + 200.0, true, false);
    assert!(sheet.open_on(0, 5));
    let probe = sheet.probe().unwrap();
    assert!(probe.cut);
    assert_eq!(probe.chars, POPOVER_CHARS + 1);
    assert!(sheet.text().ends_with('…'));
}

#[gpui_kit::test]
fn no_tooltip_shows_while_it_is_open(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, WIDTH);
    let long = sheet.at(4.0, 2);
    sheet.hover(long);
    sheet
        .cx
        .executor()
        .advance_clock(std::time::Duration::from_secs(1));
    sheet.draw();
    assert!(
        sheet.read(|table| table.render_tooltip().is_some()),
        "a tooltip at rest"
    );
    assert!(sheet.open_on(4, 2));
    assert!(sheet.read(|table| table.render_tooltip().is_none()));
    assert!(sheet.read(|table| table.hover.as_ref().unwrap().tooltip.is_none()));
}

#[gpui_kit::test]
fn the_cue_shows_where_the_popover_shows_more(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, WIDTH);
    // The rounded float, the cut text, the lines: a cue.
    for place in [0, 2, 3] {
        let at = sheet.at(1.0, place);
        sheet.hover(at);
        assert_eq!(sheet.cues(), [PopoverCell::new(1, place)], "place {place}");
    }
    // A short text that fits, and a NULL: none.
    for (row, place) in [(1.0, 1), (2.0, 4)] {
        let at = sheet.at(row, place);
        sheet.hover(at);
        assert_eq!(sheet.cues(), [], "place {place}");
    }
    // With a button, every loaded cell has one.
    sheet.update(|table, cx| table.set_popover_button(Some(PopoverButton::label("Open")), cx));
    let at = sheet.at(1.0, 1);
    sheet.hover(at);
    assert_eq!(sheet.cues(), [PopoverCell::new(1, 1)]);
    // Opted out: none.
    sheet.update(|table, cx| table.set_popover_cue(None, cx));
    assert_eq!(sheet.cues(), []);
    // A host's look.
    sheet.update(|table, cx| {
        table.set_popover_cue(
            Some(PopoverCue::custom(|_, _| {
                div().size_full().into_any_element()
            })),
            cx,
        )
    });
    let at = sheet.at(2.0, 1);
    sheet.hover(at);
    assert_eq!(sheet.cues(), [PopoverCell::new(2, 1)]);
}

/// The cue's mark is painted with its cell's text: on a text cut at its
/// end, in place of its "…", the cut as it was (nothing moves); on a text
/// with no "…" to give (a rounded float, right-aligned), the text cut and
/// aligned short of the mark at the cell's right end.
#[gpui_kit::test]
fn the_cue_takes_the_ellipsis_or_the_text_ends_before_it(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, WIDTH);
    // The test text system's advance: 0.6 em at the cells' 14 px.
    let advance = 8.4;
    let drawn = |sheet: &mut Sheet, row: u64, column: usize| {
        sheet.read(|table| {
            table
                .drawn_text
                .borrow()
                .iter()
                .find(|cell| (cell.row, cell.column) == (row, column))
                .map(|cell| (cell.text.clone(), cell.x, cell.mark))
                .expect("drawn")
        })
    };
    // The long text: its "…" given to the mark.
    let at = sheet.at(1.0, 2);
    sheet.hover(at);
    let (cued, x, mark) = drawn(&mut sheet, 1, 2);
    let (uncued, uncued_x, none) = drawn(&mut sheet, 2, 2);
    assert_eq!(none, None);
    assert!(uncued.ends_with('…'));
    assert_eq!(format!("{cued}…"), uncued, "the cut kept");
    assert_eq!(x, uncued_x, "nothing moved");
    let mark = mark.expect("the mark painted");
    let ellipsis = x + cued.chars().count() as f32 * advance;
    assert!(
        f32::from(mark.left()) >= ellipsis - 0.5
            && f32::from(mark.right()) <= ellipsis + advance + 0.5,
        "the mark {mark:?} where the \"…\" was ({ellipsis}..{})",
        ellipsis + advance
    );
    // The rounded float, right-aligned: no "…" to give, so it ends before
    // the mark at the cell's right end.
    let at = sheet.at(1.0, 0);
    sheet.hover(at);
    let (text, x, mark) = drawn(&mut sheet, 1, 0);
    let mark = mark.expect("the mark painted");
    let end = x + text.chars().count() as f32 * advance;
    assert!(
        end <= f32::from(mark.left()) + 0.5,
        "{text:?} ends at {end}, the mark at {mark:?}"
    );
    let cell_right = sheet.read(|table| {
        f32::from(table.body.origin.x) + table.gutter_width() + table.columns[0].width
    });
    assert!(f32::from(mark.right()) <= cell_right, "inside its cell");
}

#[gpui_kit::test]
fn a_press_on_the_cue_opens_moves_and_closes_it(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, WIDTH);
    let at = sheet.at(1.0, 2);
    sheet.hover(at);
    let cell = PopoverCell::new(1, 2);
    let cue = sheet.cue_center(cell);
    sheet.press(cue);
    assert_eq!(sheet.popover(), Some(cell));
    // Another cell's cue moves it, one event.
    let at = sheet.at(3.0, 0);
    sheet.hover(at);
    let other = PopoverCell::new(3, 0);
    let cue = sheet.cue_center(other);
    sheet.popover_events();
    sheet.press(cue);
    assert_eq!(sheet.popover_events(), [("popover", Some(other))]);
    // Its own cell's again closes it (the press let go of the hover).
    let at = sheet.at(3.0, 0);
    sheet.hover(at);
    let cue = sheet.cue_center(other);
    sheet.press(cue);
    assert_eq!(sheet.popover(), None);
}

#[cfg(feature = "select")]
#[gpui_kit::test]
fn enter_opens_it_on_the_active_cell_only(cx: &mut TestAppContext) {
    use crate::selection::TallTableSelection;
    let mut sheet = Sheet::open(cx, WIDTH);
    sheet.update(|table, cx| {
        table.set_selection(
            Some(TallTableSelection::Rows {
                anchor: (2, 0),
                head: (2, 0),
            }),
            cx,
        )
    });
    sheet.key("enter");
    assert_eq!(sheet.popover(), None);
    assert_eq!(sheet.heard(), ["enter"]);
    sheet.update(|table, cx| {
        table.set_selection(
            Some(TallTableSelection::Cells {
                anchor: (2, 3),
                head: (4, 4),
            }),
            cx,
        )
    });
    sheet.key("enter");
    assert_eq!(sheet.popover(), Some(PopoverCell::new(2, 3)));
    assert_eq!(sheet.heard(), Vec::<&str>::new());
    // Escape closes it before it clears the selection.
    sheet.key("escape");
    assert_eq!(sheet.popover(), None);
    assert!(sheet.read(|table| table.selection().is_some()));
    sheet.key("escape");
    assert!(sheet.read(|table| table.selection().is_none()));
    // The keys moving the active cell close it.
    sheet.update(|table, cx| {
        table.set_selection(
            Some(TallTableSelection::Cells {
                anchor: (2, 3),
                head: (2, 3),
            }),
            cx,
        )
    });
    sheet.key("enter");
    assert!(sheet.popover().is_some());
    sheet.key("down");
    assert_eq!(sheet.popover(), None);
    // The active cell's cue, with no pointer over the table.
    assert_eq!(sheet.cues(), [PopoverCell::new(3, 3)]);
}

#[cfg(feature = "select")]
#[gpui_kit::test]
fn a_press_outside_goes_on_to_select(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, WIDTH);
    assert!(sheet.open_on(1, 1));
    let at = sheet.at(12.0, 4);
    sheet.press(at);
    assert_eq!(sheet.popover(), None);
    assert_eq!(
        sheet.read(|table| table.selection().map(|selection| selection.anchor())),
        Some((12, 4))
    );
}

#[cfg(feature = "select")]
#[gpui_kit::test]
fn the_cue_s_press_is_stopped_from_select(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, WIDTH);
    let at = sheet.at(1.0, 2);
    sheet.hover(at);
    let cue = sheet.cue_center(PopoverCell::new(1, 2));
    sheet.press(cue);
    assert_eq!(sheet.popover(), Some(PopoverCell::new(1, 2)));
    assert_eq!(sheet.read(|table| table.selection()), None);
}

#[cfg(feature = "clicks")]
#[gpui_kit::test]
fn the_cue_s_press_is_not_reported(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, WIDTH);
    let at = sheet.at(1.0, 2);
    sheet.hover(at);
    let cue = sheet.cue_center(PopoverCell::new(1, 2));
    sheet.events.borrow_mut().clear();
    sheet.press(cue);
    let clicked = sheet
        .events
        .borrow()
        .iter()
        .filter(|event| matches!(event, TallTableEvent::Clicked(_)))
        .count();
    assert_eq!(clicked, 0);
    // Nor a press inside the popover.
    let [x, y, width, height] = sheet.probe().unwrap().bounds;
    sheet.press(point(px(x + width / 2.0), px(y + height / 2.0)));
    let clicked = sheet
        .events
        .borrow()
        .iter()
        .filter(|event| matches!(event, TallTableEvent::Clicked(_)))
        .count();
    assert_eq!(clicked, 0);
}

/// A drag across the popover's text selects part of it, and Cmd+C copies
/// that part: the popover's key, with or without `copy` (whose key it
/// goes before), and nothing to the host.
#[gpui_kit::test]
fn a_part_of_its_text_is_selected_and_copied(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, WIDTH);
    assert!(sheet.open_on(1, 2));
    let [x, y, _, _] = sheet.probe().unwrap().bounds;
    let line = y + f32::from(row_height()) * 0.6;
    let (from, to) = (
        point(px(x + 12.0), px(line)),
        point(px(x + 160.0), px(line)),
    );
    sheet
        .cx
        .simulate_mouse_down(from, MouseButton::Left, Modifiers::default());
    sheet
        .cx
        .simulate_mouse_move(to, Some(MouseButton::Left), Modifiers::default());
    sheet
        .cx
        .simulate_mouse_up(to, MouseButton::Left, Modifiers::default());
    sheet.draw();
    assert_eq!(
        sheet.popover(),
        Some(PopoverCell::new(1, 2)),
        "a press inside keeps it"
    );
    sheet.key("cmd-c");
    let copied = sheet
        .cx
        .read_from_clipboard()
        .and_then(|item| item.text())
        .expect("copied");
    assert!(
        !copied.is_empty() && copied.len() < LONG.len() * LONG_REPEAT,
        "{copied:?}"
    );
    assert!(LONG.repeat(LONG_REPEAT).contains(&copied), "{copied:?}");
    assert_eq!(sheet.heard(), Vec::<&str>::new());
    // Closed: Cmd+C goes on, as before.
    sheet.key("escape");
    sheet.key("cmd-c");
    #[cfg(not(feature = "copy"))]
    assert_eq!(sheet.heard(), ["copy"]);
}

#[cfg(feature = "sort")]
#[gpui_kit::test]
fn a_sort_closes_it(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, WIDTH);
    assert!(sheet.open_on(1, 1));
    sheet
        .update(|table, cx| {
            table.set_sort(
                vec![crate::Sort::new(0, crate::SortDirection::Descending)],
                cx,
            )
        })
        .expect("sorted");
    assert_eq!(sheet.popover(), None);
}

#[cfg(feature = "hide")]
#[gpui_kit::test]
fn a_hide_of_its_column_closes_it(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, WIDTH);
    assert!(sheet.open_on(1, 1));
    sheet.update(|table, cx| table.set_column_hidden(2, true, cx));
    assert_eq!(sheet.popover(), Some(PopoverCell::new(1, 1)), "another's");
    sheet.update(|table, cx| table.set_column_hidden(1, true, cx));
    assert_eq!(sheet.popover(), None);
    assert!(!sheet.open_on(1, 1), "a hidden column opens none");
}

#[cfg(feature = "reorder")]
#[gpui_kit::test]
fn a_move_keeps_it_by_index(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, WIDTH);
    sheet.update(|table, cx| table.set_popover_button(Some(PopoverButton::label("Open")), cx));
    assert!(sheet.open_on(1, 1));
    let before = sheet.probe().unwrap().bounds[0];
    sheet.update(|table, cx| table.set_order(vec![1, 0, 2, 3, 4], cx));
    assert_eq!(sheet.popover(), Some(PopoverCell::new(1, 1)));
    let after = sheet.probe().unwrap().bounds[0];
    assert!(
        (after - (before - 120.0)).abs() <= 1.5,
        "placed at its column's new place: {before} {after}"
    );
    sheet.popover_events();
    sheet.key("enter");
    assert_eq!(
        sheet.popover_events()[0],
        ("button", Some(PopoverCell::new(1, 1)))
    );
}

#[cfg(feature = "pin")]
#[gpui_kit::test]
fn a_cell_behind_the_run_closes_it(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, 400.0);
    sheet.update(|table, cx| table.set_pinned(1, cx));
    assert!(sheet.open_on(1, 1));
    // Column 1 (120..320) slides behind the run's edge at 120 px.
    sheet.scroll(0.0, 60.0);
    let probe = sheet.probe().unwrap();
    let edge = sheet.left(1);
    assert!(
        (probe.bounds[0] - edge).abs() <= 1.5,
        "the cell's visible part, from the run's edge: {probe:?}"
    );
    sheet.scroll(0.0, 150.0);
    assert_eq!(sheet.popover(), None);
}

#[cfg(feature = "live")]
#[gpui_kit::test]
fn a_re_read_changes_its_text_and_keeps_its_scroll(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, WIDTH);
    assert!(sheet.open_on(1, 1));
    assert_eq!(sheet.text(), "r1v0");
    sheet.source.version.set(1);
    sheet.update(|table, cx| {
        table.invalidate_rows(1..2, cx);
    });
    assert_eq!(sheet.text(), "r1v1");
    assert_eq!(sheet.popover(), Some(PopoverCell::new(1, 1)));
}

#[cfg(feature = "follow")]
#[gpui_kit::test]
fn opening_lets_go_of_following(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, WIDTH);
    sheet.update(|table, cx| table.follow(cx));
    assert!(sheet.read(|table| table.is_following()));
    let last = sheet.read(|table| table.visible_rows().end - 2);
    assert!(sheet.open_on(last, 1));
    assert!(!sheet.read(|table| table.is_following()));
}

#[cfg(feature = "find")]
#[gpui_kit::test]
fn the_term_is_tinted_in_its_text(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, WIDTH);
    sheet.update(|table, cx| table.set_find(Some("IPSUM".into()), cx));
    assert!(sheet.open_on(1, 2));
    let tints = sheet.read(|table| table.popover_state.open.as_ref().unwrap().tints.clone());
    assert_eq!(tints.len(), LONG_REPEAT);
    assert_eq!(tints[0], 6..11);
    // A new term, the tints follow; none for a cell that doesn't match.
    sheet.update(|table, cx| table.set_find(Some("dolor".into()), cx));
    let tints = sheet.read(|table| table.popover_state.open.as_ref().unwrap().tints.clone());
    assert_eq!(tints[0], 12..17);
    assert!(sheet.open_on(1, 1));
    let tints = sheet.read(|table| table.popover_state.open.as_ref().unwrap().tints.clone());
    assert!(tints.is_empty());
}

/// A cell cut by the view's right edge: its cue at its visible end, the
/// mark painted inside the cue's press box (not off view at the cell's whole
/// end), and the text ending before it (its "…", off view, not given).
#[gpui_kit::test]
fn a_cell_cut_by_the_view_s_edge_has_its_mark_in_its_press_box(cx: &mut TestAppContext) {
    // `long` runs 320..520, the view 400 wide.
    let mut sheet = Sheet::open(cx, 400.0);
    let (origin, gutter) = sheet.read(|table| (table.body.origin, table.gutter_width()));
    let at = origin + point(px(gutter + 360.0), row_height() * 1.5);
    sheet.hover(at);
    let cell = PopoverCell::new(1, 2);
    let press = sheet.read(|table| {
        table
            .popover_state_cues()
            .into_iter()
            .find(|(at, _)| *at == cell)
            .map(|(_, bounds)| bounds)
            .expect("a cue")
    });
    let view_right = f32::from(origin.x) + gutter + 400.0;
    assert!(f32::from(press.right()) <= view_right, "{press:?} in view");
    let (text, x, mark) = sheet.read(|table| {
        table
            .drawn_text
            .borrow()
            .iter()
            .find(|drawn| (drawn.row, drawn.column) == (1, 2))
            .map(|drawn| (drawn.text.clone(), drawn.x, drawn.mark))
            .expect("drawn")
    });
    let mark = mark.expect("the mark painted");
    assert!(
        mark.left() >= press.left() - px(0.5) && mark.right() <= press.right() + px(0.5),
        "the mark {mark:?} in its press box {press:?}"
    );
    let end = x + text.chars().count() as f32 * 8.4;
    assert!(
        end <= f32::from(mark.left()) + 0.5,
        "{text:?} ends at {end}, the mark at {mark:?}"
    );
}

/// The probe's `cue` is the hovered cell's, whichever was cued first.
#[cfg(feature = "select")]
#[gpui_kit::test]
fn the_probe_s_cue_is_the_hovered_cell_s(cx: &mut TestAppContext) {
    use crate::selection::TallTableSelection;
    let mut sheet = Sheet::open(cx, WIDTH);
    sheet.update(|table, cx| {
        table.set_selection(
            Some(TallTableSelection::Cells {
                anchor: (2, 2),
                head: (2, 2),
            }),
            cx,
        )
    });
    assert_eq!(sheet.cues(), [PopoverCell::new(2, 2)]);
    let at = sheet.at(5.0, 2);
    sheet.hover(at);
    assert_eq!(
        sheet.cues(),
        [PopoverCell::new(5, 2), PopoverCell::new(2, 2)]
    );
    let cue = sheet.read(|table| table.cue_probe()).expect("a cue");
    assert_eq!(cue.cell, PopoverCell::new(5, 2));
}

/// A part of one popover's text selected, then the popover moved to
/// another cell while open (its text element drawn throughout, its id the
/// same): Cmd+C has nothing of the new popover's to copy, so it goes on to
/// the host.
#[gpui_kit::test]
fn a_selection_in_another_popover_s_text_isn_t_copied(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, WIDTH);
    assert!(sheet.open_on(1, 2));
    let [x, y, _, _] = sheet.probe().unwrap().bounds;
    let line = y + f32::from(row_height()) * 0.6;
    let (from, to) = (
        point(px(x + 12.0), px(line)),
        point(px(x + 160.0), px(line)),
    );
    sheet
        .cx
        .simulate_mouse_down(from, MouseButton::Left, Modifiers::default());
    sheet
        .cx
        .simulate_mouse_move(to, Some(MouseButton::Left), Modifiers::default());
    sheet
        .cx
        .simulate_mouse_up(to, MouseButton::Left, Modifiers::default());
    sheet.draw();
    assert!(sheet.open_on(3, 2));
    sheet.heard();
    sheet.key("cmd-c");
    assert_eq!(sheet.cx.read_from_clipboard(), None, "nothing copied");
    #[cfg(not(feature = "copy"))]
    assert_eq!(sheet.heard(), ["copy"]);
}

/// The button taken away while the popover is open: the probe has none.
#[gpui_kit::test]
fn a_button_taken_away_leaves_the_probe(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, WIDTH);
    sheet.update(|table, cx| table.set_popover_button(Some(PopoverButton::label("Open")), cx));
    assert!(sheet.open_on(1, 1));
    assert!(sheet.probe().unwrap().button.is_some());
    sheet.update(|table, cx| table.set_popover_button(None, cx));
    assert_eq!(sheet.probe().unwrap().button, None);
}

/// `open_popover` on the cell it's open on, its page read again (a grown
/// short last page, forgotten without `live`): still open, so true.
#[cfg(not(feature = "live"))]
#[gpui_kit::test]
fn open_on_its_own_cell_with_its_page_loading_is_true(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, WIDTH);
    sheet.scroll(ROWS as f64, 0.0);
    let row = ROWS - 2;
    assert!(sheet.open_on(row, 1));
    let (loading, again) = sheet.table.update(sheet.cx, |table, cx| {
        table.set_rows(ROWS + 50, cx);
        let loading = !matches!(table.cache.row(row), crate::pages::RowState::Loaded(..));
        (loading, table.open_popover(PopoverCell::new(row, 1), cx))
    });
    assert!(loading, "the short last page forgotten");
    assert!(again);
    sheet.draw();
    assert_eq!(sheet.popover(), Some(PopoverCell::new(row, 1)));
}

/// A part of the host's own text selected, then the popover opened: Cmd+C
/// has nothing of the popover's to copy, so it goes on to the host, which
/// copies its own.
#[gpui_kit::test]
fn a_selection_in_the_host_s_text_isn_t_the_popover_s(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open_with(cx, WIDTH, false, true);
    let (_, height) = sheet.window_size();
    let line = height - 10.0;
    let (from, to) = (point(px(2.0), px(line)), point(px(120.0), px(line)));
    sheet
        .cx
        .simulate_mouse_down(from, MouseButton::Left, Modifiers::default());
    sheet
        .cx
        .simulate_mouse_move(to, Some(MouseButton::Left), Modifiers::default());
    sheet
        .cx
        .simulate_mouse_up(to, MouseButton::Left, Modifiers::default());
    sheet.draw();
    let selected = sheet
        .cx
        .update(gpui_kit::base::TextSelection::selected_text);
    assert!(
        !selected.is_empty() && HOST_TEXT.contains(&selected),
        "{selected:?}"
    );
    let focus = sheet.read(|table| table.focus_handle.clone());
    sheet.cx.update(|window, cx| window.focus(&focus, cx));
    assert!(sheet.open_on(1, 2));
    sheet.heard();
    sheet.key("cmd-c");
    assert_eq!(
        sheet.cx.read_from_clipboard(),
        None,
        "the popover copied nothing"
    );
    #[cfg(not(feature = "copy"))]
    assert_eq!(sheet.heard(), ["copy"]);
}

// The three settings.

/// [`columns`] and the settings' five: `n` (an integer), `at` (a
/// timestamp), `grow` (a text, short until the source's version moves),
/// `fill` (a long text, with `custom-cells` over a fill), and `mid` (a text
/// cut at its kind's 200 px, or `mid` wide).
fn kinds_columns(mid: Option<f32>) -> Vec<TallTableColumn> {
    let mut all = columns(false);
    all.push(TallTableColumn::new(
        "n",
        ColumnKind::Integer { max_chars: 6 },
    ));
    all.push(TallTableColumn::new("at", ColumnKind::Timestamp));
    all.push(TallTableColumn::new("grow", ColumnKind::Text));
    let fill = TallTableColumn::new("fill", ColumnKind::Text);
    #[cfg(feature = "custom-cells")]
    let fill = fill.fill(crate::Ramp::new(&[
        |theme: &gpui_kit::component::Theme| theme.background,
        |theme: &gpui_kit::component::Theme| theme.primary,
    ]));
    all.push(fill);
    let middling = TallTableColumn::new("mid", ColumnKind::Text);
    #[cfg(any(feature = "resize", feature = "density"))]
    let middling = match mid {
        Some(width) => middling.width(px(width)),
        None => middling,
    };
    #[cfg(not(any(feature = "resize", feature = "density")))]
    let _ = mid;
    all.push(middling);
    all
}

/// Wide enough for every one of [`kinds_columns`], `mid` at 300 px too.
const KINDS_WIDTH: f32 = 2000.0;

/// The settings' columns, by index.
const N: usize = 5;
const AT: usize = 6;
#[cfg(feature = "live")]
const GROW: usize = 7;
#[cfg(feature = "custom-cells")]
const FILL: usize = 8;
#[cfg(any(feature = "resize", feature = "density"))]
const MID: usize = 9;

/// The test text system's advance at the cells' 14 px: 0.6 em.
const ADVANCE: f32 = 8.4;

/// An asset source with the open mark's path alone.
struct Marks;

const OPEN_MARK: &str = "marks/open.svg";

impl gpui_kit::AssetSource for Marks {
    fn load(&self, path: &str) -> gpui_kit::Result<Option<std::borrow::Cow<'static, [u8]>>> {
        Ok((path == OPEN_MARK).then(|| std::borrow::Cow::Borrowed(&b"<svg/>"[..])))
    }

    fn list(&self, _: &str) -> gpui_kit::Result<Vec<gpui_kit::SharedString>> {
        Ok(Vec::new())
    }
}

impl Sheet<'_> {
    fn cut_text(&mut self) {
        self.update(|table, cx| {
            table.set_popover_button(Some(PopoverButton::label("Open row")), cx);
            table.set_popover_cells(crate::PopoverCells::CutText, cx);
        });
    }

    /// The pointer over the table's corner, on no cell.
    fn hover_none(&mut self) {
        self.hover(point(px(1.0), px(1.0)));
    }

    #[cfg(feature = "select")]
    fn activate(&mut self, row: u64, place: usize) {
        self.update(|table, cx| {
            table.set_selection(
                Some(crate::selection::TallTableSelection::Cells {
                    anchor: (row, place),
                    head: (row, place),
                }),
                cx,
            )
        });
    }

    /// Everything the last frame's text elements drew.
    fn all_drawn(&mut self) -> Vec<crate::cells_text::DrawnText> {
        self.read(|table| table.drawn_text.borrow().clone())
    }

    fn drawn(&mut self, row: u64, column: usize) -> crate::cells_text::DrawnText {
        self.all_drawn()
            .into_iter()
            .find(|cell| (cell.row, cell.column) == (row, column))
            .expect("drawn")
    }

    fn cue_box(&mut self, cell: PopoverCell) -> gpui_kit::Bounds<Pixels> {
        self.read(|table| {
            table
                .popover_state_cues()
                .into_iter()
                .find(|(at, _)| *at == cell)
                .map(|(_, bounds)| bounds)
                .expect("a cue on the cell")
        })
    }
}

/// The cells `CutText` leaves out: a number, a rounded float, a timestamp
/// cut at its end, a NULL, and a text that fits; and the two it takes: a
/// cut text and a fitting text with a line break. Row and place.
const LEFT_OUT: [(u64, usize); 5] = [(1, N), (1, 0), (1, AT), (2, 4), (1, 1)];
const TAKEN: [(u64, usize); 2] = [(1, 2), (1, 3)];

#[gpui_kit::test]
fn cut_text_cues_a_cut_text_alone(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open_kinds(cx);
    // As built, with a button: every loaded cell.
    sheet.update(|table, cx| table.set_popover_button(Some(PopoverButton::label("Open")), cx));
    for (row, place) in LEFT_OUT.into_iter().chain(TAKEN) {
        let at = sheet.at(row as f32, place);
        sheet.hover(at);
        assert_eq!(sheet.cues(), [PopoverCell::new(row, place)]);
    }
    sheet.cut_text();
    assert_eq!(
        sheet.read(|table| table.popover_cells()),
        crate::PopoverCells::CutText
    );
    for (row, place) in LEFT_OUT {
        let at = sheet.at(row as f32, place);
        sheet.hover(at);
        assert_eq!(sheet.cues(), [], "({row}, {place})");
    }
    for (row, place) in TAKEN {
        let at = sheet.at(row as f32, place);
        sheet.hover(at);
        assert_eq!(sheet.cues(), [PopoverCell::new(row, place)]);
    }
    // With no button the same: a button changes no cue.
    sheet.update(|table, cx| table.set_popover_button(None, cx));
    assert_eq!(sheet.cues(), [PopoverCell::new(1, 3)]);
    let at = sheet.at(1.0, 0);
    sheet.hover(at);
    assert_eq!(sheet.cues(), [], "the rounded float, cued as built");
    // `open_popover` opens a number's cell all the same, which draws no
    // cue.
    assert!(sheet.open_on(1, N));
    let at = sheet.at(1.0, N);
    sheet.hover(at);
    assert_eq!(sheet.popover(), Some(PopoverCell::new(1, N)));
    assert_eq!(sheet.cues(), []);
    // Back to every cell.
    sheet.update(|table, cx| table.set_popover_cells(crate::PopoverCells::Every, cx));
    assert_eq!(
        sheet.popover(),
        Some(PopoverCell::new(1, N)),
        "the setting closes none"
    );
    let at = sheet.at(1.0, 0);
    sheet.hover(at);
    assert_eq!(sheet.cues(), [PopoverCell::new(1, 0)]);
}

#[cfg(feature = "select")]
#[gpui_kit::test]
fn enter_under_cut_text_opens_a_cut_text_and_goes_on_elsewhere(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open_kinds(cx);
    sheet.cut_text();
    for (row, place) in LEFT_OUT {
        sheet.activate(row, place);
        assert_eq!(sheet.cues(), [], "the active ({row}, {place})");
        sheet.heard();
        sheet.key("enter");
        assert_eq!(sheet.popover(), None, "({row}, {place})");
        assert_eq!(sheet.heard(), ["enter"], "({row}, {place})");
    }
    for (row, place) in TAKEN {
        let cell = PopoverCell::new(row, place);
        sheet.activate(row, place);
        assert_eq!(sheet.cues(), [cell]);
        sheet.popover_events();
        sheet.key("enter");
        assert_eq!(sheet.popover(), Some(cell));
        // On the open one: its button.
        sheet.key("enter");
        assert_eq!(
            sheet.popover_events(),
            [
                ("popover", Some(cell)),
                ("button", Some(cell)),
                ("popover", None)
            ]
        );
        assert_eq!(sheet.heard(), Vec::<&str>::new());
    }
    // Under `Every` again, a number's cell opens.
    sheet.update(|table, cx| table.set_popover_cells(crate::PopoverCells::Every, cx));
    sheet.activate(1, N);
    sheet.key("enter");
    assert_eq!(sheet.popover(), Some(PopoverCell::new(1, N)));
}

/// Enter right after a new text size, with no frame asked for between:
/// GPUI draws a dirty window before it dispatches a key, so the rule is
/// decided by the new size's glyphs and layout, not by none.
#[cfg(all(feature = "select", feature = "density"))]
#[gpui_kit::test]
fn enter_under_cut_text_right_after_a_new_text_size(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open_kinds(cx);
    sheet.cut_text();
    sheet.activate(1, 2);
    // No frame between the setter and the key.
    sheet.table.update(sheet.cx, |table, cx| {
        table.set_density(crate::Density::new(px(24.), px(12.)), cx);
    });
    sheet.cx.simulate_keystrokes("enter");
    sheet.draw();
    assert_eq!(sheet.popover(), Some(PopoverCell::new(1, 2)));
    assert_eq!(sheet.heard(), Vec::<&str>::new());
    // And a text that fits at the new size still goes on.
    sheet.key("escape");
    sheet.activate(1, 1);
    sheet.table.update(sheet.cx, |table, cx| {
        table.set_density(crate::Density::new(px(30.), px(14.)), cx);
    });
    sheet.cx.simulate_keystrokes("enter");
    sheet.draw();
    assert_eq!(sheet.popover(), None);
    assert_eq!(sheet.heard(), ["enter"]);
}

/// A long text is proven cut from its start alone: the rule counts one
/// more text taken from its start, and shapes no whole value; with the
/// bound off it gives the same answer the long way.
#[gpui_kit::test]
fn cut_text_decides_a_long_text_from_its_start(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open_kinds(cx);
    sheet.cut_text();
    let table = sheet.table.clone();
    let decide = |sheet: &mut Sheet, place: usize| {
        sheet.cx.update(|window, cx| {
            table.update(cx, |table, cx| {
                let before = table.bounded.get();
                let cut = table.is_cut_text(1, place, window, cx);
                (cut, table.bounded.get() - before)
            })
        })
    };
    assert_eq!(
        decide(&mut sheet, 2),
        (true, 1),
        "the long text, by its start"
    );
    assert_eq!(decide(&mut sheet, 1), (false, 0), "a short one, shaped");
    sheet.update(|table, _| table.unbounded_text = true);
    assert_eq!(decide(&mut sheet, 2), (true, 0), "the long way");
}

/// A `custom-cells` cell follows the rule on its text: its fill doesn't
/// count.
#[cfg(feature = "custom-cells")]
#[gpui_kit::test]
fn cut_text_reads_a_painted_cell_s_text(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open_kinds(cx);
    sheet.cut_text();
    let at = sheet.at(1.0, FILL);
    sheet.hover(at);
    assert_eq!(sheet.cues(), [PopoverCell::new(1, FILL)]);
}

/// The decision is made again at a new width: a text cut at 200 px and
/// whole at 300.
#[cfg(any(feature = "resize", feature = "density"))]
#[gpui_kit::test]
fn cut_text_decides_again_at_a_new_width(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open_kinds(cx);
    sheet.cut_text();
    let at = sheet.at(1.0, MID);
    sheet.hover(at);
    assert_eq!(sheet.cues(), [PopoverCell::new(1, MID)]);
    sheet.update(|table, cx| table.set_columns(kinds_columns(Some(300.0)), cx));
    sheet.cut_text();
    let at = sheet.at(1.0, MID);
    sheet.hover_none();
    sheet.hover(at);
    assert_eq!(sheet.cues(), [], "whole at 300 px");
    #[cfg(feature = "select")]
    {
        sheet.activate(1, MID);
        sheet.heard();
        sheet.key("enter");
        assert_eq!(sheet.popover(), None);
        assert_eq!(sheet.heard(), ["enter"]);
    }
}

/// And at a new scale factor (a browser zoom, another monitor): the rule
/// reads the cell's box snapped to device pixels, so a text within a
/// fraction of a pixel of its box is cut at one scale and whole at
/// another. `MIDDLING` (252 px) in a 267.4 px column: its box is 251.5 px
/// at the test window's scale of 2 and 252.3 px at 1.3. On the open
/// popover's cell, whose cue outlives the hover a new viewport forgets.
#[cfg(any(feature = "resize", feature = "density"))]
#[gpui_kit::test]
fn cut_text_decides_again_at_a_new_scale_factor(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open_kinds(cx);
    sheet.update(|table, cx| {
        table.set_columns(kinds_columns(Some(267.4)), cx);
        table.popover_state.assets = Some(std::sync::Arc::new(Marks));
        table.set_popover_cue(Some(PopoverCue::expand().open_icon(OPEN_MARK)), cx);
    });
    sheet.cut_text();
    sheet.hover_none();
    let boxed = |sheet: &mut Sheet<'_>| {
        let table = sheet.table.clone();
        sheet.cx.update(|window, cx| {
            let table = table.read(cx);
            f32::from(crate::cells_text::content_width(
                table.columns[MID].width,
                crate::state::cell_pad(table.sizes()),
                window,
            ))
        })
    };
    let text = MIDDLING.len() as f32 * ADVANCE;
    let cell = PopoverCell::new(1, MID);
    assert!(boxed(&mut sheet) < text - 0.25, "cut at a scale of 2");
    assert!(sheet.open_on(1, MID));
    assert_eq!(sheet.cues(), [cell]);
    // No layout, no page, no setter: the window's scale alone.
    sheet.cx.update(|window, _| window.set_scale_factor(1.3));
    sheet.draw();
    assert!(boxed(&mut sheet) > text + 0.25, "whole at 1.3");
    assert_eq!(sheet.popover(), Some(cell), "still open");
    assert_eq!(sheet.cues(), [], "whole at the new scale");
    sheet.cx.update(|window, _| window.set_scale_factor(2.0));
    sheet.draw();
    assert_eq!(sheet.cues(), [cell], "and cut again");
}

/// The open mark's path is tested once, at the setter: a source that
/// answers a first load with an error while it fetches (gpui-kit's default
/// on the web) leaves the cue with no open mark, said by the setter's
/// `false`, until the host sets the cue again.
#[gpui_kit::test]
fn the_open_mark_s_path_is_loaded_at_the_setter_alone(cx: &mut TestAppContext) {
    /// Its first load fails; every later one answers.
    struct Late(std::sync::atomic::AtomicBool);
    impl gpui_kit::AssetSource for Late {
        fn load(&self, _: &str) -> gpui_kit::Result<Option<std::borrow::Cow<'static, [u8]>>> {
            if self.0.swap(true, std::sync::atomic::Ordering::Relaxed) {
                Ok(Some(std::borrow::Cow::Borrowed(&b"<svg/>"[..])))
            } else {
                Err(std::io::Error::other("loading").into())
            }
        }

        fn list(&self, _: &str) -> gpui_kit::Result<Vec<gpui_kit::SharedString>> {
            Ok(Vec::new())
        }
    }
    let mut sheet = Sheet::open_kinds(cx);
    sheet.hover_none();
    let cue = || Some(PopoverCue::expand().open_icon(OPEN_MARK));
    let loaded = sheet.update(|table, cx| {
        table.popover_state.assets = Some(std::sync::Arc::new(Late(false.into())));
        table.set_popover_cue(cue(), cx)
    });
    assert!(!loaded, "the first load fails");
    // The source has it now, and no frame asks again.
    assert!(sheet.open_on(1, 2));
    assert_eq!(sheet.cues(), [], "no open mark");
    sheet.update(|table, cx| table.close_popover(cx));
    assert!(sheet.update(|table, cx| table.set_popover_cue(cue(), cx)));
    assert!(sheet.open_on(1, 2));
    assert_eq!(sheet.cues(), [PopoverCell::new(1, 2)]);
}

/// And after a page landing on its row: a text that grew past its column.
#[cfg(feature = "live")]
#[gpui_kit::test]
fn cut_text_decides_again_when_a_page_lands(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open_kinds(cx);
    sheet.cut_text();
    let at = sheet.at(1.0, GROW);
    sheet.hover(at);
    assert_eq!(sheet.cues(), [], "short");
    sheet.source.version.set(1);
    sheet.update(|table, cx| {
        table.invalidate_rows(1..2, cx);
    });
    assert_eq!(sheet.cues(), [PopoverCell::new(1, GROW)], "grown");
}

/// At rest a cue that fades draws every cell as one that doesn't.
#[gpui_kit::test]
fn a_fading_cue_changes_nothing_at_rest(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open_kinds(cx);
    sheet.hover_none();
    let plain = sheet.all_drawn();
    assert!(plain.iter().any(|cell| cell.text.ends_with('…')));
    sheet.update(|table, cx| table.set_popover_cue(Some(PopoverCue::expand().fade()), cx));
    assert_eq!(sheet.all_drawn(), plain);
}

/// The fade's checks on a drawn cell: no "…", from the cell's content
/// box's left, each glyph an advance on, whole up to `start` px short of
/// `right`, falling to nothing by `clear` px short of it.
fn assert_faded(drawn: &crate::cells_text::DrawnText, right: f32, start: f32, clear: f32) {
    assert!(!drawn.text.contains('…'), "{:?}", drawn.text);
    assert_eq!(drawn.glyphs.len(), drawn.text.chars().count());
    let advance = drawn.glyphs[1].0 - drawn.glyphs[0].0;
    let mut before = 1.0_f32;
    for (x, alpha) in &drawn.glyphs {
        let middle = x + advance / 2.0;
        if middle <= right - start {
            assert_eq!(*alpha, 1.0, "whole at {middle}");
        } else {
            assert!(
                *alpha < before,
                "falling at {middle}: {alpha} after {before}"
            );
        }
        assert!(
            *alpha > 0.0 && middle < right - clear,
            "painted at {middle}"
        );
        let expected = ((right - clear - middle) / (start - clear)).min(1.0);
        assert!((alpha - expected).abs() < 1e-3, "{alpha} at {middle}");
        before = *alpha;
    }
    // The next glyph would have been past the clear point.
    let (last, _) = drawn.glyphs.last().unwrap();
    assert!(
        last + advance * 1.5 >= right - clear,
        "it stops at the clear point"
    );
    assert!(before < 0.5, "its last glyph nearly clear: {before}");
}

#[gpui_kit::test]
fn the_cued_cut_text_fades_to_the_mark_and_moves_nothing(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open_kinds(cx);
    sheet.update(|table, cx| table.set_popover_cue(Some(PopoverCue::expand().fade()), cx));
    sheet.hover_none();
    let rest = sheet.all_drawn();
    let at = sheet.at(1.0, 2);
    sheet.hover(at);
    let cell = PopoverCell::new(1, 2);
    let drawn = sheet.drawn(1, 2);
    let at_rest = rest
        .iter()
        .find(|cell| (cell.row, cell.column) == (1, 2))
        .unwrap();
    assert!(at_rest.text.ends_with('…'));
    // Its first glyph where it is at rest, and every glyph it shares.
    assert_eq!(drawn.x, at_rest.x);
    let shared = at_rest.glyphs.len() - 1;
    for (faded, rest) in drawn.glyphs.iter().zip(&at_rest.glyphs[..shared]) {
        assert_eq!(faded.0, rest.0, "no glyph moved");
    }
    assert!(at_rest.text.starts_with(&drawn.text) || drawn.text.starts_with(&at_rest.text[..8]));
    // The content box: the cell less 8 px a side.
    let right = f32::from(drawn.cell.right()) - 8.0;
    assert_faded(&drawn, right, 64.0, 16.0);
    // The mark in the cue's box, at the cell's far right.
    let press = sheet.cue_box(cell);
    let mark = drawn.mark.expect("the mark painted");
    assert_eq!(mark.center(), press.center());
    assert_eq!(press.right(), drawn.cell.right() - px(2.0));
    let (last, _) = drawn.glyphs.last().unwrap();
    assert!(
        last + ADVANCE / 2.0 < f32::from(mark.left()),
        "short of the mark"
    );
    // No other cell changed.
    for (now, rest) in sheet.all_drawn().iter().zip(&rest) {
        if (now.row, now.column) != (1, 2) {
            assert_eq!(now, rest);
        }
    }
    let probe = sheet.read(|table| table.cue_probe()).expect("a cue");
    assert!(probe.faded && !probe.open);
    // The active cell's the same, the pointer still on the other.
    #[cfg(feature = "select")]
    {
        sheet.activate(3, 2);
        assert_eq!(sheet.cues(), [cell, PopoverCell::new(3, 2)]);
        let active = sheet.drawn(3, 2);
        assert_faded(&active, right, 64.0, 16.0);
        assert_eq!(active.glyphs, sheet.drawn(1, 2).glyphs);
    }
}

/// A text ending before the fade starts is drawn as at rest; a number
/// keeps the cue as built, cut short of it.
#[gpui_kit::test]
fn a_short_text_and_a_number_are_left_alone_by_the_fade(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open_kinds(cx);
    let button = Some(PopoverButton::label("Open"));
    sheet.update(|table, cx| table.set_popover_button(button, cx));
    // As built, for the number.
    let at = sheet.at(1.0, 0);
    sheet.hover(at);
    let built = sheet.drawn(1, 0);
    sheet.update(|table, cx| table.set_popover_cue(Some(PopoverCue::expand().fade()), cx));
    assert_eq!(sheet.drawn(1, 0), built, "the float, as built");
    let probe = sheet.read(|table| table.cue_probe()).expect("a cue");
    assert!(!probe.faded);
    // The short text: its glyphs whole, where they were.
    sheet.hover_none();
    let rest = sheet.drawn(1, 1);
    let at = sheet.at(1.0, 1);
    sheet.hover(at);
    let cued = sheet.drawn(1, 1);
    assert!(cued.mark.is_some());
    assert_eq!(
        (&cued.text, cued.x, &cued.glyphs),
        (&rest.text, rest.x, &rest.glyphs)
    );
    assert!(cued.glyphs.iter().all(|(_, alpha)| *alpha == 1.0));
}

/// A cell cut by the view's right edge fades toward its visible end, short
/// of the mark there; one too narrow for a cue isn't faded.
#[gpui_kit::test]
fn the_fade_runs_to_the_visible_end_and_needs_a_cue(cx: &mut TestAppContext) {
    // `long` runs 320..520, the view 400 wide.
    let mut sheet = Sheet::open(cx, 400.0);
    sheet.update(|table, cx| table.set_popover_cue(Some(PopoverCue::expand().fade()), cx));
    let (origin, gutter) = sheet.read(|table| (table.body.origin, table.gutter_width()));
    let at = origin + point(px(gutter + 360.0), row_height() * 1.5);
    sheet.hover(at);
    let drawn = sheet.drawn(1, 2);
    let press = sheet.cue_box(PopoverCell::new(1, 2));
    let mark = drawn.mark.expect("the mark painted");
    assert_eq!(mark.center(), press.center());
    let view_right = f32::from(origin.x) + gutter + 400.0;
    assert!(f32::from(press.right()) <= view_right);
    // The content box's visible end: the view's edge less the padding.
    assert_faded(&drawn, view_right - 8.0, 64.0, 16.0);
    // 20 px of it in view: no cue, so the "…" it has at rest.
    let mut sheet = Sheet::open(cx, 340.0);
    sheet.update(|table, cx| table.set_popover_cue(Some(PopoverCue::expand().fade()), cx));
    sheet.hover_none();
    let rest = sheet.drawn(1, 2);
    let (origin, gutter) = sheet.read(|table| (table.body.origin, table.gutter_width()));
    sheet.hover(origin + point(px(gutter + 330.0), row_height() * 1.5));
    assert_eq!(sheet.cues(), []);
    assert_eq!(sheet.drawn(1, 2), rest);
}

/// The fade's lengths follow the text size, and it's never clear later
/// than the mark's room: rows much taller than their text.
#[cfg(feature = "density")]
#[gpui_kit::test]
fn the_fade_is_scaled_with_the_text(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open_kinds(cx);
    sheet.update(|table, cx| table.set_popover_cue(Some(PopoverCue::expand().fade()), cx));
    let at = |sheet: &mut Sheet, row_h: f32| {
        sheet.update(|table, cx| {
            table.set_density(crate::Density::new(px(row_h), px(7.)), cx);
        });
        let (left, width, pad, origin) = sheet.read(|table| {
            let column = &table.columns[2];
            (
                f32::from(table.body.origin.x) + table.gutter_width() + column.x,
                column.width,
                table.sizes().padding() / 2.0,
                table.body.origin,
            )
        });
        sheet.hover_none();
        sheet.hover(point(px(left + width / 2.0), origin.y + px(row_h * 1.5)));
        assert_eq!(sheet.cues(), [PopoverCell::new(1, 2)]);
        (sheet.drawn(1, 2), left + width - pad, pad)
    };
    // Half the default's lengths at half its text size.
    let (drawn, right, _) = at(&mut sheet, 14.0);
    assert_faded(&drawn, right, 32.0, 8.0);
    // 30 px rows: the cue's room, past the padding, is more than 8 px, and
    // the text is clear by it.
    let (drawn, right, pad) = at(&mut sheet, 30.0);
    let room = 2.0 + (26.0 + 14.0) / 2.0 + 2.0 - pad;
    assert!(room > 8.0);
    assert_faded(&drawn, right, room + 24.0, room);
    let mark = drawn.mark.expect("the mark painted");
    let (last, _) = drawn.glyphs.last().unwrap();
    assert!(last + 4.2 / 2.0 < f32::from(mark.left()));
}

/// `find`'s tints on a faded cell are its drawn line's: none past the
/// clear point, and the probe's ranges the same.
#[cfg(feature = "find")]
#[gpui_kit::test]
fn a_faded_cell_s_tints_are_its_drawn_line_s(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open_kinds(cx);
    sheet.update(|table, cx| {
        table.set_popover_cue(Some(PopoverCue::expand().fade()), cx);
        table.set_find(Some("o".into()), cx);
        table.probe_cells = true;
    });
    let at = sheet.at(1.0, 2);
    sheet.hover(at);
    sheet.events.borrow_mut().clear();
    sheet.draw();
    let drawn = sheet.drawn(1, 2);
    let ranges: Vec<Range<usize>> = drawn
        .text
        .match_indices('o')
        .map(|(at, _)| at..at + 1)
        .collect();
    assert!(ranges.len() >= 3, "{:?}", drawn.text);
    assert_eq!(drawn.tints.len(), ranges.len());
    let clear = f32::from(drawn.cell.right()) - 8.0 - 16.0;
    for ((tint, _), range) in drawn.tints.iter().zip(&ranges) {
        assert_eq!(
            f32::from(tint.left()),
            drawn.x + range.start as f32 * ADVANCE
        );
        assert!(f32::from(tint.right()) <= clear + 0.01, "{tint:?}");
    }
    // At rest the same cell's line ends in "…", and holds as many or more.
    let probed = sheet
        .events
        .borrow()
        .iter()
        .rev()
        .find_map(|event| match event {
            TallTableEvent::Cells(cells) => cells
                .iter()
                .find(|cell| (cell.row, cell.column) == (1, 2))
                .cloned(),
            _ => None,
        })
        .expect("probed");
    assert_eq!(probed.found, Some(crate::FoundProbe::Ranges(ranges)));
}

/// The open mark: the host's second path, in `foreground`, on the open
/// popover's cell, which keeps its cue with the pointer elsewhere and no
/// active cell; its press closes the popover.
#[gpui_kit::test]
fn the_open_mark_stays_on_the_open_popover_s_cell(cx: &mut TestAppContext) {
    use gpui_kit::component::ActiveTheme as _;
    let mut sheet = Sheet::open_kinds(cx);
    let (foreground, muted) = sheet
        .cx
        .update(|_, cx| (cx.theme().foreground, cx.theme().muted_foreground));
    sheet.hover_none();
    let cell = PopoverCell::new(1, 2);
    // Without one, as built: no cue on the open cell the pointer left.
    assert!(sheet.open_on(1, 2));
    assert_eq!(sheet.cues(), []);
    sheet.update(|table, cx| table.close_popover(cx));
    // A path that doesn't load is none, and the setter says so.
    let loaded = sheet.update(|table, cx| {
        table.popover_state.assets = Some(std::sync::Arc::new(Marks));
        table.set_popover_cue(Some(PopoverCue::expand().open_icon("marks/none.svg")), cx)
    });
    assert!(!loaded);
    assert!(sheet.open_on(1, 2));
    assert_eq!(sheet.cues(), []);
    let at = sheet.at(1.0, 2);
    sheet.hover(at);
    assert_eq!(sheet.drawn(1, 2).mark_look, Some((None, muted)));
    sheet.hover_none();
    sheet.update(|table, cx| table.close_popover(cx));
    // With one.
    let loaded = sheet.update(|table, cx| {
        table.set_popover_cue(Some(PopoverCue::expand().open_icon(OPEN_MARK)), cx)
    });
    assert!(loaded);
    let at = sheet.at(1.0, 2);
    sheet.hover(at);
    assert_eq!(sheet.drawn(1, 2).mark_look, Some((None, muted)), "closed");
    sheet.hover_none();
    assert!(sheet.open_on(1, 2));
    assert_eq!(sheet.cues(), [cell]);
    assert_eq!(
        sheet.drawn(1, 2).mark_look,
        Some((Some(OPEN_MARK.into()), foreground))
    );
    let probe = sheet.read(|table| table.cue_probe()).expect("a cue");
    assert!(probe.open && probe.cell == cell);
    // Another cell hovered (above: the popover covers the rows below):
    // its cue the closed mark, the open cell's kept.
    let at = sheet.at(0.0, 2);
    sheet.hover(at);
    assert_eq!(sheet.cues(), [PopoverCell::new(0, 2), cell]);
    assert_eq!(sheet.drawn(0, 2).mark_look, Some((None, muted)));
    sheet.hover_none();
    // Its press closes it.
    let cue = sheet.cue_center(cell);
    sheet.popover_events();
    sheet.press(cue);
    assert_eq!(sheet.popover(), None);
    assert_eq!(sheet.popover_events(), [("popover", None)]);
    sheet.hover_none();
    assert_eq!(sheet.cues(), []);
    // A cell the rule in effect gives no cue has none, opened by the host:
    // a short text with no button, and under `CutText` a number.
    assert!(sheet.open_on(1, 1));
    assert_eq!(sheet.cues(), []);
    sheet.cut_text();
    assert!(sheet.open_on(1, N));
    assert_eq!(sheet.cues(), []);
    // Nothing on a host's own cue, and no path of it is loaded: one that
    // wouldn't load fails nothing.
    for path in [OPEN_MARK, "marks/none.svg"] {
        let loaded = sheet.update(|table, cx| {
            table.set_popover_cells(crate::PopoverCells::Every, cx);
            let custom = PopoverCue::custom(|_, _| div().size_full().into_any_element());
            table.set_popover_cue(Some(custom.open_icon(path)), cx)
        });
        assert!(loaded, "{path}");
    }
    assert!(sheet.open_on(1, 2));
    assert_eq!(sheet.cues(), []);
}

/// A filled button is the popover's whole inner width, at its foot, the
/// label's and a host's element; pressed as any.
#[gpui_kit::test]
fn a_filled_button_is_the_popover_s_width(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open_kinds(cx);
    let filled = |sheet: &mut Sheet| {
        let probe = sheet.probe().expect("placed");
        let [x, y, width, height] = probe.button.expect("drawn");
        assert_eq!((x, width), (probe.bounds[0], probe.bounds[2]), "{probe:?}");
        assert!((y + height - (probe.bounds[1] + probe.bounds[3])).abs() < 0.01);
        [x, y, width, height]
    };
    // As built: its own size, inside the foot's padding.
    sheet.update(|table, cx| table.set_popover_button(Some(PopoverButton::label("Open row")), cx));
    assert!(sheet.open_on(1, 2));
    let probe = sheet.probe().unwrap();
    let built = probe.button.unwrap();
    assert!(built[0] > probe.bounds[0] && built[2] < probe.bounds[2] / 2.0);
    sheet.update(|table, cx| {
        table.set_popover_button(Some(PopoverButton::label("Open row").fill()), cx)
    });
    let [x, y, width, height] = filled(&mut sheet);
    sheet.popover_events();
    sheet.press(point(px(x + width - 4.0), px(y + height / 2.0)));
    assert_eq!(
        sheet.popover_events(),
        [("button", Some(PopoverCell::new(1, 2))), ("popover", None)]
    );
    // A host's element, in a block that wide.
    sheet.update(|table, cx| {
        table.set_popover_button(
            Some(
                PopoverButton::custom(|_, _| div().h(px(24.)).child("Mine").into_any_element())
                    .fill(),
            ),
            cx,
        )
    });
    assert!(sheet.open_on(2, 2));
    let [_, _, _, height] = filled(&mut sheet);
    assert_eq!(height, 24.0);
}

/// `select_in_view` closes a popover the active cell left, as a key's
/// move does, and keeps one on the cell it selects.
#[cfg(feature = "select")]
#[gpui_kit::test]
fn select_in_view_closes_it_off_its_cell(cx: &mut TestAppContext) {
    use crate::selection::TallTableSelection;
    let mut sheet = Sheet::open(cx, WIDTH);
    let cell = |row, column| TallTableSelection::Cells {
        anchor: (row, column),
        head: (row, column),
    };
    assert!(sheet.open_on(2, 3));
    sheet.update(|table, cx| table.select_in_view(Some(cell(2, 3)), cx));
    assert_eq!(
        sheet.popover(),
        Some(PopoverCell::new(2, 3)),
        "its own cell"
    );
    sheet.update(|table, cx| table.select_in_view(Some(cell(3, 3)), cx));
    assert_eq!(sheet.popover(), None, "the row after");
    assert!(sheet.open_on(3, 3));
    sheet.update(|table, cx| table.select_in_view(Some(cell(3, 1)), cx));
    assert_eq!(sheet.popover(), None, "another column");
}
