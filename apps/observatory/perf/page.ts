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
// The dashboard, checked once: the site's bar and every box in it the same
// on /observatory/ and the comparison, with the sidebar open or collapsed,
// desktop and phone, at the window's width; a reload with the sidebar
// stored collapsed paints the inset where it hydrates (the page's JS held
// back until measured), and without the sidebar's head script (the
// control) it moves; on a desktop the sidebar is 240 px at the window's
// edge, the contender's card ends 16 px above the window's bottom with the
// frame at least 480 px, and the toggle collapses it, kept across a
// reload; a phone starts closed, opens over the content with a scrim,
// stores nothing, and closes on the scrim and Escape; every press control
// shows `cursor: pointer`.
//
// The window's numbers, checked once (`readouts`): the status bar's box in
// the HTML and the frame unmoved when its numbers render (control: without
// the box it moves), this tab's readings, the explainers, the panel's cold
// values and verdicts against perf/results/, the description's wins, and a
// phone's status bar.
//
// Usage: node apps/observatory/perf/page.ts [--runs 10] [--check] [--label <name>] [--write-baseline] [--reference-only] [--shots <dir>] [--url <origin>]
// --shots: screenshots of the comparison, light and dark, desktop (open,
// collapsed) and phone (closed, open), into <dir>.
// --check: reference only, fails if first paint or the first-paint JS is
// over perf/baseline.json's by more than limits.page's fractions
// (perf/budgets.json). --label writes perf/results/<date>-<label>.json
// (default `page`, unless --check). --write-baseline records both in
// perf/baseline.json, keeping its other entries. --url: production (e.g.
// https://seiza.io): the hosting checks (each frame cross-origin isolated
// among them) and the cold runs, recorded only, never against a budget
// (default label `page-production`); the layout, the readouts, and the
// meter are the build's, checked locally. Run `just observatory
// gpui-build`, `tanstack-build`, and `build` first.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { chromium, type Browser, type Page } from '@playwright/test';
import { brotli } from '../../../shared-web/src/brotli.ts';
import { FAST_4G, PROFILES, flag, hideDevicePixelContentBox, machineInfo, option, summarize, throttle, type Profile } from '../../../shared-web/perf/protocol.ts';
import { MARKS } from '../contenders/contract.ts';
import { contenderBase, OBSERVATORY, UI_FONT } from '../contenders/paths.ts';
import { wheel } from '../../../shared-web/perf/harness.ts';
import { resolveCold } from '../web/cold.ts';
import { BARS, CARDS, PROFILES as DEVICE_PROFILES, cardOutcome, cardValues, downloadTotal, evenSentence, number, outcome, size, verdict, wins, winsSentence } from '../web/src/readouts.ts';
import { METER_KEY } from '../web/src/meter.ts';
import { SIDEBAR_KEY, SIDEBAR_SCRIM, SIDEBAR_SCRIPT, SIDEBAR_TOGGLE } from '../web/src/sidebar.ts';
import { budgetLimits, pageWebDir, perfDir, problems, protocolContext, servePage } from './harness.ts';

const runs = Number(option('runs') ?? 10);
const check = flag('check');
const given = option('url');
if (given && (check || flag('write-baseline'))) throw new Error('--url records production; budgets and the baseline are the local build\'s');
const label = option('label') ?? (check ? null : given ? 'page-production' : 'page');
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
// With --url, the first-paint set is still the local build's (its manifest),
// so production must serve that build: the same scripts in each route's HTML.
if (given)
  for (const html of ['index.html', 'tall-table/index.html']) {
    const scripts = (text: string) => [...text.matchAll(/<(?:script[^>]*\ssrc|link[^>]*rel="modulepreload"[^>]*\shref)="([^"]+)"/g)].map((match) => match[1]).join(' ');
    const served = await (await fetch(new URL(`${OBSERVATORY}${html}`, given))).text();
    if (scripts(served) !== scripts(readFileSync(join(dist, html), 'utf8'))) throw new Error(`production's ${html} loads other scripts than the local build's: deploy this build, or rebuild what's deployed`);
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
    // The live memory reading and the engine's read counter need it.
    const isolated = { page: await page.evaluate(() => crossOriginIsolated), gpui: await page.frameLocator('iframe').locator(':root').evaluate(() => crossOriginIsolated), tanstack: false };

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
    isolated.tanstack = await page.frameLocator('iframe').locator(':root').evaluate(() => crossOriginIsolated);
    for (const [where, ok] of Object.entries(isolated)) expect(ok, `${where} isn't cross-origin isolated`);
    out.crossOriginIsolated = isolated;
    console.log(`cross-origin isolated: page ${isolated.page}, GPUI's frame ${isolated.gpui}, TanStack's frame ${isolated.tanstack}`);

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
      // Not `load`: over a real network the frame is created before the
      // page's load event, which would then wait on the held frame.
      await page.goto(url, { waitUntil: 'domcontentloaded' });
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

// --- the dashboard's layout, once ---

const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };

/** A context at `viewport` with the stored sidebar state (`closed`, or none)
 *  and theme; a phone's has touch. */
async function layoutContext(browser: Browser, viewport: { width: number; height: number }, stored: { sidebar?: 'closed'; theme?: 'light' | 'dark' } = {}) {
  const phone = viewport.width < 768;
  const context = await browser.newContext({ viewport, deviceScaleFactor: phone ? 3 : 2, isMobile: phone, hasTouch: phone });
  await context.addInitScript(hideDevicePixelContentBox);
  await context.addInitScript(
    ({ key, sidebar, theme }) => {
      if (sessionStorage.getItem('seeded')) return;
      sessionStorage.setItem('seeded', '1');
      if (sidebar) localStorage.setItem(key, sidebar);
      if (theme) localStorage.setItem('seiza-theme', theme);
    },
    { key: SIDEBAR_KEY, ...stored },
  );
  return context;
}

/** The site's bar and every box inside it: tag, x, y, width, height. */
const barBoxes = (page: Page) =>
  page
    .locator('header')
    .first()
    .evaluate((bar) => [bar, ...bar.querySelectorAll('*')].map((element) => { const box = element.getBoundingClientRect(); return [element.tagName, box.x, box.y, box.width, box.height].join(' '); }));

const box = (page: Page, selector: string) => page.locator(selector).evaluate((element) => { const { x, y, width, height } = element.getBoundingClientRect(); return { x, y, width, height }; });
const shown = (page: Page, selector: string) => page.locator(selector).evaluate((element) => getComputedStyle(element).display !== 'none');
const hydrated = (page: Page) => page.waitForFunction((toggle) => document.querySelector(`[${toggle}]`)?.hasAttribute('aria-expanded'), SIDEBAR_TOGGLE, { timeout: 15_000 });

