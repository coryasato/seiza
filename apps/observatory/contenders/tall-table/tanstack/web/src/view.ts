/**
 * The TanStack contender's view: the table's frame with one status line
 * until the file is open (the GPUI contender's first frame), then the
 * table: a native scroller under the scroll model (`scroll.ts`), its rows
 * laid out by TanStack Virtual over a moving window of rows
 * (`docs/dom-scroll-model.md`, "TanStack Virtual over a moving window"),
 * their text from the data layer's paging, a rounded or cut value's exact
 * text in a tooltip (`tooltip.ts`).
 */

import { createElement as h, memo, useEffect, useLayoutEffect, useMemo, useReducer, useRef, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { ArrowPage, Column } from './data/table.ts';
import type { TablePaging } from './data/paging.ts';
import { MARKS, measuring } from '../../../../contract.ts';
import { cellTooltip, shownRow } from './cells.ts';
import { TableContract } from './contract.ts';
import { ROW_HEIGHT, formatCount, gutterWidth, layOut, type LaidOutColumn } from './layout.ts';
import { SCROLL, ScaledScroller } from './scroll.ts';
import { CellTooltip } from './tooltip.ts';

/** The rows TanStack Virtual is given around the content's base, not the
 *  full count (its measurements of every row would cost ~30 MiB). */
const WINDOW_ROWS = 4096;

export type Load =
  | { kind: 'waiting'; status: string; failed?: boolean; first?: boolean }
  | { kind: 'open'; id: number; rows: number; columns: Column[]; paging: TablePaging<ArrowPage> };

/** The first screen: the build prerenders it into the page's HTML
 *  (`vite.config.ts`), and the page hydrates it. */
export const FIRST_SCREEN: Load = { kind: 'waiting', status: 'Engine loading…', first: true };

/** `?probe`: the table's paging and scroll model as `__tanstackProbe`, for
 *  the parity check (`perf/tanstack-parity.ts`) to read and log; never in a
 *  measured run. Read when a table mounts: the build renders the view in
 *  Node, where there's no `location`. */
const probing = (): boolean => new URLSearchParams(location.search).has('probe');

interface AppProps {
  load: Load;
  /** Called in the first commit: the hydration of the prerendered screen. */
  hydrated?: () => void;
}

export function App({ load, hydrated }: AppProps): ReactNode {
  useLayoutEffect(() => hydrated?.(), []);
  return h(
    'div',
    {
      className: 'page',
      // With the table open, a press outside it leaves the focus where it
      // is, as in GPUI, which has no blur on a press: the table keeps its
      // keys and its ring. (A status line stays selectable.)
      onMouseDown: (event: { target: EventTarget; preventDefault(): void }) => {
        if (load.kind === 'open' && !(event.target as Element).closest('.scroller')) event.preventDefault();
      },
    },
    load.kind === 'open'
      ? // Keyed by the paging: a new open is a new table, model, and virtualizer.
        h(Table, { key: load.id, open: load.id, rows: load.rows, columns: load.columns, paging: load.paging })
      : // Element Timing on the first screen's line (only the first: a later
        // status line, after a reopen, is a new element): its paint is
        // `contender:first-pixels`.
        h('div', { className: `frame status${load.failed ? ' failed' : ''}`, elementtiming: load.first ? 'first-screen' : undefined }, load.status),
    h(ProbeKey),
  );
}

/**
 * The probe key (`?measure` only): the first key the page gets changes this
 * component's state (nothing else renders), and the commit that draws it
 * marks `contender:input`. The listener is added in the hydration commit,
 * so a key before it changes nothing: the scripts confirm
 * `contender:usable` with a key right after it
 * (`docs/contender-contract.md`, "Marks"). Later keys cost nothing.
 */
function ProbeKey(): ReactNode {
  const [pressed, press] = useReducer(() => true, false);
  useLayoutEffect(() => {
    if (!measuring()) return;
    window.addEventListener('keydown', press, { capture: true, once: true });
    return () => window.removeEventListener('keydown', press, { capture: true });
  }, []);
  useLayoutEffect(() => {
    if (pressed) performance.mark(MARKS.input);
  }, [pressed]);
  return pressed ? h('span', { hidden: true, 'data-probe-key': '' }) : null;
}

interface TableProps {
  open: number;
  rows: number;
  columns: Column[];
  paging: TablePaging<ArrowPage>;
}

function Table({ open, rows, columns: fileColumns, paging }: TableProps): ReactNode {
  const columns = useMemo(() => fileColumns.map(layOut), [fileColumns]);
  const gutter = gutterWidth(rows);
  const width = gutter + columns.reduce((sum, column) => sum + column.width, 0);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const spacerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const modelRef = useRef<ScaledScroller | null>(null);
  const tooltipRef = useRef<CellTooltip | null>(null);
  const contractRef = useRef<TableContract | null>(null);
  const [, rerender] = useReducer((count: number) => count + 1, 0);
  const measured = useMemo(measuring, []);

  // Before the virtualizer's own layout effects: it subscribes to the model.
  useLayoutEffect(() => {
    const scroller = scrollerRef.current!;
    const model = new ScaledScroller(scroller, spacerRef.current!, contentRef.current!, {
      rows,
      rowHeight: ROW_HEIGHT,
      head: ROW_HEIGHT,
      ...SCROLL,
      rebaseRows: WINDOW_ROWS / 4,
      dragSettle: paging.dragSettleMs,
    });
    modelRef.current = model;
    // A scroll in thumb mode is a drag: it loads once it rests or lets go.
    model.onDrag = (dragging) => (dragging ? paging.startDrag() : paging.endDrag());
    tooltipRef.current = new CellTooltip(scroller, (row, column) => {
      const state = paging.row(row);
      if (state.kind !== 'loaded') return undefined;
      const laidOut = columns[column];
      const tooltip = laidOut ? cellTooltip(laidOut, state.page.value(state.index, column)) : null;
      if (!tooltip) return null;
      if (tooltip.differs) return tooltip.text;
      // Cut: the text is wider than its cell's room, measured unrounded
      // (`scrollWidth` rounds, and missed text over by under a pixel).
      const cell = scroller.querySelector(`.row[data-row="${row}"]`)?.children[column + 1];
      return cell && isCut(cell) ? tooltip.text : null;
    });
    if (probing()) (globalThis as { __tanstackProbe?: unknown }).__tanstackProbe = { paging, model };
    const contract = new TableContract(open, paging, model, scroller, columns, gutter, measured);
    contractRef.current = contract;
    // Subscribed before the virtualizer, whose render checks.
    model.subscribe(() => contract.moveStarted());
    // The first viewport is the open's: it loads the first pages.
    paging.setViewportRows(model.viewport / ROW_HEIGHT);
    const unsubscribe = model.subscribe((v) => paging.moveTopTo(v / ROW_HEIGHT));
    const resized = new ResizeObserver(() => {
      model.resize();
      paging.setViewportRows(model.viewport / ROW_HEIGHT);
    });
    resized.observe(scroller);
    scroller.focus({ preventScroll: true });
    rerender();
    return () => {
      contractRef.current?.destroy();
      contractRef.current = null;
      resized.disconnect();
      unsubscribe();
      tooltipRef.current?.destroy();
      tooltipRef.current = null;
      model.destroy();
      modelRef.current = null;
    };
  }, [open, rows, paging, columns, gutter, measured]);

  // The contract after each commit, and after each move that rendered
  // nothing (the rows were drawn already). Subscribed after the
  // virtualizer, whose subscriber renders first.
  useLayoutEffect(() => contractRef.current?.check());
  useEffect(() => modelRef.current?.subscribe(() => contractRef.current?.moveEnded()), [open, rows, paging, columns, gutter, measured]);
  // The table gone (a new open replaced it): its reads and timers stop.
  useEffect(() => () => paging.close(), [paging]);

  // A page landed under a rested pointer: once its rows are drawn, its
  // tooltip is decided. Not after every render: a fling forces many.
  const landed = useRef(false);
  useEffect(() => {
    if (!landed.current) return;
    landed.current = false;
    tooltipRef.current?.refresh();
  });

  // A page landed or failed: its rows redraw.
  useEffect(() => {
    paging.onChange = () => {
      landed.current = true;
      rerender();
    };
    return () => {
      paging.onChange = () => {};
    };
  }, [paging]);

  // The window's base and the content's, as last rendered.
  const rendered = useRef({ window: 0, content: 0 });
  const windowBase = (): number => {
    const model = modelRef.current;
    if (!model) return 0;
    return Math.max(0, Math.min(rows - WINDOW_ROWS, model.base - WINDOW_ROWS / 2));
  };

  const virtualizer = useVirtualizer({
    count: Math.min(rows, WINDOW_ROWS),
    getScrollElement: () => scrollerRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 4,
    observeElementOffset: (_instance, notify) =>
      modelRef.current?.subscribe((v, scrolling) => {
        const base = windowBase();
        notify(v - base * ROW_HEIGHT, scrolling);
        // Rows are placed against the content's base, and a moved window
        // shifts their indexes: either can change while TanStack's range
        // doesn't, and then it skips the render. Make it.
        const model = modelRef.current;
        if (model && (base !== rendered.current.window || model.base !== rendered.current.content)) flushSync(rerender);
      }),
    scrollToFn: (offset) => modelRef.current?.jumpTo(offset + windowBase() * ROW_HEIGHT),
  });

  const model = modelRef.current;
  const base = windowBase();
  rendered.current = { window: base, content: model?.base ?? 0 };
  const shown = model
    ? virtualizer
        .getVirtualItems()
        .map((item) => base + item.index)
        .filter((row) => row < rows)
        .map((row) => {
          const state = paging.row(row);
          return h(Row, {
            key: row,
            row,
            top: (row - model.base) * ROW_HEIGHT,
            page: state.kind === 'loaded' ? state.page : null,
            index: state.kind === 'loaded' ? state.index : 0,
            failed: state.kind === 'failed' ? state.message : null,
            columns,
            gutter,
            measured,
          });
        })
    : [];

  return h(
    'div',
    { className: 'frame' },
    h(
      'div',
      { ref: scrollerRef, className: 'scroller', tabIndex: 0 },
      h(Head, { columns, gutter, width }),
      h('div', { ref: spacerRef, className: 'spacer', style: { width } }, h('div', { ref: contentRef, className: 'content' }, shown)),
    ),
  );
}

/** Whether a cell's text is wider than the room inside its padding. */
function isCut(cell: Element): boolean {
  const range = document.createRange();
  range.selectNodeContents(cell);
  const style = getComputedStyle(cell);
  const room = cell.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  return range.getBoundingClientRect().width > room;
}

/** The header: sticky at the top, scrolled sideways with the rows. */
function Head({ columns, gutter, width }: { columns: LaidOutColumn[]; gutter: number; width: number }): ReactNode {
  return h(
    'div',
    { className: 'head', style: { width } },
    h('div', { className: 'num', style: { width: gutter } }),
    columns.map((column) => h('div', { key: column.name, className: `cell ${column.align}`, style: { width: column.width } }, column.name)),
  );
}

/** A row, by its page and its index in it (null and no failure: not
 *  loaded yet). Every prop is a value or a stable object, so a row whose
 *  page and place haven't changed skips its render while the others scroll. */
interface RowProps {
  row: number;
  top: number;
  page: ArrowPage | null;
  index: number;
  failed: string | null;
  columns: LaidOutColumn[];
  gutter: number;
  /** `?measure`: loaded cells carry `elementtiming`, so their paint is
   *  reported (`docs/contender-contract.md`, "Reading the metrics"). */
  measured: boolean;
}

const Row = memo(function Row({ row, top, page, index, failed, columns, gutter, measured }: RowProps): ReactNode {
  const shown = shownRow(page ? { kind: 'loaded', page, index } : failed !== null ? { kind: 'failed', message: failed } : { kind: 'pending' }, columns);
  let cells: ReactNode;
  if (shown.kind === 'failed') {
    cells = h('div', { className: 'failed', style: { left: gutter } }, `Couldn't load these rows: ${shown.message}`);
  } else if (shown.kind === 'pending') {
    // Keyed apart from the loaded cells, so a row that loads gets new cells,
    // which Element Timing reports: it never reports a cell changed in place.
    cells = columns.map((column) =>
      h('div', { key: `pending:${column.name}`, className: `cell pending ${column.align}`, style: { width: column.width } }, h('div', { className: 'bar' })),
    );
  } else {
    cells = columns.map((column, index) => {
      const cell = shown.cells[index] ?? null;
      return h(
        'div',
        { key: column.name, className: `cell ${column.align}${cell?.muted ? ' null' : ''}`, style: { width: column.width }, elementtiming: measured ? `row:${row}` : undefined },
        cell?.text,
      );
    });
  }
  return h(
    'div',
    { className: row % 2 === 1 ? 'row odd' : 'row', 'data-row': row, style: { transform: `translateY(${top}px)` } },
    h('div', { className: 'num', style: { width: gutter } }, formatCount(row + 1)),
    cells,
  );
});
