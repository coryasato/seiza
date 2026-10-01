// M6 ingest experiment: how the table should read a dropped CSV.
//
//   raw      register the whole file and page it with read_csv(...) LIMIT/OFFSET
//            (and count(*) for the row count): nothing ingested
//   whole    one CREATE TABLE AS over the whole file, then page by rowid
//   chunks   the file cut at record boundaries into chunks of --chunk MiB, each
//            registered as its own File (a slice: no copy) and appended with
//            INSERT … read_csv(chunk); page by rowid. Per chunk: its time (the
//            row count can update only between chunks), and a page read sent
//            while it runs (DuckDB-Wasm round-robins query slices)
//
// All through the `?bench` bridge on the release build, engine warm, in
// Chromium, the file set by path on an <input type=file> (read from disk, like
// a drop). The CSV options are the ones the app uses: RFC 4180 quoting set
// explicitly (DuckDB's sniffer reads only the file's head, sees no quotes, and
// picks none), and column types from the head, with `pdes` as VARCHAR (it
// sniffs as BIGINT; later rows hold "2026 SQ12"). Record boundaries are found
// here in JS with a quote-parity scan (the app does it in Rust). Every
// approach must count the file's rows (MANIFEST.json).
//
// Options that isolate where the time goes (M6 used each):
//   --no-auto-detect  read_csv with every option fixed (auto_detect = false):
//                     the app's setting; without it each chunk is sniffed again
//   --compress        chunks into ATTACH ':memory:' (COMPRESS)
//   --row-group N     with --compress, that database's ROW_GROUP_SIZE
//   --separate        each chunk its own table (CREATE TABLE AS): the app's
//                     layout; without it chunks are appended to one table
//   --no-during       no page read while each chunk runs
//   --parse-only      parse every column of each chunk, store nothing
//   --pregrow         grow DuckDB's heap first (a table made and dropped)
//   --max-chunks N    stop after N chunks;  --trace  a Chromium trace per run
//                     into perf/results/raw/
//
// Usage: node apps/tycho/perf/ingest.ts [--file drop/asteroids-x6.csv] [--chunks 4,8,16,32]
//                                       [--approaches raw,whole,chunks] [--label m6-ingest] [options]
// Needs `just tycho drop-files` and `just tycho build`.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from '@playwright/test';
import { preview } from 'vite';
import { assertPortFree } from '../worker/scripts/dev.ts';
import { machineInfo, option } from './common.ts';
import { open, waitOverlay } from './harness.ts';

const perfDir = dirname(fileURLToPath(import.meta.url));
const webDir = join(perfDir, '../web');
const dataDir = join(perfDir, '../data');
const manifest = JSON.parse(readFileSync(join(dataDir, 'MANIFEST.json'), 'utf8')) as Record<string, { rows: number; bytes: number }>;

const fileName = option('file') ?? 'drop/asteroids-x6.csv';
const chunkSizes = (option('chunks') ?? '4,8,16,32').split(',').map(Number);
const approaches = (option('approaches') ?? 'raw,whole,chunks').split(',');
const label = option('label') ?? 'm6-ingest';
/** Chunks go into `ATTACH ':memory:' (COMPRESS)`, DuckDB's compressed in-memory database. */
const compress = process.argv.includes('--compress');
/** Send a page read while each chunk runs (off: `--no-during`). */
const during = !process.argv.includes('--no-during');
/** Stop after this many chunks (a partial run, for tracing). */
const maxChunks = Number(option('max-chunks') ?? Infinity);
/** Write a Chromium trace of each run to perf/results/raw/. */
const trace = process.argv.includes('--trace');
/** Grow DuckDB's heap first (a table made and dropped), to test whether growth is what's slow. */
const pregrow = process.argv.includes('--pregrow');
/** Parse each chunk (every column) without storing it. */
const parseOnly = process.argv.includes('--parse-only');
/** With --compress: the attached database's row-group size (DuckDB's default is 122,880). */
const rowGroup = option('row-group');
/** Each chunk into its own table (CREATE TABLE AS), not appended to one. */
const separate = process.argv.includes('--separate');
const entry = manifest[fileName];
if (!entry) throw new Error(`${fileName} isn't in MANIFEST.json: run \`just tycho drop-files\``);
const expectedRows = entry.rows;
const PAGE = 1024;

