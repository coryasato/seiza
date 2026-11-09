// The cold numbers the page shows, as a virtual module (`virtual:cold-numbers`):
// each scenario's (`hasCold`) metrics of src/readouts.ts resolved from
// perf/budgets.json and perf/results/ at build time, the way `just
// observatory report` resolves them for the README, the Download card's
// parts by the same resolver, the versions they were measured with from
// the same files, and each data file's rows, credit, license, and citation
// from data/MANIFEST.json, so the page holds no typed copy; and what the
// Overview and the component's page say of them (`virtual:gallery`: the
// decision rule, each scenario's verdict, how far each side keeps up), read
// only by the galleries' chunk (`src/gallery.ts`), after first paint, though
// their HTML is prerendered. Node only.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { format, Reporter } from '../../../shared-web/scripts/results.ts';
import { SCENARIOS, type Scenario } from '../contenders/scenarios.ts';
import { COMPONENTS, hasCold } from './src/components.ts';
import { derive, galleryOf, metricsOf, partSourcesOf, type ColdNumbers, type Gallery, type ScenarioCold } from './src/readouts.ts';

const ID = 'virtual:cold-numbers';
const RESOLVED = `\0${ID}`;
/** Each data file's rows alone, for the window's prerendered title bar:
 *  the numbers themselves stay out of the first-paint JS. */
const ROWS_ID = 'virtual:data-rows';
const ROWS_RESOLVED = `\0${ROWS_ID}`;
/** The galleries' words, from the cold numbers: their HTML prerendered,
 *  their module in the galleries' chunk, never the first-paint JS's. */
const GALLERY_ID = 'virtual:gallery';
const GALLERY_RESOLVED = `\0${GALLERY_ID}`;
const app = fileURLToPath(new URL('..', import.meta.url));
const manifest = fileURLToPath(new URL('../data/MANIFEST.json', import.meta.url));

interface DataEntry {
  rows?: unknown;
  credit?: unknown;
  license?: unknown;
  citation?: unknown;
}

/** data/MANIFEST.json, read once per call. */
const readManifest = (): Record<string, DataEntry> => JSON.parse(readFileSync(manifest, 'utf8'));

/** A data file's rows, credit, license, and citation, from the manifest. */
function dataFile(name: string, files = readManifest()): { rows: number; credit: string; license: string | null; citation: string | null } {
  const { rows, credit, license, citation } = files[name] ?? {};
  if (typeof rows !== 'number') throw new Error(`data/MANIFEST.json has no rows for ${name}`);
  if (typeof credit !== 'string' || !credit) throw new Error(`data/MANIFEST.json has no credit for ${name}`);
  return { rows, credit, license: typeof license === 'string' ? license : null, citation: typeof citation === 'string' ? citation : null };
}

/** Every scenario's data file's rows, by name, from one read. */
export function dataRows(): Record<string, number> {
  const files = readManifest();
  return Object.fromEntries(SCENARIOS.map(({ data }) => [data, dataFile(data, files).rows]));
}

