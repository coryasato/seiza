//! The perf overlay: the numbers behind every claim, drawn on the canvas.
//!
//! It owns the common metrics (TTFP today; frame times and wasm memory later)
//! and lets apps add their own rows with [`set_metric`]. Toggle it with
//! Cmd/Ctrl+Shift+P, or open the page with `?perf` in the URL.

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
    #[cfg(target_family = "wasm")]
    {
        web_sys::window()
            .and_then(|window| window.location().search().ok())
            .and_then(|search| web_sys::UrlSearchParams::new_with_str(&search).ok())
            .is_some_and(|params| params.has("perf"))
    }
    #[cfg(not(target_family = "wasm"))]
    false
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
