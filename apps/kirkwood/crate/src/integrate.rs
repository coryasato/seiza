//! The Hildas and the Trojans, moved for real: integrated under the Sun
//! and Jupiter, Jupiter on its own orbit ([`JUPITER`]) and each row
//! massless. The rest of the belt stays on its 2026 ellipse, where a
//! two-body orbit reads the same for decades; these two groups are in step
//! with Jupiter, and it is Jupiter's pull that keeps them where they are
//! (`docs/DECISIONS.md`, "Scene").
//!
//! The steps are Wisdom and Holman's: between two of Jupiter's kicks a row
//! is on a two-body orbit about the Sun, solved exactly ([`drift`]), so
//! what a step costs in accuracy is Jupiter's thousandth of the pull alone
//! and a step can be weeks long ([`STEP`]). The steps are on a grid counted
//! from the elements' epoch and only ever taken away from it, on or back
//! (a clock that moves toward the epoch starts the rows over from there),
//! so a row's place at a time on the clock is the same, to the bit,
//! however the clock came to it ([`Moved::toward`], then
//! [`Moved::places`]): between two steps it's the two-body orbit the last
//! kick left it on. On the epoch a row is where its ellipse puts it.

use std::f64::consts::TAU;

use crate::elements::Elements;
use crate::orbit::{JUPITER, Orbit};

/// A step, in the clock's years: a 47th of Jupiter's turn
/// (`docs/DECISIONS.md`, "Scene", has what each length costs).
pub const STEP: f64 = 0.25;

/// The Sun's pull, au³ a year²: a 1 au orbit turns once in a year of the
/// clock's.
const SUN: f64 = TAU * TAU;

/// Jupiter's pull, of the Sun's: what its own mean motion says of its
/// mass. A massless body at its a would take a^1.5 years a turn, and
/// Jupiter turns the faster by its mass (about a 1047th of the Sun's).
pub fn jupiter_mass() -> f64 {
    JUPITER.turns_a_year.powi(2) * JUPITER.a.powi(3) - 1.0
}

/// The furthest from the epoch a row is ever moved, years: well past the
/// clock's reach. A time beyond it (or one that isn't a number) is no
/// time on the clock, and nothing steps toward it.
const FURTHEST: f64 = 1000.0;

/// A row's place and how it moves: x, y, z in au, then au a year.
type State = [f64; 6];

/// Moves `state` along its two-body orbit about the Sun by `years` (either
/// way): any orbit, an ellipse or not, in the universal variable.
#[inline]
fn drift(state: &mut State, years: f64) {
    if years == 0.0 {
        return;
    }
    let [x, y, z, vx, vy, vz] = *state;
    let r0 = (x * x + y * y + z * z).sqrt();
    let along = x * vx + y * vy + z * vz;
    // The Sun's pull over the orbit's size: above zero on an ellipse.
    let alpha = 2.0 * SUN / r0 - (vx * vx + vy * vy + vz * vz);
    // Kepler's equation in the universal variable s: r0 g1 + along g2 +
    // SUN g3 = years, whose slope is the distance from the Sun, never
    // below zero. Newton's steps, each kept inside the bracket bisection
    // would use, from where the row's speed alone would have it.
    let (mut low, mut high) = if years > 0.0 {
        (0.0, f64::INFINITY)
    } else {
        (f64::NEG_INFINITY, 0.0)
    };
    let mut s = years / r0;
    s -= along * s * s / (2.0 * r0);
    if !(s > low && s < high) {
        s = years / r0;
    }
    let mut g = stumpff(alpha, s);
    for _ in 0..64 {
        let off = r0 * g[1] + along * g[2] + SUN * g[3] - years;
        if off > 0.0 {
            high = s;
        } else {
            low = s;
        }
        let slope = r0 * g[0] + along * g[1] + SUN * g[2];
        let mut next = s - off / slope;
        if !(next >= low && next <= high) {
            next = if low.is_finite() && high.is_finite() {
                (low + high) / 2.0
            } else {
                // Past the one end found so far: further out.
                2.0 * s
            };
        }
        let moved = (next - s).abs();
        s = next;
        g = stumpff(alpha, s);
        // A step this short leaves the next nothing a float holds.
        if moved <= 1e-9 * s.abs() {
            break;
        }
    }
    let r = r0 * g[0] + along * g[1] + SUN * g[2];
    let (f, g_) = (1.0 - SUN * g[2] / r0, years - SUN * g[3]);
    let (df, dg) = (-SUN * g[1] / (r * r0), 1.0 - SUN * g[2] / r);
    *state = [
        f * x + g_ * vx,
        f * y + g_ * vy,
        f * z + g_ * vz,
        df * x + dg * vx,
        df * y + dg * vy,
        df * z + dg * vz,
    ];
}

