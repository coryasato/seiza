//! `replace_rows`, in a window of GPUI's test app, in every build (the
//! paging fixture's `replace` scenarios pin its reads): what it clears and
//! keeps, each target, the swap in the same update (and its control, the
//! swap an update early, drawing a mixed frame), a read out before the call
//! never stored, `set_rows` after it, a closed table; with `select` a
//! `Columns` range at each landing row; with `copy` a copy cancelled; with
//! `follow` following kept at the end; with `sort` the sort told again, its
//! refusal, a later `set_sort`, and `set_columns` in either order; with
//! `live` and `custom-cells` the flashes cleared.

use std::borrow::Cow;
use std::cell::RefCell;
use std::ops::Range;
use std::rc::Rc;

use futures::channel::oneshot;
use gpui_kit::{App, Entity, Modifiers, TestAppContext, VisualTestContext, point, px, size};

use super::super::{TallTableEvent, TallTableState, ViewAt};
use crate::column::{ColumnKind, TallTableColumn};
use crate::delegate::{CellValue, PageError, PageLoad, TallTableDelegate, TallTablePage};
use crate::pages::RowState;
#[cfg(feature = "sort")]
use crate::sort::{Sort, SortDirection, SortRefused};

/// The rows the tables open with.
const ROWS: u64 = 100_000;

// --- the source ---

/// A page as its read was sent: each cell says its source's era and its
/// row, so a frame says which source drew it.
struct Page {
    era: u32,
    first: u64,
}

impl TallTablePage for Page {
    fn value(&self, row: usize, column: usize) -> Option<CellValue<'_>> {
        let text = format!("e{}r{}c{column}", self.era, self.first + row as u64);
        Some(CellValue::Text(Cow::Owned(text)))
    }

    fn heap_bytes(&self) -> usize {
        1024
    }
}

/// A read held open: its request, its page, the era it was sent in, and
/// its answer.
type Held = (u64, u64, u32, oneshot::Sender<Result<Page, PageError>>);

/// What the source was asked, in order, its reads held open, and which
/// source it is (its era: a swap bumps it).
#[derive(Default)]
struct Books {
    log: Vec<String>,
    open: Vec<Held>,
    next: u64,
    /// Reads wait for [`Sheet::answer`]; otherwise they answer when sent.
    hold: bool,
    era: u32,
    /// Every sort refused (`sort`).
    #[cfg(feature = "sort")]
    refuse: bool,
}

struct Source {
    books: Rc<RefCell<Books>>,
}

impl TallTableDelegate for Source {
    type Page = Page;
    type Request = u64;

    fn load_page(&mut self, rows: Range<u64>, _: &mut App) -> (u64, PageLoad<Page>) {
        let mut books = self.books.borrow_mut();
        let request = books.next;
        books.next += 1;
        let page = rows.start / 1024;
        books.log.push(format!("load {page}"));
        let answer = Page {
            era: books.era,
            first: rows.start,
        };
        if !books.hold {
            return (request, Box::pin(std::future::ready(Ok(answer))));
        }
        let (sender, receiver) = oneshot::channel();
        let era = books.era;
        books.open.push((request, page, era, sender));
        (
            request,
            Box::pin(async move { receiver.await.unwrap_or(Err(PageError::Cancelled)) }),
        )
    }

    fn cancel(&mut self, request: u64, _: &mut App) {
        let mut books = self.books.borrow_mut();
        let page = books
            .open
            .iter()
            .find(|(open, ..)| *open == request)
            .map(|(_, page, ..)| *page)
            .expect("an open read");
        books.log.push(format!("cancel {page}"));
    }

    #[cfg(feature = "sort")]
    fn sort(&mut self, keys: &[Sort], _: &mut App) -> Result<(), SortRefused> {
        let sort = keys.first().copied();
        let mut books = self.books.borrow_mut();
        books.log.push(match sort {
            Some(sort) => format!(
                "sort {} {}",
                sort.column,
                super::direction_name(sort.direction)
            ),
            None => "sort none".into(),
        });
        if books.refuse && sort.is_some() {
            return Err(SortRefused::new("refused"));
        }
        Ok(())
    }
}

fn columns(count: usize) -> Vec<TallTableColumn> {
    (0..count)
        .map(|index| {
            let column = TallTableColumn::new(format!("c{index}"), ColumnKind::Text);
            #[cfg(feature = "sort")]
            let column = column.sortable(true);
            column
        })
        .collect()
}

// --- the window ---

/// A table in a 1440×900 window, its events, and the source's books.
struct Sheet<'a> {
    cx: &'a mut VisualTestContext,
    table: Entity<TallTableState<Source>>,
    books: Rc<RefCell<Books>>,
    events: Rc<RefCell<Vec<TallTableEvent>>>,
    _subscription: gpui_kit::Subscription,
}

