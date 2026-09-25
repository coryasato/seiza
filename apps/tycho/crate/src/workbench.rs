//! The workbench: Tycho's one window. Empty until a file or sample is
//! opened; then a header strip describes the file, above its rows.

use gpui_kit::component::button::Button;
use gpui_kit::component::empty::{Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle};
use gpui_kit::component::tag::Tag;
use gpui_kit::component::{
    ActiveTheme as _, Disableable as _, Sizable as _, StyledExt as _, h_flex, v_flex,
};
use gpui_kit::*;

use crate::dataset::{FileSummary, format_bytes, format_count};
use crate::engine::EngineStatus;
use crate::table::RowTable;

/// Where opening the asteroid sample is.
#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(
    not(target_family = "wasm"),
    expect(dead_code, reason = "only the web build opens files")
)]
enum SampleState {
    Idle,
    /// Registering the file and reading its metadata. If the engine is still
    /// loading, the bridge holds the calls until it's ready.
    Opening,
    Open {
        summary: FileSummary,
        table: Entity<RowTable>,
    },
    Failed(SharedString),
}

pub struct Workbench {
    sample: SampleState,
    /// When the sample button was clicked (ms from `timeOrigin`), and whether
    /// the next render is the first to show its summary. That render marks
    /// `tycho:sample-shown` once the frame is presented.
    #[cfg(target_family = "wasm")]
    clicked_at: f64,
    #[cfg(target_family = "wasm")]
    mark_shown: bool,
    _engine_status: Subscription,
}

#[cfg(target_family = "wasm")]
const SAMPLE_CLICK_MARK: &str = "tycho:sample-click";
#[cfg(target_family = "wasm")]
const SAMPLE_SHOWN_MARK: &str = "tycho:sample-shown";
#[cfg(target_family = "wasm")]
const SAMPLE_METRIC: &str = "Sample → schema";

impl Workbench {
    pub fn new(_window: &mut Window, cx: &mut Context<Self>) -> Self {
        Self {
            sample: SampleState::Idle,
            #[cfg(target_family = "wasm")]
            clicked_at: 0.0,
            #[cfg(target_family = "wasm")]
            mark_shown: false,
            _engine_status: cx.observe_global::<EngineStatus>(|_, cx| cx.notify()),
        }
    }

    /// Registers the asteroid sample by URL and reads its summary. Works before
    /// the engine is ready: the bridge queues the calls until it is.
    #[cfg(target_family = "wasm")]
    fn open_sample(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        use crate::dataset::{ASTEROIDS, open};
        use crate::engine::{Engine, FileSource};

        if self.sample == SampleState::Opening {
            return;
        }
        self.clicked_at = crate::engine::now();
        if let Some(performance) = web_sys::window().and_then(|window| window.performance()) {
            let _ = performance.mark(SAMPLE_CLICK_MARK);
        }
        self.sample = SampleState::Opening;
        seiza::perf::set_metric(cx, SAMPLE_METRIC, "…");
        cx.notify();

        let engine = cx.global::<Engine>().clone();
        let clicked_at = self.clicked_at;
        cx.spawn_in(window, async move |this, cx| {
            let result = open(
                &engine,
                ASTEROIDS.name,
                FileSource::Url(ASTEROIDS.url.into()),
            )
            .await;
            let _ = this.update_in(cx, |this, window, cx| {
                this.sample = match result {
                    Ok(summary) => {
                        this.mark_shown = true;
                        crate::engine::show_parquet_ready(cx, &engine);
                        let table = cx.new(|cx| {
                            RowTable::new(
                                summary.name.clone(),
                                summary.rows,
                                &summary.columns,
                                clicked_at,
                                engine,
                                cx,
                            )
                        });
                        let focus = table.read(cx).focus_handle().clone();
                        window.focus(&focus, cx);
                        SampleState::Open { summary, table }
                    }
                    Err(error) => {
                        seiza::perf::set_metric(cx, SAMPLE_METRIC, "failed");
                        SampleState::Failed(error.to_string().into())
                    }
                };
                cx.notify();
            });
        })
        .detach();
    }

