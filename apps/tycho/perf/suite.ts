// The full perf suite (`just tycho perf`, M7 part E): every protocol
// measurement Tycho has a budget for, on the release build, into one results
// file.
//
// Parts, in order, each its own script run as a child process (each starts
// and stops its own servers, so they never share a page or a port):
// - cold:   perf.ts, cold load: TTFP and engine ready, the first-frame probe.
// - panel:  panel.ts, every observation-panel value against an independent
//           measurement, and the fling with the panel open and closed.
// - table:  table.ts on the asteroids, then on Gaia: first rows, jump to
//           90%, last row, fling, steady scroll, work per frame.
// - jump:   jump.ts, jump to row on both samples (first, middle, last, out
//           of range) and the input's edges (IME, paste, keys, focus).
// - csv:    csv.ts --only drop, the ~1 GB CSV: first rows, count updates,
//           a fling while it loads, throughput. Needs `just tycho drop-files csv`.
// Every part runs reference + throttled, median of --runs (10). Each part's
// own output lands in perf/results/raw/<date>-<label>/ (gitignored); the
// results file keeps a headline per part, each part's summaries (its output
// without per-run lists), its failures (from the `failures` its script
// writes), and the machine's load average before and after (busy machines
// read slow; see LESSONS).
//
// Usage: node apps/tycho/perf/suite.ts [--runs 10] [--label m7-suite] [--only cold,panel,table,jump,csv]
//                                      [--reference-only] [--update]
// --update re-runs the parts named by --only (required) into an existing
// results file of the same date and label, keeping the others (and noting it).
// Writes perf/results/<date>-<label>.json. Exits non-zero if any part
// failed. Run `just tycho build` first. Takes about 1 h 45 min.

import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { flag, machineInfo, option } from './common.ts';

const perfDir = dirname(fileURLToPath(import.meta.url));
const date = new Date().toISOString().slice(0, 10);
const label = option('label') ?? 'suite';
const runs = option('runs');
const only = option('only')?.split(',');
const rawDir = join(perfDir, 'results', 'raw', `${date}-${label}`);
if (flag('update') && !only) throw new Error('--update re-runs the parts named by --only; pass --only');
mkdirSync(rawDir, { recursive: true });

// Each part writes its own shape; the headlines read it loosely.
type Json = Record<string, any>;

interface Part {
  name: string;
  group: string;
  script: string;
  args: string[];
  /** The numbers worth reading first, from the part's own output. */
  headline: (output: Json) => Json;
}

const median = (summary: Json | undefined) => summary?.median ?? null;
const byProfile = (output: Json, pick: (profile: Json) => Json | null) =>
  Object.fromEntries(Object.entries((output ?? {}) as Json).map(([name, profile]) => [name, pick(profile)]));

const tableHeadline = (output: Json) =>
  byProfile(output.profiles, (p) => ({
    firstRowsMs: median(p.firstRowsMs),
    jumpTo90Ms: median(p.jumpMs),
    flingP95MsWorstRun: p.flingP95Ms?.max ?? null,
    flingMaxMsWorstRun: p.flingMaxMs?.max ?? null,
    flingWorkP50Ms: median(p.flingWorkP50Ms),
    flingWorkP95Ms: median(p.flingWorkP95Ms),
    steadyWorkP50Ms: median(p.steadyWorkP50Ms),
    steadyWorkP95Ms: median(p.steadyWorkP95Ms),
  }));

const PARTS: Part[] = [
  {
    name: 'cold',
    group: 'cold',
    script: 'perf.ts',
    args: [],
    headline: (o) => ({ ttfpMs: o.ttfpMs, engineReadyMs: o.engineReadyMs, wasmBrotliKiB: o.wasmBrotliKiB }),
  },
  {
    name: 'panel',
    group: 'panel',
    script: 'panel.ts',
    args: [],
    headline: (o) =>
      byProfile(o.summary, (p) => ({
        matched: p.matched,
        flingPanelOpen: p.flingPanelOpen,
        flingPanelClosed: p.flingPanelClosed,
        steadyWork: p.steadyWork,
      })),
  },
  { name: 'table-asteroids', group: 'table', script: 'table.ts', args: ['--sample', 'asteroids'], headline: tableHeadline },
  { name: 'table-gaia', group: 'table', script: 'table.ts', args: ['--sample', 'gaia'], headline: tableHeadline },
  {
    name: 'jump',
    group: 'jump',
    script: 'jump.ts',
    args: [],
    headline: (o) =>
      Object.fromEntries(
        Object.entries((o.samples ?? {}) as Json).map(([sample, s]) => [
          sample,
          {
            ...byProfile({ reference: s.reference, throttled: s.throttled }, (p) =>
              p ? { firstMs: median(p.firstFilledMs) ?? (p.firstFilledMs?.cached ? `in view (${p.firstFilledMs.cached} runs)` : null), middleMs: median(p.middleFilledMs), lastMs: median(p.lastFilledMs) } : null,
            ),
            edgeProblems: s.edges?.problems?.length ?? null,
          },
        ]),
      ),
  },
  {
    name: 'csv',
    group: 'csv',
    script: 'csv.ts',
    args: ['--only', 'drop'],
    headline: (o) =>
      byProfile(o.drop, (p) => ({
        schemaMs: median(p.schemaMs),
        firstRowsMs: median(p.firstRowsMs),
        updateGapMaxMsWorstRun: p.updateGapMaxMs?.max ?? null,
        flingP95MsWorstRun: p.flingP95Ms?.max ?? null,
        flingMaxMsWorstRun: p.flingMaxMs?.max ?? null,
        ingestS: p.ingestMs ? Number((p.ingestMs.median / 1000).toFixed(1)) : null,
        mbPerS: median(p.mbPerS),
      })),
  },
];

