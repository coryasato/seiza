//! The perf panel ("observation panel"): the numbers behind every claim,
//! drawn on the canvas, live.
//!
//! It owns the common metrics: the page-load waterfall up to the first frame,
//! TTFP, frame intervals and per-frame work time over the last 2 s, and
//! memory. Apps add load steps ([`set_load_step`]), rows of their own
//! ([`set_metric`]), and rows they recompute while the panel is open
//! ([`on_refresh`]). The live values refresh at ~4 Hz, not every frame, so
//! watching doesn't cost the frames it measures. Toggle it with
//! Cmd/Ctrl+Shift+P or the title bar's button, or open the page with `?perf`
//! in the URL.

use std::rc::Rc;

use gpui_kit::*;

actions!(seiza, [TogglePerfOverlay]);

/// The section the shared page-load steps go in. Apps add their own
/// page-load steps (an engine, say) here too.
pub const PAGE_LOAD: &str = "Page load";

/// An app's [`on_refresh`] callback.
pub(crate) type RefreshCallback = Rc<dyn Fn(&mut App)>;

/// Panel state, one per app.
#[derive(Default)]
pub struct PerfOverlay {
    visible: bool,
    ttfp_ms: Option<f64>,
    steps: Vec<Step>,
    metrics: Vec<(SharedString, SharedString)>,
    live: Live,
    refresh: Vec<RefreshCallback>,
}

impl Global for PerfOverlay {}

impl PerfOverlay {
    pub fn is_visible(&self) -> bool {
        self.visible
    }
}

/// One step of a load waterfall, in ms from `performance.timeOrigin`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct LoadStep {
    start_ms: f64,
    state: StepState,
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum StepState {
    Running,
    Done(f64),
    Failed(f64),
    /// Didn't finish and won't (replaced, or nothing to do).
    Skipped,
}

impl LoadStep {
    /// Started at `start_ms` and still going: its bar grows until it ends.
    pub fn running(start_ms: f64) -> Self {
        Self {
            start_ms,
            state: StepState::Running,
        }
    }

    pub fn done(start_ms: f64, end_ms: f64) -> Self {
        Self {
            start_ms,
            state: StepState::Done(end_ms),
        }
    }

    pub fn failed(start_ms: f64, at_ms: f64) -> Self {
        Self {
            start_ms,
            state: StepState::Failed(at_ms),
        }
    }

    /// Won't finish: shown as "—".
    pub fn skipped(start_ms: f64) -> Self {
        Self {
            start_ms,
            state: StepState::Skipped,
        }
    }

    pub fn start_ms(&self) -> f64 {
        self.start_ms
    }

    /// When it ended, done or failed.
    pub fn end_ms(&self) -> Option<f64> {
        match self.state {
            StepState::Done(end) | StepState::Failed(end) => Some(end),
            StepState::Running | StepState::Skipped => None,
        }
    }

    pub fn is_running(&self) -> bool {
        self.state == StepState::Running
    }

    pub fn is_failed(&self) -> bool {
        matches!(self.state, StepState::Failed(_))
    }

    /// The step's value: its end, in ms from its section's `origin_ms`.
    pub(crate) fn value(&self, origin_ms: f64) -> SharedString {
        match self.state {
            StepState::Done(end) => format!("{:.0} ms", end - origin_ms).into(),
            StepState::Failed(_) => "failed".into(),
            StepState::Running => "…".into(),
            StepState::Skipped => "—".into(),
        }
    }
}

#[derive(Debug, Clone)]
pub(crate) struct Step {
    pub(crate) section: SharedString,
    pub(crate) label: SharedString,
    pub(crate) step: LoadStep,
}

/// What the frame sampler saw over the last [`WINDOW_MS`], as of `now_ms`.
#[derive(Debug, Clone, Default)]
pub(crate) struct Live {
    pub(crate) now_ms: f64,
    /// `requestAnimationFrame` times.
    pub(crate) stamps: Vec<f64>,
    /// Each frame GPUI drew: (start, ms of main-thread work).
    pub(crate) work: Vec<(f64, f64)>,
    pub(crate) memory: Option<SharedString>,
}

/// The span the live rows cover, in ms.
pub const WINDOW_MS: f64 = 2_000.0;

