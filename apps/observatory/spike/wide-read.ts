// The wide sheet's candidate files, read a page at a time by DuckDB-Wasm:
// Tycho's release build (`?bench` exposes its bridge) and the candidates
// served from one local origin (port 4341) that counts every request to the
// data and the bytes each one sends. Per file, cold, a fresh context per run:
// the file registered, then three pages (rows 0, 4096, and 90%) with the
// page SQL the tall table sends, each one's time (the bridge's query: the
// engine and the hand-off from its worker), requests, bytes on the wire, and
// Arrow IPC bytes; then the 4096 page again (no network: the engine alone).
// The first run's 4096 page is written beside the file as
// `<file>.page4096.arrow`, for timing each side's decode of it.
//
// `--derived` reads each file through 365 columns computed from three of its
// floats (the asteroid file's H, a, e), the derived candidate.
//
// Usage: node apps/observatory/spike/wide-read.ts --dir <dir> [--rows <n>]
//          [--runs 5] [--derived] [--label wide-read] <file.parquet> …
// Needs `just tycho build`. Writes perf/results/<date>-<label>.json.

import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { chromium } from '@playwright/test';
import { flag, machineInfo, option, summarize } from '../../../shared-web/perf/protocol.ts';
import { assertPortFree } from '../../../shared-web/perf/serve.ts';

const tychoDist = join(import.meta.dirname, '../../tycho/web/dist');
const dir = option('dir');
if (!dir) throw new Error('--dir <dir>: where the candidate files are');
const files = process.argv.slice(2).filter((arg) => arg.endsWith('.parquet'));
const rows = Number(option('rows') ?? 10632);
const runs = Number(option('runs') ?? 5);
const derived = flag('derived');
const label = option('label') ?? 'wide-read';
const PAGE = 1024;
const PORT = 4341;

const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.wasm': 'application/wasm', '.ttf': 'font/ttf', '.json': 'application/json' };
const ISOLATION = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp', 'Cross-Origin-Resource-Policy': 'same-origin' };

interface Request {
  method: string;
  start: number;
  bytes: number;
}
let requests: Request[] = [];
const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://local');
  if (url.pathname.startsWith('/wide/')) {
    const path = join(dir, normalize(url.pathname.slice('/wide/'.length)));
    if (!existsSync(path)) {
      console.error(`no ${path}`);
      res.writeHead(404, ISOLATION);
      return res.end();
    }
    const size = statSync(path).size;
    const headers = { ...ISOLATION, 'Accept-Ranges': 'bytes', 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-cache' };
    const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? '');
    const start = range ? Number(range[1]) : 0;
    const end = range?.[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    // A HEAD sends no body, whatever range it names.
    requests.push({ method: req.method ?? 'GET', start, bytes: req.method === 'HEAD' ? 0 : end - start + 1 });
    res.writeHead(range ? 206 : 200, { ...headers, 'Content-Length': end - start + 1, ...(range ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}) });
    if (req.method === 'HEAD') return res.end();
    // Only the range, streamed: every candidate's request costs the server the same.
    return void createReadStream(path, { start, end }).pipe(res);
  }
  const path = join(tychoDist, normalize(url.pathname === '/' ? '/index.html' : url.pathname));
  if (!existsSync(path) || statSync(path).isDirectory()) {
    res.writeHead(404, ISOLATION);
    return res.end();
  }
  res.writeHead(200, { ...ISOLATION, 'Content-Type': TYPES[extname(path)] ?? 'application/octet-stream' });
  res.end(readFileSync(path));
});
const date = new Date().toISOString().slice(0, 10);
const out = join(import.meta.dirname, '../perf/results', `${date}-${label}.json`);
// perf/results/ is append-only: a second run takes a label of its own.
if (existsSync(out)) throw new Error(`${out} exists: pass another --label`);
await assertPortFree(PORT);
await new Promise<void>((resolve) => server.listen(PORT, '127.0.0.1', resolve));

/** The columns read: the file's own, or 365 derived from three floats. */
const select = derived
  ? `full_name, class, a, ${Array.from({ length: 365 }, (_, k) => `round(a * 10 + e * 20 * sin(H + ${k} / 58.1), 1) AS "d${k}"`).join(', ')}`
  : '* EXCLUDE (file_row_number)';
