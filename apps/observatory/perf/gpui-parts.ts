// The GPUI contender's page by part, brotli: its HTML (the placeholder's
// inlined font subset, the rest), its JS (wasm-bindgen's glue, the rest),
// and its wasm: the framework (gpui-kit and everything it pulls in), the
// component (seiza-tall-table), the data layer (seiza-duckdb and Arrow), the
// host (the contender and `seiza`), Rust's runtime and the JS bindings, the
// static data, and the module's other sections.
//
// The HTML: the whole file's brotli against the same file with the font's
// base64 emptied. The JS: the glue (web/pkg/'s, minified alone by Vite's own
// minifier, then compressed) against the bundle's brotli; the rest is the
// difference, so the split is close, not exact.
//
// The shipped wasm has no names (`strip = true`), so this builds the same
// release wasm with its name section kept (`CARGO_PROFILE_RELEASE_STRIP=none`,
// wasm-bindgen, then wasm-opt with `-g`), checks its code section is the
// shipped one's size, and reads each function body's crate from its name:
// the first crate in the demangled name that isn't Rust's own, so a generic
// instantiated for another crate's type counts where its code was written
// (`core::ptr::drop_in_place::<gpui::Window>` is gpui's;
// `serde_json::…::<gpui_component::…>` serde_json's). Which crate belongs to
// which part comes from `cargo tree` of the contender: a crate is the
// framework's if gpui-kit reaches it, else `seiza`'s, the component's, or
// the data layer's, in that order. Each part's bodies are compressed on
// their own (brotli 11), and the shares scaled to the whole file's brotli
// size, since a part compressed alone loses the context it shares with the
// rest. The data section (strings and tables, unnamed) is its own part.
//
// Usage: node apps/observatory/perf/gpui-parts.ts [--label <name>]
// Run `just observatory gpui-build` first (the shipped wasm it compares).
// The build leaves target/'s release wasm unstripped; `gpui-build` relinks it.

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { minifySync } from 'vite';
import { brotli } from '../../../shared-web/src/brotli.ts';
import { machineInfo, option } from '../../../shared-web/perf/protocol.ts';
import { gpuiWebDir, perfDir } from './harness.ts';

const repo = join(perfDir, '../../..');
const WASM_OPT = ['-Oz', '--enable-bulk-memory', '--enable-nontrapping-float-to-int', '--enable-sign-ext', '--enable-mutable-globals', '--enable-reference-types', '--enable-multivalue', '--enable-threads'];
const run = (command: string, args: string[], env: NodeJS.ProcessEnv = process.env) =>
  execFileSync(command, args, { cwd: repo, encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 64 * 2 ** 20 });

type Part = 'framework' | 'component' | 'data layer' | 'host' | 'runtime' | 'static data' | 'other sections';
const PARTS: Part[] = ['framework', 'component', 'data layer', 'host', 'runtime', 'static data', 'other sections'];
/** Rust's own crates and the JS bindings: not in `cargo tree`, or in every part's. */
const RUNTIME = new Set(['core', 'alloc', 'std', 'compiler_builtins', 'dlmalloc', 'panic_abort', 'rustc_demangle', 'wasm_bindgen', 'wasm_bindgen_futures', 'js_sys', 'web_sys']);
const STD = new Set(['core', 'alloc', 'std', 'compiler_builtins']);

// ---------------------------------------------------------------- which crate is which part

/** Each package's library name (`gpui-pre` builds `gpui`), as symbols spell it. */
function libNames(): Map<string, string> {
  const metadata = JSON.parse(run('cargo', ['metadata', '--format-version', '1', '--filter-platform', 'wasm32-unknown-unknown'])) as { packages: { name: string; targets: { name: string; kind: string[] }[] }[] };
  const names = new Map<string, string>();
  for (const pkg of metadata.packages) {
    const lib = pkg.targets.find((target) => target.kind.some((kind) => kind.endsWith('lib')));
    if (lib) names.set(pkg.name, lib.name.replaceAll('-', '_'));
  }
  return names;
}

