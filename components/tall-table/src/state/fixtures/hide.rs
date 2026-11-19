//! `hide`: a hidden column in a window of GPUI's test app, over rows
//! answered from memory, driven through the element (its keys and
//! contexts) and the pointer: laid out at no width and drawn nowhere (its
//! header, cells, border, arrow, band, group cell), hit nowhere, its width,
//! sort, and group kept and back on show; the flag following its column
//! through a move; the setters' events and refusals; and each built
//! feature's rule (`pin`'s count by place, `select`'s keys, `copy`'s shown
//! columns, the drags a hide cancels). `fixtures/`' `hidden` cases are run
//! by each fixture's own file.

use std::cell::{Cell as Counter, RefCell};
use std::ops::Range;
use std::rc::Rc;

use gpui_kit::component::scroll::Scrollbar;
use gpui_kit::{
    App, AppContext as _, Context, Entity, InteractiveElement as _, IntoElement, KeyBinding,
    ParentElement as _, Pixels, Point, Render, Styled as _, TestAppContext, VisualTestContext,
    Window, actions, div, point, px, size,
};
#[cfg(any(feature = "resize", feature = "reorder", feature = "select"))]
use gpui_kit::{Modifiers, MouseButton, MouseDownEvent};

use super::super::{TallTableEvent, TallTableState, row_height};
use crate::column::{ColumnKind, TallTableColumn};
use crate::delegate::{CellValue, PageLoad, TallTableDelegate, TallTablePage};
use crate::tall_table::TallTable;

actions!(hide_test, [HostCopy]);

/// `row * 1000 + column`: a copy's text says which cell it came from.
struct Memory;

struct Rows(Range<u64>);

impl TallTablePage for Rows {
    fn value(&self, row: usize, column: usize) -> Option<CellValue<'_>> {
        Some(CellValue::Float(
            ((self.0.start + row as u64) * 1000 + column as u64) as f64,
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
        (rows.start, Box::pin(std::future::ready(Ok(Rows(rows)))))
    }

    fn cancel(&mut self, _: u64, _: &mut App) {}

    #[cfg(feature = "sort")]
    fn sort(&mut self, _: &[crate::Sort], _: &mut App) -> Result<(), crate::SortRefused> {
        Ok(())
    }
}

type Table = TallTableState<Memory>;

/// The host: the table's element in a context of its own, whose Cmd+C
/// counts what the table lets through.
struct Shell {
    table: Entity<Table>,
    copies: Rc<Counter<usize>>,
}

impl Render for Shell {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        div()
            .key_context("Host")
            .on_action(cx.listener(|this, _: &HostCopy, _, _| {
                this.copies.set(this.copies.get() + 1);
            }))
            .size_full()
            .child(TallTable::new(&self.table))
    }
}

/// `count` float columns, each the kind's 120 px; with `sort`, sortable.
fn floats(count: usize) -> Vec<TallTableColumn> {
    (0..count)
        .map(|index| {
            let column = TallTableColumn::new(format!("f{index}"), ColumnKind::Float);
            #[cfg(feature = "sort")]
            let column = column.sortable(true);
            column
        })
        .collect()
}

/// A table in a window whose cells area is `cells_width` wide and 20 rows
/// tall, over 1,000 rows, with every event it emitted.
struct Sheet<'a> {
    cx: &'a mut VisualTestContext,
    table: Entity<Table>,
    events: Rc<RefCell<Vec<TallTableEvent>>>,
    /// The host's Cmd+C, counted (`copy`'s tests).
    #[cfg_attr(not(feature = "copy"), expect(dead_code))]
    copies: Rc<Counter<usize>>,
    _subscription: gpui_kit::Subscription,
}

