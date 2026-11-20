//! `find`: `fixtures/find.json` and its controls against the pure rules
//! (`src/find.rs`: the match, the drawn ranges, the steps), then the
//! feature in a window of GPUI's test app, over a source whose finds
//! answer when the test says: the delegate's default refusing; the steps
//! along a row in drawn order then down, a hidden column skipped, a moved
//! column's order followed; the wraps, a lone match found again,
//! `NoMatch`, and no second ask from the first row; where a step starts
//! (the current match, a reader's cell or row, not a landing's selection,
//! the view's top, a hidden column's nearest shown cell); an answer past
//! the rows dropped; the landing (in view, out of view, sideways, pinned,
//! selected, `marked` unset, following let go); a step ignored while one
//! is out and on a closed table; every cancel emitting `Cancelled` once,
//! its late answer dropped, and which forget the current match; a shrink
//! and a grow; the drawing (ranges in a plain, a formatted, and a cut
//! text, a cell tinted whole, the current match's color and edge, drawn
//! whole after `live` changes it, a match inside a selection); a find not
//! counted in `max_in_flight`; and the probes.

use std::cell::RefCell;
use std::collections::HashMap;
use std::ops::Range;
use std::rc::Rc;

use futures::channel::oneshot;
use gpui_kit::component::ActiveTheme as _;
use gpui_kit::component::scroll::Scrollbar;
use gpui_kit::{
    App, AppContext as _, Context, Entity, Hsla, IntoElement, ParentElement as _, Render,
    SharedString, Styled as _, TestAppContext, VisualTestContext, Window, div, px, size,
};
use serde_json::Value as Json;

use super::super::{TallTableEvent, TallTableState, row_height};
use crate::column::{ColumnKind, TallTableColumn};
use crate::delegate::{CellValue, PageError, PageLoad, TallTableDelegate, TallTablePage};
use crate::find::{self, Control, FindOutcome, FindQuery, Found, FoundCell};
use crate::tall_table::TallTable;

const FIND: &str = include_str!("../../../fixtures/find.json");

// --- the fixture ---

fn text_of(value: &Json) -> Option<&str> {
    value.as_str()
}

/// `matches`' cases that fail.
fn match_failures(fixture: &Json) -> Vec<String> {
    let mut failures = Vec::new();
    for case in fixture["matches"].as_array().expect("matches") {
        let term = case["term"].as_str().expect("term");
        let got =
            text_of(&case["exact"]).is_some_and(|exact| find::matches(exact, &find::lower(term)));
        if got != case["expect"].as_bool().expect("expect") {
            failures.push(case["name"].as_str().expect("name").to_string());
        }
    }
    failures
}

/// `ranges`' cases that fail.
fn range_failures(fixture: &Json) -> Vec<String> {
    let mut failures = Vec::new();
    for case in fixture["ranges"].as_array().expect("ranges") {
        let got = find::highlight(
            false,
            text_of(&case["exact"]),
            case["drawn"].as_str().expect("drawn"),
            case["term"].as_str().expect("term"),
        );
        let expect = match &case["expect"] {
            Json::Null => None,
            Json::String(cell) if cell == "cell" => Some(Found::Cell),
            ranges => Some(Found::Ranges(
                ranges
                    .as_array()
                    .expect("ranges")
                    .iter()
                    .map(|range| {
                        let at = |i: usize| range[i].as_u64().expect("an offset") as usize;
                        at(0)..at(1)
                    })
                    .collect(),
            )),
        };
        if got != expect {
            failures.push(case["name"].as_str().expect("name").to_string());
        }
    }
    failures
}

/// A step over the fixture's grid: the cell found, whether it wrapped,
/// and how many asks it took, as the table steps (its gap, its query, its
/// wrap) and a source answers (`FindQuery::cells`, `FindQuery::matches`).
fn run_step(grid: &[Vec<String>], case: &Json) -> (Option<FoundCell>, bool, usize) {
    let order: Vec<usize> = case["columns"]
        .as_array()
        .expect("columns")
        .iter()
        .map(|index| index.as_u64().expect("an index") as usize)
        .collect();
    let hidden: Vec<usize> = case["hidden"]
        .as_array()
        .expect("hidden")
        .iter()
        .map(|index| index.as_u64().expect("an index") as usize)
        .collect();
    let shown: Vec<bool> = order.iter().map(|index| !hidden.contains(index)).collect();
    let columns: Vec<usize> = order
        .iter()
        .copied()
        .filter(|index| !hidden.contains(index))
        .collect();
    let backward = case["backward"].as_bool().expect("backward");
    let rows = grid.len() as u64;
    let start = &case["start"];
    let gap = if let Some(top) = start["top"].as_u64() {
        top * columns.len() as u64
    } else {
        let cell = start["current"].as_array().expect("current");
        let row = cell[0].as_u64().expect("row");
        let index = cell[1].as_u64().expect("column") as usize;
        let place = order.iter().position(|&i| i == index).expect("a place");
        find::gap_at(row, place, &shown, backward)
    };
    let query = find::first_query(
        case["term"].as_str().expect("term").into(),
        columns,
        rows,
        gap,
        backward,
    );
    let ask = |query: &FindQuery| {
        query
            .cells(rows)
            .find(|cell| query.matches(&grid[cell.row as usize][cell.column]))
    };
    if let Some(cell) = ask(&query) {
        return (Some(cell), false, 1);
    }
    match find::wrap_query(&query) {
        Some(wrap) => {
            let found = ask(&wrap);
            (found, found.is_some(), 2)
        }
        None => (None, false, 1),
    }
}

/// `steps`' cases that fail.
fn step_failures(fixture: &Json) -> Vec<String> {
    let grid: Vec<Vec<String>> = fixture["grid"]
        .as_array()
        .expect("grid")
        .iter()
        .map(|row| {
            row.as_array()
                .expect("a row")
                .iter()
                .map(|text| text.as_str().expect("a text").to_string())
                .collect()
        })
        .collect();
    let mut failures = Vec::new();
    for case in fixture["steps"].as_array().expect("steps") {
        let expect = &case["expect"];
        let cell = expect["cell"].as_array().map(|cell| {
            FoundCell::new(
                cell[0].as_u64().expect("row"),
                cell[1].as_u64().expect("column") as usize,
            )
        });
        let want = (
            cell,
            expect["wrapped"].as_bool().expect("wrapped"),
            expect["asks"].as_u64().expect("asks") as usize,
        );
        if run_step(&grid, case) != want {
            failures.push(case["name"].as_str().expect("name").to_string());
        }
    }
    failures
}

