// The engine's lockdown, in Chromium, Firefox, and WebKit (`docs/DECISIONS.md`,
// "Engine and bridge"): what a query can't reach once the engine is locked,
// what still works, and that Tycho sends nothing but the lockdown's own
// statements before it.
//
// An init script wraps the app's own bridge (`?bench`'s `__tychoBridge`, the
// object Rust calls), so every call the app makes is logged with its time,
// and the check's own queries go to the same engine an agent's or a bug's
// would. Two runs a browser:
//
// 1. Locked: once `tycho:engine-locked` is set, nothing was registered
//    before it and every query before it was the lockdown's; each query in
//    REFUSED fails; the sample, a dropped Parquet file, and a dropped CSV open
//    through the app (`BROWSER_FILEREADER` handles); SUMMARIZE,
//    `parquet_metadata`, a file registered again under a new name, and a file
//    registered after the lock read. TRIED is recorded, not judged: what the
//    goals that need it (open from a URL, export) start from.
// 2. Held: the wrapper fails `LOAD parquet` (2 s late, so a file is dropped
//    while the engine is still loading). The dropped file waits, unregistered;
//    the engine fails with Retry; Retry (with LOAD let through) locks it, and
//    only then is the file registered and opened.
//
// Against the dev server by default (`just tycho dev`); pass the preview's
// URL for the release build.
// Usage: node apps/tycho/perf/lockdown.ts [url]

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, firefox, webkit, type BrowserType, type LaunchOptions, type Page } from '@playwright/test';
import { clickTarget, waitMark } from '../../../shared-web/perf/harness.ts';

const url = new URL(process.argv.find((arg) => /^https?:/.test(arg)) ?? 'http://localhost:5173/');
url.searchParams.set('bench', '');
const SAMPLE = join(dirname(fileURLToPath(import.meta.url)), '../data/gcat.parquet');
const LOCKED_MARK = 'tycho:engine-locked';
const TIMEOUT = 60_000;

/** What the engine may be sent before the lock: its start and Tycho's lockdown. */
const BEFORE_LOCK = [
  'SELECT 42 AS x',
  'LOAD parquet',
  'SET GLOBAL parquet_metadata_cache = true',
  "ATTACH IF NOT EXISTS ':memory:' AS tycho_csv (COMPRESS)",
  "SET allowed_directories = ['tycho/']",
  'SET enable_external_access = false',
  'SET lock_configuration = true',
];

/** Each must fail on the locked engine. `ORIGIN` is the page's origin: a URL
 *  that would read, so a refusal is the lock's and not the network's. */
const REFUSED = [
  { what: 'a URL in a query', sql: "SELECT count(*) FROM read_csv('ORIGIN/', header = false, columns = {'line': 'VARCHAR'})" },
  { what: 'a file outside the directory', sql: "SELECT * FROM read_csv('outside.csv')" },
  { what: 'a path out of the directory', sql: "SELECT * FROM read_csv('tycho/../outside.csv')" },
  { what: 'COPY outside the directory', sql: "COPY (SELECT 1 AS x) TO 'outside-out.csv'" },
  { what: 'COPY to a URL', sql: "COPY (SELECT 1 AS x) TO 'ORIGIN/out.csv'" },
  { what: 'ATTACH a file', sql: "ATTACH 'outside.db' AS other" },
  { what: 'ATTACH a URL', sql: "ATTACH 'ORIGIN/other.db' AS other" },
  { what: 'LOAD an extension not loaded', sql: 'LOAD json' },
  { what: 'LOAD from a URL', sql: "LOAD 'ORIGIN/duckdb-ext/x.duckdb_extension.wasm'" },
  { what: 'SET', sql: 'SET threads = 1' },
  { what: 'SET external access', sql: 'SET enable_external_access = true' },
  { what: 'SET the lock', sql: 'SET lock_configuration = false' },
  { what: 'RESET', sql: 'RESET allowed_directories' },
];

interface Call {
  at: number;
  kind: 'query' | 'register';
  what: string;
}

interface Outcome {
  what: string;
  ok: boolean;
  detail: string;
}

type CheckGlobal = {
  __tychoBridge?: {
    query(sql: string, id: number): Promise<Uint8Array>;
    registerFile(name: string, source: File | string): Promise<unknown>;
  };
  __lockCalls?: Call[];
  __lockFailLoad?: boolean;
  __tychoWorkbench?: { state: string; rows: number | null; engine: string; message: string | null; ingest: string | null };
  __tychoDropInput?: HTMLInputElement;
};

