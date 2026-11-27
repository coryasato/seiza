// Sort, filter, and find in Chromium, Firefox, and WebKit, driven as a
// visitor drives them (the pointer on the canvas, keys, a paste, the DOM's
// buttons), each step read back from the view (`globalThis.__tychoView`,
// `?bench`), the table's probes (`__tychoTable`, `__tychoTableLayout`), the
// toolbar's count, the log's entries, the frame's line
// (`__tychoWorkbench.notice`), and the DOM.
//
// At 1440×900, in the sample (GCAT, 71,431 rows):
// 1. A header's sort arrow (`satcat_no`'s, from the layout's `arrow`) sorts,
//    its type's first direction, logged as a click's `sort`.
// 2. `sort launch_date desc` typed, the sort's chip named for it, and its
//    remove pressed: no sort, `clear sort` from a click.
// 3. A filter from the editor (Filter, a column, an operator, a value, its
//    command at the foot, Apply), one typed, and one pasted as JSON: each in
//    the view, the count ("n of 71,431 rows", each fewer), and the log.
// 4. `undo` gives the pasted filter back; the way back on the typed sort's
//    entry gives that sort and no filter; the way back on the pasted
//    filter's entry gives the three filters and no sort.
// 5. `sort launch_date` typed, then `clear all`: no filter, no sort, the
//    count "71,431 rows".
// 6. A cell's menu: keep the rows with its value (`object_type`'s), and
//    leave out the rows with another's (`name`'s), each a filter in
//    the view and a click's entry.
// 7. A filter leaving no row: applied, the count "0 of 71,431 rows", and
//    the frame's line says so.
// 8. Find: Cmd/Ctrl+F from the table's canvas opens it, focus in it, its
//    tag under the input; a second press in its bar isn't taken (not
//    prevented); a term typed, its count; Enter lands on a match ("1 of
//    n"), its cell selected, focus kept; Escape then puts focus on the
//    table. Opened from the toolbar's Find and closed before a step, focus
//    goes back where it opened (the button; WebKit leaves a click's focus
//    where it was, on the table).
// At 390×760 with touch: the toolbar a 40 px row of icons (Filter, Sort,
// Columns, Find; no words), a filter's icon showing its count, and find on
// a second row under it, the first unchanged.
// No console errors, in each browser.
//
// Against the dev server by default (`just tycho dev`); pass the preview's
// URL for the release build.
// Usage: node apps/tycho/perf/filter.ts [url] [--only chromium,firefox,webkit]

import { chromium, firefox, webkit, type BrowserContext, type BrowserType, type Page } from '@playwright/test';
import { waitMark } from '../../../shared-web/perf/harness.ts';

const url = new URL(process.argv.find((arg) => /^https?:/.test(arg)) ?? 'http://localhost:5173/');
url.searchParams.set('bench', '');
const TIMEOUT = 60_000;
const STEP = 10_000;
const MOD = 'ControlOrMeta';
const ALL = '71,431';

type Value = string | number | boolean | (string | number | boolean)[];

interface Filter {
  column: string;
  op: string;
  value?: Value;
}

interface View {
  source: { kind: string; name: string; rows: number };
  columns: { name: string; hidden?: boolean }[];
  filters?: Filter[];
  sort?: { column: string; direction: 'asc' | 'desc' };
}

interface LayoutColumn {
  name: string;
  index: number;
  x: number;
  width: number;
  arrow?: { x: number; width: number } | null;
}

interface Layout {
  left: number;
  top: number;
  rowHeight: number;
  columns: LayoutColumn[];
}

interface Table {
  selection: { kind: string; anchor: [number, number]; head: [number, number] } | null;
  find?: { term?: string | null } | null;
}

type CheckGlobal = {
  __tychoView?: View | null;
  __tychoTable?: Table;
  __tychoTableLayout?: Layout;
  __tychoWorkbench?: { notice?: string | { text?: string } | null; status?: string | null };
  __fKeys?: KeyboardEvent[];
};

interface Entry {
  command: string | null;
  words: string | null;
  reply: string;
  replyKind: string;
  origin: string;
  current: boolean;
}

interface Outcome {
  what: string;
  ok: boolean;
  detail: string;
}

type Check = (what: string, ok: boolean, detail: string) => void;

