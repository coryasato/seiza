// `find` in the bare host: a step's time to the frame drawing its match
// (the table's own work: the answer taken, the current match set, the view
// brought to it, the frame drawn) and to that frame with every row real.
// Per shape, cold, a fresh browser each session, median of `--runs`. The
// source answers at once: the term (`--term`, `1`) matches nearly every
// cell, so a scan ends in its first window, after the host's least wait
// between windows (1 ms) and its first cell's test. Each session, `--cycles`
// times (3): the term set afresh (no current match, the view at the top),
// a step back (the cell before the top row's first: none to the start, so
// it comes round from the last row's last match: far, wrapped), a step on
// (none to the end, round to the first match at the top: far, wrapped),
// then `NEAR_STEPS` steps on (each the next matching cell: in view, or in
// the wide shape now and then sideways past the view's right edge). Each
// step is classed by where its landing frame stands against the view
// before it: `far` (the top moved), `sideways` (only the sideways scroll),
// or `in view` (neither).
//
// The step's time is the hook's call (page time, in the call's task); the
// answer's is when the host's bridge sets `__tallTableFound` to the step's
// end (a setter installed before the page's scripts), in the task the
// table takes the answer in; the frames are `presentedRecorder`'s, each with
// the host's `__seizaFrameSample` (the probe's `find` among it). So → answer
// is the source's (the host's), answer → drawn and answer → filled the
// table's. The recorder stays on through the steps, as `sort.ts`'s through
// its clicks: its wrapper (a flag test on each GPU call and a microtask a
// frame) is inside both, the same in every build measured.
//
// Usage: node components/tall-table/perf/find.ts [--runs 10] [--shape narrow|wide]
//          [--profile reference|throttled] [--cycles 3] [--term 1] [--label <name>]
// --label writes perf/results/<date>-<label>.json. Run
// `just tall-table build find` first.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright';
import { open, presentedRecorder, waitMark, type RecordedFrame } from '../../../shared-web/perf/harness.ts';
import { PROFILES, localDate, machineInfo, median, option, type Profile } from '../../../shared-web/perf/protocol.ts';
import { serveApp } from '../../../shared-web/perf/serve.ts';
import { FILLED_MARK, FIND_NEXT_HOOK, FIND_PREVIOUS_HOOK, FOUND_GLOBAL, PORT, SHAPES, buildName, builtFeatures, filledWhere, findThrough, hostWebDir, perfDir, pick, shown, type Found, type Shape, type Shown } from './harness.ts';

const RUNS = Number(option('runs') ?? 10);
const CYCLES = Number(option('cycles') ?? 3);
const TERM = option('term') ?? '1';
const shapes = pick('shape', SHAPES);
const profiles = pick('profile', PROFILES.map((profile) => profile.name)).map((name) => PROFILES.find((profile) => profile.name === name)!);
for (const [name, value] of [['runs', RUNS], ['cycles', CYCLES]] as const) if (!(Number.isInteger(value) && value > 0)) throw new Error(`--${name} ${option(name)}: not a positive whole number`);
if (!TERM) throw new Error('--term: an empty term is no find');
const features = builtFeatures();
if (!features.includes('find')) throw new Error('needs the host built with find: `just tall-table build find`');

/** Steps on from the first match, each cycle. */
const NEAR_STEPS = 8;
/** After a step's frame is filled, this long before the next. */
const SETTLE_MS = 300;

type Kind = 'far' | 'sideways' | 'in view';
type Sample = Pick<Shown, 'top' | 'first' | 'end' | 'loaded' | 'scrollX' | 'find'>;
type Presented = RecordedFrame<Sample>;

interface Step {
  kind: Kind;
  backward: boolean;
  wrapped: boolean;
  /** The call → the answer taken, → the first frame drawing the match as
   *  current, → the first such frame with every row real; and the answer's
   *  part of each (the table's). */
  answerMs: number;
  drawnMs: number;
  filledMs: number;
  tableDrawnMs: number;
  tableFilledMs: number;
}

const round = (ms: number) => Number(ms.toFixed(2));

/** An init script: each value the bridge sets on `__tallTableFound`,
 *  timed, on `__tallTableFoundAt`. */
