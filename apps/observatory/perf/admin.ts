// The admin table's capabilities on both contenders' base builds
// (`?scenario=admin-table`), in Chromium, light theme, 1440×900 at DPR 2:
// each of the panel's yes and no proven where a script can see it, each
// with its control (docs/DECISIONS.md, "Scenarios"; perf/results/2026-11-09-m12-a1.md,
// "The capabilities' probe"). After each side's `contender:filled`:
//
// - find: `window.find("Ísland")` finds it on TanStack, in Iceland's row
//   (it selects the match but doesn't scroll to it, as the find bar does:
//   that stays manual); not on GPUI. Control, on both:
//   DOM text added to the page is found, and a word not in the file isn't;
// - select and copy: a drag across Reykjavík's cell selects exactly
//   `Reykjavík` on TanStack, and Cmd/Ctrl+C puts it on the clipboard; a drag
//   across GPUI's cells selects nothing and the copy leaves the clipboard
//   as it was. Control, on both: a drag across DOM text added to the page
//   selects it;
// - a screen reader: CDP's accessibility tree holds one `table` of 251
//   `row`s (`aria-rowcount` 251, the data rows' `aria-rowindex` 2–251), 5
//   `columnheader`s, and Iceland's row's cells named, on TanStack; on GPUI
//   no node is named by any of the file's texts. Control, on both: DOM text
//   added to the page is named;
// - every script drawn: on TanStack, each script's cell drawn in a platform
//   face other than IBM Plex Sans, which lacks them all (CDP's
//   `getPlatformFontsForNode`), its control two unassigned code points,
//   reported as IBM Plex Sans (its notdef); on GPUI, by pixels, each
//   script's cell against the same name drawn by the DOM in the face GPUI
//   would use (IBM Plex Sans, else the script's Noto face, else the
//   browser's own for Han and Hangul): its ink's width within
//   `WIDTH_PX` and its column profile correlated past `MIN_CORRELATION`.
//   By default no script but Latin's matches (each glyph the face's notdef
//   box), its control Latin's name, which does; with `?fonts` all 15 match,
//   its control each against another script's drawing, which doesn't;
// - the flags: each side's flag cell has color (a channel spread past
//   `FLAG_CHROMA`), and its control, a text cell, none;
// - Translate's precondition: every name, English name, and capital in
//   TanStack's `innerText`, nothing `translate="no"`; none in GPUI's.
//   Control, on both: DOM text added to the page is in it;
// - the fonts path (GPUI, `?fonts`): no face fetched before the rows are in
//   (`contender:filled`), each of the 13 fetched once from
//   /observatory/fonts/ and its bytes recorded, `contender:fonts-in` then
//   `contender:fonts`, the last right after a presented frame (its GPU
//   work, as TTFP's mark is checked); without `?fonts` no face is fetched
//   and no fonts mark is set; its control, a face served cut short, marks
//   `contender:fonts-failed` and adds none;
// - the drawn text: every admin table cell of cells.json on TanStack's
//   page, the file's text decoded by Arrow, the same as the fixture's
//   shown text; the control (its UTF-8 read as Latin-1) differs.
//
// What stays manual (the cross-browser check): the find bar itself, a real
// screen reader (VoiceOver), and Chrome's Translate.
//
// Usage: node apps/observatory/perf/admin.ts [--side gpui|tanstack] [--label <name>] [--shots <dir>]
// --label writes perf/results/<date>-<label>.json; --shots saves each
// script's GPUI crop beside its reference. Needs `just observatory data`
// and `script-fonts`; run `gpui-build` and `tanstack-build` first.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { presentedMark, presentingTaskRecorder, targetRect, waitMark } from '../../../shared-web/perf/harness.ts';
import { localDate, machineInfo, option } from '../../../shared-web/perf/protocol.ts';
import { ADMIN_TABLE } from '../contenders/scenarios.ts';
import { SCRIPT_FACES, faceFile } from '../contenders/fonts/faces.ts';
import { SCRIPT_FONTS, UI_FONT } from '../contenders/paths.ts';
import type { AppServer } from '../../../shared-web/perf/serve.ts';
import type { Contender, Side } from '../contenders/contract.ts';
import { MARKS, dataPath, facesChecked, facesFetched, nativeDuckDB, perfDir, problems, protocolContext, serveGpui, serveTanstack } from './harness.ts';

