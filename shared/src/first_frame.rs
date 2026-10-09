//! The `gpui:first-frame` performance mark every TTFP measurement reads.

use crate::marks::mark_after_current_task;

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
