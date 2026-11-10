// The fonts spike: the GPUI base build on the draft countries file,
// fonts added after first paint (and `?cjk`), each script's names cropped
// beside the DOM's drawing of the same names in the same faces.
//   node fonts-spike.ts [--state default|fonts] [--routeless]
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { brotliCompressSync, constants } from 'node:zlib';

const R = new URL('../../../..', import.meta.url).pathname.replace(/\/$/, '');
const HERE = new URL('.', import.meta.url).pathname;
const { chromium } = await import(`${R}/node_modules/playwright/index.mjs`);
const { open, waitMark } = await import(`${R}/shared-web/perf/harness.ts`);
const { serveGpui } = await import(`${R}/apps/observatory/perf/harness.ts`);
const sharp = (await import(`${R}/node_modules/sharp/dist/index.mjs`)).default;
const { DuckDBInstance } = await import(`${R}/apps/observatory/data/node_modules/@duckdb/node-api/lib/index.js`);

const state = process.argv.includes('--state') ? process.argv[process.argv.indexOf('--state') + 1] : 'fonts';
const route2 = process.argv.includes('--route2');
const OUT = `${HERE}out-${state}${route2 ? '-route2' : ''}${process.env.ROWS ? '-rows' : ''}`;
mkdirSync(OUT, { recursive: true });

// The faces, by script.
const FACES: Record<string, string> = {
  Arabic: 'NotoSansArabic', Armenian: 'NotoSansArmenian', Bengali: 'NotoSansBengali', Devanagari: 'NotoSansDevanagari',
  Ethiopic: 'NotoSansEthiopic', Georgian: 'NotoSansGeorgian', Hebrew: 'NotoSansHebrew', Khmer: 'NotoSansKhmer',
  Lao: 'NotoSansLao', Myanmar: 'NotoSansMyanmar', Sinhala: 'NotoSansSinhala', Thai: 'NotoSansThai', Tibetan: 'NotoSerifTibetan',
};
const SCRIPTS = [...Object.keys(FACES), 'Han', 'Hangul', 'Greek', 'Cyrillic'];
const scriptOf = (text: string) => SCRIPTS.find((s) => new RegExp(`\\p{Script=${s}}`, 'u').test(text)) ?? 'Latin';

