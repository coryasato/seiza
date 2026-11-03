/**
 * `pin` (the wide level's): the pinned run's geometry, as the tall table
 * computes it (`components/tall-table/src/pin.rs`): the run in effect (the
 * host's count cut to the leading columns whose right edge is within half
 * the cells' width), its edge, and where each column is drawn under a
 * sideways scroll. The view draws it with the DOM's own tools (sticky key
 * cells, the scrolled columns' virtualizer over the view right of the
 * edge); `pin.json` pins this (`test/fixtures.test.ts`), and
 * `perf/tanstack-parity.ts` checks the DOM draws it.
 */

/** A laid-out column's place: its left edge from the cells' left, and width. */
export interface Placed {
  x: number;
  width: number;
}

/** Float rounding's room past the half (the table's `SLACK`). */
const SLACK = 0.001;

/** `pin.json`'s negative controls; only the fixture test sets one. */
export type PinControl = 'no-cap' | 'pinned-scroll' | 'under-run' | 'into-view-at-gutter' | null;

/** The columns pinned in effect: the first `count`, cut to those whose right
 *  edge is within half `cellsWidth` (none while it's 0). */
export function inEffect(columns: readonly Placed[], count: number, cellsWidth: number, control: PinControl = null): number {
  if (control === 'no-cap') return Math.min(count, columns.length);
  const half = cellsWidth / 2 + SLACK;
  let pinned = 0;
  while (pinned < Math.min(count, columns.length) && columns[pinned]!.x + columns[pinned]!.width <= half) pinned++;
  return pinned;
}

/** The run in effect: `columns` pinned, its right `edge` (at most the cells'
 *  width; 0 with none pinned). */
export class Pin {
  readonly columns: number;
  readonly edge: number;
  readonly control: PinControl;

  constructor(laidOut: readonly Placed[], pinned: number, cellsWidth: number, control: PinControl = null) {
    this.columns = Math.min(pinned, laidOut.length);
    const last = laidOut[this.columns - 1];
    this.edge = last ? Math.min(last.x + last.width, Math.max(cellsWidth, 0)) : 0;
    this.control = control;
  }

  /** Whether column `index` is in the run. */
  holds(index: number): boolean {
    return this.control !== 'pinned-scroll' && index < this.columns;
  }

  /** Column `index`'s left edge on screen (from the cells' left). */
  left(index: number, x: number, scrollX: number): number {
    return this.holds(index) ? x : x - scrollX;
  }

  /** The content x under screen x `x`: the run's own left of the edge. */
  contentX(x: number, scrollX: number): number {
    return x < this.edge ? x : x + scrollX;
  }

  /** Whether column `index` is drawn: a pinned one where it starts in the
   *  view, a scrolled one where it overlaps the view right of the edge. */
  visible(index: number, x: number, width: number, scrollX: number, cellsWidth: number): boolean {
    if (this.holds(index)) return x < cellsWidth;
    const edge = this.control === 'under-run' ? 0 : this.edge;
    return x + width > scrollX + edge && x < scrollX + cellsWidth;
  }

  /** The least sideways move that shows column `index` right of the edge (0
   *  for a pinned one). */
  intoView(index: number, x: number, width: number, scrollX: number, cellsWidth: number): number {
    if (index < this.columns) return 0;
    const edge = this.control === 'into-view-at-gutter' ? 0 : this.edge;
    return leastMove(x, x + width, scrollX + edge, scrollX + cellsWidth);
  }
}

/** The least move that brings `left..right` into `viewLeft..viewRight`
 *  (its left first, where it can't fit): the table's `scroll::into_view`. */
export function leastMove(left: number, right: number, viewLeft: number, viewRight: number): number {
  if (left < viewLeft) return left - viewLeft;
  if (right > viewRight) return Math.min(right - viewRight, left - viewLeft);
  return 0;
}
