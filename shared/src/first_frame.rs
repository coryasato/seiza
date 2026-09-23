//! The `gpui:first-frame` performance mark every TTFP measurement reads.

use js_sys::Promise;
use wasm_bindgen::{JsCast as _, JsValue, closure::Closure};
use wasm_bindgen_futures::JsFuture;

/// The `performance.mark` name for the first frame GPUI presents. The perf
/// overlay and the Playwright suite both read it; don't rename it.
pub const FIRST_FRAME_MARK: &str = "gpui:first-frame";

/// Resolves in the first `requestAnimationFrame` after the caller's draw,
/// after setting [`FIRST_FRAME_MARK`].
///
/// Call it from the first render. The timing depends on gpui-pre 0.3.5
/// internals, so re-check it on every gpui-kit bump:
///
/// 1. `cx.open_window` draws the first frame synchronously, outside any
///    animation frame (`app.rs`: "allow a window to draw at least once before
///    returning"). That draw builds the scene but presents nothing.
/// 2. `WebWindow::new` already requested GPUI's frame-loop rAF before that
///    draw. The rAF requested here is queued after it.
/// 3. Browsers run rAF callbacks in request order, so GPUI's callback presents
///    the first scene, then this one sets the mark in the same turn.
///
/// So the mark lands just after the first present, and only because GPUI's
/// rAF is registered first. If that order ever flips, the mark would fire
/// before anything is presented and TTFP would read low. M1's Playwright
/// check (overlay TTFP vs trace) is the guard. The mark is set directly in
/// the callback rather than after the future resumes, so executor scheduling
/// can't inflate the number.
pub(crate) async fn mark_after_next_frame() {
    let promise = Promise::new(&mut |resolve, _reject| {
        let on_frame = Closure::once_into_js(move || {
            if let Some(performance) = web_sys::window().and_then(|window| window.performance()) {
                let _ = performance.mark(FIRST_FRAME_MARK);
            }
            let _ = resolve.call0(&JsValue::NULL);
        });
        if let Some(window) = web_sys::window() {
            let _ = window.request_animation_frame(on_frame.unchecked_ref());
        }
    });
    let _ = JsFuture::from(promise).await;
}
