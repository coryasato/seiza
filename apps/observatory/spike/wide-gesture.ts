// The wide-grid spike, both sides on one input path (throwaway; the wide
// sheet's stops): Chromium's synthetic gesture scroll (`Input.synthesizeScrollGesture`,
// mouse-sourced: phased wheel events, as a touchpad sends), which reaches a
// native scroller's compositor every frame, where Playwright's bare
// `mouse.wheel` reached it every other frame (`wide-run.ts --gesture`, the
// control). The same gesture goes to GPUI's canvas as wheel events.
//
// Sides: `tanstack` (wide.html, the spike's grid over the file's values in
// memory) and `gpui` (the tall table's bare host, built
// `custom-cells,pin,density`, `?shape=wide&cells=heat&pin=2&density=…`, rows
// from memory). Per setting, three segments, each traced on its own:
// - down: 37,500 px at 18,750 px/s (2 s; the bare host's steady scroll's
//   distance and pace);
// - fast: 120,000 px at 60,000 px/s (2 s; a fling, every frame new rows);
// - sideways: 12,000 px at 6,000 px/s (2 s).
// Per segment: the frames that drew new cells (GPUI: the presented frames,
// `workRecorder`; TanStack: main frames that rendered rows, whose animate
// part ran past 1 ms), as a share of the display's frames (60 Hz) from the
// first of them to the last, and a second; their work p50/p95 (GPUI: the
// recorder's; TanStack: the trace's); TanStack's compositor frames over the
// same span (presented whole, in part: moved with its rows not re-rendered,
// dropped). A segment that draws fewer than two frames fails the run.
//
// Usage: node apps/observatory/spike/wide-gesture.ts --side tanstack|gpui [--runs 3]
//          [--settings 30,14,120;…] [--profile reference|throttled] [--label <name>]
// TanStack: needs spike/dist (`wide-run.ts` builds it). GPUI: `just tall-table build custom-cells,pin,density`.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Browser, type CDPSession, type Page } from 'playwright';
import { open, waitMark, workBetween, workRecorder, frameRecorder, recordedBetween } from '../../../shared-web/perf/harness.ts';
import { PROFILES, localDate, machineInfo, median, option, percentiles } from '../../../shared-web/perf/protocol.ts';
import { serveApp } from '../../../shared-web/perf/serve.ts';
import { FRAME_MS, ORIGIN_MARK, Trace, WORK_CATEGORIES, compositorFrames, frameWork } from '../../../shared-web/perf/trace.ts';

const dir = import.meta.dirname;
const SIDE = option('side') as 'tanstack' | 'gpui';
if (SIDE !== 'tanstack' && SIDE !== 'gpui') throw new Error('--side tanstack|gpui');
const RUNS = Number(option('runs') ?? 3);
const SETTINGS = (option('settings') ?? '30,14,120;26,13,96;22,12,80;20,11,68;18,11,56;16,10,44').split(';');
const PROFILE = PROFILES.find((p) => p.name === (option('profile') ?? 'reference'))!;
const SEGMENTS = {
  down: { yDistance: -37_500, speed: 18_750 },
  fast: { yDistance: -120_000, speed: 60_000 },
  sideways: { xDistance: -12_000, speed: 6_000 },
} as const;
type Segment = keyof typeof SEGMENTS;

interface Reading {
  /** The frames that drew new cells, as a share of the display's frames
   *  from the first of them to the last (60 Hz): "keeps up" reads it. */
  drewSharePct: number;
  drewPerSecond: number;
  drewP50Ms: number;
  drewP95Ms: number;
  /** Visible cells p50 (TanStack's frame sample; GPUI's are the bare
   *  host's `perf.ts` counts at the same setting). */
  cells: number | null;
  compositor?: { wholePerSecond: number; partialPerSecond: number; droppedPerSecond: number };
  busyPct: number;
  windowMs: number;
}

const round = (x: number) => Number(x.toFixed(2));

/** Chromium's frame reporter per vsync (`shared-web/perf/trace.ts`), a second. */
function compositor(trace: Trace, a: number, b: number, ms: number): NonNullable<Reading['compositor']> {
  const { whole, partial, dropped } = compositorFrames(trace, a, b);
  const perS = (n: number) => round((n * 1000) / ms);
  return { wholePerSecond: perS(whole), partialPerSecond: perS(partial), droppedPerSecond: perS(dropped) };
}

/** Until nothing has drawn for 300 ms: GPUI's recorder, TanStack's scroll
 *  position. Returns the last drawing's page time. */
async function rest(page: Page, since: number): Promise<number> {
  const handle = await page.waitForFunction(
    ({ side, since }) => {
      const w = globalThis as unknown as { __rest?: { at: number; key: string }; __seizaWork?: { t: number }[] };
      const t = performance.now();
      let key: string;
      if (side === 'gpui') {
        key = `${since}:${(w.__seizaWork ?? []).filter((s) => s.t >= since).length}`;
      } else {
        const s = document.querySelector('.scroller')!;
        key = `${since}:${s.scrollTop},${s.scrollLeft}`;
      }
      if (!w.__rest || w.__rest.key !== key) {
        w.__rest = { at: t, key };
        return false;
      }
      return t - w.__rest.at > 300 ? w.__rest.at : false;
    },
    { side: SIDE, since },
    { polling: 50, timeout: 120_000 },
  );
  return (await handle.jsonValue()) as number;
}

