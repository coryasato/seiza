//! `follow` in a window of GPUI's test app: when following starts and
//! stops, the view pinned to the loaded tail as rows arrive and reads land,
//! and the [`TallTableEvent::Following`] and [`TallTableEvent::TailDrawn`]
//! it emits. On the paging scenarios' scripted delegate (its reads answer
//! only when a test says).

use std::cell::RefCell;
use std::rc::Rc;
use std::time::Duration;

use gpui_kit::{Entity, TestAppContext, VisualTestContext, px, size};

use super::super::{
    LineDown, LineUp, PageUp, Paging, ScrollToEnd, ScrollToTop, TallTableEvent, TallTableState,
};
use super::{Reads, Script, answer};
use crate::column::{ColumnKind, TallTableColumn};
use crate::pages::Direction;

const PAGE_BYTES: usize = 1024;

/// A table in a 1440×900 window (about 28 rows in view), with its reads,
/// and the `Following` and `TailDrawn` events it emitted.
struct Tail<'a> {
    cx: &'a mut VisualTestContext,
    table: Entity<TallTableState<Script>>,
    reads: Rc<RefCell<Reads>>,
    events: Rc<RefCell<Vec<TallTableEvent>>>,
    _subscription: gpui_kit::Subscription,
}

impl<'a> Tail<'a> {
    fn open(cx: &'a mut TestAppContext, rows: u64, paging: Paging) -> Self {
        cx.update(gpui_kit::component::init);
        let reads = Rc::new(RefCell::new(Reads {
            rows,
            ..Reads::default()
        }));
        let delegate = Script {
            reads: reads.clone(),
            page_rows: paging.page_rows,
        };
        let (table, cx) = cx.add_window_view(move |_, cx| {
            TallTableState::new(
                delegate,
                vec![TallTableColumn::new("value", ColumnKind::Float)],
                rows,
                paging,
                cx,
            )
            .probe_frames(true)
        });
        cx.simulate_resize(size(px(1440.), px(900.)));
        let events: Rc<RefCell<Vec<TallTableEvent>>> = Rc::default();
        let seen = events.clone();
        let subscription = cx.update(|_, cx| {
            cx.subscribe(&table, move |_, event: &TallTableEvent, _| {
                if matches!(
                    event,
                    TallTableEvent::Following(_) | TallTableEvent::TailDrawn { .. }
                ) {
                    seen.borrow_mut().push(event.clone());
                }
            })
        });
        let mut tail = Self {
            cx,
            table,
            reads,
            events,
            _subscription: subscription,
        };
        tail.draw();
        tail
    }

    /// Runs what can run, then draws a frame (twice: the body is measured
    /// in the first).
    fn draw(&mut self) {
        for _ in 0..2 {
            self.cx.run_until_parked();
            self.cx.update(|window, cx| window.draw(cx).clear(cx));
        }
    }

    fn answer_all(&mut self) {
        while answer(&self.reads, None, false, PAGE_BYTES) {
            self.cx.run_until_parked();
        }
        self.draw();
    }

    fn fail_all(&mut self) {
        while answer(&self.reads, None, true, PAGE_BYTES) {
            self.cx.run_until_parked();
        }
        self.draw();
    }

    fn update<T>(
        &mut self,
        update: impl FnOnce(
            &mut TallTableState<Script>,
            &mut gpui_kit::Context<TallTableState<Script>>,
        ) -> T,
    ) -> T {
        let result = self.table.update(self.cx, update);
        self.draw();
        result
    }

    /// A key's action, as the table's key bindings dispatch it.
    fn key(&mut self, key: Key) {
        let table = self.table.clone();
        self.cx.update(|window, cx| {
            table.update(cx, |table, cx| match key {
                Key::Up => table.line_up(&LineUp, window, cx),
                Key::Down => table.line_down(&LineDown, window, cx),
                Key::PageUp => table.page_up(&PageUp, window, cx),
                Key::Home => table.scroll_to_top(&ScrollToTop, window, cx),
                Key::End => table.scroll_to_end(&ScrollToEnd, window, cx),
            })
        });
        self.draw();
    }

    /// The source holds `rows` rows now, and the table is told.
    fn grow(&mut self, rows: u64) {
        self.reads.borrow_mut().rows = rows;
        self.update(|table, cx| table.set_rows(rows, cx));
    }

    fn following(&mut self) -> bool {
        self.table
            .read_with(self.cx, |table, _| table.is_following())
    }