// Bytes per script.
const bytes: Record<string, { ttf: number; br: number }> = {};
for (const [script, face] of Object.entries(FACES)) {
  const ttf = readFileSync(`${HERE}faces/${face}-Regular.ttf`);
  bytes[script] = { ttf: ttf.length, br: brotliCompressSync(ttf, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length };
}

// The rows, in the file's order, with each name's script.
const conn = await (await DuckDBInstance.create()).connect();
const rows = (await conn.runAndReadAll(`select name, "in English" from '${R}/apps/observatory/data/countries.parquet'`)).getRows() as [string, string][];
const byScript = new Map<string, number[]>();
rows.forEach(([name], i) => { const s = scriptOf(name); if (s !== 'Latin') byScript.set(s, [...(byScript.get(s) ?? []), i]); });

const server = await serveGpui(4381);
const params: Record<string, string> = { file: 'countries.parquet', cells: '' };
if (state === 'fonts') params.cjk = '';
const b = await open(chromium, server.url, { params });
const { page, context } = b;
await context.route('**/spike-fonts/*', (route) => route.fulfill({ body: readFileSync(`${HERE}faces/${route.request().url().split('/').pop()}`), contentType: 'font/ttf' }));
page.on('console', (m: any) => { if (m.text().startsWith('spike')) console.log(m.text()); });
await waitMark(page, 'contender:filled');

let timing: Record<string, number> = {};
if (state === 'fonts') {
  timing = await page.evaluate(async ({ faces, route2 }: { faces: string[]; route2: boolean }) => {
    const t0 = performance.now();
    const fonts = await Promise.all(faces.map(async (f) => new Uint8Array(await (await fetch(`/spike-fonts/${f}-Regular.ttf`)).arrayBuffer())));
    const t1 = performance.now();
    (globalThis as any).__spikeAddFonts(fonts, route2 ? faces.map((f) => f.replace(/^Noto(Sans|Serif)/, 'Noto $1 ').replace(/([a-z])([A-Z])/g, '$1 $2')) : []);
    const drawn = await new Promise<number>((resolve) => {
      const poll = () => { const e = performance.getEntriesByName('spike:fonts-drawn')[0]; e ? resolve(e.startTime) : setTimeout(poll, 5); };
      poll();
    });
    const fontsIn = performance.getEntriesByName('spike:fonts-in')[0].startTime;
    return { fetchMs: t1 - t0, addToDrawnMs: drawn - fontsIn, callToDrawnMs: drawn - t1 };
  }, { faces: Object.values(FACES), route2 });
  await page.waitForTimeout(300);
}
if (process.env.TIMING) { console.log('TIMING', JSON.stringify(timing)); await b.close(); await server.close(); process.exit(0); }
await page.screenshot({ path: `${OUT}/top.png` });

const columns = await page.evaluate(() => (globalThis as any).__contender.columns);
const name = columns[1];
const ROW_TOP = 47, ROW = 30;

/** Jumps the row into view and crops its name cell. */
async function gpuiCrop(row: number, path: string) {
  await page.evaluate((f: number) => (globalThis as any).__contender.replay.jump(f), Math.max(0, row - 3) / rows.length);
  await page.waitForTimeout(150);
  const visible: number[] = await page.evaluate(() => (globalThis as any).__contender.cells.map((c: any) => c.row));
  const top = Math.min(...visible);
  const bottomClamped = Math.max(...visible) === rows.length - 1;
  // At the end the view is pinned to the bottom: count up from the frame's bottom row.
  const index = row - top;
  let y = ROW_TOP + index * ROW;
  if (bottomClamped && top > 0) {
    const frameBottom = 900 - 16 - 1;
    y = frameBottom - (rows.length - row) * ROW;
  }
  await page.screenshot({ path, clip: { x: 63 + name.x, y, width: name.width, height: ROW } });
}

// The DOM's drawing: the same cell box, IBM Plex Sans then the script's face; CJK the system's.
const dom = await context.newPage();
const faceCss = [`@font-face { font-family: 'IBM Plex Sans'; src: url(/spike-ui.ttf); }`, ...Object.values(FACES).map((f) => `@font-face { font-family: '${f}'; src: url(/spike-fonts/${f}-Regular.ttf); }`)].join('\n');
await context.route('**/spike-ui.ttf', (route) => route.fulfill({ body: readFileSync(`${R}/shared-web/fonts/IBMPlexSans-Regular.ttf`), contentType: 'font/ttf' }));
await dom.goto(`${new URL(server.url).origin}/spike-dom`).catch(() => {});
await dom.setContent(`<!doctype html><style>${faceCss}
  body { margin: 0; background: #fff; color: #000; }
  .c { box-sizing: border-box; width: ${name.width}px; height: 30px; padding: 0 8px; font: 14px/30px 'IBM Plex Sans', ${Object.values(FACES).map((f) => `'${f}'`).join(', ')}, sans-serif; white-space: nowrap; overflow: hidden; }
</style><div id=cells></div>`);
await dom.evaluate(async (faces: string[]) => { await Promise.all(['IBM Plex Sans', ...faces].map((f) => document.fonts.load(`14px '${f}'`, 'a'))); }, Object.values(FACES));

async function domCrop(text: string, path: string) {
  await dom.evaluate((t: string) => { const c = document.getElementById('cells')!; c.innerHTML = ''; const d = document.createElement('div'); d.className = 'c'; d.textContent = t; c.append(d); }, text);
  await dom.evaluate(() => document.fonts.ready);
  await dom.locator('.c').screenshot({ path });
}

/** Columns of ink: darker than the crop's commonest (background) color. */
async function ink(path: string) {
  const { data, info } = await sharp(path).greyscale().raw().toBuffer({ resolveWithObject: true });
  const counts = new Map<number, number>();
  for (const v of data) counts.set(v, (counts.get(v) ?? 0) + 1);
  const bg = [...counts].sort((a, b) => b[1] - a[1])[0][0];
  const profile = new Array(info.width).fill(0);
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) profile[x] += Math.max(0, bg - data[y * info.width + x] - 40) > 0 ? bg - data[y * info.width + x] : 0;
  const cols = profile.map((v, x) => (v > 0 ? x : -1)).filter((x) => x >= 0);
  const [lo, hi] = cols.length ? [cols[0], cols[cols.length - 1]] : [0, -1];
  return { width: (hi - lo + 1) / 2, profile: profile.slice(lo, hi + 1) };
}

