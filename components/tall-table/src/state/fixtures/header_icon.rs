//! `header-icon`: no fixture (no DOM contender level), so only the
//! window's checks, driven through the element and the pointer in a window
//! of GPUI's test app, over rows answered from memory: the badge at a
//! header's left whatever the alignment, and none for a column without one
//! or whose path doesn't load; the name's room, in the estimate and the
//! fit; the least width, and a column too narrow; a short row; the arrow
//! dropped first; the raised look, on the hovered and the pressed icon
//! only; the press and its event, by index, with the badge's bounds (cut
//! at a region's edge); what the press leaves alone (`select`, `reorder`,
//! `clicks`), and the context presses that stay its header's; the setter,
//! and what forgets a held press. Every press is made where the icon is
//! drawn, so its target is checked with it.

use std::borrow::Cow;
use std::cell::{Cell as Counter, RefCell};
use std::ops::Range;
use std::rc::Rc;
use std::sync::Arc;

use gpui_kit::component::Theme;
use gpui_kit::{
    App, AppContext as _, AssetSource, Bounds, Context, Entity, FocusHandle, Hsla,
    InteractiveElement as _, IntoElement, Modifiers, MouseButton, MouseDownEvent,
    ParentElement as _, Pixels, Point, Render, SharedString, Styled as _, TestAppContext,
    TextAlign, VisualTestContext, Window, div, point, px, size,
};

use super::super::header_icon::DrawnIcon;
use super::super::{TallTableEvent, TallTableState, row_height};
use crate::column::{ColumnKind, TallTableColumn};
use crate::delegate::{CellValue, PageLoad, TallTableDelegate, TallTablePage};
use crate::header_icon::{HeaderIcon, HeaderIconPress};
use crate::probe::TallTableLayout;
use crate::tall_table::TallTable;

/// Rows from memory, each value its row and a third.
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

/// Loads the three icons the tests name, and nothing else.
struct Icons;

impl AssetSource for Icons {
    fn load(&self, path: &str) -> gpui_kit::Result<Option<Cow<'static, [u8]>>> {
        Ok(["text.svg", "num.svg", "time.svg"]
            .contains(&path)
            .then_some(Cow::Borrowed(b"<svg/>".as_slice())))
    }

    fn list(&self, _: &str) -> gpui_kit::Result<Vec<SharedString>> {
        Ok(Vec::new())
    }
}

fn ink(theme: &Theme) -> Hsla {
    theme.foreground
}

fn tint(theme: &Theme) -> Hsla {
    theme.muted
}

fn icon(path: &'static str) -> HeaderIcon {
    HeaderIcon::new(path, ink)
}

/// A text column (200 px, left-aligned) with `text.svg`.
fn text(name: &'static str) -> TallTableColumn {
    TallTableColumn::new(name, ColumnKind::Text).icon(icon("text.svg"))
}

/// The host: the table in a `div` that counts the right presses that
/// reach it.
struct Shell {
    table: Entity<TallTableState<Memory>>,
    right_presses: Rc<Counter<usize>>,
    /// Somewhere else to put focus.
    elsewhere: FocusHandle,
}

impl Render for Shell {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        let right_presses = self.right_presses.clone();
        div()
            .id("host")
            .size_full()
            .on_mouse_down(MouseButton::Right, move |_, _, _| {
                right_presses.set(right_presses.get() + 1);
            })
            .child(TallTable::new(&self.table))
    }
}

/// A table whose cells area is `cells_width` wide, over 100 rows in a view
/// of 10, its icons loaded from [`Icons`].
struct Sheet<'a> {
    cx: &'a mut VisualTestContext,
    shell: Entity<Shell>,
    table: Entity<TallTableState<Memory>>,
    heard: Rc<RefCell<Vec<TallTableEvent>>>,
    layout: Rc<RefCell<Option<TallTableLayout>>>,
    _subscription: gpui_kit::Subscription,
}