const COLUMNS =
  "{'spkid': 'BIGINT', 'full_name': 'VARCHAR', 'pdes': 'VARCHAR', 'name': 'VARCHAR', 'neo': 'BOOLEAN', 'pha': 'BOOLEAN', " +
  "'class': 'VARCHAR', 'H': 'DOUBLE', 'diameter': 'DOUBLE', 'albedo': 'DOUBLE', 'a': 'DOUBLE', 'e': 'DOUBLE', 'i': 'DOUBLE', " +
  "'q': 'DOUBLE', 'per_y': 'DOUBLE', 'first_obs': 'DATE', 'last_obs': 'DATE', 'n_obs_used': 'BIGINT'}";
const OPTIONS = `delim = ',', quote = '"', escape = '"', columns = ${COLUMNS}${process.argv.includes('--no-auto-detect') ? ", auto_detect = false, new_line = '\\n'" : ''}`;

type Global = {
  __tychoBridge?: { registerFile(name: string, source: File | string): Promise<unknown>; query(sql: string, id: number): Promise<Uint8Array> };
  __ingestInput?: HTMLInputElement;
  __ingest?: Record<string, unknown>;
};

async function setFile(page: Page): Promise<void> {
  await page.evaluate(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.hidden = true;
    document.body.append(input);
    (globalThis as Global).__ingestInput = input;
  });
  const input = await page.evaluateHandle(() => (globalThis as Global).__ingestInput!);
  await input.asElement()!.setInputFiles(join(dataDir, fileName));
}

/** Installs the in-page helpers: timed queries, a count reader, a boundary scanner. */
async function installHelpers(page: Page): Promise<void> {
  await page.evaluate(() => {
    const g = globalThis as Global;
    let id = 1_000_000;
    const bridge = g.__tychoBridge!;
    const timed = async (sql: string) => {
      const start = performance.now();
      const bytes = await bridge.query(sql, id++);
      return { ms: performance.now() - start, bytes };
    };
    // The one BIGINT a `count(*)` answers with, read from the end of the IPC
    // stream (the app decodes Arrow properly). Where it sits depends on
    // whether the stream has an end marker, so it's calibrated below.
    let tail = 8;
    const lastInt = (bytes: Uint8Array) => Number(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getBigInt64(bytes.byteLength - tail, true));
    const calibrate = async () => {
      const { bytes } = await timed('SELECT 1234567::BIGINT');
      for (tail = 8; tail <= 64; tail += 8) if (lastInt(bytes) === 1234567) return;
      throw new Error('count reader: 1234567 not found');
    };
    /** The end of the last whole record at or before `target`, scanning from
     *  `start` (a record boundary) with RFC 4180 quote parity. */
    const boundary = async (file: File, start: number, target: number) => {
      if (target >= file.size) return file.size;
      const bytes = new Uint8Array(await file.slice(start, target).arrayBuffer());
      let quoted = false;
      let last = -1;
      for (let i = 0; i < bytes.length; i++) {
        const b = bytes[i]!;
        if (b === 0x22) quoted = !quoted;
        else if (b === 0x0a && !quoted) last = i;
      }
      if (last < 0) throw new Error('no record boundary in chunk');
      return start + last + 1;
    };
    g.__ingest = { timed, lastInt, boundary };
    return calibrate();
  });
}