async function traced(browser: Browser, page: Page, cdp: CDPSession, segment: Segment): Promise<Reading> {
  await browser.startTracing(page, { categories: [...WORK_CATEGORIES, 'cc'] });
  const from = await page.evaluate((name) => (performance.mark(name), performance.now()), ORIGIN_MARK);
  await cdp.send('Input.synthesizeScrollGesture', { x: 700, y: 450, ...SEGMENTS[segment], gestureSourceType: 'mouse' });
  const last = await rest(page, from);
  const to = last + 100;
  const trace = new Trace(JSON.parse((await browser.stopTracing()).toString()));
  const work = frameWork(trace, from, to);
  const ms = to - from;
  // Each frame that drew new cells: when it started, and its work.
  let drew: { at: number; ms: number }[];
  let cells: number | null = null;
  if (SIDE === 'gpui') {
    drew = (await workBetween(page, from, to)).map((s) => ({ at: s.t, ms: s.ms }));
  } else {
    drew = work.frames.filter((f) => f.parts.animate! > 1).map((f) => ({ at: f.at, ms: f.ms }));
    const samples = await recordedBetween<{ cells: number }>(page, from, to);
    cells = percentiles(samples.map((s) => s.cells)).p50;
  }
  if (drew.length < 2) throw new Error(`${segment}: ${drew.length} frames drew new cells`);
  const span = drew.at(-1)!.at - drew[0]!.at;
  const displayFrames = Math.round(span / FRAME_MS) + 1;
  const p = percentiles(drew.map((f) => f.ms));
  return {
    drewSharePct: round(Math.min(1, drew.length / displayFrames) * 100),
    drewPerSecond: round(((drew.length - 1) * 1000) / span),
    drewP50Ms: round(p.p50),
    drewP95Ms: round(p.p95),
    cells,
    ...(SIDE === 'tanstack' ? { compositor: compositor(trace, trace.toTrace(drew[0]!.at), trace.toTrace(drew.at(-1)!.at), span) } : {}),
    busyPct: round((work.busyMs / ms) * 100),
    windowMs: round(span),
  };
}

async function home(page: Page): Promise<void> {
  if (SIDE === 'tanstack') await page.evaluate(() => document.querySelector('.scroller')!.scrollTo(0, 0));
  else {
    await page.keyboard.press('Home');
    await page.keyboard.press('Control+Home');
    // Sideways back to the first column.
    await page.mouse.wheel(-100_000, 0);
  }
  await page.waitForTimeout(800);
}

const webDir = SIDE === 'gpui' ? join(dir, '../../../components/tall-table/host/web') : dir;
const server = await serveApp(undefined, { webDir, port: SIDE === 'gpui' ? 4343 : 4344 });
const results: Record<string, Record<Segment, Reading[]>> = {};
try {
  for (const setting of SETTINGS) {
    const [row, text, width] = setting.split(',');
    results[setting] = { down: [], fast: [], sideways: [] };
    for (let run = 0; run < RUNS; run++) {
      const params: Record<string, string> =
        SIDE === 'gpui' ? { shape: 'wide', cells: 'heat', pin: '2', density: setting } : { row: row!, text: text!, width: width!, pin: '2', cells: 'heat' };
      const session = await open(chromium, SIDE === 'gpui' ? server.url : `${server.url}wide.html`, { profile: PROFILE, params, init: SIDE === 'gpui' ? [workRecorder] : [frameRecorder] });
      const { page } = session;
      try {
        if (SIDE === 'gpui') {
          await waitMark(page, 'tall-table:filled');
        } else {
          await page.waitForFunction(() => (globalThis as { __wide?: unknown }).__wide !== undefined, undefined, { timeout: 60_000 });
          await page.evaluate(() => document.fonts.ready);
        }
        await page.mouse.move(700, 450);
        await page.waitForTimeout(500);
        const cdp = await session.context.newCDPSession(page);
        const browser = session.context.browser()!;
        for (const segment of Object.keys(SEGMENTS) as Segment[]) {
          results[setting]![segment].push(await traced(browser, page, cdp, segment));
          await home(page);
        }
      } finally {
        await session.close();
      }
    }
    for (const [segment, readings] of Object.entries(results[setting]!)) {
      const m = (f: (r: Reading) => number) => round(median(readings.map(f)));
      const c = readings[0]!.compositor ? `  compositor whole/partial/dropped ${m((r) => r.compositor!.wholePerSecond)}/${m((r) => r.compositor!.partialPerSecond)}/${m((r) => r.compositor!.droppedPerSecond)}` : '';
      console.log(
        `${SIDE} ${setting} ${segment.padEnd(8)} ${readings[0]!.cells !== null ? `cells ${m((r) => r.cells!)}  ` : ''}drew ${m((r) => r.drewSharePct)}% (${m((r) => r.drewPerSecond)}/s) p50 ${m((r) => r.drewP50Ms)} p95 ${m((r) => r.drewP95Ms)} ms  busy ${m((r) => r.busyPct)}%${c}  [drew% ${readings.map((r) => r.drewSharePct).join(', ')}]`,
      );
    }
  }
} finally {
  await server.close();
}
const label = option('label');
if (label) {
  const file = join(dir, '../perf/results', `${localDate()}-${label}.json`);
  writeFileSync(file, `${JSON.stringify({ date: localDate(), ...machineInfo(), browser: 'chromium', side: SIDE, profile: PROFILE.name, runs: RUNS, segments: SEGMENTS, results }, null, 2)}\n`);
  console.log(`wrote ${file}`);
}
