//! The contender contract (`apps/observatory/docs/contender-contract.md`),
//! from the table's events: the `contender:open` and `contender:filled`
//! marks (always), `__contender.state` and the targets (with `?measure`),
//! the drawn cells and the columns' budgets (with `?cells`, for the tall
//! table's cell fixture), and the entry points the JS host's replay hooks
//! call. The page's other
//! marks (`first-pixels`, `usable`) and the `postMessage` relay are the JS
//! host's (`web/src/main.ts`), from marks the bootstrap already sets.

use std::cell::{Cell, RefCell};

use gpui_kit::*;
use js_sys::{Object, Reflect};
use seiza_tall_table::{CellProbe, ColumnProbe, TallTableEvent, TallTableProbe};
use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::*;

use crate::host::{Host, Table};

/// The host starts opening the file (the engine is ready).
const OPEN_MARK: &str = "contender:open";
/// Right after each frame in which the viewport became filled.
const FILLED_MARK: &str = "contender:filled";

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
}

/// Called when the host is created: the replay's entry points reach it
/// through GPUI's foreground executor.
pub fn install(host: WeakEntity<Host>, window: AnyWindowHandle, cx: &mut App) {
    HOST.set(Some((host, window, cx.to_async())));
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
    match event {
        // Emitted while the frame renders, so the mark lands right after
        // it's presented (the component's CLAUDE.md, rule 4).
        TallTableEvent::Filled { .. } => drop(seiza::mark_after_current_task(FILLED_MARK)),
        TallTableEvent::Probe(probe) => {
            GEOMETRY.set((probe.rows as f64, GEOMETRY.get().1));
            let filled = probe.rows == 0
                || (probe.end > probe.first && probe.loaded == probe.end - probe.first);
            VIEW.set((VIEW.get().0.wrapping_add(1), filled));
            if measuring() {
                SHOWN.with_borrow_mut(|shown| shown.probe = Some(probe.clone()));
                SHOWN.with_borrow(publish_state);
            }
        }
        TallTableEvent::Layout(layout) => {
            GEOMETRY.set((GEOMETRY.get().0, layout.row_height.into()));
            if probing_cells() {
                publish_columns(&layout.columns);
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
        TallTableEvent::Scrollbar { track, thumb } if measuring() => {
            seiza::targets::publish("table-scroll-track", *track);
            seiza::targets::publish("table-scroll-thumb", *thumb);
            SHOWN.with_borrow_mut(|shown| shown.track = Some(*track));
            SHOWN.with_borrow(publish_rows_target);
        }
        TallTableEvent::Cells(cells) => publish_cells(cells),
        _ => {}
    }
}

/// `__contender.columns`: each column's name, kind, width, and the
/// characters a float may take, as the table laid them out.
fn publish_columns(columns: &[ColumnProbe]) {
    let list = js_sys::Array::new();
    for column in columns {
        let entry = Object::new();
        let set = |key: &str, value: JsValue| {
            let _ = Reflect::set(&entry, &JsValue::from_str(key), &value);
        };
        set("name", JsValue::from_str(&column.name));
        set("kind", JsValue::from_str(column.kind));
        set("width", JsValue::from_f64(column.width.into()));
        set("budget", JsValue::from_f64(column.budget as f64));
        list.push(&entry);
    }
    set_on_contender("columns", &list);
}

/// `__contender.cells`: every cell the frame drew, its value's exact text
/// and the text it showed.
fn publish_cells(cells: &[CellProbe]) {
    let list = js_sys::Array::new();
    for cell in cells {
        let entry = Object::new();
        let set = |key: &str, value: JsValue| {
            let _ = Reflect::set(&entry, &JsValue::from_str(key), &value);
        };
        set("row", JsValue::from_f64(cell.row as f64));
        set("column", JsValue::from_f64(cell.column as f64));
        set("exact", JsValue::from_str(&cell.exact));
        set("shown", JsValue::from_str(&cell.shown));
        list.push(&entry);
    }
    set_on_contender("cells", &list);
}

/// Sets `__contender[key]`, once the JS host has defined it.
fn set_on_contender(key: &str, value: &JsValue) {
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
