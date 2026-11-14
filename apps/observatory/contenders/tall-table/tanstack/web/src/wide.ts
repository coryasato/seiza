/**
 * The wide level's view (`custom-cells`, `pin`, `density`; `scene.ts` sets
 * it at a stop): the view's parts `view.ts` uses only in the wide sheet's
 * build (`__LEVEL__`), so the base's bundle carries none of it. Beside the
 * rows' virtualizer, a column virtualizer over the scrolled columns, its
 * view the cells' width right of the pinned run's edge (so a column wholly
 * under the run isn't drawn, as the table's `Pin::visible`); the key
 * columns sticky at their place inside the translated rows, opaque, the
 * run's edge a line over the frame; heat by `color-mix(in oklab)` through
 * the scenario's diverging ramp, its text in the theme's color that
 * contrasts with it.
 */

import { createElement as h, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { useVirtualizer, type VirtualItem } from '@tanstack/react-virtual';
import type { Contender } from '../../../../contract.ts';
import { exactText, shownText } from './data/format.ts';
import type { TablePage } from './data/table.ts';
import { GUTTER_ARIA, HEAD_ARIA, rowAria } from './aria.ts';
import { barInset } from './density.ts';
import { formatCount, padOf, type LaidOutColumn, type Sizes } from './layout.ts';
import { FramePaint, documentTheme, fromOklab, rampAt, rampCss, resolveRamp, type Oklab } from './paint.ts';
import { Pin, inEffect } from './pin.ts';
import { HEAT, type WideScene } from './scene.ts';

/** The scrolled columns drawn past each side of the view. */
const OVERSCAN_COLUMNS = 2;
/** How long with no sideways scroll before the columns' virtualizer counts
 *  as at rest (TanStack's own default). */
const SIDEWAYS_IDLE_MS = 150;

/** The page's theme as the cells' paint reads it: resolved again when the
 *  root's `data-theme` or the system's scheme changes. */
export function useFramePaint(): { frame: FramePaint; heat: Oklab[] } {
  const resolve = () => {
    const theme = documentTheme([HEAT]);
    return { frame: new FramePaint(theme), heat: resolveRamp(HEAT, theme) };
  };
  const [paint, setPaint] = useState(resolve);
  useEffect(() => {
    const update = () => setPaint(resolve());
    const attributes = new MutationObserver(update);
    attributes.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const scheme = matchMedia('(prefers-color-scheme: dark)');
    scheme.addEventListener('change', update);
    return () => {
      attributes.disconnect();
      scheme.removeEventListener('change', update);
    };
  }, []);
  return paint;
}

export interface Sheet {
  /** The run in effect. */
  pin: Pin;
  /** The cells' width: right of the row numbers, left of the vertical scrollbar. */
  cellsWidth: number;
  /** The scrolled columns drawn, by index, and the space before the first. */
  first: number;
  last: number;
  gap: number;
  /** The horizontal scrollbar's height, which the edge line stops above. */
  bar: number;
}

/** The run in effect at `cellsWidth`. */
const runAt = (columns: readonly LaidOutColumn[], pinned: number, cellsWidth: number): Pin => new Pin(columns, inEffect(columns, pinned, cellsWidth), cellsWidth);

/** The pin and the scrolled columns' virtualizer, following the scroller's
 *  size (the run in effect is cut at half the cells' width; `hold`, a
 *  resize's, keeps the run it had at the press until the release). */
export function useSheet(scrollerRef: RefObject<HTMLDivElement | null>, columns: readonly LaidOutColumn[], scene: WideScene, gutter: number, hold: number | null = null): Sheet {
  const [size, setSize] = useState({ cellsWidth: 0, bar: 0 });
  /** The run in effect at `cellsWidth`: the held one during a resize. */
  const runFor = useCallback((cellsWidth: number) => (hold === null ? runAt(columns, scene.pinned, cellsWidth) : new Pin(columns, hold, cellsWidth)), [columns, scene.pinned, hold]);
  const pin = useMemo(() => runFor(size.cellsWidth), [runFor, size.cellsWidth]);
  const from = pin.columns;
  const firstX = columns[from]?.x ?? 0;
  const measure = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return null;
    const cellsWidth = Math.max(0, scroller.clientWidth - gutter);
    const bar = Math.max(0, scroller.offsetHeight - scroller.clientHeight);
    setSize((was) => (was.cellsWidth === cellsWidth && was.bar === bar ? was : { cellsWidth, bar }));
    return { width: Math.max(0, cellsWidth - runFor(cellsWidth).edge), height: scroller.clientHeight };
  }, [scrollerRef, gutter, runFor]);
  // TanStack asks for the view's rect once, when the scroll element is set:
  // its observer reads the latest `measure`, and a new run or new widths (a
  // resize, a fit) tell it the view again.
  const measureRef = useRef(measure);
  measureRef.current = measure;
  const notifyRect = useRef<((rect: { width: number; height: number }) => void) | null>(null);
  // Before the first paint: the first frame already draws the run.
  useLayoutEffect(() => {
    const rect = measure();
    if (rect) notifyRect.current?.(rect);
  }, [measure]);
  const virtualizer = useVirtualizer({
    horizontal: true,
    count: Math.max(0, columns.length - from),
    getScrollElement: () => scrollerRef.current,
    estimateSize: (index) => columns[from + index]!.width,
    // A new run, or new widths (a resize), lays the scrolled columns out again.
    getItemKey: useCallback((index: number) => from + index, [from, columns]),
    overscan: OVERSCAN_COLUMNS,
    // Told only of sideways moves: TanStack's own listener hears every
    // scroll of the shared scroller, so each vertical gesture would flip its
    // `isScrolling` and re-render the table at its start and its end.
    observeElementOffset: (_instance, notify) => {
      const scroller = scrollerRef.current;
      if (!scroller) return;
      let left = scroller.scrollLeft;
      let idle = 0;
      notify(left, false);
      const onScroll = () => {
        if (scroller.scrollLeft === left) return;
        left = scroller.scrollLeft;
        notify(left, true);
        clearTimeout(idle);
        idle = window.setTimeout(() => notify(left, false), SIDEWAYS_IDLE_MS);
      };
      scroller.addEventListener('scroll', onScroll, { passive: true });
      return () => {
        scroller.removeEventListener('scroll', onScroll);
        clearTimeout(idle);
      };
    },
    // The view right of the run's edge: a column wholly under it isn't drawn.
    observeElementRect: (_instance, notify) => {
      const scroller = scrollerRef.current;
      if (!scroller) return;
      notifyRect.current = notify;
      const update = () => {
        const rect = measureRef.current();
        if (rect) notify(rect);
      };
      update();
      const observer = new ResizeObserver(update);
      observer.observe(scroller);
      return () => {
        observer.disconnect();
        notifyRect.current = null;
      };
    },
  });
  const items: VirtualItem[] = virtualizer.getVirtualItems();
  const first = items.length ? from + items[0]!.index : from;
  const last = items.length ? from + items.at(-1)!.index : from - 1;
  const gap = items.length ? columns[first]!.x - firstX : 0;
  return { pin, cellsWidth: size.cellsWidth, first, last, gap, bar: size.bar };
}

