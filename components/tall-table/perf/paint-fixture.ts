// Writes `fixtures/paint.json`'s expectations from the browser, so the
// table's paint is checked against what a DOM contender would draw, not
// against itself: each color case's color is Chromium's
// `color-mix(in oklab, …)` of the ramp's two neighboring stops, filled into
// a 2D canvas and read back as 8-bit RGBA; each bar's left edge and width
// are the formula in `fixtures/README.md`; each flash case's place in its
// ramp and opacity are the rule there, written here apart from the table's,
// and its color is Chromium's mix at that place with the opacity as its
// alpha. The stops are the fixture's own (by hand; the native test checks
// them against the theme).
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
/** A flash case's value: a float, NaN, NULL, or text. */
type FlashValue = number | 'NaN' | null | { text: string };
interface FlashCase { old: FlashValue; new: FlashValue; elapsed_ms: number; why?: string; expect?: { at: number; opacity: number; light: Rgba; dark: Rgba } | null }
interface Fixture {
  about: string;
  cell: { width: number; row_height: number; padding: number; bar_inset: number };
  tolerance: { channel_steps: number; bar_px: number };
  ramps: Record<string, { stops: string[]; light: string[]; dark: string[] }>;
  colors: ColorCase[];
  bars: BarCase[];
  none: unknown[];
  flash: { ramp: string; duration_ms: number; cases: FlashCase[] };
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

/** Where a change flashes in its ramp, or null for none: a float's rise at
 *  1, its fall at 0, any other change at 0.5; two NaNs are equal. */
function flashAt(old: FlashValue, now: FlashValue): number | null {
  const float = (value: FlashValue) => (typeof value === 'number' ? value : value === 'NaN' ? Number.NaN : undefined);
  const [a, b] = [float(old), float(now)];
  if (a !== undefined && b !== undefined) {
    if (Number.isNaN(a) && Number.isNaN(b)) return null;
    if (b > a) return 1;
    if (b < a) return 0;
    return a === b ? null : 0.5;
  }
  return JSON.stringify(old) === JSON.stringify(now) ? null : 0.5;
}

/** The flash's opacity `elapsed` into it, faded to nothing; null once over. */
const flashOpacity = (elapsed: number) => (elapsed >= fixture.flash.duration_ms ? null : 1 - elapsed / fixture.flash.duration_ms);

const flashes = fixture.flash.cases.map((c) => {
  const at = flashAt(c.old, c.new);
  const opacity = flashOpacity(c.elapsed_ms);
  return at === null || opacity === null ? null : { at, opacity };
});

const browser = await chromium.launch({ channel: 'chromium' });
try {
  const page = await browser.newPage();
  const mix = (ramp: string, value: number) =>
    (['light', 'dark'] as const).map((mode) => segment(fixture.ramps[ramp]!.stops.map((_, i) => fixture.ramps[ramp]![mode][i]!), value));
  const mixes = [
    ...fixture.colors.flatMap((c) => mix(c.ramp, c.value)),
    ...flashes.flatMap((flash) => (flash ? mix(fixture.flash.ramp, flash.at) : [])),
  ];
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
  let next = fixture.colors.length * 2;
  fixture.flash.cases.forEach((c, index) => {
    const flash = flashes[index];
    if (!flash) {
      c.expect = null;
      return;
    }
    const alpha = Math.round(flash.opacity * 255);
    const [light, dark] = [read[next] as Rgba, read[next + 1] as Rgba];
    next += 2;
    c.expect = { at: flash.at, opacity: Number(flash.opacity.toFixed(4)), light: [light[0], light[1], light[2], alpha], dark: [dark[0], dark[1], dark[2], alpha] };
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
  "none": ${lines(fixture.none)},
  "flash": {"ramp":${JSON.stringify(fixture.flash.ramp)},"duration_ms":${fixture.flash.duration_ms},"cases":${lines(fixture.flash.cases)}}
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
  console.log(`wrote ${file}: ${fixture.colors.length} colors, ${fixture.bars.length} bars, ${fixture.flash.cases.length} flashes`);
}
