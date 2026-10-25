//! `live` in a window of GPUI's test app: what a re-read draws while it's
//! out and when it lands, and the [`TallTableEvent::Refreshed`] its frame
//! emits. On the paging scenarios' scripted delegate (its reads answer only
//! when a test says), whose every value is the request that read the page,
//! so the probe's last cell says which read is on screen.

use std::cell::RefCell;
use std::rc::Rc;

use gpui_kit::{Entity, TestAppContext, VisualTestContext, size};

use super::super::{Paging, TallTableEvent, TallTableState};
use super::{Reads, Script, answer};
use crate::column::{ColumnKind, TallTableColumn};

const ROWS: u64 = 1_567_523;
const PAGE_BYTES: usize = 1024;

/// A table in a 1440×900 window (rows 0..~30 visible: page 0), with its
/// reads, and every event it emitted.
struct Live<'a> {
    cx: &'a mut VisualTestContext,
    table: Entity<TallTableState<Script>>,
    reads: Rc<RefCell<Reads>>,
    events: Rc<RefCell<Vec<TallTableEvent>>>,
    _subscription: gpui_kit::Subscription,
}

impl<'a> Live<'a> {
    fn open(cx: &'a mut TestAppContext) -> Self {
        cx.update(gpui_kit::component::init);
        let reads = Rc::new(RefCell::new(Reads::default()));
        let delegate = Script {
            reads: reads.clone(),
            page_rows: Paging::default().page_rows,
            rows: ROWS,
        };
        let (table, cx) = cx.add_window_view(move |_, cx| {
            TallTableState::new(
                delegate,
                vec![TallTableColumn::new("value", ColumnKind::Float)],
                ROWS,
                Paging::default(),
                cx,
            )
            .probe_frames(true)
        });
        cx.simulate_resize(size(gpui_kit::px(1440.), gpui_kit::px(900.)));
        let events: Rc<RefCell<Vec<TallTableEvent>>> = Rc::default();
        let seen = events.clone();
        let subscription = cx.update(|_, cx| {
            cx.subscribe(&table, move |_, event: &TallTableEvent, _| {
                seen.borrow_mut().push(event.clone());
            })
        });
        let mut live = Self {
            cx,
            table,
            reads,
            events,
            _subscription: subscription,
        };
        live.draw();
        live
    }

    /// Runs what can run, then draws a frame (twice at first: the body is
    /// measured in the first).
    fn draw(&mut self) {
        for _ in 0..2 {
            self.cx.run_until_parked();
            self.cx.update(|window, cx| window.draw(cx).clear(cx));
        }
    }

    /// Answers the oldest open read of `page`, then draws.
    fn answer(&mut self, page: u64) {
        assert!(
            answer(&self.reads, Some(page), false, PAGE_BYTES),
            "no read of page {page} is open"
        );
        self.draw();
    }

    fn fail(&mut self, page: u64) {
        assert!(answer(&self.reads, Some(page), true, PAGE_BYTES));
        self.draw();
    }

    /// Answers every open read, the reads they start included, then draws.
    fn answer_all(&mut self) {
        while answer(&self.reads, None, false, PAGE_BYTES) {
            self.cx.run_until_parked();
        }
        self.draw();
    }

    fn invalidate(&mut self, rows: std::ops::Range<u64>) -> u64 {
        let generation = self
            .table
            .update(self.cx, |table, cx| table.invalidate_rows(rows, cx));
        self.draw();
        generation
    }

    /// What the delegate was asked since the last call.
    fn log(&mut self) -> Vec<String> {
        std::mem::take(&mut self.reads.borrow_mut().log)
    }

    /// The events since the last call: `Refreshed` and `Filled`, and the
    /// last frame's probe (its pending rows and last cell).
    fn events(&mut self) -> (Vec<TallTableEvent>, (u64, Option<String>)) {
        let events = std::mem::take(&mut *self.events.borrow_mut());
        let marks = events
            .iter()
            .filter(|event| {
                matches!(
                    event,
                    TallTableEvent::Refreshed { .. } | TallTableEvent::Filled { .. }
                )
            })
            .cloned()
            .collect();
        let probe = self.table.update(self.cx, |table, _| {
            let probe = table.published_probe.as_ref().expect("a frame was probed");
            (probe.pending, probe.last_cell.clone())
        });
        (marks, probe)
    }
}

