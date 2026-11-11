/**
 * The monitoring wall's desks as the feed and the stores take them: a stop
 * of N tables shows the first N desks (`instruments.ts`, in desk order), 50
 * rows each, and the feed ticks only their instruments, so a tick's
 * instrument is its row in the wall's first `N × 50`. Pure: Node and both
 * contenders import it.
 */

import type { Instrument } from '../market/feed.ts';
import { WALL_INSTRUMENTS } from './instruments.ts';
import { DESKS } from './names.ts';

/** A desk's rows: one table, one page of the table's. */
export const DESK_ROWS = 50;

/** The first `tables` desks' instruments, in the feed's order: market
 *  watch's shape, the desk in the name's place (the wall draws no name;
 *  a table's title is its desk). */
export function wallInstruments(tables: number): Instrument[] {
  if (!Number.isInteger(tables) || tables < 1 || tables > DESKS.length) throw new Error(`${tables} tables: the wall has 1 to ${DESKS.length} desks`);
  return WALL_INSTRUMENTS.slice(0, tables * DESK_ROWS).map(([desk, symbol, price]) => ({ symbol, name: DESKS[desk]!, price }));
}
