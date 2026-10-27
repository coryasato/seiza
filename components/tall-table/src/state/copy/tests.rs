//! `copy`'s native tests (no fixture: TanStack Table has no copy, so no DOM
//! contender builds it). The table's element in a window of GPUI's test
//! app, so the keys go through its contexts, over a source whose reads
//! answer at once or when a test says, each value a function of its row and
//! column (and the source's version, for `live`).

use std::cell::{Cell as Counter, RefCell};
use std::ops::{Range, RangeInclusive};
use std::rc::Rc;

use futures::channel::oneshot;
use gpui_kit::component::scroll::Scrollbar;
use gpui_kit::{
    App, AppContext as _, Context, Entity, InteractiveElement as _, IntoElement, KeyBinding,
    Keystroke, ParentElement as _, Render, Styled as _, TestAppContext, VisualTestContext, Window,
    actions, div, px, size,
};

use super::super::{Drag, Paging, TallTableEvent, TallTableState, row_height};
use crate::column::{ColumnKind, TallTableColumn};
use crate::copy::{CopyFailure, CopyId, CopyOptions, TURN_CELLS, TallTableCopy};
use crate::delegate::{CellValue, PageError, PageLoad, TallTableDelegate, TallTablePage};
use crate::selection::TallTableSelection;

actions!(copy_test, [HostEscape, HostCopy]);

/// A cell's value: of its row, its column, and the source's version when
/// its page was read.
type Values = fn(u64, usize, u64) -> CellValue<'static>;

/// `row * 1000 + column`, a float: its exact text is `{value:?}`.
fn grid(row: u64, column: usize, _: u64) -> CellValue<'static> {
    CellValue::Float((row * 1000 + column as u64) as f64)
}

struct Page {
    rows: Range<u64>,
    version: u64,
    values: Values,
}

impl TallTablePage for Page {
    fn value(&self, row: usize, column: usize) -> Option<CellValue<'_>> {
        let row = self.rows.start + row as u64;
        (row < self.rows.end).then(|| (self.values)(row, column, self.version))
    }

    fn heap_bytes(&self) -> usize {
        1000
    }
}

/// A read not answered yet.
struct Open {
    page: u64,
    request: u64,
    rows: Range<u64>,
    cancelled: bool,
    answer: oneshot::Sender<Result<Page, PageError>>,
}

struct Reads {
    /// `load <page>` and `cancel <page>`, in order.
    log: Vec<String>,
    open: Vec<Open>,
    next: u64,
    /// Reads answer when sent.
    at_once: bool,
    values: Values,
    version: u64,
    /// The most reads open at once (cancelled ones still answering
    /// included).
    peak: usize,
}

struct Source {
    reads: Rc<RefCell<Reads>>,
    page_rows: u64,
}

impl TallTableDelegate for Source {
    type Page = Page;
    type Request = u64;

    fn load_page(&mut self, rows: Range<u64>, _: &mut App) -> (u64, PageLoad<Page>) {
        let mut reads = self.reads.borrow_mut();
        let page = rows.start / self.page_rows;
        let request = reads.next;
        reads.next += 1;
        reads.log.push(format!("load {page}"));
        let answer = Page {
            rows: rows.clone(),
            version: reads.version,
            values: reads.values,
        };
        if reads.at_once {
            return (request, Box::pin(std::future::ready(Ok(answer))));
        }
        let (sender, answered) = oneshot::channel();
        reads.open.push(Open {
            page,
            request,
            rows,
            cancelled: false,
            answer: sender,
        });
        reads.peak = reads.peak.max(reads.open.len());
        (
            request,
            Box::pin(async move { answered.await.unwrap_or(Err(PageError::Cancelled)) }),
        )
    }

    fn cancel(&mut self, request: u64, _: &mut App) {
        let mut reads = self.reads.borrow_mut();
        let read = reads
            .open
            .iter_mut()
            .find(|read| read.request == request)
            .expect("a cancel names an open read");
        read.cancelled = true;
        let page = read.page;
        reads.log.push(format!("cancel {page}"));
    }
}

/// The host: the table's element in a context of its own, whose Escape
/// and Cmd+C count what the table lets through.
struct Shell {
    table: Entity<TallTableState<Source>>,
    escapes: Rc<Counter<usize>>,
    copies: Rc<Counter<usize>>,
}

impl Render for Shell {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        div()
            .key_context("Host")
            .on_action(cx.listener(|this, _: &HostEscape, _, _| {
                this.escapes.set(this.escapes.get() + 1);
            }))
            .on_action(cx.listener(|this, _: &HostCopy, _, _| {
                this.copies.set(this.copies.get() + 1);
            }))
            .size_full()
            .child(crate::TallTable::new(&self.table))
    }
}

/// `count` columns of `kind`, named `c0`, `c1`, …
fn columns(count: usize, kind: ColumnKind) -> Vec<TallTableColumn> {
    (0..count)
        .map(|index| TallTableColumn::new(format!("c{index}"), kind))
        .collect()
}

/// Pages of 100 rows, the rest the table's defaults.
fn paging() -> Paging {
    Paging {
        page_rows: 100,
        ..Paging::default()
    }
}

/// A table of `rows` rows in a window whose viewport holds 20 rows, its
/// first pages read at once, and what it emitted.
struct Sheet {
    cx: VisualTestContext,
    table: Entity<TallTableState<Source>>,
    reads: Rc<RefCell<Reads>>,
    copies: Rc<RefCell<Vec<TallTableCopy>>>,
    read_failed: Rc<Counter<usize>>,
    escapes: Rc<Counter<usize>>,
    host_copies: Rc<Counter<usize>>,
    _subscription: gpui_kit::Subscription,
}