/// The value every cell of a page read by `request` shows.
fn read(request: u32) -> Option<String> {
    Some(format!("{:?}", f64::from(request)))
}

#[gpui_kit::test]
fn a_reread_draws_the_old_rows_until_it_lands(cx: &mut TestAppContext) {
    let mut live = Live::open(cx);
    assert_eq!(live.log(), ["load 0"]);
    live.answer_all();
    assert_eq!(live.log(), ["load 1", "load 2"]);
    let (events, probe) = live.events();
    assert_eq!(events, [TallTableEvent::Filled { first: true }]);
    assert_eq!(probe, (0, read(0)));

    let first = live.invalidate(0..10);
    assert_eq!(live.log(), ["load 0"]);
    // Never a placeholder: the old rows, and no `Filled`.
    let (events, probe) = live.events();
    assert_eq!((events, probe), (vec![], (0, read(0))));
    let second = live.invalidate(5..6);
    assert!(second > first);
    assert_eq!(live.log(), Vec::<String>::new());

    // Its read (request 3) lands: drawn, `Refreshed` with the generation it
    // started at, and read once more for the second invalidation.
    live.answer(0);
    assert_eq!(live.log(), ["load 0"]);
    let (events, probe) = live.events();
    assert_eq!(
        events,
        [TallTableEvent::Refreshed {
            rows: 0..1024,
            generation: first
        }]
    );
    assert_eq!(probe, (0, read(3)));
    live.draw();
    assert_eq!(
        live.events().0,
        [],
        "once, on the first frame that draws it"
    );

    live.answer(0);
    let (events, probe) = live.events();
    assert_eq!(
        events,
        [TallTableEvent::Refreshed {
            rows: 0..1024,
            generation: second
        }]
    );
    assert_eq!(probe, (0, read(4)));
    assert_eq!(live.log(), Vec::<String>::new());
}

#[gpui_kit::test]
fn a_page_reread_off_screen_reports_nothing(cx: &mut TestAppContext) {
    let mut live = Live::open(cx);
    live.answer_all();
    live.log();
    live.events();
    // Page 1 is prefetched, not visible.
    live.invalidate(1024..1030);
    assert_eq!(live.log(), ["load 1"]);
    live.answer(1);
    assert_eq!(live.events().0, []);
    // Scrolled to: drawn for the first time now, still nothing.
    live.table
        .update(live.cx, |table, cx| table.jump_to(1024, cx));
    live.answer_all();
    let (events, probe) = live.events();
    assert!(
        events
            .iter()
            .all(|event| !matches!(event, TallTableEvent::Refreshed { .. })),
        "{events:?}"
    );
    assert_eq!(probe, (0, read(3)), "the re-read's rows");
}

#[gpui_kit::test]
fn a_failed_reread_keeps_the_old_rows(cx: &mut TestAppContext) {
    let mut live = Live::open(cx);
    live.answer_all();
    live.log();
    live.events();
    live.invalidate(0..10);
    live.fail(0);
    let (events, probe) = live.events();
    assert_eq!((events, probe), (vec![], (0, read(0))));
    assert!(
        live.table
            .read_with(live.cx, |table, _| table.has_failed_reads())
    );
    assert_eq!(live.log(), ["load 0"], "not read again");
    // `retry_failed` reads it again.
    live.table
        .update(live.cx, |table, cx| table.retry_failed(cx));
    live.draw();
    assert_eq!(live.log(), ["load 0"]);
}

#[gpui_kit::test]
fn close_cancels_rereads(cx: &mut TestAppContext) {
    let mut live = Live::open(cx);
    live.answer_all();
    live.invalidate(0..10);
    live.log();
    live.table.update(live.cx, |table, cx| {
        assert_eq!(table.cache.in_flight(), 1);
        table.close(cx);
    });
    assert_eq!(live.log(), ["cancel 0"]);
}