impl<'a> Sheet<'a> {
    fn open(cx: &'a mut TestAppContext, columns: Vec<TallTableColumn>, cells_width: f32) -> Self {
        cx.update(|cx| {
            gpui_kit::component::init(cx);
            crate::init(cx);
            cx.bind_keys([
                KeyBinding::new("cmd-c", HostCopy, Some("Host")),
                KeyBinding::new("ctrl-c", HostCopy, Some("Host")),
            ]);
        });
        let copies: Rc<Counter<usize>> = Rc::default();
        let host_copies = copies.clone();
        let (shell, cx) = cx.add_window_view(move |_, cx| {
            let table = cx.new(|cx| {
                TallTableState::new(Memory, columns, 1000, Default::default(), cx)
                    .probe_frames(true)
            });
            Shell {
                table,
                copies: host_copies,
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
        let heard = events.clone();
        let subscription = cx.update(|_, cx| {
            cx.subscribe(&table, move |_, event: &TallTableEvent, _| {
                heard.borrow_mut().push(event.clone());
            })
        });
        let mut sheet = Self {
            cx,
            table,
            events,
            copies,
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
        for _ in 0..2 {
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

    fn hide(&mut self, index: usize, hidden: bool) {
        self.update(|table, cx| table.set_column_hidden(index, hidden, cx));
    }

    /// The `ColumnsHidden` heard since the last call.
    fn hidden_events(&mut self) -> Vec<Vec<bool>> {
        self.events
            .borrow_mut()
            .drain(..)
            .filter_map(|event| match event {
                TallTableEvent::ColumnsHidden(hidden) => Some(hidden),
                _ => None,
            })
            .collect()
    }

    /// Each place's left edge and width, as laid out.
    fn layout(&mut self) -> Vec<(f32, f32)> {
        self.read(|table| {
            table
                .columns
                .iter()
                .map(|column| (column.x, column.width))
                .collect()
        })
    }

    /// The places drawn: the header's and the body's columns.
    fn drawn_places(&mut self) -> Vec<usize> {
        self.read(|table| table.visible_columns().map(|(place, _)| place).collect())
    }

    /// The columns (indices) whose cells' text the last frame drew.
    fn text_columns(&mut self) -> Vec<usize> {
        self.read(|table| {
            let mut columns: Vec<usize> = table
                .drawn_text
                .borrow()
                .iter()
                .map(|cell| cell.column)
                .collect();
            columns.sort_unstable();
            columns.dedup();
            columns
        })
    }

    /// A point `x` px right of the cells' left edge, on row `row` of the
    /// view (`-1`: the header's names).
    fn at(&mut self, x: f32, row: f32) -> Point<Pixels> {
        let (origin, gutter) = self.read(|table| (table.body.origin, table.gutter_width()));
        origin + point(px(gutter + x), row_height() * (row + 0.5))
    }

    #[cfg(any(feature = "resize", feature = "reorder", feature = "select"))]
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

    #[cfg(any(feature = "resize", feature = "reorder"))]
    fn drag_to(&mut self, at: Point<Pixels>) {
        self.cx
            .simulate_mouse_move(at, MouseButton::Left, Modifiers::default());
        self.draw();
    }

    #[cfg(any(feature = "select", feature = "copy"))]
    fn key(&mut self, keys: &str) {
        self.cx.simulate_keystrokes(keys);
        self.draw();
    }
}

/// A hidden column is laid out at no width at the right edge of the one
/// before it, every place and index kept; nothing of it is drawn, the
/// content narrows, and a show puts it back at its width. The probe lists
/// it, flagged.
#[gpui_kit::test]
fn a_hidden_column_takes_no_width_and_draws_nothing(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, floats(6), 600.0);
    assert_eq!(sheet.text_columns(), vec![0, 1, 2, 3, 4]);
    sheet.hide(2, true);
    assert_eq!(
        sheet.layout(),
        vec![
            (0.0, 120.0),
            (120.0, 120.0),
            (240.0, 0.0),
            (240.0, 120.0),
            (360.0, 120.0),
            (480.0, 120.0)
        ]
    );
    assert_eq!(sheet.read(|table| table.content_width), 600.0);
    // Column 5 comes into the view the hidden one left.
    assert_eq!(sheet.drawn_places(), vec![0, 1, 3, 4, 5]);
    assert_eq!(sheet.text_columns(), vec![0, 1, 3, 4, 5]);
    assert!(sheet.read(|table| table.columns()[2].is_hidden()));
    // The probe lists every column, the hidden one at no width.
    let probe = sheet.read(|table| {
        table
            .columns
            .iter()
            .map(|column| (column.width, !column.shown()))
            .collect::<Vec<_>>()
    });
    assert_eq!(probe[2], (0.0, true));
    // Back at its width.
    sheet.hide(2, false);
    assert_eq!(sheet.layout()[2], (240.0, 120.0));
    assert_eq!(sheet.text_columns(), vec![0, 1, 2, 3, 4]);
}

/// Nothing hits a hidden column: the hover's test, at its edge, finds the
/// column after it.
#[gpui_kit::test]
fn a_hidden_column_is_hit_nowhere(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, floats(6), 600.0);
    sheet.hide(2, true);
    let at = sheet.at(240.0, 3.0);
    assert_eq!(sheet.read(|table| table.cell_at(at)), Some((3, 3)));
    let at = sheet.at(239.5, 3.0);
    assert_eq!(sheet.read(|table| table.cell_at(at)), Some((3, 1)));
}

/// `ColumnsHidden` once a changing call, every flag by index; none for a
/// call that changes nothing, nor for `set_hidden` of another length.
#[gpui_kit::test]
fn columns_hidden_once_a_changing_call(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, floats(4), 600.0);
    sheet.hide(1, true);
    assert_eq!(sheet.hidden_events(), vec![vec![false, true, false, false]]);
    sheet.hide(1, true);
    assert_eq!(sheet.hidden_events(), Vec::<Vec<bool>>::new());
    sheet.update(|table, cx| table.set_hidden(vec![true, true, false, true], cx));
    assert_eq!(sheet.hidden_events(), vec![vec![true, true, false, true]]);
    sheet.update(|table, cx| table.set_hidden(vec![true, true, false, true], cx));
    assert_eq!(sheet.hidden_events(), Vec::<Vec<bool>>::new());
    // A view saved before the columns changed: refused, quietly.
    sheet.update(|table, cx| table.set_hidden(vec![false; 5], cx));
    sheet.update(|table, cx| table.set_hidden(vec![false; 3], cx));
    assert_eq!(sheet.hidden_events(), Vec::<Vec<bool>>::new());
    let flags = sheet.read(|table| table.hidden_flags());
    assert_eq!(flags, vec![true, true, false, true]);
}

/// `set_columns` takes the new columns' flags, with no event.
#[gpui_kit::test]
fn set_columns_takes_the_flags(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, floats(4), 600.0);
    sheet.hide(0, true);
    sheet.hidden_events();
    let mut columns = floats(3);
    columns[1] = columns[1].clone().hidden(true);
    sheet.update(|table, cx| table.set_columns(columns, cx));
    assert_eq!(sheet.hidden_events(), Vec::<Vec<bool>>::new());
    assert_eq!(
        sheet.read(|table| table.hidden_flags()),
        vec![false, true, false]
    );
    assert_eq!(sheet.layout()[1], (120.0, 0.0));
}

/// Every column hidden: the gutter is drawn, the cells area empty, the
/// content no width, the sideways scroll at 0.
#[gpui_kit::test]
fn every_column_hidden(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, floats(8), 600.0);
    sheet.update(|table, cx| table.scroll_by(0.0, 1000.0, cx));
    assert_eq!(sheet.read(|table| table.scroll_x), 360.0);
    sheet.update(|table, cx| table.set_hidden(vec![true; 8], cx));
    assert_eq!(sheet.read(|table| table.content_width), 0.0);
    assert_eq!(sheet.read(|table| table.scroll_x), 0.0);
    assert_eq!(sheet.drawn_places(), Vec::<usize>::new());
    assert_eq!(sheet.text_columns(), Vec::<usize>::new());
    assert!(sheet.read(|table| table.gutter_width()) > 0.0);
    let at = sheet.at(10.0, 2.0);
    assert_eq!(sheet.read(|table| table.cell_at(at)), None);
}

/// A hide that narrows the content clamps the sideways scroll, as a
/// resize does.
#[gpui_kit::test]
fn the_sideways_scroll_clamped(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, floats(8), 600.0);
    sheet.update(|table, cx| table.scroll_by(0.0, 1000.0, cx));
    assert_eq!(sheet.read(|table| table.scroll_x), 360.0);
    sheet.hide(7, true);
    assert_eq!(sheet.read(|table| table.scroll_x), 240.0);
    // A show leaves it where it is.
    sheet.hide(7, false);
    assert_eq!(sheet.read(|table| table.scroll_x), 240.0);
}

