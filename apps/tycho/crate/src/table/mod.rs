//! The row table: every row of a registered file, fetched a page at a time
//! and drawn only where the viewport is.
//!
//! Not gpui-kit's `DataTable`: its `uniform_list` positions rows in f32
//! pixels, which loses precision past ~16 M px (see [`scroll`]). This view
//! keeps the scroll position in rows, draws the visible rows and columns
//! itself, and owns its scrollbars. Rows whose page isn't loaded yet draw as
//! placeholders; a frame never waits on data.

mod activity;
mod pages;
mod scroll;

use gpui_kit::component::scroll::Scrollbar;
use gpui_kit::component::{ActiveTheme as _, Size as KitSize};
use gpui_kit::prelude::FluentBuilder as _;
use gpui_kit::*;

use crate::arrow::{QueryResult, Value};
use crate::dataset::{ColumnInfo, format_count};
pub use activity::{Activity, ActivityStats};
pub use pages::{Direction, PageCache, RowState};
pub use scroll::RowScroll;

actions!(
    tycho_table,
    [LineUp, LineDown, PageUp, PageDown, ScrollToTop, ScrollToEnd]
);

const CONTEXT: &str = "RowTable";

/// Binds the table's scrolling keys.
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
}

#[cfg(target_family = "wasm")]
type Request = crate::engine::RequestId;
#[cfg(not(target_family = "wasm"))]
type Request = u32;

/// How the table pages through a file.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Paging {
    pub page_rows: u64,
    /// Pages kept loaded on each side of the viewport (twice that ahead
    /// while scrolling).
    pub prefetch: u64,
    pub budget_bytes: usize,
    pub max_in_flight: usize,
}

/// 1024-row pages, 2 pages of prefetch. The M4 sweep (256/1024/4096 rows ×
/// 1/2/4 pages, perf/results/2026-09-25-m4-sweep.json) didn't separate them:
/// every config met every budget, with the same frame times, the same share
/// of placeholder frames in a fling (~84%: a 3 s fling outruns any
/// prefetch), none while scrolling steadily, and first rows and jumps within
/// noise. 1024 divides the 30,720-row groups, so a page never reads two
/// groups; smaller pages evict in finer steps; prefetch 2 leaves headroom for
/// faster scrolling than the sweep's steady 1,800 rows/s.
impl Default for Paging {
    fn default() -> Self {
        Self {
            page_rows: 1024,
            prefetch: 2,
            budget_bytes: 64 << 20,
            max_in_flight: 3,
        }
    }
}

impl Paging {
    /// The defaults, with `?page=`, `?prefetch=`, and `?budget_mib=` from the
    /// URL applied (the M4 sweep sets them).
    pub fn from_url() -> Self {
        let number = |key: &str| {
            seiza::url::param(key)
                .and_then(|value| value.parse::<u64>().ok())
                .filter(|value| *value > 0)
        };
        let mut paging = Self::default();
        if let Some(rows) = number("page") {
            paging.page_rows = rows;
        }
        if let Some(pages) = number("prefetch") {
            paging.prefetch = pages;
        }
        // Checked: `usize` is 32 bits on wasm32, and 4096 MiB would wrap to 0.
        if let Some(bytes) = number("budget_mib")
            .and_then(|mib| usize::try_from(mib).ok())
            .and_then(|mib| mib.checked_mul(1 << 20))
        {
            paging.budget_bytes = bytes;
        }
        paging
    }
}

/// Where the table's rows come from.
#[derive(Debug, Clone, PartialEq)]
pub enum RowSource {
    /// A registered Parquet file, by its SQL name; read where it lies.
    Parquet(String),
    /// A CSV file's chunk tables, growing while it loads.
    Csv(crate::csv::Chunks),
}

impl RowSource {
    #[cfg_attr(
        not(target_family = "wasm"),
        expect(dead_code, reason = "only the web build loads pages")
    )]
    fn page_sql(&self, rows: std::ops::Range<u64>) -> String {
        match self {
            Self::Parquet(file) => crate::dataset::page_sql(file, rows),
            Self::Csv(chunks) => chunks.page_sql(rows),
        }
    }
}

