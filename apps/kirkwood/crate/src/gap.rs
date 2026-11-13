//! A gap picked: a marker on an orbit exactly in step with Jupiter, at one
//! of the gaps the sort's axes name ([`crate::layout::GAPS`]), its path in
//! the frame that turns with Jupiter, and what the card says of it.
//!
//! The marker isn't a row. It's on a two-body orbit the crate makes up: the
//! gap's orbit size, [`E`] for its eccentricity, flat on the ecliptic, at
//! perihelion on Jupiter's own longitude at the epoch, and turning exactly
//! `turns` times while Jupiter turns `jupiters` (Jupiter's own mean motion,
//! times the ratio). So, seen from the frame that turns with Jupiter, it
//! comes back to where it began after `jupiters` of Jupiter's orbits, and
//! its path there is one closed curve, whatever the clock reads
//! (`docs/DECISIONS.md`, "Scene", a gap picked).
//!
//! Which gap is picked is the interface's ([`pick`], [`let_go`]); how much
//! of the marker shows is one number, moved by whoever reads it
//! ([`advance`]), as the ride's is.

use std::cell::Cell;

use crate::flight;
use crate::layout::{GAPS, gaps};
use crate::orbit::{JUPITER, Orbit};
use crate::ride;
use crate::tween::{self, Tween};

/// The marker's coming and going, riding: a press on a chip in the card.
pub const GAP_MS: f64 = 400.0;

/// The marker's eccentricity: enough that its path shows where it meets
/// Jupiter, and short of Jupiter's orbit at every gap
/// (`docs/DECISIONS.md`, "Scene").
pub const E: f64 = 0.25;

/// The places the path is drawn through, for each of Jupiter's orbits.
pub const PATH_POINTS: usize = 480;

thread_local! {
    static SHOWN: Cell<Tween> = const { Cell::new(Tween::REST) };
    /// The gap the marker is at, or was last.
    static MARKER: Cell<usize> = const { Cell::new(0) };
    static MARKER_E: Cell<f64> = const { Cell::new(E) };
}

fn with<R>(change: impl FnOnce(&mut Tween) -> R) -> R {
    tween::with(&SHOWN, change)
}

/// The press on a gap's chip: the marker goes there.
pub fn pick(gap: usize) {
    MARKER.set(gap.min(GAPS.len() - 1));
    if !SHOWN.get().pressed() {
        with(Tween::toggle);
    }
}

/// The marker leaves, with its path and its card.
pub fn let_go() {
    if SHOWN.get().pressed() {
        with(Tween::toggle);
    }
}

/// The gap that's picked, if one is.
pub fn picked() -> Option<usize> {
    SHOWN.get().pressed().then(marker)
}

/// The gap the marker is at, or was last: what's drawn while it leaves.
pub fn marker() -> usize {
    MARKER.get()
}

/// Moves the marker's coming or going on to `now_ms` (the page clock) and
/// returns how much of it is there ([`shown`]). A gap is picked only in
/// the frame that turns with Jupiter: once that frame is the fixed one
/// again, the gap is let go of.
pub fn advance(now_ms: f64) -> f64 {
    if !ride::riding() && !ride::flying() {
        SHOWN.set(Tween::REST);
        return 0.0;
    }
    with(|shown| shown.advance(now_ms, GAP_MS));
    shown()
}

/// Whether the marker is coming or going.
pub fn moving() -> bool {
    SHOWN.get().moving()
}

/// How much of a picked gap there is: 0 with none, 1 with one, eased
/// between. One gives its place to the other, as the title's two
/// sentences do: the ride's own additions leave over the first half
/// ([`groups_gone`]) and the marker's come in over the second ([`lit`]),
/// so nothing is drawn that the title isn't saying.
pub fn shown() -> f64 {
    SHOWN.get().eased()
}

/// How much of what the ride shows of its own two groups (their names,
/// the triangle, their light) a picked gap has taken away: all of it by
/// the time half the gap is there.
pub fn groups_gone() -> f64 {
    (2.0 * shown()).min(1.0)
}

