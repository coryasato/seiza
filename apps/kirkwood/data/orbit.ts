// A two-body orbit: the files' epoch and clock, and the place six elements
// give. No dependencies and no file access, so a page can import it (the
// spike's scene does, for Jupiter).

/** The epoch every row is brought to: a Julian day, TDB (2026-06-09). */
export const EPOCH_JD = 2461200.5;
/** The Gaussian constant: a massless body's mean motion at 1 au, radians a day. */
export const GAUSS = 0.01720209895;
/** One turn of a 1 au orbit, in days: the year the scene's clock counts in. */
export const GAUSS_YEAR_DAYS = (2 * Math.PI) / GAUSS;
export const DEGREES = Math.PI / 180;
/** The Julian day of a `YYYY-MM-DD` at 0h. */
export const julian = (date: string): number => Date.parse(`${date}T00:00:00Z`) / 86_400_000 + 2440587.5;

/** Whether a and e are an ellipse's. */
export const isBound = (a: number, e: number): boolean => e < 1 && a > 0;
/** An angle in degrees, as the turn nearest zero: -180 to 180. */
export const nearestTurn = (degrees: number): number => degrees - 360 * Math.round(degrees / 360);

/**
 * Where a bound orbit's body is, `days` after the epoch: heliocentric
 * ecliptic x, y, z in au, written into `out` at `at`. Angles in degrees.
 * `motion` is the mean motion in degrees a day; a row's is the Gaussian
 * constant over a^1.5, a planet's is its own.
 */
export function place(a: number, e: number, i: number, om: number, w: number, ma: number, days: number, out: Float64Array, at = 0, motion = GAUSS / DEGREES / a ** 1.5): void {
  orbitFrame(i, om, w, FRAME);
  placeInFrame(a, e, nearestTurn(ma + motion * days) * DEGREES, FRAME, 0, out, at);
}
const FRAME = new Float64Array(6);

/**
 * An orbit's own axes in the ecliptic's: toward its perihelion (x, y, z),
 * then a quarter turn on along the orbit, six numbers into `out` at `at`.
 * They hold for every date, so a row's many places share one.
 */
export function orbitFrame(i: number, om: number, w: number, out: Float64Array, at = 0): void {
  const [co, so] = [Math.cos(om * DEGREES), Math.sin(om * DEGREES)];
  const [cw, sw] = [Math.cos(w * DEGREES), Math.sin(w * DEGREES)];
  const [ci, si] = [Math.cos(i * DEGREES), Math.sin(i * DEGREES)];
  out[at] = co * cw - so * sw * ci;
  out[at + 1] = so * cw + co * sw * ci;
  out[at + 2] = sw * si;
  out[at + 3] = -co * sw - so * cw * ci;
  out[at + 4] = -so * sw + co * cw * ci;
  out[at + 5] = cw * si;
}

/** The place at a mean anomaly (radians, -pi to pi), in an `orbitFrame`. */
export function placeInFrame(a: number, e: number, mean: number, frame: Float64Array, frameAt: number, out: Float64Array, at = 0): void {
  const E = eccentricAnomaly(mean, e);
  const xo = a * (Math.cos(E) - e);
  const yo = a * Math.sqrt(1 - e * e) * Math.sin(E);
  out[at] = frame[frameAt]! * xo + frame[frameAt + 3]! * yo;
  out[at + 1] = frame[frameAt + 1]! * xo + frame[frameAt + 4]! * yo;
  out[at + 2] = frame[frameAt + 2]! * xo + frame[frameAt + 5]! * yo;
}

/** Kepler's equation, E - e sin E = M, for M in -pi to pi and e below 1. */
export function eccentricAnomaly(mean: number, e: number): number {
  // Newton's steps from a start that can't overshoot (pi's side for a high
  // e), each kept inside the bracket [low, high] that bisection would use.
  let [low, high] = mean < 0 ? [-Math.PI, 0] : [0, Math.PI];
  let E = e < 0.8 ? mean + e * Math.sin(mean) : mean < 0 ? -Math.PI : Math.PI;
  for (let step = 0; step < 60; step++) {
    const off = E - e * Math.sin(E) - mean;
    if (off > 0) high = E;
    else low = E;
    let next = E - off / (1 - e * Math.cos(E));
    if (!(next >= low && next <= high)) next = (low + high) / 2;
    if (Math.abs(next - E) < 1e-15) return next;
    E = next;
  }
  return E;
}
