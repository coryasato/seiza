//! What a seiza host does with the tall table's events, written once for
//! every host (Tycho, the observatory's GPUI contender, the table's bare
//! host). The table depends on gpui-kit alone and sets no marks (its
//! `CLAUDE.md`, rule 1), and `seiza` knows no table, so the glue between
//! them lives here: the filled mark (with `live`, the refreshed mark), the
//! scrollbar's targets, with `follow` the tail mark and the following
//! flag, with `resize` the widths a resize left, with `select` the
//! selection, with `copy` the clipboard's writer ([`clipboard`]), with
//! `sort` the order and its mark, with `pin` the columns pinned, with
//! `reorder` the columns' order, with `clicks` each press, with `hide` the
//! columns' hidden flags, with `find` each step's outcome, with `popover`
//! each press of its button, with `header-icon` each press of a header's
//! icon, and the probes (`TallTableProbe`,
//! `TallTableLayout`, `CellProbe`) as JS values on globals a host names.
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
    /// The global holding the columns pinned in effect (`pin`'s
    /// [`TallTableEvent::Pinned`]), replaced as the run changes.
    #[cfg(feature = "pin")]
    pub pinned: Option<&'static str>,
    /// The global holding the columns' order (`reorder`'s
    /// [`TallTableEvent::ColumnsMoved`]): `[index]`, the column's index
    /// drawn at each place, replaced at each change. Unset until the first.
    #[cfg(feature = "reorder")]
    pub column_order: Option<&'static str>,
    /// The global holding the last press (`clicks`'
    /// [`TallTableEvent::Clicked`], [`js::click`]), replaced at each, its
    /// `count` the presses published so far (the bridge's own count, every
    /// `Publish` in the page together: a host may build one an event), so
    /// a script sees a second press on the same target.
    #[cfg(feature = "clicks")]
    pub click: Option<&'static str>,
    /// The global holding the group cells drawn (`group-headers`'
    /// [`TallTableEvent::Groups`], [`js::groups`]), replaced as they change.
    #[cfg(feature = "group-headers")]
    pub groups: Option<&'static str>,
    /// The global holding every column's hidden flag, by index (`hide`'s
    /// [`TallTableEvent::ColumnsHidden`]): `[bool]`, replaced at each
    /// change. Unset until the first.
    #[cfg(feature = "hide")]
    pub hidden: Option<&'static str>,
    /// The global holding the last step's state (`find`'s
    /// [`TallTableEvent::FindStarted`] and [`TallTableEvent::Found`],
    /// [`js::found`]), replaced at each, its `count` the outcomes
    /// published so far (the bridge's own count), so a script sees a step
    /// that found the same cell again. Unset until the first.
    #[cfg(feature = "find")]
    pub found: Option<&'static str>,
    /// The global holding the last press of the popover's button
    /// (`popover`'s [`TallTableEvent::PopoverButton`], [`js::popover_cell`]
    /// with a `count`: the presses published so far, the bridge's own
    /// count), replaced at each. Unset until the first.
    #[cfg(feature = "popover")]
    pub popover_button: Option<&'static str>,
    /// The global holding the last press of a header's icon
    /// (`header-icon`'s [`TallTableEvent::HeaderIconPressed`],
    /// [`js::icon_press`]), replaced at each, its `count` the presses
    /// published so far (the bridge's own count). Unset until the first.
    #[cfg(feature = "header-icon")]
    pub icon_press: Option<&'static str>,
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
                    js::set_global(name, &js::sort(sort));
                }
                if let Some(mark) = self.sorted_mark {
                    let _ = seiza::marks::mark(mark);
                }
            }
            #[cfg(all(feature = "pin", target_family = "wasm"))]
            TallTableEvent::Pinned(columns) => {
                if let Some(name) = self.pinned {
                    js::set_global(name, &(*columns as f64).into());
                }
            }
            #[cfg(all(feature = "reorder", target_family = "wasm"))]
            TallTableEvent::ColumnsMoved { order, .. } => {
                if let Some(name) = self.column_order {
                    js::set_global(name, &js::order(order));
                }
            }
            #[cfg(all(feature = "clicks", target_family = "wasm"))]
            TallTableEvent::Clicked(click) => {
                if let Some(name) = self.click {
                    use std::sync::atomic::{AtomicU32, Ordering};
                    static PUBLISHED: AtomicU32 = AtomicU32::new(0);
                    let count = PUBLISHED.fetch_add(1, Ordering::Relaxed) + 1;
                    js::set_global(name, &js::click(click, count.into()));
                }
            }
            #[cfg(all(feature = "hide", target_family = "wasm"))]
            TallTableEvent::ColumnsHidden(hidden) => {
                if let Some(name) = self.hidden {
                    js::set_global(name, &js::hidden(hidden));
                }
            }
            #[cfg(all(feature = "find", target_family = "wasm"))]
            TallTableEvent::FindStarted => {
                if let Some(name) = self.found {
                    js::set_global(name, &js::found(None, find_count(false)));
                }
            }
            #[cfg(all(feature = "find", target_family = "wasm"))]
            TallTableEvent::Found(outcome) => {
                if let Some(name) = self.found {
                    js::set_global(name, &js::found(Some(outcome), find_count(true)));
                }
            }
            #[cfg(all(feature = "popover", target_family = "wasm"))]
            TallTableEvent::PopoverButton(cell) => {
                if let Some(name) = self.popover_button {
                    use std::sync::atomic::{AtomicU32, Ordering};
                    static PUBLISHED: AtomicU32 = AtomicU32::new(0);
                    let count = PUBLISHED.fetch_add(1, Ordering::Relaxed) + 1;
                    js::set_global(name, &js::popover_press(*cell, count));
                }
            }
            #[cfg(all(feature = "header-icon", target_family = "wasm"))]
            TallTableEvent::HeaderIconPressed(press) => {
                if let Some(name) = self.icon_press {
                    use std::sync::atomic::{AtomicU32, Ordering};
                    static PUBLISHED: AtomicU32 = AtomicU32::new(0);
                    let count = PUBLISHED.fetch_add(1, Ordering::Relaxed) + 1;
                    js::set_global(name, &js::icon_press(press, count));
                }
            }
            #[cfg(all(feature = "group-headers", target_family = "wasm"))]
            TallTableEvent::Groups(groups) => {
                if let Some(name) = self.groups {
                    js::set_global(name, &js::groups(groups));
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

/// The outcomes published so far, every `Publish` in the page together
/// (`find`): one more when `ended`.
#[cfg(all(feature = "find", target_family = "wasm"))]
fn find_count(ended: bool) -> u32 {
    use std::sync::atomic::{AtomicU32, Ordering};
    static PUBLISHED: AtomicU32 = AtomicU32::new(0);
    if ended {
        PUBLISHED.fetch_add(1, Ordering::Relaxed) + 1
    } else {
        PUBLISHED.load(Ordering::Relaxed)
    }
}

/// The probes as JS values, for a host that puts them somewhere of its own.
#[cfg(target_family = "wasm")]
pub mod js {
    use js_sys::{Array, Object, Reflect};
    #[cfg(feature = "select")]
    use seiza_tall_table::{Cell, TallTableSelection};
    use seiza_tall_table::{CellProbe, ColumnProbe, TallTableLayout, TallTableProbe};
    #[cfg(feature = "clicks")]
    use seiza_tall_table::{ClickKind, ClickTarget, TallTableClick};
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
    /// ([`sort`]); with `find`, `find`: `{term, current, out}`, the term
    /// or null, the current match `{row, column}` (its index) or null,
    /// and whether a step is out; with `popover`, `popover` ([`popover`])
    /// and `cue` (`{cell, bounds}`, or null).
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
        set(&object, "sort", sort(&probe.sort));
        #[cfg(feature = "find")]
        {
            let find = Object::new();
            set(&find, "term", text(probe.find.term.as_deref()));
            set(&find, "current", found_cell(probe.find.current));
            set(&find, "out", probe.find.out.into());
            set(&object, "find", find.into());
        }
        #[cfg(feature = "popover")]
        {
            set(&object, "popover", popover(probe.popover.as_deref()));
            let cue = probe.cue.as_ref().map_or(JsValue::NULL, |cue| {
                let object = Object::new();
                set(&object, "cell", popover_cell(cue.cell));
                set(&object, "bounds", rect(cue.bounds));
                object.into()
            });
            set(&object, "cue", cue);
        }
        object.into()
    }

    /// `{row, column}` (the column's index) (`popover`).
    #[cfg(feature = "popover")]
    pub fn popover_cell(cell: seiza_tall_table::PopoverCell) -> JsValue {
        let object = Object::new();
        set(&object, "row", number(cell.row as f64));
        set(&object, "column", number(cell.column as f64));
        object.into()
    }

    /// `{row, column, count}`: a press of the popover's button, `count`
    /// the presses published so far (`popover`).
    #[cfg(feature = "popover")]
    pub fn popover_press(cell: seiza_tall_table::PopoverCell, count: u32) -> JsValue {
        let object = Object::new();
        set(&object, "row", number(cell.row as f64));
        set(&object, "column", number(cell.column as f64));
        set(&object, "count", number(count));
        object.into()
    }

    /// `[x, y, width, height]`, in CSS px (`popover`).
    #[cfg(feature = "popover")]
    fn rect(bounds: [f32; 4]) -> JsValue {
        bounds
            .iter()
            .map(|value| number(*value))
            .collect::<Array>()
            .into()
    }

    /// The open popover (`popover`), or null: `{cell, bounds, below,
    /// chars, cut, scroll, contentHeight, button}`, `bounds` and `button`
    /// `[x, y, width, height]` (`button` null without one).
    #[cfg(feature = "popover")]
    fn popover(probe: Option<&seiza_tall_table::PopoverProbe>) -> JsValue {
        probe.map_or(JsValue::NULL, |probe| {
            let object = Object::new();
            set(&object, "cell", popover_cell(probe.cell));
            set(&object, "bounds", rect(probe.bounds));
            set(&object, "below", probe.below.into());
            set(&object, "chars", number(probe.chars as f64));
            set(&object, "cut", probe.cut.into());
            set(&object, "scroll", number(probe.scroll));
            set(&object, "contentHeight", number(probe.content_height));
            set(&object, "button", probe.button.map_or(JsValue::NULL, rect));
            object.into()
        })
    }

    /// `{row, column}` (the column's index), or null (`find`).
    #[cfg(feature = "find")]
    fn found_cell(cell: Option<seiza_tall_table::FoundCell>) -> JsValue {
        cell.map_or(JsValue::NULL, |cell| {
            let object = Object::new();
            set(&object, "row", number(cell.row as f64));
            set(&object, "column", number(cell.column as f64));
            object.into()
        })
    }

    /// `{outcome, cell, wrapped, message, count}` (`find`): `outcome`
    /// `started` while a step is out, then `match` (its `cell`, `{row,
    /// column}`, and `wrapped`), `none`, `refused`, `failed` (its
    /// `message`), or `cancelled`; `count` the outcomes published so far.
    #[cfg(feature = "find")]
    pub fn found(outcome: Option<&seiza_tall_table::FindOutcome>, count: u32) -> JsValue {
        use seiza_tall_table::FindOutcome;
        let object = Object::new();
        let (name, cell, wrapped, message) = match outcome {
            None => ("started", None, false, None),
            Some(FindOutcome::Match { cell, wrapped }) => ("match", Some(*cell), *wrapped, None),
            Some(FindOutcome::NoMatch) => ("none", None, false, None),
            Some(FindOutcome::Refused) => ("refused", None, false, None),
            Some(FindOutcome::Failed(message)) => ("failed", None, false, Some(message.as_ref())),
            Some(FindOutcome::Cancelled) => ("cancelled", None, false, None),
            Some(_) => ("unknown", None, false, None),
        };
        set(&object, "outcome", JsValue::from_str(name));
        set(&object, "cell", found_cell(cell));
        set(&object, "wrapped", wrapped.into());
        set(&object, "message", text(message));
        set(&object, "count", number(f64::from(count)));
        object.into()
    }

    /// `{left, top, rowHeight, cellsWidth, columns}` (CSS px from the
    /// canvas's top-left), `columns` as [`columns`] writes them. With
    /// `pin`, also `pinned`: the columns pinned in effect, the first
    /// `pinned` drawn at `left + x` whatever the sideways scroll. With
    /// `format`, also `advances`: `{char: px}`, each character a format
    /// writes and its advance at the text in effect. With `group-headers`,
    /// also `headerRows`: the header's rows, each `rowHeight`, the names'
    /// the bottom one.
    pub fn layout(layout: &TallTableLayout) -> JsValue {
        let object = Object::new();
        set(&object, "left", number(layout.left));
        set(&object, "top", number(layout.top));
        set(&object, "rowHeight", number(layout.row_height));
        set(&object, "cellsWidth", number(layout.cells_width));
        set(&object, "columns", columns(&layout.columns));
        #[cfg(feature = "pin")]
        set(&object, "pinned", number(layout.pinned as f64));
        #[cfg(feature = "format")]
        {
            let advances = Object::new();
            for (ch, px) in &layout.advances {
                set(&advances, &ch.to_string(), number(*px));
            }
            set(&object, "advances", advances.into());
        }
        #[cfg(feature = "group-headers")]
        set(&object, "headerRows", number(layout.header_rows as f64));
        object.into()
    }

    /// `[{level, label, start, end, pinned, left, width, labelX}]`
    /// (`group-headers`): each group cell drawn, level by level, `left`
    /// and `labelX` in CSS px from the cells area's left, `start..end` the
    /// run's places (both halves of a run split at `pin`'s edge share them).
    #[cfg(feature = "group-headers")]
    pub fn groups(groups: &[seiza_tall_table::GroupProbe]) -> JsValue {
        let list: Array = groups
            .iter()
            .map(|group| {
                let object = Object::new();
                set(&object, "level", number(group.level as f64));
                set(&object, "label", JsValue::from_str(&group.label));
                set(&object, "start", number(group.start as f64));
                set(&object, "end", number(group.end as f64));
                set(&object, "pinned", JsValue::from_bool(group.pinned));
                set(&object, "left", number(group.left));
                set(&object, "width", number(group.width));
                set(&object, "labelX", number(group.label_x));
                JsValue::from(object)
            })
            .collect();
        list.into()
    }

    /// `[{name, x, width, kind, budget}]`: `budget` is the characters a
    /// float may take. With `sort`, also `arrow`: its box, `{x, width}` in
    /// CSS px from the column's left edge, or `null` where none is drawn.
    /// With `header-icon`, also `icon`: its badge's box, the same shape.
    /// With `reorder`, also `index`: the column's index (the list is in
    /// drawn order, each at its place). With `hide`, also `hidden`: laid
    /// out at width 0 and drawn nowhere.
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
                #[cfg(feature = "header-icon")]
                set(
                    &object,
                    "icon",
                    column.icon.map_or(JsValue::NULL, |(x, width)| {
                        let icon = Object::new();
                        set(&icon, "x", number(x));
                        set(&icon, "width", number(width));
                        icon.into()
                    }),
                );
                #[cfg(feature = "reorder")]
                set(&object, "index", number(column.index as f64));
                #[cfg(feature = "hide")]
                set(&object, "hidden", column.hidden.into());
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

    /// `{kind, target, row, column, level, start, end, x, y, modifiers,
    /// count}` (`clicks`): `kind` `press`, `double`, or `context`; `target`
    /// `cell`, `row`, `column`, `corner`, `blank`, `group`
    /// (`group-headers`), or `unknown` (a target this bridge doesn't know),
    /// with `row` and `column` (its place) where it has one, else `null`; a
    /// group's `level` and its run's places `start` and `end` (`null` for
    /// another target); `x` and `y` the pointer in CSS px of
    /// the window; `modifiers` the names held (`control`, `alt`, `shift`,
    /// `platform`); `count` the caller's.
    #[cfg(feature = "clicks")]
    pub fn click(click: &TallTableClick, count: f64) -> JsValue {
        let kind = match click.kind {
            ClickKind::Press => "press",
            ClickKind::Double => "double",
            ClickKind::Context => "context",
            // A kind this bridge was built before.
            _ => "unknown",
        };
        let (target, row, column) = match click.target {
            ClickTarget::Cell { row, column } => ("cell", Some(row), Some(column)),
            ClickTarget::Row(row) => ("row", Some(row), None),
            ClickTarget::Column(column) => ("column", None, Some(column)),
            ClickTarget::Corner => ("corner", None, None),
            ClickTarget::Blank => ("blank", None, None),
            #[cfg(feature = "group-headers")]
            ClickTarget::Group { .. } => ("group", None, None),
            _ => ("unknown", None, None),
        };
        #[cfg(feature = "group-headers")]
        let group = match click.target {
            ClickTarget::Group { level, start, end } => Some((level, start, end)),
            _ => None,
        };
        #[cfg(not(feature = "group-headers"))]
        let group: Option<(usize, usize, usize)> = None;
        let or_null = |value: Option<f64>| value.map_or(JsValue::NULL, number);
        let held = click.modifiers;
        let modifiers: Array = [
            ("control", held.control),
            ("alt", held.alt),
            ("shift", held.shift),
            ("platform", held.platform),
        ]
        .into_iter()
        .filter(|(_, on)| *on)
        .map(|(name, _)| JsValue::from_str(name))
        .collect();
        let object = Object::new();
        set(&object, "kind", JsValue::from_str(kind));
        set(&object, "target", JsValue::from_str(target));
        set(&object, "row", or_null(row.map(|row| row as f64)));
        set(
            &object,
            "column",
            or_null(column.map(|column| column as f64)),
        );
        let place = |pick: fn((usize, usize, usize)) -> usize| {
            or_null(group.map(|group| pick(group) as f64))
        };
        set(&object, "level", place(|group| group.0));
        set(&object, "start", place(|group| group.1));
        set(&object, "end", place(|group| group.2));
        set(&object, "x", number(f32::from(click.position.x)));
        set(&object, "y", number(f32::from(click.position.y)));
        set(&object, "modifiers", modifiers.into());
        set(&object, "count", number(count));
        object.into()
    }

    /// `{column, bounds, modifiers, count}` (`header-icon`): a press of a
    /// header's icon, `column` its index, `bounds` its badge's visible
    /// part, `[x, y, width, height]` in CSS px of the window, `modifiers`
    /// the names held at the release (`control`, `alt`, `shift`,
    /// `platform`), `count` the presses published so far.
    #[cfg(feature = "header-icon")]
    pub fn icon_press(press: &seiza_tall_table::HeaderIconPress, count: u32) -> JsValue {
        let bounds: Array = [
            press.bounds.origin.x,
            press.bounds.origin.y,
            press.bounds.size.width,
            press.bounds.size.height,
        ]
        .into_iter()
        .map(|length| number(f32::from(length)))
        .collect();
        let held = press.modifiers;
        let modifiers: Array = [
            ("control", held.control),
            ("alt", held.alt),
            ("shift", held.shift),
            ("platform", held.platform),
        ]
        .into_iter()
        .filter(|(_, on)| *on)
        .map(|(name, _)| JsValue::from_str(name))
        .collect();
        let object = Object::new();
        set(&object, "column", number(press.column as f64));
        set(&object, "bounds", bounds.into());
        set(&object, "modifiers", modifiers.into());
        set(&object, "count", number(count));
        object.into()
    }

    /// `[bool]`: each column's hidden flag, by index (`hide`).
    #[cfg(feature = "hide")]
    pub fn hidden(hidden: &[bool]) -> JsValue {
        let list: Array = hidden.iter().map(|&hidden| JsValue::from(hidden)).collect();
        list.into()
    }

    /// `[index]`: the column's index drawn at each place (`reorder`).
    #[cfg(feature = "reorder")]
    pub fn order(order: &[usize]) -> JsValue {
        let list: Array = order.iter().map(|&index| number(index as f64)).collect();
        list.into()
    }

    /// The first key as `{column, direction}`, or `null` with none:
    /// `direction` is `ascending` or `descending`, `column` the column's
    /// index. The table sorts by one key at most; a script reads it as it
    /// did before the keys were a list.
    #[cfg(feature = "sort")]
    pub fn sort(keys: &[Sort]) -> JsValue {
        let Some(sort) = keys.first() else {
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
    /// alpha, or null). With `find`, `found` (null where nothing's drawn
    /// of the find, `"cell"` for the cell tinted whole, or `[[start, end]]`,
    /// each range in UTF-8 bytes of the drawn text, after the cut) and
    /// `current` (the current match, edged).
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
                #[cfg(feature = "find")]
                {
                    let found = match &cell.found {
                        None => JsValue::NULL,
                        Some(seiza_tall_table::FoundProbe::Ranges(ranges)) => ranges
                            .iter()
                            .map(|range| {
                                [range.start, range.end]
                                    .iter()
                                    .map(|at| number(*at as f64))
                                    .collect::<Array>()
                            })
                            .collect::<Array>()
                            .into(),
                        Some(_) => JsValue::from_str("cell"),
                    };
                    set(&object, "found", found);
                    set(&object, "current", cell.current.into());
                }
                JsValue::from(object)
            })
            .collect();
        list.into()
    }
}
