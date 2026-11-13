//! `reorder`: `fixtures/reorder.json`'s move cases run against the move's
//! own rules ([`crate::reorder::Move`]), with their negative controls, and
//! the order drawn and driven in a window of GPUI's test app over rows
//! answered from memory: each drawn cell its column's own, at its place;
//! the tooltip, `set_columns`, `set_order`, and the event; with `resize`,
//! `select`, `pin`, `sort`, `copy`, and `live` with `custom-cells`, what a
//! move does to each.

use std::cell::{Cell, RefCell};
use std::ops::Range;
use std::rc::Rc;
use std::time::Duration;

use gpui_kit::{
    App, AppContext as _, Modifiers, TestAppContext, VisualTestContext, point, px, size,
};
use serde_json::Value;

use super::super::{TallTableEvent, TallTableState};
use crate::column::{ColumnKind, TallTableColumn};
use crate::delegate::{CellValue, PageLoad, TallTableDelegate, TallTablePage};
use crate::reorder::{Control, Move};

const REORDER: &str = include_str!("../../../fixtures/reorder.json");

// --- reorder.json ---

/// `selection` as the fixture spells it (`select`), `None` for `null`.
#[cfg(feature = "select")]
fn selection_of(value: &Value) -> Option<crate::TallTableSelection> {
    use crate::selection::Kind;
    if value.is_null() {
        return None;
    }
    let kind = Kind::parse(value["kind"].as_str().expect("kind")).expect("a kind");
    let cell = |cell: &Value| {
        (
            cell[0].as_u64().expect("a row"),
            cell[1].as_u64().expect("a column") as usize,
        )
    };
    Some(crate::TallTableSelection::new(
        kind,
        cell(&value["anchor"]),
        cell(&value["head"]),
    ))
}

fn control_of(name: Option<&str>) -> Control {
    match name {
        None => Control::None,
        Some("count-kept") => Control::CountKept,
        Some("recount") => Control::Recount,
        Some("selection-unmoved") => Control::SelectionUnmoved,
        Some(name) => panic!("no control {name}"),
    }
}

/// What the fixture's move cases expect that the rules don't give, by
/// case, under `control` (one of its `controls`, or none). Without
/// `select`, the selections aren't checked.
fn mismatches(control: Option<&str>) -> Vec<(String, String)> {
    let fixture: Value = serde_json::from_str(REORDER).expect("reorder.json");
    let control = control_of(control);
    let mut mismatches = Vec::new();
    for case in fixture["moves"].as_array().expect("moves") {
        let name = case["name"].as_str().expect("name").to_string();
        let number = |key: &str| case[key].as_u64().expect(key) as usize;
        let (columns, to, count) = (number("columns"), number("to"), number("count"));
        let block = &case["block"];
        let first = block[0].as_u64().expect("first") as usize;
        let last = block[1].as_u64().expect("last") as usize;
        let side = match case["side"].as_str() {
            None => None,
            Some("pinned") => Some(true),
            Some("scrolled") => Some(false),
            Some(side) => panic!("no side {side}"),
        };
        let mv = Move {
            places: first..last + 1,
            to,
        };
        // The order and count after, `None` for no move: as the table's
        // `move_block` decides it, from the rules.
        let moved = mv.moves(columns, count, side, control);
        let order: Vec<usize> = (0..columns).collect();
        let got_order = moved.map(|_| mv.order_after(&order));
        let got_count = moved.unwrap_or(count);
        let expect = &case["expect"];
        let want_order: Option<Vec<usize>> = expect["order"].as_array().map(|order| {
            order
                .iter()
                .map(|index| index.as_u64().expect("an index") as usize)
                .collect()
        });
        let mut check = |what: &str, got: String, want: String| {
            if got != want {
                mismatches.push((name.clone(), format!("{what} {got}; the fixture's {want}")));
            }
        };
        check("order", format!("{got_order:?}"), format!("{want_order:?}"));
        check(
            "count",
            got_count.to_string(),
            expect["count"].as_u64().expect("count").to_string(),
        );
        #[cfg(feature = "select")]
        {
            let before = selection_of(&case["selection"]);
            let after = match moved {
                Some(_) => before.and_then(|selection| mv.selection_after(selection, control)),
                None => before,
            };
            check(
                "selection",
                format!("{after:?}"),
                format!("{:?}", selection_of(&expect["selection"])),
            );
        }
    }
    mismatches
}

