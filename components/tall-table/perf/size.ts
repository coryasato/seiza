// The bare host's wasm, the base every feature's added bytes are read
// against: raw (cargo's release output), after wasm-bindgen and wasm-opt (the apps' flags), and
// brotli 11, built here the way `just tall-table build` builds it. Checks
// that it carries nothing but the table: Cargo links no engine
// (`seiza-duckdb`) and no observation panel (`seiza`'s `panel`), and the
// wasm holds neither's global. The observatory's GPUI contender's shipped
// wasm (`just observatory gpui-build`, when built) is the cross-check: the
// same table and bootstrap plus its engine client and Arrow reader.
//
//
// Each feature's build (the host's Cargo feature, which turns on the
// table's and switches it on at run time) is measured against the base:
// its added bytes; a build of two features also against each one alone, and
// a feature that turns on another (`follow`, `live`) against that one.
// And the base must hold none of a feature's code: an unstripped build of
// each (`target/symbols/`) is searched for the feature's own module, which
// the base must lack and the feature's build must hold (the control); code
// only two features together build, also lacking from each one's build. `--against <commit>` also builds the base at
// that commit and the working tree's, each in a git worktree, and fails if
// they differ by more than 0.1 KiB after wasm-opt (brotli is recorded, not
// gated: it swings by up to ~2 KiB when a few bytes shift).
//
// Usage: node components/tall-table/perf/size.ts [--against <commit>] [--label <name>]
// --label writes perf/results/<date>-<label>.json. Leaves host/web/pkg/ as
// the base's release build.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { brotli } from '../../../shared-web/src/brotli.ts';
import { localDate, machineInfo, option } from '../../../shared-web/perf/protocol.ts';
import { perfDir, repo } from './harness.ts';

/** Each host feature's build (two, comma-separated, for code only both
 *  build), and its own modules' mangled paths (v0 symbols), which only a
 *  build with it may hold. */
const FEATURES: Record<string, string | string[]> = {
  'custom-cells': 'seiza_tall_table5paint',
  // No module of its own: the cache's re-read report, `PageCache::take_refreshed`.
  live: '14take_refreshed',
  // The flash, `live` with `custom-cells`.
  'live,custom-cells': 'seiza_tall_table5flash',
  // Following: the state's `follow` module.
  follow: 'seiza_tall_table5state6follow',
  // Resizing: the state's `resize` module.
  resize: 'seiza_tall_table5state6resize',
  // Selecting: the range type's module and the state's `select` module.
  select: ['seiza_tall_table9selection', 'seiza_tall_table5state6select'],
  // Copying: the text's module and the state's `copy` module.
  copy: ['seiza_tall_table4copy', 'seiza_tall_table5state4copy'],
  // Sorting: the order's types and the state's `sort` module.
  sort: ['seiza_tall_table4sort', 'seiza_tall_table5state4sort'],
};

/** A feature that turns on another is measured against it too, and the
 *  other's build must hold none of its symbols: `follow` turns on `live`,
 *  `copy` turns on `select`. */
const TURNS_ON: Record<string, string[]> = { follow: ['live'], copy: ['select'] };