// Published row names the perf scripts read; don't rename them.
#[cfg_attr(
    not(any(target_family = "wasm", test)),
    expect(dead_code, reason = "only the web build publishes rows")
)]
const FRAMES_ROW: &str = "Frame time (2 s)";
#[cfg_attr(
    not(any(target_family = "wasm", test)),
    expect(dead_code, reason = "only the web build publishes rows")
)]
const WORK_ROW: &str = "Work per frame (2 s)";
pub(crate) const MEMORY_ROW: &str = "Memory";

impl Live {
    pub(crate) fn frame_stats(&self) -> Option<FrameStats> {
        frame_stats(&self.stamps)
    }

    pub(crate) fn work_stats(&self) -> Option<FrameStats> {
        sample_stats(self.work.iter().map(|(_, ms)| *ms).collect())
    }
}

/// Installs the panel state and its key bindings. `shared/`'s bootstrap
/// calls this after `gpui_kit::init`; apps don't need to.
pub fn init(cx: &mut App) {
    // Keeps anything an app set before init.
    let visible = requested_by_url();
    cx.default_global::<PerfOverlay>().visible = visible;
    // Both spellings: on wasm GPUI's `secondary` always means ctrl, but Mac
    // browsers report Cmd as the platform modifier.
    cx.bind_keys([
        KeyBinding::new("cmd-shift-p", TogglePerfOverlay, None),
        KeyBinding::new("ctrl-shift-p", TogglePerfOverlay, None),
    ]);
    cx.on_action(|_: &TogglePerfOverlay, cx| toggle(cx));
}

/// Shows or hides the panel.
pub fn toggle(cx: &mut App) {
    cx.default_global::<PerfOverlay>();
    cx.update_global::<PerfOverlay, _>(|overlay, _| overlay.visible = !overlay.visible);
    #[cfg(target_family = "wasm")]
    crate::frames::sync(cx);
}

/// Sets an app row, adding it at the end on first use. Rows keep the order
/// they were first set in.
///
/// Safe to call before [`init`] or where it never runs (native builds, tests):
/// the panel state is created on first use, hidden.
pub fn set_metric(cx: &mut App, label: impl Into<SharedString>, value: impl Into<SharedString>) {
    let (label, value) = (label.into(), value.into());
    if cx.try_global::<PerfOverlay>().is_some_and(|overlay| {
        overlay
            .metrics
            .iter()
            .any(|(existing, current)| *existing == label && *current == value)
    }) {
        // Unchanged: no redraw.
        return;
    }
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

/// Sets a waterfall step in `section`, adding it (and the section) at the end
/// on first use. Each section has its own time axis, starting at its earliest
/// step, and each step's value is its end on that axis: page-load steps read
/// as ms since navigation, an open's as ms since the click.
pub fn set_load_step(
    cx: &mut App,
    section: impl Into<SharedString>,
    label: impl Into<SharedString>,
    step: LoadStep,
) {
    let (section, label) = (section.into(), label.into());
    cx.default_global::<PerfOverlay>();
    cx.update_global::<PerfOverlay, _>(|overlay, _| {
        match overlay
            .steps
            .iter_mut()
            .find(|existing| existing.section == section && existing.label == label)
        {
            Some(existing) => existing.step = step,
            None => overlay.steps.push(Step {
                section,
                label,
                step,
            }),
        }
    });
}

/// Removes every step in `section`, e.g. before a new open starts its own.
pub fn clear_load_section(cx: &mut App, section: &str) {
    if cx
        .try_global::<PerfOverlay>()
        .is_some_and(|overlay| overlay.steps.iter().any(|step| step.section == section))
    {
        cx.update_global::<PerfOverlay, _>(|overlay, _| {
            overlay.steps.retain(|step| step.section != section)
        });
    }
}

/// Runs `refresh` at every panel refresh (~4 Hz) while the panel is open, to
/// update rows that change continuously (rates, counters). Rows set from
/// here cost nothing while the panel is closed.
pub fn on_refresh(cx: &mut App, refresh: impl Fn(&mut App) + 'static) {
    cx.default_global::<PerfOverlay>();
    cx.update_global::<PerfOverlay, _>(|overlay, _| overlay.refresh.push(Rc::new(refresh)));
}

/// Whether the panel is open.
pub fn is_visible(cx: &App) -> bool {
    cx.try_global::<PerfOverlay>()
        .is_some_and(PerfOverlay::is_visible)
}

/// Frame-time percentiles: of the intervals between `requestAnimationFrame`
/// timestamps ([`frame_stats`]), or of per-frame work ([`sample_stats`]).
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
    sample_stats(stamps.windows(2).map(|pair| pair[1] - pair[0]).collect())
}

