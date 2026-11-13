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
//   sort    "Sort by orbit size": a press flies every dot to a against e
//           and a second flies them back (out/sort-space.jpg, sort-landed.jpg,
//           sort-back.jpg, and the flight held partway, sort-mid.jpg): how
//           long each way takes, the scene's frames a second on the way, and
//           the scene drawing nothing once landed. Fails unless the press
//           pauses time and the press back runs it again; unless the Sun,
//           Jupiter, their names, the sky, and the page's line about the
//           stars are gone landed and back after; unless Ceres, Vesta, and
//           Hektor, drawn alone and landed (out/sort-alone.png), are each
//           within a CSS pixel of the crate's place for their a and e, and
//           farther from that of an a 1.6 px off (the control), with the
//           panel shut and open (out/sort-alone-panel.png); unless each
//           piece of the axes' furniture is where board 4 has it, the axes
//           dim mid-flight with nothing said of the dots yet, and in what
//           the open panel leaves (out/sort-panel.jpg), a chip over its gap
//           and clear of the next; unless the action's fill is the boards'
//           in each state; unless a wheel over the landed dots changes
//           nothing; unless the count of rows in view
//           (out/sort-count.jpg) is the count from the file's own bytes;
//           and unless the dust at each gap (where Jupiter's a puts it) is
//           darker than a tenth of an au either side.
//   ride    "Ride with Jupiter": the ride held (out/ride.jpg, for board 2 to
//           be set beside): fails unless the camera is straight above with
//           Jupiter to the Sun's right, each of board 2's names and each
//           corner of its dashed triangle is where the crate's three points
//           project through the scene's camera (and farther from where
//           they'd be a year on, the control), the two groups lit are the
//           file's own 8,400 Hildas and 16,472 Trojans, and each Trojan
//           cloud and the Hildas' far corner is brighter than the same
//           orbit a third of a turn from Jupiter. Then a press with time
//           running, over one of Jupiter's orbits: how far Jupiter leaves
//           its line from the Sun and how far it moves along it, each
//           second (out/ride-running.jpg); fails if it leaves the line by
//           half a pixel, unless the frame turns by Jupiter's own
//           longitude, unless the sky is gone and the page says what the
//           turned frame brightens, and unless a second press gives the first camera back
//           (out/ride-back.jpg), whatever a wheel did meanwhile. And the two
//           actions together: sort pressed while riding, and riding pressed
//           while sorted (out/ride-to-sort.jpg, ride-then-sort.jpg,
//           sort-to-ride.jpg, sort-then-ride.jpg): fails unless each ends in
//           one pressed action, with time paused on the axes and running
//           again in the turning frame, and what isn't a row right in each.
//   gap     a gap picked: each of the four held on the epoch
//           (out/gap-3-1.jpg for board 5, gap-5-2, gap-7-3, gap-2-1): fails
//           unless the marker is white, drawn on the crate's place for it
//           and on its path, with its name beside it as the board has it;
//           unless the path ends where it began after as many of Jupiter's
//           orbits as the ratio counts, and (the control) after one of them
//           only where it counts one; unless the names shown are the Sun's,
//           Jupiter's, and the marker's, with no triangle; unless the card
//           is 20 px under the title's lines and says that gap's orbit
//           size, period, and Jupiter's period as worked out here from
//           JPL's a and mean motion for Jupiter, its picked chip lit; unless
//           the page's counts and the scene's points are the file's; and
//           unless the belt is dimmer than riding with no gap. Then the
//           presses, with time running: a chip on the landed layout
//           (out/gap-picking.jpg, gap-picked.jpg), another in the card
//           (out/gap-moved.jpg), the picked one (the marker let go, board
//           2's names back), and "Ride with Jupiter" and "Sort by orbit
//           size" each pressed with a gap picked, which let it go.
//   integrated  the Hildas and the Trojans, moved by the crate's integration:
//           fails unless the rows drawn apart are the file's own two groups
//           and the page's counts are what they were; unless, on the epoch,
//           the picture is the one drawn with every row on its ellipse
//           (`?integrate=0`), and 50 years on it isn't; unless Hilda,
//           Patroclus, and Hektor, drawn alone a decade on and 50 years
//           back, are each within a CSS pixel of the crate's own place for
//           them, integrated from the epoch apart, and more than a pixel
//           from their ellipse's. The turning frame at the clock's two ends
//           and on the epoch, integrated and on the ellipses
//           (out/integrated-*.jpg, ellipses-*.jpg). And what it costs: a
//           jump of the clock across its whole reach in one go and as the
//           page takes it, a frame's places, and the wasm's memory with
//           and without.
//
//   camera  the camera a hand moves, on a held clock: a drag pans along the
//           ecliptic (fails unless the plane's point under the pointer at
//           the press is under it at the release, within a CSS pixel, from
//           the opening camera and from two tilted by `?elev`, with the
//           distance, tilt, bearing, and roll as they were; unless a press
//           on the time control or the open panel, on the landed layout,
//           and riding, each dragged, moves nothing; and unless a drag that
//           crosses the open panel keeps the camera to its release there);
//           a wheel zooms toward the pointer (fails unless the plane's
//           point under it holds within a pixel in and out, the camera
//           stops at 0.05 and 60 au, over the sky it zooms and looks where
//           it did, and with Ctrl held it zooms the scene and leaves the
//           page's own zoom); and the glide (fails unless a drag let go
//           moving carries on and rests, one let go still doesn't, a press
//           stops one, and at rest the scene draws nothing). The dots at
//           the nearest zoom (out/camera-near-*.jpg).
//
// Run only when asked for by name (minutes more each):
//
//   drag    a drag's frames: the scene's frames a second while a scripted
//           drag moves the camera, with time running and paused, at the
//           display's resolution and at `?scale` 0.75 and 0.5 (the median
//           of `--rate-runs` loads).
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
// Usage: node apps/kirkwood/checks/see.ts [--only paint,table,memory,belt,time,bodies,look,color,sky,wheel,camera,sort,ride,gap,integrated,rate,drag,slow,cross] [--runs 5] [--browser firefox|webkit]
// --only picks what's run and checked, not only what's printed.
// Run `just kirkwood build` first. Writes out/seen.json (out/seen-<browser>.json off Chromium).

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, firefox, webkit, type Page } from '@playwright/test';
import { clickTarget, firstDrawProbe, open, targetRect, waitMark, wheel, type FirstDrawProbe } from '../../../shared-web/perf/harness.ts';
import { PROFILES, flag, localDate, machineInfo, median, option } from '../../../shared-web/perf/protocol.ts';
import { serveApp } from '../../../shared-web/perf/serve.ts';
import { readElements, type ElementsFile } from '../data/elements.ts';

