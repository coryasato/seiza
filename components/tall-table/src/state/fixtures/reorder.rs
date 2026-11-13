//! `reorder`: `fixtures/reorder.json`'s move cases run against the move's
//! own rules ([`crate::reorder::Move`]) and its gap cases against the
//! drag's ([`crate::reorder::gap`]), with their negative controls, and
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
    App, AppContext as _, KeyBinding, Modifiers, MouseButton, MouseDownEvent, Pixels, Point,
    ScrollDelta, ScrollEvent, ScrollSource, TestAppContext, TouchPhase, VisualTestContext, point,
    px, size,
};
use serde_json::Value;

use super::super::{TallTableEvent, TallTableState};
use crate::column::{CellKind, ColumnKind, LaidOutColumn, TallTableColumn};
use crate::delegate::{CellValue, PageLoad, TallTableDelegate, TallTablePage};
use crate::reorder::{Control, Move, View, gap};

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
        Some("gap-by-left-edge") => Control::GapByLeftEdge,
        Some("beside-the-block") => Control::BesideTheBlock,
        Some("no-edge-gap") => Control::NoEdgeGap,
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
    mismatches.extend(gap_mismatches(&fixture, control));
    mismatches
}

/// Columns laid out side by side at `widths`, in the list's order.
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
                #[cfg(feature = "format")]
                format: None,
                index,
            };
            x += width;
            column
        })
        .collect()
}

/// Whether this build runs `case` (its `features` all on).
fn runs(case: &Value) -> bool {
    case["features"].as_array().is_none_or(|features| {
        features.iter().all(|feature| match feature.as_str() {
            Some("pin") => cfg!(feature = "pin"),
            feature => panic!("no feature {feature:?}"),
        })
    })
}