/// `values` summarized with nearest-rank percentiles. `None` when empty.
pub fn sample_stats(mut values: Vec<f64>) -> Option<FrameStats> {
    if values.is_empty() {
        return None;
    }
    values.sort_by(f64::total_cmp);
    let rank =
        |p: f64| values[((p * values.len() as f64).ceil() as usize).clamp(1, values.len()) - 1];
    Some(FrameStats {
        frames: values.len(),
        p50: rank(0.5),
        p95: rank(0.95),
        max: values[values.len() - 1],
    })
}

/// "p50 16.7 · p95 16.7 · max 33 ms", or "…" with nothing to summarize.
pub(crate) fn format_stats(stats: Option<FrameStats>) -> SharedString {
    stats.map_or_else(
        || "…".into(),
        |stats| {
            format!(
                "p50 {:.1} · p95 {:.1} · max {:.0} ms",
                stats.p50, stats.p95, stats.max
            )
            .into()
        },
    )
}

/// Records TTFP once the first-frame mark is set.
#[cfg(target_family = "wasm")]
pub(crate) fn set_ttfp(cx: &mut App, ttfp_ms: f64) {
    cx.default_global::<PerfOverlay>();
    cx.update_global::<PerfOverlay, _>(|overlay, _| overlay.ttfp_ms = Some(ttfp_ms));
}

/// Stores a refresh's frame sample.
#[cfg(target_family = "wasm")]
pub(crate) fn set_live(cx: &mut App, live: Live) {
    cx.update_global::<PerfOverlay, _>(|overlay, _| overlay.live = live);
}

/// The app's refresh callbacks.
#[cfg(target_family = "wasm")]
pub(crate) fn refresh_callbacks(cx: &App) -> Vec<RefreshCallback> {
    cx.try_global::<PerfOverlay>()
        .map(|overlay| overlay.refresh.clone())
        .unwrap_or_default()
}

/// What the panel draws, read in one place.
pub(crate) struct Snapshot<'a> {
    pub(crate) ttfp_ms: Option<f64>,
    pub(crate) steps: &'a [Step],
    pub(crate) metrics: &'a [(SharedString, SharedString)],
    pub(crate) live: &'a Live,
}

impl PerfOverlay {
    pub(crate) fn snapshot(&self) -> Snapshot<'_> {
        Snapshot {
            ttfp_ms: self.ttfp_ms,
            steps: &self.steps,
            metrics: &self.metrics,
            live: &self.live,
        }
    }
}

impl Snapshot<'_> {
    /// The sections, in the order first set, each with its origin (its
    /// earliest step's start) and its steps.
    pub(crate) fn sections(&self) -> Vec<(SharedString, f64, Vec<&Step>)> {
        let mut sections: Vec<(SharedString, f64, Vec<&Step>)> = Vec::new();
        for step in self.steps {
            match sections
                .iter_mut()
                .find(|(section, _, _)| *section == step.section)
            {
                Some((_, origin, steps)) => {
                    *origin = origin.min(step.step.start_ms);
                    steps.push(step);
                }
                None => sections.push((step.section.clone(), step.step.start_ms, vec![step])),
            }
        }
        sections
    }

    #[cfg_attr(
        not(any(target_family = "wasm", test)),
        expect(dead_code, reason = "only the web build publishes rows")
    )]
    /// Every row the panel shows, as `[label, value]`: TTFP, the waterfall
    /// steps, the frame rows, then the app's rows.
    pub(crate) fn rows(&self) -> Vec<(SharedString, SharedString)> {
        let ttfp = self
            .ttfp_ms
            .map_or_else(|| "…".into(), |ms| format!("{ms:.0} ms").into());
        let mut rows = vec![(SharedString::from("TTFP"), ttfp)];
        for (_, origin, steps) in self.sections() {
            rows.extend(
                steps
                    .into_iter()
                    .map(|step| (step.label.clone(), step.step.value(origin))),
            );
        }
        rows.push((FRAMES_ROW.into(), format_stats(self.live.frame_stats())));
        rows.push((WORK_ROW.into(), format_stats(self.live.work_stats())));
        rows.push((
            MEMORY_ROW.into(),
            self.live.memory.clone().unwrap_or_else(|| "…".into()),
        ));
        rows.extend(self.metrics.iter().cloned());
        rows
    }
}

