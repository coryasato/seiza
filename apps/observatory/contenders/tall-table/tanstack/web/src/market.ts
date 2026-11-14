/**
 * Market watch's view (the market level's, `view.ts` draws it there): its
 * rows, memoized by their quotes, so only a row a tick moved renders; each
 * cell's text, its sign's color on Change and Change %, and the flash on
 * the scenario's columns, as `MarketCells` (the data layer's `quotes.ts`)
 * answers them. The flash is the cell's own background by CSS keyframes
 * (`market.css`): fading linearly from the rise's or the fall's color at
 * the scenario's mix to nothing over its ms, restarted on a new change by
 * alternating two animations of the same keyframes. With `?cells`, the
 * cells on screen as drawn (`publishMarketCells`), as the GPUI contender's
 * probe publishes them.
 *
 * Only the market level's build draws it: no other level's bundle carries it.
 */

import { createElement as h, memo, type ReactNode } from 'react';
import type { MarketScenario, Oklch } from '../../../../scenarios.ts';
import type { Contender } from '../../../../contract.ts';
import { exactText, type CellValue } from './data/format.ts';
import type { TablePage } from './data/table.ts';
import { GUTTER_ARIA, rowAria } from './aria.ts';
import { formatCount, type LaidOutColumn } from './layout.ts';
import { fromOklab, fromOklch, oklab, parseComputed, type Rgba } from './paint.ts';
import { hex, themeCss } from './scene.ts';

/** A change's sign, as Change and Change % are drawn: a rise, a fall, or
 *  null (a zero, in the foreground). */
export type Tone = 'up' | 'down' | null;

/** What the view asks of the market level's data layer (`quotes.ts`). */
export interface MarketCells {
  /** The file's columns laid out (the format's room is theirs). */
  columns: LaidOutColumn[];
  /** The columns that flash, by index. */
  flashing: readonly number[];
  /** A loaded, non-NULL cell's text in `column` (index `index`) of `row`. */
  text(index: number, column: LaidOutColumn, row: number, value: CellValue): string;
  /** Whether the format rounded the cell's fitted text (its tooltip opens
   *  only then; a dressed one, `84.20`, opens none), or null for a cell
   *  drawn in the automatic format, judged as the base's (the table's
   *  `tooltip_for` under `format`). */
  rounded(index: number, column: LaidOutColumn, row: number, value: CellValue): boolean | null;
  /** The cell's color by its sign (Change and Change % only). */
  tone(index: number, value: CellValue | undefined): Tone;
  /** The cell's flash at `now`: its place in the ramp (a fall 0, a rise 1)
   *  and when it started; null for none. */
  flash(row: number, column: number, now: number): { at: number; start: number } | null;
  /** The quote a page's row reads (a page from the store), whose identity
   *  changes only with a tick: what the row is memoized by. */
  quoteOf(page: TablePage, index: number): object | undefined;
  /** The highest re-read generation drawn, raised by the re-reads landed
   *  since the last call over the visible rows; null if none raised it. */
  refreshed(): number | null;
  /** The frame keeps this tab's Shown in (`?readout`): `refreshed` runs at
   *  every commit then, measured or not. */
  readout: boolean;
}

/** `rgb(r g b / alpha)`, the channels unrounded. */
const rgbAlpha = (color: Rgba, alpha: number): string => `rgb(${[color.r, color.g, color.b].map((channel) => (channel * 255).toFixed(3)).join(' ')} / ${alpha})`;

/**
 * The scenario's rise and fall per theme as CSS variables (`--up`,
 * `--down`; their flash at the mix, `--flash-up`, `--flash-down`, and the
 * ramp's middle for any other change, `--flash-mid`, mixed in Oklab) and
 * the flash's ms (`--flash-ms`), light and dark as `theme.css` switches its
 * own: converted from Oklch to sRGB here, once, so the browser resolves
 * them with no conversion (as `scene.ts`'s heat). A style element
 * `main.ts` adds before the view renders.
 */
