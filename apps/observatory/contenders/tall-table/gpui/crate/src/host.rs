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
                let _ = this.update_in(cx, |this, window, cx| {
                    this.load = match opened {
                        Ok((summary, _)) => {
                            let columns = scene::columns(&summary.columns, &scene);
                            let table = cx.new(|cx| {
                                let mut table = Table::new(
                                    scene::rows(engine, &scene),
                                    columns,
                                    summary.rows,
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
                    cx.notify();
                });
            }
        });
        self.load = Load::Opening { _task: task, sent };
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