/// How much of the marker, its path, the dim under them, and the card
/// shows: the second half of [`shown`], over the second half of the
/// camera's flight to the ride and only in space, as the ride's own light
/// comes in.
pub fn lit() -> f64 {
    (2.0 * shown() - 1.0).max(0.0) * (2.0 * ride::turned() - 1.0).max(0.0) * flight::space()
}

/// Holds a gap picked, for a screenshot (`?gap=`, with `?ride=1`).
pub fn hold(gap: usize) {
    MARKER.set(gap.min(GAPS.len() - 1));
    with(|shown| shown.hold(1.0));
}

/// `?markerE=`: another eccentricity for the marker, to be looked at.
pub fn set_e(e: f64) {
    MARKER_E.set(if e.is_finite() { e.clamp(0.0, 0.9) } else { E });
}

/// The marker's orbit at a gap, with the eccentricity it's drawn at.
pub fn orbit(gap: usize) -> Orbit {
    orbit_with(gap, MARKER_E.get())
}

fn orbit_with(gap: usize, e: f64) -> Orbit {
    let (turns, jupiters) = GAPS[gap];
    Orbit {
        a: gaps()[gap],
        e,
        // Flat on the ecliptic, its perihelion on Jupiter's longitude at
        // the epoch, and there then: the path is the same either side of
        // Jupiter's line, but for Jupiter's own e.
        i: 0.0,
        node: 0.0,
        perihelion: ride::longitude(0.0).to_degrees(),
        mean_anomaly: 0.0,
        // Exactly in step: Jupiter's own mean motion, which counts its
        // mass, times the ratio. (The orbit size's own, 1 / a^1.5, is a
        // part in 2,000 slower, and its path would never close.)
        turns_a_year: JUPITER.turns_a_year * f64::from(turns) / f64::from(jupiters),
    }
}

/// Where the marker is, `years` after the epoch: x, y, z in au.
pub fn place(gap: usize, years: f64) -> [f64; 3] {
    orbit(gap).place(years)
}

/// A place on the ecliptic as the frame that turns with Jupiter has it,
/// `years` after the epoch: x along Jupiter's line from the Sun, y the way
/// Jupiter goes.
pub fn turned(place: [f64; 3], years: f64) -> [f64; 2] {
    let (sin, cos) = ride::longitude(years).sin_cos();
    [
        place[0] * cos + place[1] * sin,
        place[1] * cos - place[0] * sin,
    ]
}

/// The years the marker's path takes to close: as many of Jupiter's
/// orbits as the gap's ratio counts of them.
pub fn closes_in(gap: usize) -> f64 {
    f64::from(GAPS[gap].1) / JUPITER.turns_a_year
}

/// The marker's path in the frame that turns with Jupiter, over the years
/// it takes to close: [`PATH_POINTS`] places for each of Jupiter's orbits,
/// each as [`turned`] has it. Its last place is one step short of its
/// first.
pub fn path(gap: usize) -> Vec<[f64; 2]> {
    let orbit = orbit(gap);
    let points = PATH_POINTS * GAPS[gap].1 as usize;
    let whole = closes_in(gap);
    (0..points)
        .map(|point| {
            let years = whole * point as f64 / points as f64;
            turned(orbit.place(years), years)
        })
        .collect()
}

