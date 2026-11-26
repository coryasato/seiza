/**
 * The frame's state, as the app publishes it (`crate/src/frame.rs`,
 * `FrameView`, spells the same fields), and the store React reads it from.
 * Plain TypeScript in the entry: the app publishes from its first render,
 * before React has loaded (`hydrate.tsx` loads after the first frame).
 */

export interface Line {
  text: string;
  error: boolean;
}

export interface FileState {
  name: string;
  /** The sample, not a file from this device. */
  sample: boolean;
  /** `Parquet · 71,431 rows · 46 columns · 1.7 MiB`. */
  facts: string;
  /** Its rows: a CSV's so far while it reads. */
  rows: number;
  /** A CSV's load while it reads, or how it ended. */
  load: string | null;
  /** From the file's metadata: a sample's build writes it. */
  credit: string | null;
  /** A column shown as text, a load stopped. */
  notes: Line[];
}

/** Where a log entry came from (`crate/src/log.rs`, `Origin`). */
export type Origin = 'drop' | 'pick' | 'sample' | 'typed' | 'pasted' | 'click';

/** A log entry (`crate/src/log.rs`, `EntryView`). */
export interface LogEntry {
  /** Counts across files: the way back names it (`App.back_to`). */
  id: number;
  /** Its command lines, one a step; null for a drag. */
  command: string | null;
  /** Its plain words, a line a step. */
  words: string;
  reply: string;
  replyKind: 'rows' | 'answer' | 'error';
  origin: Origin;
  /** Wall-clock ms since the epoch. */
  at: number;
  /** It has a way back. */
  back: boolean;
}

/** The command bar's last answer (`crate/src/frame.rs`, `Answer`). */
export interface Answer {
  /** Counts answers: the same words twice are two. */
  seq: number;
  /** The command it answers (what `App.command` returned); 0 for an
   *  answer to no command. */
  ask: number;
  kind: 'done' | 'refused' | 'sentence' | 'later' | 'open' | 'nofile' | 'undone' | 'nothing';
  text: string;
  /** The steps that ran, in plain words. */
  steps: string[];
  /** A fault, in the error color. */
  error: boolean;
}

/** The table's active cell: its selection's anchor (`crate/src/frame.rs`,
 *  `ActiveCell`), which the Row tab shows the row of. */
export interface ActiveCell {
  /** 0-based. */
  row: number;
  /** The column's index in the file. */
  column: number;
}

/** A column's type, for its badge. */
export type ColumnType = 'number' | 'text' | 'time' | 'boolean';

/** What a column's menu shows of it (`crate/src/frame.rs`, `ColumnFacts`). */
export interface ColumnFacts {
  /** Its index in the file. */
  index: number;
  name: string;
  /** Its name as a command writes it, quoted where the grammar needs. */
  typed: string;
  type: ColumnType;
  /** DuckDB's type name. */
  dataType: string;
  pinned: boolean;
  hidden: boolean;
}

/** A press in the table the page answers (`crate/src/frame.rs`, `Press`):
 *  `icon` (a header's icon: its menu under `at`), `tap` (a press on a
 *  header: at a phone, a finger's opens its menu), `header` (a right-click or
 *  long press on a header), `cell` (one on a cell), `double` (a double press
 *  on a cell), `enter` (Enter on a cell with no popover), `open` (the
 *  popover's "Focus row in panel", pressed or by Enter). */
export interface TablePress {
  kind: 'icon' | 'tap' | 'header' | 'cell' | 'double' | 'enter' | 'open';
  column: ColumnFacts;
  /** A cell's row, 0-based; null on a header. */
  row: number | null;
  /** A cell's exact text, cut at 200 characters; null for NULL, a header,
   *  or a row not loaded. */
  value: string | null;
  /** The icon's badge, or the pointer (no size), in CSS px from the
   *  canvas's top left; null for a key's. */
  at: { x: number; y: number; width: number; height: number } | null;
}

/** A row's values for the Row tab (`crate/src/row.rs`, `RowValues`), every
 *  column in the view's order, hidden ones included. */
export interface RowValues {
  /** 0-based. */
  row: number;
  fields: {
    index: number;
    name: string;
    type: ColumnType;
    dataType: string;
    hidden: boolean;
    /** Its exact text, cut at 10,000 characters; null for NULL. */
    value: string | null;
    /** The whole value's length in characters. */
    length: number;
  }[];
}

