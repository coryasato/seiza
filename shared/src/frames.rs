//! The perf overlay's live rows: frame times and memory.
//!
//! Frame time is the interval between `requestAnimationFrame` callbacks: a
//! frame that GPUI (or anything else on the main thread) holds up shows as a
//! long interval, and a steady 60 Hz shows as ~16.7 ms. GPUI's own frame loop
//! only runs when something changed, so the sampler keeps its own rAF loop,
//! and only while the overlay is visible: an idle page shouldn't tick at
//! 60 Hz for a hidden panel.

use std::cell::{Cell, RefCell};
use std::collections::VecDeque;
use std::rc::Rc;
use std::time::Duration;

use gpui_kit::{App, Task};
use wasm_bindgen::{JsCast as _, JsValue, closure::Closure};

use crate::perf::{FrameStats, PerfOverlay, frame_stats};

/// The window the stats cover, in ms.
const WINDOW_MS: f64 = 2_000.0;
/// How often the overlay's rows refresh.
const REFRESH_EVERY: Duration = Duration::from_millis(500);

pub(crate) const FRAMES_METRIC: &str = "Frame time (2 s)";
pub(crate) const MEMORY_METRIC: &str = "Memory";

thread_local! {
    /// rAF timestamps from the last `WINDOW_MS`.
    static STAMPS: RefCell<VecDeque<f64>> = const { RefCell::new(VecDeque::new()) };
    /// The running rAF loop's id, or 0 for none. Each loop checks it's still
    /// the one: hiding and re-showing the overlay between two frames would
    /// otherwise leave the old loop running beside the new one, recording
    /// every frame twice.
    static LIVE_LOOP: Cell<u64> = const { Cell::new(0) };
    static LOOPS_STARTED: Cell<u64> = const { Cell::new(0) };
    /// The overlay rows' refresh, while the overlay is visible.
    static REFRESH: RefCell<Option<Task<()>>> = const { RefCell::new(None) };
    /// Whether the first frame is out; nothing samples before it.
    static STARTED: Cell<bool> = const { Cell::new(false) };
}

/// Called once, after the first frame: from then on the rows refresh
/// whenever the overlay is visible.
pub(crate) fn start(cx: &mut App) {
    STARTED.set(true);
    sync(cx);
}

/// Starts or stops the refresh to match the overlay's visibility. The
/// overlay's toggle calls this, so a hidden overlay costs nothing: no timer,
/// no rAF loop.
pub(crate) fn sync(cx: &mut App) {
    let visible = cx
        .try_global::<PerfOverlay>()
        .is_some_and(PerfOverlay::is_visible);
    if !visible || !STARTED.get() {
        // Dropping the task cancels it.
        REFRESH.take();
        LIVE_LOOP.set(0);
        STAMPS.with_borrow_mut(VecDeque::clear);
        return;
    }
    if REFRESH.with_borrow(Option::is_some) {
        return;
    }
    run_loop();
    let refresh = cx.spawn(async move |cx| {
        loop {
            cx.background_executor().timer(REFRESH_EVERY).await;
            let frames = STAMPS.with_borrow(|stamps| {
                let stamps: Vec<f64> = stamps.iter().copied().collect();
                frame_stats(&stamps)
            });
            let frames = frames.map_or_else(|| "…".to_string(), |stats| format_frames(&stats));
            let memory = memory();
            cx.update(|cx| {
                crate::perf::set_metric_if_changed(cx, FRAMES_METRIC, frames);
                crate::perf::set_metric_if_changed(cx, MEMORY_METRIC, memory);
            });
        }
    });
    REFRESH.set(Some(refresh));
}

fn format_frames(stats: &FrameStats) -> String {
    format!(
        "p50 {:.1} · p95 {:.1} · max {:.0} ms",
        stats.p50, stats.p95, stats.max
    )
}

/// A rAF loop that records each callback's timestamp, until another loop
/// replaces it or `LIVE_LOOP` is cleared.
fn run_loop() {
    let id = LOOPS_STARTED.get() + 1;
    LOOPS_STARTED.set(id);
    LIVE_LOOP.set(id);
    type Callback = Closure<dyn FnMut(f64)>;
    let callback: Rc<RefCell<Option<Callback>>> = Rc::new(RefCell::new(None));
    let next = callback.clone();
    *callback.borrow_mut() = Some(Closure::new(move |time: f64| {
        if LIVE_LOOP.get() != id {
            // Drops the closure (and this loop) on the way out.
            next.borrow_mut().take();
            return;
        }
        STAMPS.with_borrow_mut(|stamps| {
            stamps.push_back(time);
            while stamps.front().is_some_and(|first| time - first > WINDOW_MS) {
                stamps.pop_front();
            }
        });
        if let (Some(window), Some(closure)) = (web_sys::window(), next.borrow().as_ref()) {
            let _ = window.request_animation_frame(closure.as_ref().unchecked_ref());
        }
    }));
    if let (Some(window), Some(closure)) = (web_sys::window(), callback.borrow().as_ref()) {
        let _ = window.request_animation_frame(closure.as_ref().unchecked_ref());
    }
}

/// The app's wasm memory, and the JS heap where the browser reports it
/// (Chromium's non-standard `performance.memory`). Wasm memory only grows,
/// so it's also the peak.
fn memory() -> String {
    let wasm = js_sys::Reflect::get(&wasm_bindgen::memory(), &JsValue::from_str("buffer"))
        .and_then(|buffer| js_sys::Reflect::get(&buffer, &JsValue::from_str("byteLength")))
        .ok()
        .and_then(|bytes| bytes.as_f64());
    let js = web_sys::window()
        .and_then(|window| window.performance())
        .and_then(|performance| {
            js_sys::Reflect::get(&performance, &JsValue::from_str("memory")).ok()
        })
        .filter(|memory| memory.is_object())
        .and_then(|memory| js_sys::Reflect::get(&memory, &JsValue::from_str("usedJSHeapSize")).ok())
        .and_then(|bytes| bytes.as_f64());
    let mib = |bytes: Option<f64>| {
        bytes.map_or("—".into(), |bytes| format!("{:.1}", bytes / 1_048_576.0))
    };
    format!("wasm {} · JS {} MiB", mib(wasm), mib(js))
}
