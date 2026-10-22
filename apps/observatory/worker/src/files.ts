/**
 * What the Worker serves and how, shared by the Worker (`index.ts`), the
 * deploy's staging (`scripts/stage.ts`), and the production check
 * (`scripts/check.ts`), so the three can't disagree. No Node or DOM.
 */

/** Extensions the deploy writes a quality-11 `<file>.br` beside, and the
 *  Worker serves that `.br` for. */
export const PRECOMPRESSED = ['html', 'js', 'css', 'wasm', 'ttf'];

/** The types the Worker sets itself (a `.br`'s own type is the asset's). */
export const CONTENT_TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript',
  css: 'text/css; charset=utf-8',
  wasm: 'application/wasm',
  ttf: 'font/ttf',
};

/** The paths the Worker serves builds under; anything else is a 404. */
export const BUILD_PREFIXES = ['/observatory/', '/fonts/'];

/**
 * A build file's `Cache-Control`, by path. The routes' HTML revalidates and
 * forbids transforms (Cloudflare's Web Analytics injects a beacon into HTML
 * otherwise, a request before first paint). Content-hashed names are
 * immutable: each build's `assets/`, and the engine's bundles directly in
 * `duckdb/` (`contenders/engine.ts`; the deploy checks each name carries a
 * hash). The engine's extensions (`duckdb/v<version>/…`, pinned by version,
 * not content) revalidate. The font has a stable name shared by every build
 * on the apex: a day, so a repeat visit's first paint doesn't wait on a
 * revalidation.
 */
export function cacheControl(path: string): string {
  if (path.endsWith('.html')) return 'no-cache, no-transform';
  if (path.startsWith('/fonts/')) return 'public, max-age=86400';
  if (/\/assets\/[^/]+$/.test(path) || /^\/observatory\/duckdb\/[^/]+$/.test(path)) return 'public, max-age=31536000, immutable';
  return 'no-cache';
}
