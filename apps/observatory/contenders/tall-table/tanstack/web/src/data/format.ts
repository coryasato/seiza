/**
 * A cell's text, as the tall table writes it (`components/tall-table/`:
 * `src/format.rs`'s `fit_float`, `src/state.rs`'s `cell_text` and
 * `shown_text`, and `seiza-duckdb`'s `Value` display). The cell fixture
 * (`fixtures/cells.json`) pins it.
 *
 * Two things JS's own number formatting gets wrong for it: the exact text is
 * Rust's `{:?}` (`8.0` where JS writes `8`, `1e21` where JS writes `1e+21`,
 * an exponent below 1e-4), and Rust rounds a tie to even (`123456789.125` to
 * 2 decimals is `…12`) where `toFixed` rounds it up. So rounding here works
 * on the double's exact decimal value, in `BigInt`s.
 */

/** A float's exact text: its shortest round-trip digits, laid out as Rust's
 *  `Debug` does (decimal with at least one fraction digit from 1e-4 up to
 *  1e16, scientific outside; `NaN`, `inf`, `-inf`). The tooltip's text. */
export function exactText(value: number): string {
  if (Number.isNaN(value)) return 'NaN';
  if (!Number.isFinite(value)) return value > 0 ? 'inf' : '-inf';
  const sign = isNegative(value) ? '-' : '';
  if (value === 0) return `${sign}0.0`;
  const abs = Math.abs(value);
  const { digits, exponent } = upperTie(abs, shortestDigits(abs));
  if (abs < 1e-4 || abs >= 1e16) {
    const rest = digits.slice(1);
    return `${sign}${digits[0]}${rest ? `.${rest}` : ''}e${exponent}`;
  }
  if (exponent < 0) return `${sign}0.${'0'.repeat(-exponent - 1)}${digits}`;
  const whole = digits.slice(0, exponent + 1).padEnd(exponent + 1, '0');
  return `${sign}${whole}.${digits.slice(exponent + 1) || '0'}`;
}

/**
 * A float as shown in at most `budget` characters (`fit_float`): `exact`
 * as it is if it fits; else rounded to the decimals that fit, plain while
 * its whole part fits and it keeps a few digits, scientific otherwise. If
 * even the shortest scientific text doesn't fit, it's returned anyway, and
 * the cell cuts it.
 */
export function fitFloat(value: number, exact: string, budget: number): string {
  if (exact.length <= budget || !Number.isFinite(value)) return exact;
  // Its exact value, once: every rounding below starts from it.
  const decimal = exactDecimal(Math.abs(value));
  const fitted = plain(value, decimal, budget);
  if (fitted === null) return scientific(value, decimal, budget);
  const [text, digits] = fitted;
  // Plain reads more easily, so it wins while it keeps a few digits.
  if (digits >= MIN_SIGNIFICANT) return text;
  // Or while it says the same as scientific (`0.0005`, not `5e-4`).
  const sci = scientific(value, decimal, budget);
  return Number(text) === Number(sci) ? text : sci;
}

/** A column's kind, as the cells format it (`ColumnInfo::tall_table_column`
 *  for the DuckDB types the data file holds). */
export type CellKind = 'float' | 'integer' | 'boolean' | 'date' | 'text';

/** A loaded cell's value as Arrow gives it: a DOUBLE is a `number`, a BIGINT
 *  a `bigint`, a DATE its epoch milliseconds, NULL `null`. */
export type CellValue = number | bigint | boolean | string | null;

/** What a loaded cell shows (`shown_text`): `NULL`, a float fitted to
 *  `budget`, text on one line (line breaks as `¶`), anything else as
 *  `seiza-duckdb` writes it. */
export function shownText(kind: CellKind, value: CellValue, budget: number): string {
  if (value === null) return 'NULL';
  if (kind === 'float' && typeof value === 'number') return fitFloat(value, exactText(value), budget);
  if (kind === 'date' && typeof value === 'number') return dateText(value);
  if (typeof value === 'string') return value.replaceAll('\r\n', '¶').replace(/[\n\r]/g, '¶');
  return String(value);
}