/** Wraps the bridge as `main.ts` sets it: logs every call; fails `LOAD
 *  parquet` 2 s late while `__lockFailLoad` is set. */
function wrapBridge(failLoad: boolean): void {
  const g = globalThis as CheckGlobal;
  g.__lockCalls = [];
  g.__lockFailLoad = failLoad;
  let bridge: CheckGlobal['__tychoBridge'];
  Object.defineProperty(globalThis, '__tychoBridge', {
    configurable: true,
    get: () => bridge,
    set(given: NonNullable<CheckGlobal['__tychoBridge']>) {
      const { query, registerFile } = given;
      given.query = async (sql, id) => {
        g.__lockCalls!.push({ at: performance.now(), kind: 'query', what: sql });
        if (sql === 'LOAD parquet' && g.__lockFailLoad) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
          throw new Error('LOAD parquet failed on purpose (the lockdown check)');
        }
        return query.call(given, sql, id);
      };
      given.registerFile = (name, source) => {
        g.__lockCalls!.push({ at: performance.now(), kind: 'register', what: name });
        return registerFile.call(given, name, source);
      };
      bridge = given;
    },
  });
}

const markTime = (page: Page, name: string) =>
  page.evaluate((name) => performance.getEntriesByName(name, 'mark').at(-1)?.startTime ?? null, name);

const waitWorkbench = (page: Page, test: string) =>
  page.waitForFunction(
    // A predicate over the probe, as text: Playwright can't pass a closure.
    (test) => {
      const w = (globalThis as CheckGlobal).__tychoWorkbench;
      return w ? (new Function('w', `return ${test}`) as (w: unknown) => boolean)(w) : false;
    },
    test,
    { timeout: TIMEOUT },
  );

const workbench = (page: Page) => page.evaluate(() => (globalThis as CheckGlobal).__tychoWorkbench ?? null);

/** Runs `sql` on the app's engine: whether it answered, and its error if not. */
function query(page: Page, sql: string): Promise<{ ok: boolean; error: string | null; rows: number | null }> {
  return page.evaluate(async (sql) => {
    const bridge = (globalThis as CheckGlobal).__tychoBridge!;
    try {
      const bytes = await bridge.query(sql, 900_000 + Math.floor(Math.random() * 99_999));
      return { ok: true, error: null, rows: bytes.byteLength };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error), rows: null };
    }
  }, sql);
}

/** Runs `sql`, one value, and reads it as text: DuckDB casts it and wraps
 *  it in `<<…>>`, so it reads straight from the Arrow bytes' string buffer
 *  with no Arrow reader here. */
async function scalar(page: Page, sql: string): Promise<{ ok: boolean; value: string | null; error: string | null }> {
  const wrapped = `SELECT '<<' || (${sql})::VARCHAR || '>>' AS v`;
  return page.evaluate(async (sql) => {
    const bridge = (globalThis as CheckGlobal).__tychoBridge!;
    try {
      const bytes = await bridge.query(sql, 900_000 + Math.floor(Math.random() * 99_999));
      const text = new TextDecoder().decode(bytes);
      return { ok: true, value: /<<(.*?)>>/.exec(text)?.[1] ?? null, error: null };
    } catch (error) {
      return { ok: false, value: null, error: error instanceof Error ? error.message : String(error) };
    }
  }, wrapped);
}

/** Registers a file through the app's bridge: a `File` in the page made from
 *  `text`, the dropped file (`dropped`), or a URL. */