impl<'a> Sheet<'a> {
    fn open(cx: &'a mut TestAppContext, columns: Vec<TallTableColumn>, hold: bool) -> Self {
        cx.update(|cx| {
            gpui_kit::component::init(cx);
            crate::init(cx);
        });
        let books = Rc::new(RefCell::new(Books {
            hold,
            ..Books::default()
        }));
        let source = Source {
            books: books.clone(),
        };
        let (table, cx) = cx.add_window_view(move |_, cx| {
            TallTableState::new(source, columns, ROWS, Default::default(), cx)
        });
        cx.simulate_resize(size(px(1440.), px(900.)));
        let events: Rc<RefCell<Vec<TallTableEvent>>> = Rc::default();
        let subscription = cx.update(|_, cx| {
            let events = events.clone();
            cx.subscribe(&table, move |_, event: &TallTableEvent, _| match event {
                TallTableEvent::Probe(_)
                | TallTableEvent::Layout(_)
                | TallTableEvent::Scrollbar { .. }
                | TallTableEvent::Filled { .. } => {}
                event => events.borrow_mut().push(event.clone()),
            })
        });
        let mut sheet = Self {
            cx,
            table,
            books,
            events,
            _subscription: subscription,
        };
        sheet.draw();
        sheet.take_log();
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

    fn read<T>(&mut self, read: impl FnOnce(&TallTableState<Source>) -> T) -> T {
        self.table.read_with(self.cx, |table, _| read(table))
    }

    fn update<T>(
        &mut self,
        update: impl FnOnce(
            &mut TallTableState<Source>,
            &mut gpui_kit::Context<TallTableState<Source>>,
        ) -> T,
    ) -> T {
        let result = self.table.update(self.cx, update);
        self.draw();
        result
    }

    fn take_log(&mut self) -> Vec<String> {
        std::mem::take(&mut self.books.borrow_mut().log)
    }

    fn take_events(&mut self) -> Vec<TallTableEvent> {
        std::mem::take(&mut *self.events.borrow_mut())
    }

    /// Answers the oldest open read of `page`.
    fn answer(&mut self, page: u64) {
        let (_, _, era, sender) = {
            let mut books = self.books.borrow_mut();
            let index = books
                .open
                .iter()
                .position(|(_, open, ..)| *open == page)
                .expect("an open read of the page");
            books.open.remove(index)
        };
        let _ = sender.send(Ok(Page {
            era,
            first: page * 1024,
        }));
        self.draw();
    }

    /// The source swapped for another (its era bumped) of `rows` rows, and
    /// `replace_rows` called, in one update.
    fn replace(&mut self, rows: u64, at: ViewAt) {
        let books = self.books.clone();
        self.update(|table, cx| {
            books.borrow_mut().era += 1;
            table.replace_rows(rows, at, cx);
        });
    }

    /// The eras the last frame drew, each once, in order.
    fn eras_drawn(&mut self) -> Vec<u32> {
        let mut eras: Vec<u32> = self.read(|table| {
            table
                .drawn_text
                .borrow()
                .iter()
                .filter_map(|cell| cell.text.strip_prefix('e')?.split('r').next()?.parse().ok())
                .collect()
        });
        eras.sort_unstable();
        eras.dedup();
        eras
    }

    fn top(&mut self) -> f64 {
        self.read(|table| table.scroll.top())
    }
}

#[cfg(feature = "follow")]
fn following_events(events: &[TallTableEvent]) -> Vec<bool> {
    events
        .iter()
        .filter_map(|event| match event {
            TallTableEvent::Following(following) => Some(*following),
            _ => None,
        })
        .collect()
}

// --- the base ---

/// Every page forgotten, the hover, the tooltip, and the jump's mark gone,
/// the sideways scroll kept, the count the new one, and no event of its
/// own.
#[gpui_kit::test]
fn a_replace_forgets_what_is_kept_by_row(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, columns(12), false);
    sheet.update(|table, cx| table.jump_to(5000, cx));
    sheet.update(|table, cx| table.scroll_by(0.0, 120.0, cx));
    // The pointer rested on a cell: its hover and tooltip.
    let at = sheet.read(|table| {
        table.body.origin + point(px(table.gutter_width() + 40.0), table.sizes().row() * 2.5)
    });
    sheet.cx.simulate_mouse_move(at, None, Modifiers::default());
    sheet.draw();
    sheet
        .cx
        .executor()
        .advance_clock(std::time::Duration::from_millis(600));
    sheet.draw();
    let (hovered, marked, scroll_x) =
        sheet.read(|table| (table.hover.is_some(), table.marked, table.scroll_x));
    assert!(hovered && marked == Some(5000) && scroll_x > 0.0);
    sheet.take_events();
    sheet.take_log();
    sheet.replace(40_000, ViewAt::Top);
    let (rows, top, loaded, hover, marked, x) = sheet.read(|table| {
        (
            table.rows(),
            table.scroll.top(),
            table.cache.loaded_pages(),
            table.hover.is_some(),
            table.marked,
            table.scroll_x,
        )
    });
    assert_eq!(
        (rows, top, hover, marked, x),
        (40_000, 0.0, false, None, scroll_x)
    );
    // The top page and its prefetch, of the new source only.
    assert_eq!(loaded, 3);
    assert_eq!(sheet.eras_drawn(), [1]);
    assert!(sheet.read(|table| table.render_tooltip().is_none()));
    // No event of its own; with `select`, the jump's selected row cleared.
    #[cfg(feature = "select")]
    let expected = vec![TallTableEvent::Selected(None)];
    #[cfg(not(feature = "select"))]
    let expected: Vec<TallTableEvent> = Vec::new();
    assert_eq!(sheet.take_events(), expected);
}

