//! What a seiza host does with the tall table's events, written once for
//! every host (Tycho, the observatory's GPUI contender, the table's bare
//! host). The table depends on gpui-kit alone and sets no marks (its
//! `CLAUDE.md`, rule 1), and `seiza` knows no table, so the glue between
//! them lives here: the filled mark (with `live`, the refreshed mark), the
//! scrollbar's targets, with `follow` the tail mark and the following
//! flag, with `resize` the widths a resize left, with `select` the
//! selection, with `copy` the clipboard's writer ([`clipboard`]), with
//! `sort` the order and its mark, and the
//! probes (`TallTableProbe`, `TallTableLayout`,
//! `CellProbe`) as JS values on globals a host names.
//!
//! A host builds a [`Publish`] saying what it wants and hands it each event
//! ([`Publish::event`]); what only it does (its own state object, its
//! panel rows) stays in its own `match`. Natively every call is a no-op.

use seiza_tall_table::TallTableEvent;

#[cfg(feature = "copy")]
pub mod clipboard;

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
    /// The global holding whether the table follows the end (`follow`'s
    /// [`TallTableEvent::Following`]), set when it changes.
    #[cfg(feature = "follow")]
    pub following: Option<&'static str>,
    /// Set right after each frame whose drawn tail grew while following
    /// (`follow`'s [`TallTableEvent::TailDrawn`]).
    #[cfg(feature = "follow")]
    pub tail_mark: Option<&'static str>,
    /// The global holding the end of the tail last drawn (`follow`), set
    /// while the frame renders, before the tail mark: a script reading it
    /// at the mark reads that frame's. Replaced, not raised: the table's
    /// tail only rises, except after a shrink.
    #[cfg(feature = "follow")]
    pub tail: Option<&'static str>,
    /// The global holding each column's set width (`resize`'s
    /// [`TallTableEvent::ColumnWidthsChanged`], [`js::widths`]), replaced
    /// at each release or fit that changed one.
    #[cfg(feature = "resize")]
    pub widths: Option<&'static str>,
    /// The global holding the selection (`select`'s
    /// [`TallTableEvent::Selected`], [`js::selection`]), replaced at each
    /// change.
    #[cfg(feature = "select")]
    pub selection: Option<&'static str>,
    /// The global holding the order (`sort`'s [`TallTableEvent::Sorted`],
    /// [`js::sort`]), replaced at each change.
    #[cfg(feature = "sort")]
    pub sort: Option<&'static str>,
    /// Set as the order changes (`sort`'s [`TallTableEvent::Sorted`]), in
    /// the task that changed it (a click's, or `set_sort`'s caller's), after
    /// the global.
    #[cfg(feature = "sort")]
    pub sorted_mark: Option<&'static str>,
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
            #[cfg(all(feature = "follow", target_family = "wasm"))]
            TallTableEvent::Following(following) => {
                if let Some(name) = self.following {
                    js::set_global(name, &(*following).into());
                }
            }
            #[cfg(all(feature = "follow", target_family = "wasm"))]
            TallTableEvent::TailDrawn { rows } => {
                if let Some(name) = self.tail {
                    js::set_global(name, &(*rows as f64).into());
                }
                if let Some(mark) = self.tail_mark {
                    drop(seiza::mark_after_current_task(mark));
                }
            }
            #[cfg(all(feature = "resize", target_family = "wasm"))]
            TallTableEvent::ColumnWidthsChanged(widths) => {
                if let Some(name) = self.widths {
                    js::set_global(name, &js::widths(widths));
                }
            }
            #[cfg(all(feature = "select", target_family = "wasm"))]
            TallTableEvent::Selected(selection) => {
                if let Some(name) = self.selection {
                    js::set_global(name, &js::selection(selection.as_ref()));
                }
            }
            #[cfg(all(feature = "sort", target_family = "wasm"))]
            TallTableEvent::Sorted(sort) => {
                if let Some(name) = self.sort {
                    js::set_global(name, &js::sort(sort.as_ref()));
                }
                if let Some(mark) = self.sorted_mark {
                    let _ = seiza::marks::mark(mark);
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
    #[cfg(feature = "select")]
    use seiza_tall_table::{Cell, TallTableSelection};
    use seiza_tall_table::{CellProbe, ColumnProbe, TallTableLayout, TallTableProbe};
    #[cfg(feature = "sort")]
    use seiza_tall_table::{Sort, SortDirection};
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
    /// scrollX, tooltip}`: `top` in rows, `scrollX` in CSS px. With
    /// `select`, also `selection` ([`selection`]); with `sort`, `sort`
    /// ([`sort`]).
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
        #[cfg(feature = "select")]
        set(&object, "selection", selection(probe.selection.as_ref()));
        #[cfg(feature = "sort")]
        set(&object, "sort", sort(probe.sort.as_ref()));
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
    /// float may take. With `sort`, also `arrow`: its box, `{x, width}` in
    /// CSS px from the column's left edge, or `null` where none is drawn.
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
                #[cfg(feature = "sort")]
                set(
                    &object,
                    "arrow",
                    column.arrow.map_or(JsValue::NULL, |(x, width)| {
                        let arrow = Object::new();
                        set(&arrow, "x", number(x));
                        set(&arrow, "width", number(width));
                        arrow.into()
                    }),
                );
                JsValue::from(object)
            })
            .collect();
        list.into()
    }

    /// `[width | null]`, in the order of the table's columns: each one's set
    /// width in CSS px, `null` where it's still its kind's.
    #[cfg(feature = "resize")]
    pub fn widths<W: Copy + Into<f32>>(widths: &[Option<W>]) -> JsValue {
        let list: Array = widths
            .iter()
            .map(|width| width.map_or(JsValue::NULL, |width| number(width.into())))
            .collect();
        list.into()
    }

    /// `{kind, anchor, head}` or `null`: `kind` is `rows`, `columns`, or
    /// `cells`, and each cell `[row, column]`, as the table's
    /// `fixtures/selection.json` writes them.
    #[cfg(feature = "select")]
    pub fn selection(selection: Option<&TallTableSelection>) -> JsValue {
        let Some(selection) = selection else {
            return JsValue::NULL;
        };
        let kind = match selection {
            TallTableSelection::Rows { .. } => "rows",
            TallTableSelection::Columns { .. } => "columns",
            TallTableSelection::Cells { .. } => "cells",
            // `#[non_exhaustive]`: a kind this bridge doesn't know yet.
            _ => "unknown",
        };
        let cell = |(row, column): Cell| -> JsValue {
            Array::of2(&number(row as f64), &number(column as f64)).into()
        };
        let object = Object::new();
        set(&object, "kind", JsValue::from_str(kind));
        set(&object, "anchor", cell(selection.anchor()));
        set(&object, "head", cell(selection.head()));
        object.into()
    }

    /// `{column, direction}` or `null`: `direction` is `ascending` or
    /// `descending`, `column` the column's index.
    #[cfg(feature = "sort")]
    pub fn sort(sort: Option<&Sort>) -> JsValue {
        let Some(sort) = sort else {
            return JsValue::NULL;
        };
        let direction = match sort.direction {
            SortDirection::Ascending => "ascending",
            SortDirection::Descending => "descending",
        };
        let object = Object::new();
        set(&object, "column", number(sort.column as f64));
        set(&object, "direction", JsValue::from_str(direction));
        object.into()
    }

    /// `[{row, column, exact, shown}]`: every cell the frame drew. With
    /// `custom-cells`, also `fill` and `text` (`[r, g, b, a]`, 8-bit, or
    /// null) and `bar` (`{left, width}` in CSS px from the cell's left, and
    /// its `color`, or null); with `live` too, `flash` (`[r, g, b, a]`, its opacity in the
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
                    let bar = cell.paint.bar.map_or(JsValue::NULL, |(left, width, rgba)| {
                        let bar = Object::new();
                        set(&bar, "left", number(left));
                        set(&bar, "width", number(width));
                        set(&bar, "color", color(Some(rgba)));
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
