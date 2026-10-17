// The engine both contenders load, from their release builds, and the
// first-paint rule on the TanStack contender's JS (contenders/engine.ts).
//
// Checks:
// - Byte-identical: each build's duckdb/ (DuckDB-Wasm's worker scripts and
//   wasm, put there by `contenderBuild`; the pinned extensions) holds the
//   same files, each with the same SHA-256.
// - Served from /observatory/duckdb/: each build in Chromium opens the data
//   file (the GPUI contender to its first filled frame; the TanStack one to
//   its first row, the count from data/MANIFEST.json and row 0's H from the
//   cell fixture), and every DuckDB file either requests is under
//   /observatory/duckdb/. The TanStack contender requests no JS but its
//   entry chunk before its first paint (Arrow and the data layer load after
//   it, with the engine).
// - Recorded, not checked: whether the engine's JS chunk is the same file
//   in both builds, and the sizes of the chunks it and the TanStack
//   contender's data layer load.
// - --controls: the duckdb/ comparison fails a tree with one byte changed
//   and a tree with a file missing; the TanStack contender built with Arrow
//   imported by its entry fails (`contenderBuild`'s first-paint rule), and
//   the same build without the import passes.
//
// Usage: node apps/observatory/perf/engine-files.ts [--controls] [--label <name>]
// --label writes perf/results/<date>-<label>.json. Run `just observatory
// gpui-build` and `just observatory tanstack-build` first; needs `just
// observatory data`.

import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { chromium } from '@playwright/test';
import { build } from 'vite';
import { brotli } from '../../../shared-web/src/brotli.ts';
import { flag, machineInfo, option } from '../../../shared-web/perf/protocol.ts';
import { FIRST_PAINT_ERROR } from '../contenders/engine.ts';
import { MARKS, gpuiWebDir, perfDir, problems, protocolContext, serveGpui, serveTanstack, tanstackWebDir } from './harness.ts';

const PORT = 4315;
const GPUI_PORT = 4316;
const label = option('label');
const failures: string[] = [];
const output: Record<string, unknown> = { date: new Date().toISOString().slice(0, 10), label, ...machineInfo() };
const check = (ok: boolean, problem: string) => {
  if (!ok) failures.push(problem);
  return ok;
};

for (const dir of [gpuiWebDir, tanstackWebDir]) {
  if (!existsSync(join(dir, 'dist/duckdb'))) throw new Error(`no build in ${relative(perfDir, dir)}: run \`just observatory gpui-build\` and \`tanstack-build\` first`);
}

// --- byte-identical ---

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]));
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

/** Each file under `dir`, by its path there, with its SHA-256 and bytes. */
function tree(dir: string): Map<string, { sha256: string; bytes: number }> {
  return new Map(
    walk(dir).map((file) => {
      const bytes = readFileSync(file);
      return [relative(dir, file), { sha256: sha256(bytes), bytes: bytes.byteLength }];
    }),
  );
}

/** How two trees differ: files only in one, and files whose bytes differ. */
function differences(a: Map<string, { sha256: string }>, b: Map<string, { sha256: string }>): string[] {
  const found: string[] = [];
  for (const [path, file] of a) {
    const other = b.get(path);
    if (!other) found.push(`${path}: only in the GPUI build`);
    else if (other.sha256 !== file.sha256) found.push(`${path}: different bytes`);
  }
  for (const path of b.keys()) if (!a.has(path)) found.push(`${path}: only in the TanStack build`);
  return found;
}

const gpuiEngine = tree(join(gpuiWebDir, 'dist/duckdb'));
const tanstackEngine = tree(join(tanstackWebDir, 'dist/duckdb'));
const engineDiff = differences(gpuiEngine, tanstackEngine);
check(engineDiff.length === 0, `the contenders' duckdb/ differ: ${engineDiff.join('; ')}`);
// Every engine file is there: both bundles' worker and wasm, and Parquet.
for (const kind of [/^duckdb-browser-eh\.worker-.+\.js$/, /^duckdb-browser-mvp\.worker-.+\.js$/, /^duckdb-eh-.+\.wasm$/, /^duckdb-mvp-.+\.wasm$/, /\/wasm_eh\/parquet\.duckdb_extension\.wasm$/, /\/wasm_mvp\/parquet\.duckdb_extension\.wasm$/]) {
  check([...gpuiEngine.keys()].some((path) => kind.test(path)), `no engine file matching ${kind} in duckdb/`);
}
output.engineFiles = Object.fromEntries([...gpuiEngine].sort(([a], [b]) => a.localeCompare(b)));
console.log(`duckdb/: ${gpuiEngine.size} files, ${engineDiff.length ? 'DIFFERENT' : 'byte-identical in both builds'}`);

