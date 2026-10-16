/**
 * Serves the observatory's data file (`data/`, built by `just observatory
 * data`) under `<base>data/` in a contender's Vite dev and preview servers,
 * by byte range, as production's Worker does (`worker/src/index.ts`): a
 * ranged GET or HEAD gets a 206 with Content-Range, no Content-Encoding,
 * `no-cache, no-transform`, and the isolation headers. DuckDB-Wasm reads
 * Parquet only by range, and Vite's own static server would answer a missing
 * file with its SPA fallback.
 */

import { createReadStream, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Connect, Plugin } from 'vite';

const dataDir = fileURLToPath(new URL('../data/', import.meta.url));

const HEADERS = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Cache-Control': 'no-cache, no-transform',
  'Accept-Ranges': 'bytes',
};

export function observatoryData(): Plugin {
  let prefix = '/data/';
  const serve: Connect.NextHandleFunction = (req, res, next) => {
    // Middlewares see the URL before Vite strips its base.
    const path = new URL(req.url ?? '/', 'http://x').pathname;
    if (!path.startsWith(prefix)) return next();
    const fail = (status: number, message: string, headers: Record<string, string> = {}) => {
      res.writeHead(status, { ...HEADERS, 'Content-Type': 'text/plain; charset=utf-8', ...headers });
      res.end(message);
    };
    if (req.method !== 'GET' && req.method !== 'HEAD') return fail(405, 'GET or HEAD only', { Allow: 'GET, HEAD' });
    const name = path.slice(prefix.length);
    if (!/^[\w-]+\.parquet$/.test(name)) return fail(404, 'Not found');
    const file = join(dataDir, name);
    let size: number;
    try {
      size = statSync(file).size;
    } catch {
      return fail(404, `Not found: run \`just observatory data\` to build ${name}`);
    }
    let [start, end] = [0, size - 1];
    const range = req.headers.range;
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      const [from, to] = [match?.[1], match?.[2]];
      if (match && from) [start, end] = [Number(from), to ? Math.min(Number(to), size - 1) : size - 1];
      else if (match && to) [start, end] = [Math.max(0, size - Number(to)), size - 1];
      if (!match || (!from && !to) || start > end || start >= size) return fail(416, 'Range Not Satisfiable', { 'Content-Range': `bytes */${size}` });
    }
    res.writeHead(range ? 206 : 200, {
      ...HEADERS,
      'Content-Type': 'application/vnd.apache.parquet',
      'Content-Length': String(end - start + 1),
      ...(range ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}),
    });
    if (req.method === 'HEAD') return res.end();
    createReadStream(file, { start, end }).pipe(res);
  };
  return {
    name: 'observatory:data',
    configResolved(config) {
      prefix = `${config.base}data/`;
    },
    configureServer(server) {
      server.middlewares.use(serve);
    },
    configurePreviewServer(server) {
      server.middlewares.use(serve);
    },
  };
}
