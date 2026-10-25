//! The flash (`live` with `custom-cells`): a cell whose value a re-read
//! changed is drawn over its fill in a column's flash ramp, faded by
//! opacity to nothing (`docs/DECISIONS.md`, "Features"). The changes are
//! found off the frame, when a re-read lands, by comparing the old page with
//! the new in the rows invalidated before its read started; the live
//! flashes are kept here, each removed once it ends.

use std::collections::HashMap;
use std::time::Duration;

use gpui_kit::{App, Task};

use crate::delegate::CellValue;

/// Where a change flashes in its column's ramp, or `None` for no change: a
/// float's rise at 1, its fall at 0, any other change (text, NULL to a
/// value or back, NaN to a number or back) at 0.5. Two NaNs are equal, so a
/// NaN cell doesn't flash on every read; so are 0 and -0.
pub(crate) fn change(old: Option<CellValue<'_>>, new: Option<CellValue<'_>>) -> Option<f32> {
    let float = |value: &Option<CellValue<'_>>| match value {
        Some(CellValue::Float(value)) => Some(*value),
        Some(CellValue::Float32(value)) => Some(f64::from(*value)),
        _ => None,
    };
    match (float(&old), float(&new)) {
        (Some(old), Some(new)) if old.is_nan() && new.is_nan() => None,
        (Some(old), Some(new)) if new > old => Some(1.0),
        (Some(old), Some(new)) if new < old => Some(0.0),
        (Some(old), Some(new)) if new == old => None,
        (Some(_), Some(_)) => Some(0.5),
        _ => (old != new).then_some(0.5),
    }
}

/// A flash's opacity `elapsed` into its `duration`, faded to nothing, or
/// `None` once it's over. Under reduced motion it holds at 1, no fade.
pub(crate) fn opacity(elapsed: Duration, duration: Duration, reduce_motion: bool) -> Option<f32> {
    if elapsed >= duration {
        return None;
    }
    if reduce_motion {
        return Some(1.0);
    }
    // In f64, as a DOM contender's JS computes it: in f32, 1 − 0.9 rounds
    // to an alpha of 26 where JS draws 25.
    Some((1.0 - elapsed.as_secs_f64() / duration.as_secs_f64()) as f32)
}

/// The flash fixture's negative controls (`fixtures/paint.json`, `flash`).
#[cfg(test)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub(crate) enum Control {
    #[default]
    None,
    /// The fade runs from nothing to full.
    FadeBackwards,
    /// A fall flashes as a rise.
    FallAsRise,
}

#[derive(Debug, Clone, Copy)]
struct Flash {
    /// Its place in the column's ramp.
    at: f32,
    /// When it started, on [`Flashes::now`]'s clock, and how long it lasts.
    start: Duration,
    duration: Duration,
}

/// The live flashes, by (row, column).
#[derive(Default)]
pub(crate) struct Flashes {
    live: HashMap<(u64, usize), Flash>,
    /// GPUI's clock (`BackgroundExecutor::now`, the test clock in tests),
    /// as the time since the first reading: its `Instant` isn't public.
    clock: Option<Box<dyn Fn() -> Duration>>,
    /// Under reduced motion, no frames are asked for: the timer that
    /// redraws when the next held flash ends, and when that is.
    pub(crate) timer: Option<(Duration, Task<()>)>,
    /// The last frame drew a flash, fading: it asks for the next one.
    pub(crate) animating: bool,
    #[cfg(test)]
    pub(crate) control: Control,
}

impl Flashes {
    pub(crate) fn is_empty(&self) -> bool {
        self.live.is_empty()
    }

    #[cfg(test)]
    pub(crate) fn len(&self) -> usize {
        self.live.len()
    }

    /// The columns changed: their flashes go.
    pub(crate) fn clear(&mut self) {
        self.live.clear();
        self.timer = None;
    }

    pub(crate) fn now(&mut self, cx: &App) -> Duration {
        let clock = self.clock.get_or_insert_with(|| {
            let executor = cx.background_executor().clone();
            let epoch = executor.now();
            Box::new(move || executor.now().duration_since(epoch))
        });
        clock()
    }

    /// `row`'s cell in `column` changed at `now`: it flashes at `at` for
    /// `duration`, from the start again if it was flashing.
    pub(crate) fn start(
        &mut self,
        row: u64,
        column: usize,
        at: f32,
        now: Duration,
        duration: Duration,
    ) {
        #[cfg(test)]
        let at = if self.control == Control::FallAsRise && at == 0.0 {
            1.0
        } else {
            at
        };
        self.live.insert(
            (row, column),
            Flash {
                at,
                start: now,
                duration,
            },
        );
    }

    /// Drops the flashes that ended by `now`, on screen or not.
    pub(crate) fn expire(&mut self, now: Duration) {
        self.live
            .retain(|_, flash| now < flash.start + flash.duration);
    }

    /// The cell's flash at `now`: its place in the ramp and its opacity.
    pub(crate) fn at(
        &self,
        row: u64,
        column: usize,
        now: Duration,
        reduce_motion: bool,
    ) -> Option<(f32, f32)> {
        let flash = self.live.get(&(row, column))?;
        let elapsed = now.saturating_sub(flash.start);
        let opacity = opacity(elapsed, flash.duration, reduce_motion)?;
        #[cfg(test)]
        let opacity = if self.control == Control::FadeBackwards {
            1.0 - opacity
        } else {
            opacity
        };
        Some((flash.at, opacity))
    }

    /// When the next flash ends, if any is live.
    pub(crate) fn next_end(&self) -> Option<Duration> {
        self.live
            .values()
            .map(|flash| flash.start + flash.duration)
            .min()
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::{change, opacity};
    use crate::delegate::CellValue;

    #[test]
    fn changes() {
        let float = |value: f64| Some(CellValue::Float(value));
        assert_eq!(change(float(1.0), float(2.0)), Some(1.0));
        assert_eq!(change(float(2.0), float(1.0)), Some(0.0));
        assert_eq!(change(float(1.0), float(1.0)), None);
        assert_eq!(change(float(0.0), float(-0.0)), None);
        assert_eq!(change(float(f64::NAN), float(f64::NAN)), None);
        assert_eq!(change(float(f64::NAN), float(1.0)), Some(0.5));
        assert_eq!(change(Some(CellValue::Float32(1.0)), float(1.5)), Some(1.0));
        assert_eq!(change(Some(CellValue::Null), float(1.0)), Some(0.5));
        assert_eq!(
            change(
                Some(CellValue::Text("a".into())),
                Some(CellValue::Text("b".into()))
            ),
            Some(0.5)
        );
        assert_eq!(
            change(
                Some(CellValue::Text("a".into())),
                Some(CellValue::Text("a".into()))
            ),
            None
        );
        assert_eq!(change(None, None), None);
    }

    #[test]
    fn fades() {
        let second = Duration::from_secs(1);
        assert_eq!(opacity(Duration::ZERO, second, false), Some(1.0));
        assert_eq!(
            opacity(Duration::from_millis(250), second, false),
            Some(0.75)
        );
        assert_eq!(opacity(second, second, false), None);
        assert_eq!(opacity(Duration::from_millis(999), second, true), Some(1.0));
        assert_eq!(opacity(second, second, true), None);
        assert_eq!(opacity(Duration::ZERO, Duration::ZERO, false), None);
    }
}
