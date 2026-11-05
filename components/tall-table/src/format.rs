//! Fitting a float to its column, like a spreadsheet's automatic format.
//!
//! A DOUBLE prints as its shortest round-trip text, up to 17 significant
//! digits, which a fixed column can't hold. Cutting it loses digits with no
//! sign (right-aligned, the front went: `45.123…` read as `5.123…`). So a
//! float that doesn't fit is rounded to the digits that do, in plain
//! notation while its whole part fits, in scientific otherwise. The exact
//! value is a hover away (the table's tooltip). Integers are never rounded:
//! an ID isn't a quantity.

/// A float as shown in at most `budget` characters. `exact` (its shortest
/// round-trip text) comes back as it is if it fits. Anything else is a
/// different float (no shorter text reads back the same), so the caller can
/// tell a rounded value by `shown != exact`. If even the shortest scientific
/// text doesn't fit, it's returned anyway, and the cell cuts it.
pub fn fit_float(value: f64, exact: String, budget: usize) -> String {
    if exact.len() <= budget || !value.is_finite() {
        return exact;
    }
    match plain(value, budget) {
        // Plain reads more easily, so it wins while it keeps a few digits.
        Some((plain, digits)) if digits >= MIN_SIGNIFICANT => plain,
        // Or while it says the same as scientific (`0.0005`, not `5e-4`).
        Some((plain, _)) => {
            let scientific = scientific(value, budget);
            if plain.parse::<f64>() == scientific.parse() {
                plain
            } else {
                scientific
            }
        }
        None => scientific(value, budget),
    }
}

/// `value` rounded to the decimals that fit in `budget` characters, with the
/// significant digits it kept, or `None` when its whole part doesn't fit or
/// it rounds to zero.
fn plain(value: f64, budget: usize) -> Option<(String, usize)> {
    let sign = usize::from(value.is_sign_negative());
    let magnitude = value.abs();
    // Digits left of the point; a value under 1 shows one, `0`.
    let whole = if magnitude < 1.0 {
        1
    } else {
        magnitude.log10().floor() as usize + 1
    };
    let mut decimals = budget.saturating_sub(sign + whole + 1);
    loop {
        let rounded = format!("{value:.decimals$}");
        let shown = trim_zeros(&rounded);
        // Rounding can carry into another digit (`999.96` → `1000.0`).
        if shown.len() <= budget {
            let digits = significant(&rounded);
            // A value that rounds to zero (`0.000`) shows nothing of itself.
            return (rounded.bytes().any(|byte| (b'1'..=b'9').contains(&byte)))
                .then_some((shown, digits));
        }
        decimals = decimals.checked_sub(1)?;
    }
}

/// `value` in scientific notation with as many mantissa digits as fit.
fn scientific(value: f64, budget: usize) -> String {
    // Start from what the exponent leaves room for (a double has at most 17
    // significant digits); rounding can lengthen the exponent (`9.99e9` →
    // `1e10`), so step down from there.
    let sign = usize::from(value.is_sign_negative());
    let exponent = format!("e{}", value.abs().log10().floor());
    let mut digits = budget.saturating_sub(sign + 2 + exponent.len()).min(16);
    loop {
        let shown = trim_mantissa(&format!("{value:.digits$e}"));
        if shown.len() <= budget || digits == 0 {
            return shown;
        }
        digits -= 1;
    }
}

/// Plain text keeping fewer significant digits than this goes scientific,
/// if that keeps more: `0.0000012` in 9 characters is `1.2346e-6`.
const MIN_SIGNIFICANT: usize = 3;

/// Significant digits in plain text: the digits after the leading zeros,
/// trailing zeros included (`2.0000` kept 5).
fn significant(text: &str) -> usize {
    text.chars()
        .filter(char::is_ascii_digit)
        .skip_while(|digit| *digit == '0')
        .count()
}

/// `45.1200` → `45.12`, `45.000` → `45`.
fn trim_zeros(text: &str) -> String {
    if !text.contains('.') {
        return text.to_string();
    }
    text.trim_end_matches('0').trim_end_matches('.').to_string()
}

