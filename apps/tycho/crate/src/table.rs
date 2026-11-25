//! The table Tycho shows: `seiza-tall-table` over DuckDB (`seiza-duckdb`'s
//! `tall-table` feature), reading a Parquet file where it lies or a CSV's chunk
//! tables. Also what Tycho does with the table's events: the first-rows and
//! viewport-filled marks, and the probes the Playwright checks read; the
//! icons it draws (each header's type badge, the popover's cue); and the
//! popover's foot.

use std::cell::RefCell;
use std::collections::BTreeMap;
use std::ops::Range;
use std::rc::{Rc, Weak};

use gpui_kit::component::Theme;
use gpui_kit::{App, Hsla};
use seiza_duckdb::arrow::QueryResult;
use seiza_duckdb::sql::ColumnInfo;
use seiza_duckdb::tall_table::{PageQuery, ParquetFile, QueryRows};
use seiza_tall_table::{
    CellValue, ColumnKind, HeaderIcon, PageLoad, TallTableDelegate, TallTableEvent, TallTablePage,
    TallTableState,
};

pub use seiza_tall_table::init;

/// Where the table's rows come from.
#[derive(Debug, Clone, PartialEq)]
pub enum Source {
    /// A registered Parquet file, read where it lies.
    Parquet(ParquetFile),
    /// A CSV file's chunk tables, growing while it loads.
    Csv(crate::csv::Chunks),
}

impl PageQuery for Source {
    fn page_sql(&self, rows: Range<u64>) -> String {
        match self {
            Self::Parquet(file) => file.page_sql(rows),
            Self::Csv(chunks) => chunks.page_sql(rows),
        }
    }
}

/// The table's source: the file's rows through DuckDB, each page the table
/// loads also kept here as a weak reference, so the page can read a row the
/// table holds (the Row tab, a cell's menu) without a query or a second
/// copy: a page the table drops is gone here too (`docs/DECISIONS.md`,
/// "Table and paging", 2026-11-24).
pub struct Rows {
    query: QueryRows<Source>,
    /// By each page's first row: the pages read for it, a reload's and a
    /// copy's beside the cached one, until each is dropped.
    loaded: Rc<RefCell<BTreeMap<u64, Vec<Weak<QueryResult>>>>>,
}

/// A page of rows the table holds, shared with [`Rows`]' weak references.
pub struct Page(Rc<QueryResult>);

impl TallTablePage for Page {
    fn value(&self, row: usize, column: usize) -> Option<CellValue<'_>> {
        TallTablePage::value(&*self.0, row, column)
    }

    fn heap_bytes(&self) -> usize {
        TallTablePage::heap_bytes(&*self.0)
    }
}

impl Rows {
    pub fn new(query: QueryRows<Source>) -> Self {
        Self {
            query,
            loaded: Rc::default(),
        }
    }

    pub fn query_mut(&mut self) -> &mut Source {
        self.query.query_mut()
    }

    /// The source's SQL for `rows`: a row the table doesn't hold is read
    /// with it, one row and never more.
    pub fn page_sql(&self, rows: Range<u64>) -> String {
        self.query.query().page_sql(rows)
    }

    /// The loaded page holding `row`, and the row's place in it, if the
    /// table holds one.
    pub fn loaded(&self, row: u64) -> Option<(Rc<QueryResult>, usize)> {
        let loaded = self.loaded.borrow();
        loaded.range(..=row).rev().find_map(|(&start, pages)| {
            pages.iter().find_map(|page| {
                let page = page.upgrade()?;
                let at = usize::try_from(row - start).ok()?;
                (at < page.num_rows()).then_some((page, at))
            })
        })
    }
}

impl TallTableDelegate for Rows {
    type Page = Page;
    type Request = <QueryRows<Source> as TallTableDelegate>::Request;

    fn load_page(&mut self, rows: Range<u64>, cx: &mut App) -> (Self::Request, PageLoad<Page>) {
        let start = rows.start;
        let (request, page) = self.query.load_page(rows, cx);
        let loaded = self.loaded.clone();
        (
            request,
            Box::pin(async move {
                let page = Rc::new(page.await?);
                let mut loaded = loaded.borrow_mut();
                // Pages the table has dropped go, here and at every start.
                loaded.retain(|_, pages| {
                    pages.retain(|page| page.strong_count() > 0);
                    !pages.is_empty()
                });
                loaded.entry(start).or_default().push(Rc::downgrade(&page));
                Ok(Page(page))
            }),
        )
    }