const pageSql = (start: number) =>
  `SELECT ${select} FROM read_parquet('wide.parquet', file_row_number = true) ` +
  `WHERE file_row_number >= ${start} AND file_row_number < ${start + PAGE} ORDER BY file_row_number`;
const starts = [0, 4 * PAGE, Math.floor((rows * 0.9) / PAGE) * PAGE];

interface PageRead {
  start: number;
  ms: number;
  arrowBytes: number;
  requests: number;
  wireBytes: number;
}
interface Run {
  registerMs: number;
  pages: PageRead[];
  againMs: number;
  againRequests: number;
}
type Bridge = { registerFile(name: string, source: string): Promise<unknown>; query(sql: string, id: number): Promise<Uint8Array> };

const browser = await chromium.launch();
const results: Record<string, { runs: Run[]; summary: Record<string, unknown> }> = {};
for (const file of files) {
  const fileRuns: Run[] = [];
  for (let run = 0; run < runs; run++) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${PORT}/?bench`);
    await page.waitForFunction(() => performance.getEntriesByName('tycho:parquet-ready').at(-1), undefined, { timeout: 60_000 });
    const registerMs = await page.evaluate(async (file) => {
      const t = performance.now();
      await (globalThis as { __tychoBridge?: Bridge }).__tychoBridge!.registerFile('wide.parquet', `/wide/${file}`);
      return performance.now() - t;
    }, file);
    const pages: PageRead[] = [];
    let id = 7_000_000;
    for (const start of starts) {
      requests = [];
      const read = await page.evaluate(
        async ({ sql, id, keep }) => {
          const t = performance.now();
          const bytes = await (globalThis as { __tychoBridge?: Bridge }).__tychoBridge!.query(sql, id);
          return { ms: performance.now() - t, arrowBytes: bytes.byteLength, ipc: keep ? Array.from(bytes) : null };
        },
        { sql: pageSql(start), id: id++, keep: run === 0 && start === 4 * PAGE },
      );
      if (read.ipc) writeFileSync(join(dir, `${file}.page4096.arrow`), Buffer.from(read.ipc));
      pages.push({ start, ms: read.ms, arrowBytes: read.arrowBytes, requests: requests.length, wireBytes: requests.reduce((sum, r) => sum + r.bytes, 0) });
    }
    requests = [];
    const againMs = await page.evaluate(
      async ({ sql, id }) => {
        const t = performance.now();
        await (globalThis as { __tychoBridge?: Bridge }).__tychoBridge!.query(sql, id);
        return performance.now() - t;
      },
      { sql: pageSql(4 * PAGE), id: id++ },
    );
    fileRuns.push({ registerMs, pages, againMs, againRequests: requests.length });
    await context.close();
  }
  const summary = {
    registerMs: summarize(fileRuns.map((r) => r.registerMs)),
    pages: starts.map((start, i) => ({
      start,
      ms: summarize(fileRuns.map((r) => r.pages[i]!.ms)),
      requests: fileRuns[0]!.pages[i]!.requests,
      wireBytes: fileRuns[0]!.pages[i]!.wireBytes,
      arrowBytes: fileRuns[0]!.pages[i]!.arrowBytes,
    })),
    againMs: summarize(fileRuns.map((r) => r.againMs)),
  };
  results[file] = { runs: fileRuns, summary };
  console.log(`${file}${derived ? ' (derived)' : ''}: register ${JSON.stringify(summary.registerMs)}, the 4096 page again ${JSON.stringify(summary.againMs)}`);
  for (const p of summary.pages) console.log(`  rows ${p.start}+: ${JSON.stringify(p.ms)} ms, ${p.requests} requests, ${p.wireBytes} B on the wire, ${p.arrowBytes} B of Arrow`);
}
await browser.close();
server.close();

mkdirSync(join(out, '..'), { recursive: true });
writeFileSync(out, `${JSON.stringify({ date, label, ...machineInfo(), browser: `chromium ${browser.version()}`, runs, rows, derived, files: results }, null, 2)}\n`);
console.log(`wrote ${out}`);
