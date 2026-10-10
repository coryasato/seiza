import { readFileSync } from 'node:fs';
import type { HtmlTagDescriptor, Plugin } from 'vite';

/**
 * The static placeholder shell: an HTML/CSS copy of the app's empty shell,
 * painted before the wasm arrives (Tycho M7 part G). It sits above the canvas
 * and is inert: nothing in it can be clicked, focused, or selected (clicks
 * reach the canvas). `shared/` adds `sz-leaving` in the same microtask that
 * sets `gpui:first-frame`, right after GPUI presents its first frame
 * (`shared/src/first_frame.rs`), so the browser never renders a frame with
 * neither; it then fades out over that frame and removes itself.
 *
 * It must look like the first frame: the title bar `shared/src/shell.rs`
 * draws, and the app's empty state in gpui-kit 0.7.1's default theme, light
 * or dark by `prefers-color-scheme` (the shell follows the system until the
 * visitor picks a theme, and a reload follows it again). Each app's check
 * (`apps/<app>/perf/placeholder.ts`) compares screenshots of both. TTFP keeps
 * meaning GPUI's first frame; the placeholder's paint is its own metric.
 *
 * GPUI and the browser can't draw the same text identically: they rasterize
 * glyphs differently, and GPUI measures text its own way and rounds layout
 * to whole device pixels. What part G's review settled on: the boxes match
 * exactly (GPUI's line-height rounding, below), components whose label would
 * move are skeletons with GPUI's widths, and the swap is a fade, not a cut.
 */

/** The element `shared/` releases at the first frame. Don't rename it. */
export const PLACEHOLDER_ID = 'seiza-placeholder';

/** Set when the placeholder's text was painted, which waits for its font:
 *  Element Timing's render time where the browser has it (Chromium), else
 *  the first task after the frame that drew it. The panel's "Placeholder"
 *  step reads it (`shared/src/frames.rs`). */
export const PLACEHOLDER_PAINT_MARK = 'seiza:placeholder-painted';

/**
 * The characters the placeholder font has: printable ASCII and "…". Keep in
 * step with `shared-web/fonts/make-placeholder-font.py`. Text outside it would
 * fall back to another font and stop matching GPUI's, so the build fails on it.
 */
export const PLACEHOLDER_CHARS = /^[\x20-\x7e…]*$/;

export interface PlaceholderOptions {
  /** The title bar's title, as the app passes it to `seiza::Bootstrap`. */
  title: string;
  /**
   * The app's empty state, below the title bar, as HTML built from the
   * `.sz-…` classes in PLACEHOLDER_CSS. Draw a component whose label would
   * move at the swap (a button) as a skeleton, `.sz-skeleton.sz-skeleton-button`,
   * with GPUI's width for it. Plain text and tags only: no scripts, handlers,
   * links, or controls.
   */
  body: string;
}

/** How long the placeholder takes to fade out over the first frame. */
const FADE_MS = 120;

const fontUrl = new URL('../fonts/SeizaPlaceholder-Regular.woff2', import.meta.url);

/**
 * gpui-kit's `Skeleton` pulse: `opacity = 1 − 0.5 · bounce(ease_in_out)(t)`
 * over 2 s, repeating (gpui-component 0.7.1 `skeleton.rs`, gpui's
 * `ease_in_out` and `bounce`). CSS has no quadratic ease-in-out curve, so
 * it's sampled every 50 ms, linear between: within 0.06% of GPUI's curve.
 */
const SKELETON_KEYFRAMES = (() => {
  const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
  const bounce = (t: number) => (t < 0.5 ? easeInOut(t * 2) : easeInOut((1 - t) * 2));
  return Array.from({ length: 41 }, (_, i) => `${(i * 2.5).toFixed(1)}% { opacity: ${(1 - 0.5 * bounce(i / 40)).toFixed(4)}; }`).join(' ');
})();