fn failures(fixture: &Json) -> Vec<String> {
    let mut all = match_failures(fixture);
    all.extend(range_failures(fixture));
    all.extend(step_failures(fixture));
    all
}

#[test]
fn find_fixture() {
    let fixture: Json = serde_json::from_str(FIND).expect("find.json");
    assert_eq!(failures(&fixture), Vec::<String>::new());
}

#[test]
fn find_controls_fail() {
    let fixture: Json = serde_json::from_str(FIND).expect("find.json");
    let controls = fixture["controls"].as_array().expect("controls");
    assert_eq!(controls.len(), 3);
    for control in controls {
        let name = control.as_str().expect("a control");
        let control = match name {
            "case-sensitive" => Control::CaseSensitive,
            "cut-ranges" => Control::CutRanges,
            "no-wrap" => Control::NoWrap,
            other => panic!("unknown control {other}"),
        };
        let failed = find::with_control(control, || failures(&fixture));
        assert!(!failed.is_empty(), "{name} passed find.json");
    }
}

// --- the window ---

/// A cell's value in the source.
#[derive(Debug, Clone, PartialEq)]
enum Cell {
    Text(String),
    Float(f64),
    Null,
}

/// The source's rows and its books: what it holds (`r<row>c<column>`
/// unless planted), each find asked and answered when the test says, and
/// each request cancelled.
#[derive(Default)]
struct Books {
    planted: HashMap<(u64, usize), Cell>,
    rows: u64,
    /// `find` answers `None`.
    refuse: bool,
    next: u64,
    asks: Vec<FindQuery>,
    /// Each find not yet answered: its request, its answer (found when
    /// asked), and its channel.
    open: Vec<(u64, Option<FoundCell>, Answer)>,
    cancelled: Vec<u64>,
    /// The next answer, whatever it searched (an answer past the rows).
    answer_with: Option<FoundCell>,
}

impl Books {
    fn cell(&self, row: u64, column: usize) -> Cell {
        self.planted
            .get(&(row, column))
            .cloned()
            .unwrap_or_else(|| Cell::Text(format!("r{row}c{column}")))
    }
}

/// Where a find's answer is sent.
type Answer = oneshot::Sender<Result<Option<FoundCell>, PageError>>;

const COLUMNS: usize = 4;

struct Source(Rc<RefCell<Books>>);

struct Rows(Vec<Vec<Cell>>);

impl TallTablePage for Rows {
    fn value(&self, row: usize, column: usize) -> Option<CellValue<'_>> {
        Some(match self.0.get(row)?.get(column)? {
            Cell::Text(text) => CellValue::Text(text.as_str().into()),
            Cell::Float(value) => CellValue::Float(*value),
            Cell::Null => CellValue::Null,
        })
    }

    fn heap_bytes(&self) -> usize {
        1024
    }
}

impl TallTableDelegate for Source {
    type Page = Rows;
    type Request = u64;

    fn load_page(&mut self, rows: Range<u64>, _: &mut App) -> (u64, PageLoad<Rows>) {
        let mut books = self.0.borrow_mut();
        books.next += 1;
        let page = rows
            .map(|row| (0..COLUMNS).map(|column| books.cell(row, column)).collect())
            .collect();
        (books.next, Box::pin(std::future::ready(Ok(Rows(page)))))
    }

    fn cancel(&mut self, request: u64, _: &mut App) {
        self.0.borrow_mut().cancelled.push(request);
    }

    #[cfg(feature = "sort")]
    fn sort(&mut self, _: &[crate::Sort], _: &mut App) -> Result<(), crate::SortRefused> {
        Ok(())
    }

    fn find(&mut self, query: &FindQuery, _: &mut App) -> Option<(u64, crate::FindLoad)> {
        let mut books = self.0.borrow_mut();
        if books.refuse {
            return None;
        }
        books.next += 1;
        let request = books.next;
        let answer = query
            .cells(books.rows)
            .find(|cell| match books.cell(cell.row, cell.column) {
                Cell::Text(text) => query.matches(&text),
                Cell::Float(value) => query.matches(&CellValue::Float(value).to_string()),
                Cell::Null => false,
            });
        let answer = books.answer_with.take().or(answer);
        let (send, receive) = oneshot::channel();
        books.asks.push(query.clone());
        books.open.push((request, answer, send));
        Some((
            request,
            Box::pin(async move { receive.await.unwrap_or(Err(PageError::Cancelled)) }),
        ))
    }
}

type Table = TallTableState<Source>;

struct Shell {
    table: Entity<Table>,
}

impl Render for Shell {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        div().size_full().child(TallTable::new(&self.table))
    }
}

