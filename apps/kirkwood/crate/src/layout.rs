//! a against e: the axes the sort flight lands the dots on. Orbit size
//! across and eccentricity up, where the gaps at Jupiter's resonances open
//! (`docs/DECISIONS.md`, "Scene", the sort flight).
//!
//! The scene's shader lands each dot by these numbers (it's handed the
//! axes and the plot, `web.rs`), and its arithmetic is run in 32-bit floats
//! against [`Plot::place`] for every row in view (`shader.rs`).

use crate::orbit::JUPITER;

/// The orbit sizes across the plot, au, and the eccentricities up it.
pub const A: [f64; 2] = [1.5, 5.5];
pub const E: [f64; 2] = [0.0, 0.6];

/// How far the plot keeps from the edges of what the panel leaves, CSS px:
/// in a 1440×900 window, a from 80 px to 1360 and e from 771 px up to 96.
const LEFT: f64 = 80.0;
const RIGHT: f64 = 80.0;
const TOP: f64 = 96.0;
const BOTTOM: f64 = 129.0;

/// The gaps: an orbit there turns `.0` times while Jupiter turns `.1`.
pub const GAPS: [(u32, u32); 4] = [(3, 1), (5, 2), (7, 3), (2, 1)];

/// Whether a row has a place on the axes: its a and its e are both on
/// them. In 32-bit floats, as the file holds them and the shader compares
/// them (the axes' ends as the floats it's handed), so the rows counted in
/// view are the rows drawn there.
pub fn in_view(a: f32, e: f32) -> bool {
    a >= A[0] as f32 && a <= A[1] as f32 && e >= E[0] as f32 && e <= E[1] as f32
}

/// The orbit size of each gap, au: where Jupiter's own a puts an orbit in
/// step with it, by Kepler's third law.
pub fn gaps() -> [f64; 4] {
    GAPS.map(|(turns, jupiters)| JUPITER.in_step(turns, jupiters))
}

/// Where the axes are in a window: CSS px.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Plot {
    /// Where the least a is, and the most.
    pub left: f64,
    pub right: f64,
    /// Where the most e is, and the least.
    pub top: f64,
    pub bottom: f64,
}

impl Plot {
    /// The plot in a window `width` by `height`, its right `inset` px
    /// under the panel.
    pub fn in_window(width: f64, height: f64, inset: f64) -> Self {
        Self {
            left: LEFT,
            // A window too small for the insets still has a plot: a pixel.
            right: (width - inset - RIGHT).max(LEFT + 1.0),
            top: TOP,
            bottom: (height - BOTTOM).max(TOP + 1.0),
        }
    }

    /// The plot as the scene's shader takes it, in the clip space of a
    /// window `width` by `height`: the x of the least a and the y of the
    /// least e, then those of the most.
    pub fn clip(&self, width: f64, height: f64) -> [f32; 4] {
        let x = |px: f64| (2.0 * px / width - 1.0) as f32;
        let y = |px: f64| (1.0 - 2.0 * px / height) as f32;
        [x(self.left), y(self.bottom), x(self.right), y(self.top)]
    }

    /// Where an orbit of size `a` and eccentricity `e` is: x and y, on the
    /// axes or past them.
    pub fn place(&self, a: f64, e: f64) -> [f64; 2] {
        [
            self.left + (self.right - self.left) * (a - A[0]) / (A[1] - A[0]),
            self.bottom + (self.top - self.bottom) * (e - E[0]) / (E[1] - E[0]),
        ]
    }
}

#[cfg(test)]
mod tests {
    use super::{Plot, gaps, in_view};

    #[test]
    fn the_axes_are_the_boards() {
        // Boards 3 and 4, at 1440×900: a 1.5 at 80 px and 5.5 at 1360, e 0
        // at 771 px and 0.6 at 96, and a tick every half au and tenth.
        let plot = Plot::in_window(1440.0, 900.0, 0.0);
        assert_eq!(plot.place(1.5, 0.0), [80.0, 771.0]);
        assert_eq!(plot.place(5.5, 0.6), [1360.0, 96.0]);
        // (The board's e ticks are drawn a pixel above their places.)
        let near =
            |at: [f64; 2], x: f64, y: f64| (at[0] - x).abs() <= 1.0 && (at[1] - y).abs() <= 1.0;
        assert!(near(plot.place(2.5, 0.1), 400.0, 658.0));
        assert!(near(plot.place(4.0, 0.5), 880.0, 208.0));
        // With the panel open the axes sit in what it leaves.
        let beside = Plot::in_window(1440.0, 900.0, 560.0);
        assert_eq!(beside.place(1.5, 0.0), [80.0, 771.0]);
        assert_eq!(beside.place(5.5, 0.6), [800.0, 96.0]);
        // In clip space the window runs from -1 to 1, y up.
        let clip = plot.clip(1440.0, 900.0);
        let close = |a: f32, b: f64| (f64::from(a) - b).abs() < 1e-6;
        assert!(close(clip[0], 80.0 / 720.0 - 1.0) && close(clip[2], 1360.0 / 720.0 - 1.0));
        assert!(close(clip[1], 1.0 - 771.0 / 450.0) && close(clip[3], 1.0 - 96.0 / 450.0));
        // No window is too small to have a plot.
        let tiny = Plot::in_window(100.0, 100.0, 0.0);
        assert!(tiny.right > tiny.left && tiny.bottom > tiny.top);
    }

    #[test]
    fn a_row_is_in_view_when_its_a_and_e_are_on_the_axes() {
        assert!(in_view(2.77, 0.08));
        assert!(in_view(1.5, 0.0) && in_view(5.5, 0.6));
        assert!(!in_view(1.49, 0.1) && !in_view(5.51, 0.1));
        assert!(!in_view(2.5, 0.61));
        assert!(!in_view(f32::NAN, 0.1) && !in_view(2.5, f32::NAN));
    }

    #[test]
    fn the_gaps_are_where_jupiter_puts_them() {
        // Board 4's chips: 3:1 at 2.50 au, 5:2 at 2.82 (the board writes
        // 2.83 on its chip's label), 7:3 at 2.96, 2:1 at 3.28.
        for (gap, known) in gaps().into_iter().zip([2.50, 2.82, 2.96, 3.28]) {
            assert!((gap - known).abs() < 0.006, "{gap} au, not {known}");
        }
    }
}
