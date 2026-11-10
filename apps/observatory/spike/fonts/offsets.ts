import { execFileSync } from 'node:child_process';
const R = new URL('../../../..', import.meta.url).pathname.replace(/\/$/, '');
const { DuckDBInstance } = await import(`${R}/apps/observatory/data/node_modules/@duckdb/node-api/lib/index.js`);
const FACES: Record<string, string> = { Arabic: 'NotoSansArabic', Armenian: 'NotoSansArmenian', Bengali: 'NotoSansBengali', Devanagari: 'NotoSansDevanagari', Ethiopic: 'NotoSansEthiopic', Georgian: 'NotoSansGeorgian', Hebrew: 'NotoSansHebrew', Khmer: 'NotoSansKhmer', Lao: 'NotoSansLao', Myanmar: 'NotoSansMyanmar', Sinhala: 'NotoSansSinhala', Thai: 'NotoSansThai', Tibetan: 'NotoSerifTibetan' };
const conn = await (await DuckDBInstance.create()).connect();
const rows = (await conn.runAndReadAll(`select name, "in English", capital from '${R}/apps/observatory/data/countries.parquet'`)).getRows() as string[][];
const PLEX = `${R}/shared-web/fonts/IBMPlexSans-Regular.ttf`;
const hit: string[] = [];
let shaped = 0;
for (const [i, [name, english, capital]] of rows.entries()) for (const [col, text] of [['name', name], ['in English', english], ['capital', capital]]) {
  if (!text || /\p{Script=Han}|\p{Script=Hangul}/u.test(text)) continue;
  const script = Object.keys(FACES).find((s) => new RegExp(`\\p{Script=${s}}`, 'u').test(text));
  const font = script ? `${new URL('faces/', import.meta.url).pathname}${FACES[script]}-Regular.ttf` : PLEX;
  const out = execFileSync('hb-shape', [font, text, '--no-glyph-names'], { encoding: 'utf8' }).trim();
  shaped++;
  const offsets = [...out.matchAll(/(\d+)=(\d+)@(-?\d+),(-?\d+)/g)].filter((m) => m[3] !== '0' || m[4] !== '0');
  if (offsets.length) hit.push(`${i}\t${col}\t${english}\t${script ?? 'Plex'}\t${text}\t${offsets.map((m) => `g${m[1]}@${m[3]},${m[4]}`).join(' ')}`);
}
console.log(`shaped ${shaped} texts; ${hit.length} with a positioned mark`);
console.log(hit.join('\n'));