impl<'a> Sheet<'a> {
    fn open(cx: &'a mut TestAppContext, columns: Vec<TallTableColumn>, cells_width: f32) -> Self {
        cx.update(|cx| {
            gpui_kit::component::init(cx);
            crate::init(cx);
        });
        let (shell, cx) = cx.add_window_view(move |_, cx| {
            let table = cx.new(|cx| {
                TallTableState::new(Memory { next: 0 }, Vec::new(), 100, Default::default(), cx)
                    .probe_frames(true)
            });
            Shell {
                table,
                right_presses: Rc::default(),
                elsewhere: cx.focus_handle(),
            }
        });
        let table = shell.read_with(cx, |shell, _| shell.table.clone());
        let heard: Rc<RefCell<Vec<TallTableEvent>>> = Rc::default();
        let layout: Rc<RefCell<Option<TallTableLayout>>> = Rc::default();
        let subscription = cx.update(|_, cx| {
            let (heard, layout) = (heard.clone(), layout.clone());
            cx.subscribe(&table, move |_, event: &TallTableEvent, _| match event {
                TallTableEvent::Layout(probe) => *layout.borrow_mut() = Some(probe.clone()),
                TallTableEvent::Probe(_)
                | TallTableEvent::Scrollbar { .. }
                | TallTableEvent::Filled { .. } => {}
                #[cfg(feature = "group-headers")]
                TallTableEvent::Groups(_) => {}
                event => heard.borrow_mut().push(event.clone()),
            })
        });
        // The test app's asset source loads nothing: the columns are set
        // once the table checks its paths against the tests' own.
        table.update(cx, |table, cx| {
            table.icon_state.assets = Some(Arc::new(Icons));
            table.set_columns(columns, cx);
        });
        let (gutter, bar) = table.read_with(cx, |table, _| {
            (
                table.gutter_width(),
                f32::from(gpui_kit::component::scroll::Scrollbar::width()),
            )
        });
        let row_h = f32::from(row_height());
        cx.simulate_resize(size(
            px(cells_width + gutter + bar + 2.0),
            px(10.0 * row_h + row_h + bar + 2.0),
        ));
        let mut sheet = Self {
            cx,
            shell,
            table,
            heard,
            layout,
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

    fn update<T>(
        &mut self,
        update: impl FnOnce(&mut TallTableState<Memory>, &mut Context<TallTableState<Memory>>) -> T,
    ) -> T {
        let result = self.table.update(self.cx, update);
        self.draw();
        result
    }

    /// Everything heard since the last call (but the probes).
    fn heard(&mut self) -> Vec<TallTableEvent> {
        std::mem::take(&mut *self.heard.borrow_mut())
    }

    /// The icons' presses heard since the last call (the rest dropped).
    fn presses(&mut self) -> Vec<HeaderIconPress> {
        self.heard()
            .into_iter()
            .filter_map(|event| match event {
                TallTableEvent::HeaderIconPressed(press) => Some(press),
                _ => None,
            })
            .collect()
    }

    #[cfg_attr(not(feature = "clicks"), expect(dead_code))]
    fn right_presses(&mut self) -> usize {
        self.shell
            .read_with(self.cx, |shell, _| shell.right_presses.get())
    }

    // --- where ---

    /// The icon drawn for the column of index `column`.
    fn drawn(&mut self, column: usize) -> Option<DrawnIcon> {
        self.read(|table| {
            table
                .icon_state
                .drawn
                .iter()
                .find(|icon| icon.column == column)
                .cloned()
        })
    }

    /// The middle of the target of column `column`'s icon.
    fn icon_at(&mut self, column: usize) -> Point<Pixels> {
        self.drawn(column).expect("an icon").target.center()
    }

    /// The cells area's left, and the names' row's top, in window pixels.
    fn origin(&mut self) -> Point<Pixels> {
        self.read(|table| table.body.origin + point(px(table.gutter_width()), -table.sizes().row()))
    }

    /// Where the frame painted the look of column `column`'s icon (its
    /// badge, or its raised box), in window pixels.
    fn painted(&mut self, column: usize) -> Bounds<Pixels> {
        let selector: &'static str =
            Box::leak(format!("tall-table-icon-look-{column}").into_boxed_str());
        self.cx.debug_bounds(selector).expect("a painted icon")
    }

    /// The left edge of the column at `place`, in window pixels.
    fn left(&mut self, place: usize) -> Pixels {
        let left = self.read(|table| {
            let column = &table.columns[place];
            table.place().left(place, column.x, table.scroll_x)
        });
        self.origin().x + px(left)
    }

    /// The badge at rest of the column at `place`, at the base's sizes.
    fn badge(&mut self, place: usize) -> Bounds<Pixels> {
        let origin = point(self.left(place) + px(8.), self.origin().y + px(7.));
        Bounds::new(origin, size(px(18.), px(16.)))
    }

    /// A point `x` px into the header of the column at `place`, in the
    /// names' row's middle.
    fn header(&mut self, place: usize, x: f32) -> Point<Pixels> {
        let row = self.read(|table| table.sizes().row());
        point(self.left(place) + px(x), self.origin().y + row / 2.0)
    }

    /// The middle of the cell at `row` in the column at `place`.
    fn cell(&mut self, row: f32, place: usize) -> Point<Pixels> {
        let row_h = self.read(|table| table.sizes().row());
        point(
            self.left(place) + px(100.),
            self.origin().y + row_h * (row + 1.5),
        )
    }

    // --- the pointer ---

    fn press_with(
        &mut self,
        at: Point<Pixels>,
        button: MouseButton,
        modifiers: Modifiers,
        click_count: usize,
    ) {
        self.cx.simulate_event(MouseDownEvent {
            position: at,
            modifiers,
            button,
            click_count,
            first_mouse: false,
        });
        self.draw();
    }

    fn press(&mut self, at: Point<Pixels>) {
        self.press_with(at, MouseButton::Left, Modifiers::default(), 1);
    }

    fn release(&mut self, at: Point<Pixels>) {
        self.cx
            .simulate_mouse_up(at, MouseButton::Left, Modifiers::default());
        self.draw();
    }

    fn click(&mut self, at: Point<Pixels>) {
        self.press(at);
        self.release(at);
    }

    fn hover(&mut self, at: Point<Pixels>) {
        self.cx.simulate_mouse_move(at, None, Modifiers::default());
        self.draw();
    }

    fn drag_to(&mut self, at: Point<Pixels>) {
        self.cx
            .simulate_mouse_move(at, MouseButton::Left, Modifiers::default());
        self.draw();
    }

    fn pressed(&mut self) -> Option<usize> {
        self.read(|table| table.icon_state.pressed)
    }
}

fn press_of(column: usize, bounds: Bounds<Pixels>) -> HeaderIconPress {
    HeaderIconPress {
        column,
        bounds,
        modifiers: Modifiers::default(),
    }
}

// --- drawn ---

#[gpui_kit::test]
fn a_badge_at_the_headers_left_whatever_the_alignment(cx: &mut TestAppContext) {
    let columns = vec![
        TallTableColumn::new("name", ColumnKind::Text).icon(icon("text.svg").fill(tint)),
        TallTableColumn::new("f", ColumnKind::Float).icon(icon("num.svg")),
        TallTableColumn::new("plain", ColumnKind::Text),
        TallTableColumn::new("missing", ColumnKind::Text).icon(icon("nope.svg")),
    ];
    let mut sheet = Sheet::open(cx, columns, 900.0);
    let (ink, tint) = sheet.cx.update(|_, cx| {
        use gpui_kit::component::ActiveTheme as _;
        (cx.theme().foreground, cx.theme().muted)
    });
    assert_eq!(
        sheet.read(|table| table.icon_state.drawn.len()),
        2,
        "none for a column without one, or whose path doesn't load"
    );
    let badge = sheet.badge(0);
    let name = sheet.drawn(0).expect("the text column's");
    assert_eq!(
        (name.look, name.fill, name.color, name.glyph, name.raised),
        (badge, Some(tint), ink, 10.0, false)
    );
    assert_eq!(name.path, SharedString::from("text.svg"));
    let badge = sheet.badge(1);
    let float = sheet.drawn(1).expect("the float column's");
    assert_eq!(
        (float.look, float.fill),
        (badge, None),
        "a right-aligned header's too"
    );
    // The names start after the badge and its gap, each aligned as it was.
    let names = sheet.read(|table| table.icon_state.header_names.clone());
    let after = Some(px(32.).into());
    assert_eq!(names[0], (0, after, None));
    assert_eq!(names[1], (1, after, Some(TextAlign::Right)));
    assert_ne!(names[2].1, after, "a column with no icon, as today");
    assert_eq!(names[3].1, names[2].1, "and one whose path doesn't load");
    assert_eq!(
        sheet.read(|table| (table.columns[2].width, table.columns[3].width)),
        (200.0, 200.0)
    );
    // The layout probe's box is the badge's.
    let layout = sheet.layout.borrow().clone().expect("a layout");
    let boxes: Vec<_> = layout.columns.iter().map(|column| column.icon).collect();
    assert_eq!(
        boxes,
        [Some((8.0, 18.0)), Some((8.0, 18.0)), None, None],
        "the probe's boxes"
    );
    // The reader gives back the icon as set, loaded or not.
    assert_eq!(
        sheet.read(|table| table.columns()[3].header_icon().cloned()),
        Some(icon("nope.svg"))
    );
    // No press where none is drawn.
    let at = sheet.header(3, 17.0);
    sheet.click(at);
    assert_eq!(sheet.presses(), []);
}

#[gpui_kit::test]
fn the_names_estimate_counts_the_icon(cx: &mut TestAppContext) {
    let name = "a long column name";
    let columns = vec![
        TallTableColumn::new(name, ColumnKind::Float),
        TallTableColumn::new(name, ColumnKind::Float).icon(icon("num.svg")),
        TallTableColumn::new(name, ColumnKind::Float).icon(icon("nope.svg")),
    ];
    let mut sheet = Sheet::open(cx, columns, 900.0);
    assert_eq!(
        sheet.read(|table| table
            .columns
            .iter()
            .map(|column| column.width)
            .collect::<Vec<_>>()),
        [159.0, 183.0, 159.0]
    );
}

/// A fit counts the badge and its gap, as the estimate does.
#[cfg(feature = "resize")]
#[gpui_kit::test]
fn a_fit_counts_the_icon(cx: &mut TestAppContext) {
    let name = "a long column name";
    let columns = vec![
        TallTableColumn::new(name, ColumnKind::Float),
        TallTableColumn::new(name, ColumnKind::Float).icon(icon("num.svg")),
    ];
    let mut sheet = Sheet::open(cx, columns, 900.0);
    for place in 0..2 {
        let width = sheet.read(|table| table.columns[place].width);
        let at = sheet.header(place, width - 0.5);
        sheet.press_with(at, MouseButton::Left, Modifiers::default(), 1);
        sheet.release(at);
        sheet.press_with(at, MouseButton::Left, Modifiers::default(), 2);
        sheet.release(at);
    }
    let (plain, with) = sheet.read(|table| (table.columns[0].width, table.columns[1].width));
    assert_ne!(plain, 159.0, "the control: fitted");
    assert_eq!(with, plain + 24.0);
}

/// The table's least width draws the icon, its target short of the band,
/// which is still the edge's; a column a host's `min_width` leaves
/// narrower than the padding and the badge draws none and takes no press.
#[cfg(feature = "resize")]
#[gpui_kit::test]
fn the_least_width_draws_it_and_a_narrower_column_none(cx: &mut TestAppContext) {
    let columns = vec![
        text("a").width(px(10.)),
        text("b").min_width(px(30.)).width(px(30.)),
        text("c"),
    ];
    let mut sheet = Sheet::open(cx, columns, 900.0);
    assert_eq!(
        sheet.read(|table| (table.columns[0].width, table.columns[1].width)),
        (40.0, 30.0)
    );
    let least = sheet.drawn(0).expect("drawn at the least width");
    let left = sheet.left(0);
    assert_eq!(
        (least.target.left(), least.target.size.width),
        (left + px(4.), px(26.))
    );
    assert_eq!(sheet.drawn(1), None);
    let at = sheet.icon_at(0);
    sheet.click(at);
    assert_eq!(
        sheet
            .presses()
            .into_iter()
            .map(|press| press.column)
            .collect::<Vec<_>>(),
        [0]
    );
    // Where the narrow column's would be.
    let at = sheet.header(1, 15.0);
    sheet.press(at);
    assert_eq!(sheet.pressed(), None);
    sheet.release(at);
    assert_eq!(sheet.presses(), []);
    // The band at the least column's edge.
    let at = sheet.header(0, 39.5);
    sheet.press(at);
    assert!(
        sheet.read(|table| table.resizing.is_some()),
        "the band's press"
    );
    assert_eq!(sheet.pressed(), None);
    sheet.release(at);
}

/// A density's row may be shorter than the text's scale gives the badge
/// and the raised look: both stay inside it.
#[cfg(feature = "density")]
#[gpui_kit::test]
fn a_short_row_holds_the_badge_and_the_raised_look(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, vec![text("a"), text("b")], 900.0);
    sheet.update(|table, cx| table.set_density(crate::Density::new(px(12.), px(11.)), cx));
    assert_eq!(sheet.read(|table| table.sizes().row()), px(12.));
    let top = sheet.origin().y;
    let inside = |look: Bounds<Pixels>| look.top() >= top && look.bottom() <= top + px(12.);
    let badge = sheet.drawn(0).expect("an icon");
    assert!(inside(badge.look), "{:?}", badge.look);
    assert!(badge.glyph <= f32::from(badge.look.size.height));
    let at = sheet.icon_at(0);
    sheet.hover(at);
    let raised = sheet.drawn(0).expect("an icon");
    assert!(raised.raised);
    assert!(inside(raised.look), "{:?}", raised.look);
    assert!(raised.glyph <= f32::from(raised.look.size.height));
    sheet.click(at);
    assert_eq!(sheet.presses().len(), 1);
}

/// A header too narrow for the icon, the name, and the arrow loses the
/// arrow first; each is still pressed where it's drawn.
#[cfg(all(feature = "sort", any(feature = "resize", feature = "density")))]
#[gpui_kit::test]
fn a_narrow_header_drops_the_arrow_before_the_icon(cx: &mut TestAppContext) {
    let columns = vec![
        TallTableColumn::new("a", ColumnKind::Text)
            .sortable(true)
            .width(px(50.)),
        text("b").sortable(true).width(px(50.)),
        text("c").sortable(true),
    ];
    let mut sheet = Sheet::open(cx, columns, 900.0);
    let arrows: Vec<usize> = sheet.read(|table| {
        table
            .sort_state
            .drawn
            .iter()
            .map(|arrow| arrow.column)
            .collect()
    });
    assert_eq!(arrows, [0, 2], "the control: an arrow fits at 50 alone");
    assert!(sheet.drawn(1).is_some(), "the icon stays");
    let at = sheet.icon_at(1);
    sheet.click(at);
    let at = sheet.icon_at(2);
    sheet.click(at);
    assert_eq!(
        sheet
            .presses()
            .into_iter()
            .map(|press| press.column)
            .collect::<Vec<_>>(),
        [1, 2]
    );
    // The wide column's arrow keeps its press.
    let at = sheet.read(|table| {
        table
            .sort_state
            .drawn
            .iter()
            .find(|arrow| arrow.column == 2)
            .expect("an arrow")
            .target
            .center()
    });
    sheet.press(at);
    assert_eq!(sheet.read(|table| table.sort_state.pressed), Some(2));
    assert_eq!(sheet.pressed(), None);
    sheet.release(at);
    assert_eq!(sheet.presses(), []);
}

// --- raised ---

#[gpui_kit::test]
fn the_raised_look_on_the_hovered_or_pressed_icon_only(cx: &mut TestAppContext) {
    let columns = vec![
        TallTableColumn::new("a", ColumnKind::Text).icon(icon("text.svg").fill(tint)),
        text("b"),
        text("c"),
    ];
    let mut sheet = Sheet::open(cx, columns, 900.0);
    let raised = |sheet: &mut Sheet<'_>| -> Vec<usize> {
        sheet.read(|table| {
            table
                .icon_state
                .drawn
                .iter()
                .filter(|icon| icon.raised)
                .map(|icon| icon.column)
                .collect()
        })
    };
    assert_eq!(raised(&mut sheet), [0usize; 0], "none at rest");
    let at = sheet.icon_at(0);
    sheet.hover(at);
    assert_eq!(raised(&mut sheet), [0]);
    let look = sheet.drawn(0).expect("an icon");
    let origin = point(sheet.left(0) + px(4.), sheet.origin().y + px(3.));
    assert_eq!(
        (look.look, look.fill, look.glyph),
        (Bounds::new(origin, size(px(26.), px(24.))), None, 12.0),
        "the backdrop in place of the badge and its fill"
    );
    assert_eq!(
        look.look.size.width, look.target.size.width,
        "its box the target's"
    );
    let away = sheet.cell(2.0, 1);
    sheet.hover(away);
    assert_eq!(raised(&mut sheet), [0usize; 0]);
    // `set_columns` under a resting pointer: still raised (GPUI tells
    // the element its hover only when it changes).
    sheet.hover(at);
    let columns = sheet.read(|table| table.columns().to_vec());
    sheet.update(|table, cx| table.set_columns(columns, cx));
    assert_eq!(raised(&mut sheet), [0], "across set_columns");
    sheet.hover(away);
    assert_eq!(raised(&mut sheet), [0usize; 0]);
    // Pressed, and held while the pointer leaves it.
    let at = sheet.icon_at(1);
    sheet.press(at);
    sheet.drag_to(away);
    assert_eq!(raised(&mut sheet), [1]);
    sheet.release(away);
    assert_eq!(raised(&mut sheet), [0usize; 0]);
    assert_eq!(sheet.presses(), [], "a release off it reports nothing");
}