const dir = import.meta.dirname;
const out = join(dir, 'out');
const PORT = 4370;
const RUNS = Number(option('runs') ?? 5);
/** The parts that are loads repeated `--runs` times. */
const LOADS = ['paint', 'table', 'memory'];
const PARTS = [...LOADS, 'belt', 'time', 'bodies', 'look', 'color', 'sky', 'wheel', 'camera', 'sort', 'ride', 'gap', 'integrated', 'rate', 'drag', 'slow', 'cross'];
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
const ASKED = ['rate', 'drag', 'slow', 'cross'];
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
type View = { x: number; y: number; distance: number; tilt: number; bearing: number; roll: number };
type SceneStats = { frames: number; years: number; rows: number; points: number; stars: number; renderer: string; distance: number; camera: View; gliding: boolean; flight: number; ride: number; integrated: number; catchingUp: boolean };
type Kirkwood = {
  wasmBytes(): number;
  wasmBytesAtFirstFrame: number;
  held: number;
  scene?: { stats: SceneStats; viewProjection(): number[]; labels(): Label[]; triangle(): number[] | undefined; marker(): { x: number; y: number; path: number[] } | undefined; under(x: number, y: number): [number, number] | undefined };
  viewsShareMemory?: boolean;
  placeOf(row: number, years: number): number[];
  ellipseOf(row: number, years: number): number[];
  jupiter(years: number): number[];
  clock(): Clock;
  belt(): { drawn: number; unbound: number; rows: number; of: number };
  ramp(): number[];
  scrim(): number[];
  flight(): { progress: number; sorted: boolean; flying: boolean };
  layoutOf(a: number, e: number): number[];
  layoutRow(row: number): { a: number; e: number; inView: boolean } | undefined;
  gaps(): number[];
  inView(): number;
  ride(): { turned: number; riding: boolean; flying: boolean };
  ridePoints(years: number): number[];
  rideCounts(): { hildas: number; trojans: number };
  gap(): { marker: number; picked: boolean; shown: number; lit: number; moving: boolean };
  gapCard(gap: number): string[];
  gapNumbers(gap: number): { a: number; orbit: number; jupiter: number; closesIn: number; e: number };
  gapPlace(gap: number, years: number): number[];
  integrated(): { rows: number; bytes: number; step: number };
  integratedJump(years: number): { stepsMs: number; placesMs: number } | undefined;
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
    // On a date far from the epoch the Hildas and the Trojans are a few
    // frames on their way there.
    await page.waitForFunction(() => !(globalThis as unknown as Page_).__kirkwood.scene!.stats.catchingUp, undefined, { timeout: 60_000 });
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

/** In the page: a screenshot (a PNG as base64) on a canvas to read pixels
 *  from, and its pixels for each CSS pixel. Handed to the page as its
 *  source, so it leans on nothing outside itself. */
async function decoded(data: string): Promise<{ context: OffscreenCanvasRenderingContext2D; scale: number }> {
  const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${data}`)).blob());
  const context = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d', { willReadFrequently: true })!;
  context.drawImage(bitmap, 0, 0);
  return { context, scale: bitmap.width / innerWidth };
}
const fixed = (value: number, digits = 2) => Number(value.toFixed(digits));

/** In a screenshot at the display's pixels: around each place (CSS px),
 *  the center of what's lit within `reach`, its lit pixels, and the
 *  place's own color. */
async function lit(page: Page, png: Buffer, places: [number, number][], reach = 14): Promise<{ x: number; y: number; pixels: number; color: [number, number, number] }[]> {
  return page.evaluate(
    async ({ data, places, reach, decode }) => {
      const { context, scale } = await (new Function(`return (${decode})`)() as typeof decoded)(data);
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
    { data: png.toString('base64'), places, reach, decode: decoded.toString() },
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
    async ({ data, clip, measure, decode }) => {
      const { context, scale } = await (new Function(`return (${decode})`)() as typeof decoded)(data);
      const [width, height] = [Math.round(clip.width * scale), Math.round(clip.height * scale)];
      const { data: pixels } = context.getImageData(Math.round(clip.x * scale), Math.round(clip.y * scale), width, height);
      return (new Function(`return (${measure})`)() as (pixels: Uint8ClampedArray, width: number, height: number, scale: number) => T)(pixels, width, height, scale);
    },
    { data: png.toString('base64'), clip, measure: measure.toString(), decode: decoded.toString() },
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
    // (On the Sun, which the camera looks at: a wheel zooms toward the
    // pointer, and the Sun's name is read centered below.)
    await page.mouse.move(720, 450);
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

// --- The camera a hand moves.

type Point = [number, number];
/** The scene's camera as last drawn, and what it has drawn. */
const cameraNow = (page: Page) =>
  kirkwood(page, (kirkwood) => {
    const scene = kirkwood.scene!;
    return { view: scene.stats.camera, gliding: scene.stats.gliding, frames: scene.stats.frames, matrix: scene.viewProjection() };
  });
const under = (page: Page, [x, y]: Point) => page.evaluate(([x, y]) => (globalThis as unknown as Page_).__kirkwood.scene!.under(x!, y!), [x, y]);
/** A drag from one window position to another: a move every 8 ms, `ms`
 *  from the press to the last; then `still` ms with the pointer at rest
 *  before the release (none: let go moving), unless `held`. With
 *  `pressed`, a drag already held is carried on. */
async function dragged(page: Page, from: Point, to: Point, { ms = 400, still = 250, held = false, pressed = false } = {}): Promise<void> {
  if (!pressed) {
    await page.mouse.move(...from);
    await page.mouse.down();
  }
  const steps = Math.max(2, Math.round(ms / 8));
  const start = Date.now();
  for (let step = 1; step <= steps; step++) {
    await page.mouse.move(from[0] + ((to[0] - from[0]) * step) / steps, from[1] + ((to[1] - from[1]) * step) / steps);
    const wait = start + (ms * step) / steps - Date.now();
    if (wait > 0) await page.waitForTimeout(wait);
  }
  if (still) await page.waitForTimeout(still);
  if (!held) await page.mouse.up();
}
const sameView = (a: View, b: View) => a.x === b.x && a.y === b.y && a.distance === b.distance && a.tilt === b.tilt && a.bearing === b.bearing && a.roll === b.roll;
const viewOf = (view: View) => ({ at: [fixed(view.x, 4), fixed(view.y, 4)], distance: fixed(view.distance, 4), tilt: fixed(view.tilt, 2), bearing: fixed(view.bearing, 2), roll: fixed(view.roll, 2) });
const off = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);

async function seeCamera(url: string) {
  // A drag pans along the plane, from the opening camera and from two
  // tilted by the knob.
  const pans = [];
  for (const [name, params] of [
    ['the opening camera', {}],
    ['30° from straight down', { elev: '60' }],
    ['78° from straight down', { elev: '12', roll: '0' }],
  ] as [string, Record<string, string>][]) {
    pans.push(
      await withBelt(url, { ...HELD, ...params }, async (page) => {
        const [from, to]: [Point, Point] = [[700, 520], [560, 610]];
        const before = await cameraNow(page);
        const held = await under(page, from);
        need(!!held, `${name}: no point of the ecliptic under ${from.join()}`);
        await dragged(page, from, to);
        await settle(page);
        const after = await cameraNow(page);
        const at = project(after.matrix, [...held!, 0]);
        need(off(at, to) <= 1, `${name}: the point pressed at ${from.join()} is at ${at.map(round).join()} after a drag to ${to.join()}`);
        need(off(project(before.matrix, [...held!, 0]), from) <= 0.01, `${name}: the point under the press isn't where the camera puts it`);
        need(!sameView(before.view, after.view) && after.view.distance === before.view.distance && after.view.tilt === before.view.tilt && after.view.bearing === before.view.bearing && after.view.roll === before.view.roll, `${name}: a pan took the camera from ${JSON.stringify(before.view)} to ${JSON.stringify(after.view)}`);
        need(!after.gliding, `${name}: let go still, the camera glides`);
        if (name === 'the opening camera') await shot(page, 'camera-panned');
        return { camera: name, press: from, release: to, pointHeldAu: held!.map((au) => fixed(au, 4)), pointAfterPx: at.map((px) => fixed(px, 2)), offPx: fixed(off(at, to), 3), before: viewOf(before.view), after: viewOf(after.view) };
      }),
    );
  }
  // A press on a control or the panel moves nothing, nor a drag where the
  // camera isn't a hand's; and a drag that crosses the panel keeps it.
  const elsewhere = await withBelt(url, HELD, async (page) => {
    await waitMark(page, ROWS, 0, 120_000);
    const first = (await cameraNow(page)).view;
    const still = async (what: string) => {
      await settle(page);
      const now = (await cameraNow(page)).view;
      need(sameView(first, now), `${what} moved the camera from ${JSON.stringify(first)} to ${JSON.stringify(now)}`);
    };
    // The time control (a press that leaves it is no click).
    const [tx, ty, tw, th] = await targetRect(page, 'time');
    await dragged(page, [tx + tw / 2, ty + th / 2], [tx + tw / 2 - 200, ty - 200], { ms: 200 });
    await still('a drag from the time control');
    // The panel, open.
    await clickTarget(page, 'table-handle');
    await waitMark(page, TABLE);
    await page.waitForTimeout(600);
    await dragged(page, [1440 - PANEL + 200, 450], [400, 300], { ms: 200 });
    await still('a drag from the open panel');
    // From the scene across the panel, and let go over it.
    const [from, to]: [Point, Point] = [[420, 520], [1440 - PANEL + 150, 600]];
    const held = await under(page, from);
    need(!!held, `the panel open: no point of the ecliptic under ${from.join()}`);
    await dragged(page, from, [1440 - PANEL - 40, 560], { ms: 250, still: 100, held: true });
    await settle(page);
    const beside = await cameraNow(page);
    await dragged(page, [1440 - PANEL - 40, 560], to, { ms: 200, pressed: true });
    await settle(page);
    const over = await cameraNow(page);
    need(!sameView(beside.view, over.view), 'a drag that crossed the panel stopped moving the camera at its edge');
    const at = project(over.matrix, [...held!, 0]);
    need(off(at, to) <= 1, `a drag across the panel: the point pressed at ${from.join()} is at ${at.map(round).join()} at its release at ${to.join()}`);
    // The release was the drag's: a move after it moves nothing.
    await page.mouse.move(300, 300);
    await settle(page);
    need(sameView(over.view, (await cameraNow(page)).view), 'a move after the release over the panel moved the camera');
    await shot(page, 'camera-across-panel');
    return { acrossThePanel: { press: from, release: to, pointAfterPx: at.map((px) => fixed(px, 2)), offPx: fixed(off(at, to), 3), before: viewOf(first), after: viewOf(over.view) } };
  });
  const modes = [];
  for (const [name, params] of [
    ['on the axes', { flight: '1' }],
    ['riding with Jupiter', { ride: '1' }],
  ] as [string, Record<string, string>][]) {
    modes.push(
      await withBelt(url, { ...HELD, ...params }, async (page) => {
        const before = await cameraNow(page);
        await dragged(page, [700, 520], [560, 610], { ms: 200, still: 0 });
        await page.waitForTimeout(300);
        const after = await cameraNow(page);
        need(sameView(before.view, after.view) && !after.gliding && before.matrix.join() === after.matrix.join(), `${name}, a drag moved the camera from ${JSON.stringify(before.view)} to ${JSON.stringify(after.view)}`);
        return name;
      }),
    );
  }

  // A wheel zooms toward the pointer.
  const zoom = await withBelt(url, HELD, async (page) => {
    const at: Point = [500, 560];
    await page.mouse.move(...at);
    const steps = [];
    for (const delta of [-300, -300, 500]) {
      const before = await cameraNow(page);
      const held = await under(page, at);
      need(!!held, `no point of the ecliptic under ${at.join()}`);
      await wheel(page, delta);
      await settle(page);
      const after = await cameraNow(page);
      const now = project(after.matrix, [...held!, 0]);
      need(after.view.distance !== before.view.distance && off(now, at) <= 1, `a wheel of ${delta} at ${at.join()}: the camera went from ${before.view.distance} au to ${after.view.distance}, the point under the pointer to ${now.map(round).join()}`);
      need(after.view.tilt === before.view.tilt && after.view.bearing === before.view.bearing && after.view.roll === before.view.roll, 'a wheel tilted or turned the camera');
      steps.push({ wheel: delta, distanceAu: [fixed(before.view.distance, 4), fixed(after.view.distance, 4)], pointAfterPx: now.map((px) => fixed(px, 2)), offPx: fixed(off(now, at), 3) });
    }
    await shot(page, 'camera-zoomed');
    // The limits, the pointer on what the camera looks at.
    const limit = async (delta: number) => {
      const looked = (await cameraNow(page)).view;
      const [x, y] = project((await cameraNow(page)).matrix, [looked.x, looked.y, 0]);
      await page.mouse.move(x, y);
      for (let turn = 0; turn < 40; turn++) await wheel(page, delta);
      await settle(page);
      const stopped = await cameraNow(page);
      await page.waitForTimeout(300);
      const frames = (await cameraNow(page)).frames;
      await wheel(page, delta);
      await page.waitForTimeout(300);
      const pushed = await cameraNow(page);
      need(sameView(stopped.view, pushed.view) && pushed.frames === frames, `a wheel past the limit moved the camera from ${JSON.stringify(stopped.view)} to ${JSON.stringify(pushed.view)}, or drew`);
      return stopped.view.distance;
    };
    const farthest = await limit(600);
    const nearest = await limit(-600);
    need(farthest === 60 && nearest === 0.05, `the wheel stops at ${nearest} au and ${farthest}`);
    return { pointer: at, steps, limitsAu: [nearest, farthest] };
  });
  // Over the sky, toward what the camera looks at.
  const sky = await withBelt(url, { ...HELD, elev: '5', roll: '0' }, async (page) => {
    const at: Point = [720, 120];
    need(!(await under(page, at)), `at 5° above the plane a ray through ${at.join()} meets the ecliptic`);
    await page.mouse.move(...at);
    const before = await cameraNow(page);
    await wheel(page, -300);
    await settle(page);
    const after = await cameraNow(page);
    need(after.view.distance < before.view.distance && after.view.x === before.view.x && after.view.y === before.view.y, `a wheel over the sky took the camera from ${JSON.stringify(before.view)} to ${JSON.stringify(after.view)}`);
    return { pointer: at, before: viewOf(before.view), after: viewOf(after.view) };
  });
  // With Ctrl held, as a trackpad's pinch: the scene zooms, never the page.
  const pinch = await withBelt(url, HELD, async (page) => {
    const pageZoom = () => page.evaluate(() => ({ scale: visualViewport!.scale, width: innerWidth, ratio: devicePixelRatio }));
    const at: Point = [500, 560];
    await page.mouse.move(...at);
    const [before, zoomBefore, held] = [await cameraNow(page), await pageZoom(), await under(page, at)];
    await wheel(page, -20);
    await settle(page);
    const plain = await cameraNow(page);
    await page.keyboard.down('Control');
    await wheel(page, -20);
    await page.keyboard.up('Control');
    await settle(page);
    const [after, zoomAfter] = [await cameraNow(page), await pageZoom()];
    const [byPlain, byPinch] = [before.view.distance / plain.view.distance, plain.view.distance / after.view.distance];
    need(byPinch > byPlain * 1.05, `a wheel with Ctrl held zoomed the scene by ${byPinch}, and a plain one by ${byPlain}`);
    need(JSON.stringify(zoomBefore) === JSON.stringify(zoomAfter), `a wheel with Ctrl held took the page's zoom from ${JSON.stringify(zoomBefore)} to ${JSON.stringify(zoomAfter)}`);
    const now = project(after.matrix, [...held!, 0]);
    need(off(now, at) <= 1, `a wheel with Ctrl held: the point under the pointer went to ${now.map(round).join()}`);
    return { wheel: -20, zoomedBy: { plain: fixed(byPlain, 4), withCtrl: fixed(byPinch, 4) }, pageZoom: zoomAfter };
  });

  // The glide.
  const glide = await withBelt(url, HELD, async (page) => {
    const fling = () => dragged(page, [800, 480], [560, 560], { ms: 120, still: 0 });
    await fling();
    const letGo = Date.now();
    const released = await cameraNow(page);
    need(released.gliding, 'let go moving, the camera does not glide');
    await page.waitForFunction(() => !(globalThis as unknown as Page_).__kirkwood.scene!.stats.gliding, undefined, { timeout: 10_000, polling: 'raf' });
    const restMs = Date.now() - letGo;
    await settle(page);
    const rested = await cameraNow(page);
    const carried = Math.hypot(rested.view.x - released.view.x, rested.view.y - released.view.y);
    need(carried > 0, 'the glide carried the camera nowhere');
    await page.waitForTimeout(1500);
    const later = await cameraNow(page);
    need(later.frames === rested.frames && sameView(later.view, rested.view), `at rest, time paused, the scene drew ${later.frames - rested.frames} frames in 1.5 s`);
    // A press stops it: on the scene, and on a control.
    const stops = [];
    for (const [where, press] of [
      ['the scene', () => page.mouse.click(300, 600)],
      ['the handle', () => clickTarget(page, 'table-handle')],
    ] as [string, () => Promise<void>][]) {
      await fling();
      need((await cameraNow(page)).gliding, 'let go moving again, the camera does not glide');
      await press();
      const pressed = await cameraNow(page);
      await page.waitForTimeout(300);
      const after = await cameraNow(page);
      need(!pressed.gliding && after.view.x === pressed.view.x && after.view.y === pressed.view.y, `a press on ${where} left the camera gliding`);
      stops.push(where);
    }
    return { restMs, carriedAu: fixed(carried, 4), released: viewOf(released.view), rested: viewOf(rested.view), framesAtRest: later.frames - rested.frames, aPressStopsItOn: stops };
  });

  // The dots at the nearest zoom, and on the way in.
  for (const [name, dist] of [['1', '1'], ['0-2', '0.2'], ['0-05', '0.05']] as const) {
    await withSky(url, { ...HELD, at: '2.2,-1.6', dist }, async (page) => {
      await shot(page, `camera-near-${name}`);
    });
  }
  return { pans, ...elsewhere, nothingMoves: ['a drag from the time control', 'a drag from the open panel', ...modes.map((mode) => `a drag ${mode}`)], zoom, overTheSky: sky, pinch, glide };
}
/** A drag's frames: the scene's frames a second while a scripted drag
 *  moves the camera round a circle, by the scene's resolution. */
