// The engine end to end on the page, in Chromium, Firefox, and WebKit
// (`engines/duckdb/CLAUDE.md`, "Tests"): its self-test, the two ways it goes
// down, and Retry after each. Every run has `?selftest`, which runs once the
// engine's lockdown settles, after each Ready: so the self-test runs again
// after every Retry. Three runs a browser:
//
// 1. Self-test: `__tychoSelftest` passes (SELECT 42, every type the table
//    shows, cancel within 200 ms and a query after it), after the lock.
// 2. Failed load: the engine's chunk (the dynamic import that loads
//    DuckDB-Wasm) is refused. The status bar says the engine didn't load and
//    shows Retry; nothing is locked. Let through, the status bar's Retry
//    loads it: the lock is reported, the self-test passes, and the sample
//    opens.
// 3. Stopped worker: with the sample open, DuckDB's worker throws. The app
//    hears at its next call (End, pressed in the table): the file closes,
//    the status bar says the engine stopped and shows Retry, and nothing
//    starts an engine until it's pressed. Retry starts a new worker: the
//    lock is reported again, the self-test passes again, and the sample
//    opens and reads to its end.
//
// Against the dev server by default (`just tycho dev`); pass the preview's
// URL for the release build.
// Usage: node apps/tycho/perf/engine.ts [url] [--only chromium,firefox,webkit]
// (or --only=…; any other flag is refused)

import { chromium, firefox, webkit, type BrowserContext, type BrowserType, type Page, type Worker } from '@playwright/test';
import { waitMark } from '../../../shared-web/perf/harness.ts';

const url = new URL(process.argv.find((arg) => /^https?:/.test(arg)) ?? 'http://localhost:5173/');
url.searchParams.set('bench', '');
url.searchParams.set('selftest', '');
const TIMEOUT = 60_000;
const LOCKED_MARK = 'tycho:engine-locked';
const FILE_SHOWN_MARK = 'tycho:file-shown';
const ENGINE_START_MARK = 'duckdb:engine-start';
/** The engine's chunk: built, `assets/engine-<hash>.js`; on the dev
 *  server, the engine package's `engine.ts`. A retry asks for it again
 *  under `?retry=<n>`, which matches too. */
const ENGINE_CHUNK = /\/(assets\/engine-[\w-]+\.js|engines\/duckdb\/web\/src\/engine\.ts)(\?|$)/;
/** What the page logs because the check broke something on purpose. */
const EXPECTED_ERRORS = /engine-[\w-]+\.js|engine\.ts|dynamically imported module|Importing a module script failed|error loading dynamically imported|test: the worker stopped|^ErrorEvent$|Failed to load resource|net::ERR_FAILED|access control checks/;

interface Outcome {
  what: string;
  ok: boolean;
  detail: string;
}

interface Selftest {
  ok: boolean;
  checks: { name: string; ok: boolean; detail: string; ms: number | null }[];
}

type CheckGlobal = {
  __tychoWorkbench?: { state: string; name: string | null; rows: number | null; engine: string; message: string | null; status: string | null };
  __tychoSelftest?: Selftest;
  __tychoTable?: { rows: number; first: number; end: number; loaded: number; pending: number; failed: number };
  /** Error events the page's workers have dispatched, counted by `countWorkerErrors`. */
  __checkWorkerErrors?: number;
};

/** Counts the error events every worker the page makes dispatches to the
 *  page, so the stopped run presses End once the page has heard the throw,
 *  not after a fixed wait. */
function countWorkerErrors() {
  const g = globalThis as CheckGlobal;
  g.__checkWorkerErrors = 0;
  const Base = globalThis.Worker;
  globalThis.Worker = class extends Base {
    constructor(...args: ConstructorParameters<typeof Worker>) {
      super(...args);
      this.addEventListener('error', () => {
        g.__checkWorkerErrors = (g.__checkWorkerErrors ?? 0) + 1;
      });
    }
  };
}

