// M7 part D checks: error states and hardening, on the release build
// (Chromium headless=new, 1440×900 at DPR 2).
//
// 1. Engine didn't load: DuckDB's wasm blocked, then (a second run) the
//    app's own engine chunk, a dynamic import. The empty state says so and
//    offers Retry; the sample buttons are disabled, and a dropped file is
//    refused without starting an engine. Unblocked, Retry loads it, and the
//    sample opens.
// 2. Engine stopped: with the sample open, DuckDB's worker throws. The file
//    closes, the empty state says why and offers Retry; Retry starts a new
//    engine, and the sample opens again and pages to its end.
// 3. Network, sample: /data/ blocked, a click fails with the network line;
//    unblocked, the same click opens it.
// 4. Network, pages: the sample open, /data/ blocked, End shows the rows'
//    failure (no hang); unblocked, the rows in view load with no input (by
//    70 s), and Home and End load again.
// 5. Reopen while reads drain: the 1 GB Parquet open, End, and the same file
//    dropped again while End's reads run. The second open's "Read" matches
//    a fresh open's (within 5%): the drained reads don't count toward it.
//    Records how long the second open took against the first.
// 6. Too large: a sparse Parquet and CSV just over the limits are refused
//    with their notice, before anything is read; an open file stays open.
// 7. The open panel stays clear of the table's scrollbars: after End, the
//    vertical thumb is outside the panel's bounds, and dragging it to the
//    top scrolls there.
//
// Usage: node apps/tycho/perf/errors.ts [--label m7-errors] [--only 1,2,…]

