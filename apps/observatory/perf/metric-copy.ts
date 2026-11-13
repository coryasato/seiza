// The wide sheet's copies, on either bare contender page, cold, at the
// default stop alone (a copy's reads and text don't depend on the
// density): three copies, each from a cold view of its own (a new browser,
// the open's visible pages loaded and quiet, nothing else read), through
// real input, each timed from the key's event (its `timeStamp`) to the
// copy's marks (`docs/contender-contract.md`, "Marks"):
//
// - the block: the visible block selected by a drag (the first column's
//   top cell to the last row and column wholly in view: every page in
//   hand), Cmd+C → started, copied, written;
// - the week: Jan 1–7 (a header press on Jan 1, Shift+press on Jan 7:
//   74,424 cells, under the key's limit), Cmd+C → the text all in →
//   written; a block of a few columns reads every page, beside the cache;
// - the sheet: Cmd+A, Cmd+C declined (`copy-declined` alone: the key's
//   limit; the control, below), then Cmd+C again, confirmed: 3.9 M cells,
//   ~18 MiB.
//
// Per copy: key → started, → copied, → written; the cells and the text's
// bytes (`__contender.copy`); the page reads sent the engine from the key
// to the write (`pageReadRecorder`: DuckDB reads the file in its worker);
// and from a light trace over the same span (tasks and frames alone), the
// main thread's busy time, in frames and outside them (where a copy's
// turns run).
//
// Then the view meanwhile, in the sheet's session: the scrolls' steady
// gesture down (`SCROLLS.down`) from the top with the sheet selected, alone,
// then again started right after the sheet's confirmed key (the table's
// own method, `components/tall-table/perf/copy.ts`), each traced on its
// own and ended at its rest, as `metric-scroll` reads it: the frames that
// drew new cells (`drewShare`; GPUI's presented frames, the DOM's
// `domDrawn`), their work p50 and p95, late frames (`frameRecorder`'s
// animation frames over the scroll), the main thread's time outside
// frames. A copy that ends before the scroll rests is said: `coveredPct`,
// the share of the key → the scroll's rest the copy ran through.
//
// The control: the sheet's first key sets `copy-declined` and neither
// `copy-started` nor `copied` within `DECLINED_WAIT_MS`, and the state says
// declined; a run where it doesn't fails.
//
// Usage: node apps/observatory/perf/metric-copy.ts [--side gpui|tanstack]
//          [--runs 10] [--profile reference|throttled] [--label <name>]
// Run `just observatory gpui-build wide` and `tanstack-build wide` first.

import type { Page } from '@playwright/test';
import { frameIntervals, recordedBetween, waitMark, workBetween, workRecorder } from '../../../shared-web/perf/harness.ts';
import { percentiles } from '../../../shared-web/perf/protocol.ts';
import { FRAME_MS, ORIGIN_MARK, SCROLLS, Trace, WORK_CATEGORIES, domDrawn, drewShare, frameWork, lateFrames } from '../metrics/metrics.ts';
import { WIDE_SHEET } from '../contenders/scenarios.ts';
import { COPY_MARKS } from '../contenders/tools.ts';
import { dataReads, filledState, frameRecorder, gesture, inputRecorder, jump, keys, medianOf, now, opened, openSide, quiet, pageReadRecorder, pageReads, restPoint, runMetric, scrollRest, wideStop, type RunContext, type RunResult, type Session } from './contender.ts';

/** A copy's light trace: the marks (the trace's origin), the tasks, and
 *  the frames; no frame parts, so a long throttled copy's trace stays small. */
const COPY_CATEGORIES = ['blink.user_timing', 'toplevel', 'benchmark'];
/** The longest a copy may take, throttled. */
const COPY_TIMEOUT_MS = 300_000;
/** After a declined key, how long nothing else may be marked. */
const DECLINED_WAIT_MS = 500;
/** A scroll has ended once nothing has drawn for this long (`metric-scroll`'s). */
const REST_MS = 300;

type CopyName = 'block' | 'week' | 'sheet';
const COPIES: CopyName[] = ['block', 'week', 'sheet'];

interface Layout {
  left: number;
  top: number;
  rowHeight: number;
  cellsWidth: number;
  columns: { name: string; x: number; width: number }[];
}
type Selection = { kind: string; anchor: [number, number]; head: [number, number] };
type Contender = { layout?: Layout; selection?: Selection | null; copy?: { state: string; bytes?: number } };

interface Copy {
  cells: number;
  bytes: number;
  /** The key's event → each mark, ms. */
  startedMs: number;
  copiedMs: number;
  writtenMs: number;
  /** Page reads sent the engine from the key to the write (`pageReadRecorder`). */
  reads: number;
  /** The main thread over the key → the write, ms: busy, and outside frames. */
  busyMs: number;
  outsideFramesMs: number;
}

