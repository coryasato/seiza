//! The random test of the paging: random sequences of the reader's moves,
//! the source's changes, each built feature's calls, and reads answered in
//! any order, on GPUI's seeded test executor, the table's invariants
//! checked against the source's own books after every step (the root's
//! `docs/research/tall-table-features.md`, "Hardening";
//! `docs/DECISIONS.md`, "Fixtures").
//!
//! Proptest, driven by hand from a plain `#[test]` (gpui-kit's
//! `property_test` doesn't compile at the pin): each case is a scheduler
//! seed, a `Paging`, and up to [`MAX_STEPS`] steps on a fresh
//! `TestAppContext`, the table's element in a window. A failure shrinks to
//! its few steps that matter and prints them with the scheduler seed;
//! `SEED` picks the cases (0 unset), so a rerun recurs it, and
//! `PROPTEST_CASES` how many. A bug it finds becomes a scenario test of its
//! own (`#[ignore]`d until it's fixed), and an exclusion keeps the test
//! from it meanwhile (a step not generated, a step not run, or a check
//! left out, each behind a variant of an `Exclusion` enum its fix
//! removes; `docs/DECISIONS.md`, "Fixtures"). Each negative control
//! (a fault in the table, all test-only) must fail the all-on run's cases
//! at its invariant.
//!
//! Beside the paging: the pointer's gestures through the window (a press
//! in a zone, moves and wheels, a release, placed among a case's steps so
//! its setters and answers fall between a press and its release), and what
//! the features keep (invariants 11 to 18: the drags, the widths, the
//! order, `pin`'s count, the selection, the hit tests, what's kept by row,
//! and the last of each event against the state; the root's
//! `docs/research/tall-table-features.md`, "Hardening 2").

use std::cell::RefCell;
use std::fmt;
use std::ops::Range;
#[cfg(feature = "copy")]
use std::ops::RangeInclusive;
use std::rc::Rc;
use std::time::Duration;

use futures::channel::oneshot;
use gpui_kit::component::scroll::Scrollbar;
use gpui_kit::proptest::collection::vec;
use gpui_kit::proptest::prelude::{Just, Strategy, any, prop_oneof};
use gpui_kit::proptest::strategy::{BoxedStrategy, Union};
use gpui_kit::proptest::test_runner::{Config, TestCaseError, TestError, TestRunner};
use gpui_kit::{
    App, AppContext as _, Context, Entity, IntoElement, Modifiers, MouseButton, MouseDownEvent,
    MouseMoveEvent, MouseUpEvent, ParentElement as _, Pixels, Point, Render, ScrollDelta,
    ScrollEvent, ScrollSource, Styled as _, TestAppContext, TouchPhase, VisualTestContext, Window,
    div, point, px, size,
};

use super::{Drag, Paging, TallTableEvent, TallTableState, ViewAt, row_height};
use crate::column::{ColumnKind, TallTableColumn};
use crate::delegate::{CellValue, PageError, PageLoad, TallTableDelegate, TallTablePage};
use crate::pages::{RowState, Sent};

#[cfg(feature = "copy")]
use crate::copy::{CopyId, CopyOptions, TURN_CELLS, TallTableCopy};
#[cfg(feature = "select")]
use crate::selection::{Kind, TallTableSelection};

/// The all-on run of `just tall-table test`: more cases, and the controls.
const ALL_ON: bool = cfg!(all(
    feature = "custom-cells",
    feature = "follow",
    feature = "resize",
    feature = "copy",
    feature = "sort",
    feature = "pin",
    feature = "density",
    feature = "reorder",
    feature = "clicks",
    feature = "group-headers",
    feature = "hide",
    feature = "find",
    feature = "popover"
));

/// The most steps a case takes (a range from none, so its length shrinks).
const MAX_STEPS: usize = 300;

/// The bytes a row counts against the budget.
const ROW_BYTES: usize = 16;

/// The window's viewport, in rows.
const VIEWPORT_ROWS: f64 = 20.0;

/// The most pages the rows grow to.
const MAX_PAGES: u64 = 64;

/// Steps on a closed table (answers, moves, all checking only that it
/// reads nothing) before a drain and a new table over the source.
const CLOSED_STEPS: usize = 8;

// --- the source ---

/// A row's version, bumped by `invalidate_rows`, and its era, bumped when
/// `set_rows` cuts it.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
struct Stamp {
    version: u32,
    era: u32,
}

/// A cell's text: its row, column, and stamp, so a drawn or copied value
/// says which read it came from.
fn cell_text(row: u64, column: usize, stamp: Stamp) -> String {
    format!("r{row}c{column}v{}e{}", stamp.version, stamp.era)
}

/// [`cell_text`] read back.
#[cfg(any(feature = "copy", feature = "reorder"))]
fn parse_cell(text: &str) -> Option<(u64, usize, Stamp)> {
    let text = text.strip_prefix('r')?;
    let (row, text) = text.split_once('c')?;
    let (column, text) = text.split_once('v')?;
    let (version, era) = text.split_once('e')?;
    let stamp = Stamp {
        version: version.parse().ok()?,
        era: era.parse().ok()?,
    };
    Some((row.parse().ok()?, column.parse().ok()?, stamp))
}

/// A page as its read was sent: each row's stamp then.
struct Page {
    first: u64,
    stamps: Vec<Stamp>,
    /// The read it answered: a page the cache didn't hold before a step
    /// landed in it.
    request: usize,
}

impl TallTablePage for Page {
    fn value(&self, row: usize, column: usize) -> Option<CellValue<'_>> {
        let stamp = self.stamps.get(row)?;
        let text = cell_text(self.first + row as u64, column, *stamp);
        Some(CellValue::Text(text.into()))
    }

    fn heap_bytes(&self) -> usize {
        self.stamps.len() * ROW_BYTES
    }
}

/// A read, as the source saw it.
struct Read {
    page: u64,
    rows: Range<u64>,
    stamps: Vec<Stamp>,
    cancelled: bool,
    /// Its answer reached the table (its load resolved).
    delivered: bool,
    /// Its answer, until a step gives it; `None` for a read answered when
    /// sent, or answered.
    answer: Option<oneshot::Sender<Result<Page, PageError>>>,
    /// Answered with its page.
    served: bool,
    /// The reads open when it was sent, itself included.
    open_then: usize,
    /// The other reads of its page open then, not cancelled.
    beside: Vec<usize>,
}

impl Read {
    fn page(&self, request: usize) -> Page {
        Page {
            request,
            first: self.rows.start,
            stamps: self.stamps.clone(),
        }
    }
}

/// The source's truth: its rows' stamps and every read it was sent, by
/// request (ids never repeat).
#[derive(Default)]
struct Books {
    page_rows: u64,
    rows: u64,
    stamps: Vec<Stamp>,
    reads: Vec<Read>,
    /// Reads answer with their page when sent.
    at_once: bool,
    /// The next read is refused when sent (a ready failure).
    refuse_next: bool,
    /// The columns whose sort it refuses (`sort`), by bit (`column % 8`).
    #[cfg(feature = "sort")]
    refused: u8,
    /// The sort it was last told and accepted (`sort`); a new source (a
    /// replace) has been told none.
    #[cfg(feature = "sort")]
    told: Option<crate::Sort>,
    /// Every find it was asked (`find`), by request less [`FIND_IDS`].
    #[cfg(feature = "find")]
    finds: Vec<FindRead>,
    /// The last find whose answer reached the table (`find`).
    #[cfg(feature = "find")]
    last_delivered: Option<usize>,
    /// The table's calls that broke the delegate's contract.
    faults: Vec<String>,
}

/// A find's requests, past any read's: one id space, the delegate's
/// `cancel` telling them apart (`find`).
#[cfg(feature = "find")]
const FIND_IDS: usize = 1 << 40;

/// How long a find takes to answer (`find`), on the test clock.
#[cfg(feature = "find")]
const FIND_DELAY: Duration = Duration::from_millis(20);

/// A find, as the source saw it (`find`).
#[cfg(feature = "find")]
struct FindRead {
    term: gpui_kit::SharedString,
    /// Its answer, found among the rows when it was asked, with the
    /// row's stamp then.
    found: Option<(crate::FoundCell, Stamp)>,
    cancelled: bool,
    delivered: bool,
}

impl Books {
    fn open(&self) -> impl Iterator<Item = (usize, &Read)> {
        self.reads
            .iter()
            .enumerate()
            .filter(|(_, read)| !read.delivered)
    }

    /// The reads a step can answer, oldest first.
    fn answerable(&self) -> Vec<usize> {
        self.open()
            .filter(|(_, read)| read.answer.is_some())
            .map(|(request, _)| request)
            .collect()
    }
}

struct Source(Rc<RefCell<Books>>);

impl TallTableDelegate for Source {
    type Page = Page;
    type Request = usize;

    fn load_page(&mut self, rows: Range<u64>, _: &mut App) -> (usize, PageLoad<Page>) {
        let mut books = self.0.borrow_mut();
        let request = books.reads.len();
        let page = rows.start / books.page_rows;
        if rows.end > books.rows || rows.start != page * books.page_rows {
            let held = books.rows;
            books
                .faults
                .push(format!("read {request} asks for rows {rows:?} of {held}"));
        }
        let held = rows.start.min(books.rows) as usize..rows.end.min(books.rows) as usize;
        let stamps = books.stamps[held].to_vec();
        let refused = std::mem::take(&mut books.refuse_next);
        let at_once = !refused && books.at_once;
        let (sender, receiver) = if refused || at_once {
            (None, None)
        } else {
            let (sender, receiver) = oneshot::channel();
            (Some(sender), Some(receiver))
        };
        let open_then = books.open().count() + 1;
        let beside = books
            .open()
            .filter(|(_, read)| read.page == page && !read.cancelled)
            .map(|(other, _)| other)
            .collect();
        books.reads.push(Read {
            page,
            rows,
            stamps,
            cancelled: false,
            delivered: false,
            answer: sender,
            served: at_once,
            open_then,
            beside,
        });
        let ready = if refused {
            Some(Err(PageError::Failed {
                message: "refused".into(),
                read_failure: false,
            }))
        } else {
            at_once.then(|| Ok(books.reads[request].page(request)))
        };
        let books = self.0.clone();
        let load = async move {
            let result = match (ready, receiver) {
                (Some(result), _) => result,
                (None, Some(receiver)) => receiver.await.unwrap_or(Err(PageError::Cancelled)),
                (None, None) => unreachable!(),
            };
            books.borrow_mut().reads[request].delivered = true;
            result
        };
        (request, Box::pin(load))
    }

    fn cancel(&mut self, request: usize, _: &mut App) {
        let mut books = self.0.borrow_mut();
        // A find's (`find`).
        #[cfg(feature = "find")]
        if request >= FIND_IDS {
            let find = &mut books.finds[request - FIND_IDS];
            if find.delivered || find.cancelled {
                let fault = format!("find {request} cancelled twice or once answered");
                books.faults.push(fault);
            } else {
                find.cancelled = true;
            }
            return;
        }
        let read = &mut books.reads[request];
        if read.delivered || read.cancelled {
            let fault = format!(
                "read {request} cancelled once {}",
                if read.delivered {
                    "answered"
                } else {
                    "cancelled"
                }
            );
            books.faults.push(fault);
        } else {
            read.cancelled = true;
        }
    }

    /// Finds among its rows as they are now (`find`), answered on the test
    /// clock after [`FIND_DELAY`], cancelled or not.
    #[cfg(feature = "find")]
    fn find(&mut self, query: &crate::FindQuery, cx: &mut App) -> Option<(usize, crate::FindLoad)> {
        let mut books = self.0.borrow_mut();
        let found = query
            .cells(books.rows)
            .map(|cell| (cell, books.stamps[cell.row as usize]))
            .find(|(cell, stamp)| query.matches(&cell_text(cell.row, cell.column, *stamp)));
        let index = books.finds.len();
        books.finds.push(FindRead {
            term: query.term().clone(),
            found,
            cancelled: false,
            delivered: false,
        });
        let timer = cx.background_executor().timer(FIND_DELAY);
        let books = self.0.clone();
        let load = async move {
            timer.await;
            let mut books = books.borrow_mut();
            books.finds[index].delivered = true;
            books.last_delivered = Some(index);
            Ok(found.map(|(cell, _)| cell))
        };
        Some((FIND_IDS + index, Box::pin(load)))
    }

    /// Refuses the columns drawn refused; otherwise answers in a new order
    /// from now on: every row's era bumped, so a row drawn or copied from a
    /// read of the old order is of an era gone.
    #[cfg(feature = "sort")]
    fn sort(&mut self, keys: &[crate::Sort], _: &mut App) -> Result<(), crate::SortRefused> {
        let sort = keys.first().copied();
        let mut books = self.0.borrow_mut();
        if let Some(sort) = sort
            && books.refused & (1 << (sort.column % 8)) != 0
        {
            return Err(crate::SortRefused::new("the test refused it"));
        }
        for stamp in &mut books.stamps {
            stamp.era += 1;
        }
        books.told = sort;
        Ok(())
    }
}

/// The host: the table's element, so the keys go through its contexts.
struct Shell {
    table: Entity<TallTableState<Source>>,
}

impl Render for Shell {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        div().size_full().child(crate::TallTable::new(&self.table))
    }
}

// --- the steps ---

/// One step. Its numbers are taken modulo what they index when it runs,
/// so a step means the same whatever came before, which shrinking needs.
#[derive(Debug, Clone)]
enum Step {
    /// A wheel by this many rows (down positive).
    Wheel(i16),
    /// A sideways wheel, in pixels.
    Sideways(i16),
    Home,
    End,
    Jump(u16),
    /// The thumb set to this many thousandths (as Home, End, a track press).
    Fraction(u16),
    /// A scrollbar drag pressed at, moved to, and released.
    Press(u16),
    Move(u16),
    Release,
    /// The clock moved on: one of [`Run::waits`].
    Wait(u8),
    /// A frame drawn.
    Frame,
    /// The rows grow by up to three pages.
    Grow(u16),
    /// The rows shrink within their last page.
    ShrinkWithin(u16),
    /// The rows shrink to the last page's start or below: a whole page
    /// past the new end.
    ShrinkPast(u16),
    /// The rows grow back to the most they've been.
    GrowBack,
    Retry,
    /// The columns replaced: 2 to 6, or so many a page takes two turns.
    Columns(u8),
    #[cfg(feature = "live")]
    Invalidate {
        at: u16,
        len: u16,
        near: bool,
    },
    #[cfg(feature = "follow")]
    Follow,
    /// The host's `let_go`: placed, never drawn ([`with_let_gos`]).
    #[cfg(feature = "follow")]
    LetGo,
    #[cfg(feature = "select")]
    Select {
        kind: u8,
        row: u16,
        rows: i16,
        column: u8,
        columns: u8,
        near: bool,
    },
    /// The host's `copy`.
    #[cfg(feature = "copy")]
    Copy,
    /// Cmd+C.
    #[cfg(feature = "copy")]
    CopyKey,
    #[cfg(feature = "copy")]
    CancelCopy,
    #[cfg(feature = "copy")]
    Escape,
    /// `set_sort`: none (`direction % 3 == 0`), ascending, or descending
    /// by column `column % columns`, sortable or not, refused or not.
    #[cfg(feature = "sort")]
    Sort {
        column: u8,
        direction: u8,
    },
    /// `set_pinned`: a count from none to past the columns.
    #[cfg(feature = "pin")]
    Pin(u8),
    /// `set_density`: one of [`DENSITIES`] (`k % DENSITIES.len()`).
    #[cfg(feature = "density")]
    Density(u8),
    /// `move_columns`, or with `pin` `move_columns_pinned` to either side:
    /// a block, a `to`, and a side, from the number ([`expand_move`]).
    #[cfg(feature = "reorder")]
    MoveColumns(u64),
    /// `set_order`: the columns shuffled, seeded by the number.
    #[cfg(feature = "reorder")]
    SetOrder(u64),
    /// A press through the window, placed, never drawn
    /// ([`with_gestures`]): in a zone (one of [`zones`]), at a point of
    /// it, the left button's or (one in eight) the right's, a first press
    /// or (one in four) a second or third, plain or with Shift or Ctrl
    /// (one in eight each).
    Down {
        zone: Zone,
        x: u16,
        y: u16,
        button: u8,
        count: u8,
        modifiers: u8,
    },
    /// The pointer moved by this much, the left button held if a press
    /// holds it; `up`: with no button, a release that went unseen.
    Drag {
        dx: i16,
        dy: i16,
        up: bool,
    },
    /// A wheel at the pointer: rows down, pixels sideways.
    PointerWheel {
        rows: i8,
        sideways: i16,
    },
    /// The left button's release at the pointer, or the right's.
    Up {
        right: bool,
    },
    /// `set_column_hidden`, or `set_hidden` (one in four), placed, never
    /// drawn ([`with_hides`]): a column and a flag, or every flag, from
    /// the number; one `set_hidden` in eight a list of another length,
    /// which must change nothing.
    #[cfg(feature = "hide")]
    Hide(u64),
    /// `set_find` (one in four: a term from a cell's text, a part of it,
    /// or none), else `find_next` or (one in four) `find_previous`,
    /// placed, never drawn ([`with_finds`]).
    #[cfg(feature = "find")]
    Find(u64),
    /// The popover (`popover`), placed, never drawn ([`with_popovers`]):
    /// opened on a visible cell (one in two), closed, its button set or
    /// taken away, its row changed (`live`), or Enter (on an open popover
    /// its button or its close, else `select`'s active cell), from the
    /// number ([`Run::popover`]).
    #[cfg(feature = "popover")]
    Popover(u64),
    /// `replace_rows`, placed, never drawn ([`with_replaces`]): the source
    /// swapped for its rows permuted, every row's era new, and a count and
    /// a target from the number ([`Run::replace`]).
    Replace(u64),
    Close,
    /// An open read (`k % open`) answered: with its page, failed, or
    /// failed as broken (`how`); a cancelled one with its page or
    /// `Cancelled`.
    Answer(u16, u8),
    /// Every read answered with its page, oldest first or newest first,
    /// and the clock moved past the settles, until nothing is open or
    /// waiting.
    Drain {
        newest: bool,
    },
    /// Reads answer when sent, or wait for a step.
    AtOnce(bool),
    /// The next read is refused when sent.
    Refuse,
}