export function marketCss(scenario: Pick<MarketScenario, 'signs' | 'flash'>): string {
  const { mix, ms } = scenario.flash;
  const block = (theme: 'light' | 'dark') => {
    const [up, down] = [scenario.signs[theme].up, scenario.signs[theme].down].map((color: Oklch) => fromOklch(...color));
    const [a, b] = [oklab(down!), oklab(up!)];
    const mid = fromOklab({ l: (a.l + b.l) / 2, a: (a.a + b.a) / 2, b: (a.b + b.b) / 2, alpha: 1 });
    return `--up: ${hex(up!)}; --down: ${hex(down!)}; --flash-up: ${rgbAlpha(up!, mix)}; --flash-down: ${rgbAlpha(down!, mix)}; --flash-mid: ${rgbAlpha(mid, mix)};`;
  };
  return `:root { --flash-ms: ${ms}ms; }\n${themeCss(block)}`;
}

/** Each flashing cell's animation's turn: a new flash (a new start) flips
 *  it, so the cell's animation name changes and the fade starts over. */
export class FlashTurns {
  private readonly turns = new Map<number, { start: number; turn: boolean }>();

  /** `row`'s cell in `column` flashing since `start`: `a` or `b`. */
  turn(row: number, column: number, start: number): 'a' | 'b' {
    const key = row * 65_536 + column;
    const last = this.turns.get(key);
    if (!last) this.turns.set(key, { start, turn: false });
    else if (last.start !== start) {
      last.start = start;
      last.turn = !last.turn;
    }
    return this.turns.get(key)!.turn ? 'b' : 'a';
  }
}

interface MarketRowProps {
  row: number;
  top: number;
  page: TablePage | null;
  index: number;
  /** The row's quote, when its page is the store's: the row renders only
   *  when it changes (a tick moved it), whatever page it's read from. */
  quote: object | undefined;
  failed: string | null;
  columns: LaidOutColumn[];
  gutter: number;
  measured: boolean;
  /** `?cells`: each loaded cell carries the exact text of the value it drew
   *  (`data-exact`), so the probe reads what's on screen, not a page that
   *  landed since. */
  probed: boolean;
  market: MarketCells;
  turns: FlashTurns;
}

/** Whether a row draws the same: by its quote when the store's, else by
 *  its page and place, as the base's rows. */
const sameRow = (a: MarketRowProps, b: MarketRowProps): boolean =>
  a.row === b.row &&
  a.top === b.top &&
  a.failed === b.failed &&
  a.columns === b.columns &&
  a.gutter === b.gutter &&
  a.measured === b.measured &&
  a.probed === b.probed &&
  a.market === b.market &&
  a.turns === b.turns &&
  (a.quote !== undefined || b.quote !== undefined ? a.quote === b.quote : a.page === b.page && a.index === b.index);

const flashName = (at: number): string => (at === 1 ? 'up' : at === 0 ? 'down' : 'mid');

/** A market watch row: the base's row, its cells' text, sign, and flash
 *  the market level's. */
