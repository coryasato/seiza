/**
 * The wide sheet's level at a stop (`contenders/scenarios.ts`), as the GPUI
 * contender's `crate/src/scene.rs` sets the table: the stop's row height
 * and text size (`density`), the days at the stop's width, the key columns
 * pinned (`pin`), and heat on every day through the file's whole range
 * (`custom-cells`). Pure, so the node tests lay the file's columns out with
 * it (`test/view.test.ts`).
 */

import type { DensityStop, WideScenario } from '../../../../scenarios.ts';
import { resolveSizes } from './density.ts';
import { layOutAll, type ColumnSpec, type LaidOutColumn, type Sizes } from './layout.ts';
import { Domain, type Ramp } from './paint.ts';

/** The heat ramp: the background to the chart color (`scene.rs`'s
 *  `Ramp::new(&[background, chart_1])`). */
export const HEAT: Ramp = ['background', 'chart-1'];

export interface WideScene {
  sizes: Sizes;
  /** The key columns the host pins (the run in effect may be fewer). */
  pinned: number;
  /** The first column painted; every one from it on is. */
  heatFrom: number;
  /** The painted columns' width, px (set, so never scaled). */
  columnWidth: number;
  /** The file's least and greatest value over the painted columns. */
  domain: Domain;
}

/** The scenario at `stop`, its heat through `range` (`MANIFEST.json`'s). */
export function wideScene(scenario: WideScenario, stop: DensityStop, [lo, hi]: readonly [number, number]): WideScene {
  return {
    sizes: resolveSizes({ rowHeight: stop.rowHeight, text: { px: stop.textSize } }),
    pinned: scenario.pinned,
    heatFrom: scenario.heatFrom,
    columnWidth: stop.columnWidth,
    domain: new Domain(lo, hi),
  };
}

/** The file's columns laid out at the scene: the painted ones at its set
 *  width, the rest by kind at its density. */
export function sceneColumns(columns: readonly ColumnSpec[], scene: WideScene): LaidOutColumn[] {
  return layOutAll(
    columns.map((column, index) => (index >= scene.heatFrom ? { ...column, width: scene.columnWidth } : column)),
    scene.sizes,
  );
}