fn step() -> impl Strategy<Value = Step> {
    // Answers about two steps in five. `Close` about one in fifty: a new
    // table follows it (`CLOSED_STEPS`), so a case keeps its steps.
    let mut steps: Vec<(u32, BoxedStrategy<Step>)> = vec![
        (
            160,
            (any::<u16>(), any::<u8>())
                .prop_map(|(k, how)| Step::Answer(k, how))
                .boxed(),
        ),
        (16, (-6i16..=6).prop_map(Step::Wheel).boxed()),
        (12, (-200i16..=200).prop_map(Step::Wheel).boxed()),
        (3, (-400i16..=400).prop_map(Step::Sideways).boxed()),
        (3, Just(Step::Home).boxed()),
        (12, Just(Step::End).boxed()),
        (10, any::<u16>().prop_map(Step::Jump).boxed()),
        (6, (0u16..=1000).prop_map(Step::Fraction).boxed()),
        (6, (0u16..=1000).prop_map(Step::Press).boxed()),
        (10, (0u16..=1000).prop_map(Step::Move).boxed()),
        (6, Just(Step::Release).boxed()),
        (20, any::<u8>().prop_map(Step::Wait).boxed()),
        (20, Just(Step::Frame).boxed()),
        (8, any::<u16>().prop_map(Step::Grow).boxed()),
        (8, any::<u16>().prop_map(Step::ShrinkWithin).boxed()),
        (8, Just(Step::GrowBack).boxed()),
        (3, Just(Step::Retry).boxed()),
        (3, any::<u8>().prop_map(Step::Columns).boxed()),
        (8, Just(Step::Close).boxed()),
        (
            10,
            any::<bool>()
                .prop_map(|newest| Step::Drain { newest })
                .boxed(),
        ),
        (2, Just(Step::AtOnce(true)).boxed()),
        (4, Just(Step::AtOnce(false)).boxed()),
        (3, Just(Step::Refuse).boxed()),
    ];
    steps.push((4, any::<u16>().prop_map(Step::ShrinkPast).boxed()));
    #[cfg(feature = "live")]
    steps.push((
        16,
        (any::<u16>(), any::<u16>(), any::<bool>())
            .prop_map(|(at, len, near)| Step::Invalidate { at, len, near })
            .boxed(),
    ));
    #[cfg(feature = "follow")]
    steps.push((10, Just(Step::Follow).boxed()));
    #[cfg(feature = "select")]
    steps.push((
        20,
        (
            0u8..3,
            any::<u16>(),
            -400i16..=400,
            any::<u8>(),
            any::<u8>(),
            (0u8..4).prop_map(|pick| pick == 0),
        )
            .prop_map(|(kind, row, rows, column, columns, near)| Step::Select {
                kind,
                row,
                rows,
                column,
                columns,
                near,
            })
            .boxed(),
    ));
    #[cfg(feature = "copy")]
    steps.extend([
        (24, Just(Step::Copy).boxed()),
        (6, Just(Step::CopyKey).boxed()),
        (3, Just(Step::CancelCopy).boxed()),
        (3, Just(Step::Escape).boxed()),
    ]);
    #[cfg(feature = "sort")]
    steps.push((
        4,
        (any::<u8>(), any::<u8>())
            .prop_map(|(column, direction)| Step::Sort { column, direction })
            .boxed(),
    ));
    Union::new_weighted(steps)
}

/// A case: the table's paging and size, the source's mode, and its steps.
#[derive(Debug, Clone)]
struct Case {
    page_rows: u64,
    prefetch: u64,
    max_in_flight: usize,
    budget_pages: usize,
    rows: u64,
    columns: usize,
    at_once: bool,
    #[cfg(feature = "copy")]
    copy: CopyOptions,
    /// The columns made sortable, and those the source refuses to sort,
    /// by bit (`column % 8`; `sort`).
    #[cfg(feature = "sort")]
    sortable: u8,
    #[cfg(feature = "sort")]
    refused: u8,
    /// The columns' label paths' stream (`group-headers`): placed from the
    /// scheduler seed, never drawn ([`with_paths`]), so a case's draw is
    /// the one without the feature.
    #[cfg(feature = "group-headers")]
    paths: u64,
    steps: Vec<Step>,
}

impl Case {
    fn paging(&self) -> Paging {
        Paging {
            page_rows: self.page_rows,
            prefetch: self.prefetch,
            budget_bytes: self.budget_pages * self.page_rows as usize * ROW_BYTES,
            max_in_flight: self.max_in_flight,
            ..Paging::default()
        }
    }
}

impl fmt::Display for Case {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        writeln!(
            f,
            "page_rows {}, prefetch {}, max_in_flight {}, budget {} pages, rows {}, columns {}, at_once {}",
            self.page_rows,
            self.prefetch,
            self.max_in_flight,
            self.budget_pages,
            self.rows,
            self.columns,
            self.at_once
        )?;
        #[cfg(feature = "copy")]
        writeln!(f, "{:?}", self.copy)?;
        #[cfg(feature = "sort")]
        writeln!(
            f,
            "sortable {:08b}, refused {:08b}",
            self.sortable, self.refused
        )?;
        #[cfg(feature = "group-headers")]
        writeln!(f, "paths {:#x}", self.paths)?;
        writeln!(f, "{} steps:", self.steps.len())?;
        for (index, step) in self.steps.iter().enumerate() {
            writeln!(f, "  {index}: {step:?}")?;
        }
        Ok(())
    }
}

/// A column count: 2 to 6, or (one time in about sixteen) so many that a
/// page of `page_rows` takes two of the copy's turns.
fn column_count(pick: u8, page_rows: u64) -> usize {
    if pick >= 240 {
        #[cfg(feature = "copy")]
        return (TURN_CELLS / page_rows) as usize + 1;
        #[cfg(not(feature = "copy"))]
        let _ = page_rows;
    }
    2 + pick as usize % 5
}

fn case() -> impl Strategy<Value = Case> {
    let shape = (
        8u64..=64,
        0u64..=2,
        // Skewed to few places, where a missed plan stalls.
        prop_oneof![1usize..=2, 1usize..=4],
        prop_oneof![2usize..=4, 2usize..=12],
        // Half the tables fit the viewport, so their end is in view.
        prop_oneof![
            (Just(0u64), 0u16..=VIEWPORT_ROWS as u16),
            (0u64..=40, any::<u16>())
        ],
        any::<u8>(),
        (0u8..4).prop_map(|pick| pick == 0),
    );
    #[cfg(feature = "copy")]
    let copy = (0usize..4, 0usize..3, any::<bool>()).prop_map(|(bytes, cells, headers)| {
        CopyOptions::default()
            .max_bytes([512, 64 << 10, 1 << 20, 1 << 20][bytes])
            .key_max_cells([200, 5000, 100_000][cells])
            .headers(headers)
    });
    #[cfg(not(feature = "copy"))]
    let copy = Just(());
    #[cfg(feature = "sort")]
    let sorting = (any::<u8>(), any::<u8>());
    #[cfg(not(feature = "sort"))]
    let sorting = Just(());
    (shape, copy, sorting, vec(step(), 0..=MAX_STEPS)).prop_map(
        |(
            (page_rows, prefetch, max_in_flight, budget_pages, (pages, rest), columns, at_once),
            copy,
            sorting,
            steps,
        )| {
            #[cfg(not(feature = "copy"))]
            let () = copy;
            #[cfg(feature = "sort")]
            let (sortable, refused) = sorting;
            #[cfg(not(feature = "sort"))]
            let () = sorting;
            Case {
                page_rows,
                prefetch,
                max_in_flight,
                budget_pages,
                rows: if pages == 0 {
                    u64::from(rest)
                } else {
                    pages * page_rows + u64::from(rest) % page_rows * u64::from(rest % 3 != 0)
                },
                columns: column_count(columns, page_rows),
                at_once,
                #[cfg(feature = "copy")]
                copy,
                #[cfg(feature = "sort")]
                sortable,
                #[cfg(feature = "sort")]
                refused,
                #[cfg(feature = "group-headers")]
                paths: 0,
                steps,
            }
        },
    )
}

// --- a run ---

/// An invariant that didn't hold: its number (the research's) and what.
struct Violation {
    invariant: u8,
    detail: String,
}

impl Violation {
    fn new(invariant: u8, detail: impl Into<String>) -> Self {
        Self {
            invariant,
            detail: detail.into(),
        }
    }
}

const INVARIANTS: [&str; 26] = [
    "places",
    "one read a page",
    "nothing after close",
    "the budget",
    "rows drawn of their era",
    "every copy ends",
    "a copy's text",
    "nothing stalls",
    "the group cells drawn are the drawn order's runs",
    "a drag never splits a run",
    "every drag ends, at the left button's release",
    "the widths",
    "the order",
    "pin's count moves by the columns that crossed",
    "the selection is valid",
    "a point in a drawn column hits it",
    "nothing kept by row outlives its row",
    "the last event is the state",
    "a replace lands where it was asked",
    "the source reads in the table's sort",
    "a hidden column is drawn and hit nowhere",
    "a landed match is the source's, of the era in effect",
    "one find out, one Found a FindStarted",
    "every match drawn is tinted, and only matches",
    "an open popover's cell is in view, and its text the page drawn's",
    "no popover open across a sort or set_columns",
];

/// A zone a press lands in.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Zone {
    /// A header row: the names', or with `group-headers` a group's.
    Header,
    /// A drawn band (`resize`).
    Band,
    /// A drawn arrow (`sort`).
    Arrow,
    Cell,
    /// A row's number.
    Gutter,
    Corner,
    /// A scrollbar's track: the vertical one's, or the horizontal one's.
    Track,
}

/// The zones this build has: the base's cells and scrollbars; the header,
/// the row numbers, and the corner where a feature hears a press there;
/// the bands with `resize`, the arrows with `sort`. A header row three
/// times and a band twice: their drags are the long ones.
fn zones() -> Vec<Zone> {
    let mut zones = vec![Zone::Cell, Zone::Cell, Zone::Track];
    if cfg!(any(
        feature = "select",
        feature = "reorder",
        feature = "clicks"
    )) {
        zones.extend([
            Zone::Header,
            Zone::Header,
            Zone::Header,
            Zone::Gutter,
            Zone::Corner,
        ]);
    }
    if cfg!(feature = "resize") {
        zones.extend([Zone::Band, Zone::Band]);
    }
    if cfg!(feature = "sort") {
        zones.push(Zone::Arrow);
    }
    zones
}

/// The drags on: a scrollbar's, a column's resize, a selection's, and a
/// header's held press or move.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
struct Drags {
    scrollbar: bool,
    resize: bool,
    select: bool,
    moving: bool,
}

impl Drags {
    fn any(self) -> bool {
        self != Self::default()
    }
}

/// The last of each event that says what the table holds, as a host keeps
/// them: its copy must never go stale (12, 13, 15, 18).
#[derive(Debug, Default)]
struct Heard {
    #[cfg(feature = "resize")]
    widths: Vec<Option<Pixels>>,
    #[cfg(feature = "reorder")]
    order: Vec<usize>,
    #[cfg(feature = "select")]
    selected: Option<TallTableSelection>,
    #[cfg(feature = "pin")]
    pinned: usize,
    #[cfg(feature = "sort")]
    sorted: Option<crate::Sort>,
    #[cfg(feature = "follow")]
    following: bool,
    /// Every column's hidden flag, by index (`hide`).
    #[cfg(feature = "hide")]
    hidden: Vec<bool>,
    /// A step started and not yet ended (`find`).
    #[cfg(feature = "find")]
    find_out: bool,
    /// What the events broke (`find`): 22 or 23, and why.
    #[cfg(feature = "find")]
    find_fault: Option<(u8, String)>,
    /// The popover's cell, as `Popover` last said (`popover`).
    #[cfg(feature = "popover")]
    popover: Option<crate::PopoverCell>,
    /// A reset (`Sorted`) heard while the popover was open (`popover`).
    #[cfg(feature = "popover")]
    reset_open: bool,
    /// A `PopoverButton` for a cell the popover wasn't open on.
    #[cfg(feature = "popover")]
    popover_fault: Option<String>,
}

/// Each column's set width, as `ColumnWidthsChanged` reports them.
#[cfg(feature = "resize")]
fn set_widths(table: &TallTableState<Source>) -> Vec<Option<Pixels>> {
    let sizes = table.sizes();
    table
        .column_info
        .iter()
        .map(|column| column.set_width(sizes))
        .collect()
}

/// Each column's set width as stored, by index.
#[cfg(feature = "resize")]
fn stored_widths(table: &TallTableState<Source>) -> Vec<Option<f32>> {
    table
        .column_info
        .iter()
        .map(|column| column.width)
        .collect()
}

/// The copy running, from its events.
#[cfg(feature = "copy")]
struct Copying {
    id: CopyId,
    rows: RangeInclusive<u64>,
    /// The indices drawn at its places when it started, in that order.
    columns: Vec<usize>,
    text: String,
}

/// A negative control: a fault in the table the test must catch.
#[derive(Debug, Clone, Copy)]
enum Control {
    #[cfg(feature = "copy")]
    Copy(super::copy::Control),
    Cache(crate::pages::Control),
    #[cfg(feature = "reorder")]
    Reorder(crate::reorder::Control),
    #[cfg(feature = "group-headers")]
    Groups(crate::groups::Control),
    #[cfg(feature = "resize")]
    Resize(super::resize::Control),
    #[cfg(feature = "pin")]
    Pin(crate::pin::Control),
    #[cfg(feature = "select")]
    Select(super::select::Control),
    /// The jump's mark kept by a shrink past its row.
    MarkKept,
    /// A replace that doesn't tell the new source the sort (`sort`).
    #[cfg(feature = "sort")]
    Untold,
    #[cfg(all(feature = "hide", feature = "reorder"))]
    Hide(super::hide::Control),
    /// A find out kept across a sort (`find`).
    #[cfg(all(feature = "find", feature = "sort"))]
    Find(super::find::Control),
    /// The match rule's (`find`): set for the thread while the cases run.
    #[cfg(feature = "find")]
    FindRule(crate::find::Control),
    /// A popover kept across a reset (with `sort`), or its text not
    /// decided again (with `live`) (`popover`).
    #[cfg(all(feature = "popover", any(feature = "sort", feature = "live")))]
    Popover(super::popover::Control),
}

/// A case's table in a window, its source, and what the test knows.
struct Run {
    cx: VisualTestContext,
    shell: Entity<Shell>,
    table: Entity<TallTableState<Source>>,
    books: Rc<RefCell<Books>>,
    paging: Paging,
    control: Option<Control>,
    /// How many columns the table has.
    columns: usize,
    /// The columns' label paths' stream (`group-headers`; 0 without).
    paths: u64,
    /// The columns made sortable, by bit (`sort`).
    #[cfg(feature = "sort")]
    sortable: u8,
    #[cfg(feature = "copy")]
    copy_options: CopyOptions,
    /// The most rows the source has held.
    most_rows: u64,
    /// The reads sent before `close`, once it's called.
    closed_at: Option<usize>,
    /// Steps taken since `close`.
    closed_steps: usize,
    #[cfg(feature = "copy")]
    events: Rc<RefCell<Vec<TallTableCopy>>>,
    #[cfg(feature = "copy")]
    copying: Option<Copying>,
    /// The last of each event (12, 13, 15, 18).
    heard: Rc<RefCell<Heard>>,
    /// Where the pointer is, and whether a press holds the left button.
    pointer: Point<Pixels>,
    left_down: bool,
    /// Each column's stored width at the last press with no resize on
    /// (`resize`): a drag back to its press's x restores it.
    #[cfg(feature = "resize")]
    pressed_widths: Vec<Option<f32>>,
    subscription: Option<gpui_kit::Subscription>,
}

type Checked = Result<(), Violation>;

/// What a step's checks compare with: the table before it.
struct Before {
    /// The reads sent.
    sent: usize,
    /// The loaded pages, by the read each answered.
    loaded: Vec<usize>,
    wanted: Vec<u64>,
    following: bool,
    /// The finds answered (`find`): one that lands in the step moves the
    /// view between its pages' landings.
    #[cfg(feature = "find")]
    finds_answered: usize,
}

impl Run {
    fn open(cx: &mut TestAppContext, case: &Case, control: Option<Control>) -> Self {
        cx.update(|cx| {
            gpui_kit::component::init(cx);
            crate::init(cx);
        });
        let paging = case.paging();
        let books = Rc::new(RefCell::new(Books {
            page_rows: case.page_rows,
            rows: case.rows,
            stamps: vec![Stamp::default(); case.rows as usize],
            at_once: case.at_once,
            #[cfg(feature = "sort")]
            refused: case.refused,
            ..Books::default()
        }));
        let source = books.clone();
        let (columns, rows) = (case.columns, case.rows);
        #[cfg(feature = "sort")]
        let sortable = case.sortable;
        #[cfg(not(feature = "sort"))]
        let sortable = 0;
        #[cfg(feature = "group-headers")]
        let paths = case.paths;
        #[cfg(not(feature = "group-headers"))]
        let paths = 0;
        let (shell, cx) = cx.add_window_view(move |_, cx| {
            let table = cx.new(|cx| {
                let columns = columns_of(columns, sortable, paths);
                TallTableState::new(Source(source), columns, rows, paging, cx)
            });
            Shell { table }
        });
        let table = shell.read_with(cx, |shell, _| shell.table.clone());
        let gutter = table.read_with(cx, |table, _| table.gutter_width());
        let (bar, row_h) = (f32::from(Scrollbar::width()), f32::from(row_height()));
        cx.simulate_resize(size(
            px(600.0 + gutter + bar + 2.0),
            px(VIEWPORT_ROWS as f32 * row_h + row_h + bar + 2.0),
        ));
        let mut run = Self {
            cx: cx.clone(),
            shell,
            table: table.clone(),
            books,
            paging,
            control,
            columns,
            paths,
            #[cfg(feature = "sort")]
            sortable: case.sortable,
            #[cfg(feature = "copy")]
            copy_options: case.copy,
            most_rows: case.rows,
            closed_at: None,
            closed_steps: 0,
            #[cfg(feature = "copy")]
            events: Rc::default(),
            #[cfg(feature = "copy")]
            copying: None,
            heard: Rc::default(),
            pointer: point(px(300.), px(300.)),
            left_down: false,
            #[cfg(feature = "resize")]
            pressed_widths: Vec::new(),
            subscription: None,
        };
        run.adopt(table);
        run
    }