#[test]
fn reorder_fixture() {
    let mismatches = mismatches(None);
    assert!(mismatches.is_empty(), "{mismatches:#?}");
}

/// Each control fails every case it names (the selection's only with
/// `select`, which checks them).
#[test]
fn reorder_controls_fail() {
    let fixture: Value = serde_json::from_str(REORDER).expect("reorder.json");
    let controls = fixture["controls"].as_array().expect("controls");
    assert_eq!(controls.len(), 3);
    for control in controls {
        let name = control["name"].as_str().expect("name");
        if name == "selection-unmoved" && !cfg!(feature = "select") {
            continue;
        }
        let failed = mismatches(Some(name));
        let fails = control["fails"].as_array().expect("fails");
        assert!(!fails.is_empty(), "{name} names no case");
        for case in fails {
            let case = case.as_str().expect("a case");
            assert!(
                failed.iter().any(|(failed, _)| failed == case),
                "the {name} control passed {case}"
            );
        }
    }
}

// --- in a window ---

/// A cell's text: its row and its column's index, and the source's version
/// when read (bumped by [`Sheet::change`]). Column 1's is long, so it's cut
/// in its 200 px and a rested hover shows a tooltip.
fn value_text(row: u64, column: usize, version: u32) -> String {
    let tail = if column == 1 {
        " and a tail far too long for its cell"
    } else {
        ""
    };
    format!("r{row}c{column}v{version}{tail}")
}

/// [`value_text`]'s row and column, read back from a drawn text.
fn parse_value(text: &str) -> Option<(u64, usize)> {
    let text = text.strip_prefix('r')?;
    let (row, text) = text.split_once('c')?;
    let (column, _) = text.split_once('v')?;
    Some((row.parse().ok()?, column.parse().ok()?))
}

/// Rows from memory, at the source's version when read; read at once,
/// counted; every sort accepted and counted (`sort`).
#[derive(Clone, Default)]
struct Memory {
    version: Rc<Cell<u32>>,
    reads: Rc<Cell<usize>>,
    #[cfg(feature = "sort")]
    sorts: Rc<Cell<usize>>,
}

struct Rows {
    rows: Range<u64>,
    version: u32,
}

impl TallTablePage for Rows {
    fn value(&self, row: usize, column: usize) -> Option<CellValue<'_>> {
        let row = self.rows.start + row as u64;
        Some(CellValue::Text(
            value_text(row, column, self.version).into(),
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
        self.reads.set(self.reads.get() + 1);
        let version = self.version.get();
        (
            rows.start,
            Box::pin(std::future::ready(Ok(Rows { rows, version }))),
        )
    }

    fn cancel(&mut self, _: u64, _: &mut App) {}

    #[cfg(feature = "sort")]
    fn sort(&mut self, _: Option<crate::Sort>, _: &mut App) -> Result<(), crate::SortRefused> {
        self.sorts.set(self.sorts.get() + 1);
        Ok(())
    }
}

/// The columns' kinds, by index: each a width of its own (120, 200, 104,
/// 184 px), so a moved layout shows whose width a place has, each wide
/// enough for a visible row's text uncut (but column 1's tail).
const KINDS: [ColumnKind; 4] = [
    ColumnKind::Float,
    ColumnKind::Text,
    ColumnKind::Date,
    ColumnKind::Timestamp,
];

/// Each kind's width, by index.
const WIDTHS: [f32; 4] = [120.0, 200.0, 104.0, 184.0];

fn columns() -> Vec<TallTableColumn> {
    KINDS
        .iter()
        .enumerate()
        .map(|(index, kind)| {
            let column = TallTableColumn::new(format!("c{index}"), *kind);
            #[cfg(feature = "sort")]
            let column = column.sortable(true);
            #[cfg(all(feature = "live", feature = "custom-cells"))]
            let column = if index == 2 {
                column.flash(
                    crate::Ramp::new(&[|theme| theme.background, |theme| theme.chart_1]),
                    Duration::from_secs(1),
                )
            } else {
                column
            };
            column
        })
        .collect()
}

type Table = TallTableState<Memory>;

/// A table in a 1440×900 window over `rows` rows from memory, its events
/// (but the probes', the scrollbar's, and `Filled`) kept.
struct Sheet<'a> {
    cx: &'a mut VisualTestContext,
    table: gpui_kit::Entity<Table>,
    source: Memory,
    events: Rc<RefCell<Vec<TallTableEvent>>>,
    /// The drawn cells' probes, the last frame's (`probe_cells`).
    cells: Rc<RefCell<Vec<crate::CellProbe>>>,
}

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