function register(page: Page, name: string, source: { text: string } | { dropped: true } | { url: string }) {
  return page.evaluate(
    async ({ name, source }) => {
      const g = globalThis as CheckGlobal;
      const given =
        'text' in source ? new File([source.text], 'given.csv') : 'url' in source ? source.url : g.__tychoDropInput!.files![0]!;
      try {
        await g.__tychoBridge!.registerFile(name, given);
        return null;
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    },
    { name, source },
  );
}

/** Drops the file at `file` (a disk path) on the page, as the OS does: set on
 *  a scratch input by path, so the browser reads it from disk like a
 *  visitor's file, then dragenter, dragover, and drop carrying it. */
async function dropFile(page: Page, file: string): Promise<void> {
  await page.evaluate(() => {
    const g = globalThis as CheckGlobal;
    if (!g.__tychoDropInput) {
      const input = document.createElement('input');
      input.type = 'file';
      input.hidden = true;
      document.body.append(input);
      g.__tychoDropInput = input;
    }
  });
  const input = await page.evaluateHandle(() => (globalThis as CheckGlobal).__tychoDropInput!);
  await input.asElement()!.setInputFiles(file);
  await page.evaluate(() => {
    const file = (globalThis as CheckGlobal).__tychoDropInput!.files![0]!;
    const canvas = document.querySelector('canvas')!;
    const transfer = new DataTransfer();
    transfer.items.add(file);
    for (const type of ['dragenter', 'dragover', 'drop']) {
      canvas.dispatchEvent(new DragEvent(type, { dataTransfer: transfer, bubbles: true, cancelable: true, clientX: 720, clientY: 450 }));
    }
  });
}

const shownCount = (page: Page) => page.evaluate(() => performance.getEntriesByName('tycho:file-shown', 'mark').length);

/** Drops `file` and waits for it to show or fail, then for a CSV's load to
 *  end. The sample and a dropped copy share a name, and the probe is
 *  published at the next render, not when the open starts: so it waits for
 *  a new `tycho:file-shown` mark (set right after the frame that publishes
 *  the new file's probe) or a failure, never for the probe's name. */
async function dropAndOpen(page: Page, file: string) {
  const before = await shownCount(page);
  await dropFile(page, file);
  await page.waitForFunction(
    (before) => performance.getEntriesByName('tycho:file-shown', 'mark').length > before || (globalThis as CheckGlobal).__tychoWorkbench?.state === 'failed',
    before,
    { timeout: TIMEOUT },
  );
  await waitWorkbench(page, "w.state === 'open' && w.ingest !== 'loading' || w.state === 'failed'");
  return workbench(page);
}

const calls = (page: Page) => page.evaluate(() => (globalThis as CheckGlobal).__lockCalls ?? []);

/** Nothing registered before the lock, and nothing queried but the lockdown's. */
async function beforeLock(page: Page): Promise<Outcome> {
  const locked = (await markTime(page, LOCKED_MARK))!;
  const early = (await calls(page)).filter((call) => call.at < locked);
  const stray = early.filter((call) => call.kind === 'register' || !BEFORE_LOCK.includes(call.what));
  return {
    what: 'nothing but the lockdown before the lock',
    ok: stray.length === 0 && early.some((call) => call.what === 'SET lock_configuration = true'),
    detail: stray.length ? `sent before the lock: ${stray.map((call) => `${call.kind} ${call.what}`).join('; ')}` : `${early.length} calls before it, all the lockdown's`,
  };
}

function csvFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'tycho-lockdown-'));
  const file = join(dir, 'small.csv');
  writeFileSync(file, 'name,launched\nSputnik 1,1957\nExplorer 1,1958\n');
  return file;
}

