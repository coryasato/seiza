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
import type { Column, TablePage } from './data/table.ts';
import type { TablePaging } from './data/paging.ts';
import { MARKS, measuring } from '../../../../contract.ts';
import { cellTooltip, shownRow } from './cells.ts';
import { TableContract } from './contract.ts';
import { BASE_SIZES, formatCount, gutterWidth, layOutAll, type LaidOutColumn } from './layout.ts';
import { sceneColumns, type WideScene } from './scene.ts';
import { SCROLL, ScaledScroller } from './scroll.ts';
import { CellTooltip } from './tooltip.ts';
import { EdgeLine, WideHead, WideRow, cellElement, cellRect, publishCells, sheetStyle, useFramePaint, useSheet } from './wide.ts';
import { FlashTurns, MarketRow, publishMarketCells, type MarketCells } from './market.ts';
import { TailReader, TailRow, drawnRows, publishTailCells, renotify, setContractGutter, setModelRows, type TailCells } from './tail.ts';
import { isFollowing, noteTailDrawn } from './data/follow.ts';

/** The rows TanStack Virtual is given around the content's base, not the
 *  full count (its measurements of every row would cost ~30 MiB). */
const WINDOW_ROWS = 4096;

export type Load =
  | { kind: 'waiting'; status: string; failed?: boolean; first?: boolean }
  | { kind: 'open'; id: number; rows: number; columns: Column[]; paging: TablePaging<TablePage>; scene?: LevelScene };

/** What a feature level hands the table: the wide sheet's scene at its
 *  stop, market watch's cells, live tail's cells (`main.ts`). */
export type LevelScene = WideScene | MarketCells | TailCells;

/** The first screen: the build prerenders it into the page's HTML
 *  (`vite.config.ts`), and the page hydrates it. */
export const FIRST_SCREEN: Load = { kind: 'waiting', status: 'Engine loading…', first: true };

/** `?probe`: the table's paging and scroll model as `__tanstackProbe`, for
 *  the parity check (`perf/tanstack-parity.ts`) to read and log; never in a
 *  measured run. Read when a table mounts: the build renders the view in
 *  Node, where there's no `location`. */
const probing = (): boolean => new URLSearchParams(location.search).has('probe');

/** `?cells` (the wide level's): the layout and the cells on screen on
 *  `__contender`, for `perf/wide.ts`. */
const probingCells = (): boolean => new URLSearchParams(location.search).has('cells');

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
        h(Table, { key: load.id, open: load.id, rows: load.rows, columns: load.columns, paging: load.paging, scene: load.scene })
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
  paging: TablePaging<TablePage>;
  /** The level's scene (`main.ts`): the wide sheet's at its stop, market
   *  watch's cells (`data/quotes.ts`). */
  scene?: LevelScene;
}

