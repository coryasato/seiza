//! The table's state entity: scroll position, page cache, hover and tooltip,
//! and the drawing of its header and body. [`TallTable`](crate::TallTable) wraps it
//! with its focus, keys, and border.

use gpui_kit::base::TooltipPositioner;
use gpui_kit::component::scroll::Scrollbar;
use gpui_kit::component::tooltip::Tooltip;
use gpui_kit::component::{ActiveTheme as _, Size as KitSize};
use gpui_kit::prelude::FluentBuilder as _;
use gpui_kit::*;

use crate::activity::{Activity, ActivityStats};
use crate::column::{CELL_PADDING, CellKind, LaidOutColumn, TallTableColumn, layout_columns};
use crate::delegate::{CellValue, PageError, TallTableDelegate, TallTablePage as _};
#[cfg(all(feature = "live", feature = "custom-cells"))]
use crate::flash::{self, Flashes};
use crate::format;
use crate::pages::{Direction, PageCache, RowState};
#[cfg(feature = "custom-cells")]
use crate::paint;
use crate::probe::{CellProbe, ColumnProbe, TallTableLayout, TallTableProbe};
use crate::scroll::{self, RowScroll};
#[cfg(feature = "follow")]
use follow::Reach;

actions!(
    seiza_tall_table,
    [LineUp, LineDown, PageUp, PageDown, ScrollToTop, ScrollToEnd]
);

pub(crate) const CONTEXT: &str = "TallTable";

/// Binds the table's scrolling keys (and with `select`, its selection's).
pub fn init(cx: &mut App) {
    cx.bind_keys([
        KeyBinding::new("up", LineUp, Some(CONTEXT)),
        KeyBinding::new("down", LineDown, Some(CONTEXT)),
        KeyBinding::new("pageup", PageUp, Some(CONTEXT)),
        KeyBinding::new("pagedown", PageDown, Some(CONTEXT)),
        KeyBinding::new("space", PageDown, Some(CONTEXT)),
        KeyBinding::new("shift-space", PageUp, Some(CONTEXT)),
        KeyBinding::new("home", ScrollToTop, Some(CONTEXT)),
        KeyBinding::new("end", ScrollToEnd, Some(CONTEXT)),
        KeyBinding::new("cmd-up", ScrollToTop, Some(CONTEXT)),
        KeyBinding::new("cmd-down", ScrollToEnd, Some(CONTEXT)),
    ]);
    // After the base's: at the same depth, the later binding wins.
    #[cfg(feature = "select")]
    select::init(cx);
}

/// How the table pages through its rows.
#[derive(Debug, Clone, Copy, PartialEq)]
#[non_exhaustive]
pub struct Paging {
    pub page_rows: u64,
    /// Pages kept loaded on each side of the viewport (twice that ahead
    /// while scrolling).
    pub prefetch: u64,
    /// Loaded pages past this many bytes are evicted, least recently used
    /// first.
    pub budget_bytes: usize,
    /// Reads in flight at once, cancelled ones still answering included.
    pub max_in_flight: usize,
    /// How long the rows must rest before prefetch stops leaning ahead.
    pub scroll_settle: std::time::Duration,
    /// How long a dragged scrollbar thumb must rest before its rows load.
    pub drag_settle: std::time::Duration,
}

/// 1024-row pages, 2 pages of prefetch, 64 MiB, 3 reads in flight, a 250 ms
/// scroll settle and an 80 ms drag settle (`docs/DECISIONS.md`, "Table and
/// paging").
impl Default for Paging {
    fn default() -> Self {
        Self {
            page_rows: 1024,
            prefetch: 2,
            budget_bytes: 64 << 20,
            max_in_flight: 3,
            scroll_settle: std::time::Duration::from_millis(250),
            drag_settle: std::time::Duration::from_millis(80),
        }
    }
}

/// How the table records its scrolling for [`TallTableState::stats`]. Without
/// it, nothing is recorded.
#[derive(Debug, Clone, Copy)]
#[non_exhaustive]
pub struct ActivityOptions {
    /// The span [`TallTableState::stats`] covers, in ms.
    pub window_ms: f64,
    /// The clock frames are timed by, in ms (the clock `stats` gets `now` from).
    pub clock: fn() -> f64,
    /// Whether to record this frame: the host's stats are on show. While
    /// it's false, nothing is kept.
    pub is_recording: fn(&App) -> bool,
}

impl ActivityOptions {
    pub fn new(window_ms: f64, clock: fn() -> f64, is_recording: fn(&App) -> bool) -> Self {
        Self {
            window_ms,
            clock,
            is_recording,
        }
    }
}

/// The table's text size (`text_sm`), in rems: drawn at it, and measured at
/// it ([`Glyphs::read`]), so the two can't drift apart.
pub(crate) const TEXT_REMS: f32 = 0.875;

/// The cells' font, and the widest advance of the characters a number is
/// written with, read from the font once (not per value).
#[derive(Debug, Clone, PartialEq)]
struct Glyphs {
    font: Font,
    font_size: Pixels,
    number_px: f32,
}

impl Glyphs {
    /// What the font is read for, before it is: IBM Plex Sans's widest
    /// number character at 14 px is about this.
    const ESTIMATE: f32 = 8.5;

    /// No font size, so the first render reads the font.
    fn estimate() -> Self {
        Self {
            font: font(".SystemUIFont"),
            font_size: px(0.),
            number_px: Self::ESTIMATE,
        }
    }

    /// The cells' font ([`TEXT_REMS`] in the theme's family) as `window`
    /// draws it.
    fn read(window: &Window, cx: &App) -> Self {
        let font = font(cx.theme().font_family.clone());
        let font_size = rems(TEXT_REMS).to_pixels(window.rem_size());
        let text_system = window.text_system();
        let id = text_system.resolve_font(&font);
        let number_px = "0123456789.-+e"
            .chars()
            .filter_map(|ch| text_system.advance(id, font_size, ch).ok())
            .map(|advance| f32::from(advance.width))
            .fold(0.0, f32::max);
        Self {
            font,
            font_size,
            number_px: if number_px > 0.0 {
                number_px
            } else {
                Self::ESTIMATE
            },
        }
    }
}

/// What a loaded cell shows. It differs from the value's exact text (the
/// tooltip's) when a float is rounded, or when text has line breaks: a cell
/// is one line, so they show as `¶` (U+21B5 `↵` isn't in IBM Plex Sans).
fn cell_text(column: &LaidOutColumn, value: CellValue<'_>) -> String {
    match (column.kind, value) {
        (CellKind::Float, CellValue::Float(value)) => {
            format::fit_float(value, format!("{value:?}"), column.budget)
        }
        (CellKind::Float, CellValue::Float32(value)) => {
            format::fit_float(f64::from(value), format!("{value:?}"), column.budget)
        }
        (_, CellValue::Text(text)) if text.contains(['\n', '\r']) => {
            text.replace("\r\n", "¶").replace(['\n', '\r'], "¶")
        }
        (_, CellValue::Text(text)) => text.into_owned(),
        (_, value) => value.to_string(),
    }
}

/// What a loaded cell shows: a muted `NULL`, or [`cell_text`]. Inlined into
/// the render loop it was split out of (for the cell fixture), so the
/// table's code is the same size as before.
#[inline(always)]
fn shown_text(column: &LaidOutColumn, value: CellValue<'_>) -> String {
    match value {
        CellValue::Null => "NULL".to_string(),
        value => cell_text(column, value),
    }
}

/// A shown tooltip's text is at most this many characters, so a long text
/// value doesn't build a wall.
const TOOLTIP_CHARS: usize = 2000;
/// A tooltip wraps its text at this width.
const TOOLTIP_MAX_WIDTH: f32 = 480.0;
/// gpui-base's tooltip layer (its `TOOLTIP_PRIORITY`, private), above popups.
const TOOLTIP_PRIORITY: usize = 200;
/// How long the pointer rests on a cell before its tooltip shows (gpui-base's
/// `SHOW_DELAY`).
const TOOLTIP_DELAY: std::time::Duration = std::time::Duration::from_millis(500);
/// How long after a tooltip goes the next one shows at once (gpui-base's
/// `GRACE_PERIOD`), so sweeping across cells doesn't wait at each.
const TOOLTIP_GRACE: std::time::Duration = std::time::Duration::from_millis(300);

/// The cell under the pointer, and its tooltip once the pointer has rested
/// there and the cell turned out rounded or cut.
struct Hover {
    row: u64,
    column: usize,
    /// The pointer rested long enough (or a tooltip had just shown).
    rested: bool,
    /// Rested, and the cell was looked at with its page loaded: decided.
    /// A page still loading is looked at again when it lands.
    decided: bool,
    tooltip: Option<(SharedString, AnyView)>,
    _rest: Option<Task<()>>,
}

const ROW_SIZE: KitSize = KitSize::Small;
const MIN_THUMB: f32 = 24.0;

/// A re-read's answer if it was ready when sent (`live`): a source that has
/// the rows in hand (the bare host's, a host's own buffer) lands its page in
/// the turn that asked, with no trip through the executor, whose web
/// dispatcher runs a spawned task from a `setTimeout(0)`. Pending, the read
/// is spawned as any other (`docs/DECISIONS.md`, "Features").
#[cfg(feature = "live")]
fn answered<P>(load: &mut crate::PageLoad<P>) -> Option<Result<P, PageError>> {
    let mut context = std::task::Context::from_waker(std::task::Waker::noop());
    match load.as_mut().poll(&mut context) {
        std::task::Poll::Ready(result) => Some(result),
        std::task::Poll::Pending => None,
    }
}

fn row_height() -> Pixels {
    ROW_SIZE.table_row_height()
}

