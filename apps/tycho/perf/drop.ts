// M5 checks: open a Parquet file from this device, on the release build.
//
// The files come from `just tycho drop-files` (data/drop/, recorded in
// MANIFEST.json): the asteroid table repeated to ~100 MB (x3) and ~1 GB (x27).
// A drop is a real disk-backed `File`: Playwright sets it on a scratch
// <input type=file> by path (Chromium reads it from disk, no copy), and the
// script dispatches dragenter/dragover/drop carrying it on the canvas, as
// the OS would.
//
// 1. Drop → schema and first rows (Chromium headless=new, new browser per
//    run, 1440×900 at DPR 2, median of --runs, engine warm, i.e. "Parquet
//    ready"): the ~1 GB file, dispatch → `tycho:file-shown` and →
//    `tycho:first-rows`. Budget ≤ 1 s each (reference); throttled recorded.
//    The overlay's "File → schema" / "File → first rows" (from the app's own
//    drop timestamp) are recorded next to them. The 1 GB file in DuckDB's
//    default (122,880) and pyarrow's (1,048,576) row-group layouts is
//    recorded too (reference, --layout-runs).
// 2. Memory (Chromium): for the 100 MB and the 1 GB file, drop, first rows,
//    End (last rows), Home; after each, wasm + JS heap (the overlay) and
//    measureUserAgentSpecificMemory (every agent, DuckDB's worker included).
//    Peak app memory for 1 GB must be within 16 MiB of 100 MB's, and every
//    agent's within 10% of the files' size difference. A negative control
//    holds the 100 MB file's bytes in the page (`file.arrayBuffer()`) and
//    must read at least 90% of the file higher, so a copy would show.
// 3. Unsupported files (Chromium): a text file, a CSV, junk named .parquet,
//    a 5-byte file, and an encrypted-Parquet shape, dropped on the empty
//    state and over an open file: each shows its inline notice, and an open
//    file stays open.
// 4. Supersede (Chromium): drop 1 GB then 100 MB 20 ms later; drop 100 MB
//    then 1 GB right after its schema shows (pages loading); click the
//    sample then drop. The last one wins, shows its first rows, nothing
//    else shows after, and the engine still answers. Drop before the engine
//    is ready: waits, then opens.
// 5. Browsers: drop, and the file dialog ("Open a Parquet file…") with the
//    100 MB file, in Chromium, Firefox, and WebKit.
//
// Usage: node apps/tycho/perf/drop.ts [--runs 10] [--layout-runs 5] [--label m5-drop]
//                                     [--reference-only] [--only drop|memory|unsupported|supersede|browsers]
// Starts `vite preview` on web/dist and `wrangler dev` (local R2, for the
// sample). Writes perf/results/<date>-<label>.json. Run `just tycho build` first.

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, firefox, webkit, type BrowserType, type Page } from '@playwright/test';
import { preview } from 'vite';
import { assertPortFree, startWorkerDev, WORKER_DEV_PORT } from '../worker/scripts/dev.ts';
import { PROFILES, flag, machineInfo, option, summarize, type Profile } from './common.ts';
import { clickTarget, open, overlayValue, waitMark, waitOverlay } from './harness.ts';

const perfDir = dirname(fileURLToPath(import.meta.url));
const webDir = join(perfDir, '../web');
const dataDir = join(perfDir, '../data');
const manifest = JSON.parse(readFileSync(join(dataDir, 'MANIFEST.json'), 'utf8')) as Record<string, { rows: number; bytes: number; rowGroups: number; sha256: string }>;

const FILES = {
  small: 'drop/asteroids-x3.parquet',
  big: 'drop/asteroids-x27.parquet',
  bigRg122880: 'drop/asteroids-x27-rg122880.parquet',
  bigRg1048576: 'drop/asteroids-x27-rg1048576.parquet',
} as const;
for (const name of Object.values(FILES)) {
  if (!manifest[name]) throw new Error(`${name} isn't in MANIFEST.json: run \`just tycho drop-files\``);
}
const path = (name: string) => join(dataDir, name);
const base = (name: string) => name.split('/').pop()!;

/**
 * Memory: app memory (wasm + JS heap) is steady to ~1 MiB, so its bound is
 * tight. Every agent together (DuckDB's worker included) swings ~20 MiB
 * between snapshots of one file, and grows with the footer DuckDB keeps
 * parsed (2.2 MB serialized at 1,378 row groups vs 0.24 MB at 154): M5 read
 * +14 MiB. Its bound is what a copy would break: 10% of the size difference
 * between the two files (~86 MiB). The negative control shows a held copy
 * reads at its full size.
 */