/** The contender's dependency graph, crate names as symbols spell them. */
function graph(): Map<string, Set<string>> {
  const libs = libNames();
  const edges = new Map<string, Set<string>>();
  const stack: string[] = [];
  for (const line of run('cargo', ['tree', '-p', 'tall-table-gpui', '--target', 'wasm32-unknown-unknown', '-e', 'normal', '--prefix', 'depth']).split('\n')) {
    const match = /^(\d+)(\S+)/.exec(line);
    if (!match) continue;
    const depth = Number(match[1]);
    const name = libs.get(match[2]!) ?? match[2]!.replaceAll('-', '_');
    stack[depth] = name;
    stack.length = depth + 1;
    if (!edges.has(name)) edges.set(name, new Set());
    if (depth > 0) edges.get(stack[depth - 1]!)!.add(name);
  }
  return edges;
}

function reach(edges: Map<string, Set<string>>, from: string): Set<string> {
  const seen = new Set<string>();
  const queue = [from];
  while (queue.length) {
    const name = queue.pop()!;
    if (seen.has(name)) continue;
    seen.add(name);
    queue.push(...(edges.get(name) ?? []));
  }
  return seen;
}

const edges = graph();
const framework = reach(edges, 'gpui_kit');
const seiza = reach(edges, 'seiza');
const component = reach(edges, 'seiza_tall_table');
const dataLayer = reach(edges, 'seiza_duckdb');
for (const name of ['gpui_kit', 'seiza', 'seiza_tall_table', 'seiza_duckdb']) if (!edges.has(name)) throw new Error(`cargo tree has no ${name}`);

function partOf(crate: string | null): Part {
  if (crate === null || RUNTIME.has(crate)) return 'runtime';
  if (framework.has(crate)) return 'framework';
  if (seiza.has(crate) || crate === 'tall_table_gpui') return 'host';
  if (component.has(crate)) return 'component';
  if (dataLayer.has(crate)) return 'data layer';
  return 'host';
}

/** The first crate named in a demangled symbol that isn't Rust's own (`name[hash]::`), else Rust's, else null. */
function crateOf(symbol: string): string | null {
  const crates = [...symbol.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\[[0-9a-f]{8,16}\]::/g)].map((match) => match[1]!);
  return crates.find((crate) => !STD.has(crate)) ?? crates[0] ?? null;
}

// ---------------------------------------------------------------- the wasm's sections

interface Module {
  sections: { id: number; name?: string; bytes: Buffer }[];
  /** Function bodies, in function-index order after the imports. */
  bodies: Buffer[];
  importedFunctions: number;
  /** Function names by index (the name section's subsection 1). */
  names: Map<number, string>;
}

function parse(bytes: Buffer): Module {
  let at = 8;
  const leb = () => {
    let value = 0;
    let shift = 0;
    for (;;) {
      const byte = bytes[at++]!;
      value += (byte & 0x7f) * 2 ** shift;
      shift += 7;
      if (!(byte & 0x80)) return value;
    }
  };
  const string = () => {
    const length = leb();
    at += length;
    return bytes.toString('utf8', at - length, at);
  };
  const limits = () => {
    const flags = bytes[at++]!;
    leb();
    if (flags & 1) leb();
  };
  const module: Module = { sections: [], bodies: [], importedFunctions: 0, names: new Map() };
  while (at < bytes.length) {
    const id = bytes[at++]!;
    const size = leb();
    const start = at;
    const end = start + size;
    const section: Module['sections'][number] = { id, bytes: bytes.subarray(start, end) };
    if (id === 0) {
      section.name = string();
      if (section.name === 'name') {
        while (at < end) {
          const sub = bytes[at++]!;
          const subEnd = leb() + at;
          if (sub === 1) for (let count = leb(); count > 0; count--) module.names.set(leb(), string());
          at = subEnd;
        }
      }
    } else if (id === 2) {
      for (let count = leb(); count > 0; count--) {
        string();
        string();
        const kind = bytes[at++]!;
        if (kind === 0) {
          leb();
          module.importedFunctions++;
        } else if (kind === 1) {
          at++;
          limits();
        } else if (kind === 2) limits();
        else if (kind === 3) at += 2;
        else if (kind === 4) {
          at++;
          leb();
        } else throw new Error(`import kind ${kind}`);
      }
    } else if (id === 10) {
      for (let count = leb(); count > 0; count--) {
        const length = leb();
        module.bodies.push(bytes.subarray(at, at + length));
        at += length;
      }
    }
    module.sections.push(section);
    at = end;
  }
  return module;
}

