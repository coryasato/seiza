import { type Completion, getState, type RowValues, subscribe } from './state.ts';

/**
 * What the frame does before React and without it: plain TypeScript in the
 * entry, bound to the prerendered page at once, so a press, a key, or a
 * drop works from the first paint (React loads after the first frame,
 * `hydrate.tsx`, and only draws the state). Every control says what it does
 * with `data-action`, and one listener here runs it. The app's calls are
 * queued until the first frame ([`connectApp`]).
 */

/** The app's calls (`crate/src/frame.rs`, its `#[wasm_bindgen]` functions). */
export interface App {
  open_file(file: File, at: number, more: number, from: 'drop' | 'pick'): void;
  open_sample(at: number): void;
  retry_engine(): void;
  set_theme(dark: boolean): void;
  toggle_perf(): void;
  /** The command bar's Enter; its answer comes in the frame's state,
   *  carrying the number this returns (`Answer.ask`). */
  command(text: string, source: 'typed' | 'pasted' | 'click'): number;
  /** At once: the bar's completion, the caret in UTF-16 units. */
  complete(text: string, caret: number): Completion;
  /** At once: the filter editor's command, column `column` (its index),
   *  `op` as the grammar spells it, `values` as typed, each quoted where
   *  the grammar needs; null with no file open. */
  filter_line(column: number, op: string, values: string[]): string | null;
  /** The log's way back on an entry. */
  back_to(entry: number): void;
  /** A row's values (0-based) for the Row tab; null with no file open, no
   *  such row, or a read that failed. */
  row(row: number): Promise<RowValues | null>;
  /** A column's menu's Fit: column `column` (its index) fitted to its
   *  values, as a double-click on its header's edge fits it. */
  fit(column: number): void;
  /** A cell's menu's Copy: the table's selection, as Cmd/Ctrl+C copies
   *  it. Run in the press's own task, so the clipboard still counts it as
   *  the press's gesture: never queue it. */
  copy(): void;
  /** The Row tab's copies: column `column`'s whole value (its index), or
   *  with none the whole row, a line of names and a line of values; null
   *  with no such row or column. */
  row_text(row: number, column?: number): Promise<string | null>;
  /** The Row tab's Previous and Next row: the table's selection made cell
   *  `row` of column `column` (its index), scrolled into view. */
  select(row: number, column: number): void;
  /** A cell menu's "Focus row in panel": cell `row` of column `column` (its
   *  index) selected alone, then an `open` press for it, sent after the
   *  frame that carries the selection. */
  open_row(row: number, column: number): void;
}

let app: App | null = null;
const queued: ((app: App) => void)[] = [];

function call(run: (app: App) => void): void {
  if (app) run(app);
  else queued.push(run);
}

/** The app's calls, or null before the first frame: `complete` answers at
 *  once, so it isn't queued. */
export const appNow = (): App | null => app;

/** The first frame is up: the calls made before it run now. Not sooner,
 *  though the wasm is in before it: a press on the sample's row would
 *  start its download before first paint (rule 2). */
export function connectApp(given: App): void {
  app = given;
  for (const run of queued.splice(0)) run(given);
}

/** The page's root: read when used, since the prerender imports this file
 *  (through `bar.tsx`) where there's no document. */
const root = (): HTMLElement => document.documentElement;
export const isDark = (): boolean => root().dataset.theme === 'dark';

/** The file dialog's input. It stays in the page: Safari fires `change`
 *  only for inputs in the document. `accept` is a hint for the dialog's
 *  filter, not a check: the app's sniff decides. */
function fileInput(): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.parquet,.parq,.pq,.csv,.tsv,text/csv,text/tab-separated-values';
  input.hidden = true;
  input.addEventListener('change', () => {
    if (input.files) chosen(input.files, 'pick');
    // So picking the same file again still fires `change`.
    input.value = '';
  });
  document.body.append(input);
  return input;
}

/** A drop's or the dialog's files: the first opens, and the app says so if
 *  there were more. */
function chosen(files: FileList, from: 'drop' | 'pick'): void {
  // Read now: the dialog's list is emptied in place when its input is
  // cleared, before a queued call runs.
  const [file, at, more] = [files[0], performance.now(), files.length - 1];
  if (file) call((app) => app.open_file(file, at, more, from));
}