/**
 * The inset's box as the HTML and CSS alone paint it (the page's JS held
 * back), and after it hydrates, at a desktop with the sidebar stored
 * closed. With `strip`, the HTML loses the sidebar's head script: the
 * control, which must shift.
 */
async function insetAtPaintAndHydrated(browser: Browser, url: string, strip: boolean) {
  const context = await layoutContext(browser, DESKTOP, { sidebar: 'closed' });
  const page = await context.newPage();
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  await page.route((target) => target.pathname.startsWith(`${OBSERVATORY}assets/`) && target.pathname.endsWith('.js'), async (route) => {
    await released;
    await route.continue();
  });
  if (strip)
    await page.route((target) => target.pathname === ROUTE, async (route) => {
      const response = await route.fetch();
      const html = await response.text();
      if (!html.includes(SIDEBAR_SCRIPT)) fail("the control: the route's HTML doesn't hold the sidebar's script");
      await route.fulfill({ response, body: html.replace(SIDEBAR_SCRIPT, '') });
    });
  await page.goto(url, { waitUntil: 'commit' });
  await page.waitForFunction(() => document.querySelector('.observatory-inset') && [...document.styleSheets].some((sheet) => sheet.href?.includes('/assets/')));
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const atPaint = await box(page, '.observatory-inset');
  release();
  await hydrated(page);
  const after = await box(page, '.observatory-inset');
  await context.close();
  return { atPaint, hydrated: after };
}

/** A status bar segment's reading (its last span: the live text). */
const segment = (page: Page, key: string) => page.locator(`[data-segment="${key}"] > span:last-child`).textContent();
/** The open explainers' popovers. */
const popovers = (page: Page) => page.locator('[data-explainer]');
const expanded = (page: Page, selector: string) => page.locator(selector).getAttribute('aria-expanded');

/**
 * Counts mutations under `selector` while `during` runs, those under
 * `ignore` apart: their times, page clock.
 */
async function mutations(page: Page, selector: string, during: () => Promise<void>, ignore = ''): Promise<number[]> {
  const key = `__mutations${Math.random().toString(36).slice(2)}`;
  await page.evaluate(
    ({ selector, ignore, key }) => {
      const counted = ((globalThis as unknown as Record<string, number[]>)[key] = [] as number[]);
      new MutationObserver((records) => {
        if (records.some((record) => !ignore || !(record.target instanceof Element ? record.target : record.target.parentElement)?.closest(ignore))) counted.push(performance.now());
      }).observe(document.querySelector(selector)!, { subtree: true, childList: true, characterData: true, attributes: true });
    },
    { selector, ignore, key },
  );
  await during();
  return page.evaluate((key) => (globalThis as unknown as Record<string, number[]>)[key]!.splice(0), key);
}

/**
 * The stage's box (the frame's) as the HTML and CSS alone paint it (the
 * page's JS held back), and once the status bar's numbers have rendered.
 * With `strip`, the HTML loses the status bar's reserved box (its class):
 * the control, which must shift.
 */
async function stageAtPaintAndFilled(browser: Browser, url: string, strip: boolean) {
  const context = await layoutContext(browser, DESKTOP);
  const page = await context.newPage();
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  await page.route((target) => target.pathname.startsWith(`${OBSERVATORY}assets/`) && target.pathname.endsWith('.js'), async (route) => {
    await released;
    await route.continue();
  });
  if (strip)
    await page.route((target) => target.pathname === ROUTE, async (route) => {
      const response = await route.fetch();
      const html = await response.text();
      if (!html.includes('class="observatory-status"')) fail("the control: the route's HTML doesn't hold the status bar's box");
      await route.fulfill({ response, body: html.replace('class="observatory-status"', '') });
    });
  await page.goto(url, { waitUntil: 'commit' });
  await page.waitForFunction(() => document.querySelector('[data-stage]') && [...document.styleSheets].some((sheet) => sheet.href?.includes('/assets/')));
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const atPaint = await box(page, '[data-stage]');
  release();
  await page.waitForSelector('[data-status-ready]', { timeout: 30_000 });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const filled = await box(page, '[data-stage]');
  await context.close();
  return { atPaint, filled };
}

/** The frame's window got a press and a wheel at a point under the meter. */
async function reachesFrame(page: Page, at: { x: number; y: number }): Promise<{ hit: string; got: string[] }> {
  await page.frameLocator('iframe').locator(':root').evaluate(() => {
    const got = ((globalThis as unknown as { __got: string[] }).__got = [] as string[]);
    for (const type of ['pointerdown', 'wheel']) addEventListener(type, (event) => got.push(event.type), { capture: true, passive: true });
  });
  const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName ?? '', at);
  await page.mouse.click(at.x, at.y);
  await page.mouse.wheel(0, 200);
  await page.waitForTimeout(100);
  const got = await page.frameLocator('iframe').locator(':root').evaluate(() => (globalThis as unknown as { __got: string[] }).__got);
  return { hit, got: [...new Set(got)] };
}

/** The frame-time canvas's pixels: drawn, and amber (a late bar's) or not. */
const framePixels = (page: Page) =>
  page.locator('[data-meter-frames]').evaluate((canvas: HTMLCanvasElement) => {
    const { data } = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
    let drawn = 0;
    let amber = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (!data[i + 3]) continue;
      drawn++;
      // The amber is opaque; the on-time bars a translucent gray.
      if (data[i + 3]! > 200 && data[i]! - data[i + 2]! > 80) amber++;
    }
    return { drawn, amber };
  });

/** A scroll under way with one long task (80 ms) in it: a late frame. */
async function scrollWithLateFrame(page: Page): Promise<string> {
  const frame = (await page.locator('iframe').boundingBox())!;
  await page.mouse.move(frame.x + frame.width / 3, frame.y + frame.height / 2);
  let fps = '';
  for (let i = 0; i < 40; i++) {
    await wheel(page, 300);
    await page.waitForTimeout(16);
    if (i === 20) await page.evaluate(() => { const start = performance.now(); while (performance.now() - start < 80); });
    if (i === 30) fps = (await page.locator('[data-meter-fps]').textContent()) ?? '';
  }
  await page.waitForTimeout(800);
  return fps;
}

/** Drags the meter's header to `to` (page px) in steps. */
async function dragMeter(page: Page, to: { x: number; y: number }): Promise<void> {
  const handle = (await page.locator('[data-meter-handle]').boundingBox())!;
  await page.mouse.move(handle.x + 40, handle.y + handle.height / 2);
  await page.mouse.down();
  const from = { x: handle.x + 40, y: handle.y + handle.height / 2 };
  for (let step = 1; step <= 12; step++) await page.mouse.move(from.x + ((to.x - from.x) * step) / 12, from.y + ((to.y - from.y) * step) / 12);
  await page.mouse.up();
  await page.waitForTimeout(100);
}

