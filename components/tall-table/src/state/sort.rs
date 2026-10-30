//! `sort`: the arrows at each sortable header's right, their clicks'
//! cycle, and what a sort does to the table. The order is the source's
//! (`TallTableDelegate::sort`); a sort changes what every row index means,
//! so whatever the table keeps by index goes: its pages, the view's place,
//! a `Rows` or `Cells` selection, the jump's highlight, a copy running
//! (`docs/DECISIONS.md`, "Features").

#[cfg(test)]
use std::sync::Arc;

use gpui_kit::component::ActiveTheme as _;
#[cfg(not(feature = "pin"))]
use gpui_kit::component::scroll::Scrollbar;
use gpui_kit::*;

#[cfg(test)]
use super::row_height;
use super::{Direction, TallTableEvent, TallTableState};
use crate::column::{CELL_PADDING, LaidOutColumn};
use crate::delegate::TallTableDelegate;
use crate::sort::{self as order, Sort, SortDirection, SortIcons, SortRefused};

/// The arrows drawn as glyphs of the header's face: ascending,
/// descending, and a sortable column that isn't the sort.
pub(super) const ARROWS: [char; 3] = ['↑', '↓', '↕'];

/// The least an arrow's box is: an icon's size, the text's.
const ICON_PX: f32 = 14.0;

/// The gap between a sortable header's name and its arrow's box.
const GAP: f32 = 4.0;

/// The target's reach past the box on its left; on its right it ends where
/// `resize`'s band begins.
const TARGET_PAD: f32 = 4.0;

/// `resize`'s band's reach left of a column's right edge: its hairline and
/// padding. The arrow's target ends there, with the feature or without.
const BAND_REACH: f32 = 5.0;

/// The arrow's box: the widest of the glyphs' advances, at least the icon
/// size, so neither a sort nor icons change a width.
fn box_width(arrow_px: f32) -> f32 {
    arrow_px.max(ICON_PX).ceil()
}

/// What a sortable header's name gives up for its arrow: the gap and the
/// box ([`crate::column::layout_columns`]'s `sort_room`).
pub(super) fn room(arrow_px: f32) -> f32 {
    GAP + box_width(arrow_px)
}

/// The table's sort, with the feature.
#[derive(Default)]
pub(crate) struct SortState {
    pub(super) current: Option<Sort>,
    /// The host's icons, all three loaded; `None`: the glyphs.
    icons: Option<SortIcons>,
    /// The arrow a left press went down on: its release there sorts.
    pressed: Option<usize>,
    hovered: Option<usize>,
    /// A sort's reads are waiting for the end of the update that made it.
    load_deferred: bool,
    /// What the last frame drew of the arrows, for the tests.
    #[cfg(test)]
    pub(crate) drawn: Vec<DrawnArrow>,
    /// Each visible header cell's right padding as the last frame built it,
    /// for the tests.
    #[cfg(test)]
    pub(crate) header_padding: Vec<(usize, Option<DefiniteLength>)>,
    /// The asset source the icons are checked against, for the tests (the
    /// test app's loads nothing).
    #[cfg(test)]
    pub(crate) assets: Option<Arc<dyn AssetSource>>,
    #[cfg(test)]
    pub(crate) control: Control,
}

/// The sort fixture's cycle control (`fixtures/sort.json`): a way to get
/// the cycle wrong that the fixture must catch.
#[cfg(test)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub(crate) enum Control {
    #[default]
    None,
    /// Every kind descending first, as `DataTable`'s cycle.
    DescendingFirst,
}

/// An arrow as drawn (tests only).
#[cfg(test)]
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct DrawnArrow {
    pub(crate) column: usize,
    pub(crate) arrow: Arrow,
    pub(crate) color: Hsla,
    /// The target, in window pixels.
    pub(crate) target: Bounds<Pixels>,
}

/// What an arrow is drawn with (tests only).
#[cfg(test)]
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum Arrow {
    Glyph(char),
    Icon(SharedString),
}

impl<D: TallTableDelegate> TallTableState<D> {
    /// The order the rows are read in.
    pub fn sort(&self) -> Option<Sort> {
        self.sort_state.current
    }