/// Each target: the top, a row, a row past the new end (clamped as
/// `jump_to`), the end, and a count of none.
#[gpui_kit::test]
fn each_target_lands_where_it_says(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, columns(2), false);
    let max_top = |sheet: &mut Sheet, rows: u64| {
        rows as f64 - sheet.read(|table| table.scroll.viewport_rows())
    };
    sheet.replace(50_000, ViewAt::Row(20_000));
    assert_eq!(sheet.top(), 20_000.0);
    sheet.replace(50_000, ViewAt::Top);
    assert_eq!(sheet.top(), 0.0);
    sheet.replace(3000, ViewAt::Row(2990));
    let end = max_top(&mut sheet, 3000);
    assert_eq!(sheet.top(), end, "clamped as a jump is");
    sheet.replace(3000, ViewAt::Row(90_000));
    assert_eq!(sheet.top(), end, "a row past the rows: the end");
    sheet.replace(10_000, ViewAt::End);
    let end = max_top(&mut sheet, 10_000);
    assert_eq!(sheet.top(), end);
    assert_eq!(sheet.eras_drawn(), [5]);
    // No mark: a named row isn't highlighted.
    assert_eq!(sheet.read(|table| table.marked), None);
    sheet.take_log();
    for at in [ViewAt::Top, ViewAt::Row(7), ViewAt::End] {
        sheet.replace(0, at);
        assert_eq!(
            sheet.read(|table| (table.rows(), table.scroll.top())),
            (0, 0.0)
        );
        assert!(
            sheet
                .take_log()
                .iter()
                .all(|event| !event.starts_with("load"))
        );
    }
}

/// Swapped in the same update, no frame mixes the two sources' rows; the
/// control, swapped an update early with the view moved between, does.
#[gpui_kit::test]
fn the_swap_in_the_same_update_draws_no_mixed_frame(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, columns(2), false);
    // Rows 1010.. span pages 0 and 1, both loaded.
    sheet.update(|table, cx| table.jump_to(1010, cx));
    assert_eq!(sheet.eras_drawn(), [0]);
    sheet.replace(ROWS, ViewAt::Row(1010));
    assert_eq!(sheet.eras_drawn(), [1], "the new source's rows alone");

    // The control: the source swapped an update early, and a jump then
    // reads a page the old pages are drawn beside: rows across the last
    // loaded page's end, its own (loaded) and the next (read now).
    sheet.update(|table, cx| table.jump_to(5000, cx));
    let last = sheet.read(|table| {
        (4..ROWS / 1024)
            .take_while(|page| matches!(table.cache.row(page * 1024), RowState::Loaded(..)))
            .last()
            .expect("the jump's page loaded")
    });
    sheet.update(|table, _| table.delegate.books.borrow_mut().era += 1);
    sheet.update(|table, cx| table.jump_to((last + 1) * 1024 - 10, cx));
    assert_eq!(
        sheet.eras_drawn(),
        [1, 2],
        "the mixed frame the docs warn of"
    );
    sheet.update(|table, cx| table.replace_rows(ROWS, ViewAt::Top, cx));
    assert_eq!(sheet.eras_drawn(), [2]);
}

