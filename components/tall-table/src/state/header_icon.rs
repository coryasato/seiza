//! `header-icon`: each column's icon over its header's start, a target of
//! its own (as `sort`'s arrow is): a badge at rest, a raised backdrop under
//! the pointer and while pressed, and its left press, stopped at the press
//! and reported at its release on the same icon
//! ([`TallTableEvent::HeaderIconPressed`]). A right press, a long press,
//! and `clicks`' Ctrl+left context press aren't stopped: they're its
//! header's, so the target never occludes (`docs/DECISIONS.md`, "Features").
//! [`crate::header_icon`] is the geometry.

use std::sync::Arc;

use gpui_kit::component::ActiveTheme as _;
#[cfg(not(feature = "pin"))]
use gpui_kit::component::scroll::Scrollbar;
use gpui_kit::prelude::FluentBuilder as _;
use gpui_kit::*;

use super::{TallTableEvent, TallTableState};
use crate::column::{LaidOutColumn, TallTableColumn};
use crate::delegate::TallTableDelegate;
use crate::header_icon::{Boxes, HeaderIcon, HeaderIconPress, Look, boxes, room};

/// The icons' hover and press, with the feature.
#[derive(Default)]
pub(crate) struct IconState {
    /// The icon under the pointer, by its column's index (with `reorder`,
    /// not its place), as the press is.
    hovered: Option<usize>,
    /// The icon a left press went down on: its release there reports.
    pub(super) pressed: Option<usize>,
    /// What the last frame drew of the icons, for the tests.
    #[cfg(test)]
    pub(crate) drawn: Vec<DrawnIcon>,
    /// The asset source the paths are checked against, for the tests (the
    /// test app's loads nothing).
    #[cfg(test)]
    pub(crate) assets: Option<Arc<dyn AssetSource>>,
    #[cfg(test)]
    pub(crate) control: Control,
    /// Each visible header cell's column's index, left padding, and text
    /// alignment as the last frame built it, for the tests.
    #[cfg(test)]
    pub(crate) header_names: Vec<(usize, Option<DefiniteLength>, Option<TextAlign>)>,
}

/// The random test's negative control (tests only).
#[cfg(test)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub(crate) enum Control {
    #[default]
    None,
    /// The icon's left press isn't stopped: it goes on to its header.
    Unstopped,
}

/// An icon as drawn (tests only), in window pixels, before its region
/// cuts it.
#[cfg(test)]
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct DrawnIcon {
    /// Its column's index (with `reorder`, not its place).
    pub(crate) column: usize,
    pub(crate) path: SharedString,
    pub(crate) color: Hsla,
    /// The badge's fill; none while raised.
    pub(crate) fill: Option<Hsla>,
    pub(crate) raised: bool,
    /// Dimmed with its lifted column's name (`reorder`).
    pub(crate) dimmed: bool,
    /// The glyph's side.
    pub(crate) glyph: f32,
    /// The badge at rest, or the raised look's box.
    pub(crate) look: Bounds<Pixels>,
    /// Where the hover and the press are found.
    pub(crate) target: Bounds<Pixels>,
}

/// Each icon of `columns` checked against `source`, once: one whose path
/// doesn't load draws nothing. No assertion: a host's own native test
/// builds its columns in GPUI's test app, whose source loads nothing.
pub(super) fn load_icons(columns: &mut [TallTableColumn], source: &Arc<dyn AssetSource>) {
    for column in columns {
        if let Some(icon) = &mut column.icon {
            load_icon(icon, source);
        }
    }
}

fn load_icon(icon: &mut HeaderIcon, source: &Arc<dyn AssetSource>) {
    icon.loaded = matches!(source.load(&icon.path), Ok(Some(_)));
}

/// The raised look's shadow, as Tycho's canvas draws it.
fn raised_shadow() -> Vec<BoxShadow> {
    vec![BoxShadow {
        color: hsla(0., 0., 0., 0.55),
        offset: point(px(0.), px(2.)),
        blur_radius: px(6.),
        spread_radius: px(0.),
        inset: false,
    }]
}

/// A lifted column's icon, dimmed as its name is (`reorder`).
#[cfg(feature = "reorder")]
const LIFTED_OPACITY: f32 = 0.5;

