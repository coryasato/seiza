// Writes `fixtures/paint.json`'s expectations from the browser, so the
// table's paint is checked against what a DOM contender would draw, not
// against itself: each color case's color is Chromium's
// `color-mix(in oklab, …)` of the ramp's two neighboring stops, filled into
// a 2D canvas and read back as 8-bit RGBA; each bar's left edge and width
// are the formula in `fixtures/README.md`, and its color `below`'s left of
// its zero; each text-over-a-fill case's token is the one whose Oklab
// lightness is farther from the fill's, the fill drawn over the row's
// background (and on the jumped-to row, its tint over the fill) in a canvas
// and read back; each flash case's place in its
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
interface BarCase { zero: number; value: number; below?: boolean; why?: string; expect?: { left: number; width: number; in: 'color' | 'below' } | null }
type TextToken = 'foreground' | 'background';
interface TextOverCase { ramp: string; value: number; row: 'even' | 'odd' | 'marked'; why?: string; expect?: { light: TextToken; dark: TextToken } }
/** A flash case's value: a float, NaN, NULL, or text. */
type FlashValue = number | 'NaN' | null | { text: string };
interface FlashCase { old: FlashValue; new: FlashValue; elapsed_ms: number; why?: string; expect?: { at: number; opacity: number; light: Rgba; dark: Rgba } | null }
interface Fixture {
  about: string;
  cell: { width: number; row_height: number; padding: number; bar_inset: number };
  tolerance: { channel_steps: number; bar_px: number };
  ramps: Record<string, { stops: string[]; light: string[]; dark: string[] }>;
  tokens: { stops: string[]; light: string[]; dark: string[] };
  bar: { color: string; below: string };
  colors: ColorCase[];
  bars: BarCase[];
  text_over: TextOverCase[];
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

/** A pinned token's `#rrggbbaa` in a mode. */
function token(name: string, mode: 'light' | 'dark'): string {
  const index = fixture.tokens.stops.indexOf(name);
  if (index < 0) throw new Error(`paint.json's tokens have no ${name}`);
  return fixture.tokens[mode][index]!;
}

/** Oklab lightness of an 8-bit sRGB color (Björn Ottosson's, as CSS Color 4). */
function lightness([r, g, b]: number[]): number {
  const linear = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const [lr, lg, lb] = [linear(r!), linear(g!), linear(b!)];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
}

const hexRgba = (hex: string) => [1, 3, 5, 7].map((i) => parseInt(hex.slice(i, i + 2), 16));

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
  const css = ({ from, to, t }: { from: string; to: string; t: number }) => `color-mix(in oklab, ${from} ${((1 - t) * 100).toFixed(6)}%, ${to})`;
  // Text over a fill: the row's background (the table's, an odd row's
  // stripe or the jumped-to row's tint over it), the fill over that, and
  // on the jumped-to row its tint over the fill.
  const modes = ['light', 'dark'] as const;
  const overLayers = fixture.text_over.flatMap((c) =>
    modes.map((mode, m) => {
      const under = { even: [], odd: [token('table_even', mode)], marked: [token('table_active', mode)] }[c.row];
      const over = c.row === 'marked' ? [token('table_active', mode)] : [];
      return [token('table', mode), ...under, css(mix(c.ramp, c.value)[m]!), ...over];
    }),
  );
  // Each read is a list of colors filled in turn: a color case's and a
  // flash's are one mix.
  const layers = [
    ...fixture.colors.flatMap((c) => mix(c.ramp, c.value).map((m) => [css(m)])),
    ...flashes.flatMap((flash) => (flash ? mix(fixture.flash.ramp, flash.at).map((m) => [css(m)]) : [])),
    ...overLayers,
  ];
  const read = await page.evaluate((layers) => {
    const canvas = new OffscreenCanvas(1, 1);
    const context = canvas.getContext('2d', { willReadFrequently: true })!;
    return layers.map((colors) => {
      context.clearRect(0, 0, 1, 1);
      for (const color of colors) {
        // A sentinel no opaque mix reads back as: an invalid color leaves it.
        context.fillStyle = 'rgba(1, 2, 3, 0.5)';
        const sentinel = context.fillStyle;
        context.fillStyle = color;
        if (context.fillStyle === sentinel) throw new Error(`the canvas didn't take ${color}`);
        context.fillRect(0, 0, 1, 1);
      }
      return Array.from(context.getImageData(0, 0, 1, 1).data);
    });
  }, layers);
  fixture.colors.forEach((c, index) => {
    c.expect = { light: read[index * 2] as Rgba, dark: read[index * 2 + 1] as Rgba };
  });
  const composited = read.slice(read.length - overLayers.length);
  fixture.text_over.forEach((c, index) => {
    const pick = (m: number): TextToken => {
      const mode = modes[m]!;
      const fill = lightness(composited[index * 2 + m]!);
      const [fg, bg] = [lightness(hexRgba(token('foreground', mode))), lightness(hexRgba(token('background', mode)))];
      const [toFg, toBg] = [Math.abs(fg - fill), Math.abs(bg - fill)];
      // Near a tie, rounding could pick either: the case proves nothing.
      if (Math.abs(toFg - toBg) < 0.02) throw new Error(`text over ${c.ramp} at ${c.value} (${mode}) is a near tie: pick another case`);
      return toFg >= toBg ? 'foreground' : 'background';
    };
    c.expect = { light: pick(0), dark: pick(1) };
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
  const drawnIn = bar.below && end < zero ? 'below' : 'color';
  bar.expect = barWidth > 0 ? { left: round(padding + Math.min(zero, end) * inner), width: round(barWidth), in: drawnIn } : null;
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
  "tokens": ${JSON.stringify(fixture.tokens)},
  "bar": ${JSON.stringify(fixture.bar)},
  "colors": ${lines(fixture.colors)},
  "bars": ${lines(fixture.bars)},
  "text_over": ${lines(fixture.text_over)},
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
  console.log(`wrote ${file}: ${fixture.colors.length} colors, ${fixture.bars.length} bars, ${fixture.text_over.length} texts over fills, ${fixture.flash.cases.length} flashes`);
}
