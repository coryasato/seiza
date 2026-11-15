// Checks Kirkwood as it's deployed, against web/dist and data/: every file
// the page asks for answered 200 with COOP and COEP; the build's files and
// the three files as brotli on the wire at their quality-11 sizes, their
// bytes the build's and the manifest's; the page as the build wrote it, with
// no script put in on the way; a held copy answered 304; `/kirkwood` (with a
// query) a 301 to the base; nothing else of the bucket or the build served;
// and the zone's guards (a path outside the allowlist and a POST get the
// WAF's 403). While the data is paused it fails with one line saying so.
//
// Production only: `wrangler dev` re-encodes what the Worker sends
// (.claude/rules/cloudflare.md), so the bytes on the wire there aren't these.
//
// Usage: node apps/kirkwood/worker/scripts/check.ts [--url <origin>] [--no-waf] [--whole]
//   (`just kirkwood deployed`)
// --url: the origin, https://tycho.seiza.io unless given. --no-waf: an
// origin without the zone's rules (the Worker's own 404 and 405). --whole:
// each file as it is too, 97 MB more (a browser that doesn't take br).
// scripts/deploy.ts runs the same checks after a deploy.

import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliDecompressSync } from 'node:zlib';
import { walk } from '../../../../shared-web/scripts/walk.ts';
import { BASE } from '../../web/src/base.ts';
import { CONTENT_TYPES, FILES, PAUSED_HEADER, PRECOMPRESSED } from '../src/names.ts';
import { dataFiles, dist } from './stage.ts';

/** The public origin. Never the account's default Workers hostname (the root docs/DECISIONS.md, "Hosting"). */
export const PRODUCTION_URL = 'https://tycho.seiza.io';
/** The one failure while the data is paused (`just tycho pause`): every
 *  check of a file would fail too, and it lasts until `resume`. */
export const PAUSED = 'data/*: the data is paused (`just tycho resume`)';

/** What Chromium sends, so Cloudflare picks what a visitor gets. */
const BROWSER_ENCODINGS = 'gzip, deflate, br, zstd';

interface Answer {
  status: number;
  header(name: string): string | undefined;
  /** The body as it came: `fetch` would decode it, and Cloudflare drops an
   *  encoded body's Content-Length on a HEAD. */
  wire: Buffer;
}

function ask(url: string, options: { method?: string; headers?: Record<string, string> } = {}): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const request = (url.startsWith('https:') ? httpsRequest : httpRequest)(url, { method: options.method ?? 'GET', headers: { 'Accept-Encoding': BROWSER_ENCODINGS, ...options.headers } }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode ?? 0, header: (name) => [response.headers[name.toLowerCase()]].flat()[0], wire: Buffer.concat(chunks) }));
      response.on('error', reject);
    });
    request.on('error', reject);
    request.end();
  });
}

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

/**
 * Returns one line per failed check; empty means all passed. `behindWaf`:
 * production, where the zone's allowlist answers a POST and a path outside
 * Kirkwood's with 403 before the Worker could answer 405 or 404. `whole`:
 * each file as it is as well (a request that takes no encoding).
 */