async function seeDrag(url: string) {
  const SECONDS = 4;
  const ways = [];
  for (const [name, params] of [
    ["the display's resolution", {}],
    ['three quarters', { scale: '0.75' }],
    ['half', { scale: '0.5' }],
    ["the display's, time paused", { paused: '' }],
    ['three quarters, time paused', { scale: '0.75', paused: '' }],
  ] as [string, Record<string, string>][]) {
    const loads: { scene: number; page: number; p50: number; p95: number; longest: number }[] = [];
    for (let run = 0; run < RATE_RUNS; run++) {
      loads.push(
        await withSky(url, { date: EPOCH, ...params }, async (page) => {
          await page.mouse.move(720, 520);
          await page.mouse.down();
          const measured = page.evaluate(
            (ms) =>
              new Promise<{ scene: number; page: number; p50: number; p95: number; longest: number }>((done) => {
                const stats = (globalThis as unknown as Page_).__kirkwood.scene!.stats;
                const from = performance.now();
                let [frames, last, lastAt] = [0, stats.frames, from];
                const gaps: number[] = [];
                const tick = (now: number) => {
                  frames++;
                  if (stats.frames !== last) {
                    gaps.push(now - lastAt);
                    [last, lastAt] = [stats.frames, now];
                  }
                  if (now - from < ms) return void requestAnimationFrame(tick);
                  const seconds = (now - from) / 1000;
                  const sorted = gaps.slice(1).sort((a, b) => a - b);
                  done({ scene: (gaps.length - 1) / seconds, page: frames / seconds, p50: sorted[Math.floor(sorted.length / 2)]!, p95: sorted[Math.floor(sorted.length * 0.95)]!, longest: sorted[sorted.length - 1]! });
                };
                requestAnimationFrame(tick);
              }),
            SECONDS * 1000,
          );
          // Round a circle, a move every 8 ms, until the reading is in.
          let done = false;
          void measured.then(() => (done = true));
          const start = Date.now();
          while (!done) {
            const turn = ((Date.now() - start) / 1000) * Math.PI;
            await page.mouse.move(720 + 160 * Math.sin(turn), 520 + 90 * (1 - Math.cos(turn)));
            await page.waitForTimeout(8);
          }
          const reading = await measured;
          await page.waitForTimeout(250);
          await page.mouse.up();
          return reading;
        }),
      );
    }
    const of = (pick: (load: (typeof loads)[number]) => number) => round(median(loads.map(pick)));
    ways.push({ way: name, params, sceneFramesASecond: of((load) => load.scene), pageFramesASecond: of((load) => load.page), frameMs: { p50: of((load) => load.p50), p95: of((load) => load.p95), longest: of((load) => load.longest) } });
    console.error(JSON.stringify(ways[ways.length - 1]));
  }
  return { seconds: SECONDS, runs: RATE_RUNS, ways };
}

// --- The sort flight.

/** One way of the flight, from the press to the dots' arrival: how long it
 *  took, the scene's frames on the way, and the share of them that came
 *  more than a frame and a half after the last. Call it, press, then wait
 *  on it. */
type Flown = { seconds: number; sceneFrames: number; sceneFramesASecond: number; pageFramesASecond: number; percentLate: number };
const flown = (page: Page, to: boolean): Promise<Flown> =>
  page.evaluate(
    (to) =>
      new Promise<Flown>((done) => {
        const kirkwood = (globalThis as unknown as Page_).__kirkwood;
        const stats = kirkwood.scene!.stats;
        let [from, frames, last, lastAt] = [NaN, 0, 0, 0];
        const gaps: number[] = [];
        const tick = (now: number) => {
          const flight = kirkwood.flight();
          // Not pressed yet.
          if (flight.sorted !== to) return void requestAnimationFrame(tick);
          if (Number.isNaN(from)) [from, last, lastAt] = [now, stats.frames, now];
          frames++;
          if (stats.frames !== last) {
            gaps.push(now - lastAt);
            [last, lastAt] = [stats.frames, now];
          }
          if (flight.flying) return void requestAnimationFrame(tick);
          const seconds = (now - from) / 1000;
          done({ seconds, sceneFrames: gaps.length, sceneFramesASecond: gaps.length / seconds, pageFramesASecond: frames / seconds, percentLate: (100 * gaps.filter((gap) => gap > 25).length) / gaps.length });
        };
        requestAnimationFrame(tick);
      }),
    to,
  );

/** The mean light (0 to 255) of a part of a screenshot. */
const light = (page: Page, png: Buffer, clip: Clip) =>
  pixelsOf(page, png, clip, (pixels) => {
    let sum = 0;
    for (let at = 0; at < pixels.length; at += 4) sum += pixels[at]! + pixels[at + 1]! + pixels[at + 2]!;
    return sum / (pixels.length / 4) / 3;
  });
/** The pixels of a part of a screenshot as bright as the page's muted text. */
const textPixels = (page: Page, png: Buffer, clip: Clip) =>
  pixelsOf(page, png, clip, (pixels) => {
    let count = 0;
    for (let at = 0; at < pixels.length; at += 4) count += Number(pixels[at]! + pixels[at + 1]! + pixels[at + 2]! > 3 * 120);
    return count;
  });

/** Board 4's furniture at 1440×900, the storyboard's own numbers: left,
 *  top, width, height. (Its e axis and that axis's label are read apart:
 *  the app's title is taller than the board's, and they start under it.) */
type Rect = [number, number, number, number];
const BOARD: Record<string, Rect> = {
  'axis-a': [80, 771, 1280, 1],
  'label-a': [80, 796, 1280, 18],
  'gaps-line': [325, 178, 400, 18],
  'chip-0': [384, 206, 35, 24],
  'chip-1': [487, 206, 35, 24],
  'chip-2': [530, 206, 35, 24],
  'chip-3': [632, 206, 35, 24],
  'group-0': [741, 392, 260, 18],
  'group-1': [1135, 500, 260, 18],
};
const BOARD_AXIS_E: Rect = [79, 96, 1, 675];
const BOARD_LABEL_E = [90, 110];
/** The board's axis line, neutral-700, as a mean light of 255. */
const AXIS_LIGHT = 64;
const CHIPS = ['chip-0', 'chip-1', 'chip-2', 'chip-3'];
const FURNITURE = [...Object.keys(BOARD), 'axis-e', 'label-e', 'in-view'];
const furnitureRects = async (page: Page): Promise<Record<string, Rect>> =>
  Object.fromEntries(await Promise.all(FURNITURE.map(async (id) => [id, await targetRect(page, id, 5_000)] as const)));
const rounded = (rect: Rect) => rect.map(round);

/** The rows with a place on the sort's axes (a from 1.5 to 5.5 au, e from 0
 *  to `most`), counted here from the file's own bytes, in the 32-bit floats
 *  they are. */
function countInView(most = 0.6): number {
  const { a, e } = elementsFile().columns;
  const [least, mostA, leastE, mostE] = [1.5, 5.5, 0, most].map(Math.fround) as [number, number, number, number];
  let count = 0;
  for (let row = 0; row < elementsFile().rows; row++) count += Number(a[row]! >= least && a[row]! <= mostA && e[row]! >= leastE && e[row]! <= mostE);
  return count;
}

/** An action's fill, as a mean light of 255: a strip across its middle,
 *  just inside its top edge, over its text. Not beside an edge: with time
 *  running the date's width moves the row by a few pixels, and the bounds
 *  published are those of the interface's last frame of its own, not the
 *  date's. */
async function actionFill(page: Page, png: Buffer, id: string): Promise<number> {
  const [x, y, width] = await targetRect(page, id);
  return Math.round(await light(page, png, { x: x + width / 2 - 8, y: y + 2, width: 16, height: 2 }));
}

/** The two actions' fills, each read from a screenshot taken while its
 *  bounds held: with time running the date's width moves the row, and a
 *  fill read against bounds from another frame is the page's between two
 *  buttons. */
async function actionFills(page: Page): Promise<{ sort: number; ride: number }> {
  const bounds = async () => (await Promise.all(['sort', 'ride'].map((id) => targetRect(page, id)))).flat().join();
  for (let tries = 0; ; tries++) {
    const before = await bounds();
    const png = await page.screenshot();
    if ((await bounds()) === before) return { sort: await actionFill(page, png, 'sort'), ride: await actionFill(page, png, 'ride') };
    need(tries < 20, "the actions' bounds never held for a screenshot");
  }
}