/// The four functions Kepler's equation is written in for any orbit, at
/// `s`: g0 to g3. On an ellipse (`alpha` above zero) they're a cosine, a
/// sine, and what's left of each.
#[inline]
fn stumpff(alpha: f64, s: f64) -> [f64; 4] {
    let x = alpha * s * s;
    // A short way along the orbit (a step is one), each is its series:
    // no sine to take, and none of the digits a sine's remainder loses.
    if x.abs() < 0.25 {
        /// 1 over (2k + 2)!, and over (2k + 3)!.
        const EVEN: [f64; 8] = [
            1.0 / 2.0,
            1.0 / 24.0,
            1.0 / 720.0,
            1.0 / 40_320.0,
            1.0 / 3_628_800.0,
            1.0 / 479_001_600.0,
            1.0 / 87_178_291_200.0,
            1.0 / 20_922_789_888_000.0,
        ];
        const ODD: [f64; 8] = [
            1.0 / 6.0,
            1.0 / 120.0,
            1.0 / 5040.0,
            1.0 / 362_880.0,
            1.0 / 39_916_800.0,
            1.0 / 6_227_020_800.0,
            1.0 / 1_307_674_368_000.0,
            1.0 / 355_687_428_096_000.0,
        ];
        let sum = |terms: &[f64; 8]| terms.iter().rev().fold(0.0, |sum, term| term - x * sum);
        let (c2, c3) = (sum(&EVEN), sum(&ODD));
        return [1.0 - x * c2, s * (1.0 - x * c3), s * s * c2, s * s * s * c3];
    }
    let root = alpha.abs().sqrt();
    if alpha > 0.0 {
        // By the half angle, so 1 - cos keeps its digits.
        let (sin, cos) = (root * s / 2.0).sin_cos();
        let g1 = 2.0 * sin * cos / root;
        [
            1.0 - 2.0 * sin * sin,
            g1,
            2.0 * sin * sin / alpha,
            (s - g1) / alpha,
        ]
    } else {
        let half = (root * s / 2.0).sinh();
        let g1 = 2.0 * half * (1.0 + half * half).sqrt() / root;
        [
            1.0 + 2.0 * half * half,
            g1,
            2.0 * half * half / -alpha,
            (s - g1) / alpha,
        ]
    }
}

/// The two groups' rows, each at a step of the grid.
pub struct Moved {
    /// The rows moved, in the file's order.
    rows: Vec<u32>,
    /// Each row at the epoch, as its ellipse has it.
    epoch: Vec<State>,
    /// Each row at step `at`: its place, and how it moves once Jupiter's
    /// kick there is counted, which is the two-body orbit it's on until
    /// the next.
    state: Vec<State>,
    /// The step the rows are at, counted from the epoch.
    at: i32,
    /// A step's years, and Jupiter's pull in au³ a year².
    step: f64,
    pull: f64,
    /// The rows' places, x, y, z of each in au, at `shown` years: what the
    /// scene draws from.
    places: Vec<f32>,
    shown: f64,
}

impl Moved {
    /// The rows of `elements` among `rows` that have an ellipse, each
    /// where its ellipse puts it at the epoch.
    pub fn new(elements: &Elements, rows: &[u32]) -> Self {
        Self::with(elements, rows, STEP, jupiter_mass())
    }

    /// As [`Self::new`], with a step of `step` years and a Jupiter of
    /// `mass` Suns: what the tests weigh.
    pub fn with(elements: &Elements, rows: &[u32], step: f64, mass: f64) -> Self {
        let (rows, epoch): (Vec<u32>, Vec<State>) = rows
            .iter()
            .filter_map(|&row| {
                let ([x, y, z], [vx, vy, vz]) = Orbit::of_row(elements, row as usize)?.state(0.0);
                Some((row, [x, y, z, vx, vy, vz]))
            })
            .unzip();
        let (mut rows, mut epoch) = (rows, epoch);
        rows.shrink_to_fit();
        epoch.shrink_to_fit();
        let mut moved = Self {
            places: vec![0.0; rows.len() * 3],
            state: Vec::with_capacity(rows.len()),
            rows,
            epoch,
            at: 0,
            step,
            pull: SUN * mass,
            shown: f64::NAN,
        };
        moved.start();
        moved
    }

    /// Every row back at the epoch, with half of Jupiter's kick there: a
    /// step is then a drift and a whole kick.
    fn start(&mut self) {
        self.state.clear();
        self.state.extend_from_slice(&self.epoch);
        self.at = 0;
        self.kick(0.5 * self.step);
    }

    /// The rows moved, in the file's order: the order of [`Self::places`].
    pub fn rows(&self) -> &[u32] {
        &self.rows
    }