/// What the fixture's gap cases expect that the drag's rule doesn't give,
/// under `control`. The run in effect is `pin`'s own (`crate::pin`), from
/// the count, the widths, and the cells' width.
fn gap_mismatches(fixture: &Value, control: Control) -> Vec<(String, String)> {
    let mut mismatches = Vec::new();
    for case in fixture["gaps"].as_array().expect("gaps") {
        if !runs(case) {
            continue;
        }
        let name = case["name"].as_str().expect("name").to_string();
        let float = |key: &str| case[key].as_f64().expect(key) as f32;
        let widths: Vec<f32> = case["widths"]
            .as_array()
            .expect("widths")
            .iter()
            .map(|width| width.as_f64().expect("a width") as f32)
            .collect();
        let columns = laid_out(&widths);
        let cells_width = float("cells_width");
        let count = case["count"].as_u64().expect("count") as usize;
        #[cfg(feature = "pin")]
        let (run, edge) = {
            let run = crate::pin::in_effect(&columns, count, cells_width);
            let pin = crate::pin::Pin::new(&columns, run, cells_width);
            (run, pin.edge())
        };
        #[cfg(not(feature = "pin"))]
        let (run, edge) = (0, 0.0);
        let block = &case["block"];
        let first = block[0].as_u64().expect("first") as usize;
        let last = block[1].as_u64().expect("last") as usize;
        let got = gap(
            View {
                columns: &columns,
                cells_width,
                scroll_x: float("scroll_x"),
                run,
                edge,
            },
            count,
            first..last + 1,
            float("x"),
            control,
        )
        .map(|gap| {
            (
                gap.at,
                gap.to,
                if gap.pinned { "pinned" } else { "scrolled" },
            )
        });
        let expect = &case["expect"];
        let want = expect["gap"].as_u64().map(|at| {
            (
                at as usize,
                expect["to"].as_u64().expect("to") as usize,
                expect["side"].as_str().expect("side"),
            )
        });
        if got != want {
            mismatches.push((name, format!("gap {got:?}; the fixture's {want:?}")));
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
    assert_eq!(controls.len(), 6);
    // A control names a case, so no two share a name.
    let mut names: Vec<&str> = fixture["moves"]
        .as_array()
        .expect("moves")
        .iter()
        .chain(fixture["gaps"].as_array().expect("gaps"))
        .map(|case| case["name"].as_str().expect("name"))
        .collect();
    let all = names.len();
    names.sort_unstable();
    names.dedup();
    assert_eq!(names.len(), all, "a case's name used twice");
    // The cases this build runs, by name.
    let run: Vec<&str> = fixture["moves"]
        .as_array()
        .expect("moves")
        .iter()
        .chain(fixture["gaps"].as_array().expect("gaps"))
        .filter(|case| runs(case))
        .map(|case| case["name"].as_str().expect("name"))
        .collect();
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
            if !run.contains(&case) {
                continue;
            }
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

gpui_kit::actions!(reorder_fixture, [HostEscape]);

/// A table in a 1440×900 window over `rows` rows from memory, its events
/// (but the probes', the scrollbar's, and `Filled`) kept.
struct Sheet<'a> {
    cx: &'a mut VisualTestContext,
    table: gpui_kit::Entity<Table>,
    source: Memory,
    events: Rc<RefCell<Vec<TallTableEvent>>>,
    /// The drawn cells' probes, the last frame's (`probe_cells`).
    cells: Rc<RefCell<Vec<crate::CellProbe>>>,
    /// The Escapes the table let through to the host.
    escapes: Rc<Cell<usize>>,
    /// The table's notifications.
    notified: Rc<Cell<usize>>,
    /// The pointer's last position.
    pointer: Point<Pixels>,
    _observer: gpui_kit::Subscription,
}

/// The window's view: the table's element in a context of its own, whose
/// Escape binding counts what the table lets through; the table
/// subscribed to as it's made.
struct Shell {
    table: gpui_kit::Entity<Table>,
    escapes: Rc<Cell<usize>>,
    _subscription: gpui_kit::Subscription,
}

impl gpui_kit::Render for Shell {
    fn render(
        &mut self,
        _: &mut gpui_kit::Window,
        cx: &mut gpui_kit::Context<Self>,
    ) -> impl gpui_kit::IntoElement {
        use gpui_kit::{InteractiveElement as _, ParentElement as _, Styled as _};
        gpui_kit::div()
            .key_context("Host")
            .on_action(cx.listener(|this, _: &HostEscape, _, _| {
                this.escapes.set(this.escapes.get() + 1);
            }))
            .size_full()
            .child(crate::TallTable::new(&self.table))
    }
}

impl<'a> Sheet<'a> {
    fn open(cx: &'a mut TestAppContext, rows: u64) -> Self {
        cx.update(|cx| {
            gpui_kit::component::init(cx);
            crate::init(cx);
            cx.bind_keys([KeyBinding::new("escape", HostEscape, Some("Host"))]);
        });
        let escapes: Rc<Cell<usize>> = Rc::default();
        let host_escapes = escapes.clone();
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
                escapes: host_escapes,
                _subscription: subscription,
            }
        });
        let table = shell.read_with(cx, |shell, _| shell.table.clone());
        cx.simulate_resize(size(px(1440.), px(900.)));
        let notified: Rc<Cell<usize>> = Rc::default();
        let observer = cx.update(|_, cx| {
            let notified = notified.clone();
            cx.observe(&table, move |_, _| notified.set(notified.get() + 1))
        });
        let mut sheet = Self {
            cx,
            table,
            source,
            events,
            cells,
            escapes,
            notified,
            pointer: point(px(0.), px(0.)),
            _observer: observer,
        };
        sheet.draw();
        let handle = sheet.read(|table| table.focus_handle.clone());
        sheet.cx.update(|window, cx| window.focus(&handle, cx));
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
    assert_eq!(
        moved,
        [vec![1, 0, 3, 2], vec![0, 1, 2, 3]],
        "set_columns emits the list's own order it reset to"
    );
    // Already the list's own: nothing changed, nothing emitted.
    sheet.update(|table, cx| table.set_columns(columns(), cx));
    assert!(
        sheet.moved().is_empty(),
        "set_columns over the list's own emits no move"
    );
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

// --- the drag ---

impl Sheet<'_> {
    /// Where a header is in window pixels: `place`'s, `dx` from its center
    /// (`None`: `x` px into the cells area), in the header's row.
    fn header(&mut self, place: usize) -> Point<Pixels> {
        self.read(|table| {
            let column = &table.columns[place];
            let x = table.place().left(place, column.x, table.scroll_x) + column.width / 2.0;
            let row_h = f32::from(table.sizes().row());
            table.body.origin + point(px(table.gutter_width() + x), px(-row_h / 2.0))
        })
    }

    /// `x` px into the cells area, level with the header.
    fn over(&mut self, x: f32) -> Point<Pixels> {
        self.read(|table| {
            let row_h = f32::from(table.sizes().row());
            table.body.origin + point(px(table.gutter_width() + x), px(-row_h / 2.0))
        })
    }

    fn press_at(&mut self, at: Point<Pixels>, modifiers: Modifiers) {
        self.pointer = at;
        self.cx.simulate_event(MouseDownEvent {
            position: at,
            modifiers,
            button: MouseButton::Left,
            click_count: 1,
            first_mouse: false,
        });
        self.draw();
    }

    fn press(&mut self, at: Point<Pixels>) {
        self.press_at(at, Modifiers::default());
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

    /// A sideways wheel of `px` px at the pointer (positive: the content
    /// moves left, the view right).
    fn wheel_sideways(&mut self, by: f32) {
        self.cx.simulate_event(ScrollEvent {
            position: self.pointer,
            delta: ScrollDelta::Pixels(point(px(-by), px(0.))),
            modifiers: Modifiers::default(),
            touch_phase: TouchPhase::Moved,
            source: ScrollSource::Pointer,
        });
        self.draw();
    }

    fn key(&mut self, keys: &str) {
        self.cx.simulate_keystrokes(keys);
        self.draw();
    }

    fn moving(&mut self) -> bool {
        self.read(|table| table.is_moving())
    }

    /// The gap's place and the line drawn in the header and the body.
    fn gap(&mut self) -> Option<(usize, [Option<f32>; 2])> {
        self.read(|table| {
            let gap = table.moving.as_ref()?.gap?;
            Some((gap.at, table.move_drawn.borrow().lines))
        })
    }

    fn order(&mut self) -> Vec<usize> {
        self.read(|table| table.order().to_vec())
    }

    /// Picks `place` to be dragged: with `select`'s `Columns` kind on, a
    /// press and release on its header first selects it (Sheets' rule).
    fn pick(&mut self, place: usize) {
        #[cfg(feature = "select")]
        if self.read(|table| table.selectable().columns) {
            let at = self.header(place);
            self.press(at);
            self.release();
        }
        let _ = place;
    }

    /// A drag of `place`'s header (picked first) to `to`, released.
    fn drag_header(&mut self, place: usize, to: Point<Pixels>) {
        self.pick(place);
        let at = self.header(place);
        self.press(at);
        self.drag_to(to);
        self.release();
    }
}

/// A press that never moves past 2 px moves nothing; with `select`, it
/// selects as today, and inside a selected range it selects its column
/// alone at the release.
#[gpui_kit::test]
fn a_press_within_2_px_moves_nothing(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, 1000);
    sheet.pick(1);
    let at = sheet.header(1);
    sheet.press(at);
    sheet.drag_to(at + point(px(2.), px(0.)));
    assert!(!sheet.moving(), "2 px isn't a drag");
    sheet.release();
    assert_eq!(sheet.order(), [0, 1, 2, 3]);
    assert_eq!(sheet.moved(), Vec::<Vec<usize>>::new());
    #[cfg(feature = "select")]
    {
        use crate::TallTableSelection;
        // A range of two; a press inside it, released where it was.
        let range = TallTableSelection::Columns {
            anchor: (0, 1),
            head: (0, 2),
        };
        sheet.update(|table, cx| table.select(Some(range), cx));
        let at = sheet.header(2);
        sheet.press(at);
        assert_eq!(
            sheet.read(|table| table.selection()),
            Some(range),
            "kept at the press: a drag may follow"
        );
        sheet.release();
        assert_eq!(
            sheet.read(|table| table.selection()),
            Some(TallTableSelection::Columns {
                anchor: (0, 2),
                head: (0, 2)
            }),
            "the column alone at the release"
        );
    }
}

