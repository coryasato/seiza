// The wasm's size gate, run by `just tycho check` on the release build:
// fails when the app wasm (brotli, quality 11, as it's served) is more than
// limits.size.wasmOverBaseline over perf/baseline.json's `wasmBrotliKiB`,
// unless a perf/budget-notes.md row accepts the new size. Prints the size;
// writes nothing.
//
// Usage: node apps/tycho/perf/size.ts

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotli } from '../../../shared-web/src/brotli.ts';
import { budgetLimits } from '../../../shared-web/perf/protocol.ts';

const perfDir = dirname(fileURLToPath(import.meta.url));
const assets = join(perfDir, '../web/dist/assets');
const { wasmOverBaseline } = budgetLimits(new URL('./budgets.json', import.meta.url))('size', ['wasmOverBaseline']);

interface Baseline {
  date: string;
  wasmBrotliKiB: number;
}

/** The largest wasm size perf/budget-notes.md accepts. Each note is a table
 *  row: `| YYYY-MM-DD | accepted KiB | … |`. Only notes dated on or after the
 *  baseline count, so rewriting the baseline retires older acceptances. */
function acceptedWasmKiB(since: string): number {
  let text = '';
  try {
    text = readFileSync(join(perfDir, 'budget-notes.md'), 'utf8');
  } catch {
    return 0; // No notes file: no acceptances.
  }
  const sizes = text
    .split('\n')
    .map((line) => line.split('|').map((cell) => cell.trim()))
    .filter((cells) => /^\d{4}-\d{2}-\d{2}$/.test(cells[1] ?? '') && cells[1]! >= since)
    .map((cells) => Number.parseFloat(cells[2] ?? ''))
    .filter((size) => Number.isFinite(size));
  return Math.max(0, ...sizes);
}

// The app's wasm, not DuckDB's (which loads after first paint).
const wasm = readdirSync(assets).filter((name) => name.startsWith('tycho_bg') && name.endsWith('.wasm'));
if (wasm.length !== 1) throw new Error(`expected one tycho_bg*.wasm in ${assets}, found ${wasm.length}; run \`just tycho build\` first`);
const kib = brotli(readFileSync(join(assets, wasm[0]!))).length / 1024;

const baseline = JSON.parse(readFileSync(join(perfDir, 'baseline.json'), 'utf8')) as Baseline;
const limit = Math.max(baseline.wasmBrotliKiB * (1 + wasmOverBaseline), acceptedWasmKiB(baseline.date));
console.log(`wasm brotli ${kib.toFixed(1)} KiB vs limit ${limit.toFixed(1)} KiB (baseline ${baseline.wasmBrotliKiB} + ${wasmOverBaseline * 100}%, or a budget-notes.md row)`);
if (kib > limit) {
  console.error(`FAIL: wasm brotli ${kib.toFixed(1)} KiB is over ${limit.toFixed(1)} KiB; add a row to perf/budget-notes.md to accept it`);
  process.exit(1);
}
console.log('PASS');
