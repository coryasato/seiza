import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, join, normalize, resolve, sep } from 'node:path';
import { mergeConfig, type Plugin, type Rolldown, type UserConfig } from 'vite';
import { brotli } from './brotli.ts';
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
   */
  preload: string[];
  /**
   * The static placeholder shell painted before the wasm arrives
   * (`placeholder.ts`): the title and the app's empty state as inert HTML.
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
        const asset = assets.find((output) => output.originalFileNames.some((original) => basename(original) === name));
        if (!asset) throw new Error(`seiza: preload asset "${name}" isn't in the bundle`);
        return {
          tag: 'link',
          attrs: {
            rel: 'preload',
            href: `${base}${asset.fileName}`,
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
};

/**
 * Serves the build brotli-compressed in `vite preview`, as production does,
 * so throttled perf runs download what a real visitor downloads. Uses the
 * same quality-11 cache as `asset-sizes.ts`. Compressed bodies are prepared
 * when the server starts and kept in memory (keyed by path, size, and mtime),
 * so a measured request pays no hashing or compression that production
 * wouldn't. Responses carry the configured preview headers (COOP/COEP plus any
 * the app adds). Requests without `br` and other files fall through to Vite's
 * static server; `perf.ts` fails a run whose wasm arrives uncompressed.
 */
function previewBrotli(): Plugin {
  return {
    name: 'seiza:preview-brotli',
    configurePreviewServer(server) {
      const outDir = resolve(server.config.root, server.config.build.outDir);
      const headers = server.config.preview.headers ?? {};
      const cache = new Map<string, { size: number; mtimeMs: number; body: Buffer }>();
      const compressed = (file: string): Buffer | null => {
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
      const walk = (dir: string): string[] =>
        readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
          entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)],
        );
      try {
        for (const file of walk(outDir)) if (extname(file) in contentTypes) compressed(file);
      } catch {
        // No build yet; requests fall through to Vite, which reports it.
      }

      server.middlewares.use((req, res, next) => {
        const accepts = String(req.headers['accept-encoding'] ?? '').includes('br');
        const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
        const file = join(outDir, normalize(pathname.endsWith('/') ? `${pathname}index.html` : pathname));
        const type = contentTypes[extname(file)];
        if (!accepts || !type || !file.startsWith(outDir + sep)) return next();
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
