// Home-directory paths in a release wasm: the builder's `$HOME`, `/Users/`,
// `/home/`, and the checkout's and `CARGO_HOME`'s absolute paths wherever
// they sit. The root release profile's `trim-paths` remaps them out of panic
// locations (docs/research/build-paths.md); the repo is public, so a wasm
// that still holds one must not ship. Each app's check runs `homePaths` on
// its shipped wasm; `untrimmedControl` builds a package without the setting,
// as shipped (wasm-bindgen, wasm-opt), which must fail it, so the check is
// seen to see them.
//
// As a script: node shared-web/perf/home-paths.ts <file> [--control <package>]
// fails if <file> holds a home path; --control also builds <package> without
// `trim-paths` and fails unless that build holds one.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { option } from './protocol.ts';

const repo = fileURLToPath(new URL('../../', import.meta.url));

/** The apps' wasm-opt flags (their `wasm` recipes'). */
const WASM_OPT = ['-Oz', '--enable-bulk-memory', '--enable-nontrapping-float-to-int', '--enable-sign-ext', '--enable-mutable-globals', '--enable-reference-types', '--enable-multivalue', '--enable-threads'];

/** What marks a builder's path, each ending in `/` so a trimmed `src/root.rs`
 *  never matches a home of `/root`: the builder's home, macOS's and Linux's
 *  roots of homes, the checkout, and `CARGO_HOME` (the registry's sources). */
const NEEDLES = [...new Set([homedir(), '/Users', '/home', repo, process.env.CARGO_HOME].filter((path): path is string => !!path).map((path) => `${path.replace(/\/+$/, '')}/`))];

/** How many builder paths `bytes` holds (the most of any one needle: a path
 *  under the checkout matches its home too), and the failure for `name`, or
 *  null. Never prints the paths themselves. */
export function homePaths(name: string, bytes: Buffer): { total: number; failure: string | null } {
  const text = bytes.toString('latin1');
  const total = Math.max(...NEEDLES.map((needle) => text.split(needle).length - 1));
  return { total, failure: total ? `${name} holds ${total} home-directory paths (the root release profile's trim-paths off?)` : null };
}

/** `pkg`'s release wasm, with `features`, built without `trim-paths` (in target/untrimmed/ so
 *  the release cache stays put; cold, about 2 min), through wasm-bindgen and
 *  wasm-opt as the apps ship it: its home paths, which must be some. */
export function untrimmedControl(pkg: string, features: string[] = []): { total: number; failure: string | null } {
  const run = (command: string, args: string[], env = process.env) => execFileSync(command, args, { cwd: repo, env, stdio: ['ignore', 'ignore', 'inherit'] });
  run('cargo', ['build', '-p', pkg, '--target', 'wasm32-unknown-unknown', '--release', ...(features.length ? ['--features', features.join(',')] : []), '--target-dir', join(repo, 'target/untrimmed')], { ...process.env, CARGO_PROFILE_RELEASE_TRIM_PATHS: 'none' });
  const name = pkg.replaceAll('-', '_');
  const out = mkdtempSync(join(tmpdir(), 'seiza-untrimmed-'));
  try {
    run('wasm-bindgen', [join(repo, 'target/untrimmed/wasm32-unknown-unknown/release', `${name}.wasm`), '--out-dir', out, '--target', 'web']);
    const wasm = join(out, `${name}_bg.wasm`);
    run('wasm-opt', [...WASM_OPT, wasm, '-o', wasm]);
    const { total } = homePaths(pkg, readFileSync(wasm));
    return { total, failure: total ? null : `control: ${pkg} built without trim-paths holds no home path: the check can't see them` };
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = process.argv[2];
  if (!file || file.startsWith('--')) throw new Error('usage: home-paths.ts <file> [--control <package>]');
  const failures: string[] = [];
  const { failure } = homePaths(file, readFileSync(file));
  if (failure) failures.push(failure);
  console.log(`home paths: ${failure ? 'some' : 'none'} in ${file}`);
  const pkg = option('control');
  if (pkg) {
    const control = untrimmedControl(pkg);
    if (control.failure) failures.push(control.failure);
    console.log(`control: ${pkg} without trim-paths holds ${control.total} home paths`);
  }
  if (failures.length) {
    console.error(`FAIL\n  ${failures.join('\n  ')}`);
    process.exit(1);
  }
}
