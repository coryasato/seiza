// The GPUI contender's static placeholder shell (shared-web/src/placeholder.ts)
// against its first frame, on the release build (web/dist):
// - its size: index.html raw and brotli;
// - its text is all in the placeholder font's character set;
// - screenshot match (shared-web/perf/placeholder-shots.ts), light and dark,
//   1440×900 at DPR 2 and DPR 1: the status line's text, and the frame's
//   surfaces (fill, border, corners). Images in perf/results/raw/placeholder/.
//
// --controls: negative controls for the match. Each injects a small CSS error
//   into the placeholder and must fail it.
//
// Usage: node apps/observatory/perf/placeholder.ts [--controls] [--label <name>]
// --label writes perf/results/<date>-<label>.json. Run `just observatory gpui-build` first.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { brotli } from '../../../shared-web/src/brotli.ts';
import { PLACEHOLDER_CHARS } from '../../../shared-web/src/placeholder.ts';
import { SCHEMES, compare, shoot, type HeldBack } from '../../../shared-web/perf/placeholder-shots.ts';
import { flag, machineInfo, option } from '../../../shared-web/perf/protocol.ts';
import { ENGINE_CHUNK, GPUI_WASM, gpuiWebDir, perfDir, serveGpui } from './harness.ts';

const PORT = 4312;
const label = option('label');
const date = new Date().toISOString().slice(0, 10);
const rawDir = join(perfDir, 'results/raw/placeholder');
/** The placeholder: the contender's wasm held back. The first frame: the
 *  engine's chunk held back, so it stays on "Engine loading…". */
const HELD: HeldBack = { wasm: GPUI_WASM, afterPaint: ENGINE_CHUNK };
const failures: string[] = [];
const output: Record<string, unknown> = { date, label, ...machineInfo() };

const html = readFileSync(join(gpuiWebDir, 'dist/index.html'));
output.sizes = { indexHtmlBytes: html.length, indexHtmlBrotliBytes: brotli(html).length };

const server = await serveGpui(PORT);
const browser = await chromium.launch({ channel: 'chromium' });
try {
  mkdirSync(rawDir, { recursive: true });
  const matches: Record<string, unknown> = {};
  for (const [dpr, scheme] of [2, 1].flatMap((dpr) => SCHEMES.map((scheme) => [dpr, scheme] as const))) {
    const name = `${scheme}@${dpr}x`;
    const shots = await shoot(browser, server.url, HELD, scheme, '', { dpr });
    if (!PLACEHOLDER_CHARS.test(shots.placeholderText.replace(/\s/g, ' '))) failures.push(`${name}: text outside the placeholder font: ${JSON.stringify(shots.placeholderText)}`);
    const result = await compare(browser, shots, dpr);
    for (const [file, bytes] of [['placeholder', shots.placeholder], ['first-frame', shots.firstFrame], ['diff', result.image]] as const) {
      writeFileSync(join(rawDir, `gpui-${name}-${file}.png`), bytes);
    }
    matches[name] = { regions: result.regions, surface: result.surface, failures: result.failures };
    failures.push(...result.failures.map((failure) => `${name}: ${failure}`));
    console.log(`${name}: ${result.failures.length ? `FAIL ${result.failures.join('; ')}` : 'match'} (surface ${(result.surface.share * 100).toFixed(4)}% differ; regions ${result.regions.map((region) => `${region.name} dx ${region.dx} dy ${region.dy} mass ${region.mass.toFixed(2)}`).join(', ')})`);
  }
  output.match = matches;

  if (flag('controls')) {
    // Each must fail the match, in light at DPR 2. A missing corner radius
    // isn't among them: ~120 device px differ, under the surface share's
    // limit (0.04% of 2880×1800, ~2,000 px).
    const controls: Record<string, string> = {
      'frame 1 px left': '#seiza-placeholder .sz-p-4 { padding-left: 15px; }',
      'frame 1 px shorter': '#seiza-placeholder .sz-p-4 { padding-bottom: 17px; }',
      'border color': '#seiza-placeholder { --border: #d4d4d4; }',
      'frame fill': '#seiza-placeholder { --table: #fafafa; }',
      // Up, not down: the placeholder's text sits 1 device px above GPUI's,
      // so 1 px (2 device px) down lands 1 below, inside the ink's ±1.
      'text 1 px up': '#seiza-placeholder .sz-frame { padding-top: 7px; }',
      'text in the foreground color': '#seiza-placeholder { --muted-fg: #0a0a0a; }',
      'fallback font': '#seiza-placeholder { font-family: serif; }',
    };
    const results: Record<string, string[]> = {};
    for (const [name, css] of Object.entries(controls)) {
      const result = await compare(browser, await shoot(browser, server.url, HELD, 'light', css));
      results[name] = result.failures;
      if (result.failures.length === 0) failures.push(`control "${name}" passed the match; it must fail`);
      console.log(`control ${name}: ${result.failures.length ? `fails (${result.failures[0]})` : 'PASSES: the match missed it'}`);
    }
    output.controls = results;
  }
} finally {
  await browser.close();
  await server.close();
}

output.failures = failures;
if (label) {
  const out = join(perfDir, 'results', `${date}-${label}.json`);
  writeFileSync(out, `${JSON.stringify(output, null, 2)}\n`);
  console.log(`wrote ${out}`);
}
if (failures.length) {
  console.error(`\nFAIL\n${failures.map((failure) => `  ${failure}`).join('\n')}`);
  process.exit(1);
}
console.log('\nPASS');
