/**
 * The wide level's copy on the DOM: Cmd+C (Ctrl+C) on the selection, the
 * clipboard written as the tall table's bridge writes it
 * (`components/tall-table/bridge/src/clipboard.rs`), and what the GPUI
 * contender's host does around it (`gpui/crate/src/wide.rs`): a second
 * Cmd+C on a selection the key declined copies it past the key's limit,
 * a copy the browser can't write is cancelled, and with `?measure` the
 * copy's marks and `__contender.copy`, with `?readout` the page's copy line
 * (`contenders/tools.ts`). The copy itself is `data/copy.ts`'s.
 *
 * Loaded after first paint with the data layer (`main.ts`), so first-paint
 * JS carries none of it; the view hands it to `wide-tools.ts`.
 *
 * At `started`, in the key's task (so the gesture still counts), it opens
 * `navigator.clipboard.write([new ClipboardItem({'text/plain': promise})])`,
 * keeps each `text` piece, resolves the promise with a Blob of them at
 * `copied`, and rejects it at `failed` or a close, the clipboard as it was.
 * Without `ClipboardItem`, `writeText` at `copied`; without
 * `navigator.clipboard` (an insecure context), and when the browser refuses
 * the write while the copy runs, the copy is cancelled.
 */

import { measuring, type Contender } from '../../../../contract.ts';
import { COPY_MARKS, toolsReporter, type CopyState, type ToolsMessage } from '../../../../tools.ts';
import { cancelCopy, copyKey, copyStart, copying, setCopy, type CopyColumn, type CopyEvent, type CopyFailure } from './data/copy.ts';
import type { TablePaging } from './data/paging.ts';
import type { Column, TablePage } from './data/table.ts';
import { selectedColumns, selectedRows, type Selection } from './select.ts';

/** What became of a copy, as the bridge's `Outcome::to_js` spells it. */
type Outcome =
  | { state: 'declined'; id: null; rows: number; columns: number }
  | { state: 'copying'; id: number; rows: number; rowsDone: number }
  | { state: 'writing' | 'written'; id: number; bytes: number }
  | { state: 'refused'; id: number; error: string }
  | { state: 'failed'; id: number; reason: 'too-large'; bytes: number; maxBytes: number }
  | { state: 'failed'; id: number; reason: 'read'; error: string }
  | { state: 'failed'; id: number; reason: 'cancelled' | 'closed' }
  | { state: 'unavailable'; id: number };

/** How the text reaches the clipboard. */
type Write = { kind: 'item'; resolve: (blob: Blob) => void; reject: (error: Error) => void } | { kind: 'text'; clipboard: Clipboard };

/** The copy whose write is open. */
interface Open {
  id: number;
  rows: number;
  pieces: string[];
  write: Write;
}

/** The table's copy, as the view holds it. */
export interface Copier {
  /** Cmd+C (Ctrl+C): whether it took the key (nothing selected, it didn't). */
  key(): boolean;
  /** Escape: a copy running cancelled, the selection kept; whether one ran. */
  escape(): boolean;
  /** The selection changed. */
  selected(selection: Selection | null): void;
  /** The table goes: an open write rejected. */
  close(): void;
}

const contender = (): (Contender & { copy?: unknown }) | undefined => (globalThis as { __contender?: Contender }).__contender;

/** A thrown or rejected value as `Name: message`. */
const errorText = (error: unknown): string => (error instanceof Error || error instanceof DOMException ? `${error.name}: ${error.message}` : String(error));

/** The page's reporter (`?readout`), made once a page (null without it); it calls the table shown. */
let reporter: ((message: Omit<ToolsMessage, 'seiza'>) => void) | null = null;
let reporterMade = false;
let shown: { copy(): void; cancel(): void } | null = null;

/** The file's columns as the copy writes them: a FLOAT's text is its own
 *  float32 shortest round trip, as the GPUI side's engine gives it
 *  (`Value::Float32`), not the widened double's. */
export const copyColumns = (columns: readonly Column[]): CopyColumn[] => columns.map(({ name, type, kind }) => ({ name, kind: type === 'FLOAT' ? 'float32' : kind }));