    /// The view: its top, the end of the rows in view, and the last frame's
    /// placeholder rows.
    fn view(&mut self) -> (f64, u64, u64) {
        self.table.read_with(self.cx, |table, _| {
            let probe = table.published_probe.as_ref().expect("a frame was probed");
            (
                table.scroll.top(),
                table.scroll.visible().end,
                probe.pending,
            )
        })
    }

    fn events(&mut self) -> Vec<TallTableEvent> {
        std::mem::take(&mut *self.events.borrow_mut())
    }
}

/// The table's scrolling keys.
#[derive(Clone, Copy)]
enum Key {
    Up,
    Down,
    PageUp,
    Home,
    End,
}

fn following(on: bool) -> TallTableEvent {
    TallTableEvent::Following(on)
}

fn tail(rows: u64) -> TallTableEvent {
    TallTableEvent::TailDrawn { rows }
}

#[gpui_kit::test]
fn off_at_open_and_growth_never_sets_it(cx: &mut TestAppContext) {
    // Every row fits: at the end, and not following.
    let mut table = Tail::open(cx, 10, Paging::default());
    table.answer_all();
    assert!(!table.following());
    table.grow(20);
    table.answer_all();
    table.grow(2_000);
    table.answer_all();
    assert!(!table.following());
    assert_eq!(table.view().0, 0.0, "the view stays at the top");
    assert_eq!(table.events(), [], "no Following, no TailDrawn");
}

#[gpui_kit::test]
fn the_readers_moves_set_and_clear_it(cx: &mut TestAppContext) {
    let mut table = Tail::open(cx, 5_000, Paging::default());
    table.answer_all();
    // End.
    table.key(Key::End);
    assert!(table.following());
    assert_eq!(table.events(), [following(true)]);
    table.answer_all();
    assert_eq!(table.events(), [tail(5_000)]);
    // End again, and a key down at the end: unchanged, nothing emitted.
    table.key(Key::End);
    table.key(Key::Down);
    assert_eq!(table.events(), []);
    // A key up lets go; one down from there doesn't reach the end.
    table.key(Key::Up);
    assert!(!table.following());
    assert_eq!(table.events(), [following(false)]);
    // A wheel down past the end turns it on again; a fraction of a row up
    // turns it off.
    table.update(|table, cx| table.scroll_by(50.0, 0.0, cx));
    assert!(table.following());
    table.update(|table, cx| table.scroll_by(-0.1, 0.0, cx));
    assert!(!table.following());
    // A jump landing at the end follows; one elsewhere lets go.
    table.update(|table, cx| table.jump_to(4_990, cx));
    assert!(table.following());
    table.update(|table, cx| table.jump_to(100, cx));
    assert!(!table.following());
    // `follow()`, then a sideways wheel: still following. Page Up and Home
    // let go.
    table.update(|table, cx| table.follow(cx));
    table.update(|table, cx| table.scroll_by(0.0, 40.0, cx));
    assert!(table.following());
    // A trackpad's sideways swipe with a little vertical in it (a hundredth
    // of a row up, 40 px across) is sideways: still following.
    table.update(|table, cx| table.scroll_by(-0.01, -40.0, cx));
    assert!(table.following());
    table.key(Key::PageUp);
    assert!(!table.following());
    table.update(|table, cx| table.follow(cx));
    table.key(Key::Home);
    assert!(!table.following());
    // Once per change; each return to the tail draws it again (the rows
    // stopped growing, so `TailDrawn` is at 5,000 every time).
    assert_eq!(
        table.events(),
        [
            following(true),
            tail(5_000),
            following(false),
            following(true),
            tail(5_000),
            following(false),
            following(true),
            tail(5_000),
            following(false),
            following(true),
            tail(5_000),
            following(false),
        ],
    );
}

#[gpui_kit::test]
fn the_view_is_pinned_to_the_loaded_tail(cx: &mut TestAppContext) {
    let mut table = Tail::open(cx, 1_500, Paging::default());
    table.update(|table, cx| table.follow(cx));
    // Before a tail read lands, the view is at `rows()`, its placeholders
    // drawn.
    let (_, end, pending) = table.view();
    assert_eq!(end, 1_500);
    assert!(pending > 0);
    // Rows arriving before it lands don't move the view.
    table.grow(1_550);
    assert_eq!(table.view().1, 1_500);
    table.answer_all();
    let viewport = table
        .table
        .read_with(table.cx, |table, _| table.scroll.viewport_rows());
    assert_eq!(table.view(), (1_550.0 - viewport, 1_550, 0));
    assert_tails(table.events(), Some(following(true)), 1_550);
    // From the first landing on, never a placeholder, however rows arrive:
    // a batch at a time, one more read each, across page ends.
    let mut rows = 1_550;
    for batch in 0..40 {
        rows += 37 + batch;
        table.grow(rows);
        let (_, before, pending) = table.view();
        assert_eq!(pending, 0, "rows arriving draw nothing new at {rows}");
        table.answer_all();
        let (top, end, pending) = table.view();
        assert_eq!(pending, 0, "no placeholder once landed, at {rows}");
        assert_eq!(end, rows, "at the loaded tail");
        assert!(end > before);
        assert_eq!(top, rows as f64 - viewport, "its bottom at the tail");
        assert_tails(table.events(), None, rows);
    }
}

