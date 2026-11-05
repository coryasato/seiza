/**
 * The wide level's fixtures (`components/tall-table/fixtures/`; its README
 * says what each holds), run against the TanStack contender's own code, as
 * the component's native tests run them against the table, each with its
 * negative controls, which must fail it:
 *
 * - `paint.json` (`custom-cells`): the CSS each paint draws (`rampCss`'s
 *   `color-mix`, evaluated here as CSS Color 4 defines it, over the
 *   fixture's resolved stops, which `theme.css` must hold), the bars'
 *   boxes, and the text color over a fill (`FramePaint`); and `flash`
 *   (`live` too, market watch's level): a change's place in the ramp and
 *   its fade (`flash.ts`), found as the re-read lands through the paging
 *   (`live.ts`), and the color it draws.
 * - `pin.json` (`pin`): the run in effect, its edge, the scroll's range,
 *   each drawn column's screen left, the hit tests, and the least move into
 *   view (`pin.ts`).
 * - `density.json` (`density`): the lengths in effect and the columns laid
 *   out at them (`density.ts`, `layout.ts`), and the number advance the
 *   contender assumes against the one pinned from the bare host.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { barInset, resolveSizes, type DensityControl } from '../src/density.ts';
import { gutterWidth, layOutAll, padOf, type ColumnSpec, type Sizes } from '../src/layout.ts';
import { FramePaint, barSpan, barToken, fromOklab, oklab, parseHex, rampAt, rampCss, resolveRamp, type PaintControl, type Rgba } from '../src/paint.ts';
import { Pin, inEffect, type PinControl } from '../src/pin.ts';
import { Flashes, change, noteFlashes, type FlashControl } from '../src/data/flash.ts';
import type { CellValue } from '../src/data/format.ts';
import { invalidateRows, trackChanges } from '../src/data/live.ts';
import { PAGING, TablePaging, type Clock, type PageSource } from '../src/data/paging.ts';
import { asLevel } from './level.ts';

const fixtures = new URL('../../../../../../../components/tall-table/fixtures/', import.meta.url);
const fixture = (name: string): any => JSON.parse(readFileSync(new URL(name, fixtures), 'utf8'));

// --- paint ---

type Theme = 'light' | 'dark';
const THEMES: Theme[] = ['light', 'dark'];
/** The fixture's token names (gpui-kit's fields) as `theme.css`'s variables. */
const variable = (token: string): string => token.replaceAll('_', '-');
const rgba8 = (color: Rgba): number[] => [color.r, color.g, color.b, color.a].map((channel) => Math.round(channel * 255));

/** Every token the fixture resolves, by theme: its ramps' stops and its tokens. */
function fixtureTheme(paint: any, theme: Theme): Map<string, Rgba> {
  const colors = new Map<string, Rgba>();
  for (const ramp of Object.values(paint.ramps) as any[]) ramp.stops.forEach((stop: string, index: number) => colors.set(variable(stop), parseHex(ramp[theme][index])));
  paint.tokens.stops.forEach((stop: string, index: number) => colors.set(variable(stop), parseHex(paint.tokens[theme][index])));
  return colors;
}

