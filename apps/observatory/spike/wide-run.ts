// The wide-grid spike's runs (throwaway; the wide sheet's stops): the TanStack grid
// (wide.html) at a few densities, cold, a few runs each (sizing, not the
// protocol). Per setting, three segments as the bare host's `perf.ts` runs
// them: a steady scroll down (300 px every 16 ms for 2 s), a vertical fling
// (top to bottom in ~3 s), a sideways fling (first day to last in ~3 s), each
// traced on its own. Per-frame work is the trace's BeginMainFrame
// (`frameWork`); beside it the rAF intervals' late share, the visible cells
// (rows × columns on screen, the pinned ones counted), and the share of
// rAFs whose rendered rows and columns didn't cover the view (the main
// thread behind the compositor's scroll: blank cells on screen).
//
// --check: in Chromium, Firefox, and WebKit, at the densest setting, the
// vertical and sideways flings with the pinned edge and the header read
// each rAF (their offsets from the scroller's box) and a screenshot taken
// mid-fling, into perf/results/raw/wide-spike/.
//
// Usage: node apps/observatory/spike/wide-run.ts [--runs 3] [--settings 30,14,120;22,12,80]
//          [--profile reference|throttled] [--pin 2] [--cells heat|text] [--check] [--no-build] [--label <name>]
// Needs public/wide/ (spike/wide-data.ts).

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, firefox, webkit, type Browser, type BrowserType, type Page } from 'playwright';
import { build } from 'vite';
import { frameIntervals, frameRecorder, open, recordedBetween, type RecordedFrame } from '../../../shared-web/perf/harness.ts';
import { PROFILES, flag, localDate, machineInfo, median, option, percentiles } from '../../../shared-web/perf/protocol.ts';
import { serveApp } from '../../../shared-web/perf/serve.ts';
import { ORIGIN_MARK, Trace, WORK_CATEGORIES, frameWork, lateFrames, FRAME_MS } from '../../../shared-web/perf/trace.ts';

const dir = import.meta.dirname;
const RUNS = Number(option('runs') ?? 3);
const SETTINGS = (option('settings') ?? '30,14,120;26,13,96;22,12,80;20,11,68;18,11,56;16,10,44').split(';').map((s) => s.split(',').map(Number) as [number, number, number]);
const PROFILE = PROFILES.find((p) => p.name === (option('profile') ?? 'reference'))!;
const PIN = option('pin') ?? '2';
const CELLS = option('cells') ?? 'heat';
const PORT = 4342;
/** A frame whose animate part (scroll events, React's render) ran past this drew rows. */
const DREW_MS = 1;

type Sample = { cells: number; top: number; left: number; covered: boolean };

interface Reading {
  compositor: { allPerSecond: number; partialPerSecond: number; droppedPerSecond: number };
  compositorScrollsPerSecond: number;
  drawn: { frames: number; perSecond: number; p50Ms: number; p95Ms: number };
  busyPct: number;
  frames: number;
  framesPerSecond: number;
  workP50Ms: number;
  workP95Ms: number;
  workMaxMs: number;
  overFramePct: number;
  busyMs: number;
  latePct: number;
  cellsP50: number;
  uncoveredPct: number;
  windowMs: number;
}

const round = (x: number) => Number(x.toFixed(2));
const now = (page: Page) => page.evaluate(() => performance.now());

/** Until the scroll position hasn't moved for 300 ms (from now: the last
 *  rest's state is cleared first). */
async function rest(page: Page): Promise<void> {
  await page.evaluate(() => delete (globalThis as { __rest?: unknown }).__rest);
  await page.waitForFunction(
    () => {
      const s = document.querySelector('.scroller')!;
      const w = globalThis as unknown as { __rest?: { at: number; top: number; left: number } };
      const t = performance.now();
      if (!w.__rest || w.__rest.top !== s.scrollTop || w.__rest.left !== s.scrollLeft) {
        w.__rest = { at: t, top: s.scrollTop, left: s.scrollLeft };
        return false;
      }
      return t - w.__rest.at > 300;
    },
    undefined,
    { polling: 50, timeout: 120_000 },
  );
}