async function seeSort(url: string) {
  const actionLight = (page: Page, png: Buffer) => actionFill(page, png, 'sort');
  // The press, the landing, and the press back, with time running.
  const flight = await withSky(url, { date: EPOCH }, async (page) => {
    const read = async () => {
      await settle(page);
      const png = await page.screenshot();
      const seen = await kirkwood(page, (kirkwood) => {
        const scene = kirkwood.scene!;
        return { frames: scene.stats.frames, drawnAt: scene.stats.flight, labels: scene.labels(), sun: [0, 0, 0], jupiter: kirkwood.jupiter(scene.stats.years), camera: scene.viewProjection(), flight: kirkwood.flight(), clock: kirkwood.clock(), scrim: kirkwood.scrim() };
      });
      const [sun, jupiter] = await lit(page, png, [project(seen.camera, seen.sun), project(seen.camera, seen.jupiter)], 8);
      // The title's lines: the page's text over the scene.
      const [left, top, width, height] = seen.scrim as [number, number, number, number];
      return { ...seen, png, action: await actionLight(page, png), sunColor: sun!.color, jupiterColor: jupiter!.color, text: await textPixels(page, png, { x: left, y: top, width, height }), names: seen.labels.filter((label) => label.shown).map((label) => label.text) };
    };
    // In space, paused for the reading: the Sun and Jupiter stand still.
    await clickTarget(page, 'time');
    await page.waitForTimeout(400);
    const space = await read();
    await shot(page, 'sort-space');
    await clickTarget(page, 'time');
    await page.waitForTimeout(200);
    need(space.flight.progress === 0 && !space.flight.sorted, `before the press the flight is ${JSON.stringify(space.flight)}`);
    // The action, not pressed: the boards' fill (#262626), and no axes.
    const actionSpace = space.action;
    need(near(actionSpace, 38, 4), `the action's fill in space reads ${actionSpace} of 255, and the boards draw 38`);
    const axisSpace = await light(page, space.png, { x: 700, y: 771, width: 8, height: 1 });
    need(axisSpace < 30, `in space, where the a axis would be reads ${axisSpace.toFixed(1)} of 255`);
    need(space.names.join() === 'Sol,Jupiter' && Math.min(...space.sunColor) > 180 && space.jupiterColor[0] > 170, `in space: the names ${space.names.join()}, the Sun's place ${space.sunColor}, Jupiter's ${space.jupiterColor}`);

    // The press: every dot to the axes.
    let way = flown(page, true);
    await clickTarget(page, 'sort');
    const out_ = await way;
    // Off the action: under the pointer its fill is the hover's.
    await page.mouse.move(700, 600);
    await page.waitForTimeout(500);
    const landed = await read();
    await shot(page, 'sort-landed');
    await shot(page, 'sort-landed-time', { x: 0, y: 820, width: 520, height: 80 });
    need(landed.flight.progress === 1 && landed.flight.sorted && !landed.flight.flying && landed.drawnAt === 1, `landed, the flight is ${JSON.stringify(landed.flight)}, drawn at ${landed.drawnAt}`);
    need(near(out_.seconds, 3, 0.25), `the flight out took ${out_.seconds.toFixed(2)} s`);
    // Time: the press paused it, and the control says so.
    need(!landed.clock.running, `landed, the clock is ${JSON.stringify(landed.clock)}`);
    // What isn't a row is gone.
    need(!landed.names.length && Math.max(...landed.sunColor) < 60 && Math.max(...landed.jupiterColor) < 60, `landed: the names ${landed.names.join() || 'none'}, the Sun's place ${landed.sunColor}, Jupiter's ${landed.jupiterColor}`);
    need(landed.text < space.text - 300, `the title's lines are ${landed.text} text pixels landed and ${space.text} in space: the line about the stars hasn't left`);
    // The action, pressed: the boards' pressed fill (#fafafa).
    const actionPressed = landed.action;
    need(near(actionPressed, 250, 4), `the action's fill pressed reads ${actionPressed} of 255, and the boards draw 250`);
    // The furniture: each piece where board 4 has it.
    const rects = await furnitureRects(page);
    for (const [id, board] of Object.entries(BOARD)) {
      need(rects[id]!.every((px, at) => near(px, board[at]!, 1.5)), `${id} is at ${rounded(rects[id]!)}, and board 4 has it at ${board}`);
    }
    // The e axis and its label: the board's, or under the title's lines
    // where those reach past the axis's top.
    const under = (landed.scrim[1]! + landed.scrim[3]! + 8) as number;
    const [axisE, labelE, inViewAt] = [rects['axis-e']!, rects['label-e']!, rects['in-view']!];
    need(near(axisE[0], BOARD_AXIS_E[0], 0.5) && axisE[2] === 1 && near(axisE[1] + axisE[3], 771, 0.5) && near(axisE[1], Math.max(96, under), 0.5), `the e axis is at ${rounded(axisE)}: the board's is ${BOARD_AXIS_E}, and the title's lines end at ${round(under - 8)}`);
    need(near(labelE[0], BOARD_LABEL_E[0]!, 0.5) && near(labelE[1], Math.max(under, BOARD_LABEL_E[1]!), 0.5), `the e axis's label is at ${rounded(labelE)}: the board's is ${BOARD_LABEL_E}, and the title's lines end at ${round(under - 8)}`);
    need(near(inViewAt[0] + inViewAt[2], 1440 - 24, 1) && near(inViewAt[1] + inViewAt[3], 900 - 29, 1), `the count in view is at ${rounded(inViewAt)}: the board's ends 24 px from the right and 29 from the bottom`);
    // Drawn: the a axis's line whole, a chip's fill, and the words under
    // the plot, where no dot lands.
    const axisLanded = await light(page, landed.png, { x: 700, y: 771, width: 8, height: 1 });
    need(near(axisLanded, AXIS_LIGHT, 8), `landed, the a axis reads ${axisLanded.toFixed(1)} of 255, and the board draws ${AXIS_LIGHT}`);
    const chip = rects['chip-0']!;
    const chipFill = await light(page, landed.png, { x: chip[0] + 3, y: chip[1] + 3, width: 3, height: 3 });
    need(near(chipFill, 10, 8), `a chip's fill reads ${chipFill.toFixed(1)} of 255, and the board draws 10`);
    const words = { 'label-a': 0, 'in-view': 0, 'chip-0': 0 };
    for (const id of Object.keys(words) as (keyof typeof words)[]) {
      const [x, y, width, height] = rects[id]!;
      words[id] = await textPixels(page, landed.png, { x, y, width, height });
      need(words[id] > 40, `${id} has ${words[id]} text pixels`);
    }
    await shot(page, 'sort-count', { x: 1040, y: 820, width: 400, height: 80 });
    // The count: the crate's, against the file's own bytes.
    const [inView, counted, control] = [await kirkwood(page, (kirkwood) => kirkwood.inView()), countInView(), countInView(0.61)];
    need(inView === counted, `the page counts ${inView} rows in view, and the file's bytes hold ${counted}`);
    need(control !== counted, `the control passes: ${control} rows with e to 0.61`);
    // (A chip is a button: what its press does is `gap`'s to check.)
    // Landed, the scene draws nothing, and a wheel moves nothing: the
    // camera is space's.
    const camera = await kirkwood(page, (kirkwood) => kirkwood.scene!.stats.distance);
    await page.mouse.move(500, 450);
    await wheel(page, 300);
    await page.waitForTimeout(1500);
    const wheeled = await kirkwood(page, (kirkwood) => kirkwood.scene!.stats.distance);
    need(wheeled === camera, `a wheel over the landed dots moved the camera from ${camera} au to ${wheeled}`);
    const still = await kirkwood(page, (kirkwood) => kirkwood.scene!.stats.frames);
    need(still === landed.frames, `landed, the scene drew ${still - landed.frames} frames in 1.5 s`);

    // The press back.
    way = flown(page, false);
    await clickTarget(page, 'sort');
    const back = await way;
    await page.waitForTimeout(300);
    // Paused for the reading, as before.
    const ran = await kirkwood(page, (kirkwood) => kirkwood.clock());
    await clickTarget(page, 'time');
    await page.waitForTimeout(400);
    const again = await read();
    await shot(page, 'sort-back');
    need(again.flight.progress === 0 && !again.flight.sorted && again.drawnAt === 0, `back, the flight is ${JSON.stringify(again.flight)}`);
    need(near(back.seconds, 3, 0.25), `the flight back took ${back.seconds.toFixed(2)} s`);
    need(ran.running && ran.years > landed.clock.years, `back in space, the clock is ${JSON.stringify(ran)}`);
    need(again.names.join() === 'Sol,Jupiter' && Math.min(...again.sunColor) > 180 && again.jupiterColor[0] > 170, `back: the names ${again.names.join()}, the Sun's place ${again.sunColor}, Jupiter's ${again.jupiterColor} at ${project(again.camera, again.jupiter).map(round)}`);
    need(near(again.text, space.text, 60), `the title's lines are ${again.text} text pixels back in space and were ${space.text}`);
    const way_ = (way: Flown) => ({ seconds: fixed(way.seconds), sceneFrames: way.sceneFrames, sceneFramesASecond: fixed(way.sceneFramesASecond, 1), pageFramesASecond: fixed(way.pageFramesASecond, 1), percentLate: fixed(way.percentLate, 1) });
    return {
      out: way_(out_),
      back: way_(back),
      framesIn1500msLanded: still - landed.frames,
      clock: { landed: { running: landed.clock.running, date: landed.clock.date }, back: { running: ran.running } },
      titleTextPixels: { space: space.text, landed: landed.text, back: again.text },
      sunPlace: { space: space.sunColor, landed: landed.sunColor, back: again.sunColor },
      names: { space: space.names, landed: landed.names, back: again.names },
      action: { spaceLight: actionSpace, pressedLight: actionPressed },
      furniture: { px: Object.fromEntries(Object.entries(rects).map(([id, rect]) => [id, rounded(rect)])), board: { ...BOARD, 'axis-e': BOARD_AXIS_E, 'label-e': BOARD_LABEL_E }, titleEndsPx: round(under - 8), axisLight: { space: fixed(axisSpace, 1), landed: fixed(axisLanded, 1) }, chipFillLight: fixed(chipFill, 1), textPixels: words },
      inView: { page: inView, fileBytes: counted, controlWithETo061: control },
    };
  });

  // The flight held partway, for board 3.
  // There the axes are dim, where the board has them, and nothing is
  // said of the dots yet.
  const mid = await withSky(url, { ...HELD, flight: '0.6' }, async (page) => {
    await page.waitForTimeout(400);
    await shot(page, 'sort-mid');
    const axis = await targetRect(page, 'axis-a', 5_000);
    need(axis.every((px, at) => near(px, BOARD['axis-a']![at]!, 1.5)), `mid-flight the a axis is at ${rounded(axis)}`);
    const axisLight = await light(page, await page.screenshot(), { x: 700, y: 771, width: 8, height: 1 });
    // 0.45 of the line over the page's own color.
    need(axisLight > 0.3 * AXIS_LIGHT && axisLight < 0.65 * AXIS_LIGHT, `mid-flight the a axis reads ${axisLight.toFixed(1)} of 255: 0.45 of ${AXIS_LIGHT} is ${0.45 * AXIS_LIGHT}`);
    // The e axis's label is the board's, or under the title's lines as
    // they are now, the stars' sentence among them, if those end lower:
    // it's laid out again when they move.
    const [labelE, scrim] = [await targetRect(page, 'label-e', 5_000), await kirkwood(page, (kirkwood) => kirkwood.scrim())];
    need(near(labelE[1], Math.max(scrim[1]! + scrim[3]! + 8, BOARD_LABEL_E[1]!), 0.5), `mid-flight the e axis's label is at ${rounded(labelE)}, and the title's lines end at ${round(scrim[1]! + scrim[3]!)}`);
    const said = await page.evaluate((ids) => ids.filter((id) => (globalThis as { __seizaTargets?: Record<string, unknown> }).__seizaTargets?.[id]), [...CHIPS, 'gaps-line', 'group-0', 'group-1', 'in-view']);
    need(!said.length, `mid-flight the page draws ${said.join()}`);
    return { axisLight: fixed(axisLight, 1) };
  });

  // Three rows drawn alone and landed, against the crate's own place on
  // the axes for each one's a and e.
  const ALONE = [
    { name: '1 Ceres', row: 0 },
    { name: '4 Vesta', row: 3 },
    { name: '624 Hektor', row: 623 },
  ];
  /** The table's panel, opened, and slid all the way in. */
  const openPanel = async (page: Page) => {
    await waitMark(page, ROWS, 0, 120_000);
    await clickTarget(page, 'table-handle');
    await waitMark(page, TABLE);
    await page.waitForTimeout(600);
    await settle(page);
  };
  const landedAlone = (panel: boolean) => withBelt(url, { ...HELD, flight: '1', only: ALONE.map((body) => body.row).join(',') }, async (page) => {
    if (panel) await openPanel(page);
    const png = await page.screenshot({ path: join(out, panel ? 'sort-alone-panel.png' : 'sort-alone.png') });
    const places = await kirkwood(page, (kirkwood) =>
      new URLSearchParams(location.search)
        .get('only')!
        .split(',')
        .map((row) => {
          const { a, e, inView } = kirkwood.layoutRow(Number(row))!;
          // The control: an a 1.6 px off, which is 0.005 au with the
          // panel shut.
          const pxAnAu = kirkwood.layoutOf(a + 1, e)[0]! - kirkwood.layoutOf(a, e)[0]!;
          return { a, e, inView, at: kirkwood.layoutOf(a, e), control: kirkwood.layoutOf(a + 1.6 / pxAnAu, e) };
        }),
    );
    const found = await lit(page, png, places.map((place) => [place.at[0]!, place.at[1]!]));
    return ALONE.map((body, at) => {
      const { a, e, inView, at: [x, y], control: [controlX, controlY] } = places[at]! as { a: number; e: number; inView: boolean; at: [number, number]; control: [number, number] };
      const off = Math.hypot(found[at]!.x - x, found[at]!.y - y);
      const controlOff = Math.hypot(found[at]!.x - controlX, found[at]!.y - controlY);
      need(inView && found[at]!.pixels > 20, `${body.name}: no disc near (${round(x)}, ${round(y)}) on the axes`);
      need(off <= 1, `${body.name}: landed ${off.toFixed(2)} px from the crate's place (${round(x)}, ${round(y)})`);
      need(controlOff > 1, `${body.name}: the control passes (${controlOff.toFixed(2)} px from the place of an a 1.6 px off)`);
      return { body: body.name, a: fixed(a, 4), e: fixed(e, 4), cratePlacePx: [fixed(x), fixed(y)], drawnPx: [fixed(found[at]!.x), fixed(found[at]!.y)], offPx: fixed(off), controlOffPx: fixed(controlOff) };
    });
  });
  const alone = await landedAlone(false);
  // The panel open: the axes sit in what it leaves, and a dot still lands
  // on its a and e there.
  const alonePanel = await landedAlone(true);
  const panel = await withBelt(url, { ...HELD, flight: '1' }, async (page) => {
    await openPanel(page);
    await shot(page, 'sort-panel');
    const rects = await furnitureRects(page);
    const left = 1440 - PANEL;
    const axis = rects['axis-a']!;
    need(near(axis[0], 80, 0.5) && near(axis[0] + axis[2], left - 80, 0.5) && near(axis[1], 771, 0.5), `beside the panel the a axis is at ${rounded(axis)}: it should run from 80 px to ${left - 80}`);
    const inViewAt = rects['in-view']!;
    need(near(inViewAt[0] + inViewAt[2], left - 24, 1), `beside the panel the count in view is at ${rounded(inViewAt)}: it should end at ${left - 24} px`);
    // A chip is still over its gap, and clear of the next.
    const gaps = await kirkwood(page, (kirkwood) => kirkwood.gaps().map((a) => kirkwood.layoutOf(a, 0)[0]!));
    for (const [at, id] of CHIPS.entries()) {
      const [x, , width] = rects[id]!;
      need(gaps[at]! > x && gaps[at]! < x + width, `beside the panel ${id} is at ${rounded(rects[id]!)}, and its gap at ${round(gaps[at]!)} px`);
      const next = rects[CHIPS[at + 1] ?? '']?.[0] ?? Infinity;
      need(next >= x + width + 3.5, `beside the panel ${id} ends at ${round(x + width)} px and the next starts at ${round(next)}`);
    }
    for (const id of FURNITURE) need(rects[id]![0] + rects[id]![2] <= left + 16, `beside the panel ${id} is at ${rounded(rects[id]!)}`);
    return { px: Object.fromEntries(Object.entries(rects).map(([id, rect]) => [id, rounded(rect)])), gapsPx: gaps.map(round) };
  });

  // The gaps: the dust at each, where Jupiter's a puts it, against a tenth
  // of an au either side, for the orbits from e 0.02 to 0.25.
  const KNOWN = [2.5, 2.82, 2.96, 3.28];
  const gaps = await withBelt(url, { ...HELD, flight: '1' }, async (page) => {
    await page.waitForTimeout(400);
    const png = await page.screenshot();
    const at = await kirkwood(page, (kirkwood) => kirkwood.gaps().map((a) => ({ a, strips: [a - 0.1, a, a + 0.1].map((a) => [kirkwood.layoutOf(a, 0.25), kirkwood.layoutOf(a, 0.02)]) })));
    const seen = [];
    for (const [gap, { a, strips }] of at.entries()) {
      need(near(a, KNOWN[gap]!, 0.006), `gap ${gap} is at ${a} au, not ${KNOWN[gap]}`);
      // A strip 0.02 au wide.
      const [inner, here, outer] = await Promise.all(strips.map(([top, bottom]) => light(page, png, { x: top![0]! - 3.2, y: top![1]!, width: 6.4, height: bottom![1]! - top![1]! })));
      need(here! < inner! && here! < outer!, `the dust at ${a.toFixed(2)} au reads ${here!.toFixed(1)} of 255, against ${inner!.toFixed(1)} and ${outer!.toFixed(1)} a tenth of an au either side`);
      seen.push({ au: fixed(a, 3), light: fixed(here!, 1), inner: fixed(inner!, 1), outer: fixed(outer!, 1) });
    }
    return seen;
  });
  return { flight, mid, alone, alonePanel, panel, gaps };
}

// --- The ride with Jupiter.

/** Board 2 at 1440×900, the storyboard's own numbers: the Sun, the corner
 *  of Jupiter's name, and its dashed triangle's corners (ahead, opposite,
 *  behind). The board's Jupiter is on a circle, 379 px from the Sun; its
 *  triangle is a stand-in, drawn inside Jupiter's orbit, and the app's is
 *  through the three points at Jupiter's own orbit size. */
const BOARD_RIDE = { sun: [720, 450], jupiterName: [1111, 441], triangle: [883.1, 167.5, 393.8, 450, 883.1, 732.5] };
/** A name's corner from the point it's beside, CSS px (`scene.ts`,
 *  `RIDE_NAMES`): the Trojans' two, and where the Hildas' two lines end. */