/// Past 2 px the preview follows the pointer and the line is at the gap
/// through the header and the body, at any height; nothing is hovered;
/// a frame only when the preview or the gap moves; the release moves the
/// block to the gap.
#[gpui_kit::test]
fn a_drag_moves_its_column_to_the_gap(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, 1000);
    let reads = sheet.source.reads.get();
    sheet.pick(0);
    let at = sheet.header(0);
    sheet.press(at);
    // Over column 2, right of its center (372): the gap before column 3.
    let to = sheet.over(400.);
    sheet.drag_to(to);
    assert!(sheet.moving());
    let (gutter, origin) = sheet.read(|table| (table.gutter_width(), table.body.origin.x));
    let line = gutter + 424.0;
    assert_eq!(sheet.gap(), Some((3, [Some(line), Some(line)])));
    let preview = sheet.read(|table| table.move_drawn.borrow().preview);
    let moved = f32::from(to.x - at.x);
    assert_eq!(
        preview,
        Some((gutter + moved, 120.0)),
        "the block's header, moved as far as the pointer"
    );
    let _ = origin;
    // Down into the body, the same x: the same gap, no frame.
    let notified = sheet.notified.get();
    sheet.drag_to(to + point(px(0.), px(300.)));
    assert_eq!(sheet.gap(), Some((3, [Some(line), Some(line)])));
    assert_eq!(sheet.notified.get(), notified, "nothing moved: no frame");
    // Nothing hovered, no tooltip, however long it rests.
    sheet
        .cx
        .executor()
        .advance_clock(Duration::from_millis(600));
    sheet.draw();
    assert!(sheet.read(|table| table.hover.is_none()), "no hover");
    sheet.release();
    assert!(!sheet.moving());
    assert_eq!(sheet.order(), [1, 2, 0, 3]);
    assert_eq!(sheet.moved(), [vec![1, 2, 0, 3]]);
    assert_eq!(sheet.source.reads.get(), reads, "a move reads nothing");
    assert_eq!(
        sheet.read(|table| table.move_drawn.borrow().clone()),
        Default::default(),
        "nothing drawn after the release"
    );
    // Back, past the left of the cells: the first gap.
    let to = sheet.over(-10.);
    sheet.drag_header(2, to);
    assert_eq!(sheet.order(), [0, 1, 2, 3]);
}