const label = option('label');
const shots = option('shots');
const sideOption = option('side');
if (sideOption && sideOption !== 'gpui' && sideOption !== 'tanstack') throw new Error(`--side ${sideOption}: gpui or tanstack`);
const sides: Side[] = sideOption ? [sideOption as Side] : ['gpui', 'tanstack'];
const PORTS: Record<Side, number> = { gpui: 4382, tanstack: 4383 };
const QUERY = `?scenario=${ADMIN_TABLE.id}`;
const DPR = 2;
/** The file's column names, in order. */
const COLUMNS = ['flag', 'name', 'in English', 'capital', 'population'] as const;
/** Text added to each page for the controls; not in the file. */
const CONTROL_TEXT = 'Seiza control sentence';
/** A word the file doesn't hold: find's control. */
const ABSENT = 'Zqxjvwk';
/** A drawn name matches its reference within this much ink width, CSS px. */
const WIDTH_PX = 1.5;
/** …and this column-profile correlation. Notdef boxes read 0.15 and below
 *  against every script's drawing; the faces' drawings 0.29 (Sri Lanka's
 *  Sinhala, its marks misplaced: GPUI drops the marks' offsets) and up, most past 0.9
 *  (perf/results/2026-11-09-m12-b2.md). */
const MIN_CORRELATION = 0.25;
/** A channel spread (0–255) a flag passes and a text cell's gray doesn't. */
const FLAG_CHROMA = 80;
/** The scripts the panel names, each by its Unicode script: the 13 faces',
 *  then the two the browser draws with `?fonts`. */
const SCRIPTS = [...SCRIPT_FACES.map((face) => face.script), 'Han', 'Hangul'] as const;

const failures: string[] = [];
const results: Record<string, unknown> = {};
const check = (ok: boolean, what: string) => {
  if (!ok) failures.push(what);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
};

type Global = { __contender?: Contender & { columns?: { name: string; x: number; width: number }[] } };

// The file, from native DuckDB: every row's texts, in the file's order.
const db = await nativeDuckDB();
const rows = (await db.runAndReadAll(`select ${COLUMNS.map((name) => `"${name}"`).join(', ')} from '${dataPath(ADMIN_TABLE.data)}'`)).getRows().map((row) => row.map(String));
const rowOf = (column: (typeof COLUMNS)[number], text: string) => rows.findIndex((row) => row[COLUMNS.indexOf(column)] === text);
const ICELAND = rowOf('in English', 'Iceland');
if (ICELAND < 0 || rows[ICELAND]![1] !== 'Ísland' || rows[ICELAND]![3] !== 'Reykjavík') throw new Error("the file's Iceland row isn't Ísland, Reykjavík");
/** Each script's first row whose native name holds it. */
const scriptRows = Object.fromEntries(
  SCRIPTS.map((script) => {
    const pattern = new RegExp(`\\p{Script=${script}}`, 'u');
    const row = rows.findIndex((row) => pattern.test(row[1]!));
    if (row < 0) throw new Error(`no name in ${script} in the file`);
    return [script, row];
  }),
) as Record<string, number>;
/** Every text a screen reader or Translate should reach: names, English names, capitals. */
const texts = [...new Set(rows.flatMap((row) => [row[1]!, row[2]!, row[3]!]).filter((text) => text.length > 0))];

// ---------------------------------------------------------------------------

async function context(browser: Browser): Promise<BrowserContext> {
  const context = await protocolContext(browser, { dpr: DPR });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  return context;
}

async function opened(context: BrowserContext, url: string): Promise<{ page: Page; found: () => string[] }> {
  const page = await context.newPage();
  const all = problems(page);
  // The GPU's: headless Chromium's WebGPU without an adapter (GPUI falls
  // back to WebGL2), and the screenshots' read-back stalls.
  const found = () => all.filter((problem) => !/No available adapters|GL Driver Message/.test(problem));
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto(url);
  await waitMark(page, MARKS.filled);
  return { page, found };
}

/** Adds the controls' DOM text to the page, above everything. */
const addControl = (page: Page) =>
  page.evaluate((text) => {
    const control = document.createElement('div');
    control.id = 'seiza-control';
    control.textContent = text;
    Object.assign(control.style, { position: 'fixed', left: '600px', top: '860px', zIndex: '99', font: '16px sans-serif', background: '#fff', color: '#000', padding: '4px' });
    document.body.append(control);
  }, CONTROL_TEXT);
const removeControl = (page: Page) => page.evaluate(() => document.getElementById('seiza-control')?.remove());