interface Scroll {
  drew: number;
  share: number;
  workP50Ms: number;
  workP95Ms: number;
  latePct: number;
  busyMs: number;
  outsideFramesMs: number;
  /** The gesture's start → its rest, ms. */
  restMs: number;
}

interface Run extends RunResult {
  copies: Record<CopyName, Copy>;
  /** The sheet's first key: → `copy-declined`, ms; the marks it set. */
  declined: { ms: number; marks: string[] };
  scroll: Scroll;
  scrollCopying: Scroll & { coveredPct: number };
}

const contender = <K extends keyof Contender>(page: Page, key: K) => page.evaluate((key) => (globalThis as { __contender?: Contender }).__contender?.[key] ?? null, key) as Promise<Contender[K] | null>;

/** Until `__contender.selection` is `want`. */
async function selected(page: Page, want: Selection, where: string): Promise<void> {
  await page
    .waitForFunction(
      (want) => {
        const got = (globalThis as { __contender?: Contender }).__contender?.selection;
        return got && got.kind === want.kind && got.anchor.join() === want.anchor.join() && got.head.join() === want.head.join();
      },
      want,
      { timeout: 10_000 },
    )
    .catch(async () => {
      throw new Error(`${where}: selection ${JSON.stringify(await contender(page, 'selection'))}, not ${JSON.stringify(want)}`);
    });
}

/** The copy's marks since `since`, in order of time. */
const marksSince = (page: Page, since: number): Promise<{ name: string; at: number }[]> =>
  page.evaluate(
    ({ names, since }) =>
      performance
        .getEntriesByType('mark')
        .filter((entry) => names.includes(entry.name) && entry.startTime >= since)
        .sort((a, b) => a.startTime - b.startTime)
        .map((entry) => ({ name: entry.name, at: entry.startTime })),
    { names: Object.values(COPY_MARKS) as string[], since },
  );

/** The key's event time: the last keydown at or after `since` (Cmd's, then C's). */
async function keyAt(page: Page, since: number): Promise<number> {
  const at = (await keys(page)).filter((t) => t >= since).at(-1);
  if (at === undefined) throw new Error('no keydown recorded for the copy');
  return at;
}

/** Cmd+C on the selection, traced lightly to the write: the copy's readings. */
async function timedCopy(session: Session, cells: number): Promise<Copy> {
  const { page, browser } = session;
  await browser.startTracing(page, { categories: COPY_CATEGORIES });
  const since = await page.evaluate((name) => (performance.mark(name), performance.now()), ORIGIN_MARK);
  await page.keyboard.press('ControlOrMeta+KeyC');
  const written = await waitMark(page, COPY_MARKS.written, since, COPY_TIMEOUT_MS);
  const trace = new Trace(JSON.parse((await browser.stopTracing()).toString()));
  const key = await keyAt(page, since);
  const marks = await marksSince(page, since);
  const order = marks.map((mark) => mark.name).join(' → ');
  const want = [COPY_MARKS.started, COPY_MARKS.copied, COPY_MARKS.written].join(' → ');
  if (order !== want) throw new Error(`marks ${order}, not ${want}`);
  const copy = await contender(page, 'copy');
  if (copy?.state !== 'written') throw new Error(`__contender.copy ${JSON.stringify(copy)}, not written`);
  const work = frameWork(trace, key, written);
  return {
    cells,
    bytes: copy.bytes ?? NaN,
    startedMs: marks[0]!.at - key,
    copiedMs: marks[1]!.at - key,
    writtenMs: marks[2]!.at - key,
    reads: await pageReads(page, key, written),
    busyMs: work.busyMs,
    outsideFramesMs: work.busyMs - work.inFramesMs,
  };
}

/** A cold view of the wide sheet's default stop, filled and quiet, the
 *  clipboard granted, its layout and rows. */
async function coldView(context: RunContext): Promise<{ session: Session; layout: Layout; rows: number }> {
  let reads: ReturnType<typeof dataReads> | undefined;
  const session = await openSide(context.side, context.url, context.profile, {
    picked: context.picked,
    init: context.side === 'gpui' ? [inputRecorder, pageReadRecorder, workRecorder, frameRecorder] : [inputRecorder, pageReadRecorder, frameRecorder],
    before: async (page) => void (reads = dataReads(page)),
  });
  try {
    await session.context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(context.url).origin });
    const { state: open } = await opened(session);
    await quiet(session.page, reads!.inFlight);
    const layout = await contender(session.page, 'layout');
    if (!layout) throw new Error('no __contender.layout with ?measure');
    return { session, layout, rows: open.rows };
  } catch (error) {
    await session.close();
    throw error;
  }
}