/// `1.2300e12` → `1.23e12`.
fn trim_mantissa(text: &str) -> String {
    match text.split_once('e') {
        Some((mantissa, exponent)) => format!("{}e{exponent}", trim_zeros(mantissa)),
        None => text.to_string(),
    }
}

/// `digits` (whole, ASCII) onto `out` with a `,` every `every` digits from
/// the right: the row count's (`format_count`), and with `format` a
/// grouped number's.
#[inline(always)]
pub(crate) fn push_grouped(out: &mut String, digits: &str, every: usize) {
    for (index, digit) in digits.chars().enumerate() {
        if index > 0 && (digits.len() - index).is_multiple_of(every) {
            out.push(',');
        }
        out.push(digit);
    }
}

#[cfg(all(feature = "format", test))]
pub(crate) use number::Control;
#[cfg(feature = "format")]
pub(crate) use number::{Advances, ColumnFormat, FORMAT_CHARS};
#[cfg(feature = "format")]
pub use number::{NumberFormat, Sign};

/// A number column's shown text set by its host (`format`): fixed
/// decimals, a sign, grouping, a suffix (`docs/DECISIONS.md`, "Features",
/// 2026-11-04). A text that doesn't fit its cell falls back to the
/// automatic format above.
#[cfg(feature = "format")]
mod number {
    use gpui_kit::SharedString;

    use crate::CellValue;

    /// How a number column's values are written (`format`). Built with
    /// [`NumberFormat::new`] and its setters.
    #[derive(Debug, Clone, PartialEq, Default)]
    #[non_exhaustive]
    pub struct NumberFormat {
        pub(crate) decimals: Option<u8>,
        pub(crate) sign: Sign,
        pub(crate) grouping: bool,
        pub(crate) suffix: SharedString,
    }

    impl NumberFormat {
        /// The automatic digits (a float's exact text), [`Sign::Negative`],
        /// no grouping, no suffix.
        pub fn new() -> Self {
            Self::default()
        }

        /// A float at `decimals` fixed decimals, trailing zeros kept,
        /// rounded half to even from its exact binary value (Rust's
        /// `{:.N}`). Floats only: an integer has none and a decimal's are
        /// its own. A page may answer a cell's own
        /// ([`TallTablePage::decimals`](crate::TallTablePage::decimals)).
        pub fn decimals(self, decimals: u8) -> Self {
            Self {
                decimals: Some(decimals),
                ..self
            }
        }

        pub fn sign(self, sign: Sign) -> Self {
            Self { sign, ..self }
        }

        /// A `,` every three whole digits (a float's exponent form keeps
        /// its own).
        pub fn grouping(self, grouping: bool) -> Self {
            Self { grouping, ..self }
        }

        /// Text after the number (`%`): nothing is scaled. One line, as a
        /// cell is: a line break shows as `¶`.
        pub fn suffix(self, suffix: impl Into<SharedString>) -> Self {
            let suffix: SharedString = suffix.into();
            let suffix = if suffix.contains(['\n', '\r']) {
                suffix
                    .replace("\r\n", "¶")
                    .replace(['\n', '\r'], "¶")
                    .into()
            } else {
                suffix
            };
            Self { suffix, ..self }
        }
    }

    /// Which values a formatted number shows a sign on, by its raw value
    /// (a tiny rise is `+0.00`); an exact zero (`-0.0` too) never has one.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
    pub enum Sign {
        /// A `-` on a negative.
        #[default]
        Negative,
        /// A `-` on a negative, a `+` on a positive.
        Always,
    }

    /// The characters a format writes, in the order [`Advances`] holds
    /// them (a suffix's are shaped apart).
    pub(crate) const FORMAT_CHARS: [char; 15] = [
        '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '+', '-', '.', ',', 'e',
    ];

    /// Each of [`FORMAT_CHARS`]' advance in the cells' font at the size in
    /// effect, read once per font and size: a formatted text's width is
    /// their sum, which a DOM side can match (`cells.json`'s `format`).
    #[derive(Debug, Clone, Copy, PartialEq)]
    pub(crate) struct Advances {
        chars: [f32; 15],
        /// The widest, for a character a format never writes.
        widest: f32,
        /// The narrowest digit's, a whole part's least width.
        digit: f32,
    }