/** A pinned cell's width and sticky place (the run's edge is `EdgeLine`'s). */
const pinnedStyle = (column: LaidOutColumn, gutter: number): CSSProperties => ({ width: column.width, left: gutter + column.x });

/** The header: the row numbers' corner, the pinned names, the scrolled ones
 *  drawn; the selected columns' names tinted (`select`), and the scrolled
 *  columns' resize bands (`resize`, `wide-tools.ts`). */
export function WideHead({ columns, sheet, gutter, width, sizes, selected, bands }: { columns: readonly LaidOutColumn[]; sheet: Sheet; gutter: number; width: number; sizes: Sizes; selected: readonly [number, number] | null; bands: ReactNode[] }): ReactNode {
  const cells: ReactNode[] = [];
  const sel = (index: number) => (selected && index >= selected[0] && index <= selected[1] ? ' sel' : '');
  for (let index = 0; index < sheet.pin.columns; index++) {
    const column = columns[index]!;
    cells.push(h('div', { key: column.name, className: `cell pin ${column.align}${index === sheet.pin.columns - 1 ? ' last' : ''}${sel(index)}`, style: pinnedStyle(column, gutter), role: 'columnheader', 'aria-colindex': index + 1 }, column.name));
  }
  cells.push(h('div', { key: ' gap', className: 'gap', style: { width: sheet.gap } }));
  for (let index = sheet.first; index <= sheet.last; index++) {
    const column = columns[index]!;
    cells.push(h('div', { key: column.name, className: `cell ${column.align}${sel(index)}`, style: { width: column.width }, role: 'columnheader', 'aria-colindex': index + 1 }, column.name));
  }
  return h('div', { className: 'head', style: { width, height: sizes.row }, ...HEAD_ARIA }, h('div', { className: 'num', style: { width: gutter }, ...GUTTER_ARIA }), cells, bands);
}