/** Cell `[row, column]`'s center, at the top with no sideways scroll. */
const cellAt = (layout: Layout, row: number, column: number): [number, number] => [layout.left + layout.columns[column]!.x + layout.columns[column]!.width / 2, layout.top + (row + 0.5) * layout.rowHeight];
const headerY = (layout: Layout) => layout.top - Math.min(8, layout.rowHeight / 2);

/** The steady gesture down from the top, traced on its own, to its rest,
 *  as `metric-scroll` reads it; `before` runs right before the gesture,
 *  inside the window. */
async function tracedScroll(session: Session, before?: () => Promise<void>): Promise<Scroll & { from: number; restAt: number }> {
  const { page, browser, side } = session;
  await browser.startTracing(page, { categories: WORK_CATEGORIES });
  const from = await page.evaluate((name) => (performance.mark(name), performance.now()), ORIGIN_MARK);
  await before?.();
  await gesture(session, SCROLLS.down);
  // The rest itself, and the window 100 ms past it (as `metric-scroll`'s).
  const restAt = await scrollRest(page, side, from, REST_MS);
  const rested = restAt + 100;
  const trace = new Trace(JSON.parse((await browser.stopTracing()).toString()));
  const drawn = side === 'gpui' ? (await workBetween(page, from, rested)).map((sample) => ({ at: sample.t, ms: sample.ms })) : domDrawn(frameWork(trace, from, rested));
  const share = drewShare(drawn.map((frame) => frame.at));
  if (!share) throw new Error(`the scroll down: ${drawn.length} frames drew new cells`);
  const p = percentiles(drawn.map((frame) => frame.ms));
  const work = frameWork(trace, from, rested);
  const rafs = await recordedBetween(page, drawn[0]!.at, drawn.at(-1)!.at);
  return {
    drew: share.drew,
    share: share.share,
    workP50Ms: p.p50,
    workP95Ms: p.p95,
    latePct: lateFrames(frameIntervals(rafs), FRAME_MS).share * 100,
    busyMs: work.busyMs,
    outsideFramesMs: work.busyMs - work.inFramesMs,
    restMs: restAt - from,
    from,
    restAt,
  };
}

/** Back to the top, at rest, with the sheet selected again: the replay's
 *  jump moves the selection to the row it lands on. */
async function home(session: Session, sheet: Selection): Promise<void> {
  const { page, side } = session;
  const since = await now(page);
  await jump(page, 0);
  await filledState(page, 's.first === 0', 60_000);
  await scrollRest(page, side, since, REST_MS);
  await page.keyboard.press('ControlOrMeta+KeyA');
  await selected(page, sheet, 'back at the top, Cmd+A');
}