export interface FrameState {
  engine: { state: 'loading' | 'ready' | 'failed' | 'stopped'; text: string };
  /** The file whose rows are shown; null on the first screen. */
  file: FileState | null;
  /** What's opening: a file from the device, or the sample. */
  busy: 'file' | 'sample' | null;
  /** What's loading, a file refused, or why an open failed. */
  message: Line | null;
  /** The perf panel is open (on the canvas, under the first screen). */
  panel: boolean;
  /** The open file's log; empty with none open. `current` is the entry
   *  whose state is shown. */
  log: { entries: LogEntry[]; current: number | null };
  /** The command bar's last answer. */
  answer: Answer | null;
  /** The table's active cell; null with nothing selected, or a range of
   *  columns (it picks no row). */
  active: ActiveCell | null;
  /** The open file's columns in the view's order, hidden ones included:
   *  the left panel's list. Empty with none open. */
  columns: ColumnFacts[];
}

/** What `App.complete` returns (`crate/src/command/complete.rs`). */
export interface Completion {
  /** What the caret is in: a filter's `operator` and `value`, a sort's
   *  `direction`, what `clear` removes, find's `text`. */
  part: 'none' | 'verb' | 'column' | 'row' | 'operator' | 'value' | 'direction' | 'clear' | 'text';
  /** The text an item replaces, in UTF-16 offsets. */
  from: number;
  to: number;
  items: CompletionItem[];
  /** What Enter would do with the whole line. */
  preview: {
    kind: 'empty' | 'command' | 'action' | 'typing' | 'refused' | 'sentence' | 'later' | 'open' | 'nofile';
    /** Each step's plain words (`command`, `action`). */
    steps: string[];
    text: string | null;
    error: boolean;
    /** `command`, `action`: the action as an agent writes it. */
    json: string | null;
  };
  /** The command's parts, once its verb is one the bar runs. */
  slots: { text: string; state: 'done' | 'now' | 'next' }[];
}

export interface CompletionItem {
  /** What replaces the part: a name quoted where it needs to be. */
  text: string;
  label: string;
  /** A verb's hint, a column's DuckDB type, an operator's or a
   *  direction's words, or a later verb's goal. */
  detail: string;
  /** A verb of the grammar not built yet. */
  later: boolean;
  /** A column's kind, for its badge; null for a verb. */
  kind: 'number' | 'text' | 'time' | 'boolean' | null;
  /** A part follows it: a space goes after it. */
  space: boolean;
}

/** What the page is before the app's first word: the prerendered page. */
export const INITIAL: FrameState = {
  engine: { state: 'loading', text: 'Loading DuckDB' },
  file: null,
  busy: null,
  message: null,
  panel: false,
  log: { entries: [], current: null },
  answer: null,
  active: null,
  columns: [],
};

let state = INITIAL;

/** Where the first screen's box was as a file opened: the top bar's bar
 *  moves from there (`bar.tsx`). Read before the first screen is hidden. */
let barFrom: DOMRect | null = null;
export function takeBarFrom(): DOMRect | null {
  const from = barFrom;
  barFrom = null;
  return from;
}
const listeners = new Set<() => void>();

export const getState = (): FrameState => state;

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** What the app calls (`crate/src/frame.rs`, `Frame`). */
export const frameSink = {
  update(next: FrameState): void {
    if (next.file && !state.file) barFrom = document.querySelector('#first [data-bar-box]')?.getBoundingClientRect() ?? null;
    state = next;
    // What CSS alone shows: the table in place of the first screen.
    document.documentElement.toggleAttribute('data-file', next.file !== null);
    // The first screen's ghost of a table steps aside for the panel.
    document.documentElement.toggleAttribute('data-panel', next.panel);
    for (const listener of listeners) listener();
  },
  press(press: TablePress): void {
    for (const listener of pressListeners) listener(press);
  },
};

const pressListeners = new Set<(press: TablePress) => void>();

/** The table's presses the page answers, as they come: an event, not
 *  state, so a second press on the same cell is heard. */
export function subscribePress(listener: (press: TablePress) => void): () => void {
  pressListeners.add(listener);
  return () => pressListeners.delete(listener);
}
