//! A pressed action's progress: one number, 0 at rest and 1 once it's
//! where the press sent it, linear between. The sort flight
//! ([`crate::flight`]) and the ride with Jupiter ([`crate::ride`]) are
//! each one of these.
//!
//! Like the clock, it's moved by whoever reads it ([`Tween::advance`]).

use std::cell::Cell;
use std::thread::LocalKey;

/// A gap between two readings past this is a stall (a tab back from the
/// background): the progress doesn't jump by the time it was away.
const STALL_MS: f64 = 500.0;
/// The most it moves after a stall, in time.
const MAX_STEP_MS: f64 = 100.0;

/// Changes the progress a module keeps in its thread's cell.
pub fn with<R>(cell: &'static LocalKey<Cell<Tween>>, change: impl FnOnce(&mut Tween) -> R) -> R {
    let mut tween = cell.get();
    let result = change(&mut tween);
    cell.set(tween);
    result
}

#[derive(Clone, Copy)]
pub struct Tween {
    /// 0 at rest, 1 where the press sends it, linear between.
    progress: f64,
    /// Where it's headed: 0 or 1 (or, held for a screenshot, where it is).
    to: f64,
    /// The page clock at the last reading; NaN before the first, and after
    /// a press, whose own time doesn't count.
    last_ms: f64,
}

impl Tween {
    pub const REST: Self = Self {
        progress: 0.0,
        to: 0.0,
        last_ms: f64::NAN,
    };

    /// Moves it on to `now_ms` (the page clock), `whole_ms` being the time
    /// from one end to the other, and returns its progress.
    pub fn advance(&mut self, now_ms: f64, whole_ms: f64) -> f64 {
        if self.progress != self.to && !self.last_ms.is_nan() {
            let step = now_ms - self.last_ms;
            let step = if step > STALL_MS {
                MAX_STEP_MS
            } else {
                step.max(0.0)
            } / whole_ms;
            self.progress = if self.to > self.progress {
                (self.progress + step).min(self.to)
            } else {
                (self.progress - step).max(self.to)
            };
        }
        // Its readers don't share a time source: a reading from before the
        // last one moves nothing, and mustn't be counted twice.
        self.last_ms = self.last_ms.max(now_ms);
        self.progress
    }

    /// Its progress, as last moved.
    pub fn progress(&self) -> f64 {
        self.progress
    }

    /// Its progress eased at both ends: 0 at rest, 1 where the press
    /// sends it.
    pub fn eased(&self) -> f64 {
        let k = self.progress;
        k * k * (3.0 - 2.0 * k)
    }

    /// Whether it's headed for 1, or is there: the action is pressed.
    pub fn pressed(&self) -> bool {
        self.to > 0.0
    }

    /// Whether it's on its way, either way.
    pub fn moving(&self) -> bool {
        self.progress != self.to
    }

    /// The press: it turns for the other end, from wherever it is.
    pub fn toggle(&mut self) {
        self.to = if self.to > 0.0 { 0.0 } else { 1.0 };
        self.last_ms = f64::NAN;
    }

    /// Holds it at `progress`, for a screenshot of one moment of it:
    /// pressed past 0, and not moving.
    pub fn hold(&mut self, progress: f64) {
        // (A NaN would never equal where it's headed, and move forever.)
        let progress = if progress.is_nan() {
            0.0
        } else {
            progress.clamp(0.0, 1.0)
        };
        *self = Self {
            progress,
            to: progress,
            last_ms: f64::NAN,
        };
    }
}