const corner = (page: Page) => page.locator('[data-meter]').getAttribute('data-corner');
const meterMode = async (page: Page) => ((await page.locator('[data-meter]').count()) ? page.locator('[data-meter]').getAttribute('data-meter') : 'off');

/**
 * The meter: open in the bottom right by default on a desktop, a pill on
 * a phone; a press and a wheel under its graphs reach each contender's
 * frame (control: the meter taking the pointer); its frame graph drawn
 * after a scroll, a late frame (a long task mid-scroll) amber on both
 * sides, FPS while scrolling and "idle" at rest; the drag snaps to the
 * nearest corner across the frame, its outlines shown (control: without
 * pointer capture the drop is lost to the frame); the picker and the arrow
 * keys move it, Esc closes the picker with focus kept; its corner and mode
 * kept over a reload; the pill, hidden, and the status bar's Meter; hidden
 * while the panel is open.
 */
async function meter(url: string): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  const browser = await chromium.launch({ channel: 'chromium', args: ['--enable-blink-features=ForceEagerMeasureMemory'] });
  try {
    const context = await layoutContext(browser, DESKTOP);
    await context.addInitScript(markRecorder);
    const page = await context.newPage();
    const found = problems(page);
    await page.goto(url);
    await waitFilled(page, contenderBase('tall-table', 'gpui'));
    await page.locator('[data-meter]').waitFor({ timeout: 10_000 }).catch(() => fail("the meter didn't show on a desktop"));
    expect((await meterMode(page)) === 'open' && (await corner(page)) === 'br', `a desktop's meter starts ${await meterMode(page)} at ${await corner(page)}, not open at br`);
    expect((await page.locator('[data-meter-toggle]').getAttribute('aria-pressed')) === 'true', "the status bar's Meter isn't pressed with the meter shown");
    const stage = await box(page, '[data-stage]');
    const layer = await box(page, '[data-meter]');
    expect(Math.round(stage.x + stage.width - layer.x - layer.width) === 12 && Math.round(stage.y + stage.height - layer.y - layer.height) === 12, `the meter isn't 12 px from the frame's bottom right: ${JSON.stringify(layer)} in ${JSON.stringify(stage)}`);

    // Under its graphs, the frame: a press and a wheel reach the contender.
    const plot = await box(page, '[data-meter-frames]');
    const under = { x: plot.x + plot.width / 2, y: plot.y + plot.height / 2 };
    const sides: Record<string, unknown> = {};
    const reach = async (side: string) => {
      const reached = await reachesFrame(page, under);
      expect(reached.hit === 'IFRAME' && reached.got.includes('pointerdown') && reached.got.includes('wheel'), `${side}: under the meter, ${reached.hit} is hit and the frame got ${JSON.stringify(reached.got)}`);
      expect((await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('[aria-label="Hide the meter"]') !== null, await (async () => { const b = await box(page, '[aria-label="Hide the meter"]'); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })())), `${side}: the meter's buttons don't take the pointer`);
      const fps = await scrollWithLateFrame(page);
      const pixels = await framePixels(page);
      const late = await page.locator('[data-meter-late]').textContent();
      expect(/^\d+ fps$/.test(fps), `${side}: FPS mid-scroll reads "${fps}"`);
      expect(pixels.drawn > pixels.amber && pixels.amber > 0 && /^[1-9]\d* late$/.test(late ?? ''), `${side}: after a late frame the graph has ${pixels.amber} amber of ${pixels.drawn} drawn pixels, "${late}"`);
      await page.waitForTimeout(600);
      expect((await page.locator('[data-meter-fps]').textContent()) === 'idle', `${side}: FPS at rest reads "${await page.locator('[data-meter-fps]').textContent()}"`);
      sides[side] = { reached: reached.got, fps, late, pixels };
    };
    await reach('GPUI');
    // The control: a meter that takes the pointer keeps the press from the frame.
    await page.locator('.observatory-meter').evaluate((element: HTMLElement) => (element.style.pointerEvents = 'auto'));
    const blocked = await reachesFrame(page, under);
    expect(!blocked.got.includes('pointerdown'), "the control (the meter taking the pointer) still let the press reach the frame: the check can't fail");
    await page.locator('.observatory-meter').evaluate((element: HTMLElement) => (element.style.pointerEvents = ''));
    // Its wheel scrolled the page, not the frame.
    await page.evaluate(() => scrollTo(0, 0));
    console.log(`meter: GPUI ${JSON.stringify(sides.GPUI)}; control: the meter taking the pointer, the frame got ${JSON.stringify(blocked.got)}`);

    // The drag: across the frame to its top left; the outlines while it moves.
    const handle = (await page.locator('[data-meter-handle]').boundingBox())!;
    await page.mouse.move(handle.x + 40, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(stage.x + stage.width / 2, stage.y + stage.height / 2, { steps: 6 });
    const slots = await page.locator('[data-meter-slot]').count();
    await page.mouse.move(stage.x + 200, stage.y + 60, { steps: 6 });
    const near = await page.locator('[data-meter-slot][data-near]').getAttribute('data-meter-slot');
    await page.mouse.up();
    await page.waitForTimeout(100);
    expect(slots === 4 && near === 'tl', `while dragged: ${slots} outlines, the nearest ${near}`);
    expect((await corner(page)) === 'tl' && !(await page.locator('[data-meter-slot]').count()), `the drag to the top left left the meter at ${await corner(page)}`);
    const atTl = await box(page, '[data-meter]');
    expect(Math.round(atTl.x - stage.x) === 12 && Math.round(atTl.y - stage.y) === 12, `snapped to the top left at ${JSON.stringify(atTl)}`);
    await dragMeter(page, { x: stage.x + stage.width - 100, y: stage.y + stage.height - 40 });
    expect((await corner(page)) === 'br', `the drag back to the bottom right left it at ${await corner(page)}`);

    // The picker and the arrow keys.
    await page.locator('[data-meter-picker]').click();
    expect((await page.locator('[data-meter-corner]').count()) === 4, "the picker didn't open with four corners");
    expect(await page.locator('[data-meter-corner="br"]').evaluate((button) => document.activeElement === button && button.getAttribute('aria-pressed') === 'true'), "the picker didn't focus its pressed corner");
    await page.keyboard.press('ArrowUp');
    expect((await corner(page)) === 'tr', `ArrowUp in the picker: ${await corner(page)}`);
    await page.keyboard.press('Escape');
    expect(!(await page.locator('[data-meter-corner]').count()) && (await page.locator('[data-meter-picker]').evaluate((button) => document.activeElement === button)), "Esc didn't close the picker with focus on its button");
    await page.keyboard.press('ArrowLeft');
    expect((await corner(page)) === 'tl', `ArrowLeft on the header: ${await corner(page)}`);
    await page.locator('[data-meter-picker]').click();
    await page.locator('[data-meter-corner="bl"]').click();
    expect((await corner(page)) === 'bl' && !(await page.locator('[data-meter-corner]').count()), `picking the bottom left: ${await corner(page)}, the picker ${(await page.locator('[data-meter-corner]').count()) ? 'open' : 'closed'}`);
    expect((await page.locator('[data-meter-picker]').getAttribute('aria-label')) === 'Meter position: bottom left', "the picker's label doesn't name the corner");

    // Kept over a reload: the corner, then the pill, then hidden.
    await page.reload();
    await page.locator('[data-meter]').waitFor();
    expect((await corner(page)) === 'bl' && (await meterMode(page)) === 'open', `after a reload: ${await meterMode(page)} at ${await corner(page)}`);
    await page.getByRole('button', { name: 'Shrink the meter to a pill' }).click();
    expect((await meterMode(page)) === 'pill', "shrinking didn't make the pill");
    await page.reload();
    await page.locator('[data-meter]').waitFor();
    expect((await meterMode(page)) === 'pill' && (await corner(page)) === 'bl', `the pill after a reload: ${await meterMode(page)} at ${await corner(page)}`);
    await page.getByRole('button', { name: 'Open the meter' }).click();
    await page.getByRole('button', { name: 'Hide the meter' }).click();
    expect((await meterMode(page)) === 'off' && (await page.locator('[data-meter-toggle]').getAttribute('aria-pressed')) === 'false', "hiding didn't hide it, or Meter stayed pressed");
    await page.reload();
    await page.locator('[data-status-ready]').waitFor();
    await page.waitForTimeout(300);
    expect((await meterMode(page)) === 'off', 'hidden, it came back after a reload');
    await page.locator('[data-meter-toggle]').click();
    expect((await meterMode(page)) === 'open', "the status bar's Meter didn't show it");

    // Hidden under the panel.
    await page.locator('[data-compare]').click();
    await page.locator('[data-card]').first().waitFor();
    expect((await meterMode(page)) === 'off', 'the meter shows over the panel');
    await page.keyboard.press('Escape');
    await page.locator('[data-meter]').waitFor({ timeout: 2_000 }).catch(() => fail("the meter didn't come back when the panel closed"));
    console.log('meter: the drag snaps across the frame (4 outlines), the picker and the arrows move it, Esc keeps focus; corner and mode kept over reloads; the pill, hidden, Meter; hidden under the panel');

    // The other side.
    await page.getByRole('group', { name: 'Contender' }).getByRole('button', { name: 'TanStack' }).click();
    await waitFilled(page, contenderBase('tall-table', 'tanstack'));
    await page.waitForFunction(() => document.querySelector('[data-meter-tag]')?.textContent === 'warm', null, { timeout: 5_000 }).catch(() => fail("TanStack's meter isn't tagged warm"));
    const tanstackPlot = await box(page, '[data-meter-frames]');
    under.x = tanstackPlot.x + tanstackPlot.width / 2;
    under.y = tanstackPlot.y + tanstackPlot.height / 2;
    await reach('TanStack');
    console.log(`meter: TanStack ${JSON.stringify(sides.TanStack)}`);
    out.sides = sides;

    // The control: without pointer capture a drag across the frame loses its drop.
    await page.evaluate(() => (Element.prototype.setPointerCapture = () => {}));
    expect((await corner(page)) === 'bl', `TanStack's meter isn't where GPUI's was left: ${await corner(page)}`);
    await dragMeter(page, { x: stage.x + stage.width - 100, y: stage.y + stage.height - 40 });
    const uncaptured = await corner(page);
    expect(uncaptured !== 'br', "the control (no pointer capture) still snapped across the frame: the check can't fail");
    console.log(`meter: control without pointer capture, the drop lost to the frame (corner ${uncaptured})`);
    expect(found.length === 0, `page problems: ${found.join('; ')}`);
    await context.close();

    // A phone starts with the pill, even with the meter stored open.
    for (const stored of [null, 'open']) {
      const phone = await layoutContext(browser, PHONE);
      if (stored) await phone.addInitScript((key) => localStorage.setItem(key, JSON.stringify({ mode: 'open', corner: 'br' })), METER_KEY);
      const small = await phone.newPage();
      await small.goto(url);
      await small.locator('[data-meter]').waitFor({ timeout: 15_000 }).catch(() => fail("a phone's meter didn't show"));
      expect((await meterMode(small)) === 'pill', `a phone (stored ${stored}) starts with the meter ${await meterMode(small)}`);
      if (!stored) {
        await small.getByRole('button', { name: 'More numbers' }).tap();
        await small.getByRole('menuitem', { name: 'Hide the meter' }).tap();
        expect((await meterMode(small)) === 'off', "the overflow's Hide the meter didn't hide it");
      }
      await phone.close();
    }
    console.log("meter: a phone starts with the pill (stored open too); the overflow hides it");
  } finally {
    await browser.close();
  }
  return out;
}

