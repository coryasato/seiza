// The elements file's precision, weighed: for each way of storing the six
// elements, how far the stored numbers put a row from where its 64-bit ones
// do, over 50 years either side of the epoch (in au, and in pixels from the
// scene's opening camera), and what the file weighs raw and at brotli 11.
// The numbers behind docs/DECISIONS.md, "Data" (the elements file).
//
// Usage: node --max-old-space-size=12000 apps/kirkwood/data/precision.ts [--only error,bytes]
//
// Prints one JSON object. About 2 minutes for the error and 5 for the bytes
// (brotli 11 on every column under every codec).

import { promisify } from 'node:util';
import { brotliCompress, constants } from 'node:zlib';
import { DEGREES, EPOCH_JD, GAUSS, GAUSS_YEAR_DAYS, field, isBound, nearestTurn, number, orbitFrame, placeInFrame, readCatalog } from './catalog.ts';

const onlyAt = process.argv.indexOf('--only');
const only = (onlyAt > 0 ? (process.argv[onlyAt + 1] ?? '') : 'error,bytes').split(',');
if (only.some((part) => part !== 'error' && part !== 'bytes')) throw new Error(`--only takes error, bytes, or both, not ${JSON.stringify(only.join(','))}`);

const catalog = readCatalog();
const { rows } = catalog;
const atH = field('H');
const H = Float64Array.from(catalog.cells, (cells) => number(cells[atH]));
const bound = (row: number): boolean => isBound(catalog.a[row]!, catalog.e[row]!);

// --- The ways to store a column: what's written, and what a reader gets back.

type Stored = Float32Array | Uint16Array | Int16Array;
interface Codec {
  name: string;
  store(values: Float64Array): Stored;
  read(stored: Stored): Float64Array;
}
const floats: Codec = { name: '32-bit float', store: (values) => Float32Array.from(values), read: (stored) => Float64Array.from(stored) };
/** A 16-bit count of `step`s from `from`, held to what 16 bits reach. Signed, the lowest count is none (NaN); unsigned, there is no none. */
const steps = (name: string, step: number, from = 0, signed = false): Codec => ({
  name,
  store: (values) => {
    const count = (value: number) => {
      if (Number.isNaN(value) && !signed) throw new Error(`${name}: no way to store none`);
      return Number.isNaN(value) ? -32768 : Math.min(signed ? 32767 : 65535, Math.max(signed ? -32767 : 0, Math.round((value - from) / step)));
    };
    return signed ? Int16Array.from(values, count) : Uint16Array.from(values, count);
  },
  read: (stored) => Float64Array.from(stored, (count) => (signed && count === -32768 ? NaN : from + count * step)),
});
/** An angle as a 16-bit share of a turn: a count that wraps. */
const turns: Codec = {
  name: '16 bits of a turn',
  store: (values) => Uint16Array.from(values, (value) => Math.round((((value % 360) + 360) % 360) * (65536 / 360)) & 0xffff),
  read: (stored) => Float64Array.from(stored, (count) => count * (360 / 65536)),
};
/** An angle to a hundredth of a degree, the digits Tycho's table shows. */
const hundredths: Codec = {
  name: 'hundredths of a degree',
  store: (values) => Uint16Array.from(values, (value) => Math.round((((value % 360) + 360) % 360) * 100) % 36000),
  read: (stored) => Float64Array.from(stored, (count) => count / 100),
};
/** a's logarithm in 16 bits, over the bound rows' own range. */
const [aLow, aHigh] = (() => {
  let [low, high] = [Infinity, 0];
  for (let row = 0; row < rows; row++) if (bound(row)) [low, high] = [Math.min(low, catalog.a[row]!), Math.max(high, catalog.a[row]!)];
  return [Math.log(low), Math.log(high)];
})();
const logA: Codec = {
  name: '16 bits of its logarithm',
  store: (values) => Uint16Array.from(values, (value) => (value > 0 ? Math.min(65535, Math.max(0, Math.round(((Math.log(value) - aLow) / (aHigh - aLow)) * 65535))) : 0)),
  read: (stored) => Float64Array.from(stored, (count) => Math.exp(aLow + (count / 65535) * (aHigh - aLow))),
};
/** The mean anomaly from 0 to 360, as JPL writes it, where a float is coarsest just before perihelion. */
const unsigned: Codec = { name: '32-bit float, 0 to 360', store: (values) => Float32Array.from(values, (value) => ((value % 360) + 360) % 360), read: floats.read };