/// A release beside the block, or back where it started, moves nothing.
#[gpui_kit::test]
fn a_release_beside_the_block_moves_nothing(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, 1000);
    sheet.pick(1);
    let at = sheet.header(1);
    sheet.press(at);
    // Right of column 1's center (220), left of column 2's (372).
    let beside = sheet.over(300.);
    sheet.drag_to(beside);
    assert!(sheet.moving());
    assert_eq!(sheet.gap(), None);
    assert_eq!(
        sheet.read(|table| table.move_drawn.borrow().lines),
        [None, None],
        "no line"
    );
    // Left of its center, right of column 0's: before it.
    let before = sheet.over(150.);
    sheet.drag_to(before);
    assert_eq!(sheet.gap(), None);
    sheet.release();
    assert_eq!(sheet.order(), [0, 1, 2, 3]);
    assert_eq!(sheet.moved(), Vec::<Vec<usize>>::new());
}

/// A wheel during a drag scrolls the body sideways, and the gap follows
/// the columns brought under the pointer.
#[gpui_kit::test]
fn a_wheel_during_a_drag_moves_the_gap(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, 1000);
    sheet.cx.simulate_resize(size(px(400.), px(900.)));
    sheet.draw();
    sheet.pick(0);
    let at = sheet.header(0);
    sheet.press(at);
    // Over column 1 (120..320), right of its center: the gap before 2.
    let to = sheet.over(240.);
    sheet.drag_to(to);
    assert_eq!(sheet.gap().map(|(at, _)| at), Some(2));
    sheet.wheel_sideways(150.);
    assert_eq!(sheet.read(|table| table.scroll_x), 150.0);
    // At 240 + 150 = 390 in the content: right of column 2's center (372).
    assert_eq!(sheet.gap().map(|(at, _)| at), Some(3));
    sheet.release();
    assert_eq!(sheet.order(), [1, 2, 0, 3]);
    assert_eq!(sheet.read(|table| table.scroll_x), 150.0, "kept");
}

/// Escape cancels a drag, nothing moved, and goes no further; with no
/// drag it goes on as before.
#[gpui_kit::test]
fn escape_cancels_a_drag(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, 1000);
    sheet.pick(0);
    let at = sheet.header(0);
    sheet.press(at);
    let to = sheet.over(400.);
    sheet.drag_to(to);
    assert!(sheet.gap().is_some());
    #[cfg(feature = "select")]
    let selected = sheet.read(|table| table.selection());
    sheet.key("escape");
    assert!(!sheet.moving(), "cancelled");
    assert_eq!(sheet.escapes.get(), 0, "the key went no further");
    #[cfg(feature = "select")]
    assert_eq!(
        sheet.read(|table| table.selection()),
        selected,
        "nor to the selection"
    );
    assert_eq!(
        sheet.read(|table| table.move_drawn.borrow().clone()),
        Default::default()
    );
    sheet.release();
    assert_eq!(sheet.order(), [0, 1, 2, 3]);
    assert_eq!(sheet.moved(), Vec::<Vec<usize>>::new());
    // No drag: `select`'s Escape clears, then the host's has it.
    #[cfg(feature = "select")]
    {
        sheet.key("escape");
        assert_eq!(sheet.read(|table| table.selection()), None);
        assert_eq!(sheet.escapes.get(), 0);
    }
    sheet.key("escape");
    assert_eq!(sheet.escapes.get(), 1, "the host's");
}

