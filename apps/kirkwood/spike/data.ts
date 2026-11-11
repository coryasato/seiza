// Throwaway: writes the spike's data files into public/ (gitignored).
//
//   elements.bin  from the asteroid sample (Tycho's asteroids.parquet): each
//                 row's a (au), e, and i (degrees) as three little-endian
//                 f32s, in the file's own row order. The angles aren't in
//                 the sample; the crate seeds them.
//   h.bin         each row's absolute magnitude H as one f32, the same
//                 order; 99 where the sample has none (the look draws such
//                 a row at its faintest, never not at all).
//   stars.bin     with a second path, the Gaia sample
//                 (gaia-dr3-bright.parquet): its stars brighter than
//                 `--cut` (G, default 10.5), brightest first, so a reader
//                 takes a brighter cut by reading fewer. A u32 count, then
//                 for every star three i16s (its direction as a unit vector
//                 × 32767, in the scene's axes: ecliptic x, ecliptic north,
//                 minus ecliptic y), then for every star two u8s (G × 20,
//                 and (bp_rp + 1) × 50, 255 for none).
//
// Usage: node apps/kirkwood/spike/data.ts <asteroids.parquet> [<gaia-dr3-bright.parquet>] [--cut 10.5]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DuckDBInstance } from '@duckdb/node-api';

const paths = process.argv.slice(2).filter((arg, at, all) => !arg.startsWith('--') && !all[at - 1]?.startsWith('--'));
const [source, gaia] = paths;
if (!source) throw new Error('usage: node data.ts <asteroids.parquet> [<gaia-dr3-bright.parquet>] [--cut 10.5]');
const cutAt = process.argv.indexOf('--cut');
const CUT = cutAt > 0 ? Number(process.argv[cutAt + 1]) : 10.5;
const out = join(import.meta.dirname, 'public');
mkdirSync(out, { recursive: true });
const quoted = (path: string) => `'${path.replaceAll("'", "''")}'`;

const db = await DuckDBInstance.create(':memory:');
const connection = await db.connect();
const reader = await connection.runAndReadAll(`select a::float, e::float, i::float, H::float from read_parquet(${quoted(source)})`);
const [a, e, i, h] = reader.getColumns() as [(number | null)[], (number | null)[], (number | null)[], (number | null)[]];
const rows = a.length;
const elements = new Float32Array(rows * 3);
const magnitudes = new Float32Array(rows);
let missing = 0;
let unbound = 0;
let dark = 0;
for (let row = 0; row < rows; row++) {
  const [ra, re, ri] = [a[row], e[row], i[row]];
  if (ra == null || re == null || ri == null) missing++;
  else if (re >= 1 || ra <= 0) unbound++;
  elements.set([ra ?? NaN, re ?? NaN, ri ?? NaN], row * 3);
  if (h[row] == null) dark++;
  magnitudes[row] = h[row] ?? 99;
}
writeFileSync(join(out, 'elements.bin'), Buffer.from(elements.buffer));
writeFileSync(join(out, 'h.bin'), Buffer.from(magnitudes.buffer));
console.log(`${rows} rows, ${elements.byteLength} bytes; ${missing} with a NULL element, ${unbound} unbound (e >= 1 or a <= 0)`);
const spread = await connection.runAndReadAll(`select min(H), quantile_cont(H, [0.0001, 0.001, 0.01, 0.1, 0.5, 0.9, 0.99]), max(H) from read_parquet(${quoted(source)})`);
console.log(`h.bin: ${magnitudes.byteLength} bytes; ${dark} rows with no H; min, quantiles (0.01%, 0.1%, 1%, 10%, 50%, 90%, 99%), max: ${JSON.stringify(spread.getRowsJson()[0])}`);

if (gaia) {
  const counts = await connection.runAndReadAll(
    `select ${[3, 4, 5, 6, 7, 8, 9, 10, 10.5, 11, 12].map((g) => `count(*) filter (phot_g_mean_mag < ${g})`).join(', ')}, min(phot_g_mean_mag) from read_parquet(${quoted(gaia)}) where phot_g_mean_mag < 12`,
  );
  console.log(`Gaia stars under G 3, 4, 5, 6, 7, 8, 9, 10, 10.5, 11, 12, and the brightest G: ${JSON.stringify(counts.getRowsJson()[0])}`);
  // Equatorial (ICRS) to ecliptic: a turn about x by the obliquity.
  const OBLIQUITY = (23.4392911 * Math.PI) / 180;
  const stars = await connection.runAndReadAll(`
    with unit as (
      select cos(radians(dec)) * cos(radians(ra)) as x, cos(radians(dec)) * sin(radians(ra)) as y, sin(radians(dec)) as z, phot_g_mean_mag as g, bp_rp
      from read_parquet(${quoted(gaia)}) where phot_g_mean_mag < ${CUT}
    )
    select x::float, (-y * ${Math.sin(OBLIQUITY)} + z * ${Math.cos(OBLIQUITY)})::float, (-(y * ${Math.cos(OBLIQUITY)} + z * ${Math.sin(OBLIQUITY)}))::float, g::float, bp_rp::float
    from unit order by g`);
  const [x, y, z, g, color] = stars.getColumns() as [number[], number[], number[], number[], (number | null)[]];
  const count = x.length;
  const bytes = Buffer.alloc(4 + count * 8);
  bytes.writeUInt32LE(count, 0);
  let uncolored = 0;
  for (let star = 0; star < count; star++) {
    bytes.writeInt16LE(Math.round(x[star]! * 32767), 4 + star * 6);
    bytes.writeInt16LE(Math.round(y[star]! * 32767), 4 + star * 6 + 2);
    bytes.writeInt16LE(Math.round(z[star]! * 32767), 4 + star * 6 + 4);
    const tint = color[star];
    if (tint == null) uncolored++;
    bytes[4 + count * 6 + star * 2] = Math.min(255, Math.max(0, Math.round(g[star]! * 20)));
    bytes[4 + count * 6 + star * 2 + 1] = tint == null ? 255 : Math.min(254, Math.max(0, Math.round((tint + 1) * 50)));
  }
  writeFileSync(join(out, 'stars.bin'), bytes);
  console.log(`stars.bin: ${count} stars under G ${CUT}, ${bytes.byteLength} bytes; ${uncolored} with no bp_rp`);
}
