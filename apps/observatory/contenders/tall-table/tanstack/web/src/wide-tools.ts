/**
 * The wide level's tools on the DOM: `resize` (the bands at each column's
 * header edge, a drag, a double-click's fit) and `select` (a press, a drag,
 * the keys), as the tall table offers them (`state/resize.rs`,
 * `state/select.rs`), over the pure ports (`resize.ts`, `select.ts`). A
 * drag's move is applied once a frame, in the frame's callback
 * (`flushSync`), as market watch's landings are. The bands take a mouse or
 * a pen; a tap selects. With `?measure`, the selection, the set widths, and
 * the layout on `__contender` (`docs/contender-contract.md`, "State").
 */

import { createElement as h, useLayoutEffect, useMemo, useReducer, useRef, type ReactNode, type RefObject } from 'react';
import { flushSync } from 'react-dom';
import { measuring, type Contender } from '../../../../contract.ts';
import type { CellValue } from './data/format.ts';
import type { TablePaging } from './data/paging.ts';
import type { Column, TablePage } from './data/table.ts';
import { clampWidth, type LaidOutColumn, type Sizes } from './layout.ts';
import { BAND_PADDING, dragWidth, fitWidth, pressBand, type Resizing } from './resize.ts';
import { setWidthOf, type WideScene } from './scene.ts';
import type { ScaledScroller } from './scroll.ts';
import { Selector, selectionJson, type Selection, type SheetView, type Step } from './select.ts';
import type { Sheet } from './wide.ts';
import type * as CopyModule from './copy.ts';

/** The wide level's copy (`copy.ts`): loaded after first paint with the
 *  data layer, handed to the tools with the open table. */
export type CopyLayer = typeof CopyModule;

/** What the view draws of the tools. */
export interface Tools {
  /** Each column's set width where a drag or a fit set one. */
  widths: readonly (number | undefined)[];
  selection: Selection | null;
  /** The table has focus: the active cell is edged. */
  focused: boolean;
  /** The column a drag resizes, its hairline lit. */
  resizing: number | null;
  /** During a resize: the run held, and the cells' right the content keeps
   *  reaching, so the sideways scroll holds until the release. */
  held: { pinned: number; right: number } | null;
  /** A jump landed on `row` (the replay's): it's selected. */
  jumped(row: number): void;
}

/** The table's parts the tools read at an input. */
export interface ToolRefs {
  frame: RefObject<HTMLDivElement | null>;
  scroller: RefObject<HTMLDivElement | null>;
  model: RefObject<ScaledScroller | null>;
  sheet: RefObject<Sheet | null>;
  columns: RefObject<readonly LaidOutColumn[]>;
}

const contender = (): (Contender & { selection?: unknown; widths?: unknown; layout?: unknown }) | undefined => (globalThis as { __contender?: Contender }).__contender;

/** The pointer type of the last press anywhere: a compatibility mouse event
 *  after a tap says nothing of it. */
let lastPointer = 'mouse';

/** The tools' state and their listeners on the table. `refs` and `gutter`
 *  are read once the table is mounted (the view makes them after the
 *  columns, which the tools' widths lay out). */
