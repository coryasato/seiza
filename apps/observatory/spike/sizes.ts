// The spike page's JS against React alone, raw and brotli (quality 11): a
// rough size of what the scroll model and TanStack Virtual add.
//
//   node apps/observatory/spike/sizes.ts [--label spike]   → ../perf/results/<date>-<label>-sizes.json

import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'vite';
import { brotli } from '../../../shared-web/src/brotli.ts';
import { machineInfo, option } from '../../../shared-web/perf/protocol.ts';

const dir = import.meta.dirname;

async function size(entry: string): Promise<{ raw: number; brotli: number }> {
  const outDir = mkdtempSync(join(tmpdir(), 'spike-sizes-'));
  await build({
    root: dir,
    configFile: `${dir}/vite.config.ts`,
    logLevel: 'warn',
    build: { outDir, emptyOutDir: true, rolldownOptions: { input: `${dir}/${entry}` } },
  });
  const js = readdirSync(join(outDir, 'assets')).filter((name) => name.endsWith('.js'));
  const bytes = js.map((name) => readFileSync(join(outDir, 'assets', name)));
  rmSync(outDir, { recursive: true });
  return { raw: bytes.reduce((sum, b) => sum + b.length, 0), brotli: bytes.reduce((sum, b) => sum + brotli(b).length, 0) };
}

const page = await size('index.html');
const react = await size('src/baseline.ts');
const date = new Date().toISOString().slice(0, 10);
const results = { page, react, added: { raw: page.raw - react.raw, brotli: page.brotli - react.brotli } };
const path = `${dir}/../perf/results/${date}-${option('label') ?? 'spike'}-sizes.json`;
writeFileSync(path, `${JSON.stringify({ date, ...machineInfo(), scenario: 'sizes', results }, null, 2)}\n`);
console.log(JSON.stringify(results), `→ ${path}`);
