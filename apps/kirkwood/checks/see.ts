// What the release build shows, in headless Chromium (1440×900 at DPR 2):
// things to see and a few numbers to write down, never a budget (a showcase
// has none).
//
//   paint   a load on Fast 4G with the CPU slowed 4×: a screenshot right after
//           GPUI's first frame (out/first-frame.jpg) and one while the files
//           arrive (out/loading.jpg). Then cold loads unthrottled: the order
//           of each load's requests and marks. Fails if anything but the
//           page, its script, the wasm, and the font was asked for before
//           the first frame (the scene's module and the files come after),
//           or if the first-frame mark isn't right after a task that did GPU
//           work.
//   table   the panel opened by its handle: the rows the table says it has
//           against the manifest's, its columns, the first row's cells as
//           drawn, the columns under a sideways wheel, then End and the last
//           row's (out/table.jpg, out/table-columns*.jpg, out/table-end.jpg). Fails unless the first row is Ceres and the
//           last the fixture's last.
//   memory  the wasm's memory at the first frame, with both files held and
//           the belt drawn, and (with `table`) with the table open, against
//           the files' own bytes. Fails if holding the files grew it by more
//           than their bytes and 8 MB: the scene's attributes are views.
//   belt    the belt on the elements' epoch, time held: the opening view
//           (out/belt.jpg) and its counts (out/counts.jpg), which must be
//           the elements file's own (the rows with an ellipse, and without);
//           from straight above with the lines toward Jupiter and its 60°
//           points, all of it, the Trojans' orbit sizes lit, and the Hildas'
//           (out/seen-*.jpg). Then Ceres, Vesta, and Hektor drawn alone, at
//           the epoch and a decade on (out/alone-*.png): fails unless each
//           disc's center is within a CSS pixel of where the crate's own
//           64-bit place projects, and unless a place a twentieth of a year
//           off (the control) is farther.
//   time    the time control: the clock a year a second once the belt is
//           drawn, held by Pause (and the scene drawing nothing meanwhile),
//           run again; stopped at its last day (out/time-end.jpg) and
//           started over; a date past its reach opened at the reach's end.
//   bodies  the Sun and Jupiter: each name beside its disc, where the crate
//           puts the body, at rest and with time running; the discs' colors
//           where they should be (out/bodies.jpg).
//   look    the look, with the sky in, on the epoch, from the look's three
//           cameras (out/look-opening.jpg, look-top.jpg, look-group.jpg, and
//           each one's middle at the display's pixels, look-*-detail.png),
//           for docs/spike/look-*-after.jpg to be set beside. Fails unless a
//           row with no H, drawn alone as the belt's dots are, is drawn.
//   color   color is orbit size: the legend's bar at each of the ramp's
//           stops against the tint the scene is given (out/legend.jpg), and
//           the belt from straight above with no sky, haze, or bloom: fails
//           unless the dust 2.2 to 2.4 au out is warm (more red than blue),
//           3.1 to 3.3 au out is blue, and each is the ramp's tint there
//           more than the other's.
//   sky     the sky: asked for after the rows file is held and the belt is
//           drawn, its stars the manifest's; and the page's text over it
//           (out/sky-text.jpg): the scene under the text, with and without
//           the quiet the scene keeps there, against the text's color.
//   wheel   a wheel over the scene zooms it and leaves the table; over the
//           table it scrolls the rows and leaves the scene; and the scene
//           centers in what the open panel leaves (out/panel.jpg).
//
// Run only when asked for by name (minutes more each):
//
//   rate    the scene's frames a second while time runs, at the display's
//           resolution, three quarters, and half, each with the bloom whole,
//           at half its size, and off (the median of `--rate-runs` loads, 3;
//           `--panel` opens the table first; `--ways "name:knob=value&…;…"`
//           adds ways to draw, `--ways-only` runs those alone). Fails if the
//           scene draws a frame at rest.
//   slow    one load on Fast 4G with the CPU slowed 4×, the three files at
//           brotli 11 as a deploy would send them (compressed once, a minute
//           or two a file): when the first frame, the scene, the first dots,
//           the whole belt, the rows, and the sky arrive, and what the page
//           shows on the way (out/slow-*.jpg). Fails unless, while the belt
//           fills, the page's count is the file's for the rows drawn, the
//           scene draws those rows alone, and time waits.
//   cross   `--browser firefox|webkit` (at DPR 1): the first frame, the belt
//           and its counts, the panel's first row (out/cross-<browser>-*.jpg).
//           `--browser` runs this and `wheel`, nothing else.
//
// Usage: node apps/kirkwood/checks/see.ts [--only paint,table,memory,belt,time,bodies,look,color,sky,wheel,rate,slow,cross] [--runs 5] [--browser firefox|webkit]
// --only picks what's run and checked, not only what's printed.
// Run `just kirkwood build` first. Writes out/seen.json (out/seen-<browser>.json off Chromium).

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, firefox, webkit, type Page } from '@playwright/test';
import { clickTarget, firstDrawProbe, open, waitMark, wheel, type FirstDrawProbe } from '../../../shared-web/perf/harness.ts';
import { PROFILES, flag, localDate, machineInfo, median, option } from '../../../shared-web/perf/protocol.ts';
import { serveApp } from '../../../shared-web/perf/serve.ts';
import { readElements, type ElementsFile } from '../data/elements.ts';

const dir = import.meta.dirname;
const out = join(dir, 'out');
const PORT = 4370;
const RUNS = Number(option('runs') ?? 5);
/** The parts that are loads repeated `--runs` times. */
const LOADS = ['paint', 'table', 'memory'];
const PARTS = [...LOADS, 'belt', 'time', 'bodies', 'look', 'color', 'sky', 'wheel', 'rate', 'slow', 'cross'];
/** `--browser`: the engine `cross` and `wheel` run in; every other part is Chromium's. */
const BROWSER = option('browser') ?? 'chromium';
const ENGINE = ({ chromium, firefox, webkit } as Record<string, typeof chromium | undefined>)[BROWSER]!;
if (!ENGINE) throw new Error(`--browser wants chromium, firefox, or webkit; got "${BROWSER}"`);
/** `rate`: the loads each way is the median of, whether the panel is open,
 *  and more ways to draw (`--ways "name:knob=value&knob=value;…"`). */
const RATE_RUNS = Number(option('rate-runs') ?? 3);
const RATE_PANEL = flag('panel');
const RATE_MORE = (option('ways') ?? '')
  .split(';')
  .filter(Boolean)
  .map((way): [string, Record<string, string>] => {
    const [name, query = ''] = way.split(':');
    return [name!, Object.fromEntries(new URLSearchParams(query))];
  });
/** Asked for by name alone: the frame rates, the slow link, and another browser take minutes more. */
const ASKED = ['rate', 'slow', 'cross'];
const ONLY = new Set((option('only') ?? PARTS.filter((part) => !ASKED.includes(part)).join(',')).split(','));
if (ENGINE !== chromium && [...ONLY].some((part) => part !== 'cross' && part !== 'wheel')) throw new Error('--browser runs --only cross,wheel; every other part is Chromium\'s');
if (!Number.isInteger(RUNS) || RUNS < 1) throw new Error(`--runs wants a whole number of loads, 1 or more; got "${option('runs')}"`);
if (!ONLY.size || [...ONLY].some((part) => !PARTS.includes(part))) throw new Error(`--only wants some of ${PARTS.join(', ')}; got "${option('only')}"`);

const FIRST_FRAME = 'gpui:first-frame';
const ELEMENTS = 'kirkwood:elements';
const ROWS = 'kirkwood:rows';
const SCENE = 'kirkwood:scene';
/** The elements' first block of rows is on screen; and, at `BELT`, every row. */
const DOTS = 'kirkwood:first-dots';
const BELT = 'kirkwood:belt';
const TABLE = 'kirkwood:table';
const SKY = 'kirkwood:sky';
/** What first paint may wait on, by path. */
const FIRST_PAINT = [/^\/$/, /^\/assets\/index-[\w-]+\.js$/, /^\/assets\/kirkwood_bg-[\w-]+\.wasm$/, /^\/assets\/IBMPlexSans-Regular-[\w-]+\.ttf$/];
/** The elements' epoch, where the files' places are JPL's own. */
const EPOCH = '2026-06-09';
/** The panel's width (`host.rs`), CSS px. */
const PANEL = 560;

