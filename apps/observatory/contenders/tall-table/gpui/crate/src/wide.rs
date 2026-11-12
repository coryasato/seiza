//! The wide sheet's tools (`wide`): the table's `resize`, `select`, and
//! `copy` at their defaults (every column resizable as `pin` allows, every
//! kind of selection, `key_max_cells` 100,000, `max_bytes` 64 MiB, no
//! header line), and what the host does with them: each copy written to
//! the clipboard by `tall-table-bridge`'s writer, a copy it can't write
//! cancelled, the writer told when the host closes the table, and a second
//! Cmd+C (Ctrl+C) on a selection the key declined the host's `copy` (past
//! the key's limit; in the key's task, so the clipboard takes it as a
//! gesture). With `?measure`, the copy's marks and
//! `__contender.copy`, `.selection`, `.widths`, and `.layout`; with
//! `?readout`, the page's copy line (`contenders/tools.ts`: the frame's
//! reports and `__contenderTools`, through the JS host's `tools`). A file
//! of its own, so no other level's code (or panic location) moves.

use std::cell::{Cell, RefCell};

use gpui_kit::*;
use js_sys::{Function, Object, Reflect};
use seiza_tall_table::{TallTableCopy, TallTableEvent, TallTableSelection};
use tall_table_bridge::clipboard::{Clipboard, Failure, Outcome};
use wasm_bindgen::prelude::*;

use crate::contract::{measuring, set_on_contender};
use crate::host::{Host, Table};

/// With `?measure`: the copy started (its write opened, in the key's task).
const COPY_STARTED_MARK: &str = "contender:copy-started";
/// With `?measure`: the copy's text all in (`Copied`).
const COPIED_MARK: &str = "contender:copied";
/// With `?measure`: the browser's write resolved.
const COPY_WRITTEN_MARK: &str = "contender:copy-written";
/// With `?measure`: a key past the key's limit, nothing read (`Declined`).
const COPY_DECLINED_MARK: &str = "contender:copy-declined";

/// What the page's copy line says (`contenders/tools.ts`, `ToolsMessage`).
#[derive(Default)]
struct Told {
    cells: f64,
    /// The last copy's state since the selection changed (`Outcome`'s).
    copy: Option<&'static str>,
    done: f64,
    bytes: f64,
    ms: f64,
    reason: Option<&'static str>,
    /// When the last copy started (page ms), for `ms`.
    started: f64,
}

thread_local! {
    /// The table shown, for the keys and the page's calls.
    static TABLE: RefCell<Option<(WeakEntity<Table>, AsyncApp)>> = const { RefCell::new(None) };
    /// The clipboard's writer, one for every table the host shows.
    static CLIPBOARD: RefCell<Option<Clipboard>> = const { RefCell::new(None) };
    /// The JS host's reporter (`?readout` only).
    static REPORT: RefCell<Option<Function>> = const { RefCell::new(None) };
    static TOLD: RefCell<Told> = RefCell::new(Told::default());
    /// The key declined the selection, and it hasn't changed since: the
    /// next Cmd+C on it copies it.
    static DECLINED: Cell<bool> = const { Cell::new(false) };
}

/// The page's copy line (`?readout`, the JS host's `level.ts`): `report`
/// is called with `{cells, copy, done, bytes, ms, reason}` at each
/// selection change and copy event.
#[wasm_bindgen]
pub fn tools(report: Function) {
    REPORT.set(Some(report));
}

/// The page's Copy button, inside its click: the host's copy.
#[wasm_bindgen(js_name = toolsCopy)]
pub fn tools_copy() {
    with_table(|table, cx| {
        table.copy(cx);
    });
}

/// The page's Cancel: the copy running ends, the clipboard as it was.
#[wasm_bindgen(js_name = toolsCancel)]
pub fn tools_cancel() {
    with_table(|table, cx| table.cancel_copy(cx));
}

/// Runs `update` on the table shown now, in the caller's task (the page's
/// click: the clipboard's gesture), GPUI's effects flushed at its end.
fn with_table(update: impl FnOnce(&mut Table, &mut Context<Table>)) {
    let Some((table, mut cx)) = TABLE.with_borrow(Clone::clone) else {
        return;
    };
    let _ = table.update(&mut cx, update);
}

/// Called as the host shows `table` (`contract::watch_level`): hears its
/// events (its copy's limits are the table's defaults).
pub fn watch(table: &Entity<Table>, cx: &mut Context<Host>) {
    CLIPBOARD.with_borrow_mut(|clipboard| {
        clipboard.get_or_insert_with(|| Clipboard::new(None, Some(Box::new(outcome))));
    });
    TABLE.set(Some((table.downgrade(), cx.to_async())));
    TOLD.set(Told::default());
    DECLINED.set(false);
    report();
    cx.subscribe(table, |_, table, event, cx| on_event(&table, event, cx))
        .detach();
}

/// The host closed the table (`contract::opening_level`, a replay's reopen),
/// which ends its copy without an event: a write still open is rejected,
/// the clipboard as it was.
pub fn closed() {
    CLIPBOARD.with_borrow_mut(|clipboard| clipboard.as_mut().map(Clipboard::closed));
}

