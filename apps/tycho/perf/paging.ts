// M4 paging experiment: how the table should fetch a page of rows from a
// Parquet file over HTTP, and what row-group size the samples should use.
//
// For each file (the asteroid sample rewritten at several row-group sizes,
// loaded into local R2 under bench/) and each strategy:
//   A  LIMIT/OFFSET on the raw Parquet
//   B  a filter on file_row_number (read_parquet(..., file_row_number = true)),
//      which DuckDB can match against row-group ranges
//   C  ingest into a DuckDB table first (CREATE TABLE AS), then filter on rowid
// it measures, with the engine warm and the footer already read (as after the
// header strip): the first page, the page after it, then a jump to the page
// holding row 90%,
// each as round-trip time in the page and /data/ bytes counted at the server.
// C also records its ingest. Each (file, strategy) runs in a new browser.
// Every page is checked (count, first and last spkid) and the strategies
// must agree.
//
// Usage: node apps/tycho/perf/paging.ts [--runs 5] [--page 1024] [--label m4-paging]
//                                       [--files 122880,16384] [--strategies A,B,C]
//                                       [--setup "SET GLOBAL …"]
// Needs the bench/ variants in local R2 (how to build them: perf/results/2026-09-25-m4.md, "Reproducing it")
// and a release build (`just tycho build`).

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from '@playwright/test';
import { preview } from 'vite';
import { assertPortFree, startWorkerDev, WORKER_DEV_PORT } from '../worker/scripts/dev.ts';
import { machineInfo, option, summarize } from './common.ts';
import { open, settled, startCountingProxy, waitOverlay, type CountingProxy } from './harness.ts';

const perfDir = dirname(fileURLToPath(import.meta.url));
const webDir = join(perfDir, '../web');

const runs = Number(option('runs') ?? 5);
const pageRows = Number(option('page') ?? 1024);
const label = option('label') ?? 'm4-paging';
const files = (option('files') ?? '122880,30720,16384,8192').split(',').map(Number);
const strategies = (option('strategies') ?? 'A,B,C').split(',') as Strategy[];
/** SQL run once per browser before the file is registered, e.g. a DuckDB setting. */
const setup = option('setup');

type Strategy = 'A' | 'B' | 'C';
const NAME = 'bench.parquet';
const TABLE = 'bench_rows';

function pageSql(strategy: Strategy, offset: number): string {
  switch (strategy) {
    case 'A':
      return `SELECT * FROM read_parquet('${NAME}') LIMIT ${pageRows} OFFSET ${offset}`;
    case 'B':
      return (
        `SELECT * EXCLUDE (file_row_number) FROM read_parquet('${NAME}', file_row_number = true) ` +
        `WHERE file_row_number >= ${offset} AND file_row_number < ${offset + pageRows} ORDER BY file_row_number`
      );
    case 'C':
      return `SELECT * FROM ${TABLE} WHERE rowid >= ${offset} AND rowid < ${offset + pageRows} ORDER BY rowid`;
  }
}

/** Wraps a page query so its answer is a marker string findable in the raw
 *  IPC bytes: row count, first and last spkid. */
const checkSql = (sql: string) =>
  `SELECT 'CHECK:' || count(*) || ':' || coalesce(first(spkid)::VARCHAR, '-') || ':' || coalesce(last(spkid)::VARCHAR, '-') || ':END' AS c FROM (${sql})`;

interface Timed {
  ms: number;
  bytes: number;
  requests: number;
}

/** Runs `sql` through the app's own bridge (`?bench`); times it in the page
 *  and counts the /data/ bytes of every request that started meanwhile. */
async function timed(page: Page, proxy: CountingProxy, sql: string): Promise<Timed & { resultBytes: number }> {
  const from = Date.now();
  const { ms, resultBytes } = await page.evaluate(async (sql) => {
    const bridge = (globalThis as { __tychoBridge?: { query(sql: string, id: number): Promise<Uint8Array> } }).__tychoBridge!;
    const started = performance.now();
    const bytes = await bridge.query(sql, 1_000_000 + Math.floor(Math.random() * 1_000_000));
    return { ms: performance.now() - started, resultBytes: bytes.length };
  }, sql);
  const to = Date.now();
  const requests = proxy.log.filter((entry) => entry.startedAt >= from && entry.startedAt <= to);
  await settled(requests);
  return { ms, bytes: requests.reduce((sum, entry) => sum + entry.bytes, 0), requests: requests.length, resultBytes };
}

async function check(page: Page, sql: string): Promise<string> {
  return page.evaluate(async (sql) => {
    const bridge = (globalThis as { __tychoBridge?: { query(sql: string, id: number): Promise<Uint8Array> } }).__tychoBridge!;
    const bytes = await bridge.query(sql, 2_000_000 + Math.floor(Math.random() * 1_000_000));
    return /CHECK:[^:]*:[^:]*:[^:]*:END/.exec(new TextDecoder('latin1').decode(bytes))?.[0] ?? 'no marker';
  }, checkSql(sql));
}

