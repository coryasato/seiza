// `sort` in the bare host: a click on a column's arrow, through its cycle,
// to the first presented frame drawing the new order's arrow (the table's
// own work: the source's call, the cache forgotten, the view at the top),
// and to the first presented frame there with every row real. Per shape
// (the narrow shape's `H`, the wide's first column), cold, a fresh browser
// each session, median of `--runs`:
//
// - unheld: reads answered at once, so → filled is the table's and the
//   source's materializing of the new order's pages;
// - quiet (`?delay=<--delay>`): each read held, nothing out at the click,
//   so → filled adds a read's time;
// - held (`?delay` too): three wheels to rows no page holds, a read sent and
//   then cancelled at each but the last, so three reads are out at the
//   click (`max_in_flight`), and the new order's top page waits for the
//   first to drain: → filled against the quiet's is that wait.
//
// The column's order is computed before the clicks (its whole cycle sorted
// once through the host's hook: the source sorts on the main thread, at a
// direction's first sort), so each click is the order's swap and not its
// computation. The click's time is its `pointerup`'s timestamp; the frames
// are `presentedRecorder`'s, each with the host's `__seizaFrameSample`
// (the probe's `sort` among it); `tall-table:sorted` is set in the click's
// task once the table has changed its order. The source counts the reads it
// was cancelled in flight (the host's `__tallTableDrained`), so a held
// click's drained reads are counted.
//
// Usage: node components/tall-table/perf/sort.ts [--runs 10] [--shape narrow|wide]
//          [--profile reference|throttled] [--cycles 3] [--delay 200] [--label <name>]
// --label writes perf/results/<date>-<label>.json. Run
// `just tall-table build sort` first.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright';
import { open, presentedRecorder, waitMark, wheel, type RecordedFrame } from '../../../shared-web/perf/harness.ts';
import { PROFILES, localDate, machineInfo, median, option, type Profile } from '../../../shared-web/perf/protocol.ts';
import { serveApp } from '../../../shared-web/perf/serve.ts';
import { FILLED_MARK, PORT, SHAPES, SORTED_COLUMN, SORTED_MARK, arrowAt, buildName, builtFeatures, drainedReads, filledWhere, hostWebDir, perfDir, pick, shown, sortThrough, type Layout, type Shape, type Sort } from './harness.ts';

const RUNS = Number(option('runs') ?? 10);
const CYCLES = Number(option('cycles') ?? 3);
const DELAY_MS = Number(option('delay') ?? 200);
const shapes = pick('shape', SHAPES);
const profiles = pick('profile', PROFILES.map((profile) => profile.name)).map((name) => PROFILES.find((profile) => profile.name === name)!);
for (const [name, value] of [['runs', RUNS], ['cycles', CYCLES], ['delay', DELAY_MS]] as const) if (!(Number.isInteger(value) && value > 0)) throw new Error(`--${name} ${option(name)}: not a positive whole number`);
const features = builtFeatures();
if (!features.includes('sort')) throw new Error('needs the host built with sort: `just tall-table build sort`');

/** The held click's wheels: to these rows, `WHEEL_GAP_MS` apart. */
const HELD_ROWS = [200_000, 600_000, 1_000_000];
const WHEEL_GAP_MS = 30;
/** After a click's frame is filled, this long before the next (unheld). */
const SETTLE_MS = 300;

type Presented = RecordedFrame<{ top: number; first: number; end: number; loaded: number; sort?: Sort | null }>;
type Kind = 'unheld' | 'quiet' | 'held';

interface Click {
  to: Sort | null;
  /** The click → the sorted mark, → the first frame with its arrow, and
   *  → the first such frame at the top with every row real. */
  markMs: number;
  arrowMs: number;
  filledMs: number;
  /** Reads cancelled in flight from `drainedFrom` (held: from the first
   *  wheel) to the click's filled frame. */
  drained: number;
}

const round = (ms: number) => Number(ms.toFixed(2));
const same = (a: Sort | null | undefined, b: Sort | null) => JSON.stringify(a ?? null) === JSON.stringify(b);

/** The cycle from off, for a float: descending, ascending, off. */
function cycle(column: number): (Sort | null)[] {
  return [{ column, direction: 'descending' }, { column, direction: 'ascending' }, null];
}