type FileInfo = { rows: number; bytes: number };
const manifest = JSON.parse(readFileSync(join(dir, '../data/MANIFEST.json'), 'utf8')) as Record<'elements.bin' | 'rows.bin', FileInfo> & { 'stars.bin': { stars: number; bytes: number } };
const fixture = JSON.parse(readFileSync(join(dir, '../data/fixture.json'), 'utf8')) as { rows: { rule: string; row: number; cells: { full_name: string } }[] };
const FILE_BYTES = manifest['elements.bin'].bytes + manifest['rows.bin'].bytes;
const TABLE_ROWS = manifest['rows.bin'].rows;

type Clock = { years: number; running: boolean; held: boolean; ended: boolean; first: number; last: number; date: string };
type Label = { text: string; left: number; top: number; width: number; height: number; shown: boolean };
type SceneStats = { frames: number; years: number; rows: number; points: number; stars: number; renderer: string; distance: number };
type Kirkwood = {
  wasmBytes(): number;
  wasmBytesAtFirstFrame: number;
  held: number;
  scene?: { stats: SceneStats; viewProjection(): number[]; labels(): Label[]; under(x: number, y: number): [number, number] | undefined };
  viewsShareMemory?: boolean;
  placeOf(row: number, years: number): number[];
  jupiter(years: number): number[];
  clock(): Clock;
  belt(): { drawn: number; unbound: number; rows: number; of: number };
  ramp(): number[];
  scrim(): number[];
};
type Probe = { rows: number; first: number; end: number; loaded: number; pending: number };
type Layout = { left: number; top: number; rowHeight: number; columns: { name: string }[] };
type Cell = { row: number; column: number; exact: string; shown: string };
type Page_ = { __kirkwood: Kirkwood; __kirkwoodTable?: Probe; __kirkwoodLayout?: Layout; __kirkwoodCells?: Cell[] };

const round = (ms: number) => Number(ms.toFixed(1));
const mb = (bytes: number) => Number((bytes / 1e6).toFixed(2));
type Clip = { x: number; y: number; width: number; height: number };
const shot = (page: Page, name: string, clip?: Clip) => page.screenshot({ path: join(out, `${name}.jpg`), type: 'jpeg', quality: 85, ...(clip ? { clip } : {}) });
const need = (ok: boolean, what: string) => {
  if (!ok) throw new Error(what);
};
const near = (a: number, b: number, within: number) => Math.abs(a - b) <= within;

/** The drawn cells of `row`, by column, once the table has drawn it loaded. */
async function drawnRow(page: Page, row: number): Promise<string[]> {
  try {
    const handle = await page.waitForFunction(
      (row) => {
        const cells = (globalThis as unknown as Page_).__kirkwoodCells?.filter((cell) => cell.row === row) ?? [];
        return cells.length ? cells.sort((a, b) => a.column - b.column).map((cell) => cell.exact) : false;
      },
      row,
      { timeout: 15_000, polling: 50 },
    );
    return (await handle.jsonValue()) as string[];
  } catch {
    const state = await page.evaluate(() => {
      const page = globalThis as unknown as Page_;
      return { probe: page.__kirkwoodTable, drawn: [...new Set(page.__kirkwoodCells?.map((cell) => cell.row))] };
    });
    throw new Error(`row ${row} wasn't drawn: the table shows ${JSON.stringify(state)}`);
  }
}

/** A load on a slow link, for the first frame and the loading state as a visitor sees them. */
async function slowShots(url: string): Promise<void> {
  const { page, close } = await open(chromium, url, { profile: PROFILES.find((profile) => profile.name === 'throttled')! });
  try {
    await waitMark(page, FIRST_FRAME);
    await shot(page, 'first-frame');
    await page.waitForTimeout(6000);
    await shot(page, 'loading');
  } finally {
    await close();
  }
}

async function load(url: string, first: boolean) {
  const { page, problems, close } = await open(chromium, url, { init: [firstDrawProbe], params: { 'probe-cells': '' } });
  try {
    const marks = {
      firstFrame: await waitMark(page, FIRST_FRAME),
      scene: await waitMark(page, SCENE),
      elements: await waitMark(page, ELEMENTS),
      dots: await waitMark(page, DOTS),
      belt: await waitMark(page, BELT),
      rows: await waitMark(page, ROWS),
    };
    const seen = await page.evaluate(() => {
      const kirkwood = (globalThis as unknown as Page_).__kirkwood;
      const probe = (globalThis as { __seizaProbe?: FirstDrawProbe }).__seizaProbe;
      return {
        requests: (performance.getEntriesByType('resource') as PerformanceResourceTiming[]).map((entry) => ({ path: new URL(entry.name).pathname, start: entry.startTime, end: entry.responseEnd })),
        gpuTasks: probe?.gpuTasks ?? [],
        api: probe?.api ?? '',
        wasmAtFirstFrame: kirkwood.wasmBytesAtFirstFrame,
        wasmWithFiles: kirkwood.wasmBytes(),
        viewsShareMemory: kirkwood.viewsShareMemory,
      };
    });
    const requests = [{ path: '/', start: 0, end: 0 }, ...seen.requests].sort((a, b) => a.start - b.start);

    const result = {
      marks,
      api: seen.api,
      requests: requests.filter((request) => request.start <= marks.rows).map((request) => ({ path: request.path, startMs: round(request.start), endMs: round(request.end) })),
      table: null as { rows: number; columns: string[]; firstRow: string[]; lastRow: string[] } | null,
      memory: { atFirstFrame: seen.wasmAtFirstFrame, withFiles: seen.wasmWithFiles, withTable: null as number | null, viewsShareMemory: seen.viewsShareMemory },
    };
    if (ONLY.has('paint')) checkPaint(requests, marks.firstFrame, seen.gpuTasks);
    if (ONLY.has('table')) {
      result.table = await seeTable(page, first);
      result.memory.withTable = await page.evaluate(() => (globalThis as unknown as Page_).__kirkwood.wasmBytes());
    }
    if (problems.length) throw new Error(`the page's problems: ${problems.join(' | ')}`);
    return result;
  } finally {
    await close();
  }
}

/** The first frame is on screen before anything but what it's made of is
 *  asked for, and its mark is honest. */
function checkPaint(requests: { path: string; start: number }[], firstFrame: number, gpuTasks: FirstDrawProbe['gpuTasks']): void {
  const early = requests.filter((request) => request.start < firstFrame && !FIRST_PAINT.some((pattern) => pattern.test(request.path)));
  if (early.length) throw new Error(`asked for before the first frame (${round(firstFrame)} ms): ${early.map((request) => `${request.path} at ${round(request.start)}`).join(', ')}`);
  const data = requests.filter((request) => request.path.startsWith('/data/'));
  // The sky's file comes last, and may not have been asked for yet.
  if (!['/data/elements.bin,/data/rows.bin', '/data/elements.bin,/data/rows.bin,/data/stars.bin'].includes(data.map((request) => request.path).join())) throw new Error(`the data asked for: ${data.map((request) => request.path).join(', ') || 'none'}`);
  if (!requests.some((request) => /^\/assets\/scene-[\w-]+\.js$/.test(request.path))) throw new Error("the scene's module wasn't asked for");
  // The mark is honest: inside the task that drew and presented the frame.
  const presenting = gpuTasks.find((task) => task.end !== null && task.lastGpuCall <= firstFrame && firstFrame <= task.end);
  if (!presenting) throw new Error(`the first-frame mark (${round(firstFrame)} ms) isn't right after a task that did GPU work`);
}

/** The table, behind its handle: what it says it has, and what it draws. */
async function seeTable(page: Page, first: boolean) {
  await clickTarget(page, 'table-handle');
  await waitMark(page, TABLE);
  const firstRow = await drawnRow(page, 0);
  // Let the panel's slide land before its picture, and before the cells' places are read.
  await page.waitForTimeout(500);
  const { probe, layout } = await page.evaluate(() => {
    const page = globalThis as unknown as Page_;
    return { probe: page.__kirkwoodTable!, layout: page.__kirkwoodLayout! };
  });
  if (first) {
    await shot(page, 'table');
    // The columns past the panel's width, by a sideways wheel, and back.
    await page.mouse.move(layout.left + 200, layout.top + layout.rowHeight * 3.5);
    for (const [name, x] of [['table-columns', 520], ['table-columns-end', 2000]] as const) {
      await wheel(page, 0, x);
      await page.waitForTimeout(400);
      await shot(page, name);
    }
    await wheel(page, 0, -4000);
    await page.waitForTimeout(400);
  }
  // Every row is there: End (the open panel has the keys), and the last
  // row drawn; then a press on a cell and Home, for the keys after a press.
  await page.keyboard.press('End');
  const lastRow = await drawnRow(page, TABLE_ROWS - 1);
  if (first) await shot(page, 'table-end');
  await page.mouse.click(layout.left + 200, layout.top + layout.rowHeight * 3.5);
  await page.keyboard.press('Home');
  await drawnRow(page, 0);
  return { rows: probe.rows, columns: layout.columns.map((column) => column.name), firstRow, lastRow };
}

