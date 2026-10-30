//! The host's one view: the table filling the window, with the padding the
//! observatory's GPUI contender gives it.

use std::time::Duration;

use gpui_kit::*;
#[cfg(all(feature = "copy", target_family = "wasm"))]
use seiza_tall_table::TallTableCopy;
#[cfg(feature = "copy")]
use seiza_tall_table::TallTableEvent;
use seiza_tall_table::{Paging, TallTable, TallTableState};
use tall_table_bridge::Publish;

#[cfg(feature = "custom-cells")]
use crate::rows::Cells;
use crate::rows::{MemoryRows, Shape};

/// The window's title.
#[cfg_attr(
    not(target_family = "wasm"),
    expect(dead_code, reason = "only the web build opens a window")
)]
pub const TITLE: &str = "Tall table: bare host";

/// Set right after each frame in which the viewport became filled.
pub const FILLED_MARK: &str = "tall-table:filled";

/// Set right after each frame that first draws a re-read page (`live`),
/// with the highest generation drawn so far in [`REFRESHED_GLOBAL`].
pub const REFRESHED_MARK: &str = "tall-table:refreshed";
pub const REFRESHED_GLOBAL: &str = "__tallTableRefreshed";

/// Set once each batch of the feed's updates is invalidated (`live`), at
/// the time its rows were picked, so the mark's time covers the source's
/// bumps, the invalidation, and any read it landed at once, but not the
/// feed's own picking; its last generation in [`INVALIDATED_GLOBAL`],
/// set first.
#[cfg(all(feature = "live", target_family = "wasm"))]
pub const INVALIDATED_MARK: &str = "tall-table:invalidated";
#[cfg(all(feature = "live", target_family = "wasm"))]
pub const INVALIDATED_GLOBAL: &str = "__tallTableInvalidated";

/// Set right after each frame whose drawn tail grew while following
/// (`follow`), the end of the tail it drew in [`TAIL_GLOBAL`]; and
/// whether the table follows in [`FOLLOWING_GLOBAL`].
#[cfg(feature = "follow")]
pub const TAIL_MARK: &str = "tall-table:tail";
#[cfg(feature = "follow")]
pub const TAIL_GLOBAL: &str = "__tallTableTail";
#[cfg(feature = "follow")]
pub const FOLLOWING_GLOBAL: &str = "__tallTableFollowing";

/// Each column's set width, CSS px or `null` for a kind's, replaced at each
/// release or fit that changed one (`resize`'s `ColumnWidthsChanged`).
#[cfg(feature = "resize")]
pub const WIDTHS_GLOBAL: &str = "__tallTableWidths";

/// What's selected, `{kind, anchor, head}` or `null`, replaced at each
/// change (`select`'s `Selected`).
#[cfg(feature = "select")]
pub const SELECTION_GLOBAL: &str = "__tallTableSelection";

/// The order, `{column, direction}` or `null`, replaced at each change,
/// and the mark set as it changes (`sort`'s `Sorted`).
#[cfg(feature = "sort")]
pub const SORTED_GLOBAL: &str = "__tallTableSorted";
#[cfg(feature = "sort")]
pub const SORTED_MARK: &str = "tall-table:sorted";

/// What became of the last copy (`copy`), as `tall-table-bridge`'s
/// `clipboard::Outcome::to_js` writes it, replaced at each step.
#[cfg(feature = "copy")]
pub const COPY_GLOBAL: &str = "__tallTableCopy";

/// Set as a copy starts (`Started`, in the key's task), as its text is all
/// in (`Copied`), and as the browser says it wrote it (`copy`).
#[cfg(all(feature = "copy", target_family = "wasm"))]
pub const COPY_STARTED_MARK: &str = "tall-table:copy-started";
#[cfg(all(feature = "copy", target_family = "wasm"))]
pub const COPIED_MARK: &str = "tall-table:copied";
#[cfg(all(feature = "copy", target_family = "wasm"))]
pub const COPY_WRITTEN_MARK: &str = "tall-table:copy-written";

