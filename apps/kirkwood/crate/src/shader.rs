//! The scene's vertex shader, step for step in 32-bit floats
//! (`web/src/scene.ts`, `PLACE`), against the crate's own 64-bit place for
//! the same row: what the shader's arithmetic costs a dot, at the epoch
//! and at the ends of the clock's reach. Tests only; change the shader and
//! this together.
//!
//! An estimate of a GPU, not a reading of one: a GPU's sine and cosine
//! aren't this machine's. The check that reads a real one draws three rows
//! alone and finds them on screen (`checks/see.ts`, `belt`).

use std::f32::consts::{PI, TAU};

use crate::clock;
use crate::elements::{Element, Elements};
use crate::orbit::Orbit;
use crate::orbit::tests::{distance, elements_file};

/// The most steps the shader takes on Kepler's equation (`STEPS`).
const STEPS: usize = 32;

/// How the shader solves Kepler's equation.
#[derive(Clone, Copy, PartialEq, Debug)]
enum Solver {
    /// Six of Newton's steps from M + e sin M: the first shader's way.
    Six,
    /// Newton's steps kept inside the bracket bisection would use, from
    /// π's side for a high e, until one moves it by nothing a float holds:
    /// the scene's way.
    Bracketed,
}

/// E for a mean anomaly from −π to π.
fn eccentric_anomaly(mean: f32, e: f32, solver: Solver) -> f32 {
    if solver == Solver::Six {
        let mut anomaly = mean + e * mean.sin();
        for _ in 0..6 {
            anomaly -= (anomaly - e * anomaly.sin() - mean) / (1.0 - e * anomaly.cos());
        }
        return anomaly;
    }
    let (mut low, mut high) = if mean < 0.0 { (-PI, 0.0) } else { (0.0, PI) };
    let mut anomaly = if e < 0.8 {
        mean + e * mean.sin()
    } else if mean < 0.0 {
        -PI
    } else {
        PI
    };
    for _ in 0..STEPS {
        let off = anomaly - e * anomaly.sin() - mean;
        if off > 0.0 {
            high = anomaly;
        } else {
            low = anomaly;
        }
        let mut next = anomaly - off / (1.0 - e * anomaly.cos());
        if !(next >= low && next <= high) {
            next = 0.5 * (low + high);
        }
        let moved = (next - anomaly).abs();
        anomaly = next;
        if moved < 1e-7 {
            break;
        }
    }
    anomaly
}

/// How the shader is handed the clock.
#[derive(Clone, Copy, PartialEq, Debug)]
enum Clock {
    /// One float of years, times the row's turns a year: the first shader's way.
    Plain,
    /// Whole years and the rest apart, the row's turns a year split in two
    /// so its product with the whole years is exact: the scene's way.
    Split,
}

/// A row's place as the shader computes it.
fn place(elements: &Elements, row: usize, years: f64, clock: Clock, solver: Solver) -> [f64; 3] {
    let get = |element| elements.get(element, row);
    let (a, e) = (get(Element::A), get(Element::E));
    // Turns a year.
    let n = 1.0 / (a * a.sqrt());
    let turned = match clock {
        Clock::Plain => n * years as f32,
        Clock::Split => {
            let whole = years.floor();
            let (whole, part) = (whole as f32, (years - whole) as f32);
            let high = (n * 4096.0).floor() / 4096.0;
            let low = n - high;
            (high * whole).rem_euclid(1.0) + low * whole + n * part
        }
    };
    let mut mean = get(Element::MeanAnomaly).to_radians() + TAU * turned;
    mean -= TAU * (mean / TAU + 0.5).floor();
    let anomaly = eccentric_anomaly(mean, e, solver);
    let x = a * (anomaly.cos() - e);
    let y = a * (1.0 - e * e).sqrt() * anomaly.sin();
    let (so, co) = get(Element::Node).to_radians().sin_cos();
    let (sw, cw) = get(Element::Perihelion).to_radians().sin_cos();
    let (si, ci) = get(Element::I).to_radians().sin_cos();
    [
        f64::from((co * cw - so * sw * ci) * x + (-co * sw - so * cw * ci) * y),
        f64::from((so * cw + co * sw * ci) * x + (-so * sw + co * cw * ci) * y),
        f64::from(sw * si * x + cw * si * y),
    ]
}