function Table({ open, rows, columns: fileColumns, paging, scene: given }: TableProps): ReactNode {
  // The wide level's scene: on the base's build, never (its code is dropped).
  const scene = __LEVEL__ === 'wide' ? (given as WideScene | undefined) : undefined;
  const sizes = scene?.sizes ?? BASE_SIZES;
  const rowHeight = sizes.row;
  // The market level's cells, laid out by the data layer (a build constant,
  // so on another level it's nothing).
  const market = __LEVEL__ === 'market' ? (given as MarketCells | undefined) : undefined;
  // Live tail's cells, and its rows: the paging's, which the clock grows
  // (the open's count is 0), so the gutter grows with them.
  const tail = __LEVEL__ === 'tail' ? (given as TailCells | undefined) : undefined;
  if (__LEVEL__ === 'tail') rows = paging.rows;
  const columns = useMemo(() => (scene ? sceneColumns(fileColumns, scene) : __LEVEL__ === 'market' && market ? market.columns : __LEVEL__ === 'tail' && tail ? tail.columns : layOutAll(fileColumns)), [fileColumns, scene]);
  const gutter = gutterWidth(rows, sizes);
  const width = gutter + columns.reduce((sum, column) => sum + column.width, 0);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const spacerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const modelRef = useRef<ScaledScroller | null>(null);
  const tooltipRef = useRef<CellTooltip | null>(null);
  const contractRef = useRef<TableContract | null>(null);
  const [, rerender] = useReducer((count: number) => count + 1, 0);
  const measured = useMemo(measuring, []);
  // The wide level's pin, its scrolled columns, and its paint (a build
  // constant, so the hooks run the same every render).
  const sheet = __LEVEL__ === 'wide' && scene ? useSheet(scrollerRef, columns, scene, gutter) : null;
  const paint = __LEVEL__ === 'wide' && scene ? useFramePaint() : null;
  const sheetRef = useRef(sheet);
  sheetRef.current = sheet;
  const paintRef = useRef(paint);
  paintRef.current = paint;
  // The market level's flashes' turns (a build constant, so the hooks run
  // the same every render).
  const turns = __LEVEL__ === 'market' ? useMemo(() => new FlashTurns(), [paging]) : null;
  const probedCells = __LEVEL__ === 'market' || __LEVEL__ === 'tail' ? useMemo(probingCells, []) : false;
  // Live tail's reader: the scroller's moves deciding following, the pin moving the scroller.
  const readerRef = __LEVEL__ === 'tail' ? useRef<TailReader | null>(null) : null;

  // Before the virtualizer's own layout effects: it subscribes to the model.
  useLayoutEffect(() => {
    const scroller = scrollerRef.current!;
    const model = new ScaledScroller(scroller, spacerRef.current!, contentRef.current!, {
      rows,
      rowHeight,
      head: rowHeight,
      ...SCROLL,
      rebaseRows: WINDOW_ROWS / 4,
      dragSettle: paging.dragSettleMs,
    });
    modelRef.current = model;
    // A scroll in thumb mode is a drag: it loads once it rests or lets go.
    model.onDrag = (dragging) => (dragging ? paging.startDrag() : paging.endDrag());
    // On the wide level, a cell is found by its column's number (its row
    // holds the pinned and the drawn scrolled ones), and a scrolled cell's
    // tooltip sits beside its part right of the run.
    const locate =
      __LEVEL__ === 'wide' && scene
        ? {
            column: (cell: HTMLElement) => Number(cell.dataset.column ?? -1),
            rect: (row: number, column: number) => (sheetRef.current ? cellRect(scroller, sheetRef.current, gutter, row, column) : null),
          }
        : undefined;
    tooltipRef.current = new CellTooltip(scroller, (row, column) => {
      const state = paging.row(row);
      if (state.kind !== 'loaded') return undefined;
      const laidOut = columns[column];
      const tooltip = laidOut ? cellTooltip(laidOut, state.page.value(state.index, column)) : null;
      if (!tooltip) return null;
      // The market level: a fitted text opens it only where the format
      // rounded it; a fallback is judged as the base's (`tooltip_for`).
      // `market` is the open's, as the effect's other inputs are.
      if (__LEVEL__ === 'market' && market) {
        const rounded = market.rounded(column, laidOut!, row, state.page.value(state.index, column)!);
        if (rounded !== null) return rounded ? tooltip.text : null;
      }
      if (tooltip.differs) return tooltip.text;
      // Cut: the text is wider than its cell's room, measured unrounded
      // (`scrollWidth` rounds, and missed text over by under a pixel).
      const cell = __LEVEL__ === 'wide' && scene ? cellElement(scroller, row, column) : scroller.querySelector(`.row[data-row="${row}"]`)?.children[column + 1];
      return cell && isCut(cell) ? tooltip.text : null;
    }, locate);
    if (probing()) (globalThis as { __tanstackProbe?: unknown }).__tanstackProbe = { paging, model };
    // `?cells` on the wide level: the layout and the cells on screen, after each check.
    const probe =
      __LEVEL__ === 'wide' && scene && probingCells()
        ? () => {
            const shown = sheetRef.current;
            const heat = paintRef.current?.heat;
            if (!shown || !heat) return;
            publishCells(scroller, columns, shown, gutter, scene, heat, (row) => {
              const state = paging.row(row);
              return state.kind === 'loaded' ? { page: state.page, index: state.index } : null;
            });
          }
        : __LEVEL__ === 'market' && probingCells()
          ? () => publishMarketCells(scroller, columns)
          : __LEVEL__ === 'tail' && probingCells()
            ? () => publishTailCells(scroller, columns)
            : undefined;
    const contract = new TableContract(open, paging, model, scroller, columns, gutter, measured, rowHeight, probe);
    contractRef.current = contract;
    // Subscribed before the virtualizer, whose render checks.
    model.subscribe(() => contract.moveStarted());
    // The first viewport is the open's: it loads the first pages.
    paging.setViewportRows(model.viewport / rowHeight);
    // Live tail's: the reader's moves decide following before the paging moves.
    if (__LEVEL__ === 'tail') readerRef!.current = new TailReader(paging, model, scroller, rowHeight);
    const unsubscribe = model.subscribe(__LEVEL__ === 'tail' ? (v) => readerRef!.current!.moved(v) : (v) => paging.moveTopTo(v / rowHeight));
    const resized = new ResizeObserver(() => {
      // Live tail's: the resize is the view's own move; the paging keeps
      // its top, or while following its bottom, and the scroller follows.
      if (__LEVEL__ === 'tail') {
        const reader = readerRef!.current!;
        reader.asOwn(() => model.resize());
        paging.setViewportRows(model.viewport / rowHeight);
        reader.sync();
        return;
      }
      model.resize();
      paging.setViewportRows(model.viewport / rowHeight);
    });
    resized.observe(scroller);
    scroller.focus({ preventScroll: true });
    rerender();
    return () => {
      contractRef.current?.destroy();
      contractRef.current = null;
      resized.disconnect();
      unsubscribe();
      if (__LEVEL__ === 'tail') {
        readerRef!.current?.destroy();
        readerRef!.current = null;
      }
      tooltipRef.current?.destroy();
      tooltipRef.current = null;
      model.destroy();
      modelRef.current = null;
    };
  }, [open, __LEVEL__ === 'tail' ? 0 : rows, paging, columns, __LEVEL__ === 'tail' ? 0 : gutter, measured, rowHeight, scene]);

  // The contract after each commit, and after each move that rendered
  // nothing (the rows were drawn already). Subscribed after the
  // virtualizer, whose subscriber renders first.
  useLayoutEffect(() => contractRef.current?.check());
  useEffect(() => modelRef.current?.subscribe(() => contractRef.current?.moveEnded()), [open, __LEVEL__ === 'tail' ? 0 : rows, paging, columns, __LEVEL__ === 'tail' ? 0 : gutter, measured, rowHeight, scene]);
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
  // The market level: a page landed (a re-read, nearly every frame under the
  // feed) draws once a frame, in the frame's own callback, the rows it
  // changed rendering in that frame; and with `?measure`, the commit that
  // first draws a re-read raises `__contenderRefreshed` and marks
  // `contender:refreshed` (Shown in's mark, `docs/contender-contract.md`).
  if (__LEVEL__ === 'market') {
    useEffect(() => {
      let frame = 0;
      paging.onChange = () => {
        landed.current = true;
        if (!frame)
          frame = requestAnimationFrame(() => {
            frame = 0;
            flushSync(rerender);
          });
      };
      return () => {
        cancelAnimationFrame(frame);
        paging.onChange = () => {};
      };
    }, [paging]);
    useLayoutEffect(() => {
      if (!market || !(measured || market.readout)) return;
      const drawn = market.refreshed();
      if (drawn === null || !measured) return;
      (globalThis as { __contenderRefreshed?: number }).__contenderRefreshed = drawn;
      performance.mark(MARKS.refreshed);
    });
  }

  // Live tail's: a landing (a page or a re-read, the pin moving on) and
  // each count the clock sets draw once a frame, in the frame's callback:
  // the model takes the rows and the scroller follows the paging's top
  // (the pin), then the rows render. With `?measure`, the commit whose
  // drawn tail grew while following (every visible row drawn with its
  // values) sets `__contenderTail` and marks `contender:tail`, Row shown
  // in's mark, and following is on `__contenderFollowing`
  // (`docs/contender-contract.md`).
  if (__LEVEL__ === 'tail') {
    useEffect(() => {
      let frame = 0;
      const draw = () => {
        if (frame) return;
        frame = requestAnimationFrame(() => {
          frame = 0;
          const model = modelRef.current;
          const reader = readerRef!.current;
          // A shrink's clamp is the view's own move, never the reader's.
          if (model && reader) reader.asOwn(() => setModelRows(model, paging.rows));
          reader?.sync();
          // The window of rows TanStack Virtual is given moves with the
          // rows: it hears the model again (and renders, if the window
          // moved), else the rows render here.
          const drawn = rendered.current;
          if (model && windowBase() !== drawn.window) renotify(model);
          if (rendered.current === drawn) flushSync(rerender);
        });
      };
      paging.onChange = () => {
        landed.current = true;
        draw();
      };
      const global = globalThis as { __contenderFollowing?: boolean };
      if (tail) {
        tail.rows = draw;
        tail.following = (on) => {
          if (measured) global.__contenderFollowing = on;
        };
      }
      if (measured) global.__contenderFollowing = isFollowing(paging);
      return () => {
        cancelAnimationFrame(frame);
        paging.onChange = () => {};
        if (tail) tail.rows = tail.following = () => {};
      };
    }, [paging]);
    useLayoutEffect(() => {
      if (contractRef.current) setContractGutter(contractRef.current, gutter);
      const model = modelRef.current;
      if (!measured || !model) return;
      // The rows this commit drew (the model's), not the paging's, which a
      // landing's pin can move ahead of them until the next draw.
      const [first, end] = drawnRows(model, rowHeight);
      if (end <= first) return;
      for (let row = first; row < end; row++) if (paging.row(row).kind !== 'loaded') return;
      if (!noteTailDrawn(paging, end)) return;
      (globalThis as { __contenderTail?: number }).__contenderTail = end;
      performance.mark(MARKS.tail);
    });
  }

  // The window's base and the content's, as last rendered.
  const rendered = useRef({ window: 0, content: 0 });
  const windowBase = (): number => {
    const model = modelRef.current;
    if (!model) return 0;
    // Live tail's rows grow: the paging's count, not this render's (the
    // virtualizer keeps the first render's subscription).
    return Math.max(0, Math.min((__LEVEL__ === 'tail' ? paging.rows : rows) - WINDOW_ROWS, model.base - WINDOW_ROWS / 2));
  };

  const virtualizer = useVirtualizer({
    count: Math.min(rows, WINDOW_ROWS),
    getScrollElement: () => scrollerRef.current,
    estimateSize: () => rowHeight,
    overscan: 4,
    observeElementOffset: (_instance, notify) =>
      modelRef.current?.subscribe((v, scrolling) => {
        const base = windowBase();
        notify(v - base * rowHeight, scrolling);
        // Rows are placed against the content's base, and a moved window
        // shifts their indexes: either can change while TanStack's range
        // doesn't, and then it skips the render. Make it.
        const model = modelRef.current;
        if (model && (base !== rendered.current.window || model.base !== rendered.current.content)) flushSync(rerender);
      }),
    scrollToFn: (offset) => modelRef.current?.jumpTo(offset + windowBase() * rowHeight),
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
          if (__LEVEL__ === 'tail' && tail)
            return h(TailRow, {
              key: row,
              row,
              top: (row - model.base) * rowHeight,
              page: state.kind === 'loaded' ? state.page : null,
              index: state.kind === 'loaded' ? state.index : 0,
              failed: state.kind === 'failed' ? state.message : null,
              columns,
              gutter,
              measured,
              probed: probedCells,
              cells: tail,
            });
          if (__LEVEL__ === 'market' && market && turns)
            return h(MarketRow, {
              key: row,
              row,
              top: (row - model.base) * rowHeight,
              page: state.kind === 'loaded' ? state.page : null,
              index: state.kind === 'loaded' ? state.index : 0,
              quote: state.kind === 'loaded' ? market.quoteOf(state.page, state.index) : undefined,
              failed: state.kind === 'failed' ? state.message : null,
              columns,
              gutter,
              measured,
              probed: probedCells,
              market,
              turns,
            });
          if (__LEVEL__ === 'wide' && sheet && paint && scene)
            return h(WideRow, {
              key: row,
              row,
              top: (row - model.base) * rowHeight,
              page: state.kind === 'loaded' ? state.page : null,
              index: state.kind === 'loaded' ? state.index : 0,
              failed: state.kind === 'failed' ? state.message : null,
              columns,
              pinned: sheet.pin.columns,
              first: sheet.first,
              last: sheet.last,
              gap: sheet.gap,
              gutter,
              scene,
              frame: paint.frame,
              heat: paint.heat,
              measured,
            });
          return h(Row, {
            key: row,
            row,
            top: (row - model.base) * rowHeight,
            page: state.kind === 'loaded' ? state.page : null,
            index: state.kind === 'loaded' ? state.index : 0,
            failed: state.kind === 'failed' ? state.message : null,
            columns,
            gutter,
            measured,
          });
        })
    : [];

  if (__LEVEL__ === 'wide' && sheet && scene)
    return h(
      'div',
      { className: 'frame wide', style: sheetStyle(sizes) },
      h(
        'div',
        { ref: scrollerRef, className: 'scroller', tabIndex: 0 },
        h(WideHead, { columns, sheet, gutter, width, sizes }),
        h('div', { ref: spacerRef, className: 'spacer', style: { width } }, h('div', { ref: contentRef, className: 'content' }, shown)),
      ),
      h(EdgeLine, { sheet, gutter }),
    );
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
  page: TablePage | null;
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
