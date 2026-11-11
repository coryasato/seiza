// The two files, seen: whether the places they give are where the bodies
// are. Reads data/elements.bin and data/rows.bin as the app will (the
// manifest's bytes, each column where it lies) and data/horizons.json
// (horizons.ts), and prints:
//
//   bodies    a few known asteroids against JPL Horizons' own places, at
//             the epoch and up to 50 years either side
//   jupiter   Jupiter's place three ways against Horizons: its elements at
//             the epoch on a two-body orbit (jupiter.ts), the same with a
//             row's mean motion, and JPL's approximate elements with rates
//   trojans   the rows of class TJN by their longitude from Jupiter's
//   hildas    the rows between 3.7 and 4.2 au: who they are, and where the
//             corners of their triangle point
//
// Usage: node apps/kirkwood/data/places.ts [--date 2026-06-09] [--only bodies,jupiter,trojans,hildas]
//
// Writes data/raw/study/places.json (gitignored) beside what it prints.
// The numbers it found are in docs/DECISIONS.md, "Data" and "Scene".

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
// The type alone: importing the script would run its fetch.
import type { Horizons } from './horizons.ts';
import { JUPITER, JUPITER_APPROX, jupiterMeanLongitude, jupiterPlace } from './jupiter.ts';
import { DEGREES, EPOCH_JD, GAUSS, isBound, julian, nearestTurn, place } from './orbit.ts';

const dataDir = dirname(fileURLToPath(import.meta.url));
const option = (name: string): string | undefined => {
  const at = process.argv.indexOf(`--${name}`);
  return at > 0 ? process.argv[at + 1] : undefined;
};
const only = (option('only') ?? 'bodies,jupiter,trojans,hildas').split(',');
const DATE = option('date') ?? '2026-06-09';

// --- The files, as the manifest pins them.

interface Placed {
  name: string;
  kind: 'f32' | 'u32' | 'i32' | 'u16' | 'u8';
  offset: number;
  bytes: number;
}
interface Pinned {
  rows: number;
  sha256: string;
  layout: Placed[];
  classes?: string[];
}
const manifest = JSON.parse(readFileSync(join(dataDir, 'MANIFEST.json'), 'utf8')) as Record<string, Pinned>;
function pinned(name: string): { pin: Pinned; bytes: Buffer } {
  const pin = manifest[name]!;
  const bytes = readFileSync(join(dataDir, name));
  if (createHash('sha256').update(bytes).digest('hex') !== pin.sha256) throw new Error(`${name} isn't the manifest's (run prep.ts)`);
  return { pin, bytes };
}
const column = <T>(file: { pin: Pinned; bytes: Buffer }, name: string, as: new (buffer: ArrayBufferLike, offset: number, length: number) => T): T => {
  const at = file.pin.layout.find((section) => section.name === name);
  if (!at) throw new Error(`no section ${name}`);
  return new as(file.bytes.buffer, file.bytes.byteOffset + at.offset, file.pin.rows);
};

const elementsFile = pinned('elements.bin');
const rowsFile = pinned('rows.bin');
const rows = elementsFile.pin.rows;
if (elementsFile.bytes.readDoubleLE(8) !== EPOCH_JD) throw new Error("the elements file's epoch isn't orbit.ts's");
const [a, e, i, om, w, ma] = ['a', 'e', 'i', 'om', 'w', 'ma'].map((name) => column(elementsFile, name, Float32Array)) as [Float32Array, Float32Array, Float32Array, Float32Array, Float32Array, Float32Array];
const spkid = column(rowsFile, 'spkid', Uint32Array);
const classOf = column(rowsFile, 'class', Uint8Array);
const classes = rowsFile.pin.classes!;

