// The table's menus, the column list, the popover, and the row view in
// Chromium, Firefox, and WebKit, driven as a visitor drives them (the
// pointer on the canvas, keys, a paste, the DOM's buttons), each step read
// back from the view (`globalThis.__tychoView`, `?bench`), the table's
// probes (`__tychoTable`, `__tychoIconPress`, `__tychoCopy`), the log's
// entries, and the DOM.
//
// At 1440×900, in the sample:
// 1. A header icon's press opens its column's menu; Hide, Pin to the left,
//    Unpin, and Fit to its values each land in the view and in the log, from
//    a click, focus on the table after each.
// 2. A right-click on a cell opens its menu ("satcat_no · row 1"), and Copy
//    writes it (`__tychoCopy`; in Chromium the clipboard reads it back).
// 3. `hide object_detail, purpose` typed, `{"show": ["purpose"]}` pasted,
//    each read back from the view and the log; `undo` gives the hide back.
// 4. The column list: its search filters the rows, Enter on a hidden
//    column's row opens its menu, and Show shows it.
// 5. A cut cell (the `name` column narrowed by its edge): its cue, Enter
//    opening the popover, Enter again the Row tab with focus at that field;
//    Enter on a number opening the Row tab at once, focus at its field. A
//    cue inside a range opening the popover, the range kept; one outside it
//    selecting its cell; the popover's foot, pressed, taking focus at the
//    field.
// 6. A double-click on a cell, the panel closed, opening it on Row with
//    focus left on the table; Next row moving the selection; a hidden
//    column's field marked "hidden in the table".
// 7. Cmd/Ctrl+C on a selected range of three cells, written.
// 8. The cell menu's "Focus row in panel", the panel open and then closed,
//    focus at the cell's field each time.
// 9. A column's range (a header's press): the Row tab says no row.
// 10. Next row at the last row keeps focus, the button off.
// At 390×760 with touch: a tap on a header opens its menu as a sheet, and
// the panels' sheet holds Columns and Row tabs (the list, and "No row
// selected": the tap selected a column).
// No console errors, in each browser.
//
// Against the dev server by default (`just tycho dev`); pass the preview's
// URL for the release build.
// Usage: node apps/tycho/perf/table.ts [url] [--only chromium,firefox,webkit]

import { chromium, firefox, webkit, type BrowserContext, type BrowserType, type Page } from '@playwright/test';
import { waitMark } from '../../../shared-web/perf/harness.ts';

const url = new URL(process.argv.find((arg) => /^https?:/.test(arg)) ?? 'http://localhost:5173/');
url.searchParams.set('bench', '');
const TIMEOUT = 60_000;
const STEP = 10_000;
const MOD = 'ControlOrMeta';
/** Pointer moves a drag is made of: a drag needs more than one to start. */
const DRAG_MOVES = 8;

interface ColumnView {
  name: string;
  width?: number;
  hidden?: boolean;
}

interface View {
  source: { kind: string; name: string };
  columns: ColumnView[];
  pinned?: number;
}

interface LayoutColumn {
  name: string;
  index: number;
  x: number;
  width: number;
  hidden: boolean;
  icon?: { x: number; width: number } | null;
}

interface Layout {
  left: number;
  top: number;
  rowHeight: number;
  columns: LayoutColumn[];
}

type Cell = { row: number; column: number };

interface Table {
  rows: number;
  first: number;
  end: number;
  selection: { kind: string; anchor: [number, number]; head: [number, number] } | null;
  /** `button`: the foot's box, in the canvas's pixels. */
  popover: { cell: Cell; button?: [number, number, number, number] | null } | null;
  cue: { cell: Cell; bounds: [number, number, number, number]; open: boolean } | null;
}

interface Copy {
  state: string;
  id?: number;
  bytes?: number;
}

type CheckGlobal = {
  __tychoView?: View | null;
  __tychoTable?: Table;
  __tychoTableLayout?: Layout;
  __tychoIconPress?: { column: number; count: number };
  __tychoCopy?: Copy;
};

interface Entry {
  command: string | null;
  words: string | null;
  reply: string;
  replyKind: string;
  origin: string;
}

interface Outcome {
  what: string;
  ok: boolean;
  detail: string;
}

type Check = (what: string, ok: boolean, detail: string) => void;

