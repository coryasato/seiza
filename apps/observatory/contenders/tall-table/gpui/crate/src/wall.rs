//! The monitoring wall's host, in the bare host's place on the wall level
//! (`lib.rs`: `use wall as host`, so the contract and the feed reach it as
//! `crate::host::Host`): the stop's N tables in one window, each a desk of
//! 50 rows over one store (`scene::wall`), laid out in the stop's grid.
//! Until the file is open, the frame holds the bare host's one status line
//! (the page's placeholder shell copies that first frame).
//!
//! The grid: two rows of N / 2 tables, the scenario's gap between them and
//! from the edge, on the sidebar's color, each table a title row (its desk)
//! over the table. A frame narrower than the grid's `one_column_below` (a
//! phone's) shows one column of tables, each a title, its header, and the
//! grid's `phone_rows`, and scrolls that column from a title or a gap only:
//! the table doesn't stop a wheel or a swipe over it, so a scroll from
//! anything holding the tables would move with the table under the finger
//! (`docs/DECISIONS.md`, "Page").
//!
//! The marks across the tables (`docs/contender-contract.md`): `filled`
//! right after a frame in which every table's visible rows hold real data,
//! each time that becomes true; with `?measure`, `refreshed` right after
//! each frame that draws any table's re-read, `__contenderRefreshed` each
//! table's highest generation drawn; each batch's per-table generations and
//! visible mask (`feed::record_wall`); and with `?readout` the ring pooled
//! across the tables (`readout::drawn_wall`). The first table's events
//! publish the rest of the contract, as the bare host's one table does.

use std::cell::Cell;
use std::rc::Rc;

use gpui_kit::component::ActiveTheme as _;
use gpui_kit::*;
use seiza_duckdb::EngineStatus;
use seiza_tall_table::{TallTable, TallTableState};

use crate::scene::wall::Grid;
use crate::scene::{self, Scene};

/// The window's title.
#[cfg_attr(
    not(target_family = "wasm"),
    expect(dead_code, reason = "only the web build opens a window")
)]
pub const TITLE: &str = "Tall table: GPUI";

pub type Table = TallTableState<scene::Rows>;

thread_local! {
    /// The desks' names, in the order a stop takes them (`desks`).
    static DESKS: std::cell::RefCell<Vec<SharedString>> = const { std::cell::RefCell::new(Vec::new()) };
    /// The tables shown, for `__contender.state`'s `tables`.
    static TABLES: Cell<usize> = const { Cell::new(0) };
}

/// The desks' names, in the scenario's order (`scenarios.ts`'s
/// `MONITORING_WALL.desks`): a table's title. Called by the JS host before
/// `start`.
#[cfg(target_family = "wasm")]
#[wasm_bindgen::prelude::wasm_bindgen(js_name = wallDesks)]
pub fn desks(names: Vec<String>) {
    DESKS.set(names.into_iter().map(SharedString::from).collect());
}

/// The tables shown (0 before the open).
#[cfg_attr(
    not(target_family = "wasm"),
    expect(dead_code, reason = "only the web build publishes the state")
)]
pub fn tables() -> usize {
    TABLES.get()
}

#[cfg_attr(
    not(target_family = "wasm"),
    expect(dead_code, reason = "only the web build opens the file")
)]
enum Load {
    /// The engine is still loading (or failed: the line says so).
    Waiting,
    /// Registering the file, reading its summary, then the shown desks'
    /// rows; `sent` are the queries it sent, canceled if it's replaced or
    /// fails.
    Opening {
        _task: Task<()>,
        #[cfg(target_family = "wasm")]
        sent: Sent,
    },
    Open(Desks),
    Failed(SharedString),
}

/// The queries an open has sent, so they can be canceled.
#[cfg(target_family = "wasm")]
type Sent = std::rc::Rc<std::cell::RefCell<Vec<seiza_duckdb::RequestId>>>;

