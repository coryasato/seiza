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
}
