/**
 * Kirkwood's Worker: the app and its three files under `/kirkwood/` on
 * Tycho's hostname, by a route that runs before Tycho's Worker
 * (wrangler.toml; docs/DECISIONS.md, "Hosting").
 *
 * - The build (web/dist, `[assets]`) has no base in its paths, so every
 *   request runs this Worker, which takes the base off. A browser that takes
 *   br gets the file's quality-11 `.br` as it is (scripts/stage.ts writes
 *   them): Cloudflare's own compression is far weaker (.claude/rules/cloudflare.md).
 * - The three files are in R2, each as it is and as `<name>.br`, under a key
 *   that has the file's hash in it (src/versions.ts): two of them
 *   are over the 25 MiB a static asset may be, and one still is at brotli 11.
 *   Each is read whole, never by range. A browser that holds a copy is
 *   answered 304 (the names are stable, so a copy is always asked about).
 * - Anything else is a 404, never the page.
 */

import { accepts } from '../../../../shared-web/src/encoding.ts';
import { BASE } from '../../web/src/base.ts';
import { CONTENT_TYPES, FILES, PAUSED_HEADER, PRECOMPRESSED } from './names.ts';
import { keyOf } from './versions.ts';

export interface Env {
  KIRKWOOD_DATA: R2Bucket;
  ASSETS: Fetcher;
  /** `1` while the data is paused: every file is a 503 and nothing reads R2.
   *  A secret, not a var, so a deploy keeps it. */
  DATA_PAUSED?: string;
}

const DATA = 'data/';
const ASSETS = 'assets/';

/** Every response is same-origin, cross-origin isolated content. */
const ISOLATION_HEADERS = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    // The base without its slash: relative URLs in the page would resolve
    // against the origin's root, which is Tycho's.
    if (`${url.pathname}/` === BASE) return new Response(null, { status: 301, headers: { ...ISOLATION_HEADERS, Location: `${BASE}${url.search}` } });
    if (!url.pathname.startsWith(BASE)) return text(404, 'Not found');
    if (request.method !== 'GET' && request.method !== 'HEAD') return text(405, 'Method not allowed', { Allow: 'GET, HEAD' });
    const path = url.pathname.slice(BASE.length);
    // No empty segment: `//x/…` after the base would name a file by a path
    // the page doesn't live at (and, as a URL, a host).
    if (path.startsWith('/') || path.includes('//')) return text(404, 'Not found');
    if (path.startsWith(DATA)) return serveData(request, env, path.slice(DATA.length));
    return serveBuild(request, env, url, path === '' ? 'index.html' : path);
  },
} satisfies ExportedHandler<Env>;

/** A build file by its path in web/dist: its `.br` if the browser takes it, else the file. */
async function serveBuild(request: Request, env: Env, url: URL, path: string): Promise<Response> {
  const extension = path.split('.').pop() ?? '';
  const type = CONTENT_TYPES[extension];
  const headers = {
    ...ISOLATION_HEADERS,
    ...(type ? { 'Content-Type': type } : {}),
    // assets/ names are content-hashed; the page revalidates, and is
    // no-transform: Cloudflare's Web Analytics injects a script into HTML
    // unless the response forbids transforms.
    'Cache-Control': path.startsWith(ASSETS) ? 'public, max-age=31536000, immutable' : extension === 'html' ? 'no-cache, no-transform' : 'no-cache',
    Vary: 'Accept-Encoding',
  };
  // The request's own headers go along, so If-None-Match still gets a 304.
  const asset = (file: string) => env.ASSETS.fetch(new Request(`${url.origin}/${file}`, request));
  if (PRECOMPRESSED.includes(extension) && accepts(request, 'br')) {
    const compressed = await asset(`${path}.br`);
    if (compressed.status === 200 || compressed.status === 304) {
      const etag = compressed.headers.get('ETag');
      const length = compressed.headers.get('Content-Length');
      return new Response(compressed.status === 304 || request.method === 'HEAD' ? null : compressed.body, {
        status: compressed.status,
        headers: { ...headers, 'Content-Encoding': 'br', ...(etag ? { ETag: etag } : {}), ...(length && compressed.status === 200 ? { 'Content-Length': length } : {}) },
        // The body is already brotli; don't let the runtime encode it again.
        encodeBody: 'manual',
      });
    }
    await compressed.body?.cancel();
  }
  // The `.br` copies are never served by name.
  const plain = extension === 'br' ? null : await asset(path);
  if (!plain || (plain.status !== 200 && plain.status !== 304)) {
    await plain?.body?.cancel();
    return text(404, 'Not found');
  }
  const response = new Response(plain.body, plain);
  for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
  return response;
}

/** One of the three files, whole: its `.br` object if the browser takes br, else the file. */
async function serveData(request: Request, env: Env, name: string): Promise<Response> {
  const file = FILES.includes(name) ? keyOf(name) : undefined;
  if (!file) return text(404, 'Not found');
  // no-store: a cached 503 would outlive the pause.
  if (env.DATA_PAUSED === '1') return text(503, 'The data is paused.', { [PAUSED_HEADER]: '1', 'Cache-Control': 'no-store' });
  const br = accepts(request, 'br');
  const key = br ? `${file}.br` : file;
  const headersFor = (object: R2Object) => ({
    ...ISOLATION_HEADERS,
    'Content-Type': 'application/octet-stream',
    ETag: object.httpEtag,
    // A stable name: a copy is asked about every time. The `.br` goes out
    // as it is; the file itself Cloudflare may compress.
    'Cache-Control': br ? 'no-cache, no-transform' : 'no-cache',
    Vary: 'Accept-Encoding',
    ...(br ? { 'Content-Encoding': 'br' } : {}),
  });
  const encodeBody = br ? ('manual' as const) : ('automatic' as const);
  // The one condition answered is If-None-Match, a browser asking about its
  // copy; any other (If-Match, the dates) is ignored, never a 304.
  const asked = request.headers.get('If-None-Match');
  if (request.method === 'HEAD') {
    const object = await env.KIRKWOOD_DATA.head(key);
    if (!object) return text(404, 'Not found');
    if (asked && holds(asked, object.httpEtag)) return new Response(null, { status: 304, headers: headersFor(object) });
    return new Response(null, { headers: { ...headersFor(object), 'Content-Length': String(object.size) }, encodeBody });
  }
  const object = await env.KIRKWOOD_DATA.get(key, asked ? { onlyIf: new Headers({ 'If-None-Match': asked }) } : {});
  if (!object) return text(404, 'Not found');
  // The browser's copy is this object: R2 hands back no body.
  if (!('body' in object)) return new Response(null, { status: 304, headers: headersFor(object) });
  return new Response(object.body, { headers: { ...headersFor(object), 'Content-Length': String(object.size) }, encodeBody });
}

/** Whether an If-None-Match header names `etag` (compared weakly), or any. */
function holds(header: string, etag: string): boolean {
  const weak = (tag: string) => tag.trim().replace(/^W\//, '');
  return header.split(',').some((tag) => tag.trim() === '*' || weak(tag) === weak(etag));
}

function text(status: number, body: string, headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers: { ...ISOLATION_HEADERS, 'Content-Type': 'text/plain; charset=utf-8', ...headers } });
}