impl<'a> Sheet<'a> {
    fn open(cx: &'a mut TestAppContext, rows: u64) -> Self {
        cx.update(|cx| {
            gpui_kit::component::init(cx);
            crate::init(cx);
        });
        let source = Memory::default();
        let events: Rc<RefCell<Vec<TallTableEvent>>> = Rc::default();
        let cells: Rc<RefCell<Vec<crate::CellProbe>>> = Rc::default();
        let (heard, drawn, delegate) = (events.clone(), cells.clone(), source.clone());
        let (shell, cx) = cx.add_window_view(move |_, cx| {
            let table = cx.new(|cx| {
                TallTableState::new(delegate, columns(), rows, Default::default(), cx)
                    .probe_cells(true)
            });
            let subscription =
                cx.subscribe(&table, move |_, _, event: &TallTableEvent, _| match event {
                    TallTableEvent::Cells(cells) => *drawn.borrow_mut() = cells.clone(),
                    TallTableEvent::Probe(_)
                    | TallTableEvent::Layout(_)
                    | TallTableEvent::Scrollbar { .. }
                    | TallTableEvent::Filled { .. } => {}
                    event => heard.borrow_mut().push(event.clone()),
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
            source,
            events,
            cells,
        };
        sheet.draw();
        sheet.events.borrow_mut().clear();
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

    /// The events heard since the last call.
    fn heard(&mut self) -> Vec<TallTableEvent> {
        std::mem::take(&mut *self.events.borrow_mut())
    }

    /// The orders `ColumnsMoved` reported since the last call (and every
    /// other event heard dropped).
    fn moved(&mut self) -> Vec<Vec<usize>> {
        self.heard()
            .into_iter()
            .filter_map(|event| match event {
                TallTableEvent::ColumnsMoved { order, .. } => Some(order),
                _ => None,
            })
            .collect()
    }

    fn move_columns(&mut self, places: Range<usize>, to: usize) {
        self.update(|table, cx| table.move_columns(places, to, cx));
    }

    fn set_order(&mut self, order: &[usize]) {
        let order = order.to_vec();
        self.update(|table, cx| table.set_order(order, cx));
    }

    /// Every drawn cell's text is its column's index's value, and it's
    /// drawn at its place's left, `order` the order in effect.
    fn check_cells(&mut self, order: &[usize]) {
        assert_eq!(self.read(|table| table.order().to_vec()), order);
        let (origin, gutter, scroll_x, lefts) = self.read(|table| {
            (
                table.body.origin.x,
                table.gutter_width(),
                table.scroll_x,
                table
                    .columns
                    .iter()
                    .map(|column| column.x)
                    .collect::<Vec<_>>(),
            )
        });
        // Each place's width is its column's kind's.
        let widths = self.read(|table| {
            table
                .columns
                .iter()
                .map(|column| column.width)
                .collect::<Vec<_>>()
        });
        let want: Vec<f32> = order.iter().map(|&index| WIDTHS[index]).collect();
        assert_eq!(widths, want, "each place has its column's width");
        let drawn = self.read(|table| table.drawn_text.borrow().clone());
        assert!(!drawn.is_empty(), "cells drawn");
        for cell in drawn {
            let (row, column) = parse_value(&cell.text)
                .unwrap_or_else(|| panic!("{:?} isn't a cell's text", cell.text));
            assert_eq!((row, column), (cell.row, cell.column), "{:?}", cell.text);
            let place = order
                .iter()
                .position(|&index| index == column)
                .expect("drawn at a place");
            let left = f32::from(origin) + gutter + lefts[place] - scroll_x;
            assert!(
                (f32::from(cell.cell.origin.x) - left).abs() <= 1.0,
                "column {column} at place {place}: drawn at {:?}, its left {left}",
                cell.cell.origin.x
            );
        }
        // The cell probe names the place; its text is the column's.
        for probe in self.cells.borrow().iter() {
            let (_, column) = parse_value(&probe.exact).expect("a cell's text");
            assert_eq!(column, order[probe.column], "the probe's place's column");
        }
    }
}

#[gpui_kit::test]
fn each_cell_is_its_columns_at_its_place(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, 1000);
    sheet.check_cells(&[0, 1, 2, 3]);
    let reads = sheet.source.reads.get();
    sheet.set_order(&[3, 2, 1, 0]);
    sheet.check_cells(&[3, 2, 1, 0]);
    sheet.move_columns(0..1, 2);
    sheet.check_cells(&[2, 1, 3, 0]);
    // A block of two, left.
    sheet.move_columns(2..4, 0);
    sheet.check_cells(&[3, 0, 2, 1]);
    assert_eq!(sheet.source.reads.get(), reads, "a move reads nothing");
    // The layout probe names each place's index.
    let layout = sheet.read(|table| {
        table
            .columns
            .iter()
            .enumerate()
            .map(|(place, column)| column.index(place))
            .collect::<Vec<_>>()
    });
    assert_eq!(layout, [3, 0, 2, 1]);
}

#[gpui_kit::test]
fn the_tooltip_reads_its_columns_own(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, 1000);
    sheet.set_order(&[3, 2, 1, 0]);
    // Column 1, the long one, at place 2.
    let at = sheet.read(|table| {
        let left = table.columns[2].x + 20.0;
        table.body.origin + point(px(table.gutter_width() + left), px(45.))
    });
    sheet.cx.simulate_mouse_move(at, None, Modifiers::default());
    sheet.draw();
    assert_eq!(
        sheet.read(|table| table.hover.as_ref().map(|hover| (hover.row, hover.column))),
        Some((1, 2)),
        "the hover is by place"
    );
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
            .map(|(text, _)| text.to_string())
    });
    assert_eq!(tooltip, Some(value_text(1, 1, 0)), "column 1's own value");
}

