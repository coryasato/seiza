// The TanStack contender's JS from its release build (`tanstack-build`'s
// dist/), brotli at quality 11 (what the preview server and the deploy
// serve):
// - first paint: the entry chunk the HTML loads and every chunk it imports
//   statically (React, the view, the contract);
// - the data layer: the chunks the entry imports dynamically for the
//   engine's start (the data layer and Arrow), less any first-paint chunk.
//   The engine's own chunk (`@seiza/duckdb`'s, which the bridge imports;
//   each contender loads its own copy) is recorded beside them, not
//   budgeted (`engine-files` records whether it's shared).
// The CSS and the HTML are recorded too. The chunks and their imports come
// from Vite's build manifest (`dist/.vite/manifest.json`), the graph the
// build itself resolved.
//
// Usage: node apps/observatory/perf/tanstack-sizes.ts [--check] [--label <name>] [--write-baseline]
// --check fails if either JS figure is over perf/baseline.json's by more
// than limits.tanstack's fractions (perf/budgets.json). --label writes
// perf/results/<date>-<label>.json. --write-baseline records these sizes
// in perf/baseline.json, keeping its other entries. Run `just observatory
// tanstack-build` first.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { brotli } from '../../../shared-web/src/brotli.ts';
import { flag, machineInfo, option } from '../../../shared-web/perf/protocol.ts';
import { ENGINE_CHUNK, budgetLimits, perfDir, tanstackWebDir } from './harness.ts';

const dist = join(tanstackWebDir, 'dist');
if (!existsSync(join(dist, 'index.html'))) throw new Error('no TanStack contender build: run `just observatory tanstack-build` first');

const html = readFileSync(join(dist, 'index.html'), 'utf8');
/** Vite's build manifest (`build.manifest` in the contender's config): each
 *  chunk by its source, with the chunks it imports statically and
 *  dynamically, also by source. */
interface Chunk {
  file: string;
  isEntry?: boolean;
  imports?: string[];
  dynamicImports?: string[];
  css?: string[];
}
const manifestPath = join(dist, '.vite/manifest.json');
if (!existsSync(manifestPath)) throw new Error('the TanStack contender build has no .vite/manifest.json: run `just observatory tanstack-build`');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, Chunk>;
const chunk = (key: string): Chunk => {
  const found = manifest[key];
  if (!found) throw new Error(`the manifest has no chunk ${key}`);
  return found;
};
/** `keys` and every chunk they import statically. */
function closure(keys: string[]): Set<string> {
  const seen = new Set<string>();
  const visit = (key: string) => {
    if (seen.has(key)) return;
    seen.add(key);
    for (const imported of chunk(key).imports ?? []) visit(imported);
  };
  keys.forEach(visit);
  return seen;
}

const entries = Object.keys(manifest).filter((key) => manifest[key]!.isEntry);
if (entries.length !== 1) throw new Error(`expected one entry in the manifest, found ${entries.join(', ')}`);
const firstPaint = closure(entries);
const dynamic = [...new Set([...firstPaint].flatMap((key) => chunk(key).dynamicImports ?? []))];
const engine = dynamic.filter((key) => ENGINE_CHUNK.test(`/${chunk(key).file}`));
if (engine.length !== 1) throw new Error(`expected the engine's chunk among the entry's dynamic imports, found ${dynamic.join(', ')}`);
const dataLayer = [...closure(dynamic.filter((key) => !engine.includes(key)))].filter((key) => !firstPaint.has(key));
if (!dataLayer.some((key) => key.endsWith('/data/table.ts'))) throw new Error(`no data layer (src/data/table.ts) among the entry's dynamic imports: ${dynamic.join(', ')}`);
const brotliBytes = (file: string) => brotli(readFileSync(join(dist, file))).byteLength;
const css = [...firstPaint].flatMap((key) => chunk(key).css ?? []);