/// A set width is kept through a hide and comes back with the show; no
/// band is drawn for a hidden column.
#[cfg(feature = "resize")]
#[gpui_kit::test]
fn its_width_kept_and_no_band(cx: &mut TestAppContext) {
    let mut columns = floats(5);
    columns[1] = columns[1].clone().width(px(200.));
    let mut sheet = Sheet::open(cx, columns, 600.0);
    sheet.hide(1, true);
    assert_eq!(sheet.layout()[1], (120.0, 0.0));
    let bands: Vec<usize> = sheet.read(|table| {
        table
            .bands_drawn
            .borrow()
            .iter()
            .map(|band| band.column)
            .collect()
    });
    assert!(
        !bands.contains(&1),
        "a band for the hidden column: {bands:?}"
    );
    sheet.hide(1, false);
    assert_eq!(sheet.layout()[1], (120.0, 200.0));
}

/// A resize drag held across a hide or a show of any column ends as its
/// release would, its width kept and reported; with `pin`, the run
/// re-summed at the setter, `Pinned` with it.
#[cfg(feature = "resize")]
#[gpui_kit::test]
fn a_resize_drag_ended(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, floats(6), 600.0);
    #[cfg(feature = "pin")]
    {
        sheet.update(|table, cx| table.set_pinned(3, cx));
        assert_eq!(sheet.read(|table| table.pinned_in_effect()), 2);
        sheet.events.borrow_mut().clear();
    }
    // Column 4's band, at its right edge: a drag of 30 px.
    let band = sheet.read(|table| {
        table
            .bands_drawn
            .borrow()
            .iter()
            .find(|band| band.column == 4 && band.shown)
            .map(|band| band.x)
    });
    let band = band.expect("column 4's band");
    let names_y = sheet.at(0.0, -1.0).y;
    sheet.press(point(px(band), names_y));
    sheet.drag_to(point(px(band + 30.0), names_y));
    assert!(sheet.read(|table| table.resizing.is_some()));
    assert_eq!(sheet.layout()[4].1, 150.0);
    sheet.hide(0, true);
    assert!(sheet.read(|table| table.resizing.is_none()));
    assert_eq!(sheet.read(|table| table.columns()[4].width), Some(150.0));
    assert_eq!(sheet.layout()[4].1, 150.0);
    let widths: Vec<_> = sheet
        .events
        .borrow()
        .iter()
        .filter_map(|event| match event {
            TallTableEvent::ColumnWidthsChanged(widths) => Some(widths.clone()),
            _ => None,
        })
        .collect();
    assert_eq!(
        widths,
        vec![vec![None, None, None, None, Some(px(150.)), None]]
    );
    // The pointer's next move drags nothing.
    sheet.drag_to(point(px(band + 60.0), names_y));
    assert_eq!(sheet.layout()[4].1, 150.0);
    #[cfg(feature = "pin")]
    {
        // 0 hidden: the three take 240 px, under half the view.
        assert_eq!(sheet.read(|table| table.pinned_in_effect()), 3);
        let pinned: Vec<usize> = sheet
            .events
            .borrow()
            .iter()
            .filter_map(|event| match event {
                TallTableEvent::Pinned(pinned) => Some(*pinned),
                _ => None,
            })
            .collect();
        assert_eq!(pinned, vec![3]);
    }
}