    /// The step holding `years`: the last one at or before it. Nothing
    /// for a time that isn't on the clock ([`FURTHEST`]).
    fn step_of(&self, years: f64) -> Option<i32> {
        (years.abs() <= FURTHEST).then(|| (years / self.step).floor() as i32)
    }

    /// Jupiter's kick where the rows are, over `years`: its pull on each,
    /// less its pull on the Sun, which every place here is counted from.
    fn kick(&mut self, years: f64) {
        let [jx, jy, jz] = JUPITER.place(f64::from(self.at) * self.step);
        // One over a distance cubed.
        let cubed = |square: f64| 1.0 / (square * square.sqrt());
        let on_sun = cubed(jx * jx + jy * jy + jz * jz);
        let by = self.pull * years;
        for state in &mut self.state {
            let (dx, dy, dz) = (state[0] - jx, state[1] - jy, state[2] - jz);
            let near = cubed(dx * dx + dy * dy + dz * dz);
            state[3] -= by * (dx * near + jx * on_sun);
            state[4] -= by * (dy * near + jy * on_sun);
            state[5] -= by * (dz * near + jz * on_sun);
        }
    }

    /// One step on, or one back: time run the other way.
    fn step(&mut self, on: bool) {
        if on {
            for state in &mut self.state {
                drift(state, self.step);
            }
            self.at += 1;
            self.kick(self.step);
        } else {
            self.kick(-self.step);
            for state in &mut self.state {
                drift(state, -self.step);
            }
            self.at -= 1;
        }
    }

    /// Moves the rows toward the step holding `years`, by `steps` steps at
    /// most, and says whether they're there (never, for a time that isn't
    /// on the clock). A step is only ever taken away from the epoch: for a
    /// time nearer it than the rows are, or on its other side, they start
    /// over from it. Taking a step back the way it came would be shorter,
    /// and isn't done: a row that passed close to Jupiter doesn't come
    /// back through that kick to the float it left with, and its place
    /// would then depend on the way the clock came.
    pub fn toward(&mut self, years: f64, steps: usize) -> bool {
        let Some(to) = self.step_of(years) else {
            return false;
        };
        let away = if self.at >= 0 {
            to >= self.at
        } else {
            to <= self.at
        };
        if !away {
            self.start();
        }
        for _ in 0..steps {
            if self.at == to {
                break;
            }
            self.step(to > self.at);
        }
        self.at == to
    }

    /// Moves the rows to the step holding `years`, however many steps
    /// that is, and says whether there is such a step.
    pub fn to(&mut self, years: f64) -> bool {
        if self.step_of(years).is_none() {
            return false;
        }
        while !self.toward(years, 4096) {}
        true
    }

    /// Whether the rows are at the step holding `years`.
    pub fn is_at(&self, years: f64) -> bool {
        self.step_of(years) == Some(self.at)
    }

    /// The rows' places at `years`, x, y, z of each in au, in the order of
    /// [`Self::rows`]; nothing unless the rows are at its step
    /// ([`Self::toward`]). Where they are doesn't move for the page's
    /// life.
    pub fn places(&mut self, years: f64) -> Option<&[f32]> {
        if !self.is_at(years) {
            return None;
        }
        if self.shown != years {
            let since = years - f64::from(self.at) * self.step;
            for (state, place) in self.state.iter().zip(self.places.as_chunks_mut::<3>().0) {
                let mut state = *state;
                drift(&mut state, since);
                *place = [state[0] as f32, state[1] as f32, state[2] as f32];
            }
            self.shown = years;
        }
        Some(&self.places)
    }

    /// One row's place at `years`, in 64-bit floats; `at` is its place in
    /// [`Self::rows`]. Nothing unless the rows are at its step.
    pub fn place(&self, at: usize, years: f64) -> Option<[f64; 3]> {
        if !self.is_at(years) {
            return None;
        }
        let mut state = *self.state.get(at)?;
        drift(&mut state, years - f64::from(self.at) * self.step);
        Some([state[0], state[1], state[2]])
    }

    /// The bytes held for the rows: their states, and the places drawn.
    pub fn bytes(&self) -> usize {
        self.rows.capacity() * 4
            + (self.epoch.capacity() + self.state.capacity()) * size_of::<State>()
            + self.places.capacity() * 4
    }
}

/// One row's place at `years`, moved there from the epoch on its own: the
/// place the scene's rows must be at, however they came to it. Nothing for
/// a row with no ellipse, or a time that isn't on the clock.
pub fn place_of(elements: &Elements, row: usize, years: f64) -> Option<[f64; 3]> {
    let mut alone = Moved::new(elements, &[row as u32]);
    alone.to(years).then(|| alone.place(0, years))?
}

#[cfg(test)]
mod tests {
    use std::f64::consts::TAU;
    use std::path::Path;
    use std::time::Instant;

