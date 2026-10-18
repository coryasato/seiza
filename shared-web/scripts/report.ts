// Renders each app's numbers into its docs from perf/budgets.json and
// perf/results/ (root CLAUDE.md, "Docs: one home per fact"), so no doc keeps
// a hand-typed copy of a measurement.
//
// Usage: node shared-web/scripts/report.ts [apps/<app> …] [--check]
// With no app, every app with a perf/budgets.json. Fills, between markers:
// - apps/<app>/README.md   <!-- report:readme:start --> … <!-- report:readme:end -->
// - apps/<app>/PLAN.md     <!-- report:plan:start --> … <!-- report:plan:end -->
// - README.md (root)       <!-- report:headlines:start --> … <!-- report:headlines:end -->
//   (one line per app with a budgets.json, whichever apps were named)
// --check writes nothing and exits non-zero if any of them would change.
//
// budgets.json:
// - limits.<script>.<name>.value: what each perf script enforces.
// - metrics[]: what the docs show. A metric's `local` and `production` are
//   lists of value slots, joined with " / ". A slot is one source, or a list
//   of sources of which the newest wins. A source is:
//   - "a.b.c": that path in the newest suite results file (one with a
//     `headline`) from that origin. A suite records each part's origin
//     (`parts.<part>.origin`: "local" or a URL; a `--url` run keeps panel
//     local), so a `headline.<part>.…` or `parts.<part>.…` path takes its
//     part's; otherwise the file's top-level `url`. A URL on localhost, or
//     none, is local;
//   - { "baseline": "a.b" }: that path in perf/baseline.json, dated by the
//     nearest object on the path with its own `date`, else the file's;
//   - { "glob": "*-x.json", "path": "a.b" | "sum": [paths], "where": { path: value } }:
//     the newest local results file matching the glob that has every path.
//   A path step may be an array index; -1 is the last element.
// - exclude: globs of results files never read (before runs, controls, A/Bs).
// "Newest" is the file's `date` field, then its name; a tie is reported.
// A headline template may also say {rows:<file>}: that file's row count in
// data/MANIFEST.json (e.g. "25.1 M"), so no count is typed into a template.

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, matchesGlob, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

type Json = Record<string, any>;
type Origin = 'local' | 'production';
type Source = string | { baseline: string } | { glob: string; path?: string; sum?: string[]; where?: Record<string, unknown> };
type Slot = Source | Source[];

interface Metric {
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

interface Budgets {
  app: string;
  exclude?: string[];
  limits: Record<string, Record<string, { value: number }>>;
  metrics: Metric[];
}

interface ResultFile {
  name: string;
  date: string;
  /** From the top-level `url`; a suite's parts can differ (`originAt`). */
  origin: Origin;
  suite: boolean;
  json: Json;
}

interface Value {
  value: unknown;
  /** The results file it came from, relative to the app's perf/ directory. */
  from: string;
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const check = process.argv.includes('--check');
const named = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));


