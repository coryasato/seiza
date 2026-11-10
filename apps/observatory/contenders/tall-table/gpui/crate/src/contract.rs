//! The contender contract (`apps/observatory/docs/contender-contract.md`),
//! from the table's events (through `tall-table-bridge`, as every host of the
//! table does): the `contender:open` and `contender:filled`
//! marks (always), `__contender.state` and the targets (with `?measure`),
//! the probe key's `contender:input` (with `?measure`), the drawn cells and
//! the columns' budgets (with `?cells`, for the tall table's cell fixture),
//! the page's theme, and the entry points the JS host's replay hooks call. The page's other
//! marks (`first-pixels`, `usable`) and the `postMessage` relay are the JS
//! host's (`web/src/main.ts`), from marks the bootstrap already sets.

use std::cell::{Cell, RefCell};

use gpui_kit::component::{Theme, ThemeMode};
use gpui_kit::*;
use js_sys::{Object, Reflect};
use seiza_tall_table::{TallTableEvent, TallTableProbe};
use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::*;

use crate::host::{Host, Table};

/// The host starts opening the file (the engine is ready).
const OPEN_MARK: &str = "contender:open";
/// Right after each frame in which the viewport became filled.
const FILLED_MARK: &str = "contender:filled";
/// Right after the frame that drew the probe key (`?measure`).
const INPUT_MARK: &str = "contender:input";
/// The host shows a failure: no `contender:filled` is coming.
const FAILED_MARK: &str = "contender:failed";
/// With `?measure`, right after each frame that first draws a re-read
/// (`live`): market watch's Shown in reads it (`docs/contender-contract.md`).
#[cfg(feature = "market")]
const REFRESHED_MARK: &str = "contender:refreshed";
/// With `?measure`, the highest generation drawn, raised in the frame that
/// draws it, before its mark (the bridge's).
#[cfg(feature = "market")]
const REFRESHED_GLOBAL: &str = "__contenderRefreshed";
/// With `?measure`, right after each frame whose drawn tail grew while
/// following (`TailDrawn`): live tail's Row shown in reads it.
#[cfg(feature = "tail")]
const TAIL_MARK: &str = "contender:tail";
/// With `?measure`, the end of the tail last drawn, set in the frame that
/// draws it, before its mark (the bridge's).
#[cfg(feature = "tail")]
const TAIL_GLOBAL: &str = "__contenderTail";
/// With `?measure`, whether the view follows the tail, set as it changes.
#[cfg(feature = "tail")]
const FOLLOWING_GLOBAL: &str = "__contenderFollowing";

/// Whether the page was opened for measuring (`?measure`): only then are
/// `__contender.state` and the targets published.
pub fn measuring() -> bool {
    thread_local! {
        static MEASURING: bool = seiza::url::has_param("measure");
    }
    MEASURING.with(|measuring| *measuring)
}

/// Whether the page was opened to pin the cell fixture (`?cells`): only
/// then does the table probe its cells, and `__contender.cells` and
/// `__contender.columns` are published. Never in a measured run: the probe
/// formats every cell twice.
pub fn probing_cells() -> bool {
    thread_local! {
        static PROBING: bool = seiza::url::has_param("cells");
    }
    PROBING.with(|probing| *probing)
}

/// What the last frame showed, for `__contender.state`: the table's probe
/// and row height, the scrollbar's track, and the cache's bytes.
#[derive(Default)]
struct Shown {
    probe: Option<TallTableProbe>,
    row_height: Option<f32>,
    /// The cells' top-left corner, CSS px.
    cells: Option<(f32, f32)>,
    track: Option<Bounds<Pixels>>,
    cache_bytes: usize,
}

thread_local! {
    static SHOWN: RefCell<Shown> = RefCell::new(Shown::default());
    /// The shown table's rows and row height (CSS px), for the replay's
    /// fling; zero until its first frame.
    static GEOMETRY: Cell<(f64, f64)> = const { Cell::new((0.0, 0.0)) };
    /// How many frames reported a changed view, and whether the last one
    /// had every visible row loaded, for the replay's waits.
    static VIEW: Cell<(u32, bool)> = const { Cell::new((0, false)) };
    /// A read of the cache's bytes is already scheduled.
    static CACHE_READ_PENDING: Cell<bool> = const { Cell::new(false) };
    static HOST: RefCell<Option<(WeakEntity<Host>, AnyWindowHandle, AsyncApp)>> =
        const { RefCell::new(None) };
    static PROBE_KEY: Cell<ProbeKey> = const { Cell::new(ProbeKey::Waiting) };
    /// A theme the page sent before the host was installed.
    static PENDING_THEME: RefCell<Option<String>> = const { RefCell::new(None) };
}

