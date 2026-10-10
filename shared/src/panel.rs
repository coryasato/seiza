//! The perf panel's view.
//!
//! It's its own entity, embedded in the shell as a *cached* view: GPUI
//! replays its last drawing on every frame it wasn't notified, so a fling
//! pays for the panel's render only when it refreshes (~4 Hz), not every
//! frame. A refresh still redraws the whole window (a notify marks every
//! ancestor dirty), so an idle page draws ~4 frames a second while the panel
//! is open, and the panel's frame rows count them.

use gpui_kit::component::button::{Button, ButtonVariants as _};
use gpui_kit::component::{ActiveTheme as _, Sizable as _, ThemeStyled as _, h_flex, v_flex};
use gpui_kit::*;

use crate::perf::{Live, MEMORY_ROW, PAGE_LOAD, PerfOverlay, WINDOW_MS, format_stats};

pub(crate) struct PerfPanel {
    title: SharedString,
    /// Visibility as of the last notify.
    was_visible: bool,
    _overlay: Subscription,
}

impl PerfPanel {
    pub(crate) fn new(title: SharedString, cx: &mut Context<Self>) -> Self {
        Self {
            title,
            was_visible: false,
            // A notify redraws the whole window (it marks every ancestor
            // dirty), so a hidden panel stays quiet: it redraws only to
            // appear or disappear.
            _overlay: cx.observe_global::<PerfOverlay>(|this: &mut Self, cx| {
                let visible = crate::perf::is_visible(cx);
                if visible || this.was_visible {
                    this.was_visible = visible;
                    cx.notify();
                }
            }),
        }
    }
}

impl Render for PerfPanel {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        // The cached box covers the shell; the panel sits in its corner.
        let root = div().size_full().relative();
        let Some(overlay) = cx.try_global::<PerfOverlay>().filter(|o| o.is_visible()) else {
            return root;
        };
        let snapshot = overlay.snapshot();
        let theme = cx.theme();
        let section_title = |text: SharedString| {
            div()
                .text_xs()
                .font_weight(FontWeight::SEMIBOLD)
                .text_color(theme.popover_foreground)
                .child(text)
        };

        // Where it is, for scripts that click near it: a press on the panel
        // never reaches what's under it.
        #[cfg(target_family = "wasm")]
        let root = root.on_children_prepainted(|bounds, _, _| {
            if let Some(bounds) = bounds.first() {
                crate::perf::publish_rect(*bounds);
            }
        });
        let (right, bottom) = overlay.clearance();
        let mut panel = v_flex()
            .id("seiza-perf-panel")
            .absolute()
            .bottom(bottom)
            .right(right)
            .w_96()
            .gap_3()
            .px_3()
            .py_2()
            .popover_style(cx)
            .text_xs()
            .block_mouse_except_scroll()
            .child(
                h_flex()
                    .justify_between()
                    .child(
                        div()
                            .text_sm()
                            .font_weight(FontWeight::SEMIBOLD)
                            .child("Observation panel"),
                    )
                    .child(
                        Button::new("seiza-perf-hide")
                            .ghost()
                            .xsmall()
                            .label("Hide")
                            .cursor_pointer()
                            .tooltip("Cmd/Ctrl+Shift+P")
                            .on_click(|_, _, cx| crate::perf::toggle(cx)),
                    ),
            );

        let ttfp = snapshot
            .ttfp_ms
            .map_or_else(|| "…".to_string(), |ms| format!("{ms:.0} ms"));
        for (section, origin, steps) in snapshot.sections() {
            let end = steps
                .iter()
                .map(|step| step.step.end_ms().unwrap_or(snapshot.live.now_ms))
                .fold(origin, f64::max);
            let span = (end - origin).max(1.0);
            let title = if section == PAGE_LOAD {
                format!("{section} · first frame {ttfp}")
            } else {
                section.to_string()
            };
            panel = panel.child(
                v_flex()
                    .gap_1()
                    .child(section_title(title.into()))
                    .children(steps.into_iter().map(|step| {
                        let start = step.step.start_ms();
                        let stop = step.step.end_ms().unwrap_or(snapshot.live.now_ms);
                        let color = if step.step.is_failed() {
                            theme.danger
                        } else if step.step.is_running() {
                            theme.muted_foreground
                        } else {
                            theme.chart_1
                        };
                        let left = ((start - origin) / span).clamp(0.0, 1.0) as f32;
                        let width = ((stop - start).max(0.0) / span)
                            .clamp(0.0, 1.0 - f64::from(left))
                            as f32;
                        h_flex()
                            .gap_2()
                            .child(
                                div()
                                    .w_32()
                                    .flex_shrink_0()
                                    .truncate()
                                    .text_color(theme.muted_foreground)
                                    .child(step.label.clone()),
                            )
                            .child(
                                div().flex_1().h_1p5().relative().child(
                                    div()
                                        .absolute()
                                        .top_0()
                                        .h_full()
                                        .left(relative(left))
                                        .w(relative(width))
                                        .min_w_0p5()
                                        // Square: a data mark, and too thin
                                        // for a radius to stay a rectangle.
                                        .bg(color),
                                ),
                            )
                            .child(
                                div()
                                    .w_16()
                                    .flex_shrink_0()
                                    .flex()
                                    .justify_end()
                                    .text_color(theme.popover_foreground)
                                    .child(step.step.value(origin)),
                            )
                    })),
            );
        }

