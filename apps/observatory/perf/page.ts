// The observatory's page on its release build (`just observatory build`),
// with both contenders' builds in its frames, Chromium, the protocol's page
// (1440×900, DPR 2). Its own budgets, and how it hosts the contenders.
//
// Measured, cold, median of --runs per profile (reference and throttled;
// budgets on the reference run), at /observatory/tall-table/:
// - first paint: the paint timing entry (`first-paint`; the page is HTML
//   and CSS, so the browser's own metric is the page's), and FCP beside it;
// - first-paint JS: the entries and their static imports, brotli, from the
//   build manifest (the metrics module must not be among them).
//
// Checked on every run: nothing but the HTML, the CSS, the entry's chunks,
// and the font is requested before first paint; the contender's frame is
// created after it, and the metrics module requested after it.
//
// Checked once (reference): the page hydrates with no errors; the GPUI |
// TanStack toggle is disabled until the shown contender's first
// `contender:filled` (relayed by `postMessage`), then enabled; a flip
// destroys the frame (its element disconnected) and creates the other
// side's, disabled again until that one fills; `?side=tanstack` loads
// TanStack first; each frame's URL carries the page's theme; the navbar's
// toggle changes the page's theme and each contender's without reloading
// its frame (the GPUI canvas repaints: its brightness flips); the choice
// survives a reload (one `localStorage` key); /observatory/ renders the
// overview, and /observatory/tall-table/index.html hydrates as its route; a
// theme change while the frame's HTML is held back still reaches the frame
// (its load sends it again); with the data file missing, each contender
// marks `contender:failed` and the toggle unlocks, its status saying so.
//
// Usage: node apps/observatory/perf/page.ts [--runs 10] [--check] [--label <name>] [--write-baseline] [--reference-only]
// --check: reference only, fails if first paint or the first-paint JS is
// over perf/baseline.json's by more than limits.page's fractions
// (perf/budgets.json). --label writes perf/results/<date>-<label>.json
// (default `page`, unless --check). --write-baseline records both in
// perf/baseline.json, keeping its other entries. Run `just observatory
// gpui-build`, `tanstack-build`, and `build` first.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { chromium, type Page } from '@playwright/test';
import { brotli } from '../../../shared-web/src/brotli.ts';
import { FAST_4G, PROFILES, flag, machineInfo, option, summarize, throttle, type Profile } from '../../../shared-web/perf/protocol.ts';
import { MARKS } from '../contenders/contract.ts';
import { contenderBase, OBSERVATORY, UI_FONT } from '../contenders/paths.ts';
import { budgetLimits, pageWebDir, perfDir, problems, protocolContext, servePage } from './harness.ts';

const runs = Number(option('runs') ?? 10);
const check = flag('check');
const label = option('label') ?? (check ? null : 'page');
const PORT = 4334;
const ROUTE = `${OBSERVATORY}tall-table/`;
const dist = join(pageWebDir, 'dist');

const failures: string[] = [];
const fail = (message: string) => {
  failures.push(message);
  console.error(`  FAIL ${message}`);
};
const expect = (ok: boolean, message: string) => {
  if (!ok) fail(message);
  return ok;
};

// --- first-paint JS, from the build manifest ---

