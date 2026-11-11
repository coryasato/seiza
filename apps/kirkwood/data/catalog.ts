// The fetch as prep and its studies read it: every row once, in the
// catalog's own order, its six elements at the one epoch, in 64-bit floats;
// and the two-body place those elements give. No dependencies.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FIELDS, rawDir, type FetchInfo, type Page } from './fetch.ts';

export type Cell = string | number | null;

/** The epoch every row is brought to: a Julian day, TDB (2026-06-09). */
export const EPOCH_JD = 2461200.5;
/** The Gaussian constant: a massless body's mean motion at 1 au, radians a day. */
export const GAUSS = 0.01720209895;
/** One turn of a 1 au orbit, in days: the year the scene's clock counts in. */
export const GAUSS_YEAR_DAYS = (2 * Math.PI) / GAUSS;
export const DEGREES = Math.PI / 180;

export const field = (name: string): number => {
  const index = FIELDS.indexOf(name);
  if (index < 0) throw new Error(`no field ${name}`);
  return index;
};

/** A fetch's rows, one per spkid: a page read later wins. */
export function readRows(dir: string, fields: string[]): Map<number, Cell[]> {
  const rows = new Map<number, Cell[]>();
  for (const name of readdirSync(dir).filter((name) => /^page-\d{4}\.json$/.test(name)).sort()) {
    const page = JSON.parse(readFileSync(join(dir, name), 'utf8')) as Page;
    if (page.fields.join(',') !== fields.join(',')) throw new Error(`${join(dir, name)}: unexpected fields ${page.fields.join(',')}`);
    for (const row of page.data) rows.set(Number(row[0]), row);
  }
  return rows;
}

// --- The provisional designation, packed.
//
// Every asteroid has one: the name it was given when found ("1998 FV113"),
// which is `pdes` until it's numbered and stays in `full_name`'s parentheses
// after. Each fits 32 bits, in the order they were given out (by year, then
// half-month, then within it: AA, AB, ... AZ, AA1, AB1, ...), so a sort by
// designation is a sort of integers:
//
//   bit 31       0: a year and letters; 1: a survey's ("4109 P-L")
//   bits 23..30  the year, from 1800
//   bits 18..22  the half-month's letter, from A
//   bits 6..17   the number after the letters; 0 for none
//   bits 1..5    the second letter, from A, plus 1; 0 for none ("2017 U1")
//   bit 0        the prefix "A/" (an asteroid on a comet's orbit)
//
//   a survey's: bits 14..15 which (P-L, T-1, T-2, T-3), bits 0..13 its number
//
// A year before 1925 is written the old way, "A801 AA" for 1801. The
// surveys' (1960 to 1977) sort after every other, out of their dates' order.

const SURVEYS = ['P-L', 'T-1', 'T-2', 'T-3'];

export function packDesignation(text: string): number {
  const survey = /^(\d{4}) (P-L|T-1|T-2|T-3)$/.exec(text);
  if (survey) return (0x8000_0000 | (SURVEYS.indexOf(survey[2]!) << 14) | Number(survey[1])) >>> 0;
  const parts = /^(A\/)?(A\d{3}|\d{4}) ([A-Z])([A-Z])?(\d*)$/.exec(text);
  if (!parts) throw new Error(`a designation of no known shape: ${JSON.stringify(text)}`);
  const year = Number(parts[2]!.replace('A', '1')) - 1800;
  const number = parts[5] ? Number(parts[5]) : 0;
  const packed = ((year << 23) | ((parts[3]!.charCodeAt(0) - 65) << 18) | (number << 6) | ((parts[4] ? parts[4].charCodeAt(0) - 64 : 0) << 1) | (parts[1] ? 1 : 0)) >>> 0;
  // Out of range, or a spelling the bits don't keep ("2017 U01", "1801 AA"): the check that unpacking gives the text back catches both.
  if (year < 0 || year > 255 || number > 4095 || unpackDesignation(packed) !== text) throw new Error(`a designation the 32 bits can't hold: ${JSON.stringify(text)}`);
  return packed;
}