    /// Takes `table` as the run's: the control and copy options on it, its
    /// events followed, drawn and focused.
    fn adopt(&mut self, table: Entity<TallTableState<Source>>) {
        let control = self.control;
        #[cfg(feature = "copy")]
        let options = self.copy_options;
        table.update(&mut self.cx, |table, _| {
            let _ = &table;
            match control {
                #[cfg(feature = "copy")]
                Some(Control::Copy(control)) => table.copy_state.control = control,
                Some(Control::Cache(control)) => table.cache.control = control,
                #[cfg(feature = "reorder")]
                Some(Control::Reorder(control)) => table.reorder_control = control,
                #[cfg(feature = "group-headers")]
                Some(Control::Groups(control)) => table.group_state.control = control,
                #[cfg(feature = "resize")]
                Some(Control::Resize(control)) => table.resize_control = control,
                #[cfg(feature = "pin")]
                Some(Control::Pin(control)) => table.pin_state.control = Some(control),
                #[cfg(feature = "select")]
                Some(Control::Select(control)) => table.selection_state.control = control,
                Some(Control::MarkKept) => table.keep_mark = true,
                #[cfg(feature = "sort")]
                Some(Control::Untold) => table.sort_state.untold = true,
                #[cfg(all(feature = "hide", feature = "reorder"))]
                Some(Control::Hide(control)) => table.hide_control = control,
                #[cfg(all(feature = "find", feature = "sort"))]
                Some(Control::Find(control)) => table.find_state.control = control,
                #[cfg(feature = "find")]
                Some(Control::FindRule(_)) => {}
                #[cfg(all(feature = "popover", any(feature = "sort", feature = "live")))]
                Some(Control::Popover(control)) => table.popover_state.control = control,
                None => {}
            }
            #[cfg(feature = "copy")]
            table.set_copy_options(options);
        });
        #[cfg(feature = "copy")]
        let events = self.events.clone();
        // What a host knows of a table it just made, then what it hears.
        *self.heard.borrow_mut() = table.read_with(&self.cx, |table, _| {
            let _ = &table;
            Heard {
                #[cfg(feature = "resize")]
                widths: set_widths(table),
                #[cfg(feature = "reorder")]
                order: table.order().to_vec(),
                #[cfg(feature = "select")]
                selected: table.selection(),
                #[cfg(feature = "pin")]
                pinned: table.pinned_in_effect(),
                #[cfg(feature = "sort")]
                sorted: table.sort().first().copied(),
                #[cfg(feature = "follow")]
                following: table.is_following(),
                #[cfg(feature = "hide")]
                hidden: table.hidden_flags(),
                #[cfg(feature = "find")]
                find_out: false,
                #[cfg(feature = "find")]
                find_fault: None,
                #[cfg(feature = "popover")]
                popover: table.popover(),
                #[cfg(feature = "popover")]
                reset_open: false,
                #[cfg(feature = "popover")]
                popover_fault: None,
            }
        });
        #[cfg(feature = "find")]
        let books = self.books.clone();
        let heard = self.heard.clone();
        self.subscription = Some(self.cx.update(|_, cx| {
            cx.subscribe(&table, move |_, event: &TallTableEvent, _| {
                let _ = &heard;
                match event {
                    #[cfg(feature = "copy")]
                    TallTableEvent::Copy(copy) => events.borrow_mut().push(copy.clone()),
                    #[cfg(feature = "resize")]
                    TallTableEvent::ColumnWidthsChanged(widths) => {
                        heard.borrow_mut().widths = widths.clone();
                    }
                    #[cfg(feature = "reorder")]
                    TallTableEvent::ColumnsMoved { order, .. } => {
                        heard.borrow_mut().order = order.clone();
                    }
                    #[cfg(feature = "select")]
                    TallTableEvent::Selected(selection) => {
                        heard.borrow_mut().selected = *selection;
                    }
                    #[cfg(feature = "pin")]
                    TallTableEvent::Pinned(pinned) => heard.borrow_mut().pinned = *pinned,
                    #[cfg(feature = "sort")]
                    TallTableEvent::Sorted(keys) => {
                        let mut heard = heard.borrow_mut();
                        heard.sorted = keys.first().copied();
                        // A reset: whatever was open is closed by now.
                        #[cfg(feature = "popover")]
                        if heard.popover.is_some() {
                            heard.reset_open = true;
                        }
                    }
                    #[cfg(feature = "popover")]
                    TallTableEvent::Popover(cell) => {
                        let mut heard = heard.borrow_mut();
                        heard.popover = *cell;
                        // A close after the sort (its cell scrolled out at
                        // the next frame) doesn't undo having kept it.
                        if cell.is_some() {
                            heard.reset_open = false;
                        }
                    }
                    #[cfg(feature = "popover")]
                    TallTableEvent::PopoverButton(cell) => {
                        let mut heard = heard.borrow_mut();
                        if heard.popover != Some(*cell) {
                            let fault = format!(
                                "PopoverButton({cell:?}) with the popover on {:?}",
                                heard.popover
                            );
                            heard.popover_fault.get_or_insert(fault);
                        }
                    }
                    #[cfg(feature = "follow")]
                    TallTableEvent::Following(following) => {
                        heard.borrow_mut().following = *following;
                    }
                    #[cfg(feature = "hide")]
                    TallTableEvent::ColumnsHidden(hidden) => {
                        heard.borrow_mut().hidden = hidden.clone();
                    }
                    #[cfg(feature = "find")]
                    TallTableEvent::FindStarted => {
                        let mut heard = heard.borrow_mut();
                        if std::mem::replace(&mut heard.find_out, true) {
                            heard
                                .find_fault
                                .get_or_insert((23, "FindStarted with a step out".into()));
                        }
                    }
                    #[cfg(feature = "find")]
                    TallTableEvent::Found(outcome) => {
                        let mut heard = heard.borrow_mut();
                        if !std::mem::replace(&mut heard.find_out, false) {
                            heard
                                .find_fault
                                .get_or_insert((23, format!("{outcome:?} with no step out")));
                        }
                        if let crate::FindOutcome::Match { cell, .. } = outcome
                            && let Some(fault) = landed_fault(&books.borrow(), *cell)
                        {
                            heard.find_fault.get_or_insert((22, fault));
                        }
                    }
                    _ => {}
                }
            })
        }));
        self.table = table;
        self.frame();
        let focus = self.read(|table| table.focus_handle.clone());
        self.cx.update(|window, cx| window.focus(&focus, cx));
        self.frame();
    }

    /// A new table over the source in place of the closed one, as a host
    /// replacing a table: once every read the closed one sent has answered.
    fn reopen(&mut self) {
        let (source, paging) = (Source(self.books.clone()), self.paging);
        let (columns, rows) = (
            columns_of(self.columns, self.sortable(), self.paths),
            self.rows(),
        );
        let table = self.shell.update(&mut self.cx, |shell, cx| {
            shell.table = cx.new(|cx| TallTableState::new(source, columns, rows, paging, cx));
            cx.notify();
            shell.table.clone()
        });
        self.closed_at = None;
        self.closed_steps = 0;
        #[cfg(feature = "copy")]
        {
            self.copying = None;
            self.events.borrow_mut().clear();
        }
        self.adopt(table);
    }

    fn park(&mut self) {
        self.cx.run_until_parked();
    }

    fn frame(&mut self) {
        self.draw();
        self.park();
    }

    /// A frame drawn, nothing run after it: what it drew is the state.
    fn draw(&mut self) {
        self.park();
        self.cx.update(|window, cx| window.draw(cx).clear(cx));
    }

    fn update<T>(
        &mut self,
        update: impl FnOnce(&mut TallTableState<Source>, &mut Context<TallTableState<Source>>) -> T,
    ) -> T {
        let result = self.table.update(&mut self.cx, update);
        self.park();
        result
    }

    fn read<T>(&self, read: impl FnOnce(&TallTableState<Source>) -> T) -> T {
        self.table.read_with(&self.cx, |table, _| read(table))
    }

    fn rows(&self) -> u64 {
        self.books.borrow().rows
    }

    /// The columns made sortable, by bit (none without `sort`).
    fn sortable(&self) -> u8 {
        #[cfg(feature = "sort")]
        return self.sortable;
        #[cfg(not(feature = "sort"))]
        0
    }

    fn before(&self) -> Before {
        self.read(|table| Before {
            sent: self.books.borrow().reads.len(),
            loaded: loaded_reads(table),
            wanted: table.wanted(),
            following: following(table),
            #[cfg(feature = "find")]
            finds_answered: self.finds_answered(),
        })
    }

    /// The finds whose answers reached the table (`find`).
    #[cfg(feature = "find")]
    fn finds_answered(&self) -> usize {
        self.books
            .borrow()
            .finds
            .iter()
            .filter(|find| find.delivered)
            .count()
    }

    /// The waits a step picks from: short of and past each settle.
    fn waits(&self) -> [Duration; 7] {
        let ms = Duration::from_millis;
        let (drag, scroll) = (self.paging.drag_settle, self.paging.scroll_settle);
        [
            ms(1),
            ms(30),
            drag - ms(1),
            drag + ms(1),
            scroll - ms(1),
            scroll + ms(1),
            ms(1000),
        ]
    }

    /// The source holds `rows` rows now: the rows cut go to a new era.
    fn set_rows(&mut self, rows: u64) {
        let rows = rows.min(MAX_PAGES * self.paging.page_rows);
        {
            let mut books = self.books.borrow_mut();
            let old = books.rows;
            if rows == old {
                return;
            }
            for stamp in &mut books.stamps[rows.min(old) as usize..old as usize] {
                stamp.era += 1;
            }
            if books.stamps.len() < rows as usize {
                books.stamps.resize(rows as usize, Stamp::default());
            }
            books.rows = rows;
        }
        self.most_rows = self.most_rows.max(rows);
        self.update(|table, cx| table.set_rows(rows, cx));
    }

    /// `replace_rows` from `pick`: a count (none, one that fits, the same,
    /// or up to 40 pages), a target (the top, the end, a row in the new
    /// count, or one past it), and the source's rows permuted with every
    /// era new, swapped in the call's update. Checked at the step: the view
    /// at its target, the count, what's kept by row cleared, following
    /// kept only at the end (19), and the new source told the table's sort
    /// (20).
    fn replace(&mut self, pick: u64) -> Checked {
        let page_rows = self.paging.page_rows;
        let rows = match pick % 8 {
            0 => 0,
            1 => (pick >> 3) % (VIEWPORT_ROWS as u64 + 1),
            2 => self.rows(),
            _ => (pick >> 3) % (40 * page_rows + 1),
        }
        .min(MAX_PAGES * page_rows);
        let at = match (pick >> 32) % 4 {
            0 => ViewAt::Top,
            1 => ViewAt::End,
            2 => ViewAt::Row((pick >> 34) % rows.max(1)),
            _ => ViewAt::Row(rows + (pick >> 34) % 64),
        };
        {
            let mut books = self.books.borrow_mut();
            let len = books.stamps.len().max(rows as usize);
            books.stamps.resize(len, Stamp::default());
            let era = books
                .stamps
                .iter()
                .map(|stamp| stamp.era)
                .max()
                .unwrap_or(0)
                + 1;
            let mut state = pick >> 40;
            for at in (1..len).rev() {
                state = state
                    .wrapping_mul(6_364_136_223_846_793_005)
                    .wrapping_add(1_442_695_040_888_963_407);
                books
                    .stamps
                    .swap(at, ((state >> 33) % (at as u64 + 1)) as usize);
            }
            for stamp in &mut books.stamps {
                stamp.era = era;
            }
            books.rows = rows;
            #[cfg(feature = "sort")]
            {
                books.told = None;
            }
        }
        self.most_rows = self.most_rows.max(rows);
        let following_before = self.read(following);
        #[cfg(feature = "select")]
        let selected = self.read(|table| table.selection());
        self.update(|table, cx| table.replace_rows(rows, at, cx));
        #[cfg(feature = "sort")]
        let closed = self.closed_at.is_some();
        self.read(|table| {
            if table.rows() != rows {
                return Err(Violation::new(
                    19,
                    format!("{} rows after replacing with {rows}", table.rows()),
                ));
            }
            let max_top = table.scroll.max_top();
            let top = match at {
                ViewAt::Top => 0.0,
                ViewAt::Row(row) => (row as f64).min(max_top),
                ViewAt::End => max_top,
            };
            if table.scroll.top() != top {
                return Err(Violation::new(
                    19,
                    format!(
                        "{at:?} of {rows} rows: the top at {}, not {top}",
                        table.scroll.top()
                    ),
                ));
            }
            let kept = at == ViewAt::End || max_top <= 0.0;
            if following(table) != (following_before && kept) {
                return Err(Violation::new(
                    19,
                    format!(
                        "{at:?}: following {} (it was {following_before})",
                        following(table)
                    ),
                ));
            }
            if table.hover.is_some() || table.marked.is_some() {
                return Err(Violation::new(19, "the hover or the jump's mark kept"));
            }
            // Its row means another: kept by row, so 19's (`popover`).
            #[cfg(feature = "popover")]
            if let Some(cell) = table.popover() {
                return Err(Violation::new(
                    19,
                    format!("the popover on {cell:?} open across replace_rows"),
                ));
            }
            // Its index means another cell (`find`).
            #[cfg(feature = "find")]
            if let Some(cell) = table.current_match() {
                return Err(Violation::new(
                    19,
                    format!("the current match {cell:?} kept"),
                ));
            }
            #[cfg(all(feature = "live", feature = "custom-cells"))]
            if let Some(row) = table.flashes.past(0) {
                return Err(Violation::new(19, format!("row {row} still flashing")));
            }
            #[cfg(feature = "select")]
            {
                let landing = match at {
                    ViewAt::Top => 0,
                    ViewAt::Row(row) => row.min(rows.saturating_sub(1)),
                    ViewAt::End => rows.saturating_sub(1),
                };
                let expected = selected
                    .filter(|selection| selection.kind() == Kind::Columns)
                    .map(|selection| {
                        TallTableSelection::new(
                            Kind::Columns,
                            (landing, selection.anchor().1),
                            (landing, selection.head().1),
                        )
                    });
                if table.selection() != expected {
                    return Err(Violation::new(
                        19,
                        format!(
                            "{selected:?} became {:?}, not {expected:?}",
                            table.selection()
                        ),
                    ));
                }
            }
            #[cfg(feature = "sort")]
            if !closed && self.books.borrow().told != table.sort().first().copied() {
                return Err(Violation::new(
                    20,
                    format!(
                        "the new source was told {:?}, the table's sort is {:?}",
                        self.books.borrow().told,
                        table.sort()
                    ),
                ));
            }
            Ok(())
        })
    }

    /// The runs of the drawn order, each its columns' indices, worked out
    /// here from the columns' paths (`group-headers`).
    #[cfg(feature = "group-headers")]
    fn runs_drawn(&self) -> Vec<(crate::groups::Run, Vec<usize>)> {
        self.read(|table| {
            let index = |place: usize| table.columns[place].index(place);
            crate::groups::runs(
                (0..table.columns.len())
                    .map(|place| table.column_info[index(place)].group.as_slice()),
            )
            .runs
            .into_iter()
            .map(|run| {
                let indices = (run.start..run.end).map(index).collect();
                (run, indices)
            })
            .collect()
        })
    }

    /// 9: every group cell the last frame drew is a run of the drawn order.
    #[cfg(feature = "group-headers")]
    fn groups_drawn(&self) -> Checked {
        let runs = self.runs_drawn();
        let drawn = self.read(|table| table.group_state.drawn.clone());
        for cell in drawn {
            let found = runs.iter().any(|(run, _)| {
                (run.level, run.start, run.end, &run.label)
                    == (cell.level, cell.start, cell.end, &cell.label)
            });
            if !found {
                return Err(Violation::new(
                    9,
                    format!(
                        "{} drawn over places {}..{} at level {}: not a run of the drawn order",
                        cell.label, cell.start, cell.end, cell.level
                    ),
                ));
            }
        }
        Ok(())
    }

    /// 10: every run in `before` is still side by side, after a release
    /// that moved columns.
    #[cfg(all(feature = "group-headers", feature = "reorder"))]
    fn runs_whole(&self, before: Vec<(crate::groups::Run, Vec<usize>)>) -> Checked {
        let order = self.read(|table| table.order().to_vec());
        for (run, indices) in before {
            let places: Vec<usize> = indices
                .iter()
                .filter_map(|index| order.iter().position(|drawn| drawn == index))
                .collect();
            let (low, high) = (
                places.iter().min().copied().unwrap_or(0),
                places.iter().max().copied().unwrap_or(0),
            );
            if places.len() == indices.len() && high - low + 1 != indices.len() {
                return Err(Violation::new(
                    10,
                    format!(
                        "{} (level {}, indices {indices:?}) split by a drag: at places {places:?}",
                        run.label, run.level
                    ),
                ));
            }
        }
        self.groups_drawn()
    }

    // --- the pointer ---

    /// The drags on.
    fn drags(&self) -> Drags {
        // With every feature on, each field is named.
        #[allow(clippy::needless_update)]
        self.read(|table| Drags {
            scrollbar: table.drag.is_some(),
            #[cfg(feature = "resize")]
            resize: table.resizing.is_some(),
            #[cfg(feature = "select")]
            select: table.is_selecting(),
            #[cfg(feature = "reorder")]
            moving: table.moving.is_some(),
            ..Drags::default()
        })
    }

    /// 11: after `what` (the left button's release, or a move with no
    /// button) and a frame, no drag is on.
    fn drags_ended(&self, what: &str) -> Checked {
        let drags = self.drags();
        if drags.any() {
            return Err(Violation::new(11, format!("after {what}: {drags:?}")));
        }
        Ok(())
    }

    /// A point of `zone` from `x` and `y`, in window pixels, and for a
    /// band its column's index; `None` where the zone has nothing now.
    fn point_in(&self, zone: Zone, x: u16, y: u16) -> Option<(Point<Pixels>, Option<usize>)> {
        self.read(|table| {
            let origin = table.body.origin;
            let (gutter, row_h) = (table.gutter_width(), f32::from(table.sizes().row()));
            let (width, height) = (table.cells_width(), f32::from(table.viewport().height));
            let bar = f32::from(Scrollbar::width());
            #[cfg(feature = "group-headers")]
            let header_rows = table.group_rows() + 1;
            #[cfg(not(feature = "group-headers"))]
            let header_rows = 1;
            let names = origin.y - px(row_h / 2.0);
            let across = (width >= 1.0).then(|| origin.x + px(gutter + f32::from(x) % width));
            let down = (height >= 1.0).then(|| origin.y + px(f32::from(y) % height));
            let at = match zone {
                Zone::Header => {
                    let from_top = usize::from(y) % header_rows;
                    let up = row_h * (header_rows - from_top) as f32 - row_h / 2.0;
                    point(across?, origin.y - px(up))
                }
                Zone::Cell => point(across?, down?),
                Zone::Gutter => point(origin.x + px(gutter / 2.0), down?),
                Zone::Corner => point(origin.x + px(gutter / 2.0), names),
                Zone::Track if x.is_multiple_of(2) => {
                    point(origin.x + table.body.size.width - px(bar / 2.0), down?)
                }
                Zone::Track => point(across?, origin.y + table.body.size.height - px(bar / 2.0)),
                #[cfg(feature = "resize")]
                Zone::Band => {
                    // One no other band lies over: the last pinned
                    // column's reaches over the run's edge, onto a
                    // scrolled column's there, and takes its press.
                    let bands = table.bands_drawn.borrow();
                    let apart = |band: &&super::resize::DrawnBand| {
                        bands
                            .iter()
                            .filter(|other| other.shown && other.column != band.column)
                            .all(|other| (other.x - band.x).abs() >= 10.0)
                    };
                    let shown: Vec<_> = bands
                        .iter()
                        .filter(|band| band.shown)
                        .filter(apart)
                        .collect();
                    let band = shown.get(usize::from(x) % shown.len().max(1))?;
                    return Some((point(px(band.x), names), Some(band.column)));
                }
                #[cfg(feature = "sort")]
                Zone::Arrow => {
                    let arrows = &table.sort_state.drawn;
                    let target = arrows.get(usize::from(x) % arrows.len().max(1))?.target;
                    target.origin + point(target.size.width / 2.0, target.size.height / 2.0)
                }
                // Not among this build's zones.
                #[cfg(not(feature = "resize"))]
                Zone::Band => return None,
                #[cfg(not(feature = "sort"))]
                Zone::Arrow => return None,
            };
            Some((at, None))
        })
    }

