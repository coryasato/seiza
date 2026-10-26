//! A table's columns: what the host says about each, and how the table lays
//! them out.

use gpui_kit::SharedString;
#[cfg(feature = "resize")]
use gpui_kit::{Pixels, px};

#[cfg(feature = "custom-cells")]
use crate::paint::{Bar, Ramp};

/// A column: its name (the header) and the kind of value it holds, which
/// sets its width and how its values are aligned, rounded, and cut.
#[derive(Debug, Clone, PartialEq)]
pub struct TallTableColumn {
    name: SharedString,
    kind: ColumnKind,
    /// What turns a page's paint into pixels (`custom-cells`).
    #[cfg(feature = "custom-cells")]
    pub(crate) fill: Option<Ramp>,
    #[cfg(feature = "custom-cells")]
    pub(crate) bar: Option<Bar>,
    #[cfg(feature = "custom-cells")]
    pub(crate) text_ramp: Option<Ramp>,
    /// A changed cell's flash and how long it fades (`live` with
    /// `custom-cells`).
    #[cfg(all(feature = "live", feature = "custom-cells"))]
    pub(crate) flash: Option<(Ramp, std::time::Duration)>,
    /// Its set width (`resize`): the host's, a drag's, or a fit's; `None`
    /// for its kind's.
    #[cfg(feature = "resize")]
    pub(crate) width: Option<f32>,
    #[cfg(feature = "resize")]
    pub(crate) min_width: f32,
    #[cfg(feature = "resize")]
    pub(crate) max_width: f32,
    #[cfg(feature = "resize")]
    pub(crate) resizable: bool,
}

/// A set width's least and most, unless a column sets its own (`resize`):
/// at 40 a float still shows two characters (`docs/DECISIONS.md`,
/// "Features").
#[cfg(feature = "resize")]
pub(crate) const MIN_WIDTH: f32 = 40.0;
#[cfg(feature = "resize")]
pub(crate) const MAX_WIDTH: f32 = 1200.0;

impl TallTableColumn {
    pub fn new(name: impl Into<SharedString>, kind: ColumnKind) -> Self {
        Self {
            name: name.into(),
            kind,
            #[cfg(feature = "custom-cells")]
            fill: None,
            #[cfg(feature = "custom-cells")]
            bar: None,
            #[cfg(feature = "custom-cells")]
            text_ramp: None,
            #[cfg(all(feature = "live", feature = "custom-cells"))]
            flash: None,
            #[cfg(feature = "resize")]
            width: None,
            #[cfg(feature = "resize")]
            min_width: MIN_WIDTH,
            #[cfg(feature = "resize")]
            max_width: MAX_WIDTH,
            #[cfg(feature = "resize")]
            resizable: true,
        }
    }

    /// Its width, in place of its kind's (`resize`: a width the host kept
    /// from [`TallTableEvent::ColumnWidthsChanged`](crate::TallTableEvent)),
    /// clamped to its [`min_width`](Self::min_width) and
    /// [`max_width`](Self::max_width). The header's width is no longer a
    /// minimum: a name wider than it is cut.
    #[cfg(feature = "resize")]
    pub fn width(self, width: Pixels) -> Self {
        Self {
            width: Some(f32::from(width)),
            ..self
        }
    }

    /// The narrowest a set width, a drag, or a fit leaves it (`resize`):
    /// 40 px unless set.
    #[cfg(feature = "resize")]
    pub fn min_width(self, width: Pixels) -> Self {
        Self {
            min_width: f32::from(width),
            ..self
        }
    }

    /// The widest a set width, a drag, or a fit leaves it (`resize`):
    /// 1200 px unless set.
    #[cfg(feature = "resize")]
    pub fn max_width(self, width: Pixels) -> Self {
        Self {
            max_width: f32::from(width),
            ..self
        }
    }

    /// Whether its header edge has a band to drag (`resize`): on unless set.
    #[cfg(feature = "resize")]
    pub fn resizable(self, resizable: bool) -> Self {
        Self { resizable, ..self }
    }

    /// `width` within its min and max (a max under the min gives the max).
    #[cfg(feature = "resize")]
    pub(crate) fn clamp_width(&self, width: f32) -> f32 {
        width.max(self.min_width).min(self.max_width)
    }

    /// Its set width as drawn: clamped, `None` for its kind's.
    #[cfg(feature = "resize")]
    pub(crate) fn set_width(&self) -> Option<Pixels> {
        self.width.map(|width| px(self.clamp_width(width)))
    }

    /// A page's [`CellPaint::fill`](crate::CellPaint::fill) goes through
    /// `ramp`: the whole cell.
    #[cfg(feature = "custom-cells")]
    pub fn fill(self, ramp: Ramp) -> Self {
        Self {
            fill: Some(ramp),
            ..self
        }
    }

    /// A page's [`CellPaint::bar`](crate::CellPaint::bar) draws as `bar`.
    #[cfg(feature = "custom-cells")]
    pub fn bar(self, bar: Bar) -> Self {
        Self {
            bar: Some(bar),
            ..self
        }
    }

    /// A page's [`CellPaint::text`](crate::CellPaint::text) goes through
    /// `ramp`: the value's color.
    #[cfg(feature = "custom-cells")]
    pub fn text_ramp(self, ramp: Ramp) -> Self {
        Self {
            text_ramp: Some(ramp),
            ..self
        }
    }