/// `events` are `first` (if given), then `TailDrawn`s, each further than
/// the last (a frame drawn between two reads landing has its own), the last
/// at `rows`.
fn assert_tails(events: Vec<TallTableEvent>, first: Option<TallTableEvent>, rows: u64) {
    let mut events = events.into_iter();
    if let Some(first) = first {
        assert_eq!(events.next(), Some(first));
    }
    let ends: Vec<u64> = events
        .map(|event| match event {
            TallTableEvent::TailDrawn { rows } => rows,
            other => panic!("{other:?} among the TailDrawns"),
        })
        .collect();
    assert!(ends.windows(2).all(|pair| pair[0] < pair[1]), "{ends:?}");
    assert_eq!(ends.last(), Some(&rows), "{ends:?}");
}

#[gpui_kit::test]
fn the_pin_never_moves_up(cx: &mut TestAppContext) {
    // A cache of three pages, so the pages behind are evicted as the tail
    // runs on.
    let paging = Paging {
        page_rows: 100,
        budget_bytes: 3 * PAGE_BYTES,
        ..Paging::default()
    };
    let mut table = Tail::open(cx, 250, paging);
    table.update(|table, cx| table.follow(cx));
    table.answer_all();
    let mut top = table.view().0;
    let mut rows = 250;
    for _ in 0..20 {
        rows += 60;
        table.grow(rows);
        table.answer_all();
        let now = table.view().0;
        assert!(now >= top, "moved up from {top} to {now}");
        top = now;
    }
    assert_eq!(table.view().1, rows);
    // A failed read at the tail: the view stays where it was.
    table.grow(rows + 80);
    table.fail_all();
    assert_eq!(table.view().0, top);
    assert!(table.following());
}

#[gpui_kit::test]
fn a_follow_move_is_not_a_scroll(cx: &mut TestAppContext) {
    let mut table = Tail::open(cx, 1_500, Paging::default());
    table.update(|table, cx| table.follow(cx));
    table.answer_all();
    // `follow()` moved as a jump does; once settled, the rows are still.
    table
        .cx
        .executor()
        .advance_clock(Duration::from_millis(250));
    table.draw();
    table.update(|table, _| {
        assert_eq!(table.direction, Direction::Still);
        table.scroll_settle = None;
    });
    table.grow(1_600);
    table.answer_all();
    assert_eq!(table.view().1, 1_600, "moved on");
    table.update(|table, _| {
        assert_eq!(table.direction, Direction::Still, "the direction as it was");
        assert!(table.scroll_settle.is_none(), "no settle timer");
    });
}

#[gpui_kit::test]
fn not_following_never_emits_tail_drawn(cx: &mut TestAppContext) {
    let mut table = Tail::open(cx, 1_500, Paging::default());
    table.answer_all();
    table.key(Key::End);
    table.answer_all();
    table.key(Key::Up);
    let _ = table.events();
    for rows in [1_600, 1_700, 2_100] {
        table.grow(rows);
        table.answer_all();
    }
    assert_eq!(table.events(), [], "let go: no TailDrawn as rows arrive");
    // End while rows still arrive follows them.
    table.key(Key::End);
    table.answer_all();
    table.grow(2_200);
    table.answer_all();
    assert_eq!(table.events(), [following(true), tail(2_100), tail(2_200)]);
}

#[gpui_kit::test]
fn a_resize_keeps_the_bottom(cx: &mut TestAppContext) {
    let mut table = Tail::open(cx, 1_500, Paging::default());
    table.update(|table, cx| table.follow(cx));
    table.answer_all();
    table.grow(1_520);
    // A taller window while rows 1500..1520 aren't read: the bottom stays,
    // the view grows up.
    table.cx.simulate_resize(size(px(1440.), px(1200.)));
    table.draw();
    let (_, end, pending) = table.view();
    assert_eq!((end, pending), (1_500, 0));
    table.answer_all();
    assert_eq!(table.view().1, 1_520);
    assert!(table.following());
}
