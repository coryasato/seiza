//! What a seiza host does with the tall table's events, written once for
//! every host (Tycho, the observatory's GPUI contender, the table's bare
//! host). The table depends on gpui-kit alone and sets no marks (its
//! `CLAUDE.md`, rule 1), and `seiza` knows no table, so the glue between
//! them lives here: the filled mark (with `live`, the refreshed mark), the
//! scrollbar's targets, and the probes (`TallTableProbe`, `TallTableLayout`, `CellProbe`) as JS values
//! on globals a host names.
//!
//! A host builds a [`Publish`] saying what it wants and hands it each event
//! ([`Publish::event`]); what only it does (its own state object, its
//! panel rows) stays in its own `match`. Natively every call is a no-op.

use seiza_tall_table::TallTableEvent;

/// The vertical scrollbar's track and thumb, for scripts that drag it
/// (`shared-web/perf/`'s `fling` reads the track).
pub const TRACK_TARGET: &str = "table-scroll-track";
pub const THUMB_TARGET: &str = "table-scroll-thumb";

/// What a host publishes from the table's events; each `None` (or `false`)
/// is left out.
#[derive(Debug, Default, Clone, Copy)]
pub struct Publish {
    /// Set right after each frame that became filled
    /// ([`TallTableEvent::Filled`]).
    pub filled_mark: Option<&'static str>,
    /// The scrollbar's [`TRACK_TARGET`] and [`THUMB_TARGET`].
    pub scrollbar: bool,
    /// The global the probe goes to ([`js::probe`]).
    pub probe: Option<&'static str>,
    /// The global the layout goes to ([`js::layout`]).
    pub layout: Option<&'static str>,
    /// The global the drawn cells go to ([`js::cells`]).
    pub cells: Option<&'static str>,
    /// Set right after each frame that first draws a re-read page
    /// (`live`'s [`TallTableEvent::Refreshed`]).
    pub refreshed_mark: Option<&'static str>,
    /// The global holding the highest generation drawn so far (`live`), set
    /// while the frame renders: a script reading it at the refreshed mark
    /// reads that frame's.
    pub refreshed: Option<&'static str>,
}

impl Publish {
    /// Publishes what `event` reports. Call it from the table's
    /// subscription, which GPUI runs in the task that presents the frame
    /// (the table emits while it renders), so the mark lands right after
    /// that frame (the table's `CLAUDE.md`, rule 4).
    #[inline]
    pub fn event(&self, event: &TallTableEvent) {
        match event {
            TallTableEvent::Filled { .. } =>
            {
                #[cfg(target_family = "wasm")]
                if let Some(mark) = self.filled_mark {
                    drop(seiza::mark_after_current_task(mark));
                }
            }
            TallTableEvent::Scrollbar { track, thumb } if self.scrollbar => {
                seiza::targets::publish(TRACK_TARGET, *track);
                seiza::targets::publish(THUMB_TARGET, *thumb);
            }
            #[cfg(target_family = "wasm")]
            TallTableEvent::Probe(probe) => {
                if let Some(name) = self.probe {
                    js::set_global(name, &js::probe(probe));
                }
            }
            #[cfg(target_family = "wasm")]
            TallTableEvent::Layout(layout) => {
                if let Some(name) = self.layout {
                    js::set_global(name, &js::layout(layout));
                }
            }
            #[cfg(all(feature = "live", target_family = "wasm"))]
            TallTableEvent::Refreshed { generation, .. } => {
                if let Some(name) = self.refreshed {
                    js::raise_global(name, *generation as f64);
                }
                if let Some(mark) = self.refreshed_mark {
                    drop(seiza::mark_after_current_task(mark));
                }
            }
            #[cfg(target_family = "wasm")]
            TallTableEvent::Cells(cells) => {
                if let Some(name) = self.cells {
                    js::set_global(name, &js::cells(cells));
                }
            }
            _ => {}
        }
    }
}

/// The probes as JS values, for a host that puts them somewhere of its own.
#[cfg(target_family = "wasm")]
pub mod js {
    use js_sys::{Array, Object, Reflect};
    use seiza_tall_table::{CellProbe, ColumnProbe, TallTableLayout, TallTableProbe};
    use wasm_bindgen::JsValue;

    fn set(object: &Object, key: &str, value: JsValue) {
        let _ = Reflect::set(object, &JsValue::from_str(key), &value);
    }

    fn number(value: impl Into<f64>) -> JsValue {
        JsValue::from_f64(value.into())
    }