    use super::{Moved, STEP, SUN, State, drift, jupiter_mass};
    use crate::clock;
    use crate::elements::{EPOCH_JD, Element, Elements, YEAR_DAYS};
    use crate::orbit::tests::{distance, elements_file};
    use crate::orbit::{JUPITER, Orbit};
    use crate::ride::{self, Group};

    fn state_of(orbit: &Orbit, years: f64) -> State {
        let ([x, y, z], [vx, vy, vz]) = orbit.state(years);
        [x, y, z, vx, vy, vz]
    }

    /// A row's orbit: one turn in a^1.5 years.
    fn orbit(a: f64, e: f64, mean_anomaly: f64) -> Orbit {
        Orbit {
            a,
            e,
            i: 11.0,
            node: 80.0,
            perihelion: 250.0,
            mean_anomaly,
            turns_a_year: a.powf(-1.5),
        }
    }

    #[test]
    fn jupiters_mass_is_what_its_own_motion_says() {
        // The IAU's: a 1047.3486th of the Sun's.
        let mass = jupiter_mass();
        assert!((mass * 1047.3486 - 1.0).abs() < 1e-3, "{mass}");
    }

    #[test]
    fn a_drift_is_the_two_body_orbit() {
        for (a, e) in [
            (5.2, 0.05),
            (3.97, 0.3),
            (3.7, 0.9),
            (2.2, 0.999),
            (30.0, 0.0),
        ] {
            let orbit = orbit(a, e, 40.0);
            for from in [-7.3, 0.0, 2.9] {
                for years in [-50.0, -STEP, -1e-4, 1e-4, 0.01, STEP, 1.0, 11.86, 50.0] {
                    let mut state = state_of(&orbit, from);
                    drift(&mut state, years);
                    let there = state_of(&orbit, from + years);
                    // A high e's fastest moment is all of its error.
                    let limit = if e < 0.99 { 1e-9 } else { 1e-6 };
                    for axis in 0..6 {
                        assert!(
                            (state[axis] - there[axis]).abs() < limit * (1.0 + there[axis].abs()),
                            "a {a}, e {e}, {from} + {years} years, axis {axis}: {} against {}",
                            state[axis],
                            there[axis]
                        );
                    }
                }
            }
        }
    }

    #[test]
    fn a_drift_takes_an_orbit_that_isnt_an_ellipse() {
        // Past the speed that leaves the Sun, and exactly at it: the drift
        // in one go is the drift in a hundred, and the energy holds.
        for speed in [1.5, 2.0_f64.sqrt()] {
            let v = speed * (SUN / 3.0_f64).sqrt();
            let from: State = [3.0, 0.0, 0.0, 0.3 * v, 0.9 * v, 0.1 * v];
            let energy = |state: &State| {
                (state[3].powi(2) + state[4].powi(2) + state[5].powi(2)) / 2.0
                    - SUN / (state[0].powi(2) + state[1].powi(2) + state[2].powi(2)).sqrt()
            };
            let (mut once, mut often) = (from, from);
            drift(&mut once, 4.0);
            for _ in 0..100 {
                drift(&mut often, 0.04);
            }
            for axis in 0..6 {
                assert!(
                    (once[axis] - often[axis]).abs() < 1e-9,
                    "{speed}: axis {axis}"
                );
            }
            assert!((energy(&once) - energy(&from)).abs() < 1e-10);
            drift(&mut once, -4.0);
            for axis in 0..6 {
                assert!(
                    (once[axis] - from[axis]).abs() < 1e-9,
                    "{speed}: back, axis {axis}"
                );
            }
        }
    }

    /// An elements file of the rows given: a, e, i, the node, the argument
    /// of perihelion, the mean anomaly.
    fn file(rows: &[[f32; 6]]) -> Elements {
        let mut bytes = Vec::new();
        bytes.extend(b"KWE2");
        bytes.extend((rows.len() as u32).to_le_bytes());
        bytes.extend(EPOCH_JD.to_le_bytes());
        bytes.extend((rows.len() as u32).to_le_bytes());
        for column in 0..Element::COUNT {
            for row in rows {
                bytes.extend(row.get(column).copied().unwrap_or(12.0).to_le_bytes());
            }
        }
        Elements::new(crate::bytes::Bytes::from_bytes(&bytes)).unwrap()
    }

    /// A Trojan 60° ahead of Jupiter, a Hilda, and a row with no ellipse.
    fn few() -> Elements {
        let jupiter = JUPITER.node + JUPITER.perihelion + JUPITER.mean_anomaly;
        file(&[
            [
                5.21,
                0.06,
                8.0,
                30.0,
                0.0,
                (jupiter + 30.0) as f32 % 360.0 - 180.0,
            ],
            [3.97, 0.17, 6.0, 200.0, 40.0, 100.0],
            [-1.3, 1.2, 100.0, 20.0, 240.0, 30.0],
        ])
    }

