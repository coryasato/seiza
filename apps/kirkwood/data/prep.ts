// Builds the two files the app holds in memory from the fetch in data/raw/:
// elements.bin, what the scene draws from, and rows.bin, the table's other
// columns. Both are gitignored; data/MANIFEST.json (committed) names them by
// their bytes. Their layout, and how to read it: docs/data.md.
//
// Usage: node --max-old-space-size=12000 apps/kirkwood/data/prep.ts [--check] [--sizes]
//
//   (nothing)  writes the files and the manifest
//   --check    builds them again and fails unless they're the manifest's and
//              the disk's, byte for byte; writes nothing
//   --sizes    also prints each file and each of its sections raw and at
//              brotli 11 (a few minutes)
//
// Every run reads each row back out of the built bytes and fails unless it
// is the fetch's row.

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { brotliCompress, constants } from 'node:zlib';
import { EPOCH_JD, GAUSS, GAUSS_YEAR_DAYS, field, fullName, isBound, nearestTurn, number, readCatalog, unpackDesignation, type Catalog, type Cell } from './catalog.ts';

const dataDir = dirname(fileURLToPath(import.meta.url));
const manifestPath = join(dataDir, 'MANIFEST.json');

type Values = Float32Array | Uint32Array | Int32Array | Uint16Array | Uint8Array;
type Kind = 'f32' | 'u32' | 'i32' | 'u16' | 'u8';
interface Section {
  name: string;
  kind: Kind;
  values: Values;
}
interface Placed {
  name: string;
  kind: Kind;
  offset: number;
  bytes: number;
}
interface Built {
  bytes: Buffer;
  layout: Placed[];
}

/** Little-endian, every section starting on a 4-byte boundary, so a reader can view each where it is. */
function build(header: Buffer, sections: Section[]): Built {
  if (new Uint8Array(new Uint16Array([1]).buffer)[0] !== 1) throw new Error('prep writes its arrays as this machine holds them, and the files are little-endian');
  const pad = (length: number) => Buffer.alloc((4 - (length % 4)) % 4);
  const parts: Buffer[] = [header, pad(header.length)];
  const layout: Placed[] = [{ name: 'header', kind: 'u8', offset: 0, bytes: header.length }];
  let offset = header.length + parts[1]!.length;
  for (const { name, kind, values } of sections) {
    const bytes = Buffer.from(values.buffer, values.byteOffset, values.byteLength);
    layout.push({ name, kind, offset, bytes: bytes.length });
    parts.push(bytes, pad(bytes.length));
    offset += bytes.length + parts.at(-1)!.length;
  }
  return { bytes: Buffer.concat(parts), layout };
}

const DAY_MS = 86_400_000;
/** No date. */
const NO_DATE = -2147483648;
/** A date JPL has only the year of ('1998-??-??') is that many past `NO_DATE`. */
const yearOnly = (year: number) => NO_DATE + year;
function day(cell: Cell): number {
  if (cell == null) return NO_DATE;
  const text = String(cell);
  const year = /^(\d{4})-\?\?-\?\?$/.exec(text);
  if (year) return yearOnly(Number(year[1]));
  const ms = /^\d{4}-\d{2}-\d{2}$/.test(text) ? Date.parse(`${text}T00:00:00Z`) : NaN;
  if (!Number.isFinite(ms)) throw new Error(`a date of no known shape: ${text}`);
  return ms / DAY_MS;
}
const dateText = (days: number): string | null => (days === NO_DATE ? null : days < NO_DATE + 10_000 ? `${days - NO_DATE}-??-??` : new Date(days * DAY_MS).toISOString().slice(0, 10));
/** JPL's Y and N, and none. */
const flag = (cell: Cell): number => (cell === 'Y' ? 1 : cell === 'N' ? 0 : cell == null ? 2 : NaN);
/** A 32-bit float in the fewest digits that read back as it: what a cell shows. */
function shortest(value: number): string {
  for (let digits = 1; digits <= 9; digits++) {
    const text = Number(value.toPrecision(digits));
    if (Math.fround(text) === value) return String(text);
  }
  return String(value);
}