    /// 12: a width a pointer step wrote is within its column's least and
    /// most (or what it was at the press: a drag back restores it).
    #[cfg(feature = "resize")]
    fn widths_written(&self, before: &[Option<f32>]) -> Checked {
        let pressed = &self.pressed_widths;
        self.read(|table| {
            let sizes = table.sizes();
            for (index, column) in table.column_info.iter().enumerate() {
                let Some(width) = column.width else {
                    continue;
                };
                if before.get(index) == Some(&Some(width))
                    || pressed.get(index) == Some(&Some(width))
                    || width == column.clamp_width(width, sizes)
                {
                    continue;
                }
                return Err(Violation::new(
                    12,
                    format!(
                        "column {index} set {width} px wide, outside its least and most ({} px)",
                        column.clamp_width(width, sizes)
                    ),
                ));
            }
            Ok(())
        })
    }

    /// `Step::Down`: a press at a point of the zone, and a frame. On a
    /// band, 16: a first left press there holds the band's column.
    fn pointer_down(
        &mut self,
        (zone, x, y): (Zone, u16, u16),
        button: u8,
        count: u8,
        modifiers: u8,
    ) -> Checked {
        self.frame();
        let Some((at, band)) = self.point_in(zone, x, y) else {
            return Ok(());
        };
        let button = if button.is_multiple_of(8) {
            MouseButton::Right
        } else {
            MouseButton::Left
        };
        let click_count = match count % 8 {
            0 => 3,
            1 => 2,
            _ => 1,
        };
        let modifiers = match modifiers % 8 {
            0 => Modifiers::shift(),
            1 => Modifiers::control(),
            _ => Modifiers::default(),
        };
        #[cfg(feature = "resize")]
        let before = {
            let (resizing, widths) = self.read(|table| (table.resizing, stored_widths(table)));
            if resizing.is_none() {
                self.pressed_widths.clone_from(&widths);
            }
            widths
        };
        // A tooltip beside the pointer's cell may lie over the header.
        let covered = self.read(|table| {
            table
                .hover
                .as_ref()
                .is_some_and(|hover| hover.tooltip.is_some())
        });
        self.pointer = at;
        self.cx.simulate_event(MouseDownEvent {
            position: at,
            modifiers,
            button,
            click_count,
            first_mouse: false,
        });
        if button == MouseButton::Left {
            self.left_down = true;
        }
        self.frame();
        #[cfg(feature = "resize")]
        {
            self.widths_written(&before)?;
            if let Some(column) = band
                && button == MouseButton::Left
                && click_count == 1
                && !covered
            {
                let held = self.read(|table| table.resizing.map(|resizing| resizing.column));
                if held != Some(column) {
                    return Err(Violation::new(
                        16,
                        format!("a press on column {column}'s band holds {held:?}"),
                    ));
                }
            }
        }
        #[cfg(not(feature = "resize"))]
        let _ = (band, covered);
        Ok(())
    }

    /// `Step::Drag`: the pointer moved, the left button held or not, and a
    /// frame. With no button, 11: every drag ended.
    fn pointer_move(&mut self, dx: i16, dy: i16, up: bool) -> Checked {
        self.frame();
        if up {
            self.left_down = false;
        }
        let view = self.cx.update(|window, _| window.viewport_size());
        let to = point(
            (self.pointer.x + px(f32::from(dx))).clamp(px(0.), view.width - px(1.)),
            (self.pointer.y + px(f32::from(dy))).clamp(px(0.), view.height - px(1.)),
        );
        #[cfg(feature = "resize")]
        let before = self.read(stored_widths);
        self.pointer = to;
        self.cx.simulate_event(MouseMoveEvent {
            position: to,
            pressed_button: self.left_down.then_some(MouseButton::Left),
            modifiers: Modifiers::default(),
        });
        self.frame();
        #[cfg(feature = "resize")]
        self.widths_written(&before)?;
        if !self.left_down {
            self.drags_ended("a move with no button down")?;
        }
        Ok(())
    }

    /// `Step::PointerWheel`: a wheel at the pointer, and a frame.
    fn pointer_wheel(&mut self, rows: i8, sideways: i16) {
        self.frame();
        let row_h = self.read(|table| f32::from(table.sizes().row()));
        self.cx.simulate_event(ScrollEvent {
            position: self.pointer,
            delta: ScrollDelta::Pixels(point(
                px(-f32::from(sideways)),
                px(-f32::from(rows) * row_h),
            )),
            modifiers: Modifiers::default(),
            touch_phase: TouchPhase::Moved,
            source: ScrollSource::Pointer,
        });
        self.frame();
    }

    /// `Step::Up`: a button's release at the pointer, and a frame. The
    /// left's: every drag ended (11), no run split by its move (10), and
    /// `pin`'s count moved by the columns that crossed (14). The right's:
    /// every drag as it was (11).
    fn pointer_up(&mut self, right: bool) -> Checked {
        self.frame();
        let held = self.drags();
        #[cfg(all(feature = "group-headers", feature = "reorder"))]
        let runs = self.runs_drawn();
        #[cfg(all(feature = "reorder", feature = "pin"))]
        let (pinned, block) = self.read(|table| {
            let block = table
                .moving
                .as_ref()
                .filter(|moving| moving.started)
                .map(|moving| moving.block.clone());
            ((table.order().to_vec(), table.pinned()), block)
        });
        #[cfg(feature = "resize")]
        let before = self.read(stored_widths);
        self.cx.simulate_event(MouseUpEvent {
            button: if right {
                MouseButton::Right
            } else {
                MouseButton::Left
            },
            position: self.pointer,
            modifiers: Modifiers::default(),
            click_count: 1,
        });
        if right {
            let now = self.drags();
            self.frame();
            if now != held {
                return Err(Violation::new(
                    11,
                    format!("the right button's release changed the drags: {held:?} to {now:?}"),
                ));
            }
            return Ok(());
        }
        self.left_down = false;
        self.frame();
        #[cfg(feature = "resize")]
        self.widths_written(&before)?;
        self.drags_ended("the left button's release")?;
        #[cfg(all(feature = "reorder", feature = "pin"))]
        if let Some(block) = block {
            self.kept()?;
            self.count_moved(pinned, block)?;
        }
        #[cfg(all(feature = "group-headers", feature = "reorder"))]
        self.runs_whole(runs)?;
        Ok(())
    }

    /// 14: across a move of `block` (places before it), `pin`'s count, as
    /// it was with the `order` before: unchanged while the run holds the
    /// columns it held; otherwise the run's length, the columns that
    /// joined or left it the block's.
    #[cfg(all(feature = "reorder", feature = "pin"))]
    fn count_moved(&self, (order, count): (Vec<usize>, usize), block: Range<usize>) -> Checked {
        let (after, count_after) = self.read(|table| (table.order().to_vec(), table.pinned()));
        if (&after, count_after) == (&order, count) || after.len() != order.len() {
            return Ok(());
        }
        let run = |order: &[usize], count: usize| {
            let mut run = order[..count.min(order.len())].to_vec();
            run.sort_unstable();
            run
        };
        let (was, is) = (run(&order, count), run(&after, count_after));
        if was == is {
            if count_after != count {
                return Err(Violation::new(
                    14,
                    format!("the count {count} became {count_after}, no column crossing the edge"),
                ));
            }
            return Ok(());
        }
        let block = order.get(block).unwrap_or_default();
        let crossed: Vec<usize> = was
            .iter()
            .filter(|column| !is.contains(column))
            .chain(is.iter().filter(|column| !was.contains(column)))
            .copied()
            .collect();
        if count_after != is.len() || crossed.iter().any(|column| !block.contains(column)) {
            return Err(Violation::new(
                14,
                format!(
                    "a move of columns {block:?}: the count {count} became {count_after}, \
                     the run {was:?} became {is:?}"
                ),
            ));
        }
        Ok(())
    }

    // --- what the features keep ---

    /// 12, 13, 15, 17, 18: what the table keeps and what a host last
    /// heard of it, whenever it's read.
    fn kept(&self) -> Checked {
        let heard = self.heard.borrow();
        let _ = &heard;
        self.read(|table| {
            let rows = table.rows();
            #[cfg(feature = "reorder")]
            {
                let order = table.order();
                let mut sorted = order.to_vec();
                sorted.sort_unstable();
                if !sorted.iter().copied().eq(0..table.column_info.len()) {
                    return Err(Violation::new(
                        13,
                        format!(
                            "{order:?} isn't an order of {} columns",
                            table.column_info.len()
                        ),
                    ));
                }
                let laid_out: Vec<usize> =
                    table.columns.iter().map(|column| column.index).collect();
                if laid_out != order {
                    return Err(Violation::new(
                        13,
                        format!("the columns are laid out as {laid_out:?}, the order is {order:?}"),
                    ));
                }
                if heard.order != order {
                    return Err(Violation::new(
                        13,
                        format!(
                            "the last ColumnsMoved said {:?}, the order is {order:?}",
                            heard.order
                        ),
                    ));
                }
            }
            // A drag reports its widths at its release.
            #[cfg(feature = "resize")]
            if table.resizing.is_none() {
                let widths = set_widths(table);
                if heard.widths != widths {
                    return Err(Violation::new(
                        12,
                        format!(
                            "the last ColumnWidthsChanged said {:?}, the set widths are {widths:?}",
                            heard.widths
                        ),
                    ));
                }
            }
            #[cfg(feature = "select")]
            {
                let selection = table.selection();
                if let Some(selection) = selection {
                    let (anchor, head) = (selection.anchor(), selection.head());
                    let columns = table.columns.len();
                    let kind = selection.kind();
                    // A `Columns` range covers every row, the rows to come
                    // too: with none, its cells stand at row 0.
                    let rows_exist = if kind == Kind::Columns {
                        anchor.0.max(head.0) < rows.max(1)
                    } else {
                        anchor.0.max(head.0) < rows
                    };
                    if anchor.1.max(head.1) >= columns || !rows_exist {
                        return Err(Violation::new(
                            15,
                            format!("{selection:?} with {rows} rows and {columns} columns"),
                        ));
                    }
                    if !table.selectable().allows(kind) {
                        return Err(Violation::new(
                            15,
                            format!("{selection:?} with its kind off"),
                        ));
                    }
                    // Nothing of it shown: no longer a selection (`hide`).
                    #[cfg(feature = "hide")]
                    if !table.shows(&selection) {
                        return Err(Violation::new(
                            15,
                            format!("{selection:?} over hidden columns alone"),
                        ));
                    }
                } else if table.is_selecting() {
                    return Err(Violation::new(15, "a drag selecting with no selection"));
                }
                if heard.selected != selection {
                    return Err(Violation::new(
                        15,
                        format!(
                            "the last Selected said {:?}, the selection is {selection:?}",
                            heard.selected
                        ),
                    ));
                }
            }
            if let Some(hover) = table.hover.as_ref().filter(|hover| hover.row >= rows) {
                return Err(Violation::new(
                    17,
                    format!("row {} hovered with {rows} rows", hover.row),
                ));
            }
            if let Some(marked) = table.marked.filter(|marked| *marked >= rows) {
                return Err(Violation::new(
                    17,
                    format!("row {marked} marked with {rows} rows"),
                ));
            }
            #[cfg(feature = "find")]
            if let Some(cell) = table.current_match().filter(|cell| cell.row >= rows) {
                return Err(Violation::new(
                    17,
                    format!("the current match {cell:?} with {rows} rows"),
                ));
            }
            #[cfg(all(feature = "live", feature = "custom-cells"))]
            if let Some(row) = table.flashes.past(rows) {
                return Err(Violation::new(
                    17,
                    format!("row {row} flashing with {rows} rows"),
                ));
            }
            #[cfg(feature = "pin")]
            if heard.pinned != table.pinned_in_effect() {
                return Err(Violation::new(
                    18,
                    format!(
                        "the last Pinned said {}, {} are pinned in effect",
                        heard.pinned,
                        table.pinned_in_effect()
                    ),
                ));
            }
            #[cfg(feature = "sort")]
            if heard.sorted != table.sort().first().copied() {
                return Err(Violation::new(
                    18,
                    format!(
                        "the last Sorted said {:?}, the sort is {:?}",
                        heard.sorted,
                        table.sort()
                    ),
                ));
            }
            // A flag follows its column through a move: by index, as the
            // last `ColumnsHidden` (or `set_columns`) left it.
            #[cfg(feature = "hide")]
            if heard.hidden != table.hidden_flags() {
                return Err(Violation::new(
                    18,
                    format!(
                        "the last ColumnsHidden said {:?}, the flags are {:?}",
                        heard.hidden,
                        table.hidden_flags()
                    ),
                ));
            }
            // One step out at a time, as the events told it (`find`).
            #[cfg(feature = "find")]
            {
                if let Some((invariant, fault)) = &heard.find_fault {
                    return Err(Violation::new(*invariant, fault.clone()));
                }
                if heard.find_out != table.find_state.out.is_some() {
                    return Err(Violation::new(
                        23,
                        format!(
                            "the events say a step is {}out, the table {}",
                            if heard.find_out { "" } else { "not " },
                            if table.find_state.out.is_some() {
                                "has one"
                            } else {
                                "has none"
                            }
                        ),
                    ));
                }
                let open = self
                    .books
                    .borrow()
                    .finds
                    .iter()
                    .filter(|find| !find.cancelled && !find.delivered)
                    .count();
                if open > 1 {
                    return Err(Violation::new(
                        23,
                        format!("{open} finds out, none cancelled"),
                    ));
                }
            }
            #[cfg(feature = "popover")]
            {
                if let Some(fault) = &heard.popover_fault {
                    return Err(Violation::new(18, fault.clone()));
                }
                if heard.popover != table.popover() {
                    return Err(Violation::new(
                        18,
                        format!(
                            "the last Popover said {:?}, it's open on {:?}",
                            heard.popover,
                            table.popover()
                        ),
                    ));
                }
                if heard.reset_open {
                    return Err(Violation::new(
                        26,
                        format!("the popover on {:?} open across a sort", heard.popover),
                    ));
                }
                if let Some(cell) = table.popover().filter(|cell| cell.row >= rows) {
                    return Err(Violation::new(
                        17,
                        format!("the popover on {cell:?} with {rows} rows"),
                    ));
                }
            }
            #[cfg(feature = "follow")]
            if heard.following != table.is_following() {
                return Err(Violation::new(
                    18,
                    format!(
                        "the last Following said {}, following is {}",
                        heard.following,
                        table.is_following()
                    ),
                ));
            }
            Ok(())
        })
    }