/** Sets up `paging`'s copy over the file's `fileColumns`, the selection read through `selection`. */
export function attachCopy(paging: TablePaging<TablePage>, fileColumns: readonly Column[], selection: () => Selection | null): Copier {
  const measured = measuring();
  const columns = copyColumns(fileColumns);
  if (!reporterMade) {
    reporterMade = true;
    reporter = toolsReporter({ copy: () => shown?.copy(), cancel: () => shown?.cancel() });
  }
  /** The key declined the selection, and it hasn't changed since: the next key copies it. */
  let declined = false;
  /** The copy whose write is open, and the one whose text is in and whose write the browser settles. */
  let open: Open | null = null;
  /** Still copying, the browser has refused its write: the next event cancels it. */
  let refusedOpen: number | null = null;
  let writing: { id: number; bytes: number } | null = null;
  /** The last copy started: the one the global and the page describe. */
  let latest: number | null = null;
  /** What the page's copy line says. */
  const told: Omit<ToolsMessage, 'seiza'> & { started: number } = { cells: 0, copy: null, done: 0, bytes: 0, ms: 0, started: 0 };

  const report = () => {
    if (!reporter) return;
    const { started: _, ...message } = told;
    reporter(message);
  };

  const tell = (outcome: Outcome) => {
    if (measured) {
      const target = contender();
      if (target) target.copy = outcome;
      if (outcome.state === 'written') performance.mark(COPY_MARKS.written);
    }
    told.copy = outcome.state as CopyState;
    told.done = outcome.state === 'copying' ? (outcome.rows === 0 ? 0 : outcome.rowsDone / outcome.rows) : outcome.state === 'writing' || outcome.state === 'written' ? 1 : 0;
    told.bytes = outcome.state === 'writing' || outcome.state === 'written' ? outcome.bytes : 0;
    told.ms = outcome.state === 'written' ? performance.now() - told.started : 0;
    if (outcome.state === 'declined') told.cells = outcome.rows * outcome.columns;
    if (outcome.state === 'failed') told.reason = outcome.reason;
    else delete told.reason;
    report();
  };
  /** Tells what became of `id`'s write when the browser settles it, unless a later copy has started since. */
  const tellSettled = (id: number, outcome: Outcome) => {
    if (latest === id) tell(outcome);
  };

  const failed = (id: number, reason: CopyFailure | { kind: 'closed' }): Outcome =>
    reason.kind === 'too-large'
      ? { state: 'failed', id, reason: 'too-large', bytes: reason.bytes, maxBytes: reason.maxBytes }
      : reason.kind === 'read'
        ? { state: 'failed', id, reason: 'read', error: reason.message }
        : { state: 'failed', id, reason: reason.kind };

  /** Says what became of `id`'s write when `written` settles. */
  const settle = (id: number, written: Promise<void>) => {
    written.then(
      () => {
        if (writing?.id !== id) return;
        const { bytes } = writing;
        writing = null;
        tellSettled(id, { state: 'written', id, bytes });
      },
      (error: unknown) => {
        let refused = false;
        if (writing?.id === id) {
          writing = null;
          refused = true;
        } else if (open?.id === id && refusedOpen !== id) {
          // Still copying: the next event cancels it.
          refusedOpen = id;
          refused = true;
        }
        if (refused) tellSettled(id, { state: 'refused', id, error: errorText(error) });
      },
    );
  };

  /** Opens `id`'s write, or says why it can't be: true to cancel the copy. */
  const start = (id: number, rows: number): boolean => {
    const clipboard = (navigator as Partial<Navigator>).clipboard;
    if (!clipboard) {
      tell({ state: 'unavailable', id });
      return true;
    }
    let write: Write;
    if (typeof ClipboardItem === 'function') {
      let resolve!: (blob: Blob) => void;
      let reject!: (error: Error) => void;
      const text = new Promise<Blob>((ok, fail) => {
        resolve = ok;
        reject = fail;
      });
      let written: Promise<void>;
      try {
        written = clipboard.write([new ClipboardItem({ 'text/plain': text })]);
      } catch (error) {
        tell({ state: 'refused', id, error: errorText(error) });
        return true;
      }
      write = { kind: 'item', resolve, reject };
      settle(id, written);
    } else {
      write = { kind: 'text', clipboard };
    }
    refusedOpen = null;
    open = { id, rows, pieces: [], write };
    tell({ state: 'copying', id, rows, rowsDone: 0 });
    return false;
  };

  /** `id`'s text is in: the item's promise resolved with a Blob, or `writeText` called. */
  const finish = (id: number, bytes: number) => {
    if (open?.id !== id) return;
    const { pieces, write } = open;
    open = null;
    if (refusedOpen === id) return;
    writing = { id, bytes };
    tell({ state: 'writing', id, bytes });
    if (write.kind === 'item') {
      // The strings go with `pieces` here: the Blob holds the text now.
      write.resolve(new Blob(pieces, { type: 'text/plain' }));
      return;
    }
    let written: Promise<void>;
    try {
      written = write.clipboard.writeText(pieces.join(''));
    } catch (error) {
      writing = null;
      tell({ state: 'refused', id, error: errorText(error) });
      return;
    }
    settle(id, written);
  };

  /** Rejects the open write, if any: the clipboard as it was. */
  const reject = (reason: CopyFailure | { kind: 'closed' }) => {
    if (!open) return;
    const { id, write } = open;
    open = null;
    const refused = refusedOpen === id;
    refusedOpen = null;
    if (write.kind === 'item') {
      const why = { 'too-large': 'the copy is too large', read: 'a read for the copy failed', cancelled: 'the copy was cancelled', closed: 'the table closed' }[reason.kind];
      write.reject(new Error(why));
    }
    // A write the browser refused stays said so.
    if (!refused) tell(failed(id, reason));
  };

  const onEvent = (event: CopyEvent) => {
    switch (event.kind) {
      case 'declined':
        // A second key on the selection the key declined: the host's copy,
        // in the key's task (the clipboard's gesture). Its `started` follows.
        if (declined) {
          copyAnyway();
          return;
        }
        declined = true;
        if (measured) performance.mark(COPY_MARKS.declined);
        tell({ state: 'declined', id: null, rows: event.rows, columns: event.columns });
        return;
      case 'started': {
        told.started = performance.now();
        if (measured) performance.mark(COPY_MARKS.started);
        declined = false;
        // The copy before is cancelled first; a write still open is a guard.
        reject({ kind: 'cancelled' });
        latest = event.id;
        if (start(event.id, event.rows[1] - event.rows[0] + 1)) cancel(event.id);
        return;
      }
      case 'text':
        if (open?.id !== event.id) return;
        if (refusedOpen === event.id) {
          // The browser refused the write while the copy ran.
          open = null;
          refusedOpen = null;
          cancel(event.id);
          return;
        }
        open.pieces.push(event.text);
        tell({ state: 'copying', id: event.id, rows: open.rows, rowsDone: event.rowsDone });
        return;
      case 'copied':
        if (measured) performance.mark(COPY_MARKS.copied);
        finish(event.id, event.bytes);
        return;
      case 'failed':
        if (open?.id === event.id) reject(event.reason);
        return;
    }
  };

  /** Cancels copy `id`, which the writer gave up on: its `failed` is told
   *  after the event being told now (`data/copy.ts`'s `batch`). */
  const cancel = (id: number) => {
    if (copying(paging)?.id === id) cancelCopy(paging);
  };

  /** `current`'s rows and columns, or null with nothing selected. */
  const rangesOf = (current: Selection | null): [readonly [number, number], readonly [number, number]] | null => {
    if (!current) return null;
    const rows = selectedRows(current, paging.rows);
    const cols = selectedColumns(current, columns.length);
    return rows && cols ? [rows, cols] : null;
  };
  /** The selection's rows and columns now. */
  const ranges = () => rangesOf(selection());

  /** The host's copy, which the key's limit doesn't hold: the second key, the page's Copy. */
  const copyAnyway = () => {
    const selected = ranges();
    if (selected) copyStart(paging, ...selected);
  };

  setCopy(paging, { columns, onEvent });
  const tools = {
    copy: copyAnyway,
    cancel: () => void cancelCopy(paging),
  };
  shown = tools;
  told.cells = 0;
  report();

  return {
    key: () => {
      const selected = ranges();
      if (!selected) return false;
      copyKey(paging, ...selected);
      return true;
    },
    escape: () => cancelCopy(paging),
    selected: (current) => {
      declined = false;
      const selected = rangesOf(current);
      told.cells = selected ? (selected[0][1] - selected[0][0] + 1) * (selected[1][1] - selected[1][0] + 1) : 0;
      // A copy running is still said; an ended one belongs to the selection before.
      if (told.copy !== 'copying' && told.copy !== 'writing') {
        told.copy = null;
        delete told.reason;
        told.done = 0;
        told.bytes = 0;
        told.ms = 0;
      }
      report();
    },
    close: () => {
      reject({ kind: 'closed' });
      if (shown === tools) shown = null;
    },
  };
}