/// Which scrollbar is being dragged, and where on the thumb it was grabbed.
#[derive(Debug, Clone, Copy, PartialEq)]
enum Drag {
    Vertical { grab: f32 },
    Horizontal { grab: f32 },
}

/// What the table reports. The host decides what to show for it.
#[derive(Debug, Clone, PartialEq)]
pub enum TallTableEvent {
    /// A frame with every visible row loaded is being drawn, after one that
    /// wasn't; `first` for the table's first. Emitted while the frame
    /// renders, so it reaches subscribers in the task that presents the
    /// frame: a mark set right after that task lands right after it's on
    /// screen.
    Filled { first: bool },
    /// A page read failed with [`PageError::Failed`]'s `read_failure`: the
    /// source is broken (a file it can no longer read). The host repairs
    /// it, then calls [`TallTableState::retry_failed`].
    ReadFailed,
    /// The vertical scrollbar's track and thumb, in window pixels, when they
    /// change: for scripts that drag it.
    Scrollbar {
        track: Bounds<Pixels>,
        thumb: Bounds<Pixels>,
    },
    /// What the frame shows, when it changes. Only while
    /// [`TallTableState::probe_frames`] is on.
    Probe(TallTableProbe),
    /// Where the cells are, when it changes. Only while
    /// [`TallTableState::probe_frames`] is on.
    Layout(TallTableLayout),
    /// Every drawn cell's exact and shown text, every frame. Only while
    /// [`TallTableState::probe_cells`] is on.
    Cells(Vec<CellProbe>),
    /// A re-read page (`live`) is drawn for the first time, its rows
    /// visible. Emitted while the frame renders, as `Filled` is; none for a
    /// page re-read off screen, then or when scrolled to. Its read started
    /// after every invalidation up to `generation`
    /// ([`TallTableState::invalidate_rows`]).
    #[cfg(feature = "live")]
    Refreshed {
        rows: std::ops::Range<u64>,
        generation: u64,
    },
    /// Following started (`true`) or stopped (`follow`): for a host's "back
    /// to the tail" button.
    #[cfg(feature = "follow")]
    Following(bool),
    /// While following, the drawn tail grew (`follow`): every row below
    /// `rows` is drawn with its values. Emitted while the frame renders, as
    /// `Filled` is; a host that called `set_rows(n)` takes the first at or
    /// past `n`.
    #[cfg(feature = "follow")]
    TailDrawn { rows: u64 },
    /// A drag released or a fit changed a width (`resize`): each column's
    /// set width (by the host's [`TallTableColumn::width`], a drag, or a
    /// fit), `None` where it's still its kind's, in the order of
    /// [`TallTableState::columns`], for a host to keep (by column name, if
    /// its columns change) and give back through `width`. Not emitted while
    /// a drag moves, or when nothing changed.
    #[cfg(feature = "resize")]
    ColumnWidthsChanged(Vec<Option<Pixels>>),
    /// The selection changed (`select`): a press, a drag, a key, `select`,
    /// `jump_to`, `set_rows` cutting it, `set_columns` clearing it. Not
    /// emitted when an input leaves it as it was.
    #[cfg(feature = "select")]
    Selected(Option<crate::selection::TallTableSelection>),
}

/// The table's paging and scrolling, for a host's stats.
#[derive(Debug, Clone, Copy, PartialEq)]
#[non_exhaustive]
pub struct TallTableStats {
    pub loaded_pages: usize,
    pub in_flight: usize,
    /// Cancelled reads the delegate is still answering.
    pub draining: usize,
    pub cache_bytes: usize,
    /// Over [`ActivityOptions::window_ms`]: rows/s and filled frames.
    pub activity: ActivityStats,
}

pub struct TallTableState<D: TallTableDelegate> {
    delegate: D,
    /// As the host gave them; [`TallTableState::set_columns`] replaces them.
    column_info: Vec<TallTableColumn>,
    columns: Vec<LaidOutColumn>,
    content_width: f32,
    /// Read from the window's font at render; columns are laid out by it.
    glyphs: Glyphs,
    hover: Option<Hover>,
    /// Running for [`TOOLTIP_GRACE`] after a tooltip went.
    tooltip_grace: Option<Task<()>>,
    /// Bumped by [`TallTableState::lay_out`]. With the body's bounds and the
    /// gutter's width, what the layout probe last reported: it's rebuilt
    /// only when that changes, not every frame of a perf run.
    layout_generation: u64,
    published_layout: Option<(Bounds<Pixels>, u64, f32)>,
    published_probe: Option<TallTableProbe>,
    published_scrollbar: Option<(Bounds<Pixels>, Bounds<Pixels>)>,
    probe_frames: bool,
    probe_cells: bool,
    scroll: RowScroll,
    scroll_x: f32,
    direction: Direction,
    cache: PageCache<D::Page, D::Request>,
    paging: Paging,
    /// The body (rows and scrollbars), measured each frame.
    body: Bounds<Pixels>,
    drag: Option<Drag>,
    /// A column's edge being dragged (`resize`): not a [`Drag`], which
    /// holds page reads as a scroll's are.
    #[cfg(feature = "resize")]
    resizing: Option<resize::Resizing>,
    /// While a scrollbar drag moves, page loads wait for the pointer to rest
    /// ([`Paging::drag_settle`]); this is that wait.
    drag_settle: Option<Task<()>>,
    /// No drag, or its pointer has rested since it last moved: an
    /// invalidation's reads can start now (`live`).
    #[cfg(feature = "live")]
    drag_resting: bool,
    /// An invalidation's or a growth's loads are waiting for the end of the
    /// update that made it (`live`): one plan for all of a batch's rows, so
    /// a source that answers at once reads a page once, not once a row.
    #[cfg(feature = "live")]
    load_deferred: bool,
    /// Resets `direction` to still once the rows stop moving
    /// ([`Paging::scroll_settle`]).
    scroll_settle: Option<Task<()>>,
    pub(crate) focus_handle: FocusHandle,
    /// Whether the last frame had every visible row loaded.
    filled: bool,
    /// Until the first filled frame: it emits [`TallTableEvent::Filled`] with
    /// `first`.
    first_fill_pending: bool,
    /// The frames drawn while recording ([`ActivityOptions`]).
    activity: Activity,
    activity_options: Option<ActivityOptions>,
    /// Set by [`TallTableState::close`]: no more page loads.
    closed: bool,
    /// The row the last jump landed on, highlighted so it can be found when
    /// the end of the rows keeps it from reaching the top.
    marked: Option<u64>,
    /// The cells flashing for a change (`live` with `custom-cells`).
    #[cfg(all(feature = "live", feature = "custom-cells"))]
    pub(crate) flashes: Flashes,
    /// Following the end (`follow`): set and cleared by the reader's moves.
    #[cfg(feature = "follow")]
    following: bool,
    /// The end of the highest tail [`TallTableEvent::TailDrawn`] reported.
    #[cfg(feature = "follow")]
    tail_drawn: u64,
    /// What's selected, which kinds can be, and a drag selecting (`select`).
    #[cfg(feature = "select")]
    selection_state: select::SelectState,
    /// The paint fixture's negative controls.
    #[cfg(all(test, feature = "custom-cells"))]
    pub(crate) paint_control: paint::Control,
    /// The paging fixture's `follow` negative controls.
    #[cfg(all(test, feature = "follow"))]
    pub(crate) follow_control: follow::Control,
}

impl<D: TallTableDelegate> TallTableState<D> {
    /// A table over `rows` rows of `delegate`, read `paging`'s way. It starts
    /// loading its first pages now. Its first filled frame emits
    /// [`TallTableEvent::Filled`] with `first`.
    pub fn new(
        delegate: D,
        columns: Vec<TallTableColumn>,
        rows: u64,
        paging: Paging,
        cx: &mut Context<Self>,
    ) -> Self {
        let glyphs = Glyphs::estimate();
        let (laid_out, content_width) = layout_columns(&columns, glyphs.number_px);
        let mut table = Self {
            delegate,
            column_info: columns,
            columns: laid_out,
            content_width,
            glyphs,
            hover: None,
            tooltip_grace: None,
            layout_generation: 0,
            published_layout: None,
            published_probe: None,
            published_scrollbar: None,
            probe_frames: false,
            probe_cells: false,
            scroll: RowScroll::new(rows),
            scroll_x: 0.0,
            direction: Direction::Still,
            cache: PageCache::new(
                rows,
                paging.page_rows,
                paging.budget_bytes,
                paging.max_in_flight,
            ),
            paging,
            body: Bounds::default(),
            drag: None,
            #[cfg(feature = "resize")]
            resizing: None,
            drag_settle: None,
            #[cfg(feature = "live")]
            drag_resting: true,
            #[cfg(feature = "live")]
            load_deferred: false,
            scroll_settle: None,
            focus_handle: cx.focus_handle(),
            filled: false,
            first_fill_pending: true,
            activity: Activity::new(0.0),
            activity_options: None,
            closed: false,
            marked: None,
            #[cfg(all(feature = "live", feature = "custom-cells"))]
            flashes: Flashes::default(),
            #[cfg(feature = "follow")]
            following: false,
            #[cfg(feature = "follow")]
            tail_drawn: 0,
            #[cfg(feature = "select")]
            selection_state: select::SelectState::default(),
            #[cfg(all(test, feature = "custom-cells"))]
            paint_control: paint::Control::None,
            #[cfg(all(test, feature = "follow"))]
            follow_control: follow::Control::None,
        };
        #[cfg(all(feature = "live", feature = "custom-cells"))]
        table.track_flashes();
        table.load_pages(cx);
        table
    }

