// The wide sheet's tools on a contender's release build (`perf/wide.ts`
// runs them): the table's `resize`, `select`, and `copy` and their
// contract (`docs/contender-contract.md`, "Marks", "State", "The copy
// line"), each through real input:
//
// - a day's band dragged 60 px (the width, `__contender.widths`, the
//   layout republished) and double-clicked (fitted); a pinned column's
//   band dragged far right, held where the pin stays;
// - a selection drag (`__contender.selection`);
// - the week (Jan 1–7, a header press and Shift+press on the seventh:
//   74,424 cells) copied by the key, and a block across the pinned edge,
//   each pasted text native DuckDB's values to the byte (the table's exact
//   text, tab-separated, a row a line);
// - the sheet (Cmd+A): Cmd+C declined (nothing read, its mark), then
//   Cmd+C again on it written, its text DuckDB's to the byte (the control:
//   a selection change in between declines again); Ctrl+C; Cmd+Shift+C
//   (the browsers' Inspect) copying nothing;
// - the marks in order (started, copied, written; declined alone), and
//   none of the globals without `?measure` (the control);
// - from a parent page on the same origin, in Chromium, Firefox, and
//   WebKit: the frame with `?readout` tells the page each selection and
//   copy (`{ seiza: 'tools', … }`), and the page's button calling
//   `__contenderTools.copy()` inside its click writes the clipboard (a real
//   paste reads it); a frame without `?readout` sends nothing and exports
//   nothing (the control);
// - on touch (Chromium, `hasTouch`): a tap selects; a touch drag on a
//   band is reported, resizing or not.

import { chromium, firefox, webkit, type Browser, type BrowserType, type Frame, type Page } from '@playwright/test';
import { waitMark } from '../../../shared-web/perf/harness.ts';
import type { Side } from '../contenders/contract.ts';
import { WIDE_SHEET } from '../contenders/scenarios.ts';
import { COPY_MARKS, type ToolsMessage } from '../contenders/tools.ts';
import { exactText } from '../contenders/tall-table/tanstack/web/src/data/format.ts';
import { MARKS, dataPath, problems, protocolContext, type NativeConnection } from './harness.ts';

interface Layout {
  left: number;
  top: number;
  rowHeight: number;
  cellsWidth: number;
  pinned: number;
  columns: { name: string; x: number; width: number }[];
}
interface Selection {
  kind: string;
  anchor: [number, number];
  head: [number, number];
}
interface Contender {
  layout?: Layout;
  widths?: (number | null)[];
  selection?: Selection | null;
  copy?: { state: string; bytes?: number };
}
type Global = { __contender?: Contender; __contenderTools?: unknown };
type Target = Page | Frame;

const QUERY = `?measure&scenario=${WIDE_SHEET.id}&stop=${WIDE_SHEET.defaultStop}`;

/** The table's text for `columns` of rows `[from, from + count)`: each
 *  value's exact text (a double's Rust `{:?}`, a text quoted when it holds
 *  a tab, a line break, or `"`), NULL empty, tab-separated, a row a line. */