#[gpui_kit::test]
fn set_columns_resets_the_order(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, 1000);
    sheet.set_order(&[1, 0, 3, 2]);
    sheet.update(|table, cx| table.set_columns(columns(), cx));
    sheet.check_cells(&[0, 1, 2, 3]);
    let moved = sheet.moved();
    assert_eq!(moved, [vec![1, 0, 3, 2]], "set_columns emits no move");
}

#[gpui_kit::test]
fn a_move_that_changes_nothing_emits_nothing(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, 1000);
    // Not a permutation: refused, nothing changed.
    for order in [vec![0, 1, 2], vec![0, 1, 2, 2], vec![0, 1, 2, 4], vec![]] {
        sheet.set_order(&order);
    }
    // The order in effect, a block to its own place, an empty block, a
    // block past the columns, a `to` past the end.
    sheet.set_order(&[0, 1, 2, 3]);
    sheet.move_columns(1..3, 1);
    sheet.move_columns(2..2, 0);
    sheet.move_columns(3..5, 0);
    sheet.move_columns(2..4, 3);
    sheet.check_cells(&[0, 1, 2, 3]);
    assert_eq!(sheet.moved(), Vec::<Vec<usize>>::new());
    // A change: one event, with the order after.
    sheet.move_columns(0..1, 3);
    assert_eq!(sheet.moved(), [vec![1, 2, 3, 0]]);
    sheet.set_order(&[3, 2, 1, 0]);
    assert_eq!(sheet.moved(), [vec![3, 2, 1, 0]]);
}