    /// Records scrolling for [`TallTableState::stats`].
    pub fn with_activity(mut self, options: ActivityOptions) -> Self {
        self.activity = Activity::new(options.window_ms);
        self.activity_options = Some(options);
        self
    }

    /// Reports [`TallTableEvent::Probe`] and [`TallTableEvent::Layout`]. Off by
    /// default: they cost a little every frame.
    pub fn probe_frames(mut self, probe: bool) -> Self {
        self.probe_frames = probe;
        self
    }

    /// Reports [`TallTableEvent::Cells`] every frame. Off by default: it slows
    /// every frame.
    pub fn probe_cells(mut self, probe: bool) -> Self {
        self.probe_cells = probe;
        self
    }

    pub fn delegate(&self) -> &D {
        &self.delegate
    }

    pub fn delegate_mut(&mut self) -> &mut D {
        &mut self.delegate
    }

    pub fn focus_handle(&self) -> &FocusHandle {
        &self.focus_handle
    }

    pub fn rows(&self) -> u64 {
        self.scroll.rows()
    }

    pub fn columns(&self) -> &[TallTableColumn] {
        &self.column_info
    }

    /// Scrolls `row` (0-based) to the top, or as near as the end of the rows
    /// allows, and highlights it.
    ///
    /// With `select`, it selects the row (rows on), else its cell (cells
    /// on: in the active cell's column, else the first visible), emitting
    /// [`TallTableEvent::Selected`], and the selection is its highlight;
    /// with only columns on, it highlights as without the feature.
    pub fn jump_to(&mut self, row: u64, cx: &mut Context<Self>) {
        self.marked = Some(row);
        #[cfg(feature = "select")]
        self.jump_select(row, cx);
        // Decided before the move, so its reads are planned the way
        // following plans them.
        #[cfg(feature = "follow")]
        self.reader_moved(Reach::Land, row as f64, cx);
        self.move_top_to(row as f64, cx);
        // The highlight moved even if the rows didn't.
        cx.notify();
    }

    /// The delegate holds `rows` rows now (a source that grows while it
    /// loads): the scrollbar follows, and pages that were short or missing
    /// load.
    ///
    /// With `live`, a short last page that grows stays drawn, placeholders
    /// past the rows it was read with, and is read again as an invalidated
    /// page is (never cancelled for growing); the reads start once the
    /// update that called this ends, one plan for every `set_rows` and
    /// [`TallTableState::invalidate_rows`] in it.
    ///
    /// With `follow`, while following, the view moves on only as the new
    /// rows' reads land ([`TallTableState::follow`]).
    pub fn set_rows(&mut self, rows: u64, cx: &mut Context<Self>) {
        let top = self.scroll.top();
        self.scroll.set_rows(rows);
        if self.scroll.top() != top {
            self.hover = None;
        }
        #[cfg(feature = "select")]
        self.cut_selection(rows, cx);
        if let Some(request) = self.cache.set_rows(rows) {
            self.delegate.cancel(request, cx);
        }
        // Shrunk below the drawn tail: rows past it can be drawn again.
        #[cfg(feature = "follow")]
        {
            self.tail_drawn = self.tail_drawn.min(rows);
            self.pin_to_tail(cx);
        }
        #[cfg(feature = "live")]
        self.load_after_update(cx);
        #[cfg(not(feature = "live"))]
        self.load_pages(cx);
        cx.notify();
    }

    /// `rows` changed in the source (`live`). Their pages that are wanted,
    /// loaded or loading, are read again (`load_page`), a loaded one drawn
    /// as it is until the new page lands; the others are dropped. The reads
    /// start once the update that called this ends, one plan for every
    /// invalidation in it (so `stats().in_flight` doesn't count them yet),
    /// and as a scroll's do: during a scrollbar drag, once the pointer
    /// rests. Returns
    /// this invalidation's generation, which grows with each call: the first
    /// [`TallTableEvent::Refreshed`] at or past it, over a row of `rows`,
    /// is the frame that shows the change.
    ///
    /// Rows whose page isn't loaded or loading change nothing: their first
    /// read reads them as they are, and emits no `Refreshed`.
    #[cfg(feature = "live")]
    pub fn invalidate_rows(&mut self, rows: std::ops::Range<u64>, cx: &mut Context<Self>) -> u64 {
        let generation = self.cache.invalidate(rows);
        self.load_after_update(cx);
        generation
    }

    /// Plans the reads once the update ends (`live`): one plan for every
    /// invalidation and growth in it. A drag still moving: its settle loads
    /// them with the rest.
    #[cfg(feature = "live")]
    fn load_after_update(&mut self, cx: &mut Context<Self>) {
        if (self.drag.is_none() || self.drag_resting)
            && !std::mem::replace(&mut self.load_deferred, true)
        {
            let this = cx.weak_entity();
            cx.defer(move |cx| {
                let _ = this.update(cx, |this, cx| {
                    this.load_deferred = false;
                    // A drag that moved on since: its settle loads them.
                    if this.drag.is_none() || this.drag_resting {
                        this.load_pages(cx);
                    }
                });
            });
        }
    }

    /// The rows the viewport shows, partly or wholly.
    pub fn visible_rows(&self) -> std::ops::Range<u64> {
        self.scroll.visible()
    }

    /// Replaces the columns (a column's kind changed, say). Pages already
    /// loaded keep their values.
    ///
    /// With `resize`, the widths are what `columns` set
    /// ([`TallTableColumn::width`]): a host keeping widths passes them back.
    /// A column drag in progress ends, with no event.
    ///
    /// With `select`, the selection is cleared (a host keeping it calls
    /// `select` after).
    pub fn set_columns(&mut self, columns: Vec<TallTableColumn>, cx: &mut Context<Self>) {
        self.column_info = columns;
        #[cfg(feature = "resize")]
        {
            self.resizing = None;
        }
        #[cfg(feature = "select")]
        self.clear_selection_for_columns(cx);
        self.lay_out();
        #[cfg(all(feature = "live", feature = "custom-cells"))]
        {
            self.flashes.clear();
            self.track_flashes();
        }
        cx.notify();
    }

    /// The cache keeps each page's changed rows only while a column flashes.
    #[cfg(all(feature = "live", feature = "custom-cells"))]
    fn track_flashes(&mut self) {
        let flashing = self.column_info.iter().any(|column| column.flash.is_some());
        self.cache.track_changes(flashing);
    }

    /// `request`, `page`'s read, answered `new`: the cells of flashing
    /// columns, in the rows invalidated since the drawn page's read
    /// started, whose values differ from the page it replaces start to
    /// flash. Off the frame, before the cache swaps the pages. The cache
    /// keeps no rows while no column flashes, so it answers `None` then.
    #[cfg(all(feature = "live", feature = "custom-cells"))]
    fn note_flashes(&mut self, page: u64, request: D::Request, new: &D::Page, cx: &App) {
        let Some((old, rows)) = self.cache.changes(page, request) else {
            return;
        };
        let now = self.flashes.now(cx);
        let first = self.cache.rows_of(page).start;
        for (index, column) in self.column_info.iter().enumerate() {
            let Some((_, duration)) = &column.flash else {
                continue;
            };
            for row in rows.ranges().iter().flat_map(|rows| rows.clone()) {
                let at = (row - first) as usize;
                if let Some(change) = flash::change(old.value(at, index), new.value(at, index)) {
                    self.flashes.start(row, index, change, now, *duration);
                }
            }
        }
    }

    fn lay_out(&mut self) {
        (self.columns, self.content_width) =
            layout_columns(&self.column_info, self.glyphs.number_px);
        self.scroll_x = self.scroll_x.clamp(0.0, self.max_scroll_x());
        self.hover = None;
        self.layout_generation += 1;
    }

    /// Stops the table for good: cancels its page reads and starts no more.
    /// For a table being replaced: the entity can outlive this (the last
    /// frame still holds it), and a page answering meanwhile must not start
    /// new reads of rows nobody shows.
    pub fn close(&mut self, cx: &mut App) {
        self.closed = true;
        self.hover = None;
        for request in self.cache.requests() {
            self.delegate.cancel(request, cx);
        }
    }

    /// Loads the pages whose reads failed again, if they're still wanted:
    /// after the host repaired the source ([`TallTableEvent::ReadFailed`]).
    pub fn retry_failed(&mut self, cx: &mut Context<Self>) {
        if self.cache.forget_failed() {
            self.load_pages(cx);
            cx.notify();
        }
    }

    /// Whether any page's read failed and hasn't been retried.
    pub fn has_failed_reads(&self) -> bool {
        self.cache.has_failed()
    }

    /// Paging and the last [`ActivityOptions::window_ms`]' scrolling, as of
    /// `now` (on [`ActivityOptions::clock`]).
    pub fn stats(&mut self, now: f64) -> TallTableStats {
        TallTableStats {
            loaded_pages: self.cache.loaded_pages(),
            in_flight: self.cache.in_flight(),
            draining: self.cache.draining(),
            cache_bytes: self.cache.used_bytes(),
            activity: self.activity.stats(now),
        }
    }

    fn gutter_width(&self) -> f32 {
        let digits = format_count(self.scroll.rows()).len() as f32;
        digits * 7.5 + 24.0
    }

    /// The part of the body rows are drawn in: the body minus the scrollbars.
    fn viewport(&self) -> Size<Pixels> {
        let bar = Scrollbar::width();
        size(
            (self.body.size.width - bar).max(px(0.)),
            (self.body.size.height - bar).max(px(0.)),
        )
    }

    fn cells_width(&self) -> f32 {
        (f32::from(self.viewport().width) - self.gutter_width()).max(0.0)
    }

    /// The cells' width, laid out; with `resize`, held during a column
    /// drag ([`TallTableState::held_content`]).
    fn content_width(&self) -> f32 {
        #[cfg(feature = "resize")]
        let width = self.held_content(self.content_width);
        #[cfg(not(feature = "resize"))]
        let width = self.content_width;
        width
    }