/// `pin`'s count is of places: a hidden column among the *n* counts, at
/// no width, and its cap sums widths, so a hidden one costs it nothing;
/// the run's last hidden puts *P* at the shown one's edge.
#[cfg(feature = "pin")]
#[gpui_kit::test]
fn pin_counts_places(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, floats(8), 600.0);
    sheet.update(|table, cx| table.set_pinned(3, cx));
    assert_eq!(sheet.read(|table| table.pinned_in_effect()), 2);
    sheet.events.borrow_mut().clear();
    sheet.hide(1, true);
    assert_eq!(sheet.read(|table| table.pinned_in_effect()), 3);
    assert_eq!(sheet.read(|table| table.place().edge), 240.0);
    let pinned: Vec<_> = sheet
        .events
        .borrow()
        .iter()
        .filter(|event| matches!(event, TallTableEvent::Pinned(_)))
        .cloned()
        .collect();
    assert_eq!(pinned, vec![TallTableEvent::Pinned(3)]);
    // The run's last hidden: P at the column before it.
    sheet.hide(1, false);
    sheet.update(|table, cx| table.set_pinned(2, cx));
    sheet.hide(1, true);
    assert_eq!(sheet.read(|table| table.pinned_in_effect()), 2);
    assert_eq!(sheet.read(|table| table.place().edge), 120.0);
    // Scrolled: the hidden pinned column drawn nowhere, its neighbors as
    // pinned.
    sheet.update(|table, cx| table.scroll_by(0.0, 100.0, cx));
    let drawn = sheet.read(|table| table.pin_state.drawn.clone());
    assert!(drawn.iter().all(|(place, _)| *place != 1), "{drawn:?}");
    assert_eq!(drawn.first(), Some(&(0, 0.0)));
}

/// A hidden sorted column keeps the sort and draws no arrow; an arrow
/// pressed on it is forgotten.
#[cfg(feature = "sort")]
#[gpui_kit::test]
fn a_hidden_sorted_column(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, floats(5), 600.0);
    let sort = crate::Sort::new(2, crate::SortDirection::Ascending);
    sheet.update(|table, cx| table.set_sort(vec![sort], cx).expect("sorted"));
    // Forgotten at the setter, before a frame would forget an arrow it
    // no longer draws: a release can land between them.
    let pressed = sheet.table.update(sheet.cx, |table, cx| {
        table.sort_state.pressed = Some(2);
        table.set_column_hidden(2, true, cx);
        table.sort_state.pressed
    });
    assert_eq!(pressed, None);
    sheet.draw();
    assert_eq!(sheet.read(|table| table.sort().to_vec()), vec![sort]);
    let arrows: Vec<usize> = sheet.read(|table| {
        table
            .sort_state
            .drawn
            .iter()
            .map(|arrow| arrow.column)
            .collect()
    });
    assert!(!arrows.contains(&2), "{arrows:?}");
    // A press on another column's arrow stays.
    sheet.update(|table, _| table.sort_state.pressed = Some(3));
    sheet.hide(1, true);
    assert_eq!(sheet.read(|table| table.sort_state.pressed), Some(3));
}

/// The flag is the column's, by index: it follows its column through a
/// move and `set_order`.
#[cfg(feature = "reorder")]
#[gpui_kit::test]
fn the_flag_follows_its_column(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, floats(5), 600.0);
    sheet.hide(1, true);
    sheet.hidden_events();
    sheet.update(|table, cx| table.move_columns(1..2, 3, cx));
    assert_eq!(
        sheet.read(|table| table.order().to_vec()),
        vec![0, 2, 3, 1, 4]
    );
    assert_eq!(
        sheet.read(|table| table.hidden_flags()),
        vec![false, true, false, false, false]
    );
    assert_eq!(sheet.layout()[3], (360.0, 0.0));
    sheet.update(|table, cx| table.set_order(vec![4, 3, 2, 1, 0], cx));
    assert_eq!(sheet.layout()[3], (360.0, 0.0));
    assert_eq!(
        sheet.read(|table| table.hidden_flags()),
        vec![false, true, false, false, false]
    );
    assert_eq!(sheet.hidden_events(), Vec::<Vec<bool>>::new());
}

/// A `reorder` drag held across a hide is canceled.
#[cfg(feature = "reorder")]
#[gpui_kit::test]
fn a_reorder_drag_canceled(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, floats(5), 600.0);
    // A names' row press selects columns rather than moving them (`select`).
    #[cfg(feature = "select")]
    sheet.update(|table, cx| table.set_selectable(crate::selection::Selectable::none(), cx));
    let from = sheet.at(60.0, -1.0);
    sheet.press(from);
    let to = sheet.at(300.0, -1.0);
    sheet.drag_to(to);
    assert!(sheet.read(|table| table.is_moving()));
    sheet.hide(3, true);
    assert!(sheet.read(|table| table.moving.is_none()));
    assert_eq!(
        sheet.read(|table| table.order().to_vec()),
        vec![0, 1, 2, 3, 4]
    );
}

