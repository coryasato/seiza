/**
 * A number column's format (the table's `format`: `components/tall-table/`
 * `src/format.rs`'s `number` module, decision for decision): fixed
 * decimals, a sign, grouping, a suffix, and the fit that falls back to the
 * automatic format (`format.ts`'s `shownText`) when the text doesn't fit
 * its cell. The cell fixture's `format` section (`fixtures/cells.json`)
 * pins it, with its controls.
 *
 * A text's width is its characters' advances summed (`Advances`), as the
 * table measures it, not the browser's shaping, so both sides fall back at
 * the same width. Summed in f32, as the table sums them, so a width a
 * hair from the room decides the same way.
 *
 * Market watch's level alone imports it: no other level's bundle carries it.
 */

import { exactDecimal, exactText, fixed } from './format.ts';

/** Which values show a sign, by the raw value (a tiny rise is `+0.00`);
 *  an exact zero (`-0.0` too) never has one. */
export type Sign = 'negative' | 'always';

export interface NumberFormat {
  /** A float at fixed decimals, trailing zeros kept, rounded half to even
   *  from its exact binary value; `null` for its exact text. Floats only. */
  decimals: number | null;
  sign: Sign;
  /** A `,` every three whole digits (an exponent's form keeps its own). */
  grouping: boolean;
  /** Text after the number (`%`): nothing is scaled. */
  suffix: string;
}

/** The format's negative controls (`cells.json`'s `format`), each a way to
 *  get it wrong that the fixture must catch; `null` in the contender. */
export type FormatControl = 'plus-on-zero' | 'sign-from-text' | 'ties-up' | 'group-by-four' | 'fit-by-count' | 'page-ignored' | null;

/** The characters a format writes, in `Advances`' order (a suffix's are measured apart). */
export const FORMAT_CHARS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '+', '-', '.', ',', 'e'] as const;

/** Each of `FORMAT_CHARS`' advance at the cells' font and size, px. */
export class Advances {
  private readonly chars: Map<string, number>;
  /** The widest, for a character a format never writes. */
  private readonly widest: number;
  /** The narrowest digit's: a whole part's least width. */
  readonly digit: number;
  /** A digit's (`0`'s). */
  readonly zero: number;

  /** `of(ch)`, each of `FORMAT_CHARS`' advance, kept as an f32. */
  constructor(of: (ch: string) => number) {
    this.chars = new Map(FORMAT_CHARS.map((ch) => [ch, Math.fround(of(ch))]));
    const all = [...this.chars.values()];
    this.widest = all.reduce((a, b) => Math.max(a, b), 0);
    this.digit = all.slice(0, 10).reduce((a, b) => Math.min(a, b), Infinity);
    this.zero = this.chars.get('0')!;
  }

  /** `text`'s width: its characters' advances summed, in f32. */
  width(text: string): number {
    let sum = 0;
    for (const ch of text) sum = Math.fround(sum + (this.chars.get(ch) ?? this.widest));
    return sum;
  }
}

/** A value as the format reads it: a float (`float32` an f32's), or an
 *  integer's or decimal's text as the source writes it; `null` for NULL. */
export type NumberValue = { kind: 'float'; value: number } | { kind: 'float32'; value: number } | { kind: 'text'; value: string } | null;

/** A laid-out column's format, its suffix measured. */
export class ColumnFormat {
  readonly format: NumberFormat;
  /** A float column's (its values' decimals and sign), else an integer's
   *  or decimal's (its text's sign and grouping). */
  readonly float: boolean;
  /** The suffix's width, px. */
  readonly suffixPx: number;
  readonly control: FormatControl;

  constructor(format: NumberFormat, float: boolean, suffixPx: number, control: FormatControl = null) {
    this.format = format;
    this.float = float;
    this.suffixPx = Math.fround(suffixPx);
    this.control = control;
  }

  /** `value`'s text and its width, or null for a value the format doesn't
   *  touch (NULL, NaN, an infinity, a value of another kind than its
   *  column's, a text that isn't a plain number). `decimals` is a page's
   *  own count for the cell. */
  measure(advances: Advances, value: NumberValue, decimals: number | null): [string, number] | null {
    const number = this.number(value, decimals);
    if (number === null) return null;
    const digits = this.control === 'fit-by-count' ? Math.fround([...number].length * advances.zero) : advances.width(number);
    return [number + this.format.suffix, Math.fround(digits + this.suffixPx)];
  }