async function duckText(conn: NativeConnection, columns: string[], from: number, count: number): Promise<string> {
  const file = dataPath(WIDE_SHEET.data).replaceAll("'", "''");
  const list = columns.map((name) => `"${name.replaceAll('"', '""')}"`).join(', ');
  const rows = (await conn.runAndReadAll(`SELECT ${list} FROM read_parquet('${file}') LIMIT ${count} OFFSET ${from}`)).getRows();
  const field = (value: unknown) => {
    if (value === null || value === undefined) return '';
    if (typeof value === 'number') return exactText(value);
    const text = String(value);
    return /[\t\n\r"]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  return rows.map((row) => row.map(field).join('\t')).join('\n');
}

/** `__contender.layout` once it shows every set width (`widths`): the
 *  table republishes it at the frame after a release or a fit. */
const layoutOf = (target: Target) =>
  target
    .waitForFunction(
      () => {
        const contender = (globalThis as Global).__contender;
        const layout = contender?.layout;
        const widths = contender?.widths ?? [];
        return layout && widths.every((width, column) => width === null || layout.columns[column]?.width === width) ? layout : false;
      },
      null,
      { timeout: 10_000 },
    )
    .then(async (handle) => (await handle.jsonValue()) as Layout);

/** A column's band's x (its right edge) and the header's y, at the top and no sideways scroll. */
const edge = (layout: Layout, column: number) => layout.left + layout.columns[column]!.x + layout.columns[column]!.width;
const headerY = (layout: Layout) => layout.top - Math.min(8, layout.rowHeight / 2);
/** Cell `[row, column]`'s center, at the top and no sideways scroll. */
const cellAt = (layout: Layout, row: number, column: number): [number, number] => [layout.left + layout.columns[column]!.x + layout.columns[column]!.width / 2, layout.top + (row + 0.5) * layout.rowHeight];

/** `__contender[key]`, as the page has it now. */
const read = <K extends keyof Contender>(target: Target, key: K) => target.evaluate((key) => (globalThis as Global).__contender?.[key] ?? null, key) as Promise<Contender[K] | null>;

/** Waits until `__contender.selection` is `want`'s kind, anchor, and head. */
async function selected(target: Target, want: Selection): Promise<string | null> {
  try {
    await target.waitForFunction((want) => {
      const got = (globalThis as Global).__contender?.selection;
      return got && got.kind === want.kind && got.anchor.join() === want.anchor.join() && got.head.join() === want.head.join();
    }, want, { timeout: 5_000 });
    return null;
  } catch {
    return `selection ${JSON.stringify(await read(target, 'selection'))}, not ${JSON.stringify(want)}`;
  }
}

/** The copy's marks set since `since`, in order of time. */
const copyMarks = (page: Page, since: number) =>
  page.evaluate(
    ({ names, since }) =>
      performance
        .getEntriesByType('mark')
        .filter((entry) => names.includes(entry.name) && entry.startTime >= since)
        .sort((a, b) => a.startTime - b.startTime)
        .map((entry) => entry.name),
    { names: Object.values(COPY_MARKS) as string[], since },
  );

/** Copies by `keys` from now and reads it back: the marks in order and the clipboard's text. */
async function copied(page: Page, keys: string): Promise<{ marks: string[]; text: string; state: string | undefined }> {
  const since = await page.evaluate(() => performance.now());
  await page.keyboard.press(keys);
  await waitMark(page, COPY_MARKS.written, since, 120_000);
  const text = await page.evaluate(() => navigator.clipboard.readText());
  return { marks: await copyMarks(page, since), text, state: (await read(page, 'copy'))?.state };
}

const ORDER = [COPY_MARKS.started, COPY_MARKS.copied, COPY_MARKS.written].join(' → ');

/** The tools on `side`'s wide build at `url`, in Chromium. */
export async function checkTools(browser: Browser, side: Side, url: string, conn: NativeConnection, fail: (what: string) => void): Promise<Record<string, unknown>> {
  const results: Record<string, unknown> = {};
  const context = await protocolContext(browser);
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(url).origin });
  const page = await context.newPage();
  const found = problems(page);
  const names = (await (await conn.runAndReadAll(`SELECT column_name FROM (DESCRIBE SELECT * FROM read_parquet('${dataPath(WIDE_SHEET.data).replaceAll("'", "''")}'))`)).getRows()).map((row) => String(row[0]));
  const rows = Number((await (await conn.runAndReadAll(`SELECT count(*) FROM read_parquet('${dataPath(WIDE_SHEET.data).replaceAll("'", "''")}')`)).getRows())[0]![0]);
  try {
    await page.goto(`${url}${QUERY}`);
    await waitMark(page, MARKS.filled, 0, 60_000);
    let layout = await layoutOf(page);
    const jan1 = WIDE_SHEET.heatFrom;

    // A day's band: dragged 60 px wider, then double-clicked (fitted).
    const before = layout.columns[jan1]!.width;
    const x = edge(layout, jan1);
    const y = headerY(layout);
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 60, y, { steps: 6 });
    await page.mouse.up();
    const widened = await page
      .waitForFunction((column) => (globalThis as Global).__contender?.widths?.[column] ?? false, jan1, { timeout: 5_000 })
      .then((handle) => handle.jsonValue() as Promise<number>)
      .catch(() => null);
    layout = await layoutOf(page);
    if (widened !== before + 60) fail(`${side} resize: Jan 1 set to ${widened} px by the drag, not ${before} + 60`);
    if (layout.columns[jan1]!.width !== before + 60) fail(`${side} resize: the layout's Jan 1 is ${layout.columns[jan1]!.width} px after the drag, not ${before + 60}`);
    await page.mouse.dblclick(edge(layout, jan1), y);
    const fitted = await page
      .waitForFunction((want) => { const width = (globalThis as Global).__contender?.widths?.[want.column]; return width !== want.dragged && width; }, { column: jan1, dragged: before + 60 }, { timeout: 5_000 })
      .then((handle) => handle.jsonValue() as Promise<number>)
      .catch(() => null);
    if (fitted === null || fitted >= before + 60 || fitted < 20) fail(`${side} resize: Jan 1 fitted to ${fitted} px by the double-click`);
    // A pinned column's band, dragged far right: held where the pin stays.
    layout = await layoutOf(page);
    const place = WIDE_SHEET.pinned - 1;
    const placeX = edge(layout, place);
    await page.mouse.move(placeX, y);
    await page.mouse.down();
    await page.mouse.move(placeX + 2_000, y, { steps: 10 });
    await page.mouse.up();
    await page.waitForFunction((column) => (globalThis as Global).__contender?.widths?.[column] != null, place, { timeout: 5_000 }).catch(() => fail(`${side} resize: Place's drag set no width`));
    layout = await layoutOf(page);
    const placeWidth = layout.columns[place]!.width;
    const pinnedEdge = layout.columns[place]!.x + placeWidth;
    if (layout.pinned !== WIDE_SHEET.pinned) fail(`${side} resize: ${layout.pinned} columns pinned after Place's drag, not ${WIDE_SHEET.pinned}`);
    if (pinnedEdge > layout.cellsWidth / 2 + 1) fail(`${side} resize: Place's drag left the pinned run ${pinnedEdge} px wide, past half the cells' ${layout.cellsWidth}`);
    results.resize = { dayWidth: before, dragged: widened, fitted, placeHeldAt: placeWidth, pinnedEdge, cellsWidth: layout.cellsWidth };
    console.log(`${side} resize: Jan 1 ${before} → ${widened} px by the drag, ${fitted} px fitted; Place held at ${placeWidth} px (the run ${pinnedEdge} of ${layout.cellsWidth} px)`);

    // A selection drag: Jan 1's top cell to five rows and three columns on.
    const [ax, ay] = cellAt(layout, 0, jan1);
    const [hx, hy] = cellAt(layout, 5, jan1 + 3);
    await page.mouse.move(ax, ay);
    await page.mouse.down();
    await page.mouse.move(hx, hy, { steps: 10 });
    await page.mouse.up();
    const dragged = await selected(page, { kind: 'cells', anchor: [0, jan1], head: [5, jan1 + 3] });
    if (dragged) fail(`${side} selection drag: ${dragged}`);

    // The week: a header press on Jan 1, Shift+press on Jan 7, Cmd+C.
    await page.mouse.click(cellAt(layout, 0, jan1)[0], y);
    await page.keyboard.down('Shift');
    await page.mouse.click(cellAt(layout, 0, jan1 + 6)[0], y);
    await page.keyboard.up('Shift');
    const week = await selected(page, { kind: 'columns', anchor: [0, jan1], head: [0, jan1 + 6] });
    if (week) fail(`${side} week: ${week}`);
    const weekCopy = await copied(page, 'ControlOrMeta+KeyC');
    const weekText = await duckText(conn, names.slice(jan1, jan1 + 7), 0, rows);
    if (weekCopy.text !== weekText) fail(`${side} week: the clipboard's ${weekCopy.text.length} characters aren't DuckDB's ${weekText.length}`);
    if (weekCopy.marks.join(' → ') !== ORDER) fail(`${side} week: marks ${weekCopy.marks.join(' → ')}, not ${ORDER}`);
    if (weekCopy.state !== 'written') fail(`${side} week: __contender.copy ${weekCopy.state}`);
    console.log(`${side} week: ${rows * 7} cells, ${weekText.length} characters, DuckDB's: ${weekCopy.text === weekText}; marks ${weekCopy.marks.join(' → ')}`);

    // A block across the pinned edge: Place (pinned) to Jan 2, rows 3–9.
    await page.mouse.click(...cellAt(layout, 3, place));
    await page.keyboard.down('Shift');
    await page.mouse.click(...cellAt(layout, 9, jan1 + 1));
    await page.keyboard.up('Shift');
    const blockSelected = await selected(page, { kind: 'cells', anchor: [3, place], head: [9, jan1 + 1] });
    if (blockSelected) fail(`${side} block: ${blockSelected}`);
    const block = await copied(page, 'ControlOrMeta+KeyC');
    const blockText = await duckText(conn, names.slice(place, jan1 + 2), 3, 7);
    if (block.text !== blockText) fail(`${side} block: the clipboard's ${JSON.stringify(block.text.slice(0, 120))} isn't DuckDB's ${JSON.stringify(blockText.slice(0, 120))}`);
    console.log(`${side} block across the pinned edge: 7 rows × ${jan1 + 2 - place} columns, DuckDB's: ${block.text === blockText}`);

    // The sheet: Cmd+A (every column), Cmd+C declined; the selection changed
    // and selected again, Cmd+C declined again (the control); then Cmd+C
    // again on it, the confirming press, written.
    const selectAll = async () => {
      await page.keyboard.press('ControlOrMeta+KeyA');
      const all = await selected(page, { kind: 'columns', anchor: [0, 0], head: [0, names.length - 1] });
      if (all) fail(`${side} sheet: ${all}`);
    };
    /** Cmd+C now, and the copy's marks it set within 500 ms. */
    const declineOnce = async () => {
      const since = await page.evaluate(() => performance.now());
      await page.keyboard.press('ControlOrMeta+KeyC');
      await waitMark(page, COPY_MARKS.declined, since, 10_000).catch(() => {});
      await page.waitForTimeout(500);
      return copyMarks(page, since);
    };
    await selectAll();
    const declined = await declineOnce();
    if (declined.join() !== COPY_MARKS.declined) fail(`${side} sheet: marks after the first key ${declined.join(' → ') || 'none'}, not ${COPY_MARKS.declined}`);
    const declinedState = (await read(page, 'copy'))?.state;
    if (declinedState !== 'declined') fail(`${side} sheet: __contender.copy ${declinedState} after the key, not declined`);
    await page.mouse.click(...cellAt(layout, 0, jan1));
    await selectAll();
    const again = await declineOnce();
    if (again.join() !== COPY_MARKS.declined) fail(`${side} sheet control: after a selection change, the key set ${again.join(' → ') || 'nothing'}, not ${COPY_MARKS.declined} alone`);
    const sheet = await copied(page, 'ControlOrMeta+KeyC');
    const sheetText = await duckText(conn, names, 0, rows);
    if (sheet.text !== sheetText) fail(`${side} sheet: the clipboard's ${sheet.text.length} characters aren't DuckDB's ${sheetText.length}`);
    if (sheet.marks.join(' → ') !== ORDER) fail(`${side} sheet: marks ${sheet.marks.join(' → ')}, not ${ORDER}`);
    const bytes = Buffer.byteLength(sheetText);
    const sheetBytes = (await read(page, 'copy'))?.bytes;
    if (sheetBytes !== bytes) fail(`${side} sheet: __contender.copy says ${sheetBytes} bytes, DuckDB's text is ${bytes}`);
    console.log(`${side} sheet: Cmd+C ${declined.join()}; after a selection change ${again.join()} (the control); Cmd+C again ${(bytes / 2 ** 20).toFixed(1)} MiB, DuckDB's: ${sheet.text === sheetText}; marks ${sheet.marks.join(' → ')}`);
    // Ctrl+C too, on a cell; and Cmd+Shift+C (the browsers' Inspect) copies nothing.
    await page.mouse.click(...cellAt(layout, 0, jan1));
    const ctrl = await copied(page, 'Control+KeyC');
    const ctrlText = await duckText(conn, [names[jan1]!], 0, 1);
    if (ctrl.text !== ctrlText) fail(`${side} Ctrl+C: ${JSON.stringify(ctrl.text)}, not ${JSON.stringify(ctrlText)}`);
    const shiftSince = await page.evaluate(() => performance.now());
    await page.keyboard.press('ControlOrMeta+Shift+KeyC');
    await page.waitForTimeout(500);
    const shifted = await copyMarks(page, shiftSince);
    if (shifted.length) fail(`${side} Cmd+Shift+C: set ${shifted.join(' → ')}; it's no key of the table's`);
    // `layout` is republished at a layout change, never a frame: the same
    // object through a scroll down and sideways.
    await page.evaluate(() => ((globalThis as { __layoutHeld?: unknown }).__layoutHeld = (globalThis as Global).__contender?.layout));
    await page.mouse.move(...cellAt(layout, 8, jan1 + 4));
    for (let step = 0; step < 20; step++) await page.mouse.wheel(step % 2 ? 120 : 0, step % 2 ? 0 : 240);
    await page.waitForTimeout(800);
    const held = await page.evaluate(() => (globalThis as { __layoutHeld?: unknown }).__layoutHeld === (globalThis as Global).__contender?.layout);
    const moved = await page.evaluate(() => (globalThis as { __contender?: { state?: { top: number } } }).__contender?.state?.top ?? 0);
    if (!held || moved === 0) fail(`${side} layout: ${held ? 'held' : 'republished'} through a scroll that moved ${moved} px`);
    console.log(`${side} layout: the same object through a scroll of ${moved} px down and sideways: ${held}`);
    results.copy = { layoutHeldThroughScroll: held, weekCells: rows * 7, weekChars: weekText.length, weekSame: weekCopy.text === weekText, weekMarks: weekCopy.marks, blockSame: block.text === blockText, declinedMarks: declined, sheetBytes: bytes, sheetSame: sheet.text === sheetText, sheetMarks: sheet.marks, declinedAgainMarks: again, ctrlC: ctrl.text === ctrlText, cmdShiftCMarks: shifted };
    for (const problem of found) fail(`${side} tools: ${problem}`);
  } finally {
    await context.close();
  }

  // The control: without `?measure`, none of the globals.
  {
    const bare = await protocolContext(browser);
    const page = await bare.newPage();
    try {
      await page.goto(`${url}?scenario=${WIDE_SHEET.id}`);
      await waitMark(page, MARKS.filled, 0, 60_000);
      await page.keyboard.press('ControlOrMeta+KeyA');
      await page.waitForTimeout(300);
      const published = await page.evaluate(() => Object.keys((globalThis as Global).__contender ?? {}).filter((key) => ['layout', 'widths', 'selection', 'copy'].includes(key)));
      if (published.length) fail(`${side} control: ${published.join(', ')} published without ?measure`);
      results.unmeasured = published;
    } finally {
      await bare.close();
    }
  }
  return results;
}

