/**
 * `density` (the wide level's): a row height and a text size, and the
 * lengths in effect that follow them, as the tall table resolves them
 * (`components/tall-table/src/density.rs`, `Sizes::resolve`): the text at
 * least 6 px, the row at least the text, and the scale, the text over the
 * default's in its own unit (a `px` text over 14 px, a `rems` text over
 * 0.875 rem). `density.json` pins it (`test/fixtures.test.ts`).
 */

import type { Sizes } from './layout.ts';

/** A text size, as the table takes one: px, or rems of the rem size. */
export type TextSize = { px: number } | { rems: number };

export interface Density {
  rowHeight: number;
  text: TextSize;
}

/** The base's text: 0.875 rem, 14 px at the web's 16 px rem. */
const TEXT_REMS = 0.875;
const BASE_TEXT_PX = 14;
const LEAST_TEXT_PX = 6;
/** IBM Plex Sans's digits are 600 units of 1000: the widest advance of a
 *  number's characters is 0.6 em (`density.json`'s `number_px`). */
const NUMBER_EM = 0.6;

/** The fixture's negative controls (`density.json`'s `controls`): ways to
 *  get the lengths wrong that it must catch. Never set outside the tests. */
export type DensityControl = 'row-unclamped' | 'scale-over-default-at-rem' | 'scale-over-14-for-rems' | null;

/** `density` in effect at `rem` px (the web's is 16). */
export function resolveSizes(density: Density, rem = 16, control: DensityControl = null): Sizes {
  const unit = Math.max(1, rem);
  const isPx = 'px' in density.text;
  const text = Math.max(LEAST_TEXT_PX, 'px' in density.text ? density.text.px : density.text.rems * unit);
  const row = control === 'row-unclamped' ? density.rowHeight : Math.max(density.rowHeight, text);
  let scale = isPx ? text / BASE_TEXT_PX : text / (TEXT_REMS * unit);
  if (control === 'scale-over-default-at-rem' && isPx) scale = text / (TEXT_REMS * unit);
  if (control === 'scale-over-14-for-rems' && !isPx) scale = text / BASE_TEXT_PX;
  return { row, text, scale, numberPx: NUMBER_EM * text };
}

/** `custom-cells`' bar's distance from its row's top and bottom: a fifth of
 *  the row, rounded. */
export const barInset = (sizes: Sizes, control: 'inset-fixed' | null = null): number => (control === 'inset-fixed' ? 6 : Math.round(sizes.row / 5));