// ---------------------------------------------------------------- build, split, compress

const assets = join(gpuiWebDir, 'dist/assets');
const shippedName = readdirSync(assets).find((name) => /^tall_table_gpui_bg-[\w-]+\.wasm$/.test(name));
if (!shippedName) throw new Error(`no contender wasm in ${assets}; run \`just observatory gpui-build\` first`);
const shipped = readFileSync(join(assets, shippedName));

run('cargo', ['build', '-p', 'tall-table-gpui', '--target', 'wasm32-unknown-unknown', '--release'], { ...process.env, CARGO_PROFILE_RELEASE_STRIP: 'none' });
const out = mkdtempSync(join(tmpdir(), 'seiza-gpui-parts-'));
// No --keep-debug: wasm-opt can't read the DWARF std's objects carry.
run('wasm-bindgen', [join(repo, 'target/wasm32-unknown-unknown/release/tall_table_gpui.wasm'), '--out-dir', out, '--target', 'web']);
const namedPath = join(out, 'named.wasm');
run('wasm-opt', [...WASM_OPT, '-g', join(out, 'tall_table_gpui_bg.wasm'), '-o', namedPath]);
const named = parse(readFileSync(namedPath));
const plain = parse(shipped);

const codeSize = (module: Module) => module.sections.find((section) => section.id === 10)!.bytes.length;
const failures: string[] = [];
const codeDelta = codeSize(named) - codeSize(plain);
// Within 0.5%: with -g, wasm-opt keeps a few functions it would otherwise
// merge (7 more of 22,480, +0.06% code, measured 2026-10-20).
if (Math.abs(named.bodies.length - plain.bodies.length) > plain.bodies.length * 0.005) failures.push(`the named build has ${named.bodies.length} functions, the shipped ${plain.bodies.length}`);
if (Math.abs(codeDelta) > codeSize(plain) * 0.005) failures.push(`the named build's code section differs from the shipped one's by ${codeDelta} bytes`);

const bodies = new Map<Part, Buffer[]>(PARTS.map((part) => [part, []]));
const crates = new Map<string, number>();
named.bodies.forEach((body, index) => {
  const symbol = named.names.get(index + named.importedFunctions) ?? '';
  const crate = crateOf(symbol);
  bodies.get(partOf(crate))!.push(body);
  crates.set(crate ?? '(unnamed)', (crates.get(crate ?? '(unnamed)') ?? 0) + body.length);
});
// Each part found where it should be: a crate graph read wrong (a library
// named apart from its package) fails here, not in the numbers.
for (const [crate, part] of [['gpui', 'framework'], ['seiza_tall_table', 'component'], ['seiza_duckdb', 'data layer'], ['tall_table_gpui', 'host']] as const) {
  if (partOf(crate) !== part) failures.push(`${crate} counted as ${partOf(crate)}, not ${part}`);
  if (!crates.get(crate)) failures.push(`no function named for ${crate}`);
}
// The rest, from the shipped file (no names to strip there).
for (const section of plain.sections) {
  if (section.id === 11) bodies.get('static data')!.push(section.bytes);
  else if (section.id !== 10) bodies.get('other sections')!.push(section.bytes);
}

const wholeBrotli = brotli(shipped).length;
const alone = new Map(PARTS.map((part) => [part, brotli(Buffer.concat(bodies.get(part)!)).length]));
const aloneSum = [...alone.values()].reduce((sum, value) => sum + value, 0);
const kib = (bytes: number) => Number((bytes / 1024).toFixed(1));
const parts = PARTS.map((part) => {
  const raw = bodies.get(part)!.reduce((sum, body) => sum + body.length, 0);
  return { part, functions: part === 'static data' || part === 'other sections' ? null : bodies.get(part)!.length, rawKiB: kib(raw), brotliAloneKiB: kib(alone.get(part)!), brotliKiB: kib((alone.get(part)! * wholeBrotli) / aloneSum), sharePct: Number(((alone.get(part)! / aloneSum) * 100).toFixed(1)) };
});
const topCrates = [...crates].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([crate, raw]) => ({ crate, part: partOf(crate === '(unnamed)' ? null : crate), rawKiB: kib(raw) }));