/// The sideways scroll is kept, clamped to the content after.
#[gpui_kit::test]
fn a_move_keeps_the_sideways_scroll(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, 1000);
    sheet.cx.simulate_resize(size(px(400.), px(900.)));
    sheet.draw();
    sheet.update(|table, cx| table.scroll_by(0.0, 80.0, cx));
    sheet.move_columns(0..1, 3);
    assert_eq!(sheet.read(|table| table.scroll_x), 80.0);
    sheet.check_cells(&[1, 2, 3, 0]);
}

/// The fit reads its column's own values, and the widths event stays in
/// index order (`resize`).
#[cfg(feature = "resize")]
#[gpui_kit::test]
fn the_fit_and_the_widths_are_by_index(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, 1000);
    sheet.set_order(&[3, 2, 1, 0]);
    sheet.heard();
    // Column 1 (its long text) at place 2.
    sheet.cx.update(|window, cx| {
        sheet
            .table
            .update(cx, |table, cx| table.fit_column(2, window, cx))
    });
    sheet.draw();
    let widths = sheet
        .heard()
        .into_iter()
        .find_map(|event| match event {
            TallTableEvent::ColumnWidthsChanged(widths) => Some(widths),
            _ => None,
        })
        .expect("the fit changed a width");
    assert_eq!(widths.len(), 4);
    assert!(
        widths[1].is_some_and(|width| f32::from(width) > 200.0),
        "column 1 fitted to its long text: {widths:?}"
    );
    assert!(
        [0, 2, 3].iter().all(|&index| widths[index].is_none()),
        "the others are their kinds': {widths:?}"
    );
    assert_eq!(
        sheet.read(|table| table.column_width(1)),
        widths[1],
        "column_width is by index"
    );
    assert_eq!(sheet.read(|table| table.column_width(2)), Some(px(104.)));
    // A drag at place 0's band (column 3) narrows column 3.
    let (band, y) = sheet.read(|table| {
        let edge = table.body.origin.x + px(table.gutter_width() + table.columns[0].width);
        (edge, table.body.origin.y - px(10.))
    });
    sheet.cx.simulate_event(gpui_kit::MouseDownEvent {
        position: point(band, y),
        modifiers: Modifiers::default(),
        button: gpui_kit::MouseButton::Left,
        click_count: 1,
        first_mouse: false,
    });
    sheet.draw();
    assert_eq!(
        sheet.read(|table| table.resizing.map(|resizing| resizing.column)),
        Some(3),
        "the drag holds column 3's index"
    );
    // A move during the drag leaves it on its column.
    sheet.move_columns(0..1, 3);
    sheet.cx.simulate_mouse_move(
        point(band - px(30.), y),
        gpui_kit::MouseButton::Left,
        Modifiers::default(),
    );
    sheet.draw();
    sheet.cx.simulate_event(gpui_kit::MouseUpEvent {
        position: point(band - px(30.), y),
        modifiers: Modifiers::default(),
        button: gpui_kit::MouseButton::Left,
        click_count: 1,
    });
    sheet.draw();
    let widths = sheet
        .heard()
        .into_iter()
        .filter_map(|event| match event {
            TallTableEvent::ColumnWidthsChanged(widths) => Some(widths),
            _ => None,
        })
        .next_back()
        .expect("the drag changed a width");
    assert_eq!(
        widths[3],
        Some(px(154.)),
        "column 3, 184 less 30: {widths:?}"
    );
}

