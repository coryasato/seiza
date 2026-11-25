// The command bar and the log in Chromium, Firefox, and WebKit, driven as a
// visitor drives them (keys, a paste, a drag, the log's buttons), each step
// read back from the view (`globalThis.__tychoView`, `?bench`), the table
// (`__tychoTable`), the bar's DOM, and the log's (`#log li[data-entry]`).
//
// 1. Cmd/Ctrl+K from the first screen (focus first given to the canvas's
//    input) puts focus in its box; the sample opens; the top bar's log
//    button opens the panel, its one entry the opening, current.
// 2. Cmd/Ctrl+K from the table opens the bar; `pin <column>` typed runs: the
//    view pins it first, the log's newest entry is the command, typed,
//    current, and focus is the table's.
// 3. A pasted JSON action of two steps, the second naming a column the file
//    doesn't have: neither runs, the bar names step 2, the log's entry is
//    an error, pasted.
// 4. A sentence is answered "Tycho reads commands, not sentences."; the
//    answer is waited for, so it can't arrive in the next bar.
// 5. `jump 1204` marks row 1,204 (0-based 1203) and brings it into view.
// 6. A header dragged: the log's newest entry is the drag in words, from a
//    click, with no command.
// 7. `undo` gives back the state before the drag (the pin's), "current" on
//    the pin's entry; the way back on the opening gives back the file's
//    own view.
// 8. Escape in the log puts focus on the table and leaves it open; select-all
//    there takes its entries and none of its chrome.
// 9. Another file, chosen from the bar's list, starts the log again: one
//    entry, its opening, from a pick.
// No console errors, in each browser.
//
// Against the dev server by default (`just tycho dev`); pass the preview's
// URL for the release build.
// Usage: node apps/tycho/perf/command.ts [url]

import { mkdtempSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { chromium, firefox, webkit, type BrowserType, type Page } from '@playwright/test';
import { waitMark } from '../../../shared-web/perf/harness.ts';

const url = new URL(process.argv.find((arg) => /^https?:/.test(arg)) ?? 'http://localhost:5173/');
url.searchParams.set('bench', '');
const TIMEOUT = 60_000;
const STEP = 10_000;
/** Pointer moves a drag is made of: a drag needs more than one to start. */
const DRAG_MOVES = 8;
/** The row `jump` goes to, as the visitor counts it. */
const JUMP = 1204;
const MOD = 'ControlOrMeta';

interface View {
  source: { kind: string; name: string };
  columns: { name: string }[];
  pinned?: number;
}

interface Layout {
  left: number;
  top: number;
  rowHeight: number;
  columns: { name: string; x: number; width: number }[];
}

interface Entry {
  id: number;
  command: string | null;
  words: string | null;
  reply: string;
  replyKind: string;
  origin: string;
  current: boolean;
  back: boolean;
}

type CheckGlobal = {
  __tychoView?: View | null;
  __tychoTable?: { marked?: number | null; first: number; end: number };
  __tychoTableLayout?: Layout;
};

interface Outcome {
  what: string;
  ok: boolean;
  detail: string;
}

const view = (page: Page) => page.evaluate(() => (globalThis as CheckGlobal).__tychoView ?? null);
const names = (v: View | null) => v?.columns.map((column) => column.name) ?? [];
const same = (a: string[], b: string[]) => a.length === b.length && a.every((name, index) => name === b[index]);

/** The view once it satisfies `test` (a predicate over `v`, as text), or
 *  the view as it is after the timeout. */
async function viewWhere(page: Page, test: string, timeout = STEP): Promise<View | null> {
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

/** The log as drawn, oldest first. */
const log = (page: Page): Promise<Entry[]> =>
  page.$$eval('#log li[data-entry]', (items) =>
    items.map((item) => {
      const el = item as HTMLElement;
      return {
        id: Number(el.dataset.entry),
        command: el.querySelector('[data-command]')?.textContent ?? null,
        words: el.querySelector('[data-words]')?.textContent ?? null,
        reply: el.children[1]?.textContent ?? '',
        replyKind: el.dataset.reply ?? '',
        origin: el.dataset.origin ?? '',
        current: el.hasAttribute('data-current'),
        back: el.querySelector('[data-back]') !== null,
      };
    }),
  );

/** The log once `test` holds of it, or as it is after the timeout. */
async function logWhere(page: Page, test: (entries: Entry[]) => boolean): Promise<Entry[]> {
  const until = Date.now() + STEP;
  let entries = await log(page);
  while (!test(entries) && Date.now() < until) {
    await page.waitForTimeout(100);
    entries = await log(page);
  }
  return entries;
}

const showEntry = (entry: Entry | undefined) =>
  entry ? `${JSON.stringify(entry.command ?? entry.words)} → ${JSON.stringify(entry.reply)} (${entry.replyKind}, ${entry.origin}${entry.current ? ', current' : ''})` : 'none';

/** What has focus: the canvas's input, the first screen's box, the bar's,
 *  or another element. */
const focus = (page: Page) =>
  page.evaluate(() => {
    const active = document.activeElement;
    if (!active || active === document.body) return 'nothing';
    if (active.matches('body > textarea')) return 'table';
    if (active.closest('#first') && active.getAttribute('role') === 'combobox') return 'first';
    if (active.closest('#command-bar') && active.getAttribute('role') === 'combobox') return 'bar';
    return active.outerHTML.slice(0, 80);
  });

async function focusWhere(page: Page, want: string): Promise<string> {
  try {
    await page.waitForFunction((want) => {
      const active = document.activeElement;
      if (want === 'table') return active?.matches('body > textarea') ?? false;
      if (want === 'bar') return !!active?.closest('#command-bar') && active.getAttribute('role') === 'combobox';
      return !!active?.closest('#first') && active.getAttribute('role') === 'combobox';
    }, want, { timeout: STEP });
  } catch {
    // Reported by the caller.
  }
  return focus(page);
}

/** The bar's text once it matches `pattern`, or as it is after the timeout. */
async function barSays(page: Page, pattern: RegExp): Promise<string> {
  try {
    await page.waitForFunction((source) => new RegExp(source).test(document.querySelector('#command-bar')?.textContent ?? ''), pattern.source, { timeout: STEP });
  } catch {
    // Reported by the caller.
  }
  return (await page.textContent('#command-bar').catch(() => null)) ?? '(the bar is closed)';
}

/** Opens the bar from wherever focus is and types `text` into it. */
async function typeCommand(page: Page, text: string): Promise<void> {
  await page.keyboard.press(`${MOD}+K`);
  await focusWhere(page, 'bar');
  await page.keyboard.type(text);
}

/** The canvas's pixels (the table's layout) in the page's. */
const layout = (page: Page) =>
  page.evaluate(() => {
    const probe = (globalThis as CheckGlobal).__tychoTableLayout!;
    const canvas = document.querySelector('#table-slot canvas')!.getBoundingClientRect();
    return { ...probe, left: probe.left + canvas.left, top: probe.top + canvas.top };
  });

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

async function run(page: Page, csv: string): Promise<Outcome[]> {
  const outcomes: Outcome[] = [];
  const check = (what: string, ok: boolean, detail: string) => outcomes.push({ what, ok, detail });
  await waitMark(page, 'tycho:engine-locked', 0, TIMEOUT);

  // 1. Cmd/Ctrl+K from the first screen, focus first on the canvas's input.
  await page.evaluate(() => document.querySelector<HTMLElement>('body > textarea')?.focus());
  await page.keyboard.press(`${MOD}+K`);
  check('Cmd/Ctrl+K on the first screen', (await focusWhere(page, 'first')) === 'first', `focus on ${await focus(page)}`);

  await page.click('#first [data-action=sample]');
  const opened = await viewWhere(page, "v.source.kind === 'sample'", TIMEOUT);
  if (!opened) return [...outcomes, { what: 'the sample opens', ok: false, detail: 'no view published' }];
  await page.click('header [data-action=log]');
  const first = await logWhere(page, (entries) => entries.length === 1);
  check(
    'the log opened, its opening current',
    first.length === 1 && first[0]!.command === `open ${opened.source.name}` && first[0]!.origin === 'sample' && first[0]!.current,
    `${first.length} entries: ${showEntry(first[0])}`,
  );

  // 2. Cmd/Ctrl+K from the table, `pin` typed.
  await page.locator('#table-slot canvas').click({ position: { x: 200, y: 200 } });
  await focusWhere(page, 'table');
  await page.keyboard.press(`${MOD}+K`);
  check('Cmd/Ctrl+K from the table', (await focusWhere(page, 'bar')) === 'bar', `focus on ${await focus(page)}`);
  // A narrow column, so the pinned run fits in half the table.
  const column = opened.columns[2]!.name;
  await page.keyboard.type(`pin ${column}`);
  await page.keyboard.press('Enter');
  const pinned = await viewWhere(page, `v.pinned === 1 && v.columns[0].name === ${JSON.stringify(column)}`);
  check('pin, read back from the view', pinned?.pinned === 1 && names(pinned)[0] === column, `pinned ${pinned?.pinned ?? 0}, first ${names(pinned)[0]}`);
  const afterPin = await logWhere(page, (entries) => entries.length === 2);
  const pinEntry = afterPin[1];
  check(
    'pin, in the log',
    pinEntry?.command === `pin ${column}` && pinEntry.origin === 'typed' && pinEntry.current && pinEntry.replyKind === 'rows',
    showEntry(pinEntry),
  );
  check('focus on the table after a command ran', (await focusWhere(page, 'table')) === 'table', `focus on ${await focus(page)}`);

  // 3. A pasted action of two steps, the second naming no column.
  const other = names(pinned)[3]!;
  const action = JSON.stringify({ actions: [{ pin: { column: other } }, { pin: { column: 'no_such_column' } }] });
  await page.keyboard.press(`${MOD}+K`);
  await focusWhere(page, 'bar');
  // A paste as the browser delivers one: the event, then the text as one
  // input. Not `keyboard.insertText`, which Firefox's Playwright types as
  // an IME's composition, as no paste is.
  await page.evaluate((text) => {
    const input = document.activeElement as HTMLInputElement;
    input.dispatchEvent(new ClipboardEvent('paste', { bubbles: true }));
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text);
    input.setSelectionRange(text.length, text.length);
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste', data: text }));
  }, action);
  await page.keyboard.press('Enter');
  const refusal = await barSays(page, /Step 2 of 2/);
  const unchanged = await view(page);
  check(
    'a pasted action refused whole',
    /Step 2 of 2/.test(refusal) && refusal.includes('no_such_column') && /Nothing ran/.test(refusal) && unchanged?.pinned === 1 && same(names(unchanged), names(pinned)),
    `${refusal.trim().slice(0, 140)}; pinned ${unchanged?.pinned ?? 0}`,
  );
  const afterPaste = await logWhere(page, (entries) => entries.length === 3);
  check('the refusal, in the log', afterPaste[2]?.replyKind === 'error' && afterPaste[2].origin === 'pasted' && !afterPaste[2].current && !afterPaste[2].back, showEntry(afterPaste[2]));
  await page.keyboard.press('Escape');

  // 4. A sentence.
  await typeCommand(page, 'how many launches failed?');
  await page.keyboard.press('Enter');
  // The answer, with its period: the preview before Enter says the same
  // words as a heading, without one.
  const sentence = await barSays(page, /Tycho reads commands, not sentences\./);
  check('a sentence answered', /Tycho reads commands, not sentences\./.test(sentence), sentence.trim().slice(0, 100));
  await page.keyboard.press('Escape');

  // 5. `jump`.
  await typeCommand(page, `jump ${JUMP}`);
  await page.keyboard.press('Enter');
  try {
    await page.waitForFunction((row) => {
      const t = (globalThis as CheckGlobal).__tychoTable;
      return t?.marked === row && t.first <= row && row < t.end;
    }, JUMP - 1, { timeout: STEP });
  } catch {
    // Reported below, from the table as it stands.
  }
  const table = await page.evaluate(() => (globalThis as CheckGlobal).__tychoTable ?? null);
  check('jump brings its row into view', table?.marked === JUMP - 1 && table.first <= JUMP - 1 && JUMP - 1 < table.end, `marked ${table?.marked}, rows ${table?.first}–${table?.end} in view`);

  // 6. A header dragged: the fourth column after the sixth, clear of the
  // pinned run.
  const beforeDrag = await view(page);
  const l = await layout(page);
  const [from, to] = [l.columns[3]!, l.columns[5]!];
  const headerY = l.top - l.rowHeight / 2;
  await drag(page, { x: l.left + from.x + Math.min(12, from.width / 4), y: headerY }, { x: l.left + to.x + (to.width * 3) / 4, y: headerY });
  const dragged = await logWhere(page, (entries) => entries.at(-1)?.command === null);
  const dragEntry = dragged.at(-1);
  check(
    'a drag, in the log in words',
    dragEntry?.command === null && /^Moved /.test(dragEntry.words ?? '') && dragEntry.origin === 'click' && dragEntry.current,
    showEntry(dragEntry),
  );

  // 7. `undo`, then the way back on the opening.
  await typeCommand(page, 'undo');
  await page.keyboard.press('Enter');
  const undone = await viewWhere(page, `${JSON.stringify(names(beforeDrag))}.every((name, place) => v.columns[place].name === name)`);
  const afterUndo = await logWhere(page, (entries) => entries.find((entry) => entry.current)?.id === pinEntry?.id);
  check(
    'undo gives back the state before the drag',
    same(names(undone), names(beforeDrag)) && undone?.pinned === 1 && afterUndo.find((entry) => entry.current)?.id === pinEntry?.id && afterUndo.length === dragged.length,
    `${names(undone).slice(0, 6).join(', ')}…, pinned ${undone?.pinned ?? 0}; current: ${showEntry(afterUndo.find((entry) => entry.current))}`,
  );
  await page.click('#log li[data-entry]:first-child [data-back]');
  const back = await viewWhere(page, '(v.pinned ?? 0) === 0');
  const afterBack = await logWhere(page, (entries) => entries[0]?.current === true);
  check(
    'the way back gives back the opening',
    same(names(back), names(opened)) && (back?.pinned ?? 0) === 0 && afterBack[0]!.current && afterBack.length === dragged.length,
    `${names(back).slice(0, 4).join(', ')}…, pinned ${back?.pinned ?? 0}; ${afterBack.length} entries`,
  );

  // 8. Escape in the log, and select-all there.
  await page.locator('#log li[data-entry]').last().locator('div').nth(1).click();
  await page.keyboard.press(`${MOD}+A`);
  const selected = await page.evaluate(() => getSelection()?.toString() ?? '');
  check(
    'select-all in the log takes its entries',
    selected.includes(`pin ${column}`) && selected.includes(opened.source.name) && !selected.includes('Nothing is sent') && !/\bcurrent\b/.test(selected),
    JSON.stringify(selected.slice(0, 90)),
  );
  await page.focus('#log li[data-entry] [data-back]');
  await page.keyboard.press('Escape');
  const escaped = await focusWhere(page, 'table');
  check('Escape in the log: focus on the table, the log open', escaped === 'table' && (await page.isVisible('#log')), `focus on ${escaped}`);

  // 9. Another file, from the bar's list.
  await page.keyboard.press(`${MOD}+K`);
  await focusWhere(page, 'bar');
  const [chooser] = await Promise.all([page.waitForEvent('filechooser', { timeout: STEP }), page.click('#command-bar [data-action=pick]')]);
  await chooser.setFiles(csv);
  const csvView = await viewWhere(page, "v.source.kind === 'csv'", TIMEOUT);
  const fresh = await logWhere(page, (entries) => entries.length === 1 && entries[0]!.origin === 'pick');
  check(
    'another file starts the log again',
    csvView !== null && fresh.length === 1 && fresh[0]!.command === `open ${csvView.source.name}` && fresh[0]!.origin === 'pick' && fresh[0]!.current,
    `${fresh.length} entries: ${showEntry(fresh[0])}`,
  );
  return outcomes;
}

const ENGINES: { name: string; type: BrowserType }[] = [
  { name: 'chromium', type: chromium },
  { name: 'firefox', type: firefox },
  { name: 'webkit', type: webkit },
];

// A small CSV, the other file the bar opens.
const dir = mkdtempSync(join(tmpdir(), 'tycho-command-'));
const csv = join(dir, 'other.csv');
writeFileSync(csv, 'id,name,value\n' + Array.from({ length: 50 }, (_, row) => `${row},object ${row},${row / 7}`).join('\n') + '\n');

let failures = 0;
try {
  for (const { name, type } of ENGINES) {
    const browser = await type.launch();
    const errors: string[] = [];
    let outcomes: Outcome[] = [];
    try {
      const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      await page.goto(url.href);
      outcomes = await run(page, csv);
    } catch (error) {
      outcomes.push({ what: 'the run finished', ok: false, detail: error instanceof Error ? error.message.split('\n')[0]! : String(error) });
    } finally {
      await browser.close();
    }
    for (const error of errors) outcomes.push({ what: 'no console error', ok: false, detail: error });
    for (const outcome of outcomes) {
      if (!outcome.ok) failures += 1;
      console.log(`${name.padEnd(9)}${outcome.ok ? 'ok  ' : 'FAIL'}  ${outcome.what}: ${outcome.detail}`);
    }
  }
} finally {
  // The CSV and the folder made for it, and nothing else.
  unlinkSync(csv);
  rmdirSync(dirname(csv));
}
console.log(failures ? `\nFAIL: ${failures} check(s)` : '\nPASS');
process.exit(failures ? 1 : 0);