const horizons = JSON.parse(readFileSync(join(dataDir, 'horizons.json'), 'utf8')) as Horizons;
// jupiter.ts holds a copy of the reference's elements for Jupiter, so a page
// can import them: a refetch that moved one must move the other.
for (const [name, value] of Object.entries(horizons.jupiter.elements)) {
  if (JUPITER[name as keyof typeof JUPITER] !== value) throw new Error(`jupiter.ts's ${name} isn't horizons.json's (${JUPITER[name as keyof typeof JUPITER]} against ${value})`);
}
if (JUPITER.jd !== EPOCH_JD) throw new Error("Jupiter's elements aren't at the files' epoch");
const at = new Float64Array(3);
/** A row's place `days` after the epoch, from the file's floats. */
const rowPlace = (row: number, days: number): [number, number, number] => {
  place(a[row]!, e[row]!, i[row]!, om[row]!, w[row]!, ma[row]!, days, at);
  return [at[0]!, at[1]!, at[2]!];
};
const apart = (one: readonly number[], other: readonly number[]): number => Math.hypot(one[0]! - other[0]!, one[1]! - other[1]!, one[2]! - other[2]!);
/** A place's ecliptic longitude, degrees. */
const longitude = (xyz: readonly number[]): number => Math.atan2(xyz[1]!, xyz[0]!) / DEGREES;
/** The angle between two places as the Sun sees them, degrees. */
const between = (one: readonly number[], other: readonly number[]): number => {
  const dot = (one[0]! * other[0]! + one[1]! * other[1]! + one[2]! * other[2]!) / (Math.hypot(...one) * Math.hypot(...other));
  return Math.acos(Math.min(1, dot)) / DEGREES;
};

const result: Record<string, unknown> = { files: { elements: elementsFile.pin.sha256, rows: rowsFile.pin.sha256 }, horizons: horizons.fetched };

// --- Known bodies against Horizons.

if (only.includes('bodies')) {
  const table: Record<string, Record<string, string>> = {};
  const bodies = horizons.asteroids.map((body) => {
    // A numbered asteroid's row is its number less one, and its key says so.
    const row = body.number - 1;
    if (spkid[row] !== 20_000_000 + body.number) throw new Error(`row ${row} isn't asteroid ${body.number}`);
    const off = horizons.dates.map(({ jd }, date) => {
      const mine = rowPlace(row, jd - EPOCH_JD);
      return { au: apart(mine, body.places[date]!), degrees: between(mine, body.places[date]!) };
    });
    table[body.name] = Object.fromEntries(horizons.dates.map(({ date }, at) => [date, `${off[at]!.au.toExponential(1)} au`]));
    return { name: body.name, solution: body.solution, off };
  });
  console.log("Each body's place from the file against Horizons':");
  console.table(table);
  result.bodies = { dates: horizons.dates, bodies };
}

// --- Jupiter.

/** JPL's approximate elements and their rates (jupiter.ts), as a place. */
function approxPlace(jd: number): [number, number, number] {
  const T = (jd - 2451545.0) / 36525;
  const [el, rate] = [JUPITER_APPROX.elements, JUPITER_APPROX.rates];
  const [A, E, I, L, peri, node] = el.map((value, at) => value + rate[at]! * T) as [number, number, number, number, number, number];
  place(A, E, I, node, peri - node, nearestTurn(L - peri), 0, at);
  return [at[0]!, at[1]!, at[2]!];
}

if (only.includes('jupiter')) {
  const table: Record<string, Record<string, string>> = {};
  const models: Record<string, (jd: number) => [number, number, number]> = {
    "its elements at the epoch, its own mean motion (jupiter.ts)": (jd) => jupiterPlace(jd - EPOCH_JD),
    "its elements at the epoch, a row's mean motion": (jd) => {
      place(JUPITER.a, JUPITER.e, JUPITER.i, JUPITER.om, JUPITER.w, JUPITER.ma, jd - EPOCH_JD, at);
      return [at[0]!, at[1]!, at[2]!];
    },
    "JPL's approximate elements with rates (1800 to 2050)": approxPlace,
  };
  const out: Record<string, { au: number; degrees: number }[]> = {};
  for (const [name, model] of Object.entries(models)) {
    out[name] = horizons.dates.map(({ jd }, date) => ({ au: apart(model(jd), horizons.jupiter.places[date]!), degrees: nearestTurn(longitude(model(jd)) - longitude(horizons.jupiter.places[date]!)) }));
    table[name] = Object.fromEntries(horizons.dates.map(({ date }, at) => [date, `${out[name]![at]!.au.toFixed(4)} au, ${out[name]![at]!.degrees.toFixed(3)}°`]));
  }
  console.log("Jupiter's place against Horizons' (the distance, and the longitude's error):");
  console.table(table);
  result.jupiter = { dates: horizons.dates, models: out };
}

