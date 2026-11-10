/**
 * The table's ARIA semantics, at every level (`docs/DECISIONS.md`,
 * "TanStack contender"): the scroller is a `table` counting every row
 * (`aria-rowcount`, the header's included), the header a `row` of
 * `columnheader`s, each drawn row a `row` with its place in the whole
 * table (`aria-rowindex`, 1-based, the header 1), each cell a `cell`. A
 * virtualized row's index is its place in the table, not in the DOM, so a
 * screen reader says "row 1,200 of 1,567,524". The row numbers' gutter is
 * hidden from the tree: `aria-rowindex` says it. On the wide level, whose
 * columns are virtualized too, the table counts its columns
 * (`aria-colcount`) and each header and cell names its own
 * (`aria-colindex`, 1-based), so a column scrolled sideways keeps its
 * number.
 */

/** The scroller's: a table of `rows` rows under its header. */
export const tableAria = (rows: number) => ({ role: 'table', 'aria-rowcount': rows + 1 }) as const;

/** The header's row: the table's first. */
export const HEAD_ARIA = { role: 'row', 'aria-rowindex': 1 } as const;

/** Row `row`'s (0-based in the data): below the header. */
export const rowAria = (row: number) => ({ role: 'row', 'aria-rowindex': row + 2 }) as const;

/** The rows' box: the rows' group, between the table and its rows. */
export const BODY_ARIA = { role: 'rowgroup' } as const;

/** A box between the table and its rows that isn't one (the spacer). */
export const NONE_ARIA = { role: 'none' } as const;

/** The row numbers' gutter, the header's corner too. */
export const GUTTER_ARIA = { 'aria-hidden': true } as const;
