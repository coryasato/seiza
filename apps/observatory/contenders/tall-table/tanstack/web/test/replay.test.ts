/**
 * The tail level's data layer (`src/data/replay.ts`), as the GPUI
 * contender's `scene/tail.rs` checks its own: the file is the log's four
 * columns in order and the replay's rows, and every page is read through
 * the replay's page SQL over the file fetched whole (`WHOLE_FILE`), never
 * the ranged copy the open read.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DATA_FILE, FILE_ROWS, WHOLE_FILE } from '../../../../tail/data.ts';
import { COLUMNS, checkFile, tailSource } from '../src/data/replay.ts';
import { tailSql } from '../src/data/tail.ts';
import type { Column, Queries } from '../src/data/table.ts';
import './level.ts';

const columns = (names: readonly string[]): Column[] => names.map((name) => ({ name, type: 'VARCHAR', kind: 'text' }));

test("the file is the log's columns and the replay's rows", () => {
  assert.equal(checkFile(columns(COLUMNS), FILE_ROWS), null);
  assert.match(checkFile(columns(['time', 'request', 'bytes', 'status']), FILE_ROWS) ?? '', /not live tail's/, 'columns out of order');
  assert.match(checkFile(columns([...COLUMNS, 'host']), FILE_ROWS) ?? '', /not live tail's/, 'a column more');
  assert.match(checkFile(columns(COLUMNS), FILE_ROWS - 1) ?? '', /the replay's laps/, 'a row short');
});

test('every page is read through the replay SQL over the whole file', () => {
  const sent: string[] = [];
  const cancelled: number[] = [];
  const queries = {
    send: (sql: string) => {
      sent.push(sql);
      return { request: sent.length, result: new Promise<Uint8Array>(() => {}) };
    },
    cancel: (request: number) => cancelled.push(request),
  } as unknown as Queries;
  const source = tailSource(queries);
  // A page across a lap's seam: two SELECTs, the second a lap on.
  const { request } = source.load([FILE_ROWS - 10, FILE_ROWS + 10]);
  assert.equal(sent[0], tailSql(FILE_ROWS - 10, FILE_ROWS + 10));
  assert.ok(sent[0]!.includes(WHOLE_FILE) && !sent[0]!.includes(`'${DATA_FILE}'`));
  source.cancel(request);
  assert.deepEqual(cancelled, [request]);
});