/// The selection follows a move (`select`): `Selected` at each change of
/// its places, `None` only when it's cleared.
#[cfg(feature = "select")]
#[gpui_kit::test]
fn the_selection_follows_a_move(cx: &mut TestAppContext) {
    use crate::TallTableSelection;

    let mut sheet = Sheet::open(cx, 1000);
    let selected = |sheet: &mut Sheet| -> Vec<Option<TallTableSelection>> {
        sheet
            .heard()
            .into_iter()
            .filter_map(|event| match event {
                TallTableEvent::Selected(selection) => Some(selection),
                _ => None,
            })
            .collect()
    };
    let columns = |anchor: usize, head: usize| TallTableSelection::Columns {
        anchor: (0, anchor),
        head: (0, head),
    };
    sheet.update(|table, cx| table.select(Some(columns(1, 2)), cx));
    selected(&mut sheet);
    // Inside the block moved: it moves with it.
    sheet.move_columns(1..3, 2);
    assert_eq!(selected(&mut sheet), [Some(columns(2, 3))]);
    // Outside the places a move shifts: kept, no event.
    sheet.move_columns(0..1, 1);
    assert_eq!(
        selected(&mut sheet),
        Vec::<Option<TallTableSelection>>::new()
    );
    assert_eq!(sheet.read(|table| table.selection()), Some(columns(2, 3)));
    // Inside them: shifted (places 1..3 shift left by one as place 0 goes
    // to 3, so 2..3 are 1..2).
    sheet.move_columns(0..1, 3);
    assert_eq!(selected(&mut sheet), [Some(columns(1, 2))]);
    // Holding the block and every place it shifts: kept in place.
    sheet.update(|table, cx| table.select(Some(columns(0, 3)), cx));
    selected(&mut sheet);
    sheet.move_columns(0..1, 3);
    assert_eq!(
        selected(&mut sheet),
        Vec::<Option<TallTableSelection>>::new()
    );
    assert_eq!(sheet.read(|table| table.selection()), Some(columns(0, 3)));
    // Split: cleared.
    sheet.update(|table, cx| table.select(Some(columns(1, 2)), cx));
    selected(&mut sheet);
    sheet.move_columns(2..3, 0);
    assert_eq!(selected(&mut sheet), [None]);
    // A `Rows` selection stays through a move and `set_order`; a `Cells`
    // one is cleared by `set_order`.
    let rows = TallTableSelection::Rows {
        anchor: (3, 1),
        head: (5, 1),
    };
    sheet.update(|table, cx| table.select(Some(rows), cx));
    selected(&mut sheet);
    sheet.move_columns(0..2, 2);
    sheet.set_order(&[0, 1, 2, 3]);
    assert_eq!(
        selected(&mut sheet),
        Vec::<Option<TallTableSelection>>::new()
    );
    assert_eq!(sheet.read(|table| table.selection()), Some(rows));
    let cells = TallTableSelection::Cells {
        anchor: (3, 1),
        head: (5, 2),
    };
    sheet.update(|table, cx| table.select(Some(cells), cx));
    selected(&mut sheet);
    sheet.set_order(&[3, 2, 1, 0]);
    assert_eq!(selected(&mut sheet), [None]);
}

