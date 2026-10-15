// The data file read by DuckDB-Wasm in production, next to Tycho's R2 path
// for the same rows. Each run opens a fresh Chromium context (cold browser
// cache) on a page at the data's own origin, so the reads are same-origin
// under COEP as a contender's will be:
//
//   observatory  https://seiza.io/observatory/data/asteroids.parquet, a
//                Workers static asset (the file this app's data/ builds)
//   tycho        https://tycho.seiza.io/data/asteroids.parquet, Tycho's
//                Worker over R2 (its own file: more columns, same rows)
//
// The page and the engine are Tycho's local release build (`?bench` exposes
// its bridge), routed in by Playwright for every path but the data file, so
// both sides run the same engine and only the data's path reaches the
// network. Per run: the engine warm (`tycho:parquet-ready`), then
// registerFile (the ranged HEAD and `bytes=0-0` probe), the first page
// (rows 0–1023), and the page at 90%, each with its time and DuckDB's bytes
// read; then, untimed, count(*) and a digest of the first page over the
// columns both files share, which must match across the two sides. Sides
// alternate, observatory first on even runs. The edge's cache state is
// recorded where a response shows it.
//
// Usage: node apps/observatory/perf/data-read.ts [--runs 10] [--label data-read]
//                                               [--resolve-via 1.1.1.1]
// --resolve-via: resolve the two hosts with that DNS server and pin them in
// Chromium (for a local resolver still caching an old NXDOMAIN).
// Needs `just tycho build` (the page and engine) and the observatory's
// data/MANIFEST.json (for the row count).

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { Resolver } from 'node:dns/promises';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser } from '@playwright/test';
import { machineInfo, option, summarize } from '../../../shared-web/perf/protocol.ts';

const perfDir = dirname(fileURLToPath(import.meta.url));
const tychoDist = join(perfDir, '../../tycho/web/dist');
const manifest = JSON.parse(readFileSync(join(perfDir, '../data/MANIFEST.json'), 'utf8')) as Record<string, { rows: number }>;
const ROWS = manifest['asteroids.parquet']!.rows;
const PAGE = 1024;
const runs = Number(option('runs') ?? 10);
const label = option('label') ?? 'data-read';
const resolveVia = option('resolve-via');

interface Side {
  name: 'observatory' | 'tycho';
  origin: string;
  page: string;
  data: string;
}
const SIDES: Side[] = [
  { name: 'observatory', origin: 'https://seiza.io', page: '/observatory/probe/?bench', data: '/observatory/data/asteroids.parquet' },
  { name: 'tycho', origin: 'https://tycho.seiza.io', page: '/?bench', data: '/data/asteroids.parquet' },
];
/** The columns the observatory's file keeps, all in Tycho's too. */
const SHARED = 'spkid, full_name, class, neo, pha, H, diameter, albedo, a, e, first_obs';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.wasm': 'application/wasm',
  '.ttf': 'font/ttf',
  '.json': 'application/json',
};
const ISOLATION = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

const pageSql = (file: string, start: number) =>
  `SELECT * EXCLUDE (file_row_number) FROM read_parquet('${file}', file_row_number = true) ` +
  `WHERE file_row_number >= ${start} AND file_row_number < ${start + PAGE} ORDER BY file_row_number`;

interface Run {
  side: Side['name'];
  run: number;
  engineReadyMs: number;
  registerMs: number;
  firstPageMs: number;
  firstPageBytes: number;
  page90Ms: number;
  page90Bytes: number;
  count: number;
  digest: string;
  edge: string[];
}