/** Correlation of two ink profiles, resampled to the shorter's length. */
function corr(a: number[], b: number[]) {
  const n = Math.min(a.length, b.length);
  if (n < 2) return NaN;
  const rs = (p: number[]) => Array.from({ length: n }, (_, i) => p[Math.floor((i * p.length) / n)]);
  const [x, y] = [rs(a), rs(b)];
  const m = (v: number[]) => v.reduce((s, q) => s + q, 0) / n;
  const [mx, my] = [m(x), m(y)];
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; }
  return sxy / Math.sqrt(sxx * syy);
}

const results: any[] = [];
const ONLY = process.env.ROWS?.split(',').map(Number);
for (const script of [...byScript.keys()].sort()) {
  for (const row of ONLY ? byScript.get(script)!.filter((r) => ONLY.includes(r)) : byScript.get(script)!.slice(0, 4)) {
    const text = rows[row][0];
    const id = `${script}-${row}`;
    await gpuiCrop(row, `${OUT}/${id}-gpui.png`);
    await domCrop(text, `${OUT}/${id}-dom.png`);
    const g = await ink(`${OUT}/${id}-gpui.png`), d = await ink(`${OUT}/${id}-dom.png`);
    const r: any = { script, row, text, english: rows[row][1], gpuiWidth: g.width, domWidth: d.width, corr: +corr(g.profile, d.profile).toFixed(3) };
    if (script === 'Arabic' || script === 'Hebrew') {
      // Isolated forms (a ZWNJ between letters) and the logical order forced left to right.
      await domCrop([...text].join('‌'), `${OUT}/${id}-isolated.png`);
      await domCrop(`‭${text}‬`, `${OUT}/${id}-ltr.png`);
      const iso = await ink(`${OUT}/${id}-isolated.png`), ltr = await ink(`${OUT}/${id}-ltr.png`);
      Object.assign(r, { isolatedWidth: iso.width, corrIsolated: +corr(g.profile, iso.profile).toFixed(3), corrForcedLtr: +corr(g.profile, ltr.profile).toFixed(3) });
    }
    results.push(r);
  }
}

// A sheet: each name, GPUI over the DOM.
const img = (p: string) => `data:image/png;base64,${readFileSync(p).toString('base64')}`;
const sheet = results.map((r) => `<tr><td>${r.script}</td><td>${r.english}</td><td><img src="${img(`${OUT}/${r.script}-${r.row}-gpui.png`)}"></td><td><img src="${img(`${OUT}/${r.script}-${r.row}-dom.png`)}"></td><td>${r.gpuiWidth} / ${r.domWidth}${r.isolatedWidth ? ` (iso ${r.isolatedWidth})` : ''}</td><td>${r.corr}</td></tr>`).join('');
writeFileSync(`${OUT}/sheet.html`, `<!doctype html><style>body{font:12px sans-serif;margin:8px} td{padding:2px 8px;border-bottom:1px solid #ddd} img{width:${name.width}px;height:30px;display:block}</style><table><tr><th>script</th><th>English</th><th>GPUI</th><th>DOM</th><th>ink px G/D</th><th>corr</th></tr>${sheet}</table>`);
const sheetPage = await context.newPage();
await sheetPage.setViewportSize({ width: 1100, height: 400 });
await sheetPage.goto(`file://${OUT}/sheet.html`).catch(async () => sheetPage.setContent(readFileSync(`${OUT}/sheet.html`, 'utf8')));
await sheetPage.screenshot({ path: `${OUT}/sheet.png`, fullPage: true });

writeFileSync(`${OUT}/results.json`, JSON.stringify({ state, timing, bytes, results, problems: b.problems }, null, 1));
console.log(JSON.stringify({ timing, problems: b.problems }, null, 1));
console.table(results.map(({ script, row, english, gpuiWidth, domWidth, corr, isolatedWidth, corrIsolated, corrForcedLtr }) => ({ script, row, english, gpuiWidth, domWidth, corr, isolatedWidth, corrIsolated, corrForcedLtr })));
await b.close();
await server.close();