/// The probe key (`?measure` only): the first key the window gets.
#[derive(Clone, Copy, PartialEq)]
enum ProbeKey {
    Waiting,
    /// Pressed; the host's next render draws it.
    Pressed,
    Marked,
}

/// Called when the host is created: the replay's entry points reach it
/// through GPUI's foreground executor. With `?measure`, the first key the
/// window gets (any key, before anything handles it) changes the host's
/// state, and the frame that draws it marks `contender:input`
/// (`Host::render` calls `drew_probe_key`): the scripts confirm
/// `contender:usable` with a key right after it
/// (`docs/contender-contract.md`, "Marks"). Later keys cost one check.
pub fn install(host: WeakEntity<Host>, window: AnyWindowHandle, cx: &mut App) {
    if measuring() {
        let probed = host.clone();
        cx.intercept_keystrokes(move |_, _, cx| {
            // Only from the first frame on (`contender:usable` is its
            // moment), as the DOM side listens only from its hydration
            // commit: a key before it changes nothing.
            if PROBE_KEY.get() == ProbeKey::Waiting
                && seiza::marks::mark_time(seiza::FIRST_FRAME_MARK).is_some()
            {
                PROBE_KEY.set(ProbeKey::Pressed);
                let _ = probed.update(cx, |_, cx| cx.notify());
            }
        })
        .detach();
    }
    HOST.set(Some((host, window, cx.to_async())));
    if let Some(theme) = PENDING_THEME.take() {
        apply_theme(&theme, cx);
    }
}

/// Applies the page's theme (`"light"` or `"dark"`; anything else, an empty
/// string included, leaves the window following the system) and stops
/// following the system, as Tycho's toggle does: a system change mustn't
/// undo the page's choice.
pub fn apply_theme(theme: &str, cx: &mut App) {
    let mode = match theme {
        "light" => ThemeMode::Light,
        "dark" => ThemeMode::Dark,
        _ => return,
    };
    seiza::stop_following_system_appearance(cx);
    // Refreshes every window.
    Theme::change(mode, None, cx);
}

/// The page's theme, live (`docs/contender-contract.md`, "Theme"): the JS
/// host calls it for each theme message after `start`. One that arrives
/// before the host is installed waits for it.
#[wasm_bindgen(js_name = setTheme)]
pub fn set_theme(theme: String) {
    if HOST.with_borrow(Option::is_none) {
        PENDING_THEME.set(Some(theme));
        return;
    }
    with_host(move |_, _, cx| apply_theme(&theme, cx));
}

/// Called from the host's render: marks `contender:input` right after the
/// frame that draws the probe key's state.
pub fn drew_probe_key() {
    if PROBE_KEY.get() == ProbeKey::Pressed {
        PROBE_KEY.set(ProbeKey::Marked);
        drop(seiza::mark_after_current_task(INPUT_MARK));
    }
}

/// The host shows a failure (the engine didn't load or stopped, the file
/// didn't open): marks `contender:failed`.
pub fn failed() {
    seiza::marks::mark(FAILED_MARK);
}

/// The host is opening the file: marks `contender:open`.
pub fn opening() {
    seiza::marks::mark(OPEN_MARK);
}

/// How often, at most, `state.cacheBytes` is read again.
const CACHE_READ_INTERVAL: std::time::Duration = std::time::Duration::from_millis(100);

/// Publishes what `table` reports, until it's released.
pub fn watch(table: &Entity<Table>, cx: &mut Context<Host>) {
    cx.subscribe(table, |_, _, event, _| on_event(event))
        .detach();
    // The table followed from the start (`scene::set_level`), before this
    // subscription heard its `Following`.
    #[cfg(feature = "tail")]
    {
        let following = table.read(cx).is_following();
        crate::clock::following(following);
        if measuring() {
            let _ = Reflect::set(
                &js_sys::global(),
                &JsValue::from_str(FOLLOWING_GLOBAL),
                &JsValue::from_bool(following),
            );
        }
    }
    if measuring() {
        // A page landing or leaving changes the cache without changing
        // what's shown, so the frame's probe doesn't report it. Every
        // notify (each scrolled frame too) could have changed it, and the
        // read counts the cache's pages, so it's read at most every
        // CACHE_READ_INTERVAL, in a timer's task, outside the frames.
        cx.observe(table, |_, table, cx| {
            if CACHE_READ_PENDING.replace(true) {
                return;
            }
            let table = table.downgrade();
            cx.spawn(async move |_, cx| {
                cx.background_executor().timer(CACHE_READ_INTERVAL).await;
                CACHE_READ_PENDING.set(false);
                let Ok(bytes) =
                    table.update(cx, |table, _| table.stats(seiza::marks::now()).cache_bytes)
                else {
                    return;
                };
                let changed = SHOWN.with_borrow_mut(|shown| {
                    let changed = shown.cache_bytes != bytes;
                    shown.cache_bytes = bytes;
                    changed
                });
                if changed {
                    SHOWN.with_borrow(publish_state);
                }
            })
            .detach();
        })
        .detach();
    }
}