const columns = { a: catalog.a, e: catalog.e, i: catalog.i, om: catalog.om, w: catalog.w, ma: catalog.ma, H };
type Column = keyof typeof columns;
const ELEMENTS = ['a', 'e', 'i', 'om', 'w', 'ma'] as const;

const eBinary = steps('16 bits of 0 to 1', 1 / 65535);
const eDecimal = steps('four decimals', 1e-4);
const iBinary = steps('16 bits of 0 to 180', 180 / 65535);
const iDecimal = steps('hundredths of a degree', 0.01);
const hDecimal = steps('hundredths of a magnitude', 0.01, 0, true);

/** A layout: each column's codec. H is the same question on its own. */
const layouts: Record<string, Record<(typeof ELEMENTS)[number], Codec>> = {
  'every element a 32-bit float, the mean anomaly 0 to 360': { a: floats, e: floats, i: floats, om: floats, w: floats, ma: unsigned },
  'every element a 32-bit float': { a: floats, e: floats, i: floats, om: floats, w: floats, ma: floats },
  'a, e, and the mean anomaly 32-bit floats; i, the node, and the perihelion 16 bits': { a: floats, e: floats, i: iBinary, om: turns, w: turns, ma: floats },
  'a a 32-bit float, the rest 16 bits': { a: floats, e: eBinary, i: iBinary, om: turns, w: turns, ma: turns },
  "a a 32-bit float, the rest to the decimals Tycho's table shows": { a: floats, e: eDecimal, i: iDecimal, om: hundredths, w: hundredths, ma: hundredths },
  'every element 16 bits': { a: logA, e: eBinary, i: iBinary, om: turns, w: turns, ma: turns },
};

const report: Record<string, unknown> = { rows, bound: Array.from({ length: rows }, (_, row) => bound(row)).filter(Boolean).length, epoch: EPOCH_JD };

// --- The error.