const kib = (bytes: number) => Math.round((bytes / 1024) * 10) / 10;
/** Brotli bytes by file name, for chunks given by source (or files). */
const sized = (keys: Iterable<string>) =>
  Object.fromEntries(
    [...keys]
      .map((key) => manifest[key]?.file ?? key)
      .sort()
      .map((file) => [basename(file), brotliBytes(file)]),
  );
const sum = (sizes: Record<string, number>) => kib(Object.values(sizes).reduce((total, bytes) => total + bytes, 0));
const firstPaintSizes = sized(firstPaint);
const dataLayerSizes = sized(dataLayer);
const engineSizes = sized(engine);
const result = {
  firstPaintJsBrotliKiB: sum(firstPaintSizes),
  dataLayerJsBrotliKiB: sum(dataLayerSizes),
  engineJsBrotliKiB: sum(engineSizes),
  cssBrotliKiB: sum(sized(css)),
  htmlBrotliKiB: kib(brotli(Buffer.from(html)).byteLength),
  chunks: { firstPaint: firstPaintSizes, dataLayer: dataLayerSizes, engine: engineSizes },
};
console.log(
  `TanStack contender, brotli: first-paint JS ${result.firstPaintJsBrotliKiB} KiB (${Object.keys(firstPaintSizes).join(', ')}); ` +
    `data layer ${result.dataLayerJsBrotliKiB} KiB (${Object.keys(dataLayerSizes).join(', ')}); engine chunk ${result.engineJsBrotliKiB} KiB; ` +
    `CSS ${result.cssBrotliKiB} KiB; HTML ${result.htmlBrotliKiB} KiB`,
);

const date = new Date().toISOString().slice(0, 10);
const label = option('label');
if (label) {
  mkdirSync(join(perfDir, 'results'), { recursive: true });
  const out = join(perfDir, 'results', `${date}-${label}.json`);
  writeFileSync(out, `${JSON.stringify({ date, label, ...machineInfo(), ...result }, null, 2)}\n`);
  console.log(`wrote ${out}`);
}

const baselinePath = join(perfDir, 'baseline.json');
interface Baseline {
  /** Its own date and machine: the file's top-level ones are the GPUI
   *  contender's cold run (`cold.ts`). */
  tanstackJsBrotliKiB?: { date: string; machine: string; firstPaint: number; dataLayer: number };
  [key: string]: unknown;
}
const baseline = JSON.parse(readFileSync(baselinePath, 'utf8')) as Baseline;
if (flag('write-baseline')) {
  baseline.tanstackJsBrotliKiB = { date, machine: machineInfo().machine, firstPaint: result.firstPaintJsBrotliKiB, dataLayer: result.dataLayerJsBrotliKiB };
  writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
  console.log(`wrote ${baselinePath}`);
}
if (flag('check')) {
  const { firstPaintJsOverBaseline, dataLayerJsOverBaseline } = budgetLimits(new URL('./budgets.json', import.meta.url))('tanstack', ['firstPaintJsOverBaseline', 'dataLayerJsOverBaseline']);
  const base = baseline.tanstackJsBrotliKiB;
  if (!base) throw new Error('perf/baseline.json has no tanstackJsBrotliKiB: run with --write-baseline');
  const over: string[] = [];
  for (const [what, value, was, fraction] of [
    ['first-paint JS', result.firstPaintJsBrotliKiB, base.firstPaint, firstPaintJsOverBaseline],
    ['data layer JS', result.dataLayerJsBrotliKiB, base.dataLayer, dataLayerJsOverBaseline],
  ] as const) {
    const limit = was * (1 + fraction);
    console.log(`budget: ${what} ${value} KiB vs limit ${limit.toFixed(1)} KiB (baseline ${was} + ${fraction * 100}%)`);
    if (value > limit) over.push(`${what} ${value} KiB is over its budget, ${limit.toFixed(1)} KiB`);
  }
  if (over.length) {
    console.error(`\nFAIL\n${over.map((problem) => `  ${problem}`).join('\n')}`);
    process.exit(1);
  }
  console.log('PASS');
}