/** A part's output without its per-run lists (`runs` and `list` when they
 *  aren't counts), which stay in raw/. */
function summaries(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(summaries);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).filter(([key, v]) => !((key === 'runs' || key === 'list') && typeof v !== 'number')).map(([key, v]) => [key, summaries(v)]),
  );
}

/** Runs one part, echoing its output, and returns its exit code and the
 *  last line of its stderr (for a part that failed without writing results). */
function run(part: Part, out: string): Promise<{ code: number; lastError: string; seconds: number }> {
  const args = [join(perfDir, part.script), ...part.args, '--label', `${label}-${part.name}`, '--out', out];
  if (runs) args.push('--runs', runs);
  if (flag('reference-only')) args.push('--reference-only');
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => process.stdout.write(chunk));
    // Decoded as a stream: a character split across two chunks stays whole.
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
      process.stderr.write(chunk);
    });
    child.on('close', (code) => {
      resolve({ code: code ?? 1, lastError: stderr.trim().split('\n').at(-1) ?? '', seconds: Math.round((Date.now() - started) / 1000) });
    });
  });
}

const load = () => loadavg().map((value) => Number(value.toFixed(2)));
const results: Json = {
  date,
  label,
  ...machineInfo(),
  protocol: 'root CLAUDE.md, "Measurement protocol": Chromium headless=new, cold cache, 1440×900 at DPR 2, median of 10; reference + throttled (CPU 4×, Fast 4G)',
  loadAverage: { before: load() },
  headline: {} as Json,
  parts: {} as Json,
};
const failures: string[] = [];
const out = join(perfDir, 'results', `${date}-${label}.json`);
if (flag('update')) {
  const previous = JSON.parse(readFileSync(out, 'utf8')) as Json;
  Object.assign(results, { headline: previous.headline, parts: previous.parts, updated: [...(previous.updated ?? []), { at: new Date().toISOString(), only, loadAverage: results.loadAverage }] });
  results.loadAverage = previous.loadAverage;
  // A kept part's failures still count.
  for (const [name, part] of Object.entries(previous.parts as Json)) {
    if (!only!.some((o) => o === name || name.startsWith(`${o}-`))) failures.push(...(part.failures as string[]).map((failure) => `${name}: ${failure}`));
  }
}
const write = () => writeFileSync(out, `${JSON.stringify(results, null, 2)}\n`);

for (const part of PARTS.filter((p) => !only || only.includes(p.group) || only.includes(p.name))) {
  console.log(`\n=== ${part.name}: ${part.script} ${part.args.join(' ')} (load ${load().join(' ')})`);
  const partOut = join(rawDir, `${part.name}.json`);
  const outcome = await run(part, partOut);
  let output: Json | null = null;
  try {
    output = JSON.parse(readFileSync(partOut, 'utf8')) as Json;
  } catch {
    // No results: it stopped before writing them.
  }
  // Every part's script writes the failures it found; a non-zero exit with
  // none (a crash, a budget only checked after writing) still fails.
  const partFailures: string[] = Array.isArray(output?.failures) ? [...output.failures] : [];
  if (!output) partFailures.push(`wrote no results (exit ${outcome.code}: ${outcome.lastError})`);
  else if (outcome.code !== 0 && partFailures.length === 0) partFailures.push(`exited with ${outcome.code}: ${outcome.lastError}`);
  results.headline[part.name] = output ? part.headline(output) : null;
  results.parts[part.name] = {
    passed: partFailures.length === 0,
    seconds: outcome.seconds,
    failures: partFailures,
    raw: `raw/${date}-${label}/${part.name}.json`,
    summary: output ? summaries(output) : null,
  };
  failures.push(...partFailures.map((failure) => `${part.name}: ${failure}`));
  // Written after every part, so a long run that stops keeps what it measured.
  write();
}
(flag('update') ? results.updated.at(-1).loadAverage : results.loadAverage).after = load();
write();

console.log(`\n${JSON.stringify(results.headline, null, 2)}`);
for (const [name, part] of Object.entries(results.parts as Json)) console.log(`${name}: ${part.passed ? 'PASS' : 'FAIL'} (${part.seconds} s)`);
console.log(`wrote ${out}`);
if (failures.length) {
  console.error(`\nFAIL\n${failures.map((failure) => `  ${failure}`).join('\n')}`);
  process.exit(1);
}
console.log('\nPASS');