/// With `select`'s `Columns` kind on: a press outside the selected range
/// selects as today; inside, the range moves and stays selected; a range
/// holding an unmovable column doesn't drag; a `Cells` selection makes no
/// header movable. With the kind off, a `Rows` selection leaves the plain
/// rule.
#[cfg(feature = "select")]
#[gpui_kit::test]
fn with_select_a_selected_range_moves(cx: &mut TestAppContext) {
    use crate::{Selectable, TallTableSelection};

    let mut sheet = Sheet::open(cx, 1000);
    let range = |anchor: usize, head: usize| TallTableSelection::Columns {
        anchor: (0, anchor),
        head: (0, head),
    };
    // Outside the range: a drag selecting, as today.
    sheet.update(|table, cx| table.select(Some(range(0, 0)), cx));
    let at = sheet.header(2);
    sheet.press(at);
    let to = sheet.header(3);
    sheet.drag_to(to);
    assert!(!sheet.moving());
    assert!(sheet.read(|table| table.is_selecting()));
    sheet.release();
    assert_eq!(sheet.read(|table| table.selection()), Some(range(2, 3)));
    assert_eq!(sheet.order(), [0, 1, 2, 3]);
    // Inside it: the range moves, past the last column, and stays
    // selected at its places.
    sheet.update(|table, cx| table.select(Some(range(1, 2)), cx));
    sheet.heard();
    let at = sheet.header(1);
    sheet.press(at);
    let to = sheet.over(700.);
    sheet.drag_to(to);
    assert!(sheet.moving());
    assert!(!sheet.read(|table| table.is_selecting()));
    sheet.release();
    assert_eq!(sheet.order(), [0, 3, 1, 2]);
    assert_eq!(sheet.read(|table| table.selection()), Some(range(2, 3)));
    let selected: Vec<_> = sheet
        .heard()
        .into_iter()
        .filter_map(|event| match event {
            TallTableEvent::Selected(selection) => Some(selection),
            _ => None,
        })
        .collect();
    assert_eq!(selected, [Some(range(2, 3))]);
    // An unmovable column in the range: no drag, the press selects.
    let mut list = columns();
    list[1] = list[1].clone().movable(false);
    sheet.update(|table, cx| table.set_columns(list, cx));
    sheet.update(|table, cx| table.select(Some(range(0, 1)), cx));
    let at = sheet.header(0);
    sheet.press(at);
    let to = sheet.over(700.);
    sheet.drag_to(to);
    assert!(!sheet.moving());
    sheet.release();
    assert_eq!(sheet.order(), [0, 1, 2, 3]);
    assert_eq!(sheet.read(|table| table.selection()), Some(range(0, 3)));
    // Alone, the unmovable column doesn't drag either.
    sheet.update(|table, cx| table.select(Some(range(1, 1)), cx));
    let at = sheet.header(1);
    sheet.press(at);
    sheet.drag_to(to);
    assert!(!sheet.moving());
    sheet.release();
    // A `Cells` selection: a header press selects its column.
    sheet.update(|table, cx| table.set_columns(columns(), cx));
    let cells = TallTableSelection::Cells {
        anchor: (0, 0),
        head: (2, 1),
    };
    sheet.update(|table, cx| table.select(Some(cells), cx));
    let at = sheet.header(0);
    sheet.press(at);
    sheet.drag_to(to);
    assert!(!sheet.moving());
    sheet.release();
    assert_eq!(sheet.order(), [0, 1, 2, 3]);
    // The kind off: the plain rule, whatever's selected.
    sheet.update(|table, cx| table.set_selectable(Selectable::all().columns(false), cx));
    let rows = TallTableSelection::Rows {
        anchor: (1, 0),
        head: (2, 0),
    };
    sheet.update(|table, cx| table.select(Some(rows), cx));
    sheet.drag_header(0, to);
    assert_eq!(sheet.order(), [1, 2, 3, 0]);
    assert_eq!(sheet.read(|table| table.selection()), Some(rows), "kept");
    // Shift and Cmd presses never move.
    for modifiers in [Modifiers::shift(), Modifiers::command()] {
        let at = sheet.header(0);
        sheet.press_at(at, modifiers);
        sheet.drag_to(to);
        assert!(!sheet.moving(), "{modifiers:?}");
        sheet.release();
    }
    assert_eq!(sheet.order(), [1, 2, 3, 0]);
}

