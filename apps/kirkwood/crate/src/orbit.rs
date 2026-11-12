//! A two-body orbit in 64-bit floats: where its six elements put a body at
//! a time on the clock (`docs/data.md`, "A place"). The crate's own place
//! for a row, which the scene's 32-bit shader is checked against, and
//! Jupiter's ([`JUPITER`]), which isn't a row and so isn't in the files.
//!
//! Places are heliocentric, in the ecliptic of J2000: x, y, z in au.

use std::f64::consts::{PI, TAU};

use crate::elements::{Element, Elements, YEAR_DAYS};

/// An ellipse and where its body was on it at the elements' epoch.
#[derive(Debug, Clone, Copy)]
pub struct Orbit {
    /// The semi-major axis, au.
    pub a: f64,
    pub e: f64,
    /// The inclination, the node's longitude, the argument of perihelion,
    /// and the mean anomaly at the epoch: degrees.
    pub i: f64,
    pub node: f64,
    pub perihelion: f64,
    pub mean_anomaly: f64,
    /// The mean motion, in turns for each of the clock's years.
    pub turns_a_year: f64,
}

/// Jupiter's osculating elements at the files' epoch, from JPL Horizons
/// (body 599 about the Sun's center, the ecliptic of J2000;
/// `data/horizons.json` holds the same numbers, and the test below reads
/// them from it). Its mean motion is its own, 0.0830846 degrees a day,
/// which counts its mass: a row's would run it most of a degree slow in 50
/// years (`docs/DECISIONS.md`, "Scene").
pub const JUPITER: Orbit = Orbit {
    a: 5.203_080_405_012_691,
    e: 0.048_225_346_702_678_95,
    i: 1.303_446_053_841_26,
    node: 100.515_486_170_407,
    perihelion: 273.674_643_339_996_5,
    mean_anomaly: 102.467_574_738_701,
    turns_a_year: 0.083_084_585_326_194_57 * YEAR_DAYS / 360.0,
};

impl Orbit {
    /// A row's orbit, from the floats the elements file holds; none for a
    /// row with no ellipse. A row's mean motion counts no mass of its own:
    /// one turn in a^1.5 of the clock's years.
    pub fn of_row(elements: &Elements, row: usize) -> Option<Self> {
        if !elements.is_bound(row) {
            return None;
        }
        let get = |element| f64::from(elements.get(element, row));
        let a = get(Element::A);
        Some(Self {
            a,
            e: get(Element::E),
            i: get(Element::I),
            node: get(Element::Node),
            perihelion: get(Element::Perihelion),
            mean_anomaly: get(Element::MeanAnomaly),
            turns_a_year: 1.0 / (a * a.sqrt()),
        })
    }

    /// Where the body is, `years` of the clock after the epoch.
    pub fn place(&self, years: f64) -> [f64; 3] {
        let turns = self.mean_anomaly / 360.0 + self.turns_a_year * years;
        // The turn nearest zero.
        let mean = (turns - turns.round()) * TAU;
        let anomaly = eccentric_anomaly(mean, self.e);
        // In the orbit's own plane, x toward perihelion.
        let x = self.a * (anomaly.cos() - self.e);
        let y = self.a * (1.0 - self.e * self.e).sqrt() * anomaly.sin();
        // Turned by the argument of perihelion, tilted by the inclination,
        // turned by the node.
        let (so, co) = self.node.to_radians().sin_cos();
        let (sw, cw) = self.perihelion.to_radians().sin_cos();
        let (si, ci) = self.i.to_radians().sin_cos();
        [
            (co * cw - so * sw * ci) * x + (-co * sw - so * cw * ci) * y,
            (so * cw + co * sw * ci) * x + (-so * sw + co * cw * ci) * y,
            sw * si * x + cw * si * y,
        ]
    }

    /// The size of an orbit in step with this one, au: it turns `turns`
    /// times while this turns `ours` (Kepler's third law: the period goes
    /// as a^1.5). Where this body's pull on it adds up, turn after turn.
    pub fn in_step(&self, turns: u32, ours: u32) -> f64 {
        self.a * (f64::from(ours) / f64::from(turns)).powf(2.0 / 3.0)
    }

    /// One turn of the orbit as `points` places, for a line.
    pub fn outline(&self, points: usize) -> Vec<[f64; 3]> {
        (0..points)
            .map(|point| self.place(point as f64 / points as f64 / self.turns_a_year))
            .collect()
    }
}

/// Kepler's equation, E − e sin E = M, for M from −π to π and e below 1.
pub fn eccentric_anomaly(mean: f64, e: f64) -> f64 {
    // Newton's steps from a start that can't overshoot (π's side for a
    // high e), each kept inside the bracket bisection would use.
    let (mut low, mut high) = if mean < 0.0 { (-PI, 0.0) } else { (0.0, PI) };
    let mut anomaly = if e < 0.8 {
        mean + e * mean.sin()
    } else if mean < 0.0 {
        -PI
    } else {
        PI
    };
    for _ in 0..60 {
        let off = anomaly - e * anomaly.sin() - mean;
        if off > 0.0 {
            high = anomaly;
        } else {
            low = anomaly;
        }
        let mut next = anomaly - off / (1.0 - e * anomaly.cos());
        if !(next >= low && next <= high) {
            next = (low + high) / 2.0;
        }
        if (next - anomaly).abs() < 1e-15 {
            return next;
        }
        anomaly = next;
    }
    anomaly
}

#[cfg(test)]
pub(crate) mod tests {
    use std::path::Path;

    use super::{JUPITER, Orbit, eccentric_anomaly};
    use crate::bytes::Bytes;
    use crate::elements::{EPOCH_JD, Elements, YEAR_DAYS};