    /// At a frame, before anything runs after it: the laid-out widths
    /// (12), the hit tests against what it drew (16), and the tooltip it
    /// shows (17).
    fn framed(&self) -> Checked {
        self.read(|table| {
            #[cfg(feature = "resize")]
            {
                let sizes = table.sizes();
                let mut sum = 0.0;
                for (place, column) in table.columns.iter().enumerate() {
                    sum += column.width;
                    let info = &table.column_info[column.index(place)];
                    // A hidden one is laid out at no width (`hide`).
                    #[cfg(feature = "hide")]
                    if !column.shown() {
                        continue;
                    }
                    if info.width.is_some() && column.width != info.clamp_width(column.width, sizes)
                    {
                        return Err(Violation::new(
                            12,
                            format!(
                                "column {}, its width set, is laid out {} px wide: outside its least and most",
                                column.index(place),
                                column.width
                            ),
                        ));
                    }
                }
                if (sum - table.content_width).abs() > 0.01 {
                    return Err(Violation::new(
                        12,
                        format!(
                            "the content is {} px wide, its columns {sum}",
                            table.content_width
                        ),
                    ));
                }
            }
            #[cfg(feature = "hide")]
            hidden_nowhere(table)?;
            #[cfg(feature = "find")]
            tinted_by_the_rule(table)?;
            #[cfg(feature = "popover")]
            popover_in_view(table)?;
            #[cfg(any(feature = "select", feature = "reorder", feature = "clicks"))]
            let row_h = table.sizes().row();
            let texts = table.drawn_text.borrow();
            for cell in texts.iter() {
                // The middle of the part its region shows.
                let shown = cell.visible;
                if shown.size.width < px(3.) || shown.size.height < px(3.) {
                    continue;
                }
                let at = shown.origin + point(shown.size.width / 2.0, shown.size.height / 2.0);
                let place = table
                    .columns
                    .iter()
                    .enumerate()
                    .position(|(place, column)| column.index(place) == cell.column);
                let hit = table.cell_at(at);
                if place.is_none() || hit != place.map(|place| (cell.row, place)) {
                    return Err(Violation::new(
                        16,
                        format!(
                            "row {}, column {} (place {place:?}) drawn at {at:?}, where the cell is {hit:?}",
                            cell.row, cell.column
                        ),
                    ));
                }
                // Its header, over it in the names' row.
                #[cfg(any(feature = "select", feature = "reorder", feature = "clicks"))]
                let over = point(at.x, table.body.origin.y - row_h / 2.0);
                #[cfg(any(feature = "reorder", feature = "clicks"))]
                if table.header_place_at(over) != place {
                    return Err(Violation::new(
                        16,
                        format!(
                            "column {} (place {place:?}) drawn under {over:?}, where the header is {:?}'s",
                            cell.column,
                            table.header_place_at(over)
                        ),
                    ));
                }
                #[cfg(any(feature = "select", feature = "clicks"))]
                {
                    let target = table.target_at(over);
                    let header = match target {
                        Some(super::hit::Target::Header((_, place))) => Some(place),
                        _ => None,
                    };
                    if header != place {
                        return Err(Violation::new(
                            16,
                            format!(
                                "column {} (place {place:?}) drawn under {over:?}, where a press is on {target:?}",
                                cell.column
                            ),
                        ));
                    }
                }
                // Its arrow and its band lie in it.
                #[cfg(feature = "sort")]
                let left = cell.cell.origin.x;
                #[cfg(any(feature = "sort", feature = "resize"))]
                let right = cell.cell.origin.x + cell.cell.size.width;
                #[cfg(feature = "sort")]
                if let Some(arrow) = table
                    .sort_state
                    .drawn
                    .iter()
                    .find(|arrow| arrow.column == cell.column)
                {
                    let target = arrow.target;
                    // An arrow cut at the scrolled columns' left edge
                    // isn't drawn.
                    let floor = left.max(shown.origin.x);
                    if target.origin.x < floor - px(1.)
                        || target.origin.x + target.size.width > right + px(1.)
                    {
                        return Err(Violation::new(
                            16,
                            format!(
                                "column {}'s arrow at {target:?}, its column at {:?}, shown at {shown:?}",
                                cell.column, cell.cell
                            ),
                        ));
                    }
                }
                #[cfg(feature = "resize")]
                if let Some(band) = table
                    .bands_drawn
                    .borrow()
                    .iter()
                    .find(|band| band.column == cell.column)
                    && (px(band.x) - right).abs() > px(1.5)
                {
                    return Err(Violation::new(
                        16,
                        format!(
                            "column {}'s band at x {}, its column's right edge at {right:?}",
                            cell.column, band.x
                        ),
                    ));
                }
            }
            // Each group cell drawn is its run at its middle.
            #[cfg(all(
                feature = "group-headers",
                any(feature = "select", feature = "reorder", feature = "clicks")
            ))]
            {
                let depth = table.group_rows();
                let left = table.body.origin.x + px(table.gutter_width());
                for cell in &table.group_state.drawn {
                    if cell.width < 3.0 {
                        continue;
                    }
                    let at = point(
                        left + px(cell.left + cell.width / 2.0),
                        table.body.origin.y - row_h * (depth + 1 - cell.level) as f32
                            + row_h / 2.0,
                    );
                    let hit = table.group_row_at(at);
                    if hit != Some(Some((cell.level, cell.start, cell.end))) {
                        return Err(Violation::new(
                            16,
                            format!(
                                "{} (level {}, places {}..{}) drawn at {at:?}, where the group is {hit:?}",
                                cell.label, cell.level, cell.start, cell.end
                            ),
                        ));
                    }
                }
            }
            // The tooltip is the exact text of the value its cell draws.
            if let Some(hover) = &table.hover
                && let Some((text, _)) = &hover.tooltip
            {
                let exact = match table.cache.row(hover.row) {
                    RowState::Loaded(page, index) => table
                        .columns
                        .get(hover.column)
                        .and_then(|column| page.value(index, column.index(hover.column)))
                        .map(|value| value.to_string()),
                    _ => None,
                };
                if exact.as_deref() != Some(text.as_ref()) {
                    return Err(Violation::new(
                        17,
                        format!(
                            "the tooltip over row {}, place {} says {text:?}, its cell draws {exact:?}",
                            hover.row, hover.column
                        ),
                    ));
                }
            }
            Ok(())
        })
    }

    /// Runs `step`, then checks the invariants.
    fn step(&mut self, step: &Step) -> Checked {
        let before = self.before();
        let sent = before.sent;
        let rows = self.rows();
        let page_rows = self.paging.page_rows;
        let thousandths = |at: u16| f64::from(at.min(1000)) / 1000.0;
        match *step {
            Step::Wheel(by) => self.update(|table, cx| table.scroll_by(f64::from(by), 0.0, cx)),
            Step::Sideways(by) => self.update(|table, cx| table.scroll_by(0.0, f32::from(by), cx)),
            Step::Home => self.update(|table, cx| table.scroll_to_fraction(0.0, cx)),
            Step::End => self.update(|table, cx| table.scroll_to_fraction(1.0, cx)),
            Step::Jump(row) => {
                if rows > 0 {
                    self.update(|table, cx| table.jump_to(u64::from(row) % rows, cx));
                }
            }
            Step::Fraction(at) => {
                self.update(|table, cx| table.scroll_to_fraction(thousandths(at), cx))
            }
            // The drag's own path from the fraction on (`drag_to` maps the
            // pointer to one), as the paging fixture's `drag` step.
            Step::Press(at) => self.update(|table, cx| {
                table.drag.get_or_insert(Drag::Vertical { grab: 0.0 });
                table.scroll_to_fraction(thousandths(at), cx);
            }),
            Step::Move(at) => self.update(|table, cx| {
                if table.drag.is_some() {
                    table.scroll_to_fraction(thousandths(at), cx);
                }
            }),
            Step::Release => self.update(|table, cx| {
                if table.drag.is_some() {
                    table.end_drag(cx);
                }
            }),
            Step::Wait(pick) => {
                let waits = self.waits();
                self.cx
                    .executor()
                    .advance_clock(waits[pick as usize % waits.len()]);
                self.park();
            }
            Step::Frame => {
                self.draw();
                self.framed()?;
                self.park();
                #[cfg(feature = "group-headers")]
                self.groups_drawn()?;
            }
            // One time in two to the end of the last page: a full last
            // page, which a shrink within it keeps.
            Step::Grow(by) if by % 2 == 0 => self.set_rows((rows / page_rows + 1) * page_rows),
            Step::Grow(by) => self.set_rows(rows + 1 + u64::from(by) % (3 * page_rows)),
            Step::ShrinkWithin(at) => {
                let last = rows.saturating_sub(1) / page_rows * page_rows;
                if rows >= last + 2 {
                    self.set_rows(last + 1 + u64::from(at) % (rows - last - 1));
                }
            }
            Step::ShrinkPast(by) => {
                if rows > 0 {
                    let last = (rows - 1) / page_rows * page_rows;
                    self.set_rows(last - u64::from(by) % (last + 1).min(4 * page_rows));
                }
            }
            Step::GrowBack => self.set_rows(self.most_rows),
            Step::Retry => self.update(|table, cx| table.retry_failed(cx)),
            Step::Columns(pick) => {
                self.columns = column_count(pick, page_rows);
                let columns = columns_of(self.columns, self.sortable(), self.paths);
                // A host that kept the list's own order has it still, over
                // the new list: no `ColumnsMoved` says so.
                #[cfg(feature = "reorder")]
                {
                    let mut heard = self.heard.borrow_mut();
                    if heard.order.iter().copied().eq(0..heard.order.len()) {
                        heard.order = (0..self.columns).collect();
                    }
                }
                self.update(|table, cx| table.set_columns(columns, cx));
                // Its index means another column (`popover`).
                #[cfg(feature = "popover")]
                if let Some(cell) = self.read(|table| table.popover()) {
                    return Err(Violation::new(
                        26,
                        format!("the popover on {cell:?} open across set_columns"),
                    ));
                }
                // The widths are the new columns', as the host set them.
                #[cfg(feature = "resize")]
                {
                    self.heard.borrow_mut().widths = self.read(set_widths);
                }
                // And their flags (`hide`): no `ColumnsHidden` says so.
                #[cfg(feature = "hide")]
                {
                    self.heard.borrow_mut().hidden = self.read(TallTableState::hidden_flags);
                }
            }
            #[cfg(feature = "live")]
            Step::Invalidate { .. } if rows == 0 => {}
            #[cfg(feature = "live")]
            Step::Invalidate { at, len, near } => {
                let start = if near {
                    let top = self.read(|table| table.visible_rows().start);
                    top.saturating_sub(page_rows) + u64::from(at) % (3 * page_rows + 20)
                } else {
                    u64::from(at) % rows
                }
                .min(rows - 1);
                let end = (start + 1 + u64::from(len) % (2 * page_rows)).min(rows);
                for stamp in &mut self.books.borrow_mut().stamps[start as usize..end as usize] {
                    stamp.version += 1;
                }
                self.update(|table, cx| {
                    table.invalidate_rows(start..end, cx);
                });
            }
            #[cfg(feature = "follow")]
            Step::Follow => self.update(|table, cx| table.follow(cx)),
            #[cfg(feature = "follow")]
            Step::LetGo => self.update(|table, cx| table.let_go(cx)),
            #[cfg(feature = "select")]
            Step::Select { .. } if rows == 0 => {}
            #[cfg(feature = "select")]
            Step::Select {
                kind,
                row,
                rows: span,
                column,
                columns,
                near,
            } => {
                let count = self.read(|table| table.columns.len());
                let anchor = if near {
                    self.read(|table| table.visible_rows().start) + u64::from(row) % 24
                } else {
                    u64::from(row)
                } % rows;
                let head = anchor.saturating_add_signed(i64::from(span)).min(rows - 1);
                let kind = [Kind::Rows, Kind::Columns, Kind::Cells][kind as usize % 3];
                let selection = TallTableSelection::new(
                    kind,
                    (anchor, column as usize % count),
                    (head, columns as usize % count),
                );
                self.update(|table, cx| table.set_selection(Some(selection), cx));
            }
            #[cfg(feature = "copy")]
            Step::Copy => {
                self.update(|table, cx| table.copy(cx));
            }
            #[cfg(feature = "copy")]
            Step::CopyKey => {
                self.cx.simulate_keystrokes("cmd-c");
                self.park();
            }
            #[cfg(feature = "copy")]
            Step::CancelCopy => self.update(|table, cx| table.cancel_copy(cx)),
            #[cfg(feature = "copy")]
            Step::Escape => {
                self.cx.simulate_keystrokes("escape");
                self.park();
            }
            // The table's refusal (a column past the end or not sortable)
            // and the source's are steps too.
            #[cfg(feature = "sort")]
            Step::Sort { column, direction } => {
                let column = usize::from(column) % self.columns;
                let sort = match direction % 3 {
                    0 => None,
                    1 => Some(crate::Sort::new(column, crate::SortDirection::Ascending)),
                    _ => Some(crate::Sort::new(column, crate::SortDirection::Descending)),
                };
                self.update(|table, cx| {
                    let _ = table.set_sort(Vec::from_iter(sort), cx);
                });
            }
            // Past the columns, by up to two: the run clamped to them.
            #[cfg(feature = "pin")]
            Step::Pin(count) => {
                let count = usize::from(count) % (self.columns + 3);
                self.update(|table, cx| table.set_pinned(count, cx));
            }
            #[cfg(feature = "density")]
            Step::Density(pick) => {
                let (row, text) = DENSITIES[usize::from(pick) % DENSITIES.len()];
                let density = crate::Density {
                    row_height: px(row),
                    text_size: text,
                };
                self.update(|table, cx| table.set_density(density, cx));
                // A set width is reported as drawn, clamped at the least
                // in effect, which the host just moved.
                #[cfg(feature = "resize")]
                {
                    self.heard.borrow_mut().widths = self.read(set_widths);
                }
            }
            #[cfg(feature = "reorder")]
            Step::MoveColumns(pick) => {
                let (places, to, side) = expand_move(pick, self.columns);
                #[cfg(feature = "pin")]
                let (before, block) = (
                    self.read(|table| (table.order().to_vec(), table.pinned())),
                    places.clone(),
                );
                self.update(|table, cx| match side {
                    #[cfg(feature = "pin")]
                    Some(pinned) => table.move_columns_pinned(places, to, pinned, cx),
                    _ => table.move_columns(places, to, cx),
                });
                // The order first: the count's check reads it.
                #[cfg(feature = "pin")]
                {
                    self.kept()?;
                    self.count_moved(before, block)?;
                }
            }
            #[cfg(feature = "reorder")]
            Step::SetOrder(pick) => {
                let order = shuffled(pick, self.columns);
                self.update(|table, cx| table.set_order(order, cx));
            }
            Step::Down {
                zone,
                x,
                y,
                button,
                count,
                modifiers,
            } => self.pointer_down((zone, x, y), button, count, modifiers)?,
            Step::Drag { dx, dy, up } => self.pointer_move(dx, dy, up)?,
            Step::PointerWheel { rows, sideways } => self.pointer_wheel(rows, sideways),
            Step::Up { right } => self.pointer_up(right)?,
            Step::Replace(pick) => self.replace(pick)?,
            #[cfg(feature = "hide")]
            Step::Hide(pick) => self.hide(pick),
            #[cfg(feature = "find")]
            Step::Find(pick) => self.find(pick),
            #[cfg(feature = "popover")]
            Step::Popover(pick) => self.popover(pick)?,
            Step::Close => {
                if self.closed_at.is_none() {
                    self.closed_at = Some(sent);
                    self.update(|table, cx| table.close(cx));
                }
            }
            Step::Answer(pick, how) => self.answer(pick, how)?,
            Step::Drain { newest } => return self.drain(newest),
            Step::AtOnce(on) => self.books.borrow_mut().at_once = on,
            Step::Refuse => self.books.borrow_mut().refuse_next = true,
        }
        if !matches!(step, Step::Answer(..)) {
            self.check(&before)?;
        }
        // A few steps on the closed table, then a new one.
        if self.closed_at.is_some() {
            self.closed_steps += 1;
            if self.closed_steps > CLOSED_STEPS {
                return self.drain(false);
            }
        }
        Ok(())
    }

    /// `Step::Find`: one in four `set_find` (one in five of those none,
    /// else a cell's text or a part of it, which ends at its end one time
    /// in two, so its era is in it, and one in three in capitals); else a
    /// step, one in four backward.
    #[cfg(feature = "find")]
    fn find(&mut self, pick: u64) {
        if !pick.is_multiple_of(4) {
            let backward = (pick >> 2).is_multiple_of(4);
            self.update(|table, cx| {
                if backward {
                    table.find_previous(cx)
                } else {
                    table.find_next(cx)
                }
            });
            return;
        }
        let pick = pick >> 2;
        let rows = self.rows();
        let term = (!pick.is_multiple_of(5) && rows > 0).then(|| {
            let row = (pick >> 3) % rows;
            let column = (pick >> 20) as usize % self.columns.max(1);
            let stamp = self.books.borrow().stamps[row as usize];
            let text = cell_text(row, column, stamp);
            let start = (pick >> 30) as usize % text.len();
            let end = if (pick >> 40).is_multiple_of(2) {
                text.len()
            } else {
                start + 1 + (pick >> 41) as usize % (text.len() - start)
            };
            let term = &text[start..end];
            if (pick >> 50).is_multiple_of(3) {
                term.to_uppercase()
            } else {
                term.to_string()
            }
        });
        self.update(|table, cx| table.set_find(term.map(Into::into), cx));
    }

    /// `Step::Popover`: one in two opened on a visible cell (a row and a
    /// place from the number, refused where the table refuses); else
    /// closed, its button set (`Open row`) or taken away, its row changed
    /// in the source and invalidated (`live`), a sort (`sort`), or Enter.
    /// Then,
    /// with one open, a frame and its checks, as `Step::Frame`'s: what
    /// landed on its row since is drawn in it.
    #[cfg(feature = "popover")]
    fn popover(&mut self, pick: u64) -> Checked {
        match pick % 16 {
            0..=7 => {
                let pick = pick >> 4;
                let cell = self.read(|table| {
                    let visible = table.visible_rows();
                    let places = table.columns.len() as u64;
                    if visible.is_empty() || places == 0 {
                        return None;
                    }
                    let row = visible.start + pick % (visible.end - visible.start);
                    let place = ((pick >> 20) % places) as usize;
                    let index = table.columns[place].index(place);
                    Some(crate::PopoverCell::new(row, index))
                });
                if let Some(cell) = cell {
                    self.update(|table, cx| table.open_popover(cell, cx));
                }
            }
            8 | 9 => self.update(|table, cx| table.close_popover(cx)),
            10 => self.update(|table, cx| {
                let button = table
                    .popover_button()
                    .is_none()
                    .then(|| crate::PopoverButton::label("Open row"));
                table.set_popover_button(button, cx)
            }),
            // A sort while it's open (`sort`): the first sortable column,
            // ascending; refused or not, as the source has it.
            #[cfg(feature = "sort")]
            14 if self.read(|table| table.popover().is_some()) => {
                let sortable = self.sortable();
                if let Some(column) =
                    (0..self.columns).find(|column| sortable & (1 << (column % 8)) != 0)
                {
                    let sort = crate::Sort::new(column, crate::SortDirection::Ascending);
                    self.update(|table, cx| {
                        let _ = table.set_sort(vec![sort], cx);
                    });
                }
            }
            // The source changes its row and says so, its re-read answered
            // as it's sent (`live`).
            #[cfg(feature = "live")]
            11..=13 if let Some(cell) = self.read(|table| table.popover()) => {
                if let Some(stamp) = self.books.borrow_mut().stamps.get_mut(cell.row as usize) {
                    stamp.version += 1;
                }
                let at_once = std::mem::replace(&mut self.books.borrow_mut().at_once, true);
                self.update(|table, cx| {
                    table.invalidate_rows(cell.row..cell.row + 1, cx);
                });
                self.books.borrow_mut().at_once = at_once;
            }
            _ => {
                self.cx.simulate_keystrokes("enter");
                self.park();
            }
        }
        if self.read(|table| table.popover().is_some()) {
            self.draw();
            self.framed()?;
            self.park();
        }
        Ok(())
    }

    /// `Step::Hide`: a column's flag set, or (one in four) every flag, from
    /// `pick`'s bits; one `set_hidden` in eight a list a column longer.
    #[cfg(feature = "hide")]
    fn hide(&mut self, pick: u64) {
        let columns = self.read(|table| table.columns().len());
        if columns == 0 {
            return;
        }
        if pick.is_multiple_of(4) {
            let pick = pick >> 2;
            let long = pick.is_multiple_of(8);
            let flags: Vec<bool> = (0..columns + usize::from(long))
                .map(|index| (pick >> (3 + index % 60)) & 1 == 1)
                .collect();
            self.update(|table, cx| table.set_hidden(flags, cx));
        } else {
            let (index, hidden) = ((pick >> 1) as usize % columns, pick & 1 == 1);
            self.update(|table, cx| table.set_column_hidden(index, hidden, cx));
        }
    }

    /// Answers the open read `pick % open`, `how` it says.
    fn answer(&mut self, pick: u16, how: u8) -> Checked {
        let answerable = self.books.borrow().answerable();
        let Some(&request) = answerable.get(pick as usize % answerable.len().max(1)) else {
            return Ok(());
        };
        let cancelled = self.books.borrow().reads[request].cancelled;
        let served = if cancelled {
            how % 2 == 1
        } else {
            how % 16 < 14
        };
        let before = self.before();
        let (sender, answer) = {
            let mut books = self.books.borrow_mut();
            let read = &mut books.reads[request];
            read.served = served;
            let answer = if served {
                Ok(read.page(request))
            } else if cancelled {
                Err(PageError::Cancelled)
            } else {
                Err(PageError::Failed {
                    message: "the test failed it".into(),
                    read_failure: how % 16 == 15,
                })
            };
            (read.answer.take().expect("an answerable read"), answer)
        };
        let _ = sender.send(answer);
        self.park();
        self.check(&before)
    }

    /// Answers every read with its page and moves the clock past the
    /// settles, until nothing is open or waiting; then checks that every
    /// copy ended and nothing stalls.
    fn drain(&mut self, newest: bool) -> Checked {
        let settled =
            self.paging.scroll_settle.max(self.paging.drag_settle) + Duration::from_millis(1);
        for _ in 0..200 {
            // Each with its page, a cancelled one too.
            loop {
                let open = self.books.borrow().answerable().len();
                if open == 0 {
                    break;
                }
                self.answer(if newest { open as u16 - 1 } else { 0 }, 1)?;
            }
            let before = self.before();
            self.cx.executor().advance_clock(settled);
            self.park();
            self.check(&before)?;
            if self.books.borrow().open().next().is_none() {
                if self.closed_at.is_none() {
                    return self.check_waiting();
                }
                // Every read the closed table sent has answered.
                self.reopen();
                let before = self.before();
                return self.check(&before);
            }
        }
        Err(Violation::new(8, "the drain never ends: reads keep coming"))
    }

    /// The invariants every step keeps, against the table `before` it.
    fn check(&mut self, before: &Before) -> Checked {
        let sent = before.sent;
        self.kept()?;
        let books = self.books.borrow();
        if let Some(fault) = books.faults.first() {
            return Err(Violation::new(1, fault.clone()));
        }
        // 3: after `close`, nothing read, and every read cancelled.
        if let Some(closed_at) = self.closed_at {
            if let Some(read) = books.reads.get(closed_at.max(sent)) {
                return Err(Violation::new(
                    3,
                    format!("page {}'s read sent after close", read.page),
                ));
            }
            if let Some((request, read)) = books.open().find(|(_, read)| !read.cancelled) {
                return Err(Violation::new(
                    3,
                    format!("read {request} (page {}) left out at close", read.page),
                ));
            }
            return Ok(());
        }
        let page_rows = self.paging.page_rows;
        let max_in_flight = self.paging.max_in_flight;
        self.table.read_with(&self.cx, |table, _| {
            // 1: the cache's places are the source's open reads.
            let open = books.open().count();
            #[cfg(feature = "copy")]
            let copy_reads = table.cache.copy_reads();
            #[cfg(not(feature = "copy"))]
            let copy_reads = 0;
            let places = table.cache.in_flight() + table.cache.draining() + copy_reads;
            if places != open {
                return Err(Violation::new(
                    1,
                    format!("the cache holds {places} places, the source {open} open reads"),
                ));
            }
            if open > max_in_flight {
                return Err(Violation::new(
                    1,
                    format!("{open} reads open, past max_in_flight {max_in_flight}"),
                ));
            }
            // The reads sent in the step, judged as they went out: one
            // answered when sent is no longer open.
            let new = || books.reads.iter().enumerate().skip(sent);
            if let Some((request, read)) = new().find(|(_, read)| read.open_then > max_in_flight) {
                return Err(Violation::new(
                    1,
                    format!(
                        "read {request} sent with {} open, past max_in_flight {max_in_flight}",
                        read.open_then
                    ),
                ));
            }
            // 2: a read sent now reads no page another read open then
            // reads (neither cancelled since), but a visible one a copy
            // also reads.
            let visible = table.visible_rows();
            let visible_pages = visible.start / page_rows..visible.end.div_ceil(page_rows);
            let sent_as = |request: usize| table.cache.sent_as(request);
            for (request, read) in new().filter(|(_, read)| !read.cancelled) {
                for &other in read.beside.iter().filter(|&&other| !books.reads[other].cancelled) {
                    let copy_reads_it = sent_as(request) == Some(Sent::Copy)
                        || sent_as(other) == Some(Sent::Copy);
                    if !(copy_reads_it && visible_pages.contains(&read.page)) {
                        return Err(Violation::new(
                            2,
                            format!(
                                "page {} read twice at once (reads {other} and {request}{})",
                                read.page,
                                if copy_reads_it { ", a copy's, off screen" } else { "" }
                            ),
                        ));
                    }
                }
            }
            // 4: the bytes counted are the pages', and past the budget after
            // a landing only wanted pages (or pages being read again) stay.
            let held: usize = table
                .cache
                .loaded_slots()
                .map(|(_, page, _)| page.heap_bytes())
                .sum();
            if held != table.cache.used_bytes() {
                return Err(Violation::new(
                    4,
                    format!(
                        "the cache counts {} bytes, its pages hold {held}",
                        table.cache.used_bytes()
                    ),
                ));
            }
            // A page landed (a new one in the cache): the eviction ran then,
            // by the pages wanted before the step or after it. Reads held,
            // a step's one landing is the read it answered, by the pages
            // wanted before; answered when sent, re-reads land in a plan
            // too, which following's pin can move between two landings.
            let landed = loaded_reads(table)
                .iter()
                .any(|request| !before.loaded.contains(request));
            let known = !books.at_once || !(before.following || following(table));
            // A find's landing in the step moved the view between its
            // pages' landings, as following's pin does (`find`): the pages
            // wanted then are neither the step's before nor its after.
            #[cfg(feature = "find")]
            let known = known && books.finds.iter().filter(|find| find.delivered).count()
                == before.finds_answered;
            if landed && known && held > table.cache.budget_bytes() {
                let wanted = &before.wanted;
                let now = table.wanted();
                if let Some((page, _, _)) = table.cache.loaded_slots().find(|(page, _, rereading)| {
                    !rereading && !wanted.contains(page) && !now.contains(page)
                }) {
                    return Err(Violation::new(
                        4,
                        format!(
                            "{held} bytes past the budget's {} after a landing, page {page} unwanted",
                            table.cache.budget_bytes()
                        ),
                    ));
                }
            }
            // 5: each cell the last frame drew holds its own row's and its
            // column's text, its column read by its index wherever it's
            // drawn (`reorder`; a cut text can't be read back).
            #[cfg(feature = "reorder")]
            for cell in table.drawn_text.borrow().iter() {
                if let Some((row, column, _)) = parse_cell(&cell.text)
                    && (row, column) != (cell.row, cell.column)
                {
                    return Err(Violation::new(
                        5,
                        format!(
                            "row {}, column {} drawn as {:?}",
                            cell.row, cell.column, cell.text
                        ),
                    ));
                }
            }
            // 5: every visible row drawn as loaded is of its current era
            // (and without `live`, its current version).
            for row in visible {
                if let RowState::Loaded(page, index) = table.cache.row(row) {
                    let now = books.stamps[row as usize];
                    let Some(drawn) = page.stamps.get(index) else {
                        return Err(Violation::new(
                            5,
                            format!("row {row} drawn as loaded from a page without it"),
                        ));
                    };
                    if drawn.era != now.era || (!cfg!(feature = "live") && drawn.version != now.version)
                    {
                        return Err(Violation::new(
                            5,
                            format!("row {row} drawn as {drawn:?}, the source's is {now:?}"),
                        ));
                    }
                }
            }
            Ok(())
        })?;
        let idle = books.open().next().is_none();
        drop(books);
        #[cfg(feature = "copy")]
        self.check_copies()?;
        // With no read open and no drag moving, nothing has a reason to
        // wait: a timer that would plan later (a settle) is no excuse.
        if idle && self.read(|table| table.drag.is_none()) {
            self.check_waiting()?;
        }
        Ok(())
    }

    /// With no read open (after a drain, or whenever none is): every copy
    /// ended (6) and every visible row is loaded or failed (8).
    fn check_waiting(&mut self) -> Checked {
        if self.closed_at.is_some() {
            return Ok(());
        }
        #[cfg(feature = "copy")]
        {
            if let Some(copying) = &self.copying {
                return Err(Violation::new(
                    6,
                    format!("{:?} waits with no read open", copying.id),
                ));
            }
            if let Some(progress) = self.read(|table| table.copy_progress()) {
                return Err(Violation::new(6, format!("{progress:?} runs, unreported")));
            }
        }
        let page_rows = self.paging.page_rows;
        self.read(|table| {
            for row in table.visible_rows() {
                if matches!(table.cache.row(row), RowState::Pending)
                    && !table.cache.reread_failed(row / page_rows)
                {
                    return Err(Violation::new(
                        8,
                        format!("row {row} a placeholder with no read open"),
                    ));
                }
            }
            Ok(())
        })
    }

    /// The copy events since the last step: one copy at a time (6), and a
    /// copied text the TSV of its rows as the source served them (7).
    #[cfg(feature = "copy")]
    fn check_copies(&mut self) -> Checked {
        let events = std::mem::take(&mut *self.events.borrow_mut());
        for event in events {
            match event {
                TallTableCopy::Started { id, rows, columns } => {
                    if let Some(copying) = &self.copying {
                        return Err(Violation::new(
                            6,
                            format!("{id:?} started while {:?} runs", copying.id),
                        ));
                    }
                    // Its columns as drawn now, the step that started it
                    // having moved none since (`reorder`).
                    #[cfg_attr(not(feature = "hide"), expect(unused_mut))]
                    let mut columns = self.read(|table| order_of(table)[columns].to_vec());
                    // The shown ones only (`hide`).
                    #[cfg(feature = "hide")]
                    {
                        let hidden = self.read(TallTableState::hidden_flags);
                        columns.retain(|&index| !hidden[index]);
                    }
                    self.copying = Some(Copying {
                        id,
                        rows,
                        columns,
                        text: String::new(),
                    });
                }
                TallTableCopy::Text { id, text, .. } => match &mut self.copying {
                    Some(copying) if copying.id == id => copying.text.push_str(&text),
                    _ => return Err(Violation::new(6, format!("text for {id:?}, not running"))),
                },
                TallTableCopy::Copied { id, rows, bytes } => match self.copying.take() {
                    Some(copying) if copying.id == id => {
                        self.check_copied(&copying, rows, bytes)?
                    }
                    _ => return Err(Violation::new(6, format!("{id:?} copied, not running"))),
                },
                TallTableCopy::Failed { id, .. } => match self.copying.take() {
                    Some(copying) if copying.id == id => {}
                    _ => return Err(Violation::new(6, format!("{id:?} failed, not running"))),
                },
                _ => {}
            }
        }
        Ok(())
    }

    /// A copied text: the TSV of its rows and columns, each row of its
    /// current era, each page's rows from one read the source served.
    #[cfg(feature = "copy")]
    fn check_copied(&self, copying: &Copying, rows: u64, bytes: usize) -> Checked {
        let wrong = |detail: String| Err(Violation::new(7, format!("{:?}: {detail}", copying.id)));
        let books = self.books.borrow();
        let text = &copying.text;
        if bytes != text.len() || rows != copying.rows.clone().count() as u64 {
            return wrong(format!(
                "{rows} rows and {bytes} bytes said, {} sent",
                text.len()
            ));
        }
        let mut lines = text.split('\n');
        if self.copy_options.headers {
            let header: Vec<String> = copying.columns.iter().map(|c| format!("c{c}")).collect();
            if lines.next() != Some(header.join("\t").as_str()) {
                return wrong("no header line".into());
            }
        }
        let mut stamps: Vec<(u64, Stamp)> = Vec::new();
        for row in copying.rows.clone() {
            let Some(line) = lines.next() else {
                return wrong(format!("row {row} missing"));
            };
            let cells: Vec<&str> = line.split('\t').collect();
            if cells.len() != copying.columns.len() {
                return wrong(format!("row {row} has {} cells", cells.len()));
            }
            let mut stamp = None;
            for (&column, cell) in copying.columns.iter().zip(cells) {
                match parse_cell(cell) {
                    Some((r, c, s)) if r == row && c == column && stamp.is_none_or(|t| t == s) => {
                        stamp = Some(s);
                    }
                    _ => return wrong(format!("row {row}, column {column} copied as {cell:?}")),
                }
            }
            let stamp = stamp.expect("a column");
            let now = books.stamps[row as usize];
            if stamp.era != now.era {
                return wrong(format!(
                    "row {row} copied as {stamp:?}, the source's is {now:?}"
                ));
            }
            stamps.push((row, stamp));
        }
        if lines.next().is_some() {
            return wrong("lines past its rows".into());
        }
        let page_rows = self.paging.page_rows;
        for group in stamps.chunk_by(|a, b| a.0 / page_rows == b.0 / page_rows) {
            let page = group[0].0 / page_rows;
            let served = books.reads.iter().any(|read| {
                read.served
                    && read.page == page
                    && group.iter().all(|(row, stamp)| {
                        read.rows.contains(row)
                            && read.stamps.get((row - read.rows.start) as usize) == Some(stamp)
                    })
            });
            if !served {
                return wrong(format!(
                    "page {page}'s rows match no read the source served"
                ));
            }
        }
        Ok(())
    }
}