const view = (page: Page) => page.evaluate(() => (globalThis as CheckGlobal).__tychoView ?? null);
const table = (page: Page) => page.evaluate(() => (globalThis as CheckGlobal).__tychoTable ?? null);
const filters = (v: View | null) => v?.filters ?? [];
const showFilters = (v: View | null) => JSON.stringify(filters(v));
const showSort = (v: View | null) => JSON.stringify(v?.sort ?? null);

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

/** The toolbar's count as drawn: "71,431 rows", "18,691 of 71,431 rows",
 *  or "Counting rows…" while a filter's index is built. */
const countText = (page: Page) => page.evaluate(() => document.querySelector('#toolbar [data-count]')?.textContent?.trim() ?? '');
/** The count once it's read (not counting), and its rows in view. */
async function counted(page: Page, test: (rows: number) => boolean = () => true): Promise<{ text: string; rows: number | null }> {
  const read = (text: string) => {
    const match = /^([\d,]+)(?: of ([\d,]+))? rows?$/.exec(text);
    return match ? Number(match[1]!.replaceAll(',', '')) : null;
  };
  const text = await until(page, countText, (text) => read(text) !== null && test(read(text)!));
  return { text, rows: read(text) };
}

/** The layout, its `left` and `top` moved from the canvas's pixels to the
 *  page's. */
const layout = (page: Page): Promise<Layout> =>
  page.evaluate(() => {
    const probe = (globalThis as CheckGlobal).__tychoTableLayout!;
    const canvas = document.querySelector('#table-slot canvas')!.getBoundingClientRect();
    return { ...probe, left: probe.left + canvas.left, top: probe.top + canvas.top };
  });

/** A column's sort arrow's middle in the page (null if it draws none), and
 *  a cell's middle in row `row` (from the first drawn). */
async function place(page: Page, name: string) {
  const l = await layout(page);
  const c = l.columns.find((c) => c.name === name)!;
  const headerY = l.top - l.rowHeight / 2;
  return {
    arrow: c.arrow ? { x: l.left + c.x + c.arrow.x + c.arrow.width / 2, y: headerY } : null,
    cell: (row: number) => ({ x: l.left + c.x + Math.min(30, c.width / 2), y: l.top + l.rowHeight * (row + 0.5) }),
  };
}

const frames = (page: Page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

/** The pointer moved to `at`, two frames (WebKit can deliver a press before
 *  the hover lands, and GPUI presses only what's hovered:
 *  `.claude/rules/perf-harness.md`), then pressed. */
async function pressAt(page: Page, at: { x: number; y: number }, options: { button?: 'right' } = {}): Promise<void> {
  await page.mouse.move(at.x, at.y);
  await frames(page);
  await page.mouse.click(at.x, at.y, { button: options.button ?? 'left' });
  // Past the double press's 400 ms, so the next press is a first.
  await page.waitForTimeout(450);
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
        current: el.hasAttribute('data-current'),
      };
    }),
  );
const newest = (page: Page, test: (entry: Entry | undefined) => boolean) => until(page, async (p) => (await log(p)).at(-1), test);
const showEntry = (entry: Entry | undefined) => (entry ? `${JSON.stringify(entry.command ?? entry.words)} → ${JSON.stringify(entry.reply)} (${entry.replyKind}, ${entry.origin}${entry.current ? ', current' : ''})` : 'none');

/** What has focus: the table's keys (GPUI's input), find's bar, the bar,
 *  or another element. */
const focus = (page: Page) =>
  page.evaluate(() => {
    const active = document.activeElement;
    if (!active || active === document.body) return 'nothing';
    if (active.matches('body > textarea')) return 'table';
    if (active.closest('#find')) return 'find';
    if (active.closest('#command-bar')) return 'bar';
    const tool = active.getAttribute('data-tool');
    return tool ? `tool ${tool}` : active.outerHTML.slice(0, 80);
  });
const focusIs = (page: Page, want: string) => until(page, focus, (now) => now === want);

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

/** Opens the bar (Cmd/Ctrl+K) and runs `text`, typed or pasted; then waits
 *  for the bar to close (a command that runs closes it), so the next one
 *  opens it afresh. */
async function command(page: Page, text: string, how: 'typed' | 'pasted' = 'typed'): Promise<void> {
  await page.keyboard.press(`${MOD}+K`);
  await page.waitForFunction(() => document.activeElement?.closest('#command-bar') && document.activeElement.getAttribute('role') === 'combobox', undefined, { timeout: STEP });
  if (how === 'typed') await page.keyboard.type(text);
  else await paste(page, text);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !document.activeElement?.closest('#command-bar'), undefined, { timeout: STEP }).catch(() => {});
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