#[gpui_kit::test]
fn a_press_on_the_raised_looks_ring_is_the_icons(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, vec![text("a"), text("b")], 900.0);
    // Left of the badge, which starts 8 px in; and right of it.
    for x in [5.0, 28.0] {
        let at = sheet.header(1, x);
        assert!(!sheet.badge(1).contains(&at));
        sheet.press(at);
        assert_eq!(sheet.pressed(), Some(1), "{x} px in");
        sheet.release(at);
    }
    assert_eq!(sheet.presses().len(), 2);
    // Past the ring, the header's.
    let at = sheet.header(1, 31.0);
    sheet.click(at);
    assert_eq!(sheet.presses(), []);
}

/// A resize drag that crosses an icon raises none, and the hover shows
/// again at its release.
#[cfg(feature = "resize")]
#[gpui_kit::test]
fn no_icon_is_raised_during_a_resize(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, vec![text("a"), text("b")], 900.0);
    let band = sheet.header(0, 199.5);
    sheet.press(band);
    assert!(
        sheet.read(|table| table.resizing.is_some()),
        "the control: resizing"
    );
    // Over column 0's own icon.
    let over = sheet.header(0, 17.0);
    sheet.drag_to(over);
    let drawn = sheet.read(|table| table.icon_state.drawn.clone());
    assert!(drawn.iter().all(|icon| !icon.raised), "none raised");
    sheet.release(over);
    sheet.hover(over);
    assert!(
        sheet.drawn(0).is_some_and(|icon| icon.raised),
        "raised again after the release"
    );
}