/// The arrow keys step over a hidden column, and from a hidden head;
/// toward only hidden ones, they stay.
#[cfg(feature = "select")]
#[gpui_kit::test]
fn the_keys_step_over_a_hidden_column(cx: &mut TestAppContext) {
    use crate::selection::{Selectable, TallTableSelection};
    let mut sheet = Sheet::open(cx, floats(6), 600.0);
    sheet.update(|table, cx| table.set_selectable(Selectable::all(), cx));
    sheet.hide(2, true);
    sheet.hide(5, true);
    let cell = |column| TallTableSelection::Cells {
        anchor: (4, column),
        head: (4, column),
    };
    sheet.update(|table, cx| table.set_selection(Some(cell(1)), cx));
    sheet.key("right");
    assert_eq!(sheet.read(|table| table.selection()), Some(cell(3)));
    sheet.key("left");
    assert_eq!(sheet.read(|table| table.selection()), Some(cell(1)));
    // The last shown, the last hidden after it: it stays.
    sheet.update(|table, cx| table.set_selection(Some(cell(4)), cx));
    sheet.key("right");
    assert_eq!(sheet.read(|table| table.selection()), Some(cell(4)));
    // From a hidden active cell (a range still showing a column), from
    // its place.
    let across = TallTableSelection::Cells {
        anchor: (4, 2),
        head: (4, 3),
    };
    sheet.update(|table, cx| table.set_selection(Some(across), cx));
    assert_eq!(sheet.read(|table| table.selection()), Some(across));
    sheet.key("right");
    assert_eq!(sheet.read(|table| table.selection()), Some(cell(3)));
    sheet.update(|table, cx| table.set_selection(Some(across), cx));
    sheet.key("left");
    assert_eq!(sheet.read(|table| table.selection()), Some(cell(1)));
    // Shift+arrow extends over it too.
    sheet.update(|table, cx| table.set_selection(Some(cell(1)), cx));
    sheet.key("shift-right");
    assert_eq!(
        sheet.read(|table| table.selection()),
        Some(TallTableSelection::Cells {
            anchor: (4, 1),
            head: (4, 3)
        })
    );
    // A hide changes no selection.
    sheet.events.borrow_mut().clear();
    sheet.hide(3, true);
    let selected = sheet
        .events
        .borrow()
        .iter()
        .any(|event| matches!(event, TallTableEvent::Selected(_)));
    assert!(!selected);
}

/// A key's head on a hidden column scrolls nothing sideways; a shown one
/// is brought into view.
#[cfg(feature = "select")]
#[gpui_kit::test]
fn no_scroll_to_a_hidden_column(cx: &mut TestAppContext) {
    use crate::selection::{Selectable, TallTableSelection};
    let mut sheet = Sheet::open(cx, floats(10), 600.0);
    sheet.update(|table, cx| table.set_selectable(Selectable::all(), cx));
    sheet.hide(8, true);
    let cell = |column| TallTableSelection::Cells {
        anchor: (4, column),
        head: (4, column),
    };
    // A head on the hidden column (the range shows column 7), moved down
    // by Shift: no sideways scroll.
    sheet.update(|table, cx| {
        table.set_selection(
            Some(TallTableSelection::Cells {
                anchor: (4, 7),
                head: (4, 8),
            }),
            cx,
        )
    });
    sheet.key("shift-down");
    assert_eq!(
        sheet.read(|table| table.selection()),
        Some(TallTableSelection::Cells {
            anchor: (4, 7),
            head: (5, 8)
        })
    );
    assert_eq!(sheet.read(|table| table.scroll_x), 0.0);
    // A shown one is brought into view.
    sheet.update(|table, cx| table.set_selection(Some(cell(7)), cx));
    sheet.key("right");
    assert_eq!(sheet.read(|table| table.selection()), Some(cell(9)));
    assert_eq!(sheet.read(|table| table.scroll_x), 480.0);
}

/// Past a hidden last column, a drag's head and a gutter press land on the
/// last shown; with every column hidden, a gutter press and an arrow key
/// with nothing selected select nothing.
#[cfg(feature = "select")]
#[gpui_kit::test]
fn the_nearest_cell_is_shown(cx: &mut TestAppContext) {
    use crate::selection::Selectable;
    let mut sheet = Sheet::open(cx, floats(4), 600.0);
    sheet.update(|table, cx| table.set_selectable(Selectable::all(), cx));
    sheet.hide(3, true);
    let past = sheet.at(590.0, 2.0);
    assert_eq!(sheet.read(|table| table.cell_clamped(past)), Some((2, 2)));
    sheet.update(|table, cx| table.set_hidden(vec![true; 4], cx));
    assert_eq!(sheet.read(|table| table.cell_clamped(past)), None);
    let gutter = {
        let at = sheet.at(0.0, 2.0);
        let gutter = sheet.read(|table| table.gutter_width());
        point(at.x - px(gutter / 2.0), at.y)
    };
    sheet.press(gutter);
    assert_eq!(sheet.read(|table| table.selection()), None);
    sheet.key("right");
    assert_eq!(sheet.read(|table| table.selection()), None);
}

/// A hide that leaves a `Columns` or `Cells` selection no shown column
/// clears it, after `ColumnsHidden`, and a show doesn't bring it back; one
/// still showing a column stays, and so does a `Rows` one. `set_selection`
/// over hidden columns alone clears too.
#[cfg(feature = "select")]
#[gpui_kit::test]
fn a_selection_with_nothing_shown_clears(cx: &mut TestAppContext) {
    use crate::selection::{Selectable, TallTableSelection};
    let mut sheet = Sheet::open(cx, floats(6), 600.0);
    sheet.update(|table, cx| table.set_selectable(Selectable::all(), cx));
    let cell = TallTableSelection::Cells {
        anchor: (3, 2),
        head: (3, 2),
    };
    sheet.update(|table, cx| table.set_selection(Some(cell), cx));
    sheet.events.borrow_mut().clear();
    sheet.hide(2, true);
    let heard: Vec<&'static str> = sheet
        .events
        .borrow()
        .iter()
        .filter_map(|event| match event {
            TallTableEvent::ColumnsHidden(_) => Some("hidden"),
            TallTableEvent::Selected(None) => Some("cleared"),
            TallTableEvent::Selected(Some(_)) => Some("selected"),
            _ => None,
        })
        .collect();
    assert_eq!(heard, vec!["hidden", "cleared"]);
    sheet.hide(2, false);
    assert_eq!(sheet.read(|table| table.selection()), None);
    // A range still showing a column stays, its tint across the gap.
    let columns = TallTableSelection::Columns {
        anchor: (0, 1),
        head: (0, 3),
    };
    sheet.update(|table, cx| table.set_selection(Some(columns), cx));
    sheet.update(|table, cx| table.set_hidden(vec![false, true, true, false, false, false], cx));
    assert_eq!(sheet.read(|table| table.selection()), Some(columns));
    sheet.hide(3, true);
    assert_eq!(sheet.read(|table| table.selection()), None);
    // A `Rows` range stays with every column hidden.
    let rows = TallTableSelection::Rows {
        anchor: (2, 0),
        head: (5, 0),
    };
    sheet.update(|table, cx| table.set_selection(Some(rows), cx));
    sheet.update(|table, cx| table.set_hidden(vec![true; 6], cx));
    assert_eq!(sheet.read(|table| table.selection()), Some(rows));
    // The host's selection over hidden columns alone clears.
    sheet.update(|table, cx| table.set_hidden(vec![false, true, true, false, false, false], cx));
    sheet.update(|table, cx| {
        table.set_selection(
            Some(TallTableSelection::Cells {
                anchor: (1, 1),
                head: (2, 2),
            }),
            cx,
        )
    });
    assert_eq!(sheet.read(|table| table.selection()), None);
}

