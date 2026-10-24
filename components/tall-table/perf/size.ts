// The bare host's wasm, the base every feature's added bytes are read
// against: raw (cargo's release output), after wasm-bindgen and wasm-opt (the apps' flags), and
// brotli 11, built here the way `just tall-table build` builds it. Checks
// that it carries nothing but the table: Cargo links no engine
// (`seiza-duckdb`) and no observation panel (`seiza`'s `panel`), and the
// wasm holds neither's global. The observatory's GPUI contender's shipped
// wasm (`just observatory gpui-build`, when built) is the cross-check: the
// same table and bootstrap plus its engine client and Arrow reader.
//
// Usage: node components/tall-table/perf/size.ts [--label <name>]
// --label writes perf/results/<date>-<label>.json. Leaves host/web/pkg/ as
// a release build.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { brotli } from '../../../shared-web/src/brotli.ts';
import { localDate, machineInfo, option } from '../../../shared-web/perf/protocol.ts';
import { hostWebDir, perfDir, repo } from './harness.ts';

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

// The release wasm as `just tall-table build` makes it (its `wasm` recipe:
// cargo, wasm-bindgen, wasm-opt with the apps' flags), so this measures the
// binary the build ships. Raw is cargo's output, before either.
run('just', ['tall-table', 'wasm', 'release']);
const wasm = join(hostWebDir, 'pkg/tall_table_host_bg.wasm');
const raw = readFileSync(join(repo, 'target/wasm32-unknown-unknown/release/tall_table_host.wasm'));
const opt = readFileSync(wasm);
const host = { rawKiB: kib(raw.length), optKiB: kib(opt.length), brotliKiB: kib(brotli(opt).length) };
for (const [name, marker] of Object.entries(MARKERS)) if (opt.includes(marker)) failures.push(`the host's wasm holds "${marker}": the ${name} linked`);
console.log(`host: ${host.rawKiB} KiB raw, ${host.optKiB} KiB after wasm-opt, ${host.brotliKiB} KiB brotli`);

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
  writeFileSync(out, `${JSON.stringify({ date, label, ...machineInfo(), build: 'base', cargo: linked, host, contender, failures }, null, 2)}\n`);
  console.log(`wrote ${out}`);
}
if (failures.length) {
  console.error(`FAIL\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