impl Sheet {
    fn open(
        cx: &mut TestAppContext,
        columns: Vec<TallTableColumn>,
        rows: u64,
        paging: Paging,
        values: Values,
    ) -> Self {
        cx.update(|cx| {
            gpui_kit::component::init(cx);
            crate::init(cx);
            cx.bind_keys([
                KeyBinding::new("escape", HostEscape, Some("Host")),
                KeyBinding::new("cmd-c", HostCopy, Some("Host")),
            ]);
        });
        let reads = Rc::new(RefCell::new(Reads {
            log: Vec::new(),
            open: Vec::new(),
            next: 0,
            at_once: true,
            values,
            version: 0,
            peak: 0,
        }));
        let (escapes, host_copies): (Rc<Counter<usize>>, Rc<Counter<usize>>) = Default::default();
        let (shell_escapes, shell_copies, source) =
            (escapes.clone(), host_copies.clone(), reads.clone());
        let (shell, cx) = cx.add_window_view(move |_, cx| {
            let table = cx.new(|cx| {
                let delegate = Source {
                    reads: source,
                    page_rows: paging.page_rows,
                };
                TallTableState::new(delegate, columns, rows, paging, cx)
            });
            Shell {
                table,
                escapes: shell_escapes,
                copies: shell_copies,
            }
        });
        let table = shell.read_with(cx, |shell, _| shell.table.clone());
        let (gutter, bar) = table.read_with(cx, |table, _| {
            (table.gutter_width(), f32::from(Scrollbar::width()))
        });
        let row_h = f32::from(row_height());
        cx.simulate_resize(size(
            px(600.0 + gutter + bar + 2.0),
            px(20.0 * row_h + row_h + bar + 2.0),
        ));
        let copies: Rc<RefCell<Vec<TallTableCopy>>> = Rc::default();
        let read_failed: Rc<Counter<usize>> = Rc::default();
        let subscription = cx.update(|_, cx| {
            let (copies, read_failed) = (copies.clone(), read_failed.clone());
            cx.subscribe(&table, move |_, event: &TallTableEvent, _| match event {
                TallTableEvent::Copy(copy) => copies.borrow_mut().push(copy.clone()),
                TallTableEvent::ReadFailed => read_failed.set(read_failed.get() + 1),
                _ => {}
            })
        });
        let mut sheet = Self {
            cx: cx.clone(),
            table,
            reads,
            copies,
            read_failed,
            escapes,
            host_copies,
            _subscription: subscription,
        };
        sheet.draw();
        let handle = sheet.read(|table| table.focus_handle.clone());
        sheet.cx.update(|window, cx| window.focus(&handle, cx));
        sheet.draw();
        assert_eq!(sheet.read(|table| table.scroll.viewport_rows()), 20.0);
        sheet
    }

    fn draw(&mut self) {
        for _ in 0..2 {
            self.cx.run_until_parked();
            self.cx.update(|window, cx| window.draw(cx).clear(cx));
        }
    }

    fn read<T>(&mut self, read: impl FnOnce(&TallTableState<Source>) -> T) -> T {
        self.table.read_with(&self.cx, |table, _| read(table))
    }

    fn update<T>(
        &mut self,
        update: impl FnOnce(&mut TallTableState<Source>, &mut Context<TallTableState<Source>>) -> T,
    ) -> T {
        let result = self.table.update(&mut self.cx, update);
        self.draw();
        result
    }

    /// Reads hold until a test answers them from now on.
    fn hold(&mut self) {
        self.reads.borrow_mut().at_once = false;
    }

    fn select(&mut self, selection: TallTableSelection) {
        self.update(|table, cx| table.select(Some(selection), cx));
    }

    fn copy(&mut self) -> Option<CopyId> {
        self.update(|table, cx| table.copy(cx))
    }

    fn key(&mut self, keys: &str) {
        self.cx.simulate_keystrokes(keys);
        self.draw();
    }

    /// The pages of the reads still open, cancelled ones included.
    fn open_pages(&self) -> Vec<u64> {
        self.reads
            .borrow()
            .open
            .iter()
            .map(|read| read.page)
            .collect()
    }

    /// Answers the first open read of `page` (`Cancelled` if it was), with
    /// `answer` or its rows.
    fn answer_with(&mut self, page: u64, answer: Option<Result<Page, PageError>>) {
        let read = {
            let mut reads = self.reads.borrow_mut();
            let index = reads
                .open
                .iter()
                .position(|read| read.page == page)
                .unwrap_or_else(|| panic!("no read of page {page} is open"));
            let read = reads.open.remove(index);
            let page = Page {
                rows: read.rows.clone(),
                version: reads.version,
                values: reads.values,
            };
            let answer = match (read.cancelled, answer) {
                (true, _) => Err(PageError::Cancelled),
                (false, Some(answer)) => answer,
                (false, None) => Ok(page),
            };
            (read.answer, answer)
        };
        let _ = read.0.send(read.1);
        self.draw();
    }

    fn answer(&mut self, page: u64) {
        self.answer_with(page, None);
    }

    /// Answers the last open read of `page` with its rows: of two reads of
    /// a page, the later.
    fn answer_last(&mut self, page: u64) {
        let (sender, answer) = {
            let mut reads = self.reads.borrow_mut();
            let index = reads
                .open
                .iter()
                .rposition(|read| read.page == page)
                .unwrap_or_else(|| panic!("no read of page {page} is open"));
            let read = reads.open.remove(index);
            assert!(!read.cancelled);
            let page = Page {
                rows: read.rows,
                version: reads.version,
                values: reads.values,
            };
            (read.answer, Ok(page))
        };
        let _ = sender.send(answer);
        self.draw();
    }

    /// The copy's reads in flight and the cancelled reads still answering.
    fn places_held(&mut self) -> (usize, usize) {
        self.read(|table| (table.cache.copy_reads(), table.cache.draining()))
    }

    /// The pages the running copy holds, landed and waiting for their turn
    /// (none once it ends).
    fn landed(&mut self) -> Vec<u64> {
        self.read(|table| {
            let running = table.copy_state.running.as_ref();
            running.map_or(Vec::new(), |running| {
                running.landed.iter().map(|(page, _)| *page).collect()
            })
        })
    }

    /// Answers every read, oldest first, until none is open.
    fn answer_all(&mut self) {
        while let Some(page) = self.open_pages().first().copied() {
            self.answer(page);
        }
    }

    /// The loads and cancels logged since the last call.
    fn take_log(&mut self) -> Vec<String> {
        std::mem::take(&mut self.reads.borrow_mut().log)
    }

    fn take_copies(&mut self) -> Vec<TallTableCopy> {
        std::mem::take(&mut self.copies.borrow_mut())
    }

    /// The text of `events`' pieces, joined.
    fn text_of(events: &[TallTableCopy]) -> String {
        events
            .iter()
            .filter_map(|event| match event {
                TallTableCopy::Text { text, .. } => Some(text.as_str()),
                _ => None,
            })
            .collect()
    }
}

/// The TSV of `rows` × `columns` of `values` (version 0), none quoted.
fn tsv(rows: RangeInclusive<u64>, columns: RangeInclusive<usize>, values: Values) -> String {
    rows.map(|row| {
        columns
            .clone()
            .map(|column| match values(row, column, 0) {
                CellValue::Null => String::new(),
                value => value.to_string(),
            })
            .collect::<Vec<_>>()
            .join("\t")
    })
    .collect::<Vec<_>>()
    .join("\n")
}

fn rows(first: u64, last: u64) -> TallTableSelection {
    TallTableSelection::Rows {
        anchor: (first, 0),
        head: (last, 0),
    }
}

fn cells(anchor: (u64, usize), head: (u64, usize)) -> TallTableSelection {
    TallTableSelection::Cells { anchor, head }
}