fn on_event(event: &TallTableEvent) {
    // The filled mark always, the scrollbar's targets while measuring.
    // Emitted while the frame renders, so the mark lands right after it's
    // presented (the component's CLAUDE.md, rule 4).
    tall_table_bridge::Publish {
        filled_mark: Some(FILLED_MARK),
        scrollbar: measuring(),
        // Measured runs only: a mark a frame, never cleared, would pile up
        // in the timeline of a page that runs the feed for long.
        #[cfg(feature = "market")]
        refreshed_mark: measuring().then_some(REFRESHED_MARK),
        #[cfg(feature = "market")]
        refreshed: measuring().then_some(REFRESHED_GLOBAL),
        // Measured runs only, as the refreshed mark: one a frame under the feed.
        #[cfg(feature = "tail")]
        tail_mark: measuring().then_some(TAIL_MARK),
        #[cfg(feature = "tail")]
        tail: measuring().then_some(TAIL_GLOBAL),
        #[cfg(feature = "tail")]
        following: measuring().then_some(FOLLOWING_GLOBAL),
        ..Default::default()
    }
    .event(event);
    match event {
        TallTableEvent::Probe(probe) => {
            GEOMETRY.set((probe.rows as f64, GEOMETRY.get().1));
            let filled = probe.rows == 0
                || (probe.end > probe.first && probe.loaded == probe.end - probe.first);
            VIEW.set((VIEW.get().0.wrapping_add(1), filled));
            // `__contender.probe`: where the view is (its top row, its
            // sideways scroll), which places a drawn cell on the canvas
            // with `layout` (`perf/wide.ts`'s pixels).
            if probing_cells() {
                set_on_contender("probe", &tall_table_bridge::js::probe(probe));
            }
            if measuring() {
                SHOWN.with_borrow_mut(|shown| shown.probe = Some(probe.clone()));
                SHOWN.with_borrow(publish_state);
            }
        }
        TallTableEvent::Layout(layout) => {
            GEOMETRY.set((GEOMETRY.get().0, layout.row_height.into()));
            // `__contender.columns`: each column's name, x, width, kind,
            // and the characters a float may take, as the table laid them
            // out.
            if probing_cells() {
                set_on_contender("columns", &tall_table_bridge::js::columns(&layout.columns));
                // A level's: its row height and the pin in effect, which
                // the level's smoke check reads (`perf/wide.ts`).
                #[cfg(feature = "wide")]
                set_on_contender("layout", &tall_table_bridge::js::layout(layout));
            }
            if measuring() {
                SHOWN.with_borrow_mut(|shown| {
                    shown.row_height = Some(layout.row_height);
                    shown.cells = Some((layout.left, layout.top));
                });
                SHOWN.with_borrow(|shown| {
                    publish_state(shown);
                    publish_rows_target(shown);
                });
            }
        }
        // This tab's Shown in, with `?readout`: the batches the frame draws.
        #[cfg(feature = "market")]
        TallTableEvent::Refreshed { generation, .. } => crate::readout::drawn(*generation),
        // This tab's Shown in, with `?readout`: the counts the drawn tail reached.
        #[cfg(feature = "tail")]
        TallTableEvent::TailDrawn { rows } => crate::readout::drawn(*rows),
        // Counts posted while the reader holds the view aren't drawn until
        // it follows again: they'd read as the reader's time, not the view's.
        // The page's follow toggle hears it too, with `?readout`.
        #[cfg(feature = "tail")]
        TallTableEvent::Following(on) => {
            crate::readout::forget();
            crate::clock::following(*on);
        }
        TallTableEvent::Scrollbar { track, .. } if measuring() => {
            SHOWN.with_borrow_mut(|shown| shown.track = Some(*track));
            SHOWN.with_borrow(publish_rows_target);
        }
        // `__contender.cells`: every cell the frame drew, its value's exact
        // text and the text it showed.
        TallTableEvent::Cells(cells) => {
            set_on_contender("cells", &tall_table_bridge::js::cells(cells));
        }
        _ => {}
    }
}

/// Sets `__contender[key]`, once the JS host has defined it.
pub(crate) fn set_on_contender(key: &str, value: &JsValue) {
    let global = js_sys::global();
    if let Some(contender) = Reflect::get(&global, &JsValue::from_str("__contender"))
        .ok()
        .filter(JsValue::is_object)
    {
        let _ = Reflect::set(&contender, &JsValue::from_str(key), value);
    }
}

