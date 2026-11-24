// The Vague Date parser, on every form GCAT's sample uses and on what it
// must refuse. Run: node --test apps/tycho/data/gcat-dates.test.ts

import { test } from 'node:test';
import { deepStrictEqual, throws } from 'node:assert/strict';
import { parseVagueDate } from './gcat-dates.ts';

test('every form, with and without the ?', () => {
  deepStrictEqual(parseVagueDate('1971'), { value: '1971-01-01', precision: 'year', uncertain: false });
  deepStrictEqual(parseVagueDate('1971?'), { value: '1971-01-01', precision: 'year', uncertain: true });
  deepStrictEqual(parseVagueDate('1990s?'), { value: '1990-01-01', precision: 'decade', uncertain: true });
  deepStrictEqual(parseVagueDate('2010 Q3?'), { value: '2010-07-01', precision: 'quarter', uncertain: true });
  deepStrictEqual(parseVagueDate('2023 Q4'), { value: '2023-10-01', precision: 'quarter', uncertain: false });
  deepStrictEqual(parseVagueDate('1962 Jun'), { value: '1962-06-01', precision: 'month', uncertain: false });
  deepStrictEqual(parseVagueDate('1962 Jun?'), { value: '1962-06-01', precision: 'month', uncertain: true });
  deepStrictEqual(parseVagueDate('1962 Jun 14'), { value: '1962-06-14', precision: 'day', uncertain: false });
  deepStrictEqual(parseVagueDate('1962 Jun 14?'), { value: '1962-06-14', precision: 'day', uncertain: true });
  deepStrictEqual(parseVagueDate('1957 Dec  1 1000?'), { value: '1957-12-01 10:00:00', precision: 'minute', uncertain: true });
  deepStrictEqual(parseVagueDate('2025 Nov 19 0012:20'), { value: '2025-11-19 00:12:20', precision: 'second', uncertain: false });
  deepStrictEqual(parseVagueDate('2025 Nov 19 0012:20?'), { value: '2025-11-19 00:12:20', precision: 'second', uncertain: true });
});

test("the two-space day, and the one-space day GCAT also has", () => {
  deepStrictEqual(parseVagueDate('1957 Oct  4'), { value: '1957-10-04', precision: 'day', uncertain: false });
  deepStrictEqual(parseVagueDate('2026 Jul 1 0048'), { value: '2026-07-01 00:48:00', precision: 'minute', uncertain: false });
});

test("a month's case is ignored, and the column's padding trimmed", () => {
  deepStrictEqual(parseVagueDate('2026 nov 21 1802'), { value: '2026-11-21 18:02:00', precision: 'minute', uncertain: false });
  deepStrictEqual(parseVagueDate(' 1957 Oct  4 \t'), { value: '1957-10-04', precision: 'day', uncertain: false });
});

test('a leap second stays in its minute', () => {
  deepStrictEqual(parseVagueDate('1998 Dec 31 2359:60'), { value: '1998-12-31 23:59:59', precision: 'second', uncertain: false });
});

test('anything else throws', () => {
  for (const bad of ['', '-', '57', '1957 Oct  4 10', '1957 Oct   4', '1957 Okt 4', '1957 Feb 30', '1957 Oct 4 2460', '1957 Oct 4 1061', '1957 Oct 4 1000:61', '1975s', '2010 Q5', '1957 Oct 4??', '1957-10-04', '2010s Q3', '1990s Jun  4', '1990s Jun']) {
    throws(() => parseVagueDate(bad), Error, JSON.stringify(bad));
  }
});