/// A move across `pin`'s edge pins or unpins what crossed; `set_order`
/// keeps the count by place; the cap still applies.
#[cfg(feature = "pin")]
#[gpui_kit::test]
fn a_move_across_the_edge_pins_and_unpins(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, 1000);
    let pins = |sheet: &mut Sheet| -> (Vec<usize>, Vec<(Vec<usize>, usize)>) {
        let (mut pinned, mut moved) = (Vec::new(), Vec::new());
        for event in sheet.heard() {
            match event {
                TallTableEvent::Pinned(columns) => pinned.push(columns),
                TallTableEvent::ColumnsMoved { order, pinned } => moved.push((order, pinned)),
                _ => {}
            }
        }
        (pinned, moved)
    };
    sheet.update(|table, cx| table.set_pinned(1, cx));
    pins(&mut sheet);
    // Into the run: pinned, the count up by the block's length.
    sheet.move_columns(2..4, 0);
    assert_eq!(sheet.read(|table| table.pinned()), 3);
    assert_eq!(
        pins(&mut sheet),
        (vec![3], vec![(vec![2, 3, 0, 1], 3)]),
        "Pinned, then ColumnsMoved with the count"
    );
    // Within the run: the count kept.
    sheet.move_columns(0..1, 2);
    assert_eq!(sheet.read(|table| table.pinned()), 3);
    // Out of it: unpinned.
    sheet.move_columns(0..1, 3);
    assert_eq!(
        sheet.read(|table| (table.pinned(), table.pinned_in_effect())),
        (2, 2)
    );
    // At the run's end, by `move_columns`: the block's first column's side.
    sheet.move_columns(3..4, 2);
    assert_eq!(sheet.read(|table| table.pinned()), 2, "it was scrolled");
    // By `move_columns_pinned`: the argument's; a column beside the edge
    // pinned and unpinned without moving.
    sheet.update(|table, cx| table.move_columns_pinned(2..3, 2, true, cx));
    assert_eq!(sheet.read(|table| table.pinned()), 3);
    let order = sheet.read(|table| table.order().to_vec());
    sheet.update(|table, cx| table.move_columns_pinned(2..3, 2, false, cx));
    assert_eq!(sheet.read(|table| table.pinned()), 2);
    assert_eq!(
        sheet.read(|table| table.order().to_vec()),
        order,
        "no column moved"
    );
    // The other side from `to`: nothing.
    pins(&mut sheet);
    sheet.update(|table, cx| table.move_columns_pinned(3..4, 0, false, cx));
    assert_eq!(pins(&mut sheet), (vec![], vec![]));
    // A count past the columns is kept when nothing crosses.
    sheet.update(|table, cx| table.set_pinned(9, cx));
    sheet.move_columns(0..1, 2);
    assert_eq!(sheet.read(|table| table.pinned()), 9);
    // `set_order` keeps the count as places.
    sheet.update(|table, cx| table.set_pinned(2, cx));
    sheet.set_order(&[3, 2, 1, 0]);
    assert_eq!(
        sheet.read(|table| (table.pinned(), table.pinned_in_effect())),
        (2, 2)
    );
    // The cap: in a 400 px view, column 0 (120 px) pins; column 1 (200 px)
    // moved into the run before it pins in count, not in effect: its
    // 200 px pass the half.
    sheet.update(|table, cx| table.set_pinned(1, cx));
    sheet.set_order(&[0, 1, 2, 3]);
    sheet.cx.simulate_resize(size(px(400.), px(900.)));
    sheet.draw();
    let cells_width = sheet.read(|table| table.cells_width());
    assert!(
        (120.0..200.0).contains(&(cells_width / 2.0)),
        "{cells_width}"
    );
    assert_eq!(sheet.read(|table| table.pinned_in_effect()), 1);
    pins(&mut sheet);
    sheet.move_columns(1..2, 0);
    assert_eq!(
        sheet.read(|table| (table.pinned(), table.pinned_in_effect())),
        (2, 0)
    );
    assert_eq!(
        pins(&mut sheet),
        (vec![0], vec![(vec![1, 0, 2, 3], 2)]),
        "Pinned with the run in effect, ColumnsMoved with the count"
    );
}