// --- The scene.

/** A page with the belt drawn, and a frame presented after it. */
async function withBelt<T>(url: string, params: Record<string, string>, see: (page: Page) => Promise<T>): Promise<T> {
  const { page, problems, close } = await open(chromium, url, { params });
  try {
    await waitMark(page, BELT, 0, 120_000);
    await settle(page);
    const seen = await see(page);
    if (problems.length) throw new Error(`the page's problems: ${problems.join(' | ')}`);
    return seen;
  } finally {
    await close();
  }
}
/** Two frames on, so what was just drawn is on screen. */
const settle = (page: Page) => page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
const kirkwood = <T>(page: Page, read: (kirkwood: Kirkwood) => T): Promise<T> => page.evaluate(`(${read.toString()})(globalThis.__kirkwood)`) as Promise<T>;

/** A place (the ecliptic's x, y, z in au) in the window, CSS px, through
 *  the scene's own camera (`viewProjection`: column-major, then the
 *  window's size). The scene's axes are the ecliptic's x, north, minus y. */
function project(camera: number[], place: number[]): [number, number] {
  const [x, y, z] = [place[0]!, place[2]!, -place[1]!];
  const row = (at: number) => camera[at]! * x + camera[at + 4]! * y + camera[at + 8]! * z + camera[at + 12]!;
  const w = row(3);
  return [((row(0) / w + 1) / 2) * camera[16]!, ((1 - row(1) / w) / 2) * camera[17]!];
}

/** In a screenshot at the display's pixels: around each place (CSS px),
 *  the center of what's lit within `reach`, its lit pixels, and the
 *  place's own color. */
async function lit(page: Page, png: Buffer, places: [number, number][], reach = 14): Promise<{ x: number; y: number; pixels: number; color: [number, number, number] }[]> {
  return page.evaluate(
    async ({ data, places, reach }) => {
      const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${data}`)).blob());
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext('2d', { willReadFrequently: true })!;
      context.drawImage(bitmap, 0, 0);
      const scale = bitmap.width / innerWidth;
      return places.map(([x, y]) => {
        const [left, top, size] = [Math.round((x - reach) * scale), Math.round((y - reach) * scale), Math.round(2 * reach * scale)];
        const { data: pixels } = context.getImageData(left, top, size, size);
        let [sum, sumX, sumY, count] = [0, 0, 0, 0];
        for (let at = 0; at < pixels.length; at += 4) {
          // Past the page's own color (5, 6, 10).
          const light = pixels[at]! + pixels[at + 1]! + pixels[at + 2]! - 21;
          if (light < 60) continue;
          const pixel = at / 4;
          sum += light;
          // A pixel's center.
          sumX += light * ((pixel % size) + 0.5);
          sumY += light * (Math.floor(pixel / size) + 0.5);
          count++;
        }
        const center = context.getImageData(Math.floor(x * scale), Math.floor(y * scale), 1, 1).data;
        return { x: sum ? (left + sumX / sum) / scale : NaN, y: sum ? (top + sumY / sum) / scale : NaN, pixels: count, color: [center[0]!, center[1]!, center[2]!] as [number, number, number] };
      });
    },
    { data: png.toString('base64'), places, reach },
  );
}

/** The elements file as built, read by the data's own reader. */
let elementsRead: ElementsFile | undefined;
const elementsFile = (): ElementsFile => (elementsRead ??= readElements(readFileSync(join(dir, '../data/elements.bin'))));
/** The rows of the elements file with an ellipse and without, counted
 *  here from the file's own bytes (its a and e), among its first `through`
 *  rows: every row, or as many as the scene has drawn. */
function countRows(through?: number): { drawn: number; unbound: number } {
  const { a, e } = elementsFile().columns;
  const rows = through ?? elementsFile().rows;
  let drawn = 0;
  for (let row = 0; row < rows; row++) {
    if (e[row]! < 1 && a[row]! > 0) drawn++;
  }
  return { drawn, unbound: rows - drawn };
}

async function seeBelt(url: string) {
  // The opening view on the epoch, and what the page counts.
  const held = { date: EPOCH, paused: '' };
  const counts = await withBelt(url, held, async (page) => {
    // The date and the counts are GPUI's: a frame of its own after the belt's.
    await page.waitForTimeout(400);
    await shot(page, 'belt');
    await shot(page, 'counts', { x: 0, y: 0, width: 720, height: 150 });
    return kirkwood(page, (kirkwood) => ({ ...kirkwood.belt(), rows: kirkwood.scene!.stats.rows, points: kirkwood.scene!.stats.points, shared: kirkwood.viewsShareMemory, renderer: kirkwood.scene!.stats.renderer }));
  });
  const file = countRows();
  need(counts.drawn === file.drawn && counts.unbound === file.unbound, `the page counts ${counts.drawn} rows drawn and ${counts.unbound} not; the elements file has ${file.drawn} and ${file.unbound}`);
  need(counts.rows === manifest['elements.bin'].rows && counts.points === counts.rows, `the scene was given ${counts.rows} rows and draws ${counts.points} points; the manifest has ${manifest['elements.bin'].rows}`);
  need(counts.shared === true, "the scene's attributes aren't views over the wasm's memory");

  // From straight above (ecliptic x to the right, y up, so the orbits run
  // counterclockwise), with the lines toward Jupiter, 60° either side of
  // it, and opposite: all of it, the Trojans' orbit sizes, the Hildas'.
  const top = { ...held, elev: '90', az: '0', roll: '0', dist: '15.5', marks: '' };
  for (const [name, params] of [['seen-belt', {}], ['seen-trojans', { band: '4.6,5.5', bandGain: '6' }], ['seen-hildas', { band: '3.7,4.2', bandGain: '12' }]] as const) {
    await withBelt(url, { ...top, ...params }, (page) => shot(page, name, { x: 270, y: 0, width: 900, height: 900 }));
  }

  // Three rows drawn alone, against the crate's own place for each. A
  // numbered asteroid's row is its number less one.
  const ALONE = [
    { name: '1 Ceres', row: 0 },
    { name: '4 Vesta', row: 3 },
    { name: '624 Hektor', row: 623 },
  ];
  const alone = [];
  for (const date of [EPOCH, '2036-06-09']) {
    alone.push(
      ...(await withBelt(url, { date, paused: '', only: ALONE.map((body) => body.row).join(',') }, async (page) => {
        const png = await page.screenshot({ path: join(out, `alone-${date}.png`) });
        const { years, camera, places, control, points } = await kirkwood(page, (kirkwood) => {
          const years = kirkwood.clock().years;
          const rows = new URLSearchParams(location.search).get('only')!.split(',').map(Number);
          return { years, camera: kirkwood.scene!.viewProjection(), places: rows.map((row) => kirkwood.placeOf(row, years)), control: rows.map((row) => kirkwood.placeOf(row, years + 0.05)), points: kirkwood.scene!.stats.points };
        });
        need(points === ALONE.length, `${points} points drawn, not the ${ALONE.length} asked for alone`);
        const expected = places.map((place) => project(camera, place));
        const found = await lit(page, png, expected);
        return ALONE.map((body, at) => {
          const [x, y] = expected[at]!;
          const off = Math.hypot(found[at]!.x - x, found[at]!.y - y);
          const [controlX, controlY] = project(camera, control[at]!);
          const controlOff = Math.hypot(found[at]!.x - controlX, found[at]!.y - controlY);
          need(found[at]!.pixels > 20, `${body.name} on ${date}: no disc near (${round(x)}, ${round(y)})`);
          need(off <= 1, `${body.name} on ${date}: drawn ${off.toFixed(2)} px from the crate's place (${round(x)}, ${round(y)})`);
          need(controlOff > 1, `${body.name} on ${date}: the control passes (${controlOff.toFixed(2)} px from its place a twentieth of a year on)`);
          return { body: body.name, date, years: Number(years.toFixed(4)), cratePlacePx: [round(x), round(y)], drawnPx: [Number(found[at]!.x.toFixed(2)), Number(found[at]!.y.toFixed(2))], offPx: Number(off.toFixed(2)), controlOffPx: round(controlOff) };
        });
      })),
    );
  }
  return { counts, alone };
}