/** A row, by its page and its index in it (null and no failure: not loaded
 *  yet), drawing the pinned columns and the scrolled ones in `sheet`. */
interface WideRowProps {
  row: number;
  top: number;
  page: TablePage | null;
  index: number;
  failed: string | null;
  columns: readonly LaidOutColumn[];
  pinned: number;
  first: number;
  last: number;
  gap: number;
  gutter: number;
  scene: WideScene;
  frame: FramePaint;
  heat: Oklab[];
  /** `?measure`: the cells created as the row's page lands (or the row
   *  comes into view) carry `elementtiming`, so their paint is reported;
   *  columns a sideways scroll brings in later don't, so a row that loaded
   *  long ago reports no new paint (`docs/contender-contract.md`,
   *  "Reading the metrics"). */
  measured: boolean;
  /** The selection in this row (`select`): its columns, `-1` for none;
   *  whether it's the range's first and last row (edged there); the active
   *  cell's column while the table has focus, else `-1`. */
  selFrom: number;
  selTo: number;
  selTop: boolean;
  selBottom: boolean;
  active: number;
}

export const WideRow = /* @__PURE__ */ memo(function WideRow(props: WideRowProps): ReactNode {
  const { row, top, page, index, failed, columns, pinned, first, last, gap, gutter, scene, frame, heat, measured, selFrom, selTo, selTop, selBottom, active } = props;
  const kind = row % 2 === 1 ? 'odd' : 'even';
  // The scrolled columns whose cells were created with the row's page: set
  // when the page arrives, narrowed as columns leave (a column that comes
  // back is a new element, painted for the scroll, not the load).
  const timed = useRef<{ page: TablePage | null; first: number; last: number }>({ page: null, first: 0, last: -1 });
  if (measured && page) {
    if (timed.current.page !== page) timed.current = { page, first, last };
    else timed.current = { page, first: Math.max(timed.current.first, first), last: Math.min(timed.current.last, last) };
  }
  const timedColumn = (column: number) => column < pinned || (column >= timed.current.first && column <= timed.current.last);
  const drawn: number[] = [];
  for (let column = 0; column < pinned; column++) drawn.push(column);
  for (let column = first; column <= last; column++) drawn.push(column);
  const cell = (column: number): ReactNode => {
    const laidOut = columns[column]!;
    const pin = column < pinned;
    const selected = column >= selFrom && column <= selTo;
    const base = `cell ${laidOut.align}${pin ? ` pin${column === pinned - 1 ? ' last' : ''}` : ''}${selected ? ' sel' : ''}`;
    const style: CSSProperties = pin ? pinnedStyle(laidOut, gutter) : { width: laidOut.width };
    if (failed !== null) return null;
    if (selected) {
      const edges = selectionEdges(column, pinned, selFrom, selTo, selTop, selBottom, column === active);
      if (edges) style.boxShadow = edges;
    }
    if (!page) {
      // Keyed apart from the loaded cells, so a row that loads gets new cells (Element Timing).
      return h('div', { key: `pending:${column}`, className: `${base} pending`, style, 'data-column': column, role: 'cell', 'aria-colindex': column + 1 }, h('div', { className: 'bar' }));
    }
    const value = page.value(index, column);
    if (value === undefined) return h('div', { key: column, className: base, style, 'data-column': column, role: 'cell', 'aria-colindex': column + 1 });
    let className = base;
    if (value === null) className += ' null';
    else if (column >= scene.heatFrom && typeof value === 'number') {
      const at = scene.domain.unit(value);
      const fill = rampCss(HEAT, at);
      const mixed = rampAt(heat, at);
      if (fill && mixed) {
        // Selected: the tint over the fill, which stays clear of the row's line.
        style.background = selected ? `linear-gradient(var(--table-active), var(--table-active)), linear-gradient(${fill}, ${fill}) 0 0 / 100% calc(100% - 1px) no-repeat` : fill;
        if (frame.textOver(mixed, kind) === 'background') className += ' on-fill';
      }
    }
    return h(
      'div',
      { key: column, className, style, 'data-column': column, role: 'cell', 'aria-colindex': column + 1, elementtiming: measured && timedColumn(column) ? `row:${row}` : undefined },
      shownText(laidOut.kind, value, laidOut.budget),
    );
  };
  const pinnedCells = drawn.slice(0, pinned).map(cell);
  const scrolled = failed !== null ? [h('div', { key: 'failed', className: 'failed', style: { left: gutter }, role: 'cell' }, `Couldn't load these rows: ${failed}`)] : drawn.slice(pinned).map(cell);
  return h(
    'div',
    { className: `row ${kind}`, 'data-row': row, style: { transform: `translateY(${top}px)` }, ...rowAria(row) },
    h('div', { className: selFrom >= 0 ? 'num sel' : 'num', style: { width: gutter }, ...GUTTER_ARIA }, formatCount(row + 1)),
    pinnedCells,
    h('div', { key: ' gap', className: 'gap', style: { width: gap } }),
    scrolled,
  );
});

