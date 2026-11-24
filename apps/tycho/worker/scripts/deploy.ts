// Deploys Tycho to Cloudflare (`just tycho deploy`): uploads what changed
// to R2, deploys the Worker with web/dist as its static assets, then checks
// production.
//
// 1. R2 first, so the new build never points at a missing file. The build's
//    files over Cloudflare's 25 MiB asset limit (DuckDB's wasm bundles,
//    content-hashed) go up under their own path, `assets/<name>`, which the
//    Worker serves, when R2's copy has a different SHA-256 (stored as object
//    metadata). The bucket holds nothing else. Uploads use R2's S3 API.
// 2. A brotli quality-11 `<file>.br` beside each of the build's wasm, JS,
//    and font files, which the Worker serves to browsers that take br:
//    Cloudflare's own compression is far weaker (3.7 vs 2.8 MiB on the app
//    wasm). dist/.assetsignore names the oversize files, so `wrangler
//    deploy` leaves them out of the static assets (their `.br` fit), then
//    deploys.
// 3. check.ts's `checkAssets` against production.
//
// Needs `wrangler login`, and an AWS CLI profile holding an R2 API token's
// S3 keys, named by TYCHO_R2_PROFILE (never committed): set in the
// environment or in worker/.env.deploy (`TYCHO_R2_PROFILE=<name>`, a
// gitignored file this script loads). The account ID comes
// from CLOUDFLARE_ACCOUNT_ID or `wrangler whoami`, and goes nowhere but the
// S3 endpoint.
//
// Usage: node apps/tycho/worker/scripts/deploy.ts --rebuild-ships [--dry-run] [--skip-check]
// Run `just tycho build` first (`just tycho deploy` does). Production keeps
// the deployed app until the rebuild ships (docs/DECISIONS.md, "Hosting",
// 2026-11-23), and this tree's Worker serves no samples: without
// --rebuild-ships (that deploy's own flag) this refuses, short of --dry-run.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotli } from '../../../../shared-web/src/brotli.ts';
import { PRECOMPRESSED } from '../src/precompressed.ts';
import { ASSET_LIMIT, oversizeAssets, walk, writeAssetsIgnore } from './assets.ts';
import { checkAssets } from './check.ts';

/** The public origin. Never the account's default Workers subdomain (docs/DECISIONS.md, Hosting). */
export const PRODUCTION_URL = 'https://tycho.seiza.io';
const BUCKET = 'tycho-data';

const workerDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(workerDir, '../web/dist');
const wrangler = join(workerDir, '../../../node_modules/.bin/wrangler');
const dryRun = process.argv.includes('--dry-run');
if (!dryRun && !process.argv.includes('--rebuild-ships'))
  throw new Error(
    "production keeps the deployed app until the rebuild ships, and this tree's Worker would take its samples away (docs/DECISIONS.md, \"Hosting\", 2026-11-23): " +
      'pass --rebuild-ships for that deploy, or --dry-run',
  );

function accountId(): string {
  if (process.env.CLOUDFLARE_ACCOUNT_ID) return process.env.CLOUDFLARE_ACCOUNT_ID;
  const whoami = execFileSync(wrangler, ['whoami'], { cwd: workerDir, encoding: 'utf8', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } });
  const ids = [...new Set(whoami.match(/\b[0-9a-f]{32}\b/g) ?? [])];
  if (ids.length !== 1) throw new Error(`\`wrangler whoami\` shows ${ids.length} accounts; set CLOUDFLARE_ACCOUNT_ID`);
  return ids[0]!;
}

// The profile's name, kept out of the repo and the shell: worker/.env.deploy
// (gitignored as `.env.*`; not `.env`, which `wrangler dev` reads as vars).
const envFile = join(workerDir, '.env.deploy');
if (existsSync(envFile)) process.loadEnvFile(envFile);
const profile = process.env.TYCHO_R2_PROFILE;
if (!profile) throw new Error('set TYCHO_R2_PROFILE (in worker/.env.deploy, or the environment) to the AWS CLI profile holding the R2 S3 keys');
const endpoint = `https://${accountId()}.r2.cloudflarestorage.com`;
const aws = (args: string[]) =>
  execFileSync('aws', [...args, '--profile', profile, '--endpoint-url', endpoint], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

/** R2's stored SHA-256 for `key`, `null` if the object is missing or has none. */
function remoteSha256(key: string): string | null {
  try {
    const head = JSON.parse(aws(['s3api', 'head-object', '--bucket', BUCKET, '--key', key])) as { Metadata?: Record<string, string> };
    return head.Metadata?.sha256 ?? null;
  } catch (error) {
    if (/Not Found|404/.test(String((error as { stderr?: string }).stderr ?? error))) return null;
    throw error;
  }
}

async function sha256(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

async function upload(file: string, key: string): Promise<void> {
  const sum = await sha256(file);
  const remote = remoteSha256(key);
  const mib = (statSync(file).size / 1024 ** 2).toFixed(1);
  if (remote === sum) {
    console.log(`r2: ${key} is current (${mib} MiB)`);
    return;
  }
  console.log(`r2: ${dryRun ? 'would upload' : 'uploading'} ${key} (${mib} MiB, ${remote ? 'changed' : 'new'})`);
  if (dryRun) return;
  const started = Date.now();
  aws(['s3', 'cp', file, `s3://${BUCKET}/${key}`, '--metadata', `sha256=${sum}`, '--only-show-errors']);
  console.log(`r2: ${key} uploaded in ${((Date.now() - started) / 1000).toFixed(1)} s`);
}

if (!existsSync(join(dist, 'index.html')) || !existsSync(join(dist, '_headers'))) throw new Error('web/dist has no build (index.html, _headers); run `just tycho build`');
const oversize = oversizeAssets(dist);
const strays = oversize.filter((path) => !path.startsWith('assets/'));
if (strays.length) throw new Error(`over the 25 MiB asset limit outside assets/ (not content-hashed, so the Worker can't serve them from R2): ${strays.join(', ')}`);

for (const path of oversize) await upload(join(dist, path), path);

// Cached by content (the build's asset-sizes report already made them).
for (const path of walk(dist).map((file) => relative(dist, file))) {
  if (!PRECOMPRESSED.includes(path.split('.').pop() ?? '')) continue;
  const compressed = brotli(readFileSync(join(dist, path)));
  if (compressed.length > ASSET_LIMIT) throw new Error(`${path}.br is over the 25 MiB asset limit`);
  writeFileSync(join(dist, `${path}.br`), compressed);
}

writeAssetsIgnore(dist, oversize);
console.log(`assets: ${oversize.length} file(s) left to R2: ${oversize.join(', ')}`);

execFileSync(wrangler, ['deploy', ...(dryRun ? ['--dry-run'] : [])], { cwd: workerDir, stdio: 'inherit', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } });

if (!dryRun && !process.argv.includes('--skip-check')) {
  // A new version takes a few seconds to reach the edge (the first deploy
  // read the old one's responses right after `wrangler deploy`), so a failing
  // check retries for a minute before it counts.
  let failures: string[] = [];
  for (let attempt = 1; attempt <= 7; attempt++) {
    failures = await checkAssets(PRODUCTION_URL, dist, oversize, { behindWaf: true });
    if (!failures.length || attempt === 7) break;
    console.log(`check: ${failures.length} failure(s), retrying in 10 s (attempt ${attempt} of 7)`);
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
  if (failures.length) {
    console.error(`FAIL: ${PRODUCTION_URL}\n${failures.map((failure) => `  ${failure}`).join('\n')}`);
    process.exit(1);
  }
  console.log(`PASS: ${PRODUCTION_URL} (assets)`);
}