/// The stop's tables over one store.
#[cfg_attr(
    not(target_family = "wasm"),
    expect(dead_code, reason = "only the web build opens the file")
)]
struct Desks {
    tables: Vec<Entity<Table>>,
    store: Rc<scene::wall::WallStore>,
    /// Each table's visible rows real, as its last frame showed them.
    filled: Vec<bool>,
    /// Every table was filled at the last change.
    all_filled: bool,
    /// Each table's highest generation drawn.
    drawn: Vec<u64>,
    /// With `?measure`: `__contenderRefreshed`, `drawn` as the frames raise it.
    #[cfg(target_family = "wasm")]
    refreshed: Option<js_sys::Array>,
    /// With `?cells`: `__contender.tables`, each table's drawn cells,
    /// columns, layout, and box (`desk_of`).
    #[cfg(target_family = "wasm")]
    probes: Option<js_sys::Array>,
    _subscriptions: Vec<Subscription>,
}

pub struct Host {
    #[cfg_attr(
        not(target_family = "wasm"),
        expect(dead_code, reason = "only the web build opens the file")
    )]
    data_url: String,
    /// What it opens, or why there's nothing to open (a scenario or stop
    /// this build doesn't have).
    scene: Result<Scene, SharedString>,
    load: Load,
    /// How far a phone's column of tables is scrolled down.
    scrolled: Pixels,
    _engine: Subscription,
}

impl Host {
    /// Opens `scene`'s file at `data_url` as soon as the engine is ready;
    /// with no scene, shows why and opens nothing.
    pub fn new(
        data_url: String,
        scene: Result<Scene, SharedString>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let engine = cx.observe_global_in::<EngineStatus>(window, |this, window, cx| {
            #[cfg(target_family = "wasm")]
            {
                if matches!(this.load, Load::Waiting)
                    && matches!(cx.global::<EngineStatus>(), EngineStatus::Ready { .. })
                {
                    this.open(window, cx);
                }
                if matches!(
                    cx.global::<EngineStatus>(),
                    EngineStatus::Failed(_) | EngineStatus::Stopped(_)
                ) {
                    crate::contract::failed();
                }
            }
            #[cfg(not(target_family = "wasm"))]
            let _ = (this, window);
            cx.notify();
        });
        #[cfg(target_family = "wasm")]
        crate::contract::install(cx.weak_entity(), window.window_handle(), cx);
        let load = match &scene {
            Ok(_) => Load::Waiting,
            Err(message) => {
                #[cfg(target_family = "wasm")]
                crate::contract::failed();
                Load::Failed(message.clone())
            }
        };
        Self {
            data_url,
            scene,
            load,
            scrolled: px(0.),
            _engine: engine,
        }
    }

