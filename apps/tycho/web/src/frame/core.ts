import { getState, subscribe } from './state.ts';

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
  open_file(file: File, at: number, more: number): void;
  open_sample(at: number): void;
  retry_engine(): void;
  set_theme(dark: boolean): void;
  toggle_perf(): void;
}

let app: App | null = null;
const queued: ((app: App) => void)[] = [];

function call(run: (app: App) => void): void {
  if (app) run(app);
  else queued.push(run);
}

/** The first frame is up: the calls made before it run now. Not sooner,
 *  though the wasm is in before it: a press on the sample's row would
 *  start its download before first paint (rule 2). */
export function connectApp(given: App): void {
  app = given;
  for (const run of queued.splice(0)) run(given);
}

const root = document.documentElement;
export const isDark = (): boolean => root.dataset.theme === 'dark';

/** The file dialog's input. It stays in the page: Safari fires `change`
 *  only for inputs in the document. `accept` is a hint for the dialog's
 *  filter, not a check: the app's sniff decides. */
function fileInput(): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.parquet,.parq,.pq,.csv,.tsv,text/csv,text/tab-separated-values';
  input.hidden = true;
  input.addEventListener('change', () => {
    if (input.files) chosen(input.files);
    // So picking the same file again still fires `change`.
    input.value = '';
  });
  document.body.append(input);
  return input;
}

/** A drop's or the dialog's files: the first opens, and the app says so if
 *  there were more. */
function chosen(files: FileList): void {
  // Read now: the dialog's list is emptied in place when its input is
  // cleared, before a queued call runs.
  const [file, at, more] = [files[0], performance.now(), files.length - 1];
  if (file) call((app) => app.open_file(file, at, more));
}

const ACTIONS: Record<string, () => void> = {
  pick: () => (input ??= fileInput()).click(),
  sample: () => {
    const at = performance.now();
    call((app) => app.open_sample(at));
  },
  retry: () => call((app) => app.retry_engine()),
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
  root.dataset.theme = dark ? 'dark' : 'light';
  call((app) => app.set_theme(dark));
}

/** Arrows, Enter, and a row's letter in the first screen's list. */
function listKeys(list: HTMLElement, event: KeyboardEvent): void {
  const rows = [...list.querySelectorAll<HTMLElement>('[role=option]')];
  const at = rows.findIndex((row) => row.getAttribute('aria-selected') === 'true');
  const select = (index: number) => {
    rows.forEach((row, i) => row.setAttribute('aria-selected', String(i === index)));
    list.setAttribute('aria-activedescendant', rows[index]!.id);
  };
  if (event.key === 'ArrowDown') select((at + 1) % rows.length);
  else if (event.key === 'ArrowUp') select((at - 1 + rows.length) % rows.length);
  else if (event.key === 'Enter') rows[at]?.click();
  else {
    const row = rows.findIndex((row) => row.dataset.key === event.key.toUpperCase());
    if (row < 0 || event.metaKey || event.ctrlKey || event.altKey) return;
    select(row);
    rows[row]!.click();
  }
  event.preventDefault();
}

/** Binds the page's controls, keys, and drops: once, from the entry. */
export function bindFrame(): void {
  document.addEventListener('click', (event) => {
    const control = (event.target as Element).closest<HTMLElement>('[data-action]');
    const run = control && !control.hasAttribute('aria-disabled') && ACTIONS[control.dataset.action!];
    if (run) run();
  });
  document.addEventListener('pointermove', (event) => {
    const row = (event.target as Element).closest<HTMLElement>('[role=listbox] [role=option]');
    if (!row || row.getAttribute('aria-selected') === 'true') return;
    for (const other of row.parentElement!.children) other.setAttribute('aria-selected', String(other === row));
    row.parentElement!.setAttribute('aria-activedescendant', row.id);
  });
  document.addEventListener('keydown', (event) => {
    const list = (event.target as Element).closest?.<HTMLElement>('[role=listbox]');
    if (list) listKeys(list, event);
  });
  // The page's own keys, wherever focus is: taken on the way down, before
  // the canvas sees them, since a key the canvas has focus for may never
  // bubble up unhandled (Firefox: GPUI marks Ctrl+Shift+L handled). The
  // panel's key too, so its binding on the canvas never runs as well.
  document.addEventListener(
    'keydown',
    (event) => {
      if (!(event.metaKey || event.ctrlKey) || !event.shiftKey || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === 'l') ACTIONS.theme!();
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
    if (++depth === 1) root.toggleAttribute('data-dragging', true);
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
    if (depth > 0 && --depth === 0) root.removeAttribute('data-dragging');
  });
  addEventListener('drop', (event) => {
    event.preventDefault();
    depth = 0;
    root.removeAttribute('data-dragging');
    if (event.dataTransfer?.files.length) chosen(event.dataTransfer.files);
  });

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
    open = now;
  });
}

/** The first screen's list takes the keys: at once, and again after the
 *  first frame, since GPUI takes focus for its own input as its window
 *  opens. Not once a file is open, or when focus is elsewhere in the page. */
export function focusFirstScreen(): void {
  if (getState().file !== null) return;
  const active = document.activeElement;
  if (active && active !== document.body && active !== canvasKeys()) return;
  document.querySelector<HTMLElement>('#first [role=listbox]')?.focus({ preventScroll: true });
}

/** What receives the canvas's keys: the hidden text field gpui-pre-web adds
 *  to `<body>` and focuses on a press on the canvas (its `ImeMirror`). */
const canvasKeys = (): HTMLElement | null => document.querySelector('body > textarea');

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