const RIDE_NAMES = { ahead: [57, -29], behind: [57, 13], hildas: [-22, -54] } as const;
const RIDE_TEXTS = { held: 'Jupiter, held still', ahead: 'Trojans, 60° ahead of Jupiter', behind: 'Trojans, 60° behind', hildas: 'Hildas: a triangle that turns with Jupiter' };

/** The rows in each group the ride lights, counted here from the file's
 *  own bytes, in the 32-bit floats they are. */
function countGroups(): { hildas: number; trojans: number } {
  const { a, e } = elementsFile().columns;
  const [low, high, from, to, most] = [3.7, 4.2, 4.6, 5.5, 0.3].map(Math.fround) as [number, number, number, number, number];
  let [hildas, trojans] = [0, 0];
  for (let row = 0; row < elementsFile().rows; row++) {
    if (a[row]! >= low && a[row]! <= high) hildas++;
    else if (a[row]! > from && a[row]! < to && e[row]! < most) trojans++;
  }
  return { hildas, trojans };
}

/** Two screenshots of one size: the pixels of `clip` (CSS px) whose red,
 *  green, or blue differ by more than `by` of 255, and how many there are. */
async function differing(page: Page, one: Buffer, other: Buffer, clip: Clip, by = 24): Promise<{ pixels: number; of: number }> {
  return page.evaluate(
    async ({ pngs, clip, by, decode }) => {
      const read = async (data: string) => {
        const { context, scale } = await (new Function(`return (${decode})`)() as typeof decoded)(data);
        return context.getImageData(Math.round(clip.x * scale), Math.round(clip.y * scale), Math.round(clip.width * scale), Math.round(clip.height * scale)).data;
      };
      const [a, b] = [await read(pngs[0]!), await read(pngs[1]!)];
      let pixels = 0;
      for (let at = 0; at < a.length; at += 4) {
        if (Math.abs(a[at]! - b[at]!) > by || Math.abs(a[at + 1]! - b[at + 1]!) > by || Math.abs(a[at + 2]! - b[at + 2]!) > by) pixels++;
      }
      return { pixels, of: a.length / 4 };
    },
    { pngs: [one.toString('base64'), other.toString('base64')], clip, by, decode: decoded.toString() },
  );
}

async function seeIntegrated(url: string) {
  const file = { ...countRows(), ...countGroups() };
  const grouped = file.hildas + file.trojans;
  const ELLIPSES = { integrate: '0' };

  // On the epoch: the rows drawn apart are the file's two groups, the
  // page's counts are what they were, and the picture is the ellipses'.
  const top = { paused: '', elev: '90', az: '0', roll: '0', dist: '15.5', sky: '0' };
  const square = { x: 270, y: 0, width: 900, height: 900 };
  /** A picture and what the page says of it; and, read in that page while
   *  it's open, the pixels by which it differs from another. */
  const picture = (params: Record<string, string>, from?: Buffer) =>
    withBelt(url, { ...top, ...params }, async (page) => {
      const png = await page.screenshot();
      const says = await kirkwood(page, (kirkwood) => ({ ...kirkwood.belt(), points: kirkwood.scene!.stats.points, sceneRows: kirkwood.scene!.stats.rows, apart: kirkwood.scene!.stats.integrated, state: kirkwood.integrated(), wasm: kirkwood.wasmBytes() }));
      return { png, ...says, differs: from ? await differing(page, png, from, square) : undefined };
    });
  const epoch = await picture({ date: EPOCH });
  const epochEllipses = await picture({ date: EPOCH, ...ELLIPSES }, epoch.png);
  const on = await picture({ date: '2076-06-09' });
  const onEllipses = await picture({ date: '2076-06-09', ...ELLIPSES }, on.png);
  need(epoch.apart === grouped && epoch.state.rows === grouped, `${epoch.apart} rows are drawn apart, of ${epoch.state.rows} integrated; the file's two groups are ${file.hildas} Hildas and ${file.trojans} Trojans`);
  need(epochEllipses.apart === 0 && epochEllipses.state.rows === 0, `with ?integrate=0, ${epochEllipses.apart} rows are drawn apart`);
  for (const [name, seen] of [['integrated', epoch], ['on their ellipses', epochEllipses]] as const) {
    need(seen.drawn === file.drawn && seen.unbound === file.unbound, `${name}: the page counts ${seen.drawn} rows drawn and ${seen.unbound} not; the elements file has ${file.drawn} and ${file.unbound}`);
    need(seen.sceneRows === manifest['elements.bin'].rows && seen.points === seen.sceneRows, `${name}: the scene was given ${seen.sceneRows} rows and draws ${seen.points} points`);
  }
  const pictures = { epoch: epochEllipses.differs!, on: onEllipses.differs! };
  need(pictures.epoch.pixels === 0, `on the epoch ${pictures.epoch.pixels} pixels differ between the rows integrated and on their ellipses`);
  need(pictures.on.pixels > 1000, `the control passes: 50 years on, ${pictures.on.pixels} pixels differ`);

  // Three integrated rows drawn alone, a decade on and at the clock's
  // first day, against the crate's own place for each: integrated from
  // the epoch apart, not the scene's rows. A numbered asteroid's row is
  // its number less one.
  const ALONE = [
    { name: '153 Hilda', row: 152 },
    { name: '617 Patroclus', row: 616 },
    { name: '624 Hektor', row: 623 },
  ];
  const alone = [];
  // (In 1976 from this camera Hektor is under the title's text, which a
  // disc's center can't be read through: the camera is turned half round.)
  for (const [date, roll] of [['2036-06-09', '0'], ['1976-06-09', '180']] as const) {
    alone.push(
      ...(await withBelt(url, { ...top, roll, date, only: ALONE.map((body) => body.row).join(',') }, async (page) => {
        const png = await page.screenshot({ path: join(out, `integrated-alone-${date}.png`) });
        const { years, camera, places, ellipses, points, apart } = await kirkwood(page, (kirkwood) => {
          const years = kirkwood.clock().years;
          const rows = new URLSearchParams(location.search).get('only')!.split(',').map(Number);
          return { years, camera: kirkwood.scene!.viewProjection(), places: rows.map((row) => kirkwood.placeOf(row, years)), ellipses: rows.map((row) => kirkwood.ellipseOf(row, years)), points: kirkwood.scene!.stats.points, apart: kirkwood.scene!.stats.integrated };
        });
        need(points === ALONE.length && apart === ALONE.length, `${points} points drawn, ${apart} of them apart; ${ALONE.length} were asked for alone`);
        const expected = places.map((place) => project(camera, place));
        const found = await lit(page, png, expected);
        return ALONE.map((body, at) => {
          const [x, y] = expected[at]!;
          const off = Math.hypot(found[at]!.x - x, found[at]!.y - y);
          const [ellipseX, ellipseY] = project(camera, ellipses[at]!);
          const ellipseOff = Math.hypot(found[at]!.x - ellipseX, found[at]!.y - ellipseY);
          need(found[at]!.pixels > 20, `${body.name} on ${date}: no disc near (${round(x)}, ${round(y)})`);
          need(off <= 1, `${body.name} on ${date}: drawn ${off.toFixed(2)} px from the crate's integrated place (${round(x)}, ${round(y)})`);
          need(ellipseOff > 1, `${body.name} on ${date}: the control passes (${ellipseOff.toFixed(2)} px from its ellipse's place)`);
          return { body: body.name, date, years: fixed(years, 4), integratedPlacePx: [round(x), round(y)], drawnPx: [fixed(found[at]!.x), fixed(found[at]!.y)], offPx: fixed(off), fromItsEllipsePx: round(ellipseOff) };
        });
      })),
    );
  }

  // The turning frame at the clock's two ends and on the epoch: the
  // clouds and the triangle, integrated and on the ellipses.
  for (const date of ['1976-06-09', EPOCH, '2076-06-09']) {
    for (const [name, params] of [['integrated', {}], ['ellipses', ELLIPSES]] as const) {
      await withBelt(url, { date, paused: '', ride: '1', ...params }, async (page) => {
        await page.waitForTimeout(400);
        await shot(page, `${name}-${date.slice(0, 4)}`);
      });
    }
  }

  // What a jump costs: the clock's whole reach in one go (from the epoch
  // to an end is half of it), and a frame's places; then as the page
  // takes it, opened on the first day.
  const jump = await withBelt(url, { date: EPOCH, paused: '' }, (page) =>
    kirkwood(page, (kirkwood) => {
      const { first, last } = kirkwood.clock();
      const median = (values: number[]) => [...values].sort((a, b) => a - b)[values.length >> 1]!;
      const [back, on, across]: [number[], number[], number[]] = [[], [], []];
      for (let run = 0; run < 5; run++) {
        // From the epoch to the first day; back to the epoch (no steps:
        // the rows start over); to the last day; and from there to the
        // first, by way of the epoch.
        back.push(kirkwood.integratedJump(first)!.stepsMs);
        kirkwood.integratedJump(0);
        on.push(kirkwood.integratedJump(last)!.stepsMs);
        across.push(kirkwood.integratedJump(first)!.stepsMs);
        kirkwood.integratedJump(0);
      }
      const places = Array.from({ length: 40 }, (_, frame) => kirkwood.integratedJump(frame / 400)!.placesMs);
      const { step, rows, bytes } = kirkwood.integrated();
      return { rows, bytes, stepYears: step, steps: Math.ceil(-first / step), toTheFirstDayMs: median(back), toTheLastDayMs: median(on), lastDayToFirstMs: median(across), aFramesPlacesMs: median(places) };
    }),
  );
  const { page, close } = await open(chromium, url, { params: { date: '1976-06-09', paused: '' } });
  let caughtUp;
  try {
    const belt = await waitMark(page, BELT, 0, 120_000);
    caughtUp = await page.evaluate(
      (belt) =>
        new Promise<{ ms: number; frames: number }>((done) => {
          let frames = 0;
          const tick = (now: number) => {
            frames++;
            if ((globalThis as unknown as Page_).__kirkwood.scene!.stats.catchingUp) return void requestAnimationFrame(tick);
            done({ ms: now - belt, frames });
          };
          requestAnimationFrame(tick);
        }),
      belt,
    );
  } finally {
    await close();
  }
  return {
    rows: { hildas: file.hildas, trojans: file.trojans, drawnApart: epoch.apart },
    picture: { onTheEpochPixelsDiffering: pictures.epoch.pixels, fiftyYearsOnPixelsDiffering: pictures.on.pixels, of: pictures.on.of },
    alone,
    jump: { ...jump, stepMs: fixed(jump.toTheFirstDayMs / jump.steps, 3), toTheFirstDayMs: round(jump.toTheFirstDayMs), toTheLastDayMs: round(jump.toTheLastDayMs), lastDayToFirstMs: round(jump.lastDayToFirstMs), aFramesPlacesMs: fixed(jump.aFramesPlacesMs), openedOnTheFirstDay: { caughtUpAfterTheBeltMs: round(caughtUp.ms), frames: caughtUp.frames } },
    memory: { heldForTheRowsMB: mb(jump.bytes), wasmMB: mb(epoch.wasm), wasmOnEllipsesMB: mb(epochEllipses.wasm) },
  };
}