/** A selected cell's edges, as the table's tint and active cell draw them
 *  (`render_selection`): the range's 1 px border where the cell is on its
 *  side (split at the run's edge, each piece edged), the active cell's 2 px. */
function selectionEdges(column: number, pinned: number, from: number, to: number, top: boolean, bottom: boolean, active: boolean): string | undefined {
  const color = 'var(--table-active-border)';
  const edges: string[] = [];
  if (active) edges.push(`inset 0 0 0 2px ${color}`);
  if (top) edges.push(`inset 0 1px 0 0 ${color}`);
  if (bottom) edges.push(`inset 0 -1px 0 0 ${color}`);
  if (column === from || (column === pinned && from < pinned)) edges.push(`inset 1px 0 0 0 ${color}`);
  if (column === to || (column === pinned - 1 && to >= pinned)) edges.push(`inset -1px 0 0 0 ${color}`);
  return edges.length ? edges.join(', ') : undefined;
}

/** The pinned run's edge: a 1 px line over the frame at its right, through
 *  the header and the body, above the horizontal scrollbar (the table's
 *  `edge_line`). */
export function EdgeLine({ sheet, gutter }: { sheet: Sheet; gutter: number }): ReactNode {
  return sheet.pin.columns > 0 ? h('div', { className: 'edge', style: { left: gutter + sheet.pin.edge - 1, bottom: sheet.bar } }) : null;
}

/** The frame's lengths at the scene's density, as CSS variables `wide.css` reads. */
export function sheetStyle(sizes: Sizes): CSSProperties {
  const inset = barInset(sizes);
  return {
    fontSize: sizes.text,
    '--row': `${sizes.row}px`,
    '--pad': `${padOf(sizes)}px`,
    '--skeleton-height': `${Math.min(8, Math.max(1, sizes.row - 2 * inset))}px`,
  } as CSSProperties;
}