/**
 * gpui-kit 0.7.1's default theme and the components the shells use, in CSS.
 * Colors are the default light and dark themes' (`theme/default-theme.json`);
 * sizes are GPUI's (1 rem = 16 px; `text_xs` 12 px, `text_sm` 14 px; GPUI's
 * default line height is φ). Only Regular is loaded in GPUI, so nothing here
 * is bold: `font_medium` falls back to Regular there, and `font-synthesis:
 * none` keeps the browser from faking a weight. No font-smoothing or
 * text-rendering overrides: `antialiased` drew the text thinner than GPUI's
 * on macOS, and `geometricPrecision` unsnapped its glyphs.
 */
const PLACEHOLDER_CSS = `
@font-face { font-family: "Seiza Placeholder"; src: url(data:font/woff2;base64,{{FONT}}) format("woff2"); font-display: block; }
#${PLACEHOLDER_ID} {
  --bg: #fff; --fg: #0a0a0a; --muted-fg: #737373; --skeleton: #f5f5f5;
  --title-bar: #f8f8f8; --title-bar-top: #fbfbfb; --title-bar-border: #e5e5e5;
  /* GPUI's line heights, rounded to whole device pixels by PLACEHOLDER_SCRIPT;
     these defaults are the unrounded ones. */
  --sz-lh-14: 22.6525px; --sz-lh-14-desc: 22.75px; --sz-lh-12: 19.4164px;
  position: fixed; inset: 0; z-index: 1; display: flex; flex-direction: column; overflow: hidden;
  background: var(--bg); color: var(--fg); cursor: default; user-select: none; -webkit-user-select: none;
  font: 16px/1.618034 "Seiza Placeholder"; font-synthesis: none;
}
@media (prefers-color-scheme: dark) {
  #${PLACEHOLDER_ID} {
    --bg: #0a0a0a; --fg: #fafafa; --muted-fg: #a3a3a3; --skeleton: #171717;
    --title-bar: #171717; --title-bar-top: #111111; --title-bar-border: #262626;
  }
}
/* Hidden until its font is loaded: Chrome could paint a frame laid out in the
   fallback font's metrics first, then re-lay it out, and everything jumped. */
#${PLACEHOLDER_ID}:not(.sz-ready) > * { visibility: hidden; }
#${PLACEHOLDER_ID}.sz-leaving { opacity: 0; transition: opacity ${FADE_MS}ms ease-out; }

#${PLACEHOLDER_ID} .sz-title-bar {
  flex: none; box-sizing: border-box; height: 34px; display: flex; align-items: center;
  justify-content: space-between; padding: 0 8px 0 12px; border-bottom: 1px solid var(--title-bar-border);
  background: linear-gradient(180deg, var(--title-bar-top), var(--title-bar));
}
#${PLACEHOLDER_ID} .sz-title { font-size: 14px; line-height: var(--sz-lh-14); }
#${PLACEHOLDER_ID} .sz-title-actions { display: flex; gap: 4px; }
/* An xsmall ghost button; an icon-only one is square. */
#${PLACEHOLDER_ID} .sz-button {
  box-sizing: border-box; display: flex; align-items: center; justify-content: center; white-space: nowrap;
  height: 20px; padding: 0 4px; border: 1px solid transparent; border-radius: 6px; font-size: 12px;
}
#${PLACEHOLDER_ID} .sz-icon-button { width: 20px; padding: 0; }
#${PLACEHOLDER_ID} .sz-icon-button svg { width: 12px; height: 12px; }
/* The theme button shows the theme a press switches to. */
#${PLACEHOLDER_ID} .sz-button.sz-theme-light { display: none; }
@media (prefers-color-scheme: dark) {
  #${PLACEHOLDER_ID} .sz-button.sz-theme-dark { display: none; }
  #${PLACEHOLDER_ID} .sz-button.sz-theme-light { display: flex; }
}

#${PLACEHOLDER_ID} .sz-content { flex: 1; min-height: 0; display: flex; flex-direction: column; }
#${PLACEHOLDER_ID} .sz-p-4 { flex: 1; min-height: 0; display: flex; flex-direction: column; box-sizing: border-box; padding: 16px; }
/* gpui-kit's Empty. GPUI rounds a position of exactly x.5 device px down,
   the browser up: a hair up and left makes it round as GPUI's does. */
#${PLACEHOLDER_ID} .sz-empty {
  position: relative; top: -0.03px; left: -0.03px;
  flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 16px; padding: 24px; text-align: center;
}
#${PLACEHOLDER_ID} .sz-empty-header { display: flex; flex-direction: column; align-items: center; gap: 8px; width: 100%; max-width: 384px; }
#${PLACEHOLDER_ID} .sz-empty-title { font-size: 14px; line-height: var(--sz-lh-14); }
#${PLACEHOLDER_ID} .sz-empty-description { font-size: 14px; line-height: var(--sz-lh-14-desc); color: var(--muted-fg); }
#${PLACEHOLDER_ID} .sz-empty-content { display: flex; flex-direction: column; align-items: center; gap: 10px; width: 100%; max-width: 384px; }
#${PLACEHOLDER_ID} .sz-row { display: flex; gap: 8px; }
#${PLACEHOLDER_ID} .sz-text-xs { font-size: 12px; line-height: var(--sz-lh-12); }
#${PLACEHOLDER_ID} .sz-muted { color: var(--muted-fg); }

/* gpui-kit's Skeleton: the theme's skeleton color and its pulse. A component
   drawn as a skeleton takes its shape (.sz-skeleton-button: a medium button)
   and, set by the app, its width. */
#${PLACEHOLDER_ID} .sz-skeleton { display: block; flex: none; background: var(--skeleton); animation: sz-skeleton 2s linear infinite; }
#${PLACEHOLDER_ID} .sz-skeleton-button { height: 32px; border-radius: 6px; }
@keyframes sz-skeleton { {{SKELETON_KEYFRAMES}} }

@media (prefers-reduced-motion: reduce) {
  #${PLACEHOLDER_ID}.sz-leaving { transition: none; }
  #${PLACEHOLDER_ID} .sz-skeleton { animation: none; }
}
`;

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