/// A read sent to the old source that answers after the call is never
/// stored, whatever it holds; its place is freed.
#[gpui_kit::test]
fn a_read_out_before_the_call_is_never_stored(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, columns(2), true);
    // Page 0's read out, of the old source.
    assert!(
        sheet
            .books
            .borrow()
            .open
            .iter()
            .any(|(_, page, ..)| *page == 0)
    );
    sheet.take_log();
    sheet.replace(ROWS, ViewAt::Top);
    assert_eq!(
        sheet.take_log(),
        ["cancel 0", "load 0"],
        "the old read draining, the new source's top page beside it"
    );
    // The old read answers with a page: dropped, its place freed.
    sheet.answer(0);
    assert_eq!(sheet.read(|table| table.cache.draining()), 0);
    assert!(sheet.read(|table| matches!(table.cache.row(0), RowState::Pending)));
    assert_eq!(sheet.take_log(), Vec::<String>::new());
    sheet.answer(0);
    assert_eq!(sheet.eras_drawn(), [1]);
}

/// `set_rows` after it corrects the count as it would any count: the
/// pages read for the new source kept.
#[gpui_kit::test]
fn set_rows_after_it_corrects_the_count(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, columns(2), false);
    sheet.update(|table, cx| {
        table.delegate.books.borrow_mut().era += 1;
        table.replace_rows(500, ViewAt::Top, cx);
        table.set_rows(20_000, cx);
    });
    let (rows, loaded) = sheet.read(|table| (table.rows(), table.cache.loaded_pages()));
    assert_eq!(rows, 20_000);
    assert!(loaded > 0);
    sheet.update(|table, cx| table.set_rows(30_000, cx));
    assert_eq!(sheet.eras_drawn(), [1]);
    assert!(
        sheet.read(|table| table.cache.loaded_pages()) >= loaded,
        "kept"
    );
}

/// On a closed table the count and the view follow; nothing is read,
/// cancelled, or told.
#[gpui_kit::test]
fn a_closed_table_reads_and_tells_nothing(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, columns(2), false);
    #[cfg(feature = "sort")]
    sheet
        .update(|table, cx| table.set_sort(vec![Sort::new(0, SortDirection::Ascending)], cx))
        .expect("sorted");
    sheet.update(|table, cx| table.close(cx));
    sheet.take_log();
    sheet.replace(8000, ViewAt::End);
    let end = 8000.0 - sheet.read(|table| table.scroll.viewport_rows());
    assert_eq!(
        sheet.read(|table| (table.rows(), table.scroll.top())),
        (8000, end)
    );
    assert_eq!(sheet.take_log(), Vec::<String>::new());
    // The old pages forgotten all the same: a last frame draws none of
    // them under indices that mean other rows.
    assert_eq!(sheet.read(|table| table.cache.loaded_pages()), 0);
    assert_eq!(sheet.eras_drawn(), Vec::<u32>::new());
}

/// A closed table's reads out stay as `close` left them (cancelled, their
/// places held), the loaded pages forgotten: its stats don't change shape.
#[gpui_kit::test]
fn a_closed_tables_reads_stay_as_close_left_them(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, columns(2), true);
    sheet.answer(0);
    sheet.update(|table, cx| table.close(cx));
    let held = |table: &TallTableState<Source>| (table.cache.in_flight(), table.cache.draining());
    let before = sheet.read(held);
    assert_eq!(before.0, 2, "pages 1 and 2's reads out at close");
    sheet.replace(500, ViewAt::Top);
    assert_eq!(sheet.read(held), before);
    assert_eq!(sheet.read(|table| table.cache.loaded_pages()), 0);
}

// --- with each feature ---

/// A `Rows` or `Cells` range cleared; a `Columns` range kept, its rows at
/// the landing row of each target (with no rows, row 0).
#[cfg(feature = "select")]
#[gpui_kit::test]
fn a_columns_range_lands_with_the_view(cx: &mut TestAppContext) {
    use crate::selection::{Kind, TallTableSelection};
    let mut sheet = Sheet::open(cx, columns(4), false);
    for kind in [Kind::Rows, Kind::Cells] {
        let selection = TallTableSelection::new(kind, (40, 1), (60, 2));
        sheet.update(|table, cx| table.set_selection(Some(selection), cx));
        sheet.take_events();
        sheet.replace(ROWS, ViewAt::Top);
        assert_eq!(sheet.read(|table| table.selection()), None, "{kind:?}");
        assert_eq!(sheet.take_events(), [TallTableEvent::Selected(None)]);
    }
    for (rows, at, landing) in [
        (ROWS, ViewAt::Top, 0),
        (ROWS, ViewAt::Row(30_000), 30_000),
        (3000, ViewAt::Row(5000), 2999),
        (3000, ViewAt::End, 2999),
        (0, ViewAt::End, 0),
    ] {
        let selection = TallTableSelection::new(Kind::Columns, (40, 1), (60, 2));
        sheet.replace(ROWS, ViewAt::Top);
        sheet.update(|table, cx| table.set_selection(Some(selection), cx));
        sheet.take_events();
        sheet.replace(rows, at);
        let kept = Some(TallTableSelection::new(
            Kind::Columns,
            (landing, 1),
            (landing, 2),
        ));
        assert_eq!(
            sheet.read(|table| table.selection()),
            kept,
            "{rows} rows, {at:?}"
        );
        assert_eq!(sheet.take_events(), [TallTableEvent::Selected(kept)]);
    }
}