// --- the engine's JS chunk: shared or not (recorded) ---

/** A build's JS chunk named `prefix-<hash>.js`, and the chunks it imports. */
function chunk(webDir: string, prefix: string) {
  const assets = join(webDir, 'dist/assets');
  const name = readdirSync(assets).find((file) => file.startsWith(`${prefix}-`) && file.endsWith('.js'));
  if (!name) throw new Error(`no ${prefix} chunk in ${relative(perfDir, assets)}`);
  const bytes = readFileSync(join(assets, name));
  const imports = [...new Set([...bytes.toString('utf8').matchAll(/from\s*"\.\/([\w.-]+\.js)"/g)].map((match) => match[1]!))];
  return { name, sha256: sha256(bytes), bytes: bytes.byteLength, brotliBytes: brotli(bytes).byteLength, imports };
}
const sizes = (webDir: string, names: string[]) =>
  Object.fromEntries(names.map((name) => [name, brotli(readFileSync(join(webDir, 'dist/assets', name))).byteLength]));
const gpuiChunk = chunk(gpuiWebDir, 'engine');
const tanstackChunk = chunk(tanstackWebDir, 'engine');
const tableChunk = chunk(tanstackWebDir, 'table');
output.engineChunk = {
  shared: gpuiChunk.sha256 === tanstackChunk.sha256,
  gpui: gpuiChunk,
  tanstack: { ...tanstackChunk, importsBrotliBytes: sizes(tanstackWebDir, tanstackChunk.imports) },
  tanstackDataLayer: { ...tableChunk, importsBrotliBytes: sizes(tanstackWebDir, tableChunk.imports) },
};
const kib = (bytes: number) => `${(bytes / 1024).toFixed(1)} KiB`;
console.log(
  `engine chunk: ${gpuiChunk.sha256 === tanstackChunk.sha256 ? 'shared' : 'not shared'}; GPUI ${gpuiChunk.name} ${kib(gpuiChunk.brotliBytes)} br, ` +
    `TanStack ${tanstackChunk.name} ${kib(tanstackChunk.brotliBytes)} br + ${tanstackChunk.imports.join(', ') || 'nothing'}`,
);

// --- served from /observatory/duckdb/, nothing before first paint ---

const cells = JSON.parse(readFileSync(new URL('../../../components/tall-table/fixtures/cells.json', import.meta.url), 'utf8'));
const rowZeroH = cells.cells.find((cell: { column: string; row: number }) => cell.column === 'H' && cell.row === 0).shown as string;
/** The engine files a page requested, by path. */
const engineFiles = (requested: string[]) => requested.map((url) => new URL(url).pathname).filter((path) => /duckdb-|duckdb_extension/.test(path));
const checkEngineFiles = (side: string, paths: string[]) => {
  check(paths.length >= 3, `${side}: only ${paths.length} engine requests`);
  for (const path of paths) check(path.startsWith('/observatory/duckdb/'), `${side}: engine file outside /observatory/duckdb/: ${path}`);
};