export function unpackDesignation(packed: number): string {
  if (packed >>> 31) return `${String(packed & 0x3fff).padStart(4, '0')} ${SURVEYS[(packed >>> 14) & 3]}`;
  const year = 1800 + ((packed >>> 23) & 0xff);
  const second = (packed >>> 1) & 31;
  const number = (packed >>> 6) & 0xfff;
  return `${packed & 1 ? 'A/' : ''}${year < 1925 ? `A${String(year).slice(1)}` : year} ${String.fromCharCode(65 + ((packed >>> 18) & 31))}${second ? String.fromCharCode(64 + second) : ''}${number || ''}`;
}

/** `full_name` as JPL writes it (trimmed), from what the rows file keeps. */
export const fullName = (number: number, name: string | null, designation: string): string => `${number ? `${number} ` : ''}${name != null ? `${name} ` : ''}(${designation})`;

// --- The rows.

export interface Catalog {
  info: FetchInfo;
  rows: number;
  /** The rows with a number: the first `numbered`, row r being asteroid r + 1. */
  numbered: number;
  /** Each row's raw cells, in the files' order. */
  cells: Cell[][];
  /** a (au), e, i, the node, the argument of perihelion (degrees), and the
   *  mean anomaly at `EPOCH_JD` (degrees, -180 to 180 on an ellipse), each a
   *  column of 64-bit floats. */
  a: Float64Array;
  e: Float64Array;
  i: Float64Array;
  om: Float64Array;
  w: Float64Array;
  ma: Float64Array;
  /** The packed provisional designation. */
  designation: Uint32Array;
  notes: { offEpoch: number; noMeanAnomaly: string[]; unbound: number };
}

/** A cell as a number; NaN for none. */
export const number = (cell: Cell | undefined): number => (cell == null ? NaN : Number(cell));
/** Whether a and e are an ellipse's. */
export const isBound = (a: number, e: number): boolean => e < 1 && a > 0;
/** An angle in degrees, as the turn nearest zero: -180 to 180. */
export const nearestTurn = (degrees: number): number => degrees - 360 * Math.round(degrees / 360);

/**
 * The fetch, in the files' order: the numbered asteroids by number, then the
 * rest by designation (the catalog's own order, made exact: the API's isn't
 * promised). Every row's mean anomaly is moved to `EPOCH_JD` by its own mean
 * motion (docs/DECISIONS.md, "Data").
 */