/// What the card says of a gap: every number from Jupiter's own orbit.
pub struct Card {
    /// "3:1 with Jupiter".
    pub name: String,
    /// Why the orbit empties.
    pub why: String,
    /// The orbit's size, one orbit, and Jupiter's orbit: a label and its
    /// number.
    pub numbers: [(&'static str, String); 3],
}

/// The gap's orbit size (au), one orbit there, and one of Jupiter's (the
/// clock's years): the size from Jupiter's a, the periods from its own
/// mean motion.
pub fn numbers(gap: usize) -> [f64; 3] {
    let (turns, jupiters) = GAPS[gap];
    let jupiter = 1.0 / JUPITER.turns_a_year;
    [
        gaps()[gap],
        jupiter * f64::from(jupiters) / f64::from(turns),
        jupiter,
    ]
}

pub fn card(gap: usize) -> Card {
    let (turns, jupiters) = GAPS[gap];
    let times = match turns {
        2 => "twice".to_string(),
        turns => format!("{} times", counted(turns)),
    };
    let each = match jupiters {
        1 => "each one".to_string(),
        jupiters => format!("every {}", counted(jupiters)),
    };
    let [a, orbit, jupiter] = numbers(gap);
    Card {
        name: format!("{turns}:{jupiters} with Jupiter"),
        why: format!(
            "An asteroid here goes around the Sun {times} for {each} of Jupiter's, so it meets Jupiter at the same places every time. The tugs add up, and the orbit empties."
        ),
        numbers: [
            ("Orbit size", format!("{a:.2} au")),
            ("One orbit", format!("{orbit:.2} years")),
            ("Jupiter's orbit", format!("{jupiter:.2} years")),
        ],
    }
}

/// A small count, in words.
fn counted(count: u32) -> String {
    match count {
        1 => "one".into(),
        2 => "two".into(),
        3 => "three".into(),
        5 => "five".into(),
        7 => "seven".into(),
        count => count.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        E, GAP_MS, PATH_POINTS, advance, card, closes_in, groups_gone, hold, let_go, lit, marker,
        moving, numbers, orbit_with, path, pick, picked, shown, turned,
    };
    use crate::layout::GAPS;
    use crate::orbit::JUPITER;
    use crate::ride;

    /// The ride with Jupiter at its camera, from straight above: 17 au up
    /// with a 40° field in a window 900 px high (`web/src/scene.ts`,
    /// `RIDE`, `FOV`), CSS px for each au.
    const PX_AN_AU: f64 = 900.0 / (2.0 * 17.0 * 0.363_970_234_266_202_4);

    fn apart(a: [f64; 2], b: [f64; 2]) -> f64 {
        (a[0] - b[0]).hypot(a[1] - b[1])
    }

    #[test]
    fn the_path_closes_after_as_many_of_jupiters_orbits_as_the_ratio_counts() {
        for (gap, (_, jupiters)) in GAPS.into_iter().enumerate() {
            let orbit = orbit_with(gap, E);
            let at = |years: f64| turned(orbit.place(years), years);
            // From anywhere on the clock, not only the epoch.
            for from in [-50.0, 0.0, 3.3, 50.0] {
                let off = apart(at(from), at(from + closes_in(gap))) * PX_AN_AU;
                assert!(off < 1e-6, "the {gap}th gap's path ends {off} px off");
                // The control: one of Jupiter's orbits closes the path
                // only where the ratio counts one.
                let one = apart(at(from), at(from + 1.0 / JUPITER.turns_a_year)) * PX_AN_AU;
                assert_eq!(one < 1.0, jupiters == 1, "{gap}: {one} px after one");
            }
            // And a marker on the orbit size's own mean motion, which
            // counts no mass, doesn't come back.
            let own = crate::orbit::Orbit {
                turns_a_year: orbit.a.powf(-1.5),
                ..orbit
            };
            let off = apart(
                turned(own.place(0.0), 0.0),
                turned(own.place(closes_in(gap)), closes_in(gap)),
            ) * PX_AN_AU;
            assert!(off > 0.5, "the control passes: {off} px");
        }
    }

    #[test]
    fn the_path_is_the_markers_own_and_keeps_inside_jupiters_orbit() {
        for (gap, (_, jupiters)) in GAPS.into_iter().enumerate() {
            let drawn = path(gap);
            assert_eq!(drawn.len(), PATH_POINTS * jupiters as usize);
            let orbit = orbit_with(gap, E);
            // It starts at perihelion, on Jupiter's line.
            assert!(apart(drawn[0], [orbit.a * (1.0 - E), 0.0]) < 1e-9);
            // A step is short of a line's width off the curve: its ends
            // are close, and the last is a step from the first.
            let mut longest: f64 = 0.0;
            for (point, place) in drawn.iter().enumerate() {
                let next = drawn[(point + 1) % drawn.len()];
                longest = longest.max(apart(*place, next) * PX_AN_AU);
                let from_sun = place[0].hypot(place[1]);
                assert!(from_sun > orbit.a * (1.0 - E) - 1e-9);
                assert!(from_sun < orbit.a * (1.0 + E) + 1e-9);
                assert!(from_sun < JUPITER.a * (1.0 - JUPITER.e) - 0.5);
            }
            assert!(longest < 12.0, "{gap}: a step of {longest} px");
            // Wherever the clock is, the marker is on the path: as far
            // off as a chord is from its arc, at most.
            for years in [-41.7, 0.01, 7.77, 33.3] {
                let at = turned(orbit.place(years), years);
                let nearest = drawn
                    .iter()
                    .map(|place| apart(*place, at) * PX_AN_AU)
                    .fold(f64::INFINITY, f64::min);
                assert!(nearest < longest / 2.0 + 1e-6, "{gap}: {nearest} px");
            }
        }
    }

    #[test]
    fn the_cards_numbers_are_jupiters() {
        // Board 5's: 2.50 au, 3.95 years, 11.86 years.
        let three = card(0);
        assert_eq!(three.name, "3:1 with Jupiter");
        assert_eq!(
            three
                .numbers
                .map(|(label, number)| format!("{label} {number}")),
            [
                "Orbit size 2.50 au",
                "One orbit 3.95 years",
                "Jupiter's orbit 11.86 years"
            ]
        );
        assert!(three.why.contains("three times for each one of Jupiter's"));
        assert!(
            card(1)
                .why
                .contains("five times for every two of Jupiter's")
        );
        assert!(
            card(2)
                .why
                .contains("seven times for every three of Jupiter's")
        );
        assert!(card(3).why.contains("twice for each one of Jupiter's"));
        for (gap, (turns, jupiters)) in GAPS.into_iter().enumerate() {
            let [a, orbit, jupiter] = numbers(gap);
            assert_eq!(a, JUPITER.in_step(turns, jupiters));
            assert_eq!(jupiter, 1.0 / JUPITER.turns_a_year);
            assert!((orbit * f64::from(turns) - jupiter * f64::from(jupiters)).abs() < 1e-12);
            // Kepler's third law from the orbit's size alone agrees to a
            // part in a thousand: it counts no mass of Jupiter's.
            assert!((a.powf(1.5) / orbit - 1.0).abs() < 1e-3);
            assert!(card(gap).name.starts_with(&format!("{turns}:{jupiters}")));
        }
    }

    #[test]
    fn a_gap_is_picked_only_in_the_frame_that_turns() {
        ride::hold(0.0);
        hold(0);
        // In the fixed frame the first reading lets it go.
        assert_eq!(advance(0.0), 0.0);
        assert_eq!((picked(), lit()), (None, 0.0));
        ride::hold(1.0);
        pick(2);
        assert_eq!((picked(), marker()), (Some(2), 2));
        assert!(moving());
        advance(1000.0);
        advance(1000.0 + GAP_MS / 2.0);
        // Halfway: the ride's own additions are gone, and nothing of the
        // marker's shows yet.
        assert!((shown() - 0.5).abs() < 1e-12);
        assert!((groups_gone() - 1.0).abs() < 1e-12 && lit().abs() < 1e-12);
        advance(1000.0 + GAP_MS * 0.75);
        assert!(groups_gone() == 1.0 && lit() > 0.5 && lit() < 1.0);
        advance(1000.0 + GAP_MS);
        assert!(!moving());
        assert_eq!((shown(), groups_gone(), lit()), (1.0, 1.0, 1.0));
        // A press on another chip moves the marker; nothing fades.
        pick(0);
        assert_eq!((picked(), shown()), (Some(0), 1.0));
        // Let go, the marker is still the one that leaves.
        let_go();
        assert_eq!((picked(), marker()), (None, 0));
        advance(3000.0);
        advance(3000.0 + GAP_MS);
        assert_eq!(shown(), 0.0);
        // With the camera halfway to the ride nothing of it shows yet.
        pick(1);
        ride::hold(0.5);
        assert_eq!(lit(), 0.0);
        ride::hold(0.0);
        advance(9000.0);
        assert_eq!(picked(), None);
    }
}
