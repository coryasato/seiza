// An interleaved A/B of a metric on a scenario's level: the tree's build
// against a kept one (`--build <dir>`, its `gpui/` and `tanstack/`: a
// level as an earlier commit built it), both sides. Each round runs one
// cold run of each build and side, each its own invocation of the metric's
// script (`metric-<name>.ts --runs 1`), as cold as any run of 10; the
// builds' order alternates by round (the kept build first in odd rounds),
// and so does the sides'. Pairing a round's two runs of a side cancels
// drift over the sitting, as the gpui-kit 0.9.0 against 0.9.1 A/B did by
// hand (its builds swapped into the tree between runs; here the kept
// build is served from where it's kept).
//
// The one-run files go to `perf/results/raw/<date>-<label>/`, every file
// the A/B causes dated alike (`--date`, today's, local). Each build's runs
// are merged there (`mergedFrom`; a run that recorded a failure is left out
// and named in `failures`) and summarized by the metric's own script
// (`--summarize`) into `<date>-<label>-<build>-<scenario>-<stop>.json`, the
// build `kept` or `tree`. Then, per side and stop, every number in a run,
// paired round by round (kept less tree): each build's median and its IQR
// over the median (`protocol.ts`'s `iqr`, the quiet-machine gate's), the
// paired difference's median, the rounds up and down with a two-sided sign
// test, and whether the difference is within the spread (at most the larger
// IQR). A round is paired only where both runs are whole and did the same
// work (their `workload`, where the metric records one, equal). A reading
// moved when it's past the spread and the sign test's p is under 0.05; the
// pairs go to `<date>-<label>-paired.json` and the readings that moved are
// printed. Before any run, the kept build's engine files must be the tree's
// to the byte (the server mounts the tree's).
//
// Usage: node apps/observatory/perf/ab.ts --build <dir> --label <name>
//          [--metric scroll] [--scenario wide-sheet] [--stop <id,…|all>]
//          [--rounds 10] [--profile reference] [--side gpui|tanstack]
// Without `--stop`, the metric's own stops (`scroll`'s all, `copy`'s its
// default). Run the level's builds of the tree first (`just observatory
// gpui-build wide`, `tanstack-build wide`); the kept build is made from the
// earlier commit's sources the same way and moved aside (its results note
// says how).

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { iqr, localDate, median, option } from '../../../shared-web/perf/protocol.ts';
import { ALL_SCENARIOS } from '../contenders/scenarios.ts';
import type { Side } from '../contenders/contract.ts';
import { keptName } from './contender.ts';
import { distDir, gpuiWebDir, perfDir, tanstackWebDir } from './harness.ts';

const metric = option('metric') ?? 'scroll';
const label = option('label');
const keptOption = option('build');
const rounds = Number(option('rounds') ?? 10);
const profile = option('profile') ?? 'reference';
const scenarioId = option('scenario') ?? 'wide-sheet';
const stopOption = option('stop');
const sides: Side[] = option('side') ? [option('side') as Side] : ['gpui', 'tanstack'];
if (!label) throw new Error('--label: the A/B writes results files');
if (!keptOption) throw new Error('--build <dir>: the kept build to compare with the tree\'s');
if (!Number.isInteger(rounds) || rounds < 1) throw new Error(`--rounds ${option('rounds')}: not a positive whole number`);
const script = join(perfDir, `metric-${metric}.ts`);
if (!existsSync(script)) throw new Error(`--metric ${metric}: no ${relative(process.cwd(), script)}`);
const scenario = ALL_SCENARIOS.find((candidate) => candidate.id === scenarioId);
if (!scenario) throw new Error(`--scenario ${scenarioId}: not a scenario`);
if (stopOption && stopOption !== 'all') for (const id of stopOption.split(',')) if (!scenario.stops.some((stop) => stop.id === id)) throw new Error(`--stop ${id}: not a stop of ${scenario.id}`);
const kept = resolve(keptOption);

type Build = 'kept' | 'tree';
const BUILDS: Build[] = ['kept', 'tree'];

