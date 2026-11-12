//! "Ride with Jupiter": the frame turned with Jupiter, so Jupiter holds
//! still and the groups in step with it show their shapes (the Hildas'
//! triangle, the Trojans' two clouds). One number, 0 in the fixed frame
//! and 1 riding, [`RIDE_MS`] end to end: the scene's camera flies by it
//! from where it was to straight above, turned about the ecliptic's pole
//! by Jupiter's own longitude ([`longitude`]), so every dot, the Sun, and
//! Jupiter's orbit turn as one and no buffer is rewritten
//! (`docs/DECISIONS.md`, "Scene", the frame that turns with Jupiter).
//!
//! Like the clock and the sort flight, it's moved by whoever reads it
//! ([`advance`]): the scene each frame, and the interface on the way.

use std::cell::Cell;

use crate::orbit::JUPITER;
use crate::tween::{self, Tween};

/// The camera's flight to straight above, or back.
pub const RIDE_MS: f64 = 2000.0;

/// The Hildas: the rows whose orbit size is from 3.7 to 4.2 au
/// (`docs/DECISIONS.md`, "Scene").
pub const HILDAS: [f64; 2] = [3.7, 4.2];
/// The Trojans: the rows of class TJN, which JPL defines by a and e alone:
/// an orbit size past 4.6 au and short of 5.5, and an e under 0.3. (The
/// crate's test reads every row's class against it.)
pub const TROJANS: [f64; 2] = [4.6, 5.5];
pub const TROJANS_E: f64 = 0.3;

/// How far ahead of Jupiter the three points are that an orbit in step
/// with it keeps to, degrees: 60° ahead, 60° behind, and opposite.
pub const POINTS: [f64; 3] = [60.0, -60.0, 180.0];

/// A group that holds its shape in the frame that turns with Jupiter.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Group {
    Hildas,
    Trojans,
}

/// The group a row is in, by its a and e: in 32-bit floats, as the file
/// holds them and the scene's shader compares them (the bounds as the
/// floats it's handed), so the rows the scene lights are these rows.
pub fn group(a: f32, e: f32) -> Option<Group> {
    if a >= HILDAS[0] as f32 && a <= HILDAS[1] as f32 {
        Some(Group::Hildas)
    } else if a > TROJANS[0] as f32 && a < TROJANS[1] as f32 && e < TROJANS_E as f32 {
        Some(Group::Trojans)
    } else {
        None
    }
}

/// The groups' bounds, as the shader takes them: the Hildas' least a and
/// most, the Trojans' least a and most, and the Trojans' most e.
pub fn bounds() -> [f32; 5] {
    [HILDAS[0], HILDAS[1], TROJANS[0], TROJANS[1], TROJANS_E].map(|bound| bound as f32)
}

thread_local! {
    static RIDE: Cell<Tween> = const { Cell::new(Tween::REST) };
}

fn with<R>(change: impl FnOnce(&mut Tween) -> R) -> R {
    tween::with(&RIDE, change)
}

/// Moves the ride on to `now_ms` (the page clock) and returns its
/// progress.
pub fn advance(now_ms: f64) -> f64 {
    with(|ride| ride.advance(now_ms, RIDE_MS))
}

/// Whether the frame is headed for Jupiter's, or is there: the action is
/// pressed.
pub fn riding() -> bool {
    RIDE.get().pressed()
}

/// Whether the camera is on its way, either way.
pub fn flying() -> bool {
    RIDE.get().moving()
}

/// How far the frame has turned to Jupiter's, as last moved: 0 in the
/// fixed frame with the camera where it was, 1 turning with Jupiter from
/// straight above, eased between. The scene's camera is this far from the
/// one to the other, and what the ride adds (the names, the triangle, the
/// two groups' light) is this much there.
pub fn turned() -> f64 {
    RIDE.get().eased()
}

/// How much of the sky the ride leaves in the picture: all of it in the
/// fixed frame, none in the one that turns (`docs/DECISIONS.md`, "Scene").
pub fn sky() -> f64 {
    1.0 - turned()
}

/// The press: the frame turns for Jupiter's, or back, from wherever it is.
pub fn toggle() {
    with(Tween::toggle);
}

