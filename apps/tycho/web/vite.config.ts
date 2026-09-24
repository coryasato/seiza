import { existsSync } from 'node:fs';
import { join, normalize, resolve, sep } from 'node:path';
import { defineConfig, type Connect, type Plugin } from 'vite';
import { seizaViteConfig } from '@seiza/web/vite';

/** `wrangler dev` (worker/scripts/dev.ts, WORKER_DEV_PORT), which serves
 *  /data/* from the local R2. Proxied so the page stays same-origin under COEP. */
const worker = { '/data/': { target: 'http://127.0.0.1:8787' } };

/**
 * A missing DuckDB extension is a 404, not Vite's SPA fallback. DuckDB
 * autoloads any extension a query needs from `/duckdb-ext/`, and only the
 * pinned ones are there (duckdb-extensions.json). Without this, a query that
 * needs, say, `json` would get `index.html` with a 200 and try to load it as
 * wasm. M8's Worker needs the same rule.
 */
function extensionMisses(): Plugin {
  const notFound =
    (dir: () => string): Connect.NextHandleFunction =>
    (req, res, next) => {
      const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
      if (!pathname.startsWith('/duckdb-ext/')) return next();
      const file = join(dir(), normalize(pathname));
      if (file.startsWith(dir() + sep) && existsSync(file)) return next();
      res.statusCode = 404;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end(`No such DuckDB extension build: ${pathname}`);
    };
  return {
    name: 'tycho:extension-misses',
    configureServer(server) {
      server.middlewares.use(notFound(() => server.config.publicDir));
    },
    configurePreviewServer(server) {
      server.middlewares.use(notFound(() => resolve(server.config.root, server.config.build.outDir)));
    },
  };
}

export default defineConfig(
  seizaViteConfig(
    {
      // What first paint waits on. DuckDB's bundles load after it and must not be listed here.
      preload: ['tycho_bg.wasm', 'IBMPlexSans-Regular.ttf'],
    },
    { plugins: [extensionMisses()], server: { proxy: worker }, preview: { proxy: worker } },
  ),
);