async function seeTime(url: string) {
  // From the epoch, running.
  const running = await withBelt(url, { date: EPOCH }, async (page) => {
    const read = () => kirkwood(page, (kirkwood) => ({ now: performance.now(), frames: kirkwood.scene!.stats.frames, ...kirkwood.clock() }));
    const from = await read();
    need(!from.held && from.running, `with the belt drawn the clock is ${JSON.stringify(from)}`);
    await page.waitForTimeout(2000);
    const to = await read();
    const rate = (to.years - from.years) / ((to.now - from.now) / 1000);
    need(near(rate, 1, 0.05), `the clock ran ${rate.toFixed(3)} years a second`);
    need(to.frames > from.frames + 30 && to.date !== from.date, `in 2 s the scene drew ${to.frames - from.frames} frames and the date went from ${from.date} to ${to.date}`);
    // Paused: the clock holds, and the scene draws nothing.
    await clickTarget(page, 'time');
    await page.waitForTimeout(300);
    const paused = await read();
    await page.waitForTimeout(700);
    const still = await read();
    need(!paused.running && still.years === paused.years && still.frames === paused.frames, `paused, the clock went from ${paused.years} to ${still.years} and the scene drew ${still.frames - paused.frames} frames`);
    await shot(page, 'time-paused', { x: 0, y: 820, width: 520, height: 80 });
    await clickTarget(page, 'time');
    await page.waitForTimeout(500);
    const again = await read();
    need(again.running && again.years > still.years && again.frames > still.frames, `run again, the clock is ${JSON.stringify(again)}`);
    return { yearsASecond: Number(rate.toFixed(3)), framesIn2s: to.frames - from.frames, pausedAt: paused.date };
  });
  // A year short of the last day: it stops there, and starts over from
  // the day it opened on.
  const end = await withBelt(url, { date: '2075-06-09' }, async (page) => {
    await page.waitForFunction(() => (globalThis as unknown as Page_).__kirkwood.clock().ended, undefined, { timeout: 10_000 });
    // The date's own redraw, at its own rate.
    await page.waitForTimeout(600);
    const ended = await kirkwood(page, (kirkwood) => ({ ...kirkwood.clock(), drawn: kirkwood.scene!.stats.years }));
    need(ended.years === ended.last && !ended.running && ended.date === '2076 Jun 09' && ended.drawn === ended.last, `at its last day the clock is ${JSON.stringify(ended)}`);
    await shot(page, 'time-end', { x: 0, y: 820, width: 520, height: 80 });
    await clickTarget(page, 'time');
    await page.waitForTimeout(300);
    const over = await kirkwood(page, (kirkwood) => kirkwood.clock());
    need(over.running && !over.ended && over.years >= over.last - 1.01 && over.years < over.last - 0.3, `run again from its last day, the clock is ${JSON.stringify(over)}`);
    return { stoppedAt: ended.date, startedOverAt: over.date };
  });
  // A date past its reach opens on the reach's end.
  const reach = [];
  for (const [date, opens] of [['1900-01-01', '1976 Jun 09'], ['2200-01-01', '2076 Jun 09']] as const) {
    const clock = await withBelt(url, { date, paused: '' }, (page) => kirkwood(page, (kirkwood) => kirkwood.clock()));
    need(clock.date === opens, `?date=${date} opened on ${clock.date}, not ${opens}`);
    reach.push({ asked: date, opened: clock.date });
  }
  return { running, end, reach };
}

async function seeBodies(url: string) {
  /** Each name against its body's place, in one reading of the page. */
  const read = (page: Page) =>
    kirkwood(page, (kirkwood) => {
      const scene = kirkwood.scene!;
      return { labels: scene.labels(), camera: scene.viewProjection(), jupiter: kirkwood.jupiter(scene.stats.years), years: scene.stats.years };
    });
  const check = ({ labels, camera, jupiter }: Awaited<ReturnType<typeof read>>) => {
    const [sunAt, jupiterAt] = [project(camera, [0, 0, 0]), project(camera, jupiter)];
    const [sun, named] = [labels.find((label) => label.text === 'Sol')!, labels.find((label) => label.text === 'Jupiter')!];
    need(sun.shown && named.shown && sun.width > 8 && named.width > 20, `the names: ${JSON.stringify(labels)}`);
    // Board 1: the Sun's name centered under it, 36 px down, clear of its
    // glow's middle; Jupiter's beside its disc (8 px), level with it.
    need(near(sun.left + sun.width / 2, sunAt[0], 1.5) && near(sun.top, sunAt[1] + 36, 1), `"Sol" at ${sun.left}, ${sun.top}; the Sun at ${sunAt.map(round)}`);
    need(near(named.left, jupiterAt[0] + 12, 1) && near(named.top + named.height / 2, jupiterAt[1], 1), `"Jupiter" at ${named.left}, ${named.top}; Jupiter at ${jupiterAt.map(round)}`);
    return { sunAt, jupiterAt, sun, named };
  };
  const atRest = await withBelt(url, { date: EPOCH, paused: '' }, async (page) => {
    await page.waitForTimeout(400);
    const { sunAt, jupiterAt, sun, named } = check(await read(page));
    await shot(page, 'bodies');
    const [sunDisc, jupiterDisc] = await lit(page, await page.screenshot(), [sunAt, jupiterAt], 8);
    // The Sun's disc is pale and Jupiter's tan: neither is the dust's.
    need(Math.min(...sunDisc!.color) > 180, `the Sun's place is ${sunDisc!.color}`);
    need(jupiterDisc!.color[0] > 170 && jupiterDisc!.color[0] > jupiterDisc!.color[2] + 40, `Jupiter's place is ${jupiterDisc!.color}`);
    return { sunPx: sunAt.map(round), sunName: [sun.left, sun.top], jupiterPx: jupiterAt.map(round), jupiterName: [named.left, named.top], sunColor: sunDisc!.color, jupiterColor: jupiterDisc!.color };
  });
  // Time running: the name goes with the disc, frame for frame.
  const moving = await withBelt(url, { date: EPOCH }, async (page) => {
    const first = await read(page);
    check(first);
    await page.waitForTimeout(1500);
    const later = await read(page);
    const { jupiterAt } = check(later);
    const moved = Math.hypot(jupiterAt[0] - project(first.camera, first.jupiter)[0], jupiterAt[1] - project(first.camera, first.jupiter)[1]);
    need(moved > 20, `in ${(later.years - first.years).toFixed(2)} years Jupiter moved ${moved.toFixed(1)} px`);
    return { years: Number((later.years - first.years).toFixed(2)), jupiterMovedPx: round(moved) };
  });
  return { atRest, moving };
}

// --- The look, color, and the sky.

/** The opening camera, spelled out (the scene's own default). */
const OPENING = { az: '200', elev: '24', roll: '-34', dist: '13' };
/** The belt on the epoch, time held. */
const HELD = { date: EPOCH, paused: '' };
/** The display's values (0 to 255) of a color in linear light. */
const displayed = (linear: number[]) => linear.map((v) => Math.round(255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055)));

/** A page with the belt and the sky drawn. */
const withSky = <T>(url: string, params: Record<string, string>, see: (page: Page) => Promise<T>): Promise<T> =>
  withBelt(url, params, async (page) => {
    await waitMark(page, SKY, 0, 120_000);
    await settle(page);
    // GPUI's own frame (the date, the lines) after the scene's.
    await page.waitForTimeout(400);
    return see(page);
  });

/** In a screenshot at the display's pixels: what `measure` makes of the
 *  pixels (r, g, b, a bytes, row by row) of a part of it, in CSS px. */
