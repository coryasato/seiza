//! `density`: a row height and a text size a host sets together, and the
//! lengths that follow them (`docs/DECISIONS.md`, "Features"). Every site
//! reads them through [`Sizes`], the lengths in effect, which without the
//! feature is a stand-in returning the base's constants
//! ([`crate::column::Sizes`]).

use gpui_kit::{AbsoluteLength, Pixels, px, rems};

use crate::state::{TEXT_REMS, row_height};

/// A table's row height and text size (`TallTableState::set_density`).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Density {
    /// The body's rows and the header: 30 px by default.
    pub row_height: Pixels,
    /// The cells' and the header's text: `rems(0.875)` by default.
    pub text_size: AbsoluteLength,
}

/// 30 px rows and `rems(0.875)` text: the base's.
impl Default for Density {
    fn default() -> Self {
        Self {
            row_height: row_height(),
            text_size: rems(TEXT_REMS).into(),
        }
    }
}

/// The base's text in px, at the web's 16 px rem: a `px` text's scale is
/// over it.
const BASE_TEXT_PX: f32 = 14.0;

/// The least text size in effect.
const LEAST_TEXT_PX: f32 = 6.0;

/// The lengths in effect: the row height and the text size after the
/// clamp, and the scale the base's horizontal lengths follow
/// (`docs/DECISIONS.md`, "Features").
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct Sizes {
    row: Pixels,
    text: Pixels,
    /// The text size over the default's, in its own unit.
    scale: f32,
    /// The density fixture's negative controls.
    #[cfg(test)]
    pub(crate) control: Control,
}

/// The density fixture's negative controls (`fixtures/density.json`): ways
/// to get the lengths wrong that it must catch.
#[cfg(test)]
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) enum Control {
    None,
    /// The row height as set, under the text.
    RowUnclamped,
    /// The cells' padding at the base's 8 px a side.
    PaddingFixed,
    /// A set width scaled by the text too.
    WidthScaled,
    /// The bar's inset at the base's 6 px.
    InsetFixed,
    /// The scale over the default resolved at the rem, for a `px` text.
    ScaleOverDefaultAtRem,
    /// The scale over 14 px, for a `rems` text.
    ScaleOver14ForRems,
    /// The name estimate rounded a character at a time.
    NameRoundedPerCharacter,
    /// A set width's least at the base's 40 px.
    LeastFixed,
}

impl Sizes {
    /// `density` in effect at `rem_size`: the text at least 6 px, the row at
    /// least the text.
    pub(crate) fn resolve(density: Density, rem_size: Pixels) -> Self {
        Self::resolve_with(
            density,
            rem_size,
            #[cfg(test)]
            Control::None,
        )
    }

    #[inline(never)]
    pub(crate) fn resolve_with(
        density: Density,
        rem_size: Pixels,
        #[cfg(test)] control: Control,
    ) -> Self {
        let rem = f32::from(rem_size).max(1.0);
        let text = f32::from(density.text_size.to_pixels(px(rem))).max(LEAST_TEXT_PX);
        let row = f32::from(density.row_height).max(text);
        #[cfg(test)]
        let row = if control == Control::RowUnclamped {
            f32::from(density.row_height)
        } else {
            row
        };
        let scale = match density.text_size {
            AbsoluteLength::Pixels(_) => text / BASE_TEXT_PX,
            AbsoluteLength::Rems(_) => text / (TEXT_REMS * rem),
        };
        #[cfg(test)]
        let scale = match (control, density.text_size) {
            (Control::ScaleOverDefaultAtRem, AbsoluteLength::Pixels(_)) => text / (TEXT_REMS * rem),
            (Control::ScaleOver14ForRems, AbsoluteLength::Rems(_)) => text / BASE_TEXT_PX,
            _ => scale,
        };
        Self {
            row: px(row),
            text: px(text),
            scale,
            #[cfg(test)]
            control,
        }
    }

    /// The base's: `Density::default()` at the web's 16 px rem.
    pub(crate) fn base() -> Self {
        Self::default()
    }

    /// The rows' and the header's height.
    #[inline(always)]
    pub(crate) fn row(self) -> Pixels {
        self.row
    }

    /// The cells' text size, resolved at the rem size it was resolved at.
    #[inline(always)]
    pub(crate) fn text(self, _: Pixels) -> Pixels {
        self.text
    }

    /// A horizontal length the base fixes for 14 px text, scaled and
    /// rounded to a whole px; at a scale of 1, the base's own, unrounded
    /// (its name and gutter estimates have half pixels).
    #[inline(always)]
    pub(crate) fn scaled(self, length: f32) -> f32 {
        if self.scale == 1.0 {
            length
        } else {
            (length * self.scale).round()
        }
    }

    /// The cells' padding on each side: 8 px scaled.
    #[inline(always)]
    pub(crate) fn pad(self) -> f32 {
        #[cfg(test)]
        if self.control == Control::PaddingFixed {
            return 8.0;
        }
        self.scaled(8.0)
    }

    /// The cells' padding, both sides.
    #[inline(always)]
    pub(crate) fn padding(self) -> f32 {
        2.0 * self.pad()
    }

    /// A header name's or the gutter's estimated width: 7.5 px a character
    /// and 24, scaled, rounded once on the total.
    #[inline(always)]
    pub(crate) fn estimate(self, chars: f32) -> f32 {
        #[cfg(test)]
        if self.control == Control::NameRoundedPerCharacter {
            return chars * self.scaled(7.5) + self.scaled(24.0);
        }
        self.scaled(chars * 7.5 + 24.0)
    }

    /// A set width's least, unless a column sets its own: 40 px scaled, so
    /// a float still shows two characters.
    #[inline(always)]
    pub(crate) fn least(self) -> f32 {
        #[cfg(test)]
        if self.control == Control::LeastFixed {
            return crate::column::MIN_WIDTH;
        }
        self.scaled(crate::column::MIN_WIDTH)
    }

    /// A set width as laid out: the host's number, not scaled.
    #[inline(always)]
    pub(crate) fn set(self, width: f32) -> f32 {
        #[cfg(test)]
        if self.control == Control::WidthScaled {
            return self.scaled(width);
        }
        width
    }

    /// A loading cell's bar's height: 8 px, inside the row's insets (at
    /// least 1 px), so a short row holds it.
    #[inline(always)]
    pub(crate) fn skeleton(self) -> f32 {
        (f32::from(self.row) - 2.0 * self.inset()).clamp(1.0, 8.0)
    }

    /// How far a bar sits from its row's top and bottom: a fifth of the
    /// row, rounded (6 px at 30).
    #[inline(always)]
    pub(crate) fn inset(self) -> f32 {
        #[cfg(test)]
        if self.control == Control::InsetFixed {
            return 6.0;
        }
        (f32::from(self.row) / 5.0).round()
    }
}

/// The base's: `Density::default()` at the web's 16 px rem.
impl Default for Sizes {
    fn default() -> Self {
        Self::resolve(Density::default(), px(16.))
    }
}