/// The sort and its arrow stay on their column; the source is told
/// nothing (`sort`).
#[cfg(feature = "sort")]
#[gpui_kit::test]
fn the_sort_stays_on_its_column(cx: &mut TestAppContext) {
    use crate::{Sort, SortDirection};

    let mut sheet = Sheet::open(cx, 1000);
    let sort = Sort::new(2, SortDirection::Ascending);
    sheet.update(|table, cx| table.set_sort(Some(sort), cx).expect("sorted"));
    let sorts = sheet.source.sorts.get();
    sheet.move_columns(2..3, 0);
    assert_eq!(sheet.read(|table| table.sort()), Some(sort));
    assert_eq!(sheet.source.sorts.get(), sorts, "the source told nothing");
    let drawn = sheet.read(|table| table.sort_state.drawn.clone());
    let sorted = drawn
        .iter()
        .find(|arrow| arrow.column == 2)
        .expect("column 2's arrow");
    assert_eq!(
        sorted.arrow,
        super::super::sort::Arrow::Glyph(super::super::sort::ARROWS[0])
    );
    // At place 0: its target is within its 104 px.
    let left = sheet.read(|table| table.body.origin.x + px(table.gutter_width()));
    assert!(
        sorted.target.origin.x < left + px(104.),
        "column 2's arrow at place 0: {:?}",
        sorted.target
    );
    assert!(
        drawn
            .iter()
            .filter(|arrow| arrow.column != 2)
            .all(|arrow| arrow.arrow
                == super::super::sort::Arrow::Glyph(super::super::sort::ARROWS[2])),
        "the others unsorted"
    );
}

/// A copy started before a move writes the columns it started with, in
/// that order (`copy`).
#[cfg(feature = "copy")]
#[gpui_kit::test]
fn a_copy_keeps_the_columns_it_started_with(cx: &mut TestAppContext) {
    use crate::{CopyOptions, TallTableCopy, TallTableSelection};

    // Past the pages loaded, so the copy reads.
    let mut sheet = Sheet::open(cx, 10_000);
    sheet.update(|table, _| table.set_copy_options(CopyOptions::default().headers(true)));
    sheet.set_order(&[3, 0, 2, 1]);
    sheet.update(|table, cx| {
        table.select(
            Some(TallTableSelection::Columns {
                anchor: (0, 2),
                head: (0, 3),
            }),
            cx,
        );
    });
    sheet.heard();
    // Started at places 2..3 (columns 2 and 1), then moved in the same
    // update: the first turn ran, the rest come after the move.
    sheet.update(|table, cx| {
        table.copy(cx).expect("a copy");
        assert!(table.copying().is_some(), "still copying");
        table.move_columns(0..2, 2, cx);
    });
    sheet.draw();
    let mut text = String::new();
    let mut copied = false;
    for event in sheet.heard() {
        if let TallTableEvent::Copy(copy) = event {
            match copy {
                TallTableCopy::Text { text: piece, .. } => text.push_str(&piece),
                TallTableCopy::Copied { .. } => copied = true,
                TallTableCopy::Failed { reason, .. } => panic!("failed: {reason:?}"),
                _ => {}
            }
        }
    }
    assert!(copied, "the copy ended");
    let mut lines = text.split('\n');
    assert_eq!(lines.next(), Some("c2\tc1"), "the header as it started");
    for (row, line) in lines.enumerate() {
        assert_eq!(
            line,
            format!(
                "{}\t{}",
                value_text(row as u64, 2, 0),
                value_text(row as u64, 1, 0)
            ),
            "row {row}"
        );
    }
    assert_eq!(sheet.read(|table| table.order().to_vec()), [2, 1, 3, 0]);
}

/// A flash stays on its cell: it's keyed by the column's index (`live`
/// with `custom-cells`).
#[cfg(all(feature = "live", feature = "custom-cells"))]
#[gpui_kit::test]
fn a_flash_stays_on_its_cell(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, 1000);
    // Every value changes; column 2 alone flashes.
    sheet.source.version.set(1);
    sheet.update(|table, cx| {
        table.invalidate_rows(3..4, cx);
    });
    sheet.draw();
    let flashed = |sheet: &mut Sheet| -> Vec<usize> {
        sheet
            .cells
            .borrow()
            .iter()
            .filter(|cell| cell.row == 3 && cell.paint.flash.is_some())
            .map(|cell| cell.column)
            .collect()
    };
    assert_eq!(flashed(&mut sheet), [2], "drawn at place 2");
    sheet.move_columns(2..3, 0);
    assert_eq!(flashed(&mut sheet), [0], "column 2, now at place 0");
    sheet.check_cells(&[2, 0, 1, 3]);
}