    /// Opens the file, closing the tables shown: registers it, reads its
    /// summary, then the shown desks' rows in one read, which seeds the
    /// store, then shows a table a desk over it.
    #[cfg(target_family = "wasm")]
    pub(crate) fn open(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        use seiza_duckdb::tall_table::{ParquetFile, QueryRows};
        use seiza_duckdb::{Engine, FileSource};
        use seiza_tall_table::TallTableDelegate as _;

        let Ok(scene) = self.scene.clone() else {
            crate::contract::failed();
            return;
        };
        let engine = cx.global::<Engine>().clone();
        match &self.load {
            Load::Open(desks) => {
                for table in &desks.tables {
                    table.update(cx, |table, cx| table.close(cx));
                }
            }
            Load::Opening { sent, .. } => {
                for request in sent.borrow().iter() {
                    engine.cancel(*request);
                }
            }
            Load::Waiting | Load::Failed(_) => {}
        }
        // The feed's ticks would miss the new store: a reopen ends it.
        crate::feed::stop();
        crate::contract::opening();
        let url = self.data_url.clone();
        let sent = Sent::default();
        let task = cx.spawn_in(window, {
            let sent = sent.clone();
            async move |this, cx| {
                let opened = {
                    let sent = sent.clone();
                    seiza_duckdb::tall_table::open_parquet(
                        &engine,
                        &scene.file,
                        FileSource::Url(url),
                        &[],
                        move |id| sent.borrow_mut().push(id),
                    )
                    .await
                }
                .map_err(|error| error.to_string())
                .and_then(|(summary, _)| {
                    scene::wall::check(&summary.columns, summary.rows, &scene.wall)
                        .map(|()| summary)
                });
                // The shown desks' rows, one read through the page SQL: the
                // store's seed, and every table's rows after it.
                let read = opened.map(|summary| {
                    let mut rows =
                        QueryRows::new(engine.clone(), ParquetFile::new(scene.file.clone()));
                    let read = this.update(cx, |_, cx| rows.load_page(0..scene.wall.shown(), cx));
                    (summary, read)
                });
                let seeded = match read {
                    Ok((summary, Ok((request, page)))) => {
                        sent.borrow_mut().push(request);
                        page.await
                            .map_err(|error| match error {
                                seiza_tall_table::PageError::Failed { message, .. } => message,
                                seiza_tall_table::PageError::Cancelled => {
                                    "its rows' read was canceled".into()
                                }
                            })
                            .and_then(|page| {
                                scene::wall::WallStore::seed(
                                    &page,
                                    scene.wall.shown() as usize,
                                    &scene.wall,
                                )
                            })
                            .map(|store| (summary, store))
                    }
                    // The host is gone.
                    Ok((_, Err(_))) => return,
                    Err(error) => Err(error),
                };
                let _ = this.update_in(cx, |this, window, cx| {
                    this.load = match seeded {
                        Ok((summary, store)) => {
                            let file: Vec<_> = summary
                                .columns
                                .iter()
                                .map(|info| info.tall_table_column())
                                .collect();
                            let desks = Desks::new(&scene, &file, Rc::new(store), cx);
                            let focus = desks.tables[0].read(cx).focus_handle().clone();
                            window.focus(&focus, cx);
                            Load::Open(desks)
                        }
                        Err(error) => {
                            // A failed DESCRIBE or read leaves the other queries running.
                            for request in sent.borrow().iter() {
                                engine.cancel(*request);
                            }
                            crate::contract::failed();
                            Load::Failed(error.into())
                        }
                    };
                    cx.notify();
                });
            }
        });
        self.load = Load::Opening { _task: task, sent };
        cx.notify();
    }

    /// Folds a batch of the feed into the store, every tick or none, then
    /// invalidates each table's ticked rows: each table re-reads them from
    /// the store in this turn, and the next frame draws them all. A batch
    /// the store refuses fails the contender.
    #[cfg(target_family = "wasm")]
    pub(crate) fn feed(&mut self, batch: &[u8], cx: &mut Context<Self>) {
        use crate::scene::wall::{DESK_ROWS, MOST_TABLES};

        let Load::Open(desks) = &self.load else {
            return;
        };
        let (folded, ticked) = match desks.store.fold(batch) {
            Ok(folded) => folded,
            Err(error) => {
                self.fail_feed(format!("the store refused a batch: {error}").into(), cx);
                return;
            }
        };
        let mut generations = [0; MOST_TABLES];
        let mut visible = 0u32;
        for (desk, table) in desks.tables.iter().enumerate() {
            let ticked = &ticked[desk * DESK_ROWS..(desk + 1) * DESK_ROWS];
            table.update(cx, |table, cx| {
                let shown = table.visible_rows();
                let mut row = 0;
                // Each run of ticked rows, one invalidation.
                while row < ticked.len() {
                    if !ticked[row] {
                        row += 1;
                        continue;
                    }
                    let start = row;
                    while row < ticked.len() && ticked[row] {
                        row += 1;
                    }
                    let rows = start as u64..row as u64;
                    if rows.start < shown.end && shown.start < rows.end {
                        visible |= 1 << desk;
                    }
                    generations[desk] = table.invalidate_rows(rows, cx);
                }
            });
        }
        crate::feed::record_wall(folded, &generations[..desks.tables.len()], visible);
    }

    /// The feed can't go on: the tables close and the failure shows.
    #[cfg(target_family = "wasm")]
    pub(crate) fn fail_feed(&mut self, message: SharedString, cx: &mut Context<Self>) {
        crate::feed::stop();
        if let Load::Open(desks) = &self.load {
            for table in &desks.tables {
                table.update(cx, |table, cx| table.close(cx));
            }
        }
        self.load = Load::Failed(message);
        crate::contract::failed();
        cx.notify();
    }

