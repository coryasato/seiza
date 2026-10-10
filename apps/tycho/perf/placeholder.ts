// M7 part G checks: the static placeholder shell (shared-web/src/placeholder.ts)
// and the theme toggle, on the release build (web/dist).
//
// Checks (always):
// - What it costs: index.html raw and brotli, and the inlined font.
// - Its text is all in the placeholder font's character set.
// - Steady: a screencast of the placeholder's life, the app's wasm held back,
//   light and dark; every frame that shows anything must match the last
//   (Chrome once painted it in the fallback font's metrics, then jumped). A
//   negative control shows it before its font loads and must fail.
// - Screenshot match (placeholder-shots.ts): the placeholder against GPUI's
//   first frame, light and dark, 1440×900 at DPR 2 and DPR 1: text, icons,
//   the skeleton buttons' edges, and the surfaces. Images in
//   perf/results/raw/placeholder/.
// - The theme toggle, starting light and starting dark: the title bar's
//   button and Cmd/Ctrl+Shift+L both switch; a system appearance change after
//   a press doesn't undo it; a reload follows the system again.
//
// --controls: negative controls for the screenshot match. Each injects a
//   small CSS error into the placeholder and must fail the match.
//
// --ab <dist>: interleaved A/B against another build's web/dist (HEAD's,
//   built in a worktree with its own target/; see CLAUDE.md, "Perf script
//   gotchas"), the protocol's page, reference and throttled (--runs 10,
//   --reference-only): TTFP and the placeholder's paint. The no-blank-frame
//   check at the swap runs in every perf.ts run.
//
// Usage: node apps/tycho/perf/placeholder.ts [--controls] [--ab <dist>] [--runs 10] [--reference-only] [--label m7-placeholder]
// Writes perf/results/<date>-<label>.json. Run `just tycho build` first.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from '@playwright/test';
import { preview } from 'vite';
import { brotli } from '../../../shared-web/src/brotli.ts';
import { PLACEHOLDER_CHARS } from '../../../shared-web/src/placeholder.ts';
import { PROFILES, flag, hideDevicePixelContentBox, machineInfo, option, summarize, throttle, type Profile } from './common.ts';
import { SCHEMES, compare, shoot, type Scheme } from './placeholder-shots.ts';

const perfDir = dirname(fileURLToPath(import.meta.url));
const webDir = join(perfDir, '../web');
const runs = Number(option('runs') ?? 10);
const label = option('label') ?? 'm7-placeholder';
const date = new Date().toISOString().slice(0, 10);
const rawDir = join(perfDir, 'results/raw/placeholder');
const PORT = 4190;
const url = `http://localhost:${PORT}/`;
const fontPath = join(perfDir, '../../../shared-web/fonts/SeizaPlaceholder-Regular.woff2');

const output: Record<string, unknown> = { date, label, ...machineInfo() };
const failures: string[] = [];

function sizes(): Record<string, number> {
  const html = readFileSync(join(webDir, 'dist/index.html'));
  const font = readFileSync(fontPath);
  return {
    indexHtmlBytes: html.length,
    indexHtmlBrotliBytes: brotli(html).length,
    fontWoff2Bytes: font.length,
    fontBase64Bytes: Math.ceil(font.length / 3) * 4,
  };
}