/// `COLUMNS` text columns, 200 px each; with `sort`, sortable.
fn texts() -> Vec<TallTableColumn> {
    (0..COLUMNS)
        .map(|index| {
            let column = TallTableColumn::new(format!("t{index}"), ColumnKind::Text);
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
    books: Rc<RefCell<Books>>,
    events: Rc<RefCell<Vec<TallTableEvent>>>,
    /// Steps started and not yet ended, as heard.
    started: usize,
    _subscription: gpui_kit::Subscription,
}

impl<'a> Sheet<'a> {
    fn open(cx: &'a mut TestAppContext, cells_width: f32) -> Self {
        Self::with(cx, cells_width, texts(), Books::default())
    }

    fn with(
        cx: &'a mut TestAppContext,
        cells_width: f32,
        columns: Vec<TallTableColumn>,
        books: Books,
    ) -> Self {
        cx.update(|cx| {
            gpui_kit::component::init(cx);
            crate::init(cx);
        });
        let books = Rc::new(RefCell::new(Books {
            rows: 1000,
            ..books
        }));
        let source = books.clone();
        let (shell, cx) = cx.add_window_view(move |_, cx| {
            let table = cx.new(|cx| {
                TallTableState::new(Source(source), columns, 1000, Default::default(), cx)
                    .probe_frames(true)
            });
            Shell { table }
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
            books,
            events,
            started: 0,
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

    fn plant(&mut self, row: u64, column: usize, text: &str) {
        self.books
            .borrow_mut()
            .planted
            .insert((row, column), Cell::Text(text.into()));
    }

    /// Every page read again, so the frames draw what's planted since.
    fn reload(&mut self) {
        self.update(|table, cx| table.replace_rows(1000, crate::ViewAt::Top, cx));
    }

    fn term(&mut self, term: &str) {
        self.update(|table, cx| table.set_find(Some(term.into()), cx));
    }

    /// Answers every find out, those its answers ask included, each with
    /// its answer (a cancelled one's too: the table drops it).
    fn answer(&mut self) {
        loop {
            let open = std::mem::take(&mut self.books.borrow_mut().open);
            if open.is_empty() {
                return;
            }
            for (_, answer, send) in open {
                let _ = send.send(Ok(answer));
            }
            self.draw();
        }
    }

    /// A step, answered: the outcomes heard since the last call.
    fn step(&mut self, backward: bool) -> Vec<FindOutcome> {
        self.update(|table, cx| {
            if backward {
                table.find_previous(cx)
            } else {
                table.find_next(cx)
            }
        });
        self.answer();
        self.outcomes()
    }

    /// The step's cell, from a `Match`.
    fn next(&mut self) -> (u64, usize, bool) {
        match self.step(false).as_slice() {
            [FindOutcome::Match { cell, wrapped }] => (cell.row, cell.column, *wrapped),
            other => panic!("not one match: {other:?}"),
        }
    }

    fn previous(&mut self) -> (u64, usize, bool) {
        match self.step(true).as_slice() {
            [FindOutcome::Match { cell, wrapped }] => (cell.row, cell.column, *wrapped),
            other => panic!("not one match: {other:?}"),
        }
    }

    /// The `Found`s heard since the last call, each after its own
    /// `FindStarted` (a `Cancelled` with none, a cancel's).
    fn outcomes(&mut self) -> Vec<FindOutcome> {
        let mut started = self.started;
        let mut found = Vec::new();
        for event in self.events.borrow_mut().drain(..) {
            match event {
                TallTableEvent::FindStarted => started += 1,
                TallTableEvent::Found(outcome) => found.push(outcome),
                _ => {}
            }
        }
        let steps = found
            .iter()
            .filter(|outcome| **outcome != FindOutcome::Cancelled)
            .count();
        // A step's `Found` comes after its `FindStarted`; a cancel's
        // `Cancelled` ends one out; one still out has none yet.
        assert!(steps <= started, "{started} started, {found:?}");
        self.started = started - steps;
        found
    }

    fn asks(&mut self) -> usize {
        self.books.borrow().asks.len()
    }

    /// Starts a step and leaves it out: its request.
    fn leave_out(&mut self) -> u64 {
        self.update(|table, cx| table.find_next(cx));
        assert!(self.events.borrow().contains(&TallTableEvent::FindStarted));
        self.events
            .borrow_mut()
            .retain(|event| *event == TallTableEvent::FindStarted);
        self.books.borrow().open.last().expect("a find out").0
    }

    fn current(&mut self) -> Option<(u64, usize)> {
        self.read(|table| table.current_match().map(|cell| (cell.row, cell.column)))
    }

    fn top(&mut self) -> f64 {
        self.read(|table| table.scroll.top())
    }

    /// What the last frame drew of the cell at `row` and column `index`.
    fn drawn(&mut self, row: u64, column: usize) -> crate::cells_text::DrawnText {
        self.read(|table| {
            table
                .drawn_text
                .borrow()
                .iter()
                .find(|cell| (cell.row, cell.column) == (row, column))
                .cloned()
                .expect("a drawn cell")
        })
    }

    fn colors(&mut self) -> (Hsla, Hsla, Hsla) {
        self.cx.update(|_, cx| {
            let theme = cx.theme();
            (
                Hsla {
                    s: 0.1,
                    ..theme.selection
                },
                theme.selection,
                theme.ring,
            )
        })
    }
}

#[gpui_kit::test]
fn the_default_refuses(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, 900.0);
    sheet.books.borrow_mut().refuse = true;
    sheet.term("r1c1");
    assert_eq!(sheet.step(false), [FindOutcome::Refused]);
    assert_eq!(sheet.current(), None);
}

#[gpui_kit::test]
fn a_step_needs_a_term(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, 900.0);
    assert_eq!(sheet.step(false), []);
    sheet.term("x");
    sheet.update(|table, cx| table.set_find(Some("".into()), cx));
    assert_eq!(sheet.read(|table| table.find_term().cloned()), None);
    assert_eq!(sheet.step(false), []);
    assert_eq!(sheet.asks(), 0);
}

#[gpui_kit::test]
fn steps_along_each_row_then_down(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, 900.0);
    for (row, column) in [(0, 0), (0, 2), (1, 1), (5, 3)] {
        sheet.plant(row, column, "Apple");
    }
    sheet.term("apple");
    assert_eq!(sheet.next(), (0, 0, false));
    assert_eq!(sheet.next(), (0, 2, false));
    assert_eq!(sheet.next(), (1, 1, false));
    assert_eq!(sheet.next(), (5, 3, false));
    // Past the last: from the top, up to the start cell.
    let asks = sheet.asks();
    assert_eq!(sheet.next(), (0, 0, true));
    assert_eq!(sheet.asks(), asks + 2);
    let wrap = sheet.books.borrow().asks.last().cloned().expect("an ask");
    assert_eq!((wrap.after, wrap.until), (None, Some(FoundCell::new(5, 3))));
    // Back, coming round from the end.
    assert_eq!(sheet.previous(), (5, 3, true));
    assert_eq!(sheet.previous(), (1, 1, false));
    let back = sheet.books.borrow().asks.last().cloned().expect("an ask");
    assert!(back.backward);
    assert_eq!(back.columns, [0, 1, 2, 3]);
}

#[gpui_kit::test]
fn a_lone_match_and_no_match(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, 900.0);
    sheet.plant(3, 1, "pear");
    sheet.term("pear");
    assert_eq!(sheet.next(), (3, 1, false));
    assert_eq!(sheet.next(), (3, 1, true));
    // From the top, nothing: one ask, which searched every row. The
    // landing's cell cleared (`select`), else the step starts there.
    sheet.term("kiwi");
    #[cfg(feature = "select")]
    sheet.update(|table, cx| table.set_selection(None, cx));
    let asks = sheet.asks();
    assert_eq!(sheet.step(false), [FindOutcome::NoMatch]);
    assert_eq!(sheet.asks(), asks + 1);
    // From further down: a second ask from the top.
    sheet.update(|table, cx| table.scroll_by(10.0, 0.0, cx));
    assert_eq!(sheet.step(false), [FindOutcome::NoMatch]);
    assert_eq!(sheet.asks(), asks + 3);
    // Backward from the view's top row: before it, then from the end.
    sheet.update(|table, cx| table.scroll_by(-10.0, 0.0, cx));
    assert_eq!(sheet.step(true), [FindOutcome::NoMatch]);
    assert_eq!(sheet.asks(), asks + 5);
}

#[gpui_kit::test]
fn from_the_views_top(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, 900.0);
    for row in [2, 12, 40] {
        sheet.plant(row, 0, "apple");
    }
    sheet.update(|table, cx| table.scroll_by(12.0, 0.0, cx));
    sheet.term("apple");
    // The top row's first cell is searched first.
    assert_eq!(sheet.next(), (12, 0, false));
    sheet.term("apple ");
    sheet.term("apple");
    // The landing's cell cleared (`select`), else the step starts there.
    #[cfg(feature = "select")]
    sheet.update(|table, cx| table.set_selection(None, cx));
    assert_eq!(sheet.previous(), (2, 0, false));
}