interface Run {
  ingest: Timed | null;
  first: Timed;
  /** The page after the first: served from what the first read brought in? */
  next: Timed;
  jump: Timed;
  firstCheck: string;
  jumpCheck: string;
}

async function measure(url: string, proxy: CountingProxy, rowGroup: number, strategy: Strategy, rows: number): Promise<Run> {
  const run = await open(chromium, url, { params: { bench: '' } });
  try {
    const { page } = run;
    await waitOverlay(page, 'Parquet ready', /ms$/, 180_000);
    if (setup) await timed(page, proxy, setup);
    await page.evaluate(
      async ({ name, url }) => {
        const bridge = (globalThis as { __tychoBridge?: { registerFile(name: string, source: string): Promise<unknown> } }).__tychoBridge!;
        await bridge.registerFile(name, url);
      },
      { name: NAME, url: `/data/bench/asteroids-rg${rowGroup}.parquet` },
    );
    // What the header strip reads first; not counted.
    await timed(page, proxy, `SELECT num_rows FROM parquet_file_metadata('${NAME}')`);
    const ingest = strategy === 'C' ? await timed(page, proxy, `CREATE TABLE ${TABLE} AS SELECT * FROM read_parquet('${NAME}')`) : null;
    const jumpOffset = Math.floor((rows * 0.9) / pageRows) * pageRows;
    const first = await timed(page, proxy, pageSql(strategy, 0));
    const next = await timed(page, proxy, pageSql(strategy, pageRows));
    const jump = await timed(page, proxy, pageSql(strategy, jumpOffset));
    const firstCheck = await check(page, pageSql(strategy, 0));
    const jumpCheck = await check(page, pageSql(strategy, jumpOffset));
    if (run.problems.length) throw new Error(run.problems.join('; '));
    return { ingest, first, next, jump, firstCheck, jumpCheck };
  } finally {
    await run.close();
  }
}

const WORKER_PORT = 8791;
await assertPortFree(WORKER_DEV_PORT);
const worker = await startWorkerDev({ port: WORKER_PORT, requireObject: `bench/asteroids-rg${files[0]}.parquet` });
const proxy = await startCountingProxy(WORKER_DEV_PORT, WORKER_PORT);
const server = await preview({ root: webDir, preview: { port: 4177, strictPort: true }, logLevel: 'warn' });
const url = 'http://localhost:4177/';
const ROWS = 1_567_523;

const results: Record<string, Record<string, unknown>> = {};
const failures: string[] = [];
try {
  for (const rowGroup of files) {
    results[rowGroup] = {};
    const checks: Record<string, string> = {};
    for (const strategy of strategies) {
      const list: Run[] = [];
      for (let index = 0; index < runs; index++) {
        const run = await measure(url, proxy, rowGroup, strategy, ROWS);
        list.push(run);
        console.log(
          `rg ${String(rowGroup).padStart(6)} ${strategy}: ` +
            (run.ingest ? `ingest ${run.ingest.ms.toFixed(0)} ms ${run.ingest.bytes} B; ` : '') +
            `first ${run.first.ms.toFixed(1)} ms ${run.first.bytes} B (${run.first.requests} req); ` +
            `next ${run.next.ms.toFixed(1)} ms ${run.next.bytes} B; ` +
            `jump 90% ${run.jump.ms.toFixed(1)} ms ${run.jump.bytes} B (${run.jump.requests} req)  ${run.firstCheck} ${run.jumpCheck}`,
        );
        for (const [which, marker] of [['first', run.firstCheck], ['jump', run.jumpCheck]] as const) {
          const previous = checks[which];
          if (!marker.startsWith(`CHECK:${pageRows}:`)) failures.push(`rg ${rowGroup} ${strategy} ${which}: ${marker}`);
          else if (previous && previous !== marker) failures.push(`rg ${rowGroup} ${strategy} ${which}: ${marker}, other strategies ${previous}`);
          checks[which] = marker;
        }
      }
      const pick = (get: (run: Run) => Timed | null) => {
        const values = list.map(get).filter((value): value is Timed => value !== null);
        return values.length ? { ms: summarize(values.map((value) => value.ms)), bytes: summarize(values.map((value) => value.bytes), 0) } : null;
      };
      results[rowGroup]![strategy] = { runs: list.length, ingest: pick((run) => run.ingest), first: pick((run) => run.first), next: pick((run) => run.next), jump: pick((run) => run.jump) };
    }
  }
} finally {
  await server.close();
  proxy.close();
  await worker.close();
}

const date = new Date().toISOString().slice(0, 10);
const out = join(perfDir, 'results', `${date}-${label}.json`);
writeFileSync(out, `${JSON.stringify({ date, label, ...machineInfo(), pageRows, rows: ROWS, setup: setup ?? null, results }, null, 2)}\n`);
console.log(`wrote ${out}`);
if (failures.length) {
  console.error(`\nFAIL\n${failures.map((failure) => `  ${failure}`).join('\n')}`);
  process.exit(1);
}