/**
 * The window's numbers and the panel. The status bar's box is in the HTML
 * and its numbers aren't, and the frame doesn't move when they render (its
 * control without the box does); this tab's readings in the status bar
 * (GPUI's usable and data its frame's own marks, Smooth "—" until a
 * scroll, then a share; memory), nothing but the memory changing while
 * nothing happens, ≤ 4 Hz while scrolling, the title bar's live text silent
 * through a scroll; Compare's panel: each card's cold values both devices
 * as perf/results/ has them, its verdict and "best" computed from them, the
 * chart's values, the header's edge once its body scrolls, Esc and close
 * returning focus to the frame; the explainers (hover, a press pins, Enter,
 * Esc keeping focus, one at a time); after a flip TanStack ready and warm,
 * GPUI's readings kept; the description's wins from the same numbers; a
 * phone's two segments and its overflow, hover opening nothing.
 */
async function readouts(url: string): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  const { numbers: cold } = resolveCold();
  const html = readFileSync(join(dist, 'tall-table/index.html'), 'utf8');
  expect(html.includes('class="observatory-status"'), "the status bar's box isn't in the prerendered HTML");
  for (const attribute of ['data-status-ready', 'data-card', 'data-description']) expect(!html.includes(attribute), `${attribute} is in the prerendered HTML: it renders after first paint`);

  // ForceEagerMeasureMemory: else the memory reading waits for a GC (up to 20 s).
  const browser = await chromium.launch({ channel: 'chromium', args: ['--enable-blink-features=ForceEagerMeasureMemory'] });
  try {
    // Nothing shifts when the numbers render; the control without the box does.
    const kept = await stageAtPaintAndFilled(browser, url, false);
    const control = await stageAtPaintAndFilled(browser, url, true);
    expect(JSON.stringify(kept.atPaint) === JSON.stringify(kept.filled), `the frame's box moved when the numbers rendered: ${JSON.stringify(kept.atPaint)} → ${JSON.stringify(kept.filled)}`);
    expect(JSON.stringify(control.atPaint) !== JSON.stringify(control.filled), "the control (no reserved box) didn't move the frame: the check can't fail");
    out.noShift = { stage: kept.filled, control: { atPaint: control.atPaint.height, filled: control.filled.height } };
    console.log(`window: the frame ${kept.atPaint.height} px at first paint and once the numbers render; control without the box ${control.atPaint.height} → ${control.filled.height}`);

    const context = await layoutContext(browser, DESKTOP);
    await context.addInitScript(markRecorder);
    const page = await context.newPage();
    const found = problems(page);
    await page.goto(url);
    const gpui = contenderBase('tall-table', 'gpui');
    await waitFilled(page, gpui);
    await page.waitForFunction(() => /^\d/.test(document.querySelector('[data-segment="data"] > span:last-child')?.textContent ?? ''), null, { timeout: 2_000 }).catch(() => fail("GPUI's Rows in didn't show within 2 s of its filled mark"));
    const marks = await page.frameLocator('iframe').locator(':root').evaluate(() => Object.fromEntries(performance.getEntriesByType('mark').map((mark) => [mark.name, mark.startTime])));
    // As shown: whole milliseconds from 100, else one decimal.
    const near = (text: string | null, ms: number) => Math.abs(parseFloat(text ?? '') - ms) <= (ms >= 100 ? 0.51 : 0.051);
    const usable = await segment(page, 'usable');
    expect(near(usable, marks[MARKS.usable]!), `GPUI's Ready in ${usable} isn't its frame's mark, ${marks[MARKS.usable]} ms`);
    const data = await segment(page, 'data');
    expect(near(data, marks[MARKS.filled]! - marks[MARKS.open]!), `GPUI's Rows in ${data} isn't its open → filled, ${marks[MARKS.filled]! - marks[MARKS.open]!} ms`);
    expect((await segment(page, 'smooth')) === '—', `Smooth before any scroll: ${await segment(page, 'smooth')}`);
    expect((await page.locator('[aria-live]').count()) === 1, 'the page has more than one aria-live text');
    const state = await page.locator('[aria-live]').textContent();
    expect(state === 'Ready · cold load', `GPUI's state: ${state}`);

    // Nothing but the memory changes while nothing happens; ~4 Hz at most
    // while something does, and the state stays silent.
    await page.waitForTimeout(1_000);
    const idle = await mutations(page, '[data-status-bar]', () => page.waitForTimeout(2_000), '[data-segment="memory"]');
    expect(idle.length === 0, `the status bar other than memory changed ${idle.length} times in 2 s with nothing happening`);
    const frame = (await page.locator('iframe').boundingBox())!;
    await page.mouse.move(frame.x + frame.width / 2, frame.y + frame.height / 2);
    let silent: number[] = [];
    const scrolling = await mutations(page, '[data-status-bar]', async () => {
      silent = await mutations(page, '[aria-live]', async () => {
        // `wheel` scales by the DPR, which headless halves (root CLAUDE.md).
        for (let i = 0; i < 60; i++) {
          await wheel(page, 300);
          await page.waitForTimeout(16);
        }
        await page.waitForTimeout(600);
      });
    });
    expect(silent.length === 0, `the title bar's live text changed ${silent.length} times during a scroll`);
    // A refresh writes a few text nodes at once: count bursts more than 50 ms apart.
    const bursts = scrolling.filter((at, index) => index === 0 || at - scrolling[index - 1]! > 50);
    const span = scrolling.length > 1 ? (scrolling.at(-1)! - scrolling[0]!) / 1000 : 1;
    out.scrollRefreshes = { bursts: bursts.length, seconds: Number(span.toFixed(2)) };
    expect(bursts.length >= 1 && bursts.length <= Math.ceil(span * 4) + 1, `the status bar refreshed ${bursts.length} times in ${span.toFixed(2)} s of scrolling (~4 Hz)`);
    const smooth = await segment(page, 'smooth');
    expect(/^\d+(\.\d)? %$/.test(smooth ?? ''), `Smooth after a scroll: ${smooth}`);
    await page.waitForFunction(() => /MiB$/.test(document.querySelector('[data-segment="memory"] > span:last-child')?.textContent ?? ''), null, { timeout: 15_000 }).catch(() => fail("GPUI's memory didn't show within 15 s"));
    out.gpui = Object.fromEntries(await Promise.all(CARDS.map(async (card) => [card.key, await segment(page, card.key)])));
    console.log(`status bar: GPUI ${JSON.stringify(out.gpui)}; ${bursts.length} refreshes in ${span.toFixed(2)} s of scrolling, none idle but the memory, the state silent`);

    // The explainers, on the status bar's segments and an (i).
    await page.mouse.move(0, 0);
    await page.locator('[data-segment="usable"]').hover();
    expect((await popovers(page).count()) === 1 && (await popovers(page).textContent())!.includes('Cold, TanStack'), "hovering Ready in didn't open its explainer with the cold comparison");
    await page.mouse.move(0, 0);
    // It waits a moment for the pointer to reach it.
    await page.waitForTimeout(300);
    expect((await popovers(page).count()) === 0, 'a hovered explainer stayed open after the pointer left');
    await page.locator('[data-segment="usable"]').click();
    await page.mouse.move(0, 0);
    await page.waitForTimeout(300);
    expect((await popovers(page).count()) === 1, "a pressed explainer didn't stay open (pinned) after the pointer left");
    await page.locator('[data-segment="memory"]').hover();
    expect((await expanded(page, '[data-segment="usable"]')) === 'true' && (await popovers(page).count()) === 1, 'hovering another explainer replaced a pinned one');
    // A press in the frame closes it: the frame's events never reach the page's window.
    await page.mouse.click(frame.x + frame.width / 2, frame.y + frame.height / 2);
    expect((await popovers(page).count()) === 0, 'a press in the frame left a pinned explainer open');
    await page.locator('[data-segment="usable"]').click();
    await page.locator('[data-segment="data"]').click();
    expect((await popovers(page).count()) === 1 && (await expanded(page, '[data-segment="usable"]')) === 'false' && (await expanded(page, '[data-segment="data"]')) === 'true', 'two explainers open at once');
    await page.locator('[data-segment="data"]').click();
    expect((await popovers(page).count()) === 0, "pressing a pinned explainer's trigger didn't close it");
    const about = page.getByRole('button', { name: 'About switching sides' });
    await about.focus();
    expect((await popovers(page).count()) === 0, 'focus alone opened an explainer');
    await page.keyboard.press('Enter');
    expect((await popovers(page).count()) === 1, "Enter didn't open the explainer");
    await page.keyboard.press('Escape');
    expect((await popovers(page).count()) === 0, "Esc didn't close the explainer");
    expect(await about.evaluate((button) => document.activeElement === button), 'Esc moved focus off the trigger');
    await page.keyboard.press('Space');
    expect((await popovers(page).count()) === 1, "Space didn't open the explainer");
    await page.keyboard.press('Escape');
    console.log('explainers: hover opens and leaving closes, a press pins and a second unpins, one at a time, Enter or Space opens, Esc closes with focus kept');

    // The panel.
    await page.locator('[data-compare]').click();
    await page.locator('[data-card]').first().waitFor();
    expect((await expanded(page, '[data-compare]')) === 'true', "Compare isn't expanded with the panel open");
    const panel = await page.evaluate(() =>
      Object.fromEntries(
        [...document.querySelectorAll<HTMLElement>('[data-card]')].map((card) => [
          card.dataset.card!,
          {
            verdict: card.querySelector('[data-verdict]')!.textContent,
            cold: Object.fromEntries(
              ['reference', 'throttled'].map((profile) => [profile, [...card.querySelectorAll<HTMLElement>(`[data-cold-${profile}]`)].map((value) => ({ text: value.firstChild!.textContent, best: value.textContent!.endsWith('best') }))]),
            ),
          },
        ]),
      ),
    );
    for (const card of CARDS) {
      const outcomes = DEVICE_PROFILES.map((profile) => cardOutcome(card, cold.values, profile));
      DEVICE_PROFILES.forEach((profile, index) => {
        const want = cardValues(card, cold.values, profile).map((value) => number(value));
        const shown = panel[card.key]?.cold[profile];
        expect(JSON.stringify(shown?.map((value) => value.text)) === JSON.stringify(want), `${card.key} ${profile}: shows ${JSON.stringify(shown)}, results say ${want}`);
        const best = shown?.map((value) => value.best);
        const winner = outcomes[index]!.winner;
        expect(JSON.stringify(best) === JSON.stringify([winner === 'gpui', winner === 'tanstack']), `${card.key} ${profile}: "best" on ${JSON.stringify(best)}, the winner ${winner}`);
      });
      const want = verdict(outcomes[0]!, outcomes[1]!, card.word, card.ratio);
      expect(panel[card.key]?.verdict === want, `${card.key}: the verdict "${panel[card.key]?.verdict}", the numbers say "${want}"`);
    }
    const totals = (['gpui', 'tanstack'] as const).map((side) => downloadTotal(side, cold.parts)) as [number, number];
    const download = verdict(outcome(totals, 'lower'), null, 'smaller', true);
    expect(panel.download?.verdict === download && JSON.stringify(panel.download.cold.reference!.map((value) => value.text)) === JSON.stringify(totals.map((total) => size(total).split(' ')[0])), `Download: ${JSON.stringify(panel.download)}, the numbers say ${download}, ${totals}`);
    const chart = await page.locator('[aria-label="From your input to the table moving"]').innerText();
    for (const bar of BARS) for (const profile of DEVICE_PROFILES) for (const value of cold.values[`${bar.metric}-${profile}`]!) expect(chart.includes(`${number(value)} ms`), `the chart lacks ${bar.metric} ${profile}'s ${number(value)} ms`);
    out.verdicts = Object.fromEntries(Object.entries(panel).map(([key, card]) => [key, card.verdict]));
    console.log(`panel: the cold values, both devices, "best", and the verdicts from perf/results/: ${JSON.stringify(out.verdicts)}`);
    // The header's edge once its body scrolls.
    expect(!(await page.locator('[data-panel-header][data-edge]').count()), "the panel's header has its edge before its body scrolled");
    await page.locator('[data-panel-body]').evaluate((body) => body.scrollBy(0, 200));
    await page.locator('[data-panel-header][data-edge]').waitFor({ timeout: 2_000 }).catch(() => fail("the panel's header has no edge once its body scrolled"));
    // Esc (an explainer open: it closes first), then close: back to the frame.
    await page.getByRole('button', { name: 'About the devices' }).click();
    await page.keyboard.press('Escape');
    expect((await page.locator('[data-card]').count()) > 0, 'Esc with an explainer open closed the panel too');
    await page.keyboard.press('Escape');
    expect((await page.locator('[data-card]').count()) === 0, "Esc didn't close the panel");
    expect(await page.evaluate(() => document.activeElement?.tagName === 'IFRAME'), 'Esc left focus off the frame');
    await page.locator('[data-compare]').click();
    await page.getByRole('button', { name: 'Close, back to the table' }).click();
    expect((await page.locator('[data-card]').count()) === 0 && (await page.evaluate(() => document.activeElement?.tagName === 'IFRAME')), "the close button didn't close the panel with focus on the frame");
    console.log("panel: the header's edge once the body scrolls; Esc closes an explainer first, then the panel; Esc and close return focus to the frame");

    // The second side: ready and warm; the first's readings kept.
    const tanstack = contenderBase('tall-table', 'tanstack');
    await page.getByRole('group', { name: 'Contender' }).getByRole('button', { name: 'TanStack' }).click();
    await waitFilled(page, tanstack);
    await page.waitForFunction(() => document.querySelector('[aria-live]')?.textContent === 'Ready · warm', null, { timeout: 2_000 }).catch(() => fail('TanStack, loaded second, isn\'t "Ready · warm"'));
    await page.waitForFunction(() => /^\d/.test(document.querySelector('[data-segment="data"] > span:last-child')?.textContent ?? ''), null, { timeout: 2_000 }).catch(() => fail("TanStack's Rows in didn't show"));
    await page.locator('[data-compare]').click();
    const tab = await page.locator('[data-card="usable"] [data-live]').evaluateAll((values) => values.map((value) => value.textContent));
    expect(tab[0] === (out.gpui as Record<string, string>).usable && /^\d.*warm$/.test(tab[1] ?? ''), `this tab after the flip: ${JSON.stringify(tab)} (GPUI's kept, TanStack's warm)`);
    console.log(`flip: TanStack "Ready · warm"; this tab GPUI ${tab[0]}, TanStack ${tab[1]}`);

    // The description's wins, from the same numbers.
    const won = wins(cold);
    const sentences = await page.locator('[data-wins] li').allTextContents();
    const want = [...(['gpui', 'tanstack'] as const).filter((side) => won[side].length).map((side) => winsSentence(side, won[side])), ...(won.even.length ? [evenSentence(won.even)] : [])];
    expect(JSON.stringify(sentences) === JSON.stringify(want), `where each side wins: ${JSON.stringify(sentences)}, the numbers say ${JSON.stringify(want)}`);
    out.wins = sentences;
    console.log(`description: ${sentences.join(' ')}`);
    expect(found.length === 0, `page problems: ${found.join('; ')}`);
    await context.close();

    // A phone: Smooth, Memory, and the overflow; hover opens nothing, a tap does.
    const phone = await layoutContext(browser, PHONE);
    const small = await phone.newPage();
    await small.goto(url);
    await small.waitForSelector('[data-status-ready]');
    const visible = await small.locator('[data-segment]').evaluateAll((segments) => segments.filter((segment) => segment.getBoundingClientRect().width > 0).map((segment) => (segment as HTMLElement).dataset.segment));
    expect(JSON.stringify(visible) === JSON.stringify(['smooth', 'memory']), `a phone's segments: ${visible}`);
    expect(!(await small.locator('[data-compare]').isVisible()), "a phone shows Compare in the bar, not the overflow");
    expect((await small.locator('[data-status-bar]').evaluate((bar) => bar.getBoundingClientRect().height)) === 44, "a phone's status bar isn't 44 px");
    await small.locator('[data-segment="smooth"]').hover();
    expect((await popovers(small).count()) === 0, 'hover opened an explainer on a phone');
    await small.locator('[data-segment="smooth"]').tap();
    expect((await popovers(small).count()) === 1, "a tap didn't open the explainer on a phone");
    await small.getByRole('button', { name: 'More numbers' }).tap();
    await small.getByRole('menuitem', { name: 'Compare with cold runs' }).tap();
    await small.locator('[data-card]').first().waitFor({ timeout: 5_000 }).catch(() => {});
    expect((await small.locator('[data-card]').count()) === 5, "the overflow's Compare didn't open the panel");
    await small.locator('[data-description]').waitFor();
    expect(await small.getByText('one way at a time').isVisible(), "a phone's description doesn't say GPUI's touch limit");
    await phone.close();
    console.log("phone: Smooth and Memory in a 44 px bar, the rest in the overflow; hover opens nothing, a tap does; the overflow opens the panel; the touch limit in the description");
  } finally {
    await browser.close();
  }
  return out;
}