interface Chunk {
  file: string;
  isEntry?: boolean;
  imports?: string[];
  dynamicImports?: string[];
  css?: string[];
}
const manifestPath = join(dist, '.vite/manifest.json');
if (!existsSync(manifestPath)) throw new Error('no page build with a manifest: run `just observatory build` first');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, Chunk>;
// The routes' HTML names what loads first (the routes share one chunk, so
// the manifest lists no HTML entry): each script and module preload, and
// what those import statically.
const keyOf = new Map(Object.entries(manifest).map(([key, chunk]) => [chunk.file, key]));
const firstPaintKeys = new Set<string>();
const visit = (key: string) => {
  if (firstPaintKeys.has(key)) return;
  firstPaintKeys.add(key);
  for (const imported of manifest[key]?.imports ?? []) visit(imported);
};
for (const html of ['index.html', 'tall-table/index.html']) {
  const loaded = [...readFileSync(join(dist, html), 'utf8').matchAll(/<(?:script[^>]*\ssrc|link[^>]*rel="modulepreload"[^>]*\shref)="([^"]+)"/g)].map((match) => match[1]!.slice(OBSERVATORY.length));
  if (!loaded.length) throw new Error(`${html} loads no script`);
  for (const file of loaded) {
    const key = keyOf.get(file);
    if (!key) throw new Error(`${html} loads ${file}, which the manifest doesn't list`);
    visit(key);
  }
}
const firstPaintFiles = [...firstPaintKeys].map((key) => manifest[key]!.file).filter((file) => file.endsWith('.js'));
const kib = (bytes: number) => Math.round((bytes / 1024) * 10) / 10;
const brotliKiB = (files: string[]) => kib(files.reduce((total, file) => total + brotli(readFileSync(join(dist, file))).byteLength, 0));
const firstPaintJsBrotliKiB = brotliKiB(firstPaintFiles);
const metricsChunk = Object.entries(manifest).find(([key]) => key.endsWith('metrics/metrics.ts'))?.[1];
expect(!!metricsChunk, 'the build has no chunk of its own for the metrics module');
expect(!!metricsChunk && !firstPaintFiles.includes(metricsChunk.file), 'the metrics module is in the first-paint JS');
const cssFiles = [...new Set([...firstPaintKeys].flatMap((key) => manifest[key]!.css ?? []))];
console.log(`first-paint JS ${firstPaintJsBrotliKiB} KiB brotli (${firstPaintFiles.map((file) => basename(file)).join(', ')}); CSS ${brotliKiB(cssFiles)} KiB`);

// --- cold runs ---

/** Records when the page's first frame element is created, in the page's
 *  clock, before anything of the page's runs. */
function frameRecorder(): void {
  const recorded = ((globalThis as { __frames?: number[] }).__frames = [] as number[]);
  new MutationObserver((mutations) => {
    for (const mutation of mutations) for (const node of mutation.addedNodes) if (node instanceof HTMLIFrameElement) recorded.push(performance.now());
  }).observe(document, { childList: true, subtree: true });
}

/** The contender marks relayed to the page, as they arrive. */
function markRecorder(): void {
  const recorded: { name: string; at: number; source: string }[] = [];
  (globalThis as { __relayed?: typeof recorded }).__relayed = recorded;
  addEventListener('message', (event) => {
    if (event.origin !== location.origin || event.data?.seiza !== 'mark') return;
    const frame = [...document.querySelectorAll('iframe')].find((frame) => frame.contentWindow === event.source);
    recorded.push({ name: event.data.name, at: performance.now(), source: frame?.src ?? 'unknown' });
  });
}

interface Run {
  firstPaintMs: number;
  fcpMs: number | null;
  frameCreatedMs: number | null;
  metricsRequestedMs: number | null;
  problems: string[];
}

/** The paths first paint may wait on. */
const mayPrecedePaint = (path: string) => path === ROUTE || path === UI_FONT || [...firstPaintFiles, ...cssFiles].some((file) => path === `${OBSERVATORY}${file}`);

async function measure(url: string, profile: Profile): Promise<Run> {
  const browser = await chromium.launch({ channel: 'chromium' });
  try {
    const context = await protocolContext(browser, { init: [frameRecorder] });
    const page = await context.newPage();
    const found = problems(page);
    await throttle(context, page, profile);
    await page.goto(url);
    await page.waitForFunction(() => (globalThis as { __frames?: number[] }).__frames?.length, null, { timeout: 60_000 });
    await page.waitForFunction(() => performance.getEntriesByType('resource').some((entry) => /\/assets\/metrics-[\w-]+\.js$/.test(entry.name)), null, { timeout: 60_000 });
    const timing = await page.evaluate(() => ({
      firstPaint: performance.getEntriesByName('first-paint')[0]?.startTime ?? null,
      fcp: performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null,
      frame: (globalThis as { __frames?: number[] }).__frames?.[0] ?? null,
      resources: performance.getEntriesByType('resource').map((entry) => ({ path: new URL(entry.name).pathname, start: entry.startTime })),
    }));
    if (timing.firstPaint === null) throw new Error('no first-paint entry');
    const run: Run = {
      firstPaintMs: timing.firstPaint,
      fcpMs: timing.fcp,
      frameCreatedMs: timing.frame,
      metricsRequestedMs: timing.resources.find(({ path }) => /\/assets\/metrics-[\w-]+\.js$/.test(path))?.start ?? null,
      problems: found,
    };
    const early = timing.resources.filter(({ path, start }) => start < timing.firstPaint! && !mayPrecedePaint(path));
    if (early.length) run.problems.push(`requested before first paint: ${early.map(({ path }) => path).join(', ')}`);
    if (run.frameCreatedMs === null || run.frameCreatedMs < run.firstPaintMs) run.problems.push(`the frame was created at ${run.frameCreatedMs} ms, before first paint (${run.firstPaintMs.toFixed(1)} ms)`);
    if (run.metricsRequestedMs === null || run.metricsRequestedMs < run.firstPaintMs) run.problems.push(`the metrics module was requested at ${run.metricsRequestedMs} ms, before first paint`);
    await context.close();
    return run;
  } finally {
    await browser.close();
  }
}