  /** The text if it takes at most `room` (the content box less a pixel),
   *  else null: the automatic format. A float at fixed decimals whose whole
   *  digits alone can't fit isn't written out. */
  fit(advances: Advances, room: number, value: NumberValue, decimals: number | null): string | null {
    const magnitude = value && value.kind !== 'text' ? Math.abs(value.value) : 0;
    const fixedDecimals = (decimals ?? this.format.decimals) !== null;
    if (fixedDecimals && magnitude >= 1e15 && Number.isFinite(magnitude)) {
      const whole = Math.floor(Math.log10(magnitude)) + 1;
      if (whole * advances.digit > Math.fround(room)) return null;
    }
    const measured = this.measure(advances, value, decimals);
    if (!measured) return null;
    return measured[1] <= Math.fround(room) ? measured[0] : null;
  }

  /** Whether `text`, a fitted text of `value`'s, reads back (its sign,
   *  grouping, and suffix taken off) as another value in its own width:
   *  the format rounded it, so its tooltip opens. A text value's never is. */
  rounded(text: string, value: NumberValue): boolean {
    if (!value || value.kind === 'text') return false;
    const number = (text.endsWith(this.format.suffix) ? text.slice(0, text.length - this.format.suffix.length) : text).replace(/[,+]/g, '');
    if (!/^-?\d+(\.\d+)?(e-?\d+)?$/.test(number)) return true;
    const read = Number(number);
    return (value.kind === 'float32' ? Math.fround(read) : read) !== value.value;
  }

  /** The number, signed and grouped, without the suffix. */
  private number(value: NumberValue, pageDecimals: number | null): string | null {
    if (!value) return null;
    const decimals = this.control === 'page-ignored' ? null : pageDecimals;
    let negative: boolean;
    let zero: boolean;
    let digits: string;
    if (value.kind === 'text') {
      if (this.float) return null;
      const minus = value.value.startsWith('-');
      digits = minus ? value.value.slice(1) : value.value;
      if (!/^\d+(\.\d+)?$/.test(digits)) return null;
      negative = minus;
      zero = /^[0.]+$/.test(digits);
    } else {
      if (!this.float || !Number.isFinite(value.value)) return null;
      const at = decimals ?? this.format.decimals;
      // A float32's own shortest text, not the widened value's.
      digits = at === null && value.kind === 'float32' ? f32Text(Math.abs(value.value)) : this.floatDigits(value.value, at);
      negative = value.value < 0;
      zero = value.value === 0;
    }
    if (this.format.grouping && !digits.includes('e')) {
      const point = digits.indexOf('.');
      const whole = point < 0 ? digits : digits.slice(0, point);
      digits = grouped(whole, this.control === 'group-by-four' ? 4 : 3) + (point < 0 ? '' : digits.slice(point));
    }
    if (this.control === 'sign-from-text') zero = !/[1-9]/.test(digits);
    else if (this.control === 'plus-on-zero') zero = false;
    let sign = zero ? '' : negative ? '-' : this.format.sign === 'always' ? '+' : '';
    if (this.control === 'plus-on-zero' && value.kind !== 'text' && value.value === 0) sign = '+';
    return sign + digits;
  }

  /** A finite float's digits, unsigned: at `decimals` fixed (Rust's
   *  `{:.N}`, half to even on the exact value), or its exact text. */
  private floatDigits(value: number, decimals: number | null): string {
    const magnitude = Math.abs(value);
    if (decimals === null) return exactText(magnitude);
    // `toFixed` rounds an exact tie up: the control.
    if (this.control === 'ties-up') return magnitude.toFixed(decimals);
    return fixed(magnitude, exactDecimal(magnitude), decimals);
  }
}

/** `digits` (whole) with a `,` every `every` from the right (`push_grouped`). */
function grouped(digits: string, every: number): string {
  let out = '';
  for (let index = 0; index < digits.length; index++) {
    if (index > 0 && (digits.length - index) % every === 0) out += ',';
    out += digits[index];
  }
  return out;
}

/** A finite f32's shortest text, as Rust's `{:?}` writes it: the fewest
 *  digits that read back as the same f32, laid out as an f64's. */
export function f32Text(value: number): string {
  for (let precision = 1; precision <= 9; precision++) {
    const shortest = Number(value.toPrecision(precision));
    if (Math.fround(shortest) === value) return exactText(shortest);
  }
  return exactText(value);
}