/** Runs the open menu's item `label`, then waits for the menu to be gone. */
async function runItem(page: Page, label: string): Promise<void> {
  await page.locator('[data-menu]').last().getByRole('menuitem', { name: new RegExp(`^${label}(?!\\w)`) }).click();
  await page.waitForSelector('[data-menu]', { state: 'detached', timeout: STEP }).catch(() => {});
}

/** Picks `option` in the editor's select named `label` (Base UI's Select). */
async function choose(page: Page, label: string, option: string | RegExp): Promise<void> {
  await page.locator(`[data-menu] [aria-label="${label}"]`).click();
  await page.getByRole('option', { name: option }).click();
  await page.waitForSelector('[role=listbox]', { state: 'detached', timeout: STEP }).catch(() => {});
}

/** The frame's line: the workbench's notice, as text. */
const notice = (page: Page) =>
  page.evaluate(() => {
    const n = (globalThis as CheckGlobal).__tychoWorkbench?.notice;
    return typeof n === 'string' ? n : (n?.text ?? '');
  });

/** Find's count or place, as its bar shows it. */
const findText = (page: Page) => page.evaluate(() => document.querySelector('#find [role=status]')?.textContent ?? '');

/** Whether each Cmd/Ctrl+F since `armF` was prevented by the page: each
 *  event kept from `window`'s capture phase, before the page's own listener
 *  (on `document`, which stops it there), and read once its dispatch is
 *  done. */
const armF = (page: Page) =>
  page.evaluate(() => {
    const g = globalThis as CheckGlobal;
    if (!g.__fKeys) addEventListener('keydown', (event) => event.key.toLowerCase() === 'f' && (event.metaKey || event.ctrlKey) && g.__fKeys!.push(event), { capture: true });
    g.__fKeys = [];
  });
const fKeys = (page: Page) => page.evaluate(() => (globalThis as CheckGlobal).__fKeys?.map((event) => event.defaultPrevented) ?? []);

