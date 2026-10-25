//! A cell's paint (`custom-cells`): what a page answers for a cell next to
//! its value ([`CellPaint`]), and what turns it into pixels, held by the
//! column ([`Ramp`], [`Bar`]). Three 0..1 values, mixed through theme
//! tokens resolved each frame, so a theme switch recolors every cell on its
//! frame with no page read again (`docs/DECISIONS.md`, "Features").

use gpui_kit::component::Theme;
use gpui_kit::{Bounds, Hsla, Pixels, Rgba, point, px, size};

use crate::column::{CELL_PADDING, TallTableColumn};

/// What a page answers for a cell ([`TallTablePage::paint`](crate::TallTablePage::paint)).
/// Each field 0..=1 (clamped). `None`, NaN, or a field whose column has no
/// ramp or bar draws nothing (the last a debug assertion: a host's mistake).
#[derive(Debug, Default, Clone, Copy, PartialEq)]
pub struct CellPaint {
    /// Through the column's fill ramp ([`TallTableColumn::fill`]): the whole cell.
    pub fill: Option<f32>,
    /// The bar's end across the cell's inner width, drawn from the column's
    /// zero ([`TallTableColumn::bar`]).
    pub bar: Option<f32>,
    /// Through the column's text ramp ([`TallTableColumn::text_ramp`]): the
    /// value's color.
    pub text: Option<f32>,
}

/// A theme token, resolved each frame (a fixed color is `|_| hsla(…)`).
pub type Stop = fn(&Theme) -> Hsla;

/// Two or more stops, evenly spaced over 0..=1, mixed in Oklab (as CSS's
/// `color-mix(in oklab, …)` does), so equal steps of a value look like equal
/// steps of color. Two stops for a sequential scale, three for a diverging
/// one (down, none, up).
#[derive(Debug, Clone, PartialEq)]
pub struct Ramp {
    stops: Vec<Stop>,
}

impl Ramp {
    /// Panics with fewer than two stops. A slice, so closures coerce:
    /// `Ramp::new(&[|theme| theme.background, |theme| theme.chart_1])`.
    pub fn new(stops: &[Stop]) -> Self {
        assert!(stops.len() >= 2, "a ramp needs two or more stops");
        Self {
            stops: stops.to_vec(),
        }
    }

    pub fn stops(&self) -> &[Stop] {
        &self.stops
    }

    pub(crate) fn resolve(&self, theme: &Theme) -> ResolvedRamp {
        ResolvedRamp {
            stops: self
                .stops
                .iter()
                .map(|stop| Oklab::from_rgba(Rgba::from(stop(theme))))
                .collect(),
        }
    }
}

/// A bar from a zero point: it spans from `zero` to the page's value, both
/// 0..=1 of the cell's inner width, so a value left of zero grows left.
#[derive(Debug, Clone, Copy)]
pub struct Bar {
    /// Where the bar starts, 0..=1 of the inner width (0, the left edge, by
    /// default).
    pub zero: f32,
    pub color: Stop,
}

/// A color compares by its function's address, as a ramp's stops do: the
/// same function is equal, though two copies of one may not be.
impl PartialEq for Bar {
    fn eq(&self, other: &Self) -> bool {
        self.zero == other.zero && std::ptr::fn_addr_eq(self.color, other.color)
    }
}

impl Bar {
    /// A bar from the left edge.
    pub fn new(color: Stop) -> Self {
        Self { zero: 0.0, color }
    }

    pub fn zero(self, zero: f32) -> Self {
        Self { zero, ..self }
    }
}

/// How far a bar sits from its row's top and bottom edges.
pub(crate) const BAR_INSET: f32 = 6.0;

/// A color in Oklab, its alpha premultiplied into `l`, `a`, `b` (CSS mixes
/// premultiplied).
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct Oklab {
    l: f32,
    a: f32,
    b: f32,
    alpha: f32,
}

fn to_linear(c: f32) -> f32 {
    if c <= 0.04045 {
        c / 12.92
    } else {
        ((c + 0.055) / 1.055).powf(2.4)
    }
}

fn from_linear(c: f32) -> f32 {
    if c <= 0.003_130_8 {
        c * 12.92
    } else {
        1.055 * c.powf(1.0 / 2.4) - 0.055
    }
}

impl Oklab {
    /// Björn Ottosson's sRGB → Oklab, the matrices CSS Color 4 uses.
    pub(crate) fn from_rgba(color: Rgba) -> Self {
        let (r, g, b) = (to_linear(color.r), to_linear(color.g), to_linear(color.b));
        let l = (0.412_221_47 * r + 0.536_332_55 * g + 0.051_445_995 * b).cbrt();
        let m = (0.211_903_5 * r + 0.680_699_5 * g + 0.107_396_96 * b).cbrt();
        let s = (0.088_302_46 * r + 0.281_718_85 * g + 0.629_978_7 * b).cbrt();
        let alpha = color.a;
        Self {
            l: (0.210_454_26 * l + 0.793_617_8 * m - 0.004_072_047 * s) * alpha,
            a: (1.977_998_5 * l - 2.428_592_2 * m + 0.450_593_7 * s) * alpha,
            b: (0.025_904_037 * l + 0.782_771_77 * m - 0.808_675_77 * s) * alpha,
            alpha,
        }
    }