async function seeRide(url: string) {
  /** One reading of the page: what the scene last drew, and the crate's
   *  own numbers for the years it drew at. */
  const read = (page: Page) =>
    kirkwood(page, (kirkwood) => {
      const scene = kirkwood.scene!;
      const years = scene.stats.years;
      return {
        years,
        labels: scene.labels(),
        triangle: scene.triangle(),
        camera: scene.viewProjection(),
        distance: scene.stats.distance,
        frames: scene.stats.frames,
        jupiter: kirkwood.jupiter(years),
        points: kirkwood.ridePoints(years),
        aYearOn: kirkwood.ridePoints(years + 1),
        ride: kirkwood.ride(),
        flight: kirkwood.flight(),
        clock: kirkwood.clock(),
        scrim: kirkwood.scrim(),
      };
    });
  type Reading = Awaited<ReturnType<typeof read>>;
  const shown = (seen: Reading) => seen.labels.filter((label) => label.shown).map((label) => label.text);
  /** A place `ahead` degrees ahead of Jupiter, `au` from the Sun on the
   *  ecliptic, in the window. */
  const beside = (seen: Reading, ahead: number, au: number): [number, number] => {
    const toward = Math.atan2(seen.jupiter[1]!, seen.jupiter[0]!) + (ahead * Math.PI) / 180;
    return project(seen.camera, [au * Math.cos(toward), au * Math.sin(toward), 0]);
  };
  /** Board 2's furniture against the crate's three points, through the
   *  scene's camera: each name beside its point, each corner on it. */
  const furniture = (seen: Reading, what: string) => {
    const [sun, jupiter] = [project(seen.camera, [0, 0, 0]), project(seen.camera, seen.jupiter)];
    const corners = [0, 3, 6].map((point) => project(seen.camera, seen.points.slice(point, point + 3)));
    const control = [0, 3, 6].map((point) => project(seen.camera, seen.aYearOn.slice(point, point + 3)));
    const [ahead, behind, opposite] = corners as [[number, number], [number, number], [number, number]];
    const named = (text: string) => seen.labels.find((label) => label.text === text)!;
    const [held, aheadName, behindName, hildas] = [named(RIDE_TEXTS.held), named(RIDE_TEXTS.ahead), named(RIDE_TEXTS.behind), named(RIDE_TEXTS.hildas)];
    need(shown(seen).join() === ['Sol', ...Object.values(RIDE_TEXTS)].join(), `${what}: the names shown are ${shown(seen).join(' | ')}`);
    // Straight above: what's over the Sun is on it, and Jupiter is level
    // with it, to its right.
    const over = project(seen.camera, [0, 0, 3]);
    need(Math.hypot(over[0] - sun[0], over[1] - sun[1]) < 0.05, `${what}: 3 au over the Sun is at ${over.map(round)}, and the Sun at ${sun.map(round)}`);
    need(near(jupiter[1], sun[1], 0.5) && jupiter[0] > sun[0] + 200, `${what}: Jupiter is at ${jupiter.map(round)}, and the Sun at ${sun.map(round)}`);
    // The three points: 60° ahead (up, the way Jupiter goes), 60° behind,
    // and opposite.
    const degrees = corners.map(([x, y]) => (Math.atan2(sun[1] - y, x - sun[0]) * 180) / Math.PI);
    need(near(degrees[0]!, 60, 0.05) && near(degrees[1]!, -60, 0.05) && near(Math.abs(degrees[2]!), 180, 0.05), `${what}: the three points are ${degrees.map((degree) => degree.toFixed(2))}° from Jupiter's line`);
    // The names.
    need(near(held.left, jupiter[0] + 12, 1) && near(held.top + held.height / 2, jupiter[1], 1), `${what}: "${held.text}" at ${held.left}, ${held.top}; Jupiter at ${jupiter.map(round)}`);
    need(near(aheadName.left, ahead[0] + RIDE_NAMES.ahead[0], 1) && near(aheadName.top, ahead[1] + RIDE_NAMES.ahead[1], 1), `${what}: "${aheadName.text}" at ${aheadName.left}, ${aheadName.top}; its point at ${ahead.map(round)}`);
    need(near(behindName.left, behind[0] + RIDE_NAMES.behind[0], 1) && near(behindName.top, behind[1] + RIDE_NAMES.behind[1], 1), `${what}: "${behindName.text}" at ${behindName.left}, ${behindName.top}; its point at ${behind.map(round)}`);
    need(near(hildas.left + hildas.width, opposite[0] + RIDE_NAMES.hildas[0], 1) && near(hildas.top, opposite[1] + RIDE_NAMES.hildas[1], 1) && hildas.height > 30, `${what}: "${hildas.text}" at ${hildas.left}, ${hildas.top}, ${hildas.width} by ${hildas.height}; its point at ${opposite.map(round)}`);
    // The triangle: ahead, opposite, behind.
    const drawn = seen.triangle;
    need(!!drawn && drawn.length === 6, `${what}: no triangle is drawn`);
    const off = [ahead, opposite, behind].map(([x, y], corner) => Math.hypot(drawn![corner * 2]! - x, drawn![corner * 2 + 1]! - y));
    need(Math.max(...off) <= 0.2, `${what}: the triangle's corners are ${off.map((px) => px.toFixed(2))} px from the crate's points`);
    // The control: the points a year on, a twelfth of a turn round.
    const controlOff = [control[0]!, control[2]!, control[1]!].map(([x, y], corner) => Math.hypot(drawn![corner * 2]! - x, drawn![corner * 2 + 1]! - y));
    need(Math.min(...controlOff) > 1, `${what}: the control passes (${controlOff.map((px) => px.toFixed(1))} px from the points a year on)`);
    return { sunPx: sun.map(round), jupiterPx: jupiter.map(round), pointsPx: corners.map((corner) => corner.map(round)), trianglePx: drawn!, triangleOffPx: fixed(Math.max(...off)), controlOffPx: fixed(Math.min(...controlOff), 1), names: { held: [held.left, held.top], ahead: [aheadName.left, aheadName.top], behind: [behindName.left, behindName.top], hildas: [hildas.left, hildas.top, hildas.width, hildas.height] } };
  };
  /** A press on "Ride with Jupiter", to its end: the seconds it took. */
  const ridden = (page: Page, to: boolean): Promise<number> =>
    page.evaluate(
      (to) =>
        new Promise<number>((done) => {
          const kirkwood = (globalThis as unknown as Page_).__kirkwood;
          let from = NaN;
          const tick = (now: number) => {
            const ride = kirkwood.ride();
            if (ride.riding !== to) return void requestAnimationFrame(tick);
            if (Number.isNaN(from)) from = now;
            if (ride.flying) return void requestAnimationFrame(tick);
            done((now - from) / 1000);
          };
          requestAnimationFrame(tick);
        }),
      to,
    );
  /** Both actions at rest, and a frame drawn since. */
  const atRest = async (page: Page) => {
    await page.waitForFunction(() => {
      const kirkwood = (globalThis as unknown as Page_).__kirkwood;
      return !kirkwood.ride().flying && !kirkwood.flight().flying;
    });
    // Off the actions: under the pointer a fill is the hover's.
    await page.mouse.move(700, 600);
    await page.waitForTimeout(500);
    await settle(page);
  };
  /** The title's lines' text, as pixels: the line about the stars among them or not. */
  const titleText = async (page: Page, png: Buffer, scrim: number[]) => {
    const [x, y, width, height] = scrim as [number, number, number, number];
    return textPixels(page, png, { x, y, width, height });
  };

  // The ride held on the epoch, for board 2: its furniture, and the groups.
  const held = await withSky(url, { ...HELD, ride: '1' }, async (page) => {
    await page.waitForTimeout(400);
    const seen = await read(page);
    const png = await page.screenshot();
    await shot(page, 'ride');
    need(seen.ride.turned === 1 && seen.ride.riding && !seen.ride.flying, `held, the ride is ${JSON.stringify(seen.ride)}`);
    const placed = furniture(seen, 'held');
    // Against the board: the Sun in the middle, and Jupiter's name beside
    // a Jupiter within its orbit's quarter of an au of the board's circle.
    need(near(placed.sunPx[0]!, BOARD_RIDE.sun[0]!, 0.5) && near(placed.sunPx[1]!, BOARD_RIDE.sun[1]!, 0.5), `the Sun is at ${placed.sunPx}, and board 2 has it at ${BOARD_RIDE.sun}`);
    need(near(placed.names.held[0]!, BOARD_RIDE.jupiterName[0]!, 20) && near(placed.names.held[1]!, BOARD_RIDE.jupiterName[1]!, 1), `"${RIDE_TEXTS.held}" is at ${placed.names.held}, and board 2 has it at ${BOARD_RIDE.jupiterName}`);
    // The groups lit are the file's own.
    const [counts, counted] = [await kirkwood(page, (kirkwood) => kirkwood.rideCounts()), countGroups()];
    need(counts.hildas === counted.hildas && counts.trojans === counted.trojans && counted.hildas === 8400 && counted.trojans === 16472, `the page lights ${JSON.stringify(counts)}, and the file's bytes hold ${JSON.stringify(counted)}`);
    // And they read: each Trojan cloud against Jupiter's orbit a third of
    // a turn from it, where nothing holds; the Hildas' corner opposite
    // Jupiter against the same distance a third of a turn round, which
    // their triangle's side passes inside of.
    const box = ([x, y]: [number, number]) => light(page, png, { x: x - 20, y: y - 20, width: 40, height: 40 });
    const a = Math.hypot(seen.points[0]!, seen.points[1]!);
    const [ahead, behind, empty, corner, side] = await Promise.all([box(beside(seen, 60, a)), box(beside(seen, -60, a)), box(beside(seen, 120, a)), box(beside(seen, 180, 4.35)), box(beside(seen, 120, 4.35))]);
    need(ahead! > empty! + 4 && behind! > empty! + 4, `the Trojans' clouds read ${ahead!.toFixed(1)} and ${behind!.toFixed(1)} of 255, and their orbit a third of a turn from Jupiter ${empty!.toFixed(1)}`);
    need(corner! > side! + 2, `the Hildas' far corner reads ${corner!.toFixed(1)} of 255, and the same distance a third of a turn round ${side!.toFixed(1)}`);
    // The sky is gone from the turned frame: a corner of the window, past
    // every orbit drawn, is the page's own color (a mean of 7, and the grain).
    const sky = await light(page, png, { x: 1240, y: 20, width: 180, height: 120 });
    need(sky < 9, `a corner of the turned frame reads ${sky.toFixed(1)} of 255: the sky hasn't left`);
    return { ...placed, board: BOARD_RIDE, distanceAu: fixed(seen.distance), groups: counts, light: { trojansAhead: fixed(ahead!, 1), trojansBehind: fixed(behind!, 1), theirOrbitAThirdRound: fixed(empty!, 1), hildasFarCorner: fixed(corner!, 1), itsDistanceAThirdRound: fixed(side!, 1), skyCorner: fixed(sky, 1) } };
  });

  // The press, with time running: Jupiter holds still over one of its
  // orbits; the press back; and the two actions together.
  const pressed = await withSky(url, { date: EPOCH }, async (page) => {
    const space = await read(page);
    const spacePng = await page.screenshot();
    const spaceText = await titleText(page, spacePng, space.scrim);
    need(!space.ride.riding && space.ride.turned === 0 && shown(space).join() === 'Sol,Jupiter' && !space.triangle, `before the press: the ride ${JSON.stringify(space.ride)}, the names ${shown(space).join()}`);
    const spaceFills = await actionFills(page);
    need(spaceFills.ride === spaceFills.sort, `not pressed, the two actions' fills read ${JSON.stringify(spaceFills)}`);
    let way = ridden(page, true);
    await clickTarget(page, 'ride');
    const out_ = await way;
    await atRest(page);
    need(near(out_, 2, 0.25), `the camera's flight took ${out_.toFixed(2)} s`);
    // Each second over one of Jupiter's orbits (11.86 years, at a year a
    // second): Jupiter through the scene's camera, and a point that
    // doesn't turn (5 au out at longitude 0), which the frame turns.
    const samples: { years: number; offLine: number; along: number; fixedAt: number; longitude: number }[] = [];
    let first: Reading | undefined;
    for (;;) {
      const seen = await read(page);
      first ??= seen;
      const [sun, jupiter, still] = [project(seen.camera, [0, 0, 0]), project(seen.camera, seen.jupiter), project(seen.camera, [5, 0, 0])];
      samples.push({ years: seen.years, offLine: jupiter[1] - sun[1], along: jupiter[0] - sun[0], fixedAt: Math.atan2(sun[1] - still[1], still[0] - sun[0]), longitude: Math.atan2(seen.jupiter[1]!, seen.jupiter[0]!) });
      if (samples.length === 4) {
        furniture(seen, 'riding, time running');
        await shot(page, 'ride-running');
      }
      if (seen.years - first.years >= 11.87) break;
      need(samples.length < 40 && seen.clock.running, `riding, the clock is ${JSON.stringify(seen.clock)} after ${samples.length} readings`);
      await page.waitForTimeout(1000);
    }
    const offLine = Math.max(...samples.map((sample) => Math.abs(sample.offLine)));
    const along = samples.map((sample) => sample.along);
    need(offLine < 0.5, `Jupiter left its line from the Sun by ${offLine.toFixed(2)} px`);
    // The frame turned by Jupiter's own longitude: the point that doesn't
    // turn went round the other way by as much.
    const turn = (angles: number[]) => angles.slice(1).reduce((sum, angle, at) => sum + Math.atan2(Math.sin(angle - angles[at]!), Math.cos(angle - angles[at]!)), 0);
    const [turned, went] = [turn(samples.map((sample) => sample.fixedAt)), turn(samples.map((sample) => sample.longitude))].map((radians) => (radians * 180) / Math.PI) as [number, number];
    need(went > 355 && near(turned, -went, 0.05), `over ${(samples.at(-1)!.years - samples[0]!.years).toFixed(2)} years Jupiter went ${went.toFixed(2)}° round, and the frame turned a fixed point ${turned.toFixed(2)}°`);
    // The sky is gone (a corner of the window is the page's own color),
    // the page says what the turned frame brightens where it spoke of the
    // stars, and the action is pressed.
    const riding = await read(page);
    const ridingPng = await page.screenshot();
    const ridingText = await titleText(page, ridingPng, riding.scrim);
    const skyCorner = await light(page, ridingPng, { x: 1240, y: 20, width: 180, height: 120 });
    need(skyCorner < 9, `riding, a corner of the window reads ${skyCorner.toFixed(1)} of 255: the sky hasn't left`);
    need(ridingText > spaceText - 2500 && ridingText !== spaceText, `the title's lines are ${ridingText} text pixels riding and ${spaceText} in the fixed frame: nothing is said of the brightened groups`);
    const { ride: ridePressed, sort: sortBeside } = await actionFills(page);
    need(near(ridePressed, 250, 4) && near(sortBeside, 38, 4), `riding, the actions' fills read ${ridePressed} (ride) and ${sortBeside} (sort) of 255, and the boards draw 250 and 38`);
    // A wheel, riding, moves the ride's own camera.
    await page.mouse.move(500, 450);
    await wheel(page, 300);
    await page.waitForTimeout(300);
    const wheeled = await read(page);
    need(wheeled.distance > riding.distance * 1.2, `a wheel, riding, moved the camera from ${riding.distance} au to ${wheeled.distance}`);

    // The press back: the fixed frame, and the first camera.
    way = ridden(page, false);
    await clickTarget(page, 'ride');
    const back_ = await way;
    await atRest(page);
    const back = await read(page);
    const backPng = await page.screenshot();
    await shot(page, 'ride-back');
    need(near(back_, 2, 0.25), `the camera's flight back took ${back_.toFixed(2)} s`);
    need(!back.ride.riding && back.ride.turned === 0 && shown(back).join() === 'Sol,Jupiter' && !back.triangle, `back: the ride ${JSON.stringify(back.ride)}, the names ${shown(back).join(' | ')}`);
    const cameraOff = Math.max(...back.camera.map((cell, at) => Math.abs(cell - space.camera[at]!)));
    need(cameraOff < 1e-9 && back.distance === space.distance, `back, the camera is ${cameraOff} off the first, ${back.distance} au out for ${space.distance}`);
    need(back.clock.running && back.clock.years > riding.clock.years, `back, the clock is ${JSON.stringify(back.clock)}`);
    const backText = await titleText(page, backPng, back.scrim);
    need(near(backText, spaceText, 60), `the title's lines are ${backText} text pixels back in the fixed frame and were ${spaceText}`);
    // The fixed frame doesn't turn: over a second the point that doesn't
    // turn stays put.
    await page.waitForTimeout(1000);
    const later = await read(page);
    const stayed = Math.hypot(...project(later.camera, [5, 0, 0]).map((px, at) => px - project(back.camera, [5, 0, 0])[at]!));
    need(later.years > back.years + 0.5 && stayed < 1e-6, `back in the fixed frame, a fixed point moved ${stayed} px in ${(later.years - back.years).toFixed(2)} years`);

    // The two actions together. Riding again (the wheel's zoom forgotten),
    // then "Sort by orbit size": the frame stops turning as the dots leave.
    way = ridden(page, true);
    await clickTarget(page, 'ride');
    await way;
    await atRest(page);
    const again = await read(page);
    need(near(again.distance, riding.distance, 1e-9), `riding again, the camera is ${again.distance} au up, and was ${riding.distance}`);
    await clickTarget(page, 'sort');
    await page.waitForTimeout(1000);
    await shot(page, 'ride-to-sort');
    await atRest(page);
    const sorted = await read(page);
    const sortedPng = await page.screenshot();
    await shot(page, 'ride-then-sort');
    need(sorted.flight.progress === 1 && sorted.flight.sorted && sorted.ride.turned === 0 && !sorted.ride.riding, `sorted from the ride: the flight ${JSON.stringify(sorted.flight)}, the ride ${JSON.stringify(sorted.ride)}`);
    need(!sorted.clock.running, `sorted from the ride, the clock is ${JSON.stringify(sorted.clock)}`);
    need(!shown(sorted).length && !sorted.triangle, `sorted from the ride: the names ${shown(sorted).join(' | ')}, the triangle ${sorted.triangle}`);
    const sortedFills = await actionFills(page);
    need(near(sortedFills.sort, 250, 4) && near(sortedFills.ride, 38, 4), `sorted from the ride, the actions' fills read ${JSON.stringify(sortedFills)} of 255`);
    const axisSorted = await light(page, sortedPng, { x: 700, y: 771, width: 8, height: 1 });
    need(near(axisSorted, AXIS_LIGHT, 8), `sorted from the ride, the a axis reads ${axisSorted.toFixed(1)} of 255`);
    // Landed, the scene draws nothing.
    await page.waitForTimeout(1000);
    const still = (await read(page)).frames - sorted.frames;
    need(still === 0, `sorted from the ride, the scene drew ${still} frames in a second`);

    // Then "Ride with Jupiter" while sorted: the dots fly back as the
    // frame starts to turn, and time runs again.
    await clickTarget(page, 'ride');
    await page.waitForTimeout(1000);
    await shot(page, 'sort-to-ride');
    await atRest(page);
    const rode = await read(page);
    const rodePng = await page.screenshot();
    await shot(page, 'sort-then-ride');
    need(rode.flight.progress === 0 && !rode.flight.sorted && rode.ride.turned === 1 && rode.ride.riding, `riding from the sort: the flight ${JSON.stringify(rode.flight)}, the ride ${JSON.stringify(rode.ride)}`);
    need(rode.clock.running && rode.clock.years > sorted.clock.years, `riding from the sort, the clock is ${JSON.stringify(rode.clock)}`);
    furniture(rode, 'riding from the sort');
    const rodeFills = await actionFills(page);
    need(near(rodeFills.sort, 38, 4) && near(rodeFills.ride, 250, 4), `riding from the sort, the actions' fills read ${JSON.stringify(rodeFills)} of 255`);
    const axisRode = await light(page, rodePng, { x: 700, y: 771, width: 8, height: 1 });
    need(axisRode < 30, `riding from the sort, where the a axis was reads ${axisRode.toFixed(1)} of 255`);
    return {
      flightSeconds: { out: fixed(out_), back: fixed(back_) },
      jupiter: {
        years: fixed(samples.at(-1)!.years - samples[0]!.years),
        readings: samples.length,
        offItsLinePx: fixed(offLine, 3),
        alongItsLinePx: { least: fixed(Math.min(...along), 1), most: fixed(Math.max(...along), 1), moved: fixed(Math.max(...along) - Math.min(...along), 1) },
        wentRoundDegrees: fixed(went),
        frameTurnedAFixedPointDegrees: fixed(turned),
      },
      distanceAu: { fixed: fixed(space.distance), riding: fixed(riding.distance), ridingAfterAWheel: fixed(wheeled.distance), back: fixed(back.distance), ridingAgain: fixed(again.distance) },
      cameraBackOff: cameraOff,
      titleTextPixels: { fixed: spaceText, riding: ridingText, back: backText },
      actionFills: { riding: { ride: ridePressed, sort: sortBeside }, sortedFromTheRide: sortedFills, ridingFromTheSort: rodeFills },
      together: {
        sortedFromTheRide: { flight: sorted.flight, ride: sorted.ride, clockRunning: sorted.clock.running, names: shown(sorted), sceneFramesInASecond: still },
        ridingFromTheSort: { flight: rode.flight, ride: rode.ride, clockRunning: rode.clock.running, names: shown(rode) },
      },
    };
  });
  return { held, pressed };
}