/// The scripts' hooks with `?perf` (`copy` or `sort`):
/// `__tallTableExact(row, column)`, a value's exact text (`null` for NULL)
/// at a row of the order read now. With `copy`: `__tallTableSelect(kind,
/// anchorRow, anchorColumn, headRow, headColumn)`, the table's `select`
/// (`kind` `rows`, `columns`, `cells`, or anything else for none), the
/// table focused as a press would; `__tallTableClose()`, the table's
/// `close`, told to the clipboard's writer; and `__tallTableHeap()`, the
/// wasm heap's bytes (its memory, which never shrinks). With `sort`:
/// `__tallTableSort(column, direction)`, the table's `set_sort`
/// (`direction` `ascending` or `descending`, anything else for none;
/// `false`, and nothing sent, for a column that isn't one), and
/// `__tallTableSourceRow(row)`, the source's own row at a row of the order
/// read now; and `__tallTableDrained()`, the reads cancelled in flight so
/// far.
#[cfg(all(any(feature = "copy", feature = "sort"), target_family = "wasm"))]
const EXACT_HOOK: &str = "__tallTableExact";
#[cfg(all(feature = "copy", target_family = "wasm"))]
const HEAP_HOOK: &str = "__tallTableHeap";
#[cfg(all(feature = "copy", target_family = "wasm"))]
const SELECT_HOOK: &str = "__tallTableSelect";
#[cfg(all(feature = "copy", target_family = "wasm"))]
const CLOSE_HOOK: &str = "__tallTableClose";
#[cfg(all(feature = "sort", target_family = "wasm"))]
const SORT_HOOK: &str = "__tallTableSort";
#[cfg(all(feature = "sort", target_family = "wasm"))]
const SOURCE_ROW_HOOK: &str = "__tallTableSourceRow";
#[cfg(all(feature = "sort", target_family = "wasm"))]
const DRAINED_HOOK: &str = "__tallTableDrained";

// gpui-kit's sort icons (`sort`), embedded in the wasm (`seiza::Bootstrap`'s
// `assets`), for `?sort-icons`: bundled whichever the page draws, so the
// `sort` build holds the icons' code either way.
#[cfg(feature = "sort")]
gpui_kit::assets::icon_assets!(pub SortIconAssets, [SortAscending, SortDescending, ChevronsUpDown]);

/// gpui-kit's three sort icons' paths (`sort`, `?sort-icons`).
#[cfg(all(feature = "sort", target_family = "wasm"))]
fn sort_icons() -> seiza_tall_table::SortIcons {
    use gpui_kit::assets::IconName;
    seiza_tall_table::SortIcons::new(
        IconName::SortAscending.path(),
        IconName::SortDescending.path(),
        IconName::ChevronsUpDown.path(),
    )
}

/// The host's key context (`copy`), for its own keys.
#[cfg(feature = "copy")]
const HOST_CONTEXT: &str = "TallTableHost";

#[cfg(feature = "copy")]
actions!(
    tall_table_host,
    [
        /// Cmd+Shift+C and Ctrl+Shift+C: the host's `copy`, as a host's
        /// confirming click would call it after a `Declined` (no key limit;
        /// the cap still holds). A key, so it's a gesture the clipboard
        /// takes.
        CopyConfirmed
    ]
);

/// Binds the host's keys (`copy`).
#[cfg(feature = "copy")]
#[cfg_attr(
    not(target_family = "wasm"),
    expect(dead_code, reason = "only the web build opens a window")
)]
pub fn init(cx: &mut App) {
    let context = Some(HOST_CONTEXT);
    cx.bind_keys([
        KeyBinding::new("cmd-shift-c", CopyConfirmed, context),
        KeyBinding::new("ctrl-shift-c", CopyConfirmed, context),
    ]);
}

/// Set as each batch of the tail feed's rows is appended (`follow`), at
/// the time it's sent, the rows the source holds then in
/// [`APPENDED_GLOBAL`], set first: the first tail mark whose
/// [`TAIL_GLOBAL`] is at or past it draws them.
#[cfg(all(feature = "follow", target_family = "wasm"))]
pub const APPENDED_MARK: &str = "tall-table:appended";
#[cfg(all(feature = "follow", target_family = "wasm"))]
pub const APPENDED_GLOBAL: &str = "__tallTableAppended";

/// How often the feed sends a batch: about a frame.
#[cfg(feature = "live")]
const FEED_EVERY: Duration = Duration::from_millis(16);

/// The most time one batch catches up on.
#[cfg(feature = "live")]
const FEED_CATCH_UP: Duration = Duration::from_millis(100);

/// The feed's seed, so every run updates the same rows.
#[cfg(feature = "live")]
const FEED_SEED: u64 = 0x5EED_7A11_5EED_7A11;

