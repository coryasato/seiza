// M7 part D experiments, on the release build:
//
// footers: does a session that opens many big Parquet files pile up parsed
//   footers in DuckDB's worker, and what frees them? Drops the ~1 GB file
//   (1,378 row groups) --opens times, each under a new SQL name as the app
//   does, and records every agent's memory (measureUserAgentSpecificMemory,
//   after a GC) along the way, in three variants:
//     keep       the app as it was: every file stays registered
//     drop       each registration dropping the files before it (`db.dropFile`):
//                measured once on an experiment build (2026-10-08, results
//                m7-footers), where `?dropfiles` switched it on; not in the app
//     sqlclear   keep, plus `SET GLOBAL parquet_metadata_cache = false`, then
//                `= true`, after each open
// wheel-end: wheels against the last row (nothing can move) with the panel
//   closed, and counts the frames that drew, against the same wheeling
//   mid-table and no input at all.
// csv-scan (removed): the M6 fling during a ~1 GB CSV's load, throttled, by
//   the record scanner's window. It ran once, 2026-10-08, on a build with a
//   `?scan_kib=` override (results: 2026-10-08-m7-csv-scan.json); the window
//   made no difference, so the override and this experiment went.
// ceiling: opens the big drop files (by default Parquet ~1, ~2.1, ~4.3 GB;
//   CSV ~1, ~2, ~4.3 GB; --files for others) one per fresh browser, and records what happens: first rows, the
//   last row (End), every agent's memory, DuckDB's own memory, and errors.
//
// Usage: node apps/tycho/perf/hardening.ts --only footers|ceiling|wheel-end [--opens 20] [--files a,b] [--label m7-hardening]

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from '@playwright/test';
import { preview } from 'vite';
import { assertPortFree, startWorkerDev, WORKER_DEV_PORT } from '../worker/scripts/dev.ts';
import { machineInfo, option } from './common.ts';
import { clickTarget, dropFile, open, overlayValue, percentiles, waitMark, waitOverlay, wheel, workBetween, workRecorder, type TableProbe } from './harness.ts';

const perfDir = dirname(fileURLToPath(import.meta.url));
const webDir = join(perfDir, '../web');
const dataDir = join(perfDir, '../data');
const manifest = JSON.parse(readFileSync(join(dataDir, 'MANIFEST.json'), 'utf8')) as Record<string, { rows: number; bytes: number; rowGroups?: number }>;

const only = option('only');
const opens = Number(option('opens') ?? 20);
const label = option('label') ?? 'm7-hardening';
const wanted = (part: string) => !only || only.split(',').includes(part);

type Global = {
  __tychoWorkbench?: { state: string; name: string | null; rows: number | null; message: string | null; notice: string | null; ingest: string | null; readBytes: number | null };
  __tychoTable?: TableProbe;
  __tychoBridge?: { query(sql: string, id: number): Promise<Uint8Array> };
};

const workbench = (page: Page) => page.evaluate(() => (globalThis as Global).__tychoWorkbench ?? null);
const mib = (bytes: number) => Number((bytes / 2 ** 20).toFixed(1));

async function allAgentsMiB(page: Page): Promise<number | null> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('HeapProfiler.collectGarbage');
  await cdp.detach();
  const bytes = await page.evaluate(async () => {
    try {
      return (await (performance as unknown as { measureUserAgentSpecificMemory(): Promise<{ bytes: number }> }).measureUserAgentSpecificMemory()).bytes;
    } catch {
      return null;
    }
  });
  return bytes === null ? null : mib(bytes);
}

let nextQuery = 1_000_000;
/** Runs SQL through the app's own bridge (`?bench`); returns the Arrow bytes' length. */
const bridgeQuery = (page: Page, sql: string) =>
  page.evaluate(async ({ sql, id }) => (await (globalThis as Global).__tychoBridge!.query(sql, id)).length, { sql, id: nextQuery++ });

/** DuckDB's own accounting, through the bridge: its memory in use (MiB),
 *  read back as text from the Arrow bytes. */
async function duckdbMiB(page: Page): Promise<number | null> {
  return page.evaluate(async (id) => {
    const bytes = await (globalThis as Global).__tychoBridge!.query("SELECT (sum(memory_usage_bytes) / 1048576)::DECIMAL(10,1)::VARCHAR AS m FROM duckdb_memory()", id);
    // The value is the only short ASCII number in the stream.
    const text = new TextDecoder('latin1').decode(bytes);
    const match = /(\d+\.\d)(?!.*\d+\.\d)/s.exec(text);
    return match ? Number(match[1]) : null;
  }, nextQuery++);
}