function elementsFile(catalog: Catalog): Built {
  const header = Buffer.alloc(16);
  header.write('KWE1', 0, 'latin1');
  header.writeUInt32LE(catalog.rows, 4);
  header.writeDoubleLE(EPOCH_JD, 8);
  const atH = field('H');
  const H = Float32Array.from(catalog.cells, (cells) => number(cells[atH]));
  return build(header, [
    { name: 'a', kind: 'f32', values: Float32Array.from(catalog.a) },
    { name: 'e', kind: 'f32', values: Float32Array.from(catalog.e) },
    { name: 'i', kind: 'f32', values: Float32Array.from(catalog.i) },
    { name: 'om', kind: 'f32', values: Float32Array.from(catalog.om) },
    { name: 'w', kind: 'f32', values: Float32Array.from(catalog.w) },
    { name: 'ma', kind: 'f32', values: Float32Array.from(catalog.ma) },
    { name: 'H', kind: 'f32', values: H },
  ]);
}

function rowsFile(catalog: Catalog): Built & { classes: string[]; named: number } {
  const { rows, cells } = catalog;
  const column = (name: string) => {
    const at = field(name);
    return cells.map((row) => row[at]!);
  };
  const classOf = column('class') as string[];
  const classes = [...new Set(classOf)].sort();
  if (classes.length > 255 || classes.some((name) => Buffer.byteLength(name) > 255)) throw new Error('more classes, or a longer one, than a byte holds');
  const classIndex = new Map(classes.map((name, index) => [name, index]));
  const observations = column('n_obs_used') as number[];
  if (observations.some((count) => !Number.isInteger(count) || count < 0 || count > 65535)) throw new Error('an n_obs_used that 16 bits can\'t hold');
  const flags = (name: string) => {
    const values = column(name).map(flag);
    if (values.some(Number.isNaN)) throw new Error(`a ${name} that isn't Y, N, or none`);
    return Uint8Array.from(values);
  };
  // The names: 1 row in 60 has one, so they're kept as the rows that do (in order), and their text behind offsets.
  const names = column('name').flatMap((name, index) => (name == null ? [] : [[index, Buffer.from(String(name), 'utf8')] as const]));
  const nameOffsets = new Uint32Array(names.length + 1);
  names.forEach(([, text], index) => (nameOffsets[index + 1] = nameOffsets[index]! + text.length));

  const classText = classes.map((name) => Buffer.concat([Buffer.of(Buffer.byteLength(name)), Buffer.from(name)]));
  const header = Buffer.concat([Buffer.from('KWR1', 'latin1'), Buffer.from(Uint32Array.of(rows, catalog.numbered, names.length, classes.length).buffer), ...classText]);
  const built = build(header, [
    { name: 'spkid', kind: 'u32', values: Uint32Array.from(column('spkid') as number[]) },
    { name: 'designation', kind: 'u32', values: catalog.designation },
    { name: 'first_obs', kind: 'i32', values: Int32Array.from(column('first_obs'), day) },
    { name: 'last_obs', kind: 'i32', values: Int32Array.from(column('last_obs'), day) },
    { name: 'diameter', kind: 'f32', values: Float32Array.from(column('diameter'), number) },
    { name: 'albedo', kind: 'f32', values: Float32Array.from(column('albedo'), number) },
    { name: 'n_obs_used', kind: 'u16', values: Uint16Array.from(observations) },
    { name: 'neo', kind: 'u8', values: flags('neo') },
    { name: 'pha', kind: 'u8', values: flags('pha') },
    { name: 'class', kind: 'u8', values: Uint8Array.from(classOf, (name) => classIndex.get(name)!) },
    { name: 'name rows', kind: 'u32', values: Uint32Array.from(names, ([row]) => row) },
    { name: 'name offsets', kind: 'u32', values: nameOffsets },
    { name: 'name text', kind: 'u8', values: new Uint8Array(Buffer.concat(names.map(([, text]) => text))) },
  ]);
  return { ...built, classes, named: names.length };
}

// --- The built bytes read back, as the app will read them: each row's cells
// from the two files alone, against the fetch's.