const find = (page: Page, text: string) =>
  page.evaluate((text) => {
    getSelection()?.removeAllRanges();
    return (window as unknown as { find(text: string, caseSensitive: boolean, backwards: boolean, wrap: boolean): boolean }).find(text, true, false, true);
  }, text);

/** Drags from `from` to `to` (CSS px) with the mouse, then returns the selection. */
async function drag(page: Page, from: [number, number], to: [number, number]): Promise<string> {
  await page.evaluate(() => getSelection()?.removeAllRanges());
  await page.mouse.move(...from);
  await page.mouse.down();
  await page.mouse.move(...to, { steps: 8 });
  await page.mouse.up();
  return page.evaluate(() => getSelection()?.toString() ?? '');
}

async function copied(page: Page): Promise<string> {
  await page.keyboard.press('ControlOrMeta+C');
  await page.waitForTimeout(100);
  return page.evaluate(() => navigator.clipboard.readText());
}

/** The control's drag: across its text, from just left of it to past its end. */
async function controlDrag(page: Page): Promise<string> {
  const box = await page.locator('#seiza-control').boundingBox();
  if (!box) return '';
  return drag(page, [box.x + 1, box.y + box.height / 2], [box.x + box.width - 1, box.y + box.height / 2]);
}

interface AXNode {
  role?: { value?: string };
  name?: { value?: string };
  ignored?: boolean;
}
async function axTree(page: Page): Promise<AXNode[]> {
  const cdp = await page.context().newCDPSession(page);
  const { nodes } = (await cdp.send('Accessibility.getFullAXTree')) as { nodes: AXNode[] };
  await cdp.detach();
  return nodes.filter((node) => !node.ignored);
}
const named = (nodes: AXNode[], name: string) => nodes.some((node) => node.name?.value === name);

const innerText = (page: Page) => page.evaluate(() => document.body.innerText);

/** The pixels of `box` (CSS px) at the page's DPR, decoded in the page. */
async function pixels(page: Page, box: { x: number; y: number; width: number; height: number }): Promise<{ width: number; height: number; data: number[] }> {
  const shot = await page.screenshot({ type: 'png', clip: box });
  return page.evaluate(async (base64) => {
    const image = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob());
    const canvas = new OffscreenCanvas(image.width, image.height);
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);
    return { width: image.width, height: image.height, data: [...context.getImageData(0, 0, image.width, image.height).data] };
  }, shot.toString('base64'));
}

/** The largest spread between a pixel's channels. */
function chroma({ data }: { data: number[] }): number {
  let most = 0;
  for (let i = 0; i < data.length; i += 4) most = Math.max(most, Math.max(data[i]!, data[i + 1]!, data[i + 2]!) - Math.min(data[i]!, data[i + 1]!, data[i + 2]!));
  return most;
}

/** Each device column's ink (darkness below the crop's most common
 *  luminance, summed), and the ink's extent: its first and last columns. */
function ink({ width, height, data }: { width: number; height: number; data: number[] }): { profile: number[]; first: number; last: number } {
  const lum = (i: number) => 0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!;
  const counts = new Map<number, number>();
  for (let i = 0; i < data.length; i += 4) counts.set(Math.round(lum(i)), (counts.get(Math.round(lum(i))) ?? 0) + 1);
  const background = [...counts].sort((a, b) => b[1] - a[1])[0]![0];
  const profile = Array.from({ length: width }, (_, x) => {
    let sum = 0;
    for (let y = 0; y < height; y++) sum += Math.max(0, background - lum((y * width + x) * 4) - 24);
    return sum;
  });
  const first = profile.findIndex((value) => value > 0);
  const last = profile.findLastIndex((value) => value > 0);
  return { profile, first, last };
}

/** How `drawn` compares with `reference`: their ink widths' difference
 *  (CSS px) and their profiles' correlation, aligned at the ink's left. */
function compare(drawn: ReturnType<typeof ink>, reference: ReturnType<typeof ink>): { widthPx: number; correlation: number; match: boolean } {
  if (drawn.first < 0 || reference.first < 0) return { widthPx: Infinity, correlation: 0, match: false };
  const a = drawn.profile.slice(drawn.first, drawn.last + 1);
  const b = reference.profile.slice(reference.first, reference.last + 1);
  const widthPx = Math.abs(a.length - b.length) / DPR;
  const n = Math.max(a.length, b.length);
  const at = (values: number[], i: number) => values[i] ?? 0;
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / n;
  const [ma, mb] = [mean(a), mean(b)];
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < n; i++) {
    const [da, db] = [at(a, i) - ma, at(b, i) - mb];
    ab += da * db;
    aa += da * da;
    bb += db * db;
  }
  const correlation = aa && bb ? ab / Math.sqrt(aa * bb) : 0;
  return { widthPx, correlation, match: widthPx <= WIDTH_PX && correlation >= MIN_CORRELATION };
}