    fn max_scroll_x(&self) -> f32 {
        (self.content_width() - self.cells_width()).max(0.0)
    }

    fn set_body(&mut self, body: Bounds<Pixels>, cx: &mut Context<Self>) {
        if body == self.body {
            return;
        }
        self.body = body;
        let rows = f64::from(f32::from(self.viewport().height) / f32::from(row_height()));
        let before = (self.scroll.top(), self.scroll_x);
        #[cfg(feature = "follow")]
        let bottom = self.scroll.top() + self.scroll.viewport_rows();
        let resized = self.scroll.set_viewport_rows(rows);
        // Following: the bottom stays where it was, then the pin moves it
        // on to the loaded tail.
        #[cfg(feature = "follow")]
        if resized && self.is_following() && !matches!(self.drag, Some(Drag::Vertical { .. })) {
            self.scroll.set_top(bottom - rows);
            self.pin_to_tail(cx);
        }
        self.scroll_x = self.scroll_x.clamp(0.0, self.max_scroll_x());
        // The cells moved under a still pointer (a resize clamped the
        // scroll), or the window did.
        if (self.scroll.top(), self.scroll_x) != before || resized {
            self.hover = None;
        }
        if resized {
            self.rows_moved(cx);
        }
        cx.notify();
    }

    /// Scrolls by `rows` (positive is down) and `x` pixels.
    fn scroll_by(&mut self, rows: f64, x: f32, cx: &mut Context<Self>) {
        // Decided before the move, so its reads are planned the way
        // following plans them. A move more sideways than vertical (a
        // trackpad's sideways swipe, a little vertical in it) leaves
        // following as it is.
        #[cfg(feature = "follow")]
        if rows != 0.0 && f64::from(x.abs()) <= (rows * f64::from(f32::from(row_height()))).abs() {
            let reach = if rows > 0.0 { Reach::Down } else { Reach::Up };
            self.reader_moved(reach, self.scroll.top() + rows, cx);
        }
        // A column drag holds the sideways scroll until its release.
        #[cfg(feature = "resize")]
        let x = if self.resizing.is_some() { 0.0 } else { x };
        let moved = self.scroll.scroll_by(rows);
        let scroll_x = (self.scroll_x + x).clamp(0.0, self.max_scroll_x());
        let moved_x = scroll_x != self.scroll_x;
        self.scroll_x = scroll_x;
        if rows != 0.0 && moved {
            self.direction = if rows > 0.0 {
                Direction::Down
            } else {
                Direction::Up
            };
        }
        if moved {
            self.rows_moved(cx);
        }
        if moved || moved_x {
            // The cells moved under the pointer.
            self.hover = None;
            cx.notify();
        }
    }

    /// Home, End, and the thumb dragged or pressed to `fraction`: a drag
    /// holds following until it's released.
    fn scroll_to_fraction(&mut self, fraction: f64, cx: &mut Context<Self>) {
        let top = fraction.clamp(0.0, 1.0) * self.scroll.max_top();
        #[cfg(feature = "follow")]
        self.reader_moved(
            if fraction <= 0.0 {
                Reach::Up
            } else {
                Reach::Land
            },
            top,
            cx,
        );
        self.move_top_to(top, cx);
    }

    /// Moves the top row to `top` (clamped), leaning prefetch the way it went.
    fn move_top_to(&mut self, top: f64, cx: &mut Context<Self>) {
        let before = self.scroll.top();
        if self.scroll.set_top(top) {
            self.hover = None;
            self.direction = if self.scroll.top() > before {
                Direction::Down
            } else {
                Direction::Up
            };
            self.rows_moved(cx);
            cx.notify();
        }
    }

    /// The visible rows changed: fetch what they need.
    fn rows_moved(&mut self, cx: &mut Context<Self>) {
        // Prefetch reaches further ahead while scrolling; once the rows
        // rest, it goes back to even on both sides.
        if self.direction != Direction::Still {
            let settle = self.paging.scroll_settle;
            self.scroll_settle = Some(cx.spawn(async move |this, cx| {
                cx.background_executor().timer(settle).await;
                let _ = this.update(cx, |this, cx| {
                    this.direction = Direction::Still;
                    this.load_pages(cx);
                });
            }));
        }
        self.load_or_settle(cx);
    }

    fn load_or_settle(&mut self, cx: &mut Context<Self>) {
        if self.drag.is_some() {
            // A drag passes through positions it won't stop at. A source may
            // not be able to take a read back once it starts (DuckDB-Wasm's
            // can't), and on a slow network such a read holds up the page
            // the drag ends on. So load only once the pointer rests, or on
            // release.
            let settle = self.paging.drag_settle;
            #[cfg(feature = "live")]
            {
                self.drag_resting = false;
            }
            self.drag_settle = Some(cx.spawn(async move |this, cx| {
                cx.background_executor().timer(settle).await;
                let _ = this.update(cx, |this, cx| {
                    #[cfg(feature = "live")]
                    {
                        this.drag_resting = true;
                    }
                    this.load_pages(cx)
                });
            }));
        } else {
            self.load_pages(cx);
        }
    }

    fn end_drag(&mut self, cx: &mut Context<Self>) {
        #[cfg(feature = "follow")]
        let vertical = matches!(self.drag, Some(Drag::Vertical { .. }));
        self.drag = None;
        // The release decides: following if it let go at the end.
        #[cfg(feature = "follow")]
        let pinned = vertical && {
            self.reader_moved(Reach::Land, self.scroll.top(), cx);
            self.pin_to_tail(cx)
        };
        #[cfg(not(feature = "follow"))]
        let pinned = false;
        #[cfg(feature = "live")]
        {
            self.drag_resting = true;
        }
        if self.drag_settle.take().is_some() || pinned {
            self.load_pages(cx);
        }
        cx.notify();
    }

    fn wanted(&self) -> Vec<u64> {
        #[cfg_attr(not(feature = "follow"), expect(unused_mut))]
        let mut wanted =
            self.cache
                .wanted(self.scroll.visible(), self.direction, self.paging.prefetch);
        #[cfg(feature = "follow")]
        self.tail_first(&mut wanted, self.cache.visible_pages(self.scroll.visible()));
        wanted
    }

    /// Sends the reads the viewport needs and cancels the ones it doesn't.
    fn load_pages(&mut self, cx: &mut Context<Self>) {
        let wanted = self.wanted();
        self.load_wanted(&wanted, cx);
    }

    fn load_wanted(&mut self, wanted: &[u64], cx: &mut Context<Self>) {
        if self.closed {
            return;
        }
        let visible = self.cache.visible_pages(self.scroll.visible());
        let plan = self.cache.plan(wanted, visible);
        for request in plan.cancel {
            self.delegate.cancel(request, cx);
        }
        // Re-reads answered with a page when sent (`live`): landed once
        // every read of the plan has started, then planned after once.
        #[cfg(feature = "live")]
        let mut ready = Vec::new();
        for page in plan.fetch {
            #[cfg_attr(not(feature = "live"), expect(unused_mut))]
            let (request, mut result) = self.delegate.load_page(self.cache.rows_of(page), cx);
            #[cfg(feature = "live")]
            let reread = self.cache.is_loaded(page);
            self.cache.started(page, request);
            #[cfg(feature = "live")]
            if reread && let Some(answer) = answered(&mut result) {
                match answer {
                    Ok(rows) => {
                        ready.push((page, request, rows));
                        continue;
                    }
                    // A failure or a refusal lands from a task, as before:
                    // a host retrying on `ReadFailed` mustn't loop in one
                    // turn.
                    Err(error) => result = Box::pin(std::future::ready(Err(error))),
                }
            }
            cx.spawn(async move |this, cx| {
                let result = result.await;
                let _ = this.update(cx, |this, cx| this.page_done(page, request, result, cx));
            })
            .detach();
        }
        #[cfg(feature = "live")]
        if !ready.is_empty() {
            for (page, request, rows) in ready {
                #[cfg(feature = "custom-cells")]
                self.note_flashes(page, request, &rows, cx);
                let bytes = rows.heap_bytes();
                self.cache.loaded(page, request, rows, bytes, wanted);
            }
            cx.notify();
            // Following: the pin moves on to the rows landed, and the new
            // view's pages are wanted instead.
            #[cfg(feature = "follow")]
            let pinned = self.pin_and_want(cx);
            #[cfg(feature = "follow")]
            let wanted = pinned.as_deref().unwrap_or(wanted);
            // Pages stale again (or still waiting for a slot) are read now,
            // unless a drag moved on.
            if self.drag.is_none() || self.drag_resting {
                self.load_wanted(wanted, cx);
            }
        }
    }

    fn page_done(
        &mut self,
        page: u64,
        request: D::Request,
        result: Result<D::Page, PageError>,
        cx: &mut Context<Self>,
    ) {
        if self.closed {
            return;
        }
        #[cfg_attr(not(feature = "follow"), expect(unused_mut))]
        let mut wanted = self.wanted();
        match result {
            Ok(rows) => {
                #[cfg(all(feature = "live", feature = "custom-cells"))]
                self.note_flashes(page, request, &rows, cx);
                let bytes = rows.heap_bytes();
                self.cache.loaded(page, request, rows, bytes, &wanted);
            }
            Err(PageError::Cancelled) => self.cache.cancelled(page, request),
            Err(PageError::Failed {
                message,
                read_failure,
            }) => {
                self.cache.failed(page, request, message);
                if read_failure {
                    cx.emit(TallTableEvent::ReadFailed);
                }
            }
        }
        // Following: the pin moves on to the rows landed.
        #[cfg(feature = "follow")]
        if let Some(pinned) = self.pin_and_want(cx) {
            wanted = pinned;
        }
        // A drag still moving: its settle loads what's next. Without it, a
        // read landing (one is nearly always out under a feed) would start
        // reads of the pages the drag only passes.
        #[cfg(feature = "live")]
        if self.drag.is_some() && !self.drag_resting {
            cx.notify();
            return;
        }
        self.load_wanted(&wanted, cx);
        cx.notify();
    }