// The engine's files: the server mounts the tree's build's, so the kept
// build's must be the same bytes.
const digestDir = (dir: string): Map<string, string> => {
  const out = new Map<string, string>();
  const walk = (at: string) => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const path = join(at, entry.name);
      if (entry.isDirectory()) walk(path);
      else out.set(relative(dir, path), createHash('sha256').update(readFileSync(path)).digest('hex'));
    }
  };
  walk(dir);
  return out;
};
for (const side of sides) {
  const tree = join(distDir(side === 'gpui' ? gpuiWebDir : tanstackWebDir, scenario.level), 'duckdb');
  const [a, b] = [digestDir(join(kept, side, 'duckdb')), digestDir(tree)];
  const differ = [...new Set([...a.keys(), ...b.keys()])].filter((file) => a.get(file) !== b.get(file));
  if (differ.length) throw new Error(`${side}: the kept build's engine files differ from the tree's (${differ.slice(0, 3).join(', ')}): the server would serve the tree's`);
}

// One date for every file the A/B causes, the children's too.
const date = localDate();
const resultsDir = join(perfDir, 'results');
const rawDir = join(resultsDir, 'raw', `${date}-${label}`);
const pairedFile = join(resultsDir, `${date}-${label}-paired.json`);
if (existsSync(rawDir) || existsSync(pairedFile)) throw new Error(`${existsSync(rawDir) ? rawDir : pairedFile} exists: give the A/B a label of its own`);
mkdirSync(rawDir, { recursive: true });
const tmpLabel = (round: number, build: Build, side: Side) => `abtmp-${label}-r${round}-${build}-${side}`;
/** A one-run file's stop: its name `<date>-<tmp label>-<scenario>-<stop>.json`. */
const stopOf = (file: string, tmp: string): string | null => {
  const prefix = `${date}-${tmp}-${scenario.id}-`;
  return file.startsWith(prefix) && file.endsWith('.json') ? file.slice(prefix.length, -'.json'.length) : null;
};

// ---------------------------------------------------------------- the rounds

const failures: string[] = [];
const started = Date.now();
for (let round = 1; round <= rounds; round++) {
  const builds = round % 2 ? BUILDS : [...BUILDS].reverse();
  for (const build of builds) {
    const order = round % 2 ? sides : [...sides].reverse();
    for (const side of order) {
      const name = tmpLabel(round, build, side);
      const args = [script, '--scenario', scenario.id, ...(stopOption ? ['--stop', stopOption] : []), '--side', side, '--runs', '1', '--profile', profile, '--date', date, '--label', name, ...(build === 'kept' ? ['--build', kept] : [])];
      const minutes = ((Date.now() - started) / 60_000).toFixed(1);
      console.log(`\n== round ${round}/${rounds} ${build} ${side} (${minutes} min in)`);
      // Its output streams through: nothing buffered, the progress seen.
      const run = spawnSync(process.execPath, args, { stdio: 'inherit' });
      // Its one-run files, into raw/, failed or not.
      for (const file of readdirSync(resultsDir).filter((file) => stopOf(file, name) !== null)) renameSync(join(resultsDir, file), join(rawDir, file));
      if (run.status !== 0) failures.push(`round ${round} ${build} ${side}: exit ${run.status ?? run.signal} (its output above)`);
    }
  }
}

// ---------------------------------------------------------------- merged and summarized

type RunFile = { versions?: Record<string, string>; profiles: Record<string, Partial<Record<Side, { runs: unknown[] }>>> } & Record<string, unknown>;
type Run = Record<string, unknown> & { failures?: string[]; workload?: unknown };
/** Each build's, stop's, and side's whole runs, in round order (null where
 *  the round wrote none, or its run recorded a failure). */
const runsOf: Record<Build, Record<string, Partial<Record<Side, (Run | null)[]>>>> = { kept: {}, tree: {} };
const rawFiles = readdirSync(rawDir);
const found = new Set<string>();
for (const file of rawFiles)
  for (const build of BUILDS)
    for (const side of sides)
      for (let round = 1; round <= rounds; round++) {
        const stop = stopOf(file, tmpLabel(round, build, side));
        if (stop !== null) found.add(stop);
      }