/// A sheet of 1000 rows × 4 grid columns, pages 0 to 2 loaded.
fn open(cx: &mut TestAppContext) -> Sheet {
    let sheet = Sheet::open(cx, columns(4, ColumnKind::Float), 1000, paging(), grid);
    assert_eq!(sheet.reads.borrow().log, ["load 0", "load 1", "load 2"]);
    sheet
}

/// The kinds of `events`, as words, for an order check.
fn kinds(events: &[TallTableCopy]) -> Vec<&'static str> {
    events
        .iter()
        .map(|event| match event {
            TallTableCopy::Declined { .. } => "declined",
            TallTableCopy::Started { .. } => "started",
            TallTableCopy::Text { .. } => "text",
            TallTableCopy::Copied { .. } => "copied",
            TallTableCopy::Failed { .. } => "failed",
        })
        .collect()
}

// --- the text ---

#[gpui_kit::test]
fn a_block_rows_and_columns(cx: &mut TestAppContext) {
    let mut sheet = open(cx);
    sheet.select(cells((4, 2), (2, 1)));
    let id = sheet.copy().expect("a copy");
    let events = sheet.take_copies();
    assert_eq!(
        events,
        [
            TallTableCopy::Started {
                id,
                rows: 2..=4,
                columns: 1..=2
            },
            TallTableCopy::Text {
                id,
                text: "2001.0\t2002.0\n3001.0\t3002.0\n4001.0\t4002.0".into(),
                rows_done: 3
            },
            TallTableCopy::Copied {
                id,
                rows: 3,
                bytes: 41
            },
        ]
    );
    sheet.select(rows(5, 6));
    sheet.copy();
    let text = Sheet::text_of(&sheet.take_copies());
    assert_eq!(text, tsv(5..=6, 0..=3, grid), "every column");
    // A `Columns` range: every row the table has at the key, those a later
    // `set_rows` adds not copied.
    sheet.hold();
    sheet.select(TallTableSelection::Columns {
        anchor: (0, 1),
        head: (0, 1),
    });
    sheet.copy();
    sheet.update(|table, cx| table.set_rows(1500, cx));
    sheet.answer_all();
    let events = sheet.take_copies();
    assert_eq!(kinds(&events).last(), Some(&"copied"));
    assert_eq!(Sheet::text_of(&events), tsv(0..=999, 1..=1, grid));
}

/// Each column a kind of value to write: text with a tab, a quote, and a
/// line break; a float that rounds when drawn; NULL.
fn awkward(row: u64, column: usize, _: u64) -> CellValue<'static> {
    match column {
        0 => CellValue::Text("a\tb".into()),
        1 => CellValue::Text("say \"x\"".into()),
        2 => CellValue::Float(0.1 + 0.2 + row as f64),
        3 => CellValue::Null,
        _ => CellValue::Text("one\r\ntwo".into()),
    }
}

#[gpui_kit::test]
fn values_exact_quoted_and_null_empty(cx: &mut TestAppContext) {
    let mut columns = columns(5, ColumnKind::Text);
    columns[2] = TallTableColumn::new("a\"b", ColumnKind::Float);
    let mut sheet = Sheet::open(cx, columns, 1000, paging(), awkward);
    sheet.select(rows(0, 1));
    sheet.copy();
    let line = |float: &str| format!("\"a\tb\"\t\"say \"\"x\"\"\"\t{float}\t\t\"one\r\ntwo\"");
    let expected = format!("{}\n{}", line("0.30000000000000004"), line("1.3"));
    assert_eq!(Sheet::text_of(&sheet.take_copies()), expected);
    // Exact, not as drawn: the float column draws it rounded.
    let shown = sheet
        .read(|table| super::super::shown_text(&table.columns[2], CellValue::Float(0.1 + 0.2)));
    assert_eq!(shown, "0.3");
    // One cell: its value alone, no line break.
    sheet.select(cells((0, 2), (0, 2)));
    sheet.copy();
    assert_eq!(Sheet::text_of(&sheet.take_copies()), "0.30000000000000004");
    sheet.select(cells((0, 3), (0, 3)));
    sheet.copy();
    let events = sheet.take_copies();
    assert_eq!(
        kinds(&events),
        ["started", "copied"],
        "an empty cell: no piece"
    );
    // With headers: the names, quoted by the same rule, as a first line.
    sheet.update(|table, _| table.set_copy_options(CopyOptions::default().headers(true)));
    sheet.select(cells((0, 1), (1, 2)));
    sheet.copy();
    assert_eq!(
        Sheet::text_of(&sheet.take_copies()),
        "c1\t\"a\"\"b\"\n\"say \"\"x\"\"\"\t0.30000000000000004\n\"say \"\"x\"\"\"\t1.3"
    );
}

// --- the keys ---

#[gpui_kit::test]
fn the_keys_copy_and_nothing_selected_goes_on(cx: &mut TestAppContext) {
    let mut sheet = open(cx);
    sheet.select(cells((0, 0), (0, 0)));
    for key in ["cmd-c", "ctrl-c"] {
        sheet.key(key);
        let events = sheet.take_copies();
        assert_eq!(kinds(&events), ["started", "text", "copied"], "{key}");
        assert_eq!(Sheet::text_of(&events), "0.0");
    }
    assert_eq!(sheet.host_copies.get(), 0, "the table's");
    sheet.update(|table, cx| table.select(None, cx));
    sheet.key("cmd-c");
    assert_eq!(sheet.host_copies.get(), 1, "nothing selected: the host's");
    assert!(sheet.take_copies().is_empty());
    assert_eq!(sheet.copy(), None);
}

#[gpui_kit::test]
fn past_the_keys_limit_its_declined(cx: &mut TestAppContext) {
    let mut sheet = open(cx);
    sheet.update(|table, _| table.set_copy_options(CopyOptions::default().key_max_cells(10)));
    sheet.hold();
    sheet.select(rows(0, 999));
    sheet.take_log();
    sheet.key("cmd-c");
    assert_eq!(
        sheet.take_copies(),
        [TallTableCopy::Declined {
            rows: 1000,
            columns: 4
        }]
    );
    assert!(sheet.take_log().is_empty(), "nothing read");
    assert_eq!(sheet.read(|table| table.copying()), None, "no copy");
    // The host's confirmation copies it.
    sheet.copy().expect("a copy");
    sheet.answer_all();
    let events = sheet.take_copies();
    assert_eq!(kinds(&events).last(), Some(&"copied"));
    assert_eq!(Sheet::text_of(&events), tsv(0..=999, 0..=3, grid));
}

