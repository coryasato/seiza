/**
 * What a Vite host needs to serve the engine. Add `duckdb()` to the config's
 * plugins; the host still sends COOP/COEP (`@seiza/web/vite` does) and fills
 * its extension directory (`public/duckdb-ext/` by default) with
 * `scripts/extensions.ts`.
 */

import { existsSync } from 'node:fs';
import { join, normalize, resolve, sep } from 'node:path';
import type { Connect, Plugin } from 'vite';
import { extensionDir } from './extensions.ts';

export interface DuckdbPluginOptions {
  /** The extension directory under the host's base, the same name the host
   *  gives `createBridge`; `duckdb-ext` by default. */
  extensionDir?: string;
}

/**
 * A missing DuckDB extension is a 404, not Vite's SPA fallback. DuckDB
 * installs an extension a `LOAD` names from `<base><extensionDir>/`, and only
 * the pinned ones are there (duckdb-extensions.json). Without this, a `LOAD`
 * of, say, `json` would get `index.html` with a 200 and try to load it as
 * wasm. A production server needs the same rule.
 */
export function duckdb(options: DuckdbPluginOptions = {}): Plugin {
  const dir = extensionDir(options.extensionDir);
  let base = '/';
  const notFound =
    (root: () => string): Connect.NextHandleFunction =>
    (req, res, next) => {
      // Plugin middlewares see the URL before Vite strips its base. The
      // prefix is plain ASCII (`extensionDir`), so it matches before decoding.
      const raw = new URL(req.url ?? '/', 'http://x').pathname;
      const prefix = `${base}${dir}/`;
      if (!raw.startsWith(prefix)) return next();
      let found = false;
      try {
        // The files sit in the public or build directory without the base.
        const own = join(root(), dir);
        const file = join(own, normalize(decodeURIComponent(raw.slice(prefix.length))));
        found = file.startsWith(own + sep) && existsSync(file);
      } catch {
        // A malformed escape names no file.
      }
      if (found) return next();
      res.statusCode = 404;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end(`No such DuckDB extension build: ${raw}`);
    };
  return {
    name: 'seiza:duckdb',
    configResolved(config) {
      base = config.base;
    },
    configureServer(server) {
      server.middlewares.use(notFound(() => server.config.publicDir));
    },
    configurePreviewServer(server) {
      server.middlewares.use(notFound(() => resolve(server.config.root, server.config.build.outDir)));
    },
  };
}
