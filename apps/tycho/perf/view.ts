// The controller's view state in Chromium, Firefox, and WebKit
// (`crate/src/view.rs`): what the table owns and reports becomes the view,
// read back from `globalThis.__tychoView` (read-only, `?bench`) and checked
// against what the table draws (`__tychoTableLayout`).
//
// 1. The sample: a header dragged to another place, a column's edge dragged
//    wider, the first column pinned through `?bench`'s `__tychoPin` (no
//    gesture pins while nothing is pinned, and the column's menu isn't
//    built: `docs/DECISIONS.md`, "Scope", 2026-11-23), then another column
//    dragged into the pinned run. After each, the view's order, widths, and
//    pin are the table's.
// 2. A CSV whose last row widens a number column to text: the same column
//    pinned, moved, and widened while the file loads; once it's read, the
//    column is text and keeps its place, its width, and the pin. The view
//    must still have the number type when the arrangement is done, or the
//    run proves nothing and fails.
//
// Against the dev server by default (`just tycho dev`); pass the preview's
// URL for the release build.
// Usage: node apps/tycho/perf/view.ts [url]

import { createWriteStream, mkdtempSync, rmdirSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { chromium, firefox, webkit, type BrowserType, type Page } from '@playwright/test';
import { waitMark } from '../../../shared-web/perf/harness.ts';

const url = new URL(process.argv.find((arg) => /^https?:/.test(arg)) ?? 'http://localhost:5173/');
url.searchParams.set('bench', '');
const TIMEOUT = 60_000;
/** Pointer moves a drag is made of: a drag needs more than one to start. */
const DRAG_MOVES = 8;
/** How much wider a column's edge is dragged, CSS px. */
const WIDER = 60;

interface ColumnView {
  name: string;
  type: string;
  width?: number;
  format?: unknown;
}

interface View {
  source: { kind: string; name: string; rows: number };
  columns: ColumnView[];
  pinned?: number;
}

interface Layout {
  left: number;
  top: number;
  rowHeight: number;
  cellsWidth: number;
  pinned: number;
  columns: { name: string; x: number; width: number; index: number }[];
}

type CheckGlobal = {
  __tychoView?: View | null;
  __tychoTableLayout?: Layout;
  __tychoWorkbench?: { state: string; ingest: string | null };
  __tychoPin?: (columns: number) => void;
  __tychoDropInput?: HTMLInputElement;
};

interface Outcome {
  what: string;
  ok: boolean;
  detail: string;
}

const view = (page: Page) => page.evaluate(() => (globalThis as CheckGlobal).__tychoView ?? null);
/** The layout, its `left` and `top` moved from the canvas's pixels (which
 *  the table reports in) to the page's: the canvas sits in the table's
 *  slot, under the top bar. */
const layout = (page: Page) =>
  page.evaluate(() => {
    const probe = (globalThis as CheckGlobal).__tychoTableLayout!;
    const canvas = document.querySelector('#table-slot canvas')!.getBoundingClientRect();
    return { ...probe, left: probe.left + canvas.left, top: probe.top + canvas.top };
  });

/** The view once it satisfies `test` (a predicate over `v`, as text), or
 *  the view as it is after the timeout. */
async function viewWhere(page: Page, test: string, timeout = 10_000): Promise<View | null> {
  try {
    await page.waitForFunction(
      (test) => {
        const v = (globalThis as CheckGlobal).__tychoView;
        return v ? (new Function('v', `return ${test}`) as (v: View) => boolean)(v) : false;
      },
      test,
      { timeout },
    );
  } catch {
    // Reported by the caller, from the view as it stands.
  }
  return view(page);
}

/** The layout once the table has drawn what the view says: the same order
 *  of names, widths where set, and the view's pinned count as the table
 *  pins it in effect: the leading columns that fit in half the cells'
 *  width (`pinned_in_effect`), so a count too wide to draw still matches. */
async function drawnAsViewed(page: Page, timeout = 10_000): Promise<{ ok: boolean; detail: string }> {
  try {
    await page.waitForFunction(
      () => {
        const g = globalThis as CheckGlobal;
        const v = g.__tychoView;
        const l = g.__tychoTableLayout;
        if (!v || !l) return false;
        // The leading columns whose right edge is within half the cells.
        const fitting = (l: Layout) => {
          const past = l.columns.findIndex((column) => column.x + column.width > l.cellsWidth / 2);
          return past === -1 ? l.columns.length : past;
        };
        return (
          v.columns.length === l.columns.length &&
          v.columns.every((column, place) => column.name === l.columns[place]!.name && (column.width === undefined || Math.abs(column.width - l.columns[place]!.width) < 0.5)) &&
          Math.min(v.pinned ?? 0, fitting(l)) === l.pinned
        );
      },
      undefined,
      { timeout },
    );
    return { ok: true, detail: 'the table draws it' };
  } catch {
    const [v, l] = [await view(page), await layout(page)];
    return {
      ok: false,
      detail: `view ${JSON.stringify({ names: v?.columns.map((c) => c.name), pinned: v?.pinned ?? 0 })}, drawn ${JSON.stringify({ names: l.columns.map((c) => c.name), pinned: l.pinned })}`,
    };
  }
}

const names = (v: View | null) => v?.columns.map((column) => column.name) ?? [];

/** A press at `from`, moved in steps to `to`, released. */
async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
  await page.mouse.move(from.x, from.y);
  // WebKit can deliver the press before the hover lands, and GPUI presses
  // only what's hovered: two frames first (`.claude/rules/perf-harness.md`).
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.mouse.down();
  for (let step = 1; step <= DRAG_MOVES; step++) {
    await page.mouse.move(from.x + ((to.x - from.x) * step) / DRAG_MOVES, from.y + ((to.y - from.y) * step) / DRAG_MOVES);
  }
  await page.mouse.up();
  await page.mouse.move(1, 1);
}