/** Plain text keeping fewer significant digits than this goes scientific,
 *  if that keeps more: `0.0000012` in 9 characters is `1.2346e-6`. */
const MIN_SIGNIFICANT = 3;

/** `value` rounded to the decimals that fit in `budget` characters, with
 *  the significant digits it kept, or null when its whole part doesn't fit
 *  or it rounds to zero. */
function plain(value: number, decimal: ExactDecimal, budget: number): [string, number] | null {
  const sign = isNegative(value) ? 1 : 0;
  const magnitude = Math.abs(value);
  // Digits left of the point; a value under 1 shows one, `0`.
  const whole = magnitude < 1 ? 1 : Math.floor(Math.log10(magnitude)) + 1;
  let decimals = Math.max(0, budget - (sign + whole + 1));
  for (;;) {
    const rounded = fixed(value, decimal, decimals);
    const shown = trimZeros(rounded);
    // Rounding can carry into another digit (`999.96` → `1000.0`).
    if (shown.length <= budget) {
      // A value that rounds to zero (`0.000`) shows nothing of itself.
      return /[1-9]/.test(rounded) ? [shown, significant(rounded)] : null;
    }
    if (decimals === 0) return null;
    decimals -= 1;
  }
}

/** `value` in scientific notation with as many mantissa digits as fit. */
function scientific(value: number, decimal: ExactDecimal, budget: number): string {
  // Start from what the exponent leaves room for (a double has at most 17
  // significant digits); rounding can lengthen the exponent (`9.99e9` →
  // `1e10`), so step down from there. Rust writes the floor as a float's
  // Display: `-inf` for zero.
  const sign = isNegative(value) ? 1 : 0;
  const floor = Math.floor(Math.log10(Math.abs(value)));
  const exponent = `e${Number.isFinite(floor) ? floor : '-inf'}`;
  let digits = Math.min(16, Math.max(0, budget - (sign + 2 + exponent.length)));
  for (;;) {
    const shown = trimMantissa(exponential(value, decimal, digits));
    if (shown.length <= budget || digits === 0) return shown;
    digits -= 1;
  }
}

/** Significant digits in plain text: the digits after the leading zeros,
 *  trailing zeros included (`2.0000` kept 5). */
function significant(text: string): number {
  return text.replace(/\D/g, '').replace(/^0+/, '').length;
}

/** `45.1200` → `45.12`, `45.000` → `45`. */
function trimZeros(text: string): string {
  return text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text;
}

/** `1.2300e12` → `1.23e12`. */
function trimMantissa(text: string): string {
  const at = text.indexOf('e');
  return at < 0 ? text : `${trimZeros(text.slice(0, at))}${text.slice(at)}`;
}

/** Negative, `-0` included: Rust writes its sign. */
const isNegative = (value: number): boolean => value < 0 || Object.is(value, -0);

/** The shortest round-trip digits of a finite `abs > 0` (JS's `String`
 *  picks the same ones Rust does: the shortest, and the closest of those)
 *  and the decimal exponent of the first. */
function shortestDigits(abs: number): { digits: string; exponent: number } {
  const [mantissa = '', power = '0'] = String(abs).split('e');
  const [whole = '', fraction = ''] = mantissa.split('.');
  const all = whole + fraction;
  const zeros = all.length - all.replace(/^0+/, '').length;
  return { digits: all.slice(zeros).replace(/0+$/, ''), exponent: whole.length - 1 - zeros + Number(power) };
}

/** Rust's pick where two shortest candidates are equally near `abs`: the
 *  upper one. JS's `String` picks the even one (`1658206780088562.25` is
 *  `…562.2` in JS, `…562.3` in Rust), so an even last digit whose
 *  successor reads back as the same double, from exactly as far, steps up.
 *  An even digit plus one never carries. */
