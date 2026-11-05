// Market watch's presentation probe (throwaway; Shown in's method): one
// traced run of the TanStack spike at 1k updates/s, its commits against the
// animation frames that hold them and each frame's presentation, and
// commit → presentation second by second. Args: flash ms (0 none), hold
// (0, 1, alt), frameRecorder (0, 1), categories (`lat` or `run`, the
// runner's). Env: SETTLE, WINDOW (ms), SPIN (the runner's old busy loop
// before the window: it moves the DOM's commit → presentation from ~19 to
// ~31 ms). Port 4358. Build the spike first (`market-run.ts` does).
//
// OUT=<label> writes perf/results/<date>-<label>.json (refused if it exists).
//
// Usage: SETTLE=1000 WINDOW=11000 [SPIN=1] [OUT=<label>] node apps/observatory/spike/present-probe.ts 400 0 1 run

import { existsSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { frameRecorder, open } from '../../../shared-web/perf/harness.ts';
import { PROFILES, localDate, machineInfo, median, percentiles } from '../../../shared-web/perf/protocol.ts';
import { serveApp } from '../../../shared-web/perf/serve.ts';
import { LATENCY_CATEGORIES, ORIGIN_MARK, Trace, spans } from '../../../shared-web/perf/trace.ts';

const [flash = '400', hold = '0', rec = '0', cats = 'lat'] = process.argv.slice(2);
const settleMs = Number(process.env.SETTLE ?? 2000);
const windowMs = Number(process.env.WINDOW ?? 3000);
const out = process.env.OUT ? `${import.meta.dirname}/../perf/results/${localDate()}-${process.env.OUT}.json` : null;
if (out && existsSync(out)) throw new Error(`${out} exists: pass another OUT`);
const round1 = (v: number) => Math.round(v * 10) / 10;

const server = await serveApp(undefined, { webDir: import.meta.dirname, port: 4358 });
const session = await open(chromium, `${server.url}market.html`, {
  profile: PROFILES.find((p) => p.name === 'reference')!,
  params: { rate: '1000', flash, hold },
  init: rec === '1' ? [frameRecorder] : [],
});
const { page } = session;
let json: { traceEvents: never[] };
let market: { shown: [seq: number, at: number][] };
try {
  await page.waitForTimeout(settleMs);
  if (process.env.SPIN)
    await page.evaluate(() => {
      let x = 0;
      for (let i = 0; i < 3e7; i++) x = (x + i * 7) % 1000003;
      return x;
    });
  const browser = session.context.browser()!;
  await browser.startTracing(page, { categories: cats === 'run' ? [...LATENCY_CATEGORIES, 'blink', 'v8'] : [...LATENCY_CATEGORIES, 'viz', 'gpu'] });
  await page.evaluate((name) => performance.mark(name), ORIGIN_MARK);
  await page.waitForTimeout(windowMs);
  json = JSON.parse((await browser.stopTracing()).toString());
  market = await page.evaluate(() => (globalThis as { __market?: never }).__market!);
  if (session.problems.length) throw new Error(`the page: ${session.problems.join('; ')}`);
} finally {
  await session.close();
  await server.close();
}
const trace = new Trace(json);
const events = trace.events;

// The frame reporter's stages: async spans in the `benchmark` category.
const stages = new Map<string, number[]>();
const begun = new Map<string, number>();
for (const event of events) {
  if (!event.cat.includes('benchmark')) continue;
  const key = `${event.pid}:${event.id ?? event.id2?.local}:${event.name}`;
  if (event.ph === 'b') begun.set(key, event.ts);
  else if (event.ph === 'e' && begun.has(key)) {
    stages.set(event.name, [...(stages.get(event.name) ?? []), (event.ts - begun.get(key)!) / 1000]);
    begun.delete(key);
  }
}
for (const [name, ms] of [...stages].sort((a, b) => b[1].length - a[1].length).slice(0, 20)) console.log(name.padEnd(60), ms.length, median(ms).toFixed(2));

// Each animation frame's own presentation, and how late after the frame.
const frames = spans(events, 'AnimationFrame').filter(({ begin }) => begin.pid === trace.main.pid);
const presented = new Map<string, number>();
for (const event of events)
  if (event.name === 'AnimationFrame::Presentation' && event.pid === trace.main.pid && !presented.has(event.args!.id)) presented.set(event.args!.id, event.ts);
const afterEnd: number[] = [];
const sharing = new Map<number, number>();
for (const { begin, end } of frames) {
  const at = begin.args?.id ? presented.get(begin.args.id) : undefined;
  if (at === undefined) continue;
  afterEnd.push((at - end.ts) / 1000);
  sharing.set(at, (sharing.get(at) ?? 0) + 1);
}
const after = percentiles(afterEnd);
console.log('frames', frames.length, 'presented', afterEnd.length, 'distinct presentation times', sharing.size, '; frame end → presentation p50', after.p50.toFixed(1), 'p95', after.p95.toFixed(1));

// Commits inside the trace (a margin of 20 frames each end): commit → presentation, whole and second by second.
const lo = frames[20]!.begin.ts;
const hi = frames.at(-20)!.end.ts;
const toPresentation: number[] = [];
const bySecond = new Map<number, number[]>();
for (const [, at] of market.shown) {
  const ts = trace.toTrace(at);
  if (ts < lo || ts > hi) continue;
  const presentation = trace.presentationOf(ts);
  if (!presentation) continue;
  const ms = trace.toPage(presentation.at) - at;
  toPresentation.push(ms);
  const second = Math.floor((ts - lo) / 1e6);
  bySecond.set(second, [...(bySecond.get(second) ?? []), ms]);
}
const frameMs = median(frames.map(({ begin, end }) => (end.ts - begin.ts) / 1000));
const secondly = [...bySecond].map(([second, ms]) => ({ second, commitToPresentationP50Ms: round1(median(ms)) }));
console.log('by second', secondly.map(({ second, commitToPresentationP50Ms }) => `${second}:${commitToPresentationP50Ms}`).join(' '));
console.log('commit → presentation p50', median(toPresentation).toFixed(1), '; animation frame p50', frameMs.toFixed(1));
if (out)
  writeFileSync(
    out,
    JSON.stringify(
      {
        date: localDate(),
        ...machineInfo(),
        args: { flash, hold, frameRecorder: rec, categories: cats, settleMs, windowMs, spinBefore: !!process.env.SPIN },
        commitToPresentationP50Ms: round1(median(toPresentation)),
        animationFrameP50Ms: round1(frameMs),
        secondly,
      },
      null,
      2,
    ) + '\n',
  );
process.exit(0);