async function wide(page: Page, browser: string, check: Check): Promise<void> {
  await waitMark(page, 'tycho:engine-locked', 0, TIMEOUT);
  await page.click('#first [data-action=sample]');
  const opened = await until(page, view, (v) => v?.source.kind === 'sample', TIMEOUT);
  if (opened?.source.kind !== 'sample') return check('the sample opens', false, 'no view published');
  await page.click('header [data-action=log]');
  await page.waitForSelector('#log li[data-entry]', { timeout: STEP });
  const whole = await counted(page);
  check('the count with nothing applied', whole.text === `${ALL} rows`, JSON.stringify(whole.text));

  // 1. A header's sort arrow.
  // A column on the canvas with the panel open.
  const satcat = await place(page, 'satcat_no');
  if (!satcat.arrow) check("satcat_no's header draws a sort arrow", false, 'no arrow in the layout');
  else await pressAt(page, satcat.arrow);
  const arrowed = await until(page, view, (v) => v?.sort?.column === 'satcat_no', TIMEOUT);
  const arrowEntry = await newest(page, (e) => e?.command === 'sort satcat_no desc');
  check(
    "a header's arrow sorts, logged from a click",
    arrowed?.sort?.column === 'satcat_no' && arrowed.sort.direction === 'desc' && arrowEntry?.origin === 'click',
    `sort ${showSort(arrowed)}; ${showEntry(arrowEntry)}`,
  );

  // 2. A sort typed; its chip's remove.
  await command(page, 'sort launch_date desc');
  const typedSort = await until(page, view, (v) => v?.sort?.column === 'launch_date', TIMEOUT);
  const sortEntry = await newest(page, (e) => e?.command === 'sort launch_date desc');
  const chip = await page.getAttribute('#toolbar [data-tool=sort]', 'aria-label').catch(() => null);
  check(
    '`sort launch_date desc` typed, the chip named for it',
    typedSort?.sort?.direction === 'desc' && sortEntry?.origin === 'typed' && chip === 'Sorted by launch_date, newest first',
    `sort ${showSort(typedSort)}; chip ${JSON.stringify(chip)}; ${showEntry(sortEntry)}`,
  );
  await page.click('#toolbar [aria-label="Remove the sort"]');
  const unsorted = await until(page, view, (v) => !v?.sort);
  const removeEntry = await newest(page, (e) => e?.command === 'clear sort');
  check("the sort's chip removed", !unsorted?.sort && removeEntry?.origin === 'click', `sort ${showSort(unsorted)}; ${showEntry(removeEntry)}`);

  // 3. A filter from the editor's Apply.
  await page.click('#toolbar [data-tool=filter]');
  await page.waitForSelector('[data-menu] [role=group][aria-label=Filter]', { timeout: STEP });
  await choose(page, 'Column', /^inclination_deg$/);
  await choose(page, 'Operator', 'is at least');
  await page.fill('[data-menu] [aria-label="The value"]', '90');
  const line = await until(page, (p) => p.textContent('[data-menu] [data-line]').then((t) => t ?? ''), (t) => t === 'filter inclination_deg >= 90');
  await page.locator('[data-menu]').getByRole('button', { name: 'Apply' }).click();
  const edited = await until(page, view, (v) => filters(v).length === 1, TIMEOUT);
  const editorCount = await counted(page, (rows) => rows < 71_431);
  const editorEntry = await newest(page, (e) => e?.command === 'filter inclination_deg >= 90' && /rows/.test(e.reply));
  check(
    "a filter from the editor's Apply",
    line === 'filter inclination_deg >= 90' &&
      JSON.stringify(filters(edited)) === JSON.stringify([{ column: 'inclination_deg', op: '>=', value: 90 }]) &&
      editorCount.text === `18,691 of ${ALL} rows` &&
      editorEntry?.origin === 'click',
    `foot ${JSON.stringify(line)}; filters ${showFilters(edited)}; count ${JSON.stringify(editorCount.text)}; ${showEntry(editorEntry)}`,
  );

  // A filter typed.
  await command(page, 'filter object_type = Payload');
  const typed = await until(page, view, (v) => filters(v).length === 2, TIMEOUT);
  const typedCount = await counted(page, (rows) => rows < editorCount.rows!);
  const typedEntry = await newest(page, (e) => e?.command === 'filter object_type = Payload' && /rows/.test(e.reply));
  check(
    'a filter typed',
    filters(typed)[1]?.column === 'object_type' && filters(typed)[1]?.op === '=' && filters(typed)[1]?.value === 'Payload' && typedCount.text.endsWith(`of ${ALL} rows`) && typedEntry?.origin === 'typed',
    `filters ${showFilters(typed)}; count ${JSON.stringify(typedCount.text)}; ${showEntry(typedEntry)}`,
  );

  // A filter pasted as JSON.
  const json = JSON.stringify({ filter: { column: 'launch_date', op: '>=', value: '2000-01-01' } });
  await command(page, json, 'pasted');
  const pasted = await until(page, view, (v) => filters(v).length === 3, TIMEOUT);
  const pastedCount = await counted(page, (rows) => rows < typedCount.rows!);
  const pastedEntry = await newest(page, (e) => e?.origin === 'pasted' && /rows/.test(e.reply));
  check(
    'a filter pasted as JSON',
    filters(pasted)[2]?.column === 'launch_date' && filters(pasted)[2]?.op === '>=' && filters(pasted)[2]?.value === '2000-01-01' && pastedCount.text.endsWith(`of ${ALL} rows`) && pastedEntry?.replyKind !== 'error',
    `filters ${showFilters(pasted)}; count ${JSON.stringify(pastedCount.text)}; ${showEntry(pastedEntry)}`,
  );

  // 4. `undo`, and the way back.
  await command(page, 'undo');
  const undone = await until(page, view, (v) => filters(v).length === 2, TIMEOUT);
  const undoCount = await counted(page, (rows) => rows === typedCount.rows);
  check('undo gives the pasted filter back', filters(undone).length === 2 && undoCount.text === typedCount.text, `filters ${showFilters(undone)}; count ${JSON.stringify(undoCount.text)}`);

  const backTo = async (test: (entry: Entry) => boolean) => {
    const at = (await log(page)).findIndex(test);
    if (at >= 0) await page.click(`#log li[data-entry]:nth-child(${at + 1}) [data-back]`);
    return at;
  };
  const toSort = await backTo((e) => e.command === 'sort launch_date desc');
  const sortBack = await until(page, view, (v) => v?.sort?.column === 'launch_date' && filters(v).length === 0, TIMEOUT);
  const sortBackCount = await counted(page, (rows) => rows === 71_431);
  check(
    "the way back to the typed sort: its sort, no filter",
    toSort >= 0 && sortBack?.sort?.direction === 'desc' && filters(sortBack).length === 0 && sortBackCount.text === `${ALL} rows`,
    `entry ${toSort}; sort ${showSort(sortBack)}; filters ${showFilters(sortBack)}; count ${JSON.stringify(sortBackCount.text)}`,
  );
  const toPasted = await backTo((e) => e.origin === 'pasted');
  const filtersBack = await until(page, view, (v) => filters(v).length === 3 && !v?.sort, TIMEOUT);
  const filtersBackCount = await counted(page, (rows) => rows === pastedCount.rows);
  check(
    'the way back to the pasted filter: three filters, no sort',
    toPasted >= 0 && filters(filtersBack).length === 3 && !filtersBack?.sort && filtersBackCount.text === pastedCount.text,
    `entry ${toPasted}; filters ${showFilters(filtersBack)}; sort ${showSort(filtersBack)}; count ${JSON.stringify(filtersBackCount.text)}`,
  );

  // 5. `clear all`.
  await command(page, 'sort launch_date');
  await until(page, view, (v) => v?.sort?.column === 'launch_date', TIMEOUT);
  await command(page, 'clear all');
  const cleared = await until(page, view, (v) => filters(v).length === 0 && !v?.sort, TIMEOUT);
  const clearedCount = await counted(page, (rows) => rows === 71_431);
  const clearEntry = await newest(page, (e) => e?.command === 'clear all');
  check(
    '`clear all`: no filter, no sort',
    filters(cleared).length === 0 && !cleared?.sort && clearedCount.text === `${ALL} rows` && clearEntry?.replyKind !== 'error',
    `filters ${showFilters(cleared)}; sort ${showSort(cleared)}; count ${JSON.stringify(clearedCount.text)}; ${showEntry(clearEntry)}`,
  );

  // 6. Keep and leave out, from a cell's menu.
  await pressAt(page, (await place(page, 'object_type')).cell(0), { button: 'right' });
  const keepMenu = await menuText(page);
  await runItem(page, 'Keep rows with this value');
  const kept = await until(page, view, (v) => filters(v).length === 1, TIMEOUT);
  const keptCount = await counted(page, (rows) => rows < 71_431);
  const keepEntry = await newest(page, (e) => /^filter object_type (=|is null)/.test(e?.command ?? ''));
  const keep = filters(kept)[0];
  check(
    "a cell's menu: keep the rows with its value",
    keepMenu.includes('Leave out rows with this value') && keep?.column === 'object_type' && (keep.op === '=' || keep.op === 'is null') && keepEntry?.origin === 'click',
    `filters ${showFilters(kept)}; count ${JSON.stringify(keptCount.text)}; ${showEntry(keepEntry)}`,
  );
  await pressAt(page, (await place(page, 'name')).cell(0), { button: 'right' });
  await menuText(page);
  await runItem(page, 'Leave out rows with this value');
  const left = await until(page, view, (v) => filters(v).length === 2, TIMEOUT);
  const leftCount = await counted(page, (rows) => rows < keptCount.rows!);
  const leaveEntry = await newest(page, (e) => /^filter name (!=|not null)/.test(e?.command ?? ''));
  const leave = filters(left)[1];
  check(
    "a cell's menu: leave out the rows with its value",
    leave?.column === 'name' && (leave.op === '!=' || leave.op === 'not null') && leaveEntry?.origin === 'click',
    `filters ${showFilters(left)}; count ${JSON.stringify(leftCount.text)}; ${showEntry(leaveEntry)}`,
  );

  // 7. A filter leaving no row.
  await command(page, 'filter name = "no such object"');
  const none = await until(page, view, (v) => filters(v).length === 3, TIMEOUT);
  const noneCount = await counted(page, (rows) => rows === 0);
  const noneLine = await until(page, notice, (text) => text !== '');
  check(
    'a filter leaving no row: applied, and said',
    filters(none).length === 3 && noneCount.text === `0 of ${ALL} rows` && noneLine === 'No row matches the filters: undo, or clear one.',
    `count ${JSON.stringify(noneCount.text)}; the frame's line ${JSON.stringify(noneLine)}`,
  );
  await command(page, 'clear all');
  await counted(page, (rows) => rows === 71_431);

  // 8. Find, from the table's canvas.
  await pressAt(page, (await place(page, 'name')).cell(2));
  await focusIs(page, 'table');
  await armF(page);
  await page.keyboard.press(`${MOD}+F`);
  const inFind = await focusIs(page, 'find');
  const first = await fKeys(page);
  const tag = (await page.textContent('#find [data-find-tag]').catch(() => null)) ?? '';
  check(
    'Cmd/Ctrl+F from the table opens find, focus in it, its tag under the input',
    inFind === 'find' && first.length === 1 && first[0] === true && /again for the browser.s find/.test(tag),
    `focus on ${inFind}; prevented ${JSON.stringify(first)}; tag ${JSON.stringify(tag)}`,
  );
  await armF(page);
  await page.keyboard.press(`${MOD}+F`);
  const second = await fKeys(page);
  check('a second Cmd/Ctrl+F in its bar is the browser\'s', second.length === 1 && second[0] === false, `prevented ${JSON.stringify(second)}`);
  // A browser's own find may have taken focus: give it back.
  await page.locator('#find input').focus();
  await page.keyboard.type('cosmos');
  const matches = await until(page, findText, (text) => /^[\d,]+ matches$/.test(text), TIMEOUT);
  const term = (await table(page))?.find?.term ?? null;
  check('a term typed, its count, the table\'s highlight', /^[\d,]+ matches$/.test(matches) && term === 'cosmos', `${JSON.stringify(matches)}; term ${JSON.stringify(term)}`);
  await page.keyboard.press('Enter');
  const placed = await until(page, findText, (text) => /^1 of [\d,]+$/.test(text), TIMEOUT);
  const landed = await table(page);
  const kept2 = await focus(page);
  check(
    'Enter lands on a match, its cell selected, the count read',
    placed === `1 of ${matches.replace(/ matches$/, '')}` && landed?.selection?.kind === 'cells' && kept2 === 'find',
    `${JSON.stringify(placed)}; selection ${JSON.stringify(landed?.selection ?? null)}; focus on ${kept2}`,
  );
  await page.keyboard.press('Escape');
  const afterLanding = await focusIs(page, 'table');
  const closed = (await page.$('#find')) === null;
  check('Escape after a landing: focus on the table, find closed', afterLanding === 'table' && closed, `focus on ${afterLanding}; find ${closed ? 'closed' : 'open'}`);

  // Opened from the toolbar's Find, closed before a step.
  const before = browser === 'webkit' ? 'table' : 'tool find';
  await page.click('#toolbar [data-tool=find]');
  await focusIs(page, 'find');
  await page.keyboard.press('Escape');
  const back = await focusIs(page, before);
  check('Escape before a step: focus back where find opened', back === before, `focus on ${back}, want ${before}`);
}