function at(json: unknown, path: string): unknown {
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

function originOfUrl(url: unknown): Origin {
  return typeof url !== 'string' || url === '' || url === 'local' || /^https?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(url) ? 'local' : 'production';
}

/** Where a value at `path` was measured: its suite part's origin if it has one, else the file's. */
function originAt(file: ResultFile, path: string): Origin {
  const [group, part] = path.split('.');
  if ((group === 'headline' || group === 'parts') && part !== undefined) {
    const partOrigin = at(file.json, `parts.${part}.origin`);
    if (partOrigin !== undefined && partOrigin !== null) return originOfUrl(partOrigin);
  }
  return file.origin;
}

function loadResults(appDir: string, exclude: string[]): ResultFile[] {
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

class Reporter {
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

function format(value: unknown): string {
  return typeof value === 'number' ? String(+value.toFixed(1)) : String(value);
}

const join3 = (values: Value[], unit?: string) => values.map((v) => format(v.value)).join(' / ') + (unit ? ` ${unit}` : '');

function sourceLinks(values: Value[], linkPrefix: string): string {
  return [...new Set(values.map((v) => v.from))].map((from) => `[${basename(from, '.json')}](${linkPrefix}${from})`).join(', ');
}

function renderReadme(r: Reporter): string {
  const rows: string[] = ['| Metric | Budget | Now |', '|---|---|---|'];
  const used: Value[] = [];
  for (const metric of r.budgets.metrics.filter((m) => m.show.includes('readme'))) {
    const local = r.values(metric, 'local');
    if (local) used.push(...local);
    rows.push(`| ${metric.label} | ${r.budgetText(metric)} | ${local ? join3(local, metric.unit) : 'not measured'} |`);
  }
  return [
    ...rows,
    '',
    `${used.length ? `"Now" is each metric's newest local measurement: ${sourceLinks(used, 'perf/')}.` : 'Nothing measured yet.'} Generated by \`just ${basename(r.appDir)} report\` from [\`perf/budgets.json\`](perf/budgets.json).`,
  ].join('\n');
}

function renderPlan(r: Reporter): string {
  const rows: string[] = ['| Metric | Budget | Gate | Local | Production | From |', '|---|---|---|---|---|---|'];
  for (const metric of r.budgets.metrics.filter((m) => m.show.includes('plan'))) {
    const local = r.values(metric, 'local');
    const production = r.values(metric, 'production');
    const from = sourceLinks([...(local ?? []), ...(production ?? [])], 'perf/');
    rows.push(
      `| ${metric.label} | ${r.budgetText(metric)} | ${metric.gate} | ${local ? join3(local, metric.unit) : '—'} | ${production ? join3(production, metric.unit) : '—'} | ${from} |`,
    );
  }
  return rows.join('\n');
}

function renderHeadline(r: Reporter): string {
  const parts = r.budgets.metrics
    .filter((m) => m.headline)
    .map((m) => {
      const local = r.values(m, 'local');
      if (!local) return undefined;
      return m
        .headline!.replace(/\{local(?:\.(\d+))?\}/g, (_, index?: string) =>
          index === undefined ? join3(local, m.unit) : join3(local.slice(Number(index), Number(index) + 1), m.unit),
        )
        .replace(/\{rows:([^}]+)\}/g, (_, file: string) => r.rows(file));
    })
    .filter((part) => part !== undefined);
  const dir = relative(root, r.appDir);
  return `- **[${r.budgets.app}](${dir}/)**: ${parts.length ? parts.join(' · ') : 'not measured yet'}`;
}

/** Replaces what's between a marker pair; the markers must already be there. */
function fill(path: string, marker: string, body: string, changed: string[]): void {
  const text = readFileSync(path, 'utf8');
  const start = `<!-- report:${marker}:start -->`;
  const end = `<!-- report:${marker}:end -->`;
  const i = text.indexOf(start);
  const j = text.indexOf(end);
  if (i < 0 || j < i) throw new Error(`${relative(root, path)}: no ${start} … ${end} markers`);
  const next = `${text.slice(0, i + start.length)}\n${body}\n${text.slice(j)}`;
  if (next === text) return;
  changed.push(relative(root, path));
  if (!check) writeFileSync(path, next);
}

const appsDir = join(root, 'apps');
const allApps = readdirSync(appsDir)
  .map((name) => join(appsDir, name))
  .filter((dir) => existsSync(join(dir, 'perf', 'budgets.json')));
// Absolute and normalized (no trailing slash), so a named app is the same key as in allApps.
const targets = named.length ? named.map((dir) => resolve(dir)) : allApps;

const changed: string[] = [];
const reporters = new Map(allApps.map((dir) => [dir, new Reporter(dir)]));
for (const dir of targets) {
  if (!reporters.has(dir)) reporters.set(dir, new Reporter(dir));
  const r = reporters.get(dir)!;
  fill(join(dir, 'README.md'), 'readme', renderReadme(r), changed);
  fill(join(dir, 'PLAN.md'), 'plan', renderPlan(r), changed);
}
fill(join(root, 'README.md'), 'headlines', [...reporters.values()].map(renderHeadline).join('\n'), changed);

for (const r of reporters.values()) for (const warning of new Set(r.warnings)) console.warn(`warning: ${r.budgets.app}: ${warning}`);
if (check) {
  if (changed.length) {
    console.error(`stale generated numbers in ${changed.join(', ')}: run \`just <app> report\``);
    process.exit(1);
  }
  console.log('generated numbers are current');
} else {
  console.log(changed.length ? `updated ${changed.join(', ')}` : 'generated numbers already current');
}