/// Holds the ride at `progress`, for a screenshot of one moment of it
/// (`?ride=`): pressed past 0, and not flying.
pub fn hold(progress: f64) {
    with(|ride| ride.hold(progress));
}

/// Jupiter's longitude on the ecliptic, `years` after the epoch, radians:
/// the angle the frame is turned by.
pub fn longitude(years: f64) -> f64 {
    let [x, y, _] = JUPITER.place(years);
    y.atan2(x)
}

/// The three points in step with Jupiter, `years` after the epoch: 60°
/// ahead of it, 60° behind, and opposite, on the ecliptic at Jupiter's own
/// orbit size (x, y, z in au). The Trojans keep to the first two, and the
/// Hildas' triangle has a corner toward each.
pub fn points(years: f64) -> [[f64; 3]; 3] {
    let jupiter = longitude(years);
    POINTS.map(|ahead| {
        let (sin, cos) = (jupiter + ahead.to_radians()).sin_cos();
        [JUPITER.a * cos, JUPITER.a * sin, 0.0]
    })
}

#[cfg(test)]
mod tests {
    use super::{
        Group, RIDE_MS, advance, flying, group, hold, longitude, points, riding, sky, toggle,
        turned,
    };
    use crate::orbit::JUPITER;

    #[test]
    fn the_ride_takes_two_seconds_each_way_and_turns_where_it_is() {
        hold(0.0);
        assert!(!riding() && !flying());
        assert_eq!((turned(), sky()), (0.0, 1.0));
        toggle();
        assert!(riding() && flying());
        // The press's own time doesn't count.
        assert_eq!(advance(1000.0), 0.0);
        // (In steps shorter than a stall.)
        advance(1000.0 + RIDE_MS / 4.0);
        assert!((advance(1000.0 + RIDE_MS / 2.0) - 0.5).abs() < 1e-12);
        assert!((turned() - 0.5).abs() < 1e-12 && (sky() - 0.5).abs() < 1e-12);
        // Pressed again partway: back from where it is.
        toggle();
        assert!(!riding() && flying());
        advance(5000.0);
        assert!((advance(5000.0 + RIDE_MS / 4.0) - 0.25).abs() < 1e-12);
        toggle();
        advance(9000.0);
        for step in 1..=10 {
            advance(9000.0 + 400.0 * f64::from(step));
        }
        assert!(riding() && !flying());
        assert_eq!((turned(), sky()), (1.0, 0.0));
        hold(0.0);
    }

    #[test]
    fn the_points_are_60_degrees_either_side_of_jupiter_and_opposite() {
        for years in [-50.0, 0.0, 3.1, 11.86, 50.0] {
            let [x, y, _] = JUPITER.place(years);
            assert!((longitude(years) - y.atan2(x)).abs() < 1e-15);
            let toward = [x, y].map(|axis| axis / x.hypot(y));
            for (point, cosine) in points(years).into_iter().zip([0.5, 0.5, -1.0]) {
                // On the ecliptic, at Jupiter's own orbit size.
                assert_eq!(point[2], 0.0);
                assert!((point[0].hypot(point[1]) - JUPITER.a).abs() < 1e-12);
                let along = (point[0] * toward[0] + point[1] * toward[1]) / JUPITER.a;
                assert!((along - cosine).abs() < 1e-12, "{years}: {along}");
            }
            // The first is ahead (the way Jupiter goes: counterclockwise
            // from the north), the second behind.
            let [ahead, behind, _] = points(years);
            assert!(toward[0] * ahead[1] - toward[1] * ahead[0] > 0.0);
            assert!(toward[0] * behind[1] - toward[1] * behind[0] < 0.0);
        }
    }

    #[test]
    fn a_rows_group_is_its_a_and_e() {
        assert_eq!(group(3.97, 0.2), Some(Group::Hildas));
        assert_eq!(group(3.7, 0.9), Some(Group::Hildas));
        assert_eq!(group(4.2, 0.0), Some(Group::Hildas));
        assert_eq!(group(5.2, 0.05), Some(Group::Trojans));
        assert_eq!(group(5.2, 0.3), None);
        assert_eq!(group(4.6, 0.1), None);
        assert_eq!(group(2.77, 0.08), None);
        assert_eq!(group(4.3, 0.1), None);
        assert_eq!(group(f32::NAN, 0.1), None);
    }
}