async function run(page: Page, approach: string, chunkMiB: number): Promise<Record<string, unknown>> {
  return page.evaluate(
    async ({ approach, chunkMiB, OPTIONS, PAGE, expectedRows, compress, during, maxChunks, pregrow, parseOnly, rowGroup, separate }) => {
      const g = globalThis as Global;
      const { timed, lastInt, boundary } = g.__ingest as {
        timed: (sql: string) => Promise<{ ms: number; bytes: Uint8Array }>;
        lastInt: (bytes: Uint8Array) => number;
        boundary: (file: File, start: number, target: number) => Promise<number>;
      };
      const bridge = g.__tychoBridge!;
      const file = g.__ingestInput!.files![0]!;
      const memory = async () => {
        const m = await (performance as unknown as { measureUserAgentSpecificMemory?: () => Promise<{ bytes: number }> }).measureUserAgentSpecificMemory?.();
        return m ? m.bytes / 2 ** 20 : null;
      };
      const at90 = Math.floor(expectedRows * 0.9);
      const out: Record<string, unknown> = { approach };
      const t0 = performance.now();

      if (approach === 'raw') {
        await bridge.registerFile('raw.csv', file);
        out.firstPageMs = (await timed(`SELECT * FROM read_csv('raw.csv', header = true, ${OPTIONS}) LIMIT ${PAGE}`)).ms;
        out.page90Ms = (await timed(`SELECT * FROM read_csv('raw.csv', header = true, ${OPTIONS}) LIMIT ${PAGE} OFFSET ${at90}`)).ms;
        const count = await timed(`SELECT count(*) FROM read_csv('raw.csv', header = true, ${OPTIONS})`);
        out.countMs = count.ms;
        out.rows = lastInt(count.bytes);
        out.memoryMiB = await memory();
        return out;
      }

      if (approach === 'whole') {
        await bridge.registerFile('whole.csv', file);
        const create = await timed(`CREATE TABLE whole AS SELECT * FROM read_csv('whole.csv', header = true, ${OPTIONS})`);
        out.ingestMs = create.ms;
        out.mbPerS = file.size / 1e6 / (create.ms / 1000);
        out.rows = lastInt((await timed('SELECT count(*) FROM whole')).bytes);
        out.page90Ms = (await timed(`SELECT * FROM whole WHERE rowid >= ${at90} AND rowid < ${at90 + PAGE} ORDER BY rowid`)).ms;
        out.memoryMiB = await memory();
        await timed('DROP TABLE whole');
        out.memoryAfterDropMiB = await memory();
        return out;
      }

      // Chunks.
      if (pregrow) {
        await timed('CREATE TABLE pregrow AS SELECT range AS a, range AS b FROM range(40000000)');
        await timed('DROP TABLE pregrow');
      }
      if (compress) await timed(`ATTACH ':memory:' AS packed (COMPRESS${rowGroup ? `, ROW_GROUP_SIZE ${rowGroup}` : ''})`);
      const table = `${compress ? 'packed.' : ''}chunks_${chunkMiB}`;
      const target = chunkMiB * 2 ** 20;
      const chunkTimes: number[] = [];
      const scanTimes: number[] = [];
      const duringPage: number[] = [];
      const updateGaps: number[] = [];
      const registerTimes: number[] = [];
      const countTimes: number[] = [];
      const rowSeries: number[] = [];
      let start = 0;
      let index = 0;
      let rows = 0;
      let lastUpdate = t0;
      let firstRowsMs: number | null = null;
      while (start < file.size && index < maxChunks) {
        const scanStart = performance.now();
        const end = await boundary(file, start, start + target);
        scanTimes.push(performance.now() - scanStart);
        const name = `chunk_${chunkMiB}_${index}.csv`;
        const registerStart = performance.now();
        await bridge.registerFile(name, new File([file.slice(start, end)], name));
        registerTimes.push(performance.now() - registerStart);
        const header = index === 0;
        const read = `read_csv('${name}', header = ${header}, ${OPTIONS})`;
        const sql = parseOnly
          ? `SELECT count(*), max(spkid), max(full_name), max(pdes), max(name), bool_or(neo), bool_or(pha), max(class), max(H), max(diameter), max(albedo), max(a), max(e), max(i), max(q), max(per_y), max(first_obs), max(last_obs), max(n_obs_used) FROM ${read}`
          : separate ? `CREATE TABLE ${table}_${index} AS SELECT * FROM ${read}`
          : index === 0 ? `CREATE TABLE ${table} AS SELECT * FROM ${read}` : `INSERT INTO ${table} SELECT * FROM ${read}`;
        const chunkStart = performance.now();
        const insert = timed(sql);
        // A page read in the middle of what's ingested, sent while the chunk runs.
        const pageDuring = during && rows > PAGE && !separate ? timed(`SELECT * FROM ${table} WHERE rowid >= ${Math.floor(rows / 2)} AND rowid < ${Math.floor(rows / 2) + PAGE} ORDER BY rowid`) : null;
        await insert;
        chunkTimes.push(performance.now() - chunkStart);
        if (pageDuring) duringPage.push((await pageDuring).ms);
        const count = parseOnly ? await timed('SELECT 0::BIGINT') : separate ? await timed(`SELECT (${rows} + (SELECT count(*) FROM ${table}_${index}))::BIGINT`) : await timed(`SELECT count(*) FROM ${table}`);
        countTimes.push(count.ms);
        rows = lastInt(count.bytes);
        rowSeries.push(rows);
        const now = performance.now();
        updateGaps.push(now - lastUpdate);
        lastUpdate = now;
        if (firstRowsMs === null && !parseOnly) {
          await timed(`SELECT * FROM ${table}${separate ? '_0' : ''} WHERE rowid < ${PAGE} ORDER BY rowid`);
          firstRowsMs = performance.now() - t0;
        }
        start = end;
        index++;
      }
      const total = performance.now() - t0;
      const sorted = (values: number[]) => [...values].sort((a, b) => a - b);
      const pct = (values: number[], p: number) => sorted(values)[Math.min(values.length - 1, Math.floor(values.length * p))] ?? null;
      if (separate) return { ...out, chunkMiB, separate, compress, rows, chunkMs: { p50: pct(chunkTimes, 0.5), p95: pct(chunkTimes, 0.95), max: Math.max(...chunkTimes) }, chunkSeries: chunkTimes.map(Math.round), ingestMs: total, mbPerS: file.size / 1e6 / (total / 1000), memoryMiB: await memory(), duckdbMiB: lastInt((await timed('SELECT sum(memory_usage_bytes)::BIGINT FROM duckdb_memory()')).bytes) / 2 ** 20 };
      if (parseOnly) return { ...out, chunkMiB, parseOnly, chunkSeries: chunkTimes.map(Math.round), ingestMs: total, rows: expectedRows };
      Object.assign(out, {
        chunkMiB,
        chunks: index,
        rows,
        firstRowsMs,
        ingestMs: total,
        mbPerS: file.size / 1e6 / (total / 1000),
        compress,
        chunkSeries: chunkTimes.map(Math.round),
        rowSeries,
        registerMs: { p50: pct(registerTimes, 0.5), max: Math.max(...registerTimes) },
        countMs: { p50: pct(countTimes, 0.5), max: Math.max(...countTimes) },
        chunkMs: { p50: pct(chunkTimes, 0.5), p95: pct(chunkTimes, 0.95), max: Math.max(...chunkTimes) },
        updateGapMs: { p50: pct(updateGaps, 0.5), p95: pct(updateGaps, 0.95), max: Math.max(...updateGaps) },
        scanMs: { p50: pct(scanTimes, 0.5), max: Math.max(...scanTimes), total: scanTimes.reduce((a, b) => a + b, 0) },
        pageDuringMs: { p50: pct(duringPage, 0.5), p95: pct(duringPage, 0.95), max: duringPage.length ? Math.max(...duringPage) : null },
        page90Ms: (await timed(`SELECT * FROM ${table} WHERE rowid >= ${Math.floor(rows * 0.9)} AND rowid < ${Math.floor(rows * 0.9) + PAGE} ORDER BY rowid`)).ms,
        memoryMiB: await memory(),
        duckdbMiB: lastInt((await timed('SELECT sum(memory_usage_bytes)::BIGINT FROM duckdb_memory()')).bytes) / 2 ** 20,
      });
      await timed(`DROP TABLE ${table}`);
      out.memoryAfterDropMiB = await memory();
      return out;
    },
    { approach, chunkMiB, OPTIONS, PAGE, expectedRows, compress, during, maxChunks, pregrow, parseOnly, rowGroup, separate },
  );
}

