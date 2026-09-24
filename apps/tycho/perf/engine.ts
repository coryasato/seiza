// M2 engine checks, run from Rust inside the real app (`?selftest`, see
// crate/src/selftest.rs): `SELECT 42 AS x` decodes to x = 42, a row of every
// shown type decodes to the text DuckDB means, and cancelling a query that
// would run for minutes stops it within 200 ms with the next query still
// working. Each run is a new browser (cold cache) at 1440×900.
//
// Then two negative controls in Chromium: with DuckDB's wasm, or its worker
// script, blocked, the app must report the engine as failed (overlay "Engine
// ready: failed"), not stay on "Engine loading…".
//
// Usage: node apps/tycho/perf/engine.ts [--url <url>] [--runs 10] [--label <name>]
// With no --url it serves the release build in web/dist through `vite preview`,
// like perf.ts. Chromium runs --runs times; Firefox and WebKit once each.
// Writes perf/results/<date>-<label>.json and exits non-zero on any failure.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, firefox, webkit, type BrowserType } from '@playwright/test';
import { preview } from 'vite';
import { machineInfo, option, summarize } from './common.ts';

const perfDir = dirname(fileURLToPath(import.meta.url));
const webDir = join(perfDir, '../web');

const runs = Number(option('runs') ?? 10);
const label = option('label') ?? 'engine';

interface Check {
  name: string;
  ok: boolean;
  detail: string;
  ms: number | null;
}
interface Report {
  ok: boolean;
  checks: Check[];
}
interface Run {
  browser: string;
  report: Report | null;
  engineReadyMs: number | null;
  errors: string[];
}

async function measure(engine: BrowserType, url: string, block?: string): Promise<Run> {
  // Chromium in headless=new mode, as the measurement protocol says (the
  // default headless shell loads DuckDB about 3× slower).
  const browser = await engine.launch(engine === chromium ? { channel: 'chromium' } : {});
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    if (block) await page.route(`**/assets/${block}`, (route) => route.abort());
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    const target = new URL(url);
    target.searchParams.set('perf', '');
    target.searchParams.set('selftest', '');
    await page.goto(target.toString());
    // The report, or a failed engine load (the self-test only runs once it's ready).
    const report = (await page
      .waitForFunction(
        () => {
          const report = (globalThis as { __tychoSelftest?: unknown }).__tychoSelftest;
          const rows = (globalThis as { __seizaPerfOverlay?: [string, string][] }).__seizaPerfOverlay;
          if (rows?.some(([name, value]) => name === 'Engine ready' && value === 'failed')) return 'engine failed to load';
          return report ?? false;
        },
        undefined,
        { timeout: 120_000, polling: 50 },
      )
      .then(async (handle) => {
        const value = (await handle.jsonValue()) as Report | string;
        if (typeof value === 'string') throw new Error(value);
        return value;
      })
      .catch((error: Error) => {
        errors.push(`no self-test report: ${error.message.split('\n')[0]}`);
        return null;
      })) as Report | null;
    const engineReadyMs = await page.evaluate(
      () => performance.getEntriesByName('tycho:engine-ready', 'mark')[0]?.startTime ?? null,
    );
    return { browser: engine.name(), report, engineReadyMs, errors };
  } finally {
    await browser.close();
  }
}

const checkMs = (run: Run, name: string) => run.report?.checks.find((check) => check.name === name)?.ms ?? null;

/** A run with `block`ed requests must fail to load the engine, quickly. */
async function negativeControl(url: string, block: string): Promise<{ block: string; ok: boolean; detail: string }> {
  const run = await measure(chromium, url, block);
  const failed = run.errors.some((error) => error.includes('engine failed to load'));
  return { block, ok: failed && run.report === null, detail: failed ? 'engine failed to load' : run.errors.join('; ') || 'engine loaded' };
}

let url = option('url');
const server = url ? null : await preview({ root: webDir, preview: { port: 4175, strictPort: true }, logLevel: 'warn' });
url ??= 'http://localhost:4175/';

const plan: BrowserType[] = [...Array.from({ length: runs }, () => chromium), firefox, webkit];
const results: Run[] = [];
const controls: Awaited<ReturnType<typeof negativeControl>>[] = [];
try {
  for (const block of ['duckdb-eh-*.wasm', 'duckdb-browser-eh.worker-*.js']) {
    const control = await negativeControl(url, block);
    controls.push(control);
    console.log(`blocked ${block}: ${control.ok ? 'ok' : 'FAIL'} (${control.detail})`);
  }
  for (const engine of plan) {
    const run = await measure(engine, url);
    results.push(run);
    const checks = run.report?.checks.map((check) => `${check.name}: ${check.ok ? 'ok' : 'FAIL'} (${check.detail})`) ?? [];
    console.log(
      `${run.browser.padEnd(8)} engine ready ${run.engineReadyMs?.toFixed(0) ?? '—'} ms  ${checks.join('  ')}` +
        (run.errors.length ? `  ERRORS: ${run.errors.join('; ')}` : ''),
    );
  }
} finally {
  await server?.close();
}

const chromiumRuns = results.filter((run) => run.browser === 'chromium');
const numbers = (name: string) => chromiumRuns.map((run) => checkMs(run, name)).filter((ms): ms is number => ms !== null);
const summary = {
  date: new Date().toISOString().slice(0, 10),
  label,
  ...machineInfo(),
  url,
  chromium: {
    runs: chromiumRuns.length,
    select42Ms: summarize(numbers('SELECT 42')),
    typesMs: summarize(numbers('types')),
    cancelStopMs: summarize(numbers('cancel')),
    engineReadyMs: summarize(chromiumRuns.map((run) => run.engineReadyMs).filter((ms): ms is number => ms !== null)),
  },
  negativeControls: controls,
  runs: results,
};
console.log(
  `\nchromium (n=${chromiumRuns.length}): SELECT 42 ${JSON.stringify(summary.chromium.select42Ms)} ms, ` +
    `types ${JSON.stringify(summary.chromium.typesMs)} ms, cancel → stopped ${JSON.stringify(summary.chromium.cancelStopMs)} ms, ` +
    `engine ready ${JSON.stringify(summary.chromium.engineReadyMs)} ms`,
);

const out = join(perfDir, 'results', `${summary.date}-${label}.json`);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(summary, null, 2)}\n`);
console.log(`wrote ${out}`);

const failures = [
  ...controls.filter((control) => !control.ok).map((control) => `blocked ${control.block}: ${control.detail}`),
  ...results.flatMap((run) => [
  ...(run.report?.ok === false ? [`${run.browser}: ${run.report.checks.filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail}`).join('; ')}`] : []),
    ...run.errors.map((error) => `${run.browser}: ${error}`),
  ]),
];
if (failures.length > 0) {
  console.error(`\nFAIL\n${failures.map((failure) => `  ${failure}`).join('\n')}`);
  process.exit(1);
}
console.log('\nPASS');