/** Globals only the panel and the engine's bridge write. */
const MARKERS = { panel: '__seizaPerfOverlay', engine: 'duckdb' };
const run = (command: string, args: string[]) => execFileSync(command, args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
const failures: string[] = [];
const kib = (bytes: number) => Number((bytes / 1024).toFixed(1));

/** What Cargo links building `packages` together: an engine, the panel. */
function links(packages: string[]): { engine: boolean; panel: boolean } {
  const tree = run('cargo', ['tree', '--target', 'wasm32-unknown-unknown', '-e', 'features', '--prefix', 'none', ...packages.flatMap((name) => ['-p', name])]);
  return { engine: tree.includes('seiza-duckdb'), panel: tree.includes('seiza feature "panel"') };
}
const linked = links(['tall-table-host']);
// The control: built with Tycho, Cargo unifies its engine and panel in.
const control = links(['tall-table-host', 'tycho']);
if (linked.engine) failures.push('cargo links seiza-duckdb into the host');
if (linked.panel) failures.push("cargo enables seiza's panel for the host");
if (!control.engine || !control.panel) failures.push('control: built with Tycho, cargo should link seiza-duckdb and the panel, and didn\'t');
console.log(`cargo: seiza-duckdb ${linked.engine}, seiza's panel ${linked.panel} (with Tycho, the control: ${control.engine}, ${control.panel})`);

type Size = { rawKiB: number; optKiB: number; brotliKiB: number };

/** The release wasm as `just tall-table build` makes it (its `wasm` recipe:
 *  cargo, wasm-bindgen, wasm-opt with the apps' flags), so this measures the
 *  binary the build ships, in `dir` (a checkout). Raw is cargo's output,
 *  before either. */
function measure(features: string, dir = repo): { size: Size; opt: Buffer } {
  execFileSync('just', ['tall-table', 'wasm', 'release', ...(features ? [features] : [])], { cwd: dir, stdio: ['ignore', 'pipe', 'inherit'] });
  const raw = readFileSync(join(dir, 'target/wasm32-unknown-unknown/release/tall_table_host.wasm'));
  const opt = readFileSync(join(dir, 'components/tall-table/host/web/pkg/tall_table_host_bg.wasm'));
  return { size: { rawKiB: kib(raw.length), optKiB: kib(opt.length), brotliKiB: kib(brotli(opt).length) }, opt };
}
const line = (size: Size) => `${size.rawKiB} KiB raw, ${size.optKiB} KiB after wasm-opt, ${size.brotliKiB} KiB brotli`;

// Each feature's build first, then the base, so host/web/pkg/ is left as the base.
type Added = { moreBrotliKiB: number; moreOptKiB: number };
const features: Record<string, Size & Added & { against?: Record<string, Added> }> = {};
const featureSizes: Record<string, Size> = {};
for (const feature of Object.keys(FEATURES)) featureSizes[feature] = measure(feature).size;
const { size: host, opt } = measure('');
for (const [name, marker] of Object.entries(MARKERS)) if (opt.includes(marker)) failures.push(`the host's wasm holds "${marker}": the ${name} linked`);
console.log(`host (base): ${line(host)}`);
for (const [feature, size] of Object.entries(featureSizes)) {
  const added = (than: Size): Added => ({ moreOptKiB: Number((size.optKiB - than.optKiB).toFixed(1)), moreBrotliKiB: Number((size.brotliKiB - than.brotliKiB).toFixed(1)) });
  // Against each of its features alone, and each it turns on.
  const parts = [...feature.split(','), ...(TURNS_ON[feature] ?? [])].filter((part) => part !== feature && featureSizes[part]);
  const against = Object.fromEntries(parts.map((part) => [part, added(featureSizes[part]!)]));
  features[feature] = { ...size, ...added(host), ...(parts.length ? { against } : {}) };
  const more = Object.entries(against).map(([part, by]) => `, ${by.moreBrotliKiB} KiB brotli (${by.moreOptKiB} after wasm-opt) more than ${part} alone`).join('');
  console.log(`host with ${feature}: ${line(size)}: ${features[feature].moreBrotliKiB} KiB brotli more${more}`);
}

// Unstripped builds, their own target dir so the release cache stays put:
// each build once, every marker counted in it.
const symbolDir = join(repo, 'target/symbols');
const unstripped = new Map<string, string>();
function holds(features: string, marker: string): number {
  if (!unstripped.has(features)) {
    run('cargo', ['build', '-p', 'tall-table-host', '--target', 'wasm32-unknown-unknown', '--release', '--target-dir', symbolDir, ...(features ? ['--features', features] : [])]);
    unstripped.set(features, readFileSync(join(symbolDir, 'wasm32-unknown-unknown/release/tall_table_host.wasm')).toString('latin1'));
  }
  return unstripped.get(features)!.split(marker).length - 1;
}
process.env.CARGO_PROFILE_RELEASE_STRIP = 'false';
type Held = { base: number; feature: number; alone?: Record<string, number> };
/** By feature: its marker's counts, or with several markers each one's. */
const symbols: Record<string, Held | { markers: Record<string, Held> }> = {};
for (const [feature, given] of Object.entries(FEATURES)) {
  const markers = Array.isArray(given) ? given : [given];
  const held: Record<string, Held> = {};
  for (const marker of markers) {
    const counts: Held = { base: holds('', marker), feature: holds(feature, marker) };
    if (counts.base) failures.push(`the base holds ${counts.base} of ${feature}'s symbols (${marker})`);
    if (!counts.feature) failures.push(`control: ${feature}'s build holds none of its symbols (${marker}): the check can't see them`);
    // Code only both features build: neither alone holds it. A feature's
    // code: a build of what it turns on doesn't hold it.
    const parts = feature.includes(',') ? feature.split(',') : (TURNS_ON[feature] ?? []);
    if (parts.length) counts.alone = Object.fromEntries(parts.map((part) => [part, holds(part, marker)]));
    for (const [part, count] of Object.entries(counts.alone ?? {})) if (count) failures.push(`${part} alone holds ${count} of ${feature}'s symbols (${marker})`);
    const alone = Object.entries(counts.alone ?? {}).map(([part, count]) => `, ${part} alone ${count}`).join('');
    console.log(`symbols ${marker}: base ${counts.base}${alone}, with ${feature} ${counts.feature}`);
    held[marker] = counts;
  }
  symbols[feature] = markers.length === 1 ? held[markers[0]!]! : { markers: held };
}
delete process.env.CARGO_PROFILE_RELEASE_STRIP;

// The base at another commit against the working tree's, each built in turn
// in a worktree at one fixed path: the base unchanged (within a little:
// panic sites keep their line numbers, which code above them shifts). The
// same path for both, because the build embeds it (panic locations): the
// same commit built in the repo and in a worktree differed by 1.4 KiB
// before brotli, and in two worktrees at random paths by 0.5 KiB brotli.
const against = option('against');
let parent: { commit: string; then: Size; now: Size; moreOptKiB: number; moreBrotliKiB: number } | null = null;
/** The base built in a worktree of `commit` at the fixed path, with
 *  `prepare` run in it first; its own target dir (the recipe reads the wasm from its checkout's),
 *  a cold build, removed with the worktree. */
function inWorktree(commit: string, prepare: (dir: string) => void = () => {}): Size {
  const dir = join(tmpdir(), 'tall-table-size');
  if (existsSync(dir)) {
    execFileSync('git', ['worktree', 'remove', '--force', dir], { cwd: repo, stdio: 'ignore' });
    rmSync(dir, { recursive: true, force: true });
  }
  try {
    run('git', ['worktree', 'add', '--detach', dir, commit]);
    prepare(dir);
    return measure('', dir).size;
  } finally {
    run('git', ['worktree', 'remove', '--force', dir]);
    rmSync(dir, { recursive: true, force: true });
  }
}
if (against) {
  const commit = run('git', ['rev-parse', '--short', against]).trim();
  const then = inWorktree(commit);
  // HEAD with the working tree's changes and new files.
  const now = inWorktree('HEAD', (dir) => {
    const diff = execFileSync('git', ['diff', 'HEAD', '--binary'], { cwd: repo });
    if (diff.length) execFileSync('git', ['apply'], { cwd: dir, input: diff });
    for (const file of run('git', ['ls-files', '--others', '--exclude-standard']).split('\n').filter(Boolean)) {
      mkdirSync(join(dir, file, '..'), { recursive: true });
      writeFileSync(join(dir, file), readFileSync(join(repo, file)));
    }
  });
  parent = { commit, then, now, moreOptKiB: Number((now.optKiB - then.optKiB).toFixed(1)), moreBrotliKiB: Number((now.brotliKiB - then.brotliKiB).toFixed(1)) };
  console.log(`host (base) in a worktree, at ${commit}: ${line(then)}; the working tree: ${line(now)}: ${parent.moreOptKiB} KiB after wasm-opt, ${parent.moreBrotliKiB} KiB brotli more`);
  // Gated before brotli: brotli moves up to ~2 KiB when a few bytes shift
  // (a panic site's line number), the same commit at two paths by 0.5 KiB.
  if (Math.abs(parent.moreOptKiB) > 0.1) failures.push(`the base changed: ${parent.moreOptKiB} KiB after wasm-opt against ${commit}`);
}

let contender: { file: string; optKiB: number; brotliKiB: number; moreBrotliKiB: number } | null = null;
const assets = join(repo, 'apps/observatory/contenders/tall-table/gpui/web/dist/assets');
const shipped = existsSync(assets) ? readdirSync(assets).find((name) => /^tall_table_gpui_bg-[\w-]+\.wasm$/.test(name)) : undefined;
if (shipped) {
  const bytes = readFileSync(join(assets, shipped));
  const brotliKiB = kib(brotli(bytes).length);
  contender = { file: shipped, optKiB: kib(bytes.length), brotliKiB, moreBrotliKiB: Number((brotliKiB - host.brotliKiB).toFixed(1)) };
  console.log(`the GPUI contender: ${contender.optKiB} KiB, ${brotliKiB} KiB brotli: ${contender.moreBrotliKiB} KiB more (its engine client and Arrow reader)`);
} else console.log('the GPUI contender: not built (`just observatory gpui-build`); no cross-check');

const label = option('label');
if (label) {
  const date = localDate();
  const out = join(perfDir, 'results', `${date}-${label}.json`);
  mkdirSync(join(perfDir, 'results'), { recursive: true });
  writeFileSync(out, `${JSON.stringify({ date, label, ...machineInfo(), build: 'base', cargo: linked, host, features, symbols, against: parent, contender, failures }, null, 2)}\n`);
  console.log(`wrote ${out}`);
}
if (failures.length) {
  console.error(`FAIL\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
