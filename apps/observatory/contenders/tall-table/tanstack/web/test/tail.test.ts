/**
 * The tall table's fixtures for live tail (`components/tall-table/fixtures/`:
 * `sql.json`'s `live-tail`, `cells.json`'s `timestamp_text`) against the
 * TanStack contender's replay (`src/data/tail.ts`), as the GPUI contender's
 * `src/tail.rs` runs them natively. Each has controls, which must fail it.
 *
 * Run: `node --test` here.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { FILE_ROWS, SPAN_S, WHOLE_FILE } from '../../../../tail/data.ts';
import { MONTHS, tailSql, timeText } from '../src/data/tail.ts';

const fixtures = new URL('../../../../../../../components/tall-table/fixtures/', import.meta.url);
const fixture = (name: string): any => JSON.parse(readFileSync(new URL(name, fixtures), 'utf8'));
const section = fixture('sql.json').scenarios['live-tail'];

/** The pages whose SQL `page` doesn't write. */
function sqlMismatches(page: (start: number, end: number) => string): string[] {
  assert.equal(section.query, 'loop');
  return (section.pages as { rows: [number, number]; sql: string }[]).filter(({ rows, sql }) => page(rows[0], rows[1]) !== sql).map(({ rows }) => `page ${rows}`);
}

/** The cases whose text `text` (from Arrow's epoch ms) doesn't write. */
function textMismatches(text: (epochMs: number) => string): string[] {
  const cases: { micros: number; text: string }[] = fixture('cells.json').timestamp_text.cases;
  assert.ok(cases.length >= 6);
  return cases.filter(({ micros, text: want }) => text(micros / 1000) !== want).map(({ micros }) => `${micros}: ${text(micros / 1000)}`);
}

describe('sql.json live-tail', () => {
  test('the constants are the fixture\'s', () => {
    assert.equal(section.loop_file, WHOLE_FILE);
    assert.equal(section.file_rows, FILE_ROWS);
    assert.equal(section.span_s, SPAN_S);
  });

  test('the loop\'s pages', () => {
    assert.deepEqual(sqlMismatches((start, end) => tailSql(start, end)), []);
  });

  test('controls fail', () => {
    assert.notDeepEqual(sqlMismatches((start, end) => tailSql(start, end, WHOLE_FILE, FILE_ROWS, 0)), [], 'no shift');
    // A page across a seam read as one SELECT of the first lap's file rows, past its end: the next lap's rows are never read.
    const oneSelect = (start: number, end: number) => {
      const base = Math.floor(start / FILE_ROWS) * FILE_ROWS;
      const sql = tailSql(start, Math.min(end, base + FILE_ROWS));
      if (end <= base + FILE_ROWS) return sql;
      const past = sql.replace(`file_row_number < ${FILE_ROWS})`, `file_row_number < ${end - base})`);
      assert.notEqual(past, sql, "the control reads past the lap's end");
      return past;
    };
    assert.notDeepEqual(sqlMismatches(oneSelect), [], 'the seam read as one SELECT');
    assert.notDeepEqual(sqlMismatches((start, end) => tailSql(start, end, WHOLE_FILE, FILE_ROWS + 1)), [], 'a lap off by one');
  });
});

describe('cells.json timestamp_text', () => {
  test('the time\'s text', () => {
    assert.deepEqual(textMismatches(timeText), []);
  });

  test('controls fail', () => {
    assert.notDeepEqual(textMismatches((ms) => timeText(ms).replace(/^0/, '')), [], 'an unpadded day');
    assert.notDeepEqual(textMismatches((ms) => timeText(ms).replace(/\/([A-Z][a-z]{2})\//, (_, month: string) => `/${String(MONTHS.indexOf(month) + 1).padStart(2, '0')}/`)), [], 'a numeric month');
    // The value read as a UTC instant and shown in the log's own zone (−0400 in July), as a local-time conversion in New York would.
    const local = (ms: number) => timeText(ms - 4 * 3_600_000);
    assert.notDeepEqual(textMismatches(local), [], 'a local-time conversion');
  });
});