/// `resize`'s band keeps its press: a drag there resizes, not moves.
#[cfg(feature = "resize")]
#[gpui_kit::test]
fn the_band_keeps_its_press(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, 1000);
    sheet.pick(0);
    // Column 0's right edge.
    let at = sheet.over(119.5);
    sheet.press(at);
    assert!(sheet.read(|table| table.resizing.is_some()));
    sheet.drag_to(at + point(px(40.), px(0.)));
    assert!(!sheet.moving());
    sheet.release();
    assert_eq!(sheet.order(), [0, 1, 2, 3]);
    assert_eq!(sheet.read(|table| table.columns[0].width), 160.0);
}

/// `sort`'s arrow keeps its press: a drag from it moves nothing, its
/// release off the arrow sorts nothing.
#[cfg(feature = "sort")]
#[gpui_kit::test]
fn the_arrow_keeps_its_press(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, 1000);
    sheet.pick(0);
    let at = sheet.read(|table| {
        let column = &table.columns[0];
        let (left, width) = table.arrow_box(0, column).expect("an arrow");
        let row_h = f32::from(table.sizes().row());
        table.body.origin
            + point(
                px(table.gutter_width() + column.x + left + width / 2.0),
                px(-row_h / 2.0),
            )
    });
    sheet.press(at);
    assert_eq!(sheet.read(|table| table.sort_state.pressed), Some(0));
    let to = sheet.over(700.);
    sheet.drag_to(to);
    assert!(!sheet.moving());
    sheet.release();
    assert_eq!(sheet.order(), [0, 1, 2, 3]);
    assert_eq!(sheet.source.sorts.get(), 0);
}

/// With `pin`: a drag into the run pins, out of it unpins; at the run's
/// end the pointer's side decides, beside the block too.
#[cfg(feature = "pin")]
#[gpui_kit::test]
fn a_drag_across_the_edge_pins_and_unpins(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, 1000);
    sheet.update(|table, cx| table.set_pinned(1, cx));
    let pinned = |sheet: &mut Sheet| sheet.read(|table| (table.pinned(), table.pinned_in_effect()));
    // Column 2 into the run, left of column 0's center: pinned first.
    let to = sheet.over(30.);
    sheet.drag_header(2, to);
    assert_eq!(sheet.order(), [2, 0, 1, 3]);
    assert_eq!(pinned(&mut sheet), (2, 2));
    // The run's edge at 104 + 120 = 224. Its last column (0) just right of
    // the edge: unpinned where it is.
    let to = sheet.over(230.);
    sheet.drag_header(1, to);
    assert_eq!(sheet.order(), [2, 0, 1, 3]);
    assert_eq!(pinned(&mut sheet), (1, 1));
    // And back, just left of the edge (now 104): pinned where it is.
    let to = sheet.over(100.);
    sheet.pick(1);
    let at = sheet.header(1);
    sheet.press(at);
    sheet.drag_to(to);
    let (gap, lines) = sheet.gap().expect("a gap");
    let gutter = sheet.read(|table| table.gutter_width());
    assert_eq!(gap, 1);
    assert_eq!(
        lines,
        [Some(gutter + 102.0); 2],
        "inside the run, at its edge"
    );
    sheet.release();
    assert_eq!(sheet.order(), [2, 0, 1, 3]);
    assert_eq!(pinned(&mut sheet), (2, 2));
    // A scrolled column to the run's end from the scrolled side: scrolled,
    // first after it.
    let to = sheet.over(230.);
    sheet.drag_header(3, to);
    assert_eq!(sheet.order(), [2, 0, 3, 1]);
    assert_eq!(pinned(&mut sheet), (2, 2));
    // Out of the run, past the last column.
    let to = sheet.over(700.);
    sheet.drag_header(0, to);
    assert_eq!(sheet.order(), [0, 3, 1, 2]);
    assert_eq!(pinned(&mut sheet), (1, 1));
}