pub type Table = TallTableState<MemoryRows>;

pub struct Host {
    table: Entity<Table>,
    _events: Subscription,
    /// The clipboard's writer for the table's copies (`copy`).
    #[cfg(feature = "copy")]
    clipboard: tall_table_bridge::clipboard::Clipboard,
    /// The feed's timer (`live`, `?live=`).
    #[cfg(feature = "live")]
    _feed: Option<Task<()>>,
    /// The tail feed's timer (`follow`, `?append=`).
    #[cfg(feature = "follow")]
    _appends: Option<Task<()>>,
}

impl Host {
    /// A table over `shape`'s rows, each page read held `delay`, its float
    /// columns painted `cells`' way (`custom-cells`). With
    /// `probing`, the table reports its probes and the host publishes them
    /// (`__tallTable`, `__tallTableLayout`, and with `custom-cells` and
    /// `?probe-cells` the drawn cells, `__tallTableCells`). With `live`,
    /// `live`'s feed and flash, and with `follow` the tail feed ([`Live`]).
    pub fn new(
        shape: Shape,
        delay: Option<Duration>,
        #[cfg(feature = "custom-cells")] cells: Cells,
        #[cfg(feature = "live")] live: Live,
        probing: bool,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let rows = MemoryRows::new(shape, delay);
        // The drawn cells and their paint, for the smoke check
        // (`?probe-cells`), never in a perf run: building them costs every
        // frame. Only with the feature, so the base host is unchanged.
        // With `sort` too, whose smoke check reads the drawn order.
        #[cfg(not(all(
            any(feature = "custom-cells", feature = "sort"),
            target_family = "wasm"
        )))]
        let probe_cells = false;
        #[cfg(all(
            any(feature = "custom-cells", feature = "sort"),
            target_family = "wasm"
        ))]
        let probe_cells = probing && seiza::url::has_param("probe-cells");
        #[cfg(not(feature = "custom-cells"))]
        let columns = shape.columns();
        #[cfg(feature = "custom-cells")]
        let (rows, columns) = (rows.with_cells(cells), cells.columns(shape));
        #[cfg(all(feature = "live", feature = "custom-cells"))]
        let columns = if live.flash {
            crate::rows::with_flash(columns, shape)
        } else {
            columns
        };
        #[cfg(not(feature = "follow"))]
        let count = shape.rows();
        #[cfg(feature = "follow")]
        let count = live.tail.rows.unwrap_or(shape.rows());
        let table = cx.new(|cx| {
            Table::new(rows, columns, count, Paging::default(), cx)
                .probe_frames(probing)
                .probe_cells(probe_cells)
        });
        let publish = Publish {
            filled_mark: Some(FILLED_MARK),
            scrollbar: true,
            probe: probing.then_some("__tallTable"),
            layout: probing.then_some("__tallTableLayout"),
            cells: probe_cells.then_some("__tallTableCells"),
            refreshed_mark: cfg!(feature = "live").then_some(REFRESHED_MARK),
            refreshed: cfg!(feature = "live").then_some(REFRESHED_GLOBAL),
            #[cfg(feature = "follow")]
            following: Some(FOLLOWING_GLOBAL),
            #[cfg(feature = "follow")]
            tail_mark: Some(TAIL_MARK),
            #[cfg(feature = "follow")]
            tail: Some(TAIL_GLOBAL),
            #[cfg(feature = "resize")]
            widths: Some(WIDTHS_GLOBAL),
            #[cfg(feature = "select")]
            selection: Some(SELECTION_GLOBAL),
            #[cfg(feature = "sort")]
            sort: Some(SORTED_GLOBAL),
            #[cfg(feature = "sort")]
            sorted_mark: Some(SORTED_MARK),
        };
        // The table emits while its frame renders, so GPUI runs this in the
        // task that presents it, and the mark lands right after the frame.
        #[cfg(not(feature = "copy"))]
        let events = cx.subscribe(&table, move |_, _, event, _| publish.event(event));
        // A copy's events reach the writer in the task that emitted them:
        // `Started` in the key's, so its write opens inside the gesture.
        #[cfg(feature = "copy")]
        let events = cx.subscribe(&table, move |host: &mut Self, table, event, cx| {
            publish.event(event);
            host.copy_event(&table, event, cx);
        });
        #[cfg(feature = "copy")]
        {
            #[cfg(target_family = "wasm")]
            let options = {
                let number = |name| seiza::url::param(name).and_then(|value| value.parse().ok());
                let mut options = seiza_tall_table::CopyOptions::default();
                if let Some(bytes) = number("copy-max-bytes") {
                    options = options.max_bytes(bytes as usize);
                }
                if let Some(cells) = number("copy-key-cells") {
                    options = options.key_max_cells(cells);
                }
                options
            };
            #[cfg(not(target_family = "wasm"))]
            let options = seiza_tall_table::CopyOptions::default();
            table.update(cx, |table, _| table.set_copy_options(options));
        }
        #[cfg(all(any(feature = "copy", feature = "sort"), target_family = "wasm"))]
        if probing {
            let rows = table.read(cx).delegate();
            let source = Source {
                exact: Box::new(rows.exact()),
                #[cfg(feature = "sort")]
                source_row: Box::new(rows.source_row()),
                #[cfg(feature = "sort")]
                columns: table.read(cx).columns().len(),
                #[cfg(feature = "sort")]
                drained: Box::new(rows.drained_reads()),
            };
            script_hooks(source, window, cx);
        }
        // A jump's highlight over painted cells, for its screenshot.
        #[cfg(all(feature = "custom-cells", target_family = "wasm"))]
        if let Some(row) = seiza::url::param("jump").and_then(|row| row.parse().ok()) {
            table.update(cx, |table, cx| table.jump_to(row, cx));
        }
        // gpui-kit's icons in place of the glyphs (`sort`).
        #[cfg(all(feature = "sort", target_family = "wasm"))]
        if seiza::url::has_param("sort-icons") {
            table.update(cx, |table, cx| table.set_sort_icons(Some(sort_icons()), cx));
        }
        // Sorted from the start, before the first frame: the order computed
        // first (`sort`, `?sort=<column>,<asc|desc>`).
        #[cfg(all(feature = "sort", target_family = "wasm"))]
        if let Some(sort) = seiza::url::param("sort")
            .and_then(|sort| parse_sort(&sort, table.read(cx).columns().len()))
        {
            // Every column sortable and the column in range: the table
            // refuses nothing, and the source's refusal leaves its order,
            // which the scripts read.
            table.update(cx, |table, cx| drop(table.set_sort(Some(sort), cx)));
        }
        // The first columns pinned (`pin`, `?pin=<n>`, by default the
        // shape's): set before the first frame, which pins them. `?pin=0`
        // builds the feature with nothing pinned.
        #[cfg(feature = "pin")]
        {
            #[cfg(target_family = "wasm")]
            let pinned = seiza::url::param("pin")
                .and_then(|count| count.parse().ok())
                .unwrap_or(shape.pinned());
            #[cfg(not(target_family = "wasm"))]
            let pinned = shape.pinned();
            table.update(cx, |table, cx| table.set_pinned(pinned, cx));
        }
        // Following from the start, before the first frame (a log view).
        #[cfg(feature = "follow")]
        if live.tail.follow {
            table.update(cx, |table, cx| table.follow(cx));
        }
        let focus = table.read(cx).focus_handle().clone();
        window.focus(&focus, cx);
        Self {
            #[cfg(feature = "follow")]
            _appends: live
                .tail
                .append
                .map(|rate| Appends::new(rate).start(table.clone(), cx)),
            #[cfg(feature = "live")]
            _feed: live
                .feed
                .map(|rate| Feed::new(rate).start(table.clone(), cx)),
            table,
            _events: events,
            #[cfg(feature = "copy")]
            clipboard: tall_table_bridge::clipboard::Clipboard::new(
                Some(COPY_GLOBAL),
                #[cfg(target_family = "wasm")]
                Some(Box::new(|outcome| {
                    if let tall_table_bridge::clipboard::Outcome::Written { .. } = outcome {
                        let _ = seiza::marks::mark(COPY_WRITTEN_MARK);
                    }
                })),
                #[cfg(not(target_family = "wasm"))]
                None,
            ),
        }
    }

    /// Hands a copy's event to the clipboard's writer, and cancels the copy
    /// when its text can't be written (no clipboard, or the browser
    /// refused).
    #[cfg(feature = "copy")]
    fn copy_event(
        &mut self,
        table: &Entity<Table>,
        event: &TallTableEvent,
        cx: &mut Context<Self>,
    ) {
        let TallTableEvent::Copy(copy) = event else {
            return;
        };
        #[cfg(target_family = "wasm")]
        match copy {
            TallTableCopy::Started { .. } => {
                let _ = seiza::marks::mark(COPY_STARTED_MARK);
            }
            TallTableCopy::Copied { .. } => {
                let _ = seiza::marks::mark(COPIED_MARK);
            }
            _ => {}
        }
        if let Some(id) = self.clipboard.event(copy) {
            table.update(cx, |table, cx| {
                if table.copying().is_some_and(|copying| copying.id == id) {
                    table.cancel_copy(cx);
                }
            });
        }
    }

    /// Closes the table, and tells the clipboard's writer (`copy`): a write
    /// still open is rejected. A script's hook (`?perf`).
    #[cfg(all(feature = "copy", target_family = "wasm"))]
    fn close(&mut self, cx: &mut Context<Self>) {
        self.table.update(cx, |table, cx| table.close(cx));
        self.clipboard.closed();
        cx.notify();
    }
}