// --- A gap picked.

/** Board 5, at 1440×900: the card's left and width, how far under the
 *  title's lines it starts (its own card is 20 px under its title's), the
 *  marker's name from the marker, and the marker's dot and ring. */
const BOARD_GAP = { card: { left: 24, width: 300, underTitle: 20 }, name: [16, -26], dot: 4, ring: 9 };
const GAPS = [
  { name: '3:1', turns: 3, jupiters: 1 },
  { name: '5:2', turns: 5, jupiters: 2 },
  { name: '7:3', turns: 7, jupiters: 3 },
  { name: '2:1', turns: 2, jupiters: 1 },
];
const CARD_CHIPS = ['card-chip-0', 'card-chip-1', 'card-chip-2', 'card-chip-3'];
const MARKER_TEXT = 'the marker';
/** Jupiter's own orbit, as JPL Horizons gave it (`data/horizons.json`):
 *  its a (au) and its mean motion (degrees a day); and the clock's year. */
const JUPITER = (JSON.parse(readFileSync(join(dir, '../data/horizons.json'), 'utf8')) as { jupiter: { elements: { a: number; n: number } } }).jupiter.elements;
const YEAR_DAYS = 365.2568983263;

/** How far a place is from a closed line through `path`'s places (x and y
 *  of each), in the path's own units. */
function fromPath(path: number[], [x, y]: [number, number]): number {
  let nearest = Infinity;
  for (let at = 0; at < path.length; at += 2) {
    const [ax, ay, bx, by] = [path[at]!, path[at + 1]!, path[(at + 2) % path.length]!, path[(at + 3) % path.length]!];
    const [dx, dy] = [bx - ax, by - ay];
    const along = Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
    nearest = Math.min(nearest, Math.hypot(x - ax - along * dx, y - ay - along * dy));
  }
  return nearest;
}