const BUDGET = { schemaMs: 1000, firstRowsMs: 1000, appDeltaMiB: 16, allAgentsDeltaOfSizeDiff: 0.1, copyDetect: 0.9 };
const runs = Number(option('runs') ?? 10);
const layoutRuns = Number(option('layout-runs') ?? 5);
const label = option('label') ?? 'm5-drop';
const only = option('only');
const wanted = (part: string) => !only || only === part;

interface WorkbenchProbe {
  state: 'idle' | 'opening' | 'open' | 'failed';
  name: string | null;
  rows: number | null;
  message: string | null;
  notice: string | null;
  dragging: boolean;
}
type Global = { __tychoWorkbench?: WorkbenchProbe; __tychoDropInput?: HTMLInputElement; __tychoCopy?: ArrayBuffer; __tychoBridge?: { query(sql: string, id: number): Promise<Uint8Array> } };

const workbench = (page: Page) => page.evaluate(() => (globalThis as Global).__tychoWorkbench ?? null);
const now = (page: Page) => page.evaluate(() => performance.now());

/**
 * Drops the file at `file` (a disk path) on the canvas, the way the OS does:
 * dragenter, dragover, drop, each carrying a DataTransfer with the file.
 * Returns the page time just before the drop event.
 */
async function drop(page: Page, file: string): Promise<number> {
  await page.evaluate(() => {
    const g = globalThis as Global;
    if (!g.__tychoDropInput) {
      const input = document.createElement('input');
      input.type = 'file';
      input.hidden = true;
      document.body.append(input);
      g.__tychoDropInput = input;
    }
  });
  const input = await page.evaluateHandle(() => (globalThis as Global).__tychoDropInput!);
  await input.asElement()!.setInputFiles(file);
  return page.evaluate(() => {
    const file = (globalThis as Global).__tychoDropInput!.files![0]!;
    const canvas = document.querySelector('canvas')!;
    const transfer = new DataTransfer();
    transfer.items.add(file);
    const fire = (type: string) => canvas.dispatchEvent(new DragEvent(type, { dataTransfer: transfer, bubbles: true, cancelable: true, clientX: 720, clientY: 450 }));
    fire('dragenter');
    fire('dragover');
    const at = performance.now();
    fire('drop');
    return at;
  });
}

/** Waits until the workbench shows `name` open with its first rows painted
 *  after `since`; returns [shown, firstRows] page times. */
async function waitOpen(page: Page, name: string, since: number, timeout = 60_000): Promise<[number, number]> {
  const shown = await waitMark(page, 'tycho:file-shown', since, timeout);
  const firstRows = await waitMark(page, 'tycho:first-rows', since, timeout);
  const state = await workbench(page);
  if (state?.state !== 'open' || state.name !== base(name)) throw new Error(`expected ${base(name)} open, got ${JSON.stringify(state)}`);
  const expected = manifest[name]!.rows;
  if (state.rows !== expected) throw new Error(`${base(name)}: ${state.rows} rows shown, file has ${expected}`);
  return [shown, firstRows];
}

async function warm(page: Page) {
  await waitOverlay(page, 'Parquet ready', /ms$/, 180_000);
}

// 1. Drop → schema, first rows.
async function dropRun(url: string, profile: Profile, name: string) {
  const run = await open(chromium, url, { profile });
  try {
    const { page } = run;
    await warm(page);
    const at = await drop(page, path(name));
    const [shown, firstRows] = await waitOpen(page, name, at);
    const schemaOverlay = await waitOverlay(page, 'File → schema', /ms$|failed/, 10_000);
    const rowsOverlay = await waitOverlay(page, 'File → first rows', /ms$|failed/, 10_000);
    const appDrop = await page.evaluate(() => performance.getEntriesByName('tycho:file-open', 'mark').at(-1)?.startTime ?? null);
    return {
      schemaMs: shown - at,
      firstRowsMs: firstRows - at,
      overlaySchemaMs: Number.parseFloat(schemaOverlay),
      overlayFirstRowsMs: Number.parseFloat(rowsOverlay),
      // The app stamps the drop in its listener; the script just before
      // dispatching. Their gap is the listener's own latency.
      appDropLagMs: appDrop === null ? null : appDrop - at,
      problems: run.problems,
    };
  } finally {
    await run.close();
  }
}