#[cfg(feature = "copy")]
#[gpui_kit::test]
fn a_replace_cancels_a_copy(cx: &mut TestAppContext) {
    use crate::copy::{CopyFailure, TallTableCopy};
    use crate::selection::{Kind, TallTableSelection};
    let mut sheet = Sheet::open(cx, columns(3), true);
    let selection = TallTableSelection::new(Kind::Rows, (0, 0), (5000, 0));
    sheet.update(|table, cx| table.set_selection(Some(selection), cx));
    let id = sheet.update(|table, cx| table.copy(cx)).expect("a copy");
    sheet.take_events();
    sheet.replace(ROWS, ViewAt::Top);
    assert_eq!(sheet.read(|table| table.copy_progress()), None);
    let events = sheet.take_events();
    assert!(
        events.contains(&TallTableEvent::Copy(TallTableCopy::Failed {
            id,
            reason: CopyFailure::Cancelled
        })),
        "{events:?}"
    );
}

/// The end keeps following as it was, on or off, with no event; the top
/// and a row let it go, one `Following(false)`, unless every row fits.
#[cfg(feature = "follow")]
#[gpui_kit::test]
fn the_end_keeps_following_and_the_top_lets_go(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, columns(2), false);
    sheet.update(|table, cx| table.follow(cx));
    sheet.take_events();
    // The same count: the tail drawn is forgotten (its rows are others),
    // so the filled frame at the end says so again, though it didn't grow.
    sheet.replace(ROWS, ViewAt::End);
    assert!(sheet.read(|table| table.is_following()));
    let events = sheet.take_events();
    assert_eq!(following_events(&events), Vec::<bool>::new());
    assert!(
        events.contains(&TallTableEvent::TailDrawn { rows: ROWS }),
        "{events:?}"
    );
    sheet.replace(ROWS, ViewAt::Row(500));
    assert!(!sheet.read(|table| table.is_following()));
    assert_eq!(following_events(&sheet.take_events()), [false]);
    // Not following, the end doesn't start it.
    sheet.replace(ROWS, ViewAt::End);
    assert!(!sheet.read(|table| table.is_following()));
    assert_eq!(following_events(&sheet.take_events()), Vec::<bool>::new());
    // Every row fits: the top keeps it.
    sheet.replace(10, ViewAt::End);
    sheet.update(|table, cx| table.follow(cx));
    sheet.take_events();
    sheet.replace(12, ViewAt::Top);
    assert!(sheet.read(|table| table.is_following()));
    assert_eq!(following_events(&sheet.take_events()), Vec::<bool>::new());
}

#[cfg(all(feature = "live", feature = "custom-cells"))]
#[gpui_kit::test]
fn a_replace_clears_the_flashes(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, columns(2), false);
    sheet.update(|table, cx| {
        let now = table.flashes.now(cx);
        table
            .flashes
            .start(3, 0, 1.0, now, std::time::Duration::from_secs(1));
    });
    sheet.replace(ROWS, ViewAt::Top);
    assert!(sheet.read(|table| table.flashes.is_empty()));
}

/// An invalidation pending when the rows are replaced is forgotten with its
/// page: the new source's page isn't read again for it.
#[cfg(feature = "live")]
#[gpui_kit::test]
fn a_replace_forgets_the_invalidations(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, columns(2), false);
    sheet.update(|table, cx| {
        table.invalidate_rows(0..10, cx);
        table.delegate.books.borrow_mut().era += 1;
        table.replace_rows(ROWS, ViewAt::Top, cx);
    });
    assert_eq!(
        sheet.take_log(),
        ["load 0", "load 1", "load 2"],
        "the new rows read once, page 0 not again for the invalidation"
    );
}

// --- with `sort` ---

#[cfg(feature = "sort")]
fn sorted(events: &[TallTableEvent]) -> Vec<Option<Sort>> {
    events
        .iter()
        .filter_map(|event| match event {
            TallTableEvent::Sorted(keys) => Some(keys.first().copied()),
            _ => None,
        })
        .collect()
}