const twoFrames = (page: Page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

/** The canvas's color at the empty middle of the window (a 1 px screenshot:
 *  WebGPU canvases can't be read back). */
async function background(page: Page): Promise<string> {
  await twoFrames(page);
  await page.waitForTimeout(100);
  const png = (await page.screenshot({ clip: { x: 700, y: 300, width: 1, height: 1 } })).toString('base64');
  return page.evaluate(async (png) => {
    const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${png}`)).blob());
    const context = new OffscreenCanvas(1, 1).getContext('2d')!;
    context.drawImage(bitmap, 0, 0);
    const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
    return r! > 128 && g! > 128 && b! > 128 ? 'light' : 'dark';
  }, png);
}

/** The theme toggle, from a page that starts in `scheme`. */
async function themeToggle(browser: Browser, scheme: Scheme): Promise<Record<string, string>> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: scheme });
  await context.addInitScript(hideDevicePixelContentBox);
  const page = await context.newPage();
  // The placeholder fades out over the first frame; wait until it's gone.
  const firstFrame = () =>
    page.waitForFunction(() => performance.getEntriesByName('gpui:first-frame', 'mark').length > 0 && !document.getElementById('seiza-placeholder'), null, {
      timeout: 60_000,
    });
  const other: Scheme = scheme === 'light' ? 'dark' : 'light';
  const seen: Record<string, string> = {};
  const expect = async (step: string, want: Scheme) => {
    seen[step] = await background(page);
    if (seen[step] !== want) failures.push(`theme, starting ${scheme}: ${step}: ${seen[step]}, expected ${want}`);
  };
  try {
    await page.goto(url);
    // The button's place, from the placeholder (whose layout the screenshot
    // match holds to the first frame's); it's named for the theme it
    // switches to.
    const button = await page.evaluate((other) => {
      const rect = document.querySelector(`#seiza-placeholder .sz-theme-${other}`)!.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    }, other);
    if (button.x === 0) failures.push(`theme, starting ${scheme}: the placeholder shows no ${other}-theme button`);
    await firstFrame();
    await expect('first frame', scheme);
    // GPUI fires a press only on a hovered element.
    await page.mouse.move(button.x, button.y);
    await twoFrames(page);
    await page.mouse.down();
    await page.mouse.up();
    await twoFrames(page);
    await page.mouse.move(700, 600);
    await expect('button', other);
    await page.emulateMedia({ colorScheme: other });
    await page.emulateMedia({ colorScheme: scheme });
    await expect('system change after a press', other);
    await page.keyboard.press('Control+Shift+L');
    await expect('Ctrl+Shift+L', scheme);
    await page.keyboard.press('Meta+Shift+L');
    await expect('Cmd+Shift+L', other);
    await page.reload();
    await firstFrame();
    await expect('reload', scheme);
    await page.emulateMedia({ colorScheme: other });
    await expect('system change before any press', other);
  } finally {
    await context.close();
  }
  return seen;
}

/** CSS errors the screenshot match must catch, each against the real first
 *  frame, at DPR 2. Found by trying them (part G): a 1 px move or size
 *  change, a wrong fill, border, or muted color, a fallback font, a bigger
 *  icon. */
const P = '#seiza-placeholder';
const CONTROLS: [string, string][] = [
  ['skeleton 1px wider', `${P} .sz-skeleton:first-child { width: 100px !important }`],
  ['heading 1px down', `${P} .sz-empty-title { position: relative; top: 1px }`],
  ['button row 1px down', `${P} .sz-row { position: relative; top: 1px }`],
  ['title bar 35px', `${P} .sz-title-bar { height: 35px }`],
  ['muted text #888', `${P} { --muted-fg: #888 }`],
  ['title bar flat (dark)', `${P} .sz-title-bar { background: var(--title-bar) }`],
  ['system font heading', `${P} .sz-empty-title { font-family: system-ui }`],
  ['icon 14px', `${P} .sz-icon-button svg { width: 14px; height: 14px }`],
];

/** Frames of the placeholder's life (the app's wasm never arrives), from
 *  navigation to 600 ms after its paint mark. The inlined font races the
 *  first paint, so `slowFont` makes the race certain: the font is served
 *  from a URL that answers after 300 ms instead. `early` shows the contents
 *  before the font loads, as the first version did: the negative control. */
async function steady(
  browser: Browser,
  scheme: Scheme,
  { slowFont = false, early = false } = {},
): Promise<{ frames: number; shown: number; jumped: number }> {
  // Reduced motion: the skeleton's pulse would count as movement.
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: scheme, reducedMotion: 'reduce' });
  await context.addInitScript(hideDevicePixelContentBox);
  if (slowFont) {
    await context.route(url, async (route) => {
      const response = await route.fetch();
      const html = (await response.text()).replace(/url\(data:font\/woff2;base64,[^)]+\)/, 'url(/__slow-font.woff2)');
      if (!html.includes('/__slow-font.woff2')) throw new Error('no inlined placeholder font to slow down');
      await route.fulfill({ response, body: html });
    });
    await context.route('**/__slow-font.woff2', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      await route.fulfill({ body: readFileSync(fontPath), contentType: 'font/woff2' });
    });
  }
  if (early) {
    await context.addInitScript(() => {
      new MutationObserver((_, observer) => {
        const root = document.getElementById('seiza-placeholder');
        if (!root) return;
        root.classList.add('sz-ready');
        observer.disconnect();
      }).observe(document, { childList: true, subtree: true });
    });
  }
  const page = await context.newPage();
  await page.route(/tycho_bg-[\w-]+\.wasm$/, () => {});
  const cdp = await context.newCDPSession(page);
  const frames: Buffer[] = [];
  cdp.on('Page.screencastFrame', (frame) => {
    frames.push(Buffer.from(frame.data, 'base64'));
    void cdp.send('Page.screencastFrameAck', { sessionId: frame.sessionId }).catch(() => {});
  });
  try {
    await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
    await page.goto(url);
    await page.waitForFunction(() => performance.getEntriesByName('seiza:placeholder-painted', 'mark').length > 0, null, { timeout: 30_000 });
    await page.waitForTimeout(600);
    await cdp.send('Page.stopScreencast');
    // Each frame against the last: blank (the page background alone), or the
    // same picture. Decoded in the page (no image library).
    const verdicts = await page.evaluate(async (pngs) => {
      const pixels = await Promise.all(
        pngs.map(async (png) => {
          const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${png}`)).blob());
          const context = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d')!;
          context.drawImage(bitmap, 0, 0);
          return context.getImageData(0, 0, bitmap.width, bitmap.height).data;
        }),
      );
      const last = pixels.at(-1)!;
      const d = (p: Uint8ClampedArray, q: Uint8ClampedArray, i: number, j: number) =>
        Math.abs(p[i]! - q[j]!) + Math.abs(p[i + 1]! - q[j + 1]!) + Math.abs(p[i + 2]! - q[j + 2]!);
      return pixels.map((p) => {
        // Blank: one color throughout (the page before anything is shown).
        let ink = 0;
        let differ = 0;
        for (let i = 0; i < p.length; i += 4) {
          if (d(p, p, i, 0) > 24) ink++;
          if (d(p, last, i, i) > 24) differ++;
        }
        return { blank: ink < 50, differ };
      });
    }, frames.map((frame) => frame.toString('base64')));
    // Keep any frame that moved, to look at.
    verdicts.forEach((verdict, index) => {
      if (!verdict.blank && verdict.differ > 50)
        writeFileSync(join(rawDir, `steady-${scheme}${slowFont ? '-slow' : ''}${early ? '-control' : ''}-${index}.png`), frames[index]!);
    });
    return {
      frames: verdicts.length,
      shown: verdicts.filter((v) => !v.blank).length,
      jumped: verdicts.filter((v) => !v.blank && v.differ > 50).length,
    };
  } finally {
    await context.close();
  }
}

interface AbRun {
  variant: string;
  ttfpMs: number;
  placeholderPaintMs: number | null;
}

async function abRun(target: string, variant: string, profile: Profile): Promise<AbRun> {
  const browser = await chromium.launch({ channel: 'chromium' });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
    await context.addInitScript(hideDevicePixelContentBox);
    const page = await context.newPage();
    await throttle(context, page, profile);
    await page.goto(target);
    await page.waitForFunction(() => performance.getEntriesByName('gpui:first-frame', 'mark').length > 0, null, { timeout: 120_000, polling: 50 });
    return {
      variant,
      ...(await page.evaluate(() => ({
        ttfpMs: performance.getEntriesByName('gpui:first-frame', 'mark').at(-1)!.startTime,
        placeholderPaintMs: performance.getEntriesByName('seiza:placeholder-painted', 'mark').at(-1)?.startTime ?? null,
      }))),
    };
  } finally {
    await browser.close();
  }
}

// --- main ---

const abDist = option('ab');
const servers = [await preview({ root: webDir, preview: { port: PORT, strictPort: true }, logLevel: 'warn' })];
if (abDist) {
  const outDir = isAbsolute(abDist) ? abDist : resolve(process.cwd(), abDist);
  servers.push(await preview({ root: webDir, build: { outDir }, preview: { port: PORT + 1, strictPort: true }, logLevel: 'warn' }));
}
const browser = await chromium.launch({ channel: 'chromium' });
try {
  output.sizes = sizes();
  console.log('sizes', output.sizes);
  mkdirSync(rawDir, { recursive: true });

  const steadiness: Record<string, unknown> = {};
  for (const scheme of SCHEMES) {
    const result = { inlined: await steady(browser, scheme), slowFont: await steady(browser, scheme, { slowFont: true }) };
    const control = await steady(browser, scheme, { slowFont: true, early: true });
    steadiness[scheme] = { ...result, control };
    for (const [name, r] of Object.entries(result)) {
      console.log(`${scheme} steady (${name} font): ${r.shown} of ${r.frames} frames shown, ${r.jumped} differ from the last`);
      if (r.jumped) failures.push(`${scheme}, ${name} font: ${r.jumped} placeholder frames differ from its last (it moved while up)`);
      if (!r.shown) failures.push(`${scheme}, ${name} font: the screencast never showed the placeholder`);
    }
    console.log(`${scheme} steady control (shown before its slow font): ${control.jumped} of ${control.shown} shown frames differ`);
    if (!control.jumped) failures.push(`${scheme}: the steadiness control (contents shown before the font) wasn't caught`);
  }
  output.steady = steadiness;

  const match: Record<string, unknown> = {};
  // DPR 1 too: GPUI's and the browser's rounding differ by whole pixels
  // there, half-pixels at DPR 2.
  for (const [dpr, scheme] of [2, 1].flatMap((dpr) => SCHEMES.map((scheme) => [dpr, scheme] as const))) {
    const tag = `${scheme}@${dpr}x`;
    const shots = await shoot(browser, url, scheme, '', { dpr });
    const outside = [...new Set(shots.placeholderText.replace(/\s+/g, ' '))].filter((char) => !PLACEHOLDER_CHARS.test(char));
    if (outside.length) failures.push(`${tag}: placeholder text outside the font: ${outside.map((c) => JSON.stringify(c)).join(', ')}`);
    const result = await compare(browser, shots, dpr);
    writeFileSync(join(rawDir, `${tag}-placeholder.png`), shots.placeholder);
    writeFileSync(join(rawDir, `${tag}-first-frame.png`), shots.firstFrame);
    writeFileSync(join(rawDir, `${tag}-diff.png`), result.image);
    match[tag] = { regions: result.regions, surface: result.surface, failures: result.failures };
    failures.push(...result.failures.map((failure) => `${tag}: ${failure}`));
    for (const region of result.regions) {
      const edges = region.firstFrame && region.placeholder ? region.firstFrame.map((v, k) => v - region.placeholder![k]!).join(',') : '—';
      console.log(`${tag} ${region.kind.padEnd(4)} ${region.name.slice(0, 32).padEnd(32)} edges ${edges}  mass ${region.mass.toFixed(2)}`);
    }
    console.log(`${tag} surfaces ${(result.surface.share * 100).toFixed(4)}% differ  ${result.failures.length ? 'FAIL' : 'match'}`);
  }
  output.screenshotMatch = match;

  const toggle: Record<string, unknown> = {};
  for (const scheme of SCHEMES) toggle[scheme] = await themeToggle(browser, scheme);
  output.themeToggle = toggle;
  console.log('theme toggle', output.themeToggle);

  if (flag('controls')) {
    const controls: Record<string, unknown>[] = [];
    for (const [name, css] of CONTROLS) {
      // A control that only shows in one scheme says so in its name.
      const schemes = SCHEMES.filter((scheme) => !/\((light|dark)\)$/.test(name) || name.endsWith(`(${scheme})`));
      for (const scheme of schemes) {
        const result = await compare(browser, await shoot(browser, url, scheme, css));
        controls.push({ name, scheme, caught: result.failures.length > 0, failures: result.failures });
        console.log(`control ${scheme} ${name.padEnd(32)} ${result.failures.length ? `caught: ${result.failures[0]}` : 'MISSED'}`);
        if (!result.failures.length) failures.push(`control "${name}" (${scheme}) wasn't caught`);
      }
    }
    output.controls = controls;
  }

  if (abDist) {
    const variants: Record<string, string> = { other: `http://localhost:${PORT + 1}/`, this: url };
    for (const profile of flag('reference-only') ? PROFILES.slice(0, 1) : PROFILES) {
      const list: AbRun[] = [];
      for (let index = 0; index < runs; index++) {
        // Alternate which goes first, so neither always runs on a warmer machine.
        for (const name of index % 2 ? ['this', 'other'] : ['other', 'this']) {
          const run = await abRun(variants[name]!, name, profile);
          list.push(run);
          console.log(`${profile.name} ${String(index + 1).padStart(2)}/${runs} ${name.padEnd(5)} TTFP ${run.ttfpMs.toFixed(1)}  placeholder ${run.placeholderPaintMs?.toFixed(1) ?? '—'}`);
        }
      }
      const of = (name: string) => list.filter((run) => run.variant === name);
      output[`ab-${profile.name}`] = Object.fromEntries(
        Object.keys(variants).map((name) => [
          name,
          {
            ttfpMs: summarize(of(name).map((run) => run.ttfpMs)),
            placeholderPaintMs: summarize(of(name).flatMap((run) => (run.placeholderPaintMs === null ? [] : [run.placeholderPaintMs]))),
          },
        ]),
      );
      console.log(profile.name, JSON.stringify(output[`ab-${profile.name}`]));
      if (of('this').some((run) => run.placeholderPaintMs === null || run.placeholderPaintMs > run.ttfpMs))
        failures.push(`${profile.name}: a run's placeholder didn't paint before the first frame`);
    }
    output.ab = { other: abDist, runs, interleaved: true };
  }
} finally {
  await browser.close();
  await Promise.all(servers.map((server) => server.close()));
}

output.failures = failures;
const out = join(perfDir, 'results', `${date}-${label}.json`);
writeFileSync(out, `${JSON.stringify(output, null, 2)}\n`);
console.log(`wrote ${out}`);
if (failures.length) {
  console.error(`\nFAIL\n${failures.map((failure) => `  ${failure}`).join('\n')}`);
  process.exit(1);
}
console.log('\nPASS');
