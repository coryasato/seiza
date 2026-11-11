//! The clock: years since the elements' epoch, one a second while it runs.
//!
//! It's moved by whoever reads it ([`advance`]), never by one reader's
//! frames alone: the date at its own rate, and whatever else shows the time.
//! A year is one turn of a 1 au orbit ([`YEAR_DAYS`]), so a row's mean
//! anomaly needs no offset and its period is its a^1.5.

use std::cell::Cell;

use crate::elements::{EPOCH_JD, YEAR_DAYS};
use crate::rows::civil;

/// Days from 1970-01-01 to the elements' epoch: the clock's zero.
const EPOCH_DAY: f64 = EPOCH_JD - 2_440_587.5;
/// The clock's years in a second while it runs: what the time control says.
const YEARS_A_SECOND: f64 = 1.0;
/// A gap between two readings past this is a stall (a tab back from the
/// background): the clock doesn't jump by the time it was away.
const STALL_MS: f64 = 500.0;
/// The most the clock moves after a stall.
const MAX_STEP_MS: f64 = 100.0;

#[derive(Clone, Copy)]
struct Clock {
    years: f64,
    running: bool,
    /// Held until there's something to move: the asteroids are still
    /// arriving. The time control's own state is kept under it.
    held: bool,
    /// The page clock at the last reading; NaN before the first, and after
    /// a change that the time meanwhile mustn't count toward.
    last_ms: f64,
}

thread_local! {
    static CLOCK: Cell<Clock> = const {
        Cell::new(Clock { years: 0.0, running: true, held: true, last_ms: f64::NAN })
    };
}

/// Starts the clock `day` days after 1970-01-01, running or not.
pub fn start(day: f64, running: bool) {
    CLOCK.set(Clock {
        years: (day - EPOCH_DAY) / YEAR_DAYS,
        running,
        ..CLOCK.get()
    });
}

/// Moves the clock on to `now_ms` (the page clock) and returns its years.
pub fn advance(now_ms: f64) -> f64 {
    let mut clock = CLOCK.get();
    if moves() && !clock.last_ms.is_nan() {
        let step = now_ms - clock.last_ms;
        let step = if step > STALL_MS {
            MAX_STEP_MS
        } else {
            step.max(0.0)
        };
        clock.years += step / 1000.0 * YEARS_A_SECOND;
    }
    clock.last_ms = now_ms;
    CLOCK.set(clock);
    clock.years
}

/// The clock's years, as last moved.
pub fn years() -> f64 {
    CLOCK.get().years
}

/// Whether the time control is set to run.
pub fn running() -> bool {
    CLOCK.get().running
}

/// Whether the clock is held for the asteroids.
pub fn held() -> bool {
    CLOCK.get().held
}

/// Whether time is passing.
pub fn moves() -> bool {
    let clock = CLOCK.get();
    clock.running && !clock.held
}

/// Runs or pauses, from now.
pub fn set_running(running: bool) {
    CLOCK.set(Clock {
        running,
        last_ms: f64::NAN,
        ..CLOCK.get()
    });
}

/// Lets go of the hold, from now.
pub fn release() {
    CLOCK.set(Clock {
        held: false,
        last_ms: f64::NAN,
        ..CLOCK.get()
    });
}

/// The date `years` after the elements' epoch, as the time control shows
/// it: `2026 Nov 11`.
pub fn date(years: f64) -> String {
    const MONTHS: [&str; 12] = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    // A day's floor, clear of the float's last digit at a whole day.
    let (year, month, day) = civil((EPOCH_DAY + years * YEAR_DAYS + 1e-6).floor() as i64);
    format!("{year} {} {day:02}", MONTHS[(month - 1) as usize])
}

#[cfg(test)]
mod tests {
    use super::{EPOCH_DAY, advance, date, release, set_running, start, years};
    use crate::elements::YEAR_DAYS;

    #[test]
    fn the_date_counts_from_the_epoch() {
        assert_eq!(date(0.0), "2026 Jun 09");
        assert_eq!(date(1.0 / YEAR_DAYS), "2026 Jun 10");
        assert_eq!(date(-EPOCH_DAY / YEAR_DAYS), "1970 Jan 01");
    }

    #[test]
    fn the_clock_runs_a_year_a_second_once_released() {
        start(EPOCH_DAY, true);
        advance(0.0);
        assert_eq!(advance(400.0), 0.0, "held while the asteroids arrive");
        release();
        advance(1000.0);
        assert!((advance(1250.0) - 0.25).abs() < 1e-12);
        // A stall isn't made up.
        assert!((advance(61_250.0) - 0.35).abs() < 1e-12);
        set_running(false);
        advance(61_300.0);
        assert!((advance(62_000.0) - 0.35).abs() < 1e-12);
        set_running(true);
        // The pause's own time doesn't count once it runs again.
        advance(70_000.0);
        assert!((advance(70_100.0) - 0.45).abs() < 1e-12);
        assert!((years() - 0.45).abs() < 1e-12);
    }
}
