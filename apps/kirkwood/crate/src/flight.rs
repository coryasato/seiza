//! The sort flight: how far the dots are from their places in space to
//! their places in a against e ([`crate::layout`]). One number, 0 in space
//! and 1 landed, [`FLIGHT_MS`] end to end; the scene's vertex shader places
//! each dot by it (`web/src/scene.ts`, `FLIGHT`), so no buffer is rewritten
//! (`docs/DECISIONS.md`, "Scene", the sort flight).
//!
//! Like the clock, it's moved by whoever reads it ([`advance`]): the scene
//! each frame, and the interface while the dots fly.

use std::cell::Cell;

/// The flight, end to end: the shader staggers the dots within it.
pub const FLIGHT_MS: f64 = 3000.0;
/// A gap between two readings past this is a stall (a tab back from the
/// background): the flight doesn't jump by the time it was away.
const STALL_MS: f64 = 500.0;
/// The most the flight moves after a stall.
const MAX_STEP_MS: f64 = 100.0;

#[derive(Clone, Copy)]
struct Flight {
    /// 0 in space, 1 landed, linear between.
    progress: f64,
    /// Where it's headed: 0 or 1 (or, held for a screenshot, where it is).
    to: f64,
    /// The page clock at the last reading; NaN before the first, and after
    /// a press, whose own time doesn't count.
    last_ms: f64,
}

thread_local! {
    static FLIGHT: Cell<Flight> = const {
        Cell::new(Flight {
            progress: 0.0,
            to: 0.0,
            last_ms: f64::NAN,
        })
    };
}

/// Moves the flight on to `now_ms` (the page clock) and returns its
/// progress.
pub fn advance(now_ms: f64) -> f64 {
    let mut flight = FLIGHT.get();
    if flight.progress != flight.to && !flight.last_ms.is_nan() {
        let step = now_ms - flight.last_ms;
        let step = if step > STALL_MS {
            MAX_STEP_MS
        } else {
            step.max(0.0)
        } / FLIGHT_MS;
        flight.progress = if flight.to > flight.progress {
            (flight.progress + step).min(flight.to)
        } else {
            (flight.progress - step).max(flight.to)
        };
    }
    // Its readers don't share a time source: a reading from before the
    // last one moves nothing, and mustn't be counted twice.
    flight.last_ms = flight.last_ms.max(now_ms);
    FLIGHT.set(flight);
    flight.progress
}

/// The flight's progress, as last moved: 0 in space, 1 landed.
pub fn progress() -> f64 {
    FLIGHT.get().progress
}

/// Whether the dots are headed for a against e, or are there: the action
/// is pressed.
pub fn sorted() -> bool {
    FLIGHT.get().to > 0.0
}

/// Whether the dots are on their way, either way.
pub fn flying() -> bool {
    let flight = FLIGHT.get();
    flight.progress != flight.to
}

/// How much of what isn't a row is left in the picture (the sky, the Sun,
/// Jupiter, its orbit, their names, the page's line about the stars): 1 in
/// space, 0 once the dots have landed, eased between.
pub fn space() -> f64 {
    let k = FLIGHT.get().progress;
    1.0 - k * k * (3.0 - 2.0 * k)
}

/// The press: the dots turn for a against e, or back for space, from
/// wherever they are.
pub fn toggle() {
    let flight = FLIGHT.get();
    FLIGHT.set(Flight {
        to: if flight.to > 0.0 { 0.0 } else { 1.0 },
        last_ms: f64::NAN,
        ..flight
    });
}

/// Holds the flight at `progress`, for a screenshot of one moment of it
/// (`?flight=`): pressed past 0, and not flying.
pub fn hold(progress: f64) {
    // (A NaN would never equal where it's headed, and fly forever.)
    let progress = if progress.is_nan() {
        0.0
    } else {
        progress.clamp(0.0, 1.0)
    };
    FLIGHT.set(Flight {
        progress,
        to: progress,
        last_ms: f64::NAN,
    });
}

#[cfg(test)]
mod tests {
    use super::{FLIGHT_MS, advance, flying, hold, progress, sorted, space, toggle};

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
}
