import { readdirSync, readFileSync, statSync } from 'node:fs';
import type { OutgoingHttpHeaders } from 'node:http';
import { basename, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeConfig, type Connect, type Plugin, type Rolldown, type UserConfig } from 'vite';
import { brotli } from './brotli.ts';
import { FONTS } from './font.ts';
import { placeholderPlugin, type PlaceholderOptions } from './placeholder.ts';

/**
 * Cross-origin isolation headers. Every app sends them in dev, preview, and
 * production, so COEP problems show up on day one instead of at deploy.
 */
export const crossOriginIsolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
} as const;

type OnWarn = NonNullable<Rolldown.InputOptions['onwarn']>;

/** wasm-bindgen's generated glue binds `js_sys::eval` with a direct eval.
 *  It's generated code; keep the warning everywhere else. */
function ignoreWasmBindgenEval(next?: OnWarn): OnWarn {
  return (warning, warn) => {
    if (warning.code === 'EVAL' && warning.id?.includes('/pkg/')) return;
    if (next) next(warning, warn);
    else warn(warning);
  };
}

export interface SeizaViteOptions {
  /**
   * Source file names (basenames, e.g. `app_bg.wasm`) of the assets first
   * paint waits on: the app wasm and the one UI font. Only these are
   * preloaded, never engines or data, which load after first paint. The
   * build fails if one isn't in the bundle, so a rename can't drop a preload.
   * A path starting with `/` is a file served outside the bundle at a fixed
   * URL (a font under {@link serveDirs}' mount) and is preloaded as given.
   */
  preload: string[];
  /**
   * The static placeholder shell painted before the wasm arrives
   * (`placeholder.ts`): the app's first screen as inert HTML.
   * Optional; without it the page is blank until the first frame.
   */
  placeholder?: PlaceholderOptions;
}

const preloadTypes: Record<string, string> = { '.wasm': 'application/wasm', '.ttf': 'font/ttf', '.woff2': 'font/woff2' };

/**
 * Preloads the named assets from the HTML, so their downloads start while the
 * entry script is still loading instead of after it runs. `as=fetch` with
 * `crossorigin` (anonymous) matches the `fetch()` calls that consume them
 * (wasm-bindgen's `init` and the bootstrap's font fetch); a mismatch would
 * download them twice. Build only: dev serves unhashed files and doesn't
 * measure anything.
 */
function preloadCriticalAssets(names: string[]): Plugin {
  let base = '/';
  return {
    name: 'seiza:preload-critical-assets',
    apply: 'build',
    configResolved(config) {
      base = config.base;
    },
    transformIndexHtml(_html, ctx) {
      const assets = Object.values(ctx.bundle ?? {}).filter((output) => output.type === 'asset');
      return names.map((name) => {
        let href = name;
        if (!name.startsWith('/')) {
          const asset = assets.find((output) => output.originalFileNames.some((original) => basename(original) === name));
          if (!asset) throw new Error(`seiza: preload asset "${name}" isn't in the bundle`);
          href = `${base}${asset.fileName}`;
        }
        return {
          tag: 'link',
          attrs: {
            rel: 'preload',
            href,
            as: 'fetch',
            type: preloadTypes[extname(name)],
            crossorigin: '',
          },
          injectTo: 'head-prepend' as const,
        };
      });
    },
  };
}

const contentTypes: Record<string, string> = {
  '.wasm': 'application/wasm',
  '.js': 'text/javascript',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
};

/** Quality-11 brotli bodies kept in memory, keyed by path, size, and mtime,
 *  so a measured request pays no hashing or compression production wouldn't. */
function brotliBodies(): (file: string) => Buffer | null {
  const cache = new Map<string, { size: number; mtimeMs: number; body: Buffer }>();
  return (file) => {
    let stat;
    try {
      stat = statSync(file);
    } catch {
      return null;
    }
    if (!stat.isFile()) return null;
    const hit = cache.get(file);
    if (hit && hit.size === stat.size && hit.mtimeMs === stat.mtimeMs) return hit.body;
    const body = brotli(readFileSync(file));
    cache.set(file, { size: stat.size, mtimeMs: stat.mtimeMs, body });
    return body;
  };
}

/** One cache for every preview server in the process: `previewBrotli`'s
 *  build and `serveDirs`' mounts can hold the same files. */
const previewBodies = brotliBodies();

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]));