        panel = panel.child(
            v_flex()
                .gap_1()
                .child(section_title("Frames · last 2 s".into()))
                .child(sparkline(snapshot.live.clone(), INTERVAL, WORK, cx))
                .child(legend_row(
                    INTERVAL(cx),
                    "Interval",
                    format_stats(snapshot.live.frame_stats()),
                    cx,
                ))
                .child(legend_row(
                    WORK(cx),
                    "Work",
                    format_stats(snapshot.live.work_stats()),
                    cx,
                ))
                .child(
                    div()
                        .text_color(theme.muted_foreground)
                        .child("Includes the frames this panel's refreshes draw (4 a second)."),
                )
                .child(value_row(
                    MEMORY_ROW.into(),
                    snapshot.live.memory.clone().unwrap_or_else(|| "…".into()),
                    cx,
                )),
        );

        if !snapshot.metrics.is_empty() {
            panel = panel.child(
                v_flex()
                    .gap_1()
                    .child(section_title(self.title.clone()))
                    .children(
                        snapshot
                            .metrics
                            .iter()
                            .map(|(label, value)| value_row(label.clone(), value.clone(), cx)),
                    ),
            );
        }
        root.child(panel)
    }
}

fn value_row(label: SharedString, value: SharedString, cx: &App) -> Div {
    let theme = cx.theme();
    h_flex()
        .gap_2()
        .justify_between()
        .child(
            div()
                .flex_shrink_0()
                .text_color(theme.muted_foreground)
                .child(label),
        )
        .child(
            div()
                .min_w_0()
                .truncate()
                .text_color(theme.popover_foreground)
                .child(value),
        )
}

/// A legend entry: the line's color, its name, and its percentiles.
fn legend_row(color: Hsla, label: &'static str, stats: SharedString, cx: &App) -> Div {
    let theme = cx.theme();
    h_flex()
        .gap_2()
        .child(div().w_3().h_0p5().flex_shrink_0().bg(color))
        .child(
            div()
                .w_12()
                .flex_shrink_0()
                .text_color(theme.muted_foreground)
                .child(label),
        )
        .child(
            div()
                .flex_1()
                .flex()
                .justify_end()
                .text_color(theme.popover_foreground)
                .child(stats),
        )
}

/// Frame intervals (a stepped line, one step per rAF) and per-frame work
/// (a bar at each frame GPUI drew) over the last 2 s, on one ms scale with a
/// hairline at 16.7 ms. Quads, not paths: path tessellation would add lyon to
/// every app's wasm.
/// The sparkline's line colors, shared with its legend so the two can't
/// disagree.
type LineColor = fn(&App) -> Hsla;
const INTERVAL: LineColor = |cx| cx.theme().muted_foreground;
const WORK: LineColor = |cx| cx.theme().chart_1;

fn sparkline(live: Live, interval: LineColor, work: LineColor, cx: &App) -> impl IntoElement {
    let (interval_color, work_color, grid_color) = (interval(cx), work(cx), cx.theme().border);
    canvas(
        |_, _, _| {},
        move |bounds, (), window, _| {
            let tallest = live
                .stamps
                .windows(2)
                .map(|pair| pair[1] - pair[0])
                .chain(live.work.iter().map(|(_, ms)| *ms))
                .fold(0.0, f64::max);
            // At least two frames at 60 Hz tall, at most 100 ms: one long
            // stall shouldn't flatten everything else.
            let scale_ms = tallest.clamp(33.4, 100.0);
            let (left, width) = (bounds.origin.x, bounds.size.width);
            let (bottom, height) = (bounds.bottom(), bounds.size.height);
            let x = |t: f64| {
                let fraction = ((t - (live.now_ms - WINDOW_MS)) / WINDOW_MS).clamp(0.0, 1.0);
                left + width * fraction as f32
            };
            let y = |ms: f64| bottom - height * (ms.min(scale_ms) / scale_ms) as f32;
            // A device-pixel-ish hairline and line weight: physical geometry.
            let hairline = px(1.);
            window.paint_quad(fill(
                Bounds::new(point(left, y(1000.0 / 60.0)), size(width, hairline)),
                grid_color,
            ));
            for (start, ms) in &live.work {
                let top = y(*ms);
                window.paint_quad(fill(
                    Bounds::new(point(x(*start), top), size(px(1.5), bottom - top)),
                    work_color.opacity(0.7),
                ));
            }
            let mut previous: Option<Pixels> = None;
            for pair in live.stamps.windows(2) {
                let level = y(pair[1] - pair[0]);
                let (from, to) = (x(pair[0]), x(pair[1]));
                window.paint_quad(fill(
                    Bounds::new(point(from, level), size((to - from).max(hairline), px(1.5))),
                    interval_color,
                ));
                if let Some(previous) = previous {
                    let (top, low) = if previous < level {
                        (previous, level)
                    } else {
                        (level, previous)
                    };
                    window.paint_quad(fill(
                        Bounds::new(point(from, top), size(hairline, low - top + px(1.5))),
                        interval_color,
                    ));
                }
                previous = Some(level);
            }
        },
    )
    .w_full()
    .h_12()
}