if (only.includes('error')) {
  // The opening camera (spike/src/scene.ts, the look's): 13 au from the Sun,
  // 24 degrees above the ecliptic, turned 34 degrees about its line of
  // sight, a 40 degree field of view up and down, in a 1440 x 900 window.
  // The scene's axes are the ecliptic's x, north, and minus y.
  const [AZ, ELEV, ROLL, DISTANCE, FOV, WIDTH, HEIGHT] = [200 * DEGREES, 24 * DEGREES, -34 * DEGREES, 13, 40 * DEGREES, 1440, 900];
  const toward = [Math.cos(ELEV) * Math.sin(AZ), Math.sin(ELEV), Math.cos(ELEV) * Math.cos(AZ)] as const;
  const cross = (u: readonly number[], v: readonly number[]) => [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!] as const;
  const dot = (u: readonly number[], v: readonly number[]) => u[0]! * v[0]! + u[1]! * v[1]! + u[2]! * v[2]!;
  // "Up" is north, turned about the line of sight (Rodrigues).
  const north = [0, 1, 0] as const;
  const turned = cross(toward, north);
  const up0 = north.map((value, axis) => value * Math.cos(ROLL) + turned[axis]! * Math.sin(ROLL) + toward[axis]! * dot(toward, north) * (1 - Math.cos(ROLL)));
  const rightRaw = cross(up0, toward);
  const right = rightRaw.map((value) => value / Math.hypot(...rightRaw));
  const up = cross(toward, right);
  const eye = toward.map((value) => value * DISTANCE);
  /** Pixels (CSS) a unit of sideways-over-depth covers. */
  const FOCAL = HEIGHT / 2 / Math.tan(FOV / 2);
  const screen = new Float64Array(3);
  /** A place (ecliptic x, y, z) on screen: x and y in px from the center, and its depth. */
  const project = (place: Float64Array, at: number): void => {
    const rel = [place[at]! - eye[0]!, place[at + 2]! - eye[1]!, -place[at + 1]! - eye[2]!];
    const depth = -dot(rel, toward);
    screen[0] = (dot(rel, right) / depth) * FOCAL;
    screen[1] = (dot(rel, up) / depth) * FOCAL;
    screen[2] = depth;
  };

  // Every 5 years from 50 before the epoch to 50 after, in days.
  const DAYS = Array.from({ length: 21 }, (_, step) => (step - 10) * 5 * 365.25);
  const names = Object.keys(layouts);
  // And the all-float layout's numbers through the clock's arithmetic in
  // 32-bit floats, as the spike's shader has it: an estimate of what a GPU
  // adds, whatever the file holds.
  const SHADER = "every element a 32-bit float, through the spike shader's 32-bit clock (an estimate)";
  const FLOATS = names.indexOf('every element a 32-bit float');
  const read = names.map((name) => Object.fromEntries(ELEMENTS.map((column) => [column, layouts[name]![column].read(layouts[name]![column].store(columns[column]))])) as Record<(typeof ELEMENTS)[number], Float64Array>);
  const all = [...names, SHADER];
  const worstAu = all.map(() => new Float32Array(rows).fill(NaN));
  const worstPx = all.map(() => new Float32Array(rows).fill(NaN));
  const epochAu = all.map(() => new Float32Array(rows).fill(NaN));
  const frame = new Float64Array(6);
  const [truth, got] = [new Float64Array(3 * DAYS.length), new Float64Array(3)];
  const truthScreen = new Float64Array(3 * DAYS.length);
  const rate = (a: number) => GAUSS / DEGREES / a ** 1.5;
  const f = Math.fround;
  const TAU = 2 * Math.PI;
  for (let row = 0; row < rows; row++) {
    if (!bound(row)) continue;
    orbitFrame(catalog.i[row]!, catalog.om[row]!, catalog.w[row]!, frame);
    DAYS.forEach((days, step) => {
      placeInFrame(catalog.a[row]!, catalog.e[row]!, nearestTurn(catalog.ma[row]! + rate(catalog.a[row]!) * days) * DEGREES, frame, 0, truth, step * 3);
      project(truth, step * 3);
      truthScreen.set(screen, step * 3);
    });
    for (let layout = 0; layout < all.length; layout++) {
      const from = read[layout < names.length ? layout : FLOATS]!;
      const [a, e, ma] = [from.a[row]!, from.e[row]!, from.ma[row]!];
      orbitFrame(from.i[row]!, from.om[row]!, from.w[row]!, frame);
      let [au, px] = [0, NaN];
      for (let step = 0; step < DAYS.length; step++) {
        let mean: number;
        if (layout < names.length) mean = nearestTurn(ma + rate(a) * DAYS[step]!) * DEGREES;
        else {
          // mod(M + TAU / (a * sqrt(a)) * years, TAU), every step rounded to a 32-bit float.
          const turnsRate = f(f(TAU) / f(f(a) * f(Math.sqrt(f(a)))));
          const sum = f(f(ma * DEGREES) + f(turnsRate * f(DAYS[step]! / GAUSS_YEAR_DAYS)));
          mean = f(sum - f(TAU) * Math.floor(sum / f(TAU)));
          if (mean > Math.PI) mean -= TAU;
        }
        placeInFrame(a, e, mean, frame, 0, got);
        const off = Math.hypot(got[0]! - truth[step * 3]!, got[1]! - truth[step * 3 + 1]!, got[2]! - truth[step * 3 + 2]!);
        if (step === 10) epochAu[layout]![row] = off;
        au = Math.max(au, off);
        // In pixels, where the row is in front of the camera and in the window.
        const [x, y, depth] = [truthScreen[step * 3]!, truthScreen[step * 3 + 1]!, truthScreen[step * 3 + 2]!];
        if (depth > 0.01 && Math.abs(x) <= WIDTH / 2 && Math.abs(y) <= HEIGHT / 2) {
          project(got, 0);
          const moved = screen[2]! > 0.01 ? Math.hypot(screen[0]! - x, screen[1]! - y) : Infinity;
          px = Number.isNaN(px) ? moved : Math.max(px, moved);
        }
      }
      worstAu[layout]![row] = au;
      worstPx[layout]![row] = px;
    }
  }
  const spread = (values: Float32Array) => {
    const sorted = values.filter((value) => !Number.isNaN(value)).sort();
    const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
    return { rows: sorted.length, p50: at(0.5), p99: at(0.99), p9999: at(0.9999), max: at(1) };
  };
  const worstRow = (values: Float32Array) => {
    let worst = -1;
    for (let row = 0; row < rows; row++) if (!Number.isNaN(values[row]!) && (worst < 0 || values[row]! > values[worst]!)) worst = row;
    return worst < 0 ? null : { name: String(catalog.cells[worst]![field('full_name')]).trim(), a: catalog.a[worst], e: catalog.e[worst] };
  };
  const past = (values: Float32Array, limit: number) => values.reduce((count, value) => count + (value > limit ? 1 : 0), 0);
  report.error = {
    camera: { distanceAu: DISTANCE, pxPerAuAtTheSun: FOCAL / DISTANCE, window: [WIDTH, HEIGHT], note: 'CSS px; twice as many of the display\'s at DPR 2' },
    years: DAYS.map((days) => days / 365.25),
    layouts: Object.fromEntries(all.map((name, layout) => [name, {
      atTheEpochAu: spread(epochAu[layout]!),
      over50YearsAu: { ...spread(worstAu[layout]!), worst: worstRow(worstAu[layout]!) },
      over50YearsPx: { ...spread(worstPx[layout]!), worst: worstRow(worstPx[layout]!), rowsPastATenth: past(worstPx[layout]!, 0.1), rowsPastHalf: past(worstPx[layout]!, 0.5), rowsPastOne: past(worstPx[layout]!, 1) },
    }])),
  };
}