/// The loaded pages, by the read each answered.
fn loaded_reads(table: &TallTableState<Source>) -> Vec<usize> {
    table
        .cache
        .loaded_slots()
        .map(|(_, page, _)| page.request)
        .collect()
}

/// The order drawn: `order[place]` the index there (the identity without
/// `reorder`).
#[cfg(feature = "copy")]
fn order_of(table: &TallTableState<Source>) -> Vec<usize> {
    #[cfg(feature = "reorder")]
    return table.order().to_vec();
    #[cfg(not(feature = "reorder"))]
    (0..table.columns().len()).collect()
}

/// 22: a landed match is a cell the source answered, of the era in
/// effect: a row of a sort, a replace, or a cut since it was asked would
/// be another row now (`find`).
#[cfg(feature = "find")]
fn landed_fault(books: &Books, cell: crate::FoundCell) -> Option<String> {
    let Some(find) = books.last_delivered.map(|index| &books.finds[index]) else {
        return Some(format!("{cell:?} landed, no find answered"));
    };
    let Some((found, then)) = find.found.filter(|(found, _)| *found == cell) else {
        return Some(format!(
            "{cell:?} landed, the source answered {:?}",
            find.found
        ));
    };
    if found.row >= books.rows {
        return Some(format!("{cell:?} landed past the {} rows", books.rows));
    }
    let now = books.stamps[found.row as usize];
    if now.era != then.era {
        return Some(format!(
            "{cell:?} landed for {:?}, found in era {}, its row's era {} now",
            find.term, then.era, now.era
        ));
    }
    None
}

/// 25, at a frame: an open popover's cell in view (its row visible, its
/// column shown, some of it in the cells area), and its text the exact
/// text of the value the page drawn holds there (`popover`).
#[cfg(feature = "popover")]
fn popover_in_view(table: &TallTableState<Source>) -> Checked {
    let Some(cell) = table.popover() else {
        return Ok(());
    };
    let Some(place) = table.place_of(cell.column) else {
        return Err(Violation::new(25, format!("{cell:?}: its column is gone")));
    };
    if table.popover_cell_bounds(cell.row, place).is_none() {
        return Err(Violation::new(
            25,
            format!(
                "{cell:?} open out of view (rows {:?})",
                table.visible_rows()
            ),
        ));
    }
    if let RowState::Loaded(page, index) = table.cache.row(cell.row) {
        let value = page.value(index, cell.column).unwrap_or(CellValue::Null);
        let text = crate::popover::popover_text(&value, crate::popover::POPOVER_CHARS);
        let shown = &table.popover_state.open.as_ref().expect("open").text;
        if *shown != text {
            return Err(Violation::new(
                25,
                format!(
                    "{cell:?} shows {:?}, its page holds {:?}",
                    shown.text, text.text
                ),
            ));
        }
    }
    Ok(())
}

/// 24: every drawn cell is tinted exactly when it matches the term by the
/// rule (its exact text contains the term, both lowercased: written here
/// apart from the table's code) or is the current match (`find`).
#[cfg(feature = "find")]
fn tinted_by_the_rule(table: &TallTableState<Source>) -> Checked {
    let term = table
        .find_state
        .term
        .as_ref()
        .map(|term| term.to_lowercase());
    let current = table.find_state.current;
    for cell in table.drawn_text.borrow().iter() {
        let RowState::Loaded(page, index) = table.cache.row(cell.row) else {
            continue;
        };
        let exact = page
            .value(index, cell.column)
            .map(|value| value.to_string())
            .unwrap_or_default();
        let is_current = current == Some(crate::FoundCell::new(cell.row, cell.column));
        let matches = term
            .as_ref()
            .is_some_and(|term| exact.to_lowercase().contains(term.as_str()));
        let should = term.is_some() && (matches || is_current);
        if should != !cell.tints.is_empty() {
            return Err(Violation::new(
                24,
                format!(
                    "row {}, column {} ({exact:?}) {} under term {term:?} (current: {is_current})",
                    cell.row,
                    cell.column,
                    if should { "untinted" } else { "tinted" }
                ),
            ));
        }
    }
    Ok(())
}

/// 21: nothing of a hidden column drawn (its cells, its arrow, its band,
/// with `pin` any column the body drew, and a group cell over hidden
/// places alone), and no hit test lands on it.
#[cfg(feature = "hide")]
fn hidden_nowhere(table: &TallTableState<Source>) -> Checked {
    let hidden = table.hidden_flags();
    let index_hidden = |index: usize| hidden.get(index).copied().unwrap_or(false);
    let place_hidden = |place: usize| {
        table
            .columns
            .get(place)
            .is_some_and(|column| index_hidden(column.index(place)))
    };
    let drawn = |what: &str, column: usize| {
        Err(Violation::new(
            21,
            format!("{what} of hidden column {column} drawn"),
        ))
    };
    for cell in table.drawn_text.borrow().iter() {
        if index_hidden(cell.column) {
            return drawn(&format!("row {}'s cell", cell.row), cell.column);
        }
    }
    #[cfg(feature = "pin")]
    for &(place, _) in &table.pin_state.drawn {
        if place_hidden(place) {
            return drawn("the body's column", table.columns[place].index(place));
        }
    }
    #[cfg(feature = "sort")]
    for arrow in &table.sort_state.drawn {
        if index_hidden(arrow.column) {
            return drawn("the arrow", arrow.column);
        }
    }
    #[cfg(feature = "resize")]
    for band in table.bands_drawn.borrow().iter() {
        if index_hidden(band.column) {
            return drawn("the band", band.column);
        }
    }
    #[cfg(feature = "group-headers")]
    for cell in &table.group_state.drawn {
        if (cell.start..cell.end).all(place_hidden) {
            return Err(Violation::new(
                21,
                format!(
                    "{} drawn over hidden places {}..{} alone",
                    cell.label, cell.start, cell.end
                ),
            ));
        }
    }
    // A point at a hidden column's edge, in a row and in the header, hits
    // no hidden place.
    let place = table.place();
    let row_h = table.sizes().row();
    let left = table.body.origin.x + px(table.gutter_width());
    for (at, column) in table.columns.iter().enumerate() {
        if !index_hidden(column.index(at)) {
            continue;
        }
        let x = left + px(place.left(at, column.x, table.scroll_x));
        let in_row = point(x, table.body.origin.y + row_h / 2.0);
        if let Some((_, hit)) = table.cell_at(in_row)
            && place_hidden(hit)
        {
            return Err(Violation::new(
                21,
                format!("hidden place {hit} hit at {in_row:?}"),
            ));
        }
        #[cfg(any(feature = "reorder", feature = "clicks"))]
        {
            let over = point(x, table.body.origin.y - row_h / 2.0);
            if let Some(hit) = table.header_place_at(over)
                && place_hidden(hit)
            {
                return Err(Violation::new(
                    21,
                    format!("hidden place {hit}'s header hit at {over:?}"),
                ));
            }
        }
        #[cfg(any(feature = "select", feature = "clicks"))]
        for at in [
            in_row,
            point(table.body.origin.x + table.body.size.width, in_row.y),
        ] {
            if let Some((_, hit)) = table.cell_clamped(at)
                && place_hidden(hit)
            {
                return Err(Violation::new(
                    21,
                    format!("hidden place {hit} the nearest cell to {at:?}"),
                ));
            }
        }
    }
    Ok(())
}

fn following(table: &TallTableState<Source>) -> bool {
    #[cfg(feature = "follow")]
    return table.is_following();
    #[cfg(not(feature = "follow"))]
    {
        let _ = table;
        false
    }
}

/// `count` text columns, named `c0`, `c1`, …; with `sort`, those whose
/// bit (`index % 8`) is set in `sortable` sortable.
fn columns_of(count: usize, sortable: u8, paths: u64) -> Vec<TallTableColumn> {
    #[cfg(feature = "group-headers")]
    let paths = paths_of(count, paths);
    #[cfg(not(feature = "group-headers"))]
    let _ = paths;
    (0..count)
        .map(|index| {
            let column = TallTableColumn::new(format!("c{index}"), ColumnKind::Text);
            #[cfg(feature = "sort")]
            let column = column.sortable(sortable & (1 << (index % 8)) != 0);
            #[cfg(not(feature = "sort"))]
            let _ = sortable;
            #[cfg(feature = "group-headers")]
            let column = column.group(paths[index].clone());
            column
        })
        .collect()
}

