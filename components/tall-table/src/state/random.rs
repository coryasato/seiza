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
//! from it meanwhile (a step generated, a step run, or a pair checked, left
//! out; none today: `docs/DECISIONS.md`, "Fixtures"). Each negative control (a fault in the table, all
//! test-only) must fail the all-on run's cases at its invariant.

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
    App, AppContext as _, Context, Entity, IntoElement, ParentElement as _, Render, Styled as _,
    TestAppContext, VisualTestContext, Window, div, px, size,
};

use super::{Drag, Paging, TallTableState, row_height};
use crate::column::{ColumnKind, TallTableColumn};
use crate::delegate::{CellValue, PageError, PageLoad, TallTableDelegate, TallTablePage};
use crate::pages::{RowState, Sent};

#[cfg(feature = "copy")]
use super::TallTableEvent;
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
    feature = "pin"
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
#[cfg(feature = "copy")]
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
    /// The table's calls that broke the delegate's contract.
    faults: Vec<String>,
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

    /// Refuses the columns drawn refused; otherwise answers in a new order
    /// from now on: every row's era bumped, so a row drawn or copied from a
    /// read of the old order is of an era gone.
    #[cfg(feature = "sort")]
    fn sort(&mut self, sort: Option<crate::Sort>, _: &mut App) -> Result<(), crate::SortRefused> {
        let mut books = self.0.borrow_mut();
        if let Some(sort) = sort
            && books.refused & (1 << (sort.column % 8)) != 0
        {
            return Err(crate::SortRefused::new("the test refused it"));
        }
        for stamp in &mut books.stamps {
            stamp.era += 1;
        }
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

const INVARIANTS: [&str; 8] = [
    "places",
    "one read a page",
    "nothing after close",
    "the budget",
    "rows drawn of their era",
    "every copy ends",
    "a copy's text",
    "nothing stalls",
];

/// The copy running, from its events.
#[cfg(feature = "copy")]
struct Copying {
    id: CopyId,
    rows: RangeInclusive<u64>,
    columns: RangeInclusive<usize>,
    text: String,
}

/// A negative control: a fault in the table the test must catch.
#[derive(Debug, Clone, Copy)]
enum Control {
    #[cfg(feature = "copy")]
    Copy(super::copy::Control),
    Cache(crate::pages::Control),
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
        let (shell, cx) = cx.add_window_view(move |_, cx| {
            let table = cx.new(|cx| {
                let columns = columns_of(columns, sortable);
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
                None => {}
            }
            #[cfg(feature = "copy")]
            table.set_copy_options(options);
        });
        #[cfg(feature = "copy")]
        let events = self.events.clone();
        self.subscription = Some(self.cx.update(|_, cx| {
            cx.subscribe(&table, move |_, event, _| {
                #[cfg(feature = "copy")]
                if let TallTableEvent::Copy(copy) = event {
                    events.borrow_mut().push(copy.clone());
                }
                #[cfg(not(feature = "copy"))]
                let _ = event;
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
        let (columns, rows) = (columns_of(self.columns, self.sortable()), self.rows());
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
        self.park();
        self.cx.update(|window, cx| window.draw(cx).clear(cx));
        self.park();
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
        })
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
            Step::Frame => self.frame(),
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
                let columns = columns_of(self.columns, self.sortable());
                self.update(|table, cx| table.set_columns(columns, cx));
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
                self.update(|table, cx| table.select(Some(selection), cx));
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
                    let _ = table.set_sort(sort, cx);
                });
            }
            // Past the columns, by up to two: the run clamped to them.
            #[cfg(feature = "pin")]
            Step::Pin(count) => {
                let count = usize::from(count) % (self.columns + 3);
                self.update(|table, cx| table.set_pinned(count, cx));
            }
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
            if let Some(progress) = self.read(|table| table.copying()) {
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
            let header: Vec<String> = copying.columns.clone().map(|c| format!("c{c}")).collect();
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
            if cells.len() != copying.columns.clone().count() {
                return wrong(format!("row {row} has {} cells", cells.len()));
            }
            let mut stamp = None;
            for (column, cell) in copying.columns.clone().zip(cells) {
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
fn columns_of(count: usize, sortable: u8) -> Vec<TallTableColumn> {
    (0..count)
        .map(|index| {
            let column = TallTableColumn::new(format!("c{index}"), ColumnKind::Text);
            #[cfg(feature = "sort")]
            let column = column.sortable(sortable & (1 << (index % 8)) != 0);
            #[cfg(not(feature = "sort"))]
            let _ = sortable;
            column
        })
        .collect()
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
        let (at, count) = (next(), next());
        steps.insert(at as usize % (steps.len() + 1), Step::Pin(count as u8));
    }
}

/// How many cases: `PROPTEST_CASES`, else 48 in the all-on run, 16 in the
/// others.
fn cases() -> u32 {
    std::env::var("PROPTEST_CASES")
        .ok()
        .and_then(|cases| cases.parse().ok())
        .unwrap_or(if ALL_ON { 48 } else { 16 })
}

/// The cases (by `SEED`, 0 unset) under `control`: `Err` with the first
/// failure, shrunk to its minimal steps when there's no control.
fn run(control: Option<Control>) -> Result<(), String> {
    let shrink = control.is_none();
    let config = gpui_kit::apply_seed_to_proptest_config(Config {
        cases: cases(),
        failure_persistence: None,
        max_shrink_iters: if shrink { 1_000_000 } else { 0 },
        max_shrink_time: 20 * 60 * 1000,
        ..Config::default()
    });
    let mut runner = TestRunner::new(config);
    runner
        .run(&(any::<u64>(), case()), |(seed, case)| {
            // A failure names its step in the case as run, `pin`'s steps
            // among them, so it's printed with them.
            #[cfg(feature = "pin")]
            let case = {
                let mut case = case;
                with_pins(seed, &mut case.steps);
                case
            };
            run_case(seed, &case, control).map_err(|failure| {
                #[cfg(feature = "pin")]
                let failure = format!("{failure}\nthe case as run, with pin's steps:\n{case}");
                TestCaseError::fail(failure)
            })
        })
        .map_err(|error| match error {
            TestError::Fail(reason, (seed, case)) => format!(
                "{reason}\nscheduler seed {seed} (SEED={}), the case:\n{case}",
                std::env::var("SEED").unwrap_or_else(|_| "0".into())
            ),
            TestError::Abort(reason) => format!("aborted: {reason}"),
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

    /// A sort that keeps the cache's pages: the old order's rows drawn.
    #[cfg(feature = "sort")]
    #[test]
    fn a_sort_keeps_the_pages() {
        fails(Control::Cache(Cache::SortKeepsPages), &[5]);
    }

    /// A sort that forgets the loaded pages but leaves the reads out in
    /// their slots: their answers, of the old order, drawn.
    #[cfg(feature = "sort")]
    #[test]
    fn a_sort_keeps_the_reads() {
        fails(Control::Cache(Cache::SortKeepsReads), &[5]);
    }

    /// The shrink's old rule: the pages past the new end kept.
    #[test]
    fn the_pages_past_a_shrink_kept() {
        // Their old rows drawn, or (`live`) a page a shrink to its start
        // kept never read again.
        fails(Control::Cache(Cache::KeepPastShrink), &[5, 8]);
    }
}
