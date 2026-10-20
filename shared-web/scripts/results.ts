// The results resolver behind `report.ts`: an app's perf/budgets.json
// metrics resolved to their values in perf/results/ (the source forms are
// documented at the top of `report.ts`). Node only. `report.ts` renders
// them into the docs; a page that shows them imports them at build time
// (the observatory's `web/cold.ts`), so both read one source.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, matchesGlob } from 'node:path';

export type Json = Record<string, any>;
export type Origin = 'local' | 'production';
export type Source = string | { baseline: string } | { glob: string; path?: string; sum?: string[]; where?: Record<string, unknown> };
export type Slot = Source | Source[];

export interface Metric {
  id: string;
  label: string;
  unit?: string;
  budget?: string | { overBaseline: string; baseline: string; note?: string };
  gate: string;
  local: Slot[];
  production?: Slot[];
  show: ('readme' | 'plan')[];
  headline?: string;
}

export interface Budgets {
  app: string;
  exclude?: string[];
  limits: Record<string, Record<string, { value: number }>>;
  metrics: Metric[];
}

export interface ResultFile {
  name: string;
  date: string;
  /** From the top-level `url`; a suite's parts can differ (`originAt`). */
  origin: Origin;
  suite: boolean;
  json: Json;
}

export interface Value {
  value: unknown;
  /** The results file it came from, relative to the app's perf/ directory. */
  from: string;
}



export function at(json: unknown, path: string): unknown {
  let node = json;
  for (const step of path.split('.')) {
    if (node === null || typeof node !== 'object') return undefined;
    if (Array.isArray(node) && /^-?\d+$/.test(step)) {
      const index = Number(step);
      node = node[index < 0 ? node.length + index : index];
    } else {
      node = (node as Json)[step];
    }
  }
  return node;
}

export function originOfUrl(url: unknown): Origin {
  return typeof url !== 'string' || url === '' || url === 'local' || /^https?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(url) ? 'local' : 'production';
}

/** Where a value at `path` was measured: its suite part's origin if it has one, else the file's. */
export function originAt(file: ResultFile, path: string): Origin {
  const [group, part] = path.split('.');
  if ((group === 'headline' || group === 'parts') && part !== undefined) {
    const partOrigin = at(file.json, `parts.${part}.origin`);
    if (partOrigin !== undefined && partOrigin !== null) return originOfUrl(partOrigin);
  }
  return file.origin;
}

export function loadResults(appDir: string, exclude: string[]): ResultFile[] {
  const dir = join(appDir, 'perf', 'results');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json') && !exclude.some((glob) => matchesGlob(name, glob)))
    .map((name) => {
      const json = JSON.parse(readFileSync(join(dir, name), 'utf8')) as Json;
      return { name, date: String(json.date ?? name.slice(0, 10)), origin: originOfUrl(json.url), suite: 'headline' in json, json };
    })
    .sort((a, b) => (a.date === b.date ? b.name.localeCompare(a.name) : b.date.localeCompare(a.date)));
}

export class Reporter {
  readonly budgets: Budgets;
  readonly results: ResultFile[];
  readonly baseline: Json;
  readonly warnings: string[] = [];
  readonly appDir: string;