/// `?sort=`'s `<column>,<asc|desc>` (`sort`), for a column of the
/// `columns`: `None` for anything else, which the table's own refusal
/// would meet with a debug assertion.
#[cfg(all(feature = "sort", target_family = "wasm"))]
fn parse_sort(sort: &str, columns: usize) -> Option<seiza_tall_table::Sort> {
    use seiza_tall_table::{Sort, SortDirection};
    let (column, direction) = sort.split_once(',')?;
    let direction = match direction {
        "asc" => SortDirection::Ascending,
        "desc" => SortDirection::Descending,
        _ => return None,
    };
    let column = column.parse().ok().filter(|column| *column < columns)?;
    Some(Sort::new(column, direction))
}

/// What the scripts' hooks read of the source (`MemoryRows::exact`, with
/// `sort` `MemoryRows::source_row`).
#[cfg(all(any(feature = "copy", feature = "sort"), target_family = "wasm"))]
struct Source {
    exact: Box<dyn Fn(u64, usize) -> Option<String>>,
    #[cfg(feature = "sort")]
    source_row: Box<dyn Fn(u64) -> u64>,
    /// The table's columns, every one sortable (`sort`).
    #[cfg(feature = "sort")]
    columns: usize,
    #[cfg(feature = "sort")]
    drained: Box<dyn Fn() -> u64>,
}