fn on_event(table: &Entity<Table>, event: &TallTableEvent, cx: &mut Context<Host>) {
    match event {
        TallTableEvent::Copy(copy) => {
            match copy {
                TallTableCopy::Started { .. } => {
                    TOLD.with_borrow_mut(|told| told.started = seiza::marks::now());
                    if measuring() {
                        let _ = seiza::marks::mark(COPY_STARTED_MARK);
                    }
                }
                TallTableCopy::Copied { .. } if measuring() => {
                    let _ = seiza::marks::mark(COPIED_MARK);
                }
                // A second Cmd+C on the selection the key declined: the
                // host's copy, in the key's task (the clipboard's gesture).
                // Its `Started` follows; nothing is declined.
                TallTableCopy::Declined { .. } if DECLINED.get() => {
                    table.update(cx, |table, cx| {
                        table.copy(cx);
                    });
                    return;
                }
                TallTableCopy::Declined { .. } => {
                    DECLINED.set(true);
                    if measuring() {
                        let _ = seiza::marks::mark(COPY_DECLINED_MARK);
                    }
                }
                _ => {}
            }
            if matches!(copy, TallTableCopy::Started { .. }) {
                DECLINED.set(false);
            }
            let cancel = CLIPBOARD.with_borrow_mut(|clipboard| {
                clipboard
                    .as_mut()
                    .and_then(|clipboard| clipboard.event(copy))
            });
            if let Some(id) = cancel {
                table.update(cx, |table, cx| {
                    if table.copying().is_some_and(|copying| copying.id == id) {
                        table.cancel_copy(cx);
                    }
                });
            }
        }
        TallTableEvent::Selected(selection) => {
            if measuring() {
                set_on_contender(
                    "selection",
                    &tall_table_bridge::js::selection(selection.as_ref()),
                );
            }
            let cells = selection.as_ref().map_or(0.0, |selection| {
                let table = table.read(cx);
                cells(selection, table.rows(), table.columns().len())
            });
            DECLINED.set(false);
            TOLD.with_borrow_mut(|told| {
                told.cells = cells;
                // A copy running is still said; an ended one belongs to
                // the selection before.
                if !matches!(told.copy, Some("copying" | "writing")) {
                    told.copy = None;
                    told.reason = None;
                    told.done = 0.0;
                    told.bytes = 0.0;
                    told.ms = 0.0;
                }
            });
            report();
        }
        TallTableEvent::ColumnWidthsChanged(widths) if measuring() => {
            set_on_contender("widths", &tall_table_bridge::js::widths(widths));
        }
        // At each layout change (a release or fit, a density, the view's
        // size), never a frame: where the scripts press.
        TallTableEvent::Layout(layout) if measuring() => {
            set_on_contender("layout", &tall_table_bridge::js::layout(layout));
        }
        _ => {}
    }
}

/// The cells `selection` covers in a table of `rows` × `columns`.
fn cells(selection: &TallTableSelection, rows: u64, columns: usize) -> f64 {
    let rows = selection
        .rows(rows)
        .map_or(0, |rows| rows.end() - rows.start() + 1);
    let columns = selection
        .columns(columns)
        .map_or(0, |columns| columns.end() - columns.start() + 1);
    rows as f64 * columns as f64
}

/// What became of a copy, from the clipboard's writer (in the copy's
/// events, or as the browser settles the write): `__contender.copy` and
/// the written mark with `?measure`, and the page's copy line.
fn outcome(outcome: &Outcome) {
    if measuring() {
        set_on_contender("copy", &outcome.to_js());
        if matches!(outcome, Outcome::Written { .. }) {
            let _ = seiza::marks::mark(COPY_WRITTEN_MARK);
        }
    }
    TOLD.with_borrow_mut(|told| {
        let (state, done, bytes, reason) = match outcome {
            Outcome::Declined { rows, columns } => {
                told.cells = *rows as f64 * *columns as f64;
                ("declined", 0.0, 0.0, None)
            }
            Outcome::Copying {
                rows, rows_done, ..
            } => (
                "copying",
                if *rows == 0 {
                    0.0
                } else {
                    *rows_done as f64 / *rows as f64
                },
                0.0,
                None,
            ),
            Outcome::Writing { bytes, .. } => ("writing", 1.0, *bytes as f64, None),
            Outcome::Written { bytes, .. } => ("written", 1.0, *bytes as f64, None),
            Outcome::Refused { .. } => ("refused", 0.0, 0.0, None),
            Outcome::Failed { reason, .. } => (
                "failed",
                0.0,
                0.0,
                Some(match reason {
                    Failure::TooLarge { .. } => "too-large",
                    Failure::Read(_) => "read",
                    Failure::Cancelled => "cancelled",
                    Failure::Closed => "closed",
                }),
            ),
            Outcome::Unavailable { .. } => ("unavailable", 0.0, 0.0, None),
            // An outcome this host doesn't know yet (`#[non_exhaustive]`).
            _ => return,
        };
        told.copy = Some(state);
        told.done = done;
        told.bytes = bytes;
        told.reason = reason;
        told.ms = if state == "written" {
            seiza::marks::now() - told.started
        } else {
            0.0
        };
    });
    report();
}

/// Calls the JS host's reporter with what the copy line says now.
fn report() {
    let Some(report) = REPORT.with_borrow(Clone::clone) else {
        return;
    };
    let message = Object::new();
    TOLD.with_borrow(|told| {
        let set = |key: &str, value: JsValue| {
            let _ = Reflect::set(&message, &JsValue::from_str(key), &value);
        };
        set("cells", JsValue::from_f64(told.cells));
        set("copy", told.copy.map_or(JsValue::NULL, JsValue::from_str));
        set("done", JsValue::from_f64(told.done));
        set("bytes", JsValue::from_f64(told.bytes));
        set("ms", JsValue::from_f64(told.ms));
        if let Some(reason) = told.reason {
            set("reason", JsValue::from_str(reason));
        }
    });
    let _ = report.call1(&JsValue::NULL, &message);
}