const browser = await chromium.launch({ channel: 'chromium' });
try {
  const gpui = await serveGpui(GPUI_PORT);
  try {
    const context = await protocolContext(browser);
    const page = await context.newPage();
    const found = problems(page);
    const requested: string[] = [];
    page.on('request', (request) => requested.push(request.url()));
    await page.goto(gpui.url);
    await page.waitForFunction((name) => performance.getEntriesByName(name, 'mark').length > 0, MARKS.filled, { timeout: 60_000 });
    checkEngineFiles('GPUI', engineFiles(requested));
    check(found.length === 0, `GPUI page problems: ${found.join('; ')}`);
    output.gpuiPage = { engineRequests: engineFiles(requested) };
    console.log(`GPUI page: filled; engine from /observatory/duckdb/ (${engineFiles(requested).length} requests)`);
    await context.close();
  } finally {
    await gpui.close();
  }

  const server = await serveTanstack(PORT);
  try {
    const context = await protocolContext(browser);
    const page = await context.newPage();
    const found = problems(page);
    const requested: string[] = [];
    page.on('request', (request) => requested.push(request.url()));
    await page.goto(server.url);
    // Row 0 drawn with data: the header's columns and its H cell.
    const drawn = await page
      .waitForFunction(
        () => {
          const failed = document.querySelector('.row[data-row="0"] > .failed')?.textContent;
          if (failed) return { names: [], h: null, failed };
          const names = [...document.querySelectorAll('.head > .cell')].map((cell) => cell.textContent ?? '');
          const cells = document.querySelectorAll('.row[data-row="0"] > .cell:not(.pending)');
          return cells.length > 0 && cells.length === names.length ? { names, h: cells[names.indexOf('H')]?.textContent ?? null } : false;
        },
        null,
        { timeout: 60_000 },
      )
      .then((handle) => handle.jsonValue() as Promise<{ names: string[]; h: string | null; failed?: string }>);
    if (drawn.failed) throw new Error(`the TanStack page's row 0 failed: ${drawn.failed}`);
    const status = `${drawn.names.length} columns, row 0's H ${drawn.h}`;
    check(drawn.names.length === 11, `the header: ${drawn.names.join(', ')}`);
    check(drawn.h === rowZeroH, `row 0's H isn't ${rowZeroH}: ${drawn.h}`);
    checkEngineFiles('TanStack', engineFiles(requested));
    const timing = await page.evaluate(() => ({
      firstPaint: performance.getEntriesByName('first-paint')[0]?.startTime ?? null,
      scripts: performance
        .getEntriesByType('resource')
        .filter((entry) => new URL(entry.name).pathname.endsWith('.js'))
        .map((entry) => ({ path: new URL(entry.name).pathname, start: entry.startTime })),
    }));
    if (check(timing.firstPaint !== null, 'no first-paint entry')) {
      const early = timing.scripts.filter((script) => !/\/assets\/index-[\w-]+\.js$/.test(script.path) && script.start < timing.firstPaint!);
      check(early.length === 0, `JS requested before first paint: ${early.map((script) => script.path).join(', ')}`);
    }
    check(found.length === 0, `TanStack page problems: ${found.join('; ')}`);
    output.tanstackPage = { status, firstPaintMs: timing.firstPaint, engineRequests: engineFiles(requested), scripts: timing.scripts };
    console.log(
      `TanStack page: ${status}; engine from /observatory/duckdb/ (${engineFiles(requested).length} requests); ` +
        `first paint ${timing.firstPaint?.toFixed(1)} ms, every chunk but the entry after it`,
    );
  } finally {
    await server.close();
  }
} finally {
  await browser.close();
}

// --- controls ---

if (flag('controls')) {
  const controls: Record<string, boolean> = {};
  const scratch = mkdtempSync(join(tmpdir(), 'engine-files-'));
  try {
    // The comparison catches a changed byte and a missing file.
    const copy = join(scratch, 'duckdb');
    cpSync(join(tanstackWebDir, 'dist/duckdb'), copy, { recursive: true });
    const victim = walk(copy).find((file) => file.endsWith('.js'))!;
    const bytes = readFileSync(victim);
    bytes[100] = bytes[100]! ^ 1;
    writeFileSync(victim, bytes);
    controls.changedByte = differences(gpuiEngine, tree(copy)).length > 0;
    unlinkSync(victim);
    controls.missingFile = differences(gpuiEngine, tree(copy)).length > 0;
    // Arrow imported by the entry fails the build; the same build without it passes.
    const buildWith = async (arrowInEntry: boolean): Promise<string | null> => {
      try {
        await build({
          root: tanstackWebDir,
          configFile: join(tanstackWebDir, 'vite.config.ts'),
          logLevel: 'silent',
          build: { outDir: join(scratch, `dist-${arrowInEntry}`), emptyOutDir: true },
          plugins: [
            {
              name: 'control:arrow-in-entry',
              transform: (code, id) => (arrowInEntry && id.endsWith('/src/main.ts') ? `import { tableFromIPC } from 'apache-arrow';\nconsole.log(tableFromIPC);\n${code}` : null),
            },
          ],
        });
        return null;
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    };
    const withArrow = await buildWith(true);
    controls.arrowInEntryFails = withArrow?.includes(FIRST_PAINT_ERROR) ?? false;
    controls.withoutArrowPasses = (await buildWith(false)) === null;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  for (const [name, passed] of Object.entries(controls)) check(passed, `control ${name} didn't behave`);
  output.controls = controls;
  console.log(`controls: ${Object.entries(controls).map(([name, passed]) => `${name} ${passed ? 'ok' : 'FAILED'}`).join(', ')}`);
}

output.failures = failures;
if (label) {
  mkdirSync(join(perfDir, 'results'), { recursive: true });
  const out = join(perfDir, 'results', `${output.date}-${label}.json`);
  writeFileSync(out, `${JSON.stringify(output, null, 2)}\n`);
  console.log(`wrote ${relative(perfDir, out)}`);
}
if (failures.length) {
  console.error(`\nFAILED:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log('engine files: all checks passed');
