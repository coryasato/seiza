import { createReadStream, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, type Connect, type Plugin } from 'vite';
import { brotli } from '@seiza/web/brotli';
import { crossOriginIsolationHeaders, seizaViteConfig } from '@seiza/web/vite';

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

export default defineConfig(
  seizaViteConfig(
    {
      // What first paint waits on: the app's wasm and the UI font. Never
      // the data, which is asked for after the first frame.
      preload: ['kirkwood_bg.wasm', 'IBMPlexSans-Regular.ttf'],
    },
    { root, plugins: [serveData()] },
  ),
);
