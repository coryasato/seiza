/**
 * What a Vite host needs to serve the engine. Add `duckdb()` to the config's
 * plugins; the host still sends COOP/COEP (`@seiza/web/vite` does) and fills
 * `public/duckdb-ext/` with `scripts/extensions.ts`.
 */

import { existsSync } from 'node:fs';
import { join, normalize, resolve, sep } from 'node:path';
import type { Connect, Plugin } from 'vite';
import { EXTENSION_REPOSITORY } from './extensions.ts';

/**
 * A missing DuckDB extension is a 404, not Vite's SPA fallback. DuckDB
 * installs an extension a `LOAD` names from `/duckdb-ext/`, and only the
 * pinned ones are there (duckdb-extensions.json). Without this, a `LOAD` of,
 * say, `json` would get `index.html` with a 200 and try to load it as wasm.
 * A production server needs the same rule.
 */
export function duckdb(): Plugin {
  const prefix = `${EXTENSION_REPOSITORY}/`;
  const notFound =
    (dir: () => string): Connect.NextHandleFunction =>
    (req, res, next) => {
      const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
      if (!pathname.startsWith(prefix)) return next();
      const file = join(dir(), normalize(pathname));
      if (file.startsWith(dir() + sep) && existsSync(file)) return next();
      res.statusCode = 404;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end(`No such DuckDB extension build: ${pathname}`);
    };
  return {
    name: 'seiza:duckdb',
    configureServer(server) {
      server.middlewares.use(notFound(() => server.config.publicDir));
    },
    configurePreviewServer(server) {
      server.middlewares.use(notFound(() => resolve(server.config.root, server.config.build.outDir)));
    },
  };
}