/// While a column is carried no icon is drawn raised, the lifted
/// column's dims with its name, and a press on an icon carries nothing.
#[cfg(feature = "reorder")]
#[gpui_kit::test]
fn no_icon_is_raised_while_a_column_is_carried(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, vec![text("a"), text("b"), text("c")], 900.0);
    // A press on an icon holds no header.
    let at = sheet.icon_at(0);
    sheet.press(at);
    let far = sheet.header(2, 100.0);
    sheet.drag_to(far);
    assert!(
        sheet.read(|table| table.moving.is_none()),
        "no drag under the icon's press"
    );
    sheet.release(far);
    sheet.heard();
    // With `select`, a move starts inside a selected `Columns` range.
    #[cfg(feature = "select")]
    sheet.update(|table, cx| {
        table.set_selection(
            Some(crate::selection::TallTableSelection::Columns {
                anchor: (0, 0),
                head: (0, 0),
            }),
            cx,
        )
    });
    let from = sheet.header(0, 100.0);
    sheet.press(from);
    sheet.drag_to(far);
    assert!(
        sheet.read(|table| table.is_moving()),
        "the control: carried"
    );
    let over = sheet.icon_at(1);
    sheet.drag_to(over);
    let drawn = sheet.read(|table| table.icon_state.drawn.clone());
    assert!(drawn.iter().all(|icon| !icon.raised), "none raised");
    assert_eq!(
        drawn.iter().map(|icon| icon.dimmed).collect::<Vec<_>>(),
        [true, false, false],
        "the lifted column's dims"
    );
    sheet.drag_to(far);
    sheet.release(far);
    assert_eq!(sheet.presses(), []);
}