#[gpui_kit::test]
fn escape_cancels_a_copy_then_clears(cx: &mut TestAppContext) {
    let mut sheet = open(cx);
    sheet.hold();
    sheet.select(rows(0, 999));
    let id = sheet.copy().unwrap();
    assert!(sheet.read(|table| table.copying()).is_some());
    sheet.key("escape");
    assert_eq!(
        sheet.take_copies().last(),
        Some(&TallTableCopy::Failed {
            id,
            reason: CopyFailure::Cancelled
        })
    );
    assert_eq!(sheet.read(|table| table.copying()), None);
    assert_eq!(sheet.read(|table| table.selection()), Some(rows(0, 999)));
    sheet.key("escape");
    assert_eq!(sheet.read(|table| table.selection()), None);
    assert_eq!(sheet.escapes.get(), 0);
}

#[gpui_kit::test]
fn started_reaches_a_subscriber_in_the_task_that_asked(cx: &mut TestAppContext) {
    let mut sheet = open(cx);
    // Rows loaded, within a turn: the whole copy in the key's task.
    sheet.select(cells((0, 0), (2, 3)));
    let key = Keystroke::parse("cmd-c").unwrap();
    sheet
        .cx
        .update(|window, cx| window.dispatch_keystroke(key.clone(), cx));
    assert_eq!(kinds(&sheet.take_copies()), ["started", "text", "copied"]);
    // Rows to read: its start in the key's task, and the rows loaded
    // (pages 0 to 2) in its first turn; the rest later.
    sheet.hold();
    sheet.select(rows(0, 999));
    sheet
        .cx
        .update(|window, cx| window.dispatch_keystroke(key.clone(), cx));
    assert_eq!(kinds(&sheet.take_copies()), ["started", "text"]);
    // And from a host's update that calls `copy`.
    let id = sheet
        .table
        .update(&mut sheet.cx, |table, cx| table.copy(cx))
        .unwrap();
    let events = sheet.take_copies();
    assert!(
        matches!(events.get(1), Some(TallTableCopy::Started { id: started, .. }) if *started == id),
        "{events:?}"
    );
}

// --- the reads ---

#[gpui_kit::test]
fn a_copy_reads_beside_the_cache(cx: &mut TestAppContext) {
    let mut sheet = open(cx);
    sheet.hold();
    sheet.select(rows(0, 999));
    let (pages, bytes) = sheet.read(|table| (table.cache.loaded_pages(), table.cache.used_bytes()));
    sheet.take_log();
    let id = sheet.copy().unwrap();
    // Pages 0 to 2 from the cache, at once; then two reads (one fewer than
    // `max_in_flight`), from the turn's page.
    assert_eq!(sheet.take_log(), ["load 3", "load 4"]);
    let progress = sheet.read(|table| table.copying()).unwrap();
    assert_eq!(
        (progress.id, progress.rows_done, progress.rows),
        (id, 300, 1000)
    );
    // Out of order: page 4 waits for page 3, and holds its place in the
    // copy's two.
    sheet.answer(4);
    assert_eq!(sheet.read(|table| table.copying()).unwrap().rows_done, 300);
    assert!(sheet.take_log().is_empty());
    sheet.answer(3);
    assert_eq!(sheet.read(|table| table.copying()).unwrap().rows_done, 500);
    assert_eq!(sheet.take_log(), ["load 5", "load 6"]);
    while !sheet.open_pages().is_empty() {
        assert!(sheet.open_pages().len() <= 2, "{:?}", sheet.open_pages());
        sheet.answer_all();
    }
    let events = sheet.take_copies();
    assert_eq!(kinds(&events).last(), Some(&"copied"));
    assert_eq!(Sheet::text_of(&events), tsv(0..=999, 0..=3, grid));
    assert!(sheet.reads.borrow().peak <= 2);
    // Never cached.
    let after = sheet.read(|table| (table.cache.loaded_pages(), table.cache.used_bytes()));
    assert_eq!(after, (pages, bytes));
    assert_eq!(sheet.read(|table| table.cache.draining()), 0);
}

#[gpui_kit::test]
fn none_while_a_visible_page_loads_then_before_prefetch(cx: &mut TestAppContext) {
    let mut sheet = open(cx);
    sheet.hold();
    sheet.take_log();
    sheet.update(|table, cx| table.jump_to(500, cx));
    assert_eq!(sheet.take_log(), ["load 5"]);
    sheet.select(rows(0, 999));
    sheet.copy();
    assert!(sheet.take_log().is_empty(), "page 5 is loading");
    sheet.answer(5);
    let log = sheet.take_log();
    assert_eq!(log[..2], ["load 3", "load 4"], "the copy's first: {log:?}");
    assert_eq!(log.len(), 3, "then prefetch's one place: {log:?}");
}

#[gpui_kit::test]
fn at_one_in_flight_a_copy_completes(cx: &mut TestAppContext) {
    let paging = Paging {
        max_in_flight: 1,
        ..paging()
    };
    let mut sheet = Sheet::open(cx, columns(4, ColumnKind::Float), 1000, paging, grid);
    sheet.answer_all();
    sheet.hold();
    sheet.select(rows(0, 999));
    sheet.take_log();
    sheet.copy();
    let log = sheet.take_log();
    assert_eq!(log.len(), 1, "one read: {log:?}");
    // A page scrolled into view waits behind it.
    sheet.update(|table, cx| table.jump_to(900, cx));
    assert!(sheet.take_log().is_empty());
    let first = sheet.open_pages()[0];
    sheet.answer(first);
    assert_eq!(sheet.take_log(), ["load 9"], "the visible page next");
    sheet.answer_all();
    let events = sheet.take_copies();
    assert_eq!(kinds(&events).last(), Some(&"copied"));
    assert_eq!(Sheet::text_of(&events), tsv(0..=999, 0..=3, grid));
    assert!(sheet.reads.borrow().peak <= 1);
}

#[gpui_kit::test]
fn a_page_evicted_before_its_turn_is_read_then(cx: &mut TestAppContext) {
    // 500 columns make a turn 32 rows.
    let mut sheet = Sheet::open(cx, columns(500, ColumnKind::Float), 1000, paging(), grid);
    // The reader leaves pages 0 to 2, loaded.
    sheet.update(|table, cx| table.jump_to(900, cx));
    sheet.hold();
    sheet.select(rows(0, 299));
    sheet.take_log();
    // Pages 1 and 2 go before the turns reach them, as the budget evicts a
    // page the reader left.
    sheet.update(|table, cx| {
        table.copy(cx);
        table.cache.evict_page(1);
        table.cache.evict_page(2);
    });
    // Page 0 copied from the cache, page 1 read at its turn and page 2
    // ahead of its.
    assert_eq!(sheet.take_log(), ["load 1", "load 2"]);
    assert_eq!(sheet.read(|table| table.copying()).unwrap().rows_done, 100);
    sheet.answer_all();
    let events = sheet.take_copies();
    assert_eq!(kinds(&events).last(), Some(&"copied"));
    assert_eq!(Sheet::text_of(&events), tsv(0..=299, 0..=499, grid));
}

