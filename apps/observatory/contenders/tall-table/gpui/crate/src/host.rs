//! The bare host: one view, the table filling the window. Until the file is
//! open, the same frame the table draws holds one line saying what's
//! loading; the page's placeholder shell (`web/vite.config.ts`) copies that
//! first frame.

use gpui_kit::component::ActiveTheme as _;
use gpui_kit::*;
use seiza_duckdb::EngineStatus;
use seiza_tall_table::{TallTable, TallTableState};

use crate::scene::{self, Scene};

/// The window's title.
#[cfg_attr(
    not(target_family = "wasm"),
    expect(dead_code, reason = "only the web build opens a window")
)]
pub const TITLE: &str = "Tall table: GPUI";

pub type Table = TallTableState<scene::Rows>;

#[cfg_attr(
    not(target_family = "wasm"),
    expect(dead_code, reason = "only the web build opens the file")
)]
enum Load {
    /// The engine is still loading (or failed: the line says so).
    Waiting,
    /// Registering the file and reading its summary; `sent` are the
    /// queries it sent, cancelled if it's replaced or fails.
    Opening {
        _task: Task<()>,
        #[cfg(target_family = "wasm")]
        sent: Sent,
    },
    Open(Entity<Table>),
    Failed(SharedString),
}

/// The queries an open has sent, so they can be cancelled.
#[cfg(target_family = "wasm")]
type Sent = std::rc::Rc<std::cell::RefCell<Vec<seiza_duckdb::RequestId>>>;

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
            _engine: engine,
        }
    }

    /// Opens the file, closing the table shown: registers it, reads its
    /// summary from the footer, then shows a table over its rows.
    #[cfg(target_family = "wasm")]
    pub(crate) fn open(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        use seiza_duckdb::{Engine, FileSource};

        // No scene (a scenario or stop this build lacks): nothing to open,
        // and the failure is marked again for whoever asked.
        let Ok(scene) = self.scene.clone() else {
            crate::contract::failed();
            return;
        };
        let engine = cx.global::<Engine>().clone();
        match &self.load {
            Load::Open(table) => table.update(cx, |table, cx| table.close(cx)),
            // An open still running: its queries would compete with this
            // one's (and slow what's measured), so they're cancelled with it.
            Load::Opening { sent, .. } => {
                for request in sent.borrow().iter() {
                    engine.cancel(*request);
                }
            }
            Load::Waiting | Load::Failed(_) => {}
        }
        // The feed's ticks would miss the new store: a reopen ends it.
        #[cfg(feature = "market")]
        crate::feed::stop();
        // A replay starts over: its clock ends, and the new table's starts.
        #[cfg(feature = "tail")]
        crate::clock::stop();
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
                };
                let _ =
                    this.update_in(cx, |this, window, cx| {
                        // Market watch's file must be its instruments' columns.
                        #[cfg(feature = "market")]
                        let opened = opened.map_err(|error| error.to_string()).and_then(
                            |(summary, rest)| {
                                scene::market::check(&summary.columns, summary.rows, &scene.market)
                                    .map(|()| (summary, rest))
                            },
                        );
                        // Live tail's file must be the log's columns and rows.
                        #[cfg(feature = "tail")]
                        let opened = opened.map_err(|error| error.to_string()).and_then(
                            |(summary, rest)| {
                                scene::tail::check(&summary.columns, summary.rows)
                                    .map(|()| (summary, rest))
                            },
                        );
                        this.load = match opened {
                            Ok((summary, _)) => {
                                let columns = scene::columns(&summary.columns, &scene);
                                // A replay starts with no rows: the clock grows them.
                                #[cfg(feature = "tail")]
                                let rows = 0;
                                #[cfg(not(feature = "tail"))]
                                let rows = summary.rows;
                                let table = cx.new(|cx| {
                                    let mut table = Table::new(
                                        scene::rows(engine, &scene),
                                        columns,
                                        rows,
                                        seiza_tall_table::Paging::default(),
                                        cx,
                                    )
                                    // Always: the replay's fling reads the rows and
                                    // row height from the probes. Measured runs
                                    // have them on anyway (`?measure`'s state).
                                    .probe_frames(true)
                                    .probe_cells(crate::contract::probing_cells());
                                    scene::set_level(&mut table, &scene, cx);
                                    table
                                });
                                crate::contract::watch(&table, cx);
                                #[cfg(feature = "market")]
                                crate::feed::watch(&table, cx);
                                let focus = table.read(cx).focus_handle().clone();
                                window.focus(&focus, cx);
                                Load::Open(table)
                            }
                            Err(error) => {
                                // A failed DESCRIBE leaves the other queries running.
                                for request in sent.borrow().iter() {
                                    engine.cancel(*request);
                                }
                                crate::contract::failed();
                                Load::Failed(error.to_string().into())
                            }
                        };
                        // The file fetched whole, then the clock (`crate::clock`).
                        #[cfg(feature = "tail")]
                        if matches!(this.load, Load::Open(_)) {
                            crate::clock::watch(this, cx);
                        }
                        cx.notify();
                    });
            }
        });
        self.load = Load::Opening { _task: task, sent };
        cx.notify();
    }

    /// Folds a batch of the feed into the shown table's store, every tick
    /// or none, and invalidates each row it ticked: the table re-reads them
    /// from the store in this turn and draws them in the next frame. A
    /// batch the store refuses fails the contender.
    #[cfg(all(target_family = "wasm", feature = "market"))]
    pub(crate) fn feed(&mut self, batch: &[u8], cx: &mut Context<Self>) {
        let Load::Open(table) = &self.load else {
            return;
        };
        let table = table.clone();
        let store = table.read(cx).delegate().store().clone();
        let (folded, ticked) = match store.fold(batch) {
            Ok(folded) => folded,
            Err(error) => {
                self.fail_feed(format!("the store refused a batch: {error}").into(), cx);
                return;
            }
        };
        table.update(cx, |table, cx| {
            let visible = table.visible_rows();
            let (mut generation, mut seen) = (0, false);
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
                seen |= rows.start < visible.end && visible.start < rows.end;
                generation = table.invalidate_rows(rows, cx);
            }
            crate::feed::record(folded, generation, seen);
        });
    }

    /// Sets the clock's count of rows due on the shown table (live tail):
    /// following, the view moves on as their reads land.
    #[cfg(all(target_family = "wasm", feature = "tail"))]
    pub(crate) fn rows_due(&mut self, rows: u64, cx: &mut Context<Self>) {
        if let Load::Open(table) = &self.load {
            table.update(cx, |table, cx| table.set_rows(rows, cx));
        }
    }

    /// The feed (or live tail's clock) can't go on: the table closes and
    /// the failure shows.
    #[cfg(all(target_family = "wasm", any(feature = "market", feature = "tail")))]
    pub(crate) fn fail_feed(&mut self, message: SharedString, cx: &mut Context<Self>) {
        #[cfg(feature = "market")]
        crate::feed::stop();
        #[cfg(feature = "tail")]
        crate::clock::stop();
        if let Load::Open(table) = &self.load {
            table.update(cx, |table, cx| table.close(cx));
        }
        self.load = Load::Failed(message);
        crate::contract::failed();
        cx.notify();
    }

    /// Scrolls the shown table so `fraction` of its rows are above the top.
    #[cfg(target_family = "wasm")]
    pub(crate) fn jump(&mut self, fraction: f64, cx: &mut Context<Self>) {
        if let Load::Open(table) = &self.load {
            table.update(cx, |table, cx| {
                let last = table.rows().saturating_sub(1);
                let row = (fraction.clamp(0.0, 1.0) * table.rows() as f64) as u64;
                table.jump_to(row.min(last), cx);
            });
        }
    }

    /// What's loading, or what failed, while there's no table.
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

impl Render for Host {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        #[cfg(target_family = "wasm")]
        crate::contract::drew_probe_key();
        let body = div().size_full().p_4();
        if let Load::Open(table) = &self.load {
            return body.child(TallTable::new(table));
        }
        let (status, color) = self.status(cx);
        let theme = cx.theme();
        // The table's own frame (`TallTable`), empty.
        body.child(
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
    }
}