// --- the press ---

#[gpui_kit::test]
fn a_release_on_the_pressed_icon_reports(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, vec![text("a"), text("b"), text("c")], 900.0);
    let badge = sheet.badge(1);
    assert_eq!(sheet.painted(1), badge, "the badge as painted");
    let at = sheet.icon_at(1);
    sheet.press(at);
    assert_eq!(sheet.presses(), [], "nothing at the press");
    let shift = Modifiers {
        shift: true,
        ..Modifiers::default()
    };
    sheet.cx.simulate_mouse_up(at, MouseButton::Left, shift);
    sheet.draw();
    assert_eq!(
        sheet.presses(),
        [HeaderIconPress {
            column: 1,
            bounds: badge,
            modifiers: shift,
        }],
        "the badge's bounds and the keys held at the release"
    );
    // A release on another icon reports neither.
    let other = sheet.icon_at(0);
    sheet.press(at);
    sheet.drag_to(other);
    sheet.release(other);
    assert_eq!(sheet.presses(), []);
    assert_eq!(sheet.pressed(), None);
    // A double press is two.
    sheet.click(at);
    sheet.press_with(at, MouseButton::Left, Modifiers::default(), 2);
    sheet.release(at);
    assert_eq!(sheet.presses(), [press_of(1, badge), press_of(1, badge)]);
}