const port = 4175;
await assertPortFree(port);
const server = await preview({ root: webDir, preview: { port, strictPort: true }, logLevel: 'warn' });
const results: Record<string, unknown>[] = [];
try {
  const plan: [string, number][] = [];
  for (const approach of approaches) {
    if (approach === 'chunks') for (const size of chunkSizes) plan.push([approach, size]);
    else plan.push([approach, 0]);
  }
  for (const [approach, size] of plan) {
    // A new browser each, so one approach's memory doesn't carry into the next.
    const browsing = await open(chromium, `http://localhost:${port}/`, { params: { bench: '' } });
    try {
      await waitOverlay(browsing.page, 'Engine ready', /ms$/, 60_000);
      await setFile(browsing.page);
      await installHelpers(browsing.page);
      const tracePath = join(perfDir, 'results/raw', `${label}-${approach}-${size}.trace.json`);
      if (trace) await browsing.page.context().browser()!.startTracing(browsing.page, { path: tracePath, categories: ['v8', 'devtools.timeline', 'disabled-by-default-v8.gc', 'disabled-by-default-devtools.timeline'] });
      const result = await run(browsing.page, approach, size);
      if (trace) await browsing.page.context().browser()!.stopTracing();
      result.ok = result.rows === expectedRows;
      console.log(JSON.stringify(result));
      results.push(result);
    } catch (error) {
      const message = error instanceof Error ? error.message.split('\n')[0] : String(error);
      console.log(`${approach} ${size}: failed: ${message}`);
      results.push({ approach, chunkMiB: size, failed: message });
    } finally {
      await browsing.close();
    }
  }
} finally {
  await server.close();
}

const date = new Date().toISOString().slice(0, 10);
const out = join(perfDir, 'results', `${date}-${label}.json`);
writeFileSync(out, `${JSON.stringify({ date, ...machineInfo(), file: fileName, bytes: manifest[fileName]!.bytes, expectedRows, pageRows: PAGE, results }, null, 2)}\n`);
console.log(`wrote ${out}`);
