// The cold numbers the page shows, as a virtual module (`virtual:cold-numbers`):
// each metric of src/readouts.ts resolved from perf/budgets.json and
// perf/results/ at build time, the way `just observatory report` resolves
// them for the README, the Download card's parts by the same resolver, and
// the data file's rows from data/MANIFEST.json, so the page holds no typed
// copy. Node only.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { format, Reporter } from '../../../shared-web/scripts/results.ts';
import { METRICS, PART_SOURCES, type ColdNumbers } from './src/readouts.ts';

const ID = 'virtual:cold-numbers';
const RESOLVED = `\0${ID}`;
/** The rows alone, for the window's prerendered title bar: the numbers
 *  themselves stay out of the first-paint JS. */
const ROWS_ID = 'virtual:data-rows';
const ROWS_RESOLVED = `\0${ROWS_ID}`;
const app = fileURLToPath(new URL('..', import.meta.url));
const manifest = fileURLToPath(new URL('../data/MANIFEST.json', import.meta.url));

function dataRows(): number {
  const rows = JSON.parse(readFileSync(manifest, 'utf8'))['asteroids.parquet']?.rows;
  if (typeof rows !== 'number') throw new Error('data/MANIFEST.json has no rows for asteroids.parquet');
  return rows;
}

/** The cold numbers, and the files they came from: the page's module, and
 *  `perf/page.ts`'s reference for what the page must show. */
export function resolveCold(): { numbers: ColdNumbers; sources: string[] } {
  const reporter = new Reporter(app);
  const values: ColdNumbers['values'] = {};
  const files = new Set<string>();
  for (const metric of METRICS) {
    const entry = reporter.budgets.metrics.find((candidate) => candidate.id === metric);
    const found = entry && reporter.values(entry, 'local');
    const pair = found?.map((value) => value.value);
    if (!found || pair?.length !== 2 || !pair.every((value) => typeof value === 'number'))
      throw new Error(`${metric}: no GPUI and TanStack values in perf/results/ (perf/budgets.json)`);
    values[metric] = [Number(format(pair[0])), Number(format(pair[1]))];
    for (const value of found) files.add(value.from.replace(/^results\//, ''));
  }
  const parts: ColdNumbers['parts'] = {};
  const partFiles = new Set<string>();
  for (const [part, source] of Object.entries(PART_SOURCES)) {
    const found = reporter.resolve(source, 'local');
    if (typeof found?.value !== 'number') throw new Error(`${part}: no value in perf/results/ for ${JSON.stringify(source)}`);
    parts[part] = Number(format(found.value));
    partFiles.add(found.from.replace(/^results\//, ''));
  }
  const rows = dataRows();
  const meta = [...files].map((name) => reporter.results.find((file) => file.name === name)!.json);
  const unique = <T>(list: T[]) => [...new Set(list)];
  const numbers: ColdNumbers = {
    values,
    parts,
    rows,
    runs: unique(meta.map((json) => Number(json.runs))).sort((a, b) => a - b),
    cpus: unique(meta.map((json) => String(json.cpu))).sort(),
  };
  const sources = [manifest, ...['budgets.json', ...[...files, ...partFiles].map((name) => `results/${name}`)].map((file) => fileURLToPath(new URL(`../perf/${file}`, import.meta.url)))];
  return { numbers, sources };
}

export function coldNumbers(): Plugin {
  return {
    name: 'observatory:cold-numbers',
    resolveId: (id) => (id === ID ? RESOLVED : id === ROWS_ID ? ROWS_RESOLVED : undefined),
    load(id) {
      if (id === ROWS_RESOLVED) {
        this.addWatchFile(manifest);
        return `export default ${dataRows()};`;
      }
      if (id !== RESOLVED) return;
      const { numbers, sources } = resolveCold();
      // Dev reloads the numbers when their sources change.
      for (const file of sources) this.addWatchFile(file);
      return `export default ${JSON.stringify(numbers)};`;
    },
  };
}
