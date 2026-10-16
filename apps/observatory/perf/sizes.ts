// The GPUI contender's wasm, with and without `seiza`'s observation panel,
// and the check that the panel never leaks into the contender's own build
// (root CLAUDE.md, "Comparison protocol": neither side carries code for
// something it doesn't have).
//
// Always (also `--check`, which `just observatory check` runs):
// - Cargo's view: `cargo tree -e features -i seiza` for the contender built
//   alone (`-p`) must not enable `seiza`'s `panel`. Negative control: the
//   same for the contender built together with Tycho, where Cargo unifies
//   Tycho's `panel` into it, must.
// - The shipped wasm (web/dist, from `just observatory gpui-build`) must not
//   hold the panel's global (`__seizaPerfOverlay`, which only the panel
//   writes).
// Without --check, also: the release wasm built with `--features seiza/panel`
// (bindgen + wasm-opt as shipped), whose bytes must hold that global (the
// control), and raw and brotli sizes of both. The contender's own build is
// rebuilt last, so target/ is left as `gpui-build` made it.
//
// Usage: node apps/observatory/perf/sizes.ts [--check] [--label <name>]
// --label writes perf/results/<date>-<label>.json.

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { brotli } from '../../../shared-web/src/brotli.ts';
import { flag, machineInfo, option } from '../../../shared-web/perf/protocol.ts';
import { gpuiWebDir, perfDir } from './harness.ts';

const repo = join(perfDir, '../../..');
const PANEL_MARKER = '__seizaPerfOverlay';
const WASM_OPT = ['-Oz', '--enable-bulk-memory', '--enable-nontrapping-float-to-int', '--enable-sign-ext', '--enable-mutable-globals', '--enable-reference-types', '--enable-multivalue', '--enable-threads'];
const failures: string[] = [];
const run = (command: string, args: string[]) => execFileSync(command, args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });

/** Whether Cargo enables `seiza`'s `panel` when building these packages. */
const panelEnabled = (packages: string[]) =>
  run('cargo', ['tree', '-e', 'features', '-i', 'seiza', '--target', 'wasm32-unknown-unknown', ...packages.flatMap((name) => ['-p', name])]).includes('seiza feature "panel"');

const alone = panelEnabled(['tall-table-gpui']);
const unified = panelEnabled(['tall-table-gpui', 'tycho']);
if (alone) failures.push('cargo enables seiza\'s panel for the contender built alone');
if (!unified) failures.push('control: cargo should enable seiza\'s panel for the contender built with Tycho, and didn\'t');
console.log(`cargo: panel built alone ${alone}, with Tycho ${unified} (control)`);

const sizes = (bytes: Buffer) => ({ rawKiB: Number((bytes.length / 1024).toFixed(1)), brotliKiB: Number((brotli(bytes).length / 1024).toFixed(1)), panel: bytes.includes(PANEL_MARKER) });
const assets = join(gpuiWebDir, 'dist/assets');
const shippedName = readdirSync(assets).find((name) => /^tall_table_gpui_bg-[\w-]+\.wasm$/.test(name));
if (!shippedName) throw new Error(`no contender wasm in ${assets}; run \`just observatory gpui-build\` first`);
const shipped = sizes(readFileSync(join(assets, shippedName)));
if (shipped.panel) failures.push(`the shipped wasm holds ${PANEL_MARKER}: the panel linked`);
console.log(`shipped: ${shipped.rawKiB} KiB raw, ${shipped.brotliKiB} KiB brotli, panel ${shipped.panel}`);

/** The release wasm with `features`, through wasm-bindgen and wasm-opt. */
function build(features: string[]): Buffer {
  run('cargo', ['build', '-p', 'tall-table-gpui', '--target', 'wasm32-unknown-unknown', '--release', ...features]);
  const out = mkdtempSync(join(tmpdir(), 'seiza-sizes-'));
  run('wasm-bindgen', [join(repo, 'target/wasm32-unknown-unknown/release/tall_table_gpui.wasm'), '--out-dir', out, '--target', 'web']);
  const wasm = join(out, 'tall_table_gpui_bg.wasm');
  run('wasm-opt', [...WASM_OPT, wasm, '-o', wasm]);
  return readFileSync(wasm);
}

let variants: { withPanel: ReturnType<typeof sizes>; withoutPanel: ReturnType<typeof sizes> } | null = null;
if (!flag('check')) {
  const withPanel = sizes(build(['--features', 'seiza/panel']));
  const withoutPanel = sizes(build([]));
  variants = { withPanel, withoutPanel };
  if (!withPanel.panel) failures.push(`control: the build with seiza/panel should hold ${PANEL_MARKER}, and doesn't`);
  if (withoutPanel.panel) failures.push(`the build without the panel holds ${PANEL_MARKER}`);
  console.log(`with panel: ${withPanel.rawKiB} KiB raw, ${withPanel.brotliKiB} KiB brotli (control: panel ${withPanel.panel})`);
  console.log(`without: ${withoutPanel.rawKiB} KiB raw, ${withoutPanel.brotliKiB} KiB brotli; the panel adds ${(withPanel.brotliKiB - withoutPanel.brotliKiB).toFixed(1)} KiB brotli`);
}

const label = option('label');
if (label) {
  const date = new Date().toISOString().slice(0, 10);
  const out = join(perfDir, 'results', `${date}-${label}.json`);
  mkdirSync(join(perfDir, 'results'), { recursive: true });
  writeFileSync(out, `${JSON.stringify({ date, label, ...machineInfo(), cargo: { panelAlone: alone, panelWithTycho: unified }, shipped: { file: shippedName, ...shipped }, variants, failures }, null, 2)}\n`);
  console.log(`wrote ${out}`);
}
if (failures.length) {
  console.error(`\nFAIL\n${failures.map((failure) => `  ${failure}`).join('\n')}`);
  process.exit(1);
}
console.log('\nPASS');