#[gpui_kit::test]
fn an_answer_past_the_rows_is_none_to_the_end(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, 900.0);
    sheet.plant(3, 0, "apple");
    sheet.term("apple");
    // From the top: none to the end, and no wrap.
    sheet.books.borrow_mut().answer_with = Some(FoundCell::new(1000, 0));
    assert_eq!(sheet.step(false), [FindOutcome::NoMatch]);
    assert_eq!(sheet.current(), None);
    // From further down: the wrap asks from the top.
    sheet.update(|table, cx| table.scroll_by(10.0, 0.0, cx));
    sheet.books.borrow_mut().answer_with = Some(FoundCell::new(1000, 0));
    assert_eq!(sheet.next(), (3, 0, true));
}

#[gpui_kit::test]
fn a_failed_find(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, 900.0);
    sheet.term("x");
    sheet.update(|table, cx| table.find_next(cx));
    let (_, _, send) = sheet.books.borrow_mut().open.pop().expect("a find");
    let _ = send.send(Err(PageError::Failed {
        message: "gone".into(),
        read_failure: false,
    }));
    sheet.draw();
    assert_eq!(sheet.outcomes(), [FindOutcome::Failed("gone".into())]);
}

#[gpui_kit::test]
fn the_landing(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, 900.0);
    for (row, column) in [(5, 1), (500, 2), (999, 0)] {
        sheet.plant(row, column, "apple");
    }
    sheet.term("apple");
    // In view: no scroll.
    assert_eq!(sheet.next(), (5, 1, false));
    assert_eq!(sheet.top(), 0.0);
    // Out of view: at the top, as a jump.
    assert_eq!(sheet.next(), (500, 2, false));
    assert_eq!(sheet.top(), 500.0);
    // Clamped at the end.
    assert_eq!(sheet.next(), (999, 0, false));
    let max = sheet.read(|table| table.scroll.max_top());
    assert_eq!(sheet.top(), max);
    // The jump's mark isn't set.
    assert_eq!(sheet.read(|table| table.marked), None);
}

#[gpui_kit::test]
fn the_landing_sideways(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, 300.0);
    sheet.plant(0, 3, "apple");
    sheet.plant(1, 0, "apple");
    sheet.term("apple");
    assert_eq!(sheet.next(), (0, 3, false));
    // Column 3 is 600..800: brought to the view's right edge.
    assert_eq!(sheet.read(|table| table.scroll_x), 500.0);
    assert_eq!(sheet.next(), (1, 0, false));
    assert_eq!(sheet.read(|table| table.scroll_x), 0.0);
}

#[cfg(feature = "pin")]
#[gpui_kit::test]
fn a_pinned_column_is_in_view(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, 500.0);
    sheet.plant(1, 0, "apple");
    sheet.update(|table, cx| table.set_pinned(1, cx));
    sheet.update(|table, cx| table.scroll_by(0.0, 200.0, cx));
    sheet.term("apple");
    assert_eq!(sheet.next(), (1, 0, false));
    assert_eq!(sheet.read(|table| table.scroll_x), 200.0);
}

#[gpui_kit::test]
fn ignored_while_out_and_closed(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, 900.0);
    sheet.term("r3c1");
    sheet.leave_out();
    sheet.update(|table, cx| {
        table.find_next(cx);
        table.find_previous(cx);
    });
    assert_eq!(sheet.asks(), 1);
    let started = sheet
        .events
        .borrow()
        .iter()
        .filter(|event| **event == TallTableEvent::FindStarted)
        .count();
    assert_eq!(started, 1);
    sheet.answer();
    assert_eq!(sheet.outcomes().len(), 1);
    sheet.update(|table, cx| table.close(cx));
    assert_eq!(sheet.step(false), []);
    assert_eq!(sheet.asks(), 1);
}

#[gpui_kit::test]
fn not_counted_in_flight(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, 900.0);
    sheet.term("r3c1");
    sheet.leave_out();
    assert_eq!(sheet.read(|table| table.in_flight()), 0);
    // Pages still read and land past the find out.
    sheet.update(|table, cx| table.scroll_by(5000.0, 0.0, cx));
    let probe = sheet.read(|table| table.published_probe.clone().expect("a probe"));
    assert_eq!(probe.loaded, probe.end - probe.first);
    assert!(probe.find.out);
}

/// Each cancel: `Cancelled` once, the request cancelled through the
/// delegate, its late answer dropped, and the current match kept or not.
fn cancels(
    cx: &mut TestAppContext,
    keeps: bool,
    cancel: impl FnOnce(&mut Table, &mut Context<Table>),
) {
    let mut sheet = Sheet::open(cx, 900.0);
    sheet.plant(2, 1, "apple");
    sheet.plant(7, 1, "apple");
    sheet.term("apple");
    assert_eq!(sheet.next(), (2, 1, false));
    let request = sheet.leave_out();
    sheet.update(cancel);
    assert_eq!(sheet.outcomes(), [FindOutcome::Cancelled]);
    assert!(sheet.books.borrow().cancelled.contains(&request));
    sheet.answer();
    assert_eq!(sheet.outcomes(), []);
    assert_eq!(sheet.current(), keeps.then_some((2, 1)));
}

