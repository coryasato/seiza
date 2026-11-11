// What the fetch holds, in numbers: the orbit fields' gaps, their frame, the
// epochs' spread, and how JPL's own mean motion and mean anomaly sit against
// the ones computed from a, the epoch, and the perihelion passage. With the
// raw pages of Tycho's asteroid sample, also how the two differ: the rows the
// fetch no longer has under their key, the new ones, and how far a, e, and i
// moved past what the sample's rounding explains.
//
// Usage: node apps/kirkwood/data/survey.ts [<tycho's data/raw/asteroids>]
//
// Prints one JSON object. Its numbers are the ones docs/data.md and
// docs/DECISIONS.md ("Data") quote.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FIELDS, SAMPLE_FIELDS, fetchInfoPath, rawDir, type FetchInfo, type Page } from './fetch.ts';

type Cell = string | number | null;

/** A fetch's rows, one per spkid: a page read later wins, as prep does. */
function readRows(dir: string, fields: string[]): Map<number, Cell[]> {
  const rows = new Map<number, Cell[]>();
  for (const name of readdirSync(dir).filter((name) => /^page-\d{4}\.json$/.test(name)).sort()) {
    const page = JSON.parse(readFileSync(join(dir, name), 'utf8')) as Page;
    if (page.fields.join(',') !== fields.join(',')) throw new Error(`${join(dir, name)}: unexpected fields ${page.fields.join(',')}`);
    for (const row of page.data) rows.set(Number(row[0]), row);
  }
  return rows;
}