export const MarketRow = /* @__PURE__ */ memo(function MarketRow({ row, top, page, index, failed, columns, gutter, measured, probed, market, turns }: MarketRowProps): ReactNode {
  let cells: ReactNode;
  if (failed !== null) {
    cells = h('div', { className: 'failed', style: { left: gutter }, role: 'cell' }, `Couldn't load these rows: ${failed}`);
  } else if (!page) {
    // Keyed apart from the loaded cells, as the base's.
    cells = columns.map((column) =>
      h('div', { key: `pending:${column.name}`, className: `cell pending ${column.align}`, style: { width: column.width }, role: 'cell' }, h('div', { className: 'bar' })),
    );
  } else {
    const now = performance.now();
    cells = columns.map((column, at) => {
      const value = page.value(index, at);
      let className = `cell ${column.align}`;
      let text: string | undefined;
      if (value === null) {
        className += ' null';
        text = 'NULL';
      } else if (value !== undefined) {
        text = market.text(at, column, row, value);
        const tone = market.tone(at, value);
        if (tone) className += ` ${tone}`;
        const flash = market.flashing.includes(at) ? market.flash(row, at, now) : null;
        if (flash) className += ` f-${flashName(flash.at)}-${turns.turn(row, at, flash.start)}`;
      }
      const exact = !probed || value === undefined ? undefined : value === null ? 'NULL' : typeof value === 'number' && column.kind === 'float' ? exactText(value) : String(value);
      return h('div', { key: column.name, className, style: { width: column.width }, role: 'cell', elementtiming: measured ? `row:${__LEVEL__ === 'wall' ? wallRow(market, row) : row}` : undefined, 'data-exact': exact }, text);
    });
  }
  return h(
    'div',
    { className: row % 2 === 1 ? 'row odd' : 'row', 'data-row': row, style: { transform: `translateY(${top}px)` }, ...rowAria(row) },
    h('div', { className: 'num', style: { width: gutter }, ...GUTTER_ARIA }, formatCount(row + 1)),
    cells,
  );
}, sameRow);

/** On the wall, a cell's Element Timing row: its instrument's (table t's
 *  row r is 50t + r, the contract's numbering), unique across the tables. */
const wallRow = (market: MarketCells, row: number): number => {
  const { desk, paging } = market as MarketCells & { desk: number; paging: { rows: number } };
  return desk * paging.rows + row;
};

/** A computed color as 8-bit channels, the alpha too. */
const rgba8 = (color: string): number[] => {
  const { r, g, b, a } = parseComputed(color);
  return [r, g, b, a].map((channel) => Math.round(channel * 255));
};

/**
 * `?cells` on the market level: the loaded cells on screen as drawn, on
 * `__contender.cells`, as the GPUI contender's cell probe publishes them
 * (`row`, `column`, `exact`: the value's exact text, `shown`: the cell's
 * text, `text`: its color, `flash`: its background while a flash shows,
 * else null; each color 8-bit, `[r, g, b, a]`), and the columns'
 * geometry on `__contender.columns`. A getter, read from the DOM each time
 * it's read: a flash fades with no render, so a copy made at the last
 * commit would keep it lit.
 */
export function publishMarketCells(scroller: HTMLElement, columns: readonly LaidOutColumn[]): void {
  const contender = (globalThis as { __contender?: Contender & { cells?: unknown; columns?: unknown } }).__contender;
  if (!contender) return;
  contender.columns = columns.map(({ name, x, width, kind }) => ({ name, x, width, kind }));
  Object.defineProperty(contender, 'cells', { configurable: true, enumerable: true, get: () => drawnCells(scroller) });
}

/** The loaded cells on screen in `scroller`, as drawn (`publishMarketCells`'s;
 *  the monitoring wall's, a table each). */
export function drawnCells(scroller: HTMLElement) {
  const box = scroller.getBoundingClientRect();
  const top = box.top + scroller.clientTop;
  const bottom = top + scroller.clientHeight;
  const cells: { row: number; column: number; exact: string; shown: string; text: number[] | null; flash: number[] | null }[] = [];
  for (const element of scroller.querySelectorAll<HTMLElement>('.content > .row')) {
    const row = Number(element.dataset.row);
    const rowBox = element.getBoundingClientRect();
    if (rowBox.bottom <= top || rowBox.top >= bottom) continue;
    element.querySelectorAll<HTMLElement>(':scope > .cell').forEach((cell, column) => {
      // The value the cell drew (`data-exact`); a pending cell has none.
      const exact = cell.dataset.exact;
      if (exact === undefined) return;
      const style = getComputedStyle(cell);
      const fill = rgba8(style.backgroundColor);
      cells.push({ row, column, exact, shown: cell.textContent ?? '', text: rgba8(style.color), flash: fill[3]! > 0 ? fill : null });
    });
  }
  return cells;
}
