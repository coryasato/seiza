//! The rows file (`docs/data.md`, "`rows.bin`"): the table's columns beyond
//! the elements', a column at a time. A designation is 32 bits and a name is
//! found by its row, so `full_name` and `pdes` are written when a cell asks.

use std::fmt::Write as _;

use crate::bytes::Bytes;

const MAGIC: &[u8; 4] = b"KWR1";
/// A numbered asteroid's key is this plus its number.
const NUMBERED_SPKID: u32 = 20_000_000;
/// No date.
const NO_DATE: i32 = i32::MIN;
/// A date with only its year is that many past [`NO_DATE`]; any real day
/// count is far above this many.
const YEAR_ONLY_BELOW: i32 = NO_DATE + 10_000;

/// Where each section starts, in bytes.
struct Sections {
    spkid: usize,
    designation: usize,
    first_obs: usize,
    last_obs: usize,
    diameter: usize,
    albedo: usize,
    n_obs_used: usize,
    neo: usize,
    pha: usize,
    class: usize,
    name_rows: usize,
    name_offsets: usize,
    name_text: usize,
}

pub struct Rows {
    bytes: Bytes,
    rows: usize,
    /// The first `numbered` rows have a number: row r is asteroid r + 1.
    numbered: usize,
    /// The rows with a name.
    named: usize,
    classes: Vec<String>,
    at: Sections,
}

/// JPL's Y, N, and none.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Flag {
    No,
    Yes,
    Unknown,
}

/// Which of the two dates.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Observed {
    First,
    Last,
}

impl Rows {
    /// The file, or why its bytes aren't one.
    pub fn new(bytes: Bytes) -> Result<Self, String> {
        const COUNTS: usize = 20;
        if bytes.len() < COUNTS || bytes.u32_at(0) != u32::from_le_bytes(*MAGIC) {
            return Err("the rows file doesn't start as one (KWR1)".into());
        }
        let [rows, numbered, named, class_count] =
            [4, 8, 12, 16].map(|at| bytes.u32_at(at) as usize);
        // A row is 29 bytes of sections: counts past the file's own length
        // are turned down here, before any sum of them could wrap.
        if rows > bytes.len() / 29 || numbered > rows || named > rows {
            return Err(format!(
                "the rows file is {} bytes, short of its {rows} rows' sections",
                bytes.len()
            ));
        }
        let short = || "the rows file ends inside its header".to_string();
        let mut cursor = COUNTS;
        let mut classes = Vec::new();
        for _ in 0..class_count {
            if cursor >= bytes.len() {
                return Err(short());
            }
            let length = bytes.u8_at(cursor) as usize;
            if cursor + 1 + length > bytes.len() {
                return Err(short());
            }
            classes.push(bytes.text(cursor + 1, cursor + 1 + length));
            cursor += 1 + length;
        }
        // Every section starts on a 4-byte boundary.
        fn section(cursor: &mut usize, bytes_long: usize) -> usize {
            let start = cursor.next_multiple_of(4);
            *cursor = start + bytes_long;
            start
        }
        let cursor = &mut cursor;
        let mut at = Sections {
            spkid: section(cursor, 4 * rows),
            designation: section(cursor, 4 * rows),
            first_obs: section(cursor, 4 * rows),
            last_obs: section(cursor, 4 * rows),
            diameter: section(cursor, 4 * rows),
            albedo: section(cursor, 4 * rows),
            n_obs_used: section(cursor, 2 * rows),
            neo: section(cursor, rows),
            pha: section(cursor, rows),
            class: section(cursor, rows),
            name_rows: section(cursor, 4 * named),
            name_offsets: section(cursor, 4 * (named + 1)),
            name_text: 0,
        };
        if *cursor > bytes.len() {
            return Err(format!(
                "the rows file is {} bytes, short of its {rows} rows' sections",
                bytes.len()
            ));
        }
        // The names' text runs to the last offset.
        let text_long = bytes.u32_at(*cursor - 4) as usize;
        at.name_text = section(cursor, text_long);
        if cursor.next_multiple_of(4) != bytes.len() {
            return Err(format!(
                "the rows file is {} bytes, not its {rows} rows' sections",
                bytes.len()
            ));
        }
        // What a cell's read leans on, checked once here so a wrong file is
        // an error said on the page, never a read past a section: a
        // numbered row's key is its number, and the names' rows and offsets
        // only go up.
        if (0..numbered)
            .any(|row| bytes.u32_at(at.spkid + row * 4) != NUMBERED_SPKID + row as u32 + 1)
        {
            return Err("the rows file's numbered rows aren't in their numbers' order".into());
        }
        let ascending = |section: usize, count: usize, strictly: bool| {
            (1..count).all(|index| {
                let (before, after) = (
                    bytes.u32_at(section + (index - 1) * 4),
                    bytes.u32_at(section + index * 4),
                );
                before < after || (!strictly && before == after)
            })
        };
        let last_named = named
            .checked_sub(1)
            .map(|last| bytes.u32_at(at.name_rows + last * 4) as usize);
        if !ascending(at.name_rows, named, true)
            || !ascending(at.name_offsets, named + 1, false)
            || last_named.is_some_and(|row| row >= rows)
        {
            return Err("the rows file's names aren't in their rows' order".into());
        }
        Ok(Self {
            bytes,
            rows,
            numbered,
            named,
            classes,
            at,
        })
    }

