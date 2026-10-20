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
// stores nothing, and closes on the scrim and Escape, with GPUI's touch
// line shown (and hidden to a fine pointer); every press control shows
// `cursor: pointer`.
//
// Usage: node apps/observatory/perf/page.ts [--runs 10] [--check] [--label <name>] [--write-baseline] [--reference-only] [--shots <dir>]
// --shots: screenshots of the comparison, light and dark, desktop (open,
// collapsed) and phone (closed, open), into <dir>.
// --check: reference only, fails if first paint or the first-paint JS is
// over perf/baseline.json's by more than limits.page's fractions
// (perf/budgets.json). --label writes perf/results/<date>-<label>.json
// (default `page`, unless --check). --write-baseline records both in
// perf/baseline.json, keeping its other entries. Run `just observatory
// gpui-build`, `tanstack-build`, and `build` first.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { chromium, type Browser, type Page } from '@playwright/test';
import { brotli } from '../../../shared-web/src/brotli.ts';
import { FAST_4G, PROFILES, flag, hideDevicePixelContentBox, machineInfo, option, summarize, throttle, type Profile } from '../../../shared-web/perf/protocol.ts';
import { MARKS } from '../contenders/contract.ts';
import { contenderBase, OBSERVATORY, UI_FONT } from '../contenders/paths.ts';
import { wheel } from '../../../shared-web/perf/harness.ts';
import { format, Reporter } from '../../../shared-web/scripts/results.ts';
import { BARS, CARDS } from '../web/src/readouts.ts';
import { SIDEBAR_KEY, SIDEBAR_SCRIM, SIDEBAR_SCRIPT, SIDEBAR_TOGGLE } from '../web/src/sidebar.ts';
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

// --- the dashboard's layout, once ---

const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };

/** The numbers' text: each card's cold values and live row, by metric. */
const cardText = (page: Page) =>
  page.evaluate(() =>
    Object.fromEntries(
      [...document.querySelectorAll<HTMLElement>('[data-card]')].map((card) => [
        card.dataset.card!,
        {
          cold: [...card.querySelectorAll<HTMLElement>('[data-cold]')].map((value) => value.textContent!),
          live: Object.fromEntries([...card.querySelectorAll<HTMLElement>('[data-live]')].map((value) => [value.dataset.live!, value.textContent!])),
        },
      ]),
    ),
  );
/** A live value that's a number (not "loading", "not loaded", …). */
const reads = (text: string | undefined) => !!text && /^\d/.test(text);

/**
 * The numbers: rendered after first paint, not in the HTML; the cold
 * medians resolved from perf/results/ as `report` resolves them, both
 * profiles, and the chart's; this tab's live
 * row filling as GPUI loads (its usable reading the frame's own mark), a
 * scroll's late frames, the frame's memory, TanStack's readings labelled
 * warm after a flip with GPUI's kept; nothing but the memory (re-measured
 * every few seconds) changing while nothing happens, and the readouts
 * refreshed at ~4 Hz at most while something does; on a phone,
 * the first card open and the rest and the chart closed, each opening on
 * a press.
 */