// 2. Memory.
async function memorySnapshot(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('HeapProfiler.collectGarbage');
  await cdp.detach();
  await page.waitForTimeout(1_200); // The overlay refreshes every 500 ms.
  const overlay = (await overlayValue(page, 'Memory')) ?? '';
  const [, wasm, js] = /wasm ([\d.]+) · JS ([\d.]+) MiB/.exec(overlay) ?? [];
  const all = await page.evaluate(async () => {
    try {
      return (await (performance as unknown as { measureUserAgentSpecificMemory(): Promise<{ bytes: number }> }).measureUserAgentSpecificMemory()).bytes;
    } catch {
      return null;
    }
  });
  return { wasmMiB: Number(wasm ?? NaN), jsHeapMiB: Number(js ?? NaN), allAgentsMiB: all === null ? null : Number((all / 2 ** 20).toFixed(1)) };
}

async function memoryRun(url: string, name: string, holdCopy = false) {
  const run = await open(chromium, url, { params: { bench: '' } });
  try {
    const { page } = run;
    await warm(page);
    const at = await drop(page, path(name));
    await waitOpen(page, name, at);
    const snapshots = { opened: await memorySnapshot(page) } as Record<string, Awaited<ReturnType<typeof memorySnapshot>>>;
    for (const key of ['End', 'Home'] as const) {
      await page.keyboard.press(key);
      // A viewport that lands on cached pages never goes unfilled, so no new
      // `tycho:viewport-filled`: wait on what the table shows instead.
      await page.waitForFunction(
        (key) => {
          const table = (globalThis as { __tychoTable?: { rows: number; first: number; end: number; pending: number } }).__tychoTable;
          return !!table && table.pending === 0 && (key === 'End' ? table.end === table.rows : table.first === 0);
        },
        key,
        { timeout: 30_000, polling: 20 },
      );
      snapshots[key] = await memorySnapshot(page);
    }
    if (holdCopy) {
      // Negative control: the file's bytes held in the page, as a copy would be.
      await page.evaluate(async () => {
        const g = globalThis as Global;
        g.__tychoCopy = await g.__tychoDropInput!.files![0]!.arrayBuffer();
      });
      snapshots.withCopy = await memorySnapshot(page);
    }
    const values = Object.entries(snapshots).filter(([key]) => key !== 'withCopy').map(([, snapshot]) => snapshot);
    const peak = {
      appMiB: Math.max(...values.map((s) => s.wasmMiB + s.jsHeapMiB)),
      allAgentsMiB: Math.max(...values.map((s) => s.allAgentsMiB ?? NaN)),
    };
    return { file: name, bytes: manifest[name]!.bytes, snapshots, peak, problems: run.problems };
  } finally {
    await run.close();
  }
}