const strip = (from: string) => from.replace(/^results\//, '');

/** One scenario's cold numbers, and the results files they came from. */
function resolveScenario(reporter: Reporter, scenario: Scenario, files: Record<string, DataEntry>): { cold: ScenarioCold; sources: string[] } {
  const values: ScenarioCold['values'] = {};
  const used = new Set<string>();
  for (const { id, key } of metricsOf(scenario)) {
    const entry = reporter.budgets.metrics.find((candidate) => candidate.id === id);
    const found = entry && reporter.values(entry, 'local');
    const pair = found?.map((value) => value.value);
    if (!found || pair?.length !== 2 || !pair.every((value) => typeof value === 'number'))
      throw new Error(`${id}: no GPUI and TanStack values in perf/results/ (perf/budgets.json)`);
    values[key] = [Number(format(pair[0])), Number(format(pair[1]))];
    for (const value of found) used.add(strip(value.from));
  }
  const parts: ScenarioCold['parts'] = {};
  const partFiles = new Set<string>();
  for (const [part, source] of Object.entries(partSourcesOf(scenario))) {
    const found = reporter.resolve(source, 'local');
    if (typeof found?.value !== 'number') throw new Error(`${scenario.id} ${part}: no value in perf/results/ for ${JSON.stringify(source)}`);
    parts[part] = Number(format(found.value));
    partFiles.add(strip(found.from));
  }
  const meta = [...used].map((name) => reporter.results.find((file) => file.name === name)!.json);
  const unique = <T>(list: T[]) => [...new Set(list)];
  // Each package's versions across the files, said only when every file
  // records them: a file that predates them would be credited to another's.
  const versions = new Map<string, Set<string>>();
  if (meta.every((json) => json.versions && typeof json.versions === 'object'))
    for (const json of meta)
      for (const [name, version] of Object.entries(json.versions as Record<string, unknown>)) if (typeof version === 'string') versions.set(name, (versions.get(name) ?? new Set()).add(version));
  const cold: ScenarioCold = {
    values: derive(scenario, values),
    parts,
    ...dataFile(scenario.data, files),
    runs: unique(meta.map((json) => Number(json.runs))).sort((a, b) => a - b),
    cpus: unique(meta.map((json) => String(json.cpu))).sort(),
    versions: [...versions].map(([name, set]) => [name, [...set].sort()]),
  };
  return { cold, sources: [...used, ...partFiles] };
}

/** The cold numbers, and the files they came from: the page's module, and
 *  `perf/page.ts`'s reference for what the page must show. */
export function resolveCold(): { numbers: ColdNumbers; sources: string[] } {
  const reporter = new Reporter(app);
  const files = readManifest();
  const numbers: ColdNumbers = { scenarios: {} };
  const used = new Set<string>();
  for (const scenario of SCENARIOS.filter(hasCold)) {
    const { cold, sources } = resolveScenario(reporter, scenario, files);
    numbers.scenarios[scenario.id] = cold;
    for (const name of sources) used.add(name);
  }
  const sources = [manifest, ...['budgets.json', ...[...used].map((name) => `results/${name}`)].map((file) => fileURLToPath(new URL(`../perf/${file}`, import.meta.url)))];
  return { numbers, sources };
}

/** The galleries' words, from the same numbers (`resolveCold`'s, passed
 *  in when already resolved): the page's module, and `perf/page.ts`'s
 *  reference. */
export function resolveGallery(cold = resolveCold()): { gallery: Gallery; sources: string[] } {
  return { gallery: galleryOf(COMPONENTS, cold.numbers), sources: cold.sources };
}

export function coldNumbers(): Plugin {
  /** The numbers, resolved once per build (both modules read them), again
   *  after a source changes. */
  let resolved: ReturnType<typeof resolveCold> | null = null;
  const cold = () => (resolved ??= resolveCold());
  return {
    name: 'observatory:cold-numbers',
    buildStart() {
      resolved = null;
    },
    watchChange() {
      resolved = null;
    },
    resolveId: (id) => (id === ID ? RESOLVED : id === ROWS_ID ? ROWS_RESOLVED : id === GALLERY_ID ? GALLERY_RESOLVED : undefined),
    load(id) {
      if (id === GALLERY_RESOLVED) {
        const { gallery, sources } = resolveGallery(cold());
        for (const file of sources) this.addWatchFile(file);
        return `export default ${JSON.stringify(gallery)};`;
      }
      if (id === ROWS_RESOLVED) {
        this.addWatchFile(manifest);
        return `export default ${JSON.stringify(dataRows())};`;
      }
      if (id !== RESOLVED) return;
      const { numbers, sources } = cold();
      // Dev reloads the numbers when their sources change.
      for (const file of sources) this.addWatchFile(file);
      return `export default ${JSON.stringify(numbers)};`;
    },
  };
}