/// The `table` target: the rows' area, from the cells' left (right of the
/// row numbers) and top to the vertical scrollbar.
fn publish_rows_target(shown: &Shown) {
    let (Some((left, top)), Some(track)) = (shown.cells, shown.track) else {
        return;
    };
    let width = f32::from(track.origin.x) - left;
    let height = f32::from(track.origin.y + track.size.height) - top;
    seiza::targets::publish(
        "table",
        Bounds::new(
            point(px(left), px(top)),
            size(px(width.max(0.0)), px(height.max(0.0))),
        ),
    );
}

/// Replaces `__contender.state` (never mutated in place).
fn publish_state(shown: &Shown) {
    let (Some(probe), Some(row_height)) = (&shown.probe, shown.row_height) else {
        return;
    };
    let state = Object::new();
    let set = |key: &str, value: JsValue| {
        let _ = Reflect::set(&state, &JsValue::from_str(key), &value);
    };
    let number = |value: u64| JsValue::from_f64(value as f64);
    set("rows", number(probe.rows));
    set("top", JsValue::from_f64(probe.top * f64::from(row_height)));
    set("first", number(probe.first));
    set("end", number(probe.end));
    set("loaded", number(probe.loaded));
    set("pending", number(probe.pending));
    // The last row's key, only while the last row is on screen.
    set(
        "lastCell",
        probe
            .last_cell
            .as_deref()
            .filter(|_| probe.end == probe.rows)
            .map_or(JsValue::NULL, JsValue::from_str),
    );
    set("cacheBytes", number(shown.cache_bytes as u64));
    set_on_contender("state", &state);
}

/// Runs `update` on the host on GPUI's next turn: the replay's calls come
/// from JS, outside GPUI's update cycle.
fn with_host(update: impl FnOnce(&mut Host, &mut Window, &mut Context<Host>) + 'static) {
    let Some((host, window, cx)) = HOST.with_borrow(Clone::clone) else {
        return;
    };
    let mut app = cx.clone();
    cx.foreground_executor()
        .spawn(async move {
            let _ = window.update(&mut app, |_, window, cx| {
                host.update(cx, |host, cx| update(host, window, cx))
            });
        })
        .detach();
}

/// Runs `update` on the host now, from a JS task outside GPUI's (a
/// worker's message): GPUI's effects flush at its end, as an input's do.
#[cfg(any(feature = "market", feature = "tail"))]
pub fn with_host_now(update: impl FnOnce(&mut Host, &mut Context<Host>)) {
    let Some((host, _, mut cx)) = HOST.with_borrow(Clone::clone) else {
        return;
    };
    let _ = host.update(&mut cx, update);
}

/// The replay's `open()`: closes the file and opens it again.
#[wasm_bindgen(js_name = replayOpen)]
pub fn replay_open() {
    with_host(|host, window, cx| host.open(window, cx));
}

/// The replay's `jump(fraction)`: `fraction` of the rows above the top.
#[wasm_bindgen(js_name = replayJump)]
pub fn replay_jump(fraction: f64) {
    with_host(move |host, _, cx| host.jump(fraction, cx));
}

/// The shown table's `[rows, rowHeight]` (CSS px), for the replay's fling;
/// zeros before its first frame.
#[wasm_bindgen(js_name = replayGeometry)]
pub fn replay_geometry() -> Vec<f64> {
    let (rows, row_height) = GEOMETRY.get();
    vec![rows, row_height]
}

/// `[frames, filled]`: how many frames have shown a changed view, and
/// whether the last one had every visible row loaded (1 or 0). The replay
/// waits for the count to move after its input; a view that lands filled
/// sets no `contender:filled` (the table marks only a change to filled).
#[wasm_bindgen(js_name = replayView)]
pub fn replay_view() -> Vec<f64> {
    let (frames, filled) = VIEW.get();
    vec![frames.into(), if filled { 1.0 } else { 0.0 }]
}

// The base level's fonts toggle's, below everything another level builds
// (`lib.rs` says why).

/// Called from the host's render: the probe key's mark, and on the base
/// level the fonts toggle's (`fonts::drew`).
pub fn drew() {
    drew_probe_key();
    #[cfg(feature = "fonts")]
    crate::fonts::drew();
}

/// Runs `update` in the window now, from a JS task outside GPUI's: GPUI's
/// effects flush at its end. False before the host is installed.
#[cfg(feature = "fonts")]
pub fn with_window_now(update: impl FnOnce(&mut Window, &mut App)) -> bool {
    let Some((_, window, mut cx)) = HOST.with_borrow(Clone::clone) else {
        return false;
    };
    window
        .update(&mut cx, |_, window, cx| update(window, cx))
        .is_ok()
}