function foundRecorder(): void {
  const g = globalThis as Record<string, unknown>;
  const at: { t: number; value: unknown }[] = [];
  g.__tallTableFoundAt = at;
  let value: unknown;
  Object.defineProperty(globalThis, '__tallTableFound', {
    configurable: true,
    get: () => value,
    set: (next) => {
      value = next;
      at.push({ t: performance.now(), value: next });
    },
  });
}

/** One step: its times from the hook's call. */
async function step(page: Page, backward: boolean): Promise<Step> {
  const before = (await shown(page)).shown;
  const { called, foundFrom, framesFrom } = await page.evaluate((hook) => {
    const g = globalThis as unknown as { __tallTableFoundAt: unknown[]; __seizaPresented: unknown[] } & Record<string, () => void>;
    const foundFrom = g.__tallTableFoundAt.length;
    const framesFrom = g.__seizaPresented.length;
    const called = performance.now();
    g[hook]!();
    return { called, foundFrom, framesFrom };
  }, backward ? FIND_PREVIOUS_HOOK : FIND_NEXT_HOOK);
  // A constant-time poll while the step is timed: the step's end, then the
  // probe's current match at it with its rows real.
  const found = (await page
    .waitForFunction(
      ({ name, foundFrom }) => {
        const at = (globalThis as unknown as { __tallTableFoundAt: { value: { outcome: string } }[] }).__tallTableFoundAt;
        const end = at.slice(foundFrom).find((entry) => entry.value.outcome !== 'started');
        return end ? (globalThis as unknown as Record<string, unknown>)[name] : false;
      },
      { name: FOUND_GLOBAL, foundFrom },
      { timeout: 30_000, polling: 10 },
    )
    .then((handle) => handle.jsonValue())) as Found;
  if (found.outcome !== 'match' || !found.cell) throw new Error(`a step ${backward ? 'back' : 'on'}: ${found.outcome}${found.message ? ` (${found.message})` : ''}`);
  const cell = found.cell;
  await filledWhere(page, `s.find && s.find.current && s.find.current.row === ${cell.row} && s.find.current.column === ${cell.column}`, 30_000);
  const read = await page.evaluate(
    ({ foundFrom, framesFrom, cell }) => {
      const g = globalThis as unknown as { __tallTableFoundAt: { t: number; value: { outcome: string } }[]; __seizaPresented: Presented[] };
      const answer = g.__tallTableFoundAt.slice(foundFrom).find((entry) => entry.value.outcome !== 'started')?.t;
      const frames = g.__seizaPresented.slice(framesFrom).filter((frame) => frame.find?.current?.row === cell.row && frame.find.current.column === cell.column);
      const filled = frames.find((frame) => frame.loaded === frame.end - frame.first);
      return answer !== undefined && frames[0] && filled ? { answer, drawn: frames[0], filled: filled.t } : null;
    },
    { foundFrom, framesFrom, cell },
  );
  if (!read) throw new Error(`a step ${backward ? 'back' : 'on'} to ${JSON.stringify(cell)}: no answer or presented frame recorded`);
  const { answer, drawn, filled } = read;
  const kind: Kind = drawn.top !== before.top ? 'far' : Math.abs(drawn.scrollX - before.scrollX) > 0.01 ? 'sideways' : 'in view';
  return { kind, backward, wrapped: found.wrapped, answerMs: round(answer - called), drawnMs: round(drawn.t - called), filledMs: round(filled - called), tableDrawnMs: round(drawn.t - answer), tableFilledMs: round(filled - answer) };
}

/** One cold session of `shape`: `CYCLES` cycles of a fresh term, a step
 *  back and on (far, each wrapped), and `NEAR_STEPS` on. */
async function session(url: string, shape: Shape, profile: Profile, failures: string[]): Promise<Step[]> {
  let browsing: Awaited<ReturnType<typeof open>> | null = null;
  try {
    browsing = await open(chromium, url, { profile, params: { shape }, init: [foundRecorder] });
    const { page } = browsing;
    await waitMark(page, FILLED_MARK, 0, 60_000);
    await page.evaluate(presentedRecorder);
    const steps: Step[] = [];
    for (let index = 0; index < CYCLES; index++) {
      await findThrough(page, null);
      await findThrough(page, TERM);
      await page.waitForTimeout(SETTLE_MS);
      for (const backward of [true, ...Array<boolean>(NEAR_STEPS + 1).fill(false)]) {
        const done = await step(page, backward);
        const far = steps.length % (NEAR_STEPS + 2) < 2;
        if (far && !(done.kind === 'far' && done.wrapped)) failures.push(`${shape} ${profile.name}: a step ${backward ? 'back' : 'on'} from ${backward ? 'the top' : 'the last row'} landed ${done.kind}${done.wrapped ? '' : ', not wrapped'}`);
        steps.push(done);
        await page.waitForTimeout(SETTLE_MS);
      }
    }
    failures.push(...browsing.problems.map((problem) => `${shape} ${profile.name}: ${problem}`));
    return steps;
  } catch (error) {
    failures.push(`${shape} ${profile.name}: ${(error as Error).message.split('\n')[0]}`);
    return [];
  } finally {
    await browsing?.close();
  }
}