impl<D: TallTableDelegate> TallTableState<D> {
    /// Sets, changes, or removes (`None`) column `index`'s icon (by index,
    /// as [`TallTableState::columns`], wherever it's drawn) without
    /// `set_columns`, which resets what the table keeps by column. Its path
    /// is loaded from the asset source once, here: one that doesn't load
    /// draws no icon and takes no room. The
    /// columns are laid out again only when the icon's room changes (one
    /// added or removed, a failed path counted as none); another path or
    /// color only redraws. A press held on an icon this removes is
    /// forgotten: its release reports nothing. No event of its own (with
    /// `pin`, `Pinned` if the new layout changed the run in effect); an
    /// index past the last changes nothing, quietly.
    pub fn set_column_icon(
        &mut self,
        index: usize,
        icon: Option<HeaderIcon>,
        cx: &mut Context<Self>,
    ) {
        let source = self.icon_source(cx);
        let Some(column) = self.column_info.get_mut(index) else {
            return;
        };
        let had = column.has_icon();
        column.icon = icon.map(|mut icon| {
            load_icon(&mut icon, &source);
            icon
        });
        let has = column.has_icon();
        if !has {
            self.forget_icons(|held| held == index);
        }
        if had != has {
            self.lay_out(cx);
        }
        cx.notify();
    }

    /// The asset source the icons' paths are checked against.
    pub(super) fn icon_source(&self, cx: &App) -> Arc<dyn AssetSource> {
        #[cfg(test)]
        if let Some(assets) = &self.icon_state.assets {
            return assets.clone();
        }
        cx.asset_source().clone()
    }

    /// The hovered and the pressed icon forgotten where `gone` says their
    /// column's is: a release finds nothing to report.
    fn forget_icons(&mut self, gone: impl Fn(usize) -> bool) {
        for held in [&mut self.icon_state.hovered, &mut self.icon_state.pressed] {
            if held.is_some_and(&gone) {
                *held = None;
            }
        }
    }

    /// The columns were replaced: the pressed icon forgotten (its index is
    /// another column now). The hovered one stays: GPUI tells an element
    /// its hover only when it changes, and the icon at that index, still
    /// under the pointer, keeps its id; a frame that draws none there
    /// forgets it.
    pub(super) fn forget_pressed_icon(&mut self) {
        self.icon_state.pressed = None;
    }

    /// Whether a drag of the table's is on (a carried column, a resize, a
    /// selection, a scrollbar): no icon is raised by the pointer crossing
    /// it meanwhile.
    fn icon_hover_held(&self) -> bool {
        #[cfg(feature = "reorder")]
        if self.is_moving() {
            return true;
        }
        #[cfg(feature = "resize")]
        if self.resizing.is_some() {
            return true;
        }
        #[cfg(feature = "select")]
        if self.is_selecting() {
            return true;
        }
        self.drag.is_some()
    }

    /// A column was hidden (`hide`): an icon pressed or hovered on a
    /// hidden column forgotten.
    #[cfg(feature = "hide")]
    pub(super) fn forget_hidden_icons(&mut self) {
        let hidden: Vec<bool> = self
            .column_info
            .iter()
            .map(|column| column.hidden)
            .collect();
        self.forget_icons(|held| hidden.get(held).copied().unwrap_or(true));
    }

    /// A pointer move with no button down: the press's release went unseen
    /// (outside the window), so it's no longer held.
    pub(super) fn icon_release_unseen(&mut self, cx: &mut Context<Self>) {
        if self.icon_state.pressed.take().is_some() {
            cx.notify();
        }
    }

    /// What the name of the column at place `at` (laid out as `column`)
    /// gives up for its icon, if it draws one: the badge and its gap.
    pub(super) fn icon_room(&self, at: usize, column: &LaidOutColumn) -> Option<f32> {
        self.icon_boxes(at, column).map(|_| room(self.sizes()))
    }

    /// The icon's room in a fitted width (`resize`), for the column of
    /// index `index`: its badge and gap, 0 with no icon.
    #[cfg(feature = "resize")]
    pub(super) fn icon_fit_room(&self, index: usize) -> f32 {
        if self.column_info[index].has_icon() {
            room(self.sizes())
        } else {
            0.0
        }
    }

    /// The boxes of the icon of the column at place `at` (laid out as
    /// `column`), if it draws one: an icon set and loaded, in a column wide
    /// enough for its padding and the badge (a hidden column's 0 never is).
    fn icon_boxes(&self, at: usize, column: &LaidOutColumn) -> Option<Boxes> {
        if !self.column_info[column.index(at)].has_icon() {
            return None;
        }
        boxes(column.width, self.sizes())
    }

    /// The badge of the column at place `at`, as the layout probe reports
    /// it: its left from the column's left edge, and its width.
    pub(super) fn icon_box(&self, at: usize, column: &LaidOutColumn) -> Option<(f32, f32)> {
        self.icon_boxes(at, column).map(|boxes| boxes.badge)
    }

