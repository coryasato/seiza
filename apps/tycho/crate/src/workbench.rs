//! The workbench: Tycho's one window. Empty until a file or sample is
//! opened; then a header strip describes the file, above its rows.
//!
//! A file comes from a drop anywhere on the page, the file dialog, or the
//! sample button. Every open goes through the same pipeline (register, read
//! the footer's metadata, page rows: M3/M4). A new one replaces the current
//! one, whether it's still opening or already showing rows: its queries are
//! cancelled and its answers ignored.

use gpui_kit::component::button::{Button, ButtonVariants as _};
use gpui_kit::component::empty::{Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle};
use gpui_kit::component::tag::Tag;
use gpui_kit::component::{
    ActiveTheme as _, Disableable as _, Sizable as _, StyledExt as _, h_flex, v_flex,
};
use gpui_kit::prelude::FluentBuilder as _;
use gpui_kit::*;

use crate::dataset::{FileSummary, format_bytes, format_count};
use crate::engine::EngineStatus;
use crate::table::RowTable;

/// What's being opened or shown: the sample, or a file from this device.
#[derive(Debug, Clone, Copy, PartialEq)]
enum Origin {
    Sample,
    Device,
}

impl Origin {
    /// The `performance.mark`s and overlay rows an open reports under.
    #[cfg(target_family = "wasm")]
    fn marks(self) -> Marks {
        match self {
            Self::Sample => Marks {
                start: "tycho:sample-click",
                shown: "tycho:sample-shown",
                schema_metric: "Sample → schema",
                first_rows_metric: "Sample → first rows",
            },
            Self::Device => Marks {
                start: "tycho:file-open",
                shown: "tycho:file-shown",
                schema_metric: "File → schema",
                first_rows_metric: "File → first rows",
            },
        }
    }
}

#[cfg(target_family = "wasm")]
#[derive(Clone, Copy)]
struct Marks {
    /// The click, drop, or dialog choice.
    start: &'static str,
    /// Right after the first frame showing the summary.
    shown: &'static str,
    schema_metric: &'static str,
    first_rows_metric: &'static str,
}

#[cfg_attr(
    not(target_family = "wasm"),
    expect(dead_code, reason = "only the web build opens files")
)]
enum Load {
    Idle,
    /// Registering the file and reading its metadata. If the engine is still
    /// loading, the bridge holds the calls until it's ready.
    Opening {
        origin: Origin,
        name: SharedString,
        /// Dropping it stops the open at its next await.
        #[cfg(target_family = "wasm")]
        _task: Task<()>,
        /// The metadata queries sent so far, to cancel if a new file comes.
        #[cfg(target_family = "wasm")]
        sent: std::rc::Rc<std::cell::RefCell<Vec<crate::engine::RequestId>>>,
    },
    Open {
        summary: FileSummary,
        table: Entity<RowTable>,
    },
    Failed {
        origin: Origin,
        name: SharedString,
        message: SharedString,
    },
}

impl Load {
    fn opening(&self, which: Origin) -> bool {
        matches!(self, Self::Opening { origin, .. } if *origin == which)
    }
}

/// A line about the last file choice that didn't replace what's shown: a
/// file Tycho can't open, or extra files in one drop.
#[derive(Clone)]
struct Notice {
    text: SharedString,
    error: bool,
}

#[cfg_attr(
    not(target_family = "wasm"),
    expect(dead_code, reason = "only the web build opens files")
)]
pub struct Workbench {
    load: Load,
    notice: Option<Notice>,
    /// Files are being dragged over the page.
    dragging: bool,
    /// Counts opens; each file registers under its own SQL name (see
    /// [`Workbench::open_file`]), and a sniff whose count is stale is dropped.
    opens: u64,
    /// Reading a chosen file's first and last bytes (`files::sniff`). A newer
    /// choice replaces it.
    #[cfg(target_family = "wasm")]
    sniffing: Option<Task<()>>,
    /// When the current open started (ms from `timeOrigin`), and, until the
    /// first render showing its summary, the marks to set then.
    #[cfg(target_family = "wasm")]
    opened_at: f64,
    #[cfg(target_family = "wasm")]
    mark_shown: Option<Marks>,
    _engine_status: Subscription,
}