    /// Sorts by `sort` (`None`: the source's own order), as a click on its
    /// arrow does; the same sort again re-reads every row (a host whose rows
    /// moved within the order). The source's refusal is returned, and
    /// nothing changes; so is the table's own, for a column past the end or
    /// not sortable (and a debug assertion), and on a closed table, whose
    /// source is never told anything again.
    pub fn set_sort(
        &mut self,
        sort: Option<Sort>,
        cx: &mut Context<Self>,
    ) -> Result<(), SortRefused> {
        if self.closed {
            return Err(SortRefused::new("The table is closed"));
        }
        if let Some(sort) = sort
            && !self
                .column_info
                .get(sort.column)
                .is_some_and(|column| column.sortable)
        {
            let refused = SortRefused::new(match self.column_info.get(sort.column) {
                Some(column) => format!("Column {} isn't sortable", column.name()),
                None => format!("There's no column {}", sort.column),
            });
            // The tests reach it on purpose (the random test's refused sorts).
            #[cfg(not(test))]
            debug_assert!(false, "set_sort: {}", refused.message);
            return Err(refused);
        }
        self.delegate.sort(sort, cx)?;
        self.apply_sort(sort, cx);
        Ok(())
    }

    /// Draws the arrows from `icons` (`None`: the glyphs). Each path is
    /// loaded from the asset source once, here; if any doesn't load, the
    /// glyphs are drawn (and a debug assertion names it).
    pub fn set_sort_icons(&mut self, icons: Option<SortIcons>, cx: &mut Context<Self>) {
        #[cfg(test)]
        let source = self
            .sort_state
            .assets
            .clone()
            .unwrap_or_else(|| cx.asset_source().clone());
        #[cfg(not(test))]
        let source = cx.asset_source().clone();
        self.sort_state.icons = icons.filter(|icons| {
            let paths = [&icons.ascending, &icons.descending, &icons.unsorted];
            let missing = paths
                .into_iter()
                .find(|path| !matches!(source.load(path), Ok(Some(_))));
            if let Some(path) = missing {
                // The tests reach it on purpose (the fallback's).
                #[cfg(not(test))]
                debug_assert!(
                    false,
                    "set_sort_icons: {path} doesn't load from the asset source"
                );
                let _ = path;
            }
            missing.is_none()
        });
        cx.notify();
    }

    /// A click on column `column`'s arrow: the next sort in its cycle. A
    /// refusal emits [`TallTableEvent::SortRefused`], and the order is as
    /// it was.
    fn click_sort(&mut self, column: usize, cx: &mut Context<Self>) {
        let Some(info) = self.column_info.get(column) else {
            return;
        };
        #[cfg(test)]
        let kind = match self.sort_state.control {
            Control::DescendingFirst => crate::ColumnKind::Float,
            Control::None => info.kind(),
        };
        #[cfg(not(test))]
        let kind = info.kind();
        let sort = order::next(self.sort_state.current, column, kind);
        if let (Err(refused), Some(sort)) = (self.set_sort(sort, cx), sort) {
            cx.emit(TallTableEvent::SortRefused(sort, refused));
        }
    }

    /// The source accepted `sort`: every page forgotten and its read
    /// cancelled, the view at the top (the sideways scroll kept), what's
    /// kept by index cleared, `Sorted` emitted, and the new order's reads
    /// planned once the update ends.
    fn apply_sort(&mut self, sort: Option<Sort>, cx: &mut Context<Self>) {
        self.sort_state.current = sort;
        self.sort_state.pressed = None;
        #[cfg(feature = "copy")]
        self.cancel_copy(cx);
        // A closed table cancelled every read at `close`.
        if !self.closed {
            for request in self.cache.forget_all() {
                self.delegate.cancel(request, cx);
            }
        }
        #[cfg(all(feature = "live", feature = "custom-cells"))]
        self.flashes.clear();
        self.hover = None;
        self.marked = None;
        #[cfg(feature = "select")]
        self.sort_selection(cx);
        self.scroll.set_top(0.0);
        self.direction = Direction::Still;
        self.scroll_settle = None;
        #[cfg(feature = "follow")]
        self.sort_lets_go(cx);
        cx.emit(TallTableEvent::Sorted(sort));
        self.sort_load(cx);
        cx.notify();
    }