// ---------------------------------------------------------------- the HTML and the JS

const html = readFileSync(join(gpuiWebDir, 'dist/index.html'), 'utf8');
const inlinedFont = /data:font\/woff2;base64,[A-Za-z0-9+/=]+/.exec(html)?.[0];
if (!inlinedFont) failures.push("the HTML has no inlined woff2: the placeholder's font moved");
const htmlBrotli = brotli(Buffer.from(html)).length;
const htmlWithoutFont = brotli(Buffer.from(inlinedFont ? html.replace(inlinedFont, 'data:font/woff2;base64,') : html)).length;
const bundleName = readdirSync(assets).find((name) => /^index-[\w-]+\.js$/.test(name));
if (!bundleName) throw new Error(`no entry bundle in ${assets}`);
const bundleBrotli = brotli(readFileSync(join(assets, bundleName))).length;
const glue = minifySync('glue.js', readFileSync(join(gpuiWebDir, 'pkg/tall_table_gpui.js'), 'utf8'), {});
const glueBrotli = brotli(Buffer.from(glue.code)).length;
const page = {
  html: { brotliKiB: kib(htmlBrotli), placeholderFontKiB: kib(htmlBrotli - htmlWithoutFont), restKiB: kib(htmlWithoutFont), fontBinaryKiB: inlinedFont ? kib(Buffer.from(inlinedFont.split(',')[1]!, 'base64').length) : null },
  js: { file: bundleName, brotliKiB: kib(bundleBrotli), glueKiB: kib(glueBrotli), restKiB: kib(bundleBrotli - glueBrotli) },
};

console.log(`HTML: ${page.html.brotliKiB} KiB brotli, the placeholder's font ${page.html.placeholderFontKiB} (${page.html.fontBinaryKiB} KiB of woff2), the rest ${page.html.restKiB}`);
console.log(`JS: ${page.js.brotliKiB} KiB brotli, wasm-bindgen's glue ${page.js.glueKiB} alone, the rest ${page.js.restKiB}\n`);
console.log(`shipped ${shippedName}: ${kib(shipped.length)} KiB raw, ${kib(wholeBrotli)} KiB brotli; named build's code section ${codeDelta >= 0 ? '+' : ''}${codeDelta} bytes`);
console.log('part'.padEnd(16), 'functions'.padStart(9), 'raw KiB'.padStart(9), 'br alone'.padStart(9), 'br KiB'.padStart(9), 'share'.padStart(7));
for (const part of parts) console.log(part.part.padEnd(16), String(part.functions ?? '').padStart(9), String(part.rawKiB).padStart(9), String(part.brotliAloneKiB).padStart(9), String(part.brotliKiB).padStart(9), `${part.sharePct}%`.padStart(7));
console.log(`\nthe parts compressed alone sum to ${kib(aloneSum)} KiB (the whole file: ${kib(wholeBrotli)})`);
console.log(`\ntop crates (code, raw):\n${topCrates.map((entry) => `  ${String(entry.rawKiB).padStart(8)} KiB  ${entry.crate} (${entry.part})`).join('\n')}`);

const label = option('label');
if (label) {
  const date = new Date().toISOString().slice(0, 10);
  const file = join(perfDir, 'results', `${date}-${label}.json`);
  mkdirSync(join(perfDir, 'results'), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ date, label, ...machineInfo(), shipped: { file: shippedName, rawKiB: kib(shipped.length), brotliKiB: kib(wholeBrotli) }, page, namedCodeDeltaBytes: codeDelta, brotliAloneSumKiB: kib(aloneSum), parts, topCrates, failures }, null, 2)}\n`);
  console.log(`wrote ${file}`);
}
if (failures.length) {
  console.error(`\nFAIL\n${failures.map((failure) => `  ${failure}`).join('\n')}`);
  process.exit(1);
}
console.log('\nPASS');