async function seeGap(url: string) {
  const read = (page: Page) =>
    kirkwood(page, (kirkwood) => {
      const scene = kirkwood.scene!;
      const years = scene.stats.years;
      const gap = kirkwood.gap();
      const numbers = kirkwood.gapNumbers(gap.marker);
      return {
        years,
        gap,
        numbers,
        card: kirkwood.gapCard(gap.marker),
        labels: scene.labels(),
        triangle: scene.triangle(),
        marker: scene.marker(),
        camera: scene.viewProjection(),
        points: scene.stats.points,
        frames: scene.stats.frames,
        jupiter: kirkwood.jupiter(years),
        place: kirkwood.gapPlace(gap.marker, years),
        // The marker and Jupiter along the path: eight moments of the
        // years it closes in, then where it closes, and one of Jupiter's
        // orbits on.
        along: [0, 1, 2, 3, 4, 5, 6, 7, 8].map((eighth) => years + (numbers.closesIn * eighth) / 8).concat(years + numbers.jupiter).map((at) => ({ place: kirkwood.gapPlace(gap.marker, at), jupiter: kirkwood.jupiter(at) })),
        ride: kirkwood.ride(),
        flight: kirkwood.flight(),
        clock: kirkwood.clock(),
        belt: kirkwood.belt(),
        scrim: kirkwood.scrim(),
      };
    });
  type Reading = Awaited<ReturnType<typeof read>>;
  const shown = (seen: Reading) => seen.labels.filter((label) => label.shown).map((label) => label.text);
  /** A place at another time, as the frame that turns with Jupiter shows
   *  it now: turned back by Jupiter's longitude then, and on by its
   *  longitude now, through the scene's camera. */
  const turned = (seen: Reading, moment: { place: number[]; jupiter: number[] }): [number, number] => {
    const by = Math.atan2(seen.jupiter[1]!, seen.jupiter[0]!) - Math.atan2(moment.jupiter[1]!, moment.jupiter[0]!);
    const [x, y] = [moment.place[0]!, moment.place[1]!];
    return project(seen.camera, [x * Math.cos(by) - y * Math.sin(by), x * Math.sin(by) + y * Math.cos(by), 0]);
  };
  /** What board 5 adds, against the crate's own numbers through the
   *  scene's camera: the marker on its place and on its path, the path
   *  closed, its name, and the card. */
  const marked = async (page: Page, seen: Reading, gap: number, what: string) => {
    const { name, turns, jupiters } = GAPS[gap]!;
    need(seen.gap.picked && seen.gap.marker === gap && seen.gap.lit === 1 && !seen.gap.moving, `${what}: the gap is ${JSON.stringify(seen.gap)}`);
    need(seen.ride.turned === 1 && seen.ride.riding && seen.flight.progress === 0 && !seen.flight.sorted, `${what}: the ride ${JSON.stringify(seen.ride)}, the flight ${JSON.stringify(seen.flight)}`);
    // Board 5's names: the Sun's, Jupiter's, and the marker's. The two
    // groups' names and the triangle have left.
    need(shown(seen).join() === ['Sol', RIDE_TEXTS.held, MARKER_TEXT].join() && !seen.triangle, `${what}: the names shown are ${shown(seen).join(' | ')}, the triangle ${seen.triangle}`);
    const drawn = seen.marker;
    need(!!drawn && drawn.path.length === 2 * 480 * jupiters, `${what}: the marker drawn is ${drawn ? `${drawn.path.length / 2} places of a path` : 'none'}`);
    const at = project(seen.camera, seen.place);
    const off = Math.hypot(drawn!.x - at[0], drawn!.y - at[1]);
    need(off < 0.2, `${what}: the marker is drawn ${off.toFixed(2)} px from the crate's place for it, ${at.map(round)}`);
    // On its path now, and at eight moments of the years the path closes in.
    const onPath = Math.max(fromPath(drawn!.path, [drawn!.x, drawn!.y]), ...seen.along.slice(0, 9).map((moment) => fromPath(drawn!.path, turned(seen, moment))));
    need(onPath < 0.5, `${what}: the marker is ${onPath.toFixed(2)} px off its path at worst`);
    // The path closes: after as many of Jupiter's orbits as the ratio
    // counts the marker is where it began, and (the control) after one
    // of them only where the ratio counts one.
    const [begins, ends, afterOne] = [turned(seen, seen.along[0]!), turned(seen, seen.along[8]!), turned(seen, seen.along[9]!)];
    const [closes, one] = [Math.hypot(ends[0] - begins[0], ends[1] - begins[1]), Math.hypot(afterOne[0] - begins[0], afterOne[1] - begins[1])];
    need(closes < 1, `${what}: the path ends ${closes.toFixed(3)} px from where it began`);
    need(one < 1 === (jupiters === 1), `${what}: after one of Jupiter's orbits the marker is ${one.toFixed(1)} px from where it began`);
    // The line drawn has no break: every step is a short one, the last
    // to the first among them.
    const step = Math.max(...Array.from({ length: drawn!.path.length / 2 }, (_, place) => Math.hypot(drawn!.path[(2 * place + 2) % drawn!.path.length]! - drawn!.path[2 * place]!, drawn!.path[(2 * place + 3) % drawn!.path.length]! - drawn!.path[2 * place + 1]!)));
    need(step < 12, `${what}: the path's longest step is ${step.toFixed(1)} px`);
    // Its name, as board 5 has it.
    const named = seen.labels.find((label) => label.text === MARKER_TEXT)!;
    need(near(named.left, drawn!.x + BOARD_GAP.name[0]!, 1) && near(named.top, drawn!.y + BOARD_GAP.name[1]!, 1), `${what}: "${MARKER_TEXT}" at ${named.left}, ${named.top}; the marker at ${[drawn!.x, drawn!.y].map(round)}`);
    // White, and plainly not a dot: its middle, and its ring's radius.
    const png = await page.screenshot();
    const middle = await pixelsOf(page, png, { x: Math.round(drawn!.x) - 1, y: Math.round(drawn!.y) - 1, width: 2, height: 2 }, (pixels) => [pixels[0]!, pixels[1]!, pixels[2]!]);
    // (Read on a held clock: with time running the marker has moved on
    // by the screenshot.)
    need(seen.clock.running || Math.min(...middle) > 225, `${what}: the marker's middle reads ${middle}, and it's drawn white`);
    // The card: under the title's lines, its numbers Jupiter's own
    // (JPL's a and mean motion for it, worked out here).
    const card = await targetRect(page, 'gap-card', 5_000);
    const under = seen.scrim[1]! + seen.scrim[3]! + BOARD_GAP.card.underTitle;
    need(near(card[0], BOARD_GAP.card.left, 0.5) && near(card[2], BOARD_GAP.card.width, 0.5) && near(card[1], Math.max(104, under), 0.5), `${what}: the card is at ${rounded(card)}, and the title's lines end at ${round(under - BOARD_GAP.card.underTitle)}`);
    const jupiterYears = 360 / JUPITER.n / YEAR_DAYS;
    const worked = [`${name} with Jupiter`, `Orbit size ${(JUPITER.a * (jupiters / turns) ** (2 / 3)).toFixed(2)} au`, `One orbit ${((jupiterYears * jupiters) / turns).toFixed(2)} years`, `Jupiter's orbit ${jupiterYears.toFixed(2)} years`];
    need([seen.card[0], ...seen.card.slice(2)].join(' | ') === worked.join(' | '), `${what}: the card says ${seen.card.join(' | ')}, and Jupiter's orbit gives ${worked.join(' | ')}`);
    // Its chips: the picked one's fill is lit, the others' the card's.
    const fills = await Promise.all(CARD_CHIPS.map(async (id) => {
      const [x, y] = await targetRect(page, id, 5_000);
      return light(page, png, { x: x + 3, y: y + 3, width: 3, height: 3 });
    }));
    need(fills.every((fill, chip) => (chip === gap ? fill > 30 : fill < 22)), `${what}: the card's chips' fills read ${fills.map((fill) => fill.toFixed(0))} of 255, the ${name} picked`);
    // In no count: the page's rows and the scene's points are the file's.
    need(seen.belt.drawn + seen.belt.unbound === manifest['elements.bin'].rows && seen.points === manifest['elements.bin'].rows, `${what}: the page counts ${JSON.stringify(seen.belt)}, the scene draws ${seen.points} points, and the file has ${manifest['elements.bin'].rows} rows`);
    return { markerPx: [drawn!.x, drawn!.y].map(round), offItsPlacePx: fixed(off), offItsPathPx: fixed(onPath), pathPlaces: drawn!.path.length / 2, pathEndsFromItsStartPx: fixed(closes, 4), afterOneOfJupitersOrbitsPx: fixed(one, 1), longestStepPx: fixed(step, 1), markerMiddle: middle, cardPx: rounded(card), card: seen.card, cardChipsLight: fills.map((fill) => fixed(fill, 1)), e: seen.numbers.e };
  };
  /** The main belt's light: a box 2.7 au from the Sun, a quarter turn
   *  ahead of Jupiter, clear of every path. */
  const beltLight = async (page: Page, seen: Reading) => {
    const toward = Math.atan2(seen.jupiter[1]!, seen.jupiter[0]!) + Math.PI / 2;
    const [x, y] = project(seen.camera, [2.7 * Math.cos(toward), 2.7 * Math.sin(toward), 0]);
    return light(page, await page.screenshot(), { x: x - 20, y: y - 20, width: 40, height: 40 });
  };
  const atRest = async (page: Page) => {
    await page.waitForFunction(() => {
      const kirkwood = (globalThis as unknown as Page_).__kirkwood;
      return !kirkwood.ride().flying && !kirkwood.flight().flying && !kirkwood.gap().moving;
    });
    await page.mouse.move(700, 700);
    await page.waitForTimeout(500);
    await settle(page);
  };

  // Each gap held picked on the epoch: a screenshot each, the 3:1's for
  // board 5.
  const held: Record<string, Awaited<ReturnType<typeof marked>>> = {};
  for (const [gap, { name }] of GAPS.entries()) {
    held[name] = await withSky(url, { ...HELD, ride: '1', gap: String(gap) }, async (page) => {
      await page.waitForTimeout(400);
      const seen = await read(page);
      await shot(page, `gap-${name.replace(':', '-')}`);
      return marked(page, seen, gap, `the ${name} held`);
    });
  }
  // The ride's own light, for the dim to be set against.
  const plain = await withSky(url, { ...HELD, ride: '1' }, async (page) => beltLight(page, await read(page)));
  const dimmed = await withSky(url, { ...HELD, ride: '1', gap: '0' }, async (page) => beltLight(page, await read(page)));
  need(dimmed < plain - 1, `the main belt reads ${dimmed.toFixed(1)} of 255 with a gap picked, and ${plain.toFixed(1)} riding with none`);

  // The presses, with time running.
  const pressed = await withSky(url, { date: EPOCH }, async (page) => {
    // From the landed layout: a press on the 3:1's chip.
    await clickTarget(page, 'sort');
    await atRest(page);
    const landed = await read(page);
    need(landed.flight.progress === 1 && !landed.gap.picked && !landed.marker, `landed: the flight ${JSON.stringify(landed.flight)}, the gap ${JSON.stringify(landed.gap)}`);
    await clickTarget(page, 'chip-0');
    await page.waitForTimeout(1000);
    await shot(page, 'gap-picking');
    await atRest(page);
    const picked = await read(page);
    await shot(page, 'gap-picked');
    const first = await marked(page, picked, 0, 'the 3:1 picked from the landed layout');
    need(picked.clock.running && picked.clock.years > landed.clock.years, `picked, the clock is ${JSON.stringify(picked.clock)}`);
    const fills = await actionFills(page);
    need(near(fills.ride, 250, 4) && near(fills.sort, 38, 4), `picked, the actions' fills read ${JSON.stringify(fills)} of 255, and board 5 draws 250 (ride) and 38`);
    // The marker goes along its path as time runs.
    const moved: number[] = [];
    for (let reading = 0; reading < 4; reading++) {
      await page.waitForTimeout(700);
      const seen = await read(page);
      need(!!seen.marker, 'riding with a gap picked, no marker is drawn');
      const at = project(seen.camera, seen.place);
      need(Math.hypot(seen.marker!.x - at[0], seen.marker!.y - at[1]) < 0.2 && fromPath(seen.marker!.path, [seen.marker!.x, seen.marker!.y]) < 0.5, `time running, the marker at ${[seen.marker!.x, seen.marker!.y].map(round)} is off its place ${at.map(round)} or its path`);
      moved.push(Math.hypot(seen.marker!.x - picked.marker!.x, seen.marker!.y - picked.marker!.y));
    }
    need(Math.max(...moved) > 20, `in three seconds the marker moved ${moved.map(round)} px`);
    // A press on another chip in the card moves the marker there.
    await clickTarget(page, 'card-chip-3');
    await atRest(page);
    const other = await read(page);
    await shot(page, 'gap-moved');
    const second = await marked(page, other, 3, 'the 2:1 picked in the card');
    // A press on the picked chip lets the marker go: the ride as board 2
    // has it, its two groups' names and its triangle back.
    await clickTarget(page, 'card-chip-3');
    await atRest(page);
    const let_ = await read(page);
    need(!let_.gap.picked && let_.gap.lit === 0 && !let_.marker && let_.ride.riding && let_.ride.turned === 1, `let go: the gap ${JSON.stringify(let_.gap)}, the ride ${JSON.stringify(let_.ride)}`);
    need(shown(let_).join() === ['Sol', ...Object.values(RIDE_TEXTS)].join() && !!let_.triangle, `let go: the names shown are ${shown(let_).join(' | ')}`);
    // "Ride with Jupiter" pressed back with a gap picked lets it go: the
    // next ride has no marker.
    await clickTarget(page, 'sort');
    await atRest(page);
    await clickTarget(page, 'chip-1');
    await atRest(page);
    const again = await read(page);
    need(again.gap.picked && again.gap.marker === 1 && !!again.marker, `the 5:2 picked: ${JSON.stringify(again.gap)}`);
    await clickTarget(page, 'ride');
    await atRest(page);
    const back = await read(page);
    need(!back.gap.picked && !back.marker && !back.ride.riding && shown(back).join() === 'Sol,Jupiter', `back in the fixed frame: the gap ${JSON.stringify(back.gap)}, the names ${shown(back).join(' | ')}`);
    await clickTarget(page, 'ride');
    await atRest(page);
    const rode = await read(page);
    need(!rode.gap.picked && !rode.marker && rode.ride.riding && shown(rode).join() === ['Sol', ...Object.values(RIDE_TEXTS)].join(), `riding again: the gap ${JSON.stringify(rode.gap)}, the names ${shown(rode).join(' | ')}`);
    // And "Sort by orbit size" pressed with a gap picked: the marker
    // leaves with the frame it's drawn in.
    await clickTarget(page, 'sort');
    await atRest(page);
    // (Pressed twice, as a double click would: the chip is still under
    // the pointer as it fades, and its second press picks the gap again.
    // Only the card's picked chip lets a gap go.)
    await clickTarget(page, 'chip-2');
    await page.waitForTimeout(120);
    await clickTarget(page, 'chip-2');
    await atRest(page);
    const twice = await read(page);
    need(twice.gap.picked && twice.gap.marker === 2 && !!twice.marker, `the 7:3's chip pressed twice: ${JSON.stringify(twice.gap)}`);
    await clickTarget(page, 'sort');
    await atRest(page);
    const sorted = await read(page);
    need(!sorted.gap.picked && !sorted.marker && sorted.flight.progress === 1 && !sorted.ride.riding && !shown(sorted).length, `sorted with a gap picked: the gap ${JSON.stringify(sorted.gap)}, the flight ${JSON.stringify(sorted.flight)}, the names ${shown(sorted).join(' | ')}`);
    // And "Ride with Jupiter" pressed back and pressed again before the
    // camera is back: the gap doesn't return with the ride.
    await clickTarget(page, 'chip-1');
    await atRest(page);
    await clickTarget(page, 'ride');
    await page.waitForTimeout(600);
    await clickTarget(page, 'ride');
    await atRest(page);
    const returned = await read(page);
    need(!returned.gap.picked && returned.gap.lit === 0 && !returned.marker && returned.ride.riding && returned.ride.turned === 1 && shown(returned).join() === ['Sol', ...Object.values(RIDE_TEXTS)].join(), `the ride pressed back and again mid-flight: the gap ${JSON.stringify(returned.gap)}, the names ${shown(returned).join(' | ')}`);
    return { pickedFromTheLandedLayout: first, movedInTheCard: second, markerMovedPx: moved.map(round), actionFills: fills };
  });
  return { held, beltLight: { riding: fixed(plain, 1), aGapPicked: fixed(dimmed, 1) }, pressed, board: BOARD_GAP };
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
  if (ONLY.has('camera')) seen.camera = await seeCamera(server.url);
  if (ONLY.has('sort')) seen.sort = await seeSort(server.url);
  if (ONLY.has('ride')) seen.ride = await seeRide(server.url);
  if (ONLY.has('gap')) seen.gap = await seeGap(server.url);
  if (ONLY.has('integrated')) seen.integrated = await seeIntegrated(server.url);
  if (ONLY.has('rate')) seen.rate = await seeRate(server.url);
  if (ONLY.has('drag')) seen.drag = await seeDrag(server.url);
  if (ONLY.has('slow')) seen.slow = await seeSlow(server.url);
  if (ONLY.has('cross')) seen.cross = await seeCross(server.url);
  writeFileSync(join(out, ENGINE === chromium ? 'seen.json' : `seen-${BROWSER}.json`), `${JSON.stringify(seen, null, 2)}\n`);
  console.log(JSON.stringify(seen, null, 2));
} finally {
  await server.close();
}