async function pixelsOf<T>(page: Page, png: Buffer, clip: Clip, measure: (pixels: Uint8ClampedArray, width: number, height: number, scale: number) => T): Promise<T> {
  return page.evaluate(
    async ({ data, clip, measure }) => {
      const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${data}`)).blob());
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext('2d', { willReadFrequently: true })!;
      context.drawImage(bitmap, 0, 0);
      const scale = bitmap.width / innerWidth;
      const [width, height] = [Math.round(clip.width * scale), Math.round(clip.height * scale)];
      const { data: pixels } = context.getImageData(Math.round(clip.x * scale), Math.round(clip.y * scale), width, height);
      return (new Function(`return (${measure})`)() as (pixels: Uint8ClampedArray, width: number, height: number, scale: number) => T)(pixels, width, height, scale);
    },
    { data: png.toString('base64'), clip, measure: measure.toString() },
  ) as Promise<T>;
}

async function seeLook(url: string) {
  const take = async (page: Page, name: string) => {
    writeFileSync(join(out, `look-${name}.jpg`), await page.screenshot({ type: 'jpeg', quality: 88, scale: 'css' }));
    // Its middle at the display's own pixels: what a dot and the grain are up close.
    await page.screenshot({ path: join(out, `look-${name}-detail.png`), clip: { x: 500, y: 330, width: 440, height: 275 }, scale: 'device' });
    return kirkwood(page, (kirkwood) => ({ rows: kirkwood.scene!.stats.rows, stars: kirkwood.scene!.stats.stars, renderer: kirkwood.scene!.stats.renderer }));
  };
  // The three cameras the look was tried from (docs/spike/): the opening shot, top-down, and flown in to
  // a group drawn around (560, 560) in the opening shot. There's no shape
  // to draw yet: the camera is put about where that fly-in ended, looking
  // at the ecliptic under that point from 5.2 au, the panel open as the
  // fly-in left it.
  const opening = await withSky(url, { ...HELD, ...OPENING }, async (page) => ({ ...(await take(page, 'opening')), under: await kirkwood(page, (kirkwood) => kirkwood.scene!.under(560, 560)) }));
  need(!!opening.under, 'nothing of the ecliptic under (560, 560) in the opening shot');
  need(opening.stars === manifest['stars.bin'].stars, `the scene draws ${opening.stars} stars; the manifest has ${manifest['stars.bin'].stars}`);
  const top = await withSky(url, { ...HELD, az: '200', elev: '90', roll: '0', dist: '15.5' }, (page) => take(page, 'top'));
  const at = opening.under!.map((au) => au.toFixed(3)).join(',');
  const group = await withSky(url, { ...HELD, ...OPENING, at, dist: '5.2' }, async (page) => {
    await clickTarget(page, 'table-handle');
    await waitMark(page, TABLE);
    await page.waitForTimeout(600);
    return take(page, 'group');
  });

  // Every row is drawn, the ones with no H among them: one of those alone,
  // drawn as the belt's dots are (its size and opacity turned up to be found).
  const dark = fixture.rows.find((row) => row.rule === 'no H')!;
  const noH = await withBelt(url, { ...HELD, only: String(dark.row), hard: '0', size: '9', alpha: '1' }, async (page) => {
    const png = await page.screenshot({ path: join(out, 'alone-no-h.png') });
    const { camera, place } = await kirkwood(page, (kirkwood) => {
      const row = Number(new URLSearchParams(location.search).get('only'));
      return { camera: kirkwood.scene!.viewProjection(), place: kirkwood.placeOf(row, kirkwood.clock().years) };
    });
    const [x, y] = project(camera, place);
    need(x > 20 && x < 1420 && y > 20 && y < 880, `${dark.cells.full_name} is outside the opening view, at (${round(x)}, ${round(y)})`);
    const [found] = await lit(page, png, [[x, y]], 8);
    need(found!.pixels > 20, `${dark.cells.full_name} has no H, and no dot at (${round(x)}, ${round(y)}): ${found!.pixels} lit pixels`);
    return { row: dark.cells.full_name, atPx: [round(x), round(y)], litPixels: found!.pixels, color: found!.color };
  });
  return { opening, top, group: { ...group, lookingAtAu: opening.under }, noH };
}

async function seeColor(url: string) {
  // The legend, drawn from the table the scene is given.
  const legend = await withBelt(url, HELD, async (page) => {
    await page.waitForTimeout(400);
    await shot(page, 'legend', { x: 0, y: 0, width: 720, height: 150 });
    const png = await page.screenshot();
    const { bar, ramp } = await page.evaluate(() => ({ bar: (globalThis as unknown as { __seizaTargets: Record<string, number[] | undefined> }).__seizaTargets.legend, ramp: (globalThis as unknown as Page_).__kirkwood.ramp() }));
    need(!!bar && bar[2]! > 100 && bar[3]! >= 6, `the legend's bar: ${JSON.stringify(bar)}`);
    const stops = Array.from({ length: ramp.length / 4 }, (_, stop) => ({ au: ramp[stop * 4]!, tint: displayed(ramp.slice(stop * 4 + 1, stop * 4 + 4)) }));
    const [from, to] = [stops[0]!.au, stops[stops.length - 1]!.au];
    // Each stop's place along the bar, a pixel in from its ends.
    const places = stops.map(({ au }): [number, number] => [Math.min(bar![0]! + bar![2]! - 1, Math.max(bar![0]! + 1, bar![0]! + ((au - from) / (to - from)) * bar![2]!)), bar![1]! + bar![3]! / 2]);
    const drawn = await lit(page, png, places, 1);
    return stops.map((stop, at) => {
      const color = drawn[at]!.color;
      need(color.every((channel, k) => Math.abs(channel - stop.tint[k]!) <= 8), `the legend at ${stop.au} au is ${color}; the scene's tint there is ${stop.tint}`);
      // The control: another stop's tint isn't this one's.
      const other = stops[(at + 2) % stops.length]!.tint;
      need(color.some((channel, k) => Math.abs(channel - other[k]!) > 8), `the legend at ${stop.au} au (${color}) passes for another stop's tint`);
      return { au: stop.au, tint: stop.tint, legend: color };
    });
  });

  // The belt's own dots, from straight above, with nothing but dust drawn:
  // the mean color of a ring of orbit sizes, less the page's own.
  const belt = await withBelt(url, { ...HELD, elev: '90', az: '0', roll: '0', dist: '15.5', sky: '0', haze: '0', bloom: '0', scrim: '0' }, async (page) => {
    const png = await page.screenshot({ path: join(out, 'color-top.png') });
    const camera = await kirkwood(page, (kirkwood) => kirkwood.scene!.viewProjection());
    const [sun, oneAu] = [project(camera, [0, 0, 0]), project(camera, [1, 0, 0])];
    const pxAu = Math.hypot(oneAu[0] - sun[0], oneAu[1] - sun[1]);
    /** The sum of the colors in the disc `au` out from the Sun, and its pixels. */
    const disc = (au: number) =>
      pixelsOf(page, png, { x: sun[0] - au * pxAu, y: sun[1] - au * pxAu, width: 2 * au * pxAu, height: 2 * au * pxAu }, (pixels, width, height) => {
        const sum = [0, 0, 0, 0];
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            if (Math.hypot(x + 0.5 - width / 2, y + 0.5 - height / 2) > width / 2) continue;
            const at = (y * width + x) * 4;
            sum[0]! += pixels[at]!;
            sum[1]! += pixels[at + 1]!;
            sum[2]! += pixels[at + 2]!;
            sum[3]! += 1;
          }
        }
        return sum;
      });
    /** A ring's mean color: the disc out to `to` less the disc out to
     *  `from`, less the page's own color (5, 6, 10). */
    const ring = async (from: number, to: number) => {
      const [outer, inner] = [await disc(to), await disc(from)];
      return [0, 1, 2].map((k) => Number(((outer[k]! - inner[k]!) / (outer[3]! - inner[3]!) - [5, 6, 10][k]!).toFixed(1)));
    };
    const [warm, blue] = [await ring(2.2, 2.4), await ring(3.1, 3.3)];
    need(warm[0]! > warm[2]! * 1.1, `the dust 2.2 to 2.4 au out is ${warm} over the page's color: not more red than blue`);
    need(blue[2]! > blue[0]! * 1.1, `the dust 3.1 to 3.3 au out is ${blue} over the page's color: not more blue than red`);
    return { pxAu: round(pxAu), ring2_2to2_4: warm, ring3_1to3_3: blue };
  });
  return { legend, belt };
}