const view = (page: Page) => page.evaluate(() => (globalThis as CheckGlobal).__tychoView ?? null);
const table = (page: Page) => page.evaluate(() => (globalThis as CheckGlobal).__tychoTable ?? null);
const copied = (page: Page) => page.evaluate(() => (globalThis as CheckGlobal).__tychoCopy ?? null);
const column = (v: View | null, name: string) => v?.columns.find((c) => c.name === name);

/** `get(page)` once `test` holds of it, or as it is after the timeout. */
async function until<T>(page: Page, get: (page: Page) => Promise<T>, test: (value: T) => boolean, timeout = STEP): Promise<T> {
  const end = Date.now() + timeout;
  let value = await get(page);
  while (!test(value) && Date.now() < end) {
    await page.waitForTimeout(50);
    value = await get(page);
  }
  return value;
}

/** The layout, its `left` and `top` moved from the canvas's pixels to the
 *  page's. */
const layout = (page: Page): Promise<Layout> =>
  page.evaluate(() => {
    const probe = (globalThis as CheckGlobal).__tychoTableLayout!;
    const canvas = document.querySelector('#table-slot canvas')!.getBoundingClientRect();
    return { ...probe, left: probe.left + canvas.left, top: probe.top + canvas.top };
  });

/** A column's place in the page: its header's middle, its badge's middle,
 *  its right edge, and a cell's middle in row `row` (from the first
 *  drawn); and its place in the drawn order. */
async function place(page: Page, name: string) {
  const l = await layout(page);
  const at = l.columns.findIndex((c) => c.name === name);
  const c = l.columns[at]!;
  const headerY = l.top - l.rowHeight / 2;
  return {
    column: c,
    /** Its place in the drawn order, as the table's selection counts it. */
    at,
    header: { x: l.left + c.x + c.width / 2 + (c.icon ? 10 : 0), y: headerY },
    icon: { x: l.left + c.x + (c.icon ? c.icon.x + c.icon.width / 2 : 12), y: headerY },
    edge: { x: l.left + c.x + c.width - 1, y: headerY },
    cell: (row: number) => ({ x: l.left + c.x + Math.min(30, c.width / 2), y: l.top + l.rowHeight * (row + 0.5) }),
  };
}