    fn cancel(&mut self, request: Self::Request, cx: &mut App) {
        self.query.cancel(request, cx);
    }
}

pub type RowTable = TallTableState<Rows>;

/// Set right after each frame in which the viewport becomes fully loaded,
/// while [`crate::targets::measuring`].
const VIEWPORT_FILLED_MARK: &str = "tycho:viewport-filled";
/// Set right after the first such frame for a file.
#[cfg(target_family = "wasm")]
pub const FIRST_ROWS_MARK: &str = "tycho:first-rows";

/// The table's paging: the defaults, with `?page=`, `?prefetch=`, and
/// `?budget_mib=` from the URL applied (the page-size sweep sets them).
#[cfg(target_family = "wasm")]
fn paging() -> seiza_tall_table::Paging {
    let number = |key: &str| {
        seiza::url::param(key)
            .and_then(|value| value.parse::<u64>().ok())
            .filter(|value| *value > 0)
    };
    let mut paging = seiza_tall_table::Paging::default();
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

/// A table over `rows` rows of `source`. It records its scrolling while the
/// observation panel is open, and reports its probes while measuring.
#[cfg(target_family = "wasm")]
pub fn new(
    source: Source,
    rows: u64,
    view: crate::view::TableCalls,
    engine: seiza_duckdb::Engine,
    cx: &mut gpui_kit::Context<RowTable>,
) -> RowTable {
    let crate::view::TableCalls {
        columns,
        order,
        pinned,
        ..
    } = view;
    let mut table = RowTable::new(
        Rows::new(QueryRows::new(engine, source)),
        columns,
        rows,
        paging(),
        cx,
    )
    .with_activity(seiza_tall_table::ActivityOptions::new(
        seiza::perf::WINDOW_MS,
        seiza::marks::now,
        seiza::perf::is_visible,
    ))
    .probe_frames(crate::targets::measuring())
    .probe_cells(crate::targets::probing_cells());
    // A file's own view moves and pins nothing; a view given with the file
    // would (a link, once one opens a view).
    if order
        .iter()
        .enumerate()
        .any(|(place, &index)| place != index)
    {
        table.set_order(order, cx);
    }
    if pinned > 0 {
        table.set_pinned(pinned, cx);
    }
    settle(&mut table, cx);
    table
}

/// The table's settings for Tycho's menus and its popover (`docs/DECISIONS.md`,
/// "Scope", 2026-11-20 and 2026-11-21): a finger's tap on a header is one
/// press (its menu holds what the arrow and the band would do), Ctrl+press
/// is a right-click in a Mac browser, and the popover opens on cut text
/// alone, its cue a fade with a chevron, its foot "Focus row in panel".
pub fn settle(table: &mut RowTable, cx: &mut gpui_kit::Context<RowTable>) {
    use seiza_tall_table::{PopoverButton, PopoverCells, PopoverCue};

    table.set_header_tap_is_press(true);
    table.set_ctrl_press_is_context(mac_browser());
    table.set_popover_cells(PopoverCells::CutText, cx);
    table.set_popover_cue(
        Some(
            PopoverCue::icon(icons::CHEVRON_DOWN)
                .fade()
                .open_icon(icons::CHEVRON_UP),
        ),
        cx,
    );
    table.set_popover_button(Some(PopoverButton::custom(popover_foot).fill()), cx);
}

/// The popover's foot, as the Popover board draws it: one row, "Focus row
/// in panel" in the accent at its left and the key, "Enter", muted at its
/// right (`docs/DECISIONS.md`, "Scope", 2026-11-25: the board's "Open row"
/// renamed). The table's own label draws one text, which can't hold the key.
fn popover_foot(_: &mut gpui_kit::Window, cx: &mut App) -> gpui_kit::AnyElement {
    use gpui_kit::{IntoElement as _, ParentElement as _, Styled as _, div, px};

    let tokens = crate::theme::tokens(cx.global::<Theme>().is_dark());
    let color = |rgba: gpui_kit::Rgba| Hsla::from(rgba);
    div()
        .h(px(30.))
        .w_full()
        .px(px(10.))
        .flex()
        .items_center()
        .justify_between()
        .gap(px(20.))
        .border_t_1()
        .border_color(color(tokens.border))
        .bg(color(tokens.surface_raised))
        .cursor_pointer()
        .child(
            div()
                .text_size(px(12.))
                .text_color(color(tokens.accent))
                .child("Focus row in panel"),
        )
        .child(
            div()
                .text_size(px(11.))
                .text_color(color(tokens.foreground_subtle))
                .child("Enter"),
        )
        .into_any_element()
}

/// Whether the page runs in a Mac browser (`navigator.platform`), where
/// Ctrl+click is the reader's right-click.
fn mac_browser() -> bool {
    #[cfg(target_family = "wasm")]
    {
        use wasm_bindgen::JsValue;
        js_sys::Reflect::get(&js_sys::global(), &JsValue::from_str("navigator"))
            .and_then(|navigator| js_sys::Reflect::get(&navigator, &JsValue::from_str("platform")))
            .ok()
            .and_then(|platform| platform.as_string())
            .is_some_and(|platform| platform.starts_with("Mac"))
    }
    #[cfg(not(target_family = "wasm"))]
    false
}

/// A column's type, as its badge and the page's lists name it: `number`,
/// `text`, `time`, or `boolean`.
pub fn type_name(info: &ColumnInfo) -> &'static str {
    match info.tall_table_column().kind() {
        ColumnKind::Boolean => "boolean",
        ColumnKind::Date | ColumnKind::Timestamp => "time",
        ColumnKind::Integer { .. } | ColumnKind::Float | ColumnKind::Decimal => "number",
        _ => "text",
    }
}