/** The placeholder's visible text, entities decoded, for the font check. */
function placeholderText(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&(amp|lt|gt|quot|hellip|#(\d+)|#x([\da-f]+));/gi, (_, name: string, dec?: string, hex?: string) =>
      dec ? String.fromCodePoint(Number(dec)) : hex ? String.fromCodePoint(parseInt(hex, 16)) : ({ amp: '&', lt: '<', gt: '>', quot: '"', hellip: '…' })[name.toLowerCase()]!,
    );
}

/** Lucide's moon and sun (ISC license), as gpui-kit-assets 0.7.1 embeds
 *  them: the shell's theme button (`shared/src/bootstrap.rs`, `Icons`). */
const ICONS = {
  moon: '<path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
};

/** The title bar `shared/src/shell.rs` draws: the title, the theme button
 *  (the icon of the theme it switches to), and the observation panel's. */
function titleBar(title: string): string {
  const themeButton = (switchesTo: 'dark' | 'light', icon: keyof typeof ICONS) =>
    `<span class="sz-button sz-icon-button sz-theme-${switchesTo}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[icon]}</svg></span>`;
  return (
    `<div class="sz-title-bar"><span class="sz-title" elementtiming="${PLACEHOLDER_ID}">${escapeHtml(title)}</span>` +
    `<span class="sz-title-actions">${themeButton('dark', 'moon')}${themeButton('light', 'sun')}<span class="sz-button">Observation panel</span></span></div>`
  );
}