async function seeSky(url: string) {
  /** The text's color over the scene: gpui-kit's dark `muted_foreground`,
   *  oklch(0.708 0 0), as the display's gray. */
  const TEXT = 161;
  const read = async (params: Record<string, string>, name?: string) => {
    const { page, problems, close } = await open(chromium, url, { params });
    try {
      const marks = { belt: await waitMark(page, BELT, 0, 120_000), rows: await waitMark(page, ROWS, 0, 120_000), sky: await waitMark(page, SKY, 0, 120_000) };
      await settle(page);
      await page.waitForTimeout(500);
      const seen = await page.evaluate(() => {
        const kirkwood = (globalThis as unknown as Page_).__kirkwood;
        return {
          stars: kirkwood.scene!.stats.stars,
          scrim: kirkwood.scrim(),
          data: (performance.getEntriesByType('resource') as PerformanceResourceTiming[]).filter((entry) => new URL(entry.name).pathname.startsWith('/data/')).map((entry) => ({ path: new URL(entry.name).pathname, start: entry.startTime, end: entry.responseEnd })),
        };
      });
      if (name) {
        await shot(page, name);
        await shot(page, `${name}-text`, { x: 0, y: 0, width: 720, height: 150 });
      }
      // The scene alone under the text: GPUI's canvas out of the picture.
      await page.addStyleTag({ content: 'body > canvas:not(#scene) { visibility: hidden }' });
      const [left, top, width, height] = seen.scrim as [number, number, number, number];
      need(width > 100 && height > 40, `where the text lies: ${seen.scrim}`);
      const png = await page.screenshot();
      // Each pixel's contrast with the text's gray (WCAG's ratio).
      const under = await pixelsOf(page, png, { x: left, y: top, width, height }, (pixels) => {
        const linear = (byte: number) => (byte / 255 <= 0.04045 ? byte / 255 / 12.92 : ((byte / 255 + 0.055) / 1.055) ** 2.4);
        const text = linear(161);
        let [below45, below3, brightest, sum] = [0, 0, 0, 0];
        const count = pixels.length / 4;
        for (let at = 0; at < pixels.length; at += 4) {
          const light = 0.2126 * linear(pixels[at]!) + 0.7152 * linear(pixels[at + 1]!) + 0.0722 * linear(pixels[at + 2]!);
          const contrast = (text + 0.05) / (light + 0.05);
          if (contrast < 4.5) below45++;
          if (contrast < 3) below3++;
          brightest = Math.max(brightest, light);
          sum += light;
        }
        return { shareUnder4_5: below45 / count, shareUnder3: below3 / count, leastContrast: (text + 0.05) / (brightest + 0.05), meanContrast: (text + 0.05) / (sum / count + 0.05) };
      });
      if (problems.length) throw new Error(`the page's problems: ${problems.join(' | ')}`);
      return { marks, ...seen, under };
    } finally {
      await close();
    }
  };
  const quiet = await read(HELD, 'sky');
  const loud = await read({ ...HELD, scrim: '0' });
  const [rows, stars] = [quiet.data.find((request) => request.path === '/data/rows.bin'), quiet.data.find((request) => request.path === '/data/stars.bin')];
  need(!!rows && !!stars, `the data asked for: ${quiet.data.map((request) => request.path).join(', ')}`);
  need(stars!.start >= rows!.end && stars!.start >= quiet.marks.belt, `the sky's file was asked for at ${round(stars!.start)} ms; the rows file was held at ${round(rows!.end)} and the belt drawn at ${round(quiet.marks.belt)}`);
  need(quiet.stars === manifest['stars.bin'].stars, `the scene draws ${quiet.stars} stars; the manifest has ${manifest['stars.bin'].stars}`);
  const share = (value: number) => Number((100 * value).toFixed(2));
  const contrast = (under: typeof quiet.under) => ({ percentUnder4_5: share(under.shareUnder4_5), percentUnder3: share(under.shareUnder3), least: Number(under.leastContrast.toFixed(2)), mean: Number(under.meanContrast.toFixed(2)) });
  // The text reads over the sky: the scene under it holds the text's
  // contrast, and without the quiet (the control) it holds it less.
  need(quiet.under.shareUnder4_5 < 0.01, `${share(quiet.under.shareUnder4_5)}% of the scene under the text leaves it under 4.5 to 1`);
  need(loud.under.shareUnder4_5 > quiet.under.shareUnder4_5 && loud.under.meanContrast < quiet.under.meanContrast, `without the quiet the text has ${JSON.stringify(contrast(loud.under))}, with it ${JSON.stringify(contrast(quiet.under))}`);
  return {
    stars: quiet.stars,
    textGray: TEXT,
    askedForMs: round(stars!.start),
    heldMs: round(stars!.end),
    rowsHeldMs: round(rows!.end),
    beltDrawnMs: round(quiet.marks.belt),
    skyDrawnMs: round(quiet.marks.sky),
    textLiesAt: quiet.scrim.map(round),
    contrastUnderText: contrast(quiet.under),
    contrastUnderTextWithNoQuiet: contrast(loud.under),
  };
}

/** `--browser`'s engine: the first frame, the belt and its counts, and the
 *  panel's first row (out/cross-<browser>-*.jpg). With `wheel`, a wheel
 *  over each canvas. At DPR 1 off Chromium, and never throttled. */
async function seeCross(url: string) {
  const { page, problems, close } = await open(ENGINE, url, { init: [firstDrawProbe], params: { 'probe-cells': '', date: EPOCH, paused: '' } });
  try {
    const marks = {
      firstFrame: await waitMark(page, FIRST_FRAME),
      scene: await waitMark(page, SCENE),
      belt: await waitMark(page, BELT, 0, 120_000),
      rows: await waitMark(page, ROWS, 0, 120_000),
      sky: await waitMark(page, SKY, 0, 120_000),
    };
    await settle(page);
    await page.waitForTimeout(500);
    await shot(page, `cross-${BROWSER}-belt`);
    const seen = await page.evaluate(() => {
      const kirkwood = (globalThis as unknown as Page_).__kirkwood;
      const stats = kirkwood.scene!.stats;
      return { ...kirkwood.belt(), gpui: (globalThis as { __seizaProbe?: FirstDrawProbe }).__seizaProbe?.api ?? '', scene: stats.renderer, rows: stats.rows, points: stats.points, stars: stats.stars, shared: kirkwood.viewsShareMemory };
    });
    const file = countRows();
    need(seen.rows === manifest['elements.bin'].rows && seen.points === seen.rows && seen.stars === manifest['stars.bin'].stars, `the scene draws ${seen.points} points of ${seen.rows} rows and ${seen.stars} stars`);
    need(seen.drawn === file.drawn && seen.unbound === file.unbound, `the page counts ${seen.drawn} rows drawn and ${seen.unbound} not; the elements file has ${file.drawn} and ${file.unbound}`);
    need(seen.shared === true, "the scene's attributes aren't views over the wasm's memory");
    await clickTarget(page, 'table-handle');
    await waitMark(page, TABLE);
    const firstRow = await drawnRow(page, 0);
    await page.waitForTimeout(600);
    await shot(page, `cross-${BROWSER}-panel`);
    const ceres = fixture.rows.find((row) => row.row === 0)!.cells.full_name;
    need(firstRow[1] === ceres, `the first row is ${firstRow[1]}, not ${ceres}`);
    if (problems.length) throw new Error(`the page's problems: ${problems.join(' | ')}`);
    return { browser: BROWSER, version: page.context().browser()!.version(), marksMs: Object.fromEntries(Object.entries(marks).map(([name, at]) => [name, round(at)])), ...seen, firstRow: firstRow[1] };
  } finally {
    await close();
  }
}

/** A load on Fast 4G with the CPU slowed 4×, the files compressed as a
 *  deploy would send them: what the page shows from its first frame to the
 *  first dots, the whole belt, the table, and the sky, and when. While the
 *  belt fills, the page's count is checked against the file's own bytes
 *  for the rows the scene has drawn, and time is checked to wait. */