    /// The left button came up on the icon of column `index`, which it
    /// went down on: reported, if the column still draws one, with its
    /// badge where the layout in effect puts it (a move may have come
    /// since the frame), cut to its region's visible part.
    fn icon_released(&mut self, index: usize, modifiers: Modifiers, cx: &mut Context<Self>) {
        let Some(at) = self.place_of(index) else {
            return;
        };
        let column = &self.columns[at];
        let Some(boxes) = self.icon_boxes(at, column) else {
            return;
        };
        let place = self.place();
        let sizes = self.sizes();
        let look = Look::new(sizes);
        // Its region: the pinned columns' (`pin`), or the scrolled ones'.
        let (from, region) = if place.holds(at) {
            (0.0, place.edge())
        } else {
            (place.edge(), (self.cells_width() - place.edge()).max(0.0))
        };
        let left = place.layer_left(at, column.x, self.scroll_x) + boxes.badge.0;
        let (start, end) = (
            left.clamp(0.0, region),
            (left + boxes.badge.1).clamp(0.0, region),
        );
        let row = f32::from(sizes.row());
        let bounds = Bounds::new(
            point(
                self.body.origin.x + px(self.gutter_width() + from + start),
                self.body.origin.y - px(row) + px(((row - look.badge.1) / 2.0).floor()),
            ),
            size(px(end - start), px(look.badge.1)),
        );
        cx.emit(TallTableEvent::HeaderIconPressed(HeaderIconPress {
            column: index,
            bounds,
            modifiers,
        }));
    }

    /// An icon's glyph in a box `width` by `height`, its top left at
    /// `left` and centered in a row: the badge, or the raised look
    /// (`raised`).
    fn icon_look(
        &self,
        icon: &HeaderIcon,
        left: f32,
        width: f32,
        raised: bool,
        look: Look,
        cx: &App,
    ) -> Div {
        let theme = cx.theme();
        let row = f32::from(self.sizes().row());
        let (height, corners, glyph) = if raised {
            (look.raised, look.raised_corners, look.raised_glyph)
        } else {
            (look.badge.1, look.corners, look.glyph)
        };
        let color = (icon.color)(theme);
        let mark = div()
            .absolute()
            .left(px(left))
            .top(px(((row - height) / 2.0).floor()))
            .w(px(width))
            .h(px(height))
            .rounded(px(corners))
            .flex()
            .items_center()
            .justify_center();
        let mark = if raised {
            mark.bg(theme.secondary)
                .border_1()
                .border_color(theme.input)
                .shadow(raised_shadow())
        } else {
            mark.when_some(icon.fill, |mark, fill| mark.bg(fill(theme)))
        };
        mark.child(
            svg()
                .path(icon.path.clone())
                .size(px(glyph))
                .flex_shrink_0()
                .text_color(color),
        )
    }