const frames = (page: Page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

/** The pointer moved to `at`, two frames (WebKit can deliver a press before
 *  the hover lands, and GPUI presses only what's hovered:
 *  `.claude/rules/perf-harness.md`), then pressed. */
async function pressAt(page: Page, at: { x: number; y: number }, options: { button?: 'right'; clickCount?: number; shift?: boolean } = {}): Promise<void> {
  await page.mouse.move(at.x, at.y);
  await frames(page);
  if (options.shift) await page.keyboard.down('Shift');
  if (options.clickCount === 2) await page.mouse.dblclick(at.x, at.y);
  else await page.mouse.click(at.x, at.y, { button: options.button ?? 'left' });
  if (options.shift) await page.keyboard.up('Shift');
  // Past the double press's 400 ms, so the next press is a first.
  await page.waitForTimeout(450);
}

/** A box of the canvas's (`[x, y, width, height]`, as the table's probes
 *  give one) as its middle in the page. */
const boxMiddle = (page: Page, box: [number, number, number, number]) =>
  page.evaluate((box) => {
    const canvas = document.querySelector('#table-slot canvas')!.getBoundingClientRect();
    return { x: canvas.left + box[0] + box[2] / 2, y: canvas.top + box[1] + box[3] / 2 };
  }, box);

/** The first of `rows` whose cell in `column` shows its cue under the
 *  pointer (its text is cut), and the cue's box; null if none does. */
async function cueOn(page: Page, column: Awaited<ReturnType<typeof place>>, rows: number[]) {
  for (const row of rows) {
    const at = column.cell(row);
    await page.mouse.move(at.x, at.y);
    await frames(page);
    const t = await until(page, table, (t) => t?.cue?.cell.row === row && t.cue.cell.column === column.column.index, 1000);
    if (t?.cue?.cell.row === row) return { row, bounds: t.cue.bounds };
  }
  return null;
}

/** The open menu's text, once one is open (or '' after the timeout). */
async function menuText(page: Page): Promise<string> {
  try {
    await page.waitForSelector('[data-menu]', { timeout: STEP });
  } catch {
    return '';
  }
  return (await page.locator('[data-menu]').last().textContent()) ?? '';
}

/** Runs the open menu's item `label`, its label's span whole (its name
 *  may go on with a key's hint, "Copy⌘C" or "Copy Ctrl C"; "Show" isn't
 *  "Show its profile"), then waits for the menu to be gone. */
async function runItem(page: Page, label: string): Promise<void> {
  const span = page.locator('span', { hasText: new RegExp(`^${label}$`) });
  await page.locator('[data-menu]').last().getByRole('menuitem').filter({ has: span }).click();
  await page.waitForSelector('[data-menu]', { state: 'detached', timeout: STEP }).catch(() => {});
}

/** The log as drawn, oldest first (the panel's Log tab). */
const log = (page: Page): Promise<Entry[]> =>
  page.$$eval('#log li[data-entry]', (items) =>
    items.map((item) => {
      const el = item as HTMLElement;
      return {
        command: el.querySelector('[data-command]')?.textContent ?? null,
        words: el.querySelector('[data-words]')?.textContent ?? null,
        reply: el.children[1]?.textContent ?? '',
        replyKind: el.dataset.reply ?? '',
        origin: el.dataset.origin ?? '',
      };
    }),
  );
const newest = (page: Page, test: (entry: Entry | undefined) => boolean) => until(page, async (p) => (await log(p)).at(-1), test);
const showEntry = (entry: Entry | undefined) => (entry ? `${JSON.stringify(entry.command ?? entry.words)} (${entry.replyKind}, ${entry.origin})` : 'none');

/** What has focus: the table's keys (GPUI's input), a row view's field, or
 *  another element. */
const focus = (page: Page) =>
  page.evaluate(() => {
    const active = document.activeElement;
    if (!active || active === document.body) return 'nothing';
    if (active.matches('body > textarea')) return 'table';
    const field = active.closest('#row-view [data-field]') as HTMLElement | null;
    if (field && field === active) return `field ${field.dataset.field}`;
    return active.outerHTML.slice(0, 80);
  });
const focusIs = (page: Page, want: string) => until(page, focus, (now) => now === want);

/** The panel's Row tab, selected and drawn. */
const rowTab = (page: Page) =>
  page.evaluate(() => ({
    selected: document.querySelector('#log [role=tab][aria-selected=true]')?.textContent?.trim() ?? null,
    head: document.querySelector('#log [data-row-head]')?.textContent ?? null,
    active: (document.querySelector('#row-view [data-field][data-active]') as HTMLElement | null)?.dataset.field ?? null,
  }));

/** A paste as the browser delivers one: the event, then the text as one
 *  input (not `keyboard.insertText`, which Firefox's Playwright composes). */
const paste = (page: Page, text: string) =>
  page.evaluate((text) => {
    const input = document.activeElement as HTMLInputElement;
    input.dispatchEvent(new ClipboardEvent('paste', { bubbles: true }));
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text);
    input.setSelectionRange(text.length, text.length);
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste', data: text }));
  }, text);

/** Opens the bar (Cmd/Ctrl+K) and runs `text`, typed or pasted. */
async function command(page: Page, text: string, how: 'typed' | 'pasted'): Promise<void> {
  await page.keyboard.press(`${MOD}+K`);
  await page.waitForFunction(() => document.activeElement?.closest('#command-bar') && document.activeElement.getAttribute('role') === 'combobox', undefined, { timeout: STEP });
  if (how === 'typed') await page.keyboard.type(text);
  else await paste(page, text);
  await page.keyboard.press('Enter');
}

/** A copy's outcome once it settles past `before` (another id, or the
 *  first), as the bridge publishes it. */
const copySettled = (page: Page, before: Copy | null) =>
  until(page, copied, (now) => !!now && now.id !== before?.id && now.state !== 'copying' && now.state !== 'writing');

/** The clipboard's text where the browser lets the check read it
 *  (Chromium, granted), else null. */
const clipboardText = (page: Page, browser: string) =>
  browser === 'chromium' ? page.evaluate(() => navigator.clipboard.readText()).catch(() => null) : Promise.resolve(null);

