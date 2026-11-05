// Writes `fixtures/cells.json`'s `format.advances` from the bare host in
// Chromium, so the fixture's fits rest on GPUI's own advances on the web,
// not the font read natively: a DOM contender can't read GPUI's advances.
// The table built with `format` reports each character a format writes and
// its advance at the text in effect in its layout probe (`advances`, the
// ones its fit sums); the host's is the base's 14 px. Each value is kept
// to `DECIMALS` decimals. A suffix's characters (`%`) aren't the table's:
// it shapes a suffix whole, so theirs stay as the native test reads them
// with the web's shaper (`plex_sans_shapes_formats_at_their_advances`).
//
// Usage: node components/tall-table/perf/format-fixture.ts [--check]
// --check fails if the file would change. Run `just tall-table build format` first.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { open, waitMark } from '../../../shared-web/perf/harness.ts';
import { flag } from '../../../shared-web/perf/protocol.ts';
import { serveApp } from '../../../shared-web/perf/serve.ts';
import { FILLED_MARK, PORT, advances, builtFeatures, componentDir, hostWebDir, shown } from './harness.ts';

/** An advance is kept to this many decimals: the f32's noise. */
const DECIMALS = 4;

if (!builtFeatures().includes('format')) throw new Error('the host isn\'t built with format: `just tall-table build format`');
const file = join(componentDir, 'fixtures/cells.json');
const before = readFileSync(file, 'utf8');
const written = (JSON.parse(before) as { format: { advances: Record<string, number> } }).format.advances;

const server = await serveApp(undefined, { webDir: hostWebDir, port: PORT });
let read: Record<string, number>;
try {
  // At the base's 14 px text: with `density`, its control's numbers.
  const session = await open(chromium, server.url, { params: { shape: 'narrow', ...(builtFeatures().includes('density') ? { density: '30,14' } : {}) } });
  try {
    await waitMark(session.page, FILLED_MARK);
    read = await advances(session.page);
    const { layout } = await shown(session.page);
    if (layout.rowHeight !== 30) throw new Error(`rows ${layout.rowHeight} px: not the base's 14 px text`);
    if (session.problems.length) throw new Error(session.problems.join('; '));
  } finally {
    await session.close();
  }
} finally {
  await server.close();
}

const unknown = Object.keys(read).filter((ch) => !(ch in written));
if (unknown.length) throw new Error(`the table writes ${unknown.join(' ')}, which cells.json has no advance for: add them`);
// The table's characters from Chromium; a suffix's as written.
const pinned = Object.fromEntries(Object.keys(written).map((ch) => [ch, ch in read ? Number(read[ch]!.toFixed(DECIMALS)) : written[ch]!]));
for (const [ch, px] of Object.entries(pinned)) console.log(`${ch}: ${px} px (${(px / 14).toFixed(4)} em)${ch in read ? (px === written[ch] ? '' : `, ${written[ch]} in the file`) : ', a suffix\'s: as written'}`);

// The `advances` object replaced in place, the rest of the file as written.
const block = /("advances": \{\n)([^}]*)(\n\s*\})/;
const match = block.exec(before);
if (!match) throw new Error('no "advances" object in fixtures/cells.json');
const indent = /^\s*/.exec(match[2]!)![0];
const body = Object.entries(pinned).map(([ch, px]) => `${indent}${JSON.stringify(ch)}: ${px}`).join(',\n');
const after = before.replace(block, `$1${body}$3`);
if (flag('check')) {
  if (after !== before) {
    console.error('FAIL: fixtures/cells.json\'s format advances differ from Chromium; run `just tall-table format-fixture` and update the cases it changes');
    process.exit(1);
  }
  console.log('ok: fixtures/cells.json\'s format advances match');
} else {
  writeFileSync(file, after);
  console.log(after === before ? 'unchanged' : `wrote ${file}`);
}