    pub(crate) fn to_rgba(self) -> Rgba {
        if self.alpha <= 0.0 {
            return Rgba {
                r: 0.0,
                g: 0.0,
                b: 0.0,
                a: 0.0,
            };
        }
        let (lab_l, lab_a, lab_b) = (
            self.l / self.alpha,
            self.a / self.alpha,
            self.b / self.alpha,
        );
        let l = (lab_l + 0.396_337_78 * lab_a + 0.215_803_76 * lab_b).powi(3);
        let m = (lab_l - 0.105_561_346 * lab_a - 0.063_854_17 * lab_b).powi(3);
        let s = (lab_l - 0.089_484_18 * lab_a - 1.291_485_5 * lab_b).powi(3);
        let channel = |c: f32| from_linear(c).clamp(0.0, 1.0);
        Rgba {
            r: channel(4.076_741_7 * l - 3.307_711_6 * m + 0.230_969_94 * s),
            g: channel(-1.268_438 * l + 2.609_757_4 * m - 0.341_319_38 * s),
            b: channel(-0.004_196_086_3 * l - 0.703_418_6 * m + 1.707_614_7 * s),
            a: self.alpha.clamp(0.0, 1.0),
        }
    }

    fn mix(self, other: Self, t: f32) -> Self {
        let lerp = |from: f32, to: f32| from + (to - from) * t;
        Self {
            l: lerp(self.l, other.l),
            a: lerp(self.a, other.a),
            b: lerp(self.b, other.b),
            alpha: lerp(self.alpha, other.alpha),
        }
    }
}

/// A ramp's stops in Oklab, for one frame.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct ResolvedRamp {
    stops: Vec<Oklab>,
}

impl ResolvedRamp {
    /// The color at `value` (clamped to 0..=1), or `None` for NaN.
    pub(crate) fn at(&self, value: f32) -> Option<Rgba> {
        if value.is_nan() {
            return None;
        }
        let along = value.clamp(0.0, 1.0) * (self.stops.len() - 1) as f32;
        let index = (along.floor() as usize).min(self.stops.len() - 2);
        let mixed = self.stops[index].mix(self.stops[index + 1], along - index as f32);
        Some(mixed.to_rgba())
    }
}

/// A column's paint, resolved from the theme for one frame.
#[derive(Debug, Clone, PartialEq, Default)]
pub(crate) struct ColumnPaint {
    fill: Option<ResolvedRamp>,
    text: Option<ResolvedRamp>,
    bar: Option<(f32, Hsla)>,
    /// The flash's ramp (`live`).
    #[cfg(feature = "live")]
    pub(crate) flash: Option<ResolvedRamp>,
}

impl ColumnPaint {
    /// No ramp and no bar: nothing a page answers can draw.
    pub(crate) fn is_empty(&self) -> bool {
        self.fill.is_none() && self.text.is_none() && self.bar.is_none()
    }

    pub(crate) fn resolve(column: &TallTableColumn, theme: &Theme) -> Self {
        Self {
            fill: column.fill.as_ref().map(|ramp| ramp.resolve(theme)),
            text: column.text_ramp.as_ref().map(|ramp| ramp.resolve(theme)),
            bar: column.bar.map(|bar| (bar.zero, (bar.color)(theme))),
            #[cfg(feature = "live")]
            flash: column.flash.as_ref().map(|(ramp, _)| ramp.resolve(theme)),
        }
    }
}

/// A cell's paint as drawn: the quads under its text and its text's color.
#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct DrawnPaint {
    pub(crate) fill: Option<(Bounds<Pixels>, Rgba)>,
    pub(crate) bar: Option<(Bounds<Pixels>, Hsla)>,
    pub(crate) text: Option<Rgba>,
    /// The flash's color, its opacity in its alpha (`live`).
    #[cfg(feature = "live")]
    pub(crate) flash: Option<Rgba>,
}

impl DrawnPaint {
    /// As a probe reports it, the bar from the cell's left edge at `left`.
    pub(crate) fn probe(&self, left: f32) -> crate::PaintProbe {
        crate::PaintProbe {
            fill: self.fill.map(|(_, color)| rgba8(color)),
            bar: self.bar.map(|(bounds, _)| {
                (
                    f32::from(bounds.origin.x) - left,
                    f32::from(bounds.size.width),
                )
            }),
            text: self.text.map(rgba8),
            #[cfg(feature = "live")]
            flash: self.flash.map(rgba8),
        }
    }
}

/// The bar's left edge (from the inner left) and width, in px, for a bar
/// from `zero` to `end` across `inner` px. `None` for NaN.
pub(crate) fn bar_span(zero: f32, end: f32, inner: f32) -> Option<(f32, f32)> {
    if end.is_nan() || zero.is_nan() {
        return None;
    }
    let (zero, end) = (zero.clamp(0.0, 1.0), end.clamp(0.0, 1.0));
    Some((zero.min(end) * inner, (end - zero).abs() * inner))
}