/** One click on `column`'s arrow, to `to`: its times from the pointerup. */
async function click(page: Page, layout: Layout, column: number, to: Sort | null, drainedFrom: number): Promise<Click> {
  const arrow = arrowAt(layout, column, 0);
  if (!arrow) throw new Error(`column ${column} draws no arrow`);
  await page.mouse.move(arrow.x, arrow.y);
  const { ups, frames: framesFrom } = await page.evaluate(() => {
    const g = globalThis as { __seizaPresented?: unknown[]; __pointerUps?: number[] };
    return { ups: g.__pointerUps!.length, frames: g.__seizaPresented!.length };
  });
  await page.mouse.down();
  await page.mouse.up();
  // A constant-time poll while the click is timed: the probe's order and
  // its rows real at the top. The frames are read once it holds, from the
  // click's on: a poll scanning the session's frames would grow inside
  // the window it times.
  await page.waitForFunction(
    ({ want }) => {
      const s = (globalThis as { __tallTable?: { sort?: Sort | null; first: number; top: number; loaded: number; end: number } }).__tallTable;
      const sort = s?.sort ?? null;
      const same = want === null ? sort === null : sort !== null && sort.column === want.column && sort.direction === want.direction;
      return s && same && s.first === 0 && s.top === 0 && s.loaded === s.end - s.first;
    },
    { want: to },
    { timeout: 60_000, polling: 10 },
  );
  const read = await page.evaluate(
    ({ ups, framesFrom, want, name }) => {
      const g = globalThis as { __seizaPresented?: Presented[]; __pointerUps?: number[] };
      const event = g.__pointerUps![ups];
      if (event === undefined) return null;
      const json = JSON.stringify(want);
      const frames = g.__seizaPresented!.slice(framesFrom).filter((frame) => frame.t >= event && JSON.stringify(frame.sort ?? null) === json);
      const filled = frames.find((frame) => frame.first === 0 && frame.top === 0 && frame.loaded === frame.end - frame.first);
      const mark = performance.getEntriesByName(name).filter((entry) => entry.startTime >= event).at(-1);
      return frames[0] && filled && mark ? { event, arrow: frames[0].t, filled: filled.t, mark: mark.startTime } : null;
    },
    { ups, framesFrom, want: to, name: SORTED_MARK },
  );
  if (!read) throw new Error(`a click to ${JSON.stringify(to)}: no pointerup, presented frame, or sorted mark recorded`);
  const { event, arrow: drawn, filled, mark } = read;
  const drained = (await drainedReads(page)) - drainedFrom;
  return { to, markMs: round(mark - event), arrowMs: round(drawn - event), filledMs: round(filled - event), drained };
}

/** Three wheels to rows no page holds, each read sent (and the one before
 *  it cancelled): three reads out, the view at the last. */
async function holdReads(page: Page, layout: Layout): Promise<void> {
  await page.mouse.move(layout.left + 300, layout.top + 300);
  let at = 0;
  for (const row of HELD_ROWS) {
    await wheel(page, (row - at) * layout.rowHeight);
    at = row;
    await page.waitForFunction((row) => ((globalThis as { __tallTable?: { first: number } }).__tallTable?.first ?? 0) >= row - 1, row, { timeout: 10_000, polling: 5 });
    await page.waitForTimeout(WHEEL_GAP_MS);
  }
}

/** One cold session of `shape`: `kind`'s clicks, `CYCLES` cycles of the
 *  column's arrow. */
async function session(url: string, shape: Shape, profile: Profile, kind: Kind, failures: string[]): Promise<Click[]> {
  const column = SORTED_COLUMN[shape];
  const params: Record<string, string> = { shape };
  if (kind !== 'unheld') params.delay = String(DELAY_MS);
  let browsing: Awaited<ReturnType<typeof open>> | null = null;
  try {
    browsing = await open(chromium, url, { profile, params });
    const { page } = browsing;
    await waitMark(page, FILLED_MARK, 0, 60_000 + DELAY_MS);
    const { layout } = await shown(page);
    // Each direction's order computed: the cycle once, through the hook.
    for (const sort of cycle(column)) await sortThrough(page, sort, 120_000);
    await filledWhere(page, 's.first === 0', 60_000);
    await page.waitForTimeout(kind === 'unheld' ? SETTLE_MS : 2 * DELAY_MS + SETTLE_MS);
    await page.evaluate(presentedRecorder);
    await page.evaluate(() => {
      const ups: number[] = [];
      (globalThis as { __pointerUps?: number[] }).__pointerUps = ups;
      addEventListener('pointerup', (event) => ups.push(event.timeStamp), { capture: true, passive: true });
    });
    const clicks: Click[] = [];
    for (let index = 0; index < CYCLES; index++) {
      for (const to of cycle(column)) {
        const drainedFrom = await drainedReads(page);
        if (kind === 'held') await holdReads(page, layout);
        const done = await click(page, layout, column, to, drainedFrom);
        // Two by the wheels, the last by the sort: three out at the click.
        if (kind === 'held' && done.drained < HELD_ROWS.length) failures.push(`${shape} ${profile.name} held: ${done.drained} reads drained, not ${HELD_ROWS.length}`);
        if (!same((await shown(page)).shown.sort, to)) failures.push(`${shape} ${profile.name} ${kind}: the probe's order isn't ${JSON.stringify(to)}`);
        clicks.push(done);
        // Prefetch landed (held: the drained reads too), nothing out at the next click.
        await page.waitForTimeout(kind === 'unheld' ? SETTLE_MS : 2 * DELAY_MS + SETTLE_MS);
      }
    }
    failures.push(...browsing.problems.map((problem) => `${shape} ${profile.name} ${kind}: ${problem}`));
    return clicks;
  } catch (error) {
    failures.push(`${shape} ${profile.name} ${kind}: ${(error as Error).message.split('\n')[0]}`);
    return [];
  } finally {
    await browsing?.close();
  }
}