function upperTie(abs: number, shortest: { digits: string; exponent: number }): { digits: string; exponent: number } {
  const { digits, exponent } = shortest;
  if ((digits.charCodeAt(digits.length - 1) - 48) % 2 !== 0) return shortest;
  const place = exponent - (digits.length - 1);
  const up = (BigInt(digits) + 1n).toString();
  if (Number(`${up}e${place}`) !== abs) return shortest;
  const exact = exactDecimal(abs);
  // No shortest candidate has more decimals than the exact value.
  if (exact.scale + place < 0) return shortest;
  const unit = 10n ** BigInt(exact.scale + place);
  return 2n * exact.digits === (2n * BigInt(digits) + 1n) * unit ? { digits: up, exponent } : shortest;
}

/** `value` (`decimal`, its exact magnitude) with `decimals` fraction
 *  digits, ties to even (Rust's `{:.N}`). */
function fixed(value: number, { digits, scale }: ExactDecimal, decimals: number): string {
  const kept = decimals >= scale ? digits * 10n ** BigInt(decimals - scale) : roundHalfEven(digits, scale - decimals);
  const text = kept.toString().padStart(decimals + 1, '0');
  const cut = text.length - decimals;
  return `${isNegative(value) ? '-' : ''}${text.slice(0, cut)}${decimals ? `.${text.slice(cut)}` : ''}`;
}

/** `value` (`decimal`, its exact magnitude) in scientific notation with
 *  `decimals` mantissa fraction digits, ties to even (Rust's `{:.Ne}`: `1.50e3`, `2e-7`, `0e0`). */
function exponential(value: number, { digits, scale }: ExactDecimal, decimals: number): string {
  const sign = isNegative(value) ? '-' : '';
  if (digits === 0n) return `${sign}0${decimals ? `.${'0'.repeat(decimals)}` : ''}e0`;
  const length = digits.toString().length;
  let exponent = length - 1 - scale;
  const drop = length - (decimals + 1);
  let kept = drop > 0 ? roundHalfEven(digits, drop) : digits * 10n ** BigInt(-drop);
  // A carry (`9.96` → `10.0`) adds a digit: one more in the exponent.
  if (kept.toString().length > decimals + 1) {
    kept /= 10n;
    exponent += 1;
  }
  const text = kept.toString();
  return `${sign}${text[0]}${decimals ? `.${text.slice(1)}` : ''}e${exponent}`;
}

/** A finite double's magnitude exactly: `digits / 10^scale`. */
interface ExactDecimal {
  digits: bigint;
  scale: number;
}

/** A finite `abs ≥ 0` exactly. */
function exactDecimal(abs: number): ExactDecimal {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, abs);
  const bits = view.getBigUint64(0);
  const biased = Number((bits >> 52n) & 0x7ffn);
  const fraction = bits & ((1n << 52n) - 1n);
  // value = mantissa × 2^power; a negative power is mantissa × 5^−power / 10^−power.
  const mantissa = biased === 0 ? fraction : fraction | (1n << 52n);
  const power = biased === 0 ? -1074 : biased - 1075;
  return power >= 0 ? { digits: mantissa << BigInt(power), scale: 0 } : { digits: mantissa * 5n ** BigInt(-power), scale: -power };
}

/** `digits / 10^drop`, rounded to the nearest whole number, ties to even. */
function roundHalfEven(digits: bigint, drop: number): bigint {
  const divisor = 10n ** BigInt(drop);
  const quotient = digits / divisor;
  const twice = (digits % divisor) * 2n;
  if (twice > divisor || (twice === divisor && quotient % 2n === 1n)) return quotient + 1n;
  return quotient;
}

/** A DATE (epoch ms from Arrow) as `YYYY-MM-DD`, the year to 4 digits
 *  (`seiza-duckdb`'s `write_date`: proleptic Gregorian, `civil_from_days`). */
function dateText(epochMs: number): string {
  const days = Math.floor(epochMs / 86_400_000);
  // Howard Hinnant's civil_from_days, as the Rust side computes it.
  const z = days + 719_468;
  const era = Math.floor(z / 146_097);
  const doe = z - era * 146_097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36_524) - Math.floor(doe / 146_096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  const year = yoe + era * 400 + (month <= 2 ? 1 : 0);
  const pad = (n: number, width: number) => (n < 0 ? `-${String(-n).padStart(width, '0')}` : String(n).padStart(width, '0'));
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}