async function waitPagesSettled(page: Page, timeout = 60_000) {
  await page.waitForFunction(() => {
    const table = (globalThis as Global).__tychoTable;
    return !!table && table.pending === 0;
  }, undefined, { timeout, polling: 50 });
  // Prefetch and cancelled reads: wait for the panel's "0 in flight · 0 cancelled".
  await waitOverlay(page, 'Pages', /0 in flight · 0 cancelled/, timeout);
}

// footers
async function footers(url: string, variant: 'keep' | 'drop' | 'sqlclear') {
  const name = 'drop/asteroids-x27.parquet';
  const params: Record<string, string> = { bench: '' };
  if (variant === 'drop') params.dropfiles = '';
  const run = await open(chromium, url, { params });
  const snapshots: { opens: number; allAgentsMiB: number | null; duckdbMiB: number | null }[] = [];
  try {
    const { page } = run;
    await waitOverlay(page, 'Parquet ready', /ms$/, 180_000);
    snapshots.push({ opens: 0, allAgentsMiB: await allAgentsMiB(page), duckdbMiB: await duckdbMiB(page) });
    for (let index = 1; index <= opens; index++) {
      const at = await dropFile(page, join(dataDir, name));
      await waitMark(page, 'tycho:first-rows', at, 60_000);
      await waitPagesSettled(page);
      if (variant === 'sqlclear') {
        await bridgeQuery(page, 'SET GLOBAL parquet_metadata_cache = false');
        await bridgeQuery(page, 'SET GLOBAL parquet_metadata_cache = true');
      }
      if ([1, 2, 5, 10, 15, 20, 30, 40].includes(index) || index === opens) {
        snapshots.push({ opens: index, allAgentsMiB: await allAgentsMiB(page), duckdbMiB: await duckdbMiB(page) });
        console.log(`footers ${variant}: ${index} opens → every agent ${snapshots.at(-1)!.allAgentsMiB} MiB, DuckDB ${snapshots.at(-1)!.duckdbMiB} MiB`);
      }
    }
    // The last file still pages: End shows the last row.
    await page.keyboard.press('End');
    await page.waitForFunction(() => {
      const table = (globalThis as Global).__tychoTable;
      return !!table && table.pending === 0 && table.end === table.rows && table.loaded > 0;
    }, undefined, { timeout: 30_000, polling: 50 });
    return { variant, snapshots, problems: run.problems };
  } finally {
    await run.close();
  }
}

// wheel-end
async function setPanel(page: Page, open: boolean): Promise<void> {
  const visible = () => page.evaluate(() => (globalThis as { __seizaPerfOverlay?: unknown }).__seizaPerfOverlay !== undefined);
  if ((await visible()) === open) return;
  await page.keyboard.press('Control+Shift+P');
  await page.waitForFunction((open) => ((globalThis as { __seizaPerfOverlay?: unknown }).__seizaPerfOverlay !== undefined) === open, open, { timeout: 5_000 });
}

async function wheelEnd(url: string) {
  const run = await open(chromium, url, { init: [workRecorder] });
  try {
    const { page } = run;
    await waitOverlay(page, 'Parquet ready', /ms$/, 180_000);
    const clicked = await page.evaluate(() => performance.now());
    await clickTarget(page, 'try-sample-asteroids');
    await waitMark(page, 'tycho:first-rows', clicked, 60_000);
    await setPanel(page, false);
    await page.mouse.move(400, 500);
    const settle = async (end: boolean) => {
      await page.keyboard.press(end ? 'End' : 'Home');
      await page.waitForFunction((end) => {
        const table = (globalThis as Global).__tychoTable;
        return !!table && table.pending === 0 && (end ? table.end === table.rows : table.first === 0);
      }, end, { timeout: 30_000, polling: 20 });
      await page.waitForTimeout(500);
    };
    const phase = async (name: string, act: (() => Promise<void>) | null) => {
      const from = await page.evaluate(() => performance.now());
      for (let index = 0; index < 120; index++) {
        if (act) await act();
        await page.waitForTimeout(16);
      }
      const to = await page.evaluate(() => performance.now());
      const work = await workBetween(page, from, to);
      const top = await page.evaluate(() => (globalThis as Global).__tychoTable?.top ?? null);
      return { name, seconds: Number(((to - from) / 1000).toFixed(2)), frames: work.length, work: percentiles(work.map((w) => w.ms)), top };
    };
    await settle(true);
    const results = [await phase('still, at the end', null), await phase('wheel down at the end', () => wheel(page, 40))];
    await settle(false);
    results.push(await phase('wheel down from the top', () => wheel(page, 40)));
    // The same at the end with the panel open: its 4 Hz refresh redraws.
    await setPanel(page, true);
    await settle(true);
    results.push(await phase('panel open: still, at the end', null), await phase('panel open: wheel down at the end', () => wheel(page, 40)));
    for (const r of results) console.log(`wheel-end: ${JSON.stringify(r)}`);
    return { results, problems: run.problems };
  } finally {
    await run.close();
  }
}