// ---------------------------------------------------------------------------

async function tanstack(browser: Browser, server: AppServer): Promise<void> {
  console.log('\nTanStack');
  const ctx = await context(browser);
  try {
    const { page, found } = await opened(ctx, `${server.url}${QUERY}`);
    const side: Record<string, unknown> = {};
    results.tanstack = side;
    const cell = (row: number, column: number) => page.locator(`[data-row="${row}"] [role=cell]`).nth(column);

    // Find.
    const foundIt = await find(page, 'Ísland');
    // `window.find` selects the match but doesn't scroll to it (the find
    // bar does: the manual check); the selection is Iceland's row's.
    const foundRow = await page.evaluate(() => {
      const selection = getSelection();
      if (!selection?.rangeCount) return -1;
      const node = selection.getRangeAt(0).startContainer;
      return Number(((node instanceof Element ? node : node.parentElement)?.closest('[data-row]') as HTMLElement | null)?.dataset.row ?? -1);
    });
    check(foundIt && foundRow === ICELAND, `TanStack: window.find("Ísland") finds it, in Iceland's row (found ${foundIt}, row ${foundRow})`);
    await addControl(page);
    check((await find(page, CONTROL_TEXT)) && !(await find(page, ABSENT)), "TanStack's control: the page's DOM text is found, a word not in the file isn't");

    // Select and copy.
    await page.evaluate(() => navigator.clipboard.writeText('before'));
    const capital = cell(ICELAND, COLUMNS.indexOf('capital'));
    await capital.scrollIntoViewIfNeeded();
    const text = await capital.evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const rect = range.getBoundingClientRect();
      const box = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right, y: rect.top + rect.height / 2, cellLeft: box.left, cellRight: box.right };
    });
    const selected = await drag(page, [Math.max(text.cellLeft + 1, text.left - 2), text.y], [Math.min(text.cellRight - 1, text.right + 4), text.y]);
    const clipboard = await copied(page);
    check(selected === 'Reykjavík' && clipboard === 'Reykjavík', `TanStack: a drag across Reykjavík's cell selects it and the copy holds it (selected ${JSON.stringify(selected)}, clipboard ${JSON.stringify(clipboard)})`);
    check((await controlDrag(page)) === CONTROL_TEXT, "TanStack's control: a drag across the page's DOM text selects it");

    // A screen reader.
    const nodes = await axTree(page);
    const count = (role: string) => nodes.filter((node) => node.role?.value === role).length;
    const aria = await page.evaluate(() => {
      const table = document.querySelector('[role=table]');
      const indices = [...document.querySelectorAll('[role=row][aria-rowindex]')].map((row) => Number(row.getAttribute('aria-rowindex')));
      return { rowcount: Number(table?.getAttribute('aria-rowcount')), indices };
    });
    const dataIndices = aria.indices.filter((index) => index > 1).sort((a, b) => a - b);
    const icelandNamed = rows[ICELAND]!.slice(1, 4).every((text) => nodes.some((node) => node.role?.value === 'cell' && node.name?.value === text));
    side.ax = { table: count('table'), row: count('row'), columnheader: count('columnheader'), cell: count('cell'), rowcount: aria.rowcount };
    check(
      count('table') === 1 && count('row') === rows.length + 1 && count('columnheader') === COLUMNS.length && aria.rowcount === rows.length + 1 && dataIndices.length === rows.length && dataIndices[0] === 2 && dataIndices.at(-1) === rows.length + 1 && icelandNamed,
      `TanStack: the tree's table holds ${count('row')} rows (${rows.length + 1}), ${count('columnheader')} column headers, aria-rowcount ${aria.rowcount}, rows 2–${rows.length + 1} indexed, Iceland's cells named (${icelandNamed})`,
    );
    check(named(nodes, CONTROL_TEXT), "TanStack's control: the page's DOM text is named in the tree");

    // Every script drawn: each in a platform face, never the last resort.
    await removeControl(page);
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('DOM.enable');
    await cdp.send('CSS.enable');
    const fontsOf = async (selector: string) => {
      const { root } = (await cdp.send('DOM.getDocument', { depth: 0 })) as { root: { nodeId: number } };
      const { nodeId } = (await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector })) as { nodeId: number };
      const { fonts } = (await cdp.send('CSS.getPlatformFontsForNode', { nodeId })) as { fonts: { familyName: string; glyphCount: number }[] };
      return fonts.map((font) => font.familyName);
    };
    // A character no face has is drawn as the first face's notdef, and
    // reported as that face: IBM Plex Sans, which lacks all 15 scripts.
    const lastResort = (families: string[]) => families.every((family) => family === 'IBM Plex Sans' || /last ?resort/i.test(family));
    const platform: Record<string, string[]> = {};
    for (const script of SCRIPTS) platform[script] = await fontsOf(`[data-row="${scriptRows[script]}"] [role=cell]:nth-of-type(${COLUMNS.indexOf('name') + 2})`);
    side.scripts = platform;
    const missing = SCRIPTS.filter((script) => lastResort(platform[script]!));
    check(missing.length === 0, `TanStack: every script's name in a system face (${missing.length ? `the last resort for ${missing.join(', ')}` : SCRIPTS.map((script) => `${script} ${platform[script]!.join('+')}`).join('; ')})`);
    await page.evaluate(() => {
      const span = document.createElement('span');
      span.id = 'seiza-pua';
      span.textContent = '\u0378\u0379';
      document.body.append(span);
    });
    const pua = await fontsOf('#seiza-pua');
    check(lastResort(pua), `TanStack's control: unassigned code points drawn by no system face (${pua.join('+') || 'no face'})`);
    await page.evaluate(() => document.getElementById('seiza-pua')?.remove());
    await cdp.detach();

    // The flags.
    const flagged = await cellChroma(
      page,
      async (row, column) => {
        await cell(row, column).scrollIntoViewIfNeeded();
        return (await cell(row, column).boundingBox())!;
      },
      scriptRows.Arabic!,
    );
    side.flags = flagged;
    check(flagged.flag > FLAG_CHROMA && flagged.text < FLAG_CHROMA, `TanStack: the flag drawn in color (spread ${flagged.flag}), its control a text cell's gray (${flagged.text})`);

    // Translate's precondition.
    await addControl(page);
    const shown = await innerText(page);
    const absent = texts.filter((text) => !shown.includes(text));
    const noTranslate = await page.evaluate(() => document.querySelectorAll('[translate="no"]').length);
    check(absent.length === 0 && noTranslate === 0, `TanStack: every name, English name, and capital in the page's text (${absent.length} missing), nothing translate="no" (${noTranslate})`);
    check(shown.includes(CONTROL_TEXT), "TanStack's control: the page's DOM text is in its text");

    // The drawn text against cells.json's.
    const fixture = JSON.parse(readFileSync(new URL('../../../components/tall-table/fixtures/cells.json', import.meta.url), 'utf8')) as {
      scenarios: Record<string, { cells: { row: number; column: string; shown: string }[] }>;
    };
    const cells = fixture.scenarios[ADMIN_TABLE.id]!.cells;
    const drawn = await page.evaluate(
      (wanted) => wanted.map(({ row, column }) => document.querySelector(`[data-row="${row}"]`)?.querySelectorAll('[role=cell]')[column]?.textContent ?? null),
      cells.map(({ row, column }) => ({ row, column: COLUMNS.indexOf(column as (typeof COLUMNS)[number]) })),
    );
    const wrong = cells.filter((cell, i) => drawn[i] !== cell.shown);
    check(cells.length > 0 && wrong.length === 0, `TanStack: cells.json's ${cells.length} admin table cells drawn as its shown text${wrong.length ? ` (${wrong.length} differ, first row ${wrong[0]!.row} ${wrong[0]!.column})` : ''}`);
    const latin1 = (text: string) => Buffer.from(text, 'utf8').toString('latin1');
    const misread = cells.filter((cell, i) => drawn[i] !== latin1(cell.shown)).length;
    check(misread > 0, `the drawn text's control: the fixture read as Latin-1 differs (${misread} of ${cells.length} cells)`);

    check(found().length === 0, `TanStack: no errors${found().length ? ` (${found().join('; ')})` : ''}`);
  } finally {
    await ctx.close();
  }
}

