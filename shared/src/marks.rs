//! The page clock and `performance.mark`s, in one place.
//!
//! Every time the panel shows and every mark the Playwright suite reads is in
//! ms from `performance.timeOrigin`. A mark can be set more than once (an
//! engine retry sets its marks again), and readers always take the **last**
//! entry: the latest attempt is the one on screen.

use js_sys::{Function, Object, Promise, Reflect};
use wasm_bindgen::{JsCast as _, JsValue, closure::Closure};
use wasm_bindgen_futures::JsFuture;

/// `performance.now()`: ms from `performance.timeOrigin`.
pub fn now() -> f64 {
    web_sys::window()
        .and_then(|window| window.performance())
        .map_or(0.0, |performance| performance.now())
}

/// The last `performance.mark` named `name`, in ms from `timeOrigin`.
pub fn mark_time(name: &str) -> Option<f64> {
    let performance = web_sys::window()?.performance()?;
    let entries = performance.get_entries_by_name_with_entry_type(name, "mark");
    let entry = entries.get(entries.length().checked_sub(1)?);
    entry
        .dyn_into::<web_sys::PerformanceEntry>()
        .ok()
        .map(|entry| entry.start_time())
}

/// Sets `performance.mark(name)` now, and returns its `startTime`.
pub fn mark(name: &str) -> Option<f64> {
    set_mark(name, None)
}

/// Sets `performance.mark(name)` at `at` (ms from `timeOrigin`): when a
/// click, drop, or choice happened rather than when it was handled.
pub fn mark_at(name: &str, at: f64) {
    set_mark(name, Some(at));
}

/// `performance.mark(name, { startTime })`, through `Reflect`: web-sys has
/// the options type only behind its unstable-APIs flag, and its `mark`
/// drops the returned `PerformanceMark`, whose `startTime` saves a lookup.
fn set_mark(name: &str, at: Option<f64>) -> Option<f64> {
    let performance = web_sys::window()?.performance()?;
    let options = Object::new();
    if let Some(at) = at {
        Reflect::set(&options, &"startTime".into(), &JsValue::from_f64(at)).ok()?;
    }
    let entry = Reflect::get(&performance, &"mark".into())
        .ok()?
        .unchecked_into::<Function>()
        .call2(&performance, &JsValue::from_str(name), &options)
        .ok()?;
    Reflect::get(&entry, &"startTime".into()).ok()?.as_f64()
}

/// Sets `performance.mark(name)` as soon as the current JS callback returns,
/// and resolves with its `startTime` (ms from `performance.timeOrigin`).
///
/// Called from a view's `render`, the mark lands right after the frame that
/// render is part of has been presented: GPUI draws and presents in one
/// callback (see `first_frame.rs`). Apps use it to time "the user can see X"
/// rather than "X's data arrived".
pub fn mark_after_current_task(name: &'static str) -> impl Future<Output = Option<f64>> {
    let promise = Promise::new(&mut |resolve, _reject| {
        let marked = Closure::once_into_js(move || {
            let start_time = mark(name);
            let _ = resolve.call1(
                &JsValue::NULL,
                &start_time.map_or(JsValue::NULL, JsValue::from),
            );
        });
        if let Some(window) = web_sys::window() {
            window.queue_microtask(marked.unchecked_ref());
        }
    });
    // Queued now, not when the returned future is first polled: GPUI's
    // executor may poll a spawned task only after the frame has moved on.
    let marked = JsFuture::from(promise);
    async move { marked.await.ok()?.as_f64() }
}