async function measure(browser: Browser, side: Side, run: number): Promise<Run> {
  const context = await browser.newContext();
  const network: string[] = [];
  // Everything but the data file comes from Tycho's build; the data goes to
  // the network.
  await context.route(`${side.origin}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === side.data) return route.continue();
    const path = url.pathname === '/' || url.pathname === '/observatory/probe/' ? '/index.html' : url.pathname;
    let body: Buffer;
    try {
      body = readFileSync(join(tychoDist, normalize(path)));
    } catch {
      return route.fulfill({ status: 404, headers: ISOLATION, body: 'not in the routed build' });
    }
    return route.fulfill({ status: 200, headers: { ...ISOLATION, 'Content-Type': TYPES[extname(path)] ?? 'application/octet-stream' }, body });
  });
  context.on('response', (response) => {
    if (new URL(response.url()).pathname !== side.data) return;
    const headers = response.headers();
    network.push(`${response.request().method()} ${headers['content-range'] ?? ''} ${response.status()} cf-cache-status=${headers['cf-cache-status'] ?? '-'} enc=${headers['content-encoding'] ?? '-'}`.replace(/\s+/g, ' '));
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${side.origin}${side.page}`);
  const engineReadyMs = await page
    .waitForFunction(() => performance.getEntriesByName('tycho:parquet-ready').at(-1)?.startTime, undefined, { timeout: 60_000 })
    .then((handle) => handle.jsonValue() as Promise<number>)
    .catch(() => {
      throw new Error(`${side.name}: the engine never got Parquet ready${errors.length ? ` (${errors.join('; ')})` : ''}`);
    });

  const result = await page.evaluate(
    async ({ data, first, page90, shared }) => {
      type Bridge = {
        registerFile(name: string, source: string): Promise<{ bytesRead: BigInt64Array | null }>;
        query(sql: string, id: number): Promise<Uint8Array>;
      };
      const bridge = (globalThis as { __tychoBridge?: Bridge }).__tychoBridge!;
      let id = 5_000_000;
      const text = (bytes: Uint8Array) => /VAL:(.*?):END/s.exec(new TextDecoder('latin1').decode(bytes))?.[1] ?? '';
      const t0 = performance.now();
      const info = await bridge.registerFile('probe.parquet', data);
      const registerMs = performance.now() - t0;
      const read = () => Number(info.bytesRead ? Atomics.load(info.bytesRead, 0) : -1);
      const before = read();
      const t1 = performance.now();
      await bridge.query(first, id++);
      const firstPageMs = performance.now() - t1;
      const afterFirst = read();
      const t2 = performance.now();
      await bridge.query(page90, id++);
      const page90Ms = performance.now() - t2;
      const after90 = read();
      const count = Number(text(await bridge.query("SELECT 'VAL:' || count(*) || ':END' AS v FROM read_parquet('probe.parquet')", id++)));
      const digest = text(
        await bridge.query(
          `SELECT 'VAL:' || md5(string_agg(concat_ws(',', ${shared}), '\n' ORDER BY file_row_number)) || ':END' AS v ` +
            "FROM read_parquet('probe.parquet', file_row_number = true) WHERE file_row_number < 1024",
          id++,
        ),
      );
      return { registerMs, firstPageMs, firstPageBytes: afterFirst - before, page90Ms, page90Bytes: after90 - afterFirst, count, digest };
    },
    {
      data: side.data,
      first: pageSql('probe.parquet', 0),
      page90: pageSql('probe.parquet', Math.floor((ROWS * 0.9) / PAGE) * PAGE),
      shared: SHARED,
    },
  );
  await context.close();
  return { side: side.name, run, engineReadyMs, ...result, edge: network };
}

const args: string[] = [];
if (resolveVia) {
  const resolver = new Resolver();
  resolver.setServers([resolveVia]);
  const rules = await Promise.all(SIDES.map(async (side) => `MAP ${new URL(side.origin).host} ${(await resolver.resolve4(new URL(side.origin).host))[0]}`));
  args.push(`--host-resolver-rules=${rules.join(', ')}`);
}
const browser = await chromium.launch({ args });
const results: Run[] = [];
for (let run = 0; run < runs; run++) {
  const order = run % 2 === 0 ? SIDES : [...SIDES].reverse();
  for (const side of order) {
    const r = await measure(browser, side, run);
    results.push(r);
    console.log(
      `${r.side.padEnd(11)} run ${run}: register ${r.registerMs.toFixed(1)} ms, first page ${r.firstPageMs.toFixed(1)} ms / ${r.firstPageBytes} B, ` +
        `90% page ${r.page90Ms.toFixed(1)} ms / ${r.page90Bytes} B, count ${r.count}, digest ${r.digest.slice(0, 8)}…`,
    );
    if (run === 0) for (const line of r.edge) console.log(`  ${line}`);
  }
}
await browser.close();

const failures: string[] = [];
const digests = new Set(results.map((r) => r.digest));
if (digests.size !== 1 || !results[0]?.digest) failures.push(`first-page digests differ across runs or sides: ${[...digests].join(', ')}`);
for (const r of results) if (r.count !== ROWS) failures.push(`${r.side} run ${r.run}: count(*) ${r.count}, expected ${ROWS}`);

const summary = Object.fromEntries(
  SIDES.map((side) => {
    const mine = results.filter((r) => r.side === side.name);
    return [
      side.name,
      {
        url: `${side.origin}${side.data}`,
        engineReadyMs: summarize(mine.map((r) => r.engineReadyMs)),
        registerMs: summarize(mine.map((r) => r.registerMs)),
        firstPageMs: summarize(mine.map((r) => r.firstPageMs)),
        firstPageBytes: summarize(mine.map((r) => r.firstPageBytes), 0),
        page90Ms: summarize(mine.map((r) => r.page90Ms)),
        page90Bytes: summarize(mine.map((r) => r.page90Bytes), 0),
      },
    ];
  }),
);
const date = new Date().toISOString().slice(0, 10);
const out = join(perfDir, 'results', `${date}-${label}.json`);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(
  out,
  `${JSON.stringify({ date, label, ...machineInfo(), browser: `chromium ${browser.version()}`, runs, url: SIDES.map((s) => s.origin), summary, runsDetail: results, failures }, null, 2)}\n`,
);
console.log(`\n${JSON.stringify(summary, null, 2)}\nwrote ${out}`);
if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('PASS');