    #[test]
    fn on_the_epoch_a_row_is_where_its_ellipse_puts_it() {
        let elements = few();
        let mut moved = Moved::new(&elements, &[0, 1, 2]);
        // The row with no ellipse isn't moved.
        assert_eq!(moved.rows(), [0, 1]);
        assert!(moved.toward(0.0, 0));
        for (at, row) in [0usize, 1].into_iter().enumerate() {
            let ellipse = Orbit::of_row(&elements, row).unwrap().place(0.0);
            assert_eq!(moved.place(at, 0.0).unwrap(), ellipse);
            let drawn = &moved.places(0.0).unwrap()[at * 3..at * 3 + 3];
            assert_eq!(drawn, ellipse.map(|au| au as f32));
        }
    }

    #[test]
    fn with_no_jupiter_a_row_stays_on_its_ellipse() {
        let elements = few();
        let mut moved = Moved::with(&elements, &[0, 1], STEP, 0.0);
        for years in [-50.0, -3.21, 0.07, 9.99, 50.0] {
            while !moved.toward(years, 7) {}
            for row in 0..2 {
                let ellipse = Orbit::of_row(&elements, row).unwrap().place(years);
                let off = distance(moved.place(row, years).unwrap(), ellipse);
                assert!(off < 1e-9, "row {row}, {years} years: {off} au");
            }
        }
        // And with Jupiter it doesn't: the Trojan is held near its point.
        let mut moved = Moved::new(&elements, &[0]);
        while !moved.toward(50.0, 64) {}
        let ellipse = Orbit::of_row(&elements, 0).unwrap().place(50.0);
        assert!(distance(moved.place(0, 50.0).unwrap(), ellipse) > 0.05);
    }

