// Deploys Kirkwood to Cloudflare (`just kirkwood deploy`): puts what changed
// in the bucket, deploys the Worker with web/dist as its static assets, then
// checks production. Nothing of Tycho's Worker is touched (docs/DECISIONS.md,
// "Hosting"); the old address, tycho.seiza.io/kirkwood, is the zone's
// redirect rule's, and the deploy refuses to go on until it answers.
//
// 1. The bucket first, so the new build never asks for a file that isn't
//    there. Its objects are the three files, each as it is and as
//    `<key>.br` (brotli 11), under a key with the file's hash in it
//    (src/versions.ts): a file that changed is put beside the one the live
//    Worker still reads, and nothing a visitor is being sent is overwritten.
//    An object is put only when its own bytes' SHA-256 isn't the one it was
//    last put at. Objects of earlier files stay until `--prune`. What was put is a note in the bucket itself
//    (`put.json`, a key the Worker never serves), so a bucket cleared is a
//    note cleared; the check after the deploy reads every object's bytes
//    against the manifest whatever the note says. Each object is under what
//    `wrangler r2 object put` takes, so no S3 keys are needed.
// 2. The build's `.br` copies (scripts/stage.ts, as `wrangler dev` gets
//    them), then `wrangler deploy`.
// 3. scripts/check.ts's checks against production.
//
// Needs `wrangler login`, and the bucket, made once:
//   wrangler r2 bucket create kirkwood-data
// The zone's rules for kirkwood.seiza.io must be in place first: its path
// allowlist (the page, the build's top-level names, data/), the rate limit,
// and the old address's redirect rule (the gitignored root
// docs/private/zone.md). The check after the deploy reads all three.
// On a hostname's first deploy, which makes its DNS record, switch the
// redirect on just before running this, and don't ask for the hostname
// first: a resolver keeps a miss for the zone's negative TTL (30 min), and
// the old links point at it until the deploy is done
// (.claude/rules/cloudflare.md).
//
// Usage: node apps/kirkwood/worker/scripts/deploy.ts [--dry-run] [--skip-check] [--prune]
// --dry-run: says what would be put (and pruned), and `wrangler deploy --dry-run`.
// --prune: once the check has passed, deletes the objects the note lists
// that this build doesn't read. A rollback of the Worker past this deploy
// would then find its files gone: prune once the deploy is the one to keep.
// Run `just kirkwood build` first (`just kirkwood deploy` does).

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { wrangler, wranglerEnv } from '../../../../shared-web/perf/wrangler.ts';
import { PAUSED, PRODUCTION_URL, checkDeployed, oldAddressNotRedirected, servesThisBuild } from './check.ts';
import { BUCKET, dataFiles, dist, stageBuild, workerDir } from './stage.ts';

/** The note of what the bucket holds: each object's key and the SHA-256 of
 *  its own bytes (a `.br`'s, the compressed ones). Not one of the names the
 *  Worker serves. */
const NOTE = 'put.json';
const dryRun = process.argv.includes('--dry-run');

/** wrangler against production's bucket; its output is returned, never
 *  printed (an error's may name the account). */
