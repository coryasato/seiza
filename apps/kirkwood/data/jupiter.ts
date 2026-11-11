// Jupiter's orbit: not a row of the table, so not in the files. Its place
// is one two-body orbit from the files' epoch, as every row's is. No
// dependencies and no file access: a page can import it.

import { EPOCH_JD, place } from './orbit.ts';

/**
 * Jupiter's osculating elements at the files' epoch (JD 2461200.5 TDB),
 * from JPL Horizons (body 599 about the Sun's center, ecliptic of J2000,
 * fetched 2026-11-11: data/horizons.json holds the same numbers): au,
 * degrees, and its mean motion in degrees a day, which counts its own mass
 * (a row's doesn't: the Gaussian constant over a^1.5 would run it 0.05%
 * slow, 0.7° in 50 years).
 */
export const JUPITER = {
  jd: EPOCH_JD,
  a: 5.203080405012691,
  e: 0.04822534670267895,
  i: 1.30344605384126,
  om: 100.515486170407,
  w: 273.6746433399965,
  ma: 102.467574738701,
  n: 0.08308458532619457,
} as const;

/** Where Jupiter is, `days` after the files' epoch: heliocentric ecliptic x, y, z in au. */
export function jupiterPlace(days: number): [number, number, number] {
  place(JUPITER.a, JUPITER.e, JUPITER.i, JUPITER.om, JUPITER.w, JUPITER.ma, days, AT, 0, JUPITER.n);
  return [AT[0]!, AT[1]!, AT[2]!];
}
const AT = new Float64Array(3);

/** Jupiter's mean longitude, `days` after the files' epoch (degrees): where it would be on a circle. */
export const jupiterMeanLongitude = (days: number): number => JUPITER.om + JUPITER.w + JUPITER.ma + JUPITER.n * days;

/**
 * JPL's approximate elements for Jupiter and their rates a century, "valid
 * for 1800 to 2050" (ssd.jpl.nasa.gov/planets/approx_pos.html, Standish
 * and Williams): a (au), e, I, the mean longitude, the longitude of
 * perihelion, and the node (degrees), from J2000 (JD 2451545.0). Kept to
 * weigh the two-body orbit above against (places.ts), not used to draw.
 */
export const JUPITER_APPROX = {
  elements: [5.202887, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909],
  rates: [-0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106],
} as const;