/** The header's row: its middle, above the body. */
const headerY = (l: Layout) => l.top - l.rowHeight / 2;

/** Moves the column at `place` so it lands after `after`, by a drag of its
 *  header (pressed near its left, clear of its edge's band) to three
 *  quarters into the column at `after`: right of its center, left of the
 *  next one's. Nothing is scrolled sideways. */
async function move(page: Page, place: number, after: number): Promise<void> {
  const l = await layout(page);
  const from = l.columns[place]!;
  const to = l.columns[after]!;
  await drag(page, { x: l.left + from.x + Math.min(12, from.width / 4), y: headerY(l) }, { x: l.left + to.x + (to.width * 3) / 4, y: headerY(l) });
}

/** Moves the column at `place` to the first place: its header dragged to
 *  a quarter into the first column, left of its center. */
async function moveFirst(page: Page, place: number): Promise<void> {
  const l = await layout(page);
  const from = l.columns[place]!;
  const to = l.columns[0]!;
  await drag(page, { x: l.left + from.x + Math.min(12, from.width / 4), y: headerY(l) }, { x: l.left + to.x + to.width / 4, y: headerY(l) });
}

/** Drags the right edge of the column at `place` `by` CSS px. */
async function widen(page: Page, place: number, by: number): Promise<void> {
  const l = await layout(page);
  const column = l.columns[place]!;
  const band = { x: l.left + column.x + column.width - 0.5, y: headerY(l) };
  await drag(page, band, { x: band.x + by, y: band.y });
}

/** Names with the one at `from` moved to land after the one at `after`. */
function moved(list: string[], from: number, after: number): string[] {
  const out = [...list];
  const [name] = out.splice(from, 1);
  out.splice(after > from ? after : after + 1, 0, name!);
  return out;
}

const same = (a: string[], b: string[]) => a.length === b.length && a.every((name, index) => name === b[index]);

