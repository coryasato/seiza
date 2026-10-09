// M7 part E experiment: the static placeholder shell (PLAN.md, M7's
// candidate), decided by the throttled run.
//
// A prototype of the placeholder is injected into a copy of the release
// build (web/dist → web/dist-placeholder, gitignored): an HTML/CSS copy of the
// empty shell, on top of the canvas, in system fonts (the UI font is
// preloaded `as=fetch` for GPUI, and a CSS @font-face can't reuse that
// preload, so Plex would download twice), removed by a PerformanceObserver
// once `gpui:first-frame` is set. Same wasm, same JS: only index.html
// differs.
//
// Interleaved A/B (HEAD's dist vs the placeholder's), a new browser per run,
// the protocol's page (1440×900 at DPR 2, Chromium headless=new), reference
// and throttled. Per run: TTFP (the mark), the placeholder's paint (an
// Element Timing entry on its heading: when its text was painted; not the
// browser's FCP, which the protocol rules out because on HEAD's page it's the
// canvas), the HTML's responseEnd, and whether the placeholder was up before
// the first frame and gone after it.
//
// Usage: node apps/tycho/perf/placeholder.ts [--runs 10] [--label m7-placeholder] [--reference-only]
// Writes perf/results/<date>-<label>.json. Run `just tycho build` first.

import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { preview } from 'vite';
import { PROFILES, flag, hideDevicePixelContentBox, machineInfo, option, summarize, throttle, type Profile } from './common.ts';

const perfDir = dirname(fileURLToPath(import.meta.url));
const webDir = join(perfDir, '../web');
const runs = Number(option('runs') ?? 10);
const label = option('label') ?? 'm7-placeholder';
const date = new Date().toISOString().slice(0, 10);

/** The prototype: the empty shell as the canvas will draw it, saying the
 *  app is loading, in GPUI Kit's default theme colors. */
const PLACEHOLDER = `
<style>
  #seiza-placeholder { position: fixed; inset: 0; z-index: 1; display: flex; flex-direction: column;
    font: 14px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; background: #fff; color: #0a0a0a; }
  #seiza-placeholder header { height: 34px; display: flex; align-items: center; justify-content: space-between;
    padding: 0 8px 0 12px; border-bottom: 1px solid #e5e5e5; background: #fafafa; font-size: 12px; }
  #seiza-placeholder main { flex: 1; display: flex; align-items: center; justify-content: center; }
  #seiza-placeholder .empty { display: flex; flex-direction: column; align-items: center; gap: 16px; text-align: center; }
  #seiza-placeholder h1 { margin: 0; font-size: 18px; font-weight: 500; }
  #seiza-placeholder p { margin: 0; color: #737373; }
  #seiza-placeholder .row { display: flex; gap: 8px; }
  #seiza-placeholder .btn { padding: 6px 12px; border: 1px solid #e5e5e5; border-radius: 6px; opacity: .5; }
  #seiza-placeholder .primary { background: #171717; color: #fafafa; border-color: #171717; }
  @media (prefers-color-scheme: dark) {
    #seiza-placeholder { background: #0a0a0a; color: #fafafa; }
    #seiza-placeholder header { background: #171717; border-color: #262626; }
    #seiza-placeholder p { color: #a3a3a3; }
    #seiza-placeholder .btn { border-color: #262626; }
    #seiza-placeholder .primary { background: #fafafa; color: #171717; }
  }
</style>
<script>
  new PerformanceObserver((list, observer) => {
    if (!list.getEntries().some((entry) => entry.name === 'gpui:first-frame')) return;
    document.getElementById('seiza-placeholder')?.remove();
    observer.disconnect();
  }).observe({ type: 'mark', buffered: true });
</script>`;
const PLACEHOLDER_BODY = `
<div id="seiza-placeholder" aria-busy="true">
  <header><span>Tycho</span><span>Observation panel</span></header>
  <main><div class="empty">
    <h1 elementtiming="seiza-placeholder">Drop a Parquet or CSV file</h1>
    <p>Files stay on this device.</p>
    <div class="row"><span class="btn primary">Open a file…</span><span class="btn">Try sample: every known asteroid</span><span class="btn">Big: 25M Gaia stars</span></div>
    <p>Loading the app…</p>
  </div></main>
</div>`;

function buildVariant(): string {
  const out = join(webDir, 'dist-placeholder');
  rmSync(out, { recursive: true, force: true });
  cpSync(join(webDir, 'dist'), out, { recursive: true });
  const html = readFileSync(join(out, 'index.html'), 'utf8')
    .replace('</head>', `${PLACEHOLDER}\n  </head>`)
    .replace('<body>', `<body>${PLACEHOLDER_BODY}`);
  // A build whose index.html no longer has these tags would make both
  // variants the same page, and every check below would pass on nothing.
  if (!html.includes('id="seiza-placeholder"') || !html.includes('PerformanceObserver')) {
    throw new Error('the placeholder was not injected: index.html has no plain <body> or </head>');
  }
  writeFileSync(join(out, 'index.html'), html);
  return 'dist-placeholder';
}