/// A column as drawn: its left edge in the scrolled content, and its width.
#[derive(Debug, Clone, PartialEq)]
struct TableColumn {
    name: SharedString,
    x: f32,
    width: f32,
    /// Numbers are right-aligned, so their digits line up.
    numeric: bool,
}

/// Width and alignment by DuckDB type. The name's width is estimated at the
/// UI font's average advance, since the header must fit it.
fn column_layout(column: &ColumnInfo) -> (f32, bool) {
    let data_type = column.data_type.as_str();
    let (width, numeric): (f32, bool) = match data_type {
        "BOOLEAN" => (72.0, false),
        "DATE" => (104.0, false),
        "TINYINT" | "SMALLINT" | "INTEGER" | "UTINYINT" | "USMALLINT" | "UINTEGER" => (96.0, true),
        "BIGINT" | "UBIGINT" | "HUGEINT" | "UHUGEINT" => (112.0, true),
        "FLOAT" | "DOUBLE" => (120.0, true),
        _ if data_type.starts_with("DECIMAL") => (120.0, true),
        _ if data_type.starts_with("TIMESTAMP") => (184.0, false),
        _ => (200.0, false),
    };
    let name = column.name.chars().count() as f32 * 7.5 + 24.0;
    (width.max(name), numeric)
}

fn layout_columns(columns: &[ColumnInfo]) -> (Vec<TableColumn>, f32) {
    let mut x = 0.0;
    let columns = columns
        .iter()
        .map(|column| {
            let (width, numeric) = column_layout(column);
            let laid_out = TableColumn {
                name: column.name.clone().into(),
                x,
                width,
                numeric,
            };
            x += width;
            laid_out
        })
        .collect();
    (columns, x)
}

const ROW_SIZE: KitSize = KitSize::Small;
const MIN_THUMB: f32 = 24.0;

fn row_height() -> Pixels {
    ROW_SIZE.table_row_height()
}

/// Which scrollbar is being dragged, and where on the thumb it was grabbed.
#[derive(Debug, Clone, Copy, PartialEq)]
enum Drag {
    Vertical { grab: f32 },
    Horizontal { grab: f32 },
}

/// What the table reports. The workbench decides what to show for it.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum TableEvent {
    /// The first frame with every visible row loaded was presented at
    /// `shown_ms` (ms from `timeOrigin`), or `None` if its mark couldn't be
    /// set (no time to report). Once per table.
    FirstRows { shown_ms: Option<f64> },
    /// A page read failed to read the file ([`EngineError::is_read_failure`]).
    /// A failed HTTP range read leaves
    /// DuckDB-Wasm's handle on the file broken, and every later read of
    /// those bytes fails too, network or not (M7): the owner registers the
    /// file again under a new name, then calls [`RowTable::read_from`].
    ReadFailed,
}

/// The table's paging and scrolling, for the perf panel.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct TableStats {
    pub loaded_pages: usize,
    pub in_flight: usize,
    /// Cancelled reads DuckDB is still running (see `PageCache::draining`).
    pub draining: usize,
    pub cache_bytes: usize,
    /// Over the last [`seiza::perf::WINDOW_MS`]: rows/s and filled frames.
    pub activity: ActivityStats,
}

/// What the Playwright checks read from `globalThis.__tychoTable`.
#[derive(Debug, Clone, PartialEq)]
pub struct TableProbe {
    pub rows: u64,
    pub top: f64,
    pub first: u64,
    pub end: u64,
    pub loaded: u64,
    pub pending: u64,
    pub failed: u64,
    /// The last visible row's first cell, if loaded.
    pub last_cell: Option<String>,
    /// The row the last jump landed on (0-based), highlighted.
    pub marked: Option<u64>,
}