/// Another button's release leaves the drag on; a release the table never
/// sees cancels a drag at the next move, and a next press redraws without
/// it; the release takes the gap the line was drawn at.
#[gpui_kit::test]
fn a_release_is_the_left_buttons_own(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, 1000);
    sheet.pick(0);
    let at = sheet.header(0);
    sheet.press(at);
    let to = sheet.over(400.);
    sheet.drag_to(to);
    sheet
        .cx
        .simulate_mouse_up(to, MouseButton::Right, Modifiers::default());
    sheet.draw();
    assert!(sheet.moving(), "the right button's release");
    assert_eq!(sheet.order(), [0, 1, 2, 3]);
    // Released past column 3's center, the line still before 3: the gap
    // drawn.
    sheet.pointer = sheet.over(560.);
    sheet.release();
    assert_eq!(sheet.order(), [1, 2, 0, 3], "the gap the line showed");
    // A release unseen: the next move, its button up, cancels.
    let back = sheet.over(-10.);
    sheet.drag_header(2, back);
    assert_eq!(sheet.order(), [0, 1, 2, 3]);
    let at = sheet.header(0);
    sheet.pick(0);
    sheet.press(at);
    sheet.drag_to(to);
    assert!(sheet.moving());
    sheet.cx.simulate_mouse_move(to, None, Modifiers::default());
    sheet.draw();
    assert!(!sheet.moving());
    assert_eq!(
        sheet.read(|table| table.move_drawn.borrow().clone()),
        Default::default()
    );
    // Or a press comes first: the drag's drawing goes, a frame asked for.
    sheet.press(at);
    sheet.drag_to(to);
    let other = sheet.header(3);
    let notified = sheet.notified.get();
    sheet.press(other);
    assert!(sheet.notified.get() > notified, "redrawn");
    assert!(!sheet.moving());
    assert_eq!(
        sheet.read(|table| table.move_drawn.borrow().clone()),
        Default::default()
    );
    sheet.release();
    assert_eq!(sheet.order(), [0, 1, 2, 3]);
}

/// With `select`: Escape before a press inside the range drags clears the
/// selection for good; a press whose release goes unseen still selects
/// its column, as the click it was.
#[cfg(feature = "select")]
#[gpui_kit::test]
fn escape_before_a_drag_clears_for_good(cx: &mut TestAppContext) {
    use crate::TallTableSelection;

    let mut sheet = Sheet::open(cx, 1000);
    let range = |anchor: usize, head: usize| TallTableSelection::Columns {
        anchor: (0, anchor),
        head: (0, head),
    };
    sheet.update(|table, cx| table.select(Some(range(1, 2)), cx));
    let at = sheet.header(2);
    sheet.press(at);
    sheet.key("escape");
    assert_eq!(sheet.read(|table| table.selection()), None);
    sheet.release();
    assert_eq!(sheet.read(|table| table.selection()), None, "still cleared");
    assert_eq!(sheet.escapes.get(), 0);
    sheet.update(|table, cx| table.select(Some(range(1, 2)), cx));
    sheet.press(at);
    sheet.cx.simulate_mouse_move(at, None, Modifiers::default());
    sheet.draw();
    assert_eq!(sheet.read(|table| table.selection()), Some(range(2, 2)));
}

/// With `pin`: a host's `set_pinned` during a drag moves the line before
/// the next pointer move, and the release takes it.
#[cfg(feature = "pin")]
#[gpui_kit::test]
fn the_gap_follows_a_new_run(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, 1000);
    sheet.pick(3);
    let at = sheet.header(3);
    sheet.press(at);
    // Right of column 1's center (220), left of column 2's (372): the gap
    // before 2, at column 2's left.
    let to = sheet.over(250.);
    sheet.drag_to(to);
    let gutter = sheet.read(|table| table.gutter_width());
    assert_eq!(sheet.gap(), Some((2, [Some(gutter + 320.0); 2])));
    // Two pinned, the edge at 320: the pointer in the run, the gap at its
    // end, its line inside the run.
    sheet.update(|table, cx| table.set_pinned(2, cx));
    assert_eq!(sheet.gap(), Some((2, [Some(gutter + 318.0); 2])));
    sheet.release();
    assert_eq!(sheet.order(), [0, 1, 3, 2]);
    assert_eq!(
        sheet.read(|table| (table.pinned(), table.pinned_in_effect())),
        (3, 3),
        "pinned, from the run's side"
    );
}