// --- The resonant groups, at one date.

const days = julian(DATE) - EPOCH_JD;
const jupiter = jupiterPlace(days);
const pinnedDate = horizons.dates.findIndex(({ date }) => date === DATE);
if (pinnedDate >= 0) console.log(`Jupiter on ${DATE}: longitude ${longitude(jupiter).toFixed(3)}°, ${apart(jupiter, horizons.jupiter.places[pinnedDate]!).toExponential(1)} au from Horizons' place`);
/** A row's longitude from Jupiter's, -180 to 180: ahead of it is positive. */
const fromJupiter = (xyz: readonly number[]): number => nearestTurn(longitude(xyz) - longitude(jupiter));
const BIN = 10;
const histogram = (values: number[]): number[] => {
  const bins = new Array<number>(360 / BIN).fill(0);
  for (const value of values) bins[Math.min(bins.length - 1, Math.floor((value + 180) / BIN))]!++;
  return bins;
};
const bars = (bins: number[], label = (at: number) => `${String(-180 + at * BIN).padStart(5)}°`): string => {
  const most = Math.max(...bins);
  return bins.map((count, at) => `${label(at)} ${String(count).padStart(6)} ${'#'.repeat(Math.round((count / most) * 60))}`).join('\n');
};
const medianOf = (values: number[]): number => [...values].sort((x, y) => x - y)[values.length >> 1]!;

if (only.includes('trojans')) {
  const TJN = classes.indexOf('TJN');
  const longitudes: number[] = [];
  for (let row = 0; row < rows; row++) if (classOf[row] === TJN) longitudes.push(fromJupiter(rowPlace(row, days)));
  const bins = histogram(longitudes);
  const [ahead, behind] = [longitudes.filter((value) => value > 0), longitudes.filter((value) => value < 0)];
  const peak = (from: number, to: number) => {
    let best = from;
    for (let at = from; at < to; at++) if (bins[at]! > bins[best]!) best = at;
    return -180 + best * BIN;
  };
  const within = (center: number, reach: number) => longitudes.filter((value) => Math.abs(value - center) <= reach).length;
  const summary = {
    date: DATE,
    rows: longitudes.length,
    ahead: { rows: ahead.length, median: medianOf(ahead), peakBin: peak(18, 36) },
    behind: { rows: behind.length, median: medianOf(behind), peakBin: peak(0, 18) },
    within30: { ahead: within(60, 30), behind: within(-60, 30) },
    /** Within 20° of Jupiter itself, and of the point opposite it. */
    nearJupiter: within(0, 20),
    opposite: longitudes.filter((value) => Math.abs(value) >= 160).length,
  };
  console.log(`\nThe ${longitudes.length} rows of class TJN on ${DATE}, by longitude from Jupiter's (ahead is positive), ${BIN}° a bin:`);
  console.log(bars(bins));
  console.log(summary);
  result.trojans = { ...summary, binDegrees: BIN, bins };
}

