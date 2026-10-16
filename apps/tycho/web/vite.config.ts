import { defineConfig } from 'vite';
import { duckdb } from '@seiza/duckdb/vite';
import { PLACEHOLDER_ID } from '@seiza/web/placeholder';
import { seizaViteConfig } from '@seiza/web/vite';

/** `wrangler dev` (worker/scripts/dev.ts, WORKER_DEV_PORT), which serves
 *  /data/* from the local R2. Proxied so the page stays same-origin under COEP. */
const worker = { '/data/': { target: 'http://127.0.0.1:8787' } };

/** Lucide's moon and sun (ISC license), as gpui-kit-assets 0.7.3 embeds them. */
const ICONS = {
  moon: '<path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
};

const themeButton = (switchesTo: 'dark' | 'light', icon: keyof typeof ICONS) =>
  `<span class="sz-button sz-icon-button sz-theme-${switchesTo}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[icon]}</svg></span>`;

/**
 * The title bar `crate/src/shell.rs` draws: the title (`TITLE` there; its
 * paint is the placeholder's), the theme button (the icon of the theme it switches to),
 * and the observation panel's.
 */
const titleBar = `
<div class="sz-title-bar">
  <span class="sz-title" elementtiming="${PLACEHOLDER_ID}">Tycho</span>
  <span class="sz-title-actions">${themeButton('dark', 'moon')}${themeButton('light', 'sun')}<span class="sz-button">Observation panel</span></span>
</div>`;

/**
 * The empty state `crate/src/workbench.rs` draws first (`render_empty`), as
 * the static placeholder shell shows it, below the title bar, until the first
 * frame. Keep the two matched: `just tycho placeholder` compares screenshots
 * of both. The status
 * line says "Engine loading…" as the first frame does: the placeholder is up
 * for a few hundred ms at most, too short to read a different line, which
 * only looked like one more jump. The three buttons ("Open a file…", the two
 * samples) are skeletons, gpui-kit's look: the browser and GPUI draw glyphs
 * differently, and the labels jumped at the swap. Their
 * widths are GPUI's, which measures text its own way and lays out in whole
 * pixels; read them from `__seizaTargets` (`?bench`) after a label change.
 * The check's box comparison fails until they match.
 */
const emptyState = `
<div class="sz-p-4"><div class="sz-empty">
  <div class="sz-empty-header">
    <div class="sz-empty-title">Drop a Parquet or CSV file</div>
    <div class="sz-empty-description">Files stay on this device.</div>
  </div>
  <div class="sz-empty-content">
    <div class="sz-row">
      <span class="sz-skeleton sz-skeleton-button" style="width: 99px"></span>
      <span class="sz-skeleton sz-skeleton-button" style="width: 233px"></span>
      <span class="sz-skeleton sz-skeleton-button" style="width: 144px"></span>
    </div>
    <div class="sz-text-xs sz-muted">Engine loading…</div>
  </div>
</div></div>`;

export default defineConfig(
  seizaViteConfig(
    {
      // What first paint waits on. DuckDB's bundles load after it and must not be listed here.
      preload: ['tycho_bg.wasm', 'IBMPlexSans-Regular.ttf'],
      placeholder: { body: `${titleBar}<div class="sz-content">${emptyState}</div>` },
    },
    { plugins: [duckdb()], server: { proxy: worker }, preview: { proxy: worker } },
  ),
);