export function readCatalog(dir = rawDir): Catalog {
  const info = JSON.parse(readFileSync(join(dir, 'fetch.json'), 'utf8')) as FetchInfo;
  const all = [...readRows(dir, FIELDS).values()];
  if (all.length !== info.count) throw new Error(`${all.length} rows, but the fetch recorded ${info.count}`);
  const [SPKID, FULL, PDES, NAME] = [field('spkid'), field('full_name'), field('pdes'), field('name')];
  const keyed = all.map((cells) => {
    const full = String(cells[FULL]).trim();
    const pdes = String(cells[PDES]);
    const inside = /\(([^()]+)\)$/.exec(full)?.[1];
    if (!inside) throw new Error(`no designation in ${JSON.stringify(full)}`);
    const numberOf = /^\d+$/.test(pdes) ? Number(pdes) : 0;
    const designation = packDesignation(inside);
    // What the rows file leans on: the name rebuilds, a numbered row's key
    // is its number, and an unnumbered row's pdes is its designation.
    const name = cells[NAME] as string | null;
    if (fullName(numberOf, name, inside) !== full) throw new Error(`full_name doesn't rebuild: ${JSON.stringify(full)}`);
    if (numberOf ? Number(cells[SPKID]) !== 20_000_000 + numberOf : inside.replace(/^A\//, '') !== pdes) throw new Error(`pdes or spkid isn't what the name says: ${JSON.stringify(full)}`);
    return { cells, numberOf, designation };
  });
  keyed.sort((left, right) => (left.numberOf && right.numberOf ? left.numberOf - right.numberOf : left.numberOf ? -1 : right.numberOf ? 1 : left.designation - right.designation));
  const rows = keyed.length;
  const numbered = keyed.findLastIndex((row) => row.numberOf > 0) + 1;
  keyed.forEach((row, index) => {
    if (index < numbered && row.numberOf !== index + 1) throw new Error(`row ${index} is asteroid ${row.numberOf}: the numbers have a gap`);
    if (index > numbered && row.designation === keyed[index - 1]!.designation) throw new Error(`two rows share the designation ${unpackDesignation(row.designation)}`);
  });

  const catalog: Catalog = {
    info,
    rows,
    numbered,
    cells: keyed.map((row) => row.cells),
    a: new Float64Array(rows),
    e: new Float64Array(rows),
    i: new Float64Array(rows),
    om: new Float64Array(rows),
    w: new Float64Array(rows),
    ma: new Float64Array(rows),
    designation: Uint32Array.from(keyed, (row) => row.designation),
    notes: { offEpoch: 0, noMeanAnomaly: [], unbound: 0 },
  };
  const [A, E, I, OM, W, MA, EPOCH, EQUINOX] = ['a', 'e', 'i', 'om', 'w', 'ma', 'epoch', 'equinox'].map(field) as [number, number, number, number, number, number, number, number];
  catalog.cells.forEach((cells, row) => {
    const [a, e, epoch] = [number(cells[A]), number(cells[E]), number(cells[EPOCH])];
    for (const [name, value] of [['a', a], ['e', e], ['i', number(cells[I])], ['om', number(cells[OM])], ['w', number(cells[W])], ['epoch', epoch]] as const) {
      if (!Number.isFinite(value)) throw new Error(`${String(cells[FULL]).trim()} has no ${name}`);
    }
    if (cells[EQUINOX] !== 'J2000') throw new Error(`${String(cells[FULL]).trim()}: equinox ${cells[EQUINOX]}`);
    // No mean anomaly: an orbit fitted as a circle, its perihelion at its epoch.
    let ma = number(cells[MA]);
    if (!Number.isFinite(ma)) {
      if (e !== 0) throw new Error(`${String(cells[FULL]).trim()} has no mean anomaly, and isn't a circle`);
      catalog.notes.noMeanAnomaly.push(String(cells[FULL]).trim());
      ma = 0;
    }
    if (epoch !== EPOCH_JD) catalog.notes.offEpoch++;
    // The mean motion, degrees a day; a hyperbola's is its |a|'s, and its
    // mean anomaly isn't an angle: it's left unwrapped.
    const bound = isBound(a, e);
    if (!bound) catalog.notes.unbound++;
    const moved = ma + (GAUSS / DEGREES / Math.abs(a) ** 1.5) * (EPOCH_JD - epoch);
    catalog.a[row] = a;
    catalog.e[row] = e;
    catalog.i[row] = number(cells[I]);
    catalog.om[row] = number(cells[OM]);
    catalog.w[row] = number(cells[W]);
    catalog.ma[row] = bound ? nearestTurn(moved) : moved;
  });
  return catalog;
}

// --- A place.

/**
 * Where a bound orbit's body is, `days` after the epoch: heliocentric
 * ecliptic x, y, z in au, written into `out` at `at`. Angles in degrees.
 */
export function place(a: number, e: number, i: number, om: number, w: number, ma: number, days: number, out: Float64Array, at = 0): void {
  orbitFrame(i, om, w, FRAME);
  placeInFrame(a, e, nearestTurn(ma + (GAUSS / DEGREES / a ** 1.5) * days) * DEGREES, FRAME, 0, out, at);
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