    /// The replay's jump: none on the wall (a desk's 50 rows give it no
    /// meaning; the JS host's `jump` rejects), so nothing moves.
    #[cfg(target_family = "wasm")]
    pub(crate) fn jump(&mut self, _fraction: f64, _cx: &mut Context<Self>) {}

    /// A table's event: the marks across the tables, the ring, the probes.
    #[cfg(target_family = "wasm")]
    fn on_table(
        &mut self,
        desk: usize,
        event: &seiza_tall_table::TallTableEvent,
        cx: &mut Context<Self>,
    ) {
        use seiza_tall_table::TallTableEvent;

        let Load::Open(desks) = &mut self.load else {
            return;
        };
        let started = match event {
            TallTableEvent::Filled { .. } => desks.set_filled(desk, true),
            TallTableEvent::Probe(probe) => {
                desks.set_filled(desk, crate::contract::probe_filled!(probe))
            }
            TallTableEvent::Refreshed { generation, .. } => {
                let drawn = &mut desks.drawn[desk];
                *drawn = (*drawn).max(*generation);
                crate::readout::drawn_wall(&desks.drawn);
                if let Some(refreshed) = &desks.refreshed {
                    refreshed.set(desk as u32, (desks.drawn[desk] as f64).into());
                    refreshed_after_frame();
                }
                Ok(())
            }
            TallTableEvent::Cells(cells) => {
                if let Some(probes) = &desks.probes {
                    set_probe(probes, desk, "cells", &tall_table_bridge::js::cells(cells));
                }
                Ok(())
            }
            TallTableEvent::Layout(layout) => {
                if let Some(probes) = &desks.probes {
                    set_probe(
                        probes,
                        desk,
                        "columns",
                        &tall_table_bridge::js::columns(&layout.columns),
                    );
                    // Where the table's cells are in the window: the grid
                    // the cross-side check compares (`perf/wall.ts`). Three
                    // numbers, not the bridge's whole layout, whose
                    // advances would ride in every load.
                    let at = js_sys::Object::new();
                    for (key, value) in [
                        ("left", layout.left),
                        ("top", layout.top),
                        ("rowHeight", layout.row_height),
                    ] {
                        let _ = js_sys::Reflect::set(&at, &key.into(), &f64::from(value).into());
                    }
                    set_probe(probes, desk, "layout", &at);
                }
                Ok(())
            }
            _ => Ok(()),
        };
        if let Err(message) = started {
            self.fail_feed(format!("The feed didn't start: {message}").into(), cx);
        }
    }

    /// Scrolls a phone's column of tables by a wheel or a swipe over a
    /// title or a gap.
    fn scroll_column(&mut self, event: &ScrollEvent, window: &mut Window, cx: &mut Context<Self>) {
        let delta = event.delta.pixel_delta(window.line_height()).y;
        let most = self.column_overflow(window);
        let scrolled = (self.scrolled - delta).clamp(px(0.), most);
        if scrolled != self.scrolled {
            self.scrolled = scrolled;
            cx.notify();
        }
    }

    /// How far a phone's column can scroll: its height past the window's.
    fn column_overflow(&self, window: &Window) -> Pixels {
        let (Ok(scene), Load::Open(desks)) = (&self.scene, &self.load) else {
            return px(0.);
        };
        let grid = &scene.wall.grid;
        let n = desks.tables.len() as f32;
        let height = grid.gap * (n + 1.) + phone_table(grid) * n;
        (px(height) - window.viewport_size().height).max(px(0.))
    }