    fn on_scroll_wheel(&mut self, event: &ScrollWheelEvent, cx: &mut Context<Self>) {
        let delta = event.delta.pixel_delta(row_height());
        let (mut dx, mut dy) = (f32::from(delta.x), f32::from(delta.y));
        // A mouse wheel with Shift scrolls sideways.
        if event.modifiers.shift && dx == 0.0 {
            (dx, dy) = (dy, 0.0);
        }
        // GPUI's deltas move the content: negative y scrolls down.
        self.scroll_by(f64::from(-dy) / f64::from(f32::from(row_height())), -dx, cx);
    }

    fn page_rows(&self) -> f64 {
        (self.scroll.viewport_rows() - 1.0).max(1.0)
    }

    pub(crate) fn line_up(&mut self, _: &LineUp, _: &mut Window, cx: &mut Context<Self>) {
        self.scroll_by(-1.0, 0.0, cx);
    }

    pub(crate) fn line_down(&mut self, _: &LineDown, _: &mut Window, cx: &mut Context<Self>) {
        self.scroll_by(1.0, 0.0, cx);
    }

    pub(crate) fn page_up(&mut self, _: &PageUp, _: &mut Window, cx: &mut Context<Self>) {
        self.scroll_by(-self.page_rows(), 0.0, cx);
    }

    pub(crate) fn page_down(&mut self, _: &PageDown, _: &mut Window, cx: &mut Context<Self>) {
        self.scroll_by(self.page_rows(), 0.0, cx);
    }

    pub(crate) fn scroll_to_top(
        &mut self,
        _: &ScrollToTop,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.scroll_to_fraction(0.0, cx);
    }

    pub(crate) fn scroll_to_end(
        &mut self,
        _: &ScrollToEnd,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.scroll_to_fraction(1.0, cx);
    }

    /// The vertical thumb, in pixels from the body's top.
    fn vertical_thumb(&self) -> scroll::Thumb {
        scroll::thumb(
            f32::from(self.viewport().height),
            self.scroll.viewport_rows(),
            self.scroll.rows() as f64,
            self.scroll.fraction(),
            MIN_THUMB,
        )
    }

    /// The horizontal thumb, in pixels from the cells' left edge.
    fn horizontal_thumb(&self) -> scroll::Thumb {
        let max = self.max_scroll_x();
        scroll::thumb(
            self.cells_width(),
            f64::from(self.cells_width()),
            f64::from(self.content_width()),
            if max > 0.0 {
                f64::from(self.scroll_x / max)
            } else {
                0.0
            },
            MIN_THUMB,
        )
    }

    /// A press on a scrollbar track: on the thumb, grabs it where pressed;
    /// elsewhere, centers the thumb there first (a jump), then grabs it.
    fn press_track(&mut self, vertical: bool, position: Point<Pixels>, cx: &mut Context<Self>) {
        let (thumb, along) = if vertical {
            (
                self.vertical_thumb(),
                f32::from(position.y - self.body.origin.y),
            )
        } else {
            (
                self.horizontal_thumb(),
                f32::from(position.x - self.body.origin.x) - self.gutter_width(),
            )
        };
        let grab = if (thumb.offset..thumb.offset + thumb.length).contains(&along) {
            along - thumb.offset
        } else {
            thumb.length / 2.0
        };
        self.drag = Some(if vertical {
            Drag::Vertical { grab }
        } else {
            Drag::Horizontal { grab }
        });
        self.drag_to(position, cx);
    }

    fn drag_to(&mut self, position: Point<Pixels>, cx: &mut Context<Self>) {
        match self.drag {
            Some(Drag::Vertical { grab }) => {
                let thumb = self.vertical_thumb();
                let offset = f32::from(position.y - self.body.origin.y) - grab;
                let track = f32::from(self.viewport().height);
                self.scroll_to_fraction(scroll::fraction_at(track, thumb.length, offset), cx);
            }
            Some(Drag::Horizontal { grab }) => {
                let thumb = self.horizontal_thumb();
                let offset =
                    f32::from(position.x - self.body.origin.x) - self.gutter_width() - grab;
                let fraction = scroll::fraction_at(self.cells_width(), thumb.length, offset);
                let scroll_x = fraction as f32 * self.max_scroll_x();
                self.scroll_by(0.0, scroll_x - self.scroll_x, cx);
            }
            None => {}
        }
    }

    /// The cell at `position` (window coordinates), if it's on one.
    fn cell_at(&self, position: Point<Pixels>) -> Option<(u64, usize)> {
        let x = f32::from(position.x - self.body.origin.x) - self.gutter_width();
        let y = f32::from(position.y - self.body.origin.y);
        if !(0.0..self.cells_width()).contains(&x)
            || !(0.0..f32::from(self.viewport().height)).contains(&y)
        {
            return None;
        }
        let row = (self.scroll.top() + f64::from(y / f32::from(row_height()))).floor() as u64;
        let x = x + self.scroll_x;
        let column = self
            .columns
            .iter()
            .position(|column| (column.x..column.x + column.width).contains(&x))?;
        (row < self.scroll.rows()).then_some((row, column))
    }

    /// The pointer moved over the cells. A new cell starts the tooltip's
    /// delay or, while a tooltip shows (or just went), is looked at at once.
    /// Nothing redraws until the pointer has rested.
    fn hover_at(&mut self, position: Point<Pixels>, cx: &mut Context<Self>) {
        // No tooltip during a column drag.
        #[cfg(feature = "resize")]
        if self.resizing.is_some() {
            return;
        }
        // Nor while a drag selects.
        #[cfg(feature = "select")]
        if self.is_selecting() {
            return;
        }
        let cell = self.cell_at(position);
        if cell == self.hover.as_ref().map(|hover| (hover.row, hover.column)) {
            return;
        }
        let showing = self
            .hover
            .as_ref()
            .is_some_and(|hover| hover.tooltip.is_some());
        let warm = showing || self.tooltip_grace.is_some();
        self.hide_tooltip(cx);
        let Some((row, column)) = cell else {
            return;
        };
        let mut hover = Hover {
            row,
            column,
            rested: warm,
            decided: false,
            tooltip: None,
            _rest: None,
        };
        if warm {
            cx.notify();
        } else {
            hover._rest = Some(cx.spawn(async move |this, cx| {
                cx.background_executor().timer(TOOLTIP_DELAY).await;
                let _ = this.update(cx, |this, cx| {
                    if let Some(hover) = this
                        .hover
                        .as_mut()
                        .filter(|hover| (hover.row, hover.column) == (row, column))
                    {
                        hover.rested = true;
                        cx.notify();
                    }
                });
            }));
        }
        self.hover = Some(hover);
    }

    /// The pointer left the cells or went to another: the tooltip goes, and
    /// the next one within [`TOOLTIP_GRACE`] shows at once.
    pub(crate) fn hide_tooltip(&mut self, cx: &mut Context<Self>) {
        if self
            .hover
            .take()
            .is_some_and(|hover| hover.tooltip.is_some())
        {
            self.tooltip_grace = Some(cx.spawn(async move |this, cx| {
                cx.background_executor().timer(TOOLTIP_GRACE).await;
                let _ = this.update(cx, |this, _| this.tooltip_grace = None);
            }));
            cx.notify();
        }
    }

    /// Decides the hovered cell's tooltip, once the pointer has rested and
    /// its page is loaded (a page landing redraws, so it's decided then).
    fn decide_tooltip(&mut self, window: &mut Window, cx: &mut App) {
        let Some(hover) = self.hover.as_ref() else {
            return;
        };
        if !hover.rested
            || hover.decided
            || !matches!(self.cache.row(hover.row), RowState::Loaded(..))
        {
            return;
        }
        let tooltip = self.tooltip_for(hover.row, hover.column, window, cx);
        if let Some(hover) = self.hover.as_mut() {
            hover.decided = true;
            hover.tooltip = tooltip;
        }
    }

    /// The exact value of a cell that's rounded, shown on one line, or cut,
    /// as a tooltip. A cut is found by shaping this one cell's text, as GPUI
    /// does to decide it.
    fn tooltip_for(
        &self,
        row: u64,
        column: usize,
        window: &mut Window,
        cx: &mut App,
    ) -> Option<(SharedString, AnyView)> {
        let RowState::Loaded(page, index) = self.cache.row(row) else {
            return None;
        };
        let laid_out = self.columns.get(column)?;
        let value = page.value(index, column)?;
        if value == CellValue::Null {
            return None;
        }
        let exact = value.to_string();
        let shown = cell_text(laid_out, value);
        // `shown` has no line breaks (`cell_text`).
        let cut = shown == exact
            && self.text_width(shown.clone().into(), window) > laid_out.width - CELL_PADDING;
        if shown == exact && !cut {
            return None;
        }
        let text: SharedString = match exact.char_indices().nth(TOOLTIP_CHARS) {
            Some((end, _)) => format!("{}…", &exact[..end]).into(),
            None => exact.into(),
        };
        // Wrapped in a width-capped block: gpui-kit's tooltip lays its text
        // out in a flex row, so a `max_w` on the tooltip itself didn't wrap
        // it, and a long value drew as one more row across the table.
        let content = text.clone();
        let view = Tooltip::element(move |_, _| {
            div()
                .max_w(px(TOOLTIP_MAX_WIDTH))
                .whitespace_normal()
                .py_0p5()
                .child(content.clone())
        })
        // Above gpui-kit's `shadow_md`: over dense rows, especially in the
        // dark theme, the popover surface alone blended into the cells.
        .shadow_lg()
        .build(window, cx);
        Some((text, view))
    }