/** The flag cell's color spread and a text cell's, on `row`. */
async function cellChroma(page: Page, box: (row: number, column: number) => Promise<{ x: number; y: number; width: number; height: number }>, row: number): Promise<{ flag: number; text: number }> {
  const flag = chroma(await pixels(page, await box(row, COLUMNS.indexOf('flag'))));
  const text = chroma(await pixels(page, await box(row, COLUMNS.indexOf('in English'))));
  return { flag, text };
}

// ---------------------------------------------------------------------------

async function gpui(browser: Browser, server: AppServer): Promise<void> {
  console.log('\nGPUI');
  const side: Record<string, unknown> = {};
  results.gpui = side;

  // The default: the platform's tools reach nothing; the scripts' gap.
  {
    const ctx = await context(browser);
    try {
      const { page, found } = await opened(ctx, `${server.url}${QUERY}&measure&cells`);
      // Before the pixels' references, which load the faces themselves.
      await page.waitForTimeout(1000);
      const faces = await facesFetched(page);
      const fontsMark = await page.evaluate((name) => performance.getEntriesByName(name).length, MARKS.fonts);
      check(faces.length === 0 && fontsMark === 0, `GPUI without ?fonts: no face fetched (${faces.length}), no fonts mark (${fontsMark})`);

      check(!(await find(page, 'Ísland')), 'GPUI: window.find("Ísland") finds nothing');
      await addControl(page);
      check((await find(page, CONTROL_TEXT)) && !(await find(page, ABSENT)), "GPUI's control: the page's DOM text is found, a word not in the file isn't");

      await page.evaluate(() => navigator.clipboard.writeText('before'));
      const table = await targetRect(page, 'table');
      const columns = await page.waitForFunction(() => (globalThis as Global).__contender?.columns).then((handle) => handle.jsonValue() as Promise<{ name: string; x: number; width: number }[]>);
      const capital = columns.find((column) => column.name === 'capital')!;
      const y = table[1] + 15;
      const selected = await drag(page, [capital.x + 2, y], [capital.x + capital.width - 2, y + 60]);
      const clipboard = await copied(page);
      check(selected === '' && clipboard === 'before', `GPUI: a drag across its cells selects nothing and the copy leaves the clipboard (selected ${JSON.stringify(selected)}, clipboard ${JSON.stringify(clipboard)})`);
      check((await controlDrag(page)) === CONTROL_TEXT, "GPUI's control: a drag across the page's DOM text selects it");

      const nodes = await axTree(page);
      const reached = texts.filter((text) => named(nodes, text));
      check(reached.length === 0, `GPUI: no node in the tree named by the file's texts (${reached.length} named)`);
      check(named(nodes, CONTROL_TEXT), "GPUI's control: the page's DOM text is named in the tree");

      const shown = await innerText(page);
      const inText = texts.filter((text) => shown.includes(text));
      check(inText.length === 0, `GPUI: none of the file's texts in the page's text (${inText.length})`);
      check(shown.includes(CONTROL_TEXT), "GPUI's control: the page's DOM text is in its text");
      await removeControl(page);

      const box = await cellBoxes(page, columns, table);
      const flagged = await cellChroma(page, box, scriptRows.Arabic!);
      side.flags = flagged;
      check(flagged.flag > FLAG_CHROMA && flagged.text < FLAG_CHROMA, `GPUI: the flag drawn in color (spread ${flagged.flag}), its control a text cell's gray (${flagged.text})`);

      const scripts = await drawnScripts(page, box, 'default');
      side.scriptsDefault = scripts;
      const matched = SCRIPTS.filter((script) => scripts[script]!.match);
      check(matched.length === 0, `GPUI by default: no script's name drawn as the DOM draws it (${matched.length ? matched.join(', ') : 'each its notdef boxes'})`);
      check(scripts.Latin!.match, `GPUI's control by default: Latin's name drawn as the DOM draws it (width ±${scripts.Latin!.widthPx} px, r ${scripts.Latin!.correlation.toFixed(2)})`);

      check(found().length === 0, `GPUI: no errors${found().length ? ` (${found().join('; ')})` : ''}`);
    } finally {
      await ctx.close();
    }
  }

  // With `?fonts`: the faces after the rows, then every script drawn.
  {
    const ctx = await context(browser);
    await ctx.addInitScript(presentingTaskRecorder);
    try {
      const { page, found } = await opened(ctx, `${server.url}${QUERY}&fonts&measure&cells`);
      const filled = (await page.evaluate((name) => performance.getEntriesByName(name)[0]?.startTime ?? NaN, MARKS.filled)) as number;
      const fontsAt = await waitMark(page, MARKS.fonts);
      const fontsIn = (await page.evaluate((name) => performance.getEntriesByName(name).at(-1)?.startTime ?? NaN, MARKS.fontsIn)) as number;
      const presented = await presentedMark(page, fontsAt);
      const faces = await facesFetched(page);
      const { once: fetchedOnce, afterRows } = facesChecked(faces, filled);
      side.fonts = {
        filled,
        fontsIn,
        fonts: fontsAt,
        inToDrawnMs: fontsAt - fontsIn,
        presented: presented.detail,
        faces: Object.fromEntries(faces.map((entry) => [entry.name.slice(entry.name.lastIndexOf('/') + 1), { transferSize: entry.transferSize, encodedBodySize: entry.encodedBodySize, decodedBodySize: entry.decodedBodySize }])),
      };
      check(fetchedOnce && afterRows, `GPUI with ?fonts: each of the ${SCRIPT_FACES.length} faces fetched once from ${SCRIPT_FONTS}, after the rows were in (${faces.length} fetched)`);
      check(filled < fontsIn && fontsIn < fontsAt, `GPUI with ?fonts: filled (${filled.toFixed(0)}) → fonts in (${fontsIn.toFixed(0)}) → drawn (${fontsAt.toFixed(0)} ms)`);
      check(presented.ok, `GPUI with ?fonts: contender:fonts right after a presented frame (${presented.detail})`);

      const table = await targetRect(page, 'table');
      const columns = await page.waitForFunction(() => (globalThis as Global).__contender?.columns).then((handle) => handle.jsonValue() as Promise<{ name: string; x: number; width: number }[]>);
      const box = await cellBoxes(page, columns, table);
      const scripts = await drawnScripts(page, box, 'fonts');
      side.scriptsFonts = scripts;
      const unmatched = SCRIPTS.filter((script) => !scripts[script]!.match);
      check(unmatched.length === 0, `GPUI with ?fonts: every script's name drawn as the DOM draws it in the same face (${unmatched.length ? `not ${unmatched.map((script) => `${script} ±${scripts[script]!.widthPx} px r ${scripts[script]!.correlation.toFixed(2)}`).join(', ')}` : 'all 15'})`);
      const crossed = SCRIPTS.filter((script) => (scripts[script] as Drawn).againstOther);
      check(crossed.length === 0, `GPUI's control with ?fonts: no script's name matches another script's drawing (${crossed.join(', ') || 'none'})`);
      check(found().length === 0, `GPUI with ?fonts: no errors${found().length ? ` (${found().join('; ')})` : ''}`);
    } finally {
      await ctx.close();
    }
  }

  // A face off its pin (the Arabic face cut short, served 200): the wasm's
  // `add_fonts` would take it without an error, so the host's pin check
  // must refuse all of them.
  {
    const ctx = await context(browser);
    try {
      const arabic = SCRIPT_FACES.find((face) => face.script === 'Arabic')!;
      await ctx.route(`**${SCRIPT_FONTS}${faceFile(arabic)}`, async (route) => {
        const response = await route.fetch();
        await route.fulfill({ response, body: (await response.body()).subarray(0, 4096) });
      });
      const { page, found } = await opened(ctx, `${server.url}${QUERY}&fonts&measure`);
      await waitMark(page, MARKS.fontsFailed);
      await page.waitForTimeout(500);
      const marks = await page.evaluate((names) => names.map((name) => performance.getEntriesByName(name).length), [MARKS.fontsIn, MARKS.fonts]);
      const errors = found().filter((problem) => !problem.includes('the script fonts failed'));
      check(marks[0] === 0 && marks[1] === 0 && errors.length === 0, `GPUI's control with ?fonts: a face off its pin marks contender:fonts-failed, never fonts-in or fonts (${marks.join(', ')})`);
    } finally {
      await ctx.close();
    }
  }
}

