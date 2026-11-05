//! A table's columns: what the host says about each, and how the table lays
//! them out.

#[cfg(any(feature = "resize", feature = "density"))]
use gpui_kit::Pixels;
use gpui_kit::SharedString;
#[cfg(any(feature = "resize", feature = "density"))]
use gpui_kit::px;
#[cfg(not(feature = "density"))]
use gpui_kit::{Pixels as Px, rems};

#[cfg(feature = "density")]
pub(crate) use crate::density::Sizes;

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
    /// Its set width (`resize`: the host's, a drag's, or a fit's; with
    /// `density`, the host's); `None` for its kind's.
    #[cfg(any(feature = "resize", feature = "density"))]
    pub(crate) width: Option<f32>,
    /// `None` for the table's least (`Sizes::least`).
    #[cfg(feature = "resize")]
    pub(crate) min_width: Option<f32>,
    #[cfg(feature = "resize")]
    pub(crate) max_width: f32,
    #[cfg(feature = "resize")]
    pub(crate) resizable: bool,
    /// Whether its header has an arrow to sort by it (`sort`).
    #[cfg(feature = "sort")]
    pub(crate) sortable: bool,
    /// How its numbers are written (`format`); `None` for the automatic.
    #[cfg(feature = "format")]
    pub(crate) format: Option<crate::NumberFormat>,
}

