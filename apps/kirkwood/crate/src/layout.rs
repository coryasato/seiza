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

/// A tick on each axis, and its number: every half au, every tenth.
const TICK_A: f64 = 0.5;
const TICK_E: f64 = 0.1;

/// The groups in step with Jupiter that the axes name: the name, the turns
/// of an orbit there to Jupiter's, and the eccentricity the name sits at,
/// over the group's own dots (board 4).
pub const GROUPS: [(&str, (u32, u32), f64); 2] = [
    ("Hildas, 3:2", (3, 2), 0.329),
    ("Trojans, 1:1", (1, 1), 0.233),
];

/// A gap's chip, CSS px: its width and height, and the least room between
/// two of them.
pub const CHIP: [f64; 2] = [35.0, 24.0];
const CHIP_APART: f64 = 4.0;
/// How far under the plot's top the chips' tops are, the line over them,
/// and the top of the line each drops into the dots; and that line's
/// length (board 4, where the plot's top is at 96 px).
pub const CHIPS_TOP: f64 = 110.0;
pub const CHIPS_LINE_TOP: f64 = 82.0;
pub const DROP_TOP: f64 = 136.0;
pub const DROP: f64 = 150.0;

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

impl Plot {
    /// The ticks along a: each one's orbit size, au, and its x.
    pub fn ticks_a(&self) -> Vec<(f64, f64)> {
        let steps = ((A[1] - A[0]) / TICK_A).round() as u32;
        (0..=steps)
            .map(|step| A[0] + TICK_A * f64::from(step))
            .map(|a| (a, self.place(a, E[0])[0]))
            .collect()
    }

    /// The ticks up e: each one's eccentricity and its y.
    pub fn ticks_e(&self) -> Vec<(f64, f64)> {
        let steps = ((E[1] - E[0]) / TICK_E).round() as u32;
        (0..=steps)
            .map(|step| E[0] + TICK_E * f64::from(step))
            .map(|e| (e, self.place(A[0], e)[1]))
            .collect()
    }

    /// The gaps' chips: for each, the turns it's named by, the x of the
    /// gap (where its line drops), and the x of the chip's middle. A chip
    /// sits over its gap, moved aside only as far as keeps it clear of the
    /// next: beside an open panel the 5:2 and the 7:3 are closer than a
    /// chip is wide.
    pub fn chips(&self) -> [((u32, u32), f64, f64); 4] {
        let at = gaps().map(|a| self.place(a, E[0])[0]);
        let mut middles = at;
        let least = CHIP[0] + CHIP_APART;
        // Each pass parts the pairs still too close; four chips settle in
        // a few.
        for _ in 0..8 {
            for left in 0..middles.len() - 1 {
                let short = least - (middles[left + 1] - middles[left]);
                if short > 0.0 {
                    middles[left] -= short / 2.0;
                    middles[left + 1] += short / 2.0;
                }
            }
        }
        std::array::from_fn(|gap| (GAPS[gap], at[gap], middles[gap]))
    }

    /// Where each named group's name is centered: on the orbit size that
    /// Jupiter's a gives its resonance, at the group's eccentricity.
    pub fn groups(&self) -> [(&'static str, [f64; 2]); 2] {
        GROUPS.map(|(name, (turns, jupiters), e)| {
            (name, self.place(JUPITER.in_step(turns, jupiters), e))
        })
    }
}

#[cfg(test)]
mod tests {
    use super::{CHIP, Plot, gaps, in_view};

    #[test]
    fn the_furniture_is_where_board_4_has_it() {
        let plot = Plot::in_window(1440.0, 900.0, 0.0);
        // A tick every half au, from 80 px to 1360, and every tenth.
        let across = plot.ticks_a();
        assert_eq!(across.len(), 9);
        for (tick, (a, x)) in across.into_iter().enumerate() {
            assert!((a - (1.5 + 0.5 * tick as f64)).abs() < 1e-12);
            assert!(
                (x - (80.0 + 160.0 * tick as f64)).abs() < 1e-9,
                "{a} au at {x}"
            );
        }
        let up = plot.ticks_e();
        assert_eq!(up.len(), 7);
        // (The board draws them at 770, 658, 545, 433, 321, 208, and 96.)
        for ((e, y), board) in up
            .into_iter()
            .zip([771.0, 658.5, 546.0, 433.5, 321.0, 208.5, 96.0])
        {
            assert!((y - board).abs() < 1e-9, "e {e} at {y}");
        }
        // The chips: the board's are 35 px wide from 384, 487, 530, and
        // 632, each over its gap.
        for ((_, gap, middle), board) in plot.chips().into_iter().zip([384.0, 487.0, 530.0, 632.0])
        {
            assert_eq!(gap, middle, "no chip is moved aside at this width");
            assert!(
                (middle - CHIP[0] / 2.0 - board).abs() < 2.0,
                "a chip from {}",
                middle - CHIP[0] / 2.0
            );
        }
        // The names: the board centers the Hildas' at (871, 401) and the
        // Trojans' at (1265, 509).
        let [(hildas, at), (trojans, far)] = plot.groups();
        assert!(hildas.starts_with("Hildas") && trojans.starts_with("Trojans"));
        assert!(
            (at[0] - 871.0).abs() < 1.5 && (at[1] - 401.0).abs() < 0.5,
            "{at:?}"
        );
        assert!(
            (far[0] - 1265.0).abs() < 1.5 && (far[1] - 509.0).abs() < 0.5,
            "{far:?}"
        );
    }

    #[test]
    fn chips_too_close_are_moved_aside_and_no_further() {
        // Beside the open panel the plot is 720 px wide: the 5:2 and the
        // 7:3 are 24 px apart, and a chip is 35 wide.
        let chips = Plot::in_window(1440.0, 900.0, 560.0).chips();
        let (gaps, middles): (Vec<f64>, Vec<f64>) =
            chips.iter().map(|&(_, gap, middle)| (gap, middle)).unzip();
        assert!(gaps[2] - gaps[1] < CHIP[0]);
        for pair in middles.windows(2) {
            assert!(pair[1] - pair[0] >= CHIP[0] + 4.0 - 1e-9, "{middles:?}");
        }
        // The outer two stay over their gaps, and the two moved are still
        // over their lines.
        assert_eq!((middles[0], middles[3]), (gaps[0], gaps[3]));
        for gap in 1..3 {
            assert!((middles[gap] - gaps[gap]).abs() < CHIP[0] / 2.0);
        }
        assert_eq!(
            chips.map(|(turns, _, _)| turns),
            [(3, 1), (5, 2), (7, 3), (2, 1)]
        );
    }

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