// --- The bytes.

if (only.includes('bytes')) {
  const compress = promisify(brotliCompress);
  const brotli = async (data: Uint8Array): Promise<number> => (await compress(data, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_LGWIN]: 24, [constants.BROTLI_PARAM_SIZE_HINT]: data.length } })).length;
  const bytesOf = (stored: Stored) => new Uint8Array(stored.buffer, stored.byteOffset, stored.byteLength);
  /** A column's bytes regrouped: every value's first byte, then every second, and so on. */
  const planes = (stored: Stored): Uint8Array => {
    const [bytes, width] = [bytesOf(stored), stored.BYTES_PER_ELEMENT];
    const out = new Uint8Array(bytes.length);
    for (let value = 0; value < stored.length; value++) for (let byte = 0; byte < width; byte++) out[byte * stored.length + value] = bytes[value * width + byte]!;
    return out;
  };
  // Each column under each codec it's offered, as it is and in byte planes.
  const offered: Record<Column, Codec[]> = { a: [floats, logA], e: [floats, eBinary, eDecimal], i: [floats, iBinary, iDecimal], om: [floats, turns, hundredths], w: [floats, turns, hundredths], ma: [floats, unsigned, turns, hundredths], H: [floats, hDecimal] };
  const sized = new Map<string, { raw: number; brotli: number; brotliPlanes: number }>();
  const jobs: Promise<void>[] = [];
  for (const [column, codecs] of Object.entries(offered) as [Column, Codec[]][]) {
    for (const codec of codecs) {
      const stored = codec.store(columns[column]);
      jobs.push(Promise.all([brotli(bytesOf(stored)), brotli(planes(stored))]).then(([plain, split]) => void sized.set(`${column}: ${codec.name}`, { raw: stored.byteLength, brotli: plain, brotliPlanes: split })));
    }
  }
  // Each layout whole, a row at a time (the spike's buffer): H rides as the layout's a does.
  const whole: Record<string, { raw: number; brotli: number }> = {};
  for (const [name, layout] of Object.entries(layouts)) {
    const parts = [...ELEMENTS.map((column) => layout[column].store(columns[column])), (layout.a === floats ? floats : hDecimal).store(H)];
    const width = parts.reduce((sum, part) => sum + part.BYTES_PER_ELEMENT, 0);
    const out = new Uint8Array(rows * width);
    let offset = 0;
    for (const part of parts) {
      const bytes = bytesOf(part);
      for (let row = 0; row < rows; row++) out.set(bytes.subarray(row * part.BYTES_PER_ELEMENT, (row + 1) * part.BYTES_PER_ELEMENT), row * width + offset);
      offset += part.BYTES_PER_ELEMENT;
    }
    jobs.push(brotli(out).then((size) => void (whole[name] = { raw: out.length, brotli: size })));
  }
  await Promise.all(jobs);
  const mb = (bytes: number) => Number((bytes / 1e6).toFixed(2));
  report.bytesMB = {
    columns: Object.fromEntries([...sized].map(([name, size]) => [name, { raw: mb(size.raw), brotli: mb(size.brotli), brotliInBytePlanes: mb(size.brotliPlanes) }])),
    layouts: Object.fromEntries(Object.entries(layouts).map(([name, layout]) => {
      const parts = [...ELEMENTS.map((column) => sized.get(`${column}: ${layout[column].name}`)!), sized.get(`H: ${(layout.a === floats ? floats : hDecimal).name}`)!];
      const sum = (pick: (size: { raw: number; brotli: number; brotliPlanes: number }) => number) => mb(parts.reduce((total, part) => total + pick(part), 0));
      return [name, { raw: sum((size) => size.raw), brotliARowAtATime: mb(whole[name]!.brotli), brotliAColumnAtATime: sum((size) => size.brotli), brotliInBytePlanes: sum((size) => Math.min(size.brotli, size.brotliPlanes)) }];
    })),
  };
}

console.log(JSON.stringify(report, null, 2));