    pub fn rows(&self) -> usize {
        self.rows
    }

    pub fn numbered(&self) -> usize {
        self.numbered
    }

    pub fn named(&self) -> usize {
        self.named
    }

    pub fn classes(&self) -> &[String] {
        &self.classes
    }

    /// JPL's key.
    pub fn spkid(&self, row: usize) -> u32 {
        assert!(row < self.rows);
        self.bytes.u32_at(self.at.spkid + row * 4)
    }

    /// A row's number, if it has one: its key says so, and its place in the
    /// file agrees (the numbered rows come first, by number).
    pub fn number(&self, row: usize) -> Option<u32> {
        (row < self.numbered).then(|| self.spkid(row) - NUMBERED_SPKID)
    }

    /// The provisional designation, packed (see [`designation`]).
    pub fn packed_designation(&self, row: usize) -> u32 {
        assert!(row < self.rows);
        self.bytes.u32_at(self.at.designation + row * 4)
    }

    /// A row's name: a binary search of the rows that have one (1 in 60).
    pub fn name(&self, row: usize) -> Option<String> {
        let (mut low, mut high) = (0, self.named);
        while low < high {
            let middle = low + (high - low) / 2;
            let named = self.bytes.u32_at(self.at.name_rows + middle * 4) as usize;
            if named == row {
                let offset = |index: usize| {
                    self.at.name_text + self.bytes.u32_at(self.at.name_offsets + index * 4) as usize
                };
                return Some(self.bytes.text(offset(middle), offset(middle + 1)));
            }
            if named < row {
                low = middle + 1;
            } else {
                high = middle;
            }
        }
        None
    }

    /// `full_name` as JPL writes it: the number (if any), the name (if
    /// any), and the designation in parentheses.
    pub fn full_name(&self, row: usize) -> String {
        let mut text = String::new();
        if let Some(number) = self.number(row) {
            let _ = write!(text, "{number} ");
        }
        if let Some(name) = self.name(row) {
            text.push_str(&name);
            text.push(' ');
        }
        text.push('(');
        push_designation(&mut text, self.packed_designation(row));
        text.push(')');
        text
    }

    /// `pdes`: the number, or on a row without one its designation, less
    /// the `A/` of an asteroid on a comet's orbit.
    pub fn pdes(&self, row: usize) -> String {
        match self.number(row) {
            Some(number) => number.to_string(),
            None => {
                let text = designation(self.packed_designation(row));
                match text.strip_prefix("A/") {
                    Some(rest) => rest.to_string(),
                    None => text,
                }
            }
        }
    }

    /// A date as JPL writes it: `1995-01-05`, or `1998-??-??` for one it
    /// has only the year of; `None` for none.
    pub fn observed(&self, which: Observed, row: usize) -> Option<String> {
        assert!(row < self.rows);
        let section = match which {
            Observed::First => self.at.first_obs,
            Observed::Last => self.at.last_obs,
        };
        match self.bytes.i32_at(section + row * 4) {
            NO_DATE => None,
            days if days < YEAR_ONLY_BELOW => Some(format!("{:04}-??-??", days - NO_DATE)),
            days => {
                let (year, month, day) = civil(i64::from(days));
                Some(format!("{year:04}-{month:02}-{day:02}"))
            }
        }
    }

    /// The diameter, km; NaN for none (9 rows in 10).
    pub fn diameter(&self, row: usize) -> f32 {
        assert!(row < self.rows);
        self.bytes.f32_at(self.at.diameter + row * 4)
    }

    /// The albedo, a share; NaN for none.
    pub fn albedo(&self, row: usize) -> f32 {
        assert!(row < self.rows);
        self.bytes.f32_at(self.at.albedo + row * 4)
    }

    pub fn n_obs_used(&self, row: usize) -> u16 {
        assert!(row < self.rows);
        self.bytes.u16_at(self.at.n_obs_used + row * 2)
    }

    /// Near-Earth.
    pub fn neo(&self, row: usize) -> Flag {
        self.flag(self.at.neo, row)
    }

    /// Potentially hazardous.
    pub fn pha(&self, row: usize) -> Flag {
        self.flag(self.at.pha, row)
    }

    fn flag(&self, section: usize, row: usize) -> Flag {
        assert!(row < self.rows);
        match self.bytes.u8_at(section + row) {
            0 => Flag::No,
            1 => Flag::Yes,
            _ => Flag::Unknown,
        }
    }

    /// The orbit class (`MBA`, `TJN`, …); empty for an index the header
    /// doesn't have.
    pub fn class(&self, row: usize) -> &str {
        assert!(row < self.rows);
        self.classes
            .get(self.bytes.u8_at(self.at.class + row) as usize)
            .map_or("", String::as_str)
    }
}