const workbench = (page: Page) => page.evaluate(() => (globalThis as CheckGlobal).__tychoWorkbench ?? null);

const waitWorkbench = (page: Page, test: string, timeout = TIMEOUT) =>
  page.waitForFunction(
    // A predicate over the probe, as text: Playwright can't pass a closure.
    (test) => {
      const w = (globalThis as CheckGlobal).__tychoWorkbench;
      return w ? (new Function('w', `return ${test}`) as (w: unknown) => boolean)(w) : false;
    },
    test,
    { timeout },
  );

const marks = (page: Page, name: string) => page.evaluate((name) => performance.getEntriesByName(name, 'mark').map((mark) => mark.startTime), name);

/** Waits for a self-test report, then reads it. `retry` deletes the last
 *  one before its press, so after a Retry this is the new engine's. */
async function selftest(page: Page): Promise<Outcome> {
  await page.waitForFunction(() => !!(globalThis as CheckGlobal).__tychoSelftest, null, { timeout: TIMEOUT });
  const report = (await page.evaluate(() => (globalThis as CheckGlobal).__tychoSelftest!)) as Selftest;
  return {
    what: 'the self-test passes',
    ok: report.ok,
    detail: report.checks.map((check) => `${check.ok ? '' : 'FAIL '}${check.name}: ${check.detail}`).join('; '),
  };
}

/** The status bar shows Retry, and the engine's state is `state`. */
async function retryShown(page: Page, state: string): Promise<Outcome> {
  await waitWorkbench(page, `w.engine === ${JSON.stringify(state)}`);
  const retry = page.locator('footer [data-action=retry]');
  await retry.waitFor({ state: 'visible', timeout: TIMEOUT });
  const shown = await workbench(page);
  const footer = (await page.locator('footer').innerText()).replace(/\s+/g, ' ').trim();
  return { what: `the status bar shows the engine ${state}, with Retry`, ok: shown?.engine === state, detail: `"${footer}"; ${shown?.message ?? shown?.status ?? ''}` };
}

/** Presses the first screen's sample row and waits for this open's end: a
 *  new `tycho:file-shown` mark, or a failure other than the one shown
 *  before the press (after a stop, the state is already `failed`). */
async function openSample(page: Page): Promise<Outcome> {
  const before = { shown: (await marks(page, FILE_SHOWN_MARK)).length, message: (await workbench(page))?.message ?? null };
  await page.click('#first [data-action=sample]');
  await page.waitForFunction(
    ({ name, before }) => {
      const w = (globalThis as CheckGlobal).__tychoWorkbench;
      return performance.getEntriesByName(name, 'mark').length > before.shown || (w?.state === 'failed' && w.message !== before.message);
    },
    { name: FILE_SHOWN_MARK, before },
    { timeout: TIMEOUT },
  );
  const shown = await workbench(page);
  return { what: 'the sample opens', ok: shown?.state === 'open' && (shown.rows ?? 0) > 0, detail: `${shown?.state}, ${shown?.rows} rows${shown?.message ? `: ${shown.message}` : ''}` };
}

/** Presses the status bar's Retry and waits for the lock it reports. The
 *  last self-test report is deleted first, so the next one read is the new
 *  engine's (it runs at the lock, which may come before this returns), and
 *  console errors are expected only until the press. */
async function retry(page: Page, locksBefore: number): Promise<Outcome> {
  expectedErrorsEnd = pageErrors.length;
  const pressed = await page.evaluate(() => {
    delete (globalThis as CheckGlobal).__tychoSelftest;
    return performance.now();
  });
  await page.click('footer [data-action=retry]');
  await page.waitForFunction(({ name, before }) => performance.getEntriesByName(name, 'mark').length > before, { name: LOCKED_MARK, before: locksBefore }, { timeout: TIMEOUT });
  const locked = (await marks(page, LOCKED_MARK)).at(-1)!;
  await waitWorkbench(page, "w.engine === 'ready'");
  return { what: 'Retry: the lock is reported again', ok: locked > pressed, detail: `locked ${(locked - pressed).toFixed(0)} ms after the press` };
}