/// A set width's least and most, unless a column sets its own (`resize`):
/// at 40 a float still shows two characters (`docs/DECISIONS.md`,
/// "Features"). With `density`, the least is scaled with the text
/// (`Sizes::least`).
#[cfg(any(feature = "resize", feature = "density"))]
pub(crate) const MIN_WIDTH: f32 = 40.0;
#[cfg(any(feature = "resize", feature = "density"))]
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
            #[cfg(any(feature = "resize", feature = "density"))]
            width: None,
            #[cfg(feature = "resize")]
            min_width: None,
            #[cfg(feature = "resize")]
            max_width: MAX_WIDTH,
            #[cfg(feature = "resize")]
            resizable: true,
            #[cfg(feature = "sort")]
            sortable: false,
            #[cfg(feature = "format")]
            format: None,
        }
    }

    /// How its numbers are written (`format`): a float's value, and an
    /// integer's or decimal's text (its sign, grouping, and suffix). A
    /// text too wide for its cell shows the automatic format; a column of
    /// any other kind ignores it.
    #[cfg(feature = "format")]
    pub fn format(self, format: crate::NumberFormat) -> Self {
        Self {
            format: Some(format),
            ..self
        }
    }

    /// Whether its header has an arrow to sort by it (`sort`): off unless
    /// set, since the source must be able to sort it.
    #[cfg(feature = "sort")]
    pub fn sortable(self, sortable: bool) -> Self {
        Self { sortable, ..self }
    }

    /// Its width, in place of its kind's (`resize`: a width the host kept
    /// from [`TallTableEvent::ColumnWidthsChanged`](crate::TallTableEvent)),
    /// clamped to its [`min_width`](Self::min_width) and
    /// [`max_width`](Self::max_width). The header's width is no longer a
    /// minimum: a name wider than it is cut. With `density` and without
    /// `resize`, clamped to 40 px (scaled with the text) and 1200 px, and
    /// never scaled itself.
    #[cfg(any(feature = "resize", feature = "density"))]
    pub fn width(self, width: Pixels) -> Self {
        Self {
            width: Some(f32::from(width)),
            ..self
        }
    }

    /// The narrowest a set width, a drag, or a fit leaves it (`resize`):
    /// 40 px unless set (with `density`, scaled with the text; a width set
    /// here isn't).
    #[cfg(feature = "resize")]
    pub fn min_width(self, width: Pixels) -> Self {
        Self {
            min_width: Some(f32::from(width)),
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

    /// `width` within its min and max (a max under the min gives the max):
    /// unless set (`resize`), `sizes`' least and 1200 px.
    #[cfg(any(feature = "resize", feature = "density"))]
    pub(crate) fn clamp_width(&self, width: f32, sizes: Sizes) -> f32 {
        #[cfg(feature = "resize")]
        let (least, most) = (
            self.min_width.unwrap_or_else(|| sizes.least()),
            self.max_width,
        );
        #[cfg(not(feature = "resize"))]
        let (least, most) = (sizes.least(), MAX_WIDTH);
        width.max(least).min(most)
    }

    /// Its set width as drawn: clamped, `None` for its kind's.
    #[cfg(any(feature = "resize", feature = "density"))]
    pub(crate) fn set_width(&self, sizes: Sizes) -> Option<Pixels> {
        self.width.map(|width| px(self.clamp_width(width, sizes)))
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

    /// How its numbers are written (`format`), as set: `None` for the
    /// automatic format.
    #[cfg(feature = "format")]
    pub fn number_format(&self) -> Option<&crate::NumberFormat> {
        self.format.as_ref()
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
    /// Its format, its suffix measured (`format`; a numeric column's only).
    #[cfg(feature = "format")]
    pub(crate) format: Option<crate::format::ColumnFormat>,
}

/// A cell's horizontal padding (`px_2` on each side).
#[cfg(not(feature = "density"))]
pub(crate) const CELL_PADDING: f32 = 16.0;

/// The base's lengths, for its 30 px rows and 14 px text: a stand-in for
/// `density`'s lengths in effect ([`crate::density::Sizes`]), with its
/// methods, so each site is written once.
#[cfg(not(feature = "density"))]
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub(crate) struct Sizes;

#[cfg(not(feature = "density"))]
impl Sizes {
    /// The base's.
    #[inline(always)]
    pub(crate) fn base() -> Self {
        Self
    }

    /// The rows' and the header's height.
    #[inline(always)]
    pub(crate) fn row(self) -> Px {
        crate::state::row_height()
    }

    /// The cells' text size at `rem_size`.
    #[inline(always)]
    pub(crate) fn text(self, rem_size: Px) -> Px {
        rems(crate::state::TEXT_REMS).to_pixels(rem_size)
    }

    /// A horizontal length the base fixes for 14 px text: itself.
    #[inline(always)]
    pub(crate) fn scaled(self, length: f32) -> f32 {
        length
    }

    /// The cells' padding, both sides.
    #[inline(always)]
    pub(crate) fn padding(self) -> f32 {
        CELL_PADDING
    }

    /// A header name's or the gutter's estimated width.
    #[inline(always)]
    pub(crate) fn estimate(self, chars: f32) -> f32 {
        chars * 7.5 + 24.0
    }

    /// A set width's least, unless a column sets its own (`resize`).
    #[cfg(feature = "resize")]
    #[inline(always)]
    pub(crate) fn least(self) -> f32 {
        MIN_WIDTH
    }

    /// A loading cell's bar's height.
    #[inline(always)]
    pub(crate) fn skeleton(self) -> f32 {
        8.0
    }

    /// A set width as laid out: itself (`resize`).
    #[cfg(feature = "resize")]
    #[inline(always)]
    pub(crate) fn set(self, width: f32) -> f32 {
        width
    }

    /// How far a bar sits from its row's top and bottom (`custom-cells`).
    #[cfg(feature = "custom-cells")]
    #[inline(always)]
    pub(crate) fn inset(self) -> f32 {
        crate::paint::BAR_INSET
    }
}

/// The width that holds `chars` characters at `number_px` each, with
/// `padding` (both sides): a float's budget at it is `chars`.
pub(crate) fn digits_width(chars: f32, number_px: f32, padding: f32) -> f32 {
    chars * number_px + padding + 1.0
}

/// Width and cell kind. An integer column fits its widest value at
/// `number_px` a character. The name's width is estimated at the UI font's
/// average advance; a longer name is cut. With `sort`, a sortable column's
/// name has `sort_room` more beside it, for its arrow. With `resize` (or
/// `density`), a set width replaces all that, clamped. With `density`, the
/// kinds' widths, the padding, and the name's estimate follow `sizes`.
fn column_layout(
    column: &TallTableColumn,
    number_px: f32,
    #[cfg(feature = "sort")] sort_room: f32,
    sizes: Sizes,
) -> (f32, CellKind) {
    let digits = |chars: f32| digits_width(chars, number_px, sizes.padding());
    let (width, kind) = match column.kind {
        ColumnKind::Boolean => (sizes.scaled(72.0), CellKind::Text),
        ColumnKind::Date => (sizes.scaled(104.0), CellKind::Text),
        ColumnKind::Integer { max_chars } => (digits(f32::from(max_chars)), CellKind::Integer),
        ColumnKind::Float => (sizes.scaled(120.0), CellKind::Float),
        ColumnKind::Decimal => (sizes.scaled(120.0), CellKind::Decimal),
        ColumnKind::Timestamp => (sizes.scaled(184.0), CellKind::Text),
        ColumnKind::Text => (sizes.scaled(200.0), CellKind::Text),
    };
    #[cfg(any(feature = "resize", feature = "density"))]
    if let Some(set) = column.set_width(sizes) {
        return (sizes.set(f32::from(set)), kind);
    }
    let name = sizes.estimate(column.name.chars().count() as f32);
    #[cfg(feature = "sort")]
    let name = if column.sortable {
        name + sort_room
    } else {
        name
    };
    (width.max(name), kind)
}

/// Lays `columns` out side by side; also returns their total width. With
/// `sort`, `sort_room` is a sortable header's arrow and its gap.
pub(crate) fn layout_columns(
    columns: &[TallTableColumn],
    number_px: f32,
    #[cfg(feature = "sort")] sort_room: f32,
    sizes: Sizes,
) -> (Vec<LaidOutColumn>, f32) {
    let mut x = 0.0;
    let columns = columns
        .iter()
        .map(|column| {
            let (width, kind) = column_layout(
                column,
                number_px,
                #[cfg(feature = "sort")]
                sort_room,
                sizes,
            );
            // A pixel short of the room, for rounding in the shaped width.
            let budget = ((width - sizes.padding() - 1.0) / number_px)
                .floor()
                .max(1.0) as usize;
            let laid_out = LaidOutColumn {
                name: column.name.clone(),
                x,
                width,
                kind,
                budget,
                #[cfg(feature = "format")]
                format: None,
            };
            x += width;
            laid_out
        })
        .collect();
    (columns, x)
}

#[cfg(test)]
mod tests {
    use super::{ColumnKind, Sizes, TallTableColumn, layout_columns};

    /// A kind's width is at least its name's estimated width, as without
    /// `resize`: a long name widens a float column past its 120 px.
    #[test]
    fn a_name_widens_its_kind() {
        let width = |name: &str| {
            let column = TallTableColumn::new(name, ColumnKind::Float);
            layout_columns(
                &[column],
                8.4,
                #[cfg(feature = "sort")]
                30.0,
                Sizes::base(),
            )
            .0[0]
                .width
        };
        assert_eq!(width("f"), 120.0);
        assert_eq!(width("a long column name"), 159.0);
    }

    /// A sortable column's name estimate counts its arrow's room; one that
    /// isn't sortable is laid out as without the feature.
    #[cfg(feature = "sort")]
    #[test]
    fn a_sortable_name_counts_its_arrow() {
        let width = |column: TallTableColumn| {
            layout_columns(&[column], 8.4, 18.0, Sizes::base()).0[0].width
        };
        let name = "a long column name";
        assert_eq!(width(TallTableColumn::new(name, ColumnKind::Float)), 159.0);
        let sortable = TallTableColumn::new(name, ColumnKind::Float).sortable(true);
        assert_eq!(width(sortable), 177.0);
        // A kind's width past the name's leaves it as it was.
        let short = TallTableColumn::new("f", ColumnKind::Float).sortable(true);
        assert_eq!(width(short), 120.0);
    }
}