// ceiling
async function ceiling(url: string, name: string) {
  const csv = name.endsWith('.csv');
  const run = await open(chromium, url, { params: { bench: '' } });
  const out: Record<string, unknown> = { file: name, bytes: manifest[name]?.bytes, rows: manifest[name]?.rows };
  try {
    const { page } = run;
    await waitOverlay(page, 'Parquet ready', /ms$/, 180_000);
    out.before = { allAgentsMiB: await allAgentsMiB(page) };
    const at = await dropFile(page, join(dataDir, name));
    const first = await waitMark(page, 'tycho:first-rows', at, 120_000).catch(() => null);
    out.firstRowsMs = first === null ? null : first - at;
    if (csv) {
      // Until the load is done or stopped (or the page dies).
      const deadline = Date.now() + 15 * 60_000;
      let peak = 0;
      for (;;) {
        const probe = await workbench(page).catch(() => null);
        if (!probe || probe.ingest !== 'loading' || Date.now() > deadline) {
          out.ingest = probe?.ingest ?? null;
          out.readBytes = probe?.readBytes ?? null;
          out.rowsShown = probe?.rows ?? null;
          break;
        }
        const all = await allAgentsMiB(page).catch(() => null);
        if (all !== null) peak = Math.max(peak, all);
        await page.waitForTimeout(3_000);
      }
      out.ingestMs = (await page.evaluate(() => performance.now()).catch(() => NaN)) - at;
      out.peakAllAgentsMiB = peak;
      out.csvLoad = await overlayValue(page, 'CSV load').catch(() => null);
    }
    out.workbench = await workbench(page).catch(() => null);
    out.afterOpen = { allAgentsMiB: await allAgentsMiB(page).catch(() => null), duckdbMiB: await duckdbMiB(page).catch(() => null) };
    // The last row: End, then every visible row loaded.
    const endAt = await page.evaluate(() => performance.now()).catch(() => null);
    await page.keyboard.press('End').catch(() => {});
    const end = await page
      .waitForFunction(() => {
        const table = (globalThis as Global).__tychoTable;
        return !!table && table.pending === 0 && table.end === table.rows && table.loaded > 0 ? { ...table } : false;
      }, undefined, { timeout: 120_000, polling: 50 })
      .then((handle) => handle.jsonValue())
      .catch((error) => String(error));
    out.end = end;
    out.endMs = endAt === null ? null : (await page.evaluate(() => performance.now()).catch(() => NaN)) - endAt;
    out.afterEnd = { allAgentsMiB: await allAgentsMiB(page).catch(() => null), duckdbMiB: await duckdbMiB(page).catch(() => null) };
    out.engineAnswers = await bridgeQuery(page, 'SELECT 42').then(() => true).catch((error) => String(error));
    out.problems = run.problems;
    console.log(`ceiling ${name}: ${JSON.stringify(out)}`);
    return out;
  } finally {
    await run.close();
  }
}

await assertPortFree(WORKER_DEV_PORT);
const worker = await startWorkerDev({ port: WORKER_DEV_PORT, requireObject: 'asteroids.parquet' });
let server: Awaited<ReturnType<typeof preview>>;
try {
  server = await preview({ root: webDir, preview: { port: 4180, strictPort: true }, logLevel: 'warn' });
} catch (error) {
  await worker.close();
  throw error;
}
const url = 'http://localhost:4180/';
const date = new Date().toISOString().slice(0, 10);
const output: Record<string, unknown> = { date, label, ...machineInfo() };
try {
  if (wanted('footers')) {
    const results = [];
    for (const variant of ['keep', 'sqlclear'] as const) results.push(await footers(url, variant));
    output.footers = { file: manifest['drop/asteroids-x27.parquet'], opens, results };
  }
  if (wanted('wheel-end')) output.wheelEnd = await wheelEnd(url);
  if (wanted('ceiling')) {
    const files = (option('files') ?? 'drop/asteroids-x27-rg122880.parquet,drop/asteroids-x60-rg122880.parquet,drop/asteroids-x120-rg122880.parquet,drop/asteroids-x6.csv,drop/asteroids-x12.csv,drop/asteroids-x24.csv').split(',');
    const results = [];
    for (const name of files) results.push(await ceiling(url, name));
    output.ceiling = results;
  }
} finally {
  await server.close();
  await worker.close();
}
const resultsDir = join(perfDir, 'results');
mkdirSync(resultsDir, { recursive: true });
const file = join(resultsDir, `${date}-${label}.json`);
writeFileSync(file, `${JSON.stringify(output, null, 2)}\n`);
console.log(`wrote ${file}`);
