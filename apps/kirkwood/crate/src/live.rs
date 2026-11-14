//! The live columns: a row's distance from the Sun and from Jupiter, au,
//! worked out when a cell is drawn, never held.
//!
//! Every live cell on screen shows one instant ([`shown`]): the clock's
//! years as the interface last set them ([`show`]), at the columns' own
//! rate, not as fast as the clock runs. So a cell holds still between two
//! refreshes whatever else redraws the table, and every cell of a frame
//! is of the same date. While time runs a cell is written to fewer
//! decimals ([`decimals`]): the rest would be new at every refresh
//! (`docs/DECISIONS.md`, "Table").
//!
//! A row's place is where its dot is: on its ellipse, or for a Hilda or a
//! Trojan where the integration has it, moved there from the epoch on its
//! own ([`crate::integrate::place_of`]) and kept for the instant shown.

use std::cell::{Cell, RefCell};
use std::collections::HashMap;

use crate::elements::Elements;
use crate::integrate;
use crate::orbit::{JUPITER, Orbit};

/// The decimals of a live cell while time holds still: all of them exact.
pub const DECIMALS: u8 = 3;
/// And while time runs. At a year a second a main-belt row's distance
/// moves by up to a quarter of an au between two refreshes: the first
/// decimal is the last one a reader can follow.
pub const MOVING_DECIMALS: u8 = 1;
/// The columns' refreshes a second, unless the page's `?live=` says.
pub const REFRESHES_A_SECOND: f64 = 2.0;

/// What a live column measures a row's distance from.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Live {
    Sun,
    Jupiter,
}

impl Live {
    /// The live columns, in the table's order.
    pub const ALL: [Self; 2] = [Self::Sun, Self::Jupiter];

    /// The column's name, spelled as the sample spells its own.
    pub fn name(self) -> &'static str {
        match self {
            Self::Sun => "sun_au",
            Self::Jupiter => "jupiter_au",
        }
    }
}

/// The most rows whose places are kept for one instant: a few screens'
/// worth. Paused, a reader can scroll through every row; past this the
/// places kept are let go and worked out again as they're drawn.
const KEPT: usize = 4096;

thread_local! {
    /// The instant the live cells show: the clock's years, and whether
    /// time was running.
    static SHOWN: Cell<(f64, bool)> = const { Cell::new((0.0, false)) };
    /// The drawn rows' places at the instant shown, by row: the table
    /// draws far more often than the instant moves (a scroll, a hover,
    /// the panel's slide), and a row's orbit is solved, or a Hilda moved
    /// from the epoch, once an instant, not once a frame.
    static PLACES: RefCell<HashMap<u32, Option<[f64; 3]>>> = RefCell::new(HashMap::new());
    /// Jupiter's place at the years it was last worked out for: the
    /// instant shown, once the first cell of it is drawn.
    static GIANT: Cell<(f64, [f64; 3])> = const { Cell::new((f64::NAN, [0.0; 3])) };
}

/// The live cells show `years` from now on, written as moving or not.
/// Whether that changed anything: the table is drawn again if so.
pub fn show(years: f64, moving: bool) -> bool {
    let (shown, was_moving) = SHOWN.get();
    if shown == years && was_moving == moving {
        return false;
    }
    SHOWN.set((years, moving));
    if shown != years {
        PLACES.with_borrow_mut(HashMap::clear);
    }
    true
}

/// The instant the live cells show: its years, and whether time ran.
pub fn shown() -> (f64, bool) {
    SHOWN.get()
}

/// The decimals a live cell is written to now.
pub fn decimals() -> u8 {
    if SHOWN.get().1 {
        moving_decimals()
    } else {
        DECIMALS
    }
}

/// The decimals of a moving cell: [`MOVING_DECIMALS`], or the page's
/// `?liveDecimals=`, for looking.
fn moving_decimals() -> u8 {
    thread_local! {
        static ASKED: u8 = seiza::url::param("liveDecimals")
            .and_then(|decimals| decimals.parse().ok())
            .map_or(MOVING_DECIMALS, |decimals: u8| decimals.min(DECIMALS));
    }
    ASKED.with(|asked| *asked)
}