async function selftestRun(page: Page): Promise<Outcome[]> {
  await waitMark(page, LOCKED_MARK);
  return [await selftest(page)];
}

/** The run's console and page errors, and how many of the first are the
 *  check's doing: those before Retry's press (`retry` sets it), which may
 *  match `EXPECTED_ERRORS`. Any error after it fails the run. */
const pageErrors: string[] = [];
let expectedErrorsEnd = 0;

/** Paths of the engine's chunk refused in the failed run. */
const refused: string[] = [];

/** Before the failed run's page loads: the engine starts after the first
 *  frame, which may come before `goto` returns. */
async function refuseChunk(context: BrowserContext): Promise<void> {
  refused.length = 0;
  await context.route(ENGINE_CHUNK, (route) => {
    refused.push(new URL(route.request().url()).pathname);
    return route.abort('failed');
  });
}

async function failedLoadRun(page: Page): Promise<Outcome[]> {
  const outcomes: Outcome[] = [];
  outcomes.push(await retryShown(page, 'failed'));
  const locks = (await marks(page, LOCKED_MARK)).length;
  outcomes.push({ what: 'the chunk was refused, and nothing locked', ok: refused.length > 0 && locks === 0, detail: `refused ${refused.join(', ')}; ${locks} lock marks` });
  await page.context().unroute(ENGINE_CHUNK);
  outcomes.push(await retry(page, locks));
  outcomes.push(await selftest(page));
  outcomes.push(await openSample(page));
  return outcomes;
}

/** DuckDB's worker: the engine's blob: wrapper. */
function duckdbWorker(page: Page): Worker | undefined {
  return page.workers().find((worker) => worker.url().startsWith('blob:'));
}

async function stoppedRun(page: Page): Promise<Outcome[]> {
  const outcomes: Outcome[] = [];
  await waitMark(page, LOCKED_MARK);
  outcomes.push(await selftest(page));
  outcomes.push(await openSample(page));
  const worker = duckdbWorker(page);
  if (!worker) throw new Error(`no DuckDB worker found among ${page.workers().length}: ${page.workers().map((w) => w.url()).join(', ')}`);
  const thrownAt = await page.evaluate(() => performance.now());
  await worker.evaluate(() => {
    setTimeout(() => {
      throw new Error('test: the worker stopped');
    });
  });
  // The app hears of it at its next call: End's page reads, in the table,
  // which has focus once the sample opens. End waits until the page has the
  // worker's error, so its read can't still be answered by the old worker.
  await page.waitForFunction(() => ((globalThis as CheckGlobal).__checkWorkerErrors ?? 0) > 0, null, { timeout: TIMEOUT });
  await page.keyboard.press('End');
  outcomes.push(await retryShown(page, 'stopped'));
  const closed = await workbench(page);
  outcomes.push({ what: 'the open file closes with it', ok: closed?.state === 'failed' && !!closed.message?.includes('stopped'), detail: `${closed?.state}: ${closed?.message}` });
  // Nothing starts an engine until Retry: no stray call may.
  await page.waitForTimeout(1_000);
  const unasked = (await marks(page, ENGINE_START_MARK)).filter((at) => at >= thrownAt).length;
  outcomes.push({ what: 'no engine starts before Retry', ok: unasked === 0, detail: `${unasked} started` });
  const locks = (await marks(page, LOCKED_MARK)).length;
  outcomes.push(await retry(page, locks));
  outcomes.push(await selftest(page));
  outcomes.push(await openSample(page));
  await page.keyboard.press('End');
  const atEnd = await page
    .waitForFunction(() => {
      const table = (globalThis as CheckGlobal).__tychoTable;
      return !!table && table.pending === 0 && table.failed === 0 && table.loaded > 0 && table.end === table.rows;
    }, null, { timeout: TIMEOUT })
    .then(() => true)
    .catch(() => false);
  const table = await page.evaluate(() => (globalThis as CheckGlobal).__tychoTable ?? null);
  outcomes.push({ what: 'End reads the new engine to the last row', ok: atEnd, detail: table ? `rows ${table.first}–${table.end} of ${table.rows}, ${table.pending} pending, ${table.failed} failed` : 'no table' });
  return outcomes;
}