    /// Plans the new order's reads once the update ends, as `live`'s and
    /// `copy`'s are: during a scrollbar drag, once its pointer rests.
    fn sort_load(&mut self, cx: &mut Context<Self>) {
        if std::mem::replace(&mut self.sort_state.load_deferred, true) {
            return;
        }
        let this = cx.weak_entity();
        cx.defer(move |cx| {
            let _ = this.update(cx, |this, cx| {
                this.sort_state.load_deferred = false;
                this.load_or_settle(cx);
            });
        });
    }

    /// The sorted column's name, before `set_columns` replaces them.
    pub(super) fn sorted_name(&self) -> Option<SharedString> {
        let sort = self.sort_state.current?;
        self.column_info
            .get(sort.column)
            .map(|column| column.name().clone())
    }

    /// The columns were replaced: the arrow pressed and hovered forgotten
    /// (their indices are other columns now), and the sort stays if the
    /// column at its index has the name it had (`name`) and is sortable,
    /// else it's cleared as `set_sort(None)` would. It's cleared whatever
    /// the source answers (a source must accept going back to none: one
    /// that refuses is told, and debug-asserted), since its index no longer
    /// names its column; a closed table's source isn't told.
    pub(super) fn keep_sort(&mut self, name: Option<SharedString>, cx: &mut Context<Self>) {
        self.sort_state.pressed = None;
        self.sort_state.hovered = None;
        let Some(sort) = self.sort_state.current else {
            return;
        };
        let kept = self
            .column_info
            .get(sort.column)
            .is_some_and(|column| column.sortable && Some(column.name()) == name.as_ref());
        if kept {
            return;
        }
        if self.closed {
            self.sort_state.current = None;
            return;
        }
        let cleared = self.delegate.sort(None, cx);
        debug_assert!(cleared.is_ok(), "a source refused going back to none");
        self.apply_sort(None, cx);
    }

    /// The room column `index` (laid out as `column`) leaves its arrow, if
    /// it draws one: sortable, and wide enough for its padding, the gap,
    /// and the box.
    pub(super) fn arrow_room(&self, index: usize, column: &LaidOutColumn) -> Option<f32> {
        let room = room(self.glyphs.arrow_px);
        (self.column_info[index].sortable && column.width >= CELL_PADDING + room).then_some(room)
    }

    /// Column `index`'s arrow box (laid out as `column`), if it draws one:
    /// its left from the column's left edge, and its width.
    pub(super) fn arrow_box(&self, index: usize, column: &LaidOutColumn) -> Option<(f32, f32)> {
        self.arrow_room(index, column)?;
        let box_px = box_width(self.glyphs.arrow_px);
        Some((column.width - CELL_PADDING / 2.0 - box_px, box_px))
    }