/// The press focuses the table, as its other presses do.
#[gpui_kit::test]
fn a_press_focuses_the_table(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, vec![text("a")], 900.0);
    let elsewhere = sheet
        .shell
        .read_with(sheet.cx, |shell, _| shell.elsewhere.clone());
    sheet.cx.update(|window, cx| window.focus(&elsewhere, cx));
    let focused = |sheet: &mut Sheet<'_>| {
        let handle = sheet.read(|table| table.focus_handle.clone());
        sheet.cx.update(|window, _| handle.is_focused(window))
    };
    assert!(!focused(&mut sheet), "the control: elsewhere");
    let at = sheet.icon_at(0);
    sheet.press(at);
    assert!(focused(&mut sheet));
    sheet.release(at);
}

/// The event names its column by index, wherever it's drawn, and a move
/// between the press and the release leaves it on its column.
#[cfg(feature = "reorder")]
#[gpui_kit::test]
fn a_press_is_by_index_after_a_move(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, vec![text("a"), text("b"), text("c")], 900.0);
    sheet.update(|table, cx| table.set_order(vec![2, 1, 0], cx));
    sheet.heard();
    // Column 2, drawn first.
    let at = sheet.icon_at(2);
    assert!(sheet.badge(0).contains(&at));
    let badge = sheet.badge(0);
    sheet.click(at);
    assert_eq!(sheet.presses(), [press_of(2, badge)]);
    // Moved to the last place between the press and the release: the
    // press is held by index, so the release on its icon there reports.
    sheet.press(at);
    sheet.update(|table, cx| table.move_columns(0..1, 2, cx));
    assert_eq!(sheet.pressed(), Some(2), "held through the move");
    let at = sheet.icon_at(2);
    sheet.release(at);
    assert_eq!(sheet.read(|table| table.order().to_vec()), [1, 0, 2]);
    let badge = sheet.badge(2);
    assert_eq!(
        sheet.presses(),
        [press_of(2, badge)],
        "its column, where it is now"
    );
}

/// An icon cut at the scrolled columns' left edge is pressed on what
/// shows, and its bounds are its visible part.
#[gpui_kit::test]
fn a_cut_icon_reports_its_visible_part(cx: &mut TestAppContext) {
    let columns = ["a", "b", "c", "d", "e"].map(text).to_vec();
    let mut sheet = Sheet::open(cx, columns, 600.0);
    sheet.update(|table, cx| table.scroll_by(0.0, 15.0, cx));
    assert_eq!(sheet.read(|table| table.scroll_x), 15.0);
    let origin = sheet.origin();
    // The badge is 8..26 of its column: 11 px of it show.
    let at = origin + point(px(5.), px(15.));
    sheet.click(at);
    assert_eq!(
        sheet.presses(),
        [press_of(
            0,
            Bounds::new(origin + point(px(0.), px(7.)), size(px(11.), px(16.)))
        )]
    );
}

/// And at `pin`'s run: the first scrolled column's icon, cut at the edge.
#[cfg(feature = "pin")]
#[gpui_kit::test]
fn an_icon_cut_at_the_pinned_runs_edge(cx: &mut TestAppContext) {
    let columns = ["a", "b", "c", "d", "e"].map(text).to_vec();
    let mut sheet = Sheet::open(cx, columns, 600.0);
    sheet.update(|table, cx| {
        table.set_pinned(1, cx);
        table.scroll_by(0.0, 15.0, cx);
    });
    assert_eq!(sheet.read(|table| table.pinned_in_effect()), 1);
    let origin = sheet.origin();
    // The pinned column's, whole.
    let badge = sheet.badge(0);
    let at = sheet.icon_at(0);
    sheet.click(at);
    assert_eq!(sheet.presses(), [press_of(0, badge)]);
    // The first scrolled column's, right of the edge at 200.
    let at = origin + point(px(205.), px(15.));
    sheet.click(at);
    assert_eq!(
        sheet.presses(),
        [press_of(
            1,
            Bounds::new(origin + point(px(200.), px(7.)), size(px(11.), px(16.)))
        )]
    );
    // Its hidden part, under the run, isn't pressed.
    let at = origin + point(px(190.), px(15.));
    sheet.press(at);
    assert_eq!(sheet.pressed(), None);
    sheet.release(at);
    assert_eq!(sheet.presses(), []);
}

// --- what the press leaves alone ---

#[cfg(feature = "select")]
#[gpui_kit::test]
fn a_press_selects_nothing(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, vec![text("a"), text("b")], 900.0);
    let at = sheet.icon_at(1);
    sheet.click(at);
    assert_eq!(sheet.read(|table| table.selection()), None);
    assert!(
        matches!(
            sheet.heard().as_slice(),
            [TallTableEvent::HeaderIconPressed(_)]
        ),
        "the icon's event alone"
    );
    // The control: the header beside it selects its column.
    let at = sheet.header(1, 100.0);
    sheet.click(at);
    assert!(sheet.read(|table| table.selection()).is_some());
}

