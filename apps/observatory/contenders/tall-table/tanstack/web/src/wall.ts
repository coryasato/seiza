/**
 * The monitoring wall's view (the wall level's; `view.ts` lays out its
 * grid, `WallGrid`): N of the contender's tables in one React tree, each
 * its own scroller and TanStack Virtual over a desk's 50 rows, drawn with
 * market watch's rows (`MarketRow`: its cells' text, Chg % by sign, Last's
 * flash). What the tables share, one open's `WallFrame`:
 *
 * - **One commit a frame for every table:** a desk's landed re-reads ask
 *   for a frame, and the frame's callback renders every table whose pages
 *   landed in one `flushSync`, as one canvas draws every table on the
 *   GPUI side; a table with nothing new isn't rendered.
 * - **The marks across the tables** (`docs/contender-contract.md`):
 *   `contender:filled` in the commit that leaves no table unfilled, each
 *   time that becomes true; with `?measure`, one `contender:refreshed` right
 *   after each commit that draws any table's re-read, each table's entry
 *   of `__contenderRefreshed` raised in that commit (`data/wall.ts`); with
 *   `?readout`, the ring pooled across the tables then.
 *
 * `wallCss` holds the grid's numbers (the scenario's) and the phone's one
 * column; `wall.css` the rest. Only the wall level's build draws it: no
 * other level's bundle carries it.
 */

import { flushSync } from 'react-dom';
import { MARKS, nextMark, type Contender, type Replay } from '../../../../contract.ts';
import type { WallScenario } from '../../../../scenarios.ts';
import type { TablePaging } from './data/paging.ts';
import type { TablePage } from './data/table.ts';
import { resolveSizes } from './density.ts';
import { padOf, type LaidOutColumn, type Sizes } from './layout.ts';
import { drawnCells, publishMarketCells, type MarketCells } from './market.ts';

/** gpui-kit's scrollbar room (`Scrollbar::width`), which the tall table
 *  keeps under its rows whether it scrolls sideways or not: a phone's table
 *  is as tall as the GPUI side's (`docs/DECISIONS.md`, "Page";
 *  `crate/src/wall.rs`'s `phone_table`), and every table keeps the same
 *  room under its rows (`keepBarRoom`), so both sides show the same rows. A copy, since this side can't read
 *  gpui-kit's: a bump that moves it moves the GPUI side's tables alone,
 *  which the cross-side check of the grid catches (`perf/wall.ts`). */
const GPUI_SCROLLBAR = 16;
/**
 * Keeps the tall table's scrollbar room under a wall table's rows: the
 * scroller is `GPUI_SCROLLBAR` short of its frame less the height its own
 * horizontal scrollbar takes (none for an overlay bar, or while the columns
 * fit; a classic bar's when they overflow), on `--wall-room` (`wall.css`),
 * so the rows shown are the GPUI side's either way. Measured again whenever
 * the table's frame changes size, which is what makes a bar appear (the
 * columns are fixed). It observes the frame, never the scroller: the room
 * changes the scroller's own height, which inside the scroller's
 * observation is a ResizeObserver loop, and the view's own observer of the
 * scroller (`view.ts`'s `resized`) would read the height before the room.
 * Observing the parent, the scroller's change is deeper, delivered to
 * `resized` in the same frame with the room applied. Returns the stop.
 */
export function keepBarRoom(scroller: HTMLElement): () => void {
  const fit = () => {
    // Twice at most: the room's height can bring a vertical bar in or out,
    // which can bring the horizontal bar in or out.
    for (let pass = 0; pass < 2; pass++) {
      const room = `${Math.max(0, GPUI_SCROLLBAR - (scroller.offsetHeight - scroller.clientHeight))}px`;
      if (scroller.style.getPropertyValue('--wall-room') === room) return;
      scroller.style.setProperty('--wall-room', room);
    }
  };
  const observer = new ResizeObserver(fit);
  observer.observe(scroller.parentElement!);
  fit();
  return () => observer.disconnect();
}

/** The table's 1 px border, top and bottom. */
const BORDERS = 2;

/** A desk's table, as the data layer answers it (`data/wall.ts`). */
export interface WallDesk extends MarketCells {
  /** Its place in the stop's desks: its bit in a batch's mask. */
  desk: number;
  title: string;
  /** The grid's row height and text, as the table's `density` resolves them. */
  sizes: Sizes;
  paging: TablePaging<TablePage>;
}

/** The stop's tables, from the data layer. */
export interface WallData {
  desks: WallDesk[];
  /** Each table's highest generation drawn (`__contenderRefreshed`). */
  drawn: number[];
  /** A commit drew re-reads at `at` (epoch ms): the pooled ring's samples. */
  shown(at: number): void;
}

/** What a desk's table takes from the wall (`view.ts`'s `Table`). */
export interface WallTable {
  cells: WallDesk;
  frame: WallFrame;
}

/** One open's tables, drawn together. */
export class WallFrame {
  /** The stop's tables (`__contender.state.tables`). */
  readonly tables: number;
  private readonly wall: WallData;
  private readonly measured: boolean;
  /** Each table's render, which the frame's callback calls. */
  private readonly renders = new Map<number, () => void>();
  /** The tables whose pages landed since the last frame: only they render. */
  private readonly landed = new Set<number>();
  private frame = 0;
  /** A `contender:refreshed` (and the ring's samples) is queued after the commit. */
  private queued = false;
  /** Each table's visible rows real, at its last check. */
  private readonly filled: boolean[];
  private allFilled = false;