export function useWideTools(table: () => ToolRefs, scene: WideScene, gutterOf: () => number, rows: number, paging: TablePaging<TablePage>, copy?: CopyLayer, fileColumns: readonly Column[] = []): Tools {
  const [, rerender] = useReducer((count: number) => count + 1, 0);
  const measured = useMemo(measuring, []);
  const state = useRef<Omit<Tools, 'jumped'> & { selector: Selector | null }>({ widths: [], selection: null, focused: false, resizing: null, held: null, selector: null });
  const sizes = scene.sizes;
  const rowHeight = sizes.row;

  useLayoutEffect(() => {
    const refs = table();
    const gutter = gutterOf();
    const frame = refs.frame.current!;
    const scroller = refs.scroller.current!;
    const model = (): ScaledScroller => refs.model.current!;
    const sheet = (): Sheet => refs.sheet.current!;
    const columns = (): readonly LaidOutColumn[] => refs.columns.current!;
    const s = state.current;
    // In a frame's callback, the change is committed there; elsewhere (a
    // press, a key) at the event's end, as React batches it.
    let inFrame = false;
    const render = () => (inFrame ? flushSync(rerender) : rerender());

    /** A key's scroll through the scroller lands at its scroll event, which
     *  moves the model: until then (or 200 ms, should it never come) the
     *  next key reads the top that scroll asked for, not the model's. */
    let asked: { top: number; v: number; at: number } | null = null;
    const top = (): number => {
      if (asked && (model().v !== asked.v || performance.now() - asked.at > 200)) asked = null;
      return asked ? asked.top : model().v / rowHeight;
    };
    const view = (): SheetView => ({
      rows,
      columns: columns(),
      pin: sheet().pin,
      cellsWidth: sheet().cellsWidth,
      viewHeight: model().viewport,
      rowHeight,
      top: top(),
      scrollX: scroller.scrollLeft,
      maxScrollX: Math.max(0, scroller.scrollWidth - scroller.clientWidth),
    });
    // Cmd+C on the selection (`copy.ts`), once the data layer brought it.
    const copier = copy?.attachCopy(paging, fileColumns, () => s.selection) ?? null;
    const selector = new Selector({
      view,
      // A key's move: a step of at most the view through the scroller (the
      // model's 1:1 path, which the compositor moves), a longer one a jump.
      scrollTo: (to, scrollX) => {
        const dy = (to - top()) * rowHeight;
        if (dy !== 0) {
          if (Math.abs(dy) <= model().viewport) {
            const v = model().v;
            model().step(dy);
            asked = { top: to, v, at: performance.now() };
          } else {
            asked = null;
            model().jumpTo(to * rowHeight);
          }
        }
        if (scrollX !== scroller.scrollLeft) scroller.scrollLeft = scrollX;
      },
      changed: (selection) => {
        s.selection = selection;
        if (measured) {
          const target = contender();
          if (target) target.selection = selectionJson(selection);
        }
        copier?.selected(selection);
        render();
      },
    });
    s.selector = selector;

    /** A client point in the table's coordinates: from the cells' left and the rows' top. */
    const local = (clientX: number, clientY: number): [number, number] => {
      const box = scroller.getBoundingClientRect();
      return [clientX - box.left - scroller.clientLeft - gutter, clientY - box.top - scroller.clientTop - rowHeight];
    };

    /** A column's set width: a drag's or a fit's, else the scene's (undefined: its kind's). */
    const setOf = (column: number): number | undefined => setWidthOf(scene, s.widths, column);
    /** Each column's set width, as the table reports them. */
    const setWidths = (): (number | null)[] => columns().map((_, index) => {
      const set = setOf(index);
      return set === undefined ? null : clampWidth(set, sizes);
    });
    const publishWidths = () => {
      const target = measured ? contender() : undefined;
      if (target) target.widths = setWidths();
    };
    const setWidth = (column: number, width: number | undefined) => {
      const widths = [...s.widths];
      widths[column] = width;
      s.widths = widths;
    };

    // --- the pointer ---

    let pending: { x: number; y: number } | null = null;
    let frameId = 0;
    let resizing: Resizing | null = null;
    let selecting = false;
    let lastClient: { x: number; y: number } | null = null;

    const apply = () => {
      frameId = 0;
      const at = pending;
      pending = null;
      if (!at) return;
      inFrame = true;
      try {
        if (resizing) {
          const width = dragWidth(resizing, at.x, sizes);
          if (width !== setOf(resizing.column)) {
            setWidth(resizing.column, width);
            flushSync(rerender);
          }
        } else if (selecting) {
          selector.dragTo(...local(at.x, at.y));
        }
      } finally {
        inFrame = false;
      }
    };
    const onMove = (event: PointerEvent) => {
      // No hover meanwhile, so no tooltip (the table's).
      event.stopPropagation();
      // The button came up where no release reached the page: the drag's over.
      if ((event.buttons & 1) === 0) {
        onUp();
        return;
      }
      pending = lastClient = { x: event.clientX, y: event.clientY };
      if (!frameId) frameId = requestAnimationFrame(apply);
    };
    /** A scroll during a selecting drag (a wheel): the head follows the
     *  cell now under the pointer, in the scroll's frame. */
    const onDragScroll = () => {
      if (!selecting || !lastClient) return;
      inFrame = true;
      try {
        selector.scrolled(...local(lastClient.x, lastClient.y));
      } finally {
        inFrame = false;
      }
    };
    /** A resize holds the sideways scroll until the release, as the
     *  table's `scroll_by` drops sideways input: Shift's wheel (sideways
     *  here) moves nothing; a wheel with a sideways part (a trackpad's, a
     *  little in most vertical moves) scrolls by its vertical part alone,
     *  still heard by the scroll model as a wheel. */
    const onResizeWheel = (event: WheelEvent) => {
      if (event.shiftKey) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (event.deltaX === 0) return;
      event.preventDefault();
      const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? rowHeight : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? scroller.clientHeight : 1;
      if (event.deltaY !== 0) scroller.scrollBy({ top: event.deltaY * unit, behavior: 'instant' });
    };
    const startDrag = () => {
      window.addEventListener('pointermove', onMove, { capture: true });
      window.addEventListener('pointerup', onUp, { capture: true });
      window.addEventListener('pointercancel', onUp, { capture: true });
      window.addEventListener('blur', onUp);
    };
    /** A drag's listeners and its frame go, its state with them; nothing
     *  is applied or drawn (the table's teardown calls it too). */
    const stopDrag = () => {
      window.removeEventListener('pointermove', onMove, { capture: true });
      window.removeEventListener('pointerup', onUp, { capture: true });
      window.removeEventListener('pointercancel', onUp, { capture: true });
      window.removeEventListener('blur', onUp);
      scroller.removeEventListener('scroll', onDragScroll);
      scroller.removeEventListener('wheel', onResizeWheel, { capture: true });
      document.documentElement.classList.remove('col-resizing');
      if (frameId) cancelAnimationFrame(frameId);
      frameId = 0;
      pending = null;
      lastClient = null;
    };
    const onUp = () => {
      // The last move, then the release.
      if (frameId) cancelAnimationFrame(frameId);
      apply();
      const ended = resizing;
      stopDrag();
      if (selecting) {
        selecting = false;
        selector.release();
      }
      if (ended) {
        resizing = null;
        s.resizing = null;
        s.held = null;
        if (setOf(ended.column) !== ended.was) publishWidths();
        rerender();
      }
    };

    /** A double-click's second press on a band: the column fitted to its
     *  name and its visible, loaded rows. */
    const fit = (column: number) => {
      const laidOut = columns()[column];
      if (!laidOut) return;
      const context = document.createElement('canvas').getContext('2d')!;
      context.font = `${sizes.text}px 'IBM Plex Sans'`;
      const top = model().v / rowHeight;
      const end = Math.min(Math.ceil(top + model().viewport / rowHeight), rows);
      const values: CellValue[] = [];
      for (let row = Math.min(Math.floor(top), rows); row < end; row++) {
        const state = paging.row(row);
        if (state.kind === 'loaded') values.push(state.page.value(state.index, column) ?? null);
      }
      const width = fitWidth(laidOut, values, sizes, (text) => context.measureText(text).width);
      const set = setOf(column);
      if (set !== undefined && clampWidth(set, sizes) === width) return;
      setWidth(column, width);
      publishWidths();
      rerender();
    };

    const onDown = (event: MouseEvent) => {
      if (event.button !== 0) return;
      const target = event.target as Element;
      const band = target.closest<HTMLElement>('.band');
      if (band && lastPointer !== 'touch') {
        event.preventDefault();
        event.stopPropagation();
        scroller.focus({ preventScroll: true });
        const column = Number(band.dataset.band);
        const laidOut = columns()[column];
        if (!laidOut) return;
        if (event.detail >= 2) {
          fit(column);
          return;
        }
        const { pin, cellsWidth } = sheet();
        resizing = pressBand(column, event.clientX, laidOut, setOf(column), column < pin.columns, pin.edge, cellsWidth);
        s.resizing = column;
        s.held = { pinned: pin.columns, right: scroller.scrollLeft + cellsWidth };
        document.documentElement.classList.add('col-resizing');
        scroller.addEventListener('wheel', onResizeWheel, { capture: true, passive: false });
        startDrag();
        rerender();
        return;
      }
      if (!scroller.contains(target)) return;
      const [x, y] = local(event.clientX, event.clientY);
      // Off the cells, the numbers, and the header (a scrollbar): the browser's.
      if (!selector.onTable(x, y)) return;
      event.preventDefault();
      scroller.focus({ preventScroll: true });
      selector.press(x, y, { shift: event.shiftKey, ctrl: event.ctrlKey, clicks: event.detail });
      // A tap selects, and its touch is already up: no drag.
      if (lastPointer === 'touch') selector.release();
      if (selector.dragging) {
        selecting = true;
        lastClient = { x: event.clientX, y: event.clientY };
        scroller.addEventListener('scroll', onDragScroll, { passive: true });
        startDrag();
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      lastPointer = event.pointerType;
    };

    // --- the keys ---

    const onKey = (event: KeyboardEvent) => {
      if (event.altKey || resizing) return;
      const { key, shiftKey: shift, metaKey: meta, ctrlKey: ctrl } = event;
      let handled = false;
      if ((meta || ctrl) && !shift && key.toLowerCase() === 'a') handled = selector.selectAll();
      // A copy of the selection; with nothing selected the key goes on.
      else if ((meta || ctrl) && !shift && key.toLowerCase() === 'c') handled = copier?.key() ?? false;
      // A copy running is cancelled first, the selection kept.
      else if (key === 'Escape' && !meta && !ctrl) handled = (copier?.escape() ?? false) || selector.escape();
      else {
        const step: Step | null =
          meta && !ctrl && key === 'ArrowUp' ? 'first'
          : meta && !ctrl && key === 'ArrowDown' ? 'last'
          : meta || ctrl ? null
          : ({ ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', PageUp: 'pageUp', PageDown: 'pageDown', Home: 'first', End: 'last' } as Record<string, Step>)[key] ?? null;
        if (step) handled = selector.key(step, shift);
      }
      if (!handled) return;
      // Before the scroller's own keys.
      event.preventDefault();
      event.stopImmediatePropagation();
    };

    const onFocus = () => {
      s.focused = document.activeElement === scroller;
      rerender();
    };

    frame.addEventListener('mousedown', onDown);
    window.addEventListener('pointerdown', onPointerDown, { capture: true, passive: true });
    scroller.addEventListener('keydown', onKey, { capture: true });
    scroller.addEventListener('focus', onFocus);
    scroller.addEventListener('blur', onFocus);
    s.focused = document.activeElement === scroller;
    return () => {
      stopDrag();
      selecting = false;
      resizing = null;
      frame.removeEventListener('mousedown', onDown);
      window.removeEventListener('pointerdown', onPointerDown, { capture: true });
      scroller.removeEventListener('keydown', onKey, { capture: true });
      scroller.removeEventListener('focus', onFocus);
      scroller.removeEventListener('blur', onFocus);
      copier?.close();
      s.selector = null;
    };
  }, [paging, copy, fileColumns]);

  const s = state.current;
  return { widths: s.widths, selection: s.selection, focused: s.focused, resizing: s.resizing, held: s.held, jumped: (row) => s.selector?.jumped(row) };
}

/** With `?measure`, where the cells are, at each layout change (a release
 *  or fit, the view's size), never during a drag: as the table's `Layout`. */
export function publishLayout(scroller: HTMLElement, columns: readonly LaidOutColumn[], sheet: Sheet, gutter: number, rowHeight: number): void {
  const target = contender();
  if (!target) return;
  const box = scroller.getBoundingClientRect();
  target.layout = {
    left: box.left + scroller.clientLeft + gutter,
    top: box.top + scroller.clientTop + rowHeight,
    rowHeight,
    cellsWidth: sheet.cellsWidth,
    pinned: sheet.pin.columns,
    columns: columns.map(({ name, x, width, kind, budget }) => ({ name, x, width, kind, budget })),
  };
}

/** A band at a column's right edge: a 1 px hairline with `BAND_PADDING` on
 *  each side, at `left` in its layer. */
const band = (column: number, left: number, lit: boolean): ReactNode =>
  h('div', { key: `band:${column}`, className: lit ? 'band lit' : 'band', 'data-band': column, style: { left }, 'aria-hidden': true }, h('div', { className: 'hairline' }));

/** The scrolled columns' bands, in the header (scrolled with it; the pinned
 *  cells cover those under the run). */
export function headBands(columns: readonly LaidOutColumn[], sheet: Sheet, gutter: number, lit: number | null): ReactNode[] {
  const bands: ReactNode[] = [];
  for (let index = Math.max(sheet.first, sheet.pin.columns); index <= sheet.last; index++) {
    const column = columns[index]!;
    bands.push(band(index, gutter + column.x + column.width - 1 - BAND_PADDING, lit === index));
  }
  return bands;
}

/** The pinned columns' bands, over the frame (held at their place under a
 *  sideways scroll), clipped to the cells: the last one's half past the
 *  run's edge draws and takes the press. */
export function PinnedBands({ columns, sheet, gutter, lit, sizes }: { columns: readonly LaidOutColumn[]; sheet: Sheet; gutter: number; lit: number | null; sizes: Sizes }): ReactNode {
  if (sheet.pin.columns === 0) return null;
  const bands: ReactNode[] = [];
  for (let index = 0; index < sheet.pin.columns; index++) {
    const column = columns[index]!;
    if (column.x >= sheet.cellsWidth) break;
    bands.push(band(index, column.x + column.width - 1 - BAND_PADDING, lit === index));
  }
  return h('div', { className: 'bands', style: { left: gutter, width: sheet.cellsWidth, height: sizes.row } }, bands);
}