/** `--only firefox,webkit` or `--only=firefox,webkit`: those browsers alone.
 *  Any other flag is refused, so a misspelled one never runs all three. */
const onlyAt = process.argv.findIndex((arg) => arg === '--only' || arg.startsWith('--only='));
const onlyGiven = onlyAt >= 0;
const onlyArg = !onlyGiven ? undefined : process.argv[onlyAt]!.startsWith('--only=') ? process.argv[onlyAt]!.slice('--only='.length) : process.argv[onlyAt + 1];
const only = onlyArg && !onlyArg.startsWith('-') ? onlyArg.split(',').filter(Boolean) : undefined;
const stray = process.argv.slice(2).filter((arg, at) => arg.startsWith('-') && at + 2 !== onlyAt);
if (stray.length) {
  console.error(`unknown flag ${stray.join(', ')}; takes [url] [--only chromium,firefox,webkit]`);
  process.exit(2);
}
const ENGINES_ALL: { name: string; type: BrowserType }[] = [
  { name: 'chromium', type: chromium },
  { name: 'firefox', type: firefox },
  { name: 'webkit', type: webkit },
];

const RUNS: { name: string; run: (page: Page) => Promise<Outcome[]>; before?: (context: BrowserContext) => Promise<void> }[] = [
  { name: 'selftest', run: selftestRun },
  { name: 'failed', run: failedLoadRun, before: refuseChunk },
  { name: 'stopped', run: stoppedRun },
];

let failures = 0;
const print = (browser: string, part: string, outcome: Outcome) => {
  if (!outcome.ok) failures += 1;
  console.log(`${browser.padEnd(9)}${part.padEnd(9)}${outcome.ok ? 'ok  ' : 'FAIL'}  ${outcome.what}: ${outcome.detail}`);
};

const ENGINES = ENGINES_ALL.filter(({ name }) => !onlyGiven || only?.includes(name));
const unknown = onlyGiven ? (only ?? ['(none)']).filter((name) => !ENGINES_ALL.some((engine) => engine.name === name)) : [];
if (unknown.length || !ENGINES.length) {
  console.error(`--only takes chromium, firefox, webkit; got ${unknown.join(', ') || 'none'}`);
  process.exit(2);
}

for (const { name, type } of ENGINES) {
  const browser = await type.launch();
  try {
    for (const { name: part, run, before } of RUNS) {
      pageErrors.length = 0;
      expectedErrorsEnd = 0;
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      try {
        const page = await context.newPage();
        page.on('pageerror', (error) => pageErrors.push(error.message));
        page.on('console', (message) => {
          if (message.type() !== 'error') return;
          const where = message.location().url;
          pageErrors.push(`${message.text()}${where ? ` (${where.split('/').pop()}:${message.location().lineNumber})` : ''}`);
        });
        await context.addInitScript(countWorkerErrors);
        await before?.(context);
        await page.goto(url.href);
        for (const outcome of await run(page)) print(name, part, outcome);
        // Before Retry the run broke the engine on purpose; after it, nothing may err.
        const unexpected = pageErrors.filter((error, at) => !(at < expectedErrorsEnd && EXPECTED_ERRORS.test(error)));
        for (const error of unexpected) print(name, part, { what: 'no console error', ok: false, detail: error.split('\n')[0]! });
      } catch (error) {
        print(name, part, { what: 'the run finished', ok: false, detail: error instanceof Error ? error.message.split('\n')[0]! : String(error) });
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
}
console.log(failures ? `\nFAIL: ${failures} check(s)` : '\nPASS');
process.exit(failures ? 1 : 0);
