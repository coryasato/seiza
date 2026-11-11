// Throwaway: the look's runs (src/look.ts), in headless Chromium at
// 1440×900, DPR 2 (`shared-web/perf/`'s `open`), on the build `run.ts`
// makes.
//
//   shots   the scene from three cameras (the opening shot, top-down, and
//           flown in to a drawn group), each as it was and with the look,
//           in out/look-<camera>-<before|after>.png; and out/look.html, a
//           sheet of them beside the references (out/ref-*.png, if there).
//   cost    what a frame costs with each part of the look: the scene's
//           frames drawn back to back, each waited on until the GPU
//           finished it (`BeltScene.bench`), so the number is the whole
//           frame and not the display's 16.7 ms. As it was; the buffer
//           alone; each part alone over the buffer; all of it. At the
//           display's resolution and at half.
//   paint   GPUI's first frame, the belt's, and the sky's, as it was and
//           with the look, over cold loads.
//
// Usage: node apps/kirkwood/spike/lookdev.ts [--only shots,cost,paint] [--runs 3] [--no-build] [--params exposure=1.2]
// Needs data/elements.bin (data/prep.ts) and public/stars.bin (data.ts). Writes out/.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Page } from '@playwright/test';
import { open, waitMark } from '../../../shared-web/perf/harness.ts';
import { flag, machineInfo, median, option } from '../../../shared-web/perf/protocol.ts';
import { serveApp } from '../../../shared-web/perf/serve.ts';

const dir = import.meta.dirname;
const out = join(dir, 'out');
const only = (option('only') ?? 'shots,cost,paint').split(',');
const RUNS = Number(option('runs') ?? 3);
const PORT = 4392;
/** Knobs added to every page with the look on (`--params exposure=1.2,stars=10`). */
const PARAMS = Object.fromEntries((option('params') ?? '').split(',').filter(Boolean).map((pair) => pair.split('=') as [string, string]));

type Params = Record<string, string>;
type Kirkwood = { state(): number[]; scene?: { bench(frames: number): [number, number]; stats: { rows: number; stars: number; frames: number; renderer: string } } };
/** The crate's `state` indices (run.ts's `S`). */
const S = { flown: 10, slide: 11, groupRows: 8 } as const;

/** The cameras, as the scene's knobs. The opening shot is the look's own
 *  default, spelled out so the scene as it was is shot from it too. */
const OPENING: Params = { az: '200', elev: '24', roll: '-34', dist: '13' };
const CAMERAS: Record<string, { params: Params; group?: { x: number; y: number; rx: number; ry: number } }> = {
  opening: { params: OPENING },
  top: { params: { az: '200', elev: '90', roll: '0', dist: '15.5' } },
  group: { params: OPENING, group: { x: 560, y: 560, rx: 70, ry: 60 } },
};

async function ready(url: string, params: Params) {
  const browsing = await open(chromium, url, { params });
  await waitMark(browsing.page, 'kirkwood:sky', 0, 120_000);
  await browsing.page.waitForFunction(() => {
    const scene = (globalThis as unknown as { __kirkwood: Kirkwood }).__kirkwood.scene;
    return !!scene && scene.stats.rows > 0 && scene.stats.frames > 5;
  });
  return browsing;
}
const stateIs = (page: Page, index: number, test: 'eq' | 'gte', value: number) =>
  page.waitForFunction(
    ({ index, test, value }) => {
      const now = (globalThis as unknown as { __kirkwood: Kirkwood }).__kirkwood.state()[index]!;
      return test === 'eq' ? now === value : now >= value;
    },
    { index, test, value },
    { timeout: 30_000, polling: 16 },
  );