/// A column's header icon: its type's badge, as the Headers A board draws
/// it (the glyph in the type's color on its tint), which is also its
/// menu's button.
pub fn type_icon(info: &ColumnInfo) -> HeaderIcon {
    type Stops = (&'static str, fn(&Theme) -> Hsla, fn(&Theme) -> Hsla);
    fn tokens(theme: &Theme) -> &'static crate::theme::Tokens {
        crate::theme::tokens(theme.is_dark())
    }
    let (path, color, fill): Stops = match type_name(info) {
        "number" => (
            icons::NUMBER,
            |theme| tokens(theme).type_number.into(),
            |theme| tokens(theme).type_number_tint.into(),
        ),
        "time" => (
            icons::TIME,
            |theme| tokens(theme).type_time.into(),
            |theme| tokens(theme).type_time_tint.into(),
        ),
        // No tint token: the page's 15% of its color (`web/src/frame/bar.tsx`).
        "boolean" => (
            icons::BOOLEAN,
            |theme| tokens(theme).type_boolean.into(),
            |theme| Hsla::from(tokens(theme).type_boolean).opacity(0.15),
        ),
        _ => (
            icons::TEXT,
            |theme| tokens(theme).type_text.into(),
            |theme| tokens(theme).type_text_tint.into(),
        ),
    };
    HeaderIcon::new(path, color).fill(fill)
}

/// The SVGs Tycho draws on the canvas, embedded in the wasm, so a path
/// loads at the call that sets it (the table's rule for its icons): the
/// design's glyphs on a 16 px grid, the text type's "Aa" outlined from IBM
/// Plex Sans SemiBold, since the wasm build has no font for an SVG's text.
pub mod icons {
    use std::borrow::Cow;

    use gpui_kit::SharedString;

    pub const TEXT: &str = "tycho/text.svg";
    pub const NUMBER: &str = "tycho/number.svg";
    pub const TIME: &str = "tycho/time.svg";
    pub const BOOLEAN: &str = "tycho/boolean.svg";
    pub const CHEVRON_DOWN: &str = "tycho/chevron-down.svg";
    pub const CHEVRON_UP: &str = "tycho/chevron-up.svg";