    fn text(value: Option<&str>) -> JsValue {
        value.map_or(JsValue::NULL, JsValue::from_str)
    }

    /// `globalThis[name] = value`, replaced, never mutated in place.
    pub fn set_global(name: &str, value: &JsValue) {
        let _ = Reflect::set(&js_sys::global(), &JsValue::from_str(name), value);
    }

    /// `globalThis[name] = value` if it's higher than the number there.
    #[cfg(feature = "live")]
    pub fn raise_global(name: &str, value: f64) {
        let current = Reflect::get(&js_sys::global(), &JsValue::from_str(name))
            .ok()
            .and_then(|current| current.as_f64());
        if current.is_none_or(|current| value > current) {
            set_global(name, &number(value));
        }
    }

    /// `{rows, top, first, end, loaded, pending, failed, lastCell, marked,
    /// scrollX, tooltip}`: `top` in rows, `scrollX` in CSS px.
    pub fn probe(probe: &TallTableProbe) -> JsValue {
        let object = Object::new();
        set(&object, "rows", number(probe.rows as f64));
        set(&object, "top", number(probe.top));
        set(&object, "first", number(probe.first as f64));
        set(&object, "end", number(probe.end as f64));
        set(&object, "loaded", number(probe.loaded as f64));
        set(&object, "pending", number(probe.pending as f64));
        set(&object, "failed", number(probe.failed as f64));
        set(&object, "lastCell", text(probe.last_cell.as_deref()));
        set(
            &object,
            "marked",
            probe.marked.map_or(JsValue::NULL, |row| number(row as f64)),
        );
        set(&object, "scrollX", number(probe.scroll_x));
        set(&object, "tooltip", text(probe.tooltip.as_deref()));
        object.into()
    }

    /// `{left, top, rowHeight, cellsWidth, columns}` (CSS px from the
    /// canvas's top-left), `columns` as [`columns`] writes them.
    pub fn layout(layout: &TallTableLayout) -> JsValue {
        let object = Object::new();
        set(&object, "left", number(layout.left));
        set(&object, "top", number(layout.top));
        set(&object, "rowHeight", number(layout.row_height));
        set(&object, "cellsWidth", number(layout.cells_width));
        set(&object, "columns", columns(&layout.columns));
        object.into()
    }

    /// `[{name, x, width, kind, budget}]`: `budget` is the characters a
    /// float may take.
    pub fn columns(columns: &[ColumnProbe]) -> JsValue {
        let list: Array = columns
            .iter()
            .map(|column| {
                let object = Object::new();
                set(&object, "name", JsValue::from_str(&column.name));
                set(&object, "x", number(column.x));
                set(&object, "width", number(column.width));
                set(&object, "kind", JsValue::from_str(column.kind));
                set(&object, "budget", number(column.budget as f64));
                JsValue::from(object)
            })
            .collect();
        list.into()
    }

    /// `[{row, column, exact, shown}]`: every cell the frame drew. With
    /// `custom-cells`, also `fill` and `text` (`[r, g, b, a]`, 8-bit, or
    /// null) and `bar` (`{left, width}` in CSS px from the cell's left, or
    /// null); with `live` too, `flash` (`[r, g, b, a]`, its opacity in the
    /// alpha, or null).
    pub fn cells(cells: &[CellProbe]) -> JsValue {
        let list: Array = cells
            .iter()
            .map(|cell| {
                let object = Object::new();
                set(&object, "row", number(cell.row as f64));
                set(&object, "column", number(cell.column as f64));
                set(&object, "exact", JsValue::from_str(&cell.exact));
                set(&object, "shown", JsValue::from_str(&cell.shown));
                #[cfg(feature = "custom-cells")]
                {
                    let color = |rgba: Option<[u8; 4]>| {
                        rgba.map_or(JsValue::NULL, |rgba| {
                            rgba.iter().map(|c| number(*c)).collect::<Array>().into()
                        })
                    };
                    set(&object, "fill", color(cell.paint.fill));
                    set(&object, "text", color(cell.paint.text));
                    let bar = cell.paint.bar.map_or(JsValue::NULL, |(left, width)| {
                        let bar = Object::new();
                        set(&bar, "left", number(left));
                        set(&bar, "width", number(width));
                        bar.into()
                    });
                    set(&object, "bar", bar);
                    #[cfg(feature = "live")]
                    set(&object, "flash", color(cell.paint.flash));
                }
                JsValue::from(object)
            })
            .collect();
        list.into()
    }
}