    /// The arrows over the header's cells, each a target of its own: under
    /// `resize`'s bands, beside `select`'s header press.
    pub(super) fn render_arrows(&mut self, cx: &mut Context<Self>) -> Option<Div> {
        // Each drawn arrow's right edge and box left in its column's region
        // (with `pin`, the pinned columns' or the scrolled ones'), the box as
        // the layout probe reports it (`arrow_box`).
        let place = self.place();
        let visible: Vec<(usize, f32, f32)> = self
            .visible_columns()
            .filter_map(|(index, column)| {
                let (box_x, _) = self.arrow_box(index, column)?;
                let left = place.layer_left(index, column.x, self.scroll_x);
                // A scrolled column's arrow partly under the run (`pin`)
                // isn't drawn: it couldn't be pressed there.
                #[cfg(feature = "pin")]
                if !place.holds(index) && left + box_x - TARGET_PAD < 0.0 {
                    return None;
                }
                Some((index, left + column.width, left + box_x))
            })
            .collect();
        #[cfg(test)]
        self.sort_state.drawn.clear();
        // An arrow no longer drawn (scrolled away) never hears the pointer
        // leave or come up: its hover and press are forgotten.
        for state in [&mut self.sort_state.hovered, &mut self.sort_state.pressed] {
            if state.is_some_and(|index| !visible.iter().any(|(drawn, ..)| *drawn == index)) {
                *state = None;
            }
        }
        if visible.is_empty() {
            return None;
        }
        let theme = cx.theme();
        let full = theme.table_head_foreground;
        let box_px = box_width(self.glyphs.arrow_px);
        #[cfg(any(test, not(feature = "pin")))]
        let gutter = self.gutter_width();
        let mut arrows = Vec::with_capacity(visible.len());
        for (index, edge, box_left) in visible {
            let direction = self
                .sort_state
                .current
                .filter(|sort| sort.column == index)
                .map(|sort| sort.direction);
            let color = match direction {
                None if self.sort_state.hovered != Some(index) => full.opacity(0.5),
                _ => full,
            };
            let left = box_left - TARGET_PAD;
            let width = edge - BAND_REACH - left;
            let (glyph, icon) = match (&self.sort_state.icons, direction) {
                (Some(icons), Some(SortDirection::Ascending)) => (None, Some(&icons.ascending)),
                (Some(icons), Some(SortDirection::Descending)) => (None, Some(&icons.descending)),
                (Some(icons), None) => (None, Some(&icons.unsorted)),
                (None, Some(SortDirection::Ascending)) => (Some(ARROWS[0]), None),
                (None, Some(SortDirection::Descending)) => (Some(ARROWS[1]), None),
                (None, None) => (Some(ARROWS[2]), None),
            };
            #[cfg(test)]
            self.sort_state.drawn.push(DrawnArrow {
                column: index,
                arrow: match (glyph, icon) {
                    (Some(glyph), _) => Arrow::Glyph(glyph),
                    (None, icon) => Arrow::Icon(icon.cloned().unwrap_or_default()),
                },
                color,
                target: Bounds::new(
                    point(
                        self.body.origin.x
                            + px(gutter
                                + left
                                + if place.holds(index) {
                                    0.0
                                } else {
                                    place.edge()
                                }),
                        self.body.origin.y - row_height(),
                    ),
                    size(px(width), row_height()),
                ),
            });
            let mark = div()
                .absolute()
                .top_0()
                .h_full()
                .left(px(TARGET_PAD))
                .w(px(box_px))
                .flex()
                .items_center()
                .justify_center()
                .text_color(color);
            let mark = match (glyph, icon) {
                (Some(glyph), _) => mark.child(SharedString::from(glyph.to_string())),
                (None, Some(path)) => {
                    mark.child(svg().path(path.clone()).size(px(ICON_PX)).text_color(color))
                }
                (None, None) => mark,
            };
            arrows.push((
                place.holds(index),
                div()
                    .id(("tall-table-sort", index))
                    .absolute()
                    .top_0()
                    .h_full()
                    .left(px(left))
                    .w(px(width))
                    .occlude()
                    .cursor_pointer()
                    .on_hover(cx.listener(move |this, hovered: &bool, _, cx| {
                        let hovered = hovered.then_some(index);
                        if this.sort_state.hovered != hovered
                            && (hovered.is_some() || this.sort_state.hovered == Some(index))
                        {
                            this.sort_state.hovered = hovered;
                            cx.notify();
                        }
                    }))
                    .on_mouse_down(
                        MouseButton::Left,
                        cx.listener(move |this, _: &MouseDownEvent, window, cx| {
                            cx.stop_propagation();
                            this.hide_tooltip(cx);
                            window.focus(&this.focus_handle, cx);
                            this.sort_state.pressed = Some(index);
                        }),
                    )
                    .on_mouse_up(
                        MouseButton::Left,
                        cx.listener(move |this, _: &MouseUpEvent, _, cx| {
                            if this.sort_state.pressed.take() == Some(index) {
                                this.click_sort(index, cx);
                            }
                        }),
                    )
                    .on_mouse_up_out(
                        MouseButton::Left,
                        cx.listener(move |this, _: &MouseUpEvent, _, _| {
                            if this.sort_state.pressed == Some(index) {
                                this.sort_state.pressed = None;
                            }
                        }),
                    )
                    .child(mark),
            ));
        }
        #[cfg(not(feature = "pin"))]
        let arrows = div()
            .absolute()
            .top_0()
            .bottom_0()
            .left(px(gutter))
            .right(Scrollbar::width())
            .overflow_hidden()
            .children(arrows.into_iter().map(|(_, arrow)| arrow));
        #[cfg(feature = "pin")]
        let arrows = {
            let (pinned, scrolled): (Vec<_>, Vec<_>) =
                arrows.into_iter().partition(|(holds, _)| *holds);
            self.split_layer(
                place,
                pinned.into_iter().map(|(_, arrow)| arrow),
                scrolled.into_iter().map(|(_, arrow)| arrow),
            )
        };
        Some(arrows)
    }
}