export async function checkDeployed(origin: string, options: { behindWaf?: boolean; whole?: boolean } = {}): Promise<string[]> {
  const failures: string[] = [];
  const expect = (name: string, ok: boolean, detail: string) => {
    if (!ok) failures.push(`${name}: ${detail}`);
  };
  const base = `${origin}${BASE}`;
  const isolated = (name: string, answer: Answer) => {
    expect(name, answer.header('Cross-Origin-Opener-Policy') === 'same-origin', `COOP ${answer.header('Cross-Origin-Opener-Policy')}`);
    expect(name, answer.header('Cross-Origin-Embedder-Policy') === 'require-corp', `COEP ${answer.header('Cross-Origin-Embedder-Policy')}`);
  };
  /** The body a browser would hold, or null when it didn't come as br. */
  const decoded = (name: string, answer: Answer): Buffer | null => {
    const encoding = answer.header('Content-Encoding');
    expect(name, encoding === 'br', `Content-Encoding ${encoding}, expected br (the deploy's quality 11)`);
    if (encoding !== 'br') return null;
    try {
      return brotliDecompressSync(answer.wire);
    } catch {
      failures.push(`${name}: its ${answer.wire.length} bytes aren't brotli`);
      return null;
    }
  };

  // The build: every file of web/dist, at its path under the base.
  for (const path of walk(dist).map((file) => relative(dist, file))) {
    const extension = path.split('.').pop() ?? '';
    // (`_headers` is the build's headers file, which Cloudflare reads
    // and never serves: the Worker sets its own.)
    if (extension === 'br' || path === '_headers') continue;
    // A file with no `.br` of the deploy's is asked for as it is: Cloudflare
    // would compress a text type on the way, and its bytes are what's read.
    const precompressed = PRECOMPRESSED.includes(extension);
    const answer = await ask(path === 'index.html' ? base : `${base}${path}`, precompressed ? {} : { headers: { 'Accept-Encoding': 'identity' } });
    expect(path, answer.status === 200, `status ${answer.status}`);
    if (answer.status !== 200) continue;
    isolated(path, answer);
    const type = CONTENT_TYPES[extension];
    if (type) expect(path, answer.header('Content-Type') === type, `Content-Type ${answer.header('Content-Type')}, expected ${type}`);
    if (path.startsWith('assets/')) expect(path, answer.header('Cache-Control')?.includes('immutable') ?? false, `Cache-Control ${answer.header('Cache-Control')}`);
    const local = readFileSync(join(dist, path));
    let body: Buffer | null = answer.wire;
    if (precompressed) {
      body = decoded(path, answer);
      const br = statSync(join(dist, `${path}.br`), { throwIfNoEntry: false })?.size;
      if (br === undefined) failures.push(`${path}: web/dist has no ${path}.br to compare with (scripts/stage.ts writes it)`);
      else expect(path, answer.wire.length === br, `${answer.wire.length} bytes on the wire, expected the .br's ${br}`);
      if (extension === 'wasm') console.log(`  ${path}: ${answer.wire.length} bytes on the wire (${local.length} as it is)`);
    }
    if (body) expect(path, sha256(body) === sha256(local), `its bytes aren't web/dist's (${body.length} bytes, and the build's is ${local.length})`);
    if (path === 'index.html') {
      // Nothing joins the page on the way (Cloudflare's Web Analytics would
      // put a script in): its bytes are the build's, above, and it says so.
      expect(path, answer.header('Cache-Control')?.includes('no-transform') ?? false, `Cache-Control ${answer.header('Cache-Control')}, expected no-transform`);
      if (body) expect(path, !/cloudflareinsights|cdn-cgi\//.test(body.toString('utf8')), 'the page has a script Cloudflare put in');
    }
  }

  // The three files, each as a browser gets it.
  for (const file of dataFiles()) {
    const url = `${base}data/${file.name}`;
    const name = `data/${file.name}`;
    const answer = await ask(url);
    if (answer.status === 503 && answer.header(PAUSED_HEADER) === '1') return [...failures, PAUSED];
    expect(name, answer.status === 200, `status ${answer.status}`);
    if (answer.status !== 200) continue;
    isolated(name, answer);
    const body = decoded(name, answer);
    const br = file.compressed().length;
    expect(name, answer.wire.length === br, `${answer.wire.length} bytes on the wire, expected its brotli 11's ${br}`);
    if (body) expect(name, body.length === file.bytes && sha256(body) === file.sha256, `its bytes aren't the manifest's (${body.length} bytes, SHA-256 ${sha256(body).slice(0, 16)}…)`);
    console.log(`  ${name}: ${answer.wire.length} bytes on the wire (${file.bytes} as it is)`);
    expect(name, answer.header('Cache-Control')?.includes('no-cache') ?? false, `Cache-Control ${answer.header('Cache-Control')}, expected no-cache`);
    // A second visit asks about its copy and downloads nothing.
    const etag = answer.header('ETag');
    expect(name, Boolean(etag), 'no ETag');
    if (etag) {
      const held = await ask(url, { headers: { 'If-None-Match': etag } });
      expect(`${name}, held`, held.status === 304 && held.wire.length === 0, `status ${held.status} with ${held.wire.length} bytes, expected a 304 and none`);
    }
    const head = await ask(url, { method: 'HEAD' });
    expect(`HEAD ${name}`, head.status === 200 && head.wire.length === 0, `status ${head.status}`);
    // A browser that takes no encoding gets the file itself.
    if (options.whole) {
      const plain = await ask(url, { headers: { 'Accept-Encoding': 'identity' } });
      expect(`${name}, as it is`, plain.status === 200 && plain.header('Content-Encoding') === undefined, `status ${plain.status}, Content-Encoding ${plain.header('Content-Encoding')}`);
      expect(`${name}, as it is`, plain.wire.length === file.bytes && sha256(plain.wire) === file.sha256, `its ${plain.wire.length} bytes aren't the manifest's`);
    }
  }

  // The base without its slash, a query after it: the route takes it, and
  // the Worker sends it to the base with the query kept.
  {
    const answer = await ask(`${origin}${BASE.slice(0, -1)}?roll=0`);
    expect(`${BASE.slice(0, -1)}?roll=0`, answer.status === 301 && answer.header('Location') === `${BASE}?roll=0`, `status ${answer.status}, Location ${answer.header('Location')}`);
  }

  // What's never served: a `.br` by name, a file by its key, another key of
  // the bucket (the deploy's own note among them), a path no file has.
  for (const path of [`data/${FILES[0]}.br`, `data/${dataFiles()[0]!.key}`, 'data/put.json', 'data/missing.bin', 'data/', 'assets/missing-00000000.js', 'index.html.br', '_headers', 'missing']) {
    const answer = await ask(`${base}${path}`);
    expect(path, answer.status === 404, `status ${answer.status}, expected 404`);
  }

  // The zone's guards run before the Worker; alone, it answers for itself.
  for (const [name, url, method, alone] of [
    ['a path that only starts with the base', `${origin}${BASE.slice(0, -1)}s`, 'GET', 404],
    ['POST', base, 'POST', 405],
    ['POST to a file', `${base}data/${FILES[0]}`, 'POST', 405],
  ] as const) {
    const answer = await ask(url, { method });
    const status = options.behindWaf ? 403 : alone;
    expect(name, answer.status === status, `status ${answer.status}, expected ${status}${options.behindWaf ? " (the WAF's allowlist)" : ''}`);
  }
  return failures;
}

/** Whether `origin` serves this build's page yet: a new version takes
 *  seconds to reach the edge (.claude/rules/cloudflare.md). One request. */
export async function servesThisBuild(origin: string): Promise<boolean> {
  const answer = await ask(`${origin}${BASE}`, { headers: { 'Accept-Encoding': 'identity' } });
  return answer.status === 200 && sha256(answer.wire) === sha256(readFileSync(join(dist, 'index.html')));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const index = process.argv.indexOf('--url');
  const origin = (index > 0 ? process.argv[index + 1] : undefined) ?? PRODUCTION_URL;
  const failures = await checkDeployed(origin.replace(/\/$/, ''), { behindWaf: !process.argv.includes('--no-waf'), whole: process.argv.includes('--whole') });
  if (failures.length) {
    console.error(`FAIL: ${origin}\n${failures.map((failure) => `  ${failure}`).join('\n')}`);
    process.exitCode = 1;
  } else {
    console.log(`PASS: ${origin} (the build, the three files, the guards)`);
  }
}