/// A packed provisional designation as text (`data/catalog.ts`,
/// `unpackDesignation`):
///
/// ```text
/// bit 31       0: a year and letters; 1: a survey's ("4109 P-L")
/// bits 23..30  the year, from 1800
/// bits 18..22  the half-month's letter, from A
/// bits 6..17   the number after the letters; 0 for none
/// bits 1..5    the second letter, from A, plus 1; 0 for none ("2017 U1")
/// bit 0        the prefix "A/" (an asteroid on a comet's orbit)
///
/// a survey's: bits 14..15 which (P-L, T-1, T-2, T-3), bits 0..13 its number
/// ```
///
/// A year before 1925 is written the old way: `A801 AA` for 1801.
pub fn designation(packed: u32) -> String {
    let mut text = String::new();
    push_designation(&mut text, packed);
    text
}

fn push_designation(text: &mut String, packed: u32) {
    const SURVEYS: [&str; 4] = ["P-L", "T-1", "T-2", "T-3"];
    if packed >> 31 == 1 {
        let survey = SURVEYS[(packed >> 14 & 3) as usize];
        let _ = write!(text, "{:04} {survey}", packed & 0x3fff);
        return;
    }
    let letter = |index: u32| char::from(b'A' + index as u8);
    let year = 1800 + (packed >> 23 & 0xff);
    if packed & 1 == 1 {
        text.push_str("A/");
    }
    let _ = if year < 1925 {
        write!(text, "A{} ", year - 1000)
    } else {
        write!(text, "{year} ")
    };
    text.push(letter(packed >> 18 & 31));
    match packed >> 1 & 31 {
        0 => {}
        second => text.push(letter(second - 1)),
    }
    match packed >> 6 & 0xfff {
        0 => {}
        number => {
            let _ = write!(text, "{number}");
        }
    }
}

/// The year, month, and day `days` after 1970-01-01 (Hinnant's
/// civil-from-days).
pub fn civil(days: i64) -> (i64, i64, i64) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    (yoe + era * 400 + i64::from(month <= 2), month, day)
}

/// The days from 1970-01-01 to a `YYYY-MM-DD` (Hinnant's days-from-civil);
/// none for anything that isn't a real day.
pub fn day_of(date: &str) -> Option<i64> {
    let mut parts = date.split('-').map(|part| part.parse::<i64>().ok());
    let given = (parts.next()??, parts.next()??, parts.next()??);
    if parts.next().is_some() || !(1..=12).contains(&given.1) {
        return None;
    }
    let (year, month, day) = given;
    let year = year - i64::from(month <= 2);
    let (era, yoe) = (year.div_euclid(400), year.rem_euclid(400));
    let doy = (153 * (if month > 2 { month - 3 } else { month + 9 }) + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    // A day that isn't one (the 31st of June) comes back as another date.
    (civil(days) == given).then_some(days)
}

#[cfg(test)]
mod tests {
    use super::{civil, day_of, designation};

    /// `data/catalog.ts`'s `packDesignation`, for the shapes it packs.
    fn pack(year: u32, half_month: u8, second: Option<u8>, number: u32, comet_orbit: bool) -> u32 {
        (year - 1800) << 23
            | u32::from(half_month - b'A') << 18
            | number << 6
            | second.map_or(0, |letter| u32::from(letter - b'A') + 1) << 1
            | u32::from(comet_orbit)
    }

    #[test]
    fn designations_unpack_to_their_text() {
        assert_eq!(
            designation(pack(1801, b'A', Some(b'A'), 0, false)),
            "A801 AA"
        );
        assert_eq!(
            designation(pack(1998, b'F', Some(b'V'), 113, false)),
            "1998 FV113"
        );
        assert_eq!(
            designation(pack(2002, b'P', Some(b'D'), 153, false)),
            "2002 PD153"
        );
        assert_eq!(designation(pack(2017, b'U', None, 1, false)), "2017 U1");
        assert_eq!(designation(pack(2017, b'U', None, 1, true)), "A/2017 U1");
        assert_eq!(
            designation(pack(1924, b'T', Some(b'D'), 0, false)),
            "A924 TD"
        );
        assert_eq!(
            designation(pack(1925, b'A', Some(b'A'), 0, false)),
            "1925 AA"
        );
        assert_eq!(designation(0x8000_0000 | 4109), "4109 P-L");
        assert_eq!(designation(0x8000_0000 | 3 << 14 | 12), "0012 T-3");
    }

    #[test]
    fn days_and_dates_go_both_ways() {
        assert_eq!(civil(0), (1970, 1, 1));
        assert_eq!(civil(20_613), (2026, 6, 9));
        assert_eq!(civil(-60_392), (1804, 8, 27));
        for date in ["1970-01-01", "2026-06-09", "1804-08-27", "2000-02-29"] {
            let (year, month, day) = civil(day_of(date).expect("a real day"));
            assert_eq!(format!("{year:04}-{month:02}-{day:02}"), date);
        }
        for not_a_day in [
            "2026-06-31",
            "2026-13-01",
            "2026-06",
            "2026-06-09-01",
            "today",
        ] {
            assert_eq!(day_of(not_a_day), None, "{not_a_day}");
        }
    }
}