/// `clicks` neither reports nor counts the icon's left press; a right
/// press, a Ctrl+left press with the setting on, and a long press are its
/// header's context press, and the long press's lifted tap presses nothing.
#[cfg(feature = "clicks")]
#[gpui_kit::test]
fn the_context_presses_are_the_headers(cx: &mut TestAppContext) {
    use crate::click::{ClickKind, ClickTarget, TallTableClick};
    use gpui_kit::{LongPressEvent, TouchPhase};

    let mut sheet = Sheet::open(cx, vec![text("a"), text("b")], 900.0);
    let clicks = |sheet: &mut Sheet<'_>| -> Vec<(ClickKind, ClickTarget)> {
        sheet
            .heard()
            .into_iter()
            .filter_map(|event| match event {
                TallTableEvent::Clicked(TallTableClick { kind, target, .. }) => {
                    Some((kind, target))
                }
                _ => None,
            })
            .collect()
    };
    let at = sheet.icon_at(1);
    sheet.click(at);
    assert_eq!(clicks(&mut sheet), [], "not reported");
    // Not counted: a press gpui counts 2 after it is a first.
    let header = sheet.header(1, 100.0);
    sheet.press_with(header, MouseButton::Left, Modifiers::default(), 2);
    sheet.release(header);
    assert_eq!(
        clicks(&mut sheet),
        [(ClickKind::Press, ClickTarget::Column(1))]
    );
    let context = [(ClickKind::Context, ClickTarget::Column(1))];
    // A right press.
    sheet.press_with(at, MouseButton::Right, Modifiers::default(), 1);
    sheet
        .cx
        .simulate_mouse_up(at, MouseButton::Right, Modifiers::default());
    sheet.draw();
    assert_eq!(sheet.pressed(), None);
    assert_eq!(sheet.heard().len(), 1, "no icon's event");
    assert_eq!(sheet.right_presses(), 1, "and it reaches the host");
    sheet.press_with(at, MouseButton::Right, Modifiers::default(), 1);
    assert_eq!(clicks(&mut sheet), context);
    // Ctrl+left: the icon's with the setting off, its header's with it on.
    let ctrl = Modifiers {
        control: true,
        ..Modifiers::default()
    };
    sheet.press_with(at, MouseButton::Left, ctrl, 1);
    assert_eq!(sheet.pressed(), Some(1));
    sheet.release(at);
    assert_eq!(sheet.presses().len(), 1);
    sheet.update(|table, _| table.set_ctrl_press_is_context(true));
    sheet.press_with(at, MouseButton::Left, ctrl, 1);
    assert_eq!(sheet.pressed(), None);
    sheet.release(at);
    assert_eq!(clicks(&mut sheet), context);
    // A long press, then the tap gpui makes of its lifted touch.
    sheet.cx.simulate_event(LongPressEvent {
        phase: TouchPhase::Started,
        start_position: at,
        position: at + point(px(3.), px(2.)),
    });
    sheet.draw();
    sheet.press(at);
    assert_eq!(sheet.pressed(), None, "the tap isn't the icon's");
    sheet.release(at);
    let heard = sheet.heard();
    assert!(
        matches!(
            heard.as_slice(),
            [TallTableEvent::Clicked(TallTableClick {
                kind: ClickKind::Context,
                target: ClickTarget::Column(1),
                ..
            })]
        ),
        "the long press, once: {heard:?}"
    );
    // The press after it is the icon's again.
    sheet.click(at);
    assert_eq!(sheet.presses().len(), 1);
}

/// A press on an icon is a press outside an open popover.
#[cfg(feature = "popover")]
#[gpui_kit::test]
fn a_press_closes_an_open_popover(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, vec![text("a"), text("b")], 900.0);
    let cell = crate::PopoverCell { row: 1, column: 0 };
    assert!(sheet.update(|table, cx| table.open_popover(cell, cx)));
    assert_eq!(sheet.read(|table| table.popover()), Some(cell));
    let at = sheet.icon_at(1);
    sheet.press(at);
    assert_eq!(sheet.read(|table| table.popover()), None);
    sheet.release(at);
    assert_eq!(sheet.presses().len(), 1);
}

// --- the setter, and what forgets a held press ---

#[gpui_kit::test]
fn set_column_icon_lays_out_only_when_its_room_changes(cx: &mut TestAppContext) {
    let columns = vec![TallTableColumn::new("a", ColumnKind::Text), text("b")];
    let mut sheet = Sheet::open(cx, columns, 900.0);
    let mut generation = sheet.read(|table| table.layout_generation);
    let mut set = |sheet: &mut Sheet<'_>, icon: Option<HeaderIcon>, lays_out: bool, why: &str| {
        sheet.update(|table, cx| table.set_column_icon(0, icon.clone(), cx));
        let now = sheet.read(|table| table.layout_generation);
        assert_eq!(now != generation, lays_out, "{why}");
        generation = now;
        assert_eq!(
            sheet.read(|table| table.columns()[0].header_icon().cloned()),
            icon,
            "{why}: the reader"
        );
    };
    set(&mut sheet, Some(icon("text.svg")), true, "added");
    assert_eq!(
        sheet.drawn(0).map(|icon| (icon.path, icon.fill.is_some())),
        Some(("text.svg".into(), false))
    );
    let layout = sheet.layout.borrow().clone().expect("a layout");
    assert_eq!(layout.columns[0].icon, Some((8.0, 18.0)));
    set(
        &mut sheet,
        Some(icon("num.svg").fill(tint)),
        false,
        "another path and a fill",
    );
    assert_eq!(
        sheet.drawn(0).map(|icon| (icon.path, icon.fill.is_some())),
        Some(("num.svg".into(), true))
    );
    set(
        &mut sheet,
        Some(icon("nope.svg")),
        true,
        "a path that fails",
    );
    assert_eq!(sheet.drawn(0), None);
    set(&mut sheet, Some(icon("time.svg")), true, "one that loads");
    assert!(sheet.drawn(0).is_some());
    set(&mut sheet, None, true, "removed");
    assert_eq!(sheet.drawn(0), None);
    set(&mut sheet, None, false, "none again");
    let layout = sheet.layout.borrow().clone().expect("a layout");
    assert_eq!(layout.columns[0].icon, None);
    // Past the last column: nothing, quietly.
    sheet.update(|table, cx| table.set_column_icon(9, Some(icon("text.svg")), cx));
    assert_eq!(sheet.read(|table| table.layout_generation), generation);
    assert_eq!(sheet.heard().len(), 0, "no event");
}