/// A plain key and `jump_to` from a hidden active cell (a range still
/// showing a column) land on the nearest shown column, right first; the
/// active cell's outline isn't drawn over a hidden column.
#[cfg(feature = "select")]
#[gpui_kit::test]
fn from_a_hidden_active_cell(cx: &mut TestAppContext) {
    use crate::selection::{Selectable, TallTableSelection};
    let mut sheet = Sheet::open(cx, floats(6), 600.0);
    sheet.update(|table, cx| table.set_selectable(Selectable::all(), cx));
    let across = TallTableSelection::Cells {
        anchor: (4, 2),
        head: (4, 4),
    };
    sheet.update(|table, cx| table.set_selection(Some(across), cx));
    let outlined = sheet.read(|table| table.selection_state.drawn.active.is_some());
    assert!(outlined, "focused, the active cell outlined");
    sheet.hide(2, true);
    assert_eq!(sheet.read(|table| table.selection()), Some(across));
    assert_eq!(sheet.read(|table| table.selection_state.drawn.active), None);
    let cell = |row, column| TallTableSelection::Cells {
        anchor: (row, column),
        head: (row, column),
    };
    sheet.key("down");
    assert_eq!(sheet.read(|table| table.selection()), Some(cell(5, 3)));
    // Nearest to the left when none is shown to the right.
    sheet.update(|table, cx| {
        table.set_hidden(vec![false, false, true, true, true, true], cx);
        table.set_selection(
            Some(TallTableSelection::Cells {
                anchor: (4, 4),
                head: (4, 1),
            }),
            cx,
        );
    });
    sheet.draw();
    sheet.update(|table, cx| table.jump_to(10, cx));
    assert_eq!(
        sheet.read(|table| table.selection()),
        Some(TallTableSelection::Rows {
            anchor: (10, 1),
            head: (10, 1)
        }),
        "rows on: the row, its active cell in the nearest shown column"
    );
}

/// With every column hidden, nothing is selectable: a kept `Rows` range
/// stays while the keys scroll as the base's, and a jump selects nothing,
/// whichever kinds are on; Left from a hidden active cell with nothing
/// shown to its left stays, as Shift+Left does.
#[cfg(feature = "select")]
#[gpui_kit::test]
fn no_cell_lands_on_hidden_columns(cx: &mut TestAppContext) {
    use crate::selection::{Selectable, TallTableSelection};
    let mut sheet = Sheet::open(cx, floats(4), 600.0);
    sheet.update(|table, cx| table.set_selectable(Selectable::all(), cx));
    let rows = TallTableSelection::Rows {
        anchor: (2, 0),
        head: (2, 0),
    };
    sheet.update(|table, cx| {
        table.set_selection(Some(rows), cx);
        table.set_hidden(vec![true; 4], cx);
    });
    for (key, top) in [
        ("down", 1.0),
        ("up", 0.0),
        ("pagedown", 19.0),
        ("end", 980.0),
        ("home", 0.0),
        ("left", 0.0),
        ("shift-down", 1.0),
    ] {
        sheet.key(key);
        assert_eq!(sheet.read(|table| table.selection()), Some(rows), "{key}");
        assert_eq!(sheet.read(|table| table.scroll.top()), top, "{key}");
    }
    for selectable in [
        Selectable::none().cells(true),
        Selectable::none().rows(true),
    ] {
        sheet.update(|table, cx| {
            table.set_selection(None, cx);
            table.set_selectable(selectable, cx);
            table.jump_to(10, cx);
        });
        assert_eq!(sheet.read(|table| table.selection()), None);
        assert_eq!(sheet.read(|table| table.drawn_mark()), Some(10));
    }
    // Left with nothing shown to the left: it stays.
    let across = TallTableSelection::Cells {
        anchor: (4, 1),
        head: (4, 3),
    };
    sheet.update(|table, cx| {
        table.set_selectable(Selectable::all(), cx);
        table.set_hidden(vec![true, true, false, false], cx);
        table.set_selection(Some(across), cx);
    });
    sheet.key("left");
    assert_eq!(sheet.read(|table| table.selection()), Some(across));
}

/// An index past the last changes nothing, quietly, as `set_hidden`'s
/// list of another length does.
#[gpui_kit::test]
fn an_index_past_the_last_is_refused(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, floats(3), 600.0);
    sheet.hide(3, true);
    assert_eq!(sheet.hidden_events(), Vec::<Vec<bool>>::new());
    assert_eq!(sheet.read(|table| table.hidden_flags()), vec![false; 3]);
}