async function traced(browser: Browser, page: Page, act: () => Promise<void>): Promise<Reading> {
  await browser.startTracing(page, { categories: [...WORK_CATEGORIES, 'cc'] });
  const from = await page.evaluate((name) => (performance.mark(name), performance.now()), ORIGIN_MARK);
  await act();
  await rest(page);
  const to = (await now(page)) - 300;
  const trace = new Trace(JSON.parse((await browser.stopTracing()).toString()));
  const work = frameWork(trace, from, to);
  const per = percentiles(work.frames.map((f) => f.ms));
  const samples = (await recordedBetween<Sample>(page, from, to)) as RecordedFrame<Sample>[];
  const cells = percentiles(samples.map((s) => s.cells));
  if (flag('dump')) console.log('tops', JSON.stringify(samples.slice(10, 60).map((s) => Math.round(s.top + s.left))));
  if (flag('dump')) console.log(JSON.stringify(work.frames.map((f) => [round(f.ms), round(f.parts.input!), round(f.parts.animate!), round(f.parts.lifecycle!)])));
  // The frames that rendered: React's commit runs in the scroll event, in
  // the frame's animate part; a frame with none only commits the
  // compositor's scroll, ~0.7 ms, and holds the plain p50 down.
  const drew = work.frames.filter((f) => f.parts.animate! > DREW_MS);
  const drawn = percentiles(drew.map((f) => f.ms));
  // The compositor's frames that applied a scroll (`Scroll Delta This
  // Frame`, off the main thread): what the screen moved at.
  const [a, b] = [trace.toTrace(from), trace.toTrace(to)];
  const deltas = trace.events.filter((e) => e.name === 'Scroll Delta This Frame' && e.pid === trace.main.pid && e.tid !== trace.main.tid && e.ts >= a && e.ts <= b && (e.args?.x || e.args?.y));
  // Chromium's frame reporter, per vsync (perf/readout-cost.ts's reading):
  // presented whole, in part (the compositor's update without the main
  // thread's: the rows not yet re-rendered), or dropped.
  const vsyncs = new Map<string, Set<string>>();
  for (const e of trace.events) {
    if (e.name !== 'PipelineReporter' || e.ph !== 'b' || e.pid !== trace.main.pid || e.ts < a || e.ts > b) continue;
    const r = e.args?.frame_reporter as { state?: string; frame_source?: number; frame_sequence?: number } | undefined;
    if (!r?.state) continue;
    const k = `${r.frame_source}:${r.frame_sequence}`;
    vsyncs.set(k, (vsyncs.get(k) ?? new Set()).add(r.state));
  }
  let all = 0, partial = 0, dropped = 0;
  for (const states of vsyncs.values()) {
    if (states.has('STATE_PRESENTED_ALL')) all++;
    else if (states.has('STATE_PRESENTED_PARTIAL')) partial++;
    else if (states.has('STATE_DROPPED')) dropped++;
  }
  const perS = (n: number) => round((n * 1000) / (to - from));
  return {
    compositor: { allPerSecond: perS(all), partialPerSecond: perS(partial), droppedPerSecond: perS(dropped) },
    compositorScrollsPerSecond: round((deltas.length * 1000) / (to - from)),
    drawn: { frames: drew.length, perSecond: round((drew.length * 1000) / (to - from)), p50Ms: round(drawn.p50), p95Ms: round(drawn.p95) },
    busyPct: round((work.busyMs / (to - from)) * 100),
    frames: work.frames.length,
    framesPerSecond: round((work.frames.length * 1000) / (to - from)),
    workP50Ms: round(per.p50),
    workP95Ms: round(per.p95),
    workMaxMs: round(per.max),
    overFramePct: round((work.frames.filter((f) => f.ms > FRAME_MS).length / Math.max(1, work.frames.length)) * 100),
    busyMs: round(work.busyMs),
    latePct: round(lateFrames(frameIntervals(samples)).share * 100),
    cellsP50: cells.p50,
    uncoveredPct: round((samples.filter((s) => !s.covered).length / Math.max(1, samples.length)) * 100),
    windowMs: round(to - from),
  };
}

const home = async (page: Page) => {
  await page.evaluate(() => document.querySelector('.scroller')!.scrollTo(0, 0));
  await rest(page);
};

/** Wheels on a fixed schedule, unawaited (Playwright's wait would pace the
 *  input by the page's cost); raw deltas: a native scroller moves the whole
 *  of Playwright's delta at DPR 2. */
