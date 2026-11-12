// Builds the sky's file, data/stars.bin (gitignored), from Tycho's Gaia
// sample: its stars brighter than G 10.5, each as a direction, a brightness,
// and a tint. data/MANIFEST.json (committed) pins it by its bytes, beside
// the two files prep.ts builds, with the sample it was read from and the
// credit. Its layout, and how to read it: docs/data.md.
//
// The stars aren't rows of the asteroid table: they're the scene's backdrop
// (docs/DECISIONS.md, "Look").
//
// Usage: node apps/kirkwood/data/stars.ts <gaia-dr3-bright.parquet> [--check]
//
//   (nothing)  writes the file and its entry in the manifest
//   --check    builds it again and fails unless its bytes are the manifest's
//              and the disk's; writes nothing
//
// The sample is Tycho's (`just tycho data gaia` builds it), and must be the
// file Tycho's own manifest pins, which is read from beside it. Reading
// Parquet needs native DuckDB, this directory's one dependency, installed
// apart: npm install --prefix apps/kirkwood/data

import { createHash } from 'node:crypto';
import { createReadStream, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Stars brighter than this G are the sky (`docs/DECISIONS.md`, "Look"). */
const CUT = 10.5;
/** The obliquity of the ecliptic at J2000 (IAU 1976), degrees: ICRS turned
 *  about x by it is the frame the asteroids' elements are in. */
const OBLIQUITY = 23.4392911;
const MAGIC = 'KWS1';
const HEADER = 8;
/** ESA's acknowledgement, word for word. */
const CREDIT = 'This work has made use of data from the European Space Agency (ESA) mission Gaia, processed by the Gaia Data Processing and Analysis Consortium (DPAC).';

const dataDir = dirname(fileURLToPath(import.meta.url));
const manifestPath = join(dataDir, 'MANIFEST.json');
const starsPath = join(dataDir, 'stars.bin');

const check = process.argv.includes('--check');
const sample = process.argv.slice(2).find((arg) => !arg.startsWith('--'));
if (!sample) throw new Error('usage: node stars.ts <gaia-dr3-bright.parquet> [--check]');

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
async function sha256Of(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const piece of createReadStream(path)) hash.update(piece as Buffer);
  return hash.digest('hex');
}

// The sample is the one Tycho's manifest pins.
type Pinned = { rows: number; bytes: number; sha256: string; source: string; fetched: string };
const pinned = (JSON.parse(readFileSync(join(dirname(sample), 'MANIFEST.json'), 'utf8')) as Record<string, Pinned | undefined>)[basename(sample)];
if (!pinned) throw new Error(`the manifest beside ${basename(sample)} doesn't name it`);
if (statSync(sample).size !== pinned.bytes) throw new Error(`${basename(sample)} is ${statSync(sample).size} bytes, and its manifest's is ${pinned.bytes}`);
const sampleSha = await sha256Of(sample);
if (sampleSha !== pinned.sha256) throw new Error(`${basename(sample)} isn't the file its manifest pins (sha256 ${sampleSha})`);

// Native DuckDB, named by a string so the data's typecheck doesn't need it
// installed: only this script reads Parquet.
interface DuckDB {
  DuckDBInstance: { create(path: string): Promise<{ connect(): Promise<{ runAndReadAll(sql: string): Promise<{ getColumns(): unknown[][] }> }> }> };
}
const duckdb = (await import('@duckdb/node-api' as string).catch(() => {
  throw new Error('no native DuckDB: npm install --prefix apps/kirkwood/data');
})) as DuckDB;
const connection = await (await duckdb.DuckDBInstance.create(':memory:')).connect();
const quoted = `'${sample.replaceAll("'", "''")}'`;
// Brightest first, so a reader takes a brighter cut by reading fewer; ties
// by Gaia's own key, so the order is the same every run.
const read = await connection.runAndReadAll(
  `select ra::double, dec::double, phot_g_mean_mag::double, bp_rp::double from read_parquet(${quoted}) where phot_g_mean_mag < ${CUT} order by phot_g_mean_mag, source_id`,
);
const [ra, dec, g, color] = read.getColumns() as [number[], number[], number[], (number | null)[]];
const stars = ra.length;
if (!stars) throw new Error(`no stars under G ${CUT} in ${basename(sample)}`);