async function layout(url: string): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  const overviewUrl = new URL(OBSERVATORY, url).href;
  const browser = await chromium.launch({ channel: 'chromium' });
  try {
    // The bar: the same boxes on both routes, open or collapsed, desktop and phone.
    for (const [name, viewport] of [['desktop', DESKTOP], ['phone', PHONE]] as const) {
      const bars: string[][] = [];
      for (const [target, sidebar] of [[overviewUrl, undefined], [url, undefined], [url, 'closed']] as const) {
        const context = await layoutContext(browser, viewport, { sidebar });
        const page = await context.newPage();
        await page.goto(target);
        await hydrated(page);
        bars.push(await barBoxes(page));
        await context.close();
      }
      const same = bars.every((boxes) => JSON.stringify(boxes) === JSON.stringify(bars[0]));
      expect(same, `${name}: the bar's boxes differ between the routes or the sidebar's states:\n${bars.map((boxes) => boxes.join(' | ')).join('\n')}`);
      expect(bars[0]![0]!.split(' ')[3] === String(viewport.width), `${name}: the bar isn't the window's width: ${bars[0]![0]}`);
      console.log(`bar (${name}): ${bars[0]!.length} boxes, the same on /observatory/ and ${ROUTE}, open and collapsed; ${bars[0]![0]}`);
    }

    // A reload in the collapsed state paints the inset where it hydrates;
    // without the head script (the control) it moves.
    const kept = await insetAtPaintAndHydrated(browser, url, false);
    const control = await insetAtPaintAndHydrated(browser, url, true);
    expect(JSON.stringify(kept.atPaint) === JSON.stringify(kept.hydrated), `collapsed reload: the inset moved from ${JSON.stringify(kept.atPaint)} at first paint to ${JSON.stringify(kept.hydrated)} hydrated`);
    expect(kept.hydrated.x === 8, `collapsed: the inset isn't 8 px from the window's left edge: ${kept.hydrated.x}`);
    expect(JSON.stringify(control.atPaint) !== JSON.stringify(control.hydrated), 'the control (no head script) painted the inset where it hydrates: the check can\'t fail');
    out.collapsedReload = { inset: kept.hydrated, control: { atPaint: control.atPaint.x, hydrated: control.hydrated.x } };
    console.log(`sidebar: a collapsed reload paints the inset at x ${kept.atPaint.x}, hydrated ${kept.hydrated.x}; control without the script ${control.atPaint.x} → ${control.hydrated.x}`);

    // Desktop: the toggle collapses and opens it, and keeps the choice.
    {
      const context = await layoutContext(browser, DESKTOP);
      const page = await context.newPage();
      await page.goto(url);
      await hydrated(page);
      const sidebar = await box(page, '.observatory-sidebar');
      const inset = await box(page, '.observatory-inset');
      expect(sidebar.x === 0 && sidebar.width === 240, `open: the sidebar isn't 240 px at the window's edge: ${JSON.stringify(sidebar)}`);
      expect(inset.x === 240, `open: the inset doesn't start at the sidebar's edge: ${inset.x}`);
      const frame = await box(page, 'iframe');
      const card = await box(page, '[aria-label$="the contenders"]');
      expect(Math.abs(card.y + card.height - (DESKTOP.height - 16)) <= 1 && frame.height >= 480, `the contender's card doesn't reach the window's bottom (16 px above it): its bottom ${card.y + card.height}, the frame ${frame.height} px`);
      await page.locator(`[${SIDEBAR_TOGGLE}]`).click();
      expect(!(await shown(page, '.observatory-sidebar')), 'the toggle didn\'t collapse the sidebar');
      expect((await page.evaluate((key) => localStorage.getItem(key), SIDEBAR_KEY)) === 'closed', 'the collapsed state isn\'t stored');
      await page.reload();
      await hydrated(page);
      expect(!(await shown(page, '.observatory-sidebar')), 'the sidebar opened again after a reload');
      await page.locator(`[${SIDEBAR_TOGGLE}]`).click();
      expect((await shown(page, '.observatory-sidebar')) && (await page.evaluate((key) => localStorage.getItem(key), SIDEBAR_KEY)) === null, 'the toggle didn\'t open it again, or the choice stayed stored');
      out.desktop = { sidebar, inset: inset.x, card: { bottom: card.y + card.height }, frame: frame.height };
      console.log(`desktop: sidebar ${sidebar.width} px at x ${sidebar.x}, inset at ${inset.x}; the card's bottom at ${card.y + card.height} (window ${DESKTOP.height}), the frame ${frame.height} px; collapse stored, kept on reload, open clears it`);

      // A control that acts on a press shows it.
      await page.waitForFunction(() => !document.querySelector('[aria-label="Contender"]')?.hasAttribute('data-disabled'), null, { timeout: 60_000 });
      await page.waitForSelector('[data-status-ready]');
      const cursors: Record<string, string[]> = await page.evaluate(
        ({ toggle }) =>
          Object.fromEntries(
            [
              ['the contender toggle', '[aria-label="Contender"] button'],
              ['the theme toggle', '[data-site-theme-toggle]'],
              ['the sidebar toggle', `[${toggle}]`],
              ["the sidebar's items", '.observatory-sidebar a'],
              ["the status bar's segments and Compare", '[data-segment], [data-compare]'],
              ['the explainers', 'button[aria-label^="About"]'],
            ].map(([name, selector]) => [name, [...document.querySelectorAll(selector!)].map((element) => getComputedStyle(element).cursor)]),
          ),
        { toggle: SIDEBAR_TOGGLE },
      );
      for (const [name, values] of Object.entries(cursors)) expect(values.length > 0 && values.every((cursor) => cursor === 'pointer'), `${name}: cursor ${values.join(', ') || 'none found'}`);
      out.cursors = cursors;
      console.log(`cursor: pointer on ${Object.entries(cursors).map(([name, values]) => `${name} (${values.length})`).join(', ')}`);
      await context.close();
    }

    // A phone: closed whatever is stored, open over the content with a scrim.
    {
      const context = await layoutContext(browser, PHONE);
      const page = await context.newPage();
      await page.goto(url);
      expect(!(await shown(page, '.observatory-sidebar')), 'phone: the sidebar is open before hydration');
      await hydrated(page);
      expect(!(await shown(page, '.observatory-sidebar')), 'phone: the sidebar starts open');
      const inset = await box(page, '.observatory-inset');
      expect(inset.x === 0 && inset.width === PHONE.width, `phone: the inset isn't edge to edge: ${JSON.stringify(inset)}`);
      await page.locator(`[${SIDEBAR_TOGGLE}]`).click();
      expect((await shown(page, '.observatory-sidebar')) && (await shown(page, `[${SIDEBAR_SCRIM}]`)), 'phone: the toggle didn\'t open the sidebar with its scrim');
      expect((await box(page, '.observatory-inset')).x === 0, 'phone: the open sidebar moved the content');
      expect((await page.evaluate((key) => localStorage.getItem(key), SIDEBAR_KEY)) === null, 'phone: the toggle stored a state');
      await page.mouse.click(PHONE.width - 20, PHONE.height / 2);
      expect(!(await shown(page, '.observatory-sidebar')), 'phone: the scrim didn\'t close the sidebar');
      await page.locator(`[${SIDEBAR_TOGGLE}]`).click();
      await page.keyboard.press('Escape');
      expect(!(await shown(page, '.observatory-sidebar')), 'phone: Escape didn\'t close the sidebar');
      await page.waitForFunction(() => !document.querySelector('[aria-label="Contender"]')?.hasAttribute('data-disabled'), null, { timeout: 60_000 });
      await context.close();
      console.log('phone: closed at load, before and after hydration; the toggle opens it over the content with a scrim (nothing stored); the scrim and Escape close it');
    }
  } finally {
    await browser.close();
  }
  return out;
}