/** The request's path, decoded; null for a malformed escape (Vite answers it). */
function requestPath(url: string | undefined): string | null {
  try {
    return decodeURIComponent(new URL(url ?? '/', 'http://x').pathname);
  } catch {
    return null;
  }
}

/** The file `rest` (a path under a served directory, from its `/`) names in
 *  `dir`, `index.html` for a directory's path; null outside `dir`. */
function fileUnder(dir: string, rest: string): string | null {
  const file = join(dir, normalize(rest.endsWith('/') ? `${rest}index.html` : rest));
  return file.startsWith(dir + sep) ? file : null;
}

/**
 * Serves the build brotli-compressed in `vite preview`, as production does,
 * so throttled perf runs download what a real visitor downloads. Uses the
 * same quality-11 cache as `asset-sizes.ts`. Compressed bodies are prepared
 * when the server starts and kept in memory (`brotliBodies`). Responses carry
 * the configured preview headers (COOP/COEP plus any the app adds). Requests
 * without `br` and other files fall through to Vite's static server;
 * `perf.ts` fails a run whose wasm arrives uncompressed.
 */
function previewBrotli(): Plugin {
  return {
    name: 'seiza:preview-brotli',
    configurePreviewServer(server) {
      const outDir = resolve(server.config.root, server.config.build.outDir);
      const headers = server.config.preview.headers ?? {};
      const compressed = previewBodies;
      try {
        for (const file of walk(outDir)) if (extname(file) in contentTypes) compressed(file);
      } catch {
        // No build yet; requests fall through to Vite, which reports it.
      }

      server.middlewares.use((req, res, next) => {
        const accepts = String(req.headers['accept-encoding'] ?? '').includes('br');
        const pathname = requestPath(req.url);
        // Middlewares see the URL before Vite strips its base; the build
        // directory has no base in its paths.
        const base = server.config.base.startsWith('/') ? server.config.base : '/';
        if (pathname === null || !pathname.startsWith(base)) return next();
        const file = fileUnder(outDir, pathname.slice(base.length - 1));
        const type = file && contentTypes[extname(file)];
        if (!accepts || !file || !type) return next();
        const body = compressed(file);
        if (!body) return next();
        res.writeHead(200, {
          ...headers,
          'Content-Type': type,
          'Content-Encoding': 'br',
          'Content-Length': body.length,
          'Cache-Control': 'no-cache',
          Vary: 'Accept-Encoding',
        });
        res.end(req.method === 'HEAD' ? undefined : body);
      });
    },
  };
}

/** `fonts/`, the one copy every build serves. */
const fontsDir = fileURLToPath(new URL('../fonts/', import.meta.url));

/** `fonts/` at {@link FONTS} (`font.ts`), by {@link serveDirs}. */
export const serveFonts = (): Plugin => serveDirs([{ at: FONTS, dir: fontsDir }]);

/** A directory served at a fixed URL path by {@link serveDirs}. */
export interface Mount {
  /** The path it's served at, starting and ending in `/`. */
  at: string;
  /** The directory, absolute or from the app's root. */
  dir: string;
  /** The directory in preview, if it isn't `dir` (the build's copy of a
   *  public directory, say). */
  preview?: string;
}

/**
 * Serves each directory at its path in dev and preview, outside the app's
 * base: for what several builds on one origin share at one URL (the site's
 * fonts at `/fonts/`, an engine several builds load), which no one build
 * emits. In preview, brotli as `previewBrotli` serves the build (compressed
 * as the server starts, one cache for both); in dev, as is. A path inside
 * another mount's goes to the longer one. The server's headers
 * (COOP/COEP) go on every response, with `Cross-Origin-Resource-Policy:
 * same-origin`, as the deploy's `_headers` gives assets. A missing file
 * under a mount is a 404, never the SPA fallback. A production server
 * needs the same paths (the deploy stages them).
 */