const ACTIONS: Record<string, () => void> = {
  // A row pressed in the bar closes it and gives the table the keys: the
  // table's input stays across files, so they're there when the next one
  // opens (or the dialog is canceled).
  pick: () => {
    closeBar('table');
    (input ??= fileInput()).click();
  },
  sample: () => {
    closeBar('table');
    const at = performance.now();
    call((app) => app.open_sample(at));
  },
  retry: () => call((app) => app.retry_engine()),
  log: () => setLogOpen(!logOpen),
  columns: () => setColumnsOpen(!columnsOpen),
  theme: () => {
    followSystem = false;
    setTheme(!isDark());
  },
};
let input: HTMLInputElement | null = null;

/** The theme follows the system until the visitor picks one, then holds
 *  until a reload, in memory only (as the canvas's did). */
let followSystem = true;
function setTheme(dark: boolean): void {
  root().dataset.theme = dark ? 'dark' : 'light';
  call((app) => app.set_theme(dark));
}

/** The first screen's box: the command bar with no file open
 *  (`bar.tsx`). Its input holds focus; its rows are its list's. */
const firstInput = (): HTMLInputElement | null => document.querySelector('#first [role=combobox]');
const firstRows = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('#first [role=option]')];

/** React owns the first screen's box once it hydrates (`hydrate.tsx`):
 *  Base UI moves its highlight and takes its arrows and Enter. */
let reactOwns = false;
export function handOver(): void {
  reactOwns = true;
  // Base UI draws its own highlight; the one set here would stay.
  for (const row of firstRows()) row.removeAttribute('data-highlighted');
}

function highlight(rows: HTMLElement[], index: number): void {
  rows.forEach((row, i) => row.toggleAttribute('data-highlighted', i === index));
}

/** The first screen's box before React: its arrows, Enter (the row
 *  highlighted: a typed line is answered only once React draws the box,
 *  a stand-in until the box takes a URL, `docs/DECISIONS.md`, "Scope",
 *  2026-11-24), and always, while
 *  its input is empty, a row's letter (`docs/DECISIONS.md`, "Scope",
 *  2026-11-24: with no file there's nothing for a command to act on, so
 *  the letters cost nothing). */
function firstKeys(input: HTMLInputElement, event: KeyboardEvent): void {
  const rows = firstRows();
  // A key that starts an IME's composition is the IME's, never a row's.
  if (event.isComposing || event.keyCode === 229) return;
  if (input.value === '' && !event.metaKey && !event.ctrlKey && !event.altKey) {
    const row = rows.find((row) => row.dataset.key === event.key.toUpperCase());
    if (row) {
      event.preventDefault();
      row.click();
      return;
    }
  }
  if (reactOwns) return;
  const at = rows.findIndex((row) => row.hasAttribute('data-highlighted'));
  if (event.key === 'ArrowDown') highlight(rows, (at + 1) % rows.length);
  else if (event.key === 'ArrowUp') highlight(rows, (at - 1 + rows.length) % rows.length);
  else if (event.key === 'Enter') rows[Math.max(at, 0)]?.click();
  else return;
  event.preventDefault();
}

/** The command bar in the top bar, open or closed (`bar.tsx` draws it):
 *  Cmd/Ctrl+K opens it from anywhere; closing it puts focus back where it
 *  came from, and a command that ran puts it on the table. */
let barOpen = false;
let barReturn: HTMLElement | null = null;
const barListeners = new Set<() => void>();
export const isBarOpen = (): boolean => barOpen;
export function subscribeBar(listener: () => void): () => void {
  barListeners.add(listener);
  return () => barListeners.delete(listener);
}
export function openBar(): void {
  if (barOpen) {
    document.querySelector<HTMLInputElement>('#command-bar [role=combobox]')?.focus();
    return;
  }
  const active = document.activeElement;
  barReturn = active instanceof HTMLElement && active !== document.body ? active : null;
  barOpen = true;
  for (const listener of barListeners) listener();
}
/** `back` where it was opened from (the table if that's gone), `table`
 *  after a command ran, `none` when focus has already gone elsewhere (a
 *  press outside, a Tab away). */
export function closeBar(to: 'back' | 'table' | 'none'): void {
  if (!barOpen) return;
  barOpen = false;
  for (const listener of barListeners) listener();
  const back = to === 'back' && barReturn?.isConnected ? barReturn : canvasKeys();
  barReturn = null;
  if (to !== 'none') back?.focus({ preventScroll: true });
}

/** The right panel, its Log tab (`log.tsx` draws it): collapsed until the
 *  top bar's button opens it, and open or not across files. What CSS lays
 *  out rides on the root's `data-log` (the table's slot gives it a column). */
