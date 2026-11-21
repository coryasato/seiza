//! `header-icon`: a column's icon, set by its host, and its press
//! ([`TallTableEvent::HeaderIconPressed`](crate::TallTableEvent)). Its
//! public types, and where its badge, its raised look, and its target sit
//! in a header; the state's half is `state/header_icon.rs`
//! (`docs/DECISIONS.md`, "Features").

use gpui_kit::{Bounds, Modifiers, Pixels, SharedString};

use crate::column::Sizes;

#[cfg(feature = "custom-cells")]
pub(crate) use crate::paint::Stop;

/// A theme color: resolved each frame, so a theme change follows.
#[cfg(not(feature = "custom-cells"))]
pub type Stop = fn(&gpui_kit::component::Theme) -> gpui_kit::Hsla;

/// A column's icon (`header-icon`): an SVG from the host's asset source,
/// its color, and its badge's fill at rest, if any. Drawn at the start of
/// the column's header, raised under the pointer; its press is the host's
/// (`TallTableEvent::HeaderIconPressed`). Built by [`HeaderIcon::new`], so
/// a field added later breaks no host.
#[derive(Debug, Clone)]
#[non_exhaustive]
pub struct HeaderIcon {
    /// The SVG's path in the host's asset source.
    pub path: SharedString,
    /// The glyph's color.
    pub color: Stop,
    /// The badge's tint at rest; none by default.
    pub fill: Option<Stop>,
    /// Its path loaded when it was set: one that doesn't draws no icon
    /// and takes no room.
    pub(crate) loaded: bool,
}

impl HeaderIcon {
    /// The SVG at `path` (in the host's asset source) drawn in `color`,
    /// its badge with no fill. A path that doesn't load draws no icon.
    pub fn new(path: impl Into<SharedString>, color: Stop) -> Self {
        Self {
            path: path.into(),
            color,
            fill: None,
            loaded: false,
        }
    }

    /// The badge's tint at rest (under the pointer the raised look
    /// replaces it).
    pub fn fill(self, fill: Stop) -> Self {
        Self {
            fill: Some(fill),
            ..self
        }
    }
}

/// As set: the path and the colors, whether or not the path loaded.
impl PartialEq for HeaderIcon {
    fn eq(&self, other: &Self) -> bool {
        self.path == other.path
            && std::ptr::fn_addr_eq(self.color, other.color)
            && match (self.fill, other.fill) {
                (Some(fill), Some(other)) => std::ptr::fn_addr_eq(fill, other),
                (None, None) => true,
                _ => false,
            }
    }
}

/// A column's icon was pressed (`header-icon`): what
/// `TallTableEvent::HeaderIconPressed` carries.
#[derive(Debug, Clone, PartialEq)]
#[non_exhaustive]
pub struct HeaderIconPress {
    /// The column's index in `set_columns`' list (with `reorder`, not its
    /// place).
    pub column: usize,
    /// The icon's badge in window pixels, its visible part when a region's
    /// edge cuts it: what a host hangs its menu under.
    pub bounds: Bounds<Pixels>,
    /// The keys held at the release.
    pub modifiers: Modifiers,
}

/// The badge at rest, for 14 px text: its width and height, its corners,
/// and its glyph.
const BADGE: (f32, f32) = (18.0, 16.0);
const BADGE_CORNERS: f32 = 4.0;
const GLYPH: f32 = 10.0;

/// The gap between the badge and the header's name.
const GAP: f32 = 6.0;

/// The raised look's reach past the badge on every side (26 × 24 over
/// 18 × 16), its corners, and its glyph.
const REACH: f32 = 4.0;
const RAISED_CORNERS: f32 = 6.0;
const RAISED_GLYPH: f32 = 12.0;

/// The least the row keeps clear above and below the badge and the raised
/// look: a row shorter than their scaled heights shrinks them.
const ROW_INSET: f32 = 1.0;

/// `resize`'s band's reach left of a column's right edge: the target ends
/// there, with the feature or without (as `sort`'s arrow's does).
const BAND_REACH: f32 = 5.0;