export function serveDirs(mounts: Mount[]): Plugin {
  for (const { at } of mounts) if (!at.startsWith('/') || !at.endsWith('/')) throw new Error(`seiza: a mount's path must start and end with "/"; got "${at}"`);
  // The longest path first, so a mount inside another wins whatever the order given.
  const ordered = [...mounts].sort((a, b) => b.at.length - a.at.length);
  const dirOf = (root: string, preview: boolean, mount: Mount) => resolve(root, (preview && mount.preview) || mount.dir);
  const serve =
    (root: string, preview: boolean, headers: OutgoingHttpHeaders): Connect.NextHandleFunction =>
    (req, res, next) => {
      const pathname = requestPath(req.url);
      const mount = pathname === null ? undefined : ordered.find(({ at }) => pathname.startsWith(at));
      if (!mount || pathname === null) return next();
      const file = fileUnder(dirOf(root, preview, mount), pathname.slice(mount.at.length - 1));
      let found = false;
      try {
        found = !!file && statSync(file).isFile();
      } catch {
        // Missing: a 404 below.
      }
      const common = { ...headers, 'Cross-Origin-Resource-Policy': 'same-origin', 'Cache-Control': 'no-cache', Vary: 'Accept-Encoding' };
      if (!file || !found) {
        res.writeHead(404, { ...common, 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(`Not found: ${pathname}`);
        return;
      }
      const type = contentTypes[extname(file)] ?? 'application/octet-stream';
      // Brotli from memory in preview; the file itself in dev, or for a
      // client without br.
      const br = preview && String(req.headers['accept-encoding'] ?? '').includes('br') ? previewBodies(file) : null;
      const body = br ?? readFileSync(file);
      res.writeHead(200, { ...common, 'Content-Type': type, 'Content-Length': body.length, ...(br ? { 'Content-Encoding': 'br' } : {}) });
      res.end(req.method === 'HEAD' ? undefined : body);
    };
  return {
    name: 'seiza:serve-dirs',
    // Before the app's own static and brotli servers, which would answer
    // nothing outside the base, or a page's fallback.
    enforce: 'pre',
    configureServer(server) {
      server.middlewares.use(serve(server.config.root, false, server.config.server.headers ?? {}));
    },
    configurePreviewServer(server) {
      // Compressed as the server starts, as `previewBrotli` does the build,
      // so a measured request pays no compression.
      for (const mount of ordered) {
        try {
          for (const file of walk(dirOf(server.config.root, true, mount))) if (extname(file) in contentTypes) previewBodies(file);
        } catch {
          // Not built yet: its requests 404, which says so.
        }
      }
      server.middlewares.use(serve(server.config.root, true, server.config.preview.headers ?? {}));
    },
  };
}

/**
 * Writes `_headers` into the build for Cloudflare Workers static assets
 * (every app's host; root CLAUDE.md, "Hosting"), which serve a matched asset
 * without running the app's Worker: the isolation headers on every asset, and
 * `immutable` on Vite's content-hashed `assets/`. Cloudflare reads the file
 * and doesn't serve it. HTML keeps Cloudflare's default (revalidate).
 */
function cloudflareHeaders(): Plugin {
  let base = '/';
  return {
    name: 'seiza:cloudflare-headers',
    apply: 'build',
    configResolved(config) {
      base = config.base;
    },
    generateBundle() {
      const rule = (path: string, headers: Record<string, string>) =>
        [path, ...Object.entries(headers).map(([name, value]) => `  ${name}: ${value}`)].join('\n');
      const source = [
        rule(`${base}*`, { ...crossOriginIsolationHeaders, 'Cross-Origin-Resource-Policy': 'same-origin' }),
        rule(`${base}assets/*`, { 'Cache-Control': 'public, max-age=31536000, immutable' }),
      ].join('\n');
      this.emitFile({ type: 'asset', fileName: '_headers', source: `${source}\n` });
    },
  };
}

/**
 * The Vite config every app's host starts from. `options.preload` names the
 * assets first paint waits on. `overrides` are deep-merged with Vite's
 * `mergeConfig`. The COOP/COEP headers and the wasm-bindgen
 * warning filter always survive: an app can add headers or its own `onwarn`,
 * but can't drop either.
 */
export function seizaViteConfig(options: SeizaViteOptions, overrides: UserConfig = {}): UserConfig {
  const base: UserConfig = {
    plugins: [
      preloadCriticalAssets(options.preload),
      previewBrotli(),
      cloudflareHeaders(),
      ...(options.placeholder ? [placeholderPlugin(options.placeholder)] : []),
    ],
    server: { headers: crossOriginIsolationHeaders },
    preview: { headers: crossOriginIsolationHeaders },
    build: {
      target: 'esnext',
      // Report real sizes; `just <app> build` prints raw/gzip/brotli itself.
      reportCompressedSize: false,
    },
  };
  const merged = mergeConfig(base, overrides);
  return mergeConfig(merged, {
    server: { headers: crossOriginIsolationHeaders },
    preview: { headers: crossOriginIsolationHeaders },
    build: { rolldownOptions: { onwarn: ignoreWasmBindgenEval(overrides.build?.rolldownOptions?.onwarn) } },
  });
}
