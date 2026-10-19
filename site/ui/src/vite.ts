/**
 * What a site page's Vite config adds (`siteVite()`): Tailwind v4, the
 * theme script inline at the head of the `<head>` (before first paint), and
 * the site's font at `/fonts/` in dev and preview (`@seiza/web`'s
 * `serveFonts`; the deploy stages it there).
 */

import tailwindcss from '@tailwindcss/vite';
import type { PluginOption } from 'vite';
import { serveFonts } from '@seiza/web/vite';
import { THEME_SCRIPT } from './theme.ts';

export function siteVite(): PluginOption[] {
  return [tailwindcss(), serveFonts(), { name: 'site:theme', transformIndexHtml: () => [{ tag: 'script', children: THEME_SCRIPT, injectTo: 'head-prepend' }] }];
}