#[cfg_attr(
    not(target_family = "wasm"),
    expect(dead_code, reason = "only the web build loads pages")
)]
pub struct RowTable {
    source: RowSource,
    /// As the header strip shows them; [`RowTable::widen`] changes a type.
    column_info: Vec<ColumnInfo>,
    columns: Vec<TableColumn>,
    content_width: f32,
    scroll: RowScroll,
    scroll_x: f32,
    direction: Direction,
    cache: PageCache<QueryResult, Request>,
    paging: Paging,
    /// The body (rows and scrollbars), measured each frame.
    body: Bounds<Pixels>,
    drag: Option<Drag>,
    /// While a scrollbar drag moves, page loads wait for the pointer to rest
    /// (see [`DRAG_SETTLE`]); this is that wait.
    #[cfg(target_family = "wasm")]
    drag_settle: Option<Task<()>>,
    /// Resets `direction` to still once the rows stop moving (see
    /// [`SCROLL_SETTLE`]).
    #[cfg(target_family = "wasm")]
    scroll_settle: Option<Task<()>>,
    focus_handle: FocusHandle,
    /// Whether the last frame had every visible row loaded.
    filled: bool,
    /// Until the first filled frame: it emits [`TableEvent::FirstRows`].
    first_rows_pending: bool,
    /// The frames drawn while the perf panel is open.
    activity: Activity,
    /// Set by [`RowTable::close`]: no more page loads.
    closed: bool,
    /// The row the last jump landed on, highlighted so it can be found when
    /// the end of the file keeps it from reaching the top.
    marked: Option<u64>,
    #[cfg(target_family = "wasm")]
    engine: crate::engine::Engine,
}

