/**
 * The view's pure parts: the columns laid out at the widths and budgets
 * `cells.json` pins (the GPUI contender's), a short page's missing rows
 * shown as missing, not as NULLs, and the tooltip's text.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { tableFromArrays, tableToIPC } from 'apache-arrow';
import { cellTooltip, shownRow } from '../src/cells.ts';
import { ArrowPage, columnKind } from '../src/data/table.ts';
import { gutterWidth, layOut } from '../src/layout.ts';

const cells = JSON.parse(readFileSync(new URL('../../../../../../../components/tall-table/fixtures/cells.json', import.meta.url), 'utf8')) as {
  columns: { name: string; kind: string; width: number; budget: number }[];
  rounding: { column: string; value: string; exact: string; shown: string }[];
};

test('float columns at the pinned widths and budgets', () => {
  assert.ok(cells.columns.length > 0);
  for (const pinned of cells.columns) {
    const column = layOut({ name: pinned.name, type: 'DOUBLE', kind: columnKind('DOUBLE') });
    assert.deepEqual({ width: column.width, budget: column.budget }, { width: pinned.width, budget: pinned.budget }, pinned.name);
  }
  // Control: a budget a character off fails.
  assert.notEqual(layOut({ name: 'H', type: 'DOUBLE', kind: 'float' }).budget, cells.columns[0]!.budget + 1);
});

test('the other kinds at the GPUI contender widths', () => {
  const width = (name: string, type: string) => layOut({ name, type, kind: columnKind(type) }).width;
  assert.equal(width('spkid', 'BIGINT'), 185);
  assert.equal(width('full_name', 'VARCHAR'), 200);
  assert.equal(width('neo', 'BOOLEAN'), 72);
  assert.equal(width('first_obs', 'DATE'), 104);
  // A long name widens its column (7.5 px a character, plus 24).
  assert.equal(width('a_very_long_column_name_here', 'BOOLEAN'), 28 * 7.5 + 24);
  assert.equal(gutterWidth(1_567_523), 91.5);
});

test("a short page's missing rows are missing, not NULL", () => {
  const columns = [layOut({ name: 'id', type: 'BIGINT', kind: 'integer' }), layOut({ name: 'x', type: 'DOUBLE', kind: 'float' })];
  // Two rows, the second with a NULL: a page for rows 0–3 that answered short.
  const page = new ArrowPage(tableToIPC(tableFromArrays({ id: BigInt64Array.from([1n, 2n]), x: [0.5, null] })));
  assert.deepEqual(shownRow({ kind: 'loaded', page, index: 1 }, columns), {
    kind: 'loaded',
    cells: [
      { text: '2', muted: false },
      { text: 'NULL', muted: true },
    ],
  });
  // Past its end: no text at all.
  assert.deepEqual(shownRow({ kind: 'loaded', page, index: 2 }, columns), { kind: 'loaded', cells: [null, null] });
  assert.deepEqual(shownRow({ kind: 'pending' }, columns), { kind: 'pending' });
});

test("the tooltip's text: a rounded float's exact text, text's line breaks, capped", () => {
  // Every rounding case the cell fixture pins: the cell differs, the
  // tooltip holds the exact text.
  assert.ok(cells.rounding.length > 0);
  for (const pinned of cells.rounding) {
    const column = layOut({ name: pinned.column, type: 'DOUBLE', kind: 'float' });
    const tooltip = cellTooltip(column, Number(pinned.value));
    assert.deepEqual(tooltip, { text: pinned.exact, differs: pinned.exact !== pinned.shown }, `${pinned.column} ${pinned.value}`);
  }
  const text = layOut({ name: 'full_name', type: 'VARCHAR', kind: 'text' });
  // A float that fits, an integer, and plain text: the same as the cell
  // (a cut is the drawn cell's to tell).
  assert.deepEqual(cellTooltip(layOut({ name: 'H', type: 'DOUBLE', kind: 'float' }), 3.25), { text: '3.25', differs: false });
  assert.deepEqual(cellTooltip(layOut({ name: 'spkid', type: 'BIGINT', kind: 'integer' }), 20000004n), { text: '20000004', differs: false });
  assert.deepEqual(cellTooltip(text, '4 Vesta (A807 FA)'), { text: '4 Vesta (A807 FA)', differs: false });
  // Line breaks: shown on one line, whole in the tooltip.
  assert.deepEqual(cellTooltip(text, 'a\r\nb\nc'), { text: 'a\r\nb\nc', differs: true });
  // NULL and a missing cell: none.
  assert.equal(cellTooltip(text, null), null);
  assert.equal(cellTooltip(text, undefined), null);
  // At most 2,000 characters (code points), then an ellipsis.
  const long = cellTooltip(text, '😀'.repeat(2001))!;
  assert.equal([...long.text].length, 2001);
  assert.ok(long.text.endsWith('😀…'));
  assert.equal(cellTooltip(text, '😀'.repeat(2000))!.text, '😀'.repeat(2000));
});
