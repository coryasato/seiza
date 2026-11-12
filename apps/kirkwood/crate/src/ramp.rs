//! Color is orbit size: a dot's tint by its own a, through five stops
//! (`docs/DECISIONS.md`, "Look"). The one table: the scene's shader takes
//! it from here ([`table`]) and the legend is drawn from it ([`tint`]), so
//! the two can't disagree.
//!
//! Between two stops a tint is mixed in linear light, as the shader mixes
//! it; the legend shows that mix as the display's values ([`display`]).

/// The stops: an orbit size in au, and its color in oklch (lightness,
/// chroma, hue in degrees). Rose at the inner edge, pale gold, blue, violet
/// at the Hildas, green at the Trojans.
pub const STOPS: [(f32, [f32; 3]); 5] = [
    (1.6, [0.76, 0.14, 27.0]),
    (2.7, [0.93, 0.07, 84.0]),
    (3.2, [0.81, 0.10, 258.0]),
    (3.97, [0.76, 0.14, 298.0]),
    (5.2, [0.88, 0.13, 161.0]),
];

/// The orbit sizes the legend runs between: the first stop and the last.
/// A smaller or a larger orbit keeps the end's tint.
pub const FROM: f32 = STOPS[0].0;
pub const TO: f32 = STOPS[STOPS.len() - 1].0;

/// An oklch color in linear light: sRGB's red, green, and blue, 0 to 1.
pub fn linear([l, c, h]: [f32; 3]) -> [f32; 3] {
    let (a, b) = (c * h.to_radians().cos(), c * h.to_radians().sin());
    let l_ = (l + 0.396_337_78 * a + 0.215_803_76 * b).powi(3);
    let m_ = (l - 0.105_561_346 * a - 0.063_854_17 * b).powi(3);
    let s_ = (l - 0.089_484_18 * a - 1.291_485_5 * b).powi(3);
    [
        4.076_741_7 * l_ - 3.307_711_6 * m_ + 0.230_969_93 * s_,
        -1.268_438 * l_ + 2.609_757_4 * m_ - 0.341_319_4 * s_,
        -0.004_196_086_3 * l_ - 0.703_418_6 * m_ + 1.707_614_7 * s_,
    ]
    .map(|channel| channel.clamp(0.0, 1.0))
}

/// The tint of an orbit `a` au in size, in linear light.
pub fn tint(a: f32) -> [f32; 3] {
    let mut color = linear(STOPS[0].1);
    for pair in STOPS.windows(2) {
        let ((from, _), (to, next)) = (pair[0], pair[1]);
        let k = ((a - from) / (to - from)).clamp(0.0, 1.0);
        let next = linear(next);
        for channel in 0..3 {
            color[channel] += (next[channel] - color[channel]) * k;
        }
    }
    color
}

/// A color in linear light as the display's values (sRGB's curve), 0 to 1.
pub fn display(linear: [f32; 3]) -> [f32; 3] {
    linear.map(|v| {
        if v <= 0.003_130_8 {
            v * 12.92
        } else {
            1.055 * v.powf(1.0 / 2.4) - 0.055
        }
    })
}

/// The table as the scene's shader takes it: for each stop its orbit size,
/// then its red, green, and blue in linear light.
pub fn table() -> Vec<f32> {
    STOPS
        .iter()
        .flat_map(|(a, color)| {
            let [r, g, b] = linear(*color);
            [*a, r, g, b]
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bytes(a: f32) -> [i32; 3] {
        display(tint(a)).map(|v| (v * 255.0).round() as i32)
    }

    /// The storyboard's legend, board 1, is drawn with these stops in the
    /// display's values (its green a little off ours: the board fitted a
    /// color outside the display's reach another way).
    #[test]
    fn the_stops_are_the_storyboards() {
        let board = [
            (1.6, [255, 140, 128]),
            (2.7, [255, 230, 179]),
            (3.2, [153, 194, 255]),
            (3.97, [189, 158, 255]),
            (5.2, [133, 242, 189]),
        ];
        for (a, drawn) in board {
            let ours = bytes(a);
            for channel in 0..3 {
                assert!(
                    (ours[channel] - drawn[channel]).abs() <= 4,
                    "{a} au is {ours:?}, and the board draws {drawn:?}"
                );
            }
        }
    }

    #[test]
    fn a_tint_is_mixed_between_its_two_stops_and_held_past_the_ends() {
        assert_eq!(tint(0.5), tint(FROM));
        assert_eq!(tint(40.0), tint(TO));
        let (gold, blue, between) = (tint(2.7), tint(3.2), tint(2.95));
        for channel in 0..3 {
            let mid = (gold[channel] + blue[channel]) / 2.0;
            assert!((between[channel] - mid).abs() < 1e-5);
        }
        // The control: a mix isn't either stop.
        assert_ne!(bytes(2.95), bytes(2.7));
        assert_ne!(bytes(2.95), bytes(3.2));
    }

    #[test]
    fn the_table_is_each_stop_and_its_color() {
        let table = table();
        assert_eq!(table.len(), STOPS.len() * 4);
        assert_eq!(table[4], 2.7);
        assert_eq!(table[5..8], linear(STOPS[1].1));
        // Sizes in order, or the shader's mix runs backward.
        assert!(STOPS.windows(2).all(|pair| pair[0].0 < pair[1].0));
    }
}
