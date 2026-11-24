// Checks the Worker's R2 half end to end: DuckDB's oversize wasm bundles
// come from the bucket whole (GET and HEAD), byte for byte web/dist's, with
// their type, the isolation headers, and `immutable`; a missing asset and
// anything under /data/ are 404s. With --url, the deployed build instead
// (`checkAssets`): every web/dist file, the oversize ones from R2, and the
// WAF's 403s (`--no-waf` for an origin without the zone's rules).
//
// Usage: node apps/tycho/worker/scripts/check.ts [--url <origin> [--no-waf]]
// With no --url it starts `wrangler dev` on the release build in web/dist
// (`just tycho build` first), its local R2 filled from it; deploy.ts runs
// `checkAssets` on production.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { get as httpsGet } from 'node:https';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { oversizeAssets, walk } from './assets.ts';
import { startWorkerDev } from './dev.ts';

const workerDir = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The oversize bundles from `origin`, against `dist`'s copies; one line per failed check. */
export async function checkBundles(origin: string, dist: string): Promise<string[]> {
  const failures: string[] = [];
  const expect = (name: string, ok: boolean, detail: string) => {
    if (!ok) failures.push(`${name}: ${detail}`);
  };
  const oversize = oversizeAssets(dist);
  expect('web/dist', oversize.length === 2, `${oversize.length} files over the asset limit (${oversize.join(', ')}), expected DuckDB's two wasm bundles: run \`just tycho build\``);
  for (const path of oversize) {
    const local = readFileSync(join(dist, path));
    // A `.br` beside a bundle (a deploy's, `--dry-run` included) would be
    // served from static assets ahead of R2, which then goes untested.
    expect(path, !existsSync(join(dist, `${path}.br`)), `web/dist holds ${path}.br, which the Worker would serve ahead of R2: run \`just tycho build\``);
    // identity: Node's fetch asks for br by default, which takes the `.br` path.
    const response = await fetch(`${origin}/${path}`, { headers: { 'Accept-Encoding': 'identity' } });
    const body = new Uint8Array(await response.arrayBuffer());
    const header = (name: string) => response.headers.get(name);
    expect(path, response.status === 200, `status ${response.status}`);
    expect(path, createHash('sha256').update(body).digest('hex') === createHash('sha256').update(local).digest('hex'), `${body.length} bytes differ from web/dist's ${local.length}`);
    expect(path, header('Content-Type') === 'application/wasm', `Content-Type ${header('Content-Type')}`);
    expect(path, header('Cache-Control')?.includes('immutable') ?? false, `Cache-Control ${header('Cache-Control')}`);
    expect(path, header('Cross-Origin-Embedder-Policy') === 'require-corp', `COEP ${header('Cross-Origin-Embedder-Policy')}`);
    expect(path, header('Cross-Origin-Resource-Policy') === 'same-origin', `CORP ${header('Cross-Origin-Resource-Policy')}`);
    const head = await fetch(`${origin}/${path}`, { method: 'HEAD', headers: { 'Accept-Encoding': 'identity' } });
    await head.body?.cancel();
    expect(`HEAD ${path}`, head.status === 200 && head.headers.get('Content-Length') === String(local.length), `status ${head.status}, Content-Length ${head.headers.get('Content-Length')}`);
  }
  for (const [name, target] of [
    ['missing asset', `${origin}/assets/missing-00000000.wasm`],
    ['a retired sample', `${origin}/data/asteroids.parquet`],
    ...oversize.map((path) => [`${path} under /data/`, `${origin}/data/${path}`]),
  ]) {
    const response = await fetch(target!);
    await response.body?.cancel();
    expect(name!, response.status === 404, `status ${response.status}, expected 404`);
  }
  return failures;
}

/** What Chromium sends, so Cloudflare picks what a visitor gets. */
const BROWSER_ENCODINGS = 'gzip, deflate, br, zstd';
const assetTypes: Record<string, string> = {
  wasm: 'application/wasm',
  js: 'text/javascript',
  ttf: 'font/ttf',
  html: 'text/html',
};

/** The bytes a browser's GET of `url` puts on the wire (fetch would decode
 *  them; a HEAD's Content-Length is dropped by Cloudflare for encoded bodies). */
function wireBytes(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    httpsGet(url, { headers: { 'Accept-Encoding': BROWSER_ENCODINGS } }, (response) => {
      let bytes = 0;
      response.on('data', (chunk: Buffer) => (bytes += chunk.length));
      response.on('end', () => resolve(bytes));
      response.on('error', reject);
    }).on('error', reject);
  });
}

/**
 * The deployed build against web/dist: each file is served with its bytes
 * (SHA-256), its type, the isolation headers, and `immutable` under assets/;
 * the page, wasm, JS, and font come as the deploy's quality-11 brotli (the size
 * matches the `.br` beside it); the oversize files (`oversize`, from R2) too.
 * A missing DuckDB extension and the R2 assets under /data/ are 404s; a probe
 * outside the app's paths is the WAF's 403.
 * Logs each wasm's Content-Encoding and bytes on the wire, which the deploy results record.
 */