/** A parent page on the frame's origin: the frame at `src`, the page's
 *  messages kept, and a button calling the frame's tools in its click. */
const PARENT = (src: string) => `<!doctype html><meta charset="utf-8"><body style="margin:0">
<button id="copy" style="position:fixed;right:8px;top:8px;width:120px;height:40px;z-index:1">Copy</button>
<iframe id="frame" src="${src}" style="position:fixed;left:0;top:60px;width:1200px;height:700px;border:0"></iframe>
<script>
  globalThis.__messages = [];
  addEventListener('message', (event) => { if (event.origin === location.origin) __messages.push(event.data); });
  document.getElementById('copy').addEventListener('click', () => {
    const tools = document.getElementById('frame').contentWindow.__contenderTools;
    globalThis.__called = Boolean(tools);
    tools?.copy();
  });
</script>`;

/** A real paste in `page`: a textarea focused, Cmd+V (Ctrl+V elsewhere), read. */
async function paste(page: Page): Promise<string> {
  await page.evaluate(() => {
    const area = document.createElement('textarea');
    area.id = '__paste';
    area.style.cssText = 'position:fixed;left:0;top:0;width:10px;height:10px;opacity:0';
    document.body.append(area);
    area.focus();
  });
  await page.keyboard.press('ControlOrMeta+V');
  const text = await page
    .waitForFunction(() => (document.getElementById('__paste') as HTMLTextAreaElement).value || false, null, { timeout: 15_000, polling: 20 })
    .then((handle) => handle.jsonValue() as Promise<string>)
    .catch(() => '');
  await page.evaluate(() => document.getElementById('__paste')!.remove());
  return text;
}