/// A SplitMix64 stream from `seed`.
fn split_mix(seed: u64) -> impl FnMut() -> u64 {
    let mut state = seed;
    move || {
        state = state.wrapping_add(0x9e37_79b9_7f4a_7c15);
        let mut z = state;
        z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
        z ^ (z >> 31)
    }
}

/// `count` columns' label paths from `pick` (`group-headers`): none for a
/// pick of 0 (a written scenario's), else 0 to 3 levels, each level's
/// columns that reached it cut into runs of 1 to 8, each labeled from three
/// labels (so equal labels meet under other parents) or, one in four, the
/// path stopping there.
#[cfg(feature = "group-headers")]
fn paths_of(count: usize, pick: u64) -> Vec<Vec<String>> {
    let mut paths = vec![Vec::new(); count];
    if pick == 0 {
        return paths;
    }
    let mut next = split_mix(pick ^ count as u64);
    let depth = (next() % 4) as usize;
    for level in 0..depth {
        let mut place = 0;
        while place < count {
            let length = 1 + (next() % 8) as usize;
            let label = format!("g{}", next() % 3);
            let stops = next().is_multiple_of(4);
            for path in paths.iter_mut().skip(place).take(length) {
                if path.len() == level && !stops {
                    path.push(label.clone());
                }
            }
            place += length;
        }
    }
    paths
}

/// The case's paths' stream, from the scheduler seed by a stream of its
/// own: never drawn, so every case's draw is the one without the feature.
#[cfg(feature = "group-headers")]
fn with_paths(seed: u64, case: &mut Case) {
    case.paths = split_mix(seed ^ 0x3c6e_f372_fe94_f82b)().max(1);
}

/// A header's drags, up to eight, from the scheduler seed by a stream of
/// their own (`group-headers` with `reorder`): each the left button's
/// plain press in a header row, two moves, and its release, as steps of
/// their own, each up to two steps after the one before. The gestures
/// alone finish too few: of ~150 in the all-on run's cases, 12 held a
/// block and one moved it, and `group-headers`' gap control passed every
/// case; spread or back to back, these catch it at the same `SEED`s
/// (`docs/DECISIONS.md`, "Fixtures").
#[cfg(all(feature = "group-headers", feature = "reorder"))]
fn with_header_drags(seed: u64, steps: &mut Vec<Step>) {
    let mut next = split_mix(seed ^ 0xa54f_f53a_5f1d_36f1);
    for _ in 0..next() % 9 {
        let pick = next();
        let dx = (pick >> 40) as i16 % 800;
        let moves = [dx / 2, dx - dx / 2].map(|dx| Step::Drag {
            dx,
            dy: 0,
            up: false,
        });
        let down = Step::Down {
            zone: Zone::Header,
            x: (pick >> 8) as u16,
            y: (pick >> 24) as u16,
            // The left button, a first press, no modifier.
            button: 1,
            count: 2,
            modifiers: 2,
        };
        let mut at = next() as usize % (steps.len() + 1);
        for step in [down]
            .into_iter()
            .chain(moves)
            .chain([Step::Up { right: false }])
        {
            steps.insert(at, step);
            at = (at + 1 + next() as usize % 3).min(steps.len());
        }
    }
}

/// The gestures, up to six, from the scheduler seed by a stream of their
/// own, never drawn ([`with_pins`]): each a `Down`, up to three `Drag`s
/// (one in eight with no button) or `PointerWheel`s (one step in four),
/// and an `Up` (one in eight the right button's), in order, each up to
/// eight steps after the one before, so the case's other steps (a setter,
/// a sort, an answer, a `set_rows`, another gesture's) fall between a
/// press and its release.
fn with_gestures(seed: u64, steps: &mut Vec<Step>) {
    let mut next = split_mix(seed ^ 0x6a09_e667_f3bc_c908);
    let zones = zones();
    for _ in 0..next() % 7 {
        let pick = next();
        let mut at = next() as usize % (steps.len() + 1);
        let (button, count, modifiers) =
            ((pick >> 40) as u8, (pick >> 48) as u8, (pick >> 56) as u8);
        steps.insert(
            at,
            Step::Down {
                zone: zones[(pick & 0xff) as usize % zones.len()],
                x: (pick >> 8) as u16,
                y: (pick >> 24) as u16,
                button,
                count,
                modifiers,
            },
        );
        let mut after = |steps: &mut Vec<Step>, step: Step, pick: u64| {
            at = (at + 1 + pick as usize % 8).min(steps.len());
            steps.insert(at, step);
        };
        for _ in 0..next() % 4 {
            let pick = next();
            let step = if pick.is_multiple_of(4) {
                Step::PointerWheel {
                    rows: ((pick >> 8) as i16 % 12) as i8,
                    sideways: (pick >> 24) as i16 % 300,
                }
            } else {
                Step::Drag {
                    dx: (pick >> 8) as i16 % 400,
                    dy: (pick >> 24) as i16 % 200,
                    up: (pick >> 40).is_multiple_of(8),
                }
            };
            after(steps, step, next());
        }
        let right = next().is_multiple_of(8);
        after(steps, Step::Up { right }, next());
    }
}

/// A finding's scenario: `steps` on a table of `rows` rows in pages of
/// ten, two columns, reads held.
fn found(rows: u64, steps: Vec<Step>) {
    found_in(rows, 2, steps);
}

/// [`found`], on a table of `columns` columns, each sortable (`sort`).
fn found_in(rows: u64, columns: usize, steps: Vec<Step>) {
    let case = Case {
        page_rows: 10,
        prefetch: 0,
        max_in_flight: 3,
        budget_pages: 12,
        rows,
        columns,
        at_once: false,
        #[cfg(feature = "copy")]
        copy: CopyOptions::default(),
        #[cfg(feature = "sort")]
        sortable: if columns > 2 { u8::MAX } else { 0 },
        #[cfg(feature = "sort")]
        refused: 0,
        #[cfg(feature = "group-headers")]
        paths: 0,
        steps,
    };
    if let Err(failure) = run_case(0, &case, None) {
        panic!("{failure}");
    }
}

/// One case on scheduler `seed`: `Err` names the invariant and the step.
fn run_case(seed: u64, case: &Case, control: Option<Control>) -> Result<(), String> {
    let case = case.clone();
    gpui_kit::run_test_once(
        seed,
        Box::new(move |dispatcher| {
            let mut cx = TestAppContext::build(dispatcher.clone(), Some("random_paging"));
            let result = {
                let mut run = Run::open(&mut cx, &case, control);
                let before = run.before();
                let mut result = run.check(&before).map_err(|v| (v, "open".to_string()));
                for (index, step) in case.steps.iter().enumerate() {
                    if result.is_err() {
                        break;
                    }
                    result = run
                        .step(step)
                        .map_err(|v| (v, format!("step {index} ({step:?})")));
                }
                result
            };
            dispatcher.run_until_parked();
            cx.executor().forbid_parking();
            cx.quit();
            dispatcher.run_until_parked();
            result.map_err(|(violation, at)| {
                format!(
                    "invariant {} ({}) at {at}: {}",
                    violation.invariant,
                    INVARIANTS[violation.invariant as usize - 1],
                    violation.detail
                )
            })
        }),
    )
}

/// `pin`'s steps, up to eight, each a count at a place among the case's
/// steps, from the scheduler seed: never drawn, so every case's draw is the
/// one without the feature, and the controls' cases stay the ones they're
/// counted over (`docs/DECISIONS.md`, "Fixtures"). Placed by the runner
/// alone (`run`), so a written scenario runs its own steps; a failure
/// prints the case with them, which recurs as a scenario.
#[cfg(feature = "pin")]
fn with_pins(seed: u64, steps: &mut Vec<Step>) {
    place_steps(seed, steps, |pick| Step::Pin(pick as u8));
}

/// Up to eight of `step`'s, each from a number at a place among `steps`,
/// both from `seed`: never drawn ([`with_pins`]).
fn place_steps(seed: u64, steps: &mut Vec<Step>, step: fn(u64) -> Step) {
    // SplitMix64.
    let mut state = seed;
    let mut next = move || {
        state = state.wrapping_add(0x9e37_79b9_7f4a_7c15);
        let mut z = state;
        z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
        z ^ (z >> 31)
    };
    for _ in 0..next() % 9 {
        let (at, pick) = (next(), next());
        steps.insert(at as usize % (steps.len() + 1), step(pick));
    }
}

/// `replace_rows`' steps, up to eight, placed as `pin`'s are
/// ([`with_pins`]), from the scheduler seed by a stream of their own, in
/// every build; placed last, so every other step's place stays what it was.
/// Its constant is SHA-512's seventh word: with the third, fourth, or
/// sixth, the default seed's one case that catches the cache's
/// `HoldingWithoutEnd` control lost the copy it needs to a placed replace,
/// and with the fifth `pin`'s `HitIgnoresRun` passed every case.
fn with_replaces(seed: u64, steps: &mut Vec<Step>) {
    place_steps(seed ^ 0x1f83_d9ab_fb41_bd6b, steps, Step::Replace);
}

/// `hide`'s steps, up to eight, placed as `pin`'s are ([`with_pins`]),
/// from the scheduler seed by a stream of their own, placed after
/// `replace_rows`', so every other step's place stays what it was. Its
/// constant is SHA-512's third word: with it every control is caught at
/// `SEED` 0.
#[cfg(feature = "hide")]
fn with_hides(seed: u64, steps: &mut Vec<Step>) {
    place_steps(seed ^ 0x3c6e_f372_fe94_f82b, steps, Step::Hide);
}

/// `find`'s steps, up to 24 (three streams of up to eight, so a step out
/// meets the other steps often), placed as `pin`'s are ([`with_pins`]),
/// after `hide`'s, so every other step's place stays what it was. Its
/// constants are SHA-512's eighth word, and SHA-256's first and second.
#[cfg(feature = "find")]
fn with_finds(seed: u64, steps: &mut Vec<Step>) {
    for stream in [
        0x5be0_cd19_137e_2179,
        0x6a09_e667_bb67_ae85,
        0x3c6e_f372_a54f_f53a,
    ] {
        place_steps(seed ^ stream, steps, Step::Find);
    }
}

/// `popover`'s steps, up to 24 (three streams of up to eight), placed as
/// `pin`'s are ([`with_pins`]), after `find`'s, so every other step's
/// place stays what it was. Its constants: SHA-256's third word turned 17
/// bits, its fourth, and its sixth and seventh: with two streams, 48 cases
/// didn't catch `StalePopoverText` (200 did).
#[cfg(feature = "popover")]
fn with_popovers(seed: u64, steps: &mut Vec<Step>) {
    for stream in [
        0x3c6e_f372_a54f_f53a_u64.rotate_left(17),
        0xa54f_f53a_510e_527f,
        0x9b05_688c_1f83_d9ab,
    ] {
        place_steps(seed ^ stream, steps, Step::Popover);
    }
}

/// `density`'s steps' row heights and text sizes: the default, the bare
/// host's dense setting, shorter, taller, and the clamp's least.
#[cfg(feature = "density")]
const DENSITIES: [(f32, gpui_kit::AbsoluteLength); 5] = [
    (30.0, gpui_kit::AbsoluteLength::Rems(gpui_kit::Rems(0.875))),
    (18.0, gpui_kit::AbsoluteLength::Pixels(px(11.))),
    (10.0, gpui_kit::AbsoluteLength::Pixels(px(8.))),
    (48.0, gpui_kit::AbsoluteLength::Pixels(px(20.))),
    (2.0, gpui_kit::AbsoluteLength::Pixels(px(3.))),
];

/// `density`'s steps, up to eight, placed as `pin`'s are ([`with_pins`]),
/// from the scheduler seed by a stream of their own, so `pin`'s places
/// stay what they were.
#[cfg(feature = "density")]
fn with_densities(seed: u64, steps: &mut Vec<Step>) {
    place_steps(seed ^ 0xd1b5_4a32_d192_ed03, steps, |pick| {
        Step::Density(pick as u8)
    });
}

/// `follow`'s `let_go` steps, up to eight, placed as `pin`'s are
/// ([`with_pins`]), from the scheduler seed by a stream of their own, so
/// `pin`'s and `density`'s places stay what they were. Following is drawn
/// (`Step::Follow`); letting go, added after, is placed, so the draws of
/// the cases before it stay.
#[cfg(feature = "follow")]
fn with_let_gos(seed: u64, steps: &mut Vec<Step>) {
    place_steps(seed ^ 0x2545_f491_4f6c_dd1d, steps, |_| Step::LetGo);
}

/// `reorder`'s steps, up to eight, placed as `pin`'s are ([`with_pins`]),
/// from the scheduler seed by a stream of their own, so `pin`'s,
/// `density`'s, and `let_go`'s places stay what they were: one in four a
/// `set_order`, the rest a move.
#[cfg(feature = "reorder")]
fn with_moves(seed: u64, steps: &mut Vec<Step>) {
    place_steps(seed ^ 0xbb67_ae85_84ca_a73b, steps, |pick| {
        if pick % 4 == 0 {
            Step::SetOrder(pick >> 2)
        } else {
            Step::MoveColumns(pick >> 2)
        }
    });
}

/// A move among `columns` columns from `pick`: a block of one to three, a
/// `to` (each within what fits), and with `pin` a side one time in three
/// each (`None`: `move_columns`).
#[cfg(feature = "reorder")]
fn expand_move(pick: u64, columns: usize) -> (Range<usize>, usize, Option<bool>) {
    let length = 1 + (pick % 3) as usize % columns;
    let room = (columns - length + 1) as u64;
    let start = ((pick >> 8) % room) as usize;
    let to = ((pick >> 24) % room) as usize;
    let side = match (pick >> 40) % 3 {
        0 => None,
        side => Some(side == 1),
    };
    (start..start + length, to, side)
}

/// `0..columns` shuffled by a SplitMix64 stream from `pick`.
#[cfg(feature = "reorder")]
fn shuffled(pick: u64, columns: usize) -> Vec<usize> {
    let mut state = pick;
    let mut next = move || {
        state = state.wrapping_add(0x9e37_79b9_7f4a_7c15);
        let mut z = state;
        z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
        z ^ (z >> 31)
    };
    let mut order: Vec<usize> = (0..columns).collect();
    for at in (1..columns).rev() {
        order.swap(at, (next() % (at as u64 + 1)) as usize);
    }
    order
}

/// How many cases: `PROPTEST_CASES`, else 48 in the all-on run, 16 in the
/// others.
fn cases() -> u32 {
    std::env::var("PROPTEST_CASES")
        .ok()
        .and_then(|cases| cases.parse().ok())
        .unwrap_or(if ALL_ON { 48 } else { 16 })
}

/// The invariant a failure names: its text up to the step.
fn invariant_of(failure: &str) -> &str {
    failure.split(" at ").next().unwrap_or(failure)
}

/// `case` (as run, its placed steps among them), failing as `failure` on
/// scheduler `seed`, with its steps cut to the few that matter: runs of
/// steps, then single ones, left out while the same invariant still fails,
/// until none can go. Proptest's own shrink works on the draw, and the
/// placed steps move with every step it drops.
fn shrunk(seed: u64, mut case: Case, mut failure: String) -> (Case, String) {
    let invariant = invariant_of(&failure).to_string();
    let mut length = case.steps.len().div_ceil(2).max(1);
    loop {
        let mut cut = false;
        let mut at = 0;
        while at < case.steps.len() {
            let mut shorter = case.clone();
            shorter.steps.drain(at..(at + length).min(case.steps.len()));
            match run_case(seed, &shorter, None) {
                Err(still) if invariant_of(&still) == invariant => {
                    (case, failure, cut) = (shorter, still, true);
                }
                _ => at += length,
            }
        }
        if length == 1 && !cut {
            return (case, failure);
        }
        if !cut {
            length = length.div_ceil(2);
        }
    }
}

/// The cases (by `SEED`, 0 unset) under `control`: `Err` with the first
/// failure, shrunk to its minimal steps when there's no control.
fn run(control: Option<Control>) -> Result<(), String> {
    let config = gpui_kit::apply_seed_to_proptest_config(Config {
        cases: cases(),
        failure_persistence: None,
        max_shrink_iters: 0,
        ..Config::default()
    });
    let mut runner = TestRunner::new(config);
    // The failing case as run: what's shrunk and printed.
    let failed = RefCell::new(None);
    runner
        .run(&(any::<u64>(), case()), |(seed, case)| {
            // `pin`'s, `density`'s, `let_go`'s, and `reorder`'s steps, each
            // from a stream of its own, so the places of the ones before
            // stay what they were; then the gestures, and `replace_rows`'
            // last.
            let case = {
                let mut case = case;
                #[cfg(feature = "pin")]
                with_pins(seed, &mut case.steps);
                #[cfg(feature = "density")]
                with_densities(seed, &mut case.steps);
                #[cfg(feature = "follow")]
                with_let_gos(seed, &mut case.steps);
                #[cfg(feature = "reorder")]
                with_moves(seed, &mut case.steps);
                #[cfg(feature = "group-headers")]
                with_paths(seed, &mut case);
                #[cfg(all(feature = "group-headers", feature = "reorder"))]
                with_header_drags(seed, &mut case.steps);
                with_gestures(seed, &mut case.steps);
                with_replaces(seed, &mut case.steps);
                #[cfg(feature = "hide")]
                with_hides(seed, &mut case.steps);
                #[cfg(feature = "find")]
                with_finds(seed, &mut case.steps);
                #[cfg(feature = "popover")]
                with_popovers(seed, &mut case.steps);
                case
            };
            run_case(seed, &case, control).map_err(|failure| {
                *failed.borrow_mut() = Some((seed, case, failure.clone()));
                TestCaseError::fail(failure)
            })
        })
        .map_err(|error| match (error, failed.take()) {
            (TestError::Fail(..), Some((seed, case, failure))) => {
                let (case, failure) = if control.is_none() {
                    shrunk(seed, case, failure)
                } else {
                    (case, failure)
                };
                format!(
                    "{failure}\nscheduler seed {seed} (SEED={}), the case as run, its placed steps among them:\n{case}",
                    std::env::var("SEED").unwrap_or_else(|_| "0".into())
                )
            }
            (TestError::Fail(reason, _), None) => format!("failed: {reason}"),
            (TestError::Abort(reason), _) => format!("aborted: {reason}"),
        })
}

#[test]
fn random_paging() {
    if let Err(failure) = run(None) {
        panic!("{failure}");
    }
}

/// Found by the random test (the shrink it had to find): a shrink forgets
/// the pages wholly past the new end, where the cache once looked only at
/// the old last page, and grown back drew their old rows as loaded. Three
/// full pages read, the rows shrunk to 5 and grown back to 30: row 10,
/// page 1's, was drawn from the read before the cut.
#[test]
fn shrink_past_a_page_forgets_the_pages_past_it() {
    let case = Case {
        page_rows: 10,
        prefetch: 0,
        max_in_flight: 3,
        budget_pages: 12,
        rows: 30,
        columns: 2,
        at_once: false,
        #[cfg(feature = "copy")]
        copy: CopyOptions::default(),
        #[cfg(feature = "sort")]
        sortable: 0,
        #[cfg(feature = "sort")]
        refused: 0,
        #[cfg(feature = "group-headers")]
        paths: 0,
        steps: vec![
            Step::Drain { newest: false },
            Step::ShrinkPast(15),
            Step::GrowBack,
        ],
    };
    if let Err(failure) = run_case(0, &case, None) {
        panic!("{failure}");
    }
}

