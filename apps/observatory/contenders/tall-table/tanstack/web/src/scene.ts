/**
 * The wide sheet's level at a stop (`contenders/scenarios.ts`), as the GPUI
 * contender's `crate/src/scene.rs` sets the table: the stop's row height
 * and text size (`density`), the days at the stop's width, the key columns
 * pinned (`pin`), and heat on every day through the scenario's ramp and
 * domain (`custom-cells`). Pure, so the node tests lay the file's columns out with
 * it (`test/view.test.ts`).
 */

import type { DensityStop, WideScenario } from '../../../../scenarios.ts';
import { resolveSizes } from './density.ts';
import { layOutAll, type ColumnSpec, type LaidOutColumn, type Sizes } from './layout.ts';
import { Domain, fromOklch, type Ramp, type Rgba } from './paint.ts';

/** The heat ramp: cold, the middle, warm (`scene.rs`'s stops), each a
 *  variable `heatCss` sets. */
export const HEAT: Ramp = ['heat-cold', 'heat-mid', 'heat-warm'];

/** `#rrggbb`: a color the browser resolves with no conversion. */
export const hex = (color: Rgba): string => `#${[color.r, color.g, color.b].map((channel) => Math.round(channel * 255).toString(16).padStart(2, '0')).join('')}`;

/** A theme's variables (`block`'s, light or dark) on the root as
 *  `theme.css` switches its own: the system's scheme, or the root's
 *  `data-theme` (market watch's colors; `heatCss` writes the same selectors
 *  out, below). */
export function themeCss(block: (theme: 'light' | 'dark') => string): string {
  return `:root { ${block('light')} }\n@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { ${block('dark')} } }\n:root[data-theme="dark"] { ${block('dark')} }`;
}

/**
 * The scenario's heat stops as CSS variables, light and dark as `theme.css`
 * switches its own (the system's scheme, or the root's `data-theme`), each
 * converted from Oklch to sRGB hex here, once: a `light-dark()` of `oklch()`
 * colors in the variables cost the TanStack side ~4 ms of style work a
 * frame at ~940 cells, resolved inside each cell's `color-mix`. A style
 * element `main.ts` adds before the view renders, where the paint's theme
 * probe reads them.
 */
export function heatCss(scenario: WideScenario): string {
  const block = (theme: 'light' | 'dark') => HEAT.map((token, index) => `--${token}: ${hex(fromOklch(...scenario.heat.stops[theme][index]!))};`).join(' ');
  // `themeCss`'s selectors, written out: through it the wide level's bundle,
  // pinned byte for byte, would move (an extra function renames its others).
  return `:root { ${block('light')} }\n@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { ${block('dark')} } }\n:root[data-theme="dark"] { ${block('dark')} }`;
}

export interface WideScene {
  sizes: Sizes;
  /** The key columns the host pins (the run in effect may be fewer). */
  pinned: number;
  /** The first column painted; every one from it on is. */
  heatFrom: number;
  /** The painted columns' width, px (set, so never scaled). */
  columnWidth: number;
  /** The heat's domain: the ramp's ends and its middle. */
  domain: Domain;
}

/** The scenario at `stop`. */
export function wideScene(scenario: WideScenario, stop: DensityStop): WideScene {
  const { lo, mid, hi } = scenario.heat.domain;
  return {
    sizes: resolveSizes({ rowHeight: stop.rowHeight, text: { px: stop.textSize } }),
    pinned: scenario.pinned,
    heatFrom: scenario.heatFrom,
    columnWidth: stop.columnWidth,
    domain: new Domain(lo, hi, mid),
  };
}

/** The file's columns laid out at the scene: the painted ones at its set
 *  width, the rest by kind at its density; a column a reader resized or
 *  fitted (`resize`) at the width it set, `widths`. */
export function sceneColumns(columns: readonly ColumnSpec[], scene: WideScene, widths: readonly (number | undefined)[] = []): LaidOutColumn[] {
  return layOutAll(
    columns.map((column, index) => {
      const width = setWidthOf(scene, widths, index);
      return width === undefined ? column : { ...column, width };
    }),
    scene.sizes,
  );
}

/** Column `index`'s set width at the scene: the one a reader set
 *  (`widths`), else a painted column's, else none (its kind's). */
export const setWidthOf = (scene: WideScene, widths: readonly (number | undefined)[], index: number): number | undefined => widths[index] ?? (index >= scene.heatFrom ? scene.columnWidth : undefined);