/// `copy` writes the shown columns only, the header line too, and counts
/// them for the key's cap and the least size; a selection of hidden
/// columns alone starts nothing, its key going on to the host.
#[cfg(feature = "copy")]
mod copy {
    use gpui_kit::TestAppContext;

    use super::{Sheet, floats};
    use crate::copy::{CopyFailure, CopyOptions, TallTableCopy};
    use crate::selection::{Selectable, TallTableSelection};
    use crate::state::TallTableEvent;

    fn copies(sheet: &mut Sheet) -> Vec<TallTableCopy> {
        sheet
            .events
            .borrow_mut()
            .drain(..)
            .filter_map(|event| match event {
                TallTableEvent::Copy(copy) => Some(copy),
                _ => None,
            })
            .collect()
    }

    fn text(copies: &[TallTableCopy]) -> String {
        copies
            .iter()
            .filter_map(|copy| match copy {
                TallTableCopy::Text { text, .. } => Some(text.as_str()),
                _ => None,
            })
            .collect()
    }

    fn columns(start: usize, end: usize) -> TallTableSelection {
        TallTableSelection::Cells {
            anchor: (1, start),
            head: (2, end),
        }
    }

    #[gpui_kit::test]
    fn shown_columns_only(cx: &mut TestAppContext) {
        let mut sheet = Sheet::open(cx, floats(5), 600.0);
        sheet.update(|table, cx| {
            table.set_selectable(Selectable::all(), cx);
            table.set_copy_options(CopyOptions::default().headers(true));
            table.set_selection(Some(columns(0, 3)), cx);
        });
        sheet.hide(1, true);
        sheet.events.borrow_mut().clear();
        sheet.key("cmd-c");
        let copied = copies(&mut sheet);
        assert!(matches!(
            copied.first(),
            Some(TallTableCopy::Started { columns, .. }) if *columns == (0..=3)
        ));
        let value = |row: u64, column: u64| {
            crate::delegate::CellValue::Float((row * 1000 + column) as f64).to_string()
        };
        let line = |row| format!("{}\t{}\t{}", value(row, 0), value(row, 2), value(row, 3));
        assert_eq!(
            text(&copied),
            format!("f0\tf2\tf3\n{}\n{}", line(1), line(2))
        );
        assert_eq!(sheet.copies.get(), 0);
    }

    /// Two shown columns in a range of many hidden: under the key's cap
    /// and the least size, which count the shown ones.
    #[gpui_kit::test]
    fn the_caps_count_shown_columns(cx: &mut TestAppContext) {
        let mut sheet = Sheet::open(cx, floats(40), 600.0);
        let mut hidden = vec![true; 40];
        hidden[0] = false;
        hidden[39] = false;
        sheet.update(|table, cx| {
            table.set_selectable(Selectable::all(), cx);
            // Two rows of 40 is 80 cells; of 2, 4.
            table.set_copy_options(
                CopyOptions::default()
                    .key_max_cells(10)
                    .max_bytes(4 * 8 + 2),
            );
            table.set_hidden(hidden, cx);
            table.set_selection(Some(columns(0, 39)), cx);
        });
        sheet.events.borrow_mut().clear();
        sheet.key("cmd-c");
        let started = copies(&mut sheet);
        assert!(
            !started.iter().any(|copy| matches!(
                copy,
                TallTableCopy::Declined { .. }
                    | TallTableCopy::Failed {
                        reason: CopyFailure::TooLarge { .. },
                        ..
                    }
            )),
            "{started:?}"
        );
        assert!(
            started
                .iter()
                .any(|copy| matches!(copy, TallTableCopy::Copied { .. })),
            "{started:?}"
        );
        // Shown, they're past both.
        sheet.update(|table, cx| table.set_hidden(vec![false; 40], cx));
        sheet.events.borrow_mut().clear();
        sheet.key("cmd-c");
        let declined = copies(&mut sheet);
        assert!(
            matches!(
                declined.as_slice(),
                [TallTableCopy::Declined {
                    rows: 2,
                    columns: 40
                }]
            ),
            "{declined:?}"
        );
        sheet.update(|table, cx| {
            let _ = table.copy(cx);
        });
        let refused = copies(&mut sheet);
        assert!(
            refused.iter().any(|copy| matches!(
                copy,
                TallTableCopy::Failed {
                    reason: CopyFailure::TooLarge { .. },
                    ..
                }
            )),
            "{refused:?}"
        );
    }

    /// The key's cap counts the shown ones in `Declined`.
    #[gpui_kit::test]
    fn declined_counts_shown_columns(cx: &mut TestAppContext) {
        let mut sheet = Sheet::open(cx, floats(6), 600.0);
        sheet.update(|table, cx| {
            table.set_selectable(Selectable::all(), cx);
            table.set_copy_options(CopyOptions::default().key_max_cells(3));
            table.set_hidden(vec![false, true, false, true, false, true], cx);
            table.set_selection(Some(columns(0, 5)), cx);
        });
        sheet.events.borrow_mut().clear();
        sheet.key("cmd-c");
        assert!(matches!(
            copies(&mut sheet).as_slice(),
            [TallTableCopy::Declined {
                rows: 2,
                columns: 3
            }]
        ));
    }

