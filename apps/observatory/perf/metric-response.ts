// Input to visible response, on either bare contender page, cold: for a
// key (Page Down / Page Up), a press on the scrollbar's track (both tables
// jump to it), and a wheel event (300 CSS px), each through the side's own
// input path, Chromium's `EventLatency` from the event's timestamp to the
// presentation of the first frame it reached, guarded on every input by an
// independent reading of that frame (GPUI's probe; the DOM's main-thread
// probe for keys, the compositor's frame for native scrolls), and → that
// frame's rows being real (metrics/metrics.ts, `readInputs`). The view starts
// in the middle of the file (the replay's jump), and the probe key goes
// first, so no measured key is the first.
//
// Usage: node apps/observatory/perf/metric-response.ts [--side gpui|tanstack]
//          [--runs 10] [--profile reference|throttled] [--inputs 6] [--label <name>]
// Run `just observatory gpui-build` and `tanstack-build` first.

import { option, percentiles } from '../../../shared-web/perf/protocol.ts';
import { INPUT_MARK, LATENCY_CATEGORIES, ORIGIN_MARK, Trace, readInputs, type InputKind, type InputReading, type Settled } from '../metrics/metrics.ts';
import { domProbe, filledState, gpuiProbe, inputRecorder, medianOf, opened, openSide, paintRecorder, paints, pressProbeKey, restPoint, runMetric, state, trackPress, wheelBy, type RunResult, type Session } from './contender.ts';

const INPUTS = Number(option('inputs') ?? 6);
const KINDS: InputKind[] = ['key', 'track', 'wheel'];
const WHEEL_PX = 300;
/** After an input has moved the view and filled it, this long at rest. */
const SETTLE_MS = 250;

interface Run extends RunResult {
  readings: InputReading[];
}

/**
 * Sends input `index` of `kind` between its window's marks: `input:<n>`
 * right before it (again if a press is retried), `input:<n>:end` once the
 * view has moved, every visible row is real, and it rested `SETTLE_MS`,
 * before the next input's setup. Returns where it rested.
 */
async function send(session: Session, kind: InputKind, index: number): Promise<Settled> {
  const { page } = session;
  const mark = (name: string) => page.evaluate((name) => void performance.mark(name), name);
  // Where the view was right before the input (after a press's setup).
  let before: number | undefined;
  const start = async () => {
    before = (await state(page))?.top;
    await mark(`${INPUT_MARK}${index}`);
  };
  const rest = await restPoint(page);
  if (kind === 'key') {
    await start();
    await page.keyboard.press(index % 2 ? 'PageUp' : 'PageDown');
  } else if (kind === 'track') {
    // Below the middle, then above it: each press jumps.
    await trackPress(session, index % 2 ? 0.4 : 0.6, start);
    await page.mouse.move(rest.x, rest.y);
  } else {
    await page.mouse.move(rest.x, rest.y);
    await start();
    await wheelBy(session, index % 2 ? -WHEEL_PX : WHEEL_PX);
  }
  // Moved, then filled.
  await page.waitForFunction((before) => (globalThis as { __contender?: { state: { top: number } | null } }).__contender?.state?.top !== before, before, { timeout: 5_000, polling: 10 });
  const shown = await filledState(page, 'true', 30_000);
  await page.waitForTimeout(SETTLE_MS);
  await mark(`${INPUT_MARK}${index}:end`);
  return { first: shown.first, end: shown.end };
}

await runMetric<Run>(
  'response',
  async ({ side, profile, url }) => {
    const session = await openSide(side, url, profile, { init: [inputRecorder, ...(side === 'gpui' ? [gpuiProbe] : [domProbe, paintRecorder])] });
    const { page, browser } = session;
    try {
      await opened(session);
      await pressProbeKey(page);
      // The middle of the file: room both ways.
      await page.evaluate(() => (globalThis as { __contender?: { replay: { jump(fraction: number): Promise<void> } } }).__contender!.replay.jump(0.5));
      await page.waitForTimeout(SETTLE_MS);
      const readings: InputReading[] = [];
      const failures = [...session.problems];
      for (const kind of KINDS) {
        await browser.startTracing(page, { categories: LATENCY_CATEGORIES });
        await page.evaluate((name) => void performance.mark(name), ORIGIN_MARK);
        const settled: Settled[] = [];
        for (let index = 0; index < INPUTS; index++) settled.push(await send(session, kind, index));
        const trace = new Trace(JSON.parse((await browser.stopTracing()).toString()));
        const read = readInputs(trace, side, kind, settled, side === 'tanstack' ? await paints(page) : []);
        readings.push(...read);
        read.forEach((reading, index) => {
          if (reading.ms === null) failures.push(`${kind} ${index}: no EventLatency reached a frame`);
          else if (!reading.guard.agrees) failures.push(`${kind} ${index}: EventLatency ${reading.ms} ms, its ${reading.guard.by} ${reading.guard.ms ?? 'saw no frame'}${reading.guard.ms === null ? '' : ' ms'}`);
          if (reading.realMs === null) failures.push(`${kind} ${index}: no reading of the rows being real`);
        });
      }
      return { readings, failures };
    } finally {
      await session.close();
    }
  },
  (runs) =>
    Object.fromEntries(
      KINDS.map((kind) => {
        const of = (run: Run) => run.readings.filter((reading) => reading.kind === kind);
        const p50 = (values: (number | null)[]) => {
          const numbers = values.filter((value): value is number => value !== null);
          return numbers.length ? percentiles(numbers).p50 : null;
        };
        return [
          kind,
          {
            // Each run's median input, then the median over runs.
            ms: medianOf(runs, (run) => p50(of(run).map((reading) => reading.ms))),
            realMs: medianOf(runs, (run) => p50(of(run).map((reading) => reading.realMs))),
            guarded: `${runs.flatMap(of).filter((reading) => reading.guard.agrees).length}/${runs.flatMap(of).length}`,
            types: [...new Set(runs.flatMap(of).map((reading) => reading.type))],
          },
        ];
      }),
    ),
  { inputsPerKind: INPUTS, wheelPx: WHEEL_PX },
);