async function sampleRun(page: Page): Promise<Outcome[]> {
  const outcomes: Outcome[] = [];
  const check = async (what: string, ok: boolean, detail: string) => {
    outcomes.push({ what, ok, detail });
    const drawn = await drawnAsViewed(page);
    outcomes.push({ what: `${what}: drawn`, ...drawn });
  };
  await waitMark(page, 'tycho:engine-locked', 0, TIMEOUT);
  await page.click('#first [data-action=sample]');
  const opened = await viewWhere(page, "v.source.kind === 'sample'", TIMEOUT);
  await check(
    "the sample's own view",
    opened !== null && opened.columns.length > 6 && (opened.pinned ?? 0) === 0 && opened.columns.every((column) => column.width === undefined),
    opened ? `${opened.source.name}, ${opened.source.rows} rows, ${opened.columns.length} columns, nothing moved, widened, or pinned` : 'no view published',
  );
  if (!opened) return outcomes;

  // A drag of the third column's header to after the fifth.
  const order = moved(names(opened), 2, 4);
  await move(page, 2, 4);
  const afterMove = await viewWhere(page, `${JSON.stringify(order)}.every((name, place) => v.columns[place].name === name)`);
  await check('a dragged column', same(names(afterMove), order), `${names(afterMove).slice(0, 6).join(', ')}…`);

  // The second column's edge dragged wider.
  const before = (await layout(page)).columns[1]!;
  await widen(page, 1, WIDER);
  const afterWiden = await viewWhere(page, 'v.columns[1].width !== undefined');
  const width = afterWiden?.columns[1]?.width;
  await check(
    'a widened column',
    width !== undefined && Math.abs(width - (before.width + WIDER)) <= 1 && afterWiden!.columns[1]!.name === before.name,
    `${before.name}: ${before.width} px drawn, ${width ?? 'no'} px in the view (${before.width + WIDER} dragged to)`,
  );

  // The first column pinned, through the table.
  await page.evaluate(() => (globalThis as CheckGlobal).__tychoPin!(1));
  const pinned = await viewWhere(page, 'v.pinned === 1');
  await check('a pinned column', pinned?.pinned === 1, `pinned ${pinned?.pinned ?? 0}`);

  // The fourth column dragged into the run: it pins, the count with it.
  const l = await layout(page);
  const fourth = l.columns[3]!;
  const first = l.columns[0]!;
  const intoRun = moved(names(pinned), 3, 0);
  await drag(page, { x: l.left + fourth.x + Math.min(12, fourth.width / 4), y: headerY(l) }, { x: l.left + first.x + (first.width * 3) / 4, y: headerY(l) });
  const runGrown = await viewWhere(page, 'v.pinned === 2');
  await check('a column dragged into the pinned run', runGrown?.pinned === 2 && same(names(runGrown), intoRun), `pinned ${runGrown?.pinned ?? 0}: ${names(runGrown).slice(0, 3).join(', ')}…`);

  // More pinned than half the width holds: the table pins fewer, and the
  // view keeps the count asked for (the table sends no `Pinned` when the
  // run it draws doesn't change).
  await page.evaluate(() => (globalThis as CheckGlobal).__tychoPin!(20));
  const tooWide = await viewWhere(page, 'v.pinned === 20');
  const drawnRun = (await layout(page)).pinned;
  await check('a pin wider than the table draws', tooWide?.pinned === 20 && drawnRun < 20, `the view pins ${tooWide?.pinned ?? 0}, the table draws ${drawnRun}`);
  return outcomes;
}

/** A CSV whose `code` column is a number on every row but the last, of
 *  `mib` MiB's worth of rows at 36 bytes each (they run longer: 120 makes
 *  149 MiB), so the widening chunk comes seconds after the first rows. */
async function widenedCsv(mib: number): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'tycho-view-'));
  const file = join(dir, 'widens.csv');
  const out = createWriteStream(file);
  out.write('id,code,name,value\n');
  const rows = Math.round((mib * 1024 * 1024) / 36);
  let lines: string[] = [];
  for (let row = 0; row < rows; row++) {
    const code = row === rows - 1 ? 'X1' : String((row * 7919) % 100_000);
    lines.push(`${row},${code},object ${row},${(row % 1000) / 7}`);
    if (lines.length === 10_000) {
      if (!out.write(lines.join('\n') + '\n')) await new Promise((resolve) => out.once('drain', resolve));
      lines = [];
    }
  }
  out.write(lines.join('\n') + '\n');
  await new Promise((resolve) => out.end(resolve));
  return file;
}

/** Drops `file` on the page, as `lockdown.ts` does. */
async function dropFile(page: Page, file: string): Promise<void> {
  await page.evaluate(() => {
    const g = globalThis as CheckGlobal;
    const input = document.createElement('input');
    input.type = 'file';
    input.hidden = true;
    document.body.append(input);
    g.__tychoDropInput = input;
  });
  const input = await page.evaluateHandle(() => (globalThis as CheckGlobal).__tychoDropInput!);
  await input.asElement()!.setInputFiles(file);
  await page.evaluate(() => {
    const file = (globalThis as CheckGlobal).__tychoDropInput!.files![0]!;
    const transfer = new DataTransfer();
    transfer.items.add(file);
    for (const type of ['dragenter', 'dragover', 'drop']) {
      document.querySelector('canvas')!.dispatchEvent(new DragEvent(type, { dataTransfer: transfer, bubbles: true, cancelable: true, clientX: 720, clientY: 450 }));
    }
  });
}