    /// What's loading, or what failed, while there are no tables.
    fn status(&self, cx: &App) -> (SharedString, Hsla) {
        let theme = cx.theme();
        let file = self.scene.as_ref().map_or("the file", |scene| &scene.file);
        match (&self.load, cx.try_global::<EngineStatus>()) {
            (Load::Failed(message), _) => (
                format!("Couldn't open {file}: {message}").into(),
                theme.danger,
            ),
            (Load::Opening { .. }, _) => {
                (format!("Opening {file}…").into(), theme.muted_foreground)
            }
            (_, Some(EngineStatus::Failed(message) | EngineStatus::Stopped(message))) => (
                format!("The engine didn't load: {message}").into(),
                theme.danger,
            ),
            _ => ("Engine loading…".into(), theme.muted_foreground),
        }
    }
}

/// A table's height in a phone's column: its title, its header, and the
/// grid's rows whole, above the room the table keeps for its horizontal
/// scrollbar, inside its 1 px border.
fn phone_table(grid: &Grid) -> f32 {
    let bar = f32::from(gpui_kit::component::scroll::Scrollbar::width());
    grid.title + grid.row_height * (1 + grid.phone_rows) as f32 + bar + 2.
}

impl Desks {
    /// The stop's tables over `store`, each at the grid's rows, text, and
    /// widths, each reporting to the host.
    #[cfg(target_family = "wasm")]
    fn new(
        scene: &Scene,
        file: &[seiza_tall_table::TallTableColumn],
        store: Rc<scene::wall::WallStore>,
        cx: &mut Context<Host>,
    ) -> Self {
        let wall = &scene.wall;
        let columns = scene::wall::columns(file, wall);
        let tables: Vec<Entity<Table>> = (0..wall.tables)
            .map(|desk| {
                cx.new(|cx| {
                    let mut table = Table::new(
                        scene::wall::DeskRows::new(desk, store.clone()),
                        columns.clone(),
                        scene::wall::DESK_ROWS as u64,
                        seiza_tall_table::Paging::default(),
                        cx,
                    )
                    // The bare host's: the probes on, always.
                    .probe_frames(true)
                    .probe_cells(crate::contract::probing_cells());
                    table.set_density(
                        seiza_tall_table::Density {
                            row_height: px(wall.grid.row_height),
                            text_size: px(wall.grid.text_size).into(),
                        },
                        cx,
                    );
                    table
                })
            })
            .collect();
        // The first table publishes the contract's state, targets, and
        // probes, as the bare host's one table does; the marks across the
        // tables are the host's.
        crate::contract::watch(&tables[0], cx);
        let subscriptions = tables
            .iter()
            .enumerate()
            .map(|(desk, table)| {
                cx.subscribe(table, move |host: &mut Host, _, event, cx| {
                    host.on_table(desk, event, cx)
                })
            })
            .collect();
        TABLES.set(tables.len());
        let measuring = crate::contract::measuring();
        let refreshed = measuring.then(|| {
            let refreshed: js_sys::Array = (0..tables.len())
                .map(|_| wasm_bindgen::JsValue::from(0))
                .collect();
            let _ = js_sys::Reflect::set(
                &js_sys::global(),
                &crate::contract::REFRESHED_GLOBAL.into(),
                &refreshed,
            );
            refreshed
        });
        let probes = crate::contract::probing_cells().then(|| {
            let probes: js_sys::Array = (0..tables.len()).map(|_| js_sys::Object::new()).collect();
            crate::contract::set_on_contender("tables", &probes);
            probes
        });
        Self {
            filled: vec![false; tables.len()],
            all_filled: false,
            drawn: vec![0; tables.len()],
            refreshed,
            probes,
            tables,
            store,
            _subscriptions: subscriptions,
        }
    }

    /// Table `desk`'s visible rows real or not, as its frame shows them:
    /// the frame that leaves no table unfilled marks `filled`, and the
    /// first such frame starts the feed (its failure returned).
    #[cfg(target_family = "wasm")]
    fn set_filled(&mut self, desk: usize, filled: bool) -> Result<(), String> {
        self.filled[desk] = filled;
        let all = self.filled.iter().all(|&filled| filled);
        let became = all && !self.all_filled;
        self.all_filled = all;
        if !became {
            return Ok(());
        }
        drop(seiza::mark_after_current_task(crate::contract::FILLED_MARK));
        crate::feed::start_once()
    }
}