/// A row's live cell at the instant shown: its distance, au. Nothing for
/// a row with no ellipse, which has no place.
pub fn value(elements: &Elements, row: usize, live: Live) -> Option<f64> {
    let years = SHOWN.get().0;
    let place = PLACES.with_borrow_mut(|places| {
        if places.len() >= KEPT {
            places.clear();
        }
        *places
            .entry(row as u32)
            .or_insert_with(|| place(elements, row, years))
    })?;
    let (at, mut giant) = GIANT.get();
    if at != years {
        giant = JUPITER.place(years);
        GIANT.set((years, giant));
    }
    Some(distance(place, live, giant))
}

/// A row's distance at `years` from what a column measures from, worked
/// out afresh: what the checks set a cell against, for any instant.
pub fn at(elements: &Elements, row: usize, live: Live, years: f64) -> Option<f64> {
    Some(distance(
        place(elements, row, years)?,
        live,
        JUPITER.place(years),
    ))
}

/// Where a row is at `years`: a Hilda or a Trojan where the integration
/// has it, moved there from the epoch on its own, and any other row (or
/// one of those at a time the integration doesn't reach) on its ellipse,
/// as the scene draws it. Nothing for a row with no ellipse.
fn place(elements: &Elements, row: usize, years: f64) -> Option<[f64; 3]> {
    elements
        .grouped()
        .binary_search(&(row as u32))
        .ok()
        .and_then(|_| integrate::place_of(elements, row, years))
        .or_else(|| Some(Orbit::of_row(elements, row)?.place(years)))
}

/// How far `place` is from what a column measures from, with Jupiter at
/// `giant`.
fn distance(place: [f64; 3], live: Live, giant: [f64; 3]) -> f64 {
    let from = match live {
        Live::Sun => [0.0; 3],
        Live::Jupiter => giant,
    };
    (0..3)
        .map(|axis| (place[axis] - from[axis]).powi(2))
        .sum::<f64>()
        .sqrt()
}

#[cfg(test)]
mod tests {
    use super::{DECIMALS, Live, at, decimals, show, shown, value};
    use crate::orbit::tests::elements_file;
    use crate::orbit::{JUPITER, Orbit};

    #[test]
    fn a_moving_cell_drops_decimals_and_a_still_one_has_them_all() {
        assert!(show(1.5, true));
        assert!(decimals() < DECIMALS);
        // (The same instant again changes nothing.)
        assert!(!show(1.5, true));
        assert!(show(1.5, false));
        assert_eq!(decimals(), DECIMALS);
        assert_eq!(shown(), (1.5, false));
    }

    /// On the real files (`just kirkwood test`): a cell is the distance of
    /// the row's own place, a Trojan's the integrated one, and it holds to
    /// the instant shown.
    #[test]
    #[ignore = "reads data/elements.bin"]
    fn a_live_cell_is_the_rows_place_at_the_instant_shown() {
        let elements = elements_file();
        let years = 12.25;
        show(years, false);
        // Ceres: on its ellipse.
        let ceres = Orbit::of_row(&elements, 0).expect("Ceres").place(years);
        let sun = ceres.iter().map(|x| x * x).sum::<f64>().sqrt();
        assert_eq!(value(&elements, 0, Live::Sun), Some(sun));
        assert!((2.5..3.0).contains(&sun), "Ceres is {sun} au out");
        let jupiter = JUPITER.place(years);
        let apart = (0..3)
            .map(|axis| (ceres[axis] - jupiter[axis]).powi(2))
            .sum::<f64>()
            .sqrt();
        assert_eq!(value(&elements, 0, Live::Jupiter), Some(apart));
        // A row of the two groups: where the integration has it, the same
        // asked twice, and what `at` says for that instant.
        let grouped = elements.grouped()[0] as usize;
        let first = value(&elements, grouped, Live::Sun).expect("a place");
        assert_eq!(value(&elements, grouped, Live::Sun), Some(first));
        assert_eq!(at(&elements, grouped, Live::Sun, years), Some(first));
        let ellipse = Orbit::of_row(&elements, grouped)
            .expect("an ellipse")
            .place(years);
        let on_ellipse = ellipse.iter().map(|x| x * x).sum::<f64>().sqrt();
        assert_ne!(
            first, on_ellipse,
            "the row is integrated, not on its ellipse"
        );
        // Until the instant moves.
        show(years + 1.0, false);
        assert_ne!(value(&elements, grouped, Live::Sun), Some(first));
    }
}