    /// The icons over the header's cells, each a target of its own: under
    /// `resize`'s bands, over the names. One cut at its region's left edge
    /// is drawn cut and pressed on what shows.
    pub(super) fn render_icons(&mut self, cx: &mut Context<Self>) -> Option<Div> {
        let place = self.place();
        // Each drawn icon's column's index, its place, its column's left in
        // its region, and its boxes.
        let visible: Vec<(usize, usize, f32, Boxes)> = self
            .visible_columns()
            .filter_map(|(at, column)| {
                let boxes = self.icon_boxes(at, column)?;
                let left = place.layer_left(at, column.x, self.scroll_x);
                Some((column.index(at), at, left, boxes))
            })
            .collect();
        #[cfg(test)]
        self.icon_state.drawn.clear();
        // An icon no longer drawn (scrolled away) never hears the pointer
        // leave or come up: its hover and press are forgotten.
        self.forget_icons(|held| !visible.iter().any(|(drawn, ..)| *drawn == held));
        if visible.is_empty() {
            return None;
        }
        let sizes = self.sizes();
        let look = Look::new(sizes);
        #[cfg(any(test, not(feature = "pin")))]
        let gutter = self.gutter_width();
        // None raised by the pointer during a drag of the table's (a
        // carried column, a resize, a selection, a scrollbar); the hover is
        // still tracked, so it shows again at the release. The pressed one
        // stays raised: no drag starts under its press.
        let hovered = self.icon_state.hovered.filter(|_| !self.icon_hover_held());
        let pressed = self.icon_state.pressed;
        #[cfg(test)]
        let control = self.icon_state.control;
        let mut icons = Vec::with_capacity(visible.len());
        for (index, at, left, boxes) in visible {
            let Some(icon) = self.column_info[index].icon.clone() else {
                continue;
            };
            let raised = hovered == Some(index) || pressed == Some(index);
            #[cfg(feature = "reorder")]
            let dimmed = self.lifted(at);
            #[cfg(all(test, not(feature = "reorder")))]
            let dimmed = false;
            let (target_left, target_width) = boxes.target;
            // In the target's coordinates.
            let (look_left, look_width) = if raised {
                (0.0, target_width)
            } else {
                (boxes.badge.0 - target_left, boxes.badge.1)
            };
            #[cfg(test)]
            {
                let theme = cx.theme();
                let row = f32::from(sizes.row());
                let origin = point(
                    self.body.origin.x
                        + px(gutter + left + if place.holds(at) { 0.0 } else { place.edge() }),
                    self.body.origin.y - sizes.row(),
                );
                let height = if raised { look.raised } else { look.badge.1 };
                self.icon_state.drawn.push(DrawnIcon {
                    column: index,
                    path: icon.path.clone(),
                    color: (icon.color)(theme),
                    fill: icon.fill.filter(|_| !raised).map(|fill| fill(theme)),
                    raised,
                    dimmed,
                    glyph: if raised {
                        look.raised_glyph
                    } else {
                        look.glyph
                    },
                    look: Bounds::new(
                        origin
                            + point(
                                px(target_left + look_left),
                                px(((row - height) / 2.0).floor()),
                            ),
                        size(px(look_width), px(height)),
                    ),
                    target: Bounds::new(
                        origin + point(px(target_left), px(0.)),
                        size(px(target_width), sizes.row()),
                    ),
                });
            }
            let mark = self.icon_look(&icon, look_left, look_width, raised, look, cx);
            #[cfg(feature = "reorder")]
            let mark = mark.when(dimmed, |mark| mark.opacity(LIFTED_OPACITY));
            icons.push((
                place.holds(at),
                div()
                    .id(("tall-table-icon", index))
                    .absolute()
                    .top_0()
                    .h_full()
                    .left(px(left + target_left))
                    .w(px(target_width))
                    .cursor_pointer()
                    .on_hover(cx.listener(move |this, hovered: &bool, _, cx| {
                        let hovered = hovered.then_some(index);
                        if this.icon_state.hovered != hovered
                            && (hovered.is_some() || this.icon_state.hovered == Some(index))
                        {
                            this.icon_state.hovered = hovered;
                            cx.notify();
                        }
                    }))
                    .on_mouse_down(
                        MouseButton::Left,
                        cx.listener(move |this, event: &MouseDownEvent, window, cx| {
                            // Its header's: a context press, and the tap a
                            // lifted long press becomes, which the root
                            // drops (`clicks`).
                            #[cfg(feature = "clicks")]
                            if this.left_press_is_headers(event) {
                                return;
                            }
                            #[cfg(not(feature = "clicks"))]
                            let _ = event;
                            #[cfg(test)]
                            let stopped = control != Control::Unstopped;
                            #[cfg(not(test))]
                            let stopped = true;
                            if stopped {
                                cx.stop_propagation();
                            }
                            this.hide_tooltip(cx);
                            window.focus(&this.focus_handle, cx);
                            this.icon_state.pressed = Some(index);
                            cx.notify();
                        }),
                    )
                    .on_mouse_up(
                        MouseButton::Left,
                        cx.listener(move |this, event: &MouseUpEvent, _, cx| {
                            if this.icon_state.pressed.take() == Some(index) {
                                this.icon_released(index, event.modifiers, cx);
                                cx.notify();
                            }
                        }),
                    )
                    .on_mouse_up_out(
                        MouseButton::Left,
                        cx.listener(move |this, _: &MouseUpEvent, _, cx| {
                            if this.icon_state.pressed == Some(index) {
                                this.icon_state.pressed = None;
                                cx.notify();
                            }
                        }),
                    )
                    .child(mark),
            ));
        }
        #[cfg(not(feature = "pin"))]
        let icons = div()
            .absolute()
            .top_0()
            .bottom_0()
            .left(px(gutter))
            .right(Scrollbar::width())
            .overflow_hidden()
            .children(icons.into_iter().map(|(_, icon)| icon));
        #[cfg(feature = "pin")]
        let icons = {
            let (pinned, scrolled): (Vec<_>, Vec<_>) =
                icons.into_iter().partition(|(holds, _)| *holds);
            self.split_layer(
                place,
                pinned.into_iter().map(|(_, icon)| icon),
                scrolled.into_iter().map(|(_, icon)| icon),
            )
        };
        Some(icons)
    }

    /// The carried preview's icons (`reorder`): each column of the block
    /// at `places`, its badge at rest, in the preview's coordinates (the
    /// block's first column's left at `first`), `top` down it.
    #[cfg(feature = "reorder")]
    pub(super) fn preview_icons(
        &self,
        places: std::ops::Range<usize>,
        first: f32,
        top: Pixels,
        cx: &App,
    ) -> Vec<Div> {
        let look = Look::new(self.sizes());
        places
            .filter_map(|at| {
                let column = self.columns.get(at)?;
                let boxes = self.icon_boxes(at, column)?;
                let icon = self.column_info[column.index(at)].icon.as_ref()?;
                Some(
                    div()
                        .absolute()
                        .top(top)
                        .h(self.sizes().row())
                        .left(px(column.x - first))
                        .w(px(column.width))
                        .child(self.icon_look(icon, boxes.badge.0, boxes.badge.1, false, look, cx)),
                )
            })
            .collect()
    }
}