let logOpen = false;
const logListeners = new Set<() => void>();
export const isLogOpen = (): boolean => logOpen;
export function subscribeLog(listener: () => void): () => void {
  logListeners.add(listener);
  return () => logListeners.delete(listener);
}
export function setLogOpen(open: boolean): void {
  if (open === logOpen) return;
  logOpen = open;
  root().toggleAttribute('data-log', open);
  for (const listener of logListeners) listener();
}

/** The left panel, its column list (`columns.tsx` draws it): closed until
 *  the top bar's left button opens it, open or not across files. A column
 *  of the page's grid beside the table, as the right panel is (the root's
 *  `data-columns`); at a phone the list is the panels' sheet's Columns tab. */
let columnsOpen = false;
const columnsListeners = new Set<() => void>();
export const isColumnsOpen = (): boolean => columnsOpen;
export function subscribeColumns(listener: () => void): () => void {
  columnsListeners.add(listener);
  return () => columnsListeners.delete(listener);
}
export function setColumnsOpen(open: boolean): void {
  if (open === columnsOpen) return;
  columnsOpen = open;
  root().toggleAttribute('data-columns', open);
  for (const listener of columnsListeners) listener();
}

/** The phone's sheet's tab: Columns first, as Phone 2 draws it, then kept
 *  where it was left across openings. */
export type SheetTab = 'columns' | 'row' | 'log';
let sheetTab: SheetTab = 'columns';
const sheetListeners = new Set<() => void>();
export const getSheetTab = (): SheetTab => sheetTab;
export function subscribeSheetTab(listener: () => void): () => void {
  sheetListeners.add(listener);
  return () => sheetListeners.delete(listener);
}
export function setSheetTab(tab: SheetTab): void {
  if (tab === sheetTab) return;
  sheetTab = tab;
  for (const listener of sheetListeners) listener();
}

/** The right panel's tab at a wide page: Log first, then kept where it
 *  was left. */
export type PanelTab = 'log' | 'row';
let panelTab: PanelTab = 'log';
const panelListeners = new Set<() => void>();
export const getPanelTab = (): PanelTab => panelTab;
export function subscribePanelTab(listener: () => void): () => void {
  panelListeners.add(listener);
  return () => panelListeners.delete(listener);
}
export function setPanelTab(tab: PanelTab): void {
  if (tab === panelTab) return;
  panelTab = tab;
  for (const listener of panelListeners) listener();
}

/** Where the Row tab puts focus once its row is drawn: the field of
 *  `column` (its index) in row `row`, asked by every way to the row but the
 *  double press, which leaves focus on the table (`docs/DECISIONS.md`,
 *  "Scope", 2026-11-25). Taken once. */
let rowFocus: { row: number; column: number } | null = null;
/** Counts the asks, so the Row tab hears one for a row it already shows. */
let rowFocusAsks = 0;
const rowFocusListeners = new Set<() => void>();
export const getRowFocusAsks = (): number => rowFocusAsks;
export function subscribeRowFocus(listener: () => void): () => void {
  rowFocusListeners.add(listener);
  return () => rowFocusListeners.delete(listener);
}
export function takeRowFocus(row: number): number | null {
  if (!rowFocus || rowFocus.row !== row) return null;
  const { column } = rowFocus;
  rowFocus = null;
  return column;
}

/** An ask for focus at another row than `row` is dropped: the selection
 *  moved on before its row was drawn. */
export function dropRowFocus(row: number): void {
  if (rowFocus && rowFocus.row !== row) rowFocus = null;
}

/** The Row tab opened, the right panel with it (at a phone, the sheet on
 *  its Row tab), showing the active cell's row; with `focus` (Enter), focus
 *  goes to that cell's field once it's drawn. Only the shown one turns: the
 *  other keeps the tab it was left on (the sheet's Columns first). */
export function openRow(focus: { row: number; column: number } | null, phone: boolean): void {
  rowFocus = focus;
  if (focus) {
    rowFocusAsks++;
    for (const listener of rowFocusListeners) listener();
  }
  if (phone) setSheetTab('row');
  else setPanelTab('row');
  setLogOpen(true);
}

/** A row's values for the Row tab (`App.row`). */
export function rowValues(row: number): Promise<RowValues | null> {
  return new Promise((resolve) => call((app) => app.row(row).then(resolve, () => resolve(null))));
}

/** The Row tab's Previous and Next row. */
export function selectCell(row: number, column: number): void {
  call((app) => app.select(row, column));
}