async function phone(page: Page, browser: string, check: Check): Promise<void> {
  await waitMark(page, 'tycho:engine-locked', 0, TIMEOUT);
  // WebKit sends no click after a scripted tap: DOM controls are clicked.
  await page.click('#first [data-action=sample]');
  await until(page, view, (v) => v?.source.kind === 'sample', TIMEOUT);
  await page.waitForSelector('#toolbar', { timeout: STEP });
  const bar = () =>
    page.evaluate(() => {
      const toolbar = document.getElementById('toolbar')!.getBoundingClientRect();
      const tools = [...document.querySelectorAll('#toolbar [data-tool]')].map((el) => ({ tool: el.getAttribute('data-tool'), text: el.textContent?.trim() ?? '' }));
      const find = document.getElementById('find')?.getBoundingClientRect() ?? null;
      return { height: toolbar.height, bottom: toolbar.bottom, tools, find: find && { top: find.top, width: find.width } };
    });
  const icons = await bar();
  check(
    'the toolbar a 40 px row of icons, no words',
    icons.height === 40 && icons.tools.map((t) => t.tool).join(',') === 'filter,sort,columns,find' && icons.tools.every((t) => t.text === ''),
    JSON.stringify(icons),
  );
  await command(page, 'filter inclination_deg >= 90');
  await until(page, view, (v) => filters(v).length === 1, TIMEOUT);
  const withFilter = await until(page, bar, (b) => b.tools[0]?.text === '1');
  check("a filter's icon shows its count", withFilter.tools[0]?.text === '1', JSON.stringify(withFilter.tools));
  await page.click('#toolbar [data-tool=find]');
  await page.waitForSelector('#find', { timeout: STEP });
  const finding = await bar();
  check(
    'find on a second row, the first unchanged',
    !!finding.find && finding.find.top >= finding.bottom && finding.height === 40 && finding.tools.filter((t) => t.tool !== 'find').length === 3,
    JSON.stringify(finding),
  );
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