/// `paint` in the cell at `left`, `top` (`width` × `height`, in the cells
/// layer's coordinates) through `column`'s ramps and bar.
pub(crate) fn draw(
    paint: CellPaint,
    column: &ColumnPaint,
    left: f32,
    top: f32,
    width: f32,
    height: f32,
) -> DrawnPaint {
    debug_assert!(
        paint.fill.is_none() || column.fill.is_some(),
        "a fill for a column with no fill ramp"
    );
    debug_assert!(
        paint.bar.is_none() || column.bar.is_some(),
        "a bar for a column with no bar"
    );
    debug_assert!(
        paint.text.is_none() || column.text.is_some(),
        "a text color for a column with no text ramp"
    );
    let fill = paint
        .fill
        .zip(column.fill.as_ref())
        .and_then(|(value, ramp)| ramp.at(value))
        .map(|color| (cell_box(left, top, width, height), color));
    // Clear of the line under the row, which the row's background draws.
    let height = (height - 1.0).max(0.0);
    let pad = CELL_PADDING / 2.0;
    let bar = paint
        .bar
        .zip(column.bar)
        .and_then(|(end, (zero, color))| {
            let (x, w) = bar_span(zero, end, (width - CELL_PADDING).max(0.0))?;
            Some((
                Bounds::new(
                    point(px(left + pad + x), px(top + BAR_INSET)),
                    size(px(w), px((height - 2.0 * BAR_INSET).max(0.0))),
                ),
                color,
            ))
        })
        .filter(|(bounds, _)| bounds.size.width > px(0.));
    let text = paint
        .text
        .zip(column.text.as_ref())
        .and_then(|(value, ramp)| ramp.at(value));
    DrawnPaint {
        fill,
        bar,
        text,
        #[cfg(feature = "live")]
        flash: None,
    }
}

/// A flash at `at` in `ramp`, faded to `opacity`: the cell's quad color.
#[cfg(feature = "live")]
pub(crate) fn flash_color(ramp: &ResolvedRamp, at: f32, opacity: f32) -> Option<Rgba> {
    let mut color = ramp.at(at)?;
    color.a *= opacity.clamp(0.0, 1.0);
    Some(color)
}

/// A cell's whole box, clear of the line under its row, which the row's
/// background draws: a fill's, and a flash's.
pub(crate) fn cell_box(left: f32, top: f32, width: f32, height: f32) -> Bounds<Pixels> {
    Bounds::new(
        point(px(left), px(top)),
        size(px(width), px((height - 1.0).max(0.0))),
    )
}

/// A color as 8-bit RGBA, as a probe reports it.
pub(crate) fn rgba8(color: Rgba) -> [u8; 4] {
    let byte = |c: f32| (c.clamp(0.0, 1.0) * 255.0).round() as u8;
    [byte(color.r), byte(color.g), byte(color.b), byte(color.a)]
}

#[cfg(test)]
mod tests {
    use super::{Oklab, ResolvedRamp, bar_span, rgba8};
    use gpui_kit::Rgba;

    fn rgb(hex: u32) -> Rgba {
        gpui_kit::rgb(hex)
    }

    #[test]
    fn oklab_round_trips() {
        for hex in [0xffffff, 0x000000, 0x93c5fd, 0x16a34a, 0xdc2626, 0x0a0a0a] {
            let color = rgb(hex);
            assert_eq!(
                rgba8(Oklab::from_rgba(color).to_rgba()),
                rgba8(color),
                "{hex:06x}"
            );
        }
    }

    #[test]
    fn white_is_l_one() {
        let white = Oklab::from_rgba(rgb(0xffffff));
        assert!((white.l - 1.0).abs() < 1e-3 && white.a.abs() < 1e-3 && white.b.abs() < 1e-3);
    }

    #[test]
    fn ramp_ends_and_middle() {
        let ramp = ResolvedRamp {
            stops: vec![
                Oklab::from_rgba(rgb(0xdc2626)),
                Oklab::from_rgba(rgb(0xffffff)),
                Oklab::from_rgba(rgb(0x16a34a)),
            ],
        };
        assert_eq!(rgba8(ramp.at(0.0).unwrap()), rgba8(rgb(0xdc2626)));
        assert_eq!(rgba8(ramp.at(0.5).unwrap()), rgba8(rgb(0xffffff)));
        assert_eq!(rgba8(ramp.at(1.0).unwrap()), rgba8(rgb(0x16a34a)));
        assert_eq!(ramp.at(7.0), ramp.at(1.0), "clamped");
        assert_eq!(ramp.at(f32::NAN), None);
    }

    #[test]
    fn bars_grow_from_zero() {
        assert_eq!(bar_span(0.0, 0.25, 100.0), Some((0.0, 25.0)));
        assert_eq!(bar_span(0.5, 0.25, 100.0), Some((25.0, 25.0)));
        assert_eq!(bar_span(0.5, 1.5, 100.0), Some((50.0, 50.0)));
        assert_eq!(bar_span(0.5, f32::NAN, 100.0), None);
    }
}
