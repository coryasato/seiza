// M6 checks: open a CSV file from this device, on the release build.
//
// The files: `drop/asteroids-x6.csv` (~1 GB: the fixture's header, then its
// body 6 times; `just tycho drop-files`) and `data/fixtures/asteroids.csv`
// (the asteroid rows, then tricky rows: quoted commas, quoted newlines,
// doubled quotes, UTF-8, spaces, empties). Both are dropped from disk like a
// visitor's file (harness.ts, `dropFile`).
//
// 1. Drop the 1 GB CSV (Chromium headless=new, new browser per run, 1440×900
//    at DPR 2, median of --runs, engine warm, i.e. "Parquet ready"), reference
//    and throttled:
//    - drop → `tycho:file-shown` (schema) and → `tycho:first-rows`: ≤ 1 s
//      (reference).
//    - while it loads, a 3 s wheel fling down the rows loaded so far, then
//      back up: frame intervals p95 ≤ 20 ms, none > 50 ms (M4's budget).
//    - the row count's updates: the gaps between `tycho:csv-rows` marks
//      (each set right after a frame showing the count grow), from first
//      rows to `tycho:csv-done`: every gap ≤ 500 ms (reference). Sampled
//      every 100 ms, the table's row extent (its scrollbar) must equal the
//      header's count, and both only grow.
//    - the final count must match MANIFEST.json; ingest time, MB/s, chunks,
//      and the slowest chunk are recorded (the overlay's "CSV load" and
//      "CSV chunks" rows), with memory after (wasm + JS heap, and every
//      agent, DuckDB's worker included).
// 2. Fixture (Chromium): drop fixtures/asteroids.csv; the count must match
//    MANIFEST.json (1,567,531; quoted newlines make it differ from the line
//    count), End must show the last tricky row, and the tricky rows' values
//    must read back exactly (through the `?bench` bridge).
// 3. Supersede and cleanup (Chromium): a Parquet file over a CSV that's
//    loading, one that's loaded, and one whose load stopped on a bad row;
//    another CSV over a loading CSV. The last one wins, and the replaced
//    CSV's tables are gone from DuckDB once it settles. No console errors.
// 4. Formats (Chromium), generated multi-chunk files: a `rowid` column (it
//    would hide DuckDB's own), a literal quote inside a field (`12" pizza`),
//    an unquoted TSV whose field starts with a quote, and a malformed row
//    near the end (the load stops, the rows before it stay).
// 5. Browsers: the fixture in Firefox and WebKit: loads, count matches.
//
// Usage: node apps/tycho/perf/csv.ts [--runs 10] [--throttled-runs 10] [--label m6-csv]
//                                    [--reference-only] [--only drop|fixture|supersede|formats|browsers]
// Starts `vite preview` on web/dist. Writes perf/results/<date>-<label>.json.
// Run `just tycho build` first.

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, firefox, webkit, type BrowserType, type Page } from '@playwright/test';
import { preview } from 'vite';
import { assertPortFree } from '../worker/scripts/dev.ts';
import { PROFILES, flag, machineInfo, option, summarize, type Profile } from './common.ts';
import { dropFile, frameRecorder, framesBetween, open, overlayValue, targetRect, waitMark, waitOverlay, wheel, type TableProbe } from './harness.ts';

const perfDir = dirname(fileURLToPath(import.meta.url));
const webDir = join(perfDir, '../web');
const dataDir = join(perfDir, '../data');
const manifest = JSON.parse(readFileSync(join(dataDir, 'MANIFEST.json'), 'utf8')) as Record<string, { rows: number; bytes: number }>;

const FILES = {
  big: 'drop/asteroids-x6.csv',
  fixture: 'fixtures/asteroids.csv',
  parquet: 'drop/asteroids-x3.parquet',
} as const;
for (const name of Object.values(FILES)) {
  if (!manifest[name]) throw new Error(`${name} isn't in MANIFEST.json: run \`just tycho data\` and \`just tycho drop-files\``);
}
const path = (name: string) => join(dataDir, name);
const base = (name: string) => name.split('/').pop()!;