    /// `text`'s width in the cells' font, shaped as GPUI draws it. One
    /// line: `shape_line` asserts there's no `\n`.
    fn text_width(&self, text: SharedString, window: &Window) -> f32 {
        let run = TextRun {
            len: text.len(),
            font: self.glyphs.font.clone(),
            color: black(),
            background_color: None,
            underline: None,
            strikethrough: None,
        };
        let width = window
            .text_system()
            .shape_line(text, self.glyphs.font_size, &[run], None)
            .width;
        f32::from(width)
    }

    /// The hovered cell's tooltip, beside the cell, above everything.
    fn render_tooltip(&self) -> Option<Deferred> {
        let hover = self.hover.as_ref()?;
        let (_, view) = hover.tooltip.as_ref()?;
        let column = self.columns.get(hover.column)?;
        if !self.scroll.visible().contains(&hover.row) {
            return None;
        }
        let row_h = row_height();
        let origin = point(
            self.body.origin.x + px(self.gutter_width() + column.x - self.scroll_x),
            self.body.origin.y
                + px((self.scroll.offset_of(hover.row) * f64::from(f32::from(row_h))) as f32),
        );
        let cell = Bounds::new(origin, size(px(column.width), row_h));
        Some(
            deferred(TooltipPositioner::new(cell).child(view.clone()))
                .with_priority(TOOLTIP_PRIORITY),
        )
    }

    /// Visible columns: those overlapping the cells area at `scroll_x`.
    fn visible_columns(&self) -> impl Iterator<Item = (usize, &LaidOutColumn)> {
        let (left, right) = (self.scroll_x, self.scroll_x + self.cells_width());
        self.columns
            .iter()
            .enumerate()
            .filter(move |(_, column)| column.x + column.width > left && column.x < right)
    }

    /// Emits [`TallTableEvent::Filled`] for the frames where the viewport becomes
    /// fully loaded.
    fn track_filled(&mut self, filled: bool, cx: &mut Context<Self>) {
        let became_filled = filled && !self.filled;
        self.filled = filled;
        if became_filled {
            let first = std::mem::take(&mut self.first_fill_pending);
            cx.emit(TallTableEvent::Filled { first });
        }
    }

    fn render_header(&mut self, cx: &App) -> Div {
        let theme = cx.theme();
        let gutter = self.gutter_width();
        #[cfg(feature = "select")]
        let (_, selected) = self.selected_lines();
        #[cfg(all(test, feature = "select"))]
        {
            self.selection_state.drawn.header = self
                .visible_columns()
                .map(|(index, _)| index)
                .filter(|index| {
                    selected
                        .as_ref()
                        .is_some_and(|columns| columns.contains(index))
                })
                .collect();
        }
        #[cfg_attr(not(feature = "select"), expect(unused_variables))]
        let cells = self.visible_columns().map(|(index, column)| {
            let cell = div();
            // A selected column's header, in the selection's tint.
            #[cfg(feature = "select")]
            let cell = cell.when(
                selected
                    .as_ref()
                    .is_some_and(|columns| columns.contains(&index)),
                |cell| cell.bg(theme.table_active),
            );
            cell.absolute()
                .top_0()
                .h_full()
                .left(px(column.x - self.scroll_x))
                .w(px(column.width))
                .px_2()
                .line_height(row_height())
                .when(column.kind.numeric(), |cell| cell.text_right())
                .truncate()
                .child(column.name.clone())
        });
        div()
            .relative()
            .flex_shrink_0()
            .h(row_height())
            .bg(theme.tokens.table_head)
            .text_color(theme.table_head_foreground)
            .border_b_1()
            .border_color(theme.border)
            .child(
                div()
                    .absolute()
                    .top_0()
                    .bottom_0()
                    .left(px(gutter))
                    .right(Scrollbar::width())
                    .overflow_hidden()
                    .children(cells),
            )
    }