  constructor(appDir: string) {
    this.appDir = appDir;
    this.budgets = JSON.parse(readFileSync(join(appDir, 'perf', 'budgets.json'), 'utf8'));
    this.results = loadResults(appDir, this.budgets.exclude ?? []);
    // No baseline until the app's first `--write-baseline`.
    const baselinePath = join(appDir, 'perf', 'baseline.json');
    this.baseline = existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, 'utf8')) : {};
  }

  /** A data file's row count from data/MANIFEST.json, in millions past a million ("25.1 M"). */
  rows(file: string): string {
    const manifestPath = join(this.appDir, 'data', 'MANIFEST.json');
    const manifest: Json = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {};
    const count = manifest[file]?.rows;
    if (typeof count !== 'number') throw new Error(`${this.budgets.app}: data/MANIFEST.json has no rows for ${file}`);
    return count >= 1e6 ? `${+(count / 1e6).toFixed(1)} M` : count.toLocaleString('en-US');
  }

  limit(id: string): number {
    const [script = '', name = ''] = id.split('.');
    const entry = this.budgets.limits[script]?.[name];
    if (!entry) throw new Error(`${this.budgets.app}: no limit ${id} in budgets.json`);
    return entry.value;
  }

  /** The newest file the predicate accepts; a same-date runner-up is reported. */
  private newest(what: string, accept: (file: ResultFile) => boolean): ResultFile | undefined {
    const [first, second] = this.results.filter(accept);
    if (first && second && first.date === second.date)
      this.warnings.push(`${what}: ${first.name} and ${second.name} share a date; took ${first.name}`);
    return first;
  }

  resolve(source: Source, origin: Origin): (Value & { date: string }) | undefined {
    if (typeof source === 'string') {
      const file = this.newest(source, (f) => f.suite && at(f.json, source) !== undefined && originAt(f, source) === origin);
      return file && { value: at(file.json, source), from: `results/${file.name}`, date: file.date };
    }
    if ('baseline' in source) {
      const value = at(this.baseline, source.baseline);
      if (value === undefined) return undefined;
      // Dated by the nearest object on its path with a `date` of its own (a
      // script that records one entry of a shared baseline), else the file's.
      const steps = source.baseline.split('.');
      let date = this.baseline.date;
      for (let depth = steps.length - 1; depth > 0; depth--) {
        const own = (at(this.baseline, steps.slice(0, depth).join('.')) as Json | undefined)?.date;
        if (own !== undefined) {
          date = own;
          break;
        }
      }
      return { value, from: 'baseline.json', date: String(date) };
    }
    const paths = source.sum ?? (source.path ? [source.path] : []);
    const where = Object.entries(source.where ?? {});
    const file = this.newest(
      source.glob,
      (f) => matchesGlob(f.name, source.glob) && paths.every((p) => originAt(f, p) === origin) && paths.every((p) => typeof at(f.json, p) === 'number') && where.every(([p, v]) => at(f.json, p) === v),
    );
    if (!file) return undefined;
    const value = source.sum ? paths.reduce((total, p) => total + (at(file.json, p) as number), 0) : at(file.json, paths[0] ?? '');
    return { value, from: `results/${file.name}`, date: file.date };
  }

  slot(slot: Slot, origin: Origin): Value | undefined {
    const found = (Array.isArray(slot) ? slot : [slot]).map((s) => this.resolve(s, origin)).filter((v) => v !== undefined);
    return found.sort((a, b) => b.date.localeCompare(a.date))[0];
  }

  values(metric: Metric, origin: Origin): Value[] | undefined {
    const slots = origin === 'local' ? metric.local : metric.production;
    if (!slots?.length) return undefined;
    const values = slots.map((slot) => this.slot(slot, origin));
    if (values.some((v) => v === undefined)) {
      if (origin === 'local') this.warnings.push(`${metric.id}: no ${origin} value for every slot`);
      return undefined;
    }
    return values as Value[];
  }

  budgetText(metric: Metric): string {
    const budget = metric.budget;
    if (budget === undefined) return '—';
    if (typeof budget === 'string')
      return budget.replace(/\{([\w.]+?)(%?)\}/g, (_, id: string, percent: string) =>
        percent ? `${+(this.limit(id) * 100).toFixed(2)}%` : String(this.limit(id)),
      );
    const base = at(this.baseline, budget.baseline);
    const over = this.limit(budget.overBaseline);
    const note = budget.note ? `, ${budget.note}` : '';
    if (typeof base !== 'number') return `≤ baseline + ${+(over * 100).toFixed(2)}% (no baseline yet)`;
    return `≤ ${format(base * (1 + over))} ${metric.unit} (baseline ${format(base)} + ${+(over * 100).toFixed(2)}%${note})`;
  }
}

/** A number as the docs print it: one decimal at most. */
export function format(value: unknown): string {
  return typeof value === 'number' ? String(+value.toFixed(1)) : String(value);
}
