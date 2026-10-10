//! The perf panel's live sample: frame intervals, per-frame work, memory.
//!
//! **Frame interval** is the time between `requestAnimationFrame` callbacks:
//! a frame that GPUI (or anything else on the main thread) holds up shows as
//! a long interval, and a steady 60 Hz shows as ~16.7 ms whether a frame took
//! 1 ms or 12. GPUI's own frame loop only runs when something changed, so the
//! sampler keeps its own rAF loop.
//!
//! **Work per frame** is the main-thread time of each frame GPUI draws: from
//! the shell's render (the start of the window's layout) to the end of the
//! callback that drew and presented it, timed by a microtask queued at the
//! render (see `first_frame.rs`: GPUI draws and presents in one callback).
//! It shows the headroom the interval can't.
//!
//! Both run only while the panel is open: an idle page shouldn't tick at
//! 60 Hz for a hidden panel. The panel refreshes every [`REFRESH_EVERY`].

use std::cell::{Cell, RefCell};
use std::collections::VecDeque;
use std::rc::Rc;
use std::time::Duration;

use gpui_kit::{App, Task};
use wasm_bindgen::{JsCast as _, JsValue, closure::Closure};

use crate::marks::{mark_time, now};
use crate::perf::{LoadStep, PAGE_LOAD, WINDOW_MS};

/// ~4 Hz: often enough to watch, rare enough not to cost the frames it shows.
const REFRESH_EVERY: Duration = Duration::from_millis(250);

thread_local! {
    /// rAF timestamps from the last `WINDOW_MS`.
    static STAMPS: RefCell<VecDeque<f64>> = const { RefCell::new(VecDeque::new()) };
    /// (start, ms) of each frame drawn in the last `WINDOW_MS`.
    static WORK: RefCell<VecDeque<(f64, f64)>> = const { RefCell::new(VecDeque::new()) };
    /// Whether frames are sampled: the panel is open and the first frame out.
    static SAMPLING: Cell<bool> = const { Cell::new(false) };
    /// The start of the frame being drawn, until its microtask runs.
    static FRAME_START: Cell<Option<f64>> = const { Cell::new(None) };
    /// The microtask that ends a frame's work, reused for every frame.
    static FRAME_END: RefCell<Option<Closure<dyn FnMut()>>> = const { RefCell::new(None) };
    /// The running rAF loop's id, or 0 for none. Each loop checks it's still
    /// the one: hiding and re-showing the panel between two frames would
    /// otherwise leave the old loop running beside the new one, recording
    /// every frame twice.
    static LIVE_LOOP: Cell<u64> = const { Cell::new(0) };
    static LOOPS_STARTED: Cell<u64> = const { Cell::new(0) };
    /// The panel's refresh, while it's open.
    static REFRESH: RefCell<Option<Task<()>>> = const { RefCell::new(None) };
    /// Whether the first frame is out; nothing samples before it.
    static STARTED: Cell<bool> = const { Cell::new(false) };
    /// The page has a placeholder whose paint mark hadn't arrived by the
    /// first frame: Element Timing entries reach their observer
    /// asynchronously, sometimes after it, though the paint came first.
    static PLACEHOLDER_PENDING: Cell<bool> = const { Cell::new(false) };
}

/// Called once, after the first frame: records the page-load steps up to
/// it, and from then on samples whenever the panel is open.
pub(crate) fn start(cx: &mut App, ttfp_ms: Option<f64>) {
    record_page_load(cx, ttfp_ms);
    STARTED.set(true);
    sync(cx);
}

/// Starts or stops sampling to match the panel's visibility. The panel's
/// toggle calls this, so a hidden panel costs nothing: no timer, no rAF loop,
/// no per-frame timing.
pub(crate) fn sync(cx: &mut App) {
    let visible = crate::perf::is_visible(cx);
    if !visible || !STARTED.get() {
        // Dropping the task cancels it.
        REFRESH.take();
        SAMPLING.set(false);
        LIVE_LOOP.set(0);
        STAMPS.with_borrow_mut(VecDeque::clear);
        WORK.with_borrow_mut(VecDeque::clear);
        crate::perf::publish(cx);
        return;
    }
    if REFRESH.with_borrow(Option::is_some) {
        return;
    }
    SAMPLING.set(true);
    run_loop();
    refresh(cx);
    let task = cx.spawn(async move |cx| {
        loop {
            cx.background_executor().timer(REFRESH_EVERY).await;
            cx.update(refresh);
        }
    });
    REFRESH.set(Some(task));
}