async function sendWheels(page: Page, events: number, everyMs: number, dx: number, dy: number): Promise<void> {
  const sent: Promise<void>[] = [];
  for (let i = 0; i < events; i++) {
    sent.push(page.mouse.wheel(dx, dy));
    await page.waitForTimeout(everyMs);
  }
  await Promise.all(sent);
}

interface Geometry {
  rows: number;
  rowHeight: number;
  totalWidth: number;
}

const flingDown = (page: Page, g: Geometry) => sendWheels(page, 375, 8, 0, Math.ceil((g.rows * g.rowHeight) / 375));
const flingSideways = (page: Page, g: Geometry) => sendWheels(page, 375, 8, Math.ceil(g.totalWidth / 375), 0);

async function openGrid(engine: BrowserType, url: string, [row, text, width]: [number, number, number], init: (() => void)[] = [frameRecorder]) {
  const session = await open(engine, `${url}wide.html`, { profile: engine === chromium ? PROFILE : null, params: { row: String(row), text: String(text), width: String(width), pin: PIN, cells: CELLS }, init });
  await session.page.waitForFunction(() => (globalThis as { __wide?: unknown }).__wide !== undefined, undefined, { timeout: 60_000 });
  await session.page.evaluate(() => document.fonts.ready);
  const g = (await session.page.evaluate(() => (globalThis as unknown as { __wide: Geometry }).__wide)) as Geometry;
  await session.page.mouse.move(700, 450);
  await session.page.waitForTimeout(300);
  return { ...session, g };
}

async function measure(url: string): Promise<void> {
  const results: Record<string, Record<string, Reading[]>> = {};
  for (const setting of SETTINGS) {
    const key = setting.join(',');
    results[key] = { scroll: [], fling: [], hfling: [] };
    for (let run = 0; run < RUNS; run++) {
      const session = await openGrid(chromium, url, setting);
      const { page, g } = session;
      const browser = session.context.browser()!;
      try {
        if (flag('gesture')) {
          // The input path's other control: Chromium's synthetic gesture
          // scroll (a touchpad's, phased), 37,500 px at 18,750 px/s, the
          // steady scroll's distance and pace.
          results[key]!.gesture = results[key]!.gesture ?? [];
          const cdp = await session.context.newCDPSession(page);
          results[key]!.gesture!.push(
            await traced(browser, page, async () => {
              await cdp.send('Input.synthesizeScrollGesture', { x: 700, y: 450, yDistance: -37_500, speed: 18_750, gestureSourceType: 'mouse' });
            }),
          );
          await home(page);
        }
        if (flag('raf')) {
          // The control for the input path: the same 300 px a frame, set by
          // a rAF loop in the page, no input events.
          results[key]!.rafscroll = results[key]!.rafscroll ?? [];
          results[key]!.rafscroll!.push(
            await traced(browser, page, () =>
              page.evaluate(
                () =>
                  new Promise<void>((done) => {
                    const s = document.querySelector('.scroller')!;
                    let n = 0;
                    const step = () => {
                      s.scrollTop += 300;
                      if (++n < 125) requestAnimationFrame(step);
                      else done();
                    };
                    requestAnimationFrame(step);
                  }),
              ),
            ),
          );
          await home(page);
        }
        results[key]!.scroll!.push(await traced(browser, page, () => sendWheels(page, 125, 16, 0, 300)));
        await home(page);
        results[key]!.fling!.push(await traced(browser, page, () => flingDown(page, g)));
        await home(page);
        results[key]!.hfling!.push(await traced(browser, page, () => flingSideways(page, g)));
      } finally {
        await session.close();
      }
    }
    for (const [segment, readings] of Object.entries(results[key]!)) {
      const m = (f: (r: Reading) => number) => round(median(readings.map(f)));
      console.log(
        `${key} ${segment.padEnd(6)} cells ${m((r) => r.cellsP50)}  drew ${m((r) => r.drawn.perSecond)}/s p50 ${m((r) => r.drawn.p50Ms)} p95 ${m((r) => r.drawn.p95Ms)} ms  busy ${m((r) => r.busyPct)}%  compositor scrolls/s ${m((r) => r.compositorScrollsPerSecond)} whole/partial/dropped ${m((r) => r.compositor.allPerSecond)}/${m((r) => r.compositor.partialPerSecond)}/${m((r) => r.compositor.droppedPerSecond)}  main frames/s ${m((r) => r.framesPerSecond)}  late ${m((r) => r.latePct)}%  [drew/s ${readings.map((r) => r.drawn.perSecond).join(', ')}; p50 ${readings.map((r) => r.drawn.p50Ms).join(', ')}]`,
      );
    }
  }
  const label = option('label');
  if (label) {
    const file = join(dir, '../perf/results', `${localDate()}-${label}.json`);
    writeFileSync(file, `${JSON.stringify({ date: localDate(), ...machineInfo(), browser: 'chromium', profile: PROFILE.name, runs: RUNS, pin: Number(PIN), cells: CELLS, results }, null, 2)}\n`);
    console.log(`wrote ${file}`);
  }
}

