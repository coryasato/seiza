// Fetches JPL Horizons' own places for a few known bodies and for Jupiter,
// to check the files' places against (places.ts), into data/horizons.json
// (committed: it's small, and it pins what the check compared with).
//
// Usage: node apps/kirkwood/data/horizons.ts
//
// Horizons integrates each body under the Sun, the planets, and the large
// asteroids; the files' places are two-body orbits from one epoch. Every
// place is geometric (no light time), from the Sun's center, in the ecliptic
// of J2000, in au, at 0h TDB: the frame of the fetch's elements
// (docs/data.md). One request at a time, as JPL asks.

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EPOCH_JD, julian } from './orbit.ts';

const API = 'https://ssd.jpl.nasa.gov/api/horizons.api';
const horizonsPath = join(dirname(fileURLToPath(import.meta.url)), 'horizons.json');

/** The files' epoch, then the same day a decade, 25, and 50 years either
 *  side, and one day five months past the epoch (2026-11-11, the day the
 *  reference was first fetched; fixed, whenever this runs again). */
const DATES = ['1976-06-09', '2001-06-09', '2016-06-09', '2026-06-09', '2026-11-11', '2036-06-09', '2051-06-09', '2076-06-09'];
/** Each asteroid by its number (Horizons' `<number>;` is the small body of
 *  that number): the two the plan names, the largest Trojan of each cloud
 *  (Hektor ahead of Jupiter, Patroclus behind), and the Hildas' namesake. */
const ASTEROIDS = [1, 4, 153, 617, 624];
const JUPITER = '599';

export interface Horizons {
  source: string;
  fetched: string;
  frame: string;
  dates: { date: string; jd: number }[];
  /** A numbered asteroid's places, one [x, y, z] (au) a date. */
  asteroids: { number: number; name: string; solution: string; places: [number, number, number][] }[];
  jupiter: {
    name: string;
    solution: string;
    places: [number, number, number][];
    /** Its osculating elements at the files' epoch: au, degrees, and the
     *  mean motion in degrees a day (its own mass counted). */
    elements: { jd: number; a: number; e: number; i: number; om: number; w: number; ma: number; n: number };
  };
}

async function ask(command: string, type: 'VECTORS' | 'ELEMENTS', days: number[]): Promise<{ name: string; solution: string; rows: number[][] }> {
  const query = {
    format: 'text',
    COMMAND: command,
    OBJ_DATA: 'NO',
    MAKE_EPHEM: 'YES',
    EPHEM_TYPE: type,
    CENTER: '500@10',
    REF_PLANE: 'ECLIPTIC',
    REF_SYSTEM: 'ICRF',
    OUT_UNITS: 'AU-D',
    CSV_FORMAT: 'YES',
    TLIST: days.join(','),
    TLIST_TYPE: 'JD',
    TIME_TYPE: 'TDB',
    ...(type === 'VECTORS' ? { VEC_TABLE: '1', VEC_CORR: 'NONE' } : {}),
  };
  const url = `${API}?${Object.entries(query).map(([key, value]) => `${key}=${encodeURIComponent(key === 'format' ? value : `'${value}'`)}`).join('&')}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${command}: ${response.status}`);
  const text = await response.text();
  const target = /Target body name: (.+?)\s+\{source: (.+?)\}/.exec(text);
  const table = /\$\$SOE\n([\s\S]*?)\$\$EOE/.exec(text);
  if (!target || !table || !text.includes('Reference frame : Ecliptic of J2000.0') || !text.includes('Center body name: Sun (10)')) throw new Error(`${command}: not the answer asked for:\n${text.slice(0, 2000)}`);
  // A row: the Julian day, the calendar date, then the numbers.
  const rows = table[1]!.trim().split('\n').map((line) => line.split(',').map((cell) => cell.trim()).filter((cell, at) => at !== 1 && cell !== '').map(Number));
  if (rows.length !== days.length || rows.some((row, at) => row[0] !== days[at] || row.some((value) => !Number.isFinite(value)))) throw new Error(`${command}: ${rows.length} rows for ${days.length} dates, or not theirs`);
  return { name: target[1]!, solution: target[2]!, rows: rows.map((row) => row.slice(1)) };
}

const days = DATES.map(julian);
if (!days.includes(EPOCH_JD)) throw new Error("the dates don't include the files' epoch");
const places = (rows: number[][]) => rows.map((row) => [row[0]!, row[1]!, row[2]!] as [number, number, number]);

const asteroids: Horizons['asteroids'] = [];
for (const number of ASTEROIDS) {
  const answer = await ask(`${number};`, 'VECTORS', days);
  if (!answer.name.startsWith(`${number} `)) throw new Error(`asked for asteroid ${number}, got ${answer.name}`);
  asteroids.push({ number, name: answer.name, solution: answer.solution, places: places(answer.rows) });
  console.log(`${answer.name} (${answer.solution})`);
}
const jupiter = await ask(JUPITER, 'VECTORS', days);
// The elements' columns: EC, QR, IN, OM, W, Tp, N, MA, TA, A, AD, PR.
const [e, , i, om, w, , n, ma, , a] = (await ask(JUPITER, 'ELEMENTS', [EPOCH_JD])).rows[0] as [number, number, number, number, number, number, number, number, number, number];
console.log(`${jupiter.name} (${jupiter.solution})`);

const horizons: Horizons = {
  source: API,
  fetched: new Date().toISOString().slice(0, 10),
  frame: "geometric, from the Sun's center, ecliptic of J2000 (IAU76 obliquity), au; each date at 0h TDB",
  dates: DATES.map((date, at) => ({ date, jd: days[at]! })),
  asteroids,
  jupiter: { name: jupiter.name, solution: jupiter.solution, places: places(jupiter.rows), elements: { jd: EPOCH_JD, a, e, i, om, w, ma, n } },
};
// A place to a line.
writeFileSync(horizonsPath, `${JSON.stringify(horizons, null, 2).replace(/\[\n\s+(\S+),\n\s+(\S+),\n\s+(\S+)\n\s+\]/g, '[$1, $2, $3]')}\n`);
console.log(`wrote ${horizonsPath}`);