type Box = { x: number; y: number; width: number; height: number };

/** A GPUI cell's box once its row is at the view's top (the replay's jump). */
async function cellBoxes(page: Page, columns: { name: string; x: number; width: number }[], table: [number, number, number, number]) {
  return async (row: number, column: number): Promise<Box> => {
    await page.evaluate((fraction) => (globalThis as Global).__contender!.replay.jump(fraction), row / rows.length);
    await page.waitForTimeout(150);
    const top = await page.evaluate(() => (globalThis as Global).__contender?.state?.top ?? 0);
    const { x, width } = columns.find((found) => found.name === COLUMNS[column])!;
    return { x, y: table[1] + row * 30 - top, width, height: 30 };
  };
}

interface Drawn {
  row: number;
  text: string;
  widthPx: number;
  correlation: number;
  match: boolean;
  /** The name matched another script's drawing (the control). */
  againstOther?: boolean;
}

/** Each script's name as GPUI draws it, against the DOM's drawing of it in
 *  the face GPUI would use; Latin's (Iceland's) too, the default's control. */
async function drawnScripts(page: Page, box: (row: number, column: number) => Promise<Box>, state: string): Promise<Record<string, Drawn>> {
  // The references' faces, from the same files GPUI loads.
  await page.evaluate(
    ({ faces, ui }) => {
      const style = document.createElement('style');
      style.textContent = [`@font-face { font-family: 'Ref Plex'; src: url('${ui}'); }`, ...faces.map(([script, url]) => `@font-face { font-family: 'Ref ${script}'; src: url('${url}'); }`)].join('\n');
      document.head.append(style);
    },
    { faces: SCRIPT_FACES.map((face) => [face.script, `${SCRIPT_FONTS}${faceFile(face)}`]), ui: UI_FONT },
  );
  const out: Record<string, Drawn> = {};
  const name = COLUMNS.indexOf('name');
  const references: Record<string, ReturnType<typeof ink>> = {};
  const drawnInk: Record<string, ReturnType<typeof ink>> = {};
  for (const script of ['Latin', ...SCRIPTS]) {
    const row = script === 'Latin' ? ICELAND : scriptRows[script]!;
    const text = rows[row]![name]!;
    const cellBox = await box(row, name);
    const drawn = ink(await pixels(page, cellBox));
    const face = SCRIPT_FACES.some((found) => found.script === script) ? `'Ref Plex', 'Ref ${script}'` : `'Ref Plex', sans-serif`;
    const reference = ink(await referencePixels(page, text, face, cellBox));
    references[script] = reference;
    drawnInk[script] = drawn;
    const { widthPx, correlation, match } = compare(drawn, reference);
    out[script] = { row, text, widthPx: Math.round(widthPx * 10) / 10, correlation: Math.round(correlation * 100) / 100, match };
    if (shots) {
      mkdirSync(shots, { recursive: true });
      await page.screenshot({ path: join(shots, `${state}-${script}-gpui.png`), clip: cellBox });
    }
  }
  // The control: each name against the next script's drawing.
  for (const [i, script] of SCRIPTS.entries()) out[script]!.againstOther = compare(drawnInk[script]!, references[SCRIPTS[(i + 1) % SCRIPTS.length]!]!).match;
  return out;
}