async function lockedRun(page: Page, csv: string): Promise<{ outcomes: Outcome[]; tried: Outcome[] }> {
  const outcomes: Outcome[] = [];
  const origin = new URL(page.url()).origin;
  await waitMark(page, LOCKED_MARK);
  outcomes.push(await beforeLock(page));

  // The sample, through the app's button.
  await clickTarget(page, 'try-sample');
  await waitWorkbench(page, "w.state === 'open' || w.state === 'failed'");
  const sample = await workbench(page);
  outcomes.push({ what: 'the sample opens', ok: sample?.state === 'open' && (sample.rows ?? 0) > 0, detail: `${sample?.state}, ${sample?.rows} rows${sample?.message ? `: ${sample.message}` : ''}` });

  // A dropped Parquet file (the sample's bytes, from disk), then the same
  // File registered by the check: SUMMARIZE, its metadata, a re-read.
  const dropped = await dropAndOpen(page, SAMPLE);
  outcomes.push({ what: 'a dropped Parquet file opens', ok: dropped?.state === 'open' && (dropped.rows ?? 0) > 0, detail: `${dropped?.state}, ${dropped?.rows} rows${dropped?.message ? `: ${dropped.message}` : ''}` });
  const registered = await register(page, 'tycho/check.parquet', { dropped: true });
  // Not `apogee_km`: GCAT writes an escape trajectory's apogee as infinity,
  // and SUMMARIZE's standard deviation refuses it (native DuckDB too).
  const summarize = await query(page, "SUMMARIZE SELECT * EXCLUDE (apogee_km) FROM read_parquet('tycho/check.parquet')");
  outcomes.push({ what: 'SUMMARIZE', ok: !registered && summarize.ok, detail: registered ?? summarize.error ?? 'answered' });
  const metadata = await scalar(page, "SELECT count(*) FROM parquet_metadata('tycho/check.parquet')");
  outcomes.push({ what: 'parquet_metadata', ok: metadata.ok && Number(metadata.value) > 0, detail: metadata.error ?? `${metadata.value} rows of metadata` });
  const again = await register(page, 'tycho/check-r1.parquet', { dropped: true });
  const reread = await scalar(page, "SELECT count(*) FROM read_parquet('tycho/check-r1.parquet')");
  outcomes.push({ what: 'a re-read under a new name', ok: !again && reread.ok && Number(reread.value) > 0, detail: again ?? reread.error ?? `${reread.value} rows` });

  // A dropped CSV: its chunks are registered under the directory, its
  // tables made in the database the lockdown attached.
  const csvShown = await dropAndOpen(page, csv);
  outcomes.push({ what: 'a dropped CSV opens', ok: csvShown?.state === 'open' && csvShown.rows === 2 && csvShown.ingest === 'done', detail: `${csvShown?.state}, ${csvShown?.rows} rows, ingest ${csvShown?.ingest}${csvShown?.message ? `: ${csvShown.message}` : ''}` });

  // A file registered by the check after the lock, inside and outside.
  const after = await register(page, 'tycho/after.csv', { text: 'x\n7\n' });
  const afterRead = await scalar(page, "SELECT sum(x) FROM read_csv('tycho/after.csv')");
  outcomes.push({ what: 'a file registered after the lock', ok: !after && afterRead.value === '7', detail: after ?? afterRead.error ?? `read ${afterRead.value}` });
  const outside = await register(page, 'outside.csv', { text: 'x\n7\n' });
  if (outside) outcomes.push({ what: 'registering outside.csv for the refusals', ok: false, detail: outside });

  for (const { what, sql } of REFUSED) {
    const result = await query(page, sql.replaceAll('ORIGIN', origin));
    outcomes.push({ what: `refused: ${what}`, ok: !result.ok, detail: result.ok ? 'it ran' : result.error!.split('\n')[0]! });
  }
  // Still locked, and still answering, after every refusal.
  const still = await scalar(page, "SELECT current_setting('enable_external_access')");
  outcomes.push({ what: 'still locked after the refusals', ok: still.value === 'false', detail: still.error ?? `enable_external_access = ${still.value}` });

  // Tried for later goals, not judged.
  const tried: Outcome[] = [];
  const sampleUrl = await page.evaluate(() => performance.getEntriesByType('resource').map((entry) => entry.name).find((name) => /gcat[\w-]*\.parquet/.test(name)) ?? null);
  if (sampleUrl) {
    const remote = await register(page, 'tycho/remote.parquet', { url: sampleUrl });
    const remoteRead = remote ? null : await scalar(page, "SELECT count(*) FROM read_parquet('tycho/remote.parquet')");
    tried.push({ what: 'a remote file registered under the directory', ok: !remote && !!remoteRead?.ok, detail: remote ?? remoteRead?.error ?? `${remoteRead?.value} rows` });
  } else {
    tried.push({ what: 'a remote file registered under the directory', ok: false, detail: "the sample's URL wasn't in Resource Timing" });
  }
  // Allowed, and harmless: no I/O (an in-memory database), and an
  // extension already loaded (a no-op).
  for (const [what, sql] of [
    ['ATTACH an in-memory database', "ATTACH ':memory:' AS scratch"],
    ['LOAD the loaded Parquet extension', 'LOAD parquet'],
    ['ATTACH a database inside the directory', "ATTACH 'tycho/scratch.db' AS inside"],
    // DuckDB-Wasm fetches an extension at LOAD, which the lock refuses.
    ['INSTALL', 'INSTALL json'],
  ]) {
    const result = await query(page, sql!);
    tried.push({ what: what!, ok: result.ok, detail: result.error?.split('\n')[0] ?? 'it ran' });
  }
  const copy = await query(page, "COPY (SELECT 42 AS x) TO 'tycho/out.csv'");
  const copied = copy.ok ? await scalar(page, "SELECT sum(x) FROM read_csv('tycho/out.csv')") : null;
  tried.push({ what: 'COPY inside the directory, read back', ok: copy.ok && copied?.value === '42', detail: copy.error ?? copied?.error ?? `read back ${copied?.value}` });
  return { outcomes, tried };
}