    /// A `Rows` range with every column hidden (kept, as a row range is):
    /// `copy` is `None` and the key goes on, nothing written.
    #[gpui_kit::test]
    fn rows_with_every_column_hidden(cx: &mut TestAppContext) {
        let mut sheet = Sheet::open(cx, floats(3), 600.0);
        sheet.update(|table, cx| {
            table.set_selectable(Selectable::all(), cx);
            table.set_selection(
                Some(TallTableSelection::Rows {
                    anchor: (2, 0),
                    head: (5, 0),
                }),
                cx,
            );
            table.set_hidden(vec![true; 3], cx);
        });
        assert!(sheet.read(|table| table.selection()).is_some());
        sheet.events.borrow_mut().clear();
        assert_eq!(sheet.update(|table, cx| table.copy(cx)), None);
        sheet.key("cmd-c");
        assert_eq!(sheet.copies.get(), 1, "the key went on to the host");
        assert!(copies(&mut sheet).is_empty());
    }

    /// Hidden columns alone: `copy` is `None`, and the key goes on.
    #[gpui_kit::test]
    fn hidden_alone_copies_nothing(cx: &mut TestAppContext) {
        let mut sheet = Sheet::open(cx, floats(5), 600.0);
        sheet.update(|table, cx| {
            table.set_selectable(Selectable::all(), cx);
            table.set_selection(Some(columns(1, 2)), cx);
        });
        sheet.update(|table, cx| table.set_hidden(vec![false, true, true, false, false], cx));
        sheet.events.borrow_mut().clear();
        assert_eq!(sheet.update(|table, cx| table.copy(cx)), None);
        sheet.key("cmd-c");
        assert_eq!(sheet.copies.get(), 1, "the key went on to the host");
        assert!(copies(&mut sheet).is_empty());
    }

    /// A copy running keeps the columns it started with: a hide or a show
    /// after its start changes nothing it writes.
    #[gpui_kit::test]
    fn a_running_copy_keeps_its_columns(cx: &mut TestAppContext) {
        let mut sheet = Sheet::open(cx, floats(5), 600.0);
        sheet.update(|table, cx| {
            table.set_selectable(Selectable::all(), cx);
            table.set_hidden(vec![false, true, false, false, false], cx);
            // Past the loaded pages: the copy waits on reads of its own.
            table.set_selection(
                Some(TallTableSelection::Cells {
                    anchor: (0, 0),
                    head: (900, 2),
                }),
                cx,
            );
        });
        sheet.events.borrow_mut().clear();
        // Started, then a show and a hide in the same update, before any
        // read lands.
        sheet.update(|table, cx| {
            let _ = table.copy(cx);
            table.set_hidden(vec![false, false, true, false, false], cx);
        });
        let copied = copies(&mut sheet);
        assert!(
            copied
                .iter()
                .any(|copy| matches!(copy, TallTableCopy::Copied { .. })),
            "{copied:?}"
        );
        let text = text(&copied);
        let first = text.lines().next().expect("a line");
        assert_eq!(first.split('\t').count(), 2, "{first}");
        assert!(first.ends_with("2.0") || first.ends_with('2'), "{first}");
    }
}

/// A group's cell spans its shown columns; one with every column hidden
/// draws no cell and takes no press; a press on a group selects its run's
/// places, hidden ones with them.
#[cfg(feature = "group-headers")]
#[gpui_kit::test]
fn groups_over_hidden_columns(cx: &mut TestAppContext) {
    let columns: Vec<TallTableColumn> = floats(6)
        .into_iter()
        .enumerate()
        .map(|(index, column)| column.group([if index < 3 { "a" } else { "b" }]))
        .collect();
    let mut sheet = Sheet::open(cx, columns, 600.0);
    sheet.hide(1, true);
    sheet.update(|table, cx| table.set_hidden(vec![false, true, false, true, true, true], cx));
    let drawn: Vec<(String, f32, f32)> = sheet.read(|table| {
        table
            .group_state
            .drawn
            .iter()
            .map(|cell| (cell.label.to_string(), cell.left, cell.width))
            .collect()
    });
    assert_eq!(drawn, vec![("a".to_string(), 0.0, 240.0)]);
    #[cfg(any(feature = "select", feature = "reorder", feature = "clicks"))]
    {
        let group_y = sheet.at(0.0, -2.0).y;
        let over_b = point(sheet.at(250.0, 0.0).x, group_y);
        assert_eq!(sheet.read(|table| table.group_row_at(over_b)), Some(None));
    }
    #[cfg(feature = "select")]
    {
        use crate::selection::{Selectable, TallTableSelection};
        sheet.update(|table, cx| table.set_selectable(Selectable::all(), cx));
        let on_a = point(sheet.at(60.0, 0.0).x, sheet.at(0.0, -2.0).y);
        sheet.press(on_a);
        let selection = sheet.read(|table| table.selection());
        assert!(
            matches!(
                selection,
                Some(TallTableSelection::Columns { anchor, head })
                    if anchor.1 == 0 && head.1 == 2
            ),
            "{selection:?}"
        );
    }
}

/// A press at a hidden column's edge is on the column after it (`clicks`).
#[cfg(feature = "clicks")]
#[gpui_kit::test]
fn a_press_never_targets_a_hidden_column(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, floats(5), 600.0);
    sheet.hide(2, true);
    let at = sheet.at(240.0, 3.0);
    let target = sheet.read(|table| table.target_at(at));
    assert_eq!(target, Some(super::super::hit::Target::Cell((3, 3))));
    let over = sheet.at(240.0, -1.0);
    assert_eq!(sheet.read(|table| table.header_place_at(over)), Some(3));
}