#[gpui_kit::test]
fn a_new_term_cancels_and_forgets(cx: &mut TestAppContext) {
    cancels(cx, false, |table, cx| {
        table.set_find(Some("pear".into()), cx)
    });
}

#[gpui_kit::test]
fn no_term_cancels_and_forgets(cx: &mut TestAppContext) {
    cancels(cx, false, |table, cx| table.set_find(None, cx));
}

/// A cancelled find's late answer, arriving while the next step's is out,
/// isn't that step's: the table takes only the answer to the find it has
/// out.
#[gpui_kit::test]
fn a_late_answer_isnt_the_next_steps(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, 900.0);
    sheet.plant(2, 1, "apple");
    sheet.plant(7, 1, "apple");
    sheet.plant(9, 1, "pear");
    sheet.term("apple");
    assert_eq!(sheet.next(), (2, 1, false));
    let old = sheet.leave_out();
    sheet.term("pear");
    assert_eq!(sheet.outcomes(), [FindOutcome::Cancelled]);
    let new = sheet.leave_out();
    // The old answer (row 7) first, while the new step is out.
    let (_, answer, send) = {
        let mut books = sheet.books.borrow_mut();
        let at = books
            .open
            .iter()
            .position(|(request, ..)| *request == old)
            .expect("old");
        books.open.remove(at)
    };
    assert_eq!(answer, Some(FoundCell::new(7, 1)));
    let _ = send.send(Ok(answer));
    sheet.draw();
    assert_eq!(sheet.outcomes(), []);
    assert_eq!(sheet.current(), None);
    assert!(sheet.read(|table| table.find_state.out.is_some()));
    // Then the new one's.
    assert!(
        sheet
            .books
            .borrow()
            .open
            .iter()
            .any(|(request, ..)| *request == new)
    );
    sheet.answer();
    assert_eq!(
        sheet.outcomes(),
        [FindOutcome::Match {
            cell: FoundCell::new(9, 1),
            wrapped: false
        }]
    );
}

#[gpui_kit::test]
fn the_same_term_changes_nothing(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, 900.0);
    sheet.plant(2, 1, "apple");
    sheet.term("apple");
    assert_eq!(sheet.next(), (2, 1, false));
    sheet.leave_out();
    sheet.term("apple");
    assert_eq!(sheet.outcomes(), []);
    sheet.answer();
    assert_eq!(sheet.outcomes().len(), 1);
}

#[gpui_kit::test]
fn replace_rows_cancels_and_forgets(cx: &mut TestAppContext) {
    cancels(cx, false, |table, cx| {
        table.replace_rows(1000, crate::ViewAt::Top, cx)
    });
}

#[gpui_kit::test]
fn set_columns_cancels_and_forgets(cx: &mut TestAppContext) {
    cancels(cx, false, |table, cx| table.set_columns(texts(), cx));
}

#[cfg(feature = "sort")]
#[gpui_kit::test]
fn a_sort_cancels_and_forgets(cx: &mut TestAppContext) {
    cancels(cx, false, |table, cx| {
        let sort = crate::Sort::new(0, crate::SortDirection::Ascending);
        table.set_sort(vec![sort], cx).expect("sorted");
    });
}

#[cfg(feature = "reorder")]
#[gpui_kit::test]
fn a_move_cancels_and_keeps(cx: &mut TestAppContext) {
    cancels(cx, true, |table, cx| table.move_columns(3..4, 0, cx));
}

#[cfg(feature = "reorder")]
#[gpui_kit::test]
fn set_order_cancels_and_keeps(cx: &mut TestAppContext) {
    cancels(cx, true, |table, cx| table.set_order(vec![3, 2, 1, 0], cx));
}

#[cfg(feature = "hide")]
#[gpui_kit::test]
fn a_hide_cancels_and_keeps(cx: &mut TestAppContext) {
    cancels(cx, true, |table, cx| table.set_column_hidden(1, true, cx));
}

#[gpui_kit::test]
fn close_cancels(cx: &mut TestAppContext) {
    cancels(cx, true, |table, cx| table.close(cx));
}

#[gpui_kit::test]
fn a_shrink_cancels_and_cuts(cx: &mut TestAppContext) {
    // Past the current match: cancelled, forgotten.
    cancels(cx, false, |table, cx| table.set_rows(2, cx));
}

#[gpui_kit::test]
fn a_shrink_keeps_a_match_before_it(cx: &mut TestAppContext) {
    cancels(cx, true, |table, cx| table.set_rows(100, cx));
}

#[gpui_kit::test]
fn a_grow_keeps_both(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, 900.0);
    sheet.plant(2, 1, "apple");
    sheet.plant(7, 1, "apple");
    sheet.term("apple");
    assert_eq!(sheet.next(), (2, 1, false));
    sheet.leave_out();
    sheet.update(|table, cx| table.set_rows(2000, cx));
    assert_eq!(sheet.outcomes(), []);
    sheet.answer();
    assert_eq!(
        sheet.outcomes(),
        [FindOutcome::Match {
            cell: FoundCell::new(7, 1),
            wrapped: false
        }]
    );
}

#[cfg(feature = "reorder")]
#[gpui_kit::test]
fn a_moved_columns_order(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, 900.0);
    sheet.plant(0, 0, "apple");
    sheet.plant(0, 3, "apple");
    sheet.update(|table, cx| table.move_columns(3..4, 0, cx));
    sheet.term("apple");
    assert_eq!(sheet.next(), (0, 3, false));
    assert_eq!(sheet.books.borrow().asks[0].columns, [3, 0, 1, 2]);
    assert_eq!(sheet.next(), (0, 0, false));
}

#[cfg(feature = "hide")]
#[gpui_kit::test]
fn a_hidden_column_is_skipped(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, 900.0);
    sheet.plant(0, 2, "apple");
    sheet.plant(1, 0, "apple");
    sheet.update(|table, cx| table.set_column_hidden(2, true, cx));
    sheet.term("apple");
    assert_eq!(sheet.next(), (1, 0, false));
    assert_eq!(sheet.books.borrow().asks[0].columns, [0, 1, 3]);
}