/** Screenshots of both routes' layouts, light and dark, desktop and phone,
 *  into `dir` (`--shots`), each once the shown contender has filled. */
async function screenshots(url: string, dir: string): Promise<void> {
  mkdirSync(dir, { recursive: true });
  // ForceEagerMeasureMemory: the meter's memory reading without waiting for a GC.
  const browser = await chromium.launch({ channel: 'chromium', args: ['--enable-blink-features=ForceEagerMeasureMemory'] });
  try {
    for (const theme of ['light', 'dark'] as const)
      for (const [name, viewport, sidebar, open] of [
        ['desktop', DESKTOP, undefined, false],
        ['desktop-collapsed', DESKTOP, 'closed', false],
        ['phone', PHONE, undefined, false],
        ['phone-open', PHONE, undefined, true],
      ] as const) {
        const context = await layoutContext(browser, viewport, { sidebar, theme });
        const page = await context.newPage();
        await page.goto(url);
        await page.waitForFunction(() => !document.querySelector('[aria-label="Contender"]')?.hasAttribute('data-disabled'), null, { timeout: 60_000 });
        if (open) await page.locator(`[${SIDEBAR_TOGGLE}]`).click();
        // The meter with something to show: a scroll's frames and a memory reading.
        if (name === 'desktop') {
          await page.waitForSelector('[data-meter]');
          const frame = (await page.locator('iframe').boundingBox())!;
          await page.mouse.move(frame.x + frame.width / 3, frame.y + frame.height / 2);
          for (let i = 0; i < 60; i++) {
            await wheel(page, 300);
            await page.waitForTimeout(16);
          }
          await page.waitForFunction(() => document.querySelector('[data-meter-memory]')?.textContent?.endsWith('MiB'), null, { timeout: 15_000 });
          await page.mouse.move(0, 0);
        }
        await page.waitForTimeout(500);
        const file = join(dir, `${name}-${theme}.png`);
        await page.screenshot({ path: file });
        console.log(`wrote ${file}`);
        await context.close();
      }
  } finally {
    await browser.close();
  }
}