  constructor(wall: WallData, measured: boolean) {
    this.wall = wall;
    this.measured = measured;
    this.filled = wall.desks.map(() => false);
    this.tables = wall.desks.length;
    if (new URLSearchParams(location.search).has('cells')) {
      const contender = (globalThis as { __contender?: { tables?: unknown[] } }).__contender;
      if (contender) contender.tables = wall.desks.map(() => ({}));
    }
  }

  /** Table `desk` renders through `render`, until the returned call. */
  register(desk: number, render: () => void): () => void {
    this.renders.set(desk, render);
    return () => {
      if (this.renders.get(desk) === render) this.renders.delete(desk);
    };
  }

  /** Table `desk`'s page landed: every table with a landed page renders
   *  in the next frame's callback, in one commit. */
  schedule(desk: number): void {
    this.landed.add(desk);
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      // Taken first: a page landing during the commit waits for the next frame.
      const desks = [...this.landed];
      this.landed.clear();
      flushSync(() => {
        for (const desk of desks) this.renders.get(desk)?.();
      });
    });
  }

  /** A table's commit raised its generation drawn: once the commit is
   *  done (a microtask, so every table's raise is in), the ring's samples
   *  and, with `?measure`, `contender:refreshed`, once however many tables
   *  drew a re-read. */
  raised(): void {
    if (this.queued) return;
    this.queued = true;
    queueMicrotask(() => {
      this.queued = false;
      this.wall.shown(performance.timeOrigin + performance.now());
      if (this.measured) performance.mark(MARKS.refreshed);
    });
  }

  /** Table `desk`'s visible rows real or not, at its check: the commit that
   *  leaves no table unfilled marks `contender:filled`. */
  check(desk: number, filled: boolean): void {
    this.filled[desk] = filled;
    const all = this.filled.every(Boolean);
    if (all && !this.allFilled) performance.mark(MARKS.filled);
    this.allFilled = all;
  }

  destroy(): void {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.renders.clear();
    this.landed.clear();
  }
}

/**
 * The grid's numbers as CSS variables (`wall.css` lays the grid out with
 * them): the gap, the title row, the rows' height, text, and padding at
 * the table's density, and a phone's table's height (its title, header,
 * and `phoneRows` rows whole above the scrollbar room the GPUI side
 * keeps); and under `oneColumnBelow` the one column, scrolled (the frame's
 * own width, as the GPUI side's). A style element `main.ts` adds before
 * the view renders.
 */
export function wallCss(scenario: WallScenario): string {
  const { gap, title, rowHeight, textSize, oneColumnBelow, phoneRows } = scenario.grid;
  const sizes = resolveSizes({ rowHeight, text: { px: textSize } });
  const phone = title + sizes.row * (1 + phoneRows) + GPUI_SCROLLBAR + BORDERS;
  return (
    `:root { --wall-gap: ${gap}px; --wall-title: ${title}px; --row: ${sizes.row}px; --wall-text: ${sizes.text}px; --pad: ${padOf(sizes)}px; --wall-bar: ${GPUI_SCROLLBAR}px; --wall-phone: ${phone}px; }\n` +
    `@media (max-width: ${oneColumnBelow - 0.02}px) { .wall { overflow-y: auto; } .wall > .line { display: contents; } .wall .desk { flex: none; height: var(--wall-phone); } }`
  );
}

/**
 * `?cells` on the wall level: table `desk`'s cells on screen as drawn, on
 * `__contender.tables[desk]` (`columns`, and `cells` read from the DOM each
 * time, as market watch's: a flash fades with no render), and where it is
 * in the window, read from the DOM each time, since a phone's column
 * scrolls with no render (`layout`: its cells' `left`, right of the row
 * numbers, `top`, under the header, and `rowHeight`; `box`: its frame,
 * `[x, y, width, height]`), as the GPUI contender's probes publish them;
 * the first table's on `__contender` itself too.
 */
export function publishWallCells(desk: number, scroller: HTMLElement, columns: readonly LaidOutColumn[], gutter: number, rowHeight: number): void {
  const contender = (globalThis as { __contender?: Contender & { tables?: object[] } }).__contender;
  const table = contender?.tables?.[desk];
  if (!table) return;
  Object.assign(table, { columns: columns.map(({ name, x, width, kind }) => ({ name, x, width, kind })) });
  Object.defineProperty(table, 'cells', { configurable: true, enumerable: true, get: () => drawnCells(scroller) });
  Object.defineProperty(table, 'layout', {
    configurable: true,
    enumerable: true,
    get: () => {
      const box = scroller.getBoundingClientRect();
      return { left: box.left + scroller.clientLeft + gutter, top: box.top + scroller.clientTop + rowHeight, rowHeight };
    },
  });
  Object.defineProperty(table, 'box', {
    configurable: true,
    enumerable: true,
    get: () => {
      const { x, y, width, height } = scroller.closest('.frame')!.getBoundingClientRect();
      return [x, y, width, height];
    },
  });
  if (desk === 0) publishMarketCells(scroller, columns);
}

/** The wall's replay: `open()` alone, resolved at the first
 *  `contender:filled` after it (every table filled again); a desk's 50
 *  rows give a fling and a 90% jump no meaning. */
export function wallReplay(reopen: () => Promise<number>): Replay {
  const none = (what: string) => () => Promise.reject(new Error(`the monitoring wall has no ${what}`));
  return {
    open: async () => {
      await reopen();
      // From here: the new tables commit in a later task (the open's
      // render isn't synchronous), and the last open's tables are gone, so
      // no mark of theirs resolves it.
      await nextMark(MARKS.filled, performance.now());
    },
    fling: none('fling'),
    jump: none('jump'),
  };
}