/// Publishes the scripts' hooks (`?perf`, `copy` or `sort`):
/// [`EXACT_HOOK`], with `copy` [`HEAP_HOOK`], [`SELECT_HOOK`], and
/// [`CLOSE_HOOK`], with `sort` [`SORT_HOOK`], [`SOURCE_ROW_HOOK`], and
/// [`DRAINED_HOOK`]. Those
/// that change the table enter GPUI through its foreground executor, so
/// they've happened by the next turn.
#[cfg(all(any(feature = "copy", feature = "sort"), target_family = "wasm"))]
fn script_hooks(source: Source, window: &mut Window, cx: &mut Context<Host>) {
    use wasm_bindgen::closure::Closure;

    let set = |name, hook: wasm_bindgen::JsValue| tall_table_bridge::js::set_global(name, &hook);
    let Source {
        exact,
        #[cfg(feature = "sort")]
        source_row,
        #[cfg(feature = "sort")]
        columns,
        #[cfg(feature = "sort")]
        drained,
    } = source;
    set(
        EXACT_HOOK,
        // `null` for NULL: wasm-bindgen would answer `None` as `undefined`.
        Closure::<dyn Fn(f64, f64) -> wasm_bindgen::JsValue>::new(move |row: f64, column: f64| {
            exact(row as u64, column as usize)
                .map_or(wasm_bindgen::JsValue::NULL, |text| text.as_str().into())
        })
        .into_js_value(),
    );
    #[cfg(feature = "sort")]
    {
        set(
            SOURCE_ROW_HOOK,
            Closure::<dyn Fn(f64) -> f64>::new(move |row: f64| source_row(row as u64) as f64)
                .into_js_value(),
        );
        set(
            DRAINED_HOOK,
            Closure::<dyn Fn() -> f64>::new(move || drained() as f64).into_js_value(),
        );
    }
    type Update = Box<dyn FnOnce(&mut Host, &mut Window, &mut Context<Host>)>;
    let (app, host, handle) = (cx.to_async(), cx.weak_entity(), window.window_handle());
    let enter = move |update: Update| {
        let (mut cx, host) = (app.clone(), host.clone());
        app.foreground_executor()
            .spawn(async move {
                let _ = cx.update_window(handle, |_, window, cx| {
                    host.update(cx, |host, cx| update(host, window, cx))
                });
            })
            .detach();
    };
    #[cfg(feature = "sort")]
    {
        let on_sort = enter.clone();
        set(
            SORT_HOOK,
            Closure::<dyn Fn(f64, String) -> bool>::new(move |column: f64, direction: String| {
                use seiza_tall_table::{Sort, SortDirection};
                let direction = match direction.as_str() {
                    "ascending" => Some(SortDirection::Ascending),
                    "descending" => Some(SortDirection::Descending),
                    _ => None,
                };
                // A whole column in range, or nothing is sent: the table's
                // own refusal is a debug assertion.
                let sort = match direction {
                    None => None,
                    Some(direction) => {
                        if column.fract() != 0.0 || !(0.0..columns as f64).contains(&column) {
                            return false;
                        }
                        Some(Sort::new(column as usize, direction))
                    }
                };
                on_sort(Box::new(move |host, _, cx| {
                    // Every column sortable: only the source can refuse,
                    // and its refusal leaves the order, which the scripts
                    // read.
                    host.table
                        .update(cx, |table, cx| drop(table.set_sort(sort, cx)));
                }));
                true
            })
            .into_js_value(),
        );
    }
    #[cfg(feature = "copy")]
    copy_hooks(set, enter);
}