async function seeSlow(url: string) {
  const FILES = ['elements.bin', 'rows.bin', 'stars.bin'] as const;
  process.env.KIRKWOOD_DATA = 'br';
  try {
    // Compressed before the load is timed (once: a minute or two a file).
    const wire: Record<string, number> = {};
    for (const name of FILES) {
      const response = await fetch(`${url}data/${name}`, { method: 'HEAD', headers: { 'Accept-Encoding': 'br' } });
      need(response.headers.get('content-encoding') === 'br', `${name} wasn't served compressed`);
      wire[name] = Number(response.headers.get('content-length'));
    }
    const { page, problems, close } = await open(chromium, url, { profile: PROFILES.find((profile) => profile.name === 'throttled')! });
    try {
      const firstFrame = await waitMark(page, FIRST_FRAME);
      const MARKS = { scene: SCENE, dots: DOTS, elements: ELEMENTS, belt: BELT, rows: ROWS, sky: SKY };
      const SHOTS = [2, 10, 25];
      const seen: Record<string, number> = {};
      const shots: string[] = [];
      const timeline: { atMs: number; heldMB: number; rowsDrawn: number }[] = [];
      /** The page's count while the belt fills, read against the file's. */
      const filling: { atMs: number; rowsDrawn: number; dots: number; clockHeld: boolean }[] = [];
      for (let last = -Infinity; !('sky' in seen); ) {
        const state = await page.evaluate((marks) => {
          const at = (name: string) => performance.getEntriesByName(name, 'mark').at(-1)?.startTime ?? null;
          const kirkwood = (globalThis as unknown as Page_).__kirkwood;
          return { now: performance.now(), held: kirkwood.held, belt: kirkwood.belt(), given: kirkwood.scene?.stats.rows ?? 0, points: kirkwood.scene?.stats.points ?? 0, clock: kirkwood.clock(), marks: Object.fromEntries(Object.entries(marks).map(([key, name]) => [key, at(name)])) };
        }, MARKS);
        need(state.now < 180_000, `three minutes in, the page has ${JSON.stringify(state)}`);
        // Some of the belt is drawn and more is arriving: the count is
        // counted from the rows drawn, the scene draws those rows and no
        // more, and time waits for the rest.
        if (state.belt.rows > 0 && state.belt.rows < state.belt.of) {
          const file = countRows(state.belt.rows);
          need(state.belt.drawn === file.drawn && state.belt.unbound === file.unbound, `with ${state.belt.rows} rows drawn the page counts ${state.belt.drawn} dots and ${state.belt.unbound} rows without; the file's first ${state.belt.rows} rows have ${file.drawn} and ${file.unbound}`);
          need(state.given === state.belt.rows && state.points === state.given, `the page counts ${state.belt.rows} rows drawn; the scene was given ${state.given} and draws ${state.points}`);
          need(state.clock.held, `time moved while the belt filled: ${JSON.stringify(state.clock)}`);
          if (!filling.length || state.now - filling.at(-1)!.atMs >= 5000) filling.push({ atMs: round(state.now), rowsDrawn: state.belt.rows, dots: state.belt.drawn, clockHeld: state.clock.held });
        }
        if (state.now - last >= 5000) {
          timeline.push({ atMs: round(state.now), heldMB: mb(state.held), rowsDrawn: state.belt.rows });
          last = state.now;
        }
        const due = SHOTS.find((seconds) => state.now >= firstFrame + seconds * 1000 && !shots.includes(`slow-${seconds}s`));
        if (due !== undefined) {
          shots.push(`slow-${due}s`);
          await shot(page, `slow-${due}s`);
        }
        for (const [key, at] of Object.entries(state.marks)) {
          if (at === null || key in seen) continue;
          seen[key] = at;
          // The elements held is the belt drawn, a moment before.
          if (key === 'scene' || key === 'elements') continue;
          // GPUI's own frame after the mark (the handle, the counts, the line about the stars).
          await page.waitForTimeout(600);
          await shot(page, `slow-${key}`);
        }
        await page.waitForTimeout(100);
      }
      const data = await page.evaluate(() =>
        (performance.getEntriesByType('resource') as PerformanceResourceTiming[]).filter((entry) => new URL(entry.name).pathname.startsWith('/data/')).map((entry) => ({ path: new URL(entry.name).pathname, start: entry.startTime, end: entry.responseEnd, wire: entry.encodedBodySize })),
      );
      if (problems.length) throw new Error(`the page's problems: ${problems.join(' | ')}`);
      need(filling.length > 0, 'the belt was never seen part drawn: it filled between two readings, or all at once');
      need(seen.dots! < seen.belt!, `the first dots at ${round(seen.dots!)} ms weren't before the whole belt at ${round(seen.belt!)}`);
      return {
        profile: 'CPU 4x, Fast 4G; the files at brotli 11',
        wireMB: Object.fromEntries(Object.entries(wire).map(([name, bytes]) => [name, mb(bytes)])),
        firstFrameMs: round(firstFrame),
        sceneStartedMs: round(seen.scene!),
        firstDotsMs: round(seen.dots!),
        blockRows: elementsFile().blockRows,
        filling,
        elementsHeldMs: round(seen.elements!),
        beltDrawnMs: round(seen.belt!),
        rowsHeldMs: round(seen.rows!),
        skyDrawnMs: round(seen.sky!),
        requests: data.map((request) => ({ path: request.path, startMs: round(request.start), endMs: round(request.end), wireMB: mb(request.wire) })),
        timeline,
      };
    } finally {
      await close();
    }
  } finally {
    delete process.env.KIRKWOOD_DATA;
  }
}

/** The scene's frame rate while time runs, for each way of drawing it the
 *  resolution is chosen among: the frames the scene drew a second, the
 *  page's own frames (rAF) beside them, and the share of the scene's frames
 *  that came more than a frame and a half after the last. */
type Rate = { scene: number; page: number; late: number; p50: number; p95: number };
async function seeRate(url: string) {
  const SECONDS = 4;
  const WAYS: [string, Record<string, string>][] = flag('ways-only') ? RATE_MORE : [
    ["the display's resolution", {}],
    ["the display's, the bloom at half", { bloomScale: '0.5' }],
    ["the display's, no bloom", { bloom: '0' }],
    ['three quarters', { scale: '0.75' }],
    ['three quarters, the bloom at half', { scale: '0.75', bloomScale: '0.5' }],
    ['three quarters, no bloom', { scale: '0.75', bloom: '0' }],
    ['half', { scale: '0.5' }],
    ...RATE_MORE,
  ];
  const ways = [];
  for (const [name, params] of WAYS) {
    const loads: Rate[] = [];
    for (let run = 0; run < RATE_RUNS; run++) {
      loads.push(
        await (params.sky === '0' ? withBelt<Rate> : withSky<Rate>)(url, { date: EPOCH, ...params }, async (page) => {
          if (RATE_PANEL) {
            await clickTarget(page, 'table-handle');
            await waitMark(page, TABLE);
            await page.waitForTimeout(600);
            if (run === 0) await shot(page, `rate-${name.replace(/\W+/g, '-')}`);
          }
          return page.evaluate(
            (ms) =>
              new Promise<Rate>((done) => {
                const stats = (globalThis as unknown as Page_).__kirkwood.scene!.stats;
                const from = performance.now();
                let [frames, last, lastAt] = [0, stats.frames, from];
                const gaps: number[] = [];
                const tick = (now: number) => {
                  frames++;
                  // A frame the scene drew since this was last asked.
                  if (stats.frames !== last) {
                    gaps.push(now - lastAt);
                    [last, lastAt] = [stats.frames, now];
                  }
                  if (now - from < ms) return void requestAnimationFrame(tick);
                  const seconds = (now - from) / 1000;
                  const sorted = gaps.slice(1).sort((a, b) => a - b);
                  done({ scene: (gaps.length - 1) / seconds, page: frames / seconds, late: sorted.filter((gap) => gap > 25).length / sorted.length, p50: sorted[Math.floor(sorted.length / 2)]!, p95: sorted[Math.floor(sorted.length * 0.95)]! });
                };
                requestAnimationFrame(tick);
              }),
            SECONDS * 1000,
          );
        }),
      );
    }
    const of = (pick: (load: (typeof loads)[number]) => number) => round(median(loads.map(pick)));
    ways.push({ way: name, params, sceneFramesASecond: of((load) => load.scene), pageFramesASecond: of((load) => load.page), percentLate: of((load) => 100 * load.late), frameMs: { p50: of((load) => load.p50), p95: of((load) => load.p95) } });
    console.error(JSON.stringify(ways[ways.length - 1]));
  }
  // At rest the scene draws nothing.
  const rest = await withSky(url, { date: EPOCH, paused: '' }, async (page) => {
    const from = await kirkwood(page, (kirkwood) => kirkwood.scene!.stats.frames);
    await page.waitForTimeout(1500);
    return (await kirkwood(page, (kirkwood) => kirkwood.scene!.stats.frames)) - from;
  });
  need(rest === 0, `at rest the scene drew ${rest} frames in 1.5 s`);
  return { seconds: SECONDS, runs: RATE_RUNS, panelOpen: RATE_PANEL, ways, framesAtRest: rest };
}