// 3. Unsupported files.
function unsupportedFiles(dir: string) {
  const make = (name: string, bytes: Uint8Array | string) => {
    writeFileSync(join(dir, name), bytes);
    return join(dir, name);
  };
  const junk = new Uint8Array(4096).map((_, index) => (index * 31) & 0xff);
  const encrypted = new Uint8Array(64);
  encrypted.set(new TextEncoder().encode('PARE'), 0);
  encrypted.set(new TextEncoder().encode('PARE'), 60);
  return [
    { file: make('notes.txt', 'hello, world\n'), expect: /isn't a Parquet file/ },
    { file: make('table.csv', 'a,b\n1,2\n3,4\n'), expect: /is a CSV file.*CSV support is coming/ },
    { file: make('junk.parquet', junk), expect: /isn't a Parquet file/ },
    { file: make('tiny.parquet', 'PAR1\n'), expect: /isn't a Parquet file/ },
    { file: make('secret.parquet', encrypted), expect: /encrypted Parquet/ },
  ];
}

async function unsupportedCheck(url: string) {
  const dir = mkdtempSync(join(tmpdir(), 'tycho-drop-'));
  const cases = unsupportedFiles(dir);
  const run = await open(chromium, url);
  const results: { file: string; over: string; notice: string | null; state: string | null; ok: boolean }[] = [];
  try {
    const { page } = run;
    await warm(page);
    const check = async (over: 'empty' | 'open') => {
      for (const { file, expect } of cases) {
        const before = await workbench(page);
        await drop(page, file);
        const probe = await page
          .waitForFunction((name) => {
            const probe = (globalThis as Global).__tychoWorkbench;
            return probe?.notice?.includes(name) ? probe : false;
          }, base(file), { timeout: 10_000, polling: 20 })
          .then((handle) => handle.jsonValue() as Promise<WorkbenchProbe>)
          .catch(() => null);
        const kept = over === 'empty' ? probe?.state === 'idle' : probe?.state === 'open' && probe.name === before?.name;
        results.push({ file: base(file), over, notice: probe?.notice ?? null, state: probe?.state ?? null, ok: !!probe && expect.test(probe.notice ?? '') && kept });
      }
    };
    await check('empty');
    const at = await drop(page, path(FILES.small));
    await waitOpen(page, FILES.small, at);
    await check('open');
    return { results, problems: run.problems };
  } finally {
    await run.close();
  }
}

// 4. Supersede.
async function supersedeCheck(url: string) {
  const cases: { name: string; ok: boolean; detail: string; problems: string[] }[] = [];
  const attempt = async (name: string, body: (page: Page) => Promise<string>, options: { warm?: boolean } = {}) => {
    const run = await open(chromium, url, { params: { bench: '' } });
    try {
      if (options.warm !== false) await warm(run.page);
      const detail = await body(run.page);
      cases.push({ name, ok: run.problems.length === 0, detail, problems: run.problems });
    } catch (error) {
      cases.push({ name, ok: false, detail: String(error), problems: run.problems });
    } finally {
      await run.close();
    }
  };
  /** After the winner's first rows, nothing else may show for 2 s, and the
   *  engine must still answer. */
  const settledOn = async (page: Page, name: string, since: number) => {
    const [shown, firstRows] = await waitOpen(page, name, since);
    await page.waitForTimeout(2_000);
    const state = await workbench(page);
    if (state?.name !== base(name)) throw new Error(`${state?.name} replaced ${base(name)} afterwards`);
    const shownMarks = await page.evaluate((since) => performance.getEntriesByName('tycho:file-shown', 'mark').filter((entry) => entry.startTime >= since).length, since);
    const answer = await page.evaluate(async () => {
      const bytes = await (globalThis as Global).__tychoBridge!.query("SELECT 'ENGINE_OK' AS v", 4_000_001);
      return new TextDecoder('latin1').decode(bytes).includes('ENGINE_OK');
    });
    if (!answer) throw new Error('engine stopped answering');
    return `${base(name)} shown ${(shown - since).toFixed(0)} ms, first rows ${(firstRows - since).toFixed(0)} ms after the last drop; summaries shown since: ${shownMarks}`;
  };

  await attempt('1 GB, then 100 MB 20 ms later (while opening)', async (page) => {
    await drop(page, path(FILES.big));
    await page.waitForTimeout(20);
    const state = await workbench(page);
    const at = await drop(page, path(FILES.small));
    return `state at second drop: ${state?.state} ${state?.name}; ${await settledOn(page, FILES.small, at)}`;
  });
  await attempt('100 MB, then 1 GB once its schema shows (pages loading)', async (page) => {
    const first = await drop(page, path(FILES.small));
    await waitMark(page, 'tycho:file-shown', first);
    const table = await page.evaluate(() => (globalThis as { __tychoTable?: { pending: number } }).__tychoTable?.pending ?? null);
    const at = await drop(page, path(FILES.big));
    return `pages pending at second drop: ${table}; ${await settledOn(page, FILES.big, at)}`;
  });
  await attempt('sample click, then a drop while the sample opens', async (page) => {
    await clickTarget(page, 'try-sample-asteroids');
    const at = await drop(page, path(FILES.small));
    const detail = await settledOn(page, FILES.small, at);
    const sampleShown = await page.evaluate(() => performance.getEntriesByName('tycho:sample-shown', 'mark').length);
    if (sampleShown > 0) throw new Error('the sample showed after the drop');
    return detail;
  }, { warm: true });
  await attempt('drop before the engine is ready', async (page) => {
    await page.waitForFunction(() => performance.getEntriesByName('gpui:first-frame', 'mark').length > 0, null, { timeout: 60_000, polling: 10 });
    const at = await drop(page, path(FILES.small));
    const readyAtDrop = await page.evaluate(() => performance.getEntriesByName('tycho:engine-ready', 'mark').length > 0);
    // The sniff runs first; then the open waits on the engine.
    const waiting = await page
      .waitForFunction(() => ((globalThis as Global).__tychoWorkbench?.state === 'opening' ? (globalThis as Global).__tychoWorkbench : false), null, { timeout: 10_000, polling: 5 })
      .then((handle) => handle.jsonValue() as Promise<WorkbenchProbe>)
      .catch(() => null);
    if (readyAtDrop) return 'engine was already ready at the drop (inconclusive)';
    const detail = await settledOn(page, FILES.small, at);
    return `state while loading: ${waiting?.state}; ${detail}`;
  }, { warm: false });
  return cases;
}

// 5. Browsers: drop and the file dialog.
async function browserCheck(engine: BrowserType, url: string) {
  const out: { how: string; ok: boolean; detail: string }[] = [];
  const run = await open(engine, url);
  try {
    const { page } = run;
    await warm(page);
    try {
      const at = await drop(page, path(FILES.small));
      const [shown, firstRows] = await waitOpen(page, FILES.small, at);
      out.push({ how: 'drop', ok: true, detail: `schema ${(shown - at).toFixed(0)} ms, first rows ${(firstRows - at).toFixed(0)} ms` });
    } catch (error) {
      out.push({ how: 'drop', ok: false, detail: String(error) });
    }
    try {
      // The header's "Open file…" button, now that a file is open.
      const chooser = page.waitForEvent('filechooser', { timeout: 10_000 });
      await clickTarget(page, 'open-file');
      const at = await now(page);
      await (await chooser).setFiles(path(FILES.big));
      const [shown, firstRows] = await waitOpen(page, FILES.big, at);
      out.push({ how: 'file dialog', ok: true, detail: `schema ${(shown - at).toFixed(0)} ms, first rows ${(firstRows - at).toFixed(0)} ms after the choice` });
    } catch (error) {
      out.push({ how: 'file dialog', ok: false, detail: String(error) });
    }
    return { browser: engine.name(), checks: out, problems: run.problems };
  } finally {
    await run.close();
  }
}

// Main.
// The files come from disk; the Worker (local R2) serves only the sample,
// which one supersede case clicks.
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
const failures: string[] = [];
const output: Record<string, unknown> = {
  date,
  label,
  ...machineInfo(),
  files: Object.fromEntries(Object.values(FILES).map((name) => [name, manifest[name]])),
  budgets: BUDGET,
};

try {
  if (wanted('drop')) {
    const profiles = flag('reference-only') ? PROFILES.slice(0, 1) : PROFILES;
    const drops: Record<string, unknown> = {};
    for (const profile of profiles) {
      const results = [];
      for (let index = 0; index < runs; index++) results.push(await dropRun(url, profile, FILES.big));
      const schema = summarize(results.map((r) => r.schemaMs));
      const firstRows = summarize(results.map((r) => r.firstRowsMs));
      console.log(`drop 1 GB (${profile.name}): schema ${JSON.stringify(schema)} ms, first rows ${JSON.stringify(firstRows)} ms`);
      drops[profile.name] = { schemaMs: schema, firstRowsMs: firstRows, overlayFirstRowsMs: summarize(results.map((r) => r.overlayFirstRowsMs)), appDropLagMs: summarize(results.flatMap((r) => (r.appDropLagMs === null ? [] : [r.appDropLagMs])), 2), runs: results };
      if (profile.name === 'reference') {
        if (schema!.median > BUDGET.schemaMs) failures.push(`drop → schema ${schema!.median} ms > ${BUDGET.schemaMs} ms`);
        if (firstRows!.median > BUDGET.firstRowsMs) failures.push(`drop → first rows ${firstRows!.median} ms > ${BUDGET.firstRowsMs} ms`);
      }
      for (const r of results) failures.push(...r.problems.map((p) => `drop (${profile.name}): ${p}`));
    }
    for (const name of [FILES.bigRg122880, FILES.bigRg1048576]) {
      const results = [];
      for (let index = 0; index < layoutRuns; index++) results.push(await dropRun(url, PROFILES[0]!, name));
      const firstRows = summarize(results.map((r) => r.firstRowsMs));
      console.log(`drop ${base(name)} (reference, recorded): schema ${JSON.stringify(summarize(results.map((r) => r.schemaMs)))} ms, first rows ${JSON.stringify(firstRows)} ms`);
      drops[name] = { schemaMs: summarize(results.map((r) => r.schemaMs)), firstRowsMs: firstRows, runs: results };
    }
    output.drop = drops;
  }

  if (wanted('memory')) {
    const small = await memoryRun(url, FILES.small);
    const big = await memoryRun(url, FILES.big);
    const control = await memoryRun(url, FILES.small, true);
    const delta = { appMiB: big.peak.appMiB - small.peak.appMiB, allAgentsMiB: big.peak.allAgentsMiB - small.peak.allAgentsMiB };
    const copyMiB = (control.snapshots.withCopy!.allAgentsMiB ?? 0) - (control.snapshots.Home!.allAgentsMiB ?? 0);
    const fileMiB = manifest[FILES.small]!.bytes / 2 ** 20;
    console.log(`memory peak: 100 MB app ${small.peak.appMiB.toFixed(1)} / all ${small.peak.allAgentsMiB} MiB; 1 GB app ${big.peak.appMiB.toFixed(1)} / all ${big.peak.allAgentsMiB} MiB; delta ${JSON.stringify(delta)}`);
    console.log(`memory control: holding the 100 MB file's bytes reads +${copyMiB.toFixed(1)} MiB (file ${fileMiB.toFixed(1)} MiB)`);
    output.memory = { small, big, delta, control: { ...control, copyMiB, fileMiB } };
    const sizeDiffMiB = (big.bytes - small.bytes) / 2 ** 20;
    const allAgentsBound = sizeDiffMiB * BUDGET.allAgentsDeltaOfSizeDiff;
    console.log(`memory bounds: app ±${BUDGET.appDeltaMiB} MiB; all agents ±${allAgentsBound.toFixed(1)} MiB (10% of the ${sizeDiffMiB.toFixed(1)} MiB size difference)`);
    if (Math.abs(delta.allAgentsMiB) > allAgentsBound) failures.push(`memory: 1 GB peak is ${delta.allAgentsMiB.toFixed(1)} MiB off 100 MB's (all agents; bound ${allAgentsBound.toFixed(1)})`);
    if (Math.abs(delta.appMiB) > BUDGET.appDeltaMiB) failures.push(`memory: 1 GB peak is ${delta.appMiB.toFixed(1)} MiB off 100 MB's (app)`);
    if (copyMiB < fileMiB * BUDGET.copyDetect) failures.push(`memory control: a held copy read only +${copyMiB.toFixed(1)} MiB of ${fileMiB.toFixed(1)}`);
    for (const r of [small, big, control]) failures.push(...r.problems.map((p) => `memory: ${p}`));
  }

  if (wanted('unsupported')) {
    const result = await unsupportedCheck(url);
    for (const r of result.results) console.log(`unsupported ${r.file} over ${r.over}: ${r.ok ? 'ok' : 'FAIL'} (${r.state}) ${r.notice}`);
    output.unsupported = result;
    failures.push(...result.results.filter((r) => !r.ok).map((r) => `unsupported ${r.file} over ${r.over}: ${r.state} ${r.notice}`));
    failures.push(...result.problems.map((p) => `unsupported: ${p}`));
  }

  if (wanted('supersede')) {
    const cases = await supersedeCheck(url);
    for (const c of cases) console.log(`supersede — ${c.name}: ${c.ok ? 'ok' : 'FAIL'}: ${c.detail}${c.problems.length ? ` [${c.problems.join('; ')}]` : ''}`);
    output.supersede = cases;
    failures.push(...cases.filter((c) => !c.ok).map((c) => `supersede — ${c.name}: ${c.detail} ${c.problems.join('; ')}`));
  }

  if (wanted('browsers')) {
    const browsers = [];
    for (const engine of [chromium, firefox, webkit]) {
      const result = await browserCheck(engine, url);
      for (const c of result.checks) console.log(`${result.browser} ${c.how}: ${c.ok ? 'ok' : 'FAIL'}: ${c.detail}`);
      browsers.push(result);
      failures.push(...result.checks.filter((c) => !c.ok).map((c) => `${result.browser} ${c.how}: ${c.detail}`));
      failures.push(...result.problems.map((p) => `${result.browser}: ${p}`));
    }
    output.browsers = browsers;
  }
} finally {
  await server.close();
  await worker.close();
}

output.failures = failures;
const resultsDir = join(perfDir, 'results');
mkdirSync(resultsDir, { recursive: true });
const file = join(resultsDir, `${date}-${label}.json`);
writeFileSync(file, `${JSON.stringify(output, null, 2)}\n`);
console.log(`wrote ${file}`);
if (failures.length) {
  console.error(`\n${failures.length} failure(s):\n${failures.map((f) => `  - ${f}`).join('\n')}`);
  process.exit(1);
}