    impl Advances {
        /// `chars`, each [`FORMAT_CHARS`]' advance in its order.
        pub(crate) fn new(chars: [f32; 15]) -> Self {
            Self {
                chars,
                widest: chars.iter().copied().fold(0.0, f32::max),
                digit: chars[..10].iter().copied().fold(f32::INFINITY, f32::min),
            }
        }

        /// Each of [`FORMAT_CHARS`] and its advance, for the layout probe.
        pub(crate) fn each(&self) -> impl Iterator<Item = (char, f32)> + '_ {
            FORMAT_CHARS.into_iter().zip(self.chars)
        }

        /// A digit's advance (`0`'s).
        #[cfg(test)]
        pub(crate) fn zero(&self) -> f32 {
            self.chars[0]
        }

        /// `text`'s width: its characters' advances summed.
        pub(crate) fn width(&self, text: &str) -> f32 {
            text.chars()
                .map(|ch| {
                    let index = match ch {
                        '0'..='9' => ch as usize - '0' as usize,
                        '+' => 10,
                        '-' => 11,
                        '.' => 12,
                        ',' => 13,
                        'e' => 14,
                        _ => return self.widest,
                    };
                    self.chars[index]
                })
                .sum()
        }
    }

    /// A laid-out column's format, its suffix measured.
    #[derive(Debug, Clone, PartialEq)]
    pub(crate) struct ColumnFormat {
        pub(crate) format: NumberFormat,
        /// A float column's (its values' decimals and sign), else an
        /// integer's or decimal's (its text's sign and grouping).
        pub(crate) float: bool,
        /// The suffix shaped once at the size in effect, after a digit (so
        /// its kerning with the number is counted).
        pub(crate) suffix_px: f32,
        #[cfg(test)]
        pub(crate) control: Control,
    }

    impl ColumnFormat {
        /// `value`'s formatted text and its width, or `None` for a value
        /// the format doesn't touch (NULL, NaN, an infinity, a value of
        /// another kind than its column's, a text that isn't a plain
        /// number). `decimals` is a page's own count for the cell.
        pub(crate) fn measure(
            &self,
            advances: &Advances,
            value: &CellValue<'_>,
            decimals: Option<u8>,
        ) -> Option<(String, f32)> {
            let number = self.number(value, decimals)?;
            #[cfg(test)]
            let width = if self.control == Control::FitByCount {
                number.chars().count() as f32 * advances.zero()
            } else {
                advances.width(&number)
            };
            #[cfg(not(test))]
            let width = advances.width(&number);
            let width = width + self.suffix_px;
            Some((number + &self.format.suffix, width))
        }

        /// The formatted text if it takes at most `room` (the content box
        /// less a pixel), else `None`: the automatic format. A float at
        /// fixed decimals whose whole digits alone can't fit isn't written
        /// out (a value near 1e300 would be 300 of them).
        pub(crate) fn fit(
            &self,
            advances: &Advances,
            room: f32,
            value: &CellValue<'_>,
            decimals: Option<u8>,
        ) -> Option<String> {
            let magnitude = match *value {
                CellValue::Float(value) => value.abs(),
                CellValue::Float32(value) => f64::from(value).abs(),
                _ => 0.0,
            };
            let fixed = decimals.or(self.format.decimals).is_some();
            if fixed && magnitude >= 1e15 && magnitude.is_finite() {
                let whole = magnitude.log10().floor() + 1.0;
                if whole * f64::from(advances.digit) > f64::from(room) {
                    return None;
                }
            }
            let (text, width) = self.measure(advances, value, decimals)?;
            (width <= room).then_some(text)
        }

        /// Whether `text`, a fitted text of `value`'s, reads back, its
        /// sign, grouping, and suffix taken off, as another value than
        /// `value` in its own width: the format rounded it, so its tooltip
        /// opens. A text value's never is (its digits are as written).
        pub(crate) fn rounded(&self, text: &str, value: &CellValue<'_>) -> bool {
            let number = text
                .strip_suffix(self.format.suffix.as_ref())
                .unwrap_or(text);
            let number: String = number
                .chars()
                .filter(|ch| *ch != ',' && *ch != '+')
                .collect();
            match *value {
                CellValue::Float(value) => number.parse::<f64>() != Ok(value),
                CellValue::Float32(value) => number.parse::<f32>() != Ok(value),
                _ => false,
            }
        }

        /// The number, signed and grouped, without the suffix.
        fn number(&self, value: &CellValue<'_>, decimals: Option<u8>) -> Option<String> {
            #[cfg(test)]
            let decimals = decimals.filter(|_| self.control != Control::PageIgnored);
            let format = &self.format;
            let (negative, zero, digits) = match *value {
                CellValue::Float(value) if self.float => (
                    value < 0.0,
                    value == 0.0,
                    self.float_digits(value, decimals.or(format.decimals))?,
                ),
                CellValue::Float32(value) if self.float => {
                    let digits = match decimals.or(format.decimals) {
                        // Its own shortest text, not the widened value's.
                        None if value.is_finite() => {
                            format!("{value:?}").trim_start_matches('-').to_string()
                        }
                        decimals => self.float_digits(f64::from(value), decimals)?,
                    };
                    (value < 0.0, value == 0.0, digits)
                }
                CellValue::Text(ref text) if !self.float => {
                    let (negative, digits) = match text.strip_prefix('-') {
                        Some(digits) => (true, digits),
                        None => (false, text.as_ref()),
                    };
                    plain_number(digits).then_some(())?;
                    let zero = digits.bytes().all(|byte| byte == b'0' || byte == b'.');
                    (negative, zero, digits.to_string())
                }
                _ => return None,
            };
            let digits = if format.grouping && !digits.contains('e') {
                #[cfg(test)]
                let every = if self.control == Control::GroupByFour {
                    4
                } else {
                    3
                };
                #[cfg(not(test))]
                let every = 3;
                let (whole, rest) = digits.split_at(digits.find('.').unwrap_or(digits.len()));
                let mut grouped = String::with_capacity(digits.len() + whole.len() / every);
                super::push_grouped(&mut grouped, whole, every);
                grouped.push_str(rest);
                grouped
            } else {
                digits
            };
            #[cfg(test)]
            let zero = match self.control {
                // The sign by the rounded text: none where it shows zero.
                Control::SignFromText => !digits.bytes().any(|byte| (b'1'..=b'9').contains(&byte)),
                Control::PlusOnZero => false,
                _ => zero,
            };
            let sign = match (negative, zero, format.sign) {
                (_, true, _) => "",
                (true, false, _) => "-",
                (false, false, Sign::Always) => "+",
                (false, false, Sign::Negative) => "",
            };
            // `PlusOnZero`: a `+` on an exact zero too.
            #[cfg(test)]
            let sign = if self.control == Control::PlusOnZero && zero_value(value) {
                "+"
            } else {
                sign
            };
            Some(format!("{sign}{digits}"))
        }

        /// A finite float's digits, unsigned: at `decimals` fixed, or its
        /// exact text.
        fn float_digits(&self, value: f64, decimals: Option<u8>) -> Option<String> {
            if !value.is_finite() {
                return None;
            }
            Some(match decimals {
                Some(decimals) => {
                    let magnitude = value.abs();
                    let decimals = usize::from(decimals);
                    #[cfg(test)]
                    if self.control == Control::TiesUp {
                        return Some(half_up(&format!("{magnitude:?}"), decimals));
                    }
                    format!("{magnitude:.decimals$}")
                }
                None => format!("{:?}", value.abs()),
            })
        }
    }

    /// Digits with at most one point between digits: what a source writes
    /// an integer or a decimal as.
    fn plain_number(text: &str) -> bool {
        let (whole, fraction) = match text.split_once('.') {
            Some((whole, fraction)) => (whole, Some(fraction)),
            None => (text, None),
        };
        let digits =
            |part: &str| !part.is_empty() && part.bytes().all(|byte| byte.is_ascii_digit());
        digits(whole) && fraction.is_none_or(digits)
    }

    /// The fixture's negative controls (tests only): each must fail
    /// `cells.json`'s `format` cases.
    #[cfg(test)]
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
    pub(crate) enum Control {
        #[default]
        None,
        /// A `+` on an exact zero.
        PlusOnZero,
        /// The sign by the rounded text, not the raw value.
        SignFromText,
        /// Ties rounded up from the shortest decimal (`toFixed`).
        TiesUp,
        /// A `,` every four whole digits.
        GroupByFour,
        /// The fit by the character count at a digit's advance.
        FitByCount,
        /// The page's decimals ignored.
        PageIgnored,
    }

    /// An exact zero (tests only: `PlusOnZero`).
    #[cfg(test)]
    fn zero_value(value: &CellValue<'_>) -> bool {
        match value {
            CellValue::Float(value) => *value == 0.0,
            CellValue::Float32(value) => *value == 0.0,
            _ => false,
        }
    }

    /// `text` (a shortest decimal, unsigned, maybe with an exponent)
    /// rounded half up at `decimals` (tests only: `TiesUp`).
    #[cfg(test)]
    fn half_up(text: &str, decimals: usize) -> String {
        let value: f64 = text.parse().expect("a float's text");
        // Through a plain decimal: Rust's `{}` writes the shortest digits
        // without an exponent.
        let plain = format!("{value}");
        let (whole, fraction) = plain.split_once('.').unwrap_or((&plain, ""));
        let mut digits: Vec<u8> = whole
            .bytes()
            .chain(fraction.bytes())
            .map(|b| b - b'0')
            .collect();
        let point = whole.len();
        digits.resize(digits.len().max(point + decimals + 1), 0);
        let round_up = digits[point + decimals] >= 5;
        digits.truncate(point + decimals);
        if round_up {
            let mut index = digits.len();
            loop {
                if index == 0 {
                    digits.insert(0, 1);
                    break;
                }
                index -= 1;
                if digits[index] == 9 {
                    digits[index] = 0;
                } else {
                    digits[index] += 1;
                    break;
                }
            }
        }
        let point = digits.len() - decimals;
        let text: String = digits.iter().map(|d| char::from(b'0' + d)).collect();
        if decimals == 0 {
            text
        } else {
            format!("{}.{}", &text[..point], &text[point..])
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The shown text, and whether it's the exact value.
    fn fit(value: f64, budget: usize) -> (String, bool) {
        let exact = format!("{value:?}");
        let shown = fit_float(value, exact.clone(), budget);
        let is_exact = shown == exact;
        // Anything but the exact text is a different float.
        assert_eq!(
            is_exact,
            shown.parse::<f64>() == Ok(value) || value.is_nan()
        );
        (shown, is_exact)
    }

    #[test]
    fn exact_text_that_fits_is_unchanged() {
        assert_eq!(fit(45.125, 12), ("45.125".into(), true));
        assert_eq!(fit(-0.5, 4), ("-0.5".into(), true));
        assert_eq!(fit(1e300, 6), ("1e300".into(), true));
        assert_eq!(fit(f64::NAN, 1), ("NaN".into(), true));
    }

    #[test]
    fn rounds_to_the_decimals_that_fit() {
        // Part E's example: 17 characters into 12.
        assert_eq!(fit(45.12345678901234, 12), ("45.123456789".into(), false));
        assert_eq!(fit(-45.12345678901234, 12), ("-45.12345679".into(), false));
        assert_eq!(fit(0.123456789012345, 8), ("0.123457".into(), false));
        // Trailing zeros after rounding go.
        assert_eq!(fit(2.0000000001, 6), ("2".into(), false));
    }

    #[test]
    fn rounding_that_carries_still_fits() {
        assert_eq!(fit(999.9996, 6), ("1000".into(), false));
        assert_eq!(fit(99999.96, 5), ("1e5".into(), false));
    }

    #[test]
    fn a_whole_part_too_long_goes_scientific() {
        assert_eq!(fit(1234567890123.5, 8), ("1.235e12".into(), false));
    }

    #[test]
    fn tiny_values_keep_plain_while_digits_remain() {
        assert_eq!(fit(0.000123456789, 9), ("0.0001235".into(), false));
        assert_eq!(fit(0.0005000000001, 6), ("0.0005".into(), false));
        // Plain would keep 2 digits (0.0000012); scientific keeps 5.
        assert_eq!(fit(0.00000123456789, 9), ("1.2346e-6".into(), false));
    }

    #[test]
    fn never_rounds_to_zero() {
        assert_eq!(fit(1.6e-9, 5), ("2e-9".into(), false));
    }

    #[test]
    fn rounded_text_is_never_the_same_float() {
        // Debug prints 0.30000000000000004; 0.3 isn't the same double.
        assert_eq!(fit(0.1 + 0.2, 5), ("0.3".into(), false));
        assert_eq!(fit(1e21, 4), ("1e21".into(), true));
    }

    #[test]
    fn nothing_fits_returns_the_shortest_scientific() {
        assert_eq!(fit(-1.6e-300, 3), ("-2e-300".into(), false));
    }

    /// IBM Plex Sans, as the web's text system shapes it (cosmic-text,
    /// hinting off, at gpui-pre-wgpu's locked version), lays out the pairs
    /// of characters a format writes, and each beside a `%`, at their
    /// advances' sum (`format`), but for one: `e-` (a negative exponent,
    /// `1.5e-7`) kerns 0.01 em wider. A text holds it once at most, inside
    /// the rule's pixel at any size up to 100 px, so a text that fits by its
    /// advances, drawn uncut, never overflows its cell. The pairs no format
    /// writes (`.e`, `,e`, `e.`, `e,`) may kern as they like.
    #[cfg(feature = "format")]
    #[test]
    fn plex_sans_shapes_formats_at_their_advances() {
        use cosmic_text::{Attrs, Buffer, Family, FontSystem, Hinting, Metrics, Shaping};
        let mut db = cosmic_text::fontdb::Database::new();
        db.load_font_data(
            include_bytes!("../../../shared-web/fonts/IBMPlexSans-Regular.ttf").to_vec(),
        );
        let mut fonts = FontSystem::new_with_locale_and_db("en-US".into(), db);
        let attrs = Attrs::new().family(Family::Name("IBM Plex Sans"));
        let unwritten = [".e", ",e", "e.", "e,"];
        for size in [14.0_f32, 11.0, 18.0] {
            let mut width = |text: &str| -> f32 {
                let mut buffer = Buffer::new(&mut fonts, Metrics::new(size, size));
                let mut buffer = buffer.borrow_with(&mut fonts);
                buffer.set_hinting(Hinting::Disabled);
                buffer.set_text(text, &attrs, Shaping::Advanced, None);
                buffer.shape_until_scroll(false);
                buffer.layout_runs().map(|run| run.line_w).sum()
            };
            let chars: Vec<char> = number::FORMAT_CHARS.into_iter().chain(['%']).collect();
            let advances: Vec<f32> = chars.iter().map(|ch| width(&ch.to_string())).collect();
            if size == 14.0 {
                // `cells.json`'s advances, pinned from Chromium (`just
                // tall-table format-fixture`): the font's, natively too.
                let digit = advances[0];
                assert!((digit - 8.4).abs() < 1e-3 && (advances[11] - 5.586).abs() < 1e-3);
                assert!((advances[12] - 3.808).abs() < 1e-3 && (advances[13] - 3.808).abs() < 1e-3);
                assert!(
                    (advances[14] - 7.686).abs() < 1e-3 && (advances[15] - 12.978).abs() < 1e-3
                );
            }
            for (a, first) in chars.iter().enumerate() {
                for (b, second) in chars.iter().enumerate() {
                    let pair = format!("{first}{second}");
                    if unwritten.contains(&pair.as_str()) {
                        continue;
                    }
                    let kern = width(&pair) - advances[a] - advances[b];
                    let allowed = if pair == "e-" { 0.01 * size } else { 0.0 };
                    assert!(
                        (kern - allowed).abs() < 1e-3,
                        "{pair} at {size} px: kerned {kern}, expected {allowed}"
                    );
                }
            }
            let text = "+1,234,567.890e-12%";
            let sum: f32 = text
                .chars()
                .map(|ch| advances[chars.iter().position(|known| *known == ch).unwrap()])
                .sum();
            assert!(
                (width(text) - sum - 0.01 * size).abs() < 1e-3,
                "{text} at {size} px"
            );
        }
    }
}
