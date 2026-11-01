// Writes `fixtures/density.json`'s `number_px` from the bare host in
// Chromium, so the fixture's widths and budgets rest on GPUI's own advance
// on the web, not the native test app's (0.6 em): a DOM contender can't read
// GPUI's advances. For each case's text size in effect (its text resolved at
// its rem size, at least 6 px), the host opens the narrow shape at that text
// in px (`?density=<row>,<text>`, the row one the host's default never is,
// checked in effect) and reads its integer column's width from
// the layout probe: `spkid`, 20 characters, is `20 × number_px + 2 × padding
// + 1` wide (`column.rs`'s `digits_width`), its padding the table's at a
// `px` text (`paddingAt`). The text's unit changes the padding, never the
// advance, so a `rems` case is read at its px.
//
// Usage: node components/tall-table/perf/density-fixture.ts [--check]
// --check fails if the file would change. Run `just tall-table build density` first.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { open, waitMark } from '../../../shared-web/perf/harness.ts';
import { flag } from '../../../shared-web/perf/protocol.ts';
import { serveApp } from '../../../shared-web/perf/serve.ts';
import { FILLED_MARK, PORT, builtFeatures, componentDir, hostWebDir, paddingAt, shown } from './harness.ts';

/** The narrow shape's integer column and its characters
 *  (`host/crate/src/rows.rs`, `NARROW`). */
const INTEGER = { name: 'spkid', chars: 20 };
/** `number_px` is kept to this many decimals: the f32 layout's noise. */
const DECIMALS = 4;

interface Case { name: string; rem: number; row_height: number; text: { px: number } | { rems: number }; number_px: number }

if (!builtFeatures().includes('density')) throw new Error('the host isn\'t built with density: `just tall-table build density`');
const file = join(componentDir, 'fixtures/density.json');
const before = readFileSync(file, 'utf8');
const fixture = JSON.parse(before) as { cases: Case[] };

/** A case's text in effect, px: its unit resolved at its rem, at least 6. */
const textPx = (test: Case) => Math.max(6, 'px' in test.text ? test.text.px : test.text.rems * test.rem);

const server = await serveApp(undefined, { webDir: hostWebDir, port: PORT });
const read = new Map<number, number>();
try {
  for (const text of new Set(fixture.cases.map(textPx))) {
    // A row the host's default (18 px) never is, so the check below tells.
    const row = Math.ceil(text) + 20;
    const session = await open(chromium, server.url, { params: { shape: 'narrow', density: `${row},${text}` } });
    try {
      await waitMark(session.page, FILLED_MARK);
      const { layout } = await shown(session.page);
      // The host falls back to its default for a `?density=` it refuses:
      // the row says it took this one.
      if (layout.rowHeight !== row) throw new Error(`?density=${row},${text}: rows ${layout.rowHeight} px, not ${row}: the host didn't take it`);
      const column = layout.columns.find((column) => column.name === INTEGER.name);
      if (!column || column.kind !== 'integer') throw new Error(`no integer column ${INTEGER.name} in the narrow shape`);
      const numberPx = Number(((column.width - 2 * paddingAt(text) - 1) / INTEGER.chars).toFixed(DECIMALS));
      read.set(text, numberPx);
      if (session.problems.length) throw new Error(session.problems.join('; '));
      console.log(`${text} px: ${INTEGER.name} ${column.width} px wide, number_px ${numberPx} (${(numberPx / text).toFixed(4)} em)`);
    } finally {
      await session.close();
    }
  }
} finally {
  await server.close();
}

// Each case's `number_px` replaced in place, in order, the rest of the file
// as written (its `14.0`s kept).
let index = 0;
const after = before.replace(/"number_px": [^,\n]+/g, () => `"number_px": ${read.get(textPx(fixture.cases[index++]!))!}`);
if (index !== fixture.cases.length) throw new Error(`${index} number_px fields for ${fixture.cases.length} cases`);
if (flag('check')) {
  if (after !== before) {
    for (const test of JSON.parse(before).cases as Case[]) {
      const now = read.get(textPx(test));
      if (now !== test.number_px) console.error(`${test.name}: number_px ${test.number_px} in the file, ${now} in Chromium`);
    }
    console.error('FAIL: fixtures/density.json differs from Chromium; run `just tall-table density-fixture` and update the cases it changes');
    process.exit(1);
  }
  console.log('ok: fixtures/density.json matches');
} else {
  writeFileSync(file, after);
  console.log(after === before ? 'unchanged' : `wrote ${file}`);
}