/** The pinned edge and the header through both flings, per browser. */
async function check(url: string): Promise<void> {
  const shots = join(dir, '../perf/results/raw/wide-spike');
  mkdirSync(shots, { recursive: true });
  const setting = SETTINGS.at(-1)!;
  const failures: string[] = [];
  for (const [name, engine] of [['chromium', chromium], ['firefox', firefox], ['webkit', webkit]] as const) {
    const session = await openGrid(engine, url, setting, []);
    const { page, g } = session;
    try {
      for (const [segment, act] of [['fling', () => flingDown(page, g)], ['hfling', () => flingSideways(page, g)]] as const) {
        await home(page);
        await page.evaluate(() => {
          const w = globalThis as unknown as { __edges: number[][]; __edgesOn: boolean };
          w.__edges = [];
          w.__edgesOn = true;
          const s = document.querySelector('.scroller')!;
          const loop = () => {
            if (!w.__edgesOn) return;
            const box = s.getBoundingClientRect();
            const head = document.querySelector('.head')!.getBoundingClientRect();
            // The first row whose top is in view, its last pinned cell.
            const rows = [...document.querySelectorAll('.row')].filter((r) => r.getBoundingClientRect().top >= head.bottom);
            const pin = rows[0]?.querySelector('.pin.last')?.getBoundingClientRect();
            w.__edges.push([head.top - box.top, pin ? pin.right - box.left : NaN, s.scrollTop, s.scrollLeft]);
            requestAnimationFrame(loop);
          };
          requestAnimationFrame(loop);
        });
        const acting = act();
        await page.waitForTimeout(700);
        await page.screenshot({ path: join(shots, `${name}-${segment}-mid.png`) });
        await acting;
        await rest(page);
        await page.screenshot({ path: join(shots, `${name}-${segment}-end.png`) });
        const edges = (await page.evaluate(() => {
          const w = globalThis as unknown as { __edges: number[][]; __edgesOn: boolean };
          w.__edgesOn = false;
          return w.__edges;
        })) as number[][];
        const heads = new Set(edges.map((e) => Math.round(e[0]! * 2) / 2));
        const pins = new Set(edges.filter((e) => !Number.isNaN(e[1])).map((e) => Math.round(e[1]! * 2) / 2));
        const moved = edges.at(-1)!;
        console.log(`${name} ${segment}: ${edges.length} rAFs, header top ${[...heads].join('/')}, pinned edge ${[...pins].join('/')}, ended at top ${moved[2]} left ${moved[3]}`);
        if (heads.size !== 1 || pins.size !== 1) failures.push(`${name} ${segment}: the header or the pinned edge moved`);
        if (segment === 'fling' && moved[2] === 0) failures.push(`${name} fling: didn't scroll`);
        if (segment === 'hfling' && moved[3] === 0) failures.push(`${name} hfling: didn't scroll`);
      }
      if (session.problems.length) failures.push(`${name}: ${session.problems.join('; ')}`);
    } finally {
      await session.close();
    }
  }
  console.log(failures.length ? `FAILED:\n${failures.join('\n')}` : `ok; screenshots in ${shots}`);
  if (failures.length) process.exitCode = 1;
}

if (!flag('no-build')) await build({ root: dir, configFile: `${dir}/vite.config.ts`, logLevel: 'warn' });
const server = await serveApp(undefined, { webDir: dir, port: PORT });
try {
  if (flag('check')) await check(server.url);
  else await measure(server.url);
} finally {
  await server.close();
}