const BUDGET = { schemaMs: 1000, firstRowsMs: 1000, updateGapMs: 500, flingP95Ms: 20, flingMaxMs: 50 };
const runs = Number(option('runs') ?? 10);
const throttledRuns = Number(option('throttled-runs') ?? runs);
const label = option('label') ?? 'm6-csv';
const only = option('only');
const wanted = (part: string) => !only || only === part;

interface WorkbenchProbe {
  state: 'idle' | 'opening' | 'open' | 'failed';
  name: string | null;
  rows: number | null;
  message: string | null;
  notice: string | null;
  ingest: 'loading' | 'done' | 'stopped' | null;
  readBytes: number | null;
  chunks: number | null;
}
type Bridge = { query(sql: string, id: number): Promise<Uint8Array> };
type Global = { __tychoWorkbench?: WorkbenchProbe; __tychoTable?: TableProbe; __tychoBridge?: Bridge; __csvSamples?: { t: number; header: number | null; table: number | null }[] };

const workbench = (page: Page) => page.evaluate(() => (globalThis as Global).__tychoWorkbench ?? null);
const now = (page: Page) => page.evaluate(() => performance.now());

async function warm(page: Page) {
  await waitOverlay(page, 'Parquet ready', /ms$/, 180_000);
}

/** Waits for the CSV's load to end (done or stopped); returns the probe. */
async function waitLoaded(page: Page, name: string, timeout: number): Promise<WorkbenchProbe> {
  const handle = await page.waitForFunction(
    (name) => {
      const probe = (globalThis as Global).__tychoWorkbench;
      if (probe?.state === 'failed') return probe;
      return probe?.name === name && (probe.ingest === 'done' || probe.ingest === 'stopped') ? probe : false;
    },
    name,
    { timeout, polling: 100 },
  );
  return (await handle.jsonValue()) as WorkbenchProbe;
}

/** One SQL answer as text, through the bridge (`?bench`), found in the raw
 *  IPC bytes by a marker. */
async function sqlText(page: Page, sql: string): Promise<string | null> {
  return page.evaluate(async (sql) => {
    const bytes = await (globalThis as Global).__tychoBridge!.query(`SELECT 'VAL:' || (${sql}) || ':END' AS v`, 3_000_000 + Math.floor(Math.random() * 1_000_000));
    return /VAL:([\s\S]*?):END/.exec(new TextDecoder().decode(bytes))?.[1] ?? null;
  }, sql);
}

/** The chunk tables DuckDB holds for CSV opens, all opens together. */
const csvTables = (page: Page) => sqlText(page, "SELECT count(*) FROM duckdb_tables() WHERE database_name = 'tycho_csv'");

