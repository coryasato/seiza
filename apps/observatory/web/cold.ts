// The cold numbers the page shows, as a virtual module (`virtual:cold-numbers`):
// each metric of src/readouts.ts resolved from perf/budgets.json and
// perf/results/ at build time, the way `just observatory report` resolves
// them for the README, so the page holds no typed copy. Node only.

import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { format, Reporter } from '../../../shared-web/scripts/results.ts';
import { METRICS, type ColdNumbers } from './src/readouts.ts';

const ID = 'virtual:cold-numbers';
const RESOLVED = `\0${ID}`;
const app = fileURLToPath(new URL('..', import.meta.url));

export function coldNumbers(): Plugin {
  return {
    name: 'observatory:cold-numbers',
    resolveId: (id) => (id === ID ? RESOLVED : undefined),
    load(id) {
      if (id !== RESOLVED) return;
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
      // Dev reloads the numbers when their sources change.
      for (const file of ['budgets.json', ...[...files].map((name) => `results/${name}`)]) this.addWatchFile(fileURLToPath(new URL(`../perf/${file}`, import.meta.url)));
      const meta = [...files].map((name) => reporter.results.find((file) => file.name === name)!.json);
      const unique = <T>(list: T[]) => [...new Set(list)];
      const numbers: ColdNumbers = {
        values,
        dates: unique(meta.map((json) => String(json.date))).sort(),
        runs: unique(meta.map((json) => Number(json.runs))).sort((a, b) => a - b),
        cpus: unique(meta.map((json) => String(json.cpu))).sort(),
      };
      return `export default ${JSON.stringify(numbers)};`;
    },
  };
}