#[cfg(feature = "hide")]
#[gpui_kit::test]
fn a_start_on_a_hidden_column(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, 900.0);
    for column in [0, 1, 2] {
        sheet.plant(1, column, "apple");
    }
    sheet.term("apple");
    assert_eq!(sheet.next(), (1, 0, false));
    assert_eq!(sheet.next(), (1, 1, false));
    sheet.update(|table, cx| table.set_column_hidden(1, true, cx));
    // Not drawn, still the current match.
    assert_eq!(sheet.current(), Some((1, 1)));
    assert!(sheet.read(|table| {
        table
            .drawn_text
            .borrow()
            .iter()
            .all(|cell| cell.column != 1)
    }));
    // Forward from row 1's column 0, the nearest shown before it.
    assert_eq!(sheet.next(), (1, 2, false));
    let ask = sheet.books.borrow().asks.last().cloned().expect("an ask");
    assert_eq!(ask.after, Some(FoundCell::new(1, 0)));
    // Backward from the hidden one: before its column 2.
    sheet.update(|table, cx| table.set_column_hidden(1, false, cx));
    assert_eq!(sheet.previous(), (1, 1, false));
    sheet.update(|table, cx| table.set_column_hidden(1, true, cx));
    assert_eq!(sheet.previous(), (1, 0, false));
    let ask = sheet.books.borrow().asks.last().cloned().expect("an ask");
    assert_eq!(ask.after, Some(FoundCell::new(1, 2)));
}

#[cfg(feature = "select")]
mod select {
    use super::{FindOutcome, Sheet};
    use crate::selection::Kind;
    use crate::{Selectable, TallTableSelection};
    use gpui_kit::TestAppContext;

    fn plant(sheet: &mut Sheet) {
        for (row, column) in [(0, 0), (0, 2), (1, 1), (2, 2), (6, 3)] {
            sheet.plant(row, column, "apple");
        }
        sheet.reload();
        sheet.term("apple");
    }

    #[gpui_kit::test]
    fn the_found_cell_is_selected(cx: &mut TestAppContext) {
        let mut sheet = Sheet::open(cx, 900.0);
        plant(&mut sheet);
        assert_eq!(sheet.next(), (0, 0, false));
        assert_eq!(
            sheet.read(|table| table.selection()),
            Some(TallTableSelection::new(Kind::Cells, (0, 0), (0, 0)))
        );
        assert_eq!(sheet.next(), (0, 2, false));
        assert_eq!(
            sheet.read(|table| table.selection()),
            Some(TallTableSelection::new(Kind::Cells, (0, 2), (0, 2)))
        );
        // No mark: the selection is its highlight.
        assert_eq!(sheet.read(|table| table.drawn_mark()), None);
    }

    #[gpui_kit::test]
    fn its_row_with_rows_only(cx: &mut TestAppContext) {
        let mut sheet = Sheet::open(cx, 900.0);
        sheet.update(|table, cx| table.set_selectable(Selectable::none().rows(true), cx));
        plant(&mut sheet);
        assert_eq!(sheet.next(), (0, 0, false));
        assert_eq!(
            sheet.read(|table| table.selection()),
            Some(TallTableSelection::new(Kind::Rows, (0, 0), (0, 0)))
        );
        // The landing's row isn't the reader's: on from the match, not
        // from its row's start.
        assert_eq!(sheet.next(), (0, 2, false));
    }

    #[gpui_kit::test]
    fn columns_only_is_left(cx: &mut TestAppContext) {
        let mut sheet = Sheet::open(cx, 900.0);
        sheet.update(|table, cx| table.set_selectable(Selectable::none().columns(true), cx));
        let columns = TallTableSelection::new(Kind::Columns, (0, 3), (0, 3));
        sheet.update(|table, cx| table.set_selection(Some(columns), cx));
        plant(&mut sheet);
        assert_eq!(sheet.next(), (0, 0, false));
        assert_eq!(sheet.read(|table| table.selection()), Some(columns));
        // A `Columns` range is no start.
        assert_eq!(sheet.next(), (0, 2, false));
    }

    #[gpui_kit::test]
    fn from_the_readers_cell(cx: &mut TestAppContext) {
        let mut sheet = Sheet::open(cx, 900.0);
        plant(&mut sheet);
        assert_eq!(sheet.next(), (0, 0, false));
        // The reader's cell, set after the landing, is the start.
        let cell = TallTableSelection::new(Kind::Cells, (2, 1), (2, 1));
        sheet.update(|table, cx| table.set_selection(Some(cell), cx));
        assert_eq!(sheet.next(), (2, 2, false));
        // Then the landing's again: from the match.
        assert_eq!(sheet.next(), (6, 3, false));
        let cell = TallTableSelection::new(Kind::Cells, (2, 1), (2, 1));
        sheet.update(|table, cx| table.set_selection(Some(cell), cx));
        assert_eq!(sheet.previous(), (1, 1, false));
    }

    #[gpui_kit::test]
    fn from_the_readers_row(cx: &mut TestAppContext) {
        let mut sheet = Sheet::open(cx, 900.0);
        plant(&mut sheet);
        assert_eq!(sheet.next(), (0, 0, false));
        let row = TallTableSelection::new(Kind::Rows, (1, 3), (1, 3));
        // Forward from before the row's first cell.
        sheet.update(|table, cx| table.set_selection(Some(row), cx));
        assert_eq!(sheet.next(), (1, 1, false));
        // Backward from after its last.
        sheet.update(|table, cx| table.set_selection(Some(row), cx));
        assert_eq!(sheet.previous(), (1, 1, false));
        let row = TallTableSelection::new(Kind::Rows, (2, 0), (2, 0));
        sheet.update(|table, cx| table.set_selection(Some(row), cx));
        assert_eq!(sheet.previous(), (2, 2, false));
    }

    #[gpui_kit::test]
    fn from_an_upward_rows_range(cx: &mut TestAppContext) {
        let mut sheet = Sheet::open(cx, 900.0);
        plant(&mut sheet);
        // Dragged up from row 3 to row 1: forward from its first row's
        // start, backward from its last row's end, not from its anchor.
        let rows = TallTableSelection::new(Kind::Rows, (3, 0), (1, 0));
        sheet.update(|table, cx| table.set_selection(Some(rows), cx));
        assert_eq!(sheet.next(), (1, 1, false));
        let rows = TallTableSelection::new(Kind::Rows, (3, 0), (1, 0));
        sheet.update(|table, cx| table.set_selection(Some(rows), cx));
        assert_eq!(sheet.previous(), (2, 2, false));
        // Dragged down from row 1 to row 3: the same.
        let rows = TallTableSelection::new(Kind::Rows, (1, 0), (3, 0));
        sheet.update(|table, cx| table.set_selection(Some(rows), cx));
        assert_eq!(sheet.previous(), (2, 2, false));
    }