/** A drawn cell's element, by its row and column. */
export const cellElement = (scroller: Element, row: number, column: number): HTMLElement | null =>
  scroller.querySelector<HTMLElement>(`.row[data-row="${row}"] > .cell[data-column="${column}"]`);

/** A scrolled cell's part right of the run (the tooltip's place beside it,
 *  as the table's `tooltip_cell`), or a pinned cell whole. */
export function cellRect(scroller: Element, sheet: Sheet, gutter: number, row: number, column: number): DOMRect | null {
  const cell = cellElement(scroller, row, column);
  if (!cell) return null;
  const rect = cell.getBoundingClientRect();
  if (column < sheet.pin.columns) return rect;
  const edge = scroller.getBoundingClientRect().left + scroller.clientLeft + gutter + sheet.pin.edge;
  const left = Math.max(rect.left, edge);
  return new DOMRect(left, rect.top, Math.max(0, rect.right - left), rect.height);
}

/**
 * `?cells` (the wide check, `perf/wide.ts`): the layout in effect and the
 * cells on screen as the DOM drew them, on `__contender` as the GPUI
 * contender's probes publish them: each cell whose box is inside the rows'
 * view (below the header, above the horizontal scrollbar) and, if
 * scrolled, right of the run's edge; its exact and shown text, and its
 * heat's color (8-bit RGBA, the ramp's mix) or null.
 */
export function publishCells(scroller: HTMLElement, columns: readonly LaidOutColumn[], sheet: Sheet, gutter: number, scene: WideScene, heat: Oklab[], page: (row: number) => { page: TablePage; index: number } | null): void {
  const contender = (globalThis as { __contender?: Contender & { layout?: unknown; cells?: unknown } }).__contender;
  if (!contender) return;
  const box = scroller.getBoundingClientRect();
  const left = box.left + scroller.clientLeft;
  const top = box.top + scroller.clientTop + scene.sizes.row;
  const bottom = box.top + scroller.clientTop + scroller.clientHeight;
  const edge = left + gutter + sheet.pin.edge;
  const right = left + gutter + sheet.cellsWidth;
  const cells: { row: number; column: number; exact: string; shown: string; fill: number[] | null }[] = [];
  for (const element of scroller.querySelectorAll<HTMLElement>('.content > .row')) {
    const row = Number(element.dataset.row);
    const rowBox = element.getBoundingClientRect();
    if (rowBox.bottom <= top || rowBox.top >= bottom) continue;
    const loaded = page(row);
    if (!loaded) continue;
    for (const cell of element.querySelectorAll<HTMLElement>(':scope > .cell[data-column]')) {
      const column = Number(cell.dataset.column);
      const cellBox = cell.getBoundingClientRect();
      const from = column < sheet.pin.columns ? left + gutter : edge;
      if (cellBox.right <= from || cellBox.left >= right) continue;
      const value = loaded.page.value(loaded.index, column);
      if (value === undefined) continue;
      const laidOut = columns[column]!;
      const exact = value === null ? 'NULL' : typeof value === 'number' && laidOut.kind === 'float' ? exactText(value) : shownText(laidOut.kind, value, Infinity);
      const mixed = column >= scene.heatFrom && typeof value === 'number' ? rampAt(heat, scene.domain.unit(value)) : null;
      const fill = mixed && cell.style.background ? rgba8(fromOklab(mixed)) : null;
      cells.push({ row, column, exact, shown: cell.textContent ?? '', fill });
    }
  }
  // `left` and `top` as the GPUI contender's: the cells' left edge (right of the row numbers) and the rows' top.
  contender.layout = { left: left + gutter, top, rowHeight: scene.sizes.row, cellsWidth: sheet.cellsWidth, pinned: sheet.pin.columns, columns: columns.map(({ name, x, width, kind }) => ({ name, x, width, kind })) };
  contender.cells = cells;
}

const rgba8 = (color: { r: number; g: number; b: number; a: number }): number[] => [color.r, color.g, color.b, color.a].map((channel) => Math.round(channel * 255));
