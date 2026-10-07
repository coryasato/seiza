//! What the table did over the last few seconds, for the perf panel: how
//! fast the rows moved, and how many frames found every visible row loaded.

use std::collections::VecDeque;

/// One drawn frame: when (ms from `timeOrigin`), the top row, and whether
/// every visible row was loaded.
#[derive(Debug, Clone, Copy, PartialEq)]
struct Frame {
    at: f64,
    top: f64,
    filled: bool,
}

/// The frames drawn in the last `window_ms`.
#[derive(Debug, Clone)]
pub struct Activity {
    window_ms: f64,
    frames: VecDeque<Frame>,
}

/// [`Activity`] summarized at one moment.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ActivityStats {
    /// Rows scrolled per second: the distance the top row moved (either way)
    /// over the window, divided by the window.
    pub rows_per_s: f64,
    /// Frames drawn in the window, and how many had every visible row loaded
    /// (a cache hit, as the reader sees it).
    pub frames: usize,
    pub filled_frames: usize,
}

impl Activity {
    pub fn new(window_ms: f64) -> Self {
        Self {
            window_ms,
            frames: VecDeque::new(),
        }
    }

    pub fn record(&mut self, at: f64, top: f64, filled: bool) {
        self.frames.push_back(Frame { at, top, filled });
        self.trim(at);
    }

    pub fn clear(&mut self) {
        self.frames.clear();
    }

    /// The window ending at `now`.
    pub fn stats(&mut self, now: f64) -> ActivityStats {
        self.trim(now);
        let moved: f64 = self
            .frames
            .iter()
            .zip(self.frames.iter().skip(1))
            .map(|(before, after)| (after.top - before.top).abs())
            .sum();
        ActivityStats {
            rows_per_s: moved / (self.window_ms / 1000.0),
            frames: self.frames.len(),
            filled_frames: self.frames.iter().filter(|frame| frame.filled).count(),
        }
    }

    fn trim(&mut self, now: f64) {
        while self
            .frames
            .front()
            .is_some_and(|frame| now - frame.at > self.window_ms)
        {
            self.frames.pop_front();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rate_is_distance_over_the_window() {
        let mut activity = Activity::new(2_000.0);
        // 60 frames a second for 2 s, 30 rows a frame, down then up.
        for frame in 0..=120 {
            let at = f64::from(frame) * 1000.0 / 60.0;
            let top = if frame <= 60 {
                frame * 30
            } else {
                (120 - frame) * 30
            };
            activity.record(at, f64::from(top), frame % 4 != 0);
        }
        let stats = activity.stats(2_000.0);
        assert_eq!(stats.frames, 121);
        assert!((stats.rows_per_s - 1_800.0).abs() < 1e-9);
        assert_eq!(stats.filled_frames, 90);
    }

    #[test]
    fn old_frames_leave_the_window() {
        let mut activity = Activity::new(2_000.0);
        activity.record(0.0, 0.0, true);
        activity.record(100.0, 500.0, false);
        let stats = activity.stats(2_050.0);
        assert_eq!((stats.frames, stats.filled_frames), (1, 0));
        assert_eq!(stats.rows_per_s, 0.0);
        assert_eq!(activity.stats(5_000.0).frames, 0);
    }
}