/**
 * Inline, right after the placeholder, so it runs before the first paint:
 * sets GPUI's line heights for this DPR, shows the placeholder once its font
 * is loaded, removes it once it has faded out, and sets
 * {@link PLACEHOLDER_PAINT_MARK}.
 */
const PLACEHOLDER_SCRIPT = `(() => {
  const root = document.getElementById(${JSON.stringify(PLACEHOLDER_ID)});
  // GPUI rounds line heights to whole device pixels, half down.
  const dpr = devicePixelRatio || 1;
  const line = (height) => \`\${Math.ceil(height * dpr - 0.5) / dpr}px\`;
  root.style.setProperty('--sz-lh-14', line(14 * 1.618034));
  root.style.setProperty('--sz-lh-14-desc', line(14 * 1.625));
  root.style.setProperty('--sz-lh-12', line(12 * 1.618034));
  const show = () => root.classList.add('sz-ready');
  document.fonts.load('14px "Seiza Placeholder"').then(show, show);
  new MutationObserver((_, observer) => {
    if (!root.classList.contains('sz-leaving')) return;
    observer.disconnect();
    setTimeout(() => root.remove(), ${FADE_MS} + 50);
  }).observe(root, { attributes: true, attributeFilter: ['class'] });
  const mark = (at) => performance.mark(${JSON.stringify(PLACEHOLDER_PAINT_MARK)}, { startTime: at });
  if (PerformanceObserver.supportedEntryTypes?.includes('element')) {
    new PerformanceObserver((list, observer) => {
      const entry = list.getEntries().find((entry) => entry.identifier === ${JSON.stringify(PLACEHOLDER_ID)});
      if (!entry) return;
      mark(entry.renderTime || entry.startTime);
      observer.disconnect();
    }).observe({ type: 'element', buffered: true });
  } else {
    requestAnimationFrame(() => setTimeout(() => mark(performance.now())));
  }
})();`;

/** The placeholder's tags. Throws if `body` isn't inert markup, or if its
 *  text has a character the placeholder font lacks. */
function placeholderTags({ title, body }: PlaceholderOptions): HtmlTagDescriptor[] {
  if (/<(script|style|input|button|textarea|select|a)\b|\son\w+=/i.test(body)) {
    throw new Error('seiza placeholder: body must be inert markup (no scripts, handlers, links, or controls)');
  }
  // HTML collapses whitespace, so collapse it here too: between tags it
  // renders as nothing, and a newline isn't a character the font must have.
  const markup = `${titleBar(title)}<div class="sz-content">${body.trim().replace(/>\s+</g, '><').replace(/\s+/g, ' ')}</div>`;
  const outside = [...new Set(placeholderText(markup))].filter((char) => !PLACEHOLDER_CHARS.test(char));
  if (outside.length) {
    throw new Error(
      `seiza placeholder: ${outside.map((char) => JSON.stringify(char)).join(', ')} isn't in the placeholder font ` +
        '(printable ASCII and "…"; shared-web/fonts/make-placeholder-font.py)',
    );
  }
  const css = PLACEHOLDER_CSS.replace('{{FONT}}', readFileSync(fontUrl).toString('base64')).replace('{{SKELETON_KEYFRAMES}}', SKELETON_KEYFRAMES);
  return [
    // After the wasm and font preloads (`head-prepend`), so their downloads
    // start before the browser parses the inlined font.
    { tag: 'style', children: css.trim(), injectTo: 'head' },
    { tag: 'div', attrs: { id: PLACEHOLDER_ID, inert: true, 'aria-busy': 'true' }, children: markup, injectTo: 'body-prepend' },
    { tag: 'script', children: PLACEHOLDER_SCRIPT, injectTo: 'body-prepend' },
  ];
}

/** Injects the placeholder into the app's `index.html`, in dev and build. */
export function placeholderPlugin(options: PlaceholderOptions): Plugin {
  const tags = placeholderTags(options);
  return { name: 'seiza:placeholder', transformIndexHtml: () => tags };
}