    fn render_body(&mut self, cx: &mut Context<Self>) -> Div {
        let row_h = row_height();
        let gutter = self.gutter_width();
        let visible = self.scroll.visible();
        let columns: Vec<(usize, LaidOutColumn)> = self
            .visible_columns()
            .map(|(index, column)| (index, column.clone()))
            .collect();

        let (mut loaded, mut pending, mut failed) = (0u64, 0u64, 0u64);
        let mut row_backgrounds = Vec::new();
        let mut gutter_cells = Vec::new();
        let mut cells = Vec::new();
        let mut last_cell = None;
        let probe_frames = self.probe_frames;
        let mut cell_probes = self.probe_cells.then(Vec::new);
        // The jump's mark, unless the jump selected (`select`).
        #[cfg(feature = "select")]
        let marked = self.drawn_mark();
        #[cfg(not(feature = "select"))]
        let marked = self.marked;
        // The selected rows, whose gutter cells are tinted (`select`).
        #[cfg(feature = "select")]
        let (selected_rows, _) = self.selected_lines();
        #[cfg(all(test, feature = "select"))]
        self.selection_state.drawn.gutter.clear();
        // The fills and bars, in the cells layer's coordinates, painted
        // under the cells' text in this order (`docs/DECISIONS.md`, "Features").
        #[cfg(feature = "custom-cells")]
        let mut quads: Vec<PaintQuad> = Vec::new();
        // The flashes' clock, read once a frame while any is live, and
        // whether this frame draws one.
        #[cfg(all(feature = "live", feature = "custom-cells"))]
        let flash_now = (!self.flashes.is_empty()).then(|| {
            let now = self.flashes.now(cx);
            self.flashes.expire(now);
            now
        });
        #[cfg(all(feature = "live", feature = "custom-cells"))]
        let reduce_motion = cx.reduce_motion();
        #[cfg(all(feature = "live", feature = "custom-cells"))]
        let mut flash_drawn = false;
        {
            let theme = cx.theme();
            #[cfg(feature = "custom-cells")]
            let paints: Vec<paint::ColumnPaint> = columns
                .iter()
                .map(|(index, _)| paint::ColumnPaint::resolve(&self.column_info[*index], theme))
                .collect();
            #[cfg(feature = "custom-cells")]
            let frame_paint = {
                #[cfg_attr(not(test), expect(unused_mut))]
                let mut frame = paint::FramePaint::resolve(theme);
                #[cfg(test)]
                {
                    frame.control = self.paint_control;
                }
                frame
            };
            for row in visible.clone() {
                let top = px((self.scroll.offset_of(row) * f64::from(f32::from(row_h))) as f32);
                row_backgrounds.push(
                    div()
                        .absolute()
                        .left_0()
                        .right_0()
                        .top(top)
                        .h(row_h)
                        .border_b_1()
                        .border_color(theme.table_row_border)
                        .when(row % 2 == 1, |row| row.bg(theme.table_even))
                        .when(marked == Some(row), |row| row.bg(theme.table_active)),
                );
                let gutter_cell = div();
                // A selected row's number, in the selection's tint.
                #[cfg(feature = "select")]
                let gutter_cell = {
                    let selected = selected_rows
                        .as_ref()
                        .is_some_and(|rows| rows.contains(&row));
                    #[cfg(test)]
                    if selected {
                        self.selection_state.drawn.gutter.push(row);
                    }
                    gutter_cell.when(selected, |cell| cell.bg(theme.table_active))
                };
                gutter_cells.push(
                    gutter_cell
                        .absolute()
                        .left_0()
                        .w(px(gutter))
                        .top(top)
                        .h(row_h)
                        .px_2()
                        .flex()
                        .items_center()
                        .justify_end()
                        .text_color(theme.muted_foreground)
                        .child(format_count(row + 1)),
                );
                // What the row draws around its cells' fills, for their
                // text's contrast.
                #[cfg(feature = "custom-cells")]
                let row_paint = frame_paint.row(row, marked == Some(row));
                match self.cache.row(row) {
                    RowState::Loaded(page, index) => {
                        loaded += 1;
                        if probe_frames && row + 1 == visible.end {
                            last_cell = page.value(index, 0).map(|value| value.to_string());
                        }
                        #[cfg_attr(not(feature = "custom-cells"), expect(unused_variables))]
                        for (position, (column_index, column)) in columns.iter().enumerate() {
                            let value = page.value(index, *column_index).unwrap_or(CellValue::Null);
                            let exact = cell_probes.is_some().then(|| value.to_string());
                            #[cfg_attr(not(feature = "custom-cells"), expect(unused_mut))]
                            let mut color = if matches!(value, CellValue::Null) {
                                theme.muted_foreground
                            } else {
                                theme.foreground
                            };
                            #[cfg(feature = "custom-cells")]
                            let drawn = {
                                // A column with no ramp or bar draws no
                                // paint: its page isn't asked, except in a
                                // debug build, which asserts it answers none.
                                let mut drawn =
                                    if paints[position].is_empty() && !cfg!(debug_assertions) {
                                        paint::DrawnPaint::default()
                                    } else {
                                        paint::draw(
                                            page.paint(index, *column_index),
                                            &paints[position],
                                            &frame_paint,
                                            row_paint,
                                            column.x - self.scroll_x,
                                            f32::from(top),
                                            column.width,
                                            f32::from(row_h),
                                        )
                                    };
                                if let Some((bounds, color)) = drawn.fill {
                                    quads.push(fill(bounds, color));
                                }
                                // A change's flash, over the fill.
                                #[cfg(feature = "live")]
                                if let (Some(now), Some(ramp)) =
                                    (flash_now, paints[position].flash.as_ref())
                                    && let Some((at, opacity)) =
                                        self.flashes.at(row, *column_index, now, reduce_motion)
                                    && let Some(color) = paint::flash_color(ramp, at, opacity)
                                {
                                    drawn.flash = Some(color);
                                    flash_drawn = true;
                                    quads.push(fill(
                                        paint::cell_box(
                                            column.x - self.scroll_x,
                                            f32::from(top),
                                            column.width,
                                            f32::from(row_h),
                                        ),
                                        color,
                                    ));
                                }
                                #[cfg(feature = "live")]
                                let covered = drawn.fill.map(|(bounds, _)| bounds).or(drawn
                                    .flash
                                    .map(|_| {
                                        paint::cell_box(
                                            column.x - self.scroll_x,
                                            f32::from(top),
                                            column.width,
                                            f32::from(row_h),
                                        )
                                    }));
                                #[cfg(not(feature = "live"))]
                                let covered = drawn.fill.map(|(bounds, _)| bounds);
                                if let Some(bounds) = covered {
                                    // The jump's highlight, which the row
                                    // draws under the cells, over a fill or
                                    // a flash, edged: its tint alone
                                    // vanished on a blue ramp.
                                    if marked == Some(row) {
                                        quads.push(
                                            fill(bounds, theme.table_active)
                                                .border_widths(Edges {
                                                    top: px(1.),
                                                    bottom: px(1.),
                                                    ..Edges::default()
                                                })
                                                .border_color(theme.table_active_border),
                                        );
                                    }
                                }
                                if let Some((bounds, color)) = drawn.bar {
                                    quads.push(fill(bounds, color));
                                }
                                // A NULL keeps its muted color over a fill;
                                // a text ramp's color still sets it.
                                if matches!(value, CellValue::Null) {
                                    drawn.contrast = None;
                                }
                                if let Some(text) = drawn.text.or(drawn.contrast) {
                                    color = text.into();
                                }
                                drawn
                            };
                            let text = shown_text(column, value);
                            if let (Some(probes), Some(exact)) = (cell_probes.as_mut(), exact) {
                                probes.push(CellProbe {
                                    row,
                                    column: *column_index,
                                    exact,
                                    shown: text.clone(),
                                    #[cfg(feature = "custom-cells")]
                                    paint: drawn.probe(column.x - self.scroll_x),
                                });
                            }
                            cells.push(
                                self.value_cell(column, top, row_h)
                                    .text_color(color)
                                    .child(text),
                            );
                        }
                    }
                    RowState::Pending => {
                        pending += 1;
                        for (_, column) in &columns {
                            cells.push(
                                self.cell(column, top, row_h)
                                    .flex()
                                    .items_center()
                                    .when(column.kind.numeric(), |cell| cell.justify_end())
                                    .child(
                                        div()
                                            .h(px(8.))
                                            .w(relative(0.6))
                                            .rounded_sm()
                                            .bg(theme.skeleton),
                                    ),
                            );
                        }
                    }
                    RowState::Failed(message) => {
                        failed += 1;
                        cells.push(
                            div()
                                .absolute()
                                .top(top)
                                .h(row_h)
                                .left_0()
                                .right_0()
                                .px_2()
                                .flex()
                                .items_center()
                                .truncate()
                                .text_color(theme.danger)
                                .child(format!("Couldn't load these rows: {message}")),
                        );
                    }
                }
            }
        }

        // No rows to show, and complete as soon as it's open.
        let filled = if self.scroll.rows() == 0 {
            true
        } else {
            !visible.is_empty() && loaded == visible.end - visible.start
        };
        self.track_filled(filled, cx);
        #[cfg(feature = "follow")]
        if filled {
            self.note_tail_drawn(visible.end, cx);
        }
        #[cfg(all(feature = "live", feature = "custom-cells"))]
        self.after_flashes(flash_now, flash_drawn, reduce_motion, cx);
        #[cfg(feature = "live")]
        for (rows, generation) in self.cache.take_refreshed(visible.clone()) {
            cx.emit(TallTableEvent::Refreshed { rows, generation });
        }
        match self.activity_options {
            Some(options) if (options.is_recording)(cx) => {
                self.activity
                    .record((options.clock)(), self.scroll.top(), filled);
            }
            _ => self.activity.clear(),
        }
        if probe_frames {
            let probe = TallTableProbe {
                rows: self.scroll.rows(),
                top: self.scroll.top(),
                first: visible.start,
                end: visible.end,
                loaded,
                pending,
                failed,
                last_cell,
                marked: self.marked,
                scroll_x: self.scroll_x,
                #[cfg(feature = "select")]
                selection: self.selection_state.current,
                tooltip: self
                    .hover
                    .as_ref()
                    .and_then(|hover| hover.tooltip.as_ref())
                    .map(|(text, _)| text.to_string()),
            };
            if self.published_probe.as_ref() != Some(&probe) {
                self.published_probe = Some(probe.clone());
                cx.emit(TallTableEvent::Probe(probe));
            }
            let key = (self.body, self.layout_generation, gutter);
            if self.published_layout != Some(key) {
                self.published_layout = Some(key);
                cx.emit(TallTableEvent::Layout(TallTableLayout {
                    left: f32::from(self.body.origin.x) + gutter,
                    top: f32::from(self.body.origin.y),
                    row_height: f32::from(row_h),
                    cells_width: self.cells_width(),
                    columns: self
                        .columns
                        .iter()
                        .map(|column| ColumnProbe {
                            name: column.name.to_string(),
                            x: column.x,
                            width: column.width,
                            kind: column.kind.as_str(),
                            budget: column.budget,
                        })
                        .collect(),
                }));
            }
        }
        if let Some(probes) = cell_probes {
            cx.emit(TallTableEvent::Cells(probes));
        }

        let entity = cx.entity();
        let bar = Scrollbar::width();
        let vertical = self.vertical_thumb();
        let horizontal = self.horizontal_thumb();
        let wide = self.max_scroll_x() > 0.0;
        let theme = cx.theme();
        let cells_layer = div()
            .id("tall-table-cells")
            .absolute()
            .top_0()
            .bottom(bar)
            .left(px(gutter))
            .right(bar)
            .overflow_hidden()
            .on_mouse_move(cx.listener(|this, event: &MouseMoveEvent, _, cx| {
                this.hover_at(event.position, cx);
            }))
            .on_hover(cx.listener(|this, hovered: &bool, _, cx| {
                if !*hovered {
                    this.hide_tooltip(cx);
                }
            }));
        // One element for every fill and bar, the layer's first child: under
        // the text, clipped with the cells.
        #[cfg(feature = "custom-cells")]
        let cells_layer = cells_layer.when(!quads.is_empty(), |layer| {
            layer.child(
                canvas(
                    |_, _, _| {},
                    move |bounds, _, window, _| {
                        for mut quad in quads {
                            quad.bounds.origin += bounds.origin;
                            window.paint_quad(quad);
                        }
                    },
                )
                .absolute()
                .size_full(),
            )
        });
        // The selection's tint and the active cell's edge: over the fills
        // and bars, under the text.
        #[cfg(feature = "select")]
        let cells_layer = cells_layer.children(self.render_selection(cx));

        div()
            .relative()
            .flex_1()
            .min_h_0()
            .overflow_hidden()
            .on_scroll_wheel(cx.listener(|this, event, _, cx| this.on_scroll_wheel(event, cx)))
            .child(
                // Measures the body, and follows a scrollbar drag anywhere in
                // the window until the button comes up.
                canvas(
                    |_, _, _| {},
                    move |bounds, _, window, cx| {
                        entity.update(cx, |this, cx| {
                            if bounds != this.body {
                                let entity = cx.entity();
                                cx.defer(move |cx| {
                                    entity.update(cx, |this, cx| this.set_body(bounds, cx));
                                });
                            }
                            this.report_scrollbar(bounds, cx);
                        });
                        // The resize cursor wherever a column drag goes.
                        #[cfg(feature = "resize")]
                        if entity.read(cx).resizing.is_some() {
                            window.set_window_cursor_style(CursorStyle::ResizeColumn);
                        }
                        // Registered every frame, not only once a drag has
                        // started: a quick click on the track delivers the
                        // press and the release before the next paint, and a
                        // release missed that way left the drag on, so the
                        // next pointer move scrolled the table (WebKit).
                        let moving = entity.clone();
                        window.on_mouse_event(move |event: &MouseMoveEvent, phase, _, cx| {
                            if phase == DispatchPhase::Capture {
                                moving.update(cx, |this, cx| {
                                    #[cfg(feature = "select")]
                                    if this.is_selecting() {
                                        if event.pressed_button == Some(MouseButton::Left) {
                                            this.select_drag_to(event.position, cx);
                                        } else {
                                            this.end_select();
                                        }
                                        return;
                                    }
                                    #[cfg(feature = "resize")]
                                    if this.resizing.is_some() {
                                        if event.pressed_button == Some(MouseButton::Left) {
                                            this.resize_to(event.position.x, cx);
                                        } else {
                                            this.end_resize(cx);
                                        }
                                        return;
                                    }
                                    if this.drag.is_none() {
                                        return;
                                    }
                                    // The release never came (a cancelled
                                    // pointer, say): the button isn't down.
                                    if event.pressed_button == Some(MouseButton::Left) {
                                        this.drag_to(event.position, cx);
                                    } else {
                                        this.end_drag(cx);
                                    }
                                });
                            }
                        });
                        let releasing = entity.clone();
                        window.on_mouse_event(move |_: &MouseUpEvent, phase, _, cx| {
                            if phase == DispatchPhase::Capture {
                                releasing.update(cx, |this, cx| {
                                    #[cfg(feature = "select")]
                                    this.end_select();
                                    #[cfg(feature = "resize")]
                                    this.end_resize(cx);
                                    if this.drag.is_some() {
                                        this.end_drag(cx);
                                    }
                                });
                            }
                        });
                        // A wheel anywhere in the window during a drag
                        // selecting scrolls the body (the table's wheel is
                        // the body's): a header drag reaches columns off
                        // screen, and the head follows the pointer.
                        #[cfg(feature = "select")]
                        {
                            let wheeling = entity.clone();
                            window.on_mouse_event(move |event: &ScrollWheelEvent, phase, _, cx| {
                                if phase == DispatchPhase::Capture
                                    && wheeling.read(cx).is_selecting()
                                {
                                    cx.stop_propagation();
                                    wheeling.update(cx, |this, cx| this.select_wheel(event, cx));
                                }
                            });
                        }
                    },
                )
                .absolute()
                .size_full(),
            )
            .children(row_backgrounds)
            .child(cells_layer.children(cells))
            .child(
                div()
                    .absolute()
                    .top_0()
                    .bottom(bar)
                    .left_0()
                    .w(px(gutter))
                    .overflow_hidden()
                    .border_r_1()
                    .border_color(theme.table_row_border)
                    .children(gutter_cells),
            )
            .child(
                div()
                    .id("tall-table-vscroll")
                    .absolute()
                    .top_0()
                    .bottom(bar)
                    .right_0()
                    .w(bar)
                    .bg(theme.scrollbar)
                    .on_mouse_down(
                        MouseButton::Left,
                        cx.listener(|this, event: &MouseDownEvent, window, cx| {
                            cx.stop_propagation();
                            // The table's own focus-on-press never sees this one.
                            window.focus(&this.focus_handle, cx);
                            this.press_track(true, event.position, cx);
                        }),
                    )
                    .child(
                        div()
                            .absolute()
                            .left(px(3.))
                            .right(px(3.))
                            .top(px(vertical.offset))
                            .h(px(vertical.length))
                            .rounded_full()
                            .bg(if matches!(self.drag, Some(Drag::Vertical { .. })) {
                                theme.scrollbar_thumb_hover
                            } else {
                                theme.scrollbar_thumb
                            }),
                    ),
            )
            .when(wide, |body| {
                body.child(
                    div()
                        .id("tall-table-hscroll")
                        .absolute()
                        .bottom_0()
                        .left(px(gutter))
                        .right(bar)
                        .h(bar)
                        .bg(theme.scrollbar)
                        .on_mouse_down(
                            MouseButton::Left,
                            cx.listener(|this, event: &MouseDownEvent, window, cx| {
                                cx.stop_propagation();
                                window.focus(&this.focus_handle, cx);
                                this.press_track(false, event.position, cx);
                            }),
                        )
                        .child(
                            div()
                                .absolute()
                                .top(px(3.))
                                .bottom(px(3.))
                                .left(px(horizontal.offset))
                                .w(px(horizontal.length))
                                .rounded_full()
                                .bg(if matches!(self.drag, Some(Drag::Horizontal { .. })) {
                                    theme.scrollbar_thumb_hover
                                } else {
                                    theme.scrollbar_thumb
                                }),
                        ),
                )
            })
    }