/** The medians of a run's clicks. */
function summary(clicks: Click[]): { clicks: number; markMs: number; arrowMs: number; filledMs: number; drained: number } {
  const of = (key: 'markMs' | 'arrowMs' | 'filledMs' | 'drained') => round(median(clicks.map((click) => click[key])));
  return { clicks: clicks.length, markMs: of('markMs'), arrowMs: of('arrowMs'), filledMs: of('filledMs'), drained: of('drained') };
}

const server = await serveApp(undefined, { webDir: hostWebDir, port: PORT });
const failures: string[] = [];
const results: Record<string, Record<string, Record<Kind, { runs: ReturnType<typeof summary>[]; summary: Record<string, number> }>>> = {};
console.log(`build: ${buildName(features)}, ${CYCLES} cycles a session, held reads ${DELAY_MS} ms`);
try {
  for (const shape of shapes) {
    for (const profile of profiles) {
      const kinds = {} as Record<Kind, { runs: ReturnType<typeof summary>[]; summary: Record<string, number> }>;
      for (const kind of ['unheld', 'quiet', 'held'] as Kind[]) {
        const runs: ReturnType<typeof summary>[] = [];
        for (let index = 0; index < RUNS; index++) {
          const clicks = await session(server.url, shape, profile, kind, failures);
          if (!clicks.length) continue;
          const run = summary(clicks);
          runs.push(run);
          console.log(`${shape} ${profile.name} ${kind} ${index + 1}/${RUNS}: → sorted ${run.markMs} ms, → arrow ${run.arrowMs} ms, → filled ${run.filledMs} ms${kind === 'held' ? `, ${run.drained} drained` : ''} (${run.clicks} clicks)`);
        }
        const numbers = runs.length ? Object.fromEntries((['markMs', 'arrowMs', 'filledMs', 'drained'] as const).map((key) => [key, round(median(runs.map((run) => run[key])))])) : {};
        const spread = runs.length ? (Math.max(...runs.map((run) => run.arrowMs)) - Math.min(...runs.map((run) => run.arrowMs))) / (numbers.arrowMs || 1) : 0;
        kinds[kind] = { runs, summary: { ...numbers, arrowSpread: round(spread) } };
        console.log(`  ${shape} ${profile.name} ${kind} (median of ${runs.length}): → sorted ${numbers.markMs} ms, → arrow ${numbers.arrowMs} ms (spread ${(spread * 100).toFixed(1)}%), → filled ${numbers.filledMs} ms`);
      }
      (results[shape] ??= {})[profile.name] = kinds;
      const quiet = kinds.quiet.summary.filledMs;
      const held = kinds.held.summary.filledMs;
      if (quiet !== undefined && held !== undefined) console.log(`  ${shape} ${profile.name}: the held sort's top page waited ${round(held - quiet)} ms for the reads out`);
    }
  }
} finally {
  await server.close();
}

const label = option('label');
if (label) {
  const date = localDate();
  const out = join(perfDir, 'results', `${date}-${label}.json`);
  mkdirSync(join(perfDir, 'results'), { recursive: true });
  const protocol = { browser: 'chromium headless=new', viewport: '1440x900', dpr: 2, runs: RUNS, cold: true, cycles: CYCLES, delayMs: DELAY_MS, columns: SORTED_COLUMN, heldRows: HELD_ROWS, wheelGapMs: WHEEL_GAP_MS, settleMs: SETTLE_MS, build: buildName(features) };
  writeFileSync(out, `${JSON.stringify({ date, label, ...machineInfo(), protocol, results, failures }, null, 2)}\n`);
  console.log(`wrote ${out}`);
}
if (failures.length) {
  console.error(`FAIL\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
