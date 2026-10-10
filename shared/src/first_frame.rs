//! The `gpui:first-frame` performance mark every TTFP measurement reads.

use crate::marks::mark_after_current_task_then;

/// The id of the page's static placeholder shell (`shared-web/src/placeholder.ts`),
/// drawn in HTML before the wasm arrives. Don't rename it.
const PLACEHOLDER_ID: &str = "seiza-placeholder";
/// The class that starts it leaving. Don't rename it.
const PLACEHOLDER_LEAVING: &str = "sz-leaving";

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
///
/// The same microtask starts the page's placeholder shell leaving, if it has
/// one: it fades out over the first frame, which is already presented, so
/// the browser never renders a frame with neither. A fade, not a cut: GPUI
/// and the browser rasterize and round text differently, and an instant swap
/// read as a jump (Tycho M7 part G).
pub(crate) fn mark_first_frame() -> impl Future<Output = Option<f64>> {
    mark_after_current_task_then(FIRST_FRAME_MARK, release_placeholder)
}

/// Adds [`PLACEHOLDER_LEAVING`]; `shared-web`'s placeholder fades out and
/// removes itself.
fn release_placeholder() {
    if let Some(placeholder) = web_sys::window()
        .and_then(|window| window.document())
        .and_then(|document| document.get_element_by_id(PLACEHOLDER_ID))
    {
        let _ = placeholder.class_list().add_1(PLACEHOLDER_LEAVING);
    }
}