#[cfg(feature = "sort")]
fn descending() -> Sort {
    Sort::new(1, SortDirection::Descending)
}

/// The new source is told the sort in effect once, after the update,
/// before any read; with no sort, nothing. The sort is kept, no `Sorted`.
#[cfg(feature = "sort")]
#[gpui_kit::test]
fn the_sort_is_told_again_once_before_the_reads(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, columns(3), false);
    sheet.replace(ROWS, ViewAt::Top);
    assert!(
        sheet
            .take_log()
            .iter()
            .all(|event| !event.starts_with("sort"))
    );
    sheet
        .update(|table, cx| table.set_sort(vec![descending()], cx))
        .expect("sorted");
    sheet.take_log();
    sheet.take_events();
    // Nothing told or read inside the update; two replaces tell it once.
    let books = sheet.books.clone();
    let inside = sheet.table.update(sheet.cx, |table, cx| {
        books.borrow_mut().era += 1;
        table.replace_rows(ROWS, ViewAt::Row(3000), cx);
        table.replace_rows(ROWS, ViewAt::Row(30_000), cx);
        books.borrow().log.clone()
    });
    assert_eq!(
        inside,
        Vec::<String>::new(),
        "nothing told or read inside the update"
    );
    sheet.draw();
    let log = sheet.take_log();
    assert_eq!(log[0], "sort 1 descending", "{log:?}");
    assert_eq!(
        log.iter().filter(|event| event.starts_with("sort")).count(),
        1
    );
    assert!(
        log[1..].iter().all(|event| event.starts_with("load")),
        "{log:?}"
    );
    assert_eq!(sheet.read(|table| table.sort().to_vec()), [descending()]);
    assert_eq!(sheet.top(), 30_000.0);
    assert_eq!(sorted(&sheet.take_events()), []);
}

/// While the sort waits to be told, nothing reads: a jump after the
/// replace in the same update reads only after the source hears it.
#[cfg(feature = "sort")]
#[gpui_kit::test]
fn nothing_reads_before_the_sort_is_told(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, columns(3), false);
    sheet
        .update(|table, cx| table.set_sort(vec![descending()], cx))
        .expect("sorted");
    sheet.take_log();
    sheet.update(|table, cx| {
        table.delegate.books.borrow_mut().era += 1;
        table.replace_rows(ROWS, ViewAt::Top, cx);
        table.jump_to(40_000, cx);
    });
    let log = sheet.take_log();
    assert_eq!(log[0], "sort 1 descending", "{log:?}");
    assert_eq!(sheet.eras_drawn(), [1]);
}

/// The log as each `Sorted` or `SortRefused` reached a subscriber.
#[cfg(feature = "sort")]
fn log_at_sort_events(sheet: &mut Sheet) -> Rc<RefCell<Vec<Vec<String>>>> {
    let heard: Rc<RefCell<Vec<Vec<String>>>> = Rc::default();
    let (books, record) = (sheet.books.clone(), heard.clone());
    let table = sheet.table.clone();
    sheet.cx.update(|_, cx| {
        cx.subscribe(&table, move |_, event: &TallTableEvent, _| {
            if matches!(
                event,
                TallTableEvent::Sorted(_) | TallTableEvent::SortRefused(..)
            ) {
                record.borrow_mut().push(books.borrow().log.clone());
            }
        })
        .detach();
    });
    heard
}

/// A sort's reads, and a refusal's, are planned after its events reach
/// their subscribers: a host hears `Sorted` (or `SortRefused`) before any
/// read of the order it names.
#[cfg(feature = "sort")]
#[gpui_kit::test]
fn the_reads_follow_the_sort_events(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, columns(3), false);
    let heard = log_at_sort_events(&mut sheet);
    sheet.take_log();
    sheet
        .update(|table, cx| table.set_sort(vec![descending()], cx))
        .expect("sorted");
    assert_eq!(*heard.borrow(), [vec!["sort 1 descending".to_string()]]);
    assert!(
        sheet
            .take_log()
            .iter()
            .any(|event| event.starts_with("load"))
    );
    heard.borrow_mut().clear();
    sheet.books.borrow_mut().refuse = true;
    sheet.replace(ROWS, ViewAt::Top);
    let told = vec!["sort 1 descending".to_string(), "sort none".to_string()];
    assert_eq!(
        *heard.borrow(),
        [told.clone(), told],
        "Sorted, then SortRefused"
    );
    assert!(
        sheet
            .take_log()
            .iter()
            .any(|event| event.starts_with("load"))
    );
}