impl RowTable {
    /// A table over `rows` rows of `source`. Its first filled frame emits
    /// [`TableEvent::FirstRows`].
    pub fn new(
        source: RowSource,
        rows: u64,
        columns: &[ColumnInfo],
        #[cfg(target_family = "wasm")] engine: crate::engine::Engine,
        cx: &mut Context<Self>,
    ) -> Self {
        let paging = Paging::from_url();
        let (laid_out, content_width) = layout_columns(columns);
        #[cfg_attr(
            not(target_family = "wasm"),
            expect(unused_mut, reason = "only the web build loads pages")
        )]
        let mut table = Self {
            source,
            column_info: columns.to_vec(),
            columns: laid_out,
            content_width,
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
            #[cfg(target_family = "wasm")]
            drag_settle: None,
            #[cfg(target_family = "wasm")]
            scroll_settle: None,
            focus_handle: cx.focus_handle(),
            filled: false,
            first_rows_pending: true,
            activity: Activity::new(seiza::perf::WINDOW_MS),
            closed: false,
            marked: None,
            #[cfg(target_family = "wasm")]
            engine,
        };
        #[cfg(target_family = "wasm")]
        table.load_pages(cx);
        table
    }

    pub fn focus_handle(&self) -> &FocusHandle {
        &self.focus_handle
    }

    pub fn rows(&self) -> u64 {
        self.scroll.rows()
    }

    /// Scrolls `row` (0-based) to the top, or as near as the end of the file
    /// allows, and highlights it.
    pub fn jump_to(&mut self, row: u64, cx: &mut Context<Self>) {
        self.marked = Some(row);
        self.move_top_to(row as f64, cx);
        // The highlight moved even if the rows didn't.
        cx.notify();
    }

    /// A CSV chunk became `table`, holding `rows` more rows: the row count
    /// and the scrollbar grow, and pages that were short or missing load.
    pub fn grow(&mut self, table: String, rows: u64, cx: &mut Context<Self>) {
        let RowSource::Csv(chunks) = &mut self.source else {
            return;
        };
        chunks.push(table, rows);
        let total = chunks.rows();
        self.scroll.set_rows(total);
        #[cfg_attr(
            not(target_family = "wasm"),
            expect(unused_variables, reason = "only the web build loads pages")
        )]
        let stale = self.cache.set_rows(total);
        #[cfg(target_family = "wasm")]
        {
            if let Some(request) = stale {
                self.engine.cancel(request);
            }
            self.load_pages(cx);
        }
        cx.notify();
    }

    /// A later CSV chunk had a value `column`'s type couldn't hold, so the
    /// column is text from here on. Pages already loaded keep their values;
    /// new reads cast the earlier chunks' values to text too.
    pub fn widen(&mut self, column: &str, cx: &mut Context<Self>) {
        if let RowSource::Csv(chunks) = &mut self.source {
            chunks.widen(column);
        }
        for info in &mut self.column_info {
            if info.name == column {
                info.data_type = "VARCHAR".into();
            }
        }
        (self.columns, self.content_width) = layout_columns(&self.column_info);
        self.scroll_x = self.scroll_x.clamp(0.0, self.max_scroll_x());
        cx.notify();
    }

    /// Stops the table for good: cancels its page queries and sends no more.
    /// Called when another file replaces it. The entity can outlive this (the
    /// last frame still holds it), and a page answering meanwhile must not
    /// start new reads of a file nobody shows.
    pub fn close(&mut self) {
        self.closed = true;
        #[cfg(target_family = "wasm")]
        for request in self.cache.requests() {
            self.engine.cancel(request);
        }
    }

    /// Reads a Parquet table's rows from `name` from now on (the same file,
    /// registered again), and loads the pages whose reads failed again, if
    /// they're still wanted.
    pub fn read_from(&mut self, name: String, cx: &mut Context<Self>) {
        if let RowSource::Parquet(current) = &mut self.source {
            *current = name;
        }
        if self.cache.forget_failed() {
            #[cfg(target_family = "wasm")]
            self.load_pages(cx);
            cx.notify();
        }
    }

    /// Whether any page's read failed and hasn't been retried.
    pub fn has_failed_reads(&self) -> bool {
        self.cache.has_failed()
    }

    /// Paging and the last seconds' scrolling, as of `now` (ms from
    /// `timeOrigin`). Scrolling is recorded only while the panel is open.
    pub fn stats(&mut self, now: f64) -> TableStats {
        TableStats {
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

    fn max_scroll_x(&self) -> f32 {
        (self.content_width - self.cells_width()).max(0.0)
    }

    fn set_body(&mut self, body: Bounds<Pixels>, cx: &mut Context<Self>) {
        if body == self.body {
            return;
        }
        self.body = body;
        let rows = f64::from(f32::from(self.viewport().height) / f32::from(row_height()));
        let resized = self.scroll.set_viewport_rows(rows);
        self.scroll_x = self.scroll_x.clamp(0.0, self.max_scroll_x());
        if resized {
            self.rows_moved(cx);
        }
        cx.notify();
    }

    /// Scrolls by `rows` (positive is down) and `x` pixels.
    fn scroll_by(&mut self, rows: f64, x: f32, cx: &mut Context<Self>) {
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
            cx.notify();
        }
    }

    fn scroll_to_fraction(&mut self, fraction: f64, cx: &mut Context<Self>) {
        self.move_top_to(fraction.clamp(0.0, 1.0) * self.scroll.max_top(), cx);
    }

    /// Moves the top row to `top` (clamped), leaning prefetch the way it went.
    fn move_top_to(&mut self, top: f64, cx: &mut Context<Self>) {
        let before = self.scroll.top();
        if self.scroll.set_top(top) {
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
    #[cfg_attr(
        not(target_family = "wasm"),
        expect(unused_variables, reason = "only the web build loads pages")
    )]
    fn rows_moved(&mut self, cx: &mut Context<Self>) {
        #[cfg(target_family = "wasm")]
        {
            // Prefetch reaches further ahead while scrolling; once the rows
            // rest, it goes back to even on both sides.
            if self.direction != Direction::Still {
                self.scroll_settle = Some(cx.spawn(async move |this, cx| {
                    cx.background_executor().timer(SCROLL_SETTLE).await;
                    let _ = this.update(cx, |this, cx| {
                        this.direction = Direction::Still;
                        this.load_pages(cx);
                    });
                }));
            }
            self.load_or_settle(cx);
        }
    }

    #[cfg(target_family = "wasm")]
    fn load_or_settle(&mut self, cx: &mut Context<Self>) {
        if self.drag.is_some() {
            // A drag passes through positions it won't stop at. A page read
            // can't be taken back once DuckDB starts it (its worker reads
            // with sync XHRs; cancel lands between query slices), and on a
            // slow network it holds up the page the drag ends on: on Fast 4G,
            // a jump waited 2.1 s behind one such read (M4). So load only
            // once the pointer rests, or on release.
            self.drag_settle = Some(cx.spawn(async move |this, cx| {
                cx.background_executor().timer(DRAG_SETTLE).await;
                let _ = this.update(cx, |this, cx| this.load_pages(cx));
            }));
        } else {
            self.load_pages(cx);
        }
    }

    fn end_drag(&mut self, cx: &mut Context<Self>) {
        self.drag = None;
        #[cfg(target_family = "wasm")]
        if self.drag_settle.take().is_some() {
            self.load_pages(cx);
        }
        cx.notify();
    }

    #[cfg(target_family = "wasm")]
    fn wanted(&self) -> Vec<u64> {
        self.cache
            .wanted(self.scroll.visible(), self.direction, self.paging.prefetch)
    }

    /// Sends the queries the viewport needs and cancels the ones it doesn't.
    #[cfg(target_family = "wasm")]
    fn load_pages(&mut self, cx: &mut Context<Self>) {
        let wanted = self.wanted();
        self.load_wanted(&wanted, cx);
    }

    #[cfg(target_family = "wasm")]
    fn load_wanted(&mut self, wanted: &[u64], cx: &mut Context<Self>) {
        if self.closed {
            return;
        }
        let visible = self.cache.visible_pages(self.scroll.visible());
        let plan = self.cache.plan(wanted, visible);
        for request in plan.cancel {
            self.engine.cancel(request);
        }
        for page in plan.fetch {
            let sql = self.source.page_sql(self.cache.rows_of(page));
            let (request, result) = self.engine.query(&sql);
            self.cache.started(page, request);
            cx.spawn(async move |this, cx| {
                let result = result.await;
                let _ = this.update(cx, |this, cx| this.page_done(page, request, result, cx));
            })
            .detach();
        }
    }

    #[cfg(target_family = "wasm")]
    fn page_done(
        &mut self,
        page: u64,
        request: Request,
        result: Result<QueryResult, crate::engine::EngineError>,
        cx: &mut Context<Self>,
    ) {
        if self.closed {
            return;
        }
        let wanted = self.wanted();
        match result {
            Ok(rows) => {
                let bytes = rows.heap_bytes();
                self.cache.loaded(page, request, rows, bytes, &wanted);
            }
            Err(crate::engine::EngineError::Cancelled) => self.cache.finished(request),
            Err(error) => {
                let read_failure = error.is_read_failure();
                self.cache.failed(page, request, error.to_string());
                if read_failure {
                    cx.emit(TableEvent::ReadFailed);
                }
            }
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

    fn line_up(&mut self, _: &LineUp, _: &mut Window, cx: &mut Context<Self>) {
        self.scroll_by(-1.0, 0.0, cx);
    }

    fn line_down(&mut self, _: &LineDown, _: &mut Window, cx: &mut Context<Self>) {
        self.scroll_by(1.0, 0.0, cx);
    }

    fn page_up(&mut self, _: &PageUp, _: &mut Window, cx: &mut Context<Self>) {
        self.scroll_by(-self.page_rows(), 0.0, cx);
    }

    fn page_down(&mut self, _: &PageDown, _: &mut Window, cx: &mut Context<Self>) {
        self.scroll_by(self.page_rows(), 0.0, cx);
    }

    fn scroll_to_top(&mut self, _: &ScrollToTop, _: &mut Window, cx: &mut Context<Self>) {
        self.scroll_to_fraction(0.0, cx);
    }

    fn scroll_to_end(&mut self, _: &ScrollToEnd, _: &mut Window, cx: &mut Context<Self>) {
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
            f64::from(self.content_width),
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

    /// Visible columns: those overlapping the cells area at `scroll_x`.
    fn visible_columns(&self) -> impl Iterator<Item = (usize, &TableColumn)> {
        let (left, right) = (self.scroll_x, self.scroll_x + self.cells_width());
        self.columns
            .iter()
            .enumerate()
            .filter(move |(_, column)| column.x + column.width > left && column.x < right)
    }

    /// Marks the frames where the viewport becomes fully loaded: every one
    /// sets `tycho:viewport-filled` once presented, and the first also sets
    /// `tycho:first-rows` and emits [`TableEvent::FirstRows`].
    fn track_filled(&mut self, filled: bool, cx: &mut Context<Self>) {
        let became_filled = filled && !self.filled;
        self.filled = filled;
        #[cfg(target_family = "wasm")]
        if became_filled {
            // The microtask is queued now; the mark is what the checks read,
            // so it's set only while measuring (marks are never cleared).
            if crate::targets::measuring() {
                drop(seiza::mark_after_current_task(VIEWPORT_FILLED_MARK));
            }
            if std::mem::take(&mut self.first_rows_pending) {
                let first_rows = seiza::mark_after_current_task(FIRST_ROWS_MARK);
                cx.spawn(async move |this, cx| {
                    let shown_ms = first_rows.await;
                    let _ = this.update(cx, |_, cx| cx.emit(TableEvent::FirstRows { shown_ms }));
                })
                .detach();
            }
        }
        #[cfg(not(target_family = "wasm"))]
        let _ = (became_filled, cx);
    }

    fn render_header(&self, cx: &App) -> Div {
        let theme = cx.theme();
        let gutter = self.gutter_width();
        let cells = self.visible_columns().map(|(_, column)| {
            div()
                .absolute()
                .top_0()
                .h_full()
                .left(px(column.x - self.scroll_x))
                .w(px(column.width))
                .px_2()
                .flex()
                .items_center()
                .when(column.numeric, |cell| cell.justify_end())
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
        let columns: Vec<(usize, TableColumn)> = self
            .visible_columns()
            .map(|(index, column)| (index, column.clone()))
            .collect();

        let (mut loaded, mut pending, mut failed) = (0u64, 0u64, 0u64);
        let mut row_backgrounds = Vec::new();
        let mut gutter_cells = Vec::new();
        let mut cells = Vec::new();
        let mut last_cell = None;
        let measuring = crate::targets::measuring();
        {
            let theme = cx.theme();
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
                        .when(self.marked == Some(row), |row| row.bg(theme.table_active)),
                );
                gutter_cells.push(
                    div()
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
                match self.cache.row(row) {
                    RowState::Loaded(page, index) => {
                        loaded += 1;
                        if measuring && row + 1 == visible.end {
                            last_cell = page.value(index, 0).map(|value| value.to_string());
                        }
                        for (column_index, column) in &columns {
                            let value = page.value(index, *column_index).unwrap_or(Value::Null);
                            let (text, color) = match value {
                                Value::Null => ("NULL".to_string(), theme.muted_foreground),
                                value => (value.to_string(), theme.foreground),
                            };
                            cells.push(
                                self.cell(column, top, row_h)
                                    .when(column.numeric, |cell| cell.justify_end())
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
                                    .when(column.numeric, |cell| cell.justify_end())
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

        // An empty file shows no rows, and is complete as soon as it's open.
        let filled = if self.scroll.rows() == 0 {
            true
        } else {
            !visible.is_empty() && loaded == visible.end - visible.start
        };
        self.track_filled(filled, cx);
        #[cfg(target_family = "wasm")]
        if seiza::perf::is_visible(cx) {
            self.activity
                .record(crate::engine::now(), self.scroll.top(), filled);
        } else {
            self.activity.clear();
        }
        if measuring {
            crate::targets::publish_table(&TableProbe {
                rows: self.scroll.rows(),
                top: self.scroll.top(),
                first: visible.start,
                end: visible.end,
                loaded,
                pending,
                failed,
                last_cell,
                marked: self.marked,
            });
        }

        let entity = cx.entity();
        let bar = Scrollbar::width();
        let vertical = self.vertical_thumb();
        let horizontal = self.horizontal_thumb();
        let wide = self.max_scroll_x() > 0.0;
        let theme = cx.theme();

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
                            this.publish_scrollbar_targets(bounds);
                        });
                        // Registered every frame, not only once a drag has
                        // started: a quick click on the track delivers the
                        // press and the release before the next paint, and a
                        // release missed that way left the drag on, so the
                        // next pointer move scrolled the table (M4, WebKit).
                        let moving = entity.clone();
                        window.on_mouse_event(move |event: &MouseMoveEvent, phase, _, cx| {
                            if phase == DispatchPhase::Capture {
                                moving.update(cx, |this, cx| {
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
                                    if this.drag.is_some() {
                                        this.end_drag(cx);
                                    }
                                });
                            }
                        });
                    },
                )
                .absolute()
                .size_full(),
            )
            .children(row_backgrounds)
            .child(
                div()
                    .absolute()
                    .top_0()
                    .bottom(bar)
                    .left(px(gutter))
                    .right(bar)
                    .overflow_hidden()
                    .children(cells),
            )
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
                    .id("row-table-vscroll")
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
                        .id("row-table-hscroll")
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

    fn cell(&self, column: &TableColumn, top: Pixels, height: Pixels) -> Div {
        div()
            .absolute()
            .top(top)
            .h(height)
            .left(px(column.x - self.scroll_x))
            .w(px(column.width))
            .px_2()
            .flex()
            .items_center()
            .truncate()
    }

    /// Publishes the vertical scrollbar's track and thumb for the Playwright
    /// checks (`table-scroll-track`, `table-scroll-thumb`).
    fn publish_scrollbar_targets(&self, body: Bounds<Pixels>) {
        let bar = Scrollbar::width();
        let track = Bounds::new(
            point(body.origin.x + body.size.width - bar, body.origin.y),
            size(bar, (body.size.height - bar).max(px(0.))),
        );
        let thumb = self.vertical_thumb();
        crate::targets::publish("table-scroll-track", track);
        crate::targets::publish(
            "table-scroll-thumb",
            Bounds::new(
                point(track.origin.x, track.origin.y + px(thumb.offset)),
                size(bar, px(thumb.length)),
            ),
        );
    }
}

/// How long a dragged scrollbar thumb must rest before its rows load.
#[cfg(target_family = "wasm")]
const DRAG_SETTLE: std::time::Duration = std::time::Duration::from_millis(80);
/// How long the rows must rest before prefetch stops leaning ahead.
#[cfg(target_family = "wasm")]
const SCROLL_SETTLE: std::time::Duration = std::time::Duration::from_millis(250);

/// Set right after each frame in which the viewport becomes fully loaded.
#[cfg(target_family = "wasm")]
const VIEWPORT_FILLED_MARK: &str = "tycho:viewport-filled";
/// Set right after the first such frame for a file.
#[cfg(target_family = "wasm")]
const FIRST_ROWS_MARK: &str = "tycho:first-rows";

impl EventEmitter<TableEvent> for RowTable {}

impl Focusable for RowTable {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus_handle.clone()
    }
}

impl Render for RowTable {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let focused = self.focus_handle.is_focused(window);
        let header = self.render_header(cx);
        let body = self.render_body(cx);
        let theme = cx.theme();
        div()
            .id("row-table")
            .key_context(CONTEXT)
            .track_focus(&self.focus_handle)
            .on_action(cx.listener(Self::line_up))
            .on_action(cx.listener(Self::line_down))
            .on_action(cx.listener(Self::page_up))
            .on_action(cx.listener(Self::page_down))
            .on_action(cx.listener(Self::scroll_to_top))
            .on_action(cx.listener(Self::scroll_to_end))
            .on_mouse_down(
                MouseButton::Left,
                cx.listener(|this, _, window, cx| window.focus(&this.focus_handle, cx)),
            )
            .size_full()
            .flex()
            .flex_col()
            .overflow_hidden()
            .text_sm()
            .bg(theme.tokens.table)
            .rounded(theme.radius)
            .border_1()
            .border_color(if focused { theme.ring } else { theme.border })
            .child(header)
            .child(body)
    }
}