    /// When a re-read changes a cell's value (`live`): a float's rise at
    /// the ramp's 1, its fall at 0, any other change at 0.5, drawn over the
    /// cell's fill and faded by opacity to nothing over `duration`. Under
    /// `App::reduce_motion`, held at its color for `duration`, no fade.
    #[cfg(all(feature = "live", feature = "custom-cells"))]
    pub fn flash(self, ramp: Ramp, duration: std::time::Duration) -> Self {
        Self {
            flash: Some((ramp, duration)),
            ..self
        }
    }

    pub fn name(&self) -> &SharedString {
        &self.name
    }

    pub fn kind(&self) -> ColumnKind {
        self.kind
    }
}

/// What a column holds.
#[derive(Debug, Clone, Copy, PartialEq)]
#[non_exhaustive]
pub enum ColumnKind {
    /// `true`/`false`, left-aligned.
    Boolean,
    /// A date, left-aligned.
    Date,
    /// A date and time, left-aligned.
    Timestamp,
    /// An integer whose widest value is `max_chars` characters (sign
    /// included): right-aligned and never rounded (an ID isn't a quantity).
    /// The column fits that value at the font's widest digit; anything wider
    /// (a 128-bit integer past 20) is cut in the middle, keeping both ends:
    /// its magnitude and its last digits.
    Integer { max_chars: u8 },
    /// A float, right-aligned and rounded to the digits that fit.
    Float,
    /// A decimal, right-aligned, exact, and cut in the middle like an
    /// integer: an end cut would lose its magnitude.
    Decimal,
    /// Anything else, left-aligned and cut at the end.
    Text,
}

/// How a column's values are aligned, and what happens to one too wide for
/// it. Cells are cut by GPUI (`text_overflow`), never by clipping: a
/// right-aligned value clipped by its cell loses its front.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) enum CellKind {
    /// Left-aligned, cut at the end.
    Text,
    /// Right-aligned, cut in the middle.
    Integer,
    /// Right-aligned, rounded to the digits that fit ([`crate::format::fit_float`]).
    Float,
    /// Right-aligned, cut in the middle.
    Decimal,
}

impl CellKind {
    pub(crate) fn numeric(self) -> bool {
        self != Self::Text
    }

    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Text => "text",
            Self::Integer => "integer",
            Self::Float => "float",
            Self::Decimal => "decimal",
        }
    }
}

/// A column as drawn: its left edge in the scrolled content, and its width.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct LaidOutColumn {
    pub(crate) name: SharedString,
    pub(crate) x: f32,
    pub(crate) width: f32,
    pub(crate) kind: CellKind,
    /// How many characters a float may take ([`crate::format::fit_float`]).
    pub(crate) budget: usize,
}

/// A cell's horizontal padding (`px_2` on each side).
pub(crate) const CELL_PADDING: f32 = 16.0;

/// The width that holds `chars` characters at `number_px` each: a float's
/// budget at it is `chars`.
pub(crate) fn digits_width(chars: f32, number_px: f32) -> f32 {
    chars * number_px + CELL_PADDING + 1.0
}

/// Width and cell kind. An integer column fits its widest value at
/// `number_px` a character. The name's width is estimated at the UI font's
/// average advance; a longer name is cut. With `resize`, a set width
/// replaces all that, clamped.
fn column_layout(column: &TallTableColumn, number_px: f32) -> (f32, CellKind) {
    let digits = |chars: f32| digits_width(chars, number_px);
    let (width, kind) = match column.kind {
        ColumnKind::Boolean => (72.0, CellKind::Text),
        ColumnKind::Date => (104.0, CellKind::Text),
        ColumnKind::Integer { max_chars } => (digits(f32::from(max_chars)), CellKind::Integer),
        ColumnKind::Float => (120.0, CellKind::Float),
        ColumnKind::Decimal => (120.0, CellKind::Decimal),
        ColumnKind::Timestamp => (184.0, CellKind::Text),
        ColumnKind::Text => (200.0, CellKind::Text),
    };
    #[cfg(feature = "resize")]
    if let Some(set) = column.set_width() {
        return (f32::from(set), kind);
    }
    let name = column.name.chars().count() as f32 * 7.5 + 24.0;
    (width.max(name), kind)
}

/// Lays `columns` out side by side; also returns their total width.
pub(crate) fn layout_columns(
    columns: &[TallTableColumn],
    number_px: f32,
) -> (Vec<LaidOutColumn>, f32) {
    let mut x = 0.0;
    let columns = columns
        .iter()
        .map(|column| {
            let (width, kind) = column_layout(column, number_px);
            // A pixel short of the room, for rounding in the shaped width.
            let budget = ((width - CELL_PADDING - 1.0) / number_px).floor().max(1.0) as usize;
            let laid_out = LaidOutColumn {
                name: column.name.clone(),
                x,
                width,
                kind,
                budget,
            };
            x += width;
            laid_out
        })
        .collect();
    (columns, x)
}

#[cfg(test)]
mod tests {
    use super::{ColumnKind, TallTableColumn, layout_columns};

    /// A kind's width is at least its name's estimated width, as without
    /// `resize`: a long name widens a float column past its 120 px.
    #[test]
    fn a_name_widens_its_kind() {
        let width = |name: &str| {
            let column = TallTableColumn::new(name, ColumnKind::Float);
            layout_columns(&[column], 8.4).0[0].width
        };
        assert_eq!(width("f"), 120.0);
        assert_eq!(width("a long column name"), 159.0);
    }
}