/// `copy`'s hooks: [`HEAP_HOOK`], [`SELECT_HOOK`], [`CLOSE_HOOK`].
#[cfg(all(feature = "copy", target_family = "wasm"))]
fn copy_hooks(
    set: impl Fn(&'static str, wasm_bindgen::JsValue),
    enter: impl Fn(Box<dyn FnOnce(&mut Host, &mut Window, &mut Context<Host>)>) + Clone + 'static,
) {
    use seiza_tall_table::TallTableSelection;
    use wasm_bindgen::closure::Closure;

    set(
        HEAP_HOOK,
        Closure::<dyn Fn() -> f64>::new(|| {
            core::arch::wasm32::memory_size::<0>() as f64 * 65_536.0
        })
        .into_js_value(),
    );
    let on_select = enter.clone();
    set(
        SELECT_HOOK,
        Closure::<dyn Fn(String, f64, f64, f64, f64)>::new(
            move |kind: String,
                  anchor_row: f64,
                  anchor_column: f64,
                  head_row: f64,
                  head_column: f64| {
                let (anchor, head) = (
                    (anchor_row as u64, anchor_column as usize),
                    (head_row as u64, head_column as usize),
                );
                let selection = match kind.as_str() {
                    "rows" => Some(TallTableSelection::Rows { anchor, head }),
                    "columns" => Some(TallTableSelection::Columns { anchor, head }),
                    "cells" => Some(TallTableSelection::Cells { anchor, head }),
                    _ => None,
                };
                // Focused as a press would: a script's paste elsewhere took
                // the focus.
                on_select(Box::new(move |host, window, cx| {
                    let focus = host.table.read(cx).focus_handle().clone();
                    window.focus(&focus, cx);
                    host.table
                        .update(cx, |table, cx| table.select(selection, cx));
                }));
            },
        )
        .into_js_value(),
    );
    set(
        CLOSE_HOOK,
        Closure::<dyn Fn()>::new(move || enter(Box::new(|host, _, cx| host.close(cx))))
            .into_js_value(),
    );
}

/// What the host does with `live`, and with `follow`, which turns it on.
#[cfg(feature = "live")]
#[derive(Debug, Clone, Copy, Default)]
pub struct Live {
    /// The tail feed (`follow`).
    #[cfg(feature = "follow")]
    pub tail: Tail,
    /// `?live=<updates/s>`: that many visible rows a second change ([`Feed`]).
    pub feed: Option<f64>,
    /// `?flash` (with `custom-cells`): every float column flashes a change
    /// (`rows::with_flash`).
    #[cfg(feature = "custom-cells")]
    pub flash: bool,
}

/// What the host does with `follow`: the tail feed.
#[cfg(feature = "follow")]
#[derive(Debug, Clone, Copy, Default)]
pub struct Tail {
    /// `?rows=<n>`: the rows at open (the shape's without it).
    pub rows: Option<u64>,
    /// `?append=<rows/s>`: that many rows appended a second ([`Appends`]).
    pub append: Option<f64>,
    /// `?follow`: `follow()` at open.
    pub follow: bool,
}

/// Events at `rate` a second, counted out over the time that passes: a
/// fraction of one carried over (both feeds').
#[cfg(feature = "live")]
struct Rate {
    rate: f64,
    /// Due but not sent: a fraction of one.
    owed: f64,
}

#[cfg(feature = "live")]
impl Rate {
    fn new(rate: f64) -> Self {
        Self { rate, owed: 0.0 }
    }

    /// How many are due after `elapsed`. A gap past `FEED_CATCH_UP` (a
    /// hidden tab's throttled timers) sends that much, not a backlog.
    fn due(&mut self, elapsed: Duration) -> u64 {
        self.owed += self.rate * elapsed.min(FEED_CATCH_UP).as_secs_f64();
        let count = self.owed.floor();
        self.owed -= count;
        count as u64
    }
}

/// Runs `tick` with the time since the last tick about every frame
/// ([`FEED_EVERY`]), until the task drops (both feeds').
#[cfg(feature = "live")]
fn every_frame(
    cx: &mut Context<Host>,
    mut tick: impl FnMut(Duration, &mut AsyncApp) + 'static,
) -> Task<()> {
    cx.spawn(async move |_, cx| {
        let mut last = cx.background_executor().now();
        loop {
            cx.background_executor().timer(FEED_EVERY).await;
            let now = cx.background_executor().now();
            tick(now - last, cx);
            last = now;
        }
    })
}

/// The bare host's tail feed (`follow`): `rate` rows a second appended to
/// the source, a batch about every frame, one `set_rows` each. The rows are
/// a function of their index already, so the source needs only its count.
#[cfg(feature = "follow")]
pub struct Appends {
    rate: Rate,
}

#[cfg(feature = "follow")]
impl Appends {
    pub fn new(rate: f64) -> Self {
        Self {
            rate: Rate::new(rate),
        }
    }

    /// How many rows `elapsed` appends.
    pub fn batch(&mut self, elapsed: Duration) -> u64 {
        self.rate.due(elapsed)
    }

    /// Appends a batch to `table` about every frame, until the task drops.
    fn start(mut self, table: Entity<Table>, cx: &mut Context<Host>) -> Task<()> {
        every_frame(cx, move |elapsed, cx| {
            let count = self.batch(elapsed);
            if count == 0 {
                return;
            }
            #[cfg(target_family = "wasm")]
            let start = seiza::marks::now();
            let rows = table.update(cx, |table, cx| {
                let rows = table.rows() + count;
                table.set_rows(rows, cx);
                rows
            });
            #[cfg(target_family = "wasm")]
            {
                tall_table_bridge::js::set_global(APPENDED_GLOBAL, &(rows as f64).into());
                seiza::marks::mark_at(APPENDED_MARK, start);
            }
            #[cfg(not(target_family = "wasm"))]
            let _ = rows;
        })
    }
}

/// The bare host's feed (`live`): `rate` updates a second to random visible
/// rows, seeded, sent in a batch about every frame. Each update bumps its
/// row's version in the source and invalidates the row (each row once a
/// batch), so a re-read answers new floats.
#[cfg(feature = "live")]
pub struct Feed {
    rate: Rate,
    rng: u64,
}

#[cfg(feature = "live")]
impl Feed {
    pub fn new(rate: f64) -> Self {
        Self {
            rate: Rate::new(rate),
            rng: FEED_SEED,
        }
    }

    /// splitmix64.
    fn next(&mut self) -> u64 {
        self.rng = self.rng.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.rng;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }

    /// The rows `elapsed`'s updates change, among `visible`, each once, in
    /// the order first picked.
    pub fn batch(&mut self, elapsed: Duration, visible: std::ops::Range<u64>) -> Vec<u64> {
        let count = self.rate.due(elapsed);
        let span = visible.end.saturating_sub(visible.start);
        let mut rows: Vec<u64> = Vec::new();
        if span == 0 {
            return rows;
        }
        for _ in 0..count {
            let row = visible.start + self.next() % span;
            if !rows.contains(&row) {
                rows.push(row);
            }
        }
        rows
    }

    /// Sends a batch to `table` about every frame, until the task drops.
    fn start(mut self, table: Entity<Table>, cx: &mut Context<Host>) -> Task<()> {
        every_frame(cx, move |elapsed, cx| {
            let sent = table.update(cx, |table, cx| {
                let rows = self.batch(elapsed, table.visible_rows());
                // After the feed's own picking: from here on, the
                // source's and the table's work.
                #[cfg(target_family = "wasm")]
                let start = seiza::marks::now();
                #[cfg(not(target_family = "wasm"))]
                let start = 0.0;
                let mut generation = None;
                for row in rows {
                    table.delegate_mut().bump(row);
                    generation = Some(table.invalidate_rows(row..row + 1, cx));
                }
                generation.map(|generation| (generation, start))
            });
            #[cfg(target_family = "wasm")]
            if let Some((generation, start)) = sent {
                tall_table_bridge::js::set_global(INVALIDATED_GLOBAL, &(generation as f64).into());
                seiza::marks::mark_at(INVALIDATED_MARK, start);
            }
            #[cfg(not(target_family = "wasm"))]
            let _ = sent;
        })
    }
}

impl Render for Host {
    #[cfg(not(feature = "copy"))]
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        div().size_full().p_4().child(TallTable::new(&self.table))
    }

    /// With `copy`, the host's confirmed copy on Cmd+Shift+C.
    #[cfg(feature = "copy")]
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        div()
            .size_full()
            .p_4()
            .key_context(HOST_CONTEXT)
            .on_action(cx.listener(|host, _: &CopyConfirmed, _, cx| {
                host.table.update(cx, |table, cx| {
                    let _ = table.copy(cx);
                });
            }))
            .child(TallTable::new(&self.table))
    }
}

