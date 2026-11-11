// The monitoring wall's tables as each contender publishes them with
// `?cells` (`docs/contender-contract.md`, "The cell probe"), and what "the
// same grid" and "the scenario's colors" mean for them: one home for the
// rules `perf/wall.ts` (GPUI | TanStack in Chromium) and
// `perf/tanstack-parity.ts` (TanStack in three browsers against GPUI) both
// check.

import type { Page } from '@playwright/test';
import { MONITORING_WALL, type Oklch } from '../contenders/scenarios.ts';
import { fromOklch, type Rgba } from '../contenders/tall-table/tanstack/web/src/paint.ts';

/** How far apart a table's edges may sit on the two sides: GPUI lays out
 *  in whole device pixels (root `CLAUDE.md`), the DOM in fractions. */
export const GRID_PX = 1;
/** How far apart a column's x and width may be: both sides lay the
 *  columns out from the same widths. */
export const COLUMN_PX = 0.5;
/** The grid's controls move every table by this much, past `GRID_PX`. */
export const CONTROL_SHIFT_PX = 2;
/** The columns a table draws, in order. */
export const WALL_COLUMNS = ['Symbol', 'Last', 'Chg %', 'Volume'] as const;
/** A phone: one column of tables. */
export const PHONE = { width: 390, height: 844 };
/** A narrow window: one column of tables, its sides wide. */
export const NARROW = { width: 700, height: 900 };

export interface WallCell {
  row: number;
  column: number;
  exact: string;
  shown: string;
  text: number[] | null;
  flash: number[] | null;
}
export interface WallTable {
  cells?: WallCell[];
  columns?: { name: string; x: number; width: number }[];
  /** Its cells' left edge (right of the row numbers) and top (under the header), and the row height. */
  layout?: { left: number; top: number; rowHeight: number };
  /** Its frame: `[x, y, width, height]`. */
  box?: [number, number, number, number];
}

/** Each table as the page publishes it (`__contender.tables`). */
export const wallTables = (page: Page): Promise<WallTable[]> =>
  page.evaluate(() => ((globalThis as { __contender?: { tables?: WallTable[] } }).__contender?.tables ?? []).map(({ cells, columns, layout, box }) => ({ cells, columns, layout, box })));

/** Where two sides' tables differ: each table's frame (its four edges,
 *  within `GRID_PX`), its cells' left and top (within `GRID_PX`: the
 *  gutter and the header), its row height, its columns' x and width
 *  (within `COLUMN_PX`), and the rows it shows (its cells' rows, where
 *  both sides publish cells: the tall table's scrollbar room under the
 *  rows hides a sliver of the next row on both sides, or neither). */
export function gridDiffers(gpui: WallTable[], tanstack: WallTable[]): string[] {
  const wrong: string[] = [];
  const off = (a: number, b: number, within: number) => Math.abs(a - b) > within;
  if (gpui.length !== tanstack.length) wrong.push(`${gpui.length} tables on GPUI, ${tanstack.length} on TanStack`);
  gpui.forEach((a, table) => {
    const b = tanstack[table];
    if (!b) return;
    const [la, lb] = [a.layout, b.layout];
    const [ba, bb] = [a.box, b.box];
    if (!la || !lb || !ba || !bb) return void wrong.push(`table ${table}: no layout or box`);
    const edges = (box: number[]) => [box[0]!, box[1]!, box[0]! + box[2]!, box[1]! + box[3]!];
    if (edges(ba).some((edge, i) => off(edge, edges(bb)[i]!, GRID_PX))) wrong.push(`table ${table}: frame ${ba.map((n) => +n.toFixed(2))} on GPUI, ${bb.map((n) => +n.toFixed(2))} on TanStack`);
    if (off(la.left, lb.left, GRID_PX) || off(la.top, lb.top, GRID_PX)) wrong.push(`table ${table}: cells at (${la.left}, ${la.top}) on GPUI, (${lb.left}, ${lb.top}) on TanStack`);
    if (la.rowHeight !== lb.rowHeight) wrong.push(`table ${table}: rows ${la.rowHeight} px on GPUI, ${lb.rowHeight} on TanStack`);
    if (a.cells?.length && b.cells?.length) {
      const shown = (cells: WallCell[]) => [...new Set(cells.map((cell) => cell.row))].sort((x, y) => x - y).join(',');
      if (shown(a.cells) !== shown(b.cells)) wrong.push(`table ${table}: rows ${shown(a.cells)} shown on GPUI, ${shown(b.cells)} on TanStack`);
    }
    const [ca, cb] = [a.columns ?? [], b.columns ?? []];
    if (ca.length !== cb.length) wrong.push(`table ${table}: ${ca.length} columns on GPUI, ${cb.length} on TanStack`);
    ca.forEach((column, index) => {
      const other = cb[index];
      if (!other || other.name !== column.name || off(other.x, column.x, COLUMN_PX) || off(other.width, column.width, COLUMN_PX))
        wrong.push(`table ${table} ${column.name}: GPUI x ${column.x} width ${column.width}, TanStack ${other ? `${other.name} x ${other.x} width ${other.width}` : 'none'}`);
    });
  });
  return wrong;
}