async function wide(page: Page, browser: string, check: Check): Promise<void> {
  await waitMark(page, 'tycho:engine-locked', 0, TIMEOUT);
  await page.click('#first [data-action=sample]');
  const opened = await until(page, view, (v) => v?.source.kind === 'sample', TIMEOUT);
  if (opened?.source.kind !== 'sample') return check('the sample opens', false, 'no view published');
  await page.click('header [data-action=log]');
  await page.waitForSelector('#log li[data-entry]', { timeout: STEP });

  // 1. A column's menu from its header icon: Hide, Pin, Unpin, Fit.
  const cospar = await place(page, 'cospar');
  await pressAt(page, cospar.icon);
  const iconPress = await page.evaluate(() => (globalThis as CheckGlobal).__tychoIconPress ?? null);
  const menu = await menuText(page);
  check('the header icon opens its column menu', iconPress?.column === cospar.column.index && menu.includes('cospar') && menu.includes('Pin to the left') && menu.includes('Fit to its values'), `icon press ${JSON.stringify(iconPress)}; menu ${JSON.stringify(menu.slice(0, 80))}`);
  await runItem(page, 'Hide');
  const hidden = await until(page, view, (v) => column(v, 'cospar')?.hidden === true);
  const hideEntry = await newest(page, (e) => e?.command === 'hide cospar');
  check('Hide, in the view and the log', column(hidden, 'cospar')?.hidden === true && hideEntry?.origin === 'click', `cospar hidden ${column(hidden, 'cospar')?.hidden ?? false}; ${showEntry(hideEntry)}`);
  check('focus on the table after Hide', (await focusIs(page, 'table')) === 'table', await focus(page));

  for (const [label, line, test] of [
    ['Pin to the left', 'pin launch_tag', (v: View | null) => v?.pinned === 1 && v.columns[0]!.name === 'launch_tag'],
    ['Unpin', 'unpin launch_tag', (v: View | null) => (v?.pinned ?? 0) === 0],
  ] as const) {
    await pressAt(page, (await place(page, 'launch_tag')).icon);
    await menuText(page);
    await runItem(page, label);
    const after = await until(page, view, test);
    const entry = await newest(page, (e) => e?.command === line);
    check(`${label}, in the view and the log`, test(after) && entry?.origin === 'click', `pinned ${after?.pinned ?? 0}, first ${after?.columns[0]?.name}; ${showEntry(entry)}`);
    check(`focus on the table after ${label}`, (await focusIs(page, 'table')) === 'table', await focus(page));
  }

  const before = column(await view(page), 'object_type')?.width;
  await pressAt(page, (await place(page, 'object_type')).icon);
  await menuText(page);
  await runItem(page, 'Fit to its values');
  const fitted = await until(page, view, (v) => column(v, 'object_type')?.width !== before);
  const fitEntry = await newest(page, (e) => /^(Widened|Narrowed) object_type to \d+ px/.test(e?.words ?? ''));
  check('Fit to its values, in the view and the log', column(fitted, 'object_type')?.width !== before && fitEntry?.origin === 'click', `width ${before ?? 'its kind\'s'} → ${column(fitted, 'object_type')?.width}; ${showEntry(fitEntry)}`);
  check('focus on the table after Fit', (await focusIs(page, 'table')) === 'table', await focus(page));

  // 2. A cell's menu, and its Copy.
  const satcat = await place(page, 'satcat_no');
  await pressAt(page, satcat.cell(0), { button: 'right' });
  const cellMenu = await menuText(page);
  check('a right-click opens the cell menu', cellMenu.includes('satcat_no · row 1') && cellMenu.includes('Copy') && cellMenu.includes('Focus row in panel'), JSON.stringify(cellMenu.slice(0, 80)));
  const beforeCopy = await copied(page);
  await runItem(page, 'Copy');
  const cellCopy = await copySettled(page, beforeCopy);
  const cellText = await clipboardText(page, browser);
  check('Copy writes the cell', cellCopy?.state === 'written' && (cellText === null || cellText.trim() === '1'), `${JSON.stringify(cellCopy)}${cellText === null ? '' : `; the clipboard reads ${JSON.stringify(cellText)}`}`);

  // 3. `hide` typed, `show` pasted, `undo`.
  await command(page, 'hide object_detail, purpose', 'typed');
  const both = await until(page, view, (v) => !!column(v, 'object_detail')?.hidden && !!column(v, 'purpose')?.hidden);
  const typedEntry = await newest(page, (e) => e?.command === 'hide object_detail, purpose');
  check('hide two columns, typed', !!column(both, 'object_detail')?.hidden && !!column(both, 'purpose')?.hidden && typedEntry?.origin === 'typed', showEntry(typedEntry));
  await command(page, JSON.stringify({ show: ['purpose'] }), 'pasted');
  const one = await until(page, view, (v) => !column(v, 'purpose')?.hidden);
  const pastedEntry = await newest(page, (e) => e?.origin === 'pasted');
  check('show one, pasted', !column(one, 'purpose')?.hidden && !!column(one, 'object_detail')?.hidden && pastedEntry?.replyKind !== 'error', showEntry(pastedEntry));
  await command(page, 'undo', 'typed');
  const undone = await until(page, view, (v) => !!column(v, 'purpose')?.hidden);
  check('undo gives the hide back', !!column(undone, 'purpose')?.hidden && !!column(undone, 'object_detail')?.hidden, `purpose hidden ${column(undone, 'purpose')?.hidden ?? false}`);
  await focusIs(page, 'table');

  // 4. The column list: search, Enter on a row (its profile), More, Show.
  await page.click('header [data-action=columns]');
  await page.fill('#columns input[aria-label="Search columns"]', 'obj');
  const rows = await until(page, (p) => p.$$eval('#columns button[data-column]', (b) => b.map((b) => b.getAttribute('aria-label') ?? '')), (r) => r.length === 2);
  check('the list\'s search filters it', rows.length === 2 && rows.includes('object_type') && rows.includes('object_detail, hidden'), rows.join('; '));
  await page.focus('#columns button[aria-label="object_detail, hidden"]');
  await page.keyboard.press('Enter');
  const profileOpened = await page.waitForSelector('#columns [data-profile="object_detail"]', { timeout: STEP }).then(() => true, () => false);
  check('Enter on a row opens its profile under it', profileOpened, `expanded ${await page.getAttribute('#columns button[aria-label="object_detail, hidden"]', 'aria-expanded')}`);
  await page.click('#columns [data-profile="object_detail"] button[aria-label=More]');
  const rowMenu = await menuText(page);
  check('More on a hidden column\'s profile opens its menu, Show and its profile', rowMenu.includes('object_detail') && rowMenu.includes('Show') && rowMenu.includes('Show its profile') && !rowMenu.includes('Hide'), JSON.stringify(rowMenu.slice(0, 80)));
  await runItem(page, 'Show');
  const shown = await until(page, view, (v) => !column(v, 'object_detail')?.hidden);
  const showEntryRow = await newest(page, (e) => e?.command === 'show object_detail');
  check('Show from the list, in the view and the log', !column(shown, 'object_detail')?.hidden && showEntryRow?.origin === 'click', showEntry(showEntryRow));
  await page.click('header [data-action=columns]');
  await page.waitForSelector('#columns', { state: 'detached', timeout: STEP }).catch(() => {});

  // 5. A cut cell: its cue, Enter for the popover, Enter for the Row tab.
  const name = await place(page, 'name');
  await page.mouse.move(name.edge.x, name.edge.y);
  await frames(page);
  await page.mouse.down();
  for (let step = 1; step <= DRAG_MOVES; step++) await page.mouse.move(name.edge.x - (120 * step) / DRAG_MOVES, name.edge.y);
  await page.mouse.up();
  await page.waitForTimeout(450);
  const narrowed = await place(page, 'name');
  // Row 1's name, a rocket stage's 24 characters, is cut at 80 px.
  await pressAt(page, narrowed.cell(0));
  const cue = await until(page, table, (t) => t?.cue?.cell.row === 0 && t.cue.cell.column === narrowed.column.index);
  check('a cut cell shows its cue', cue?.cue?.cell.column === narrowed.column.index, `width ${Math.round(narrowed.column.width)} px; cue ${JSON.stringify(cue?.cue?.cell ?? null)}`);
  await page.keyboard.press('Enter');
  const popover = await until(page, table, (t) => !!t?.popover);
  check('Enter opens the popover', popover?.popover?.cell.row === 0 && popover.popover.cell.column === narrowed.column.index, JSON.stringify(popover?.popover ?? null));
  await page.keyboard.press('Enter');
  const fromPopover = await focusIs(page, `field ${narrowed.column.index}`);
  const tabNow = await rowTab(page);
  check('Enter again opens the Row tab, focus at that field', fromPopover === `field ${narrowed.column.index}` && tabNow.selected === 'Row' && tabNow.head === 'Row 1', `focus on ${fromPopover}; ${JSON.stringify(tabNow)}`);

  await pressAt(page, (await place(page, 'satcat_no')).cell(3));
  await page.keyboard.press('Enter');
  const fromNumber = await focusIs(page, `field ${satcat.column.index}`);
  const numberTab = await until(page, rowTab, (t) => t.head === 'Row 4');
  check('Enter on a number opens the Row tab at once, focus at its field', fromNumber === `field ${satcat.column.index}` && numberTab.head === 'Row 4' && numberTab.active === String(satcat.column.index), `focus on ${fromNumber}; ${JSON.stringify(numberTab)}`);

  // 5b. The popover's cell: a cue inside a range peeks, the range kept; one
  // outside it selects its cell; the foot, pressed, takes focus at the field.
  const cut = await place(page, 'name');
  await pressAt(page, cut.cell(0));
  await pressAt(page, cut.cell(4), { shift: true });
  const kept = (await table(page))?.selection ?? null;
  const inside = await cueOn(page, cut, [1, 2, 3, 0, 4]);
  if (inside) await pressAt(page, await boxMiddle(page, inside.bounds));
  const peek = await until(page, table, (t) => t?.popover?.cell.row === inside?.row);
  check(
    'a cue inside a range opens the popover, the range kept',
    !!inside && peek?.popover?.cell.row === inside.row && JSON.stringify(peek.selection) === JSON.stringify(kept) && kept?.anchor[0] === 0 && kept.head[0] === 4,
    `cue on row ${inside?.row ?? 'none'}; popover ${JSON.stringify(peek?.popover?.cell ?? null)}; selection ${JSON.stringify(peek?.selection)} (was ${JSON.stringify(kept)})`,
  );
  await page.keyboard.press('Escape');
  await until(page, table, (t) => !t?.popover);
  const outside = await cueOn(page, cut, [6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
  if (outside) await pressAt(page, await boxMiddle(page, outside.bounds));
  const chosen = await until(page, table, (t) => t?.popover?.cell.row === outside?.row && t?.selection?.anchor[0] === outside?.row);
  check(
    'a cue outside the range selects its cell',
    !!outside && chosen?.popover?.cell.row === outside.row && chosen.selection?.kind === 'cells' && chosen.selection.anchor[0] === outside.row && chosen.selection.head[0] === outside.row && chosen.selection.anchor[1] === cut.at,
    `cue on row ${outside?.row ?? 'none'}; selection ${JSON.stringify(chosen?.selection)}`,
  );
  const foot = chosen?.popover?.button;
  if (foot) await pressAt(page, await boxMiddle(page, foot));
  const fromFoot = await focusIs(page, `field ${cut.column.index}`);
  const footTab = await until(page, rowTab, (t) => t.head === `Row ${(outside?.row ?? 0) + 1}`);
  check(
    'the popover\'s foot, pressed, takes focus at the field',
    !!foot && fromFoot === `field ${cut.column.index}` && footTab.head === `Row ${(outside?.row ?? 0) + 1}`,
    `foot ${JSON.stringify(foot ?? null)}; focus on ${fromFoot}; ${JSON.stringify(footTab)}`,
  );

  // 6. A double-click with the panel closed; Next row; a hidden field.
  await page.click('header [data-action=log]');
  await page.waitForSelector('#log', { state: 'detached', timeout: STEP }).catch(() => {});
  await frames(page);
  await pressAt(page, (await place(page, 'satcat_no')).cell(5), { clickCount: 2 });
  const doubled = await until(page, rowTab, (t) => t.head === 'Row 6' && t.active === String(satcat.column.index));
  const afterDouble = await focus(page);
  check('a double-click opens the Row tab, focus left on the table', doubled.selected === 'Row' && doubled.head === 'Row 6' && doubled.active === String(satcat.column.index) && afterDouble === 'table', `focus on ${afterDouble}; ${JSON.stringify(doubled)}`);
  await page.click('#log [data-row-step=next]');
  const stepped = await until(page, rowTab, (t) => t.head === 'Row 7');
  const selection = (await table(page))?.selection;
  const satcatAt = (await place(page, 'satcat_no')).at;
  check('Next row moves the selection', stepped.head === 'Row 7' && selection?.anchor[0] === 6 && selection.anchor[1] === satcatAt, `${stepped.head}; selection ${JSON.stringify(selection)}`);
  const field = (await page.textContent(`#row-view [data-field="${cospar.column.index}"]`)) ?? '';
  check('a hidden column\'s field is marked', field.includes('hidden in the table'), JSON.stringify(field.slice(0, 60)));

  // 7. Cmd/Ctrl+C on a range: satcat_no's rows 1 to 3.
  const range = await place(page, 'satcat_no');
  await pressAt(page, range.cell(0));
  await pressAt(page, range.cell(2), { shift: true });
  const ranged = (await table(page))?.selection;
  const beforeRange = await copied(page);
  await page.keyboard.press(`${MOD}+C`);
  const rangeCopy = await copySettled(page, beforeRange);
  const rangeText = await clipboardText(page, browser);
  check(
    'Cmd/Ctrl+C on a range',
    ranged?.anchor[0] === 0 && ranged.head[0] === 2 && rangeCopy?.state === 'written' && (rangeText === null || rangeText.trim().split(/\r?\n/).join(',') === '1,2,3'),
    `selection ${JSON.stringify(ranged)}; ${JSON.stringify(rangeCopy)}${rangeText === null ? '' : `; the clipboard reads ${JSON.stringify(rangeText)}`}`,
  );

  // 8. The cell menu's "Focus row in panel", the panel open, then closed.
  for (const [row, state] of [[8, 'open'], [10, 'closed']] as const) {
    if (state === 'closed') {
      await page.click('header [data-action=log]');
      await page.waitForSelector('#log', { state: 'detached', timeout: STEP }).catch(() => {});
      await frames(page);
    }
    await pressAt(page, (await place(page, 'satcat_no')).cell(row), { button: 'right' });
    await menuText(page);
    await runItem(page, 'Focus row in panel');
    const focused = await focusIs(page, `field ${satcat.column.index}`);
    const tab = await until(page, rowTab, (t) => t.head === `Row ${row + 1}`);
    check(`the cell menu's "Focus row in panel", the panel ${state}`, focused === `field ${satcat.column.index}` && tab.selected === 'Row' && tab.head === `Row ${row + 1}`, `focus on ${focused}; ${JSON.stringify(tab)}`);
  }

  // 9. A column's range leaves the Row tab with no row.
  await pressAt(page, (await place(page, 'satcat_no')).header);
  const columnRange = (await table(page))?.selection;
  const noRow = await page.waitForSelector('#log [data-row-empty]', { timeout: STEP }).then(() => true, () => false);
  check('a column\'s range: "No row selected"', columnRange?.kind === 'columns' && noRow, `selection ${JSON.stringify(columnRange)}; ${noRow ? 'No row selected' : JSON.stringify(await rowTab(page))}`);

  // 10. Next row keeps focus at the last row.
  const total = (await table(page))?.rows ?? 0;
  await command(page, `jump ${total - 1}`, 'typed');
  await until(page, rowTab, (t) => t.head === `Row ${(total - 1).toLocaleString('en-US')}`);
  await page.focus('#log [data-row-step=next]');
  await page.keyboard.press('Enter');
  const last = await until(page, rowTab, (t) => t.head === `Row ${total.toLocaleString('en-US')}`);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  const atEnd = await page.evaluate(() => ({ step: document.activeElement?.getAttribute('data-row-step') ?? document.activeElement?.tagName, off: document.activeElement?.getAttribute('aria-disabled') }));
  const still = await rowTab(page);
  check('Next row keeps focus at the last row', last.head === `Row ${total.toLocaleString('en-US')}` && still.head === last.head && atEnd.step === 'next' && atEnd.off === 'true', `${still.head}; focus on ${atEnd.step}, aria-disabled ${atEnd.off}`);
}

async function phone(page: Page, browser: string, check: Check): Promise<void> {
  await waitMark(page, 'tycho:engine-locked', 0, TIMEOUT);
  // WebKit sends no click after a scripted tap: DOM controls are clicked.
  await page.click('#first [data-action=sample]');
  await until(page, view, (v) => v?.source.kind === 'sample', TIMEOUT);
  await page.waitForTimeout(500);
  // A column whose header is on a phone's screen.
  const satcat = await place(page, 'satcat_no');
  await page.touchscreen.tap(satcat.header.x, satcat.header.y);
  const sheet = await menuText(page);
  const label = await page.locator('[data-menu]').last().getAttribute('aria-label').catch(() => null);
  check('a tap on a header opens its menu as a sheet', label === "satcat_no's menu" && sheet.includes('Hide'), `${label}: ${JSON.stringify(sheet.slice(0, 60))}`);
  await page.keyboard.press('Escape');
  await page.waitForSelector('[data-menu]', { state: 'detached', timeout: STEP }).catch(() => {});

  await page.click('header [data-action=log]');
  await page.waitForSelector('#log-sheet', { timeout: STEP });
  const tabs = await page.$$eval('#log-sheet [role=tab]', (t) => t.map((t) => t.textContent?.trim() ?? ''));
  await page.click('#log-sheet [role=tab]:has-text("Columns")');
  const listed = await until(page, (p) => p.$$eval('#log-sheet button[data-column]', (b) => b.length), (n) => n > 0);
  check('the sheet\'s Columns tab lists the columns', tabs.join(',') === 'Columns,Row,Log' && listed === (await view(page))?.columns.length, `tabs ${tabs.join(', ')}; ${listed} rows`);
  await page.click('#log-sheet [role=tab]:has-text("Row")');
  // The header's tap selected its column, which picks no row.
  const shows = await page
    .waitForSelector('#log-sheet [data-row-empty], #log-sheet #row-view [data-field]', { timeout: STEP })
    .then((el) => el.evaluate((el) => (el.hasAttribute('data-row-empty') ? 'No row selected' : document.querySelector('#log-sheet [data-row-head]')?.textContent ?? '')), () => null);
  check('the sheet\'s Row tab, no row selected', shows === 'No row selected', shows ?? 'neither a row nor "No row selected"');
  void browser;
}

/** `--only firefox,webkit` or `--only=firefox,webkit`: those browsers alone.
 *  Any other flag is refused, so a misspelled one never runs all three. */
const onlyAt = process.argv.findIndex((arg) => arg === '--only' || arg.startsWith('--only='));
const onlyArg = onlyAt < 0 ? undefined : process.argv[onlyAt]!.startsWith('--only=') ? process.argv[onlyAt]!.slice('--only='.length) : process.argv[onlyAt + 1];
const only = onlyArg && !onlyArg.startsWith('-') ? onlyArg.split(',').filter(Boolean) : undefined;
const stray = process.argv.slice(2).filter((arg, at) => arg.startsWith('-') && at + 2 !== onlyAt);
if (stray.length) {
  console.error(`unknown flag ${stray.join(', ')}; takes [url] [--only chromium,firefox,webkit]`);
  process.exit(2);
}
const ENGINES = [
  { name: 'chromium', type: chromium },
  { name: 'firefox', type: firefox },
  { name: 'webkit', type: webkit },
].filter((engine) => !only || only.includes(engine.name)) as { name: string; type: BrowserType }[];

/** A page with its errors collected, run through `drive`. */
async function runIn(context: BrowserContext, name: string, drive: (page: Page, browser: string, check: Check) => Promise<void>, at: string): Promise<Outcome[]> {
  const errors: string[] = [];
  const outcomes: Outcome[] = [];
  try {
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.goto(url.href);
    await drive(page, name, (what, ok, detail) => outcomes.push({ what, ok, detail }));
  } catch (error) {
    outcomes.push({ what: 'the run finished', ok: false, detail: error instanceof Error ? error.message.split('\n')[0]! : String(error) });
  }
  for (const error of errors) outcomes.push({ what: 'no console error', ok: false, detail: error });
  return outcomes.map((outcome) => ({ ...outcome, what: `${at}: ${outcome.what}` }));
}

let failures = 0;
for (const { name, type } of ENGINES) {
  const browser = await type.launch();
  let outcomes: Outcome[] = [];
  try {
    const desk = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    if (name === 'chromium') await desk.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: url.origin });
    outcomes = await runIn(desk, name, wide, '1440');
    await desk.close();
    const touch = await browser.newContext({ viewport: { width: 390, height: 760 }, hasTouch: true });
    outcomes.push(...(await runIn(touch, name, phone, '390')));
  } finally {
    await browser.close();
  }
  for (const outcome of outcomes) {
    if (!outcome.ok) failures += 1;
    console.log(`${name.padEnd(9)}${outcome.ok ? 'ok  ' : 'FAIL'}  ${outcome.what}: ${outcome.detail}`);
  }
}
console.log(failures ? `\nFAIL: ${failures} check(s)` : '\nPASS');
process.exit(failures ? 1 : 0);