await runMetric<Run>(
  'copy',
  async (context) => {
    if (!wideStop(context.picked)) throw new Error('metric copy: the wide sheet alone (--scenario wide-sheet)');
    const failures: string[] = [];
    const copies = {} as Record<CopyName, Copy>;
    const jan1 = WIDE_SHEET.heatFrom;

    // The block: a drag over the visible block, then Cmd+C.
    {
      const { session, layout } = await coldView(context);
      const { page } = session;
      try {
        const height = await page.evaluate(() => innerHeight);
        const rows = Math.floor((height - layout.top) / layout.rowHeight) - 2;
        const lastColumn = layout.columns.findLastIndex((column) => column.x + column.width <= layout.cellsWidth);
        await page.mouse.move(...cellAt(layout, 0, 0));
        await page.mouse.down();
        await page.mouse.move(...cellAt(layout, rows - 1, lastColumn), { steps: 10 });
        await page.mouse.up();
        await selected(page, { kind: 'cells', anchor: [0, 0], head: [rows - 1, lastColumn] }, 'block');
        copies.block = await timedCopy(session, rows * (lastColumn + 1));
        if (copies.block.reads) failures.push(`block: ${copies.block.reads} page reads for a block in view`);
        failures.push(...session.problems.map((problem) => `block: ${problem}`));
      } finally {
        await session.close();
      }
    }

    // The week: Jan 1's header, Shift+Jan 7's, then Cmd+C.
    {
      const { session, layout, rows } = await coldView(context);
      const { page } = session;
      try {
        await page.mouse.click(cellAt(layout, 0, jan1)[0], headerY(layout));
        await page.keyboard.down('Shift');
        await page.mouse.click(cellAt(layout, 0, jan1 + 6)[0], headerY(layout));
        await page.keyboard.up('Shift');
        await selected(page, { kind: 'columns', anchor: [0, jan1], head: [0, jan1 + 6] }, 'week');
        copies.week = await timedCopy(session, rows * 7);
        failures.push(...session.problems.map((problem) => `week: ${problem}`));
      } finally {
        await session.close();
      }
    }

    // The sheet: Cmd+A, Cmd+C declined (the control), Cmd+C confirmed; then
    // the view meanwhile.
    const { session, layout, rows } = await coldView(context);
    const { page } = session;
    try {
      const sheet: Selection = { kind: 'columns', anchor: [0, 0], head: [0, layout.columns.length - 1] };
      // A cell pressed first, as a visitor would: Cmd+A on a cold view, the
      // table not yet focused, selects nothing of the sheet.
      await page.mouse.click(...cellAt(layout, 0, jan1));
      await selected(page, { kind: 'cells', anchor: [0, jan1], head: [0, jan1] }, 'sheet: the cell pressed');
      await page.keyboard.press('ControlOrMeta+KeyA');
      await selected(page, sheet, 'sheet: Cmd+A');
      const decline = async (): Promise<{ ms: number; marks: string[] }> => {
        const since = await now(page);
        await page.keyboard.press('ControlOrMeta+KeyC');
        const at = await waitMark(page, COPY_MARKS.declined, since, 10_000);
        await page.waitForTimeout(DECLINED_WAIT_MS);
        const marks = (await marksSince(page, since)).map((mark) => mark.name);
        if (marks.join() !== COPY_MARKS.declined) failures.push(`sheet: the first key set ${marks.join(' → ')}, not ${COPY_MARKS.declined} alone`);
        const copy = await contender(page, 'copy');
        if (copy?.state !== 'declined') failures.push(`sheet: __contender.copy ${copy?.state} after the first key, not declined`);
        return { ms: at - (await keyAt(page, since)), marks };
      };
      const declined = await decline();
      copies.sheet = await timedCopy(session, rows * layout.columns.length);

      // The view meanwhile: the scroll alone, then started right after the
      // sheet's confirmed key (its first key declined, as on any new
      // selection of it).
      const rest = await restPoint(page);
      await page.mouse.move(rest.x, rest.y);
      await home(session, sheet);
      const { from: _a, restAt: _b, ...scroll } = await tracedScroll(session);
      await home(session, sheet);
      await decline();
      let key = 0;
      const during = await tracedScroll(session, async () => {
        const since = await now(page);
        await page.keyboard.press('ControlOrMeta+KeyC');
        key = await keyAt(page, since);
      });
      const written = await waitMark(page, COPY_MARKS.written, key, COPY_TIMEOUT_MS);
      const { from: _c, restAt, ...copying } = during;
      // The share of the key → the scroll's rest (not the window's end past
      // it) the copy ran through.
      const coveredPct = ((Math.min(written, restAt) - key) / (restAt - key)) * 100;
      failures.push(...session.problems.map((problem) => `sheet: ${problem}`));
      return { copies, declined, scroll, scrollCopying: { ...copying, coveredPct }, failures };
    } finally {
      await session.close();
    }
  },
  (runs) => {
    const copy = (name: CopyName) => {
      const read = (run: Run) => run.copies[name];
      return {
        cells: medianOf(runs, (run) => read(run).cells, 0),
        bytes: medianOf(runs, (run) => read(run).bytes, 0),
        startedMs: medianOf(runs, (run) => read(run).startedMs, 2),
        copiedMs: medianOf(runs, (run) => read(run).copiedMs),
        writtenMs: medianOf(runs, (run) => read(run).writtenMs),
        writtenMsRuns: runs.map((run) => Number(read(run).writtenMs.toFixed(1))),
        reads: medianOf(runs, (run) => read(run).reads, 0),
        busyMs: medianOf(runs, (run) => read(run).busyMs),
        outsideFramesMs: medianOf(runs, (run) => read(run).outsideFramesMs),
      };
    };
    const scroll = (pick: (run: Run) => Scroll) => ({
      drewPct: medianOf(runs, (run) => pick(run).share * 100),
      workP50Ms: medianOf(runs, (run) => pick(run).workP50Ms, 2),
      workP95Ms: medianOf(runs, (run) => pick(run).workP95Ms, 2),
      latePct: medianOf(runs, (run) => pick(run).latePct),
      outsideFramesMs: medianOf(runs, (run) => pick(run).outsideFramesMs),
      restMs: medianOf(runs, (run) => pick(run).restMs),
    });
    return {
      ...Object.fromEntries(COPIES.map((name) => [name, copy(name)])),
      declinedMs: medianOf(runs, (run) => run.declined.ms, 2),
      scroll: scroll((run) => run.scroll),
      scrollCopying: { ...scroll((run) => run.scrollCopying), coveredPct: medianOf(runs, (run) => run.scrollCopying.coveredPct) },
    };
  },
  { copies: { block: 'the visible block, by a drag', week: `Jan 1–7, columns ${WIDE_SHEET.heatFrom}–${WIDE_SHEET.heatFrom + 6}`, sheet: 'Cmd+A, declined, then confirmed' }, scroll: SCROLLS.down, restMs: REST_MS, copyCategories: COPY_CATEGORIES },
  { levels: ['wide'], defaultStop: WIDE_SHEET.defaultStop },
);