// --- the runs ---

const server = await servePage(PORT, given);
const profiles = check || flag('reference-only') ? PROFILES.slice(0, 1) : PROFILES;
const results: Record<string, { runs: Run[]; firstPaintMs: ReturnType<typeof summarize>; fcpMs: ReturnType<typeof summarize> }> = {};
let hosted: Record<string, unknown> = {};
let laidOut: Record<string, unknown> = {};
let readOut: Record<string, unknown> = {};
try {
  const url = new URL(ROUTE, server.url).href;
  hosted = await hosting(url);
  // The page's own behavior is the build's, checked locally; production adds hosting.
  if (!given) {
    laidOut = await layout(url);
    readOut = await readouts(url);
    readOut.meter = await meter(url);
  }
  const shots = option('shots');
  if (shots) await screenshots(url, shots);
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
    url: given ?? 'local',
    protocol: { viewport: '1440x900', deviceScaleFactor: 2, runs, throttled: { cpuSlowdown: 4, network: 'Fast 4G', ...FAST_4G } },
    // The local build's; production's bytes are `worker-check`'s.
    firstPaintJsBrotliKiB: given ? null : firstPaintJsBrotliKiB,
    firstPaintMs,
    fcpMs: Object.fromEntries(Object.entries(results).map(([name, result]) => [name, result.fcpMs?.median ?? null])),
    hosting: hosted,
    layout: laidOut,
    readouts: readOut,
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