#[cfg(all(test, feature = "live"))]
mod tests {
    use std::time::Duration;

    use super::Feed;

    #[cfg(feature = "follow")]
    #[test]
    fn the_tail_feed_appends_its_rate() {
        use super::Appends;
        let mut feed = Appends::new(10_000.0);
        let sent: u64 = (0..100)
            .map(|_| feed.batch(Duration::from_millis(16)))
            .sum();
        // 16 ms of 10k rows a second is 160 rows, every batch.
        assert_eq!(sent, 16_000);
        // A fraction is carried, not lost.
        let mut slow = Appends::new(10.0);
        assert_eq!(slow.batch(Duration::from_millis(50)), 0);
        assert_eq!(slow.batch(Duration::from_millis(50)), 1);
        // A long gap catches up on 100 ms.
        assert_eq!(Appends::new(1000.0).batch(Duration::from_secs(600)), 100);
    }

    #[test]
    fn the_feed_sends_its_rate_over_the_visible_rows() {
        let mut feed = Feed::new(1000.0);
        let mut sent = 0;
        for _ in 0..100 {
            let rows = feed.batch(Duration::from_millis(16), 200..228);
            assert!(rows.iter().all(|row| (200..228).contains(row)));
            let mut distinct = rows.clone();
            distinct.sort_unstable();
            distinct.dedup();
            assert_eq!(distinct.len(), rows.len(), "each row once a batch");
            sent += rows.len();
        }
        // 1,600 updates over 28 rows: about 15 distinct rows a batch.
        assert!((1200..=1600).contains(&sent), "{sent} rows");
        // Seeded: the same rows every run.
        let (mut a, mut b) = (Feed::new(50.0), Feed::new(50.0));
        assert_eq!(
            a.batch(Duration::from_millis(100), 0..28),
            b.batch(Duration::from_millis(100), 0..28)
        );
        // A fraction of an update is carried, not lost.
        let mut slow = Feed::new(10.0);
        assert!(slow.batch(Duration::from_millis(50), 0..28).is_empty());
        assert_eq!(slow.batch(Duration::from_millis(50), 0..28).len(), 1);
        assert!(
            Feed::new(1000.0)
                .batch(Duration::from_secs(1), 5..5)
                .is_empty()
        );
        // A long gap catches up on 100 ms, not on all of it.
        let rows = Feed::new(1000.0).batch(Duration::from_secs(600), 0..1_000_000);
        assert!((90..=100).contains(&rows.len()), "{} rows", rows.len());
    }
}
