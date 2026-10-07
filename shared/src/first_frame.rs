//! The `gpui:first-frame` performance mark every TTFP measurement reads.

use js_sys::Promise;
use wasm_bindgen::{JsCast as _, JsValue, closure::Closure};
use wasm_bindgen_futures::JsFuture;

/// The `performance.mark` name for the first frame GPUI presents. The perf
/// overlay and the Playwright suite both read it; don't rename it.
pub const FIRST_FRAME_MARK: &str = "gpui:first-frame";

/// Sets [`FIRST_FRAME_MARK`] as soon as the current JS callback returns, and
/// resolves with the mark's `startTime` (ms from `performance.timeOrigin`):
/// the TTFP the overlay shows.
///
/// Call it from the first render that has a real (non-zero) viewport. In
/// gpui-pre 0.3.8 that render always runs inside a draw that presents before
/// its callback returns, so the microtask queued here lands right after the
/// first present, on either graphics backend:
///
/// - The window starts at 0×0 (`WebWindow::new`), so `open_window`'s
///   synchronous first draw has nothing to show and doesn't count.
/// - The first real size arrives in gpui-pre-web's `ResizeObserver` callback,
///   which renders and presents synchronously (`force_render`), before the
///   browser paints that frame. With WebGPU, whose setup is async, it can
///   instead be GPUI's frame-loop rAF, which also draws then presents.
///
/// An earlier version marked in a `requestAnimationFrame` requested from the
/// first render. That depended on rAF ordering: it landed a frame late with
/// WebGPU, and a frame early with WebGL2 once requested synchronously.
/// Re-check this on every gpui-kit bump: the Playwright suite's first-draw
/// probe (`perf/perf.ts`) fails if the mark isn't right after the first GPU
/// work.
pub(crate) fn mark_first_frame() -> impl Future<Output = Option<f64>> {
    mark_after_current_task(FIRST_FRAME_MARK)
}

/// Sets `performance.mark(name)` as soon as the current JS callback returns,
/// and resolves with its `startTime` (ms from `performance.timeOrigin`).
///
/// Called from a view's `render`, the mark lands right after the frame that
/// render is part of has been presented: GPUI draws and presents in one
/// callback (see [`mark_first_frame`]). Apps use it to time "the user can
/// see X" rather than "X's data arrived".
pub fn mark_after_current_task(name: &'static str) -> impl Future<Output = Option<f64>> {
    let promise = Promise::new(&mut |resolve, _reject| {
        let mark = Closure::once_into_js(move || {
            let start_time = web_sys::window()
                .and_then(|window| window.performance())
                .and_then(|performance| {
                    performance.mark(name).ok()?;
                    // The last entry is the mark just set, even if an older
                    // one with the same name exists.
                    let entries = performance.get_entries_by_name_with_entry_type(name, "mark");
                    let entry = entries.get(entries.length().checked_sub(1)?);
                    Some(
                        entry
                            .unchecked_into::<web_sys::PerformanceEntry>()
                            .start_time(),
                    )
                });
            let _ = resolve.call1(
                &JsValue::NULL,
                &start_time.map_or(JsValue::NULL, JsValue::from),
            );
        });
        if let Some(window) = web_sys::window() {
            window.queue_microtask(mark.unchecked_ref());
        }
    });
    // Queued now, not when the returned future is first polled: GPUI's
    // executor may poll a spawned task only after the frame has moved on.
    let marked = JsFuture::from(promise);
    async move { marked.await.ok()?.as_f64() }
}