/** A cell menu's "Focus row in panel": the app selects the cell, then
 *  presses `open` for it, which opens its row (`menus.tsx`). */
export function focusRow(row: number, column: number): void {
  call((app) => app.open_row(row, column));
}

/** A Row tab's copy, column `column`'s value or the whole row (null):
 *  the clipboard's write opened at once, in the press's task, so it still
 *  counts as the press's gesture, and handed the text when the app has it
 *  (as the table's copies are, `tall_table_bridge::clipboard`); `known` is
 *  the text when the tab holds it whole, written at once where a browser
 *  has no ClipboardItem. Resolves true once the browser wrote it. */
export function copyRowText(row: number, column: number | null, known: string | null = null): Promise<boolean> {
  const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
  if (!clipboard) return Promise.resolve(false);
  // Without ClipboardItem a write must start in the press's task, so it
  // writes the text the tab already holds whole, if it does.
  if (typeof ClipboardItem === 'undefined' || !clipboard.write) {
    if (known !== null) return clipboard.writeText(known).then(() => true, () => false);
  }
  const text = app ? app.row_text(row, column ?? undefined) : Promise.resolve(null);
  if (typeof ClipboardItem !== 'undefined' && clipboard.write) {
    const blob = text.then((text) => {
      if (text === null) throw new Error('No such value');
      return new Blob([text], { type: 'text/plain' });
    });
    return clipboard.write([new ClipboardItem({ 'text/plain': blob })]).then(
      () => true,
      () => false,
    );
  }
  // A browser may refuse a write this long after the press.
  return text.then((text) => (text === null ? false : clipboard.writeText(text).then(() => true, () => false)));
}

/** The last copy of a field's value made from its menu, said on the
 *  field's own Copy button (its check or its x), since the menu has
 *  closed by the time the browser answers. */
export interface FieldCopy {
  row: number;
  column: number;
  ok: boolean;
  /** Counts the copies, so the same field copied twice is said twice. */
  seq: number;
}
let fieldCopy: FieldCopy | null = null;
let fieldCopies = 0;
const fieldCopyListeners = new Set<() => void>();
export const getFieldCopy = (): FieldCopy | null => fieldCopy;
export function subscribeFieldCopy(listener: () => void): () => void {
  fieldCopyListeners.add(listener);
  return () => fieldCopyListeners.delete(listener);
}

/** A field's menu's Copy: `copyRowText` with the text the tab holds whole
 *  (`known`), its outcome said on the field's button. */
export function copyField(row: number, column: number, known: string | null): void {
  void copyRowText(row, column, known).then((ok) => {
    fieldCopy = { row, column, ok, seq: ++fieldCopies };
    for (const listener of fieldCopyListeners) listener();
  });
}

/** A menu's or the column list's command (`hide mag`, `pin "launch
 *  date"`): a click's, logged as one. A refusal is said in the frame's
 *  line, since no bar is open to answer it. */
export function act(line: string): void {
  call((app) => app.command(line, 'click'));
}

/** A column's menu's Fit, by the column's index. */
export function fitColumn(index: number): void {
  call((app) => app.fit(index));
}

/** A cell's menu's Copy: at once, in the press's task (`App.copy`). */
export function copySelection(): void {
  app?.copy();
}

/** The table takes the keys: after a menu's action, or Escape from a
 *  menu opened in the table. */
export function focusTable(): void {
  canvasKeys()?.focus({ preventScroll: true });
}

/** The log's way back on an entry: the view it names, given back. The
 *  app gives the table the keys once it is, and says why where it isn't
 *  (the frame's line), focus left on the button. */
export function backTo(entry: number): void {
  call((app) => app.back_to(entry));
}

/** Cmd/Ctrl+K: the bar, wherever focus is. With no file, the first
 *  screen's box is the bar. */
function commandKey(): void {
  if (getState().file === null) {
    const input = firstInput();
    input?.focus({ preventScroll: true });
    input?.select();
  } else openBar();
}