function verify(catalog: Catalog, elements: Built, rowsBuilt: Built): Record<string, unknown> {
  const view = <T>(built: Built, name: string, make: new (buffer: ArrayBuffer, offset: number, length: number) => T, width: number): T => {
    const placed = built.layout.find((section) => section.name === name);
    if (!placed) throw new Error(`no section ${name}`);
    return new make(built.bytes.buffer as ArrayBuffer, built.bytes.byteOffset + placed.offset, placed.bytes / width);
  };
  const file = rowsBuilt.bytes;
  if (file.toString('latin1', 0, 4) !== 'KWR1' || elements.bytes.toString('latin1', 0, 4) !== 'KWE1') throw new Error('a file without its magic');
  const [rows, numbered, named, classCount] = [4, 8, 12, 16].map((at) => file.readUInt32LE(at)) as [number, number, number, number];
  if (rows !== catalog.rows || elements.bytes.readUInt32LE(4) !== rows || elements.bytes.readDoubleLE(8) !== EPOCH_JD) throw new Error("the headers don't agree");
  const classes: string[] = [];
  let cursor = 20;
  for (let index = 0; index < classCount; index++) {
    const length = file[cursor]!;
    classes.push(file.toString('utf8', cursor + 1, cursor + 1 + length));
    cursor += 1 + length;
  }
  const f32 = (built: Built, name: string) => view(built, name, Float32Array, 4);
  const [a, e, i, om, w, ma, H] = ['a', 'e', 'i', 'om', 'w', 'ma', 'H'].map((name) => f32(elements, name)) as [Float32Array, Float32Array, Float32Array, Float32Array, Float32Array, Float32Array, Float32Array];
  const [spkid, designation, nameRows, nameOffsets] = ['spkid', 'designation', 'name rows', 'name offsets'].map((name) => view(rowsBuilt, name, Uint32Array, 4)) as [Uint32Array, Uint32Array, Uint32Array, Uint32Array];
  const [first, last] = [view(rowsBuilt, 'first_obs', Int32Array, 4), view(rowsBuilt, 'last_obs', Int32Array, 4)];
  const [diameter, albedo] = [f32(rowsBuilt, 'diameter'), f32(rowsBuilt, 'albedo')];
  const observations = view(rowsBuilt, 'n_obs_used', Uint16Array, 2);
  const [neo, pha, classOf, nameText] = ['neo', 'pha', 'class', 'name text'].map((name) => view(rowsBuilt, name, Uint8Array, 1)) as [Uint8Array, Uint8Array, Uint8Array, Uint8Array];
  if (nameRows.length !== named) throw new Error('the names section isn\'t the header\'s count');
  /** A row's name: a binary search of the rows that have one. */
  const nameOf = (row: number): string | null => {
    let [low, high] = [0, named - 1];
    while (low <= high) {
      const middle = (low + high) >> 1;
      if (nameRows[middle]! === row) return Buffer.from(nameText.buffer, nameText.byteOffset + nameOffsets[middle]!, nameOffsets[middle + 1]! - nameOffsets[middle]!).toString('utf8');
      if (nameRows[middle]! < row) low = middle + 1;
      else high = middle - 1;
    }
    return null;
  };

  const F = Object.fromEntries(['spkid', 'full_name', 'pdes', 'name', 'neo', 'pha', 'class', 'H', 'diameter', 'albedo', 'a', 'e', 'i', 'q', 'per_y', 'first_obs', 'last_obs', 'n_obs_used', 'om', 'w', 'n', 'tp'].map((name) => [name, field(name)])) as Record<string, number>;
  const yn = (value: number): string | null => (value === 1 ? 'Y' : value === 0 ? 'N' : null);
  /** A float cell shows the fetch's own number when the stored float, written at its shortest, is it. */
  const shows = (stored: number, cell: Cell): boolean => (cell == null ? Number.isNaN(stored) : Number(shortest(stored)) === Number(cell));
  const worst = { q: 0, per_y: 0 };
  /** Each row's stored mean anomaly against JPL's own road to the epoch, in degrees. */
  const anomalyOff = new Float64Array(rows);
  let yearOnlyDates = 0;
  let noH = 0;
  catalog.cells.forEach((cells, row) => {
    const fail = (what: string): never => {
      throw new Error(`row ${row} (${String(cells[F.full_name!]).trim()}): ${what} doesn't read back`);
    };
    const asteroid = row < numbered ? row + 1 : 0;
    const provisional = unpackDesignation(designation[row]!);
    const name = nameOf(row);
    if (spkid[row] !== cells[F.spkid!]) fail('spkid');
    if (asteroid && spkid[row] !== 20_000_000 + asteroid) fail('the number');
    if (fullName(asteroid, name, provisional) !== String(cells[F.full_name!]).trim()) fail('full_name');
    if ((asteroid ? String(asteroid) : provisional.replace(/^A\//, '')) !== cells[F.pdes!]) fail('pdes');
    if (name !== cells[F.name!]) fail('name');
    if (yn(neo[row]!) !== cells[F.neo!] || yn(pha[row]!) !== cells[F.pha!]) fail('neo or pha');
    if (classes[classOf[row]!] !== cells[F.class!]) fail('class');
    if (dateText(first[row]!) !== cells[F.first_obs!] || dateText(last[row]!) !== cells[F.last_obs!]) fail('a date');
    if (first[row]! < NO_DATE + 10_000 && first[row] !== NO_DATE) yearOnlyDates++;
    if (observations[row] !== cells[F.n_obs_used!]) fail('n_obs_used');
    // H, the diameter, and the albedo have few digits: the float shows them exactly.
    if (!shows(H[row]!, cells[F.H!]!) || !shows(diameter[row]!, cells[F.diameter!]!) || !shows(albedo[row]!, cells[F.albedo!]!)) fail('H, the diameter, or the albedo');
    if (Number.isNaN(H[row]!)) noH++;
    // The elements have 16: the float is the nearest to them.
    for (const [stored, cell] of [[a, cells[F.a!]], [e, cells[F.e!]], [i, cells[F.i!]], [om, cells[F.om!]], [w, cells[F.w!]]] as const) {
      if (stored[row] !== Math.fround(Number(cell))) fail('an element');
    }
    if (ma[row] !== Math.fround(catalog.ma[row]!)) fail('the mean anomaly');
    // The move to the epoch, by a road that shares nothing with the
    // catalog's (the row's own epoch, the Gaussian constant): JPL's mean
    // motion times the days from its perihelion passage to the epoch.
    const bound = isBound(a[row]!, e[row]!);
    const jpl = number(cells[F.n!]) * (EPOCH_JD - number(cells[F.tp!]));
    if (!Number.isFinite(jpl)) fail('n or tp (none)');
    anomalyOff[row] = Math.abs(bound ? nearestTurn(jpl - ma[row]!) : jpl - ma[row]!);
    // q and the period aren't stored: they follow from the stored a and e.
    // How far from JPL's own, as a share of it.
    const [q, period] = [number(cells[F.q!]), number(cells[F.per_y!])];
    if (!(q > 0)) fail('q (none)');
    worst.q = Math.max(worst.q, Math.abs((a[row]! * (1 - e[row]!)) / q - 1));
    if (bound !== period > 0) fail('per_y (none on an ellipse, or one without)');
    if (bound) worst.per_y = Math.max(worst.per_y, Math.abs((GAUSS_YEAR_DAYS / 365.25) * a[row]! ** 1.5 / period - 1));
  });
  // A wrong move would put the 6% of rows off the epoch degrees out. JPL's
  // mean motion and the Gaussian one part ways only on rows whose a is kept
  // to few digits, so all but a thousandth of the rows must agree closely.
  anomalyOff.sort();
  const anomaly = { p999: anomalyOff[Math.floor(rows * 0.999)]!, worst: anomalyOff[rows - 1]! };
  if (!(anomaly.p999 < 0.01)) throw new Error(`the mean anomalies aren't JPL's at the epoch: 1 row in 1000 is ${anomaly.p999} degrees off or more`);
  if (!(worst.q < 1e-3 && worst.per_y < 1e-3)) throw new Error(`q or the period computed from a and e is ${Math.max(worst.q, worst.per_y)} of JPL's off, past 1 part in 1000`);
  return { rows, numbered, named, classes, yearOnlyDates, noH, meanAnomalyAgainstJplDegrees: anomaly, computedAgainstJpl: { qWorstShare: worst.q, periodWorstShare: worst.per_y } };
}

// --- Main.

const check = process.argv.includes('--check');
const catalog = readCatalog();
const elements = elementsFile(catalog);
const rowsBuilt = rowsFile(catalog);
const read = verify(catalog, elements, rowsBuilt);
console.log(`read back: ${JSON.stringify(read)}`);

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const calendar = (jd: number): string => new Date((jd - 2440587.5) * DAY_MS).toISOString().slice(0, 10);
const common = { rows: catalog.rows, source: catalog.info.source, fetched: catalog.info.fetched, writer: 'data/prep.ts; little-endian, each section on a 4-byte boundary' };
const manifest = {
  'elements.bin': {
    ...common,
    bytes: elements.bytes.length,
    sha256: sha256(elements.bytes),
    epoch: { jd: EPOCH_JD, date: calendar(EPOCH_JD), scale: 'TDB' },
    frame: 'heliocentric, ecliptic and equinox of J2000 (IAU76/80)',
    meanMotion: `${GAUSS} / a^1.5 radians a day (the Gaussian constant)`,
    layout: elements.layout,
    notes: [
      `rows fetched at another epoch, their mean anomaly moved to this one by their own mean motion: ${catalog.notes.offEpoch}`,
      `rows with no mean anomaly in the source (a circle: 0 at its epoch): ${catalog.notes.noMeanAnomaly.length}${catalog.notes.noMeanAnomaly.length ? ` (${catalog.notes.noMeanAnomaly.join(', ')})` : ''}`,
      `rows with no ellipse (e not below 1), their mean anomaly a hyperbola's and not an angle: ${catalog.notes.unbound}`,
      `rows with no H (NaN): ${read.noH}`,
    ],
  },
  'rows.bin': {
    ...common,
    bytes: rowsBuilt.bytes.length,
    sha256: sha256(rowsBuilt.bytes),
    numbered: catalog.numbered,
    named: rowsBuilt.named,
    classes: rowsBuilt.classes,
    layout: rowsBuilt.layout,
    notes: [
      `rows with a year-only first_obs in the source ('YYYY-??-??'), stored as the year: ${read.yearOnlyDates}`,
      'full_name and pdes are rebuilt from the row\'s number, name, and designation; q and per_y from the elements file\'s a and e; H is the elements file\'s',
    ],
  },
};
const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
const files = [['elements.bin', elements], ['rows.bin', rowsBuilt]] as const;

if (check) {
  let same = true;
  if (readFileSync(manifestPath, 'utf8') !== manifestText) {
    same = false;
    console.error('MANIFEST.json isn\'t what this run would write');
  }
  for (const [name, built] of files) {
    const onDisk = sha256(readFileSync(join(dataDir, name)));
    const fresh = sha256(built.bytes);
    console.log(`${name}: built ${fresh}, on disk ${onDisk}`);
    if (onDisk !== fresh) same = false;
  }
  if (!same) throw new Error('a second run of prep doesn\'t write the same bytes');
  console.log('check: the same bytes, and the same manifest');
} else {
  for (const [name, built] of files) writeFileSync(join(dataDir, name), built.bytes);
  writeFileSync(manifestPath, manifestText);
  for (const [name, built] of files) console.log(`${name}: ${built.bytes.length} bytes, sha256 ${sha256(built.bytes)}`);
}

if (process.argv.includes('--sizes')) {
  const compress = promisify(brotliCompress);
  const brotli = async (data: Uint8Array): Promise<number> => (await compress(data, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_LGWIN]: 24, [constants.BROTLI_PARAM_SIZE_HINT]: data.length } })).length;
  const mb = (bytes: number) => Number((bytes / 1e6).toFixed(2));
  const sizes: Record<string, { rawMB: number; brotliMB: number }> = {};
  // The table's first page of rows, were it sent apart: every column's first 1024 (the names aside).
  const firstPage = (built: Built): Buffer => Buffer.concat(built.layout.slice(1).filter((section) => !section.name.startsWith('name')).map((section) => built.bytes.subarray(section.offset, section.offset + (section.bytes / catalog.rows) * 1024)));
  await Promise.all(files.flatMap(([name, built]) => [
    brotli(built.bytes).then((size) => void (sizes[name] = { rawMB: mb(built.bytes.length), brotliMB: mb(size) })),
    ...built.layout.map((section) => brotli(built.bytes.subarray(section.offset, section.offset + section.bytes)).then((size) => void (sizes[`${name}: ${section.name}`] = { rawMB: mb(section.bytes), brotliMB: mb(size) }))),
    ((page) => brotli(page).then((size) => void (sizes[`${name}: its first 1024 rows`] = { rawMB: Number((page.length / 1e6).toFixed(4)), brotliMB: Number((size / 1e6).toFixed(4)) })))(firstPage(built)),
  ]));
  console.table(Object.fromEntries(Object.entries(sizes).sort(([left], [right]) => left.localeCompare(right))));
}