thread_local! {
    /// A `contender:refreshed` is queued after the current task.
    static REFRESHED_QUEUED: Cell<bool> = const { Cell::new(false) };
}

/// Marks `contender:refreshed` right after the current task (the frame's),
/// once however many tables drew a re-read in it: the mark is seiza's, set
/// in a microtask queued here, which also lets the next frame mark again.
/// `seiza::mark_after_current_task` has no hook to reset that guard, and
/// giving it one moves every app's wasm (`docs/DECISIONS.md`, "GPUI
/// contender"). Without `queueMicrotask` it marks at once, a guard never
/// left set.
#[cfg(target_family = "wasm")]
fn refreshed_after_frame() {
    use wasm_bindgen::JsCast as _;

    if REFRESHED_QUEUED.replace(true) {
        return;
    }
    let marked = wasm_bindgen::closure::Closure::once_into_js(|| {
        REFRESHED_QUEUED.set(false);
        seiza::marks::mark(crate::contract::REFRESHED_MARK);
    });
    let queued = js_sys::Reflect::get(&js_sys::global(), &"queueMicrotask".into())
        .and_then(|queue| queue.dyn_into::<js_sys::Function>())
        .and_then(|queue| queue.call1(&wasm_bindgen::JsValue::UNDEFINED, &marked));
    if queued.is_err() {
        REFRESHED_QUEUED.set(false);
        seiza::marks::mark(crate::contract::REFRESHED_MARK);
    }
}

/// Sets `__contender.tables[desk][key]`.
#[cfg(target_family = "wasm")]
fn set_probe(probes: &js_sys::Array, desk: usize, key: &str, value: &wasm_bindgen::JsValue) {
    let _ = js_sys::Reflect::set(&probes.get(desk as u32), &key.into(), value);
}

impl Render for Host {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        #[cfg(target_family = "wasm")]
        crate::contract::drew();
        let grid = match (&self.scene, &self.load) {
            (Ok(scene), Load::Open(_)) => Some(scene.wall.grid),
            _ => None,
        };
        if let Some(grid) = grid {
            let one_column = window.viewport_size().width < px(grid.one_column_below);
            if one_column {
                // A wider window since the last scroll keeps it in range.
                self.scrolled = self.scrolled.min(self.column_overflow(window));
            }
            if let Load::Open(desks) = &self.load {
                return DESKS.with_borrow(|titles| {
                    if one_column {
                        self.column(&grid, &desks.tables, titles, cx)
                            .into_any_element()
                    } else {
                        grid_of(&grid, &desks.tables, titles, cx).into_any_element()
                    }
                });
            }
        }
        let (status, color) = self.status(cx);
        let theme = cx.theme();
        // The bare host's first frame: the table's own frame, empty.
        div()
            .size_full()
            .p_4()
            .child(
                div()
                    .size_full()
                    .px_3()
                    .py_2()
                    .bg(theme.tokens.table)
                    .rounded(theme.radius)
                    .border_1()
                    .border_color(theme.border)
                    .text_sm()
                    .text_color(color)
                    .child(status),
            )
            .into_any_element()
    }
}

impl Host {
    /// A phone's column: each table a title, its header, and the grid's
    /// rows, at most the grid's column width and centered, scrolled from a
    /// title or a gap (the sides' too).
    fn column(
        &self,
        grid: &Grid,
        tables: &[Entity<Table>],
        titles: &[SharedString],
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let gap = px(grid.gap);
        let foreground = cx.theme().foreground;
        let mut column = div()
            .absolute()
            .left_0()
            .right_0()
            .top(-self.scrolled)
            .flex()
            .flex_col()
            .child(
                div()
                    .h(gap)
                    .flex_none()
                    .on_scroll(cx.listener(Self::scroll_column)),
            );
        for (desk, table) in tables.iter().enumerate() {
            // The sides share what the table leaves, at least the gap each:
            // room to scroll the column from.
            let side = |cx: &mut Context<Self>| {
                div()
                    .flex_1()
                    .min_w(gap)
                    .on_scroll(cx.listener(Self::scroll_column))
            };
            let title =
                title(grid, desk, titles, foreground).on_scroll(cx.listener(Self::scroll_column));
            column = column
                .child(
                    div()
                        .h(px(phone_table(grid)))
                        .flex_none()
                        .flex()
                        .child(side(cx))
                        // The table at its width, shrinking only below it.
                        .child(
                            desk_of(title, table, desk)
                                .flex_grow_0()
                                .flex_basis(px(grid.column_width)),
                        )
                        .child(side(cx)),
                )
                .child(
                    div()
                        .h(gap)
                        .flex_none()
                        .on_scroll(cx.listener(Self::scroll_column)),
                );
        }
        div()
            .size_full()
            .relative()
            .overflow_hidden()
            .bg(cx.theme().tokens.sidebar)
            .child(column)
    }
}