async function csvRun(page: Page, csv: string): Promise<Outcome[]> {
  const outcomes: Outcome[] = [];
  await waitMark(page, 'tycho:engine-locked', 0, TIMEOUT);
  await dropFile(page, csv);
  const opened = await viewWhere(page, "v.source.kind === 'csv'", TIMEOUT);
  if (!opened) return [{ what: 'the CSV opens', ok: false, detail: 'no view published' }];
  const codeType = opened.columns[1]!.type;

  // `code` (place 1): pinned with `id`, moved first, then widened.
  await page.evaluate(() => (globalThis as CheckGlobal).__tychoPin!(2));
  await viewWhere(page, 'v.pinned === 2');
  await moveFirst(page, 1);
  await viewWhere(page, "v.columns[0].name === 'code'");
  const before = (await layout(page)).columns[0]!;
  await widen(page, 0, WIDER);
  const arranged = await viewWhere(page, 'v.columns[0].width !== undefined');
  const ingest = await page.evaluate(() => (globalThis as CheckGlobal).__tychoWorkbench?.ingest ?? null);
  outcomes.push({
    what: 'arranged before the column widened',
    ok: arranged?.columns[0]?.type === codeType && codeType !== 'VARCHAR' && ingest === 'loading',
    detail: `code is ${arranged?.columns[0]?.type} (${codeType} at the open), the load ${ingest}`,
  });

  await page.waitForFunction(() => (globalThis as CheckGlobal).__tychoWorkbench?.ingest !== 'loading', undefined, { timeout: TIMEOUT });
  const done = await viewWhere(page, "v.columns.some((column) => column.name === 'code' && column.type === 'VARCHAR')");
  const code = done?.columns[0];
  outcomes.push({
    what: 'a widened column keeps its place, width, and pin',
    ok:
      code?.name === 'code' &&
      code.type === 'VARCHAR' &&
      code.width !== undefined &&
      Math.abs(code.width - (before.width + WIDER)) <= 1 &&
      done?.pinned === 2 &&
      same(names(done), ['code', 'id', 'name', 'value']) &&
      done.source.rows > opened.source.rows,
    detail: `${names(done).join(', ')}; code ${code?.type} at ${code?.width ?? 'its kind\'s'} px; pinned ${done?.pinned ?? 0}; ${done?.source.rows} rows`,
  });
  outcomes.push({ what: 'the widened view drawn', ...(await drawnAsViewed(page)) });
  return outcomes;
}

const ENGINES: { name: string; type: BrowserType }[] = [
  { name: 'chromium', type: chromium },
  { name: 'firefox', type: firefox },
  { name: 'webkit', type: webkit },
];

async function inBrowser(type: BrowserType, run: (page: Page) => Promise<Outcome[]>): Promise<{ outcomes: Outcome[]; errors: string[] }> {
  const browser = await type.launch();
  const errors: string[] = [];
  try {
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.goto(url.href);
    return { outcomes: await run(page), errors };
  } finally {
    await browser.close();
  }
}

const csv = await widenedCsv(120);
let failures = 0;
const print = (browser: string, part: string, outcome: Outcome) => {
  if (!outcome.ok) failures += 1;
  console.log(`${browser.padEnd(9)}${part.padEnd(8)}${outcome.ok ? 'ok  ' : 'FAIL'}  ${outcome.what}: ${outcome.detail}`);
};

try {
  for (const { name, type } of ENGINES) {
    for (const [part, run] of [
      ['sample', sampleRun],
      ['csv', (page: Page) => csvRun(page, csv)],
    ] as const) {
      try {
        const { outcomes, errors } = await inBrowser(type, run);
        outcomes.forEach((outcome) => print(name, part, outcome));
        for (const error of errors) print(name, part, { what: 'no page error', ok: false, detail: error });
      } catch (error) {
        print(name, part, { what: 'the run finished', ok: false, detail: error instanceof Error ? error.message.split('\n')[0]! : String(error) });
      }
    }
  }
} finally {
  // The generated CSV and the folder made for it, and nothing else.
  unlinkSync(csv);
  rmdirSync(dirname(csv));
}
console.log(failures ? `\nFAIL: ${failures} check(s)` : '\nPASS');
process.exit(failures ? 1 : 0);
