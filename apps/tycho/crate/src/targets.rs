//! Where named controls are on the canvas, for the Playwright checks.
//!
//! The UI is drawn on a canvas, so there's no DOM element to click. Views
//! publish a control's bounds (CSS pixels, from the canvas's top-left) to
//! `globalThis.__tychoTargets[id] = [x, y, width, height]`, and the scripts
//! click its center. Written only when the bounds change.

use gpui_kit::{Bounds, Pixels};

#[cfg(target_family = "wasm")]
thread_local! {
    static PUBLISHED: std::cell::RefCell<Vec<(&'static str, Bounds<Pixels>)>> =
        const { std::cell::RefCell::new(Vec::new()) };
}

/// Whether the page was opened for measuring (`?perf` or `?bench` in the
/// URL). Hooks only the scripts read, like [`publish_table`] and the
/// table's `tycho:viewport-filled` mark, run only then.
pub fn measuring() -> bool {
    thread_local! {
        static MEASURING: bool =
            seiza::url::has_param("perf") || seiza::url::has_param("bench");
    }
    MEASURING.with(|measuring| *measuring)
}

pub fn publish(id: &'static str, bounds: Bounds<Pixels>) {
    #[cfg(target_family = "wasm")]
    {
        use js_sys::{Array, Object, Reflect};
        use wasm_bindgen::JsValue;

        let changed = PUBLISHED.with_borrow_mut(|published| {
            match published.iter_mut().find(|(existing, _)| *existing == id) {
                Some((_, old)) if *old == bounds => false,
                Some((_, old)) => {
                    *old = bounds;
                    true
                }
                None => {
                    published.push((id, bounds));
                    true
                }
            }
        });
        if !changed {
            return;
        }
        let global = js_sys::global();
        let key = JsValue::from_str("__tychoTargets");
        let targets = Reflect::get(&global, &key)
            .ok()
            .filter(JsValue::is_object)
            .unwrap_or_else(|| {
                let targets: JsValue = Object::new().into();
                let _ = Reflect::set(&global, &key, &targets);
                targets
            });
        let rect: Array = [
            f32::from(bounds.origin.x),
            f32::from(bounds.origin.y),
            f32::from(bounds.size.width),
            f32::from(bounds.size.height),
        ]
        .into_iter()
        .map(|value| JsValue::from_f64(value.into()))
        .collect();
        let _ = Reflect::set(&targets, &JsValue::from_str(id), &rect);
    }
    #[cfg(not(target_family = "wasm"))]
    let _ = (id, bounds);
}

/// Publishes what the table shows to `globalThis.__tychoTable`, when it
/// changes: `{rows, top, first, end, loaded, pending, failed, lastCell,
/// marked, scrollX, tooltip}`.
/// The table calls it only while [`measuring`].
pub fn publish_table(probe: &crate::table::TableProbe) {
    #[cfg(target_family = "wasm")]
    {
        use js_sys::{Object, Reflect};
        use wasm_bindgen::JsValue;

        thread_local! {
            static LAST: std::cell::RefCell<Option<crate::table::TableProbe>> =
                const { std::cell::RefCell::new(None) };
        }
        if LAST.with_borrow(|last| last.as_ref() == Some(probe)) {
            return;
        }
        LAST.set(Some(probe.clone()));
        let object = Object::new();
        let set = |key: &str, value: JsValue| {
            let _ = Reflect::set(&object, &JsValue::from_str(key), &value);
        };
        set("rows", JsValue::from_f64(probe.rows as f64));
        set("top", JsValue::from_f64(probe.top));
        set("first", JsValue::from_f64(probe.first as f64));
        set("end", JsValue::from_f64(probe.end as f64));
        set("loaded", JsValue::from_f64(probe.loaded as f64));
        set("pending", JsValue::from_f64(probe.pending as f64));
        set("failed", JsValue::from_f64(probe.failed as f64));
        set(
            "marked",
            probe
                .marked
                .map_or(JsValue::NULL, |row| JsValue::from_f64(row as f64)),
        );
        set("scrollX", JsValue::from_f64(probe.scroll_x.into()));
        set(
            "tooltip",
            probe
                .tooltip
                .as_deref()
                .map_or(JsValue::NULL, JsValue::from_str),
        );
        set(
            "lastCell",
            probe
                .last_cell
                .as_deref()
                .map_or(JsValue::NULL, JsValue::from_str),
        );
        let _ = Reflect::set(
            &js_sys::global(),
            &JsValue::from_str("__tychoTable"),
            &object,
        );
    }
    #[cfg(not(target_family = "wasm"))]
    let _ = probe;
}

/// Whether the page asked for every visible cell's text (`?cells`, with
/// `?perf` or `?bench`): [`publish_cells`], every frame. Off in the perf
/// runs, which it would slow.
pub fn probing_cells() -> bool {
    thread_local! {
        static CELLS: bool = measuring() && seiza::url::has_param("cells");
    }
    CELLS.with(|cells| *cells)
}

/// Where the table's cells are, for [`publish_table_layout`]: CSS pixels
/// from the canvas's top-left.
#[derive(Debug, Clone, PartialEq)]
pub struct TableLayout {
    /// The cells area's left edge (right of the row numbers) and top edge.
    pub left: f32,
    pub top: f32,
    /// Row `r`'s top is `top + (r - __tychoTable.top) * row_height`, and
    /// column `c`'s left edge is `left + columns[c].x - __tychoTable.scrollX`.
    pub row_height: f32,
    pub cells_width: f32,
    pub columns: Vec<ColumnProbe>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ColumnProbe {
    pub name: String,
    pub x: f32,
    pub width: f32,
    /// `text`, `integer`, `float`, or `decimal`.
    pub kind: &'static str,
    /// The characters a float may take.
    pub budget: usize,
}

/// Publishes the table's layout to `globalThis.__tychoTableLayout`: `{left,
/// top, rowHeight, cellsWidth, columns: [{name, x, width, kind, budget}]}`.
/// The table calls it only while [`measuring`], and only when the layout
/// changed (the scroll position is in [`publish_table`]).
pub fn publish_table_layout(layout: &TableLayout) {
    #[cfg(target_family = "wasm")]
    {
        use js_sys::{Array, Object, Reflect};
        use wasm_bindgen::JsValue;

        let set = |object: &Object, key: &str, value: JsValue| {
            let _ = Reflect::set(object, &JsValue::from_str(key), &value);
        };
        let number = |value: f32| JsValue::from_f64(value.into());
        let object = Object::new();
        set(&object, "left", number(layout.left));
        set(&object, "top", number(layout.top));
        set(&object, "rowHeight", number(layout.row_height));
        set(&object, "cellsWidth", number(layout.cells_width));
        let columns: Array = layout
            .columns
            .iter()
            .map(|column| {
                let probe = Object::new();
                set(&probe, "name", JsValue::from_str(&column.name));
                set(&probe, "x", number(column.x));
                set(&probe, "width", number(column.width));
                set(&probe, "kind", JsValue::from_str(column.kind));
                set(&probe, "budget", JsValue::from_f64(column.budget as f64));
                JsValue::from(probe)
            })
            .collect();
        set(&object, "columns", columns.into());
        let _ = Reflect::set(
            &js_sys::global(),
            &JsValue::from_str("__tychoTableLayout"),
            &object,
        );
    }
    #[cfg(not(target_family = "wasm"))]
    let _ = layout;
}

/// A drawn cell's value and the text handed to GPUI for it (which GPUI may
/// still cut to the column's width).
#[derive(Debug, Clone, PartialEq)]
pub struct CellProbe {
    pub row: u64,
    pub column: usize,
    /// The value's exact text (a float's shortest round-trip text).
    pub exact: String,
    pub shown: String,
}

/// Publishes the drawn cells to `globalThis.__tychoCells`: `[{row, column,
/// exact, shown}]`, every frame. Only with [`probing_cells`].
pub fn publish_cells(cells: &[CellProbe]) {
    #[cfg(target_family = "wasm")]
    {
        use js_sys::{Array, Object, Reflect};
        use wasm_bindgen::JsValue;

        let cells: Array = cells
            .iter()
            .map(|cell| {
                let object = Object::new();
                let set = |key: &str, value: JsValue| {
                    let _ = Reflect::set(&object, &JsValue::from_str(key), &value);
                };
                set("row", JsValue::from_f64(cell.row as f64));
                set("column", JsValue::from_f64(cell.column as f64));
                set("exact", JsValue::from_str(&cell.exact));
                set("shown", JsValue::from_str(&cell.shown));
                JsValue::from(object)
            })
            .collect();
        let _ = Reflect::set(
            &js_sys::global(),
            &JsValue::from_str("__tychoCells"),
            &cells,
        );
    }
    #[cfg(not(target_family = "wasm"))]
    let _ = cells;
}

/// What the workbench shows, for [`publish_workbench`].
#[derive(Debug, Clone, PartialEq)]
pub struct WorkbenchProbe<'a> {
    /// `idle`, `opening`, `open`, or `failed`.
    pub state: &'static str,
    /// The file opening, shown, or failed.
    pub name: Option<&'a str>,
    pub rows: Option<u64>,
    /// Why the open failed.
    pub message: Option<&'a str>,
    /// The inline line about the last file choice (e.g. not a Parquet file).
    pub notice: Option<&'a str>,
    pub dragging: bool,
    /// A CSV's load: `loading`, `done`, or `stopped`; null for Parquet.
    pub ingest: Option<&'static str>,
    /// A CSV's bytes read so far, and chunks made.
    pub read_bytes: Option<u64>,
    pub chunks: Option<u64>,
    /// What the jump input holds.
    pub jump_text: &'a str,
    /// The line beside the jump input when the typed text isn't a row.
    pub jump_refusal: Option<&'a str>,
    /// What has focus: `jump`, `table`, `workbench`, or null for none.
    pub focused: Option<&'static str>,
    /// The engine: `loading`, `ready`, `failed`, or `stopped`.
    pub engine: &'static str,
    /// The empty state's status line (shown only while no file is open).
    pub status: &'a str,
}

/// Publishes what the workbench shows to `globalThis.__tychoWorkbench`:
/// `{state, name, rows, message, notice, dragging, ingest, readBytes, chunks,
/// jumpText, jumpRefusal, focused, engine, status}`.
/// Called every render; the
/// caller checks [`measuring`].
pub fn publish_workbench(probe: &WorkbenchProbe<'_>) {
    #[cfg(target_family = "wasm")]
    {
        use js_sys::{Object, Reflect};
        use wasm_bindgen::JsValue;

        let text = |value: Option<&str>| value.map_or(JsValue::NULL, JsValue::from_str);
        let object = Object::new();
        let set = |key: &str, value: JsValue| {
            let _ = Reflect::set(&object, &JsValue::from_str(key), &value);
        };
        set("state", JsValue::from_str(probe.state));
        set("name", text(probe.name));
        set(
            "rows",
            probe
                .rows
                .map_or(JsValue::NULL, |rows| JsValue::from_f64(rows as f64)),
        );
        set("message", text(probe.message));
        set("notice", text(probe.notice));
        set("dragging", JsValue::from_bool(probe.dragging));
        let number = |value: Option<u64>| {
            value.map_or(JsValue::NULL, |value| JsValue::from_f64(value as f64))
        };
        set("ingest", text(probe.ingest));
        set("readBytes", number(probe.read_bytes));
        set("chunks", number(probe.chunks));
        set("jumpText", JsValue::from_str(probe.jump_text));
        set("jumpRefusal", text(probe.jump_refusal));
        set("focused", text(probe.focused));
        set("engine", JsValue::from_str(probe.engine));
        set("status", JsValue::from_str(probe.status));
        let _ = Reflect::set(
            &js_sys::global(),
            &JsValue::from_str("__tychoWorkbench"),
            &object,
        );
    }
    #[cfg(not(target_family = "wasm"))]
    let _ = probe;
}