/// A later `set_sort` in the update tells the source in the replace's
/// place, once, and puts the view at the top, as any sort.
#[cfg(feature = "sort")]
#[gpui_kit::test]
fn a_later_set_sort_wins(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, columns(3), false);
    sheet
        .update(|table, cx| table.set_sort(vec![descending()], cx))
        .expect("sorted");
    sheet.take_log();
    sheet.take_events();
    let ascending = Sort::new(0, SortDirection::Ascending);
    sheet.update(|table, cx| {
        table.delegate.books.borrow_mut().era += 1;
        table.replace_rows(ROWS, ViewAt::Row(30_000), cx);
        table.set_sort(vec![ascending], cx).expect("sorted");
    });
    let log = sheet.take_log();
    assert_eq!(
        log.iter()
            .filter(|event| event.starts_with("sort"))
            .collect::<Vec<_>>(),
        ["sort 0 ascending"],
        "{log:?}"
    );
    assert_eq!(sheet.top(), 0.0);
    assert_eq!(sorted(&sheet.take_events()), [Some(ascending)]);
}

/// A refusal clears the sort, the source told none, with `Sorted` and
/// `SortRefused`, and the view stays at the target.
#[cfg(feature = "sort")]
#[gpui_kit::test]
fn a_refusal_clears_the_sort_at_the_target(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, columns(3), false);
    sheet
        .update(|table, cx| table.set_sort(vec![descending()], cx))
        .expect("sorted");
    sheet.take_log();
    sheet.take_events();
    sheet.books.borrow_mut().refuse = true;
    sheet.replace(ROWS, ViewAt::Row(30_000));
    let log = sheet.take_log();
    assert_eq!(log[..2], ["sort 1 descending", "sort none"], "{log:?}");
    assert!(
        log[2..].iter().all(|event| event.starts_with("load")),
        "{log:?}"
    );
    assert_eq!(sheet.read(|table| table.sort().to_vec()), []);
    assert_eq!(sheet.top(), 30_000.0);
    let events = sheet.take_events();
    assert_eq!(sorted(&events), [None]);
    assert!(
        events.contains(&TallTableEvent::SortRefused(
            vec![descending()],
            SortRefused::new("refused")
        )),
        "{events:?}"
    );
    assert_eq!(sheet.eras_drawn(), [1]);
}

/// `sort`'s reset forgets its pressed arrow (its release just sorted);
/// `replace_rows` keeps it.
#[cfg(feature = "sort")]
#[gpui_kit::test]
fn sort_forgets_its_pressed_arrow_and_replace_keeps_it(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, columns(3), false);
    sheet.update(|table, _| table.sort_state.pressed = Some(1));
    sheet.replace(ROWS, ViewAt::Top);
    assert_eq!(sheet.read(|table| table.sort_state.pressed), Some(1));
    sheet
        .update(|table, cx| table.set_sort(vec![descending()], cx))
        .expect("sorted");
    assert_eq!(sheet.read(|table| table.sort_state.pressed), None);
}

/// What the two orders of `set_columns` and `replace_rows` end with.
#[cfg(feature = "sort")]
#[derive(Debug, PartialEq)]
struct Ended {
    top: f64,
    at_end: bool,
    following: bool,
    log: Vec<String>,
    sort: Vec<Sort>,
    sorted: Vec<Option<Sort>>,
    pinned: usize,
    selection: Option<String>,
}

/// `set_columns` and `replace_rows` in one update, in `order` (true: the
/// columns first), from a table sorted by column 1 following the end, with
/// a `Columns` range: the state after.
#[cfg(feature = "sort")]
fn columns_and_replace(
    cx: &mut TestAppContext,
    new: Vec<TallTableColumn>,
    columns_first: bool,
) -> Ended {
    let mut sheet = Sheet::open(cx, columns(4), false);
    #[cfg(feature = "pin")]
    sheet.update(|table, cx| table.set_pinned(1, cx));
    sheet
        .update(|table, cx| table.set_sort(vec![descending()], cx))
        .expect("sorted");
    #[cfg(feature = "follow")]
    sheet.update(|table, cx| table.follow(cx));
    #[cfg(feature = "select")]
    {
        use crate::selection::{Kind, TallTableSelection};
        let selection = TallTableSelection::new(Kind::Columns, (40, 1), (60, 2));
        sheet.update(|table, cx| table.set_selection(Some(selection), cx));
    }
    sheet.take_log();
    sheet.take_events();
    sheet.update(|table, cx| {
        table.delegate.books.borrow_mut().era += 1;
        if columns_first {
            table.set_columns(new, cx);
            table.replace_rows(ROWS + 500, ViewAt::End, cx);
        } else {
            table.replace_rows(ROWS + 500, ViewAt::End, cx);
            table.set_columns(new, cx);
        }
    });
    let events = sheet.take_events();
    #[cfg(feature = "follow")]
    let following = sheet.read(|table| table.is_following());
    #[cfg(not(feature = "follow"))]
    let following = false;
    #[cfg(feature = "pin")]
    let pinned = sheet.read(|table| table.pinned());
    #[cfg(not(feature = "pin"))]
    let pinned = 0;
    #[cfg(feature = "select")]
    let selection = sheet
        .read(|table| table.selection())
        .map(|selection| format!("{selection:?}"));
    #[cfg(not(feature = "select"))]
    let selection = None;
    let ended = Ended {
        top: sheet.top(),
        at_end: sheet.read(|table| table.scroll.top() == table.scroll.max_top()),
        following,
        log: sheet.take_log(),
        sort: sheet.read(|table| table.sort().to_vec()),
        sorted: sorted(&events),
        pinned,
        selection,
    };
    assert_eq!(sheet.eras_drawn(), [1]);
    ended
}