interface Run {
  variant: string;
  ttfpMs: number;
  /** The placeholder heading's Element Timing render time, or null. */
  placeholderPaintMs: number | null;
  htmlResponseEndMs: number;
  placeholderGoneAfterFrame: boolean;
}

/** Init script: keeps the Element Timing entry for the placeholder's
 *  heading (Chromium), however late the page reads it. */
function elementTiming(): void {
  const state = { paint: null as number | null };
  (globalThis as { __placeholderPaint?: typeof state }).__placeholderPaint = state;
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries() as (PerformanceEntry & { identifier?: string; renderTime?: number })[]) {
      if (entry.identifier === 'seiza-placeholder' && state.paint === null) state.paint = entry.renderTime || entry.startTime;
    }
  }).observe({ type: 'element', buffered: true });
}

async function measure(url: string, variant: string, profile: Profile): Promise<Run> {
  const browser = await chromium.launch({ channel: 'chromium' });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
    await context.addInitScript(hideDevicePixelContentBox);
    await context.addInitScript(elementTiming);
    const page = await context.newPage();
    await throttle(context, page, profile);
    await page.goto(url);
    await page.waitForFunction(() => performance.getEntriesByName('gpui:first-frame', 'mark').length > 0, null, { timeout: 120_000, polling: 50 });
    // Two frames after the mark, the observer has run.
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    return {
      variant,
      ...(await page.evaluate(() => {
        const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
        return {
          ttfpMs: performance.getEntriesByName('gpui:first-frame', 'mark')[0]!.startTime,
          placeholderPaintMs: (globalThis as { __placeholderPaint?: { paint: number | null } }).__placeholderPaint?.paint ?? null,
          htmlResponseEndMs: navigation.responseEnd,
          placeholderGoneAfterFrame: !document.getElementById('seiza-placeholder'),
        };
      })),
    };
  } finally {
    await browser.close();
  }
}

const variants = { head: 'dist', placeholder: buildVariant() };
const servers = await Promise.all(
  Object.values(variants).map((outDir, index) =>
    preview({ root: webDir, build: { outDir }, preview: { port: 4190 + index, strictPort: true }, logLevel: 'warn' }),
  ),
);
const urls = Object.fromEntries(Object.keys(variants).map((name, index) => [name, `http://localhost:${4190 + index}/`]));

const output: Record<string, unknown> = { date, label, ...machineInfo(), protocol: { viewport: '1440x900', deviceScaleFactor: 2, runs, interleaved: true } };
const failures: string[] = [];
try {
  for (const profile of flag('reference-only') ? PROFILES.slice(0, 1) : PROFILES) {
    const list: Run[] = [];
    for (let index = 0; index < runs; index++) {
      // Alternate which goes first, so neither always runs on a warmer machine.
      const order = index % 2 ? ['placeholder', 'head'] : ['head', 'placeholder'];
      for (const name of order) {
        const run = await measure(urls[name]!, name, profile);
        list.push(run);
        console.log(
          `${profile.name} ${String(index + 1).padStart(2)}/${runs} ${name.padEnd(11)} TTFP ${run.ttfpMs.toFixed(1)}  placeholder paint ${run.placeholderPaintMs?.toFixed(1) ?? '—'}  HTML ${run.htmlResponseEndMs.toFixed(1)}`,
        );
        if (name === 'placeholder') {
          const where = `${profile.name} run ${index + 1}`;
          if (run.placeholderPaintMs === null || run.placeholderPaintMs > run.ttfpMs) failures.push(`${where}: no placeholder paint before the first frame (${run.placeholderPaintMs})`);
          if (!run.placeholderGoneAfterFrame) failures.push(`${where}: placeholder still up after the first frame`);
        }
      }
    }
    const of = (name: string) => list.filter((run) => run.variant === name);
    output[profile.name] = Object.fromEntries(
      Object.keys(variants).map((name) => [
        name,
        {
          ttfpMs: summarize(of(name).map((run) => run.ttfpMs)),
          placeholderPaintMs: summarize(of(name).flatMap((run) => (run.placeholderPaintMs === null ? [] : [run.placeholderPaintMs]))),
          htmlResponseEndMs: summarize(of(name).map((run) => run.htmlResponseEndMs)),
          runs: of(name),
        },
      ]),
    );
  }
} finally {
  await Promise.all(servers.map((server) => server.close()));
  rmSync(join(webDir, 'dist-placeholder'), { recursive: true, force: true });
}

for (const profile of PROFILES) {
  const result = output[profile.name] as Record<string, { ttfpMs: unknown; placeholderPaintMs: unknown }> | undefined;
  if (result) for (const [name, r] of Object.entries(result)) console.log(`${profile.name} ${name}: TTFP ${JSON.stringify(r.ttfpMs)} placeholder paint ${JSON.stringify(r.placeholderPaintMs)}`);
}
const out = join(perfDir, 'results', `${date}-${label}.json`);
writeFileSync(out, `${JSON.stringify(output, null, 2)}\n`);
console.log(`wrote ${out}`);
if (failures.length) {
  console.error(`\nFAIL\n${failures.map((failure) => `  ${failure}`).join('\n')}`);
  process.exit(1);
}