/// The grid: two rows of N / 2 tables.
fn grid_of(
    grid: &Grid,
    tables: &[Entity<Table>],
    titles: &[SharedString],
    cx: &App,
) -> impl IntoElement {
    let theme = cx.theme();
    let gap = px(grid.gap);
    let across = tables.len().div_ceil(2);
    div()
        .size_full()
        .p(gap)
        .gap(gap)
        .flex()
        .flex_col()
        .bg(theme.tokens.sidebar)
        .children((0..2).map(|line| {
            div().flex_1().min_h_0().flex().gap(gap).children(
                tables
                    .iter()
                    .enumerate()
                    .skip(line * across)
                    .take(across)
                    .map(|(desk, table)| {
                        desk_of(title(grid, desk, titles, theme.foreground), table, desk)
                    }),
            )
        }))
}

/// A desk's title row: its name.
fn title(grid: &Grid, desk: usize, titles: &[SharedString], color: Hsla) -> Div {
    div()
        .h(px(grid.title))
        .flex_none()
        .px_2()
        .flex()
        .items_center()
        .text_size(px(grid.text_size))
        .text_color(color)
        .child(titles.get(desk).cloned().unwrap_or_default())
}

/// A desk: its title over its table, sharing its row's width. With
/// `?cells`, the table's box in the window on `__contender.tables[desk]`.
fn desk_of(title: Div, table: &Entity<Table>, desk: usize) -> Div {
    let holder = probed(div().flex_1().min_h_0(), desk);
    div()
        .flex_1()
        .min_w_0()
        .h_full()
        .flex()
        .flex_col()
        .child(title)
        .child(holder.child(TallTable::new(table)))
}

/// `holder` (a desk's table's) with `?cells` reporting its table's box
/// (`probe_box`) at each prepaint.
#[cfg(target_family = "wasm")]
fn probed(holder: Div, desk: usize) -> Div {
    if !crate::contract::probing_cells() {
        return holder;
    }
    holder.on_children_prepainted(move |bounds, _, _| {
        if let Some(bounds) = bounds.first() {
            probe_box(desk, bounds);
        }
    })
}

#[cfg(not(target_family = "wasm"))]
fn probed(holder: Div, _desk: usize) -> Div {
    holder
}

/// Sets `__contender.tables[desk].box`, `[x, y, width, height]` in CSS px:
/// the table's frame, which the cross-side check compares
/// (`perf/wall.ts`).
#[cfg(target_family = "wasm")]
fn probe_box(desk: usize, bounds: &Bounds<Pixels>) {
    use js_sys::Reflect;
    let table = Reflect::get(&js_sys::global(), &"__contender".into())
        .and_then(|contender| Reflect::get(&contender, &"tables".into()))
        .and_then(|tables| Reflect::get_u32(&tables, desk as u32));
    let Ok(table) = table else { return };
    if !table.is_object() {
        return;
    }
    let at: js_sys::Array = [
        bounds.origin.x,
        bounds.origin.y,
        bounds.size.width,
        bounds.size.height,
    ]
    .into_iter()
    .map(|value| wasm_bindgen::JsValue::from(f64::from(f32::from(value))))
    .collect();
    let _ = Reflect::set(&table, &"box".into(), &at);
}