/** The grid's control: the same tables, each moved right by
 *  `CONTROL_SHIFT_PX`, which `gridDiffers` must find in every table. */
export const shifted = (tables: WallTable[]): WallTable[] =>
  tables.map((table) => ({
    ...table,
    layout: table.layout && { ...table.layout, left: table.layout.left + CONTROL_SHIFT_PX },
    box: table.box && [table.box[0] + CONTROL_SHIFT_PX, table.box[1], table.box[2], table.box[3]],
  }));

/** The rows' control: the same tables, each showing one more row (its
 *  last row's cells copied below it), which `gridDiffers` must find in
 *  every table: the sliver of a next row that the scrollbar room hides. */
export const oneMoreRow = (tables: WallTable[]): WallTable[] =>
  tables.map((table) => {
    const cells = table.cells ?? [];
    const last = Math.max(...cells.map((cell) => cell.row));
    return { ...table, cells: [...cells, ...cells.filter((cell) => cell.row === last).map((cell) => ({ ...cell, row: last + 1 }))] };
  });

/** Whether a control held: every table of a changed grid (`shifted`, or
 *  `oneMoreRow`) differs. */
export const controlHolds = (reference: WallTable[], tables: WallTable[], change: (tables: WallTable[]) => WallTable[] = shifted): { differ: number; holds: boolean } => {
  const wrong = gridDiffers(reference, change(tables));
  const differ = new Set(wrong.map((line) => /^table (\d+)/.exec(line)?.[1]).filter(Boolean)).size;
  return { differ, holds: differ === reference.length && reference.length > 0 };
};

const rgb8 = (color: Rgba): number[] => [color.r, color.g, color.b].map((channel) => Math.round(channel * 255));
/** The scenario's rise or fall, 8-bit. */
export const signRgb = (theme: 'light' | 'dark', rise: boolean): number[] => rgb8(fromOklch(...(MONITORING_WALL.signs[theme][rise ? 'up' : 'down'] as Oklch)));
export const near = (a: readonly number[], b: readonly number[], steps = 1): boolean => a.length >= b.length && b.every((channel, i) => Math.abs(channel - a[i]!) <= steps);

/** What's wrong with Chg %'s color for `exact`: the rise's or the fall's
 *  by sign (within one 8-bit step), a zero in neither; null if right. */
export function signWrong(theme: 'light' | 'dark', exact: string, text: number[] | null): string | null {
  const value = Number(exact);
  const color = text?.slice(0, 3) ?? [];
  if (value !== 0 && !near(color, signRgb(theme, value > 0))) return `${exact} drawn ${color}, not the ${value > 0 ? 'rise' : 'fall'}'s ${signRgb(theme, value > 0)}`;
  if (value === 0 && (near(color, signRgb(theme, true), 8) || near(color, signRgb(theme, false), 8))) return `a zero drawn in a sign's color ${color}`;
  return null;
}

/** Whether a flash is off the scenario's: not the rise's or the fall's
 *  color, or past the mix. */
export function flashOff(theme: 'light' | 'dark', flash: number[]): boolean {
  const [r = 0, g = 0, b = 0, a = 0] = flash;
  return a > Math.round(MONITORING_WALL.flash.mix * 255) + 1 || !(near([r, g, b], signRgb(theme, true)) || near([r, g, b], signRgb(theme, false)));
}