async function seeWheel(url: string) {
  const { page, problems, close } = await open(ENGINE, url, { params: { date: EPOCH, paused: '' } });
  try {
    await waitMark(page, BELT, 0, 120_000);
    await waitMark(page, ROWS, 0, 120_000);
    const read = () =>
      page.evaluate(() => {
        const page = globalThis as unknown as Page_;
        const scene = page.__kirkwood.scene!;
        return { distance: scene.stats.distance, first: page.__kirkwoodTable?.first ?? -1, sun: scene.labels().find((label) => label.text === 'Sol')! };
      });
    // Over the scene, the panel shut.
    const opening = await read();
    await page.mouse.move(500, 450);
    await wheel(page, 300);
    await page.waitForTimeout(300);
    const zoomed = await read();
    need(zoomed.distance !== opening.distance, `a wheel over the scene left its camera ${zoomed.distance} au out`);
    need(near(opening.sun.left + opening.sun.width / 2, 720, 1.5), `the panel shut, the Sun's name is centered at ${opening.sun.left + opening.sun.width / 2}`);
    // The panel open: the scene centers in what it leaves.
    await clickTarget(page, 'table-handle');
    await waitMark(page, TABLE);
    await page.waitForTimeout(600);
    const open_ = await read();
    need(near(open_.sun.left + open_.sun.width / 2, (1440 - PANEL) / 2, 1.5), `the panel open, the Sun's name is centered at ${open_.sun.left + open_.sun.width / 2}`);
    await shot(page, ENGINE === chromium ? 'panel' : `cross-${BROWSER}-wheel`);
    const layout = await page.evaluate(() => (globalThis as unknown as Page_).__kirkwoodLayout!);
    // Over the table: the rows scroll, the scene stays.
    await page.mouse.move(layout.left + 200, layout.top + layout.rowHeight * 3.5);
    await wheel(page, 900);
    await page.waitForTimeout(400);
    const scrolled = await read();
    need(scrolled.first > open_.first && scrolled.distance === open_.distance, `a wheel over the table: its first row went from ${open_.first} to ${scrolled.first}, the scene's camera from ${open_.distance} to ${scrolled.distance}`);
    // Over the scene beside it: the scene zooms, the rows stay.
    await page.mouse.move(300, 450);
    await wheel(page, -300);
    await page.waitForTimeout(300);
    const back = await read();
    need(back.distance !== scrolled.distance && back.first === scrolled.first, `a wheel over the scene, the panel open: its camera went from ${scrolled.distance} to ${back.distance}, the table's first row from ${scrolled.first} to ${back.first}`);
    if (problems.length) throw new Error(`the page's problems: ${problems.join(' | ')}`);
    return { cameraAu: [opening.distance, zoomed.distance, back.distance].map((au) => Number(au.toFixed(2))), tableFirstRow: [open_.first, scrolled.first], sunNameCenterPx: [opening.sun.left + opening.sun.width / 2, open_.sun.left + open_.sun.width / 2] };
  } finally {
    await close();
  }
}

mkdirSync(out, { recursive: true });
const server = await serveApp(undefined, { webDir: join(dir, '../web'), port: PORT });
try {
  const seen: Record<string, unknown> = { date: localDate(), ...machineInfo(), runs: RUNS, viewport: '1440x900 at DPR 2, headless Chromium, cold, unthrottled, the files local and as they are' };
  if (LOADS.some((part) => ONLY.has(part))) {
    if (ONLY.has('paint')) await slowShots(server.url);
    const loads: Awaited<ReturnType<typeof load>>[] = [];
    for (let run = 0; run < RUNS; run++) loads.push(await load(server.url, run === 0));
    const first = loads[0]!;
    const of = (pick: (run: Awaited<ReturnType<typeof load>>) => number) => {
      const values = loads.map(pick);
      return { median: round(median(values)), min: round(Math.min(...values)), max: round(Math.max(...values)) };
    };

    if (ONLY.has('paint')) {
      seen.paint = {
        api: first.api,
        firstFrameMs: of((run) => run.marks.firstFrame),
        sceneStartedMs: of((run) => run.marks.scene),
        firstDotsMs: of((run) => run.marks.dots),
        elementsHeldMs: of((run) => run.marks.elements),
        beltDrawnMs: of((run) => run.marks.belt),
        rowsHeldMs: of((run) => run.marks.rows),
        // One load's requests and marks, in order.
        order: [
          ...first.requests.map((request) => ({ at: request.startMs, what: `asked for ${request.path}`, until: request.endMs })),
          { at: round(first.marks.firstFrame), what: `mark ${FIRST_FRAME}` },
          { at: round(first.marks.scene), what: `mark ${SCENE}` },
          { at: round(first.marks.dots), what: `mark ${DOTS}` },
          { at: round(first.marks.elements), what: `mark ${ELEMENTS}` },
          { at: round(first.marks.belt), what: `mark ${BELT}` },
          { at: round(first.marks.rows), what: `mark ${ROWS}` },
        ].sort((a, b) => a.at - b.at),
      };
    }
    if (ONLY.has('table')) {
      const ceres = fixture.rows.find((row) => row.row === 0)!.cells.full_name;
      const last = fixture.rows.find((row) => row.row === TABLE_ROWS - 1)!.cells.full_name;
      for (const run of loads.flatMap(({ table }) => (table ? [{ table }] : []))) {
        if (run.table.rows !== TABLE_ROWS) throw new Error(`the table has ${run.table.rows} rows, and the manifest ${TABLE_ROWS}`);
        if (run.table.columns.length !== 18) throw new Error(`the table has ${run.table.columns.length} columns`);
        if (run.table.firstRow[1] !== ceres) throw new Error(`the first row is ${run.table.firstRow[1]}, not ${ceres}`);
        if (run.table.lastRow[1] !== last) throw new Error(`the last row is ${run.table.lastRow[1]}, not ${last}`);
      }
      seen.table = first.table;
    }
    if (ONLY.has('memory')) {
      const grew = loads.map((run) => run.memory.withFiles - run.memory.atFirstFrame);
      const worst = Math.max(...grew);
      if (worst > FILE_BYTES + 8e6) throw new Error(`holding the files grew the wasm's memory by ${mb(worst)} MB, and the files are ${mb(FILE_BYTES)} MB: a second copy of something`);
      if (loads.some((run) => run.memory.viewsShareMemory !== true)) throw new Error("the scene's attributes aren't views over the wasm's memory");
      seen.memory = {
        filesMB: mb(FILE_BYTES),
        wasmAtFirstFrameMB: mb(first.memory.atFirstFrame),
        wasmWithFilesAndTheBeltMB: mb(first.memory.withFiles),
        grewByMB: mb(grew[0]!),
        grewByWorstMB: mb(worst),
        ...(first.memory.withTable === null ? {} : { wasmWithTableOpenMB: mb(first.memory.withTable) }),
      };
    }
  }
  if (ONLY.has('belt')) seen.belt = await seeBelt(server.url);
  if (ONLY.has('time')) seen.time = await seeTime(server.url);
  if (ONLY.has('bodies')) seen.bodies = await seeBodies(server.url);
  if (ONLY.has('look')) seen.look = await seeLook(server.url);
  if (ONLY.has('color')) seen.color = await seeColor(server.url);
  if (ONLY.has('sky')) seen.sky = await seeSky(server.url);
  if (ONLY.has('wheel')) seen.wheel = await seeWheel(server.url);
  if (ONLY.has('rate')) seen.rate = await seeRate(server.url);
  if (ONLY.has('slow')) seen.slow = await seeSlow(server.url);
  if (ONLY.has('cross')) seen.cross = await seeCross(server.url);
  writeFileSync(join(out, ENGINE === chromium ? 'seen.json' : `seen-${BROWSER}.json`), `${JSON.stringify(seen, null, 2)}\n`);
  console.log(JSON.stringify(seen, null, 2));
} finally {
  await server.close();
}