// --- hosting, once ---

const groupDisabled = (page: Page) => page.locator('[aria-label="Contender"]').evaluate((group) => group.hasAttribute('data-disabled'));
const frameSrc = (page: Page) => page.locator('iframe').evaluate((frame: HTMLIFrameElement) => new URL(frame.src).pathname + new URL(frame.src).search);
const relayed = (page: Page) => page.evaluate(() => (globalThis as unknown as { __relayed: { name: string; at: number; source: string }[] }).__relayed);
/** Waits for the shown frame (`base`) to relay its first `filled`. */
const waitFilled = (page: Page, base: string) =>
  page.waitForFunction(
    ({ base, filled }) => (globalThis as unknown as { __relayed: { name: string; source: string }[] }).__relayed.some((mark) => mark.name === filled && new URL(mark.source).pathname === base),
    { base, filled: MARKS.filled },
    { timeout: 60_000 },
  );
/** The mean brightness (0–255) of the frame's middle, from a screenshot. */
async function brightness(page: Page): Promise<number> {
  const box = (await page.locator('iframe').boundingBox())!;
  const png = await page.screenshot({ clip: { x: box.x + box.width * 0.25, y: box.y + box.height * 0.25, width: box.width * 0.5, height: box.height * 0.5 } });
  return page.evaluate(async (data) => {
    const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${data}`)).blob());
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d')!;
    context.drawImage(bitmap, 0, 0);
    const { data: pixels } = context.getImageData(0, 0, bitmap.width, bitmap.height);
    let sum = 0;
    for (let i = 0; i < pixels.length; i += 4) sum += (pixels[i]! + pixels[i + 1]! + pixels[i + 2]!) / 3;
    return sum / (pixels.length / 4);
  }, png.toString('base64'));
}

async function hosting(url: string): Promise<Record<string, unknown>> {
  const browser = await chromium.launch({ channel: 'chromium' });
  const out: Record<string, unknown> = {};
  const gpui = contenderBase('tall-table', 'gpui');
  const tanstack = contenderBase('tall-table', 'tanstack');
  try {
    const context = await protocolContext(browser, { init: [markRecorder] });
    const page = await context.newPage();
    const found = problems(page);
    await page.goto(url);
    await page.waitForSelector('iframe');
    const theme = await page.evaluate(() => (document.documentElement.classList.contains('dark') ? 'dark' : 'light'));
    const src = await frameSrc(page);
    expect(src === `${gpui}?theme=${theme}`, `the first frame is GPUI's with the page's theme: ${src}`);
    expect(await groupDisabled(page), 'the toggle is enabled before GPUI has filled');
    await waitFilled(page, gpui);
    await page.waitForFunction(() => !document.querySelector('[aria-label="Contender"]')?.hasAttribute('data-disabled'), null, { timeout: 5_000 }).catch(() => fail("the toggle stays disabled after GPUI's filled mark"));
    console.log(`toggle: disabled until GPUI filled, then enabled`);

    // The theme, live: the page's, then each contender's, no reload.
    const before = await brightness(page);
    const origin = await page.frameLocator('iframe').locator(':root').evaluate(() => performance.timeOrigin);
    await page.locator('[data-site-theme-toggle]').click();
    const flipped = theme === 'dark' ? 'light' : 'dark';
    expect((await page.evaluate(() => document.documentElement.classList.contains('dark'))) === (flipped === 'dark'), "the navbar's toggle didn't change the page's theme");
    await page.frameLocator('iframe').locator(`:root[data-theme="${flipped}"]`).waitFor({ state: 'attached', timeout: 5_000 }).catch(() => fail(`GPUI's frame didn't take data-theme=${flipped}`));
    await page.waitForTimeout(300);
    const after = await brightness(page);
    expect(flipped === 'dark' ? after < before - 60 : after > before + 60, `GPUI's canvas didn't repaint in the ${flipped} theme: brightness ${before.toFixed(0)} → ${after.toFixed(0)}`);
    expect((await page.frameLocator('iframe').locator(':root').evaluate(() => performance.timeOrigin)) === origin, "the theme change reloaded GPUI's frame");
    out.theme = { from: theme, to: flipped, gpuiBrightness: [Math.round(before), Math.round(after)] };
    console.log(`theme: ${theme} → ${flipped}; GPUI's canvas ${before.toFixed(0)} → ${after.toFixed(0)}, same frame`);

    // A flip: the frame destroyed, the other side's created, disabled until it fills.
    const old = await page.locator('iframe').elementHandle();
    await page.getByRole('button', { name: 'TanStack' }).click();
    await page.waitForFunction((tanstack) => new URL(document.querySelector('iframe')?.src ?? 'x:').pathname === tanstack, tanstack, { timeout: 5_000 });
    expect(!(await old!.evaluate((frame) => frame.isConnected)), 'the GPUI frame is still in the document after the flip');
    expect((await frameSrc(page)) === `${tanstack}?theme=${flipped}`, `TanStack's frame URL: ${await frameSrc(page)}`);
    expect(await groupDisabled(page), 'the toggle is enabled before TanStack has filled');
    expect(new URL(page.url()).searchParams.get('side') === 'tanstack', `the URL after the flip: ${page.url()}`);
    await waitFilled(page, tanstack);
    await page.waitForFunction(() => !document.querySelector('[aria-label="Contender"]')?.hasAttribute('data-disabled'), null, { timeout: 5_000 }).catch(() => fail("the toggle stays disabled after TanStack's filled mark"));
    console.log('flip: GPUI frame destroyed, TanStack frame created, disabled until it filled');

    // TanStack takes the theme live too.
    await page.locator('[data-site-theme-toggle]').click();
    await page.frameLocator('iframe').locator(`:root[data-theme="${theme}"]`).waitFor({ state: 'attached', timeout: 5_000 }).catch(() => fail(`TanStack's frame didn't take data-theme=${theme}`));
    const background = await page.frameLocator('iframe').locator('body').evaluate((body) => getComputedStyle(body).backgroundColor);
    expect(background === (theme === 'dark' ? 'rgb(10, 10, 10)' : 'rgb(255, 255, 255)'), `TanStack's background in the ${theme} theme: ${background}`);
    console.log(`TanStack: data-theme ${theme}, background ${background}`);

    // The choice survives a reload; ?side= picks the first side.
    await page.reload();
    await page.waitForSelector('iframe');
    expect((await frameSrc(page)) === `${tanstack}?theme=${theme}`, `after a reload (?side=tanstack, the stored theme): ${await frameSrc(page)}`);
    console.log(`reload: ?side=tanstack loads TanStack first, theme ${theme} kept`);
    expect(found.length === 0, `page problems: ${found.join('; ')}`);
    out.relayed = (await relayed(page)).length;

    const overview = await context.newPage();
    const overviewProblems = problems(overview);
    await overview.goto(new URL(OBSERVATORY, url).href);
    expect((await overview.locator(`a[href="${ROUTE}"]`).count()) >= 2, 'the overview lists the tall table (nav and card)');
    expect((await overview.locator('iframe').count()) === 0, 'the overview has a frame');
    expect(overviewProblems.length === 0, `overview problems: ${overviewProblems.join('; ')}`);

    // The route the HTML was rendered for hydrates, whatever URL served it.
    const indexPage = await context.newPage();
    const indexProblems = problems(indexPage);
    await indexPage.goto(new URL(`${ROUTE}index.html`, url).href);
    await indexPage.waitForSelector('iframe', { timeout: 10_000 }).catch(() => fail(`${ROUTE}index.html hydrated without the comparison's frame`));
    expect(indexProblems.length === 0, `${ROUTE}index.html problems: ${indexProblems.join('; ')}`);
    console.log(`${ROUTE}index.html: hydrated as the tall table's route`);
    await context.close();
  } finally {
    await browser.close();
  }

  // A theme change while the frame is loading: the frame's HTML is held
  // until the toggle is pressed, so the message finds no listener; the
  // frame's load sends the theme again.
  {
    const browser = await chromium.launch({ channel: 'chromium' });
    try {
      const context = await protocolContext(browser);
      const page = await context.newPage();
      let release!: () => void;
      const released = new Promise<void>((resolve) => (release = resolve));
      await page.route((target) => target.pathname === gpui, async (route) => {
        await released;
        await route.continue();
      });
      await page.goto(url);
      await page.waitForSelector('iframe');
      const before = await page.evaluate(() => (document.documentElement.classList.contains('dark') ? 'dark' : 'light'));
      const after = before === 'dark' ? 'light' : 'dark';
      await page.locator('[data-site-theme-toggle]').click();
      release();
      await page
        .frameLocator('iframe')
        .locator(`:root[data-theme="${after}"]`)
        .waitFor({ state: 'attached', timeout: 15_000 })
        .then(() => console.log(`theme while loading: ${before} → ${after} before the frame loaded; the frame took ${after} at its load`))
        .catch(() => fail(`a theme change while the frame loaded was lost: the frame isn't ${after}`));
      await context.close();
    } finally {
      await browser.close();
    }
  }

  // A contender that fails (the data file 404s) unlocks the toggle, on both sides.
  {
    const browser = await chromium.launch({ channel: 'chromium' });
    try {
      const context = await protocolContext(browser, { init: [markRecorder] });
      const page = await context.newPage();
      await page.route((target) => target.pathname.startsWith(`${OBSERVATORY}data/`), (route) => route.fulfill({ status: 404, body: 'Not found' }));
      await page.goto(url);
      for (const [side, label] of [[gpui, 'GPUI'], [tanstack, 'TanStack']] as const) {
        if (side === tanstack) await page.getByRole('button', { name: 'TanStack' }).click();
        await page
          .waitForFunction(
            ({ side, failed }) => (globalThis as unknown as { __relayed: { name: string; source: string }[] }).__relayed.some((mark) => mark.name === failed && new URL(mark.source).pathname === side),
            { side, failed: MARKS.failed },
            { timeout: 60_000 },
          )
          .catch(() => fail(`${label}: no contender:failed with the data file missing`));
        await page.waitForFunction(() => !document.querySelector('[aria-label="Contender"]')?.hasAttribute('data-disabled'), null, { timeout: 5_000 }).catch(() => fail(`${label}: the toggle stays disabled after it failed`));
        const status = await page.locator('[aria-live="polite"]').textContent();
        expect(!!status?.includes("didn't load its data"), `${label}: the status after a failure: ${status}`);
        console.log(`failure: ${label} marked contender:failed with the data file missing; the toggle enabled, the status says so`);
      }
      await context.close();
    } finally {
      await browser.close();
    }
  }
  return out;
}

// --- the runs ---

const server = await servePage(PORT);
const profiles = check || flag('reference-only') ? PROFILES.slice(0, 1) : PROFILES;
const results: Record<string, { runs: Run[]; firstPaintMs: ReturnType<typeof summarize>; fcpMs: ReturnType<typeof summarize> }> = {};
let hosted: Record<string, unknown> = {};
try {
  const url = new URL(ROUTE, server.url).href;
  hosted = await hosting(url);
  for (const profile of profiles) {
    const profileRuns: Run[] = [];
    for (let i = 0; i < runs; i++) {
      const run = await measure(url, profile);
      profileRuns.push(run);
      console.log(
        `${profile.name} ${String(i + 1).padStart(2)}/${runs}  first paint ${run.firstPaintMs.toFixed(1)} ms  FCP ${run.fcpMs?.toFixed(1) ?? '—'} ms  frame ${run.frameCreatedMs?.toFixed(1) ?? '—'} ms  metrics ${run.metricsRequestedMs?.toFixed(1) ?? '—'} ms` +
          (run.problems.length ? `  PROBLEMS: ${run.problems.join('; ')}` : ''),
      );
      for (const problem of run.problems) fail(`${profile.name} run ${i + 1}: ${problem}`);
    }
    results[profile.name] = {
      runs: profileRuns,
      firstPaintMs: summarize(profileRuns.map((run) => run.firstPaintMs)),
      fcpMs: summarize(profileRuns.flatMap((run) => (run.fcpMs === null ? [] : [run.fcpMs]))),
    };
  }
} finally {
  await server.close();
}

const date = new Date().toISOString().slice(0, 10);
const firstPaintMs = Object.fromEntries(Object.entries(results).map(([name, result]) => [name, result.firstPaintMs?.median ?? null]));
for (const [name, result] of Object.entries(results)) console.log(`${name}: first paint ${JSON.stringify(result.firstPaintMs)} ms, FCP ${JSON.stringify(result.fcpMs)} ms`);
if (label) {
  const out = join(perfDir, 'results', `${date}-${label}.json`);
  mkdirSync(join(perfDir, 'results'), { recursive: true });
  const summary = {
    date,
    label,
    ...machineInfo(),
    page: ROUTE,
    protocol: { viewport: '1440x900', deviceScaleFactor: 2, runs, throttled: { cpuSlowdown: 4, network: 'Fast 4G', ...FAST_4G } },
    firstPaintJsBrotliKiB,
    firstPaintMs,
    fcpMs: Object.fromEntries(Object.entries(results).map(([name, result]) => [name, result.fcpMs?.median ?? null])),
    hosting: hosted,
    runs: Object.fromEntries(Object.entries(results).map(([name, result]) => [name, result.runs])),
    failures,
  };
  writeFileSync(out, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`wrote ${out}`);
}

const baselinePath = join(perfDir, 'baseline.json');
interface Baseline {
  /** Its own date and machine: the file's top-level ones are the GPUI
   *  contender's cold run (`cold.ts`). */
  page?: { date: string; machine: string; firstPaintMs: { reference: number; throttled: number }; firstPaintJsBrotliKiB: number };
  [key: string]: unknown;
}
const baseline = JSON.parse(readFileSync(baselinePath, 'utf8')) as Baseline;
if (flag('write-baseline')) {
  const { reference, throttled } = firstPaintMs;
  if (reference == null || throttled == null) throw new Error('--write-baseline needs both profiles');
  baseline.page = { date, machine: machineInfo().machine, firstPaintMs: { reference, throttled }, firstPaintJsBrotliKiB };
  writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
  console.log(`wrote ${baselinePath}`);
}
if (check) {
  const { firstPaintOverBaseline, firstPaintJsOverBaseline } = budgetLimits(new URL('./budgets.json', import.meta.url))('page', ['firstPaintOverBaseline', 'firstPaintJsOverBaseline']);
  const base = baseline.page;
  if (!base) throw new Error('perf/baseline.json has no page entry: run with --write-baseline');
  for (const [what, value, was, fraction, unit] of [
    ['first paint (reference)', firstPaintMs.reference ?? Infinity, base.firstPaintMs.reference, firstPaintOverBaseline, 'ms'],
    ['first-paint JS', firstPaintJsBrotliKiB, base.firstPaintJsBrotliKiB, firstPaintJsOverBaseline, 'KiB'],
  ] as const) {
    const limit = was * (1 + fraction);
    console.log(`budget: ${what} ${value} ${unit} vs limit ${limit.toFixed(1)} ${unit} (baseline ${was} + ${fraction * 100}%)`);
    if (value > limit) fail(`${what} ${value} ${unit} is over its budget, ${limit.toFixed(1)} ${unit}`);
  }
}
if (failures.length) {
  console.error(`\nFAIL\n${failures.map((problem) => `  ${problem}`).join('\n')}`);
  process.exit(1);
}
console.log('PASS');