import { closeSync, mkdirSync, mkdtempSync, openSync, readFileSync, writeFileSync, writeSync, ftruncateSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from '@playwright/test';
import { preview } from 'vite';
import { assertPortFree, startWorkerDev, WORKER_DEV_PORT } from '../worker/scripts/dev.ts';
import { machineInfo, option } from './common.ts';
import { clickTarget, dropFile, open, overlayValue, targetRect, waitMark, waitOverlay, type TableProbe } from './harness.ts';

const perfDir = dirname(fileURLToPath(import.meta.url));
const webDir = join(perfDir, '../web');
const dataDir = join(perfDir, '../data');
const label = option('label') ?? 'm7-errors';
const only = option('only')?.split(',');
const wanted = (part: number) => !only || only.includes(String(part));

/** The size limits the app enforces, read from `crate/src/limits.rs`
 *  (`MAX_PARQUET_BYTES`, `MAX_CSV_BYTES`, as `<n> * GB`). */
const LIMITS = (() => {
  const source = readFileSync(join(perfDir, '../crate/src/limits.rs'), 'utf8');
  const limit = (name: string) => {
    const match = new RegExp(`const ${name}: u64 = ([\\d_]+) \\* GB;`).exec(source);
    if (!match) throw new Error(`no ${name} in limits.rs`);
    return Number(match[1]!.replaceAll('_', '')) * 1e9;
  };
  return { parquetBytes: limit('MAX_PARQUET_BYTES'), csvBytes: limit('MAX_CSV_BYTES') };
})();

interface WorkbenchProbe {
  state: string;
  name: string | null;
  rows: number | null;
  message: string | null;
  notice: string | null;
  engine: string;
  status: string;
}
type Global = { __tychoWorkbench?: WorkbenchProbe; __tychoTable?: TableProbe; __seizaPerfOverlayRect?: number[] };

const now = (page: Page) => page.evaluate(() => performance.now());

async function waitWorkbench(page: Page, test: string, timeout = 60_000): Promise<WorkbenchProbe> {
  const handle = await page.waitForFunction(
    (test) => {
      const probe = (globalThis as Global).__tychoWorkbench;
      return probe && new Function('w', `return ${test}`)(probe) ? probe : false;
    },
    test,
    { timeout, polling: 20 },
  );
  return (await handle.jsonValue()) as WorkbenchProbe;
}

async function waitTableAt(page: Page, end: boolean, timeout = 60_000) {
  await page.waitForFunction(
    (end) => {
      const table = (globalThis as Global).__tychoTable;
      return !!table && table.pending === 0 && table.loaded > 0 && (end ? table.end === table.rows : table.first === 0);
    },
    end,
    { timeout, polling: 20 },
  );
}

async function openSample(page: Page) {
  const before = await now(page);
  await clickTarget(page, 'try-sample-asteroids');
  await waitMark(page, 'tycho:first-rows', before, 60_000);
}

type Check = { name: string; ok: boolean; detail: string; problems: string[] };

// 1.
async function engineDidntLoad(url: string, what: 'wasm' | 'js'): Promise<Check> {
  // DuckDB's wasm (fetched by its worker), or the app's own engine chunk
  // (a dynamic import, which a browser may remember as failed).
  const block = what === 'wasm' ? /duckdb-(eh|mvp)-[^/]*\.wasm/ : /\/assets\/engine-[^/]*\.js/;
  const name = `1. engine didn’t load (${what === 'wasm' ? "DuckDB's wasm" : 'engine.ts chunk'}) → Retry`;
  const run = await open(chromium, url, { block });
  const details: string[] = [];
  let ok = true;
  try {
    const { page, context } = run;
    const failed = await waitWorkbench(page, "w.engine === 'failed'", 120_000);
    details.push(`status: ${failed.status}`);
    ok &&= /didn't load/.test(failed.status);
    await targetRect(page, 'retry-engine', 5_000);
    // A drop while it's down is refused, and starts no engine.
    const dropAt = await dropFile(page, join(dataDir, 'drop/asteroids-x3.parquet'));
    const dropped = await waitWorkbench(page, "w.state === 'failed'", 10_000).catch(() => null);
    const starts = await page.evaluate((at) => performance.getEntriesByName('tycho:engine-start', 'mark').filter((m) => m.startTime >= at).length, dropAt);
    details.push(`drop while down: ${dropped?.message ?? 'no failure shown'}; engine starts ${starts}`);
    ok &&= !!dropped && starts === 0;
    await context.unroute(block);
    await clickTarget(page, 'retry-engine');
    await waitWorkbench(page, "w.engine === 'ready'", 120_000);
    await openSample(page);
    details.push('retry: engine ready, sample opened');
    return { name, ok, detail: details.join('; '), problems: run.problems.filter((p) => !/duckdb-(eh|mvp)|ERR_FAILED|Failed to load resource|Failed to fetch|dynamically imported module|^ErrorEvent$|error in duckdb worker/.test(p)) };
  } catch (error) {
    return { name, ok: false, detail: `${details.join('; ')}; ${String(error)}`, problems: run.problems };
  } finally {
    await run.close();
  }
}

// 2.
async function engineStopped(url: string): Promise<Check> {
  const run = await open(chromium, url);
  const details: string[] = [];
  let ok = true;
  try {
    const { page } = run;
    await waitOverlay(page, 'Parquet ready', /ms$/, 180_000);
    await openSample(page);
    const duckdb = page.workers().find((worker) => worker.url().startsWith('blob:'));
    if (!duckdb) throw new Error("no DuckDB worker found");
    const thrownAt = await now(page);
    await duckdb.evaluate(() => setTimeout(() => {
      throw new Error('test: the worker stopped');
    }));
    // The app hears of it at its next call: End's page reads.
    await page.waitForTimeout(200);
    await page.keyboard.press('End');
    const stopped = await waitWorkbench(page, "w.engine === 'stopped' && w.state === 'failed'", 10_000);
    details.push(`status: ${stopped.status}`);
    ok &&= /stopped while asteroids\.parquet was open/.test(stopped.status);
    // Nothing starts an engine until Retry: no stray call may.
    await page.waitForTimeout(1_000);
    const unasked = await page.evaluate((at) => performance.getEntriesByName('tycho:engine-start', 'mark').filter((m) => m.startTime >= at).length, thrownAt);
    details.push(`engines started before Retry: ${unasked}`);
    ok &&= unasked === 0;
    await clickTarget(page, 'retry-engine');
    await waitWorkbench(page, "w.engine === 'ready'", 120_000);
    await openSample(page);
    await page.keyboard.press('End');
    await waitTableAt(page, true);
    details.push('retry: new engine, sample opened, End loaded');
    return { name: '2. engine stopped → Retry', ok, detail: details.join('; '), problems: run.problems.filter((p) => !/test: the worker stopped|^ErrorEvent$/.test(p)) };
  } catch (error) {
    return { name: '2. engine stopped → Retry', ok: false, detail: `${details.join('; ')}; ${String(error)}`, problems: run.problems };
  } finally {
    await run.close();
  }
}

// 2b. The worker dies under an open, and a second drop replaces that open
//     (its task, and the futures of its failed calls, are dropped). The
//     engine still reads as stopped, and nothing starts one before Retry.
async function engineStoppedUnderOpen(url: string): Promise<Check> {
  const name = '2b. engine stopped under a replaced open';
  const run = await open(chromium, url);
  try {
    const { page } = run;
    await waitOverlay(page, 'Parquet ready', /ms$/, 180_000);
    const duckdb = page.workers().find((worker) => worker.url().startsWith('blob:'));
    if (!duckdb) throw new Error('no DuckDB worker found');
    const thrownAt = await now(page);
    await dropFile(page, join(dataDir, 'drop/asteroids-x27.parquet'));
    await duckdb.evaluate(() => setTimeout(() => {
      throw new Error('test: the worker stopped');
    }));
    await dropFile(page, join(dataDir, 'drop/asteroids-x3.parquet'));
    const probe = await waitWorkbench(page, "w.engine === 'stopped'", 10_000);
    await page.waitForTimeout(1_000);
    const starts = await page.evaluate((at) => performance.getEntriesByName('tycho:engine-start', 'mark').filter((m) => m.startTime >= at).length, thrownAt);
    await clickTarget(page, 'retry-engine');
    await waitWorkbench(page, "w.engine === 'ready'", 120_000);
    await openSample(page);
    return { name, ok: starts === 0, detail: `status: ${probe.status}; engines started before Retry: ${starts}; retry: sample opened`, problems: run.problems.filter((p) => !/test: the worker stopped|^ErrorEvent$/.test(p)) };
  } catch (error) {
    return { name, ok: false, detail: String(error), problems: run.problems };
  } finally {
    await run.close();
  }
}

// 3. and 4.
async function network(url: string): Promise<Check[]> {
  const block = '**/data/asteroids.parquet';
  const run = await open(chromium, url);
  const out: Check[] = [];
  try {
    const { page, context } = run;
    await waitOverlay(page, 'Parquet ready', /ms$/, 180_000);
    await context.route(block, (route) => route.abort('internetdisconnected'));
    await clickTarget(page, 'try-sample-asteroids');
    const failed = await waitWorkbench(page, "w.state === 'failed'", 30_000);
    await context.unroute(block);
    await openSample(page);
    out.push({ name: '3. network, sample', ok: /network request failed/.test(failed.status), detail: `offline: ${failed.status}; online again: opened`, problems: [] });

    await context.route(block, (route) => route.abort('internetdisconnected'));
    await page.keyboard.press('End');
    const failedRows = await page
      .waitForFunction(() => ((globalThis as Global).__tychoTable?.failed ?? 0) > 0, undefined, { timeout: 30_000, polling: 20 })
      .then(() => true)
      .catch(() => false);
    await context.unroute(block);
    // Back online, the failed rows load again with no input (the app
    // registers the file again under a new name, waiting 5 s, then longer,
    // between tries), and on coming back to them.
    const online = await now(page);
    await waitTableAt(page, true, 70_000);
    const recoveredS = ((await now(page)) - online) / 1000;
    const step = async (key: 'Home' | 'End') => {
      await page.keyboard.press(key);
      await waitTableAt(page, key === 'End', 30_000).catch(async () => {
        const table = await page.evaluate(() => (globalThis as Global).__tychoTable);
        throw new Error(`online ${key}: rows never loaded: ${JSON.stringify(table)}; pages ${await overlayValue(page, 'Pages')}`);
      });
    };
    await step('Home');
    await step('End');
    out.push({ name: '4. network, pages', ok: failedRows, detail: `offline End: ${failedRows ? 'rows failed visibly' : 'no failure shown'}; online again: the rows in view loaded by themselves in ${recoveredS.toFixed(1)} s, then Home and End loaded`, problems: run.problems.filter((p) => !/ERR_INTERNET_DISCONNECTED|Failed to load resource|Range request|Invalid Error|TProtocolException|network request failed/.test(p)) });
  } catch (error) {
    out.push({ name: '3./4. network', ok: false, detail: String(error), problems: run.problems });
  } finally {
    await run.close();
  }
  return out;
}

// 5.
const readBytes = async (page: Page, since: number) => {
  await page.waitForFunction((since) => ((globalThis as { __seizaPerfOverlayAt?: number }).__seizaPerfOverlayAt ?? 0) > since, since, { timeout: 5_000 });
  const value = (await overlayValue(page, 'Read')) ?? '';
  const [, number, unit] = /^([\d.]+) (B|KiB|MiB|GiB)/.exec(value) ?? [];
  return Number(number) * ({ B: 1, KiB: 2 ** 10, MiB: 2 ** 20, GiB: 2 ** 30 }[unit as 'B'] ?? NaN);
};

async function reopenDraining(url: string): Promise<Check> {
  const file = join(dataDir, 'drop/asteroids-x27.parquet');
  const run = await open(chromium, url);
  try {
    const { page } = run;
    await waitOverlay(page, 'Parquet ready', /ms$/, 180_000);
    const first = await dropFile(page, file);
    const firstRows = (await waitMark(page, 'tycho:first-rows', first, 60_000)) - first;
    await waitOverlay(page, 'Pages', /0 in flight · 0 cancelled/, 30_000);
    const fresh = await readBytes(page, await now(page));
    // End: its reads start; the same file again while they run.
    await page.keyboard.press('End');
    await page.waitForFunction(() => ((globalThis as Global).__tychoTable?.pending ?? 0) > 0, undefined, { timeout: 5_000, polling: 5 });
    const second = await dropFile(page, file);
    const secondRows = (await waitMark(page, 'tycho:first-rows', second, 60_000)) - second;
    await waitOverlay(page, 'Pages', /0 in flight · 0 cancelled/, 30_000);
    const reopened = await readBytes(page, await now(page));
    const ok = Math.abs(reopened - fresh) <= fresh * 0.05;
    return { name: '5. reopen while reads drain', ok, detail: `Read ${fresh} B fresh vs ${reopened} B reopened; first rows ${firstRows.toFixed(0)} ms fresh vs ${secondRows.toFixed(0)} ms reopened`, problems: run.problems };
  } catch (error) {
    return { name: '5. reopen while reads drain', ok: false, detail: String(error), problems: run.problems };
  } finally {
    await run.close();
  }
}

// 6.
function sparse(dir: string, name: string, bytes: number, parquet: boolean): string {
  const path = join(dir, name);
  const fd = openSync(path, 'w');
  ftruncateSync(fd, bytes);
  if (parquet) {
    writeSync(fd, Buffer.from('PAR1'), 0, 4, 0);
    writeSync(fd, Buffer.from('PAR1'), 0, 4, bytes - 4);
  } else {
    writeSync(fd, Buffer.from('a,b\n1,2\n'), 0, 8, 0);
  }
  closeSync(fd);
  return path;
}

async function tooLarge(url: string): Promise<Check> {
  const dir = mkdtempSync(join(tmpdir(), 'tycho-big-'));
  const files = [sparse(dir, 'huge.parquet', LIMITS.parquetBytes + 1, true), sparse(dir, 'huge.csv', LIMITS.csvBytes + 1, false)];
  const run = await open(chromium, url);
  const details: string[] = [];
  let ok = true;
  try {
    const { page } = run;
    await waitOverlay(page, 'Parquet ready', /ms$/, 180_000);
    for (const over of ['empty', 'open']) {
      if (over === 'open') await openSample(page);
      for (const file of files) {
        const name = file.split('/').pop()!;
        await dropFile(page, file);
        const probe = await waitWorkbench(page, `w.notice && w.notice.includes(${JSON.stringify(name)})`, 10_000);
        const kept = over === 'empty' ? probe.state === 'idle' : probe.state === 'open' && probe.name === 'asteroids.parquet';
        details.push(`${name} over ${over}: ${probe.notice}`);
        ok &&= kept && /too large/.test(probe.notice ?? '');
      }
    }
    return { name: '6. too large', ok, detail: details.join('; '), problems: run.problems };
  } catch (error) {
    return { name: '6. too large', ok: false, detail: `${details.join('; ')}; ${String(error)}`, problems: run.problems };
  } finally {
    await run.close();
  }
}

// 7.
async function panelClear(url: string): Promise<Check> {
  const run = await open(chromium, url);
  try {
    const { page } = run;
    await waitOverlay(page, 'Parquet ready', /ms$/, 180_000);
    await openSample(page);
    await page.keyboard.press('End');
    await waitTableAt(page, true);
    await page.waitForTimeout(300);
    const [tx, ty, tw, th] = await targetRect(page, 'table-scroll-thumb');
    const panel = await page.evaluate(() => (globalThis as Global).__seizaPerfOverlayRect ?? null);
    if (!panel) throw new Error('the panel publishes no bounds');
    const [px, py, pw, ph] = panel as [number, number, number, number];
    const overlaps = tx < px + pw && tx + tw > px && ty < py + ph && ty + th > py;
    const [, hy] = await targetRect(page, 'table-scroll-track');
    await page.mouse.move(tx + tw / 2, ty + th / 2);
    await page.mouse.down();
    await page.mouse.move(tx + tw / 2, hy + 2, { steps: 10 });
    await page.mouse.up();
    await waitTableAt(page, false, 30_000);
    return { name: '7. panel clear of the scrollbar', ok: !overlaps, detail: `thumb [${tx}, ${ty}, ${tw}, ${th}], panel [${panel.join(', ')}]; dragged the thumb from the bottom to the top`, problems: run.problems };
  } catch (error) {
    return { name: '7. panel clear of the scrollbar', ok: false, detail: String(error), problems: run.problems };
  } finally {
    await run.close();
  }
}

await assertPortFree(WORKER_DEV_PORT);
const worker = await startWorkerDev({ port: WORKER_DEV_PORT, requireObject: 'asteroids.parquet' });
let server: Awaited<ReturnType<typeof preview>>;
try {
  server = await preview({ root: webDir, preview: { port: 4181, strictPort: true }, logLevel: 'warn' });
} catch (error) {
  await worker.close();
  throw error;
}
const url = 'http://localhost:4181/';
const date = new Date().toISOString().slice(0, 10);
const checks: Check[] = [];
try {
  if (wanted(1)) checks.push(await engineDidntLoad(url, 'wasm'), await engineDidntLoad(url, 'js'));
  if (wanted(2)) checks.push(await engineStopped(url), await engineStoppedUnderOpen(url));
  if (wanted(3) || wanted(4)) checks.push(...(await network(url)));
  if (wanted(5)) checks.push(await reopenDraining(url));
  if (wanted(6)) checks.push(await tooLarge(url));
  if (wanted(7)) checks.push(await panelClear(url));
} finally {
  await server.close();
  await worker.close();
}
for (const check of checks) console.log(`${check.ok && !check.problems.length ? 'ok  ' : 'FAIL'} ${check.name}: ${check.detail}${check.problems.length ? ` [${check.problems.join('; ')}]` : ''}`);
const resultsDir = join(perfDir, 'results');
mkdirSync(resultsDir, { recursive: true });
const file = join(resultsDir, `${date}-${label}.json`);
writeFileSync(file, `${JSON.stringify({ date, label, ...machineInfo(), limits: LIMITS, checks }, null, 2)}\n`);
console.log(`wrote ${file}`);
if (checks.some((check) => !check.ok || check.problems.length)) process.exit(1);
