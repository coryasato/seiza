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
//   wheel   a wheel over the scene zooms it and leaves the table; over the
//           table it scrolls the rows and leaves the scene; and the scene
//           centers in what the open panel leaves (out/panel.jpg).
//
// Usage: node apps/kirkwood/checks/see.ts [--only paint,table,memory,belt,time,bodies,wheel] [--runs 5]
// --only picks what's run and checked, not only what's printed.
// Run `just kirkwood build` first. Writes out/seen.json.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Page } from '@playwright/test';
import { clickTarget, firstDrawProbe, open, waitMark, wheel, type FirstDrawProbe } from '../../../shared-web/perf/harness.ts';
import { PROFILES, localDate, machineInfo, median, option } from '../../../shared-web/perf/protocol.ts';
import { serveApp } from '../../../shared-web/perf/serve.ts';

const dir = import.meta.dirname;
const out = join(dir, 'out');
const PORT = 4370;
const RUNS = Number(option('runs') ?? 5);
/** The parts that are loads repeated `--runs` times. */
const LOADS = ['paint', 'table', 'memory'];
const PARTS = [...LOADS, 'belt', 'time', 'bodies', 'wheel'];
const ONLY = new Set((option('only') ?? PARTS.join(',')).split(','));
if (!Number.isInteger(RUNS) || RUNS < 1) throw new Error(`--runs wants a whole number of loads, 1 or more; got "${option('runs')}"`);
if (!ONLY.size || [...ONLY].some((part) => !PARTS.includes(part))) throw new Error(`--only wants some of ${PARTS.join(', ')}; got "${option('only')}"`);

const FIRST_FRAME = 'gpui:first-frame';
const ELEMENTS = 'kirkwood:elements';
const ROWS = 'kirkwood:rows';
const SCENE = 'kirkwood:scene';
const BELT = 'kirkwood:belt';
const TABLE = 'kirkwood:table';
/** What first paint may wait on, by path. */
const FIRST_PAINT = [/^\/$/, /^\/assets\/index-[\w-]+\.js$/, /^\/assets\/kirkwood_bg-[\w-]+\.wasm$/, /^\/assets\/IBMPlexSans-Regular-[\w-]+\.ttf$/];
/** The elements' epoch, where the files' places are JPL's own. */
const EPOCH = '2026-06-09';
/** The panel's width (`host.rs`), CSS px. */
const PANEL = 560;

type FileInfo = { rows: number; bytes: number };
const manifest = JSON.parse(readFileSync(join(dir, '../data/MANIFEST.json'), 'utf8')) as Record<'elements.bin' | 'rows.bin', FileInfo>;
const fixture = JSON.parse(readFileSync(join(dir, '../data/fixture.json'), 'utf8')) as { rows: { row: number; cells: { full_name: string } }[] };
const FILE_BYTES = manifest['elements.bin'].bytes + manifest['rows.bin'].bytes;
const TABLE_ROWS = manifest['rows.bin'].rows;

type Clock = { years: number; running: boolean; held: boolean; ended: boolean; first: number; last: number; date: string };
type Label = { text: string; left: number; top: number; width: number; height: number; shown: boolean };
type SceneStats = { frames: number; years: number; rows: number; points: number; renderer: string; distance: number };
type Kirkwood = {
  wasmBytes(): number;
  wasmBytesAtFirstFrame: number;
  scene?: { stats: SceneStats; viewProjection(): number[]; labels(): Label[] };
  viewsShareMemory?: boolean;
  placeOf(row: number, years: number): number[];
  jupiter(years: number): number[];
  clock(): Clock;
  belt(): { drawn: number; unbound: number };
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
  if (data.map((request) => request.path).join() !== '/data/elements.bin,/data/rows.bin') throw new Error(`the data asked for: ${data.map((request) => request.path).join(', ') || 'none'}`);
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

/** The rows of the elements file with an ellipse and without, counted
 *  here from the file's own bytes: a and e, the first two columns. */
function countRows(): { drawn: number; unbound: number } {
  const file = readFileSync(join(dir, '../data/elements.bin'));
  const rows = file.readUInt32LE(4);
  let drawn = 0;
  for (let row = 0; row < rows; row++) {
    const [a, e] = [file.readFloatLE(16 + row * 4), file.readFloatLE(16 + (rows + row) * 4)];
    if (e < 1 && a > 0) drawn++;
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
    await shot(page, 'counts', { x: 0, y: 0, width: 720, height: 96 });
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
    const [sun, named] = [labels.find((label) => label.text === 'Sun')!, labels.find((label) => label.text === 'Jupiter')!];
    need(sun.shown && named.shown && sun.width > 10 && named.width > 20, `the names: ${JSON.stringify(labels)}`);
    // Board 1: the Sun's name centered under its disc (14 px across),
    // Jupiter's beside its (8 px), level with it.
    need(near(sun.left + sun.width / 2, sunAt[0], 1.5) && near(sun.top, sunAt[1] + 13, 1), `"Sun" at ${sun.left}, ${sun.top}; the Sun at ${sunAt.map(round)}`);
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

async function seeWheel(url: string) {
  const { page, problems, close } = await open(chromium, url, { params: { date: EPOCH, paused: '' } });
  try {
    await waitMark(page, BELT, 0, 120_000);
    await waitMark(page, ROWS, 0, 120_000);
    const read = () =>
      page.evaluate(() => {
        const page = globalThis as unknown as Page_;
        const scene = page.__kirkwood.scene!;
        return { distance: scene.stats.distance, first: page.__kirkwoodTable?.first ?? -1, sun: scene.labels().find((label) => label.text === 'Sun')! };
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
    await shot(page, 'panel');
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
        elementsHeldMs: of((run) => run.marks.elements),
        beltDrawnMs: of((run) => run.marks.belt),
        rowsHeldMs: of((run) => run.marks.rows),
        // One load's requests and marks, in order.
        order: [
          ...first.requests.map((request) => ({ at: request.startMs, what: `asked for ${request.path}`, until: request.endMs })),
          { at: round(first.marks.firstFrame), what: `mark ${FIRST_FRAME}` },
          { at: round(first.marks.scene), what: `mark ${SCENE}` },
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
  if (ONLY.has('wheel')) seen.wheel = await seeWheel(server.url);
  writeFileSync(join(out, 'seen.json'), `${JSON.stringify(seen, null, 2)}\n`);
  console.log(JSON.stringify(seen, null, 2));
} finally {
  await server.close();
}