/// What a header's name gives up for its icon: the badge and the gap.
pub(crate) fn room(sizes: Sizes) -> f32 {
    sizes.scaled(BADGE.0) + sizes.scaled(GAP)
}

/// An icon's lengths at the sizes in effect.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct Look {
    /// The badge's width and height, its corners, and its glyph's side.
    pub(crate) badge: (f32, f32),
    pub(crate) corners: f32,
    pub(crate) glyph: f32,
    /// The raised look's height, corners, and glyph (its width is its
    /// target's).
    pub(crate) raised: f32,
    pub(crate) raised_corners: f32,
    pub(crate) raised_glyph: f32,
}

impl Look {
    /// Scaled with the text, both heights held inside the row.
    pub(crate) fn new(sizes: Sizes) -> Self {
        let most = (f32::from(sizes.row()) - 2.0 * ROW_INSET).max(0.0);
        let height = sizes.scaled(BADGE.1).min(most);
        let raised = (sizes.scaled(BADGE.1) + 2.0 * sizes.scaled(REACH)).min(most);
        Self {
            badge: (sizes.scaled(BADGE.0), height),
            corners: sizes.scaled(BADGE_CORNERS).min(height / 2.0),
            glyph: sizes.scaled(GLYPH).min(height),
            raised,
            raised_corners: sizes.scaled(RAISED_CORNERS).min(raised / 2.0),
            raised_glyph: sizes.scaled(RAISED_GLYPH).min(raised),
        }
    }
}

/// Where an icon sits in a column `width` wide, from the column's left
/// edge.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct Boxes {
    /// The badge's left and width.
    pub(crate) badge: (f32, f32),
    /// The target's left and width: the raised look's box, inside the
    /// column and short of `resize`'s band. The hover and the press are
    /// found there.
    pub(crate) target: (f32, f32),
}

/// The boxes of an icon in a column `width` wide; `None` for a column
/// narrower than its padding and the badge (a host's `min_width` or
/// `max_width`: the table's least width holds it at every density), which
/// draws none.
pub(crate) fn boxes(width: f32, sizes: Sizes) -> Option<Boxes> {
    let badge = sizes.scaled(BADGE.0);
    if width < sizes.padding() + badge {
        return None;
    }
    let left = sizes.padding() / 2.0;
    let reach = sizes.scaled(REACH);
    let from = (left - reach).max(0.0);
    let to = (left + badge + reach).min(width - BAND_REACH).max(from);
    Some(Boxes {
        badge: (left, badge),
        target: (from, to - from),
    })
}

#[cfg(test)]
mod tests {
    use super::{Boxes, Look, boxes, room};
    use crate::column::Sizes;

    /// The lengths Tycho's canvas draws, at the base's 30 px rows and
    /// 14 px text.
    #[test]
    fn the_base_lengths() {
        let sizes = Sizes::base();
        assert_eq!(room(sizes), 24.0);
        assert_eq!(
            Look::new(sizes),
            Look {
                badge: (18.0, 16.0),
                corners: 4.0,
                glyph: 10.0,
                raised: 24.0,
                raised_corners: 6.0,
                raised_glyph: 12.0,
            }
        );
        assert_eq!(
            boxes(200.0, sizes),
            Some(Boxes {
                badge: (8.0, 18.0),
                target: (4.0, 26.0),
            })
        );
    }

    /// The table's least width holds the badge, its target ending at the
    /// band; under the padding and the badge, no icon.
    #[test]
    fn a_narrow_column() {
        let sizes = Sizes::base();
        assert_eq!(
            boxes(40.0, sizes),
            Some(Boxes {
                badge: (8.0, 18.0),
                target: (4.0, 26.0),
            })
        );
        assert_eq!(
            boxes(34.0, sizes).map(|boxes| boxes.target),
            Some((4.0, 25.0)),
            "short of the band"
        );
        assert_eq!(boxes(33.9, sizes), None);
    }
}