const number = (cell: Cell | undefined): number => (cell == null ? NaN : Number(cell));
const quantiles = (values: number[], at: number[]): number[] => {
  // Only the numbers: a row without the value has no place in its spread. A quantile of 1 is the largest.
  const sorted = Float64Array.from(values.filter(Number.isFinite)).sort();
  return at.map((q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? NaN);
};
/** A Julian day (TDB) as a calendar date; whole and half days only matter here. */
const calendar = (jd: number): string => new Date((jd - 2440587.5) * 86_400_000).toISOString().slice(0, 10);
/** The smallest turn between two angles in degrees. */
const turn = (degrees: number): number => Math.abs(((degrees % 360) + 540) % 360 - 180);

const info = JSON.parse(readFileSync(fetchInfoPath, 'utf8')) as FetchInfo;
const rows = readRows(rawDir, FIELDS);
const at = (name: string): number => {
  const index = FIELDS.indexOf(name);
  if (index < 0) throw new Error(`no field ${name}`);
  return index;
};

// --- The orbit fields: gaps, the frame, orbits with no ellipse.
const gaps: Record<string, number> = {};
for (const name of ['a', 'e', 'i', 'om', 'w', 'ma', 'epoch', 'equinox', 'n', 'tp', 'H']) {
  let none = 0;
  for (const row of rows.values()) if (row[at(name)] == null) none++;
  gaps[name] = none;
}
const equinoxes: Record<string, number> = {};
let unbound = 0;
let placeable = 0;
for (const row of rows.values()) {
  const equinox = String(row[at('equinox')]);
  equinoxes[equinox] = (equinoxes[equinox] ?? 0) + 1;
  const [a, e] = [number(row[at('a')]), number(row[at('e')])];
  if (e >= 1 || a <= 0) unbound++;
  else if (['a', 'e', 'i', 'om', 'w', 'ma', 'epoch'].every((name) => Number.isFinite(number(row[at(name)])))) placeable++;
}

// --- The epochs.
const epochCounts = new Map<number, number>();
for (const row of rows.values()) {
  const epoch = number(row[at('epoch')]);
  epochCounts.set(epoch, (epochCounts.get(epoch) ?? 0) + 1);
}
const byCount = [...epochCounts].sort((left, right) => right[1] - left[1]);
const [commonEpoch, commonCount] = byCount[0]!;
const offYears: number[] = [];
for (const row of rows.values()) {
  const epoch = number(row[at('epoch')]);
  if (epoch !== commonEpoch) offYears.push((epoch - commonEpoch) / 365.25);
}
const offClasses: Record<string, number> = {};
for (const row of rows.values()) {
  if (number(row[at('epoch')]) === commonEpoch) continue;
  const name = String(row[at('class')]);
  offClasses[name] = (offClasses[name] ?? 0) + 1;
}

// --- JPL's n and ma against the two-body ones. The Gaussian constant gives
// a massless body's mean motion, in degrees a day, from a alone; the mean
// anomaly is that motion times the days since perihelion.
const GAUSS = (0.01720209895 * 180) / Math.PI;
const motionOff: number[] = [];
const anomalyOff: number[] = [];
for (const row of rows.values()) {
  const [a, e, n, ma, epoch, tp] = ['a', 'e', 'n', 'ma', 'epoch', 'tp'].map((name) => number(row[at(name)])) as [number, number, number, number, number, number];
  if (!(e < 1) || !(a > 0) || ![n, ma, epoch, tp].every(Number.isFinite)) continue;
  motionOff.push(Math.abs(GAUSS / a ** 1.5 / n - 1));
  anomalyOff.push(turn(n * (epoch - tp) - ma));
}
// The two columns that follow from a and e: the perihelion distance, and
// the period in years of 365.25 days.
const perihelionOff: number[] = [];
const periodOff: number[] = [];
for (const row of rows.values()) {
  const [a, e, q, years] = ['a', 'e', 'q', 'per_y'].map((name) => number(row[at(name)])) as [number, number, number, number];
  if (!(e < 1) || !(a > 0)) continue;
  perihelionOff.push(Math.abs((a * (1 - e)) / q - 1));
  periodOff.push(Math.abs(360 / (GAUSS / a ** 1.5) / 365.25 / years - 1));
}

// --- How far each off-epoch row's mean anomaly moves when brought to the
// commonest epoch, and what a wrong mean motion would cost there: JPL's
// 1-sigma isn't fetched, so this is only the size of the step.
const steps: number[] = [];
for (const row of rows.values()) {
  const [n, epoch] = [number(row[at('n')]), number(row[at('epoch')])];
  if (epoch !== commonEpoch && Number.isFinite(n)) steps.push(Math.abs(n * (commonEpoch - epoch)) / 360);
}

// --- The rows off the commonest epoch against the rest: how long each was
// watched (first to last observation used, in days) and with how many
// observations, and how many have their epoch within 60 days of their last
// observation (never seen again, so never brought forward).
const days = (cell: Cell | undefined): number => Date.parse(String(cell)) / 86_400_000;
const watched = { on: { arc: [] as number[], observations: [] as number[] }, off: { arc: [] as number[], observations: [] as number[] } };
let epochAtLastSeen = 0;
for (const row of rows.values()) {
  const epoch = number(row[at('epoch')]);
  const side = epoch === commonEpoch ? watched.on : watched.off;
  const arc = days(row[at('last_obs')]) - days(row[at('first_obs')]);
  if (Number.isFinite(arc)) side.arc.push(arc);
  side.observations.push(number(row[at('n_obs_used')]));
  if (epoch !== commonEpoch && Math.abs(epoch - 2440587.5 - days(row[at('last_obs')])) <= 60) epochAtLastSeen++;
}
const median = (values: number[]): number => quantiles(values, [0.5])[0]!;

// --- The rows a Kepler ellipse can't place as they are.
const odd: Cell[][] = [];
for (const row of rows.values()) {
  const [a, e] = [number(row[at('a')]), number(row[at('e')])];
  if (row[at('ma')] == null || e >= 1 || a <= 0) odd.push(['full_name', 'class', 'a', 'e', 'ma', 'epoch', 'tp', 'n_obs_used'].map((name) => (name === 'full_name' ? String(row[at(name)]).trim() : row[at(name)]!)));
}

const report: Record<string, unknown> = {
  fetch: { fetched: info.fetched, count: info.count, query: info.query, fields: info.fields, uniqueRows: rows.size },
  gaps,
  equinoxes,
  unbound,
  placeable,
  odd,
  watched: {
    onCommonest: { medianArcDays: median(watched.on.arc), medianObservations: median(watched.on.observations) },
    off: { medianArcDays: median(watched.off.arc), medianObservations: median(watched.off.observations), epochWithin60DaysOfLastObservation: epochAtLastSeen },
  },
  epochs: {
    distinct: epochCounts.size,
    commonest: { jd: commonEpoch, date: calendar(commonEpoch), rows: commonCount, share: commonCount / rows.size },
    next: byCount.slice(1, 6).map(([jd, count]) => ({ jd, date: calendar(jd), rows: count })),
    others: {
      rows: offYears.length,
      earliest: calendar(Math.min(...[...epochCounts.keys()].filter(Number.isFinite))),
      latest: calendar(Math.max(...[...epochCounts.keys()].filter(Number.isFinite))),
      yearsFromCommonest: Object.fromEntries(quantiles(offYears, [0, 0.01, 0.1, 0.5, 0.9, 0.99, 1]).map((value, index) => [['min', 'p1', 'p10', 'p50', 'p90', 'p99', 'max'][index], value])),
      byClass: offClasses,
      orbitsTurnedToReachIt: Object.fromEntries(quantiles(steps, [0.5, 0.9, 0.99, 1]).map((value, index) => [['p50', 'p90', 'p99', 'max'][index], value])),
    },
  },
  twoBody: {
    rows: motionOff.length,
    meanMotionRelative: Object.fromEntries(quantiles(motionOff, [0.5, 0.99, 1]).map((value, index) => [['p50', 'p99', 'max'][index], value])),
    meanAnomalyDegrees: Object.fromEntries(quantiles(anomalyOff, [0.5, 0.99, 1]).map((value, index) => [['p50', 'p99', 'max'][index], value])),
    perihelionRelative: Object.fromEntries(quantiles(perihelionOff, [0.5, 0.99, 1]).map((value, index) => [['p50', 'p99', 'max'][index], value])),
    periodRelative: { rows: periodOff.filter(Number.isFinite).length, ...Object.fromEntries(quantiles(periodOff, [0.5, 0.99, 1]).map((value, index) => [['p50', 'p99', 'max'][index], value])) },
  },
};

// --- Against Tycho's sample.
const sampleDir = process.argv[2];
if (sampleDir) {
  const sample = readRows(sampleDir, SAMPLE_FIELDS);
  // A provisional object that was numbered since has a new spkid; its old
  // designation stays in the new full name's parentheses.
  const byDesignation = new Map<string, number>();
  for (const [spkid, row] of rows) {
    const inside = /\(([^)]+)\)\s*$/.exec(String(row[at('full_name')]))?.[1];
    if (inside) byDesignation.set(inside, spkid);
    byDesignation.set(String(row[at('pdes')]), spkid);
  }
  let gone = 0;
  let rekeyed = 0;
  const goneExamples: Cell[][] = [];
  for (const [spkid, row] of sample) {
    if (rows.has(spkid)) continue;
    gone++;
    if (byDesignation.has(String(row[2]))) rekeyed++;
    else if (goneExamples.length < 5) goneExamples.push(row.slice(0, 3));
  }
  let added = 0;
  for (const spkid of rows.keys()) if (!sample.has(spkid)) added++;

  // How the API rounds for display, found by trying each rule on every row
  // of the sample against the fetch (the rule below reproduces the sample's
  // text on all but the rows counted as moved): a to 4 significant digits
  // with trailing zeros dropped, so its printed digits don't say; e to 4
  // decimals; i and H to 2; the diameter and the albedo to 3. A value has
  // moved when the fetch's is farther from the sample's than half the last
  // digit the rule keeps, by more than a tie's rounding either way.
  const halfDigit = (name: string, before: number, after: number): number => {
    const decimals = { e: 4, i: 2, H: 2, diameter: 3, albedo: 3 }[name];
    if (decimals !== undefined) return 0.5 * 10 ** -decimals;
    const size = Math.max(Math.abs(before), Math.abs(after));
    return 0.5 * 10 ** (Math.floor(Math.log10(size)) - 3);
  };
  const hasMoved = (name: string, before: number, after: number): boolean => Math.abs(after - before) > halfDigit(name, before, after) * (1 + 1e-6);
  const moved: Record<string, unknown> = {};
  const movedRow = new Set<number>();
  for (const name of ['a', 'e', 'i'] as const) {
    const past: number[] = [];
    let compared = 0;
    for (const [spkid, old] of sample) {
      const now = rows.get(spkid);
      if (!now) continue;
      const [before, after] = [number(old[at(name)]), number(now[at(name)])];
      if (!Number.isFinite(before) || !Number.isFinite(after)) continue;
      compared++;
      const off = Math.abs(after - before);
      if (hasMoved(name, before, after)) {
        past.push(off);
        movedRow.add(spkid);
      }
    }
    moved[name] = {
      compared,
      moved: past.length,
      by: Object.fromEntries(quantiles(past, [0.5, 0.9, 0.99, 1]).map((value, index) => [['p50', 'p90', 'p99', 'max'][index], value])),
    };
  }
  const changed: Record<string, number> = {};
  for (const name of ['full_name', 'pdes', 'name', 'neo', 'pha', 'class', 'H', 'diameter', 'albedo', 'first_obs', 'last_obs', 'n_obs_used']) {
    let differs = 0;
    for (const [spkid, old] of sample) {
      const now = rows.get(spkid);
      if (!now) continue;
      const [before, after] = [old[at(name)], now[at(name)]];
      const same = ['H', 'diameter', 'albedo'].includes(name)
        ? before == null || after == null
          ? before == null && after == null
          : !hasMoved(name, number(before), number(after))
        : String(before).trim() === String(after).trim();
      if (!same) differs++;
    }
    changed[name] = differs;
  }
  let joined = 0;
  for (const spkid of sample.keys()) if (rows.has(spkid)) joined++;
  report.sample = {
    rows: sample.size,
    joined,
    gone: { rows: gone, numberedSince: rekeyed, unexplained: gone - rekeyed, examples: goneExamples },
    newInFetch: added,
    moved: { ...moved, rowsWithAnyMoved: movedRow.size },
    otherColumnsChanged: changed,
  };
}

console.log(JSON.stringify(report, null, 2));