/** `text` drawn by the DOM in `face` at the table's text size, over the cell's box. */
async function referencePixels(page: Page, text: string, face: string, cellBox: Box): Promise<{ width: number; height: number; data: number[] }> {
  await page.evaluate(
    async ({ text, face, cellBox }) => {
      document.getElementById('seiza-reference')?.remove();
      const reference = document.createElement('div');
      reference.id = 'seiza-reference';
      reference.textContent = text;
      Object.assign(reference.style, {
        position: 'fixed',
        left: `${cellBox.x}px`,
        top: `${cellBox.y}px`,
        width: `${cellBox.width}px`,
        height: `${cellBox.height}px`,
        lineHeight: `${cellBox.height}px`,
        padding: '0 8px',
        boxSizing: 'border-box',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        font: `14px ${face}`,
        color: '#0a0a0a',
        background: '#fff',
        zIndex: '99',
      });
      document.body.append(reference);
      await document.fonts.load(`14px ${face}`, text);
      await document.fonts.ready;
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    },
    { text, face, cellBox },
  );
  const shot = await pixels(page, cellBox);
  await page.evaluate(() => document.getElementById('seiza-reference')?.remove());
  return shot;
}

// ---------------------------------------------------------------------------

const browser = await chromium.launch();
try {
  for (const side of sides) {
    const server = side === 'gpui' ? await serveGpui(PORTS.gpui) : await serveTanstack(PORTS.tanstack);
    try {
      if (side === 'tanstack') await tanstack(browser, server);
      else await gpui(browser, server);
    } finally {
      await server.close();
    }
  }
} finally {
  await browser.close();
}

if (label) {
  const out = join(perfDir, 'results', `${localDate()}-${label}.json`);
  mkdirSync(join(perfDir, 'results'), { recursive: true });
  writeFileSync(out, `${JSON.stringify({ date: localDate(), machine: machineInfo(), failures, results }, null, 2)}\n`);
  console.log(`wrote ${out}`);
}
if (failures.length) {
  console.error(`\n${failures.length} failed:\n${failures.map((failure) => `  ${failure}`).join('\n')}`);
  process.exit(1);
}
console.log('\nadmin: every capability as the panel says, on both sides, each control failing as it must');