#[gpui_kit::test]
fn a_wide_page_goes_in_pieces(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, columns(500, ColumnKind::Float), 1000, paging(), grid);
    sheet.select(rows(0, 99));
    sheet.copy();
    let events = sheet.take_copies();
    let pieces: Vec<&String> = events
        .iter()
        .filter_map(|event| match event {
            TallTableCopy::Text { text, .. } => Some(text),
            _ => None,
        })
        .collect();
    assert_eq!(pieces.len(), 4, "100 rows, 32 a turn");
    for piece in &pieces {
        let cells = piece.split(['\t', '\n']).count() as u64;
        assert!(cells <= TURN_CELLS, "{cells} cells");
    }
    let rows_done: Vec<u64> = events
        .iter()
        .filter_map(|event| match event {
            TallTableCopy::Text { rows_done, .. } => Some(*rows_done),
            _ => None,
        })
        .collect();
    assert_eq!(rows_done, [32, 64, 96, 100]);
    assert_eq!(Sheet::text_of(&events), tsv(0..=99, 0..=499, grid));
}

// --- races with the cache's reads ---

/// No page twice in `log`'s loads.
fn loaded_once(log: &[String]) {
    let loads: Vec<&String> = log.iter().filter(|line| line.starts_with("load")).collect();
    for (index, load) in loads.iter().enumerate() {
        assert!(!loads[..index].contains(load), "{load} twice: {log:?}");
    }
}

#[gpui_kit::test]
fn a_page_the_cache_is_reading_isnt_read_again(cx: &mut TestAppContext) {
    let mut sheet = open(cx);
    sheet.hold();
    sheet.take_log();
    sheet.update(|table, cx| table.jump_to(300, cx));
    assert_eq!(sheet.take_log(), ["load 3"]);
    sheet.select(rows(0, 999));
    sheet.copy();
    // Its turn's page is the cache's to read; page 4 waits for page 3, a
    // visible page, to load.
    assert!(sheet.take_log().is_empty());
    sheet.answer(3);
    let log = sheet.take_log();
    assert_eq!(
        log.first().map(String::as_str),
        Some("load 4"),
        "the copy's: {log:?}"
    );
    loaded_once(&log);
    while !sheet.open_pages().is_empty() {
        sheet.answer_all();
    }
    let events = sheet.take_copies();
    assert_eq!(kinds(&events).last(), Some(&"copied"));
    assert_eq!(Sheet::text_of(&events), tsv(0..=999, 0..=3, grid));
    assert_eq!(sheet.places_held(), (0, 0));
}

/// Pages 0 to 2 loaded, the copy of `last` + 1 rows reading pages 3 and 4,
/// then the reader on row 400: the cache reads page 4 too (a visible page
/// is read whatever the copy reads), and its read lands first.
fn copy_racing_the_cache(cx: &mut TestAppContext, last: u64) -> Sheet {
    let mut sheet = open(cx);
    sheet.hold();
    sheet.select(rows(0, last));
    sheet.take_log();
    sheet.copy();
    assert_eq!(sheet.take_log(), ["load 3", "load 4"]);
    sheet.update(|table, cx| table.jump_to(400, cx));
    assert_eq!(sheet.take_log(), ["load 4"], "the visible page");
    sheet.answer_last(4);
    // Page 3 is the copy's to read: prefetch leaves it.
    loaded_once(&sheet.take_log());
    sheet.answer(3);
    sheet
}

#[gpui_kit::test]
fn a_copy_ending_on_the_caches_page_frees_its_own_read(cx: &mut TestAppContext) {
    let mut sheet = copy_racing_the_cache(cx, 499);
    let events = sheet.take_copies();
    assert_eq!(
        kinds(&events).last(),
        Some(&"copied"),
        "page 4 from the cache"
    );
    assert_eq!(Sheet::text_of(&events), tsv(0..=499, 0..=3, grid));
    let log = sheet.take_log();
    assert!(
        log.contains(&"cancel 4".to_string()),
        "its own read: {log:?}"
    );
    sheet.answer_all();
    // Every place back: no read of the copy's holds one.
    assert_eq!(sheet.places_held(), (0, 0));
}

#[gpui_kit::test]
fn a_page_passed_on_the_caches_copy_is_let_go(cx: &mut TestAppContext) {
    let mut sheet = copy_racing_the_cache(cx, 999);
    assert_eq!(sheet.read(|table| table.copying()).unwrap().rows_done, 500);
    let log = sheet.take_log();
    assert!(
        log.contains(&"cancel 4".to_string()),
        "its own read: {log:?}"
    );
    sheet.answer(4);
    assert!(!sheet.landed().contains(&4), "behind the turn");
    while !sheet.open_pages().is_empty() {
        sheet.answer_all();
        assert!(sheet.landed().len() <= 2);
    }
    let events = sheet.take_copies();
    assert_eq!(kinds(&events).last(), Some(&"copied"));
    assert_eq!(Sheet::text_of(&events), tsv(0..=999, 0..=3, grid));
    assert_eq!(sheet.places_held(), (0, 0));
}

#[gpui_kit::test]
fn a_page_the_cache_failed_to_read_is_read_by_the_copy(cx: &mut TestAppContext) {
    let mut sheet = open(cx);
    sheet.hold();
    sheet.update(|table, cx| table.jump_to(300, cx));
    sheet.select(rows(0, 399));
    sheet.take_log();
    sheet.copy();
    let failure = PageError::Failed {
        message: "once".into(),
        read_failure: false,
    };
    sheet.answer_with(3, Some(Err(failure)));
    assert_eq!(sheet.take_log().first().map(String::as_str), Some("load 3"));
    sheet.answer_all();
    let events = sheet.take_copies();
    assert_eq!(kinds(&events).last(), Some(&"copied"));
    assert_eq!(Sheet::text_of(&events), tsv(0..=399, 0..=3, grid));
}

#[gpui_kit::test]
fn a_page_the_cache_stops_reading_is_read_by_the_copy(cx: &mut TestAppContext) {
    let mut sheet = open(cx);
    sheet.hold();
    sheet.update(|table, cx| table.jump_to(300, cx));
    sheet.select(rows(0, 399));
    sheet.copy();
    // The reader leaves: the cache's read of page 3 is cancelled.
    sheet.take_log();
    sheet.update(|table, cx| table.jump_to(900, cx));
    assert!(sheet.take_log().contains(&"cancel 3".to_string()));
    while !sheet.open_pages().is_empty() {
        sheet.answer_all();
    }
    let events = sheet.take_copies();
    assert_eq!(kinds(&events).last(), Some(&"copied"));
    assert_eq!(Sheet::text_of(&events), tsv(0..=399, 0..=3, grid));
    assert_eq!(sheet.places_held(), (0, 0));
}