async function shots(url: string) {
  const taken: Record<string, unknown>[] = [];
  // `--cameras opening --sides after --tag aces`: fewer shots, named apart, while tuning.
  const cameras = option('cameras')?.split(',');
  const sides = option('sides')?.split(',');
  const tag = option('tag') ? `-${option('tag')}` : '';
  for (const [camera, { params, group }] of Object.entries(CAMERAS)) {
    if (cameras && !cameras.includes(camera)) continue;
    for (const [side, look] of [['before', {}], ['after', { look: '1', ...PARAMS }]] as const) {
      if (sides && !sides.includes(side)) continue;
      const { page, problems, close } = await ready(url, { ...look, ...params });
      try {
        let rows = 0;
        if (group) {
          await page.mouse.move(group.x - group.rx, group.y);
          await page.mouse.down();
          for (let step = 1; step <= 48; step++) {
            const turn = (step / 48) * 2 * Math.PI + Math.PI;
            await page.mouse.move(group.x + group.rx * Math.cos(turn), group.y + group.ry * Math.sin(turn));
          }
          await page.mouse.up();
          await stateIs(page, S.flown, 'gte', 1);
          await stateIs(page, S.slide, 'eq', 1);
          rows = await page.evaluate((at) => (globalThis as unknown as { __kirkwood: Kirkwood }).__kirkwood.state()[at]!, S.groupRows);
        }
        await page.waitForTimeout(500);
        const name = `look-${camera}-${side}${tag}.png`;
        writeFileSync(join(out, name), await page.screenshot({ scale: 'css' }));
        // A part at the display's own pixels: what a dot and the grain are up close.
        writeFileSync(join(out, `look-${camera}-${side}${tag}-detail.png`), await page.screenshot({ clip: { x: 500, y: 330, width: 440, height: 275 }, scale: 'device' }));
        const stats = await page.evaluate(() => (globalThis as unknown as { __kirkwood: Kirkwood }).__kirkwood.scene!.stats);
        console.log(`${name}: ${stats.rows} rows, ${stats.stars} stars${group ? `, a group of ${rows} rows` : ''}${problems.length ? `; PROBLEMS ${problems.join(' | ')}` : ''}`);
        taken.push({ name, rows: stats.rows, stars: stats.stars, group: rows, problems });
      } finally {
        await close();
      }
    }
  }
  if (!tag) sheet();
  return taken;
}

/** out/look.html: the references, then each camera as it was and with the look. */
function sheet() {
  const refs = readdirSync(out).filter((name) => /^ref-.*\.(png|jpg)$/.test(name)).sort();
  const figure = (src: string, label: string) => `<figure><img src="${src}" loading="lazy"><figcaption>${label}</figcaption></figure>`;
  const html = `<!doctype html><meta charset="utf-8"><title>Kirkwood: the look</title>
<style>
  body { margin: 24px; background: #0b0c10; color: #c9ccd4; font: 14px/1.4 system-ui, sans-serif; }
  h2 { font-size: 15px; margin: 28px 0 8px; }
  .row { display: grid; grid-template-columns: repeat(auto-fit, minmax(420px, 1fr)); gap: 12px; }
  figure { margin: 0; } img { width: 100%; display: block; border: 1px solid #23252d; } figcaption { padding: 4px 0; color: #8b8f9a; }
</style>
<h2>The references</h2><div class="row">${refs.map((name) => figure(name, name)).join('')}</div>
${Object.keys(CAMERAS)
  .map((camera) => `<h2>${camera}</h2><div class="row">${figure(`look-${camera}-before.png`, 'as it was')}${figure(`look-${camera}-after.png`, 'with the look')}</div><div class="row">${figure(`look-${camera}-before-detail.png`, 'as it was, at the display\'s pixels')}${figure(`look-${camera}-after-detail.png`, 'with the look, at the display\'s pixels')}</div>`)
  .join('\n')}
`;
  writeFileSync(join(out, 'look.html'), html);
}