/** `theme.css`'s variables, light (`:root`) and dark (`:root[data-theme="dark"]`). */
function themeCss(): Record<Theme, Map<string, string>> {
  const css = readFileSync(new URL('../src/theme.css', import.meta.url), 'utf8');
  const block = (selector: string) => {
    const at = css.indexOf(`${selector} {`);
    assert.ok(at >= 0, `theme.css has no ${selector}`);
    const body = css.slice(at, css.indexOf('}', at));
    return new Map([...body.matchAll(/--([\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [name!, value!.trim()]));
  };
  return { light: block(':root'), dark: block(':root[data-theme="dark"]') };
}

/**
 * A `color-mix(in <space>, var(--a) p%, var(--b))` as CSS Color 4 mixes it
 * (premultiplied, the second color at the rest), the variables from
 * `theme`: what the browser draws for `rampCss`'s text.
 */
function evaluateMix(css: string, theme: Map<string, Rgba>): Rgba {
  const match = /^color-mix\(in (oklab|srgb), var\(--([\w-]+)\) ([\d.]+)%, var\(--([\w-]+)\)\)$/.exec(css);
  assert.ok(match, `not a two-color mix: ${css}`);
  const [, space, first, percent, second] = match;
  const [a, b] = [theme.get(first!), theme.get(second!)];
  assert.ok(a && b, `no color for ${first} or ${second}`);
  const p = Number(percent) / 100;
  if (space === 'oklab') {
    const [x, y] = [oklab(a), oklab(b)];
    return fromOklab({ l: x.l * p + y.l * (1 - p), a: x.a * p + y.a * (1 - p), b: x.b * p + y.b * (1 - p), alpha: x.alpha * p + y.alpha * (1 - p) });
  }
  const alpha = a.a * p + b.a * (1 - p);
  const channel = (from: number, to: number) => (alpha === 0 ? 0 : (from * a.a * p + to * b.a * (1 - p)) / alpha);
  return { r: channel(a.r, b.r), g: channel(a.g, b.g), b: channel(a.b, b.b), a: alpha };
}

interface PaintSkew {
  control: PaintControl;
  /** Steps every expected color is moved by, or px every bar is. */
  colorSteps?: number;
  barPx?: number;
}

/** The paint fixture's cases the contender's paint doesn't draw as pinned. */
function paintMismatches({ control, colorSteps = 0, barPx = 0 }: PaintSkew): string[] {
  const paint = fixture('paint.json');
  const mismatches: string[] = [];
  const steps = paint.tolerance.channel_steps;
  for (const theme of THEMES) {
    const colors = fixtureTheme(paint, theme);
    const resolve = (token: string) => {
      const color = colors.get(token);
      assert.ok(color, `no ${token} in the fixture`);
      return color;
    };
    for (const [index, item] of (paint.colors as any[]).entries()) {
      const css = rampCss(paint.ramps[item.ramp].stops.map(variable), item.value, control);
      assert.ok(css, `case ${index}: no color`);
      const drawn = rgba8(evaluateMix(css, colors));
      const expected = (item.expect[theme] as number[]).map((channel) => channel + colorSteps);
      if (drawn.some((channel, at) => Math.abs(channel - expected[at]!) > steps))
        mismatches.push(`colors ${index} (${item.ramp} ${item.as} ${item.value}, ${theme}): ${drawn}, the fixture's ${expected}`);
    }
    const frame = new FramePaint(resolve, control);
    for (const [index, item] of (paint.text_over as any[]).entries()) {
      const fill = rampAt(resolveRamp(paint.ramps[item.ramp].stops.map(variable), resolve), item.value)!;
      const token = frame.textOver(fill, item.row);
      if (token !== item.expect[theme]) mismatches.push(`text_over ${index} (${item.ramp} ${item.value} ${item.row}, ${theme}): ${token}, the fixture's ${item.expect[theme]}`);
    }
  }
  const { width, padding } = paint.cell;
  const inner = width - 2 * padding;
  for (const [index, item] of (paint.bars as any[]).entries()) {
    const span = barSpan(item.zero, item.value, inner, padding);
    const drawn = span && { left: span.left + barPx, width: span.width, in: barToken({ color: 'color', ...(item.below ? { below: 'below' } : {}) }, span.below, control) };
    const near = (a: number, b: number) => Math.abs(a - b) <= paint.tolerance.bar_px;
    const same = drawn === null || item.expect === null ? drawn === item.expect : near(drawn.left, item.expect.left) && near(drawn.width, item.expect.width) && drawn.in === item.expect.in;
    if (!same) mismatches.push(`bars ${index}: ${JSON.stringify(drawn)}, the fixture's ${JSON.stringify(item.expect)}`);
  }
  for (const item of paint.none) {
    const drawn = item.paint === 'fill' ? rampCss(['background', 'chart-1'], Number.NaN) : barSpan(0, Number.NaN, inner, padding);
    if (drawn !== null) mismatches.push(`none ${item.paint}: drew ${JSON.stringify(drawn)}`);
  }
  return mismatches;
}

describe('paint.json', () => {
  test('every case', () => {
    assert.deepEqual(paintMismatches({ control: null }), []);
  });

  test("its cell's lengths are the base's", () => {
    const { cell } = fixture('paint.json');
    const base = resolveSizes({ rowHeight: cell.row_height, text: { rems: 0.875 } });
    assert.deepEqual([padOf(base), barInset(base)], [cell.padding, cell.bar_inset]);
  });

  test("theme.css holds the tokens the contender draws with", () => {
    const paint = fixture('paint.json');
    const css = themeCss();
    // The rows' tokens and the text over a fill; the fixture's ramps'
    // stops aren't the contender's (its heat is the scenario's,
    // `scenarios.ts`).
    const drawn = ['background', 'foreground', 'table', 'table-even', 'table-active'];
    for (const theme of THEMES) {
      const colors = fixtureTheme(paint, theme);
      for (const token of drawn) {
        const value = css[theme].get(token);
        assert.ok(value, `theme.css has no --${token} (${theme})`);
        assert.deepEqual(rgba8(parseHex(value)), rgba8(colors.get(token)!), `--${token} (${theme})`);
      }
    }
  });

  test('controls fail', () => {
    for (const skew of [
      { control: 'srgb' },
      { control: 'below-ignored' },
      { control: 'nearer-token' },
      { control: 'composite-ignored' },
      { control: null, colorSteps: 2 },
      { control: null, barPx: 1 },
    ] satisfies PaintSkew[])
      assert.notDeepEqual(paintMismatches(skew), [], `${JSON.stringify(skew)} passed the paint fixture`);
  });

  // A change's flash: market watch's level (`live` and `custom-cells`).
  test('flash', async () => {
    assert.deepEqual(await flashMismatches(null), []);
  });

  // Arrow gives an INTEGER and a DATE as a `number` too: neither rises or
  // falls, as the table's `Float` alone does.
  test("flash: an integer's or a date's change is any other change", () => {
    assert.equal(change(10, 11, false), 0.5);
    assert.equal(change(11, 10, false), 0.5);
    assert.equal(change(10, 10, false), null);
    assert.equal(change(10, 11, true), 1);
  });

  test('flash: controls fail', async () => {
    for (const control of ['fade-backwards', 'fall-as-rise'] satisfies FlashControl[])
      assert.notDeepEqual(await flashMismatches(control), [], `control ${control} passed the flash fixture`);
  });
});

// --- flash ---

/** A fixture value as a cell's (a number a float, `"NaN"` a float NaN,
 *  `{"text": …}` text, null NULL). */
const flashValue = (value: unknown): CellValue => (value === 'NaN' ? Number.NaN : value !== null && typeof value === 'object' ? (value as { text: string }).text : (value as number | null));

/** A page of one column, a case a row. */
class OneColumn {
  readonly byteLength = 8;
  private readonly values: CellValue[];
  constructor(values: CellValue[]) {
    this.values = values;
  }
  value(row: number, column: number): CellValue | undefined {
    return column === 0 ? this.values[row] : undefined;
  }
}

/**
 * `paint.json`'s `flash` cases the contender doesn't flash as pinned,
 * under `control`, run as the native test runs them: every case's row read
 * with its old value, then invalidated at once, the re-read landing (in
 * hand, as the market's store answers) with the new values, each drawn
 * `elapsed_ms` later; its color the ramp's CSS evaluated, its alpha the
 * opacity's.
 */
async function flashMismatches(control: FlashControl): Promise<string[]> {
  const paint = fixture('paint.json');
  const { cases, ramp, duration_ms: duration } = paint.flash;
  return asLevel('market', async () => {
    let values: CellValue[] = cases.map((item: any) => flashValue(item.old));
    let next = 0;
    const source: PageSource<OneColumn> = {
      load: () => {
        const page = new OneColumn(values);
        return { request: next++, result: Promise.resolve(page), ready: page };
      },
      cancel: () => {},
    };
    const clock: Clock = { setTimeout: () => 0, clearTimeout: () => {} };
    const table = new TablePaging(cases.length, source, PAGING, clock);
    const flashes = new Flashes(control);
    const now = 1000;
    trackChanges(table, true);
    table.onLanded = (page, old, landed, rows) => noteFlashes(flashes, [{ index: 0, duration, float: true }], page * PAGING.pageRows, old, landed, rows.rows(), now);
    table.setViewportRows(cases.length);
    await new Promise((resolve) => setImmediate(resolve));
    values = cases.map((item: any) => flashValue(item.new));
    invalidateRows(table, [0, cases.length]);
    // The invalidation's plan runs at the end of its task; the re-read lands in it.
    await Promise.resolve();
    assert.equal(next, 2, 'the page read, then read again');

    const mismatches: string[] = [];
    const steps = paint.tolerance.channel_steps;
    const stops = (paint.ramps[ramp].stops as string[]).map(variable);
    for (const [row, item] of (cases as any[]).entries()) {
      const flash = flashes.at(row, 0, now + item.elapsed_ms);
      const label = `${item.why ?? ''} (${JSON.stringify(item.old)} → ${JSON.stringify(item.new)} at ${item.elapsed_ms} ms)`;
      if (flash === null || item.expect === null) {
        if ((flash === null) !== (item.expect === null)) mismatches.push(`${label}: ${JSON.stringify(flash)}, the fixture's ${JSON.stringify(item.expect)}`);
        continue;
      }
      if (flash.at !== item.expect.at || Math.abs(flash.opacity - item.expect.opacity) > 1e-9) mismatches.push(`${label}: at ${flash.at} opacity ${flash.opacity}, the fixture's ${item.expect.at} ${item.expect.opacity}`);
      for (const theme of THEMES) {
        const color = evaluateMix(rampCss(stops, flash.at)!, fixtureTheme(paint, theme));
        const drawn = rgba8({ ...color, a: color.a * flash.opacity });
        const expected = item.expect[theme] as number[];
        if (drawn.some((channel, at) => Math.abs(channel - expected[at]!) > steps)) mismatches.push(`${label}, ${theme}: ${drawn}, the fixture's ${expected}`);
      }
    }
    return mismatches;
  });
}

// --- pin ---

/** The pin fixture's cases `pin.ts` doesn't compute as pinned, under `control`. */
function pinMismatches(control: PinControl): string[] {
  const mismatches: string[] = [];
  for (const item of fixture('pin.json').cases) {
    let x = 0;
    const columns = (item.widths as number[]).map((width) => {
      const placed = { x, width };
      x += width;
      return placed;
    });
    const { cells_width: cellsWidth, scroll_x: scrollX } = item;
    const pin = new Pin(columns, inEffect(columns, item.count, cellsWidth, control), cellsWidth, control);
    const maxScrollX = Math.max(0, x - cellsWidth);
    const got = {
      pinned: pin.columns,
      edge: pin.edge,
      max_scroll_x: maxScrollX,
      lefts: columns.flatMap((column, index) => (pin.visible(index, column.x, column.width, scrollX, cellsWidth) ? [[index, pin.left(index, column.x, scrollX)]] : [])),
      hits: (item.hits as number[]).map((at) => {
        const content = pin.contentX(at, scrollX);
        const hit = columns.findIndex((column) => content >= column.x && content < column.x + column.width);
        return [at, hit < 0 ? null : hit];
      }),
      into_view: (item.into_view as number[]).map((index) => {
        const column = columns[index]!;
        const moved = scrollX + pin.intoView(index, column.x, column.width, scrollX, cellsWidth);
        return [index, Math.min(Math.max(moved, 0), maxScrollX)];
      }),
    };
    for (const key of Object.keys(item.expect))
      if (JSON.stringify((got as any)[key]) !== JSON.stringify(item.expect[key])) mismatches.push(`${item.name}: ${key} ${JSON.stringify((got as any)[key])}, the fixture's ${JSON.stringify(item.expect[key])}`);
  }
  return mismatches;
}

describe('pin.json', () => {
  test('every case', () => {
    assert.deepEqual(pinMismatches(null), []);
  });

  test('controls fail', () => {
    const controls = fixture('pin.json').controls as string[];
    assert.deepEqual(controls.sort(), ['into-view-at-gutter', 'no-cap', 'pinned-scroll', 'under-run']);
    for (const control of controls) assert.notDeepEqual(pinMismatches(control as PinControl), [], `control ${control} passed the pin fixture`);
  });
});

// --- density ---

/** The density fixture's cases the contender doesn't lay out as pinned, under `control`. */
function densityMismatches(control: string | null): string[] {
  const density = fixture('density.json');
  const mismatches: string[] = [];
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-3;
  const specs: ColumnSpec[] = (density.columns as any[]).map((column) => ({ name: column.name, kind: column.kind, maxChars: column.max_chars, width: column.width }));
  const inLayout = ['padding-fixed', 'width-scaled', 'name-rounded-per-character', 'least-fixed'];
  for (const item of density.cases) {
    const resolved = resolveSizes({ rowHeight: item.row_height, text: item.text }, item.rem, (inLayout.includes(control ?? '') || control === 'inset-fixed' ? null : control) as DensityControl);
    // The fixture's advance, pinned from the bare host: the contender's own
    // is checked against it below.
    const sizes: Sizes = { ...resolved, numberPx: item.number_px, ...(inLayout.includes(control ?? '') ? { control: control as Sizes['control'] } : {}) };
    const columns = layOutAll(specs, sizes);
    const got: Record<string, unknown> = {
      text_px: sizes.text,
      row_height: sizes.row,
      header_height: sizes.row,
      viewport_rows: item.view_height / sizes.row,
      padding: padOf(sizes),
      gutter: gutterWidth(item.rows, sizes),
      bar_inset: barInset(sizes, control === 'inset-fixed' ? 'inset-fixed' : null),
    };
    for (const [key, value] of Object.entries(got))
      if (!near(value as number, item.expect[key])) mismatches.push(`${item.name}: ${key} ${value}, the fixture's ${item.expect[key]}`);
    (item.expect.columns as any[]).forEach((expected, index) => {
      const column = columns[index]!;
      if (!near(column.width, expected.width)) mismatches.push(`${item.name}: ${specs[index]!.name}'s width ${column.width}, the fixture's ${expected.width}`);
      if (expected.budget !== undefined && column.budget !== expected.budget) mismatches.push(`${item.name}: ${specs[index]!.name}'s budget ${column.budget}, the fixture's ${expected.budget}`);
    });
  }
  return mismatches;
}

describe('density.json', () => {
  test('every case', () => {
    assert.deepEqual(densityMismatches(null), []);
  });

  test("the contender's number advance is the bare host's", () => {
    for (const item of fixture('density.json').cases) {
      const { numberPx } = resolveSizes({ rowHeight: item.row_height, text: item.text }, item.rem);
      assert.ok(Math.abs(numberPx - item.number_px) < 1e-6, `${item.name}: ${numberPx}, the fixture's ${item.number_px}`);
    }
  });

  test('controls fail', () => {
    const controls = fixture('density.json').controls as string[];
    assert.equal(controls.length, 8);
    for (const control of controls) assert.notDeepEqual(densityMismatches(control), [], `control ${control} passed the density fixture`);
  });
});