/// At one read in flight, a page scrolled into view while the copy's last
/// read is out: the copy ends (copied, or refused at its cap) as that read
/// lands, and the place it frees goes to the visible page then.
#[gpui_kit::test]
fn a_copys_end_gives_its_place_to_the_reader(cx: &mut TestAppContext) {
    for refused in [false, true] {
        let mut cx = cx.clone();
        let paging = Paging {
            max_in_flight: 1,
            ..paging()
        };
        let mut sheet = Sheet::open(&mut cx, columns(4, ColumnKind::Float), 1000, paging, grid);
        sheet.answer_all();
        sheet.hold();
        if refused {
            let max_bytes = tsv(0..=299, 0..=3, grid).len() + 5;
            sheet.update(|table, _| {
                table.set_copy_options(CopyOptions::default().max_bytes(max_bytes))
            });
        }
        sheet.select(rows(0, 399));
        sheet.take_log();
        sheet.copy();
        assert_eq!(sheet.take_log(), ["load 3"]);
        sheet.update(|table, cx| table.jump_to(900, cx));
        assert!(sheet.take_log().is_empty(), "no place");
        sheet.answer(3);
        let events = sheet.take_copies();
        let end = if refused { "failed" } else { "copied" };
        assert_eq!(kinds(&events).last(), Some(&end));
        assert_eq!(sheet.take_log(), ["load 9"], "refused: {refused}");
    }
}

#[cfg(feature = "live")]
#[gpui_kit::test]
fn a_resting_drag_lets_the_copy_read(cx: &mut TestAppContext) {
    let mut sheet = open(cx);
    sheet.hold();
    sheet.select(rows(0, 999));
    sheet.take_log();
    sheet.copy();
    assert_eq!(sheet.take_log(), ["load 3", "load 4"]);
    // A scrollbar drag held still past its settle: reads go on, as a page
    // landing's do.
    sheet.update(|table, _| {
        table.drag = Some(Drag::Vertical { grab: 0.0 });
        table.drag_resting = true;
    });
    sheet.answer(3);
    assert!(sheet.take_log().contains(&"load 5".to_string()));
    // Moving: no read until it rests or ends.
    sheet.update(|table, _| table.drag_resting = false);
    sheet.answer(4);
    assert!(sheet.take_log().is_empty());
    sheet.update(|table, cx| table.end_drag(cx));
    assert!(!sheet.take_log().is_empty(), "the release plans");
    while !sheet.open_pages().is_empty() {
        sheet.answer_all();
    }
    let events = sheet.take_copies();
    assert_eq!(kinds(&events).last(), Some(&"copied"));
    assert_eq!(Sheet::text_of(&events), tsv(0..=999, 0..=3, grid));
}

#[gpui_kit::test]
fn a_cache_read_the_plan_cancels_is_the_copys_at_once(cx: &mut TestAppContext) {
    let paging = Paging {
        prefetch: 1,
        max_in_flight: 4,
        ..paging()
    };
    let mut sheet = Sheet::open(cx, columns(4, ColumnKind::Float), 1000, paging, grid);
    sheet.answer_all();
    sheet.hold();
    sheet.take_log();
    sheet.update(|table, cx| table.jump_to(500, cx));
    sheet.answer(5);
    let log = sheet.take_log();
    assert!(
        log.contains(&"load 4".to_string()),
        "prefetch reads page 4: {log:?}"
    );
    // The copy waits for the cache's read of page 4.
    sheet.select(rows(400, 999));
    sheet.copy();
    assert!(sheet.take_log().is_empty());
    // The reader goes back to rows already loaded: the plan cancels page
    // 4's read, and the copy reads it in that same plan.
    sheet.update(|table, cx| table.jump_to(0, cx));
    let log = sheet.take_log();
    let cancel = log.iter().position(|line| line == "cancel 4");
    let load = log.iter().position(|line| line == "load 4");
    assert!(
        matches!((cancel, load), (Some(cancel), Some(load)) if cancel < load),
        "{log:?}"
    );
    while !sheet.open_pages().is_empty() {
        sheet.answer_all();
    }
    let events = sheet.take_copies();
    assert_eq!(kinds(&events).last(), Some(&"copied"));
    assert_eq!(Sheet::text_of(&events), tsv(400..=999, 0..=3, grid));
}

#[gpui_kit::test]
fn nothing_after_close(cx: &mut TestAppContext) {
    let mut sheet = open(cx);
    sheet.select(cells((0, 0), (0, 0)));
    sheet.update(|table, cx| table.close(cx));
    assert_eq!(sheet.copy(), None);
    sheet.key("cmd-c");
    assert!(
        sheet.take_copies().is_empty(),
        "no copy that could never end"
    );
    assert_eq!(sheet.host_copies.get(), 1, "the key goes on");
}

// --- the cap ---

#[gpui_kit::test]
fn separators_past_the_cap_are_refused_before_a_read(cx: &mut TestAppContext) {
    let mut sheet = open(cx);
    sheet.hold();
    sheet.update(|table, _| table.set_copy_options(CopyOptions::default().max_bytes(3998)));
    sheet.select(rows(0, 999));
    sheet.take_log();
    let id = sheet.copy().unwrap();
    assert_eq!(
        sheet.take_copies(),
        [
            TallTableCopy::Started {
                id,
                rows: 0..=999,
                columns: 0..=3
            },
            TallTableCopy::Failed {
                id,
                reason: CopyFailure::TooLarge {
                    bytes: 1000 * 3 + 999,
                    max_bytes: 3998
                }
            },
        ]
    );
    assert!(sheet.take_log().is_empty(), "nothing read");
    // The header line counts: 10 rows' separators fit 45, with the names
    // (`c0\tc1\tc2\tc3` and its line break) they don't.
    sheet.update(|table, _| {
        table.set_copy_options(CopyOptions::default().max_bytes(45).headers(true))
    });
    sheet.select(rows(0, 9));
    let id = sheet.copy().unwrap();
    assert_eq!(
        sheet.take_copies()[1],
        TallTableCopy::Failed {
            id,
            reason: CopyFailure::TooLarge {
                bytes: 30 + 9 + 12,
                max_bytes: 45
            }
        }
    );
}

/// Ten characters a row on the first page, one on the rest.
fn wide_first(row: u64, _: usize, _: u64) -> CellValue<'static> {
    CellValue::Text(if row < 100 { "0123456789" } else { "x" }.into())
}