/// Whether the page URL asks for the panel (`?perf`).
fn requested_by_url() -> bool {
    crate::url::has_param("perf")
}

/// Mirrors the panel's rows to `globalThis.__seizaPerfOverlay`
/// (`[[label, value], …]`, or `undefined` while hidden), and the time they
/// were taken (ms from `timeOrigin`) to `globalThis.__seizaPerfOverlayAt`,
/// so the Playwright suite can check the drawn values against its own
/// measurements over the same window.
#[cfg(target_family = "wasm")]
pub(crate) fn publish(cx: &App) {
    use wasm_bindgen::JsValue;

    let global = js_sys::global();
    let rows_key = JsValue::from_str("__seizaPerfOverlay");
    let at_key = JsValue::from_str("__seizaPerfOverlayAt");
    let Some(overlay) = cx.try_global::<PerfOverlay>().filter(|o| o.visible) else {
        let _ = js_sys::Reflect::delete_property(&global, &rows_key);
        let _ = js_sys::Reflect::delete_property(&global, &at_key);
        let _ = js_sys::Reflect::delete_property(&global, &RECT_KEY.into());
        return;
    };
    let snapshot = overlay.snapshot();
    let array: js_sys::Array = snapshot
        .rows()
        .iter()
        .map(|(label, value)| js_sys::Array::of2(&label.as_ref().into(), &value.as_ref().into()))
        .collect();
    let _ = js_sys::Reflect::set(&global, &rows_key, &array);
    let _ = js_sys::Reflect::set(&global, &at_key, &JsValue::from_f64(snapshot.live.now_ms));
}

#[cfg(target_family = "wasm")]
const RECT_KEY: &str = "__seizaPerfOverlayRect";

/// Mirrors the open panel's bounds to `globalThis.__seizaPerfOverlayRect`
/// (`[x, y, width, height]`, CSS pixels from the canvas's top-left; removed
/// while hidden, by [`publish`]).
#[cfg(target_family = "wasm")]
pub(crate) fn publish_rect(bounds: Bounds<Pixels>) {
    use wasm_bindgen::JsValue;

    let rect: js_sys::Array = [
        bounds.origin.x,
        bounds.origin.y,
        bounds.size.width,
        bounds.size.height,
    ]
    .into_iter()
    .map(|value| JsValue::from_f64(f32::from(value).into()))
    .collect();
    let _ = js_sys::Reflect::set(&js_sys::global(), &RECT_KEY.into(), &rect);
}

#[cfg(test)]
mod tests {
    // Not `super::*`: that brings gpui's `test` attribute over std's.
    use super::{LoadStep, Snapshot, Step, frame_stats, sample_stats};

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

    #[test]
    fn sample_stats_summarize_values() {
        assert_eq!(sample_stats(vec![]), None);
        let stats = sample_stats(vec![3.0, 1.0, 2.0, 10.0]).unwrap();
        assert_eq!(
            (stats.frames, stats.p50, stats.p95, stats.max),
            (4, 2.0, 10.0, 10.0)
        );
    }

    #[test]
    fn sections_have_their_own_origin() {
        let step = |section: &str, label: &str, step| Step {
            section: section.to_string().into(),
            label: label.to_string().into(),
            step,
        };
        let steps = [
            step("Page load", "HTML", LoadStep::done(0.0, 12.0)),
            step("Open", "Schema", LoadStep::done(5_000.0, 5_097.0)),
            step("Page load", "Engine", LoadStep::running(200.0)),
            step("Open", "First rows", LoadStep::skipped(5_000.0)),
        ];
        let live = Default::default();
        let snapshot = Snapshot {
            ttfp_ms: Some(170.4),
            steps: &steps,
            metrics: &[],
            live: &live,
        };
        let sections = snapshot.sections();
        assert_eq!(sections.len(), 2);
        assert_eq!((sections[1].1, sections[1].2.len()), (5_000.0, 2));
        let rows: Vec<(String, String)> = snapshot
            .rows()
            .into_iter()
            .map(|(label, value)| (label.to_string(), value.to_string()))
            .collect();
        let row = |label: &str| rows.iter().find(|(l, _)| l == label).unwrap().1.clone();
        assert_eq!(row("TTFP"), "170 ms");
        assert_eq!(row("HTML"), "12 ms");
        assert_eq!(row("Engine"), "…");
        assert_eq!(row("Schema"), "97 ms");
        assert_eq!(row("First rows"), "—");
    }
}