/** Binds the page's controls, keys, and drops: once, from the entry. */
export function bindFrame(): void {
  document.addEventListener('click', (event) => {
    const control = (event.target as Element).closest<HTMLElement>('[data-action]');
    const run = control && !control.hasAttribute('aria-disabled') && ACTIONS[control.dataset.action!];
    if (run) run();
  });
  document.addEventListener('pointermove', (event) => {
    if (reactOwns) return;
    const row = (event.target as Element).closest<HTMLElement>('#first [role=option]');
    const rows = firstRows();
    if (row) highlight(rows, rows.indexOf(row));
  });
  document.addEventListener('keydown', (event) => {
    const input = firstInput();
    if (input && event.target === input && !event.defaultPrevented) firstKeys(input, event);
  });
  // The page's own keys, wherever focus is: taken on the way down, before
  // the canvas sees them, since a key the canvas has focus for may never
  // bubble up unhandled (Firefox: GPUI marks Ctrl+Shift+L handled). The
  // panel's key too, so its binding on the canvas never runs as well.
  document.addEventListener(
    'keydown',
    (event) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === 'k' && !event.shiftKey) commandKey();
      else if (!event.shiftKey) return;
      else if (key === 'l') ACTIONS.theme!();
      else if (key === 'p') call((app) => app.toggle_perf());
      else return;
      event.preventDefault();
      event.stopPropagation();
    },
    { capture: true },
  );

  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (query) => {
    if (followSystem) setTheme(query.matches);
  });

  // A dragged file hazes the page (CSS, on `data-dragging`). `dragenter`
  // and `dragleave` fire for every element the pointer crosses; only the
  // page's own enter and leave count. Text and links aren't file drops.
  let depth = 0;
  const carriesFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files') ?? false;
  addEventListener('dragenter', (event) => {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    if (++depth === 1) root().toggleAttribute('data-dragging', true);
  });
  addEventListener('dragover', (event) => {
    if (!carriesFiles(event)) return;
    // Without this the browser opens the file in the tab. "Copy", not
    // "move": the file stays where it is.
    event.preventDefault();
    event.dataTransfer!.dropEffect = 'copy';
  });
  addEventListener('dragleave', () => {
    // No `carriesFiles` check: a browser may report other types on the way
    // out, which would leave the haze up.
    if (depth > 0 && --depth === 0) root().removeAttribute('data-dragging');
  });
  addEventListener('drop', (event) => {
    event.preventDefault();
    depth = 0;
    root().removeAttribute('data-dragging');
    if (event.dataTransfer?.files.length) chosen(event.dataTransfer.files, 'drop');
  });

  // The box's look before React: its first row highlighted, and the key
  // hint the platform's (prerendered as the Mac's).
  if (!reactOwns) highlight(firstRows(), 0);
  for (const hint of document.querySelectorAll('[data-mod-key]')) hint.textContent = modKey();

  focusFirstScreen();

  // A file opened from the first screen: its list is gone, and with it
  // focus. The table takes the keys, as a press on it would give them.
  let open = false;
  subscribe(() => {
    const now = getState().file !== null;
    // The list may still hold focus here: the browser drops it from a
    // hidden element only at its next style pass.
    const active = document.activeElement;
    const lost = !active || active === document.body || !!active.closest('#first');
    if (now && !open && lost) canvasKeys()?.focus({ preventScroll: true });
    // The file gone (another opening, the engine stopped): the bar went
    // with the top bar's box, and doesn't come back open over the next.
    if (!now) closeBar('none');
    open = now;
  });
}

/** The first screen's input takes the keys: at once, and again after the
 *  first frame, since GPUI takes focus for its own input as its window
 *  opens. Not once a file is open, or when focus is elsewhere in the page. */
export function focusFirstScreen(): void {
  if (getState().file !== null) return;
  const active = document.activeElement;
  if (active && active !== document.body && active !== canvasKeys()) return;
  firstInput()?.focus({ preventScroll: true });
}

/** What receives the canvas's keys: the hidden text field gpui-pre-web adds
 *  to `<body>` and focuses on a press on the canvas (its `ImeMirror`). */
export const canvasKeys = (): HTMLElement | null => document.querySelector('body > textarea');

/** The command bar's key as the platform writes it. The prerendered page
 *  says the Mac's; `bindFrame` sets it. */
export const modKey = (): string =>
  typeof navigator !== 'undefined' && !/Mac|iPhone|iPad/.test(navigator.platform) ? 'Ctrl K' : '⌘K';

/**
 * GPUI appends its canvas to `<body>`; the table's slot is where it goes.
 * Moved as it's added, before GPUI's first measure of it, so the first
 * frame is drawn at the slot's size. The canvas reads its pointer
 * positions and viewport relative to itself, so it works anywhere.
 */
export function slotCanvas(slot: HTMLElement): void {
  // Watched for the page's life: nothing else adds a canvas to `<body>`,
  // and the first one added needn't be the window's.
  new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node instanceof HTMLCanvasElement) slot.append(node);
      }
    }
  }).observe(document.body, { childList: true });
}