#[gpui_kit::test]
fn the_first_page_refuses_only_past_twice_the_cap(cx: &mut TestAppContext) {
    // The first page projects 11 bytes a row × 1000 rows, about 11,000;
    // the copy is 100 × 11 + 900 × 2 − 1 = 2,899.
    for (max_bytes, refused) in [(6000, false), (5000, true)] {
        let mut cx = cx.clone();
        let mut sheet = Sheet::open(
            &mut cx,
            columns(1, ColumnKind::Text),
            1000,
            paging(),
            wide_first,
        );
        sheet.hold();
        sheet
            .update(|table, _| table.set_copy_options(CopyOptions::default().max_bytes(max_bytes)));
        sheet.select(rows(0, 999));
        sheet.copy();
        sheet.answer_all();
        let events = sheet.take_copies();
        let last = events.last().unwrap();
        if refused {
            assert!(
                matches!(last, TallTableCopy::Failed { reason: CopyFailure::TooLarge { bytes, .. }, .. } if *bytes > 2 * max_bytes),
                "{last:?}"
            );
            assert_eq!(kinds(&events), ["started", "failed"], "nothing sent");
        } else {
            assert!(
                matches!(last, TallTableCopy::Copied { bytes: 2899, .. }),
                "{last:?}"
            );
        }
    }
}

/// An integer wider than its column's `max_chars`, as a source can write
/// one (a 128-bit value).
fn wide_integer(_: u64, _: usize, _: u64) -> CellValue<'static> {
    CellValue::Text("123456789012345678901234567890".into())
}

#[gpui_kit::test]
fn past_the_cap_at_its_bytes_then_nothing(cx: &mut TestAppContext) {
    let kind = ColumnKind::Integer { max_chars: 20 };
    let mut sheet = Sheet::open(cx, columns(1, kind), 1000, paging(), wide_integer);
    sheet.hold();
    // 31 bytes a row: 31,000 projected, under twice 20,000; refused once
    // the text passes 20,000 (row 646).
    sheet.update(|table, _| table.set_copy_options(CopyOptions::default().max_bytes(20_000)));
    sheet.select(rows(0, 999));
    let id = sheet.copy().unwrap();
    sheet.answer_all();
    let events = sheet.take_copies();
    let sent: usize = Sheet::text_of(&events).len();
    assert!(sent <= 20_000, "{sent}");
    let failed = events
        .iter()
        .position(|event| matches!(event, TallTableCopy::Failed { .. }));
    assert_eq!(failed, Some(events.len() - 1), "nothing after it");
    assert!(matches!(
        events.last(),
        Some(TallTableCopy::Failed { id: failed, reason: CopyFailure::TooLarge { bytes, max_bytes: 20_000 } })
            if *failed == id && *bytes > 20_000
    ));
    assert_eq!(sheet.read(|table| table.cache.draining()), 0);
}

/// 10,000 characters a value.
fn huge(_: u64, _: usize, _: u64) -> CellValue<'static> {
    CellValue::Text("x".repeat(10_000).into())
}

#[gpui_kit::test]
fn the_cap_is_checked_a_row_at_a_time(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, columns(1, ColumnKind::Text), 1000, paging(), huge);
    sheet.update(|table, _| table.set_copy_options(CopyOptions::default().max_bytes(50_000)));
    // 100 loaded rows, one turn's worth: about 1 MB if built whole.
    sheet.select(rows(0, 99));
    sheet.copy();
    let events = sheet.take_copies();
    assert_eq!(kinds(&events), ["started", "failed"]);
    let TallTableCopy::Failed {
        reason: CopyFailure::TooLarge { bytes, .. },
        ..
    } = &events[1]
    else {
        panic!("{events:?}");
    };
    assert!(
        *bytes <= 50_000 + 10_001,
        "refused at the row past it: {bytes}"
    );
}

/// Projected from a page's worth of rows: one wide row, the rest narrow.
fn one_wide_row(row: u64, _: usize, _: u64) -> CellValue<'static> {
    CellValue::Text(
        if row == 99 {
            "w".repeat(200)
        } else {
            "x".into()
        }
        .into(),
    )
}

#[gpui_kit::test]
fn a_page_of_rows_is_projected_not_the_first_pages_tail(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(
        cx,
        columns(1, ColumnKind::Text),
        1000,
        paging(),
        one_wide_row,
    );
    sheet.hold();
    // From page 0's last row: that row alone would project 200 bytes a row
    // over 901 rows, past twice the cap; the copy is about 2,000 bytes.
    sheet.update(|table, _| table.set_copy_options(CopyOptions::default().max_bytes(5_000)));
    sheet.select(rows(99, 999));
    sheet.copy();
    while !sheet.open_pages().is_empty() {
        sheet.answer_all();
    }
    let events = sheet.take_copies();
    assert!(
        matches!(events.last(), Some(TallTableCopy::Copied { rows: 901, .. })),
        "{:?}",
        events.last()
    );
}

#[gpui_kit::test]
fn a_running_copy_keeps_its_cap(cx: &mut TestAppContext) {
    let mut sheet = open(cx);
    sheet.hold();
    sheet.select(rows(0, 999));
    sheet.copy();
    // For the next copy: this one goes on under the cap it started with.
    sheet.update(|table, _| table.set_copy_options(CopyOptions::default().max_bytes(10)));
    while !sheet.open_pages().is_empty() {
        sheet.answer_all();
    }
    let events = sheet.take_copies();
    assert_eq!(kinds(&events).last(), Some(&"copied"));
}

// --- ending ---

#[gpui_kit::test]
fn a_failed_read_fails_it(cx: &mut TestAppContext) {
    for read_failure in [true, false] {
        let mut cx = cx.clone();
        let mut sheet = Sheet::open(&mut cx, columns(4, ColumnKind::Float), 1000, paging(), grid);
        sheet.hold();
        sheet.select(rows(0, 999));
        let id = sheet.copy().unwrap();
        sheet.take_log();
        let failure = PageError::Failed {
            message: "gone".into(),
            read_failure,
        };
        sheet.answer_with(3, Some(Err(failure)));
        assert_eq!(
            sheet.take_copies().last(),
            Some(&TallTableCopy::Failed {
                id,
                reason: CopyFailure::Read("gone".into())
            })
        );
        assert_eq!(sheet.read_failed.get(), usize::from(read_failure));
        assert_eq!(sheet.take_log(), ["cancel 4"], "its other read");
        sheet.answer_all();
        assert_eq!(sheet.read(|table| table.cache.draining()), 0);
        assert!(sheet.take_copies().is_empty());
    }
}

