/**
 * The TanStack contender's view: the table's frame with one status line
 * until the file is open (the GPUI contender's first frame), then the
 * table: a native scroller under the scroll model (`scroll.ts`), its rows
 * laid out by TanStack Virtual over a moving window of rows
 * (`docs/dom-scroll-model.md`, "TanStack Virtual over a moving window"),
 * their text from the data layer's paging.
 */

import { createElement as h, memo, useEffect, useLayoutEffect, useMemo, useReducer, useRef, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { ArrowPage, Column } from './data/table.ts';
import type { TablePaging } from './data/paging.ts';
import { shownRow } from './cells.ts';
import { ROW_HEIGHT, formatCount, gutterWidth, layOut, type LaidOutColumn } from './layout.ts';
import { SCROLL, ScaledScroller } from './scroll.ts';

/** The rows TanStack Virtual is given around the content's base, not the
 *  full count (its measurements of every row would cost ~30 MiB). */
const WINDOW_ROWS = 4096;

export type Load =
  | { kind: 'waiting'; status: string; failed?: boolean }
  | { kind: 'open'; id: number; rows: number; columns: Column[]; paging: TablePaging<ArrowPage> };

export function App({ load }: { load: Load }): ReactNode {
  return h(
    'div',
    { className: 'page' },
    load.kind === 'open'
      ? // Keyed by the paging: a new open is a new table, model, and virtualizer.
        h(Table, { key: load.id, rows: load.rows, columns: load.columns, paging: load.paging })
      : h('div', { className: `frame status${load.failed ? ' failed' : ''}` }, load.status),
  );
}

interface TableProps {
  rows: number;
  columns: Column[];
  paging: TablePaging<ArrowPage>;
}

function Table({ rows, columns: fileColumns, paging }: TableProps): ReactNode {
  const columns = useMemo(() => fileColumns.map(layOut), [fileColumns]);
  const gutter = gutterWidth(rows);
  const width = gutter + columns.reduce((sum, column) => sum + column.width, 0);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const spacerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const modelRef = useRef<ScaledScroller | null>(null);
  const [, rerender] = useReducer((count: number) => count + 1, 0);

  // Before the virtualizer's own layout effects: it subscribes to the model.
  useLayoutEffect(() => {
    const scroller = scrollerRef.current!;
    const model = new ScaledScroller(scroller, spacerRef.current!, contentRef.current!, {
      rows,
      rowHeight: ROW_HEIGHT,
      head: ROW_HEIGHT,
      ...SCROLL,
      rebaseRows: WINDOW_ROWS / 4,
    });
    modelRef.current = model;
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
      resized.disconnect();
      unsubscribe();
      model.destroy();
      modelRef.current = null;
    };
  }, [rows, paging]);

  // A page landed or failed: its rows redraw.
  useEffect(() => {
    paging.onChange = rerender;
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
}

const Row = memo(function Row({ row, top, page, index, failed, columns, gutter }: RowProps): ReactNode {
  const shown = shownRow(page ? { kind: 'loaded', page, index } : failed !== null ? { kind: 'failed', message: failed } : { kind: 'pending' }, columns);
  let cells: ReactNode;
  if (shown.kind === 'failed') {
    cells = h('div', { className: 'failed', style: { left: gutter } }, `Couldn't load these rows: ${shown.message}`);
  } else if (shown.kind === 'pending') {
    cells = columns.map((column) =>
      h('div', { key: column.name, className: `cell pending ${column.align}`, style: { width: column.width } }, h('div', { className: 'bar' })),
    );
  } else {
    cells = columns.map((column, index) => {
      const cell = shown.cells[index] ?? null;
      return h(
        'div',
        { key: column.name, className: `cell ${column.align}${cell?.muted ? ' null' : ''}`, style: { width: column.width } },
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