// The header, each star's direction (three i16s), and, on a 4-byte
// boundary, each star's light (two u8s).
const lightAt = Math.ceil((HEADER + stars * 6) / 4) * 4;
const bytes = Buffer.alloc(lightAt + Math.ceil((stars * 2) / 4) * 4);
bytes.write(MAGIC, 0, 'latin1');
bytes.writeUInt32LE(stars, 4);
const [sin, cos] = [Math.sin((OBLIQUITY * Math.PI) / 180), Math.cos((OBLIQUITY * Math.PI) / 180)];
const radians = (degrees: number) => (degrees * Math.PI) / 180;
let untinted = 0;
for (let star = 0; star < stars; star++) {
  const [alpha, delta] = [radians(ra[star]!), radians(dec[star]!)];
  // The direction in ICRS, then in the ecliptic of J2000.
  const [x, y, z] = [Math.cos(delta) * Math.cos(alpha), Math.cos(delta) * Math.sin(alpha), Math.sin(delta)];
  const at = HEADER + star * 6;
  bytes.writeInt16LE(Math.round(x * 32767), at);
  bytes.writeInt16LE(Math.round((y * cos + z * sin) * 32767), at + 2);
  bytes.writeInt16LE(Math.round((-y * sin + z * cos) * 32767), at + 4);
  // G in twentieths of a magnitude; bp_rp from -1 in fiftieths, 255 for none.
  const tint = color[star];
  if (tint == null) untinted++;
  bytes[lightAt + star * 2] = Math.min(255, Math.max(0, Math.round(g[star]! * 20)));
  bytes[lightAt + star * 2 + 1] = tint == null ? 255 : Math.min(254, Math.max(0, Math.round((tint + 1) * 50)));
}

const under = (limit: number) => g.filter((magnitude) => magnitude < limit).length;
const entry = {
  stars,
  source: `Gaia DR3 gaia_source (${pinned.source}), through Tycho's sample ${basename(sample)}`,
  sample: { rows: pinned.rows, bytes: pinned.bytes, sha256: pinned.sha256 },
  fetched: pinned.fetched,
  cut: `phot_g_mean_mag < ${CUT}`,
  credit: CREDIT,
  writer: 'data/stars.ts; little-endian, each section on a 4-byte boundary, brightest first',
  bytes: bytes.length,
  sha256: sha256(bytes),
  frame: `unit directions in the ecliptic and equinox of J2000 (ICRS turned about x by ${OBLIQUITY} degrees); where each star was at Gaia's epoch, J2016.0`,
  layout: [
    { name: 'header', kind: 'u8', offset: 0, bytes: HEADER },
    { name: 'direction', kind: 'i16 x 3', offset: HEADER, bytes: stars * 6 },
    { name: 'light', kind: 'u8 x 2', offset: lightAt, bytes: stars * 2 },
  ],
  notes: [
    `the brightest star's G: ${g[0]}; stars under G 3, 6, and 8: ${under(3)}, ${under(6)}, ${under(8)} (the sample has nothing brighter, so the sky's very brightest stars, Sirius among them, aren't drawn)`,
    `stars with no bp_rp (their tint the Sun's): ${untinted}`,
  ],
};

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
if (check) {
  const onDisk = sha256(readFileSync(starsPath));
  console.log(`stars.bin: built ${entry.sha256}, on disk ${onDisk}`);
  if (onDisk !== entry.sha256 || JSON.stringify(manifest['stars.bin']) !== JSON.stringify(entry)) throw new Error("a second run doesn't write the same bytes, or the manifest's entry isn't this run's");
  console.log('check: the same bytes, and the same manifest');
} else {
  writeFileSync(starsPath, bytes);
  writeFileSync(manifestPath, `${JSON.stringify({ ...manifest, 'stars.bin': entry }, null, 2)}\n`);
  console.log(`stars.bin: ${stars} stars under G ${CUT}, ${bytes.length} bytes, sha256 ${entry.sha256}`);
  console.log(entry.notes.join('\n'));
}