const stops = [...found].sort(
  (a, b) => scenario.stops.findIndex((stop) => stop.id === a) - scenario.stops.findIndex((stop) => stop.id === b),
);
if (!stops.length) failures.push('no run wrote a file');
for (const build of BUILDS)
  for (const stop of stops) {
    const headers: Partial<Record<Side, RunFile>> = {};
    const merged: Partial<Record<Side, { summary: null; runs: Run[] }>> = {};
    const mergedFrom: string[] = [];
    for (const side of sides) {
      const byRound: (Run | null)[] = [];
      for (let round = 1; round <= rounds; round++) {
        const file = rawFiles.find((name) => stopOf(name, tmpLabel(round, build, side)) === stop);
        const json = file ? (JSON.parse(readFileSync(join(rawDir, file), 'utf8')) as RunFile) : null;
        const run = (json?.profiles[profile]?.[side]?.runs[0] as Run | undefined) ?? null;
        if (file) mergedFrom.push(file);
        if (json) headers[side] ??= json;
        // A run that recorded a failure (its page's problems, a check it
        // failed) is no reading: left out, and named.
        if (run?.failures?.length) failures.push(`round ${round} ${build} ${side} ${stop}: left out, ${run.failures.join('; ')}`);
        byRound.push(run && !run.failures?.length ? run : null);
      }
      (runsOf[build][stop] ??= {})[side] = byRound;
      merged[side] = { summary: null, runs: byRound.filter((run): run is Run => run !== null) };
    }
    // The header's versions: gpui-kit is the served GPUI build's own, which
    // only a GPUI run's file records; without one, none is claimed.
    const header = headers.gpui ?? headers.tanstack;
    if (!header) continue;
    const versions = { ...header.versions };
    if (!headers.gpui) delete versions['gpui-kit'];
    const mergedFile = join(rawDir, `${date}-${label}-${build}-${scenario.id}-${stop}-merged.json`);
    const { profiles: _profiles, failures: _failures, ...rest } = header;
    const runCounts = Object.fromEntries(sides.map((side) => [side, merged[side]!.runs.length]));
    writeFileSync(
      mergedFile,
      `${JSON.stringify(
        {
          ...rest,
          versions,
          label: `${label}-${build}`,
          runs: Math.max(...Object.values(runCounts)),
          mergedRuns: runCounts,
          interleaved: `one cold run a round over ${rounds} rounds, each build and side its own invocation, the builds' order alternating by round (the kept build first in odd rounds), the sides' too`,
          build: build === 'kept' ? keptName(kept) : 'tree',
          mergedFrom,
          failures: failures.filter((failure) => failure.includes(` ${build} `)),
          profiles: { [profile]: merged },
        },
        null,
        2,
      )}\n`,
    );
    const summarized = spawnSync(process.execPath, [script, '--scenario', scenario.id, '--summarize', mergedFile, '--date', date, '--label', `${label}-${build}`], { stdio: 'inherit' });
    if (summarized.status !== 0) failures.push(`summarizing ${build} ${stop}: exit ${summarized.status}`);
  }

// ---------------------------------------------------------------- paired

/** Every finite number in `value`, by its path (`workload` aside: it's
 *  what the run did, not a reading). */
function numbers(value: unknown, path = '', out = new Map<string, number>()): Map<string, number> {
  if (typeof value === 'number' && Number.isFinite(value)) out.set(path, value);
  else if (value && typeof value === 'object' && !Array.isArray(value))
    for (const [key, inner] of Object.entries(value)) if (!(path === '' && key === 'workload')) numbers(inner, path ? `${path}.${key}` : key, out);
  return out;
}

/** Two-sided sign test: `up` and `down` of n (ties dropped). */
function signTest(up: number, down: number): number {
  const n = up + down;
  if (!n) return 1;
  const k = Math.min(up, down);
  let tail = 0;
  for (let i = 0; i <= k; i++) {
    let c = 1;
    for (let j = 0; j < i; j++) c = (c * (n - j)) / (j + 1);
    tail += c / 2 ** n;
  }
  return Math.min(1, 2 * tail);
}