#[gpui_kit::test]
fn each_cancel_ends_it_and_drains_its_reads(cx: &mut TestAppContext) {
    type Cancel = fn(&mut Sheet);
    let cancels: [(&str, Cancel); 4] = [
        ("a second copy", |sheet| {
            sheet.copy();
        }),
        ("set_columns", |sheet| {
            sheet.update(|table, cx| table.set_columns(columns(4, ColumnKind::Float), cx))
        }),
        ("set_rows under it", |sheet| {
            sheet.update(|table, cx| table.set_rows(999, cx))
        }),
        ("cancel_copy", |sheet| {
            sheet.update(|table, cx| table.cancel_copy(cx))
        }),
    ];
    for (name, cancel) in cancels {
        let mut cx = cx.clone();
        let mut sheet = open(&mut cx);
        sheet.hold();
        sheet.select(rows(0, 999));
        let id = sheet.copy().unwrap();
        sheet.take_log();
        sheet.take_copies();
        cancel(&mut sheet);
        let events = sheet.take_copies();
        assert_eq!(
            events.first(),
            Some(&TallTableCopy::Failed {
                id,
                reason: CopyFailure::Cancelled
            }),
            "{name}"
        );
        let log = sheet.take_log();
        assert!(
            log.starts_with(&["cancel 3".to_string(), "cancel 4".to_string()]),
            "{name}: {log:?}"
        );
        if name == "a second copy" {
            assert_eq!(kinds(&events)[..2], ["failed", "started"]);
        }
        assert!(sheet.read(|table| table.cache.draining()) >= 2, "{name}");
        sheet.answer_all();
        assert_eq!(sheet.read(|table| table.cache.draining()), 0, "{name}");
    }
}

#[gpui_kit::test]
fn close_cancels_its_reads_quietly(cx: &mut TestAppContext) {
    let mut sheet = open(cx);
    sheet.hold();
    sheet.select(rows(0, 999));
    sheet.copy();
    sheet.take_log();
    sheet.take_copies();
    sheet.update(|table, cx| table.close(cx));
    assert_eq!(sheet.take_log(), ["cancel 3", "cancel 4"]);
    assert!(sheet.take_copies().is_empty(), "no event");
    assert_eq!(sheet.read(|table| table.copying()), None);
    sheet.answer_all();
    assert!(sheet.take_copies().is_empty());
}

#[gpui_kit::test]
fn a_selection_change_and_a_scroll_dont_cancel(cx: &mut TestAppContext) {
    let mut sheet = open(cx);
    sheet.hold();
    sheet.select(rows(0, 999));
    sheet.copy();
    sheet.take_copies();
    sheet.key("down");
    sheet.key("pagedown");
    sheet.select(cells((1, 1), (1, 1)));
    assert!(sheet.read(|table| table.copying()).is_some());
    sheet.answer_all();
    let events = sheet.take_copies();
    assert_eq!(kinds(&events).last(), Some(&"copied"));
}

// --- with `live` ---

/// The source's version when the page was read.
#[cfg(feature = "live")]
fn versioned(row: u64, _: usize, version: u64) -> CellValue<'static> {
    CellValue::Float((row * 10 + version) as f64)
}

#[cfg(feature = "live")]
#[gpui_kit::test]
fn a_stale_page_is_copied_as_drawn(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, columns(1, ColumnKind::Float), 1000, paging(), versioned);
    sheet.hold();
    sheet.reads.borrow_mut().version = 1;
    sheet.update(|table, cx| {
        table.invalidate_rows(0..1, cx);
    });
    assert_eq!(sheet.open_pages(), [0], "its re-read out");
    sheet.select(rows(0, 1));
    sheet.copy();
    assert_eq!(
        Sheet::text_of(&sheet.take_copies()),
        "0.0\n10.0",
        "as drawn"
    );
}

#[cfg(feature = "live")]
#[gpui_kit::test]
fn a_grown_last_page_is_read_and_its_rows_copied(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, columns(1, ColumnKind::Float), 150, paging(), grid);
    sheet.hold();
    sheet.update(|table, cx| table.set_rows(250, cx));
    // The cache reads the grown page again; the copy waits for that read
    // rather than reading the page a second time.
    assert!(sheet.take_log().contains(&"load 1".to_string()));
    sheet.select(rows(0, 249));
    sheet.copy();
    let log = sheet.take_log();
    assert!(!log.contains(&"load 1".to_string()), "{log:?}");
    while !sheet.open_pages().is_empty() {
        sheet.answer_all();
    }
    let events = sheet.take_copies();
    assert_eq!(kinds(&events).last(), Some(&"copied"));
    assert_eq!(Sheet::text_of(&events), tsv(0..=249, 0..=0, grid));
}

#[cfg(feature = "live")]
#[gpui_kit::test]
fn a_grown_page_whose_reread_failed_is_read_by_the_copy(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, columns(1, ColumnKind::Float), 150, paging(), grid);
    sheet.hold();
    sheet.update(|table, cx| table.set_rows(250, cx));
    sheet.select(rows(0, 249));
    sheet.copy();
    sheet.take_log();
    // The cache's re-read fails: it won't read the page again until the
    // rows change, so the copy reads it.
    let failure = PageError::Failed {
        message: "once".into(),
        read_failure: false,
    };
    sheet.answer_with(1, Some(Err(failure)));
    assert!(sheet.take_log().contains(&"load 1".to_string()));
    while !sheet.open_pages().is_empty() {
        sheet.answer_all();
    }
    let events = sheet.take_copies();
    assert_eq!(kinds(&events).last(), Some(&"copied"));
    assert_eq!(Sheet::text_of(&events), tsv(0..=249, 0..=0, grid));
}

#[cfg(feature = "live")]
#[gpui_kit::test]
fn a_visible_grown_page_whose_reread_failed_holds_nothing_back(cx: &mut TestAppContext) {
    // 110 rows: page 1's ten are in view, and grow.
    let mut sheet = Sheet::open(cx, columns(1, ColumnKind::Float), 110, paging(), grid);
    sheet.update(|table, cx| table.jump_to(100, cx));
    sheet.hold();
    sheet.update(|table, cx| table.set_rows(1000, cx));
    sheet.select(rows(0, 999));
    sheet.take_log();
    let failure = PageError::Failed {
        message: "once".into(),
        read_failure: false,
    };
    sheet.answer_with(1, Some(Err(failure)));
    sheet.copy();
    assert!(!sheet.take_log().is_empty(), "the copy reads");
    while !sheet.open_pages().is_empty() {
        sheet.answer_all();
    }
    let events = sheet.take_copies();
    assert_eq!(kinds(&events).last(), Some(&"copied"));
    assert_eq!(Sheet::text_of(&events), tsv(0..=999, 0..=0, grid));
}