async function heldRun(page: Page, csv: string): Promise<Outcome[]> {
  const outcomes: Outcome[] = [];
  await waitMark(page, 'gpui:first-frame');
  // Dropped while the engine loads: LOAD is still 2 s from failing.
  await page.waitForFunction(() => ((globalThis as CheckGlobal).__lockCalls ?? []).some((call) => call.what === 'LOAD parquet'), null, { timeout: TIMEOUT });
  await dropFile(page, csv);
  await waitWorkbench(page, "w.state === 'opening'");
  const waiting = await workbench(page);
  outcomes.push({ what: 'a file dropped while the engine loads waits', ok: waiting?.state === 'opening' && waiting.engine === 'loading', detail: `${waiting?.state}, engine ${waiting?.engine}` });
  await waitWorkbench(page, "w.engine === 'failed'");
  const failed = await workbench(page);
  const registeredEarly = (await calls(page)).filter((call) => call.kind === 'register');
  outcomes.push({
    what: 'a failed LOAD leaves it unlocked, failed, and the file unregistered',
    ok: failed?.engine === 'failed' && registeredEarly.length === 0 && (await markTime(page, LOCKED_MARK)) === null,
    detail: `engine ${failed?.engine}, ${registeredEarly.length} registered, locked mark ${(await markTime(page, LOCKED_MARK)) === null ? 'unset' : 'set'}`,
  });
  await page.evaluate(() => ((globalThis as CheckGlobal).__lockFailLoad = false));
  await clickTarget(page, 'retry-engine');
  await waitMark(page, LOCKED_MARK);
  await waitWorkbench(page, "w.state === 'open' && w.ingest !== 'loading' || w.state === 'failed'");
  const opened = await workbench(page);
  const locked = (await markTime(page, LOCKED_MARK))!;
  const firstRegister = (await calls(page)).find((call) => call.kind === 'register');
  outcomes.push({
    what: 'Retry locks it, then the held file opens',
    ok: opened?.state === 'open' && opened.rows === 2 && !!firstRegister && firstRegister.at > locked,
    detail: `${opened?.state}, ${opened?.rows} rows; first registration ${firstRegister ? `${(firstRegister.at - locked).toFixed(0)} ms after the lock` : 'none'}`,
  });
  outcomes.push(await beforeLock(page));
  return outcomes;
}

const ENGINES: { name: string; type: BrowserType; launch: LaunchOptions }[] = [
  { name: 'chromium', type: chromium, launch: {} },
  { name: 'firefox', type: firefox, launch: {} },
  { name: 'webkit', type: webkit, launch: {} },
];

async function inBrowser(type: BrowserType, launch: LaunchOptions, failLoad: boolean, run: (page: Page) => Promise<void>): Promise<string[]> {
  const browser = await type.launch(launch);
  const errors: string[] = [];
  try {
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(wrapBridge, failLoad);
    await page.goto(url.href);
    await run(page);
  } finally {
    await browser.close();
  }
  return errors;
}

const csv = csvFile();
let failures = 0;
const print = (browser: string, part: string, outcome: Outcome) => {
  if (!outcome.ok) failures += 1;
  console.log(`${browser.padEnd(9)}${part.padEnd(8)}${outcome.ok ? 'ok  ' : 'FAIL'}  ${outcome.what}: ${outcome.detail}`);
};

for (const { name, type, launch } of ENGINES) {
  try {
    let tried: Outcome[] = [];
    const lockedErrors = await inBrowser(type, launch, false, async (page) => {
      const result = await lockedRun(page, csv);
      result.outcomes.forEach((outcome) => print(name, 'locked', outcome));
      tried = result.tried;
    });
    for (const outcome of tried) console.log(`${name.padEnd(9)}tried   ${outcome.ok ? 'works' : 'no   '}  ${outcome.what}: ${outcome.detail}`);
    const heldErrors = await inBrowser(type, launch, true, async (page) => {
      (await heldRun(page, csv)).forEach((outcome) => print(name, 'held', outcome));
    });
    for (const error of [...lockedErrors, ...heldErrors]) print(name, 'page', { what: 'no page error', ok: false, detail: error });
  } catch (error) {
    print(name, 'run', { what: 'the run finished', ok: false, detail: error instanceof Error ? error.message.split('\n')[0]! : String(error) });
  }
}
console.log(failures ? `\nFAIL: ${failures} check(s)` : '\nPASS');
process.exit(failures ? 1 : 0);