const round3 = (value: number) => Number(value.toFixed(3));
interface Pair {
  kept: { median: number; iqrPct: number | null };
  tree: { median: number; iqrPct: number | null };
  /** Kept less tree, round by round. */
  diffMedian: number;
  diffPct: number | null;
  up: number;
  down: number;
  signP: number;
  withinSpread: boolean;
  moved: boolean;
  rounds: number;
}
const paired: Record<string, Partial<Record<Side, Record<string, Pair>>>> = {};
const moved: string[] = [];
for (const stop of stops)
  for (const side of sides) {
    const a = runsOf.kept[stop]?.[side] ?? [];
    const b = runsOf.tree[stop]?.[side] ?? [];
    const pairs: [Map<string, number>, Map<string, number>][] = [];
    for (let index = 0; index < rounds; index++) {
      const [x, y] = [a[index], b[index]];
      if (!x || !y) continue;
      // Only the same work is compared (the drag's select path, laid out from each view).
      if (JSON.stringify(x.workload) !== JSON.stringify(y.workload)) {
        failures.push(`round ${index + 1} ${side} ${stop}: not paired, the builds' runs did different work (${JSON.stringify(x.workload)} against ${JSON.stringify(y.workload)})`);
        continue;
      }
      pairs.push([numbers(x), numbers(y)]);
    }
    if (!pairs.length) continue;
    const paths = [...pairs[0]![0].keys()].filter((path) => pairs.every(([x, y]) => x.has(path) && y.has(path)));
    const out: Record<string, Pair> = {};
    for (const path of paths) {
      const ka = pairs.map(([x]) => x.get(path)!);
      const tb = pairs.map(([, y]) => y.get(path)!);
      const diffs = pairs.map(([x, y]) => x.get(path)! - y.get(path)!);
      const [mk, mt] = [median(ka), median(tb)];
      const diffMedian = median(diffs);
      const [up, down] = [diffs.filter((d) => d > 0).length, diffs.filter((d) => d < 0).length];
      const signP = signTest(up, down);
      const withinSpread = Math.abs(diffMedian) <= Math.max(iqr(ka), iqr(tb));
      const pair: Pair = {
        kept: { median: round3(mk), iqrPct: mk ? round3((iqr(ka) / Math.abs(mk)) * 100) : null },
        tree: { median: round3(mt), iqrPct: mt ? round3((iqr(tb) / Math.abs(mt)) * 100) : null },
        diffMedian: round3(diffMedian),
        diffPct: mt ? round3((diffMedian / Math.abs(mt)) * 100) : null,
        up,
        down,
        signP: round3(signP),
        withinSpread,
        moved: !withinSpread && signP < 0.05,
        rounds: pairs.length,
      };
      out[path] = pair;
      if (pair.moved) moved.push(`${stop} ${side} ${path}: kept ${pair.kept.median}, tree ${pair.tree.median}, paired ${pair.diffMedian} (${pair.diffPct}%), ${up} up / ${down} down, p ${pair.signP}`);
    }
    (paired[stop] ??= {})[side] = out;
  }

writeFileSync(
  pairedFile,
  `${JSON.stringify({ date, label, metric, scenario: scenario.id, stops, profile, rounds, build: keptName(kept), rule: "a reading moved when the paired median difference (kept less tree) is past the larger IQR (protocol.ts's) and a two-sided sign test gives p < 0.05; a round is paired only where both runs are whole and did the same work", moved, failures, paired }, null, 2)}\n`,
);
console.log(`\nwrote ${pairedFile}`);
console.log(moved.length ? `\nmoved (${moved.length}):\n${moved.map((line) => `  ${line}`).join('\n')}` : '\nno reading moved');
if (failures.length) {
  console.error(`\nFAIL\n${failures.map((failure) => `  ${failure}`).join('\n')}`);
  process.exit(1);
}
console.log('\nPASS');
