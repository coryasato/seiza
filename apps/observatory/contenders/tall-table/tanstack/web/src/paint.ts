/**
 * `custom-cells` (the wide level's): a cell's paint, as the tall table
 * draws it (`components/tall-table/src/paint.rs`), in the DOM's own terms.
 * A fill or a text ramp is CSS's `color-mix(in oklab, …)` over the theme's
 * variables (`theme.css`), so a theme switch recolors every cell with no
 * render; a bar is a box at the table's place for it. What CSS can't say,
 * the text color over a fill (the theme's `foreground` or `background`,
 * whichever Oklab lightness is farther from the fill as drawn over its row),
 * is computed here from the theme's colors, resolved again when the theme
 * changes. `paint.json` pins it (`test/fixtures.test.ts`).
 */

/** A color, each channel 0..1. */
export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** A theme token, as `theme.css` names its variable without the `--`
 *  (`background`, `chart-1`). */
export type Token = string;

/** `paint.json`'s negative controls; only the fixture test sets one. */
export type PaintControl = 'srgb' | 'below-ignored' | 'nearer-token' | 'composite-ignored' | null;

/** `#rrggbb` or `#rrggbbaa` (`theme.css`'s form). */
export function parseHex(hex: string): Rgba {
  const value = hex.trim().replace(/^#/, '');
  const byte = (at: number) => Number.parseInt(value.slice(at, at + 2), 16) / 255;
  if (!/^[\da-f]{6}([\da-f]{2})?$/i.test(value)) throw new Error(`not a theme color: ${hex}`);
  return { r: byte(0), g: byte(2), b: byte(4), a: value.length === 8 ? byte(6) : 1 };
}

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const fromLinear = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

/** A color in Oklab, its alpha premultiplied into `l`, `a`, `b` (CSS mixes
 *  premultiplied). */
export interface Oklab {
  l: number;
  a: number;
  b: number;
  alpha: number;
}

/** Björn Ottosson's sRGB → Oklab, the matrices CSS Color 4 uses. */
export function oklab(color: Rgba): Oklab {
  const [r, g, b] = [toLinear(color.r), toLinear(color.g), toLinear(color.b)];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const alpha = color.a;
  return {
    l: (0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s) * alpha,
    a: (1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s) * alpha,
    b: (0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s) * alpha,
    alpha,
  };
}

export function fromOklab(color: Oklab): Rgba {
  if (color.alpha <= 0) return { r: 0, g: 0, b: 0, a: 0 };
  const [L, A, B] = [color.l / color.alpha, color.a / color.alpha, color.b / color.alpha];
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  const channel = (c: number) => Math.min(1, Math.max(0, fromLinear(c)));
  return {
    r: channel(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: channel(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: channel(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
    a: Math.min(1, Math.max(0, color.alpha)),
  };
}

/** Its lightness, its alpha divided out. */
const lightness = (color: Oklab): number => (color.alpha <= 0 ? 0 : color.l / color.alpha);

const mixOklab = (from: Oklab, to: Oklab, t: number): Oklab => ({
  l: from.l + (to.l - from.l) * t,
  a: from.a + (to.a - from.a) * t,
  b: from.b + (to.b - from.b) * t,
  alpha: from.alpha + (to.alpha - from.alpha) * t,
});

/** `top` over `bottom`, source-over in sRGB, as the browser blends. */
export function over(top: Rgba, bottom: Rgba): Rgba {
  const alpha = top.a + bottom.a * (1 - top.a);
  if (alpha <= 0) return top;
  const channel = (t: number, b: number) => (t * top.a + b * bottom.a * (1 - top.a)) / alpha;
  return { r: channel(top.r, bottom.r), g: channel(top.g, bottom.g), b: channel(top.b, bottom.b), a: alpha };
}

/** Two or more tokens, evenly spaced over 0..1, mixed in Oklab. */
export type Ramp = readonly Token[];

/** The segment `value` (clamped to 0..1) falls in, and its place along it;
 *  null for NaN. */
function segment(stops: number, value: number): [number, number] | null {
  if (Number.isNaN(value)) return null;
  const along = Math.min(1, Math.max(0, value)) * (stops - 1);
  const index = Math.min(Math.floor(along), stops - 2);
  return [index, along - index];
}

/** The CSS color `ramp` draws at `value`: `color-mix(in oklab, stop_i
 *  (1 − t) × 100%, stop_i+1)`, or null for NaN. */
export function rampCss(ramp: Ramp, value: number, control: PaintControl = null): string | null {
  const at = segment(ramp.length, value);
  if (!at) return null;
  const [index, t] = at;
  return `color-mix(in ${control === 'srgb' ? 'srgb' : 'oklab'}, var(--${ramp[index]}) ${((1 - t) * 100).toFixed(2)}%, var(--${ramp[index + 1]}))`;
}

/** A ramp's stops resolved from the theme: the colors it mixes, in Oklab. */
export const resolveRamp = (ramp: Ramp, theme: (token: Token) => Rgba): Oklab[] => ramp.map((token) => oklab(theme(token)));

/** The resolved ramp's color at `value`, in Oklab; null for NaN. */
export function rampAt(stops: readonly Oklab[], value: number): Oklab | null {
  const at = segment(stops.length, value);
  return at ? mixOklab(stops[at[0]]!, stops[at[0] + 1]!, at[1]) : null;
}

/**
 * A column's range, for mapping its values to a paint's 0..1 (the table's
 * `Domain`): `lo` to 0, `mid` to 0.5, `hi` to 1, each side of `mid` scaled
 * on its own. The whole column's range, never one page's, or colors jump
 * at page boundaries.
 */
export class Domain {
  readonly lo: number;
  readonly mid: number;
  readonly hi: number;

  /** `lo..hi`, its middle halfway unless given (halves first: `hi − lo`
   *  overflows for a range near a double's). */
  constructor(lo: number, hi: number, mid = lo / 2 + hi / 2) {
    this.lo = lo;
    this.mid = mid;
    this.hi = hi;
  }

  /** `value`'s place, 0..1 (clamped); NaN stays NaN. */
  unit(value: number): number {
    if (Number.isNaN(value)) return Number.NaN;
    const { lo, mid, hi } = this;
    const at =
      value < mid ? (mid > lo ? (0.5 * (value - lo)) / (mid - lo) : 0)
      : value > mid ? (hi > mid ? 0.5 + (0.5 * (value - mid)) / (hi - mid) : 1)
      : 0.5;
    return Math.min(1, Math.max(0, at));
  }
}

/** A bar from a zero point to the value, both 0..1 of the cell's inner
 *  width: its left (from the cell's left, past the padding) and width, and
 *  whether it ends left of its zero; null for NaN or no width. */
export function barSpan(zero: number, end: number, inner: number, pad: number): { left: number; width: number; below: boolean } | null {
  if (Number.isNaN(zero) || Number.isNaN(end)) return null;
  const [z, e] = [Math.min(1, Math.max(0, zero)), Math.min(1, Math.max(0, end))];
  const width = Math.abs(e - z) * inner;
  return width > 0 ? { left: pad + Math.min(z, e) * inner, width, below: e < z } : null;
}

/** The token a bar is drawn in: `below` where the column has one and the
 *  bar ends left of its zero. */
export const barToken = (bar: { color: Token; below?: Token }, below: boolean, control: PaintControl = null): Token =>
  below && bar.below !== undefined && control !== 'below-ignored' ? bar.below : bar.color;

/** The kinds of row a fill sits in: even, odd (striped), and the jump's
 *  marked row (its tint under the fill and over it). */
export type RowKind = 'even' | 'odd' | 'marked';

/**
 * What every cell's paint reads beyond its column's, resolved from the
 * theme (the table's `FramePaint`): the two text colors a filled cell picks
 * from, and what each kind of row draws under a fill and over it.
 */
export class FramePaint {
  readonly theme: (token: Token) => Rgba;
  private readonly foreground: number;
  private readonly background: number;
  private readonly rows: Record<RowKind, { under: Rgba; over: Rgba | null }>;
  private readonly control: PaintControl;

  constructor(theme: (token: Token) => Rgba, control: PaintControl = null) {
    this.theme = theme;
    this.control = control;
    this.foreground = lightness(oklab(theme('foreground')));
    this.background = lightness(oklab(theme('background')));
    const table = theme('table');
    const active = theme('table-active');
    this.rows = {
      even: { under: table, over: null },
      odd: { under: over(theme('table-even'), table), over: null },
      marked: { under: over(active, table), over: active },
    };
  }

  /** The text token over `fill` (a ramp's color, in Oklab) in a `row`:
   *  whichever of `foreground` and `background` has the lightness farther
   *  from the color on screen (ties to `foreground`). */
  textOver(fill: Oklab, row: RowKind): 'foreground' | 'background' {
    const paint = this.rows[row];
    let shown = lightness(fill);
    if (this.control !== 'composite-ignored' && (paint.over || fill.alpha < 1)) {
      const drawn = over(fromOklab(fill), paint.under);
      shown = lightness(oklab(paint.over ? over(paint.over, drawn) : drawn));
    }
    const foreground = Math.abs(this.foreground - shown) >= Math.abs(this.background - shown);
    return foreground !== (this.control === 'nearer-token') ? 'foreground' : 'background';
  }
}

/** `rgb(r, g, b)` or `rgba(r, g, b, a)`, as a computed color is written. */
function parseComputed(color: string): Rgba {
  const [r = 0, g = 0, b = 0, a = 1] = (color.match(/[\d.]+/g) ?? []).map(Number);
  return { r: r / 255, g: g / 255, b: b / 255, a };
}

/** The theme's colors as the page has them now (`theme.css`'s variables on
 *  the root, light or dark by the media query or `data-theme`), each as the
 *  browser computes it: the build's minifier rewrites the variables' text
 *  (`#ffffff` as `#fff`). */
export function documentTheme(): (token: Token) => Rgba {
  const probe = document.createElement('span');
  probe.hidden = true;
  document.documentElement.append(probe);
  const colors = new Map<Token, Rgba>();
  const resolve = (token: Token): Rgba => {
    let color = colors.get(token);
    if (!color) {
      probe.style.color = `var(--${token})`;
      color = parseComputed(getComputedStyle(probe).color);
      colors.set(token, color);
    }
    return color;
  };
  // Every token the paint reads, resolved now, while the probe is in the page.
  for (const token of ['foreground', 'background', 'table', 'table-even', 'table-active', 'chart-1']) resolve(token);
  probe.remove();
  return (token) => {
    const color = colors.get(token);
    if (!color) throw new Error(`the paint reads no theme color ${token}`);
    return color;
  };
}