/// Either order ends the same, with the sort kept and with one whose
/// column is gone: the view at the target, following kept, the pages read
/// once, the sort and its events, `pin`'s count, the selection.
#[cfg(feature = "sort")]
#[gpui_kit::test]
fn set_columns_and_replace_end_the_same_in_either_order(cx: &mut TestAppContext) {
    let mut gone = columns(4);
    gone[1] = TallTableColumn::new("other", ColumnKind::Text).sortable(true);
    for (new, sort, told) in [
        (columns(4), vec![descending()], "sort 1 descending"),
        (gone, vec![], "sort none"),
    ] {
        let first = columns_and_replace(cx, new.clone(), true);
        let second = columns_and_replace(cx, new, false);
        assert_eq!(first, second, "the orders part");
        assert_eq!(first.sort, sort);
        assert!(first.at_end, "at the end: {first:?}");
        assert_eq!(
            first
                .log
                .iter()
                .filter(|event| event.starts_with("sort"))
                .collect::<Vec<_>>(),
            [told]
        );
        assert!(!first.log.iter().any(|event| event.starts_with("cancel")));
        let loads: Vec<&String> = first
            .log
            .iter()
            .filter(|event| event.starts_with("load"))
            .collect();
        let mut once = loads.clone();
        once.dedup();
        assert_eq!(loads, once, "each page read once");
        assert_eq!(
            first.sorted,
            if told == "sort none" {
                vec![None]
            } else {
                vec![]
            }
        );
        #[cfg(feature = "follow")]
        assert!(first.following);
    }
}

/// `set_columns` alone, its sort's column gone, resets as it always has:
/// the view at the top, following let go, the source told none.
#[cfg(feature = "sort")]
#[gpui_kit::test]
fn set_columns_alone_resets_to_the_top(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, columns(3), false);
    sheet
        .update(|table, cx| table.set_sort(vec![descending()], cx))
        .expect("sorted");
    sheet.update(|table, cx| table.jump_to(40_000, cx));
    #[cfg(feature = "follow")]
    sheet.update(|table, cx| table.follow(cx));
    sheet.take_log();
    sheet.take_events();
    let mut gone = columns(3);
    gone[1] = TallTableColumn::new("other", ColumnKind::Text).sortable(true);
    let books = sheet.books.clone();
    let inside = sheet.table.update(sheet.cx, |table, cx| {
        table.set_columns(gone, cx);
        books.borrow().log.clone()
    });
    assert_eq!(
        inside,
        ["sort none"],
        "told at once, nothing read inside the update"
    );
    sheet.draw();
    assert_eq!(sheet.top(), 0.0);
    let log = sheet.take_log();
    assert_eq!(log[0], "sort none");
    let events = sheet.take_events();
    assert_eq!(sorted(&events), [None]);
    #[cfg(feature = "follow")]
    assert_eq!(following_events(&events), [false]);
}

/// `set_sort`, `set_columns`, and `replace_rows` in one update read the new
/// rows' pages once, nothing cancelled.
#[cfg(feature = "sort")]
#[gpui_kit::test]
fn three_calls_in_one_update_read_once(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, columns(3), false);
    sheet.take_log();
    sheet.update(|table, cx| {
        table.set_sort(vec![descending()], cx).expect("sorted");
        table.set_columns(columns(3), cx);
        table.delegate.books.borrow_mut().era += 1;
        table.replace_rows(ROWS, ViewAt::Top, cx);
    });
    assert_eq!(
        sheet.take_log(),
        [
            "sort 1 descending",
            "sort 1 descending",
            "load 0",
            "load 1",
            "load 2"
        ],
        "the sort told by `set_sort`, then again to the new source, then one plan"
    );
}