/** Each part alone over the buffer, so a part's cost is its row less `hdr`'s. */
const CONFIGS: Record<string, Params> = {
  before: {},
  hdr: { hdr: '1' },
  mag: { hdr: '1', mag: '1' },
  bloom: { hdr: '1', bloom: '1' },
  haze: { hdr: '1', haze: '1' },
  floor: { hdr: '1', floor: '1' },
  stars: { hdr: '1', stars: '10.5' },
  sun: { hdr: '1', sun: '1' },
  all: { look: '1' },
  'all-bloom-half': { look: '1', bloomScale: '0.5' },
  'all-no-bloom': { look: '1', bloom: '0' },
};

async function cost(url: string) {
  const table: Record<string, Record<string, number>> = {};
  let renderer = '';
  for (const scale of ['1', '0.5']) {
    for (const [name, config] of Object.entries(CONFIGS)) {
      if (option('configs') && !option('configs')!.split(',').includes(name)) continue;
      const medians: number[] = [];
      const tails: number[] = [];
      for (let run = 0; run < RUNS; run++) {
        // Every config from the opening camera, so only the look differs.
        const { page, close } = await ready(url, { ...OPENING, ...config, ...(name.startsWith('all') ? PARAMS : {}), scale });
        try {
          const [p50, p90] = await page.evaluate(() => (globalThis as unknown as { __kirkwood: Kirkwood }).__kirkwood.scene!.bench(120));
          renderer = await page.evaluate(() => (globalThis as unknown as { __kirkwood: Kirkwood }).__kirkwood.scene!.stats.renderer);
          medians.push(p50);
          tails.push(p90);
        } finally {
          await close();
        }
      }
      (table[name] ??= {})[`ms@${scale}`] = Number(median(medians).toFixed(2));
      table[name]![`p90@${scale}`] = Number(median(tails).toFixed(2));
      console.log(`${name} at scale ${scale}: ${medians.map((ms) => ms.toFixed(2)).join(', ')} ms a frame`);
    }
  }
  for (const row of Object.values(table)) {
    for (const scale of ['1', '0.5']) if (table.hdr) row[`over hdr@${scale}`] = Number((row[`ms@${scale}`]! - table.hdr[`ms@${scale}`]!).toFixed(2));
  }
  console.table(table);
  return { renderer, runs: RUNS, frames: 120, table };
}

async function paint(url: string) {
  const table: Record<string, Record<string, number>> = {};
  const runs = Math.max(RUNS, 5);
  for (const [name, params] of [['before', {}], ['look', { look: '1', ...PARAMS }]] as const) {
    const marks: Record<string, number[]> = { 'gpui:first-frame': [], 'kirkwood:scene': [], 'kirkwood:belt': [], 'kirkwood:sky': [] };
    for (let run = 0; run < runs; run++) {
      const { page, close } = await ready(url, params);
      try {
        const times = await page.evaluate((names) => names.map((mark) => performance.getEntriesByName(mark, 'mark').at(-1)?.startTime ?? NaN), Object.keys(marks));
        Object.values(marks).forEach((list, at) => list.push(times[at]!));
      } finally {
        await close();
      }
    }
    table[name] = Object.fromEntries(Object.entries(marks).map(([mark, list]) => [mark, Number(median(list).toFixed(0))]));
  }
  console.table(table);
  return { runs, table };
}

if (!flag('no-build')) execFileSync('node', [join(dir, 'run.ts'), '--only', 'bytes'], { stdio: 'inherit' });
mkdirSync(out, { recursive: true });
if (!existsSync(join(dir, 'public/stars.bin'))) throw new Error('public/stars.bin: run data.ts with both samples');
const result: Record<string, unknown> = { ...machineInfo(), params: PARAMS };
const server = await serveApp(undefined, { webDir: dir, port: PORT });
try {
  if (only.includes('shots')) result.shots = await shots(server.url);
  if (only.includes('cost')) result.cost = await cost(server.url);
  if (only.includes('paint')) result.paint = await paint(server.url);
} finally {
  await server.close();
}
writeFileSync(join(out, `look-${only.join('-')}.json`), `${JSON.stringify(result, null, 2)}\n`);