    #[gpui_kit::test]
    fn a_new_term_starts_from_the_landing(cx: &mut TestAppContext) {
        let mut sheet = Sheet::open(cx, 900.0);
        for (row, column) in [(1, 0), (5, 0)] {
            sheet.plant(row, column, "pear");
        }
        plant(&mut sheet);
        for _ in 0..4 {
            sheet.next();
        }
        assert_eq!(sheet.current(), Some((2, 2)));
        // A new term forgets the match, and the landing's cell on screen
        // is where the next step starts: not the view's top.
        sheet.term("pear");
        assert_eq!(sheet.current(), None);
        assert_eq!(sheet.next(), (5, 0, false));
    }

    #[gpui_kit::test]
    fn a_landing_that_selects_nothing_keeps_the_readers(cx: &mut TestAppContext) {
        let mut sheet = Sheet::open(cx, 900.0);
        plant(&mut sheet);
        let cell = TallTableSelection::new(Kind::Cells, (2, 1), (2, 1));
        sheet.update(|table, cx| table.set_selection(Some(cell), cx));
        // An answer in a column the table doesn't have: no place, so
        // nothing selected.
        sheet.books.borrow_mut().answer_with = Some(super::FoundCell::new(3, 9));
        assert_eq!(sheet.next(), (3, 9, false));
        assert_eq!(sheet.read(|table| table.selection()), Some(cell));
        // The selection is still the reader's: the next step starts there.
        assert_eq!(sheet.next(), (2, 2, false));
    }

    #[gpui_kit::test]
    fn a_narrowed_term_keeps_the_landing(cx: &mut TestAppContext) {
        let mut sheet = Sheet::open(cx, 900.0);
        sheet.plant(5, 0, "pear");
        sheet.plant(8, 0, "peach");
        sheet.reload();
        sheet.term("pe");
        assert_eq!(sheet.next(), (5, 0, false));
        // Narrowed, the landing's cell still matches: found again, from it,
        // not after it, so not round the end.
        sheet.term("pea");
        assert_eq!(sheet.next(), (5, 0, false));
        sheet.term("pear");
        assert_eq!(sheet.previous(), (5, 0, false));
        // The reader's own cell is searched after, as always.
        sheet.update(|table, cx| table.set_selection(None, cx));
        let cell = TallTableSelection::new(Kind::Cells, (5, 0), (5, 0));
        sheet.update(|table, cx| table.set_selection(Some(cell), cx));
        sheet.term("pea");
        assert_eq!(sheet.next(), (8, 0, false));
    }

    #[gpui_kit::test]
    fn the_readers_cell_again_after_a_landing(cx: &mut TestAppContext) {
        let mut sheet = Sheet::open(cx, 900.0);
        plant(&mut sheet);
        assert_eq!(sheet.next(), (0, 0, false));
        // The reader goes elsewhere and back to the landing's cell: it's
        // theirs now, set after the match.
        for at in [(2, 1), (0, 0)] {
            let cell = TallTableSelection::new(Kind::Cells, at, at);
            sheet.update(|table, cx| table.set_selection(Some(cell), cx));
        }
        // A landing that selects nothing, its match in no column the table
        // has: no start, so the reader's cell is.
        sheet.books.borrow_mut().answer_with = Some(super::FoundCell::new(3, 9));
        assert_eq!(sheet.next(), (3, 9, false));
        assert_eq!(sheet.next(), (0, 2, false));
    }

    #[gpui_kit::test]
    fn a_rows_range_past_the_last_row(cx: &mut TestAppContext) {
        let mut sheet = Sheet::open(cx, 900.0);
        plant(&mut sheet);
        // A range no setter would leave (a cut keeps it in the rows): set
        // as the random test's `KeepPastRows` leaves one.
        let rows = TallTableSelection::new(Kind::Rows, (2000, 0), (2001, 0));
        sheet.update(|table, _| table.selection_state.current = Some(rows));
        // Back from the last row's end: the last match, not round the start.
        assert_eq!(sheet.previous(), (6, 3, false));
    }

    #[gpui_kit::test]
    fn a_match_in_a_selection_shows(cx: &mut TestAppContext) {
        let mut sheet = Sheet::open(cx, 900.0);
        plant(&mut sheet);
        let block = TallTableSelection::new(Kind::Cells, (0, 0), (3, 3));
        sheet.update(|table, cx| table.set_selection(Some(block), cx));
        assert!(sheet.read(|table| table.selection_state.drawn.tint.is_some()));
        let (matched, _, _) = sheet.colors();
        let drawn = sheet.drawn(1, 1);
        assert_eq!(drawn.tints.len(), 1);
        assert_eq!(drawn.tints[0].1, matched);
        assert_eq!(sheet.outcomes(), Vec::<FindOutcome>::new());
    }
}

#[cfg(feature = "follow")]
#[gpui_kit::test]
fn following_lets_go(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, 900.0);
    sheet.plant(5, 0, "apple");
    sheet.update(|table, cx| table.follow(cx));
    assert!(sheet.read(|table| table.is_following()));
    sheet.term("apple");
    // From the view's top, at the end: round to row 5, out of view.
    assert_eq!(sheet.next(), (5, 0, true));
    assert_eq!(sheet.top(), 5.0);
    assert!(!sheet.read(|table| table.is_following()));
}

// --- the drawing ---