/// The opening camera, a copy of `web/src/scene.ts`'s `OPENING` and `FOV`
/// (change them together, or this tests a window nobody opens on): 13 au
/// from the Sun, 24° above the ecliptic, turned 34° about its line of
/// sight, a 40° field of view up and down, in a 1440×900 window. A place
/// on screen: CSS px from the
/// window's center, or none behind the camera or outside the window.
fn on_screen(place: [f64; 3]) -> Option<[f64; 2]> {
    let (az, elev, roll) = (
        200f64.to_radians(),
        24f64.to_radians(),
        (-34f64).to_radians(),
    );
    let (distance, fov, width, height) = (13.0, 40f64.to_radians(), 1440.0, 900.0);
    let dot = |u: [f64; 3], v: [f64; 3]| u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
    let cross = |u: [f64; 3], v: [f64; 3]| {
        [
            u[1] * v[2] - u[2] * v[1],
            u[2] * v[0] - u[0] * v[2],
            u[0] * v[1] - u[1] * v[0],
        ]
    };
    let toward = [elev.cos() * az.sin(), elev.sin(), elev.cos() * az.cos()];
    // "Up" is north, turned about the line of sight.
    let north = [0.0, 1.0, 0.0];
    let turned = cross(toward, north);
    let lean = dot(toward, north) * (1.0 - roll.cos());
    let up: [f64; 3] =
        std::array::from_fn(|k| north[k] * roll.cos() + turned[k] * roll.sin() + toward[k] * lean);
    let right = cross(up, toward);
    let length = dot(right, right).sqrt();
    let right = right.map(|value| value / length);
    let up = cross(toward, right);
    // The scene's axes: the ecliptic's x, north, and minus y.
    let from_eye = [
        place[0] - toward[0] * distance,
        place[2] - toward[1] * distance,
        -place[1] - toward[2] * distance,
    ];
    let depth = -dot(from_eye, toward);
    let focal = height / 2.0 / (fov / 2.0).tan();
    let (x, y) = (
        dot(from_eye, right) / depth * focal,
        dot(from_eye, up) / depth * focal,
    );
    (depth > 0.01 && x.abs() <= width / 2.0 && y.abs() <= height / 2.0).then_some([x, y])
}

struct Off {
    median_au: f64,
    worst_au: f64,
    /// Among the rows in the window.
    worst_px: f64,
    worst_px_row: usize,
    past_a_pixel: usize,
    past_a_tenth: usize,
}

/// The shader's place against the crate's, over every row with an ellipse.
fn off(elements: &Elements, years: f64, clock: Clock, solver: Solver) -> Off {
    let mut au = Vec::with_capacity(elements.rows());
    let (mut worst_px, mut worst_px_row) = (0.0, 0);
    let (mut past_a_pixel, mut past_a_tenth) = (0, 0);
    for row in 0..elements.rows() {
        let Some(orbit) = Orbit::of_row(elements, row) else {
            continue;
        };
        let (ours, shaders) = (
            orbit.place(years),
            place(elements, row, years, clock, solver),
        );
        // A place that isn't a number is as far off as a place gets.
        let apart = distance(ours, shaders);
        au.push(if apart.is_nan() { f64::INFINITY } else { apart });
        if let Some(at) = on_screen(ours) {
            let px = on_screen(shaders).map_or(f64::INFINITY, |shader| {
                ((shader[0] - at[0]).powi(2) + (shader[1] - at[1]).powi(2)).sqrt()
            });
            past_a_pixel += usize::from(px > 1.0);
            past_a_tenth += usize::from(px > 0.1);
            if px > worst_px {
                (worst_px, worst_px_row) = (px, row);
            }
        }
    }
    au.sort_by(f64::total_cmp);
    Off {
        median_au: au[au.len() / 2],
        worst_au: au[au.len() - 1],
        worst_px,
        worst_px_row,
        past_a_pixel,
        past_a_tenth,
    }
}

/// What the shader's 32-bit arithmetic costs, written down
/// (`docs/DECISIONS.md`, "Scene"), and held to: no row in the opening
/// window a pixel off, anywhere the clock goes.
#[test]
#[ignore = "reads data/elements.bin (just kirkwood test)"]
fn the_shaders_floats_keep_every_row_within_a_pixel() {
    let elements = elements_file();
    let (first, last) = clock::reach();
    println!(
        "years from the epoch | the clock | the solver | median au | worst au | worst px in the window (row) | rows past 1 px | past 0.1 px"
    );
    for years in [first, -10.0, 0.0, 10.0, last] {
        for (clock, solver) in [
            (Clock::Plain, Solver::Six),
            (Clock::Plain, Solver::Bracketed),
            (Clock::Split, Solver::Bracketed),
        ] {
            let off = off(&elements, years, clock, solver);
            println!(
                "{years:.2} | {clock:?} | {solver:?} | {:.7} | {:.5} | {:.4} ({}) | {} | {}",
                off.median_au,
                off.worst_au,
                off.worst_px,
                off.worst_px_row,
                off.past_a_pixel,
                off.past_a_tenth
            );
            if (clock, solver) == (Clock::Split, Solver::Bracketed) {
                assert!(
                    off.worst_px < 1.0,
                    "row {} is {} px off, {years} years out",
                    off.worst_px_row,
                    off.worst_px
                );
            }
        }
    }
}
