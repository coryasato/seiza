/**
 * Tycho's Worker: serves `/data/*` from R2 with byte ranges, and every other
 * path from static assets (added in M8; until then, 404).
 *
 * DuckDB-Wasm reads remote Parquet by range: a probe (`bytes=0-0`, from
 * `web/src/engine.ts`), then the footer, then column chunks. So this must
 * answer ranges exactly: `206` with a correct `Content-Range`, `416` for a
 * range past the end, and `HEAD` with `Content-Length` and
 * `Accept-Ranges: bytes`. Multi-range requests aren't needed and get `416`.
 */

interface Env {
  TYCHO_DATA: R2Bucket;
  /** Static assets (web/dist), from M8. */
  ASSETS?: Fetcher;
}

const DATA_PREFIX = '/data/';

/** Every response is same-origin, cross-origin isolated content. */
const ISOLATION_HEADERS = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

const CONTENT_TYPES: Record<string, string> = {
  parquet: 'application/vnd.apache.parquet',
  csv: 'text/csv; charset=utf-8',
  json: 'application/json',
};

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith(DATA_PREFIX)) return serveData(request, env, url.pathname.slice(DATA_PREFIX.length));
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return text(404, 'Not found');
  },
} satisfies ExportedHandler<Env>;

async function serveData(request: Request, env: Env, rawKey: string): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return text(405, 'Method not allowed', { Allow: 'GET, HEAD' });
  }
  let key: string;
  try {
    key = decodeURIComponent(rawKey);
  } catch {
    return text(400, 'Bad path');
  }
  if (key === '' || key.split('/').some((part) => part === '' || part === '.' || part === '..')) return text(404, 'Not found');

  const range = parseRange(request.headers.get('Range'));
  if (request.method === 'HEAD' || range === 'unsatisfiable') {
    const object = await env.TYCHO_DATA.head(key);
    if (!object) return text(404, 'Not found');
    if (range === 'unsatisfiable') return rangeNotSatisfiable(object.size);
    if (!range) return new Response(null, { headers: dataHeaders(object, { 'Content-Length': String(object.size) }) });
    // A ranged HEAD gets the headers the ranged GET would. DuckDB-Wasm sizes
    // an HTTP file with `HEAD` + `Range: bytes=0-` and reads by range only if
    // that answers 206 with a Content-Length; otherwise it downloads the file.
    if ('offset' in range && (range.offset ?? 0) >= object.size) return rangeNotSatisfiable(object.size);
    return new Response(null, { status: 206, headers: partialHeaders(object, range) });
  }

  let object: R2ObjectBody | null;
  try {
    object = await env.TYCHO_DATA.get(key, range ? { range } : {});
  } catch (error) {
    // R2 throws "The requested range is not satisfiable (10039)" for an
    // offset at or past the end. Miniflare clamps a length or suffix that
    // runs past the end; production R2 might reject it instead. Only on this
    // error pay for a HEAD: past the end is a 416, anything else is retried
    // clamped to the object's size, as RFC 9110 asks.
    if (!range || !String(error).includes('10039')) throw error;
    const head = await env.TYCHO_DATA.head(key);
    if (!head) return text(404, 'Not found');
    const clamped = resolveRange(range, head.size);
    if (clamped.length <= 0 || clamped.offset >= head.size) return rangeNotSatisfiable(head.size);
    object = await env.TYCHO_DATA.get(key, { range: clamped });
  }
  if (!object) return text(404, 'Not found');
  if (!range) {
    return new Response(object.body, { headers: dataHeaders(object, { 'Content-Length': String(object.size) }) });
  }
  if (resolveRange(range, object.size).length <= 0) return rangeNotSatisfiable(object.size);
  return new Response(object.body, { status: 206, headers: partialHeaders(object, range) });
}

function partialHeaders(object: R2Object, range: R2Range): Headers {
  const { offset, length } = resolveRange(range, object.size);
  return dataHeaders(object, {
    'Content-Length': String(length),
    'Content-Range': `bytes ${offset}-${offset + length - 1}/${object.size}`,
  });
}

type ParsedRange = R2Range | 'unsatisfiable' | null;

/**
 * One `bytes=` range as R2 takes it, `null` for none (serve the whole file),
 * or `'unsatisfiable'` for anything this Worker won't serve: multiple ranges,
 * other units, or a malformed header. `bytes=-0` is unsatisfiable too.
 *
 * Parsed here rather than passing `request.headers` to R2: given a header it
 * can't satisfy (several ranges, or a start past the end), R2 returns the
 * whole object with no error (seen in Miniflare), which would go out as a
 * `206` that isn't one.
 */
export function parseRange(header: string | null): ParsedRange {
  if (header === null) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return 'unsatisfiable';
  const [, start = '', end = ''] = match;
  if (start === '' && end === '') return 'unsatisfiable';
  if (start === '') {
    const suffix = Number(end);
    return suffix > 0 ? { suffix } : 'unsatisfiable';
  }
  const offset = Number(start);
  if (end === '') return { offset };
  const last = Number(end);
  return last >= offset ? { offset, length: last - offset + 1 } : 'unsatisfiable';
}

/** The bytes a range covers in an object of `size` bytes. Computed from our
 *  own range, not `object.range`, which R2 may report as given (a suffix). */
export function resolveRange(range: R2Range, size: number): { offset: number; length: number } {
  if ('suffix' in range) {
    const length = Math.min(range.suffix, size);
    return { offset: size - length, length };
  }
  const offset = range.offset ?? 0;
  return { offset, length: Math.min(range.length ?? size - offset, size - offset) };
}

function dataHeaders(object: R2Object, extra: Record<string, string>): Headers {
  const extension = object.key.split('.').pop() ?? '';
  return new Headers({
    ...ISOLATION_HEADERS,
    'Content-Type': CONTENT_TYPES[extension] ?? 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    ETag: object.httpEtag,
    'Last-Modified': object.uploaded.toUTCString(),
    // The names are stable (asteroids.parquet), so revalidate: a cached copy
    // mixed with ranges from a new upload would be corrupt. no-transform
    // keeps Cloudflare from compressing Parquet, which would break ranges.
    // M8 decides whether to switch to content-hashed names and `immutable`.
    'Cache-Control': 'no-cache, no-transform',
    ...extra,
  });
}

function rangeNotSatisfiable(size: number): Response {
  return text(416, 'Range not satisfiable', { 'Content-Range': `bytes */${size}`, 'Accept-Ranges': 'bytes' });
}

function text(status: number, body: string, headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers: { ...ISOLATION_HEADERS, 'Content-Type': 'text/plain; charset=utf-8', ...headers } });
}