#[gpui_kit::test]
fn the_ranges_and_the_current_match(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, 900.0);
    sheet.plant(0, 0, "apple pie");
    sheet.plant(1, 1, "pie and pie");
    sheet.reload();
    sheet.term("PIE");
    let (matched, current, ring) = sheet.colors();
    let advance = 8.4;
    let drawn = sheet.drawn(0, 0);
    assert_eq!(drawn.tints.len(), 1);
    let (bounds, color) = drawn.tints[0];
    assert_eq!(color, matched);
    assert!((f32::from(bounds.origin.x) - (drawn.x + 6.0 * advance)).abs() < 0.01);
    assert!((f32::from(bounds.size.width) - 3.0 * advance).abs() < 0.01);
    assert_eq!(bounds.origin.y, drawn.cell.origin.y);
    assert_eq!(bounds.size.height, drawn.cell.size.height);
    assert_eq!(drawn.edge, None);
    assert_eq!(sheet.drawn(1, 1).tints.len(), 2);
    // A cell that doesn't match: nothing.
    assert!(sheet.drawn(0, 1).tints.is_empty());
    // The current match: its ranges in `selection`, edged in `ring`.
    assert_eq!(sheet.next(), (0, 0, false));
    let drawn = sheet.drawn(0, 0);
    assert_eq!(drawn.tints[0].1, current);
    assert_eq!(drawn.edge, Some(ring));
    assert_eq!(sheet.drawn(1, 1).edge, None);
    // No term: nothing.
    sheet.update(|table, cx| table.set_find(None, cx));
    assert!(sheet.drawn(0, 0).tints.is_empty());
    assert_eq!(sheet.drawn(0, 0).edge, None);
}

#[gpui_kit::test]
fn a_cut_text(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, 900.0);
    // 200 px holds 21 characters: the term before the cut is ranged, one
    // past it tints the cell.
    sheet.plant(0, 0, "apple and a long tail of words");
    sheet.plant(0, 1, "a long tail of words then apple");
    sheet.reload();
    sheet.term("apple");
    let (matched, _, _) = sheet.colors();
    let before = sheet.drawn(0, 0);
    assert!(before.text.ends_with('…'), "{before:?}");
    assert_eq!(before.tints.len(), 1);
    assert!((f32::from(before.tints[0].0.size.width) - 5.0 * 8.4).abs() < 0.01);
    let past = sheet.drawn(0, 1);
    assert!(past.text.ends_with('…'));
    assert_eq!(past.tints, [(past.cell, matched)]);
}

#[gpui_kit::test]
fn a_rounded_float_tints_the_cell(cx: &mut TestAppContext) {
    let columns = vec![
        TallTableColumn::new("f", ColumnKind::Float),
        TallTableColumn::new("t1", ColumnKind::Text),
        TallTableColumn::new("t2", ColumnKind::Text),
        TallTableColumn::new("t3", ColumnKind::Text),
    ];
    let mut books = Books::default();
    books
        .planted
        .insert((0, 0), Cell::Float(1.234_567_890_123_4));
    books.planted.insert((1, 0), Cell::Null);
    let mut sheet = Sheet::with(cx, 900.0, columns, books);
    sheet.term("0123");
    let (matched, _, _) = sheet.colors();
    let drawn = sheet.drawn(0, 0);
    assert!(!drawn.text.contains("0123"), "{drawn:?}");
    assert_eq!(drawn.tints, [(drawn.cell, matched)]);
    // A NULL never matches.
    sheet.term("null");
    assert!(sheet.drawn(1, 0).tints.is_empty());
}

#[cfg(feature = "format")]
#[gpui_kit::test]
fn a_formatted_text(cx: &mut TestAppContext) {
    let format = crate::NumberFormat::new().decimals(2).grouping(true);
    let columns = vec![
        TallTableColumn::new("f", ColumnKind::Float).format(format),
        TallTableColumn::new("t1", ColumnKind::Text),
        TallTableColumn::new("t2", ColumnKind::Text),
        TallTableColumn::new("t3", ColumnKind::Text),
    ];
    let mut books = Books::default();
    books.planted.insert((0, 0), Cell::Float(1234.5));
    let mut sheet = Sheet::with(cx, 900.0, columns, books);
    sheet.term("234");
    let drawn = sheet.drawn(0, 0);
    assert_eq!(drawn.text, "1,234.50");
    assert_eq!(drawn.tints.len(), 1);
    let left = f32::from(drawn.tints[0].0.origin.x) - drawn.x;
    assert!((left - 2.0 * 8.4).abs() < 0.01);
    // The grouping splits the term: the cell.
    sheet.term("1234");
    let drawn = sheet.drawn(0, 0);
    assert_eq!(drawn.tints[0].0, drawn.cell);
}

#[cfg(feature = "live")]
#[gpui_kit::test]
fn the_current_match_after_its_text_changes(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, 900.0);
    sheet.plant(0, 0, "apple");
    sheet.reload();
    sheet.term("apple");
    assert_eq!(sheet.next(), (0, 0, false));
    sheet.plant(0, 0, "pear");
    sheet.update(|table, cx| {
        table.invalidate_rows(0..1, cx);
    });
    sheet.draw();
    let (_, current, ring) = sheet.colors();
    let drawn = sheet.drawn(0, 0);
    assert_eq!(drawn.text, "pear");
    assert_eq!(drawn.tints, [(drawn.cell, current)]);
    assert_eq!(drawn.edge, Some(ring));
    assert_eq!(sheet.current(), Some((0, 0)));
}

#[gpui_kit::test]
#[expect(
    clippy::single_range_in_vec_init,
    reason = "one range, as the probe answers"
)]
fn the_probes(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, 900.0);
    sheet.update(|table, _| table.probe_cells = true);
    sheet.plant(0, 0, "apple pie");
    sheet.plant(0, 1, "a long tail of words then apple");
    sheet.reload();
    sheet.term("apple");
    assert_eq!(sheet.next(), (0, 0, false));
    sheet.update(|_, cx| cx.notify());
    let cells = sheet
        .events
        .borrow()
        .iter()
        .rev()
        .find_map(|event| match event {
            TallTableEvent::Cells(cells) => Some(cells.clone()),
            _ => None,
        });
    let cells = cells.expect("cells");
    let cell = |column: usize| {
        cells
            .iter()
            .find(|cell| (cell.row, cell.column) == (0, column))
            .cloned()
            .expect("a cell")
    };
    assert_eq!(cell(0).found, Some(crate::FoundProbe::Ranges(vec![0..5])));
    assert!(cell(0).current);
    assert_eq!(cell(1).found, Some(crate::FoundProbe::Cell));
    assert!(!cell(1).current);
    assert_eq!(cell(2).found, None);
    // The probe's ranges are the drawn text's.
    assert_eq!(sheet.drawn(0, 1).tints.len(), 1);
    let probe = sheet.read(|table| table.published_probe.clone().expect("a probe"));
    assert_eq!(probe.find.term.as_deref(), Some("apple"));
    assert_eq!(probe.find.current, Some(FoundCell::new(0, 0)));
    assert!(!probe.find.out);
    let _: Option<SharedString> = None;
}