const KEYS = ['answerMs', 'drawnMs', 'filledMs', 'tableDrawnMs', 'tableFilledMs'] as const;
type Summary = { steps: number } & Record<(typeof KEYS)[number], number>;

/** The medians of `steps`, or null for none. */
function summary(steps: Step[]): Summary | null {
  if (!steps.length) return null;
  return { steps: steps.length, ...(Object.fromEntries(KEYS.map((key) => [key, round(median(steps.map((step) => step[key])))])) as Record<(typeof KEYS)[number], number>) };
}

const KINDS: Kind[] = ['far', 'sideways', 'in view'];
const server = await serveApp(undefined, { webDir: hostWebDir, port: PORT });
const failures: string[] = [];
const results: Record<string, Record<string, { runs: Partial<Record<Kind, Summary>>[]; summary: Partial<Record<Kind, Record<string, number>>> }>> = {};
console.log(`build: ${buildName(features)}, term ${JSON.stringify(TERM)}, ${CYCLES} cycles a session`);
try {
  for (const shape of shapes) {
    for (const profile of profiles) {
      const runs: Partial<Record<Kind, Summary>>[] = [];
      for (let index = 0; index < RUNS; index++) {
        const steps = await session(server.url, shape, profile, failures);
        if (!steps.length) continue;
        const run = Object.fromEntries(KINDS.map((kind) => [kind, summary(steps.filter((step) => step.kind === kind))]).filter(([, value]) => value)) as Partial<Record<Kind, Summary>>;
        runs.push(run);
        console.log(`${shape} ${profile.name} ${index + 1}/${RUNS}: ${KINDS.filter((kind) => run[kind]).map((kind) => `${kind} (${run[kind]!.steps}) → answer ${run[kind]!.answerMs}, → drawn ${run[kind]!.drawnMs} (table ${run[kind]!.tableDrawnMs}), → filled ${run[kind]!.filledMs} ms`).join('; ')}`);
      }
      const totals: Partial<Record<Kind, Record<string, number>>> = {};
      for (const kind of KINDS) {
        const of = runs.map((run) => run[kind]).filter((run): run is Summary => Boolean(run));
        if (!of.length) continue;
        const numbers = Object.fromEntries(KEYS.map((key) => [key, round(median(of.map((run) => run[key])))]));
        const spread = (Math.max(...of.map((run) => run.tableDrawnMs)) - Math.min(...of.map((run) => run.tableDrawnMs))) / (numbers.tableDrawnMs || 1);
        totals[kind] = { runs: of.length, steps: of.reduce((sum, run) => sum + run.steps, 0), ...numbers, tableDrawnSpread: round(spread) };
        console.log(`  ${shape} ${profile.name} ${kind} (median of ${of.length}): → answer ${numbers.answerMs} ms, → drawn ${numbers.drawnMs} ms (the table's ${numbers.tableDrawnMs}, spread ${(spread * 100).toFixed(1)}%), → filled ${numbers.filledMs} ms (the table's ${numbers.tableFilledMs})`);
      }
      (results[shape] ??= {})[profile.name] = { runs, summary: totals };
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
  const protocol = { browser: 'chromium headless=new', viewport: '1440x900', dpr: 2, runs: RUNS, cold: true, cycles: CYCLES, term: TERM, nearSteps: NEAR_STEPS, settleMs: SETTLE_MS, build: buildName(features) };
  writeFileSync(out, `${JSON.stringify({ date, label, ...machineInfo(), protocol, results, failures }, null, 2)}\n`);
  console.log(`wrote ${out}`);
}
if (failures.length) {
  console.error(`FAIL\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