async function memorySnapshot(page: Page) {
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

// 1. Drop the 1 GB CSV.
async function dropRun(url: string, profile: Profile) {
  const name = FILES.big;
  const run = await open(chromium, url, { profile });
  try {
    const { page, context } = run;
    await context.addInitScript(frameRecorder);
    await page.evaluate(frameRecorder);
    await warm(page);
    // Sample the header's count and the table's extent every 100 ms.
    await page.evaluate(() => {
      const g = globalThis as Global;
      const samples: NonNullable<Global['__csvSamples']> = [];
      g.__csvSamples = samples;
      const timer = setInterval(() => {
        const probe = g.__tychoWorkbench;
        samples.push({ t: performance.now(), header: probe?.state === 'open' ? probe.rows : null, table: g.__tychoTable?.rows ?? null });
        if (probe?.ingest === 'done' || probe?.ingest === 'stopped') clearInterval(timer);
      }, 100);
    });
    const at = await dropFile(page, path(name));
    const shown = await waitMark(page, 'tycho:file-shown', at, 60_000);
    const firstRows = await waitMark(page, 'tycho:first-rows', at, 60_000);

    // Scroll while it loads: a 3 s fling down what's loaded, then back up.
    const [x, y, , h] = await targetRect(page, 'table-scroll-track');
    await page.mouse.move(x - 400, y + h / 2);
    const flingStart = await now(page);
    const wallStart = Date.now();
    let direction = 1;
    while (Date.now() - wallStart < 3_000) {
      const rows = (await page.evaluate(() => (globalThis as Global).__tychoTable?.rows ?? 0)) as number;
      // ~1.5 s to cross what's loaded (30 px rows, one event per ~16 ms).
      await wheel(page, direction * Math.max(1_000, (rows * 30 * 16) / 1_500));
      if (Date.now() - wallStart > 1_500) direction = -1;
      await page.waitForTimeout(8);
    }
    const flingEnd = await now(page);
    const fling = await framesBetween(page, flingStart, flingEnd + 300);
    const loadedDuringFling = await workbench(page);

    const probe = await waitLoaded(page, base(name), profile.name === 'reference' ? 120_000 : 600_000);
    const done = await page.evaluate(() => performance.getEntriesByName('tycho:csv-done', 'mark').at(-1)?.startTime ?? null);
    const marks = await page.evaluate(({ from }) => performance.getEntriesByName('tycho:csv-rows', 'mark').map((mark) => mark.startTime).filter((t) => t >= from), { from: firstRows - 1 });
    const times = [firstRows, ...marks.filter((t) => t > firstRows), ...(done === null ? [] : [done])];
    const gaps = times.slice(1).map((t, index) => t - times[index]!);
    const samples = (await page.evaluate(() => (globalThis as Global).__csvSamples ?? [])) as NonNullable<Global['__csvSamples']>;
    const open = samples.filter((sample) => sample.header !== null);
    const mismatched = open.filter((sample) => sample.table !== sample.header).length;
    const shrank = open.filter((sample, index) => index > 0 && sample.header! < open[index - 1]!.header!).length;
    const loadOverlay = await overlayValue(page, 'CSV load');
    const chunksOverlay = await overlayValue(page, 'CSV chunks');
    const memory = await memorySnapshot(page);
    return {
      schemaMs: shown - at,
      firstRowsMs: firstRows - at,
      ingestMs: done === null ? null : done - at,
      mbPerS: done === null ? null : manifest[name]!.bytes / 1e6 / ((done - at) / 1000),
      rows: probe.rows,
      state: probe.ingest,
      message: probe.message,
      chunks: probe.chunks,
      updates: marks.length,
      gapMs: { p50: summarize(gaps)?.median ?? null, max: Math.max(...gaps) },
      fling: { ...fling, rowsWhenDone: loadedDuringFling?.rows ?? null },
      samples: open.length,
      mismatchedSamples: mismatched,
      shrankSamples: shrank,
      overlay: { load: loadOverlay, chunks: chunksOverlay, firstRows: await overlayValue(page, 'File → first rows') },
      memory,
      problems: run.problems,
    };
  } finally {
    await run.close();
  }
}

/** The fixture's hand-written rows (fixtures-src/tricky_rows.csv), as DuckDB
 *  reads them: spkid, name (NULL as ∅), and pdes. */
const TRICKY = [
  ['99000001', 'Comma, Inside', 'TEST-1'],
  ['99000002', 'Two\nLines', 'TEST-2'],
  ['99000003', 'The "Quoted" One', 'TEST-3'],
  ['99000004', 'All, "of"\nthem', 'TEST-4'],
  ['99000005', 'Ωμέγα', 'TEST-5'],
  ['99000006', '   spaced   ', 'TEST-6'],
  ['99000007', '∅', 'TEST-7'],
  ['99000008', 'trailing,', 'TEST-8'],
];

// 2. The fixture.
async function fixtureCheck(url: string, engine: BrowserType = chromium) {
  const name = FILES.fixture;
  const run = await open(engine, url, { params: { bench: '' } });
  try {
    const { page } = run;
    await warm(page);
    const at = await dropFile(page, path(name));
    const probe = await waitLoaded(page, base(name), 180_000);
    const loadedMs = (await now(page)) - at;
    const expected = manifest[name]!.rows;
    const checks: { what: string; ok: boolean; detail: string }[] = [];
    checks.push({ what: 'count', ok: probe.rows === expected && probe.ingest === 'done', detail: `${probe.rows} rows (${probe.ingest}), file has ${expected}` });
    const table = await page.evaluate(() => (globalThis as Global).__tychoTable ?? null);
    checks.push({ what: 'table extent', ok: table?.rows === expected, detail: `table ${table?.rows}` });
    await page.keyboard.press('End');
    const end = await page
      .waitForFunction(() => {
        const table = (globalThis as Global).__tychoTable;
        return table && table.end === table.rows && table.pending === 0 ? table : false;
      }, undefined, { timeout: 30_000, polling: 20 })
      .then((handle) => handle.jsonValue() as Promise<TableProbe>)
      .catch(() => null);
    checks.push({ what: 'End shows the last row', ok: end?.lastCell === '99000008', detail: `last cell ${end?.lastCell ?? 'none'}` });
    if (engine === chromium) {
      // The last chunk table holds the tricky rows; read them back.
      const last = await sqlText(page, "SELECT schema_name || '.' || table_name FROM duckdb_tables() WHERE database_name = 'tycho_csv' ORDER BY schema_name DESC, CAST(table_name[2:] AS INTEGER) DESC LIMIT 1");
      const got = await sqlText(
        page,
        `SELECT string_agg(spkid || '\t' || coalesce(name, '∅') || '\t' || pdes, '\u001e' ORDER BY rowid) FROM (SELECT rowid, * FROM tycho_csv.${last} ORDER BY rowid DESC LIMIT 8)`,
      );
      const want = TRICKY.map((row) => row.join('\t')).join('\u001e');
      checks.push({ what: 'tricky rows read back exactly', ok: got === want, detail: got === want ? '8 rows match' : `got ${JSON.stringify(got)}` });
    }
    return { browser: engine.name(), loadedMs, rows: probe.rows, checks, problems: run.problems };
  } finally {
    await run.close();
  }
}

// 3. Supersede and cleanup.
async function supersedeCheck(url: string) {
  const cases: { name: string; ok: boolean; detail: string; problems: string[] }[] = [];
  const attempt = async (name: string, body: (page: Page) => Promise<[boolean, string]>) => {
    const run = await open(chromium, url, { params: { bench: '' } });
    try {
      await warm(run.page);
      const [ok, detail] = await body(run.page);
      cases.push({ name, ok: ok && run.problems.length === 0, detail, problems: run.problems });
    } catch (error) {
      cases.push({ name, ok: false, detail: String(error), problems: run.problems });
    } finally {
      await run.close();
    }
  };
  /** Waits for the replaced CSV's tables to go (only `keep` tables left). */
  const tablesSettle = async (page: Page, keep: number) => {
    const deadline = Date.now() + 10_000;
    let tables = await csvTables(page);
    while (Number(tables) > keep && Date.now() < deadline) {
      await page.waitForTimeout(100);
      tables = await csvTables(page);
    }
    return Number(tables);
  };

  await attempt('Parquet over a loading CSV', async (page) => {
    await dropFile(page, path(FILES.big));
    await page.waitForFunction(() => ((globalThis as Global).__tychoWorkbench?.chunks ?? 0) >= 5, undefined, { timeout: 60_000 });
    const at = await dropFile(page, path(FILES.parquet));
    await waitMark(page, 'tycho:first-rows', at, 60_000);
    await page.waitForTimeout(1_000);
    const probe = await workbench(page);
    const tables = await tablesSettle(page, 0);
    const ok = probe?.name === base(FILES.parquet) && probe.rows === manifest[FILES.parquet]!.rows && probe.ingest === null && tables === 0;
    return [ok, `shows ${probe?.name} (${probe?.rows} rows, ingest ${probe?.ingest}); CSV tables left: ${tables}`];
  });

  await attempt('Parquet over a loaded CSV', async (page) => {
    await dropFile(page, path(FILES.fixture));
    await waitLoaded(page, base(FILES.fixture), 120_000);
    const loaded = Number(await csvTables(page));
    const at = await dropFile(page, path(FILES.parquet));
    await waitMark(page, 'tycho:first-rows', at, 60_000);
    const tables = await tablesSettle(page, 0);
    return [loaded > 0 && tables === 0, `${loaded} CSV tables while shown; ${tables} left after the Parquet opened`];
  });

  await attempt('Parquet over a CSV whose load stopped', async (page) => {
    await dropFile(page, formats.broken.file);
    const probe = await waitLoaded(page, base(formats.broken.file), 120_000);
    const loaded = Number(await csvTables(page));
    const at = await dropFile(page, path(FILES.parquet));
    await waitMark(page, 'tycho:first-rows', at, 60_000);
    const tables = await tablesSettle(page, 0);
    return [probe.ingest === 'stopped' && loaded > 0 && tables === 0, `CSV ${probe.ingest} at ${probe.rows} rows with ${loaded} tables; ${tables} left after the Parquet opened`];
  });

  await attempt('CSV over a loading CSV', async (page) => {
    await dropFile(page, path(FILES.big));
    await page.waitForFunction(() => ((globalThis as Global).__tychoWorkbench?.chunks ?? 0) >= 5, undefined, { timeout: 60_000 });
    await dropFile(page, path(FILES.fixture));
    const probe = await waitLoaded(page, base(FILES.fixture), 120_000);
    // Only the fixture's tables stay.
    const fixtureTables = Number(await sqlText(page, "SELECT count(*) FROM duckdb_tables() WHERE database_name = 'tycho_csv' AND schema_name = (SELECT max(schema_name) FROM duckdb_tables() WHERE database_name = 'tycho_csv')"));
    const tables = await tablesSettle(page, fixtureTables);
    const ok = probe.rows === manifest[FILES.fixture]!.rows && probe.ingest === 'done' && tables === fixtureTables;
    return [ok, `fixture ${probe.rows} rows (${probe.ingest}); CSV tables ${tables}, the fixture's ${fixtureTables}`];
  });

  await attempt('CSV dropped before the engine is ready', async (page) => {
    // `warm` already ran here; this case reloads and drops at once.
    await page.reload();
    await waitMark(page, 'gpui:first-frame', 0, 30_000);
    const ready = await page.evaluate(() => performance.getEntriesByName('tycho:engine-ready', 'mark').length > 0);
    const at = await dropFile(page, path(FILES.fixture));
    const probe = await waitLoaded(page, base(FILES.fixture), 180_000);
    const firstRows = await waitMark(page, 'tycho:first-rows', at, 10_000);
    return [probe.rows === manifest[FILES.fixture]!.rows && !ready, `${probe.rows} rows; engine ready at the drop: ${ready}; first rows ${(firstRows - at).toFixed(0)} ms after the drop`];
  });
  return cases;
}

// 4. Formats: generated files, each several chunks long (> 1 MiB).
const formatsDir = mkdtempSync(join(tmpdir(), 'tycho-csv-'));
function generate(name: string, header: string, row: (index: number) => string, rows: number, tail = ''): { file: string; rows: number } {
  const lines = [header];
  for (let index = 0; index < rows; index++) lines.push(row(index));
  const file = join(formatsDir, name);
  writeFileSync(file, `${lines.join('\n')}\n${tail}`);
  return { file, rows };
}
const formats = {
  // rowid values that aren't row positions: start at 1000, step 7.
  rowid: generate('with-rowid.csv', 'rowid,value,label', (i) => `${1000 + i * 7},${i},row ${i}`, 400_000),
  inches: generate('inches.csv', 'size,name,count', (i) => (i % 3 === 0 ? `${i % 40}" pizza,pie ${i},${i}` : `${i},plain ${i},${i}`), 400_000),
  tsv: generate('quote-start.tsv', 'a\tb\tc', (i) => (i % 5 === 0 ? `"${i}\tx\t${i}` : `${i}\ty\t${i}`), 400_000),
  broken: generate('broken.csv', 'a,b,c', (i) => `${i},b ${i},${i}`, 400_000, '1,2,3,4,5\n'),
};

async function formatsCheck(url: string) {
  const run = await open(chromium, url, { params: { bench: '' } });
  const checks: { what: string; ok: boolean; detail: string }[] = [];
  try {
    const { page } = run;
    await warm(page);
    for (const key of ['rowid', 'inches', 'tsv'] as const) {
      const { file, rows } = formats[key];
      await dropFile(page, file);
      const probe = await waitLoaded(page, base(file), 60_000);
      checks.push({ what: `${key}: count`, ok: probe.rows === rows && probe.ingest === 'done' && (probe.chunks ?? 0) > 1, detail: `${probe.rows} of ${rows} rows (${probe.ingest}, ${probe.chunks} chunks)${probe.message ? `: ${probe.message}` : ''}` });
      await page.keyboard.press('End');
      const end = await page
        .waitForFunction(() => {
          const table = (globalThis as Global).__tychoTable;
          return table && table.end === table.rows && table.pending === 0 ? table : false;
        }, undefined, { timeout: 30_000, polling: 20 })
        .then((handle) => handle.jsonValue() as Promise<TableProbe>)
        .catch(() => null);
      const last = rows - 1;
      const want = key === 'rowid' ? String(1000 + last * 7) : key === 'inches' && last % 3 === 0 ? `${last % 40}" pizza` : String(last);
      checks.push({ what: `${key}: End shows the last row`, ok: end?.lastCell === want, detail: `last cell ${end?.lastCell ?? 'none'}, want ${want}` });
    }
    const { file, rows } = formats.broken;
    await dropFile(page, file);
    const probe = await waitLoaded(page, base(file), 60_000);
    checks.push({
      what: 'malformed row: load stops, rows before it stay',
      ok: probe.ingest === 'stopped' && (probe.rows ?? 0) > 0 && (probe.rows ?? 0) <= rows,
      detail: `${probe.ingest} at ${probe.rows} of ${rows} rows`,
    });
    return { checks, problems: run.problems };
  } finally {
    await run.close();
  }
}

const port = 4181;
await assertPortFree(port);
const server = await preview({ root: webDir, preview: { port, strictPort: true }, logLevel: 'warn' });
const url = `http://localhost:${port}/`;
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
      const count = profile.name === 'reference' ? runs : throttledRuns;
      for (let index = 0; index < count; index++) {
        const result = await dropRun(url, profile);
        console.log(
          `  ${profile.name} ${index + 1}/${count}: schema ${result.schemaMs.toFixed(0)} first rows ${result.firstRowsMs.toFixed(0)} ms; ` +
            `ingest ${((result.ingestMs ?? NaN) / 1000).toFixed(1)} s (${(result.mbPerS ?? NaN).toFixed(1)} MB/s, ${result.chunks} chunks, ${result.updates} updates, gap max ${result.gapMs.max.toFixed(0)} ms); ` +
            `fling p95 ${result.fling.p95.toFixed(1)} max ${result.fling.max.toFixed(1)} ms; rows ${result.rows} (${result.state}); memory ${JSON.stringify(result.memory)}`,
        );
        results.push(result);
      }
      const summary = {
        schemaMs: summarize(results.map((r) => r.schemaMs)),
        firstRowsMs: summarize(results.map((r) => r.firstRowsMs)),
        ingestMs: summarize(results.flatMap((r) => (r.ingestMs === null ? [] : [r.ingestMs]))),
        mbPerS: summarize(results.flatMap((r) => (r.mbPerS === null ? [] : [r.mbPerS]))),
        updateGapMaxMs: summarize(results.map((r) => r.gapMs.max)),
        updateGapP50Ms: summarize(results.flatMap((r) => (r.gapMs.p50 === null ? [] : [r.gapMs.p50]))),
        flingP95Ms: summarize(results.map((r) => r.fling.p95)),
        flingMaxMs: summarize(results.map((r) => r.fling.max)),
        flingOver50: summarize(results.map((r) => r.fling.over50), 0),
        allAgentsMiB: summarize(results.flatMap((r) => (r.memory.allAgentsMiB === null ? [] : [r.memory.allAgentsMiB]))),
      };
      console.log(`drop 1 GB CSV (${profile.name}): ${JSON.stringify(summary)}`);
      drops[profile.name] = { ...summary, runs: results };
      const expected = manifest[FILES.big]!.rows;
      for (const [index, r] of results.entries()) {
        const where = `drop (${profile.name} run ${index + 1})`;
        if (r.rows !== expected || r.state !== 'done') failures.push(`${where}: ${r.rows} rows (${r.state}), file has ${expected}`);
        if (r.mismatchedSamples) failures.push(`${where}: the table's extent differed from the header's count in ${r.mismatchedSamples} of ${r.samples} samples`);
        if (r.shrankSamples) failures.push(`${where}: the row count went down ${r.shrankSamples} times`);
        failures.push(...r.problems.map((p) => `${where}: ${p}`));
      }
      if (profile.name === 'reference') {
        if (summary.schemaMs!.median > BUDGET.schemaMs) failures.push(`drop → schema ${summary.schemaMs!.median} ms > ${BUDGET.schemaMs} ms`);
        if (summary.firstRowsMs!.median > BUDGET.firstRowsMs) failures.push(`drop → first rows ${summary.firstRowsMs!.median} ms > ${BUDGET.firstRowsMs} ms`);
        if (summary.updateGapMaxMs!.max > BUDGET.updateGapMs) failures.push(`row count went ${summary.updateGapMaxMs!.max} ms without an update > ${BUDGET.updateGapMs} ms`);
        if (summary.flingP95Ms!.max > BUDGET.flingP95Ms) failures.push(`fling during load p95 up to ${summary.flingP95Ms!.max} ms > ${BUDGET.flingP95Ms} ms`);
        if (summary.flingMaxMs!.max > BUDGET.flingMaxMs) failures.push(`fling during load frame up to ${summary.flingMaxMs!.max} ms > ${BUDGET.flingMaxMs} ms`);
      }
    }
    output.drop = drops;
  }

  if (wanted('fixture')) {
    const result = await fixtureCheck(url);
    for (const c of result.checks) console.log(`fixture ${c.what}: ${c.ok ? 'ok' : 'FAIL'}: ${c.detail}`);
    output.fixture = result;
    failures.push(...result.checks.filter((c) => !c.ok).map((c) => `fixture ${c.what}: ${c.detail}`));
    failures.push(...result.problems.map((p) => `fixture: ${p}`));
  }

  if (wanted('supersede')) {
    const cases = await supersedeCheck(url);
    for (const c of cases) console.log(`supersede — ${c.name}: ${c.ok ? 'ok' : 'FAIL'}: ${c.detail}${c.problems.length ? ` [${c.problems.join('; ')}]` : ''}`);
    output.supersede = cases;
    failures.push(...cases.filter((c) => !c.ok).map((c) => `supersede — ${c.name}: ${c.detail} ${c.problems.join('; ')}`));
  }

  if (wanted('formats')) {
    const result = await formatsCheck(url);
    for (const c of result.checks) console.log(`formats ${c.what}: ${c.ok ? 'ok' : 'FAIL'}: ${c.detail}`);
    output.formats = result;
    failures.push(...result.checks.filter((c) => !c.ok).map((c) => `formats ${c.what}: ${c.detail}`));
    failures.push(...result.problems.map((p) => `formats: ${p}`));
  }

  if (wanted('browsers')) {
    const browsers = [];
    for (const engine of [firefox, webkit]) {
      const result = await fixtureCheck(url, engine);
      for (const c of result.checks) console.log(`${result.browser} fixture ${c.what}: ${c.ok ? 'ok' : 'FAIL'}: ${c.detail} (loaded in ${(result.loadedMs / 1000).toFixed(1)} s)`);
      browsers.push(result);
      failures.push(...result.checks.filter((c) => !c.ok).map((c) => `${result.browser} ${c.what}: ${c.detail}`));
      failures.push(...result.problems.map((p) => `${result.browser}: ${p}`));
    }
    output.browsers = browsers;
  }
} finally {
  await server.close();
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
