import { createReadStream, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, type Connect, type Plugin } from 'vite';
import { brotli } from '@seiza/web/brotli';
import { crossOriginIsolationHeaders, seizaViteConfig } from '@seiza/web/vite';
import { BASE } from './src/base.ts';
import { NOT_PHONE } from './src/phone.ts';

const root = import.meta.dirname;

/** The files the page asks for, and the script in data/ that writes each:
 *  the two the crate holds, and the sky's. */
const DATA: Record<string, string> = { 'elements.bin': 'prep.ts', 'rows.bin': 'prep.ts', 'stars.bin': 'stars.ts' };

/**
 * Serves those files at `data/` under the app's base, as they are (or, asked, compressed), in dev and preview: nothing
 * else of `data/` (never `data/raw/`). They aren't part of the build: 97 MB
 * that a deploy puts where it serves data from.
 */
function serveData(): Plugin {
  let base = '/';
  const serve: Connect.NextHandleFunction = (req, res, next) => {
    const path = req.url?.split('?')[0] ?? '';
    const name = path.startsWith(`${base}data/`) ? path.slice(base.length + 5) : '';
    if (!name || name.includes('/')) return next();
    const headers = { ...crossOriginIsolationHeaders, 'Cross-Origin-Resource-Policy': 'same-origin', 'Cache-Control': 'no-cache' };
    let size: number | undefined;
    try {
      if (Object.hasOwn(DATA, name)) size = statSync(join(root, '../data', name)).size;
    } catch {
      // Not built: a 404 that says how.
    }
    if (size === undefined) {
      res.writeHead(404, { ...headers, 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(Object.hasOwn(DATA, name) ? `no data/${name}: run data/${DATA[name]}` : `Not found: /data/${name}`);
      return;
    }
    // As a deploy would send them, when asked (`KIRKWOOD_DATA=br`, which
    // the slow-link check sets): each file at brotli 11, compressed once
    // (a minute or two a file) and kept in shared-web's cache.
    if (process.env.KIRKWOOD_DATA === 'br' && /\bbr\b/.test(String(req.headers['accept-encoding'] ?? ''))) {
      const body = brotli(readFileSync(join(root, '../data', name)));
      res.writeHead(200, { ...headers, 'Content-Type': 'application/octet-stream', 'Content-Encoding': 'br', 'Content-Length': body.length });
      res.end(req.method === 'HEAD' ? undefined : body);
      return;
    }
    res.writeHead(200, { ...headers, 'Content-Type': 'application/octet-stream', 'Content-Length': size });
    if (req.method === 'HEAD') res.end();
    else createReadStream(join(root, '../data', name)).pipe(res);
  };
  return {
    name: 'kirkwood:data',
    enforce: 'pre',
    configResolved: (config) => void (base = config.base.startsWith('/') ? config.base : '/'),
    configureServer: (server) => void server.middlewares.use(serve),
    configurePreviewServer: (server) => void server.middlewares.use(serve),
  };
}

/**
 * The HTML's preloads (the wasm and the font) carry the media query a
 * phone doesn't match: a phone's page asks for neither unless it opens the
 * app anyway (`src/phone.ts`). Everything else preloads them as before.
 */
function preloadUnlessPhone(): Plugin {
  return {
    name: 'kirkwood:preload-unless-phone',
    // (The preloads are a build's: the dev server's page has none.)
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler: (html) => {
        // After the viewport's tag, too: a browser weighs a preload's
        // media as it reads the link, and before that tag a phone's
        // window is still the 980 px a page without one gets.
        const links: string[] = [];
        const rest = html.replace(/[ \t]*<link rel="preload" [^>]*>\n?/g, (link) => {
          links.push(link.trim().replace('<link rel="preload" ', `<link rel="preload" media="${NOT_PHONE}" `));
          return '';
        });
        const viewport = /<meta name="viewport"[^>]*>/.exec(rest);
        if (!viewport || !links.length) throw new Error("the page's preloads or its viewport tag weren't found");
        const at = viewport.index + viewport[0].length;
        return `${rest.slice(0, at)}\n    ${links.join('\n    ')}${rest.slice(at)}`;
      },
    },
  };
}

export default defineConfig(
  seizaViteConfig(
    {
      // What first paint waits on: the app's wasm and the UI font. Never
      // the data, which is asked for after the first frame.
      preload: ['kirkwood_bg.wasm', 'IBMPlexSans-Regular.ttf'],
    },
    { root, base: BASE, plugins: [serveData(), preloadUnlessPhone()] },
  ),
);