    /// After a frame's flashes: a fading one on screen asks for the next
    /// frame (in render, which has the window); under reduced motion none
    /// is asked for, and a timer redraws when the next held flash ends.
    #[cfg(all(feature = "live", feature = "custom-cells"))]
    fn after_flashes(
        &mut self,
        now: Option<std::time::Duration>,
        drawn: bool,
        reduce_motion: bool,
        cx: &mut Context<Self>,
    ) {
        self.flashes.animating = drawn && !reduce_motion;
        let end = now
            .filter(|_| reduce_motion)
            .and_then(|now| Some((now, self.flashes.next_end()?)));
        let Some((now, end)) = end else {
            self.flashes.timer = None;
            return;
        };
        if self
            .flashes
            .timer
            .as_ref()
            .is_some_and(|(at, _)| *at == end)
        {
            return;
        }
        let wait = end.saturating_sub(now);
        let task = cx.spawn(async move |this, cx| {
            cx.background_executor().timer(wait).await;
            let _ = this.update(cx, |_, cx| cx.notify());
        });
        self.flashes.timer = Some((end, task));
    }

    fn cell(&self, column: &LaidOutColumn, top: Pixels, height: Pixels) -> Div {
        div()
            .absolute()
            .top(top)
            .h(height)
            .left(px(column.x - self.scroll_x))
            .w(px(column.width))
            .px_2()
    }

    /// A cell holding a value. A plain block, not a flex container: GPUI
    /// cuts text only when its width is definite, and a flex item's isn't,
    /// so a right-aligned value spilled out the cell's left side and lost its
    /// front with no sign. The line height centers it.
    fn value_cell(&self, column: &LaidOutColumn, top: Pixels, height: Pixels) -> Div {
        let cell = self.cell(column, top, height).line_height(height);
        match column.kind {
            CellKind::Text => cell.truncate(),
            CellKind::Float => cell.text_right().truncate(),
            CellKind::Integer | CellKind::Decimal => cell
                .text_right()
                .overflow_hidden()
                .whitespace_nowrap()
                .text_ellipsis_middle(),
        }
    }

    /// Reports the vertical scrollbar's track and thumb when they move
    /// ([`TallTableEvent::Scrollbar`]).
    fn report_scrollbar(&mut self, body: Bounds<Pixels>, cx: &mut Context<Self>) {
        let bar = Scrollbar::width();
        let track = Bounds::new(
            point(body.origin.x + body.size.width - bar, body.origin.y),
            size(bar, (body.size.height - bar).max(px(0.))),
        );
        let thumb = self.vertical_thumb();
        let thumb = Bounds::new(
            point(track.origin.x, track.origin.y + px(thumb.offset)),
            size(bar, px(thumb.length)),
        );
        if self.published_scrollbar != Some((track, thumb)) {
            self.published_scrollbar = Some((track, thumb));
            cx.emit(TallTableEvent::Scrollbar { track, thumb });
        }
    }
}

/// `1567523` → `1,567,523`: the row numbers' format.
pub(crate) fn format_count(value: u64) -> String {
    let digits = value.to_string();
    let mut out = String::with_capacity(digits.len() + digits.len() / 3);
    for (index, digit) in digits.chars().enumerate() {
        if index > 0 && (digits.len() - index).is_multiple_of(3) {
            out.push(',');
        }
        out.push(digit);
    }
    out
}

impl<D: TallTableDelegate> EventEmitter<TallTableEvent> for TallTableState<D> {}

impl<D: TallTableDelegate> Focusable for TallTableState<D> {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus_handle.clone()
    }
}

impl<D: TallTableDelegate> Render for TallTableState<D> {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        // Before anything is drawn, so the first frame is laid out by the
        // font itself. Read only when the font or the rem size changes.
        let font_size = rems(TEXT_REMS).to_pixels(window.rem_size());
        if self.glyphs.font_size != font_size || self.glyphs.font.family != cx.theme().font_family {
            let glyphs = Glyphs::read(window, cx);
            if glyphs != self.glyphs {
                self.glyphs = glyphs;
                self.lay_out();
            }
        }
        self.decide_tooltip(window, cx);
        #[cfg(feature = "select")]
        {
            self.selection_state.focused = self.focus_handle.is_focused(window);
        }
        let header = self.render_header(cx);
        #[cfg(feature = "resize")]
        let header = header.child(self.render_bands(cx));
        let body = self.render_body(cx);
        #[cfg(all(feature = "live", feature = "custom-cells"))]
        if self.flashes.animating {
            window.request_animation_frame();
        }
        let tooltip = self.render_tooltip();
        let root = div();
        // A press on a cell, the gutter, a header, or the corner selects
        // (the bands and scrollbars stop theirs first).
        #[cfg(feature = "select")]
        let root = root.on_mouse_down(
            MouseButton::Left,
            cx.listener(|this, event: &MouseDownEvent, _, cx| this.press_select(event, cx)),
        );
        root.size_full()
            .flex()
            .flex_col()
            .child(header)
            .child(body)
            .children(tooltip)
    }
}

/// The fixtures (`fixtures/`) run against the table itself: a child module,
/// so it drives the state's own scroll, drag, and paging paths.
#[cfg(test)]
mod fixtures;

/// `follow`: the flag, the pin, and the tail drawn.
#[cfg(feature = "follow")]
mod follow;

/// `resize`: the bands, the column drag, and the fit.
#[cfg(feature = "resize")]
mod resize;

/// `select`: the presses, the drag, the keys, and the drawing.
#[cfg(feature = "select")]
pub(crate) mod select;

#[cfg(test)]
mod tests {
    // Not `super::*`: it brings gpui-kit's `test` attribute, which shadows `#[test]`.
    use super::{CellKind, CellValue, LaidOutColumn, cell_text, format_count};

    #[test]
    fn counts() {
        assert_eq!(format_count(0), "0");
        assert_eq!(format_count(999), "999");
        assert_eq!(format_count(1_000), "1,000");
        assert_eq!(format_count(1_567_523), "1,567,523");
    }

    #[test]
    fn cells_are_one_line() {
        let column = LaidOutColumn {
            name: "note".into(),
            x: 0.0,
            width: 200.0,
            kind: CellKind::Text,
            budget: 21,
        };
        let text = |value: &str| cell_text(&column, CellValue::Text(value.into()));
        assert_eq!(text("a\r\nb\nc\rd"), "a¶b¶c¶d");
        assert_eq!(text("plain"), "plain");
    }
}
