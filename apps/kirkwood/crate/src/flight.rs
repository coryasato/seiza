//! The sort flight: how far the dots are from their places in space to
//! their places in a against e ([`crate::layout`]). One number, 0 in space
//! and 1 landed, [`FLIGHT_MS`] end to end; the scene's vertex shader places
//! each dot by it (`web/src/scene.ts`, `FLIGHT`), so no buffer is rewritten
//! (`docs/DECISIONS.md`, "Scene", the sort flight).
//!
//! Like the clock, it's moved by whoever reads it ([`advance`]): the scene
//! each frame, and the interface while the dots fly.

use std::cell::Cell;

use crate::tween::{self, Tween};

/// The flight, end to end: the shader staggers the dots within it.
pub const FLIGHT_MS: f64 = 3000.0;

thread_local! {
    static FLIGHT: Cell<Tween> = const { Cell::new(Tween::REST) };
}

fn with<R>(change: impl FnOnce(&mut Tween) -> R) -> R {
    tween::with(&FLIGHT, change)
}

/// Moves the flight on to `now_ms` (the page clock) and returns its
/// progress.
pub fn advance(now_ms: f64) -> f64 {
    with(|flight| flight.advance(now_ms, FLIGHT_MS))
}

/// The flight's progress, as last moved: 0 in space, 1 landed.
pub fn progress() -> f64 {
    FLIGHT.get().progress()
}

/// Whether the dots are headed for a against e, or are there: the action
/// is pressed.
pub fn sorted() -> bool {
    FLIGHT.get().pressed()
}

/// Whether the dots are on their way, either way.
pub fn flying() -> bool {
    FLIGHT.get().moving()
}

/// How much of what isn't a row is left in the picture (the sky, the Sun,
/// Jupiter, its orbit, their names, the page's line about the stars): 1 in
/// space, 0 once the dots have landed, eased between.
pub fn space() -> f64 {
    1.0 - FLIGHT.get().eased()
}

/// The axes' opacity while the dots fly (board 3).
const AXES_FLYING: f64 = 0.45;
/// The part of the flight, at each end, that the axes and the words over
/// the landed dots come and go in.
const EDGE: f64 = 0.1;

/// How much of the axes shows (their lines, ticks, numbers, and labels):
/// nothing in space, [`AXES_FLYING`] while the dots fly, and whole once
/// they land, coming in over the flight's first tenth and whole over its
/// last.
pub fn axes() -> f64 {
    let k = progress();
    AXES_FLYING * (k / EDGE).min(1.0) + (1.0 - AXES_FLYING) * landing(k)
}

/// How much shows of what's said of the landed dots (the gaps' chips, the
/// groups' names, the line over the chips, the count of rows in view):
/// nothing until the flight's last tenth, whole landed.
pub fn landed() -> f64 {
    landing(progress())
}

fn landing(k: f64) -> f64 {
    // (From the landed end, so landed is 1 to the bit.)
    1.0 - ((1.0 - k) / EDGE).clamp(0.0, 1.0)
}

/// The press: the dots turn for a against e, or back for space, from
/// wherever they are.
pub fn toggle() {
    with(Tween::toggle);
}

/// Holds the flight at `progress`, for a screenshot of one moment of it
/// (`?flight=`): pressed past 0, and not flying.
pub fn hold(progress: f64) {
    with(|flight| flight.hold(progress));
}

#[cfg(test)]
mod tests {
    use super::{FLIGHT_MS, advance, axes, flying, hold, landed, progress, sorted, space, toggle};

    #[test]
    fn the_flight_takes_three_seconds_each_way_and_turns_where_it_is() {
        hold(0.0);
        assert!(!sorted() && !flying());
        assert_eq!(advance(0.0), 0.0);
        assert_eq!(advance(400.0), 0.0, "nothing moves until the press");
        toggle();
        assert!(sorted() && flying());
        // The press's own time doesn't count.
        assert_eq!(advance(1000.0), 0.0);
        assert!((advance(1300.0) - 0.1).abs() < 1e-12);
        // A reader a little behind the last one doesn't count twice.
        advance(1290.0);
        for step in 1..=4 {
            advance(1300.0 + 300.0 * f64::from(step));
        }
        assert!(
            (progress() - 0.5).abs() < 1e-12,
            "halfway at {FLIGHT_MS} ms end to end"
        );
        assert!((space() - 0.5).abs() < 1e-12);
        // Pressed again mid-flight: back from where it is, at the same rate.
        toggle();
        assert!(!sorted() && flying());
        advance(5000.0);
        assert!((advance(5300.0) - 0.4).abs() < 1e-12);
        toggle();
        advance(6000.0);
        // A stall isn't made up.
        assert!((advance(66_000.0) - (0.4 + 100.0 / FLIGHT_MS)).abs() < 1e-12);
        advance(66_400.0);
        advance(66_800.0);
        for step in 1..=10 {
            advance(66_800.0 + 400.0 * f64::from(step));
        }
        assert_eq!(progress(), 1.0, "landed, and no further");
        assert!(sorted() && !flying());
        assert_eq!(space(), 0.0);
        toggle();
        advance(80_000.0);
        for step in 1..=10 {
            advance(80_000.0 + 400.0 * f64::from(step));
        }
        assert_eq!(progress(), 0.0);
        assert!(!sorted() && !flying());
        assert_eq!(space(), 1.0);
    }

    #[test]
    fn a_held_flight_stays_where_its_put() {
        hold(0.45);
        assert!(sorted() && !flying());
        advance(0.0);
        assert_eq!(advance(5000.0), 0.45);
        hold(7.0);
        assert_eq!(progress(), 1.0);
        hold(f64::NAN);
        assert!(progress() == 0.0 && !flying() && !sorted());
        hold(0.0);
    }

    #[test]
    fn the_axes_are_dim_while_the_dots_fly_and_whole_once_they_land() {
        hold(0.0);
        assert_eq!((axes(), landed()), (0.0, 0.0));
        hold(0.05);
        assert!((axes() - 0.225).abs() < 1e-12 && landed() == 0.0);
        // Board 3: mid-flight the axes are at 0.45 and nothing is said yet.
        for mid in [0.1, 0.6, 0.85] {
            hold(mid);
            assert!((axes() - 0.45).abs() < 1e-12 && landed() == 0.0, "{mid}");
        }
        hold(0.95);
        assert!((axes() - 0.725).abs() < 1e-9 && (landed() - 0.5).abs() < 1e-9);
        hold(1.0);
        assert_eq!((axes(), landed()), (1.0, 1.0));
        hold(0.0);
    }
}