if (only.includes('hildas')) {
  // Between 3.7 and 4.2 au, as the plan expected; and the usual narrower
  // rule (e under 0.3, i under 20°), to say what the a alone lets in.
  const [LOW, HIGH] = [3.7, 4.2];
  const byClass: Record<string, number> = {};
  const narrow = { rows: 0, held: 0 };
  // The 3:2 resonance's own test: three of Jupiter's mean longitudes less
  // two of the row's and its perihelion's swings about zero for a row the
  // resonance holds, and takes any value for one it doesn't. At one date,
  // how many are within 90° of zero (half would be, by chance).
  let held = 0;
  const angles = new Array<number>(360 / BIN).fill(0);
  const longitudes: number[] = [];
  const far: number[] = [];
  // The triangle: the rows on the far half of their orbit crowd toward
  // its corners. Where they crowd, as the phase of the first term of their
  // count that repeats three times a turn.
  let [cos3, sin3, sumR] = [0, 0, 0];
  const radius = { sum: new Array<number>(360 / BIN).fill(0), count: new Array<number>(360 / BIN).fill(0) };
  for (let row = 0; row < rows; row++) {
    if (!(a[row]! >= LOW && a[row]! <= HIGH) || !isBound(a[row]!, e[row]!)) continue;
    byClass[classes[classOf[row]!]!] = (byClass[classes[classOf[row]!]!] ?? 0) + 1;
    const mean = om[row]! + w[row]! + ma[row]! + (GAUSS / DEGREES / a[row]! ** 1.5) * days;
    const angle = nearestTurn(3 * jupiterMeanLongitude(days) - 2 * mean - (om[row]! + w[row]!));
    angles[Math.min(angles.length - 1, Math.floor((angle + 180) / BIN))]!++;
    if (Math.abs(angle) < 90) held++;
    if (e[row]! < 0.3 && i[row]! < 20) {
      narrow.rows++;
      if (Math.abs(angle) < 90) narrow.held++;
    }
    const xyz = rowPlace(row, days);
    const lon = fromJupiter(xyz);
    const r = Math.hypot(...xyz);
    longitudes.push(lon);
    sumR += r;
    if (r > a[row]!) {
      far.push(lon);
      cos3 += Math.cos(3 * lon * DEGREES);
      sin3 += Math.sin(3 * lon * DEGREES);
    }
    const bin = Math.min(radius.sum.length - 1, Math.floor((lon + 180) / BIN));
    radius.sum[bin]! += r;
    radius.count[bin]!++;
  }
  // count ~ mean + amplitude cos(3 (lon - corner)): the corners at
  // `corner`, and 120° either side of it.
  const corner = Math.atan2(sin3, cos3) / DEGREES / 3;
  const corners = [corner - 120, corner, corner + 120].map((value) => nearestTurn(value)).sort((x, y) => x - y);
  // The resonance holds a Hilda's far point 60°, 180°, or 300° from
  // Jupiter's mean longitude, which Jupiter's place runs ahead of or
  // behind by up to 5.5° (its own eccentricity).
  const lead = nearestTurn(longitude(jupiter) - jupiterMeanLongitude(days));
  const meanRadius = radius.sum.map((sum, at) => (radius.count[at] ? sum / radius.count[at]! : NaN));
  const summary = {
    date: DATE,
    rule: `a from ${LOW} to ${HIGH} au, on an ellipse`,
    rows: longitudes.length,
    byClass,
    /** Rows whose resonant angle is within 90° of zero at this date. */
    held,
    /** Those with e under 0.3 and i under 20° as well, and how many of them the angle holds. */
    alsoLowEAndI: narrow,
    meanAu: sumR / longitudes.length,
    farHalf: far.length,
    /** Where the triangle's corners point, from Jupiter's place. */
    corners,
    /** How far Jupiter's place is ahead of its mean longitude. */
    jupiterLead: lead,
    /** The corners from Jupiter's mean longitude: -60°, 60°, and 180° is the expectation. */
    cornersFromMean: corners.map((value) => nearestTurn(value + lead)).sort((x, y) => x - y),
  };
  console.log(`\nThe ${longitudes.length} rows with a from ${LOW} to ${HIGH} au on ${DATE}: their mean distance from the Sun (au) by longitude from Jupiter's, ${BIN}° a bin:`);
  // A bin with no row has no mean: it draws no bar, and doesn't set the scale.
  const means = meanRadius.filter(Number.isFinite);
  const [least, most] = [Math.min(...means), Math.max(...means)];
  console.log(meanRadius.map((mean, at) => `${String(-180 + at * BIN).padStart(5)}° ${Number.isFinite(mean) ? `${mean.toFixed(3)} ${'#'.repeat(Math.round(((mean - least) / (most - least || 1)) * 60))}` : 'no rows'}`).join('\n'));
  console.log(`\nThose of them on the far half of their orbit (past their a), by longitude from Jupiter's:`);
  console.log(bars(histogram(far)));
  console.log(`\nTheir resonant angle (three of Jupiter's mean longitudes, less two of the row's, less its perihelion's):`);
  console.log(bars(angles));
  console.log(summary);
  result.hildas = { resonantAngleBins: angles, ...summary, binDegrees: BIN, meanRadius, farBins: histogram(far), bins: histogram(longitudes) };
}

mkdirSync(join(dataDir, 'raw/study'), { recursive: true });
writeFileSync(join(dataDir, 'raw/study/places.json'), `${JSON.stringify(result, null, 2)}\n`);