/// The same with `live`, shrunk to a page's start: that page is past the
/// new end, so it's forgotten. Kept, its end clamped to its start, and
/// grown back (from a count that's a page's multiple, so not marked stale)
/// it was never read again: its rows stayed placeholders with no read
/// open.
#[cfg(feature = "live")]
#[test]
fn shrink_to_a_page_start_reads_its_page_when_grown() {
    let case = Case {
        page_rows: 10,
        prefetch: 0,
        max_in_flight: 3,
        budget_pages: 12,
        rows: 10,
        columns: 2,
        at_once: false,
        #[cfg(feature = "copy")]
        copy: CopyOptions::default(),
        #[cfg(feature = "sort")]
        sortable: 0,
        #[cfg(feature = "sort")]
        refused: 0,
        #[cfg(feature = "group-headers")]
        paths: 0,
        steps: vec![
            Step::Drain { newest: false },
            Step::ShrinkPast(0),
            Step::GrowBack,
        ],
    };
    if let Err(failure) = run_case(0, &case, None) {
        panic!("{failure}");
    }
}

/// Found by the random test: `set_rows` on a closed table cancelled a read
/// `close` already cancelled. Three short pages, all read at open, the
/// table closed, the rows shrunk within the last page: its read was
/// cancelled a second time (and had it answered meanwhile, cancelled once
/// answered). A source may not know the request by then.
#[test]
fn a_closed_table_cancels_nothing_again() {
    let case = Case {
        page_rows: 8,
        prefetch: 0,
        max_in_flight: 4,
        budget_pages: 2,
        rows: 20,
        columns: 2,
        at_once: false,
        #[cfg(feature = "copy")]
        copy: CopyOptions::default(),
        #[cfg(feature = "sort")]
        sortable: 0,
        #[cfg(feature = "sort")]
        refused: 0,
        #[cfg(feature = "group-headers")]
        paths: 0,
        steps: vec![Step::Close, Step::ShrinkWithin(0)],
    };
    if let Err(failure) = run_case(0, &case, None) {
        panic!("{failure}");
    }
}

/// Found by the random test (`live` with `copy`): a copy reads a grown
/// last page itself (the cache's drawn copy lacks the new rows), and the
/// cache's prefetch re-read of that stale page went out beside it, the
/// page off screen: two reads of one page. A prefetch re-read skips a page
/// the copy reads, as a first read does.
#[cfg(all(feature = "live", feature = "copy"))]
#[test]
fn a_prefetch_reread_skips_a_page_the_copy_reads() {
    let case = Case {
        page_rows: 8,
        prefetch: 1,
        max_in_flight: 3,
        budget_pages: 2,
        rows: 10,
        columns: 2,
        at_once: true,
        copy: CopyOptions::default()
            .max_bytes(64 << 10)
            .key_max_cells(200),
        #[cfg(feature = "sort")]
        sortable: 0,
        #[cfg(feature = "sort")]
        refused: 0,
        #[cfg(feature = "group-headers")]
        paths: 0,
        steps: vec![
            Step::Grow(17691),
            Step::AtOnce(false),
            Step::Grow(65440),
            Step::Close,
            Step::Drain { newest: false },
            Step::Wheel(13),
            Step::Grow(49970),
            Step::Answer(0, 0),
            Step::Answer(180, 0),
            Step::Grow(4703),
            Step::Answer(37958, 0),
            Step::Select {
                kind: 0,
                row: 27816,
                rows: 0,
                column: 0,
                columns: 0,
                near: false,
            },
            Step::Copy,
            Step::Answer(32144, 0),
            Step::Wheel(-1),
        ],
    };
    if let Err(failure) = run_case(0, &case, None) {
        panic!("{failure}");
    }
}

/// Found by the soak (`live` with `copy`): a prefetch read of the short
/// last page is out when the rows grow to fill it; a copy of the rows read
/// the page itself, since the cache's read doesn't hold the new rows, and
/// the two were out at once, off screen. The copy waits for the cache's
/// read, then reads the page itself if it's still short.
#[cfg(all(feature = "live", feature = "copy"))]
#[test]
fn a_copy_beside_a_short_read_of_a_grown_page() {
    let case = Case {
        page_rows: 14,
        prefetch: 1,
        max_in_flight: 2,
        budget_pages: 2,
        rows: 0,
        columns: 2,
        at_once: true,
        copy: CopyOptions::default(),
        #[cfg(feature = "sort")]
        sortable: 0,
        #[cfg(feature = "sort")]
        refused: 0,
        #[cfg(feature = "group-headers")]
        paths: 0,
        steps: vec![
            Step::AtOnce(false),
            Step::Grow(13348),
            Step::Answer(0, 32),
            Step::Select {
                kind: 1,
                row: 0,
                rows: 0,
                column: 0,
                columns: 0,
                near: true,
            },
            Step::Answer(0, 16),
            Step::Grow(0),
            Step::Copy,
        ],
    };
    if let Err(failure) = run_case(0, &case, None) {
        panic!("{failure}");
    }
}

/// Found by the random test: the jump's mark survived a shrink past its
/// row, and was drawn on whichever row had its index when the rows grew
/// back. 30 rows, a jump to row 25, the rows shrunk to 5: no row marked
/// (invariant 17).
#[test]
fn a_shrink_past_the_mark_clears_it() {
    found(
        30,
        vec![
            Step::Drain { newest: false },
            Step::Jump(25),
            Step::ShrinkPast(15),
        ],
    );
}

/// Found by the random test: any button's release ended a scrollbar drag
/// (a drag selecting and a resize too), the left still down. A press on
/// the vertical track, then the right button's release: the drag is on
/// (invariant 11).
#[test]
fn a_right_release_leaves_a_drag_on() {
    found(
        100,
        vec![
            Step::Drain { newest: false },
            Step::Down {
                zone: Zone::Track,
                x: 0,
                y: 300,
                button: 1,
                count: 2,
                modifiers: 2,
            },
            Step::Up { right: true },
        ],
    );
}

/// Found by the random test: `set_rows` left a `Columns` range's rows
/// past the end. Column 0 selected with its cells at row 25 of 30, the
/// rows shrunk to 5: its rows at the last row (invariant 15).
#[cfg(feature = "select")]
#[test]
fn a_shrink_moves_a_columns_range_to_the_last_row() {
    found(
        30,
        vec![
            Step::Drain { newest: false },
            Step::Select {
                kind: 1,
                row: 25,
                rows: 0,
                column: 0,
                columns: 0,
                near: false,
            },
            Step::ShrinkPast(15),
        ],
    );
}

/// Found by the random test: the hover was cleared only when the top row
/// moved, so rows cut under a still pointer left it on a row that was
/// gone. The pointer over a row of 30, the rows shrunk to 5, the top
/// still 0: nothing hovered (invariant 17).
#[test]
fn a_shrink_past_the_hovered_row_clears_the_hover() {
    found(
        30,
        vec![
            Step::Drain { newest: false },
            Step::Drag {
                dx: 1,
                dy: 1,
                up: true,
            },
            Step::ShrinkPast(15),
        ],
    );
}

/// Found by the random test in `pairs`' run of `live` with `sort`:
/// without `pin`, a sortable column scrolled partly past the cells' left
/// edge drew its arrow cut at the edge (a sliver of it pressable), where a
/// `pin` build, pinned or not, drew none. Five sortable columns, the
/// first scrolled to its last 8 px: no arrow drawn cut (invariant 16).
#[cfg(all(feature = "sort", not(feature = "pin")))]
#[test]
fn an_arrow_cut_at_the_left_edge_is_not_drawn() {
    found_in(
        30,
        5,
        vec![
            Step::Drain { newest: false },
            Step::Sideways(192),
            Step::Frame,
        ],
    );
}

/// Found by the random test: a press on a band while a resize was on (the
/// first's release unseen) started a new drag from the dragged width, so
/// its release found nothing changed and no `ColumnWidthsChanged`
/// reported the first drag's width. A band pressed, dragged 30 px left,
/// pressed again, released: the widths heard are the widths set
/// (invariant 12).
#[cfg(feature = "resize")]
#[test]
fn a_second_band_press_reports_the_first_drags_width() {
    let band = Step::Down {
        zone: Zone::Band,
        x: 0,
        y: 0,
        button: 1,
        count: 2,
        modifiers: 2,
    };
    found(
        100,
        vec![
            Step::Drain { newest: false },
            band.clone(),
            Step::Drag {
                dx: -30,
                dy: 0,
                up: false,
            },
            band,
            Step::Up { right: false },
        ],
    );
}

/// Found by the random test: a move with no button (a release unseen)
/// ended one drag and returned, so with two on (a press on the
/// scrollbar's track, then one on a cell, no release between) the
/// scrollbar's stayed on until the next move. Every drag ends at it
/// (invariant 11).
#[cfg(feature = "select")]
#[test]
fn a_move_with_no_button_ends_every_drag() {
    let press = |zone, x| Step::Down {
        zone,
        x,
        y: 100,
        button: 1,
        count: 2,
        modifiers: 2,
    };
    found(
        100,
        vec![
            Step::Drain { newest: false },
            press(Zone::Track, 0),
            press(Zone::Cell, 50),
            Step::Drag {
                dx: 10,
                dy: 10,
                up: true,
            },
        ],
    );
}

/// Each control fails the cases (no shrinking) at the invariant it breaks.
/// Built with each control's feature, run in the all-on run only: its
/// cases are the ones the controls are counted over.
mod controls {
    use super::{ALL_ON, Control, run};
    use crate::pages::Control as Cache;
    #[cfg(feature = "copy")]
    use crate::state::copy::Control as Copy;

    /// `control` fails the cases at one of `invariants` (in the all-on run;
    /// in another, nothing).
    fn fails(control: Control, invariants: &[u8]) {
        if !ALL_ON {
            return;
        }
        // The match rule's control is the thread's (`find`).
        #[cfg(feature = "find")]
        let failure = match control {
            Control::FindRule(rule) => crate::find::with_control(rule, || run(Some(control))).err(),
            _ => run(Some(control)).err(),
        };
        #[cfg(not(feature = "find"))]
        let failure = run(Some(control)).err();
        let failure = failure.unwrap_or_else(|| panic!("{control:?} passed every case"));
        assert!(
            invariants
                .iter()
                .any(|invariant| failure.starts_with(&format!("invariant {invariant} "))),
            "{control:?} should fail invariant {invariants:?}: {failure}"
        );
    }

    #[cfg(feature = "copy")]
    #[test]
    fn places_leak() {
        fails(Control::Copy(Copy::LeakPlaces), &[1]);
    }

    #[cfg(feature = "copy")]
    #[test]
    fn copy_and_prefetch_on_one_page() {
        fails(Control::Copy(Copy::IgnoreLoading), &[2]);
    }

    #[cfg(feature = "copy")]
    #[test]
    fn an_end_without_a_plan() {
        // The rows it leaves unread, or the copy it leaves waiting (the
        // next one, after the copy that ended freed a place unplanned).
        fails(Control::Copy(Copy::EndWithoutPlan), &[8, 6]);
    }

    #[cfg(feature = "live")]
    #[test]
    fn the_limit_without_draining_reads() {
        fails(Control::Cache(Cache::LimitWithoutDraining), &[1]);
    }

    #[cfg(feature = "copy")]
    #[test]
    fn a_failed_read_keeps_its_copy() {
        fails(Control::Copy(Copy::FailureKeepsCopy), &[6]);
    }

    #[cfg(all(feature = "live", feature = "copy"))]
    #[test]
    fn a_turn_takes_rows_a_page_lacks() {
        fails(Control::Cache(Cache::HoldingWithoutEnd), &[7]);
    }

    #[cfg(feature = "copy")]
    #[test]
    fn close_leaves_the_copy_reads_out() {
        fails(Control::Copy(Copy::CloseKeepsReads), &[3]);
    }

    #[cfg(feature = "live")]
    #[test]
    fn no_eviction_when_a_reread_lands() {
        fails(Control::Cache(Cache::KeepOnReread), &[4]);
    }

    #[cfg(feature = "live")]
    #[test]
    fn a_shrink_unclamped() {
        fails(Control::Cache(Cache::ShrinkUnclamped), &[5]);
    }

    /// A reset (a replace, a sort) that keeps the cache's pages: the old
    /// rows drawn, or copied.
    #[test]
    fn a_reset_keeps_the_pages() {
        fails(Control::Cache(Cache::ResetKeepsPages), &[5, 7]);
    }

    /// A reset that forgets the loaded pages but leaves the reads out in
    /// their slots: their answers, of the old rows, drawn or copied.
    #[test]
    fn a_reset_keeps_the_reads() {
        fails(Control::Cache(Cache::ResetKeepsReads), &[5, 7]);
    }

    /// A replace that doesn't tell the new source the sort: it reads in its
    /// own order under the table's arrow.
    #[cfg(feature = "sort")]
    #[test]
    fn a_replace_leaves_the_sort_untold() {
        fails(Control::Untold, &[20]);
    }

    /// The shrink's old rule: the pages past the new end kept.
    #[test]
    fn the_pages_past_a_shrink_kept() {
        // Their old rows drawn, or (`live`) a page a shrink to its start
        // kept never read again.
        fails(Control::Cache(Cache::KeepPastShrink), &[5, 8]);
    }

    /// The runs found over the paths in index order (`DataTable`'s spans):
    /// a move leaves the groups' cells where they were.
    #[cfg(feature = "group-headers")]
    #[test]
    fn groups_by_place() {
        fails(Control::Groups(crate::groups::Control::GroupsByPlace), &[9]);
    }

    /// A drag's gaps found among every column, as without groups: a
    /// column leaves its group, a group lands inside another.
    #[cfg(all(feature = "group-headers", feature = "reorder"))]
    #[test]
    fn a_gap_outside_the_parent() {
        fails(
            Control::Groups(crate::groups::Control::GapOutsideParent),
            &[10],
        );
    }

    /// 11: the button's release leaves a column's drag on.
    #[cfg(feature = "resize")]
    #[test]
    fn a_release_leaves_the_resize_on() {
        fails(
            Control::Resize(crate::state::resize::Control::KeepOnRelease),
            &[11],
        );
    }

    /// 12: a drag sets the pointer's width, past the column's least.
    #[cfg(feature = "resize")]
    #[test]
    fn a_drag_unclamped() {
        fails(
            Control::Resize(crate::state::resize::Control::Unclamped),
            &[12],
        );
    }

    /// 13: a move writes its block over the neighbor past it.
    #[cfg(feature = "reorder")]
    #[test]
    fn a_block_over_its_neighbor() {
        fails(
            Control::Reorder(crate::reorder::Control::BlockOverNeighbor),
            &[13],
        );
    }

    /// 13: `set_columns` resets the order and says nothing (a bug
    /// `reorder`'s review found).
    #[cfg(feature = "reorder")]
    #[test]
    fn the_order_reset_unsaid() {
        fails(
            Control::Reorder(crate::reorder::Control::SilentReset),
            &[13],
        );
    }

    /// 14: a move across `pin`'s edge leaves the count.
    #[cfg(all(feature = "reorder", feature = "pin"))]
    #[test]
    fn the_count_kept_across_the_edge() {
        fails(Control::Reorder(crate::reorder::Control::CountKept), &[14]);
    }

    /// 14: the count recounted when nothing crossed: one past the columns
    /// lost.
    #[cfg(all(feature = "reorder", feature = "pin"))]
    #[test]
    fn the_count_recounted() {
        fails(Control::Reorder(crate::reorder::Control::Recount), &[14]);
    }

    /// 15: `set_rows` leaves a range past the new end.
    #[cfg(feature = "select")]
    #[test]
    fn a_shrink_keeps_the_selection() {
        fails(
            Control::Select(crate::state::select::Control::KeepPastRows),
            &[15],
        );
    }

    /// 16: a hit test that ignores `pin`'s run.
    #[cfg(feature = "pin")]
    #[test]
    fn a_hit_test_ignores_the_run() {
        fails(Control::Pin(crate::pin::Control::HitIgnoresRun), &[16]);
    }

    /// 17: a shrink keeps the jump's mark past the new end.
    #[test]
    fn a_shrink_keeps_the_mark() {
        fails(Control::MarkKept, &[17]);
    }

    /// 18: the run in effect changes with no `Pinned`.
    #[cfg(feature = "pin")]
    #[test]
    fn the_run_changes_unsaid() {
        fails(Control::Pin(crate::pin::Control::SilentRepin), &[18]);
    }

    /// 21: a column at no width drawn where it sits inside the view.
    #[cfg(all(feature = "hide", feature = "pin"))]
    #[test]
    fn a_hidden_column_drawn() {
        fails(Control::Pin(crate::pin::Control::DrawnHidden), &[21]);
    }

    /// 15: a hide that leaves the selection nothing shown keeps it.
    #[cfg(all(feature = "hide", feature = "select"))]
    #[test]
    fn a_hidden_selection_kept() {
        fails(
            Control::Select(crate::state::select::Control::HiddenSelectionKept),
            &[15],
        );
    }

    /// 18: the flags kept by place across a move, with no `ColumnsHidden`.
    #[cfg(all(feature = "hide", feature = "reorder"))]
    #[test]
    fn the_flags_kept_by_place() {
        fails(
            Control::Hide(crate::state::hide::Control::FlagByPlace),
            &[18],
        );
    }

    #[cfg(feature = "reorder")]
    #[test]
    fn a_cell_read_by_its_place() {
        // A moved column's cells drawn with the values of the column at its
        // place in the host's list.
        fails(Control::Reorder(crate::reorder::Control::ReadByPlace), &[5]);
    }

    /// 22: a find out kept across a sort lands its answer of the old order.
    #[cfg(all(feature = "find", feature = "sort"))]
    #[test]
    fn a_find_kept_across_a_sort() {
        fails(
            Control::Find(crate::state::find::Control::KeepFindOnSort),
            &[22],
        );
    }

    /// 26: a popover kept open across a sort.
    #[cfg(all(feature = "popover", feature = "sort"))]
    #[test]
    fn a_popover_kept_across_a_sort() {
        fails(
            Control::Popover(crate::state::popover::Control::KeepPopoverOnSort),
            &[26],
        );
    }

    /// 25: a page landing on the popover's row leaves its text as it was.
    #[cfg(all(feature = "popover", feature = "live"))]
    #[test]
    fn a_stale_popover_text() {
        fails(
            Control::Popover(crate::state::popover::Control::StalePopoverText),
            &[25],
        );
    }

    /// 24: the highlight's test without the fold.
    #[cfg(feature = "find")]
    #[test]
    fn a_find_without_the_fold() {
        fails(
            Control::FindRule(crate::find::Control::CaseSensitive),
            &[24],
        );
    }
}