impl Workbench {
    pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        #[cfg(target_family = "wasm")]
        crate::files::listen(cx.entity().downgrade(), window.window_handle(), cx);
        #[cfg(not(target_family = "wasm"))]
        let _ = window;
        Self {
            load: Load::Idle,
            notice: None,
            dragging: false,
            opens: 0,
            #[cfg(target_family = "wasm")]
            sniffing: None,
            #[cfg(target_family = "wasm")]
            opened_at: 0.0,
            #[cfg(target_family = "wasm")]
            mark_shown: None,
            _engine_status: cx.observe_global::<EngineStatus>(|_, cx| cx.notify()),
        }
    }

    /// Opens the asteroid sample by URL.
    #[cfg(target_family = "wasm")]
    fn open_sample(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        use crate::dataset::ASTEROIDS;
        use crate::engine::FileSource;

        if self.load.opening(Origin::Sample) {
            return;
        }
        self.sniffing = None;
        self.notice = None;
        self.open(
            Origin::Sample,
            ASTEROIDS.name.into(),
            ASTEROIDS.name.into(),
            FileSource::Url(ASTEROIDS.url.into()),
            crate::engine::now(),
            window,
            cx,
        );
    }

    #[cfg(not(target_family = "wasm"))]
    fn open_sample(&mut self, _window: &mut Window, _cx: &mut Context<Self>) {}

    #[cfg(target_family = "wasm")]
    fn pick_file(&mut self, _window: &mut Window, _cx: &mut Context<Self>) {
        crate::files::pick();
    }

    #[cfg(not(target_family = "wasm"))]
    fn pick_file(&mut self, _window: &mut Window, _cx: &mut Context<Self>) {}

    /// A file was dropped or picked at `at`. Its first and last bytes decide
    /// first: a file Tycho can't open gets a message and leaves the current
    /// file where it is.
    #[cfg(target_family = "wasm")]
    fn file_chosen(
        &mut self,
        file: web_sys::File,
        at: f64,
        more: u32,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        use crate::files::{Kind, sniff};

        self.opens += 1;
        let open = self.opens;
        self.sniffing = Some(cx.spawn_in(window, async move |this, cx| {
            let kind = sniff(&file).await;
            let _ = this.update_in(cx, |this, window, cx| {
                if this.opens != open {
                    return;
                }
                this.sniffing = None;
                let name = SharedString::from(file.name());
                let refused = match kind {
                    Ok(Kind::Parquet) => None,
                    Ok(Kind::EncryptedParquet) => Some(format!(
                        "{name} is an encrypted Parquet file. Tycho can't read those."
                    )),
                    Ok(Kind::Other { csv: true }) => Some(format!(
                        "{name} is a CSV file. Tycho opens Parquet files for now; CSV support is coming."
                    )),
                    Ok(Kind::Other { csv: false } | Kind::TooSmall) => Some(format!(
                        "{name} isn't a Parquet file (no PAR1 marker at its start and end). Tycho opens Parquet files."
                    )),
                    Err(error) => Some(format!("Couldn't read {name}: {error}")),
                };
                if let Some(text) = refused {
                    this.notice = Some(Notice {
                        text: text.into(),
                        error: true,
                    });
                    cx.notify();
                    return;
                }
                this.notice = (more > 0).then(|| Notice {
                    text: format!(
                        "Opened {name}, the first of {} files. Tycho shows one file at a time.",
                        more + 1
                    )
                    .into(),
                    error: false,
                });
                let sql_name = format!("file-{open}.parquet");
                this.open(
                    Origin::Device,
                    name,
                    sql_name,
                    crate::engine::FileSource::File(file),
                    at,
                    window,
                    cx,
                );
            });
        }));
    }

    /// Stops whatever is loading or showing, so a new file can take over.
    #[cfg(target_family = "wasm")]
    fn close_current(&mut self, cx: &mut Context<Self>) {
        match std::mem::replace(&mut self.load, Load::Idle) {
            Load::Opening { origin, sent, .. } => {
                // The task is dropped with the state; its sent queries go on
                // in DuckDB unless cancelled.
                let engine = cx.global::<crate::engine::Engine>();
                for request in sent.borrow().iter() {
                    engine.cancel(*request);
                }
                let marks = origin.marks();
                seiza::perf::set_metric(cx, marks.schema_metric, "—");
                seiza::perf::set_metric(cx, marks.first_rows_metric, "—");
            }
            Load::Open { table, .. } => table.update(cx, |table, cx| table.close(cx)),
            Load::Idle | Load::Failed { .. } => {}
        }
        self.mark_shown = None;
    }

    /// Registers `source` as `sql_name` and reads its summary, then shows its
    /// rows. `name` is what the header shows. The SQL name is ours, never the
    /// file's: `read_parquet` would expand a name like `data[1].parquet` as a
    /// glob. `started_at` is the click, drop, or choice.
    #[cfg(target_family = "wasm")]
    #[expect(
        clippy::too_many_arguments,
        reason = "the one place every open goes through"
    )]
    fn open(
        &mut self,
        origin: Origin,
        name: SharedString,
        sql_name: String,
        source: crate::engine::FileSource,
        started_at: f64,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        use std::cell::RefCell;
        use std::rc::Rc;

        use crate::engine::Engine;

        self.close_current(cx);
        let marks = origin.marks();
        self.opened_at = started_at;
        mark_at(marks.start, started_at);
        seiza::perf::set_metric(cx, marks.schema_metric, "…");
        seiza::perf::set_metric(cx, marks.first_rows_metric, "…");

        let engine = cx.global::<Engine>().clone();
        let sent = Rc::new(RefCell::new(Vec::new()));
        let task = {
            let (sent, name) = (sent.clone(), name.clone());
            cx.spawn_in(window, async move |this, cx| {
                let result = crate::dataset::open(&engine, &sql_name, &name, source, |id| {
                    sent.borrow_mut().push(id)
                })
                .await;
                let _ = this.update_in(cx, |this, window, cx| {
                    this.load = match result {
                        Ok(summary) => {
                            this.mark_shown = Some(marks);
                            crate::engine::show_parquet_ready(cx, &engine);
                            let table = cx.new(|cx| {
                                RowTable::new(
                                    sql_name,
                                    summary.rows,
                                    &summary.columns,
                                    started_at,
                                    marks.first_rows_metric,
                                    engine,
                                    cx,
                                )
                            });
                            let focus = table.read(cx).focus_handle().clone();
                            window.focus(&focus, cx);
                            Load::Open { summary, table }
                        }
                        Err(error) => {
                            // Queries still running (a failed DESCRIBE leaves
                            // the other two) would hold up the next open.
                            let engine = cx.global::<Engine>();
                            for request in sent.borrow().iter() {
                                engine.cancel(*request);
                            }
                            // The failure says it all; an "Opened …, the first
                            // of N files" line would bury it.
                            this.notice = None;
                            seiza::perf::set_metric(cx, marks.schema_metric, "failed");
                            seiza::perf::set_metric(cx, marks.first_rows_metric, "—");
                            Load::Failed {
                                origin,
                                name,
                                message: error.to_string().into(),
                            }
                        }
                    };
                    cx.notify();
                });
            })
        };
        self.load = Load::Opening {
            origin,
            name,
            _task: task,
            sent,
        };
        cx.notify();
    }

    /// On the first render showing the summary: marks it right after this
    /// frame is presented, and records start → shown.
    #[cfg(target_family = "wasm")]
    fn mark_summary_shown(&mut self, cx: &mut Context<Self>) {
        let Some(marks) = self.mark_shown.take() else {
            return;
        };
        // Queued now, inside the render; resolves after the present.
        let shown = seiza::mark_after_current_task(marks.shown);
        let started_at = self.opened_at;
        cx.spawn(async move |_, cx| {
            let metric = match shown.await {
                Some(shown) => format!("{:.0} ms", shown - started_at),
                None => "—".into(),
            };
            cx.update(|cx| seiza::perf::set_metric(cx, marks.schema_metric, metric));
        })
        .detach();
    }

    /// Publishes what the workbench shows to `globalThis.__tychoWorkbench`,
    /// for the Playwright checks (the canvas has no DOM text to read).
    fn publish(&self) {
        if !crate::targets::measuring() {
            return;
        }
        let (state, name, rows) = match &self.load {
            Load::Idle => ("idle", None, None),
            Load::Opening { name, .. } => ("opening", Some(name.as_ref()), None),
            Load::Open { summary, .. } => ("open", Some(summary.name.as_str()), Some(summary.rows)),
            Load::Failed { name, .. } => ("failed", Some(name.as_ref()), None),
        };
        let message = match &self.load {
            Load::Failed { message, .. } => Some(message.as_ref()),
            _ => None,
        };
        crate::targets::publish_workbench(&crate::targets::WorkbenchProbe {
            state,
            name,
            rows,
            message,
            notice: self.notice.as_ref().map(|notice| notice.text.as_ref()),
            dragging: self.dragging,
        });
    }

    /// One quiet line under the buttons: what's loading, or what failed.
    /// The engine loads after first paint, so the shell says so until it's
    /// ready (Tycho rule 1).
    fn render_status(&self, cx: &App) -> impl IntoElement {
        let theme = cx.theme();
        let engine = cx.try_global::<EngineStatus>().cloned().unwrap_or_default();
        let (text, color): (SharedString, _) = match (&engine, &self.load, &self.notice) {
            (EngineStatus::Failed(message), _, _) => (
                format!("Engine failed to load: {message}. Reload the page to try again.").into(),
                theme.danger,
            ),
            (EngineStatus::Loading, Load::Opening { .. }, _) => (
                "Waiting for the engine to load…".into(),
                theme.muted_foreground,
            ),
            (
                _,
                Load::Opening {
                    origin: Origin::Sample,
                    ..
                },
                _,
            ) => (
                "Reading the file's metadata…".into(),
                theme.muted_foreground,
            ),
            (_, Load::Opening { name, .. }, _) => {
                (format!("Reading {name}…").into(), theme.muted_foreground)
            }
            (_, _, Some(notice)) => (
                notice.text.clone(),
                if notice.error {
                    theme.danger
                } else {
                    theme.muted_foreground
                },
            ),
            (
                _,
                Load::Failed {
                    origin: Origin::Sample,
                    message,
                    ..
                },
                _,
            ) => (
                format!("Couldn't open the sample: {message}").into(),
                theme.danger,
            ),
            (_, Load::Failed { name, message, .. }, _) => (
                format!("Couldn't open {name}: {message}").into(),
                theme.danger,
            ),
            (EngineStatus::Loading, _, _) => ("Engine loading…".into(), theme.muted_foreground),
            (EngineStatus::Ready { .. }, _, _) => ("Engine ready".into(), theme.muted_foreground),
        };
        div().text_xs().text_color(color).child(text)
    }

    /// A button the Playwright checks can find: they click through its
    /// published bounds (the canvas has no DOM to query).
    fn target(id: &'static str, button: Button) -> impl IntoElement {
        div()
            .on_children_prepainted(move |bounds, _, _| {
                if let Some(bounds) = bounds.first() {
                    crate::targets::publish(id, *bounds);
                }
            })
            .child(button)
    }

    fn render_empty(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let engine_failed = matches!(
            cx.try_global::<EngineStatus>(),
            Some(EngineStatus::Failed(_))
        );
        Empty::new()
            .border_0()
            .header(
                EmptyHeader::new()
                    .title(EmptyTitle::new().child("Drop a Parquet file"))
                    .description(
                        EmptyDescription::new()
                            .child("Files stay on this device. CSV support is coming."),
                    ),
            )
            .content(
                EmptyContent::new()
                    .child(
                        h_flex()
                            .gap_2()
                            .child(Self::target(
                                "open-file",
                                Button::new("open-file")
                                    .primary()
                                    .label("Open a Parquet file…")
                                    .loading(self.load.opening(Origin::Device))
                                    .disabled(engine_failed)
                                    .on_click(cx.listener(|this, _, window, cx| {
                                        this.pick_file(window, cx)
                                    })),
                            ))
                            .child(Self::target(
                                "try-sample-asteroids",
                                Button::new("try-sample-asteroids")
                                    .outline()
                                    .label("Try sample: every known asteroid")
                                    .loading(self.load.opening(Origin::Sample))
                                    .disabled(engine_failed)
                                    .on_click(cx.listener(|this, _, window, cx| {
                                        this.open_sample(window, cx)
                                    })),
                            )),
                    )
                    .child(self.render_status(cx)),
            )
    }

    /// The header strip: the file, its size and shape, its columns, and the
    /// data credit.
    fn render_summary(&self, summary: &FileSummary, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme();
        let mut stats = vec![
            format!("{} rows", format_count(summary.rows)),
            format!("{} columns", summary.columns.len()),
        ];
        if let Some(bytes) = summary.bytes {
            stats.push(format_bytes(bytes));
        }
        stats.push(format!(
            "{} row group{}",
            format_count(summary.row_groups),
            if summary.row_groups == 1 { "" } else { "s" }
        ));

        v_flex()
            .gap_2()
            .child(
                h_flex()
                    .gap_3()
                    .child(div().text_sm().font_semibold().child(summary.name.clone()))
                    .child(
                        div()
                            .text_xs()
                            .text_color(theme.muted_foreground)
                            .child(stats.join(" · ")),
                    )
                    .child(div().flex_1())
                    .child(Self::target(
                        "open-file",
                        Button::new("open-file")
                            .ghost()
                            .small()
                            .label("Open file…")
                            .on_click(
                                cx.listener(|this, _, window, cx| this.pick_file(window, cx)),
                            ),
                    )),
            )
            .child(
                h_flex()
                    .flex_wrap()
                    .gap_1()
                    .children(summary.columns.iter().map(|column| {
                        Tag::secondary().small().child(
                            h_flex().gap_1().child(column.name.clone()).child(
                                div()
                                    .text_color(theme.muted_foreground)
                                    .child(column.data_type.clone()),
                            ),
                        )
                    })),
            )
            .children(summary.credit.clone().map(|credit| {
                div()
                    .text_xs()
                    .text_color(theme.muted_foreground)
                    .child(credit)
            }))
            .children(self.notice.as_ref().map(|notice| {
                div()
                    .text_xs()
                    .text_color(if notice.error {
                        theme.danger
                    } else {
                        theme.muted_foreground
                    })
                    .child(notice.text.clone())
            }))
    }

    /// Covers the window while files are dragged over it.
    fn render_drop_target(cx: &App) -> impl IntoElement {
        let theme = cx.theme();
        div().absolute().top_0().left_0().size_full().p_3().child(
            v_flex()
                .size_full()
                .items_center()
                .justify_center()
                .gap_1()
                .rounded_lg()
                .border_2()
                .border_dashed()
                .border_color(theme.primary)
                .bg(theme.background.opacity(0.9))
                .child(div().text_lg().font_semibold().child("Drop to open"))
                .child(
                    div()
                        .text_sm()
                        .text_color(theme.muted_foreground)
                        .child("Parquet files are read in place, never uploaded or copied."),
                ),
        )
    }
}