/** The page's copy line from a parent page, in `type`'s browser. */
export async function checkFromParent(type: BrowserType, side: Side, url: string, conn: NativeConnection, fail: (what: string) => void): Promise<Record<string, unknown>> {
  const name = `${side} page (${type.name()})`;
  const browser = await type.launch(type === chromium ? { channel: 'chromium' } : {});
  // Run at DPR 1, in `type`'s browser: recorded beside its results.
  const results: Record<string, unknown> = { browser: type.name(), version: browser.version(), deviceScaleFactor: 1 };
  try {
    for (const readout of [true, false]) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      if (type === chromium) await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(url).origin });
      const parentUrl = `${url}__parent.html`;
      const frameQuery = `?${readout ? 'readout&' : ''}measure&scenario=${WIDE_SHEET.id}`;
      await context.route(parentUrl, (route) => route.fulfill({ contentType: 'text/html', body: PARENT(`${url}${frameQuery}`), headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' } }));
      const page = await context.newPage();
      const found = problems(page);
      try {
        await page.goto(parentUrl);
        const frame = await (await page.waitForSelector('#frame')).contentFrame();
        if (!frame) throw new Error('no frame');
        await waitMark(frame, MARKS.filled, 0, 60_000);
        const layout = await layoutOf(frame);
        const jan1 = WIDE_SHEET.heatFrom;
        const offset = 60;
        // A block of 4 rows × 3 days, pressed in the frame.
        const [ax, ay] = cellAt(layout, 1, jan1);
        const [hx, hy] = cellAt(layout, 4, jan1 + 2);
        await page.mouse.click(ax, ay + offset);
        await page.keyboard.down('Shift');
        await page.mouse.click(hx, hy + offset);
        await page.keyboard.up('Shift');
        await page.waitForTimeout(400);
        await page.click('#copy');
        const messages = async () => (await page.evaluate(() => (globalThis as unknown as { __messages: { seiza?: string }[] }).__messages)).filter((message) => message.seiza === 'tools') as ToolsMessage[];
        if (readout) {
          const written = await page
            .waitForFunction(() => (globalThis as unknown as { __messages: { seiza?: string; copy?: string }[] }).__messages.some((message) => message.seiza === 'tools' && message.copy === 'written'), null, { timeout: 30_000 })
            .then(() => true)
            .catch(() => false);
          const told = await messages();
          const want = await duckText(conn, [0, 1, 2].map((day) => layout.columns[jan1 + day]!.name), 1, 4);
          const selection = told.find((message) => message.copy === null && message.cells === 12);
          const done = told.find((message) => message.copy === 'written');
          if (!selection) fail(`${name}: no message with the 12 cells selected (${JSON.stringify(told.slice(0, 4))})`);
          if (!written || !done) fail(`${name}: the button's copy wasn't written (${JSON.stringify(told.at(-1))}; ${JSON.stringify(await read(frame, 'copy'))})`);
          else if (done.bytes !== Buffer.byteLength(want)) fail(`${name}: written ${done.bytes} bytes, DuckDB's text is ${Buffer.byteLength(want)}`);
          const text = await paste(page);
          if (text !== want) fail(`${name}: pasted ${JSON.stringify(text)}, not ${JSON.stringify(want)}`);
          if (told.length > 12) fail(`${name}: ${told.length} tools messages for a selection and a copy`);
          results.readout = { messages: told.length, states: told.map((message) => message.copy), pasted: text === want, ms: done?.ms };
          console.log(`${name}: ${told.length} messages (${told.map((message) => `${message.cells}/${message.copy}`).join(', ')}); the button's copy pasted as DuckDB's: ${text === want}`);
        } else {
          await page.waitForTimeout(1_000);
          const told = await messages();
          const called = await page.evaluate(() => (globalThis as { __called?: boolean }).__called);
          if (told.length || called) fail(`${name} control: without ?readout, ${told.length} messages and the tools ${called ? 'exported' : 'absent'}`);
          results.bare = { messages: told.length, exported: called };
          console.log(`${name} control, without ?readout: ${told.length} messages, tools ${called ? 'exported' : 'absent'}`);
        }
        // Firefox's WebGL and the engine's warnings aren't the tools', nor
        // WebKit's note that a framed load used its preloads late.
        for (const problem of found.filter((problem) => !problem.startsWith('console: [JavaScript Warning') && !problem.includes('was preloaded using link preload but not used'))) fail(`${name}: ${problem}`);
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
  return results;
}

/** On touch: a tap selects; a touch drag on a band, reported. */
export async function checkTouch(browser: Browser, side: Side, url: string, fail: (what: string) => void): Promise<Record<string, unknown>> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, hasTouch: true });
  const page = await context.newPage();
  const found = problems(page);
  try {
    await page.goto(`${url}${QUERY}`);
    await waitMark(page, MARKS.filled, 0, 60_000);
    const layout = await layoutOf(page);
    const jan1 = WIDE_SHEET.heatFrom;
    await page.touchscreen.tap(...cellAt(layout, 2, jan1));
    const tapped = await selected(page, { kind: 'cells', anchor: [2, jan1], head: [2, jan1] });
    if (tapped) fail(`${side} touch: a tap: ${tapped}`);
    // A touch drag on Jan 1's band, 60 px right.
    const cdp = await context.newCDPSession(page);
    const [x, y] = [edge(layout, jan1), headerY(layout)];
    const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', at: number) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: at, y }] });
    await touch('touchStart', x);
    for (let step = 1; step <= 6; step++) {
      await touch('touchMove', x + step * 10);
      await page.waitForTimeout(16);
    }
    await touch('touchEnd', x + 60);
    await page.waitForTimeout(500);
    const width = (await layoutOf(page)).columns[jan1]!.width;
    const resized = width !== layout.columns[jan1]!.width;
    console.log(`${side} touch: a tap ${tapped ? 'did not select' : 'selected'}; a touch drag on Jan 1's band ${resized ? `resized it to ${width} px` : 'resized nothing'}`);
    for (const problem of found) fail(`${side} touch: ${problem}`);
    return { deviceScaleFactor: 1, tapSelected: !tapped, bandDragResized: resized, width };
  } finally {
    await context.close();
  }
}

export const TOOL_BROWSERS: BrowserType[] = [chromium, firefox, webkit];