    #[cfg(not(target_family = "wasm"))]
    fn open_sample(&mut self, _window: &mut Window, _cx: &mut Context<Self>) {}

    /// On the first render showing the summary: marks `tycho:sample-shown`
    /// right after this frame is presented, and records click → shown.
    #[cfg(target_family = "wasm")]
    fn mark_sample_shown(&mut self, cx: &mut Context<Self>) {
        if !std::mem::take(&mut self.mark_shown) {
            return;
        }
        // Queued now, inside the render; resolves after the present.
        let shown = seiza::mark_after_current_task(SAMPLE_SHOWN_MARK);
        let clicked_at = self.clicked_at;
        cx.spawn(async move |_, cx| {
            let metric = match shown.await {
                Some(shown) => format!("{:.0} ms", shown - clicked_at),
                None => "—".into(),
            };
            cx.update(|cx| seiza::perf::set_metric(cx, SAMPLE_METRIC, metric));
        })
        .detach();
    }

    /// One quiet line under the sample button: what's loading, or what failed.
    /// The engine loads after first paint, so the shell says so until it's
    /// ready (Tycho rule 1).
    fn render_status(&self, cx: &App) -> impl IntoElement {
        let theme = cx.theme();
        let engine = cx.try_global::<EngineStatus>().cloned().unwrap_or_default();
        let (text, color): (SharedString, _) = match (&engine, &self.sample) {
            (EngineStatus::Failed(message), _) => (
                format!("Engine failed to load: {message}. Reload the page to try again.").into(),
                theme.danger,
            ),
            (EngineStatus::Loading, SampleState::Opening) => (
                "Waiting for the engine to load…".into(),
                theme.muted_foreground,
            ),
            (_, SampleState::Opening) => (
                "Reading the file's metadata…".into(),
                theme.muted_foreground,
            ),
            (_, SampleState::Failed(message)) => (
                format!("Couldn't open the sample: {message}").into(),
                theme.danger,
            ),
            (EngineStatus::Loading, _) => ("Engine loading…".into(), theme.muted_foreground),
            (EngineStatus::Ready { .. }, _) => ("Engine ready".into(), theme.muted_foreground),
        };
        div().text_xs().text_color(color).child(text)
    }

    fn render_empty(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let engine_failed = matches!(
            cx.try_global::<EngineStatus>(),
            Some(EngineStatus::Failed(_))
        );
        let opening = self.sample == SampleState::Opening;
        Empty::new()
            .border_0()
            .header(
                EmptyHeader::new()
                    .title(EmptyTitle::new().child("Drop a CSV or Parquet file"))
                    .description(EmptyDescription::new().child("Files stay on this device.")),
            )
            .content(
                EmptyContent::new()
                    .child(
                        // The Playwright checks find the button through its
                        // published bounds (the canvas has no DOM to query).
                        div()
                            .on_children_prepainted(|bounds, _, _| {
                                if let Some(bounds) = bounds.first() {
                                    crate::targets::publish("try-sample-asteroids", *bounds);
                                }
                            })
                            .child(
                                Button::new("try-sample-asteroids")
                                    .outline()
                                    .label("Try sample: every known asteroid")
                                    .loading(opening)
                                    .disabled(engine_failed)
                                    .on_click(cx.listener(|this, _, window, cx| {
                                        this.open_sample(window, cx)
                                    })),
                            ),
                    )
                    .child(self.render_status(cx)),
            )
    }

    /// The header strip: the file, its size and shape, its columns, and the
    /// data credit.
    fn render_summary(summary: &FileSummary, cx: &App) -> impl IntoElement {
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
                    ),
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
    }
}

impl Render for Workbench {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        #[cfg(target_family = "wasm")]
        self.mark_sample_shown(cx);

        match &self.sample {
            SampleState::Open { summary, table } => v_flex()
                .size_full()
                .p_4()
                .gap_3()
                .child(Self::render_summary(summary, cx))
                .child(div().flex_1().min_h_0().child(table.clone())),
            _ => v_flex().size_full().p_4().child(self.render_empty(cx)),
        }
    }
}