function r2(args: string[]): string {
  return execFileSync(wrangler, ['r2', 'object', ...args, '--remote'], { cwd: workerDir, env: wranglerEnv(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024 });
}

/** What wrangler said went wrong, without anything that names the account. */
function said(error: unknown): string {
  const { stdout = '', stderr = '' } = error as { stdout?: string; stderr?: string };
  return `${stdout}\n${stderr}`.replace(/\b[0-9a-f]{32}\b/g, '<id>').replace(/\S+@\S+/g, '<email>').trim();
}

/** The note, or none: it only saves an upload, so one that's missing or
 *  can't be read means every object is put again. (wrangler that can't
 *  reach the bucket at all fails at the first put, with its reason.) */
function readNote(): Record<string, string> {
  let text: string;
  try {
    text = r2(['get', `${BUCKET}/${NOTE}`, '--pipe']);
  } catch (error) {
    const why = said(error);
    if (/bucket does not exist/i.test(why)) throw new Error(`no bucket ${BUCKET}: make it once with \`wrangler r2 bucket create ${BUCKET}\` (from apps/kirkwood/worker)`);
    if (!/key does not exist/i.test(why)) console.log(`r2: ${NOTE} wasn't read (${why.split('\n').find((line) => line.trim()) ?? 'no reason given'}): every object is put again`);
    return {};
  }
  try {
    const note = JSON.parse(text) as unknown;
    if (note && typeof note === 'object' && !Array.isArray(note)) return note as Record<string, string>;
  } catch {
    // Not JSON: as below.
  }
  console.log(`r2: ${NOTE} isn't a note: every object is put again`);
  return {};
}

if (!existsSync(join(dist, 'index.html'))) throw new Error('web/dist has no build; run `just kirkwood build`');
// The old address's links stay whole: the zone's rule sends them here before
// any route or Worker. Asked before anything is put, so a deploy it refuses
// leaves the bucket as it was.
if (!dryRun) {
  const why = await oldAddressNotRedirected();
  if (why) throw new Error(`the zone's redirect rule for the old address isn't in place (the gitignored root docs/private/zone.md): ${why}`);
}
// Every file read against the manifest before anything is put, so a file
// built again without its manifest can't leave the bucket half changed.
const files = dataFiles();
const staged = stageBuild();
console.log(`build: ${staged.length} files, ${staged.filter((file) => file.brBytes !== null).length} with a .br beside them`);

const note = readNote();
const scratch = mkdtempSync(join(tmpdir(), 'kirkwood-deploy-'));
try {
  const put = (key: string, path: string, sha256: string, bytes: number) => {
    const mb = (bytes / 1e6).toFixed(2);
    if (note[key] === sha256) return console.log(`r2: ${key} is current (${mb} MB)`);
    console.log(`r2: ${dryRun ? 'would put' : 'putting'} ${key} (${mb} MB, ${note[key] ? 'changed' : 'new'})`);
    if (dryRun) return;
    try {
      r2(['put', `${BUCKET}/${key}`, '--file', path, '--content-type', 'application/octet-stream']);
      note[key] = sha256;
      // After each object: a deploy that stops partway knows what it put.
      const notePath = join(scratch, NOTE);
      writeFileSync(notePath, `${JSON.stringify(note, null, 2)}\n`);
      r2(['put', `${BUCKET}/${NOTE}`, '--file', notePath, '--content-type', 'application/json']);
    } catch (error) {
      throw new Error(`putting ${BUCKET}/${key}: ${said(error) || String(error)}`);
    }
  };
  for (const file of files) {
    const compressed = file.compressed();
    const path = join(scratch, `${file.name}.br`);
    writeFileSync(path, compressed);
    put(file.key, file.path, file.sha256, file.bytes);
    put(`${file.key}.br`, path, createHash('sha256').update(compressed).digest('hex'), compressed.length);
    rmSync(path);
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

execFileSync(wrangler, ['deploy', ...(dryRun ? ['--dry-run'] : [])], { cwd: workerDir, stdio: 'inherit', env: wranglerEnv() });

if (!dryRun && !process.argv.includes('--skip-check')) {
  // A new version takes seconds to reach the edge
  // (.claude/rules/cloudflare.md): the page is asked for, one request a
  // time, until it's this build's, and only then is everything read (the
  // whole check downloads 51 MB). Once more after that, for an edge that
  // had the page first.
  for (let waited = 0; waited < 60 && !(await servesThisBuild(PRODUCTION_URL)); waited += 5) {
    console.log("check: the edge doesn't serve this build's page yet, asking again in 5 s");
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  let failures = await checkDeployed(PRODUCTION_URL, { behindWaf: true });
  // (A pause lasts until `just kirkwood resume`: asking again would only spend requests.)
  if (failures.length && !failures.includes(PAUSED)) {
    console.log(`check: ${failures.length} failure(s), asking once more in 10 s`);
    await new Promise((resolve) => setTimeout(resolve, 10_000));
    failures = await checkDeployed(PRODUCTION_URL, { behindWaf: true });
  }
  if (failures.length) {
    console.error(`FAIL: ${PRODUCTION_URL}\n${failures.map((failure) => `  ${failure}`).join('\n')}`);
    process.exit(1);
  }
  console.log(`PASS: ${PRODUCTION_URL} (the build, the three files, the guards, the old address)`);
}

// What the note lists that this build doesn't read: earlier files' objects.
const current = new Set(files.flatMap((file) => [file.key, `${file.key}.br`]));
const earlier = Object.keys(note).filter((key) => !current.has(key));
if (earlier.length) {
  const prune = process.argv.includes('--prune');
  if (!prune || dryRun || process.argv.includes('--skip-check')) {
    console.log(`r2: ${earlier.length} object(s) of earlier files ${prune ? 'would be deleted (not on a dry run, or with the check skipped)' : 'remain (--prune deletes them)'}: ${earlier.join(', ')}`);
  } else {
    for (const key of earlier) {
      try {
        r2(['delete', `${BUCKET}/${key}`]);
      } catch (error) {
        throw new Error(`deleting ${BUCKET}/${key}: ${said(error) || String(error)}`);
      }
      delete note[key];
      console.log(`r2: ${key} deleted`);
    }
    const scratch = mkdtempSync(join(tmpdir(), 'kirkwood-deploy-'));
    try {
      const notePath = join(scratch, NOTE);
      writeFileSync(notePath, `${JSON.stringify(note, null, 2)}\n`);
      r2(['put', `${BUCKET}/${NOTE}`, '--file', notePath, '--content-type', 'application/json']);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }
}