    #[test]
    fn a_place_is_the_same_however_the_clock_came_to_it() {
        let elements = few();
        let straight = |years: f64| {
            let mut moved = Moved::new(&elements, &[0, 1]);
            while !moved.toward(years, 1000) {}
            [
                moved.place(0, years).unwrap(),
                moved.place(1, years).unwrap(),
            ]
        };
        let mut moved = Moved::new(&elements, &[0, 1]);
        // On past it and back, a few steps a call; then far back and on:
        // the same place to the bit, since no step is ever taken back
        // the way it came.
        for (by_way_of, years) in [(31.0, 12.3), (-50.0, -0.01), (50.0, 49.99), (2.0, 0.4)] {
            while !moved.toward(by_way_of, 3) {}
            assert!(moved.places(years).is_none() || moved.is_at(years));
            while !moved.toward(years, 3) {}
            for (row, place) in straight(years).into_iter().enumerate() {
                assert_eq!(
                    moved.place(row, years).unwrap(),
                    place,
                    "row {row} at {years} by way of {by_way_of}"
                );
            }
        }
        // A time that isn't on the clock is never stepped toward.
        for years in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY, 1e9] {
            assert!(!moved.toward(years, 3) && !moved.to(years));
            assert!(moved.places(years).is_none());
            assert!(super::place_of(&elements, 0, years).is_none());
        }
        assert!(moved.is_at(0.4));
        // A place is asked for only at its own step.
        assert!(moved.places(0.4 + 2.0 * STEP).is_none());
        assert!(moved.places(0.4).is_some());
    }

    #[test]
    fn a_place_runs_on_unbroken_across_a_step() {
        let elements = few();
        let mut moved = Moved::new(&elements, &[0, 1]);
        let mut last: Option<[f64; 3]> = None;
        while !moved.toward(4.0, 8) {}
        // A thousandth of a step a time, across three steps: no jump, only
        // the row's own speed (under 2π au a year out here).
        for tick in 0..3000 {
            let years = 4.0 + f64::from(tick) * STEP / 1000.0;
            assert!(moved.toward(years, 1));
            let place = moved.place(1, years).unwrap();
            if let Some(last) = last {
                assert!(distance(place, last) < TAU * STEP / 1000.0);
            }
            last = Some(place);
        }
    }

    // --- On the real files (`just kirkwood test`).

    /// JPL Horizons' places for a numbered asteroid, by the clock's years.
    fn horizons(number: u64) -> Vec<(f64, [f64; 3])> {
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../data/horizons.json");
        let json: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
        let body = json["asteroids"]
            .as_array()
            .unwrap()
            .iter()
            .find(|body| body["number"].as_u64() == Some(number))
            .unwrap();
        json["dates"]
            .as_array()
            .unwrap()
            .iter()
            .zip(body["places"].as_array().unwrap())
            .map(|(date, place)| {
                let at = |axis: usize| place[axis].as_f64().unwrap();
                (
                    (date["jd"].as_f64().unwrap() - EPOCH_JD) / YEAR_DAYS,
                    [at(0), at(1), at(2)],
                )
            })
            .collect()
    }

    /// The angle between two places as the Sun sees them, degrees.
    fn between(a: [f64; 3], b: [f64; 3]) -> f64 {
        let dot: f64 = (0..3).map(|axis| a[axis] * b[axis]).sum();
        let size = |v: [f64; 3]| (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt();
        (dot / size(a) / size(b))
            .clamp(-1.0, 1.0)
            .acos()
            .to_degrees()
    }

    /// The two groups' rows, as the page gathers them.
    fn grouped(elements: &Elements) -> Vec<u32> {
        elements.grouped().to_vec()
    }

    /// A place's longitude ahead of Jupiter's at `years`, -180° to 180°.
    fn ahead(place: [f64; 3], years: f64) -> f64 {
        let turn = (place[1].atan2(place[0]) - ride::longitude(years)).to_degrees();
        turn - 360.0 * (turn / 360.0).round()
    }

    /// Hilda, Patroclus, and Hektor at each of Horizons' eight dates: the
    /// integration's place against JPL's, and the ellipse's.
    #[test]
    #[ignore = "reads data/elements.bin (just kirkwood test)"]
    fn the_integration_is_where_horizons_says() {
        let elements = elements_file();
        // Each body's worst over the eight dates, au: what the step is
        // held to. (The ellipse's worst: 0.40, 0.76, and 2.7.)
        for (number, name, limit) in [
            (153, "Hilda", 0.02),
            (617, "Patroclus", 0.04),
            (624, "Hektor", 0.02),
        ] {
            let row = number as usize - 1;
            let ellipse = Orbit::of_row(&elements, row).unwrap();
            println!(
                "{number} {name}: the integration's place against Horizons' (and the ellipse's)"
            );
            let (mut worst, mut worst_ellipse, mut worst_control): (f64, f64, f64) =
                (0.0, 0.0, 0.0);
            // The control: no Jupiter.
            let mut control = Moved::with(&elements, &[row as u32], STEP, 0.0);
            for (years, theirs) in horizons(number) {
                let ours = super::place_of(&elements, row, years).unwrap();
                let kepler = ellipse.place(years);
                while !control.toward(years, 64) {}
                println!(
                    "  {:>7.2} years: {:.5} au, {:.3}° ({:.4} au, {:.2}°)",
                    years,
                    distance(ours, theirs),
                    between(ours, theirs),
                    distance(kepler, theirs),
                    between(kepler, theirs),
                );
                if years == 0.0 {
                    assert_eq!(ours, kepler, "{name}: on the epoch, its ellipse's place");
                    assert!(distance(ours, theirs) < 2e-6);
                }
                worst = worst.max(distance(ours, theirs));
                worst_ellipse = worst_ellipse.max(distance(kepler, theirs));
                worst_control =
                    worst_control.max(distance(control.place(0, years).unwrap(), theirs));
            }
            assert!(
                worst < limit,
                "{name}: {worst} au from Horizons' place at worst"
            );
            assert!(
                worst_ellipse > 5.0 * limit,
                "{name}: the ellipse does as well"
            );
            assert!(
                worst_control > 5.0 * limit,
                "{name}: the control passes: {worst_control} au"
            );
        }
    }

    /// What a step's length costs: Hektor, Patroclus, and Hilda against
    /// Horizons, and every row against the shortest step. Prints; the
    /// numbers are in `docs/DECISIONS.md`, "Scene".
    #[test]
    #[ignore = "reads data/elements.bin; a study, run with KIRKWOOD_STUDY set"]
    fn a_steps_length_is_weighed() {
        if std::env::var_os("KIRKWOOD_STUDY").is_none() {
            return;
        }
        let elements = elements_file();
        let rows = grouped(&elements);
        let at = |moved: &mut Moved, years: f64| {
            while !moved.toward(years, 4096) {}
            (0..moved.rows().len())
                .map(|row| moved.place(row, years).unwrap())
                .collect::<Vec<_>>()
        };
        let mut finest = Moved::with(&elements, &rows, 1.0 / 256.0, jupiter_mass());
        let truth = [-50.0, 50.0].map(|years| at(&mut finest, years));
        for step in [1.0, 0.5, 0.25, 0.125, 0.0625, 0.03125] {
            let mut worst = [0.0_f64; 3];
            for (body, number) in [153, 617, 624].into_iter().enumerate() {
                let mut alone = Moved::with(&elements, &[number - 1], step, jupiter_mass());
                for (years, theirs) in horizons(u64::from(number)) {
                    while !alone.toward(years, 4096) {}
                    worst[body] = worst[body].max(distance(alone.place(0, years).unwrap(), theirs));
                }
            }
            let mut moved = Moved::with(&elements, &rows, step, jupiter_mass());
            let started = Instant::now();
            let places = [-50.0, 50.0].map(|years| at(&mut moved, years));
            let took = started.elapsed().as_secs_f64();
            let mut offs: Vec<f64> = (0..2)
                .flat_map(|end| {
                    places[end]
                        .iter()
                        .zip(&truth[end])
                        .map(|(a, b)| distance(*a, *b))
                        .collect::<Vec<_>>()
                })
                .collect();
            offs.sort_by(f64::total_cmp);
            println!(
                "step {step}: Hilda {:.5}, Patroclus {:.5}, Hektor {:.5} au from Horizons at worst; \
                 every row at ±50 years against a 256th: median {:.1e}, 99% {:.1e}, 99.9% {:.1e}, worst {:.1e} au; \
                 {:.0} ms for {} steps of {} rows",
                worst[0],
                worst[1],
                worst[2],
                offs[offs.len() / 2],
                offs[offs.len() * 99 / 100],
                offs[offs.len() * 999 / 1000],
                offs[offs.len() - 1],
                took * 1000.0,
                (150.0 / step) as u32,
                rows.len(),
            );
        }
    }

    /// The two groups over the clock's whole reach: every row on its
    /// ellipse's place at the epoch, the Trojans in their clouds at both
    /// ends where the ellipses lose a quarter of them, and the Hildas the
    /// resonance holds.
    #[test]
    #[ignore = "reads data/elements.bin (just kirkwood test)"]
    fn the_groups_hold_for_the_clocks_whole_reach() {
        let elements = elements_file();
        let rows = grouped(&elements);
        let group = |row: u32| {
            let row = row as usize;
            ride::group(elements.get(Element::A, row), elements.get(Element::E, row)).unwrap()
        };
        let mut moved = Moved::new(&elements, &rows);
        assert_eq!(
            moved.rows(),
            rows,
            "every row of the two groups has an ellipse"
        );
        let trojans = rows
            .iter()
            .filter(|&&row| group(row) == Group::Trojans)
            .count();
        assert_eq!((rows.len() - trojans, trojans), (8400, 16_472));

        // On the epoch, every row where its ellipse puts it.
        assert!(moved.toward(0.0, 0));
        for (at, &row) in rows.iter().enumerate() {
            let ellipse = Orbit::of_row(&elements, row as usize).unwrap().place(0.0);
            assert_eq!(moved.place(at, 0.0).unwrap(), ellipse);
        }

        // The Trojans within 30° of the points 60° either side of Jupiter.
        let in_clouds = |places: &mut dyn Iterator<Item = (u32, [f64; 3])>, years: f64| {
            places
                .filter(|&(row, place)| {
                    group(row) == Group::Trojans && (ahead(place, years).abs() - 60.0).abs() <= 30.0
                })
                .count()
        };
        let (first, last) = clock::reach();
        let mut counts = Vec::new();
        // Every hundredth of the reach (a year), and the epoch: the clouds
        // breathe with Jupiter's own turn (it runs ahead of its mean place
        // and behind, and the clouds with it), and don't thin.
        let span = last - first;
        for hundredth in 0..=100 {
            let years = if hundredth == 50 {
                0.0
            } else {
                first + span * f64::from(hundredth) / 100.0
            };
            while !moved.toward(years, 4096) {}
            let integrated = in_clouds(
                &mut rows
                    .iter()
                    .enumerate()
                    .map(|(at, &row)| (row, moved.place(at, years).unwrap())),
                years,
            );
            let ellipses = in_clouds(
                &mut rows.iter().map(|&row| {
                    (
                        row,
                        Orbit::of_row(&elements, row as usize).unwrap().place(years),
                    )
                }),
                years,
            );
            if hundredth % 25 == 0 {
                println!(
                    "{}: {integrated} of the {trojans} Trojans within 30° of the two points, integrated; {ellipses} on their ellipses",
                    clock::date(years)
                );
            }
            counts.push((integrated, ellipses));
        }
        let least = counts.iter().map(|count| count.0).min().unwrap();
        let most = counts.iter().map(|count| count.0).max().unwrap();
        println!("year by year, integrated: from {least} to {most}");
        // On the epoch the two are one; at the ends the ellipses have lost
        // a quarter of the clouds and the integration has kept them.
        assert_eq!(counts[50], (16_048, 16_048));
        for (_, ellipses) in [counts[0], counts[100]] {
            assert!(ellipses < 12_500, "{ellipses}");
        }
        assert!(least > 15_500, "{least}");
        // What a step costs, and a frame's places (natively; the page's
        // are `checks/see.ts`'s to time).
        let started = Instant::now();
        // (From the last day to the first: from the epoch, the shorter way.)
        while !moved.toward(first, 4096) {}
        let a_step = started.elapsed().as_secs_f64() * 1000.0 / (-first / STEP).ceil();
        let at = (first / STEP).floor() * STEP;
        let started = Instant::now();
        for frame in 0..100 {
            moved.places(at + f64::from(frame) * STEP / 100.0).unwrap();
        }
        println!(
            "{a_step:.2} ms a step and {:.2} ms a frame's places, for {} rows",
            started.elapsed().as_secs_f64() * 10.0,
            rows.len()
        );
        // The bytes held for them.
        println!("{} bytes held for {} rows", moved.bytes(), rows.len());
        assert!(moved.bytes() < 3_000_000);
    }

    /// Which Hildas the resonance holds: the rows whose resonant angle
    /// (three of Jupiter's mean longitudes, less two of the row's, less
    /// its perihelion's) never comes round to the far side over a thousand
    /// years. A study: prints, and the count is in `docs/DECISIONS.md`.
    #[test]
    #[ignore = "reads data/elements.bin; a study, run with KIRKWOOD_STUDY set"]
    fn which_hildas_the_resonance_holds() {
        if std::env::var_os("KIRKWOOD_STUDY").is_none() {
            return;
        }
        let elements = elements_file();
        let rows: Vec<u32> = grouped(&elements)
            .into_iter()
            .filter(|&row| {
                let row = row as usize;
                ride::group(elements.get(Element::A, row), elements.get(Element::E, row))
                    == Some(Group::Hildas)
            })
            .collect();
        let mut moved = Moved::new(&elements, &rows);
        // The angle from a row's place and speed: its osculating orbit's
        // mean longitude and its perihelion's.
        let angle = |state: [f64; 3], speed: [f64; 3], years: f64| -> f64 {
            let [x, y, z] = state;
            let [vx, vy, vz] = speed;
            let r = (x * x + y * y + z * z).sqrt();
            let v2 = vx * vx + vy * vy + vz * vz;
            let h = [y * vz - z * vy, z * vx - x * vz, x * vy - y * vx];
            // The eccentricity's vector, toward perihelion.
            let along = x * vx + y * vy + z * vz;
            let e =
                [0, 1, 2].map(|axis| ((v2 - SUN / r) * state[axis] - along * speed[axis]) / SUN);
            let size = (e[0] * e[0] + e[1] * e[1] + e[2] * e[2]).sqrt();
            let node = h[0].atan2(-h[1]);
            let (n, m) = ([node.cos(), node.sin(), 0.0], {
                let hs = (h[0] * h[0] + h[1] * h[1] + h[2] * h[2]).sqrt();
                let h = h.map(|axis| axis / hs);
                [
                    h[1] * 0.0 - h[2] * node.sin(),
                    h[2] * node.cos() - h[0] * 0.0,
                    h[0] * node.sin() - h[1] * node.cos(),
                ]
            });
            let dot = |a: [f64; 3], b: [f64; 3]| a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
            let perihelion = dot(e, m).atan2(dot(e, n));
            let true_anomaly = (dot(state, m).atan2(dot(state, n))) - perihelion;
            let eccentric =
                ((1.0 - size * size).sqrt() * true_anomaly.sin()).atan2(size + true_anomaly.cos());
            let mean = eccentric - size * eccentric.sin();
            let longitude = node + perihelion + mean;
            let jupiter = (JUPITER.node + JUPITER.perihelion + JUPITER.mean_anomaly).to_radians()
                + TAU * JUPITER.turns_a_year * years;
            let turn = (3.0 * jupiter - 2.0 * longitude - (node + perihelion)) / TAU;
            (turn - turn.round()) * 360.0
        };
        let mut most = vec![0.0_f64; rows.len()];
        let mut at_epoch = 0;
        for tick in 0..=4000 {
            let years = f64::from(tick) * 0.25;
            while !moved.toward(years, 4096) {}
            for (row, state) in moved.state.iter().enumerate() {
                // A step's own state: the place, and the speed with
                // Jupiter's kick in it, close enough for an angle.
                let swing = angle(
                    [state[0], state[1], state[2]],
                    [state[3], state[4], state[5]],
                    f64::from(moved.at) * moved.step,
                )
                .abs();
                if tick == 0 && swing < 90.0 {
                    at_epoch += 1;
                }
                most[row] = most[row].max(swing);
            }
        }
        let held = |within: f64| most.iter().filter(|&&swing| swing < within).count();
        println!(
            "of the {} Hildas: {at_epoch} with the angle within 90° of zero on the epoch; over 1000 years it stays within 90° for {}, within 120° for {}, within 150° for {}, and never comes round (within 175°) for {}",
            rows.len(),
            held(90.0),
            held(120.0),
            held(150.0),
            held(175.0),
        );
    }
}