    const ALL: [(&str, &[u8]); 6] = [
        (TEXT, include_bytes!("../assets/icons/text.svg")),
        (NUMBER, include_bytes!("../assets/icons/number.svg")),
        (TIME, include_bytes!("../assets/icons/time.svg")),
        (BOOLEAN, include_bytes!("../assets/icons/boolean.svg")),
        (
            CHEVRON_DOWN,
            include_bytes!("../assets/icons/chevron-down.svg"),
        ),
        (CHEVRON_UP, include_bytes!("../assets/icons/chevron-up.svg")),
    ];

    /// `seiza::Bootstrap`'s asset source.
    #[derive(Clone, Copy, Debug, Default)]
    pub struct Icons;

    impl gpui_kit::AssetSource for Icons {
        fn load(&self, path: &str) -> gpui_kit::Result<Option<Cow<'static, [u8]>>> {
            Ok(ALL
                .iter()
                .find(|(name, _)| *name == path)
                .map(|(_, bytes)| Cow::Borrowed(*bytes)))
        }

        fn list(&self, path: &str) -> gpui_kit::Result<Vec<SharedString>> {
            Ok(ALL
                .iter()
                .filter(|(name, _)| name.starts_with(path))
                .map(|(name, _)| SharedString::from(*name))
                .collect())
        }
    }
}

/// A CSV chunk became `table`, holding `rows` more rows.
pub fn grow(table: &mut RowTable, chunk: String, rows: u64, cx: &mut gpui_kit::Context<RowTable>) {
    let Source::Csv(chunks) = table.delegate_mut().query_mut() else {
        return;
    };
    chunks.push(chunk, rows);
    let total = chunks.rows();
    table.set_rows(total, cx);
}

/// A later CSV chunk had values `widened` columns' types couldn't hold, so
/// they're text from here on: `view` is the controller's calls for the
/// file's columns with them widened, its order, widths, and pins kept.
/// Pages already loaded keep their values; new reads cast the earlier
/// chunks' values to text too.
pub fn widen(
    table: &mut RowTable,
    widened: &[String],
    view: crate::view::TableCalls,
    cx: &mut gpui_kit::Context<RowTable>,
) {
    if let Source::Csv(chunks) = table.delegate_mut().query_mut() {
        for column in widened {
            chunks.widen(column);
        }
    }
    view.apply(table, cx);
}

/// Reads a Parquet table's rows from `name` from now on (the same file,
/// registered again), and loads the pages whose reads failed again.
pub fn read_from(table: &mut RowTable, name: String, cx: &mut gpui_kit::Context<RowTable>) {
    if let Source::Parquet(file) = table.delegate_mut().query_mut() {
        file.set_name(name);
    }
    table.retry_failed(cx);
}

/// Publishes what the shown table reports for the scripts, through
/// `tall-table-bridge`: its scrollbar's targets, its probes
/// (`globalThis.__tychoTable`, `__tychoTableLayout`, and `__tychoCells`,
/// which the table reports only while measuring), and (while measuring)
/// the `tycho:viewport-filled` mark and its features' globals: the
/// selection (`__tychoSelection`), the last press (`__tychoClick`), the
/// hidden flags (`__tychoHidden`), the popover's button
/// (`__tychoPopoverButton`), and a header icon's press
/// (`__tychoIconPress`). The table emits these while its frame
/// renders, so a mark set here lands right after the frame is presented.
/// The first-rows mark is the workbench's, which also shows it in the panel.
pub fn publish(event: &TallTableEvent) {
    let measuring = crate::targets::measuring();
    tall_table_bridge::Publish {
        // The mark is what the checks read, so it's set only while
        // measuring (marks are never cleared).
        filled_mark: measuring.then_some(VIEWPORT_FILLED_MARK),
        scrollbar: true,
        probe: Some("__tychoTable"),
        layout: Some("__tychoTableLayout"),
        cells: Some("__tychoCells"),
        // What the table reports of its own features, while measuring.
        selection: measuring.then_some("__tychoSelection"),
        click: measuring.then_some("__tychoClick"),
        hidden: measuring.then_some("__tychoHidden"),
        popover_button: measuring.then_some("__tychoPopoverButton"),
        icon_press: measuring.then_some("__tychoIconPress"),
        ..Default::default()
    }
    .event(event);
}
