//! The perf overlay: the numbers behind every claim, drawn on the canvas.
//!
//! It owns the common metrics (TTFP, frame times over the last 2 s, and
//! memory) and lets apps add their own rows with [`set_metric`]. Toggle it
//! with Cmd/Ctrl+Shift+P, or open the page with `?perf` in the URL.

use gpui_kit::component::{ActiveTheme as _, ThemeStyled as _, h_flex, v_flex};
use gpui_kit::*;

actions!(seiza, [TogglePerfOverlay]);

/// Overlay state, one per app.
#[derive(Default)]
pub struct PerfOverlay {
    visible: bool,
    ttfp_ms: Option<f64>,
    metrics: Vec<(SharedString, SharedString)>,
}

impl Global for PerfOverlay {}

impl PerfOverlay {
    pub fn is_visible(&self) -> bool {
        self.visible
    }
}

/// Installs the overlay state and its key bindings. `shared/`'s bootstrap
/// calls this after `gpui_kit::init`; apps don't need to.
pub fn init(cx: &mut App) {
    // Keeps any metrics an app set before init.
    let visible = requested_by_url();
    cx.default_global::<PerfOverlay>().visible = visible;
    // Both spellings: on wasm GPUI's `secondary` always means ctrl, but Mac
    // browsers report Cmd as the platform modifier.
    cx.bind_keys([
        KeyBinding::new("cmd-shift-p", TogglePerfOverlay, None),
        KeyBinding::new("ctrl-shift-p", TogglePerfOverlay, None),
    ]);
    cx.on_action(|_: &TogglePerfOverlay, cx| {
        cx.update_global::<PerfOverlay, _>(|overlay, _| overlay.visible = !overlay.visible);
        #[cfg(target_family = "wasm")]
        crate::frames::sync(cx);
    });
}

/// Sets an app metric's row, adding it at the end on first use. Rows keep the
/// order they were first set in.
///
/// Safe to call before [`init`] or where it never runs (native builds, tests):
/// the overlay state is created on first use, hidden.
pub fn set_metric(cx: &mut App, label: impl Into<SharedString>, value: impl Into<SharedString>) {
    let (label, value) = (label.into(), value.into());
    cx.default_global::<PerfOverlay>();
    cx.update_global::<PerfOverlay, _>(|overlay, _| {
        match overlay
            .metrics
            .iter_mut()
            .find(|(existing, _)| *existing == label)
        {
            Some((_, existing)) => *existing = value,
            None => overlay.metrics.push((label, value)),
        }
    });
}

/// Like [`set_metric`], but leaves the overlay alone (no redraw) when the
/// value is unchanged. For rows refreshed on a timer.
#[cfg(target_family = "wasm")]
pub(crate) fn set_metric_if_changed(cx: &mut App, label: &'static str, value: String) {
    let unchanged = cx.try_global::<PerfOverlay>().is_some_and(|overlay| {
        overlay
            .metrics
            .iter()
            .any(|(existing, current)| existing == label && current.as_ref() == value)
    });
    if !unchanged {
        set_metric(cx, label, value);
    }
}

/// Frame-time percentiles from `requestAnimationFrame` timestamps.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct FrameStats {
    pub frames: usize,
    pub p50: f64,
    pub p95: f64,
    pub max: f64,
}

/// The intervals between consecutive `stamps` (ms, ascending), summarized
/// with nearest-rank percentiles. `None` with fewer than two stamps.
pub fn frame_stats(stamps: &[f64]) -> Option<FrameStats> {
    let mut intervals: Vec<f64> = stamps.windows(2).map(|pair| pair[1] - pair[0]).collect();
    if intervals.is_empty() {
        return None;
    }
    intervals.sort_by(f64::total_cmp);
    let rank = |p: f64| {
        intervals[((p * intervals.len() as f64).ceil() as usize).clamp(1, intervals.len()) - 1]
    };
    Some(FrameStats {
        frames: intervals.len(),
        p50: rank(0.5),
        p95: rank(0.95),
        max: intervals[intervals.len() - 1],
    })
}

/// Records TTFP once the first-frame mark is set.
#[cfg(target_family = "wasm")]
pub(crate) fn set_ttfp(cx: &mut App, ttfp_ms: f64) {
    cx.default_global::<PerfOverlay>();
    cx.update_global::<PerfOverlay, _>(|overlay, _| overlay.ttfp_ms = Some(ttfp_ms));
}

/// The overlay panel, or nothing when it's hidden.
pub(crate) fn render(cx: &App) -> Option<AnyElement> {
    let overlay = cx.try_global::<PerfOverlay>()?;
    if !overlay.visible {
        publish(None);
        return None;
    }
    let ttfp = overlay
        .ttfp_ms
        .map_or_else(|| "…".into(), |ms| format!("{ms:.0} ms").into());
    let rows: Vec<(SharedString, SharedString)> = std::iter::once(("TTFP".into(), ttfp))
        .chain(overlay.metrics.iter().cloned())
        .collect();
    publish(Some(&rows));

    let theme = cx.theme();
    Some(
        v_flex()
            .id("seiza-perf-overlay")
            .absolute()
            .bottom_3()
            .right_3()
            .min_w_40()
            .gap_1()
            .px_3()
            .py_2()
            .popover_style(cx)
            .text_xs()
            .children(rows.into_iter().map(|(label, value)| {
                h_flex()
                    .justify_between()
                    .gap_4()
                    .child(div().text_color(theme.muted_foreground).child(label))
                    .child(div().text_color(theme.popover_foreground).child(value))
            }))
            .into_any_element(),
    )
}

/// Whether the page URL asks for the overlay (`?perf`).
fn requested_by_url() -> bool {
    crate::url::has_param("perf")
}

/// Mirrors the rows the overlay shows to `globalThis.__seizaPerfOverlay`
/// (`[[label, value], …]`, or `undefined` while hidden), so the Playwright
/// suite can check the drawn values against its own measurements.
fn publish(rows: Option<&[(SharedString, SharedString)]>) {
    #[cfg(target_family = "wasm")]
    {
        let key = wasm_bindgen::JsValue::from_str("__seizaPerfOverlay");
        let _ = match rows {
            Some(rows) => {
                let array: js_sys::Array = rows
                    .iter()
                    .map(|(label, value)| {
                        js_sys::Array::of2(&label.as_ref().into(), &value.as_ref().into())
                    })
                    .collect();
                js_sys::Reflect::set(&js_sys::global(), &key, &array)
            }
            None => js_sys::Reflect::delete_property(&js_sys::global(), &key),
        };
    }
    #[cfg(not(target_family = "wasm"))]
    let _ = rows;
}

#[cfg(test)]
mod tests {
    // Not `super::*`: that brings gpui's `test` attribute over std's.
    use super::frame_stats;

    #[test]
    fn frame_stats_use_nearest_rank() {
        assert_eq!(frame_stats(&[]), None);
        assert_eq!(frame_stats(&[5.0]), None);
        // 19 steady frames and one long one.
        let mut stamps = vec![0.0];
        for index in 0..19 {
            stamps.push(stamps[index] + 16.7);
        }
        stamps.push(stamps[19] + 50.0);
        let stats = frame_stats(&stamps).unwrap();
        assert_eq!(stats.frames, 20);
        assert!((stats.p50 - 16.7).abs() < 1e-9);
        // The 19th of 20 sorted intervals is still a steady one.
        assert!((stats.p95 - 16.7).abs() < 1e-9);
        assert!((stats.max - 50.0).abs() < 1e-9);
    }
}