/// Takes the sample, runs the app's refresh callbacks, and publishes.
fn refresh(cx: &mut App) {
    let now = now();
    let stamps = STAMPS.with_borrow_mut(|stamps| {
        trim(stamps, now, |stamp| *stamp);
        stamps.iter().copied().collect()
    });
    let work = WORK.with_borrow_mut(|work| {
        trim(work, now, |(start, _)| *start);
        work.iter().copied().collect()
    });
    crate::perf::set_live(
        cx,
        crate::perf::Live {
            now_ms: now,
            stamps,
            work,
            memory: Some(memory().into()),
        },
    );
    if PLACEHOLDER_PENDING.get() {
        PLACEHOLDER_PENDING.set(!record_placeholder(cx));
    }
    for callback in crate::perf::refresh_callbacks(cx) {
        callback(cx);
    }
    crate::perf::publish(cx);
}

fn trim<T>(samples: &mut VecDeque<T>, now: f64, time: impl Fn(&T) -> f64) {
    while samples
        .front()
        .is_some_and(|first| now - time(first) > WINDOW_MS)
    {
        samples.pop_front();
    }
}

/// Called by the shell's render, at the start of every frame GPUI draws.
/// Times the frame's work while sampling: one `performance.now()` here and
/// one in a microtask that runs once the drawing callback returns.
pub(crate) fn frame_started() {
    if !SAMPLING.get() || FRAME_START.get().is_some() {
        return;
    }
    let Some(window) = web_sys::window() else {
        return;
    };
    FRAME_START.set(Some(now()));
    FRAME_END.with_borrow_mut(|end| {
        let end = end.get_or_insert_with(|| {
            Closure::new(|| {
                let Some(start) = FRAME_START.take() else {
                    return;
                };
                if SAMPLING.get() {
                    let work = now() - start;
                    WORK.with_borrow_mut(|samples| samples.push_back((start, work)));
                }
            })
        });
        window.queue_microtask(end.as_ref().unchecked_ref());
    });
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
            trim(stamps, time, |stamp| *stamp);
        });
        if let (Some(window), Some(closure)) = (web_sys::window(), next.borrow().as_ref()) {
            let _ = window.request_animation_frame(closure.as_ref().unchecked_ref());
        }
    }));
    if let (Some(window), Some(closure)) = (web_sys::window(), callback.borrow().as_ref()) {
        let _ = window.request_animation_frame(closure.as_ref().unchecked_ref());
    }
}

/// The page-load steps up to the first frame, from the navigation's and the
/// wasm's timings and the bootstrap's marks (`shared-web/src/bootstrap.ts`):
/// the HTML, the static placeholder's paint (when the page has one; its
/// own metric, never TTFP), the wasm's download, its compile (what's left of
/// it once the download ends: compilation streams), and the first frame.
fn record_page_load(cx: &mut App, ttfp_ms: Option<f64>) {
    let html = navigation_response_end();
    let requested = mark_time("seiza:wasm-requested");
    let downloaded = mark_time("seiza:wasm-downloaded");
    let ready = mark_time("seiza:wasm-ready");
    if let Some(end) = html {
        crate::perf::set_load_step(cx, PAGE_LOAD, "HTML", LoadStep::done(0.0, end));
    }
    PLACEHOLDER_PENDING.set(has_placeholder() && !record_placeholder(cx));
    if let (Some(start), Some(end)) = (requested, downloaded) {
        crate::perf::set_load_step(cx, PAGE_LOAD, "Wasm download", LoadStep::done(start, end));
    }
    if let (Some(start), Some(end)) = (downloaded, ready) {
        crate::perf::set_load_step(cx, PAGE_LOAD, "Compile", LoadStep::done(start, end));
    }
    if let (Some(start), Some(end)) = (ready.or(html), ttfp_ms) {
        crate::perf::set_load_step(cx, PAGE_LOAD, "First frame", LoadStep::done(start, end));
    }
}

/// The placeholder's paint step, if its mark is set (`shared-web`'s
/// placeholder sets it). Returns whether it was.
fn record_placeholder(cx: &mut App) -> bool {
    let Some(end) = mark_time("seiza:placeholder-painted") else {
        return false;
    };
    crate::perf::set_load_step(cx, PAGE_LOAD, "Placeholder", LoadStep::done(0.0, end));
    true
}

/// Whether the page was served with a placeholder: it's still in the page at
/// the first frame (it fades out after).
fn has_placeholder() -> bool {
    web_sys::window()
        .and_then(|window| window.document())
        .and_then(|document| document.get_element_by_id("seiza-placeholder"))
        .is_some()
}

fn navigation_response_end() -> Option<f64> {
    let performance = web_sys::window()?.performance()?;
    let entry = performance.get_entries_by_type("navigation").get(0);
    js_sys::Reflect::get(&entry, &JsValue::from_str("responseEnd"))
        .ok()?
        .as_f64()
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