export async function checkAssets(origin: string, dist: string, oversize?: string[], options: { behindWaf?: boolean } = {}): Promise<string[]> {
  const failures: string[] = [];
  const expect = (name: string, ok: boolean, detail: string) => {
    if (!ok) failures.push(`${name}: ${detail}`);
  };
  const files = walk(dist)
    .map((file) => relative(dist, file))
    .filter((path) => path !== '_headers' && path !== '.assetsignore' && !path.endsWith('.br'));
  const big = oversize ?? oversizeAssets(dist);
  for (const path of files) {
    const target = path === 'index.html' ? `${origin}/` : `${origin}/${path}`;
    const response = await fetch(target, { headers: { 'Accept-Encoding': BROWSER_ENCODINGS } });
    // fetch decodes the body; Content-Encoding still says how it came.
    const body = new Uint8Array(await response.arrayBuffer());
    const header = (name: string) => response.headers.get(name);
    const name = `${path}${big.includes(path) ? ' (R2)' : ''}`;
    expect(name, response.status === 200, `status ${response.status}`);
    if (response.status !== 200) continue;
    const sum = createHash('sha256').update(body).digest('hex');
    const local = createHash('sha256').update(readFileSync(join(dist, path))).digest('hex');
    expect(name, sum === local, `bytes differ from web/dist (${body.length} bytes)`);
    const type = assetTypes[path.split('.').pop() ?? ''];
    if (type) expect(name, header('Content-Type')?.startsWith(type) ?? false, `Content-Type ${header('Content-Type')}, expected ${type}`);
    expect(name, header('Cross-Origin-Opener-Policy') === 'same-origin', `COOP ${header('Cross-Origin-Opener-Policy')}`);
    expect(name, header('Cross-Origin-Embedder-Policy') === 'require-corp', `COEP ${header('Cross-Origin-Embedder-Policy')}`);
    if (path.startsWith('assets/')) expect(name, header('Cache-Control')?.includes('immutable') ?? false, `Cache-Control ${header('Cache-Control')}`);
    if (path === 'index.html') {
      // Nothing may load before first paint: no injected scripts (Cloudflare's
      // Web Analytics beacon) and no-transform so none get in.
      expect(name, header('Cache-Control')?.includes('no-transform') ?? false, `Cache-Control ${header('Cache-Control')}, expected no-transform`);
      expect(name, !/cloudflareinsights|cdn-cgi\//.test(new TextDecoder().decode(body)), 'the page has an injected Cloudflare script');
    }
    const encoding = header('Content-Encoding');
    if (/\.(wasm|js|ttf|html)$/.test(path)) {
      const wire = await wireBytes(target);
      const br = statSync(join(dist, `${path}.br`), { throwIfNoEntry: false })?.size;
      if (path.endsWith('.wasm')) console.log(`  ${name}: Content-Encoding ${encoding ?? 'none'}, ${wire} bytes on the wire (raw ${body.length})`);
      expect(name, encoding === 'br', `Content-Encoding ${encoding}, expected br (the deploy's quality 11)`);
      if (br !== undefined) expect(name, wire === br, `${wire} bytes on the wire, expected the .br's ${br}`);
    }
  }
  const missing: [string, string][] = [
    ['missing DuckDB extension', `${origin}/duckdb-ext/v0.0.0/wasm_eh/json.duckdb_extension.wasm`],
    ['missing asset', `${origin}/assets/missing-00000000.wasm`],
    ...big.map((path): [string, string] => [`${path} under /data/`, `${origin}/data/${path}`]),
  ];
  for (const [name, target] of missing) {
    const response = await fetch(target);
    await response.body?.cancel();
    expect(name, response.status === 404, `status ${response.status}, expected 404`);
  }
  // The WAF's path allowlist (docs/hosting.md, "Abuse guards") blocks probes
  // at the edge, before the Worker runs; the Worker itself would answer 404.
  // Every real path passed above, so a path the rule forgot fails there.
  for (const path of options.behindWaf ? ['/.env', '/wp-login.php'] : []) {
    const response = await fetch(`${origin}${path}`);
    await response.body?.cancel();
    expect(`probe ${path}`, response.status === 403, `status ${response.status}, expected 403 from the WAF allowlist`);
  }
  return failures;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const index = process.argv.indexOf('--url');
  const given = index > 0 ? process.argv[index + 1] : undefined;
  // Any --url is production, behind the WAF, unless --no-waf says otherwise.
  const behindWaf = Boolean(given) && !process.argv.includes('--no-waf');
  const dist = join(workerDir, '../web/dist');
  const worker = given ? null : await startWorkerDev({ port: 8788 });
  try {
    const failures = given ? await checkAssets(given, dist, undefined, { behindWaf }) : await checkBundles(worker!.url, dist);
    if (failures.length > 0) {
      console.error(`FAIL\n${failures.map((failure) => `  ${failure}`).join('\n')}`);
      process.exitCode = 1;
    } else {
      console.log(`PASS: ${given ? 'the deployed build' : "the bundles from the local bucket"}`);
    }
  } finally {
    await worker?.close();
  }
}