#[gpui_kit::test]
fn a_held_press_is_forgotten_when_its_icon_goes(cx: &mut TestAppContext) {
    let columns = vec![text("a"), text("b")];
    let mut sheet = Sheet::open(cx, columns.clone(), 900.0);
    let at = sheet.icon_at(1);
    // `set_columns`: its index is another column now.
    sheet.press(at);
    assert_eq!(sheet.pressed(), Some(1), "the control: held");
    sheet.update(|table, cx| table.set_columns(columns, cx));
    assert_eq!(sheet.pressed(), None);
    sheet.release(at);
    assert_eq!(sheet.presses(), []);
    // Its icon removed between the press and the release, inside one
    // update: no frame hears of it before the release.
    sheet.press(at);
    sheet
        .table
        .update(sheet.cx, |table, cx| table.set_column_icon(1, None, cx));
    assert_eq!(sheet.pressed(), None);
    sheet
        .cx
        .simulate_mouse_up(at, MouseButton::Left, Modifiers::default());
    sheet.draw();
    assert_eq!(sheet.presses(), [], "no column without an icon is reported");
    // Another column's removed: the press stays.
    sheet.update(|table, cx| table.set_column_icon(1, Some(icon("text.svg")), cx));
    sheet.press(at);
    sheet.update(|table, cx| table.set_column_icon(0, None, cx));
    assert_eq!(sheet.pressed(), Some(1));
    sheet.release(at);
    assert_eq!(sheet.presses().len(), 1);
}

/// A hidden column draws no icon, and a press held on it is forgotten
/// when it hides.
#[cfg(feature = "hide")]
#[gpui_kit::test]
fn a_hidden_column_draws_none_and_forgets_its_press(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, vec![text("a"), text("b"), text("c")], 900.0);
    let at = sheet.icon_at(1);
    sheet.press(at);
    sheet
        .table
        .update(sheet.cx, |table, cx| table.set_column_hidden(1, true, cx));
    assert_eq!(sheet.pressed(), None);
    sheet
        .cx
        .simulate_mouse_up(at, MouseButton::Left, Modifiers::default());
    sheet.draw();
    assert_eq!(sheet.presses(), []);
    assert_eq!(
        sheet.read(|table| table
            .icon_state
            .drawn
            .iter()
            .map(|icon| icon.column)
            .collect::<Vec<_>>()),
        [0, 2]
    );
    let layout = sheet.layout.borrow().clone().expect("a layout");
    assert_eq!(layout.columns[1].icon, None);
    // Column 2 is drawn where 1 was: the press there is its own.
    sheet.click(at);
    assert_eq!(
        sheet
            .presses()
            .into_iter()
            .map(|press| press.column)
            .collect::<Vec<_>>(),
        [2]
    );
}

/// The icons are in the names' row, under the groups' rows, whose cells
/// have none. The names' row hangs from the header's bottom inside its
/// border there, a pixel higher: the press's bounds are the badge as
/// painted, at rest and raised.
#[cfg(feature = "group-headers")]
#[gpui_kit::test]
fn a_groups_cell_has_no_icon(cx: &mut TestAppContext) {
    let columns = vec![text("a").group(["g"]), text("b").group(["g"]), text("c")];
    let mut sheet = Sheet::open(cx, columns, 900.0);
    assert_eq!(sheet.read(|table| table.group_rows()), 1);
    assert_eq!(sheet.read(|table| table.icon_state.drawn.len()), 3);
    let mut badge = sheet.badge(0);
    badge.origin.y -= px(1.);
    assert_eq!(sheet.painted(0), badge, "the badge as painted");
    assert_eq!(sheet.drawn(0).expect("an icon").look, badge);
    let at = sheet.icon_at(0);
    sheet.hover(at);
    let raised = sheet.drawn(0).expect("an icon");
    assert!(raised.raised);
    assert_eq!(sheet.painted(0), raised.look, "the raised look as painted");
    sheet.click(at);
    assert_eq!(sheet.presses(), [press_of(0, badge)]);
    // The same x in the group's row: the group's cell.
    let above = at - point(px(0.), row_height());
    sheet.press(above);
    assert_eq!(sheet.pressed(), None);
    sheet.release(above);
    assert_eq!(sheet.presses(), []);
}
