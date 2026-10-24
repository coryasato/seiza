// Writes `fixtures/paint.json`'s expectations from the browser, so the
// table's paint is checked against what a DOM contender would draw, not
// against itself: each color case's color is Chromium's
// `color-mix(in oklab, …)` of the ramp's two neighboring stops, filled into
// a 2D canvas and read back as 8-bit RGBA; each bar's left edge and width
// are the formula in `fixtures/README.md`. The stops are the fixture's own
// (by hand; the native test checks them against the theme).
//
// Usage: node components/tall-table/perf/paint-fixture.ts [--check]
// --check fails if the file would change.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { componentDir } from './harness.ts';

type Rgba = [number, number, number, number];
interface ColorCase { ramp: string; as: 'fill' | 'text'; value: number; why?: string; expect?: { light: Rgba; dark: Rgba } }
interface BarCase { zero: number; value: number; why?: string; expect?: { left: number; width: number } | null }
interface Fixture {
  about: string;
  cell: { width: number; row_height: number; padding: number; bar_inset: number };
  tolerance: { channel_steps: number; bar_px: number };
  ramps: Record<string, { stops: string[]; light: string[]; dark: string[] }>;
  colors: ColorCase[];
  bars: BarCase[];
  none: unknown[];
}

const file = join(componentDir, 'fixtures/paint.json');
const before = readFileSync(file, 'utf8');
const fixture = JSON.parse(before) as Fixture;
const clamp = (value: number) => Math.min(1, Math.max(0, value));

/** The stops a value falls between, and how far along: evenly spaced over 0..1. */
function segment(stops: string[], value: number): { from: string; to: string; t: number } {
  const along = clamp(value) * (stops.length - 1);
  const index = Math.min(Math.floor(along), stops.length - 2);
  return { from: stops[index]!, to: stops[index + 1]!, t: along - index };
}

const browser = await chromium.launch({ channel: 'chromium' });
try {
  const page = await browser.newPage();
  const mixes = fixture.colors.flatMap((c) =>
    (['light', 'dark'] as const).map((mode) => segment(fixture.ramps[c.ramp]!.stops.map((_, i) => fixture.ramps[c.ramp]![mode][i]!), c.value)),
  );
  const read = await page.evaluate((mixes) => {
    const canvas = new OffscreenCanvas(1, 1);
    const context = canvas.getContext('2d', { willReadFrequently: true })!;
    return mixes.map(({ from, to, t }) => {
      const css = `color-mix(in oklab, ${from} ${((1 - t) * 100).toFixed(6)}%, ${to})`;
      context.clearRect(0, 0, 1, 1);
      // A sentinel no opaque mix reads back as: an invalid color leaves it.
      context.fillStyle = 'rgba(1, 2, 3, 0.5)';
      const sentinel = context.fillStyle;
      context.fillStyle = css;
      if (context.fillStyle === sentinel) throw new Error(`the canvas didn't take ${css}`);
      context.fillRect(0, 0, 1, 1);
      return Array.from(context.getImageData(0, 0, 1, 1).data);
    });
  }, mixes);
  fixture.colors.forEach((c, index) => {
    c.expect = { light: read[index * 2] as Rgba, dark: read[index * 2 + 1] as Rgba };
  });
} finally {
  await browser.close();
}

const { width, padding } = fixture.cell;
const inner = width - 2 * padding;
const round = (px: number) => Number(px.toFixed(3));
for (const bar of fixture.bars) {
  const [zero, end] = [clamp(bar.zero), clamp(bar.value)];
  const barWidth = Math.abs(end - zero) * inner;
  bar.expect = barWidth > 0 ? { left: round(padding + Math.min(zero, end) * inner), width: round(barWidth) } : null;
}

// One case a line, as the file is written by hand.
const lines = (items: unknown[]) => `[\n${items.map((item) => `    ${JSON.stringify(item)}`).join(',\n')}\n  ]`;
const ramps = Object.entries(fixture.ramps).map(([name, ramp]) => `    ${JSON.stringify(name)}: ${JSON.stringify(ramp)}`).join(',\n');
const after = `{
  "about": ${JSON.stringify(fixture.about)},
  "cell": ${JSON.stringify(fixture.cell)},
  "tolerance": ${JSON.stringify(fixture.tolerance)},
  "ramps": {
${ramps}
  },
  "colors": ${lines(fixture.colors)},
  "bars": ${lines(fixture.bars)},
  "none": ${lines(fixture.none)}
}
`;
if (process.argv.includes('--check')) {
  if (after !== before) {
    console.error('FAIL: fixtures/paint.json is out of date: run `just tall-table paint-fixture`');
    process.exit(1);
  }
  console.log('ok: fixtures/paint.json is up to date');
} else {
  writeFileSync(file, after);
  console.log(`wrote ${file}: ${fixture.colors.length} colors, ${fixture.bars.length} bars`);
}
