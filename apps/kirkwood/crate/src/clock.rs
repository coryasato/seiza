//! The clock: years since the elements' epoch, one a second while it runs.
//!
//! It's moved by whoever reads it ([`advance`]), never by one reader's
//! frames alone: the scene each frame, the date at its own rate, and
//! whatever else shows the time. A year is one turn of a 1 au orbit
//! ([`YEAR_DAYS`]), so a row's mean anomaly needs no offset and its period
//! is its a^1.5.
//!
//! It goes from 1976-06-09 to 2076-06-09 and no further ([`reach`]): a
//! row's place is its 2026 ellipse, a picture of the belt and not a
//! forecast that far out (`docs/DECISIONS.md`, "Scene"). At the last day it
//! stops; run again, it starts over from the day it opened on.

use std::cell::Cell;

use crate::elements::{EPOCH_JD, YEAR_DAYS};
use crate::rows::civil;

/// Days from 1970-01-01 to the elements' epoch: the clock's zero.
const EPOCH_DAY: f64 = EPOCH_JD - 2_440_587.5;
/// The clock's years in a second while it runs: what the time control says.
const YEARS_A_SECOND: f64 = 1.0;
/// How far the clock goes each way from the epoch, in days: back to
/// 1976-06-09 and on to 2076-06-09, the span the files' places were
/// checked over (`data/horizons.json`).
const REACH_BACK_DAYS: f64 = 18_262.0;
const REACH_ON_DAYS: f64 = 18_263.0;
/// A gap between two readings past this is a stall (a tab back from the
/// background): the clock doesn't jump by the time it was away.
const STALL_MS: f64 = 500.0;
/// The most the clock moves after a stall.
const MAX_STEP_MS: f64 = 100.0;

#[derive(Clone, Copy)]
struct Clock {
    years: f64,
    /// Where it opened: where it starts over from.
    opened: f64,
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
        Cell::new(Clock {
            years: 0.0,
            opened: 0.0,
            running: true,
            held: true,
            last_ms: f64::NAN,
        })
    };
}

/// The first and last of the clock's years.
pub fn reach() -> (f64, f64) {
    (-REACH_BACK_DAYS / YEAR_DAYS, REACH_ON_DAYS / YEAR_DAYS)
}

/// Starts the clock `day` days after 1970-01-01 (or at the nearest day it
/// reaches), running or not.
pub fn start(day: f64, running: bool) {
    let (first, last) = reach();
    let years = ((day - EPOCH_DAY) / YEAR_DAYS).clamp(first, last);
    CLOCK.set(Clock {
        years,
        opened: years,
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
        // The last day: the clock stops there.
        let last = reach().1;
        if clock.years >= last {
            clock.years = last;
            clock.running = false;
        }
    }
    // Its readers don't share a time source (a frame's own timestamp is
    // earlier than the page clock read inside that frame): a reading from
    // before the last one moves nothing, and mustn't be counted twice.
    clock.last_ms = clock.last_ms.max(now_ms);
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

/// Whether the clock stands at its last day, with nowhere on to run.
pub fn ended() -> bool {
    CLOCK.get().years >= reach().1
}

/// Where the clock starts over from, run again at its last day: the day it
/// opened on, or the epoch if that was the last day itself.
pub fn starts_over_at() -> f64 {
    let opened = CLOCK.get().opened;
    if opened < reach().1 { opened } else { 0.0 }
}

/// Runs or pauses, from now. Run at the last day, it starts over
/// ([`starts_over_at`]).
pub fn set_running(running: bool) {
    let clock = CLOCK.get();
    let years = if running && ended() {
        starts_over_at()
    } else {
        clock.years
    };
    CLOCK.set(Clock {
        years,
        running,
        last_ms: f64::NAN,
        ..clock
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
    use super::{
        EPOCH_DAY, advance, date, ended, reach, release, running, set_running, start, years,
    };
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
        // A reader a little behind the last one doesn't make time count twice.
        advance(70_098.0);
        assert!((advance(70_200.0) - 0.55).abs() < 1e-12);
    }

    #[test]
    fn the_clock_stops_at_its_last_day_and_starts_over() {
        let (first, last) = reach();
        assert_eq!(date(first), "1976 Jun 09");
        assert_eq!(date(last), "2076 Jun 09");
        // A day past either end opens on the end.
        start(-40_000.0, true);
        assert_eq!(years(), first);
        start(EPOCH_DAY + 1e6, true);
        assert_eq!(years(), last);
        // Half a second short of the last day.
        start(EPOCH_DAY + (last - 0.5) * YEAR_DAYS, true);
        release();
        let opened = years();
        advance(0.0);
        assert!(advance(400.0) < last && running() && !ended());
        assert_eq!(advance(800.0), last);
        assert!(ended() && !running());
        assert_eq!(advance(1200.0), last, "stopped");
        // Run again: from the day it opened on.
        set_running(true);
        assert!(running() && !ended());
        assert_eq!(years(), opened);
        advance(2000.0);
        assert!((advance(2100.0) - (opened + 0.1)).abs() < 1e-12);
    }
}