async function readouts(url: string): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  const reporter = new Reporter(join(perfDir, '..'));
  const coldOf = (metric: string, profile: string) => {
    const entry = reporter.budgets.metrics.find((candidate) => candidate.id === `${metric}-${profile}`)!;
    return reporter.values(entry, 'local')!.map((value) => format(value.value));
  };
  // Below the fold, they'd only delay the first paint: none in the HTML.
  expect(!readFileSync(join(dist, 'tall-table/index.html'), 'utf8').includes('data-card'), 'the numbers are in the prerendered HTML');

  // ForceEagerMeasureMemory: else the memory reading waits for a GC (up to 20 s).
  const browser = await chromium.launch({ channel: 'chromium', args: ['--enable-blink-features=ForceEagerMeasureMemory'] });
  try {
    const context = await protocolContext(browser, { init: [markRecorder] });
    const page = await context.newPage();
    const found = problems(page);
    await page.goto(url);
    await page.locator('[data-card]').first().waitFor();
    for (const profile of ['throttled', 'reference']) {
      await page.getByRole('group', { name: 'Profile' }).getByRole('button', { name: profile === 'reference' ? 'Reference' : 'Throttled' }).click();
      const shown = await cardText(page);
      for (const card of CARDS) {
        const want = coldOf(card.metric, profile);
        expect(JSON.stringify(shown[card.metric]?.cold.map((text) => text.replace(/[^\d.]+$/, ''))) === JSON.stringify(want), `${profile} ${card.metric}: shows ${shown[card.metric]?.cold}, results say ${want}`);
      }
    }
    const chart = await page.locator('[aria-label="Input to visible response"]').innerText();
    for (const bar of BARS) for (const value of coldOf(bar.metric, 'reference')) expect(chart.includes(`${value} ms`), `the chart lacks ${bar.metric}'s ${value} ms`);
    console.log('readouts: the cold medians, both profiles, and the chart, as perf/results/ has them');

    const gpui = contenderBase('tall-table', 'gpui');
    await waitFilled(page, gpui);
    const filledAt = Date.now();
    await page.waitForFunction(() => /^\d/.test(document.querySelector('[data-card="data"] [data-live="gpui"]')?.textContent ?? ''), null, { timeout: 2_000 }).catch(() => fail("GPUI's live time to data didn't show within 2 s of its filled mark"));
    out.liveAfterFilledMs = Date.now() - filledAt;
    let text = await cardText(page);
    const marks = await page.frameLocator('iframe').locator(':root').evaluate(() => Object.fromEntries(performance.getEntriesByType('mark').map((mark) => [mark.name, mark.startTime])));
    const usable = Number(text.usable?.live.gpui?.split(' ')[0]);
    expect(Math.abs(usable - marks[MARKS.usable]!) < 0.1, `GPUI's live usable ${usable} ms isn't its frame's mark, ${marks[MARKS.usable]} ms`);
    const data = Number(text.data?.live.gpui?.split(' ')[0]);
    expect(Math.abs(data - (marks[MARKS.filled]! - marks[MARKS.open]!)) < 0.1, `GPUI's live time to data ${data} ms isn't its open → filled`);
    expect(text.usable?.live.tanstack === 'not loaded', `TanStack's live row before it loaded: ${text.usable?.live.tanstack}`);
    expect(!reads(text['fling-late']?.live.gpui), `GPUI's late frames read before any scroll: ${text['fling-late']?.live.gpui}`);
    expect(!/warm/.test(text.usable?.live.gpui ?? ''), "GPUI, this tab's first frame, is labelled warm");

    // Nothing but the memory changes while nothing happens; ~4 Hz at most
    // while something does.
    const mutations = async (during: () => Promise<void>, ignore = '') => {
      await page.evaluate((ignore) => {
        const counted = ((globalThis as { __readoutMutations?: number[] }).__readoutMutations = [] as number[]);
        new MutationObserver((records) => {
          if (records.some((record) => !ignore || !(record.target instanceof Element ? record.target : record.target.parentElement)?.closest(ignore))) counted.push(performance.now());
        }).observe(document.querySelector('[aria-label="The numbers"]')!, { subtree: true, childList: true, characterData: true });
      }, ignore);
      await during();
      return page.evaluate(() => (globalThis as unknown as { __readoutMutations: number[] }).__readoutMutations.splice(0));
    };
    await page.waitForTimeout(1_000);
    const idle = await mutations(() => page.waitForTimeout(2_000), '[data-card="memory"] [data-live]');
    expect(idle.length === 0, `the readouts other than memory changed ${idle.length} times in 2 s with nothing happening`);
    // The profile switch scrolled the page: the frame back in view.
    await page.evaluate(() => scrollTo(0, 0));
    const frame = (await page.locator('iframe').boundingBox())!;
    await page.mouse.move(frame.x + frame.width / 2, frame.y + frame.height / 2);
    const scrolling = await mutations(async () => {
      // `wheel` scales by the DPR, which headless halves (root CLAUDE.md).
      for (let i = 0; i < 60; i++) {
        await wheel(page, 300);
        await page.waitForTimeout(16);
      }
      await page.waitForTimeout(600);
    });
    // React writes a refresh in a few text nodes at once: count refreshes as
    // bursts more than 50 ms apart.
    const bursts = scrolling.filter((at, index) => index === 0 || at - scrolling[index - 1]! > 50);
    const span = scrolling.length > 1 ? (scrolling.at(-1)! - scrolling[0]!) / 1000 : 1;
    out.scrollRefreshes = { bursts: bursts.length, seconds: Number(span.toFixed(2)) };
    expect(bursts.length >= 2 && bursts.length <= Math.ceil(span * 4) + 1, `the readouts refreshed ${bursts.length} times in ${span.toFixed(2)} s of scrolling (~4 Hz)`);
    text = await cardText(page);
    expect(reads(text['fling-late']?.live.gpui), `GPUI's late frames after a scroll: ${text['fling-late']?.live.gpui}`);
    await page.waitForFunction(() => /^\d/.test(document.querySelector('[data-card="memory"] [data-live="gpui"]')?.textContent ?? ''), null, { timeout: 15_000 }).catch(() => fail("GPUI's live memory didn't show within 15 s"));
    out.gpui = (await cardText(page));
    console.log(`readouts: GPUI live ${JSON.stringify(Object.fromEntries(Object.entries(out.gpui as Record<string, { live: Record<string, string> }>).map(([metric, card]) => [metric, card.live.gpui])))}; refreshes ${bursts.length} in ${span.toFixed(2)} s of scrolling, none idle but the memory`);

    // The second side: warm; the first's readings kept.
    const tanstack = contenderBase('tall-table', 'tanstack');
    await page.getByRole('group', { name: 'Contender' }).getByRole('button', { name: 'TanStack' }).click();
    await waitFilled(page, tanstack);
    await page.waitForFunction(() => /^\d.*warm$/.test(document.querySelector('[data-card="data"] [data-live="tanstack"]')?.textContent ?? ''), null, { timeout: 2_000 }).catch(() => fail("TanStack's live time to data isn't shown, labelled warm"));
    text = await cardText(page);
    expect(text.usable?.live.gpui === (out.gpui as typeof text).usable?.live.gpui, `GPUI's readings changed after the flip: ${text.usable?.live.gpui}`);
    out.tanstack = text;
    console.log(`readouts: after the flip TanStack ${text.usable?.live.tanstack} usable, ${text.data?.live.tanstack} data; GPUI's kept`);
    expect(found.length === 0, `page problems: ${found.join('; ')}`);
    await context.close();

    // A phone: the first card open, the rest and the chart closed.
    const phone = await layoutContext(browser, PHONE);
    const small = await phone.newPage();
    await small.goto(url);
    await small.waitForFunction(() => document.querySelectorAll('[data-card] button[aria-expanded]').length === 4, null, { timeout: 10_000 }).catch(() => fail('the cards have no disclosure buttons on a phone'));
    const expanded = await small.locator('[data-card] button[aria-expanded], [aria-label="Input to visible response"] button[aria-expanded]').evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-expanded')));
    expect(JSON.stringify(expanded) === JSON.stringify(['true', 'false', 'false', 'false', 'false']), `on a phone, the cards and the chart open: ${expanded}`);
    expect((await small.locator('[data-card="data"] [data-cold]').count()) === 0, 'a closed card shows its values large');
    await small.locator('[data-card="data"] button').click();
    expect((await small.locator('[data-card="data"] [data-cold]').count()) === 2, "pressing a closed card's header didn't open it");
    await phone.close();
    console.log(`readouts: a phone opens the first card only (${expanded}), a press opens another`);
  } finally {
    await browser.close();
  }
  return out;
}

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
      const cursors: Record<string, string[]> = await page.evaluate(
        ({ toggle }) =>
          Object.fromEntries(
            [
              ['the contender toggle', '[aria-label="Contender"] button'],
              ['the theme toggle', '[data-site-theme-toggle]'],
              ['the sidebar toggle', `[${toggle}]`],
              ["the sidebar's items", '.observatory-sidebar a'],
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
      const touchLine = page.getByText('one axis per swipe');
      expect(await touchLine.isVisible(), "phone: the GPUI side's touch line isn't shown");
      await context.close();
      console.log("phone: closed at load, before and after hydration; the toggle opens it over the content with a scrim (nothing stored); the scrim and Escape close it; GPUI's touch line shown");
    }
    {
      // A desktop pointer doesn't see the touch line.
      const context = await layoutContext(browser, DESKTOP);
      const page = await context.newPage();
      await page.goto(url);
      await page.waitForFunction(() => !document.querySelector('[aria-label="Contender"]')?.hasAttribute('data-disabled'), null, { timeout: 60_000 });
      expect(!(await page.getByText('one axis per swipe').isVisible()), 'desktop: the touch line is shown to a fine pointer');
      await context.close();
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
  const browser = await chromium.launch({ channel: 'chromium' });
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

const server = await servePage(PORT);
const profiles = check || flag('reference-only') ? PROFILES.slice(0, 1) : PROFILES;
const results: Record<string, { runs: Run[]; firstPaintMs: ReturnType<typeof summarize>; fcpMs: ReturnType<typeof summarize> }> = {};
let hosted: Record<string, unknown> = {};
let laidOut: Record<string, unknown> = {};
let readOut: Record<string, unknown> = {};
try {
  const url = new URL(ROUTE, server.url).href;
  hosted = await hosting(url);
  laidOut = await layout(url);
  readOut = await readouts(url);
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
    protocol: { viewport: '1440x900', deviceScaleFactor: 2, runs, throttled: { cpuSlowdown: 4, network: 'Fast 4G', ...FAST_4G } },
    firstPaintJsBrotliKiB,
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