/// Sets `performance.mark(name)` at `at` (ms from `timeOrigin`), when the
/// click, drop, or choice happened rather than when it was handled.
#[cfg(target_family = "wasm")]
fn mark_at(name: &str, at: f64) {
    use js_sys::{Function, Object, Reflect};
    use wasm_bindgen::{JsCast as _, JsValue};

    // `performance.mark(name, { startTime })`; web-sys has the options type
    // only behind its unstable-APIs flag.
    let Some(performance) = web_sys::window().and_then(|window| window.performance()) else {
        return;
    };
    let options = Object::new();
    let _ = Reflect::set(&options, &"startTime".into(), &JsValue::from_f64(at));
    if let Ok(mark) = Reflect::get(&performance, &"mark".into()) {
        let _ = mark.unchecked_into::<Function>().call2(
            &performance,
            &JsValue::from_str(name),
            &options,
        );
    }
}

#[cfg(target_family = "wasm")]
impl crate::files::FileTarget for Workbench {
    fn file_event(
        &mut self,
        event: crate::files::FileEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        use crate::files::FileEvent;

        match event {
            FileEvent::Dragging(dragging) => {
                self.dragging = dragging;
                cx.notify();
            }
            FileEvent::Chosen { file, at, more } => self.file_chosen(file, at, more, window, cx),
        }
    }
}

impl Render for Workbench {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        #[cfg(target_family = "wasm")]
        self.mark_summary_shown(cx);
        self.publish();

        let content = match &self.load {
            Load::Open { summary, table } => v_flex()
                .size_full()
                .p_4()
                .gap_3()
                .child(self.render_summary(summary, cx))
                .child(div().flex_1().min_h_0().child(table.clone())),
            _ => v_flex().size_full().p_4().child(self.render_empty(cx)),
        };
        div()
            .relative()
            .size_full()
            .child(content)
            .when(self.dragging, |this| {
                this.child(Self::render_drop_target(cx))
            })
    }
}