    pub(crate) fn distance(a: [f64; 3], b: [f64; 3]) -> f64 {
        ((a[0] - b[0]).powi(2) + (a[1] - b[1]).powi(2) + (a[2] - b[2]).powi(2)).sqrt()
    }

    /// The elements file, as built (`data/prep.ts`).
    pub(crate) fn elements_file() -> Elements {
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../data/elements.bin");
        let bytes = std::fs::read(&path)
            .unwrap_or_else(|why| panic!("{}: {why} (run data/prep.ts)", path.display()));
        Elements::new(Bytes::from_bytes(&bytes)).unwrap()
    }

    /// JPL Horizons' own places (`data/horizons.json`): the dates as the
    /// clock's years, and a body's place at each.
    fn horizons() -> (Vec<f64>, serde_json::Value) {
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../data/horizons.json");
        let json: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
        let years = json["dates"]
            .as_array()
            .unwrap()
            .iter()
            .map(|date| (date["jd"].as_f64().unwrap() - EPOCH_JD) / YEAR_DAYS)
            .collect();
        (years, json)
    }

    fn places(body: &serde_json::Value) -> Vec<[f64; 3]> {
        body["places"]
            .as_array()
            .unwrap()
            .iter()
            .map(|place| {
                let at = |axis: usize| place[axis].as_f64().unwrap();
                [at(0), at(1), at(2)]
            })
            .collect()
    }

    #[test]
    fn keplers_equation_is_solved() {
        for e in [0.0, 0.1, 0.5, 0.8, 0.95, 0.999, 0.999_999] {
            for step in -100..=100 {
                let mean = f64::from(step) / 100.0 * std::f64::consts::PI;
                let anomaly = eccentric_anomaly(mean, e);
                assert!(
                    (anomaly - e * anomaly.sin() - mean).abs() < 1e-12,
                    "e {e}, M {mean}"
                );
            }
        }
    }

    #[test]
    fn jupiter_is_where_horizons_says() {
        let (years, json) = horizons();
        let jupiter = &json["jupiter"];
        // The elements held here are the ones Horizons gave.
        let held = [
            ("a", JUPITER.a),
            ("e", JUPITER.e),
            ("i", JUPITER.i),
            ("om", JUPITER.node),
            ("w", JUPITER.perihelion),
            ("ma", JUPITER.mean_anomaly),
            ("n", JUPITER.turns_a_year * 360.0 / YEAR_DAYS),
        ];
        for (name, value) in held {
            let given = jupiter["elements"][name].as_f64().unwrap();
            assert!((value - given).abs() <= 1e-14 * given.abs(), "{name}");
        }
        assert_eq!(years.len(), 8);
        let mut worst: f64 = 0.0;
        for (years, place) in years.iter().zip(places(jupiter)) {
            let off = distance(JUPITER.place(*years), place);
            assert!(
                off < 0.01,
                "{off} au from Horizons' place, {years} years out"
            );
            worst = worst.max(off);
        }
        println!("Jupiter: {worst:.4} au from Horizons' place at worst, over its eight dates");
        // The control: a row's mean motion, which counts no mass, isn't
        // good enough.
        let massless = Orbit {
            turns_a_year: 1.0 / JUPITER.a.powf(1.5),
            ..JUPITER
        };
        let off = distance(massless.place(years[0]), places(jupiter)[0]);
        assert!(off > 0.01, "the control passes: {off} au");
    }

    #[test]
    fn an_orbit_in_step_with_jupiter_has_its_period_in_whole_numbers() {
        // The Hildas turn three times to Jupiter's two, the Trojans once to
        // its once.
        assert!((JUPITER.in_step(3, 2) - 3.97).abs() < 0.005);
        assert_eq!(JUPITER.in_step(1, 1), JUPITER.a);
        let a = JUPITER.in_step(3, 1);
        assert!((a.powf(1.5) * 3.0 - JUPITER.a.powf(1.5)).abs() < 1e-12);
    }

    #[test]
    fn an_orbits_outline_closes() {
        let outline = JUPITER.outline(256);
        assert_eq!(outline.len(), 256);
        assert!(distance(outline[0], JUPITER.place(0.0)) < 1e-12);
        // A point is a 256th of the way round from the last.
        let step = distance(outline[0], outline[255]);
        assert!(step > 0.1 && step < 0.14, "{step}");
    }

    /// The crate's place for a row is JPL's, at the epoch: the frame, the
    /// angles' order, the units, and the file's floats in one number.
    #[test]
    #[ignore = "reads data/elements.bin (just kirkwood test)"]
    fn rows_are_where_horizons_says_at_the_epoch() {
        let elements = elements_file();
        let (years, json) = horizons();
        let epoch = years.iter().position(|years| *years == 0.0).unwrap();
        for asteroid in json["asteroids"].as_array().unwrap() {
            // A numbered asteroid's row is its number less one.
            let row = asteroid["number"].as_u64().unwrap() as usize - 1;
            let orbit = Orbit::of_row(&elements, row).unwrap();
            let theirs = places(asteroid);
            let off = distance(orbit.place(0.0), theirs[epoch]);
            assert!(off < 2e-6, "{}: {off} au at the epoch", asteroid["name"]);
            // And a picture of the belt, not an ephemeris, far from it.
            for (years, place) in years.iter().zip(&theirs) {
                let off = distance(orbit.place(*years), *place);
                let limit = if years.abs() < 11.0 { 0.15 } else { 3.0 };
                assert!(
                    off < limit,
                    "{}: {off} au, {years} years out",
                    asteroid["name"]
                );
            }
        }
    }
}
