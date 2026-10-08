//! Jump to row: what the header strip's input means.
//!
//! Rows are numbered from 1, as the table's gutter shows them. A number may
//! carry thousands separators (`1,000,000`, `1 000 000`, `1_000_000`), only
//! between groups of three, and
//! may be typed in full-width digits: a Japanese IME commits `１２３` unless
//! it's switched to half-width, and turning that away would be a canvas gap
//! the DOM's `<input type=number>` doesn't have.

/// Why typed text isn't a row to jump to. [`Refusal::message`] is the inline
/// line under the input.
#[derive(Debug, Clone, PartialEq)]
pub enum Refusal {
    /// Not a whole number.
    NotANumber,
    /// A number outside `1..=rows` (`requested` is `None` past `u64`).
    OutOfRange {
        requested: Option<u64>,
        rows: u64,
        /// A CSV still loading: more rows may come.
        loading: bool,
    },
}

impl Refusal {
    pub fn message(&self) -> String {
        use crate::dataset::format_count;

        match self {
            Self::NotANumber => "Type a row number, like 1,000.".into(),
            Self::OutOfRange { rows: 0, .. } => "This file has no rows.".into(),
            Self::OutOfRange {
                requested,
                rows,
                loading,
            } => {
                let requested = match requested {
                    Some(row) => format!("No row {}", format_count(*row)),
                    None => "No such row".into(),
                };
                let rows = format_count(*rows);
                if *loading {
                    format!("{requested}: rows 1 to {rows} are loaded so far.")
                } else {
                    format!("{requested}: rows run from 1 to {rows}.")
                }
            }
        }
    }
}

/// The 0-based row `text` asks for, in a table of `rows` rows. `Ok(None)`
/// for blank text (nothing to do, nothing to say).
pub fn parse(text: &str, rows: u64, loading: bool) -> Result<Option<u64>, Refusal> {
    // Groups of digits between separators: thousands groups only, so
    // `1,000,000` is a million, while `1,5` (a decimal comma) and `12 34` (a
    // typo) are refused rather than read as rows 15 and 1234.
    let mut groups: Vec<String> = vec![String::new()];
    // `char::is_whitespace` includes the ideographic space an IME types.
    for c in text.trim().chars() {
        match c {
            '0'..='9' => groups.last_mut().unwrap().push(c),
            // Full-width digits, U+FF10..=U+FF19.
            '０'..='９' => groups
                .last_mut()
                .unwrap()
                .push(char::from(b'0' + (c as u32 - '０' as u32) as u8)),
            ',' | '，' | '_' | ' ' | '\u{3000}' => groups.push(String::new()),
            _ => return Err(Refusal::NotANumber),
        }
    }
    let grouped = groups.len() > 1;
    if grouped
        && (!(1..=3).contains(&groups[0].len()) || groups[1..].iter().any(|group| group.len() != 3))
    {
        return Err(Refusal::NotANumber);
    }
    let digits = groups.concat();
    if digits.is_empty() {
        return Ok(None);
    }
    let requested = digits.parse::<u64>().ok();
    match requested {
        Some(row) if (1..=rows).contains(&row) => Ok(Some(row - 1)),
        _ => Err(Refusal::OutOfRange {
            requested,
            rows,
            loading,
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::{Refusal, parse};

    const ROWS: u64 = 25_067_889;

    #[test]
    fn first_middle_last() {
        assert_eq!(parse("1", ROWS, false), Ok(Some(0)));
        assert_eq!(parse("12533945", ROWS, false), Ok(Some(12_533_944)));
        assert_eq!(parse("25067889", ROWS, false), Ok(Some(ROWS - 1)));
    }

    #[test]
    fn separators_and_spaces() {
        assert_eq!(parse("1,000,000", ROWS, false), Ok(Some(999_999)));
        assert_eq!(parse("1 000 000", ROWS, false), Ok(Some(999_999)));
        assert_eq!(parse("1_000_000", ROWS, false), Ok(Some(999_999)));
        assert_eq!(parse("12,345,678", ROWS, false), Ok(Some(12_345_677)));
        assert_eq!(parse("999,999", ROWS, false), Ok(Some(999_998)));
        assert_eq!(parse("  42\t", ROWS, false), Ok(Some(41)));
        assert_eq!(parse("", ROWS, false), Ok(None));
        assert_eq!(parse("   ", ROWS, false), Ok(None));
    }

    #[test]
    fn full_width_from_an_ime() {
        assert_eq!(parse("１２３", ROWS, false), Ok(Some(122)));
        assert_eq!(parse("１，０００", ROWS, false), Ok(Some(999)));
        // The ideographic space.
        assert_eq!(parse("\u{3000}１２\u{3000}", ROWS, false), Ok(Some(11)));
        assert_eq!(parse("1２3", ROWS, false), Ok(Some(122)));
        assert_eq!(parse("１２\u{3000}３４５", ROWS, false), Ok(Some(12_344)));
    }

    #[test]
    fn not_numbers() {
        for text in [
            "abc", "-5", "+5", "1.5", "1e3", ",1", "1,", "1,,0", "12a", "一",
            // Not thousands groups: a decimal comma, typos, a misplaced group.
            "1,5", "1,0", "12 34", "1234,567", "1,00,000", "1,000,00",
        ] {
            assert_eq!(
                parse(text, ROWS, false),
                Err(Refusal::NotANumber),
                "{text:?}"
            );
        }
    }

    #[test]
    fn out_of_range() {
        let out = |requested| Refusal::OutOfRange {
            requested,
            rows: ROWS,
            loading: false,
        };
        assert_eq!(parse("0", ROWS, false), Err(out(Some(0))));
        assert_eq!(parse("25067890", ROWS, false), Err(out(Some(25_067_890))));
        assert_eq!(
            parse("99999999999999999999999", ROWS, false),
            Err(out(None))
        );
        assert_eq!(
            out(Some(25_067_890)).message(),
            "No row 25,067,890: rows run from 1 to 25,067,889."
        );
        assert_eq!(
            parse("2000", 1000, true).map_err(|refusal| refusal.message()),
            Err("No row 2,000: rows 1 to 1,000 are loaded so far.".into())
        );
        assert_eq!(
            parse("1", 0, false).map_err(|refusal| refusal.message()),
            Err("This file has no rows.".into())
        );
    }
}
